import {
  getTrainingMapBalancedDeploySlots,
  getTrainingMapSpawnRegions,
  getTrainingMapSpawnRegionAtPoint,
  isTrainingMapSpawnPoint,
  resolveTrainingMapSpawnMetadata
} from './trainingMapSpawn';

const field = { width: 1000, height: 800 };

const buildMapConfig = () => ({
  mapId: 'training-spawn-test',
  mapVersion: 1,
  layoutMeta: { fieldWidth: field.width, fieldHeight: field.height },
  spawnRegions: [
    {
      id: 'attacker-top',
      team: 'attacker',
      laneAffinity: 'top',
      renderFootprintScale: 1.16,
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
  ],
  deploySlots: [
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
  ]
});

describe('training map spawn helpers', () => {
  test('accepts only the owning team highland and derives its route metadata', () => {
    const mapConfig = buildMapConfig();
    const point = { x: -400, y: 200 };

    expect(getTrainingMapSpawnRegions(mapConfig, { field, team: 'attacker' })[0].polygon[1]).toEqual({
      x: -268,
      y: 200
    });

    expect(isTrainingMapSpawnPoint(mapConfig, point, { field, team: 'attacker' })).toBe(true);
    expect(isTrainingMapSpawnPoint(mapConfig, point, { field, team: 'defender' })).toBe(false);
    expect(isTrainingMapSpawnPoint(mapConfig, { x: 0, y: 0 }, { field, team: 'attacker' })).toBe(false);
    expect(getTrainingMapSpawnRegionAtPoint(mapConfig, point, { field, team: 'attacker' })).toMatchObject({
      id: 'attacker-top',
      laneId: 'top'
    });
    expect(resolveTrainingMapSpawnMetadata(mapConfig, point, { field, team: 'attacker' })).toMatchObject({
      spawnRegionId: 'attacker-top',
      spawnLaneId: 'top',
      initialFacingRad: 0
    });
  });

  test('uses the runtime highland outline for curved deployment edges', () => {
    const mapConfig = buildMapConfig();
    const curvedOutline = [
      { x: -500, y: 320 },
      { x: -360, y: 300 },
      { x: -300, y: 200 },
      { x: -360, y: 100 },
      { x: -500, y: 80 }
    ];
    mapConfig.terrainRegions = [{
      id: 'terrain-highland-attacker-top',
      sourceRegionId: 'attacker-top',
      points: curvedOutline
    }];

    expect(getTrainingMapSpawnRegions(mapConfig, { field, team: 'attacker' })[0].polygon).toEqual(curvedOutline);
    expect(isTrainingMapSpawnPoint(mapConfig, { x: -380, y: 280 }, { field, team: 'attacker' })).toBe(true);
  });

  test('uses only the highland top surface for deployment', () => {
    const mapConfig = buildMapConfig();
    const footprint = [
      { x: -500, y: 320 },
      { x: -280, y: 320 },
      { x: -280, y: 80 },
      { x: -500, y: 80 }
    ];
    const topSurface = [
      { x: -500, y: 280 },
      { x: -360, y: 280 },
      { x: -360, y: 120 },
      { x: -500, y: 120 }
    ];
    mapConfig.terrainRegions = [{
      id: 'terrain-highland-attacker-top',
      sourceRegionId: 'attacker-top',
      points: footprint,
      topPolygons: [topSurface]
    }];

    expect(getTrainingMapSpawnRegions(mapConfig, { field, team: 'attacker' })[0].polygon).toEqual(topSurface);
    expect(isTrainingMapSpawnPoint(mapConfig, { x: -420, y: 200 }, { field, team: 'attacker' })).toBe(true);
    expect(isTrainingMapSpawnPoint(mapConfig, { x: -300, y: 200 }, { field, team: 'attacker' })).toBe(false);
  });

  test('uses a seed-stable alternating highland assignment', () => {
    const mapConfig = buildMapConfig();
    const first = getTrainingMapBalancedDeploySlots(mapConfig, 'attacker', { field, seed: 'match-42' });
    const repeated = getTrainingMapBalancedDeploySlots(mapConfig, 'attacker', { field, seed: 'match-42' });

    expect(first).toEqual(repeated);
    expect(first).toHaveLength(6);
    expect(first.map((slot) => slot.spawnRegionId)).toEqual(expect.arrayContaining([
      'attacker-top',
      'attacker-bottom'
    ]));
    expect(first.slice(0, 4).map((slot) => slot.spawnRegionId)).toEqual([
      first[0].spawnRegionId,
      first[1].spawnRegionId,
      first[0].spawnRegionId,
      first[1].spawnRegionId
    ]);
  });
});
