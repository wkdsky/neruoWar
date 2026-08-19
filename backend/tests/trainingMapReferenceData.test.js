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
  assert.equal(geometry.mapVersion, 8);
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
  assert.equal(geometry.coordinateSystems.runtimeWorld.width, 7200);
  assert.equal(geometry.coordinateSystems.runtimeWorld.height, 5008);
  assert.equal(geometry.coordinateSystems.runtimeWorld.scaleMultiplier, 2.6666666666);
  assert.equal(geometry.coordinateSystems.runtimeWorld.elevationAxis, 'z up');
  assert.equal(geometry.movementCalibration.targetTravelSeconds, 8);
  assert.equal(geometry.movementCalibration.referenceSpawnSlotId, 'deploy-spawn-attacker-top-1');
  assert.deepEqual(geometry.movementCalibration.referenceSpawnSlotIds, [
    'deploy-spawn-attacker-top-1',
    'deploy-spawn-attacker-bottom-3'
  ]);
  assert.equal(geometry.movementCalibration.referenceObjectiveId, 'tower-attacker-mid-outer');
  assert.equal(geometry.spawnRegions.length, 4);
  assert.equal(geometry.walls.high.length, 4);
  assert.equal(geometry.walls.ordinary.length, 24);

  geometry.spawnRegions.forEach((region) => {
    assert.equal(region.normalizedPolygon.length, 3, `${region.id} must remain triangular`);
    region.normalizedPolygon.forEach((point) => assertNormalizedPoint(point, region.id));
    assert.equal(region.renderElevation, 34, `${region.id} must keep its render elevation`);
    assert.equal(region.renderFootprintScale, 1.16, `${region.id} must retain its enlarged footprint`);
    assert.equal(region.rampInset, 0.22, `${region.id} must retain its corner ramp inset`);
    assert.deepEqual(region.railingEdges, [0, 1], `${region.id} must rail both diagonal edges`);
  });
  geometry.walls.high.forEach((wall) => {
    assert.ok(wall.visualPath.length >= 3, `${wall.id} must retain its zig-zag trace`);
    wall.visualPath.forEach((point) => assertNormalizedPoint(point, wall.id));
    assert.equal(wall.collision.kind, 'polyline-buffer');
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
  assert.equal(thickWalls.length, 4);
  thickWalls.forEach((wall) => {
    assert.equal(wall.wallType, 'thickWall', `${wall.id} must be modeled as a thick wall`);
    assert.ok(Array.isArray(wall.sourceOutline) && wall.sourceOutline.length >= 20, `${wall.id} lost its filled outline`);
    assert.equal(wall.collision.blocksVision, true, `${wall.id} must block vision`);
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
  });

  const topRoute = navigation.routes[0];
  const midRoute = navigation.routes[1];
  const bottomRoute = navigation.routes[2];
  assert.ok(topRoute.visualCenterline[0][1] < midRoute.visualCenterline[0][1]);
  assert.ok(midRoute.visualCenterline[0][1] < bottomRoute.visualCenterline[0][1]);
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
    attackRange: 188,
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
    const rotationDelta = ((Number(mirror.formationRotationDeg) - Number(camp.formationRotationDeg)) % 360 + 360) % 360;
    assert.equal(rotationDelta, 180, `${camp.campId} mirror must rotate the formation by 180 degrees`);
  });
  ['attacker', 'defender'].forEach((side) => {
    const profiles = neutralCamps.camps
      .filter((camp) => camp.campId.includes(side))
      .map((camp) => camp.profile);
    assert.equal(new Set(profiles).size, profiles.length, `${side} camps must use distinct same-side compositions`);
  });
});
