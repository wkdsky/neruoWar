const createSkill = (config) => Object.freeze({
  id: config.id,
  name: config.name,
  subtitle: config.subtitle,
  icon: config.icon,
  tier: config.tier,
  column: config.column,
  kind: config.kind || 'active',
  branch: config.branch || '',
  power: config.power || '—',
  powerLabel: config.powerLabel || '威力',
  cooldown: config.cooldown || '—',
  cooldownSeconds: Math.max(0, Number(config.cooldownSeconds) || 0),
  unlockCost: Number.isFinite(Number(config.unlockCost))
    ? Math.max(0, Math.floor(Number(config.unlockCost)))
    : Math.max(0, Math.floor(Number(config.tier) || 0)),
  maxLevel: Number.isFinite(Number(config.maxLevel))
    ? Math.max(1, Math.min(5, Math.floor(Number(config.maxLevel))))
    : (config.kind === 'passive' ? 1 : 3),
  upgradeCosts: Array.isArray(config.upgradeCosts)
    ? config.upgradeCosts.map((cost) => Math.max(0, Math.floor(Number(cost) || 0)))
    : [],
  range: config.range || '—',
  duration: config.duration || '—',
  description: config.description,
  effect: config.effect,
  prerequisites: Array.isArray(config.prerequisites) ? config.prerequisites : [],
  tags: Array.isArray(config.tags) ? config.tags : []
});

