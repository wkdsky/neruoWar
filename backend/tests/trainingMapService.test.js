const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TRAINING_MAP_ID,
  TRAINING_MAP_VERSION,
  getTrainingMapConfig,
  validateTrainingMapConfig,
  buildTrainingBattlefield,
  buildLegacyTrainingBattlefield
} = require('../services/trainingMapService');
const highlandDefenseData = require('../data/training-war-map-v1/highland-defense.json');

const distanceToSegment = (point = {}, start = {}, end = {}) => {
  const deltaX = (Number(end?.x) || 0) - (Number(start?.x) || 0);
  const deltaY = (Number(end?.y) || 0) - (Number(start?.y) || 0);
  const lengthSquared = (deltaX * deltaX) + (deltaY * deltaY);
  const progress = lengthSquared <= 0
    ? 0
    : Math.max(0, Math.min(1, (
      (((Number(point?.x) || 0) - (Number(start?.x) || 0)) * deltaX)
      + (((Number(point?.y) || 0) - (Number(start?.y) || 0)) * deltaY)
    ) / lengthSquared));
  return Math.hypot(
    (Number(point?.x) || 0) - ((Number(start?.x) || 0) + (deltaX * progress)),
    (Number(point?.y) || 0) - ((Number(start?.y) || 0) + (deltaY * progress))
  );
};

const distanceToPolyline = (point = {}, path = []) => (
  (Array.isArray(path) ? path : []).slice(1).reduce((shortestDistance, end, index) => (
    Math.min(shortestDistance, distanceToSegment(point, path[index], end))
  ), Infinity)
);

const dotProduct = (first = {}, second = {}) => (
  ((Number(first?.x) || 0) * (Number(second?.x) || 0))
    + ((Number(first?.y) || 0) * (Number(second?.y) || 0))
);

const crossProduct = (first = {}, second = {}) => (
  ((Number(first?.x) || 0) * (Number(second?.y) || 0))
    - ((Number(first?.y) || 0) * (Number(second?.x) || 0))
);

