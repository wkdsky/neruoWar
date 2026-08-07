import {
  activateUnplacedTrainingGroup,
  focusDeployZoneIfOffscreen
} from './useBattleSceneSelection';

describe('focusDeployZoneIfOffscreen', () => {
  const runtime = {
    getDeployRange: () => ({ defenderMinX: 360, maxX: 600 })
  };

  test('moves the camera to the red deployment zone when it is offscreen', () => {
    const camera = { centerX: -420, centerY: 75 };
    const cameraViewRectRef = { current: { widthWorld: 180, heightWorld: 120 } };

    expect(focusDeployZoneIfOffscreen({
      runtime,
      camera,
      cameraViewRectRef,
      team: 'defender'
    })).toBe(true);
    expect(camera).toEqual({ centerX: 480, centerY: 0 });
  });

  test('keeps the camera in place when the red deployment zone is already visible', () => {
    const camera = { centerX: 470, centerY: 75 };
    const cameraViewRectRef = { current: { widthWorld: 220, heightWorld: 120 } };

    expect(focusDeployZoneIfOffscreen({
      runtime,
      camera,
      cameraViewRectRef,
      team: 'defender'
    })).toBe(false);
    expect(camera).toEqual({ centerX: 470, centerY: 75 });
  });

  test('activating an unplaced defender card starts mouse placement and reveals its zone', () => {
    const group = { id: 'defender-pending', team: 'defender', placed: false };
    const runtime = {
      getPhase: jest.fn(() => 'deploy'),
      getCardRows: jest.fn(() => [{ id: 'defender-pending', team: 'defender', placed: false }]),
      getDeployGroupById: jest.fn(() => group),
      getDeployRange: jest.fn(() => ({ defenderMinX: 360, maxX: 600 })),
      setSelectedDeployGroup: jest.fn(),
      setFocusSquad: jest.fn(),
      setDeployGroupPlaced: jest.fn(),
      getMinimapSnapshot: jest.fn(() => ({ squads: [] }))
    };
    const camera = { centerX: -420, centerY: 75 };
    const setSelectedSquadId = jest.fn();
    const setDeployDraggingGroup = jest.fn();
    const setDeployActionAnchorMode = jest.fn();
    const setCards = jest.fn();
    const setMinimapSnapshot = jest.fn();

    expect(activateUnplacedTrainingGroup({
      runtime,
      squadId: 'defender-pending',
      camera,
      cameraViewRectRef: { current: { widthWorld: 180, heightWorld: 120 } },
      setSelectedSquadId,
      setDeployDraggingGroup,
      setDeployActionAnchorMode,
      setCards,
      setMinimapSnapshot
    })).toBe(true);

    expect(runtime.setSelectedDeployGroup).toHaveBeenCalledWith('defender-pending');
    expect(runtime.setFocusSquad).toHaveBeenCalledWith('defender-pending');
    expect(runtime.setDeployGroupPlaced).toHaveBeenCalledWith('defender', 'defender-pending', false);
    expect(setDeployDraggingGroup).toHaveBeenCalledWith({ groupId: 'defender-pending', team: 'defender' });
    expect(setDeployActionAnchorMode).toHaveBeenCalledWith('');
    expect(setCards).toHaveBeenCalledWith([{ id: 'defender-pending', team: 'defender', placed: false }]);
    expect(setMinimapSnapshot).toHaveBeenCalledWith({ squads: [] });
    expect(camera).toEqual({ centerX: 480, centerY: 0 });
  });
});
