import {
  buildObstacleSpatialIndex,
  isInsideCollider,
  pushOutOfRect,
  queryObstacleCandidates,
  raycastObstacles
} from '../crowd/crowdPhysics';
import { filterBlockingObstacles } from '../items/itemObstacleUtils';
import {
  TRAINING_MAP_WORLD_HEIGHT,
  TRAINING_MAP_WORLD_WIDTH,
  isTrainingMapTerrainWalkable,
  sampleTrainingMapTerrain
} from '../../shared/trainingMap';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const MAX_NARROW_ROUTE_GRID_CELLS = 24000;
const MAX_ROUTE_GRID_CACHE_VARIANTS = 6;
const MAX_ROUTE_SEGMENT_CACHE_ENTRIES = 180;

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const distance = (left = {}, right = {}) => Math.hypot(
  finiteNumber(left?.x) - finiteNumber(right?.x),
  finiteNumber(left?.y) - finiteNumber(right?.y)
);

const isPointInsidePolygon = (point = {}, polygon = []) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  const targetX = finiteNumber(point?.x);
  const targetY = finiteNumber(point?.y);
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index] || {};
    const previous = polygon[previousIndex] || {};
    const currentY = finiteNumber(current?.y);
    const previousY = finiteNumber(previous?.y);
    const crosses = ((currentY > targetY) !== (previousY > targetY))
      && targetX < (
        ((finiteNumber(previous?.x) - finiteNumber(current?.x)) * (targetY - currentY))
        / ((previousY - currentY) || 1e-9)
      ) + finiteNumber(current?.x);
    if (crosses) inside = !inside;
  }
  return inside;
};

const buildKey = (column, row) => `${column}:${row}`;

const compareOpenNodes = (left = {}, right = {}) => (
  (Number(left?.score) || 0) - (Number(right?.score) || 0)
  || (Number(left?.cost) || 0) - (Number(right?.cost) || 0)
  || String(left?.key || '').localeCompare(String(right?.key || ''), 'en')
);

const pushOpenNode = (heap = [], node = {}) => {
  heap.push(node);
  let index = heap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) * 0.5);
    if (compareOpenNodes(heap[parentIndex], heap[index]) <= 0) break;
    [heap[parentIndex], heap[index]] = [heap[index], heap[parentIndex]];
    index = parentIndex;
  }
};

const popOpenNode = (heap = []) => {
  if (heap.length <= 0) return null;
  const first = heap[0];
  const last = heap.pop();
  if (heap.length <= 0 || !last) return first;
  heap[0] = last;
  let index = 0;
  while (true) {
    const leftIndex = (index * 2) + 1;
    const rightIndex = leftIndex + 1;
    let nextIndex = index;
    if (leftIndex < heap.length && compareOpenNodes(heap[leftIndex], heap[nextIndex]) < 0) {
      nextIndex = leftIndex;
    }
    if (rightIndex < heap.length && compareOpenNodes(heap[rightIndex], heap[nextIndex]) < 0) {
      nextIndex = rightIndex;
    }
    if (nextIndex === index) break;
    [heap[index], heap[nextIndex]] = [heap[nextIndex], heap[index]];
    index = nextIndex;
  }
  return first;
};

const parseKey = (key = '') => {
  const [columnText, rowText] = String(key).split(':');
  return {
    column: Math.max(0, Math.floor(finiteNumber(columnText))),
    row: Math.max(0, Math.floor(finiteNumber(rowText)))
  };
};

const resolveField = (field = {}) => ({
  width: Math.max(100, finiteNumber(field?.width, TRAINING_MAP_WORLD_WIDTH)),
  height: Math.max(100, finiteNumber(field?.height, TRAINING_MAP_WORLD_HEIGHT))
});

const resolveBlockingObstacles = (obstacles = []) => {
  if (Array.isArray(obstacles) && obstacles._obstacleSpatialIndex) return obstacles;
  const blockingObstacles = filterBlockingObstacles(obstacles);
  blockingObstacles._obstacleSpatialIndex = buildObstacleSpatialIndex(blockingObstacles);
  return blockingObstacles;
};

const resolveObstacleSourceSignature = (obstacles = []) => (
  (Array.isArray(obstacles) ? obstacles : []).map((obstacle, index) => ([
    String(obstacle?.objectId || obstacle?.id || index),
    finiteNumber(obstacle?.x),
    finiteNumber(obstacle?.y),
    finiteNumber(obstacle?.width),
    finiteNumber(obstacle?.depth),
    finiteNumber(obstacle?.rotation),
    String(obstacle?.collider?.kind || ''),
    finiteNumber(obstacle?.collider?.r),
    Array.isArray(obstacle?.collider?.parts) ? obstacle.collider.parts.length : 0,
    obstacle?.blocksMovement !== false,
    obstacle?.destroyed === true
  ].join(':'))).join('|')
);

const resolvePathClearance = (navigation = {}) => {
  const configured = Number(navigation?.pathClearance);
  if (Number.isFinite(configured)) return clamp(configured, 0, 48);
  return clamp(finiteNumber(navigation?.wallClearance, 18), 0, 48);
};