test('reference training map projects all image-derived static elements into the runtime contract', () => {
  const map = getTrainingMapConfig();
  const validation = validateTrainingMapConfig(map);

  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(map.mapId, TRAINING_MAP_ID);
  assert.equal(map.mapVersion, TRAINING_MAP_VERSION);
  assert.equal(map.layoutMeta.coordinateSystem, 'x-right-y-up-z-up');
  assert.deepEqual(
    [map.layoutMeta.fieldWidth, map.layoutMeta.fieldHeight],
    [12600, 8764]
  );
  assert.equal(map.movementCalibration.targetTravelSeconds, 8);
  assert.ok(map.movementCalibration.expectedTravelSeconds >= 7.5);
  assert.ok(map.movementCalibration.expectedTravelSeconds <= 8.5);
  assert.ok(Math.abs(
    map.movementCalibration.referenceDistanceRangeWorld.min
      - map.movementCalibration.referenceDistanceRangeWorld.max
  ) < 0.000001);
  assert.equal(map.referenceGeometry.debugOverlay.referenceImage.url, '/training-war-map-v1-reference.png');
  assert.deepEqual(map.lanes.map((lane) => lane.id), ['top', 'mid', 'bottom']);
  assert.equal(map.deploySlots.filter((slot) => slot.team === 'attacker').length, 6);
  assert.equal(map.deploySlots.filter((slot) => slot.team === 'defender').length, 6);
  assert.equal(map.terrainRegions.filter((region) => region.type === 'sand').length, 11);
  assert.equal(map.terrainRegions.find((region) => region.sourceRegionId === 'sand-central').walkable, true);
  assert.equal(map.navigation.outsideBattlefieldWalkable, false);
  assert.equal(map.navigation.roadCost, 1);
  assert.equal(map.navigation.pathClearance, 1.2);
  assert.equal(map.navigation.agentRadius, 2.25);
  assert.equal(map.navigation.minionRecoveryPlansPerStep, 3);
  assert.equal(map.navigation.narrowPassage.cellSize, 8);
  assert.equal(map.navigation.aiTargetUnreachableFailureLimit, 3);
  assert.equal(map.navigation.aiTargetUnreachableCooldownSeconds, 2);
  assert.deepEqual(map.navigation.aiTargetScoring, {
    distanceWeight: 30,
    sameLaneBonus: 18,
    offLanePenalty: 7,
    threatWeight: 14,
    lowHealthBonus: 12,
    inAttackRangeBonus: 22,
    attackingAllyBonus: 16,
    targetLockBonus: 10,
    protectedAreaPenalty: 12,
    blockedLinePenalty: 5
  });
  const highlands = map.terrainRegions.filter((region) => String(region.type).startsWith('highland-'));
  assert.equal(highlands.length, 4);
  highlands.forEach((region) => {
    assert.equal(region.elevation, 119);
    assert.equal(region.rampControlPoints.length, 3);
    assert.equal(region.ramps.length, 3);
    assert.equal(region.topPolygons.length, 1);
    assert.equal(region.railingPaths.length, 2);
    const [upperOuterPoint, routePoint, lowerOuterPoint] = region.rampControlPoints;
    const outerMidpoint = {
      x: (upperOuterPoint.x + lowerOuterPoint.x) * 0.5,
      y: (upperOuterPoint.y + lowerOuterPoint.y) * 0.5
    };
    const cornerAxis = {
      x: lowerOuterPoint.x - upperOuterPoint.x,
      y: lowerOuterPoint.y - upperOuterPoint.y
    };
    const cornerAxisLength = Math.hypot(cornerAxis.x, cornerAxis.y);
    const candidateRoadAxis = {
      x: -cornerAxis.y / cornerAxisLength,
      y: cornerAxis.x / cornerAxisLength
    };
    const routeOffset = {
      x: routePoint.x - outerMidpoint.x,
      y: routePoint.y - outerMidpoint.y
    };
    const roadAxisNeedsReversing = (
      (candidateRoadAxis.x * routeOffset.x) + (candidateRoadAxis.y * routeOffset.y)
    ) < 0;
    const roadAxis = {
      x: roadAxisNeedsReversing ? -candidateRoadAxis.x : candidateRoadAxis.x,
      y: roadAxisNeedsReversing ? -candidateRoadAxis.y : candidateRoadAxis.y
    };
    const upperSideRamp = region.ramps.find((ramp) => ramp.id === 'upper-outward-road-ramp');
    const frontRamp = region.ramps.find((ramp) => ramp.id === 'front-outward-trapezoid-ramp');
    const lowerSideRamp = region.ramps.find((ramp) => ramp.id === 'lower-outward-road-ramp');
    assert.ok(upperSideRamp, `${region.id} must preserve its upper edge ramp`);
    assert.ok(frontRamp, `${region.id} must add its front trapezoid ramp`);
    assert.ok(lowerSideRamp, `${region.id} must preserve its lower edge ramp`);
    assert.equal(frontRamp.id, 'front-outward-trapezoid-ramp');
    assert.equal(frontRamp.points.length, 4);
    const [upperLowPoint, upperHighPoint, lowerHighPoint, lowerLowPoint] = frontRamp.points;
    const highEdge = {
      x: lowerHighPoint.x - upperHighPoint.x,
      y: lowerHighPoint.y - upperHighPoint.y
    };
    const lowEdge = {
      x: lowerLowPoint.x - upperLowPoint.x,
      y: lowerLowPoint.y - upperLowPoint.y
    };
    const highEdgeLength = Math.hypot(highEdge.x, highEdge.y);
    const lowEdgeLength = Math.hypot(lowEdge.x, lowEdge.y);
    const allowedParallelCrossProduct = highEdgeLength * lowEdgeLength * 0.000001;
    assert.ok(
      Math.abs(crossProduct(highEdge, lowEdge)) <= allowedParallelCrossProduct,
      `${region.id} front ramp edges must remain parallel`
    );
    assert.ok(lowEdgeLength > highEdgeLength, `${region.id} front ramp must flare outward`);
    const highEdgeCenter = {
      x: (upperHighPoint.x + lowerHighPoint.x) * 0.5,
      y: (upperHighPoint.y + lowerHighPoint.y) * 0.5
    };
    const lowEdgeCenter = {
      x: (upperLowPoint.x + lowerLowPoint.x) * 0.5,
      y: (upperLowPoint.y + lowerLowPoint.y) * 0.5
    };
    const descentDirection = {
      x: lowEdgeCenter.x - highEdgeCenter.x,
      y: lowEdgeCenter.y - highEdgeCenter.y
    };
    assert.ok(
      dotProduct(descentDirection, roadAxis) > 0,
      `${region.id} front ramp must descend toward the battlefield`
    );
    assert.ok(
      Math.abs(dotProduct(highEdge, roadAxis)) <= highEdgeLength * 0.000001,
      `${region.id} front ramp high edge must span across its outward direction`
    );
    [
      {
        ramp: upperSideRamp,
        cornerIndex: 0,
        outwardDirection: {
          x: -cornerAxis.x,
          y: -cornerAxis.y
        }
      },
      {
        ramp: lowerSideRamp,
        cornerIndex: 2,
        outwardDirection: cornerAxis
      }
    ].forEach(({ ramp, cornerIndex, outwardDirection }) => {
      assert.equal(ramp.points.length, 4);
      const [lowOuterPoint, highOuterPoint, highRoutePoint, lowRoutePoint] = ramp.points;
      assert.deepEqual(lowOuterPoint, region.rampControlPoints[cornerIndex]);
      const lowRoadEdge = {
        x: lowRoutePoint.x - lowOuterPoint.x,
        y: lowRoutePoint.y - lowOuterPoint.y
      };
      const highlandEdge = {
        x: highRoutePoint.x - highOuterPoint.x,
        y: highRoutePoint.y - highOuterPoint.y
      };
      const lowEdgeLength = Math.hypot(lowRoadEdge.x, lowRoadEdge.y);
      const highEdgeLength = Math.hypot(highlandEdge.x, highlandEdge.y);
      const allowedCrossProduct = Math.hypot(roadAxis.x, roadAxis.y)
        * lowEdgeLength
        * 0.000001;
      assert.ok(
        Math.abs(crossProduct(lowRoadEdge, roadAxis)) <= allowedCrossProduct,
        `${region.id} ${ramp.id} low edge must remain parallel to the road direction`
      );
      assert.ok(
        Math.abs(crossProduct(highlandEdge, roadAxis)) <= allowedCrossProduct,
        `${region.id} ${ramp.id} high edge must remain parallel to the road direction`
      );
      assert.ok(
        Math.abs(lowEdgeLength - highEdgeLength) <= Math.max(lowEdgeLength, highEdgeLength) * 0.000001,
        `${region.id} ${ramp.id} high and low edges must have the same width`
      );
      const sideRampSlopeLength = (
        Math.hypot(highOuterPoint.x - lowOuterPoint.x, highOuterPoint.y - lowOuterPoint.y)
        + Math.hypot(highRoutePoint.x - lowRoutePoint.x, highRoutePoint.y - lowRoutePoint.y)
      ) * 0.5;
      assert.ok(
        sideRampSlopeLength > 250,
        `${region.id} ${ramp.id} must keep its lengthened gentle slope`
      );
      const descentDirection = {
        x: ((lowOuterPoint.x + lowRoutePoint.x) - (highOuterPoint.x + highRoutePoint.x)) * 0.5,
        y: ((lowOuterPoint.y + lowRoutePoint.y) - (highOuterPoint.y + highRoutePoint.y)) * 0.5
      };
      assert.ok(
        dotProduct(descentDirection, outwardDirection) > 0,
        `${region.id} ${ramp.id} must keep descending toward the map edge`
      );
    });
    const [middleHighlandFill] = region.topPolygons;
    const [upperRailingPath, lowerRailingPath] = region.railingPaths;
    assert.equal(upperRailingPath.length, 9);
    assert.equal(lowerRailingPath.length, 9);
    assert.deepEqual(upperRailingPath[upperRailingPath.length - 1], upperHighPoint);
    assert.deepEqual(lowerRailingPath[0], lowerHighPoint);
    assert.deepEqual(
      middleHighlandFill.slice(1, upperRailingPath.length + 1),
      upperRailingPath
    );
    assert.deepEqual(middleHighlandFill[upperRailingPath.length + 1], lowerHighPoint);
    assert.deepEqual(
      middleHighlandFill.slice(upperRailingPath.length + 2, -1),
      lowerRailingPath.slice(1)
    );
    assert.deepEqual(region.points[0], upperOuterPoint);
    assert.deepEqual(region.points[region.points.length - 1], lowerOuterPoint);
    assert.ok(region.points.some((point) => (
      point.x === upperLowPoint.x && point.y === upperLowPoint.y
    )));
    assert.ok(region.points.some((point) => (
      point.x === lowerLowPoint.x && point.y === lowerLowPoint.y
    )));
    const railingPath = [...upperRailingPath, ...lowerRailingPath.slice(1)];
    const railChordCenter = {
      x: (upperRailingPath[0].x + lowerRailingPath[lowerRailingPath.length - 1].x) * 0.5,
      y: (upperRailingPath[0].y + lowerRailingPath[lowerRailingPath.length - 1].y) * 0.5
    };
    const railChordRadius = Math.hypot(
      upperRailingPath[0].x - railChordCenter.x,
      upperRailingPath[0].y - railChordCenter.y
    );
    const railSagitta = railChordRadius * 1.12;
    const expandedRailRadius = (
      (railSagitta * railSagitta) + (railChordRadius * railChordRadius)
    ) / (railSagitta * 2);
    const expandedRailCenterOffset = (
      (railSagitta * railSagitta) - (railChordRadius * railChordRadius)
    ) / (railSagitta * 2);
    const expandedRailCenter = {
      x: railChordCenter.x + (roadAxis.x * expandedRailCenterOffset),
      y: railChordCenter.y + (roadAxis.y * expandedRailCenterOffset)
    };
    railingPath.forEach((point) => {
      assert.ok(
        Math.abs(Math.hypot(point.x - expandedRailCenter.x, point.y - expandedRailCenter.y) - expandedRailRadius) < 0.000001,
        `${region.id} railing must stay on its expanded circle`
      );
    });
    const triangularReach = dotProduct(routeOffset, roadAxis);
    const curvedReach = Math.max(...railingPath.map((point) => dotProduct({
      x: point.x - outerMidpoint.x,
      y: point.y - outerMidpoint.y
    }, roadAxis)));
    assert.ok(curvedReach < triangularReach, `${region.id} outer curve must stay behind the old tip`);
    const originalSemicircleReach = dotProduct({
      x: railChordCenter.x - outerMidpoint.x,
      y: railChordCenter.y - outerMidpoint.y
    }, roadAxis) + railChordRadius;
    const expandedCircleReach = dotProduct({
      x: expandedRailCenter.x - outerMidpoint.x,
      y: expandedRailCenter.y - outerMidpoint.y
    }, roadAxis) + expandedRailRadius;
    assert.ok(
      expandedCircleReach > originalSemicircleReach,
      `${region.id} highland outer circle must expand toward the battlefield`
    );
    assert.ok(
      dotProduct({
        x: lowEdgeCenter.x - outerMidpoint.x,
        y: lowEdgeCenter.y - outerMidpoint.y
      }, roadAxis) > triangularReach,
      `${region.id} front ramp must extend beyond the old highland tip`
    );
    assert.deepEqual(region.railingEdges, [0, 1]);
    assert.equal(region.connectedRouteIds.length, 2);
  });
  const mainRoads = map.terrainRegions.filter((region) => (
    region.type === 'road' && region.roadRole === 'main'
  ));
  assert.deepEqual(
    mainRoads.map((region) => region.height),
    [245.392, 280.448, 245.392]
  );
  const roadConnectors = map.terrainRegions.filter((region) => (
    region.type === 'road' && region.roadRole === 'connector'
  ));
  assert.equal(roadConnectors.length, 8);
  roadConnectors.forEach((connector) => {
    assert.equal(connector.shape, 'polygon');
    assert.equal(connector.points.length, 4);
    assert.ok(['top', 'mid', 'bottom'].includes(connector.laneId));
  });
  const widestConnectorWidth = Math.max(...roadConnectors.map((connector) => {
    const [firstPoint, secondPoint, thirdPoint] = connector.points;
    return Math.min(
      Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y),
      Math.hypot(thirdPoint.x - secondPoint.x, thirdPoint.y - secondPoint.y)
    );
  }));
  highlands.forEach((region) => {
    region.ramps
      .filter((ramp) => ramp.id === 'upper-outward-road-ramp' || ramp.id === 'lower-outward-road-ramp')
      .forEach((ramp) => {
        const [lowStart, , , lowEnd] = ramp.points;
        const lowEdgeWidth = Math.hypot(lowEnd.x - lowStart.x, lowEnd.y - lowStart.y);
        assert.ok(
          lowEdgeWidth >= widestConnectorWidth,
          `${region.id} ${ramp.id} must cover the full road width`
        );
      });
  });
  ['top', 'bottom'].forEach((laneId) => {
    const lane = map.lanes.find((entry) => entry.id === laneId);
    assert.equal(lane.visualConnectors.length, 2);
    lane.visualConnectors.forEach((connector) => {
      assert.equal(connector.centerline.length, 2);
      const roadJoin = connector.centerline[connector.centerline.length - 1];
      assert.ok(Math.abs(roadJoin.y - lane.centerY) < 0.000001);
    });
  });
  const midLane = map.lanes.find((entry) => entry.id === 'mid');
  assert.equal(midLane.visualConnectors.length, 2);
  ['attacker', 'defender'].forEach((team) => {
    const spine = midLane.visualConnectors.find((connector) => connector.id === `${team}-highland-spine`);
    assert.equal(spine.centerline.length, 3);
    assert.equal(spine.centerline[1].y, midLane.centerY);
    assert.deepEqual(
      spine.centerline[1],
      team === 'attacker' ? midLane.visualCenterline[0] : midLane.visualCenterline.at(-1)
    );
  });
  assert.equal(
    roadConnectors.filter((connector) => String(connector.sourceConnectorId).endsWith('highland-spine')).length,
    4
  );
  [
    ['attacker-top-highland', 'terrain-highland-spawn-attacker-top', 0],
    ['defender-top-highland', 'terrain-highland-spawn-defender-top', 0],
    ['attacker-highland-spine', 'terrain-highland-spawn-attacker-top', 0],
    ['attacker-highland-spine', 'terrain-highland-spawn-attacker-bottom', 2],
    ['defender-highland-spine', 'terrain-highland-spawn-defender-top', 0],
    ['defender-highland-spine', 'terrain-highland-spawn-defender-bottom', 2],
    ['attacker-bottom-highland', 'terrain-highland-spawn-attacker-bottom', 2],
    ['defender-bottom-highland', 'terrain-highland-spawn-defender-bottom', 2]
  ].forEach(([connectorId, highlandId, vertexIndex]) => {
    const highland = map.terrainRegions.find((region) => region.id === highlandId);
    const expectedY = highland.rampControlPoints[vertexIndex].y;
    const connectorSegments = roadConnectors.filter((connector) => connector.sourceConnectorId === connectorId);
    assert.ok(
      connectorSegments.some((connector) => connector.points.some((point) => Math.abs(point.y - expectedY) < 0.000001)),
      `${connectorId} must attach to ${highlandId}`
    );
  });
  assert.equal(map.objects.filter((object) => object.category === 'wall').length, 40);
  const roadTowers = map.objects.filter((object) => (
    object.category === 'tower' && object.defenseRole !== 'highlandOutpost'
  ));
  const highlandOutposts = map.objects.filter((object) => object.defenseRole === 'highlandOutpost');
  const barracks = map.objects.filter((object) => object.category === 'barracks');
  assert.equal(roadTowers.length, 14);
  roadTowers.forEach((tower) => {
    const road = map.terrainRegions.find((region) => region.id === `terrain-road-${tower.objectiveId.split('_tower_').pop().split('-')[2]}`);
    assert.ok(road, `${tower.objectId} lost its road`);
    assert.equal(tower.collider?.kind, 'circle');
    assert.ok(Number(tower.collider?.r) > 0, `${tower.objectId} lost its circular base`);
    assert.ok(String(tower.roadSide || '').length > 0, `${tower.objectId} lost its roadside assignment`);
    assert.equal(tower.x, tower.roadCenterX);
    const centerOffset = Math.abs(tower.y - tower.roadCenterY);
    const centerlineClearance = centerOffset - Number(tower.collider.r);
    assert.ok(centerOffset >= road.height * 0.34, `${tower.objectId} must leave the road centerline`);
    assert.ok(centerlineClearance > 24, `${tower.objectId} must leave formation clearance on the road centerline`);
  });
  assert.equal(highlandOutposts.length, 24);
  assert.equal(barracks.length, 4);
  const worldPoint = (position = []) => ({
    x: ((Number(position[0]) || 0) - 0.5) * map.layoutMeta.fieldWidth,
    y: (0.5 - (Number(position[1]) || 0)) * map.layoutMeta.fieldHeight
  });
  highlandDefenseData.highlands.forEach((definition) => {
    const highlandId = String(definition.id);
    const expectedBarracksPosition = worldPoint(definition.barracks.position);
    const barracksObject = map.objects.find((object) => (
      object.objectId === `map-highland-barracks-${highlandId}`
    ));
    assert.equal(barracksObject.x, expectedBarracksPosition.x);
    assert.equal(barracksObject.y, expectedBarracksPosition.y);
    definition.outerTowers.forEach((tower) => {
      const expectedTowerPosition = worldPoint(tower.position);
      const towerObject = map.objects.find((object) => (
        object.objectId === `map-highland-outpost-${highlandId}-${tower.id}`
      ));
      assert.equal(towerObject.x, expectedTowerPosition.x);
      assert.equal(towerObject.y, expectedTowerPosition.y);
      assert.equal(towerObject.collider?.kind, 'circle');
      assert.equal(towerObject.collider?.r, towerObject.width * 0.5);
    });
  });
  assert.equal(map.respawnPoints.length, 4);
  map.respawnPoints.forEach((point) => {
    assert.ok(['attacker', 'defender'].includes(point.team));
    assert.ok(point.radius > 0);
    assert.ok(map.spawnRegions.some((region) => region.id === point.spawnRegionId));
    const buildings = map.objects.filter((object) => object.highlandId === point.highlandId);
    buildings.forEach((building) => {
      const halfWidth = (Number(building.width) || 0) * 0.5;
      const halfDepth = (Number(building.depth) || 0) * 0.5;
      const distance = Math.hypot(
        Math.max(0, Math.abs((Number(point.x) || 0) - (Number(building.x) || 0)) - halfWidth),
        Math.max(0, Math.abs((Number(point.y) || 0) - (Number(building.y) || 0)) - halfDepth)
      );
      assert.ok(distance > Number(point.radius) + 8, `${point.id} must stay clear of ${building.objectId}`);
    });
  });
  assert.equal(map.objects.filter((object) => object.category === 'neutralCamp').length, 18);
  const ordinaryWalls = map.objects.filter((object) => object.geometryKind === 'ordinaryWall');
  assert.equal(ordinaryWalls.length, 28);
  ordinaryWalls.forEach((wall) => {
    assert.ok(Array.isArray(wall.visualPath) && wall.visualPath.length >= 6, `${wall.objectId} lost its visual trace`);
    assert.equal(wall.collider?.kind, 'compositeCapsule');
    assert.ok(wall.collider.parts.length >= wall.visualPath.length - 1, `${wall.objectId} lost collision segments`);
  });
  const highWalls = map.objects.filter((object) => object.geometryKind === 'highWall');
  assert.equal(highWalls.length, 4);
  highWalls.forEach((wall) => {
    assert.equal(wall.wallType, 'thickWall');
    assert.equal(wall.visualKind, 'sine-wave');
    assert.ok(Array.isArray(wall.visualPath) && wall.visualPath.length === 17, `${wall.objectId} lost its smooth wave trace`);
    assert.ok(new Set(wall.visualPath.map((point) => `${point.x}:${point.y}`)).size >= 3, `${wall.objectId} collapsed its visual trace`);
    assert.equal(wall.collider?.kind, 'compositeCapsule');
    assert.ok(wall.collider.parts.length >= wall.visualPath.length - 1, `${wall.objectId} lost collision segments`);
  });
  const thickWalls = ordinaryWalls.filter((wall) => wall.wallType === 'thickWall');
  assert.equal(thickWalls.length, 8);
  thickWalls.forEach((wall) => {
    assert.equal(wall.itemId, 'training_map_thick_wall');
    assert.ok(Array.isArray(wall.visualOutline) && wall.visualOutline.length >= 20);
    assert.equal(wall.blocksVision, true);
  });
  const middleCrescentIds = new Set([
    'ordinary-mid-upper-west-crescent',
    'ordinary-mid-lower-west-crescent',
    'ordinary-mid-upper-east-crescent',
    'ordinary-mid-lower-east-crescent'
  ]);
  const midTowerCrescents = thickWalls.filter((wall) => middleCrescentIds.has(wall.geometryRefId));
  assert.equal(midTowerCrescents.length, 4);
  midTowerCrescents.forEach((wall) => {
    assert.equal(wall.height, 182);
    assert.ok(wall.visualPath.length >= 9 && wall.visualPath.length <= 10);
    assert.ok(wall.visualOutline.length >= 90);
    assert.equal(wall.bezierOutline?.segments?.length, 5);
    assert.equal(wall.collider.parts.length, wall.visualPath.length - 1);
  });
  const highlandRails = map.objects.filter((wall) => wall.geometryKind === 'highlandRail');
  assert.equal(highlandRails.length, 8);
  highlandRails.forEach((rail) => {
    assert.equal(rail.blocksMovement, true);
    assert.equal(rail.blocksVision, false);
    assert.equal(rail.visualPath.length, 9);
    assert.equal(rail.collider?.kind, 'compositeCapsule');
    assert.equal(rail.collider.parts.length, rail.visualPath.length - 1);
  });
  map.deploySlots.forEach((slot) => {
    const rails = highlandRails.filter((rail) => rail.highlandRegionId === `terrain-highland-${slot.spawnRegionId}`);
    const nearestClearance = Math.min(...rails.map((rail) => (
      distanceToPolyline(slot, rail.visualPath) - (rail.depth * 0.5)
    )));
    assert.ok(
      nearestClearance > map.navigation.agentRadius + map.navigation.pathClearance,
      `${slot.id} must start clear of its highland railing`
    );
  });
  assert.equal(map.objectives.filter((objective) => objective.type === 'tower').length, 38);
  assert.equal(map.objectives.filter((objective) => objective.type === 'barracks').length, 4);
  assert.equal(map.objectives.filter((objective) => objective.type === 'neutralCamp').length, 18);
  map.objectives.filter((objective) => objective.type === 'neutralCamp').forEach((camp) => {
    assert.equal(camp.targetable, false);
    assert.equal(camp.attackEnabled, false);
    assert.ok(camp.neutralCamp.composition.length >= 1);
    assert.ok(['melee', 'ranged', 'support'].includes(camp.neutralCamp.composition[0].unitCategory));
    assert.equal(camp.neutralCamp.spawnPoints.length, 3);
    if (camp.neutralCamp.patrolEnabled) assert.ok(camp.neutralCamp.patrolPoints.length >= 2);
    else assert.equal(camp.neutralCamp.patrolPoints.length, 0);
    assert.ok(camp.neutralCamp.leashRadius > camp.neutralCamp.senseRadius);
    assert.ok(['near-highland', 'remote', 'central-sand'].includes(camp.neutralCamp.strengthTier));
    const marker = map.objects.find((object) => object.objectId === camp.sourceObjectId);
    assert.equal(marker.neutralStrengthTier, camp.neutralCamp.strengthTier);
  });
  const countNeutralCampUnits = (camp) => camp.neutralCamp.composition
    .reduce((total, entry) => total + Number(entry?.count || 0), 0);
  const nearHighlandCamps = map.objectives.filter((objective) => (
    objective.type === 'neutralCamp' && objective.neutralCamp.strengthTier === 'near-highland'
  ));
  const remoteCamps = map.objectives.filter((objective) => (
    objective.type === 'neutralCamp' && objective.neutralCamp.strengthTier === 'remote'
  ));
  const centralSandCamps = map.objectives.filter((objective) => (
    objective.type === 'neutralCamp' && objective.neutralCamp.strengthTier === 'central-sand'
  ));
  assert.equal(nearHighlandCamps.length, 8);
  assert.equal(remoteCamps.length, 8);
  assert.equal(centralSandCamps.length, 2);
  nearHighlandCamps.forEach((camp) => {
    const count = countNeutralCampUnits(camp);
    assert.ok(count >= 40 && count < 100);
  });
  remoteCamps.forEach((camp) => {
    assert.ok(countNeutralCampUnits(camp) >= 200);
  });
  centralSandCamps.forEach((camp) => {
    assert.ok(countNeutralCampUnits(camp) >= 400);
  });
  const eliteCamps = map.objectives.filter((objective) => (
    objective.type === 'neutralCamp'
    && objective.neutralCamp.profileId === 'elite-triad'
  ));
  assert.equal(eliteCamps.length, 2);
  eliteCamps.forEach((camp) => {
    assert.deepEqual(
      camp.neutralCamp.composition.map((entry) => entry.unitCategory),
      ['melee', 'ranged', 'support']
    );
  });
  const eliteCampMarkers = map.objects.filter((object) => object.neutralProfileId === 'elite-triad');
  assert.equal(eliteCampMarkers.length, 2);
  eliteCampMarkers.forEach((marker) => {
    assert.ok(marker.neutralComposition.some((entry) => entry.unitCategory === 'support'));
    assert.ok(Number.isFinite(marker.neutralFormationFacingRad));
  });
  centralSandCamps.forEach((camp) => {
    assert.equal(camp.neutralCamp.profileId, 'center');
    assert.equal(camp.neutralCamp.patrolStartImmediately, true);
    assert.equal(camp.neutralCamp.patrolEnabled, true);
    assert.equal(camp.neutralCamp.patrolIntervalSec, 2.5);
    assert.equal(camp.neutralCamp.patrolMode, 'shuttle');
    assert.equal(camp.neutralCamp.patrolPoints.length, 2);
    assert.equal(camp.neutralCamp.showPatrolPreview, true);
    assert.ok(camp.neutralCamp.returnRadius > (camp.neutralCamp.patrolSpan * 0.5));
    const [outbound, inbound] = camp.neutralCamp.patrolPoints;
    assert.ok(Math.abs((outbound.x + inbound.x) - (camp.neutralCamp.anchor.x * 2)) < 0.000001);
    assert.ok(Math.abs((outbound.y + inbound.y) - (camp.neutralCamp.anchor.y * 2)) < 0.000001);
    const outboundX = outbound.x - camp.neutralCamp.anchor.x;
    const outboundY = outbound.y - camp.neutralCamp.anchor.y;
    const headingDot = (outboundX * Math.cos(camp.neutralCamp.patrolDirectionRad))
      + (outboundY * Math.sin(camp.neutralCamp.patrolDirectionRad));
    assert.ok(headingDot > 0);
    const marker = map.objects.find((object) => object.objectId === camp.sourceObjectId);
    assert.equal(marker.neutralPatrolPreview, true);
    assert.equal(marker.neutralPatrolMode, 'shuttle');
  });
  map.objectives
    .filter((camp) => camp.type === 'neutralCamp' && camp.neutralCamp.strengthTier !== 'central-sand')
    .forEach((camp) => {
      assert.equal(camp.neutralCamp.patrolEnabled, false);
      assert.deepEqual(camp.neutralCamp.patrolPoints, []);
      const marker = map.objects.find((object) => object.objectId === camp.sourceObjectId);
      assert.equal(marker.neutralPatrolEnabled, false);
      assert.equal(marker.neutralPatrolPreview, false);
    });
  map.objectives.filter((objective) => objective.type === 'tower').forEach((tower) => {
    if (tower.defenseRole === 'highlandOutpost') {
      assert.equal(tower.maxHp, 2000);
      assert.equal(tower.attackRange, 455);
      assert.equal(tower.attackIntervalSec, 0.8);
      assert.equal(tower.attackDamage, 23);
      return;
    }
    assert.equal(tower.maxHp, 2200);
    assert.equal(tower.attackRange, 329);
    assert.equal(tower.attackIntervalSec, 0.8);
    assert.equal(tower.attackDamage, 20);
    assert.equal(tower.priority, 'nearest');
    assert.equal(tower.threatDecayPerSecond, 0.2);
  });
  map.objects
    .filter((object) => object.objectiveType === 'tower' && object.defenseRole !== 'highlandOutpost')
    .forEach((tower) => {
      assert.equal(tower.width, 29 * 3.5);
      assert.equal(tower.depth, 29 * 3.5);
      assert.equal(tower.height, 96 * 3.5);
      assert.equal(tower.rangeIndicatorMode, 'proximity');
    });
  map.objectives.filter((objective) => objective.type === 'barracks').forEach((barracksObjective) => {
    assert.equal(barracksObjective.maxHp, 5600);
    assert.equal(barracksObjective.weaponProfiles.length, 2);
    assert.equal(barracksObjective.attackRange, 630);
    assert.ok(barracksObjective.weaponProfiles.some((weapon) => weapon.attackRange === 546));
    assert.ok(barracksObjective.weaponProfiles.some((weapon) => weapon.attackRange === 630));
    assert.ok(barracksObjective.weaponProfiles.some((weapon) => weapon.projectileType === 'arrow'));
    assert.ok(barracksObjective.weaponProfiles.some((weapon) => weapon.projectileType === 'shell'));
  });
  assert.ok(map.objects.find((object) => object.objectId === 'map-objective_tower_tower-attacker-top-outer').y > 0);
  assert.ok(map.objects.find((object) => object.objectId === 'map-objective_tower_tower-attacker-bottom-outer').y < 0);
});

