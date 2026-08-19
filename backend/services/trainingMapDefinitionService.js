const geometry = require('../data/training-war-map-v1/geometry.json');
const navigation = require('../data/training-war-map-v1/navigation.json');
const objectiveData = require('../data/training-war-map-v1/objectives.json');
const neutralCampData = require('../data/training-war-map-v1/neutral-camps.json');

const REFERENCE_RUNTIME_WORLD_WIDTH = 3600;
const REFERENCE_RUNTIME_WORLD_HEIGHT = 2504;

const cloneValue = (value) => JSON.parse(JSON.stringify(value));

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const normalizeTeam = (team) => (team === 'defender' ? 'defender' : 'attacker');

const resolveTowerRuntimeConfig = () => {
  const definition = objectiveData?.towerRuntime && typeof objectiveData.towerRuntime === 'object'
    ? objectiveData.towerRuntime
    : {};
  const priority = typeof definition?.priority === 'string' && definition.priority.trim()
    ? definition.priority.trim()
    : 'nearest';
  return {
    maxHp: Math.max(1, finiteNumber(definition?.maxHp, 2200)),
    attackRange: Math.max(0, finiteNumber(definition?.attackRange, 188)),
    attackIntervalSec: Math.max(0.1, finiteNumber(definition?.attackIntervalSec, 0.8)),
    attackDamage: Math.max(0, finiteNumber(definition?.attackDamage, 20)),
    priority,
    threatDecayPerSecond: Math.max(0, finiteNumber(definition?.threatDecayPerSecond, 0.2))
  };
};

const resolveLayout = () => ({
  fieldWidth: Math.max(100, finiteNumber(geometry?.coordinateSystems?.runtimeWorld?.width, 7200)),
  fieldHeight: Math.max(100, finiteNumber(geometry?.coordinateSystems?.runtimeWorld?.height, 5008))
});

const resolveRuntimeScale = (layout = resolveLayout()) => Math.max(0.1, Math.min(
  finiteNumber(layout?.fieldWidth, REFERENCE_RUNTIME_WORLD_WIDTH) / REFERENCE_RUNTIME_WORLD_WIDTH,
  finiteNumber(layout?.fieldHeight, REFERENCE_RUNTIME_WORLD_HEIGHT) / REFERENCE_RUNTIME_WORLD_HEIGHT
));

const resolveReferenceAssetBounds = () => {
  const bounds = geometry?.referenceAsset?.effectiveBattlefieldBounds || {};
  return {
    width: Math.max(1, finiteNumber(bounds?.width, 1607)),
    height: Math.max(1, finiteNumber(bounds?.height, 1118))
  };
};

const normalizedToWorld = (point = {}, layout = resolveLayout()) => ({
  x: (finiteNumber(point?.x) - 0.5) * layout.fieldWidth,
  y: (0.5 - finiteNumber(point?.y)) * layout.fieldHeight
});

const tupleToWorld = (point = [], layout = resolveLayout()) => normalizedToWorld({
  x: point?.[0],
  y: point?.[1]
}, layout);

const interpolateWorldPoint = (from = {}, to = {}, progress = 0) => ({
  x: finiteNumber(from?.x) + ((finiteNumber(to?.x) - finiteNumber(from?.x)) * progress),
  y: finiteNumber(from?.y) + ((finiteNumber(to?.y) - finiteNumber(from?.y)) * progress)
});

const scaleHighlandFootprint = (points = [], team = 'attacker', layout = resolveLayout(), scale = 1) => {
  const safePoints = Array.isArray(points) ? points : [];
  const footprintScale = Math.max(1, Math.min(1.35, finiteNumber(scale, 1)));
  if (safePoints.length <= 0 || footprintScale <= 1.0001) return safePoints;
  const boundaryX = normalizeTeam(team) === 'defender'
    ? finiteNumber(layout?.fieldWidth) * 0.5
    : finiteNumber(layout?.fieldWidth) * -0.5;
  const boundaryY = safePoints.reduce((sum, point) => sum + finiteNumber(point?.y), 0) / safePoints.length;
  return safePoints.map((point) => ({
    x: boundaryX + ((finiteNumber(point?.x) - boundaryX) * footprintScale),
    y: boundaryY + ((finiteNumber(point?.y) - boundaryY) * footprintScale)
  }));
};

const buildHighlandRamps = (points = [], rampInset = 0.22) => {
  const safePoints = Array.isArray(points) ? points : [];
  if (safePoints.length < 3) return [];
  const inset = Math.max(0.08, Math.min(0.36, finiteNumber(rampInset, 0.22)));
  return safePoints.map((point, index) => {
    const next = safePoints[(index + 1) % safePoints.length] || point;
    const previous = safePoints[(index + safePoints.length - 1) % safePoints.length] || point;
    return {
      id: `ramp-${index + 1}`,
      vertexIndex: index,
      points: [
        { x: finiteNumber(point?.x), y: finiteNumber(point?.y) },
        interpolateWorldPoint(point, next, inset),
        interpolateWorldPoint(point, previous, inset)
      ]
    };
  });
};

