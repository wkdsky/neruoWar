import {
  isPointOnTrainingDirectionArc,
  resolveTrainingDirectionOffsetFromPoint,
  resolveTrainingDirectionArcLayout,
  snapTrainingDirectionOffset,
  sampleTrainingDirectionArc,
  TRAINING_DIRECTION_ARC_CENTRAL_ANGLE_RAD,
  TRAINING_DIRECTION_ARC_DIRECTION_COUNT,
  TRAINING_DIRECTION_ARC_DIRECTION_STEP_RAD
} from './trainingDirectionArc';

const buildGroup = (directionRad = 0) => ({
  id: 'training-group',
  x: 120,
  y: -40,
  team: 'attacker',
  formationRect: {
    width: 80,
    depth: 40,
    facingRad: 0,
    directionOffsetRad: directionRad
  }
});

describe('training direction arc geometry', () => {
  test('attaches both ends to one edge when facing a rectangular side', () => {
    const layout = resolveTrainingDirectionArcLayout(buildGroup(), 'attacker');

    expect(layout.start.edges).toEqual(['front']);
    expect(layout.end.edges).toEqual(['front']);
    expect(layout.boundary.x).toBeCloseTo(140);
    expect(layout.apex.x).toBeGreaterThan(layout.boundary.x);
    expect(layout.bandWidth).toBeGreaterThanOrEqual(5);
  });

  test('bridges two neighboring edges when facing a formation corner', () => {
    const cornerYaw = Math.PI / 4;
    const layout = resolveTrainingDirectionArcLayout(buildGroup(cornerYaw), 'attacker');

    expect(layout.start.edges).toContain('front');
    expect(layout.end.edges).toContain('right');
    expect(layout.apex.x).toBeGreaterThan(120);
    expect(layout.apex.y).toBeGreaterThan(-40);
  });

  test('keeps the curved hit target on the exterior bump rather than the formation center', () => {
    const group = buildGroup();
    const layout = resolveTrainingDirectionArcLayout(group, 'attacker');
    const samples = sampleTrainingDirectionArc(layout);
    const middle = samples[Math.floor(samples.length / 2)].point;

    expect(middle.x).toBeCloseTo(layout.apex.x, 6);
    expect(middle.y).toBeCloseTo(layout.apex.y, 6);
    expect(isPointOnTrainingDirectionArc(middle, group, 'attacker')).toBe(true);
    expect(isPointOnTrainingDirectionArc({ x: group.x, y: group.y }, group, 'attacker')).toBe(false);
  });

  test('supports a wider invisible hit band for a selected arc under soldiers', () => {
    const group = buildGroup();
    const layout = resolveTrainingDirectionArcLayout(group, 'attacker');
    const occludedPoint = {
      x: layout.apex.x + (layout.outward.x * 23),
      y: layout.apex.y + (layout.outward.y * 23)
    };

    expect(isPointOnTrainingDirectionArc(occludedPoint, group, 'attacker')).toBe(false);
    expect(isPointOnTrainingDirectionArc(occludedPoint, group, 'attacker', {
      minimumHitRadius: 24,
      maximumHitRadius: 42,
      extraPadding: 14
    })).toBe(true);
  });

  test('uses one fixed circular curvature while the rectangular attachment changes', () => {
    const layout = resolveTrainingDirectionArcLayout(buildGroup(Math.PI / 4), 'attacker');
    const samples = sampleTrainingDirectionArc(layout);

    expect(Math.abs(layout.sweepRad)).toBeCloseTo(TRAINING_DIRECTION_ARC_CENTRAL_ANGLE_RAD, 6);
    samples.forEach((sample) => {
      expect(Math.hypot(
        sample.point.x - layout.arcCenter.x,
        sample.point.y - layout.arcCenter.y
      )).toBeCloseTo(layout.arcRadius, 6);
    });
  });

  test('keeps the arc at the same local offset when the formation rectangle rotates', () => {
    const initial = resolveTrainingDirectionArcLayout(buildGroup(Math.PI / 4), 'attacker');
    const rotatedGroup = buildGroup(Math.PI / 4);
    rotatedGroup.formationRect.facingRad = Math.PI / 2;
    const rotated = resolveTrainingDirectionArcLayout(rotatedGroup, 'attacker');

    expect(rotated.directionYaw - initial.directionYaw).toBeCloseTo(Math.PI / 2, 6);
  });

  test('snaps stored and pointer directions to the nearest of eight local directions', () => {
    const group = buildGroup();
    group.formationRect.facingRad = Math.PI / 6;

    expect(TRAINING_DIRECTION_ARC_DIRECTION_COUNT).toBe(8);
    expect(snapTrainingDirectionOffset(TRAINING_DIRECTION_ARC_DIRECTION_STEP_RAD * 0.42)).toBeCloseTo(0, 6);
    expect(snapTrainingDirectionOffset(TRAINING_DIRECTION_ARC_DIRECTION_STEP_RAD * 0.58))
      .toBeCloseTo(TRAINING_DIRECTION_ARC_DIRECTION_STEP_RAD, 6);
    expect(resolveTrainingDirectionOffsetFromPoint(group, {
      x: group.x + Math.cos(group.formationRect.facingRad + 0.62) * 100,
      y: group.y + Math.sin(group.formationRect.facingRad + 0.62) * 100
    }, 'attacker')).toBeCloseTo(Math.PI / 4, 6);

    group.formationRect.directionOffsetRad = 0.62;
    expect(resolveTrainingDirectionArcLayout(group, 'attacker').directionYaw)
      .toBeCloseTo(group.formationRect.facingRad + (Math.PI / 4), 6);
  });
});
