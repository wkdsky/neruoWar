import {
  isInsideCollider
} from '../crowd/crowdPhysics';
import {
  applyDamageToAgent,
  applySquadStabilityHit,
  triggerSquadStagger
} from '../crowd/crowdCombat';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const toArray = (value) => (Array.isArray(value) ? value : (value ? [value] : []));

const matchesSelectorValue = (value, selectorValue) => {
  if (selectorValue === null || selectorValue === undefined || selectorValue === '') return true;
  const source = toArray(selectorValue).map((row) => String(row || '').trim()).filter(Boolean);
  if (source.length <= 0) return true;
  return source.includes(String(value || '').trim());
};

const matchesSelectorTags = (squadTags = [], selector = {}) => {
  const tags = Array.isArray(squadTags) ? squadTags.map((tag) => String(tag || '').trim()).filter(Boolean) : [];
  if (Array.isArray(selector?.tags) && selector.tags.length > 0) {
    const required = selector.tags.map((tag) => String(tag || '').trim()).filter(Boolean);
    if (required.length > 0 && !required.some((tag) => tags.includes(tag))) return false;
  }
  const any = toArray(selector?.tagsAny).map((tag) => String(tag || '').trim()).filter(Boolean);
  if (any.length > 0 && !any.some((tag) => tags.includes(tag))) return false;
  const all = toArray(selector?.tagsAll).map((tag) => String(tag || '').trim()).filter(Boolean);
  if (all.length > 0 && !all.every((tag) => tags.includes(tag))) return false;
  const exclude = toArray(selector?.tagsExclude).map((tag) => String(tag || '').trim()).filter(Boolean);
  if (exclude.length > 0 && exclude.some((tag) => tags.includes(tag))) return false;
  return true;
};

const matchesSelector = (squad = {}, selector = {}) => {
  if (!selector || typeof selector !== 'object') return true;
  if (!matchesSelectorValue(squad?.team, selector?.team)) return false;
  if (!matchesSelectorValue(squad?.team, selector?.teamAny)) return false;
  if (!matchesSelectorValue(squad?.classTag, selector?.classTag)) return false;
  if (!matchesSelectorValue(squad?.classTag, selector?.classTagAny)) return false;
  if (!matchesSelectorValue(squad?.rpsType, selector?.rpsType)) return false;
  if (!matchesSelectorValue(squad?.rpsType, selector?.rpsTypeAny)) return false;
  if (!matchesSelectorTags(squad?.tags, selector)) return false;
  return true;
};

const getItemContactRadius = (item = {}) => {
  const parts = Array.isArray(item?.colliderParts) ? item.colliderParts : [];
  if (parts.length <= 0) return Math.max(8, Math.max(Number(item?.width) || 0, Number(item?.depth) || 0) * 0.55);
  let best = 6;
  parts.forEach((part) => {
    const offset = Math.hypot(Number(part?.cx) || 0, Number(part?.cy) || 0);
    const span = Math.max(Number(part?.w) || 0, Number(part?.d) || 0) * 0.55;
    best = Math.max(best, offset + span);
  });
  return best;
};

