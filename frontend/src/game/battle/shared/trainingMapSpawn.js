import { getTrainingMapDeploySlots } from './trainingMap';

const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const POINT_EPSILON = 1e-5;

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const normalizeTeam = (team = TEAM_ATTACKER) => (
  team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER
);

const normalizeField = (field = {}, mapConfig = null) => {
  const layout = mapConfig?.layoutMeta && typeof mapConfig.layoutMeta === 'object'
    ? mapConfig.layoutMeta
    : {};
  const width = finiteNumber(field?.width, finiteNumber(layout?.fieldWidth));
  const height = finiteNumber(field?.height, finiteNumber(layout?.fieldHeight));
  return width > 0 && height > 0 ? { width, height } : null;
};

const toPoint = (value = {}) => {
  if (Array.isArray(value)) {
    return { x: finiteNumber(value[0]), y: finiteNumber(value[1]) };
  }
  return { x: finiteNumber(value?.x), y: finiteNumber(value?.y) };
};

const toWorldPoint = (value = {}, field = null) => {
  const normalized = toPoint(value);
  if (!field) return normalized;
  return {
    x: (normalized.x - 0.5) * field.width,
    y: (0.5 - normalized.y) * field.height
  };
};

const isPointOnSegment = (point = {}, start = {}, end = {}) => {
  const px = finiteNumber(point?.x);
  const py = finiteNumber(point?.y);
  const sx = finiteNumber(start?.x);
  const sy = finiteNumber(start?.y);
  const ex = finiteNumber(end?.x);
  const ey = finiteNumber(end?.y);
  const cross = ((px - sx) * (ey - sy)) - ((py - sy) * (ex - sx));
  if (Math.abs(cross) > POINT_EPSILON) return false;
  return px >= Math.min(sx, ex) - POINT_EPSILON
    && px <= Math.max(sx, ex) + POINT_EPSILON
    && py >= Math.min(sy, ey) - POINT_EPSILON
    && py <= Math.max(sy, ey) + POINT_EPSILON;
};

const isPointInsidePolygon = (point = {}, polygon = []) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  const target = toPoint(point);
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = toPoint(polygon[index]);
    const previous = toPoint(polygon[previousIndex]);
    if (isPointOnSegment(target, previous, current)) return true;
    const intersects = ((current.y > target.y) !== (previous.y > target.y))
      && (target.x < (((previous.x - current.x) * (target.y - current.y)) / ((previous.y - current.y) || POINT_EPSILON)) + current.x);
    if (intersects) inside = !inside;
  }
  return inside;
};

const resolveSpawnPolygon = (region = {}, field = null) => {
  const normalizedPolygon = Array.isArray(region?.normalizedPolygon) ? region.normalizedPolygon : [];
  if (normalizedPolygon.length >= 3 && field) {
    return normalizedPolygon.map((point) => toWorldPoint(point, field));
  }
  const worldPolygon = Array.isArray(region?.worldPolygon)
    ? region.worldPolygon
    : (Array.isArray(region?.polygon) ? region.polygon : region?.points);
  return Array.isArray(worldPolygon) ? worldPolygon.map((point) => toPoint(point)) : [];
};

const laneSortRank = (laneId = '') => {
  const lane = String(laneId || '').trim().toLowerCase();
  if (lane === 'top') return 0;
  if (lane === 'mid') return 1;
  if (lane === 'bottom') return 2;
  return 3;
};

const stableHash = (value = '') => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const getTrainingMapSpawnRegions = (mapConfig = null, { field = null, team = '' } = {}) => {
  const resolvedField = normalizeField(field, mapConfig);
  const requestedTeam = team === TEAM_ATTACKER || team === TEAM_DEFENDER ? team : '';
  return (Array.isArray(mapConfig?.spawnRegions) ? mapConfig.spawnRegions : [])
    .map((region, index) => {
      const regionTeam = normalizeTeam(region?.team);
      const polygon = resolveSpawnPolygon(region, resolvedField);
      return {
        id: String(region?.id || `spawn-${regionTeam}-${index + 1}`),
        team: regionTeam,
        laneId: String(region?.laneId || region?.laneAffinity || ''),
        walkable: region?.walkable !== false,
        polygon
      };
    })
    .filter((region) => (
      region.polygon.length >= 3
      && (!requestedTeam || region.team === requestedTeam)
    ));
};

