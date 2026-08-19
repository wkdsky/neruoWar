const DEFAULT_MAP_ID = 'legacy-flat';
const DEFAULT_MAP_VERSION = 1;
const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';

export const TRAINING_MAP_WORLD_WIDTH = 7200;
export const TRAINING_MAP_WORLD_HEIGHT = 5008;
export const TRAINING_MAP_SCALE_MULTIPLIER = 8 / 3;

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const cloneMapValue = (value, fallback = null) => {
  try {
    return value === undefined ? fallback : JSON.parse(JSON.stringify(value));
  } catch (error) {
    return fallback;
  }
};

const normalizePreset = (preset = {}, fallbackId = 'full-jungle') => ({
  id: String(preset?.id || fallbackId),
  label: String(preset?.label || preset?.id || fallbackId),
  enabledTags: Array.isArray(preset?.enabledTags)
    ? preset.enabledTags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : []
});

const isEnabledForPreset = (entry = {}, enabledTags = new Set()) => {
  const tags = Array.isArray(entry?.presetTags)
    ? entry.presetTags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  return tags.length === 0 || tags.some((tag) => enabledTags.has(tag));
};

const isPointInsideTrainingMapPolygon = (point = {}, polygon = []) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  const targetX = finiteNumber(point?.x);
  const targetY = finiteNumber(point?.y);
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const currentPoint = polygon[index] || {};
    const previousPoint = polygon[previousIndex] || {};
    const currentY = finiteNumber(currentPoint?.y);
    const previousY = finiteNumber(previousPoint?.y);
    const intersects = ((currentY > targetY) !== (previousY > targetY))
      && (targetX < (((finiteNumber(previousPoint?.x) - finiteNumber(currentPoint?.x)) * (targetY - currentY)) / ((previousY - currentY) || 1e-9)) + finiteNumber(currentPoint?.x));
    if (intersects) inside = !inside;
  }
  return inside;
};

const resolveTrainingMapTriangleVertexWeight = (point = {}, triangle = []) => {
  if (!Array.isArray(triangle) || triangle.length !== 3) return null;
  const [vertex, second, third] = triangle;
  const pointX = finiteNumber(point?.x);
  const pointY = finiteNumber(point?.y);
  const vertexX = finiteNumber(vertex?.x);
  const vertexY = finiteNumber(vertex?.y);
  const secondX = finiteNumber(second?.x);
  const secondY = finiteNumber(second?.y);
  const thirdX = finiteNumber(third?.x);
  const thirdY = finiteNumber(third?.y);
  const denominator = ((secondY - thirdY) * (vertexX - thirdX)) + ((thirdX - secondX) * (vertexY - thirdY));
  if (Math.abs(denominator) <= 1e-9) return null;
  const vertexWeight = (((secondY - thirdY) * (pointX - thirdX)) + ((thirdX - secondX) * (pointY - thirdY))) / denominator;
  const secondWeight = (((thirdY - vertexY) * (pointX - thirdX)) + ((vertexX - thirdX) * (pointY - thirdY))) / denominator;
  const thirdWeight = 1 - vertexWeight - secondWeight;
  if (vertexWeight < -0.0001 || secondWeight < -0.0001 || thirdWeight < -0.0001) return null;
  return Math.min(1, Math.max(0, vertexWeight));
};

const resolveTrainingMapRegionElevation = (region = {}, point = {}) => {
  const elevation = Math.max(0, finiteNumber(region?.elevation));
  const baseElevation = Math.max(0, finiteNumber(region?.z));
  if (elevation <= 0) return baseElevation;
  const ramps = Array.isArray(region?.ramps) ? region.ramps : [];
  const rampElevation = ramps.reduce((value, ramp) => {
    if (value !== null) return value;
    const vertexWeight = resolveTrainingMapTriangleVertexWeight(point, ramp?.points);
    return vertexWeight === null
      ? null
      : baseElevation + (elevation * (1 - vertexWeight));
  }, null);
  return rampElevation === null ? baseElevation + elevation : rampElevation;
};