const resolveRouteCellSize = (navigation = {}, field = {}) => {
  const configuredCellSize = clamp(Math.round(finiteNumber(navigation?.cellSize, 64)), 8, 128);
  const narrowPassageCellSize = Number(navigation?.narrowPassage?.cellSize);
  if (!Number.isFinite(narrowPassageCellSize) || narrowPassageCellSize <= 0) {
    return configuredCellSize;
  }
  const narrowCellSize = clamp(Math.round(narrowPassageCellSize), 4, configuredCellSize);
  const fieldArea = Math.max(1, finiteNumber(field?.width) * finiteNumber(field?.height));
  const minCellSizeForBudget = Math.ceil(Math.sqrt(fieldArea / MAX_NARROW_ROUTE_GRID_CELLS));
  return clamp(
    Math.max(narrowCellSize, Math.min(configuredCellSize, minCellSizeForBudget)),
    narrowCellSize,
    configuredCellSize
  );
};

const resolveMaxSearchNodes = (navigation = {}, requestedLimit = 0) => {
  const configured = Math.max(80, Math.floor(finiteNumber(navigation?.maxSearchNodes, 1800)));
  const requested = Math.floor(finiteNumber(requestedLimit));
  if (requested <= 0) return configured;
  return clamp(requested, 1, configured);
};

const resolveRouteGridCache = ({ obstacles = [], field = {}, clearance = 0, cellSize = 0 } = {}) => {
  if (!Array.isArray(obstacles)) return new Map();
  const cacheKey = [
    finiteNumber(field?.width),
    finiteNumber(field?.height),
    finiteNumber(clearance),
    finiteNumber(cellSize)
  ].join(':');
  if (!(obstacles._trainingRouteGridCaches instanceof Map)) {
    Object.defineProperty(obstacles, '_trainingRouteGridCaches', {
      configurable: true,
      enumerable: false,
      value: new Map(),
      writable: true
    });
  }
  const caches = obstacles._trainingRouteGridCaches;
  if (caches.has(cacheKey)) return caches.get(cacheKey);
  if (caches.size >= MAX_ROUTE_GRID_CACHE_VARIANTS) {
    const oldestKey = caches.keys().next().value;
    if (oldestKey) caches.delete(oldestKey);
  }
  const cache = new Map();
  caches.set(cacheKey, cache);
  return cache;
};

const resolveRouteSegmentCache = ({ obstacles = [], clearance = 0 } = {}) => {
  if (!Array.isArray(obstacles)) return new Map();
  if (!(obstacles._trainingRouteSegmentCache instanceof Map)) {
    Object.defineProperty(obstacles, '_trainingRouteSegmentCache', {
      configurable: true,
      enumerable: false,
      value: new Map(),
      writable: true
    });
  }
  const cache = obstacles._trainingRouteSegmentCache;
  if (cache.size > MAX_ROUTE_SEGMENT_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  return cache;
};

const isPointWalkable = (point = {}, obstacles = [], clearance = 0, mapConfig = null, field = null) => {
  if (!isTrainingMapTerrainWalkable(mapConfig, point, { field })) return false;
  const inflate = Math.max(0, finiteNumber(clearance));
  const candidates = queryObstacleCandidates(obstacles, point?.x, point?.y, inflate);
  return !candidates.some((obstacle) => (
    !obstacle?.destroyed
    && isInsideCollider(point, obstacle, inflate)
  ));
};

const hasDirectPath = (
  start = {},
  target = {},
  obstacles = [],
  clearance = 0,
  mapConfig = null,
  field = null
) => {
  if (raycastObstacles(start, target, obstacles, Math.max(0, finiteNumber(clearance)))) return false;
  return isTrainingMapTerrainWalkable(mapConfig, start, { field })
    && isTrainingMapTerrainWalkable(mapConfig, target, { field });
};

const clampPointToField = (point = {}, field = {}, clearance = 0) => {
  const maxInset = Math.max(0, Math.min((field.width * 0.5) - 1, (field.height * 0.5) - 1));
  const inset = clamp(Math.max(0, finiteNumber(clearance)), 0, maxInset);
  return {
    x: clamp(finiteNumber(point?.x), (-field.width * 0.5) + inset, (field.width * 0.5) - inset),
    y: clamp(finiteNumber(point?.y), (-field.height * 0.5) + inset, (field.height * 0.5) - inset)
  };
};

const pushPointOutOfBlockingObstacles = ({
  point = {},
  field = {},
  obstacles = [],
  clearance = 0,
  mapConfig = null
} = {}) => {
  let candidate = clampPointToField(point, field, clearance);
  const escapeClearance = Math.max(0.25, finiteNumber(clearance) + 0.25);
  for (let iteration = 0; iteration < 10; iteration += 1) {
    if (isPointWalkable(candidate, obstacles, clearance, mapConfig, field)) return candidate;
    const blockers = queryObstacleCandidates(
      obstacles,
      candidate.x,
      candidate.y,
      escapeClearance
    );
    let best = null;
    for (let index = 0; index < blockers.length; index += 1) {
      const obstacle = blockers[index];
      if (!obstacle || obstacle.destroyed || !isInsideCollider(candidate, obstacle, clearance)) continue;
      const pushed = pushOutOfRect(candidate, obstacle, escapeClearance);
      if (!pushed?.pushed) continue;
      const move = distance(candidate, pushed);
      if (!best || move < best.move) best = { ...pushed, move };
    }
    if (!best || best.move <= 0.0001) break;
    candidate = clampPointToField(best, field, clearance);
  }
  return null;
};

export const findTrainingMapNearestWalkablePoint = ({
  field,
  point,
  obstacles = [],
  radius = 0,
  maxSearchDistance = 0,
  mapConfig = null
} = {}) => {
  const safeField = resolveField(field);
  const clearance = Math.max(0, finiteNumber(radius));
  const blockingObstacles = resolveBlockingObstacles(obstacles);
  const origin = clampPointToField(point, safeField, clearance);
  if (isPointWalkable(origin, blockingObstacles, clearance, mapConfig, safeField)) return origin;
  const pushedOrigin = pushPointOutOfBlockingObstacles({
    point: origin,
    field: safeField,
    obstacles: blockingObstacles,
    clearance,
    mapConfig
  });
  if (pushedOrigin) return pushedOrigin;
  const step = Math.max(2, Math.min(12, clearance || 4));
  const defaultSearchDistance = Math.min(
    360,
    Math.max(48, clearance * 8, Math.min(safeField.width, safeField.height) * 0.1)
  );
  const requestedSearchDistance = finiteNumber(maxSearchDistance);
  const searchDistance = clamp(
    requestedSearchDistance > 0 ? requestedSearchDistance : defaultSearchDistance,
    step,
    Math.max(step, Math.min(safeField.width, safeField.height) * 0.5)
  );
  for (let searchRadius = step; searchRadius <= searchDistance; searchRadius += step) {
    const sampleCount = Math.min(64, Math.max(16, Math.ceil((Math.PI * 2 * searchRadius) / step)));
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const angle = ((sampleIndex + ((Math.floor(searchRadius / step) % 2) * 0.5)) / sampleCount) * Math.PI * 2;
      const candidate = clampPointToField({
        x: origin.x + (Math.cos(angle) * searchRadius),
        y: origin.y + (Math.sin(angle) * searchRadius)
      }, safeField, clearance);
      if (!isPointWalkable(candidate, blockingObstacles, clearance, mapConfig, safeField)) continue;
      return candidate;
    }
  }
  return origin;
};

