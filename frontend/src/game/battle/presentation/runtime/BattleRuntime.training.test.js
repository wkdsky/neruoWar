import BattleRuntime from './BattleRuntime';
import CameraController from '../render/CameraController';

const buildInit = () => ({
  mode: 'training',
  rules: { allowCrossMidline: true, maxDeployGroupTotal: 10000 },
  battlefield: {
    layoutMeta: { fieldWidth: 1200, fieldHeight: 800 },
    objects: []
  },
  unitTypes: [{
    unitTypeId: 'infantry_basic',
    name: '步兵',
    classTag: 'infantry',
    hp: 10,
    atk: 2,
    def: 1,
    speed: 1,
    range: 1
  }],
  attacker: {
    rosterUnits: [{ unitTypeId: 'infantry_basic', count: 100 }],
    deployUnits: []
  },
  defender: {
    rosterUnits: [{ unitTypeId: 'infantry_basic', count: 100 }],
    deployUnits: []
  }
});

const buildMixedInit = () => {
  const init = buildInit();
  init.unitTypes = [
    ...init.unitTypes,
    {
      unitTypeId: 'archer_basic',
      name: '弓兵',
      classTag: 'archer',
      hp: 8,
      atk: 4,
      def: 0.5,
      speed: 1.2,
      range: 4
    }
  ];
  init.attacker.rosterUnits = [
    { unitTypeId: 'infantry_basic', count: 100 },
    { unitTypeId: 'archer_basic', count: 100 }
  ];
  return init;
};

const buildFormationTemplates = () => ([
  {
    formationId: 'line',
    name: '横向阵',
    placements: [
      { unitTypeId: 'infantry_basic', x: 0, y: 0 },
      { unitTypeId: 'infantry_basic', x: 2, y: 0 }
    ]
  },
  {
    formationId: 'column',
    name: '纵深阵',
    placements: [
      { unitTypeId: 'infantry_basic', x: 0, y: 0 },
      { unitTypeId: 'infantry_basic', x: 0, y: 2 }
    ]
  }
]);

