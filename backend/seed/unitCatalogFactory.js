const RPS_TYPES = ['melee', 'ranged', 'support'];

const RPS_ADVANTAGE = {
  melee: 'ranged',
  ranged: 'support',
  support: 'melee'
};

// 知识点按“每名真实士兵”结算。T1 兵种保持 3 - 5 点的低门槛：
// 机动型 3 点、均衡/专精型 4 点、重装/全能型 5 点。
const UNIT_KNOWLEDGE_COST_KP = Object.freeze({
  melee_mobility: 3,
  melee_defense: 5,
  melee_balance: 4,
  ranged_mobility: 3,
  ranged_defense: 5,
  ranged_balance: 4,
  support_combination: 4,
  support_comprehensive: 5,
  support_intervention: 4
});

const UNIT_PALETTE_TONE_BY_SUBTYPE = Object.freeze({
  mobility: 'light',
  balance: 'base',
  defense: 'dark',
  combination: 'light',
  comprehensive: 'base',
  intervention: 'dark'
});

const UNIT_CATEGORY_PALETTES = Object.freeze({
  melee: Object.freeze({
    light: Object.freeze({ primary: '#ef9a9a', secondary: '#ffebee', accent: '#ef5350' }),
    base: Object.freeze({ primary: '#e53935', secondary: '#ffcdd2', accent: '#ef5350' }),
    dark: Object.freeze({ primary: '#b71c1c', secondary: '#ff8a80', accent: '#d32f2f' })
  }),
  ranged: Object.freeze({
    light: Object.freeze({ primary: '#90caf9', secondary: '#e3f2fd', accent: '#42a5f5' }),
    base: Object.freeze({ primary: '#1e88e5', secondary: '#bbdefb', accent: '#42a5f5' }),
    dark: Object.freeze({ primary: '#0d47a1', secondary: '#82b1ff', accent: '#1565c0' })
  }),
  support: Object.freeze({
    light: Object.freeze({ primary: '#a5d6a7', secondary: '#e8f5e9', accent: '#66bb6a' }),
    base: Object.freeze({ primary: '#43a047', secondary: '#c8e6c9', accent: '#66bb6a' }),
    dark: Object.freeze({ primary: '#1b5e20', secondary: '#b9f6ca', accent: '#2e7d32' })
  })
});

const resolveUnitPalette = (unitCategory, unitSubtype) => {
  const categoryPalette = UNIT_CATEGORY_PALETTES[unitCategory] || UNIT_CATEGORY_PALETTES.melee;
  const tone = UNIT_PALETTE_TONE_BY_SUBTYPE[unitSubtype] || 'base';
  return categoryPalette[tone] || categoryPalette.base;
};

