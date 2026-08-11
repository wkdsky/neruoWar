import * as THREE from 'three';
import CameraController from './CameraController';
import {
  createTrainingDirectionArcMaterial,
  createTrainingDirectionArcGeometry,
  createTrainingFlagClothGeometry,
  prepareInstanceColorGeometry,
  resolveTrainingDirectionArcAnchors,
  resolveTrainingMeleeAlertRect,
  resolveTrainingSkillMarkerCategory,
  resolveTrainingSkillVisualFocus,
  resolveTrainingSkillPreview,
  resolveTrainingHoverPresentation,
  resolveTrainingHoverFootprint,
  resolveTrainingWorldFlagHitRects,
  pickTrainingWorldFlagId,
  resolveTrainingFlagLod,
  resolveTrainingWorldFlagStackLayout,
  resolveTrainingWorldFlagStackLevels,
  resolveTrainingWorldFlagScreenScale,
  resolveTrainingWorldFlagDimensions,
  TRAINING_WORLD_FLAG_MAX_PITCH_DEG,
  TRAINING_WORLD_FLAG_TARGET_SCREEN_HEIGHT,
  TRAINING_DIRECTION_ARC_GROUND_ELEVATION
} from './TrainingThreeRenderPipeline';

describe('training direction markers', () => {
  test('hard switches between the world flag and the distant information label at 50 degrees', () => {
    expect(resolveTrainingFlagLod(TRAINING_WORLD_FLAG_MAX_PITCH_DEG)).toEqual({
      worldFlag: true,
      infoLabel: false
    });
    expect(resolveTrainingFlagLod(TRAINING_WORLD_FLAG_MAX_PITCH_DEG + 0.01)).toEqual({
      worldFlag: false,
      infoLabel: true
    });
  });

  test('assigns overlapping world flags to descending vertical stack levels', () => {
    const levels = resolveTrainingWorldFlagStackLevels([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 2, y: 1 },
      { id: 'c', x: 500, y: 0 }
    ], (anchor) => ({
      x: anchor.x,
      y: anchor.y,
      visible: true
    }));

    expect(levels.a).toBe(1);
    expect(levels.b).toBe(0);
    expect(levels.c).toBe(0);
  });

  test('keeps the nearest overlapping flag as the only visible pole owner', () => {
    const layout = resolveTrainingWorldFlagStackLayout([
      { id: 'rear', x: 0, y: 0 },
      { id: 'front', x: 2, y: 1 }
    ], (anchor) => ({
      x: anchor.x,
      y: anchor.y,
      distance: anchor.id === 'front' ? 20 : 80,
      visible: true
    }));

    expect(layout.leaderById.rear).toBe('front');
    expect(layout.leaderById.front).toBe('front');
    expect(layout.maxLevelByLeader.front).toBe(1);
  });

  test('creates one direction arc per visible squad without requiring a flag bearer agent', () => {
    const anchors = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'battle',
      getTrainingState: () => ({ points: 7 }),
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
      expect.objectContaining({ x: -140, y: 20, teamIndex: 0, remain: 30, startCount: 30, skillPoints: 7 }),
      expect.objectContaining({ x: 160, y: -12, teamIndex: 1 })
    ]));
    expect(anchors.every((anchor) => (
      anchor.arcLayout?.bulgeDepth > 0
      && anchor.poleHeight > anchor.clothHeight
      && anchor.clothBottom > 0
    ))).toBe(true);
  });

  test('aligns the arc forward with the squad movement direction', () => {
    const [anchor] = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'battle',
      sim: {
        squads: [
          { id: 'northbound', team: 'attacker', remain: 20, x: 0, y: 0, dirX: 0, dirY: 1 }
        ]
      }
    });

    expect(anchor.yaw).toBeCloseTo(Math.PI / 2);
  });

  test('highlights the selected battle direction arc while it is ready to drag', () => {
    const [anchor] = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'battle',
      selectedBattleSquadId: 'northbound',
      hoveredDeployDirectionArcId: 'northbound',
      sim: {
        squads: [
          {
            id: 'northbound',
            team: 'attacker',
            remain: 20,
            x: 0,
            y: 0,
            formationRect: { width: 60, depth: 16, facingRad: 0, directionOffsetRad: Math.PI / 2 }
          }
        ]
      }
    });

    expect(anchor).toMatchObject({ selected: true, hovered: true });
    expect(anchor.yaw).toBeCloseTo(Math.PI / 2);
  });

  test('marks the hovered squad flag independently from the direction arc hover', () => {
    const [anchor] = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'battle',
      hoveredBattleSquadId: 'northbound',
      hoveredDeployDirectionArcId: '',
      sim: {
        squads: [{ id: 'northbound', team: 'attacker', remain: 20, x: 0, y: 0 }]
      }
    });

    expect(anchor).toMatchObject({ flagHovered: true, hovered: false });
  });

  test('uses the edited deployment formation facing before battle starts', () => {
    const [anchor] = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'deploy',
      attackerDeployGroups: [
        {
          id: 'turned-line',
          team: 'attacker',
          placed: true,
          remain: 20,
          x: 0,
          y: 0,
          dirX: 1,
          dirY: 0,
          formationRect: { width: 60, depth: 16, facingRad: Math.PI / 2 }
        }
      ]
    });

    expect(anchor.yaw).toBeCloseTo(Math.PI / 2);
  });

  test('keeps the real flag wide enough for readable battlefield data', () => {
    const dimensions = resolveTrainingWorldFlagDimensions({ remain: 5_408, radius: 126 });

    expect(dimensions.clothHeight).toBeGreaterThanOrEqual(17);
    expect(dimensions.clothWidth).toBeGreaterThanOrEqual(36);
    expect(dimensions.clothWidth / dimensions.clothHeight).toBeLessThan(2.2);
    expect(dimensions.clothBottom).toBeLessThanOrEqual(3);
    expect(dimensions.clothBottom + dimensions.clothHeight).toBeLessThan(dimensions.poleHeight);
  });

  test('keeps the world flag at a stable screen height across camera depths', () => {
    const clothHeight = 20;
    const viewportHeight = 800;
    const nearViewHeight = 240;
    const distantViewHeight = 480;
    const nearScale = resolveTrainingWorldFlagScreenScale({
      clothHeight,
      viewHeight: nearViewHeight,
      viewportHeight
    });
    const distantScale = resolveTrainingWorldFlagScreenScale({
      clothHeight,
      viewHeight: distantViewHeight,
      viewportHeight
    });
    const nearPixels = (clothHeight * nearScale / nearViewHeight) * viewportHeight;
    const distantPixels = (clothHeight * distantScale / distantViewHeight) * viewportHeight;
    const tiltedScale = resolveTrainingWorldFlagScreenScale({
      clothHeight,
      viewHeight: distantViewHeight,
      viewportHeight,
      verticalScreenFactor: 0.65
    });

    expect(distantScale).toBeCloseTo(nearScale * 2, 6);
    expect(distantPixels).toBeCloseTo(nearPixels, 6);
    expect(nearPixels).toBeCloseTo(TRAINING_WORLD_FLAG_TARGET_SCREEN_HEIGHT, 6);
    expect(tiltedScale).toBeGreaterThan(distantScale);
  });

  test('projects low-angle world flags into independent screen hit rectangles', () => {
    const camera = {
      currentPitch: 40,
      eye: [0, -560, 360],
      target: [0, 0, 0]
    };
    const project = (point) => ({
      x: 500 + (point.x * 2),
      y: 420 - (point.y * 0.8) - (point.z * 2),
      visible: true
    });
    const rects = resolveTrainingWorldFlagHitRects({
      anchors: [
        { id: 'front', x: 0, y: 0, remain: 100, radius: 20 },
        { id: 'rear', x: 0, y: 220, remain: 100, radius: 20 }
      ],
      camera,
      project,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });

    expect(rects).toHaveLength(2);
    const rear = rects.find((rect) => rect.id === 'rear');
    expect(pickTrainingWorldFlagId(rects, (rear.left + rear.right) * 0.5, (rear.top + rear.bottom) * 0.5))
      .toBe('rear');
    expect(resolveTrainingWorldFlagHitRects({
      anchors: [{ id: 'front', x: 0, y: 0, remain: 100, radius: 20 }],
      camera: { ...camera, currentPitch: 60 },
      project,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    })).toEqual([]);
  });

  test('uses the rendered flag silhouette instead of a padded centered hit box', () => {
    const camera = {
      currentPitch: 40,
      eye: [0, -560, 360],
      target: [0, 0, 0]
    };
    const project = (point) => ({
      x: 500 + (point.x * 2),
      y: 420 - (point.y * 0.8) - (point.z * 2),
      visible: true
    });
    const [rect] = resolveTrainingWorldFlagHitRects({
      anchors: [{ id: 'front', x: 0, y: 0, remain: 100, radius: 20 }],
      camera,
      project,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });
    const transparentPoint = project({
      x: rect.displayX + (Math.cos(rect.cameraYaw + (Math.PI / 2))
        * rect.clothWidth * rect.worldFlagScale * 0.5),
      y: rect.displayY + (Math.sin(rect.cameraYaw + (Math.PI / 2))
        * rect.clothWidth * rect.worldFlagScale * 0.5),
      z: rect.baseZ
    });
    const notch = rect.points[2];
    const insidePoint = {
      x: (rect.points[0].x + notch.x) * 0.5,
      y: notch.y
    };

    expect(rect.points).toHaveLength(5);
    expect(pickTrainingWorldFlagId([rect], transparentPoint.x, transparentPoint.y)).toBe('');
    expect(pickTrainingWorldFlagId([rect], insidePoint.x, insidePoint.y)).toBe('front');
    expect(pickTrainingWorldFlagId([rect], rect.right - 1, notch.y)).toBe('');
  });

  test('uses the nearest flag dimensions for every snapped flag', () => {
    const camera = {
      currentPitch: 40,
      eye: [0, -560, 360],
      target: [0, 0, 0]
    };
    const project = (point) => ({
      x: 500 + (point.x * 2),
      y: 420 - (point.y * 0.8) - (point.z * 2),
      visible: true
    });
    const rects = resolveTrainingWorldFlagHitRects({
      anchors: [
        { id: 'front', x: 0, y: 0, remain: 100, radius: 20 },
        { id: 'rear', x: 0, y: 24, remain: 5408, radius: 126 }
      ],
      camera,
      project,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });
    const front = rects.find((rect) => rect.id === 'front');
    const rear = rects.find((rect) => rect.id === 'rear');

    expect(rear.leaderId).toBe('front');
    expect(rear.right - rear.left).toBeCloseTo(front.right - front.left, 6);
    expect(rear.bottom - rear.top).toBeCloseTo(front.bottom - front.top, 6);
    expect(Math.abs(rear.points[0].y - front.points[0].y)).toBeCloseTo(
      front.bottom - front.top,
      6
    );
    expect(rear.points[0].x).toBeCloseTo(front.points[4].x, 6);
    expect(rear.points[0].y).toBeCloseTo(front.points[4].y, 6);
    expect(rear.points[1].x).toBeCloseTo(front.points[3].x, 6);
    expect(rear.points[1].y).toBeCloseTo(front.points[3].y, 6);
  });

  test('matches the rendered flag edge after the camera rotates around the battlefield', () => {
    const camera = new CameraController({ yawDeg: 0, pitchLow: 40, pitchHigh: 90, distance: 560 });
    camera.setPitchImmediate(40);
    camera.worldYawDeg = 75;
    const cameraState = camera.buildMatrices(1000, 500);
    const renderedCamera = new THREE.PerspectiveCamera(48, 2, 1, 8000);
    renderedCamera.matrixAutoUpdate = false;
    renderedCamera.matrixWorldAutoUpdate = false;
    renderedCamera.projectionMatrix.fromArray(cameraState.projection);
    renderedCamera.projectionMatrixInverse.copy(renderedCamera.projectionMatrix).invert();
    renderedCamera.matrixWorldInverse.fromArray(cameraState.viewWorld);
    renderedCamera.matrixWorld.copy(renderedCamera.matrixWorldInverse).invert();
    renderedCamera.position.setFromMatrixPosition(renderedCamera.matrixWorld);

    const anchor = { id: 'rotated', x: 120, y: -80, remain: 100, radius: 20 };
    const [rect] = resolveTrainingWorldFlagHitRects({
      anchors: [anchor],
      camera,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });
    const dimensions = resolveTrainingWorldFlagDimensions(anchor);
    const forward = new THREE.Vector3(0, 0, -1).transformDirection(renderedCamera.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(renderedCamera.matrixWorld);
    const cameraDepth = Math.max(
      1,
      new THREE.Vector3(anchor.x, anchor.y, dimensions.clothBottom)
        .sub(renderedCamera.position)
        .dot(forward)
    );
    const viewHeight = 2 * cameraDepth * Math.tan((48 * Math.PI / 180) * 0.5);
    const scale = resolveTrainingWorldFlagScreenScale({
      clothHeight: dimensions.clothHeight,
      viewHeight,
      viewportHeight: 500,
      verticalScreenFactor: Math.max(0.35, Math.abs(up.z))
    });
    const yaw = Math.atan2(
      renderedCamera.position.y - anchor.y,
      renderedCamera.position.x - anchor.x
    );
    const expectedPoint = new THREE.Vector3(
      anchor.x + (Math.cos(yaw + (Math.PI / 2)) * dimensions.clothWidth * scale * (1 - (12 / 512))),
      anchor.y + (Math.sin(yaw + (Math.PI / 2)) * dimensions.clothWidth * scale * (1 - (12 / 512))),
      dimensions.clothBottom + (dimensions.clothHeight * scale * (86 / 232))
    ).project(renderedCamera);

    expect(rect.points[1].x).toBeCloseTo((expectedPoint.x + 1) * 500, 5);
    expect(rect.points[1].y).toBeCloseTo((1 - expectedPoint.y) * 250, 5);
  });
});

