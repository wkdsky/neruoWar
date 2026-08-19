import { formatAttackRange, normalizeAttackRange } from './attackRange';

describe('attack range normalization', () => {
  test('keeps remote unit attack ranges as a band above one', () => {
    const attackRange = normalizeAttackRange({
      roleTag: '远程',
      attackRange: { min: 3, max: 6 }
    });

    expect(attackRange).toEqual({ min: 3, max: 6 });
    expect(formatAttackRange(attackRange)).toBe('3–6');
  });

  test('gives legacy remote rows a compatible annular range', () => {
    const attackRange = normalizeAttackRange({ roleTag: '远程', range: 6 });

    expect(attackRange).toEqual({ min: 3, max: 6 });
  });
});
