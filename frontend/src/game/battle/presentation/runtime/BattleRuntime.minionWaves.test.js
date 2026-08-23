import BattleRuntime from './BattleRuntime';

const buildMinionInit = () => {
  const objects = [
    { objectId: 'barracks-attacker-top', itemId: 'training_map_barracks', x: -500, y: 200, width: 80, depth: 80, height: 40, category: 'barracks', team: 'attacker', highlandId: 'attacker-top', mapStatic: true },
    { objectId: 'barracks-attacker-bottom', itemId: 'training_map_barracks', x: -500, y: -200, width: 80, depth: 80, height: 40, category: 'barracks', team: 'attacker', highlandId: 'attacker-bottom', mapStatic: true },
    { objectId: 'barracks-defender-top', itemId: 'training_map_barracks', x: 500, y: 200, width: 80, depth: 80, height: 40, category: 'barracks', team: 'defender', highlandId: 'defender-top', mapStatic: true },
    { objectId: 'barracks-defender-bottom', itemId: 'training_map_barracks', x: 500, y: -200, width: 80, depth: 80, height: 40, category: 'barracks', team: 'defender', highlandId: 'defender-bottom', mapStatic: true }
  ];
  const lane = (id, y) => ({
    id,
    label: id,
    centerY: y,
    width: 120,
    centerline: [{ x: -500, y }, { x: 0, y }, { x: 500, y }],
    visualConnectors: id === 'top'
      ? [
        { id: 'attacker-top-highland', centerline: [{ x: -500, y }, { x: -500, y: y + 120 }] },
        { id: 'defender-top-highland', centerline: [{ x: 500, y }, { x: 500, y: y + 120 }] }
      ]
      : (id === 'bottom'
        ? [
          { id: 'attacker-bottom-highland', centerline: [{ x: -500, y }, { x: -500, y: y - 120 }] },
          { id: 'defender-bottom-highland', centerline: [{ x: 500, y }, { x: 500, y: y - 120 }] }
        ]
        : [
          { id: 'attacker-highland-spine', centerline: [{ x: -500, y: 200 }, { x: -500, y: 0 }, { x: -500, y: -200 }] },
          { id: 'defender-highland-spine', centerline: [{ x: 500, y: 200 }, { x: 500, y: 0 }, { x: 500, y: -200 }] }
        ])
  });
  return {
    mode: 'training',
    rules: { allowCrossMidline: true },
    battlefield: {
      layoutMeta: { fieldWidth: 1200, fieldHeight: 800 },
      map: {
        mapId: 'training-war-map-v1',
        mapVersion: 1,
        activePresetId: 'full-jungle',
        defaultPresetId: 'full-jungle',
        presets: [{ id: 'full-jungle', label: '三路', enabledTags: [] }],
        terrainRegions: [{ id: 'grass', type: 'grass', shape: 'rect', x: 0, y: 0, width: 1200, height: 800 }],
        lanes: [lane('top', 200), lane('mid', 0), lane('bottom', -200)],
        navigation: { outsideBattlefieldWalkable: false, agentRadius: 2.25 },
        objects,
        objectives: []
      },
      objects
    },
    unitTypes: [{ unitTypeId: 'infantry_basic', name: '步兵', classTag: 'infantry', hp: 10, atk: 2, def: 1, speed: 1, range: 1 }],
    attacker: { rosterUnits: [{ unitTypeId: 'infantry_basic', count: 20 }], deployUnits: [] },
    defender: { rosterUnits: [{ unitTypeId: 'infantry_basic', count: 20 }], deployUnits: [] }
  };
};

