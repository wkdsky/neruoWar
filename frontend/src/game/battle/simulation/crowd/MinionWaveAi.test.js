import {
  MINION_WAVE_AI_STATE,
  resolveMinionWaveAgentAttackRange,
  updateMinionWaveAiFrame
} from './MinionWaveAi';

const buildSquad = ({ id, team, x, path, count = 1 } = {}) => ({
  id,
  team,
  x,
  y: 0,
  remain: count,
  startCount: count,
  radius: 10,
  isMinionWaveUnit: true,
  minionLaneId: 'mid',
  minionBarracksLane: 'top',
  minionPath: path,
  minionPathIndex: 1,
  minionPathSpeed: 30,
  minionPathProgress: 0,
  behavior: 'auto',
  waypoints: [],
  order: { type: 'IDLE', targetSquadId: '', targetBuildingId: '' }
});

const buildAgent = ({ id, squad, x, category = 'melee', side = 0, slotOrder = 0 } = {}) => ({
  id,
  squadId: squad.id,
  team: squad.team,
  x,
  y: side,
  vx: 0,
  vy: 0,
  radius: 2.25,
  weight: 1,
  hpWeight: 1,
  initialWeight: 1,
  typeCategory: category === 'ranged' ? 'archer' : 'infantry',
  unitCategory: category,
  unitSubtype: category === 'support' ? 'comprehensive' : 'balance',
  attackRangeMin: category === 'ranged' ? 56 : 0,
  attackRangeMax: category === 'ranged' ? 112 : 6.2,
  formationSlot: { side, front: category === 'melee' ? 0 : (category === 'ranged' ? -18 : -36) },
  slotOrder,
  targetAgentId: '',
  targetBuildingId: '',
  supportTargetAgentId: '',
  supportTargetSquadId: '',
  dead: false
});

const buildScenario = ({ attackerX = -60, defenderX = 60, extraDefenderX = null } = {}) => {
  const attacker = buildSquad({
    id: 'attacker-wave',
    team: 'attacker',
    x: attackerX,
    path: [{ x: -200, y: 0 }, { x: 200, y: 0 }],
    count: 3
  });
  const defender = buildSquad({
    id: 'defender-wave-a',
    team: 'defender',
    x: defenderX,
    path: [{ x: 200, y: 0 }, { x: -200, y: 0 }],
    count: 3
  });
  const attackerAgents = [
    buildAgent({ id: 'attacker-melee', squad: attacker, x: attackerX, category: 'melee', side: -8, slotOrder: 0 }),
    buildAgent({ id: 'attacker-ranged', squad: attacker, x: attackerX - 18, category: 'ranged', side: 0, slotOrder: 1 }),
    buildAgent({ id: 'attacker-support', squad: attacker, x: attackerX - 36, category: 'support', side: 8, slotOrder: 2 })
  ];
  const defenderAgents = [
    buildAgent({ id: 'defender-melee-a', squad: defender, x: defenderX, category: 'melee', side: 8, slotOrder: 0 }),
    buildAgent({ id: 'defender-ranged-a', squad: defender, x: defenderX + 18, category: 'ranged', side: 0, slotOrder: 1 }),
    buildAgent({ id: 'defender-support-a', squad: defender, x: defenderX + 36, category: 'support', side: -8, slotOrder: 2 })
  ];
  const squads = [attacker, defender];
  const agentsBySquad = new Map([
    [attacker.id, attackerAgents],
    [defender.id, defenderAgents]
  ]);
  let extraDefender = null;
  if (extraDefenderX !== null && Number.isFinite(Number(extraDefenderX))) {
    extraDefender = buildSquad({
      id: 'defender-wave-b',
      team: 'defender',
      x: extraDefenderX,
      path: [{ x: 200, y: 0 }, { x: -200, y: 0 }],
      count: 1
    });
    squads.push(extraDefender);
    agentsBySquad.set(extraDefender.id, [
      buildAgent({ id: 'defender-melee-b', squad: extraDefender, x: extraDefenderX, category: 'melee' })
    ]);
  }
  const sim = {
    timeElapsed: 0,
    squads,
    buildings: [],
    trainingObjectives: []
  };
  const crowd = { agentsBySquad };
  const update = (nowSec = 0) => updateMinionWaveAiFrame({
    sim,
    crowd,
    nowSec,
    isPointWithinLane: () => true,
    assignWaypoints: (squad, waypoints) => {
      squad.waypoints = waypoints;
    }
  });
  return {
    attacker,
    defender,
    extraDefender,
    attackerAgents,
    defenderAgents,
    crowd,
    sim,
    update
  };
};

