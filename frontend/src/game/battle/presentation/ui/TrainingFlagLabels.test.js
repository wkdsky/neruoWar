import {
  buildTrainingFlagRows,
  resolveTrainingFlagLabelPresentation,
  resolveTrainingTroopRatio,
  resolveTrainingTroopState
} from './TrainingFlagLabels';

describe('training flag labels', () => {
  test('uses troop count thresholds for healthy, warning, and critical flag states', () => {
    expect(resolveTrainingTroopRatio({ remain: 80, startCount: 100 })).toBe(0.8);
    expect(resolveTrainingTroopState(0.8)).toBe('healthy');
    expect(resolveTrainingTroopState(0.5)).toBe('warning');
    expect(resolveTrainingTroopState(0.25)).toBe('critical');
  });

  test('projects every living placed squad with the shared training skill points', () => {
    const rows = buildTrainingFlagRows([
      { id: 'ally', name: '先锋', team: 'attacker', remain: 20, startCount: 40, x: -100, y: 40, centerX: -88, centerY: 32 },
      { id: 'enemy', name: '守军', team: 'defender', remain: 1, startCount: 10, x: 100, y: -40 },
      { id: 'unplaced', remain: 30, startCount: 30, placed: false },
      { id: 'fallen', remain: 0, startCount: 30 }
    ], { points: 12 });

    expect(rows).toEqual([
      expect.objectContaining({ id: 'ally', team: 'attacker', troopState: 'warning', skillPoints: 12, x: -88, y: 32 }),
      expect.objectContaining({ id: 'enemy', team: 'defender', troopState: 'critical', skillPoints: 12 })
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
});
