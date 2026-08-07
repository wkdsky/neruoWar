import { resolveUnitClassification } from '../../../game/unit/types';

export const UNIT_CLASS_META = Object.freeze({
  infantry: { key: 'infantry', label: '步兵', mark: '步', color: '#3b82f6', floor: 0x2563eb },
  cavalry: { key: 'cavalry', label: '骑兵', mark: '骑', color: '#f59e0b', floor: 0xd97706 },
  archer: { key: 'archer', label: '弓兵', mark: '弓', color: '#22c55e', floor: 0x15803d },
  artillery: { key: 'artillery', label: '炮兵', mark: '炮', color: '#ef4444', floor: 0xdc2626 }
});

export const UNIT_CATEGORY_LABELS = Object.freeze({ melee: '近战', ranged: '远程', support: '辅助' });
export const UNIT_SUBTYPE_LABELS = Object.freeze({
  mobility: '机动型',
  defense: '防御型',
  balance: '平衡型',
  combination: '组合型',
  comprehensive: '全面型',
  intervention: '干预型'
});

const UNIT_CATEGORY_META = Object.freeze({
  melee: { label: '近战', legacyKey: 'infantry', color: '#e53935' },
  ranged: { label: '远程', legacyKey: 'archer', color: '#1e88e5' },
  support: { label: '辅助', legacyKey: 'archer', color: '#43a047' }
});

const getUnitPaletteColor = (unit = {}, fallback = '') => {
  const color = unit?.visuals?.preview?.palette?.primary;
  return typeof color === 'string' && color.trim() ? color.trim() : fallback;
};

export const formatUnitClassLabel = (unit = {}) => {
  const { unitCategory, unitSubtype } = resolveUnitClassification(unit);
  const categoryLabel = UNIT_CATEGORY_LABELS[unitCategory] || '近战';
  const subtypeLabel = UNIT_SUBTYPE_LABELS[unitSubtype] || '通用型';
  return `${categoryLabel}-${subtypeLabel}`;
};

export const resolveUnitClassMeta = (unit = {}) => {
  const { unitCategory: resolvedCategory, unitSubtype: resolvedSubtype } = resolveUnitClassification(unit);
  const category = resolvedCategory;
  if (UNIT_CATEGORY_META[category]) {
    const categoryMeta = UNIT_CATEGORY_META[category];
    const categoryLabel = UNIT_CATEGORY_LABELS[category] || categoryMeta.label;
    const subtypeLabel = UNIT_SUBTYPE_LABELS[resolvedSubtype] || '通用型';
    const legacyMeta = UNIT_CLASS_META[categoryMeta.legacyKey];
    return {
      ...legacyMeta,
      label: formatUnitClassLabel(unit),
      categoryLabel,
      subtypeLabel,
      color: getUnitPaletteColor(unit, categoryMeta.color)
    };
  }
  const classTag = typeof unit?.classTag === 'string' ? unit.classTag.trim().toLowerCase() : '';
  if (UNIT_CLASS_META[classTag]) {
    return {
      ...UNIT_CLASS_META[classTag],
      color: getUnitPaletteColor(unit, UNIT_CLASS_META[classTag].color)
    };
  }
  const name = typeof unit?.name === 'string' ? unit.name : '';
  const roleTag = unit?.roleTag === '远程' ? '远程' : '近战';
  const speed = Number(unit?.speed) || 0;
  const range = Number(unit?.range) || 0;
  if (/(炮|投石|火炮|炮兵|臼炮|加农)/.test(name)) return UNIT_CLASS_META.artillery;
  if (/(弓|弩|弓兵|弩兵|射手)/.test(name) || (roleTag === '远程' && range >= 3)) return UNIT_CLASS_META.archer;
  if (/(骑|骑兵|铁骑|龙骑)/.test(name) || speed >= 2.1) return UNIT_CLASS_META.cavalry;
  return UNIT_CLASS_META.infantry;
};