test('central high walls remain symmetric low-amplitude waves outside roads and sand', () => {
  const map = getTrainingMapConfig();
  const highWalls = map.objects.filter((object) => object.geometryKind === 'highWall');
  assert.equal(highWalls.length, 4);
  highWalls.forEach((wall) => {
    assert.equal(wall.wallType, 'thickWall');
    assert.equal(wall.visualKind, 'sine-wave');
    assert.equal(wall.visualPath.length, 17);
    assert.equal(wall.collider?.parts.length, 16);
  });

  const highWallByGeometryId = Object.fromEntries(highWalls.map((wall) => [wall.geometryRefId, wall]));
  const assertRuntimeHorizontalMirror = (westId, eastId) => {
    const westPath = highWallByGeometryId[westId].visualPath;
    const eastPath = highWallByGeometryId[eastId].visualPath;
    westPath.forEach((point, index) => {
      assert.ok(Math.abs(point.x + eastPath[index].x) < 0.000001, `${westId}/${eastId} x mirror`);
      assert.ok(Math.abs(point.y - eastPath[index].y) < 0.000001, `${westId}/${eastId} y alignment`);
    });
  };
  const assertRuntimeVerticalMirror = (upperId, lowerId) => {
    const upperPath = highWallByGeometryId[upperId].visualPath;
    const lowerPath = highWallByGeometryId[lowerId].visualPath;
    upperPath.forEach((point, index) => {
      const mirroredPoint = lowerPath[lowerPath.length - index - 1];
      assert.ok(Math.abs(point.x - mirroredPoint.x) < 0.000001, `${upperId}/${lowerId} x alignment`);
      assert.ok(Math.abs(point.y + mirroredPoint.y) < 0.000001, `${upperId}/${lowerId} y mirror`);
    });
  };
  assertRuntimeHorizontalMirror('high-wall-upper-west', 'high-wall-upper-east');
  assertRuntimeHorizontalMirror('high-wall-lower-west', 'high-wall-lower-east');
  assertRuntimeVerticalMirror('high-wall-upper-west', 'high-wall-lower-west');
  assertRuntimeVerticalMirror('high-wall-upper-east', 'high-wall-lower-east');

  const centralSand = map.terrainRegions.find((region) => region.sourceRegionId === 'sand-central');
  assert.ok(centralSand, 'central sand region is missing');
  const centralSandWestEdge = centralSand.x - (centralSand.width * 0.5);
  const centralSandEastEdge = centralSand.x + (centralSand.width * 0.5);
  const highWallHalfThickness = highWalls[0].collider.parts[0].r;
  ['high-wall-upper-west', 'high-wall-lower-west'].forEach((wallId) => {
    const path = highWallByGeometryId[wallId].visualPath;
    assert.ok(
      Math.max(...path.map((point) => point.x)) + highWallHalfThickness < centralSandWestEdge,
      `${wallId} must stay west of the central sand`
    );
  });
  ['high-wall-upper-east', 'high-wall-lower-east'].forEach((wallId) => {
    const path = highWallByGeometryId[wallId].visualPath;
    assert.ok(
      Math.min(...path.map((point) => point.x)) - highWallHalfThickness > centralSandEastEdge,
      `${wallId} must stay east of the central sand`
    );
  });

  const mainRoadTerrainRegions = map.terrainRegions.filter((region) => (
    region.type === 'road' && region.roadRole === 'main'
  ));
  highWalls.forEach((wall) => {
    const pathYValues = wall.visualPath.map((point) => point.y);
    const wallMinY = Math.min(...pathYValues) - highWallHalfThickness;
    const wallMaxY = Math.max(...pathYValues) + highWallHalfThickness;
    mainRoadTerrainRegions.forEach((road) => {
      const roadMinY = road.y - (road.height * 0.5);
      const roadMaxY = road.y + (road.height * 0.5);
      assert.ok(
        wallMaxY < roadMinY || wallMinY > roadMaxY,
        `${wall.objectId} must not overlap ${road.id}`
      );
    });
  });
});

