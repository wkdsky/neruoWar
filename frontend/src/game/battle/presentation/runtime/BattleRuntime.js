/**
 * PVE battle runtime data contract notes (upgrade 2026-03):
 * - Input unitTypes should already be normalized DTO rows from `normalizeUnitTypes`.
 * - Runtime keeps compatibility fallbacks, but defaults should live in normalize layer.
 * - Unit impostor instance layout is owned here and consumed by ImpostorRenderer.
 * - Stride fields are written in fixed order; renderer attributes must stay in sync.
 * - Deploy phase now supports formation rectangle state for slot expansion/reshape.
 */
import {
  createCrowdSim,
  updateCrowdSim,
  triggerCrowdSkill
} from '../../simulation/crowd/CrowdSim';
import { degToRad, normalizeDeg } from '../../shared/angle';
import { buildBattleSummary } from './BattleSummary';
import {
  buildRepConfig,
  estimateRepAgents,
  normalizeUnitsMap,
  sumUnitsMap,
  withRepConfig
} from './RepMapping';
import BattleSnapshotSchema from '../snapshot/BattleSnapshotSchema';
import BattleSnapshotPool from '../snapshot/BattleSnapshotPool';
import BattleSnapshotBuilder from '../snapshot/BattleSnapshotBuilder';
import { resolveTopLayer } from '../assets/ProceduralTextures';
import {
  getItemGeometry,
  buildWorldColliderParts,
  resolveBattleLayerColors
} from '../../../battlefield/items/ItemGeometryRegistry';

const DEFAULT_FIELD_WIDTH = 1350;
const DEFAULT_FIELD_HEIGHT = 744;
const DEFAULT_TIME_LIMIT = 240;
const DEFAULT_UNITS_PER_SOLDIER = 10;
const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const TEAM_ANY = 'any';
const MORALE_MAX = 100;
const STAMINA_MAX = 100;
const TEAM_ZONE_GUTTER = 10;
const DEPLOY_ZONE_RATIO = 0.2;
const ORDER_IDLE = 'IDLE';
const ORDER_MOVE = 'MOVE';
const ORDER_ATTACK_MOVE = 'ATTACK_MOVE';
const ORDER_CHARGE = 'CHARGE';
const SPEED_MODE_B = 'B_HARMONIC';
const SPEED_MODE_C = 'C_PER_TYPE';
const SPEED_MODE_AUTO = 'AUTO';
const MARCH_MODE_COHESIVE = 'cohesive';
const MARCH_MODE_LOOSE = 'loose';
const SPEED_AUTH_USER = 'USER';
const SPEED_AUTH_AI = 'AI';
const SPEED_POLICY_MARCH = 'MARCH';
const SPEED_POLICY_RETREAT = 'RETREAT';
const SPEED_POLICY_REFORM = 'REFORM';
const CAMERA_DEAD_ZONE = 0.9;
const SKILL_COOLDOWN_BY_CLASS = {
  infantry: 2.1,
  cavalry: 2.8,
  archer: 8.6,
  artillery: 13.5
};
const SKILL_CLASS_ORDER = ['infantry', 'cavalry', 'archer', 'artillery'];
const SKILL_META_BY_CLASS = {
  infantry: { id: 'skill_infantry_buff', name: '战吼', icon: '吼' },
  cavalry: { id: 'skill_cavalry_charge', name: '冲锋', icon: '锋' },
  archer: { id: 'skill_archer_volley', name: '箭雨', icon: '雨' },
  artillery: { id: 'skill_artillery_bombard', name: '炮击', icon: '爆' }
};
const SKILL_DESC_BY_CLASS = {
  infantry: '战吼增益，短时提升攻防。',
  cavalry: '短程突击，沿路径冲锋并击退。',
  archer: '箭雨压制，在目标区域持续打击。',
  artillery: '炮击轰炸，高爆范围并可伤建筑。'
};
const SKILL_POWER_CONFIG_BY_CLASS = {
  infantry: {
    durationSec: 7.5,
    atkMul: 1.22,
    defMul: 1.3,
    speedMul: 0.78
  },
  cavalry: {
    impactAtkMul: 0.11,
    speed: 172,
    minDistance: 18,
    maxDistance: 220
  },
  archer: {
    damageAtkMul: 0.065,
    damageMul: 2.05,
    waves: 4,
    shotsPerWave: 12,
    durationSec: 1.22
  },
  artillery: {
    damageAtkMul: 0.11,
    damageMul: 2.75,
    waves: 3,
    shotsPerWave: 6,
    durationSec: 1.65
  }
};
const CLASS_TAG_SET = new Set(['infantry', 'cavalry', 'archer', 'artillery']);
const DEPLOY_FORMATION_SPACING_DEFAULT = 12;
const DEPLOY_FORMATION_RATIO_MIN = 1 / 6;
const DEPLOY_FORMATION_RATIO_MAX = 6;
const DEPLOY_FORMATION_MIN_EDGE = 8;
const DEPLOY_FORMATION_MAX_EDGE_MUL = 5.8;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clampToRange = (value, min, max) => {
  const safeMin = Number(min) || 0;
  const safeMax = Number(max) || 0;
  if (safeMin <= safeMax) return clamp(Number(value) || 0, safeMin, safeMax);
  return (safeMin + safeMax) * 0.5;
};
const resolveTeamTag = (team = TEAM_ATTACKER) => (team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER);

const buildUnitTypeMap = (unitTypes = []) => {
  const map = new Map();
  (Array.isArray(unitTypes) ? unitTypes : []).forEach((item) => {
    const unitTypeId = typeof item?.unitTypeId === 'string' ? item.unitTypeId.trim() : '';
    if (!unitTypeId) return;
    const tier = Math.max(1, Math.floor(Number(item?.tier ?? item?.level) || 1));
    const battleVisual = item?.visuals?.battle && typeof item.visuals.battle === 'object' ? item.visuals.battle : {};
    const previewVisual = item?.visuals?.preview && typeof item.visuals.preview === 'object' ? item.visuals.preview : {};
    const explicitClassTag = typeof item?.classTag === 'string' ? item.classTag.trim().toLowerCase() : '';
    // TODO(dto-v1): keep these runtime guards until all battle entries consume normalized DTO only.
    map.set(unitTypeId, {
      ...item,
      schemaVersion: Math.max(1, Number(item?.schemaVersion) || 1),
      id: unitTypeId,
      unitTypeId,
      tier,
      level: tier,
      speed: Math.max(0.2, Number(item?.speed) || 1),
      hp: Math.max(1, Number(item?.hp) || 10),
      atk: Math.max(0.1, Number(item?.atk) || 1),
      def: Math.max(0, Number(item?.def) || 0),
      range: Math.max(1, Number(item?.range) || 1),
      roleTag: item?.roleTag === '远程' ? '远程' : '近战',
      rpsType: item?.rpsType === 'ranged' || item?.rpsType === 'defense' ? item.rpsType : 'mobility',
      classTag: CLASS_TAG_SET.has(explicitClassTag) ? explicitClassTag : null,
      professionId: typeof item?.professionId === 'string' ? item.professionId : '',
      rarity: typeof item?.rarity === 'string' ? item.rarity : 'common',
      tags: Array.isArray(item?.tags)
        ? item.tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean)
        : [],
      visuals: {
        battle: {
          bodyLayer: Math.max(0, Math.floor(Number(battleVisual.bodyLayer) || 0)),
          gearLayer: Math.max(0, Math.floor(Number(battleVisual.gearLayer) || 0)),
          vehicleLayer: Math.max(0, Math.floor(Number(battleVisual.vehicleLayer) || 0)),
          tint: Number.isFinite(Number(battleVisual.tint)) ? Number(battleVisual.tint) : 0,
          silhouetteLayer: Math.max(0, Math.floor(Number(battleVisual.silhouetteLayer) || 0)),
          spriteFrontLayer: Math.max(0, Math.floor(Number(battleVisual.spriteFrontLayer ?? battleVisual.bodyLayer) || 0)),
          spriteTopLayer: Number.isFinite(Number(battleVisual.spriteTopLayer))
            ? Math.max(0, Math.floor(Number(battleVisual.spriteTopLayer)))
            : null
        },
        preview: {
          style: typeof previewVisual.style === 'string' ? previewVisual.style : 'procedural',
          palette: {
            primary: typeof previewVisual?.palette?.primary === 'string' ? previewVisual.palette.primary : '#5aa3ff',
            secondary: typeof previewVisual?.palette?.secondary === 'string' ? previewVisual.palette.secondary : '#cfd8e3',
            accent: typeof previewVisual?.palette?.accent === 'string' ? previewVisual.palette.accent : '#ffd166'
          }
        }
      },
      bodyId: item?.bodyId || null,
      weaponIds: Array.isArray(item?.weaponIds) ? item.weaponIds : [],
      vehicleId: item?.vehicleId || null,
      abilityIds: Array.isArray(item?.abilityIds) ? item.abilityIds : [],
      behaviorProfileId: item?.behaviorProfileId || null,
      stabilityProfileId: item?.stabilityProfileId || null,
      components: item?.components && typeof item.components === 'object' ? item.components : {},
      isFlying: !!item?.components?.vehicle?.data?.isFlying
    });
  });
  return map;
};

const inferClassFromUnitType = (unitType = {}) => {
  const explicit = typeof unitType?.classTag === 'string' ? unitType.classTag.trim().toLowerCase() : '';
  if (CLASS_TAG_SET.has(explicit)) return explicit;
  const name = typeof unitType?.name === 'string' ? unitType.name : '';
  const roleTag = unitType?.roleTag === '远程' ? '远程' : '近战';
  const speed = Number(unitType?.speed) || 0;
  const range = Number(unitType?.range) || 0;
  if (/(炮|投石|火炮|炮兵|臼炮|加农)/.test(name)) return 'artillery';
  if (/(弓|弩|射手)/.test(name) || (roleTag === '远程' && range >= 3)) return 'archer';
  if (/(骑|铁骑|龙骑)/.test(name) || speed >= 2.1) return 'cavalry';
  return 'infantry';
};

const aggregateStats = (unitsMap = {}, unitTypeMap = new Map()) => {
  const rows = Object.entries(unitsMap || {}).filter(([unitTypeId, count]) => unitTypeMap.has(unitTypeId) && count > 0);
  if (rows.length <= 0) {
    return {
      classTag: 'infantry',
      roleTag: '近战',
      speed: 1,
      hpAvg: 90,
      atk: 16,
      def: 12,
      range: 1,
      rpsType: 'mobility',
      professionId: '',
      tier: 1,
      mainTypeId: ''
    };
  }

  let total = 0;
  let totalSpeed = 0;
  let totalHp = 0;
  let totalAtk = 0;
  let totalDef = 0;
  let totalRange = 0;
  let mainTypeId = '';
  let mainCount = 0;

  rows.forEach(([unitTypeId, rawCount]) => {
    const count = Math.max(0, Number(rawCount) || 0);
    const unitType = unitTypeMap.get(unitTypeId);
    total += count;
    totalSpeed += unitType.speed * count;
    totalHp += unitType.hp * count;
    totalAtk += unitType.atk * count;
    totalDef += unitType.def * count;
    totalRange += unitType.range * count;
    if (count > mainCount) {
      mainCount = count;
      mainTypeId = unitTypeId;
    }
  });

  const mainType = unitTypeMap.get(mainTypeId) || {};
  const avgRange = totalRange / Math.max(1, total);
  const mainClass = typeof mainType?.classTag === 'string' ? mainType.classTag : '';
  return {
    classTag: CLASS_TAG_SET.has(mainClass) ? mainClass : inferClassFromUnitType(mainType),
    roleTag: mainType?.roleTag || (avgRange > 1.8 ? '远程' : '近战'),
    speed: totalSpeed / Math.max(1, total),
    hpAvg: totalHp / Math.max(1, total),
    atk: totalAtk / Math.max(1, total),
    def: totalDef / Math.max(1, total),
    range: avgRange,
    rpsType: mainType?.rpsType || 'mobility',
    professionId: mainType?.professionId || '',
    tier: Math.max(1, Number(mainType?.tier || mainType?.level) || 1),
    mainTypeId
  };
};

const buildObstacleList = (battlefield = {}) => {
  const itemById = new Map(
    (Array.isArray(battlefield?.itemCatalog) ? battlefield.itemCatalog : [])
      .map((item) => {
        const itemId = typeof item?.itemId === 'string' ? item.itemId.trim() : '';
        if (!itemId) return null;
        const geometry = getItemGeometry(item || {});
        const colors = resolveBattleLayerColors(item || {}, { battleTone: true });
        return [itemId, {
          ...item,
          collider: geometry.collider,
          renderProfile: geometry.renderProfile,
          interactions: geometry.interactions,
          sockets: geometry.sockets,
          renderColors: colors
        }];
      })
      .filter(Boolean)
  );
  return (Array.isArray(battlefield?.objects) ? battlefield.objects : []).map((obj, index) => {
    const itemId = typeof obj?.itemId === 'string' ? obj.itemId.trim() : '';
    const item = itemById.get(itemId) || {};
    const width = Math.max(8, Number(item?.width ?? obj?.width) || 84);
    const depth = Math.max(8, Number(item?.depth ?? obj?.depth) || 24);
    const height = Math.max(6, Number(item?.height ?? obj?.height) || 38);
    const instance = {
      x: Number(obj?.x) || 0,
      y: Number(obj?.y) || 0,
      z: Number(obj?.z) || 0,
      rotation: Number(obj?.rotation) || 0,
      width,
      depth,
      height
    };
    const obstacle = {
      id: typeof obj?.objectId === 'string' ? obj.objectId : `wall_${index + 1}`,
      itemId,
      x: instance.x,
      y: instance.y,
      z: instance.z,
      rotation: instance.rotation,
      width,
      depth,
      height,
      maxHp: Math.max(1, Number(item?.hp ?? obj?.hp) || 180),
      hp: Math.max(1, Number(item?.hp ?? obj?.hp) || 180),
      defense: Math.max(0.1, Number(item?.defense ?? obj?.defense) || 1.1),
      collider: item?.collider && typeof item.collider === 'object' ? item.collider : null,
      renderProfile: item?.renderProfile && typeof item.renderProfile === 'object' ? item.renderProfile : {},
      renderColors: item?.renderColors && typeof item.renderColors === 'object'
        ? item.renderColors
        : { top: [0.52, 0.58, 0.66], side: [0.38, 0.44, 0.52] },
      interactions: Array.isArray(item?.interactions) ? item.interactions : [],
      sockets: Array.isArray(item?.sockets) ? item.sockets : [],
      attach: obj?.attach && typeof obj.attach === 'object' ? obj.attach : null,
      groupId: typeof obj?.groupId === 'string' ? obj.groupId : '',
      destroyed: false
    };
    return refreshObstacleGeometry(obstacle, item);
  });
};

