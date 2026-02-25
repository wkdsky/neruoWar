const ArmyUnitType = require('../models/ArmyUnitType');

const DEFAULT_ARMY_UNIT_TYPES = [
  {
    unitTypeId: 'ci_ren_zu',
    name: '词刃卒',
    roleTag: '近战',
    speed: 1.0,
    hp: 120,
    atk: 22,
    def: 28,
    range: 1,
    costKP: 10,
    level: 1,
    nextUnitTypeId: null,
    upgradeCostKP: null,
    sortOrder: 0
  },
  {
    unitTypeId: 'ju_feng_qi',
    name: '句锋骑',
    roleTag: '近战',
    speed: 2.0,
    hp: 85,
    atk: 26,
    def: 16,
    range: 1,
    costKP: 12,
    level: 1,
    nextUnitTypeId: null,
    upgradeCostKP: null,
    sortOrder: 1
  },
  {
    unitTypeId: 'yu_nu_shou',
    name: '语弩手',
    roleTag: '远程',
    speed: 1.1,
    hp: 75,
    atk: 30,
    def: 10,
    range: 4,
    costKP: 12,
    level: 1,
    nextUnitTypeId: null,
    upgradeCostKP: null,
    sortOrder: 2
  },
  {
    unitTypeId: 'fu_ying_you',
    name: '符影游',
    roleTag: '远程',
    speed: 2.2,
    hp: 65,
    atk: 23,
    def: 9,
    range: 3,
    costKP: 11,
    level: 1,
    nextUnitTypeId: null,
    upgradeCostKP: null,
    sortOrder: 3
  }
];

let ensureDefaultsPromise = null;

const ensureDefaultArmyUnitTypes = async () => {
  if (ensureDefaultsPromise) {
    return ensureDefaultsPromise;
  }

  ensureDefaultsPromise = ArmyUnitType.bulkWrite(
    DEFAULT_ARMY_UNIT_TYPES.map((unitType) => ({
      updateOne: {
        filter: { unitTypeId: unitType.unitTypeId },
        update: { $setOnInsert: unitType },
        upsert: true
      }
    })),
    { ordered: false }
  )
    .catch((error) => {
      ensureDefaultsPromise = null;
      throw error;
    });

  return ensureDefaultsPromise;
};

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
  await ensureDefaultArmyUnitTypes();
  const docs = await ArmyUnitType.find({}).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).lean();
  return docs.map(serializeArmyUnitType);
};

module.exports = {
  fetchArmyUnitTypes,
  serializeArmyUnitType
};