test('middle inner towers retain four reference-traced crescent thick walls', () => {
  const map = getTrainingMapConfig();
  const crescentIds = new Set([
    'ordinary-mid-upper-west-crescent',
    'ordinary-mid-lower-west-crescent',
    'ordinary-mid-upper-east-crescent',
    'ordinary-mid-lower-east-crescent'
  ]);
  const crescents = map.objects.filter((wall) => crescentIds.has(wall.geometryRefId));
  assert.equal(crescents.length, 4);
  const crescentById = Object.fromEntries(crescents.map((wall) => [wall.geometryRefId, wall]));
  const crescentOutlines = crescents.map((wall) => wall.visualOutline);
  crescentOutlines.forEach((outline) => assert.ok(outline.length >= 90));
  const curvesUpward = (wall) => (
    Math.min(...wall.visualPath.map((point) => point.y))
      < Math.min(wall.visualPath[0].y, wall.visualPath[wall.visualPath.length - 1].y)
  );
  const curvesDownward = (wall) => (
    Math.max(...wall.visualPath.map((point) => point.y))
      > Math.max(wall.visualPath[0].y, wall.visualPath[wall.visualPath.length - 1].y)
  );
  assert.ok(curvesUpward(crescentById['ordinary-mid-upper-west-crescent']));
  assert.ok(curvesUpward(crescentById['ordinary-mid-upper-east-crescent']));
  assert.ok(curvesDownward(crescentById['ordinary-mid-lower-west-crescent']));
  assert.ok(curvesDownward(crescentById['ordinary-mid-lower-east-crescent']));

  const westTower = map.objects.find((object) => object.objectId === 'map-objective_tower_tower-attacker-mid-inner');
  const eastTower = map.objects.find((object) => object.objectId === 'map-objective_tower_tower-defender-mid-inner');
  const westCrescents = [
    crescentById['ordinary-mid-upper-west-crescent'],
    crescentById['ordinary-mid-lower-west-crescent']
  ];
  const eastCrescents = [
    crescentById['ordinary-mid-upper-east-crescent'],
    crescentById['ordinary-mid-lower-east-crescent']
  ];
  westCrescents.forEach((wall) => {
    assert.ok(
      Math.max(...wall.visualOutline.map((point) => point.x)) > westTower.x,
      `${wall.geometryRefId} must reach toward the central sand`
    );
    assert.ok(Math.abs(wall.y - westTower.y) > (westTower.depth * 0.5), `${wall.geometryRefId} must flank its tower`);
  });
  eastCrescents.forEach((wall) => {
    assert.ok(
      Math.min(...wall.visualOutline.map((point) => point.x)) < eastTower.x,
      `${wall.geometryRefId} must reach toward the central sand`
    );
    assert.ok(Math.abs(wall.y - eastTower.y) > (eastTower.depth * 0.5), `${wall.geometryRefId} must flank its tower`);
  });
  const middleRoad = map.terrainRegions.find((region) => region.id === 'terrain-road-mid');
  crescents.forEach((wall) => {
    const halfThickness = wall.collider.parts[0].r;
    const yValues = wall.visualPath.map((point) => point.y);
    const lowerEdge = Math.min(...yValues) - halfThickness;
    const upperEdge = Math.max(...yValues) + halfThickness;
    assert.ok(
      upperEdge < middleRoad.y - (middleRoad.height * 0.5)
        || lowerEdge > middleRoad.y + (middleRoad.height * 0.5),
      `${wall.geometryRefId} must not overlap the middle road`
    );
  });
});

