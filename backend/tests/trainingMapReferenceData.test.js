const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const assetDirectory = path.resolve(__dirname, '../data/training-war-map-v1');
const geometry = require(path.join(assetDirectory, 'geometry.json'));
const navigation = require(path.join(assetDirectory, 'navigation.json'));
const objectives = require(path.join(assetDirectory, 'objectives.json'));
const neutralCamps = require(path.join(assetDirectory, 'neutral-camps.json'));
const highlandDefense = require(path.join(assetDirectory, 'highland-defense.json'));

const inNormalizedRange = (value) => Number.isFinite(value) && value >= 0 && value <= 1;

const assertNormalizedPoint = (point, label) => {
  assert.ok(Array.isArray(point) && point.length === 2, `${label} must be a [x, y] point`);
  assert.ok(inNormalizedRange(point[0]), `${label}.x must be normalized`);
  assert.ok(inNormalizedRange(point[1]), `${label}.y must be normalized`);
};

const assertUniqueIds = (records, key, label) => {
  const ids = records.map((record) => record?.[key]);
  assert.equal(new Set(ids).size, ids.length, `${label} IDs must be unique`);
};

const toNormalized = (sourceCenter) => {
  const bounds = geometry.referenceAsset.effectiveBattlefieldBounds;
  return [
    (sourceCenter[0] - bounds.left) / bounds.width,
    (sourceCenter[1] - bounds.top) / bounds.height
  ];
};

