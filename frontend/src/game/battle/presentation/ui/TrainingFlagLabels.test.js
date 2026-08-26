import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  areTrainingFlagRowsCombatLinked,
  buildTrainingFlagRows,
  buildTrainingFlagRowsWithNeutralPreview,
  resolveTrainingFlagCombatTargetIds,
  resolveTrainingFlagLabelCameraDepth,
  resolveTrainingFlagLabelDepthOrder,
  resolveTrainingFlagLiveSource,
  resolveTrainingHoveredSquadId,
  resolveTrainingFlagLabelPresentation,
  resolveTrainingFlagLabelStackLayout,
  resolveTrainingTroopRatio,
  resolveTrainingTroopState
} from './TrainingFlagLabels';
import TrainingFlagLabels from './TrainingFlagLabels';
import useBattleActions from '../../hooks/useBattleActions';

const TrainingFlagAttackFixture = ({
  squads,
  runtimeRef,
  selectedSquadId,
  setCards,
  onSelectSquad
}) => {
  const glCanvasRef = React.useRef(null);
  const worldToDomRef = React.useRef(() => ({ x: 100, y: 100, visible: true }));
  const cameraRef = React.useRef({
    distance: 600,
    currentPitch: 90,
    eye: [0, 0, 400]
  });
  const { attackBattleSquadTarget } = useBattleActions({
    runtimeRef,
    cameraRef,
    glCanvasRef,
    worldToDomRef,
    selectedSquadId,
    setCards
  });

  return (
    <TrainingFlagLabels
      squads={squads}
      phase="battle"
      runtimeRef={runtimeRef}
      worldToDomRef={worldToDomRef}
      cameraRef={cameraRef}
      onSelectSquad={onSelectSquad}
      onAttackSquadTarget={attackBattleSquadTarget}
    />
  );
};

