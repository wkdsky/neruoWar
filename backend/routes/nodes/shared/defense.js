module.exports = ({
  normalizeBattlefieldLayout,
  normalizeBattlefieldItemGeometryScale,
  resolveNodeBattlefieldLayout,
  BATTLEFIELD_FIELD_WIDTH,
  BATTLEFIELD_FIELD_HEIGHT,
  BATTLEFIELD_OBJECT_DEFAULT_WIDTH,
  BATTLEFIELD_OBJECT_DEFAULT_DEPTH,
  BATTLEFIELD_OBJECT_DEFAULT_HEIGHT,
  normalizeGateDefenseViewerAdminIds
}) => {
  const CITY_BUILDING_LIMIT = 3;
  const CITY_BUILDING_DEFAULT_RADIUS = 0.17;
  const CITY_BUILDING_MIN_DISTANCE = 0.34;
  const CITY_BUILDING_MAX_DISTANCE = 0.86;
  const CITY_GATE_KEYS = ['cheng', 'qi'];
  const USER_INTEL_SNAPSHOT_LIMIT = 5;
  const CITY_GATE_LABELS = {
    cheng: '承门',
    qi: '启门'
  };
  const BATTLEFIELD_DEPLOY_ZONE_RATIO = 0.2;

  const round3 = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Number(parsed.toFixed(3));
  };

  const createDefaultDefenseLayout = () => ({
    buildings: [],
    intelBuildingId: '',
    gateDefense: {
      cheng: [],
      qi: []
    },
    gateDefenseViewAdminIds: []
  });

  const normalizeDefenseLayoutInput = (input = {}) => {
    const source = input && typeof input === 'object' ? input : {};
    const sourceBuildings = Array.isArray(source.buildings) ? source.buildings : [];
    const normalized = [];
    const seen = new Set();
    for (let index = 0; index < sourceBuildings.length; index += 1) {
      const item = sourceBuildings[index] || {};
      const rawId = typeof item.buildingId === 'string' ? item.buildingId.trim() : '';
      const buildingId = rawId || `building_${Date.now()}_${index}`;
      if (seen.has(buildingId)) continue;
      seen.add(buildingId);
      normalized.push({
        buildingId,
        buildingTypeId: typeof item?.buildingTypeId === 'string' ? item.buildingTypeId.trim() : '',
        name: (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : `建筑${normalized.length + 1}`,
        x: Math.max(-1, Math.min(1, round3(item.x, 0))),
        y: Math.max(-1, Math.min(1, round3(item.y, 0))),
        radius: Math.max(0.1, Math.min(0.24, round3(item.radius, CITY_BUILDING_DEFAULT_RADIUS))),
        level: Math.max(1, parseInt(item.level, 10) || 1),
        nextUnitTypeId: typeof item.nextUnitTypeId === 'string' ? item.nextUnitTypeId.trim() : '',
        upgradeCostKP: Number.isFinite(Number(item.upgradeCostKP)) && Number(item.upgradeCostKP) >= 0
          ? Number(Number(item.upgradeCostKP).toFixed(2))
          : null
      });
      if (normalized.length >= CITY_BUILDING_LIMIT) break;
    }

    if (normalized.length === 0) {
      return createDefaultDefenseLayout();
    }

    const isInsideDomain = (item) => Math.sqrt((item.x ** 2) + (item.y ** 2)) <= CITY_BUILDING_MAX_DISTANCE;
    const overlapsOther = (item, others, selfId) => others.some((target) => {
      if (target.buildingId === selfId) return false;
      const dx = item.x - target.x;
      const dy = item.y - target.y;
      return Math.sqrt((dx ** 2) + (dy ** 2)) < CITY_BUILDING_MIN_DISTANCE;
    });

    const valid = normalized.every((item) => isInsideDomain(item) && !overlapsOther(item, normalized, item.buildingId));
    if (!valid) {
      const error = new Error('建筑位置无效：建筑必须位于城区内且互不重叠');
      error.statusCode = 400;
      throw error;
    }

    const sourceIntelBuildingId = typeof source.intelBuildingId === 'string' ? source.intelBuildingId.trim() : '';
    const intelBuildingId = normalized.some((item) => item.buildingId === sourceIntelBuildingId)
      ? sourceIntelBuildingId
      : (normalized[0]?.buildingId || '');

    const sourceGateDefense = source.gateDefense && typeof source.gateDefense === 'object'
      ? source.gateDefense
      : {};
    const normalizeGateDefenseEntries = (entries = []) => {
      const out = [];
      const seenEntries = new Set();
      for (const entry of (Array.isArray(entries) ? entries : [])) {
        const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
        const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
        if (!unitTypeId || count <= 0) continue;
        if (seenEntries.has(unitTypeId)) continue;
        seenEntries.add(unitTypeId);
        out.push({ unitTypeId, count });
      }
      return out;
    };
    const gateDefense = CITY_GATE_KEYS.reduce((acc, key) => {
      acc[key] = normalizeGateDefenseEntries(sourceGateDefense[key]);
      return acc;
    }, { cheng: [], qi: [] });
    const gateDefenseViewAdminIds = normalizeGateDefenseViewerAdminIds(source.gateDefenseViewAdminIds);

    return {
      buildings: normalized,
      intelBuildingId,
      gateDefense,
      gateDefenseViewAdminIds
    };
  };

  const serializeDefenseLayout = (layout = {}) => {
    let normalized;
    try {
      normalized = normalizeDefenseLayoutInput(layout);
    } catch (error) {
      normalized = createDefaultDefenseLayout();
    }
    return {
      buildings: normalized.buildings.map((item) => ({
        buildingId: item.buildingId,
        buildingTypeId: typeof item?.buildingTypeId === 'string' ? item.buildingTypeId : '',
        name: item.name || '',
        x: round3(item.x, 0),
        y: round3(item.y, 0),
        radius: round3(item.radius, CITY_BUILDING_DEFAULT_RADIUS),
        level: Number(item.level || 1),
        nextUnitTypeId: item.nextUnitTypeId || '',
        upgradeCostKP: Number.isFinite(Number(item.upgradeCostKP)) ? Number(item.upgradeCostKP) : null
      })),
      intelBuildingId: normalized.intelBuildingId,
      gateDefense: CITY_GATE_KEYS.reduce((acc, key) => {
        const entries = Array.isArray(normalized?.gateDefense?.[key]) ? normalized.gateDefense[key] : [];
        acc[key] = entries
          .map((entry) => ({
            unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
            count: Math.max(0, Math.floor(Number(entry?.count) || 0))
          }))
          .filter((entry) => entry.unitTypeId && entry.count > 0);
        return acc;
      }, { cheng: [], qi: [] }),
      gateDefenseViewAdminIds: normalizeGateDefenseViewerAdminIds(normalized.gateDefenseViewAdminIds)
    };
  };

  const normalizeBattlefieldGateKey = (value = '') => (
    CITY_GATE_KEYS.includes(value) ? value : CITY_GATE_KEYS[0]
  );

  const normalizeBattlefieldLayoutId = (value = '') => (
    typeof value === 'string' ? value.trim() : ''
  );

  const normalizeBattlefieldStateInput = (input = {}) => (
    normalizeBattlefieldLayout(input || {})
  );

  const findBattlefieldLayoutByGate = (battlefieldState = {}, gateKey = '', preferredLayoutId = '') => {
    const layouts = Array.isArray(battlefieldState?.layouts) ? battlefieldState.layouts : [];
    const targetGate = normalizeBattlefieldGateKey(gateKey);
    const targetLayoutId = normalizeBattlefieldLayoutId(preferredLayoutId);
    if (targetLayoutId) {
      const matched = layouts.find((item) => (
        item?.layoutId === targetLayoutId
        && (!targetGate || item?.gateKey === targetGate)
      ));
      if (matched) return matched;
    }

    const gateLayouts = layouts.filter((item) => item?.gateKey === targetGate);
    if (gateLayouts.length > 0) {
      gateLayouts.sort((a, b) => {
        const aTime = new Date(a?.updatedAt || 0).getTime();
        const bTime = new Date(b?.updatedAt || 0).getTime();
        return bTime - aTime;
      });
      return gateLayouts[0];
    }
    return layouts[0] || null;
  };

  const serializeBattlefieldLayoutMeta = (layout = {}) => ({
    layoutId: typeof layout?.layoutId === 'string' ? layout.layoutId : '',
    name: typeof layout?.name === 'string' ? layout.name : '',
    gateKey: CITY_GATE_KEYS.includes(layout?.gateKey) ? layout.gateKey : '',
    fieldWidth: round3(layout?.fieldWidth, BATTLEFIELD_FIELD_WIDTH),
    fieldHeight: round3(layout?.fieldHeight, BATTLEFIELD_FIELD_HEIGHT),
    maxItemsPerType: Math.max(10, Math.floor(Number(layout?.maxItemsPerType) || 10)),
    updatedAt: layout?.updatedAt || null
  });

  const serializeBattlefieldItemCatalog = (items = []) => (
    (Array.isArray(items) ? items : [])
      .map((item) => normalizeBattlefieldItemGeometryScale(item))
      .map((item) => ({
        itemId: typeof item?.itemId === 'string'
          ? item.itemId
          : (typeof item?.itemType === 'string' ? item.itemType : ''),
        name: typeof item?.name === 'string' ? item.name : '',
        description: typeof item?.description === 'string' ? item.description : '',
        initialCount: Math.max(0, Math.floor(Number(item?.initialCount) || 0)),
        width: round3(item?.width, BATTLEFIELD_OBJECT_DEFAULT_WIDTH),
        depth: round3(item?.depth, BATTLEFIELD_OBJECT_DEFAULT_DEPTH),
        height: round3(item?.height, BATTLEFIELD_OBJECT_DEFAULT_HEIGHT),
        hp: Math.max(1, Math.floor(Number(item?.hp) || 240)),
        defense: round3(item?.defense, 1.1),
        style: item?.style && typeof item.style === 'object' ? item.style : {},
        collider: item?.collider && typeof item.collider === 'object' ? item.collider : null,
        renderProfile: item?.renderProfile && typeof item.renderProfile === 'object' ? item.renderProfile : null,
        interactions: Array.isArray(item?.interactions) ? item.interactions : [],
        sockets: Array.isArray(item?.sockets) ? item.sockets : [],
        maxStack: Number.isFinite(Number(item?.maxStack)) ? Math.max(1, Math.floor(Number(item.maxStack))) : null,
        requiresSupport: item?.requiresSupport === true,
        snapPriority: Number.isFinite(Number(item?.snapPriority)) ? Number(item.snapPriority) : 0
      }))
      .filter((item) => !!item.itemId)
  );

  const serializeBattlefieldObjectsForLayout = (battlefieldState = {}, layoutId = '', validItemIdSet = null) => (
    (Array.isArray(battlefieldState?.objects) ? battlefieldState.objects : [])
      .filter((item) => !layoutId || item?.layoutId === layoutId)
      .filter((item) => {
        if (!(validItemIdSet instanceof Set) || validItemIdSet.size <= 0) return true;
        const itemId = typeof item?.itemId === 'string'
          ? item.itemId
          : (typeof item?.itemType === 'string' ? item.itemType : '');
        return validItemIdSet.has(itemId);
      })
      .map((item) => ({
        id: typeof item?.objectId === 'string' ? item.objectId : '',
        objectId: typeof item?.objectId === 'string' ? item.objectId : '',
        layoutId: typeof item?.layoutId === 'string' ? item.layoutId : '',
        itemId: typeof item?.itemId === 'string'
          ? item.itemId
          : (typeof item?.itemType === 'string' ? item.itemType : ''),
        x: round3(item?.x, 0),
        y: round3(item?.y, 0),
        z: Math.max(0, round3(item?.z, 0)),
        rotation: round3(item?.rotation, 0),
        attach: item?.attach && typeof item.attach === 'object'
          ? {
              parentObjectId: typeof item.attach.parentObjectId === 'string' ? item.attach.parentObjectId : '',
              parentSocketId: typeof item.attach.parentSocketId === 'string' ? item.attach.parentSocketId : '',
              childSocketId: typeof item.attach.childSocketId === 'string' ? item.attach.childSocketId : ''
            }
          : null,
        groupId: typeof item?.groupId === 'string' ? item.groupId : ''
      }))
      .filter((item) => !!item.id)
  );

  const normalizeDefenderDeploymentUnits = (row = {}) => {
    const sourceUnits = Array.isArray(row?.units)
      ? row.units
      : [{ unitTypeId: row?.unitTypeId, count: row?.count }];
    const unitMap = new Map();
    sourceUnits.forEach((entry) => {
      const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
      const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
      if (!unitTypeId || count <= 0) return;
      unitMap.set(unitTypeId, (unitMap.get(unitTypeId) || 0) + count);
    });
    return Array.from(unitMap.entries())
      .map(([unitTypeId, count]) => ({ unitTypeId, count }))
      .sort((a, b) => b.count - a.count);
  };

  const serializeBattlefieldDefenderDeploymentsForLayout = (battlefieldState = {}, layoutId = '') => (
    (Array.isArray(battlefieldState?.defenderDeployments) ? battlefieldState.defenderDeployments : [])
      .filter((item) => !layoutId || item?.layoutId === layoutId)
      .map((item) => {
        const units = normalizeDefenderDeploymentUnits(item);
        if (units.length <= 0) return null;
        const primary = units[0];
        return {
          id: typeof item?.deployId === 'string' ? item.deployId : '',
          deployId: typeof item?.deployId === 'string' ? item.deployId : '',
          layoutId: typeof item?.layoutId === 'string' ? item.layoutId : '',
          name: typeof item?.name === 'string' ? item.name : '',
          sortOrder: Math.max(0, Math.floor(Number(item?.sortOrder) || 0)),
          placed: item?.placed !== false,
          units,
          unitTypeId: primary.unitTypeId,
          count: primary.count,
          x: round3(item?.x, 0),
          y: round3(item?.y, 0),
          rotation: Number.isFinite(Number(item?.rotation)) ? round3(item.rotation, 0) : undefined
        };
      })
      .filter((item) => !!item?.id)
  );

  const serializeBattlefieldStateForGate = (battlefieldState = {}, gateKey = '', preferredLayoutId = '') => {
    const normalized = normalizeBattlefieldStateInput(battlefieldState);
    const rawItemCatalog = Array.isArray(battlefieldState?.items) ? battlefieldState.items : [];
    const itemCatalogSource = rawItemCatalog.length > 0 ? rawItemCatalog : normalized?.items;
    const serializedCatalog = serializeBattlefieldItemCatalog(itemCatalogSource);
    const validItemIdSet = new Set(
      serializedCatalog
        .map((item) => item.itemId)
        .filter(Boolean)
    );
    const activeLayout = findBattlefieldLayoutByGate(normalized, gateKey, preferredLayoutId);
    const activeLayoutId = activeLayout?.layoutId || '';
    return {
      version: Math.max(1, Math.floor(Number(normalized?.version) || 1)),
      activeLayout: activeLayout ? serializeBattlefieldLayoutMeta(activeLayout) : null,
      layouts: (Array.isArray(normalized?.layouts) ? normalized.layouts : []).map((layout) => serializeBattlefieldLayoutMeta(layout)),
      itemCatalog: serializedCatalog,
      objects: serializeBattlefieldObjectsForLayout(normalized, activeLayoutId, validItemIdSet),
      defenderDeployments: serializeBattlefieldDefenderDeploymentsForLayout(normalized, activeLayoutId),
      updatedAt: normalized?.updatedAt || null
    };
  };

  const mergeBattlefieldStateByGate = (currentState = {}, gateKey = '', payload = {}) => {
    const normalizedCurrent = normalizeBattlefieldStateInput(currentState);
    const targetGate = normalizeBattlefieldGateKey(gateKey);
    const sourceLayout = payload?.layout && typeof payload.layout === 'object'
      ? payload.layout
      : payload;
    const requestedLayoutId = normalizeBattlefieldLayoutId(payload?.layoutId || sourceLayout?.layoutId);
    const sourceObjects = Array.isArray(payload?.objects)
      ? payload.objects
      : (Array.isArray(sourceLayout?.objects) ? sourceLayout.objects : []);
    const sourceDefenderDeployments = Array.isArray(payload?.defenderDeployments)
      ? payload.defenderDeployments
      : (Array.isArray(sourceLayout?.defenderDeployments) ? sourceLayout.defenderDeployments : []);
    const sourceItems = Array.isArray(payload?.itemCatalog) ? payload.itemCatalog : null;

    const currentLayouts = Array.isArray(normalizedCurrent.layouts) ? normalizedCurrent.layouts : [];
    const currentItems = Array.isArray(normalizedCurrent.items) ? normalizedCurrent.items : [];
    const currentObjects = Array.isArray(normalizedCurrent.objects) ? normalizedCurrent.objects : [];
    const currentDefenderDeployments = Array.isArray(normalizedCurrent.defenderDeployments) ? normalizedCurrent.defenderDeployments : [];
    const existingLayout = findBattlefieldLayoutByGate(normalizedCurrent, targetGate, requestedLayoutId);
    const hasCrossGateLayoutIdConflict = !!requestedLayoutId && currentLayouts.some((layout) => (
      layout?.layoutId === requestedLayoutId
      && layout?.gateKey
      && layout.gateKey !== targetGate
    ));
    const safeRequestedLayoutId = hasCrossGateLayoutIdConflict ? '' : requestedLayoutId;
    const fallbackLayoutId = safeRequestedLayoutId || existingLayout?.layoutId || `${targetGate}_default`;
    const sourceLayoutId = typeof sourceLayout?.layoutId === 'string' ? sourceLayout.layoutId.trim() : '';
    const safeSourceLayoutId = sourceLayoutId && !hasCrossGateLayoutIdConflict ? sourceLayoutId : '';

    const targetLayout = {
      ...(existingLayout || {}),
      layoutId: safeSourceLayoutId || fallbackLayoutId,
      name: typeof sourceLayout?.name === 'string' && sourceLayout.name.trim()
        ? sourceLayout.name.trim()
        : (existingLayout?.name || (targetGate === 'cheng' ? '承门战场' : '启门战场')),
      gateKey: targetGate,
      fieldWidth: Number.isFinite(Number(sourceLayout?.fieldWidth)) ? Number(sourceLayout.fieldWidth) : existingLayout?.fieldWidth,
      fieldHeight: Number.isFinite(Number(sourceLayout?.fieldHeight)) ? Number(sourceLayout.fieldHeight) : existingLayout?.fieldHeight,
      maxItemsPerType: Number.isFinite(Number(sourceLayout?.maxItemsPerType)) ? Number(sourceLayout.maxItemsPerType) : existingLayout?.maxItemsPerType,
      updatedAt: new Date()
    };

    const nextLayoutsRaw = [];
    const seenLayoutIds = new Set();
    const targetLayoutId = targetLayout.layoutId;
    currentLayouts.forEach((layout) => {
      if (!layout || typeof layout !== 'object') return;
      if (layout.layoutId === targetLayoutId) return;
      if (seenLayoutIds.has(layout.layoutId)) return;
      seenLayoutIds.add(layout.layoutId);
      nextLayoutsRaw.push(layout);
    });
    nextLayoutsRaw.push(targetLayout);

    const incomingObjectsRaw = sourceObjects.map((item, index) => ({
      layoutId: targetLayoutId,
      objectId: (typeof item?.objectId === 'string' && item.objectId.trim())
        ? item.objectId.trim()
        : ((typeof item?.id === 'string' && item.id.trim()) ? item.id.trim() : `obj_${index + 1}`),
      itemId: (typeof item?.itemId === 'string' && item.itemId.trim())
        ? item.itemId.trim()
        : ((typeof item?.itemType === 'string' && item.itemType.trim())
          ? item.itemType.trim()
          : (typeof item?.type === 'string' && item.type.trim() ? item.type.trim() : '')),
      x: item?.x,
      y: item?.y,
      z: item?.z,
      rotation: item?.rotation,
      attach: item?.attach && typeof item.attach === 'object'
        ? {
            parentObjectId: typeof item.attach.parentObjectId === 'string' ? item.attach.parentObjectId.trim() : '',
            parentSocketId: typeof item.attach.parentSocketId === 'string' ? item.attach.parentSocketId.trim() : '',
            childSocketId: typeof item.attach.childSocketId === 'string' ? item.attach.childSocketId.trim() : ''
          }
        : null,
      groupId: typeof item?.groupId === 'string' ? item.groupId.trim() : ''
    }));
    const retainedObjects = currentObjects.filter((item) => item?.layoutId !== targetLayoutId);
    const nextObjectsRaw = [...retainedObjects, ...incomingObjectsRaw];

    const incomingDefenderDeploymentsRaw = sourceDefenderDeployments.map((item, index) => {
      const units = normalizeDefenderDeploymentUnits(item);
      if (units.length <= 0) return null;
      const primary = units[0];
      return {
        layoutId: targetLayoutId,
        deployId: (typeof item?.deployId === 'string' && item.deployId.trim())
          ? item.deployId.trim()
          : ((typeof item?.id === 'string' && item.id.trim()) ? item.id.trim() : `deploy_${index + 1}`),
        name: typeof item?.name === 'string' ? item.name.trim() : '',
        sortOrder: Math.max(0, Math.floor(Number(item?.sortOrder) || 0)),
        placed: item?.placed !== false,
        units,
        unitTypeId: primary.unitTypeId,
        count: primary.count,
        x: item?.x,
        y: item?.y,
        rotation: item?.rotation
      };
    }).filter((item) => !!item?.deployId);
    const retainedDefenderDeployments = currentDefenderDeployments.filter((item) => item?.layoutId !== targetLayoutId);
    const nextDefenderDeploymentsRaw = [...retainedDefenderDeployments, ...incomingDefenderDeploymentsRaw];

    return normalizeBattlefieldStateInput({
      version: normalizedCurrent.version,
      layouts: nextLayoutsRaw,
      items: sourceItems || currentItems,
      objects: nextObjectsRaw,
      defenderDeployments: nextDefenderDeploymentsRaw,
      updatedAt: new Date()
    });
  };

  const getArmyUnitTypeId = (unit) => {
    const unitTypeId = typeof unit?.unitTypeId === 'string' ? unit.unitTypeId.trim() : '';
    if (unitTypeId) return unitTypeId;
    return typeof unit?.id === 'string' ? unit.id.trim() : '';
  };

  const buildArmyUnitTypeMap = (unitTypes = []) => {
    const map = new Map();
    (Array.isArray(unitTypes) ? unitTypes : []).forEach((item) => {
      const id = getArmyUnitTypeId(item);
      if (!id) return;
      map.set(id, item);
    });
    return map;
  };

  const normalizeUnitCountEntries = (entries = []) => {
    const out = [];
    const seen = new Set();
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
      const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
      if (!unitTypeId || count <= 0 || seen.has(unitTypeId)) continue;
      seen.add(unitTypeId);
      out.push({ unitTypeId, count });
    }
    return out;
  };

  const buildUnitCountMap = (entries = []) => {
    const map = new Map();
    normalizeUnitCountEntries(entries).forEach((entry) => {
      map.set(entry.unitTypeId, (map.get(entry.unitTypeId) || 0) + entry.count);
    });
    return map;
  };

  const mergeUnitCountMaps = (...maps) => {
    const merged = new Map();
    maps.forEach((map) => {
      if (!(map instanceof Map)) return;
      for (const [unitTypeId, count] of map.entries()) {
        const normalized = Math.max(0, Math.floor(Number(count) || 0));
        if (!unitTypeId || normalized <= 0) continue;
        merged.set(unitTypeId, (merged.get(unitTypeId) || 0) + normalized);
      }
    });
    return merged;
  };

  const mapToUnitCountEntries = (countMap = new Map(), unitTypeMap = new Map()) => {
    if (!(countMap instanceof Map)) return [];
    return Array.from(countMap.entries())
      .map(([unitTypeId, count]) => {
        const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
        if (!unitTypeId || normalizedCount <= 0) return null;
        const unitType = unitTypeMap.get(unitTypeId);
        return {
          unitTypeId,
          unitName: unitType?.name || unitTypeId,
          count: normalizedCount
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.count - a.count);
  };

  const normalizeUserRoster = (rawRoster = [], unitTypes = []) => {
    const rosterById = new Map();
    for (const item of (Array.isArray(rawRoster) ? rawRoster : [])) {
      const unitTypeId = typeof item?.unitTypeId === 'string' ? item.unitTypeId.trim() : '';
      if (!unitTypeId || rosterById.has(unitTypeId)) continue;
      rosterById.set(unitTypeId, {
        unitTypeId,
        count: Math.max(0, Math.floor(Number(item?.count) || 0)),
        level: Math.max(1, Math.floor(Number(item?.level) || 1)),
        nextUnitTypeId: typeof item?.nextUnitTypeId === 'string' && item.nextUnitTypeId.trim()
          ? item.nextUnitTypeId.trim()
          : null,
        upgradeCostKP: Number.isFinite(Number(item?.upgradeCostKP))
          ? Math.max(0, Number(item.upgradeCostKP))
          : null
      });
    }
    return (Array.isArray(unitTypes) ? unitTypes : []).map((unitType) => {
      const unitTypeId = getArmyUnitTypeId(unitType);
      const existed = rosterById.get(unitTypeId);
      if (existed) {
        return existed;
      }
      return {
        unitTypeId,
        count: 0,
        level: Math.max(1, Math.floor(Number(unitType?.level) || 1)),
        nextUnitTypeId: unitType?.nextUnitTypeId || null,
        upgradeCostKP: Number.isFinite(Number(unitType?.upgradeCostKP))
          ? Math.max(0, Number(unitType.upgradeCostKP))
          : null
      };
    });
  };

  const getSnapshotGateDefenseByUnitMap = (snapshot = {}) => {
    const source = snapshot?.gateDefense && typeof snapshot.gateDefense === 'object'
      ? snapshot.gateDefense
      : {};
    return CITY_GATE_KEYS.reduce((acc, gateKey) => {
      acc[gateKey] = buildUnitCountMap(source[gateKey] || []);
      return acc;
    }, { cheng: new Map(), qi: new Map() });
  };

  const isGateEnabledForNode = (node, gateKey) => {
    if (gateKey === 'cheng') {
      return Array.isArray(node?.relatedParentDomains) && node.relatedParentDomains.length > 0;
    }
    if (gateKey === 'qi') {
      return Array.isArray(node?.relatedChildDomains) && node.relatedChildDomains.length > 0;
    }
    return false;
  };

  const getOrderedEnabledGateKeys = (node, preferredGate = '') => {
    const enabledGateKeys = CITY_GATE_KEYS.filter((gateKey) => isGateEnabledForNode(node, gateKey));
    if (enabledGateKeys.length <= 1) return enabledGateKeys;
    if (preferredGate && enabledGateKeys.includes(preferredGate)) {
      return [preferredGate, ...enabledGateKeys.filter((gateKey) => gateKey !== preferredGate)];
    }
    return enabledGateKeys;
  };

  const buildGateDefenseView = (node, gateDefenseByMap = {}, unitTypeMap = new Map(), preferredGate = '') => {
    const orderedGateKeys = getOrderedEnabledGateKeys(node, preferredGate);
    return orderedGateKeys.map((gateKey, index) => {
      const map = gateDefenseByMap?.[gateKey] instanceof Map ? gateDefenseByMap[gateKey] : new Map();
      const entries = mapToUnitCountEntries(map, unitTypeMap);
      return {
        gateKey,
        gateLabel: CITY_GATE_LABELS[gateKey] || gateKey,
        enabled: true,
        highlight: index === 0,
        totalCount: entries.reduce((sum, item) => sum + item.count, 0),
        entries
      };
    });
  };

  const hasAnyGateDefenseSnapshotEntries = (gateDefense = {}) => (
    CITY_GATE_KEYS.some((gateKey) => (
      (Array.isArray(gateDefense?.[gateKey]) ? gateDefense[gateKey] : [])
        .some((entry) => Math.max(0, Math.floor(Number(entry?.count) || 0)) > 0)
    ))
  );

  const buildBattlefieldGateDefenseSnapshotFromNode = (node = {}, unitTypeMap = new Map()) => {
    const battlefieldState = normalizeBattlefieldStateInput(resolveNodeBattlefieldLayout(node, {}));
    const layouts = Array.isArray(battlefieldState?.layouts) ? battlefieldState.layouts : [];
    const layoutGateByLayoutId = new Map();
    layouts.forEach((layout) => {
      const layoutId = normalizeBattlefieldLayoutId(layout?.layoutId);
      const gateKey = typeof layout?.gateKey === 'string' ? layout.gateKey.trim() : '';
      if (!layoutId || !CITY_GATE_KEYS.includes(gateKey)) return;
      layoutGateByLayoutId.set(layoutId, gateKey);
    });

    const gateUnitMapByKey = CITY_GATE_KEYS.reduce((acc, gateKey) => {
      acc[gateKey] = new Map();
      return acc;
    }, { cheng: new Map(), qi: new Map() });

    const deployments = Array.isArray(battlefieldState?.defenderDeployments)
      ? battlefieldState.defenderDeployments
      : [];
    deployments.forEach((deployment) => {
      const layoutId = normalizeBattlefieldLayoutId(deployment?.layoutId);
      const gateFromLayout = layoutId ? layoutGateByLayoutId.get(layoutId) : '';
      const gateFromRow = typeof deployment?.gateKey === 'string' ? deployment.gateKey.trim() : '';
      const gateKey = CITY_GATE_KEYS.includes(gateFromLayout)
        ? gateFromLayout
        : (CITY_GATE_KEYS.includes(gateFromRow) ? gateFromRow : '');
      if (!gateKey) return;
      const targetMap = gateUnitMapByKey[gateKey];
      normalizeDefenderDeploymentUnits(deployment).forEach((entry) => {
        const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
        const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
        if (!unitTypeId || count <= 0) return;
        targetMap.set(unitTypeId, (targetMap.get(unitTypeId) || 0) + count);
      });
    });

    return {
      gateDefense: CITY_GATE_KEYS.reduce((acc, gateKey) => {
        acc[gateKey] = mapToUnitCountEntries(gateUnitMapByKey[gateKey], unitTypeMap);
        return acc;
      }, { cheng: [], qi: [] }),
      updatedAt: battlefieldState?.updatedAt || null
    };
  };

  return {
    CITY_BUILDING_LIMIT,
    CITY_GATE_KEYS,
    USER_INTEL_SNAPSHOT_LIMIT,
    CITY_GATE_LABELS,
    BATTLEFIELD_DEPLOY_ZONE_RATIO,
    normalizeDefenseLayoutInput,
    serializeDefenseLayout,
    normalizeBattlefieldGateKey,
    normalizeBattlefieldLayoutId,
    findBattlefieldLayoutByGate,
    serializeBattlefieldStateForGate,
    mergeBattlefieldStateByGate,
    buildArmyUnitTypeMap,
    normalizeUnitCountEntries,
    buildUnitCountMap,
    mergeUnitCountMaps,
    mapToUnitCountEntries,
    normalizeUserRoster,
    isGateEnabledForNode,
    hasAnyGateDefenseSnapshotEntries,
    buildBattlefieldGateDefenseSnapshotFromNode,
    normalizeDefenderDeploymentUnits,
    buildGateDefenseView
  };
};
