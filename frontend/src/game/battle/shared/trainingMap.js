const DEFAULT_MAP_ID = 'legacy-flat';
const DEFAULT_MAP_VERSION = 1;
const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';

export const TRAINING_MAP_WORLD_WIDTH = 12600;
export const TRAINING_MAP_WORLD_HEIGHT = 8764;
export const TRAINING_MAP_SCALE_MULTIPLIER = 14 / 3;

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

const resolveTrainingMapTriangleWeights = (point = {}, triangle = []) => {
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
  return [vertexWeight, secondWeight, thirdWeight].map((weight) => (
    Math.min(1, Math.max(0, weight))
  ));
};

const resolveTrainingMapRampElevation = (point = {}, ramp = {}, baseElevation = 0, elevation = 0) => {
  const points = Array.isArray(ramp?.points) ? ramp.points : [];
  if (points.length === 3) {
    const weights = resolveTrainingMapTriangleWeights(point, points);
    return weights === null
      ? null
      : baseElevation + (elevation * (weights[1] + weights[2]));
  }
  if (points.length !== 4) return null;
  const [lowStart, highlandStart, highlandEnd, lowEnd] = points;
  const upperTriangleWeights = resolveTrainingMapTriangleWeights(point, [
    lowStart,
    highlandStart,
    highlandEnd
  ]);
  if (upperTriangleWeights !== null) {
    return baseElevation + (elevation * (upperTriangleWeights[1] + upperTriangleWeights[2]));
  }
  const lowerTriangleWeights = resolveTrainingMapTriangleWeights(point, [
    lowStart,
    highlandEnd,
    lowEnd
  ]);
  return lowerTriangleWeights === null
    ? null
    : baseElevation + (elevation * lowerTriangleWeights[1]);
};

const resolveTrainingMapRegionElevation = (region = {}, point = {}) => {
  const elevation = Math.max(0, finiteNumber(region?.elevation));
  const baseElevation = Math.max(0, finiteNumber(region?.z));
  if (elevation <= 0) return baseElevation;
  const ramps = Array.isArray(region?.ramps) ? region.ramps : [];
  const rampElevation = ramps.reduce((value, ramp) => {
    if (value !== null) return value;
    return resolveTrainingMapRampElevation(point, ramp, baseElevation, elevation);
  }, null);
  return rampElevation === null ? baseElevation + elevation : rampElevation;
};

export const isPointInsideTrainingMapTerrainRegion = (point = {}, region = {}) => {
  const shape = String(region?.shape || 'rect');
  const targetX = finiteNumber(point?.x);
  const targetY = finiteNumber(point?.y);
  if (shape === 'polygon' || (Array.isArray(region?.points) && region.points.length >= 3)) {
    return isPointInsideTrainingMapPolygon(point, region?.points);
  }
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

const isTrainingMapHighlandRegion = (region = {}) => (
  String(region?.type || '').startsWith('highland-')
  || String(region?.type || '') === 'highland'
);

const resolveTrainingMapTerrainRegionPolygon = (region = {}) => {
  if (
    String(region?.shape || 'rect') === 'polygon'
    || (Array.isArray(region?.points) && region.points.length >= 3)
  ) {
    return Array.isArray(region?.points) ? region.points.filter(Boolean) : [];
  }
  const halfWidth = Math.max(0, finiteNumber(region?.width) * 0.5);
  const halfHeight = Math.max(0, finiteNumber(region?.height) * 0.5);
  if (halfWidth <= 0 || halfHeight <= 0) return [];
  const centerX = finiteNumber(region?.x);
  const centerY = finiteNumber(region?.y);
  return [
    { x: centerX - halfWidth, y: centerY - halfHeight },
    { x: centerX + halfWidth, y: centerY - halfHeight },
    { x: centerX + halfWidth, y: centerY + halfHeight },
    { x: centerX - halfWidth, y: centerY + halfHeight }
  ];
};

const resolveTrainingMapSegmentIntersectionProgress = (start = {}, end = {}, edgeStart = {}, edgeEnd = {}) => {
  const startX = finiteNumber(start?.x);
  const startY = finiteNumber(start?.y);
  const deltaX = finiteNumber(end?.x) - startX;
  const deltaY = finiteNumber(end?.y) - startY;
  const edgeX = finiteNumber(edgeStart?.x);
  const edgeY = finiteNumber(edgeStart?.y);
  const edgeDeltaX = finiteNumber(edgeEnd?.x) - edgeX;
  const edgeDeltaY = finiteNumber(edgeEnd?.y) - edgeY;
  const denominator = (deltaX * edgeDeltaY) - (deltaY * edgeDeltaX);
  if (Math.abs(denominator) <= 1e-9) return null;
  const relativeX = edgeX - startX;
  const relativeY = edgeY - startY;
  const segmentProgress = ((relativeX * edgeDeltaY) - (relativeY * edgeDeltaX)) / denominator;
  const edgeProgress = ((relativeX * deltaY) - (relativeY * deltaX)) / denominator;
  if (
    segmentProgress < -1e-7
    || segmentProgress > 1.0000001
    || edgeProgress < -1e-7
    || edgeProgress > 1.0000001
  ) return null;
  return Math.min(1, Math.max(0, segmentProgress));
};

const resolveTrainingMapPointOnSegment = (start = {}, end = {}, progress = 0) => ({
  x: finiteNumber(start?.x) + ((finiteNumber(end?.x) - finiteNumber(start?.x)) * progress),
  y: finiteNumber(start?.y) + ((finiteNumber(end?.y) - finiteNumber(start?.y)) * progress)
});

const isPointInsideOrNearTrainingMapPolygon = (point = {}, polygon = [], tolerance = 0) => {
  if (isPointInsideTrainingMapPolygon(point, polygon)) return true;
  const padding = Math.max(0, finiteNumber(tolerance));
  if (padding <= 0 || !Array.isArray(polygon) || polygon.length < 2) return false;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (distanceToTrainingMapSegment(point, start, end) <= padding) return true;
  }
  return false;
};

