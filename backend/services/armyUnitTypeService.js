const ArmyUnitType = require('../models/ArmyUnitType');

const serializeArmyUnitType = (doc) => {
  const src = typeof doc?.toObject === 'function' ? doc.toObject() : (doc || {});
  const tier = Math.max(1, Math.floor(Number(src.tier || src.level) || 1));
  const battleVisual = src?.visuals?.battle && typeof src.visuals.battle === 'object' ? src.visuals.battle : {};
  const previewVisual = src?.visuals?.preview && typeof src.visuals.preview === 'object' ? src.visuals.preview : {};
  return {
    id: src.unitTypeId || '',
    unitTypeId: src.unitTypeId || '',
    name: src.name || '',
    roleTag: src.roleTag || '',
    speed: Number(src.speed) || 0,
    hp: Number(src.hp) || 0,
    atk: Number(src.atk) || 0,
    def: Number(src.def) || 0,
    range: Number(src.range) || 0,
    costKP: Number(src.costKP) || 0,
    level: tier,
    tier,
    nextUnitTypeId: src.nextUnitTypeId || null,
    upgradeCostKP: Number.isFinite(src.upgradeCostKP) ? src.upgradeCostKP : null,
    sortOrder: Number(src.sortOrder) || 0,
    enabled: src.enabled !== false,
    rpsType: src.rpsType || 'mobility',
    professionId: src.professionId || '',
    rarity: src.rarity || 'common',
    tags: Array.isArray(src.tags) ? src.tags : [],
    description: src.description || '',
    bodyId: src.bodyId || null,
    weaponIds: Array.isArray(src.weaponIds) ? src.weaponIds.filter((id) => typeof id === 'string' && id.trim()) : [],
    vehicleId: src.vehicleId || null,
    abilityIds: Array.isArray(src.abilityIds) ? src.abilityIds.filter((id) => typeof id === 'string' && id.trim()) : [],
    behaviorProfileId: src.behaviorProfileId || null,
    stabilityProfileId: src.stabilityProfileId || null,
    visuals: {
      battle: {
        bodyLayer: Math.max(0, Math.floor(Number(battleVisual.bodyLayer) || 0)),
        gearLayer: Math.max(0, Math.floor(Number(battleVisual.gearLayer) || 0)),
        vehicleLayer: Math.max(0, Math.floor(Number(battleVisual.vehicleLayer) || 0)),
        tint: Number.isFinite(Number(battleVisual.tint)) ? Number(battleVisual.tint) : 0,
        silhouetteLayer: Math.max(0, Math.floor(Number(battleVisual.silhouetteLayer) || 0))
      },
      preview: {
        style: typeof previewVisual.style === 'string' && previewVisual.style.trim()
          ? previewVisual.style.trim()
          : 'procedural',
        palette: {
          primary: typeof previewVisual?.palette?.primary === 'string' ? previewVisual.palette.primary : '#5aa3ff',
          secondary: typeof previewVisual?.palette?.secondary === 'string' ? previewVisual.palette.secondary : '#cfd8e3',
          accent: typeof previewVisual?.palette?.accent === 'string' ? previewVisual.palette.accent : '#ffd166'
        }
      }
    },
    createdAt: src.createdAt || null,
    updatedAt: src.updatedAt || null
  };
};

const fetchArmyUnitTypes = async ({ enabledOnly = true } = {}) => {
  const filter = enabledOnly ? { enabled: true } : {};
  const docs = await ArmyUnitType.find(filter).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).lean();
  return docs.map(serializeArmyUnitType);
};

module.exports = {
  fetchArmyUnitTypes,
  serializeArmyUnitType
};
