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

test('reference training map projects all image-derived static elements into the runtime contract', () => {
  const map = getTrainingMapConfig();
  const validation = validateTrainingMapConfig(map);

  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(map.mapId, TRAINING_MAP_ID);
  assert.equal(map.mapVersion, TRAINING_MAP_VERSION);
  assert.equal(map.layoutMeta.coordinateSystem, 'x-right-y-up-z-up');
  assert.deepEqual(
    [map.layoutMeta.fieldWidth, map.layoutMeta.fieldHeight],
    [7200, 5008]
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
    assert.equal(region.elevation, 68);
    assert.equal(region.ramps.length, 3);
    assert.deepEqual(region.railingEdges, [0, 1]);
    assert.equal(region.connectedRouteIds.length, 2);
  });
  assert.deepEqual(
    map.terrainRegions.filter((region) => region.type === 'road').map((region) => region.height),
    [140.224, 160.256, 140.224]
  );
  assert.equal(map.objects.filter((object) => object.category === 'wall').length, 36);
  assert.equal(map.objects.filter((object) => object.category === 'tower').length, 14);
  assert.equal(map.objects.filter((object) => object.category === 'neutralCamp').length, 18);
  const ordinaryWalls = map.objects.filter((object) => object.geometryKind === 'ordinaryWall');
  assert.equal(ordinaryWalls.length, 24);
  ordinaryWalls.forEach((wall) => {
    assert.ok(Array.isArray(wall.visualPath) && wall.visualPath.length >= 6, `${wall.objectId} lost its visual trace`);
    assert.equal(wall.collider?.kind, 'compositeObb');
    assert.ok(wall.collider.parts.length >= wall.visualPath.length - 1, `${wall.objectId} lost collision segments`);
  });
  const thickWalls = ordinaryWalls.filter((wall) => wall.wallType === 'thickWall');
  assert.equal(thickWalls.length, 4);
  thickWalls.forEach((wall) => {
    assert.equal(wall.itemId, 'training_map_thick_wall');
    assert.ok(Array.isArray(wall.visualOutline) && wall.visualOutline.length >= 20);
    assert.equal(wall.blocksVision, true);
  });
  const highlandRails = map.objects.filter((wall) => wall.geometryKind === 'highlandRail');
  assert.equal(highlandRails.length, 8);
  highlandRails.forEach((rail) => {
    assert.equal(rail.blocksMovement, true);
    assert.equal(rail.blocksVision, false);
    assert.equal(rail.visualPath.length, 2);
    assert.equal(rail.collider.parts.length, 1);
  });
  map.deploySlots.forEach((slot) => {
    const rails = highlandRails.filter((rail) => rail.highlandRegionId === `terrain-highland-${slot.spawnRegionId}`);
    const nearestClearance = Math.min(...rails.map((rail) => (
      distanceToSegment(slot, rail.visualPath[0], rail.visualPath[1]) - (rail.depth * 0.5)
    )));
    assert.ok(
      nearestClearance > map.navigation.agentRadius + map.navigation.pathClearance,
      `${slot.id} must start clear of its highland railing`
    );
  });
  assert.equal(map.objectives.filter((objective) => objective.type === 'tower').length, 14);
  assert.equal(map.objectives.filter((objective) => objective.type === 'neutralCamp').length, 18);
  map.objectives.filter((objective) => objective.type === 'neutralCamp').forEach((camp) => {
    assert.equal(camp.targetable, false);
    assert.equal(camp.attackEnabled, false);
    assert.ok(camp.neutralCamp.composition.length >= 1);
    assert.ok(['melee', 'ranged', 'support'].includes(camp.neutralCamp.composition[0].unitCategory));
    assert.equal(camp.neutralCamp.spawnPoints.length, 3);
    assert.ok(camp.neutralCamp.patrolPoints.length >= 2);
    assert.ok(camp.neutralCamp.leashRadius > camp.neutralCamp.senseRadius);
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
  const centralSandCamps = map.objectives.filter((objective) => (
    objective.type === 'neutralCamp'
    && objective.neutralCamp.profileId === 'center'
  ));
  assert.equal(centralSandCamps.length, 2);
  centralSandCamps.forEach((camp) => {
    assert.equal(camp.neutralCamp.patrolStartImmediately, true);
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
  map.objectives.filter((objective) => objective.type === 'tower').forEach((tower) => {
    assert.equal(tower.maxHp, 2200);
    assert.equal(tower.attackRange, 188);
    assert.equal(tower.attackIntervalSec, 0.8);
    assert.equal(tower.attackDamage, 20);
    assert.equal(tower.priority, 'nearest');
    assert.equal(tower.threatDecayPerSecond, 0.2);
  });
  assert.ok(map.objects.find((object) => object.objectId === 'map-objective_tower_tower-attacker-top-outer').y > 0);
  assert.ok(map.objects.find((object) => object.objectId === 'map-objective_tower_tower-attacker-bottom-outer').y < 0);
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