const isTrainingMapHighlandBoundaryCrossing = ({
  start = {},
  end = {},
  region = {},
  progress = 0,
  tolerance = 0.75
} = {}) => {
  const ramps = Array.isArray(region?.ramps) ? region.ramps : [];
  if (ramps.length <= 0) return false;
  const distance = Math.hypot(
    finiteNumber(end?.x) - finiteNumber(start?.x),
    finiteNumber(end?.y) - finiteNumber(start?.y)
  );
  const probe = Math.min(0.035, Math.max(0.0002, Math.max(0.5, tolerance) / Math.max(1, distance)));
  const samples = [
    resolveTrainingMapPointOnSegment(start, end, progress),
    resolveTrainingMapPointOnSegment(start, end, Math.max(0, progress - probe)),
    resolveTrainingMapPointOnSegment(start, end, Math.min(1, progress + probe))
  ];
  return ramps.some((ramp) => {
    const points = Array.isArray(ramp?.points) ? ramp.points.filter(Boolean) : [];
    return points.length >= 3 && samples.some((sample) => (
      isPointInsideOrNearTrainingMapPolygon(sample, points, tolerance)
    ));
  });
};

/**
 * A terrain point can be walkable while the straight segment to it is not.
 * Highland plateaus are therefore treated as topology islands: every crossing
 * of a plateau boundary must occur through one of that region's ramp polygons.
 * Navigation and movement commits share this helper so a formation transform
 * cannot bypass the A* terrain rules.
 */
