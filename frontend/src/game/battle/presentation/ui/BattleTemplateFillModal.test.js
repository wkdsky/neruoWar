import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import BattleTemplateFillModal from './BattleTemplateFillModal';

const preview = {
  template: { name: '先锋模板' },
  totalRequested: 100,
  totalFilled: 100,
  maxTotal: 100,
  rows: [],
  stats: {}
};

describe('BattleTemplateFillModal', () => {
  test('keeps the create-army panel open when its backdrop is clicked', () => {
    const onClose = jest.fn();
    render(
      <BattleTemplateFillModal
        open
        preview={preview}
        onClose={onClose}
      />
    );

    const backdrop = document.querySelector('.pve2-template-fill-backdrop');
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('部队基础参数一览')).toBeTruthy();

    fireEvent.click(screen.getByText('关闭'));
    fireEvent.click(screen.getByText('取消'));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