const normalizedBoundsToWorld = (normalizedBounds = [], layout = resolveLayout()) => {
  const left = finiteNumber(normalizedBounds?.[0]);
  const top = finiteNumber(normalizedBounds?.[1]);
  const right = finiteNumber(normalizedBounds?.[2]);
  const bottom = finiteNumber(normalizedBounds?.[3]);
  const topLeft = normalizedToWorld({ x: left, y: top }, layout);
  const bottomRight = normalizedToWorld({ x: right, y: bottom }, layout);
  return {
    x: (topLeft.x + bottomRight.x) * 0.5,
    y: (topLeft.y + bottomRight.y) * 0.5,
    width: Math.max(1, Math.abs(bottomRight.x - topLeft.x)),
    height: Math.max(1, Math.abs(bottomRight.y - topLeft.y))
  };
};

const sourceBoundsToNormalizedBounds = (sourceBounds = []) => {
  const bounds = geometry?.referenceAsset?.effectiveBattlefieldBounds || {};
  const width = Math.max(1, finiteNumber(bounds?.width, 1607));
  const height = Math.max(1, finiteNumber(bounds?.height, 1118));
  const left = finiteNumber(bounds?.left, 43);
  const top = finiteNumber(bounds?.top, 63);
  return [
    (finiteNumber(sourceBounds?.[0]) - left) / width,
    (finiteNumber(sourceBounds?.[1]) - top) / height,
    (finiteNumber(sourceBounds?.[2]) - left) / width,
    (finiteNumber(sourceBounds?.[3]) - top) / height
  ];
};

const sourcePointToWorld = (point = [], layout = resolveLayout()) => {
  const bounds = geometry?.referenceAsset?.effectiveBattlefieldBounds || {};
  const width = Math.max(1, finiteNumber(bounds?.width, 1607));
  const height = Math.max(1, finiteNumber(bounds?.height, 1118));
  return normalizedToWorld({
    x: (finiteNumber(point?.[0]) - finiteNumber(bounds?.left, 43)) / width,
    y: (finiteNumber(point?.[1]) - finiteNumber(bounds?.top, 63)) / height
  }, layout);
};

const resolveWallWorldPath = (wall = {}, layout = resolveLayout()) => {
  if (Array.isArray(wall?.sourcePath) && wall.sourcePath.length >= 2) {
    return wall.sourcePath.map((point) => sourcePointToWorld(point, layout));
  }
  if (Array.isArray(wall?.visualPath) && wall.visualPath.length >= 2) {
    return wall.visualPath.map((point) => normalizedToWorld(point, layout));
  }
  return [];
};

const resolveWallWorldOutline = (wall = {}, layout = resolveLayout()) => (
  Array.isArray(wall?.sourceOutline) && wall.sourceOutline.length >= 3
    ? wall.sourceOutline.map((point) => sourcePointToWorld(point, layout))
    : []
);

const resolveWallType = (wall = {}, category = 'ordinaryWall') => {
  const requested = String(wall?.wallType || '').trim();
  if (requested === 'thinBarrier' || requested === 'thickWall') return requested;
  if (category === 'highWall' || String(wall?.visualKind || '') === 'crescent') return 'thickWall';
  return 'thinBarrier';
};

const resolveWallHeight = (wall = {}, category = 'ordinaryWall', layout = resolveLayout()) => {
  const wallType = resolveWallType(wall, category);
  const defaultHeight = category === 'highWall' ? 72 : (wallType === 'thickWall' ? 52 : 34);
  return Math.max(8, finiteNumber(wall?.renderHeight, defaultHeight) * resolveRuntimeScale(layout));
};

const resolveWallThicknessWorld = (wall = {}, layout = resolveLayout()) => {
  const widthPx = finiteNumber(wall?.collision?.widthPx);
  if (widthPx > 0) {
    const referenceHeight = Math.max(1, finiteNumber(geometry?.referenceAsset?.effectiveBattlefieldBounds?.height, 1118));
    return Math.max(4, (widthPx / referenceHeight) * layout.fieldHeight);
  }
  const radiusNormalized = finiteNumber(wall?.collision?.radiusNormalized);
  if (radiusNormalized > 0) {
    return Math.max(4, radiusNormalized * Math.min(layout.fieldWidth, layout.fieldHeight) * 2);
  }
  return 24;
};

const buildPolylineCollider = (worldPath = [], center = {}, thickness = 24, height = 32) => {
  const parts = [];
  for (let index = 1; index < worldPath.length; index += 1) {
    const start = worldPath[index - 1] || {};
    const end = worldPath[index] || {};
    const dx = finiteNumber(end?.x) - finiteNumber(start?.x);
    const dy = finiteNumber(end?.y) - finiteNumber(start?.y);
    const length = Math.hypot(dx, dy);
    if (length <= 0.1) continue;
    parts.push({
      cx: ((finiteNumber(start?.x) + finiteNumber(end?.x)) * 0.5) - finiteNumber(center?.x),
      cy: ((finiteNumber(start?.y) + finiteNumber(end?.y)) * 0.5) - finiteNumber(center?.y),
      w: length + thickness,
      d: thickness,
      h: Math.max(1, finiteNumber(height, 32)),
      yawDeg: Math.atan2(dy, dx) * 180 / Math.PI
    });
  }
  return parts.length > 0 ? { kind: 'compositeObb', parts } : null;
};

