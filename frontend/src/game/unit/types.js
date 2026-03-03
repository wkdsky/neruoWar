export const UNIT_RPS_TYPES = ['mobility', 'ranged', 'defense'];
export const UNIT_RARITY_TYPES = ['common', 'rare', 'epic', 'legend'];

export const clampNumber = (value, fallback = 0, min = -Infinity, max = Infinity) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
};

export const toInt = (value, fallback = 0, min = -Infinity, max = Infinity) => (
  Math.floor(clampNumber(value, fallback, min, max))
);

export const toStringId = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text;
};

export const ensureStringArray = (value) => (
  (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
);

export const normalizeRpsType = (value) => {
  const key = toStringId(value);
  if (UNIT_RPS_TYPES.includes(key)) return key;
  return 'mobility';
};

export const normalizeRarity = (value) => {
  const key = toStringId(value);
  if (UNIT_RARITY_TYPES.includes(key)) return key;
  return 'common';
};

export const normalizeRoleTag = (roleTag, range = 1) => {
  if (roleTag === '远程') return '远程';
  if (Number(range) >= 2.2) return '远程';
  return '近战';
};
