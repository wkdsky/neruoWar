import * as THREE from 'three';
import {
  createGroundFlagGeometry,
  createTopDownFlagGeometry,
  prepareInstanceColorGeometry,
  resolveTrainingFlagAnchors,
  resolveTrainingFlagPresentation,
  TRAINING_FLAG_HIDE_DISTANCE,
  TRAINING_FLAG_OVERVIEW_SCALE_MAX,
  TRAINING_FLAG_SHOW_DISTANCE,
  TRAINING_FLAG_TOP_DOWN_PITCH_DEG
} from './TrainingThreeRenderPipeline';

describe('resolveTrainingFlagPresentation', () => {
  test('uses a ground flag at close zoom and a larger upright flag at distant zoom', () => {
    const close = resolveTrainingFlagPresentation(TRAINING_FLAG_HIDE_DISTANCE);
    const distant = resolveTrainingFlagPresentation(TRAINING_FLAG_SHOW_DISTANCE);

    expect(close.opacity).toBe(0);
    expect(close.groundOpacity).toBe(1);
    expect(distant.opacity).toBe(1);
    expect(distant.groundOpacity).toBe(0);
    expect(distant.scale).toBeGreaterThan(close.scale);
  });

  test('uses a gradual presentation between the close and distant thresholds', () => {
    const middle = resolveTrainingFlagPresentation(
      (TRAINING_FLAG_HIDE_DISTANCE + TRAINING_FLAG_SHOW_DISTANCE) * 0.5
    );

    expect(middle.opacity).toBeGreaterThan(0);
    expect(middle.opacity).toBeLessThan(1);
    expect(middle.groundOpacity).toBeGreaterThan(0);
    expect(middle.groundOpacity).toBeLessThan(1);
    expect(middle.scale).toBeGreaterThan(0.92);
    expect(middle.scale).toBeLessThan(1.26);
  });

  test('uses a square top-down flag only after leaving the close arrow range', () => {
    const closeTopDown = resolveTrainingFlagPresentation(
      TRAINING_FLAG_HIDE_DISTANCE,
      TRAINING_FLAG_TOP_DOWN_PITCH_DEG
    );
    const distantTopDown = resolveTrainingFlagPresentation(
      TRAINING_FLAG_SHOW_DISTANCE,
      TRAINING_FLAG_TOP_DOWN_PITCH_DEG
    );

    expect(closeTopDown.groundOpacity).toBe(1);
    expect(closeTopDown.topDownOpacity).toBe(0);
    expect(distantTopDown.opacity).toBe(0);
    expect(distantTopDown.groundOpacity).toBe(0);
    expect(distantTopDown.topDownOpacity).toBe(1);
  });

  test('enlarges the top-down flag through the overview distance band', () => {
    const base = resolveTrainingFlagPresentation(980, TRAINING_FLAG_TOP_DOWN_PITCH_DEG, 0);
    const overview = resolveTrainingFlagPresentation(980, TRAINING_FLAG_TOP_DOWN_PITCH_DEG, 1);

    expect(overview.topDownScale).toBeGreaterThan(base.topDownScale);
    expect(overview.topDownScale).toBeCloseTo(base.topDownScale * TRAINING_FLAG_OVERVIEW_SCALE_MAX, 6);
  });

  test('creates one flag anchor per visible squad without requiring a flag bearer agent', () => {
    const anchors = resolveTrainingFlagAnchors({
      getPhase: () => 'battle',
      sim: {
        squads: [
          { id: 'blue', team: 'attacker', remain: 30, x: -140, y: 20, radius: 18, flagBearerAgentId: '' },
          { id: 'red', team: 'defender', remain: 24, x: 160, y: -12, radius: 16, flagBearerAgentId: '' },
          { id: 'hidden', team: 'defender', remain: 24, x: 260, y: 0, hiddenFromAttacker: true }
        ]
      }
    });

    expect(anchors).toHaveLength(2);
    expect(anchors).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: -140, y: 20, teamIndex: 0 }),
      expect.objectContaining({ x: 160, y: -12, teamIndex: 1 })
    ]));
    expect(anchors.every((anchor) => anchor.scale >= 11)).toBe(true);
  });

  test('aligns a flag forward with the squad movement direction', () => {
    const [anchor] = resolveTrainingFlagAnchors({
      getPhase: () => 'battle',
      sim: {
        squads: [
          { id: 'northbound', team: 'attacker', remain: 20, x: 0, y: 0, dirX: 0, dirY: 1 }
        ]
      }
    });

    expect(anchor.yaw).toBeCloseTo(Math.PI / 2);
  });
});

describe('prepareInstanceColorGeometry', () => {
  test('provides a white geometry color baseline for instance colors', () => {
    const geometry = prepareInstanceColorGeometry(new THREE.BoxGeometry(1, 1, 1));
    const colors = geometry.getAttribute('color');

    expect(colors.count).toBe(geometry.getAttribute('position').count);
    expect(Array.from(colors.array).every((value) => value === 1)).toBe(true);
  });

  test('keeps the close marker arrow and uses a rectangle for top-down flags', () => {
    const arrowGeometry = createGroundFlagGeometry();
    const squareGeometry = createTopDownFlagGeometry();
    const arrowPositions = arrowGeometry.getAttribute('position');
    const squarePositions = squareGeometry.getAttribute('position');
    const arrowHasForwardTip = Array.from({ length: arrowPositions.count }, (_, index) => ({
      x: arrowPositions.getX(index),
      y: arrowPositions.getY(index)
    })).some((point) => point.x > 0.9 && Math.abs(point.y) < 0.001);
    const squareHasStraightSides = Array.from({ length: squarePositions.count }, (_, index) => (
      Math.abs(Math.abs(squarePositions.getX(index)) - 0.86) < 0.001
      && Math.abs(Math.abs(squarePositions.getY(index)) - 0.52) < 0.001
    )).every(Boolean);

    expect(arrowHasForwardTip).toBe(true);
    expect(squareHasStraightSides).toBe(true);
    expect(squareGeometry.index.count).toBe(6);
    expect(squareGeometry.getAttribute('color').count).toBe(4);
  });
});
