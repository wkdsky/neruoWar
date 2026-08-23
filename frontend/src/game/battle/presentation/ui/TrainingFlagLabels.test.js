import {
  buildTrainingFlagRows,
  buildTrainingFlagRowsWithNeutralPreview,
  resolveTrainingHoveredSquadId,
  resolveTrainingFlagLabelPresentation,
  resolveTrainingFlagLabelStackLayout,
  resolveTrainingTroopRatio,
  resolveTrainingTroopState
} from './TrainingFlagLabels';

describe('training flag labels', () => {
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
      { id: 'a', point: { x: 300, y: 200, visible: true } },
      { id: 'b', point: { x: 312, y: 207, visible: true } },
      { id: 'c', point: { x: 700, y: 200, visible: true } }
    ], { verticalGap: 40 });

    expect(layout.a.x).toBe(layout.b.x);
    expect(Math.abs(layout.a.y - layout.b.y)).toBe(40);
    expect(layout.c).toEqual({ x: 700, y: 200 });
  });
});
