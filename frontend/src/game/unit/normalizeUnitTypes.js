/**
 * UnitType normalization is the frontend compatibility boundary.
 * - Primary contract: backend UnitTypeDTO v1 (`schemaVersion: 1`).
 * - Compatibility contract: legacy payloads still accepted (`id/level`).
 * - Keep defaults centralized here; runtime should consume normalized rows.
 * - `id`/`level` are retained only for backward compatibility and mirror
 *   `unitTypeId`/`tier` respectively.
 */
import {
  clampNumber,
  ensureStringArray,
  normalizeRarity,
  normalizeRoleTag,
  normalizeRpsType,
  toInt,
  toStringId
} from './types';

const CLASS_TAG_SET = new Set(['infantry', 'cavalry', 'archer', 'artillery']);

const normalizeClassTag = (value, fallbackUnit = {}) => {
  const explicit = toStringId(value).toLowerCase();
  if (CLASS_TAG_SET.has(explicit)) return explicit;
  const name = toStringId(fallbackUnit?.name);
  const roleTag = fallbackUnit?.roleTag === '远程' ? '远程' : '近战';
  const speed = Number(fallbackUnit?.speed) || 0;
  const range = Number(fallbackUnit?.range) || 0;
  if (/(炮|投石|火炮|炮兵|臼炮|加农)/.test(name)) return 'artillery';
  if (/(弓|弩|弓兵|弩兵|射手)/.test(name) || (roleTag === '远程' && range >= 3)) return 'archer';
  if (/(骑|骑兵|铁骑|龙骑)/.test(name) || speed >= 2.1) return 'cavalry';
  return 'infantry';
};

const normalizeVisuals = (visuals = {}) => {
  const battle = visuals?.battle && typeof visuals.battle === 'object' ? visuals.battle : {};
  const preview = visuals?.preview && typeof visuals.preview === 'object' ? visuals.preview : {};
  const bodyLayer = toInt(battle.bodyLayer, 0, 0, 1024);
  const spriteFrontLayer = toInt(battle.spriteFrontLayer ?? bodyLayer, bodyLayer, 0, 4096);
  const rawTopLayer = battle?.spriteTopLayer;
  const spriteTopLayer = Number.isFinite(Number(rawTopLayer))
    ? toInt(rawTopLayer, 0, 0, 4096)
    : null;
  return {
    battle: {
      bodyLayer,
      gearLayer: toInt(battle.gearLayer, 0, 0, 1024),
      vehicleLayer: toInt(battle.vehicleLayer, 0, 0, 1024),
      tint: clampNumber(battle.tint, 0, -9999, 9999),
      silhouetteLayer: toInt(battle.silhouetteLayer, 0, 0, 1024),
      spriteFrontLayer,
      spriteTopLayer
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
  const bodyId = toStringId(source.bodyId) || null;
  const weaponIds = ensureStringArray(source.weaponIds);
  const vehicleId = toStringId(source.vehicleId) || null;
  const abilityIds = ensureStringArray(source.abilityIds);
  const behaviorProfileId = toStringId(source.behaviorProfileId) || null;
  const stabilityProfileId = toStringId(source.stabilityProfileId) || null;
  return {
    bodyId,
    weaponIds,
    vehicleId,
    abilityIds,
    behaviorProfileId,
    stabilityProfileId,
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
  const unitTypeId = toStringId(unit?.unitTypeId) || toStringId(unit?.id);
  const tier = Math.max(1, toInt(unit?.tier, toInt(unit?.level, 1, 1, 4), 1, 4));
  const range = clampNumber(unit?.range, 1, 1, 9999);
  const roleTag = normalizeRoleTag(unit?.roleTag, range);
  const enabled = unit?.enabled !== false;
  const bodyId = toStringId(unit?.bodyId) || null;
  const vehicleId = toStringId(unit?.vehicleId) || null;
  const behaviorProfileId = toStringId(unit?.behaviorProfileId) || null;
  const stabilityProfileId = toStringId(unit?.stabilityProfileId) || null;
  const components = normalizeComponents(unit?.components || {});
  const classTag = normalizeClassTag(unit?.classTag, {
    ...unit,
    roleTag,
    range
  });
  return {
    schemaVersion: Math.max(1, toInt(unit?.schemaVersion, 1, 1, 9999)),
    id: unitTypeId,
    unitTypeId,
    name: toStringId(unit?.name) || unitTypeId || '未知兵种',
    enabled,
    classTag,
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
    bodyId: components.bodyId || bodyId,
    weaponIds: components.weaponIds.length > 0 ? components.weaponIds : ensureStringArray(unit?.weaponIds),
    vehicleId: components.vehicleId || vehicleId,
    abilityIds: components.abilityIds.length > 0 ? components.abilityIds : ensureStringArray(unit?.abilityIds),
    behaviorProfileId: components.behaviorProfileId || behaviorProfileId,
    stabilityProfileId: components.stabilityProfileId || stabilityProfileId,
    visuals: normalizeVisuals(unit?.visuals || {}),
    components
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