const buildItemCatalog = (battlefield = {}) => (
  (Array.isArray(battlefield?.itemCatalog) ? battlefield.itemCatalog : [])
    .map((item) => {
      const itemId = typeof item?.itemId === 'string' ? item.itemId.trim() : '';
      if (!itemId) return null;
      const geometry = getItemGeometry(item || {});
      const colors = resolveBattleLayerColors(item || {}, { battleTone: true });
      return {
        itemId,
        name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : itemId,
        description: typeof item?.description === 'string' ? item.description : '',
        width: Math.max(8, Number(item?.width) || 84),
        depth: Math.max(8, Number(item?.depth) || 24),
        height: Math.max(6, Number(item?.height) || 38),
        hp: Math.max(1, Number(item?.hp) || 180),
        defense: Math.max(0.1, Number(item?.defense) || 1.1),
        style: item?.style && typeof item.style === 'object' ? item.style : {},
        collider: geometry.collider,
        renderProfile: geometry.renderProfile,
        interactions: geometry.interactions,
        sockets: geometry.sockets,
        maxStack: Number.isFinite(Number(item?.maxStack)) ? Math.max(1, Math.floor(Number(item.maxStack))) : null,
        requiresSupport: item?.requiresSupport === true,
        snapPriority: Number.isFinite(Number(item?.snapPriority)) ? Number(item.snapPriority) : 0,
        renderColors: colors
      };
    })
    .filter(Boolean)
);

const refreshObstacleGeometry = (obstacle = {}, itemDef = {}) => {
  const normalizedItem = {
    ...itemDef,
    width: Math.max(8, Number(obstacle?.width) || Number(itemDef?.width) || 84),
    depth: Math.max(8, Number(obstacle?.depth) || Number(itemDef?.depth) || 24),
    height: Math.max(6, Number(obstacle?.height) || Number(itemDef?.height) || 38),
    collider: itemDef?.collider || obstacle?.collider || null,
    renderProfile: itemDef?.renderProfile || obstacle?.renderProfile || null,
    interactions: Array.isArray(itemDef?.interactions) ? itemDef.interactions : (Array.isArray(obstacle?.interactions) ? obstacle.interactions : []),
    sockets: Array.isArray(itemDef?.sockets) ? itemDef.sockets : (Array.isArray(obstacle?.sockets) ? obstacle.sockets : [])
  };
  const geometry = getItemGeometry(normalizedItem);
  const colors = obstacle?.renderColors && typeof obstacle.renderColors === 'object'
    ? obstacle.renderColors
    : resolveBattleLayerColors(normalizedItem, { battleTone: true });
  obstacle.collider = geometry.collider;
  obstacle.renderProfile = geometry.renderProfile;
  obstacle.interactions = geometry.interactions;
  obstacle.sockets = geometry.sockets;
  obstacle.renderColors = colors;
  obstacle.colliderParts = buildWorldColliderParts(obstacle, normalizedItem, {
    stackLayerHeight: Math.max(1, Number(obstacle?.height) || Number(itemDef?.height) || 32)
  });
  return obstacle;
};

const cloneObstacleList = (list = []) => (
  (Array.isArray(list) ? list : []).map((wall) => ({
    ...wall,
    hp: Number(wall?.hp) || Number(wall?.maxHp) || 1,
    destroyed: !!wall?.destroyed
  })).map((wall) => refreshObstacleGeometry(wall, wall))
);


const computeFieldSize = (battlefield = {}) => ({
  width: Math.max(280, Number(battlefield?.layoutMeta?.fieldWidth) || DEFAULT_FIELD_WIDTH),
  height: Math.max(240, Number(battlefield?.layoutMeta?.fieldHeight) || DEFAULT_FIELD_HEIGHT)
});

const getDeployRange = (fieldWidth, radius = 0) => {
  const safeWidth = Math.max(120, Number(fieldWidth) || DEFAULT_FIELD_WIDTH);
  const half = safeWidth / 2;
  const r = Math.max(0, Number(radius) || 0);
  const zoneWidth = Math.max(10, safeWidth * DEPLOY_ZONE_RATIO);
  const minX = -half + r;
  const maxX = half - r;
  const attackerMaxX = Math.min(maxX, (-half + zoneWidth) - r);
  const defenderMinX = Math.max(minX, (half - zoneWidth) + r);
  return {
    attackerMaxX,
    defenderMinX,
    minX,
    maxX
  };
};

const isXInDeployZone = (x, fieldWidth, radius = 0, team = TEAM_ATTACKER) => {
  const safeX = Number(x);
  if (!Number.isFinite(safeX)) return false;
  const bounds = getDeployRange(fieldWidth, radius);
  if (team === TEAM_DEFENDER) {
    return safeX >= bounds.defenderMinX && safeX <= bounds.maxX;
  }
  return safeX >= bounds.minX && safeX <= bounds.attackerMaxX;
};

const clampXToDeployZone = (x, fieldWidth, radius = 0, team = TEAM_ATTACKER) => {
  const bounds = getDeployRange(fieldWidth, radius);
  if (team === TEAM_DEFENDER) {
    return clampToRange(Number(x) || 0, bounds.defenderMinX, bounds.maxX);
  }
  return clampToRange(Number(x) || 0, bounds.minX, bounds.attackerMaxX);
};

const clampXToTeamZone = (x, fieldWidth, radius = 0, team = TEAM_ATTACKER) => {
  const half = fieldWidth / 2;
  const r = Math.max(0, Number(radius) || 0);
  const minX = -half + r;
  const maxX = half - r;
  const attackerMax = Math.min(maxX, -TEAM_ZONE_GUTTER - r);
  const defenderMin = Math.max(minX, TEAM_ZONE_GUTTER + r);
  if (team === TEAM_DEFENDER) {
    return clamp(Number(x) || 0, defenderMin, maxX);
  }
  return clamp(Number(x) || 0, minX, attackerMax);
};

const clampPointToField = (point, field, radius = 0) => ({
  x: clamp(Number(point?.x) || 0, -field.width / 2 + radius, field.width / 2 - radius),
  y: clamp(Number(point?.y) || 0, -field.height / 2 + radius, field.height / 2 - radius)
});

const normalizeUnitsList = (list = []) => {
  const map = {};
  (Array.isArray(list) ? list : []).forEach((row) => {
    const unitTypeId = typeof row?.unitTypeId === 'string' ? row.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(row?.count) || 0));
    if (!unitTypeId || count <= 0) return;
    map[unitTypeId] = (map[unitTypeId] || 0) + count;
  });
  return map;
};

const buildSkillMetaFromSquad = (squad = null, unitTypeMap = new Map()) => {
  if (!squad || squad.team !== TEAM_ATTACKER || squad.remain <= 0) {
    return { cooldownRemain: 0, skills: [] };
  }
  const classCounts = {
    infantry: 0,
    cavalry: 0,
    archer: 0,
    artillery: 0
  };
  const sourceUnits = squad.remainUnits && Object.keys(squad.remainUnits).length > 0
    ? squad.remainUnits
    : (squad.units || {});
  Object.entries(sourceUnits || {}).forEach(([unitTypeId, rawCount]) => {
    const count = Math.max(0, Number(rawCount) || 0);
    if (count <= 0) return;
    const classTag = inferClassFromUnitType(unitTypeMap.get(unitTypeId) || {});
    classCounts[classTag] = (classCounts[classTag] || 0) + count;
  });
  if (Object.values(classCounts).every((count) => count <= 0)) {
    const fallbackClass = typeof squad.classTag === 'string' ? squad.classTag : 'infantry';
    classCounts[fallbackClass] = Math.max(1, Number(squad.remain) || 1);
  }
  const cooldownMap = squad.skillCooldowns && typeof squad.skillCooldowns === 'object'
    ? squad.skillCooldowns
    : {};
  const fallbackCooldown = Math.max(0, Number(squad.attackCooldown) || 0);
  let maxRemain = 0;
  const skills = [];
  SKILL_CLASS_ORDER.forEach((classTag) => {
    const count = Math.max(0, Number(classCounts[classTag]) || 0);
    if (count <= 0) return;
    const skillMeta = SKILL_META_BY_CLASS[classTag] || SKILL_META_BY_CLASS.infantry;
    const cooldownTotal = Math.max(0.1, Number(SKILL_COOLDOWN_BY_CLASS[classTag]) || 6);
    const cooldownRemain = Math.max(
      0,
      Number.isFinite(Number(cooldownMap[classTag])) ? Number(cooldownMap[classTag]) : fallbackCooldown
    );
    maxRemain = Math.max(maxRemain, cooldownRemain);
    const center = squad.classCenters && squad.classCenters[classTag] ? squad.classCenters[classTag] : null;
    skills.push({
      id: skillMeta.id,
      name: skillMeta.name,
      kind: classTag,
      classTag,
      count: Math.round(count),
      description: SKILL_DESC_BY_CLASS[classTag] || '',
      icon: skillMeta.icon,
      cooldownTotal,
      cooldownRemain,
      anchor: center ? {
        x: Number(center.x) || Number(squad.x) || 0,
        y: Number(center.y) || Number(squad.y) || 0
      } : {
        x: Number(squad.x) || 0,
        y: Number(squad.y) || 0
      },
      available: cooldownRemain <= 0.01 && (Number(squad.morale) || 0) > 0
    });
  });
  return {
    cooldownRemain: maxRemain,
    skills
  };
};

const estimateDeploySkillPower = ({
  classTag = 'infantry',
  classCount = 0,
  classAtkAvg = 0,
  totalCount = 0,
  repConfig = {}
} = {}) => {
  const safeCount = Math.max(1, Number(classCount) || 1);
  const safeAtk = Math.max(0.1, Number(classAtkAvg) || 0.1);
  const safeTotal = Math.max(1, Number(totalCount) || 1);
  const exponent = Math.max(0.2, Math.min(1.25, Number(repConfig?.damageExponent) || 0.75));
  const maxAgentWeight = Math.max(1, Number(repConfig?.maxAgentWeight) || 50);
  const repAgentCount = Math.max(1, Math.ceil(safeCount / maxAgentWeight));
  const representativeWeight = Math.max(1, safeCount / repAgentCount);
  const countWeight = Math.pow(representativeWeight, exponent);
  if (classTag === 'cavalry') {
    const cfg = SKILL_POWER_CONFIG_BY_CLASS.cavalry;
    const impact = safeAtk * cfg.impactAtkMul * countWeight;
    return {
      score: impact,
      unit: '冲击伤害估值',
      formula: `atk×${cfg.impactAtkMul}×repWeight^${exponent.toFixed(2)}`,
      details: [
        `代表权重 ${representativeWeight.toFixed(2)}`,
        `冲锋距离 ${cfg.minDistance}-${cfg.maxDistance}`,
        `冲锋速度 ${cfg.speed}`
      ]
    };
  }
  if (classTag === 'archer' || classTag === 'artillery') {
    const cfg = SKILL_POWER_CONFIG_BY_CLASS[classTag];
    const perShot = Math.max(0.22, safeAtk * cfg.damageAtkMul) * cfg.damageMul * countWeight;
    const shooterCountCandidate = classTag === 'artillery'
      ? Math.max(2, Math.min(6, Math.floor(Math.sqrt(repAgentCount)) + 1))
      : Math.max(3, Math.min(14, Math.floor(Math.sqrt(repAgentCount)) + 3));
    const shooterCount = Math.max(1, Math.min(repAgentCount, shooterCountCandidate));
    const shooterWeightSum = shooterCount * representativeWeight;
    const shotWeightRef = classTag === 'artillery' ? 18 : 24;
    const shotScale = clamp(shooterWeightSum / shotWeightRef, 0.12, 1);
    const shotsPerWaveCap = Math.max(1, Number(cfg.shotsPerWave) || (classTag === 'artillery' ? 6 : 12));
    const scaledShotBudget = Math.max(1, Math.round(shotsPerWaveCap * shotScale));
    const floorByShooters = classTag === 'artillery'
      ? Math.max(1, Math.ceil(shooterCount * 0.5))
      : Math.max(1, Math.ceil(shooterCount * 0.8));
    const shotsPerWave = Math.max(
      1,
      Math.min(
        shotsPerWaveCap,
        Math.max(floorByShooters, scaledShotBudget)
      )
    );
    const shotCount = Math.max(1, cfg.waves * shotsPerWave);
    return {
      score: perShot * shotCount,
      unit: '总伤害估值',
      formula: `max(0.22, atk×${cfg.damageAtkMul})×${cfg.damageMul}×repWeight^${exponent.toFixed(2)}×${shotCount}发`,
      details: [
        `代表权重 ${representativeWeight.toFixed(2)} / 代表射手 ${shooterCount}`,
        `持续 ${cfg.durationSec}s`,
        `${cfg.waves} 波 / 每波 ${shotsPerWave} 发（按当前兵力缩放）`
      ]
    };
  }
  const cfg = SKILL_POWER_CONFIG_BY_CLASS.infantry;
  const squadAtk = safeAtk * safeTotal;
  const uplift = squadAtk * (cfg.atkMul - 1) * (safeCount / safeTotal);
  return {
    score: uplift,
    unit: '增益攻击估值',
    formula: '队伍总atk×(atk倍率-1)×(兵种占比)',
    details: [
      `持续 ${cfg.durationSec}s`,
      `攻${Math.round((cfg.atkMul - 1) * 100)}% / 防${Math.round((cfg.defMul - 1) * 100)}% / 速-${Math.round((1 - cfg.speedMul) * 100)}%`
    ]
  };
};

