export const SKILL_TARGET_MODE = Object.freeze({
  SELF: 'self',
  DIRECTION: 'direction',
  GROUND: 'ground',
  ENEMY: 'enemy'
});

const cloneProfile = (profile = {}) => ({
  ...profile,
  statusEffect: profile?.statusEffect && typeof profile.statusEffect === 'object'
    ? { ...profile.statusEffect }
    : null
});

const meleeProfile = (profile = {}) => ({
  sourceCategory: 'melee',
  targetMode: SKILL_TARGET_MODE.GROUND,
  castStyle: 'melee',
  minRange: 12,
  maxRange: 58,
  aoeRadius: 24,
  coneAngleDeg: 92,
  shape: 'cone',
  durationSec: 0.86,
  waves: 1,
  intervalSec: 0.18,
  damageMul: 1,
  dashDistance: 8,
  dashSpeedMul: 1.45,
  ...profile
});

const rangedProfile = (profile = {}) => ({
  sourceCategory: 'ranged',
  targetMode: SKILL_TARGET_MODE.GROUND,
  castStyle: 'ranged',
  minRange: 0,
  maxRange: 260,
  aoeRadius: 54,
  durationSec: 1.2,
  waves: 3,
  intervalSec: 0.3,
  shotsPerWave: 10,
  impactRadius: 2.8,
  blastRadius: 0,
  blastFalloff: 0,
  damageMul: 1,
  projectileClass: 'archer',
  requiresSetup: false,
  ...profile
});

const supportProfile = (profile = {}) => ({
  sourceCategory: 'support',
  targetMode: SKILL_TARGET_MODE.SELF,
  castStyle: 'support',
  minRange: 0,
  maxRange: 180,
  aoeRadius: 0,
  durationSec: 0.9,
  waves: 1,
  intervalSec: 0,
  damageMul: 0,
  statusEffect: null,
  ...profile
});

