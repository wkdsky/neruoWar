import BattleRuntime from './BattleRuntime';
import { isTrainingMapSpawnPoint } from '../../shared/trainingMapSpawn';

const field = { width: 1000, height: 800 };

const spawnRegions = [
  {
    id: 'attacker-top',
    team: 'attacker',
    laneAffinity: 'top',
    normalizedPolygon: [[0, 0.1], [0.2, 0.25], [0, 0.4]]
  },
  {
    id: 'attacker-bottom',
    team: 'attacker',
    laneAffinity: 'bottom',
    normalizedPolygon: [[0, 0.6], [0.2, 0.75], [0, 0.9]]
  },
  {
    id: 'defender-top',
    team: 'defender',
    laneAffinity: 'top',
    normalizedPolygon: [[1, 0.1], [0.8, 0.25], [1, 0.4]]
  },
  {
    id: 'defender-bottom',
    team: 'defender',
    laneAffinity: 'bottom',
    normalizedPolygon: [[1, 0.6], [0.8, 0.75], [1, 0.9]]
  }
];

const deploySlots = [
  { id: 'atk-top-1', team: 'attacker', laneId: 'top', spawnRegionId: 'attacker-top', x: -440, y: 280 },
  { id: 'atk-top-2', team: 'attacker', laneId: 'top', spawnRegionId: 'attacker-top', x: -400, y: 200 },
  { id: 'atk-top-3', team: 'attacker', laneId: 'top', spawnRegionId: 'attacker-top', x: -440, y: 120 },
  { id: 'atk-bottom-1', team: 'attacker', laneId: 'bottom', spawnRegionId: 'attacker-bottom', x: -440, y: -120 },
  { id: 'atk-bottom-2', team: 'attacker', laneId: 'bottom', spawnRegionId: 'attacker-bottom', x: -400, y: -200 },
  { id: 'atk-bottom-3', team: 'attacker', laneId: 'bottom', spawnRegionId: 'attacker-bottom', x: -440, y: -280 },
  { id: 'def-top-1', team: 'defender', laneId: 'top', spawnRegionId: 'defender-top', x: 440, y: 280 },
  { id: 'def-top-2', team: 'defender', laneId: 'top', spawnRegionId: 'defender-top', x: 400, y: 200 },
  { id: 'def-top-3', team: 'defender', laneId: 'top', spawnRegionId: 'defender-top', x: 440, y: 120 },
  { id: 'def-bottom-1', team: 'defender', laneId: 'bottom', spawnRegionId: 'defender-bottom', x: 440, y: -120 },
  { id: 'def-bottom-2', team: 'defender', laneId: 'bottom', spawnRegionId: 'defender-bottom', x: 400, y: -200 },
  { id: 'def-bottom-3', team: 'defender', laneId: 'bottom', spawnRegionId: 'defender-bottom', x: 440, y: -280 }
];

const buildInit = ({ seed = 'match-42', attackerDeployUnits = [] } = {}) => ({
  mode: 'training',
  rules: { allowCrossMidline: true, maxDeployGroupTotal: 10000, trainingSpawnSeed: seed },
  battlefield: {
    layoutMeta: { fieldWidth: field.width, fieldHeight: field.height },
    map: {
      mapId: 'training-highland-spawn-test',
      mapVersion: 1,
      activePresetId: 'full',
      defaultPresetId: 'full',
      presets: [{ id: 'full', label: '完整地图', enabledTags: [] }],
      terrainRegions: [{ id: 'grass', type: 'grass', shape: 'rect', x: 0, y: 0, width: field.width, height: field.height }],
      spawnRegions,
      lanes: [
        { id: 'top', centerY: 200, width: 100 },
        { id: 'bottom', centerY: -200, width: 100 }
      ],
      deploySlots,
      navigation: { cellSize: 32, wallClearance: 8, maxSearchNodes: 300 },
      objects: [],
      objectives: []
    },
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
    rosterUnits: [{ unitTypeId: 'infantry_basic', count: 1000 }],
    deployUnits: attackerDeployUnits
  },
  defender: {
    rosterUnits: [{ unitTypeId: 'infantry_basic', count: 1000 }],
    deployUnits: []
  }
});

const createGroups = (runtime, team, count = 4) => (
  Array.from({ length: count }, () => {
    const created = runtime.createDeployGroup(team, {
      units: { infantry_basic: 20 },
      placed: true
    });
    return runtime.getDeployGroupById(created.groupId, team);
  })
);

