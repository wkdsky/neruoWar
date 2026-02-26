import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './pveBattle.css';
import NumberPadDialog from '../common/NumberPadDialog';
import {
  clamp,
  normalizeDeg,
  projectWorld,
  unprojectScreen,
  rotate2D,
  distance2D,
  circleIntersectsRotatedRect,
  lineIntersectsRotatedRect,
  clampPointToField
} from './battleMath';
import {
  createFormationVisualState,
  reconcileCounts,
  renderFormation,
  getFormationFootprint,
  inferTroopCategory
} from '../../game/formation/ArmyFormationRenderer';

const API_BASE = 'http://localhost:5000';
const DEFAULT_FIELD_WIDTH = 900;
const DEFAULT_FIELD_HEIGHT = 620;
const DEFAULT_TIME_LIMIT = 240;
const DEFAULT_PITCH = 45;
const MIN_PITCH = 25;
const MAX_PITCH = 70;
const DEFAULT_YAW = 0;
const CAMERA_ROTATE_SENSITIVITY = 0.38;
const CAMERA_ROTATE_CLICK_THRESHOLD = 4;
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.08;
const DEPLOY_ZONE_RATIO = 0.2;
const FORMATION_METRIC_BUDGET = 48;
const FORMATION_OVERLAP_RATIO = 0.82;
const FORMATION_OVERLAP_ALLOWANCE = 4;
const UNITS_PER_SOLDIER_FALLBACK = 10;
const MORALE_MAX = 100;
const STAMINA_MAX = 100;
const STAMINA_MOVE_COST = 8;
const STAMINA_RECOVER = 12;
const STAMINA_MOVE_THRESHOLD = 20;
const CARD_UPDATE_MS = 120;
const EDGE_GESTURE_THRESHOLD = 16;
const SOLDIER_VISUAL_SCALE = 1.18;
const COMPOSE_SOLDIER_VISUAL_SCALE = 1.18;

const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';

const formatCountdown = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const getUnitClass = (unitType = {}) => inferTroopCategory(unitType);

const getUnitClassIcon = (unitClass) => {
  if (unitClass === 'cavalry') return '🐎';
  if (unitClass === 'archer') return '🏹';
  if (unitClass === 'artillery') return '💣';
  return '🛡';
};

const normalizeUnitsMap = (raw = {}) => {
  const out = {};
  Object.entries(raw || {}).forEach(([unitTypeId, count]) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    if (!safeId || safeCount <= 0) return;
    out[safeId] = safeCount;
  });
  return out;
};

const sumUnitsMap = (map = {}) => Object.values(map || {}).reduce((sum, count) => sum + (Math.max(0, Number(count) || 0)), 0);

const resolveFormationBudgetByZoom = (zoomValue) => {
  const minZoom = Math.max(0.01, MIN_ZOOM);
  const maxZoom = Math.max(minZoom + 0.01, MAX_ZOOM);
  const safeZoom = Math.max(minZoom, Math.min(maxZoom, Number(zoomValue) || DEFAULT_ZOOM));
  const t = (safeZoom - minZoom) / (maxZoom - minZoom);
  const eased = Math.sqrt(Math.max(0, Math.min(1, t)));
  return Math.max(32, Math.min(56, Math.round(32 + (eased * 24))));
};

const resolveFormationFootprintScaleByCount = (totalUnits) => {
  const safeTotal = Math.max(1, Math.floor(Number(totalUnits) || 0));
  const soldierEquivalent = safeTotal / 10;
  const scale = 0.9 + (Math.log10(soldierEquivalent + 1) * 0.55);
  return Math.max(0.9, Math.min(2.4, scale));
};

const resolveScaledFormationRadius = (rawRadius, totalUnits) => {
  const safeRaw = Math.max(10, Number(rawRadius) || 16);
  const scaleByCount = resolveFormationFootprintScaleByCount(totalUnits);
  return Math.max(9, safeRaw * scaleByCount * 0.86);
};

const resolveClusterScale = (targetRadius, rawRadius) => (
  Math.max(0.45, Math.min(1.25, Math.max(1, Number(targetRadius) || 1) / Math.max(1, Number(rawRadius) || 1)))
);

const unitsMapToRows = (unitsMap = {}, unitTypeMap = new Map()) => (
  Object.entries(unitsMap || {})
    .map(([unitTypeId, rawCount]) => {
      const count = Math.max(0, Math.floor(Number(rawCount) || 0));
      if (!unitTypeId || count <= 0) return null;
      return {
        unitTypeId,
        unitName: unitTypeMap.get(unitTypeId)?.name || unitTypeId,
        count
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.unitName.localeCompare(b.unitName, 'zh-Hans-CN'))
);

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
      atk: Math.max(0, Number(item?.atk) || 1),
      def: Math.max(0, Number(item?.def) || 0),
      range: Math.max(1, Number(item?.range) || 1),
      roleTag: item?.roleTag === '远程' ? '远程' : '近战'
    });
  });
  return map;
};

const aggregateStats = (unitsMap = {}, unitTypeMap = new Map()) => {
  const valid = Object.entries(unitsMap || {}).filter(([unitTypeId, count]) => unitTypeMap.has(unitTypeId) && count > 0);
  if (valid.length === 0) {
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

  let totalCount = 0;
  let totalSpeed = 0;
  let totalHp = 0;
  let totalAtk = 0;
  let totalDef = 0;
  let totalRange = 0;
  let mainUnitType = '';
  let mainCount = 0;

  valid.forEach(([unitTypeId, count]) => {
    const unitType = unitTypeMap.get(unitTypeId);
    const c = Math.max(0, Number(count) || 0);
    totalCount += c;
    totalSpeed += unitType.speed * c;
    totalHp += unitType.hp * c;
    totalAtk += unitType.atk * c;
    totalDef += unitType.def * c;
    totalRange += unitType.range * c;
    if (c > mainCount) {
      mainCount = c;
      mainUnitType = unitTypeId;
    }
  });

  const mainType = unitTypeMap.get(mainUnitType);
  return {
    classTag: getUnitClass(mainType),
    roleTag: mainType?.roleTag || (totalRange / Math.max(1, totalCount) > 1.5 ? '远程' : '近战'),
    speed: totalSpeed / Math.max(1, totalCount),
    hpAvg: totalHp / Math.max(1, totalCount),
    atk: totalAtk / Math.max(1, totalCount),
    def: totalDef / Math.max(1, totalCount),
    range: totalRange / Math.max(1, totalCount)
  };
};

const computeUnitsMapPower = (unitsMap = {}, unitTypeMap = new Map()) => (
  Object.entries(unitsMap || {}).reduce((sum, [unitTypeId, rawCount]) => {
    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
    if (!unitTypeId || count <= 0) return sum;
    const unitType = unitTypeMap.get(unitTypeId);
    if (!unitType) return sum;
    const perUnit = (
      (Math.max(1, Number(unitType.hp) || 0) * 0.38)
      + (Math.max(0, Number(unitType.atk) || 0) * 3.2)
      + (Math.max(0, Number(unitType.def) || 0) * 2.5)
      + (Math.max(1, Number(unitType.range) || 1) * 5.5)
      + (Math.max(0.2, Number(unitType.speed) || 1) * 8.5)
    );
    return sum + (perUnit * count);
  }, 0)
);

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const distributeUnitsByRatio = (unitsMap = {}, remain = 0, startCount = 0) => {
  const source = Object.entries(unitsMap || {}).filter(([unitTypeId, count]) => unitTypeId && count > 0);
  const totalStart = Math.max(1, Math.floor(Number(startCount) || source.reduce((sum, [, count]) => sum + count, 0)));
  const targetRemain = Math.max(0, Math.floor(Number(remain) || 0));
  if (source.length <= 0 || targetRemain <= 0) return {};
  if (targetRemain >= totalStart) {
    const full = {};
    source.forEach(([unitTypeId, count]) => {
      full[unitTypeId] = Math.max(0, Math.floor(Number(count) || 0));
    });
    return full;
  }
  const alloc = {};
  const fractions = [];
  let assigned = 0;
  source.forEach(([unitTypeId, count]) => {
    const c = Math.max(0, Math.floor(Number(count) || 0));
    const exact = targetRemain * (c / totalStart);
    const base = Math.floor(exact);
    alloc[unitTypeId] = base;
    assigned += base;
    fractions.push({ unitTypeId, frac: exact - base, count: c });
  });
  let remainSlots = Math.max(0, targetRemain - assigned);
  fractions.sort((a, b) => {
    if (b.frac !== a.frac) return b.frac - a.frac;
    if (b.count !== a.count) return b.count - a.count;
    return a.unitTypeId.localeCompare(b.unitTypeId, 'zh-Hans-CN');
  });
  for (let i = 0; i < remainSlots; i += 1) {
    const picked = fractions[i % fractions.length];
    if (!picked) break;
    alloc[picked.unitTypeId] = (alloc[picked.unitTypeId] || 0) + 1;
  }
  Object.keys(alloc).forEach((unitTypeId) => {
    if ((alloc[unitTypeId] || 0) <= 0) delete alloc[unitTypeId];
  });
  return alloc;
};

const buildFormationCameraState = (view, pitch, yaw, overrides = {}) => {
  const worldScale = Number(view?.worldScale) || 0.6;
  const inferredDistance = 1100 / Math.max(0.18, worldScale);
  return {
    worldScale,
    pitch: Number(pitch) || 45,
    yaw: Number(yaw) || 0,
    distance: inferredDistance,
    ...overrides
  };
};

const buildDefaultAttackerGroupName = (index) => `进攻第${Math.max(1, Number(index) || 1)}队`;

const buildInitialComposeGroups = (attackerUnits = []) => {
  void attackerUnits;
  return [];
};

const normalizeComposeSortOrder = (raw, fallback = 1) => Math.max(1, Math.floor(Number(raw) || fallback));

const sortComposeGroups = (groups = []) => (
  [...(Array.isArray(groups) ? groups : [])].sort((a, b) => {
    const aOrder = normalizeComposeSortOrder(a?.sortOrder, 1);
    const bOrder = normalizeComposeSortOrder(b?.sortOrder, 1);
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aName = typeof a?.name === 'string' ? a.name : '';
    const bName = typeof b?.name === 'string' ? b.name : '';
    return aName.localeCompare(bName, 'zh-Hans-CN');
  })
);

const buildRemainingPool = (allUnits = [], groups = []) => {
  const totalMap = {};
  (Array.isArray(allUnits) ? allUnits : []).forEach((entry) => {
    const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
    if (!unitTypeId || count <= 0) return;
    totalMap[unitTypeId] = (totalMap[unitTypeId] || 0) + count;
  });

  const usedMap = {};
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    Object.entries(group?.units || {}).forEach(([unitTypeId, count]) => {
      const c = Math.max(0, Math.floor(Number(count) || 0));
      if (!unitTypeId || c <= 0) return;
      usedMap[unitTypeId] = (usedMap[unitTypeId] || 0) + c;
    });
  });

  const remaining = {};
  Object.keys(totalMap).forEach((unitTypeId) => {
    remaining[unitTypeId] = Math.max(0, totalMap[unitTypeId] - (usedMap[unitTypeId] || 0));
  });
  return remaining;
};

const buildObstacleList = (battlefield = {}) => {
  const itemCatalog = Array.isArray(battlefield?.itemCatalog) ? battlefield.itemCatalog : [];
  const itemById = new Map(itemCatalog.map((item) => [item.itemId, item]));
  return (Array.isArray(battlefield?.objects) ? battlefield.objects : []).map((obj, index) => {
    const itemId = typeof obj?.itemId === 'string' ? obj.itemId.trim() : '';
    const item = itemById.get(itemId) || null;
    return {
      id: typeof obj?.id === 'string' ? obj.id : (typeof obj?.objectId === 'string' ? obj.objectId : `obj_${index + 1}`),
      itemId,
      x: Number(obj?.x) || 0,
      y: Number(obj?.y) || 0,
      z: Math.max(0, Math.floor(Number(obj?.z) || 0)),
      rotation: Number(obj?.rotation) || 0,
      width: Math.max(12, Number(item?.width) || 104),
      depth: Math.max(12, Number(item?.depth) || 24),
      height: Math.max(10, Number(item?.height) || 42),
      maxHp: Math.max(1, Math.floor(Number(item?.hp) || 240)),
      hp: Math.max(1, Math.floor(Number(item?.hp) || 240)),
      defense: Math.max(0.1, Number(item?.defense) || 1.1),
      style: item?.style && typeof item.style === 'object' ? item.style : {},
      destroyed: false
    };
  });
};

const computeFieldSize = (battlefield = {}) => ({
  width: Math.max(300, Number(battlefield?.layoutMeta?.fieldWidth) || DEFAULT_FIELD_WIDTH),
  height: Math.max(300, Number(battlefield?.layoutMeta?.fieldHeight) || DEFAULT_FIELD_HEIGHT)
});

const getDeployRange = (fieldWidth) => ({
  attackerMaxX: (-fieldWidth / 2) + (fieldWidth * DEPLOY_ZONE_RATIO),
  defenderMinX: (fieldWidth / 2) - (fieldWidth * DEPLOY_ZONE_RATIO)
});

const toRallyPoint = (team, fieldWidth) => {
  if (team === TEAM_ATTACKER) {
    return { x: (-fieldWidth / 2) + 40, y: 0 };
  }
  return { x: (fieldWidth / 2) - 40, y: 0 };
};

const buildAutoDefenderGroups = (defenderUnits = [], fieldWidth = DEFAULT_FIELD_WIDTH, fieldHeight = DEFAULT_FIELD_HEIGHT) => {
  const source = Array.isArray(defenderUnits) ? defenderUnits : [];
  if (source.length === 0) return [];

  const groups = [];
  const rows = Math.max(1, Math.ceil(Math.sqrt(source.length)));
  source.forEach((entry, index) => {
    const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
    const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
    if (!unitTypeId || count <= 0) return;
    const row = index % rows;
    const layer = Math.floor(index / rows);
    const y = -fieldHeight * 0.34 + ((row + 1) * ((fieldHeight * 0.68) / (rows + 1)));
    const x = (fieldWidth / 2) - 80 - (layer * 60);
    groups.push({
      id: `def_grp_${index + 1}`,
      name: `${entry?.unitName || unitTypeId}`,
      units: { [unitTypeId]: count },
      placed: true,
      x,
      y
    });
  });
  return groups;
};

const normalizeDeploymentUnits = (deployment = {}) => {
  const source = Array.isArray(deployment?.units) && deployment.units.length > 0
    ? deployment.units
    : [{ unitTypeId: deployment?.unitTypeId, count: deployment?.count }];
  const map = new Map();
  source.forEach((entry) => {
    const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
    if (!unitTypeId || count <= 0) return;
    map.set(unitTypeId, (map.get(unitTypeId) || 0) + count);
  });
  return Array.from(map.entries()).map(([unitTypeId, count]) => ({ unitTypeId, count }));
};

const buildDefenderGroupsFromDeployments = (defenderUnits = [], deployments = [], fieldWidth = DEFAULT_FIELD_WIDTH, fieldHeight = DEFAULT_FIELD_HEIGHT) => {
  const sourceUnits = Array.isArray(defenderUnits) ? defenderUnits : [];
  const sourceDeployments = (Array.isArray(deployments) ? deployments : []).filter((item) => item?.placed !== false);
  if (sourceDeployments.length === 0) {
    return buildAutoDefenderGroups(sourceUnits, fieldWidth, fieldHeight);
  }

  const availableMap = new Map(
    sourceUnits.map((entry) => [
      typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
      {
        unitName: typeof entry?.unitName === 'string' ? entry.unitName : '',
        count: Math.max(0, Math.floor(Number(entry?.count) || 0))
      }
    ]).filter(([unitTypeId]) => !!unitTypeId)
  );

  const groups = [];
  const sortedDeployments = [...sourceDeployments].sort((a, b) => {
    const aOrder = Math.max(0, Math.floor(Number(a?.sortOrder) || 0));
    const bOrder = Math.max(0, Math.floor(Number(b?.sortOrder) || 0));
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aName = typeof a?.name === 'string' ? a.name : '';
    const bName = typeof b?.name === 'string' ? b.name : '';
    return aName.localeCompare(bName, 'zh-Hans-CN');
  });

  sortedDeployments.forEach((deployment, index) => {
    const requestedUnits = normalizeDeploymentUnits(deployment);
    if (requestedUnits.length <= 0) return;
    const assignedUnitsMap = {};
    requestedUnits.forEach((entry) => {
      const unitInfo = availableMap.get(entry.unitTypeId);
      if (!unitInfo) return;
      const assigned = Math.min(unitInfo.count, entry.count);
      if (assigned <= 0) return;
      unitInfo.count -= assigned;
      assignedUnitsMap[entry.unitTypeId] = (assignedUnitsMap[entry.unitTypeId] || 0) + assigned;
    });
    if (sumUnitsMap(assignedUnitsMap) <= 0) return;
    groups.push({
      id: `def_layout_${deployment?.deployId || (index + 1)}`,
      name: (typeof deployment?.name === 'string' && deployment.name.trim()) ? deployment.name.trim() : `守军部队${index + 1}`,
      units: assignedUnitsMap,
      placed: true,
      x: clamp(Number(deployment?.x) || 0, -fieldWidth / 2, fieldWidth / 2),
      y: clamp(Number(deployment?.y) || 0, -fieldHeight / 2, fieldHeight / 2)
    });
  });

  const remainingUnits = Array.from(availableMap.entries())
    .map(([unitTypeId, info]) => ({ unitTypeId, unitName: info.unitName, count: info.count }))
    .filter((entry) => entry.count > 0);
  if (remainingUnits.length > 0) {
    groups.push(...buildAutoDefenderGroups(remainingUnits, fieldWidth, fieldHeight));
  }
  return groups;
};