const buildDeployGroupInfo = (group = null, unitTypeMap = new Map(), repConfig = {}) => {
  if (!group || typeof group !== 'object') return null;
  const units = normalizeUnitsMap(group?.units || {});
  const totalCount = sumUnitsMap(units);
  if (totalCount <= 0) return null;

  const composition = Object.entries(units)
    .map(([unitTypeId, rawCount]) => {
      const unitType = unitTypeMap.get(unitTypeId) || {};
      const count = Math.max(0, Number(rawCount) || 0);
      const speed = Math.max(0.2, Number(unitType?.speed) || 1);
      const atk = Math.max(0.1, Number(unitType?.atk) || 1);
      const range = Math.max(1, Number(unitType?.range) || 1);
      const classTag = inferClassFromUnitType(unitType);
      const roleTag = unitType?.roleTag === '远程' ? '远程' : '近战';
      return {
        unitTypeId,
        unitName: unitType?.name || unitTypeId,
        count,
        percent: (count / Math.max(1, totalCount)) * 100,
        classTag,
        roleTag,
        speed,
        atk,
        range
      };
    })
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.unitName.localeCompare(b.unitName, 'zh-Hans-CN');
    });

  const classSummary = {
    infantry: { count: 0, atkTotal: 0 },
    cavalry: { count: 0, atkTotal: 0 },
    archer: { count: 0, atkTotal: 0 },
    artillery: { count: 0, atkTotal: 0 }
  };
  let totalAtk = 0;
  let speedReciprocalSum = 0;
  let looseSpeed = 0;
  let hasRanged = false;
  let hasMelee = false;

  composition.forEach((row) => {
    const safeCount = Math.max(0, Number(row.count) || 0);
    const safeAtk = Math.max(0.1, Number(row.atk) || 0.1);
    const safeSpeed = Math.max(0.2, Number(row.speed) || 1);
    totalAtk += safeAtk * safeCount;
    speedReciprocalSum += safeCount / safeSpeed;
    looseSpeed = Math.max(looseSpeed, safeSpeed);
    if (row.roleTag === '远程' || row.range >= 2.2) hasRanged = true;
    if (row.roleTag === '近战' || row.range < 2.2) hasMelee = true;
    classSummary[row.classTag].count += safeCount;
    classSummary[row.classTag].atkTotal += safeAtk * safeCount;
  });

  const skills = SKILL_CLASS_ORDER
    .map((classTag) => {
      const count = Math.max(0, Number(classSummary[classTag]?.count) || 0);
      if (count <= 0) return null;
      const avgAtk = (Number(classSummary[classTag]?.atkTotal) || 0) / Math.max(1, count);
      const power = estimateDeploySkillPower({
        classTag,
        classCount: count,
        classAtkAvg: avgAtk,
        totalCount,
        repConfig
      });
      const skillMeta = SKILL_META_BY_CLASS[classTag] || SKILL_META_BY_CLASS.infantry;
      return {
        id: skillMeta.id,
        classTag,
        name: skillMeta.name,
        icon: skillMeta.icon,
        description: SKILL_DESC_BY_CLASS[classTag] || '',
        count,
        ratio: (count / Math.max(1, totalCount)) * 100,
        power
      };
    })
    .filter(Boolean);

  return {
    groupId: String(group?.id || ''),
    team: group?.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER,
    name: String(group?.name || '未命名部队'),
    totalCount: Math.max(0, Math.round(totalCount)),
    composition,
    skills,
    mobility: {
      cohesiveSpeed: speedReciprocalSum > 0 ? (totalCount / speedReciprocalSum) : 1,
      looseSpeed: Math.max(0.2, looseSpeed || 1),
      perTypeLoose: composition.map((row) => ({
        unitTypeId: row.unitTypeId,
        unitName: row.unitName,
        speed: Math.max(0.2, Number(row.speed) || 1)
      }))
    },
    attack: {
      totalAtk,
      avgAtk: totalAtk / Math.max(1, totalCount),
      modes: [
        ...(hasMelee ? ['近'] : []),
        ...(hasRanged ? ['远'] : [])
      ]
    }
  };
};

const hashWaypoints = (waypoints = []) => {
  if (!Array.isArray(waypoints) || waypoints.length <= 0) return '';
  let out = '';
  for (let i = 0; i < waypoints.length; i += 1) {
    const p = waypoints[i];
    const x = Math.round((Number(p?.x) || 0) * 10) / 10;
    const y = Math.round((Number(p?.y) || 0) * 10) / 10;
    out += `${x},${y};`;
  }
  return out;
};

const buildRosterMap = (list = [], unitTypeMap = new Map()) => {
  const rows = {};
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
    if (!unitTypeId || count <= 0) return;
    rows[unitTypeId] = {
      unitTypeId,
      unitName: entry?.unitName || unitTypeMap.get(unitTypeId)?.name || unitTypeId,
      count: (rows[unitTypeId]?.count || 0) + count
    };
  });
  return rows;
};

const collectUsedUnitsMap = (groups = []) => {
  const used = {};
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    Object.entries(normalizeUnitsMap(group?.units || {})).forEach(([unitTypeId, count]) => {
      if (!unitTypeId || count <= 0) return;
      used[unitTypeId] = (used[unitTypeId] || 0) + count;
    });
  });
  return used;
};

const normalizeDeploymentUnits = (deployment = {}) => {
  const source = Array.isArray(deployment?.units) && deployment.units.length > 0
    ? deployment.units
    : [{ unitTypeId: deployment?.unitTypeId, count: deployment?.count }];
  return source
    .map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    }))
    .filter((entry) => entry.unitTypeId && entry.count > 0);
};

const normalizeFormationFacing = (team = TEAM_ATTACKER, rawFacing = null) => {
  const fallback = team === TEAM_DEFENDER ? Math.PI : 0;
  const candidate = Number(rawFacing);
  if (!Number.isFinite(candidate)) return fallback;
  return candidate;
};

const resolveDeploySlotCount = (units = {}, repConfig = {}) => {
  const normalized = normalizeUnitsMap(units || {});
  const count = estimateRepAgents(normalized, Math.max(1, Number(repConfig?.maxAgentWeight) || 50));
  return Math.max(1, Math.floor(Number(count) || 1));
};

const clampFormationByArea = (inputRect = {}) => {
  const spacing = Math.max(4, Number(inputRect?.spacing) || DEPLOY_FORMATION_SPACING_DEFAULT);
  const baseArea = Math.max(spacing * spacing, Number(inputRect?.area) || (spacing * spacing));
  const edgeMin = Math.max(DEPLOY_FORMATION_MIN_EDGE, spacing * 0.72);
  const edgeMax = Math.max(edgeMin, Math.sqrt(baseArea) * DEPLOY_FORMATION_MAX_EDGE_MUL);
  let width = Number(inputRect?.width);
  let depth = Number(inputRect?.depth);
  if (!Number.isFinite(width) && Number.isFinite(depth) && depth > 0) width = baseArea / depth;
  if (!Number.isFinite(depth) && Number.isFinite(width) && width > 0) depth = baseArea / width;
  if (!Number.isFinite(width) || width <= 0) width = Math.sqrt(baseArea);
  if (!Number.isFinite(depth) || depth <= 0) depth = Math.sqrt(baseArea);

  width = clamp(width, edgeMin, edgeMax);
  depth = baseArea / Math.max(edgeMin, width);
  depth = clamp(depth, edgeMin, edgeMax);
  width = baseArea / Math.max(edgeMin, depth);
  width = clamp(width, edgeMin, edgeMax);

  let ratio = width / Math.max(1e-6, depth);
  if (ratio < DEPLOY_FORMATION_RATIO_MIN) {
    width = Math.sqrt(baseArea * DEPLOY_FORMATION_RATIO_MIN);
    depth = baseArea / Math.max(edgeMin, width);
  } else if (ratio > DEPLOY_FORMATION_RATIO_MAX) {
    width = Math.sqrt(baseArea * DEPLOY_FORMATION_RATIO_MAX);
    depth = baseArea / Math.max(edgeMin, width);
  }
  width = clamp(width, edgeMin, edgeMax);
  depth = clamp(baseArea / Math.max(edgeMin, width), edgeMin, edgeMax);
  ratio = width / Math.max(1e-6, depth);

  return {
    area: width * depth,
    width,
    depth,
    spacing,
    ratio
  };
};

const buildFormationSlots = (slotCount = 1, formationRect = {}) => {
  const total = Math.max(1, Math.floor(Number(slotCount) || 1));
  const width = Math.max(DEPLOY_FORMATION_MIN_EDGE, Number(formationRect?.width) || DEPLOY_FORMATION_MIN_EDGE);
  const depth = Math.max(DEPLOY_FORMATION_MIN_EDGE, Number(formationRect?.depth) || DEPLOY_FORMATION_MIN_EDGE);
  const rows = Math.max(1, Math.ceil(Math.sqrt(total * (depth / Math.max(1, width)))));
  const cols = Math.max(1, Math.ceil(total / rows));
  const stepSide = width / Math.max(1, cols);
  const stepFront = depth / Math.max(1, rows);
  return Array.from({ length: total }, (_, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const side = ((col + 0.5) - (cols * 0.5)) * stepSide;
    const front = (((rows - 1 - row) + 0.5) - (rows * 0.5)) * stepFront;
    return { side, front, row, col };
  });
};

const buildDeployGroupFormationState = (group = {}, team = TEAM_ATTACKER, repConfig = {}) => {
  const units = normalizeUnitsMap(group?.units || {});
  const slotCount = resolveDeploySlotCount(units, repConfig);
  const spacing = Math.max(4, Number(group?.formationRect?.spacing) || DEPLOY_FORMATION_SPACING_DEFAULT);
  const facingRad = normalizeFormationFacing(team, group?.formationRect?.facingRad);
  const prevRect = group?.formationRect && typeof group.formationRect === 'object' ? group.formationRect : {};
  const fallbackCols = Math.max(1, Math.ceil(Math.sqrt(slotCount)));
  const fallbackRows = Math.max(1, Math.ceil(slotCount / fallbackCols));
  const baseRect = clampFormationByArea({
    width: Number(prevRect.width) || (fallbackCols * spacing),
    depth: Number(prevRect.depth) || (fallbackRows * spacing),
    area: Number(prevRect.area) || ((fallbackCols * spacing) * (fallbackRows * spacing)),
    spacing
  });
  const formationRect = {
    area: baseRect.area,
    width: baseRect.width,
    depth: baseRect.depth,
    spacing,
    facingRad,
    slotCount
  };
  return {
    ...group,
    formationRect,
    deploySlots: buildFormationSlots(slotCount, formationRect)
  };
};


const buildDefenderDeployGroups = (defenderUnits, defenderDeployments, field, unitTypeMap) => {
  const availableMap = new Map(
    Object.entries(normalizeUnitsList(defenderUnits)).map(([unitTypeId, count]) => [
      unitTypeId,
      {
        count,
        unitName: unitTypeMap.get(unitTypeId)?.name || unitTypeId
      }
    ])
  );

  const groups = [];
  const deployments = (Array.isArray(defenderDeployments) ? defenderDeployments : []).filter((row) => row?.placed !== false);
  const sorted = [...deployments].sort((a, b) => {
    const aOrder = Math.max(0, Number(a?.sortOrder) || 0);
    const bOrder = Math.max(0, Number(b?.sortOrder) || 0);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-Hans-CN');
  });

  sorted.forEach((deploy, index) => {
    const requested = normalizeDeploymentUnits(deploy);
    if (requested.length <= 0) return;
    const assigned = {};
    requested.forEach((entry) => {
      const info = availableMap.get(entry.unitTypeId);
      if (!info) return;
      const take = Math.min(info.count, entry.count);
      if (take <= 0) return;
      info.count -= take;
      assigned[entry.unitTypeId] = (assigned[entry.unitTypeId] || 0) + take;
    });
    if (sumUnitsMap(assigned) <= 0) return;
    const deployRotationDeg = Number(deploy?.rotation);
    groups.push({
      id: `def_${deploy?.deployId || (index + 1)}`,
      team: TEAM_DEFENDER,
      name: (typeof deploy?.name === 'string' && deploy.name.trim()) ? deploy.name.trim() : `守军${index + 1}`,
      units: assigned,
      x: clampXToDeployZone(Number(deploy?.x) || 0, field.width, 0, TEAM_DEFENDER),
      y: clamp(Number(deploy?.y) || 0, -field.height / 2, field.height / 2),
      formationRect: Number.isFinite(deployRotationDeg)
        ? { facingRad: degToRad(normalizeDeg(deployRotationDeg)) }
        : undefined,
      placed: true
    });
  });

  const remain = Array.from(availableMap.entries())
    .map(([unitTypeId, info]) => ({ unitTypeId, count: info.count, unitName: info.unitName }))
    .filter((row) => row.count > 0);

  if (remain.length > 0) {
    const rows = Math.max(1, Math.ceil(Math.sqrt(remain.length)));
    remain.forEach((entry, index) => {
      const row = index % rows;
      const layer = Math.floor(index / rows);
      const y = -field.height * 0.34 + ((row + 1) * ((field.height * 0.68) / (rows + 1)));
      const x = clampXToDeployZone((field.width / 2) - 80 - (layer * 60), field.width, 0, TEAM_DEFENDER);
      groups.push({
        id: `def_auto_${index + 1}`,
        team: TEAM_DEFENDER,
        name: entry.unitName || entry.unitTypeId,
        units: { [entry.unitTypeId]: entry.count },
        x,
        y,
        placed: true
      });
    });
  }

  return groups;
};

const DEFAULT_BEHAVIOR_PROFILE = {
  transitionSec: {
    moveToAttack: 0.3,
    attackToMove: 0.28,
    forwardToRetreat: 0.36,
    retreatToForward: 0.36
  }
};

const DEFAULT_STAGGER_REACTION = {
  durationSec: {
    light: 0.35,
    medium: 0.52,
    heavy: 0.76,
    knockdown: 1.02
  }
};

const DEFAULT_STABILITY_PROFILE = {
  poiseMax: 100,
  chargePoise: 140,
  transitionMax: 90,
  poiseRegenPerSec: 6.2,
  transitionDecayPerSec: 4.1,
  transitionRegenPerSec: 2.5
};

const resolveComponentData = (unitType = {}, key = '') => {
  if (!key) return null;
  const comp = unitType?.components?.[key];
  if (Array.isArray(comp)) return comp.length > 0 ? comp[0] : null;
  return comp && typeof comp === 'object' ? comp : null;
};

