const RPS_TYPES = ['mobility', 'ranged', 'defense'];
const TIER_POWER = [1.0, 1.35, 1.8, 2.4];

const RPS_ADVANTAGE = {
  mobility: 'ranged',
  ranged: 'defense',
  defense: 'mobility'
};

const PROFESSION_CONFIG = [
  {
    rpsType: 'mobility',
    professionKey: 'rider',
    professionId: 'mob.rider',
    professionName: '轻骑突袭',
    roleTag: '近战',
    speedGrowth: 0.026,
    rangeGrowth: 0,
    base: { hp: 130, atk: 22, def: 6, speed: 4.8, range: 1, costKP: 14, cooldown: 1.05, accuracy: 0.85, impactPoise: 10, impactTransition: 12 },
    nameKeys: ['horse_raider', 'storm_lancer', 'iron_dragoon', 'sky_raider'],
    vehicles: ['veh_steed_horse', 'veh_moto_raid', 'veh_hover_bike', 'veh_flying_skiff']
  },
  {
    rpsType: 'mobility',
    professionKey: 'assault',
    professionId: 'mob.assault',
    professionName: '突击散兵',
    roleTag: '近战',
    speedGrowth: 0.023,
    rangeGrowth: 0.25,
    base: { hp: 110, atk: 24, def: 5, speed: 4.4, range: 2, costKP: 14, cooldown: 0.9, accuracy: 0.8, impactPoise: 12, impactTransition: 10 },
    nameKeys: ['rush_skirmisher', 'shock_reaver', 'blade_vanguard', 'jet_reaver'],
    vehicles: ['veh_jeep_top', 'veh_hover_skiff', 'veh_halftrack', 'veh_flying_skiff']
  },
  {
    rpsType: 'mobility',
    professionKey: 'skimmer',
    professionId: 'mob.skimmer',
    professionName: '快反轻车',
    roleTag: '远程',
    speedGrowth: 0.028,
    rangeGrowth: 0.6,
    base: { hp: 160, atk: 20, def: 8, speed: 5.1, range: 6, costKP: 16, cooldown: 0.75, accuracy: 0.65, impactPoise: 8, impactTransition: 8 },
    nameKeys: ['rapid_buggy', 'vector_skimmer', 'ion_skimmer', 'cyclone_skimmer'],
    vehicles: ['veh_buggy_inside', 'veh_hover_skiff', 'veh_missile_platform', 'veh_flying_skiff']
  },
  {
    rpsType: 'ranged',
    professionKey: 'marksman',
    professionId: 'rng.marksman',
    professionName: '精确射手',
    roleTag: '远程',
    speedGrowth: 0.018,
    rangeGrowth: 1,
    base: { hp: 95, atk: 18, def: 4, speed: 3.3, range: 11, costKP: 14, cooldown: 1.25, accuracy: 0.78, movePenaltyK: 0.3, impactPoise: 6, impactTransition: 10 },
    nameKeys: ['longshot', 'eagle_eye', 'wind_marksman', 'sky_marksman'],
    vehicles: ['veh_moto_raid', 'veh_jeep_top', 'veh_hover_skiff', 'veh_flying_skiff']
  },
  {
    rpsType: 'ranged',
    professionKey: 'support',
    professionId: 'rng.support',
    professionName: '压制支援',
    roleTag: '远程',
    speedGrowth: 0.017,
    rangeGrowth: 0.55,
    base: { hp: 115, atk: 16, def: 6, speed: 3.0, range: 9, costKP: 16, cooldown: 0.7, accuracy: 0.6, impactPoise: 14, impactTransition: 12 },
    nameKeys: ['suppressor', 'thunder_support', 'iron_support', 'nova_support'],
    vehicles: ['veh_halftrack', 'veh_mortar_car', 'veh_spg', 'veh_missile_platform']
  },
  {
    rpsType: 'ranged',
    professionKey: 'siege',
    professionId: 'rng.siege',
    professionName: '攻城火力',
    roleTag: '远程',
    speedGrowth: 0.015,
    rangeGrowth: 2,
    base: { hp: 140, atk: 14, def: 5, speed: 2.6, range: 15, costKP: 18, cooldown: 2.2, accuracy: 0.9, aoeRadius: 2.8, impactPoise: 10, impactTransition: 6 },
    nameKeys: ['stone_bomber', 'fort_breaker', 'thunder_siege', 'star_siege'],
    vehicles: ['veh_catapult', 'veh_mortar_car', 'veh_spg', 'veh_missile_platform']
  },
  {
    rpsType: 'defense',
    professionKey: 'shield',
    professionId: 'def.shield',
    professionName: '盾墙卫队',
    roleTag: '近战',
    speedGrowth: 0.012,
    rangeGrowth: 0,
    base: { hp: 170, atk: 18, def: 12, speed: 3.0, range: 1, costKP: 15, cooldown: 1.1, accuracy: 0.88, impactPoise: 10, impactTransition: 10 },
    nameKeys: ['shield_guard', 'iron_guard', 'tower_guard', 'aegis_guard'],
    vehicles: ['veh_steed_horse', 'veh_turtle_apc', 'veh_halftrack', 'veh_siege_walker']
  },
  {
    rpsType: 'defense',
    professionKey: 'pike',
    professionId: 'def.pike',
    professionName: '反机动长柄',
    roleTag: '近战',
    speedGrowth: 0.013,
    rangeGrowth: 0.35,
    base: { hp: 155, atk: 20, def: 10, speed: 3.1, range: 2, costKP: 15, cooldown: 1.0, accuracy: 0.86, impactPoise: 16, impactTransition: 14 },
    nameKeys: ['pike_line', 'steel_pike', 'fort_pike', 'sky_pike'],
    vehicles: ['veh_shield_cart', 'veh_turtle_apc', 'veh_halftrack', 'veh_bastion_drone']
  },
  {
    rpsType: 'defense',
    professionKey: 'bastion',
    professionId: 'def.bastion',
    professionName: '堡垒装甲',
    roleTag: '远程',
    speedGrowth: 0.011,
    rangeGrowth: 0.4,
    base: { hp: 220, atk: 16, def: 14, speed: 2.7, range: 5, costKP: 18, cooldown: 1.6, accuracy: 0.7, impactPoise: 12, impactTransition: 8 },
    nameKeys: ['fort_plating', 'iron_bastion', 'siege_plate', 'siege_walker'],
    vehicles: ['veh_turtle_apc', 'veh_halftrack', 'veh_siege_walker', 'veh_bastion_drone']
  }
];