const PROFESSION_CONFIG = [
  {
    unitCategory: 'melee',
    unitSubtype: 'mobility',
    professionKey: 'melee_mobility',
    professionId: 'melee.mobility',
    professionName: '迅击游骑',
    roleTag: '近战',
    base: { hp: 115, atk: 26, def: 5, speed: 5.2, attackRange: { min: 1, max: 1 }, costKP: UNIT_KNOWLEDGE_COST_KP.melee_mobility, cooldown: 0.9, accuracy: 0.84, impactPoise: 10, impactTransition: 12 },
    vehicleId: 'veh_hover_bike',
    description: '以高速切入、绕后和追击为核心的近战单位，牺牲部分防御换取战场机动性。'
  },
  {
    unitCategory: 'melee',
    unitSubtype: 'defense',
    professionKey: 'melee_defense',
    professionId: 'melee.defense',
    professionName: '壁垒卫士',
    roleTag: '近战',
    base: { hp: 220, atk: 18, def: 16, speed: 2.7, attackRange: { min: 1, max: 1 }, costKP: UNIT_KNOWLEDGE_COST_KP.melee_defense, cooldown: 1.2, accuracy: 0.86, impactPoise: 14, impactTransition: 15 },
    vehicleId: 'veh_turtle_apc',
    description: '承担正面承伤和阵线稳固的近战单位，拥有九类兵种中最高的生存能力。'
  },
  {
    unitCategory: 'melee',
    unitSubtype: 'balance',
    professionKey: 'melee_balance',
    professionId: 'melee.balance',
    professionName: '均衡战士',
    roleTag: '近战',
    base: { hp: 165, atk: 23, def: 10, speed: 3.8, attackRange: { min: 1, max: 1 }, costKP: UNIT_KNOWLEDGE_COST_KP.melee_balance, cooldown: 1.0, accuracy: 0.85, impactPoise: 11, impactTransition: 12 },
    vehicleId: 'veh_jeep_top',
    description: '攻防、速度和持续作战能力均衡的近战单位，适合承担部队的通用前排。'
  },
  {
    unitCategory: 'ranged',
    unitSubtype: 'mobility',
    professionKey: 'ranged_mobility',
    professionId: 'ranged.mobility',
    professionName: '游击射手',
    roleTag: '远程',
    base: { hp: 105, atk: 19, def: 5, speed: 4.3, attackRange: { min: 3, max: 6 }, costKP: UNIT_KNOWLEDGE_COST_KP.ranged_mobility, cooldown: 0.8, accuracy: 0.68, movePenaltyK: 0.22, impactPoise: 7, impactTransition: 8 },
    vehicleId: 'veh_hover_skiff',
    description: '强调边移动边输出和快速换位的远程单位，适合拉扯和侧翼火力。'
  },
  {
    unitCategory: 'ranged',
    unitSubtype: 'defense',
    professionKey: 'ranged_defense',
    professionId: 'ranged.defense',
    professionName: '守望炮手',
    roleTag: '远程',
    base: { hp: 155, atk: 22, def: 10, speed: 2.6, attackRange: { min: 4, max: 8 }, costKP: UNIT_KNOWLEDGE_COST_KP.ranged_defense, cooldown: 1.4, accuracy: 0.86, movePenaltyK: 0.18, impactPoise: 10, impactTransition: 12 },
    vehicleId: 'veh_spg',
    description: '依靠攻击范围、命中和阵地稳定性进行远程防守的单位，适合守住关键区域。'
  },
  {
    unitCategory: 'ranged',
    unitSubtype: 'balance',
    professionKey: 'ranged_balance',
    professionId: 'ranged.balance',
    professionName: '精锐射手',
    roleTag: '远程',
    base: { hp: 125, atk: 21, def: 7, speed: 3.4, attackRange: { min: 3, max: 7 }, costKP: UNIT_KNOWLEDGE_COST_KP.ranged_balance, cooldown: 1.05, accuracy: 0.8, movePenaltyK: 0.22, impactPoise: 8, impactTransition: 10 },
    vehicleId: 'veh_mortar_car',
    description: '各项远程能力均衡的通用输出单位，能在多数战场环境保持稳定贡献。'
  },
  {
    unitCategory: 'support',
    unitSubtype: 'combination',
    professionKey: 'support_combination',
    professionId: 'support.combination',
    professionName: '专精增幅师',
    roleTag: '远程',
    base: { hp: 115, atk: 10, def: 7, speed: 3.2, attackRange: { min: 3, max: 6 }, costKP: UNIT_KNOWLEDGE_COST_KP.support_combination, cooldown: 1.25, accuracy: 0.7, movePenaltyK: 0.18, impactPoise: 5, impactTransition: 9 },
    vehicleId: 'veh_support_relay',
    description: '未来技能树中的组合型辅助，倾向于集中强化部队的某一组关键属性。'
  },
  {
    unitCategory: 'support',
    unitSubtype: 'comprehensive',
    professionKey: 'support_comprehensive',
    professionId: 'support.comprehensive',
    professionName: '全域协调师',
    roleTag: '远程',
    base: { hp: 145, atk: 9, def: 9, speed: 2.9, attackRange: { min: 3, max: 6 }, costKP: UNIT_KNOWLEDGE_COST_KP.support_comprehensive, cooldown: 1.4, accuracy: 0.72, movePenaltyK: 0.16, impactPoise: 6, impactTransition: 10 },
    vehicleId: 'veh_command_car',
    description: '未来技能树中的全面型辅助，提供覆盖攻击、防御、速度和稳定性的综合增益。'
  },
  {
    unitCategory: 'support',
    unitSubtype: 'intervention',
    professionKey: 'support_intervention',
    professionId: 'support.intervention',
    professionName: '战术干预师',
    roleTag: '远程',
    base: { hp: 105, atk: 13, def: 5, speed: 3.6, attackRange: { min: 3, max: 7 }, costKP: UNIT_KNOWLEDGE_COST_KP.support_intervention, cooldown: 1.1, accuracy: 0.76, movePenaltyK: 0.16, impactPoise: 7, impactTransition: 11 },
    vehicleId: 'veh_intervention_skiff',
    description: '未来技能树中的干预型辅助，围绕解除控制、清除负面效果和施加敌方减益展开。'
  }
];


