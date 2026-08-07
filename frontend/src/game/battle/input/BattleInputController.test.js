import createBattleInputController from './BattleInputController';

const createCanvas = () => ({
  width: 1000,
  height: 500,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 })
});

const createFixture = ({ phase = 'battle', getters = {}, runtimeOverrides = {} } = {}) => {
  const canvas = createCanvas();
  const camera = {
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
    cameraViewRectRef: { current: { widthWorld: 100, heightWorld: 50 } },
    pointerWorldRef: { current: { x: 0, y: 0 } },
    panDragRef: { current: null },
    deployYawDragRef: { current: null },
    deployRectDragRef: { current: null },
    spacePressedRef: { current: false }
  };
  const controller = createBattleInputController({
    open: true,
    canvasRef: refs.canvasRef,
    runtimeRef: refs.runtimeRef,
    cameraControllerRef: refs.cameraRef,
    cameraViewRectRef: refs.cameraViewRectRef,
    pointerWorldRef: refs.pointerWorldRef,
    panDragRef: refs.panDragRef,
    deployYawDragRef: refs.deployYawDragRef,
    deployRectDragRef: refs.deployRectDragRef,
    spacePressedRef: refs.spacePressedRef,
    constants: {
      BATTLE_UI_MODE_NONE: 'none',
      BATTLE_UI_MODE_PATH: 'path',
      BATTLE_UI_MODE_MARCH_PICK: 'march-pick',
      BATTLE_UI_MODE_SKILL_PICK: 'skill-pick',
      BATTLE_UI_MODE_SKILL_CONFIRM: 'skill-confirm',
      ORDER_MOVE: 'MOVE'
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

describe('BattleInputController primary-button panning', () => {
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

    expect(camera.centerX).toBe(6);
    expect(camera.centerY).toBe(24);
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

    expect(camera.centerX).toBe(6);
    expect(camera.centerY).toBe(24);
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
});

describe('BattleInputController training control', () => {
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
