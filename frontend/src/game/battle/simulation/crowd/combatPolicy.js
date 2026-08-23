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

export const isSquadCombatEnabled = (squad = {}) => {
  if (!squad || (Number(squad?.remain) || 0) <= 0) return false;
  const behavior = typeof squad?.behavior === 'string' ? squad.behavior : '';
  if (behavior === 'retreat' || behavior === 'standby' || behavior === 'disabled') return false;
  if (squad?.guard?.enabled) return true;
  const orderType = resolveSquadCombatOrderType(squad);
  if (orderType === ORDER_ATTACK_MOVE || orderType === ORDER_CHARGE) return true;
  if (squad?.isMinionWaveUnit === true) return true;
  if (squad?.controlMode === 'USER') return false;
  return behavior === 'auto'
    || behavior === 'guard'
    || behavior === 'defend'
    || behavior === 'move'
    || behavior === 'skill'
    || squad?.controlMode === 'AI';
};
