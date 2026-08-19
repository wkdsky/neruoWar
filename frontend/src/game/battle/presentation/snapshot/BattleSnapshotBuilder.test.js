import BattleSnapshotBuilder from './BattleSnapshotBuilder';

describe('BattleSnapshotBuilder map-wall rendering', () => {
  test('leaves all reference wall paths to the dedicated path renderer', () => {
    const builder = new BattleSnapshotBuilder();
    const snapshot = builder.build({
      phase: 'deploy',
      intelVisible: true,
      attackerDeployGroups: [],
      defenderDeployGroups: [],
      initialBuildings: [
        {
          id: 'ordinary-wall',
          mapStatic: true,
          category: 'wall',
          geometryKind: 'ordinaryWall',
          visualPath: [{ x: -80, y: 0 }, { x: 0, y: 16 }, { x: 80, y: 0 }],
          hp: 1450,
          maxHp: 1450,
          colliderParts: [{ cx: 0, cy: 0, cz: 17, w: 160, d: 24, h: 34, yawDeg: 0 }]
        },
        {
          id: 'high-wall',
          mapStatic: true,
          category: 'wall',
          geometryKind: 'highWall',
          visualPath: [{ x: 0, y: -80 }, { x: 0, y: 80 }],
          hp: 2600,
          maxHp: 2600,
          colliderParts: [{ cx: 0, cy: 0, cz: 36, w: 160, d: 36, h: 72, yawDeg: 90 }]
        },
        {
          id: 'reference-tower',
          mapStatic: true,
          category: 'tower',
          hp: 2200,
          maxHp: 2200,
          colliderParts: [{ cx: 160, cy: 0, cz: 48, w: 58, d: 58, h: 96, yawDeg: 0 }]
        },
        {
          id: 'reference-camp',
          mapStatic: true,
          category: 'neutralCamp',
          hp: 1200,
          maxHp: 1200,
          colliderParts: [{ cx: -160, cy: 0, cz: 21, w: 62, d: 62, h: 42, yawDeg: 0 }]
        }
      ]
    });

    expect(snapshot.buildings.count).toBe(0);
  });

  test('projects deployment units onto an elevated highland surface', () => {
    const builder = new BattleSnapshotBuilder();
    const snapshot = builder.build({
      phase: 'deploy',
      intelVisible: true,
      getTrainingMapConfig: () => ({
        terrainRegions: [{
          type: 'highland-attacker',
          shape: 'polygon',
          z: 0.08,
          elevation: 28,
          points: [{ x: -100, y: -100 }, { x: 100, y: 0 }, { x: -100, y: 100 }]
        }]
      }),
      attackerDeployGroups: [{
        id: 'attacker-group',
        team: 'attacker',
        x: -40,
        y: 0,
        placed: true,
        units: { infantry: 1 },
        deploySlots: [{ side: 0, front: 0 }]
      }],
      defenderDeployGroups: [],
      initialBuildings: [{
        id: 'highland-tower',
        hp: 1200,
        maxHp: 1200,
        colliderParts: [{ cx: -40, cy: 0, cz: 16, w: 36, d: 36, h: 32, yawDeg: 0 }]
      }],
      hydrateDeployGroupFormation: () => {},
      canDeployGroupFitAt: () => true,
      unitTypeMap: new Map([['infantry', { classTag: 'infantry', unitCategory: 'melee' }]]),
      visualConfig: () => ({})
    });

    expect(snapshot.units.count).toBe(1);
    expect(snapshot.units.data[2]).toBeCloseTo(28.08);
    expect(snapshot.buildings.count).toBe(1);
    expect(snapshot.buildings.data[2]).toBeCloseTo(28.08);
  });

  test('keeps active attacker, defender, and neutral team indices in snapshot order', () => {
    const builder = new BattleSnapshotBuilder();
    const snapshot = builder.build({
      sim: {
        buildings: [],
        projectiles: [],
        hitEffects: []
      },
      crowd: {
        allAgents: [
          {
            id: 'attacker-agent',
            squadId: 'attacker-squad',
            team: 'attacker',
            unitTypeId: 'infantry',
            typeCategory: 'infantry',
            x: -20,
            y: 0,
            yaw: 0,
            weight: 1,
            hpWeight: 1,
            initialWeight: 1
          },
          {
            id: 'defender-agent',
            squadId: 'defender-squad',
            team: 'defender',
            unitTypeId: 'infantry',
            typeCategory: 'infantry',
            x: 20,
            y: 0,
            yaw: Math.PI,
            weight: 1,
            hpWeight: 1,
            initialWeight: 1
          },
          {
            id: 'neutral-agent',
            squadId: 'neutral-squad',
            team: 'neutral',
            unitTypeId: 'infantry',
            typeCategory: 'infantry',
            x: 0,
            y: 20,
            yaw: 0,
            weight: 1,
            hpWeight: 1,
            initialWeight: 1
          }
        ]
      },
      getSquadById: () => null,
      unitTypeMap: new Map([['infantry', { unitCategory: 'melee' }]]),
      visualConfig: () => ({}),
      selectedBattleSquadId: '',
      hoveredBattleSquadId: ''
    });

    expect(snapshot.units.count).toBe(3);
    expect(snapshot.units.data[5]).toBe(0);
    expect(snapshot.units.data[20 + 5]).toBe(1);
    expect(snapshot.units.data[40 + 5]).toBe(2);
  });
});
