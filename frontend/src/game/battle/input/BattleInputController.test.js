import createBattleInputController, { resolveTrainingOverviewDistance } from './BattleInputController';
import CameraController from '../presentation/render/CameraController';
import { CAMERA_ZOOM_STEP } from '../screens/battleSceneConstants';
import { resolveTrainingDirectionArcLayout } from '../shared/trainingDirectionArc';
import {
  resolveTrainingDirectionArcAnchors,
  resolveTrainingWorldFlagHitRects
} from '../presentation/render/TrainingThreeRenderPipeline';

const createCanvas = () => ({
  width: 1000,
  height: 500,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 })
});

const createFixture = ({
  phase = 'battle',
  interactionLocked = false,
  getters = {},
  runtimeOverrides = {},
  camera: suppliedCamera = null,
  pipeline = null,
  constants: suppliedConstants = {}
} = {}) => {
  const canvas = createCanvas();
  const camera = suppliedCamera || {
    centerX: 10,
    centerY: 20,
    distance: 560,
    currentPitch: 30,
    pitchTweenDurationSec: 0.2,
    screenToGround: jest.fn((x, y) => ({ x, y }))
  };
  const runtime = {
    getPhase: jest.fn(() => phase),
    getSquadById: jest.fn(() => null),
    pickSquadAtPoint: jest.fn(() => ''),
    pickSquadAtAgentPoint: jest.fn(() => ''),
    pickDeployGroup: jest.fn(() => null),
    setSelectedDeployGroup: jest.fn(),
    setFocusSquad: jest.fn(),
    getCardRows: jest.fn(() => []),
    getMinimapSnapshot: jest.fn(() => null),
    ...runtimeOverrides
  };
  const callbacks = {
    setIsPanning: jest.fn(),
    setCards: jest.fn(),
    setMinimapSnapshot: jest.fn(),
    setSelectedSquadId: jest.fn(),
    setDeployActionAnchorMode: jest.fn(),
    ...runtimeOverrides.callbacks
  };
  const refs = {
    canvasRef: { current: canvas },
    runtimeRef: { current: runtime },
    cameraRef: { current: camera },
    pipelineRef: { current: pipeline },
    cameraViewRectRef: { current: { widthWorld: 100, heightWorld: 50 } },
    pointerWorldRef: { current: { x: 0, y: 0 } },
    panDragRef: { current: null },
    deployYawDragRef: { current: null },
    deployRectDragRef: { current: null },
    deployDirectionArcDragRef: { current: null },
    spacePressedRef: { current: false }
  };
  const controller = createBattleInputController({
    open: true,
    interactionLocked,
    canvasRef: refs.canvasRef,
    runtimeRef: refs.runtimeRef,
    cameraControllerRef: refs.cameraRef,
    pipelineRef: refs.pipelineRef,
    cameraViewRectRef: refs.cameraViewRectRef,
    pointerWorldRef: refs.pointerWorldRef,
    panDragRef: refs.panDragRef,
    deployYawDragRef: refs.deployYawDragRef,
    deployRectDragRef: refs.deployRectDragRef,
    deployDirectionArcDragRef: refs.deployDirectionArcDragRef,
    spacePressedRef: refs.spacePressedRef,
    constants: {
      BATTLE_UI_MODE_NONE: 'none',
      BATTLE_UI_MODE_PATH: 'path',
      BATTLE_UI_MODE_SPACING_PICK: 'spacing-pick',
      BATTLE_UI_MODE_SKILL_PICK: 'skill-pick',
      BATTLE_UI_MODE_SKILL_CONFIRM: 'skill-confirm',
      ORDER_MOVE: 'MOVE',
      ...suppliedConstants
    },
    getters: {
      getSelectedSquadId: () => '',
      getBattleUiMode: () => 'none',
      getSkillConfirmState: () => null,
      getAimState: () => null,
      getDeployDraggingGroupId: () => '',
      getDeployDraggingTeam: () => 'attacker',
      getSelectedPaletteItemId: () => '',
      isTrainingMode: () => false,
      ...getters
    },
    callbacks
  });

  return { callbacks, camera, controller, refs, runtime };
};

const sceneMouseDown = (overrides = {}) => ({
  button: 0,
  clientX: 100,
  clientY: 100,
  preventDefault: jest.fn(),
  target: { closest: () => null },
  ...overrides
});

test('uses a finer production wheel zoom increment', () => {
  expect(CAMERA_ZOOM_STEP).toBe(36);
});

