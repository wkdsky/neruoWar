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
    expect(locked.disabled).toBe(true);
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
});
