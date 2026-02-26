import {
  clamp,
  normalizeVec,
  estimateLocalFlowWidth,
  buildSpatialHash,
  querySpatialNearby,
  pushOutOfRect
} from './crowdPhysics';
import {
  createCombatEffectsPool,
  acquireProjectile,
  acquireHitEffect,
  stepEffectPool
} from '../effects/CombatEffects';
import { updateCrowdCombat } from './crowdCombat';

const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const STAMINA_MAX = 100;
const STAMINA_MOVE_THRESHOLD = 20;
const STAMINA_MOVE_COST = 8;
const STAMINA_RECOVER = 28;
const AGENT_RADIUS = 2.25;
const AGENT_GAP = 1.05;
const WEIGHT_BOTTLENECK_ALPHA = 0.035;
const MAX_AGENTS_PER_SQUAD = 120;
const CAVALRY_RUSH_MAX_DISTANCE = 220;
const CAVALRY_RUSH_MIN_DISTANCE = 18;
const CAVALRY_RUSH_SPEED = 172;
const CAVALRY_RUSH_IMPACT_RADIUS = 6.2;
const CROWD_SAME_TEAM_SEP_STRENGTH = 0.86;
const CROWD_ENEMY_SEP_STRENGTH = 0.14;
const CROWD_ENEMY_MELEE_SEP_STRENGTH = 0.02;
const CROWD_HARD_CONTACT_STRENGTH = 1.18;
const CROWD_ENEMY_TARGET_GAP = AGENT_RADIUS * 1.12;
const CROWD_HARD_CONTACT_GAP = AGENT_RADIUS * 0.58;
const AGENT_IDLE_DEADZONE = 0.72;
const STATIONARY_SEPARATION_SCALE = 0.2;
const STATIONARY_FLAG_SEPARATION_SCALE = 0.08;

const sumUnitsMap = (map = {}) => Object.values(map || {}).reduce((sum, c) => sum + Math.max(0, Number(c) || 0), 0);

const normalizeUnitsMap = (raw = {}) => {
  const out = {};
  Object.entries(raw || {}).forEach(([unitTypeId, count]) => {
    const id = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    const safe = Math.max(0, Math.floor(Number(count) || 0));
    if (!id || safe <= 0) return;
    out[id] = safe;
  });
  return out;
};

const resolveVisibleAgentCount = (remain = 0) => {
  const n = Math.max(1, Math.floor(Number(remain) || 0));
  if (n <= 30) return n;
  if (n <= 300) return Math.min(MAX_AGENTS_PER_SQUAD, 30 + Math.floor((n - 30) / 6));
  if (n <= 3000) return Math.min(MAX_AGENTS_PER_SQUAD, 75 + Math.floor((n - 300) / 60));
  return MAX_AGENTS_PER_SQUAD;
};

const hamiltonAllocate = (countsByType = {}, budget = 0) => {
  const entries = Object.entries(countsByType || {}).filter(([id, c]) => !!id && c > 0);
  if (entries.length <= 0) return {};
  const safeBudget = Math.max(1, Math.floor(Number(budget) || 1));
  const total = entries.reduce((sum, [, c]) => sum + c, 0);
  const alloc = {};
  const frac = [];
  let assigned = 0;
  entries.forEach(([id, c]) => {
    const exact = safeBudget * (c / Math.max(1, total));
    const base = Math.floor(exact);
    alloc[id] = base;
    assigned += base;
    frac.push({ id, rem: exact - base, count: c });
  });
  let left = Math.max(0, safeBudget - assigned);
  frac.sort((a, b) => {
    if (b.rem !== a.rem) return b.rem - a.rem;
    if (b.count !== a.count) return b.count - a.count;
    return a.id.localeCompare(b.id, 'zh-Hans-CN');
  });
  for (let i = 0; i < left; i += 1) {
    const pick = frac[i % frac.length];
    alloc[pick.id] = (alloc[pick.id] || 0) + 1;
  }
  Object.keys(alloc).forEach((id) => {
    if (alloc[id] <= 0) delete alloc[id];
  });
  return alloc;
};

const inferCategoryFromUnitType = (unitType = {}, fallbackClass = 'infantry') => {
  const name = typeof unitType?.name === 'string' ? unitType.name : '';
  const roleTag = unitType?.roleTag === '远程' || unitType?.roleTag === '近战' ? unitType.roleTag : '';
  const speed = Number(unitType?.speed) || 0;
  const range = Number(unitType?.range) || 0;
  if (/(炮|投石|火炮|炮兵|臼炮|加农)/.test(name)) return 'artillery';
  if (/(弓|弩|弓兵|弩兵|射手)/.test(name)) return 'archer';
  if (roleTag === '远程' && range >= 3) return 'archer';
  if (/(骑|骑兵|铁骑|龙骑)/.test(name) || speed >= 2.1) return 'cavalry';
  if (roleTag === '近战') return 'infantry';
  return fallbackClass || 'infantry';
};

const slotOffsetForIndex = (index, columns, spacing = (AGENT_RADIUS * 2) + AGENT_GAP) => {
  const row = Math.floor(index / Math.max(1, columns));
  const col = index % Math.max(1, columns);
  return {
    side: (col - ((columns - 1) / 2)) * spacing,
    back: row * (spacing * 0.92)
  };
};

const teamForward = (team) => (team === TEAM_ATTACKER ? { x: 1, y: 0 } : { x: -1, y: 0 });