const MELEE_SKILLS = [
  createSkill({
    id: 'melee_war_form',
    name: '战意起式',
    subtitle: '阵线核心 · 被动',
    icon: 'Shield',
    tier: 0,
    column: 2,
    kind: 'passive',
    power: '伤害 +6%',
    powerLabel: '战意',
    cooldown: '被动',
    range: '全阵型',
    duration: '永久',
    description: '近战士兵以统一的起手节奏稳定阵线，使每次普通攻击都更容易形成连续压迫。',
    effect: '近战单位造成的所有武器伤害提高 6%，受到打断后的恢复速度提高 10%。',
    tags: ['基础', '阵线', '被动']
  }),
  createSkill({
    id: 'melee_heavy_blow',
    name: '集体重击',
    subtitle: '冲击分支 · 主动',
    icon: 'Swords',
    tier: 1,
    column: 1,
    branch: '冲击',
    power: '180% 攻击',
    cooldown: '18 秒',
    range: '前方 90°',
    duration: '瞬发',
    description: '全体近战士兵同时向前挥出一次沉重武器，形成整齐的扇面打击。',
    effect: '对前方扇面内的敌人造成 180% 攻击力伤害，并额外造成 28 点硬直冲击。',
    prerequisites: ['melee_war_form'],
    tags: ['伤害', '扇形', '硬直']
  }),
  createSkill({
    id: 'melee_rapid_slash',
    name: '疾风连斩',
    subtitle: '回旋分支 · 主动',
    icon: 'Zap',
    tier: 1,
    column: 3,
    branch: '回旋',
    power: '6×38% 攻击',
    cooldown: '22 秒',
    range: '近战周身',
    duration: '2.4 秒',
    description: '近战士兵在短时间内连续快速挥动武器，以多次低延迟斩击压制贴身目标。',
    effect: '连续造成 6 次 38% 攻击力伤害，期间移动速度降低 12%，不会被普通命中打断。',
    prerequisites: ['melee_war_form'],
    tags: ['伤害', '连续攻击', '压制']
  }),
  createSkill({
    id: 'melee_weapon_aura',
    name: '武器气',
    subtitle: '冲击分支 · 主动',
    icon: 'Wind',
    tier: 2,
    column: 1,
    branch: '冲击',
    power: '145% 攻击',
    cooldown: '20 秒',
    range: '9 米',
    duration: '瞬发',
    description: '士兵沿各自当前攻击方向挥动武器，释放带有方向性的武器气。',
    effect: '向前方 75° 扇面释放武器气，对路径内敌人造成 145% 攻击力伤害并穿透首个目标。',
    prerequisites: ['melee_heavy_blow'],
    tags: ['伤害', '远端近战', '穿透']
  }),
  createSkill({
    id: 'melee_circular_step',
    name: '巡回步',
    subtitle: '回旋分支 · 主动',
    icon: 'RotateCw',
    tier: 2,
    column: 2,
    branch: '回旋',
    power: '8×26% 攻击',
    cooldown: '26 秒',
    range: '阵型半径',
    duration: '3.6 秒',
    description: '近战士兵围绕原本阵型的位置快速来回运动，移动过程中持续挥砍周围敌人。',
    effect: '在原阵型半径内完成 8 次回旋攻击，每次造成 26% 攻击力伤害，并短暂牵制接触目标。',
    prerequisites: ['melee_rapid_slash'],
    tags: ['伤害', '位移', '回旋']
  }),
  createSkill({
    id: 'melee_breach_charge',
    name: '破阵突进',
    subtitle: '裂阵分支 · 主动',
    icon: 'ArrowUpRight',
    tier: 2,
    column: 3,
    branch: '裂阵',
    power: '240% 攻击',
    cooldown: '24 秒',
    range: '8 米',
    duration: '1.2 秒',
    description: '部队收束成矛头，朝指定方向短距离突进，以第一排武器完成破阵斩。',
    effect: '突进至目标区域并造成 240% 攻击力伤害，命中的敌人被推开 1.5 米。',
    prerequisites: ['melee_heavy_blow', 'melee_rapid_slash'],
    tags: ['伤害', '突进', '破阵']
  }),
  createSkill({
    id: 'melee_wave_sweep',
    name: '气浪横扫',
    subtitle: '武器气 · 终式',
    icon: 'Waves',
    tier: 3,
    column: 1,
    branch: '冲击',
    power: '220% 攻击',
    cooldown: '32 秒',
    range: '12 米扇形',
    duration: '瞬发',
    description: '将武器气扩展为横向气浪，覆盖比普通武器气更宽的正面区域。',
    effect: '释放两道叠加气浪，对 12 米内的敌人造成 220% 攻击力伤害，并降低其移动速度 35%，持续 2 秒。',
    prerequisites: ['melee_weapon_aura'],
    tags: ['伤害', '范围', '减速']
  }),
  createSkill({
    id: 'melee_blade_persistence',
    name: '持久气刃',
    subtitle: '武器气 · 终式',
    icon: 'Sword',
    tier: 3,
    column: 2,
    branch: '冲击',
    power: '75% 攻击/秒',
    cooldown: '36 秒',
    range: '纵深 16 米',
    duration: '5 秒',
    description: '把武器气压缩成持续向前推进的纵深气刃，适合切断狭窄通道。',
    effect: '生成持续 5 秒的纵深气刃，每秒造成 75% 攻击力伤害，同一目标最多受到 4 次伤害。',
    prerequisites: ['melee_weapon_aura'],
    tags: ['伤害', '持续', '纵深']
  }),
  createSkill({
    id: 'melee_circumference',
    name: '周驰',
    subtitle: '回旋终式 · 终极',
    icon: 'Orbit',
    tier: 3,
    column: 3,
    branch: '回旋',
    power: '10×45% 攻击',
    cooldown: '42 秒',
    range: '全阵型外圈',
    duration: '5 秒',
    description: '近战士兵围绕整个部队阵型中心做高速圆周运动，同时保持武器向外挥砍。',
    effect: '完成 10 次外圈斩击，每次造成 45% 攻击力伤害；期间获得 30% 减伤和 45% 移动速度。',
    prerequisites: ['melee_circular_step', 'melee_breach_charge'],
    tags: ['伤害', '高速移动', '终极']
  })
];

