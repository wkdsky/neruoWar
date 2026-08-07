export const UNIT_CATEGORY_TYPES = ['melee', 'ranged', 'support'];
export const UNIT_SUBTYPE_TYPES = ['mobility', 'defense', 'balance', 'combination', 'comprehensive', 'intervention'];
export const UNIT_SUBTYPE_BY_CATEGORY = Object.freeze({
  melee: ['mobility', 'defense', 'balance'],
  ranged: ['mobility', 'defense', 'balance'],
  support: ['combination', 'comprehensive', 'intervention']
});
export const UNIT_RPS_TYPES = UNIT_CATEGORY_TYPES;
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
  return 'melee';
};

export const normalizeUnitCategory = (value) => {
  const key = toStringId(value);
  if (UNIT_CATEGORY_TYPES.includes(key)) return key;
  return 'melee';
};

export const normalizeUnitSubtype = (value, category = 'melee') => {
  const key = toStringId(value);
  const allowed = UNIT_SUBTYPE_BY_CATEGORY[category] || UNIT_SUBTYPE_BY_CATEGORY.melee;
  if (allowed.includes(key)) return key;
  return allowed[allowed.length - 1] || 'balance';
};

export const CANONICAL_UNIT_CLASSIFICATION = Object.freeze({
  u_melee_mobility: Object.freeze({ unitCategory: 'melee', unitSubtype: 'mobility' }),
  u_melee_defense: Object.freeze({ unitCategory: 'melee', unitSubtype: 'defense' }),
  u_melee_balance: Object.freeze({ unitCategory: 'melee', unitSubtype: 'balance' }),
  u_ranged_mobility: Object.freeze({ unitCategory: 'ranged', unitSubtype: 'mobility' }),
  u_ranged_defense: Object.freeze({ unitCategory: 'ranged', unitSubtype: 'defense' }),
  u_ranged_balance: Object.freeze({ unitCategory: 'ranged', unitSubtype: 'balance' }),
  u_support_combination: Object.freeze({ unitCategory: 'support', unitSubtype: 'combination' }),
  u_support_comprehensive: Object.freeze({ unitCategory: 'support', unitSubtype: 'comprehensive' }),
  u_support_intervention: Object.freeze({ unitCategory: 'support', unitSubtype: 'intervention' })
});

const CANONICAL_UNIT_CLASSIFICATION_BY_PROFESSION = Object.freeze({
  'melee.mobility': CANONICAL_UNIT_CLASSIFICATION.u_melee_mobility,
  'melee.defense': CANONICAL_UNIT_CLASSIFICATION.u_melee_defense,
  'melee.balance': CANONICAL_UNIT_CLASSIFICATION.u_melee_balance,
  'ranged.mobility': CANONICAL_UNIT_CLASSIFICATION.u_ranged_mobility,
  'ranged.defense': CANONICAL_UNIT_CLASSIFICATION.u_ranged_defense,
  'ranged.balance': CANONICAL_UNIT_CLASSIFICATION.u_ranged_balance,
  'support.combination': CANONICAL_UNIT_CLASSIFICATION.u_support_combination,
  'support.comprehensive': CANONICAL_UNIT_CLASSIFICATION.u_support_comprehensive,
  'support.intervention': CANONICAL_UNIT_CLASSIFICATION.u_support_intervention
});

export const resolveUnitClassification = (unit = {}) => {
  const unitTypeId = toStringId(unit?.unitTypeId || unit?.id);
  const professionId = toStringId(unit?.professionId);
  const canonical = CANONICAL_UNIT_CLASSIFICATION[unitTypeId]
    || CANONICAL_UNIT_CLASSIFICATION_BY_PROFESSION[professionId]
    || null;
  const unitCategory = canonical?.unitCategory || normalizeUnitCategory(unit?.unitCategory || unit?.rpsType);
  const unitSubtype = canonical?.unitSubtype || normalizeUnitSubtype(unit?.unitSubtype, unitCategory);
  return { unitCategory, unitSubtype };
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
