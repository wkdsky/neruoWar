import { useMemo } from 'react';
import {
  normalizeDefenderUnits,
  sanitizeDefenderDeployments
} from './battlefieldShared';
import { getInteractionKindLabel } from './battlefieldPlacementUtils';
import { getWallGroupMetrics } from './battlefieldConnectivityUtils';

const useBattlefieldComputedData = ({
  activeLayoutMeta,
  fieldWidthDefault,
  fieldHeightDefault,
  normalizedItemCatalog = [],
  walls = [],
  itemDetailModalItemId = '',
  defenderRoster = [],
  defenderDeployments = [],
  deployZoneRatio = 0.2
}) => {
  const fieldWidth = useMemo(
    () => Math.max(200, Number(activeLayoutMeta?.fieldWidth) || fieldWidthDefault),
    [activeLayoutMeta?.fieldWidth, fieldWidthDefault]
  );
  const fieldHeight = useMemo(
    () => Math.max(200, Number(activeLayoutMeta?.fieldHeight) || fieldHeightDefault),
    [activeLayoutMeta?.fieldHeight, fieldHeightDefault]
  );
  const wallGroups = useMemo(() => getWallGroupMetrics(walls), [walls]);
  const itemPlacedCountMap = useMemo(() => {
    const map = new Map();
    walls.forEach((item) => {
      const itemId = typeof item?.itemId === 'string' ? item.itemId : '';
      if (!itemId) return;
      map.set(itemId, (map.get(itemId) || 0) + 1);
    });
    return map;
  }, [walls]);
  const itemStockMetaMap = useMemo(() => {
    const map = new Map();
    normalizedItemCatalog.forEach((item) => {
      const limit = Math.max(0, Math.floor(Number(item?.initialCount) || 0));
      const used = itemPlacedCountMap.get(item.itemId) || 0;
      map.set(item.itemId, {
        used,
        limit,
        remaining: Math.max(0, limit - used)
      });
    });
    return map;
  }, [itemPlacedCountMap, normalizedItemCatalog]);
  const itemCatalogById = useMemo(
    () => new Map(normalizedItemCatalog.map((item) => [item.itemId, item])),
    [normalizedItemCatalog]
  );
  const itemDetailModalItem = useMemo(() => (
    itemDetailModalItemId ? (itemCatalogById.get(itemDetailModalItemId) || null) : null
  ), [itemCatalogById, itemDetailModalItemId]);
  const itemDetailModalStock = useMemo(() => (
    itemDetailModalItem ? (itemStockMetaMap.get(itemDetailModalItem.itemId) || { used: 0, limit: 0, remaining: 0 }) : null
  ), [itemDetailModalItem, itemStockMetaMap]);
  const itemDetailInteractionLabels = useMemo(() => {
    if (!itemDetailModalItem) return [];
    const rows = Array.isArray(itemDetailModalItem?.interactions) ? itemDetailModalItem.interactions : [];
    return Array.from(new Set(rows.map((row) => getInteractionKindLabel(row?.kind)).filter(Boolean)));
  }, [itemDetailModalItem]);
  const itemDetailSocketCount = useMemo(() => (
    itemDetailModalItem && Array.isArray(itemDetailModalItem?.sockets) ? itemDetailModalItem.sockets.length : 0
  ), [itemDetailModalItem]);
  const itemDetailColliderPartCount = useMemo(() => {
    if (!itemDetailModalItem) return 0;
    if (Array.isArray(itemDetailModalItem?.collider?.parts)) return itemDetailModalItem.collider.parts.length;
    if (Array.isArray(itemDetailModalItem?.collider?.polygon?.points)) {
      return Math.max(0, itemDetailModalItem.collider.polygon.points.length);
    }
    return 0;
  }, [itemDetailModalItem]);
  const totalItemLimit = useMemo(
    () => normalizedItemCatalog.reduce((sum, item) => sum + (itemStockMetaMap.get(item.itemId)?.limit || 0), 0),
    [itemStockMetaMap, normalizedItemCatalog]
  );
  const totalItemRemaining = useMemo(
    () => normalizedItemCatalog.reduce((sum, item) => sum + (itemStockMetaMap.get(item.itemId)?.remaining || 0), 0),
    [itemStockMetaMap, normalizedItemCatalog]
  );
  const defenderRosterMap = useMemo(() => (
    new Map(
      (Array.isArray(defenderRoster) ? defenderRoster : [])
        .map((item) => ([
          typeof item?.unitTypeId === 'string' ? item.unitTypeId.trim() : '',
          {
            unitTypeId: typeof item?.unitTypeId === 'string' ? item.unitTypeId.trim() : '',
            unitName: typeof item?.unitName === 'string' ? item.unitName : '',
            roleTag: item?.roleTag === '远程' ? '远程' : '近战',
            count: Math.max(0, Math.floor(Number(item?.count) || 0))
          }
        ]))
        .filter(([unitTypeId, item]) => !!unitTypeId && item.count > 0)
    )
  ), [defenderRoster]);
  const deployedDefenderCountMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(defenderDeployments) ? defenderDeployments : []).forEach((item) => {
      normalizeDefenderUnits(item?.units, item?.unitTypeId, item?.count).forEach((entry) => {
        map.set(entry.unitTypeId, (map.get(entry.unitTypeId) || 0) + entry.count);
      });
    });
    return map;
  }, [defenderDeployments]);
  const defenderStockRows = useMemo(() => (
    Array.from(defenderRosterMap.values()).map((item) => {
      const used = deployedDefenderCountMap.get(item.unitTypeId) || 0;
      const remaining = Math.max(0, item.count - used);
      return {
        ...item,
        used,
        remaining
      };
    })
  ), [defenderRosterMap, deployedDefenderCountMap]);
  const defenderUnitTypesForFormation = useMemo(() => (
    Array.from(defenderRosterMap.values()).map((item) => ({
      unitTypeId: item.unitTypeId,
      name: item.unitName || item.unitTypeId,
      roleTag: item.roleTag === '远程' ? '远程' : '近战',
      speed: item.roleTag === '远程' ? 1.1 : 1.4,
      range: item.roleTag === '远程' ? 3 : 1
    }))
  ), [defenderRosterMap]);
  const totalDefenderPlaced = useMemo(
    () => defenderStockRows.reduce((sum, item) => sum + item.used, 0),
    [defenderStockRows]
  );
  const defenderZoneMinX = useMemo(
    () => (fieldWidth / 2) - (fieldWidth * deployZoneRatio),
    [deployZoneRatio, fieldWidth]
  );
  const defenderDeploymentRows = useMemo(
    () => sanitizeDefenderDeployments(defenderDeployments)
      .map((item, index) => {
        const units = normalizeDefenderUnits(item?.units, item?.unitTypeId, item?.count);
        const totalCount = units.reduce((sum, entry) => sum + entry.count, 0);
        const unitSummary = units
          .map((entry) => `${defenderRosterMap.get(entry.unitTypeId)?.unitName || entry.unitTypeId} x${entry.count}`)
          .join(' / ');
        const fallbackName = `守军部队${index + 1}`;
        return {
          ...item,
          units,
          totalCount,
          unitSummary,
          teamName: (typeof item?.name === 'string' && item.name.trim()) ? item.name.trim() : fallbackName,
          sortOrder: Math.max(0, Math.floor(Number(item?.sortOrder) || (index + 1)))
        };
      })
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.teamName.localeCompare(b.teamName, 'zh-Hans-CN');
      }),
    [defenderDeployments, defenderRosterMap]
  );

  return {
    fieldWidth,
    fieldHeight,
    wallGroups,
    itemStockMetaMap,
    itemCatalogById,
    itemDetailModalItem,
    itemDetailModalStock,
    itemDetailInteractionLabels,
    itemDetailSocketCount,
    itemDetailColliderPartCount,
    totalItemLimit,
    totalItemRemaining,
    defenderRosterMap,
    deployedDefenderCountMap,
    defenderStockRows,
    defenderUnitTypesForFormation,
    totalDefenderPlaced,
    defenderZoneMinX,
    defenderDeploymentRows
  };
};

export default useBattlefieldComputedData;
