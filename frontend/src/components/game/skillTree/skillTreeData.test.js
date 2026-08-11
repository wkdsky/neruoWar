import {
  getSkillById,
  getSkillLevel,
  getSkillPointCostSchedule,
  getSkillTreeRemainingUnlockCost,
  getSkillUpgradeCost,
  getSkillUnlockCost,
  SKILL_TREE_CATALOG
} from './skillTreeData';

describe('training skill unlock costs', () => {
  test('scales point costs with the skill-tree tier', () => {
    expect(getSkillUnlockCost(getSkillById('melee', 'melee_war_form'))).toBe(0);
    expect(getSkillUnlockCost(getSkillById('melee', 'melee_heavy_blow'))).toBe(1);
    expect(getSkillUnlockCost(getSkillById('melee', 'melee_weapon_aura'))).toBe(2);
    expect(getSkillUnlockCost(getSkillById('melee', 'melee_wave_sweep'))).toBe(3);
  });

  test('exposes a point cost for activation and every upgrade level', () => {
    const skill = getSkillById('melee', 'melee_heavy_blow');

    expect(getSkillPointCostSchedule(skill)).toEqual([
      { level: 1, cost: 1 },
      { level: 2, cost: 2 },
      { level: 3, cost: 3 }
    ]);
    expect(getSkillUpgradeCost(skill, 3)).toBe(0);
    expect(getSkillLevel({ unlocked: [skill.id] }, skill)).toBe(1);
    expect(getSkillLevel({ unlocked: [skill.id], levels: { [skill.id]: 2 } }, skill)).toBe(2);
  });

  test('reports only the remaining point cost for a partially learned tree', () => {
    const meleeTree = SKILL_TREE_CATALOG.find((tree) => tree.id === 'melee');
    const remainingSkill = getSkillById('melee', 'melee_wave_sweep');
    const unlocked = meleeTree.skills
      .filter((skill) => skill.id !== remainingSkill.id)
      .map((skill) => skill.id);

    expect(getSkillTreeRemainingUnlockCost('melee', { unlocked })).toBe(getSkillUnlockCost(remainingSkill));
    expect(getSkillTreeRemainingUnlockCost('melee', { unlocked: meleeTree.skills.map((skill) => skill.id) })).toBe(0);
  });
});
