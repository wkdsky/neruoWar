const UNIT_TYPE_DTO_VERSION = 2;
const { resolveUnitPalette } = require('../seed/unitCatalogFactory');

const CLASS_TAGS = new Set(['infantry', 'cavalry', 'archer', 'artillery']);
const UNIT_CATEGORY_SET = new Set(['melee', 'ranged', 'support']);
const UNIT_SUBTYPE_BY_CATEGORY = {
  melee: new Set(['mobility', 'defense', 'balance']),
  ranged: new Set(['mobility', 'defense', 'balance']),
  support: new Set(['combination', 'comprehensive', 'intervention'])
};

const CANONICAL_UNIT_CLASSIFICATION = Object.freeze({
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

const normalizeClassTag = (value = '', fallback = 'infantry') => {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (CLASS_TAGS.has(key)) return key;
  const fallbackKey = typeof fallback === 'string' ? fallback.trim().toLowerCase() : '';
  return CLASS_TAGS.has(fallbackKey) ? fallbackKey : '';
};

const normalizeUnitCategory = (value = '') => {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UNIT_CATEGORY_SET.has(key) ? key : 'melee';
};

const normalizeUnitSubtype = (value = '', category = 'melee') => {
  const allowed = UNIT_SUBTYPE_BY_CATEGORY[category] || UNIT_SUBTYPE_BY_CATEGORY.melee;
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (allowed.has(key)) return key;
  return category === 'support' ? 'comprehensive' : 'balance';
};

const resolveUnitClassification = (unitType = {}) => {
  const unitTypeId = normalizeStringId(unitType?.unitTypeId || unitType?.id);
  const professionId = normalizeStringId(unitType?.professionId);
  const canonical = CANONICAL_UNIT_CLASSIFICATION[unitTypeId]
    || CANONICAL_UNIT_CLASSIFICATION_BY_PROFESSION[professionId]
    || null;
  const unitCategory = canonical?.unitCategory || normalizeUnitCategory(unitType?.unitCategory || unitType?.rpsType);
  const unitSubtype = canonical?.unitSubtype || normalizeUnitSubtype(unitType?.unitSubtype, unitCategory);
  return { unitCategory, unitSubtype };
};

const inferClassTag = (unitType = {}) => {
  const explicit = typeof unitType?.classTag === 'string' ? unitType.classTag.trim().toLowerCase() : '';
  if (CLASS_TAGS.has(explicit)) return explicit;
  const { unitCategory, unitSubtype } = resolveUnitClassification(unitType);
  if (unitCategory === 'melee') return unitSubtype === 'mobility' ? 'cavalry' : 'infantry';
  if (unitCategory === 'ranged') return unitSubtype === 'defense' ? 'artillery' : 'archer';
  if (unitCategory === 'support') return 'archer';
  const name = typeof unitType?.name === 'string' ? unitType.name : '';
  const roleTag = unitType?.roleTag === '远程' ? '远程' : '近战';
  const speed = Number(unitType?.speed) || 0;
  const range = Number(unitType?.range) || 0;
  if (/(炮|投石|火炮|炮兵|臼炮|加农)/.test(name)) return 'artillery';
  if (/(弓|弩|弓兵|弩兵|射手)/.test(name) || (roleTag === '远程' && range >= 3)) return 'archer';
  if (/(骑|骑兵|铁骑|龙骑)/.test(name) || speed >= 2.1) return 'cavalry';
  return 'infantry';
};

const normalizeStringId = (value = '') => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text;
};

const normalizeIdArray = (value = []) => (
  (Array.isArray(value) ? value : [])
    .map((item) => normalizeStringId(item))
    .filter(Boolean)
);

const toPlain = (doc = {}) => (
  doc && typeof doc.toObject === 'function'
    ? doc.toObject()
    : (doc || {})
);

const toComponentRef = (componentsById, componentId) => {
  const key = normalizeStringId(componentId);
  if (!key || !(componentsById instanceof Map)) return null;
  return componentsById.get(key) || null;
};

const resolveVisuals = (src = {}, paletteFallback = {}) => {
  const battleVisual = src?.visuals?.battle && typeof src.visuals.battle === 'object' ? src.visuals.battle : {};
  const previewVisual = src?.visuals?.preview && typeof src.visuals.preview === 'object' ? src.visuals.preview : {};
  const fallbackPalette = paletteFallback && typeof paletteFallback === 'object' ? paletteFallback : {};
  const bodyLayer = Math.max(0, Math.floor(Number(battleVisual.bodyLayer) || 0));
  const gearLayer = Math.max(0, Math.floor(Number(battleVisual.gearLayer) || 0));
  const vehicleLayer = Math.max(0, Math.floor(Number(battleVisual.vehicleLayer) || 0));
  const silhouetteLayer = Math.max(0, Math.floor(Number(battleVisual.silhouetteLayer) || 0));
  const spriteFrontLayer = Math.max(0, Math.floor(Number(battleVisual.spriteFrontLayer ?? bodyLayer) || 0));
  const rawTopLayer = Number(battleVisual.spriteTopLayer);
  const spriteTopLayer = Number.isFinite(rawTopLayer) ? Math.max(0, Math.floor(rawTopLayer)) : null;
  return {
    battle: {
      bodyLayer,
      gearLayer,
      vehicleLayer,
      silhouetteLayer,
      tint: Number.isFinite(Number(battleVisual.tint)) ? Number(battleVisual.tint) : 0,
      spriteFrontLayer,
      spriteTopLayer
    },
    preview: {
      style: normalizeStringId(previewVisual.style) || 'procedural',
      palette: {
        primary: typeof previewVisual?.palette?.primary === 'string' ? previewVisual.palette.primary : (fallbackPalette.primary || '#5aa3ff'),
        secondary: typeof previewVisual?.palette?.secondary === 'string' ? previewVisual.palette.secondary : (fallbackPalette.secondary || '#cfd8e3'),
        accent: typeof previewVisual?.palette?.accent === 'string' ? previewVisual.palette.accent : (fallbackPalette.accent || '#ffd166')
      }
    }
  };
};

const toUnitTypeDtoV2 = (unitTypeDoc, componentsById = null) => {
  const src = toPlain(unitTypeDoc);
  const unitTypeId = normalizeStringId(src.unitTypeId || src.id);
  const tier = Math.max(1, Math.floor(Number(src.tier ?? src.level) || 1));
  const bodyId = normalizeStringId(src.bodyId) || null;
  const weaponIds = normalizeIdArray(src.weaponIds);
  const vehicleId = normalizeStringId(src.vehicleId) || null;
  const behaviorProfileId = normalizeStringId(src.behaviorProfileId) || null;
  const stabilityProfileId = normalizeStringId(src.stabilityProfileId) || null;
  const { unitCategory, unitSubtype } = resolveUnitClassification(src);
  const visuals = resolveVisuals(src, resolveUnitPalette(unitCategory, unitSubtype));
  const fallbackClassTag = inferClassTag(src);
  const classTag = normalizeClassTag(src.classTag, fallbackClassTag) || 'infantry';

  return {
    schemaVersion: UNIT_TYPE_DTO_VERSION,
    id: unitTypeId,
    unitTypeId,
    name: normalizeStringId(src.name) || unitTypeId || '未知兵种',
    roleTag: src.roleTag === '远程' ? '远程' : '近战',
    unitCategory,
    unitSubtype,
    rpsType: normalizeUnitCategory(src.rpsType || unitCategory),
    classTag,
    tier,
    level: tier,
    speed: Math.max(0.01, Number(src.speed) || 1),
    hp: Math.max(1, Number(src.hp) || 1),
    atk: Math.max(0, Number(src.atk) || 0),
    def: Math.max(0, Number(src.def) || 0),
    range: Math.max(1, Number(src.range) || 1),
    costKP: Math.max(1, Math.floor(Number(src.costKP) || 1)),
    enabled: src.enabled !== false,
    professionId: normalizeStringId(src.professionId),
    rarity: typeof src.rarity === 'string' && src.rarity ? src.rarity : 'common',
    sortOrder: Number(src.sortOrder) || 0,
    nextUnitTypeId: normalizeStringId(src.nextUnitTypeId) || null,
    upgradeCostKP: Number.isFinite(Number(src.upgradeCostKP)) ? Math.max(0, Number(src.upgradeCostKP)) : null,
    tags: Array.isArray(src.tags) ? src.tags.map((tag) => normalizeStringId(tag)).filter(Boolean) : [],
    description: typeof src.description === 'string' ? src.description.trim() : '',
    bodyId,
    weaponIds,
    vehicleId,
    behaviorProfileId,
    stabilityProfileId,
    components: {
      bodyId,
      weaponIds,
      vehicleId,
      behaviorProfileId,
      stabilityProfileId,
      body: toComponentRef(componentsById, bodyId),
      weapon: weaponIds.map((id) => toComponentRef(componentsById, id)).filter(Boolean),
      vehicle: toComponentRef(componentsById, vehicleId),
      behaviorProfile: toComponentRef(componentsById, behaviorProfileId),
      stabilityProfile: toComponentRef(componentsById, stabilityProfileId),
      interactionRule: toComponentRef(componentsById, 'rule_rps_triangle')
    },
    visuals,
    createdAt: src.createdAt || null,
    updatedAt: src.updatedAt || null
  };
};

module.exports = {
  UNIT_TYPE_DTO_VERSION,
  CANONICAL_UNIT_CLASSIFICATION,
  resolveUnitClassification,
  toUnitTypeDtoV1: toUnitTypeDtoV2,
  toUnitTypeDtoV2,
  inferClassTag,
  normalizeClassTag
};
