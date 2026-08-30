import {
  createCrowdSim,
  getCrowdAgentsForSquad,
  updateCrowdSim
} from './CrowdSim';
import {
  createTrainingCardPassagePlan,
  resolvePassageStreamCount,
  resolveTrainingCardPassageFlowIntent,
  resolveTrainingCardPassageFlowSteering,
  updateTrainingCardPassageAgents
} from './TrainingCardPassage';

const buildSquad = ({ controlMode = 'USER', behavior = 'move' } = {}) => {
  const spacing = 8;
  const deploySlots = [
    { side: 0, front: 0 },
    { side: -spacing, front: 0 },
    { side: spacing, front: 0 },
    { side: -spacing, front: -spacing },
    { side: 0, front: -spacing },
    { side: spacing, front: -spacing },
    { side: -spacing, front: -spacing * 2 },
    { side: 0, front: -spacing * 2 },
    { side: spacing, front: -spacing * 2 }
  ];
  return {
    id: 'stream-test',
    team: 'attacker',
    x: -70,
    y: 0,
    startCount: 9,
    remain: 9,
    maxHealth: 900,
    health: 900,
    radius: 12,
    classTag: 'infantry',
    units: { infantry_basic: 9 },
    stats: { atk: 1, speed: 1.5 },
    behavior,
    controlMode,
    stamina: 100,
    formationRect: {
      width: spacing * 3,
      depth: spacing * 3,
      spacing,
      slotCount: deploySlots.length,
      facingRad: 0,
      directionOffsetRad: 0
    },
    deploySlots,
    order: {
      type: 'MOVE',
      targetPoint: { x: 90, y: 0 },
      pathPoints: [{ x: 90, y: 0 }],
      pathIndex: 0
    },
    waypoints: [{ x: 90, y: 0 }]
  };
};

const buildSim = (squad, walls) => ({
  timeElapsed: 0,
  field: { width: 320, height: 180 },
  buildings: walls,
  squads: [squad],
  trainingObjectives: [],
  trainingMap: {
    navigation: {
      agentRadius: 2.25,
      pathClearance: 1.2,
      narrowPassage: { probeDistance: 36, probeStep: 1, entryDistance: 42 }
    }
  }
});

test('keeps a shared multi-state passage plan stable through a gate', () => {
  const squad = buildSquad();
  const walls = [
    { id: 'gate-top', x: 0, y: 36, width: 40, depth: 60, blocksMovement: true },
    { id: 'gate-bottom', x: 0, y: -36, width: 40, depth: 60, blocksMovement: true }
  ];
  const sim = buildSim(squad, walls);
  const crowd = createCrowdSim(sim, { repConfig: { maxAgentWeight: 1, strictAgentMapping: true } });
  let seen = new Set();
  let maxPlanId = 0;
  let firstPlanId = 0;
  const planIds = new Set();
  for (let index = 0; index < 900; index += 1) {
    updateCrowdSim(crowd, sim, 0.05);
    const agents = getCrowdAgentsForSquad(crowd, squad.id);
    agents.forEach((agent) => seen.add(String(agent?._squadController?.locomotionState || '')));
    maxPlanId = Math.max(maxPlanId, Number(squad?.passageDebug?.passageId) || 0);
    const plan = squad?._squadController?.passagePlan;
    if (plan?.id) {
      if (!firstPlanId) firstPlanId = plan.id;
      planIds.add(plan.id);
    }
  }
  expect(maxPlanId).toBeGreaterThan(0);
  expect(planIds.size).toBeLessThanOrEqual(2);
  expect(seen.has('STREAM')).toBe(true);
  expect(seen.has('STREAM_EXIT')).toBe(true);
  expect(squad.passageDebug.passageActive).toBe(false);
  expect(squad.order.type).toBe('IDLE');
  expect(firstPlanId).toBe(1);
});