describe('prepareInstanceColorGeometry', () => {
  test('provides a white geometry color baseline for instance colors', () => {
    const geometry = prepareInstanceColorGeometry(new THREE.BoxGeometry(1, 1, 1));
    const colors = geometry.getAttribute('color');

    expect(colors.count).toBe(geometry.getAttribute('position').count);
    expect(Array.from(colors.array).every((value) => value === 1)).toBe(true);
  });

  test('creates a curved, vertex-colored direction ribbon instead of an arrow or rectangle marker', () => {
    const geometry = createTrainingDirectionArcGeometry();
    const positions = geometry.getAttribute('position');
    const xValues = Array.from({ length: positions.count }, (_, index) => positions.getX(index));
    const yValues = Array.from({ length: positions.count }, (_, index) => positions.getY(index));

    expect(Math.max(...xValues)).toBeGreaterThan(0.99);
    expect(Math.max(...yValues)).toBeGreaterThan(0.9);
    expect(Math.min(...yValues)).toBeLessThan(-0.9);
    expect(geometry.getAttribute('color').count).toBe(positions.count);
    Array.from({ length: positions.count }, (_, index) => positions.getZ(index))
      .forEach((z) => expect(z).toBeCloseTo(TRAINING_DIRECTION_ARC_GROUND_ELEVATION, 6));
  });

  test('keeps the direction arc on the ground and behind opaque soldiers', () => {
    const material = createTrainingDirectionArcMaterial();

    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    material.dispose();
  });

  test('creates an upright cloth shape fixed to a flagpole edge', () => {
    const geometry = createTrainingFlagClothGeometry();
    const positions = geometry.getAttribute('position');
    const xValues = Array.from({ length: positions.count }, (_, index) => positions.getX(index));
    const yValues = Array.from({ length: positions.count }, (_, index) => positions.getY(index));
    const zValues = Array.from({ length: positions.count }, (_, index) => positions.getZ(index));

    expect(Math.min(...xValues)).toBeCloseTo(0);
    expect(Math.max(...xValues)).toBeCloseTo(1);
    expect(Math.max(...yValues)).toBeCloseTo(0);
    expect(Math.min(...zValues)).toBeCloseTo(0);
    expect(Math.max(...zValues)).toBeCloseTo(1);
  });
});

