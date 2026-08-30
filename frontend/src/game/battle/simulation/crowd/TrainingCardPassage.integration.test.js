import BattleRuntime from '../../presentation/runtime/BattleRuntime';

const buildInit = () => ({
  mode: 'training',
  rules: { allowCrossMidline: true, maxDeployGroupTotal: 10000 },
  battlefield: {
    layoutMeta: { fieldWidth: 320, fieldHeight: 180 },
    map: {
      mapId: 'stream-gate-test',
      mapVersion: 1,
      presets: [{ id: 'all', enabledTags: ['gate'] }],
      defaultPresetId: 'all',
      activePresetId: 'all',
      terrainRegions: [{ id: 'grass', type: 'grass', shape: 'rect', x: 0, y: 0, width: 320, height: 180 }],
      lanes: [],
      navigation: { cellSize: 8, pathClearance: 1, narrowPassage: { cellSize: 4 } },
      objects: [
        { objectId: 'top', x: 0, y: 72, width: 40, depth: 120, height: 30, category: 'tower', mapStatic: true, presetTags: ['gate'], blocksMovement: true },
        { objectId: 'bottom', x: 0, y: -72, width: 40, depth: 120, height: 30, category: 'tower', mapStatic: true, presetTags: ['gate'], blocksMovement: true }
      ]
    },
    objects: [
      { objectId: 'top', x: 0, y: 72, width: 40, depth: 120, height: 30, category: 'tower', mapStatic: true, presetTags: ['gate'], blocksMovement: true },
      { objectId: 'bottom', x: 0, y: -72, width: 40, depth: 120, height: 30, category: 'tower', mapStatic: true, presetTags: ['gate'], blocksMovement: true }
    ]
  },
  unitTypes: [{ unitTypeId: 'infantry_basic', classTag: 'infantry', hp: 10, atk: 2, def: 1, speed: 1.5, range: 1 }],
  attacker: { rosterUnits: [{ unitTypeId: 'infantry_basic', count: 30 }], deployUnits: [] },
  defender: { rosterUnits: [], deployUnits: [] }
});

test('routes a commanded CARD through a soldier-sized gate', () => {
  const runtime = new BattleRuntime(buildInit(), { repConfig: { maxAgentWeight: 1, strictAgentMapping: true } });
  const created = runtime.createDeployGroup('attacker', {
    units: { infantry_basic: 30 }, x: -110, y: 0, placed: true, controlMode: 'USER'
  });
  expect(created.ok).toBe(true);
  expect(runtime.startBattle().ok).toBe(true);
  const squad = runtime.getSquadById('attacker_squad_1');
  expect(runtime.commandMove(squad.id, { x: 110, y: 0 })).toBe(true);
  expect(squad._trainingNavigationScale).toBe('PASSAGE');
  let sawApproach = false;
  let sawStream = false;
  let sawExit = false;
  let maximumStreamCount = 0;
  for (let index = 0; index < 900; index += 1) {
    runtime.step(0.05);
    const agents = runtime.crowd.agentsBySquad.get(squad.id) || [];
    sawApproach = sawApproach || agents.some((agent) => agent._squadController?.locomotionState === 'STREAM_APPROACH');
    sawStream = sawStream || agents.some((agent) => agent._squadController?.locomotionState === 'STREAM');
    sawExit = sawExit || agents.some((agent) => agent._squadController?.locomotionState === 'STREAM_EXIT');
    maximumStreamCount = Math.max(maximumStreamCount, Number(squad.passageDebug?.streamCount) || 0);
    if (squad.order.type === 'IDLE') break;
  }
  expect(sawApproach).toBe(true);
  expect(sawStream).toBe(true);
  expect(sawExit).toBe(true);
  expect(maximumStreamCount).toBeGreaterThanOrEqual(2);
  expect(squad._navigationWaitUntil || 0).toBe(0);
  expect(squad.x).toBeGreaterThan(100);
});