describe('BattleInputController primary-button panning', () => {
  test('uses the current rendered flag polygon before the input-side fallback', () => {
    const pickTrainingWorldFlagIdAtScreen = jest.fn(function pickTrainingWorldFlagIdAtScreen() {
      return this.flagId;
    });
    const setHoveredBattleSquad = jest.fn();
    const { controller, runtime } = createFixture({
      getters: { isTrainingMode: () => true },
      pipeline: {
        threePipeline: { flagId: 'rendered-flag', pickTrainingWorldFlagIdAtScreen }
      },
      runtimeOverrides: {
        pickSquadAtPoint: jest.fn(() => 'overlapping-soldier'),
        setHoveredBattleSquad,
        setHoveredDeployDirectionArc: jest.fn()
      }
    });

    controller.onMouseMove({
      clientX: 320,
      clientY: 180,
      target: { closest: () => null }
    });

    expect(pickTrainingWorldFlagIdAtScreen).toHaveBeenCalledWith(320, 180);
    expect(setHoveredBattleSquad).toHaveBeenCalledWith('rendered-flag');
    expect(runtime.pickSquadAtPoint).not.toHaveBeenCalled();
    expect(runtime.pickSquadAtAgentPoint).not.toHaveBeenCalled();
  });

  test('clears training hover when the cursor misses every living soldier', () => {
    const setHoveredBattleSquad = jest.fn();
    const pickSquadAtAgentPoint = jest.fn(() => '');
    const { controller, runtime } = createFixture({
      getters: { isTrainingMode: () => true },
      runtimeOverrides: {
        pickSquadAtAgentPoint,
        setHoveredBattleSquad,
        setHoveredDeployDirectionArc: jest.fn()
      }
    });

    controller.onMouseMove({
      clientX: 320,
      clientY: 180,
      target: { closest: () => null }
    });

    expect(pickSquadAtAgentPoint).toHaveBeenCalledWith(320, 180, { team: 'any' });
    expect(setHoveredBattleSquad).toHaveBeenLastCalledWith('');
    expect(runtime.pickSquadAtPoint).not.toHaveBeenCalled();
  });

  test('uses an exact soldier hit only after flag hit testing misses', () => {
    const setHoveredBattleSquad = jest.fn();
    const pickSquadAtAgentPoint = jest.fn(() => 'soldier-squad');
    const { controller, runtime } = createFixture({
      getters: { isTrainingMode: () => true },
      runtimeOverrides: {
        pickSquadAtAgentPoint,
        setHoveredBattleSquad,
        setHoveredDeployDirectionArc: jest.fn()
      }
    });

    controller.onMouseMove({
      clientX: 320,
      clientY: 180,
      target: { closest: () => null }
    });

    expect(pickSquadAtAgentPoint).toHaveBeenCalledWith(320, 180, { team: 'any' });
    expect(setHoveredBattleSquad).toHaveBeenLastCalledWith('soldier-squad');
    expect(runtime.pickSquadAtPoint).not.toHaveBeenCalled();
  });

  test('uses the projected world flag under the cursor before ground squad picking', () => {
    const camera = new CameraController({ yawDeg: 0, pitchLow: 40, pitchHigh: 90, distance: 560 });
    camera.setPitchImmediate(40);
    camera.buildMatrices(1000, 500);
    const setHoveredBattleSquad = jest.fn();
    const runtime = {
      getPhase: jest.fn(() => 'battle'),
      getTrainingState: jest.fn(() => ({ points: 0 })),
      sim: {
        squads: [
          { id: 'flagged', team: 'attacker', x: 0, y: 0, remain: 100, radius: 20 }
        ]
      },
      pickSquadAtPoint: jest.fn(() => 'wrong-ground-squad'),
      setHoveredBattleSquad,
      setHoveredDeployDirectionArc: jest.fn()
    };
    const anchors = resolveTrainingDirectionArcAnchors(runtime);
    const [rect] = resolveTrainingWorldFlagHitRects({
      anchors,
      camera,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });
    const { controller } = createFixture({
      camera,
      getters: { isTrainingMode: () => true },
      runtimeOverrides: {
        ...runtime,
        isTrainingMode: true
      }
    });

    controller.onMouseMove({
      clientX: (rect.left + rect.right) * 0.5,
      clientY: (rect.top + rect.bottom) * 0.5,
      target: { closest: () => null }
    });

    expect(setHoveredBattleSquad).toHaveBeenCalledWith('flagged');
    expect(runtime.pickSquadAtPoint).not.toHaveBeenCalled();
  });

  test('selects the flagged squad before an overlapping soldier on click', () => {
    const camera = new CameraController({ yawDeg: 0, pitchLow: 40, pitchHigh: 90, distance: 560 });
    camera.setPitchImmediate(40);
    camera.buildMatrices(1000, 500);
    const runtime = {
      getPhase: jest.fn(() => 'battle'),
      getTrainingState: jest.fn(() => ({ points: 0 })),
      sim: {
        squads: [
          { id: 'flagged', team: 'attacker', x: 0, y: 0, remain: 100, radius: 20 }
        ]
      },
      pickSquadAtPoint: jest.fn(() => 'overlapping-soldier'),
      setHoveredBattleSquad: jest.fn(),
      setHoveredDeployDirectionArc: jest.fn()
    };
    const [rect] = resolveTrainingWorldFlagHitRects({
      anchors: resolveTrainingDirectionArcAnchors(runtime),
      camera,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });
    const selectBattleSquad = jest.fn();
    const { controller } = createFixture({
      camera,
      getters: { isTrainingMode: () => true },
      runtimeOverrides: {
        ...runtime,
        isTrainingMode: true,
        callbacks: { selectBattleSquad }
      }
    });
    const cleanup = controller.bindWindow();
    const clientX = (rect.points[0].x + rect.points[2].x) * 0.5;
    const clientY = rect.points[2].y;

    controller.onMouseDown(sceneMouseDown({ clientX, clientY }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      clientX,
      clientY
    }));

    expect(selectBattleSquad).toHaveBeenCalledWith('flagged', true);
    expect(runtime.pickSquadAtPoint).not.toHaveBeenCalled();
    cleanup();
  });

  test('selects a non-controllable battle squad from the battlefield', () => {
    const selectBattleSquad = jest.fn();
    const { controller, runtime } = createFixture({
      runtimeOverrides: {
        pickSquadAtPoint: jest.fn(() => 'ai_squad_1'),
        callbacks: { selectBattleSquad }
      }
    });
    const cleanup = controller.bindWindow();

    controller.onMouseDown(sceneMouseDown());
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 100
    }));

    expect(runtime.pickSquadAtPoint).toHaveBeenCalledWith(100, 100, {
      team: 'any',
      maxDist: 34
    });
    expect(selectBattleSquad).toHaveBeenCalledWith('ai_squad_1', true);
    cleanup();
  });

  test('calculates a wider training overview distance from the battlefield and viewport', () => {
    const landscape = resolveTrainingOverviewDistance({
      field: { width: 2700, height: 1488 },
      viewport: { width: 1000, height: 500 },
      baseDistance: 980
    });
    const portrait = resolveTrainingOverviewDistance({
      field: { width: 2700, height: 1488 },
      viewport: { width: 500, height: 1000 },
      baseDistance: 980
    });

    expect(landscape).toBeGreaterThan(980);
    expect(portrait).toBeGreaterThan(landscape);
  });

  test('passes the extended overview band to the training wheel zoom', () => {
    const setDistanceWithDynamicPitch = jest.fn();
    const camera = {
      distance: 980,
      setDistanceWithDynamicPitch,
      screenToGround: jest.fn()
    };
    const { controller } = createFixture({
      camera,
      getters: { isTrainingMode: () => true },
      runtimeOverrides: {
        getField: jest.fn(() => ({ width: 2700, height: 1488 }))
      }
    });

    controller.onWheel({
      deltaY: 1,
      preventDefault: jest.fn(),
      target: { closest: () => null }
    });

    expect(setDistanceWithDynamicPitch).toHaveBeenCalledWith(
      1_004,
      360,
      980,
      expect.any(Number),
      360
    );
    expect(setDistanceWithDynamicPitch.mock.calls[0][3]).toBeGreaterThan(980);
  });

  test('extends battle wheel zoom below the pitch anchor', () => {
    const setDistanceWithDynamicPitch = jest.fn();
    const camera = {
      distance: 420,
      setDistanceWithDynamicPitch,
      screenToGround: jest.fn()
    };
    const { controller } = createFixture({
      camera,
      constants: {
        CAMERA_ZOOM_STEP: 72,
        CAMERA_DISTANCE_CLOSE_MIN: 200,
        CAMERA_DISTANCE_MIN: 420,
        CAMERA_DISTANCE_MAX: 980
      }
    });

    controller.onWheel({
      deltaY: -1,
      preventDefault: jest.fn(),
      target: { closest: () => null }
    });

    expect(setDistanceWithDynamicPitch).toHaveBeenCalledWith(348, 200, 980, 980, 420);
  });

  test('rotates the selected deployment formation with the mouse wheel', () => {
    const group = {
      id: 'deploy-group',
      team: 'attacker',
      formationRect: { facingRad: 0 }
    };
    const setDeployGroupRect = jest.fn(() => ({ ok: true }));
    const { camera, controller, runtime } = createFixture({
      phase: 'deploy',
      getters: { getSelectedSquadId: () => 'deploy-group' },
      runtimeOverrides: {
        getDeployGroupById: jest.fn(() => group),
        setDeployGroupRect
      }
    });

    controller.onWheel({
      deltaY: -1,
      preventDefault: jest.fn(),
      target: { closest: () => null }
    });

    expect(setDeployGroupRect).toHaveBeenCalledWith(
      'deploy-group',
      { facingRad: expect.any(Number) },
      'attacker'
    );
    expect(setDeployGroupRect.mock.calls[0][1].facingRad).toBeCloseTo((Math.PI * 23) / 12, 6);
    expect(camera.distance).toBe(560);
    expect(runtime.getCardRows).toHaveBeenCalled();
  });

  test('pans the battle camera with a primary-button drag without issuing a battle command', () => {
    const { callbacks, camera, controller, refs, runtime } = createFixture();
    const cleanup = controller.bindWindow();

    controller.onMouseDown(sceneMouseDown());
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      buttons: 1,
      clientX: 140,
      clientY: 140
    }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      clientX: 140,
      clientY: 140
    }));

    expect(camera.centerX).toBe(-30);
    expect(camera.centerY).toBe(-20);
    expect(runtime.pickSquadAtPoint).not.toHaveBeenCalled();
    expect(refs.panDragRef.current).toBeNull();
    expect(callbacks.setIsPanning).toHaveBeenLastCalledWith(false);
    cleanup();
  });

  test('keeps a deploy primary-button click as a map command', () => {
    const deployGroup = { id: 'deploy-group', placed: true };
    const { callbacks, camera, controller, runtime } = createFixture({
      phase: 'deploy',
      runtimeOverrides: {
        pickDeployGroup: jest.fn(() => deployGroup)
      }
    });
    const cleanup = controller.bindWindow();

    controller.onMouseDown(sceneMouseDown());
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 100
    }));

    expect(camera.centerX).toBe(10);
    expect(camera.centerY).toBe(20);
    expect(runtime.pickDeployGroup).toHaveBeenCalledWith({ x: 100, y: 100 }, 'attacker');
    expect(runtime.setSelectedDeployGroup).toHaveBeenCalledWith('deploy-group');
    expect(callbacks.setSelectedSquadId).toHaveBeenCalledWith('deploy-group');
    cleanup();
  });

  test('lets a click on the empty deployment card strip reach the map', () => {
    const deployGroup = { id: 'deploy-group', placed: true };
    const { callbacks, controller, runtime } = createFixture({
      phase: 'deploy',
      getters: { isTrainingMode: () => true },
      runtimeOverrides: {
        pickDeployGroup: jest.fn(() => deployGroup)
      }
    });
    const cleanup = controller.bindWindow();
    const cardStrip = document.createElement('div');
    cardStrip.className = 'pve2-card-strip';

    controller.onMouseDown(sceneMouseDown({ target: cardStrip }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 100
    }));

    expect(runtime.pickDeployGroup).toHaveBeenCalledWith({ x: 100, y: 100 }, 'any');
    expect(runtime.setSelectedDeployGroup).toHaveBeenCalledWith('deploy-group');
    expect(callbacks.setSelectedSquadId).toHaveBeenCalledWith('deploy-group');
    cleanup();
  });

  test.each([
    { label: 'rotated camera', pitch: 40, worldYawDeg: 75 },
    { label: 'top-down camera', pitch: 90, worldYawDeg: 135 }
  ])('keeps the grabbed ground point under the pointer with a $label', ({ pitch, worldYawDeg }) => {
    const camera = new CameraController({
      yawDeg: 0,
      pitchLow: pitch,
      pitchHigh: 90,
      distance: 560
    });
    camera.currentPitch = pitch;
    camera.pitchFrom = pitch;
    camera.pitchTo = pitch;
    camera.pitchTweenSec = camera.pitchTweenDurationSec;
    camera.worldYawDeg = worldYawDeg;
    camera.buildMatrices(1000, 500);

    const { controller } = createFixture({ camera });
    const cleanup = controller.bindWindow();
    const grabbedGround = camera.screenToGround(500, 250, { width: 1000, height: 500 });

    controller.onMouseDown(sceneMouseDown({ clientX: 500, clientY: 250 }));
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      buttons: 1,
      clientX: 560,
      clientY: 285
    }));
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      buttons: 1,
      clientX: 605,
      clientY: 310
    }));

    const groundUnderPointer = camera.screenToGround(605, 310, { width: 1000, height: 500 });
    expect(groundUnderPointer.valid).toBe(true);
    expect(groundUnderPointer.x).toBeCloseTo(grabbedGround.x, 4);
    expect(groundUnderPointer.y).toBeCloseTo(grabbedGround.y, 4);
    cleanup();
  });

  test('focuses an already deployed training group after a double click', () => {
    const deployedGroup = { id: 'defender-group', x: 360, y: -120, placed: true };
    const { callbacks, camera, controller, runtime } = createFixture({
      phase: 'deploy',
      getters: {
        isTrainingMode: () => true
      },
      runtimeOverrides: {
        pickDeployGroup: jest.fn(() => deployedGroup)
      }
    });
    camera.beginFocusTransition = jest.fn();

    controller.onDoubleClick(sceneMouseDown({ clientX: 440, clientY: 220 }));

    expect(runtime.pickDeployGroup).toHaveBeenCalledWith({ x: 440, y: 220 }, 'any');
    expect(camera.centerX).toBe(360);
    expect(camera.centerY).toBe(-120);
    expect(camera.beginFocusTransition).toHaveBeenCalledWith({ x: 360, y: -120, squadId: 'defender-group' });
    expect(runtime.setSelectedDeployGroup).toHaveBeenCalledWith('defender-group');
    expect(callbacks.setSelectedSquadId).toHaveBeenCalledWith('defender-group');
  });

  test('starts following the soldier squad after a training double click', () => {
    const followBattleSquad = jest.fn(() => true);
    const { controller, runtime } = createFixture({
      getters: { isTrainingMode: () => true },
      runtimeOverrides: {
        pickSquadAtAgentPoint: jest.fn(() => 'soldier-squad'),
        callbacks: { followBattleSquad }
      }
    });

    controller.onDoubleClick(sceneMouseDown({ clientX: 320, clientY: 180 }));

    expect(runtime.pickSquadAtAgentPoint).toHaveBeenCalledWith(320, 180, { team: 'any' });
    expect(runtime.pickSquadAtPoint).not.toHaveBeenCalled();
    expect(followBattleSquad).toHaveBeenCalledWith('soldier-squad');
  });

  test('starts following the flag owner before an overlapping soldier', () => {
    const camera = new CameraController({ yawDeg: 0, pitchLow: 40, pitchHigh: 90, distance: 560 });
    camera.setPitchImmediate(40);
    camera.buildMatrices(1000, 500);
    const runtime = {
      getPhase: jest.fn(() => 'battle'),
      getTrainingState: jest.fn(() => ({ points: 0 })),
      sim: {
        squads: [
          { id: 'flagged', team: 'attacker', x: 0, y: 0, remain: 100, radius: 20 }
        ]
      },
      pickSquadAtPoint: jest.fn(() => 'overlapping-soldier'),
      setHoveredBattleSquad: jest.fn(),
      setHoveredDeployDirectionArc: jest.fn()
    };
    const [rect] = resolveTrainingWorldFlagHitRects({
      anchors: resolveTrainingDirectionArcAnchors(runtime),
      camera,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });
    const followBattleSquad = jest.fn(() => true);
    const { controller } = createFixture({
      camera,
      getters: { isTrainingMode: () => true },
      runtimeOverrides: {
        ...runtime,
        callbacks: { followBattleSquad }
      }
    });

    controller.onDoubleClick(sceneMouseDown({
      clientX: (rect.points[0].x + rect.points[2].x) * 0.5,
      clientY: rect.points[2].y
    }));

    expect(followBattleSquad).toHaveBeenCalledWith('flagged');
    expect(runtime.pickSquadAtPoint).not.toHaveBeenCalled();
  });

  test('pans while a deploy group is awaiting placement', () => {
    const { camera, controller, runtime } = createFixture({
      phase: 'deploy',
      getters: {
        getDeployDraggingGroupId: () => 'pending-group'
      },
      runtimeOverrides: {
        moveDeployGroup: jest.fn()
      }
    });
    const cleanup = controller.bindWindow();

    controller.onMouseDown(sceneMouseDown());
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      buttons: 1,
      clientX: 140,
      clientY: 140
    }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      clientX: 140,
      clientY: 140
    }));

    expect(camera.centerX).toBe(-30);
    expect(camera.centerY).toBe(-20);
    expect(runtime.moveDeployGroup).not.toHaveBeenCalled();
    cleanup();
  });

  test('clears deploy selection only on a blank click', () => {
    const clearSelection = jest.fn();
    const { callbacks, controller, runtime } = createFixture({
      phase: 'deploy',
      runtimeOverrides: {
        clearSelection
      }
    });
    const cleanup = controller.bindWindow();

    controller.onMouseDown(sceneMouseDown());
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 100
    }));

    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(callbacks.setSelectedSquadId).toHaveBeenCalledWith('');
    expect(runtime.pickDeployGroup).toHaveBeenCalled();
    cleanup();
  });

  test('clears battle selection and follow on a blank training click', () => {
    const clearSelection = jest.fn();
    const clearFollow = jest.fn();
    const syncBattleCards = jest.fn();
    const { callbacks, camera, controller, runtime } = createFixture({
      getters: { isTrainingMode: () => true },
      runtimeOverrides: {
        clearSelection,
        pickSquadAtAgentPoint: jest.fn(() => '')
      }
    });
    camera.clearFollow = clearFollow;
    callbacks.syncBattleCards = syncBattleCards;
    const cleanup = controller.bindWindow();

    controller.onMouseDown(sceneMouseDown());
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 100
    }));

    expect(runtime.pickSquadAtAgentPoint).toHaveBeenCalledWith(100, 100, { team: 'any' });
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(clearFollow).toHaveBeenCalledTimes(1);
    expect(callbacks.setSelectedSquadId).toHaveBeenCalledWith('');
    expect(syncBattleCards).toHaveBeenCalledTimes(1);
    cleanup();
  });

  test('does not start map input when pressing the compact training squad panel', () => {
    const { controller, refs } = createFixture();
    controller.onMouseDown(sceneMouseDown({
      target: {
        closest: (selector) => (selector.includes('.pve2-training-squad-panel') ? {} : null)
      }
    }));

    expect(refs.panDragRef.current).toBeNull();
  });

  test('does not start map input from the template editor overlay', () => {
    const { controller, refs } = createFixture();
    controller.onMouseDown(sceneMouseDown({
      target: {
        closest: (selector) => (selector.includes('.army-template-editor-overlay') ? {} : null)
      }
    }));

    expect(refs.panDragRef.current).toBeNull();
  });

  test('locks map input while a modal editor is open', () => {
    const { controller, refs, runtime } = createFixture({
      phase: 'deploy',
      interactionLocked: true
    });

    controller.onMouseDown(sceneMouseDown());
    controller.onMouseMove({
      clientX: 140,
      clientY: 120,
      target: { closest: () => null }
    });
    controller.onMinimapClick({ x: 12, y: 8 });

    expect(refs.panDragRef.current).toBeNull();
    expect(runtime.pickDeployGroup).not.toHaveBeenCalled();
  });

  test('updates deployment hover state without changing selected group', () => {
    const hoveredGroup = { id: 'hovered-group', placed: true };
    const setHoveredDeployGroup = jest.fn();
    const { controller, runtime } = createFixture({
      phase: 'deploy',
      getters: { isTrainingMode: () => true },
      runtimeOverrides: {
        pickDeployGroup: jest.fn(() => hoveredGroup),
        setHoveredDeployGroup
      }
    });

    controller.onMouseMove({
      clientX: 140,
      clientY: 120,
      target: { closest: () => null }
    });

    expect(runtime.pickDeployGroup).toHaveBeenCalledWith({ x: 140, y: 120 }, 'any');
    expect(setHoveredDeployGroup).toHaveBeenCalledWith('hovered-group');
    expect(runtime.setSelectedDeployGroup).not.toHaveBeenCalled();
  });
});

