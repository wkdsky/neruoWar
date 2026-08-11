import BattleRuntime from './BattleRuntime';

const buildInit = () => ({
  mode: 'training',
  rules: { allowCrossMidline: true, maxDeployGroupTotal: 10000 },
  battlefield: { layoutMeta: { fieldWidth: 1200, fieldHeight: 800 }, objects: [] },
  unitTypes: [
    { unitTypeId: 'melee_unit', name: '球刃卫', unitCategory: 'melee', unitSubtype: 'defense', hp: 12, atk: 4, def: 2, speed: 1, range: 1 },
    { unitTypeId: 'ranged_unit', name: '弧弩手', unitCategory: 'ranged', unitSubtype: 'defense', hp: 8, atk: 5, def: 1, speed: 1.2, range: 4 },
    { unitTypeId: 'support_unit', name: '信号师', unitCategory: 'support', unitSubtype: 'intervention', hp: 7, atk: 2, def: 1, speed: 1, range: 2 },
    { unitTypeId: 'enemy_unit', name: '敌军', unitCategory: 'melee', hp: 12, atk: 3, def: 1, speed: 1, range: 1 }
  ],
  attacker: { rosterUnits: [{ unitTypeId: 'melee_unit', count: 40 }, { unitTypeId: 'ranged_unit', count: 40 }, { unitTypeId: 'support_unit', count: 40 }], deployUnits: [] },
  defender: { rosterUnits: [{ unitTypeId: 'enemy_unit', count: 120 }], deployUnits: [] }
});

const createRuntime = (skillSlots) => {
  const runtime = new BattleRuntime(buildInit());
  const attacker = runtime.createDeployGroup('attacker', {
    units: { melee_unit: 40, ranged_unit: 40, support_unit: 40 },
    skillSlots,
    x: -20,
    y: 0,
    placed: true,
    controlMode: 'USER'
  });
  runtime.createDeployGroup('defender', {
    units: { enemy_unit: 120 },
    x: 20,
    y: 0,
    placed: true,
    controlMode: 'AI'
  });
  expect(attacker.ok).toBe(true);
  expect(runtime.startBattle().ok).toBe(true);
  runtime.step(0.016);
  return runtime;
};

describe('configured training skill execution', () => {
  test('dispatches melee skills to melee agents and gives them cast motion', () => {
    const runtime = createRuntime([
      { slotIndex: 0, treeCategory: 'melee', skillId: 'melee_breach_charge' }
    ]);
    const squad = runtime.getSquadById('attacker_squad_1');
    const result = runtime.commandSkillSlot(squad.id, 0, {
      x: 0,
      y: 0,
      dirX: 1,
      dirY: 0,
      distance: 40
    });
    expect(result.ok).toBe(true);
    expect(squad.activeSkill.mode).toBe('melee');
    const casters = runtime.crowd.agentsBySquad.get(squad.id).filter((agent) => agent.castState);
    expect(casters.length).toBeGreaterThan(0);
    expect(casters.every((agent) => agent.unitCategory === 'melee')).toBe(true);
    const snapshot = runtime.getRenderSnapshot();
    const skillActionIndices = Array.from({ length: snapshot.skillStates.count }, (_, index) => (
      snapshot.skillStates.data[(index * snapshot.skillStates.stride) + 2]
    ));
    expect(skillActionIndices).toContain(1);
  });

  test('turns a melee ground target into a charge order with an expanded alert rectangle', () => {
    const runtime = createRuntime([
      { slotIndex: 0, treeCategory: 'melee', skillId: 'melee_breach_charge' }
    ]);
    const squad = runtime.getSquadById('attacker_squad_1');
    const result = runtime.commandSkillSlot(squad.id, 0, {
      x: 70,
      y: 0,
      dirX: 1,
      dirY: 0,
      distance: 90
    });
    expect(result.ok).toBe(true);
    expect(squad.meleeAttackOrder).toMatchObject({
      phase: 'charge',
      targetPoint: { x: expect.any(Number), y: 0 },
      alertRect: expect.objectContaining({ width: expect.any(Number), depth: expect.any(Number) })
    });
    for (let index = 0; index < 360; index += 1) runtime.step(0.1);
    expect(['charge', 'attack', 'return']).toContain(squad.meleeAttackOrder?.phase || 'return');
  });

  test('keeps the squad anchor fixed while only melee casters charge', () => {
    const runtime = createRuntime([
      { slotIndex: 0, treeCategory: 'melee', skillId: 'melee_breach_charge' }
    ]);
    const squad = runtime.getSquadById('attacker_squad_1');
    const agents = runtime.crowd.agentsBySquad.get(squad.id);
    const initialSquadX = squad.x;
    const initialPositions = new Map(agents.map((agent) => [agent.id, { x: agent.x, y: agent.y }]));
    const result = runtime.commandSkillSlot(squad.id, 0, {
      x: 70,
      y: 0,
      dirX: 1,
      dirY: 0,
      distance: 90
    });
    expect(result.ok).toBe(true);
    const casterIds = new Set(squad.meleeAttackOrder.casterAgentIds);
    runtime.step(0.4);
    const movedCasters = agents.filter((agent) => {
      if (!casterIds.has(agent.id)) return false;
      const initial = initialPositions.get(agent.id);
      return Math.hypot(agent.x - initial.x, agent.y - initial.y) > 0.5;
    });
    expect(squad.x).toBeCloseTo(initialSquadX, 5);
    expect(movedCasters.length).toBeGreaterThan(0);
  });

  test('dispatches fixed ranged skills to ranged agents and locks the squad', () => {
    const runtime = createRuntime([
      { slotIndex: 0, treeCategory: 'ranged', skillId: 'ranged_fixed_volley' }
    ]);
    const squad = runtime.getSquadById('attacker_squad_1');
    expect(runtime.commandMove(squad.id, { x: 120, y: 80 })).toBe(true);
    const pathBeforeSetup = squad.waypoints.map((point) => ({ ...point }));
    const result = runtime.commandSkillSlot(squad.id, 0, { x: 0, y: 0 });
    expect(result.ok).toBe(true);
    expect(squad.activeSkill.lockMovement).toBe(true);
    expect(squad.waypoints).toEqual(pathBeforeSetup);
    expect(squad.activeSkill.casterAgentIds.length).toBeGreaterThan(0);
    const casters = runtime.crowd.agentsBySquad.get(squad.id)
      .filter((agent) => squad.activeSkill.casterAgentIds.includes(agent.id));
    expect(casters.every((agent) => agent.unitCategory === 'ranged')).toBe(true);
  });

  test('requires an enemy target for intervention support skills and applies a debuff', () => {
    const runtime = createRuntime([
      { slotIndex: 0, treeCategory: 'support', skillId: 'support_intervention_domain' }
    ]);
    const squad = runtime.getSquadById('attacker_squad_1');
    const enemy = runtime.getSquadById('defender_squad_1');
    const missingTarget = runtime.commandSkillSlot(squad.id, 0, { x: 0, y: 0 });
    expect(missingTarget.ok).toBe(false);
    const cast = runtime.commandSkillSlot(squad.id, 0, {
      targetSquadId: enemy.id,
      x: enemy.x,
      y: enemy.y
    });
    expect(cast.ok).toBe(true);
    expect(enemy.statusEffects.some((effect) => effect.type === 'debuff')).toBe(true);
    const casters = runtime.crowd.agentsBySquad.get(squad.id).filter((agent) => agent.castState);
    expect(casters.length).toBeGreaterThan(0);
    expect(casters.every((agent) => agent.unitCategory === 'support')).toBe(true);
  });
});
