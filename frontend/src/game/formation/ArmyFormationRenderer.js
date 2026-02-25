/**
 * Shared army formation visual logic used by layout preview, pre-battle compose and live battle.
 * This module keeps render allocation, slot generation and casualty visualization consistent.
 */

const OTHER_TYPE_ID = '__other__';
const REALLOC_THROTTLE_MS = 380;
const DEFAULT_MAX_TYPES = 8;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const stableHash = (value = '') => {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0);
};

const createSeededRandom = (seed) => {
  let t = stableHash(seed) + 0x6d2b79f5;
  return () => {
    t += 0x6d2b79f5;
    let next = Math.imul(t ^ (t >>> 15), 1 | t);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
};

const normalizeCountsByType = (countsByType = {}) => {
  const out = {};
  Object.entries(countsByType || {}).forEach(([typeId, rawCount]) => {
    const unitTypeId = typeof typeId === 'string' ? typeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
    if (!unitTypeId || count <= 0) return;
    out[unitTypeId] = (out[unitTypeId] || 0) + count;
  });
  return out;
};

const sumCounts = (countsByType = {}) => Object.values(countsByType || {}).reduce((sum, value) => sum + (Math.max(0, Number(value) || 0)), 0);

const sortTypeEntries = (countsByType = {}) => (
  Object.entries(countsByType || {})
    .filter(([typeId, count]) => !!typeId && count > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return String(a[0]).localeCompare(String(b[0]), 'zh-Hans-CN');
    })
);

const collapseTypes = (countsByType = {}, maxTypes = DEFAULT_MAX_TYPES) => {
  const sorted = sortTypeEntries(countsByType);
  if (sorted.length <= maxTypes) {
    return {
      collapsedCounts: Object.fromEntries(sorted),
      typeOrder: sorted.map(([typeId]) => typeId),
      hasOther: false,
      collapsedMap: {}
    };
  }
  const keepSize = Math.max(1, maxTypes - 1);
  const keep = sorted.slice(0, keepSize);
  const merged = sorted.slice(keepSize);
  const otherCount = merged.reduce((sum, item) => sum + item[1], 0);
  const collapsedCounts = Object.fromEntries(keep);
  const collapsedMap = {};
  keep.forEach(([typeId]) => {
    collapsedMap[typeId] = [typeId];
  });
  collapsedMap[OTHER_TYPE_ID] = merged.map(([typeId]) => typeId);
  if (otherCount > 0) {
    collapsedCounts[OTHER_TYPE_ID] = otherCount;
  }
  const typeOrder = [...keep.map(([typeId]) => typeId)];
  if (otherCount > 0) typeOrder.push(OTHER_TYPE_ID);
  return {
    collapsedCounts,
    typeOrder,
    hasOther: otherCount > 0,
    collapsedMap
  };
};

const hamiltonAllocate = (countsByType = {}, budget = 0, minPerType = 1) => {
  const safeBudget = Math.max(0, Math.floor(Number(budget) || 0));
  const sorted = sortTypeEntries(countsByType);
  const activeCount = sorted.length;
  if (safeBudget <= 0 || activeCount <= 0) return {};

  const counts = Object.fromEntries(sorted);
  const alloc = {};
  let remainderBudget = safeBudget;
  const guaranteed = (safeBudget >= activeCount) ? Math.max(0, Math.floor(Number(minPerType) || 0)) : 0;

  if (guaranteed > 0) {
    sorted.forEach(([typeId]) => {
      alloc[typeId] = guaranteed;
    });
    remainderBudget = Math.max(0, safeBudget - (guaranteed * activeCount));
  } else {
    sorted.forEach(([typeId]) => {
      alloc[typeId] = 0;
    });
  }

  const totalCount = sumCounts(counts);
  const quotas = sorted.map(([typeId, count]) => {
    const exact = (remainderBudget * (count / Math.max(1, totalCount)));
    const base = Math.floor(exact);
    alloc[typeId] += base;
    return {
      typeId,
      frac: exact - base,
      count
    };
  });

  let assigned = Object.values(alloc).reduce((sum, value) => sum + value, 0);
  let remain = Math.max(0, safeBudget - assigned);
  quotas.sort((a, b) => {
    if (b.frac !== a.frac) return b.frac - a.frac;
    if (b.count !== a.count) return b.count - a.count;
    return a.typeId.localeCompare(b.typeId, 'zh-Hans-CN');
  });
  for (let i = 0; i < remain; i += 1) {
    const picked = quotas[i % quotas.length];
    if (!picked) break;
    alloc[picked.typeId] = (alloc[picked.typeId] || 0) + 1;
  }
  assigned = Object.values(alloc).reduce((sum, value) => sum + value, 0);
  if (assigned > safeBudget) {
    const over = assigned - safeBudget;
    const reverse = [...sortTypeEntries(alloc)].reverse();
    for (let i = 0; i < over; i += 1) {
      const picked = reverse[i % reverse.length];
      if (!picked) break;
      const [typeId] = picked;
      alloc[typeId] = Math.max(0, (alloc[typeId] || 0) - 1);
    }
  }
  return alloc;
};

const sumAlloc = (alloc = {}) => Object.values(alloc || {}).reduce((sum, value) => sum + (Math.max(0, Math.floor(Number(value) || 0))), 0);