const buildTerrainRegions = (layout) => {
  const terrainRegions = (Array.isArray(geometry?.terrainRegions) ? geometry.terrainRegions : [])
    .map((region) => {
      const normalizedBounds = Array.isArray(region?.normalizedBounds) ? region.normalizedBounds : [];
      const worldBounds = normalizedBoundsToWorld(normalizedBounds, layout);
      if (region?.shape === 'semicircle') {
        return {
          id: String(region?.id || 'sand-region'),
          type: String(region?.type || 'sand'),
          shape: 'semicircle',
          ...worldBounds,
          radius: Math.max(1, Math.min(worldBounds.width, worldBounds.height) * 0.5),
          arcDirection: String(region?.id || '').includes('top') ? 'down' : 'up',
          walkable: region?.walkable !== false,
          z: 0.045,
          sourceRegionId: String(region?.id || '')
        };
      }
      return {
        id: String(region?.id || 'terrain-region'),
        type: String(region?.type || 'grass'),
        shape: 'rect',
        ...worldBounds,
        walkable: region?.walkable !== false,
        z: region?.type === 'grass' ? 0 : 0.045,
        sourceRegionId: String(region?.id || '')
      };
    });

  (Array.isArray(geometry?.spawnRegions) ? geometry.spawnRegions : []).forEach((spawnRegion) => {
    const team = normalizeTeam(spawnRegion?.team);
    const sourceHighlandPoints = (Array.isArray(spawnRegion?.normalizedPolygon) ? spawnRegion.normalizedPolygon : [])
      .map((point) => tupleToWorld(point, layout));
    const highlandPoints = scaleHighlandFootprint(
      sourceHighlandPoints,
      team,
      layout,
      finiteNumber(spawnRegion?.renderFootprintScale, 1)
    );
    const rampInset = Math.max(0.08, Math.min(0.36, finiteNumber(spawnRegion?.rampInset, 0.22)));
    terrainRegions.push({
      id: `terrain-highland-${spawnRegion?.id || team}`,
      type: `highland-${team}`,
      shape: 'polygon',
      points: highlandPoints,
      walkable: spawnRegion?.walkable !== false,
      z: 0.08 * resolveRuntimeScale(layout),
      elevation: Math.max(0, finiteNumber(spawnRegion?.renderElevation, 28)) * resolveRuntimeScale(layout),
      rampInset,
      ramps: buildHighlandRamps(highlandPoints, rampInset),
      railingEdges: Array.isArray(spawnRegion?.railingEdges)
        ? spawnRegion.railingEdges.map((edge) => Math.floor(finiteNumber(edge))).filter((edge) => edge >= 0)
        : [0, 1],
      connectedRouteIds: Array.isArray(spawnRegion?.routeIds) ? spawnRegion.routeIds.slice() : [],
      sourceRegionId: String(spawnRegion?.id || '')
    });
  });

  (Array.isArray(navigation?.routes) ? navigation.routes : []).forEach((route) => {
    const visualCenterline = Array.isArray(route?.visualCenterline) ? route.visualCenterline : [];
    const firstPoint = visualCenterline[0] || [0.5, 0.5];
    const center = tupleToWorld(firstPoint, layout);
    terrainRegions.push({
      id: `terrain-road-${route?.id || 'lane'}`,
      type: 'road',
      shape: 'rect',
      x: 0,
      y: center.y,
      width: layout.fieldWidth,
      height: Math.max(8, finiteNumber(route?.visualWidthNormalized, 0.015) * layout.fieldHeight),
      walkable: true,
      z: 0.065,
      laneId: String(route?.id || '')
    });
  });

  return terrainRegions;
};

const buildLanes = (layout) => (
  (Array.isArray(navigation?.routes) ? navigation.routes : []).map((route) => {
    const visualCenterline = Array.isArray(route?.visualCenterline) ? route.visualCenterline : [];
    const navigationCenterline = Array.isArray(route?.navigationCenterline) ? route.navigationCenterline : [];
    const center = tupleToWorld(visualCenterline[0] || [0.5, 0.5], layout);
    return {
      id: String(route?.id || 'lane'),
      label: String(route?.label || route?.id || '道路'),
      centerY: center.y,
      width: Math.max(24, finiteNumber(route?.navigationWidthNormalized, 0.08) * layout.fieldHeight),
      visualCenterline: visualCenterline.map((point) => tupleToWorld(point, layout)),
      centerline: navigationCenterline.map((point) => tupleToWorld(point, layout)),
      attackerDirection: String(route?.attackerDirection || 'left-to-right'),
      defenderDirection: String(route?.defenderDirection || 'right-to-left'),
      connectedTerrainIds: Array.isArray(route?.connectedTerrainIds) ? route.connectedTerrainIds.slice() : []
    };
  })
);

