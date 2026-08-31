import {
  createCrowdSim,
  getCrowdAgentsForSquad,
  updateCrowdSim
} from './CrowdSim';

const makeSlots = (columns = 3, rows = 3, spacing = 8) => (
  Array.from({ length: columns * rows }, (_, index) => ({
    side: ((index % columns) - ((columns - 1) * 0.5)) * spacing,
    front: -Math.floor(index / columns) * spacing
  }))
);

const createCardSquad = ({
  id = 'card-locomotion',
  x = -420,
  y = 0,
  slots = makeSlots(),
  target = { x: 560, y: 0 },
  waypoints = null
} = {}) => ({
  id,
  team: 'attacker',
  x,
  y,
  startCount: slots.length,
  remain: slots.length,
  maxHealth: slots.length * 100,
  health: slots.length * 100,
  radius: 14,
  classTag: 'infantry',
  roleTag: '近战',
  unitCategory: 'melee',
  units: { card_locomotion_infantry: slots.length },
  stats: { atk: 1, def: 1, speed: 2, range: 1, attackRange: { min: 0, max: 1 } },
  behavior: 'move',
  controlMode: 'USER',
  stamina: 100,
  formationRect: {
    width: Math.max(8, Math.sqrt(slots.length) * 8),
    depth: Math.max(8, Math.ceil(slots.length / Math.max(1, Math.round(Math.sqrt(slots.length)))) * 8),
    spacing: 8,
    slotCount: slots.length,
    facingRad: 0,
    directionOffsetRad: 0
  },
  deploySlots: slots,
  order: {
    type: 'MOVE',
    targetPoint: target,
    pathPoints: [target],
    pathIndex: 0
  },
  waypoints: Array.isArray(waypoints) ? waypoints : [target]
});

const createScenario = ({ squad, buildings = [], field = { width: 1400, height: 600 } } = {}) => {
  const sim = {
    timeElapsed: 0,
    field,
    buildings,
    trainingObjectives: [],
    squads: [squad],
    trainingMap: { navigation: { agentRadius: 2.25 } }
  };
  const crowd = createCrowdSim(sim, {
    unitTypeMap: new Map([['card_locomotion_infantry', {
      classTag: 'infantry',
      roleTag: '近战',
      unitCategory: 'melee',
      speed: 2,
      attackRange: { min: 0, max: 1 }
    }]]),
    repConfig: { maxAgentWeight: 1, strictAgentMapping: true }
  });
  return { sim, crowd };
};

const stableSlots = (agents = []) => new Map(agents.map((agent) => [agent.id, {
  side: agent.formationSlot?.side,
  front: agent.formationSlot?.front,
  row: agent._squadController?.row,
  column: agent._squadController?.column,
  slotKey: agent._squadController?.slotKey
}]));

const expectSlotsUnchanged = (agents = [], before = new Map()) => {
  agents.forEach((agent) => {
    expect({
      side: agent.formationSlot?.side,
      front: agent.formationSlot?.front,
      row: agent._squadController?.row,
      column: agent._squadController?.column,
      slotKey: agent._squadController?.slotKey
    }).toEqual(before.get(agent.id));
  });
};