describe('BattleRuntime highland deployment', () => {
  test('assigns both teams to reproducible, non-overlapping highland slots', () => {
    const firstRuntime = new BattleRuntime(buildInit());
    const secondRuntime = new BattleRuntime(buildInit());
    const firstAttacker = createGroups(firstRuntime, 'attacker');
    const firstDefender = createGroups(firstRuntime, 'defender');
    const secondAttacker = createGroups(secondRuntime, 'attacker');

    firstAttacker.forEach((group) => {
      expect(isTrainingMapSpawnPoint(firstRuntime.getTrainingMapConfig(), group, { field, team: 'attacker' })).toBe(true);
      expect(group.spawnLaneId).toMatch(/top|bottom/);
      expect(group.formationRect.facingRad).toBe(0);
    });
    firstDefender.forEach((group) => {
      expect(isTrainingMapSpawnPoint(firstRuntime.getTrainingMapConfig(), group, { field, team: 'defender' })).toBe(true);
      expect(group.spawnLaneId).toMatch(/top|bottom/);
      expect(group.formationRect.facingRad).toBe(Math.PI);
    });
    expect(new Set(firstAttacker.map((group) => `${group.x}:${group.y}`)).size).toBe(firstAttacker.length);
    expect(firstAttacker.map((group) => [group.x, group.y, group.spawnRegionId]))
      .toEqual(secondAttacker.map((group) => [group.x, group.y, group.spawnRegionId]));
    expect(firstRuntime.startBattle()).toMatchObject({ ok: true });
    const spawnedSquad = firstRuntime.getSquadById('attacker_squad_1');
    const spawnedCard = firstRuntime.getCardRows().find((card) => card.id === spawnedSquad.id);

    expect(spawnedSquad).toMatchObject({
      spawnRegionId: firstAttacker[0].spawnRegionId,
      spawnLaneId: firstAttacker[0].spawnLaneId
    });
    expect(spawnedSquad.formationRect.facingRad).toBe(0);
    expect(spawnedCard.laneId).toBe(firstAttacker[0].spawnLaneId);
  });

  test('keeps a valid manual highland position and rejects the opposing side, overlap, and tower interior', () => {
    const runtime = new BattleRuntime(buildInit());
    const first = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -400,
      y: 200,
      placed: true
    });
    const firstGroup = runtime.getDeployGroupById(first.groupId, 'attacker');

    expect(first.ok).toBe(true);
    expect(firstGroup).toMatchObject({ x: -400, y: 200, spawnLaneId: 'top' });
    expect(runtime.moveDeployGroup(first.groupId, { x: 400, y: 200 }, 'attacker')).toBe(false);
    expect(firstGroup).toMatchObject({ x: -400, y: 200 });
    runtime.initialBuildings.push({ id: 'tower-blocker', x: -440, y: 280, width: 48, depth: 48, blocksMovement: true });
    expect(runtime.canDeployAt({ x: -440, y: 280 }, 'attacker')).toBe(false);

    const second = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -400,
      y: 200,
      placed: true
    });
    const secondGroup = runtime.getDeployGroupById(second.groupId, 'attacker');

    expect(second.ok).toBe(true);
    expect([secondGroup.x, secondGroup.y]).not.toEqual([firstGroup.x, firstGroup.y]);
    expect(runtime.canDeployGroupFitAt(first.groupId, { x: -400, y: 200 }, 'attacker')).toBe(true);
  });

  test('repairs invalid saved positions and keeps the repaired position after a reload', () => {
    const runtime = new BattleRuntime(buildInit({
      attackerDeployUnits: [{
        armyId: 'saved-attacker',
        units: { infantry_basic: 20 },
        x: 0,
        y: 0,
        placed: true
      }]
    }));
    const repaired = runtime.getDeployGroupById('saved-attacker', 'attacker');
    const reloaded = new BattleRuntime(buildInit({
      attackerDeployUnits: [{
        armyId: 'saved-attacker',
        units: { infantry_basic: 20 },
        x: repaired.x,
        y: repaired.y,
        placed: true,
        spawnSlotId: repaired.spawnSlotId,
        spawnRegionId: repaired.spawnRegionId,
        spawnLaneId: repaired.spawnLaneId
      }]
    }));
    const restored = reloaded.getDeployGroupById('saved-attacker', 'attacker');

    expect(isTrainingMapSpawnPoint(runtime.getTrainingMapConfig(), repaired, { field, team: 'attacker' })).toBe(true);
    expect(restored).toMatchObject({ x: repaired.x, y: repaired.y, spawnRegionId: repaired.spawnRegionId });
  });
});
