/**
 * Neutral-camp squad and agent AI implementation.
 * Runtime callers should enter through TrainingNonCardSquadAi.
 */
import { resolveAgentAttackRange } from './attackRange';
import { isTrainingNeutralSquad } from './TrainingSquadKind';
import { isHostileTeam, TEAM_NEUTRAL } from './teamRelations';

export const NEUTRAL_CAMP_AI_STATE = Object.freeze({
  IDLE: 'IDLE',
  PATROL: 'PATROL',
  ALERT: 'ALERT',
  CHASE: 'CHASE',
  ATTACK: 'ATTACK',
  LEASH: 'LEASH',
  DEAD: 'DEAD',
  DISABLED: 'DISABLED'
});

const NEUTRAL_AI_LOCK_SECONDS = 1.35;

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const distanceBetween = (left = {}, right = {}) => Math.hypot(
  finiteNumber(left?.x) - finiteNumber(right?.x),
  finiteNumber(left?.y) - finiteNumber(right?.y)
);

const getSquadMap = (sim = {}) => (
  sim?._squadById instanceof Map
    ? sim._squadById
    : new Map((Array.isArray(sim?.squads) ? sim.squads : []).filter(Boolean).map((row) => [String(row.id || ''), row]))
);

const resolveCamp = (squad = {}, sim = {}) => (
  (Array.isArray(sim?.trainingNeutralCamps) ? sim.trainingNeutralCamps : []).find((camp) => (
    String(camp?.activeSquadId || camp?.squadId || '') === String(squad?.id || '')
  )) || null
);

const resolveCampState = (squad = {}, sim = {}) => String(resolveCamp(squad, sim)?.state || '');

const resolveNeutralTargetId = (squad = {}) => {
  const guardTargetId = String(squad?.guard?.activeTargetId || '').trim();
  if (guardTargetId) return guardTargetId;
  const explicitTargetId = String(squad?.targetSquadId || '').trim();
  if (explicitTargetId) return explicitTargetId;
  const damagedById = String(squad?.lastDamagedBySquadId || '').trim();
  if (damagedById) return damagedById;
  return String(squad?._combatEngagementTargetId || '').trim();
};

const isTargetAlive = (target = null) => !!target && finiteNumber(target?.remain) > 0;

export const clearNeutralCampAiState = (squad = null, agents = []) => {
  if (!squad || typeof squad !== 'object') return;
  delete squad._neutralCampAi;
  delete squad.neutralAiState;
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (agent) delete agent._neutralCampAi;
  });
};

export const ensureNeutralCampAiState = (squad = null, nowSec = 0) => {
  if (!squad || !isTrainingNeutralSquad(squad)) return null;
  if (!squad._neutralCampAi || typeof squad._neutralCampAi !== 'object') {
    squad._neutralCampAi = {
      state: NEUTRAL_CAMP_AI_STATE.IDLE,
      stateEnteredAt: Math.max(0, finiteNumber(nowSec)),
      targetId: '',
      targetKind: '',
      targetRevision: 0,
      events: []
    };
  }
  const ai = squad._neutralCampAi;
  if (!Object.values(NEUTRAL_CAMP_AI_STATE).includes(ai.state)) ai.state = NEUTRAL_CAMP_AI_STATE.IDLE;
  squad.neutralAiState = ai.state;
  return ai;
};

const recordNeutralEvent = (squad = null, sim = null, nowSec = 0, from = '', to = '', reason = '', targetId = '') => {
  if (!squad) return null;
  const event = {
    at: Math.max(0, finiteNumber(nowSec)),
    squadId: String(squad?.id || ''),
    from: String(from || ''),
    to: String(to || ''),
    reason: String(reason || ''),
    targetId: String(targetId || '')
  };
  const ai = squad._neutralCampAi;
  if (ai) ai.events = [...(Array.isArray(ai.events) ? ai.events : []), event].slice(-16);
  if (sim && typeof sim === 'object') {
    sim.neutralCampAiEvents = [
      ...(Array.isArray(sim.neutralCampAiEvents) ? sim.neutralCampAiEvents : []),
      event
    ].slice(-160);
  }
  return event;
};

