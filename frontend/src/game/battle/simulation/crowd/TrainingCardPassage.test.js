import {
  createCrowdSim,
  getCrowdAgentsForSquad,
  updateCrowdSim
} from './CrowdSim';
import {
  createTrainingCardPassagePlan,
  projectPointToPassagePlan,
  resolvePassageStreamCount,
  resolveTrainingCardPassageGroupProgress,
  resolveTrainingCardPassageFlowIntent,
  resolveTrainingCardPassageFlowSteering,
  updateTrainingCardPassageAgents,
  updateTrainingCardPassagePlan
} from './TrainingCardPassage';
import {
  createTrainingMapNavigator,
  planTrainingMapRoute
} from '../navigation/TrainingMapNavigator';

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

test('keeps the passage plan alive while the physical tail is still streaming', () => {
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
  let sawFrontExit = false;
  let planSurvivedFrontExit = false;
  let sawTailStream = false;
  let anchorLeadViolation = false;
  for (let frame = 0; frame < 900; frame += 1) {
    updateCrowdSim(crowd, sim, 0.05);
    const agents = getCrowdAgentsForSquad(crowd, squad.id);
    const tailStreaming = agents.some((agent) => (
      agent._squadController?.locomotionState === 'STREAM'
      && Number(agent.x) < 15
    ));
    const frontExiting = agents.some((agent) => (
      agent._squadController?.locomotionState === 'STREAM_EXIT'
    ));
    sawTailStream = sawTailStream || tailStreaming;
    sawFrontExit = sawFrontExit || frontExiting;
    if (frontExiting && tailStreaming && squad._squadController?.passagePlan) {
      planSurvivedFrontExit = true;
    }
    const body = squad.bodyAnchor;
    const navigation = squad.navigationAnchor;
    if (
      body && navigation
      && Number(navigation.lead) > Number(body.maxAnchorLead) + 0.05
    ) anchorLeadViolation = true;
    if (squad.order.type === 'IDLE') break;
  }
  expect(sawFrontExit).toBe(true);
  expect(planSurvivedFrontExit).toBe(true);
  expect(sawTailStream).toBe(true);
  expect(anchorLeadViolation).toBe(false);
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

test('keeps detached recovery/rejoin troop weight in the passage tail', () => {
  const plan = buildDirectPassagePlan();
  const squad = {
    id: 'tail-mass',
    x: 40,
    y: 0,
    bodyAnchor: { x: 40, y: 0, bodyProgress: 120, maxAnchorLead: 24 },
    navigationAnchor: { x: 80, y: 0 },
    formationRect: { width: 32, depth: 24, spacing: 8 },
    _squadController: { passagePlan: plan }
  };
  const agents = [
    { id: 'front', squadId: squad.id, x: 80, y: 0, weight: 7, _squadController: {} },
    {
      id: 'tail', squadId: squad.id, x: -20, y: 0, weight: 3,
      _formationDetached: true,
      _formationRecovery: { active: true },
      _squadController: { rejoin: { active: true } }
    }
  ];
  const progress = resolveTrainingCardPassageGroupProgress({
    squad,
    agents,
    plan,
    nowSec: 1
  });

  expect(progress.totalWeight).toBe(10);
  expect(progress.detachedWeight).toBe(3);
  expect(progress.outlierWeight).toBe(0);
  expect(progress.behindGateWeight).toBe(3);
  expect(progress.tailPending).toBe(true);
});

test('keeps an unqualified detached tail in minimumProgress for the next choke', () => {
  const route = [{ x: -100, y: 0 }, { x: 160, y: 0 }];
  const squad = {
    id: 'minimum-progress-tail',
    x: -80,
    y: 0,
    bodyAnchor: { x: -80, y: 0, bodyProgress: 20, maxAnchorLead: 24 },
    formationRect: { width: 32, depth: 24, spacing: 8 },
    deploySlots: [],
    _passagePlanRoute: route,
    order: { type: 'MOVE', targetPoint: { x: 160, y: 0 } },
    waypoints: [{ x: 160, y: 0 }]
  };
  const walls = [
    { id: 'first-top', x: 0, y: 36, width: 40, depth: 60, blocksMovement: true },
    { id: 'first-bottom', x: 0, y: -36, width: 40, depth: 60, blocksMovement: true },
    { id: 'second-top', x: 100, y: 36, width: 40, depth: 60, blocksMovement: true },
    { id: 'second-bottom', x: 100, y: -36, width: 40, depth: 60, blocksMovement: true }
  ];
  const agents = [
    {
      id: 'unqualified-tail', squadId: squad.id, x: -90, y: 0, weight: 1,
      _formationDetached: true,
      _formationRecovery: { active: true },
      _squadController: { rejoin: { active: true } }
    },
    { id: 'front-mass', squadId: squad.id, x: 80, y: 0, weight: 19, _squadController: {} }
  ];
  const runtime = {};
  const refreshed = updateTrainingCardPassagePlan({
    squad,
    agents,
    runtime,
    sim: { field: { width: 420, height: 180 } },
    walls,
    route,
    nowSec: 0,
    force: true
  });

  expect(refreshed.plan).toBeTruthy();
  // The 5% rear has not met the strict timed outlier criteria. Planning must
  // still retain the first gate rather than jumping directly to the second.
  expect(refreshed.plan.bottleneck.center.x).toBeLessThan(40);
});

test('keeps only a previously qualified tiny outlier out of the next route sample', () => {
  const plan = buildDirectPassagePlan();
  const routeProjectionPlan = {
    route: plan.route,
    segments: plan.segments,
    routeLength: plan.routeLength
  };
  const squad = {
    id: 'qualified-outlier',
    x: 80,
    y: 0,
    bodyAnchor: { x: 80, y: 0, bodyProgress: 160, maxAnchorLead: 24 },
    formationRect: { width: 32, depth: 24, spacing: 8 },
    _squadController: {}
  };
  const agents = [
    {
      id: 'proved-tiny-tail', squadId: squad.id, x: -100, y: 0, weight: 5,
      _formationDetached: true,
      _squadController: {
        rejoin: { active: true },
        passageOutlier: { active: true, isolationDistance: 64, markedAt: 0 }
      }
    },
    { id: 'main-body', squadId: squad.id, x: 80, y: 0, weight: 95, _squadController: {} }
  ];
  const progress = resolveTrainingCardPassageGroupProgress({
    squad,
    agents,
    routeProjectionPlan,
    nowSec: 5
  });

  expect(progress.outlierWeight).toBe(5);
  expect(progress.trackedWeight).toBe(95);
  expect(progress.bodyProgress).toBeGreaterThan(150);
});

test('escalates material terrain blockage to GROUP_BLOCKED only as a group problem', () => {
  const plan = buildDirectPassagePlan();
  const squad = {
    id: 'blocked-mass',
    x: -20,
    y: 0,
    bodyAnchor: { x: -20, y: 0, bodyProgress: 60, maxAnchorLead: 24 },
    navigationAnchor: { x: 80, y: 0 },
    formationRect: { width: 32, depth: 24, spacing: 8 },
    _squadController: { passagePlan: plan }
  };
  const agents = [
    { id: 'blocked-a', squadId: squad.id, x: -20, y: -2, weight: 4, _terrainBlockedAt: 0.8, _squadController: {} },
    { id: 'blocked-b', squadId: squad.id, x: -20, y: 2, weight: 3, _terrainBlockedAt: 0.8, _squadController: {} },
    { id: 'front', squadId: squad.id, x: 80, y: 0, weight: 3, _squadController: {} }
  ];
  const progress = resolveTrainingCardPassageGroupProgress({
    squad,
    agents,
    plan,
    previous: {
      passageId: plan.id,
      signature: plan.geometrySignature,
      bodyProgress: 60,
      rearProgress: 60,
      lastProgressAt: 0
    },
    nowSec: 1
  });

  expect(progress.blockedWeight).toBe(7);
  expect(progress.state).toBe('GROUP_BLOCKED');
  expect(progress.anchorSpeedScale).toBe(0);
  expect(progress.needsReplan).toBe(true);
});

test('escalates material terrain blockage before a PassagePlan can be created', () => {
  const passageShape = buildDirectPassagePlan();
  const routeProjectionPlan = {
    route: passageShape.route,
    segments: passageShape.segments,
    routeLength: passageShape.routeLength
  };
  const squad = {
    id: 'blocked-formation-route',
    x: -20,
    y: 0,
    bodyAnchor: { x: -20, y: 0, bodyProgress: 60, maxAnchorLead: 24 },
    navigationAnchor: { x: 4, y: 0 },
    formationRect: { width: 32, depth: 24, spacing: 8 },
    _squadController: {}
  };
  const agents = [
    { id: 'blocked-a', squadId: squad.id, x: -20, y: -2, weight: 4, _terrainBlockedAt: 0.1, _squadController: {} },
    { id: 'blocked-b', squadId: squad.id, x: -20, y: 2, weight: 3, _terrainBlockedAt: 0.1, _squadController: {} },
    { id: 'front', squadId: squad.id, x: 40, y: 0, weight: 3, _squadController: {} }
  ];
  const first = resolveTrainingCardPassageGroupProgress({
    squad,
    agents,
    routeProjectionPlan,
    nowSec: 0.1
  });
  const progress = resolveTrainingCardPassageGroupProgress({
    squad,
    agents,
    routeProjectionPlan,
    previous: first,
    nowSec: 0.9
  });

  expect(progress.passageId).toBe(0);
  expect(progress.tailPending).toBe(false);
  expect(progress.blockedWeight).toBe(7);
  expect(progress.state).toBe('GROUP_BLOCKED');
  expect(progress.anchorSpeedScale).toBe(0);
  expect(progress.needsReplan).toBe(true);
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

test('keeps longitudinal progress on the current leg of a close U-shaped corridor', () => {
  const plan = {
    route: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 20 }, { x: 0, y: 20 }],
    segments: [
      { start: { x: 0, y: 0 }, end: { x: 80, y: 0 }, length: 80, startProgress: 0, endProgress: 80, tangent: { x: 1, y: 0 } },
      { start: { x: 80, y: 0 }, end: { x: 80, y: 20 }, length: 20, startProgress: 80, endProgress: 100, tangent: { x: 0, y: 1 } },
      { start: { x: 80, y: 20 }, end: { x: 0, y: 20 }, length: 80, startProgress: 100, endProgress: 180, tangent: { x: -1, y: 0 } }
    ],
    routeLength: 180
  };
  const pointNearReturnLeg = { x: 40, y: 20 };
  const nearestOnly = projectPointToPassagePlan(pointNearReturnLeg, plan);
  const continuityAware = projectPointToPassagePlan(pointNearReturnLeg, plan, 40);

  expect(nearestOnly.progress).toBeGreaterThan(120);
  expect(continuityAware.progress).toBeLessThan(80);
});

test('orders curved-stream followers by route progress instead of world tangent projection', () => {
  const squad = { id: 'curved-stream' };
  const agent = {
    id: 'curved-self', squadId: squad.id, x: 0, y: 0, radius: 2.25, vx: 20, vy: 0,
    _squadController: {
      locomotionState: 'STREAM', passageId: 8, streamId: 0, passageProgress: 50
    }
  };
  // This is the next unit after a bend: relative to the self unit's old east
  // tangent it is partly behind, but its shared-route progress is ahead.
  const leaderAfterTurn = {
    id: 'curved-leader', squadId: squad.id, x: -7, y: 8, radius: 2.25, vx: 0, vy: 8,
    _squadController: {
      locomotionState: 'STREAM',
      passageId: 8,
      streamId: 0,
      passageProgress: 58,
      passageForwardX: 0,
      passageForwardY: 1
    }
  };
  const steering = resolveTrainingCardPassageFlowSteering({
    agent,
    squad,
    speed: 20,
    nowSec: 1,
    neighbors: [leaderAfterTurn],
    flowIntent: {
      active: true,
      state: 'STREAM',
      passageId: 8,
      streamId: 0,
      progress: 50,
      forwardX: 1,
      forwardY: 0,
      laneOffset: 0,
      lateral: 0,
      streamSpacing: 6,
      queueSpacing: 8,
      queueLookahead: 30
    }
  });

  expect(steering.sameStreamFront).toBe(leaderAfterTurn);
  expect(steering.frontProgressDifference).toBe(8);
  expect(steering.targetSpeed).toBeGreaterThan(1);
  expect(steering.targetSpeed).toBeLessThan(20);
});

test('keeps a substantial forward component while an approach merges from a large lateral error', () => {
  const squad = { id: 'approach-stream' };
  const agent = {
    id: 'approach-self', squadId: squad.id, x: 0, y: 36, radius: 2.25,
    _squadController: {
      locomotionState: 'STREAM_APPROACH', passageId: 9, streamId: 0, passageProgress: 12
    }
  };
  const steering = resolveTrainingCardPassageFlowSteering({
    agent,
    squad,
    speed: 24,
    nowSec: 1,
    neighbors: [],
    flowIntent: {
      active: true,
      state: 'STREAM_APPROACH',
      passageId: 9,
      streamId: 0,
      progress: 12,
      forwardX: 1,
      forwardY: 0,
      laneOffset: 0,
      lateral: 36,
      streamSpacing: 6,
      queueSpacing: 8,
      approachDistance: 48
    }
  });

  expect(steering.targetSpeed).toBe(24);
  expect(steering.approachForwardRatio).toBeGreaterThanOrEqual(0.7);
  expect(Math.abs(steering.laneVelocityY)).toBeLessThanOrEqual(24 * 0.42);
});

test('marks an unblocked stream agent for local watchdog recovery only after progress stalls', () => {
  const squad = { id: 'watchdog-stream' };
  const agent = {
    id: 'watchdog-self', squadId: squad.id, x: 0, y: 0, radius: 2.25,
    _squadController: {
      locomotionState: 'STREAM',
      passageId: 10,
      streamId: 0,
      passageProgress: 40,
      streamWatchdog: { progress: 40, lastProgressAt: 0 }
    }
  };
  const steering = resolveTrainingCardPassageFlowSteering({
    agent,
    squad,
    speed: 20,
    nowSec: 1,
    neighbors: [],
    flowIntent: {
      active: true,
      state: 'STREAM',
      passageId: 10,
      streamId: 0,
      progress: 40,
      forwardX: 1,
      forwardY: 0,
      laneOffset: 0,
      lateral: 0,
      streamSpacing: 6,
      queueSpacing: 8
    }
  });

  expect(steering.streamWatchdog).toMatchObject({ stalled: true, frontBlocking: false });
  expect(agent._squadController.streamWatchdog.stalled).toBe(true);
});

test('builds continuous legal lane spines around a sharp passage bend', () => {
  const walls = [
    { id: 'turning-gate-top', x: 0, y: 49, width: 20, depth: 70, blocksMovement: true },
    { id: 'turning-gate-bottom', x: 0, y: -49, width: 20, depth: 70, blocksMovement: true }
  ];
  const field = { width: 240, height: 164 };
  const trainingMap = {
    navigation: {
      cellSize: 16,
      wallClearance: 2,
      pathClearance: 1,
      narrowPassage: { cellSize: 4 }
    },
    lanes: [],
    terrainRegions: []
  };
  const sim = {
    field,
    trainingMap,
    trainingNavigator: createTrainingMapNavigator({ field, mapConfig: trainingMap })
  };
  const route = planTrainingMapRoute({
    field,
    mapConfig: trainingMap,
    start: { x: -70, y: -50 },
    target: { x: 70, y: -50 },
    obstacles: walls,
    radius: 2.25
  });
  const plan = createTrainingCardPassagePlan({
    squad: { x: -120, y: -50, formationRect: { width: 32, spacing: 8 }, deploySlots: [] },
    sim,
    walls,
    route,
    nowSec: 0
  });

  expect(route.length).toBeGreaterThan(2);
  expect(plan).toBeTruthy();
  expect(plan.streamCount).toBeLessThanOrEqual(plan.requestedStreamCount);
  plan.streams.forEach((stream) => {
    expect(stream.spine.length).toBeGreaterThan(2);
    stream.spineSegments.forEach((segment) => {
      expect(sim.trainingNavigator.isSegmentTraversable(segment.start, segment.end, {
        obstacles: walls,
        radius: plan.wallClearance + 2.25
      })).toBe(true);
    });
  });
});

test('invalidates passage geometry when a blocker revision changes or the gate opens', () => {
  const squad = { x: -80, y: 0, formationRect: { width: 32, spacing: 8 }, deploySlots: [] };
  const walls = [
    { id: 'revision-top', x: 0, y: 40, width: 40, depth: 60, blocksMovement: true, colliderRevision: 0 },
    { id: 'revision-bottom', x: 0, y: -40, width: 40, depth: 60, blocksMovement: true, colliderRevision: 0 }
  ];
  const args = {
    squad,
    sim: { field: { width: 320, height: 180 } },
    walls,
    route: [{ x: -80, y: 0 }, { x: 80, y: 0 }]
  };
  const first = createTrainingCardPassagePlan({ ...args, nowSec: 0 });
  walls[0].colliderRevision = 1;
  const revised = createTrainingCardPassagePlan({ ...args, previousPlan: first, nowSec: 0.1 });
  walls.forEach((wall) => { wall.destroyed = true; });
  const opened = createTrainingCardPassagePlan({ ...args, previousPlan: revised, nowSec: 0.2 });

  expect(first).toBeTruthy();
  expect(revised).toBeTruthy();
  expect(revised.id).toBeGreaterThan(first.id);
  expect(revised.geometrySignature).not.toBe(first.geometrySignature);
  expect(opened).toBeNull();
});

test('drains active stream members through STREAM_EXIT when a destroyed gate opens the corridor', () => {
  const squad = {
    id: 'opened-gate',
    x: -80,
    y: 0,
    formationRect: { width: 32, spacing: 8 },
    deploySlots: []
  };
  const walls = [
    { id: 'opened-top', x: 0, y: 40, width: 40, depth: 60, blocksMovement: true },
    { id: 'opened-bottom', x: 0, y: -40, width: 40, depth: 60, blocksMovement: true }
  ];
  const sim = { field: { width: 320, height: 180 } };
  const route = [{ x: -80, y: 0 }, { x: 80, y: 0 }];
  const plan = createTrainingCardPassagePlan({ squad, sim, walls, route, nowSec: 0 });
  const agent = {
    id: 'opened-agent', squadId: squad.id, x: 0, y: 0, weight: 1,
    _squadController: {}
  };
  const runtime = { passagePlan: plan };
  updateTrainingCardPassageAgents({ squad, agents: [agent], plan, nowSec: 0 });
  expect(agent._squadController.locomotionState).toBe('STREAM');

  walls.forEach((wall) => { wall.destroyed = true; });
  const refreshed = updateTrainingCardPassagePlan({
    squad,
    agents: [agent],
    runtime,
    sim,
    walls,
    route,
    nowSec: 0.1
  });

  expect(refreshed.plan).toMatchObject({ draining: true });
  expect(agent._squadController.locomotionState).toBe('STREAM_EXIT');
});

test('marks a shared replan when a new obstacle makes every cached lane illegal', () => {
  const squad = {
    id: 'blocked-gate',
    x: -80,
    y: 0,
    formationRect: { width: 32, spacing: 8 },
    deploySlots: []
  };
  const walls = [
    { id: 'blocked-top', x: 0, y: 40, width: 40, depth: 60, blocksMovement: true },
    { id: 'blocked-bottom', x: 0, y: -40, width: 40, depth: 60, blocksMovement: true }
  ];
  const sim = { field: { width: 320, height: 180 } };
  const route = [{ x: -80, y: 0 }, { x: 80, y: 0 }];
  const plan = createTrainingCardPassagePlan({ squad, sim, walls, route, nowSec: 0 });
  const agent = {
    id: 'blocked-agent', squadId: squad.id, x: 0, y: 0, weight: 1,
    _squadController: {}
  };
  const runtime = { passagePlan: plan };
  updateTrainingCardPassageAgents({ squad, agents: [agent], plan, nowSec: 0 });
  walls.push({ id: 'new-blocker', x: 0, y: 0, width: 12, depth: 32, blocksMovement: true });

  const refreshed = updateTrainingCardPassagePlan({
    squad,
    agents: [agent],
    runtime,
    sim,
    walls,
    route,
    nowSec: 0.1
  });

  expect(refreshed.plan).toBeNull();
  expect(runtime.passagePlanInvalid).toBe(true);
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
  const finalAgents = getCrowdAgentsForSquad(crowd, squad.id);
  const totalWeight = finalAgents.reduce((sum, agent) => sum + Number(agent.weight || 0), 0);
  const weightedBodyX = finalAgents.reduce(
    (sum, agent) => sum + (Number(agent.x || 0) * Number(agent.weight || 0)),
    0
  ) / Math.max(1, totalWeight);
  // squad.x is now the weighted physical body rather than a virtual leader;
  // it need not equal the front-most destination point once the formation has
  // reformed behind that point.
  expect(squad.x).toBeGreaterThan(220);
  expect(squad.x).toBeCloseTo(weightedBodyX, 1);
  expect(Number(squad.navigationAnchor?.lead || 0)).toBeLessThanOrEqual(
    Number(squad.bodyAnchor?.maxAnchorLead || 0) + 0.05
  );
  expect(squad.order.type).toBe('IDLE');
});