const RANGED_SKILLS = [
  createSkill({
    id: 'ranged_ballistic_form',
    name: '弹道校准',
    subtitle: '火力核心 · 被动',
    icon: 'Crosshair',
    tier: 0,
    column: 2,
    kind: 'passive',
    power: '命中 +7%',
    powerLabel: '校准',
    cooldown: '被动',
    range: '全射程',
    duration: '永久',
    description: '远程士兵统一校正射界与装填节奏，使部队火力更稳定地落在有效区域。',
    effect: '远程单位命中率提高 7%，移动射击造成的伤害衰减降低 18%。',
    tags: ['基础', '命中', '被动']
  }),
  createSkill({
    id: 'ranged_fixed_volley',
    name: '定点齐射',
    subtitle: '阵地分支 · 主动',
    icon: 'Target',
    tier: 1,
    column: 1,
    branch: '阵地',
    power: '4×65% 攻击',
    cooldown: '16 秒',
    range: '18 米',
    duration: '1.6 秒',
    description: '部队快速锁定一个落点，按统一节拍完成四轮精准齐射。',
    effect: '对目标区域连续落下 4 轮弹药，每轮造成 65% 攻击力伤害，中心区域伤害提高 20%。',
    prerequisites: ['ranged_ballistic_form'],
    tags: ['伤害', '精准', '区域']
  }),
  createSkill({
    id: 'ranged_run_fire',
    name: '急行射击',
    subtitle: '机动分支 · 主动',
    icon: 'Move',
    tier: 1,
    column: 3,
    branch: '机动',
    power: '6×42% 攻击',
    cooldown: '20 秒',
    range: '12 米',
    duration: '3 秒',
    description: '远程士兵边移动边射击，在短时间内以牺牲精度换取持续火力。',
    effect: '移动速度提高 35%，沿移动方向进行 6 次射击，每次造成 42% 攻击力伤害。',
    prerequisites: ['ranged_ballistic_form'],
    tags: ['伤害', '移动射击', '拉扯']
  }),
  createSkill({
    id: 'ranged_piercing_barrage',
    name: '穿透弹幕',
    subtitle: '阵地分支 · 主动',
    icon: 'Layers',
    tier: 2,
    column: 1,
    branch: '阵地',
    power: '185% 攻击',
    cooldown: '22 秒',
    range: '20 米',
    duration: '瞬发',
    description: '将齐射压缩为穿透性弹幕，专门处理密集排列的敌方部队。',
    effect: '发射 3 道穿透弹幕，每道造成 185% 攻击力伤害，最多穿过 4 个目标。',
    prerequisites: ['ranged_fixed_volley'],
    tags: ['伤害', '穿透', '密集目标']
  }),
  createSkill({
    id: 'ranged_suppression_fan',
    name: '散射压制',
    subtitle: '机动分支 · 主动',
    icon: 'CircleDot',
    tier: 2,
    column: 2,
    branch: '机动',
    power: '10×32% 攻击',
    cooldown: '24 秒',
    range: '14 米扇区',
    duration: '4 秒',
    description: '以扇形散射覆盖敌方前进路线，让移动中的敌人持续承受火力。',
    effect: '在扇区内发射 10 枚散射弹，每枚造成 32% 攻击力伤害并降低敌人移动速度 28%。',
    prerequisites: ['ranged_run_fire'],
    tags: ['伤害', '散射', '减速']
  }),
  createSkill({
    id: 'ranged_hunter_lock',
    name: '猎线锁定',
    subtitle: '猎杀分支 · 主动',
    icon: 'Crosshair',
    tier: 2,
    column: 3,
    branch: '猎杀',
    power: '260% 攻击',
    cooldown: '26 秒',
    range: '24 米',
    duration: '2 秒',
    description: '将多个射手的瞄准线集中到一个高价值目标，短暂延迟后完成同步击发。',
    effect: '锁定单个目标并造成 260% 攻击力伤害；目标生命高于 70% 时额外造成 35% 伤害。',
    prerequisites: ['ranged_fixed_volley', 'ranged_run_fire'],
    tags: ['伤害', '单体', '猎杀']
  }),
  createSkill({
    id: 'ranged_deep_pierce',
    name: '贯穿齐射',
    subtitle: '穿透终式 · 终极',
    icon: 'ArrowUpRight',
    tier: 3,
    column: 1,
    branch: '阵地',
    power: '320% 攻击',
    cooldown: '34 秒',
    range: '28 米直线',
    duration: '瞬发',
    description: '把定点齐射与穿透弹幕结合为一条贯穿战线的重型火力线。',
    effect: '对直线上的所有目标造成 320% 攻击力伤害，命中越远的目标伤害越高，最多提高 45%。',
    prerequisites: ['ranged_piercing_barrage'],
    tags: ['伤害', '直线', '终极']
  }),
  createSkill({
    id: 'ranged_fire_net',
    name: '持续火网',
    subtitle: '压制终式 · 终极',
    icon: 'Flame',
    tier: 3,
    column: 2,
    branch: '机动',
    power: '80% 攻击/秒',
    cooldown: '38 秒',
    range: '18 米区域',
    duration: '6 秒',
    description: '把散射压制升级成可持续移动的火力网，封锁敌人最常用的走位路径。',
    effect: '生成持续 6 秒的火力区域，每秒造成 80% 攻击力伤害，敌人离开区域后仍灼烧 1.5 秒。',
    prerequisites: ['ranged_suppression_fan'],
    tags: ['伤害', '持续', '区域控制']
  }),
  createSkill({
    id: 'ranged_longshot',
    name: '远程狙杀',
    subtitle: '猎杀终式 · 终极',
    icon: 'Target',
    tier: 3,
    column: 3,
    branch: '猎杀',
    power: '520% 攻击',
    cooldown: '45 秒',
    range: '32 米',
    duration: '瞬发',
    description: '全体远程士兵为同一目标让出射界，以一次极高威力的同步狙杀结束锁定。',
    effect: '对锁定目标造成 520% 攻击力伤害；目标每有 1 个负面效果，伤害提高 12%，最多提高 48%。',
    prerequisites: ['ranged_hunter_lock'],
    tags: ['伤害', '单体', '终极']
  })
];