const buildObstacleSpatialHash = (items = [], cellSize = 26) => {
  const size = Math.max(6, Number(cellSize) || 26);
  const map = new Map();
  items.forEach((item) => {
    const parts = Array.isArray(item?.colliderParts) && item.colliderParts.length > 0
      ? item.colliderParts
      : [{
        cx: Number(item?.x) || 0,
        cy: Number(item?.y) || 0,
        w: Math.max(4, Number(item?.width) || 4),
        d: Math.max(4, Number(item?.depth) || 4)
    }];
    parts.forEach((part) => {
      const hw = Math.max(1, Number(part?.w) || 1) * 0.5;
      const hd = Math.max(1, Number(part?.d) || 1) * 0.5;
      const rad = (Number(part?.yawDeg) || 0) * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const ex = (Math.abs(cos) * hw) + (Math.abs(sin) * hd);
      const ey = (Math.abs(sin) * hw) + (Math.abs(cos) * hd);
      const minX = (Number(part?.cx) || 0) - ex;
      const maxX = (Number(part?.cx) || 0) + ex;
      const minY = (Number(part?.cy) || 0) - ey;
      const maxY = (Number(part?.cy) || 0) + ey;
      const ix0 = Math.floor(minX / size);
      const ix1 = Math.floor(maxX / size);
      const iy0 = Math.floor(minY / size);
      const iy1 = Math.floor(maxY / size);
      for (let ix = ix0; ix <= ix1; ix += 1) {
        for (let iy = iy0; iy <= iy1; iy += 1) {
          const key = `${ix}:${iy}`;
          if (!map.has(key)) map.set(key, new Set());
          map.get(key).add(item.id);
        }
      }
    });
  });
  return { size, map };
};

const queryNearbyItems = (hash, itemById, x, y, radius = 20) => {
  const size = Math.max(6, Number(hash?.size) || 26);
  const map = hash?.map instanceof Map ? hash.map : new Map();
  const range = Math.max(1, Math.ceil((Math.max(1, Number(radius) || 1)) / size));
  const cx = Math.floor((Number(x) || 0) / size);
  const cy = Math.floor((Number(y) || 0) / size);
  const seen = new Set();
  const out = [];
  for (let ix = -range; ix <= range; ix += 1) {
    for (let iy = -range; iy <= range; iy += 1) {
      const key = `${cx + ix}:${cy + iy}`;
      const rows = map.get(key);
      if (!rows) continue;
      rows.forEach((itemId) => {
        if (seen.has(itemId)) return;
        seen.add(itemId);
        const row = itemById.get(itemId);
        if (row) out.push(row);
      });
    }
  }
  return out;
};

const getSquadAnchorAgent = (crowd, squadId) => {
  const agents = crowd?.agentsBySquad?.get(squadId) || [];
  if (!Array.isArray(agents) || agents.length <= 0) return null;
  for (let i = 0; i < agents.length; i += 1) {
    if (agents[i] && !agents[i].dead) return agents[i];
  }
  return null;
};

const scaleDamageBySelector = (baseDamage, squad, params = {}) => {
  const classMul = Number(params?.classMultiplier?.[squad?.classTag]) || 1;
  const rpsMul = Number(params?.rpsMultiplier?.[squad?.rpsType]) || 1;
  return Math.max(0, Number(baseDamage) || 0) * classMul * rpsMul;
};

const applyItemDamage = (sim, crowd, squad, item, damage, hitType = 'hit') => {
  const safeDamage = Math.max(0, Number(damage) || 0);
  if (safeDamage <= 0.001) return 0;
  const targetAgent = getSquadAnchorAgent(crowd, squad?.id);
  if (!targetAgent) {
    squad.health = Math.max(0, (Number(squad?.health) || 0) - safeDamage);
    squad.remain = Math.max(0, Number(squad?.remain) || 0);
    return safeDamage;
  }
  applyDamageToAgent(
    sim,
    crowd,
    { squadId: `item_${item?.id || 'env'}`, team: squad?.team === 'attacker' ? 'defender' : 'attacker' },
    targetAgent,
    safeDamage,
    hitType,
    { poiseDamageMul: 0.25 }
  );
  return safeDamage;
};

const shouldRevealHiddenSquad = (squad, enemySquads = [], baseRevealRadius = 2.2) => {
  const revealRadius = Math.max(0.5, Number(baseRevealRadius) || 2.2);
  for (let i = 0; i < enemySquads.length; i += 1) {
    const enemy = enemySquads[i];
    if (!enemy || enemy.remain <= 0) continue;
    const dist = Math.hypot((Number(enemy.x) || 0) - (Number(squad.x) || 0), (Number(enemy.y) || 0) - (Number(squad.y) || 0));
    if (dist <= revealRadius) return true;
  }
  return false;
};