export const hasTrainingMapSpawnRegions = (mapConfig = null, options = {}) => (
  getTrainingMapSpawnRegions(mapConfig, options).length > 0
);

export const getTrainingMapSpawnRegionAtPoint = (
  mapConfig = null,
  point = {},
  { field = null, team = '' } = {}
) => (
  getTrainingMapSpawnRegions(mapConfig, { field, team })
    .find((region) => region.walkable && isPointInsidePolygon(point, region.polygon))
  || null
);

export const isTrainingMapSpawnPoint = (mapConfig = null, point = {}, options = {}) => (
  !!getTrainingMapSpawnRegionAtPoint(mapConfig, point, options)
);

export const resolveTrainingMapSpawnMetadata = (
  mapConfig = null,
  point = {},
  { field = null, team = TEAM_ATTACKER, slot = null } = {}
) => {
  const safeTeam = normalizeTeam(team);
  const regions = getTrainingMapSpawnRegions(mapConfig, { field, team: safeTeam });
  const requestedRegionId = String(slot?.spawnRegionId || '').trim();
  const region = regions.find((entry) => entry.id === requestedRegionId)
    || getTrainingMapSpawnRegionAtPoint(mapConfig, point, { field, team: safeTeam });
  return {
    spawnSlotId: String(slot?.id || ''),
    spawnRegionId: String(region?.id || requestedRegionId),
    spawnLaneId: String(region?.laneId || slot?.laneId || ''),
    initialFacingRad: safeTeam === TEAM_DEFENDER ? Math.PI : 0
  };
};

export const getTrainingMapBalancedDeploySlots = (
  mapConfig = null,
  team = TEAM_ATTACKER,
  { field = null, seed = '' } = {}
) => {
  const safeTeam = normalizeTeam(team);
  const regions = getTrainingMapSpawnRegions(mapConfig, { field, team: safeTeam });
  if (regions.length <= 0) return [];
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const grouped = new Map();
  getTrainingMapDeploySlots(mapConfig, safeTeam).forEach((slot) => {
    const byId = regionById.get(String(slot?.spawnRegionId || ''));
    const byPoint = byId || getTrainingMapSpawnRegionAtPoint(mapConfig, slot, { field, team: safeTeam });
    if (!byPoint || !byPoint.walkable) return;
    const groupId = byPoint.id;
    const entries = grouped.get(groupId) || [];
    entries.push({
      ...slot,
      spawnRegionId: groupId,
      laneId: String(slot?.laneId || byPoint.laneId || '')
    });
    grouped.set(groupId, entries);
  });
  const groups = Array.from(grouped.entries())
    .map(([regionId, slots]) => ({
      region: regionById.get(regionId),
      slots: slots.slice().sort((left, right) => (
        String(left?.id || '').localeCompare(String(right?.id || ''))
        || Number(right?.y || 0) - Number(left?.y || 0)
      ))
    }))
    .filter((entry) => entry.region && entry.slots.length > 0)
    .sort((left, right) => (
      laneSortRank(left.region.laneId) - laneSortRank(right.region.laneId)
      || left.region.id.localeCompare(right.region.id)
    ));
  if (groups.length <= 0) return [];
  const seedText = String(seed || `${mapConfig?.mapId || 'training-map'}:${mapConfig?.mapVersion || 1}`);
  const startIndex = stableHash(`${seedText}:${safeTeam}:region`) % groups.length;
  const maxSlots = Math.max(...groups.map((group) => group.slots.length));
  const ordered = [];
  for (let slotIndex = 0; slotIndex < maxSlots; slotIndex += 1) {
    for (let offset = 0; offset < groups.length; offset += 1) {
      const group = groups[(startIndex + offset) % groups.length];
      if (slotIndex >= group.slots.length) continue;
      const localOffset = stableHash(`${seedText}:${safeTeam}:${group.region.id}`) % group.slots.length;
      ordered.push(group.slots[(slotIndex + localOffset) % group.slots.length]);
    }
  }
  return ordered;
};