const buildDeploySlots = (layout) => {
  const slots = [];
  (Array.isArray(geometry?.spawnRegions) ? geometry.spawnRegions : []).forEach((region) => {
    const team = normalizeTeam(region?.team);
    const points = Array.isArray(region?.normalizedPolygon) ? region.normalizedPolygon : [];
    if (points.length !== 3) return;
    const boundaryTop = points[0];
    const tip = points[1];
    const boundaryBottom = points[2];
    const normalizedSlots = [
      [
        (boundaryTop[0] * 0.72) + (tip[0] * 0.28),
        (boundaryTop[1] * 0.72) + (tip[1] * 0.28)
      ],
      [
        (boundaryTop[0] * 0.5) + (tip[0] * 0.35) + (boundaryBottom[0] * 0.15),
        (boundaryTop[1] * 0.5) + (tip[1] * 0.35) + (boundaryBottom[1] * 0.15)
      ],
      [
        (boundaryBottom[0] * 0.72) + (tip[0] * 0.28),
        (boundaryBottom[1] * 0.72) + (tip[1] * 0.28)
      ]
    ];
    normalizedSlots.forEach((point, index) => {
      const worldPoint = tupleToWorld(point, layout);
      slots.push({
        id: `deploy-${region?.id || `${team}-${index + 1}`}-${index + 1}`,
        team,
        laneId: String(region?.laneAffinity || 'jungle'),
        label: `${team === 'defender' ? '防守方' : '进攻方'}${region?.laneAffinity === 'bottom' ? '下' : '上'}高地 ${index + 1}`,
        x: worldPoint.x,
        y: worldPoint.y,
        spawnRegionId: String(region?.id || '')
      });
    });
  });
  return slots;
};

const buildWallObjects = (layout) => {
  const highWalls = Array.isArray(geometry?.walls?.high) ? geometry.walls.high : [];
  const ordinaryWalls = Array.isArray(geometry?.walls?.ordinary) ? geometry.walls.ordinary : [];
  const toObject = (wall, itemId, category, maxHp, index) => {
    const normalizedBounds = sourceBoundsToNormalizedBounds(wall?.sourceBounds);
    const worldBounds = normalizedBoundsToWorld(normalizedBounds, layout);
    const wallPath = resolveWallWorldPath(wall, layout);
    const wallOutline = resolveWallWorldOutline(wall, layout);
    const wallType = resolveWallType(wall, category);
    const thickness = resolveWallThicknessWorld(wall, layout);
    const height = resolveWallHeight(wall, category, layout);
    const collider = buildPolylineCollider(wallPath, worldBounds, thickness, height);
    return {
      objectId: `map-${wall?.id || `${category}-${index + 1}`}`,
      itemId,
      x: worldBounds.x,
      y: worldBounds.y,
      z: 0,
      width: worldBounds.width,
      depth: worldBounds.height,
      height,
      category: 'wall',
      team: 'neutral',
      mapStatic: true,
      presetTags: ['wall'],
      maxHp,
      hp: maxHp,
      blocksMovement: true,
      blocksVision: category === 'highWall' || wallType === 'thickWall' || wall?.collision?.blocksVision === true,
      geometryRefId: String(wall?.id || ''),
      geometryKind: category,
      wallType,
      visualKind: String(wall?.visualKind || ''),
      collisionDefinition: cloneValue(wall?.collision || {}),
      visualPath: wallPath,
      visualOutline: wallOutline,
      collisionPath: wallPath,
      collider
    };
  };
  return [
    ...highWalls.map((wall, index) => toObject(wall, 'training_map_high_wall', 'highWall', 2600, index)),
    ...ordinaryWalls.map((wall, index) => toObject(
      wall,
      resolveWallType(wall, 'ordinaryWall') === 'thickWall' ? 'training_map_thick_wall' : 'training_map_low_wall',
      'ordinaryWall',
      resolveWallType(wall, 'ordinaryWall') === 'thickWall' ? 2200 : 1450,
      index
    ))
  ];
};

