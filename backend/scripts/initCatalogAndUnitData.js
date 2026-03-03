const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const ArmyUnitType = require('../models/ArmyUnitType');
const UnitComponent = require('../models/UnitComponent');
const BattlefieldItem = require('../models/BattlefieldItem');
const CityBuildingType = require('../models/CityBuildingType');
const { buildUnitCatalog } = require('../seed/unitCatalogFactory');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';
const DATA_FILE_PATH = path.resolve(__dirname, '../seed/bootstrap_catalog_data.json');

const loadBootstrapData = () => {
  const raw = fs.readFileSync(DATA_FILE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    unitComponents: Array.isArray(parsed?.unitComponents) ? parsed.unitComponents : [],
    unitTypesPatch: parsed?.unitTypesPatch && typeof parsed.unitTypesPatch === 'object'
      ? parsed.unitTypesPatch
      : {},
    armyUnitTypes: Array.isArray(parsed?.armyUnitTypes) ? parsed.armyUnitTypes : [],
    battlefieldItems: Array.isArray(parsed?.battlefieldItems) ? parsed.battlefieldItems : [],
    cityBuildingTypes: Array.isArray(parsed?.cityBuildingTypes) ? parsed.cityBuildingTypes : []
  };
};

const ensureCollections = async () => {
  const db = mongoose.connection.db;
  const existing = await db.listCollections({}, { nameOnly: true }).toArray();
  const existingNames = new Set(existing.map((item) => item.name));
  const collectionNames = [
    ArmyUnitType.collection.collectionName,
    UnitComponent.collection.collectionName,
    BattlefieldItem.collection.collectionName,
    CityBuildingType.collection.collectionName
  ];
  for (const name of collectionNames) {
    if (existingNames.has(name)) continue;
    await db.createCollection(name);
  }
};

const uniqByKey = (rows = [], keyName = '') => {
  const out = [];
  const seen = new Set();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const key = typeof row?.[keyName] === 'string' ? row[keyName].trim() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
};

const upsertByKey = async (Model, rows = [], keyName = '', { replace = false } = {}) => {
  const sourceRows = uniqByKey(rows, keyName);
  if (sourceRows.length === 0) {
    if (replace) {
      await Model.deleteMany({});
    }
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
  }
  if (replace) {
    await Model.deleteMany({});
    await Model.insertMany(sourceRows, { ordered: false });
    return {
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: sourceRows.length
    };
  }
  const result = await Model.bulkWrite(
    sourceRows.map((row) => ({
      updateOne: {
        filter: { [keyName]: row[keyName] },
        update: { $setOnInsert: row },
        upsert: true,
        timestamps: false
      }
    })),
    { ordered: false }
  );
  return {
    matchedCount: Number(result?.matchedCount || 0),
    modifiedCount: Number(result?.modifiedCount || 0),
    upsertedCount: Number(result?.upsertedCount || 0)
  };
};

const run = async () => {
  const data = loadBootstrapData();
  const generatedCatalog = buildUnitCatalog({
    unitComponents: data.unitComponents,
    unitTypesPatch: data.unitTypesPatch
  });
  await mongoose.connect(MONGODB_URI);
  await ensureCollections();
  await Promise.all([ArmyUnitType.init(), UnitComponent.init(), BattlefieldItem.init(), CityBuildingType.init()]);

  const [armyResult, componentResult, itemResult, buildingResult] = await Promise.all([
    upsertByKey(ArmyUnitType, generatedCatalog.unitTypes, 'unitTypeId', { replace: true }),
    upsertByKey(UnitComponent, generatedCatalog.unitComponents, 'componentId', { replace: true }),
    upsertByKey(BattlefieldItem, data.battlefieldItems, 'itemId'),
    upsertByKey(CityBuildingType, data.cityBuildingTypes, 'buildingTypeId')
  ]);

  const [armyCount, componentCount, itemCount, buildingCount] = await Promise.all([
    ArmyUnitType.countDocuments(),
    UnitComponent.countDocuments(),
    BattlefieldItem.countDocuments(),
    CityBuildingType.countDocuments()
  ]);

  console.log(JSON.stringify({
    success: true,
    dataFile: DATA_FILE_PATH,
    upsert: {
      armyUnitTypes: armyResult,
      unitComponents: componentResult,
      battlefieldItems: itemResult,
      cityBuildingTypes: buildingResult
    },
    counts: {
      armyUnitTypes: armyCount,
      unitComponents: componentCount,
      battlefieldItems: itemCount,
      cityBuildingTypes: buildingCount
    }
  }, null, 2));
};

run()
  .catch(async (error) => {
    console.error('初始化兵种/物品/建筑数据失败:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (e) {
      // ignore
    }
  });