export const resolveTrainingMapLegalPosition = ({
  field,
  start,
  target,
  obstacles = [],
  radius = 0,
  mapConfig = null
} = {}) => {
  const safeField = resolveField(field);
  const clearance = Math.max(0, finiteNumber(radius));
  const blockingObstacles = resolveBlockingObstacles(obstacles);
  const legalStart = findTrainingMapNearestWalkablePoint({
    field: safeField,
    point: start,
    obstacles: blockingObstacles,
    radius: clearance,
    mapConfig
  });
  const requestedTarget = clampPointToField(target, safeField, clearance);
  if (
    isPointWalkable(requestedTarget, blockingObstacles, clearance, mapConfig, safeField)
    && hasDirectPath(legalStart, requestedTarget, blockingObstacles, clearance, mapConfig, safeField)
  ) {
    return requestedTarget;
  }
  const travelDistance = distance(legalStart, requestedTarget);
  if (travelDistance <= 0.001) return legalStart;
  let safeProgress = 0;
  let blockedProgress = 1;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const progress = (safeProgress + blockedProgress) * 0.5;
    const candidate = {
      x: legalStart.x + ((requestedTarget.x - legalStart.x) * progress),
      y: legalStart.y + ((requestedTarget.y - legalStart.y) * progress)
    };
    if (
      isPointWalkable(candidate, blockingObstacles, clearance, mapConfig, safeField)
      && hasDirectPath(legalStart, candidate, blockingObstacles, clearance, mapConfig, safeField)
    ) {
      safeProgress = progress;
    } else {
      blockedProgress = progress;
    }
  }
  return {
    x: legalStart.x + ((requestedTarget.x - legalStart.x) * safeProgress),
    y: legalStart.y + ((requestedTarget.y - legalStart.y) * safeProgress)
  };
};

export const getTrainingMapTerrainMultiplier = (point = {}, mapConfig = {}) => {
  return sampleTrainingMapTerrain(mapConfig, point).movementCost;
};

const reduceRoute = (
  start = {},
  route = [],
  obstacles = [],
  clearance = 0,
  mapConfig = null,
  field = null
) => {
  const points = (Array.isArray(route) ? route : []).filter(Boolean);
  if (points.length <= 1) return points;
  const reduced = [];
  let anchor = { x: finiteNumber(start?.x), y: finiteNumber(start?.y) };
  let index = 0;
  while (index < points.length) {
    let bestIndex = index;
    for (let candidateIndex = points.length - 1; candidateIndex >= index; candidateIndex -= 1) {
      if (!hasDirectPath(anchor, points[candidateIndex], obstacles, clearance, mapConfig, field)) continue;
      bestIndex = candidateIndex;
      break;
    }
    const next = points[bestIndex];
    reduced.push(next);
    anchor = next;
    index = bestIndex + 1;
  }
  return reduced;
};

