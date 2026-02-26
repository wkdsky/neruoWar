import {
  clamp,
  normalizeVec,
  hasLineOfSight
} from './crowdPhysics';

const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';

const FEATURE_FLAG_QUERY_KEY = 'meleeEngage';
const FEATURE_FLAG_GLOBAL_KEY = '__MELEE_ENGAGEMENT_ENABLED';
const FEATURE_CONFIG_GLOBAL_KEY = '__MELEE_ENGAGEMENT_CONFIG';

export const MELEE_ENGAGEMENT_ENABLED = true;

export const MELEE_ENGAGEMENT_CONFIG = {
  updateHz: 10,
  laneSpacingMul: 1,
  bandHalfDepth: 8.8,
  standOff: 3.2,
  depthStepMul: 0.92,
  depthLayersMin: 2,
  depthLayersMax: 4,
  pressureStrength: 18,
  pressureFalloff: 0.88,
  anchorSteerGain: 0.72,
  anchorSteerCapMul: 0.58,
  blockedRetargetSec: 0.62,
  losInflate: 1.2,
  laneSearchRadius: 3,
  maxLaneShiftPerUpdate: 1,
  engageScanRadius: 26,
  blockedSquadRatio: 0.35,
  retargetCooldownSec: 0.9,
  detourDistance: 14,
  losPenalty: 44,
  losRejectDistance: 84,
  stickyTargetBonus: 18,
  laneOccupancyWeight: 2.1,
  laneDiffWeight: 0.55,
  laneNeighborBonus: 0.45
};

const toSafeNumber = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseQueryFlag = () => {
  if (typeof window === 'undefined' || !window?.location?.search) return null;
  const query = new URLSearchParams(window.location.search);
  const raw = query.get(FEATURE_FLAG_QUERY_KEY);
  if (raw === null) return null;
  const normalized = String(raw).trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
  if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
  return null;
};

const parseGlobalFlag = () => {
  if (typeof window === 'undefined') return null;
  const raw = window?.[FEATURE_FLAG_GLOBAL_KEY];
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
    if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
  }
  return null;
};

const resolveFeatureFlag = () => {
  const queryFlag = parseQueryFlag();
  if (queryFlag !== null) return queryFlag;
  const globalFlag = parseGlobalFlag();
  if (globalFlag !== null) return globalFlag;
  return !!MELEE_ENGAGEMENT_ENABLED;
};

const resolveFeatureConfig = () => {
  const fromGlobal = (typeof window !== 'undefined' && window?.[FEATURE_CONFIG_GLOBAL_KEY] && typeof window[FEATURE_CONFIG_GLOBAL_KEY] === 'object')
    ? window[FEATURE_CONFIG_GLOBAL_KEY]
    : null;
  if (!fromGlobal) return { ...MELEE_ENGAGEMENT_CONFIG };
  const next = { ...MELEE_ENGAGEMENT_CONFIG };
  Object.keys(next).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(fromGlobal, key)) {
      next[key] = toSafeNumber(fromGlobal[key], next[key]);
    }
  });
  return next;
};

export const isMeleeEngagementEnabled = () => resolveFeatureFlag();

export const getMeleeEngagementConfig = () => resolveFeatureConfig();

const resolveInterval = (cfg) => Math.max(0.06, 1 / Math.max(1, Math.floor(toSafeNumber(cfg?.updateHz, 10))));

const stableHash = (value = '') => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return hash >>> 0;
};

const isSquadMelee = (squad = {}) => {
  const classTag = typeof squad?.classTag === 'string' ? squad.classTag : '';
  if (classTag === 'archer' || classTag === 'artillery') return false;
  if (classTag === 'infantry' || classTag === 'cavalry') return true;
  const roleTag = typeof squad?.roleTag === 'string' ? squad.roleTag : '';
  return roleTag !== '远程';
};

const isAgentMelee = (agent = {}) => {
  const category = typeof agent?.typeCategory === 'string' ? agent.typeCategory : '';
  return category !== 'archer' && category !== 'artillery';
};

const canonicalPairKey = (a = '', b = '') => (
  a <= b ? `${a}|${b}` : `${b}|${a}`
);

