const fs = require('fs');
const path = require('path');
const ArmyUnitType = require('../models/ArmyUnitType');
const UnitComponent = require('../models/UnitComponent');
const { serializeArmyUnitType } = require('./armyUnitTypeService');
const { buildUnitCatalog } = require('../seed/unitCatalogFactory');

const RPS_TYPES = new Set(['mobility', 'ranged', 'defense']);
const DATA_FILE_PATH = path.resolve(__dirname, '../seed/bootstrap_catalog_data.json');

let ensurePromise = null;
let lastLoggedSignature = '';

const readBootstrapPatch = () => {
  try {
    if (!fs.existsSync(DATA_FILE_PATH)) {
      return { unitComponents: [], unitTypesPatch: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE_PATH, 'utf8'));
    return {
      unitComponents: Array.isArray(parsed?.unitComponents) ? parsed.unitComponents : [],
      unitTypesPatch: parsed?.unitTypesPatch && typeof parsed.unitTypesPatch === 'object'
        ? parsed.unitTypesPatch
        : {}
    };
  } catch (error) {
    return { unitComponents: [], unitTypesPatch: {} };
  }
};

const isNewCatalogReady = async () => {
  const [typedCount, enabledCount] = await Promise.all([
    ArmyUnitType.countDocuments({ rpsType: { $in: Array.from(RPS_TYPES) }, tier: { $gte: 1, $lte: 4 } }),
    ArmyUnitType.countDocuments({ enabled: true })
  ]);
  return typedCount >= 36 && enabledCount >= 36;
};

const resetToGeneratedCatalog = async () => {
  const seedPatch = readBootstrapPatch();
  const catalog = buildUnitCatalog(seedPatch);
  await UnitComponent.deleteMany({});
  await ArmyUnitType.deleteMany({});
  if (Array.isArray(catalog.unitComponents) && catalog.unitComponents.length > 0) {
    await UnitComponent.insertMany(catalog.unitComponents, { ordered: false });
  }
  if (Array.isArray(catalog.unitTypes) && catalog.unitTypes.length > 0) {
    await ArmyUnitType.insertMany(catalog.unitTypes, { ordered: false });
  }
};

const ensureGeneratedCatalog = async () => {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const ready = await isNewCatalogReady();
      if (ready) return;
      await resetToGeneratedCatalog();
    })().finally(() => {
      ensurePromise = null;
    });
  }
  return ensurePromise;
};

const buildComponentRefSet = (unitTypes = []) => {
  const refs = new Set();
  (Array.isArray(unitTypes) ? unitTypes : []).forEach((row) => {
    const bodyId = typeof row?.bodyId === 'string' ? row.bodyId.trim() : '';
    const vehicleId = typeof row?.vehicleId === 'string' ? row.vehicleId.trim() : '';
    const behaviorProfileId = typeof row?.behaviorProfileId === 'string' ? row.behaviorProfileId.trim() : '';
    const stabilityProfileId = typeof row?.stabilityProfileId === 'string' ? row.stabilityProfileId.trim() : '';
    if (bodyId) refs.add(bodyId);
    if (vehicleId) refs.add(vehicleId);
    if (behaviorProfileId) refs.add(behaviorProfileId);
    if (stabilityProfileId) refs.add(stabilityProfileId);
    (Array.isArray(row?.weaponIds) ? row.weaponIds : []).forEach((id) => {
      const key = typeof id === 'string' ? id.trim() : '';
      if (key) refs.add(key);
    });
    (Array.isArray(row?.abilityIds) ? row.abilityIds : []).forEach((id) => {
      const key = typeof id === 'string' ? id.trim() : '';
      if (key) refs.add(key);
    });
  });
  return refs;
};

const toComponentRef = (componentMap, componentId) => {
  const key = typeof componentId === 'string' ? componentId.trim() : '';
  if (!key) return null;
  return componentMap.get(key) || null;
};

const buildExpandedComponents = (unitType = {}, componentMap = new Map()) => ({
  body: toComponentRef(componentMap, unitType.bodyId),
  weapon: (Array.isArray(unitType.weaponIds) ? unitType.weaponIds : [])
    .map((id) => toComponentRef(componentMap, id))
    .filter(Boolean),
  vehicle: toComponentRef(componentMap, unitType.vehicleId),
  ability: (Array.isArray(unitType.abilityIds) ? unitType.abilityIds : [])
    .map((id) => toComponentRef(componentMap, id))
    .filter(Boolean),
  behaviorProfile: toComponentRef(componentMap, unitType.behaviorProfileId),
  stabilityProfile: toComponentRef(componentMap, unitType.stabilityProfileId),
  interactionRule: toComponentRef(componentMap, 'rule_rps_triangle')
});

const serializeUnitComponent = (doc) => {
  const src = typeof doc?.toObject === 'function' ? doc.toObject() : (doc || {});
  return {
    componentId: src.componentId || '',
    kind: src.kind || '',
    name: src.name || '',
    tags: Array.isArray(src.tags) ? src.tags : [],
    data: src.data && typeof src.data === 'object' ? src.data : {},
    version: Math.max(1, Math.floor(Number(src.version) || 1)),
    createdAt: src.createdAt || null,
    updatedAt: src.updatedAt || null
  };
};

const fetchUnitTypesWithComponents = async ({ enabledOnly = true } = {}) => {
  await ensureGeneratedCatalog();
  const filter = enabledOnly ? { enabled: true } : {};
  const docs = await ArmyUnitType.find(filter).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).lean();
  const refs = buildComponentRefSet(docs);
  refs.add('rule_rps_triangle');
  const componentDocs = refs.size > 0
    ? await UnitComponent.find({ componentId: { $in: Array.from(refs) } }).lean()
    : [];
  const unitComponents = componentDocs.map(serializeUnitComponent);
  const componentMap = new Map(unitComponents.map((item) => [item.componentId, item]));
  const unitTypes = docs.map((doc) => {
    const base = serializeArmyUnitType(doc);
    return {
      ...base,
      components: buildExpandedComponents(base, componentMap)
    };
  });

  const logSignature = `${enabledOnly ? 'enabled' : 'all'}:${unitTypes.length}:${unitComponents.length}`;
  if (logSignature !== lastLoggedSignature) {
    lastLoggedSignature = logSignature;
    console.log(`[unit-registry] Loaded unitTypes:${unitTypes.length}, unitComponents:${unitComponents.length}`);
  }

  return {
    unitTypes,
    unitComponents
  };
};

module.exports = {
  fetchUnitTypesWithComponents,
  serializeUnitComponent
};