const resolveAgentSpeedMul = (unitType = {}, category = 'infantry') => {
  const rawSpeed = Number(unitType?.speed);
  if (Number.isFinite(rawSpeed) && rawSpeed > 0) {
    return clamp(rawSpeed / 1.45, 0.64, 1.72);
  }
  if (category === 'cavalry') return 1.3;
  if (category === 'artillery') return 0.82;
  if (category === 'archer') return 0.98;
  return 1;
};

const resolveAttackRange = (squad = {}) => {
  const avgRange = Math.max(1, Number(squad?.stats?.range) || 1);
  if (squad.classTag === 'artillery') return 126;
  if (squad.classTag === 'archer') return 88;
  if (squad.classTag === 'cavalry') return Math.max(7.4, avgRange * 16);
  if (avgRange >= 2.2) return Math.max(64, avgRange * 28);
  return 6.2;
};

const isMeleeAgent = (agent) => {
  const category = typeof agent?.typeCategory === 'string' ? agent.typeCategory : '';
  return category !== 'archer' && category !== 'artillery';
};

const computeTeamAwareSeparation = (agent, neighbors = [], sameTeamGap = 5.2) => {
  let sx = 0;
  let sy = 0;
  neighbors.forEach((other) => {
    if (!other || other.id === agent.id || other.dead) return;
    const dx = (agent.x || 0) - (other.x || 0);
    const dy = (agent.y || 0) - (other.y || 0);
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.0001) return;
    const sameTeam = other.team === agent.team;
    const bothMelee = isMeleeAgent(agent) && isMeleeAgent(other);
    let targetGap = sameTeam ? sameTeamGap : CROWD_ENEMY_TARGET_GAP;
    let strength = sameTeam ? CROWD_SAME_TEAM_SEP_STRENGTH : CROWD_ENEMY_SEP_STRENGTH;
    if (!sameTeam && bothMelee) {
      strength = CROWD_ENEMY_MELEE_SEP_STRENGTH;
      targetGap = Math.min(targetGap, AGENT_RADIUS * 1.05);
    }
    if (dist >= targetGap) return;
    if (sameTeam && dist < CROWD_HARD_CONTACT_GAP) {
      strength = Math.max(strength, CROWD_HARD_CONTACT_STRENGTH);
    }
    const push = ((targetGap - dist) / targetGap) * strength;
    sx += (dx / dist) * push;
    sy += (dy / dist) * push;
  });
  return { x: sx, y: sy };
};

const pointToSegmentDistance = (point, segA, segB) => {
  const px = Number(point?.x) || 0;
  const py = Number(point?.y) || 0;
  const ax = Number(segA?.x) || 0;
  const ay = Number(segA?.y) || 0;
  const bx = Number(segB?.x) || 0;
  const by = Number(segB?.y) || 0;
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = (vx * vx) + (vy * vy);
  if (lenSq <= 0.0001) return Math.hypot(px - ax, py - ay);
  const t = clamp((((px - ax) * vx) + ((py - ay) * vy)) / lenSq, 0, 1);
  const cx = ax + (vx * t);
  const cy = ay + (vy * t);
  return Math.hypot(px - cx, py - cy);
};

const pickNearestEnemySquad = (squad, squads = []) => {
  const enemyTeam = squad?.team === TEAM_ATTACKER ? TEAM_DEFENDER : TEAM_ATTACKER;
  let best = null;
  let bestDist = Infinity;
  squads.forEach((row) => {
    if (!row || row.team !== enemyTeam || row.remain <= 0) return;
    const dist = Math.hypot((row.x || 0) - (squad.x || 0), (row.y || 0) - (squad.y || 0));
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  });
  return best;
};

const updateSquadBehaviorPlan = (squad, sim) => {
  if (!squad || squad.remain <= 0) return;
  if ((Number(squad?.skillRush?.ttl) || 0) > 0) {
    squad.action = '兵种攻击';
    return;
  }
  if (!Array.isArray(squad.waypoints)) squad.waypoints = [];
  const fieldWidth = Number(sim?.field?.width) || 900;
  const halfW = fieldWidth / 2;
  const hasWaypoint = squad.waypoints.length > 0;
  const nearestEnemy = pickNearestEnemySquad(squad, sim?.squads || []);

  if (squad.behavior === 'retreat') {
    squad.action = '撤退';
    if (!hasWaypoint) {
      const fallbackX = squad.team === TEAM_ATTACKER ? (-halfW + 40) : (halfW - 40);
      squad.waypoints = [{ x: fallbackX, y: 0 }];
    }
    return;
  }

  if (squad.behavior === 'idle') {
    squad.action = '待命';
    if ((Number(squad.underAttackTimer) || 0) > 0.2) {
      squad.behavior = 'auto';
      squad.action = '自动攻击';
    } else {
      return;
    }
  }

  if (!nearestEnemy) {
    if (!hasWaypoint) {
      squad.action = squad.behavior === 'defend' ? '防御' : '待命';
    }
    return;
  }

  const isRanged = squad.classTag === 'archer'
    || squad.classTag === 'artillery'
    || squad.roleTag === '远程'
    || (Number(squad?.stats?.range) || 0) >= 2.2;
  const attackRange = resolveAttackRange(squad);
  const dx = (nearestEnemy.x || 0) - (squad.x || 0);
  const dy = (nearestEnemy.y || 0) - (squad.y || 0);
  const dist = Math.hypot(dx, dy) || 1;
  const dirX = dx / dist;
  const dirY = dy / dist;
  const desired = isRanged ? attackRange * 0.95 : Math.max(attackRange * 0.82, (AGENT_RADIUS * 2) + 0.5);
  const engageThreshold = desired * (squad.behavior === 'defend' ? 1.05 : (isRanged ? 1.1 : 1.22));

  if (dist > engageThreshold && !hasWaypoint) {
    let nextX = (nearestEnemy.x || 0) - (dirX * desired);
    let nextY = (nearestEnemy.y || 0) - (dirY * desired);
    if (squad.team === TEAM_DEFENDER) {
      nextX = Math.max(nextX, -fieldWidth * 0.12);
    } else {
      nextX = Math.min(nextX, fieldWidth * 0.12);
    }
    squad.waypoints = [{ x: nextX, y: nextY }];
    squad.action = '移动';
  } else if (isRanged && dist < desired * 0.72 && !hasWaypoint) {
    const backX = (squad.x || 0) - (dirX * 26);
    const backY = (squad.y || 0) - (dirY * 26);
    squad.waypoints = [{ x: backX, y: backY }];
    squad.action = '移动';
  } else if (!hasWaypoint) {
    squad.action = squad.behavior === 'defend' ? '防御' : '普通攻击';
  }
};