test('releases symmetric three-lane minion waves after the non-blocking countdown', () => {
  const runtime = new BattleRuntime(buildMinionInit());
  runtime.createDeployGroup('attacker', { units: { infantry_basic: 10 }, x: -420, y: 0, placed: true });
  expect(runtime.startBattle()).toMatchObject({ ok: true });
  expect(runtime.getBattleStatus()).toMatchObject({ minionCountdownSec: 5, minionWavesReleased: false });

  for (let index = 0; index < 99; index += 1) runtime.step(0.05);
  expect(runtime.sim.squads.filter((squad) => squad.isMinionWaveUnit)).toHaveLength(0);

  runtime.step(0.1);
  const minions = runtime.sim.squads.filter((squad) => squad.isMinionWaveUnit);
  expect(minions).toHaveLength(8);
  expect(new Set(minions.map((squad) => squad.minionLaneId))).toEqual(new Set(['top', 'mid', 'bottom']));
  expect(minions.filter((squad) => squad.minionLaneId === 'mid')).toHaveLength(4);
  expect(new Set(minions.map((squad) => (
    `${squad.minionLaneId}:${squad.minionBarracksLane}:${squad.minionExitId}`
  )))).toEqual(new Set([
    'top:top:upper',
    'mid:top:lower',
    'mid:bottom:upper',
    'bottom:bottom:lower'
  ]));
  expect(minions.filter((squad) => squad.minionLaneId === 'mid').map((squad) => squad.minionExitId).sort()).toEqual(['lower', 'lower', 'upper', 'upper']);
  expect(minions.every((squad) => squad.minionPath.length >= 3)).toBe(true);
  expect(minions.every((squad) => runtime.crowd.agentsBySquad.get(squad.id)?.length === 9)).toBe(true);
  expect(runtime.getCardRows().some((row) => row.isMinionWaveUnit)).toBe(false);
  expect(runtime.getBattleStatus()).toMatchObject({ minionCountdownSec: 0, minionWavesReleased: true });
});

test('keeps each minion squad on its monotonic path while both sides form a midline engagement', () => {
  const runtime = new BattleRuntime(buildMinionInit());
  runtime.createDeployGroup('attacker', { units: { infantry_basic: 10 }, x: -420, y: 0, placed: true });
  expect(runtime.startBattle()).toMatchObject({ ok: true });
  for (let index = 0; index < 102; index += 1) runtime.step(0.05);
  const previousPathIndex = new Map();
  for (let index = 0; index < 260; index += 1) {
    runtime.step(0.05);
    runtime.sim.squads
      .filter((squad) => squad.isMinionWaveUnit)
      .forEach((squad) => {
        const previous = previousPathIndex.get(squad.id);
        if (previous !== undefined) expect(squad.minionPathIndex).toBeGreaterThanOrEqual(previous);
        previousPathIndex.set(squad.id, squad.minionPathIndex);
        expect(Number.isFinite(squad.x)).toBe(true);
        expect(Number.isFinite(squad.y)).toBe(true);
      });
  }
  const laneIds = new Set(runtime.sim.squads.filter((squad) => squad.isMinionWaveUnit).map((squad) => squad.minionLaneId));
  expect(laneIds).toEqual(new Set(['top', 'mid', 'bottom']));
});

test('spawns outside each barracks and advances fixed lane points without navigation replans', () => {
  const runtime = new BattleRuntime(buildMinionInit());
  runtime.createDeployGroup('attacker', { units: { infantry_basic: 10 }, x: -420, y: 0, placed: true });
  expect(runtime.startBattle()).toMatchObject({ ok: true });
  for (let index = 0; index < 102; index += 1) runtime.step(0.05);

  const attackerTop = runtime.sim.squads.find((squad) => (
    squad.isMinionWaveUnit && squad.team === 'attacker' && squad.minionLaneId === 'top'
  ));
  const defenderTop = runtime.sim.squads.find((squad) => (
    squad.isMinionWaveUnit && squad.team === 'defender' && squad.minionLaneId === 'top'
  ));
  expect(attackerTop.x).toBeGreaterThan(-500);
  expect(defenderTop.x).toBeLessThan(500);
  expect(attackerTop.minionPath[0].x).toBeGreaterThan(-500);
  expect(defenderTop.minionPath[0].x).toBeLessThan(500);

  const before = { attackerX: attackerTop.x, attackerY: attackerTop.y };
  for (let index = 0; index < 20; index += 1) runtime.step(0.05);
  expect(Math.hypot(attackerTop.x - before.attackerX, attackerTop.y - before.attackerY)).toBeGreaterThan(1);
  expect(Number(attackerTop._navigationWaitUntil) || 0).toBe(0);
  expect(Number(attackerTop._navigationReplanAt) || 0).toBe(0);
});

