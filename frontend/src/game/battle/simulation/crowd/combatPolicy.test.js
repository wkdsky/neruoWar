import {
  completeTargetOnlyAttackOrder,
  isSquadCombatEnabled,
  isTargetOnlyAttackOrder
} from './combatPolicy';

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

  test('finishes a target-only attack as an immediate idle hold', () => {
    const squad = {
      remain: 20,
      controlMode: 'USER',
      behavior: 'move',
      vx: 8,
      vy: -3,
      speed: 9,
      targetSquadId: 'defender',
      targetBuildingId: '',
      waypoints: [{ x: 120, y: 0 }],
      _attackMoveResumeWaypoints: [{ x: 160, y: 0 }],
      order: {
        type: 'ATTACK_MOVE',
        targetSquadId: 'defender',
        targetBuildingId: '',
        stopAfterTarget: true
      }
    };

    expect(isTargetOnlyAttackOrder(squad)).toBe(true);
    expect(completeTargetOnlyAttackOrder(squad, 4.2)).toBe(true);
    expect(squad).toMatchObject({
      behavior: 'idle',
      action: '待命',
      targetSquadId: '',
      targetBuildingId: '',
      waypoints: [],
      vx: 0,
      vy: 0,
      speed: 0,
      order: {
        type: 'IDLE',
        issuedAt: 4.2,
        targetSquadId: '',
        targetBuildingId: ''
      }
    });
  });
});