const SUPPORT_SKILLS = [
  createSkill({
    id: 'support_coordination_protocol',
    name: '协同协议',
    subtitle: '支援核心 · 被动',
    icon: 'Radio',
    tier: 0,
    column: 2,
    kind: 'passive',
    power: '技能效率 +5%',
    powerLabel: '协同',
    cooldown: '被动',
    range: '全阵型',
    duration: '永久',
    description: '辅助士兵建立稳定的目标分配与信号回路，让后续增益和干预更容易同步生效。',
    effect: '辅助类技能的持续时间提高 5%，施放后 2 秒内所有受益单位获得 5% 控制抗性。',
    tags: ['基础', '协同', '被动']
  }),
  createSkill({
    id: 'support_specialized_boost',
    name: '专精增幅',
    subtitle: '组合分支 · 主动',
    icon: 'Gauge',
    tier: 1,
    column: 1,
    branch: '组合',
    power: '攻击 +28%',
    powerLabel: '增益',
    cooldown: '18 秒',
    range: '单一大类',
    duration: '8 秒',
    description: '将辅助能量集中投入一种大类兵种，换取短时间的强力属性提升。',
    effect: '使指定大类单位攻击力提高 28%，攻击速度提高 12%，持续 8 秒。',
    prerequisites: ['support_coordination_protocol'],
    tags: ['增益', '集中', '攻击']
  }),
  createSkill({
    id: 'support_comprehensive_tuning',
    name: '全域调律',
    subtitle: '全面分支 · 主动',
    icon: 'SlidersHorizontal',
    tier: 1,
    column: 3,
    branch: '全面',
    power: '综合属性 +10%',
    powerLabel: '增益',
    cooldown: '24 秒',
    range: '全阵型',
    duration: '10 秒',
    description: '以较低强度同时调整全体士兵的攻防、速度和稳定性，适应复杂战场。',
    effect: '全体友军攻击、防御、移动速度和硬直上限提高 10%，持续 10 秒。',
    prerequisites: ['support_coordination_protocol'],
    tags: ['增益', '全体', '综合']
  }),
  createSkill({
    id: 'support_chain_amplifier',
    name: '链式增幅',
    subtitle: '组合分支 · 主动',
    icon: 'Zap',
    tier: 2,
    column: 1,
    branch: '组合',
    power: '攻击 +42%',
    powerLabel: '增益',
    cooldown: '26 秒',
    range: '相邻两类',
    duration: '9 秒',
    description: '把专精增幅沿部队阵型传递给两个相邻的大类，牺牲部分峰值换取覆盖范围。',
    effect: '使两个相邻大类攻击力提高 42%，并将 15% 的增益转化为穿透伤害，持续 9 秒。',
    prerequisites: ['support_specialized_boost'],
    tags: ['增益', '链式', '穿透']
  }),
  createSkill({
    id: 'support_battlefield_resonance',
    name: '战阵共鸣',
    subtitle: '全面分支 · 主动',
    icon: 'Layers',
    tier: 2,
    column: 2,
    branch: '全面',
    power: '综合属性 +16%',
    powerLabel: '增益',
    cooldown: '30 秒',
    range: '全阵型',
    duration: '12 秒',
    description: '使部队中的不同兵种共享一部分正在生效的属性增益，提升混合编组的稳定性。',
    effect: '全体友军获得攻击、防御、速度和控制抗性 16% 的综合提升，持续 12 秒。',
    prerequisites: ['support_comprehensive_tuning'],
    tags: ['增益', '全体', '混合编组']
  }),
  createSkill({
    id: 'support_purification_pulse',
    name: '净化脉冲',
    subtitle: '干预分支 · 主动',
    icon: 'HeartPulse',
    tier: 2,
    column: 3,
    branch: '干预',
    power: '解除 1 次控制',
    powerLabel: '干预',
    cooldown: '22 秒',
    range: '全阵型',
    duration: '瞬发',
    description: '释放一次全阵型净化脉冲，优先处理当前最危险的控制与负面状态。',
    effect: '解除全体友军 1 次控制效果，清除 1 个普通负面效果，并使后续负面持续时间降低 40%，持续 6 秒。',
    prerequisites: ['support_coordination_protocol'],
    tags: ['解控', '净化', '全体']
  }),
  createSkill({
    id: 'support_precision_overload',
    name: '定向超载',
    subtitle: '组合终式 · 终极',
    icon: 'Rocket',
    tier: 3,
    column: 1,
    branch: '组合',
    power: '攻击 +65%',
    powerLabel: '增益',
    cooldown: '38 秒',
    range: '单一大类',
    duration: '10 秒',
    description: '将链式增幅收束到最关键的大类兵种，短时间内释放极高的专精强化。',
    effect: '指定大类攻击力提高 65%，技能伤害提高 25%，但技能结束后该大类获得 2 秒疲劳。',
    prerequisites: ['support_chain_amplifier'],
    tags: ['增益', '爆发', '终极']
  }),
  createSkill({
    id: 'support_total_command',
    name: '全域战令',
    subtitle: '全面终式 · 终极',
    icon: 'ShieldCheck',
    tier: 3,
    column: 2,
    branch: '全面',
    power: '综合属性 +26%',
    powerLabel: '增益',
    cooldown: '44 秒',
    range: '全阵型',
    duration: '14 秒',
    description: '以最高等级的协调指令将全体士兵纳入同一战术节奏，形成稳定的全面强化。',
    effect: '全体友军攻击、防御、速度、射程和硬直上限提高 26%，持续 14 秒。',
    prerequisites: ['support_battlefield_resonance'],
    tags: ['增益', '全体', '终极']
  }),
  createSkill({
    id: 'support_intervention_domain',
    name: '干预领域',
    subtitle: '干预终式 · 终极',
    icon: 'Ban',
    tier: 3,
    column: 3,
    branch: '干预',
    power: '敌方属性 -22%',
    powerLabel: '减益',
    cooldown: '40 秒',
    range: '18 米区域',
    duration: '8 秒',
    description: '在指定区域建立持续干预场，持续解除友军控制并压低敌方战斗效率。',
    effect: '区域内友军每秒获得一次净化判定；敌方攻击、防御和移动速度降低 22%，持续 8 秒。',
    prerequisites: ['support_purification_pulse'],
    tags: ['解控', '减益', '区域', '终极']
  })
];

