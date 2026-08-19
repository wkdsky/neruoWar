import BattleRuntime from './BattleRuntime';
import CameraController from '../render/CameraController';
import { resolveTrainingAgentSelectionRadius } from '../../shared/trainingUnitSelection';

const buildInit = () => ({
  mode: 'training',
  rules: { allowCrossMidline: true, maxDeployGroupTotal: 10000 },
  battlefield: {
    layoutMeta: { fieldWidth: 1200, fieldHeight: 800 },
    objects: []
  },
  unitTypes: [{
    unitTypeId: 'infantry_basic',
    name: '步兵',
    classTag: 'infantry',
    hp: 10,
    atk: 2,
    def: 1,
    speed: 1,
    range: 1
  }],
  attacker: {
    rosterUnits: [{ unitTypeId: 'infantry_basic', count: 100 }],
    deployUnits: []
  },
  defender: {
    rosterUnits: [{ unitTypeId: 'infantry_basic', count: 100 }],
    deployUnits: []
  }
});

const buildThreeLaneMapInit = () => {
  const init = buildInit();
  const staticObjects = [
    {
      objectId: 'training_base_attacker',
      itemId: 'training_map_base',
      x: -500,
      y: 0,
      width: 120,
      depth: 180,
      height: 96,
      category: 'base',
      team: 'attacker',
      mapStatic: true,
      presetTags: ['base'],
      maxHp: 6000
    },
    {
      objectId: 'training_base_defender',
      itemId: 'training_map_base',
      x: 500,
      y: 0,
      width: 120,
      depth: 180,
      height: 96,
      category: 'base',
      team: 'defender',
      mapStatic: true,
      presetTags: ['base'],
      maxHp: 6000
    },
    {
      objectId: 'training_tower_defender_mid',
      itemId: 'training_map_tower',
      x: 180,
      y: 0,
      width: 52,
      depth: 52,
      height: 88,
      category: 'tower',
      team: 'defender',
      mapStatic: true,
      presetTags: ['tower'],
      objectiveId: 'objective_tower_defender_mid',
      objectiveType: 'tower',
      maxHp: 1200
    }
  ];
  init.battlefield = {
    layoutMeta: { fieldWidth: 1200, fieldHeight: 800 },
    itemCatalog: [
      {
        itemId: 'training_map_base',
        width: 120,
        depth: 180,
        height: 96,
        hp: 6000,
        defense: 5,
        blocksMovement: true,
        blocksVision: true,
        style: { color: '#c9474f', shape: 'training-base' }
      },
      {
        itemId: 'training_map_tower',
        width: 52,
        depth: 52,
        height: 88,
        hp: 1200,
        defense: 3,
        blocksMovement: true,
        blocksVision: true,
        style: { color: '#d45151', shape: 'training-tower' }
      }
    ],
    map: {
      mapId: 'training-three-lane',
      mapVersion: 1,
      defaultPresetId: 'full-jungle',
      activePresetId: 'full-jungle',
      presets: [
        { id: 'empty', label: '空地图兵种测试', enabledTags: ['base'] },
        { id: 'full-jungle', label: '完整野区对抗', enabledTags: ['base', 'tower'] }
      ],
      terrainRegions: [
        { id: 'grass', type: 'grass', shape: 'rect', x: 0, y: 0, width: 1200, height: 800 },
        { id: 'mid-road', type: 'road', shape: 'rect', x: 0, y: 0, width: 1200, height: 150 }
      ],
      lanes: [{ id: 'mid', label: '中路', centerY: 0, width: 150 }],
      deploySlots: [
        ...['0', '1', '2', '3', '4', '5'].map((slotId, index) => ({ id: `atk-${slotId}`, team: 'attacker', x: -450, y: -250 + (index * 100) })),
        ...['0', '1', '2', '3', '4', '5'].map((slotId, index) => ({ id: `def-${slotId}`, team: 'defender', x: 450, y: -250 + (index * 100) }))
      ],
      navigation: { cellSize: 48, wallClearance: 10, maxSearchNodes: 800 },
      objects: staticObjects,
      objectives: [{
        objectiveId: 'objective_tower_defender_mid',
        sourceObjectId: 'training_tower_defender_mid',
        type: 'tower',
        team: 'defender',
        laneId: 'mid',
        maxHp: 1200,
        attackRange: 150,
        attackIntervalSec: 1,
        attackDamage: 8,
        presetTags: ['tower']
      }]
    },
    objects: staticObjects
  };
  return init;
};

const buildMixedInit = () => {
  const init = buildInit();
  init.unitTypes = [
    ...init.unitTypes,
    {
      unitTypeId: 'archer_basic',
      name: '弓兵',
      classTag: 'archer',
      hp: 8,
      atk: 4,
      def: 0.5,
      speed: 1.2,
      range: 4
    }
  ];
  init.attacker.rosterUnits = [
    { unitTypeId: 'infantry_basic', count: 100 },
    { unitTypeId: 'archer_basic', count: 100 }
  ];
  return init;
};

const buildFormationTemplates = () => ([
  {
    formationId: 'line',
    name: '横向阵',
    placements: [
      { unitTypeId: 'infantry_basic', x: 0, y: 0 },
      { unitTypeId: 'infantry_basic', x: 2, y: 0 }
    ]
  },
  {
    formationId: 'column',
    name: '纵深阵',
    placements: [
      { unitTypeId: 'infantry_basic', x: 0, y: 0 },
      { unitTypeId: 'infantry_basic', x: 0, y: 2 }
    ]
  }
]);