const alignAllocToBudget = (alloc = {}, budget = 0) => {
  const safeBudget = Math.max(0, Math.floor(Number(budget) || 0));
  const next = {};
  Object.entries(alloc || {}).forEach(([typeId, count]) => {
    const c = Math.max(0, Math.floor(Number(count) || 0));
    if (!typeId || c <= 0) return;
    next[typeId] = c;
  });
  let total = sumAlloc(next);
  if (total === safeBudget) return next;
  const sorted = sortTypeEntries(next);
  if (sorted.length <= 0) return next;
  if (total > safeBudget) {
    let over = total - safeBudget;
    for (let i = sorted.length - 1; i >= 0 && over > 0; i -= 1) {
      const [typeId] = sorted[i];
      const cut = Math.min(over, next[typeId]);
      next[typeId] -= cut;
      over -= cut;
      if (next[typeId] <= 0) delete next[typeId];
    }
  } else {
    let remain = safeBudget - total;
    for (let i = 0; i < remain; i += 1) {
      const [typeId] = sorted[i % sorted.length];
      next[typeId] = (next[typeId] || 0) + 1;
    }
  }
  return next;
};

const stepAllocTowardTarget = (prevAlloc = {}, targetAlloc = {}, budget = 0, maxStepPerType = 1) => {
  const safeBudget = Math.max(0, Math.floor(Number(budget) || 0));
  const maxStep = Math.max(1, Math.floor(Number(maxStepPerType) || 1));
  const allTypes = new Set([...Object.keys(prevAlloc || {}), ...Object.keys(targetAlloc || {})]);
  const next = {};
  allTypes.forEach((typeId) => {
    const prev = Math.max(0, Math.floor(Number(prevAlloc?.[typeId]) || 0));
    const target = Math.max(0, Math.floor(Number(targetAlloc?.[typeId]) || 0));
    if (prev === target) {
      if (target > 0) next[typeId] = target;
      return;
    }
    if (prev < target) {
      next[typeId] = prev + Math.min(maxStep, target - prev);
      return;
    }
    next[typeId] = Math.max(target, prev - Math.min(maxStep, prev - target));
    if (next[typeId] <= 0) delete next[typeId];
  });
  return alignAllocToBudget(next, safeBudget);
};

const buildWeightsByType = (countsByType = {}, alloc = {}) => {
  const out = {};
  Object.entries(countsByType || {}).forEach(([typeId, count]) => {
    const allocCount = Math.max(0, Math.floor(Number(alloc?.[typeId]) || 0));
    out[typeId] = allocCount > 0 ? (count / allocCount) : count;
  });
  return out;
};

/**
 * Allocate visual soldiers by type with Hamilton + anti-jitter.
 * @param {Object} params
 * @param {Object<string, number>} params.countsByType
 * @param {number} params.renderBudget
 * @param {number} [params.minPerType=1]
 * @param {number} [params.maxTypes=8]
 * @param {Object|null} [params.prevAlloc]
 * @param {number} [params.nowMs=Date.now()]
 * @returns {{alloc:Object<string, number>,weightsByType:Object<string, number>,nextPrevAlloc:Object,typeOrder:string[],collapsedMap:Object<string,string[]>}}
 */
export const allocateRenderCounts = ({
  countsByType = {},
  renderBudget = 0,
  minPerType = 1,
  maxTypes = DEFAULT_MAX_TYPES,
  prevAlloc = null,
  nowMs = Date.now()
} = {}) => {
  const normalized = normalizeCountsByType(countsByType);
  const safeBudget = Math.max(0, Math.floor(Number(renderBudget) || 0));
  if (safeBudget <= 0 || Object.keys(normalized).length <= 0) {
    return {
      alloc: {},
      weightsByType: {},
      nextPrevAlloc: {
        alloc: {},
        targetAlloc: {},
        lastRecalcMs: nowMs,
        collapsedCounts: {},
        typeOrder: [],
        collapsedMap: {}
      },
      typeOrder: [],
      collapsedMap: {}
    };
  }

  const collapsed = collapseTypes(normalized, Math.max(1, Math.floor(Number(maxTypes) || DEFAULT_MAX_TYPES)));
  const targetAlloc = hamiltonAllocate(collapsed.collapsedCounts, safeBudget, minPerType);

  const canReuseTarget = !!prevAlloc
    && (nowMs - (Number(prevAlloc?.lastRecalcMs) || 0) < REALLOC_THROTTLE_MS)
    && JSON.stringify(prevAlloc?.collapsedCounts || {}) === JSON.stringify(collapsed.collapsedCounts);
  const effectiveTarget = canReuseTarget
    ? (prevAlloc?.targetAlloc || targetAlloc)
    : targetAlloc;
  const prevCurrentAlloc = prevAlloc?.alloc || {};
  const alloc = Object.keys(prevCurrentAlloc).length > 0
    ? stepAllocTowardTarget(prevCurrentAlloc, effectiveTarget, safeBudget, 1)
    : alignAllocToBudget(effectiveTarget, safeBudget);
  const weightsByType = buildWeightsByType(collapsed.collapsedCounts, alloc);

  return {
    alloc,
    weightsByType,
    nextPrevAlloc: {
      alloc,
      targetAlloc: effectiveTarget,
      lastRecalcMs: canReuseTarget ? (Number(prevAlloc?.lastRecalcMs) || nowMs) : nowMs,
      collapsedCounts: collapsed.collapsedCounts,
      typeOrder: collapsed.typeOrder,
      collapsedMap: collapsed.collapsedMap
    },
    typeOrder: collapsed.typeOrder,
    collapsedMap: collapsed.collapsedMap
  };
};