const createAgent = ({
  id,
  squadId,
  team,
  unitTypeId,
  category,
  x,
  y,
  weight,
  slotOrder = 0,
  moveSpeedMul = 1,
  isFlagBearer = false
}) => ({
  id,
  squadId,
  team,
  unitTypeId,
  typeCategory: category,
  x: Number(x) || 0,
  y: Number(y) || 0,
  vx: 0,
  vy: 0,
  yaw: 0,
  radius: AGENT_RADIUS,
  weight: Math.max(0.2, Number(weight) || 1),
  initialWeight: Math.max(0.2, Number(weight) || 1),
  hpWeight: Math.max(0.2, Number(weight) || 1),
  state: 'idle',
  attackCd: 0,
  targetAgentId: '',
  slotOrder,
  moveSpeedMul: clamp(Number(moveSpeedMul) || 1, 0.6, 1.8),
  isFlagBearer: !!isFlagBearer,
  hitTimer: 0,
  dead: false
});

const ensureFlagBearer = (squad, agents = []) => {
  const alive = (Array.isArray(agents) ? agents : []).filter((agent) => agent && !agent.dead && (agent.weight || 0) > 0.001);
  if (alive.length <= 0) {
    if (squad) squad.flagBearerAgentId = '';
    return null;
  }
  let flagBearer = alive.find((agent) => agent.id === squad?.flagBearerAgentId) || null;
  if (!flagBearer) {
    flagBearer = alive.reduce((best, agent) => {
      if (!best) return agent;
      return (agent.slotOrder < best.slotOrder) ? agent : best;
    }, null);
  }
  alive.forEach((agent) => {
    agent.isFlagBearer = !!flagBearer && agent.id === flagBearer.id;
  });
  if (squad) squad.flagBearerAgentId = flagBearer?.id || '';
  return flagBearer;
};

const createAgentsForSquad = (squad, crowd) => {
  const unitMap = crowd.unitTypeMap || new Map();
  const countsByType = normalizeUnitsMap(squad?.units || {});
  const remain = Math.max(1, Math.floor(Number(squad?.remain) || sumUnitsMap(countsByType) || 1));
  const agentBudget = resolveVisibleAgentCount(remain);
  const alloc = hamiltonAllocate(countsByType, agentBudget);
  const agents = [];
  const baseCols = Math.max(1, Math.ceil(Math.sqrt(agentBudget)));

  let slotOrder = 0;
  Object.entries(alloc).forEach(([unitTypeId, count]) => {
    const perAgentWeight = (countsByType[unitTypeId] || 1) / Math.max(1, count);
    const unitType = unitMap.get(unitTypeId) || {};
    const category = inferCategoryFromUnitType(unitType, squad?.classTag || 'infantry');
    const moveSpeedMul = resolveAgentSpeedMul(unitType, category);
    for (let i = 0; i < count; i += 1) {
      const offset = slotOffsetForIndex(slotOrder, baseCols);
      agents.push(createAgent({
        id: `${squad.id}_ag_${slotOrder + 1}`,
        squadId: squad.id,
        team: squad.team,
        unitTypeId,
        category,
        x: (Number(squad.x) || 0) - offset.back,
        y: (Number(squad.y) || 0) + offset.side,
        weight: perAgentWeight,
        slotOrder,
        moveSpeedMul
      }));
      slotOrder += 1;
    }
  });
  if (agents.length <= 0) {
    agents.push(createAgent({
      id: `${squad.id}_ag_1`,
      squadId: squad.id,
      team: squad.team,
      unitTypeId: '__fallback__',
      category: squad?.classTag || 'infantry',
      x: Number(squad.x) || 0,
      y: Number(squad.y) || 0,
      weight: remain,
      slotOrder: 0,
      moveSpeedMul: resolveAgentSpeedMul({}, squad?.classTag || 'infantry')
    }));
  }
  squad._crowdBaseColumns = Math.max(1, Math.ceil(Math.sqrt(agents.length)));
  squad._crowdForward = teamForward(squad.team);
  const flagBearer = ensureFlagBearer(squad, agents);
  if (flagBearer) {
    squad.x = flagBearer.x;
    squad.y = flagBearer.y;
  }
  return agents;
};