test('training map rejects a respawn circle that intersects its highland barracks', () => {
  const map = getTrainingMapConfig();
  const respawnPoint = map.respawnPoints.find((point) => point.highlandId === 'attacker-top');
  const barracks = map.objects.find((object) => object.objectId === 'map-highland-barracks-attacker-top');

  respawnPoint.x = barracks.x;
  respawnPoint.y = barracks.y;

  const validation = validateTrainingMapConfig(map);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes(
    `重生点过近于高地建筑: ${respawnPoint.id}/${barracks.objectId}`
  ));
});

test('training battlefield exposes map contract and preset-specific objectives', () => {
  const full = buildTrainingBattlefield({
    itemCatalog: [{ itemId: 'custom_wall', name: '自定义墙' }],
    presetId: 'full-jungle'
  });
  const empty = buildTrainingBattlefield({ presetId: 'empty' });
  const threeLane = buildTrainingBattlefield({ presetId: 'three-lane' });

  assert.equal(full.mapId, TRAINING_MAP_ID);
  assert.equal(full.mapVersion, TRAINING_MAP_VERSION);
  assert.equal(full.map.activePresetId, 'full-jungle');
  assert.ok(full.itemCatalog.some((item) => item.itemId === 'custom_wall'));
  assert.ok(full.itemCatalog.some((item) => item.itemId === 'training_map_tower'));
  assert.ok(full.map.activeObjectives.some((objectiveId) => objectiveId.startsWith('objective_neutral_')));
  assert.ok(!empty.map.activeObjectives.some((objectiveId) => objectiveId.startsWith('objective_tower_')));
  assert.ok(threeLane.map.activeObjectives.some((objectiveId) => objectiveId.startsWith('objective_tower_')));
  assert.ok(!threeLane.map.activeObjectives.some((objectiveId) => objectiveId.startsWith('objective_neutral_')));
});

test('legacy-flat remains an explicit compatibility fallback', () => {
  const battlefield = buildLegacyTrainingBattlefield({ itemCatalog: [{ itemId: 'wall_1' }] });

  assert.equal(battlefield.mapId, 'legacy-flat');
  assert.equal(battlefield.objects.length, 0);
  assert.equal(battlefield.itemCatalog.length, 1);
});