const joinRoutePoints = (...routes) => {
  const joined = [];
  routes.forEach((route) => {
    (Array.isArray(route) ? route : []).forEach((point) => {
      if (!point) return;
      const candidate = { x: finiteNumber(point?.x), y: finiteNumber(point?.y) };
      if (joined.length > 0 && distance(joined[joined.length - 1], candidate) <= 0.01) return;
      joined.push(candidate);
    });
  });
  return joined;
};

const normalizeDirection = (from = {}, to = {}) => {
  const deltaX = finiteNumber(to?.x) - finiteNumber(from?.x);
  const deltaY = finiteNumber(to?.y) - finiteNumber(from?.y);
  const length = Math.hypot(deltaX, deltaY);
  if (length <= 0.0001) return { x: 0, y: 0 };
  return { x: deltaX / length, y: deltaY / length };
};

const resolveObstacleDetourPoints = ({
  obstacle = null,
  field = {},
  clearance = 0
} = {}) => {
  if (!obstacle) return [];
  const path = Array.isArray(obstacle?.collisionPath)
    ? obstacle.collisionPath.filter(Boolean)
    : (Array.isArray(obstacle?.visualPath) ? obstacle.visualPath.filter(Boolean) : []);
  const colliderParts = Array.isArray(obstacle?.collider?.parts)
    ? obstacle.collider.parts
    : [];
  const colliderThickness = colliderParts.reduce((maximum, part) => (
    Math.max(
      maximum,
      Math.max(
        Math.max(0, finiteNumber(part?.r)),
        Math.min(
          Math.max(0, finiteNumber(part?.w)),
          Math.max(0, finiteNumber(part?.d))
        ) * 0.5
      )
    )
  ), 0);
  const inset = Math.max(
    4,
    finiteNumber(clearance) + 2,
    colliderThickness + finiteNumber(clearance) + 2
  );
  const points = [];
  const appendPoint = (point = {}) => {
    const candidate = clampPointToField(point, field, clearance);
    if (points.some((entry) => distance(entry, candidate) <= 0.01)) return;
    points.push(candidate);
  };
  if (obstacle?.collider?.kind === 'circle') {
    const rotation = finiteNumber(obstacle?.rotation) * Math.PI / 180;
    const localX = finiteNumber(obstacle?.collider?.cx);
    const localY = finiteNumber(obstacle?.collider?.cy);
    const center = {
      x: finiteNumber(obstacle?.x) + ((localX * Math.cos(rotation)) - (localY * Math.sin(rotation))),
      y: finiteNumber(obstacle?.y) + ((localX * Math.sin(rotation)) + (localY * Math.cos(rotation)))
    };
    const radius = Math.max(
      1,
      finiteNumber(obstacle?.collider?.r),
      Math.min(finiteNumber(obstacle?.width), finiteNumber(obstacle?.depth)) * 0.5
    ) + Math.max(2, finiteNumber(clearance) + 2);
    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2;
      appendPoint({
        x: center.x + (Math.cos(angle) * radius),
        y: center.y + (Math.sin(angle) * radius)
      });
    }
    return points;
  }
  if (path.length >= 2) {
    const sampleStride = Math.max(1, Math.ceil(path.length / 12));
    path.forEach((point, index) => {
      if (index !== 0 && index !== path.length - 1 && index % sampleStride !== 0) return;
      const previous = path[Math.max(0, index - 1)] || point;
      const next = path[Math.min(path.length - 1, index + 1)] || point;
      const tangent = normalizeDirection(previous, next);
      const side = { x: -tangent.y, y: tangent.x };
      [-1, 1].forEach((sideSign) => {
        [1, 1.45].forEach((sideScale) => {
          appendPoint({
            x: finiteNumber(point?.x) + (side.x * inset * sideSign * sideScale),
            y: finiteNumber(point?.y) + (side.y * inset * sideSign * sideScale)
          });
        });
      });
    });
    const endpointSpecs = [
      { endpoint: path[0], neighbour: path[1] },
      { endpoint: path[path.length - 1], neighbour: path[path.length - 2] }
    ];
    endpointSpecs.forEach(({ endpoint, neighbour }) => {
      const outward = normalizeDirection(neighbour, endpoint);
      const side = { x: -outward.y, y: outward.x };
      [1, 1.8, 3, 4.5].forEach((forwardScale) => {
        [-1, 0, 1].forEach((sideSign) => {
          appendPoint({
            x: finiteNumber(endpoint?.x) + (outward.x * inset * forwardScale) + (side.x * inset * sideSign),
            y: finiteNumber(endpoint?.y) + (outward.y * inset * forwardScale) + (side.y * inset * sideSign)
          });
        });
      });
    });
    return points;
  }
  const halfWidth = Math.max(1, finiteNumber(obstacle?.width, 1) * 0.5) + inset;
  const halfHeight = Math.max(1, finiteNumber(obstacle?.depth, 1) * 0.5) + inset;
  [-1, 1].forEach((xSign) => {
    [-1, 1].forEach((ySign) => {
      appendPoint({
        x: finiteNumber(obstacle?.x) + (halfWidth * xSign),
        y: finiteNumber(obstacle?.y) + (halfHeight * ySign)
      });
    });
  });
  return points;
};