const clearAgentEngagementMeta = (agent) => {
  if (!agent) return;
  agent.engagePairKey = '';
  agent.engageEnemySquadId = '';
  agent.engageLane = 0;
  agent.engageDepthRank = 0;
  agent.engageAx = Number(agent.x) || 0;
  agent.engageAy = Number(agent.y) || 0;
  agent.engagePressure = 0;
  agent.engageFrontDx = 0;
  agent.engageFrontDy = 0;
  agent.engageBlockedSec = 0;
  agent.engageNeedsRetarget = false;
};

const clearSquadEngagementMeta = (squad) => {
  if (!squad) return;
  squad.engagePairKey = '';
  squad._engageBlockedTargetId = '';
};

const scoreTargetSquad = ({
  squad,
  enemy,
  walls = [],
  cfg = MELEE_ENGAGEMENT_CONFIG,
  nowSec = 0
}) => {
  const dist = Math.hypot((enemy.x || 0) - (squad.x || 0), (enemy.y || 0) - (squad.y || 0));
  const threat = Math.max(0, Number(enemy.stats?.atk) || 0) * 1.28;
  const weak = (1 - clamp((enemy.remain || 0) / Math.max(1, enemy.startCount || 1), 0, 1)) * 48;
  let score = threat + weak - (dist * 0.3);
  if (squad.targetSquadId && squad.targetSquadId === enemy.id) {
    score += toSafeNumber(cfg?.stickyTargetBonus, 18);
  }
  const blocked = !hasLineOfSight(
    { x: Number(squad.x) || 0, y: Number(squad.y) || 0 },
    { x: Number(enemy.x) || 0, y: Number(enemy.y) || 0 },
    walls,
    toSafeNumber(cfg?.losInflate, 1.2)
  );
  if (blocked) {
    score -= toSafeNumber(cfg?.losPenalty, 44);
    if (dist > toSafeNumber(cfg?.losRejectDistance, 84)) {
      score -= 999;
    }
  }
  if (squad._engageRetargetUntil && Number(squad._engageRetargetUntil) > nowSec) {
    if (enemy.id === squad._engageBlockedTargetId) {
      score -= 120;
    }
  }
  return score;
};

const buildPairs = (sim, walls, cfg, nowSec) => {
  const squads = Array.isArray(sim?.squads) ? sim.squads.filter((row) => row && row.remain > 0) : [];
  const meleeSquads = squads.filter((row) => isSquadMelee(row) && row.behavior !== 'retreat');
  const pairMap = new Map();
  const squadPairById = new Map();
  const byId = new Map(squads.map((row) => [row.id, row]));

  meleeSquads.forEach((squad) => {
    const enemyTeam = squad.team === TEAM_ATTACKER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const enemyRows = squads.filter((row) => row.team === enemyTeam && row.remain > 0);
    if (enemyRows.length <= 0) return;
    let best = null;
    let bestScore = -Infinity;
    enemyRows.forEach((enemy) => {
      const score = scoreTargetSquad({ squad, enemy, walls, cfg, nowSec });
      if (score > bestScore) {
        bestScore = score;
        best = enemy;
      }
    });
    if (!best || bestScore <= -900) return;
    squad.targetSquadId = best.id;
    const key = canonicalPairKey(squad.id, best.id);
    if (!pairMap.has(key)) {
      pairMap.set(key, {
        key,
        attackerId: '',
        defenderId: '',
        pairCenterX: 0,
        pairCenterY: 0,
        contactX: 0,
        contactY: 0,
        dirX: 1,
        dirY: 0,
        tangentX: 0,
        tangentY: 1,
        laneSpacing: 0,
        standOff: 0,
        bandHalfDepth: 0,
        depthStep: 0
      });
    }
    squadPairById.set(squad.id, key);
  });

  pairMap.forEach((pair) => {
    const [leftId, rightId] = pair.key.split('|');
    const left = byId.get(leftId) || null;
    const right = byId.get(rightId) || null;
    if (!left || !right || left.team === right.team || left.remain <= 0 || right.remain <= 0) return;
    const attacker = left.team === TEAM_ATTACKER ? left : right;
    const defender = attacker === left ? right : left;
    pair.attackerId = attacker.id;
    pair.defenderId = defender.id;
    const dir = normalizeVec((defender.x || 0) - (attacker.x || 0), (defender.y || 0) - (attacker.y || 0));
    pair.dirX = dir.x;
    pair.dirY = dir.y;
    pair.tangentX = -dir.y;
    pair.tangentY = dir.x;
    pair.pairCenterX = ((attacker.x || 0) + (defender.x || 0)) * 0.5;
    pair.pairCenterY = ((attacker.y || 0) + (defender.y || 0)) * 0.5;
    pair.contactX = pair.pairCenterX;
    pair.contactY = pair.pairCenterY;
    const baseSpacing = (toSafeNumber(sim?.engagementAgentDiameter, 4.5) + toSafeNumber(sim?.engagementAgentGap, 1.05));
    pair.laneSpacing = Math.max(2.2, baseSpacing * toSafeNumber(cfg?.laneSpacingMul, 1));
    pair.standOff = Math.max(1.2, pair.laneSpacing * toSafeNumber(cfg?.standOff, 3.2) * 0.25);
    pair.bandHalfDepth = Math.max(pair.laneSpacing, toSafeNumber(cfg?.bandHalfDepth, 8.8));
    pair.depthStep = pair.laneSpacing * Math.max(0.6, toSafeNumber(cfg?.depthStepMul, 0.92));
  });

  return {
    pairs: pairMap,
    squadPairById
  };
};

