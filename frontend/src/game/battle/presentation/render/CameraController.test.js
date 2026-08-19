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

  test('starts explicit following without making selection itself a follow request', () => {
    const camera = new CameraController({ distance: 560 });
    const anchor = { x: 220, y: 80, vx: 0, vy: 0, squadId: 'target-squad' };

    expect(camera.isFollowing()).toBe(false);
    expect(camera.startFollowing(anchor)).toBe(true);
    expect(camera.isFollowing()).toBe(true);
    expect(camera.followSquadId).toBe('target-squad');

    camera.clearFollow();
    expect(camera.isFollowing()).toBe(false);
    expect(camera.followSquadId).toBe('');
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

  test('begins lowering the training pitch before the prior training threshold', () => {
    const camera = new CameraController({ pitchLow: 15, pitchHigh: 90, distance: 3_200 });

    camera.setDistanceWithDynamicPitch(2_000, 200, 2_000, 3_200, 420);
    expect(camera.currentPitch).toBe(90);

    camera.setDistanceWithDynamicPitch(1_940, 200, 2_000, 3_200, 420);
    expect(camera.currentPitch).toBeLessThan(90);
    expect(camera.currentPitch).toBeGreaterThan(15);
  });

  test('raises the overview near plane to preserve thin terrain layers', () => {
    const camera = new CameraController({ pitchLow: 40, pitchHigh: 90, distance: 560 });

    camera.setDistanceWithDynamicPitch(4_600, 200, 980, 4_600);
    expect(camera.buildMatrices(1280, 720).nearPlane).toBe(48);

    camera.setDistanceWithDynamicPitch(200, 200, 980, 4_600);
    expect(camera.buildMatrices(1280, 720).nearPlane).toBe(16);
  });

  test('holds a 15-degree pitch while extending into the close ground band', () => {
    const camera = new CameraController({ pitchLow: 15, pitchHigh: 90, distance: 980 });

    camera.setDistanceWithDynamicPitch(420, 200, 980, 980, 420);
    expect(camera.distance).toBe(420);
    expect(camera.currentPitch).toBe(15);

    camera.setDistanceWithDynamicPitch(120, 200, 980, 980, 420);
    expect(camera.distance).toBe(200);
    expect(camera.currentPitch).toBe(15);
    expect(camera.buildMatrices(1280, 720).eye[2]).toBeCloseTo((200 * Math.sin(Math.PI / 12)) + 1, 6);
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

  test('publishes the world-yaw-adjusted render pose for screen-space picking', () => {
    const camera = new CameraController({ yawDeg: 0, pitchLow: 40, pitchHigh: 90, distance: 560 });
    camera.setPitchImmediate(40);
    camera.worldYawDeg = 90;
    const state = camera.buildMatrices(1000, 500);

    expect(state.renderEye[0]).not.toBeCloseTo(state.eye[0], 6);
    expect(state.renderEye[1]).not.toBeCloseTo(state.eye[1], 6);
    expect(state.renderForward[0]).toBeGreaterThan(0.7);
    expect(state.renderUp[2]).toBeGreaterThan(0.5);
  });
});