export const SKILL_TREE_CATALOG = Object.freeze([
  Object.freeze({
    id: 'melee',
    categoryLabel: '近战',
    name: '近战技能树',
    codename: 'IRON ARC',
    color: '#ef4444',
    softColor: 'rgba(239, 68, 68, 0.2)',
    description: '围绕阵型中心展开近距离压迫，以重击、连续斩击、武器气和高速回旋逐层扩大杀伤范围。',
    skills: Object.freeze(MELEE_SKILLS)
  }),
  Object.freeze({
    id: 'ranged',
    categoryLabel: '远程',
    name: '远程技能树',
    codename: 'BLUE HORIZON',
    color: '#38bdf8',
    softColor: 'rgba(56, 189, 248, 0.2)',
    description: '围绕射界控制和火力效率展开，以齐射、穿透、移动射击和远程狙杀逐层强化输出。',
    skills: Object.freeze(RANGED_SKILLS)
  }),
  Object.freeze({
    id: 'support',
    categoryLabel: '辅助',
    name: '辅助技能树',
    codename: 'VERDANT SIGNAL',
    color: '#4ade80',
    softColor: 'rgba(74, 222, 128, 0.2)',
    description: '围绕部队协同展开，提供专精强化、综合调律、解控净化和敌方干预。',
    skills: Object.freeze(SUPPORT_SKILLS)
  })
]);

