import {
  BASE_DEFENSE,
  BASE_HP,
  MERGE_DEFENSE_SCALE_PER_LINK,
  MERGE_HP_SCALE_PER_LINK,
  SNAP_EPSILON,
  STACK_LAYER_HEIGHT,
  clampStackLimit,
  createWallFromLike,
  getWallBaseZ,
  getWallTopZ,
  roundTo,
  sanitizeWalls
} from './battlefieldShared';
import { getRectContactMetrics } from './battlefieldPlacementUtils';

export const isPhysicallyConnected = (a, b) => {
  const aId = typeof a?.id === 'string' ? a.id.trim() : '';
  const bId = typeof b?.id === 'string' ? b.id.trim() : '';
  const aAttachParent = typeof a?.attach?.parentObjectId === 'string' ? a.attach.parentObjectId.trim() : '';
  const bAttachParent = typeof b?.attach?.parentObjectId === 'string' ? b.attach.parentObjectId.trim() : '';
  if ((aAttachParent && aAttachParent === bId) || (bAttachParent && bAttachParent === aId)) {
    return true;
  }

  const metrics = getRectContactMetrics(a, b);
  if (metrics.minOverlap < -SNAP_EPSILON) return false;

  const aBaseZ = getWallBaseZ(a);
  const aTopZ = getWallTopZ(a);
  const bBaseZ = getWallBaseZ(b);
  const bTopZ = getWallTopZ(b);
  const zOverlap = Math.min(aTopZ, bTopZ) - Math.max(aBaseZ, bBaseZ);
  const zTouchGap = Math.min(Math.abs(aTopZ - bBaseZ), Math.abs(bTopZ - aBaseZ));
  const minHeight = Math.min(
    Math.max(1, Number(a?.height) || STACK_LAYER_HEIGHT),
    Math.max(1, Number(b?.height) || STACK_LAYER_HEIGHT)
  );
  const sameBand = zOverlap > Math.max(1, minHeight * 0.06);
  const stackedTouch = zTouchGap <= Math.max(1.5, minHeight * 0.08);
  if (!sameBand && !stackedTouch) return false;

  const minDim = Math.min(a.width, a.depth, b.width, b.depth);
  if (stackedTouch) {
    const required = Math.max(4, minDim * 0.16);
    return metrics.overlaps.every((item) => item > required);
  }
  if (metrics.overlaps.every((item) => item > 0.6)) return true;
  const touchingAxis = metrics.overlaps.some((item) => Math.abs(item) <= Math.max(SNAP_EPSILON, 1.6));
  const strongOverlap = metrics.overlaps.some((item) => item > Math.max(2, minDim * 0.1));
  return touchingAxis && strongOverlap;
};

export const isStackSupportedBy = (upper = {}, lower = {}) => {
  if (!upper || !lower) return false;
  const upperBaseZ = getWallBaseZ(upper);
  const lowerTopZ = getWallTopZ(lower);
  const minHeight = Math.min(
    Math.max(1, Number(upper?.height) || STACK_LAYER_HEIGHT),
    Math.max(1, Number(lower?.height) || STACK_LAYER_HEIGHT)
  );
  const zTolerance = Math.max(1.2, minHeight * 0.08);
  if (Math.abs(upperBaseZ - lowerTopZ) > zTolerance) return false;
  const metrics = getRectContactMetrics(upper, lower);
  if (metrics.minOverlap < -SNAP_EPSILON) return false;
  const minDim = Math.min(upper.width, upper.depth, lower.width, lower.depth);
  const requiredOverlap = Math.max(2, minDim * 0.14);
  return metrics.overlaps.every((item) => item > requiredOverlap);
};

export const collectCascadeRemovedWallIds = (rootWallId = '', walls = []) => {
  const safeRootId = typeof rootWallId === 'string' ? rootWallId.trim() : '';
  if (!safeRootId) return new Set();
  const source = Array.isArray(walls) ? walls : [];
  if (source.length <= 0) return new Set();
  const byId = new Map(source.map((wall) => [wall.id, wall]));
  if (!byId.has(safeRootId)) return new Set();
  const removedIds = new Set([safeRootId]);
  const groundTolerance = 0.8;

  let changed = true;
  while (changed) {
    changed = false;
    for (const wall of source) {
      if (!wall || removedIds.has(wall.id)) continue;
      const attachParentId = typeof wall?.attach?.parentObjectId === 'string'
        ? wall.attach.parentObjectId.trim()
        : '';
      if (attachParentId && removedIds.has(attachParentId)) {
        removedIds.add(wall.id);
        changed = true;
        continue;
      }

      const wallBaseZ = getWallBaseZ(wall);
      if (wallBaseZ <= groundTolerance) continue;

      const supporters = source
        .filter((candidate) => candidate && candidate.id !== wall.id)
        .filter((candidate) => isStackSupportedBy(wall, candidate));
      if (supporters.length <= 0) {
        removedIds.add(wall.id);
        changed = true;
        continue;
      }
      const hasRemainingSupport = supporters.some((candidate) => !removedIds.has(candidate.id));
      if (!hasRemainingSupport) {
        removedIds.add(wall.id);
        changed = true;
      }
    }
  }
  return removedIds;
};