const resolveLocalDetourRoute = ({
  start = {},
  target = {},
  obstacles = [],
  clearance = 0,
  mapConfig = null,
  field = null
} = {}) => {
  const segmentCache = resolveRouteSegmentCache({ obstacles, clearance });
  const cacheKey = [
    finiteNumber(start?.x),
    finiteNumber(start?.y),
    finiteNumber(target?.x),
    finiteNumber(target?.y),
    finiteNumber(clearance)
  ].join(':');
  const cachedRoute = segmentCache.get(cacheKey);
  if (cachedRoute) return cachedRoute.map((point) => ({ ...point }));
  const route = [];
  let current = start;
  const visited = new Set();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const segmentStart = current;
    const hit = raycastObstacles(segmentStart, target, obstacles, clearance);
    if (!hit) {
      route.push(target);
      segmentCache.set(cacheKey, route.map((point) => ({ ...point })));
      return route;
    }
    const obstacle = hit.obstacle;
    const obstacleId = String(obstacle?.id || obstacle?.objectId || '');
    const candidates = resolveObstacleDetourPoints({ obstacle, field, clearance })
      .filter((candidate) => !visited.has(`${obstacleId}:${candidate.x}:${candidate.y}`))
      .sort((left, right) => (
        (distance(left, target) + (distance(segmentStart, left) * 0.08))
        - (distance(right, target) + (distance(segmentStart, right) * 0.08))
      ));
    let next = null;
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
      if (!isPointWalkable(candidate, obstacles, clearance, mapConfig, field)) continue;
      if (!hasDirectPath(segmentStart, candidate, obstacles, clearance, mapConfig, field)) continue;
      next = candidate;
      break;
    }
    if (!next) return null;
    visited.add(`${obstacleId}:${next.x}:${next.y}`);
    route.push(next);
    current = next;
  }
  return null;
};

