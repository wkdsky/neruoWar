import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CityChannelMechanismMotionControls } from './CityChannelEditorChrome';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('CityChannelMechanismMotionControls', () => {
  let container = null;
  let root = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    container = null;
    root = null;
  });

  it('shows a cancel motion button only while mechanism motion is active', () => {
    const onCancel = jest.fn();
    act(() => {
      root.render(<CityChannelMechanismMotionControls active={false} onCancel={onCancel} />);
    });

    expect(container.querySelector('button')).toBeNull();

    act(() => {
      root.render(<CityChannelMechanismMotionControls active onCancel={onCancel} />);
    });
    const button = container.querySelector('button');
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