const resolveBehaviorProfile = (unitType = {}) => {
  const profile = resolveComponentData(unitType, 'behaviorProfile');
  return profile?.data && typeof profile.data === 'object'
    ? profile.data
    : DEFAULT_BEHAVIOR_PROFILE;
};

const resolveStabilityProfile = (unitType = {}) => {
  const profile = resolveComponentData(unitType, 'stabilityProfile');
  return profile?.data && typeof profile.data === 'object'
    ? profile.data
    : DEFAULT_STABILITY_PROFILE;
};

const resolveStaggerReaction = (unitType = {}) => {
  const profile = resolveComponentData(unitType, 'staggerReaction');
  return profile?.data && typeof profile.data === 'object'
    ? profile.data
    : DEFAULT_STAGGER_REACTION;
};

const createSquad = ({
  group,
  index,
  team,
  unitTypeMap,
  unitsPerSoldier,
  fieldWidth,
  fieldHeight,
  allowCrossMidline = true
}) => {
  const units = normalizeUnitsMap(group?.units || {});
  const startCount = sumUnitsMap(units);
  const stats = aggregateStats(units, unitTypeMap);
  const mainType = unitTypeMap.get(stats.mainTypeId) || {};
  const behaviorProfile = resolveBehaviorProfile(mainType);
  const stabilityProfile = resolveStabilityProfile(mainType);
  const staggerReaction = resolveStaggerReaction(mainType);
  const poiseMax = Math.max(20, Number(stabilityProfile.poiseMax) || 100);
  const transitionMax = Math.max(20, Number(stabilityProfile.transitionMax) || 90);
  const chargePoise = Math.max(poiseMax, Number(stabilityProfile.chargePoise) || (poiseMax * 1.2));
  const hpAvg = Math.max(1, Number(stats.hpAvg) || 1);
  const maxHealth = Math.max(1, Math.round(startCount * hpAvg));
  const radius = clamp(8 + (Math.sqrt(Math.max(1, startCount)) * 0.58), 10, 118);
  const startX = allowCrossMidline
    ? clamp(Number(group?.x) || 0, -fieldWidth / 2 + radius, fieldWidth / 2 - radius)
    : clampXToTeamZone(Number(group?.x) || 0, fieldWidth, radius, team);
  const startY = clamp(
    Number(group?.y) || 0,
    (-fieldHeight / 2) + radius,
    (fieldHeight / 2) - radius
  );
  const rallyRadius = Math.max(6, Math.min(16, radius * 0.35));
  const rallyDefaultX = team === TEAM_ATTACKER ? (-fieldWidth / 2 + 40) : (fieldWidth / 2 - 40);
  const rallyX = allowCrossMidline
    ? clamp(rallyDefaultX, -fieldWidth / 2 + rallyRadius, fieldWidth / 2 - rallyRadius)
    : clampXToTeamZone(rallyDefaultX, fieldWidth, rallyRadius, team);

  return {
    id: `${team}_squad_${index + 1}`,
    name: group?.name || (team === TEAM_ATTACKER ? `我方${index + 1}` : `守军${index + 1}`),
    team,
    units,
    startCount,
    remain: startCount,
    remainUnits: { ...units },
    kills: 0,
    losses: 0,
    maxHealth,
    health: maxHealth,
    hpAvg,
    stamina: STAMINA_MAX,
    morale: MORALE_MAX,
    stats,
    classTag: stats.classTag,
    roleTag: stats.roleTag,
    rpsType: stats.rpsType || 'mobility',
    professionId: stats.professionId || '',
    tags: Array.isArray(mainType?.tags) ? mainType.tags : [],
    tier: Math.max(1, Number(stats.tier) || 1),
    mainUnitTypeId: stats.mainTypeId || '',
    formationRect: group?.formationRect && typeof group.formationRect === 'object'
      ? {
        area: Math.max(1, Number(group.formationRect.area) || 1),
        width: Math.max(1, Number(group.formationRect.width) || 1),
        depth: Math.max(1, Number(group.formationRect.depth) || 1),
        spacing: Math.max(1, Number(group.formationRect.spacing) || DEPLOY_FORMATION_SPACING_DEFAULT),
        facingRad: normalizeFormationFacing(team, group.formationRect.facingRad),
        slotCount: Math.max(1, Math.floor(Number(group.formationRect.slotCount) || 1))
      }
      : null,
    deploySlots: Array.isArray(group?.deploySlots)
      ? group.deploySlots
        .map((slot) => ({
          side: Number(slot?.side) || 0,
          front: Number(slot?.front) || 0,
          row: Math.max(0, Math.floor(Number(slot?.row) || 0)),
          col: Math.max(0, Math.floor(Number(slot?.col) || 0))
        }))
      : [],
    x: startX,
    y: startY,
    vx: 0,
    vy: 0,
    dirX: team === TEAM_ATTACKER ? 1 : -1,
    dirY: 0,
    speed: 0,
    radius,
    waypoints: [],
    action: '待命',
    actionState: {
      kind: 'none',
      from: 'none',
      to: 'none',
      ttl: 0,
      dur: 0
    },
    behaviorProfile,
    stability: {
      poise: poiseMax,
      poiseMax,
      chargePoise,
      chargePoiseCurrent: chargePoise,
      transition: transitionMax,
      transitionMax,
      poiseRegenPerSec: Math.max(0.2, Number(stabilityProfile.poiseRegenPerSec) || 6.2),
      transitionDecayPerSec: Math.max(0.1, Number(stabilityProfile.transitionDecayPerSec) || 4.1),
      transitionRegenPerSec: Math.max(0.1, Number(stabilityProfile.transitionRegenPerSec) || 2.5)
    },
    staggerReaction,
    behavior: team === TEAM_DEFENDER ? 'auto' : 'idle',
    order: {
      type: ORDER_IDLE,
      issuedAt: 0,
      commitUntil: 0,
      targetPoint: null,
      targetSquadId: ''
    },
    speedMode: SPEED_MODE_B,
    speedModeAuthority: SPEED_AUTH_AI,
    speedPolicy: SPEED_POLICY_MARCH,
    marchMode: MARCH_MODE_COHESIVE,
    reformUntil: 0,
    reformRadiusThreshold: Math.max(18, radius * 1.4),
    underAttackTimer: 0,
    attackCooldown: 0,
    effectBuff: null,
    fatigueTimer: 0,
    unitsPerSoldier: Math.max(1, Number(unitsPerSoldier) || DEFAULT_UNITS_PER_SOLDIER),
    rallyPoint: {
      x: rallyX,
      y: 0
    },
    skillUsedCount: 0,
    lastAttackedAt: 0,
    skillCooldowns: {
      infantry: 0,
      cavalry: 0,
      archer: 0,
      artillery: 0
    },
    classCenters: {
      infantry: { x: startX, y: startY, count: 0 },
      cavalry: { x: startX, y: startY, count: 0 },
      archer: { x: startX, y: startY, count: 0 },
      artillery: { x: startX, y: startY, count: 0 }
    },
    lastMoveMarker: null,
    guard: { enabled: false, cx: startX, cy: startY, radius: 0, returnRadius: 0, chaseRadius: 0, activeTargetId: '' },
    selected: false,
    hover: false,
    flagBearerAgentId: ''
  };
};

const buildVisualResolver = (visualConfig, unitTypeMap = new Map()) => {
  const byType = (visualConfig && typeof visualConfig === 'object' && visualConfig.byType) ? visualConfig.byType : {};
  const byClass = (visualConfig && typeof visualConfig === 'object' && visualConfig.byClass) ? visualConfig.byClass : {};
  const fallback = (visualConfig && typeof visualConfig === 'object' && visualConfig.fallback) ? visualConfig.fallback : {
    bodyIndex: 0,
    gearIndex: 0,
    vehicleIndex: 0
  };

  return (unitTypeId, classTag) => {
    const unitType = unitTypeMap.get(unitTypeId) || null;
    const battleVisual = unitType?.visuals?.battle && typeof unitType.visuals.battle === 'object'
      ? unitType.visuals.battle
      : null;
    if (battleVisual) {
      const bodyIndex = Math.max(0, Number(battleVisual.spriteFrontLayer ?? battleVisual.bodyLayer) || 0);
      const gearIndex = Math.max(0, Number(battleVisual.gearLayer) || 0);
      const vehicleIndex = Math.max(0, Number(battleVisual.vehicleLayer) || 0);
      const silhouetteIndex = Math.max(0, Number(battleVisual.silhouetteLayer) || 0);
      const explicitTop = Number.isFinite(Number(battleVisual.spriteTopLayer))
        ? Math.max(0, Math.floor(Number(battleVisual.spriteTopLayer)))
        : null;
      return {
        bodyIndex,
        gearIndex,
        vehicleIndex,
        silhouetteIndex,
        bodyTopIndex: explicitTop !== null ? explicitTop : resolveTopLayer(bodyIndex),
        gearTopIndex: resolveTopLayer(gearIndex),
        vehicleTopIndex: resolveTopLayer(vehicleIndex),
        silhouetteTopIndex: resolveTopLayer(silhouetteIndex),
        tint: Number.isFinite(Number(battleVisual.tint)) ? Number(battleVisual.tint) : 0
      };
    }
    const type = byType[unitTypeId] || null;
    const group = type || byClass[classTag] || fallback;
    return {
      bodyIndex: Math.max(0, Number(group?.bodyIndex) || 0),
      gearIndex: Math.max(0, Number(group?.gearIndex) || 0),
      vehicleIndex: Math.max(0, Number(group?.vehicleIndex) || 0),
      silhouetteIndex: Math.max(0, Number(group?.silhouetteIndex) || 0),
      bodyTopIndex: resolveTopLayer(Math.max(0, Number(group?.bodyIndex) || 0)),
      gearTopIndex: resolveTopLayer(Math.max(0, Number(group?.gearIndex) || 0)),
      vehicleTopIndex: resolveTopLayer(Math.max(0, Number(group?.vehicleIndex) || 0)),
      silhouetteTopIndex: resolveTopLayer(Math.max(0, Number(group?.silhouetteIndex) || 0)),
      tint: Number.isFinite(Number(group?.tint)) ? Number(group.tint) : 0
    };
  };
};

export default class BattleRuntime {
  constructor(initData, options = {}) {
    this.initData = initData || {};
    this.phase = 'deploy';
    this.startedAtMs = 0;
    this.endedAtMs = 0;
    this.intelVisible = this.initData?.battlefield?.intelVisible !== false;

    this.unitTypeMap = buildUnitTypeMap(this.initData?.unitTypes || []);
    this.field = computeFieldSize(this.initData?.battlefield || {});
    this.unitsPerSoldier = Math.max(1, Number(this.initData?.unitsPerSoldier) || DEFAULT_UNITS_PER_SOLDIER);
    this.repConfig = buildRepConfig(options?.repConfig || {});
    this.visualConfig = buildVisualResolver(options?.visualConfig || {}, this.unitTypeMap);
    const initAllowCross = this.initData?.rules?.allowCrossMidline;
    const optionAllowCross = options?.rules?.allowCrossMidline;
    this.rules = {
      allowCrossMidline: typeof optionAllowCross === 'boolean'
        ? optionAllowCross
        : (typeof initAllowCross === 'boolean' ? initAllowCross : true)
    };
    const attackerRosterSource = this.initData?.attacker?.rosterUnits || this.initData?.attacker?.units || [];
    const defenderRosterSource = this.initData?.defender?.rosterUnits || this.initData?.defender?.units || [];
    const defenderDeploySource = this.initData?.defender?.deployUnits || this.initData?.defender?.units || [];
    this.attackerRoster = buildRosterMap(attackerRosterSource, this.unitTypeMap);
    this.defenderRoster = buildRosterMap(defenderRosterSource, this.unitTypeMap);
    this.itemCatalog = buildItemCatalog(this.initData?.battlefield || {});
    console.log(
      `[battlefield] Loaded BattlefieldItem catalog count=${this.itemCatalog.length} enabled=${this.itemCatalog.length}`
    );

    this.attackerDeployGroups = [];
    this.defenderDeployGroups = buildDefenderDeployGroups(
      defenderDeploySource,
      this.initData?.battlefield?.defenderDeployments || [],
      this.field,
      this.unitTypeMap
    );
    this.attackerDeployGroups = this.attackerDeployGroups.map((group) => this.hydrateDeployGroupFormation(group, TEAM_ATTACKER));
    this.defenderDeployGroups = this.defenderDeployGroups.map((group) => this.hydrateDeployGroupFormation(group, TEAM_DEFENDER));
    this.initialBuildings = buildObstacleList(this.initData?.battlefield || {});

    this.selectedDeploySquadId = '';
    this.focusSquadId = '';
    this.selectedBattleSquadId = '';

    this.sim = null;
    this.crowd = null;
    this.cameraAnchor = { x: 0, y: 0, vx: 0, vy: 0, squadId: '', team: '' };
    this.cameraAnchorRaw = { x: 0, y: 0, vx: 0, vy: 0, squadId: '', team: '' };
    this._lastMidlineClamp = {
      squadId: '',
      preClampX: 0,
      postClampX: 0,
      team: '',
      radius: 0,
      allowedMinX: 0,
      allowedMaxX: 0,
      changed: false
    };

    this._snapshotSchema = BattleSnapshotSchema;
    this._snapshotPool = new BattleSnapshotPool(this._snapshotSchema);
    this._snapshotBuilder = new BattleSnapshotBuilder(this._snapshotSchema, this._snapshotPool);
    this.snapshotState = this._snapshotPool.acquire();

    this.debugStats = {
      simStepMs: 0,
      renderMs: 0,
      fps: 0,
      allowCrossMidline: this.rules.allowCrossMidline
    };
    this.orderSeq = 0;
    this.lastInputEventType = '';
    this._debugTrackOrder = (typeof window !== 'undefined' && /[?&]battleDebugOrder=1\b/.test(window.location.search || ''));
    this._waypointHashBySquad = new Map();
    this._lastOrderSeqSnapshot = 0;
  }

  getPhase() {
    return this.phase;
  }

  getField() {
    return this.field;
  }

  getRules() {
    return { ...this.rules };
  }

  getDeployRange() {
    return getDeployRange(this.field.width);
  }