/**
 * Infer troop category from unit definition.
 * @param {Object} unitType
 * @returns {'infantry'|'cavalry'|'archer'|'artillery'|'other'}
 */
export const inferTroopCategory = (unitType = {}) => {
  const name = typeof unitType?.name === 'string' ? unitType.name : '';
  const roleTag = unitType?.roleTag === '远程' || unitType?.roleTag === '近战' ? unitType.roleTag : '';
  const speed = Number(unitType?.speed) || 0;
  const range = Number(unitType?.range) || 0;
  if (/(炮|投石|火炮|炮兵|臼炮|加农)/.test(name)) return 'artillery';
  if (/(弓|弩|弓兵|弩兵|射手)/.test(name)) return 'archer';
  if (roleTag === '远程' && range >= 3) return 'archer';
  if (/(骑|骑兵|铁骑|龙骑)/.test(name)) return 'cavalry';
  if (speed >= 2.1) return 'cavalry';
  if (roleTag === '近战') return 'infantry';
  return 'other';
};

export const resolveRenderBudget = (cameraState = {}) => {
  const explicitBudget = Number(cameraState?.renderBudget);
  if (Number.isFinite(explicitBudget)) {
    return clamp(Math.floor(explicitBudget), 8, 120);
  }
  const distance = Number(cameraState?.distance);
  const worldScale = Number(cameraState?.worldScale);
  if (Number.isFinite(distance)) {
    if (distance <= 700) return 72;
    if (distance <= 1040) return 48;
    if (distance <= 1500) return 24;
    return 8;
  }
  if (Number.isFinite(worldScale)) {
    if (worldScale >= 0.95) return 72;
    if (worldScale >= 0.66) return 48;
    if (worldScale >= 0.42) return 24;
    return 8;
  }
  return 48;
};

const resolveSlotSpacing = (budget = 48, baseSpacing = 8) => {
  const b = Math.max(1, Math.floor(Number(budget) || 1));
  const base = clamp(Number(baseSpacing) || 8, 3, 28);
  if (b >= 70) return base * 0.84;
  if (b >= 44) return base;
  if (b >= 20) return base * 1.08;
  return base * 1.22;
};

/**
 * Create stable local slots around formation center.
 * @param {Object} params
 * @param {number} params.budget
 * @param {number} [params.spacing=8]
 * @param {'grid'|'oval'} [params.shape='oval']
 * @param {string|number} [params.seed='']
 * @returns {Array<{x:number,z:number,row:number,col:number}>}
 */
export const generateFormationSlots = ({
  budget = 0,
  spacing = 8,
  shape = 'oval',
  seed = ''
} = {}) => {
  const safeBudget = Math.max(0, Math.floor(Number(budget) || 0));
  if (safeBudget <= 0) return [];
  const random = createSeededRandom(seed || `slots_${safeBudget}`);
  const safeSpacing = Math.max(1, Number(spacing) || 8);
  const slots = [];

  if (shape === 'grid') {
    const rowCount = Math.max(1, Math.ceil(Math.sqrt(safeBudget)));
    const colCount = rowCount;
    for (let i = 0; i < safeBudget; i += 1) {
      const row = Math.floor(i / colCount);
      const col = i % colCount;
      slots.push({
        x: (col - ((colCount - 1) / 2)) * safeSpacing,
        z: (row - ((Math.ceil(safeBudget / colCount) - 1) / 2)) * safeSpacing,
        row,
        col
      });
    }
    return slots;
  }

  const radiusBase = Math.max(1, Math.sqrt(safeBudget));
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < safeBudget; i += 1) {
    const t = (i + 0.5) / safeBudget;
    const r = Math.sqrt(t);
    const angle = (i * golden) + ((random() - 0.5) * 0.32);
    const x = Math.cos(angle) * r * radiusBase * safeSpacing * 0.82;
    const z = Math.sin(angle) * r * radiusBase * safeSpacing * 0.58;
    slots.push({
      x,
      z,
      row: Math.floor(r * radiusBase),
      col: i
    });
  }
  return slots;
};

const slotSorters = (forwardSign = 1) => ({
  front: (a, b) => {
    const az = a.z * forwardSign;
    const bz = b.z * forwardSign;
    if (bz !== az) return bz - az;
    return Math.abs(a.x) - Math.abs(b.x);
  },
  back: (a, b) => {
    const az = a.z * forwardSign;
    const bz = b.z * forwardSign;
    if (az !== bz) return az - bz;
    return Math.abs(a.x) - Math.abs(b.x);
  },
  wing: (a, b) => {
    const ax = Math.abs(a.x);
    const bx = Math.abs(b.x);
    if (bx !== ax) return bx - ax;
    return Math.abs((b.z * forwardSign)) - Math.abs((a.z * forwardSign));
  },
  center: (a, b) => {
    const ad = Math.hypot(a.x, a.z);
    const bd = Math.hypot(b.x, b.z);
    if (ad !== bd) return ad - bd;
    return (b.z * forwardSign) - (a.z * forwardSign);
  }
});

