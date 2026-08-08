import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import useBattleSceneGlobalInput from './useBattleSceneGlobalInput';

const InputFixture = (props) => {
  useBattleSceneGlobalInput(props);
  return <input aria-label="template name" />;
};

describe('useBattleSceneGlobalInput', () => {
  test('locks map hotkeys and does not close a locked modal with Escape', () => {
    const onEscape = jest.fn();
    const onMapKeyCommand = jest.fn();
    const runtimeRef = { current: { getPhase: () => 'deploy' } };
    const spacePressedRef = { current: false };

    render(
      <InputFixture
        open
        interactionLocked
        runtimeRef={runtimeRef}
        spacePressedRef={spacePressedRef}
        onEscape={onEscape}
        onMapKeyCommand={onMapKeyCommand}
      />
    );

    expect(onMapKeyCommand).toHaveBeenCalledWith('', false, { clearAll: true });
    onMapKeyCommand.mockClear();

    fireEvent.keyDown(window, { key: 'w' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onMapKeyCommand).not.toHaveBeenCalled();
    expect(onEscape).not.toHaveBeenCalled();
  });

  test('routes deployment number keys to formation shortcuts', () => {
    const onFormationHotkey = jest.fn();
    const runtimeRef = { current: { getPhase: () => 'deploy' } };
    const spacePressedRef = { current: false };

    render(
      <InputFixture
        open
        runtimeRef={runtimeRef}
        spacePressedRef={spacePressedRef}
        onFormationHotkey={onFormationHotkey}
      />
    );

    fireEvent.keyDown(window, { key: '7' });
    expect(onFormationHotkey).toHaveBeenCalledWith(6);
  });
});
