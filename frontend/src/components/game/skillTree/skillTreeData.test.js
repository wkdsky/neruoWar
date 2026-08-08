import {
  getSkillById,
  getSkillTreeRemainingUnlockCost,
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
