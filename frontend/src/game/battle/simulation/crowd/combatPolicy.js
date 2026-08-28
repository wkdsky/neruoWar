import {
  isTrainingCardAiSquad,
  isTrainingMinionSquad,
  isTrainingNeutralSquad
} from './TrainingSquadKind';

export const ORDER_IDLE = 'IDLE';
export const ORDER_MOVE = 'MOVE';
export const ORDER_ATTACK_MOVE = 'ATTACK_MOVE';
export const ORDER_CHARGE = 'CHARGE';

export const resolveSquadCombatOrderType = (squad = {}) => (
  typeof squad?.order?.type === 'string' ? squad.order.type : ''
);

export const isSquadPassiveUserMove = (squad = {}) => (
  squad?.controlMode === 'USER'
  && !squad?.guard?.enabled
  && resolveSquadCombatOrderType(squad) === ORDER_MOVE
);

export const isTargetOnlyAttackOrder = (squad = {}) => (
  resolveSquadCombatOrderType(squad) === ORDER_ATTACK_MOVE
  && squad?.order?.stopAfterTarget === true
);

export const completeTargetOnlyAttackOrder = (squad = {}, nowSec = 0) => {
  if (!isTargetOnlyAttackOrder(squad)) return false;
  squad.autoNavigation = null;
  squad.targetSquadId = '';
  squad.targetBuildingId = '';
  squad._combatEngagementTargetId = '';
  squad._combatEngagementUntil = 0;
  squad._attackMoveResumeWaypoints = [];
  squad._plannedMoveWaypoints = [];
  squad._plannedMoveWaypointIndex = 0;
  if (isTrainingCardAiSquad(squad)) {
    squad._trainingAiSelection = null;
    squad._trainingAiDecisionDeferred = false;
    squad._trainingAiTargetCache = null;
    squad._trainingTargetNavigation = null;
  }
  squad._navigationWaitUntil = 0;
  squad.waypoints = [];
  squad.vx = 0;
  squad.vy = 0;
  squad.speed = 0;
  squad.behavior = 'idle';
  squad.action = '待命';
  squad.order = {
    type: ORDER_IDLE,
    issuedAt: Math.max(0, Number(nowSec) || 0),
    commitUntil: 0,
    targetPoint: null,
    targetSquadId: '',
    targetBuildingId: '',
    pathPoints: [],
    pathIndex: 0
  };
  return true;
};

export const isSquadCombatEnabled = (squad = {}) => {
  if (!squad || (Number(squad?.remain) || 0) <= 0) return false;
  if (isTrainingNeutralSquad(squad)) {
    return (Number(squad?.underAttackTimer) || 0) > 0.05
      || !!String(squad?.targetSquadId || '').trim()
      || !!String(squad?._combatEngagementTargetId || '').trim();
  }
  const behavior = typeof squad?.behavior === 'string' ? squad.behavior : '';
  if (behavior === 'retreat' || behavior === 'standby' || behavior === 'disabled') return false;
  if (squad?.guard?.enabled) return true;
  const orderType = resolveSquadCombatOrderType(squad);
  if (orderType === ORDER_ATTACK_MOVE || orderType === ORDER_CHARGE) return true;
  if (isTrainingMinionSquad(squad)) return true;
  if (squad?.controlMode === 'USER') return false;
  return behavior === 'auto'
    || behavior === 'guard'
    || behavior === 'defend'
    || behavior === 'move'
    || behavior === 'skill'
    || squad?.controlMode === 'AI';
};