const leaderMoveStep = (squad, sim, dt, forwardVec) => {
  const moralePenalty = squad.morale <= 0 ? (2 / 3) : (squad.morale < 20 ? 0.82 : 1);
  const fatiguePenalty = squad.fatigueTimer > 0 ? 0.72 : 1;
  const buffSpeed = squad.effectBuff?.speedMul ? Number(squad.effectBuff.speedMul) : 1;
  const rushSpeed = squad.skillRush?.ttl > 0 ? 1.45 : 1;
  const speedBase = Math.max(9, (Number(squad.stats?.speed) || 1) * 18);
  const speed = speedBase * moralePenalty * fatiguePenalty * buffSpeed * rushSpeed;
  let target = null;

  if (squad.skillRush?.ttl > 0) {
    const remainDistance = Math.max(0, Number(squad.skillRush.remainDistance) || 0);
    if (remainDistance <= 0.01) {
      squad.skillRush = null;
      squad.behavior = 'auto';
      squad.action = '自动攻击';
      return forwardVec;
    }
    target = {
      x: (Number(squad.x) || 0) + ((squad.skillRush.dirX || 0) * remainDistance),
      y: (Number(squad.y) || 0) + ((squad.skillRush.dirY || 0) * remainDistance)
    };
    squad.skillRush.ttl = Math.max(0, squad.skillRush.ttl - dt);
  } else if (Array.isArray(squad.waypoints) && squad.waypoints.length > 0) {
    target = squad.waypoints[0];
  }

  if (!target) {
    squad.stamina = clamp((Number(squad.stamina) || 0) + (STAMINA_RECOVER * dt), 0, STAMINA_MAX);
    return forwardVec;
  }

  if ((Number(squad.stamina) || 0) < STAMINA_MOVE_THRESHOLD) {
    squad.waypoints = [];
    squad.stamina = clamp((Number(squad.stamina) || 0) + (STAMINA_RECOVER * dt), 0, STAMINA_MAX);
    return forwardVec;
  }

  const dir = normalizeVec((Number(target.x) || 0) - (Number(squad.x) || 0), (Number(target.y) || 0) - (Number(squad.y) || 0));
  if (dir.len <= 0.0001) {
    if (squad.waypoints.length > 0) squad.waypoints.shift();
    return forwardVec;
  }
  const appliedSpeed = squad.skillRush?.ttl > 0 ? CAVALRY_RUSH_SPEED : speed;
  const step = Math.min(dir.len, appliedSpeed * dt);
  const prevX = Number(squad.x) || 0;
  const prevY = Number(squad.y) || 0;
  let nx = (Number(squad.x) || 0) + (dir.x * step);
  let ny = (Number(squad.y) || 0) + (dir.y * step);
  const halfW = (Number(sim?.field?.width) || 900) / 2;
  const halfH = (Number(sim?.field?.height) || 620) / 2;
  nx = clamp(nx, -halfW + 4, halfW - 4);
  ny = clamp(ny, -halfH + 4, halfH - 4);
  const walls = Array.isArray(sim?.buildings) ? sim.buildings : [];
  walls.forEach((wall) => {
    if (!wall || wall.destroyed) return;
    const pushed = pushOutOfRect({ x: nx, y: ny }, wall, AGENT_RADIUS + 1.8);
    nx = pushed.x;
    ny = pushed.y;
  });
  squad.x = nx;
  squad.y = ny;
  if (squad.skillRush?.ttl > 0) {
    const moved = Math.hypot(nx - prevX, ny - prevY);
    squad.skillRush.remainDistance = Math.max(0, (Number(squad.skillRush.remainDistance) || 0) - moved);
    if (squad.skillRush.ttl <= 0 || squad.skillRush.remainDistance <= 0.8) {
      squad.skillRush = null;
      squad.behavior = 'auto';
      squad.action = '自动攻击';
    } else {
      squad.action = '兵种攻击';
    }
  }
  squad.stamina = clamp((Number(squad.stamina) || 0) - (STAMINA_MOVE_COST * dt), 0, STAMINA_MAX);
  if ((Number(squad.stamina) || 0) < STAMINA_MOVE_THRESHOLD && !(squad.skillRush?.ttl > 0)) {
    squad.waypoints = [];
    if (squad.behavior === 'move') {
      squad.behavior = 'idle';
      squad.action = '待命';
    }
  }
  if (Math.hypot((Number(target.x) || 0) - nx, (Number(target.y) || 0) - ny) <= 5.4) {
    if (squad.waypoints.length > 0) squad.waypoints.shift();
  }
  return { x: dir.x, y: dir.y };
};