test('uses the reference highland ramps as fixed minion exits', () => {
  const { buildReferenceTrainingMapConfig } = require('../../../../../../backend/services/trainingMapDefinitionService');
  const map = buildReferenceTrainingMapConfig();
  const init = buildMinionInit();
  init.battlefield = {
    layoutMeta: map.layoutMeta,
    map,
    objects: map.objects
  };
  const runtime = new BattleRuntime(init);
  runtime.createDeployGroup('attacker', { units: { infantry_basic: 10 }, x: -420, y: 0, placed: true });
  expect(runtime.startBattle()).toMatchObject({ ok: true });
  for (let index = 0; index < 102; index += 1) runtime.step(0.05);

  const minions = runtime.sim.squads.filter((squad) => squad.isMinionWaveUnit);
  const findMinion = (team, laneId, barracksLane) => minions.find((squad) => (
    squad.team === team && squad.minionLaneId === laneId && squad.minionBarracksLane === barracksLane
  ));
  const attackerTop = findMinion('attacker', 'top', 'top');
  const attackerMidTop = findMinion('attacker', 'mid', 'top');
  const attackerMidBottom = findMinion('attacker', 'mid', 'bottom');
  const attackerBottom = findMinion('attacker', 'bottom', 'bottom');
  const getRamp = (spawnRegionId, rampId) => map.terrainRegions
    .find((region) => region.sourceRegionId === spawnRegionId)
    .ramps.find((ramp) => ramp.id === rampId);
  const attackerTopRamp = getRamp('spawn-attacker-top', 'upper-outward-road-ramp');
  const attackerMidTopRamp = getRamp('spawn-attacker-top', 'lower-outward-road-ramp');
  const attackerMidBottomRamp = getRamp('spawn-attacker-bottom', 'upper-outward-road-ramp');
  const attackerBottomRamp = getRamp('spawn-attacker-bottom', 'lower-outward-road-ramp');

  expect(attackerTop.minionPath[1].y).toBeGreaterThan(attackerTop.minionPath[0].y);
  expect(attackerMidTop.minionPath[1].y).toBeLessThan(attackerMidTop.minionPath[0].y);
  expect(attackerMidBottom.minionPath[1].y).toBeGreaterThan(attackerMidBottom.minionPath[0].y);
  expect(attackerBottom.minionPath[1].y).toBeLessThan(attackerBottom.minionPath[0].y);
  expect(attackerTop.minionPath[1].x).toBeCloseTo(attackerTopRamp.points[3].x, 4);
  expect(attackerTop.minionPath[1].y).toBeCloseTo(attackerTopRamp.points[3].y, 4);
  expect(attackerMidTop.minionPath[1].x).toBeCloseTo(attackerMidTopRamp.points[3].x, 4);
  expect(attackerMidTop.minionPath[1].y).toBeCloseTo(attackerMidTopRamp.points[3].y, 4);
  expect(attackerMidBottom.minionPath[1].x).toBeCloseTo(attackerMidBottomRamp.points[3].x, 4);
  expect(attackerMidBottom.minionPath[1].y).toBeCloseTo(attackerMidBottomRamp.points[3].y, 4);
  expect(attackerBottom.minionPath[1].x).toBeCloseTo(attackerBottomRamp.points[3].x, 4);
  expect(attackerBottom.minionPath[1].y).toBeCloseTo(attackerBottomRamp.points[3].y, 4);
  expect(Math.abs(attackerTop.minionPath[1].x - attackerTopRamp.points[0].x)).toBeGreaterThan(200);
  expect(Math.abs(attackerBottom.minionPath[1].x - attackerBottomRamp.points[0].x)).toBeGreaterThan(200);

  const before = { x: attackerTop.x, y: attackerTop.y };
  for (let index = 0; index < 30; index += 1) runtime.step(0.05);
  expect(Math.hypot(attackerTop.x - before.x, attackerTop.y - before.y)).toBeGreaterThan(1);
  expect(attackerTop.action).not.toBe('路径等待');
});

