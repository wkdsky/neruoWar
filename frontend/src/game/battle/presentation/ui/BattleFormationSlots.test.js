import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import BattleFormationSlots from './BattleFormationSlots';

const formations = Array.from({ length: 4 }, (_, index) => ({
  formationId: `formation-${index + 1}`,
  name: `阵型${index + 1}`,
  placements: [{ unitTypeId: 'unit', x: index, y: 0 }]
}));

describe('BattleFormationSlots', () => {
  test('expands the centered formation grid on hover when requested', () => {
    jest.useFakeTimers();
    const { container } = render(
      <BattleFormationSlots formations={formations} activeFormationId="formation-2" showHoverGrid />
    );
    const panel = container.querySelector('.pve2-formation-slots');
    const trigger = screen.getByRole('button', { name: '阵型选择' });

    fireEvent.mouseEnter(panel);
    expect(panel.className).toContain('is-popover-open');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.mouseLeave(panel);
    expect(panel.className).toContain('is-popover-open');
    jest.useRealTimers();
  });

  test('renders formation shortcuts as a compact horizontal strip', () => {
    const { container } = render(
      <BattleFormationSlots formations={formations} activeFormationId="formation-2" editable />
    );

    expect(container.querySelectorAll('.pve2-formation-slot')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '2 · 阵型2' }).className).toContain('is-active');
    expect(container.querySelector('.pve2-formation-slot-grid').style.cssText).toBe('');
  });

  test('reports a dragged shortcut reorder', () => {
    const onReorder = jest.fn();
    render(<BattleFormationSlots formations={formations} editable onReorder={onReorder} />);
    const first = screen.getByRole('button', { name: '1 · 阵型1' });
    const third = screen.getByRole('button', { name: '3 · 阵型3' });
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: jest.fn(),
      getData: jest.fn(() => '0')
    };

    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.drop(third, { dataTransfer });
    expect(onReorder).toHaveBeenCalledWith([
      formations[1], formations[2], formations[0], formations[3]
    ]);
  });
});