const buildHighlandRailingObjects = (layout) => {
  const runtimeScale = resolveRuntimeScale(layout);
  return (Array.isArray(geometry?.spawnRegions) ? geometry.spawnRegions : []).flatMap((spawnRegion) => {
    const sourcePoints = (Array.isArray(spawnRegion?.normalizedPolygon) ? spawnRegion.normalizedPolygon : [])
      .map((point) => tupleToWorld(point, layout));
    const points = scaleHighlandFootprint(
      sourcePoints,
      normalizeTeam(spawnRegion?.team),
      layout,
      finiteNumber(spawnRegion?.renderFootprintScale, 1)
    );
    if (points.length < 3) return [];
    const inset = Math.max(0.08, Math.min(0.36, finiteNumber(spawnRegion?.rampInset, 0.22)));
    const elevation = Math.max(0, finiteNumber(spawnRegion?.renderElevation, 28)) * runtimeScale;
    const railHeight = elevation + Math.max(6, elevation * 0.3);
    const railThickness = Math.max(6, 7 * runtimeScale);
    const railingEdges = Array.isArray(spawnRegion?.railingEdges)
      ? spawnRegion.railingEdges
      : [0, 1];
    return railingEdges.map((rawEdge, index) => {
      const edgeIndex = Math.max(0, Math.floor(finiteNumber(rawEdge))) % points.length;
      const from = points[edgeIndex];
      const to = points[(edgeIndex + 1) % points.length];
      const start = interpolateWorldPoint(from, to, inset);
      const end = interpolateWorldPoint(from, to, 1 - inset);
      const center = {
        x: (start.x + end.x) * 0.5,
        y: (start.y + end.y) * 0.5
      };
      const length = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
      return {
        objectId: `map-highland-rail-${spawnRegion?.id || 'region'}-${edgeIndex + 1}`,
        itemId: 'training_map_low_wall',
        x: center.x,
        y: center.y,
        z: 0,
        width: length,
        depth: railThickness,
        height: railHeight,
        category: 'wall',
        team: 'neutral',
        mapStatic: true,
        presetTags: [],
        maxHp: 999999,
        hp: 999999,
        blocksMovement: true,
        blocksVision: false,
        geometryRefId: `highland-rail-${spawnRegion?.id || 'region'}-${edgeIndex + 1}`,
        geometryKind: 'highlandRail',
        wallType: 'thinBarrier',
        highlandRegionId: `terrain-highland-${spawnRegion?.id || ''}`,
        visualPath: [start, end],
        collisionPath: [start, end],
        collider: buildPolylineCollider([start, end], center, railThickness, railHeight)
      };
    });
  });
};

const buildTowerObjectsAndObjectives = (layout) => (
  (Array.isArray(objectiveData?.objectives) ? objectiveData.objectives : []).map((definition, index) => {
    const position = tupleToWorld(definition?.position, layout);
    const objectiveId = `objective_tower_${String(definition?.objectiveId || `tower-${index + 1}`)}`;
    const team = normalizeTeam(definition?.team);
    const towerRuntime = resolveTowerRuntimeConfig();
    const maxHp = towerRuntime.maxHp;
    const staticScale = resolveRuntimeScale(layout);
    return {
      object: {
        objectId: `map-${objectiveId}`,
        itemId: 'training_map_tower',
        x: position.x,
        y: position.y,
        z: 0,
        width: 58 * staticScale,
        depth: 58 * staticScale,
        height: 96 * staticScale,
        category: 'tower',
        team,
        mapStatic: true,
        presetTags: ['tower'],
        objectiveId,
        objectiveType: 'tower',
        maxHp,
        hp: maxHp,
        attackRange: towerRuntime.attackRange,
        blocksMovement: true,
        blocksVision: true,
        sourceCenter: Array.isArray(definition?.sourceCenter) ? definition.sourceCenter.slice() : []
      },
      objective: {
        objectiveId,
        sourceObjectId: `map-${objectiveId}`,
        type: 'tower',
        team,
        laneId: String(definition?.laneId || 'mid'),
        routeOrder: Math.max(1, Math.floor(finiteNumber(definition?.routeOrder, 1))),
        maxHp,
        attackRange: towerRuntime.attackRange,
        attackIntervalSec: towerRuntime.attackIntervalSec,
        attackDamage: towerRuntime.attackDamage,
        priority: towerRuntime.priority,
        threatDecayPerSecond: towerRuntime.threatDecayPerSecond,
        presetTags: ['tower']
      }
    };
  }));

const resolveCampLaneId = (position = []) => {
  const y = finiteNumber(position?.[1], 0.5);
  if (y <= 0.34) return 'top';
  if (y >= 0.66) return 'bottom';
  return 'jungle';
};

const resolveNeutralCampProfileId = (definition = {}) => {
  const requested = String(definition?.profile || '').trim();
  if (requested) return requested;
  if (String(definition?.group || '') === 'center') return 'center';
  return String(definition?.campId || '').includes('sand') ? 'sand' : 'standard';
};

