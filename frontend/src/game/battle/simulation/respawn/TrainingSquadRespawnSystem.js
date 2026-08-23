const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const normalizeRespawnDelay = (value, fallback = 20) => Math.max(0, finiteNumber(value, fallback));

const isCombatTeam = (team = '') => team === TEAM_ATTACKER || team === TEAM_DEFENDER;

const hasLivingAgents = (crowd = {}, squadId = '') => (
  (crowd?.agentsBySquad?.get?.(squadId) || []).some((agent) => (
    agent && !agent.dead && finiteNumber(agent?.weight) > 0.001
  ))
);

const hasRespawnPoint = (squad = {}) => (
  Number.isFinite(Number(squad?.respawnPoint?.x))
  && Number.isFinite(Number(squad?.respawnPoint?.y))
);

const resetSquadForRespawn = (squad = {}, point = {}, nowSec = 0) => {
  const facingRad = finiteNumber(point?.facingRad, squad?.initialFacingRad);
  squad.x = finiteNumber(point?.x);
  squad.y = finiteNumber(point?.y);
  squad.centerX = squad.x;
  squad.centerY = squad.y;
  squad.vx = 0;
  squad.vy = 0;
  squad.dirX = Math.cos(facingRad);
  squad.dirY = Math.sin(facingRad);
  squad.smoothedDirX = squad.dirX;
  squad.smoothedDirY = squad.dirY;
  squad._crowdForward = { x: squad.dirX, y: squad.dirY };
  squad._crowdFormationForward = { x: squad.dirX, y: squad.dirY };
  squad._formationPoseX = squad.x;
  squad._formationPoseY = squad.y;
  squad._formationPoseYaw = facingRad;
  squad.remain = Math.max(1, Math.floor(finiteNumber(squad?.startCount, 1)));
  squad.remainUnits = { ...(squad?.units || {}) };
  squad.losses = 0;
  squad.health = Math.max(1, finiteNumber(squad?.maxHealth, squad.remain));
  squad.stamina = 100;
  squad.radius = Math.max(4, finiteNumber(squad?.radius, 10));
  squad.action = '重生完成';
  squad.behavior = squad?.controlMode === 'AI' ? 'auto' : 'idle';
  squad.order = {
    type: 'IDLE',
    issuedAt: Math.max(0, finiteNumber(nowSec)),
    commitUntil: 0,
    targetPoint: null,
    targetSquadId: ''
  };
  squad.waypoints = [];
  squad.targetSquadId = '';
  squad.flagBearerAgentId = '';
  squad.underAttackTimer = 0;
  squad.attackCooldown = 0;
  squad.effectBuff = null;
  squad.statusEffects = [];
  squad.activeSkill = null;
  squad.skillRush = null;
  squad.meleeAttackOrder = null;
  squad.fatigueTimer = 0;
  squad.skillCooldowns = {
    infantry: 0,
    cavalry: 0,
    archer: 0,
    artillery: 0,
    support: 0
  };
  if (squad.formationRect && typeof squad.formationRect === 'object') {
    squad.formationRect = {
      ...squad.formationRect,
      facingRad,
      directionOffsetRad: 0,
      directionRad: facingRad
    };
  }
  if (squad.stability && typeof squad.stability === 'object') {
    squad.stability = {
      ...squad.stability,
      poise: Math.max(0, finiteNumber(squad.stability?.poiseMax, squad.stability?.poise)),
      chargePoiseCurrent: Math.max(0, finiteNumber(squad.stability?.chargePoise, squad.stability?.chargePoiseCurrent)),
      transition: Math.max(0, finiteNumber(squad.stability?.transitionMax, squad.stability?.transition))
    };
  }
};

const queueSquadRespawn = (squad = {}, nowSec = 0, delaySec = 20) => {
  const safeNow = Math.max(0, finiteNumber(nowSec));
  const safeDelay = normalizeRespawnDelay(delaySec);
  squad.remain = 0;
  squad.health = 0;
  squad.action = '重生倒计时';
  squad.behavior = 'standby';
  squad.waypoints = [];
  squad.targetSquadId = '';
  squad.flagBearerAgentId = '';
  squad.respawnState = {
    state: 'waiting',
    queuedAt: safeNow,
    respawnAt: safeNow + safeDelay,
    remainingSec: safeDelay,
    delaySec: safeDelay,
    pointId: String(squad?.respawnPoint?.id || ''),
    lastRespawnAt: Math.max(0, finiteNumber(squad?.respawnState?.lastRespawnAt)),
    cycles: Math.max(0, Math.floor(finiteNumber(squad?.respawnState?.cycles))) + 1
  };
  return squad.respawnState;
};

export const getTrainingSquadRespawnState = (squad = {}, nowSec = 0) => {
  const state = squad?.respawnState && typeof squad.respawnState === 'object'
    ? squad.respawnState
    : null;
  if (!state || state.state !== 'waiting') return null;
  const remainingSec = Math.max(0, finiteNumber(state?.respawnAt) - Math.max(0, finiteNumber(nowSec)));
  return {
    state: 'waiting',
    queuedAt: Math.max(0, finiteNumber(state?.queuedAt)),
    respawnAt: Math.max(0, finiteNumber(state?.respawnAt)),
    remainingSec,
    delaySec: Math.max(0, finiteNumber(state?.delaySec)),
    pointId: String(state?.pointId || ''),
    cycles: Math.max(0, Math.floor(finiteNumber(state?.cycles)))
  };
};

export const updateTrainingSquadRespawns = ({
  sim = {},
  crowd = {},
  nowSec = 0,
  spawnSquad = null
} = {}) => {
  const config = sim?.trainingRespawnConfig && typeof sim.trainingRespawnConfig === 'object'
    ? sim.trainingRespawnConfig
    : null;
  if (!config?.enabled) return { queued: 0, respawned: 0 };
  const safeNow = Math.max(0, finiteNumber(nowSec));
  const delaySec = normalizeRespawnDelay(config?.delaySec);
  let queued = 0;
  let respawned = 0;

  (Array.isArray(sim?.squads) ? sim.squads : []).forEach((squad) => {
    if (!squad || squad?.isNeutralCampUnit === true || !isCombatTeam(squad?.team) || !hasRespawnPoint(squad)) return;
    const waiting = getTrainingSquadRespawnState(squad, safeNow);
    const defeated = finiteNumber(squad?.remain) <= 0 || !hasLivingAgents(crowd, squad.id);
    if (!waiting && !defeated) return;
    if (!waiting) {
      queueSquadRespawn(squad, safeNow, delaySec);
      queued += 1;
      return;
    }
    squad.respawnState.remainingSec = waiting.remainingSec;
    squad.action = '重生倒计时';
    if (waiting.remainingSec > 0.0001) return;
    resetSquadForRespawn(squad, squad.respawnPoint, safeNow);
    const spawned = typeof spawnSquad === 'function' ? spawnSquad(squad) : null;
    if (!Array.isArray(spawned) || spawned.length <= 0) {
      queueSquadRespawn(squad, safeNow, delaySec);
      return;
    }
    squad.respawnState = {
      state: 'alive',
      queuedAt: 0,
      respawnAt: 0,
      remainingSec: 0,
      delaySec,
      pointId: String(squad?.respawnPoint?.id || ''),
      lastRespawnAt: safeNow,
      cycles: Math.max(1, Math.floor(finiteNumber(waiting?.cycles)))
    };
    respawned += 1;
  });

  return { queued, respawned };
};