describe('BattleInputController training control', () => {
  test('rotates the battlefield with a right-button drag when no squad is selected', () => {
    const commandMove = jest.fn();
    const { camera, controller, refs } = createFixture({
      getters: {
        isTrainingMode: () => true
      },
      runtimeOverrides: {
        commandMove
      }
    });
    const cleanup = controller.bindWindow();

    controller.onMouseDown(sceneMouseDown({ button: 2, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      buttons: 2,
      clientX: 160,
      clientY: 100
    }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 2,
      clientX: 160,
      clientY: 100
    }));

    expect(commandMove).not.toHaveBeenCalled();
    expect(camera.worldYawDeg).toBeCloseTo(16.8, 6);
    expect(refs.deployYawDragRef.current).toBeNull();
    cleanup();
  });

  test('allows a user-controlled defender to receive a right-click move command', () => {
    const defender = { id: 'defender_squad_1', team: 'defender', remain: 20 };
    const syncBattleCards = jest.fn();
    const { controller, runtime } = createFixture({
      getters: {
        getSelectedSquadId: () => defender.id,
        isTrainingMode: () => true
      },
      runtimeOverrides: {
        getSquadById: jest.fn(() => defender),
        canControlSquad: jest.fn(() => true),
        commandMove: jest.fn(),
        callbacks: { syncBattleCards }
      }
    });

    controller.onMouseDown(sceneMouseDown({ button: 2, clientX: 420, clientY: 180 }));

    expect(runtime.canControlSquad).toHaveBeenCalledWith(defender);
    expect(runtime.commandMove).toHaveBeenCalledWith(defender.id, { x: 420, y: 180 }, {
      append: false,
      replace: true,
      orderType: 'MOVE',
      inputType: 'battle_rmb_move'
    });
    expect(syncBattleCards).toHaveBeenCalledTimes(1);
  });
});

