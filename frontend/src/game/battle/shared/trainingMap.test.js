import {
  normalizeTrainingMapConfig,
  resolveTrainingMapLane,
  resolveTrainingMapTerrainElevation,
  sampleTrainingMapTerrain
} from './trainingMap';

describe('training map contract normalization', () => {
  test('keeps reference geometry and spawn regions for the renderer debug overlay', () => {
    const mapConfig = normalizeTrainingMapConfig({
      map: {
        mapId: 'training-war-map-v1',
        mapVersion: 1,
        movementCalibration: {
          targetTravelSeconds: 8,
          expectedTravelSeconds: 7.9
        },
        defaultPresetId: 'full-jungle',
        presets: [{ id: 'full-jungle', label: '完整野区对抗', enabledTags: [] }],
        spawnRegions: [{ id: 'spawn-attacker-top', team: 'attacker' }],
        referenceGeometry: {
          debugOverlay: {
            referenceImage: { url: '/training-war-map-v1-reference.png' }
          }
        }
      }
    });

    expect(mapConfig.enabled).toBe(true);
    expect(mapConfig.spawnRegions).toEqual([{ id: 'spawn-attacker-top', team: 'attacker' }]);
    expect(mapConfig.movementCalibration).toMatchObject({ targetTravelSeconds: 8 });
    expect(mapConfig.referenceGeometry).toEqual({
      debugOverlay: {
        referenceImage: { url: '/training-war-map-v1-reference.png' }
      }
    });
  });
});

describe('training map terrain elevation', () => {
  test('returns the elevated highland surface only inside its polygon', () => {
    const mapConfig = {
      terrainRegions: [{
        id: 'highland',
        type: 'highland-attacker',
        shape: 'polygon',
        z: 0.08,
        elevation: 28,
        points: [{ x: -100, y: -100 }, { x: 100, y: 0 }, { x: -100, y: 100 }]
      }]
    };

    expect(resolveTrainingMapTerrainElevation(mapConfig, { x: -40, y: 0 })).toBeCloseTo(28.08);
    expect(resolveTrainingMapTerrainElevation(mapConfig, { x: 140, y: 0 })).toBe(0);
  });

  test('interpolates a vertex ramp from ground level to the highland plateau', () => {
    const mapConfig = {
      terrainRegions: [{
        id: 'highland-ramp',
        type: 'highland-attacker',
        shape: 'polygon',
        z: 0.08,
        elevation: 28,
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }],
        ramps: [{
          id: 'ramp-1',
          points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 50 }]
        }]
      }]
    };

    expect(resolveTrainingMapTerrainElevation(mapConfig, { x: 12.5, y: 12.5 })).toBeCloseTo(14.08);
    expect(resolveTrainingMapTerrainElevation(mapConfig, { x: 70, y: 10 })).toBeCloseTo(28.08);
  });
});

describe('training map terrain sampling', () => {
  const field = { width: 600, height: 400 };
  const mapConfig = {
    navigation: {
      roadCost: 0.68,
      grassCost: 1,
      sandCost: 1.1,
      highlandCost: 1.05,
      outsideBattlefieldWalkable: false
    },
    lanes: [{
      id: 'mid',
      width: 60,
      centerline: [{ x: -300, y: 0 }, { x: 300, y: 0 }]
    }],
    terrainRegions: [
      { id: 'grass-main', type: 'grass', shape: 'rect', x: 0, y: 0, width: 600, height: 400, walkable: true },
      { id: 'sand-central', type: 'sand', shape: 'rect', x: 0, y: 0, width: 120, height: 400, walkable: true },
      {
        id: 'highland-attacker',
        type: 'highland-attacker',
        shape: 'polygon',
        points: [{ x: -280, y: -80 }, { x: -120, y: 0 }, { x: -280, y: 80 }],
        elevation: 28,
        z: 0.08,
        walkable: true
      }
    ]
  };

  test('keeps surface metadata while giving every in-bounds terrain equal movement cost', () => {
    expect(sampleTrainingMapTerrain(mapConfig, { x: 0, y: 0 }, { field })).toMatchObject({
      type: 'road',
      baseType: 'sand',
      laneId: 'mid',
      walkable: true,
      movementCost: 1,
      isCentralSand: true
    });
  });

  test('reports highland elevation and rejects positions outside the battlefield', () => {
    expect(sampleTrainingMapTerrain(mapConfig, { x: -190, y: 34 }, { field })).toMatchObject({
      type: 'highland-attacker',
      elevation: 28.08,
      walkable: true
    });
    expect(sampleTrainingMapTerrain(mapConfig, { x: 320, y: 0 }, { field }).walkable).toBe(false);
  });
});

describe('training map lane advancement', () => {
  const mapConfig = {
    lanes: [
      {
        id: 'top',
        centerY: 900,
        width: 90,
        attackerDirection: 'left-to-right',
        centerline: [
          { x: -300, y: 100 },
          { x: -100, y: 180 },
          { x: 120, y: 180 },
          { x: 300, y: 100 }
        ]
      },
      {
        id: 'bottom',
        centerY: 100,
        width: 90,
        centerline: [
          { x: -300, y: -120 },
          { x: 300, y: -120 }
        ]
      }
    ]
  };

  test('resolves a lane from its navigation centerline rather than visual center Y alone', () => {
    expect(resolveTrainingMapLane(mapConfig, { x: -300, y: 100 }, '')).toBe('top');
  });

});