const transitionNeutralState = ({ squad = null, sim = null, ai = null, nowSec = 0, nextState = NEUTRAL_CAMP_AI_STATE.IDLE, reason = '', targetId = '' } = {}) => {
  if (!squad || !ai) return null;
  const safeNow = Math.max(0, finiteNumber(nowSec));
  const next = Object.values(NEUTRAL_CAMP_AI_STATE).includes(nextState)
    ? nextState
    : NEUTRAL_CAMP_AI_STATE.IDLE;
  const previous = String(ai.state || '');
  if (previous !== next) {
    ai.state = next;
    ai.stateEnteredAt = safeNow;
    ai.targetRevision = Math.max(0, Math.floor(finiteNumber(ai.targetRevision))) + 1;
    recordNeutralEvent(squad, sim, safeNow, previous, next, reason, targetId);
  }
  ai.targetId = String(targetId || '');
  ai.targetKind = ai.targetId ? 'squad' : '';
  squad.neutralAiState = ai.state;
  return ai;
};

export const resolveNeutralCampTarget = (squad = {}, sim = {}) => {
  if (!isTrainingNeutralSquad(squad) || finiteNumber(squad?.remain) <= 0) return null;
  const targetId = resolveNeutralTargetId(squad);
  if (!targetId) return null;
  const target = getSquadMap(sim).get(targetId) || null;
  if (!isTargetAlive(target) || !isHostileTeam(TEAM_NEUTRAL, target?.team)) return null;
  const guard = squad?.guard && typeof squad.guard === 'object' ? squad.guard : null;
  if (guard) {
    const center = { x: finiteNumber(guard?.cx, squad?.x), y: finiteNumber(guard?.cy, squad?.y) };
    const chaseRadius = Math.max(24, finiteNumber(guard?.chaseRadius, 220));
    if (distanceBetween(target, center) > chaseRadius) return null;
  }
  return target;
};

const clearNeutralCombatAssignments = (agents = []) => {
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (!agent) return;
    agent.targetAgentId = '';
    agent.targetBuildingId = '';
    agent.supportTargetAgentId = '';
    agent.supportTargetSquadId = '';
    agent._combatTargetSquadId = '';
    agent._combatTargetLockUntil = 0;
    agent._combatDirective = null;
    agent._neutralCampAi = null;
  });
};

const resolveTargetAgents = (target, crowd = {}) => (
  target
    ? (crowd?.agentsBySquad?.get?.(target.id) || []).filter((agent) => agent && !agent.dead && finiteNumber(agent.weight) > 0.001)
    : []
);

const assignNeutralTargetAgents = ({ squad = {}, target = null, crowd = {} } = {}) => {
  const agents = crowd?.agentsBySquad?.get?.(squad?.id) || [];
  const targetAgents = resolveTargetAgents(target, crowd);
  if (!target || targetAgents.length <= 0) {
    clearNeutralCombatAssignments(agents);
    return;
  }
  agents.forEach((agent) => {
    if (!agent || agent.dead) return;
    agent.targetBuildingId = '';
    agent.supportTargetAgentId = '';
    agent.supportTargetSquadId = '';
    if (agent.unitCategory === 'support') {
      agent.targetAgentId = '';
      agent._combatTargetSquadId = '';
      agent._combatTargetLockUntil = 0;
      return;
    }
    const retained = targetAgents.find((candidate) => String(candidate?.id || '') === String(agent?.targetAgentId || ''));
    const selected = retained || targetAgents.slice().sort((left, right) => (
      distanceBetween(agent, left) - distanceBetween(agent, right)
      || String(left?.id || '').localeCompare(String(right?.id || ''))
    ))[0] || null;
    agent.targetAgentId = String(selected?.id || '');
    agent._combatTargetSquadId = target.id;
    agent._combatTargetLockUntil = Number.POSITIVE_INFINITY;
    agent._neutralCampAi = selected ? { targetId: selected.id, targetSquadId: target.id } : null;
  });
};