const RARITY_BY_TIER = ['common', 'rare', 'epic', 'legend'];

const PREVIEW_PALETTE_BY_RPS = {
  mobility: { primary: '#4cb3ff', secondary: '#96def6', accent: '#ffd166' },
  ranged: { primary: '#8f7bff', secondary: '#c4b7ff', accent: '#70e4ff' },
  defense: { primary: '#4ca878', secondary: '#88d9b5', accent: '#f4d35e' }
};

const ABILITY_BY_PROFESSION = {
  'mob.rider': {
    id: 'ability_charge_line',
    name: '冲锋突刺',
    data: {
      cooldownSec: 8,
      targeting: 'line',
      delivery: 'dash',
      effects: { damageMul: 1.35, poiseDamageMul: 1.5, knockback: 1.2 },
      vfx: { kind: 'charge_arrow', color: '#ffd166' }
    }
  },
  'mob.assault': {
    id: 'ability_smoke_dash',
    name: '烟幕突进',
    data: {
      cooldownSec: 9.5,
      targeting: 'self',
      delivery: 'buff',
      effects: { evadeMul: 1.18, hitMulVsRanged: 1.12, speedMul: 1.24, durationSec: 5.5 },
      vfx: { kind: 'smoke_trail', color: '#b7c0cc' }
    }
  },
  'mob.skimmer': {
    id: 'ability_flank_boost',
    name: '侧翼推进',
    data: {
      cooldownSec: 8.2,
      targeting: 'self',
      delivery: 'buff',
      effects: { speedMul: 1.28, damageMulVsRanged: 1.16, durationSec: 6.2 },
      vfx: { kind: 'speed_ring', color: '#70e4ff' }
    }
  },
  'rng.marksman': {
    id: 'ability_focus_shot',
    name: '聚焦射击',
    data: {
      cooldownSec: 10,
      targeting: 'single',
      delivery: 'projectile',
      effects: { damageMul: 1.65, hitMul: 1.18, poiseDamageMul: 1.1 },
      vfx: { kind: 'focus_line', color: '#fef3c7' }
    }
  },
  'rng.support': {
    id: 'ability_suppress_fire',
    name: '压制火力',
    data: {
      cooldownSec: 11,
      targeting: 'cone',
      delivery: 'burst',
      effects: { poiseDamageMul: 1.4, transitionDamageMul: 1.35, speedMulDebuff: 0.8, durationSec: 4 },
      vfx: { kind: 'suppression_haze', color: '#dbeafe' }
    }
  },
  'rng.siege': {
    id: 'ability_barrage_aoe',
    name: '弹幕轰击',
    data: {
      cooldownSec: 14,
      targeting: 'ground_aoe',
      delivery: 'artillery',
      effects: { damageMul: 1.35, aoeRadius: 3.4, buildingDamageMul: 1.45 },
      vfx: { kind: 'barrage_circle', color: '#fb923c' }
    }
  },
  'def.shield': {
    id: 'ability_shieldwall',
    name: '盾墙',
    data: {
      cooldownSec: 12,
      targeting: 'self',
      delivery: 'stance',
      effects: { projectileBlockMul: 0.38, allyRearHitMul: 0.88, poiseMul: 1.2, durationSec: 6 },
      vfx: { kind: 'shield_arc', color: '#6ee7b7' }
    }
  },
  'def.pike': {
    id: 'ability_brace_vs_charge',
    name: '拒马列阵',
    data: {
      cooldownSec: 9,
      targeting: 'self',
      delivery: 'stance',
      effects: { poiseDamageVsMobilityMul: 1.45, poiseDamageVsChargeMul: 1.6, durationSec: 5.8 },
      vfx: { kind: 'brace_lines', color: '#93c5fd' }
    }
  },
  'def.bastion': {
    id: 'ability_bastion_stance',
    name: '堡垒姿态',
    data: {
      cooldownSec: 13,
      targeting: 'self',
      delivery: 'stance',
      effects: { defMul: 1.32, poiseMul: 1.35, turnRateMul: 0.72, transitionSpeedMul: 0.8, durationSec: 6.5 },
      vfx: { kind: 'bastion_aura', color: '#86efac' }
    }
  }
};

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
    order: ['mobility', 'ranged', 'defense'],
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
    tags: [cfg.rpsType, cfg.professionId],
    version: 1,
    data: {
      silhouette: cfg.professionKey,
      baseScale: cfg.rpsType === 'defense' ? 1.06 : (cfg.rpsType === 'mobility' ? 0.94 : 1),
      defaultPose: cfg.rpsType === 'ranged' ? 'aim' : 'combat'
    }
  }));

  const weaponComponents = PROFESSION_CONFIG.map((cfg) => ({
    componentId: `weapon_${cfg.professionKey}`,
    kind: 'weapon',
    name: `${cfg.professionName}主武器`,
    tags: [cfg.rpsType, cfg.professionId],
    version: 1,
    data: {
      cooldownSec: Number(cfg.base.cooldown) || 1,
      accuracy: Number(cfg.base.accuracy) || 0.8,
      range: Number(cfg.base.range) || 1,
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
    { id: 'veh_bastion_drone', name: '堡垒浮空台', seatMode: 'top', isFlying: true, hasWeapon: true }
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

  const abilityComponents = Object.entries(ABILITY_BY_PROFESSION).map(([professionId, ability]) => ({
    componentId: ability.id,
    kind: 'ability',
    name: ability.name,
    tags: [professionId, 'active_skill'],
    version: 1,
    data: ability.data
  }));

  const behaviorProfiles = PROFESSION_CONFIG.map((cfg) => ({
    componentId: `behavior_${cfg.professionKey}`,
    kind: 'behaviorProfile',
    name: `${cfg.professionName}行为模板`,
    tags: [cfg.rpsType, cfg.professionId],
    version: 1,
    data: {
      transitionSec: {
        moveToAttack: cfg.rpsType === 'mobility' ? 0.24 : 0.32,
        attackToMove: cfg.rpsType === 'mobility' ? 0.2 : 0.3,
        forwardToRetreat: cfg.rpsType === 'defense' ? 0.46 : 0.35,
        retreatToForward: cfg.rpsType === 'defense' ? 0.48 : 0.36
      },
      guardRadiusMul: cfg.rpsType === 'ranged' ? 1.25 : 1,
      chaseRadiusMul: cfg.rpsType === 'mobility' ? 1.35 : 1.05,
      turnRateMul: cfg.rpsType === 'defense' ? 0.86 : 1.08
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
    ...abilityComponents,
    ...behaviorProfiles,
    ...staggerReactions,
    buildRpsRuleComponent()
  ];
};

const buildStabilityProfiles = () => {
  const rows = [];
  RPS_TYPES.forEach((rpsType) => {
    for (let tier = 1; tier <= 4; tier += 1) {
      const p = TIER_POWER[tier - 1];
      const poiseBase = rpsType === 'defense' ? 120 : (rpsType === 'mobility' ? 96 : 84);
      const transitionBase = rpsType === 'defense' ? 95 : (rpsType === 'mobility' ? 88 : 82);
      const chargeBase = rpsType === 'mobility' ? 150 : (rpsType === 'defense' ? 128 : 108);
      rows.push({
        componentId: `stable_${rpsType}_t${tier}`,
        kind: 'stabilityProfile',
        name: `${rpsType} T${tier}稳定性`,
        tags: [rpsType, `tier_${tier}`],
        version: 1,
        data: {
          poiseMax: Math.round(poiseBase * p),
          chargePoise: Math.round(chargeBase * p),
          transitionMax: Math.round(transitionBase * p),
          poiseRegenPerSec: roundTo(6 + (tier * 0.9), 2),
          transitionDecayPerSec: roundTo(3.8 + (tier * 0.45), 2),
          transitionRegenPerSec: roundTo(2.2 + (tier * 0.3), 2)
        }
      });
    }
  });
  return rows;
};

const buildUnitTypes = () => {
  const unitTypes = [];
  PROFESSION_CONFIG.forEach((cfg, professionIndex) => {
    for (let tier = 1; tier <= 4; tier += 1) {
      const tierIdx = tier - 1;
      const p = TIER_POWER[tierIdx];
      const idName = cfg.nameKeys[tierIdx] || `${cfg.professionKey}_${tier}`;
      const unitTypeId = `u_${cfg.rpsType.slice(0, 3)}_${cfg.professionKey}_t${tier}_${idName}`;
      const hp = Math.round(cfg.base.hp * p);
      const atk = Math.round(cfg.base.atk * p);
      const def = Math.round(cfg.base.def * p);
      const speedGrowth = Number.isFinite(cfg.speedGrowth) ? cfg.speedGrowth : 0.02;
      const speed = roundTo(cfg.base.speed * (1 + (speedGrowth * tierIdx)), 2);
      const rangeGrowth = Number.isFinite(cfg.rangeGrowth) ? cfg.rangeGrowth : 0;
      const rawRange = cfg.base.range + (rangeGrowth * tierIdx);
      const rangeCap = cfg.professionKey === 'siege' ? 22 : (cfg.professionKey === 'marksman' ? 16 : 10);
      const range = roundTo(clamp(rawRange, 1, rangeCap), 2);
      let cost = Math.round(cfg.base.costKP * p);
      if (cfg.professionKey === 'siege' || cfg.professionKey === 'bastion') {
        cost = Math.round(cost * 1.05);
      }

      const ability = ABILITY_BY_PROFESSION[cfg.professionId];
      const sortOrder = (professionIndex * 4) + tierIdx;
      const layerSeed = sortOrder;
      const bodyLayer = layerSeed % 64;
      const gearLayer = (layerSeed + 16) % 64;
      const vehicleLayer = (layerSeed + 32) % 64;
      const silhouetteLayer = (layerSeed + 48) % 64;
      const palette = PREVIEW_PALETTE_BY_RPS[cfg.rpsType] || PREVIEW_PALETTE_BY_RPS.mobility;
      const rpsTag = cfg.rpsType;
      const tags = [
        'unit_type',
        rpsTag,
        cfg.professionId,
        `tier_${tier}`,
        RPS_ADVANTAGE[rpsTag] ? `counter_${RPS_ADVANTAGE[rpsTag]}` : ''
      ].filter(Boolean);
      unitTypes.push({
        unitTypeId,
        name: `${cfg.professionName}·${tier}阶`,
        roleTag: cfg.roleTag,
        speed,
        hp,
        atk,
        def,
        range,
        costKP: cost,
        level: tier,
        tier,
        enabled: true,
        rpsType: cfg.rpsType,
        professionId: cfg.professionId,
        rarity: RARITY_BY_TIER[tierIdx] || 'common',
        tags,
        description: `${cfg.professionName}（${cfg.rpsType}）第${tier}阶单位。机动:${speed} 射程:${range}。`,
        bodyId: `body_${cfg.professionKey}`,
        weaponIds: [`weapon_${cfg.professionKey}`],
        vehicleId: cfg.vehicles[tierIdx] || null,
        abilityIds: ability ? [ability.id] : [],
        behaviorProfileId: `behavior_${cfg.professionKey}`,
        stabilityProfileId: `stable_${cfg.rpsType}_t${tier}`,
        nextUnitTypeId: null,
        upgradeCostKP: null,
        sortOrder,
        visuals: {
          battle: {
            bodyLayer,
            gearLayer,
            vehicleLayer,
            tint: roundTo(0.82 + (tierIdx * 0.07), 2),
            silhouetteLayer
          },
          preview: {
            style: 'procedural',
            palette
          }
        }
      });
    }
  });

  const byProfession = new Map();
  unitTypes.forEach((item) => {
    const list = byProfession.get(item.professionId) || [];
    list.push(item);
    byProfession.set(item.professionId, list);
  });
  byProfession.forEach((rows) => {
    rows.sort((a, b) => a.tier - b.tier);
    for (let i = 0; i < rows.length; i += 1) {
      const current = rows[i];
      const next = rows[i + 1];
      current.nextUnitTypeId = next ? next.unitTypeId : null;
      current.upgradeCostKP = next ? Math.max(1, next.costKP - current.costKP) : null;
    }
  });

  return unitTypes;
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
  TIER_POWER,
  RPS_ADVANTAGE,
  PROFESSION_CONFIG,
  buildUnitCatalog
};