describe('BattleInputController training placement', () => {
  test('keeps a training ghost on its card team while the cursor crosses the battlefield', () => {
    const resolveDeployPlacementTeam = jest.fn(() => 'defender');
    const switchDeployGroupTeamForTraining = jest.fn();
    const { callbacks, controller, runtime } = createFixture({
      phase: 'deploy',
      getters: {
        getDeployDraggingGroupId: () => 'attacker-pending',
        getDeployDraggingTeam: () => 'attacker',
        isTrainingMode: () => true
      },
      runtimeOverrides: {
        moveDeployGroup: jest.fn(),
        callbacks: {
          resolveDeployPlacementTeam,
          switchDeployGroupTeamForTraining
        }
      }
    });

    controller.onMouseMove({
      clientX: 900,
      clientY: 140,
      target: { closest: () => null }
    });

    expect(runtime.moveDeployGroup).toHaveBeenCalledWith('attacker-pending', { x: 900, y: 140 }, 'attacker');
    expect(resolveDeployPlacementTeam).not.toHaveBeenCalled();
    expect(switchDeployGroupTeamForTraining).not.toHaveBeenCalled();
    expect(callbacks.setCards).toHaveBeenCalled();
  });

  test('places a training group only for its original card team', () => {
    const resolveDeployPlacementTeam = jest.fn(() => 'defender');
    const switchDeployGroupTeamForTraining = jest.fn();
    const { controller, runtime } = createFixture({
      phase: 'deploy',
      getters: {
        getDeployDraggingGroupId: () => 'attacker-pending',
        getDeployDraggingTeam: () => 'attacker',
        isTrainingMode: () => true
      },
      runtimeOverrides: {
        canDeployGroupFitAt: jest.fn(() => true),
        moveDeployGroup: jest.fn(),
        setDeployGroupPlaced: jest.fn(),
        callbacks: {
          resolveDeployPlacementTeam,
          switchDeployGroupTeamForTraining
        }
      }
    });

    controller.handleMapCommand(sceneMouseDown({ clientX: 860, clientY: 120 }));

    expect(runtime.canDeployGroupFitAt).toHaveBeenCalledWith('attacker-pending', { x: 860, y: 120 }, 'attacker');
    expect(runtime.moveDeployGroup).toHaveBeenCalledWith('attacker-pending', { x: 860, y: 120 }, 'attacker');
    expect(runtime.setDeployGroupPlaced).toHaveBeenCalledWith('attacker', 'attacker-pending', true);
    expect(resolveDeployPlacementTeam).not.toHaveBeenCalled();
    expect(switchDeployGroupTeamForTraining).not.toHaveBeenCalled();
  });
});

