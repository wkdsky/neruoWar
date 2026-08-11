import { SKILL_TREE_CATALOG } from './skillTreeData';
import {
  getSkillCastProfile,
  getSkillTargetingHint,
  SKILL_TARGET_MODE
} from './skillCastProfiles';

describe('skill cast profiles', () => {
  test('declares an execution profile for every active skill', () => {
    const activeSkills = SKILL_TREE_CATALOG
      .flatMap((tree) => tree.skills.filter((skill) => skill.kind !== 'passive'));
    expect(activeSkills.length).toBeGreaterThan(20);
    activeSkills.forEach((skill) => {
      const treeCategory = skill.id.startsWith('ranged_')
        ? 'ranged'
        : (skill.id.startsWith('support_') ? 'support' : 'melee');
      const profile = getSkillCastProfile(skill, treeCategory);
      expect(profile.sourceCategory).toBe(treeCategory);
      expect(profile.durationSec).toBeGreaterThan(0);
      expect(getSkillTargetingHint(profile)).toEqual(expect.any(String));
    });
  });

  test('uses explicit pause target modes for ground, enemy and self skills', () => {
    expect(getSkillCastProfile('melee_breach_charge', 'melee').targetMode).toBe(SKILL_TARGET_MODE.GROUND);
    expect(getSkillCastProfile('ranged_fixed_volley', 'ranged').targetMode).toBe(SKILL_TARGET_MODE.GROUND);
    expect(getSkillCastProfile('support_intervention_domain', 'support').targetMode).toBe(SKILL_TARGET_MODE.ENEMY);
    expect(getSkillCastProfile('support_total_command', 'support').targetMode).toBe(SKILL_TARGET_MODE.SELF);
  });
});