  getDeployGroups() {
    return {
      attacker: this.attackerDeployGroups,
      defender: this.defenderDeployGroups,
      selectedId: this.selectedDeploySquadId
    };
  }

  setSelectedDeployGroup(groupId = '') {
    this.selectedDeploySquadId = String(groupId || '');
  }

  getDeployGroupById(groupId = '', team = TEAM_ANY) {
    const safeId = typeof groupId === 'string' ? groupId.trim() : '';
    if (!safeId) return null;
    const safeTeam = typeof team === 'string' ? team.trim() : '';
    if (safeTeam === TEAM_ATTACKER) {
      return this.attackerDeployGroups.find((row) => row.id === safeId) || null;
    }
    if (safeTeam === TEAM_DEFENDER) {
      return this.defenderDeployGroups.find((row) => row.id === safeId) || null;
    }
    return this.attackerDeployGroups.find((row) => row.id === safeId)
      || this.defenderDeployGroups.find((row) => row.id === safeId)
      || null;
  }

  getDeployGroupInfo(groupId = '', team = TEAM_ANY) {
    const group = this.getDeployGroupById(groupId, team);
    if (!group) return null;
    return buildDeployGroupInfo(group, this.unitTypeMap, this.repConfig);
  }

  hydrateDeployGroupFormation(group = null, fallbackTeam = TEAM_ATTACKER) {
    if (!group || typeof group !== 'object') return null;
    const team = group?.team === TEAM_DEFENDER ? TEAM_DEFENDER : resolveTeamTag(fallbackTeam);
    const hydrated = buildDeployGroupFormationState({
      ...group,
      team
    }, team, this.repConfig);
    Object.assign(group, hydrated);
    return group;
  }

  getDeployGroupSlots(groupId = '', team = TEAM_ANY) {
    const group = this.getDeployGroupById(groupId, team);
    if (!group) return [];
    this.hydrateDeployGroupFormation(group, group.team);
    return Array.isArray(group.deploySlots)
      ? group.deploySlots.map((slot) => ({ ...slot }))
      : [];
  }

  setDeployGroupRect(groupId = '', partialRect = {}, team = TEAM_ANY) {
    if (this.phase !== 'deploy') return { ok: false, reason: '仅部署阶段可调整阵型' };
    const group = this.getDeployGroupById(groupId, team);
    if (!group) return { ok: false, reason: '未找到部队' };
    this.hydrateDeployGroupFormation(group, group.team);
    const current = group.formationRect || {};
    const nextFacing = Number.isFinite(Number(partialRect?.facingRad))
      ? Number(partialRect.facingRad)
      : normalizeFormationFacing(group.team, current.facingRad);
    const spacing = Math.max(4, Number(partialRect?.spacing) || Number(current.spacing) || DEPLOY_FORMATION_SPACING_DEFAULT);
    const slotCount = Math.max(1, Math.floor(Number(current.slotCount) || resolveDeploySlotCount(group.units || {}, this.repConfig)));
    const requestedArea = Number.isFinite(Number(partialRect?.area))
      ? Math.max(spacing * spacing, Number(partialRect.area))
      : Math.max(spacing * spacing, Number(current.area) || (Number(current.width) || spacing) * (Number(current.depth) || spacing));
    let requestedWidth = Number(partialRect?.width);
    if (!Number.isFinite(requestedWidth) && Number.isFinite(Number(partialRect?.depth)) && Number(partialRect.depth) > 0) {
      requestedWidth = requestedArea / Number(partialRect.depth);
    }
    if (!Number.isFinite(requestedWidth)) requestedWidth = Number(current.width) || Math.sqrt(requestedArea);
    const normalizedRect = clampFormationByArea({
      width: requestedWidth,
      area: requestedArea,
      spacing
    });
    group.formationRect = {
      area: normalizedRect.area,
      width: normalizedRect.width,
      depth: normalizedRect.depth,
      spacing,
      facingRad: nextFacing,
      slotCount
    };
    group.deploySlots = buildFormationSlots(slotCount, group.formationRect);
    return {
      ok: true,
      formationRect: { ...group.formationRect },
      slotCount: group.deploySlots.length
    };
  }

  getRosterRows(team = TEAM_ATTACKER) {
    const safeTeam = resolveTeamTag(team);
    const groupRows = safeTeam === TEAM_DEFENDER ? this.defenderDeployGroups : this.attackerDeployGroups;
    const roster = safeTeam === TEAM_DEFENDER ? this.defenderRoster : this.attackerRoster;
    const usedMap = collectUsedUnitsMap(groupRows);
    return Object.values(roster)
      .map((row) => {
        const total = Math.max(0, Math.floor(Number(row?.count) || 0));
        const used = Math.max(0, Math.floor(Number(usedMap[row.unitTypeId]) || 0));
        return {
          unitTypeId: row.unitTypeId,
          unitName: row.unitName || row.unitTypeId,
          total,
          used,
          available: Math.max(0, total - used)
        };
      })
      .sort((a, b) => a.unitName.localeCompare(b.unitName, 'zh-Hans-CN'));
  }

  getAttackerRosterRows() {
    return this.getRosterRows(TEAM_ATTACKER);
  }

  getDefenderRosterRows() {
    return this.getRosterRows(TEAM_DEFENDER);
  }

