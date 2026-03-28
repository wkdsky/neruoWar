module.exports = ({ router, deps }) => {
  const {
    authenticateToken,
    Node,
    User,
    fetchArmyUnitTypes,
    fetchCityBuildingTypes,
    fetchBattlefieldItems,
    ensureUserBattlefieldInventory,
    resolveUserItemLimitMap,
    hydrateNodeTitleStatesForNodes,
    getIdString,
    isValidObjectId,
    checkIntelHeistPermission,
    findUserIntelSnapshotByNodeId,
    serializeIntelSnapshot,
    resolveNodeDefenseLayout,
    serializeDefenseLayout,
    buildIntelGateDefenseSnapshot,
    buildBattlefieldGateDefenseSnapshotFromNode,
    hasAnyGateDefenseSnapshotEntries,
    normalizeUserIntelSnapshotStore,
    USER_INTEL_SNAPSHOT_LIMIT,
    CITY_GATE_KEYS,
    CITY_BUILDING_LIMIT,
    isDomainMaster,
    normalizeGateDefenseViewerAdminIds,
    normalizeDefenseLayoutInput,
    upsertNodeDefenseLayout,
    normalizeBattlefieldGateKey,
    normalizeBattlefieldLayoutId,
    buildArmyUnitTypeMap,
    resolveNodeBattlefieldLayout,
    serializeBattlefieldStateForGate,
    mergeBattlefieldStateByGate,
    normalizeUnitCountEntries,
    sendNodeRouteError,
    findBattlefieldLayoutByGate,
    BATTLEFIELD_FIELD_WIDTH,
    BATTLEFIELD_DEPLOY_ZONE_RATIO,
    normalizeDefenderDeploymentUnits,
    upsertNodeBattlefieldLayout
  } = deps;

  // 获取情报窃取状态（是否可执行 + 最近快照）
  router.get('/:nodeId/intel-heist', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const [node, user] = await Promise.all([
        Node.findById(nodeId).select('name status domainMaster domainAdmins'),
        User.findById(requestUserId).select('role location intelDomainSnapshots')
      ]);

      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: false
      });
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }

      const permission = checkIntelHeistPermission({ node, user });
      const latestSnapshot = findUserIntelSnapshotByNodeId(user, node._id);

      res.json({
        success: true,
        nodeId: getIdString(node._id),
        nodeName: node.name,
        canSteal: permission.allowed,
        reason: permission.reason || '',
        latestSnapshot: latestSnapshot ? serializeIntelSnapshot(latestSnapshot) : null
      });
    } catch (error) {
      console.error('获取情报窃取状态错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  // 执行建筑搜索并判断是否找到情报文件
  router.post('/:nodeId/intel-heist/scan', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const buildingId = typeof req.body?.buildingId === 'string' ? req.body.buildingId.trim() : '';
      if (!buildingId) {
        return res.status(400).json({ error: '建筑ID不能为空' });
      }

      const [node, user] = await Promise.all([
        Node.findById(nodeId).select('name status domainMaster domainAdmins'),
        User.findById(requestUserId).select('role location intelDomainSnapshots')
      ]);
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: false
      });
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }

      const permission = checkIntelHeistPermission({ node, user });
      if (!permission.allowed) {
        return res.status(403).json({ error: permission.reason || '当前不可执行情报窃取' });
      }

      const defenseLayout = resolveNodeDefenseLayout(node, {});
      const serializedLayout = serializeDefenseLayout(defenseLayout);
      const buildings = Array.isArray(serializedLayout.buildings) ? serializedLayout.buildings : [];
      const targetBuilding = buildings.find((item) => item.buildingId === buildingId);
      if (!targetBuilding) {
        return res.status(400).json({ error: '目标建筑不存在' });
      }

      const found = serializedLayout.intelBuildingId === buildingId;
      if (!found) {
        return res.json({
          success: true,
          found: false,
          message: '该建筑未发现情报文件'
        });
      }

      const unitTypes = await fetchArmyUnitTypes();
      const unitTypeMap = new Map(
        (Array.isArray(unitTypes) ? unitTypes : [])
          .map((item) => [item?.id || item?.unitTypeId, item])
          .filter(([id]) => !!id)
      );
      const layoutGateDefenseSnapshot = buildIntelGateDefenseSnapshot(serializedLayout.gateDefense, unitTypeMap);
      const battlefieldGateDefenseSnapshot = buildBattlefieldGateDefenseSnapshotFromNode(node, unitTypeMap);
      const useBattlefieldSnapshot = hasAnyGateDefenseSnapshotEntries(battlefieldGateDefenseSnapshot.gateDefense);
      const effectiveGateDefenseSnapshot = useBattlefieldSnapshot
        ? battlefieldGateDefenseSnapshot.gateDefense
        : layoutGateDefenseSnapshot;
      const effectiveDeploymentUpdatedAt = useBattlefieldSnapshot
        ? (battlefieldGateDefenseSnapshot.updatedAt || defenseLayout?.updatedAt || null)
        : (defenseLayout?.updatedAt || battlefieldGateDefenseSnapshot.updatedAt || null);

      const snapshotData = {
        nodeId: node._id,
        nodeName: node.name,
        sourceBuildingId: buildingId,
        deploymentUpdatedAt: effectiveDeploymentUpdatedAt,
        capturedAt: new Date(),
        gateDefense: effectiveGateDefenseSnapshot
      };

      const targetNodeId = getIdString(node._id);
      const snapshotStore = normalizeUserIntelSnapshotStore(user.intelDomainSnapshots, USER_INTEL_SNAPSHOT_LIMIT);
      snapshotStore[targetNodeId] = serializeIntelSnapshot(snapshotData);
      user.intelDomainSnapshots = normalizeUserIntelSnapshotStore(snapshotStore, USER_INTEL_SNAPSHOT_LIMIT);
      await user.save();

      const latestSnapshot = findUserIntelSnapshotByNodeId(user, targetNodeId);
      res.json({
        success: true,
        found: true,
        message: `已找到知识域「${node.name}」的情报文件`,
        snapshot: latestSnapshot ? serializeIntelSnapshot(latestSnapshot) : serializeIntelSnapshot(snapshotData)
      });
    } catch (error) {
      console.error('执行情报窃取建筑搜索错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  // 获取知识域城防建筑配置（域主可编辑）
  router.get('/:nodeId/defense-layout', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: false
      });

      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }

      const canEdit = isDomainMaster(node, requestUserId);
      const buildingCatalog = await fetchCityBuildingTypes({ enabledOnly: true });
      const defenseLayout = resolveNodeDefenseLayout(node, {});
      const gateDefenseViewerAdminIds = normalizeGateDefenseViewerAdminIds(
        defenseLayout?.gateDefenseViewAdminIds,
        (node.domainAdmins || []).map((id) => getIdString(id))
      );
      const canViewGateDefense = canEdit || gateDefenseViewerAdminIds.includes(requestUserId);
      const serializedLayout = serializeDefenseLayout(defenseLayout);
      const battlefieldGateDefenseSnapshot = buildBattlefieldGateDefenseSnapshotFromNode(node, new Map());
      const hasBattlefieldGateDefense = hasAnyGateDefenseSnapshotEntries(battlefieldGateDefenseSnapshot.gateDefense);
      const battlefieldGateDefense = CITY_GATE_KEYS.reduce((acc, key) => {
        const entries = Array.isArray(battlefieldGateDefenseSnapshot?.gateDefense?.[key])
          ? battlefieldGateDefenseSnapshot.gateDefense[key]
          : [];
        acc[key] = entries
          .map((entry) => ({
            unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
            count: Math.max(0, Math.floor(Number(entry?.count) || 0))
          }))
          .filter((entry) => entry.unitTypeId && entry.count > 0);
        return acc;
      }, { cheng: [], qi: [] });
      const effectiveGateDefense = hasBattlefieldGateDefense
        ? battlefieldGateDefense
        : serializedLayout.gateDefense;
      const layout = {
        ...serializedLayout,
        intelBuildingId: canEdit ? serializedLayout.intelBuildingId : '',
        gateDefense: canViewGateDefense
          ? effectiveGateDefense
          : { cheng: [], qi: [] },
        gateDefenseViewAdminIds: canEdit ? gateDefenseViewerAdminIds : []
      };

      res.json({
        success: true,
        nodeId: getIdString(node._id),
        nodeName: node.name,
        canEdit,
        canViewGateDefense,
        gateDefenseViewerAdminIds: canEdit ? gateDefenseViewerAdminIds : [],
        maxBuildings: CITY_BUILDING_LIMIT,
        minBuildings: 0,
        buildingCatalog,
        layout
      });
    } catch (error) {
      console.error('获取知识域城防配置错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  // 保存知识域城防建筑配置（仅域主）
  router.put('/:nodeId/defense-layout', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeSiegeState: false
      });

      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }
      if (!isDomainMaster(node, requestUserId)) {
        return res.status(403).json({ error: '只有域主可以保存城防配置' });
      }

      const payload = req.body?.layout && typeof req.body.layout === 'object'
        ? req.body.layout
        : req.body;
      const normalizedLayout = normalizeDefenseLayoutInput(payload || {});
      const buildingCatalog = await fetchCityBuildingTypes({ enabledOnly: true });
      const buildingTypeMap = new Map(
        buildingCatalog
          .map((item) => [item?.buildingTypeId, item])
          .filter(([id]) => !!id)
      );
      const buildingTypeCountMap = new Map();
      for (const building of (Array.isArray(normalizedLayout?.buildings) ? normalizedLayout.buildings : [])) {
        const buildingTypeId = typeof building?.buildingTypeId === 'string' ? building.buildingTypeId.trim() : '';
        if (!buildingTypeId || !buildingTypeMap.has(buildingTypeId)) {
          return res.status(400).json({ error: `存在无效建筑类型：${buildingTypeId || 'empty'}` });
        }
        buildingTypeCountMap.set(buildingTypeId, (buildingTypeCountMap.get(buildingTypeId) || 0) + 1);
      }
      for (const [buildingTypeId, count] of buildingTypeCountMap.entries()) {
        const maxCount = Math.max(0, Math.floor(Number(buildingTypeMap.get(buildingTypeId)?.initialCount) || 0));
        if (count > maxCount) {
          return res.status(400).json({
            error: `建筑数量超出上限：${buildingTypeId} 可放置 ${maxCount}，当前 ${count}`
          });
        }
      }

      const requestUser = await User.findById(requestUserId).select('armyRoster');
      if (!requestUser) {
        return res.status(404).json({ error: '用户不存在' });
      }
      const rosterCountMap = new Map(
        (Array.isArray(requestUser.armyRoster) ? requestUser.armyRoster : [])
          .map((entry) => ([
            typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
            Math.max(0, Math.floor(Number(entry?.count) || 0))
          ]))
          .filter(([unitTypeId]) => !!unitTypeId)
      );
      const deployedCountMap = new Map();
      CITY_GATE_KEYS.forEach((key) => {
        const entries = Array.isArray(normalizedLayout?.gateDefense?.[key]) ? normalizedLayout.gateDefense[key] : [];
        entries.forEach((entry) => {
          const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
          const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
          if (!unitTypeId || count <= 0) return;
          deployedCountMap.set(unitTypeId, (deployedCountMap.get(unitTypeId) || 0) + count);
        });
      });
      for (const [unitTypeId, deployedCount] of deployedCountMap.entries()) {
        const rosterCount = rosterCountMap.get(unitTypeId) || 0;
        if (deployedCount > rosterCount) {
          return res.status(400).json({
            error: `兵力布防超出可用数量：${unitTypeId} 可用 ${rosterCount}，布防 ${deployedCount}`
          });
        }
      }

      const payloadHasViewerIds = Array.isArray(payload?.gateDefenseViewAdminIds);
      const defenseLayout = resolveNodeDefenseLayout(node, {});
      const existingViewerAdminIds = normalizeGateDefenseViewerAdminIds(
        defenseLayout?.gateDefenseViewAdminIds,
        (node.domainAdmins || []).map((id) => getIdString(id))
      );
      const nextViewerAdminIds = payloadHasViewerIds
        ? normalizeGateDefenseViewerAdminIds(normalizedLayout.gateDefenseViewAdminIds, (node.domainAdmins || []).map((id) => getIdString(id)))
        : existingViewerAdminIds;

      const nextLayout = {
        ...normalizedLayout,
        gateDefenseViewAdminIds: nextViewerAdminIds,
        updatedAt: new Date()
      };
      await upsertNodeDefenseLayout({
        nodeId: node._id,
        layout: nextLayout,
        actorUserId: requestUserId
      });

      res.json({
        success: true,
        message: '城防配置已保存',
        nodeId: getIdString(node._id),
        layout: serializeDefenseLayout(nextLayout),
        maxBuildings: CITY_BUILDING_LIMIT,
        minBuildings: 0,
        buildingCatalog
      });
    } catch (error) {
      console.error('保存知识域城防配置错误:', error);
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message || '请求参数错误' });
      }
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  // 获取知识域战场布局（域主可编辑，已授权域相可查看）
  router.get('/:nodeId/battlefield-layout', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const rawGateKey = typeof req.query?.gateKey === 'string' ? req.query.gateKey.trim() : '';
      if (rawGateKey && !CITY_GATE_KEYS.includes(rawGateKey)) {
        return res.status(400).json({ error: '无效的门向参数' });
      }
      const gateKey = normalizeBattlefieldGateKey(rawGateKey);
      const layoutId = normalizeBattlefieldLayoutId(req.query?.layoutId);
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: false
      });

      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }

      const canEdit = isDomainMaster(node, requestUserId);
      const defenseLayout = resolveNodeDefenseLayout(node, {});
      const gateDefenseViewerAdminIds = normalizeGateDefenseViewerAdminIds(
        defenseLayout?.gateDefenseViewAdminIds,
        (node.domainAdmins || []).map((id) => getIdString(id))
      );
      const canView = canEdit || gateDefenseViewerAdminIds.includes(requestUserId);
      if (!canView) {
        return res.status(403).json({ error: '仅域主或已授权域相可查看战场布局' });
      }

      const domainMasterId = getIdString(node?.domainMaster);
      const [battlefieldItemCatalogAll, unitTypes, domainMasterUser, requestUser] = await Promise.all([
        fetchBattlefieldItems({ enabledOnly: false }),
        fetchArmyUnitTypes(),
        isValidObjectId(domainMasterId)
          ? User.findById(domainMasterId).select('armyRoster')
          : null,
        User.findById(requestUserId).select('role battlefieldItemInventory username')
      ]);
      if (!requestUser) {
        return res.status(404).json({ error: '用户不存在' });
      }
      await ensureUserBattlefieldInventory(requestUser, {
        defaultCount: 5,
        persist: true,
        reason: 'nodes:battlefield-layout-get'
      });
      const battlefieldItemCatalog = (Array.isArray(battlefieldItemCatalogAll) ? battlefieldItemCatalogAll : [])
        .filter((item) => item?.enabled !== false);
      console.log(
        `[battlefield] Loaded BattlefieldItem catalog count=${battlefieldItemCatalogAll.length} enabled=${battlefieldItemCatalog.length}`
      );
      const inventoryLimitMap = resolveUserItemLimitMap(requestUser, battlefieldItemCatalog, { fallbackCount: 5 });
      const battlefieldItemCatalogWithInventory = battlefieldItemCatalog.map((item) => ({
        ...item,
        initialCount: Math.max(
          0,
          Math.floor(
            Number.isFinite(Number(inventoryLimitMap.get(item.itemId)))
              ? Number(inventoryLimitMap.get(item.itemId))
              : Number(item?.initialCount)
          )
        )
      }));
      const unitTypeMap = buildArmyUnitTypeMap(unitTypes);
      const battlefieldState = resolveNodeBattlefieldLayout(node, {});
      const mergedBattlefieldState = {
        ...battlefieldState,
        items: battlefieldItemCatalogWithInventory
      };
      const defenderRoster = normalizeUnitCountEntries(Array.isArray(domainMasterUser?.armyRoster) ? domainMasterUser.armyRoster : [])
        .map((entry) => {
          const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
          const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
          const unitMeta = unitTypeMap.get(unitTypeId);
          if (!unitTypeId || count <= 0 || !unitMeta) return null;
          return {
            unitTypeId,
            unitName: unitMeta.name || unitTypeId,
            roleTag: unitMeta.roleTag === '远程' ? '远程' : '近战',
            count
          };
        })
        .filter(Boolean);
      res.json({
        success: true,
        nodeId: getIdString(node._id),
        nodeName: node.name,
        gateKey,
        layoutId,
        canEdit,
        canView,
        layoutBundle: serializeBattlefieldStateForGate(mergedBattlefieldState, gateKey, layoutId),
        defenderRoster
      });
    } catch (error) {
      console.error('获取知识域战场布局错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  // 保存知识域战场布局（仅域主）
  router.put('/:nodeId/battlefield-layout', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const rawGateKey = typeof (req.body?.gateKey || req.query?.gateKey) === 'string'
        ? String(req.body?.gateKey || req.query?.gateKey).trim()
        : '';
      if (rawGateKey && !CITY_GATE_KEYS.includes(rawGateKey)) {
        return res.status(400).json({ error: '无效的门向参数' });
      }
      const gateKey = normalizeBattlefieldGateKey(rawGateKey);
      const layoutId = normalizeBattlefieldLayoutId(
        req.body?.layoutId || req.query?.layoutId || req.body?.layout?.layoutId
      );
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: false
      });

      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }
      if (!isDomainMaster(node, requestUserId)) {
        return res.status(403).json({ error: '只有域主可以保存战场布局' });
      }

      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      const currentState = resolveNodeBattlefieldLayout(node, {});
      const battlefieldItemCatalogAll = await fetchBattlefieldItems({ enabledOnly: false });
      const battlefieldItemCatalog = (Array.isArray(battlefieldItemCatalogAll) ? battlefieldItemCatalogAll : [])
        .filter((item) => item?.enabled !== false);
      console.log(
        `[battlefield] Loaded BattlefieldItem catalog count=${battlefieldItemCatalogAll.length} enabled=${battlefieldItemCatalog.length}`
      );
      const itemById = new Map(
        battlefieldItemCatalog
          .map((item) => [item?.itemId, item])
          .filter(([id]) => !!id)
      );
      const nextBattlefieldState = mergeBattlefieldStateByGate(currentState, gateKey, {
        ...payload,
        layoutId
      });
      nextBattlefieldState.items = battlefieldItemCatalog;

      const [unitTypes, requestUser] = await Promise.all([
        fetchArmyUnitTypes(),
        User.findById(requestUserId).select('armyRoster role battlefieldItemInventory username')
      ]);
      if (!requestUser) {
        return res.status(404).json({ error: '用户不存在' });
      }
      await ensureUserBattlefieldInventory(requestUser, {
        defaultCount: 5,
        persist: true,
        reason: 'nodes:battlefield-layout-save'
      });
      const inventoryLimitMap = resolveUserItemLimitMap(requestUser, battlefieldItemCatalog, { fallbackCount: 5 });

      const counter = new Map();
      for (const obj of (Array.isArray(nextBattlefieldState.objects) ? nextBattlefieldState.objects : [])) {
        const itemId = typeof obj?.itemId === 'string' ? obj.itemId.trim() : '';
        if (!itemId || !itemById.has(itemId)) {
          return res.status(400).json({ error: `存在无效物品ID：${itemId || 'empty'}` });
        }
        const layoutIdKey = typeof obj?.layoutId === 'string' ? obj.layoutId.trim() : '';
        const key = `${layoutIdKey}:${itemId}`;
        counter.set(key, (counter.get(key) || 0) + 1);
      }
      for (const [key, count] of counter.entries()) {
        const [, itemId] = key.split(':');
        const item = itemById.get(itemId);
        const fallbackLimit = Number.isFinite(Number(item?.initialCount)) ? Number(item.initialCount) : 5;
        const stockLimit = Math.max(0, Math.floor(
          Number.isFinite(Number(inventoryLimitMap.get(itemId)))
            ? Number(inventoryLimitMap.get(itemId))
            : fallbackLimit
        ));
        if (count > stockLimit) {
          return res.status(400).json({
            error: `物品数量超限：${itemId} 可放置 ${stockLimit}，当前 ${count}`
          });
        }
      }

      const validUnitTypeIdSet = new Set(
        unitTypes
          .map((unit) => (typeof unit?.unitTypeId === 'string' ? unit.unitTypeId.trim() : ''))
          .filter((unitTypeId) => !!unitTypeId)
      );
      const unitTypeMap = buildArmyUnitTypeMap(unitTypes);
      const targetLayout = findBattlefieldLayoutByGate(nextBattlefieldState, gateKey, layoutId);
      const targetLayoutId = typeof targetLayout?.layoutId === 'string' ? targetLayout.layoutId : '';
      const targetFieldWidth = Math.max(200, Number(targetLayout?.fieldWidth) || BATTLEFIELD_FIELD_WIDTH);
      const defenderZoneMinX = (targetFieldWidth / 2) - (targetFieldWidth * BATTLEFIELD_DEPLOY_ZONE_RATIO);
      const defenseUnitLimitMap = new Map(
        normalizeUnitCountEntries(Array.isArray(requestUser?.armyRoster) ? requestUser.armyRoster : [])
          .map((entry) => ([
            typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
            Math.max(0, Math.floor(Number(entry?.count) || 0))
          ]))
          .filter(([unitTypeId]) => !!unitTypeId)
      );
      const defenderDeployments = (Array.isArray(nextBattlefieldState?.defenderDeployments) ? nextBattlefieldState.defenderDeployments : [])
        .filter((item) => !targetLayoutId || item?.layoutId === targetLayoutId);
      const deployedUnitCounter = new Map();
      for (const deployment of defenderDeployments) {
        const x = Number(deployment?.x) || 0;
        if (deployment?.placed !== false && x < defenderZoneMinX - 0.001) {
          const deployName = (typeof deployment?.name === 'string' && deployment.name.trim())
            ? deployment.name.trim()
            : (typeof deployment?.deployId === 'string' ? deployment.deployId : 'unknown');
          return res.status(400).json({ error: `守军布置越界：${deployName} 仅可放置在守方区域` });
        }
        const deploymentUnits = normalizeDefenderDeploymentUnits(deployment);
        if (deploymentUnits.length <= 0) {
          return res.status(400).json({ error: '守军布置存在空部队，请重新编组后保存' });
        }
        for (const unitEntry of deploymentUnits) {
          const unitTypeId = typeof unitEntry?.unitTypeId === 'string' ? unitEntry.unitTypeId.trim() : '';
          const count = Math.max(1, Math.floor(Number(unitEntry?.count) || 1));
          if (!unitTypeId || !defenseUnitLimitMap.has(unitTypeId) || !validUnitTypeIdSet.has(unitTypeId)) {
            return res.status(400).json({ error: `守军布置存在无效兵种：${unitTypeId || 'empty'}` });
          }
          deployedUnitCounter.set(unitTypeId, (deployedUnitCounter.get(unitTypeId) || 0) + count);
        }
      }
      for (const [unitTypeId, deployedCount] of deployedUnitCounter.entries()) {
        const limit = defenseUnitLimitMap.get(unitTypeId) || 0;
        if (deployedCount > limit) {
          return res.status(400).json({
            error: `守军布置数量超限：${unitTypeId} 可布置 ${limit}，当前 ${deployedCount}`
          });
        }
      }

      await upsertNodeBattlefieldLayout({
        nodeId: node._id,
        battlefieldLayout: nextBattlefieldState,
        actorUserId: requestUserId
      });

      const defenseLayout = resolveNodeDefenseLayout(node, {});
      const battlefieldGateDefenseSnapshot = buildBattlefieldGateDefenseSnapshotFromNode(
        { titleState: { battlefieldLayout: nextBattlefieldState } },
        unitTypeMap
      );
      const nextDefenseLayout = {
        ...normalizeDefenseLayoutInput(defenseLayout),
        gateDefense: battlefieldGateDefenseSnapshot.gateDefense,
        updatedAt: new Date()
      };
      await upsertNodeDefenseLayout({
        nodeId: node._id,
        layout: nextDefenseLayout,
        actorUserId: requestUserId
      });

      res.json({
        success: true,
        message: '战场布局已保存',
        nodeId: getIdString(node._id),
        gateKey,
        layoutId,
        layoutBundle: serializeBattlefieldStateForGate(nextBattlefieldState, gateKey, layoutId)
      });
    } catch (error) {
      console.error('保存知识域战场布局错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });
};
