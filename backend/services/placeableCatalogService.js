const BattlefieldItem = require('../models/BattlefieldItem');
const CityBuildingType = require('../models/CityBuildingType');

const serializeBattlefieldItem = (doc) => {
  const src = typeof doc?.toObject === 'function' ? doc.toObject() : (doc || {});
  return {
    id: src.itemId || '',
    itemId: src.itemId || '',
    name: src.name || '',
    description: src.description || '',
    initialCount: Math.max(0, Math.floor(Number(src.initialCount) || 0)),
    width: Number(src.width) || 0,
    depth: Number(src.depth) || 0,
    height: Number(src.height) || 0,
    hp: Math.max(1, Math.floor(Number(src.hp) || 1)),
    defense: Number(src.defense) || 0,
    style: src.style && typeof src.style === 'object' ? src.style : {},
    collider: src?.collider && typeof src.collider === 'object' ? src.collider : null,
    renderProfile: src?.renderProfile && typeof src.renderProfile === 'object' ? src.renderProfile : null,
    interactions: Array.isArray(src?.interactions) ? src.interactions : [],
    sockets: Array.isArray(src?.sockets) ? src.sockets : [],
    maxStack: Number.isFinite(Number(src?.maxStack)) ? Math.max(1, Math.floor(Number(src.maxStack))) : null,
    requiresSupport: src?.requiresSupport === true,
    snapPriority: Number.isFinite(Number(src?.snapPriority)) ? Number(src.snapPriority) : 0,
    sortOrder: Number(src.sortOrder) || 0,
    enabled: src.enabled !== false,
    createdAt: src.createdAt || null,
    updatedAt: src.updatedAt || null
  };
};

const serializeCityBuildingType = (doc) => {
  const src = typeof doc?.toObject === 'function' ? doc.toObject() : (doc || {});
  return {
    id: src.buildingTypeId || '',
    buildingTypeId: src.buildingTypeId || '',
    name: src.name || '',
    initialCount: Math.max(0, Math.floor(Number(src.initialCount) || 0)),
    radius: Number(src.radius) || 0.17,
    level: Math.max(1, Math.floor(Number(src.level) || 1)),
    nextUnitTypeId: src.nextUnitTypeId || '',
    upgradeCostKP: Number.isFinite(Number(src.upgradeCostKP)) ? Number(src.upgradeCostKP) : null,
    style: src.style && typeof src.style === 'object' ? src.style : {},
    sortOrder: Number(src.sortOrder) || 0,
    enabled: src.enabled !== false,
    createdAt: src.createdAt || null,
    updatedAt: src.updatedAt || null
  };
};

const fetchBattlefieldItems = async ({ enabledOnly = false } = {}) => {
  const query = enabledOnly ? { enabled: true } : {};
  const docs = await BattlefieldItem.find(query).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).lean();
  return docs.map(serializeBattlefieldItem);
};

const fetchCityBuildingTypes = async ({ enabledOnly = false } = {}) => {
  const query = enabledOnly ? { enabled: true } : {};
  const docs = await CityBuildingType.find(query).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).lean();
  return docs.map(serializeCityBuildingType);
};

module.exports = {
  fetchBattlefieldItems,
  fetchCityBuildingTypes,
  serializeBattlefieldItem,
  serializeCityBuildingType
};