export const SKILL_TREE_BY_ID = Object.freeze(
  Object.fromEntries(SKILL_TREE_CATALOG.map((tree) => [tree.id, tree]))
);

export const SKILL_TREE_CATEGORY_LABELS = Object.freeze({
  melee: '近战',
  ranged: '远程',
  support: '辅助'
});

export const getSkillTreeById = (treeCategory = '') => (
  SKILL_TREE_BY_ID[String(treeCategory || '').trim()] || null
);

export const getSkillById = (treeCategory = '', skillId = '') => {
  const tree = getSkillTreeById(treeCategory);
  const safeSkillId = String(skillId || '').trim();
  return tree?.skills?.find((skill) => skill.id === safeSkillId) || null;
};

export const getSkillCooldownSeconds = (skill = null, fallback = 6) => {
  if (!skill || skill.kind === 'passive') return 0;
  const explicit = Number(skill.cooldownSeconds);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const match = String(skill.cooldown || '').match(/[0-9]+(?:\.[0-9]+)?/);
  return Math.max(0, Number(match?.[0]) || Number(fallback) || 0);
};

export const getSkillUnlockCost = (skill = null) => (
  Math.max(0, Math.floor(Number(skill?.unlockCost) || (Number(skill?.tier) > 0 ? 1 : 0)))
);

export const getSkillMaxLevel = (skill = null) => (
  Math.max(1, Math.min(5, Math.floor(Number(skill?.maxLevel) || 3)))
);

export const getSkillLevel = (progress = null, skill = null) => {
  const skillId = typeof skill === 'string' ? skill : String(skill?.id || '');
  if (!skillId) return 0;
  const rawLevel = Number(progress?.levels?.[skillId]);
  const unlocked = Array.isArray(progress?.unlocked) && progress.unlocked.includes(skillId);
  const normalized = Number.isFinite(rawLevel) ? Math.floor(rawLevel) : (unlocked ? 1 : 0);
  return Math.max(0, Math.min(getSkillMaxLevel(skill), normalized));
};

export const getSkillUpgradeCost = (skill = null, currentLevel = 0) => {
  const level = Math.max(0, Math.min(getSkillMaxLevel(skill), Math.floor(Number(currentLevel) || 0)));
  if (level >= getSkillMaxLevel(skill)) return 0;
  const configuredCost = Number(skill?.upgradeCosts?.[level]);
  if (Number.isFinite(configuredCost)) return Math.max(0, Math.floor(configuredCost));
  if (level <= 0) return getSkillUnlockCost(skill);
  return Math.max(1, getSkillUnlockCost(skill) + level);
};

export const getSkillPointCostSchedule = (skill = null) => Array.from(
  { length: getSkillMaxLevel(skill) },
  (_, index) => ({ level: index + 1, cost: getSkillUpgradeCost(skill, index) })
);

