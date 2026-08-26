export const TEAM_ATTACKER = 'attacker';
export const TEAM_DEFENDER = 'defender';
export const TEAM_NEUTRAL = 'neutral';

const COMBAT_TEAMS = new Set([
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  TEAM_NEUTRAL
]);

export const isCombatTeam = (team = '') => COMBAT_TEAMS.has(String(team || '').trim());

export const isHostileTeam = (sourceTeam = '', targetTeam = '') => {
  const source = String(sourceTeam || '').trim();
  const target = String(targetTeam || '').trim();
  return source !== target && isCombatTeam(source) && isCombatTeam(target);
};

export const resolveDefaultHostileTeam = (team = '') => (
  team === TEAM_ATTACKER ? TEAM_DEFENDER : TEAM_ATTACKER
);

export const isNeutralRetaliating = (squad = {}) => (
  squad?.team === TEAM_NEUTRAL
  && (
    (Number(squad?.underAttackTimer) || 0) > 0.05
    || !!String(squad?.targetSquadId || '').trim()
    || !!String(squad?._combatEngagementTargetId || '').trim()
  )
);

export const canAcquireSquadTarget = (sourceSquad = {}, targetSquad = {}) => {
  if (!isHostileTeam(sourceSquad?.team, targetSquad?.team)) return false;
  if (targetSquad?.team !== TEAM_NEUTRAL) return true;
  const explicitTargetId = String(
    sourceSquad?.order?.targetSquadId
      || sourceSquad?.targetSquadId
      || ''
  ).trim();
  if (explicitTargetId && explicitTargetId === String(targetSquad?.id || '').trim()) return true;
  return isNeutralRetaliating(targetSquad);
};
