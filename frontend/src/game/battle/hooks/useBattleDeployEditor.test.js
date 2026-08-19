import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import useBattleDeployEditor from './useBattleDeployEditor';

const DeployEditorFixture = ({ onReady, ...props }) => {
  onReady(useBattleDeployEditor(props));
  return null;
};

describe('useBattleDeployEditor', () => {
  const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  });

  test('clears troop selection when a pending placement is cancelled', () => {
    const group = { id: 'attacker-pending', team: 'attacker', placed: false };
    const runtime = {
      getPhase: jest.fn(() => 'deploy'),
      getDeployGroupById: jest.fn(() => group),
      cancelDeployGroupPlacement: jest.fn(() => ({ ok: true })),
      clearSelection: jest.fn(),
      getCardRows: jest.fn(() => []),
      getMinimapSnapshot: jest.fn(() => null)
    };
    const setSelectedSquadId = jest.fn();
    const setDeployDraggingGroup = jest.fn();
    const setDeployActionAnchorMode = jest.fn();
    const setCards = jest.fn();
    const setMinimapSnapshot = jest.fn();
    const setDeployNotice = jest.fn();
    let deployEditor = null;

    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
      root.render(
        <DeployEditorFixture
          onReady={(value) => { deployEditor = value; }}
          runtimeRef={{ current: runtime }}
          pointerWorldRef={{ current: { x: 0, y: 0 } }}
          setSelectedSquadId={setSelectedSquadId}
          setDeployDraggingGroup={setDeployDraggingGroup}
          setDeployActionAnchorMode={setDeployActionAnchorMode}
          setCards={setCards}
          setMinimapSnapshot={setMinimapSnapshot}
          setDeployNotice={setDeployNotice}
        />
      );
    });

    let result = null;
    act(() => {
      result = deployEditor.handleRecallDeployDraggingGroup('attacker-pending', 'attacker');
    });

    expect(result).toMatchObject({ ok: true, groupId: 'attacker-pending', team: 'attacker' });
    expect(runtime.cancelDeployGroupPlacement).toHaveBeenCalledWith('attacker', 'attacker-pending');
    expect(runtime.clearSelection).toHaveBeenCalledTimes(1);
    expect(setSelectedSquadId).toHaveBeenCalledWith('');
    expect(setDeployDraggingGroup).toHaveBeenCalledWith({ groupId: '', team: 'attacker' });
    expect(setDeployActionAnchorMode).toHaveBeenCalledWith('');
    act(() => {
      root.unmount();
    });
  });
});
