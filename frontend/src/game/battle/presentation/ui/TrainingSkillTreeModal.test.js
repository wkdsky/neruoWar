import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SKILL_TREE_CATALOG } from '../../../../components/game/skillTree/skillTreeData';
import TrainingSkillIcon, { resolveTrainingSkillIcon } from './TrainingSkillIcon';
import TrainingSkillTreeModal from './TrainingSkillTreeModal';

describe('TrainingSkillTreeModal', () => {
  test('keeps preparation at the root and first active skill, while locking the rest', () => {
    const onSkillClick = jest.fn();
    const { container } = render(
      <TrainingSkillTreeModal
        open
        group={{ id: 'training_group_1', name: '先锋队', unitCategories: ['melee'] }}
        treeCategory="melee"
        phase="deploy"
        progress={{ unlocked: ['melee_war_form'] }}
        onSkillClick={onSkillClick}
      />
    );

    expect(container.querySelectorAll('.pve2-training-tree-node.is-lit')).toHaveLength(2);

    const root = screen.getByRole('button', { name: /战意起式/ });
    const firstActive = screen.getByRole('button', { name: /集体重击/ });
    const locked = screen.getByRole('button', { name: /疾风连斩/ });

    expect(root.className).toContain('is-lit');
    expect(firstActive.className).toContain('is-lit');
    expect(locked.className).toContain('is-locked');
    expect(locked.disabled).toBe(false);
    expect(locked.querySelector('[data-skill-icon="melee_rapid_slash"]')).not.toBeNull();

    fireEvent.click(locked);
    expect(onSkillClick).not.toHaveBeenCalled();
  });

  test('assigns a distinct icon component to every skill node', () => {
    const skills = SKILL_TREE_CATALOG.flatMap((tree) => tree.skills);
    const icons = skills.map((skill) => resolveTrainingSkillIcon(skill));
    expect(new Set(icons).size).toBe(skills.length);

    const { container } = render(<TrainingSkillIcon skill={{ id: 'ranged_hunter_lock' }} />);
    expect(container.querySelector('[data-skill-icon="ranged_hunter_lock"]')).not.toBeNull();
  });

  test('shows per-troop points and every activation or upgrade cost', () => {
    const onAdjustPoints = jest.fn();
    const onSkillUpgrade = jest.fn();
    render(
      <TrainingSkillTreeModal
        open
        group={{ id: 'training_group_1', name: '先锋队', unitCategories: ['melee'] }}
        treeCategory="melee"
        phase="battle"
        skillPoints={3}
        progress={{
          unlocked: ['melee_war_form', 'melee_heavy_blow'],
          levels: { melee_war_form: 1, melee_heavy_blow: 1 }
        }}
        onAdjustPoints={onAdjustPoints}
        onSkillUpgrade={onSkillUpgrade}
      />
    );

    expect(screen.getByText('当前部队可用技能点')).toBeTruthy();
    expect(screen.getByText('Lv1 · 升级 2 点')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /集体重击/ }));
    expect(screen.getByText('点亮与升级消耗')).toBeTruthy();
    expect(screen.getByText('升级至 Lv2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '升级 2 点' }));
    expect(onSkillUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'melee_heavy_blow' }),
      expect.objectContaining({ level: 1, treeCategory: 'melee' })
    );

    fireEvent.click(screen.getByRole('button', { name: '增加当前部队技能点' }));
    expect(onAdjustPoints).toHaveBeenCalledWith(1);
  });
});
