import BattleRuntime from './BattleRuntime';
import { isInsideCollider } from '../../simulation/crowd/crowdPhysics';

const resolveRampPassage = (ramp = {}, barracks = {}) => {
  const points = Array.isArray(ramp?.points) ? ramp.points : [];
  const edges = points.map((start, index) => {
    const end = points[(index + 1) % points.length];
    const midpoint = {
      x: ((Number(start?.x) || 0) + (Number(end?.x) || 0)) * 0.5,
      y: ((Number(start?.y) || 0) + (Number(end?.y) || 0)) * 0.5
    };
    return {
      midpoint,
      distance: Math.hypot(
        midpoint.x - (Number(barracks?.x) || 0),
        midpoint.y - (Number(barracks?.y) || 0)
      )
    };
  }).sort((left, right) => left.distance - right.distance);
  const center = points.reduce((value, point) => ({
    x: value.x + ((Number(point?.x) || 0) / Math.max(1, points.length)),
    y: value.y + ((Number(point?.y) || 0) / Math.max(1, points.length))
  }), { x: 0, y: 0 });
  return [edges[0]?.midpoint, center, edges[edges.length - 1]?.midpoint].filter(Boolean);
};

const readSquadHighlight = (snapshot = {}, squadId = '', offset = 12) => {
  const values = [];
  for (let index = 0; index < (Number(snapshot?.units?.count) || 0); index += 1) {
    if (snapshot.unitSquadIds[index] !== squadId) continue;
    values.push(snapshot.units.data[(index * 20) + offset]);
  }
  return values;
};

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

test('allows minion soldiers and their health marker to select and highlight the whole squad', () => {
  const runtime = new BattleRuntime(buildMinionInit());
  runtime.createDeployGroup('attacker', { units: { infantry_basic: 10 }, x: -420, y: 0, placed: true });
  expect(runtime.startBattle()).toMatchObject({ ok: true });
  for (let index = 0; index < 102; index += 1) runtime.step(0.05);

  const minions = runtime.sim.squads.find((squad) => (
    squad.isMinionWaveUnit && squad.team === 'attacker' && squad.minionLaneId === 'top'
  ));
  const [agent] = runtime.crowd.agentsBySquad.get(minions.id);

  expect(runtime.canControlSquad(minions)).toBe(false);
  expect(runtime.pickSquadAtAgentPoint(agent.x, agent.y, { team: 'any' })).toBe(minions.id);
  expect(runtime.setHoveredBattleSquad(minions.id)).toBe(true);
  const hoveredValues = readSquadHighlight(runtime.getRenderSnapshot(), minions.id, 15);
  expect(hoveredValues.length).toBeGreaterThan(0);
  expect(hoveredValues.every((value) => value === 1)).toBe(true);

  expect(runtime.setSelectedBattleSquad(minions.id)).toBe(true);
  runtime.setHoveredBattleSquad('');
  runtime.step(0.05);

  expect(runtime.selectedBattleSquadId).toBe(minions.id);
  const selectedValues = readSquadHighlight(runtime.getRenderSnapshot(), minions.id, 12);
  expect(selectedValues.length).toBeGreaterThan(0);
  expect(selectedValues.every((value) => value === 1)).toBe(true);
  expect(runtime.commandMove(minions.id, { x: 0, y: 0 })).toBe(false);
});

test('uses centered reference highland ramp corridors instead of railing endpoints', () => {
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
  const attackerTopBarracks = map.objects.find((object) => object.objectId === 'map-highland-barracks-attacker-top');
  const attackerBottomBarracks = map.objects.find((object) => object.objectId === 'map-highland-barracks-attacker-bottom');
  const expectPassage = (squad, ramp, barracks) => {
    const passage = resolveRampPassage(ramp, barracks);
    passage.forEach((point, index) => {
      expect(squad.minionPath[index + 1].x).toBeCloseTo(point.x, 4);
      expect(squad.minionPath[index + 1].y).toBeCloseTo(point.y, 4);
    });
    passage.forEach((point) => {
      const nearestVertex = ramp.points.reduce((distance, vertex) => Math.min(
        distance,
        Math.hypot(point.x - vertex.x, point.y - vertex.y)
      ), Infinity);
      expect(nearestVertex).toBeGreaterThan(100);
    });
  };

  expect(attackerTop.minionPath[1].y).toBeGreaterThan(attackerTop.minionPath[0].y);
  expect(attackerMidTop.minionPath[1].y).toBeLessThan(attackerMidTop.minionPath[0].y);
  expect(attackerMidBottom.minionPath[1].y).toBeGreaterThan(attackerMidBottom.minionPath[0].y);
  expect(attackerBottom.minionPath[1].y).toBeLessThan(attackerBottom.minionPath[0].y);
  expectPassage(attackerTop, attackerTopRamp, attackerTopBarracks);
  expectPassage(attackerMidTop, attackerMidTopRamp, attackerTopBarracks);
  expectPassage(attackerMidBottom, attackerMidBottomRamp, attackerBottomBarracks);
  expectPassage(attackerBottom, attackerBottomRamp, attackerBottomBarracks);

  const before = { x: attackerTop.x, y: attackerTop.y };
  for (let index = 0; index < 30; index += 1) runtime.step(0.05);
  expect(Math.hypot(attackerTop.x - before.x, attackerTop.y - before.y)).toBeGreaterThan(1);
  expect(attackerTop.action).not.toBe('路径等待');
});