/**
 * Assign slots by troop type with class-based zone preference.
 * @param {Object} params
 * @param {Array<{x:number,z:number,row:number,col:number}>} params.slots
 * @param {Object<string,number>} params.allocByType
 * @param {Object<string,{category:string}>} [params.typeMeta]
 * @param {{zSign?:number}} [params.facingDir]
 * @returns {{assignmentByType:Object<string, number[]>,slotType:Array<string>}}
 */
export const assignSlotsByType = ({
  slots = [],
  allocByType = {},
  typeMeta = {},
  facingDir = {}
} = {}) => {
  const safeSlots = Array.isArray(slots) ? slots : [];
  const safeAlloc = {};
  Object.entries(allocByType || {}).forEach(([typeId, count]) => {
    const c = Math.max(0, Math.floor(Number(count) || 0));
    if (!typeId || c <= 0) return;
    safeAlloc[typeId] = c;
  });
  const assignmentByType = {};
  const slotType = new Array(safeSlots.length).fill('');
  const forwardSign = (Number(facingDir?.zSign) || 1) >= 0 ? 1 : -1;
  const pickers = slotSorters(forwardSign);

  const slotRefs = safeSlots.map((slot, index) => ({ ...slot, index }));
  const frontQueue = [...slotRefs].sort(pickers.front).map((item) => item.index);
  const backQueue = [...slotRefs].sort(pickers.back).map((item) => item.index);
  const wingQueue = [...slotRefs].sort(pickers.wing).map((item) => item.index);
  const centerQueue = [...slotRefs].sort(pickers.center).map((item) => item.index);
  const used = new Set();

  const takeFromQueues = (queues = []) => {
    for (let q = 0; q < queues.length; q += 1) {
      const queue = queues[q];
      for (let i = 0; i < queue.length; i += 1) {
        const slotIndex = queue[i];
        if (used.has(slotIndex)) continue;
        used.add(slotIndex);
        return slotIndex;
      }
    }
    return -1;
  };

  const typedEntries = Object.entries(safeAlloc)
    .map(([typeId, count]) => ({
      typeId,
      count,
      category: typeMeta?.[typeId]?.category || inferTroopCategory(typeMeta?.[typeId] || {})
    }))
    .sort((a, b) => {
      const order = {
        infantry: 1,
        cavalry: 2,
        archer: 3,
        artillery: 4,
        other: 5
      };
      const oa = order[a.category] || 9;
      const ob = order[b.category] || 9;
      if (oa !== ob) return oa - ob;
      if (b.count !== a.count) return b.count - a.count;
      return a.typeId.localeCompare(b.typeId, 'zh-Hans-CN');
    });

  typedEntries.forEach((entry) => {
    const queueList = entry.category === 'infantry'
      ? [frontQueue, centerQueue, wingQueue, backQueue]
      : (entry.category === 'archer'
        ? [backQueue, centerQueue, wingQueue, frontQueue]
        : (entry.category === 'artillery'
          ? [backQueue, wingQueue, centerQueue, frontQueue]
          : (entry.category === 'cavalry'
            ? [wingQueue, frontQueue, centerQueue, backQueue]
            : [centerQueue, frontQueue, wingQueue, backQueue])));
    assignmentByType[entry.typeId] = [];
    for (let i = 0; i < entry.count; i += 1) {
      const slotIndex = takeFromQueues(queueList);
      if (slotIndex < 0) break;
      assignmentByType[entry.typeId].push(slotIndex);
      slotType[slotIndex] = entry.typeId;
    }
  });

  return {
    assignmentByType,
    slotType
  };
};

const resolveTypeLookup = (unitTypes = []) => {
  if (unitTypes instanceof Map) return unitTypes;
  const map = new Map();
  (Array.isArray(unitTypes) ? unitTypes : []).forEach((unitType) => {
    const unitTypeId = typeof unitType?.unitTypeId === 'string' ? unitType.unitTypeId.trim() : '';
    if (!unitTypeId) return;
    map.set(unitTypeId, unitType);
  });
  return map;
};

const resolveTypeMeta = (countsByType = {}, unitTypes = [], collapsedMap = {}) => {
  const lookup = resolveTypeLookup(unitTypes);
  const meta = {};
  Object.keys(countsByType || {}).forEach((typeId) => {
    if (typeId === OTHER_TYPE_ID) {
      meta[typeId] = {
        category: 'other',
        name: '混合兵种'
      };
      return;
    }
    const raw = lookup.get(typeId) || {};
    meta[typeId] = {
      unitTypeId: typeId,
      name: typeof raw?.name === 'string' ? raw.name : typeId,
      roleTag: raw?.roleTag === '远程' ? '远程' : '近战',
      speed: Number(raw?.speed) || 1,
      range: Number(raw?.range) || 1,
      category: inferTroopCategory(raw)
    };
  });
  if (collapsedMap?.[OTHER_TYPE_ID]) {
    meta[OTHER_TYPE_ID] = {
      unitTypeId: OTHER_TYPE_ID,
      name: `其他(${collapsedMap[OTHER_TYPE_ID].length})`,
      roleTag: '近战',
      speed: 1,
      range: 1,
      category: 'other'
    };
  }
  return meta;
};