describe('BattleRuntime training control', () => {
  test('projects per-兵种 counts and formation metadata into a deployment card', () => {
    const runtime = new BattleRuntime(buildMixedInit());
    const result = runtime.createDeployGroup('attacker', {
      name: '前线混编',
      templateName: '混编模板',
      templateFormations: [{ formationId: 'line', name: '横向阵' }],
      activeFormationId: 'line',
      units: { infantry_basic: 12, archer_basic: 8 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    });
    expect(result.ok).toBe(true);

    const row = runtime.getCardRows().find((card) => card.id === result.groupId);
    expect(row).toMatchObject({
      name: '前线混编',
      templateName: '混编模板',
      formationName: '横向阵',
      templateFormations: [{ formationId: 'line', name: '横向阵' }],
      unitMetrics: {
        totalCount: 20,
        totalHp: 184,
        totalAtk: 56,
        totalDef: 16
      }
    });
    expect(row.unitComposition).toEqual(expect.arrayContaining([
      expect.objectContaining({ unitTypeId: 'infantry_basic', count: 12, startCount: 12 }),
      expect.objectContaining({ unitTypeId: 'archer_basic', count: 8, startCount: 8 })
    ]));
  });

  test('creates zero-point default skills from the troop categories and preserves explicit empty settings', () => {
    const init = buildInit();
    init.unitTypes = [
      { unitTypeId: 'ranged_a', name: '游击射手', unitCategory: 'ranged', rpsType: 'ranged', hp: 8, atk: 4, def: 1, speed: 1.2, range: 4 },
      { unitTypeId: 'ranged_b', name: '守望炮手', unitCategory: 'ranged', rpsType: 'ranged', hp: 9, atk: 5, def: 1, speed: 1, range: 5 },
      { unitTypeId: 'support_a', name: '协调师', unitCategory: 'support', rpsType: 'support', hp: 7, atk: 2, def: 1, speed: 1, range: 2 }
    ];
    init.attacker.rosterUnits = [
      { unitTypeId: 'ranged_a', count: 50 },
      { unitTypeId: 'ranged_b', count: 50 },
      { unitTypeId: 'support_a', count: 50 }
    ];
    const runtime = new BattleRuntime(init);
    const defaultGroup = runtime.createDeployGroup('attacker', {
      units: { ranged_a: 10, ranged_b: 10, support_a: 10 }
    });
    const explicitEmpty = runtime.createDeployGroup('attacker', {
      units: { ranged_a: 10, support_a: 10 },
      skillSlots: []
    });
    const categoryOnlyDefault = runtime.createDeployGroup('attacker', {
      units: { ranged_a: 10, support_a: 10 }
    });

    expect(runtime.getTrainingState().points).toBe(0);
    expect(runtime.getDeployGroupSkillSlots(defaultGroup.groupId).map((slot) => slot.treeCategory)).toEqual([
      'ranged', 'ranged', 'support'
    ]);
    expect(runtime.getDeployGroupSkillSlots(defaultGroup.groupId).map((slot) => slot.skillId)).toEqual([
      'ranged_fixed_volley', 'ranged_fixed_volley', 'support_specialized_boost'
    ]);
    expect(runtime.getDeployGroupSkillSlots(explicitEmpty.groupId).every((slot) => !slot.skillId)).toBe(true);
    expect(runtime.getDeployGroupSkillSlots(categoryOnlyDefault.groupId).map((slot) => slot.treeCategory)).toEqual([
      'ranged', 'ranged', 'support'
    ]);
  });

  test('reorders deployment formations without changing the active formation', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      templateFormations: [
        { formationId: 'one', name: '一', placements: [{ unitTypeId: 'infantry_basic', x: 0, y: 0 }] },
        { formationId: 'two', name: '二', placements: [{ unitTypeId: 'infantry_basic', x: 1, y: 0 }] },
        { formationId: 'three', name: '三', placements: [{ unitTypeId: 'infantry_basic', x: 2, y: 0 }] }
      ],
      activeFormationId: 'two'
    });
    const result = runtime.reorderDeployGroupFormations(created.groupId, ['three', 'one', 'two']);
    expect(result.ok).toBe(true);
    expect(result.formations.map((formation) => formation.formationId)).toEqual(['three', 'one', 'two']);
    expect(runtime.getDeployGroupById(created.groupId).activeFormationId).toBe('two');
  });

  test('switches formations instantly before training and reforms over time during training', () => {
    const runtime = new BattleRuntime(buildInit());
    const formations = buildFormationTemplates();
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -420,
      y: 0,
      placed: true,
      controlMode: 'USER',
      templateFormations: formations,
      activeFormationId: 'line'
    });

    expect(runtime.setDeployGroupFormation(created.groupId, formations[1], 'attacker')).toMatchObject({
      ok: true,
      reforming: false
    });
    expect(runtime.getDeployGroupById(created.groupId, 'attacker').activeFormationId).toBe('column');
    expect(runtime.setDeployGroupFormation(created.groupId, formations[0], 'attacker').ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('attacker_squad_1');
    const beforeSlots = runtime.crowd.agentsBySquad.get(squad.id).map((agent) => ({ ...agent.formationSlot }));
    const result = runtime.setDeployGroupFormation(squad.id, formations[1], 'attacker');

    expect(result).toMatchObject({ ok: true, reforming: true, reformDurationSec: 4.6 });
    expect(squad.activeFormationId).toBe('column');
    expect(squad.formationChange).toMatchObject({
      fromFormationId: 'line',
      toFormationId: 'column',
      remainingSec: 4.6
    });
    expect(runtime.getDeployGroupFormations(squad.id).map((formation) => formation.formationId)).toEqual(['line', 'column']);
    expect(runtime.crowd.agentsBySquad.get(squad.id).map((agent) => agent.formationSlot)).not.toEqual(beforeSlots);

    runtime.step(0.05);
    expect(runtime.getCardRows().find((row) => row.id === squad.id)).toMatchObject({
      action: '换阵中',
      formationChange: expect.objectContaining({ toFormationId: 'column' })
    });

    for (let index = 0; index < 100; index += 1) runtime.step(0.05);

    expect(squad.formationChange).toBeNull();
    expect(squad.speedPolicy).toBe('MARCH');
    const agents = runtime.crowd.agentsBySquad.get(squad.id)
      .filter((agent) => !agent.dead && !agent.isFlagBearer);
    const formationForward = {
      x: Math.cos(squad.formationRect.facingRad),
      y: Math.sin(squad.formationRect.facingRad)
    };
    const formationSide = { x: -formationForward.y, y: formationForward.x };
    const largestSlotError = Math.max(...agents.map((agent) => {
      const slot = agent.formationSlot;
      const expectedX = squad.x + (formationSide.x * slot.side) + (formationForward.x * slot.front);
      const expectedY = squad.y + (formationSide.y * slot.side) + (formationForward.y * slot.front);
      return Math.hypot(agent.x - expectedX, agent.y - expectedY);
    }));

    expect(largestSlotError).toBeLessThan(1e-5);
  });

  test('reforms formations after a regular battle begins', () => {
    const init = buildInit();
    init.mode = 'battle';
    const runtime = new BattleRuntime(init);
    const formations = buildFormationTemplates();
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -420,
      y: 0,
      placed: true,
      templateFormations: formations,
      activeFormationId: 'line'
    });

    expect(created.ok).toBe(true);
    expect(runtime.createDeployGroup('defender', {
      units: { infantry_basic: 100 },
      x: 420,
      y: 0,
      placed: true
    }).ok).toBe(true);

    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('attacker_squad_1');
    const result = runtime.setDeployGroupFormation(squad.id, formations[1], 'attacker');

    expect(result).toMatchObject({ ok: true, reforming: true, reformDurationSec: 4.6 });
    expect(squad.activeFormationId).toBe('column');
    expect(squad.formationChange).toMatchObject({
      fromFormationId: 'line',
      toFormationId: 'column',
      remainingSec: 4.6
    });

    for (let index = 0; index < 100; index += 1) runtime.step(0.05);

    expect(squad.formationChange).toBeNull();
    expect(squad.speedPolicy).toBe('MARCH');
  });

  test('rotates a template formation without rebuilding its custom slots', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      templateFormations: [{
        formationId: 'line',
        name: '横向阵',
        placements: [
          { unitTypeId: 'infantry_basic', x: 0, y: 0 },
          { unitTypeId: 'infantry_basic', x: 2, y: 0 }
        ]
      }],
      activeFormationId: 'line'
    });
    const before = runtime.getDeployGroupSlots(created.groupId, 'attacker');
    const result = runtime.setDeployGroupRect(created.groupId, { facingRad: Math.PI / 2 }, 'attacker');
    const group = runtime.getDeployGroupById(created.groupId, 'attacker');

    expect(result.ok).toBe(true);
    expect(group.formationRect).toMatchObject({ formationId: 'line', formationName: '横向阵', facingRad: Math.PI / 2 });
    expect(group.deploySlots.map((slot) => [slot.side, slot.front, slot.unitTypeId])).toEqual(
      before.map((slot) => [slot.side, slot.front, slot.unitTypeId])
    );
  });

  test('stores a selectable forward direction without rotating the deployment rectangle', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    const group = runtime.getDeployGroupById(created.groupId, 'attacker');
    const formationFacing = group.formationRect.facingRad;

    const result = runtime.setDeployGroupDirection(created.groupId, Math.PI / 2, 'attacker');

    expect(result).toEqual({
      ok: true,
      directionOffsetRad: Math.PI / 2,
      directionRad: formationFacing + (Math.PI / 2)
    });
    expect(group.formationRect.facingRad).toBeCloseTo(formationFacing);
    expect(group.formationRect.directionOffsetRad).toBeCloseTo(Math.PI / 2);
    expect(group.formationRect.directionRad).toBeCloseTo(formationFacing + (Math.PI / 2));

    runtime.setDeployGroupRect(created.groupId, { facingRad: formationFacing + (Math.PI / 4) }, 'attacker');
    expect(group.formationRect.directionOffsetRad).toBeCloseTo(Math.PI / 2);
    expect(group.formationRect.directionRad).toBeCloseTo(formationFacing + (Math.PI * 3 / 4));

    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.getSquadById('attacker_squad_1').formationRect.directionOffsetRad).toBeCloseTo(Math.PI / 2);
  });

  test('snaps a battle direction to eight formation-relative headings and applies it to the crowd', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });

    expect(created.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    const result = runtime.setDeployGroupDirection(squad.id, Math.PI * 0.62, 'attacker');

    expect(result).toMatchObject({
      ok: true,
      directionOffsetRad: Math.PI / 2,
      directionRad: Math.PI / 2
    });
    expect(squad.formationRect.directionOffsetRad).toBeCloseTo(Math.PI / 2, 6);
    expect(squad._crowdForward.x).toBeCloseTo(0, 6);
    expect(squad._crowdForward.y).toBeCloseTo(1, 6);
    expect(squad.dirX).toBeCloseTo(0, 6);
    expect(squad.dirY).toBeCloseTo(1, 6);
  });

  test('keeps the formation body at its chosen local offset when battle movement begins', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    const group = runtime.getDeployGroupById(created.groupId, 'attacker');
    runtime.setDeployGroupRect(group.id, { facingRad: 0, width: 96 }, 'attacker');
    runtime.setDeployGroupDirection(group.id, Math.PI / 2, 'attacker');

    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    const agents = runtime.crowd.agentsBySquad.get(squad.id);
    const formationAgent = agents.find((agent) => (
      !agent.isFlagBearer
      && (Math.abs(Number(agent.formationSlot?.side) || 0) > 0.01
        || Math.abs(Number(agent.formationSlot?.front) || 0) > 0.01)
    ));
    const expectFormationPosition = () => {
      const formationForward = { x: 1, y: 0 };
      const formationSide = { x: 0, y: 1 };
      const slot = formationAgent.formationSlot;
      expect(formationAgent.x).toBeCloseTo(
        squad.x + (formationSide.x * slot.side) + (formationForward.x * slot.front),
        6
      );
      expect(formationAgent.y).toBeCloseTo(
        squad.y + (formationSide.y * slot.side) + (formationForward.y * slot.front),
        6
      );
    };

    expect(formationAgent).toBeTruthy();
    expect(squad._crowdForward.x).toBeCloseTo(0, 6);
    expect(squad._crowdForward.y).toBeCloseTo(1, 6);
    expect(squad._crowdFormationForward.x).toBeCloseTo(1, 6);
    expect(squad._crowdFormationForward.y).toBeCloseTo(0, 6);
    expectFormationPosition();

    runtime.step(0.05);
    expect(squad._crowdForward.x).toBeCloseTo(0, 6);
    expect(squad._crowdForward.y).toBeCloseTo(1, 6);
    expect(squad._crowdFormationForward.x).toBeCloseTo(1, 6);
    expect(squad._crowdFormationForward.y).toBeCloseTo(0, 6);
    expectFormationPosition();
  });

  test('turns the formation and direction arc together while preserving their local offset', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    const group = runtime.getDeployGroupById(created.groupId, 'attacker');
    runtime.setDeployGroupRect(group.id, { facingRad: 0, width: 96 }, 'attacker');
    runtime.setDeployGroupDirection(group.id, Math.PI / 2, 'attacker');

    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    expect(runtime.commandMove(squad.id, { x: squad.x + 220, y: squad.y })).toBe(true);
    for (let index = 0; index < 16; index += 1) runtime.step(0.05);

    const movementYaw = Math.atan2(squad._crowdForward.y, squad._crowdForward.x);
    const expectedFacing = movementYaw - (Math.PI / 2);
    expect(Math.abs(squad._crowdForward.x)).toBeGreaterThan(0.1);
    expect(squad.formationRect.directionOffsetRad).toBeCloseTo(Math.PI / 2, 6);
    expect(squad.formationRect.directionRad).toBeCloseTo(movementYaw, 6);
    expect(squad.formationRect.facingRad).toBeLessThan(0);
    expect(squad.formationRect.facingRad).toBeGreaterThan(expectedFacing);
    expect(squad._crowdFormationForward.x).toBeCloseTo(Math.cos(squad.formationRect.facingRad), 6);
    expect(squad._crowdFormationForward.y).toBeCloseTo(Math.sin(squad.formationRect.facingRad), 6);
  });

  test('keeps every soldier in its slot through a single-direction marching turn', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    const group = runtime.getDeployGroupById(created.groupId, 'attacker');
    runtime.setDeployGroupRect(group.id, { facingRad: 0, width: 96 }, 'attacker');

    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    expect(runtime.commandMove(squad.id, { x: squad.x + 680, y: squad.y })).toBe(true);
    for (let index = 0; index < 12; index += 1) runtime.step(0.05);

    expect(runtime.setDeployGroupDirection(squad.id, Math.PI / 2, 'attacker')).toMatchObject({ ok: true });
    let largestSlotError = 0;
    let previousYaw = squad.formationRect.facingRad;
    const turnSteps = [];
    for (let index = 0; index < 80; index += 1) {
      runtime.step(0.05);
      const currentYaw = squad.formationRect.facingRad;
      const turnStep = currentYaw - previousYaw;
      if (Math.abs(turnStep) > 1e-6) turnSteps.push(turnStep);
      previousYaw = currentYaw;
      const agents = runtime.crowd.agentsBySquad.get(squad.id)
        .filter((agent) => !agent.dead && !agent.isFlagBearer);
      const formationForward = {
        x: Math.cos(currentYaw),
        y: Math.sin(currentYaw)
      };
      const formationSide = { x: -formationForward.y, y: formationForward.x };
      agents.forEach((agent) => {
        const slot = agent.formationSlot;
        const expectedX = squad.x + (formationSide.x * slot.side) + (formationForward.x * slot.front);
        const expectedY = squad.y + (formationSide.y * slot.side) + (formationForward.y * slot.front);
        largestSlotError = Math.max(largestSlotError, Math.hypot(agent.x - expectedX, agent.y - expectedY));
        expect(agent.yaw).toBeCloseTo(currentYaw, 6);
      });
    }

    expect(squad.waypoints.length).toBeGreaterThan(0);
    expect(squad.speed).toBeGreaterThan(0);
    expect(turnSteps.length).toBeGreaterThan(0);
    expect(turnSteps.every((step) => step <= 1e-6)).toBe(true);
    expect(largestSlotError).toBeLessThan(1e-5);
  });

  test('picks the full rotated deployment footprint and rejects invalid camera points', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    expect(result.ok).toBe(true);
    const group = runtime.getDeployGroupById(result.groupId, 'attacker');
    group.formationRect = { width: 120, depth: 20, facingRad: Math.PI / 2 };

    expect(runtime.pickDeployGroup({ x: group.x, y: group.y + 45 }, 'attacker')).toBe(group);
    expect(runtime.pickDeployGroup({ x: group.x, y: group.y, valid: false }, 'attacker')).toBeNull();
  });

  test('keeps deployment-area selection valid after the camera is centered on the battlefield', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -420,
      y: 40,
      placed: true,
      controlMode: 'USER'
    });
    expect(result.ok).toBe(true);
    const group = runtime.getDeployGroupById(result.groupId, 'attacker');
    const camera = new CameraController({ yawDeg: 45, pitchLow: 40, pitchHigh: 90, distance: 640 });
    camera.centerX = 0;
    camera.centerY = 0;
    camera.setPitchImmediate(40);
    camera.buildMatrices(1200, 720);

    const screen = camera.worldToScreen({ x: group.x, y: group.y, z: 0 }, { width: 1200, height: 720 });
    expect(screen.visible).toBe(true);
    const world = camera.screenToGround(screen.x, screen.y, { width: 1200, height: 720 });

    expect(world.valid).toBe(true);
    expect(world.x).toBeCloseTo(group.x, 4);
    expect(world.y).toBeCloseTo(group.y, 4);
    expect(runtime.pickDeployGroup(world, 'attacker')).toBe(group);
  });

  test('starts with only one placed side and keeps the phase running', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);

    expect(runtime.canStartBattle()).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);
    runtime.step(0.016);
    expect(runtime.getPhase()).toBe('battle');
  });

  test('has no countdown and does not time out during training', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    expect(runtime.getBattleStatus()).toMatchObject({ timeLimitSec: 0, timerSec: 0 });
    runtime.sim.timerSec = 0;
    runtime.step(0.05);

    expect(runtime.getPhase()).toBe('battle');
    expect(runtime.getBattleStatus().endReason).toBe('');
  });

  test('keeps the countdown in an actual battle', () => {
    const init = buildInit();
    init.mode = 'siege';
    init.timeLimitSec = 90;
    const runtime = new BattleRuntime(init);
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    expect(runtime.createDeployGroup('defender', {
      units: { infantry_basic: 20 },
      x: 450,
      y: 0,
      placed: true,
      controlMode: 'AI'
    }).ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    expect(runtime.getBattleStatus().timerSec).toBe(90);
    runtime.step(0.05);
    expect(runtime.getBattleStatus().timerSec).toBeCloseTo(89.95, 5);
  });

  test('allows a user-controlled defender to be selected and moved', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('defender', {
      units: { infantry_basic: 20 },
      x: 450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    });
    expect(result.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('defender_squad_1');
    expect(runtime.canControlSquad(squad)).toBe(true);
    expect(runtime.setSelectedBattleSquad(squad.id)).toBe(true);
    expect(runtime.commandMove(squad.id, { x: 300, y: 40 })).toBe(true);
  });

  test('AI-controlled defenders cannot receive user commands', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('defender', {
      units: { infantry_basic: 20 },
      x: 450,
      y: 0,
      placed: true,
      controlMode: 'AI'
    });
    expect(result.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.commandMove('defender_squad_1', { x: 300, y: 40 })).toBe(false);
  });

  test('AI-controlled defenders remain selectable and camera-followable', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('defender', {
      units: { infantry_basic: 20 },
      x: 450,
      y: 0,
      placed: true,
      controlMode: 'AI'
    });
    expect(result.ok).toBe(true);
    runtime.setSelectedDeployGroup(result.groupId);
    runtime.setFocusSquad(result.groupId);
    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('defender_squad_1');
    expect(runtime.canControlSquad(squad)).toBe(false);
    expect(runtime.setSelectedBattleSquad(squad.id)).toBe(true);
    runtime.setFocusSquad(squad.id);
    expect(runtime.getCardRows().find((row) => row.id === squad.id)?.selected).toBe(true);
    expect(runtime.getFocusAnchor()).toMatchObject({ squadId: squad.id });
    expect(runtime.commandMove(squad.id, { x: 300, y: 40 })).toBe(false);
  });

  test('can hand any training squad between AI and user control during battle', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('defender', {
      units: { infantry_basic: 20 },
      x: 450,
      y: 0,
      placed: true,
      controlMode: 'AI'
    });
    expect(result.ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('defender_squad_1');
    expect(runtime.canControlSquad(squad)).toBe(false);

    expect(runtime.setTrainingBattleSquadControlMode(squad.id, 'USER')).toMatchObject({
      ok: true,
      squadId: squad.id,
      controlMode: 'USER'
    });
    expect(runtime.canControlSquad(squad)).toBe(true);
    expect(runtime.getCardRows().find((row) => row.id === squad.id)?.selected).toBe(true);
    expect(runtime.commandMove(squad.id, { x: 300, y: 40 })).toBe(true);

    expect(runtime.setTrainingBattleSquadControlMode(squad.id, 'AI')).toMatchObject({
      ok: true,
      squadId: squad.id,
      controlMode: 'AI'
    });
    expect(runtime.canControlSquad(squad)).toBe(false);
    expect(squad.behavior).toBe('auto');
    expect(runtime.commandMove(squad.id, { x: 300, y: 40 })).toBe(false);
  });

  test('canceling placement keeps the card but removes its map preview', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true
    });
    expect(result.ok).toBe(true);
    expect(runtime.cancelDeployGroupPlacement('attacker', result.groupId).ok).toBe(true);
    expect(runtime.getCardRows().find((row) => row.id === result.groupId)?.placed).toBe(false);
    expect(runtime.getDeployGroupById(result.groupId, 'attacker')).toMatchObject({
      id: result.groupId,
      placed: false,
      placementActive: false
    });
    expect(runtime.getMinimapSnapshot().squads).toHaveLength(0);
    expect(runtime.getRenderSnapshot().units.count).toBe(0);
  });

  test('writes a deployment hover flag without replacing the selected flag', () => {
    const runtime = new BattleRuntime(buildInit());
    const result = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -420,
      y: 0,
      placed: true
    });
    expect(result.ok).toBe(true);

    runtime.clearSelection();
    runtime.setHoveredDeployGroup(result.groupId);
    let snapshot = runtime.getRenderSnapshot();
    expect(snapshot.units.data[12]).toBe(0);
    expect(snapshot.units.data[15]).toBe(1);

    runtime.setSelectedDeployGroup(result.groupId);
    snapshot = runtime.getRenderSnapshot();
    expect(snapshot.units.data[12]).toBe(1);
    expect(snapshot.units.data[15]).toBe(0);
  });

  test('uses a single flagged marker until an active training group fully enters its own deployment zone', () => {
    const runtime = new BattleRuntime(buildInit());
    const attacker = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 100 },
      x: -480,
      y: 0,
      placed: false
    });
    const defender = runtime.createDeployGroup('defender', {
      units: { infantry_basic: 100 },
      x: 480,
      y: 0,
      placed: false
    });
    expect(attacker.ok).toBe(true);
    expect(defender.ok).toBe(true);

    runtime.moveDeployGroup(attacker.groupId, { x: 0, y: 0 }, 'attacker');
    runtime.moveDeployGroup(defender.groupId, { x: 0, y: 0 }, 'defender');
    const markerSnapshot = runtime.getRenderSnapshot();
    const markerCount = markerSnapshot.units.count;
    expect(markerCount).toBe(2);
    expect(markerSnapshot.units.data[13]).toBe(1);
    expect(markerSnapshot.units.data[14]).toBe(1);
    expect(markerSnapshot.units.data[20 + 13]).toBe(1);
    expect(markerSnapshot.units.data[20 + 14]).toBe(1);

    runtime.moveDeployGroup(attacker.groupId, { x: -480, y: 0 }, 'attacker');
    runtime.moveDeployGroup(defender.groupId, { x: 480, y: 0 }, 'defender');
    expect(runtime.canDeployGroupFitAt(attacker.groupId, runtime.getDeployGroupById(attacker.groupId), 'attacker')).toBe(true);
    expect(runtime.canDeployGroupFitAt(defender.groupId, runtime.getDeployGroupById(defender.groupId), 'defender')).toBe(true);
    const formationSnapshot = runtime.getRenderSnapshot();
    const attackerSlots = runtime.getDeployGroupById(attacker.groupId)?.deploySlots?.length || 0;
    const defenderSlots = runtime.getDeployGroupById(defender.groupId)?.deploySlots?.length || 0;
    expect(formationSnapshot.units.count).toBe(attackerSlots + defenderSlots);
    expect(formationSnapshot.units.count).toBeGreaterThan(markerCount);
  });

  test('resets a training session to the exact pre-start deployment state', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 30 },
      x: -420,
      y: 64,
      placed: true,
      controlMode: 'USER'
    });
    expect(created.ok).toBe(true);
    expect(runtime.setDeployGroupSkillSlots(created.groupId, [{
      slotIndex: 0,
      treeCategory: 'melee',
      skillId: 'melee_heavy_blow'
    }]).ok).toBe(true);

    expect(runtime.startBattle().ok).toBe(true);
    runtime.adjustTrainingSkillPoints(8);
    const squad = runtime.getSquadById('attacker_squad_1');
    squad.x = 120;
    squad.y = -140;

    expect(runtime.resetTraining().ok).toBe(true);
    expect(runtime.getPhase()).toBe('deploy');
    expect(runtime.getTrainingState().points).toBe(0);
    const restored = runtime.getDeployGroupById(created.groupId, 'attacker');
    expect(restored.x).toBe(-420);
    expect(restored.y).toBe(64);
    expect(restored.skillSlots[0].skillId).toBe('melee_heavy_blow');
  });

  test('clears deployment selection when resetting a training session', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 30 },
      x: -420,
      y: 0,
      placed: true,
      controlMode: 'USER'
    });
    expect(created.ok).toBe(true);
    runtime.setSelectedDeployGroup(created.groupId);
    runtime.setFocusSquad(created.groupId);

    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.resetTraining().ok).toBe(true);

    expect(runtime.getDeployGroups().selectedId).toBe('');
    expect(runtime.getCardRows().some((row) => row.selected)).toBe(false);
  });

  test('stops exposing a camera follow target after clearing training selection', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    runtime.clearSelection();

    expect(runtime.getFocusAnchor()).toBeNull();
  });

  test('starts training unbound when no deployment group is selected', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    runtime.clearSelection();

    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.getFocusAnchor()).toBeNull();
    expect(runtime.getCardRows().some((row) => row.selected)).toBe(false);
  });

  test('unbinds instead of falling through to another squad when the focused squad is gone', () => {
    const runtime = new BattleRuntime(buildInit());
    const first = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: -50,
      placed: true,
      controlMode: 'USER'
    });
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -450,
      y: 50,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    runtime.setSelectedDeployGroup(first.groupId);
    runtime.setFocusSquad(first.groupId);

    expect(runtime.startBattle().ok).toBe(true);
    const focusedSquad = runtime.getSquadById('attacker_squad_1');
    expect(runtime.getFocusAnchor()?.squadId).toBe(focusedSquad.id);

    focusedSquad.remain = 0;
    runtime.updateCameraAnchor(0);

    expect(runtime.getFocusAnchor()).toBeNull();
    expect(runtime.focusSquadId).toBe('');
    expect(runtime.selectedBattleSquadId).toBe('');
  });

  test('keeps a pocket formation skeleton while changing soldier spacing', () => {
    const init = buildInit();
    init.attacker.rosterUnits = [{ unitTypeId: 'infantry_basic', count: 200 }];
    const runtime = new BattleRuntime(init);
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 200 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER',
      templateFormations: [{
        formationId: 'pocket',
        name: '口袋阵',
        placements: [
          { unitTypeId: 'infantry_basic', x: 0, y: 0 },
          { unitTypeId: 'infantry_basic', x: 2, y: 0 },
          { unitTypeId: 'infantry_basic', x: 0, y: 1 },
          { unitTypeId: 'infantry_basic', x: 2, y: 1 }
        ]
      }],
      activeFormationId: 'pocket'
    });
    expect(created.ok).toBe(true);
    runtime.setSelectedDeployGroup(created.groupId);
    runtime.setFocusSquad(created.groupId);

    expect(runtime.startBattle().ok).toBe(true);
    const squad = runtime.getSquadById('attacker_squad_1');
    const agents = runtime.crowd.agentsBySquad.get(squad.id);
    const upperLeft = agents.find((agent) => agent.formationSlot.side < 0 && agent.formationSlot.front > 0);
    const upperRight = agents.find((agent) => agent.formationSlot.side > 0 && agent.formationSlot.front > 0);
    const lowerLeft = agents.find((agent) => agent.formationSlot.side < 0 && agent.formationSlot.front < 0);
    const standardPocketWidth = upperRight.formationSpacingSlots.standard.side - upperLeft.formationSpacingSlots.standard.side;
    const compactPocketWidth = upperRight.formationSpacingSlots.compact.side - upperLeft.formationSpacingSlots.compact.side;
    const standardRankGap = upperLeft.formationSpacingSlots.standard.front - lowerLeft.formationSpacingSlots.standard.front;
    const compactRankGap = upperLeft.formationSpacingSlots.compact.front - lowerLeft.formationSpacingSlots.compact.front;

    expect(squad.formationSpacing).toBe('standard');
    expect(compactPocketWidth).toBeCloseTo(standardPocketWidth, 6);
    expect(compactRankGap).toBeCloseTo(standardRankGap * 0.76, 6);
    expect(runtime.commandFormationSpacing(squad.id, 'loose')).toBe(true);
    expect(squad.formationSpacing).toBe('loose');
    expect(squad.speedPolicy).toBe('MARCH');
  });

  test('settles a compact formation after changing spacing and stopping', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 30 },
      x: -450,
      y: 0,
      placed: true,
      controlMode: 'USER'
    });
    expect(created.ok).toBe(true);
    runtime.setSelectedDeployGroup(created.groupId);
    runtime.setFocusSquad(created.groupId);
    expect(runtime.startBattle().ok).toBe(true);

    const squad = runtime.getSquadById('attacker_squad_1');
    for (let index = 0; index < 180; index += 1) runtime.step(0.016);
    expect(runtime.commandFormationSpacing(squad.id, 'compact')).toBe(true);
    for (let index = 0; index < 300; index += 1) runtime.step(0.016);
    expect(runtime.commandMove(squad.id, { x: -412, y: 12 })).toBe(true);
    for (let index = 0; index < 600; index += 1) runtime.step(0.016);

    const agents = runtime.crowd.agentsBySquad.get(squad.id).filter((agent) => !agent.isFlagBearer);
    const settled = new Map(agents.map((agent) => [agent.id, { x: agent.x, y: agent.y }]));
    for (let index = 0; index < 120; index += 1) runtime.step(0.016);

    const maxDrift = Math.max(...agents.map((agent) => {
      const previous = settled.get(agent.id);
      return Math.hypot(agent.x - previous.x, agent.y - previous.y);
    }));
    const maxSpeed = Math.max(...agents.map((agent) => Math.hypot(agent.vx, agent.vy)));
    expect(maxDrift).toBeLessThan(0.02);
    expect(maxSpeed).toBeLessThan(0.02);
  });

  test('tracks configured slot cooldowns and training skill points independently', () => {
    const runtime = new BattleRuntime(buildInit());
    const created = runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 30 },
      x: -420,
      y: 0,
      placed: true,
      controlMode: 'USER'
    });
    expect(runtime.setDeployGroupSkillSlots(created.groupId, [{
      slotIndex: 0,
      treeCategory: 'melee',
      skillId: 'melee_heavy_blow'
    }]).ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);

    const squadId = 'attacker_squad_1';
    const metaBefore = runtime.getSkillMetaForSquad(squadId).skills[0];
    expect(metaBefore.name).toBe('集体重击');
    expect(metaBefore.available).toBe(true);
    expect(runtime.commandSkillSlot(squadId, 0, { x: 20, y: 0 }).ok).toBe(true);
    const cooldownAfterCast = runtime.getSkillMetaForSquad(squadId).skills[0].cooldownRemain;
    expect(cooldownAfterCast).toBeGreaterThan(17);

    runtime.step(1);
    expect(runtime.getSkillMetaForSquad(squadId).skills[0].cooldownRemain).toBeLessThan(cooldownAfterCast);
    expect(runtime.adjustTrainingSkillPoints(1).ok).toBe(true);
    expect(runtime.unlockTrainingSkill(squadId, 'melee', 'melee_rapid_slash').ok).toBe(true);
    expect(runtime.equipTrainingSkill(squadId, 0, 'melee_rapid_slash').ok).toBe(true);
  });

  test('starts each default training tree with only its root and first active skill learned', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -440,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);

    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.getTrainingSkillTreeProgress('attacker_squad_1', 'melee').unlocked).toEqual([
      'melee_war_form',
      'melee_heavy_blow'
    ]);
  });

  test('awards skill points by the selected training interval', () => {
    const runtime = new BattleRuntime(buildInit());
    expect(runtime.createDeployGroup('attacker', {
      units: { infantry_basic: 20 },
      x: -440,
      y: 0,
      placed: true,
      controlMode: 'USER'
    }).ok).toBe(true);
    expect(runtime.startBattle().ok).toBe(true);
    expect(runtime.setTrainingSkillPointInterval(10).ok).toBe(true);

    for (let index = 0; index < 200; index += 1) runtime.step(0.05);

    expect(runtime.getTrainingState().points).toBe(1);
    expect(runtime.getTrainingState().pointIntervalSec).toBe(10);
  });
});
