export const ATTACK_RANGE_WORLD_SCALE = 14;

const toFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const isRangedSquad = (squad = {}) => (
  squad?.classTag === 'archer'
  || squad?.classTag === 'artillery'
  || squad?.roleTag === '远程'
  || squad?.stats?.roleTag === '远程'
  || squad?.stats?.unitCategory === 'ranged'
  || squad?.stats?.unitCategory === 'support'
  || (Number(squad?.stats?.attackRange?.max ?? squad?.stats?.attackRangeMax ?? squad?.stats?.range) || 0) >= 2.2
);

const getGridAttackRange = (squad = {}) => {
  const stats = squad?.stats && typeof squad.stats === 'object' ? squad.stats : {};
  const raw = stats?.attackRange && typeof stats.attackRange === 'object' ? stats.attackRange : {};
  const max = Math.max(1, toFiniteNumber(raw.max ?? stats.attackRangeMax ?? stats.range) || 1);
  const rawMin = toFiniteNumber(raw.min ?? stats.attackRangeMin);
  const rangedFallbackMin = Math.min(max, Math.max(2, Math.min(3, max)));
  return {
    min: Math.min(max, Math.max(0, rawMin ?? (isRangedSquad(squad) ? rangedFallbackMin : 0))),
    max
  };
};

export const resolveSquadAttackRange = (squad = {}) => {
  const range = getGridAttackRange(squad);
  if (!isRangedSquad(squad)) {
    if (squad?.classTag === 'cavalry') {
      return { min: 0, max: Math.max(7.4, range.max * 16) };
    }
    return { min: 0, max: 6.2 };
  }
  const max = Math.max(20, range.max * ATTACK_RANGE_WORLD_SCALE);
  return {
    min: Math.min(max, Math.max(0, range.min * ATTACK_RANGE_WORLD_SCALE)),
    max
  };
};

export const isDistanceWithinSquadAttackRange = (distance, range = {}) => {
  const numeric = Number(distance);
  if (!Number.isFinite(numeric)) return false;
  const min = Math.max(0, Number(range?.min) || 0);
  const max = Math.max(min, Number(range?.max) || 0);
  return numeric >= min - 0.001 && numeric <= max + 0.001;
};
