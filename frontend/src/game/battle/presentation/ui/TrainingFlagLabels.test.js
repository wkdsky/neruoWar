import {
  buildTrainingFlagRows,
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
      { id: 'unplaced', remain: 30, startCount: 30, placed: false },
      { id: 'fallen', remain: 0, startCount: 30 }
    ]);

    expect(rows).toEqual([
      expect.objectContaining({ id: 'ally', team: 'attacker', troopState: 'warning', skillPoints: 7, x: -88, y: 32 }),
      expect.objectContaining({ id: 'enemy', team: 'defender', troopState: 'critical', skillPoints: 2 })
    ]);
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