test('keeps the passage plan alive for the trailing formation after anchor arrival', () => {
  const squad = buildSquad();
  const spacing = 8;
  const columns = 6;
  const count = 36;
  squad.startCount = count;
  squad.remain = count;
  squad.units = { infantry_basic: count };
  squad.formationRect = {
    width: spacing * columns,
    depth: spacing * Math.ceil(count / columns),
    spacing,
    slotCount: count,
    facingRad: 0,
    directionOffsetRad: 0
  };
  squad.deploySlots = Array.from({ length: count }, (_, index) => ({
    side: ((index % columns) - ((columns - 1) * 0.5)) * spacing,
    front: -Math.floor(index / columns) * spacing
  }));
  const walls = [
    { id: 'gate-top-tail', x: 0, y: 36, width: 40, depth: 60, blocksMovement: true },
    { id: 'gate-bottom-tail', x: 0, y: -36, width: 40, depth: 60, blocksMovement: true }
  ];
  const sim = buildSim(squad, walls);
  const crowd = createCrowdSim(sim, { repConfig: { maxAgentWeight: 1, strictAgentMapping: true } });
  let anchorArrived = false;
  let planSurvivedAnchorArrival = false;
  let sawTailStream = false;
  for (let frame = 0; frame < 900; frame += 1) {
    updateCrowdSim(crowd, sim, 0.05);
    if (!anchorArrived && squad.x > 80) anchorArrived = true;
    if (anchorArrived && squad._squadController?.passagePlan) planSurvivedAnchorArrival = true;
    const agents = getCrowdAgentsForSquad(crowd, squad.id);
    sawTailStream = sawTailStream || agents.some((agent) => (
      agent._squadController?.locomotionState === 'STREAM'
      && Number(agent.x) < 15
    ));
    if (squad.order.type === 'IDLE') break;
  }
  expect(anchorArrived).toBe(true);
  expect(planSurvivedAnchorArrival).toBe(true);
  expect(sawTailStream).toBe(true);
  expect(squad.order.type).toBe('IDLE');
});

test('reports lane capacity across corridor widths', () => {
  [1, 2, 4, 6].forEach((expected) => {
    const laneWidth = 5.55;
    const usableWidth = Math.max(1, (expected * laneWidth) - 0.2);
    expect(resolvePassageStreamCount({ usableWidth, agentRadius: 2.25, agentGap: 1.05 })).toBe(expected);
  });
});

const buildDirectPassagePlan = () => createTrainingCardPassagePlan({
  squad: {
    x: -80,
    y: 0,
    formationRect: { width: 32, spacing: 8 },
    deploySlots: []
  },
  sim: { field: { width: 320, height: 180 } },
  walls: [
    { id: 'top', x: 0, y: 40, width: 40, depth: 60, blocksMovement: true },
    { id: 'bottom', x: 0, y: -40, width: 40, depth: 60, blocksMovement: true }
  ],
  route: [{ x: -80, y: 0 }, { x: 80, y: 0 }],
  nowSec: 0
});

test('keeps stream assignment and steering independent from formation slot', () => {
  const plan = buildDirectPassagePlan();
  expect(plan).toBeTruthy();
  const agent = {
    id: 'a', squadId: 's', x: -5, y: -4, weight: 1,
    formationSlot: { side: 100, front: -200 },
    _squadController: {}
  };
  const squad = { id: 's', _squadController: { passagePlan: plan } };
  updateTrainingCardPassageAgents({ squad, agents: [agent], plan, nowSec: 1 });
  expect(agent._squadController.streamId).toEqual(expect.any(Number));
  expect(agent._squadController.locomotionState).toBe('STREAM');
  const firstStream = agent._squadController.streamId;
  agent.y = 18;
  updateTrainingCardPassageAgents({ squad, agents: [agent], plan, nowSec: 2 });
  expect(agent._squadController.streamId).toBe(firstStream);
  const flow = resolveTrainingCardPassageFlowIntent({ squad, agent, runtime: squad._squadController });
  const firstLaneError = flow.laneError;
  agent._squadController.normalSlot = { side: -100, front: 200 };
  const flowWithDifferentSlot = resolveTrainingCardPassageFlowIntent({ squad, agent, runtime: squad._squadController });
  expect(flowWithDifferentSlot.laneError).toBe(firstLaneError);
  const steering = resolveTrainingCardPassageFlowSteering({
    agent,
    squad,
    flowIntent: flow,
    neighbors: [],
    speed: 20
  });
  expect(steering.targetSpeed).toBe(20);
  expect(steering.forwardX).toBe(1);
});

test('follows the shared route tangent after a passage turn', () => {
  const plan = {
    ...buildDirectPassagePlan(),
    route: [{ x: -80, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 80 }],
    segments: [
      {
        start: { x: -80, y: 0 },
        end: { x: 0, y: 0 },
        length: 80,
        startProgress: 0,
        endProgress: 80,
        tangent: { x: 1, y: 0 }
      },
      {
        start: { x: 0, y: 0 },
        end: { x: 0, y: 80 },
        length: 80,
        startProgress: 80,
        endProgress: 160,
        tangent: { x: 0, y: 1 }
      }
    ],
    routeLength: 160,
    bottleneckStartProgress: 24,
    bottleneckEndProgress: 56,
    startProgress: 0,
    endProgress: 110,
    clearProgress: 72,
    reformationDistance: 24,
    geometrySignature: 'turning-route'
  };
  const squad = {
    id: 'turn-squad',
    x: 0,
    y: 0,
    _squadController: { passagePlan: plan }
  };
  const agent = {
    id: 'turn-agent',
    squadId: squad.id,
    x: 0,
    y: 30,
    weight: 1,
    _squadController: {
      locomotionState: 'STREAM',
      passageId: plan.id,
      passageSignature: plan.geometrySignature,
      streamId: 0
    }
  };
  const flow = resolveTrainingCardPassageFlowIntent({
    squad,
    agent,
    runtime: squad._squadController
  });
  expect(flow.forwardX).toBeCloseTo(0);
  expect(flow.forwardY).toBeCloseTo(1);
});

