const toFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const isRangedSource = (source = {}) => (
  source?.roleTag === '远程'
  || source?.unitCategory === 'ranged'
  || source?.unitCategory === 'support'
  || source?.rpsType === 'ranged'
  || source?.rpsType === 'support'
  || source?.classTag === 'archer'
  || source?.classTag === 'artillery'
);

export const normalizeAttackRange = (source = {}) => {
  const raw = source?.attackRange && typeof source.attackRange === 'object'
    ? source.attackRange
    : ((Object.prototype.hasOwnProperty.call(source, 'min') || Object.prototype.hasOwnProperty.call(source, 'max'))
      ? source
      : {});
  const ranged = isRangedSource(source);
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

const formatRangeValue = (value) => {
  const numeric = Number(value) || 0;
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1).replace(/\.0$/, '');
};

export const formatAttackRange = (source = {}) => {
  const { min, max } = normalizeAttackRange(source);
  if (Math.abs(max - min) < 0.001) return formatRangeValue(max);
  return `${formatRangeValue(min)}–${formatRangeValue(max)}`;
};

export const getAttackRangeMax = (source = {}) => normalizeAttackRange(source).max;
