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