export const recomputeMergedWallAttributes = (walls = [], itemCatalogById = new Map()) => {
  const source = sanitizeWalls(walls);
  if (source.length <= 0) return [];
  const byId = new Map(source.map((wall) => [wall.id, wall]));
  const adjacency = new Map(source.map((wall) => [wall.id, new Set()]));
  for (let i = 0; i < source.length; i += 1) {
    for (let j = i + 1; j < source.length; j += 1) {
      const a = source[i];
      const b = source[j];
      if (!isPhysicallyConnected(a, b)) continue;
      adjacency.get(a.id)?.add(b.id);
      adjacency.get(b.id)?.add(a.id);
    }
  }

  const visited = new Set();
  const derivedById = new Map();
  source.forEach((wall) => {
    if (visited.has(wall.id)) return;
    const queue = [wall.id];
    const members = [];
    visited.add(wall.id);
    while (queue.length > 0) {
      const id = queue.shift();
      const current = byId.get(id);
      if (!current) continue;
      members.push(current);
      (adjacency.get(id) || []).forEach((nextId) => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        queue.push(nextId);
      });
    }
    if (members.length <= 0) return;
    const memberIds = members
      .map((item) => (typeof item?.id === 'string' ? item.id.trim() : ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'en'));
    const componentId = memberIds[0] || `group_${Date.now()}`;
    const mergeCount = members.length;
    const hpScale = 1 + (Math.max(0, mergeCount - 1) * MERGE_HP_SCALE_PER_LINK);
    const defenseScale = 1 + (Math.max(0, mergeCount - 1) * MERGE_DEFENSE_SCALE_PER_LINK);
    const stackBonus = Math.max(0, mergeCount - 1);

    members.forEach((member) => {
      const itemDef = itemCatalogById instanceof Map
        ? itemCatalogById.get(typeof member?.itemId === 'string' ? member.itemId : '')
        : null;
      const baseHp = Math.max(1, Math.floor(Number(member?.baseHp ?? itemDef?.hp ?? member?.hp ?? BASE_HP) || BASE_HP));
      const baseDefense = Math.max(0.1, Number(member?.baseDefense ?? itemDef?.defense ?? member?.defense ?? BASE_DEFENSE) || BASE_DEFENSE);
      const baseMaxStack = Number.isFinite(Number(
        member?.baseMaxStack
        ?? itemDef?.maxStack
        ?? member?.maxStack
      ))
        ? clampStackLimit(member.baseMaxStack ?? itemDef?.maxStack ?? member?.maxStack)
        : null;
      const effectiveMaxStack = Number.isFinite(Number(baseMaxStack))
        ? clampStackLimit(baseMaxStack + stackBonus)
        : null;
      derivedById.set(member.id, createWallFromLike(member, {
        groupId: componentId,
        mergeCount,
        hp: Math.max(1, Math.round(baseHp * hpScale)),
        defense: roundTo(Math.max(0.1, baseDefense * defenseScale), 3),
        maxStack: effectiveMaxStack,
        baseHp,
        baseDefense,
        baseMaxStack
      }));
    });
  });

  return source.map((wall) => derivedById.get(wall.id) || wall);
};

export const getWallGroupMetrics = (walls) => {
  const source = Array.isArray(walls) ? walls : [];
  if (source.length === 0) return [];
  const adjacency = new Map();
  const byId = new Map();
  source.forEach((wall) => {
    adjacency.set(wall.id, new Set());
    byId.set(wall.id, wall);
  });

  for (let i = 0; i < source.length; i += 1) {
    for (let j = i + 1; j < source.length; j += 1) {
      const a = source[i];
      const b = source[j];
      if (!isPhysicallyConnected(a, b)) continue;
      adjacency.get(a.id)?.add(b.id);
      adjacency.get(b.id)?.add(a.id);
    }
  }

  const visited = new Set();
  const groups = [];
  source.forEach((wall) => {
    if (visited.has(wall.id)) return;
    const queue = [wall.id];
    const members = [];
    visited.add(wall.id);
    while (queue.length > 0) {
      const id = queue.shift();
      const current = byId.get(id);
      if (!current) continue;
      members.push(current);
      (adjacency.get(id) || []).forEach((nextId) => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        queue.push(nextId);
      });
    }
    if (members.length === 0) return;
    const hp = members.reduce((sum, item) => sum + Math.max(0, Number(item.hp) || 0), 0);
    const defense = members.reduce((sum, item) => sum + Math.max(0.1, Number(item?.defense) || BASE_DEFENSE), 0) / members.length;
    const center = members.reduce((acc, item) => ({
      x: acc.x + item.x,
      y: acc.y + item.y
    }), { x: 0, y: 0 });
    const topZ = members.reduce((max, item) => Math.max(max, getWallTopZ(item)), 0);
    groups.push({
      ids: members.map((item) => item.id),
      hp: Math.round(hp),
      defense: roundTo(defense, 2),
      center: {
        x: center.x / members.length,
        y: center.y / members.length,
        z: topZ + 14
      }
    });
  });

  return groups;
};
