import {
  clamp,
  normalizeVec,
  estimateLocalFlowWidth,
  buildSpatialHash,
  querySpatialNearby,
  pushOutOfRect,
  raycastObstacles
} from './crowdPhysics';
import {
  createCombatEffectsPool,
  acquireProjectile,
  acquireHitEffect,
  stepEffectPool
} from '../effects/CombatEffects';
import { updateCrowdCombat } from './crowdCombat';
import { syncMeleeEngagement } from './engagement';
import itemInteractionSystem from '../items/ItemInteractionSystem';

const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const ORDER_IDLE = 'IDLE';
const ORDER_MOVE = 'MOVE';
const ORDER_ATTACK_MOVE = 'ATTACK_MOVE';
const ORDER_CHARGE = 'CHARGE';
const SPEED_MODE_B = 'B_HARMONIC';
const SPEED_MODE_C = 'C_PER_TYPE';
const SPEED_POLICY_MARCH = 'MARCH';
const SPEED_POLICY_RETREAT = 'RETREAT';
const SPEED_POLICY_REFORM = 'REFORM';
const STAMINA_MAX = 100;
const STAMINA_MOVE_THRESHOLD = 20;
const STAMINA_MOVE_COST = 8;
const STAMINA_RECOVER = 28;
const AGENT_RADIUS = 2.25;
const AGENT_GAP = 1.05;
const WEIGHT_BOTTLENECK_ALPHA = 0.035;
const MAX_AGENTS_PER_SQUAD = 4096;
const DEFAULT_MAX_AGENT_WEIGHT = 50;
const DEFAULT_DAMAGE_EXPONENT = 0.75;
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
const AGENT_MAX_ACCEL = 220;
const AGENT_REFORM_ACCEL = 260;
const AGENT_RETREAT_ACCEL = 280;
const AGENT_AVOID_PROBE = 10;
const FLAG_BACK_OFFSET = 0.72;
const LEADER_MAX_TURN_RATE = Math.PI * 1.9;
const LEADER_MAX_ACCEL = 120;
const LEADER_MAX_DECEL = 170;
const LEADER_ARRIVAL_RADIUS = 5.4;
const LEADER_SLOW_RADIUS = 38;
const LEADER_WAYPOINT_SLOW_RADIUS = 18;
const LEADER_WAYPOINT_MIN_SPEED_RATIO = 0.72;
const LEADER_FINAL_MIN_SPEED_RATIO = 0.08;
const OBSTACLE_AVOID_PROBE = 20;
const AVOID_SIDE_LOCK_SEC = 0.32;
const AVOID_KEY_GRID = 6;
const AGENT_SETTLE_RADIUS = 2.4;
const AGENT_SETTLE_DEADZONE = 1.08;
const AGENT_SETTLE_SPEED = 16;
const GROUND_SKILL_CONFIG = {
  archer: {
    radius: 72,
    waves: 4,
    intervalSec: 0.26,
    durationSec: 1.22,
    shotsPerWave: 12,
    cooldownSec: 8.6,
    impactRadius: 2.8,
    blastRadius: 0,
    blastFalloff: 0,
    wallDamageMul: 1,
    gravity: 70,
    speedHint: 226,
    damageMul: 2.05
  },
  artillery: {
    radius: 126,
    waves: 3,
    intervalSec: 0.46,
    durationSec: 1.65,
    shotsPerWave: 6,
    cooldownSec: 13.5,
    impactRadius: 4.8,
    blastRadius: 13.5,
    blastFalloff: 0.82,
    wallDamageMul: 1.85,
    gravity: 95,
    speedHint: 170,
    damageMul: 2.75
  }
};
const SKILL_COOLDOWN_BY_CLASS = {
  infantry: 2.1,
  cavalry: 2.8,
  archer: 8.6,
  artillery: 13.5
};
const DEFAULT_STEERING_WEIGHTS = {
  slot: 1,
  separation: 1,
  avoidance: 1,
  anchor: 1,
  pressure: 1,
  leaderAvoidance: 1,
  turnHz: 8.2,
  maxTurnRate: LEADER_MAX_TURN_RATE
};

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

const resolveVisibleAgentCount = (remain = 0, maxAgentWeight = DEFAULT_MAX_AGENT_WEIGHT, strictAgentMapping = false) => {
  const n = Math.max(1, Math.floor(Number(remain) || 0));
  const byWeight = Math.max(1, Math.ceil(n / Math.max(1, Number(maxAgentWeight) || DEFAULT_MAX_AGENT_WEIGHT)));
  if (strictAgentMapping) return byWeight;
  if (n <= 30) return n;
  if (n <= 300) return Math.max(byWeight, Math.min(MAX_AGENTS_PER_SQUAD, 30 + Math.floor((n - 30) / 6)));
  if (n <= 3000) return Math.max(byWeight, Math.min(MAX_AGENTS_PER_SQUAD, 75 + Math.floor((n - 300) / 60)));
  return Math.max(byWeight, Math.min(MAX_AGENTS_PER_SQUAD, 150 + Math.floor((n - 3000) / 120)));
};

const resolveRepConfig = (sim, crowd) => ({
  maxAgentWeight: Math.max(1, Number(crowd?.repConfig?.maxAgentWeight ?? sim?.repConfig?.maxAgentWeight) || DEFAULT_MAX_AGENT_WEIGHT),
  damageExponent: Math.max(0.2, Math.min(1.25, Number(crowd?.repConfig?.damageExponent ?? sim?.repConfig?.damageExponent) || DEFAULT_DAMAGE_EXPONENT)),
  strictAgentMapping: (crowd?.repConfig?.strictAgentMapping ?? sim?.repConfig?.strictAgentMapping) !== false
});

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
  const explicit = typeof unitType?.classTag === 'string' ? unitType.classTag.trim().toLowerCase() : '';
  if (explicit === 'infantry' || explicit === 'cavalry' || explicit === 'archer' || explicit === 'artillery') {
    return explicit;
  }
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

const resolveSquadForward = (squad = {}) => {
  const facing = Number(squad?.formationRect?.facingRad);
  if (Number.isFinite(facing)) {
    const dir = normalizeVec(Math.cos(facing), Math.sin(facing));
    if (dir.len > 1e-4) return { x: dir.x, y: dir.y };
  }
  return teamForward(squad?.team);
};

const skillRangeByClass = (classTag = '') => {
  if (classTag === 'cavalry') return 220;
  if (classTag === 'archer') return 260;
  if (classTag === 'artillery') return 310;
  return 180;
};

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

const ensureSquadActionState = (squad) => {
  if (!squad || typeof squad !== 'object') return { kind: 'none', ttl: 0, dur: 0, from: 'none', to: 'none' };
  if (!squad.actionState || typeof squad.actionState !== 'object') {
    squad.actionState = { kind: 'none', ttl: 0, dur: 0, from: 'none', to: 'none' };
  }
  if (typeof squad.actionState.kind !== 'string') squad.actionState.kind = 'none';
  if (!Number.isFinite(Number(squad.actionState.ttl))) squad.actionState.ttl = 0;
  if (!Number.isFinite(Number(squad.actionState.dur))) squad.actionState.dur = 0;
  return squad.actionState;
};

const ensureSquadStability = (squad) => {
  if (!squad || typeof squad !== 'object') return null;
  if (!squad.stability || typeof squad.stability !== 'object') {
    squad.stability = {
      poise: 100,
      poiseMax: 100,
      chargePoise: 140,
      chargePoiseCurrent: 140,
      transition: 90,
      transitionMax: 90,
      poiseRegenPerSec: 6.2,
      transitionDecayPerSec: 4.1,
      transitionRegenPerSec: 2.5
    };
  }
  const s = squad.stability;
  s.poiseMax = Math.max(10, Number(s.poiseMax) || 100);
  s.poise = clamp(Number(s.poise) || s.poiseMax, 0, s.poiseMax);
  s.chargePoise = Math.max(s.poiseMax, Number(s.chargePoise) || (s.poiseMax * 1.3));
  s.chargePoiseCurrent = clamp(Number(s.chargePoiseCurrent) || s.chargePoise, 0, s.chargePoise);
  s.transitionMax = Math.max(10, Number(s.transitionMax) || 90);
  s.transition = clamp(Number(s.transition) || s.transitionMax, 0, s.transitionMax);
  s.poiseRegenPerSec = Math.max(0.1, Number(s.poiseRegenPerSec) || 6.2);
  s.transitionDecayPerSec = Math.max(0.1, Number(s.transitionDecayPerSec) || 4.1);
  s.transitionRegenPerSec = Math.max(0.1, Number(s.transitionRegenPerSec) || 2.5);
  return s;
};

const resolveUnitTypeSpeed = (crowd, unitTypeId, fallback = 1) => {
  const unitType = crowd?.unitTypeMap?.get(unitTypeId) || null;
  const speed = Number(unitType?.speed);
  if (!Number.isFinite(speed) || speed <= 0.05) return Math.max(0.2, Number(fallback) || 1);
  return Math.max(0.2, speed);
};

const computeHarmonicGroupSpeed = (squad = {}, crowd = null) => {
  const units = normalizeUnitsMap(squad?.units || {});
  const entries = Object.entries(units).filter(([, count]) => count > 0);
  if (entries.length <= 0) return Math.max(0.2, Number(squad?.stats?.speed) || 1);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  let denom = 0;
  entries.forEach(([unitTypeId, count]) => {
    const w = count / Math.max(1, total);
    const v = resolveUnitTypeSpeed(crowd, unitTypeId, squad?.stats?.speed);
    denom += w / Math.max(0.05, v);
  });
  if (denom <= 1e-6) return Math.max(0.2, Number(squad?.stats?.speed) || 1);
  return Math.max(0.2, 1 / denom);
};

const computeRetreatGroupSpeed = (squad = {}, crowd = null) => {
  const units = normalizeUnitsMap(squad?.units || {});
  const entries = Object.entries(units).filter(([, count]) => count > 0);
  if (entries.length <= 0) return Math.max(0.2, Number(squad?.stats?.speed) || 1);
  let maxSpeed = 0;
  entries.forEach(([unitTypeId]) => {
    maxSpeed = Math.max(maxSpeed, resolveUnitTypeSpeed(crowd, unitTypeId, squad?.stats?.speed));
  });
  return Math.max(0.2, maxSpeed);
};

const resolveSquadOrderType = (squad = {}) => {
  const orderType = typeof squad?.order?.type === 'string' ? squad.order.type : '';
  if (orderType === ORDER_MOVE || orderType === ORDER_ATTACK_MOVE || orderType === ORDER_CHARGE) return orderType;
  return ORDER_IDLE;
};