const SKILL_CAST_PROFILE_BY_ID = Object.freeze({
  melee_heavy_blow: meleeProfile({ damageMul: 1.8, dashDistance: 6, coneAngleDeg: 90 }),
  melee_rapid_slash: meleeProfile({
    targetMode: SKILL_TARGET_MODE.SELF,
    shape: 'circle',
    aoeRadius: 29,
    durationSec: 2.4,
    waves: 6,
    intervalSec: 0.36,
    damageMul: 0.38,
    dashDistance: 0
  }),
  melee_weapon_aura: meleeProfile({
    shape: 'cone',
    maxRange: 76,
    aoeRadius: 42,
    coneAngleDeg: 75,
    durationSec: 0.9,
    waves: 1,
    damageMul: 1.45,
    dashDistance: 4
  }),
  melee_circular_step: meleeProfile({
    targetMode: SKILL_TARGET_MODE.SELF,
    shape: 'circle',
    aoeRadius: 34,
    durationSec: 3.6,
    waves: 8,
    intervalSec: 0.42,
    damageMul: 0.26,
    motion: 'orbit',
    dashDistance: 10,
    dashSpeedMul: 1.12
  }),
  melee_breach_charge: meleeProfile({
    maxRange: 92,
    aoeRadius: 22,
    coneAngleDeg: 52,
    durationSec: 1.2,
    waves: 1,
    damageMul: 2.4,
    dashDistance: 32,
    dashSpeedMul: 1.72,
    knockback: 3.4
  }),
  melee_wave_sweep: meleeProfile({
    maxRange: 112,
    aoeRadius: 58,
    coneAngleDeg: 112,
    durationSec: 0.94,
    waves: 2,
    intervalSec: 0.22,
    damageMul: 1.1,
    dashDistance: 4,
    statusEffect: { type: 'debuff', speedMul: 0.65, durationSec: 2 }
  }),
  melee_blade_persistence: meleeProfile({
    maxRange: 142,
    aoeRadius: 42,
    coneAngleDeg: 36,
    durationSec: 5,
    waves: 4,
    intervalSec: 1.1,
    damageMul: 0.75,
    dashDistance: 3
  }),
  melee_circumference: meleeProfile({
    targetMode: SKILL_TARGET_MODE.SELF,
    shape: 'circle',
    aoeRadius: 46,
    durationSec: 5,
    waves: 10,
    intervalSec: 0.48,
    damageMul: 0.45,
    motion: 'orbit',
    dashDistance: 18,
    dashSpeedMul: 1.46,
    statusEffect: { type: 'buff', defMul: 1.3, speedMul: 1.45, durationSec: 5 }
  }),

  ranged_fixed_volley: rangedProfile({
    maxRange: 180,
    aoeRadius: 58,
    durationSec: 1.6,
    waves: 4,
    intervalSec: 0.32,
    shotsPerWave: 12,
    damageMul: 0.65,
    requiresSetup: true
  }),
  ranged_run_fire: rangedProfile({
    maxRange: 138,
    aoeRadius: 28,
    durationSec: 3,
    waves: 6,
    intervalSec: 0.45,
    shotsPerWave: 7,
    damageMul: 0.42,
    statusEffect: { type: 'buff', speedMul: 1.35, durationSec: 3 }
  }),
  ranged_piercing_barrage: rangedProfile({
    maxRange: 208,
    aoeRadius: 34,
    durationSec: 0.95,
    waves: 3,
    intervalSec: 0.18,
    shotsPerWave: 7,
    impactRadius: 3.6,
    damageMul: 1.85,
    projectileClass: 'artillery',
    requiresSetup: true
  }),
  ranged_suppression_fan: rangedProfile({
    maxRange: 154,
    aoeRadius: 52,
    durationSec: 4,
    waves: 10,
    intervalSec: 0.36,
    shotsPerWave: 6,
    damageMul: 0.32,
    statusEffect: { type: 'debuff', speedMul: 0.72, durationSec: 2 }
  }),
  ranged_hunter_lock: rangedProfile({
    targetMode: SKILL_TARGET_MODE.ENEMY,
    maxRange: 240,
    aoeRadius: 20,
    durationSec: 1.35,
    waves: 1,
    shotsPerWave: 8,
    impactRadius: 4.2,
    damageMul: 2.6
  }),
  ranged_deep_pierce: rangedProfile({
    maxRange: 280,
    aoeRadius: 28,
    durationSec: 1.02,
    waves: 1,
    shotsPerWave: 11,
    impactRadius: 4.1,
    damageMul: 3.2,
    projectileClass: 'artillery',
    requiresSetup: true
  }),
  ranged_fire_net: rangedProfile({
    maxRange: 190,
    aoeRadius: 66,
    durationSec: 6,
    waves: 6,
    intervalSec: 0.9,
    shotsPerWave: 8,
    impactRadius: 3.4,
    damageMul: 0.8,
    statusEffect: { type: 'debuff', speedMul: 0.72, durationSec: 1.5 }
  }),
  ranged_longshot: rangedProfile({
    targetMode: SKILL_TARGET_MODE.ENEMY,
    maxRange: 320,
    aoeRadius: 16,
    durationSec: 1.5,
    waves: 1,
    shotsPerWave: 10,
    impactRadius: 5.2,
    damageMul: 5.2,
    projectileClass: 'artillery',
    requiresSetup: true
  }),

  support_specialized_boost: supportProfile({
    durationSec: 0.8,
    statusEffect: { type: 'buff', atkMul: 1.28, speedMul: 1.12, durationSec: 8 }
  }),
  support_comprehensive_tuning: supportProfile({
    statusEffect: { type: 'buff', atkMul: 1.1, defMul: 1.1, speedMul: 1.1, durationSec: 10 }
  }),
  support_chain_amplifier: supportProfile({
    statusEffect: { type: 'buff', atkMul: 1.42, speedMul: 1.08, durationSec: 9 }
  }),
  support_battlefield_resonance: supportProfile({
    statusEffect: { type: 'buff', atkMul: 1.16, defMul: 1.16, speedMul: 1.16, durationSec: 12 }
  }),
  support_purification_pulse: supportProfile({
    statusEffect: { type: 'purify', defMul: 1.08, durationSec: 6 }
  }),
  support_precision_overload: supportProfile({
    statusEffect: { type: 'buff', atkMul: 1.65, skillMul: 1.25, durationSec: 10 }
  }),
  support_total_command: supportProfile({
    statusEffect: { type: 'buff', atkMul: 1.26, defMul: 1.26, speedMul: 1.26, rangeMul: 1.26, durationSec: 14 }
  }),
  support_intervention_domain: supportProfile({
    targetMode: SKILL_TARGET_MODE.ENEMY,
    globalTarget: true,
    maxRange: 180,
    aoeRadius: 0,
    durationSec: 1.1,
    statusEffect: { type: 'debuff', atkMul: 0.78, defMul: 0.78, speedMul: 0.78, durationSec: 8 }
  })
});

const fallbackProfileByCategory = (treeCategory = '') => {
  if (treeCategory === 'ranged') return rangedProfile();
  if (treeCategory === 'support') return supportProfile();
  return meleeProfile();
};

export const getSkillCastProfile = (skill = null, treeCategory = '') => {
  const skillId = typeof skill === 'string' ? skill : skill?.id;
  const profile = SKILL_CAST_PROFILE_BY_ID[skillId];
  return cloneProfile(profile || fallbackProfileByCategory(treeCategory));
};

export const skillNeedsTargetSelection = (profile = null) => {
  const mode = profile?.targetMode;
  return mode === SKILL_TARGET_MODE.DIRECTION
    || mode === SKILL_TARGET_MODE.GROUND
    || mode === SKILL_TARGET_MODE.ENEMY;
};

export const getSkillTargetingHint = (profile = null) => {
  if (profile?.targetMode === SKILL_TARGET_MODE.DIRECTION) return '暂停后选择出击方向';
  if (profile?.targetMode === SKILL_TARGET_MODE.GROUND && profile?.castStyle === 'melee') return '暂停后选择突击地点';
  if (profile?.targetMode === SKILL_TARGET_MODE.GROUND) return '暂停后选择打击区域';
  if (profile?.targetMode === SKILL_TARGET_MODE.ENEMY) return '暂停后选择敌方部队';
  if (profile?.sourceCategory === 'melee') return '近战兵立即施展';
  if (profile?.sourceCategory === 'ranged') return '远程兵立即齐射';
  return '辅助兵将直接施放';
};

export const getSkillProfileById = (skillId = '') => (
  getSkillCastProfile(String(skillId || ''), '')
);
