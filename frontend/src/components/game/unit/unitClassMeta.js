export const UNIT_CLASS_META = Object.freeze({
  infantry: { key: 'infantry', label: '步兵', mark: '步', color: '#3b82f6', floor: 0x2563eb },
  cavalry: { key: 'cavalry', label: '骑兵', mark: '骑', color: '#f59e0b', floor: 0xd97706 },
  archer: { key: 'archer', label: '弓兵', mark: '弓', color: '#22c55e', floor: 0x15803d },
  artillery: { key: 'artillery', label: '炮兵', mark: '炮', color: '#ef4444', floor: 0xdc2626 }
});

export const resolveUnitClassMeta = (unit = {}) => {
  const classTag = typeof unit?.classTag === 'string' ? unit.classTag.trim().toLowerCase() : '';
  if (UNIT_CLASS_META[classTag]) return UNIT_CLASS_META[classTag];
  const name = typeof unit?.name === 'string' ? unit.name : '';
  const roleTag = unit?.roleTag === '远程' ? '远程' : '近战';
  const speed = Number(unit?.speed) || 0;
  const range = Number(unit?.range) || 0;
  if (/(炮|投石|火炮|炮兵|臼炮|加农)/.test(name)) return UNIT_CLASS_META.artillery;
  if (/(弓|弩|弓兵|弩兵|射手)/.test(name) || (roleTag === '远程' && range >= 3)) return UNIT_CLASS_META.archer;
  if (/(骑|骑兵|铁骑|龙骑)/.test(name) || speed >= 2.1) return UNIT_CLASS_META.cavalry;
  return UNIT_CLASS_META.infantry;
};