test('reference geometry locks the source asset, cropped field and coordinate convention', () => {
  const referencePath = path.resolve(__dirname, '../..', geometry.referenceAsset.file);
  const frontendReferencePath = path.resolve(__dirname, '../../frontend/public/training-war-map-v1-reference.png');
  const actualHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(referencePath))
    .digest('hex');
  const frontendHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(frontendReferencePath))
    .digest('hex');

  assert.equal(geometry.mapId, 'training-war-map-v1');
  assert.equal(geometry.mapVersion, 33);
  assert.equal(actualHash, geometry.referenceAsset.sha256);
  assert.equal(frontendHash, geometry.referenceAsset.sha256);
  assert.deepEqual(geometry.referenceAsset.effectiveBattlefieldBounds, {
    left: 43,
    top: 63,
    right: 1650,
    bottom: 1181,
    width: 1607,
    height: 1118,
    rightAndBottomAreVectorBounds: true
  });
  assert.equal(geometry.coordinateSystems.runtimeWorld.yAxis, 'up');
  assert.equal(geometry.coordinateSystems.runtimeWorld.width, 12600);
  assert.equal(geometry.coordinateSystems.runtimeWorld.height, 8764);
  assert.equal(geometry.coordinateSystems.runtimeWorld.scaleMultiplier, 4.6666666666);
  assert.equal(geometry.coordinateSystems.runtimeWorld.elevationAxis, 'z up');
  assert.equal(geometry.movementCalibration.targetTravelSeconds, 8);
  assert.equal(geometry.movementCalibration.referenceSpawnSlotId, 'deploy-spawn-attacker-top-1');
  geometry.spawnRegions.forEach((region) => {
    assert.equal(region.rampLayout, 'road-corner-outward-pair-with-front-trapezoid', `${region.id} ramp layout`);
  });
  assert.deepEqual(geometry.movementCalibration.referenceSpawnSlotIds, [
    'deploy-spawn-attacker-top-1',
    'deploy-spawn-attacker-bottom-3'
  ]);
  assert.equal(geometry.movementCalibration.referenceObjectiveId, 'tower-attacker-mid-outer');
  assert.equal(geometry.spawnRegions.length, 4);
  assert.equal(geometry.walls.high.length, 4);
  assert.equal(geometry.walls.ordinary.length, 28);

  geometry.spawnRegions.forEach((region) => {
    assert.equal(region.normalizedPolygon.length, 3, `${region.id} must retain its ramp control triangle`);
    region.normalizedPolygon.forEach((point) => assertNormalizedPoint(point, region.id));
    assert.equal(region.renderElevation, 34, `${region.id} must keep its render elevation`);
    assert.equal(region.renderFootprintScale, 1.16, `${region.id} must retain its enlarged footprint`);
    assert.equal(region.rampInset, 0.22, `${region.id} must retain its highland surface inset`);
    assert.deepEqual(region.frontRamp, {
      highEdgeArcFraction: 0.34,
      lowEdgeWidthScale: 1.45,
      outwardLengthRatio: 0.65
    }, `${region.id} front ramp profile`);
    assert.deepEqual(region.edgeRamps, {
      edgeWidthScale: 1.3,
      slopeLengthScale: 1.5
    }, `${region.id} edge ramp profile`);
    assert.deepEqual(region.outerEdgeCurve, {
      kind: 'semicircle',
      segments: 24,
      bulgeScale: 1.12
    }, `${region.id} outer edge curve`);
    assert.deepEqual(region.railingEdges, [0, 1], `${region.id} must rail both diagonal edges`);
  });
  geometry.walls.high.forEach((wall) => {
    assert.equal(wall.visualKind, 'sine-wave', `${wall.id} must retain its smooth wave profile`);
    assert.equal(wall.wallType, 'thickWall', `${wall.id} must remain a thick wall`);
    assert.equal(wall.visualPath.length, 17, `${wall.id} must retain its smooth wave samples`);
    wall.visualPath.forEach((point) => assertNormalizedPoint(point, wall.id));
    const xValues = wall.visualPath.map((point) => point[0]);
    const yValues = wall.visualPath.map((point) => point[1]);
    assert.ok(
      (Math.max(...xValues) - Math.min(...xValues)) <= 0.015,
      `${wall.id} wave amplitude must remain low`
    );
    assert.ok(
      (Math.max(...yValues) - Math.min(...yValues)) >= 0.16,
      `${wall.id} must retain a substantial wall span`
    );
    assert.equal(wall.collision.kind, 'polyline-buffer');
  });
  const highWallsById = Object.fromEntries(geometry.walls.high.map((wall) => [wall.id, wall]));
  const assertHorizontalMirror = (westId, eastId) => {
    const westPath = highWallsById[westId].visualPath;
    const eastPath = highWallsById[eastId].visualPath;
    westPath.forEach((point, index) => {
      assert.ok(Math.abs(point[0] + eastPath[index][0] - 1) < 0.000001, `${westId}/${eastId} x mirror`);
      assert.ok(Math.abs(point[1] - eastPath[index][1]) < 0.000001, `${westId}/${eastId} y alignment`);
    });
  };
  const assertVerticalMirror = (upperId, lowerId) => {
    const upperPath = highWallsById[upperId].visualPath;
    const lowerPath = highWallsById[lowerId].visualPath;
    upperPath.forEach((point, index) => {
      const mirroredPoint = lowerPath[lowerPath.length - index - 1];
      assert.ok(Math.abs(point[0] - mirroredPoint[0]) < 0.000001, `${upperId}/${lowerId} x alignment`);
      assert.ok(Math.abs(point[1] + mirroredPoint[1] - 1) < 0.000001, `${upperId}/${lowerId} y mirror`);
    });
  };
  assertHorizontalMirror('high-wall-upper-west', 'high-wall-upper-east');
  assertHorizontalMirror('high-wall-lower-west', 'high-wall-lower-east');
  assertVerticalMirror('high-wall-upper-west', 'high-wall-lower-west');
  assertVerticalMirror('high-wall-upper-east', 'high-wall-lower-east');
  const roadClearance = geometry.walls.high[0].collision.radiusNormalized;
  geometry.walls.high.forEach((wall) => {
    wall.visualPath.forEach((point) => {
      navigation.routes.forEach((route) => {
        const roadCenterY = route.visualCenterline[0][1];
        const roadHalfWidth = route.visualWidthNormalized * 0.5;
        assert.ok(
          Math.abs(point[1] - roadCenterY) > roadHalfWidth + roadClearance,
          `${wall.id} must remain clear of ${route.id} road`
        );
      });
    });
  });
  geometry.walls.ordinary.forEach((wall) => {
    assert.ok(Array.isArray(wall.sourcePath) && wall.sourcePath.length >= 6, `${wall.id} must retain its source trace`);
    wall.sourcePath.forEach((point) => {
      assert.ok(point[0] >= 43 && point[0] <= 1650, `${wall.id} source x must remain in the field`);
      assert.ok(point[1] >= 63 && point[1] <= 1181, `${wall.id} source y must remain in the field`);
    });
    assert.equal(wall.collision.kind, 'polyline-buffer');
    assert.ok(wall.collision.widthPx > 0, `${wall.id} needs a collision width`);
  });
  const thickWalls = geometry.walls.ordinary.filter((wall) => wall.visualKind === 'crescent');
  assert.equal(thickWalls.length, 8);
  thickWalls.forEach((wall) => {
    assert.equal(wall.wallType, 'thickWall', `${wall.id} must be modeled as a thick wall`);
    assert.ok(Array.isArray(wall.sourceOutline) && wall.sourceOutline.length >= 20, `${wall.id} lost its filled outline`);
    assert.equal(wall.collision.blocksVision, true, `${wall.id} must block vision`);
  });
  const middleCrescentIds = new Set([
    'ordinary-mid-upper-west-crescent',
    'ordinary-mid-lower-west-crescent',
    'ordinary-mid-upper-east-crescent',
    'ordinary-mid-lower-east-crescent'
  ]);
  const midTowerCrescents = thickWalls.filter((wall) => middleCrescentIds.has(wall.id));
  assert.equal(midTowerCrescents.length, 4);
  const expectedMiddleCrescentTraces = {
    'ordinary-mid-upper-west-crescent': {
      sourceBounds: [597, 479, 704, 572],
      outlinePoints: 252,
      outlineHash: 'c31a9bc14032e9868608348a0e4da3d22f51d7ae178535cd91ac29b8ba6217b3'
    },
    'ordinary-mid-lower-west-crescent': {
      sourceBounds: [598, 672, 705, 765],
      outlinePoints: 252,
      outlineHash: '46d095108a0f96b224deee264cafd074fb244844a70d9177ecff93e053bb8389'
    },
    'ordinary-mid-upper-east-crescent': {
      sourceBounds: [990, 480, 1096, 572],
      outlinePoints: 236,
      outlineHash: '31003161bd93805e1d14cfe316a35a2ba1032c5826046e503eb89336df32d2ac'
    },
    'ordinary-mid-lower-east-crescent': {
      sourceBounds: [990, 674, 1097, 766],
      outlinePoints: 246,
      outlineHash: '8a913e3b280fe7c7249802a5a18c3372296decb2e3ac65ed16e7b15048146e0a'
    }
  };
  midTowerCrescents.forEach((wall) => {
    const expectedTrace = expectedMiddleCrescentTraces[wall.id];
    assert.deepEqual(wall.sourceBounds, expectedTrace.sourceBounds, `${wall.id} source bounds`);
    assert.ok(wall.sourcePath.length >= 9 && wall.sourcePath.length <= 10, `${wall.id} must retain its traced centerline`);
    assert.equal(wall.sourceOutline.length, expectedTrace.outlinePoints, `${wall.id} trace point count`);
    assert.equal(
      crypto.createHash('sha256').update(JSON.stringify(wall.sourceOutline)).digest('hex'),
      expectedTrace.outlineHash,
      `${wall.id} must retain its exact image-traced outline`
    );
    assert.equal(wall.renderHeight, undefined, `${wall.id} must use normal thick-wall height`);
    assert.equal(wall.collision.widthPx, 40, `${wall.id} must retain its image-traced thickness`);
    assert.equal(wall.bezierOutline?.segments?.length, 5, `${wall.id} must use a five-segment smooth curve`);
    wall.sourceOutline.forEach((point) => {
      assert.ok(point[0] >= wall.sourceBounds[0] && point[0] <= wall.sourceBounds[2] + 1, `${wall.id} outline x bounds`);
      assert.ok(point[1] >= wall.sourceBounds[1] && point[1] <= wall.sourceBounds[3] + 1, `${wall.id} outline y bounds`);
    });
  });
  const middleCrescentById = Object.fromEntries(midTowerCrescents.map((wall) => [wall.id, wall]));
  const upperWestPath = middleCrescentById['ordinary-mid-upper-west-crescent'].sourcePath;
  const lowerWestPath = middleCrescentById['ordinary-mid-lower-west-crescent'].sourcePath;
  const upperEastPath = middleCrescentById['ordinary-mid-upper-east-crescent'].sourcePath;
  const lowerEastPath = middleCrescentById['ordinary-mid-lower-east-crescent'].sourcePath;
  assert.ok(
    Math.max(...upperWestPath.map((point) => point[1])) > Math.max(upperWestPath[0][1], upperWestPath[upperWestPath.length - 1][1]),
    'upper-west crescent must curve downward'
  );
  assert.ok(
    Math.max(...upperEastPath.map((point) => point[1])) > Math.max(upperEastPath[0][1], upperEastPath[upperEastPath.length - 1][1]),
    'upper-east crescent must curve downward'
  );
  assert.ok(
    Math.min(...lowerWestPath.map((point) => point[1])) < Math.min(lowerWestPath[0][1], lowerWestPath[lowerWestPath.length - 1][1]),
    'lower-west crescent must curve upward'
  );
  assert.ok(
    Math.min(...lowerEastPath.map((point) => point[1])) < Math.min(lowerEastPath[0][1], lowerEastPath[lowerEastPath.length - 1][1]),
    'lower-east crescent must curve upward'
  );
  const midRoad = navigation.routes.find((route) => route.id === 'mid');
  const midRoadCenterY = 63 + (midRoad.visualCenterline[0][1] * 1118);
  const midRoadHalfWidth = (midRoad.visualWidthNormalized * 1118) * 0.5;
  midTowerCrescents.forEach((wall) => {
    wall.sourcePath.forEach((point) => {
      assert.ok(
        Math.abs(point[1] - midRoadCenterY) > midRoadHalfWidth + (wall.collision.widthPx * 0.5),
        `${wall.id} must remain outside the middle road`
      );
    });
  });
});