export const updateNeutralCampAiFrame = ({ sim = {}, crowd = {}, nowSec = 0 } = {}) => {
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  squads.forEach((squad) => {
    if (!isTrainingNeutralSquad(squad)) return;
    const agents = crowd?.agentsBySquad?.get?.(squad?.id) || [];
    if (finiteNumber(squad?.remain) <= 0) {
      const ai = ensureNeutralCampAiState(squad, nowSec);
      transitionNeutralState({ squad, sim, ai, nowSec, nextState: NEUTRAL_CAMP_AI_STATE.DEAD, reason: 'no-remaining-units' });
      clearNeutralCombatAssignments(agents);
      return;
    }
    const ai = ensureNeutralCampAiState(squad, nowSec);
    const target = resolveNeutralCampTarget(squad, sim);
    const campState = resolveCampState(squad, sim);
    if (target) {
      const attackRange = resolveAgentAttackRange({
        typeCategory: squad?.classTag,
        attackRangeMin: squad?.stats?.attackRange?.min,
        attackRangeMax: squad?.stats?.attackRange?.max
      }, squad);
      const distance = distanceBetween(squad, target);
      transitionNeutralState({
        squad,
        sim,
        ai,
        nowSec,
        nextState: distance <= Math.max(1, finiteNumber(attackRange?.max, 1)) + Math.max(4, finiteNumber(target?.radius, 10))
          ? NEUTRAL_CAMP_AI_STATE.ATTACK
          : NEUTRAL_CAMP_AI_STATE.CHASE,
        reason: distance <= Math.max(1, finiteNumber(attackRange?.max, 1)) ? 'target-in-range' : 'target-detected',
        targetId: target.id
      });
      squad.targetSquadId = String(target.id || '');
      if (squad.guard && typeof squad.guard === 'object') squad.guard.activeTargetId = String(target.id || '');
      squad._combatEngagementTargetId = String(target.id || '');
      squad._combatEngagementUntil = Math.max(
        finiteNumber(squad?._combatEngagementUntil),
        Math.max(0, finiteNumber(nowSec)) + NEUTRAL_AI_LOCK_SECONDS
      );
      assignNeutralTargetAgents({ squad, target, crowd });
      return;
    }
    squad.targetSquadId = '';
    if (squad.guard && typeof squad.guard === 'object') squad.guard.activeTargetId = '';
    squad._combatEngagementTargetId = '';
    squad._combatEngagementUntil = 0;
    clearNeutralCombatAssignments(agents);
    const nextState = campState === 'leashing' || squad?.action === '回位'
      ? NEUTRAL_CAMP_AI_STATE.LEASH
      : (squad?.guard?.patrolTarget ? NEUTRAL_CAMP_AI_STATE.PATROL : NEUTRAL_CAMP_AI_STATE.IDLE);
    transitionNeutralState({ squad, sim, ai, nowSec, nextState, reason: campState || 'camp-idle' });
  });
};

