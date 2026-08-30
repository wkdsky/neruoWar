import { assignSlotsByType, inferTroopCategory } from './ArmyFormationRenderer';

export const DEFAULT_FORMATION_ID = 'AUTO_DEFAULT';
export const DEFAULT_FORMATION_NAME = '系统默认阵型';

const DEFAULT_SPACING = 6;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const toCountMap = (rawUnits = {}) => {
  const source = Array.isArray(rawUnits)
    ? rawUnits.map((entry) => [entry?.unitTypeId || entry?.id, entry?.count])
    : (rawUnits instanceof Map ? Array.from(rawUnits.entries()) : Object.entries(rawUnits || {}));
  return source.reduce((result, [rawTypeId, rawCount]) => {
    const unitTypeId = typeof rawTypeId === 'string' ? rawTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
    if (!unitTypeId || count <= 0) return result;
    result[unitTypeId] = (result[unitTypeId] || 0) + count;
    return result;
  }, {});
};

const toUnitTypeMap = (unitTypes = []) => {
  if (unitTypes instanceof Map) return unitTypes;
  const map = new Map();
  (Array.isArray(unitTypes) ? unitTypes : Object.values(unitTypes || {})).forEach((unitType) => {
    const unitTypeId = typeof unitType?.unitTypeId === 'string'
      ? unitType.unitTypeId.trim()
      : (typeof unitType?.id === 'string' ? unitType.id.trim() : '');
    if (unitTypeId) map.set(unitTypeId, unitType);
  });
  return map;
};

const sortTypeEntries = (countsByType = {}) => (
  Object.entries(countsByType)
    .filter(([unitTypeId, count]) => unitTypeId && count > 0)
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0], 'zh-Hans-CN');
    })
);

const allocateSlotsByType = (countsByType = {}, slotCount = 0) => {
  const totalSlots = Math.max(0, Math.floor(Number(slotCount) || 0));
  const entries = sortTypeEntries(countsByType);
  if (totalSlots <= 0 || entries.length <= 0) return {};
  const totalCount = entries.reduce((sum, [, count]) => sum + count, 0);
  const result = Object.fromEntries(entries.map(([unitTypeId]) => [unitTypeId, 0]));

  if (totalSlots >= entries.length) {
    entries.forEach(([unitTypeId]) => {
      result[unitTypeId] = 1;
    });
  }

  const remainingSlots = totalSlots - Object.values(result).reduce((sum, count) => sum + count, 0);
  const quotas = entries.map(([unitTypeId, count]) => {
    const exact = Math.max(0, remainingSlots) * (count / Math.max(1, totalCount));
    const base = Math.floor(exact);
    result[unitTypeId] += base;
    return { unitTypeId, count, fraction: exact - base };
  });
  let unassigned = totalSlots - Object.values(result).reduce((sum, count) => sum + count, 0);
  quotas.sort((left, right) => (
    right.fraction - left.fraction
    || right.count - left.count
    || left.unitTypeId.localeCompare(right.unitTypeId, 'zh-Hans-CN')
  ));
  for (let index = 0; index < unassigned; index += 1) {
    const target = quotas[index % quotas.length];
    if (!target) break;
    result[target.unitTypeId] += 1;
  }
  return result;
};

const resolveCategory = (unitType = {}) => {
  const inferred = inferTroopCategory(unitType);
  if (inferred !== 'other') return inferred;
  const classTag = String(unitType?.classTag || '').trim().toLowerCase();
  if (['infantry', 'cavalry', 'archer', 'artillery'].includes(classTag)) return classTag;
  return 'other';
};

const buildGridSlots = (slotCount = 0, spacing = DEFAULT_SPACING) => {
  const total = Math.max(1, Math.floor(Number(slotCount) || 1));
  const safeSpacing = Math.max(1, Number(spacing) || DEFAULT_SPACING);
  const columns = clamp(Math.ceil(Math.sqrt(total * 1.52)), 1, total);
  const rows = Math.max(1, Math.ceil(total / columns));
  const slots = Array.from({ length: total }, (_, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return {
      side: (col - ((columns - 1) * 0.5)) * safeSpacing,
      front: (((rows - 1) * 0.5) - row) * safeSpacing,
      row,
      col,
      index
    };
  });
  return { slots, columns, rows };
};

