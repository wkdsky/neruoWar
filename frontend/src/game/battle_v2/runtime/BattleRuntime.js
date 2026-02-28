import {
  createCrowdSim,
  updateCrowdSim,
  triggerCrowdSkill
} from '../../battle/crowd/CrowdSim';
import { buildBattleSummary } from './BattleSummary';
import {
  buildRepConfig,
  normalizeUnitsMap,
  sumUnitsMap,
  withRepConfig
} from './RepMapping';
import {
  resolveFallbackAnchor,
  resolveSquadAnchor
} from './FlagBearer';
import { UNIT_INSTANCE_STRIDE } from '../render/ImpostorRenderer';
import { BUILDING_INSTANCE_STRIDE } from '../render/BuildingRenderer';
import { PROJECTILE_INSTANCE_STRIDE } from '../render/ProjectileRenderer';
import { EFFECT_INSTANCE_STRIDE } from '../render/EffectRenderer';

const DEFAULT_FIELD_WIDTH = 900;
const DEFAULT_FIELD_HEIGHT = 620;
const DEFAULT_TIME_LIMIT = 240;
const DEFAULT_UNITS_PER_SOLDIER = 10;
const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const MORALE_MAX = 100;
const STAMINA_MAX = 100;
const TEAM_ZONE_GUTTER = 10;
const DEPLOY_ZONE_RATIO = 0.2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clampToRange = (value, min, max) => {
  const safeMin = Number(min) || 0;
  const safeMax = Number(max) || 0;
  if (safeMin <= safeMax) return clamp(Number(value) || 0, safeMin, safeMax);
  return (safeMin + safeMax) * 0.5;
};
const degToRad = (deg) => (Number(deg) || 0) * (Math.PI / 180);

const buildUnitTypeMap = (unitTypes = []) => {
  const map = new Map();
  (Array.isArray(unitTypes) ? unitTypes : []).forEach((item) => {
    const unitTypeId = typeof item?.unitTypeId === 'string' ? item.unitTypeId.trim() : '';
    if (!unitTypeId) return;
    map.set(unitTypeId, {
      ...item,
      unitTypeId,
      speed: Math.max(0.2, Number(item?.speed) || 1),
      hp: Math.max(1, Number(item?.hp) || 10),
      atk: Math.max(0.1, Number(item?.atk) || 1),
      def: Math.max(0, Number(item?.def) || 0),
      range: Math.max(1, Number(item?.range) || 1),
      roleTag: item?.roleTag === '远程' ? '远程' : '近战'
    });
  });
  return map;
};

const inferClassFromUnitType = (unitType = {}) => {
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
      range: 1
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
  return {
    classTag: inferClassFromUnitType(mainType),
    roleTag: mainType?.roleTag || (avgRange > 1.8 ? '远程' : '近战'),
    speed: totalSpeed / Math.max(1, total),
    hpAvg: totalHp / Math.max(1, total),
    atk: totalAtk / Math.max(1, total),
    def: totalDef / Math.max(1, total),
    range: avgRange
  };
};

const buildObstacleList = (battlefield = {}) => {
  const itemById = new Map(
    (Array.isArray(battlefield?.itemCatalog) ? battlefield.itemCatalog : [])
      .map((item) => {
        const itemId = typeof item?.itemId === 'string' ? item.itemId.trim() : '';
        if (!itemId) return null;
        return [itemId, item];
      })
      .filter(Boolean)
  );
  return (Array.isArray(battlefield?.objects) ? battlefield.objects : []).map((obj, index) => {
    const itemId = typeof obj?.itemId === 'string' ? obj.itemId.trim() : '';
    const item = itemById.get(itemId) || {};
    return {
      id: typeof obj?.objectId === 'string' ? obj.objectId : `wall_${index + 1}`,
      itemId,
      x: Number(obj?.x) || 0,
      y: Number(obj?.y) || 0,
      z: Number(obj?.z) || 0,
      rotation: Number(obj?.rotation) || 0,
      width: Math.max(8, Number(item?.width ?? obj?.width) || 84),
      depth: Math.max(8, Number(item?.depth ?? obj?.depth) || 24),
      height: Math.max(6, Number(item?.height ?? obj?.height) || 38),
      maxHp: Math.max(1, Number(item?.hp ?? obj?.hp) || 180),
      hp: Math.max(1, Number(item?.hp ?? obj?.hp) || 180),
      defense: Math.max(0.1, Number(item?.defense ?? obj?.defense) || 1.1),
      destroyed: false
    };
  });
};