const isPointInsideTrainingMapTerrainRegion = (point = {}, region = {}) => {
  const shape = String(region?.shape || 'rect');
  const targetX = finiteNumber(point?.x);
  const targetY = finiteNumber(point?.y);
  if (shape === 'polygon') return isPointInsideTrainingMapPolygon(point, region?.points);
  const centerX = finiteNumber(region?.x);
  const centerY = finiteNumber(region?.y);
  const halfWidth = Math.max(0, finiteNumber(region?.width) * 0.5);
  const halfHeight = Math.max(0, finiteNumber(region?.height) * 0.5);
  if (shape === 'semicircle') {
    const radius = Math.max(0, finiteNumber(region?.radius, Math.min(halfWidth, halfHeight)));
    if (Math.hypot(targetX - centerX, targetY - centerY) > radius) return false;
    return region?.arcDirection === 'down' ? targetY <= centerY : targetY >= centerY;
  }
  return Math.abs(targetX - centerX) <= halfWidth && Math.abs(targetY - centerY) <= halfHeight;
};

const resolveTrainingMapFieldBounds = (mapConfig = null, field = null) => {
  const layout = mapConfig?.layoutMeta && typeof mapConfig.layoutMeta === 'object'
    ? mapConfig.layoutMeta
    : {};
  const width = finiteNumber(field?.width, finiteNumber(layout?.fieldWidth));
  const height = finiteNumber(field?.height, finiteNumber(layout?.fieldHeight));
  if (width <= 0 || height <= 0) return null;
  return { width, height };
};

const isPointInsideTrainingMapField = (point = {}, field = null) => (
  !field
  || (
    Math.abs(finiteNumber(point?.x)) <= field.width * 0.5
    && Math.abs(finiteNumber(point?.y)) <= field.height * 0.5
  )
);

const distanceToTrainingMapSegment = (point = {}, start = {}, end = {}) => {
  const startX = finiteNumber(start?.x);
  const startY = finiteNumber(start?.y);
  const deltaX = finiteNumber(end?.x) - startX;
  const deltaY = finiteNumber(end?.y) - startY;
  const lengthSquared = (deltaX * deltaX) + (deltaY * deltaY);
  if (lengthSquared <= 1e-9) {
    return Math.hypot(finiteNumber(point?.x) - startX, finiteNumber(point?.y) - startY);
  }
  const progress = Math.min(1, Math.max(0, (
    ((finiteNumber(point?.x) - startX) * deltaX)
    + ((finiteNumber(point?.y) - startY) * deltaY)
  ) / lengthSquared));
  return Math.hypot(
    finiteNumber(point?.x) - (startX + (deltaX * progress)),
    finiteNumber(point?.y) - (startY + (deltaY * progress))
  );
};

const isPointInsideTrainingMapLane = (point = {}, lane = {}) => {
  const width = Math.max(1, finiteNumber(lane?.width, 150));
  const centerline = Array.isArray(lane?.centerline) ? lane.centerline : [];
  if (centerline.length >= 2) {
    for (let index = 1; index < centerline.length; index += 1) {
      if (distanceToTrainingMapSegment(point, centerline[index - 1], centerline[index]) <= width * 0.5) {
        return true;
      }
    }
    return false;
  }
  return Math.abs(finiteNumber(point?.y) - finiteNumber(lane?.centerY)) <= width * 0.5;
};

const resolveClosestTrainingMapLaneSegment = (point = {}, centerline = []) => {
  const points = Array.isArray(centerline) ? centerline : [];
  let closest = {
    segmentIndex: 0,
    progress: 0,
    distance: Infinity
  };
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1] || {};
    const end = points[index] || {};
    const startX = finiteNumber(start?.x);
    const startY = finiteNumber(start?.y);
    const deltaX = finiteNumber(end?.x) - startX;
    const deltaY = finiteNumber(end?.y) - startY;
    const lengthSquared = (deltaX * deltaX) + (deltaY * deltaY);
    const progress = lengthSquared <= 1e-9
      ? 0
      : Math.min(1, Math.max(0, (
        ((finiteNumber(point?.x) - startX) * deltaX)
        + ((finiteNumber(point?.y) - startY) * deltaY)
      ) / lengthSquared));
    const projectedX = startX + (deltaX * progress);
    const projectedY = startY + (deltaY * progress);
    const distance = Math.hypot(
      finiteNumber(point?.x) - projectedX,
      finiteNumber(point?.y) - projectedY
    );
    if (distance < closest.distance) {
      closest = {
        segmentIndex: index - 1,
        progress,
        distance
      };
    }
  }
  return closest;
};