const buildDefaultVisibleByType = (alloc = {}) => {
  const out = {};
  Object.entries(alloc || {}).forEach(([typeId, count]) => {
    const c = Math.max(0, Math.floor(Number(count) || 0));
    if (!typeId || c <= 0) return;
    out[typeId] = c;
  });
  return out;
};

const buildDeltaCounts = (prevCounts = {}, nextCounts = {}) => {
  const all = new Set([...Object.keys(prevCounts || {}), ...Object.keys(nextCounts || {})]);
  const delta = {};
  all.forEach((typeId) => {
    const prev = Math.max(0, Math.floor(Number(prevCounts?.[typeId]) || 0));
    const next = Math.max(0, Math.floor(Number(nextCounts?.[typeId]) || 0));
    if (next === prev) return;
    delta[typeId] = next - prev;
  });
  return delta;
};

const getTypeStyle = (category = 'infantry', teamId = '') => {
  const attacker = teamId === 'attacker';
  if (category === 'cavalry') {
    return attacker
      ? { body: '#f59e0b', accent: '#fcd34d', flag: '#b45309' }
      : { body: '#38bdf8', accent: '#bae6fd', flag: '#0c4a6e' };
  }
  if (category === 'archer') {
    return attacker
      ? { body: '#f97316', accent: '#fdba74', flag: '#c2410c' }
      : { body: '#10b981', accent: '#6ee7b7', flag: '#047857' };
  }
  if (category === 'artillery') {
    return attacker
      ? { body: '#ef4444', accent: '#fca5a5', flag: '#b91c1c' }
      : { body: '#6366f1', accent: '#a5b4fc', flag: '#4338ca' };
  }
  if (category === 'other') {
    return attacker
      ? { body: '#fb7185', accent: '#fecdd3', flag: '#be123c' }
      : { body: '#22d3ee', accent: '#a5f3fc', flag: '#155e75' };
  }
  return attacker
    ? { body: '#e11d48', accent: '#fda4af', flag: '#9f1239' }
    : { body: '#0284c7', accent: '#bae6fd', flag: '#075985' };
};

const categorySpacingFactor = (category) => {
  if (category === 'infantry') return 0.82;
  if (category === 'archer') return 1.08;
  if (category === 'artillery') return 1.3;
  if (category === 'cavalry') return 1.18;
  return 1;
};

const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;

const buildGoldenIndexOrder = (size = 0, seedText = '') => {
  const safeSize = Math.max(0, Math.floor(Number(size) || 0));
  if (safeSize <= 0) return [];
  if (safeSize === 1) return [0];
  const out = [];
  const used = new Set();
  const start = (stableHash(seedText) % 99991) / 99991;
  let cursor = 0;
  while (out.length < safeSize && cursor < (safeSize * 6)) {
    const idx = Math.floor((((cursor * GOLDEN_RATIO_CONJUGATE) + start) % 1) * safeSize);
    if (!used.has(idx)) {
      used.add(idx);
      out.push(idx);
    }
    cursor += 1;
  }
  for (let i = 0; i < safeSize; i += 1) {
    if (!used.has(i)) out.push(i);
  }
  return out;
};

const selectVisibleSlotIndices = ({
  slotIndices = [],
  slots = [],
  visibleCount = 0,
  spacing = 8,
  seedKey = ''
} = {}) => {
  const cap = Math.max(0, Math.floor(Number(visibleCount) || 0));
  if (cap <= 0) return [];
  const refs = (Array.isArray(slotIndices) ? slotIndices : [])
    .map((slotIndex) => ({
      slotIndex,
      slot: slots?.[slotIndex] || null
    }))
    .filter((item) => item.slot && Number.isFinite(item.slot.x) && Number.isFinite(item.slot.z));
  if (refs.length <= 0) return [];
  if (cap >= refs.length) return refs.map((item) => item.slotIndex);

  const ringStep = Math.max(1, (Number(spacing) || 8) * 0.9);
  const ringMap = new Map();
  refs.forEach((item) => {
    const dist = Math.hypot(item.slot.x, item.slot.z);
    const ring = Math.max(0, Math.floor(dist / ringStep));
    const angle = Math.atan2(item.slot.z, item.slot.x);
    const bucket = ringMap.get(ring) || [];
    bucket.push({
      slotIndex: item.slotIndex,
      dist,
      angle
    });
    ringMap.set(ring, bucket);
  });

  const ringKeys = Array.from(ringMap.keys()).sort((a, b) => a - b);
  const selected = [];
  let remain = cap;
  ringKeys.forEach((ringKey) => {
    if (remain <= 0) return;
    const bucket = ringMap.get(ringKey) || [];
    if (bucket.length <= 0) return;
    bucket.sort((a, b) => {
      if (a.angle !== b.angle) return a.angle - b.angle;
      if (a.dist !== b.dist) return a.dist - b.dist;
      return a.slotIndex - b.slotIndex;
    });
    if (remain >= bucket.length) {
      bucket.forEach((item) => selected.push(item.slotIndex));
      remain -= bucket.length;
      return;
    }
    const order = buildGoldenIndexOrder(bucket.length, `${seedKey}:${ringKey}`);
    for (let i = 0; i < remain; i += 1) {
      selected.push(bucket[order[i]].slotIndex);
    }
    remain = 0;
  });

  return selected;
};