const buildContactKey = (squadId, itemId, kind) => `${squadId}|${itemId}|${kind}`;
const buildPseudoAttacker = (squad = {}, item = {}, params = {}) => ({
  id: `item_source_${item?.id || 'env'}`,
  team: squad?.team === 'attacker' ? 'defender' : 'attacker',
  classTag: typeof params?.sourceClassTag === 'string' ? params.sourceClassTag : 'infantry',
  rpsType: typeof params?.sourceRpsType === 'string' ? params.sourceRpsType : 'mobility',
  stats: {
    atk: Math.max(6, Number(params?.sourceAtk) || 14)
  }
});

const step = (sim, crowd, dt) => {
  if (!sim || !crowd) return;
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  const items = (Array.isArray(sim?.buildings) ? sim.buildings : [])
    .filter((item) => item && !item.destroyed && Array.isArray(item?.interactions) && item.interactions.length > 0)
    .map((item) => ({
      ...item,
      interactionRadius: getItemContactRadius(item)
    }));
  if (items.length <= 0) {
    squads.forEach((squad) => {
      if (!squad) return;
      squad.hiddenFromAttacker = false;
      squad.hiddenFromDefender = false;
    });
    return;
  }

  if (!sim.itemInteractionState || typeof sim.itemInteractionState !== 'object') {
    sim.itemInteractionState = {
      contacts: new Map()
    };
  }
  const contacts = sim.itemInteractionState.contacts instanceof Map
    ? sim.itemInteractionState.contacts
    : new Map();
  sim.itemInteractionState.contacts = contacts;

  const spatialHash = buildObstacleSpatialHash(items, 26);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const nowSec = Number(sim?.timeElapsed) || 0;
  const touchedKeys = new Set();

  const concealedSquadSet = new Set();
  const concealmentRevealRadiusBySquad = new Map();
  const revealBonusBySquad = new Map();

  squads.forEach((squad) => {
    if (!squad || (Number(squad?.remain) || 0) <= 0) return;
    const center = { x: Number(squad.x) || 0, y: Number(squad.y) || 0 };
    const nearbyItems = queryNearbyItems(
      spatialHash,
      itemById,
      center.x,
      center.y,
      Math.max(8, Number(squad?.radius) || 10) + 26
    );
    nearbyItems.forEach((item) => {
      const isInside = isInsideCollider(center, item, Math.max(0.2, (Number(squad?.radius) || 2) * 0.22));
      const interactions = Array.isArray(item?.interactions) ? item.interactions : [];
      interactions.forEach((interaction) => {
        const kind = typeof interaction?.kind === 'string' ? interaction.kind : '';
        if (!kind) return;
        if (!matchesSelector(squad, interaction?.selector || {})) return;
        const key = buildContactKey(squad.id, item.id, kind);
        touchedKeys.add(key);
        const prev = contacts.get(key) || {
          inside: false,
          nextTickAt: nowSec,
          nextTriggerAt: 0,
          touchedAt: nowSec
        };
        prev.touchedAt = nowSec;

        if (kind === 'concealment') {
          if (isInside) {
            concealedSquadSet.add(squad.id);
            const revealRadius = Math.max(1.2, Number(interaction?.params?.revealRadius) || 2.2);
            concealmentRevealRadiusBySquad.set(squad.id, Math.max(concealmentRevealRadiusBySquad.get(squad.id) || 0, revealRadius));
          }
          prev.inside = isInside;
          contacts.set(key, prev);
          return;
        }

        if (kind === 'trapStagger' || kind === 'trap') {
          const params = interaction?.params || {};
          const cooldownSec = Math.max(0.1, Number(interaction?.params?.cooldownSec) || 8.6);
          if (isInside && nowSec >= (Number(prev.nextTriggerAt) || 0)) {
            const hpDamage = scaleDamageBySelector(params?.hpDamage ?? 8, squad, params);
            applyItemDamage(sim, crowd, squad, item, hpDamage, 'hit');
            const pseudoAttacker = buildPseudoAttacker(squad, item, params);
            const poiseDamage = scaleDamageBySelector(params?.poiseDamage ?? 90, squad, params);
            applySquadStabilityHit(
              squad,
              pseudoAttacker,
              poiseDamage,
              {
                poiseDamageMul: Math.max(0.1, Number(params?.poiseDamageMul) || 1.2)
              }
            );
            const staggerTier = interaction?.params?.staggerTier === 'heavy' ? 'heavy' : 'medium';
            triggerSquadStagger(squad, staggerTier);
            prev.nextTriggerAt = nowSec + cooldownSec;
          }
          prev.inside = isInside;
          contacts.set(key, prev);
          return;
        }

        if (kind === 'contactDot') {
          const tickIntervalSec = Math.max(0.1, Number(interaction?.params?.tickIntervalSec) || 1);
          const enterDamage = scaleDamageBySelector(interaction?.params?.hpDamageEnter ?? 8, squad, interaction?.params || {});
          const tickDamage = scaleDamageBySelector(interaction?.params?.hpDamageTick ?? 5, squad, interaction?.params || {});
          if (isInside && !prev.inside) {
            applyItemDamage(sim, crowd, squad, item, enterDamage, 'hit');
            prev.nextTickAt = nowSec + tickIntervalSec;
          } else if (isInside && nowSec >= (Number(prev.nextTickAt) || 0)) {
            applyItemDamage(sim, crowd, squad, item, tickDamage, 'hit');
            prev.nextTickAt = nowSec + tickIntervalSec;
          }
          prev.inside = isInside;
          contacts.set(key, prev);
          return;
        }

        if (kind === 'spotterAura' || kind === 'auraReveal') {
          if (isInside) {
            const bonus = Math.max(0, Number(interaction?.params?.revealBonusRadius ?? interaction?.params?.revealRadiusBonus) || 0);
            if (bonus > 0) {
              revealBonusBySquad.set(squad.id, Math.max(revealBonusBySquad.get(squad.id) || 0, bonus));
            }
          }
          prev.inside = isInside;
          contacts.set(key, prev);
          return;
        }
      });
    });
  });

  Array.from(contacts.keys()).forEach((key) => {
    const state = contacts.get(key);
    if (!state) {
      contacts.delete(key);
      return;
    }
    if (touchedKeys.has(key)) return;
    if ((Number(state.touchedAt) || 0) + 1.5 < nowSec) {
      contacts.delete(key);
      return;
    }
    state.inside = false;
    contacts.set(key, state);
  });

  const attackers = squads.filter((squad) => squad?.team === 'attacker' && (Number(squad?.remain) || 0) > 0);
  const defenders = squads.filter((squad) => squad?.team === 'defender' && (Number(squad?.remain) || 0) > 0);

  squads.forEach((squad) => {
    if (!squad) return;
    squad.hiddenFromAttacker = false;
    squad.hiddenFromDefender = false;
    if (!concealedSquadSet.has(squad.id)) return;
    const revealRadius = concealmentRevealRadiusBySquad.get(squad.id) || 2.2;
    if (squad.team === 'defender') {
      squad.hiddenFromAttacker = !shouldRevealHiddenSquad(squad, attackers, revealRadius, revealBonusBySquad);
      return;
    }
    if (squad.team === 'attacker') {
      squad.hiddenFromDefender = !shouldRevealHiddenSquad(squad, defenders, revealRadius, revealBonusBySquad);
    }
  });

  sim.itemInteractionDebug = {
    activeItems: items.length,
    activeContacts: contacts.size,
    concealedSquads: concealedSquadSet.size,
    revealBonusSquads: revealBonusBySquad.size,
    dt: clamp(Number(dt) || 0, 0, 1)
  };
};

const itemInteractionSystem = {
  step
};

export default itemInteractionSystem;