describe('training hover footprint', () => {
  test('raises hover contrast as the camera moves into overview distance', () => {
    const close = resolveTrainingHoverPresentation({ distance: 560, overviewZoomProgress: 0 });
    const distant = resolveTrainingHoverPresentation({ distance: 3_600, overviewZoomProgress: 1 });

    expect(distant.zoomOutProgress).toBeGreaterThan(close.zoomOutProgress);
    expect(distant.outerOpacity).toBeGreaterThan(close.outerOpacity);
    expect(distant.innerColorMix).toBeGreaterThan(close.innerColorMix);
  });

  test('keeps the hover footprint beyond the chibi body without reaching selected-ring size', () => {
    const smallFootprint = resolveTrainingHoverFootprint(2.6);
    const largeFootprint = resolveTrainingHoverFootprint(10.5);

    expect(smallFootprint.outer.width).toBeCloseTo(5.096, 6);
    expect(smallFootprint.outer.depth).toBeCloseTo(4.212, 6);
    expect(smallFootprint.outer.width).toBeGreaterThan(2.6 * 1.36);
    expect(smallFootprint.outer.depth).toBeGreaterThan(2.6 * 1.24);
    expect(smallFootprint.outer.width).toBeLessThan(2.6 * 3.4);
    expect(smallFootprint.inner.width).toBeLessThan(smallFootprint.outer.width);
    expect(smallFootprint.inner.depth).toBeLessThan(smallFootprint.outer.depth);
    expect(largeFootprint.outer.width).toBeCloseTo(20.58, 6);
    expect(smallFootprint.outer.elevation).toBeLessThan(smallFootprint.inner.elevation);
  });
});