const resolveNeutralCampRuntime = (definition = {}, layout = resolveLayout(), anchor = {}) => {
  const defaults = neutralCampData?.runtimeDefaults && typeof neutralCampData.runtimeDefaults === 'object'
    ? neutralCampData.runtimeDefaults
    : {};
  const profiles = neutralCampData?.profiles && typeof neutralCampData.profiles === 'object'
    ? neutralCampData.profiles
    : {};
  const profileId = resolveNeutralCampProfileId(definition);
  const profile = profiles?.[profileId] && typeof profiles[profileId] === 'object'
    ? profiles[profileId]
    : (profiles?.standard || {});
  const referenceSize = Math.min(layout.fieldWidth, layout.fieldHeight);
  const radiusFromNormalized = (value, fallback) => Math.max(4, finiteNumber(value, fallback) * referenceSize);
  const spawnRadius = radiusFromNormalized(definition?.spawnRadiusNormalized, 0.028);
  const patrolRadius = radiusFromNormalized(
    definition?.patrolRadiusNormalized,
    finiteNumber(defaults?.patrolRadiusNormalized, 0.018)
  );
  const formationRotationDeg = finiteNumber(definition?.formationRotationDeg);
  const formationFacingRad = formationRotationDeg * (Math.PI / 180);
  const patrolMode = definition?.patrolMode === 'shuttle' ? 'shuttle' : 'loop';
  const patrolDirectionDeg = finiteNumber(definition?.patrolDirectionDeg, formationRotationDeg);
  const patrolDirectionRad = patrolDirectionDeg * (Math.PI / 180);
  const patrolSpan = radiusFromNormalized(
    definition?.patrolSpanNormalized,
    Math.max(0.004, finiteNumber(definition?.patrolRadiusNormalized, finiteNumber(defaults?.patrolRadiusNormalized, 0.018)) * 2)
  );
  const createRingPoints = (radius, startAngle = 0) => [0, 1, 2].map((index) => {
    const angle = startAngle + ((Math.PI * 2 * index) / 3);
    return {
      x: finiteNumber(anchor?.x) + (Math.cos(angle) * radius),
      y: finiteNumber(anchor?.y) + (Math.sin(angle) * radius)
    };
  });
  const createShuttlePoints = (span, directionRad) => {
    const halfSpan = Math.max(4, span * 0.5);
    const offsetX = Math.cos(directionRad) * halfSpan;
    const offsetY = Math.sin(directionRad) * halfSpan;
    return [
      {
        x: finiteNumber(anchor?.x) + offsetX,
        y: finiteNumber(anchor?.y) + offsetY
      },
      {
        x: finiteNumber(anchor?.x) - offsetX,
        y: finiteNumber(anchor?.y) - offsetY
      }
    ];
  };
  const patrolPoints = patrolMode === 'shuttle'
    ? createShuttlePoints(patrolSpan, patrolDirectionRad)
    : createRingPoints(Math.min(spawnRadius * 0.68, patrolRadius), formationFacingRad - (Math.PI / 6));
  return {
    campId: String(definition?.campId || ''),
    profileId,
    label: String(profile?.label || '中立守卫'),
    anchor: { x: finiteNumber(anchor?.x), y: finiteNumber(anchor?.y) },
    formationFacingRad,
    spawnPoints: createRingPoints(spawnRadius * 0.34, formationFacingRad + (Math.PI / 6)),
    patrolMode,
    patrolDirectionRad,
    patrolSpan,
    patrolPoints,
    patrolStartImmediately: definition?.patrolStartImmediately === true,
    initialSpawnAtSec: Math.max(0, finiteNumber(defaults?.initialSpawnAtSec)),
    respawnSec: Math.max(0, finiteNumber(defaults?.respawnSec, 30)),
    senseRadius: radiusFromNormalized(definition?.senseRadiusNormalized, finiteNumber(defaults?.senseRadiusNormalized, 0.052)),
    leashRadius: radiusFromNormalized(definition?.leashRadiusNormalized, finiteNumber(defaults?.leashRadiusNormalized, 0.096)),
    returnRadius: radiusFromNormalized(definition?.returnRadiusNormalized, finiteNumber(defaults?.returnRadiusNormalized, 0.012)),
    patrolIntervalSec: Math.max(0.5, finiteNumber(definition?.patrolIntervalSec, finiteNumber(defaults?.patrolIntervalSec, 4))),
    showPatrolPreview: definition?.showPatrolPreview === true,
    patrolPreviewLength: Math.max(8, patrolSpan * 0.5),
    enabled: definition?.enabled !== false,
    composition: cloneValue(Array.isArray(profile?.composition) ? profile.composition : [])
  };
};

