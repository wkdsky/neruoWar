import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TrainingSkillSlots from './TrainingSkillSlots';
import { SKILL_TREE_CATALOG } from '../../../../components/game/skillTree/skillTreeData';

describe('TrainingSkillSlots', () => {
  test('keeps runtime skills in square command cells and exposes the tree toggle', () => {
    const onCastSlot = jest.fn();
    const onOpenTree = jest.fn();
    render(
      <TrainingSkillSlots
        unitCategories={['infantry']}
        skillSlots={[{ slotIndex: 0, treeCategory: 'melee', skillId: 'melee_heavy_blow' }]}
        skills={[{
          slotIndex: 0,
          skillId: 'melee_heavy_blow',
          name: '重击',
          icon: 'Swords',
          tier: 2,
          available: true,
          cooldownRemain: 0,
          cooldownTotal: 1
        }]}
        phase="battle"
        trainingState={{ points: 3 }}
        onCastSlot={onCastSlot}
        onOpenTree={onOpenTree}
      />
    );

    const skillButton = screen.getByRole('button', { name: '重击 · 点击施放' });
    expect(skillButton.className).toContain('pve2-training-skill-slot');
    expect(skillButton.style.getPropertyValue('--skill-slot-color')).toBeTruthy();
    expect(skillButton.querySelectorAll('.pve2-training-skill-level i.is-filled')).toHaveLength(3);
    expect(screen.getByTitle('未使用技能点 3').textContent).toBe('3');

    fireEvent.click(skillButton);
    expect(onCastSlot).toHaveBeenCalledWith(0, expect.anything());

    fireEvent.click(screen.getByRole('button', { name: '展开技能树' }));
    expect(onOpenTree).toHaveBeenCalledWith(0, 'melee', expect.anything());
  });

  test('gives every skill slot its own adjacent tree control', () => {
    const onOpenTree = jest.fn();
    const meleeTree = SKILL_TREE_CATALOG.find((tree) => tree.id === 'melee');
    const { container } = render(
      <TrainingSkillSlots
        unitCategories={['melee', 'ranged', 'support']}
        skillSlots={[
          { slotIndex: 0, treeCategory: 'melee' },
          { slotIndex: 1, treeCategory: 'ranged' },
          { slotIndex: 2, treeCategory: 'support' }
        ]}
        phase="deploy"
        trainingState={{ points: 5 }}
        skillTreeProgress={{
          melee: {
            unlocked: meleeTree.skills
              .filter((skill) => skill.id !== 'melee_wave_sweep')
              .map((skill) => skill.id)
          }
        }}
        onOpenTree={onOpenTree}
      />
    );

    expect(container.querySelectorAll('.pve2-training-skill-pair')).toHaveLength(3);
    expect(container.querySelectorAll('.pve2-training-skill-tree-toggle')).toHaveLength(3);
    expect(Array.from(container.querySelectorAll('.pve2-training-skill-point-badge')).map((badge) => badge.textContent))
      .toEqual(['3', '5', '5']);

    const supportTreeButton = screen.getByRole('button', { name: '辅助技能树 · 槽位 3' });
    fireEvent.click(supportTreeButton);
    expect(onOpenTree).toHaveBeenCalledWith(2, 'support', expect.anything());
    expect(supportTreeButton.querySelector('.pve2-training-skill-point-badge').textContent).toBe('5');
  });

  test('dims and disables a runtime skill that has not been learned', () => {
    const { container } = render(
      <TrainingSkillSlots
        unitCategories={['infantry']}
        skillSlots={[{ slotIndex: 0, treeCategory: 'melee', skillId: 'melee_rapid_slash' }]}
        skills={[{
          slotIndex: 0,
          skillId: 'melee_rapid_slash',
          name: '疾风连斩',
          icon: 'Zap',
          available: true,
          unlocked: false,
          cooldownRemain: 0,
          cooldownTotal: 1
        }]}
        phase="battle"
        onCastSlot={jest.fn()}
      />
    );

    const skillButton = container.querySelector('.pve2-training-skill-slot');
    expect(skillButton.className).toContain('is-locked');
    expect(skillButton.disabled).toBe(true);
  });
});