export const isTrainingMapTerrainSegmentTraversable = (
  mapConfig = null,
  start = {},
  end = {},
  { field = null, rampTolerance = 0.75, maxSamples = 24 } = {}
) => {
  const startTerrain = sampleTrainingMapTerrain(mapConfig, start, { field });
  const endTerrain = sampleTrainingMapTerrain(mapConfig, end, { field });
  if (!startTerrain.walkable || !endTerrain.walkable) return false;

  const distance = Math.hypot(
    finiteNumber(end?.x) - finiteNumber(start?.x),
    finiteNumber(end?.y) - finiteNumber(start?.y)
  );
  if (distance <= 0.0001) return true;

  // Terrain annotations may opt out of walking in future map revisions.  Keep
  // this bounded; plateau boundary checks below are geometric rather than
  // relying on dense per-frame sampling.
  const sampleCount = Math.min(
    Math.max(1, Math.floor(finiteNumber(maxSamples, 24))),
    Math.max(2, Math.ceil(distance / 32))
  );
  for (let index = 1; index < sampleCount; index += 1) {
    const sample = resolveTrainingMapPointOnSegment(start, end, index / sampleCount);
    if (!sampleTrainingMapTerrain(mapConfig, sample, { field }).walkable) return false;
  }

  const highlands = (Array.isArray(mapConfig?.terrainRegions) ? mapConfig.terrainRegions : [])
    .filter(isTrainingMapHighlandRegion);
  for (let regionIndex = 0; regionIndex < highlands.length; regionIndex += 1) {
    const region = highlands[regionIndex];
    const polygon = resolveTrainingMapTerrainRegionPolygon(region);
    if (polygon.length < 3) continue;
    const crossings = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const crossing = resolveTrainingMapSegmentIntersectionProgress(
        start,
        end,
        polygon[index],
        polygon[(index + 1) % polygon.length]
      );
      if (crossing === null) continue;
      if (!crossings.some((existing) => Math.abs(existing - crossing) <= 1e-6)) crossings.push(crossing);
    }
    for (let index = 0; index < crossings.length; index += 1) {
      const progress = crossings[index];
      const epsilon = Math.min(0.025, Math.max(0.0002, 1 / Math.max(1, distance)));
      const before = resolveTrainingMapPointOnSegment(start, end, Math.max(0, progress - epsilon));
      const after = resolveTrainingMapPointOnSegment(start, end, Math.min(1, progress + epsilon));
      const crossesBoundary = isPointInsideTrainingMapTerrainRegion(before, region)
        !== isPointInsideTrainingMapTerrainRegion(after, region);
      if (!crossesBoundary) continue;
      if (!isTrainingMapHighlandBoundaryCrossing({
        start,
        end,
        region,
        progress,
        tolerance: rampTolerance
      })) return false;
    }
  }
  return true;
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
      respawnPoints: [],
      allRespawnPoints: [],
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
    respawnPoints: (Array.isArray(rawMap?.respawnPoints) ? rawMap.respawnPoints : [])
      .filter((entry) => isEnabledForPreset(entry, enabledTags)),
    allRespawnPoints: Array.isArray(rawMap?.respawnPoints) ? rawMap.respawnPoints : [],
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
  if (!mapConfig?.enabled) return { objects: [], objectives: [], respawnPoints: [], presetId: 'legacy-flat' };
  const preset = resolveTrainingMapPreset(mapConfig, presetId)
    || resolveTrainingMapPreset(mapConfig, mapConfig?.defaultPresetId)
    || { id: mapConfig?.activePresetId || 'full-jungle', enabledTags: [] };
  const enabledTags = new Set(Array.isArray(preset?.enabledTags) ? preset.enabledTags : []);
  return {
    presetId: String(preset?.id || mapConfig?.activePresetId || 'full-jungle'),
    objects: (Array.isArray(mapConfig?.allObjects) ? mapConfig.allObjects : mapConfig.objects || [])
      .filter((entry) => isEnabledForPreset(entry, enabledTags)),
    objectives: (Array.isArray(mapConfig?.allObjectives) ? mapConfig.allObjectives : mapConfig.objectives || [])
      .filter((entry) => isEnabledForPreset(entry, enabledTags)),
    respawnPoints: (Array.isArray(mapConfig?.allRespawnPoints) ? mapConfig.allRespawnPoints : mapConfig.respawnPoints || [])
      .filter((entry) => isEnabledForPreset(entry, enabledTags))
  };
};

export const cloneTrainingMapElementsForPreset = (mapConfig = null, presetId = '') => {
  const elements = resolveTrainingMapElementsForPreset(mapConfig, presetId);
  return {
    ...elements,
    objects: cloneMapValue(elements.objects, []),
    objectives: cloneMapValue(elements.objectives, []),
    respawnPoints: cloneMapValue(elements.respawnPoints, [])
  };
};

export const getTrainingMapRespawnPoints = (mapConfig = null, team = '') => (
  (Array.isArray(mapConfig?.respawnPoints) ? mapConfig.respawnPoints : [])
    .filter((point) => !team || point?.team === team)
    .map((point) => ({
      id: String(point?.id || ''),
      highlandId: String(point?.highlandId || ''),
      team: point?.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER,
      spawnRegionId: String(point?.spawnRegionId || ''),
      label: String(point?.label || '高地重生点'),
      x: finiteNumber(point?.x),
      y: finiteNumber(point?.y),
      radius: Math.max(0, finiteNumber(point?.radius)),
      facingRad: finiteNumber(point?.facingRad)
    }))
    .filter((point) => point.id)
);

export const resolveTrainingMapRespawnPoint = (mapConfig = null, {
  team = TEAM_ATTACKER,
  spawnRegionId = '',
  fallbackPoint = null
} = {}) => {
  const candidates = getTrainingMapRespawnPoints(mapConfig, team);
  if (candidates.length <= 0) return null;
  const requestedSpawnRegionId = String(spawnRegionId || '');
  const matchingRegion = candidates.find((point) => point.spawnRegionId === requestedSpawnRegionId);
  if (matchingRegion) return matchingRegion;
  if (!fallbackPoint) return candidates[0];
  return candidates.reduce((best, point) => {
    if (!best) return point;
    const pointDistance = Math.hypot(point.x - finiteNumber(fallbackPoint?.x), point.y - finiteNumber(fallbackPoint?.y));
    const bestDistance = Math.hypot(best.x - finiteNumber(fallbackPoint?.x), best.y - finiteNumber(fallbackPoint?.y));
    return pointDistance < bestDistance ? point : best;
  }, null);
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