describe('BattleInputController training direction arc', () => {
  test('clears battle selection from a blank point outside the visible direction ribbon', () => {
    const group = {
      id: 'battle-direction-blank',
      team: 'attacker',
      x: 100,
      y: 100,
      remain: 20,
      formationRect: { width: 80, depth: 40, facingRad: 0, directionOffsetRad: 0 }
    };
    const layout = resolveTrainingDirectionArcLayout(group, 'attacker');
    const blankPoint = {
      x: layout.apex.x + (layout.outward.x * 20),
      y: layout.apex.y + (layout.outward.y * 20)
    };
    const clearSelection = jest.fn();
    const { controller, refs } = createFixture({
      phase: 'battle',
      getters: {
        getSelectedSquadId: () => group.id,
        isTrainingMode: () => true
      },
      runtimeOverrides: {
        getSquadById: jest.fn(() => group),
        canControlSquad: jest.fn(() => true),
        clearSelection,
        pickSquadAtAgentPoint: jest.fn(() => ''),
        setHoveredDeployDirectionArc: jest.fn()
      }
    });
    const cleanup = controller.bindWindow();

    controller.onMouseDown(sceneMouseDown({
      clientX: blankPoint.x,
      clientY: blankPoint.y,
      target: { closest: () => null }
    }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      clientX: blankPoint.x,
      clientY: blankPoint.y
    }));

    expect(refs.deployDirectionArcDragRef.current).toBeNull();
    expect(clearSelection).toHaveBeenCalledTimes(1);
    cleanup();
  });

  test('highlights the selected formation arc and drags its snapped forward direction', () => {
    const group = {
      id: 'direction-group',
      team: 'attacker',
      x: 100,
      y: 100,
      placed: true,
      formationRect: { width: 80, depth: 40, facingRad: 0, directionOffsetRad: 0 }
    };
    const layout = resolveTrainingDirectionArcLayout(group, 'attacker');
    const setHoveredDeployDirectionArc = jest.fn();
    const setDeployGroupDirection = jest.fn(() => ({ ok: true }));
    const { controller, refs, runtime } = createFixture({
      phase: 'deploy',
      getters: {
        getSelectedSquadId: () => group.id,
        isTrainingMode: () => true
      },
      runtimeOverrides: {
        getDeployGroupById: jest.fn(() => group),
        setHoveredDeployDirectionArc,
        setDeployGroupDirection
      }
    });
    const cleanup = controller.bindWindow();
    const target = { closest: () => null };

    controller.onMouseMove({
      clientX: layout.apex.x,
      clientY: layout.apex.y,
      target
    });

    expect(setHoveredDeployDirectionArc).toHaveBeenLastCalledWith(group.id);

    controller.onMouseDown(sceneMouseDown({
      clientX: layout.apex.x,
      clientY: layout.apex.y,
      target
    }));

    expect(refs.deployDirectionArcDragRef.current).toMatchObject({
      groupId: group.id,
      team: 'attacker',
      phase: 'deploy',
      resumeClockOnRelease: false
    });
    expect(runtime.pickDeployGroup).not.toHaveBeenCalled();

    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      buttons: 1,
      clientX: 100,
      clientY: 180
    }));

    expect(setDeployGroupDirection).toHaveBeenCalledWith(group.id, expect.any(Number), 'attacker');
    expect(setDeployGroupDirection.mock.calls[setDeployGroupDirection.mock.calls.length - 1][1])
      .toBeCloseTo(Math.PI / 2, 6);

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    expect(refs.deployDirectionArcDragRef.current).toBeNull();
    cleanup();
  });

  test('pauses a battle while a selected direction arc is held and resumes on release', () => {
    const group = {
      id: 'battle-direction-group',
      team: 'attacker',
      x: 100,
      y: 100,
      remain: 20,
      formationRect: { width: 80, depth: 40, facingRad: 0, directionOffsetRad: 0 }
    };
    const layout = resolveTrainingDirectionArcLayout(group, 'attacker');
    const setClockPaused = jest.fn();
    const setDeployGroupDirection = jest.fn(() => ({ ok: true }));
    const { controller, refs } = createFixture({
      phase: 'battle',
      getters: {
        getSelectedSquadId: () => group.id,
        isClockPaused: () => false
      },
      runtimeOverrides: {
        getSquadById: jest.fn(() => group),
        canControlSquad: jest.fn(() => true),
        setHoveredDeployDirectionArc: jest.fn(),
        setDeployGroupDirection,
        callbacks: { setClockPaused }
      }
    });
    const cleanup = controller.bindWindow();
    const target = { closest: () => null };

    controller.onMouseMove({
      clientX: layout.apex.x,
      clientY: layout.apex.y,
      target
    });
    controller.onMouseDown(sceneMouseDown({
      clientX: layout.apex.x,
      clientY: layout.apex.y,
      target
    }));

    expect(refs.deployDirectionArcDragRef.current).toMatchObject({
      groupId: group.id,
      phase: 'battle',
      resumeClockOnRelease: true
    });
    expect(setClockPaused).toHaveBeenCalledWith(true);

    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      buttons: 1,
      clientX: 180,
      clientY: 180
    }));

    expect(setDeployGroupDirection.mock.calls[setDeployGroupDirection.mock.calls.length - 1][1])
      .toBeCloseTo(Math.PI / 4, 6);

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    expect(refs.deployDirectionArcDragRef.current).toBeNull();
    expect(setClockPaused).toHaveBeenLastCalledWith(false);
    cleanup();
  });
});