const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const roundTo = (value, digits = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const buildRpsRuleComponent = () => ({
  componentId: 'rule_rps_triangle',
  kind: 'interactionRule',
  name: '三角克制规则',
  tags: ['global', 'rps'],
  version: 1,
  data: {
    order: ['melee', 'ranged', 'support'],
    multipliers: {
      advantage: { damageMul: 1.2, poiseDamageMul: 1.25, hitMul: 1.08 },
      disadvantage: { damageMul: 0.85, poiseDamageMul: 0.85, hitMul: 0.92 }
    }
  }
});

const buildStaticComponents = () => {
  const bodyComponents = PROFESSION_CONFIG.map((cfg) => ({
    componentId: `body_${cfg.professionKey}`,
    kind: 'body',
    name: `${cfg.professionName}体型`,
    tags: [cfg.unitCategory, cfg.unitSubtype, cfg.professionId],
    version: 1,
    data: {
      silhouette: cfg.professionKey,
      baseScale: cfg.unitSubtype === 'defense' ? 1.06 : (cfg.unitSubtype === 'mobility' ? 0.94 : 1),
      defaultPose: cfg.unitCategory === 'melee' ? 'combat' : 'aim'
    }
  }));

  const weaponComponents = PROFESSION_CONFIG.map((cfg) => ({
    componentId: `weapon_${cfg.professionKey}`,
    kind: 'weapon',
    name: `${cfg.professionName}主武器`,
    tags: [cfg.unitCategory, cfg.unitSubtype, cfg.professionId],
    version: 1,
    data: {
      cooldownSec: Number(cfg.base.cooldown) || 1,
      accuracy: Number(cfg.base.accuracy) || 0.8,
      attackRange: { ...cfg.base.attackRange },
      impact: {
        poise: Number(cfg.base.impactPoise) || 8,
        transition: Number(cfg.base.impactTransition) || 8
      },
      aoeRadius: Number(cfg.base.aoeRadius) || 0,
      movePenaltyK: Number(cfg.base.movePenaltyK) || 0
    }
  }));

  const vehicleComponents = [
    { id: 'veh_steed_horse', name: '装甲坐骑', seatMode: 'ride', isFlying: false, hasWeapon: false },
    { id: 'veh_moto_raid', name: '突袭摩托', seatMode: 'ride', isFlying: false, hasWeapon: true },
    { id: 'veh_hover_bike', name: '悬浮快骑', seatMode: 'ride', isFlying: true, hasWeapon: true },
    { id: 'veh_buggy_inside', name: '快反轻车', seatMode: 'inside', isFlying: false, hasWeapon: true },
    { id: 'veh_jeep_top', name: '越野战车', seatMode: 'top', isFlying: false, hasWeapon: true },
    { id: 'veh_hover_skiff', name: '气垫艇', seatMode: 'inside', isFlying: true, hasWeapon: true },
    { id: 'veh_catapult', name: '投石车', seatMode: 'top', isFlying: false, hasWeapon: true },
    { id: 'veh_mortar_car', name: '迫击炮车', seatMode: 'inside', isFlying: false, hasWeapon: true },
    { id: 'veh_spg', name: '自行火炮', seatMode: 'inside', isFlying: false, hasWeapon: true },
    { id: 'veh_missile_platform', name: '导弹平台', seatMode: 'top', isFlying: true, hasWeapon: true },
    { id: 'veh_shield_cart', name: '盾车', seatMode: 'top', isFlying: false, hasWeapon: false },
    { id: 'veh_turtle_apc', name: '龟甲装甲车', seatMode: 'inside', isFlying: false, hasWeapon: true },
    { id: 'veh_halftrack', name: '半履带装甲车', seatMode: 'inside', isFlying: false, hasWeapon: true },
    { id: 'veh_siege_walker', name: '攻城步行机', seatMode: 'top', isFlying: false, hasWeapon: true },
    { id: 'veh_flying_skiff', name: '低空突击艇', seatMode: 'inside', isFlying: true, hasWeapon: true },
    { id: 'veh_bastion_drone', name: '堡垒浮空台', seatMode: 'top', isFlying: true, hasWeapon: true },
    { id: 'veh_support_relay', name: '前线增幅中继车', seatMode: 'inside', isFlying: false, hasWeapon: false },
    { id: 'veh_command_car', name: '全域指挥车', seatMode: 'inside', isFlying: false, hasWeapon: false },
    { id: 'veh_intervention_skiff', name: '干预信标艇', seatMode: 'inside', isFlying: true, hasWeapon: false }
  ].map((item) => ({
    componentId: item.id,
    kind: 'vehicle',
    name: item.name,
    tags: ['vehicle', item.seatMode, item.isFlying ? 'flying' : 'ground', item.hasWeapon ? 'armed' : 'utility'],
    version: 1,
    data: {
      seatMode: item.seatMode,
      isFlying: item.isFlying,
      hasWeapon: item.hasWeapon
    }
  }));

  const behaviorProfiles = PROFESSION_CONFIG.map((cfg) => ({
    componentId: `behavior_${cfg.professionKey}`,
    kind: 'behaviorProfile',
    name: `${cfg.professionName}行为模板`,
    tags: [cfg.unitCategory, cfg.unitSubtype, cfg.professionId],
    version: 1,
    data: {
      transitionSec: {
        moveToAttack: cfg.unitSubtype === 'mobility' ? 0.24 : 0.32,
        attackToMove: cfg.unitSubtype === 'mobility' ? 0.2 : 0.3,
        forwardToRetreat: cfg.unitSubtype === 'defense' ? 0.46 : 0.35,
        retreatToForward: cfg.unitSubtype === 'defense' ? 0.48 : 0.36
      },
      guardRadiusMul: cfg.unitCategory === 'ranged' || cfg.unitCategory === 'support' ? 1.25 : 1,
      chaseRadiusMul: cfg.unitSubtype === 'mobility' ? 1.35 : 1.05,
      turnRateMul: cfg.unitSubtype === 'defense' ? 0.86 : 1.08
    }
  }));

  const staggerReactions = [
    { id: 'stagger_light', name: '轻硬直', light: 0.35, medium: 0.5, heavy: 0.68, knockdown: 0.95 },
    { id: 'stagger_medium', name: '中硬直', light: 0.4, medium: 0.58, heavy: 0.78, knockdown: 1.02 },
    { id: 'stagger_heavy', name: '重硬直', light: 0.45, medium: 0.65, heavy: 0.86, knockdown: 1.12 },
    { id: 'stagger_knockdown', name: '击倒', light: 0.55, medium: 0.74, heavy: 0.95, knockdown: 1.35 }
  ].map((item) => ({
    componentId: item.id,
    kind: 'staggerReaction',
    name: item.name,
    tags: ['stagger'],
    version: 1,
    data: {
      durationSec: {
        light: item.light,
        medium: item.medium,
        heavy: item.heavy,
        knockdown: item.knockdown
      }
    }
  }));

  return [
    ...bodyComponents,
    ...weaponComponents,
    ...vehicleComponents,
    ...behaviorProfiles,
    ...staggerReactions,
    buildRpsRuleComponent()
  ];
};

const buildStabilityProfiles = () => {
  return PROFESSION_CONFIG.map((cfg) => {
    const hp = Math.max(1, Number(cfg.base.hp) || 1);
    const def = Math.max(0, Number(cfg.base.def) || 0);
    const mobilityFactor = cfg.unitSubtype === 'mobility' ? 1.1 : 1;
    const defenseFactor = cfg.unitSubtype === 'defense' ? 1.16 : 1;
    return {
      componentId: `stability_${cfg.professionKey}`,
      kind: 'stabilityProfile',
      name: `${cfg.professionName}稳定性`,
      tags: [cfg.unitCategory, cfg.unitSubtype, 'tier_1'],
      version: 1,
      data: {
        poiseMax: Math.round(((hp * 0.42) + (def * 4.5)) * defenseFactor),
        chargePoise: Math.round(((hp * 0.52) + (def * 3.2)) * mobilityFactor),
        transitionMax: Math.round((hp * 0.34) + (def * 3.6)),
        poiseRegenPerSec: roundTo(5.8 + (def * 0.08), 2),
        transitionDecayPerSec: roundTo(3.8 + (cfg.unitSubtype === 'defense' ? 0.6 : 0), 2),
        transitionRegenPerSec: roundTo(2.4 + (cfg.unitSubtype === 'balance' ? 0.35 : 0), 2)
      }
    };
  });
};

const buildUnitTypes = () => {
  return PROFESSION_CONFIG.map((cfg, professionIndex) => {
    const tier = 1;
    const sortOrder = professionIndex;
    const layerSeed = sortOrder;
    const unitTypeId = `u_${cfg.unitCategory}_${cfg.unitSubtype}`;
    const rpsTag = cfg.unitCategory;
    const tags = [
      'unit_type',
      cfg.unitCategory,
      cfg.unitSubtype,
      cfg.professionId,
      'tier_1',
      RPS_ADVANTAGE[rpsTag] ? `counter_${RPS_ADVANTAGE[rpsTag]}` : ''
    ].filter(Boolean);
    return {
      unitTypeId,
      name: cfg.professionName,
      roleTag: cfg.roleTag,
      unitCategory: cfg.unitCategory,
      unitSubtype: cfg.unitSubtype,
      speed: roundTo(cfg.base.speed, 2),
      hp: Math.round(cfg.base.hp),
      atk: Math.round(cfg.base.atk),
      def: Math.round(cfg.base.def),
      attackRange: {
        min: roundTo(clamp(cfg.base.attackRange?.min, 0, 22), 2),
        max: roundTo(clamp(cfg.base.attackRange?.max, 1, 22), 2)
      },
      costKP: Math.max(1, Math.round(cfg.base.costKP)),
      level: tier,
      tier,
      enabled: true,
      rpsType: rpsTag,
      professionId: cfg.professionId,
      rarity: 'common',
      tags,
      description: cfg.description,
      bodyId: `body_${cfg.professionKey}`,
      weaponIds: [`weapon_${cfg.professionKey}`],
      vehicleId: cfg.vehicleId || null,
      behaviorProfileId: `behavior_${cfg.professionKey}`,
      stabilityProfileId: `stability_${cfg.professionKey}`,
      nextUnitTypeId: null,
      upgradeCostKP: null,
      sortOrder,
      visuals: {
        battle: {
          bodyLayer: layerSeed % 64,
          gearLayer: (layerSeed + 16) % 64,
          vehicleLayer: (layerSeed + 32) % 64,
          tint: roundTo(0.9 + (professionIndex * 0.02), 2),
          silhouetteLayer: (layerSeed + 48) % 64
        },
        preview: {
          style: 'procedural',
          palette: resolveUnitPalette(cfg.unitCategory, cfg.unitSubtype)
        }
      }
    };
  });
};

const dedupeByKey = (rows = [], keyName = '') => {
  const out = [];
  const seen = new Set();
  normalizeArray(rows).forEach((row) => {
    const key = typeof row?.[keyName] === 'string' ? row[keyName].trim() : '';
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(row);
  });
  return out;
};

const mergeComponents = (generated = [], patch = []) => {
  const merged = [...generated];
  const byId = new Map(generated.map((row) => [row.componentId, row]));
  normalizeArray(patch).forEach((row) => {
    const key = typeof row?.componentId === 'string' ? row.componentId.trim() : '';
    if (!key) return;
    if (byId.has(key)) {
      const old = byId.get(key);
      const next = { ...old, ...row, componentId: key };
      byId.set(key, next);
      const idx = merged.findIndex((item) => item.componentId === key);
      if (idx >= 0) merged[idx] = next;
      return;
    }
    byId.set(key, row);
    merged.push(row);
  });
  return dedupeByKey(merged, 'componentId');
};

const applyUnitPatch = (generated = [], patch = {}) => {
  const source = dedupeByKey(generated, 'unitTypeId');
  const byId = new Map(source.map((row) => [row.unitTypeId, row]));
  const patchRows = normalizeArray(patch?.unitTypes || patch?.rows || []);
  patchRows.forEach((row) => {
    const key = typeof row?.unitTypeId === 'string' ? row.unitTypeId.trim() : '';
    if (!key) return;
    if (byId.has(key)) {
      const merged = { ...byId.get(key), ...row, unitTypeId: key };
      merged.level = Math.max(1, Math.floor(Number(merged.tier || merged.level || 1)));
      merged.tier = merged.level;
      byId.set(key, merged);
      return;
    }
    const next = { ...row, unitTypeId: key };
    next.level = Math.max(1, Math.floor(Number(next.tier || next.level || 1)));
    next.tier = next.level;
    byId.set(key, next);
  });
  const removed = new Set(normalizeArray(patch?.removeUnitTypeIds).map((id) => String(id || '').trim()).filter(Boolean));
  const out = Array.from(byId.values()).filter((row) => !removed.has(row.unitTypeId));
  out.sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || a.unitTypeId.localeCompare(b.unitTypeId));
  return out;
};

const buildUnitCatalog = (seedPatch = {}) => {
  const baseComponents = [
    ...buildStaticComponents(),
    ...buildStabilityProfiles()
  ];
  const unitComponents = mergeComponents(baseComponents, seedPatch?.unitComponents);
  const unitTypes = applyUnitPatch(buildUnitTypes(), seedPatch?.unitTypesPatch || seedPatch);
  return {
    unitComponents,
    unitTypes
  };
};

module.exports = {
  RPS_TYPES,
  RPS_ADVANTAGE,
  UNIT_PALETTE_TONE_BY_SUBTYPE,
  UNIT_CATEGORY_PALETTES,
  UNIT_KNOWLEDGE_COST_KP,
  resolveUnitPalette,
  PROFESSION_CONFIG,
  buildUnitCatalog
};
