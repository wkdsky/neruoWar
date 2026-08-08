import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SquadCards from './SquadCards';

const selectedSquad = {
  id: 'training_squad_1',
  name: '混编先锋队',
  team: 'attacker',
  classTag: 'infantry',
  controlMode: 'USER',
  selected: true,
  alive: true,
  placed: true,
  remain: 18,
  startCount: 20,
  stamina: 88,
  action: '部署中',
  unitCategories: ['melee', 'ranged', 'support'],
  skillSlots: [
    { slotIndex: 0, treeCategory: 'melee', skillId: 'melee_heavy_blow' },
    { slotIndex: 1, treeCategory: 'ranged', skillId: 'ranged_fixed_volley' },
    { slotIndex: 2, treeCategory: 'support', skillId: 'support_specialized_boost' }
  ],
  unitComposition: [
    { unitTypeId: 'infantry', unitName: '步兵', count: 12, startCount: 12 },
    { unitTypeId: 'archer', unitName: '弓兵', count: 6, startCount: 8 }
  ],
  formationName: '横向阵',
  formationRect: { width: 48, depth: 24 },
  unitMetrics: { cohesiveSpeed: 1.1, totalAtk: 42, totalDef: 24, range: 3 }
};

describe('SquadCards training controls', () => {
  test('renders compact troop status with per-slot skill trees', () => {
    const onOpenSkillTree = jest.fn();
    render(
      <SquadCards
        squads={[selectedSquad]}
        phase="deploy"
        isTrainingMode
        trainingState={{ points: 4 }}
        onOpenSkillTree={onOpenSkillTree}
      />
    );

    const commandPanel = screen.getByRole('region', { name: '当前选中部队信息与技能' });
    expect(commandPanel.textContent).toContain('混编先锋队');
    expect(commandPanel.textContent).toContain('18/20');
    expect(commandPanel.textContent).toContain('横向阵');
    expect(commandPanel.querySelectorAll('.pve2-training-skill-pair')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: '辅助技能树 · 槽位 3' }));
    expect(onOpenSkillTree).toHaveBeenCalledWith(
      'training_squad_1',
      2,
      'support',
      expect.anything()
    );
  });

  test('animates local gain and loss feedback when troop and skill-point values change', () => {
    const { container, rerender } = render(
      <SquadCards
        squads={[selectedSquad]}
        phase="battle"
        isTrainingMode
        trainingState={{ points: 0 }}
      />
    );

    rerender(
      <SquadCards
        squads={[selectedSquad]}
        phase="battle"
        isTrainingMode
        trainingState={{ points: 2 }}
      />
    );

    const pointMetric = container.querySelector('[data-training-metric="skill-points"]');
    expect(pointMetric.textContent).toContain('技能点');
    expect(pointMetric.querySelector('.pve2-training-metric-delta.is-gain').textContent).toBe('+2');

    rerender(
      <SquadCards
        squads={[{ ...selectedSquad, remain: 16 }]}
        phase="battle"
        isTrainingMode
        trainingState={{ points: 2 }}
      />
    );

    const troopMetric = container.querySelector('[data-training-metric="troops"]');
    expect(troopMetric.textContent).toContain('16/20');
    expect(troopMetric.querySelector('.pve2-training-metric-delta.is-loss').textContent).toBe('-2');

    rerender(
      <SquadCards
        squads={[{ ...selectedSquad, id: 'training_squad_2', remain: 12 }]}
        phase="battle"
        isTrainingMode
        trainingState={{ points: 9 }}
      />
    );
    expect(container.querySelector('[data-training-metric="skill-points"] .pve2-training-metric-delta')).toBeNull();
  });

  test('uses separate compact actions for templates and troop creation', () => {
    const onTemplateCreate = jest.fn();
    const onTemplateFill = jest.fn();
    const onTemplateEdit = jest.fn();
    const onTemplateDelete = jest.fn();
    const template = {
      templateId: 'template_1',
      name: '混合编制',
      units: [{ unitTypeId: 'infantry', unitName: '步兵', count: 100 }]
    };
    render(
      <SquadCards
        squads={[]}
        phase="deploy"
        isTrainingMode
        armyTemplates={[template]}
        onTemplateCreate={onTemplateCreate}
        onTemplateFill={onTemplateFill}
        onTemplateEdit={onTemplateEdit}
        onTemplateDelete={onTemplateDelete}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '创建部队模板' }));
    fireEvent.click(screen.getByRole('button', { name: '从模板创建部队' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑模板' }));
    fireEvent.click(screen.getByRole('button', { name: '删除模板' }));

    expect(onTemplateCreate).toHaveBeenCalledTimes(1);
    expect(onTemplateFill).toHaveBeenCalledWith(template, 'attacker');
    expect(onTemplateEdit).toHaveBeenCalledWith(template);
    expect(onTemplateDelete).toHaveBeenCalledWith(template);
  });
});
