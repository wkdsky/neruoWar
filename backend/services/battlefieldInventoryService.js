const BattlefieldItem = require('../models/BattlefieldItem');

const DEFAULT_ITEM_COUNT = 5;

const normalizeInventoryEntries = (entries = []) => {
  const source = Array.isArray(entries) ? entries : [];
  const out = [];
  const seen = new Set();
  source.forEach((entry) => {
    const itemId = typeof entry?.itemId === 'string' ? entry.itemId.trim() : '';
    if (!itemId || seen.has(itemId)) return;
    seen.add(itemId);
    out.push({
      itemId,
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    });
  });
  return out;
};

const buildInventoryMap = (entries = []) => {
  const map = new Map();
  normalizeInventoryEntries(entries).forEach((entry) => {
    map.set(entry.itemId, entry.count);
  });
  return map;
};

const loadEnabledItemCatalog = async () => {
  const rows = await BattlefieldItem.find({ enabled: true })
    .sort({ sortOrder: 1, createdAt: 1, _id: 1 })
    .select('itemId')
    .lean();
  return Array.isArray(rows) ? rows : [];
};

const ensureUserBattlefieldInventory = async (user, {
  defaultCount = DEFAULT_ITEM_COUNT,
  persist = false,
  reason = 'unknown'
} = {}) => {
  if (!user || user.role !== 'common') {
    return {
      changed: false,
      added: 0,
      totalEnabled: 0,
      reason,
      skipped: true
    };
  }

  const enabledCatalog = await loadEnabledItemCatalog();
  const inventoryMap = buildInventoryMap(user.battlefieldItemInventory);
  let added = 0;
  enabledCatalog.forEach((row) => {
    const itemId = typeof row?.itemId === 'string' ? row.itemId.trim() : '';
    if (!itemId || inventoryMap.has(itemId)) return;
    inventoryMap.set(itemId, Math.max(0, Math.floor(Number(defaultCount) || DEFAULT_ITEM_COUNT)));
    added += 1;
  });

  const nextInventory = Array.from(inventoryMap.entries()).map(([itemId, count]) => ({
    itemId,
    count: Math.max(0, Math.floor(Number(count) || 0))
  }));

  const changed = added > 0 || nextInventory.length !== normalizeInventoryEntries(user.battlefieldItemInventory).length;
  if (changed) {
    user.battlefieldItemInventory = nextInventory;
    if (persist) {
      await user.save();
    }
  }

  const status = changed ? (added > 0 ? 'patched' : 'normalized') : 'ok';
  console.log(
    `[battlefield] user inventory init status=${status} user=${user.username || user._id} added=${added} enabled=${enabledCatalog.length} reason=${reason}`
  );

  return {
    changed,
    added,
    totalEnabled: enabledCatalog.length,
    reason,
    skipped: false
  };
};

const resolveUserItemLimitMap = (user, itemCatalog = [], { fallbackCount = DEFAULT_ITEM_COUNT } = {}) => {
  const inventoryMap = buildInventoryMap(user?.battlefieldItemInventory);
  const limits = new Map();
  (Array.isArray(itemCatalog) ? itemCatalog : []).forEach((item) => {
    const itemId = typeof item?.itemId === 'string' ? item.itemId.trim() : '';
    if (!itemId) return;
    if (inventoryMap.has(itemId)) {
      limits.set(itemId, Math.max(0, Math.floor(Number(inventoryMap.get(itemId)) || 0)));
      return;
    }
    const fallback = Number.isFinite(Number(item?.initialCount))
      ? Number(item.initialCount)
      : Number(fallbackCount);
    limits.set(itemId, Math.max(0, Math.floor(fallback || 0)));
  });
  return limits;
};

module.exports = {
  DEFAULT_ITEM_COUNT,
  normalizeInventoryEntries,
  buildInventoryMap,
  ensureUserBattlefieldInventory,
  resolveUserItemLimitMap
};