const getTrainingMapLaneDistance = (point = {}, lane = {}) => {
  const centerline = Array.isArray(lane?.centerline) ? lane.centerline : [];
  if (centerline.length >= 2) {
    return resolveClosestTrainingMapLaneSegment(point, centerline).distance;
  }
  return Math.abs(finiteNumber(point?.y) - finiteNumber(lane?.centerY));
};

const resolveTrainingMapTerrainCost = () => 1;

const resolveTrainingMapBaseTerrain = (regions = []) => {
  const entries = Array.isArray(regions) ? regions : [];
  return entries.find((region) => String(region?.type || '').startsWith('highland-'))
    || entries.find((region) => String(region?.type || '') === 'highland')
    || entries.find((region) => String(region?.type || '') !== 'grass')
    || entries[0]
    || null;
};

export const resolveTrainingMapTerrainElevation = (mapConfig = null, point = {}) => (
  (Array.isArray(mapConfig?.terrainRegions) ? mapConfig.terrainRegions : []).reduce((highestElevation, region) => {
    if (Math.max(0, finiteNumber(region?.elevation)) <= 0 || !isPointInsideTrainingMapTerrainRegion(point, region)) {
      return highestElevation;
    }
    return Math.max(highestElevation, resolveTrainingMapRegionElevation(region, point));
  }, 0)
);

export const sampleTrainingMapTerrain = (mapConfig = null, point = {}, { field = null } = {}) => {
  const navigation = mapConfig?.navigation && typeof mapConfig.navigation === 'object'
    ? mapConfig.navigation
    : {};
  const terrainRegions = Array.isArray(mapConfig?.terrainRegions) ? mapConfig.terrainRegions : [];
  const matchingRegions = terrainRegions.filter((region) => (
    isPointInsideTrainingMapTerrainRegion(point, region)
  ));
  const baseTerrain = resolveTrainingMapBaseTerrain(matchingRegions);
  const lane = (Array.isArray(mapConfig?.lanes) ? mapConfig.lanes : [])
    .find((entry) => isPointInsideTrainingMapLane(point, entry));
  const baseType = String(baseTerrain?.type || 'grass');
  const terrainType = lane ? 'road' : baseType;
  const centralSand = matchingRegions.find((region) => (
    String(region?.id || '') === 'sand-central'
    || String(region?.sourceRegionId || '') === 'sand-central'
  ));
  const resolvedField = resolveTrainingMapFieldBounds(mapConfig, field);
  const insideBattlefield = isPointInsideTrainingMapField(point, resolvedField);
  const outsideBattlefieldWalkable = navigation?.outsideBattlefieldWalkable === true;
  const walkable = insideBattlefield || outsideBattlefieldWalkable;

  return {
    id: lane ? `terrain-road-${String(lane?.id || 'lane')}` : String(baseTerrain?.id || 'terrain-grass'),
    type: terrainType,
    baseTerrainId: String(baseTerrain?.id || 'terrain-grass'),
    baseType,
    laneId: lane ? String(lane?.id || '') : '',
    regionIds: matchingRegions.map((region) => String(region?.id || '')).filter(Boolean),
    walkable,
    movementCost: resolveTrainingMapTerrainCost(terrainType, navigation),
    elevation: resolveTrainingMapTerrainElevation(mapConfig, point),
    isCentralSand: !!centralSand
  };
};

