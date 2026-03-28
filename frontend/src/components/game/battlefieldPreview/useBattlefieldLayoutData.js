import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BattleDataService from '../../../game/battle/data/BattleDataService';

const useBattlefieldLayoutData = ({
  open = false,
  nodeId = '',
  gateKey = 'cheng',
  canEdit = false,
  layoutBundleOverride = null,
  onSaved = null,
  defaultLayoutMeta,
  editMode = false,
  resetTransientState,
  fieldWidthDefault,
  fieldHeightDefault,
  defaultMaxItemsPerType,
  normalizeItemCatalog,
  sanitizeWalls,
  sanitizeWallsWithLegacyCleanup,
  sanitizeDefenderDeployments,
  normalizeDefenderDeploymentsToRightZone,
  mapLayoutBundleToWalls,
  mapLayoutBundleToDefenderDeployments,
  buildLayoutPayload,
  recomputeMergedWallAttributes,
  readBattlefieldCache,
  writeBattlefieldCache
}) => {
  const pendingCacheSyncRef = useRef(null);
  const [walls, setWalls] = useState([]);
  const [loadingLayout, setLoadingLayout] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [cacheNeedsSync, setCacheNeedsSync] = useState(false);
  const [serverCanEdit, setServerCanEdit] = useState(!!canEdit);
  const [layoutReady, setLayoutReady] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [message, setMessage] = useState('');
  const [itemCatalog, setItemCatalog] = useState(normalizeItemCatalog([]));
  const [defenderRoster, setDefenderRoster] = useState([]);
  const [defenderDeployments, setDefenderDeployments] = useState([]);
  const [activeLayoutMeta, setActiveLayoutMeta] = useState({
    layoutId: '',
    name: '',
    fieldWidth: fieldWidthDefault,
    fieldHeight: fieldHeightDefault,
    maxItemsPerType: defaultMaxItemsPerType
  });

  const hasLayoutBundleOverride = !!(
    layoutBundleOverride
    && typeof layoutBundleOverride === 'object'
    && !Array.isArray(layoutBundleOverride)
  );
  const normalizedItemCatalog = useMemo(() => normalizeItemCatalog(itemCatalog), [itemCatalog, normalizeItemCatalog]);
  const itemCatalogById = useMemo(
    () => new Map(normalizedItemCatalog.map((item) => [item.itemId, item])),
    [normalizedItemCatalog]
  );
  const effectiveCanEdit = !!canEdit && !!serverCanEdit;

  const recomputeWallsByCurrentCatalog = useCallback((sourceWalls = []) => (
    recomputeMergedWallAttributes(sourceWalls, itemCatalogById)
  ), [itemCatalogById, recomputeMergedWallAttributes]);

  const setWallsWithRecompute = useCallback((updater) => {
    setWalls((prev) => {
      const nextRaw = typeof updater === 'function' ? updater(prev) : updater;
      return recomputeWallsByCurrentCatalog(nextRaw);
    });
  }, [recomputeWallsByCurrentCatalog]);

  useEffect(() => {
    setWalls((prev) => recomputeWallsByCurrentCatalog(prev));
  }, [recomputeWallsByCurrentCatalog]);

  const persistBattlefieldLayout = useCallback(async (nextWalls = [], options = {}) => {
    if (!open || !nodeId) return { ok: false };
    const silent = options?.silent !== false;
    const layoutMetaForSave = options?.layoutMeta || activeLayoutMeta;
    const itemCatalogForSave = options?.itemCatalog || itemCatalog;
    const defenderDeploymentsForSave = options?.defenderDeployments || defenderDeployments;
    const sanitizedWalls = sanitizeWalls(nextWalls);
    const sanitizedDefenderDeployments = sanitizeDefenderDeployments(defenderDeploymentsForSave);
    writeBattlefieldCache(nodeId, gateKey, {
      walls: sanitizedWalls,
      defenderDeployments: sanitizedDefenderDeployments,
      layoutMeta: layoutMetaForSave,
      itemCatalog: itemCatalogForSave,
      needsSync: true
    });
    setCacheNeedsSync(true);

    if (!effectiveCanEdit) {
      if (!silent) setMessage('离线缓存已保存，待网络恢复后同步');
      return { ok: true, cached: true };
    }

    const token = localStorage.getItem('token');
    if (!token) {
      if (!silent) setMessage('离线缓存已保存，待登录后同步');
      return { ok: true, cached: true };
    }

    if (!silent) setSavingLayout(true);
    try {
      const data = await BattleDataService.putBattlefieldLayout({
        nodeId,
        gateKey,
        payload: buildLayoutPayload({
          walls: sanitizedWalls,
          defenderDeployments: sanitizedDefenderDeployments,
          layoutMeta: layoutMetaForSave,
          itemCatalog: itemCatalogForSave,
          gateKey
        })
      });

      const serverLayoutBundle = (data?.layoutBundle && typeof data.layoutBundle === 'object')
        ? data.layoutBundle
        : null;
      let persistedCatalog = normalizeItemCatalog(itemCatalogForSave);
      let persistedLayoutMeta = layoutMetaForSave;
      let persistedWalls = sanitizedWalls;
      let persistedDefenderDeployments = sanitizedDefenderDeployments;

      if (serverLayoutBundle) {
        const serverCatalog = normalizeItemCatalog(serverLayoutBundle.itemCatalog);
        if (serverCatalog.length > 0) persistedCatalog = serverCatalog;
        const serverLayoutMeta = {
          layoutId: typeof serverLayoutBundle?.activeLayout?.layoutId === 'string'
            ? serverLayoutBundle.activeLayout.layoutId
            : (typeof layoutMetaForSave?.layoutId === 'string' ? layoutMetaForSave.layoutId : `${gateKey || 'cheng'}_default`),
          name: typeof serverLayoutBundle?.activeLayout?.name === 'string'
            ? serverLayoutBundle.activeLayout.name
            : (typeof layoutMetaForSave?.name === 'string' ? layoutMetaForSave.name : ''),
          fieldWidth: Number.isFinite(Number(serverLayoutBundle?.activeLayout?.fieldWidth))
            ? Number(serverLayoutBundle.activeLayout.fieldWidth)
            : Number(layoutMetaForSave?.fieldWidth) || fieldWidthDefault,
          fieldHeight: Number.isFinite(Number(serverLayoutBundle?.activeLayout?.fieldHeight))
            ? Number(serverLayoutBundle.activeLayout.fieldHeight)
            : Number(layoutMetaForSave?.fieldHeight) || fieldHeightDefault,
          maxItemsPerType: Number.isFinite(Number(serverLayoutBundle?.activeLayout?.maxItemsPerType))
            ? Math.max(defaultMaxItemsPerType, Math.floor(Number(serverLayoutBundle.activeLayout.maxItemsPerType)))
            : Math.max(defaultMaxItemsPerType, Math.floor(Number(layoutMetaForSave?.maxItemsPerType) || defaultMaxItemsPerType))
        };
        const serverWallSnapshot = sanitizeWallsWithLegacyCleanup(mapLayoutBundleToWalls({
          ...serverLayoutBundle,
          itemCatalog: persistedCatalog
        }));
        const serverResolvedDeployments = normalizeDefenderDeploymentsToRightZone(
          mapLayoutBundleToDefenderDeployments(serverLayoutBundle),
          serverLayoutMeta.fieldWidth,
          serverLayoutMeta.fieldHeight
        );
        persistedLayoutMeta = serverLayoutMeta;
        persistedWalls = serverWallSnapshot.walls;
        persistedDefenderDeployments = serverResolvedDeployments;
        setWallsWithRecompute(persistedWalls);
        setDefenderDeployments(persistedDefenderDeployments);
        setItemCatalog(persistedCatalog);
        setActiveLayoutMeta(persistedLayoutMeta);
      }

      writeBattlefieldCache(nodeId, gateKey, {
        walls: persistedWalls,
        defenderDeployments: persistedDefenderDeployments,
        layoutMeta: persistedLayoutMeta,
        itemCatalog: persistedCatalog,
        needsSync: false,
        message: ''
      });
      setCacheNeedsSync(false);
      setErrorText('');

      if (typeof onSaved === 'function') {
        try {
          onSaved({
            nodeId,
            gateKey,
            layoutBundle: data?.layoutBundle && typeof data.layoutBundle === 'object'
              ? data.layoutBundle
              : null
          });
        } catch {
          // Ignore callback failures to avoid breaking save success flow.
        }
      }

      if (!silent) setMessage(data.message || '战场布局已保存');
      return { ok: true };
    } catch (error) {
      setErrorText(`保存战场布局失败: ${error.message}`);
      writeBattlefieldCache(nodeId, gateKey, {
        walls: sanitizedWalls,
        defenderDeployments: sanitizedDefenderDeployments,
        layoutMeta: layoutMetaForSave,
        itemCatalog: itemCatalogForSave,
        needsSync: true,
        message: error.message
      });
      setCacheNeedsSync(true);
      if (!silent) setMessage('网络异常，已写入本地缓存，待自动同步');
      return { ok: false, error: error.message };
    } finally {
      if (!silent) setSavingLayout(false);
    }
  }, [
    activeLayoutMeta,
    buildLayoutPayload,
    defaultMaxItemsPerType,
    defenderDeployments,
    effectiveCanEdit,
    fieldHeightDefault,
    fieldWidthDefault,
    gateKey,
    itemCatalog,
    mapLayoutBundleToDefenderDeployments,
    mapLayoutBundleToWalls,
    nodeId,
    normalizeDefenderDeploymentsToRightZone,
    normalizeItemCatalog,
    onSaved,
    open,
    sanitizeDefenderDeployments,
    sanitizeWalls,
    sanitizeWallsWithLegacyCleanup,
    setWallsWithRecompute,
    writeBattlefieldCache
  ]);

  useEffect(() => {
    if (!open || !nodeId) return;
    let cancelled = false;
    const token = localStorage.getItem('token');
    const localCache = readBattlefieldCache(nodeId, gateKey);
    const overrideBundle = hasLayoutBundleOverride ? layoutBundleOverride : null;

    const resolveOverrideSnapshot = () => {
      const sourceBundle = overrideBundle && typeof overrideBundle === 'object' ? overrideBundle : {};
      const overrideCatalog = normalizeItemCatalog(sourceBundle.itemCatalog);
      const overrideMeta = {
        layoutId: typeof sourceBundle?.activeLayout?.layoutId === 'string'
          ? sourceBundle.activeLayout.layoutId
          : defaultLayoutMeta.layoutId,
        name: typeof sourceBundle?.activeLayout?.name === 'string'
          ? sourceBundle.activeLayout.name
          : '',
        fieldWidth: Number.isFinite(Number(sourceBundle?.activeLayout?.fieldWidth))
          ? Number(sourceBundle.activeLayout.fieldWidth)
          : defaultLayoutMeta.fieldWidth,
        fieldHeight: Number.isFinite(Number(sourceBundle?.activeLayout?.fieldHeight))
          ? Number(sourceBundle.activeLayout.fieldHeight)
          : defaultLayoutMeta.fieldHeight,
        maxItemsPerType: Number.isFinite(Number(sourceBundle?.activeLayout?.maxItemsPerType))
          ? Math.max(defaultMaxItemsPerType, Math.floor(Number(sourceBundle.activeLayout.maxItemsPerType)))
          : defaultMaxItemsPerType
      };
      const overrideWallSnapshot = sanitizeWallsWithLegacyCleanup(mapLayoutBundleToWalls(sourceBundle));
      return {
        walls: overrideWallSnapshot.walls,
        defenderDeployments: [],
        itemCatalog: overrideCatalog,
        layoutMeta: overrideMeta
      };
    };

    const resolveCacheSnapshot = () => {
      const cachedCatalog = normalizeItemCatalog(localCache?.itemCatalog);
      const cachedMeta = localCache?.layoutMeta && typeof localCache.layoutMeta === 'object'
        ? {
          layoutId: typeof localCache.layoutMeta.layoutId === 'string' ? localCache.layoutMeta.layoutId : defaultLayoutMeta.layoutId,
          name: typeof localCache.layoutMeta.name === 'string' ? localCache.layoutMeta.name : '',
          fieldWidth: Number.isFinite(Number(localCache.layoutMeta.fieldWidth))
            ? Number(localCache.layoutMeta.fieldWidth)
            : defaultLayoutMeta.fieldWidth,
          fieldHeight: Number.isFinite(Number(localCache.layoutMeta.fieldHeight))
            ? Number(localCache.layoutMeta.fieldHeight)
            : defaultLayoutMeta.fieldHeight,
          maxItemsPerType: Number.isFinite(Number(localCache.layoutMeta.maxItemsPerType))
            ? Math.max(defaultMaxItemsPerType, Math.floor(Number(localCache.layoutMeta.maxItemsPerType)))
            : defaultMaxItemsPerType
        }
        : defaultLayoutMeta;
      const cachedWallSnapshot = sanitizeWallsWithLegacyCleanup(localCache?.walls);
      const cachedResolvedDeployments = normalizeDefenderDeploymentsToRightZone(
        localCache?.defenderDeployments,
        cachedMeta.fieldWidth,
        cachedMeta.fieldHeight
      );
      return {
        walls: cachedWallSnapshot.walls,
        defenderDeployments: cachedResolvedDeployments,
        itemCatalog: cachedCatalog,
        layoutMeta: cachedMeta,
        needsSync: !!localCache?.needsSync || cachedWallSnapshot.clearedLegacy,
        clearedLegacy: cachedWallSnapshot.clearedLegacy
      };
    };

    const loadLayout = async () => {
      setLoadingLayout(true);
      setLayoutReady(false);
      setErrorText('');

      if (overrideBundle) {
        const overrideSnapshot = resolveOverrideSnapshot();
        if (!cancelled) {
          setWallsWithRecompute(overrideSnapshot.walls);
          setDefenderDeployments(overrideSnapshot.defenderDeployments);
          setItemCatalog(overrideSnapshot.itemCatalog);
          setDefenderRoster([]);
          setActiveLayoutMeta(overrideSnapshot.layoutMeta);
          setServerCanEdit(false);
          setCacheNeedsSync(false);
          setMessage('');
          setLoadingLayout(false);
          setLayoutReady(true);
        }
        return;
      }

      const cacheSnapshot = resolveCacheSnapshot();
      if (!token) {
        if (!cancelled) {
          setWallsWithRecompute(cacheSnapshot.walls);
          setDefenderDeployments(cacheSnapshot.defenderDeployments);
          setItemCatalog(cacheSnapshot.itemCatalog);
          setDefenderRoster([]);
          setActiveLayoutMeta(cacheSnapshot.layoutMeta);
          setServerCanEdit(!!canEdit);
          setCacheNeedsSync(cacheSnapshot.needsSync);
          setLoadingLayout(false);
          setLayoutReady(true);
          if (cacheSnapshot.needsSync) {
            setMessage(cacheSnapshot.clearedLegacy
              ? '已清空旧版默认战场物体，登录后将自动同步到服务端'
              : '本地存在待同步布局，登录后将自动同步');
          } else {
            setErrorText('未登录，已加载本地战场布局');
          }
        }
        return;
      }

      try {
        const data = await BattleDataService.getBattlefieldLayout({
          nodeId,
          gateKey: gateKey || 'cheng'
        });

        if (cancelled) return;
        const layoutBundle = (data?.layoutBundle && typeof data.layoutBundle === 'object') ? data.layoutBundle : {};
        const nextCatalog = normalizeItemCatalog(layoutBundle.itemCatalog);
        const serverLayoutMeta = {
          layoutId: typeof layoutBundle?.activeLayout?.layoutId === 'string' ? layoutBundle.activeLayout.layoutId : `${gateKey || 'cheng'}_default`,
          name: typeof layoutBundle?.activeLayout?.name === 'string' ? layoutBundle.activeLayout.name : '',
          fieldWidth: Number.isFinite(Number(layoutBundle?.activeLayout?.fieldWidth)) ? Number(layoutBundle.activeLayout.fieldWidth) : fieldWidthDefault,
          fieldHeight: Number.isFinite(Number(layoutBundle?.activeLayout?.fieldHeight)) ? Number(layoutBundle.activeLayout.fieldHeight) : fieldHeightDefault,
          maxItemsPerType: Number.isFinite(Number(layoutBundle?.activeLayout?.maxItemsPerType))
            ? Math.max(defaultMaxItemsPerType, Number(layoutBundle.activeLayout.maxItemsPerType))
            : defaultMaxItemsPerType
        };
        const serverWallSnapshot = sanitizeWallsWithLegacyCleanup(mapLayoutBundleToWalls(layoutBundle));
        const serverResolvedDeployments = normalizeDefenderDeploymentsToRightZone(
          mapLayoutBundleToDefenderDeployments(layoutBundle),
          serverLayoutMeta.fieldWidth,
          serverLayoutMeta.fieldHeight
        );
        const serverWalls = serverWallSnapshot.walls;
        const rosterRows = Array.isArray(data?.defenderRoster) ? data.defenderRoster : [];
        setDefenderRoster(rosterRows);
        const canEditByServer = !!data.canEdit;
        setServerCanEdit(canEditByServer);
        const serverItemIdSet = new Set(nextCatalog.map((item) => item.itemId).filter(Boolean));
        const filteredCacheWalls = cacheSnapshot.walls.filter((wall) => serverItemIdSet.has(wall?.itemId));
        const removedLegacyCacheWalls = cacheSnapshot.walls.length - filteredCacheWalls.length;

        if (cacheSnapshot.needsSync && canEditByServer) {
          setWallsWithRecompute(filteredCacheWalls);
          setDefenderDeployments(cacheSnapshot.defenderDeployments);
          setItemCatalog(nextCatalog);
          setActiveLayoutMeta(cacheSnapshot.layoutMeta);
          setCacheNeedsSync(true);
          pendingCacheSyncRef.current = {
            walls: filteredCacheWalls,
            defenderDeployments: cacheSnapshot.defenderDeployments,
            layoutMeta: cacheSnapshot.layoutMeta,
            itemCatalog: nextCatalog
          };
          setMessage((cacheSnapshot.clearedLegacy || removedLegacyCacheWalls > 0)
            ? '已清空旧版默认战场物体，正在回写服务端'
            : '检测到离线改动，正在尝试回写服务端');
        } else {
          const shouldSyncLegacyCleanup = serverWallSnapshot.clearedLegacy && canEditByServer;
          setWallsWithRecompute(serverWalls);
          setDefenderDeployments(serverResolvedDeployments);
          setItemCatalog(nextCatalog);
          setActiveLayoutMeta(serverLayoutMeta);
          setCacheNeedsSync(shouldSyncLegacyCleanup);
          if (shouldSyncLegacyCleanup) {
            pendingCacheSyncRef.current = {
              walls: serverWalls,
              defenderDeployments: serverResolvedDeployments,
              layoutMeta: serverLayoutMeta,
              itemCatalog: nextCatalog
            };
            setMessage('检测到旧版默认战场物体，已自动清空并准备同步');
          } else if (serverWallSnapshot.clearedLegacy) {
            setMessage('检测到旧版默认战场物体，已自动清空');
          }
          writeBattlefieldCache(nodeId, gateKey, {
            walls: serverWalls,
            defenderDeployments: serverResolvedDeployments,
            itemCatalog: nextCatalog,
            layoutMeta: serverLayoutMeta,
            needsSync: shouldSyncLegacyCleanup
          });
        }
        setErrorText('');
      } catch (error) {
        if (cancelled) return;
        const cacheSnapshot = resolveCacheSnapshot();
        setWallsWithRecompute(cacheSnapshot.walls);
        setDefenderDeployments(cacheSnapshot.defenderDeployments);
        setItemCatalog(cacheSnapshot.itemCatalog);
        setDefenderRoster([]);
        setActiveLayoutMeta(cacheSnapshot.layoutMeta);
        setServerCanEdit(!!canEdit);
        setCacheNeedsSync(cacheSnapshot.needsSync);
        setErrorText(`加载战场布局失败: ${error.message}，已使用本地缓存`);
      } finally {
        if (cancelled) return;
        setLoadingLayout(false);
        setLayoutReady(true);
      }
    };

    pendingCacheSyncRef.current = null;
    resetTransientState();
    loadLayout();

    return () => {
      cancelled = true;
    };
  }, [
    canEdit,
    defaultLayoutMeta,
    defaultMaxItemsPerType,
    fieldHeightDefault,
    fieldWidthDefault,
    gateKey,
    hasLayoutBundleOverride,
    layoutBundleOverride,
    mapLayoutBundleToDefenderDeployments,
    mapLayoutBundleToWalls,
    nodeId,
    normalizeDefenderDeploymentsToRightZone,
    normalizeItemCatalog,
    open,
    readBattlefieldCache,
    resetTransientState,
    sanitizeWallsWithLegacyCleanup,
    setWallsWithRecompute,
    writeBattlefieldCache
  ]);

  useEffect(() => {
    if (!open || !layoutReady || !pendingCacheSyncRef.current) return;
    if (!effectiveCanEdit) return;
    const payload = pendingCacheSyncRef.current;
    pendingCacheSyncRef.current = null;
    persistBattlefieldLayout(payload.walls, {
      silent: true,
      layoutMeta: payload.layoutMeta,
      itemCatalog: payload.itemCatalog,
      defenderDeployments: payload.defenderDeployments
    }).then((result) => {
      if (result?.ok && !result?.cached) {
        setMessage('离线缓存已同步到服务端');
      }
    });
  }, [effectiveCanEdit, layoutReady, open, persistBattlefieldLayout]);

  useEffect(() => {
    if (!open || !layoutReady || !cacheNeedsSync || !effectiveCanEdit) return undefined;
    if (editMode) return undefined;
    let syncing = false;
    const trySync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const result = await persistBattlefieldLayout(walls, { silent: true });
        if (result?.ok && !result?.cached) {
          setMessage('离线缓存已同步到服务端');
        }
      } finally {
        syncing = false;
      }
    };
    const handleOnline = () => {
      trySync();
    };
    window.addEventListener('online', handleOnline);
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      trySync();
    }
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [cacheNeedsSync, editMode, effectiveCanEdit, layoutReady, open, persistBattlefieldLayout, walls]);

  return {
    walls,
    setWallsWithRecompute,
    loadingLayout,
    savingLayout,
    cacheNeedsSync,
    serverCanEdit,
    layoutReady,
    errorText,
    setErrorText,
    message,
    setMessage,
    itemCatalog,
    setItemCatalog,
    normalizedItemCatalog,
    defenderRoster,
    setDefenderRoster,
    defenderDeployments,
    setDefenderDeployments,
    activeLayoutMeta,
    setActiveLayoutMeta,
    persistBattlefieldLayout
  };
};

export default useBattlefieldLayoutData;