const aggregateSquadFromAgents = (squad, agents = []) => {
  if (!squad) return;
  const alive = agents.filter((agent) => agent && !agent.dead && agent.weight > 0.001);
  if (alive.length <= 0) {
    squad.remain = 0;
    squad.health = 0;
    squad.action = '覆灭';
    squad.behavior = 'idle';
    squad.waypoints = [];
    squad.flagBearerAgentId = '';
    return;
  }
  const remain = alive.reduce((sum, agent) => sum + Math.max(0, agent.weight || 0), 0);
  const flagBearer = ensureFlagBearer(squad, alive);
  const anchorX = Number.isFinite(Number(flagBearer?.x)) ? Number(flagBearer.x) : (Number(squad.x) || 0);
  const anchorY = Number.isFinite(Number(flagBearer?.y)) ? Number(flagBearer.y) : (Number(squad.y) || 0);
  const maxDist = alive.reduce((max, agent) => {
    const d = Math.hypot((agent.x || 0) - anchorX, (agent.y || 0) - anchorY);
    return Math.max(max, d);
  }, 0);
  const remainRounded = Math.max(0, Math.round(remain));
  squad.remain = clamp(remainRounded, 0, Math.max(0, Number(squad.startCount) || 0));
  squad.losses = Math.max(0, Math.floor((Number(squad.startCount) || 0) - squad.remain));
  squad.x = anchorX;
  squad.y = anchorY;
  squad.radius = clamp(maxDist + 6, 8, 130);
  const healthRatio = clamp(squad.remain / Math.max(1, Number(squad.startCount) || 1), 0, 1);
  squad.health = Math.max(0, (Number(squad.maxHealth) || 1) * healthRatio);
  if (squad.remain <= 0) {
    squad.action = '覆灭';
    squad.behavior = 'idle';
    squad.waypoints = [];
    squad.flagBearerAgentId = '';
    return;
  }

  const remainUnits = {};
  alive.forEach((agent) => {
    const unitTypeId = typeof agent.unitTypeId === 'string' ? agent.unitTypeId : '__fallback__';
    remainUnits[unitTypeId] = (remainUnits[unitTypeId] || 0) + Math.max(0, agent.weight || 0);
  });
  squad.remainUnits = Object.fromEntries(
    Object.entries(remainUnits).map(([unitTypeId, value]) => [unitTypeId, Math.max(0, Math.round(value))])
  );
};

const trimOrGrowAgents = (squad, agents = [], crowd, dt) => {
  const alive = agents.filter((agent) => !agent.dead && agent.weight > 0.001);
  const target = Number(squad.remain) <= 0 ? 0 : resolveVisibleAgentCount(Math.max(1, Number(squad.remain) || 1));
  const delta = alive.length - target;
  if (delta > 0) {
    const removeCount = Math.min(delta, Math.max(1, Math.floor(dt * 14)));
    const removable = alive
      .filter((agent) => !agent.isFlagBearer)
      .sort((a, b) => (a.weight - b.weight) || (b.slotOrder - a.slotOrder))
      .slice(0, removeCount);
    (removable.length > 0 ? removable : alive
      .sort((a, b) => (a.weight - b.weight) || (b.slotOrder - a.slotOrder))
      .slice(0, removeCount))
      .forEach((agent) => {
        agent.dead = true;
        agent.weight = 0;
        agent.hpWeight = 0;
      });
  } else if (delta < 0 && alive.length > 0) {
    const addCount = Math.min(-delta, Math.max(1, Math.floor(dt * 9)));
    const source = alive.sort((a, b) => b.weight - a.weight)[0] || alive[0];
    const splitWeight = Math.max(0.45, (source.weight || 1) * 0.5);
    for (let i = 0; i < addCount; i += 1) {
      if ((source.weight || 0) <= 0.9) break;
      source.weight = Math.max(0.3, source.weight - splitWeight);
      source.hpWeight = Math.max(0.3, source.hpWeight - splitWeight);
      agents.push(createAgent({
        id: `${squad.id}_ag_${crowd.nextAgentId += 1}`,
        squadId: squad.id,
        team: squad.team,
        unitTypeId: source.unitTypeId,
        category: source.typeCategory,
        x: (source.x || 0) + ((Math.random() - 0.5) * 2.4),
        y: (source.y || 0) + ((Math.random() - 0.5) * 2.4),
        weight: splitWeight,
        slotOrder: source.slotOrder + i + 1,
        moveSpeedMul: source.moveSpeedMul || 1
      }));
    }
  }
  ensureFlagBearer(squad, agents);
};

const applyCavalryRushImpact = (sim, crowd, squad, agents = [], fromPoint, toPoint) => {
  if (!squad || squad.classTag !== 'cavalry' || !squad.skillRush) return;
  const rush = squad.skillRush;
  if (!(rush.hitAgentIds instanceof Set)) {
    rush.hitAgentIds = new Set();
  }
  const segmentLen = Math.hypot((toPoint?.x || 0) - (fromPoint?.x || 0), (toPoint?.y || 0) - (fromPoint?.y || 0));
  if (segmentLen <= 0.2) return;

  const flagBearer = ensureFlagBearer(squad, agents);
  const sourceWeight = Math.max(1, Number(flagBearer?.weight) || 1);
  const impactDamage = Math.max(0.8, (Number(squad.stats?.atk) || 10) * 0.11 * Math.sqrt(sourceWeight));
  const dir = normalizeVec((toPoint?.x || 0) - (fromPoint?.x || 0), (toPoint?.y || 0) - (fromPoint?.y || 0));
  const enemyTeam = squad.team === TEAM_ATTACKER ? TEAM_DEFENDER : TEAM_ATTACKER;

  crowd.agentsBySquad.forEach((enemyAgents, enemySquadId) => {
    const enemySquad = (sim?.squads || []).find((row) => row.id === enemySquadId) || null;
    if (!enemySquad || enemySquad.team !== enemyTeam || enemySquad.remain <= 0) return;
    (Array.isArray(enemyAgents) ? enemyAgents : []).forEach((enemyAgent) => {
      if (!enemyAgent || enemyAgent.dead) return;
      if (rush.hitAgentIds.has(enemyAgent.id)) return;
      const hitRadius = CAVALRY_RUSH_IMPACT_RADIUS + Math.max(1.2, Number(enemyAgent.radius) || AGENT_RADIUS);
      const dist = pointToSegmentDistance(enemyAgent, fromPoint, toPoint);
      if (dist > hitRadius) return;

      rush.hitAgentIds.add(enemyAgent.id);
      enemyAgent.hitTimer = 0.24;
      enemyAgent.weight = Math.max(0, (Number(enemyAgent.weight) || 0) - impactDamage);
      enemyAgent.hpWeight = Math.max(0, (Number(enemyAgent.hpWeight) || 0) - impactDamage);
      enemyAgent.x = (Number(enemyAgent.x) || 0) + (dir.x * 1.8);
      enemyAgent.y = (Number(enemyAgent.y) || 0) + (dir.y * 1.8);
      enemySquad.underAttackTimer = 1.2;
      enemySquad.morale = clamp((Number(enemySquad.morale) || 0) - (impactDamage * 0.32), 0, 100);
      squad.morale = clamp((Number(squad.morale) || 0) + (impactDamage * 0.2), 0, 100);

      acquireHitEffect(crowd.effectsPool, {
        type: 'slash',
        x: enemyAgent.x,
        y: enemyAgent.y,
        z: 1.6,
        radius: Math.max(2.2, Math.min(6.6, impactDamage * 0.9)),
        ttl: 0.14,
        team: squad.team
      });

      if (enemyAgent.weight <= 0.001) {
        enemyAgent.dead = true;
        squad.kills = Math.max(0, Number(squad.kills) || 0) + Math.max(1, Math.round(Number(enemyAgent.initialWeight) || 1));
      }
    });
  });
};

