import {
  isDistanceWithinSquadAttackRange,
  resolveSquadAttackRange
} from './attackRange';

describe('squad attack range', () => {
  test('uses the remote minimum and maximum range as an annulus', () => {
    const range = resolveSquadAttackRange({
      classTag: 'archer',
      roleTag: '远程',
      stats: { attackRange: { min: 3, max: 6 } }
    });

    expect(range).toEqual({ min: 42, max: 84 });
    expect(isDistanceWithinSquadAttackRange(41.9, range)).toBe(false);
    expect(isDistanceWithinSquadAttackRange(42, range)).toBe(true);
    expect(isDistanceWithinSquadAttackRange(84, range)).toBe(true);
    expect(isDistanceWithinSquadAttackRange(84.1, range)).toBe(false);
  });
});