describe('CARD formation locomotion', () => {
  test('SCENE A: transports persistent slots as one locked formation in open straight marching', () => {
    const squad = createCardSquad();
    const { sim, crowd } = createScenario({ squad });
    const agents = getCrowdAgentsForSquad(crowd, squad.id);
    for (let index = 0; index < 12; index += 1) updateCrowdSim(crowd, sim, 0.05);
    const slots = stableSlots(agents);
    const modes = [];
    const p90Samples = [];

    for (let index = 0; index < 200; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
      modes.push(squad.formationRuntime?.locomotionMode);
      if (index > 18) p90Samples.push(Number(squad.formationRuntime?.slotErrorP90) || 0);
      expectSlotsUnchanged(agents, slots);
    }

    expect(modes).toContain('MARCH_LOCKED');
    expect(modes).not.toContain('PASSAGE_STREAM');
    expect(Math.max(...p90Samples)).toBeLessThan(0.35);
    expect(squad.formationRuntime?.lockedWeightRatio).toBeGreaterThan(0.94);
  });

  test('SCENE B: constrains outer-slot speed through an open 90 degree turn', () => {
    const squad = createCardSquad({
      id: 'card-open-turn',
      target: { x: -240, y: 280 },
      waypoints: [{ x: -240, y: 0 }, { x: -240, y: 280 }]
    });
    const { sim, crowd } = createScenario({ squad });
    const agents = getCrowdAgentsForSquad(crowd, squad.id);
    for (let index = 0; index < 12; index += 1) updateCrowdSim(crowd, sim, 0.05);
    const slots = stableSlots(agents);
    const modes = new Set();
    let maxYawDelta = 0;
    let previousYaw = Number(squad._formationPoseYaw) || 0;
    let maxSlotSpeedOverBudget = 0;

    for (let index = 0; index < 360; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
      modes.add(squad.formationRuntime?.locomotionMode);
      const yaw = Number(squad._formationPoseYaw) || 0;
      maxYawDelta = Math.max(maxYawDelta, Math.abs(yaw - previousYaw));
      previousYaw = yaw;
      const budget = Number(squad._cardFormationSlotSpeedBudget) || Infinity;
      maxSlotSpeedOverBudget = Math.max(
        maxSlotSpeedOverBudget,
        (Number(squad.formationRuntime?.maxSlotTargetSpeed) || 0) - budget
      );
      expectSlotsUnchanged(agents, slots);
    }

    expect(maxYawDelta).toBeGreaterThan(0.01);
    expect(Math.abs(Number(squad._formationPoseYaw) || 0)).toBeGreaterThan(0.8);
    expect(modes).toContain('MARCH_LOCKED');
    expect(modes).not.toContain('PASSAGE_STREAM');
    expect(maxSlotSpeedOverBudget).toBeLessThan(0.25);
    expect(agents.filter((agent) => agent._formationDetached).length).toBe(0);
  });

  test('SCENE C: arrives, settles persistent slots, then remains HOLD_LOCKED', () => {
    const squad = createCardSquad({
      id: 'card-arrival-settle',
      target: { x: -260, y: 0 }
    });
    const { sim, crowd } = createScenario({ squad });
    const agents = getCrowdAgentsForSquad(crowd, squad.id);
    for (let index = 0; index < 12; index += 1) updateCrowdSim(crowd, sim, 0.05);
    const slots = stableSlots(agents);

    for (let index = 0; index < 700 && squad.order.type !== 'IDLE'; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
    }
    for (let index = 0; index < 100; index += 1) updateCrowdSim(crowd, sim, 0.05);

    expect(squad.order.type).toBe('IDLE');
    expect(squad.formationRuntime?.locomotionMode).toBe('HOLD_LOCKED');
    expect(Number(squad.formationRuntime?.slotErrorP90) || 0).toBeLessThan(1.1);
    expect(agents.every((agent) => Math.hypot(agent.vx || 0, agent.vy || 0) <= 0.001)).toBe(true);
    expectSlotsUnchanged(agents, slots);
  });

  test('SCENE D: lets one flank flex around a small tower and restores the same slots', () => {
    const squad = createCardSquad({
      id: 'card-side-tower',
      target: { x: 360, y: 0 }
    });
    const tower = {
      id: 'small-flank-tower',
      x: -300,
      y: 9,
      width: 12,
      depth: 12,
      blocksMovement: true,
      blocksVision: true
    };
    const { sim, crowd } = createScenario({ squad, buildings: [tower] });
    const agents = getCrowdAgentsForSquad(crowd, squad.id);
    for (let index = 0; index < 12; index += 1) updateCrowdSim(crowd, sim, 0.05);
    const slots = stableSlots(agents);
    const modes = new Set();

    for (let index = 0; index < 420; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
      modes.add(squad.formationRuntime?.locomotionMode);
      expectSlotsUnchanged(agents, slots);
    }

    expect(modes).toContain('MARCH_ELASTIC');
    expect(modes).not.toContain('PASSAGE_STREAM');
    expect(squad.formationRuntime?.locomotionMode).toBe('MARCH_LOCKED');
    expect(squad.formationRuntime?.elasticWeightRatio || 0).toBeLessThan(0.06);
  });

  test('SCENE E: treats a real choke as passage stream, then reforms persistent topology', () => {
    const slots = makeSlots(3, 3, 8);
    const squad = createCardSquad({
      id: 'card-real-choke',
      x: -70,
      slots,
      target: { x: 140, y: 0 }
    });
    const gateWalls = [
      { id: 'choke-top', x: 0, y: 36, width: 40, depth: 60, blocksMovement: true },
      { id: 'choke-bottom', x: 0, y: -36, width: 40, depth: 60, blocksMovement: true }
    ];
    const { sim, crowd } = createScenario({
      squad,
      buildings: gateWalls,
      field: { width: 420, height: 220 }
    });
    const agents = getCrowdAgentsForSquad(crowd, squad.id);
    for (let index = 0; index < 12; index += 1) updateCrowdSim(crowd, sim, 0.05);
    const persistentSlots = stableSlots(agents);
    const modes = [];

    for (let index = 0; index < 1000 && squad.order.type !== 'IDLE'; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
      modes.push(squad.formationRuntime?.locomotionMode);
      expectSlotsUnchanged(agents, persistentSlots);
    }

    expect(modes).toContain('MARCH_LOCKED');
    expect(modes).toContain('MARCH_ELASTIC');
    expect(modes).toContain('PASSAGE_STREAM');
    expect(modes).toContain('REFORM');
    expect(squad.order.type).toBe('IDLE');
    expect(squad.formationRuntime?.locomotionMode).toBe('HOLD_LOCKED');
  });

  test('SCENE F: preserves real-body anchor bounds through an S sequence of passages', () => {
    const slots = makeSlots(3, 3, 8);
    const squad = createCardSquad({
      id: 'card-s-passage',
      x: -280,
      slots,
      target: { x: 280, y: 0 },
      waypoints: [{ x: -90, y: -8 }, { x: 90, y: 8 }, { x: 280, y: 0 }]
    });
    const makeGate = (id, x, centerY) => {
      const halfHeight = 150;
      const halfGap = 6;
      const topStart = centerY + halfGap;
      const bottomEnd = centerY - halfGap;
      return [
        {
          id: `${id}-top`,
          x,
          y: (halfHeight + topStart) * 0.5,
          width: 40,
          depth: halfHeight - topStart,
          blocksMovement: true
        },
        {
          id: `${id}-bottom`,
          x,
          y: (-halfHeight + bottomEnd) * 0.5,
          width: 40,
          depth: bottomEnd + halfHeight,
          blocksMovement: true
        }
      ];
    };
    const { sim, crowd } = createScenario({
      squad,
      buildings: [...makeGate('s-left', -90, -8), ...makeGate('s-right', 90, 8)],
      field: { width: 720, height: 300 }
    });
    const agents = getCrowdAgentsForSquad(crowd, squad.id);
    for (let index = 0; index < 12; index += 1) updateCrowdSim(crowd, sim, 0.05);
    const persistentSlots = stableSlots(agents);
    const passageIds = new Set();
    const modes = new Set();
    let maximumAnchorLead = 0;

    for (let index = 0; index < 1600 && squad.order.type !== 'IDLE'; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
      modes.add(squad.formationRuntime?.locomotionMode);
      const passageId = Number(squad.passageDebug?.passageId) || 0;
      if (passageId > 0) passageIds.add(passageId);
      const body = squad.bodyAnchor;
      const navigation = squad.navigationAnchor;
      const formation = squad.formationAnchor;
      if (body && navigation && formation) {
        maximumAnchorLead = Math.max(
          maximumAnchorLead,
          Math.hypot(navigation.x - body.x, navigation.y - body.y),
          Math.hypot(formation.x - body.x, formation.y - body.y)
        );
        expect(Math.hypot(navigation.x - body.x, navigation.y - body.y)).toBeLessThanOrEqual(body.maxAnchorLead + 0.001);
        expect(Math.hypot(formation.x - body.x, formation.y - body.y)).toBeLessThanOrEqual(body.maxAnchorLead + 0.001);
      }
      expectSlotsUnchanged(agents, persistentSlots);
    }

    expect(passageIds.size).toBeGreaterThanOrEqual(2);
    expect(modes).toContain('PASSAGE_STREAM');
    expect(modes).toContain('REFORM');
    expect(maximumAnchorLead).toBeGreaterThan(0);
    expect(squad.order.type).toBe('IDLE');
    expect(squad.formationRuntime?.locomotionMode).toBe('HOLD_LOCKED');
    expect(squad.formationRuntime?.slotErrorP90 || 0).toBeLessThan(1.1);
    expect(squad.formationRuntime?.passageGroupState).not.toBe('GROUP_BLOCKED');
  });
});