export const createCrowdSim = (sim, options = {}) => {
  const unitTypeMap = options?.unitTypeMap instanceof Map ? options.unitTypeMap : new Map();
  const crowd = {
    agentsBySquad: new Map(),
    allAgents: [],
    effectsPool: createCombatEffectsPool(),
    nextAgentId: 1,
    unitTypeMap
  };
  (Array.isArray(sim?.squads) ? sim.squads : []).forEach((squad) => {
    const agents = createAgentsForSquad(squad, crowd);
    crowd.nextAgentId += agents.length;
    crowd.agentsBySquad.set(squad.id, agents);
  });
  return crowd;
};

export const getCrowdAgentsForSquad = (crowd, squadId = '') => {
  const source = crowd?.agentsBySquad?.get(squadId);
  if (!Array.isArray(source)) return [];
  return source.filter((agent) => agent && !agent.dead && (agent.weight || 0) > 0.001);
};

export const triggerCrowdSkill = (sim, crowd, squadId, targetPoint) => {
  const squad = (sim?.squads || []).find((row) => row.id === squadId);
  if (!squad || squad.remain <= 0) return { ok: false, reason: '部队不可用' };
  if ((Number(squad.morale) || 0) <= 0) return { ok: false, reason: '士气归零，无法发动兵种攻击' };
  const agents = getCrowdAgentsForSquad(crowd, squad.id);
  if (agents.length <= 0) return { ok: false, reason: '无可用士兵' };
  const tx = Number(targetPoint?.x) || squad.x || 0;
  const ty = Number(targetPoint?.y) || squad.y || 0;

  if (squad.classTag === 'infantry') {
    squad.effectBuff = {
      type: 'infantry',
      ttl: 7.5,
      atkMul: 1.22,
      defMul: 1.3,
      speedMul: 0.78
    };
    squad.waypoints = [{ x: tx, y: ty }];
    squad.attackCooldown = Math.max(Number(squad.attackCooldown) || 0, 2.1);
    squad.action = '兵种攻击';
    return { ok: true };
  }

  if (squad.classTag === 'cavalry') {
    const dir = normalizeVec(tx - (Number(squad.x) || 0), ty - (Number(squad.y) || 0));
    const dist = clamp(dir.len, CAVALRY_RUSH_MIN_DISTANCE, CAVALRY_RUSH_MAX_DISTANCE);
    squad.skillRush = {
      ttl: Math.max(0.55, (dist / CAVALRY_RUSH_SPEED) * 1.5),
      dirX: dir.x,
      dirY: dir.y,
      remainDistance: dist,
      hitAgentIds: new Set(),
      startX: Number(squad.x) || 0,
      startY: Number(squad.y) || 0
    };
    squad.behavior = 'skill';
    squad.waypoints = [];
    squad.stamina = clamp((Number(squad.stamina) || 0) - 32, 0, STAMINA_MAX);
    squad.attackCooldown = Math.max(Number(squad.attackCooldown) || 0, 2.8);
    squad.action = '兵种攻击';
    return { ok: true };
  }

  const volleyCount = Math.max(3, Math.min(8, Math.floor(Math.sqrt(agents.length)) + 2));
  const shooters = [...agents]
    .sort((a, b) => (b.weight - a.weight))
    .slice(0, volleyCount);
  const enemyTeam = squad.team === TEAM_ATTACKER ? TEAM_DEFENDER : TEAM_ATTACKER;
  shooters.forEach((agent, index) => {
    const dir = normalizeVec(
      tx - (agent.x || 0) + ((index - (shooters.length / 2)) * 2.2),
      ty - (agent.y || 0) + ((index - (shooters.length / 2)) * 2.2)
    );
    const isArtillery = squad.classTag === 'artillery';
    const speed = isArtillery ? 168 : 226;
    const gravity = isArtillery ? 95 : 70;
    acquireProjectile(crowd.effectsPool, {
      type: isArtillery ? 'shell' : 'arrow',
      team: squad.team,
      squadId: squad.id,
      sourceAgentId: agent.id,
      x: agent.x,
      y: agent.y,
      z: isArtillery ? 6 : 4.1,
      vx: dir.x * speed,
      vy: dir.y * speed,
      vz: isArtillery ? 42 : 27,
      gravity,
      damage: Math.max(0.3, (Number(squad.stats?.atk) || 10) * (isArtillery ? 0.14 : 0.08) * Math.max(1, Math.sqrt(agent.weight || 1))),
      radius: isArtillery ? 4.8 : 2.2,
      ttl: isArtillery ? 2.1 : 1.45,
      targetTeam: enemyTeam
    });
  });
  acquireHitEffect(crowd.effectsPool, {
    type: squad.classTag === 'artillery' ? 'explosion' : 'hit',
    x: tx,
    y: ty,
    z: 1.2,
    radius: squad.classTag === 'artillery' ? 10 : 6,
    ttl: squad.classTag === 'artillery' ? 0.34 : 0.22,
    team: squad.team
  });
  squad.attackCooldown = Math.max(Number(squad.attackCooldown) || 0, squad.classTag === 'artillery' ? 3.1 : 1.9);
  squad.action = '兵种攻击';
  return { ok: true };
};

