import {
  createBattleDisplaySnapshot,
  interpolateBattleSnapshots,
  interpolateRadians
} from './BattleSnapshotInterpolator';
import { resolveTrainingRenderedSquadAnchors } from './BattleRenderedSquadAnchors';

const createSnapshot = ({
  unitCount = 1,
  unitX = 0,
  unitYaw = 0,
  projectileX = 0
} = {}) => ({
  schemaVersion: 'battle-snapshot-v2',
  unitAgentIds: Array.from({ length: Math.max(0, unitCount) }, (_, index) => `agent-${index}`),
  unitSquadIds: Array.from({ length: Math.max(0, unitCount) }, (_, index) => `squad-${index}`),
  units: {
    count: unitCount,
    stride: 20,
    data: new Float32Array(Math.max(0, unitCount) * 20)
  },
  skillStates: {
    count: unitCount,
    stride: 4,
    data: new Float32Array(Math.max(0, unitCount) * 4)
  },
  buildings: { count: 0, stride: 16, data: new Float32Array(0) },
  projectiles: { count: 1, stride: 8, data: new Float32Array(8) },
  effects: { count: 0, stride: 8, data: new Float32Array(0) }
});

describe('BattleSnapshotInterpolator', () => {
  test('interpolates mutable unit and projectile values without allocating another source snapshot', () => {
    const previous = createSnapshot({ unitX: 10, unitYaw: Math.PI * 0.75, projectileX: 20 });
    const current = createSnapshot({ unitX: 30, unitYaw: -Math.PI * 0.75, projectileX: 60 });
    previous.units.data[0] = 10;
    previous.units.data[1] = 4;
    previous.units.data[4] = Math.PI * 0.75;
    previous.units.data[6] = 1;
    previous.skillStates.data[2] = 1;
    previous.skillStates.data[3] = 0.2;
    previous.projectiles.data[0] = 20;
    previous.projectiles.data[6] = 1;
    current.units.data[0] = 30;
    current.units.data[1] = 12;
    current.units.data[4] = -Math.PI * 0.75;
    current.units.data[6] = 0.5;
    current.skillStates.data[2] = 1;
    current.skillStates.data[3] = 0.6;
    current.projectiles.data[0] = 60;
    current.projectiles.data[6] = 0.4;

    const target = createBattleDisplaySnapshot();
    const result = interpolateBattleSnapshots({
      previousSnapshot: previous,
      currentSnapshot: current,
      alpha: 0.5,
      targetSnapshot: target
    });

    expect(result.snapshot).toBe(target);
    expect(result.active).toBe(true);
    expect(target.units.data[0]).toBeCloseTo(20);
    expect(target.units.data[1]).toBeCloseTo(8);
    expect(target.units.data[6]).toBeCloseTo(0.75);
    expect(Math.abs(target.units.data[4])).toBeCloseTo(Math.PI);
    expect(target.skillStates.data[3]).toBeCloseTo(0.4);
    expect(target.projectiles.data[0]).toBeCloseTo(40);
    expect(target.projectiles.data[6]).toBeCloseTo(0.7);
  });

  test('uses the newest snapshot when instance counts no longer match', () => {
    const previous = createSnapshot({ unitCount: 2, unitX: 10 });
    const current = createSnapshot({ unitCount: 1, unitX: 30 });
    current.unitAgentIds = ['replacement-agent'];
    current.unitSquadIds = ['replacement-squad'];
    previous.units.data[0] = 10;
    current.units.data[0] = 30;

    const result = interpolateBattleSnapshots({
      previousSnapshot: previous,
      currentSnapshot: current,
      alpha: 0.5,
      targetSnapshot: createBattleDisplaySnapshot()
    });

    expect(result.active).toBe(true);
    expect(result.snapshot.units.count).toBe(1);
    expect(result.snapshot.units.data[0]).toBe(30);
  });

  test('keeps interpolating surviving identities when another unit disappears', () => {
    const previous = createSnapshot({ unitCount: 2 });
    const current = createSnapshot({ unitCount: 1 });
    previous.unitAgentIds = ['removed-agent', 'survivor-agent'];
    previous.units.data[20] = 100;
    current.unitAgentIds = ['survivor-agent'];
    current.units.data[0] = 110;

    const result = interpolateBattleSnapshots({
      previousSnapshot: previous,
      currentSnapshot: current,
      alpha: 0.5,
      targetSnapshot: createBattleDisplaySnapshot()
    });

    expect(result.snapshot.units.data[0]).toBeCloseTo(105);
  });

  test('matches reordered unit instances by stable identity instead of array index', () => {
    const previous = createSnapshot({ unitCount: 2 });
    const current = createSnapshot({ unitCount: 2 });
    previous.unitAgentIds = ['ally-agent', 'enemy-agent'];
    previous.unitSquadIds = ['ally-squad', 'enemy-squad'];
    previous.units.data[0] = 0;
    previous.units.data[20] = 100;
    previous.skillStates.data[3] = 0.2;
    previous.skillStates.data[7] = 0.8;
    current.unitAgentIds = ['enemy-agent', 'ally-agent'];
    current.unitSquadIds = ['enemy-squad', 'ally-squad'];
    current.units.data[0] = 110;
    current.units.data[20] = 10;
    current.skillStates.data[3] = 1;
    current.skillStates.data[7] = 0.4;

    const result = interpolateBattleSnapshots({
      previousSnapshot: previous,
      currentSnapshot: current,
      alpha: 0.5,
      targetSnapshot: createBattleDisplaySnapshot()
    });

    expect(result.snapshot.units.data[0]).toBeCloseTo(105);
    expect(result.snapshot.units.data[20]).toBeCloseTo(5);
    expect(result.snapshot.skillStates.data[3]).toBeCloseTo(0.9);
    expect(result.snapshot.skillStates.data[7]).toBeCloseTo(0.3);
    expect(result.snapshot.unitAgentIds).toEqual(['enemy-agent', 'ally-agent']);
    expect(result.snapshot.unitSquadIds).toEqual(['enemy-squad', 'ally-squad']);
    const anchors = resolveTrainingRenderedSquadAnchors({
      getPhase: () => 'battle',
      sim: {
        squads: [
          { id: 'ally-squad', team: 'attacker', remain: 1 },
          { id: 'enemy-squad', team: 'defender', remain: 1 }
        ]
      },
      crowd: { allAgents: [] }
    }, result.snapshot);
    expect(anchors.get('enemy-squad')?.x).toBeCloseTo(105);
    expect(anchors.get('ally-squad')?.x).toBeCloseTo(5);
  });

  test('does not interpolate unit positions when stable identities are unavailable', () => {
    const previous = createSnapshot({ unitX: 10 });
    const current = createSnapshot({ unitX: 30 });
    previous.unitAgentIds = [];
    current.unitAgentIds = [];
    previous.units.data[0] = 10;
    current.units.data[0] = 30;

    const result = interpolateBattleSnapshots({
      previousSnapshot: previous,
      currentSnapshot: current,
      alpha: 0.5,
      targetSnapshot: createBattleDisplaySnapshot()
    });

    expect(result.snapshot.units.data[0]).toBe(30);
  });

  test('takes the shortest path through the angle wrap boundary', () => {
    expect(interpolateRadians(Math.PI * 0.9, -Math.PI * 0.9, 0.5)).toBeCloseTo(Math.PI);
  });
});
