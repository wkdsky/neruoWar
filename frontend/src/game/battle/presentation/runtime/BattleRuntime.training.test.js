import BattleRuntime from './BattleRuntime';

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

describe('BattleRuntime training control', () => {
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
    expect(runtime.getMinimapSnapshot().squads).toHaveLength(0);
    expect(runtime.getRenderSnapshot().units.count).toBe(0);
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