describe('BattleRuntime training control', () => {
  test('loads the versioned three-lane map, supports presets, and seeds training objectives', () => {
    const runtime = new BattleRuntime(buildThreeLaneMapInit());

    expect(runtime.getTrainingMapState()).toMatchObject({
      mapId: 'training-three-lane',
      mapVersion: 1,
      activePresetId: 'full-jungle'
    });
    expect(runtime.initialBuildings).toHaveLength(3);
    expect(runtime.getTrainingMapDeploySlots('attacker')).toHaveLength(6);
    expect(runtime.setTrainingMapPreset('empty')).toMatchObject({ ok: true });
    expect(runtime.initialBuildings).toHaveLength(2);
    expect(runtime.setTrainingMapPreset('full-jungle')).toMatchObject({ ok: true });

    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      placed: true
    });
    expect(created.ok).toBe(true);
    expect(runtime.startBattle()).toMatchObject({ ok: true });
    expect(runtime.sim.trainingObjectives).toHaveLength(1);
    expect(runtime.sim.trainingNavigator).toBeTruthy();
    expect(runtime.getMinimapSnapshot().trainingMap.mapId).toBe('training-three-lane');
    runtime.sim.trainingObjectives[0].hp = 0;
    runtime.sim.buildings.find((building) => building.id === 'training_tower_defender_mid').destroyed = true;
    expect(runtime.resetTraining()).toMatchObject({ ok: true });
    expect(runtime.getPhase()).toBe('deploy');
    expect(runtime.initialBuildings.find((building) => building.id === 'training_tower_defender_mid').destroyed).toBe(false);
    expect(runtime.getTrainingMapState().objectives[0]).toMatchObject({ hp: 1200, destroyed: false });
  });

  test('spawns neutral camp guards while keeping the camp marker out of building collision', () => {
    const init = buildThreeLaneMapInit();
    init.battlefield.map.objects.push({
      objectId: 'training_neutral_camp_mid',
      x: 0,
      y: 180,
      width: 42,
      depth: 42,
      height: 24,
      category: 'neutralCamp',
      team: 'neutral',
      mapStatic: true,
      blocksMovement: false,
      presetTags: ['tower'],
      objectiveId: 'objective_neutral_camp_mid',
      objectiveType: 'neutralCamp'
    });
    init.battlefield.map.objectives.push({
      objectiveId: 'objective_neutral_camp_mid',
      sourceObjectId: 'training_neutral_camp_mid',
      type: 'neutralCamp',
      team: 'neutral',
      targetable: false,
      attackEnabled: false,
      presetTags: ['tower'],
      neutralCamp: {
        campId: 'camp-mid',
        label: '中立守卫',
        anchor: { x: 0, y: 180 },
        spawnPoints: [{ x: 0, y: 180 }],
        patrolPoints: [{ x: 20, y: 180 }],
        initialSpawnAtSec: 0,
        respawnSec: 3,
        senseRadius: 60,
        leashRadius: 100,
        returnRadius: 12,
        patrolIntervalSec: 2,
        composition: [
          { unitTypeId: 'training_neutral_guard', name: '中立短刃兵', count: 6, hp: 80, attack: 14, defense: 7, speed: 1, attackRange: 1, classTag: 'infantry', unitCategory: 'melee', unitSubtype: 'balance' },
          { unitTypeId: 'training_neutral_archer', name: '中立弓手', count: 4, hp: 56, attack: 18, defense: 4, speed: 1.08, attackRange: 4.6, classTag: 'archer', unitCategory: 'ranged', unitSubtype: 'mobility' },
          { unitTypeId: 'training_neutral_support', name: '中立祭司', count: 2, hp: 72, attack: 9, defense: 7, speed: 0.94, attackRange: 4, classTag: 'infantry', unitCategory: 'support', unitSubtype: 'comprehensive' }
        ]
      }
    });
    init.battlefield.objects = init.battlefield.map.objects;
    const runtime = new BattleRuntime(init);
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      placed: true
    });

    expect(created.ok).toBe(true);
    expect(runtime.startBattle()).toMatchObject({ ok: true });
    expect(runtime.sim.trainingNeutralCamps).toHaveLength(1);
    expect(runtime.getSquadById('neutral_camp_camp-mid')).toMatchObject({
      team: 'neutral',
      behavior: 'guard',
      remain: 12
    });
    expect(runtime.unitTypeMap.get('training_neutral_archer')).toMatchObject({ unitCategory: 'ranged', classTag: 'archer' });
    expect(runtime.unitTypeMap.get('training_neutral_support')).toMatchObject({ unitCategory: 'support' });
    const campAgents = runtime.crowd.agentsBySquad.get('neutral_camp_camp-mid');
    expect(campAgents).toHaveLength(12);
    expect(campAgents.every((agent) => agent.initialWeight === 1)).toBe(true);
    expect(campAgents.reduce((counts, agent) => ({
      ...counts,
      [agent.unitCategory]: (counts[agent.unitCategory] || 0) + 1
    }), {})).toEqual({ melee: 6, ranged: 4, support: 2 });
    const campSnapshot = runtime.getRenderSnapshot();
    expect(campSnapshot.unitSquadIds.filter((squadId) => squadId === 'neutral_camp_camp-mid')).toHaveLength(12);
    expect(runtime.sim.buildings.find((building) => building.id === 'training_neutral_camp_mid').blocksMovement).toBe(false);
    expect(runtime.getTrainingMapState().neutralCamps[0]).toMatchObject({ state: 'alive' });
  });

  test('moves both reference central sand camp guards after training starts', () => {
    const { buildReferenceTrainingMapConfig } = require('../../../../../../backend/services/trainingMapDefinitionService');
    const map = buildReferenceTrainingMapConfig();
    const init = buildInit();
    init.battlefield = {
      layoutMeta: map.layoutMeta,
      itemCatalog: map.itemCatalog,
      map,
      objects: map.objects
    };
    const runtime = new BattleRuntime(init);
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      placed: true
    }).ok).toBe(true);
    expect(runtime.startBattle()).toMatchObject({ ok: true });

    const northCampBuilding = runtime.sim.buildings.find((building) => building.id === 'map-camp-center-north');
    expect(northCampBuilding).toMatchObject({
      mapStatic: true,
      category: 'neutralCamp',
      neutralCampId: 'camp-center-north',
      neutralProfileId: 'center',
      neutralPatrolMode: 'shuttle',
      neutralPatrolPreview: true
    });
    expect(northCampBuilding.neutralComposition).toEqual(expect.arrayContaining([
      expect.objectContaining({ unitCategory: 'melee' }),
      expect.objectContaining({ unitCategory: 'ranged' }),
      expect.objectContaining({ unitCategory: 'support' })
    ]));

    const guards = ['camp-center-north', 'camp-center-south'].map((campId) => (
      runtime.getSquadById(`neutral_camp_${campId}`)
    ));
    const snapshotModelsForSquad = (snapshot, squadId) => {
      const models = [];
      for (let index = 0; index < snapshot.units.count; index += 1) {
        if (snapshot.unitSquadIds[index] !== squadId) continue;
        const base = index * 20;
        models.push({
          x: snapshot.units.data[base + 0],
          y: snapshot.units.data[base + 1],
          size: snapshot.units.data[base + 3]
        });
      }
      return models;
    };
    const snapshotCenter = (models) => models.reduce((center, model) => ({
      x: center.x + model.x / Math.max(1, models.length),
      y: center.y + model.y / Math.max(1, models.length)
    }), { x: 0, y: 0 });
    const beforeSnapshot = runtime.getRenderSnapshot();
    const beforeSnapshotModels = guards.map((guard) => snapshotModelsForSquad(beforeSnapshot, guard.id));
    const before = guards.map((guard) => ({ x: guard.x, y: guard.y }));
    const beforeAgents = guards.map((guard) => (
      (runtime.crowd.agentsBySquad.get(guard.id) || [])
        .filter((agent) => !agent.isFlagBearer)
        .map((agent) => ({ id: agent.id, x: agent.x, y: agent.y }))
    ));
    guards.forEach((guard) => {
      expect(guard?.guard?.patrolTarget).toBeTruthy();
      expect(guard?.waypoints?.length).toBeGreaterThan(0);
      const agents = runtime.crowd.agentsBySquad.get(guard.id) || [];
      expect(guard?.representativeAgentWeightCap).toBe(1);
      expect(agents).toHaveLength(guard.startCount);
      expect(agents.every((agent) => agent.initialWeight === 1)).toBe(true);
    });
    beforeSnapshotModels.forEach((models, index) => {
      expect(models).toHaveLength(guards[index].startCount);
      expect(models.every((model) => model.size > 2.5)).toBe(true);
    });

    for (let index = 0; index < 60; index += 1) runtime.step(1 / 30);
    const afterSnapshot = runtime.getRenderSnapshot();

    guards.forEach((guard, index) => {
      expect(Math.hypot(guard.x - before[index].x, guard.y - before[index].y)).toBeGreaterThan(20);
      const agentsById = new Map((runtime.crowd.agentsBySquad.get(guard.id) || [])
        .map((agent) => [agent.id, agent]));
      expect(beforeAgents[index].some((beforeAgent) => {
        const agent = agentsById.get(beforeAgent.id);
        return agent && Math.hypot(agent.x - beforeAgent.x, agent.y - beforeAgent.y) > 20;
      })).toBe(true);
      const afterModels = snapshotModelsForSquad(afterSnapshot, guard.id);
      expect(Math.hypot(
        snapshotCenter(afterModels).x - snapshotCenter(beforeSnapshotModels[index]).x,
        snapshotCenter(afterModels).y - snapshotCenter(beforeSnapshotModels[index]).y
      )).toBeGreaterThan(20);
    });

    const campsById = new Map(runtime.sim.trainingNeutralCamps.map((camp) => [camp.id, camp]));
    const visitedPatrolSides = guards.map(() => new Set());
    const visitedModelPatrolSides = guards.map(() => new Set());
    for (let index = 0; index < 360; index += 1) {
      runtime.step(1 / 20);
      guards.forEach((guard, guardIndex) => {
        const camp = campsById.get(guard.neutralCampId);
        const start = camp.patrolPoints[0];
        const end = camp.patrolPoints[1];
        const directionX = end.x - start.x;
        const directionY = end.y - start.y;
        const directionLength = Math.hypot(directionX, directionY);
        const sideThreshold = Math.max(24, directionLength * 0.18);
        const resolvePatrolOffset = (point) => (
          (((point.x - camp.anchor.x) * directionX) + ((point.y - camp.anchor.y) * directionY))
            / Math.max(1, directionLength)
        );
        const squadOffset = resolvePatrolOffset(guard);
        if (Math.abs(squadOffset) > sideThreshold) visitedPatrolSides[guardIndex].add(Math.sign(squadOffset));

        const models = (runtime.crowd.agentsBySquad.get(guard.id) || [])
          .filter((agent) => !agent.isFlagBearer);
        const modelCenter = models.reduce((center, agent) => ({
          x: center.x + agent.x,
          y: center.y + agent.y
        }), { x: 0, y: 0 });
        modelCenter.x /= Math.max(1, models.length);
        modelCenter.y /= Math.max(1, models.length);
        const modelOffset = resolvePatrolOffset(modelCenter);
        if (Math.abs(modelOffset) > sideThreshold) visitedModelPatrolSides[guardIndex].add(Math.sign(modelOffset));
      });
    }
    visitedPatrolSides.forEach((sides) => {
      expect(sides).toEqual(new Set([-1, 1]));
    });
    visitedModelPatrolSides.forEach((sides) => {
      expect(sides).toEqual(new Set([-1, 1]));
    });
  });

  test('starts an AI squad toward a direct goal instead of consuming the formal lane path', () => {
    const init = buildThreeLaneMapInit();
    init.battlefield.map.mapId = 'training-war-map-v1';
    init.battlefield.map.lanes = [{
      id: 'mid',
      label: '中路',
      centerY: 0,
      width: 150,
      attackerDirection: 'left-to-right',
      centerline: [{ x: -450, y: 0 }, { x: -120, y: 150 }, { x: 120, y: 150 }, { x: 450, y: 0 }]
    }];
    init.battlefield.map.objects = [];
    init.battlefield.map.objectives = [];
    init.battlefield.objects = [];
    const runtime = new BattleRuntime(init);
    const created = runtime.createDeployGroup('defender', {
      units: { infantry_basic: 20 },
      x: 420,
      y: 0,
      placed: true,
      controlMode: 'AI'
    });
    expect(runtime.startBattle()).toMatchObject({ ok: true });
    runtime.step(0.1);

    const squad = runtime.getSquadById('defender_squad_1');
    expect(squad.autoNavigation).toMatchObject({ goalId: 'field-edge:defender' });
    expect(squad.waypoints).toHaveLength(1);
    expect(squad.waypoints[0].x).toBeLessThan(-500);
    expect(squad.waypoints[0].y).toBe(0);
  });

  test('keeps the reference highland-to-mid-tower march near eight seconds', () => {
    const init = buildInit();
    init.unitTypes[0].speed = 5;
    init.battlefield.layoutMeta = { fieldWidth: 3600, fieldHeight: 2504 };
    init.battlefield.map = {
      mapId: 'training-war-map-v1',
      mapVersion: 2,
      activePresetId: 'full-jungle',
      defaultPresetId: 'full-jungle',
      presets: [{ id: 'full-jungle', label: '完整野区对抗', enabledTags: [] }],
      movementCalibration: {
        targetTravelSeconds: 8,
        nominalUnitSpeed: 5,
        leaderSpeedMultiplier: 18,
        referenceSpawnSlotId: 'deploy-spawn-attacker-top-1',
        referenceObjectiveId: 'tower-attacker-mid-outer',
        expectedTravelSeconds: 7.9
      },
      terrainRegions: [],
      lanes: [{ id: 'mid', centerY: 0, width: 180 }],
      deploySlots: [{
        id: 'deploy-spawn-attacker-top-1',
        team: 'attacker',
        laneId: 'top',
        x: -1731,
        y: 708
      }],
      navigation: { cellSize: 64, wallClearance: 18, maxSearchNodes: 1200 },
      objects: [],
      objectives: []
    };
    const runtime = new BattleRuntime(init);
    expect(runtime.getTrainingMapState().movementCalibration).toMatchObject({
      targetTravelSeconds: 8,
      expectedTravelSeconds: 7.9
    });
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      placed: true,
      controlMode: 'USER'
    });
    expect(created.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    expect(runtime.commandMove(squad.id, { x: -1663, y: 0 })).toBe(true);

    let arrivalTime = null;
    for (let index = 0; index < 420; index += 1) {
      runtime.step(1 / 30);
      if (Math.hypot(squad.x + 1663, squad.y) <= 12) {
        arrivalTime = runtime.sim.timeElapsed;
        break;
      }
    }

    expect(arrivalTime).not.toBeNull();
    expect(arrivalTime).toBeGreaterThanOrEqual(7.2);
    expect(arrivalTime).toBeLessThanOrEqual(8.8);
  });

  test('keeps static map collider overrides for curved walls', () => {
    const battleInit = buildThreeLaneMapInit();
    battleInit.battlefield.itemCatalog.push({
      itemId: 'training_map_low_wall',
      width: 160,
      depth: 28,
      height: 34,
      hp: 1450,
      defense: 2.6,
      blocksMovement: true,
      blocksVision: false,
      style: { color: '#8c785b', shape: 'training-low-wall' }
    });
    battleInit.battlefield.map.objects.push({
      objectId: 'curved_map_wall',
      itemId: 'training_map_low_wall',
      x: 0,
      y: 220,
      width: 160,
      depth: 90,
      height: 34,
      category: 'wall',
      team: 'neutral',
      mapStatic: true,
      geometryKind: 'ordinaryWall',
      visualPath: [{ x: -40, y: 204 }, { x: 0, y: 220 }, { x: 40, y: 234 }],
      presetTags: ['tower'],
      maxHp: 1450,
      blocksMovement: true,
      blocksVision: false,
      collider: {
        kind: 'compositeObb',
        parts: [
          { cx: -36, cy: -12, w: 82, d: 18, h: 34, yawDeg: 18 },
          { cx: 34, cy: 14, w: 82, d: 18, h: 34, yawDeg: 22 }
        ]
      }
    });

    const runtime = new BattleRuntime(battleInit);
    const wall = runtime.initialBuildings.find((building) => building.id === 'curved_map_wall');

    expect(wall.collider.kind).toBe('compositeObb');
    expect(wall.collider.parts).toHaveLength(2);
    expect(wall.colliderParts).toHaveLength(2);
    expect(wall.geometryKind).toBe('ordinaryWall');
    expect(wall.visualPath).toHaveLength(3);
  });

  test('moves toward the nearest legal point when a training-map command targets a tower', () => {
    const runtime = new BattleRuntime(buildThreeLaneMapInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      placed: true,
      controlMode: 'USER'
    });

    expect(created.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    const tower = runtime.sim.buildings.find((building) => building.id === 'training_tower_defender_mid');
    squad.x = -120;
    squad.y = 0;

    expect(runtime.commandMove(squad.id, { x: tower.x, y: tower.y })).toBe(true);
    const endpoint = squad.waypoints[squad.waypoints.length - 1];

    expect(endpoint.x).toBeLessThan(tower.x - (tower.width * 0.5));
    expect(squad.order.targetPoint).toEqual(endpoint);
    expect(squad.lastMoveMarker).toMatchObject({ x: endpoint.x, y: endpoint.y });
  });

  test('detours around a blocking right-click path without truncating its legal destination', () => {
    const runtime = new BattleRuntime(buildThreeLaneMapInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      placed: true,
      controlMode: 'USER'
    });

    expect(created.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    squad.x = -300;
    squad.y = -250;
    runtime.sim.buildings.push({
      id: 'right-click-wall',
      x: 0,
      y: -250,
      width: 60,
      depth: 160,
      blocksMovement: true
    });

    expect(runtime.commandMove(squad.id, { x: 300, y: -250 })).toBe(true);

    expect(squad.waypoints.length).toBeGreaterThan(1);
    expect(squad.waypoints[squad.waypoints.length - 1]).toEqual({ x: 300, y: -250 });
    expect(squad.waypoints.some((point) => point.y !== -250)).toBe(true);
  });

  test('projects per-兵种 counts and formation metadata into a deployment card', () => {
    const runtime = new BattleRuntime(buildMixedInit());
    const result = runtime.createDeployGroup('attacker', {
      name: '前线混编',
      templateName: '混编模板',
      templateFormations: [{ formationId: 'line', name: '横向阵' }],
      activeFormationId: 'line',
      units: { infantry_basic: 12, archer_basic: 8 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    });
    expect(result.ok).toBe(true);

    const row = runtime.getCardRows().find((card) => card.id === result.groupId);
    expect(row).toMatchObject({
      name: '前线混编',
      templateName: '混编模板',
      formationName: '横向阵',
      templateFormations: [{ formationId: 'line', name: '横向阵' }],
      unitMetrics: {
        totalCount: 20,
        totalHp: 184,
        totalAtk: 56,
        totalDef: 16
      }
    });
    expect(row.unitComposition).toEqual(expect.arrayContaining([
      expect.objectContaining({ unitTypeId: 'infantry_basic', count: 12, startCount: 12 }),
      expect.objectContaining({ unitTypeId: 'archer_basic', count: 8, startCount: 8 })
    ]));
  });

  test('limits each training side to six deployment groups', () => {
    const runtime = new BattleRuntime(buildInit());
    const createGroups = (team) => Array.from({ length: 6 }, (_, index) => (
      runtime.createDeployGroup(team, {
        name: `${team}-${index + 1}`,
        units: { infantry_basic: 1 }
      })
    ));

    expect(createGroups('attacker').every((result) => result.ok)).toBe(true);
    expect(createGroups('defender').every((result) => result.ok)).toBe(true);
    expect(runtime.createDeployGroup('attacker', { units: { infantry_basic: 1 } })).toEqual({
      ok: false,
      reason: '我方最多只能设置 6 支部队'
    });
    expect(runtime.createDeployGroup('defender', { units: { infantry_basic: 1 } })).toEqual({
      ok: false,
      reason: '敌方最多只能设置 6 支部队'
    });
  });

  test('creates zero-point default skills from the troop categories and preserves explicit empty settings', () => {
    const init = buildInit();
    init.unitTypes = [
      { unitTypeId: 'ranged_a', name: '游击射手', unitCategory: 'ranged', rpsType: 'ranged', hp: 8, atk: 4, def: 1, speed: 1.2, range: 4 },
      { unitTypeId: 'ranged_b', name: '守望炮手', unitCategory: 'ranged', rpsType: 'ranged', hp: 9, atk: 5, def: 1, speed: 1, range: 5 },
      { unitTypeId: 'support_a', name: '协调师', unitCategory: 'support', rpsType: 'support', hp: 7, atk: 2, def: 1, speed: 1, range: 2 }
    ];
    init.attacker.rosterUnits = [
      { unitTypeId: 'ranged_a', count: 50 },
      { unitTypeId: 'ranged_b', count: 50 },
      { unitTypeId: 'support_a', count: 50 }
    ];
    const runtime = new BattleRuntime(init);
    const defaultGroup = runtime.createDeployGroup('attacker', {
      units: { ranged_a: 10, ranged_b: 10, support_a: 10 }
    });
    const explicitEmpty = runtime.createDeployGroup('attacker', {
      units: { ranged_a: 10, support_a: 10 },
      skillSlots: []
    });
    const categoryOnlyDefault = runtime.createDeployGroup('attacker', {
      units: { ranged_a: 10, support_a: 10 }
    });

    expect(runtime.getTrainingState().autoSkillPointGainEnabled).toBe(false);
    expect(runtime.getTrainingSquadSkillPointState(defaultGroup.groupId).points).toBe(0);
    expect(runtime.getDeployGroupSkillSlots(defaultGroup.groupId).map((slot) => slot.treeCategory)).toEqual([
      'ranged', 'ranged', 'support'
    ]);
    expect(runtime.getDeployGroupSkillSlots(defaultGroup.groupId).map((slot) => slot.skillId)).toEqual([
      'ranged_fixed_volley', 'ranged_fixed_volley', 'support_specialized_boost'
    ]);
    expect(runtime.getDeployGroupSkillSlots(explicitEmpty.groupId).every((slot) => !slot.skillId)).toBe(true);
    expect(runtime.getDeployGroupSkillSlots(categoryOnlyDefault.groupId).map((slot) => slot.treeCategory)).toEqual([
      'ranged', 'ranged', 'support'
    ]);
  });

  test('reorders deployment formations without changing the active formation', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      templateFormations: [
        { formationId: 'one', name: '一', placements: [{ unitTypeId: 'infantry_basic', x: 0, y: 0 }] },
        { formationId: 'two', name: '二', placements: [{ unitTypeId: 'infantry_basic', x: 1, y: 0 }] },
        { formationId: 'three', name: '三', placements: [{ unitTypeId: 'infantry_basic', x: 2, y: 0 }] }
      ],
      activeFormationId: 'two'
    });
    const result = runtime.reorderDeployGroupFormations(created.groupId, ['three', 'one', 'two']);
    expect(result.ok).toBe(true);
    expect(result.formations.map((formation) => formation.formationId)).toEqual(['three', 'one', 'two']);
    expect(runtime.getDeployGroupById(created.groupId).activeFormationId).toBe('two');
  });

  test('switches formations instantly before training and reforms over time during training', () => {
    const runtime = new BattleRuntime(buildInit());
    const formations = buildFormationTemplates();
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -420,
      y: 0,
      placed: true,
      controlMode: 'USER',
      templateFormations: formations,
      activeFormationId: 'line'
    });

    expect(runtime.setDeployGroupFormation(created.groupId, formations[1], 'attacker')).toMatchObject({
      ok: true,
      reforming: false
    });
    expect(runtime.getDeployGroupById(created.groupId, 'attacker').activeFormationId).toBe('column');
    expect(runtime.setDeployGroupFormation(created.groupId, formations[0], 'attacker').ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('attacker_squad_1');
    const beforeSlots = runtime.crowd.agentsBySquad.get(squad.id).map((agent) => ({ ...agent.formationSlot }));
    const result = runtime.setDeployGroupFormation(squad.id, formations[1], 'attacker');

    expect(result).toMatchObject({ ok: true, reforming: true, reformDurationSec: 4.6 });
    expect(squad.activeFormationId).toBe('column');
    expect(squad.formationChange).toMatchObject({
      fromFormationId: 'line',
      toFormationId: 'column',
      remainingSec: 4.6
    });
    expect(runtime.getDeployGroupFormations(squad.id).map((formation) => formation.formationId)).toEqual(['line', 'column']);
    expect(runtime.crowd.agentsBySquad.get(squad.id).map((agent) => agent.formationSlot)).not.toEqual(beforeSlots);

    runtime.step(0.05);
    expect(runtime.getCardRows().find((row) => row.id === squad.id)).toMatchObject({
      action: '换阵中',
      formationChange: expect.objectContaining({ toFormationId: 'column' })
    });

    for (let index = 0; index < 100; index += 1) runtime.step(0.05);

    expect(squad.formationChange).toBeNull();
    expect(squad.speedPolicy).toBe('MARCH');
    const agents = runtime.crowd.agentsBySquad.get(squad.id)
      .filter((agent) => !agent.dead && !agent.isFlagBearer);
    const formationForward = {
      x: Math.cos(squad.formationRect.facingRad),
      y: Math.sin(squad.formationRect.facingRad)
    };
    const formationSide = { x: -formationForward.y, y: formationForward.x };
    const largestSlotError = Math.max(...agents.map((agent) => {
      const slot = agent.formationSlot;
      const expectedX = squad.x + (formationSide.x * slot.side) + (formationForward.x * slot.front);
      const expectedY = squad.y + (formationSide.y * slot.side) + (formationForward.y * slot.front);
      return Math.hypot(agent.x - expectedX, agent.y - expectedY);
    }));

    expect(largestSlotError).toBeLessThan(1e-5);
  });

  test('reforms formations after a regular battle begins', () => {
    const init = buildInit();
    init.mode = 'battle';
    const runtime = new BattleRuntime(init);
    const formations = buildFormationTemplates();
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -420,
      y: 0,
      placed: true,
      templateFormations: formations,
      activeFormationId: 'line'
    });

    expect(created.ok).toBe(true);
    expect(runtime.createDeployGroup('defender', {
      units: { infantry_basic: 100 },
      x: 420,
      y: 0,
      placed: true
    }).ok).toBe(true);

    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('attacker_squad_1');
    const result = runtime.setDeployGroupFormation(squad.id, formations[1], 'attacker');

    expect(result).toMatchObject({ ok: true, reforming: true, reformDurationSec: 4.6 });
    expect(squad.activeFormationId).toBe('column');
    expect(squad.formationChange).toMatchObject({
      fromFormationId: 'line',
      toFormationId: 'column',
      remainingSec: 4.6
    });

    for (let index = 0; index < 100; index += 1) runtime.step(0.05);

    expect(squad.formationChange).toBeNull();
    expect(squad.speedPolicy).toBe('MARCH');
  });

  test('rotates a template formation without rebuilding its custom slots', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      templateFormations: [{
        formationId: 'line',
        name: '横向阵',
        placements: [
          { unitTypeId: 'infantry_basic', x: 0, y: 0 },
          { unitTypeId: 'infantry_basic', x: 2, y: 0 }
        ]
      }],
      activeFormationId: 'line'
    });
    const before = runtime.getDeployGroupSlots(created.groupId, 'attacker');
    const result = runtime.setDeployGroupRect(created.groupId, { facingRad: Math.PI / 2 }, 'attacker');
    const group = runtime.getDeployGroupById(created.groupId, 'attacker');

    expect(result.ok).toBe(true);
    expect(group.formationRect).toMatchObject({ formationId: 'line', formationName: '横向阵', facingRad: Math.PI / 2 });
    expect(group.deploySlots.map((slot) => [slot.side, slot.front, slot.unitTypeId])).toEqual(
      before.map((slot) => [slot.side, slot.front, slot.unitTypeId])
    );
  });

  test('stores a selectable forward direction without rotating the deployment rectangle', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    const group = runtime.getDeployGroupById(created.groupId, 'attacker');
    const formationFacing = group.formationRect.facingRad;

    const result = runtime.setDeployGroupDirection(created.groupId, Math.PI / 2, 'attacker');

    expect(result).toEqual({
      ok: true,
      directionOffsetRad: Math.PI / 2,
      directionRad: formationFacing + (Math.PI / 2)
    });
    expect(group.formationRect.facingRad).toBeCloseTo(formationFacing);
    expect(group.formationRect.directionOffsetRad).toBeCloseTo(Math.PI / 2);
    expect(group.formationRect.directionRad).toBeCloseTo(formationFacing + (Math.PI / 2));

    runtime.setDeployGroupRect(created.groupId, { facingRad: formationFacing + (Math.PI / 4) }, 'attacker');
    expect(group.formationRect.directionOffsetRad).toBeCloseTo(Math.PI / 2);
    expect(group.formationRect.directionRad).toBeCloseTo(formationFacing + (Math.PI * 3 / 4));

    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.getSquadById('attacker_squad_1').formationRect.directionOffsetRad).toBeCloseTo(Math.PI / 2);
  });

  test('snaps a battle direction to eight formation-relative headings and applies it to the crowd', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });

    expect(created.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    const result = runtime.setDeployGroupDirection(squad.id, Math.PI * 0.62, 'attacker');

    expect(result).toMatchObject({
      ok: true,
      directionOffsetRad: Math.PI / 2,
      directionRad: Math.PI / 2
    });
    expect(squad.formationRect.directionOffsetRad).toBeCloseTo(Math.PI / 2, 6);
    expect(squad._crowdForward.x).toBeCloseTo(0, 6);
    expect(squad._crowdForward.y).toBeCloseTo(1, 6);
    expect(squad.dirX).toBeCloseTo(0, 6);
    expect(squad.dirY).toBeCloseTo(1, 6);
  });

  test('keeps the formation body at its chosen local offset when battle movement begins', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    const group = runtime.getDeployGroupById(created.groupId, 'attacker');
    runtime.setDeployGroupRect(group.id, { facingRad: 0, width: 96 }, 'attacker');
    runtime.setDeployGroupDirection(group.id, Math.PI / 2, 'attacker');

    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    const agents = runtime.crowd.agentsBySquad.get(squad.id);
    const formationAgent = agents.find((agent) => (
      !agent.isFlagBearer
      && (Math.abs(Number(agent.formationSlot?.side) || 0) > 0.01
        || Math.abs(Number(agent.formationSlot?.front) || 0) > 0.01)
    ));
    const expectFormationPosition = () => {
      const formationForward = { x: 1, y: 0 };
      const formationSide = { x: 0, y: 1 };
      const slot = formationAgent.formationSlot;
      expect(formationAgent.x).toBeCloseTo(
        squad.x + (formationSide.x * slot.side) + (formationForward.x * slot.front),
        6
      );
      expect(formationAgent.y).toBeCloseTo(
        squad.y + (formationSide.y * slot.side) + (formationForward.y * slot.front),
        6
      );
    };

    expect(formationAgent).toBeTruthy();
    expect(squad._crowdForward.x).toBeCloseTo(0, 6);
    expect(squad._crowdForward.y).toBeCloseTo(1, 6);
    expect(squad._crowdFormationForward.x).toBeCloseTo(1, 6);
    expect(squad._crowdFormationForward.y).toBeCloseTo(0, 6);
    expectFormationPosition();

    runtime.step(0.05);
    expect(squad._crowdForward.x).toBeCloseTo(0, 6);
    expect(squad._crowdForward.y).toBeCloseTo(1, 6);
    expect(squad._crowdFormationForward.x).toBeCloseTo(1, 6);
    expect(squad._crowdFormationForward.y).toBeCloseTo(0, 6);
    expectFormationPosition();
  });

  test('turns the formation and direction arc together while preserving their local offset', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    const group = runtime.getDeployGroupById(created.groupId, 'attacker');
    runtime.setDeployGroupRect(group.id, { facingRad: 0, width: 96 }, 'attacker');
    runtime.setDeployGroupDirection(group.id, Math.PI / 2, 'attacker');

    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    expect(runtime.commandMove(squad.id, { x: squad.x + 220, y: squad.y })).toBe(true);
    for (let index = 0; index < 16; index += 1) runtime.step(0.05);

    const movementYaw = Math.atan2(squad._crowdForward.y, squad._crowdForward.x);
    const expectedFacing = movementYaw - (Math.PI / 2);
    expect(Math.abs(squad._crowdForward.x)).toBeGreaterThan(0.1);
    expect(squad.formationRect.directionOffsetRad).toBeCloseTo(Math.PI / 2, 6);
    expect(squad.formationRect.directionRad).toBeCloseTo(movementYaw, 6);
    expect(squad.formationRect.facingRad).toBeLessThan(0);
    expect(squad.formationRect.facingRad).toBeGreaterThan(expectedFacing);
    expect(squad._crowdFormationForward.x).toBeCloseTo(Math.cos(squad.formationRect.facingRad), 6);
    expect(squad._crowdFormationForward.y).toBeCloseTo(Math.sin(squad.formationRect.facingRad), 6);
  });

  test('keeps every soldier in its slot through a single-direction marching turn', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    const group = runtime.getDeployGroupById(created.groupId, 'attacker');
    runtime.setDeployGroupRect(group.id, { facingRad: 0, width: 96 }, 'attacker');

    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    expect(runtime.commandMove(squad.id, { x: squad.x + 680, y: squad.y })).toBe(true);
    for (let index = 0; index < 12; index += 1) runtime.step(0.05);

    expect(runtime.setDeployGroupDirection(squad.id, Math.PI / 2, 'attacker')).toMatchObject({ ok: true });
    let largestSlotError = 0;
    let previousYaw = squad.formationRect.facingRad;
    const turnSteps = [];
    for (let index = 0; index < 80; index += 1) {
      runtime.step(0.05);
      const currentYaw = squad.formationRect.facingRad;
      const turnStep = currentYaw - previousYaw;
      if (Math.abs(turnStep) > 1e-6) turnSteps.push(turnStep);
      previousYaw = currentYaw;
      const agents = runtime.crowd.agentsBySquad.get(squad.id)
        .filter((agent) => !agent.dead && !agent.isFlagBearer);
      const formationForward = {
        x: Math.cos(currentYaw),
        y: Math.sin(currentYaw)
      };
      const formationSide = { x: -formationForward.y, y: formationForward.x };
      agents.forEach((agent) => {
        const slot = agent.formationSlot;
        const expectedX = squad.x + (formationSide.x * slot.side) + (formationForward.x * slot.front);
        const expectedY = squad.y + (formationSide.y * slot.side) + (formationForward.y * slot.front);
        largestSlotError = Math.max(largestSlotError, Math.hypot(agent.x - expectedX, agent.y - expectedY));
        expect(agent.yaw).toBeCloseTo(currentYaw, 6);
      });
    }

    expect(squad.waypoints.length).toBeGreaterThan(0);
    expect(squad.speed).toBeGreaterThan(0);
    expect(turnSteps.length).toBeGreaterThan(0);
    expect(turnSteps.every((step) => step <= 1e-6)).toBe(true);
    expect(largestSlotError).toBeLessThan(1e-5);
  });

  test('picks training deployment groups only from visible soldier-ring ranges', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    expect(result.ok).toBe(true);
    const group = runtime.getDeployGroupById(result.groupId, 'attacker');
    group.formationRect = { width: 120, depth: 20, facingRad: Math.PI / 2 };
    group.deploySlots = [
      { side: 0, front: -20 },
      { side: 0, front: 20 }
    ];
    const selectionRadius = resolveTrainingAgentSelectionRadius({ weight: 10 });

    expect(runtime.pickDeployGroup({ x: group.x, y: group.y + 20 + (selectionRadius * 0.9) }, 'attacker')).toBe(group);
    expect(runtime.pickDeployGroup({ x: group.x, y: group.y }, 'attacker')).toBeNull();
    expect(runtime.pickDeployGroup({ x: group.x, y: group.y + 20 + (selectionRadius * 1.1) }, 'attacker')).toBeNull();
    expect(runtime.pickDeployGroup({ x: group.x, y: group.y, valid: false }, 'attacker')).toBeNull();
  });

  test('keeps deployment-area selection valid after the camera is centered on the battlefield', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    expect(result.ok).toBe(true);
    const group = runtime.getDeployGroupById(result.groupId, 'attacker');
    const camera = new CameraController({ yawDeg: 45, pitchLow: 40, pitchHigh: 90, distance: 640 });
    camera.centerX = 0;
    camera.centerY = 0;
    camera.setPitchImmediate(40);
    camera.buildMatrices(1200, 720);

    const screen = camera.worldToScreen({ x: group.x, y: group.y, z: 0 }, { width: 1200, height: 720 });
    expect(screen.visible).toBe(true);
    const world = camera.screenToGround(screen.x, screen.y, { width: 1200, height: 720 });

    expect(world.valid).toBe(true);
    expect(world.x).toBeCloseTo(group.x, 4);
    expect(world.y).toBeCloseTo(group.y, 4);
    expect(runtime.pickDeployGroup(world, 'attacker')).toBe(group);
  });

  test('starts with only one placed side and keeps the phase running', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);

    expect(runtime.canStartBattle()).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);
    runtime.step(0.016);
    expect(runtime.getPhase()).toBe('battle');
  });

  test('has no countdown and does not time out during training', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    expect(runtime.getBattleStatus()).toMatchObject({ timeLimitSec: 0, timerSec: 0 });
    runtime.sim.timerSec = 0;
    runtime.step(0.05);

    expect(runtime.getPhase()).toBe('battle');
    expect(runtime.getBattleStatus().endReason).toBe('');
  });

  test('keeps the countdown in an actual battle', () => {
    const init = buildInit();
    init.mode = 'siege';
    init.timeLimitSec = 90;
    const runtime = new BattleRuntime(init);
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    expect(runtime.createDeployGroup('defender', {
      units: { infantry_basic: 20 },
      x: 450,
      y: 0,
      placed: true,
      controlMode: 'AI'
    }).ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    expect(runtime.getBattleStatus().timerSec).toBe(90);
    runtime.step(0.05);
    expect(runtime.getBattleStatus().timerSec).toBeCloseTo(89.95, 5);
  });

  test('allows a user-controlled defender to be selected and moved', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('defender', {
      units: { infantry_basic: 20 },
      x: 450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    });
    expect(result.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('defender_squad_1');
    expect(runtime.canControlSquad(squad)).toBe(true);
    expect(runtime.setSelectedBattleSquad(squad.id)).toBe(true);
    expect(runtime.commandMove(squad.id, { x: 300, y: 40 })).toBe(true);
  });

  test('AI-controlled defenders cannot receive user commands', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('defender', {
      units: { infantry_basic: 20 },
      x: 450,
      y: 0,
      placed: true,
      controlMode: 'AI'
    });
    expect(result.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.commandMove('defender_squad_1', { x: 300, y: 40 })).toBe(false);
  });

  test('AI-controlled defenders remain selectable and camera-followable', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('defender', {
      units: { infantry_basic: 20 },
      x: 450,
      y: 0,
      placed: true,
      controlMode: 'AI'
    });
    expect(result.ok).toBe(true);
    runtime.setSelectedDeployGroup(result.groupId);
    runtime.setFocusSquad(result.groupId);
    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('defender_squad_1');
    expect(runtime.canControlSquad(squad)).toBe(false);
    expect(runtime.setSelectedBattleSquad(squad.id)).toBe(true);
    runtime.setFocusSquad(squad.id);
    expect(runtime.getCardRows().find((row) => row.id === squad.id)?.selected).toBe(true);
    expect(runtime.getFocusAnchor()).toMatchObject({ squadId: squad.id });
    expect(runtime.commandMove(squad.id, { x: 300, y: 40 })).toBe(false);
  });

  test('can hand any training squad between AI and user control during battle', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('defender', {
      units: { infantry_basic: 20 },
      x: 450,
      y: 0,
      placed: true,
      controlMode: 'AI'
    });
    expect(result.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('defender_squad_1');
    expect(runtime.canControlSquad(squad)).toBe(false);

    expect(runtime.setTrainingBattleSquadControlMode(squad.id, 'USER')).toMatchObject({
      ok: true,
      squadId: squad.id,
      controlMode: 'USER'
    });
    expect(runtime.canControlSquad(squad)).toBe(true);
    expect(runtime.getCardRows().find((row) => row.id === squad.id)?.selected).toBe(true);
    expect(runtime.commandMove(squad.id, { x: 300, y: 40 })).toBe(true);

    expect(runtime.setTrainingBattleSquadControlMode(squad.id, 'AI')).toMatchObject({
      ok: true,
      squadId: squad.id,
      controlMode: 'AI'
    });
    expect(runtime.canControlSquad(squad)).toBe(false);
    expect(squad.behavior).toBe('auto');
    expect(runtime.commandMove(squad.id, { x: 300, y: 40 })).toBe(false);
  });

  test('canceling placement keeps the card but removes its map preview', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true
    });
    expect(result.ok).toBe(true);
    expect(runtime.cancelDeployGroupPlacement('attacker', result.groupId).ok).toBe(true);
    expect(runtime.getCardRows().find((row) => row.id === result.groupId)?.placed).toBe(false);
    expect(runtime.getDeployGroupById(result.groupId, 'attacker')).toMatchObject({
      id: result.groupId,
      placed: false,
      placementActive: false
    });
    expect(runtime.getMinimapSnapshot().squads).toHaveLength(0);
    expect(runtime.getRenderSnapshot().units.count).toBe(0);
  });

  test('writes a deployment hover flag without replacing the selected flag', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -420,
      y: 0,
      placed: true
    });
    expect(result.ok).toBe(true);

    runtime.clearSelection();
    runtime.setHoveredDeployGroup(result.groupId);
    let snapshot = runtime.getRenderSnapshot();
    expect(snapshot.units.data[12]).toBe(0);
    expect(snapshot.units.data[15]).toBe(1);

    runtime.setSelectedDeployGroup(result.groupId);
    snapshot = runtime.getRenderSnapshot();
    expect(snapshot.units.data[12]).toBe(1);
    expect(snapshot.units.data[15]).toBe(0);
  });

  test('uses a single flagged marker until an active training group fully enters its own deployment zone', () => {
    const runtime = new BattleRuntime(buildInit());
    const attacker = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -480,
      y: 0,
      placed: false
    });
    const defender = runtime.createDeployGroup('defender', {
      units: { infantry_basic: 100 },
      x: 480,
      y: 0,
      placed: false
    });
    expect(attacker.ok).toBe(true);
    expect(defender.ok).toBe(true);

    runtime.moveDeployGroup(attacker.groupId, { x: 0, y: 0 }, 'attacker');
    runtime.moveDeployGroup(defender.groupId, { x: 0, y: 0 }, 'defender');
    const markerSnapshot = runtime.getRenderSnapshot();
    const markerCount = markerSnapshot.units.count;
    expect(markerCount).toBe(2);
    expect(markerSnapshot.units.data[13]).toBe(1);
    expect(markerSnapshot.units.data[14]).toBe(1);
    expect(markerSnapshot.units.data[20 + 13]).toBe(1);
    expect(markerSnapshot.units.data[20 + 14]).toBe(1);

    runtime.moveDeployGroup(attacker.groupId, { x: -480, y: 0 }, 'attacker');
    runtime.moveDeployGroup(defender.groupId, { x: 480, y: 0 }, 'defender');
    expect(runtime.canDeployGroupFitAt(attacker.groupId, runtime.getDeployGroupById(attacker.groupId), 'attacker')).toBe(true);
    expect(runtime.canDeployGroupFitAt(defender.groupId, runtime.getDeployGroupById(defender.groupId), 'defender')).toBe(true);
    const formationSnapshot = runtime.getRenderSnapshot();
    const attackerSlots = runtime.getDeployGroupById(attacker.groupId)?.deploySlots?.length || 0;
    const defenderSlots = runtime.getDeployGroupById(defender.groupId)?.deploySlots?.length || 0;
    expect(formationSnapshot.units.count).toBe(attackerSlots + defenderSlots);
    expect(formationSnapshot.units.count).toBeGreaterThan(markerCount);
  });

  test('resets a training session to the exact pre-start deployment state', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 30 },
      x: -420,
      y: 64,
      placed: true,
      controlMode: 'USER'
    });
    expect(created.ok).toBe(true);
    expect(runtime.setDeployGroupSkillSlots(created.groupId, [{
      slotIndex: 0,
      treeCategory: 'melee',
      skillId: 'melee_heavy_blow'
    }]).ok).toBe(true);

    expect(runtime.startBattle().ok).toBe(true);
    runtime.adjustTrainingSkillPoints(8);
    const squad = runtime.getSquadById('attacker_squad_1');
    squad.x = 120;
    squad.y = -140;

    expect(runtime.resetTraining().ok).toBe(true);
    expect(runtime.getPhase()).toBe('deploy');
    expect(runtime.getTrainingSquadSkillPointState(created.groupId).points).toBe(0);
    const restored = runtime.getDeployGroupById(created.groupId, 'attacker');
    expect(restored.x).toBe(-420);
    expect(restored.y).toBe(64);
    expect(restored.skillSlots[0].skillId).toBe('melee_heavy_blow');
  });

  test('clears deployment selection when resetting a training session', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 30 },
      x: -420,
      y: 0,
      placed: true,
      controlMode: 'USER'
    });
    expect(created.ok).toBe(true);
    runtime.setSelectedDeployGroup(created.groupId);
    runtime.setFocusSquad(created.groupId);

    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.resetTraining().ok).toBe(true);

    expect(runtime.getDeployGroups().selectedId).toBe('');
    expect(runtime.getCardRows().some((row) => row.selected)).toBe(false);
  });

  test('stops exposing a camera follow target after clearing training selection', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    runtime.clearSelection();

    expect(runtime.getFocusAnchor()).toBeNull();
  });

  test('starts training unbound when no deployment group is selected', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    runtime.clearSelection();

    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.getFocusAnchor()).toBeNull();
    expect(runtime.getCardRows().some((row) => row.selected)).toBe(false);
  });

  test('unbinds instead of falling through to another squad when the focused squad is gone', () => {
    const runtime = new BattleRuntime(buildInit());
    const first = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: -50,
      placed: true,
      controlMode: 'USER'
    });
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 50,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    runtime.setSelectedDeployGroup(first.groupId);
    runtime.setFocusSquad(first.groupId);

    expect(runtime.startBattle().ok).toBe(true);
    const focusedSquad = runtime.getSquadById('attacker_squad_1');
    expect(runtime.getFocusAnchor()?.squadId).toBe(focusedSquad.id);

    focusedSquad.remain = 0;
    runtime.updateCameraAnchor(0);

    expect(runtime.getFocusAnchor()).toBeNull();
    expect(runtime.focusSquadId).toBe('');
    expect(runtime.selectedBattleSquadId).toBe('');
  });

  test('keeps a pocket formation skeleton while changing soldier spacing', () => {
    const init = buildInit();
    init.attacker.rosterUnits = [{ unitTypeId: 'infantry_basic', count: 200 }];
    const runtime = new BattleRuntime(init);
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 200 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER',
      templateFormations: [{
        formationId: 'pocket',
        name: '口袋阵',
        placements: [
          { unitTypeId: 'infantry_basic', x: 0, y: 0 },
          { unitTypeId: 'infantry_basic', x: 2, y: 0 },
          { unitTypeId: 'infantry_basic', x: 0, y: 1 },
          { unitTypeId: 'infantry_basic', x: 2, y: 1 }
        ]
      }],
      activeFormationId: 'pocket'
    });
    expect(created.ok).toBe(true);
    runtime.setSelectedDeployGroup(created.groupId);
    runtime.setFocusSquad(created.groupId);

    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    const agents = runtime.crowd.agentsBySquad.get(squad.id);
    const upperLeft = agents.find((agent) => agent.formationSlot.side < 0 && agent.formationSlot.front > 0);
    const upperRight = agents.find((agent) => agent.formationSlot.side > 0 && agent.formationSlot.front > 0);
    const lowerLeft = agents.find((agent) => agent.formationSlot.side < 0 && agent.formationSlot.front < 0);
    const standardPocketWidth = upperRight.formationSpacingSlots.standard.side - upperLeft.formationSpacingSlots.standard.side;
    const compactPocketWidth = upperRight.formationSpacingSlots.compact.side - upperLeft.formationSpacingSlots.compact.side;
    const standardRankGap = upperLeft.formationSpacingSlots.standard.front - lowerLeft.formationSpacingSlots.standard.front;
    const compactRankGap = upperLeft.formationSpacingSlots.compact.front - lowerLeft.formationSpacingSlots.compact.front;

    expect(squad.formationSpacing).toBe('standard');
    expect(compactPocketWidth).toBeCloseTo(standardPocketWidth, 6);
    expect(compactRankGap).toBeCloseTo(standardRankGap * 0.76, 6);
    expect(runtime.commandFormationSpacing(squad.id, 'loose')).toBe(true);
    expect(squad.formationSpacing).toBe('loose');
    expect(squad.speedPolicy).toBe('MARCH');
  });

  test('settles a compact formation after changing spacing and stopping', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 30 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    });
    expect(created.ok).toBe(true);
    runtime.setSelectedDeployGroup(created.groupId);
    runtime.setFocusSquad(created.groupId);
    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('attacker_squad_1');
    for (let index = 0; index < 180; index += 1) runtime.step(0.016);
    expect(runtime.commandFormationSpacing(squad.id, 'compact')).toBe(true);
    for (let index = 0; index < 300; index += 1) runtime.step(0.016);
    expect(runtime.commandMove(squad.id, { x: -412, y: 12 })).toBe(true);
    for (let index = 0; index < 600; index += 1) runtime.step(0.016);

    const agents = runtime.crowd.agentsBySquad.get(squad.id).filter((agent) => !agent.isFlagBearer);
    const settled = new Map(agents.map((agent) => [agent.id, { x: agent.x, y: agent.y }]));
    for (let index = 0; index < 120; index += 1) runtime.step(0.016);

    const maxDrift = Math.max(...agents.map((agent) => {
      const previous = settled.get(agent.id);
      return Math.hypot(agent.x - previous.x, agent.y - previous.y);
    }));
    const maxSpeed = Math.max(...agents.map((agent) => Math.hypot(agent.vx, agent.vy)));
    expect(maxDrift).toBeLessThan(0.02);
    expect(maxSpeed).toBeLessThan(0.02);
  });

  test('tracks configured slot cooldowns and training skill points independently', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 30 },
      x: -420,
      y: 0,
      placed: true,
      controlMode: 'USER'
    });
    expect(runtime.setDeployGroupSkillSlots(created.groupId, [{
      slotIndex: 0,
      treeCategory: 'melee',
      skillId: 'melee_heavy_blow'
    }]).ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    const squadId = 'attacker_squad_1';
    const metaBefore = runtime.getSkillMetaForSquad(squadId).skills[0];
    expect(metaBefore.name).toBe('集体重击');
    expect(metaBefore.available).toBe(true);
    expect(runtime.commandSkillSlot(squadId, 0, { x: 20, y: 0 }).ok).toBe(true);
    const cooldownAfterCast = runtime.getSkillMetaForSquad(squadId).skills[0].cooldownRemain;
    expect(cooldownAfterCast).toBeGreaterThan(17);

    runtime.step(1);
    expect(runtime.getSkillMetaForSquad(squadId).skills[0].cooldownRemain).toBeLessThan(cooldownAfterCast);
    expect(runtime.adjustTrainingSquadSkillPoints(squadId, 1).ok).toBe(true);
    expect(runtime.unlockTrainingSkill(squadId, 'melee', 'melee_rapid_slash').ok).toBe(true);
    expect(runtime.getTrainingSkillTreeProgress(squadId, 'melee').levels.melee_rapid_slash).toBe(1);
    expect(runtime.adjustTrainingSquadSkillPoints(squadId, 2).ok).toBe(true);
    expect(runtime.upgradeTrainingSkill(squadId, 'melee', 'melee_rapid_slash').ok).toBe(true);
    expect(runtime.getTrainingSkillTreeProgress(squadId, 'melee').levels.melee_rapid_slash).toBe(2);
    expect(runtime.equipTrainingSkill(squadId, 0, 'melee_rapid_slash').ok).toBe(true);
  });

  test('starts each default training tree with only its root and first active skill learned', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -440,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);

    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.getTrainingSkillTreeProgress('attacker_squad_1', 'melee').unlocked).toEqual([
      'melee_war_form',
      'melee_heavy_blow'
    ]);
  });

  test('awards skill points to each controllable troop only after auto gain is enabled', () => {
    const runtime = new BattleRuntime(buildInit());
    const first = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -440,
      y: 0,
      placed: true,
      controlMode: 'USER'
    });
    const second = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -360,
      y: 0,
      placed: true,
      controlMode: 'AI'
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.setTrainingSkillPointInterval(10).ok).toBe(true);

    for (let index = 0; index < 200; index += 1) runtime.step(0.05);

    expect(runtime.getTrainingSquadSkillPointState('attacker_squad_1').points).toBe(0);
    expect(runtime.setTrainingAutoSkillPointGainEnabled(true).ok).toBe(true);
    for (let index = 0; index < 200; index += 1) runtime.step(0.05);

    expect(runtime.getTrainingSquadSkillPointState('attacker_squad_1').points).toBe(1);
    expect(runtime.getTrainingSquadSkillPointState('attacker_squad_2').points).toBe(0);
    expect(runtime.getTrainingState().autoSkillPointGainEnabled).toBe(true);
    expect(runtime.getTrainingState().pointIntervalSec).toBe(10);
  });

  test('picks training hover from a living soldier instead of a squad center radius', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 1 },
      x: -440,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('attacker_squad_1');
    const [agent] = runtime.crowd.agentsBySquad.get(squad.id);
    const selectionRadius = resolveTrainingAgentSelectionRadius(agent);

    expect(runtime.pickSquadAtAgentPoint(agent.x, agent.y, { team: 'any' })).toBe(squad.id);
    expect(runtime.pickSquadAtAgentPoint(
      agent.x + (selectionRadius * 0.95),
      agent.y,
      { team: 'any' }
    )).toBe(squad.id);
    expect(runtime.pickSquadAtAgentPoint(
      agent.x + (selectionRadius * 1.05),
      agent.y,
      { team: 'any' }
    )).toBe('');
    expect(runtime.pickSquadAtAgentPoint(agent.x + 16, agent.y, { team: 'any' })).toBe('');
  });

  test('captures bounded performance metrics with training-map context', () => {
    const runtime = new BattleRuntime(buildThreeLaneMapInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    expect(runtime.startPerformanceCapture({
      scenario: '20-unit-pathing',
      metadata: { viewport: { width: 1440, height: 900, devicePixelRatio: 1 } }
    })).toMatchObject({ active: true, scenario: '20-unit-pathing' });
    runtime.setRenderMs(3.5);
    runtime.setFps(60);
    runtime.step(0.05);

    const debugStats = runtime.getDebugStats();
    expect(debugStats.performanceCapture).toMatchObject({
      active: true,
      scenario: '20-unit-pathing',
      sampleCounts: { simulationMs: 1, renderMs: 1, fps: 1 }
    });

    const report = runtime.stopPerformanceCapture();
    expect(report.capture).toMatchObject({
      active: false,
      scenario: '20-unit-pathing',
      metadata: { viewport: { width: 1440, height: 900, devicePixelRatio: 1 } }
    });
    expect(report.context.start).toMatchObject({
      mapId: 'training-three-lane',
      squadCount: 1,
      buildingCount: 3
    });
    expect(report.context.end.representativeAgentCount).toBeGreaterThan(0);
    expect(report.metrics).toMatchObject({
      simulationMs: { count: 1 },
      renderMs: { count: 1, average: 3.5 },
      fps: { count: 1, average: 60 }
    });
  });
});
