import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TrainingSettingsModal from './TrainingSettingsModal';

const trainingState = {
  points: 4,
  pointIntervals: [10, 30, 60, 120, 300],
  pointIntervalSec: 60,
  nextPointInSec: 42
};

describe('TrainingSettingsModal', () => {
  test('keeps training settings as a draft until apply', () => {
    const onAdjustPoints = jest.fn();
    const onChangeInterval = jest.fn();
    const onApply = jest.fn();
    const onClose = jest.fn();
    render(
      <TrainingSettingsModal
        open
        state={trainingState}
        settings={{ fontSize: 'medium', showGrid: true }}
        onAdjustPoints={onAdjustPoints}
        onChangeInterval={onChangeInterval}
        onApply={onApply}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '增加技能点' }));
    fireEvent.click(screen.getByRole('radio', { name: '10 秒 / 点' }));
    fireEvent.click(screen.getByRole('tab', { name: 'UI 设置' }));
    fireEvent.click(screen.getByRole('radio', { name: '大' }));
    fireEvent.click(screen.getByRole('tab', { name: '战场设置' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '显示网格线' }));

    expect(onAdjustPoints).not.toHaveBeenCalled();
    expect(onChangeInterval).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '应用' }));

    expect(onAdjustPoints).toHaveBeenCalledWith(1);
    expect(onChangeInterval).toHaveBeenCalledWith(10);
    expect(onApply).toHaveBeenCalledWith({ fontSize: 'large', showGrid: false });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('discards unapplied UI changes when closed', () => {
    const onApply = jest.fn();
    const onClose = jest.fn();
    render(
      <TrainingSettingsModal
        open
        state={trainingState}
        settings={{ fontSize: 'medium', showGrid: true }}
        onApply={onApply}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'UI 设置' }));
    fireEvent.click(screen.getByRole('radio', { name: '小' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