export const resolveTrainingHighlandExitPortal = ({
  mapConfig = null,
  start = {},
  target = {},
  obstacles = [],
  clearance = 0,
  field = null
} = {}) => {
  const region = (Array.isArray(mapConfig?.terrainRegions) ? mapConfig.terrainRegions : [])
    .find((entry) => (
      String(entry?.type || '').startsWith('highland-')
      && isPointInsidePolygon(start, entry?.points)
    )) || null;
  if (!region || isPointInsidePolygon(target, region?.points)) return null;
  const offsetDistance = Math.max(2, finiteNumber(clearance) * 1.4);
  const candidates = (Array.isArray(region?.ramps) ? region.ramps : [])
    .map((ramp) => {
      const points = Array.isArray(ramp?.points) ? ramp.points : [];
      if (points.length !== 4) return null;
      const lowCenter = {
        x: (finiteNumber(points[0]?.x) + finiteNumber(points[3]?.x)) * 0.5,
        y: (finiteNumber(points[0]?.y) + finiteNumber(points[3]?.y)) * 0.5
      };
      const highCenter = {
        x: (finiteNumber(points[1]?.x) + finiteNumber(points[2]?.x)) * 0.5,
        y: (finiteNumber(points[1]?.y) + finiteNumber(points[2]?.y)) * 0.5
      };
      const outward = normalizeDirection(highCenter, lowCenter);
      if (Math.abs(outward.x) + Math.abs(outward.y) <= 0.0001) return null;
      const startInsideRamp = isPointInsidePolygon(start, points);
      const targetDirection = normalizeDirection(start, target);
      const outwardAlignment = (targetDirection.x * outward.x) + (targetDirection.y * outward.y);
      const outwardCross = Math.abs((targetDirection.x * outward.y) - (targetDirection.y * outward.x));
      if (startInsideRamp && outwardAlignment > 0.94 && outwardCross < 0.34) {
        return {
          entry: { x: finiteNumber(start?.x), y: finiteNumber(start?.y) },
          exit: { x: finiteNumber(start?.x), y: finiteNumber(start?.y) },
          route: [],
          priority: 0,
          score: distance(start, target)
        };
      }
      const entry = clampPointToField({
        x: highCenter.x - (outward.x * offsetDistance),
        y: highCenter.y - (outward.y * offsetDistance)
      }, field, clearance);
      const exit = clampPointToField({
        x: lowCenter.x + (outward.x * offsetDistance),
        y: lowCenter.y + (outward.y * offsetDistance)
      }, field, clearance);
      if (!isPointWalkable(entry, obstacles, clearance, mapConfig, field)) return null;
      if (!isPointWalkable(exit, obstacles, clearance, mapConfig, field)) return null;
      if (!hasDirectPath(entry, exit, obstacles, clearance, mapConfig, field)) return null;
      const approachTarget = startInsideRamp ? exit : entry;
      const approach = hasDirectPath(start, approachTarget, obstacles, clearance, mapConfig, field)
        ? [approachTarget]
        : resolveLocalDetourRoute({
          start,
          target: approachTarget,
          obstacles,
          clearance,
          mapConfig,
          field
        });
      if (!approach?.length) return null;
      const reducedApproach = reduceRoute(
        start,
        approach,
        obstacles,
        clearance,
        mapConfig,
        field
      );
      if (distance(reducedApproach[reducedApproach.length - 1], approachTarget) > 0.01) return null;
      const route = startInsideRamp
        ? joinRoutePoints(reducedApproach, [exit])
        : joinRoutePoints(reducedApproach, [entry, exit]);
      const approachDistance = route.reduce((total, point, index) => (
        total + distance(index === 0 ? start : route[index - 1], point)
      ), 0);
      return {
        entry,
        exit,
        route,
        priority: startInsideRamp ? 0 : 1,
        score: approachDistance + distance(exit, target)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.priority - right.priority || left.score - right.score);
  return candidates[0] || null;
};

const resolveLaneGuidedRoute = ({
  mapConfig = null,
  start = {},
  target = {},
  obstacles = [],
  clearance = 0,
  field = null,
  preferredLaneId = ''
} = {}) => {
  const lanes = Array.isArray(mapConfig?.lanes) ? mapConfig.lanes : [];
  const normalizedPreferredLaneId = String(preferredLaneId || '').trim();
  const preferredLanes = normalizedPreferredLaneId
    ? lanes.filter((lane) => String(lane?.id || '') === normalizedPreferredLaneId)
    : [];
  const candidateLanes = preferredLanes.length > 0 ? preferredLanes : lanes;
  const findClosestIndex = (point = {}, points = []) => (
    points.reduce((closestIndex, candidate, index) => (
      distance(point, candidate) < distance(point, points[closestIndex]) ? index : closestIndex
    ), 0)
  );
  const plans = [];
  candidateLanes.forEach((lane) => {
    const centerline = Array.isArray(lane?.centerline) ? lane.centerline.filter(Boolean) : [];
    if (centerline.length < 2) return;
    [centerline, [...centerline].reverse()].forEach((points) => {
      const startIndex = findClosestIndex(start, points);
      const targetIndex = findClosestIndex(target, points);
      if (targetIndex < startIndex) return;
      const endpointPenalty = distance(start, points[startIndex]) + distance(target, points[targetIndex]);
      plans.push({ points, startIndex, targetIndex, endpointPenalty });
    });
  });
  plans.sort((left, right) => left.endpointPenalty - right.endpointPenalty);
  const isLargeLaneMap = finiteNumber(field?.width) >= 4000 && finiteNumber(field?.height) >= 3000;
  const planLimit = isLargeLaneMap ? Math.min(2, plans.length) : plans.length;
  for (let planIndex = 0; planIndex < planLimit; planIndex += 1) {
    const plan = plans[planIndex];
    const indexPairs = [
      { startIndex: plan.startIndex, targetIndex: plan.targetIndex },
      { startIndex: Math.max(0, plan.startIndex - 1), targetIndex: plan.targetIndex },
      { startIndex: plan.startIndex, targetIndex: Math.min(plan.points.length - 1, plan.targetIndex + 1) }
    ].filter((pair, index, pairs) => (
      pair.startIndex <= pair.targetIndex
      && pairs.findIndex((candidate) => (
        candidate.startIndex === pair.startIndex && candidate.targetIndex === pair.targetIndex
      )) === index
    ));
    for (let pairIndex = 0; pairIndex < indexPairs.length; pairIndex += 1) {
      const pair = indexPairs[pairIndex];
      const candidate = [...plan.points.slice(pair.startIndex, pair.targetIndex + 1), target];
      let previous = start;
      let clear = true;
      const route = [];
      for (let pointIndex = 0; pointIndex < candidate.length; pointIndex += 1) {
        const requestedPoint = candidate[pointIndex];
        const point = isPointWalkable(requestedPoint, obstacles, clearance, mapConfig, field)
          ? requestedPoint
          : findTrainingMapNearestWalkablePoint({
            field,
            point: requestedPoint,
            obstacles,
            radius: clearance,
            mapConfig
          });
        if (!point || !isPointWalkable(point, obstacles, clearance, mapConfig, field)) {
          clear = false;
          break;
        }
        const segment = resolveLocalDetourRoute({
          start: previous,
          target: point,
          obstacles,
          clearance,
          mapConfig,
          field
        });
        if (!segment) {
          clear = false;
          break;
        }
        route.push(...segment);
        previous = point;
      }
      if (!clear) continue;
      return reduceRoute(start, route, obstacles, clearance, mapConfig, field);
    }
  }
  return null;
};

export const planTrainingMapRoute = ({
  field,
  mapConfig,
  start,
  target,
  obstacles = [],
  radius = 0,
  maxSearchNodes = 0,
  preferLocalDetour = false,
  preferredLaneId = ''
} = {}) => {
  const safeField = resolveField(field);
  const requestedStart = {
    x: clamp(finiteNumber(start?.x), -safeField.width * 0.5, safeField.width * 0.5),
    y: clamp(finiteNumber(start?.y), -safeField.height * 0.5, safeField.height * 0.5)
  };
  const requestedTarget = {
    x: clamp(finiteNumber(target?.x), -safeField.width * 0.5, safeField.width * 0.5),
    y: clamp(finiteNumber(target?.y), -safeField.height * 0.5, safeField.height * 0.5)
  };
  const blockingObstacles = resolveBlockingObstacles(obstacles);
  const navigation = mapConfig?.navigation && typeof mapConfig.navigation === 'object'
    ? mapConfig.navigation
    : {};
  const clearance = Math.max(0.5, finiteNumber(radius) + resolvePathClearance(navigation));
  const safeStart = findTrainingMapNearestWalkablePoint({
    field: safeField,
    point: requestedStart,
    obstacles: blockingObstacles,
    radius: clearance,
    mapConfig
  });
  const safeTarget = findTrainingMapNearestWalkablePoint({
    field: safeField,
    point: requestedTarget,
    obstacles: blockingObstacles,
    radius: clearance,
    mapConfig
  });
  const highlandExitPortal = resolveTrainingHighlandExitPortal({
    mapConfig,
    start: safeStart,
    target: safeTarget,
    obstacles: blockingObstacles,
    clearance,
    field: safeField
  });
  if (
    distance(safeStart, safeTarget) <= 1
    || (
      !highlandExitPortal
      && hasDirectPath(safeStart, safeTarget, blockingObstacles, clearance, mapConfig, safeField)
    )
  ) {
    return [safeTarget];
  }
  const routeStart = highlandExitPortal?.exit || safeStart;
  const finalizeRoute = (route = []) => {
    const reducedSuffix = reduceRoute(
      routeStart,
      route,
      blockingObstacles,
      clearance,
      mapConfig,
      safeField
    );
    if (!highlandExitPortal) return reducedSuffix;
    return joinRoutePoints(highlandExitPortal.route, reducedSuffix);
  };
  if (
    distance(routeStart, safeTarget) <= 1
    || hasDirectPath(routeStart, safeTarget, blockingObstacles, clearance, mapConfig, safeField)
  ) {
    return finalizeRoute([safeTarget]);
  }
  if (preferLocalDetour) {
    const localRoute = resolveLocalDetourRoute({
      start: routeStart,
      target: safeTarget,
      obstacles: blockingObstacles,
      clearance,
      mapConfig,
      field: safeField
    });
    if (localRoute?.length > 0) {
      return finalizeRoute(localRoute);
    }
  }
  const laneRoute = resolveLaneGuidedRoute({
    mapConfig,
    start: routeStart,
    target: safeTarget,
    obstacles: blockingObstacles,
    clearance,
    field: safeField,
    preferredLaneId
  });
  if (laneRoute?.length > 0) return finalizeRoute(laneRoute);

  const cellSize = resolveRouteCellSize(navigation, safeField);
  const columnCount = Math.max(2, Math.ceil(safeField.width / cellSize));
  const rowCount = Math.max(2, Math.ceil(safeField.height / cellSize));
  const originX = -safeField.width * 0.5 + (cellSize * 0.5);
  const originY = -safeField.height * 0.5 + (cellSize * 0.5);
  const pointForCell = (column, row) => ({
    x: clamp(originX + (column * cellSize), -safeField.width * 0.5 + 1, safeField.width * 0.5 - 1),
    y: clamp(originY + (row * cellSize), -safeField.height * 0.5 + 1, safeField.height * 0.5 - 1)
  });
  const cellForPoint = (point = {}) => ({
    column: clamp(Math.round((finiteNumber(point?.x) - originX) / cellSize), 0, columnCount - 1),
    row: clamp(Math.round((finiteNumber(point?.y) - originY) / cellSize), 0, rowCount - 1)
  });
  const cellWalkabilityCache = resolveRouteGridCache({
    obstacles: blockingObstacles,
    field: safeField,
    clearance,
    cellSize
  });
  const isCellWalkable = (column, row) => {
    const key = buildKey(column, row);
    if (cellWalkabilityCache.has(key)) return cellWalkabilityCache.get(key);
    const walkable = isPointWalkable(
      pointForCell(column, row),
      blockingObstacles,
      clearance,
      mapConfig,
      safeField
    );
    cellWalkabilityCache.set(key, walkable);
    return walkable;
  };
  const resolveWalkableCell = (point = {}) => {
    const candidate = cellForPoint(point);
    if (isCellWalkable(candidate.column, candidate.row)) return candidate;
    const maxRing = Math.max(columnCount, rowCount);
    for (let ring = 1; ring <= maxRing; ring += 1) {
      for (let columnOffset = -ring; columnOffset <= ring; columnOffset += 1) {
        for (let rowOffset = -ring; rowOffset <= ring; rowOffset += 1) {
          if (Math.max(Math.abs(columnOffset), Math.abs(rowOffset)) !== ring) continue;
          const column = candidate.column + columnOffset;
          const row = candidate.row + rowOffset;
          if (column < 0 || row < 0 || column >= columnCount || row >= rowCount) continue;
          if (isCellWalkable(column, row)) return { column, row };
        }
      }
    }
    return candidate;
  };

  const startCell = resolveWalkableCell(routeStart);
  const targetCell = resolveWalkableCell(safeTarget);
  const startKey = buildKey(startCell.column, startCell.row);
  const targetKey = buildKey(targetCell.column, targetCell.row);
  const open = [{ key: startKey, score: 0 }];
  const cameFrom = new Map();
  const costByKey = new Map([[startKey, 0]]);
  const closed = new Set();
  const searchNodeBudget = resolveMaxSearchNodes(navigation, maxSearchNodes);
  const neighbourOffsets = [
    { column: -1, row: -1 }, { column: 0, row: -1 }, { column: 1, row: -1 },
    { column: -1, row: 0 }, { column: 1, row: 0 },
    { column: -1, row: 1 }, { column: 0, row: 1 }, { column: 1, row: 1 }
  ];
  const targetPoint = pointForCell(targetCell.column, targetCell.row);
  let visited = 0;

  while (open.length > 0 && visited < searchNodeBudget) {
    const current = popOpenNode(open);
    if (!current || closed.has(current.key)) continue;
    if (current.key === targetKey) break;
    closed.add(current.key);
    visited += 1;
    const currentCell = parseKey(current.key);
    const currentPoint = pointForCell(currentCell.column, currentCell.row);
    const currentCost = costByKey.get(current.key) || 0;
    neighbourOffsets.forEach((offset) => {
      const column = currentCell.column + offset.column;
      const row = currentCell.row + offset.row;
      if (column < 0 || row < 0 || column >= columnCount || row >= rowCount) return;
      const neighbourKey = buildKey(column, row);
      if (closed.has(neighbourKey)) return;
      const neighbourPoint = pointForCell(column, row);
      if (!isCellWalkable(column, row)) return;
      if (!hasDirectPath(currentPoint, neighbourPoint, blockingObstacles, clearance * 0.35, mapConfig, safeField)) return;
      const diagonal = offset.column !== 0 && offset.row !== 0;
      const stepCost = diagonal ? Math.SQRT2 : 1;
      const nextCost = currentCost + stepCost;
      if (nextCost >= (costByKey.get(neighbourKey) ?? Infinity)) return;
      cameFrom.set(neighbourKey, current.key);
      costByKey.set(neighbourKey, nextCost);
      const heuristic = distance(neighbourPoint, targetPoint) / cellSize;
      pushOpenNode(open, { key: neighbourKey, score: nextCost + heuristic, cost: nextCost });
    });
  }

  if (startKey !== targetKey && !cameFrom.has(targetKey)) return finalizeRoute([routeStart]);
  const routeKeys = [];
  let cursor = targetKey;
  routeKeys.push(cursor);
  while (cursor !== startKey) {
    const parent = cameFrom.get(cursor);
    if (!parent) return finalizeRoute([routeStart]);
    cursor = parent;
    routeKeys.push(cursor);
  }
  routeKeys.reverse();
  const route = routeKeys.slice(1).map((key) => {
    const cell = parseKey(key);
    return pointForCell(cell.column, cell.row);
  });
  route.push(safeTarget);
  return finalizeRoute(reduceRoute(
    routeStart,
    route,
    blockingObstacles,
    clearance * 0.72,
    mapConfig,
    safeField
  ));
};

export const createTrainingMapNavigator = ({ field, mapConfig } = {}) => {
  const obstacleSets = new WeakMap();
  const resolveNavigatorObstacles = (source = []) => {
    if (!Array.isArray(source) || source._obstacleSpatialIndex) return source;
    const signature = resolveObstacleSourceSignature(source);
    const cached = obstacleSets.get(source);
    if (cached?.signature === signature) return cached.obstacles;
    const blockingObstacles = resolveBlockingObstacles(source);
    obstacleSets.set(source, { signature, obstacles: blockingObstacles });
    return blockingObstacles;
  };
  return {
    getPathFailureReplanCooldownSeconds() {
      const configuredCooldown = mapConfig?.navigation?.pathFailureReplanCooldownSeconds;
      return clamp(finiteNumber(configuredCooldown, 0.35), 0.1, 2);
    },
    sampleTerrain(point) {
      return sampleTrainingMapTerrain(mapConfig, point, { field });
    },
    isWalkable(point, options = {}) {
      return isPointWalkable(
        point,
        resolveNavigatorObstacles(options?.obstacles),
        options?.radius,
        mapConfig,
        field
      );
    },
    findNearestWalkablePoint(point, options = {}) {
      return findTrainingMapNearestWalkablePoint({
        field,
        mapConfig,
        point,
        obstacles: resolveNavigatorObstacles(options?.obstacles),
        radius: options?.radius,
        maxSearchDistance: options?.maxSearchDistance
      });
    },
    resolveLegalPosition(start, target, options = {}) {
      return resolveTrainingMapLegalPosition({
        field,
        mapConfig,
        start,
        target,
        obstacles: resolveNavigatorObstacles(options?.obstacles),
        radius: options?.radius
      });
    },
    planRoute(start, target, options = {}) {
      return planTrainingMapRoute({
        field,
        mapConfig,
        start,
        target,
        obstacles: resolveNavigatorObstacles(options?.obstacles),
        radius: options?.radius,
        maxSearchNodes: options?.maxSearchNodes,
        preferLocalDetour: options?.preferLocalDetour === true,
        preferredLaneId: options?.preferredLaneId
      });
    }
  };
};