  createDeployGroup(team = TEAM_ATTACKER, { units = {}, name = '', x, y, placed = false } = {}) {
    if (this.phase !== 'deploy') return { ok: false, reason: '仅部署阶段可新建部队' };
    const safeTeam = resolveTeamTag(team);
    const nextUnits = normalizeUnitsMap(units);
    if (sumUnitsMap(nextUnits) <= 0) return { ok: false, reason: '请至少配置一个兵种' };
    const targetGroups = safeTeam === TEAM_DEFENDER ? this.defenderDeployGroups : this.attackerDeployGroups;
    const usedMap = collectUsedUnitsMap(targetGroups);
    const rows = this.getRosterRows(safeTeam);
    for (const [unitTypeId, count] of Object.entries(nextUnits)) {
      const rosterRow = rows.find((row) => row.unitTypeId === unitTypeId);
      const total = Math.max(0, Math.floor(Number(rosterRow?.total) || 0));
      const used = Math.max(0, Math.floor(Number(usedMap[unitTypeId]) || 0));
      if (count > Math.max(0, total - used)) {
        const unitName = rosterRow?.unitName || unitTypeId;
        return { ok: false, reason: `${unitName} 可用不足` };
      }
    }

    const gridRows = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, targetGroups.length + 1))));
    const index = targetGroups.length;
    const row = index % gridRows;
    const layer = Math.floor(index / gridRows);
    const fallbackY = clamp(
      -this.field.height * 0.35 + ((row + 1) * (this.field.height * 0.7 / (gridRows + 1))),
      -this.field.height / 2 + 12,
      this.field.height / 2 - 12
    );
    const fallbackX = clampXToDeployZone(
      safeTeam === TEAM_DEFENDER ? (this.field.width / 2 - 72 - (layer * 56)) : (-this.field.width / 2 + 72 + (layer * 56)),
      this.field.width,
      10,
      safeTeam
    );
    const candidateTypeId = Object.keys(nextUnits)[0] || '';
    const candidateName = this.unitTypeMap.get(candidateTypeId)?.name || candidateTypeId || '部队';
    const groupName = (typeof name === 'string' && name.trim())
      ? name.trim()
      : `${candidateName}${targetGroups.length + 1}`;
    const safeX = clampXToDeployZone(
      Number.isFinite(Number(x)) ? Number(x) : fallbackX,
      this.field.width,
      10,
      safeTeam
    );
    const safeY = clamp(
      Number.isFinite(Number(y)) ? Number(y) : fallbackY,
      -this.field.height / 2 + 10,
      this.field.height / 2 - 10
    );
    const groupId = `${safeTeam === TEAM_DEFENDER ? 'def' : 'atk'}_custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const nextGroup = this.hydrateDeployGroupFormation({
      id: groupId,
      team: safeTeam,
      name: groupName,
      units: nextUnits,
      x: safeX,
      y: safeY,
      placed: placed !== false
    }, safeTeam);
    targetGroups.push(nextGroup);
    this.selectedDeploySquadId = groupId;
    this.focusSquadId = groupId;
    return { ok: true, groupId };
  }

  updateDeployGroup(team = TEAM_ATTACKER, groupId = '', { units = null, name = null } = {}) {
    if (this.phase !== 'deploy') return { ok: false, reason: '仅部署阶段可编辑部队' };
    const safeTeam = resolveTeamTag(team);
    const target = this.getDeployGroupById(groupId, safeTeam);
    if (!target) return { ok: false, reason: '未找到部队' };
    const groups = safeTeam === TEAM_DEFENDER ? this.defenderDeployGroups : this.attackerDeployGroups;
    const nextUnits = units ? normalizeUnitsMap(units) : normalizeUnitsMap(target.units || {});
    if (sumUnitsMap(nextUnits) <= 0) return { ok: false, reason: '请至少配置一个兵种' };
    const others = groups.filter((row) => row.id !== target.id);
    const usedMap = collectUsedUnitsMap(others);
    const rows = this.getRosterRows(safeTeam);
    for (const [unitTypeId, count] of Object.entries(nextUnits)) {
      const rosterRow = rows.find((row) => row.unitTypeId === unitTypeId);
      const total = Math.max(0, Math.floor(Number(rosterRow?.total) || 0));
      const used = Math.max(0, Math.floor(Number(usedMap[unitTypeId]) || 0));
      if (count > Math.max(0, total - used)) {
        const unitName = rosterRow?.unitName || unitTypeId;
        return { ok: false, reason: `${unitName} 可用不足` };
      }
    }
    target.units = nextUnits;
    if (typeof name === 'string' && name.trim()) target.name = name.trim();
    this.hydrateDeployGroupFormation(target, safeTeam);
    return { ok: true };
  }

  removeDeployGroup(team = TEAM_ATTACKER, groupId = '') {
    if (this.phase !== 'deploy') return { ok: false, reason: '仅部署阶段可解散部队' };
    const safeTeam = resolveTeamTag(team);
    const safeGroupId = typeof groupId === 'string' ? groupId.trim() : '';
    if (!safeGroupId) return { ok: false, reason: '缺少部队ID' };
    const listKey = safeTeam === TEAM_DEFENDER ? 'defenderDeployGroups' : 'attackerDeployGroups';
    const prevLen = this[listKey].length;
    this[listKey] = this[listKey].filter((row) => row.id !== safeGroupId);
    if (this[listKey].length === prevLen) return { ok: false, reason: '未找到部队' };
    const fallbackId = this.attackerDeployGroups[0]?.id || this.defenderDeployGroups[0]?.id || '';
    if (this.selectedDeploySquadId === safeGroupId) this.selectedDeploySquadId = fallbackId;
    if (this.focusSquadId === safeGroupId) this.focusSquadId = fallbackId;
    return { ok: true };
  }

  setDeployGroupPlaced(team = TEAM_ATTACKER, groupId = '', placed = true) {
    if (this.phase !== 'deploy') return false;
    const safeTeam = resolveTeamTag(team);
    const target = this.getDeployGroupById(groupId, safeTeam);
    if (!target) return false;
    target.placed = !!placed;
    return true;
  }

  createAttackerDeployGroup(options = {}) {
    return this.createDeployGroup(TEAM_ATTACKER, options);
  }

  createDefenderDeployGroup(options = {}) {
    return this.createDeployGroup(TEAM_DEFENDER, options);
  }

  updateAttackerDeployGroup(groupId = '', options = {}) {
    return this.updateDeployGroup(TEAM_ATTACKER, groupId, options);
  }

  updateDefenderDeployGroup(groupId = '', options = {}) {
    return this.updateDeployGroup(TEAM_DEFENDER, groupId, options);
  }

  removeAttackerDeployGroup(groupId = '') {
    return this.removeDeployGroup(TEAM_ATTACKER, groupId);
  }

  removeDefenderDeployGroup(groupId = '') {
    return this.removeDeployGroup(TEAM_DEFENDER, groupId);
  }

  setAttackerDeployGroupPlaced(groupId = '', placed = true) {
    return this.setDeployGroupPlaced(TEAM_ATTACKER, groupId, placed);
  }

  setDefenderDeployGroupPlaced(groupId = '', placed = true) {
    return this.setDeployGroupPlaced(TEAM_DEFENDER, groupId, placed);
  }

  moveDeployGroup(groupId, worldPoint, team = TEAM_ANY) {
    const targetId = String(groupId || this.selectedDeploySquadId || '');
    const group = this.getDeployGroupById(targetId, team);
    if (!group) return false;
    const safePoint = clampPointToField(worldPoint, this.field, 10);
    group.x = clampXToDeployZone(safePoint.x, this.field.width, 10, resolveTeamTag(group.team));
    group.y = safePoint.y;
    return true;
  }

  canDeployAt(worldPoint, team = TEAM_ATTACKER, radius = 10) {
    if (this.phase !== 'deploy') return false;
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    return isXInDeployZone(worldPoint?.x, this.field.width, radius, safeTeam);
  }

  pickDeployGroup(worldPoint, team = TEAM_ANY, radius = 26) {
    const safeTeam = typeof team === 'string' ? team.trim() : '';
    const targetGroups = safeTeam === TEAM_ATTACKER
      ? this.attackerDeployGroups
      : (safeTeam === TEAM_DEFENDER ? this.defenderDeployGroups : [...this.attackerDeployGroups, ...this.defenderDeployGroups]);
    const x = Number(worldPoint?.x) || 0;
    const y = Number(worldPoint?.y) || 0;
    let best = null;
    let bestDist = Infinity;
    targetGroups.forEach((group) => {
      if (!group) return;
      const dx = (Number(group.x) || 0) - x;
      const dy = (Number(group.y) || 0) - y;
      const dist = Math.hypot(dx, dy);
      const rect = group?.formationRect || {};
      const footprintRadius = Math.hypot(Number(rect.width) || 0, Number(rect.depth) || 0) * 0.5;
      const pickRadius = Math.max(radius, Math.max(12, footprintRadius * 0.6));
      if (dist <= pickRadius && dist < bestDist) {
        best = group;
        bestDist = dist;
      }
    });
    return best;
  }

  pickAttackerDeployGroup(worldPoint, radius = 26) {
    return this.pickDeployGroup(worldPoint, TEAM_ATTACKER, radius);
  }

  pickDefenderDeployGroup(worldPoint, radius = 26) {
    return this.pickDeployGroup(worldPoint, TEAM_DEFENDER, radius);
  }

  getItemCatalog() {
    return Array.isArray(this.itemCatalog) ? this.itemCatalog : [];
  }

  pickBuilding(worldPoint, radius = 24) {
    const x = Number(worldPoint?.x) || 0;
    const y = Number(worldPoint?.y) || 0;
    let best = null;
    let bestDist = Infinity;
    const source = this.phase === 'battle' || this.phase === 'ended'
      ? (Array.isArray(this.sim?.buildings) ? this.sim.buildings : this.initialBuildings)
      : this.initialBuildings;
    (Array.isArray(source) ? source : []).forEach((item) => {
      if (item?.destroyed) return;
      if (!item) return;
      const dx = (Number(item.x) || 0) - x;
      const dy = (Number(item.y) || 0) - y;
      const dist = Math.hypot(dx, dy);
      const hitRadius = Math.max(
        Number(radius) || 0,
        Math.max(8, (Math.max(Math.abs(Number(item.width) || 0), Math.abs(Number(item.depth) || 0)) * 0.55))
      );
      if (dist <= hitRadius && dist < bestDist) {
        best = item;
        bestDist = dist;
      }
    });
    return best;
  }

  placeBuilding({ itemId = '', x = 0, y = 0, z = 0, rotation = 0 } = {}) {
    if (this.phase !== 'deploy') return { ok: false, reason: '仅部署阶段可布置物品' };
    const safeItemId = typeof itemId === 'string' ? itemId.trim() : '';
    if (!safeItemId) return { ok: false, reason: '缺少物品ID' };
    const item = this.getItemCatalog().find((row) => row.itemId === safeItemId);
    if (!item) return { ok: false, reason: '物品不存在或不可用' };
    const radius = Math.max(4, Math.max(Number(item.width) || 0, Number(item.depth) || 0) * 0.5);
    const safePoint = clampPointToField({ x, y }, this.field, radius);
    const objectId = `obj_custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const obstacle = {
      id: objectId,
      itemId: safeItemId,
      x: safePoint.x,
      y: safePoint.y,
      z: Math.max(0, Number(z) || 0),
      rotation: Number(rotation) || 0,
      width: Math.max(8, Number(item.width) || 84),
      depth: Math.max(8, Number(item.depth) || 24),
      height: Math.max(6, Number(item.height) || 38),
      maxHp: Math.max(1, Number(item.hp) || 180),
      hp: Math.max(1, Number(item.hp) || 180),
      defense: Math.max(0.1, Number(item.defense) || 1.1),
      destroyed: false
    };
    this.initialBuildings.push(refreshObstacleGeometry(obstacle, item));
    return { ok: true, objectId };
  }

  moveBuilding(objectId = '', worldPoint = null) {
    if (this.phase !== 'deploy') return false;
    const safeId = typeof objectId === 'string' ? objectId.trim() : '';
    if (!safeId) return false;
    const target = (Array.isArray(this.initialBuildings) ? this.initialBuildings : []).find((row) => row?.id === safeId);
    if (!target) return false;
    const radius = Math.max(4, Math.max(Number(target.width) || 0, Number(target.depth) || 0) * 0.5);
    const safePoint = clampPointToField(worldPoint, this.field, radius);
    target.x = safePoint.x;
    target.y = safePoint.y;
    const item = this.getItemCatalog().find((row) => row.itemId === target.itemId) || target;
    refreshObstacleGeometry(target, item);
    return true;
  }

  rotateBuilding(objectId = '', deltaDeg = 0) {
    if (this.phase !== 'deploy') return false;
    const safeId = typeof objectId === 'string' ? objectId.trim() : '';
    if (!safeId) return false;
    const target = (Array.isArray(this.initialBuildings) ? this.initialBuildings : []).find((row) => row?.id === safeId);
    if (!target) return false;
    target.rotation = (Number(target.rotation) || 0) + (Number(deltaDeg) || 0);
    const item = this.getItemCatalog().find((row) => row.itemId === target.itemId) || target;
    refreshObstacleGeometry(target, item);
    return true;
  }

  removeBuilding(objectId = '') {
    if (this.phase !== 'deploy') return { ok: false, reason: '仅部署阶段可移除物品' };
    const safeId = typeof objectId === 'string' ? objectId.trim() : '';
    if (!safeId) return { ok: false, reason: '缺少物品ID' };
    const prevLen = this.initialBuildings.length;
    this.initialBuildings = this.initialBuildings.filter((row) => row?.id !== safeId);
    if (this.initialBuildings.length === prevLen) return { ok: false, reason: '未找到物品' };
    return { ok: true };
  }

  canStartBattle() {
    const attackerCount = this.attackerDeployGroups
      .filter((row) => row?.placed !== false)
      .reduce((sum, row) => sum + sumUnitsMap(row?.units || {}), 0);
    const defenderCount = this.defenderDeployGroups
      .filter((row) => row?.placed !== false)
      .reduce((sum, row) => sum + sumUnitsMap(row?.units || {}), 0);
    return attackerCount > 0 && defenderCount > 0;
  }

  startBattle() {
    if (!this.canStartBattle()) return { ok: false, reason: '双方至少需要一支部队' };
    const attackerSquads = this.attackerDeployGroups
      .filter((group) => group?.placed !== false)
      .map((group, index) => createSquad({
        group,
        index,
        team: TEAM_ATTACKER,
        unitTypeMap: this.unitTypeMap,
        unitsPerSoldier: this.unitsPerSoldier,
        fieldWidth: this.field.width,
        fieldHeight: this.field.height,
        allowCrossMidline: this.rules.allowCrossMidline
      }))
      .filter((row) => row.startCount > 0);

    const defenderSquads = this.defenderDeployGroups
      .filter((group) => group?.placed !== false)
      .map((group, index) => createSquad({
        group,
        index,
        team: TEAM_DEFENDER,
        unitTypeMap: this.unitTypeMap,
        unitsPerSoldier: this.unitsPerSoldier,
        fieldWidth: this.field.width,
        fieldHeight: this.field.height,
        allowCrossMidline: this.rules.allowCrossMidline
      }))
      .filter((row) => row.startCount > 0);

    const simBase = {
      battleId: this.initData?.battleId || '',
      nodeId: this.initData?.nodeId || '',
      gateKey: this.initData?.gateKey || '',
      nodeName: this.initData?.nodeName || '',
      startedAt: new Date().toISOString(),
      timeLimitSec: Math.max(30, Number(this.initData?.timeLimitSec) || DEFAULT_TIME_LIMIT),
      timerSec: Math.max(30, Number(this.initData?.timeLimitSec) || DEFAULT_TIME_LIMIT),
      field: this.field,
      squads: [...attackerSquads, ...defenderSquads],
      buildings: cloneObstacleList(this.initialBuildings),
      effects: [],
      projectiles: [],
      hitEffects: [],
      destroyedBuildings: 0,
      ended: false,
      endReason: ''
    };

    this.sim = withRepConfig(simBase, this.repConfig);
    this.crowd = createCrowdSim(this.sim, { unitTypeMap: this.unitTypeMap });
    this.sim.crowd = this.crowd;

    this.phase = 'battle';
    this.startedAtMs = Date.now();
    this.endedAtMs = 0;
    this.focusSquadId = this.sim.squads.find((row) => row.team === TEAM_ATTACKER && row.remain > 0)?.id || this.sim.squads[0]?.id || '';
    this.selectedBattleSquadId = this.focusSquadId;
    this.updateCameraAnchor(0);
    return { ok: true };
  }

  getSquadById(squadId) {
    return (this.sim?.squads || []).find((row) => row.id === squadId) || null;
  }

  setFocusSquad(squadId = '') {
    this.focusSquadId = String(squadId || '');
    if (this.phase === 'battle') {
      const squad = this.getSquadById(this.focusSquadId);
      if (squad && squad.team === TEAM_ATTACKER && squad.remain > 0) {
        this.selectedBattleSquadId = squad.id;
      }
    }
  }

  setSelectedBattleSquad(squadId = '') {
    const squad = this.getSquadById(squadId);
    if (!squad) return false;
    if (squad.team !== TEAM_ATTACKER || squad.remain <= 0) return false;
    this.selectedBattleSquadId = squad.id;
    this.focusSquadId = squad.id;
    return true;
  }

  markCommandIssued(inputType = '') {
    this.orderSeq += 1;
    this.lastInputEventType = String(inputType || 'command');
  }

  beginSquadTransition(squad, fromKey = 'move', toKey = 'attack') {
    if (!squad) return;
    const profile = squad.behaviorProfile && typeof squad.behaviorProfile === 'object'
      ? squad.behaviorProfile
      : DEFAULT_BEHAVIOR_PROFILE;
    const trans = profile.transitionSec && typeof profile.transitionSec === 'object'
      ? profile.transitionSec
      : DEFAULT_BEHAVIOR_PROFILE.transitionSec;
    const key = `${fromKey}To${toKey}`;
    const fallback = Number(trans.moveToAttack) || 0.3;
    const dur = Math.max(0.05, Number(trans[key]) || fallback);
    squad.actionState = {
      kind: 'transition',
      from: fromKey,
      to: toKey,
      ttl: dur,
      dur
    };
    if (squad.stability && typeof squad.stability === 'object') {
      squad.stability.transition = Math.max(0, Number(squad.stability.transitionMax) || 0);
    }
  }

  pickSquadAtPoint(worldX, worldY, options = {}) {
    if (this.phase !== 'battle' || !this.sim) return '';
    const team = options?.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const safeX = Number(worldX);
    const safeY = Number(worldY);
    if (!Number.isFinite(safeX) || !Number.isFinite(safeY)) return '';
    const maxDist = Math.max(6, Number(options?.maxDist) || 30);
    const maxDistSq = maxDist * maxDist;
    let bestId = '';
    let bestDistSq = Infinity;
    const squads = Array.isArray(this.sim?.squads) ? this.sim.squads : [];
    for (let i = 0; i < squads.length; i += 1) {
      const row = squads[i];
      if (!row || row.team !== team || (Number(row.remain) || 0) <= 0) continue;
      const dx = (Number(row.x) || 0) - safeX;
      const dy = (Number(row.y) || 0) - safeY;
      const pickRadius = Math.max(12, Number(row.radius) || 12);
      const limit = Math.max(maxDist, pickRadius);
      const d2 = (dx * dx) + (dy * dy);
      if (d2 > (limit * limit)) continue;
      if (d2 < bestDistSq && d2 <= maxDistSq * 9) {
        bestDistSq = d2;
        bestId = row.id;
      }
    }
    return bestId;
  }

  commandSpeedMode(squadIds, mode = SPEED_MODE_B, source = SPEED_AUTH_USER) {
    if (this.phase !== 'battle' || !this.sim) return false;
    const sourceTag = source === SPEED_AUTH_AI ? SPEED_AUTH_AI : SPEED_AUTH_USER;
    const targetMode = mode === SPEED_MODE_C
      ? SPEED_MODE_C
      : (mode === SPEED_MODE_AUTO ? SPEED_MODE_AUTO : SPEED_MODE_B);
    const ids = Array.isArray(squadIds) ? squadIds : [squadIds];
    let changed = false;
    ids.forEach((id) => {
      const squad = this.getSquadById(id);
      if (!squad || squad.remain <= 0) return;
      if (sourceTag === SPEED_AUTH_AI && squad.speedModeAuthority === SPEED_AUTH_USER) return;
      if (targetMode === SPEED_MODE_AUTO) {
        const prevPolicy = typeof squad.speedPolicy === 'string' ? squad.speedPolicy : SPEED_POLICY_MARCH;
        squad.speedModeAuthority = SPEED_AUTH_AI;
        const nextMode = squad.behavior === 'retreat' ? SPEED_MODE_C : SPEED_MODE_B;
        squad.speedMode = nextMode;
        if (nextMode === SPEED_MODE_C) {
          squad.speedPolicy = SPEED_POLICY_RETREAT;
          squad.reformUntil = 0;
        } else if (prevPolicy === SPEED_POLICY_RETREAT || prevPolicy === SPEED_POLICY_REFORM) {
          squad.speedPolicy = SPEED_POLICY_REFORM;
          squad.reformUntil = 6;
        } else {
          squad.speedPolicy = SPEED_POLICY_MARCH;
          squad.reformUntil = 0;
        }
        changed = true;
        return;
      }
      squad.speedMode = targetMode;
      squad.speedModeAuthority = sourceTag;
      if (targetMode === SPEED_MODE_C) {
        squad.speedPolicy = SPEED_POLICY_RETREAT;
        squad.reformUntil = 0;
      } else if (squad.speedPolicy === SPEED_POLICY_RETREAT || squad.speedPolicy === SPEED_POLICY_REFORM) {
        squad.speedPolicy = SPEED_POLICY_REFORM;
        squad.reformUntil = 6;
      } else {
        squad.speedPolicy = SPEED_POLICY_MARCH;
        squad.reformUntil = 0;
      }
      changed = true;
    });
    if (changed) this.markCommandIssued('speed_mode');
    return changed;
  }

  applyOrderToSquad(squad, orderType, safePoint) {
    if (!squad) return;
    const prevOrder = typeof squad?.order?.type === 'string' ? squad.order.type : ORDER_IDLE;
    squad.guard = { enabled: false, cx: Number(squad.x) || 0, cy: Number(squad.y) || 0, radius: 0, returnRadius: 0, chaseRadius: 0, activeTargetId: '' };
    const now = Math.max(0, Number(this.sim?.timeElapsed) || 0);
    const kind = orderType === ORDER_ATTACK_MOVE
      ? ORDER_ATTACK_MOVE
      : (orderType === ORDER_CHARGE ? ORDER_CHARGE : ORDER_MOVE);
    squad.order = {
      type: kind,
      issuedAt: now,
      commitUntil: kind === ORDER_CHARGE ? now + 1.35 : 0,
      targetPoint: safePoint ? { x: safePoint.x, y: safePoint.y } : null,
      targetSquadId: ''
    };
    if (kind === ORDER_CHARGE) {
      this.beginSquadTransition(squad, prevOrder === ORDER_MOVE ? 'move' : 'attack', 'charge');
      squad.behavior = 'move';
      squad.action = '冲锋';
      squad.speedPolicy = SPEED_POLICY_RETREAT;
      if (squad.speedModeAuthority !== SPEED_AUTH_USER) {
        this.commandSpeedMode(squad.id, SPEED_MODE_C, SPEED_AUTH_AI);
      }
      return;
    }
    if (kind === ORDER_ATTACK_MOVE) {
      this.beginSquadTransition(squad, prevOrder === ORDER_MOVE ? 'move' : 'idle', 'attack');
      squad.behavior = 'move';
      squad.action = '攻击前进';
      if (squad.speedMode === SPEED_MODE_C && squad.speedModeAuthority !== SPEED_AUTH_USER) {
        this.commandSpeedMode(squad.id, SPEED_MODE_B, SPEED_AUTH_AI);
      }
      return;
    }
    this.beginSquadTransition(squad, prevOrder === ORDER_ATTACK_MOVE ? 'attack' : 'idle', 'move');
    squad.behavior = 'move';
    squad.action = '移动';
  }

  resolveTeamZoneBounds(team, radius = 0) {
    const r = Math.max(0, Number(radius) || 0);
    const half = this.field.width / 2;
    const minX = -half + r;
    const maxX = half - r;
    const attackerMax = Math.min(maxX, -TEAM_ZONE_GUTTER - r);
    const defenderMin = Math.max(minX, TEAM_ZONE_GUTTER + r);
    if (team === TEAM_DEFENDER) {
      return { minX: defenderMin, maxX };
    }
    return { minX, maxX: attackerMax };
  }

  resolveRawFocusAnchor() {
    if (!this.sim || !this.crowd) return { x: 0, y: 0, vx: 0, vy: 0, squadId: '', team: '' };
    const preferredId = this.focusSquadId || this.selectedBattleSquadId;
    const preferred = preferredId ? this.getSquadById(preferredId) : null;
    const fallback = preferred || (this.sim.squads || []).find((row) => row && row.remain > 0) || null;
    if (!fallback) return { x: 0, y: 0, vx: 0, vy: 0, squadId: '', team: '' };
    return {
      x: Number(fallback.x) || 0,
      y: Number(fallback.y) || 0,
      vx: Number(fallback.vx) || 0,
      vy: Number(fallback.vy) || 0,
      squadId: fallback.id,
      team: fallback.team
    };
  }

  updateCameraAnchor(dtSec = 0.016) {
    const raw = this.resolveRawFocusAnchor();
    this.cameraAnchorRaw = { ...raw };
    if (!this.cameraAnchor.squadId || this.cameraAnchor.squadId !== raw.squadId) {
      this.cameraAnchor = { ...raw };
      return;
    }
    const dx = raw.x - (Number(this.cameraAnchor.x) || 0);
    const dy = raw.y - (Number(this.cameraAnchor.y) || 0);
    const dist = Math.hypot(dx, dy);
    if (dist <= CAMERA_DEAD_ZONE * 0.35) return;
    this.cameraAnchor = { ...raw };
  }

  applyAutoSpeedModes() {
    if (!this.sim || this.phase !== 'battle') return;
    (this.sim.squads || []).forEach((squad) => {
      if (!squad || squad.remain <= 0) return;
      if (squad.behavior === 'retreat') {
        this.commandSpeedMode(squad.id, SPEED_MODE_C, SPEED_AUTH_AI);
        return;
      }
      const underPressure = (Number(squad.underAttackTimer) || 0) > 0.8 && (Number(squad.morale) || 0) < 20;
      if (underPressure) {
        this.commandSpeedMode(squad.id, SPEED_MODE_C, SPEED_AUTH_AI);
        return;
      }
      if (squad.speedMode === SPEED_MODE_C && (Number(squad.morale) || 0) > 24 && squad.behavior !== 'retreat') {
        this.commandSpeedMode(squad.id, SPEED_MODE_B, SPEED_AUTH_AI);
      }
    });
  }

  commandMove(squadId, worldPoint, options = {}) {
    if (this.phase !== 'battle' || !this.sim) return false;
    const squad = this.getSquadById(squadId);
    if (!squad || squad.team !== TEAM_ATTACKER || squad.remain <= 0) return false;
    const append = !!options?.append;
    const orderType = typeof options?.orderType === 'string' ? options.orderType : ORDER_MOVE;
    const safe = clampPointToField(worldPoint, this.field, Math.max(6, Number(squad.radius) || 10));
    if (!this.rules.allowCrossMidline) {
      safe.x = clampXToTeamZone(safe.x, this.field.width, Math.max(6, Number(squad.radius) || 10), squad.team);
    }
    if (append) {
      squad.waypoints.push(safe);
    } else {
      squad.waypoints = [safe];
    }
    squad.lastMoveMarker = { x: safe.x, y: safe.y, ttl: 1.2 };
    squad.guard = { enabled: false, cx: Number(squad.x) || 0, cy: Number(squad.y) || 0, radius: 0, returnRadius: 0, chaseRadius: 0, activeTargetId: '' };
    this.applyOrderToSquad(squad, orderType, safe);
    this.markCommandIssued(options?.inputType || 'move');
    return true;
  }

  commandAttackMove(squadId, worldPoint) {
    return this.commandMove(squadId, worldPoint, { append: false, orderType: ORDER_ATTACK_MOVE });
  }

  commandCharge(squadId, worldPoint) {
    return this.commandMove(squadId, worldPoint, { append: false, orderType: ORDER_CHARGE });
  }

  commandBehavior(squadId, behavior = 'idle') {
    if (this.phase !== 'battle' || !this.sim) return false;
    const squad = this.getSquadById(squadId);
    if (!squad || squad.team !== TEAM_ATTACKER || squad.remain <= 0) return false;
    if (behavior === 'standby') {
      this.beginSquadTransition(squad, 'move', 'standby');
      squad.behavior = 'standby';
      squad.waypoints = [];
      squad.guard = { enabled: false, cx: Number(squad.x) || 0, cy: Number(squad.y) || 0, radius: 0, returnRadius: 0, chaseRadius: 0, activeTargetId: '' };
      squad.action = '待命';
      squad.order = { type: ORDER_IDLE, issuedAt: Math.max(0, Number(this.sim?.timeElapsed) || 0), commitUntil: 0, targetPoint: null, targetSquadId: '' };
      this.markCommandIssued('behavior_standby');
      return true;
    }
    if (behavior === 'idle') {
      this.beginSquadTransition(squad, 'move', 'idle');
      squad.behavior = 'idle';
      squad.waypoints = [];
      squad.guard = { enabled: false, cx: Number(squad.x) || 0, cy: Number(squad.y) || 0, radius: 0, returnRadius: 0, chaseRadius: 0, activeTargetId: '' };
      squad.action = '待命';
      squad.order = { type: ORDER_IDLE, issuedAt: Math.max(0, Number(this.sim?.timeElapsed) || 0), commitUntil: 0, targetPoint: null, targetSquadId: '' };
      this.markCommandIssued('behavior_idle');
      return true;
    }
    if (behavior === 'auto') {
      this.beginSquadTransition(squad, 'idle', 'attack');
      squad.behavior = 'auto';
      squad.guard = { enabled: false, cx: Number(squad.x) || 0, cy: Number(squad.y) || 0, radius: 0, returnRadius: 0, chaseRadius: 0, activeTargetId: '' };
      squad.action = '自动攻击';
      squad.order = { type: ORDER_ATTACK_MOVE, issuedAt: Math.max(0, Number(this.sim?.timeElapsed) || 0), commitUntil: 0, targetPoint: null, targetSquadId: '' };
      this.markCommandIssued('behavior_auto');
      return true;
    }
    if (behavior === 'defend') {
      this.beginSquadTransition(squad, 'idle', 'defend');
      squad.behavior = 'defend';
      squad.waypoints = [];
      squad.guard = { enabled: false, cx: Number(squad.x) || 0, cy: Number(squad.y) || 0, radius: 0, returnRadius: 0, chaseRadius: 0, activeTargetId: '' };
      squad.action = '防御';
      squad.order = { type: ORDER_ATTACK_MOVE, issuedAt: Math.max(0, Number(this.sim?.timeElapsed) || 0), commitUntil: 0, targetPoint: null, targetSquadId: '' };
      this.markCommandIssued('behavior_defend');
      return true;
    }
    if (behavior === 'retreat') {
      this.beginSquadTransition(squad, 'forward', 'retreat');
      squad.behavior = 'retreat';
      squad.waypoints = [squad.rallyPoint];
      squad.guard = { enabled: false, cx: Number(squad.x) || 0, cy: Number(squad.y) || 0, radius: 0, returnRadius: 0, chaseRadius: 0, activeTargetId: '' };
      squad.action = '撤退';
      squad.order = { type: ORDER_MOVE, issuedAt: Math.max(0, Number(this.sim?.timeElapsed) || 0), commitUntil: 0, targetPoint: squad.rallyPoint ? { ...squad.rallyPoint } : null, targetSquadId: '' };
      if (squad.speedModeAuthority !== SPEED_AUTH_USER) {
        this.commandSpeedMode(squad.id, SPEED_MODE_C, SPEED_AUTH_AI);
      } else {
        squad.speedPolicy = SPEED_POLICY_RETREAT;
      }
      this.markCommandIssued('behavior_retreat');
      return true;
    }
    return false;
  }

  commandSetWaypoints(squadId, points = [], options = {}) {
    if (this.phase !== 'battle' || !this.sim) return false;
    const squad = this.getSquadById(squadId);
    if (!squad || squad.team !== TEAM_ATTACKER || squad.remain <= 0) return false;
    const source = Array.isArray(points) ? points : [];
    const radius = Math.max(6, Number(squad.radius) || 10);
    const next = [];
    for (let i = 0; i < source.length; i += 1) {
      const p = source[i];
      const safe = clampPointToField(p, this.field, radius);
      if (!this.rules.allowCrossMidline) {
        safe.x = clampXToTeamZone(safe.x, this.field.width, radius, squad.team);
      }
      next.push({ x: safe.x, y: safe.y });
    }
    squad.waypoints = next;
    squad.guard = { enabled: false, cx: Number(squad.x) || 0, cy: Number(squad.y) || 0, radius: 0, returnRadius: 0, chaseRadius: 0, activeTargetId: '' };
    if (next.length > 0) {
      const tail = next[next.length - 1];
      squad.lastMoveMarker = { x: tail.x, y: tail.y, ttl: 1.2 };
      this.applyOrderToSquad(squad, ORDER_MOVE, tail);
    } else {
      squad.behavior = 'idle';
      squad.action = '待命';
      squad.order = { type: ORDER_IDLE, issuedAt: Math.max(0, Number(this.sim?.timeElapsed) || 0), commitUntil: 0, targetPoint: null, targetSquadId: '' };
    }
    this.markCommandIssued(options?.inputType || 'set_waypoints');
    return true;
  }

  commandGuard(squadId, guardSpec = {}) {
    if (this.phase !== 'battle' || !this.sim) return false;
    const squad = this.getSquadById(squadId);
    if (!squad || squad.team !== TEAM_ATTACKER || squad.remain <= 0) return false;
    const cx = Number.isFinite(Number(guardSpec?.centerX)) ? Number(guardSpec.centerX) : (Number(squad.x) || 0);
    const cy = Number.isFinite(Number(guardSpec?.centerY)) ? Number(guardSpec.centerY) : (Number(squad.y) || 0);
    const radius = Math.max(12, Number(guardSpec?.radius) || Math.max(42, Number(squad.radius) || 24));
    squad.guard = {
      enabled: true,
      cx,
      cy,
      radius,
      returnRadius: Math.max(8, radius * 0.36),
      chaseRadius: Math.max(radius * 1.45, radius + 24),
      activeTargetId: ''
    };
    squad.behavior = 'guard';
    squad.waypoints = [];
    squad.action = '自由攻击';
    squad.order = { type: ORDER_ATTACK_MOVE, issuedAt: Math.max(0, Number(this.sim?.timeElapsed) || 0), commitUntil: 0, targetPoint: { x: cx, y: cy }, targetSquadId: '' };
    this.markCommandIssued('guard');
    return true;
  }

  commandMarchMode(squadId, mode = MARCH_MODE_COHESIVE) {
    if (this.phase !== 'battle' || !this.sim) return false;
    const squad = this.getSquadById(squadId);
    if (!squad || squad.team !== TEAM_ATTACKER || squad.remain <= 0) return false;
    if (mode === MARCH_MODE_LOOSE) {
      squad.speedMode = SPEED_MODE_C;
      squad.speedModeAuthority = SPEED_AUTH_USER;
      squad.speedPolicy = SPEED_POLICY_RETREAT;
      squad.marchMode = MARCH_MODE_LOOSE;
    } else {
      squad.speedMode = SPEED_MODE_B;
      squad.speedModeAuthority = SPEED_AUTH_USER;
      squad.speedPolicy = SPEED_POLICY_MARCH;
      squad.marchMode = MARCH_MODE_COHESIVE;
    }
    this.markCommandIssued('march_mode');
    return true;
  }

  commandSkill(squadId, targetSpec) {
    if (this.phase !== 'battle' || !this.sim || !this.crowd) return { ok: false, reason: '战斗未开始' };
    const result = triggerCrowdSkill(this.sim, this.crowd, squadId, targetSpec);
    if (result?.ok) {
      this.markCommandIssued('skill');
    }
    return result;
  }

  getSkillMetaForSquad(squadId = '') {
    const squad = this.getSquadById(squadId);
    return buildSkillMetaFromSquad(squad, this.unitTypeMap);
  }

  step(dtSec) {
    if (this.phase !== 'battle' || !this.sim || this.sim.ended) return;
    const dt = clamp(Number(dtSec) || 0, 0.001, 0.05);
    const t0 = performance.now();
    this.sim.timerSec = Math.max(0, Number(this.sim.timerSec) - dt);
    updateCrowdSim(this.crowd, this.sim, dt);
    this.applyAutoSpeedModes();

    const allowCrossMidline = !!this.rules.allowCrossMidline;
    let clampRecord = {
      squadId: '',
      preClampX: 0,
      postClampX: 0,
      team: '',
      radius: 0,
      allowedMinX: 0,
      allowedMaxX: 0,
      changed: false
    };
    (this.sim.squads || []).forEach((squad) => {
      if (!squad) return;
      const radius = Math.max(2, Number(squad.radius) || 2);
      const preX = Number(squad.x) || 0;
      const safePoint = clampPointToField({ x: preX, y: squad.y }, this.field, radius);
      const bounds = allowCrossMidline
        ? { minX: -this.field.width / 2 + radius, maxX: this.field.width / 2 - radius }
        : this.resolveTeamZoneBounds(squad.team, radius);
      const nextX = allowCrossMidline
        ? clamp(safePoint.x, bounds.minX, bounds.maxX)
        : clampXToTeamZone(safePoint.x, this.field.width, radius, squad.team);
      squad.x = nextX;
      squad.y = safePoint.y;
      if (!clampRecord.squadId && squad.id === (this.focusSquadId || this.selectedBattleSquadId)) {
        clampRecord = {
          squadId: squad.id,
          preClampX: preX,
          postClampX: nextX,
          team: squad.team,
          radius,
          allowedMinX: bounds.minX,
          allowedMaxX: bounds.maxX,
          changed: Math.abs(preX - nextX) > 1e-4
        };
      }
      if (Array.isArray(squad.waypoints) && squad.waypoints.length > 0) {
        squad.waypoints.forEach((point) => {
          if (!point) return;
          const safeWp = clampPointToField(point, this.field, radius);
          point.x = allowCrossMidline
            ? clamp(safeWp.x, -this.field.width / 2 + radius, this.field.width / 2 - radius)
            : clampXToTeamZone(safeWp.x, this.field.width, radius, squad.team);
          point.y = safeWp.y;
        });
      }
      if (squad.rallyPoint) {
        const safeRally = clampPointToField(squad.rallyPoint, this.field, radius);
        squad.rallyPoint.x = allowCrossMidline
          ? clamp(safeRally.x, -this.field.width / 2 + radius, this.field.width / 2 - radius)
          : clampXToTeamZone(safeRally.x, this.field.width, radius, squad.team);
        squad.rallyPoint.y = safeRally.y;
      }
    });
    (this.crowd?.allAgents || []).forEach((agent) => {
      if (!agent || agent.dead) return;
      const radius = Math.max(1, Number(agent.radius) || 1);
      const safePos = clampPointToField(agent, this.field, radius);
      agent.x = allowCrossMidline
        ? clamp(safePos.x, -this.field.width / 2 + radius, this.field.width / 2 - radius)
        : clampXToTeamZone(safePos.x, this.field.width, radius, agent.team);
      agent.y = safePos.y;
      if (agent.goal) {
        const safeGoal = clampPointToField(agent.goal, this.field, radius);
        agent.goal.x = allowCrossMidline
          ? clamp(safeGoal.x, -this.field.width / 2 + radius, this.field.width / 2 - radius)
          : clampXToTeamZone(safeGoal.x, this.field.width, radius, agent.team);
        agent.goal.y = safeGoal.y;
      }
    });

    (this.sim.squads || []).forEach((squad) => {
      if (!squad || squad.remain <= 0) return;
      if (squad.lastMoveMarker && Number(squad.lastMoveMarker.ttl) > 0) {
        squad.lastMoveMarker.ttl = Math.max(0, (Number(squad.lastMoveMarker.ttl) || 0) - dt);
      }
      const inCombat = (Number(squad.underAttackTimer) || 0) > 0 || (Number(squad.attackCooldown) || 0) > 0;
      const decay = inCombat ? 0.34 : 0.9;
      squad.morale = clamp((Number(squad.morale) || 0) - (decay * dt), 0, MORALE_MAX);
      squad.stamina = clamp((Number(squad.stamina) || 0) + (inCombat ? 3.2 : 5.4) * dt, 0, STAMINA_MAX);
      if ((Number(squad.morale) || 0) <= 0 && squad.behavior !== 'retreat') {
        if (squad.team === TEAM_ATTACKER) {
          this.commandBehavior(squad.id, 'retreat');
        } else {
          squad.behavior = 'retreat';
          squad.action = '撤退';
          squad.waypoints = [squad.rallyPoint];
          this.beginSquadTransition(squad, 'forward', 'retreat');
        }
      }
    });

    const attackerAlive = (this.sim.squads || [])
      .filter((row) => row.team === TEAM_ATTACKER)
      .reduce((sum, row) => sum + Math.max(0, Number(row.remain) || 0), 0);
    const defenderAlive = (this.sim.squads || [])
      .filter((row) => row.team === TEAM_DEFENDER)
      .reduce((sum, row) => sum + Math.max(0, Number(row.remain) || 0), 0);

    if (this.sim.timerSec <= 0 || attackerAlive <= 0 || defenderAlive <= 0) {
      this.sim.ended = true;
      this.sim.endReason = this.sim.timerSec <= 0
        ? '时间到'
        : (attackerAlive <= 0 ? '我方全灭' : '守军全灭');
      this.phase = 'ended';
      this.endedAtMs = Date.now();
    }

    this._lastMidlineClamp = clampRecord;
    this.debugStats.allowCrossMidline = allowCrossMidline;
    this.updateCameraAnchor(dt);
    if (this._debugTrackOrder) {
      const squads = Array.isArray(this.sim?.squads) ? this.sim.squads : [];
      for (let i = 0; i < squads.length; i += 1) {
        const squad = squads[i];
        if (!squad) continue;
        const nextHash = hashWaypoints(squad.waypoints);
        const prevHash = this._waypointHashBySquad.get(squad.id) || '';
        if (nextHash !== prevHash && this.orderSeq === this._lastOrderSeqSnapshot) {
          console.warn('[battle-order-guard] waypoints changed without command seq', {
            squadId: squad.id,
            prevHash,
            nextHash,
            orderSeq: this.orderSeq,
            inputType: this.lastInputEventType || ''
          });
        }
        this._waypointHashBySquad.set(squad.id, nextHash);
      }
      this._lastOrderSeqSnapshot = this.orderSeq;
    }
    this.debugStats.simStepMs = performance.now() - t0;
  }

  isEnded() {
    return !!this.sim?.ended;
  }

  getBattleStatus() {
    return {
      phase: this.phase,
      timerSec: Math.max(0, Number(this.sim?.timerSec) || 0),
      timeLimitSec: Math.max(0, Number(this.sim?.timeLimitSec) || 0),
      ended: !!this.sim?.ended,
      endReason: this.sim?.endReason || ''
    };
  }

  getSummary() {
    if (!this.sim) return null;
    const summary = buildBattleSummary(this.sim);
    summary.startedAt = this.sim.startedAt;
    summary.endedAt = new Date().toISOString();
    summary.endReason = this.sim.endReason || '';
    return summary;
  }

  getCardRows() {
    const hideDefenderIntelInDeploy = !this.intelVisible && this.phase === 'deploy';
    const squads = this.phase === 'battle' || this.phase === 'ended'
      ? (this.sim?.squads || [])
      : [
        ...this.attackerDeployGroups.map((group, index) => ({
          id: group.id,
          name: group.name,
          team: TEAM_ATTACKER,
          classTag: inferClassFromUnitType(this.unitTypeMap.get(Object.keys(group.units)[0]) || {}),
          remain: sumUnitsMap(group.units),
          startCount: sumUnitsMap(group.units),
          action: group?.placed === false ? '待放置' : '部署中',
          stamina: 100,
          morale: 100,
          placed: group?.placed !== false
        })),
        ...(!hideDefenderIntelInDeploy ? this.defenderDeployGroups.map((group, index) => ({
          id: group.id,
          name: group.name,
          team: TEAM_DEFENDER,
          classTag: inferClassFromUnitType(this.unitTypeMap.get(Object.keys(group.units)[0]) || {}),
          remain: sumUnitsMap(group.units),
          startCount: sumUnitsMap(group.units),
          action: group?.placed === false ? '待放置' : '部署中',
          stamina: 100,
          morale: 100,
          placed: group?.placed !== false
        })) : [])
      ];

    return squads.map((squad) => ({
      id: squad.id,
      team: squad.team,
      name: squad.name,
      classTag: squad.classTag,
      action: squad.action,
      remain: Math.max(0, Math.floor(Number(squad.remain) || 0)),
      startCount: Math.max(0, Math.floor(Number(squad.startCount) || 0)),
      morale: clamp(Number(squad.morale) || 0, 0, 100),
      stamina: clamp(Number(squad.stamina) || 0, 0, 100),
      speedMode: squad.speedMode || SPEED_MODE_B,
      speedModeAuthority: squad.speedModeAuthority || SPEED_AUTH_AI,
      speedPolicy: squad.speedPolicy || SPEED_POLICY_MARCH,
      marchMode: squad.marchMode || MARCH_MODE_COHESIVE,
      behavior: squad.behavior || 'idle',
      debugTargetScore: squad.debugTargetScore || null,
      orderType: squad.order?.type || ORDER_IDLE,
      actionState: squad.actionState || { kind: 'none', ttl: 0, dur: 0 },
      stability: squad.stability || null,
      skills: this.phase === 'battle' ? buildSkillMetaFromSquad(squad, this.unitTypeMap).skills : [],
      placed: squad?.placed !== false,
      selected: this.phase === 'battle'
        ? squad.id === this.selectedBattleSquadId
        : squad.id === this.selectedDeploySquadId,
      focus: squad.id === this.focusSquadId,
      alive: (Number(squad.remain) || 0) > 0
    }));
  }

  getFocusAnchor() {
    if (this.phase === 'deploy') {
      const targetId = this.selectedDeploySquadId || this.focusSquadId;
      const group = this.getDeployGroupById(targetId, TEAM_ANY)
        || this.attackerDeployGroups[0]
        || this.defenderDeployGroups[0]
        || { x: 0, y: 0, id: '' };
      return { x: Number(group.x) || 0, y: Number(group.y) || 0, vx: 0, vy: 0, squadId: group.id || '' };
    }
    if (!this.sim || !this.crowd) return { x: 0, y: 0, vx: 0, vy: 0, squadId: '' };
    return {
      x: Number(this.cameraAnchor?.x) || 0,
      y: Number(this.cameraAnchor?.y) || 0,
      vx: Number(this.cameraAnchor?.vx) || 0,
      vy: Number(this.cameraAnchor?.vy) || 0,
      squadId: String(this.cameraAnchor?.squadId || ''),
      team: this.cameraAnchor?.team || ''
    };
  }

  getRenderSnapshot() {
    const snapshot = this._snapshotPool.acquire();
    this.snapshotState = this._snapshotBuilder.build(this, snapshot);
    return this.snapshotState;
  }

  getMinimapSnapshot() {
    const hideDefenderIntelInDeploy = !this.intelVisible && this.phase === 'deploy';
    const hiddenSquadIdSet = new Set(
      (this.sim?.squads || [])
        .filter((row) => row?.team === TEAM_DEFENDER && row?.hiddenFromAttacker)
        .map((row) => row.id)
    );
    const squads = this.phase === 'battle' || this.phase === 'ended'
      ? (this.sim?.squads || []).map((row) => ({
        id: row.id,
        x: Number(row.x) || 0,
        y: Number(row.y) || 0,
        team: row.team,
        remain: Number(row.remain) || 0,
        selected: row.id === this.focusSquadId
      })).filter((row) => !(row.team === TEAM_DEFENDER && hiddenSquadIdSet.has(row.id)))
      : [
        ...this.attackerDeployGroups.map((row) => ({ id: row.id, x: row.x, y: row.y, team: TEAM_ATTACKER, remain: sumUnitsMap(row.units), selected: row.id === this.selectedDeploySquadId })),
        ...(!hideDefenderIntelInDeploy
          ? this.defenderDeployGroups.map((row) => ({ id: row.id, x: row.x, y: row.y, team: TEAM_DEFENDER, remain: sumUnitsMap(row.units), selected: row.id === this.selectedDeploySquadId }))
          : [])
      ];

    return {
      field: this.field,
      deployRange: this.getDeployRange(),
      buildings: hideDefenderIntelInDeploy ? [] : (this.sim?.buildings || this.initialBuildings),
      squads,
      visibilityMask: {
        hiddenDefenderSquadIds: Array.from(hiddenSquadIdSet)
      }
    };
  }

  getDebugStats() {
    const unitModelCount = Math.max(0, Math.floor(Number(this.snapshotState?.units?.count) || 0));
    const anchorDx = (Number(this.cameraAnchorRaw?.x) || 0) - (Number(this.cameraAnchor?.x) || 0);
    const anchorDy = (Number(this.cameraAnchorRaw?.y) || 0) - (Number(this.cameraAnchor?.y) || 0);
    const steeringWeights = this.sim?.steeringWeights && typeof this.sim.steeringWeights === 'object'
      ? this.sim.steeringWeights
      : null;
    return {
      ...this.debugStats,
      unitModelCount,
      agentCount: unitModelCount,
      projectileCount: Math.max(0, Math.floor(Number(this.snapshotState?.projectiles?.count) || 0)),
      buildingCount: Math.max(0, Math.floor(Number(this.snapshotState?.buildings?.count) || 0)),
      allowCrossMidline: !!this.rules.allowCrossMidline,
      cameraAnchorRawX: Number(this.cameraAnchorRaw?.x) || 0,
      cameraAnchorRawY: Number(this.cameraAnchorRaw?.y) || 0,
      cameraAnchorSmoothX: Number(this.cameraAnchor?.x) || 0,
      cameraAnchorSmoothY: Number(this.cameraAnchor?.y) || 0,
      cameraAnchorDelta: Math.hypot(anchorDx, anchorDy),
      clampSquadId: this._lastMidlineClamp?.squadId || '',
      clampPreX: Number(this._lastMidlineClamp?.preClampX) || 0,
      clampPostX: Number(this._lastMidlineClamp?.postClampX) || 0,
      clampChanged: !!this._lastMidlineClamp?.changed,
      clampRadius: Number(this._lastMidlineClamp?.radius) || 0,
      clampAllowedMinX: Number(this._lastMidlineClamp?.allowedMinX) || 0,
      clampAllowedMaxX: Number(this._lastMidlineClamp?.allowedMaxX) || 0,
      steeringWeights
    };
  }

  setRenderMs(ms) {
    this.debugStats.renderMs = Number(ms) || 0;
  }

  setFps(fps) {
    this.debugStats.fps = Number(fps) || 0;
  }
}
