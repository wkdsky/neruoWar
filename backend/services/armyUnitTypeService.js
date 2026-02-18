const ArmyUnitType = require('../models/ArmyUnitType');

const serializeArmyUnitType = (doc) => {
  const src = typeof doc?.toObject === 'function' ? doc.toObject() : (doc || {});
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
    level: Number(src.level) || 1,
    nextUnitTypeId: src.nextUnitTypeId || null,
    upgradeCostKP: Number.isFinite(src.upgradeCostKP) ? src.upgradeCostKP : null,
    sortOrder: Number(src.sortOrder) || 0,
    createdAt: src.createdAt || null,
    updatedAt: src.updatedAt || null
  };
};

const fetchArmyUnitTypes = async () => {
  const docs = await ArmyUnitType.find({}).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).lean();
  return docs.map(serializeArmyUnitType);
};

module.exports = {
  fetchArmyUnitTypes,
  serializeArmyUnitType
};