describe('training skill preview', () => {
  const runtime = {
    getSquadById: (id) => ({
      attacker: { id: 'attacker', team: 'attacker', x: 0, y: 0, dirX: 1, dirY: 0 },
      defender: { id: 'defender', team: 'defender', x: 60, y: 0 }
    }[id] || null),
    crowd: {
      allAgents: [
        { id: 'front', squadId: 'defender', team: 'defender', x: 30, y: 0, weight: 4 },
        { id: 'side', squadId: 'defender', team: 'defender', x: 30, y: 50, weight: 4 },
        { id: 'far', squadId: 'defender', team: 'defender', x: 190, y: 0, weight: 4 }
      ]
    }
  };

  test('marks only enemies inside a ground target radius', () => {
    const preview = resolveTrainingSkillPreview(runtime, {
      squadId: 'attacker',
      targetMode: 'ground',
      center: { x: 0, y: 0 },
      hoverPoint: { x: 30, y: 0 },
      maxRange: 260,
      aoeRadius: 8,
      profile: { targetMode: 'ground' }
    });

    expect(preview.targetAgents.map((agent) => agent.id)).toEqual(['front']);
    expect(preview.targetSquadIds).toEqual(['defender']);
  });

  test('uses the ground direction cone for melee previews', () => {
    const preview = resolveTrainingSkillPreview(runtime, {
      squadId: 'attacker',
      targetMode: 'direction',
      center: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
      len: 60,
      maxRange: 80,
      aoeRadius: 24,
      profile: { targetMode: 'direction', coneAngleDeg: 90, shape: 'cone' }
    });

    expect(preview.targetAgents.map((agent) => agent.id)).toEqual(['front']);
    expect(preview.direction).toEqual({ x: 1, y: 0 });
  });

  test('re-evaluates possible targets from their current soldier positions', () => {
    const movingRuntime = {
      ...runtime,
      crowd: {
        allAgents: runtime.crowd.allAgents.map((agent) => ({ ...agent }))
      }
    };
    movingRuntime.crowd.allAgents[0].x = 46;
    const preview = resolveTrainingSkillPreview(movingRuntime, {
      squadId: 'attacker',
      targetMode: 'ground',
      center: { x: 0, y: 0 },
      hoverPoint: { x: 30, y: 0 },
      maxRange: 260,
      aoeRadius: 8,
      profile: { targetMode: 'ground' }
    });

    expect(preview.targetAgents).toHaveLength(0);
  });

  test('treats a melee ground target as a charge point and previews the path', () => {
    const preview = resolveTrainingSkillPreview(runtime, {
      squadId: 'attacker',
      targetMode: 'ground',
      center: { x: 0, y: 0 },
      hoverPoint: { x: 30, y: 0 },
      maxRange: 80,
      aoeRadius: 8,
      profile: { targetMode: 'ground', castStyle: 'melee' }
    });

    expect(preview.castStyle).toBe('melee');
    expect(preview.targetAgents.map((agent) => agent.id)).toEqual(['front']);
  });

  test('uses distinct marker categories and an expanded oriented alert rectangle', () => {
    expect(resolveTrainingSkillMarkerCategory({ typeCategory: 'cavalry', unitCategory: 'melee' }, 'melee')).toBe('cavalry');
    expect(resolveTrainingSkillMarkerCategory({ typeCategory: 'infantry', unitCategory: 'support' }, 'support')).toBe('support');
    const rect = resolveTrainingMeleeAlertRect({
      x: 0,
      y: 0,
      radius: 20,
      team: 'attacker',
      formationRect: { width: 60, depth: 24, facingRad: Math.PI / 2 }
    }, { x: 40, y: 12 });
    expect(rect).toMatchObject({ x: 40, y: 12, width: 92, depth: 56, yaw: Math.PI / 2 });
  });

  test('keeps the selected skill category bright and shadows other soldiers while preparing', () => {
    const focus = resolveTrainingSkillVisualFocus({
      getSquadById: () => ({ hiddenFromAttacker: false }),
      crowd: {
        allAgents: [
          { id: 'melee', squadId: 'attacker', team: 'attacker', unitCategory: 'melee', weight: 2 },
          { id: 'ranged', squadId: 'attacker', team: 'attacker', unitCategory: 'ranged', weight: 2 },
          { id: 'enemy', squadId: 'defender', team: 'defender', unitCategory: 'melee', weight: 2 }
        ]
      }
    }, {
      squadId: 'attacker',
      profile: { sourceCategory: 'melee' }
    });

    expect(focus.focusFlags).toEqual([true, false, false]);
    expect(focus.shadowFlags).toEqual([false, true, false]);
  });
});