test('crosses the real attacker highland ramp without deadlocking on its railings', () => {
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
  const spawned = runtime.spawnTrainingMinionWave(0);
  const attackerTop = spawned.find((squad) => (
    squad.team === 'attacker' && squad.minionLaneId === 'top'
  ));
  const attackerTopAgents = runtime.crowd.agentsBySquad.get(attackerTop.id);
  runtime.sim.squads = [attackerTop];
  runtime.sim._squadById = new Map([[attackerTop.id, attackerTop]]);
  Array.from(runtime.crowd.agentsBySquad.keys()).forEach((squadId) => {
    if (squadId !== attackerTop.id) runtime.crowd.agentsBySquad.delete(squadId);
  });
  runtime.crowd.allAgents = attackerTopAgents;
  runtime.minionWaveState.released = true;
  runtime.minionWaveState.nextWaveAtSec = Number.POSITIVE_INFINITY;
  const railings = runtime.sim.buildings.filter((building) => (
    building.geometryKind === 'highlandRail'
    && building.highlandRegionId === 'terrain-highland-spawn-attacker-top'
  ));
  const outsideRampPoint = attackerTop.minionPath[3];
  let crossedRamp = false;

  for (let index = 0; index < 240; index += 1) {
    runtime.step(0.05);
    railings.forEach((railing) => {
      expect(isInsideCollider(attackerTop, railing, 2.25)).toBe(false);
      (runtime.crowd.agentsBySquad.get(attackerTop.id) || []).forEach((agent) => {
        expect(isInsideCollider(agent, railing, Number(agent.radius) || 0)).toBe(false);
      });
    });
    if (
      attackerTop.minionPathIndex >= 4
      && attackerTop.y > outsideRampPoint.y + 20
    ) {
      crossedRamp = true;
      break;
    }
  }

  expect(crossedRamp).toBe(true);
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
  const topLane = runtime.trainingMap.lanes.find((lane) => lane.id === 'top');
  const topRoad = runtime.trainingMap.terrainRegions.find((region) => (
    region.type === 'road' && region.roadRole === 'main' && region.laneId === 'top'
  ));

  expect(top.minionPath.at(-1)).toMatchObject({ x: topBarracks.x, y: topBarracks.y });
  expect(bottom.minionPath.at(-1)).toMatchObject({ x: bottomBarracks.x, y: bottomBarracks.y });
  expect(midTop.minionPath.at(-1)).toMatchObject({ x: topBarracks.x, y: topBarracks.y });
  expect(midBottom.minionPath.at(-1)).toMatchObject({ x: bottomBarracks.x, y: bottomBarracks.y });
  expect(defenderTop.minionPath.at(-1)).toMatchObject({ x: attackerTopBarracks.x, y: attackerTopBarracks.y });
  expect(defenderBottom.minionPath.at(-1)).toMatchObject({ x: attackerBottomBarracks.x, y: attackerBottomBarracks.y });
  expect(top.minionPath.some((point) => point.y > top.minionPath[0].y + 500)).toBe(true);
  expect(bottom.minionPath.some((point) => point.y < bottom.minionPath[0].y - 500)).toBe(true);
  expect(top.minionPathCorridorWidth).toBeCloseTo(topRoad.height, 5);
  expect(top.minionPathCorridorWidth).toBeLessThan(topLane.width);

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

test('prevents repeated minion combat sway after the engagement settles', () => {
  const runtime = new BattleRuntime(buildMinionInit());
  runtime.createDeployGroup('attacker', { units: { infantry_basic: 10 }, x: -420, y: 0, placed: true });
  expect(runtime.startBattle()).toMatchObject({ ok: true });
  const spawned = runtime.spawnTrainingMinionWave(0);
  const attackerTop = spawned.find((squad) => (
    squad.team === 'attacker' && squad.minionLaneId === 'top'
  ));
  const defenderTop = spawned.find((squad) => (
    squad.team === 'defender' && squad.minionLaneId === 'top'
  ));
  const retainedIds = new Set([attackerTop.id, defenderTop.id]);
  runtime.sim.squads = [attackerTop, defenderTop];
  runtime.sim._squadById = new Map(runtime.sim.squads.map((squad) => [squad.id, squad]));
  Array.from(runtime.crowd.agentsBySquad.keys()).forEach((squadId) => {
    if (!retainedIds.has(squadId)) runtime.crowd.agentsBySquad.delete(squadId);
  });
  runtime.crowd.allAgents = [
    ...(runtime.crowd.agentsBySquad.get(attackerTop.id) || []),
    ...(runtime.crowd.agentsBySquad.get(defenderTop.id) || [])
  ];
  runtime.minionWaveState.released = true;
  runtime.minionWaveState.nextWaveAtSec = Number.POSITIVE_INFINITY;
  const previous = new Map();
  const metrics = new Map();
  let sawDamage = false;
  let recording = false;
  let engagementFrames = 0;
  let recordedFrames = 0;
  let attackHoldFrames = 0;
  let settledAttackHoldFrames = 0;
  let maximumSettledAttackHoldSpeed = 0;
  let maximumSettledAttackHoldPositionError = 0;
  const startingHealth = attackerTop.health + defenderTop.health;

  for (let frame = 0; frame < 700; frame += 1) {
    runtime.step(0.05);
    sawDamage = sawDamage || attackerTop.health + defenderTop.health < startingHealth;
    const agentById = new Map(runtime.crowd.allAgents.map((agent) => [agent.id, agent]));
    const holdingSquads = [attackerTop, defenderTop].filter((squad) => squad.minionAiState === 'ATTACK_HOLD');
    if (holdingSquads.length === 2) {
      attackHoldFrames += 1;
      let allSettled = true;
      let frameMaximumSpeed = 0;
      let frameMaximumPositionError = 0;
      holdingSquads.forEach((squad) => {
        (runtime.crowd.agentsBySquad.get(squad.id) || []).forEach((agent) => {
          frameMaximumSpeed = Math.max(
            frameMaximumSpeed,
            Math.hypot(Number(agent.vx) || 0, Number(agent.vy) || 0)
          );
          const positionError = Math.hypot(
            (Number(agent?._minionAi?.combatX) || 0) - (Number(agent.x) || 0),
            (Number(agent?._minionAi?.combatY) || 0) - (Number(agent.y) || 0)
          );
          frameMaximumPositionError = Math.max(frameMaximumPositionError, positionError);
          if (positionError > 0.001) allSettled = false;
        });
      });
      if (allSettled) {
        settledAttackHoldFrames += 1;
        maximumSettledAttackHoldSpeed = Math.max(maximumSettledAttackHoldSpeed, frameMaximumSpeed);
        maximumSettledAttackHoldPositionError = Math.max(
          maximumSettledAttackHoldPositionError,
          frameMaximumPositionError
        );
      }
    }
    const bothEngaged = !!attackerTop.targetSquadId
      && !!defenderTop.targetSquadId
      && attackerTop.waypoints.length <= 0
      && defenderTop.waypoints.length <= 0;
    if (!recording && bothEngaged && runtime.crowd.allAgents.some((agent) => !!agent.targetAgentId)) {
      recording = true;
      previous.clear();
    }
    if (!recording) continue;
    engagementFrames += 1;
    if (engagementFrames <= 60) {
      if (engagementFrames === 60) previous.clear();
      continue;
    }
    recordedFrames += 1;
    runtime.crowd.allAgents.forEach((agent) => {
      const category = String(agent.unitCategory || 'melee');
      const row = metrics.get(category) || {
        inRangeMovingFrames: 0,
        inRangeVelocityReversals: 0,
        engagedWithoutTargetMovingFrames: 0,
        velocityReversals: 0
      };
      const prior = previous.get(agent.id);
      const target = agent.targetAgentId ? agentById.get(agent.targetAgentId) : null;
      const speed = Math.hypot(Number(agent.vx) || 0, Number(agent.vy) || 0);
      const targetDistance = target
        ? Math.hypot((target.x || 0) - (agent.x || 0), (target.y || 0) - (agent.y || 0))
        : Infinity;
      const maxRange = Math.max(0, Number(agent.attackRangeMax) || 0);
      const inRange = !!target && targetDistance <= maxRange + 0.001;
      const squad = agent.team === 'attacker' ? attackerTop : defenderTop;
      const squadEngaged = !!squad.targetSquadId && squad.waypoints.length <= 0;
      if (target) {
        if (inRange && speed > 0.5) row.inRangeMovingFrames += 1;
      } else if (squadEngaged && speed > 0.5) {
        row.engagedWithoutTargetMovingFrames += 1;
      }
      if (
        prior
        && speed > 0.5
        && prior.speed > 0.5
        && ((agent.vx * prior.vx) + (agent.vy * prior.vy)) < -(speed * prior.speed * 0.25)
      ) {
        row.velocityReversals += 1;
        if (inRange && prior.inRange) row.inRangeVelocityReversals += 1;
      }
      metrics.set(category, row);
      previous.set(agent.id, {
        vx: Number(agent.vx) || 0,
        vy: Number(agent.vy) || 0,
        speed,
        inRange
      });
    });
    if (sawDamage && recordedFrames >= 200) break;
  }

  const meleeMetrics = metrics.get('melee') || {};
  const rangedMetrics = metrics.get('ranged') || {};
  const supportMetrics = metrics.get('support') || {};
  expect(recordedFrames).toBe(200);
  expect(sawDamage).toBe(true);
  expect(attackHoldFrames).toBeGreaterThan(20);
  expect(settledAttackHoldFrames).toBeGreaterThan(20);
  expect(maximumSettledAttackHoldSpeed).toBeLessThan(0.001);
  expect(maximumSettledAttackHoldPositionError).toBeLessThan(0.001);
  expect(Number(meleeMetrics.inRangeVelocityReversals) || 0).toBe(0);
  expect(Number(rangedMetrics.inRangeVelocityReversals) || 0).toBe(0);
  expect(Number(supportMetrics.velocityReversals) || 0).toBeLessThanOrEqual(1);
});

test('real-map opposing minions cannot hold formation without an individual target or damage', () => {
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
  const spawned = runtime.spawnTrainingMinionWave(0);
  const attackerTop = spawned.find((squad) => (
    squad.team === 'attacker' && squad.minionLaneId === 'top'
  ));
  const defenderTop = spawned.find((squad) => (
    squad.team === 'defender' && squad.minionLaneId === 'top'
  ));
  const retainedIds = new Set([attackerTop.id, defenderTop.id]);
  runtime.sim.squads = [attackerTop, defenderTop];
  runtime.sim._squadById = new Map(runtime.sim.squads.map((squad) => [squad.id, squad]));
  Array.from(runtime.crowd.agentsBySquad.keys()).forEach((squadId) => {
    if (!retainedIds.has(squadId)) runtime.crowd.agentsBySquad.delete(squadId);
  });
  runtime.crowd.allAgents = [
    ...(runtime.crowd.agentsBySquad.get(attackerTop.id) || []),
    ...(runtime.crowd.agentsBySquad.get(defenderTop.id) || [])
  ];
  runtime.minionWaveState.released = true;
  runtime.minionWaveState.nextWaveAtSec = Number.POSITIVE_INFINITY;
  const startingHealth = attackerTop.health + defenderTop.health;
  let previousDistance = Math.hypot(defenderTop.x - attackerTop.x, defenderTop.y - attackerTop.y);
  let stalledWithoutTargets = 0;
  let longestStall = 0;

  for (let index = 0; index < 1200 && attackerTop.health + defenderTop.health >= startingHealth; index += 1) {
    runtime.step(0.05);
    const agents = [
      ...(runtime.crowd.agentsBySquad.get(attackerTop.id) || []),
      ...(runtime.crowd.agentsBySquad.get(defenderTop.id) || [])
    ];
    const targetCount = agents.filter((agent) => !!agent?.targetAgentId).length;
    const distance = Math.hypot(defenderTop.x - attackerTop.x, defenderTop.y - attackerTop.y);
    const bothHolding = attackerTop.waypoints.length <= 0 && defenderTop.waypoints.length <= 0;
    const madeProgress = previousDistance - distance > 0.05;
    stalledWithoutTargets = bothHolding && targetCount <= 0 && !madeProgress
      ? stalledWithoutTargets + 1
      : 0;
    longestStall = Math.max(longestStall, stalledWithoutTargets);
    previousDistance = distance;
  }

  expect(longestStall).toBeLessThan(10);
  expect(attackerTop.health + defenderTop.health).toBeLessThan(startingHealth);
});

test('does not lock distant structures and keeps real-map targets on opposing faction squads', () => {
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
  runtime.spawnTrainingMinionWave(0);
  runtime.minionWaveState.released = true;
  runtime.minionWaveState.nextWaveAtSec = Number.POSITIVE_INFINITY;
  runtime.step(0.05);

  const minions = runtime.sim.squads.filter((squad) => squad.isMinionWaveUnit);
  expect(minions.every((squad) => !squad.targetBuildingId)).toBe(true);
  expect(minions.every((squad) => squad.minionAiState === 'MARCH')).toBe(true);
  minions.forEach((squad) => {
    if (!squad.targetSquadId) return;
    const target = runtime.sim.squads.find((candidate) => candidate.id === squad.targetSquadId);
    expect(target?.team).toBe(squad.team === 'attacker' ? 'defender' : 'attacker');
    expect(target?.minionLaneId || target?.spawnLaneId).toBe(squad.minionLaneId);
  });
});