const resolveDepthLayers = (count, cfg) => {
  const minLayers = Math.max(1, Math.floor(toSafeNumber(cfg?.depthLayersMin, 2)));
  const maxLayers = Math.max(minLayers, Math.floor(toSafeNumber(cfg?.depthLayersMax, 4)));
  const adaptive = Math.max(minLayers, Math.round(Math.sqrt(Math.max(1, count)) * 0.42));
  return clamp(adaptive, minLayers, maxLayers);
};

const resolveSideSign = (team) => (team === TEAM_ATTACKER ? -1 : 1);

const pickLaneIndex = ({
  baseLane = 0,
  prevLane = 0,
  occupancy = new Map(),
  cfg = MELEE_ENGAGEMENT_CONFIG
}) => {
  const searchRadius = Math.max(0, Math.floor(toSafeNumber(cfg?.laneSearchRadius, 3)));
  const maxShift = Math.max(0, Math.floor(toSafeNumber(cfg?.maxLaneShiftPerUpdate, 1)));
  const minLane = Math.min(baseLane - searchRadius, prevLane - maxShift);
  const maxLane = Math.max(baseLane + searchRadius, prevLane + maxShift);
  let bestLane = baseLane;
  let bestScore = Infinity;
  for (let lane = minLane; lane <= maxLane; lane += 1) {
    const shiftPenalty = Math.abs(lane - prevLane) * 1.2;
    if (shiftPenalty > maxShift * 1.25 + 0.01 && maxShift > 0) continue;
    const lanePenalty = Math.abs(lane - baseLane) * toSafeNumber(cfg?.laneDiffWeight, 0.55);
    const occupied = occupancy.get(lane) || 0;
    const occupancyPenalty = occupied * toSafeNumber(cfg?.laneOccupancyWeight, 2.1);
    const score = shiftPenalty + lanePenalty + occupancyPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestLane = lane;
    }
  }
  occupancy.set(bestLane, (occupancy.get(bestLane) || 0) + 1);
  return bestLane;
};

const computeAnchorForAgent = ({
  pair,
  team,
  lane,
  depthRank
}) => {
  const sideSign = resolveSideSign(team);
  const laneOffset = lane * pair.laneSpacing;
  const depthOffset = sideSign * (depthRank * pair.depthStep);
  return {
    x: pair.contactX + (pair.tangentX * laneOffset) + (pair.dirX * (sideSign * pair.standOff + depthOffset)),
    y: pair.contactY + (pair.tangentY * laneOffset) + (pair.dirY * (sideSign * pair.standOff + depthOffset))
  };
};

const tryFindClearLane = ({
  agent,
  pair,
  lane,
  depthRank,
  team,
  walls,
  cfg
}) => {
  const radius = Math.max(1, Math.floor(toSafeNumber(cfg?.laneSearchRadius, 3)));
  for (let shift = 1; shift <= radius; shift += 1) {
    const rightLane = lane + shift;
    const rightAnchor = computeAnchorForAgent({ pair, team, lane: rightLane, depthRank });
    if (hasLineOfSight(agent, rightAnchor, walls, toSafeNumber(cfg?.losInflate, 1.2))) {
      return { lane: rightLane, anchor: rightAnchor };
    }
    const leftLane = lane - shift;
    const leftAnchor = computeAnchorForAgent({ pair, team, lane: leftLane, depthRank });
    if (hasLineOfSight(agent, leftAnchor, walls, toSafeNumber(cfg?.losInflate, 1.2))) {
      return { lane: leftLane, anchor: leftAnchor };
    }
  }
  return null;
};