/**
 * Create formation visual state.
 * @param {Object} params
 * @param {string} params.teamId
 * @param {string} params.formationId
 * @param {Object<string,number>} params.countsByType
 * @param {Array|Map} params.unitTypes
 * @param {Object} [params.cameraState]
 * @returns {Object}
 */
export const createFormationVisualState = ({
  teamId = '',
  formationId = '',
  countsByType = {},
  unitTypes = [],
  cameraState = {}
} = {}) => {
  const nowMs = Date.now();
  const normalized = normalizeCountsByType(countsByType);
  const renderBudget = resolveRenderBudget(cameraState);
  const allocResult = allocateRenderCounts({
    countsByType: normalized,
    renderBudget,
    minPerType: 1,
    maxTypes: DEFAULT_MAX_TYPES,
    prevAlloc: null,
    nowMs
  });
  const spacing = resolveSlotSpacing(renderBudget, cameraState?.baseSpacing || 8);
  const slots = generateFormationSlots({
    budget: renderBudget,
    spacing,
    shape: cameraState?.shape === 'grid' ? 'grid' : 'oval',
    seed: `${formationId || 'formation'}:${renderBudget}`
  });
  const typeMeta = resolveTypeMeta(allocResult.alloc, unitTypes, allocResult.collapsedMap);
  const assignment = assignSlotsByType({
    slots,
    allocByType: allocResult.alloc,
    typeMeta,
    facingDir: cameraState?.facingDir || { zSign: 1 }
  });
  const visibleByType = buildDefaultVisibleByType(allocResult.alloc);
  const deathPoolByType = {};
  Object.keys(allocResult.alloc).forEach((typeId) => {
    deathPoolByType[typeId] = 0;
  });
  return {
    teamId,
    formationId,
    countsByType: normalized,
    typeMeta,
    collapsedMap: allocResult.collapsedMap || {},
    allocByType: allocResult.alloc,
    visibleByType,
    weightsByType: allocResult.weightsByType,
    allocRuntime: allocResult.nextPrevAlloc,
    renderBudget,
    spacing,
    slots,
    slotAssignment: assignment.assignmentByType,
    deathPoolByType,
    seed: `${formationId || 'formation'}:${stableHash(JSON.stringify(normalized))}`,
    isHighlighted: false,
    isGhost: false
  };
};

/**
 * Apply casualty deltas to visual state.
 * @param {Object} state
 * @param {Object<string,number>} deltaCountsByType
 * @param {number} [nowMs=Date.now()]
 * @returns {Object}
 */
export const applyCasualties = (state, deltaCountsByType = {}, nowMs = Date.now()) => {
  if (!state || typeof state !== 'object') return state;
  Object.entries(deltaCountsByType || {}).forEach(([typeId, delta]) => {
    const safeDelta = Math.floor(Number(delta) || 0);
    if (!typeId || safeDelta >= 0) return;
    const casualty = Math.abs(safeDelta);
    state.deathPoolByType[typeId] = (state.deathPoolByType[typeId] || 0) + casualty;
    const weight = Math.max(0.0001, Number(state.weightsByType?.[typeId]) || 1);
    while (state.deathPoolByType[typeId] >= weight) {
      const visible = Math.max(0, Math.floor(Number(state.visibleByType?.[typeId]) || 0));
      if (visible <= 0) break;
      state.visibleByType[typeId] = visible - 1;
      state.deathPoolByType[typeId] -= weight;
    }
  });
  state.lastCasualtyAt = nowMs;
  return state;
};

/**
 * Reconcile counts and camera-driven LOD into a stable formation visual state.
 * @param {Object} state
 * @param {Object<string,number>} newCountsByType
 * @param {Object} [cameraState]
 * @param {number} [nowMs=Date.now()]
 * @returns {Object}
 */