export const isTrainingMapTerrainWalkable = (mapConfig = null, point = {}, options = {}) => (
  sampleTrainingMapTerrain(mapConfig, point, options).walkable
);

export const normalizeTrainingMapConfig = (battlefield = {}) => {
  const rawMap = battlefield?.map && typeof battlefield.map === 'object'
    ? battlefield.map
    : null;
  const mapId = String(rawMap?.mapId || battlefield?.mapId || DEFAULT_MAP_ID);
  const mapVersion = Math.max(1, Math.floor(finiteNumber(rawMap?.mapVersion ?? battlefield?.mapVersion, DEFAULT_MAP_VERSION)));
  if (!rawMap || mapId === DEFAULT_MAP_ID) {
    return {
      enabled: false,
      mapId,
      mapVersion,
      activePresetId: 'legacy-flat',
      presets: [],
      terrainRegions: [],
      spawnRegions: [],
      lanes: [],
      deploySlots: [],
      objectives: [],
      objects: [],
      navigation: null,
      movementCalibration: null,
      layoutMeta: null,
      teamPresentation: {},
      referenceGeometry: null
    };
  }

  const defaultPresetId = String(rawMap?.defaultPresetId || 'full-jungle');
  const presets = (Array.isArray(rawMap?.presets) ? rawMap.presets : [])
    .map((preset) => normalizePreset(preset, defaultPresetId));
  const requestedPresetId = String(rawMap?.activePresetId || defaultPresetId);
  const activePreset = presets.find((preset) => preset.id === requestedPresetId)
    || presets.find((preset) => preset.id === defaultPresetId)
    || normalizePreset({}, defaultPresetId);
  const enabledTags = new Set(activePreset.enabledTags);
  const allObjects = Array.isArray(rawMap?.objects) ? rawMap.objects : [];
  const activeObjectIds = new Set(
    Array.isArray(rawMap?.activeObjects)
      ? rawMap.activeObjects.map((objectId) => String(objectId || '')).filter(Boolean)
      : []
  );
  const allObjectives = Array.isArray(rawMap?.objectives) ? rawMap.objectives : [];
  const activeObjectiveIds = new Set(
    Array.isArray(rawMap?.activeObjectives)
      ? rawMap.activeObjectives.map((objectiveId) => String(objectiveId || '')).filter(Boolean)
      : []
  );
  const activeObjects = allObjects.filter((entry) => (
    activeObjectIds.size > 0
      ? activeObjectIds.has(String(entry?.objectId || ''))
      : isEnabledForPreset(entry, enabledTags)
  ));
  const activeObjectives = allObjectives.filter((entry) => (
    activeObjectiveIds.size > 0
      ? activeObjectiveIds.has(String(entry?.objectiveId || ''))
      : isEnabledForPreset(entry, enabledTags)
  ));

  return {
    enabled: true,
    mapId,
    mapVersion,
    activePresetId: activePreset.id,
    defaultPresetId,
    presets,
    terrainRegions: Array.isArray(rawMap?.terrainRegions) ? rawMap.terrainRegions : [],
    spawnRegions: Array.isArray(rawMap?.spawnRegions) ? rawMap.spawnRegions : [],
    lanes: Array.isArray(rawMap?.lanes) ? rawMap.lanes : [],
    deploySlots: Array.isArray(rawMap?.deploySlots) ? rawMap.deploySlots : [],
    movementCalibration: rawMap?.movementCalibration && typeof rawMap.movementCalibration === 'object'
      ? rawMap.movementCalibration
      : (rawMap?.layoutMeta?.movementCalibration && typeof rawMap.layoutMeta.movementCalibration === 'object'
        ? rawMap.layoutMeta.movementCalibration
        : null),
    layoutMeta: rawMap?.layoutMeta && typeof rawMap.layoutMeta === 'object'
      ? rawMap.layoutMeta
      : null,
    objectives: activeObjectives,
    allObjectives,
    objects: activeObjects,
    allObjects,
    navigation: rawMap?.navigation && typeof rawMap.navigation === 'object' ? rawMap.navigation : null,
    teamPresentation: rawMap?.teamPresentation && typeof rawMap.teamPresentation === 'object'
      ? rawMap.teamPresentation
      : {},
    referenceGeometry: rawMap?.referenceGeometry && typeof rawMap.referenceGeometry === 'object'
      ? rawMap.referenceGeometry
      : null
  };
};

