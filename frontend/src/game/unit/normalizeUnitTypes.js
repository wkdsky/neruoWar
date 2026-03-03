import {
  clampNumber,
  ensureStringArray,
  normalizeRarity,
  normalizeRoleTag,
  normalizeRpsType,
  toInt,
  toStringId
} from './types';

const normalizeVisuals = (visuals = {}) => {
  const battle = visuals?.battle && typeof visuals.battle === 'object' ? visuals.battle : {};
  const preview = visuals?.preview && typeof visuals.preview === 'object' ? visuals.preview : {};
  return {
    battle: {
      bodyLayer: toInt(battle.bodyLayer, 0, 0, 1024),
      gearLayer: toInt(battle.gearLayer, 0, 0, 1024),
      vehicleLayer: toInt(battle.vehicleLayer, 0, 0, 1024),
      tint: clampNumber(battle.tint, 0, -9999, 9999),
      silhouetteLayer: toInt(battle.silhouetteLayer, 0, 0, 1024)
    },
    preview: {
      style: toStringId(preview.style) || 'procedural',
      palette: {
        primary: typeof preview?.palette?.primary === 'string' ? preview.palette.primary : '#5aa3ff',
        secondary: typeof preview?.palette?.secondary === 'string' ? preview.palette.secondary : '#cfd8e3',
        accent: typeof preview?.palette?.accent === 'string' ? preview.palette.accent : '#ffd166'
      }
    }
  };
};

const normalizeComponents = (components = {}) => {
  const source = components && typeof components === 'object' ? components : {};
  return {
    body: source.body && typeof source.body === 'object' ? source.body : null,
    weapon: Array.isArray(source.weapon) ? source.weapon.filter((item) => item && typeof item === 'object') : [],
    vehicle: source.vehicle && typeof source.vehicle === 'object' ? source.vehicle : null,
    ability: Array.isArray(source.ability) ? source.ability.filter((item) => item && typeof item === 'object') : [],
    behaviorProfile: source.behaviorProfile && typeof source.behaviorProfile === 'object' ? source.behaviorProfile : null,
    stabilityProfile: source.stabilityProfile && typeof source.stabilityProfile === 'object' ? source.stabilityProfile : null,
    interactionRule: source.interactionRule && typeof source.interactionRule === 'object' ? source.interactionRule : null
  };
};

export const normalizeUnitType = (unit = {}) => {
  const unitTypeId = toStringId(unit?.unitTypeId || unit?.id);
  const tier = Math.max(1, toInt(unit?.tier ?? unit?.level, 1, 1, 4));
  const range = clampNumber(unit?.range, 1, 1, 9999);
  const roleTag = normalizeRoleTag(unit?.roleTag, range);
  const enabled = unit?.enabled !== false;
  const bodyId = toStringId(unit?.bodyId) || null;
  const vehicleId = toStringId(unit?.vehicleId) || null;
  const behaviorProfileId = toStringId(unit?.behaviorProfileId) || null;
  const stabilityProfileId = toStringId(unit?.stabilityProfileId) || null;
  return {
    id: unitTypeId,
    unitTypeId,
    name: toStringId(unit?.name) || unitTypeId || '未知兵种',
    enabled,
    roleTag,
    rpsType: normalizeRpsType(unit?.rpsType),
    professionId: toStringId(unit?.professionId),
    tier,
    level: tier,
    rarity: normalizeRarity(unit?.rarity),
    speed: clampNumber(unit?.speed, 1, 0.01, 9999),
    hp: clampNumber(unit?.hp, 1, 1, 999999999),
    atk: clampNumber(unit?.atk, 1, 0, 999999999),
    def: clampNumber(unit?.def, 0, 0, 999999999),
    range,
    costKP: Math.max(1, toInt(unit?.costKP, 1, 1, 999999999)),
    nextUnitTypeId: toStringId(unit?.nextUnitTypeId) || null,
    upgradeCostKP: Number.isFinite(Number(unit?.upgradeCostKP))
      ? Math.max(0, toInt(unit.upgradeCostKP, 0, 0, 999999999))
      : null,
    sortOrder: toInt(unit?.sortOrder, 0, -999999, 999999),
    tags: ensureStringArray(unit?.tags),
    description: typeof unit?.description === 'string' ? unit.description.trim() : '',
    bodyId,
    weaponIds: ensureStringArray(unit?.weaponIds),
    vehicleId,
    abilityIds: ensureStringArray(unit?.abilityIds),
    behaviorProfileId,
    stabilityProfileId,
    visuals: normalizeVisuals(unit?.visuals || {}),
    components: normalizeComponents(unit?.components || {})
  };
};

export const normalizeUnitTypes = (list = [], options = {}) => {
  const enabledOnly = options?.enabledOnly !== false;
  const normalized = (Array.isArray(list) ? list : [])
    .map((item) => normalizeUnitType(item))
    .filter((row) => row.unitTypeId);
  const filtered = enabledOnly ? normalized.filter((row) => row.enabled) : normalized;
  filtered.sort((a, b) => (
    (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
    || ((Number(a.tier) || 1) - (Number(b.tier) || 1))
    || a.name.localeCompare(b.name, 'zh-Hans-CN')
  ));
  return filtered;
};

export default normalizeUnitTypes;
