import {
  appendSkillPaintDabs,
  constrainSkillPaintPoint,
  createSkillPaintArea,
  finishSkillPaintArea,
  isPointInsideSkillPaintArea,
  normalizeSkillPaintArea
} from './skillPaintArea';

describe('skill paint area', () => {
  test('scales the initial paint area with the visible caster model count', () => {
    const oneModel = createSkillPaintArea({ casterModelCount: 1, aoeRadius: 48, maxRange: 240 });
    const nineModels = createSkillPaintArea({ casterModelCount: 9, aoeRadius: 48, maxRange: 240 });

    expect(nineModels.totalArea).toBeCloseTo(oneModel.totalArea * 9, 6);
  });

  test('uses a wider sweep brush that spends its area within one short arc', () => {
    const paintArea = createSkillPaintArea({ casterModelCount: 12, aoeRadius: 40, maxRange: 220 });
    const perModelRadius = Math.sqrt(paintArea.totalArea / (Math.PI * paintArea.casterModelCount));
    const brushed = appendSkillPaintDabs({
      paintArea,
      from: { x: 0, y: 0 },
      to: { x: 50, y: 0 },
      origin: { x: 0, y: 0 },
      maxRange: 220
    });

    expect(paintArea.dabRadius).toBeGreaterThan(perModelRadius);
    expect(brushed.paintArea.stamps.length).toBeLessThan(paintArea.casterModelCount);
    expect(brushed.paintArea.remainingArea).toBeLessThan(paintArea.totalArea * 0.1);
  });

  test('keeps every paint stamp inside the caster range', () => {
    const constrained = constrainSkillPaintPoint(
      { x: 130, y: 0 },
      { x: 0, y: 0 },
      100,
      18
    );

    expect(constrained.x).toBe(82);
    expect(constrained.y).toBe(0);
  });

  test('lays down dabs while dragging and places the remaining tail on release', () => {
    const initial = createSkillPaintArea({ casterModelCount: 30, aoeRadius: 42, maxRange: 220 });
    const brushed = appendSkillPaintDabs({
      paintArea: initial,
      from: { x: 0, y: 0 },
      to: { x: 120, y: 0 },
      origin: { x: 0, y: 0 },
      maxRange: 220
    });
    const completed = finishSkillPaintArea({
      paintArea: brushed.paintArea,
      point: { x: 120, y: 0 },
      origin: { x: 0, y: 0 },
      maxRange: 220
    });

    expect(brushed.paintArea.stamps.length).toBeGreaterThan(0);
    expect(completed.remainingArea).toBe(0);
    expect(completed.stamps.at(-1)).toMatchObject({ x: 120, y: 0 });
  });

  test('normalizes and recognizes the stamped combat region', () => {
    const area = normalizeSkillPaintArea({
      paintArea: {
        totalArea: Math.PI * 100,
        stamps: [{ x: 120, y: 0, radius: 10 }]
      },
      origin: { x: 0, y: 0 },
      maxRange: 80
    });

    expect(area.stamps[0]).toMatchObject({ x: 70, y: 0, radius: 10 });
    expect(isPointInsideSkillPaintArea({ x: 78, y: 0 }, area)).toBe(true);
    expect(isPointInsideSkillPaintArea({ x: 81, y: 0 }, area)).toBe(false);
  });
});