export const resolveTrainingMapPreset = (mapConfig = null, presetId = '') => {
  if (!mapConfig?.enabled) return null;
  const requestedId = String(presetId || mapConfig?.activePresetId || '');
  return (Array.isArray(mapConfig?.presets) ? mapConfig.presets : [])
    .find((preset) => preset?.id === requestedId)
    || null;
};

export const resolveTrainingMapElementsForPreset = (mapConfig = null, presetId = '') => {
  if (!mapConfig?.enabled) return { objects: [], objectives: [], presetId: 'legacy-flat' };
  const preset = resolveTrainingMapPreset(mapConfig, presetId)
    || resolveTrainingMapPreset(mapConfig, mapConfig?.defaultPresetId)
    || { id: mapConfig?.activePresetId || 'full-jungle', enabledTags: [] };
  const enabledTags = new Set(Array.isArray(preset?.enabledTags) ? preset.enabledTags : []);
  return {
    presetId: String(preset?.id || mapConfig?.activePresetId || 'full-jungle'),
    objects: (Array.isArray(mapConfig?.allObjects) ? mapConfig.allObjects : mapConfig.objects || [])
      .filter((entry) => isEnabledForPreset(entry, enabledTags)),
    objectives: (Array.isArray(mapConfig?.allObjectives) ? mapConfig.allObjectives : mapConfig.objectives || [])
      .filter((entry) => isEnabledForPreset(entry, enabledTags))
  };
};

export const cloneTrainingMapElementsForPreset = (mapConfig = null, presetId = '') => {
  const elements = resolveTrainingMapElementsForPreset(mapConfig, presetId);
  return {
    ...elements,
    objects: cloneMapValue(elements.objects, []),
    objectives: cloneMapValue(elements.objectives, [])
  };
};

export const getTrainingMapDeploySlots = (mapConfig = null, team = '') => (
  (Array.isArray(mapConfig?.deploySlots) ? mapConfig.deploySlots : [])
    .filter((slot) => !team || slot?.team === team)
    .map((slot) => ({
      id: String(slot?.id || ''),
      team: slot?.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER,
      laneId: String(slot?.laneId || ''),
      label: String(slot?.label || ''),
      spawnRegionId: String(slot?.spawnRegionId || ''),
      x: finiteNumber(slot?.x),
      y: finiteNumber(slot?.y)
    }))
);

export const resolveTrainingMapLane = (mapConfig = null, point = {}, fallback = '') => {
  const lanes = Array.isArray(mapConfig?.lanes) ? mapConfig.lanes : [];
  if (lanes.length <= 0) return fallback;
  let closest = null;
  let closestDistance = Infinity;
  lanes.forEach((lane) => {
    const distance = getTrainingMapLaneDistance(point, lane);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = lane;
    }
  });
  const laneWidth = Math.max(1, finiteNumber(closest?.width, 150));
  if (closestDistance <= laneWidth * 0.72) return String(closest?.id || fallback);
  return fallback || 'jungle';
};

export const resolveTrainingMapTeamPresentation = (mapConfig = null, team = TEAM_ATTACKER) => {
  const fallback = team === TEAM_DEFENDER
    ? { label: '敌方高地', color: '#32b4bd', direction: 'left' }
    : { label: '我方高地', color: '#d95155', direction: 'right' };
  const candidate = mapConfig?.teamPresentation?.[team];
  return {
    label: String(candidate?.label || fallback.label),
    color: String(candidate?.color || fallback.color),
    direction: String(candidate?.direction || fallback.direction)
  };
};

export const isTrainingMapConfig = (mapConfig = null) => !!mapConfig?.enabled && mapConfig?.mapId !== DEFAULT_MAP_ID;