export const reconcileCounts = (state, newCountsByType = {}, cameraState = {}, nowMs = Date.now()) => {
  if (!state || typeof state !== 'object') return state;
  const normalized = normalizeCountsByType(newCountsByType);
  const delta = buildDeltaCounts(state.countsByType || {}, normalized);
  applyCasualties(state, delta, nowMs);
  state.countsByType = normalized;

  const nextBudget = resolveRenderBudget(cameraState);
  const allocResult = allocateRenderCounts({
    countsByType: normalized,
    renderBudget: nextBudget,
    minPerType: 1,
    maxTypes: DEFAULT_MAX_TYPES,
    prevAlloc: state.allocRuntime || null,
    nowMs
  });
  const budgetChanged = nextBudget !== state.renderBudget;
  const allocChanged = JSON.stringify(allocResult.alloc) !== JSON.stringify(state.allocByType || {});
  state.weightsByType = allocResult.weightsByType;
  state.allocRuntime = allocResult.nextPrevAlloc;
  state.collapsedMap = allocResult.collapsedMap || {};

  if (budgetChanged || allocChanged || !Array.isArray(state.slots) || state.slots.length !== nextBudget) {
    state.renderBudget = nextBudget;
    state.spacing = resolveSlotSpacing(nextBudget, cameraState?.baseSpacing || state.spacing || 8);
    state.slots = generateFormationSlots({
      budget: nextBudget,
      spacing: state.spacing,
      shape: cameraState?.shape === 'grid' ? 'grid' : 'oval',
      seed: `${state.formationId || 'formation'}:${nextBudget}`
    });
    state.typeMeta = resolveTypeMeta(allocResult.alloc, cameraState?.unitTypes || [], state.collapsedMap);
    const assignment = assignSlotsByType({
      slots: state.slots,
      allocByType: allocResult.alloc,
      typeMeta: state.typeMeta,
      facingDir: cameraState?.facingDir || { zSign: 1 }
    });
    state.slotAssignment = assignment.assignmentByType;
    state.allocByType = allocResult.alloc;
    Object.entries(allocResult.alloc).forEach(([typeId, allocCount]) => {
      const currentVisible = Math.max(0, Math.floor(Number(state.visibleByType?.[typeId]) || 0));
      if (currentVisible > allocCount) {
        state.visibleByType[typeId] = allocCount;
      } else if (currentVisible < allocCount) {
        state.visibleByType[typeId] = currentVisible + Math.min(2, allocCount - currentVisible);
      }
      if (!Number.isFinite(state.deathPoolByType[typeId])) {
        state.deathPoolByType[typeId] = 0;
      }
    });
    Object.keys(state.visibleByType || {}).forEach((typeId) => {
      if ((state.allocByType?.[typeId] || 0) <= 0) {
        delete state.visibleByType[typeId];
      }
    });
  } else {
    state.allocByType = allocResult.alloc;
    Object.entries(state.visibleByType || {}).forEach(([typeId, visible]) => {
      const cap = Math.max(0, Math.floor(Number(state.allocByType?.[typeId]) || 0));
      state.visibleByType[typeId] = Math.max(0, Math.min(cap, Math.floor(Number(visible) || 0)));
    });
  }

  return state;
};

const buildRenderableInstances = (state, options = {}) => {
  const center = options?.center && typeof options.center === 'object'
    ? { x: Number(options.center.x) || 0, y: Number(options.center.y) || 0 }
    : { x: 0, y: 0 };
  const rows = [];
  Object.entries(state.visibleByType || {}).forEach(([typeId, visibleCount]) => {
    const safeVisible = Math.max(0, Math.floor(Number(visibleCount) || 0));
    if (safeVisible <= 0) return;
    const indices = Array.isArray(state.slotAssignment?.[typeId]) ? state.slotAssignment[typeId] : [];
    const visibleSlotIndices = selectVisibleSlotIndices({
      slotIndices: indices,
      slots: state.slots,
      visibleCount: safeVisible,
      spacing: state.spacing || 8,
      seedKey: `${state.formationId || 'formation'}:${typeId}`
    });
    const meta = state.typeMeta?.[typeId] || {
      category: 'other',
      name: typeId
    };
    const style = getTypeStyle(meta.category, state.teamId);
    const spacingFactor = categorySpacingFactor(meta.category);
    for (let i = 0; i < visibleSlotIndices.length; i += 1) {
      const slot = state.slots?.[visibleSlotIndices[i]];
      if (!slot) continue;
      rows.push({
        typeId,
        category: meta.category || 'other',
        unitName: meta.name || typeId,
        x: center.x + (slot.x * spacingFactor),
        y: center.y + (slot.z * spacingFactor),
        localX: slot.x,
        localZ: slot.z,
        bodyColor: style.body,
        accentColor: style.accent,
        flagColor: style.flag
      });
    }
  });
  return rows;
};

/**
 * Return formation footprint for placement collision.
 * @param {Object} state
 * @returns {{radius:number,width:number,depth:number}}
 */