const resolveSteeringWeights = (sim = null, crowd = null) => {
  let source = null;
  if (sim?.steeringWeights && typeof sim.steeringWeights === 'object') source = sim.steeringWeights;
  if (!source && crowd?.steeringWeights && typeof crowd.steeringWeights === 'object') source = crowd.steeringWeights;
  if (!source && typeof window !== 'undefined' && window?.__BATTLE_DEBUG__ && typeof window.__BATTLE_DEBUG__ === 'object') {
    source = window.__BATTLE_DEBUG__.steeringWeights || null;
  }
  const input = source && typeof source === 'object' ? source : {};
  return {
    slot: Math.max(0, Number(input.slot ?? DEFAULT_STEERING_WEIGHTS.slot) || DEFAULT_STEERING_WEIGHTS.slot),
    separation: Math.max(0, Number(input.separation ?? DEFAULT_STEERING_WEIGHTS.separation) || DEFAULT_STEERING_WEIGHTS.separation),
    avoidance: Math.max(0, Number(input.avoidance ?? DEFAULT_STEERING_WEIGHTS.avoidance) || DEFAULT_STEERING_WEIGHTS.avoidance),
    anchor: Math.max(0, Number(input.anchor ?? DEFAULT_STEERING_WEIGHTS.anchor) || DEFAULT_STEERING_WEIGHTS.anchor),
    pressure: Math.max(0, Number(input.pressure ?? DEFAULT_STEERING_WEIGHTS.pressure) || DEFAULT_STEERING_WEIGHTS.pressure),
    leaderAvoidance: Math.max(0, Number(input.leaderAvoidance ?? DEFAULT_STEERING_WEIGHTS.leaderAvoidance) || DEFAULT_STEERING_WEIGHTS.leaderAvoidance),
    turnHz: Math.max(0.2, Number(input.turnHz ?? DEFAULT_STEERING_WEIGHTS.turnHz) || DEFAULT_STEERING_WEIGHTS.turnHz),
    maxTurnRate: Math.max(0.2, Number(input.maxTurnRate ?? DEFAULT_STEERING_WEIGHTS.maxTurnRate) || DEFAULT_STEERING_WEIGHTS.maxTurnRate)
  };
};

const clampVecLength = (x, y, maxLen = 1) => {
  const len = Math.hypot(x, y);
  if (len <= maxLen || len <= 1e-6) return { x, y, len };
  return {
    x: (x / len) * maxLen,
    y: (y / len) * maxLen,
    len: maxLen
  };
};

const smoothstep01 = (value) => {
  const t = clamp(Number(value) || 0, 0, 1);
  return t * t * (3 - (2 * t));
};

const clearAvoidanceMemory = (subject) => {
  if (!subject) return;
  subject._avoidSide = 0;
  subject._avoidSideUntil = 0;
  subject._avoidObstacleKey = '';
};

const makeAvoidanceObstacleKey = (wall) => {
  if (!wall) return '';
  if (typeof wall.id === 'string' && wall.id) return `id:${wall.id}`;
  const snap = (value) => Math.round((Number(value) || 0) / AVOID_KEY_GRID);
  return [snap(wall.x), snap(wall.y), snap(wall.w), snap(wall.h)].join(':');
};

const computeAvoidanceDirection = (origin, desiredDir, walls = [], probe = OBSTACLE_AVOID_PROBE, subject = null, nowSec = 0) => {
  const dir = normalizeVec(desiredDir?.x || 0, desiredDir?.y || 0);
  if (dir.len <= 1e-4) {
    clearAvoidanceMemory(subject);
    return { x: 0, y: 0 };
  }
  const ahead = {
    x: (Number(origin?.x) || 0) + (dir.x * probe),
    y: (Number(origin?.y) || 0) + (dir.y * probe)
  };
  const hit = raycastObstacles(origin, ahead, walls, 1);
  if (!hit?.obstacle) {
    if ((Number(subject?._avoidSideUntil) || 0) <= nowSec) clearAvoidanceMemory(subject);
    return { x: 0, y: 0 };
  }
  const wall = hit.obstacle;
  const away = normalizeVec((Number(hit.x) || 0) - (Number(wall.x) || 0), (Number(hit.y) || 0) - (Number(wall.y) || 0));
  const tangentA = { x: -away.y, y: away.x };
  const tangentB = { x: away.y, y: -away.x };
  const dotA = (tangentA.x * dir.x) + (tangentA.y * dir.y);
  const dotB = (tangentB.x * dir.x) + (tangentB.y * dir.y);
  const obstacleKey = makeAvoidanceObstacleKey(wall);
  let side = dotA >= dotB ? 1 : -1;
  if (subject) {
    const sameObstacle = obstacleKey && subject._avoidObstacleKey === obstacleKey;
    const stickyActive = sameObstacle && (Number(subject._avoidSide) || 0) !== 0 && (Number(subject._avoidSideUntil) || 0) > nowSec;
    if (stickyActive) side = Number(subject._avoidSide) || side;
    subject._avoidSide = side;
    subject._avoidSideUntil = nowSec + AVOID_SIDE_LOCK_SEC;
    subject._avoidObstacleKey = obstacleKey;
  }
  const pick = side >= 0 ? tangentA : tangentB;
  return { x: pick.x, y: pick.y };
};

const isMeleeAgent = (agent) => {
  const category = typeof agent?.typeCategory === 'string' ? agent.typeCategory : '';
  return category !== 'archer' && category !== 'artillery';
};