/**
 * Build the one logical formation used by previews, deployment and CARD squads.
 * This deliberately operates on simulation slots rather than visual render budget.
 */
export const buildDefaultFormationLayout = ({
  units = {},
  unitTypes = [],
  slotCount = null,
  spacing = DEFAULT_SPACING,
  facingRad = 0,
  directionOffsetRad = 0
} = {}) => {
  const countsByType = toCountMap(units);
  const totalCount = Object.values(countsByType).reduce((sum, count) => sum + count, 0);
  const resolvedSlotCount = Math.max(
    totalCount > 0 ? 1 : 0,
    Math.floor(Number(slotCount) || totalCount || 0)
  );
  if (resolvedSlotCount <= 0) {
    return {
      formationId: DEFAULT_FORMATION_ID,
      formationName: DEFAULT_FORMATION_NAME,
      formationRect: {
        formationId: DEFAULT_FORMATION_ID,
        formationName: DEFAULT_FORMATION_NAME,
        area: 0,
        width: 0,
        depth: 0,
        spacing: Math.max(1, Number(spacing) || DEFAULT_SPACING),
        facingRad: Number(facingRad) || 0,
        directionOffsetRad: Number(directionOffsetRad) || 0,
        directionRad: (Number(facingRad) || 0) + (Number(directionOffsetRad) || 0),
        slotCount: 0
      },
      deploySlots: [],
      assignmentByType: {},
      countsByType
    };
  }

  const safeSpacing = Math.max(1, Number(spacing) || DEFAULT_SPACING);
  const { slots, columns, rows } = buildGridSlots(resolvedSlotCount, safeSpacing);
  const allocatedByType = allocateSlotsByType(countsByType, resolvedSlotCount);
  const typeLookup = toUnitTypeMap(unitTypes);
  const typeMeta = Object.fromEntries(Object.keys(allocatedByType).map((unitTypeId) => {
    const unitType = typeLookup.get(unitTypeId) || {};
    return [unitTypeId, { ...unitType, category: resolveCategory(unitType) }];
  }));
  const assignment = assignSlotsByType({
    slots: slots.map((slot) => ({ x: slot.side, z: slot.front, row: slot.row, col: slot.col })),
    allocByType: allocatedByType,
    typeMeta,
    facingDir: { zSign: 1 }
  });
  const assignedSlots = [];
  Object.keys(allocatedByType)
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
    .forEach((unitTypeId) => {
      (assignment.assignmentByType[unitTypeId] || []).forEach((slotIndex) => {
        const slot = slots[slotIndex];
        if (!slot) return;
        assignedSlots.push({ ...slot, unitTypeId, templateIndex: slotIndex });
      });
    });
  const assignedIndexSet = new Set(assignedSlots.map((slot) => slot.templateIndex));
  slots.forEach((slot) => {
    if (!assignedIndexSet.has(slot.index)) {
      assignedSlots.push({ ...slot, unitTypeId: '', templateIndex: slot.index });
    }
  });

  const width = Math.max(safeSpacing, columns * safeSpacing);
  const depth = Math.max(safeSpacing, rows * safeSpacing);
  const safeFacing = Number.isFinite(Number(facingRad)) ? Number(facingRad) : 0;
  const safeDirectionOffset = Number.isFinite(Number(directionOffsetRad)) ? Number(directionOffsetRad) : 0;
  return {
    formationId: DEFAULT_FORMATION_ID,
    formationName: DEFAULT_FORMATION_NAME,
    formationRect: {
      formationId: DEFAULT_FORMATION_ID,
      formationName: DEFAULT_FORMATION_NAME,
      area: width * depth,
      width,
      depth,
      spacing: safeSpacing,
      facingRad: safeFacing,
      directionOffsetRad: safeDirectionOffset,
      directionRad: safeFacing + safeDirectionOffset,
      slotCount: resolvedSlotCount,
      columns,
      rows
    },
    deploySlots: assignedSlots.map((slot) => ({
      side: slot.side,
      front: slot.front,
      row: slot.row,
      col: slot.col,
      unitTypeId: slot.unitTypeId,
      templateIndex: slot.templateIndex
    })),
    assignmentByType: assignment.assignmentByType,
    countsByType
  };
};
