const UNIT_TYPE_DTO_VERSION = 1;

const CLASS_TAGS = new Set(['infantry', 'cavalry', 'archer', 'artillery']);

const normalizeClassTag = (value = '', fallback = 'infantry') => {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (CLASS_TAGS.has(key)) return key;
  const fallbackKey = typeof fallback === 'string' ? fallback.trim().toLowerCase() : '';
  return CLASS_TAGS.has(fallbackKey) ? fallbackKey : '';
};

const inferClassTag = (unitType = {}) => {
  const explicit = typeof unitType?.classTag === 'string' ? unitType.classTag.trim().toLowerCase() : '';
  if (CLASS_TAGS.has(explicit)) return explicit;
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

const resolveVisuals = (src = {}) => {
  const battleVisual = src?.visuals?.battle && typeof src.visuals.battle === 'object' ? src.visuals.battle : {};
  const previewVisual = src?.visuals?.preview && typeof src.visuals.preview === 'object' ? src.visuals.preview : {};
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
        primary: typeof previewVisual?.palette?.primary === 'string' ? previewVisual.palette.primary : '#5aa3ff',
        secondary: typeof previewVisual?.palette?.secondary === 'string' ? previewVisual.palette.secondary : '#cfd8e3',
        accent: typeof previewVisual?.palette?.accent === 'string' ? previewVisual.palette.accent : '#ffd166'
      }
    }
  };
};

const toUnitTypeDtoV1 = (unitTypeDoc, componentsById = null) => {
  const src = toPlain(unitTypeDoc);
  const unitTypeId = normalizeStringId(src.unitTypeId || src.id);
  const tier = Math.max(1, Math.floor(Number(src.tier ?? src.level) || 1));
  const bodyId = normalizeStringId(src.bodyId) || null;
  const weaponIds = normalizeIdArray(src.weaponIds);
  const vehicleId = normalizeStringId(src.vehicleId) || null;
  const abilityIds = normalizeIdArray(src.abilityIds);
  const behaviorProfileId = normalizeStringId(src.behaviorProfileId) || null;
  const stabilityProfileId = normalizeStringId(src.stabilityProfileId) || null;
  const visuals = resolveVisuals(src);
  const fallbackClassTag = inferClassTag(src);
  const classTag = normalizeClassTag(src.classTag, fallbackClassTag) || 'infantry';

  return {
    schemaVersion: UNIT_TYPE_DTO_VERSION,
    id: unitTypeId,
    unitTypeId,
    name: normalizeStringId(src.name) || unitTypeId || '未知兵种',
    roleTag: src.roleTag === '远程' ? '远程' : '近战',
    rpsType: src.rpsType === 'ranged' || src.rpsType === 'defense' ? src.rpsType : 'mobility',
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
    abilityIds,
    behaviorProfileId,
    stabilityProfileId,
    components: {
      bodyId,
      weaponIds,
      vehicleId,
      abilityIds,
      behaviorProfileId,
      stabilityProfileId,
      body: toComponentRef(componentsById, bodyId),
      weapon: weaponIds.map((id) => toComponentRef(componentsById, id)).filter(Boolean),
      vehicle: toComponentRef(componentsById, vehicleId),
      ability: abilityIds.map((id) => toComponentRef(componentsById, id)).filter(Boolean),
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
  toUnitTypeDtoV1,
  inferClassTag,
  normalizeClassTag
};
