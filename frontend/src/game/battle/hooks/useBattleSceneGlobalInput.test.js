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

  test('does not route deployment number keys to removed formation shortcuts', () => {
    const onMapKeyCommand = jest.fn();
    const onSkillHotkey = jest.fn();
    const runtimeRef = { current: { getPhase: () => 'deploy' } };
    const spacePressedRef = { current: false };

    render(
      <InputFixture
        open
        runtimeRef={runtimeRef}
        spacePressedRef={spacePressedRef}
        onMapKeyCommand={onMapKeyCommand}
        onSkillHotkey={onSkillHotkey}
      />
    );

    fireEvent.keyDown(window, { key: '7' });
    expect(onMapKeyCommand).not.toHaveBeenCalled();
    expect(onSkillHotkey).not.toHaveBeenCalled();
  });
});
