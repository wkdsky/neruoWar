import CameraController from './CameraController';

describe('CameraController focus transition', () => {
  test('moves smoothly from the current camera center when follow resumes', () => {
    const camera = new CameraController({ distance: 560 });
    camera.centerX = -320;
    camera.centerY = 110;
    const anchor = { x: 420, y: -80, vx: 0, vy: 0, squadId: 'target-squad' };

    camera.beginFocusTransition(anchor);

    expect(camera.centerX).toBe(-320);
    expect(camera.centerY).toBe(110);

    camera.update(0.08, anchor);

    expect(camera.centerX).toBeGreaterThan(-320);
    expect(camera.centerX).toBeLessThan(420);
    expect(camera.centerY).toBeLessThan(110);
    expect(camera.centerY).toBeGreaterThan(-80);

    for (let frame = 0; frame < 10; frame += 1) {
      camera.update(0.05, anchor);
    }

    expect(camera.centerX).toBeGreaterThan(400);
    expect(camera.centerX).toBeLessThanOrEqual(420);
    expect(camera.centerY).toBeLessThan(-70);
    expect(camera.centerY).toBeGreaterThanOrEqual(-80);
  });

  test('keeps its current position and clears its binding without an anchor', () => {
    const camera = new CameraController({ distance: 560 });
    const anchor = { x: 220, y: 80, vx: 0, vy: 0, squadId: 'target-squad' };

    camera.update(0.2, anchor);
    const centerX = camera.centerX;
    const centerY = camera.centerY;
    camera.update(0.2, null);

    expect(camera.followSquadId).toBe('');
    expect(camera.centerX).toBe(centerX);
    expect(camera.centerY).toBe(centerY);
  });

  test('publishes the current pitch for pitch-aware render presentation', () => {
    const camera = new CameraController({ pitchLow: 40, pitchHigh: 90 });
    camera.setPitchImmediate(75);

    expect(camera.buildMatrices(1280, 720).pitchDeg).toBe(75);
  });

  test('keeps the pitch at high while extending into the overview distance band', () => {
    const camera = new CameraController({ pitchLow: 40, pitchHigh: 90, distance: 980 });

    camera.setDistanceWithDynamicPitch(1_400, 420, 980, 1_800);

    expect(camera.distance).toBe(1_400);
    expect(camera.currentPitch).toBe(90);
    expect(camera.getOverviewZoomProgress()).toBeCloseTo((1_400 - 980) / (1_800 - 980), 6);
    expect(camera.buildMatrices(1280, 720).overviewZoomProgress).toBeCloseTo(
      (1_400 - 980) / (1_800 - 980),
      6
    );

    camera.setDistanceWithDynamicPitch(2_000, 420, 980, 1_800);
    expect(camera.distance).toBe(1_800);
    expect(camera.currentPitch).toBe(90);
    expect(camera.getOverviewZoomProgress()).toBe(1);
  });

  test('covers the training battlefield at the end of the overview band', () => {
    const camera = new CameraController({ pitchLow: 40, pitchHigh: 90, distance: 980 });
    camera.setDistanceWithDynamicPitch(1_880, 420, 980, 1_880);
    camera.buildMatrices(1000, 500);

    const topLeft = camera.screenToGround(0, 0, { width: 1000, height: 500 });
    const bottomRight = camera.screenToGround(1000, 500, { width: 1000, height: 500 });

    expect(Math.abs(bottomRight.x - topLeft.x)).toBeGreaterThanOrEqual(2700);
    expect(Math.abs(bottomRight.y - topLeft.y)).toBeGreaterThanOrEqual(1488);
  });
});
