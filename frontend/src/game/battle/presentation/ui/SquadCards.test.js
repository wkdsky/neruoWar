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
  templateFormations: [{
    formationId: 'line',
    name: '横向阵',
    placements: [{ unitTypeId: 'infantry', x: 0, y: 0 }]
  }],
  activeFormationId: 'line',
  formationRect: { width: 48, depth: 24 },
  unitMetrics: { cohesiveSpeed: 1.1, totalAtk: 42, totalDef: 24, range: 3 },
  trainingSkillPoints: 4
};

describe('SquadCards training controls', () => {
  test('renders the skill row without the removed unit information strip', () => {
    const onOpenSkillTree = jest.fn();
    render(
      <SquadCards
        squads={[selectedSquad]}
        phase="deploy"
        isTrainingMode
        onOpenSkillTree={onOpenSkillTree}
      />
    );

    const commandPanel = screen.getByRole('region', { name: '当前选中部队信息与技能' });
    expect(commandPanel.querySelector('.pve2-training-squad-meta-row')).toBeNull();
    expect(commandPanel.querySelectorAll('.pve2-training-skill-pair')).toHaveLength(3);
    expect(commandPanel.querySelectorAll('.pve2-training-skill-tree-toggle')).toHaveLength(3);
    expect(commandPanel.querySelector('.pve2-formation-popover-trigger')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '辅助技能树 · 槽位 3' }));
    expect(onOpenSkillTree).toHaveBeenCalledWith(
      'training_squad_1',
      2,
      'support',
      expect.anything()
    );
  });

  test('keeps the skill row above the command row', () => {
    const { container } = render(
      <SquadCards
        squads={[{ ...selectedSquad, trainingSkillPoints: 2 }]}
        phase="deploy"
        isTrainingMode
      />
    );

    const skillRow = container.querySelector('.pve2-training-squad-skill-row');
    const commandRow = container.querySelector('.pve2-training-squad-command-row');
    const pointBadge = container.querySelector('.pve2-training-skill-point-badge');
    expect(skillRow.compareDocumentPosition(commandRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pointBadge.textContent).toBe('2');
  });

  test('selects and follows a battle troop when its card is double clicked', () => {
    const onFollow = jest.fn();
    render(
      <SquadCards
        squads={[{ ...selectedSquad, action: '待命' }]}
        phase="battle"
        isTrainingMode
        onFollow={onFollow}
      />
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: /混编先锋队/ }));
    expect(onFollow).toHaveBeenCalledWith('training_squad_1', expect.anything());
  });

  test('covers a defeated training card with its highland respawn countdown', () => {
    render(
      <SquadCards
        squads={[{
          ...selectedSquad,
          remain: 0,
          alive: false,
          respawning: true,
          respawnRemainingSec: 18.2,
          respawnState: { delaySec: 20 }
        }]}
        phase="battle"
        isTrainingMode
      />
    );

    const overlay = screen.getByRole('progressbar', { name: '混编先锋队重生倒计时' });
    expect(overlay.textContent).toContain('重生中');
    expect(overlay.textContent).toContain('19s');
    expect(screen.getByText('返回高地重生点')).not.toBeNull();
  });

  test('keeps training battle commands and spacing choices together in the selected command strip', () => {
    const onBattleAction = jest.fn();
    const onFormationSpacingPick = jest.fn();
    const onFormationPick = jest.fn();
    const formations = [
      ...selectedSquad.templateFormations,
      {
        formationId: 'column',
        name: '纵深阵',
        placements: [{ unitTypeId: 'infantry', x: 0, y: 0 }]
      }
    ];
    render(
      <SquadCards
        squads={[{
          ...selectedSquad,
          action: '待命',
          formationSpacing: 'standard',
          templateFormations: formations
        }]}
        phase="battle"
        isTrainingMode
        onBattleAction={onBattleAction}
        onFormationSpacingPick={onFormationSpacingPick}
        onFormationPick={onFormationPick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '规划路径' }));
    expect(onBattleAction).toHaveBeenCalledWith('training_squad_1', 'planPath', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: '自由攻击' }));
    expect(onBattleAction).toHaveBeenCalledWith('training_squad_1', 'freeAttack', expect.anything());

    expect(screen.queryByRole('button', { name: '跟随部队' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '紧凑' }));
    expect(onFormationSpacingPick).toHaveBeenCalledWith('training_squad_1', 'compact');

    fireEvent.click(screen.getByRole('button', { name: '阵型选择' }));
    fireEvent.click(screen.getByRole('button', { name: '2 · 纵深阵' }));
    expect(onFormationPick).toHaveBeenCalledWith(
      'training_squad_1',
      expect.objectContaining({ formationId: 'column' })
    );
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

  test('switches each side to two columns after the single-column capacity', () => {
    const squads = Array.from({ length: 9 }, (_, index) => ({
      ...selectedSquad,
      id: `training_squad_${index + 1}`,
      name: `部队 ${index + 1}`,
      selected: false
    }));

    const { container } = render(
      <SquadCards
        squads={[
          ...squads,
          ...squads.map((squad) => ({ ...squad, id: `defender_${squad.id}`, team: 'defender' }))
        ]}
        phase="deploy"
        isTrainingMode
      />
    );

    expect(container.querySelector('.pve2-card-strip.left').className).toContain('is-two-column');
    expect(container.querySelector('.pve2-card-strip.right').className).toContain('is-two-column');
  });

  test('renders delete confirmation on the selected card', () => {
    const onConfirmDelete = jest.fn();
    const onCancelDelete = jest.fn();
    const { container } = render(
      <SquadCards
        squads={[selectedSquad]}
        phase="deploy"
        confirmDeleteGroupId={selectedSquad.id}
        onConfirmDelete={onConfirmDelete}
        onCancelDelete={onCancelDelete}
      />
    );

    const overlay = container.querySelector('.pve2-card-confirm-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelectorAll('.pve2-card-confirm-button')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '确认删除部队' }));
    expect(onConfirmDelete).toHaveBeenCalledWith(selectedSquad.id);

    fireEvent.click(screen.getByRole('button', { name: '取消删除部队' }));
    expect(onCancelDelete).toHaveBeenCalledWith(selectedSquad.id);
  });
});
