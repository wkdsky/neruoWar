import { isSquadCombatEnabled } from './combatPolicy';

describe('crowd combat policy', () => {
  test('keeps a user move passive even while taking damage', () => {
    expect(isSquadCombatEnabled({
      remain: 20,
      controlMode: 'USER',
      behavior: 'move',
      underAttackTimer: 1,
      order: { type: 'MOVE' }
    })).toBe(false);
  });

  test('enables explicit attack orders and AI marching combat', () => {
    expect(isSquadCombatEnabled({
      remain: 20,
      controlMode: 'USER',
      behavior: 'move',
      order: { type: 'ATTACK_MOVE' }
    })).toBe(true);
    expect(isSquadCombatEnabled({
      remain: 20,
      controlMode: 'AI',
      behavior: 'move',
      order: { type: 'MOVE' }
    })).toBe(true);
  });
});