const buildCampObjectsAndObjectives = (layout) => (
  (Array.isArray(neutralCampData?.camps) ? neutralCampData.camps : []).map((definition, index) => {
    const position = tupleToWorld(definition?.position, layout);
    const campId = String(definition?.campId || `camp-${index + 1}`);
    const objectiveId = `objective_neutral_${campId}`;
    const maxHp = 1200;
    const staticScale = resolveRuntimeScale(layout);
    const neutralCamp = resolveNeutralCampRuntime(definition, layout, position);
    return {
      object: {
        objectId: `map-${campId}`,
        itemId: 'training_map_neutral_camp',
        x: position.x,
        y: position.y,
        z: 0,
        width: 62 * staticScale,
        depth: 62 * staticScale,
        height: 42 * staticScale,
        category: 'neutralCamp',
        team: 'neutral',
        mapStatic: true,
        presetTags: ['neutral'],
        neutralCampId: campId,
        neutralProfileId: neutralCamp.profileId,
        neutralFormationFacingRad: neutralCamp.formationFacingRad,
        neutralComposition: cloneValue(neutralCamp.composition),
        neutralPatrolMode: neutralCamp.patrolMode,
        neutralPatrolDirectionRad: neutralCamp.patrolDirectionRad,
        neutralPatrolPreview: neutralCamp.showPatrolPreview,
        neutralPatrolPreviewLength: neutralCamp.patrolPreviewLength,
        objectiveId,
        objectiveType: 'neutralCamp',
        maxHp,
        hp: maxHp,
        blocksMovement: false,
        blocksVision: false,
        sourceCenter: Array.isArray(definition?.sourceCenter) ? definition.sourceCenter.slice() : []
      },
      objective: {
        objectiveId,
        sourceObjectId: `map-${campId}`,
        type: 'neutralCamp',
        team: 'neutral',
        laneId: resolveCampLaneId(definition?.position),
        maxHp,
        attackEnabled: false,
        targetable: false,
        attackRange: 0,
        attackIntervalSec: 1,
        attackDamage: 0,
        rewardLabel: neutralCamp.label,
        neutralCamp,
        presetTags: ['neutral']
      }
    };
  }));

const buildMovementCalibration = (deploySlots, towerEntries) => {
  const definition = geometry?.movementCalibration && typeof geometry.movementCalibration === 'object'
    ? geometry.movementCalibration
    : {};
  const spawnSlotId = String(definition?.referenceSpawnSlotId || 'deploy-spawn-attacker-top-1');
  const spawnSlotIds = Array.from(new Set(
    (Array.isArray(definition?.referenceSpawnSlotIds) ? definition.referenceSpawnSlotIds : [spawnSlotId])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  ));
  const objectiveId = `objective_tower_${String(definition?.referenceObjectiveId || 'tower-attacker-mid-outer')}`;
  const tower = (Array.isArray(towerEntries) ? towerEntries : []).find((entry) => entry?.objective?.objectiveId === objectiveId);
  const distances = spawnSlotIds.map((slotId) => {
    const spawn = (Array.isArray(deploySlots) ? deploySlots : []).find((slot) => slot?.id === slotId);
    return spawn && tower
      ? Math.hypot(
        finiteNumber(spawn.x) - finiteNumber(tower.object?.x),
        finiteNumber(spawn.y) - finiteNumber(tower.object?.y)
      )
      : 0;
  }).filter((value) => value > 0);
  const distance = distances.length > 0
    ? distances.reduce((sum, value) => sum + value, 0) / distances.length
    : 0;
  const nominalUnitSpeed = Math.max(0.2, finiteNumber(definition?.nominalUnitSpeed, 5));
  const leaderSpeedMultiplier = Math.max(1, finiteNumber(definition?.leaderSpeedMultiplier, 18));
  const nominalWorldSpeed = nominalUnitSpeed * leaderSpeedMultiplier;
  return {
    revision: Math.max(1, Math.floor(finiteNumber(definition?.revision, 1))),
    targetTravelSeconds: Math.max(0.1, finiteNumber(definition?.targetTravelSeconds, 8)),
    nominalUnitSpeed,
    leaderSpeedMultiplier,
    nominalWorldSpeed,
    referenceSpawnSlotId: spawnSlotId,
    referenceSpawnSlotIds: spawnSlotIds,
    referenceObjectiveId: String(definition?.referenceObjectiveId || 'tower-attacker-mid-outer'),
    referenceDistanceWorld: distance,
    referenceDistanceRangeWorld: {
      min: distances.length > 0 ? Math.min(...distances) : 0,
      max: distances.length > 0 ? Math.max(...distances) : 0
    },
    expectedTravelSeconds: distance > 0 ? distance / nominalWorldSpeed : 0,
    expectedTravelSecondsRange: {
      min: distances.length > 0 ? Math.min(...distances) / nominalWorldSpeed : 0,
      max: distances.length > 0 ? Math.max(...distances) / nominalWorldSpeed : 0
    },
    scaleMultiplier: Math.max(0.1, finiteNumber(geometry?.coordinateSystems?.runtimeWorld?.scaleMultiplier, 1)),
    notes: String(definition?.notes || '')
  };
};