test('keeps an equal-priority target until that target becomes invalid', () => {
  const scenario = buildScenario({ attackerX: 0, defenderX: 70, extraDefenderX: 90 });

  scenario.update(0.05);

  expect(scenario.attacker.targetSquadId).toBe(scenario.defender.id);
  const firstRevision = scenario.attacker._minionAi.targetRevision;
  scenario.extraDefender.x = 10;
  scenario.crowd.agentsBySquad.get(scenario.extraDefender.id)[0].x = 10;

  scenario.update(0.1);

  expect(scenario.attacker.targetSquadId).toBe(scenario.defender.id);
  expect(scenario.attacker._minionAi.targetRevision).toBe(firstRevision);

  scenario.defender.remain = 0;
  scenario.defenderAgents.forEach((agent) => {
    agent.dead = true;
    agent.weight = 0;
  });
  scenario.update(0.15);

  expect(scenario.attacker.targetSquadId).toBe(scenario.extraDefender.id);
  expect(scenario.attacker._minionAi.targetRevision).toBe(firstRevision + 1);
});

test('discards the old combat anchor when switching to the next enemy squad', () => {
  const scenario = buildScenario({ attackerX: 0, defenderX: 24, extraDefenderX: 100 });
  scenario.update(0.05);
  const oldAnchor = { ...scenario.attacker._minionAi.holdAnchor };

  [scenario.attacker, scenario.defender].forEach((squad) => {
    squad.x = squad._minionAi.holdAnchor.x;
    squad.y = squad._minionAi.holdAnchor.y;
    scenario.crowd.agentsBySquad.get(squad.id).forEach((agent) => {
      agent.x = agent._minionAi.combatX;
      agent.y = agent._minionAi.combatY;
    });
  });
  scenario.update(0.1);
  expect(scenario.attacker.minionAiState).toBe(MINION_WAVE_AI_STATE.ATTACK_HOLD);

  scenario.defender.remain = 0;
  scenario.defenderAgents.forEach((agent) => {
    agent.dead = true;
    agent.weight = 0;
  });
  scenario.update(0.15);

  expect(scenario.attacker.targetSquadId).toBe(scenario.extraDefender.id);
  expect(scenario.attacker.minionAiState).toBe(MINION_WAVE_AI_STATE.APPROACH);
  expect(scenario.attacker._minionAi.holdAnchor.x).toBeGreaterThan(oldAnchor.x + 10);
  expect(scenario.attacker.waypoints.length).toBeGreaterThan(0);
  expect(scenario.attacker.waypoints[scenario.attacker.waypoints.length - 1].x)
    .toBeCloseTo(scenario.attacker._minionAi.holdAnchor.x, 6);
});

test('immediately restores a forward march route after combat ends', () => {
  const scenario = buildScenario({ attackerX: 0, defenderX: 24 });
  scenario.update(0.05);

  [scenario.attacker, scenario.defender].forEach((squad) => {
    squad.x = squad._minionAi.holdAnchor.x;
    squad.y = squad._minionAi.holdAnchor.y;
    scenario.crowd.agentsBySquad.get(squad.id).forEach((agent) => {
      agent.x = agent._minionAi.combatX;
      agent.y = agent._minionAi.combatY;
    });
  });
  scenario.update(0.1);
  const heldX = scenario.attacker.x;

  scenario.defender.remain = 0;
  scenario.defenderAgents.forEach((agent) => {
    agent.dead = true;
    agent.weight = 0;
  });
  scenario.update(0.15);

  expect(scenario.attacker.minionAiState).toBe(MINION_WAVE_AI_STATE.RESUME);
  expect(scenario.attacker.targetSquadId).toBe('');
  expect(scenario.attacker._combatEngagementTargetId).toBe('');
  expect(scenario.attacker.waypoints.length).toBeGreaterThan(0);
  expect(scenario.attacker.waypoints[0].x).toBeGreaterThan(heldX);
  expect(scenario.attacker.dirX).toBeGreaterThan(0.99);
  expect(Math.abs(scenario.attacker.dirY)).toBeLessThan(0.001);
});

