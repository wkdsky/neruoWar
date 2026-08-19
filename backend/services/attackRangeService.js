const toFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const isRangedUnit = (source = {}) => (
  source?.roleTag === '远程'
  || source?.unitCategory === 'ranged'
  || source?.unitCategory === 'support'
  || source?.rpsType === 'ranged'
  || source?.rpsType === 'support'
  || source?.classTag === 'archer'
  || source?.classTag === 'artillery'
);

const normalizeAttackRange = (source = {}) => {
  const raw = source?.attackRange && typeof source.attackRange === 'object'
    ? source.attackRange
    : {};
  const ranged = isRangedUnit(source);
  const rawMax = toFiniteNumber(raw.max ?? source?.attackRangeMax ?? source?.range);
  const max = Math.max(1, rawMax ?? (ranged ? 6 : 1));
  const rawMin = toFiniteNumber(raw.min ?? source?.attackRangeMin);
  const rangedFallbackMin = Math.min(max, Math.max(2, Math.min(3, max)));
  const min = Math.min(
    max,
    Math.max(0, rawMin ?? (ranged ? rangedFallbackMin : 1))
  );
  return { min, max };
};

module.exports = {
  isRangedUnit,
  normalizeAttackRange
};