describe('training flag labels', () => {
  test('uses the rendered troop center before the newer simulation center', () => {
    const renderedAnchor = { id: 'minion-wave', centerX: -160, centerY: 32 };
    const simulationSquad = {
      id: 'minion-wave',
      centerX: 420,
      centerY: -220,
      _combatEngagementTargetId: 'enemy-wave'
    };
    const runtime = {
      getRenderedBattleSquadAnchor: jest.fn(() => renderedAnchor),
      getSquadById: jest.fn(() => simulationSquad)
    };

    expect(resolveTrainingFlagLiveSource(runtime, 'battle', { id: 'minion-wave' }))
      .toMatchObject({
        id: 'minion-wave',
        centerX: -160,
        centerY: 32,
        _combatEngagementTargetId: 'enemy-wave'
      });
    expect(runtime.getSquadById).toHaveBeenCalledWith('minion-wave');
  });

  test('recognizes active combat locks from either side of an engagement', () => {
    const ally = {
      id: 'ally',
      _combatEngagementTargetId: 'enemy',
      order: { targetSquadId: 'secondary-enemy' }
    };
    const enemy = { id: 'enemy' };

    expect(resolveTrainingFlagCombatTargetIds(ally))
      .toEqual(['enemy']);
    expect(areTrainingFlagRowsCombatLinked(ally, enemy)).toBe(true);
    expect(areTrainingFlagRowsCombatLinked(enemy, ally)).toBe(true);
  });

  test('does not cluster minion labels while they are only approaching a target', () => {
    const approaching = {
      id: 'minion-wave',
      isMinionWaveUnit: true,
      minionAiState: 'APPROACH',
      _combatEngagementTargetId: 'enemy-wave'
    };

    expect(resolveTrainingFlagCombatTargetIds(approaching)).toEqual([]);
    expect(resolveTrainingFlagCombatTargetIds({
      ...approaching,
      minionAiState: 'ATTACK_HOLD'
    })).toEqual(['enemy-wave']);
  });

  test('mirrors the runtime hover squad for both deployment and battle labels', () => {
    expect(resolveTrainingHoveredSquadId({ hoveredBattleSquadId: 'battle-1' }, 'battle')).toBe('battle-1');
    expect(resolveTrainingHoveredSquadId({ hoveredDeploySquadId: 'deploy-1' }, 'deploy')).toBe('deploy-1');
    expect(resolveTrainingHoveredSquadId({ hoveredBattleSquadId: 'battle-1' }, 'deploy')).toBe('');
  });

  test('uses troop count thresholds for healthy, warning, and critical flag states', () => {
    expect(resolveTrainingTroopRatio({ remain: 80, startCount: 100 })).toBe(0.8);
    expect(resolveTrainingTroopState(0.8)).toBe('healthy');
    expect(resolveTrainingTroopState(0.5)).toBe('warning');
    expect(resolveTrainingTroopState(0.25)).toBe('critical');
  });

  test('projects every living placed squad with its own training skill points', () => {
    const rows = buildTrainingFlagRows([
      { id: 'ally', name: '先锋', team: 'attacker', remain: 20, startCount: 40, trainingSkillPoints: 7, x: -100, y: 40, centerX: -88, centerY: 32 },
      { id: 'enemy', name: '守军', team: 'defender', remain: 1, startCount: 10, trainingSkillPoints: 2, x: 100, y: -40 },
      { id: 'neutral', name: '野区守卫', team: 'neutral', remain: 8, startCount: 8, trainingSkillPoints: 0, x: 0, y: 0 },
      { id: 'unplaced', remain: 30, startCount: 30, placed: false },
      { id: 'fallen', remain: 0, startCount: 30 }
    ]);

    expect(rows).toEqual([
      expect.objectContaining({ id: 'ally', team: 'attacker', troopState: 'warning', skillPoints: 7, showSkillPoints: true, x: -88, y: 32 }),
      expect.objectContaining({ id: 'enemy', team: 'defender', troopState: 'critical', skillPoints: 2, showSkillPoints: true }),
      expect.objectContaining({ id: 'neutral', team: 'neutral', troopState: 'healthy', skillPoints: 0, showSkillPoints: false })
    ]);
  });

  test('adds pre-start neutral squads at their preview flag bearer', () => {
    const rows = buildTrainingFlagRowsWithNeutralPreview([
      { id: 'attacker', name: '先锋', team: 'attacker', remain: 20, startCount: 20, x: -100, y: 0 }
    ], {
      squads: [{
        id: 'neutral-preview',
        name: '中立守卫',
        team: 'neutral',
        remain: 80,
        startCount: 80,
        x: 12,
        y: 18
      }],
      agents: [
        { squadId: 'neutral-preview', weight: 40, x: 8, y: 14 },
        { squadId: 'neutral-preview', weight: 40, isFlagBearer: true, x: 28, y: 34 }
      ]
    });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'attacker', team: 'attacker' }),
      expect.objectContaining({
        id: 'neutral-preview',
        team: 'neutral',
        x: 28,
        y: 34,
        showSkillPoints: false
      })
    ]));
  });

  test('renders minion rows as health-only markers without skill points', () => {
    const [row] = buildTrainingFlagRows([
      { id: 'minion-wave', team: 'attacker', isMinionWaveUnit: true, remain: 72, startCount: 72, x: 0, y: 0 }
    ]);

    expect(row).toMatchObject({ isMinionWaveUnit: true, showSkillPoints: false, skillPoints: 0 });
  });

  test('lets the minion health marker hover and select its owning squad', () => {
    const onHoverSquad = jest.fn();
    const onSelectSquad = jest.fn();
    const squad = {
      id: 'minion-wave',
      name: '兵线',
      team: 'attacker',
      isMinionWaveUnit: true,
      remain: 72,
      startCount: 72,
      x: 0,
      y: 0
    };
    const runtimeRef = {
      current: {
        hoveredBattleSquadId: '',
        getSquadById: () => squad,
        sim: { damageNumbers: [] }
      }
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      flushSync(() => root.render(
        <TrainingFlagLabels
          squads={[squad]}
          phase="battle"
          runtimeRef={runtimeRef}
          worldToDomRef={{ current: () => ({ x: 100, y: 100, visible: true }) }}
          cameraRef={{ current: { distance: 600, currentPitch: 90, eye: [0, 0, 400] } }}
          onHoverSquad={onHoverSquad}
          onSelectSquad={onSelectSquad}
        />
      ));
      const label = container.querySelector('[aria-label="兵线：兵力 72/72"]');
      const health = container.querySelector('.pve2-training-minion-health');

      flushSync(() => label.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
      flushSync(() => health.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(onHoverSquad).toHaveBeenCalledWith('minion-wave');
      expect(onSelectSquad).toHaveBeenCalledWith('minion-wave');
    } finally {
      flushSync(() => root.unmount());
      container.remove();
    }
  });

  test('right-clicks hostile and neutral information labels into targeted attack orders', () => {
    const selected = {
      id: 'selected-attacker',
      name: '我方先锋',
      team: 'attacker',
      remain: 40,
      startCount: 40,
      x: -120,
      y: 0
    };
    const enemy = {
      id: 'enemy-squad',
      name: '敌方部队',
      team: 'defender',
      remain: 30,
      startCount: 30,
      x: 100,
      y: 0
    };
    const neutral = {
      id: 'neutral-squad',
      name: '中立守卫',
      team: 'neutral',
      remain: 24,
      startCount: 24,
      x: 0,
      y: 80
    };
    const enemyMinion = {
      id: 'enemy-minion',
      name: '敌方小兵',
      team: 'defender',
      isMinionWaveUnit: true,
      remain: 72,
      startCount: 72,
      x: 140,
      y: 40
    };
    const friendly = {
      id: 'friendly-squad',
      name: '友方部队',
      team: 'attacker',
      remain: 20,
      startCount: 20,
      x: -40,
      y: 60
    };
    const squads = [selected, enemy, neutral, enemyMinion, friendly];
    const squadsById = new Map(squads.map((squad) => [squad.id, squad]));
    const commandAttackTarget = jest.fn(() => true);
    const setCards = jest.fn();
    const onSelectSquad = jest.fn();
    const runtimeRef = {
      current: {
        hoveredBattleSquadId: '',
        getPhase: () => 'battle',
        getSquadById: (squadId) => squadsById.get(squadId) || null,
        canControlSquad: (squad) => squad?.id === selected.id,
        commandAttackTarget,
        getCardRows: () => squads,
        sim: { damageNumbers: [] }
      }
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      flushSync(() => root.render(
        <TrainingFlagAttackFixture
          squads={squads}
          runtimeRef={runtimeRef}
          selectedSquadId={selected.id}
          setCards={setCards}
          onSelectSquad={onSelectSquad}
        />
      ));

      [enemy, neutral, enemyMinion].forEach((target) => {
        const label = container.querySelector(`[data-training-flag="${target.id}"]`);
        const hitTarget = target.isMinionWaveUnit
          ? label.querySelector('.pve2-training-minion-health')
          : label.querySelector('.pve2-training-flag-banner');
        const mouseDown = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 2
        });
        flushSync(() => hitTarget.dispatchEvent(mouseDown));
        expect(mouseDown.defaultPrevented).toBe(true);
      });

      expect(commandAttackTarget.mock.calls).toEqual([
        [selected.id, { targetSquadId: enemy.id }],
        [selected.id, { targetSquadId: neutral.id }],
        [selected.id, { targetSquadId: enemyMinion.id }]
      ]);
      expect(setCards).toHaveBeenCalledTimes(3);
      expect(onSelectSquad).not.toHaveBeenCalled();

      const friendlyLabel = container.querySelector(`[data-training-flag="${friendly.id}"]`);
      flushSync(() => friendlyLabel.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 2
      })));
      expect(commandAttackTarget).toHaveBeenCalledTimes(3);

      const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      flushSync(() => friendlyLabel.dispatchEvent(contextMenu));
      expect(contextMenu.defaultPrevented).toBe(true);
      expect(commandAttackTarget).toHaveBeenCalledTimes(3);
    } finally {
      flushSync(() => root.unmount());
      container.remove();
    }
  });

  test('keeps the distant information label low while enlarging it for overview readability', () => {
    const row = { remain: 64, startCount: 100, radius: 26 };
    const closePresentation = resolveTrainingFlagLabelPresentation(row, 420);
    const distantPresentation = resolveTrainingFlagLabelPresentation(row, 820);

    expect(closePresentation.visible).toBe(true);
    expect(distantPresentation.visible).toBe(true);
    expect(distantPresentation.elevation).toBeLessThanOrEqual(14);
    expect(distantPresentation.elevation).toBe(closePresentation.elevation);
    expect(distantPresentation.scale).toBeGreaterThan(closePresentation.scale);
  });

  test('hard hides the information label while the close world flag is active', () => {
    const row = { remain: 64, startCount: 100, radius: 26 };
    const closeFlagPresentation = resolveTrainingFlagLabelPresentation(row, 420, 50);
    const distantLabelPresentation = resolveTrainingFlagLabelPresentation(row, 420, 51);

    expect(closeFlagPresentation.visible).toBe(false);
    expect(distantLabelPresentation.visible).toBe(true);
    expect(distantLabelPresentation.elevation).toBeLessThanOrEqual(14);
  });

  test('keeps minion information visible and elevated in the world-flag camera mode', () => {
    const row = { remain: 72, startCount: 72, radius: 26, isMinionWaveUnit: true };
    const presentation = resolveTrainingFlagLabelPresentation(row, 420, 50);

    expect(presentation.visible).toBe(true);
    expect(presentation.elevation).toBeGreaterThanOrEqual(11);
  });

  test('stacks overlapping information labels into a vertical column', () => {
    const layout = resolveTrainingFlagLabelStackLayout([
      { id: 'a', source: { id: 'a', x: 0, y: 0, radius: 20 }, height: 18, width: 102, point: { x: 300, y: 200, visible: true } },
      { id: 'b', source: { id: 'b', x: 30, y: 0, radius: 20 }, height: 22, width: 86, point: { x: 312, y: 207, visible: true } },
      { id: 'c', source: { id: 'c', x: 500, y: 0, radius: 20 }, height: 18, width: 102, point: { x: 700, y: 200, visible: true } }
    ]);

    expect(layout.a.x).toBe(layout.b.x);
    expect(layout.a.y).toBeCloseTo(layout.b.y - layout.b.height, 6);
    expect(layout.a.width).toBe(102);
    expect(layout.b.width).toBe(102);
    expect(layout.c).toMatchObject({ x: 700, y: 200, stackSize: 1 });
  });

  test('never drags a combat-linked health bar away from its own projected squad', () => {
    const layout = resolveTrainingFlagLabelStackLayout([
      {
        id: 'ally-front',
        source: {
          id: 'ally-front',
          team: 'attacker',
          x: 0,
          y: 0,
          radius: 24,
          combatTargetIds: ['enemy-front']
        },
        height: 18,
        width: 102,
        point: { x: 260, y: 196, visible: true }
      },
      {
        id: 'ally-rear',
        source: { id: 'ally-rear', team: 'attacker', x: 30, y: 0, radius: 24 },
        height: 18,
        width: 86,
        point: { x: 270, y: 202, visible: true }
      },
      {
        id: 'enemy-front',
        source: { id: 'enemy-front', team: 'defender', x: 54, y: 0, radius: 24 },
        height: 18,
        width: 86,
        point: { x: 920, y: 258, visible: true }
      }
    ]);

    expect(layout['ally-front'].x).toBe(layout['ally-rear'].x);
    expect(layout['ally-front'].y).toBeCloseTo(layout['ally-rear'].y - 18, 6);
    expect(layout['ally-front']).toMatchObject({ clusterSize: 2, columnCount: 1 });
    expect(layout['enemy-front']).toMatchObject({
      x: 920,
      y: 258,
      stackSize: 1,
      clusterSize: 1,
      columnCount: 1
    });
  });

  test('leaves screen-near information labels unmerged without map contact', () => {
    const layout = resolveTrainingFlagLabelStackLayout([
      { id: 'near-screen-a', source: { id: 'near-screen-a', team: 'attacker', x: -200, y: 0, radius: 20 }, point: { x: 300, y: 200, visible: true } },
      { id: 'near-screen-b', source: { id: 'near-screen-b', team: 'defender', x: 200, y: 0, radius: 20 }, point: { x: 308, y: 206, visible: true } }
    ]);

    expect(layout['near-screen-a']).toMatchObject({ x: 300, y: 200, stackSize: 1 });
    expect(layout['near-screen-b']).toMatchObject({ x: 308, y: 206, stackSize: 1 });
  });

  test('places nearer information labels above distant labels', () => {
    const order = resolveTrainingFlagLabelDepthOrder([
      { id: 'far', distance: 900 },
      { id: 'near', distance: 300 }
    ]);

    expect(order.near).toBeGreaterThan(order.far);
  });

  test('orders occlusion by camera depth instead of radial distance', () => {
    const camera = {
      eye: [0, 0, 0],
      renderForward: [1, 0, 0]
    };
    const nearDepth = resolveTrainingFlagLabelCameraDepth({ x: 100, y: 1000 }, 0, camera);
    const farDepth = resolveTrainingFlagLabelCameraDepth({ x: 200, y: 0 }, 0, camera);

    expect(nearDepth).toBe(100);
    expect(farDepth).toBe(200);
    expect(resolveTrainingFlagLabelDepthOrder([
      { id: 'near', distance: nearDepth },
      { id: 'far', distance: farDepth }
    ]).near).toBeGreaterThan(1);
  });
});
