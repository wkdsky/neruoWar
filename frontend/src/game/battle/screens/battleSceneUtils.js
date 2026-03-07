import { TEAM_DEFENDER } from './battleSceneConstants';

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const resolveBattleDebugSwitch = () => {
  if (typeof window === 'undefined') return { enabled: false, steeringWeights: null };
  const raw = window.__BATTLE_DEBUG__;
  if (raw === true) return { enabled: true, steeringWeights: null };
  if (!raw || typeof raw !== 'object') return { enabled: false, steeringWeights: null };
  return {
    enabled: raw.enabled !== false,
    steeringWeights: raw.steeringWeights && typeof raw.steeringWeights === 'object'
      ? raw.steeringWeights
      : null
  };
};

export const skillRangeByClass = (classTag) => {
  if (classTag === 'cavalry') return 220;
  if (classTag === 'archer') return 260;
  if (classTag === 'artillery') return 310;
  return 180;
};

export const skillAoeRadiusByClass = (classTag) => {
  if (classTag === 'archer') return 72;
  if (classTag === 'artillery') return 126;
  return 24;
};

export const toCardsByTeam = (cards = []) => (
  Array.isArray(cards) ? cards : []
);

export const buildCompatSummaryPayload = (summary = {}) => ({
  battleId: summary?.battleId || '',
  gateKey: summary?.gateKey || '',
  durationSec: Math.max(0, Math.floor(Number(summary?.durationSec) || 0)),
  attacker: {
    start: Math.max(0, Math.floor(Number(summary?.attacker?.start) || 0)),
    remain: Math.max(0, Math.floor(Number(summary?.attacker?.remain) || 0)),
    kills: Math.max(0, Math.floor(Number(summary?.attacker?.kills) || 0))
  },
  defender: {
    start: Math.max(0, Math.floor(Number(summary?.defender?.start) || 0)),
    remain: Math.max(0, Math.floor(Number(summary?.defender?.remain) || 0)),
    kills: Math.max(0, Math.floor(Number(summary?.defender?.kills) || 0))
  },
  details: summary?.details && typeof summary.details === 'object' ? summary.details : {},
  startedAt: summary?.startedAt || null,
  endedAt: summary?.endedAt || null,
  endReason: summary?.endReason || ''
});

export const normalizeDraftUnits = (units = []) => (
  (Array.isArray(units) ? units : [])
    .map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    }))
    .filter((entry) => entry.unitTypeId && entry.count > 0)
);

export const unitsToMap = (units = []) => {
  const map = {};
  normalizeDraftUnits(units).forEach((entry) => {
    map[entry.unitTypeId] = (map[entry.unitTypeId] || 0) + entry.count;
  });
  return map;
};

export const unitsToSummary = (units = [], unitNameByTypeId = new Map()) => (
  normalizeDraftUnits(units)
    .map((entry) => `${unitNameByTypeId.get(entry.unitTypeId) || entry.unitTypeId}x${entry.count}`)
    .join(' / ')
);

export const normalizeUnitsMapCounts = (units = {}) => {
  const map = {};
  Object.entries(units || {}).forEach(([unitTypeId, rawCount]) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    const safeCount = Math.max(0, Math.floor(Number(rawCount) || 0));
    if (!safeId || safeCount <= 0) return;
    map[safeId] = safeCount;
  });
  return map;
};

export const normalizeTemplateUnits = (units = []) => (
  (Array.isArray(units) ? units : [])
    .map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
      unitName: typeof entry?.unitName === 'string' ? entry.unitName.trim() : '',
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    }))
    .filter((entry) => entry.unitTypeId && entry.count > 0)
);

export const parseQuickDeployNumber = (input) => {
  if (typeof input === 'number' && Number.isFinite(input)) return Math.floor(input);
  if (typeof input !== 'string') return NaN;
  const compact = input.trim().replace(/[,\s，_]/g, '');
  if (!compact) return NaN;
  let multiplier = 1;
  let numberPart = compact;
  if (compact.endsWith('万')) {
    multiplier = 10000;
    numberPart = compact.slice(0, -1);
  }
  if (!/^-?\d+(\.\d+)?$/.test(numberPart)) return NaN;
  const parsed = Number(numberPart);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.floor(parsed * multiplier);
};