const buildReferenceTrainingMapConfig = ({ itemCatalog = [] } = {}) => {
  const layout = resolveLayout();
  const towerEntries = buildTowerObjectsAndObjectives(layout);
  const campEntries = buildCampObjectsAndObjectives(layout);
  const deploySlots = buildDeploySlots(layout);
  const movementCalibration = buildMovementCalibration(deploySlots, towerEntries);
  const wallObjects = buildWallObjects(layout);
  const highlandRailingObjects = buildHighlandRailingObjects(layout);
  const objects = [
    ...wallObjects,
    ...highlandRailingObjects,
    ...towerEntries.map((entry) => entry.object),
    ...campEntries.map((entry) => entry.object)
  ];
  const objectives = [
    ...towerEntries.map((entry) => entry.objective),
    ...campEntries.map((entry) => entry.objective)
  ];

  return {
    mapId: String(geometry?.mapId || 'training-war-map-v1'),
    mapVersion: Math.max(1, Math.floor(finiteNumber(geometry?.mapVersion, 1))),
    layoutMeta: {
      fieldWidth: layout.fieldWidth,
      fieldHeight: layout.fieldHeight,
      coordinateOrigin: 'center',
      coordinateSystem: 'x-right-y-up-z-up',
      scaleMultiplier: movementCalibration.scaleMultiplier,
      movementCalibration: cloneValue(movementCalibration),
      referenceAsset: cloneValue(geometry?.referenceAsset || {}),
      maxItemsPerType: 999999
    },
    teamPresentation: {
      attacker: { label: '进攻方高地', color: '#ef2020', direction: 'right' },
      defender: { label: '防守方高地', color: '#16dfe8', direction: 'left' }
    },
    terrainRegions: buildTerrainRegions(layout),
    spawnRegions: cloneValue(geometry?.spawnRegions || []),
    lanes: buildLanes(layout),
    deploySlots,
    movementCalibration: cloneValue(movementCalibration),
    navigation: {
      cellSize: 128,
      roadCost: 1,
      grassCost: finiteNumber(navigation?.terrainCosts?.grass, 1),
      sandCost: finiteNumber(navigation?.terrainCosts?.sand, 1),
      highlandCost: finiteNumber(navigation?.terrainCosts?.highland, 1),
      outsideBattlefieldWalkable: navigation?.navigationRules?.outsideBattlefieldWalkable === true,
      wallClearance: Math.max(2, finiteNumber(navigation?.navigationRules?.wallClearanceNormalized, 0.012) * layout.fieldWidth),
      pathClearance: Math.max(0.5, Math.min(12, finiteNumber(navigation?.navigationRules?.pathClearance, 1.2))),
      agentRadius: Math.max(1, Math.min(8, finiteNumber(navigation?.navigationRules?.agentRadius, 2.25))),
      narrowPassage: {
        cellSize: Math.max(4, Math.min(32, finiteNumber(navigation?.navigationRules?.narrowPassage?.cellSize, 8))),
        probeDistance: Math.max(12, Math.min(120, finiteNumber(navigation?.navigationRules?.narrowPassage?.probeDistance, 48))),
        probeStep: Math.max(1, Math.min(8, finiteNumber(navigation?.navigationRules?.narrowPassage?.probeStep, 2))),
        entryDistance: Math.max(4, Math.min(96, finiteNumber(navigation?.navigationRules?.narrowPassage?.entryDistance, 38))),
        releaseSeconds: Math.max(0.5, Math.min(12, finiteNumber(navigation?.navigationRules?.narrowPassage?.releaseSeconds, 3.2)))
      },
      maxSearchNodes: 1800,
      pathFailureReplanCooldownSeconds: Math.max(0.1, finiteNumber(navigation?.navigationRules?.pathFailureReplanCooldownSeconds, 0.35)),
      aiTargetUnreachableFailureLimit: Math.max(1, Math.min(8, Math.floor(finiteNumber(navigation?.navigationRules?.aiTargetUnreachableFailureLimit, 3)))),
      aiTargetUnreachableCooldownSeconds: Math.max(0.1, finiteNumber(navigation?.navigationRules?.aiTargetUnreachableCooldownSeconds, 2)),
      aiTargetScoring: {
        distanceWeight: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.distanceWeight, 30)),
        sameLaneBonus: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.sameLaneBonus, 18)),
        offLanePenalty: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.offLanePenalty, 7)),
        threatWeight: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.threatWeight, 14)),
        lowHealthBonus: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.lowHealthBonus, 12)),
        inAttackRangeBonus: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.inAttackRangeBonus, 22)),
        attackingAllyBonus: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.attackingAllyBonus, 16)),
        targetLockBonus: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.targetLockBonus, 10)),
        protectedAreaPenalty: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.protectedAreaPenalty, 12)),
        blockedLinePenalty: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.blockedLinePenalty, 5))
      }
    },
    referenceGeometry: {
      schemaVersion: geometry?.schemaVersion || 1,
      debugOverlay: cloneValue(geometry?.debugOverlay || {}),
      assetDirectory: 'backend/data/training-war-map-v1'
    },
    itemCatalog: cloneValue(itemCatalog),
    objects,
    objectives,
    presets: [
      { id: 'empty', label: '空地图兵种测试', enabledTags: [] },
      { id: 'three-lane', label: '三路推演', enabledTags: ['wall', 'tower'] },
      { id: 'full-jungle', label: '完整野区对抗', enabledTags: ['wall', 'tower', 'neutral'] }
    ],
    defaultPresetId: 'full-jungle'
  };
};

module.exports = {
  buildReferenceTrainingMapConfig,
  normalizedToWorld,
  sourceBoundsToNormalizedBounds
};