const computeTeamAwareSeparation = (agent, neighbors = [], sameTeamGap = 5.2) => {
  if (agent?.isFlagBearer) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  neighbors.forEach((other) => {
    if (!other || other.id === agent.id || other.dead || other.isFlagBearer) return;
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

const pointInPolygon = (point, polygon = []) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = Number(polygon[i]?.x) || 0;
    const yi = Number(polygon[i]?.y) || 0;
    const xj = Number(polygon[j]?.x) || 0;
    const yj = Number(polygon[j]?.y) || 0;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < (((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9)) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
};

const samplePointInCircle = (center, radius) => {
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * Math.max(0, Number(radius) || 0);
  return {
    x: (Number(center?.x) || 0) + (Math.cos(theta) * r),
    y: (Number(center?.y) || 0) + (Math.sin(theta) * r)
  };
};

const samplePointInTargetArea = (targetSpec = {}) => {
  const center = {
    x: Number(targetSpec?.x) || 0,
    y: Number(targetSpec?.y) || 0
  };
  const radius = Math.max(1, Number(targetSpec?.radius) || 1);
  const clipPolygon = Array.isArray(targetSpec?.clipPolygon) ? targetSpec.clipPolygon : [];
  if (clipPolygon.length < 3) {
    return samplePointInCircle(center, radius);
  }
  for (let i = 0; i < 6; i += 1) {
    const sampled = samplePointInCircle(center, radius);
    if (pointInPolygon(sampled, clipPolygon)) {
      return sampled;
    }
  }
  return center;
};

const clipGroundPointByWalls = (origin, target, walls = []) => {
  const hit = raycastObstacles(origin, target, walls, 0.8);
  if (!hit) {
    return {
      x: Number(target?.x) || 0,
      y: Number(target?.y) || 0,
      blockedByWall: false
    };
  }
  const dx = (Number(target?.x) || 0) - (Number(origin?.x) || 0);
  const dy = (Number(target?.y) || 0) - (Number(origin?.y) || 0);
  const dist = Math.hypot(dx, dy) || 1;
  const backStep = Math.min(2.4, dist * 0.08);
  const keepT = clamp(hit.t - (backStep / dist), 0, 1);
  return {
    x: (Number(origin?.x) || 0) + (dx * keepT),
    y: (Number(origin?.y) || 0) + (dy * keepT),
    blockedByWall: true
  };
};

const normalizeGroundSkillTargetSpec = (sim, squad, classTag, targetInput = {}) => {
  const fallback = GROUND_SKILL_CONFIG[classTag] || GROUND_SKILL_CONFIG.archer;
  const sourceX = Number(squad?.x) || 0;
  const sourceY = Number(squad?.y) || 0;
  const inputX = Number(targetInput?.x);
  const inputY = Number(targetInput?.y);
  const inputMaxRange = Number(targetInput?.maxRange);
  const rawX = Number.isFinite(inputX) ? inputX : sourceX;
  const rawY = Number.isFinite(inputY) ? inputY : sourceY;
  const maxRange = Math.max(8, Number.isFinite(inputMaxRange) ? inputMaxRange : skillRangeByClass(classTag));
  const vec = normalizeVec(rawX - sourceX, rawY - sourceY);
  const range = Math.min(maxRange, vec.len || 0);
  const clampedTarget = {
    x: sourceX + (vec.x * range),
    y: sourceY + (vec.y * range)
  };
  const walls = Array.isArray(sim?.buildings) ? sim.buildings.filter((wall) => !wall?.destroyed) : [];
  const uiHasClipPolygon = Array.isArray(targetInput?.clipPolygon) && targetInput.clipPolygon.length >= 3;
  const clippedCenter = uiHasClipPolygon
    ? {
      x: clampedTarget.x,
      y: clampedTarget.y,
      blockedByWall: !!targetInput?.blockedByWall
    }
    : clipGroundPointByWalls(
      { x: sourceX, y: sourceY },
      clampedTarget,
      walls
    );
  const inputRadius = Number(targetInput?.radius);
  const radius = Math.max(
    8,
    Number.isFinite(inputRadius) && inputRadius > 0 ? inputRadius : fallback.radius
  );
  const clipPolygon = Array.isArray(targetInput?.clipPolygon)
    ? targetInput.clipPolygon.map((row) => ({ x: Number(row?.x) || 0, y: Number(row?.y) || 0 }))
    : [];
  return {
    kind: 'ground_aoe',
    x: clippedCenter.x,
    y: clippedCenter.y,
    radius,
    maxRange,
    clipPolygon,
    blockedByWall: !!targetInput?.blockedByWall || clippedCenter.blockedByWall
  };
};

const solveBallisticVelocity = (source, target, gravity = 70, speedHint = 220) => {
  const sx = Number(source?.x) || 0;
  const sy = Number(source?.y) || 0;
  const sz = Number(source?.z) || 0;
  const tx = Number(target?.x) || sx;
  const ty = Number(target?.y) || sy;
  const dist = Math.hypot(tx - sx, ty - sy);
  const safeSpeed = Math.max(40, Number(speedHint) || 220);
  const flightSec = clamp(dist / safeSpeed, 0.42, 1.35);
  const vx = (tx - sx) / Math.max(0.08, flightSec);
  const vy = (ty - sy) / Math.max(0.08, flightSec);
  const g = Math.max(1, Number(gravity) || 70);
  const vz = ((0.5 * g * (flightSec ** 2)) - sz) / Math.max(0.08, flightSec);
  return {
    vx,
    vy,
    vz,
    gravity: g,
    flightSec
  };
};

const emitGroundSkillWave = (sim, crowd, squad, activeSkill, waveIndex = 0) => {
  if (!sim || !crowd || !squad || !activeSkill) return 0;
  const agents = getCrowdAgentsForSquad(crowd, squad.id);
  if (agents.length <= 0) return 0;
  const classTag = activeSkill?.classTag === 'artillery' ? 'artillery' : 'archer';
  const config = activeSkill.config || GROUND_SKILL_CONFIG[classTag];
  const targetSpec = activeSkill.targetSpec || {};
  const rankedShooters = [...agents]
    .filter((agent) => !agent.dead)
    .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0));
  const shooterCount = classTag === 'artillery'
    ? Math.max(2, Math.min(6, Math.floor(Math.sqrt(rankedShooters.length)) + 1))
    : Math.max(3, Math.min(14, Math.floor(Math.sqrt(rankedShooters.length)) + 3));
  const shooters = rankedShooters.slice(0, shooterCount);
  if (shooters.length <= 0) return 0;

  const shotsPerWaveCap = Math.max(1, Math.floor(Number(config?.shotsPerWave) || (classTag === 'artillery' ? 6 : 12)));
  const shooterWeightSum = shooters.reduce((sum, shooter) => sum + Math.max(0.1, Number(shooter?.weight) || 0.1), 0);
  const shotWeightRef = classTag === 'artillery' ? 18 : 24;
  const shotScale = clamp(shooterWeightSum / shotWeightRef, 0.12, 1);
  const scaledShotBudget = Math.max(1, Math.round(shotsPerWaveCap * shotScale));
  const floorByShooters = classTag === 'artillery'
    ? Math.max(1, Math.ceil(shooters.length * 0.5))
    : Math.max(1, Math.ceil(shooters.length * 0.8));
  const totalShots = Math.max(
    1,
    Math.min(
      shotsPerWaveCap,
      Math.max(floorByShooters, scaledShotBudget)
    )
  );
  const enemyTeam = squad.team === TEAM_ATTACKER ? TEAM_DEFENDER : TEAM_ATTACKER;
  let fired = 0;
  for (let shotIndex = 0; shotIndex < totalShots; shotIndex += 1) {
    const shooter = shooters[shotIndex % shooters.length];
    if (!shooter || shooter.dead) continue;
    const landing = samplePointInTargetArea(targetSpec);
    const sourceZ = classTag === 'artillery' ? 6 : 4.2;
    const ballistic = solveBallisticVelocity(
      { x: shooter.x, y: shooter.y, z: sourceZ },
      landing,
      Number(config?.gravity) || 70,
      Number(config?.speedHint) || 220
    );
    const repConfig = resolveRepConfig(sim, crowd);
    const weightMul = Math.max(1, Math.pow(Math.max(1, Number(shooter.weight) || 1), repConfig.damageExponent));
    const damageBase = Math.max(0.22, (Number(squad.stats?.atk) || 10) * (classTag === 'artillery' ? 0.11 : 0.065));
    const damage = damageBase * weightMul * Math.max(1, Number(config?.damageMul) || 1);
    acquireProjectile(crowd.effectsPool, {
      type: classTag === 'artillery' ? 'shell' : 'arrow',
      team: squad.team,
      squadId: squad.id,
      sourceAgentId: shooter.id,
      x: shooter.x,
      y: shooter.y,
      z: sourceZ,
      vx: ballistic.vx,
      vy: ballistic.vy,
      vz: ballistic.vz,
      gravity: ballistic.gravity,
      damage,
      radius: classTag === 'artillery' ? 4.9 : 2.3,
      impactRadius: Math.max(0.8, Number(config?.impactRadius) || 2.2),
      blastRadius: Math.max(0, Number(config?.blastRadius) || 0),
      blastFalloff: Math.max(0, Number(config?.blastFalloff) || 0),
      wallDamageMul: Math.max(0.1, Number(config?.wallDamageMul) || 1),
      ttl: Math.max(0.2, (Number(ballistic.flightSec) || 0.8) + (classTag === 'artillery' ? 0.35 : 0.2)),
      targetTeam: enemyTeam,
      targetCenterX: Number(targetSpec?.x) || 0,
      targetCenterY: Number(targetSpec?.y) || 0,
      targetRadius: Math.max(0, Number(targetSpec?.radius) || 0),
      targetShape: 'ground_aoe',
      blockedByWall: !!targetSpec?.blockedByWall,
      skillId: activeSkill.id,
      skillClass: classTag,
      waveIndex: waveIndex + 1,
      maxHits: classTag === 'artillery' ? 999 : 1
    });
    fired += 1;
  }
  if (fired > 0) {
    acquireHitEffect(crowd.effectsPool, {
      type: classTag === 'artillery' ? 'explosion' : 'hit',
      x: Number(targetSpec?.x) || 0,
      y: Number(targetSpec?.y) || 0,
      z: 1.1,
      radius: Math.max(2, Number(targetSpec?.radius) || 8),
      ttl: classTag === 'artillery' ? 0.42 : 0.3,
      team: squad.team
    });
  }
  return fired;
};

const updateActiveGroundSkill = (sim, crowd, squad, dt) => {
  const active = squad?.activeSkill;
  if (!active) return;
  if ((Number(squad?.remain) || 0) <= 0 || (Number(squad?.morale) || 0) <= 0) {
    squad.activeSkill = null;
    return;
  }
  active.ttlSec = Math.max(0, (Number(active.ttlSec) || 0) - dt);
  active.nextWaveSec = (Number(active.nextWaveSec) || 0) - dt;
  while (active.wavesFired < active.wavesTotal && active.nextWaveSec <= 0 && active.ttlSec > 0) {
    emitGroundSkillWave(sim, crowd, squad, active, active.wavesFired);
    active.wavesFired += 1;
    active.nextWaveSec += Math.max(0.05, Number(active.intervalSec) || 0.2);
  }
  squad.action = '兵种攻击';
  if (active.ttlSec <= 0 || active.wavesFired >= active.wavesTotal) {
    squad.activeSkill = null;
    if (squad.actionState && squad.actionState.kind === 'skill') {
      squad.actionState = { kind: 'none', from: 'none', to: 'none', ttl: 0, dur: 0 };
    }
  }
};

const isEnemyHiddenForViewer = (enemySquad = {}, viewerTeam = TEAM_ATTACKER) => {
  if (viewerTeam === TEAM_ATTACKER) return !!enemySquad?.hiddenFromAttacker;
  if (viewerTeam === TEAM_DEFENDER) return !!enemySquad?.hiddenFromDefender;
  return false;
};

const pickNearestEnemySquad = (squad, squads = []) => {
  const enemyTeam = squad?.team === TEAM_ATTACKER ? TEAM_DEFENDER : TEAM_ATTACKER;
  let best = null;
  let bestDist = Infinity;
  squads.forEach((row) => {
    if (!row || row.team !== enemyTeam || row.remain <= 0) return;
    if (isEnemyHiddenForViewer(row, squad?.team)) return;
    const dist = Math.hypot((row.x || 0) - (squad.x || 0), (row.y || 0) - (squad.y || 0));
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  });
  return best;
};

const updateSquadBehaviorPlan = (squad, sim, nowSec = 0) => {
  if (!squad || squad.remain <= 0) return;
  const actionState = ensureSquadActionState(squad);
  if (actionState.kind === 'stagger' && (Number(actionState.ttl) || 0) > 0) {
    squad.waypoints = [];
    squad.targetSquadId = '';
    squad.action = '硬直';
    return;
  }
  if (actionState.kind === 'transition' && (Number(actionState.ttl) || 0) > 0) {
    squad.action = '调整队形';
    return;
  }
  const orderType = resolveSquadOrderType(squad);
  const chargeCommitted = orderType === ORDER_CHARGE && (Number(squad?.order?.commitUntil) || 0) > nowSec;
  if (orderType === ORDER_MOVE) {
    if (!Array.isArray(squad.waypoints)) squad.waypoints = [];
    squad.action = squad.waypoints.length > 0 ? '移动' : '待命';
    return;
  }
  if (chargeCommitted) {
    squad.action = '冲锋';
    return;
  }
  if ((Number(squad?.skillRush?.ttl) || 0) > 0) {
    squad.action = '兵种攻击';
    return;
  }
  if (!Array.isArray(squad.waypoints)) squad.waypoints = [];
  const fieldWidth = Number(sim?.field?.width) || 2700;
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

  const guard = squad?.guard && squad.guard.enabled ? squad.guard : null;
  if (guard) {
    const gcx = Number(guard.cx) || (Number(squad.x) || 0);
    const gcy = Number(guard.cy) || (Number(squad.y) || 0);
    const guardRadius = Math.max(12, Number(guard.radius) || 48);
    const returnRadius = Math.max(8, Number(guard.returnRadius) || (guardRadius * 0.36));
    const chaseRadius = Math.max(guardRadius + 10, Number(guard.chaseRadius) || (guardRadius * 1.45));
    let guardEnemy = null;
    if (squad.targetSquadId) {
      const squads = Array.isArray(sim?.squads) ? sim.squads : [];
      for (let i = 0; i < squads.length; i += 1) {
        const row = squads[i];
        if (!row || row.id !== squad.targetSquadId || row.remain <= 0) continue;
        guardEnemy = row;
        break;
      }
    }
    if (!guardEnemy) {
      guardEnemy = pickNearestEnemySquad({ x: gcx, y: gcy, team: squad.team }, sim?.squads || []);
    }
    const enemyDist = guardEnemy
      ? Math.hypot((Number(guardEnemy.x) || 0) - gcx, (Number(guardEnemy.y) || 0) - gcy)
      : Infinity;
    const toCenter = Math.hypot((Number(squad.x) || 0) - gcx, (Number(squad.y) || 0) - gcy);
    const isRangedGuard = squad.classTag === 'archer'
      || squad.classTag === 'artillery'
      || squad.roleTag === '远程'
      || (Number(squad?.stats?.range) || 0) >= 2.2;

    if (guardEnemy && enemyDist <= guardRadius) {
      guard.activeTargetId = guardEnemy.id;
    } else if (guardEnemy && guard.activeTargetId === guardEnemy.id && enemyDist <= chaseRadius) {
      // keep tracking locked target inside chase radius
    } else {
      guard.activeTargetId = '';
    }

    if (isRangedGuard) {
      squad.targetSquadId = guardEnemy && enemyDist <= guardRadius ? guardEnemy.id : '';
      if (toCenter > returnRadius) {
        squad.waypoints = [{ x: gcx, y: gcy }];
      } else {
        squad.waypoints = [];
      }
      squad.action = squad.targetSquadId ? '自由攻击' : '警戒';
      return;
    }

    if (guard.activeTargetId) {
      let locked = null;
      const squads = Array.isArray(sim?.squads) ? sim.squads : [];
      for (let i = 0; i < squads.length; i += 1) {
        const row = squads[i];
        if (!row || row.id !== guard.activeTargetId || row.remain <= 0) continue;
        locked = row;
        break;
      }
      if (locked) {
        const lockDistToCenter = Math.hypot((Number(locked.x) || 0) - gcx, (Number(locked.y) || 0) - gcy);
        if (lockDistToCenter <= chaseRadius) {
          squad.targetSquadId = locked.id;
          squad.waypoints = [{ x: Number(locked.x) || 0, y: Number(locked.y) || 0 }];
          squad.action = '自由攻击';
          return;
        }
      }
      guard.activeTargetId = '';
    }

    squad.targetSquadId = '';
    if (toCenter > returnRadius) {
      squad.waypoints = [{ x: gcx, y: gcy }];
      squad.action = '回位';
    } else {
      squad.waypoints = [];
      squad.action = '警戒';
    }
    return;
  }

  if (squad.behavior === 'standby') {
    squad.targetSquadId = '';
    squad.waypoints = [];
    squad.action = '待命';
    return;
  }

  if (squad.behavior === 'idle') {
    squad.targetSquadId = '';
    squad.waypoints = [];
    squad.action = '待命';
    return;
  }

  const playerExplicitOnly = squad.team === TEAM_ATTACKER && !guard && orderType !== ORDER_ATTACK_MOVE && !chargeCommitted;
  if (playerExplicitOnly && !hasWaypoint) {
    squad.targetSquadId = '';
    squad.action = squad.behavior === 'defend' ? '防御' : '待命';
    return;
  }

  if (!nearestEnemy) {
    if (!hasWaypoint) {
      squad.action = squad.behavior === 'defend' ? '防御' : (orderType === ORDER_ATTACK_MOVE ? '攻击前进' : '待命');
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
    squad.action = orderType === ORDER_ATTACK_MOVE ? '攻击前进' : '移动';
  } else if (isRanged && dist < desired * 0.72 && !hasWaypoint) {
    const backX = (squad.x || 0) - (dirX * 26);
    const backY = (squad.y || 0) - (dirY * 26);
    squad.waypoints = [{ x: backX, y: backY }];
    squad.action = orderType === ORDER_ATTACK_MOVE ? '攻击前进' : '移动';
  } else if (!hasWaypoint) {
    squad.action = squad.behavior === 'defend' ? '防御' : (orderType === ORDER_ATTACK_MOVE ? '攻击前进' : '普通攻击');
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
  const repConfig = resolveRepConfig(null, crowd);
  const minRequiredByType = Object.fromEntries(
    Object.entries(countsByType).map(([unitTypeId, count]) => [
      unitTypeId,
      Math.max(1, Math.ceil(count / Math.max(1, repConfig.maxAgentWeight)))
    ])
  );
  const minRequired = Object.values(minRequiredByType).reduce((sum, c) => sum + c, 0);
  const agentBudget = Math.max(
    minRequired,
    resolveVisibleAgentCount(remain, repConfig.maxAgentWeight, repConfig.strictAgentMapping)
  );
  const alloc = repConfig.strictAgentMapping
    ? { ...minRequiredByType }
    : hamiltonAllocate(countsByType, agentBudget);
  const agents = [];
  const allocTotal = Math.max(1, Object.values(alloc).reduce((sum, c) => sum + c, 0));
  const formationRect = squad?.formationRect && typeof squad.formationRect === 'object' ? squad.formationRect : null;
  const formationSpacing = Math.max(0.1, Number(formationRect?.spacing) || ((AGENT_RADIUS * 2) + AGENT_GAP));
  const hintedCols = formationRect
    ? Math.max(1, Math.round(Math.max(1, Number(formationRect.width) || 1) / formationSpacing))
    : 0;
  const baseCols = Math.max(1, hintedCols || Math.ceil(Math.sqrt(allocTotal)));
  const forwardVec = resolveSquadForward(squad);
  const sideVec = { x: -forwardVec.y, y: forwardVec.x };
  const deploySlots = Array.isArray(squad?.deploySlots)
    ? squad.deploySlots.map((slot) => ({
      side: Number(slot?.side) || 0,
      front: Number(slot?.front) || 0
    }))
    : [];

  const resolveSpawnPoint = (slotOrder, fallbackOffset) => {
    if (deploySlots[slotOrder]) {
      const slot = deploySlots[slotOrder];
      return {
        x: (Number(squad.x) || 0) + (sideVec.x * slot.side) + (forwardVec.x * slot.front),
        y: (Number(squad.y) || 0) + (sideVec.y * slot.side) + (forwardVec.y * slot.front)
      };
    }
    return {
      x: (Number(squad.x) || 0) - fallbackOffset.back,
      y: (Number(squad.y) || 0) + fallbackOffset.side
    };
  };

  let slotOrder = 0;
  Object.entries(alloc).forEach(([unitTypeId, count]) => {
    const safeCount = Math.max(1, count);
    const perAgentWeight = Math.min(
      Math.max(0.2, (countsByType[unitTypeId] || 1) / safeCount),
      repConfig.maxAgentWeight
    );
    const unitType = unitMap.get(unitTypeId) || {};
    const category = inferCategoryFromUnitType(unitType, squad?.classTag || 'infantry');
    const moveSpeedMul = resolveAgentSpeedMul(unitType, category);
    for (let i = 0; i < safeCount; i += 1) {
      const offset = slotOffsetForIndex(slotOrder, baseCols);
      const spawnPoint = resolveSpawnPoint(slotOrder, offset);
      agents.push(createAgent({
        id: `${squad.id}_ag_${slotOrder + 1}`,
        squadId: squad.id,
        team: squad.team,
        unitTypeId,
        category,
        x: spawnPoint.x,
        y: spawnPoint.y,
        weight: perAgentWeight,
        slotOrder,
        moveSpeedMul
      }));
      slotOrder += 1;
    }
  });
  if (agents.length <= 0) {
    const repConfig = resolveRepConfig(null, crowd);
    agents.push(createAgent({
      id: `${squad.id}_ag_1`,
      squadId: squad.id,
      team: squad.team,
      unitTypeId: '__fallback__',
      category: squad?.classTag || 'infantry',
      x: Number(squad.x) || 0,
      y: Number(squad.y) || 0,
      weight: Math.min(remain, repConfig.maxAgentWeight),
      slotOrder: 0,
      moveSpeedMul: resolveAgentSpeedMul({}, squad?.classTag || 'infantry')
    }));
  }
  squad._repMaxAgentWeight = repConfig.maxAgentWeight;
  squad._crowdBaseColumns = Math.max(1, hintedCols || Math.ceil(Math.sqrt(agents.length)));
  squad._crowdForward = { x: forwardVec.x, y: forwardVec.y };
  ensureFlagBearer(squad, agents);
  return agents;
};

const leaderMoveStep = (squad, sim, crowd, dt, forwardVec, steeringWeights = DEFAULT_STEERING_WEIGHTS) => {
  const actionState = ensureSquadActionState(squad);
  const actionKind = typeof actionState.kind === 'string' ? actionState.kind : 'none';
  const moralePenalty = squad.morale <= 0 ? (2 / 3) : (squad.morale < 20 ? 0.82 : 1);
  const fatiguePenalty = squad.fatigueTimer > 0 ? 0.72 : 1;
  const buffSpeed = squad.effectBuff?.speedMul ? Number(squad.effectBuff.speedMul) : 1;
  const rushSpeed = squad.skillRush?.ttl > 0 ? 1.45 : 1;
  const speedMode = squad.speedMode === SPEED_MODE_C ? SPEED_MODE_C : SPEED_MODE_B;
  const speedPolicy = typeof squad.speedPolicy === 'string' ? squad.speedPolicy : SPEED_POLICY_MARCH;
  const orderType = resolveSquadOrderType(squad);
  const nowSec = Number(sim?.timeElapsed) || 0;
  const chargingCommitted = orderType === ORDER_CHARGE && (Number(squad?.order?.commitUntil) || 0) > nowSec;
  const baseGroupSpeed = speedMode === SPEED_MODE_C
    ? computeRetreatGroupSpeed(squad, crowd)
    : computeHarmonicGroupSpeed(squad, crowd);
  const policyMul = speedPolicy === SPEED_POLICY_RETREAT
    ? 1.08
    : (speedPolicy === SPEED_POLICY_REFORM ? 0.82 : 1);
  const speedBase = Math.max(9, baseGroupSpeed * 18);
  const speedTargetMax = speedBase * moralePenalty * fatiguePenalty * buffSpeed * rushSpeed * policyMul * (chargingCommitted ? 1.15 : 1);
  const walls = Array.isArray(sim?.buildings) ? sim.buildings.filter((row) => !row?.destroyed) : [];
  let target = null;
  const activeSkillClass = typeof squad?.activeSkill?.classTag === 'string' ? squad.activeSkill.classTag : '';
  const lockRangedSkill = activeSkillClass === 'archer' || activeSkillClass === 'artillery';

  if (squad.skillRush?.ttl > 0) {
    const remainDistance = Math.max(0, Number(squad.skillRush.remainDistance) || 0);
    if (remainDistance <= 0.01) {
      squad.skillRush = null;
      squad.behavior = 'auto';
      if (squad.actionState && squad.actionState.kind === 'charge') {
        squad.actionState = { kind: 'none', from: 'none', to: 'none', ttl: 0, dur: 0 };
      }
      squad.action = '自动攻击';
      return forwardVec;
    }
    target = {
      x: (Number(squad.x) || 0) + ((squad.skillRush.dirX || 0) * remainDistance),
      y: (Number(squad.y) || 0) + ((squad.skillRush.dirY || 0) * remainDistance)
    };
    squad.skillRush.ttl = Math.max(0, squad.skillRush.ttl - dt);
  } else if (lockRangedSkill) {
    target = null;
    squad.waypoints = [];
  } else if (Array.isArray(squad.waypoints) && squad.waypoints.length > 0) {
    target = squad.waypoints[0];
  }

  let currentSpeed = Math.max(0, Number(squad.speed) || 0);
  let dir = normalizeVec(Number(squad.dirX) || Number(forwardVec?.x) || 1, Number(squad.dirY) || Number(forwardVec?.y) || 0);
  if (dir.len <= 1e-4) dir = normalizeVec(Number(forwardVec?.x) || 1, Number(forwardVec?.y) || 0);
  let desiredSpeed = 0;
  let desiredDir = { x: dir.x, y: dir.y };

  if (actionKind === 'stagger') {
    desiredSpeed = 0;
    squad.waypoints = [];
    squad.stamina = clamp((Number(squad.stamina) || 0) + (STAMINA_RECOVER * dt * 0.25), 0, STAMINA_MAX);
  } else if (actionKind === 'transition') {
    desiredSpeed = Math.min(speedTargetMax * 0.32, desiredSpeed);
    squad.stamina = clamp((Number(squad.stamina) || 0) + (STAMINA_RECOVER * dt * 0.15), 0, STAMINA_MAX);
  } else if (lockRangedSkill) {
    desiredSpeed = 0;
    squad.stamina = clamp((Number(squad.stamina) || 0) + (STAMINA_RECOVER * dt * 0.5), 0, STAMINA_MAX);
  } else if (target && (Number(squad.stamina) || 0) >= STAMINA_MOVE_THRESHOLD) {
    const toTarget = normalizeVec((Number(target.x) || 0) - (Number(squad.x) || 0), (Number(target.y) || 0) - (Number(squad.y) || 0));
    if (toTarget.len <= LEADER_ARRIVAL_RADIUS) {
      if (Array.isArray(squad.waypoints) && squad.waypoints.length > 0) squad.waypoints.shift();
      if ((resolveSquadOrderType(squad) === ORDER_MOVE || resolveSquadOrderType(squad) === ORDER_CHARGE) && (!squad.waypoints || squad.waypoints.length <= 0)) {
        squad.behavior = 'idle';
        squad.targetSquadId = '';
        squad.action = '待命';
        squad.order = { type: ORDER_IDLE, issuedAt: nowSec, commitUntil: 0, targetPoint: null, targetSquadId: '' };
      }
    } else {
      const avoid = computeAvoidanceDirection({ x: squad.x, y: squad.y }, toTarget, walls, OBSTACLE_AVOID_PROBE);
      const avoidWeight = Math.max(0, Number(steeringWeights?.leaderAvoidance) || DEFAULT_STEERING_WEIGHTS.leaderAvoidance);
      const rawDesired = normalizeVec(toTarget.x + (avoid.x * 0.68 * avoidWeight), toTarget.y + (avoid.y * 0.68 * avoidWeight));
      const prevSmooth = normalizeVec(Number(squad.smoothedDirX) || dir.x, Number(squad.smoothedDirY) || dir.y);
      const blendK = 1 - Math.exp(-Math.max(0, dt) * Math.max(0.2, Number(steeringWeights?.turnHz) || DEFAULT_STEERING_WEIGHTS.turnHz));
      const smooth = normalizeVec(
        prevSmooth.x + ((rawDesired.x - prevSmooth.x) * blendK),
        prevSmooth.y + ((rawDesired.y - prevSmooth.y) * blendK)
      );
      desiredDir = smooth;
      squad.smoothedDirX = desiredDir.x;
      squad.smoothedDirY = desiredDir.y;
      const hasMoreWaypoints = Array.isArray(squad.waypoints) && squad.waypoints.length > 1;
      const slowRadius = hasMoreWaypoints ? LEADER_WAYPOINT_SLOW_RADIUS : LEADER_SLOW_RADIUS;
      const arrivalT = clamp((toTarget.len - LEADER_ARRIVAL_RADIUS) / Math.max(1, slowRadius - LEADER_ARRIVAL_RADIUS), 0, 1);
      const easedArrival = smoothstep01(arrivalT);
      const minSpeedRatio = hasMoreWaypoints ? LEADER_WAYPOINT_MIN_SPEED_RATIO : LEADER_FINAL_MIN_SPEED_RATIO;
      const arrivalRate = minSpeedRatio + ((1 - minSpeedRatio) * easedArrival);
      desiredSpeed = Math.min(speedTargetMax, speedTargetMax * arrivalRate);
    }
    squad.stamina = clamp((Number(squad.stamina) || 0) - (STAMINA_MOVE_COST * dt), 0, STAMINA_MAX);
  } else {
    desiredSpeed = 0;
    squad.stamina = clamp((Number(squad.stamina) || 0) + (STAMINA_RECOVER * dt), 0, STAMINA_MAX);
    if (!target && squad.behavior === 'move' && resolveSquadOrderType(squad) === ORDER_MOVE) {
      squad.action = '待命';
    }
  }

  const dot = clamp((dir.x * desiredDir.x) + (dir.y * desiredDir.y), -1, 1);
  const angle = Math.acos(dot);
  if (angle > 1e-4) {
    const cross = (dir.x * desiredDir.y) - (dir.y * desiredDir.x);
    const sign = cross >= 0 ? 1 : -1;
    const maxTurnRate = Math.max(0.2, Number(steeringWeights?.maxTurnRate) || LEADER_MAX_TURN_RATE);
    const stepTurn = Math.min(angle, maxTurnRate * dt) * sign;
    const cosT = Math.cos(stepTurn);
    const sinT = Math.sin(stepTurn);
    const nextDir = normalizeVec((dir.x * cosT) - (dir.y * sinT), (dir.x * sinT) + (dir.y * cosT));
    dir = { x: nextDir.x, y: nextDir.y };
  }

  const accel = desiredSpeed >= currentSpeed ? LEADER_MAX_ACCEL : LEADER_MAX_DECEL;
  const maxDv = accel * dt;
  const dv = clamp(desiredSpeed - currentSpeed, -maxDv, maxDv);
  currentSpeed = Math.max(0, currentSpeed + dv);
  const prevX = Number(squad.x) || 0;
  const prevY = Number(squad.y) || 0;
  let nx = prevX + (dir.x * currentSpeed * dt);
  let ny = prevY + (dir.y * currentSpeed * dt);
  const halfW = (Number(sim?.field?.width) || 2700) / 2;
  const halfH = (Number(sim?.field?.height) || 1488) / 2;
  nx = clamp(nx, -halfW + 4, halfW - 4);
  ny = clamp(ny, -halfH + 4, halfH - 4);
  let pushNx = 0;
  let pushNy = 0;
  walls.forEach((wall) => {
    const beforeX = nx;
    const beforeY = ny;
    const pushed = pushOutOfRect({ x: nx, y: ny }, wall, AGENT_RADIUS + 1.8);
    nx = pushed.x;
    ny = pushed.y;
    if (pushed?.pushed) {
      const corr = normalizeVec(nx - beforeX, ny - beforeY);
      if (corr.len > 1e-4) {
        pushNx += corr.x;
        pushNy += corr.y;
      }
    }
  });
  const movedX = nx - prevX;
  const movedY = ny - prevY;
  squad.x = nx;
  squad.y = ny;
  squad.vx = movedX / Math.max(1e-4, dt);
  squad.vy = movedY / Math.max(1e-4, dt);
  const pushN = normalizeVec(pushNx, pushNy);
  if (pushN.len > 1e-4) {
    const vn = (squad.vx * pushN.x) + (squad.vy * pushN.y);
    if (vn > 0) {
      const keep = vn * 0.2;
      const remove = vn - keep;
      squad.vx -= pushN.x * remove;
      squad.vy -= pushN.y * remove;
    }
  }
  squad.speed = Math.hypot(squad.vx, squad.vy);
  squad.dirX = dir.x;
  squad.dirY = dir.y;

  if (squad.skillRush?.ttl > 0) {
    const moved = Math.hypot(movedX, movedY);
    squad.skillRush.remainDistance = Math.max(0, (Number(squad.skillRush.remainDistance) || 0) - moved);
    if (squad.skillRush.ttl <= 0 || squad.skillRush.remainDistance <= 0.8) {
      squad.skillRush = null;
      squad.behavior = 'auto';
      if (squad.actionState && squad.actionState.kind === 'charge') {
        squad.actionState = { kind: 'none', from: 'none', to: 'none', ttl: 0, dur: 0 };
      }
      squad.action = '自动攻击';
    } else {
      squad.action = '兵种攻击';
    }
  } else if (chargingCommitted) {
    squad.action = '冲锋';
  }

  if ((Number(squad.stamina) || 0) < STAMINA_MOVE_THRESHOLD && !(squad.skillRush?.ttl > 0)) {
    squad.waypoints = [];
    squad.targetSquadId = '';
    if (squad.behavior === 'move' && resolveSquadOrderType(squad) !== ORDER_ATTACK_MOVE) {
      squad.behavior = 'idle';
      squad.action = '待命';
    }
  }
  return { x: dir.x, y: dir.y };
};

const aggregateSquadFromAgents = (squad, agents = []) => {
  if (!squad) return;
  const alive = [];
  let remain = 0;
  let centerAccX = 0;
  let centerAccY = 0;
  const remainUnits = {};
  const classAcc = {
    infantry: { x: 0, y: 0, w: 0 },
    cavalry: { x: 0, y: 0, w: 0 },
    archer: { x: 0, y: 0, w: 0 },
    artillery: { x: 0, y: 0, w: 0 }
  };
  const anchorX = Number(squad.x) || 0;
  const anchorY = Number(squad.y) || 0;
  let maxDist = 0;

  for (let i = 0; i < agents.length; i += 1) {
    const agent = agents[i];
    if (!agent || agent.dead) continue;
    const weight = Math.max(0, Number(agent.weight) || 0);
    if (weight <= 0.001) continue;
    alive.push(agent);
    remain += weight;
    const ax = Number(agent.x) || 0;
    const ay = Number(agent.y) || 0;
    centerAccX += ax;
    centerAccY += ay;
    const d = Math.hypot(ax - anchorX, ay - anchorY);
    if (d > maxDist) maxDist = d;
    const unitTypeId = typeof agent.unitTypeId === 'string' ? agent.unitTypeId : '__fallback__';
    remainUnits[unitTypeId] = (remainUnits[unitTypeId] || 0) + weight;
    let cls = typeof agent.typeCategory === 'string' ? agent.typeCategory : '';
    if (cls !== 'infantry' && cls !== 'cavalry' && cls !== 'archer' && cls !== 'artillery') {
      cls = typeof squad.classTag === 'string' ? squad.classTag : 'infantry';
    }
    if (!classAcc[cls]) cls = 'infantry';
    classAcc[cls].x += ax * weight;
    classAcc[cls].y += ay * weight;
    classAcc[cls].w += weight;
  }

  if (alive.length <= 0) {
    squad.remain = 0;
    squad.health = 0;
    squad.action = '覆灭';
    squad.behavior = 'idle';
    squad.waypoints = [];
    squad.flagBearerAgentId = '';
    squad.classCenters = {
      infantry: { x: anchorX, y: anchorY, count: 0 },
      cavalry: { x: anchorX, y: anchorY, count: 0 },
      archer: { x: anchorX, y: anchorY, count: 0 },
      artillery: { x: anchorX, y: anchorY, count: 0 }
    };
    return;
  }

  ensureFlagBearer(squad, alive);
  const center = {
    x: centerAccX / Math.max(1, alive.length),
    y: centerAccY / Math.max(1, alive.length)
  };
  const remainRounded = Math.max(0, Math.round(remain));
  squad.remain = clamp(remainRounded, 0, Math.max(0, Number(squad.startCount) || 0));
  squad.losses = Math.max(0, Math.floor((Number(squad.startCount) || 0) - squad.remain));
  squad.centerX = Number.isFinite(center.x) ? center.x : anchorX;
  squad.centerY = Number.isFinite(center.y) ? center.y : anchorY;
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

  squad.remainUnits = Object.fromEntries(
    Object.entries(remainUnits).map(([unitTypeId, value]) => [unitTypeId, Math.max(0, Math.round(value))])
  );
  const classCenters = {};
  classCenters.infantry = classAcc.infantry.w > 0
    ? { x: classAcc.infantry.x / classAcc.infantry.w, y: classAcc.infantry.y / classAcc.infantry.w, count: Math.round(classAcc.infantry.w) }
    : { x: squad.centerX, y: squad.centerY, count: 0 };
  classCenters.cavalry = classAcc.cavalry.w > 0
    ? { x: classAcc.cavalry.x / classAcc.cavalry.w, y: classAcc.cavalry.y / classAcc.cavalry.w, count: Math.round(classAcc.cavalry.w) }
    : { x: squad.centerX, y: squad.centerY, count: 0 };
  classCenters.archer = classAcc.archer.w > 0
    ? { x: classAcc.archer.x / classAcc.archer.w, y: classAcc.archer.y / classAcc.archer.w, count: Math.round(classAcc.archer.w) }
    : { x: squad.centerX, y: squad.centerY, count: 0 };
  classCenters.artillery = classAcc.artillery.w > 0
    ? { x: classAcc.artillery.x / classAcc.artillery.w, y: classAcc.artillery.y / classAcc.artillery.w, count: Math.round(classAcc.artillery.w) }
    : { x: squad.centerX, y: squad.centerY, count: 0 };
  squad.classCenters = classCenters;
};

const trimOrGrowAgents = (squad, agents = [], crowd, dt) => {
  const repConfig = resolveRepConfig(null, crowd);
  if (repConfig.strictAgentMapping) {
    ensureFlagBearer(squad, agents);
    return;
  }
  const alive = agents.filter((agent) => !agent.dead && agent.weight > 0.001);
  const target = Number(squad.remain) <= 0
    ? 0
    : resolveVisibleAgentCount(Math.max(1, Number(squad.remain) || 1), repConfig.maxAgentWeight, false);
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
    const splitWeight = Math.min(repConfig.maxAgentWeight, Math.max(0.45, (source.weight || 1) * 0.5));
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

const updateSquadSpeedPolicyState = (squad, agents = [], dt = 0) => {
  if (!squad) return;
  const speedMode = squad.speedMode === SPEED_MODE_C ? SPEED_MODE_C : SPEED_MODE_B;
  const policy = typeof squad.speedPolicy === 'string' ? squad.speedPolicy : SPEED_POLICY_MARCH;
  if (speedMode === SPEED_MODE_C) {
    squad.speedPolicy = SPEED_POLICY_RETREAT;
    squad.reformUntil = 0;
    return;
  }
  if (policy === SPEED_POLICY_RETREAT) {
    squad.speedPolicy = SPEED_POLICY_REFORM;
    squad.reformUntil = Math.max(4.6, Number(squad.reformUntil) || 0);
  }
  if (squad.speedPolicy !== SPEED_POLICY_REFORM) {
    squad.speedPolicy = SPEED_POLICY_MARCH;
    squad.reformUntil = 0;
    return;
  }
  const alive = (Array.isArray(agents) ? agents : []).filter((agent) => agent && !agent.dead && (agent.weight || 0) > 0.001);
  if (alive.length <= 0) {
    squad.speedPolicy = SPEED_POLICY_MARCH;
    squad.reformUntil = 0;
    return;
  }
  const threshold = Math.max(10, Number(squad.reformRadiusThreshold) || Math.max(16, Number(squad.radius) || 16));
  const inRange = alive.filter((agent) => {
    const dist = Math.hypot((Number(agent.x) || 0) - (Number(squad.x) || 0), (Number(agent.y) || 0) - (Number(squad.y) || 0));
    return dist <= threshold;
  }).length;
  const ratio = inRange / Math.max(1, alive.length);
  squad.reformUntil = Math.max(0, (Number(squad.reformUntil) || 0) - dt);
  if (ratio >= 0.7 || squad.reformUntil <= 0) {
    squad.speedPolicy = SPEED_POLICY_MARCH;
    squad.reformUntil = 0;
  }
};

const resolveAgentModeSpeedMul = (agent, squad, crowd) => {
  const speedMode = squad?.speedMode === SPEED_MODE_C ? SPEED_MODE_C : SPEED_MODE_B;
  const speedPolicy = typeof squad?.speedPolicy === 'string' ? squad.speedPolicy : SPEED_POLICY_MARCH;
  if (speedMode === SPEED_MODE_B || speedPolicy === SPEED_POLICY_MARCH) return 1;
  if (speedMode === SPEED_MODE_C) {
    const realSpeed = resolveUnitTypeSpeed(crowd, agent?.unitTypeId, squad?.stats?.speed);
    const groupSpeed = Math.max(0.2, Number(squad?._groupSpeedScalar) || Number(squad?.stats?.speed) || 1);
    return clamp(realSpeed / Math.max(0.2, groupSpeed), 0.65, 2.1);
  }
  return clamp(Number(agent?.moveSpeedMul) || 1, 0.6, 1.8);
};

const applyCavalryRushImpact = (sim, crowd, squad, agents = [], fromPoint, toPoint) => {
  if (!squad || !squad.skillRush) return;
  const rush = squad.skillRush;
  if (!(rush.hitAgentIds instanceof Set)) {
    rush.hitAgentIds = new Set();
  }
  const segmentLen = Math.hypot((toPoint?.x || 0) - (fromPoint?.x || 0), (toPoint?.y || 0) - (fromPoint?.y || 0));
  if (segmentLen <= 0.2) return;

  const flagBearer = ensureFlagBearer(squad, agents);
  const sourceWeight = Math.max(1, Number(flagBearer?.weight) || 1);
  const repConfig = resolveRepConfig(sim, crowd);
  const impactDamage = Math.max(0.8, (Number(squad.stats?.atk) || 10) * 0.11 * Math.pow(sourceWeight, repConfig.damageExponent));
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
  const repConfig = resolveRepConfig(sim, { repConfig: options?.repConfig || sim?.repConfig || {} });
  if (sim && typeof sim === 'object') {
    sim.engagementAgentDiameter = AGENT_RADIUS * 2;
    sim.engagementAgentGap = AGENT_GAP;
    sim.repConfig = repConfig;
  }
  const crowd = {
    agentsBySquad: new Map(),
    allAgents: [],
    effectsPool: createCombatEffectsPool(),
    nextAgentId: 1,
    unitTypeMap,
    repConfig,
    spatial: buildSpatialHash([], 14),
    engagement: null
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

const ensureSkillCooldownMap = (squad) => {
  if (!squad || typeof squad !== 'object') return {
    infantry: 0,
    cavalry: 0,
    archer: 0,
    artillery: 0
  };
  if (!squad.skillCooldowns || typeof squad.skillCooldowns !== 'object') {
    const seedCooldown = Math.max(0, Number(squad.attackCooldown) || 0);
    const seedKind = (squad.classTag === 'cavalry' || squad.classTag === 'archer' || squad.classTag === 'artillery')
      ? squad.classTag
      : 'infantry';
    squad.skillCooldowns = {
      infantry: seedKind === 'infantry' ? seedCooldown : 0,
      cavalry: seedKind === 'cavalry' ? seedCooldown : 0,
      archer: seedKind === 'archer' ? seedCooldown : 0,
      artillery: seedKind === 'artillery' ? seedCooldown : 0
    };
    return squad.skillCooldowns;
  }
  if (!Number.isFinite(Number(squad.skillCooldowns.infantry))) squad.skillCooldowns.infantry = 0;
  if (!Number.isFinite(Number(squad.skillCooldowns.cavalry))) squad.skillCooldowns.cavalry = 0;
  if (!Number.isFinite(Number(squad.skillCooldowns.archer))) squad.skillCooldowns.archer = 0;
  if (!Number.isFinite(Number(squad.skillCooldowns.artillery))) squad.skillCooldowns.artillery = 0;
  return squad.skillCooldowns;
};

const updateAttackCooldownFromSkills = (squad) => {
  const cooldowns = ensureSkillCooldownMap(squad);
  const maxCooldown = Math.max(
    0,
    Number(cooldowns.infantry) || 0,
    Number(cooldowns.cavalry) || 0,
    Number(cooldowns.archer) || 0,
    Number(cooldowns.artillery) || 0
  );
  squad.attackCooldown = maxCooldown;
  return maxCooldown;
};

export const triggerCrowdSkill = (sim, crowd, squadId, targetInput) => {
  const squad = (sim?.squads || []).find((row) => row.id === squadId);
  if (!squad || squad.remain <= 0) return { ok: false, reason: '部队不可用' };
  if ((Number(squad.morale) || 0) <= 0) return { ok: false, reason: '士气归零，无法发动兵种攻击' };
  const agents = getCrowdAgentsForSquad(crowd, squad.id);
  if (agents.length <= 0) return { ok: false, reason: '无可用士兵' };
  const inputKind = typeof targetInput?.kind === 'string' ? targetInput.kind.trim() : '';
  let skillKind = inputKind;
  if (skillKind !== 'infantry' && skillKind !== 'cavalry' && skillKind !== 'archer' && skillKind !== 'artillery') {
    skillKind = typeof squad.classTag === 'string' ? squad.classTag : 'infantry';
  }
  if (skillKind !== 'infantry' && skillKind !== 'cavalry' && skillKind !== 'archer' && skillKind !== 'artillery') {
    skillKind = 'infantry';
  }
  let classWeight = 0;
  for (let i = 0; i < agents.length; i += 1) {
    const agent = agents[i];
    if (!agent || agent.dead || (Number(agent.weight) || 0) <= 0.001) continue;
    if ((agent.typeCategory || 'infantry') === skillKind) {
      classWeight += Math.max(0, Number(agent.weight) || 0);
    }
  }
  if (classWeight <= 0.01) {
    return { ok: false, reason: '该兵种当前无人可释放技能' };
  }
  const cooldownMap = ensureSkillCooldownMap(squad);
  const classCooldownRemain = Math.max(0, Number(cooldownMap[skillKind]) || 0);
  if (classCooldownRemain > 0.01) return { ok: false, reason: '兵种攻击冷却中' };
  const inputX = Number(targetInput?.x);
  const inputY = Number(targetInput?.y);
  const tx = Number.isFinite(inputX) ? inputX : (squad.x || 0);
  const ty = Number.isFinite(inputY) ? inputY : (squad.y || 0);

  if (skillKind === 'infantry') {
    if (squad.guard) squad.guard.enabled = false;
    squad.effectBuff = {
      type: 'infantry',
      ttl: 7.5,
      atkMul: 1.22,
      defMul: 1.3,
      speedMul: 0.78
    };
    squad.waypoints = [];
    cooldownMap.infantry = Math.max(Number(cooldownMap.infantry) || 0, Number(SKILL_COOLDOWN_BY_CLASS.infantry) || 2.1);
    updateAttackCooldownFromSkills(squad);
    squad.actionState = {
      kind: 'skill',
      from: 'none',
      to: 'infantry',
      ttl: 0.45,
      dur: 0.45
    };
    squad.action = '兵种攻击';
    return { ok: true };
  }

  if (skillKind === 'cavalry') {
    if (squad.guard) squad.guard.enabled = false;
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
    cooldownMap.cavalry = Math.max(Number(cooldownMap.cavalry) || 0, Number(SKILL_COOLDOWN_BY_CLASS.cavalry) || 2.8);
    updateAttackCooldownFromSkills(squad);
    squad.actionState = {
      kind: 'charge',
      from: 'none',
      to: 'cavalry',
      ttl: Math.max(0.55, (dist / CAVALRY_RUSH_SPEED) * 1.5),
      dur: Math.max(0.55, (dist / CAVALRY_RUSH_SPEED) * 1.5)
    };
    squad.action = '兵种攻击';
    return { ok: true };
  }

  const rangedClass = skillKind === 'artillery' ? 'artillery' : 'archer';
  if (squad.guard) squad.guard.enabled = false;
  const cfg = GROUND_SKILL_CONFIG[rangedClass] || GROUND_SKILL_CONFIG.archer;
  const targetSpec = normalizeGroundSkillTargetSpec(
    sim,
    squad,
    rangedClass,
    targetInput && typeof targetInput === 'object' ? targetInput : { x: tx, y: ty }
  );
  const activeSkill = {
    id: `skill_${squad.id}_${Date.now()}`,
    classTag: rangedClass,
    targetSpec,
    wavesTotal: Math.max(1, Math.floor(Number(cfg?.waves) || 1)),
    wavesFired: 0,
    intervalSec: Math.max(0.05, Number(cfg?.intervalSec) || 0.2),
    nextWaveSec: 0,
    ttlSec: Math.max(0.08, Number(cfg?.durationSec) || 0.8),
    config: cfg
  };
  emitGroundSkillWave(sim, crowd, squad, activeSkill, 0);
  activeSkill.wavesFired = 1;
  activeSkill.nextWaveSec = Math.max(0.05, Number(cfg?.intervalSec) || 0.2);
  squad.activeSkill = activeSkill;
  cooldownMap[rangedClass] = Math.max(
    Number(cooldownMap[rangedClass]) || 0,
    Number(cfg?.cooldownSec) || Number(SKILL_COOLDOWN_BY_CLASS[rangedClass]) || 6.5
  );
  updateAttackCooldownFromSkills(squad);
  squad.actionState = {
    kind: 'skill',
    from: 'none',
    to: rangedClass,
    ttl: Math.max(0.2, Number(cfg?.durationSec) || 0.8),
    dur: Math.max(0.2, Number(cfg?.durationSec) || 0.8)
  };
  squad.action = '兵种攻击';
  return { ok: true };
};

export const updateCrowdSim = (crowd, sim, dt) => {
  if (!crowd || !sim || sim.ended) return;
  const safeDt = Math.max(0.001, Number(dt) || 0.016);
  const steeringWeights = resolveSteeringWeights(sim, crowd);
  if (sim && typeof sim === 'object') sim.steeringWeights = steeringWeights;
  if (crowd && typeof crowd === 'object') crowd.steeringWeights = steeringWeights;
  sim.timeElapsed = Math.max(0, Number(sim?.timeElapsed) || 0) + safeDt;
  const nowSec = Number(sim?.timeElapsed) || 0;
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  const walls = Array.isArray(sim?.buildings) ? sim.buildings.filter((w) => !w?.destroyed) : [];

  crowd.allAgents = [];
  crowd.agentsBySquad.forEach((agents, squadId) => {
    const filtered = (Array.isArray(agents) ? agents : []).filter((agent) => agent && !agent.dead && (agent.weight || 0) > 0.001);
    crowd.agentsBySquad.set(squadId, filtered);
    crowd.allAgents.push(...filtered);
  });
  const spatial = buildSpatialHash(crowd.allAgents, 14);
  crowd.spatial = spatial;
  syncMeleeEngagement(crowd, sim, walls, safeDt, Number(sim?.timeElapsed) || 0);
  itemInteractionSystem.step(sim, crowd, safeDt);

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
    const actionState = ensureSquadActionState(squad);
    const stability = ensureSquadStability(squad);
    if (actionState.kind !== 'none') {
      actionState.ttl = Math.max(0, (Number(actionState.ttl) || 0) - safeDt);
      if (actionState.ttl <= 0) {
        actionState.kind = 'none';
        actionState.from = 'none';
        actionState.to = 'none';
        actionState.dur = 0;
        actionState.ttl = 0;
      }
    }
    if (stability) {
      if (actionState.kind === 'transition') {
        stability.transition = clamp(
          (Number(stability.transition) || 0) - (Math.max(0.1, Number(stability.transitionDecayPerSec) || 0.1) * safeDt),
          0,
          Math.max(1, Number(stability.transitionMax) || 1)
        );
      } else {
        stability.transition = clamp(
          (Number(stability.transition) || 0) + (Math.max(0.1, Number(stability.transitionRegenPerSec) || 0.1) * safeDt),
          0,
          Math.max(1, Number(stability.transitionMax) || 1)
        );
      }
      if ((Number(squad?.skillRush?.ttl) || 0) > 0) {
        stability.chargePoiseCurrent = clamp(
          Number(stability.chargePoiseCurrent) || Number(stability.chargePoise) || 0,
          0,
          Math.max(1, Number(stability.chargePoise) || 1)
        );
      } else {
        stability.chargePoiseCurrent = Math.max(0, Number(stability.chargePoise) || 0);
      }
      stability.poise = clamp(
        (Number(stability.poise) || 0) + (Math.max(0.1, Number(stability.poiseRegenPerSec) || 0.1) * safeDt),
        0,
        Math.max(1, Number(stability.poiseMax) || 1)
      );
    }
    if (squad.effectBuff) {
      squad.effectBuff.ttl = Math.max(0, Number(squad.effectBuff.ttl) - safeDt);
      if (squad.effectBuff.ttl <= 0) squad.effectBuff = null;
    }
    squad._buffFxCd = Math.max(0, Number(squad._buffFxCd) || 0);
    if (squad.effectBuff) {
      squad._buffFxCd = Math.max(0, squad._buffFxCd - safeDt);
      if (squad._buffFxCd <= 0) {
        acquireHitEffect(crowd.effectsPool, {
          type: 'buff_aura',
          x: Number(squad.x) || 0,
          y: Number(squad.y) || 0,
          z: 1.1,
          radius: Math.max(4, Number(squad.radius) * 0.55),
          ttl: 0.24,
          team: squad.team
        });
        squad._buffFxCd = 0.24;
      }
    }
    squad._rushDustCd = Math.max(0, Number(squad._rushDustCd) || 0);
    if ((Number(squad?.skillRush?.ttl) || 0) > 0) {
      squad._rushDustCd = Math.max(0, squad._rushDustCd - safeDt);
      if (squad._rushDustCd <= 0) {
        acquireHitEffect(crowd.effectsPool, {
          type: 'charge_dust',
          x: Number(squad.x) || 0,
          y: Number(squad.y) || 0,
          z: 0.7,
          radius: Math.max(5, Number(squad.radius) * 0.48),
          ttl: 0.22,
          team: squad.team
        });
        squad._rushDustCd = 0.09;
      }
    }
    if ((Number(squad.fatigueTimer) || 0) > 0) {
      squad.fatigueTimer = Math.max(0, Number(squad.fatigueTimer) - safeDt);
    }
    updateActiveGroundSkill(sim, crowd, squad, safeDt);
    const skillCooldowns = ensureSkillCooldownMap(squad);
    skillCooldowns.infantry = Math.max(0, (Number(skillCooldowns.infantry) || 0) - safeDt);
    skillCooldowns.cavalry = Math.max(0, (Number(skillCooldowns.cavalry) || 0) - safeDt);
    skillCooldowns.archer = Math.max(0, (Number(skillCooldowns.archer) || 0) - safeDt);
    skillCooldowns.artillery = Math.max(0, (Number(skillCooldowns.artillery) || 0) - safeDt);
    updateAttackCooldownFromSkills(squad);
    squad.underAttackTimer = Math.max(0, (Number(squad.underAttackTimer) || 0) - safeDt);
    updateSquadBehaviorPlan(squad, sim, Number(sim?.timeElapsed) || 0);
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
    forward = leaderMoveStep(squad, sim, crowd, safeDt, forward, steeringWeights);
    squad._crowdForward = forward;
    updateSquadSpeedPolicyState(squad, agents, safeDt);
    const modeGroupSpeed = squad.speedMode === SPEED_MODE_C
      ? computeRetreatGroupSpeed(squad, crowd)
      : computeHarmonicGroupSpeed(squad, crowd);
    squad._groupSpeedScalar = Math.max(0.2, modeGroupSpeed);

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
    const speedPolicy = typeof squad.speedPolicy === 'string' ? squad.speedPolicy : SPEED_POLICY_MARCH;
    const retreatMode = speedPolicy === SPEED_POLICY_RETREAT;
    const reformMode = speedPolicy === SPEED_POLICY_REFORM;
    const looseMarch = squad?.marchMode === 'loose' && !retreatMode;
    const slotGain = retreatMode ? 0.44 : (reformMode ? 1.36 : (looseMarch ? 0.82 : 1));
    const sepGain = retreatMode ? 0.52 : (reformMode ? 0.86 : (looseMarch ? 0.72 : 1));
    const avoidGain = retreatMode ? 0.68 : (looseMarch ? 0.78 : 0.95);
    const accelCap = retreatMode ? AGENT_RETREAT_ACCEL : (reformMode ? AGENT_REFORM_ACCEL : AGENT_MAX_ACCEL);
    const flagBack = spacing * FLAG_BACK_OFFSET;
    const sorted = [...agents].sort((a, b) => a.slotOrder - b.slotOrder);
    ensureFlagBearer(squad, sorted);

    sorted.forEach((agent, index) => {
      if (!agent || agent.dead) return;
      if (agent.isFlagBearer) {
        const flagOffsetX = -forward.x * flagBack;
        const flagOffsetY = -forward.y * flagBack;
        agent.x = (Number(squad.x) || 0) + flagOffsetX;
        agent.y = (Number(squad.y) || 0) + flagOffsetY;
        agent.vx = Number(squad.vx) || 0;
        agent.vy = Number(squad.vy) || 0;
        if (Math.abs(agent.vx) + Math.abs(agent.vy) > 0.08) {
          agent.yaw = Math.atan2(agent.vy, agent.vx);
        } else {
          agent.yaw = Math.atan2(forward.y, forward.x);
        }
        agent.state = agent.attackCd > 0 ? 'attack' : 'idle';
        agent.hitTimer = Math.max(0, (Number(agent.hitTimer) || 0) - safeDt);
        return;
      }
      const slot = slotOffsetForIndex(index, columns, spacing);
      const desiredX = (Number(squad.x) || 0) + (side.x * slot.side) - (forward.x * slot.back);
      const desiredY = (Number(squad.y) || 0) + (side.y * slot.side) - (forward.y * slot.back);
      const toDesired = normalizeVec(desiredX - (agent.x || 0), desiredY - (agent.y || 0));
      const stationaryHold = !leaderMoving && (squad.behavior === 'idle' || squad.behavior === 'move' || squad.behavior === 'standby');
      const moraleMul = squad.morale <= 0 ? (2 / 3) : (squad.morale < 20 ? 0.82 : 1);
      const fatigueMul = squad.fatigueTimer > 0 ? 0.72 : 1;
      const weightSlow = bottlenecked
        ? 1 / (1 + (WEIGHT_BOTTLENECK_ALPHA * Math.max(0, Math.min(40, (agent.weight || 1)) - 1)))
        : 1;
      const speedMul = (squad.effectBuff?.speedMul ? Number(squad.effectBuff.speedMul) : 1) * ((squad.skillRush?.ttl || 0) > 0 ? 1.45 : 1);
      const modeSpeedMul = resolveAgentModeSpeedMul(agent, squad, crowd);
      const speed = Math.max(6, (Number(squad._groupSpeedScalar) || Number(squad.stats?.speed) || 1) * 20 * moraleMul * fatigueMul * weightSlow * speedMul * modeSpeedMul);
      const engagementCfg = crowd?.engagement?.config || {};
      const engagementEnabled = !!crowd?.engagement?.enabled;
      const isMelee = isMeleeAgent(agent);
      const hasAnchor = engagementEnabled && isMelee && !!agent.engagePairKey
        && Number.isFinite(Number(agent.engageAx)) && Number.isFinite(Number(agent.engageAy));

      const neighbors = querySpatialNearby(spatial, agent.x, agent.y, 12);
      const sep = computeTeamAwareSeparation(agent, neighbors, spacing * 0.94);
      const sepScale = stationaryHold
        ? (agent.isFlagBearer ? STATIONARY_FLAG_SEPARATION_SCALE : STATIONARY_SEPARATION_SCALE)
        : 1;
      const leaderSettling = !leaderMoving || (Math.hypot(Number(squad.vx) || 0, Number(squad.vy) || 0) <= AGENT_SETTLE_SPEED);
      const settleBlend = leaderSettling
        ? clamp((toDesired.len - AGENT_SETTLE_DEADZONE) / Math.max(0.2, AGENT_SETTLE_RADIUS - AGENT_SETTLE_DEADZONE), 0, 1)
        : 1;
      const avoid = computeAvoidanceDirection(agent, toDesired, walls, AGENT_AVOID_PROBE, agent, nowSec);
      const slotW = Math.max(0, Number(steeringWeights?.slot) || DEFAULT_STEERING_WEIGHTS.slot);
      const sepW = Math.max(0, Number(steeringWeights?.separation) || DEFAULT_STEERING_WEIGHTS.separation);
      const avoidW = Math.max(0, Number(steeringWeights?.avoidance) || DEFAULT_STEERING_WEIGHTS.avoidance);
      const anchorW = Math.max(0, Number(steeringWeights?.anchor) || DEFAULT_STEERING_WEIGHTS.anchor);
      const pressureW = Math.max(0, Number(steeringWeights?.pressure) || DEFAULT_STEERING_WEIGHTS.pressure);
      const sepGainLocal = sepGain * settleBlend;
      const avoidGainLocal = avoidGain * (leaderSettling ? settleBlend : 1);
      let desiredVx = (toDesired.x * speed * slotGain * slotW)
        + (sep.x * 40 * sepScale * sepGainLocal * sepW)
        + (avoid.x * speed * avoidGainLocal * 0.5 * avoidW);
      let desiredVy = (toDesired.y * speed * slotGain * slotW)
        + (sep.y * 40 * sepScale * sepGainLocal * sepW)
        + (avoid.y * speed * avoidGainLocal * 0.5 * avoidW);
      if (hasAnchor) {
        const anchorDir = normalizeVec((Number(agent.engageAx) || 0) - (agent.x || 0), (Number(agent.engageAy) || 0) - (agent.y || 0));
        const steerGain = clamp((Number(engagementCfg?.anchorSteerGain) || 0.72) * anchorW, 0.08, 2.4);
        const steerCap = speed * clamp(Number(engagementCfg?.anchorSteerCapMul) || 0.58, 0.1, 1.4);
        let steerVx = anchorDir.x * speed * steerGain;
        let steerVy = anchorDir.y * speed * steerGain;
        const steerLen = Math.hypot(steerVx, steerVy);
        if (steerLen > steerCap && steerLen > 0.0001) {
          steerVx = (steerVx / steerLen) * steerCap;
          steerVy = (steerVy / steerLen) * steerCap;
        }
        desiredVx += steerVx;
        desiredVy += steerVy;
        const pressure = Math.max(0, Number(agent.engagePressure) || 0);
        if (pressure > 0.0001) {
          desiredVx += (Number(agent.engageFrontDx) || 0) * pressure * pressureW;
          desiredVy += (Number(agent.engageFrontDy) || 0) * pressure * pressureW;
        }
      }
      if ((stationaryHold && toDesired.len <= AGENT_IDLE_DEADZONE) || (leaderSettling && toDesired.len <= AGENT_SETTLE_DEADZONE)) {
        clearAvoidanceMemory(agent);
        desiredVx = 0;
        desiredVy = 0;
      }
      const accelStep = clampVecLength(
        desiredVx - (Number(agent.vx) || 0),
        desiredVy - (Number(agent.vy) || 0),
        accelCap * safeDt
      );
      let vx = (Number(agent.vx) || 0) + accelStep.x;
      let vy = (Number(agent.vy) || 0) + accelStep.y;
      const vLen = Math.hypot(vx, vy);
      const maxV = speed * 1.15;
      if (vLen > maxV) {
        vx = (vx / vLen) * maxV;
        vy = (vy / vLen) * maxV;
      }
      let nx = (Number(agent.x) || 0) + (vx * safeDt);
      let ny = (Number(agent.y) || 0) + (vy * safeDt);
      let pushNx = 0;
      let pushNy = 0;
      walls.forEach((wall) => {
        const beforeX = nx;
        const beforeY = ny;
        const pushed = pushOutOfRect({ x: nx, y: ny }, wall, (agent.radius || AGENT_RADIUS) + 0.5);
        nx = pushed.x;
        ny = pushed.y;
        if (pushed?.pushed) {
          const corr = normalizeVec(nx - beforeX, ny - beforeY);
          if (corr.len > 1e-4) {
            pushNx += corr.x;
            pushNy += corr.y;
          }
        }
      });
      const halfW = (Number(sim?.field?.width) || 2700) / 2;
      const halfH = (Number(sim?.field?.height) || 1488) / 2;
      nx = clamp(nx, -halfW + 2, halfW - 2);
      ny = clamp(ny, -halfH + 2, halfH - 2);
      const pushN = normalizeVec(pushNx, pushNy);
      if (pushN.len > 1e-4) {
        const vn = (vx * pushN.x) + (vy * pushN.y);
        if (vn > 0) {
          const keep = vn * 0.2;
          const remove = vn - keep;
          vx -= pushN.x * remove;
          vy -= pushN.y * remove;
        }
      }

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

    if (squad.skillRush) {
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
  crowd.spatial = buildSpatialHash(crowd.allAgents, 14);
  updateCrowdCombat(sim, crowd, safeDt);
  stepEffectPool(crowd.effectsPool, safeDt);
  sim.projectiles = crowd.effectsPool.projectileLive;
  sim.hitEffects = crowd.effectsPool.hitLive;
};