test('moves through explicit approach and attack-hold states without moving ranged minions backward', () => {
  const scenario = buildScenario();
  const ranged = scenario.attackerAgents.find((agent) => agent.unitCategory === 'ranged');
  const rangedStartX = ranged.x;

  scenario.update(0.05);

  expect(scenario.attacker.minionAiState).toBe(MINION_WAVE_AI_STATE.APPROACH);
  expect(resolveMinionWaveAgentAttackRange(ranged, scenario.attacker).min).toBe(0);
  expect(ranged._minionAi.combatX).toBeGreaterThanOrEqual(rangedStartX);
  const stableTargetIds = scenario.attackerAgents.map((agent) => agent.targetAgentId);
  const stablePositions = scenario.attackerAgents.map((agent) => ({
    x: agent._minionAi.combatX,
    y: agent._minionAi.combatY
  }));

  [scenario.attacker, scenario.defender].forEach((squad) => {
    squad.x = squad._minionAi.holdAnchor.x;
    squad.y = squad._minionAi.holdAnchor.y;
    scenario.crowd.agentsBySquad.get(squad.id).forEach((agent) => {
      agent.x = agent._minionAi.combatX;
      agent.y = agent._minionAi.combatY;
    });
  });
  scenario.update(0.1);

  expect(scenario.attacker.minionAiState).toBe(MINION_WAVE_AI_STATE.ATTACK_HOLD);
  for (let step = 0; step < 5; step += 1) scenario.update(0.15 + (step * 0.05));
  expect(scenario.attacker.minionAiState).toBe(MINION_WAVE_AI_STATE.ATTACK_HOLD);
  expect(scenario.attackerAgents.map((agent) => agent.targetAgentId)).toEqual(stableTargetIds);
  expect(scenario.attackerAgents.map((agent) => ({
    x: agent._minionAi.combatX,
    y: agent._minionAi.combatY
  }))).toEqual(stablePositions);
});

test('starts the front-line fight without waiting for every straggler to reach an exact point', () => {
  const scenario = buildScenario({ attackerX: 0, defenderX: 24 });
  scenario.update(0.05);

  [scenario.attacker, scenario.defender].forEach((squad) => {
    squad.x = squad._minionAi.holdAnchor.x;
    squad.y = squad._minionAi.holdAnchor.y;
    const agents = scenario.crowd.agentsBySquad.get(squad.id);
    agents
      .filter((agent) => agent.unitCategory !== 'support')
      .forEach((agent) => {
        agent.x = agent._minionAi.combatX;
        agent.y = agent._minionAi.combatY;
      });
    const support = agents.find((agent) => agent.unitCategory === 'support');
    support.x -= squad.team === 'attacker' ? 40 : -40;
  });

  scenario.update(0.1);

  expect(scenario.attacker.minionAiState).toBe(MINION_WAVE_AI_STATE.ATTACK_HOLD);
  expect(scenario.defender.minionAiState).toBe(MINION_WAVE_AI_STATE.ATTACK_HOLD);
  expect(scenario.attacker.waypoints).toEqual([]);
  expect(scenario.defender.waypoints).toEqual([]);
});

test('reassigns only the soldier whose committed target died', () => {
  const scenario = buildScenario();
  scenario.update(0.05);
  const fighters = scenario.attackerAgents.filter((agent) => agent.unitCategory !== 'support');
  const first = fighters[0];
  const second = fighters[1];
  expect(first.targetAgentId).not.toBe('');
  expect(second.targetAgentId).not.toBe('');
  const firstTarget = scenario.defenderAgents.find((agent) => agent.id === first.targetAgentId);
  const secondTargetId = second.targetAgentId;
  const secondPositionRevision = second._minionAi.positionRevision;

  firstTarget.dead = true;
  firstTarget.weight = 0;
  scenario.update(0.1);

  expect(first.targetAgentId).not.toBe(firstTarget.id);
  expect(second.targetAgentId).toBe(secondTargetId);
  expect(second._minionAi.positionRevision).toBe(secondPositionRevision);
  const reassignedTargetId = first.targetAgentId;
  const reassignedPositionRevision = first._minionAi.positionRevision;

  scenario.update(0.15);

  expect(first.targetAgentId).toBe(reassignedTargetId);
  expect(first._minionAi.positionRevision).toBe(reassignedPositionRevision);
});

test('keeps infantry from backtracking when a replacement target is behind the wave', () => {
  const scenario = buildScenario({ attackerX: 0, defenderX: 20, extraDefenderX: -30 });
  scenario.update(0.05);

  const melee = scenario.attackerAgents.find((agent) => agent.unitCategory === 'melee');
  const initialTargetId = melee.targetAgentId;
  const initialPlanX = melee._minionAi.combatX;
  expect(initialTargetId).toBe(scenario.defenderAgents[0].id);

  scenario.defender.remain = 0;
  scenario.defenderAgents.forEach((agent) => {
    agent.dead = true;
    agent.weight = 0;
  });
  scenario.update(0.1);

  expect(melee.targetAgentId).toBe(scenario.crowd.agentsBySquad.get(scenario.extraDefender.id)[0].id);
  expect(melee._minionAi.combatX).toBeGreaterThanOrEqual(initialPlanX - 0.001);
});