export const getFormationFootprint = (state) => {
  if (!state || !Array.isArray(state.slots) || state.slots.length <= 0) {
    return { radius: 16, width: 24, depth: 24 };
  }
  const refs = [];
  Object.entries(state.visibleByType || {}).forEach(([typeId, visibleCount]) => {
    const safeVisible = Math.max(0, Math.floor(Number(visibleCount) || 0));
    const slotIndices = Array.isArray(state.slotAssignment?.[typeId]) ? state.slotAssignment[typeId] : [];
    const visibleSlotIndices = selectVisibleSlotIndices({
      slotIndices,
      slots: state.slots,
      visibleCount: safeVisible,
      spacing: state.spacing || 8,
      seedKey: `${state.formationId || 'formation'}:${typeId}`
    });
    for (let i = 0; i < visibleSlotIndices.length; i += 1) {
      const slot = state.slots?.[visibleSlotIndices[i]];
      if (slot) refs.push(slot);
    }
  });
  if (refs.length <= 0) {
    return { radius: 16, width: 24, depth: 24 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  refs.forEach((slot) => {
    minX = Math.min(minX, slot.x);
    maxX = Math.max(maxX, slot.x);
    minZ = Math.min(minZ, slot.z);
    maxZ = Math.max(maxZ, slot.z);
  });
  const width = Math.max(10, (maxX - minX) + (state.spacing || 8));
  const depth = Math.max(10, (maxZ - minZ) + (state.spacing || 8));
  const radius = Math.max(10, Math.hypot(width, depth) * 0.52);
  return {
    radius,
    width,
    depth
  };
};

const drawCanvasSoldier = (ctx, projected, row, options = {}) => {
  const scale = clamp(Number(options?.soldierScale) || 1, 0.15, 3.5);
  const isHighlighted = !!options?.highlighted;
  const isGhost = !!options?.ghost;
  const alpha = isGhost ? 0.42 : 1;
  const shadowW = clamp((6.1 + (Number(options?.radius) || 20) * 0.11) * scale, 2.8, 11);
  const shadowH = clamp((3.1 + (Number(options?.radius) || 20) * 0.05) * scale, 1.8, 7);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  ctx.ellipse(projected.x, projected.y + 2, shadowW, shadowH, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
  ctx.fill();

  const bodyH = clamp((8.8 + (Number(options?.worldScale) || 1) * 0.2) * scale, 4.2, 11);
  const bodyW = clamp((6.1 + (Number(options?.worldScale) || 1) * 0.16) * scale, 3.4, 8.3);
  ctx.beginPath();
  if (row.category === 'cavalry') {
    ctx.ellipse(projected.x, projected.y, bodyW * 0.92, bodyH * 0.45, 0, 0, Math.PI * 2);
  } else if (row.category === 'artillery') {
    ctx.rect(projected.x - bodyW * 0.58, projected.y - bodyH * 0.42, bodyW * 1.16, bodyH * 0.84);
  } else if (row.category === 'archer') {
    ctx.moveTo(projected.x, projected.y - bodyH * 0.74);
    ctx.lineTo(projected.x + bodyW * 0.42, projected.y + bodyH * 0.28);
    ctx.lineTo(projected.x - bodyW * 0.42, projected.y + bodyH * 0.28);
    ctx.closePath();
  } else {
    ctx.moveTo(projected.x, projected.y - bodyH * 0.72);
    ctx.lineTo(projected.x + bodyW * 0.54, projected.y + bodyH * 0.24);
    ctx.lineTo(projected.x - bodyW * 0.54, projected.y + bodyH * 0.24);
    ctx.closePath();
  }
  ctx.fillStyle = row.bodyColor;
  ctx.fill();

  if (isHighlighted) {
    ctx.beginPath();
    ctx.ellipse(projected.x, projected.y - 0.5, bodyW * 0.94, bodyH * 0.84, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.96)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
};

/**
 * Unified formation rendering entry. It can draw on canvas or emit descriptors for other engines.
 * @param {Object} state
 * @param {Object} renderCtxOrScene
 * @param {Object} cameraState
 * @param {number} [dt=0]
 * @returns {{instances:Array,footprint:Object,anchor:Object|null}}
 */
export const renderFormation = (state, renderCtxOrScene = {}, cameraState = {}, dt = 0) => {
  if (!state) {
    return {
      instances: [],
      footprint: { radius: 16, width: 24, depth: 24 },
      anchor: null
    };
  }
  const instances = buildRenderableInstances(state, {
    center: renderCtxOrScene?.center || { x: 0, y: 0 }
  });
  const footprint = getFormationFootprint(state);
  const anchor = renderCtxOrScene?.center || null;

  if (renderCtxOrScene?.kind === 'three' && typeof renderCtxOrScene.emitInstance === 'function') {
    instances.forEach((instance) => {
      renderCtxOrScene.emitInstance(instance, {
        highlighted: !!state.isHighlighted,
        ghost: !!state.isGhost,
        footprint,
        dt
      });
    });
  }

  if (renderCtxOrScene?.kind === 'canvas2d' && renderCtxOrScene.ctx && typeof renderCtxOrScene.project === 'function') {
    const ctx = renderCtxOrScene.ctx;
    const rows = [];
    instances.forEach((row) => {
      const projected = renderCtxOrScene.project(row.x, row.y, 0);
      rows.push({
        depth: Number(projected?.depth) || 0,
        draw: () => drawCanvasSoldier(ctx, projected, row, {
          soldierScale: renderCtxOrScene?.soldierScale || 1,
          worldScale: renderCtxOrScene?.worldScale || cameraState?.worldScale || 1,
          radius: footprint.radius,
          highlighted: !!state.isHighlighted,
          ghost: !!state.isGhost
        })
      });
    });
    rows.sort((a, b) => a.depth - b.depth);
    rows.forEach((row) => row.draw());

    if (renderCtxOrScene?.drawBaseRing && anchor) {
      const center = renderCtxOrScene.project(anchor.x, anchor.y, 0.2);
      const edge = renderCtxOrScene.project(anchor.x + footprint.radius, anchor.y, 0.2);
      const radiusPx = Math.max(8, Math.hypot(edge.x - center.x, edge.y - center.y));
      ctx.beginPath();
      ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
      ctx.fillStyle = state.isGhost ? 'rgba(125, 211, 252, 0.14)' : 'rgba(125, 211, 252, 0.2)';
      ctx.fill();
      ctx.strokeStyle = state.isHighlighted ? 'rgba(186, 230, 253, 0.92)' : 'rgba(125, 211, 252, 0.58)';
      ctx.lineWidth = state.isHighlighted ? 1.6 : 1;
      ctx.stroke();
    }
  }

  return {
    instances,
    footprint,
    anchor
  };
};
