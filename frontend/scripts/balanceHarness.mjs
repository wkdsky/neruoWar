import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { buildUnitCatalog } = require('../../backend/seed/unitCatalogFactory');

const RPS_ADV = {
  mobility: 'ranged',
  ranged: 'defense',
  defense: 'mobility'
};

const RPS_MUL = {
  advantage: { damageMul: 1.2, poiseDamageMul: 1.25, hitMul: 1.08 },
  disadvantage: { damageMul: 0.85, poiseDamageMul: 0.85, hitMul: 0.92 },
  neutral: { damageMul: 1, poiseDamageMul: 1, hitMul: 1 }
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const getRpsMul = (atkType, defType) => {
  if (atkType === defType) return RPS_MUL.neutral;
  if (RPS_ADV[atkType] === defType) return RPS_MUL.advantage;
  if (RPS_ADV[defType] === atkType) return RPS_MUL.disadvantage;
  return RPS_MUL.neutral;
};

const createRng = (seed = 20260302) => {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
};

const buildCatalog = () => {
  const { unitTypes, unitComponents } = buildUnitCatalog({});
  const componentMap = new Map(unitComponents.map((c) => [c.componentId, c]));
  const units = unitTypes.map((unit) => {
    const weapon = componentMap.get(unit.weaponIds?.[0] || '');
    const stability = componentMap.get(unit.stabilityProfileId || '');
    const stagger = componentMap.get('stagger_medium');
    return {
      ...unit,
      weaponData: weapon?.data || {},
      stabilityData: stability?.data || {},
      staggerData: stagger?.data?.durationSec || { light: 0.35, medium: 0.58, heavy: 0.8, knockdown: 1.1 }
    };
  });
  return units;
};

const toEngageRange = (unit = {}) => {
  const raw = Math.max(1, Number(unit?.range) || 1);
  if (raw <= 2.2) return 6 + (raw * 1.8);
  return 22 + (raw * 4.8);
};

const toMoveSpeed = (unit = {}) => Math.max(0.6, (Number(unit?.speed) || 1) * 3.6);

const resolveMoveIntent = (selfRange, enemyRange, distance, fireRange) => {
  if (distance > fireRange * 1.02) return 1; // close in to fire
  if (selfRange > enemyRange + 5) {
    if (distance < fireRange * 0.8) return -1; // kite when too close
    return 0;
  }
  if (selfRange + 1.5 < enemyRange && distance > 3) return 1;
  return 0;
};

const simulateDuel = (unitA, unitB, rounds = 120, seed = 20260302) => {
  const rng = createRng(seed + rounds + unitA.unitTypeId.length + unitB.unitTypeId.length);
  let winsA = 0;
  let totalTtk = 0;
  let totalPoiseBreaks = 0;
  let totalTransitionBreaks = 0;

  for (let round = 0; round < rounds; round += 1) {
    const dt = 0.2;
    let t = 0;
    let hpA = Number(unitA.hp) || 1;
    let hpB = Number(unitB.hp) || 1;
    let cdA = 0;
    let cdB = 0;
    let staggerA = 0;
    let staggerB = 0;
    let transitionA = 0.25 + ((Number(unitA.tier) || 1) * 0.04);
    let transitionB = 0.25 + ((Number(unitB.tier) || 1) * 0.04);
    let poiseA = Number(unitA.stabilityData?.poiseMax) || 100;
    let poiseB = Number(unitB.stabilityData?.poiseMax) || 100;
    const poiseMaxA = poiseA;
    const poiseMaxB = poiseB;
    const poiseRegenA = Number(unitA.stabilityData?.poiseRegenPerSec) || 6;
    const poiseRegenB = Number(unitB.stabilityData?.poiseRegenPerSec) || 6;
    const rangeA = toEngageRange(unitA);
    const rangeB = toEngageRange(unitB);
    const moveSpeedA = toMoveSpeed(unitA);
    const moveSpeedB = toMoveSpeed(unitB);
    let distance = clamp(Math.max(rangeA, rangeB) * 1.15, 18, 140);

    while (t < 180 && hpA > 0 && hpB > 0) {
      t += dt;
      cdA = Math.max(0, cdA - dt);
      cdB = Math.max(0, cdB - dt);
      staggerA = Math.max(0, staggerA - dt);
      staggerB = Math.max(0, staggerB - dt);
      transitionA = Math.max(0, transitionA - dt);
      transitionB = Math.max(0, transitionB - dt);
      poiseA = clamp(poiseA + (poiseRegenA * dt), 0, poiseMaxA);
      poiseB = clamp(poiseB + (poiseRegenB * dt), 0, poiseMaxB);

      const mulA = getRpsMul(unitA.rpsType, unitB.rpsType);
      const mulB = getRpsMul(unitB.rpsType, unitA.rpsType);
      const baseHitA = clamp(Number(unitA.weaponData?.accuracy) || 0.8, 0.35, 0.98);
      const baseHitB = clamp(Number(unitB.weaponData?.accuracy) || 0.8, 0.35, 0.98);
      const cooldownA = Math.max(0.35, Number(unitA.weaponData?.cooldownSec) || 1.1);
      const cooldownB = Math.max(0.35, Number(unitB.weaponData?.cooldownSec) || 1.1);
      const impactPoiseA = Math.max(3, Number(unitA.weaponData?.impact?.poise) || 8);
      const impactPoiseB = Math.max(3, Number(unitB.weaponData?.impact?.poise) || 8);
      const impactTransitionA = Math.max(3, Number(unitA.weaponData?.impact?.transition) || 8);
      const impactTransitionB = Math.max(3, Number(unitB.weaponData?.impact?.transition) || 8);

      const canFireA = distance <= rangeA;
      const canFireB = distance <= rangeB;
      const moveIntentA = (staggerA <= 0) ? resolveMoveIntent(rangeA, rangeB, distance, rangeA) : 0;
      const moveIntentB = (staggerB <= 0) ? resolveMoveIntent(rangeB, rangeA, distance, rangeB) : 0;
      const moveA = moveIntentA !== 0 ? moveSpeedA : 0;
      const moveB = moveIntentB !== 0 ? moveSpeedB : 0;
      distance = clamp(distance + ((-moveIntentA * moveA - moveIntentB * moveB) * dt), 0.6, 200);

      if (staggerA <= 0 && cdA <= 0) {
        const hitRoll = rng();
        const movePenaltyK = clamp(Number(unitA.weaponData?.movePenaltyK) || 0.2, 0, 0.55);
        const movingPenalty = (moveIntentA !== 0 && canFireA) ? (1 - movePenaltyK) : 1;
        const rangePressure = clamp((rangeA - distance + 8) / Math.max(8, rangeA), 0.7, 1.08);
        const hitChance = clamp(baseHitA * mulA.hitMul * movingPenalty * rangePressure, 0.2, 1);
        if (canFireA && hitRoll <= hitChance) {
          const armorA = 1 + ((Number(unitB.def) || 0) * 0.03);
          const rangeAdv = rangeA > rangeB + 4 ? 1 : 0;
          const bypassA = (mulA.damageMul > 1 ? 0.22 : 0) + (rangeAdv ? 0.08 : 0);
          const damage = Math.max(0.5, ((Number(unitA.atk) || 1) * 0.42) * (mulA.damageMul) / Math.max(0.66, armorA * (1 - bypassA)));
          hpB -= damage;
          const poiseDamage = impactPoiseA * 0.22 * mulA.poiseDamageMul;
          poiseB = Math.max(0, poiseB - poiseDamage);
          if (transitionB > 0) {
            transitionB = Math.max(0, transitionB - (impactTransitionA * 0.04 * mulA.poiseDamageMul));
            if (transitionB <= 0.0001) totalTransitionBreaks += 1;
          }
          if (poiseB <= 0.0001) {
            const severity = poiseDamage > (poiseMaxB * 0.28) ? 'heavy' : 'medium';
            staggerB = Math.max(staggerB, Number(unitB.staggerData?.[severity]) || 0.58);
            poiseB = poiseMaxB * (severity === 'heavy' ? 0.2 : 0.36);
            totalPoiseBreaks += 1;
          }
        }
        cdA = cooldownA;
      }

      if (staggerB <= 0 && cdB <= 0 && hpB > 0) {
        const hitRoll = rng();
        const movePenaltyK = clamp(Number(unitB.weaponData?.movePenaltyK) || 0.2, 0, 0.55);
        const movingPenalty = (moveIntentB !== 0 && canFireB) ? (1 - movePenaltyK) : 1;
        const rangePressure = clamp((rangeB - distance + 8) / Math.max(8, rangeB), 0.7, 1.08);
        const hitChance = clamp(baseHitB * mulB.hitMul * movingPenalty * rangePressure, 0.2, 1);
        if (canFireB && hitRoll <= hitChance) {
          const armorB = 1 + ((Number(unitA.def) || 0) * 0.03);
          const rangeAdv = rangeB > rangeA + 4 ? 1 : 0;
          const bypassB = (mulB.damageMul > 1 ? 0.22 : 0) + (rangeAdv ? 0.08 : 0);
          const damage = Math.max(0.5, ((Number(unitB.atk) || 1) * 0.42) * (mulB.damageMul) / Math.max(0.66, armorB * (1 - bypassB)));
          hpA -= damage;
          const poiseDamage = impactPoiseB * 0.22 * mulB.poiseDamageMul;
          poiseA = Math.max(0, poiseA - poiseDamage);
          if (transitionA > 0) {
            transitionA = Math.max(0, transitionA - (impactTransitionB * 0.04 * mulB.poiseDamageMul));
            if (transitionA <= 0.0001) totalTransitionBreaks += 1;
          }
          if (poiseA <= 0.0001) {
            const severity = poiseDamage > (poiseMaxA * 0.28) ? 'heavy' : 'medium';
            staggerA = Math.max(staggerA, Number(unitA.staggerData?.[severity]) || 0.58);
            poiseA = poiseMaxA * (severity === 'heavy' ? 0.2 : 0.36);
            totalPoiseBreaks += 1;
          }
        }
        cdB = cooldownB;
      }
    }

    if (hpA > hpB) winsA += 1;
    totalTtk += t;
  }

  return {
    winsA,
    rounds,
    winRateA: winsA / Math.max(1, rounds),
    avgTtkSec: totalTtk / Math.max(1, rounds),
    poiseBreakFreq: totalPoiseBreaks / Math.max(1, rounds),
    transitionBreakFreq: totalTransitionBreaks / Math.max(1, rounds)
  };
};

const run = () => {
  const units = buildCatalog();
  const byProfession = new Map();
  units.forEach((unit) => {
    const key = unit.professionId;
    const list = byProfession.get(key) || [];
    list.push(unit);
    byProfession.set(key, list);
  });
  byProfession.forEach((rows) => rows.sort((a, b) => (a.tier || 1) - (b.tier || 1)));

  const tierChecks = [];
  byProfession.forEach((rows, professionId) => {
    for (let i = 0; i < rows.length - 1; i += 1) {
      const lower = rows[i];
      const higher = rows[i + 1];
      const duel = simulateDuel(higher, lower, 140, 20260302 + i);
      tierChecks.push({
        professionId,
        pair: `T${lower.tier} -> T${higher.tier}`,
        winRate: duel.winRateA,
        pass: duel.winRateA >= 0.75
      });
    }
  });

  const rpsChecks = [];
  const tiers = [1, 2, 3, 4];
  const avgMatchupWinRate = (attackers, defenders, seedBase) => {
    if (!attackers.length || !defenders.length) return 0;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < attackers.length; i += 1) {
      for (let j = 0; j < defenders.length; j += 1) {
        const duel = simulateDuel(attackers[i], defenders[j], 100, seedBase + (i * 17) + (j * 23));
        sum += duel.winRateA;
        count += 1;
      }
    }
    return sum / Math.max(1, count);
  };
  tiers.forEach((tier) => {
    const group = units.filter((u) => Number(u.tier) === tier);
    const mob = group.filter((u) => u.rpsType === 'mobility');
    const rng = group.filter((u) => u.rpsType === 'ranged');
    const def = group.filter((u) => u.rpsType === 'defense');
    if (!mob.length || !rng.length || !def.length) return;
    rpsChecks.push({
      tier,
      matchup: 'mobility > ranged',
      winRate: avgMatchupWinRate(mob, rng, 9900 + tier)
    });
    rpsChecks.push({
      tier,
      matchup: 'ranged > defense',
      winRate: avgMatchupWinRate(rng, def, 11200 + tier)
    });
    rpsChecks.push({
      tier,
      matchup: 'defense > mobility',
      winRate: avgMatchupWinRate(def, mob, 12900 + tier)
    });
  });

  const samplePairs = [
    [units[0], units[8]],
    [units[12], units[20]],
    [units[28], units[4]]
  ].filter((pair) => pair[0] && pair[1]);
  let sumTtk = 0;
  let sumPoise = 0;
  let sumTransition = 0;
  samplePairs.forEach((pair, idx) => {
    const duel = simulateDuel(pair[0], pair[1], 180, 31000 + idx);
    sumTtk += duel.avgTtkSec;
    sumPoise += duel.poiseBreakFreq;
    sumTransition += duel.transitionBreakFreq;
  });
  const avgTtk = sumTtk / Math.max(1, samplePairs.length);
  const avgPoiseBreak = sumPoise / Math.max(1, samplePairs.length);
  const avgTransitionBreak = sumTransition / Math.max(1, samplePairs.length);

  const lines = [];
  lines.push('# Unit Balance Report');
  lines.push('');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push(`Unit count: ${units.length}`);
  lines.push('');
  lines.push('## 1) 同 profession：tier+1 vs tier 胜率 >= 0.75');
  lines.push('');
  lines.push('| profession | pair | winRate | pass |');
  lines.push('|---|---:|---:|---:|');
  tierChecks.forEach((row) => {
    lines.push(`| ${row.professionId} | ${row.pair} | ${(row.winRate * 100).toFixed(1)}% | ${row.pass ? '✅' : '❌'} |`);
  });
  lines.push('');
  lines.push('## 2) 同 tier：RPS 环胜率 >= 0.6');
  lines.push('');
  lines.push('| tier | matchup | winRate | pass |');
  lines.push('|---:|---|---:|---:|');
  rpsChecks.forEach((row) => {
    lines.push(`| ${row.tier} | ${row.matchup} | ${(row.winRate * 100).toFixed(1)}% | ${row.winRate >= 0.6 ? '✅' : '❌'} |`);
  });
  lines.push('');
  lines.push('## 3) 汇总指标');
  lines.push('');
  lines.push(`- Average TTK: ${avgTtk.toFixed(2)}s`);
  lines.push(`- Poise break frequency: ${avgPoiseBreak.toFixed(2)} / round`);
  lines.push(`- Transition interrupt frequency: ${avgTransitionBreak.toFixed(2)} / round`);
  lines.push('');

  const reportPath = path.resolve(__dirname, '../../docs/unit_balance_report.md');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Balance report written: ${reportPath}`);
};

run();