export const updateCrowdSim = (crowd, sim, dt) => {
  if (!crowd || !sim || sim.ended) return;
  const safeDt = Math.max(0.001, Number(dt) || 0.016);
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  const walls = Array.isArray(sim?.buildings) ? sim.buildings.filter((w) => !w?.destroyed) : [];

  crowd.allAgents = [];
  crowd.agentsBySquad.forEach((agents, squadId) => {
    const filtered = (Array.isArray(agents) ? agents : []).filter((agent) => agent && !agent.dead && (agent.weight || 0) > 0.001);
    crowd.agentsBySquad.set(squadId, filtered);
    crowd.allAgents.push(...filtered);
  });
  const spatial = buildSpatialHash(crowd.allAgents, 14);

  squads.forEach((squad) => {
    if (!squad || squad.remain <= 0) return;
    const agents = crowd.agentsBySquad.get(squad.id) || [];
    if (agents.length <= 0) {
      squad.remain = 0;
      squad.health = 0;
      squad.action = '覆灭';
      squad.behavior = 'idle';
      squad.waypoints = [];
      squad.flagBearerAgentId = '';
      return;
    }
    if (squad.effectBuff) {
      squad.effectBuff.ttl = Math.max(0, Number(squad.effectBuff.ttl) - safeDt);
      if (squad.effectBuff.ttl <= 0) squad.effectBuff = null;
    }
    if ((Number(squad.fatigueTimer) || 0) > 0) {
      squad.fatigueTimer = Math.max(0, Number(squad.fatigueTimer) - safeDt);
    }
    squad.attackCooldown = Math.max(0, (Number(squad.attackCooldown) || 0) - safeDt);
    squad.underAttackTimer = Math.max(0, (Number(squad.underAttackTimer) || 0) - safeDt);
    const attackerManual = squad.team === TEAM_ATTACKER
      && (squad.behavior === 'idle' || squad.behavior === 'move');
    if (!attackerManual) {
      updateSquadBehaviorPlan(squad, sim);
    } else if (squad.behavior === 'idle') {
      squad.action = '待命';
    } else if (squad.behavior === 'move') {
      squad.action = '移动';
    }
    squad._aiSkillCd = Math.max(0, Number(squad._aiSkillCd) || 0);

    if (squad.team === TEAM_DEFENDER && (Number(squad.morale) || 0) > 0) {
      squad._aiSkillCd = Math.max(0, squad._aiSkillCd - safeDt);
      if (squad._aiSkillCd <= 0) {
        const nearestEnemy = pickNearestEnemySquad(squad, sim?.squads || []);
        if (nearestEnemy) {
          const dist = Math.hypot((nearestEnemy.x || 0) - (squad.x || 0), (nearestEnemy.y || 0) - (squad.y || 0));
          const classTag = squad.classTag || 'infantry';
          const shouldUseSkill = (
            (classTag === 'infantry' && dist < 82)
            || (classTag === 'cavalry' && dist > 24 && dist < 155)
            || (classTag === 'archer' && dist < 148)
            || (classTag === 'artillery' && dist < 182)
          );
          if (shouldUseSkill) {
            const result = triggerCrowdSkill(sim, crowd, squad.id, { x: nearestEnemy.x || 0, y: nearestEnemy.y || 0 });
            if (result?.ok) {
              squad._aiSkillCd = classTag === 'artillery' ? 8.8 : 6.6;
            } else {
              squad._aiSkillCd = 2.1;
            }
          } else {
            squad._aiSkillCd = 1.2;
          }
        } else {
          squad._aiSkillCd = 1.2;
        }
      }
    }

    let forward = squad._crowdForward || teamForward(squad.team);
    const rushFromPoint = { x: Number(squad.x) || 0, y: Number(squad.y) || 0 };
    const enemy = (sim.squads || []).find((row) => row.id === squad.targetSquadId && row.remain > 0) || null;
    if (enemy && !(Array.isArray(squad.waypoints) && squad.waypoints.length > 0)) {
      const toEnemy = normalizeVec((enemy.x || 0) - (squad.x || 0), (enemy.y || 0) - (squad.y || 0));
      if (toEnemy.len > 0.0001) forward = { x: toEnemy.x, y: toEnemy.y };
    }
    forward = leaderMoveStep(squad, sim, safeDt, forward);
    squad._crowdForward = forward;

    const baseCols = Math.max(1, Number(squad._crowdBaseColumns) || Math.ceil(Math.sqrt(agents.length)));
    const leaderMoving = ((Number(squad.skillRush?.ttl) || 0) > 0)
      || (Array.isArray(squad.waypoints) && squad.waypoints.length > 0);
    const allowFlowCompact = leaderMoving || squad.behavior === 'auto' || squad.behavior === 'defend' || squad.behavior === 'retreat';
    let columns = baseCols;
    if (allowFlowCompact) {
      const flowWidth = estimateLocalFlowWidth({ x: squad.x, y: squad.y }, forward, walls, {
        step: 3.2,
        maxProbe: 120,
        inflate: AGENT_RADIUS + 1
      });
      const flowCols = Math.max(1, Math.floor(flowWidth / ((AGENT_RADIUS * 2) + AGENT_GAP)));
      columns = Math.max(1, Math.min(baseCols, flowCols));
    }
    const bottlenecked = columns < baseCols;
    const side = { x: -forward.y, y: forward.x };
    const spacing = (AGENT_RADIUS * 2) + AGENT_GAP;
    const sorted = [...agents].sort((a, b) => a.slotOrder - b.slotOrder);
    ensureFlagBearer(squad, sorted);

    sorted.forEach((agent, index) => {
      const slot = slotOffsetForIndex(index, columns, spacing);
      const desiredX = agent.isFlagBearer
        ? (Number(squad.x) || 0)
        : (Number(squad.x) || 0) + (side.x * slot.side) - (forward.x * slot.back);
      const desiredY = agent.isFlagBearer
        ? (Number(squad.y) || 0)
        : (Number(squad.y) || 0) + (side.y * slot.side) - (forward.y * slot.back);
      const toDesired = normalizeVec(desiredX - (agent.x || 0), desiredY - (agent.y || 0));
      const stationaryHold = !leaderMoving && (squad.behavior === 'idle' || squad.behavior === 'move');
      const moraleMul = squad.morale <= 0 ? (2 / 3) : (squad.morale < 20 ? 0.82 : 1);
      const fatigueMul = squad.fatigueTimer > 0 ? 0.72 : 1;
      const weightSlow = bottlenecked
        ? 1 / (1 + (WEIGHT_BOTTLENECK_ALPHA * Math.max(0, Math.min(40, (agent.weight || 1)) - 1)))
        : 1;
      const speedMul = (squad.effectBuff?.speedMul ? Number(squad.effectBuff.speedMul) : 1) * ((squad.skillRush?.ttl || 0) > 0 ? 1.45 : 1);
      const speed = Math.max(6, (Number(squad.stats?.speed) || 1) * 20 * moraleMul * fatigueMul * weightSlow * speedMul * (agent.moveSpeedMul || 1));

      const neighbors = querySpatialNearby(spatial, agent.x, agent.y, 12);
      const sep = computeTeamAwareSeparation(agent, neighbors, spacing * 0.94);
      const sepScale = stationaryHold
        ? (agent.isFlagBearer ? STATIONARY_FLAG_SEPARATION_SCALE : STATIONARY_SEPARATION_SCALE)
        : 1;
      let vx = (toDesired.x * speed) + (sep.x * 40 * sepScale);
      let vy = (toDesired.y * speed) + (sep.y * 40 * sepScale);
      if (stationaryHold && toDesired.len <= AGENT_IDLE_DEADZONE) {
        vx = 0;
        vy = 0;
      }
      const vLen = Math.hypot(vx, vy);
      const maxV = speed * 1.15;
      if (vLen > maxV) {
        vx = (vx / vLen) * maxV;
        vy = (vy / vLen) * maxV;
      }
      let nx = (Number(agent.x) || 0) + (vx * safeDt);
      let ny = (Number(agent.y) || 0) + (vy * safeDt);
      walls.forEach((wall) => {
        const pushed = pushOutOfRect({ x: nx, y: ny }, wall, (agent.radius || AGENT_RADIUS) + 0.5);
        nx = pushed.x;
        ny = pushed.y;
      });
      const halfW = (Number(sim?.field?.width) || 900) / 2;
      const halfH = (Number(sim?.field?.height) || 620) / 2;
      nx = clamp(nx, -halfW + 2, halfW - 2);
      ny = clamp(ny, -halfH + 2, halfH - 2);

      agent.vx = vx;
      agent.vy = vy;
      agent.x = nx;
      agent.y = ny;
      agent.hitTimer = Math.max(0, (Number(agent.hitTimer) || 0) - safeDt);
      if (Math.abs(vx) + Math.abs(vy) > 0.08) {
        agent.yaw = Math.atan2(vy, vx);
        agent.state = agent.attackCd > 0 ? 'attack' : 'move';
      } else {
        agent.state = agent.attackCd > 0 ? 'attack' : 'idle';
      }
    });

    if (squad.classTag === 'cavalry' && squad.skillRush) {
      applyCavalryRushImpact(sim, crowd, squad, sorted, rushFromPoint, {
        x: Number(squad.x) || 0,
        y: Number(squad.y) || 0
      });
    }

    trimOrGrowAgents(squad, agents, crowd, safeDt);
    aggregateSquadFromAgents(squad, crowd.agentsBySquad.get(squad.id) || []);
  });

  crowd.allAgents = [];
  crowd.agentsBySquad.forEach((agents) => crowd.allAgents.push(...agents.filter((agent) => !agent.dead)));
  updateCrowdCombat(sim, crowd, safeDt);
  stepEffectPool(crowd.effectsPool, safeDt);
  sim.projectiles = crowd.effectsPool.projectileLive;
  sim.hitEffects = crowd.effectsPool.hitLive;
};