export const updateNeutralCampMovementPlan = ({ sim = {}, nowSec = 0 } = {}) => {
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  squads.forEach((squad) => {
    if (!isTrainingNeutralSquad(squad)) return;
    if (finiteNumber(squad?.remain) <= 0) {
      squad.waypoints = [];
      squad.action = '覆灭';
      return;
    }
    const guard = squad?.guard && typeof squad.guard === 'object' ? squad.guard : null;
    if (!guard) {
      squad.action = Array.isArray(squad?.waypoints) && squad.waypoints.length > 0 ? '移动' : '警戒';
      return;
    }
    const center = {
      x: finiteNumber(guard?.cx, finiteNumber(squad?.x)),
      y: finiteNumber(guard?.cy, finiteNumber(squad?.y))
    };
    const returnRadius = Math.max(8, finiteNumber(guard?.returnRadius, 48));
    const chaseRadius = Math.max(returnRadius + 10, finiteNumber(guard?.chaseRadius, 220));
    const target = resolveNeutralCampTarget(squad, sim);
    if (target) {
      const targetDistance = distanceBetween(squad, target);
      if (targetDistance > chaseRadius) {
        squad.targetSquadId = '';
        guard.activeTargetId = '';
        squad.waypoints = [{ ...center }];
        squad.action = '回位';
        return;
      }
      guard.activeTargetId = String(target.id || '');
      guard.patrolTarget = null;
      squad.targetSquadId = String(target.id || '');
      squad.waypoints = targetDistance > Math.max(1, finiteNumber(squad?.stats?.attackRange?.max, squad?.stats?.range))
        ? [{ x: finiteNumber(target?.x), y: finiteNumber(target?.y) }]
        : [];
      squad.action = '自由攻击';
      return;
    }
    guard.activeTargetId = '';
    const patrolTarget = guard?.patrolTarget && typeof guard.patrolTarget === 'object'
      ? guard.patrolTarget
      : null;
    if (patrolTarget) {
      const patrolDistance = distanceBetween(squad, patrolTarget);
      if (patrolDistance > Math.max(6, finiteNumber(squad?.radius) * 0.42)) {
        if (!Array.isArray(squad.waypoints) || squad.waypoints.length <= 0) {
          squad.waypoints = [{ x: finiteNumber(patrolTarget?.x), y: finiteNumber(patrolTarget?.y) }];
        }
        squad.action = '巡逻';
        return;
      }
      guard.patrolTarget = null;
      squad.waypoints = [];
    }
    const distanceToCenter = distanceBetween(squad, center);
    if (distanceToCenter > returnRadius) {
      squad.waypoints = [{ ...center }];
      squad.action = '回位';
    } else {
      squad.waypoints = [];
      squad.action = '警戒';
    }
  });
};

export const resolveNeutralCampCombatDirective = ({
  agent = {},
  squad = {},
  sim = {},
  crowd = {},
  squadMap = new Map(),
  agentMap = new Map()
} = {}) => {
  if (!isTrainingNeutralSquad(squad) || agent?.unitCategory === 'support') return null;
  const targetSquad = resolveNeutralCampTarget(squad, sim);
  if (!targetSquad) return null;
  const assignedTarget = agentMap.get(String(agent?.targetAgentId || '')) || null;
  const targetAgents = resolveTargetAgents(targetSquad, crowd);
  const targetAgent = assignedTarget && !assignedTarget.dead && String(assignedTarget?.squadId || '') === String(targetSquad?.id || '')
    ? assignedTarget
    : targetAgents.slice().sort((left, right) => (
      distanceBetween(agent, left) - distanceBetween(agent, right)
      || String(left?.id || '').localeCompare(String(right?.id || ''))
    ))[0] || null;
  if (!targetAgent) return null;
  agent.targetAgentId = targetAgent.id;
  agent.targetBuildingId = '';
  agent._combatTargetSquadId = targetSquad.id;
  agent._combatTargetLockUntil = Number.POSITIVE_INFINITY;
  const attackRange = resolveAgentAttackRange(agent, squad);
  const directive = {
    kind: 'neutral-enemy-agent',
    target: targetAgent,
    distance: distanceBetween(agent, targetAgent),
    edgeDistance: Math.max(0, distanceBetween(agent, targetAgent) - finiteNumber(agent?.radius, 2.25) - finiteNumber(targetAgent?.radius, 2.25)),
    attackRange,
    neutralAssigned: true
  };
  agent._combatDirective = directive;
  return directive;
};