test('three reference routes remain continuous across the central sand', () => {
  assert.equal(navigation.mapId, geometry.mapId);
  assert.deepEqual(navigation.routes.map((route) => route.id), ['top', 'mid', 'bottom']);

  navigation.routes.forEach((route) => {
    assert.ok(route.crossesTerrainIds.includes('sand-central'), `${route.id} must cross central sand`);
    assert.ok(route.navigationCenterline.some((point) => point[0] <= 0.462352));
    assert.ok(route.navigationCenterline.some((point) => point[0] >= 0.536403));
    route.visualCenterline.forEach((point) => assertNormalizedPoint(point, `${route.id}.visual`));
    route.navigationCenterline.forEach((point) => assertNormalizedPoint(point, `${route.id}.navigation`));
    const connectors = Array.isArray(route.visualConnectors) ? route.visualConnectors : [];
    assert.equal(connectors.length, 2, `${route.id} connector count`);
    connectors.forEach((connector) => {
      assert.ok(String(connector.id || '').trim(), `${route.id} connector ID`);
      assert.ok(connector.centerline.length >= 2, `${connector.id} needs a highland road segment`);
      connector.centerline.forEach((point) => assertNormalizedPoint(point, `${connector.id}.centerline`));
      const connectorX = connector.centerline[0][0];
      connector.centerline.forEach((point) => {
        assert.equal(point[0], connectorX, `${connector.id} must remain vertically aligned`);
      });
      if (route.id !== 'mid') {
        assert.equal(connector.centerline.length, 2, `${connector.id} needs a highland road segment`);
        const roadJoin = connector.centerline[connector.centerline.length - 1];
        assert.ok(
          Math.abs(roadJoin[1] - route.visualCenterline[0][1]) < 0.000001,
          `${connector.id} must join the ${route.id} road`
        );
      }
    });
  });

  const topRoute = navigation.routes[0];
  const midRoute = navigation.routes[1];
  const bottomRoute = navigation.routes[2];
  assert.ok(topRoute.visualCenterline[0][1] < midRoute.visualCenterline[0][1]);
  assert.ok(midRoute.visualCenterline[0][1] < bottomRoute.visualCenterline[0][1]);
  ['attacker', 'defender'].forEach((team) => {
    const spine = midRoute.visualConnectors.find((connector) => connector.id === `${team}-highland-spine`);
    assert.ok(spine, `${team} highland spine is missing`);
    assert.equal(spine.centerline.length, 3);
    assert.deepEqual(
      spine.centerline[1],
      team === 'attacker' ? midRoute.visualCenterline[0] : midRoute.visualCenterline.at(-1)
    );
  });
  assert.equal(navigation.navigationRules.outsideBattlefieldWalkable, false);
  assert.equal(navigation.navigationRules.pathClearance, 1.2);
  assert.equal(navigation.navigationRules.agentRadius, 2.25);
  assert.deepEqual(navigation.navigationRules.narrowPassage, {
    cellSize: 8,
    probeDistance: 48,
    probeStep: 2,
    entryDistance: 38,
    releaseSeconds: 3.2
  });
  assert.equal(navigation.navigationRules.aiTargetUnreachableFailureLimit, 3);
  assert.equal(navigation.navigationRules.aiTargetUnreachableCooldownSeconds, 2);
  assert.deepEqual(navigation.navigationRules.aiTargetScoring, {
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
});

test('all reference tower and camp anchors remain normalized and image-derived', () => {
  assert.equal(objectives.mapId, geometry.mapId);
  assert.deepEqual(objectives.towerRuntime, {
    maxHp: 2200,
    attackRange: 329,
    attackIntervalSec: 0.8,
    attackDamage: 20,
    priority: 'nearest',
    threatDecayPerSecond: 0.2
  });
  assert.equal(objectives.objectives.length, 14);
  assertUniqueIds(objectives.objectives, 'objectiveId', 'objective');
  assert.equal(objectives.objectives.filter((objective) => objective.team === 'attacker').length, 7);
  assert.equal(objectives.objectives.filter((objective) => objective.team === 'defender').length, 7);
  assert.deepEqual(
    ['top', 'mid', 'bottom'].map((laneId) => (
      objectives.objectives.filter((objective) => objective.laneId === laneId).length
    )),
    [4, 6, 4]
  );
  objectives.objectives.forEach((objective) => {
    assertNormalizedPoint(objective.position, objective.objectiveId);
    const expected = toNormalized(objective.sourceCenter);
    assert.ok(Math.abs(objective.position[0] - expected[0]) < 0.000001, `${objective.objectiveId} x drifted`);
    assert.ok(Math.abs(objective.position[1] - expected[1]) < 0.000001, `${objective.objectiveId} y drifted`);
  });

  assert.equal(neutralCamps.mapId, geometry.mapId);
  assert.equal(neutralCamps.camps.length, 18);
  assert.equal(neutralCamps.runtimeDefaults.respawnSec, 30);
  assert.equal(neutralCamps.anchorShape, 'neutral-banner');
  assert.equal(neutralCamps.profiles.center.composition.length, 3);
  assert.deepEqual(
    neutralCamps.profiles.center.composition.map((entry) => entry.unitCategory),
    ['melee', 'ranged', 'support']
  );
  assertUniqueIds(neutralCamps.camps, 'campId', 'neutral camp');
  neutralCamps.camps.forEach((camp) => {
    assertNormalizedPoint(camp.position, camp.campId);
    const expected = toNormalized(camp.sourceCenter);
    assert.ok(Math.abs(camp.position[0] - expected[0]) < 0.000001, `${camp.campId} x drifted`);
    assert.ok(Math.abs(camp.position[1] - expected[1]) < 0.000001, `${camp.campId} y drifted`);
  });
  assert.equal(neutralCamps.camps.filter((camp) => camp.group === 'center').length, 2);
  neutralCamps.camps.filter((camp) => camp.group === 'center').forEach((camp) => {
    assert.equal(camp.patrolMode, 'shuttle');
    assert.equal(camp.showPatrolPreview, true);
    assert.ok(Number(camp.patrolSpanNormalized) > 0);
  });
  const campsById = new Map(neutralCamps.camps.map((camp) => [camp.campId, camp]));
  neutralCamps.camps.forEach((camp) => {
    const mirror = campsById.get(camp.mirrorOf);
    assert.ok(mirror, `${camp.campId} must have a mirrored camp`);
    assert.equal(mirror.mirrorOf, camp.campId, `${camp.campId} mirror must be bidirectional`);
    assert.equal(mirror.profile, camp.profile, `${camp.campId} mirror must keep its composition`);
    assert.equal(mirror.strengthTier, camp.strengthTier, `${camp.campId} mirror must keep its strength tier`);
    const rotationDelta = ((Number(mirror.formationRotationDeg) - Number(camp.formationRotationDeg)) % 360 + 360) % 360;
    assert.equal(rotationDelta, 180, `${camp.campId} mirror must rotate the formation by 180 degrees`);
  });
  ['attacker', 'defender'].forEach((side) => {
    const profiles = neutralCamps.camps
      .filter((camp) => camp.campId.includes(side))
      .map((camp) => camp.profile);
    assert.equal(new Set(profiles).size, profiles.length, `${side} camps must use distinct same-side compositions`);
  });
  const countCampUnits = (camp) => (neutralCamps.profiles[camp.profile]?.composition || [])
    .reduce((total, entry) => total + Number(entry?.count || 0), 0);
  const campsByStrengthTier = new Map(['near-highland', 'remote', 'central-sand'].map((tier) => [
    tier,
    neutralCamps.camps.filter((camp) => camp.strengthTier === tier)
  ]));
  assert.equal(campsByStrengthTier.get('near-highland').length, 8);
  assert.equal(campsByStrengthTier.get('remote').length, 8);
  assert.equal(campsByStrengthTier.get('central-sand').length, 2);
  campsByStrengthTier.get('near-highland').forEach((camp) => {
    const count = countCampUnits(camp);
    assert.ok(count >= 40 && count < 100, `${camp.campId} should have dozens of guards`);
  });
  campsByStrengthTier.get('remote').forEach((camp) => {
    assert.ok(countCampUnits(camp) >= 200, `${camp.campId} should have hundreds of guards`);
  });
  campsByStrengthTier.get('central-sand').forEach((camp) => {
    assert.ok(countCampUnits(camp) >= 400, `${camp.campId} should have hundreds of central guards`);
  });
});

test('highland defense data keeps mirrored barracks, respawn points, and smaller outer towers', () => {
  assert.equal(highlandDefense.mapId, geometry.mapId);
  assert.equal(highlandDefense.highlands.length, 4);
  assert.deepEqual(
    [highlandDefense.barracksRuntime.width, highlandDefense.barracksRuntime.depth, highlandDefense.barracksRuntime.height],
    [84, 52, 18]
  );
  assert.ok(highlandDefense.barracksRuntime.weapons.some((weapon) => weapon.id === 'arrow-tower'));
  assert.ok(highlandDefense.barracksRuntime.weapons.some((weapon) => weapon.id === 'catapult'));
  assert.ok(highlandDefense.barracksRuntime.weapons.every((weapon) => weapon.attackRange > 0 && weapon.attackDamage > 0));
  assert.ok(highlandDefense.outerTowerRuntime.width < 58);
  assert.equal(highlandDefense.outerTowerRuntime.attackRange, 455);
  assert.ok(highlandDefense.outerTowerRuntime.attackDamage > objectives.towerRuntime.attackDamage);
  assert.ok(highlandDefense.respawnRuntime.radiusNormalized > 0);

  const highlandById = new Map(highlandDefense.highlands.map((highland) => [highland.id, highland]));
  highlandDefense.highlands.forEach((highland) => {
    const mirror = highlandById.get(highland.mirrorOf);
    assert.ok(mirror, `${highland.id} must have a mirrored highland`);
    assert.equal(mirror.mirrorOf, highland.id, `${highland.id} mirror must be bidirectional`);
    assert.equal(mirror.team === 'defender' ? 'attacker' : 'defender', highland.team);
    assertNormalizedPoint(highland.barracks.position, `${highland.id}.barracks`);
    assertNormalizedPoint(highland.respawn.position, `${highland.id}.respawn`);
    assert.equal(highland.outerTowers.length, 6);
    assert.equal(new Set(highland.outerTowers.map((tower) => tower.id)).size, 6);
    highland.outerTowers.forEach((tower) => assertNormalizedPoint(tower.position, `${highland.id}.${tower.id}`));
  });
});