const applyAgentEngagementMeta = ({
  sideSquad,
  enemySquad,
  agents,
  pair,
  walls,
  dt,
  cfg
}) => {
  if (!sideSquad || !enemySquad || !pair) return { blockedRatio: 0 };
  const meleeAgents = agents.filter((agent) => agent && !agent.dead && isAgentMelee(agent));
  if (meleeAgents.length <= 0) return { blockedRatio: 0 };
  const sorted = [...meleeAgents].sort((a, b) => (a.slotOrder - b.slotOrder) || String(a.id).localeCompare(String(b.id)));
  const depthLayers = resolveDepthLayers(sorted.length, cfg);
  const lanes = Math.max(1, Math.ceil(sorted.length / depthLayers));
  const occupancy = new Map();
  let blockedCount = 0;

  sorted.forEach((agent, index) => {
    const row = Math.floor(index / lanes);
    const col = index % lanes;
    const baseLane = col - ((lanes - 1) / 2);
    const prevLane = Number.isFinite(Number(agent.engageLane)) ? Number(agent.engageLane) : baseLane;
    const lane = pickLaneIndex({ baseLane, prevLane, occupancy, cfg });
    const depthRank = Math.min(depthLayers - 1, row);
    let anchor = computeAnchorForAgent({
      pair,
      team: sideSquad.team,
      lane,
      depthRank
    });
    let blocked = !hasLineOfSight(agent, anchor, walls, toSafeNumber(cfg?.losInflate, 1.2));
    let finalLane = lane;
    if (blocked && (Number(agent.engageBlockedSec) || 0) >= toSafeNumber(cfg?.blockedRetargetSec, 0.62)) {
      const resolved = tryFindClearLane({
        agent,
        pair,
        lane,
        depthRank,
        team: sideSquad.team,
        walls,
        cfg
      });
      if (resolved) {
        finalLane = resolved.lane;
        anchor = resolved.anchor;
        blocked = false;
      }
    }

    const sideSign = resolveSideSign(sideSquad.team);
    const frontX = pair.contactX + (pair.dirX * sideSign * pair.standOff);
    const frontY = pair.contactY + (pair.dirY * sideSign * pair.standOff);
    const frontDx = pair.dirX * sideSign;
    const frontDy = pair.dirY * sideSign;
    const frontGap = Math.max(0, ((frontX - (agent.x || 0)) * frontDx) + ((frontY - (agent.y || 0)) * frontDy));
    const pressureRatio = clamp(frontGap / Math.max(pair.bandHalfDepth + pair.depthStep, 1), 0, 1);
    const weightMul = Math.sqrt(Math.max(1, Number(agent.weight) || 1));
    const pressure = pressureRatio
      * toSafeNumber(cfg?.pressureStrength, 18)
      * Math.pow(weightMul, toSafeNumber(cfg?.pressureFalloff, 0.88));

    agent.engagePairKey = pair.key;
    agent.engageEnemySquadId = enemySquad.id;
    agent.engageLane = finalLane;
    agent.engageDepthRank = depthRank;
    agent.engageAx = anchor.x;
    agent.engageAy = anchor.y;
    agent.engageFrontDx = frontDx;
    agent.engageFrontDy = frontDy;
    agent.engagePressure = pressure;
    agent.engageBlockedSec = blocked
      ? Math.max(0, (Number(agent.engageBlockedSec) || 0) + dt)
      : Math.max(0, (Number(agent.engageBlockedSec) || 0) - (dt * 1.8));
    agent.engageNeedsRetarget = blocked && agent.engageBlockedSec >= toSafeNumber(cfg?.blockedRetargetSec, 0.62);
    if (agent.engageNeedsRetarget) blockedCount += 1;
  });
  return {
    blockedRatio: blockedCount / Math.max(1, sorted.length)
  };
};