const cloneObstacleList = (list = []) => (
  (Array.isArray(list) ? list : []).map((wall) => ({
    ...wall,
    hp: Number(wall?.hp) || Number(wall?.maxHp) || 1,
    destroyed: !!wall?.destroyed
  }))
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
    groups.push({
      id: `def_${deploy?.deployId || (index + 1)}`,
      team: TEAM_DEFENDER,
      name: (typeof deploy?.name === 'string' && deploy.name.trim()) ? deploy.name.trim() : `守军${index + 1}`,
      units: assigned,
      x: clampXToDeployZone(Number(deploy?.x) || 0, field.width, 0, TEAM_DEFENDER),
      y: clamp(Number(deploy?.y) || 0, -field.height / 2, field.height / 2),
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

const createSquad = ({ group, index, team, unitTypeMap, unitsPerSoldier, fieldWidth, fieldHeight }) => {
  const units = normalizeUnitsMap(group?.units || {});
  const startCount = sumUnitsMap(units);
  const stats = aggregateStats(units, unitTypeMap);
  const hpAvg = Math.max(1, Number(stats.hpAvg) || 1);
  const maxHealth = Math.max(1, Math.round(startCount * hpAvg));
  const radius = clamp(8 + (Math.sqrt(Math.max(1, startCount)) * 0.58), 10, 118);
  const startX = clampXToTeamZone(Number(group?.x) || 0, fieldWidth, radius, team);
  const startY = clamp(
    Number(group?.y) || 0,
    (-fieldHeight / 2) + radius,
    (fieldHeight / 2) - radius
  );
  const rallyRadius = Math.max(6, Math.min(16, radius * 0.35));
  const rallyX = clampXToTeamZone(
    team === TEAM_ATTACKER ? (-fieldWidth / 2 + 40) : (fieldWidth / 2 - 40),
    fieldWidth,
    rallyRadius,
    team
  );

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
    x: startX,
    y: startY,
    radius,
    waypoints: [],
    action: '待命',
    behavior: team === TEAM_DEFENDER ? 'auto' : 'idle',
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
    selected: false,
    hover: false,
    flagBearerAgentId: ''
  };
};

const buildVisualResolver = (visualConfig) => {
  const byType = (visualConfig && typeof visualConfig === 'object' && visualConfig.byType) ? visualConfig.byType : {};
  const byClass = (visualConfig && typeof visualConfig === 'object' && visualConfig.byClass) ? visualConfig.byClass : {};
  const fallback = (visualConfig && typeof visualConfig === 'object' && visualConfig.fallback) ? visualConfig.fallback : {
    bodyIndex: 0,
    gearIndex: 0,
    vehicleIndex: 0
  };

  return (unitTypeId, classTag) => {
    const type = byType[unitTypeId] || null;
    const group = type || byClass[classTag] || fallback;
    return {
      bodyIndex: Math.max(0, Number(group?.bodyIndex) || 0),
      gearIndex: Math.max(0, Number(group?.gearIndex) || 0),
      vehicleIndex: Math.max(0, Number(group?.vehicleIndex) || 0)
    };
  };
};

const ensureBuffer = (state, key, stride, count) => {
  if (!state[key] || !(state[key].data instanceof Float32Array) || state[key].stride !== stride) {
    state[key] = {
      stride,
      count: 0,
      capacity: 0,
      data: new Float32Array(stride * 16)
    };
  }
  if (count <= state[key].capacity) return state[key];
  state[key].capacity = Math.max(count, Math.max(16, Math.floor(state[key].capacity * 1.5) || 16));
  state[key].data = new Float32Array(state[key].capacity * stride);
  return state[key];
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
    this.visualConfig = buildVisualResolver(options?.visualConfig || {});
    this.attackerRoster = buildRosterMap(this.initData?.attacker?.units || [], this.unitTypeMap);

    this.attackerDeployGroups = [];
    this.defenderDeployGroups = buildDefenderDeployGroups(
      this.initData?.defender?.units || [],
      this.initData?.battlefield?.defenderDeployments || [],
      this.field,
      this.unitTypeMap
    );
    this.initialBuildings = buildObstacleList(this.initData?.battlefield || {});

    this.selectedDeploySquadId = '';
    this.focusSquadId = '';
    this.selectedBattleSquadId = '';

    this.sim = null;
    this.crowd = null;

    this.snapshotState = {
      units: { stride: UNIT_INSTANCE_STRIDE, count: 0, capacity: 0, data: new Float32Array(UNIT_INSTANCE_STRIDE * 16) },
      buildings: { stride: BUILDING_INSTANCE_STRIDE, count: 0, capacity: 0, data: new Float32Array(BUILDING_INSTANCE_STRIDE * 16) },
      projectiles: { stride: PROJECTILE_INSTANCE_STRIDE, count: 0, capacity: 0, data: new Float32Array(PROJECTILE_INSTANCE_STRIDE * 16) },
      effects: { stride: EFFECT_INSTANCE_STRIDE, count: 0, capacity: 0, data: new Float32Array(EFFECT_INSTANCE_STRIDE * 16) }
    };

    this.debugStats = {
      simStepMs: 0,
      renderMs: 0,
      fps: 0
    };
  }

  getPhase() {
    return this.phase;
  }

  getField() {
    return this.field;
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

  getDeployGroupById(groupId = '') {
    const safeId = typeof groupId === 'string' ? groupId.trim() : '';
    if (!safeId) return null;
    return this.attackerDeployGroups.find((row) => row.id === safeId) || null;
  }

  getAttackerRosterRows() {
    const usedMap = collectUsedUnitsMap(this.attackerDeployGroups);
    return Object.values(this.attackerRoster)
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

  createAttackerDeployGroup({ units = {}, name = '', x, y, placed = false } = {}) {
    if (this.phase !== 'deploy') return { ok: false, reason: '仅部署阶段可新建部队' };
    const nextUnits = normalizeUnitsMap(units);
    if (sumUnitsMap(nextUnits) <= 0) return { ok: false, reason: '请至少配置一个兵种' };
    const usedMap = collectUsedUnitsMap(this.attackerDeployGroups);
    const rows = this.getAttackerRosterRows();
    for (const [unitTypeId, count] of Object.entries(nextUnits)) {
      const rosterRow = rows.find((row) => row.unitTypeId === unitTypeId);
      const total = Math.max(0, Math.floor(Number(rosterRow?.total) || 0));
      const used = Math.max(0, Math.floor(Number(usedMap[unitTypeId]) || 0));
      if (count > Math.max(0, total - used)) {
        const unitName = rosterRow?.unitName || unitTypeId;
        return { ok: false, reason: `${unitName} 可用不足` };
      }
    }

    const gridRows = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, this.attackerDeployGroups.length + 1))));
    const index = this.attackerDeployGroups.length;
    const row = index % gridRows;
    const layer = Math.floor(index / gridRows);
    const fallbackY = clamp(
      -this.field.height * 0.35 + ((row + 1) * (this.field.height * 0.7 / (gridRows + 1))),
      -this.field.height / 2 + 12,
      this.field.height / 2 - 12
    );
    const fallbackX = clampXToDeployZone(
      -this.field.width / 2 + 72 + (layer * 56),
      this.field.width,
      10,
      TEAM_ATTACKER
    );
    const candidateTypeId = Object.keys(nextUnits)[0] || '';
    const candidateName = this.unitTypeMap.get(candidateTypeId)?.name || candidateTypeId || '部队';
    const groupName = (typeof name === 'string' && name.trim())
      ? name.trim()
      : `${candidateName}${this.attackerDeployGroups.length + 1}`;
    const safeX = clampXToDeployZone(
      Number.isFinite(Number(x)) ? Number(x) : fallbackX,
      this.field.width,
      10,
      TEAM_ATTACKER
    );
    const safeY = clamp(
      Number.isFinite(Number(y)) ? Number(y) : fallbackY,
      -this.field.height / 2 + 10,
      this.field.height / 2 - 10
    );
    const groupId = `atk_custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.attackerDeployGroups.push({
      id: groupId,
      team: TEAM_ATTACKER,
      name: groupName,
      units: nextUnits,
      x: safeX,
      y: safeY,
      placed: placed !== false
    });
    this.selectedDeploySquadId = groupId;
    this.focusSquadId = groupId;
    return { ok: true, groupId };
  }

  updateAttackerDeployGroup(groupId = '', { units = null, name = null } = {}) {
    if (this.phase !== 'deploy') return { ok: false, reason: '仅部署阶段可编辑部队' };
    const target = this.getDeployGroupById(groupId);
    if (!target) return { ok: false, reason: '未找到部队' };
    const nextUnits = units ? normalizeUnitsMap(units) : normalizeUnitsMap(target.units || {});
    if (sumUnitsMap(nextUnits) <= 0) return { ok: false, reason: '请至少配置一个兵种' };
    const others = this.attackerDeployGroups.filter((row) => row.id !== target.id);
    const usedMap = collectUsedUnitsMap(others);
    const rows = this.getAttackerRosterRows();
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
    return { ok: true };
  }

  removeAttackerDeployGroup(groupId = '') {
    if (this.phase !== 'deploy') return { ok: false, reason: '仅部署阶段可解散部队' };
    const safeGroupId = typeof groupId === 'string' ? groupId.trim() : '';
    if (!safeGroupId) return { ok: false, reason: '缺少部队ID' };
    const prevLen = this.attackerDeployGroups.length;
    this.attackerDeployGroups = this.attackerDeployGroups.filter((row) => row.id !== safeGroupId);
    if (this.attackerDeployGroups.length === prevLen) return { ok: false, reason: '未找到部队' };
    const fallbackId = this.attackerDeployGroups[0]?.id || '';
    if (this.selectedDeploySquadId === safeGroupId) this.selectedDeploySquadId = fallbackId;
    if (this.focusSquadId === safeGroupId) this.focusSquadId = fallbackId;
    return { ok: true };
  }

  setAttackerDeployGroupPlaced(groupId = '', placed = true) {
    if (this.phase !== 'deploy') return false;
    const target = this.getDeployGroupById(groupId);
    if (!target) return false;
    target.placed = !!placed;
    return true;
  }

  moveDeployGroup(groupId, worldPoint) {
    const targetId = String(groupId || this.selectedDeploySquadId || '');
    const group = this.attackerDeployGroups.find((row) => row.id === targetId);
    if (!group) return false;
    const safePoint = clampPointToField(worldPoint, this.field, 10);
    group.x = clampXToDeployZone(safePoint.x, this.field.width, 10, TEAM_ATTACKER);
    group.y = safePoint.y;
    return true;
  }

  canDeployAt(worldPoint, team = TEAM_ATTACKER, radius = 10) {
    if (this.phase !== 'deploy') return false;
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    return isXInDeployZone(worldPoint?.x, this.field.width, radius, safeTeam);
  }

  pickAttackerDeployGroup(worldPoint, radius = 26) {
    const x = Number(worldPoint?.x) || 0;
    const y = Number(worldPoint?.y) || 0;
    let best = null;
    let bestDist = Infinity;
    this.attackerDeployGroups.forEach((group) => {
      if (!group) return;
      const dx = (Number(group.x) || 0) - x;
      const dy = (Number(group.y) || 0) - y;
      const dist = Math.hypot(dx, dy);
      const pickRadius = Math.max(radius, 12 + Math.sqrt(Math.max(1, sumUnitsMap(group.units || {}))) * 0.9);
      if (dist <= pickRadius && dist < bestDist) {
        best = group;
        bestDist = dist;
      }
    });
    return best;
  }

  canStartBattle() {
    const attackerCount = this.attackerDeployGroups
      .filter((row) => row?.placed !== false)
      .reduce((sum, row) => sum + sumUnitsMap(row?.units || {}), 0);
    const defenderCount = this.defenderDeployGroups.reduce((sum, row) => sum + sumUnitsMap(row?.units || {}), 0);
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
        fieldHeight: this.field.height
      }))
      .filter((row) => row.startCount > 0);

    const defenderSquads = this.defenderDeployGroups
      .map((group, index) => createSquad({
        group,
        index,
        team: TEAM_DEFENDER,
        unitTypeMap: this.unitTypeMap,
        unitsPerSoldier: this.unitsPerSoldier,
        fieldWidth: this.field.width,
        fieldHeight: this.field.height
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

  commandMove(squadId, worldPoint, options = {}) {
    if (this.phase !== 'battle' || !this.sim) return false;
    const squad = this.getSquadById(squadId);
    if (!squad || squad.team !== TEAM_ATTACKER || squad.remain <= 0) return false;
    const append = !!options?.append;
    const safe = clampPointToField(worldPoint, this.field, Math.max(6, Number(squad.radius) || 10));
    safe.x = clampXToTeamZone(safe.x, this.field.width, Math.max(6, Number(squad.radius) || 10), squad.team);
    if (append) {
      squad.waypoints.push(safe);
    } else {
      squad.waypoints = [safe];
    }
    squad.behavior = 'move';
    squad.action = '移动';
    return true;
  }

  commandBehavior(squadId, behavior = 'idle') {
    if (this.phase !== 'battle' || !this.sim) return false;
    const squad = this.getSquadById(squadId);
    if (!squad || squad.team !== TEAM_ATTACKER || squad.remain <= 0) return false;
    if (behavior === 'idle') {
      squad.behavior = 'idle';
      squad.waypoints = [];
      squad.action = '待命';
      return true;
    }
    if (behavior === 'auto') {
      squad.behavior = 'auto';
      squad.action = '自动攻击';
      return true;
    }
    if (behavior === 'defend') {
      squad.behavior = 'defend';
      squad.waypoints = [];
      squad.action = '防御';
      return true;
    }
    if (behavior === 'retreat') {
      squad.behavior = 'retreat';
      squad.waypoints = [squad.rallyPoint];
      squad.action = '撤退';
      return true;
    }
    return false;
  }

  commandSkill(squadId, targetSpec) {
    if (this.phase !== 'battle' || !this.sim || !this.crowd) return { ok: false, reason: '战斗未开始' };
    return triggerCrowdSkill(this.sim, this.crowd, squadId, targetSpec);
  }

  step(dtSec) {
    if (this.phase !== 'battle' || !this.sim || this.sim.ended) return;
    const dt = clamp(Number(dtSec) || 0, 0.001, 0.05);
    const t0 = performance.now();
    this.sim.timerSec = Math.max(0, Number(this.sim.timerSec) - dt);
    updateCrowdSim(this.crowd, this.sim, dt);

    // Hard boundary: attacker stays on left (blue), defender stays on right (red).
    (this.sim.squads || []).forEach((squad) => {
      if (!squad) return;
      const radius = Math.max(2, Number(squad.radius) || 2);
      const safePoint = clampPointToField({ x: squad.x, y: squad.y }, this.field, radius);
      squad.x = clampXToTeamZone(safePoint.x, this.field.width, radius, squad.team);
      squad.y = safePoint.y;
      if (Array.isArray(squad.waypoints) && squad.waypoints.length > 0) {
        squad.waypoints.forEach((point) => {
          if (!point) return;
          const safeWp = clampPointToField(point, this.field, radius);
          point.x = clampXToTeamZone(safeWp.x, this.field.width, radius, squad.team);
          point.y = safeWp.y;
        });
      }
      if (squad.rallyPoint) {
        const safeRally = clampPointToField(squad.rallyPoint, this.field, radius);
        squad.rallyPoint.x = clampXToTeamZone(safeRally.x, this.field.width, radius, squad.team);
        squad.rallyPoint.y = safeRally.y;
      }
    });
    (this.crowd?.allAgents || []).forEach((agent) => {
      if (!agent || agent.dead) return;
      const radius = Math.max(1, Number(agent.radius) || 1);
      const safePos = clampPointToField(agent, this.field, radius);
      agent.x = clampXToTeamZone(safePos.x, this.field.width, radius, agent.team);
      agent.y = safePos.y;
      if (agent.goal) {
        const safeGoal = clampPointToField(agent.goal, this.field, radius);
        agent.goal.x = clampXToTeamZone(safeGoal.x, this.field.width, radius, agent.team);
        agent.goal.y = safeGoal.y;
      }
    });

    (this.sim.squads || []).forEach((squad) => {
      if (!squad || squad.remain <= 0) return;
      const inCombat = (Number(squad.underAttackTimer) || 0) > 0 || (Number(squad.attackCooldown) || 0) > 0;
      const decay = inCombat ? 0.34 : 0.9;
      squad.morale = clamp((Number(squad.morale) || 0) - (decay * dt), 0, MORALE_MAX);
      squad.stamina = clamp((Number(squad.stamina) || 0) + (inCombat ? 3.2 : 5.4) * dt, 0, STAMINA_MAX);
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
          action: '部署中',
          stamina: 100,
          morale: 100
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
      const group = this.attackerDeployGroups.find((row) => row.id === (this.selectedDeploySquadId || this.focusSquadId))
        || this.attackerDeployGroups[0]
        || { x: 0, y: 0, id: '' };
      return { x: Number(group.x) || 0, y: Number(group.y) || 0, vx: 0, vy: 0, squadId: group.id || '' };
    }
    if (!this.sim || !this.crowd) return { x: 0, y: 0, vx: 0, vy: 0, squadId: '' };
    if (this.focusSquadId) {
      const picked = resolveSquadAnchor(this.sim, this.crowd, this.focusSquadId);
      if (picked) return picked;
    }
    return resolveFallbackAnchor(this.sim, this.crowd, this.selectedBattleSquadId);
  }

  getRenderSnapshot() {
    const deployUnitCount = this.attackerDeployGroups.length + this.defenderDeployGroups.length;
    const units = ensureBuffer(this.snapshotState, 'units', UNIT_INSTANCE_STRIDE, this.crowd?.allAgents?.length || deployUnitCount);
    const hideDefenderIntelInDeploy = !this.intelVisible && (!this.sim || this.phase === 'deploy');
    const activeBuildings = hideDefenderIntelInDeploy
      ? []
      : (Array.isArray(this.sim?.buildings) ? this.sim.buildings : this.initialBuildings);
    const buildings = ensureBuffer(this.snapshotState, 'buildings', BUILDING_INSTANCE_STRIDE, activeBuildings.length || 0);
    const projectiles = ensureBuffer(this.snapshotState, 'projectiles', PROJECTILE_INSTANCE_STRIDE, this.sim?.projectiles?.length || 0);
    const effects = ensureBuffer(this.snapshotState, 'effects', EFFECT_INSTANCE_STRIDE, this.sim?.hitEffects?.length || 0);

    if (!this.sim || !this.crowd) {
      let previewCount = 0;
      const fillPreviewGroup = (group, teamTag, selected, idx) => {
        if (!group) return;
        const unitsMap = normalizeUnitsMap(group.units || {});
        const total = Math.max(1, sumUnitsMap(unitsMap));
        const unitTypeId = Object.keys(unitsMap)[0] || '';
        const classTag = inferClassFromUnitType(this.unitTypeMap.get(unitTypeId) || {});
        const visual = this.visualConfig(unitTypeId, classTag);
        const base = previewCount * UNIT_INSTANCE_STRIDE;
        units.data[base + 0] = Number(group.x) || 0;
        units.data[base + 1] = Number(group.y) || 0;
        units.data[base + 2] = 0;
        units.data[base + 3] = Math.max(4.2, Math.min(12, Math.sqrt(total) * 0.52));
        units.data[base + 4] = teamTag === TEAM_ATTACKER ? 0 : Math.PI;
        units.data[base + 5] = teamTag === TEAM_ATTACKER ? 0 : 1;
        units.data[base + 6] = 1;
        units.data[base + 7] = visual.bodyIndex;
        units.data[base + 8] = visual.gearIndex;
        units.data[base + 9] = visual.vehicleIndex;
        units.data[base + 10] = selected ? 1 : 0;
        units.data[base + 11] = idx === 0 ? 1 : 0;
        previewCount += 1;
      };
      this.attackerDeployGroups.forEach((group, idx) => fillPreviewGroup(group, TEAM_ATTACKER, group.id === this.selectedDeploySquadId, idx));
      if (!hideDefenderIntelInDeploy) {
        this.defenderDeployGroups.forEach((group, idx) => fillPreviewGroup(group, TEAM_DEFENDER, false, idx));
      }
      units.count = previewCount;

      let wallCount = 0;
      for (let i = 0; i < activeBuildings.length; i += 1) {
        const wall = activeBuildings[i];
        if (!wall) continue;
        const base = wallCount * BUILDING_INSTANCE_STRIDE;
        buildings.data[base + 0] = Number(wall.x) || 0;
        buildings.data[base + 1] = Number(wall.y) || 0;
        buildings.data[base + 2] = Math.max(2, Number(wall.width) || 10);
        buildings.data[base + 3] = Math.max(2, Number(wall.depth) || 10);
        buildings.data[base + 4] = Math.max(2, Number(wall.height) || 8);
        buildings.data[base + 5] = degToRad(wall.rotation);
        buildings.data[base + 6] = clamp((Number(wall.hp) || 0) / Math.max(1, Number(wall.maxHp) || 1), 0, 1);
        buildings.data[base + 7] = wall.destroyed ? 1 : 0;
        wallCount += 1;
      }
      buildings.count = wallCount;
      projectiles.count = 0;
      effects.count = 0;
      return this.snapshotState;
    }

    const agents = Array.isArray(this.crowd.allAgents) ? this.crowd.allAgents : [];
    let unitCount = 0;
    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i];
      if (!agent || agent.dead || (Number(agent.weight) || 0) <= 0.001) continue;
      const squad = this.getSquadById(agent.squadId);
      const visual = this.visualConfig(agent.unitTypeId, squad?.classTag || agent.typeCategory || 'infantry');
      const base = unitCount * UNIT_INSTANCE_STRIDE;
      units.data[base + 0] = Number(agent.x) || 0;
      units.data[base + 1] = Number(agent.y) || 0;
      units.data[base + 2] = 0;
      units.data[base + 3] = Math.max(2.6, Math.min(10.5, Math.sqrt(Math.max(1, Number(agent.weight) || 1)) * 0.82));
      units.data[base + 4] = Number(agent.yaw) || 0;
      units.data[base + 5] = agent.team === TEAM_ATTACKER ? 0 : 1;
      units.data[base + 6] = clamp((Number(agent.hpWeight) || Number(agent.weight) || 1) / Math.max(0.001, Number(agent.initialWeight) || 1), 0, 1);
      units.data[base + 7] = visual.bodyIndex;
      units.data[base + 8] = visual.gearIndex;
      units.data[base + 9] = visual.vehicleIndex;
      units.data[base + 10] = agent.squadId === this.selectedBattleSquadId ? 1 : 0;
      units.data[base + 11] = agent.isFlagBearer ? 1 : 0;
      unitCount += 1;
    }
    units.count = unitCount;

    const walls = activeBuildings;
    let wallCount = 0;
    for (let i = 0; i < walls.length; i += 1) {
      const wall = walls[i];
      if (!wall) continue;
      const base = wallCount * BUILDING_INSTANCE_STRIDE;
      buildings.data[base + 0] = Number(wall.x) || 0;
      buildings.data[base + 1] = Number(wall.y) || 0;
      buildings.data[base + 2] = Math.max(2, Number(wall.width) || 10);
      buildings.data[base + 3] = Math.max(2, Number(wall.depth) || 10);
      buildings.data[base + 4] = Math.max(2, Number(wall.height) || 8);
      buildings.data[base + 5] = degToRad(wall.rotation);
      buildings.data[base + 6] = clamp((Number(wall.hp) || 0) / Math.max(1, Number(wall.maxHp) || 1), 0, 1);
      buildings.data[base + 7] = wall.destroyed ? 1 : 0;
      wallCount += 1;
    }
    buildings.count = wallCount;

    const projectilesRaw = Array.isArray(this.sim.projectiles) ? this.sim.projectiles : [];
    let projectileCount = 0;
    for (let i = 0; i < projectilesRaw.length; i += 1) {
      const p = projectilesRaw[i];
      if (!p || p.hit) continue;
      const base = projectileCount * PROJECTILE_INSTANCE_STRIDE;
      projectiles.data[base + 0] = Number(p.x) || 0;
      projectiles.data[base + 1] = Number(p.y) || 0;
      projectiles.data[base + 2] = Number(p.z) || 0;
      projectiles.data[base + 3] = Math.max(0.8, Number(p.radius) || 2.2);
      projectiles.data[base + 4] = p.team === TEAM_ATTACKER ? 0 : 1;
      projectiles.data[base + 5] = p.type === 'shell' ? 1 : 0;
      projectiles.data[base + 6] = clamp((Number(p.ttl) || 0) / Math.max(0.01, (Number(p.elapsed) || 0) + (Number(p.ttl) || 0)), 0, 1);
      projectiles.data[base + 7] = 0;
      projectileCount += 1;
    }
    projectiles.count = projectileCount;

    const effectsRaw = Array.isArray(this.sim.hitEffects) ? this.sim.hitEffects : [];
    let effectCount = 0;
    for (let i = 0; i < effectsRaw.length; i += 1) {
      const e = effectsRaw[i];
      if (!e) continue;
      const base = effectCount * EFFECT_INSTANCE_STRIDE;
      effects.data[base + 0] = Number(e.x) || 0;
      effects.data[base + 1] = Number(e.y) || 0;
      effects.data[base + 2] = Number(e.z) || 0;
      effects.data[base + 3] = Math.max(0.6, Number(e.radius) || 2.2);
      effects.data[base + 4] = e.team === TEAM_ATTACKER ? 0 : 1;
      effects.data[base + 5] = e.type === 'explosion' ? 1 : 0;
      effects.data[base + 6] = clamp((Number(e.ttl) || 0) / Math.max(0.01, (Number(e.elapsed) || 0) + (Number(e.ttl) || 0)), 0, 1);
      effects.data[base + 7] = 0;
      effectCount += 1;
    }
    effects.count = effectCount;

    return this.snapshotState;
  }

  getMinimapSnapshot() {
    const hideDefenderIntelInDeploy = !this.intelVisible && this.phase === 'deploy';
    const squads = this.phase === 'battle' || this.phase === 'ended'
      ? (this.sim?.squads || []).map((row) => ({
        id: row.id,
        x: Number(row.x) || 0,
        y: Number(row.y) || 0,
        team: row.team,
        remain: Number(row.remain) || 0,
        selected: row.id === this.focusSquadId
      }))
      : [
        ...this.attackerDeployGroups.map((row) => ({ id: row.id, x: row.x, y: row.y, team: TEAM_ATTACKER, remain: sumUnitsMap(row.units), selected: row.id === this.selectedDeploySquadId })),
        ...(!hideDefenderIntelInDeploy
          ? this.defenderDeployGroups.map((row) => ({ id: row.id, x: row.x, y: row.y, team: TEAM_DEFENDER, remain: sumUnitsMap(row.units), selected: false }))
          : [])
      ];

    return {
      field: this.field,
      deployRange: this.getDeployRange(),
      buildings: hideDefenderIntelInDeploy ? [] : (this.sim?.buildings || this.initialBuildings),
      squads,
      visibilityMask: null
    };
  }

  getDebugStats() {
    return {
      ...this.debugStats,
      agentCount: this.snapshotState.units.count,
      projectileCount: this.snapshotState.projectiles.count,
      buildingCount: this.snapshotState.buildings.count
    };
  }

  setRenderMs(ms) {
    this.debugStats.renderMs = Number(ms) || 0;
  }

  setFps(fps) {
    this.debugStats.fps = Number(fps) || 0;
  }
}