const canPlaceGroupAt = (group, nextPos, groups = [], fieldSize, team, resolveFootprint = null) => {
  const selfFootprint = typeof resolveFootprint === 'function' ? resolveFootprint(group) : null;
  const radius = Math.max(9, Number(selfFootprint?.radius) || Math.max(18, 16 + (Math.sqrt(Math.max(1, sumUnitsMap(group?.units || {}))) * 2.4)));
  const safePoint = clampPointToField(nextPos, fieldSize.width, fieldSize.height, radius + 2);
  const deployRange = getDeployRange(fieldSize.width);
  if (team === TEAM_ATTACKER && safePoint.x > deployRange.attackerMaxX) return false;
  if (team === TEAM_DEFENDER && safePoint.x < deployRange.defenderMinX) return false;

  for (const other of (Array.isArray(groups) ? groups : [])) {
    if (!other || other.id === group.id || !other.placed) continue;
    const otherFootprint = typeof resolveFootprint === 'function' ? resolveFootprint(other) : null;
    const otherRadius = Math.max(9, Number(otherFootprint?.radius) || Math.max(18, 16 + (Math.sqrt(Math.max(1, sumUnitsMap(other?.units || {}))) * 2.4)));
    const dist = Math.hypot((other.x || 0) - safePoint.x, (other.y || 0) - safePoint.y);
    const minDist = Math.max(8, ((radius + otherRadius) * FORMATION_OVERLAP_RATIO) - FORMATION_OVERLAP_ALLOWANCE);
    if (dist < minDist) return false;
  }
  return true;
};

const createSquadEntity = ({
  group,
  team,
  index,
  unitTypeMap,
  unitsPerSoldier,
  fieldWidth,
  initialRadius = 24
}) => {
  const units = normalizeUnitsMap(group?.units || {});
  const unitTotal = sumUnitsMap(units);
  const stats = aggregateStats(units, unitTypeMap);
  const health = Math.max(1, Math.round(unitTotal * stats.hpAvg));
  const radius = clamp(Number(initialRadius) || 24, 9, 108);
  return {
    id: `${team}_squad_${index + 1}`,
    name: group?.name || (team === TEAM_ATTACKER ? `我方${index + 1}` : `守军${index + 1}`),
    team,
    units,
    startCount: unitTotal,
    remain: unitTotal,
    kills: 0,
    losses: 0,
    maxHealth: health,
    health,
    hpAvg: Math.max(1, stats.hpAvg),
    stamina: STAMINA_MAX,
    morale: MORALE_MAX,
    stats,
    classTag: stats.classTag,
    roleTag: stats.roleTag,
    x: Number(group?.x) || 0,
    y: Number(group?.y) || 0,
    radius,
    waypoints: [],
    action: '待命',
    behavior: 'idle',
    underAttackTimer: 0,
    attackCooldown: 0,
    effectBuff: null,
    charge: null,
    fatigueTimer: 0,
    selected: false,
    hover: false,
    unitsPerSoldier,
    rallyPoint: toRallyPoint(team, fieldWidth),
    skillUsedCount: 0,
    lastAttackedAt: 0
  };
};

const getViewport = (canvas, fieldWidth, fieldHeight, pitchDeg, yawDeg = 0, zoom = DEFAULT_ZOOM, panWorld = { x: 0, y: 0 }) => {
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const tiltSin = Math.max(0.2, Math.sin((pitchDeg * Math.PI) / 180));
  const worldScaleX = width / (fieldWidth * 1.22);
  const worldScaleY = height / ((fieldHeight * tiltSin * 1.26) + 130);
  const zoomValue = clamp(Number(zoom) || DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM);
  const safeScale = Math.max(0.2, Math.min(worldScaleX, worldScaleY)) * zoomValue;
  const pan = panWorld && typeof panWorld === 'object' ? panWorld : { x: 0, y: 0 };
  const panRot = rotate2D(Number(pan.x) || 0, Number(pan.y) || 0, yawDeg);
  const panViewY = panRot.y * tiltSin;
  return {
    viewport: {
      centerX: (width / 2) - (panRot.x * safeScale),
      centerY: ((height / 2) + 22) - (panViewY * safeScale)
    },
    worldScale: safeScale
  };
};

const findSquadById = (sim, squadId) => (sim?.squads || []).find((item) => item.id === squadId) || null;

const getAliveSquads = (sim, team) => (sim?.squads || []).filter((squad) => squad.team === team && squad.remain > 0);

const isPointBlockedByObstacles = (point, radius, sim, ignoreBuildingId = '') => {
  for (const building of (sim?.buildings || [])) {
    if (!building || building.destroyed) continue;
    if (ignoreBuildingId && building.id === ignoreBuildingId) continue;
    if (circleIntersectsRotatedRect(point, radius, building)) {
      return true;
    }
  }
  return false;
};

const isPointBlockedBySquads = (point, radius, sim, selfId = '') => {
  for (const squad of (sim?.squads || [])) {
    if (!squad || squad.id === selfId || squad.remain <= 0) continue;
    const dist = Math.hypot(point.x - squad.x, point.y - squad.y);
    const minDist = Math.max(8, ((radius + squad.radius) * FORMATION_OVERLAP_RATIO) - FORMATION_OVERLAP_ALLOWANCE);
    if (dist < minDist) return true;
  }
  return false;
};

const moveSquadWithCollision = (squad, targetPoint, sim, dt) => {
  const speedBase = Math.max(8, squad.stats.speed * 18);
  const moralePenalty = squad.morale <= 0 ? 0.5 : (squad.morale < 20 ? 0.72 : 1);
  const fatiguePenalty = squad.fatigueTimer > 0 ? 0.72 : 1;
  const speed = speedBase * moralePenalty * fatiguePenalty;
  const dx = targetPoint.x - squad.x;
  const dy = targetPoint.y - squad.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0.001) return 0;

  const step = Math.min(dist, speed * dt);
  const nx = squad.x + ((dx / dist) * step);
  const ny = squad.y + ((dy / dist) * step);
  const clamped = clampPointToField({ x: nx, y: ny }, sim.field.width, sim.field.height, squad.radius + 2);

  const candidate = { x: clamped.x, y: clamped.y };
  const blockedPrimary = isPointBlockedByObstacles(candidate, squad.radius, sim)
    || isPointBlockedBySquads(candidate, squad.radius, sim, squad.id);

  if (!blockedPrimary) {
    squad.x = candidate.x;
    squad.y = candidate.y;
    return step;
  }

  const candidateX = { x: clamped.x, y: squad.y };
  const blockedX = isPointBlockedByObstacles(candidateX, squad.radius, sim)
    || isPointBlockedBySquads(candidateX, squad.radius, sim, squad.id);
  if (!blockedX) {
    const moved = Math.abs(candidateX.x - squad.x);
    squad.x = candidateX.x;
    return moved;
  }

  const candidateY = { x: squad.x, y: clamped.y };
  const blockedY = isPointBlockedByObstacles(candidateY, squad.radius, sim)
    || isPointBlockedBySquads(candidateY, squad.radius, sim, squad.id);
  if (!blockedY) {
    const moved = Math.abs(candidateY.y - squad.y);
    squad.y = candidateY.y;
    return moved;
  }

  return 0;
};

const applyDamageToBuilding = (sim, building, damage) => {
  if (!building || building.destroyed) return false;
  const mitigation = 100 / (100 + (Math.max(0.1, building.defense) * 22));
  const actualDamage = Math.max(0.5, damage * mitigation);
  building.hp = Math.max(0, building.hp - actualDamage);
  if (building.hp <= 0 && !building.destroyed) {
    building.destroyed = true;
    sim.destroyedBuildings += 1;
    return true;
  }
  return false;
};

const applyDamageToSquad = (sim, attacker, target, damage) => {
  if (!target || target.remain <= 0) return;
  const mitigation = 100 / (100 + (Math.max(0, target.stats.def) * 3.8));
  const finalDamage = Math.max(0.4, damage * mitigation);
  const beforeRemain = target.remain;
  target.health = Math.max(0, target.health - finalDamage);
  const nextRemain = target.health <= 0
    ? 0
    : Math.max(0, Math.ceil(target.health / Math.max(1, target.hpAvg)));
  target.remain = Math.min(target.startCount, nextRemain);
  target.losses += Math.max(0, beforeRemain - target.remain);
  target.underAttackTimer = 1.8;
  target.lastAttackedAt = Date.now();

  if (beforeRemain > target.remain && attacker) {
    const killed = beforeRemain - target.remain;
    attacker.kills += killed;
    attacker.morale = clamp(attacker.morale + (killed * 2.4), 0, MORALE_MAX);
    target.morale = clamp(target.morale - (killed * 2.8), 0, MORALE_MAX);

    const friendlyNearby = (sim.squads || []).filter((squad) => (
      squad.team === attacker.team
      && squad.remain > 0
      && distance2D({ x: squad.x, y: squad.y }, { x: attacker.x, y: attacker.y }) <= 170
    ));
    friendlyNearby.forEach((squad) => {
      squad.morale = clamp(squad.morale + (killed * 0.8), 0, MORALE_MAX);
    });
  }

  if (target.remain <= 0) {
    target.action = '覆灭';
    target.behavior = 'idle';
    target.waypoints = [];
  }
};

const findNearestEnemy = (sim, squad) => {
  const enemies = getAliveSquads(sim, squad.team === TEAM_ATTACKER ? TEAM_DEFENDER : TEAM_ATTACKER);
  if (enemies.length === 0) return null;
  let best = enemies[0];
  let bestDist = distance2D({ x: squad.x, y: squad.y }, { x: best.x, y: best.y });
  for (let i = 1; i < enemies.length; i += 1) {
    const enemy = enemies[i];
    const d = distance2D({ x: squad.x, y: squad.y }, { x: enemy.x, y: enemy.y });
    if (d < bestDist) {
      best = enemy;
      bestDist = d;
    }
  }
  return { enemy: best, distance: bestDist };
};