export const syncMeleeEngagement = (crowd, sim, walls = [], dt = 0, nowSec = 0) => {
  if (!crowd) return null;
  const enabled = resolveFeatureFlag();
  const cfg = resolveFeatureConfig();
  const nextNow = Number.isFinite(Number(nowSec)) ? Number(nowSec) : 0;
  if (!crowd.engagement) {
    crowd.engagement = {
      enabled,
      config: cfg,
      elapsed: 0,
      pairs: new Map(),
      squadPairById: new Map(),
      lastUpdateSec: 0
    };
  }
  const state = crowd.engagement;
  state.enabled = enabled;
  state.config = cfg;

  if (!enabled) {
    state.pairs = new Map();
    state.squadPairById = new Map();
    (Array.isArray(sim?.squads) ? sim.squads : []).forEach((squad) => clearSquadEngagementMeta(squad));
    crowd.agentsBySquad?.forEach((agents = []) => agents.forEach((agent) => clearAgentEngagementMeta(agent)));
    return state;
  }

  const interval = resolveInterval(cfg);
  state.elapsed = Math.max(0, Number(state.elapsed) || 0) + Math.max(0, Number(dt) || 0);
  const shouldUpdatePairs = state.elapsed >= interval || (nextNow - (Number(state.lastUpdateSec) || 0)) >= interval;
  if (shouldUpdatePairs) {
    const built = buildPairs(sim, walls, cfg, nextNow);
    state.pairs = built.pairs;
    state.squadPairById = built.squadPairById;
    state.lastUpdateSec = nextNow;
    state.elapsed = 0;
  }

  (Array.isArray(sim?.squads) ? sim.squads : []).forEach((squad) => {
    if (!squad || squad.remain <= 0) return;
    squad.engagePairKey = state.squadPairById.get(squad.id) || '';
  });

  crowd.agentsBySquad?.forEach((agents = []) => {
    agents.forEach((agent) => {
      if (!agent || agent.dead) return;
      agent.engagePairKey = '';
      agent.engageEnemySquadId = '';
      agent.engagePressure = 0;
      agent.engageFrontDx = 0;
      agent.engageFrontDy = 0;
      agent.engageNeedsRetarget = false;
      if (!Number.isFinite(Number(agent.engageBlockedSec))) {
        agent.engageBlockedSec = 0;
      }
    });
  });

  state.pairs.forEach((pair) => {
    const attacker = (sim?.squads || []).find((row) => row.id === pair.attackerId && row.remain > 0) || null;
    const defender = (sim?.squads || []).find((row) => row.id === pair.defenderId && row.remain > 0) || null;
    if (!attacker || !defender) return;
    const attackerAgents = crowd.agentsBySquad.get(attacker.id) || [];
    const defenderAgents = crowd.agentsBySquad.get(defender.id) || [];
    const attackerMeta = applyAgentEngagementMeta({
      sideSquad: attacker,
      enemySquad: defender,
      agents: attackerAgents,
      pair,
      walls,
      dt,
      cfg
    });
    const defenderMeta = applyAgentEngagementMeta({
      sideSquad: defender,
      enemySquad: attacker,
      agents: defenderAgents,
      pair,
      walls,
      dt,
      cfg
    });
    if (attackerMeta.blockedRatio >= toSafeNumber(cfg?.blockedSquadRatio, 0.35)) {
      attacker._engageRetargetUntil = nextNow + toSafeNumber(cfg?.retargetCooldownSec, 0.9);
      attacker._engageBlockedTargetId = defender.id;
      if ((!Array.isArray(attacker.waypoints) || attacker.waypoints.length <= 0) && attacker.behavior !== 'retreat') {
        const driftSign = (stableHash(attacker.id) % 2 === 0) ? 1 : -1;
        attacker.waypoints = [{
          x: (attacker.x || 0) + (pair.tangentX * toSafeNumber(cfg?.detourDistance, 14) * driftSign),
          y: (attacker.y || 0) + (pair.tangentY * toSafeNumber(cfg?.detourDistance, 14) * driftSign)
        }];
      }
    }
    if (defenderMeta.blockedRatio >= toSafeNumber(cfg?.blockedSquadRatio, 0.35)) {
      defender._engageRetargetUntil = nextNow + toSafeNumber(cfg?.retargetCooldownSec, 0.9);
      defender._engageBlockedTargetId = attacker.id;
      if ((!Array.isArray(defender.waypoints) || defender.waypoints.length <= 0) && defender.behavior !== 'retreat') {
        const driftSign = (stableHash(defender.id) % 2 === 0) ? -1 : 1;
        defender.waypoints = [{
          x: (defender.x || 0) + (pair.tangentX * toSafeNumber(cfg?.detourDistance, 14) * driftSign),
          y: (defender.y || 0) + (pair.tangentY * toSafeNumber(cfg?.detourDistance, 14) * driftSign)
        }];
      }
    }
  });
  return state;
};