test('keeps every lane on the road until the matching enemy barracks', () => {
  const { buildReferenceTrainingMapConfig } = require('../../../../../../backend/services/trainingMapDefinitionService');
  const map = buildReferenceTrainingMapConfig();
  const init = buildMinionInit();
  init.battlefield = {
    layoutMeta: map.layoutMeta,
    map,
    objects: map.objects
  };
  const runtime = new BattleRuntime(init);
  runtime.createDeployGroup('attacker', { units: { infantry_basic: 10 }, x: -420, y: 0, placed: true });
  expect(runtime.startBattle()).toMatchObject({ ok: true });
  for (let index = 0; index < 102; index += 1) runtime.step(0.05);

  const top = runtime.sim.squads.find((squad) => (
    squad.isMinionWaveUnit && squad.team === 'attacker' && squad.minionLaneId === 'top'
  ));
  const bottom = runtime.sim.squads.find((squad) => (
    squad.isMinionWaveUnit && squad.team === 'attacker' && squad.minionLaneId === 'bottom'
  ));
  const midTop = runtime.sim.squads.find((squad) => (
    squad.isMinionWaveUnit
      && squad.team === 'attacker'
      && squad.minionLaneId === 'mid'
      && squad.minionBarracksLane === 'top'
  ));
  const midBottom = runtime.sim.squads.find((squad) => (
    squad.isMinionWaveUnit
      && squad.team === 'attacker'
      && squad.minionLaneId === 'mid'
      && squad.minionBarracksLane === 'bottom'
  ));
  const defenderTop = runtime.sim.squads.find((squad) => (
    squad.isMinionWaveUnit && squad.team === 'defender' && squad.minionLaneId === 'top'
  ));
  const defenderBottom = runtime.sim.squads.find((squad) => (
    squad.isMinionWaveUnit && squad.team === 'defender' && squad.minionLaneId === 'bottom'
  ));
  const barracks = (team, lane) => runtime.sim.buildings.find((building) => (
    building.category === 'barracks'
    && building.team === team
    && building.highlandId === `${team}-${lane}`
  ));
  const topBarracks = barracks('defender', 'top');
  const bottomBarracks = barracks('defender', 'bottom');
  const attackerTopBarracks = barracks('attacker', 'top');
  const attackerBottomBarracks = barracks('attacker', 'bottom');

  expect(top.minionPath.at(-1)).toMatchObject({ x: topBarracks.x, y: topBarracks.y });
  expect(bottom.minionPath.at(-1)).toMatchObject({ x: bottomBarracks.x, y: bottomBarracks.y });
  expect(midTop.minionPath.at(-1)).toMatchObject({ x: topBarracks.x, y: topBarracks.y });
  expect(midBottom.minionPath.at(-1)).toMatchObject({ x: bottomBarracks.x, y: bottomBarracks.y });
  expect(defenderTop.minionPath.at(-1)).toMatchObject({ x: attackerTopBarracks.x, y: attackerTopBarracks.y });
  expect(defenderBottom.minionPath.at(-1)).toMatchObject({ x: attackerBottomBarracks.x, y: attackerBottomBarracks.y });
  expect(top.minionPath.some((point) => point.y > top.minionPath[0].y + 500)).toBe(true);
  expect(bottom.minionPath.some((point) => point.y < bottom.minionPath[0].y - 500)).toBe(true);

  expect(top.waypoints[0]).toMatchObject(top.minionPath[1]);
  expect(top.waypoints).not.toHaveLength(1);
  expect(bottom.waypoints[0]).toMatchObject(bottom.minionPath[1]);
  expect(bottom.waypoints).not.toHaveLength(1);
});

test('minion waves deal real damage after meeting on the same lane', () => {
  const runtime = new BattleRuntime(buildMinionInit());
  runtime.createDeployGroup('attacker', { units: { infantry_basic: 10 }, x: -420, y: 0, placed: true });
  expect(runtime.startBattle()).toMatchObject({ ok: true });
  for (let index = 0; index < 102; index += 1) runtime.step(0.05);

  const attackerTop = runtime.sim.squads.find((squad) => (
    squad.isMinionWaveUnit && squad.team === 'attacker' && squad.minionLaneId === 'top'
  ));
  const defenderTop = runtime.sim.squads.find((squad) => (
    squad.isMinionWaveUnit && squad.team === 'defender' && squad.minionLaneId === 'top'
  ));
  const startingHealth = attackerTop.health + defenderTop.health;

  for (let index = 0; index < 500 && attackerTop.health + defenderTop.health >= startingHealth; index += 1) {
    runtime.step(0.05);
  }

  expect(attackerTop.health + defenderTop.health).toBeLessThan(startingHealth);
  expect(
    attackerTop.remain < attackerTop.startCount || defenderTop.remain < defenderTop.startCount
  ).toBe(true);
});