export const splitTotalEvenly = (total, parts) => {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const safeParts = Math.max(1, Math.floor(Number(parts) || 1));
  const base = Math.floor(safeTotal / safeParts);
  const remainder = safeTotal - (base * safeParts);
  return Array.from({ length: safeParts }, (_, idx) => base + (idx < remainder ? 1 : 0));
};

export const splitTotalRandomly = (total, parts) => {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const safeParts = Math.max(1, Math.floor(Number(parts) || 1));
  const base = Array.from({ length: safeParts }, () => 1);
  let remain = safeTotal - safeParts;
  if (remain <= 0) return base;
  const weights = Array.from({ length: safeParts }, () => 0.25 + Math.random());
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const alloc = weights.map((weight) => Math.floor((weight / Math.max(1e-6, weightSum)) * remain));
  remain -= alloc.reduce((sum, value) => sum + value, 0);
  const rank = weights
    .map((weight, idx) => ({
      idx,
      score: ((weight / Math.max(1e-6, weightSum)) * (safeTotal - safeParts)) - alloc[idx]
    }))
    .sort((a, b) => b.score - a.score);
  for (let i = 0; i < remain; i += 1) {
    alloc[rank[i % rank.length].idx] += 1;
  }
  return base.map((value, idx) => value + alloc[idx]);
};

export const randomPickUnique = (values = [], count = 1) => {
  const list = Array.isArray(values) ? [...values] : [];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, Math.max(1, Math.floor(Number(count) || 1)));
};

export const buildTeamPositions = ({ team, count, field, deployRange, jitter = true }) => {
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  const safeFieldW = Math.max(120, Number(field?.width) || 2700);
  const safeFieldH = Math.max(120, Number(field?.height) || 1488);
  const safeRange = deployRange && typeof deployRange === 'object'
    ? deployRange
    : {
        minX: -safeFieldW / 2,
        maxX: safeFieldW / 2,
        attackerMaxX: -safeFieldW * 0.3,
        defenderMinX: safeFieldW * 0.3
      };

  const zoneMinX = team === TEAM_DEFENDER ? Number(safeRange.defenderMinX) || 0 : Number(safeRange.minX) || 0;
  const zoneMaxX = team === TEAM_DEFENDER ? Number(safeRange.maxX) || 0 : Number(safeRange.attackerMaxX) || 0;
  const usableMinX = Math.min(zoneMinX, zoneMaxX) + 8;
  const usableMaxX = Math.max(zoneMinX, zoneMaxX) - 8;
  const zoneCenterX = (usableMinX + usableMaxX) * 0.5;
  const zoneSpan = Math.max(18, usableMaxX - usableMinX);
  const compactSpan = Math.max(20, Math.min(zoneSpan * 0.72, 168));
  const minX = clamp(zoneCenterX - compactSpan * 0.5, usableMinX, usableMaxX);
  const maxX = clamp(zoneCenterX + compactSpan * 0.5, usableMinX, usableMaxX);
  const minY = -safeFieldH * 0.42;
  const maxY = safeFieldH * 0.42;

  const cols = Math.max(1, Math.ceil(Math.sqrt(safeCount)));
  const rows = Math.max(1, Math.ceil(safeCount / cols));
  const jitterX = Math.max(1, Math.min(14, (maxX - minX) / Math.max(2, cols + 1)));
  const jitterY = Math.max(1, Math.min(16, (maxY - minY) / Math.max(2, rows + 1)));

  return Array.from({ length: safeCount }, (_, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const tx = cols <= 1 ? 0.5 : (col / (cols - 1));
    const ty = rows <= 1 ? 0.5 : (row / (rows - 1));
    const rx = jitter ? ((Math.random() * 2 - 1) * jitterX) : 0;
    const ry = jitter ? ((Math.random() * 2 - 1) * jitterY) : 0;
    return {
      x: clamp(minX + ((maxX - minX) * tx) + rx, usableMinX, usableMaxX),
      y: clamp(minY + ((maxY - minY) * ty) + ry, -safeFieldH / 2 + 8, safeFieldH / 2 - 8)
    };
  });
};