export const getSkillTreeRemainingUnlockCost = (treeCategory = '', progress = null) => {
  const tree = getSkillTreeById(treeCategory);
  if (!tree) return 0;
  const unlocked = new Set(
    (Array.isArray(progress?.unlocked) ? progress.unlocked : [])
      .map((skillId) => String(skillId || '').trim())
      .filter(Boolean)
  );
  return tree.skills.reduce((total, skill) => (
    unlocked.has(skill.id) ? total : total + getSkillUnlockCost(skill)
  ), 0);
};

export const getSkillTreeRoot = (treeCategory = '') => {
  const tree = getSkillTreeById(treeCategory);
  return tree?.skills?.find((skill) => skill.tier === 0) || tree?.skills?.[0] || null;
};

// The root node is a free passive.  A newly created command slot needs the
// first usable (active) node so it can be cast once training starts.
export const getSkillTreeFirstActiveSkill = (treeCategory = '') => {
  const tree = getSkillTreeById(treeCategory);
  return tree?.skills?.find((skill) => skill.kind !== 'passive') || getSkillTreeRoot(treeCategory);
};

export const getAllowedSkillTreeCategories = (unitCategories = []) => {
  const allowed = new Set(
    (Array.isArray(unitCategories) ? unitCategories : [])
      .map((category) => String(category || '').trim())
      .filter((category) => Object.prototype.hasOwnProperty.call(SKILL_TREE_CATEGORY_LABELS, category))
  );
  return SKILL_TREE_CATALOG
    .map((tree) => tree.id)
    .filter((treeCategory) => allowed.has(treeCategory));
};

export const normalizeSkillSlots = (skillSlots = []) => Array.from({ length: 3 }, (_, slotIndex) => {
  const raw = Array.isArray(skillSlots)
    ? skillSlots.find((slot) => Math.max(0, Math.floor(Number(slot?.slotIndex) || 0)) === slotIndex)
      || skillSlots[slotIndex]
    : null;
  const treeCategory = getSkillTreeById(raw?.treeCategory)?.id || '';
  const skill = getSkillById(treeCategory, raw?.skillId);
  return {
    slotIndex,
    treeCategory,
    skillId: skill?.id || '',
    cooldownRemain: Math.max(0, Number(raw?.cooldownRemain) || 0)
  };
});

export const resolveEffectiveSkillSlots = (skillSlots = []) => {
  const seen = new Set();
  return normalizeSkillSlots(skillSlots).map((slot) => {
    if (!slot.skillId) return { ...slot, conflict: false };
    if (seen.has(slot.skillId)) return { ...slot, conflict: true };
    seen.add(slot.skillId);
    return { ...slot, conflict: false };
  });
};

export const normalizeSkillTreeProgress = (progress = {}) => {
  const source = progress && typeof progress === 'object' ? progress : {};
  return Object.fromEntries(SKILL_TREE_CATALOG.map((tree) => {
    const known = new Set(tree.skills.map((skill) => skill.id));
    const rawUnlocked = Array.isArray(source?.[tree.id]?.unlocked)
      ? source[tree.id].unlocked
      : (Array.isArray(source?.[tree.id]) ? source[tree.id] : []);
    const unlocked = new Set(rawUnlocked.map((id) => String(id || '').trim()).filter((id) => known.has(id)));
    const rawLevels = source?.[tree.id]?.levels && typeof source[tree.id].levels === 'object'
      ? source[tree.id].levels
      : {};
    const root = getSkillTreeRoot(tree.id);
    if (root) unlocked.add(root.id);
    const levels = {};
    tree.skills.forEach((skill) => {
      const rawLevel = Number(rawLevels?.[skill.id]);
      const fallbackLevel = unlocked.has(skill.id) ? 1 : 0;
      const level = Math.max(
        skill.id === root?.id ? 1 : 0,
        Math.min(getSkillMaxLevel(skill), Number.isFinite(rawLevel) ? Math.floor(rawLevel) : fallbackLevel)
      );
      if (level <= 0) return;
      unlocked.add(skill.id);
      levels[skill.id] = level;
    });
    return [tree.id, { unlocked: Array.from(unlocked), levels }];
  }));
};
