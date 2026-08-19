import BattleSnapshotPool from './BattleSnapshotPool';

describe('BattleSnapshotPool', () => {
  test('alternates source buffers so a previous snapshot remains readable', () => {
    const pool = new BattleSnapshotPool();
    const first = pool.acquire();
    first.units.count = 1;
    first.units.data[0] = 12;

    const second = pool.acquire();
    second.units.count = 1;
    second.units.data[0] = 34;

    expect(second).not.toBe(first);
    expect(first.units.data[0]).toBe(12);
    expect(pool.acquire()).toBe(first);
  });
});