export const buildDomLineStyle = (fromPoint, toPoint) => {
  const ax = Number(fromPoint?.x);
  const ay = Number(fromPoint?.y);
  const bx = Number(toPoint?.x);
  const by = Number(toPoint?.y);
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-3) return null;
  return {
    left: `${ax}px`,
    top: `${ay}px`,
    width: `${len}px`,
    transform: `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`
  };
};

export const buildDeployFormationFootprint = (group = null) => {
  if (!group || !group.formationRect) return null;
  const width = Math.max(2, Number(group.formationRect.width) || 0);
  const depth = Math.max(2, Number(group.formationRect.depth) || 0);
  const yaw = Number.isFinite(Number(group.formationRect.facingRad))
    ? Number(group.formationRect.facingRad)
    : (group?.team === TEAM_DEFENDER ? Math.PI : 0);
  const cx = Number(group.x) || 0;
  const cy = Number(group.y) || 0;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  const sx = -fy;
  const sy = fx;
  const corner = (sideSign, frontSign) => ({
    x: cx + (sx * halfW * sideSign) + (fx * halfD * frontSign),
    y: cy + (sy * halfW * sideSign) + (fy * halfD * frontSign)
  });
  return {
    width,
    depth,
    area: Math.max(1, Number(group.formationRect.area) || (width * depth)),
    sideAxis: { x: sx, y: sy },
    corners: [
      corner(-1, 1),
      corner(1, 1),
      corner(1, -1),
      corner(-1, -1)
    ],
    leftHandle: {
      x: cx - (sx * halfW),
      y: cy - (sy * halfW)
    },
    rightHandle: {
      x: cx + (sx * halfW),
      y: cy + (sy * halfW)
    }
  };
};

export const computeDeployOverviewDistance = (field = null) => {
  const width = Math.max(120, Number(field?.width) || 2700);
  const height = Math.max(120, Number(field?.height) || 1488);
  const dominantSpan = Math.max(width, height * 1.2);
  return clamp(dominantSpan * 1.18, 360, 980);
};

export const buildStandardGroups = ({ teamLabel, teamCount, totalPeople, rosterRows = [] }) => {
  const unitTypeIds = rosterRows
    .map((row) => row?.unitTypeId)
    .filter((unitTypeId) => typeof unitTypeId === 'string' && unitTypeId);
  const totals = splitTotalEvenly(totalPeople, teamCount);
  return totals.map((groupTotal, idx) => {
    const primaryId = unitTypeIds[idx % unitTypeIds.length];
    const secondaryId = unitTypeIds.length > 1 ? unitTypeIds[(idx + 1) % unitTypeIds.length] : '';
    if (!secondaryId || groupTotal < 8) {
      return {
        name: `${teamLabel}标准${idx + 1}`,
        units: { [primaryId]: groupTotal }
      };
    }
    const secondaryCount = clamp(Math.floor(groupTotal * 0.3), 1, Math.max(1, groupTotal - 1));
    return {
      name: `${teamLabel}标准${idx + 1}`,
      units: {
        [primaryId]: groupTotal - secondaryCount,
        [secondaryId]: secondaryCount
      }
    };
  });
};

export const buildRandomGroups = ({ teamLabel, teamCount, totalPeople, rosterRows = [] }) => {
  const unitTypeIds = rosterRows
    .map((row) => row?.unitTypeId)
    .filter((unitTypeId) => typeof unitTypeId === 'string' && unitTypeId);
  const groupTotals = splitTotalRandomly(totalPeople, teamCount);
  return groupTotals.map((groupTotal, idx) => {
    const typeCount = clamp(1 + Math.floor(Math.random() * 3), 1, Math.min(unitTypeIds.length, groupTotal));
    const pickedTypeIds = randomPickUnique(unitTypeIds, typeCount);
    const typeTotals = splitTotalRandomly(groupTotal, pickedTypeIds.length);
    const units = {};
    pickedTypeIds.forEach((unitTypeId, typeIdx) => {
      units[unitTypeId] = (units[unitTypeId] || 0) + (typeTotals[typeIdx] || 0);
    });
    return {
      name: `${teamLabel}随机${idx + 1}`,
      units
    };
  });
};