const findNearestBuilding = (sim, fromPoint, maxDistance = Infinity) => {
  const alive = (sim?.buildings || []).filter((building) => !building.destroyed);
  if (alive.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  alive.forEach((building) => {
    const d = Math.hypot(fromPoint.x - building.x, fromPoint.y - building.y);
    if (d < bestDist && d <= maxDistance) {
      best = building;
      bestDist = d;
    }
  });
  return best;
};

const issueSquadMove = (sim, squadId, point, append = false, options = {}) => {
  const squad = findSquadById(sim, squadId);
  const allowAnyTeam = !!options?.allowAnyTeam;
  if (!squad || squad.remain <= 0) return false;
  if (!allowAnyTeam && squad.team !== TEAM_ATTACKER) return false;
  if (squad.stamina < STAMINA_MOVE_THRESHOLD) return false;
  const safePoint = clampPointToField(point, sim.field.width, sim.field.height, squad.radius + 2);
  if (append) {
    squad.waypoints.push(safePoint);
  } else {
    squad.waypoints = [safePoint];
  }
  squad.behavior = squad.behavior === 'retreat' ? 'retreat' : 'move';
  squad.action = '移动';
  return true;
};

const setSquadBehavior = (sim, squadId, behavior) => {
  const squad = findSquadById(sim, squadId);
  if (!squad || squad.remain <= 0 || squad.team !== TEAM_ATTACKER) return false;
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
  if (behavior === 'retreat') {
    squad.behavior = 'retreat';
    squad.waypoints = [deepClone(squad.rallyPoint)];
    squad.action = '撤退';
    return true;
  }
  if (behavior === 'defend') {
    squad.behavior = 'defend';
    squad.waypoints = [];
    squad.action = '防御';
    return true;
  }
  return false;
};

const skillRangeByClass = (classTag) => {
  if (classTag === 'cavalry') return 220;
  if (classTag === 'archer') return 260;
  if (classTag === 'artillery') return 310;
  return 180;
};

const applyInfantrySkill = (sim, squad, targetPoint) => {
  const dx = targetPoint.x - squad.x;
  const dy = targetPoint.y - squad.y;
  const dist = Math.hypot(dx, dy) || 1;
  const step = Math.min(120, dist);
  const moveTarget = {
    x: squad.x + ((dx / dist) * step),
    y: squad.y + ((dy / dist) * step)
  };
  squad.effectBuff = {
    type: 'infantry',
    ttl: 8,
    atkMul: 1.25,
    defMul: 1.3,
    speedMul: 0.75
  };
  squad.waypoints = [moveTarget];
  squad.behavior = 'move';
  squad.action = '兵种攻击';
  squad.skillUsedCount += 1;
};

const applyCavalrySkill = (sim, squad, targetPoint) => {
  const dx = targetPoint.x - squad.x;
  const dy = targetPoint.y - squad.y;
  const dist = Math.min(skillRangeByClass('cavalry'), Math.hypot(dx, dy));
  if (dist <= 1) return;
  const dir = { x: dx / dist, y: dy / dist };
  squad.charge = {
    ttl: 1.5,
    remainDistance: dist,
    dir,
    hitSet: new Set()
  };
  squad.stamina = Math.max(0, squad.stamina - 35);
  squad.action = '兵种攻击';
  squad.skillUsedCount += 1;
};

const applyArcherSkill = (sim, squad, targetPoint) => {
  const radius = 72;
  const enemies = getAliveSquads(sim, TEAM_DEFENDER);
  enemies.forEach((enemy) => {
    const d = Math.hypot(enemy.x - targetPoint.x, enemy.y - targetPoint.y);
    if (d > radius + enemy.radius) return;
    const falloff = 1 - clamp(d / (radius + enemy.radius), 0, 0.92);
    applyDamageToSquad(sim, squad, enemy, (24 + (squad.stats.atk * 0.85)) * (0.55 + falloff));
  });
  sim.effects.push({
    type: 'archer',
    x: targetPoint.x,
    y: targetPoint.y,
    radius,
    ttl: 0.62
  });
  squad.attackCooldown = Math.max(squad.attackCooldown, 1.9);
  squad.action = '兵种攻击';
  squad.skillUsedCount += 1;
};

const applyArtillerySkill = (sim, squad, targetPoint) => {
  const radius = 100;
  const enemies = getAliveSquads(sim, TEAM_DEFENDER);
  enemies.forEach((enemy) => {
    const d = Math.hypot(enemy.x - targetPoint.x, enemy.y - targetPoint.y);
    if (d > radius + enemy.radius) return;
    const falloff = 1 - clamp(d / (radius + enemy.radius), 0, 0.95);
    applyDamageToSquad(sim, squad, enemy, (38 + (squad.stats.atk * 1.1)) * (0.52 + falloff));
  });
  (sim.buildings || []).forEach((building) => {
    if (building.destroyed) return;
    const d = Math.hypot(building.x - targetPoint.x, building.y - targetPoint.y);
    if (d > radius + Math.max(building.width, building.depth) * 0.35) return;
    const falloff = 1 - clamp(d / (radius + 40), 0, 0.9);
    applyDamageToBuilding(sim, building, (56 + (squad.stats.atk * 1.45)) * (0.45 + falloff));
  });
  sim.effects.push({
    type: 'artillery',
    x: targetPoint.x,
    y: targetPoint.y,
    radius,
    ttl: 0.75
  });
  squad.attackCooldown = Math.max(squad.attackCooldown, 3.3);
  squad.action = '兵种攻击';
  squad.skillUsedCount += 1;
};

const triggerSquadSkill = (sim, squadId, worldPoint) => {
  const squad = findSquadById(sim, squadId);
  if (!squad || squad.team !== TEAM_ATTACKER || squad.remain <= 0) return { ok: false, reason: '部队不可用' };
  if (squad.morale <= 0) return { ok: false, reason: '士气归零，无法发动兵种攻击' };

  const maxRange = skillRangeByClass(squad.classTag);
  const dx = worldPoint.x - squad.x;
  const dy = worldPoint.y - squad.y;
  const dist = Math.hypot(dx, dy);
  const targetPoint = dist > maxRange
    ? { x: squad.x + ((dx / Math.max(1, dist)) * maxRange), y: squad.y + ((dy / Math.max(1, dist)) * maxRange) }
    : worldPoint;

  if (squad.classTag === 'cavalry') {
    applyCavalrySkill(sim, squad, targetPoint);
  } else if (squad.classTag === 'archer') {
    applyArcherSkill(sim, squad, targetPoint);
  } else if (squad.classTag === 'artillery') {
    applyArtillerySkill(sim, squad, targetPoint);
  } else {
    applyInfantrySkill(sim, squad, targetPoint);
  }

  return { ok: true };
};

const updateChargeState = (sim, squad, dt) => {
  if (!squad.charge || squad.remain <= 0) return;
  const moveSpeed = 145;
  const step = Math.min(squad.charge.remainDistance, moveSpeed * dt);
  const target = {
    x: squad.x + (squad.charge.dir.x * step),
    y: squad.y + (squad.charge.dir.y * step)
  };
  const moved = moveSquadWithCollision(squad, target, sim, 1);
  squad.charge.remainDistance = Math.max(0, squad.charge.remainDistance - moved);
  squad.charge.ttl -= dt;

  const enemies = getAliveSquads(sim, TEAM_DEFENDER);
  enemies.forEach((enemy) => {
    if (squad.charge.hitSet.has(enemy.id)) return;
    const d = Math.hypot(enemy.x - squad.x, enemy.y - squad.y);
    if (d > squad.radius + enemy.radius + 10) return;
    const vec = { x: enemy.x - squad.x, y: enemy.y - squad.y };
    const len = Math.hypot(vec.x, vec.y) || 1;
    const dot = ((vec.x / len) * squad.charge.dir.x) + ((vec.y / len) * squad.charge.dir.y);
    const angleBonus = dot > 0.45 ? 1.25 : 0.82;
    applyDamageToSquad(sim, squad, enemy, (squad.stats.atk * 1.9 + 24) * angleBonus);
    squad.charge.hitSet.add(enemy.id);
  });

  squad.action = '兵种攻击';
  if (squad.charge.ttl <= 0 || squad.charge.remainDistance <= 1) {
    squad.charge = null;
    squad.fatigueTimer = 3.5;
    squad.action = '待命';
  }
};

const buildSquadAttackPower = (squad, target, mode = 'normal') => {
  const ratio = clamp(squad.remain / Math.max(1, squad.startCount), 0, 1);
  let atk = squad.stats.atk * (0.52 + ratio * 0.78);
  let defMul = 1;

  if (squad.effectBuff) {
    atk *= squad.effectBuff.atkMul || 1;
    defMul = squad.effectBuff.defMul || 1;
  }

  if (mode === 'melee_penalty') {
    atk *= 0.58;
  }

  if (squad.classTag === 'cavalry' && mode === 'charge') {
    atk *= 1.5;
  }

  if (squad.behavior === 'defend') {
    atk *= 0.92;
  }

  if (target && target.effectBuff?.type === 'infantry') {
    atk *= 0.86;
  }

  const moraleMul = squad.morale <= 0 ? 0.62 : (0.72 + (squad.morale / 180));
  atk *= moraleMul;

  return {
    atk,
    defMul
  };
};

const updateSquadCombat = (sim, squad, dt) => {
  if (!squad || squad.remain <= 0) return;

  if (squad.effectBuff) {
    squad.effectBuff.ttl -= dt;
    if (squad.effectBuff.ttl <= 0) {
      squad.effectBuff = null;
    }
  }

  if (squad.fatigueTimer > 0) {
    squad.fatigueTimer = Math.max(0, squad.fatigueTimer - dt);
  }

  squad.attackCooldown = Math.max(0, squad.attackCooldown - dt);
  squad.underAttackTimer = Math.max(0, squad.underAttackTimer - dt);

  if (squad.charge) {
    updateChargeState(sim, squad, dt);
    return;
  }

  if (squad.behavior === 'retreat' && squad.waypoints.length === 0) {
    squad.waypoints = [deepClone(squad.rallyPoint)];
  }

  const hasWaypoints = squad.waypoints.length > 0;
  if (hasWaypoints && squad.stamina >= STAMINA_MOVE_THRESHOLD) {
    const nextWaypoint = squad.waypoints[0];
    squad.action = squad.behavior === 'retreat' ? '撤退' : '移动';
    const beforeX = squad.x;
    const beforeY = squad.y;
    moveSquadWithCollision(squad, nextWaypoint, sim, dt);
    const movedDistance = Math.hypot(squad.x - beforeX, squad.y - beforeY);
    if (movedDistance > 0.01) {
      squad.stamina = clamp(squad.stamina - (STAMINA_MOVE_COST * dt), 0, STAMINA_MAX);
    }
    if (Math.hypot(squad.x - nextWaypoint.x, squad.y - nextWaypoint.y) <= Math.max(6, squad.radius * 0.32)) {
      squad.waypoints.shift();
      if (squad.waypoints.length === 0 && squad.behavior === 'move') {
        squad.behavior = 'idle';
        squad.action = '待命';
      }
    }
  } else {
    if (hasWaypoints && squad.stamina < STAMINA_MOVE_THRESHOLD) {
      squad.waypoints = [];
      squad.action = '待命';
      squad.behavior = 'idle';
    }
    squad.stamina = clamp(squad.stamina + (STAMINA_RECOVER * dt), 0, STAMINA_MAX);
  }

  if (squad.behavior === 'retreat') {
    const rallyDist = Math.hypot(squad.x - squad.rallyPoint.x, squad.y - squad.rallyPoint.y);
    if (rallyDist <= 12) {
      squad.behavior = 'idle';
      squad.waypoints = [];
      squad.action = '待命';
    }
    return;
  }

  const nearest = findNearestEnemy(sim, squad);
  if (!nearest) return;

  const target = nearest.enemy;
  const dist = nearest.distance;
  const meleeDistance = squad.radius + target.radius + 6;
  const attackRange = Math.max(meleeDistance, squad.stats.range * 28);

  if (squad.behavior === 'idle') {
    if (squad.underAttackTimer > 0 && dist <= attackRange * 1.1) {
      squad.behavior = 'auto';
    } else {
      return;
    }
  }

  if (squad.behavior === 'defend' && dist > attackRange * 1.2) {
    return;
  }

  if ((squad.behavior === 'auto' || squad.behavior === 'defend') && squad.waypoints.length === 0) {
    if (squad.roleTag === '近战' && dist > meleeDistance) {
      const dirX = target.x - squad.x;
      const dirY = target.y - squad.y;
      const len = Math.hypot(dirX, dirY) || 1;
      const step = Math.max(0, dist - (meleeDistance * 0.78));
      issueSquadMove(sim, squad.id, {
        x: squad.x + ((dirX / len) * step),
        y: squad.y + ((dirY / len) * step)
      }, false, { allowAnyTeam: true });
    }
    if (squad.roleTag === '远程' && dist > attackRange * 0.94) {
      const dirX = target.x - squad.x;
      const dirY = target.y - squad.y;
      const len = Math.hypot(dirX, dirY) || 1;
      const step = Math.max(0, dist - (attackRange * 0.84));
      issueSquadMove(sim, squad.id, {
        x: squad.x + ((dirX / len) * step),
        y: squad.y + ((dirY / len) * step)
      }, false, { allowAnyTeam: true });
    }
  }

  if (squad.attackCooldown > 0) return;

  let canAttack = false;
  let damageMode = 'normal';
  if (squad.roleTag === '近战') {
    canAttack = dist <= meleeDistance;
  } else {
    if (dist <= meleeDistance) {
      canAttack = true;
      damageMode = 'melee_penalty';
    } else {
      canAttack = dist <= attackRange;
    }
  }

  if (!canAttack) return;

  const { atk } = buildSquadAttackPower(squad, target, damageMode);
  applyDamageToSquad(sim, squad, target, atk);

  if (squad.classTag === 'artillery') {
    const building = findNearestBuilding(sim, { x: target.x, y: target.y }, 90);
    if (building) {
      applyDamageToBuilding(sim, building, atk * 0.75);
    }
  }

  squad.action = squad.behavior === 'auto' ? '普通攻击' : squad.action;

  if (squad.classTag === 'artillery') {
    squad.attackCooldown = 2.2;
  } else if (squad.classTag === 'archer') {
    squad.attackCooldown = 1.15;
  } else if (squad.classTag === 'cavalry') {
    squad.attackCooldown = 1.0;
  } else {
    squad.attackCooldown = 0.85;
  }
};

const updateMoraleDecay = (sim, dt) => {
  (sim?.squads || []).forEach((squad) => {
    if (!squad || squad.remain <= 0) return;
    const inCombat = squad.underAttackTimer > 0 || squad.attackCooldown > 0;
    if (inCombat) {
      squad.morale = clamp(squad.morale - (0.32 * dt), 0, MORALE_MAX);
    } else {
      squad.morale = clamp(squad.morale - (0.9 * dt), 0, MORALE_MAX);
    }
  });
};

const updateSimulation = (sim, dt) => {
  if (!sim || sim.ended) return;
  sim.timerSec = Math.max(0, sim.timerSec - dt);

  sim.effects = (sim.effects || []).map((effect) => ({ ...effect, ttl: effect.ttl - dt })).filter((effect) => effect.ttl > 0);

  (sim.squads || []).forEach((squad) => updateSquadCombat(sim, squad, dt));
  updateMoraleDecay(sim, dt);

  const attackerAlive = getAliveSquads(sim, TEAM_ATTACKER).reduce((sum, squad) => sum + squad.remain, 0);
  const defenderAlive = getAliveSquads(sim, TEAM_DEFENDER).reduce((sum, squad) => sum + squad.remain, 0);
  if (sim.timerSec <= 0 || attackerAlive <= 0 || defenderAlive <= 0) {
    sim.ended = true;
    sim.endReason = sim.timerSec <= 0
      ? '时间到'
      : (attackerAlive <= 0 ? '我方全灭' : '守军全灭');
  }
};

const buildBattleSummary = (sim) => {
  const attackerSquads = (sim?.squads || []).filter((squad) => squad.team === TEAM_ATTACKER);
  const defenderSquads = (sim?.squads || []).filter((squad) => squad.team === TEAM_DEFENDER);

  const countStart = (rows) => rows.reduce((sum, row) => sum + Math.max(0, row.startCount || 0), 0);
  const countRemain = (rows) => rows.reduce((sum, row) => sum + Math.max(0, row.remain || 0), 0);
  const countKills = (rows) => rows.reduce((sum, row) => sum + Math.max(0, row.kills || 0), 0);

  const byUnitType = {};
  [...attackerSquads, ...defenderSquads].forEach((squad) => {
    const ratio = clamp((squad.remain || 0) / Math.max(1, squad.startCount || 1), 0, 1);
    Object.entries(squad.units || {}).forEach(([unitTypeId, count]) => {
      const start = Math.max(0, Math.floor(Number(count) || 0));
      const remain = Math.round(start * ratio);
      if (!byUnitType[unitTypeId]) {
        byUnitType[unitTypeId] = { start: 0, remain: 0, kills: 0 };
      }
      byUnitType[unitTypeId].start += start;
      byUnitType[unitTypeId].remain += remain;
      byUnitType[unitTypeId].kills += Math.max(0, squad.kills || 0);
    });
  });

  return {
    battleId: sim.battleId,
    gateKey: sim.gateKey,
    durationSec: Math.max(0, Math.floor(sim.timeLimitSec - sim.timerSec)),
    attacker: {
      start: countStart(attackerSquads),
      remain: countRemain(attackerSquads),
      kills: countKills(attackerSquads)
    },
    defender: {
      start: countStart(defenderSquads),
      remain: countRemain(defenderSquads),
      kills: countKills(defenderSquads)
    },
    details: {
      byUnitType,
      buildingsDestroyed: Math.max(0, Math.floor(sim.destroyedBuildings || 0))
    }
  };
};

const sampleCardData = (sim, selectedId, hoverId) => (sim?.squads || []).map((squad) => {
  const currentSoldiers = Math.ceil((squad.remain || 0) / Math.max(1, squad.unitsPerSoldier || 1));
  const maxSoldiers = Math.ceil((squad.startCount || 0) / Math.max(1, squad.unitsPerSoldier || 1));
  return {
    id: squad.id,
    team: squad.team,
    name: squad.name,
    classTag: squad.classTag,
    action: squad.action,
    remain: squad.remain,
    startCount: squad.startCount,
    currentSoldiers,
    maxSoldiers,
    stamina: clamp(squad.stamina, 0, STAMINA_MAX),
    morale: clamp(squad.morale, 0, MORALE_MAX),
    selected: squad.id === selectedId,
    hovered: squad.id === hoverId,
    alive: squad.remain > 0
  };
});

const drawRoundedRect = (ctx, x, y, width, height, radius = 8) => {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
};

const drawGround = (ctx, view, field, pitch, yaw) => {
  const corners = [
    { x: -field.width / 2, y: -field.height / 2, z: 0 },
    { x: field.width / 2, y: -field.height / 2, z: 0 },
    { x: field.width / 2, y: field.height / 2, z: 0 },
    { x: -field.width / 2, y: field.height / 2, z: 0 }
  ].map((point) => projectWorld(point.x, point.y, point.z, view.viewport, pitch, yaw, view.worldScale));

  ctx.save();
  ctx.beginPath();
  corners.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  const gradient = ctx.createLinearGradient(corners[0].x, corners[0].y, corners[2].x, corners[2].y);
  gradient.addColorStop(0, '#1b2a34');
  gradient.addColorStop(1, '#0f202d');
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const lineStep = 60;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  for (let x = -field.width / 2; x <= field.width / 2; x += lineStep) {
    const start = projectWorld(x, -field.height / 2, 0, view.viewport, pitch, yaw, view.worldScale);
    const end = projectWorld(x, field.height / 2, 0, view.viewport, pitch, yaw, view.worldScale);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  for (let y = -field.height / 2; y <= field.height / 2; y += lineStep) {
    const start = projectWorld(-field.width / 2, y, 0, view.viewport, pitch, yaw, view.worldScale);
    const end = projectWorld(field.width / 2, y, 0, view.viewport, pitch, yaw, view.worldScale);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.restore();
};

const drawDeployZones = (ctx, view, field, pitch, yaw) => {
  const deployRange = getDeployRange(field.width);
  const zones = [
    {
      minX: -field.width / 2,
      maxX: deployRange.attackerMaxX,
      color: 'rgba(248, 113, 113, 0.12)',
      stroke: 'rgba(248, 113, 113, 0.52)'
    },
    {
      minX: deployRange.defenderMinX,
      maxX: field.width / 2,
      color: 'rgba(14, 165, 233, 0.12)',
      stroke: 'rgba(56, 189, 248, 0.55)'
    }
  ];

  zones.forEach((zone) => {
    const points = [
      { x: zone.minX, y: -field.height / 2 },
      { x: zone.maxX, y: -field.height / 2 },
      { x: zone.maxX, y: field.height / 2 },
      { x: zone.minX, y: field.height / 2 }
    ].map((point) => projectWorld(point.x, point.y, 1, view.viewport, pitch, yaw, view.worldScale));
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = zone.color;
    ctx.fill();
    ctx.strokeStyle = zone.stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  });
};

const buildBuildingFaces = (building) => {
  const hw = building.width / 2;
  const hd = building.depth / 2;
  const baseZ = 0;
  const topZ = building.height;
  const widthAxis = rotate2D(1, 0, building.rotation || 0);
  const depthAxis = rotate2D(0, 1, building.rotation || 0);
  const signs = [
    { u: -1, v: -1 },
    { u: 1, v: -1 },
    { u: 1, v: 1 },
    { u: -1, v: 1 }
  ];
  const base = signs.map((sign) => ({
    x: building.x + (widthAxis.x * hw * sign.u) + (depthAxis.x * hd * sign.v),
    y: building.y + (widthAxis.y * hw * sign.u) + (depthAxis.y * hd * sign.v),
    z: baseZ
  }));
  const top = base.map((point) => ({ ...point, z: topZ }));
  return {
    top,
    sides: [
      [base[0], base[1], top[1], top[0]],
      [base[1], base[2], top[2], top[1]],
      [base[2], base[3], top[3], top[2]],
      [base[3], base[0], top[0], top[3]]
    ]
  };
};

const drawBuildings = (ctx, sim, view, pitch, yaw) => {
  const commands = [];
  (sim?.buildings || []).forEach((building) => {
    if (!building || building.destroyed) return;
    const faces = buildBuildingFaces(building);
    const topProjected = faces.top.map((point) => projectWorld(point.x, point.y, point.z, view.viewport, pitch, yaw, view.worldScale));
    const sideProjected = faces.sides.map((face) => face.map((point) => projectWorld(point.x, point.y, point.z, view.viewport, pitch, yaw, view.worldScale)));
    const topDepth = topProjected.reduce((sum, point) => sum + point.depth, 0) / topProjected.length;
    const shadeA = building.style?.baseColor || '#6b7280';
    const shadeB = building.style?.accentColor || '#374151';

    commands.push({
      depth: topDepth - 0.05,
      draw: () => {
        sideProjected.forEach((poly, index) => {
          ctx.beginPath();
          poly.forEach((point, pIndex) => {
            if (pIndex === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
          });
          ctx.closePath();
          const alpha = 0.35 + (index * 0.08);
          ctx.fillStyle = `rgba(100, 116, 139, ${alpha})`;
          ctx.fill();
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
        });

        ctx.beginPath();
        topProjected.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
        const topGradient = ctx.createLinearGradient(topProjected[0].x, topProjected[0].y, topProjected[2].x, topProjected[2].y);
        topGradient.addColorStop(0, shadeA);
        topGradient.addColorStop(1, shadeB);
        ctx.fillStyle = topGradient;
        ctx.fill();
        ctx.strokeStyle = 'rgba(203, 213, 225, 0.22)';
        ctx.lineWidth = 1;
        ctx.stroke();

        const center = projectWorld(building.x, building.y, building.height + 10, view.viewport, pitch, yaw, view.worldScale);
        const hpRatio = clamp(building.hp / Math.max(1, building.maxHp), 0, 1);
        drawRoundedRect(ctx, center.x - 20, center.y - 6, 40, 5, 4);
        ctx.fillStyle = 'rgba(2, 6, 23, 0.75)';
        ctx.fill();
        drawRoundedRect(ctx, center.x - 20, center.y - 6, 40 * hpRatio, 5, 4);
        ctx.fillStyle = hpRatio > 0.35 ? 'rgba(34, 197, 94, 0.92)' : 'rgba(239, 68, 68, 0.92)';
        ctx.fill();
      }
    });
  });

  commands.sort((a, b) => a.depth - b.depth);
  commands.forEach((cmd) => cmd.draw());
};

const drawEffects = (ctx, sim, view, pitch, yaw) => {
  (sim?.effects || []).forEach((effect) => {
    const center = projectWorld(effect.x, effect.y, 2, view.viewport, pitch, yaw, view.worldScale);
    const edge = projectWorld(effect.x + effect.radius, effect.y, 2, view.viewport, pitch, yaw, view.worldScale);
    const radiusPx = Math.max(7, Math.hypot(edge.x - center.x, edge.y - center.y) * 0.78);
    const alpha = clamp(effect.ttl / (effect.type === 'artillery' ? 0.75 : 0.62), 0.12, 0.72);

    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
    if (effect.type === 'artillery') {
      ctx.fillStyle = `rgba(248, 113, 113, ${alpha * 0.35})`;
      ctx.strokeStyle = `rgba(248, 113, 113, ${alpha})`;
    } else {
      ctx.fillStyle = `rgba(56, 189, 248, ${alpha * 0.28})`;
      ctx.strokeStyle = `rgba(125, 211, 252, ${alpha})`;
    }
    ctx.lineWidth = 1.4;
    ctx.fill();
    ctx.stroke();
  });
};

const drawFormationInstance = (ctx, projected, row, scale = 1, highlighted = false, ghost = false) => {
  const safeScale = clamp(scale, 0.1, 4);
  const alpha = ghost ? 0.45 : 1;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const shadowW = clamp((6.2 + projected.worldScale * 0.22) * safeScale, 3.4, 12.5);
  const shadowH = clamp((3.4 + projected.worldScale * 0.09) * safeScale, 2.0, 7.5);
  ctx.beginPath();
  ctx.ellipse(projected.x, projected.y + 2, shadowW, shadowH, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
  ctx.fill();

  const bodyH = clamp((9.6 + projected.worldScale * 0.2) * safeScale, 4.8, 13);
  const bodyW = clamp((6.3 + projected.worldScale * 0.14) * safeScale, 3.8, 9.8);
  if (row.category === 'cavalry') {
    ctx.beginPath();
    ctx.ellipse(projected.x, projected.y, bodyW * 0.92, bodyH * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = row.bodyColor || '#94a3b8';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(projected.x + (bodyW * 0.45), projected.y - (bodyH * 0.12));
    ctx.lineTo(projected.x + (bodyW * 1.35), projected.y - (bodyH * 0.38));
    ctx.strokeStyle = row.accentColor || '#dbeafe';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else if (row.category === 'artillery') {
    ctx.beginPath();
    ctx.rect(projected.x - bodyW * 0.58, projected.y - bodyH * 0.45, bodyW * 1.16, bodyH * 0.9);
    ctx.fillStyle = row.bodyColor || '#94a3b8';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(projected.x + (bodyW * 0.18), projected.y - (bodyH * 0.12));
    ctx.lineTo(projected.x + (bodyW * 0.92), projected.y - (bodyH * 0.38));
    ctx.strokeStyle = row.accentColor || '#dbeafe';
    ctx.lineWidth = 1.3;
    ctx.stroke();
  } else if (row.category === 'archer') {
    ctx.beginPath();
    ctx.ellipse(projected.x, projected.y, bodyW * 0.62, bodyH * 0.56, 0, 0, Math.PI * 2);
    ctx.fillStyle = row.bodyColor || '#94a3b8';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(projected.x + (bodyW * 0.42), projected.y - (bodyH * 0.05), bodyW * 0.36, -Math.PI * 0.3, Math.PI * 0.78);
    ctx.strokeStyle = row.accentColor || '#dbeafe';
    ctx.lineWidth = 1.1;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(projected.x, projected.y - bodyH * 0.72);
    ctx.lineTo(projected.x + bodyW * 0.55, projected.y + bodyH * 0.24);
    ctx.lineTo(projected.x - bodyW * 0.55, projected.y + bodyH * 0.24);
    ctx.closePath();
    ctx.fillStyle = row.bodyColor || '#94a3b8';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(projected.x, projected.y - (bodyH * 0.52), bodyW * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = row.accentColor || '#dbeafe';
  ctx.fill();

  if (highlighted) {
    ctx.beginPath();
    ctx.ellipse(projected.x, projected.y, bodyW * 1.02, bodyH * 0.9, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.96)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
};

const drawSquads = (ctx, sim, view, pitch, yaw, zoomValue, selectedId, hoverId, resolveFormationState) => {
  const drawRows = [];
  let selectedFlag = null;
  const cameraState = buildFormationCameraState(view, pitch, yaw, {
    renderBudget: resolveFormationBudgetByZoom(zoomValue),
    shape: 'grid'
  });

  (sim?.squads || []).forEach((squad) => {
    if (!squad || squad.remain <= 0) return;
    const isSelected = selectedId === squad.id;
    const isHover = hoverId === squad.id;
    const liveCountsByType = distributeUnitsByRatio(squad.units || {}, squad.remain || 0, squad.startCount || 0);
    const formationState = typeof resolveFormationState === 'function'
      ? resolveFormationState({
        key: `battle_${squad.id}`,
        teamId: squad.team,
        countsByType: liveCountsByType,
        cameraState
      })
      : null;
    if (!formationState) return;
    formationState.isHighlighted = isSelected || isHover;
    formationState.isGhost = false;
    const rendered = renderFormation(
      formationState,
      {
        kind: 'descriptors',
        center: { x: squad.x, y: squad.y }
      },
      cameraState,
      0
    );
    const footprint = rendered?.footprint || { radius: squad.radius || 20 };
    const rawRadius = Math.max(10, Number(footprint.radius) || squad.radius || 20);
    const targetRadius = resolveScaledFormationRadius(rawRadius, squad.remain || squad.startCount || 1);
    const clusterScale = resolveClusterScale(targetRadius, rawRadius);
    squad.radius = clamp(targetRadius, 9, 108);

    (rendered?.instances || []).forEach((row) => {
      const sx = squad.x + ((row.x - squad.x) * clusterScale);
      const sy = squad.y + ((row.y - squad.y) * clusterScale);
      const projected = projectWorld(sx, sy, 0, view.viewport, pitch, yaw, view.worldScale);
      drawRows.push({
        depth: projected.depth,
        draw: () => {
          drawFormationInstance(ctx, {
            ...projected,
            worldScale: view.worldScale
          }, row, SOLDIER_VISUAL_SCALE, isSelected || isHover, false);
        }
      });
    });

    const center = projectWorld(squad.x, squad.y, 0.2, view.viewport, pitch, yaw, view.worldScale);
    const edge = projectWorld(squad.x + squad.radius, squad.y, 0.2, view.viewport, pitch, yaw, view.worldScale);
    const radiusPx = Math.max(7, Math.hypot(edge.x - center.x, edge.y - center.y) * 0.78);
    drawRows.push({
      depth: center.depth - 0.02,
      draw: () => {
        ctx.beginPath();
        ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(125, 211, 252, 0.2)';
        ctx.fill();
        ctx.strokeStyle = isSelected ? 'rgba(186, 230, 253, 0.92)' : 'rgba(125, 211, 252, 0.58)';
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.stroke();
      }
    });

    const flagAnchor = projectWorld(squad.x, squad.y, 22, view.viewport, pitch, yaw, view.worldScale);
    drawRows.push({
      depth: flagAnchor.depth + 0.02,
      draw: () => {
        const hpRatio = clamp(squad.health / Math.max(1, squad.maxHealth), 0, 1);
        const moraleRatio = clamp(squad.morale / MORALE_MAX, 0, 1);

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.65)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(flagAnchor.x, flagAnchor.y + 14);
        ctx.lineTo(flagAnchor.x, flagAnchor.y - 24);
        ctx.stroke();

        ctx.globalAlpha = 0.52;
        ctx.fillStyle = squad.team === TEAM_ATTACKER ? 'rgba(252, 165, 165, 0.78)' : 'rgba(186, 230, 253, 0.78)';
        ctx.beginPath();
        ctx.moveTo(flagAnchor.x + 1, flagAnchor.y - 23);
        ctx.lineTo(flagAnchor.x + 18, flagAnchor.y - 18);
        ctx.lineTo(flagAnchor.x + 1, flagAnchor.y - 14);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;

        drawRoundedRect(ctx, flagAnchor.x - 16, flagAnchor.y - 34, 32, 4, 3);
        ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
        ctx.fill();
        drawRoundedRect(ctx, flagAnchor.x - 16, flagAnchor.y - 34, 32 * hpRatio, 4, 3);
        ctx.fillStyle = hpRatio > 0.35 ? '#22c55e' : '#ef4444';
        ctx.fill();

        drawRoundedRect(ctx, flagAnchor.x - 16, flagAnchor.y - 29, 32, 3, 3);
        ctx.fillStyle = 'rgba(2, 6, 23, 0.75)';
        ctx.fill();
        drawRoundedRect(ctx, flagAnchor.x - 16, flagAnchor.y - 29, 32 * moraleRatio, 3, 3);
        ctx.fillStyle = '#38bdf8';
        ctx.fill();
      }
    });

    if (selectedId === squad.id) {
      selectedFlag = { x: flagAnchor.x, y: flagAnchor.y };
    }
  });

  drawRows.sort((a, b) => a.depth - b.depth);
  drawRows.forEach((item) => item.draw());
  return selectedFlag;
};

const buildSkillAimOverlay = (sim, selectedSquad, aimWorld, view, pitch, yaw) => {
  if (!selectedSquad || !aimWorld) return null;
  const maxRange = skillRangeByClass(selectedSquad.classTag);
  const vec = { x: aimWorld.x - selectedSquad.x, y: aimWorld.y - selectedSquad.y };
  const dist = Math.hypot(vec.x, vec.y) || 1;
  const targetPoint = dist > maxRange
    ? { x: selectedSquad.x + ((vec.x / dist) * maxRange), y: selectedSquad.y + ((vec.y / dist) * maxRange) }
    : aimWorld;

  const originScreen = projectWorld(selectedSquad.x, selectedSquad.y, 12, view.viewport, pitch, yaw, view.worldScale);
  const targetScreen = projectWorld(targetPoint.x, targetPoint.y, 0, view.viewport, pitch, yaw, view.worldScale);

  if (selectedSquad.classTag === 'archer') {
    const points = [];
    const radius = 72;
    const sampleCount = 24;
    for (let i = 0; i < sampleCount; i += 1) {
      const angle = (i / sampleCount) * Math.PI * 2;
      const raw = {
        x: targetPoint.x + (Math.cos(angle) * radius),
        y: targetPoint.y + (Math.sin(angle) * radius)
      };
      let clipped = raw;
      for (const building of (sim?.buildings || [])) {
        if (building.destroyed) continue;
        const hit = lineIntersectsRotatedRect({ x: selectedSquad.x, y: selectedSquad.y }, raw, building);
        if (hit && hit.t >= 0 && hit.t <= 1) {
          clipped = {
            x: selectedSquad.x + ((raw.x - selectedSquad.x) * Math.max(0, hit.t - 0.03)),
            y: selectedSquad.y + ((raw.y - selectedSquad.y) * Math.max(0, hit.t - 0.03))
          };
          break;
        }
      }
      points.push(projectWorld(clipped.x, clipped.y, 1, view.viewport, pitch, yaw, view.worldScale));
    }
    return {
      targetPoint,
      originScreen,
      targetScreen,
      clippedArea: points,
      arcHeight: clamp(90 - (dist * 0.18), 24, 78),
      type: selectedSquad.classTag
    };
  }

  return {
    targetPoint,
    originScreen,
    targetScreen,
    arcHeight: selectedSquad.classTag === 'artillery'
      ? clamp(26 - (dist * 0.05), 8, 28)
      : clamp(70 - (dist * 0.2), 16, 62),
    type: selectedSquad.classTag
  };
};

const drawSkillAimOverlay = (ctx, overlay) => {
  if (!overlay) return;
  const { originScreen, targetScreen } = overlay;
  const midX = (originScreen.x + targetScreen.x) / 2;
  const midY = Math.min(originScreen.y, targetScreen.y) - overlay.arcHeight;

  ctx.save();
  ctx.strokeStyle = overlay.type === 'artillery' ? 'rgba(248, 113, 113, 0.95)' : 'rgba(125, 211, 252, 0.95)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(originScreen.x, originScreen.y);
  ctx.quadraticCurveTo(midX, midY, targetScreen.x, targetScreen.y);
  ctx.stroke();
  ctx.setLineDash([]);

  if (overlay.clippedArea && overlay.clippedArea.length > 2) {
    ctx.beginPath();
    overlay.clippedArea.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.7)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(targetScreen.x, targetScreen.y, overlay.type === 'artillery' ? 34 : 30, 0, Math.PI * 2);
    ctx.fillStyle = overlay.type === 'artillery' ? 'rgba(248, 113, 113, 0.18)' : 'rgba(56, 189, 248, 0.18)';
    ctx.strokeStyle = overlay.type === 'artillery' ? 'rgba(248, 113, 113, 0.78)' : 'rgba(125, 211, 252, 0.78)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
};

const drawComposeGroups = (ctx, groups, view, pitch, yaw, zoomValue, selectedGroupId, team, resolveFormationState) => {
  const selectedFill = team === TEAM_DEFENDER ? 'rgba(34, 211, 238, 0.35)' : 'rgba(248, 113, 113, 0.35)';
  const normalFill = team === TEAM_DEFENDER ? 'rgba(14, 165, 233, 0.2)' : 'rgba(239, 68, 68, 0.2)';
  const selectedStroke = team === TEAM_DEFENDER ? 'rgba(103, 232, 249, 0.95)' : 'rgba(254, 202, 202, 0.95)';
  const normalStroke = team === TEAM_DEFENDER ? 'rgba(125, 211, 252, 0.65)' : 'rgba(252, 165, 165, 0.65)';
  const labelColor = team === TEAM_DEFENDER ? '#dbeafe' : '#fee2e2';
  const cameraState = buildFormationCameraState(view, pitch, yaw, {
    renderBudget: resolveFormationBudgetByZoom(zoomValue),
    shape: 'grid'
  });
  let selectedAnchor = null;

  (Array.isArray(groups) ? groups : []).forEach((group) => {
    if (!group?.placed) return;
    const count = Math.max(1, sumUnitsMap(group.units));
    const groupKey = `${team}_compose_${group.id}`;
    const formationState = typeof resolveFormationState === 'function'
      ? resolveFormationState({
        key: groupKey,
        teamId: team,
        countsByType: group.units || {},
        cameraState
      })
      : null;
    if (!formationState) return;
    const isSelected = selectedGroupId === group.id;
    formationState.isHighlighted = isSelected;
    formationState.isGhost = false;
    const rendered = renderFormation(
      formationState,
      {
        kind: 'descriptors',
        center: { x: group.x, y: group.y }
      },
      cameraState,
      0
    );
    const footprint = rendered?.footprint || { radius: 20 };
    const rawRadius = Math.max(10, Number(footprint.radius) || 20);
    const radius = clamp(resolveScaledFormationRadius(rawRadius, count), 9, 108);
    const clusterScale = resolveClusterScale(radius, rawRadius);
    const center = projectWorld(group.x, group.y, 0, view.viewport, pitch, yaw, view.worldScale);
    const edge = projectWorld(group.x + radius, group.y, 0, view.viewport, pitch, yaw, view.worldScale);
    const radiusPx = Math.max(8, Math.hypot(edge.x - center.x, edge.y - center.y) * 0.78);

    const drawRows = [];
    (rendered?.instances || []).forEach((row) => {
      const sx = group.x + ((row.x - group.x) * clusterScale);
      const sy = group.y + ((row.y - group.y) * clusterScale);
      const projected = projectWorld(sx, sy, 0, view.viewport, pitch, yaw, view.worldScale);
      drawRows.push({
        depth: projected.depth,
        draw: () => drawFormationInstance(ctx, {
          ...projected,
          worldScale: view.worldScale
        }, row, COMPOSE_SOLDIER_VISUAL_SCALE, isSelected, false)
      });
    });
    drawRows.sort((a, b) => a.depth - b.depth);
    drawRows.forEach((item) => item.draw());

    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? selectedFill : normalFill;
    ctx.fill();
    ctx.strokeStyle = isSelected ? selectedStroke : normalStroke;
    ctx.lineWidth = isSelected ? 1.8 : 1;
    ctx.stroke();

    ctx.fillStyle = labelColor;
    ctx.font = '11px sans-serif';
    const label = `${group.name} (${count})`;
    const textW = ctx.measureText(label).width;
    drawRoundedRect(ctx, center.x - (textW / 2) - 6, center.y - radiusPx - 20, textW + 12, 16, 7);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
    ctx.fill();
    ctx.fillStyle = labelColor;
    ctx.fillText(label, center.x - (textW / 2), center.y - radiusPx - 8);

    if (isSelected) {
      selectedAnchor = {
        groupId: group.id,
        x: center.x,
        y: center.y - radiusPx - 10
      };
    }
  });
  return {
    selectedAnchor
  };
};

const drawComposeGhost = (ctx, group, ghostPoint, view, pitch, yaw, zoomValue, team, resolveFormationState) => {
  if (!group || !ghostPoint) return;
  const cameraState = buildFormationCameraState(view, pitch, yaw, {
    renderBudget: resolveFormationBudgetByZoom(zoomValue),
    shape: 'grid'
  });
  const state = typeof resolveFormationState === 'function'
    ? resolveFormationState({
      key: `${team}_compose_ghost_${group.id}`,
      teamId: team,
      countsByType: group.units || {},
      cameraState,
      highlighted: false,
      ghost: true
    })
    : null;
  if (!state) return;
  const rendered = renderFormation(
    state,
    {
      kind: 'descriptors',
      center: { x: ghostPoint.x, y: ghostPoint.y }
    },
    cameraState,
    0
  );
  const footprint = rendered?.footprint || { radius: 20 };
  const totalCount = Math.max(1, sumUnitsMap(group.units || {}));
  const rawRadius = Math.max(10, Number(footprint.radius) || 20);
  const scaledRadius = clamp(resolveScaledFormationRadius(rawRadius, totalCount), 9, 108);
  const clusterScale = resolveClusterScale(scaledRadius, rawRadius);
  const drawRows = [];
  (rendered?.instances || []).forEach((row) => {
    const sx = ghostPoint.x + ((row.x - ghostPoint.x) * clusterScale);
    const sy = ghostPoint.y + ((row.y - ghostPoint.y) * clusterScale);
    const projected = projectWorld(sx, sy, 0, view.viewport, pitch, yaw, view.worldScale);
    drawRows.push({
      depth: projected.depth,
      draw: () => drawFormationInstance(ctx, {
        ...projected,
        worldScale: view.worldScale
      }, row, COMPOSE_SOLDIER_VISUAL_SCALE, false, true)
    });
  });
  drawRows.sort((a, b) => a.depth - b.depth);
  drawRows.forEach((item) => item.draw());

  const center = projectWorld(ghostPoint.x, ghostPoint.y, 0.2, view.viewport, pitch, yaw, view.worldScale);
  const edge = projectWorld(ghostPoint.x + scaledRadius, ghostPoint.y, 0.2, view.viewport, pitch, yaw, view.worldScale);
  const radiusPx = Math.max(7, Math.hypot(edge.x - center.x, edge.y - center.y) * 0.78);
  ctx.beginPath();
  ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = ghostPoint.blocked ? 'rgba(248, 113, 113, 0.14)' : 'rgba(125, 211, 252, 0.14)';
  ctx.fill();
  ctx.strokeStyle = ghostPoint.blocked ? 'rgba(248, 113, 113, 0.82)' : 'rgba(125, 211, 252, 0.8)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
};

const PveBattleModal = ({
  open = false,
  loading = false,
  error = '',
  battleInitData = null,
  onClose,
  onBattleFinished
}) => {
  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const selectedSquadIdRef = useRef('');
  const hoverSquadIdRef = useRef('');
  const mouseWorldRef = useRef({ x: 0, y: 0 });
  const lastCardSyncRef = useRef(0);
  const middleDragRef = useRef(null);
  const rightDragRef = useRef(null);
  const composePanDragRef = useRef(null);
  const composeRotateDragRef = useRef(null);
  const spacePressedRef = useRef(false);
  const panWorldRef = useRef({ x: 0, y: 0 });
  const composeDragUnitTypeRef = useRef('');
  const leftDownRef = useRef(false);
  const edgeWarnShownRef = useRef(false);
  const formationStateRef = useRef(new Map());
  const composeGhostRef = useRef(null);

  const [phase, setPhase] = useState('compose');
  const [composeGroups, setComposeGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [activeComposeMoveId, setActiveComposeMoveId] = useState('');
  const [cameraPitch, setCameraPitch] = useState(DEFAULT_PITCH);
  const [cameraYaw, setCameraYaw] = useState(DEFAULT_YAW);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [isPanning, setIsPanning] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [selectedSquadId, setSelectedSquadId] = useState('');
  const [hoverSquadId, setHoverSquadId] = useState('');
  const [cardRows, setCardRows] = useState([]);
  const [battleTimerSec, setBattleTimerSec] = useState(DEFAULT_TIME_LIMIT);
  const [toast, setToast] = useState('');
  const [pendingSkill, setPendingSkill] = useState(null);
  const [floatingActionsPos, setFloatingActionsPos] = useState(null);
  const [composeGroupActionsPos, setComposeGroupActionsPos] = useState(null);
  const [battleResult, setBattleResult] = useState(null);
  const [postingResult, setPostingResult] = useState(false);
  const [resultSaveError, setResultSaveError] = useState('');
  const [composeEditorOpen, setComposeEditorOpen] = useState(false);
  const [composeEditorTargetGroupId, setComposeEditorTargetGroupId] = useState('');
  const [composeEditorDraft, setComposeEditorDraft] = useState({ name: '', sortOrder: 1, units: {} });
  const [composeEditorDropActive, setComposeEditorDropActive] = useState(false);
  const [composeQuantityDialog, setComposeQuantityDialog] = useState({
    open: false,
    mode: 'add',
    unitTypeId: '',
    unitName: '',
    max: 1,
    current: 1
  });

  const unitTypeMap = useMemo(() => buildUnitTypeMap(battleInitData?.unitTypes || []), [battleInitData?.unitTypes]);
  const formationUnitTypes = useMemo(() => Array.from(unitTypeMap.values()), [unitTypeMap]);
  const fieldSize = useMemo(() => computeFieldSize(battleInitData?.battlefield || {}), [battleInitData?.battlefield]);
  const unitsPerSoldier = Math.max(1, Math.floor(Number(battleInitData?.unitsPerSoldier) || UNITS_PER_SOLDIER_FALLBACK));

  const resolveFormationState = useCallback(({
    key = '',
    teamId = TEAM_ATTACKER,
    countsByType = {},
    cameraState = {},
    highlighted = false,
    ghost = false
  } = {}) => {
    const safeKey = typeof key === 'string' ? key.trim() : '';
    if (!safeKey) return null;
    const cache = formationStateRef.current;
    const nextCameraState = {
      ...cameraState,
      unitTypes: formationUnitTypes
    };
    let state = cache.get(safeKey);
    if (!state) {
      state = createFormationVisualState({
        teamId,
        formationId: safeKey,
        countsByType,
        unitTypes: formationUnitTypes,
        cameraState: nextCameraState
      });
      cache.set(safeKey, state);
    } else {
      state.teamId = teamId;
      reconcileCounts(state, countsByType, nextCameraState, Date.now());
    }
    state.isHighlighted = !!highlighted;
    state.isGhost = !!ghost;
    return state;
  }, [formationUnitTypes]);

  const resolveGroupFootprint = useCallback((group, teamId = TEAM_ATTACKER) => {
    if (!group) return { radius: 16, width: 24, depth: 24 };
    const totalUnits = Math.max(1, sumUnitsMap(group.units || {}));
    const state = resolveFormationState({
      key: `${teamId}_compose_fp_${group.id}`,
      teamId,
      countsByType: group.units || {},
      cameraState: {
        worldScale: 1,
        distance: 980,
        renderBudget: FORMATION_METRIC_BUDGET,
        shape: 'grid'
      },
      highlighted: false,
      ghost: false
    });
    const rawFootprint = getFormationFootprint(state);
    const scaleByCount = resolveFormationFootprintScaleByCount(totalUnits);
    const rawRadius = Math.max(10, Number(rawFootprint?.radius || 16));
    return {
      radius: resolveScaledFormationRadius(rawRadius, totalUnits),
      width: Math.max(12, Number(rawFootprint?.width || 24) * scaleByCount),
      depth: Math.max(12, Number(rawFootprint?.depth || 24) * scaleByCount)
    };
  }, [resolveFormationState]);

  const defenderComposeGroups = useMemo(() => (
    buildDefenderGroupsFromDeployments(
      battleInitData?.defender?.units || [],
      battleInitData?.battlefield?.defenderDeployments || [],
      fieldSize.width,
      fieldSize.height
    )
  ), [battleInitData?.battlefield?.defenderDeployments, battleInitData?.defender?.units, fieldSize.width, fieldSize.height]);

  const remainingPool = useMemo(
    () => buildRemainingPool(battleInitData?.attacker?.units || [], composeGroups),
    [battleInitData?.attacker?.units, composeGroups]
  );

  const canStartBattle = useMemo(() => (
    composeGroups.length > 0
    && composeGroups.some((group) => sumUnitsMap(group.units) > 0)
    && composeGroups
      .filter((group) => sumUnitsMap(group.units) > 0)
      .every((group) => group.placed)
  ), [composeGroups]);

  const showToast = useCallback((message) => {
    if (!message) return;
    setToast(message);
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      setToast('');
    }, 2200);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(showToast.timer);
  }, [showToast]);

  useEffect(() => {
    if (!open || !battleInitData) {
      setPhase('compose');
      setComposeGroups([]);
      setSelectedGroupId('');
      setActiveComposeMoveId('');
      setSelectedSquadId('');
      selectedSquadIdRef.current = '';
      simRef.current = null;
      setBattleResult(null);
      setPostingResult(false);
      setResultSaveError('');
      setPendingSkill(null);
      setFloatingActionsPos(null);
      setComposeGroupActionsPos(null);
      composeGhostRef.current = null;
      formationStateRef.current = new Map();
      setComposeEditorOpen(false);
      setComposeEditorTargetGroupId('');
      setComposeEditorDraft({ name: '', sortOrder: 1, units: {} });
      setComposeEditorDropActive(false);
      setComposeQuantityDialog({
        open: false,
        mode: 'add',
        unitTypeId: '',
        unitName: '',
        max: 1,
        current: 1
      });
      composePanDragRef.current = null;
      composeRotateDragRef.current = null;
      composeDragUnitTypeRef.current = '';
      panWorldRef.current = { x: 0, y: 0 };
      setZoom(DEFAULT_ZOOM);
      setIsPanning(false);
      setIsRotating(false);
      return;
    }

    const nextGroups = buildInitialComposeGroups(battleInitData?.attacker?.units || []);
    setComposeGroups(nextGroups);
    setSelectedGroupId(nextGroups[0]?.id || '');
    setActiveComposeMoveId('');
    setSelectedSquadId('');
    selectedSquadIdRef.current = '';
    setPhase('compose');
    setBattleResult(null);
    setPostingResult(false);
    setResultSaveError('');
    setPendingSkill(null);
    setComposeGroupActionsPos(null);
    setComposeEditorOpen(false);
    setComposeEditorTargetGroupId('');
    setComposeEditorDraft({ name: '', sortOrder: 1, units: {} });
    setComposeEditorDropActive(false);
    setComposeQuantityDialog({
      open: false,
      mode: 'add',
      unitTypeId: '',
      unitName: '',
      max: 1,
      current: 1
    });
    setBattleTimerSec(Math.max(30, Math.floor(Number(battleInitData?.timeLimitSec) || DEFAULT_TIME_LIMIT)));
    setCameraPitch(DEFAULT_PITCH);
    setCameraYaw(DEFAULT_YAW);
    setZoom(DEFAULT_ZOOM);
    panWorldRef.current = { x: 0, y: 0 };
    setIsPanning(false);
    setIsRotating(false);
    composePanDragRef.current = null;
    composeRotateDragRef.current = null;
    composeDragUnitTypeRef.current = '';
    edgeWarnShownRef.current = false;
    composeGhostRef.current = null;
    formationStateRef.current = new Map();
  }, [open, battleInitData]);

  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.code === 'Space') {
        spacePressedRef.current = true;
      }
    };
    const onKeyUp = (event) => {
      if (event.code === 'Space') {
        spacePressedRef.current = false;
      }
    };
    const onBlur = () => {
      spacePressedRef.current = false;
      composePanDragRef.current = null;
      composeRotateDragRef.current = null;
      setIsPanning(false);
      setIsRotating(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  useEffect(() => {
    selectedSquadIdRef.current = selectedSquadId;
  }, [selectedSquadId]);

  useEffect(() => {
    hoverSquadIdRef.current = hoverSquadId;
  }, [hoverSquadId]);

  const syncCardRowsFromSim = useCallback((sim) => {
    if (!sim) {
      setCardRows([]);
      return;
    }
    setCardRows(sampleCardData(sim, selectedSquadIdRef.current, hoverSquadIdRef.current));
    setBattleTimerSec(sim.timerSec);
  }, []);

  const saveBattleResult = useCallback(async (summary) => {
    if (!battleInitData?.nodeId || !summary) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    setPostingResult(true);
    setResultSaveError('');
    try {
      const response = await fetch(`${API_BASE}/api/nodes/${battleInitData.nodeId}/siege/pve/battle-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...summary,
          startedAt: battleInitData?.serverTime || null
        })
      });
      const raw = await response.text();
      let parsed = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch (e) {
        parsed = null;
      }
      if (!response.ok) {
        setResultSaveError(parsed?.error || `战斗结果保存失败（HTTP ${response.status}）`);
      } else {
        setResultSaveError('');
        if (typeof onBattleFinished === 'function') {
          onBattleFinished();
        }
      }
    } catch (err) {
      setResultSaveError(`战斗结果保存失败: ${err.message}`);
    } finally {
      setPostingResult(false);
    }
  }, [battleInitData?.nodeId, battleInitData?.serverTime, onBattleFinished]);

  const startBattle = useCallback(() => {
    if (!battleInitData) return;
    if (!canStartBattle) {
      showToast('请先完成编组与放置');
      return;
    }

    const orderedComposeGroups = sortComposeGroups(composeGroups);
    const attackerSquads = orderedComposeGroups.map((group, index) => createSquadEntity({
      group,
      team: TEAM_ATTACKER,
      index,
      unitTypeMap,
      unitsPerSoldier,
      fieldWidth: fieldSize.width,
      initialRadius: resolveGroupFootprint(group, TEAM_ATTACKER)?.radius
    })).filter((squad) => squad.startCount > 0);

    const defenderSquads = defenderComposeGroups.map((group, index) => createSquadEntity({
      group,
      team: TEAM_DEFENDER,
      index,
      unitTypeMap,
      unitsPerSoldier,
      fieldWidth: fieldSize.width,
      initialRadius: resolveGroupFootprint(group, TEAM_DEFENDER)?.radius
    })).filter((squad) => squad.startCount > 0);

    const sim = {
      battleId: battleInitData?.battleId || `battle_${Date.now()}`,
      nodeId: battleInitData?.nodeId || '',
      gateKey: battleInitData?.gateKey || '',
      field: {
        width: fieldSize.width,
        height: fieldSize.height
      },
      squads: [...attackerSquads, ...defenderSquads],
      buildings: buildObstacleList(battleInitData?.battlefield || {}),
      effects: [],
      timerSec: Math.max(30, Math.floor(Number(battleInitData?.timeLimitSec) || DEFAULT_TIME_LIMIT)),
      timeLimitSec: Math.max(30, Math.floor(Number(battleInitData?.timeLimitSec) || DEFAULT_TIME_LIMIT)),
      ended: false,
      endReason: '',
      destroyedBuildings: 0
    };
    sim.squads.forEach((squad) => {
      if (squad.team === TEAM_DEFENDER) {
        squad.behavior = 'auto';
        squad.action = '自动攻击';
      }
    });

    simRef.current = sim;

    const firstSelectable = sim.squads.find((squad) => squad.team === TEAM_ATTACKER && squad.remain > 0);
    setSelectedSquadId(firstSelectable?.id || '');
    selectedSquadIdRef.current = firstSelectable?.id || '';
    setHoverSquadId('');
    setPendingSkill(null);
    setComposeGroupActionsPos(null);
    setBattleResult(null);
    setResultSaveError('');
    setActiveComposeMoveId('');
    setPhase('battle');
    syncCardRowsFromSim(sim);
  }, [battleInitData, canStartBattle, composeGroups, defenderComposeGroups, fieldSize.height, fieldSize.width, resolveGroupFootprint, syncCardRowsFromSim, unitTypeMap, unitsPerSoldier, showToast]);

  const finishBattleIfNeeded = useCallback((sim) => {
    if (!sim || !sim.ended || battleResult) return;
    const summary = buildBattleSummary(sim);
    setBattleResult({
      ...summary,
      endReason: sim.endReason || '战斗结束'
    });
    setPendingSkill(null);
    setFloatingActionsPos(null);
    saveBattleResult(summary);
  }, [battleResult, saveBattleResult]);

  const getCanvasWorldPoint = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const { viewport, worldScale } = getViewport(
      canvas,
      fieldSize.width,
      fieldSize.height,
      cameraPitch,
      cameraYaw,
      zoom,
      panWorldRef.current
    );
    return unprojectScreen(sx, sy, viewport, cameraPitch, cameraYaw, worldScale);
  }, [cameraPitch, cameraYaw, fieldSize.height, fieldSize.width, zoom]);

  const pickAttackerGroupByPoint = useCallback((worldPoint) => {
    let best = null;
    let bestDist = Infinity;
    composeGroups.forEach((group) => {
      if (!group.placed) return;
      const footprint = resolveGroupFootprint(group, TEAM_ATTACKER);
      const radius = clamp(Number(footprint?.radius) || 20, 9, 108);
      const dist = Math.hypot((group.x || 0) - worldPoint.x, (group.y || 0) - worldPoint.y);
      if (dist <= (radius * 0.95) && dist < bestDist) {
        bestDist = dist;
        best = group;
      }
    });
    return best;
  }, [composeGroups, resolveGroupFootprint]);

  const pickAttackerSquadByPoint = useCallback((worldPoint) => {
    const sim = simRef.current;
    if (!sim) return null;
    const squads = sim.squads.filter((squad) => squad.team === TEAM_ATTACKER && squad.remain > 0);
    let best = null;
    let bestDist = Infinity;
    squads.forEach((squad) => {
      const dist = Math.hypot(squad.x - worldPoint.x, squad.y - worldPoint.y);
      if (dist <= squad.radius * 0.95 && dist < bestDist) {
        bestDist = dist;
        best = squad;
      }
    });
    return best;
  }, []);

  const startComposePanDrag = useCallback((event, startScreen, buttonMask = 1) => {
    const canvas = canvasRef.current;
    if (!canvas || !startScreen) return;
    event.preventDefault();
    const startPan = panWorldRef.current;
    composePanDragRef.current = {
      startScreenX: Number(startScreen.x) || 0,
      startScreenY: Number(startScreen.y) || 0,
      startPanX: Number(startPan?.x) || 0,
      startPanY: Number(startPan?.y) || 0,
      buttonMask
    };
    setIsPanning(true);
  }, []);

  const updateComposePanByScreenPoints = useCallback((startScreen, currentScreen, startPan) => {
    const canvas = canvasRef.current;
    if (!canvas) return startPan;
    const basePan = startPan || { x: 0, y: 0 };
    const viewportWithStartPan = getViewport(
      canvas,
      fieldSize.width,
      fieldSize.height,
      cameraPitch,
      cameraYaw,
      zoom,
      basePan
    );
    const worldStart = unprojectScreen(
      Number(startScreen?.x) || 0,
      Number(startScreen?.y) || 0,
      viewportWithStartPan.viewport,
      cameraPitch,
      cameraYaw,
      viewportWithStartPan.worldScale
    );
    const worldCurrent = unprojectScreen(
      Number(currentScreen?.x) || 0,
      Number(currentScreen?.y) || 0,
      viewportWithStartPan.viewport,
      cameraPitch,
      cameraYaw,
      viewportWithStartPan.worldScale
    );
    return {
      x: (Number(basePan?.x) || 0) + ((Number(worldStart?.x) || 0) - (Number(worldCurrent?.x) || 0)),
      y: (Number(basePan?.y) || 0) + ((Number(worldStart?.y) || 0) - (Number(worldCurrent?.y) || 0))
    };
  }, [cameraPitch, cameraYaw, fieldSize.height, fieldSize.width, zoom]);

  const handleCanvasPointerDown = useCallback((event) => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect) return;
    const screenPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    if (event.button === 0) {
      leftDownRef.current = true;
    }
    if (event.button === 1) {
      if (phase === 'compose') {
        startComposePanDrag(event, screenPoint, 4);
        return;
      }
      event.preventDefault();
      middleDragRef.current = {
        startX: event.clientX,
        startYaw: cameraYaw
      };
      return;
    }

    if (event.button === 2) {
      event.preventDefault();
      if (phase === 'compose') {
        composeRotateDragRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          startYaw: cameraYaw,
          moved: false
        };
        setIsRotating(true);
        return;
      }
      const worldPoint = getCanvasWorldPoint(event);
      mouseWorldRef.current = worldPoint;

      rightDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        moved: false
      };

      if (phase === 'battle') {
        const sim = simRef.current;
        if (!sim || sim.ended) return;
        const append = leftDownRef.current;
        const ok = issueSquadMove(sim, selectedSquadIdRef.current, worldPoint, append);
        if (!ok) {
          showToast('当前无法移动：体力不足或未选中部队');
        }
      }
      return;
    }

    if (event.button !== 0) return;

    if (phase === 'compose' && spacePressedRef.current) {
      startComposePanDrag(event, screenPoint, 1);
      return;
    }

    const worldPoint = getCanvasWorldPoint(event);
    mouseWorldRef.current = worldPoint;

    if (phase === 'compose') {
      const movingGroup = composeGroups.find((group) => group.id === activeComposeMoveId) || null;
      if (!movingGroup) {
        const picked = pickAttackerGroupByPoint(worldPoint);
        if (picked) {
          setSelectedGroupId(picked.id);
          setActiveComposeMoveId('');
          setComposeGroupActionsPos((prev) => (prev?.groupId === picked.id ? prev : null));
          return;
        }
        startComposePanDrag(event, screenPoint, 1);
        return;
      }
      if (sumUnitsMap(movingGroup.units) <= 0) {
        showToast('该部队没有兵力，请先在左侧编辑兵种数量');
        return;
      }
      const footprint = resolveGroupFootprint(movingGroup, TEAM_ATTACKER);
      const radius = clamp(Number(footprint?.radius) || 20, 9, 108);
      const nextPos = clampPointToField(worldPoint, fieldSize.width, fieldSize.height, radius + 2);
      const canPlace = canPlaceGroupAt(
        movingGroup,
        nextPos,
        composeGroups,
        fieldSize,
        TEAM_ATTACKER,
        (group) => resolveGroupFootprint(group, TEAM_ATTACKER)
      );
      if (canPlace) {
        setComposeGroups((prev) => prev.map((group) => (
          group.id === movingGroup.id
            ? { ...group, x: nextPos.x, y: nextPos.y, placed: true }
            : group
        )));
        setSelectedGroupId(movingGroup.id);
        setActiveComposeMoveId('');
        composeGhostRef.current = null;
      } else {
        const picked = pickAttackerGroupByPoint(worldPoint);
        if (picked) {
          setSelectedGroupId(picked.id);
          setActiveComposeMoveId('');
          setComposeGroupActionsPos((prev) => (prev?.groupId === picked.id ? prev : null));
        } else {
          showToast('放置失败：请在左侧部署区放置，且避免重叠');
        }
      }
      return;
    }

    if (phase === 'battle') {
      const sim = simRef.current;
      if (!sim || sim.ended) return;

      if (pendingSkill && pendingSkill.squadId === selectedSquadIdRef.current) {
        const result = triggerSquadSkill(sim, pendingSkill.squadId, worldPoint);
        if (!result.ok) {
          showToast(result.reason || '兵种攻击执行失败');
        }
        setPendingSkill(null);
        return;
      }

      const picked = pickAttackerSquadByPoint(worldPoint);
      if (picked) {
        setSelectedSquadId(picked.id);
        selectedSquadIdRef.current = picked.id;
      }
    }
  }, [
    activeComposeMoveId,
    cameraYaw,
    composeGroups,
    fieldSize,
    getCanvasWorldPoint,
    pendingSkill,
    phase,
    pickAttackerGroupByPoint,
    pickAttackerSquadByPoint,
    resolveGroupFootprint,
    startComposePanDrag,
    showToast
  ]);

  const handleCanvasPointerMove = useCallback((event) => {
    const worldPoint = getCanvasWorldPoint(event);
    mouseWorldRef.current = worldPoint;
    if (phase === 'compose') {
      const panDrag = composePanDragRef.current;
      if (panDrag) {
        if ((event.buttons & panDrag.buttonMask) !== panDrag.buttonMask) {
          composePanDragRef.current = null;
          setIsPanning(false);
        } else {
          const canvas = canvasRef.current;
          const rect = canvas?.getBoundingClientRect();
          if (rect) {
            const currentScreen = {
              x: event.clientX - rect.left,
              y: event.clientY - rect.top
            };
            const nextPan = updateComposePanByScreenPoints(
              { x: panDrag.startScreenX, y: panDrag.startScreenY },
              currentScreen,
              { x: panDrag.startPanX, y: panDrag.startPanY }
            );
            panWorldRef.current = nextPan;
          }
        }
      }
      const rotateDrag = composeRotateDragRef.current;
      if (rotateDrag) {
        if ((event.buttons & 2) !== 2) {
          composeRotateDragRef.current = null;
          setIsRotating(false);
        } else {
          const dx = event.clientX - rotateDrag.startX;
          const nextYaw = normalizeDeg(rotateDrag.startYaw + (dx * CAMERA_ROTATE_SENSITIVITY));
          if (Math.abs(dx) >= CAMERA_ROTATE_CLICK_THRESHOLD) {
            rotateDrag.moved = true;
          }
          setCameraYaw(nextYaw);
        }
      }
      const movingGroup = composeGroups.find((group) => group.id === activeComposeMoveId) || null;
      if (movingGroup && sumUnitsMap(movingGroup.units) > 0 && !panDrag && !rotateDrag) {
        const footprint = resolveGroupFootprint(movingGroup, TEAM_ATTACKER);
        const radius = clamp(Number(footprint?.radius) || 20, 9, 108);
        const clampedPoint = clampPointToField(worldPoint, fieldSize.width, fieldSize.height, radius + 2);
        const blocked = !canPlaceGroupAt(
          movingGroup,
          clampedPoint,
          composeGroups,
          fieldSize,
          TEAM_ATTACKER,
          (group) => resolveGroupFootprint(group, TEAM_ATTACKER)
        );
        composeGhostRef.current = {
          x: clampedPoint.x,
          y: clampedPoint.y,
          blocked
        };
      } else {
        composeGhostRef.current = null;
      }
      return;
    }

    if (middleDragRef.current) {
      const dx = event.clientX - middleDragRef.current.startX;
      setCameraYaw(normalizeDeg(middleDragRef.current.startYaw + (dx * 0.36)));
    }

    if (rightDragRef.current) {
      const drag = rightDragRef.current;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > EDGE_GESTURE_THRESHOLD) {
        drag.moved = true;
        if (!edgeWarnShownRef.current && /Edg\//.test(navigator.userAgent || '')) {
          edgeWarnShownRef.current = true;
          showToast('检测到 Edge 右键拖动可能触发浏览器鼠标手势；已尽力拦截。如仍触发请关闭 Edge 鼠标手势或更换浏览器。');
        }
      }
    }
  }, [activeComposeMoveId, composeGroups, fieldSize, getCanvasWorldPoint, phase, resolveGroupFootprint, showToast, updateComposePanByScreenPoints]);

  const handleCanvasPointerUp = useCallback((event) => {
    if (event.button === 0) {
      leftDownRef.current = false;
      if (composePanDragRef.current?.buttonMask === 1) {
        composePanDragRef.current = null;
        setIsPanning(false);
      }
    }
    if (event.button === 1) {
      if (phase === 'compose') {
        composePanDragRef.current = null;
        setIsPanning(false);
      } else {
        middleDragRef.current = null;
      }
    }
    if (event.button === 2) {
      if (phase === 'compose') {
        const rotateDrag = composeRotateDragRef.current;
        if (rotateDrag && !rotateDrag.moved && activeComposeMoveId) {
          setActiveComposeMoveId('');
          composeGhostRef.current = null;
          showToast('已取消部队放置');
        }
        composeRotateDragRef.current = null;
        setIsRotating(false);
      } else {
        rightDragRef.current = null;
      }
    }
  }, [activeComposeMoveId, phase, showToast]);

  const cycleSelectedSquad = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    const rows = sim.squads.filter((squad) => squad.team === TEAM_ATTACKER && squad.remain > 0);
    if (rows.length === 0) return;
    const currentIndex = rows.findIndex((squad) => squad.id === selectedSquadIdRef.current);
    const next = rows[(currentIndex + 1 + rows.length) % rows.length];
    if (!next) return;
    setSelectedSquadId(next.id);
    selectedSquadIdRef.current = next.id;
  }, []);

  const runActionShortcut = useCallback((actionKey) => {
    const sim = simRef.current;
    if (!sim || phase !== 'battle' || sim.ended) return;
    const squadId = selectedSquadIdRef.current;
    if (!squadId) return;

    if (actionKey === '1') {
      setSquadBehavior(sim, squadId, 'idle');
      setPendingSkill(null);
      return;
    }
    if (actionKey === '2') {
      setSquadBehavior(sim, squadId, 'auto');
      setPendingSkill(null);
      return;
    }
    if (actionKey === '3') {
      const squad = findSquadById(sim, squadId);
      if (!squad || squad.remain <= 0) return;
      if (squad.morale <= 0) {
        showToast('士气为 0，无法发动兵种攻击');
        return;
      }
      setPendingSkill({ squadId, classTag: squad.classTag });
      return;
    }
    if (actionKey === '4') {
      setSquadBehavior(sim, squadId, 'retreat');
      setPendingSkill(null);
      return;
    }
    if (actionKey === '5') {
      setSquadBehavior(sim, squadId, 'defend');
      setPendingSkill(null);
    }
  }, [phase, showToast]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (phase !== 'battle') return;

      if (event.key === 'Tab') {
        event.preventDefault();
        cycleSelectedSquad();
        return;
      }

      const keyMap = {
        Digit1: '1',
        Digit2: '2',
        Digit3: '3',
        Digit4: '4',
        Digit5: '5',
        Numpad1: '1',
        Numpad2: '2',
        Numpad3: '3',
        Numpad4: '4',
        Numpad5: '5'
      };
      const action = keyMap[event.code];
      if (!action) return;
      event.preventDefault();
      runActionShortcut(action);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [cycleSelectedSquad, open, phase, runActionShortcut]);

  useEffect(() => {
    if (!open) return undefined;

    let rafId = 0;
    let lastTs = performance.now();

    const renderFrame = (ts) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const nextW = Math.max(1, Math.floor(rect.width));
      const nextH = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      const dt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
      lastTs = ts;

      const view = getViewport(
        canvas,
        fieldSize.width,
        fieldSize.height,
        cameraPitch,
        cameraYaw,
        zoom,
        panWorldRef.current
      );
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawGround(ctx, view, fieldSize, cameraPitch, cameraYaw);

      if (phase === 'compose') {
        drawDeployZones(ctx, view, fieldSize, cameraPitch, cameraYaw);
        const attackerRender = drawComposeGroups(
          ctx,
          composeGroups,
          view,
          cameraPitch,
          cameraYaw,
          zoom,
          selectedGroupId,
          TEAM_ATTACKER,
          resolveFormationState
        );
        drawComposeGroups(ctx, defenderComposeGroups, view, cameraPitch, cameraYaw, zoom, '', TEAM_DEFENDER, resolveFormationState);
        const anchor = attackerRender?.selectedAnchor;
        if (anchor && anchor.groupId && !activeComposeMoveId) {
          setComposeGroupActionsPos((prev) => {
            const next = {
              groupId: anchor.groupId,
              x: anchor.x,
              y: anchor.y
            };
            if (!prev) return next;
            if (prev.groupId !== next.groupId) return next;
            if (Math.abs(prev.x - next.x) > 0.8 || Math.abs(prev.y - next.y) > 0.8) return next;
            return prev;
          });
        } else {
          setComposeGroupActionsPos((prev) => (prev ? null : prev));
        }
        const ghostGroup = composeGroups.find((group) => group.id === activeComposeMoveId) || null;
        if (ghostGroup && sumUnitsMap(ghostGroup.units) > 0 && composeGhostRef.current) {
          drawComposeGhost(
            ctx,
            ghostGroup,
            composeGhostRef.current,
            view,
            cameraPitch,
            cameraYaw,
            zoom,
            TEAM_ATTACKER,
            resolveFormationState
          );
        }
      }

      if (phase === 'battle') {
        const sim = simRef.current;
        if (sim) {
          updateSimulation(sim, dt);
          drawBuildings(ctx, sim, view, cameraPitch, cameraYaw);
          drawEffects(ctx, sim, view, cameraPitch, cameraYaw);
          const selectedFlag = drawSquads(
            ctx,
            sim,
            view,
            cameraPitch,
            cameraYaw,
            zoom,
            selectedSquadIdRef.current,
            hoverSquadIdRef.current,
            resolveFormationState
          );

          const selectedSquad = findSquadById(sim, selectedSquadIdRef.current);
          if (selectedFlag && selectedSquad && selectedSquad.team === TEAM_ATTACKER && selectedSquad.remain > 0) {
            setFloatingActionsPos((prev) => {
              const next = { x: selectedFlag.x, y: selectedFlag.y };
              if (!prev) return next;
              if (Math.abs(prev.x - next.x) > 0.8 || Math.abs(prev.y - next.y) > 0.8) return next;
              return prev;
            });
          } else {
            setFloatingActionsPos((prev) => (prev ? null : prev));
          }

          if (pendingSkill && pendingSkill.squadId === selectedSquadIdRef.current && selectedSquad) {
            const overlay = buildSkillAimOverlay(
              sim,
              selectedSquad,
              mouseWorldRef.current,
              view,
              cameraPitch,
              cameraYaw
            );
            drawSkillAimOverlay(ctx, overlay);
          }

          if ((ts - lastCardSyncRef.current) >= CARD_UPDATE_MS) {
            lastCardSyncRef.current = ts;
            syncCardRowsFromSim(sim);
          }

          finishBattleIfNeeded(sim);
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [
    cameraPitch,
    cameraYaw,
    composeGroups,
    defenderComposeGroups,
    fieldSize,
    finishBattleIfNeeded,
    open,
    pendingSkill,
    phase,
    resolveFormationState,
    activeComposeMoveId,
    selectedGroupId,
    syncCardRowsFromSim,
    zoom
  ]);

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    if (phase === 'compose') {
      const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      setZoom((prev) => clamp(prev + delta, MIN_ZOOM, MAX_ZOOM));
      return;
    }
    setCameraPitch((prev) => clamp(prev - (event.deltaY * 0.02), MIN_PITCH, MAX_PITCH));
  }, [phase]);

  const withdrawComposeGroupById = useCallback((groupId, { silent = false } = {}) => {
    const safeId = typeof groupId === 'string' ? groupId.trim() : '';
    if (!safeId) return false;
    let found = false;
    setComposeGroups((prev) => prev.map((group) => {
      if (group.id !== safeId) return group;
      found = true;
      return {
        ...group,
        placed: false,
        x: null,
        y: null
      };
    }));
    if (!found) return false;
    if (activeComposeMoveId === safeId) {
      setActiveComposeMoveId('');
      composeGhostRef.current = null;
    }
    setComposeGroupActionsPos((prev) => (prev?.groupId === safeId ? null : prev));
    if (!silent) showToast('部队已撤回到左侧列表');
    return true;
  }, [activeComposeMoveId, showToast]);

  const openComposeEditorForNew = useCallback(() => {
    const nextSortOrder = (composeGroups?.length || 0) + 1;
    const nextName = buildDefaultAttackerGroupName(nextSortOrder);
    setComposeEditorTargetGroupId('');
    setComposeEditorDraft({
      name: nextName,
      sortOrder: nextSortOrder,
      units: {}
    });
    setComposeEditorDropActive(false);
    setComposeEditorOpen(true);
  }, [composeGroups]);

  const openComposeEditorForSelected = useCallback((groupId = '') => {
    const safeGroupId = typeof groupId === 'string' && groupId.trim() ? groupId.trim() : selectedGroupId;
    const target = composeGroups.find((group) => group.id === safeGroupId) || null;
    if (!target) {
      showToast('请先在左侧选择一个部队');
      return;
    }
    if (target.placed) {
      withdrawComposeGroupById(target.id, { silent: true });
    }
    setComposeEditorTargetGroupId(target.id);
    setComposeEditorDraft({
      name: target.name || buildDefaultAttackerGroupName(1),
      sortOrder: normalizeComposeSortOrder(target.sortOrder, 1),
      units: normalizeUnitsMap(target.units || {})
    });
    setComposeEditorDropActive(false);
    setComposeEditorOpen(true);
  }, [composeGroups, selectedGroupId, showToast, withdrawComposeGroupById]);

  const removeSelectedComposeGroup = useCallback(() => {
    setComposeGroups((prev) => {
      if (prev.length <= 0) return prev;
      const next = prev.filter((group) => group.id !== selectedGroupId);
      setSelectedGroupId(next[0]?.id || '');
      setActiveComposeMoveId('');
      composeGhostRef.current = null;
      setComposeGroupActionsPos(null);
      return next;
    });
  }, [selectedGroupId]);

  const composeEditorStockRows = useMemo(() => {
    const attackerRows = Array.isArray(battleInitData?.attacker?.units) ? battleInitData.attacker.units : [];
    const usedByOthers = {};
    composeGroups.forEach((group) => {
      if (composeEditorTargetGroupId && group.id === composeEditorTargetGroupId) return;
      Object.entries(group.units || {}).forEach(([unitTypeId, rawCount]) => {
        const count = Math.max(0, Math.floor(Number(rawCount) || 0));
        if (!unitTypeId || count <= 0) return;
        usedByOthers[unitTypeId] = (usedByOthers[unitTypeId] || 0) + count;
      });
    });
    const draftUnits = normalizeUnitsMap(composeEditorDraft.units || {});
    return attackerRows
      .map((entry) => {
        const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
        if (!unitTypeId) return null;
        const total = Math.max(0, Math.floor(Number(entry?.count) || 0));
        const maxAssignable = Math.max(0, total - (usedByOthers[unitTypeId] || 0));
        const current = Math.max(0, Math.floor(Number(draftUnits[unitTypeId]) || 0));
        return {
          unitTypeId,
          unitName: unitTypeMap.get(unitTypeId)?.name || unitTypeId,
          total,
          maxAssignable,
          current,
          remaining: Math.max(0, maxAssignable - current)
        };
      })
      .filter(Boolean);
  }, [battleInitData?.attacker?.units, composeEditorDraft.units, composeEditorTargetGroupId, composeGroups, unitTypeMap]);

  const composeEditorSelectedRows = useMemo(
    () => unitsMapToRows(composeEditorDraft.units || {}, unitTypeMap),
    [composeEditorDraft.units, unitTypeMap]
  );
  const composeEditorTotalCount = useMemo(
    () => sumUnitsMap(composeEditorDraft.units || {}),
    [composeEditorDraft.units]
  );

  const openComposeQuantityDialog = useCallback((unitTypeId, mode = 'add') => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) {
      showToast('未识别到兵种，请重试拖拽或直接点击兵种');
      return;
    }
    const stock = composeEditorStockRows.find((item) => item.unitTypeId === safeId);
    if (!stock) {
      showToast('该兵种当前不可分配');
      return;
    }
    if (mode === 'add') {
      if (stock.remaining <= 0) {
        showToast('该兵种已无可分配数量');
        return;
      }
      setComposeQuantityDialog({
        open: true,
        mode,
        unitTypeId: safeId,
        unitName: stock.unitName,
        max: stock.remaining,
        current: Math.min(stock.remaining, 1)
      });
      return;
    }
    if (stock.maxAssignable <= 0) {
      showToast('该兵种当前不可编辑');
      return;
    }
    setComposeQuantityDialog({
      open: true,
      mode: 'set',
      unitTypeId: safeId,
      unitName: stock.unitName,
      max: stock.maxAssignable,
      current: Math.max(1, stock.current || 1)
    });
  }, [composeEditorStockRows, showToast]);

  const removeComposeEditorUnit = useCallback((unitTypeId) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return;
    setComposeEditorDraft((prev) => {
      const nextUnits = normalizeUnitsMap(prev.units || {});
      delete nextUnits[safeId];
      return { ...prev, units: nextUnits };
    });
  }, []);

  const confirmComposeQuantityDialog = useCallback((value) => {
    const dialog = composeQuantityDialog;
    const safeId = typeof dialog?.unitTypeId === 'string' ? dialog.unitTypeId.trim() : '';
    if (!safeId) {
      setComposeQuantityDialog((prev) => ({ ...prev, open: false }));
      return;
    }
    const qty = Math.max(1, Math.floor(Number(value) || 1));
    setComposeEditorDraft((prev) => {
      const nextUnits = normalizeUnitsMap(prev.units || {});
      if (dialog.mode === 'set') {
        nextUnits[safeId] = qty;
      } else {
        nextUnits[safeId] = (nextUnits[safeId] || 0) + qty;
      }
      return {
        ...prev,
        units: nextUnits
      };
    });
    setComposeQuantityDialog((prev) => ({ ...prev, open: false }));
  }, [composeQuantityDialog]);

  const submitComposeEditor = useCallback(() => {
    const draftUnits = normalizeUnitsMap(composeEditorDraft.units || {});
    if (sumUnitsMap(draftUnits) <= 0) {
      showToast('请至少添加一种兵种并设置数量');
      return;
    }
    const draftName = (typeof composeEditorDraft.name === 'string' && composeEditorDraft.name.trim())
      ? composeEditorDraft.name.trim()
      : buildDefaultAttackerGroupName((composeGroups?.length || 0) + 1);
    const draftSortOrder = normalizeComposeSortOrder(
      composeEditorDraft.sortOrder,
      (composeGroups?.length || 0) + 1
    );
    const editingId = typeof composeEditorTargetGroupId === 'string' ? composeEditorTargetGroupId.trim() : '';

    if (editingId) {
      setComposeGroups((prev) => sortComposeGroups(prev.map((group) => (
        group.id === editingId
          ? {
            ...group,
            name: draftName,
            sortOrder: draftSortOrder,
            units: draftUnits,
            placed: false,
            x: null,
            y: null
          }
          : group
      ))));
      setSelectedGroupId(editingId);
      showToast('已更新部队编组');
    } else {
      const newGroupId = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setComposeGroups((prev) => sortComposeGroups([...prev, {
        id: newGroupId,
        name: draftName,
        sortOrder: draftSortOrder,
        units: draftUnits,
        placed: false,
        x: null,
        y: null
      }]));
      setSelectedGroupId(newGroupId);
      showToast('已新建攻方部队');
    }

    setActiveComposeMoveId('');
    composeGhostRef.current = null;
    setComposeGroupActionsPos(null);
    setComposeEditorOpen(false);
    setComposeEditorDropActive(false);
    setComposeEditorTargetGroupId('');
    setComposeEditorDraft({ name: '', sortOrder: 1, units: {} });
  }, [composeEditorDraft.name, composeEditorDraft.sortOrder, composeEditorDraft.units, composeEditorTargetGroupId, composeGroups, showToast]);

  const closeComposeEditor = useCallback(() => {
    setComposeEditorOpen(false);
    setComposeEditorDropActive(false);
    setComposeEditorTargetGroupId('');
    setComposeEditorDraft({ name: '', sortOrder: 1, units: {} });
  }, []);

  const handleCardClick = useCallback((row) => {
    if (!row) return;
    if (phase === 'battle' && row.team === TEAM_ATTACKER && row.alive) {
      setSelectedSquadId(row.id);
      selectedSquadIdRef.current = row.id;
    }
  }, [phase]);

  const invokeActionFromButton = useCallback((action) => {
    if (action === 'idle') runActionShortcut('1');
    if (action === 'auto') runActionShortcut('2');
    if (action === 'skill') runActionShortcut('3');
    if (action === 'retreat') runActionShortcut('4');
    if (action === 'defend') runActionShortcut('5');
  }, [runActionShortcut]);

  const closeModal = useCallback(() => {
    setPendingSkill(null);
    setFloatingActionsPos(null);
    setComposeGroupActionsPos(null);
    setComposeEditorOpen(false);
    setComposeEditorTargetGroupId('');
    setComposeEditorDropActive(false);
    setComposeQuantityDialog((prev) => ({ ...prev, open: false }));
    if (typeof onClose === 'function') {
      onClose();
    }
  }, [onClose]);

  const attackerCards = cardRows.filter((row) => row.team === TEAM_ATTACKER);
  const defenderCards = cardRows.filter((row) => row.team === TEAM_DEFENDER);
  const orderedComposeGroups = useMemo(() => sortComposeGroups(composeGroups), [composeGroups]);
  const selectedComposeGroup = composeGroups.find((group) => group.id === selectedGroupId) || null;
  const battleTitle = `${battleInitData?.nodeName || '知识域'}-${battleInitData?.gateLabel || '承门'} 围城攻防战`;
  const attackerName = battleInitData?.attacker?.username || '进攻方';
  const defenderName = battleInitData?.defender?.username || '守方域主';
  const composeAttackerPower = orderedComposeGroups.reduce((sum, group) => (
    group.placed
      ? (sum + computeUnitsMapPower(group.units, unitTypeMap))
      : sum
  ), 0);
  const composeDefenderPower = defenderComposeGroups.reduce((sum, group) => (
    sum + computeUnitsMapPower(group.units, unitTypeMap)
  ), 0);
  const liveSim = simRef.current;
  const battleAttackerPower = liveSim
    ? liveSim.squads
      .filter((squad) => squad.team === TEAM_ATTACKER && squad.remain > 0)
      .reduce((sum, squad) => {
        const remainUnits = squad.remainUnits && typeof squad.remainUnits === 'object'
          ? squad.remainUnits
          : distributeUnitsByRatio(squad.units, squad.remain, squad.startCount);
        return sum + computeUnitsMapPower(remainUnits, unitTypeMap);
      }, 0)
    : 0;
  const battleDefenderPower = liveSim
    ? liveSim.squads
      .filter((squad) => squad.team === TEAM_DEFENDER && squad.remain > 0)
      .reduce((sum, squad) => {
        const remainUnits = squad.remainUnits && typeof squad.remainUnits === 'object'
          ? squad.remainUnits
          : distributeUnitsByRatio(squad.units, squad.remain, squad.startCount);
        return sum + computeUnitsMapPower(remainUnits, unitTypeMap);
      }, 0)
    : 0;
  const attackerPowerText = Math.round(phase === 'compose' ? composeAttackerPower : battleAttackerPower);
  const defenderPowerText = Math.round(phase === 'compose' ? composeDefenderPower : battleDefenderPower);
  const composeMovingGroup = composeGroups.find((group) => group.id === activeComposeMoveId) || null;

  if (!open) return null;

  return (
    <div className="pve-battle-overlay">
      <div className="pve-battle-topbar">
        <div className="pve-battle-title-wrap">
          <div className="pve-battle-title">
            <strong>{battleTitle}</strong>
          </div>
          <div className="pve-battle-sides">
            <div className="pve-battle-side attacker">
              <span className="label">进攻方</span>
              <strong>{attackerName}</strong>
              <em>{`战力 ${attackerPowerText}`}</em>
            </div>
            <div className="pve-battle-side defender">
              <span className="label">守方</span>
              <strong>{defenderName}</strong>
              <em>{`战力 ${defenderPowerText}`}</em>
            </div>
          </div>
        </div>
        <div className="pve-battle-top-actions">
          {phase === 'battle' && <div className="pve-battle-time">{formatCountdown(battleTimerSec)}</div>}
          <button type="button" className="btn btn-secondary" onClick={closeModal}>退出</button>
        </div>
      </div>

      {(loading || !battleInitData) ? (
        <div className="pve-empty">{loading ? '战斗初始化中...' : (error || '未能加载战斗数据')}</div>
      ) : (
        <div className="pve-battle-main">
          {phase === 'compose' && (
            <div className="pve-compose-start-slot">
              <div className="pve-battle-time">{formatCountdown(battleTimerSec)}</div>
              <button type="button" className="btn btn-warning" onClick={startBattle} disabled={!canStartBattle}>开战</button>
            </div>
          )}
          <div className="pve-battle-card-strip left">
            {(phase === 'battle' ? attackerCards : orderedComposeGroups.map((group) => ({
              id: group.id,
              name: group.name,
              classTag: aggregateStats(group.units, unitTypeMap).classTag,
              action: activeComposeMoveId === group.id ? '移动中' : (group.placed ? '已部署' : '待部署'),
              currentSoldiers: Math.max(0, Math.ceil(sumUnitsMap(group.units) / unitsPerSoldier)),
              maxSoldiers: Math.max(0, Math.ceil(sumUnitsMap(group.units) / unitsPerSoldier)),
              remain: sumUnitsMap(group.units),
              startCount: sumUnitsMap(group.units),
              stamina: 100,
              morale: 100,
              selected: selectedGroupId === group.id,
              alive: true,
              team: TEAM_ATTACKER
            }))).map((row) => (
              <button
                key={row.id}
                type="button"
                className={`pve-squad-card ${row.selected ? 'selected' : ''}`}
                onClick={() => {
                  if (phase === 'compose') {
                    setSelectedGroupId(row.id);
                    if (row.remain > 0) {
                      setActiveComposeMoveId(row.id);
                      showToast(`已拾取${row.name || '部队'}，鼠标左键放置到进攻区`);
                    } else {
                      setActiveComposeMoveId('');
                      showToast('该部队暂无兵力，请先编辑编组');
                    }
                    return;
                  }
                  handleCardClick(row);
                }}
                onDoubleClick={() => {
                  if (phase === 'compose') {
                    setSelectedGroupId(row.id);
                    openComposeEditorForSelected(row.id);
                  }
                }}
                onMouseEnter={() => setHoverSquadId(row.id)}
                onMouseLeave={() => setHoverSquadId('')}
              >
                <div className="pve-squad-card-head">
                  <strong>{row.name}</strong>
                  <span>{`#${row.id.split('_').slice(-1)[0] || '1'}`}</span>
                </div>
                <div className="pve-card-icon" style={{ background: 'rgba(248, 113, 113, 0.22)' }}>{getUnitClassIcon(row.classTag)}</div>
                <div className="pve-card-row">{`士兵 ${row.currentSoldiers}/${row.maxSoldiers}`}</div>
                <div className="pve-bar hp"><i style={{ width: `${clamp((row.remain / Math.max(1, row.startCount)) * 100, 0, 100)}%` }} /></div>
                <div className="pve-bar stamina"><i style={{ width: `${clamp(row.stamina, 0, 100)}%` }} /></div>
                <div className="pve-bar morale"><i style={{ width: `${clamp(row.morale, 0, 100)}%` }} /></div>
                <div className="pve-card-action">{row.action || '待命'}</div>
              </button>
            ))}
          </div>

          <div className="pve-battle-card-strip right">
            {(phase === 'battle' ? defenderCards : defenderComposeGroups.map((group) => ({
              id: group.id,
              name: group.name,
              classTag: aggregateStats(group.units, unitTypeMap).classTag,
              action: '守军部署',
              currentSoldiers: Math.max(0, Math.ceil(sumUnitsMap(group.units) / unitsPerSoldier)),
              maxSoldiers: Math.max(0, Math.ceil(sumUnitsMap(group.units) / unitsPerSoldier)),
              remain: sumUnitsMap(group.units),
              startCount: sumUnitsMap(group.units),
              stamina: 100,
              morale: 100,
              selected: false,
              alive: true,
              team: TEAM_DEFENDER
            }))).map((row) => (
              <div
                key={row.id}
                className="pve-squad-card enemy"
                onMouseEnter={() => setHoverSquadId(row.id)}
                onMouseLeave={() => setHoverSquadId('')}
              >
                <div className="pve-squad-card-head">
                  <strong>{row.name}</strong>
                  <span>守军</span>
                </div>
                <div className="pve-card-icon" style={{ background: 'rgba(56, 189, 248, 0.22)' }}>{getUnitClassIcon(row.classTag)}</div>
                <div className="pve-card-row">{`士兵 ${row.currentSoldiers}/${row.maxSoldiers}`}</div>
                <div className="pve-bar hp"><i style={{ width: `${clamp((row.remain / Math.max(1, row.startCount)) * 100, 0, 100)}%` }} /></div>
                <div className="pve-bar stamina"><i style={{ width: `${clamp(row.stamina, 0, 100)}%` }} /></div>
                <div className="pve-bar morale"><i style={{ width: `${clamp(row.morale, 0, 100)}%` }} /></div>
                <div className="pve-card-action">{row.action || '待命'}</div>
              </div>
            ))}
          </div>

          <div className="pve-battle-canvas-wrap">
            <canvas
              ref={canvasRef}
              className={`pve-battle-canvas ${isPanning ? 'is-panning' : ''} ${isRotating ? 'is-rotating' : ''}`}
              onWheel={handleWheel}
              onMouseDown={handleCanvasPointerDown}
              onMouseMove={handleCanvasPointerMove}
              onMouseUp={handleCanvasPointerUp}
              onMouseLeave={() => {
                leftDownRef.current = false;
                composePanDragRef.current = null;
                composeRotateDragRef.current = null;
                setIsPanning(false);
                setIsRotating(false);
                middleDragRef.current = null;
                rightDragRef.current = null;
                composeGhostRef.current = null;
              }}
              onContextMenu={(event) => event.preventDefault()}
            />
          </div>

          {phase === 'compose' && (
            <aside className="pve-compose-sidebar">
              <div className="pve-compose-box">
                <h4>攻方部队</h4>
                <div className="pve-compose-groups">
                  {orderedComposeGroups.length <= 0 && (
                    <div className="pve-compose-tip">当前没有部队，请先新建部队。</div>
                  )}
                  {orderedComposeGroups.map((group) => {
                    const unitCount = sumUnitsMap(group.units);
                    return (
                      <div
                        key={group.id}
                        className={`pve-compose-group ${selectedGroupId === group.id ? 'selected' : ''} ${unitCount <= 0 ? 'empty' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedGroupId(group.id);
                          if (unitCount <= 0) {
                            setActiveComposeMoveId('');
                            showToast('该部队暂无兵力，请先编辑编组');
                          } else {
                            setActiveComposeMoveId(group.id);
                            showToast(`已拾取${group.name || '部队'}，鼠标左键放置到进攻区`);
                          }
                        }}
                        onDoubleClick={() => {
                          setSelectedGroupId(group.id);
                          openComposeEditorForSelected(group.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedGroupId(group.id);
                            if (unitCount <= 0) {
                              setActiveComposeMoveId('');
                              showToast('该部队暂无兵力，请先编辑编组');
                            } else {
                              setActiveComposeMoveId(group.id);
                              showToast(`已拾取${group.name || '部队'}，鼠标左键放置到进攻区`);
                            }
                          }
                        }}
                      >
                        <div className="pve-compose-line">
                          <strong>{group.name}</strong>
                          <span>{activeComposeMoveId === group.id ? '移动中' : (group.placed ? '已部署' : '待部署')}</span>
                        </div>
                        <div className="pve-compose-line">
                          <span>{`兵力 ${unitCount}`}</span>
                          <span>{`小兵 ${Math.ceil(unitCount / unitsPerSoldier)}`}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="pve-compose-actions">
                  <button type="button" className="btn btn-secondary" onClick={openComposeEditorForNew}>新建部队</button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={openComposeEditorForSelected}
                    disabled={!selectedComposeGroup}
                  >编辑选中</button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={removeSelectedComposeGroup}
                    disabled={!selectedComposeGroup}
                  >删除选中</button>
                </div>
                <div className="pve-compose-tip">
                  {composeMovingGroup
                    ? `正在放置：${composeMovingGroup.name || '部队'}。鼠标左键放到左侧进攻区，右键取消拾取。`
                    : '点击部队卡片即可拾取并放置；双击部队卡片可编辑编组；右键拖动旋转，中键或 Space+左键拖动平移，滚轮缩放。'}
                </div>
                <div className="pve-compose-tip">
                  {Object.values(remainingPool).every((value) => value === 0)
                    ? '兵力已分配完成，可点击上方开战。'
                    : `尚有未分配兵力：${Object.values(remainingPool).reduce((sum, value) => sum + value, 0)}`}
                </div>
              </div>
            </aside>
          )}

          {phase === 'compose' && composeGroupActionsPos && (
            <div className="pve-compose-group-actions" style={{ left: composeGroupActionsPos.x, top: composeGroupActionsPos.y }}>
              <button
                type="button"
                onClick={() => {
                  const target = composeGroups.find((group) => group.id === composeGroupActionsPos.groupId);
                  if (!target) return;
                  if (sumUnitsMap(target.units) <= 0) {
                    showToast('该部队暂无兵力，无法移动');
                    return;
                  }
                  setSelectedGroupId(target.id);
                  setActiveComposeMoveId(target.id);
                  showToast(`已拾取${target.name || '部队'}，鼠标左键放置到进攻区`);
                }}
              >移动</button>
              <button
                type="button"
                onClick={() => {
                  const target = composeGroups.find((group) => group.id === composeGroupActionsPos.groupId);
                  if (!target) return;
                  setSelectedGroupId(target.id);
                  withdrawComposeGroupById(target.id);
                }}
              >X</button>
            </div>
          )}

          {phase === 'compose' && composeEditorOpen && (
            <div className="pve-compose-editor" onClick={(event) => event.stopPropagation()}>
              <div className="pve-compose-editor-head">
                <strong>{composeEditorTargetGroupId ? '编辑部队' : '新建部队'}</strong>
                <div className="pve-compose-actions">
                  <button type="button" className="btn btn-secondary" onClick={closeComposeEditor}>取消</button>
                  <button
                    type="button"
                    className="btn btn-warning"
                    onClick={submitComposeEditor}
                    disabled={composeEditorTotalCount <= 0}
                  >确定编组</button>
                </div>
              </div>
              <div className="pve-compose-editor-grid">
                <label>
                  部队名称
                  <input
                    type="text"
                    value={composeEditorDraft.name || ''}
                    maxLength={24}
                    placeholder="不填则自动命名"
                    onChange={(event) => setComposeEditorDraft((prev) => ({ ...prev, name: event.target.value }))}
                  />
                </label>
                <label>
                  排序
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={normalizeComposeSortOrder(composeEditorDraft.sortOrder, 1)}
                    onChange={(event) => setComposeEditorDraft((prev) => ({
                      ...prev,
                      sortOrder: normalizeComposeSortOrder(event.target.value, 1)
                    }))}
                  />
                </label>
              </div>
              <div className="pve-compose-editor-transfer">
                <div className="pve-compose-editor-col">
                  <div className="pve-compose-editor-col-title">可用兵种（左侧）</div>
                  {composeEditorStockRows
                    .filter((entry) => entry.remaining > 0)
                    .map((entry) => (
                      <button
                        key={`pve-editor-stock-${entry.unitTypeId}`}
                        type="button"
                        className="pve-compose-editor-item"
                        draggable={entry.remaining > 0}
                        disabled={entry.remaining <= 0}
                        onDragStart={(event) => {
                          composeDragUnitTypeRef.current = entry.unitTypeId;
                          event.dataTransfer?.setData('application/x-pve-unit-id', entry.unitTypeId);
                          event.dataTransfer?.setData('text/plain', entry.unitTypeId);
                          if (event.dataTransfer) {
                            event.dataTransfer.effectAllowed = 'copyMove';
                          }
                        }}
                        onDragEnd={() => {
                          composeDragUnitTypeRef.current = '';
                        }}
                        onClick={() => openComposeQuantityDialog(entry.unitTypeId, 'add')}
                      >
                        <strong>{entry.unitName}</strong>
                        <span>{`可用 ${entry.remaining}`}</span>
                      </button>
                    ))}
                  {composeEditorStockRows.filter((entry) => entry.remaining > 0).length <= 0 && (
                    <div className="pve-compose-tip">没有可继续分配的兵种。</div>
                  )}
                </div>
                <div
                  className={`pve-compose-editor-col is-dropzone ${composeEditorDropActive ? 'active' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (event.dataTransfer) {
                      event.dataTransfer.dropEffect = 'copy';
                    }
                    setComposeEditorDropActive(true);
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return;
                    setComposeEditorDropActive(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const droppedUnitTypeId = event.dataTransfer?.getData('application/x-pve-unit-id')
                      || event.dataTransfer?.getData('text/plain')
                      || composeDragUnitTypeRef.current
                      || '';
                    composeDragUnitTypeRef.current = '';
                    setComposeEditorDropActive(false);
                    openComposeQuantityDialog(droppedUnitTypeId, 'add');
                  }}
                >
                  <div className="pve-compose-editor-col-title">部队编组（右侧）</div>
                  {composeEditorSelectedRows.length <= 0 && (
                    <div className="pve-compose-tip">把左侧兵种拖到这里，会弹出数量输入框。</div>
                  )}
                  {composeEditorSelectedRows.map((entry) => (
                    <div key={`pve-editor-right-${entry.unitTypeId}`} className="pve-compose-line">
                      <strong>{entry.unitName}</strong>
                      <span>{`数量 ${entry.count}`}</span>
                      <div className="pve-compose-line-actions">
                        <button type="button" onClick={() => openComposeQuantityDialog(entry.unitTypeId, 'set')}>编辑</button>
                        <button type="button" onClick={() => removeComposeEditorUnit(entry.unitTypeId)}>移除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pve-compose-editor-tip">
                {`总兵力 ${composeEditorTotalCount}。确定后会生成或更新攻方部队卡片；双击左侧攻方部队卡片可再次编辑，若该部队已部署会自动从战场撤回。`}
              </div>
            </div>
          )}

          {phase === 'battle' && floatingActionsPos && (
            <div className="pve-floating-actions" style={{ left: floatingActionsPos.x, top: floatingActionsPos.y }}>
              <button type="button" title="待命(1)" onClick={() => invokeActionFromButton('idle')}>1</button>
              <button type="button" title="自动攻击(2)" onClick={() => invokeActionFromButton('auto')}>2</button>
              <button type="button" title="兵种攻击(3)" onClick={() => invokeActionFromButton('skill')}>3</button>
              <button type="button" title="撤退(4)" onClick={() => invokeActionFromButton('retreat')}>4</button>
              <button type="button" title="防御(5)" onClick={() => invokeActionFromButton('defend')}>5</button>
            </div>
          )}

          {toast && <div className="pve-toast">{toast}</div>}

          <NumberPadDialog
            open={!!composeQuantityDialog?.open}
            title={composeQuantityDialog?.mode === 'set' ? `设置${composeQuantityDialog?.unitName || '兵种'}数量` : `添加${composeQuantityDialog?.unitName || '兵种'}数量`}
            description={composeQuantityDialog?.mode === 'set' ? '设置该兵种在当前部队中的总数量' : '设置本次添加数量'}
            min={1}
            max={Math.max(1, Math.floor(Number(composeQuantityDialog?.max) || 1))}
            initialValue={Math.max(1, Math.floor(Number(composeQuantityDialog?.current) || 1))}
            zIndex={31050}
            confirmLabel="确定"
            cancelLabel="取消"
            onConfirm={confirmComposeQuantityDialog}
            onCancel={() => setComposeQuantityDialog((prev) => ({ ...prev, open: false }))}
          />

          {battleResult && (
            <div className="pve-result-mask">
              <div className="pve-result-card">
                <h3>{battleResult.endReason || '战斗结束'}</h3>
                <div className="pve-result-grid">
                  <div>{`我方兵力：${battleResult.attacker.remain}/${battleResult.attacker.start}`}</div>
                  <div>{`守军兵力：${battleResult.defender.remain}/${battleResult.defender.start}`}</div>
                  <div>{`我方击杀：${battleResult.attacker.kills}`}</div>
                  <div>{`守军击杀：${battleResult.defender.kills}`}</div>
                  <div>{`建筑损毁：${battleResult.details?.buildingsDestroyed || 0}`}</div>
                  <div>{`战斗时长：${battleResult.durationSec}s`}</div>
                </div>
                {resultSaveError && <div className="intel-heist-tip" style={{ color: '#fca5a5' }}>{resultSaveError}</div>}
                <div className="pve-result-actions">
                  <button type="button" className="btn btn-secondary" onClick={closeModal}>返回围城</button>
                  <button
                    type="button"
                    className="btn btn-warning"
                    onClick={() => {
                      setPhase('compose');
                      setBattleResult(null);
                      simRef.current = null;
                      setPendingSkill(null);
                      setFloatingActionsPos(null);
                      setCardRows([]);
                      setActiveComposeMoveId('');
                    }}
                  >继续围城（重开）</button>
                </div>
                {postingResult && <div className="pve-compose-tip">正在保存战斗记录...</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PveBattleModal;