test('moves agents through stream exit before returning them to formation', () => {
  const plan = buildDirectPassagePlan();
  const squad = { id: 'exit-squad', _squadController: { passagePlan: plan } };
  const agent = {
    id: 'exit-agent',
    squadId: squad.id,
    x: -80 + plan.bottleneckEndProgress + (plan.exitClearDistance * 0.65),
    y: 0,
    weight: 1,
    formationSlot: { side: 0, front: 0 },
    _squadController: {}
  };
  updateTrainingCardPassageAgents({ squad, agents: [agent], plan, nowSec: 1 });
  expect(agent._squadController.locomotionState).toBe('STREAM_EXIT');
  agent.x = 80;
  updateTrainingCardPassageAgents({ squad, agents: [agent], plan, nowSec: 2 });
  expect(agent._squadController.locomotionState).toBe('FORMATION');
  expect(agent._squadController.passageCompletedId).toBe(plan.id);
});

test('maintains forward throughput in a long corridor', () => {
  const squad = buildSquad();
  squad.x = -120;
  squad.order.targetPoint = { x: 240, y: 0 };
  squad.waypoints = [{ x: 240, y: 0 }];
  const walls = [
    { id: 'long-top', x: 80, y: 48, width: 320, depth: 70, blocksMovement: true },
    { id: 'long-bottom', x: 80, y: -48, width: 320, depth: 70, blocksMovement: true }
  ];
  const sim = buildSim(squad, walls);
  sim.field = { width: 600, height: 220 };
  const crowd = createCrowdSim(sim, { repConfig: { maxAgentWeight: 1, strictAgentMapping: true } });
  let maxStreaming = 0;
  let minStreamingSpeed = Infinity;
  let maxExiting = 0;
  let maxStreamCount = 0;
  for (let frame = 0; frame < 1400; frame += 1) {
    updateCrowdSim(crowd, sim, 0.05);
    const agents = getCrowdAgentsForSquad(crowd, squad.id).filter((agent) => !agent.isFlagBearer);
    const streaming = agents.filter((agent) => agent._squadController?.locomotionState === 'STREAM');
    const exiting = agents.filter((agent) => agent._squadController?.locomotionState === 'STREAM_EXIT');
    maxStreamCount = Math.max(maxStreamCount, Number(squad.passageDebug?.streamCount) || 0);
    maxStreaming = Math.max(maxStreaming, streaming.length);
    maxExiting = Math.max(maxExiting, exiting.length);
    for (let index = 0; index < streaming.length; index += 1) {
      const agent = streaming[index];
      minStreamingSpeed = Math.min(minStreamingSpeed, Math.hypot(agent.vx, agent.vy));
    }
  }
  expect(maxStreamCount).toBeGreaterThanOrEqual(2);
  expect(maxStreaming).toBeGreaterThanOrEqual(2);
  expect(maxExiting).toBeGreaterThanOrEqual(1);
  expect(minStreamingSpeed).toBeGreaterThan(20);
  expect(squad.x).toBeGreaterThan(220);
});

test('replans the next bottleneck on a shared multi-gate route', () => {
  const squad = buildSquad();
  squad.x = -150;
  squad.order.targetPoint = { x: 260, y: 0 };
  squad.order.pathPoints = [{ x: 260, y: 0 }];
  squad.waypoints = [{ x: 260, y: 0 }];
  const walls = [
    { id: 'gate-one-top', x: -20, y: 36, width: 40, depth: 60, blocksMovement: true },
    { id: 'gate-one-bottom', x: -20, y: -36, width: 40, depth: 60, blocksMovement: true },
    { id: 'gate-two-top', x: 100, y: 36, width: 40, depth: 60, blocksMovement: true },
    { id: 'gate-two-bottom', x: 100, y: -36, width: 40, depth: 60, blocksMovement: true }
  ];
  const sim = buildSim(squad, walls);
  sim.field = { width: 600, height: 180 };
  const crowd = createCrowdSim(sim, { repConfig: { maxAgentWeight: 1, strictAgentMapping: true } });
  const planIds = new Set();
  for (let frame = 0; frame < 1800 && squad.order.type !== 'IDLE'; frame += 1) {
    updateCrowdSim(crowd, sim, 0.05);
    const planId = Number(squad.passageDebug?.passageId) || 0;
    if (planId > 0) planIds.add(planId);
  }
  expect(planIds.size).toBeGreaterThanOrEqual(2);
  expect(squad.x).toBeGreaterThan(250);
  expect(squad.order.type).toBe('IDLE');
});
