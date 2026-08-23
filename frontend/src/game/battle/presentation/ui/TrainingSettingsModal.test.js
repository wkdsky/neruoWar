import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TrainingSettingsModal from './TrainingSettingsModal';

const trainingState = {
  points: 4,
  pointIntervals: [10, 30, 60, 120, 300],
  pointIntervalSec: 60,
  respawnDelayOptions: [10, 20, 30, 45, 60],
  respawnDelaySec: 20,
  nextPointInSec: 42
};

describe('TrainingSettingsModal', () => {
  test('keeps automatic skill-point settings as a draft until apply', () => {
    const onChangeAutoSkillPointGain = jest.fn();
    const onChangeInterval = jest.fn();
    const onChangeRespawnDelay = jest.fn();
    const onApply = jest.fn();
    const onClose = jest.fn();
    render(
      <TrainingSettingsModal
        open
        state={trainingState}
        settings={{ fontSize: 'medium', showGrid: true }}
        onChangeAutoSkillPointGain={onChangeAutoSkillPointGain}
        onChangeInterval={onChangeInterval}
        onChangeRespawnDelay={onChangeRespawnDelay}
        onApply={onApply}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('switch', { name: '自动获得技能点' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('radio', { name: '10 秒 / 点' })).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: '自动获得技能点' }));
    fireEvent.click(screen.getByRole('radio', { name: '10 秒 / 点' }));
    fireEvent.click(screen.getByRole('radio', { name: '30 秒' }));
    fireEvent.click(screen.getByRole('tab', { name: 'UI 设置' }));
    fireEvent.click(screen.getByRole('radio', { name: '大' }));
    fireEvent.click(screen.getByRole('tab', { name: '战场设置' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '显示网格线' }));

    expect(onChangeAutoSkillPointGain).not.toHaveBeenCalled();
    expect(onChangeInterval).not.toHaveBeenCalled();
    expect(onChangeRespawnDelay).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '应用' }));

    expect(onChangeAutoSkillPointGain).toHaveBeenCalledWith(true);
    expect(onChangeInterval).toHaveBeenCalledWith(10);
    expect(onChangeRespawnDelay).toHaveBeenCalledWith(30);
    expect(onApply).toHaveBeenCalledWith({ fontSize: 'large', showGrid: false });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('discards unapplied UI changes when closed', () => {
    const onChangeAutoSkillPointGain = jest.fn();
    const onApply = jest.fn();
    const onClose = jest.fn();
    render(
      <TrainingSettingsModal
        open
        state={trainingState}
        settings={{ fontSize: 'medium', showGrid: true }}
        onChangeAutoSkillPointGain={onChangeAutoSkillPointGain}
        onApply={onApply}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'UI 设置' }));
    fireEvent.click(screen.getByRole('radio', { name: '小' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onChangeAutoSkillPointGain).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
