module.exports = ({ router, deps }) => {
  const {
    authenticateToken,
    randomUUID,
    mongoose,
    Node,
    User,
    SiegeBattleRecord,
    schedulerService,
    fetchArmyUnitTypes,
    fetchBattlefieldItems,
    UNIT_TYPE_DTO_VERSION,
    listApprovedNodesByNames,
    isDomainTitleStateCollectionReadEnabled,
    writeNotificationsToCollection,
    normalizeSiegeParticipantUnits,
    upsertSiegeParticipant,
    settleNodeSiegeState,
    markSiegeParticipantsRetreated,
    getSiegeGatePreview,
    listSiegeParticipants,
    findActiveSiegeParticipant,
    findUserActiveParticipants,
    getIdString,
    isValidObjectId,
    hydrateNodeTitleStatesForNodes,
    upsertNodeSiegeState,
    findUserIntelSnapshotByNodeId,
    serializeIntelSnapshot,
    buildSiegePayloadForUser,
    SIEGE_PARTICIPANT_RESULT_LIMIT_MAX,
    SIEGE_PARTICIPANT_PREVIEW_LIMIT,
    CITY_GATE_KEYS,
    buildArmyUnitTypeMap,
    serializeSiegeAttacker,
    sendNodeRouteError,
    buildSiegeGateSummary,
    CITY_GATE_LABELS,
    resolveNodeBattlefieldLayout,
    serializeBattlefieldStateForGate,
    resolveSiegePveBattleContext,
    normalizeDefenderDeploymentUnits,
    mapToUnitCountEntries,
    buildUnitCountMap,
    normalizeUserRoster,
    SIEGE_PVE_TIME_LIMIT_SEC,
    SIEGE_PVE_UNITS_PER_SOLDIER,
    normalizeBattleResultSide,
    sanitizeBattleResultDetails,
    isDomainMaster,
    isDomainAdmin,
    resolveAttackGateByArrival,
    isGateEnabledForNode,
    getNodeGateState,
    isSiegeAttackerActive,
    isSameAlliance,
    normalizeUnitCountEntries,
    getMutableNodeSiegeState,
    createEmptySiegeGateState,
    pushNotificationToUser,
    toCollectionNotificationDoc,
    mergeUnitCountMaps,
    SIEGE_SUPPORT_UNIT_DURATION_SECONDS
  } = deps;

  router.get('/:nodeId/siege', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const [node, user, unitTypes] = await Promise.all([
        Node.findById(nodeId).select('name status domainMaster domainAdmins relatedParentDomains relatedChildDomains'),
        User.findById(requestUserId).select('username role location allianceId armyRoster intelDomainSnapshots lastArrivedFromNodeId lastArrivedFromNodeName'),
        fetchArmyUnitTypes()
      ]);

      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      if (user.role !== 'common') {
        return res.status(403).json({ error: '仅普通用户可查看围城状态' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: true
      });

      const settled = await settleNodeSiegeState(node, new Date());
      if (settled.changed) {
        await upsertNodeSiegeState({
          nodeId: node._id,
          siegeState: settled.siegeState,
          actorUserId: requestUserId
        });
      }

      const intelSnapshotRaw = findUserIntelSnapshotByNodeId(user, node._id);
      const intelSnapshot = intelSnapshotRaw ? serializeIntelSnapshot(intelSnapshotRaw) : null;
      const payload = buildSiegePayloadForUser({
        node,
        user,
        unitTypes,
        intelSnapshot
      });
      const participantsLimit = Math.max(
        1,
        Math.min(
          SIEGE_PARTICIPANT_RESULT_LIMIT_MAX,
          parseInt(req.query?.participantsLimit, 10) || SIEGE_PARTICIPANT_PREVIEW_LIMIT
        )
      );
      const participantsCursor = typeof req.query?.cursor === 'string'
        ? req.query.cursor.trim()
        : (typeof req.query?.participantsCursor === 'string' ? req.query.participantsCursor.trim() : '');
      const participantsGateRaw = typeof req.query?.participantsGate === 'string'
        ? req.query.participantsGate.trim()
        : '';
      const participantsGate = CITY_GATE_KEYS.includes(participantsGateRaw)
        ? participantsGateRaw
        : (CITY_GATE_KEYS.includes(payload?.compareGate) ? payload.compareGate : '');
      const unitTypeMap = buildArmyUnitTypeMap(unitTypes);
      const participantsPage = participantsGate
        ? await listSiegeParticipants({
          nodeId: node._id,
          gateKey: participantsGate,
          statuses: ['moving', 'sieging', 'retreated'],
          limit: participantsLimit,
          cursor: participantsCursor
        })
        : { rows: [], nextCursor: null };

      return res.json({
        success: true,
        participantsPage: {
          gateKey: participantsGate,
          limit: participantsLimit,
          cursor: participantsCursor || null,
          nextCursor: participantsPage.nextCursor || null,
          rows: (participantsPage.rows || []).map((item) => serializeSiegeAttacker(item, unitTypeMap, Date.now()))
        },
        ...payload
      });
    } catch (error) {
      console.error('获取围城状态错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.get('/:nodeId/siege/battlefield-preview', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestUserId = getIdString(req?.user?.userId);
      const gateKeyRaw = typeof req.query?.gateKey === 'string' ? req.query.gateKey.trim() : '';
      const gateKey = CITY_GATE_KEYS.includes(gateKeyRaw) ? gateKeyRaw : '';
      if (!gateKey) {
        return res.status(400).json({ error: 'gateKey 必须为 cheng 或 qi' });
      }
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const [node, user] = await Promise.all([
        Node.findById(nodeId).select('name status domainMaster domainAdmins relatedParentDomains relatedChildDomains'),
        User.findById(requestUserId).select('role intelDomainSnapshots')
      ]);
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      if (user.role !== 'common') {
        return res.status(403).json({ error: '仅普通用户可预览围城战场' });
      }

      const intelSnapshot = findUserIntelSnapshotByNodeId(user, node._id);
      if (!intelSnapshot) {
        return res.status(403).json({ error: '暂无情报文件，无法预览守方战场' });
      }

      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: true
      });

      const settled = await settleNodeSiegeState(node, new Date());
      if (settled.changed) {
        await upsertNodeSiegeState({
          nodeId: node._id,
          siegeState: settled.siegeState,
          actorUserId: requestUserId
        });
      }

      const gateSummaryMap = CITY_GATE_KEYS.reduce((acc, key) => {
        acc[key] = buildSiegeGateSummary(node, key, new Map());
        return acc;
      }, { cheng: null, qi: null });
      const activeGateKeys = CITY_GATE_KEYS.filter((key) => !!gateSummaryMap[key]?.active);
      if (!activeGateKeys.includes(gateKey)) {
        return res.status(403).json({ error: '该门当前无有效围城战场' });
      }

      const battlefieldItemCatalog = await fetchBattlefieldItems({ enabledOnly: true });
      const battlefieldState = resolveNodeBattlefieldLayout(node, {});
      const mergedBattlefieldState = {
        ...battlefieldState,
        items: battlefieldItemCatalog
      };
      const layoutBundleRaw = serializeBattlefieldStateForGate(mergedBattlefieldState, gateKey, '');
      const layoutBundle = {
        ...layoutBundleRaw,
        defenderDeployments: []
      };

      return res.json({
        success: true,
        nodeId: getIdString(node._id),
        nodeName: node.name || '',
        gateKey,
        gateLabel: CITY_GATE_LABELS[gateKey] || gateKey,
        canEdit: false,
        canView: true,
        intelVisible: true,
        layoutBundle
      });
    } catch (error) {
      console.error('读取围城战场情报预览错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.get('/:nodeId/siege/pve/battle-init', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestUserId = getIdString(req?.user?.userId);
      const gateKeyRaw = typeof req.query?.gateKey === 'string' ? req.query.gateKey.trim() : '';
      const gateKey = CITY_GATE_KEYS.includes(gateKeyRaw) ? gateKeyRaw : '';
      if (!gateKey) {
        return res.status(400).json({ error: 'gateKey 必须为 cheng 或 qi' });
      }

      const {
        node,
        user,
        unitTypes,
        unitTypeMap,
        gateSummary
      } = await resolveSiegePveBattleContext({
        nodeId,
        requestUserId,
        gateKey
      });
      const domainMasterId = getIdString(node?.domainMaster);
      const domainMasterUser = isValidObjectId(domainMasterId)
        ? await User.findById(domainMasterId).select('username')
        : null;
      const intelSnapshot = findUserIntelSnapshotByNodeId(user, node._id);
      const intelVisible = !!intelSnapshot;

      const battlefieldItemCatalog = await fetchBattlefieldItems({ enabledOnly: true });
      const battlefieldState = resolveNodeBattlefieldLayout(node, {});
      const mergedBattlefieldState = {
        ...battlefieldState,
        items: battlefieldItemCatalog
      };
      const layoutBundle = serializeBattlefieldStateForGate(mergedBattlefieldState, gateKey, '');
      const defenderDeployments = Array.isArray(layoutBundle?.defenderDeployments) ? layoutBundle.defenderDeployments : [];
      if (process.env.NODE_ENV !== 'production') {
        const rotationCount = defenderDeployments.filter((entry) => Number.isFinite(Number(entry?.rotation))).length;
        if (rotationCount > 0) {
          console.debug(`[battle-init] defenderDeployments with rotation=${rotationCount}`);
        }
      }
      const defenderUnitCountMap = new Map();
      defenderDeployments.forEach((entry) => {
        if (entry?.placed === false) return;
        normalizeDefenderDeploymentUnits(entry).forEach((unitEntry) => {
          const unitTypeId = typeof unitEntry?.unitTypeId === 'string' ? unitEntry.unitTypeId.trim() : '';
          const count = Math.max(0, Math.floor(Number(unitEntry?.count) || 0));
          if (!unitTypeId || count <= 0) return;
          defenderUnitCountMap.set(unitTypeId, (defenderUnitCountMap.get(unitTypeId) || 0) + count);
        });
      });
      const defenderUnits = mapToUnitCountEntries(defenderUnitCountMap, unitTypeMap);
      const attackerRoster = normalizeUserRoster(user?.armyRoster, unitTypes);
      const attackerRosterUnits = mapToUnitCountEntries(buildUnitCountMap(attackerRoster), unitTypeMap);
      const now = new Date();
      return res.json({
        success: true,
        battleId: randomUUID(),
        nodeId: getIdString(node._id),
        nodeName: node.name || '',
        gateKey,
        gateLabel: CITY_GATE_LABELS[gateKey] || gateKey,
        serverTime: now.toISOString(),
        timeLimitSec: SIEGE_PVE_TIME_LIMIT_SEC,
        unitsPerSoldier: SIEGE_PVE_UNITS_PER_SOLDIER,
        unitTypeDtoVersion: UNIT_TYPE_DTO_VERSION,
        unitTypes,
        attacker: {
          username: typeof user?.username === 'string' ? user.username : '',
          totalCount: Math.max(0, Math.floor(Number(gateSummary?.totalCount) || 0)),
          units: Array.isArray(gateSummary?.aggregateUnits) ? gateSummary.aggregateUnits : [],
          rosterUnits: attackerRosterUnits
        },
        defender: {
          username: typeof domainMasterUser?.username === 'string' ? domainMasterUser.username : '',
          totalCount: defenderUnits.reduce((sum, item) => sum + item.count, 0),
          units: defenderUnits
        },
        battlefield: {
          version: Math.max(1, Math.floor(Number(layoutBundle?.version) || 1)),
          gateKey,
          gateLabel: CITY_GATE_LABELS[gateKey] || gateKey,
          intelVisible,
          layoutMeta: layoutBundle?.activeLayout || null,
          layouts: Array.isArray(layoutBundle?.layouts) ? layoutBundle.layouts : [],
          itemCatalog: Array.isArray(layoutBundle?.itemCatalog) ? layoutBundle.itemCatalog : [],
          objects: Array.isArray(layoutBundle?.objects) ? layoutBundle.objects : [],
          defenderDeployments: Array.isArray(layoutBundle?.defenderDeployments) ? layoutBundle.defenderDeployments : [],
          updatedAt: layoutBundle?.updatedAt || null
        }
      });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message || '请求参数错误' });
      }
      console.error('初始化围城 PVE 战斗错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.post('/:nodeId/siege/pve/battle-result', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestUserId = getIdString(req?.user?.userId);
      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      const gateKeyRaw = typeof payload?.gateKey === 'string' ? payload.gateKey.trim() : '';
      const gateKey = CITY_GATE_KEYS.includes(gateKeyRaw) ? gateKeyRaw : '';
      if (!gateKey) {
        return res.status(400).json({ error: 'gateKey 必须为 cheng 或 qi' });
      }

      const {
        node,
        user
      } = await resolveSiegePveBattleContext({
        nodeId,
        requestUserId,
        gateKey
      });

      const battleId = typeof payload?.battleId === 'string' ? payload.battleId.trim() : '';
      if (!battleId) {
        return res.status(400).json({ error: 'battleId 不能为空' });
      }
      const durationSec = Math.max(0, Math.floor(Number(payload?.durationSec) || 0));
      const attacker = normalizeBattleResultSide(payload?.attacker);
      const defender = normalizeBattleResultSide(payload?.defender);
      const details = sanitizeBattleResultDetails(payload?.details);
      const startedAtMs = new Date(payload?.startedAt || 0).getTime();
      const startedAt = Number.isFinite(startedAtMs) && startedAtMs > 0 ? new Date(startedAtMs) : null;
      const endedAt = new Date();

      const existing = await SiegeBattleRecord.findOne({ battleId }).select('_id battleId').lean();
      if (existing) {
        return res.json({
          success: true,
          battleId: existing.battleId,
          recorded: true,
          duplicate: true
        });
      }

      await SiegeBattleRecord.create({
        nodeId: node._id,
        gateKey,
        battleId,
        attackerUserId: requestUserId,
        attackerAllianceId: user?.allianceId || null,
        startedAt,
        endedAt,
        durationSec,
        attacker,
        defender,
        details
      });

      return res.json({
        success: true,
        battleId,
        recorded: true
      });
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: error.message || '请求参数错误' });
      }
      if (error?.code === 11000) {
        return res.json({
          success: true,
          recorded: true,
          duplicate: true
        });
      }
      console.error('记录围城 PVE 战斗结果错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.get('/:nodeId/siege/participants', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const node = await Node.findById(nodeId).select('_id name status');
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }

      const gateKeyRaw = typeof req.query?.gateKey === 'string' ? req.query.gateKey.trim() : '';
      const gateKey = CITY_GATE_KEYS.includes(gateKeyRaw) ? gateKeyRaw : '';
      if (!gateKey) {
        return res.status(400).json({ error: 'gateKey 必须为 cheng 或 qi' });
      }

      const limit = Math.max(
        1,
        Math.min(
          SIEGE_PARTICIPANT_RESULT_LIMIT_MAX,
          parseInt(req.query?.limit, 10) || SIEGE_PARTICIPANT_PREVIEW_LIMIT
        )
      );
      const cursor = typeof req.query?.cursor === 'string' ? req.query.cursor.trim() : '';
      const includeRetreated = req.query?.includeRetreated === 'true';
      const statuses = includeRetreated ? ['moving', 'sieging', 'retreated'] : ['moving', 'sieging'];

      const [unitTypes, participantsPage] = await Promise.all([
        fetchArmyUnitTypes(),
        listSiegeParticipants({
          nodeId: node._id,
          gateKey,
          statuses,
          limit,
          cursor
        })
      ]);
      const unitTypeMap = buildArmyUnitTypeMap(unitTypes);

      return res.json({
        success: true,
        nodeId: getIdString(node._id),
        nodeName: node.name || '',
        gateKey,
        limit,
        cursor: cursor || null,
        nextCursor: participantsPage.nextCursor || null,
        rows: (participantsPage.rows || []).map((item) => serializeSiegeAttacker(item, unitTypeMap, Date.now()))
      });
    } catch (error) {
      console.error('获取围城参与者分页错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.post('/:nodeId/siege/start', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const [node, user, unitTypes] = await Promise.all([
        Node.findById(nodeId).select('name status domainMaster domainAdmins relatedParentDomains relatedChildDomains'),
        User.findById(requestUserId).select('username role location allianceId armyRoster intelDomainSnapshots lastArrivedFromNodeId lastArrivedFromNodeName'),
        fetchArmyUnitTypes()
      ]);
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      if (user.role !== 'common') {
        return res.status(403).json({ error: '仅普通用户可发起围城' });
      }
      if (isDomainMaster(node, requestUserId) || isDomainAdmin(node, requestUserId)) {
        return res.status(403).json({ error: '域主/域相不可发起围城' });
      }
      if ((user.location || '').trim() !== (node.name || '')) {
        return res.status(403).json({ error: '需先抵达该知识域后才能发起围城' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: true
      });

      const settled = await settleNodeSiegeState(node, new Date());
      if (settled.changed) {
        await upsertNodeSiegeState({
          nodeId: node._id,
          siegeState: settled.siegeState,
          actorUserId: requestUserId
        });
      }

      const gateKey = resolveAttackGateByArrival(node, user);
      if (!gateKey) {
        return res.status(400).json({ error: '无法判定围攻门向，请从相邻知识域移动后再试' });
      }
      if (!isGateEnabledForNode(node, gateKey)) {
        return res.status(400).json({ error: '该门当前不可用，无法发起围城' });
      }

      const roster = normalizeUserRoster(user.armyRoster, unitTypes);
      const unitMap = buildArmyUnitTypeMap(unitTypes);
      const ownUnitEntries = mapToUnitCountEntries(buildUnitCountMap(roster), unitMap);
      const ownTotalCount = ownUnitEntries.reduce((sum, item) => sum + item.count, 0);
      if (ownTotalCount <= 0) {
        return res.status(400).json({ error: '至少需要拥有一名兵力' });
      }

      const gateState = getNodeGateState(node, gateKey);
      const activeAttackers = (gateState.attackers || []).filter((item) => isSiegeAttackerActive(item));
      if (activeAttackers.length > 0) {
        const sameAlliance = isSameAlliance(gateState.attackerAllianceId, user.allianceId);
        if (!sameAlliance) {
          return res.status(409).json({ error: '该门已被其他势力围城' });
        }
        return res.status(409).json({ error: '该门已在围城中，可通过支援加入' });
      }

      const now = new Date();
      const normalizedOwnUnits = normalizeUnitCountEntries(ownUnitEntries);
      const fromNodeId = user.lastArrivedFromNodeId || null;
      const fromNodeName = (user.lastArrivedFromNodeName || '').trim();
      const workingSiegeState = getMutableNodeSiegeState(node);
      await upsertSiegeParticipant({
        nodeId: node._id,
        gateKey,
        userId: user._id,
        username: user.username || '',
        allianceId: user.allianceId || null,
        units: normalizeSiegeParticipantUnits(normalizedOwnUnits),
        fromNodeId,
        fromNodeName,
        autoRetreatPercent: 40,
        status: 'sieging',
        isInitiator: true,
        isReinforcement: false,
        requestedAt: now,
        arriveAt: now,
        joinedAt: now,
        updatedAt: now
      });
      const gatePreview = await getSiegeGatePreview({
        nodeId: node._id,
        gateKey,
        limit: SIEGE_PARTICIPANT_PREVIEW_LIMIT
      });

      workingSiegeState[gateKey] = {
        ...(workingSiegeState?.[gateKey] || {}),
        active: !!gatePreview.active,
        startedAt: workingSiegeState?.[gateKey]?.startedAt || now,
        updatedAt: now,
        attackerAllianceId: gatePreview.firstActiveAllianceId || user.allianceId || null,
        initiatorUserId: user._id,
        initiatorUsername: user.username || '',
        participantCount: Math.max(0, Number(gatePreview.participantCount) || 0),
        attackers: Array.isArray(gatePreview.attackers) ? gatePreview.attackers.slice(0, SIEGE_PARTICIPANT_PREVIEW_LIMIT) : []
      };
      await upsertNodeSiegeState({
        nodeId: node._id,
        siegeState: workingSiegeState,
        actorUserId: requestUserId
      });

      const intelSnapshotRaw = findUserIntelSnapshotByNodeId(user, node._id);
      const intelSnapshot = intelSnapshotRaw ? serializeIntelSnapshot(intelSnapshotRaw) : null;
      const payload = buildSiegePayloadForUser({
        node,
        user,
        unitTypes,
        intelSnapshot
      });

      return res.json({
        success: true,
        message: `已在${CITY_GATE_LABELS[gateKey] || gateKey}发起围城`,
        ...payload
      });
    } catch (error) {
      console.error('发起围城错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.post('/:nodeId/siege/request-support', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const [node, user, unitTypes] = await Promise.all([
        Node.findById(nodeId).select('name status'),
        User.findById(requestUserId).select('username role allianceId armyRoster intelDomainSnapshots'),
        fetchArmyUnitTypes()
      ]);

      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      if (user.role !== 'common') {
        return res.status(403).json({ error: '仅普通用户可呼叫支援' });
      }
      const requestAllianceId = getIdString(user.allianceId);
      if (!requestAllianceId) {
        return res.status(400).json({ error: '未加入熵盟，无法呼叫支援' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: true
      });

      const settled = await settleNodeSiegeState(node, new Date());
      if (settled.changed) {
        await upsertNodeSiegeState({
          nodeId: node._id,
          siegeState: settled.siegeState,
          actorUserId: requestUserId
        });
      }

      let targetGateKey = '';
      for (const gateKey of CITY_GATE_KEYS) {
        const matched = await findActiveSiegeParticipant({
          nodeId: node._id,
          gateKey,
          userId: requestUserId
        });
        if (!matched || !matched.isInitiator) continue;
        targetGateKey = gateKey;
        break;
      }
      if (!targetGateKey) {
        return res.status(403).json({ error: '仅围城发起者可呼叫熵盟支援' });
      }

      const now = new Date();
      const workingSiegeState = getMutableNodeSiegeState(node);
      workingSiegeState[targetGateKey] = {
        ...(workingSiegeState[targetGateKey] || createEmptySiegeGateState()),
        supportNotifiedAt: now,
        updatedAt: now
      };
      await upsertNodeSiegeState({
        nodeId: node._id,
        siegeState: workingSiegeState,
        actorUserId: requestUserId
      });

      const notifyMessage = `熵盟成员 ${user.username} 在知识域「${node.name}」${CITY_GATE_LABELS[targetGateKey]}发起围城，点击可查看并支援`;
      const operationKey = new mongoose.Types.ObjectId().toString();
      const eventDedupeKey = `siege_support_event:${operationKey}`;
      const taskDedupeKey = `siege_support_broadcast_job:${operationKey}`;
      const { task: supportBroadcastTask } = await schedulerService.enqueue({
        type: 'siege_support_broadcast_job',
        runAt: now,
        payload: {
          allianceId: requestAllianceId,
          actorUserId: requestUserId,
          actorUsername: user.username || '',
          nodeId: getIdString(node._id),
          nodeName: node.name || '',
          gateKey: targetGateKey,
          title: `围城支援请求：${node.name}`,
          message: notifyMessage,
          dedupeKey: eventDedupeKey
        },
        dedupeKey: taskDedupeKey
      });

      const intelSnapshotRaw = findUserIntelSnapshotByNodeId(user, node._id);
      const intelSnapshot = intelSnapshotRaw ? serializeIntelSnapshot(intelSnapshotRaw) : null;
      const payload = buildSiegePayloadForUser({
        node,
        user,
        unitTypes,
        intelSnapshot
      });

      return res.json({
        success: true,
        message: '已提交熵盟支援广播任务',
        supportBroadcastTaskId: getIdString(supportBroadcastTask?._id) || null,
        ...payload
      });
    } catch (error) {
      console.error('呼叫围城支援错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.post('/:nodeId/siege/support', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const gateKeyRaw = typeof req.body?.gateKey === 'string' ? req.body.gateKey.trim() : '';
      const gateKey = CITY_GATE_KEYS.includes(gateKeyRaw) ? gateKeyRaw : '';
      const autoRetreatPercentRaw = Number(req.body?.autoRetreatPercent);
      const autoRetreatPercent = Math.max(1, Math.min(99, Math.floor(Number.isFinite(autoRetreatPercentRaw) ? autoRetreatPercentRaw : 40)));
      const rawUnits = Array.isArray(req.body?.units)
        ? req.body.units
        : (Array.isArray(req.body?.items) ? req.body.items : []);

      const normalizedUnits = normalizeUnitCountEntries(rawUnits.map((entry) => ({
        unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
        count: Number(entry?.count ?? entry?.qty)
      })));
      if (normalizedUnits.length === 0) {
        return res.status(400).json({ error: '请至少选择一支兵种和数量' });
      }

      const [node, user, unitTypes] = await Promise.all([
        Node.findById(nodeId).select('name status domainMaster domainAdmins relatedParentDomains relatedChildDomains'),
        User.findById(requestUserId).select('username role location allianceId armyRoster intelDomainSnapshots'),
        fetchArmyUnitTypes()
      ]);
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      if (user.role !== 'common') {
        return res.status(403).json({ error: '仅普通用户可派遣支援' });
      }
      if (isDomainMaster(node, requestUserId) || isDomainAdmin(node, requestUserId)) {
        return res.status(403).json({ error: '域主/域相不可支援攻占自己管理的知识域' });
      }

      const userAllianceId = getIdString(user.allianceId);
      if (!userAllianceId) {
        return res.status(403).json({ error: '未加入熵盟，无法支援其他熵盟' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: true
      });

      const settled = await settleNodeSiegeState(node, new Date());
      if (settled.changed) {
        await upsertNodeSiegeState({
          nodeId: node._id,
          siegeState: settled.siegeState,
          actorUserId: requestUserId
        });
      }

      const unitTypeMap = buildArmyUnitTypeMap(unitTypes);
      for (const unitEntry of normalizedUnits) {
        if (!unitTypeMap.has(unitEntry.unitTypeId)) {
          return res.status(400).json({ error: `无效兵种：${unitEntry.unitTypeId}` });
        }
      }

      const gateSummaries = CITY_GATE_KEYS.reduce((acc, itemGateKey) => {
        acc[itemGateKey] = buildSiegeGateSummary(node, itemGateKey, unitTypeMap);
        return acc;
      }, { cheng: null, qi: null });
      const sameAllianceActiveGates = CITY_GATE_KEYS.filter((itemGateKey) => (
        gateSummaries[itemGateKey]?.active
        && isSameAlliance(gateSummaries[itemGateKey]?.attackerAllianceId, userAllianceId)
      ));

      const targetGateKey = gateKey && sameAllianceActiveGates.includes(gateKey)
        ? gateKey
        : sameAllianceActiveGates[0];
      if (!targetGateKey) {
        return res.status(400).json({ error: '当前不存在可支援的同盟围城战场' });
      }
      const existingSelfParticipant = await findActiveSiegeParticipant({
        nodeId: node._id,
        gateKey: targetGateKey,
        userId: requestUserId
      });
      if (existingSelfParticipant) {
        return res.status(400).json({ error: '你已在该战场中，不能重复派遣' });
      }

      const roster = normalizeUserRoster(user.armyRoster, unitTypes);
      const rosterMap = buildUnitCountMap(roster);
      let committedMap = new Map();
      const activeSiegeParticipants = await findUserActiveParticipants({ userId: requestUserId });
      activeSiegeParticipants.forEach((participant) => {
        committedMap = mergeUnitCountMaps(committedMap, buildUnitCountMap(participant?.units || []));
      });
      const dispatchMap = buildUnitCountMap(normalizedUnits);
      for (const [unitTypeId, dispatchCount] of dispatchMap.entries()) {
        const totalOwned = rosterMap.get(unitTypeId) || 0;
        const committed = committedMap.get(unitTypeId) || 0;
        const available = Math.max(0, totalOwned - committed);
        if (dispatchCount > available) {
          const unitName = unitTypeMap.get(unitTypeId)?.name || unitTypeId;
          return res.status(400).json({
            error: `${unitName} 可派遣数量不足：可用 ${available}，请求 ${dispatchCount}`
          });
        }
      }

      const currentLocationName = (user.location || '').trim();
      const startNodes = await listApprovedNodesByNames([currentLocationName], { select: '_id name' });
      if (startNodes.length === 0) {
        return res.status(400).json({ error: '当前所在知识域无效，无法派遣支援' });
      }

      const sideNameSet = new Set(
        (targetGateKey === 'cheng' ? node.relatedParentDomains : node.relatedChildDomains)
          .filter((name) => typeof name === 'string' && !!name.trim())
      );
      const sideNames = Array.from(sideNameSet);
      const sideNodes = sideNames.length > 0
        ? await Node.find({
          status: 'approved',
          name: { $in: sideNames }
        }).select(
          isDomainTitleStateCollectionReadEnabled()
            ? '_id name'
            : '_id name citySiegeState'
        ).lean()
        : [];
      if (isDomainTitleStateCollectionReadEnabled()) {
        await hydrateNodeTitleStatesForNodes(sideNodes, {
          includeDefenseLayout: false,
          includeSiegeState: true
        });
      }
      if (sideNodes.length === 0) {
        return res.status(400).json({ error: `当前知识域无可用${CITY_GATE_LABELS[targetGateKey]}入口路径` });
      }

      const isBlockedByOtherAllianceSiege = (sideNode) => {
        if (!sideNode || typeof sideNode !== 'object') return true;
        for (const sideGateKey of CITY_GATE_KEYS) {
          const gateState = getNodeGateState(sideNode, sideGateKey);
          if (!gateState.active) continue;
          const siegeAllianceId = getIdString(gateState.attackerAllianceId);
          if (!siegeAllianceId) return true;
          if (siegeAllianceId !== userAllianceId) return true;
        }
        return false;
      };

      const availableSideNodes = sideNodes.filter((sideNode) => !isBlockedByOtherAllianceSiege(sideNode));
      if (availableSideNodes.length === 0) {
        return res.status(409).json({ error: `同侧路径已被封锁，当前无法支援${CITY_GATE_LABELS[targetGateKey]}` });
      }
      const shortestSupportPath = await deps.findShortestApprovedPathToAnyTargets({
        startName: currentLocationName,
        targetNames: availableSideNodes.map((item) => item.name),
        maxDepth: 120,
        maxVisited: 300000
      });
      if (!shortestSupportPath.found || !Array.isArray(shortestSupportPath.pathNames) || shortestSupportPath.pathNames.length === 0) {
        return res.status(409).json({ error: `同侧路径已被封锁，当前无法支援${CITY_GATE_LABELS[targetGateKey]}` });
      }

      const pathNodes = await listApprovedNodesByNames(shortestSupportPath.pathNames, { select: '_id name' });
      const pathNodeByName = new Map(pathNodes.map((item) => [item?.name || '', item]));
      const normalizedPath = [];
      for (const nodeName of shortestSupportPath.pathNames) {
        const nodeRow = pathNodeByName.get(nodeName);
        if (!nodeRow?._id || !nodeRow?.name) {
          return res.status(409).json({ error: '路径计算结果失效，请重试' });
        }
        normalizedPath.push({
          nodeId: nodeRow._id,
          nodeName: nodeRow.name
        });
      }
      const matchedSideNode = availableSideNodes.find((item) => item.name === shortestSupportPath.targetName);
      if (!matchedSideNode) {
        return res.status(409).json({ error: '支援路径目标失效，请重试' });
      }
      const selectedSupportPath = {
        sideNodeId: getIdString(matchedSideNode._id),
        sideNodeName: matchedSideNode.name,
        path: normalizedPath,
        distanceUnits: (normalizedPath.length - 1) + 1
      };

      const now = new Date();
      const arriveAt = new Date(now.getTime() + (selectedSupportPath.distanceUnits * SIEGE_SUPPORT_UNIT_DURATION_SECONDS * 1000));
      await upsertSiegeParticipant({
        nodeId: node._id,
        gateKey: targetGateKey,
        userId: user._id,
        username: user.username || '',
        allianceId: user.allianceId || null,
        units: normalizeSiegeParticipantUnits(normalizedUnits),
        fromNodeId: selectedSupportPath.path[0]?.nodeId || null,
        fromNodeName: currentLocationName,
        autoRetreatPercent,
        status: 'moving',
        isInitiator: false,
        isReinforcement: true,
        requestedAt: now,
        arriveAt,
        joinedAt: null,
        updatedAt: now
      });
      const gatePreview = await getSiegeGatePreview({
        nodeId: node._id,
        gateKey: targetGateKey,
        limit: SIEGE_PARTICIPANT_PREVIEW_LIMIT
      });

      const workingSiegeState = getMutableNodeSiegeState(node);
      workingSiegeState[targetGateKey] = {
        ...(workingSiegeState?.[targetGateKey] || {}),
        active: !!gatePreview.active,
        startedAt: workingSiegeState?.[targetGateKey]?.startedAt || now,
        updatedAt: now,
        attackerAllianceId: gatePreview.firstActiveAllianceId || workingSiegeState?.[targetGateKey]?.attackerAllianceId || user.allianceId || null,
        participantCount: Math.max(0, Number(gatePreview.participantCount) || 0),
        attackers: Array.isArray(gatePreview.attackers) ? gatePreview.attackers.slice(0, SIEGE_PARTICIPANT_PREVIEW_LIMIT) : []
      };
      await upsertNodeSiegeState({
        nodeId: node._id,
        siegeState: workingSiegeState,
        actorUserId: requestUserId
      });

      const initiatorUserId = getIdString(workingSiegeState?.[targetGateKey]?.initiatorUserId);
      if (isValidObjectId(initiatorUserId) && initiatorUserId !== requestUserId) {
        const initiatorUser = await User.findById(initiatorUserId).select('notifications');
        if (initiatorUser) {
          initiatorUser.notifications = Array.isArray(initiatorUser.notifications) ? initiatorUser.notifications : [];
          const initiatorNotification = pushNotificationToUser(initiatorUser, {
            type: 'info',
            title: `围城增援抵达路上：${node.name}`,
            message: `${user.username} 已派遣支援部队前往${CITY_GATE_LABELS[targetGateKey]}，预计 ${selectedSupportPath.distanceUnits * SIEGE_SUPPORT_UNIT_DURATION_SECONDS} 秒后到达`,
            read: false,
            status: 'info',
            nodeId: node._id,
            nodeName: node.name,
            allianceId: user.allianceId || null,
            allianceName: '',
            inviterId: user._id,
            inviterUsername: user.username || '',
            inviteeId: initiatorUser._id,
            inviteeUsername: '',
            createdAt: now
          });
          await initiatorUser.save();
          await writeNotificationsToCollection([
            toCollectionNotificationDoc(initiatorUser._id, initiatorNotification)
          ]);
        }
      }

      const intelSnapshotRaw = findUserIntelSnapshotByNodeId(user, node._id);
      const intelSnapshot = intelSnapshotRaw ? serializeIntelSnapshot(intelSnapshotRaw) : null;
      const payload = buildSiegePayloadForUser({
        node,
        user,
        unitTypes,
        intelSnapshot
      });

      return res.json({
        success: true,
        message: `已派遣支援前往${CITY_GATE_LABELS[targetGateKey]}`,
        supportTravel: {
          gateKey: targetGateKey,
          gateLabel: CITY_GATE_LABELS[targetGateKey],
          fromNodeName: currentLocationName,
          sideNodeName: selectedSupportPath.sideNodeName,
          distanceUnits: selectedSupportPath.distanceUnits,
          unitDurationSeconds: SIEGE_SUPPORT_UNIT_DURATION_SECONDS,
          arriveAt
        },
        ...payload
      });
    } catch (error) {
      console.error('派遣围城支援错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.post('/:nodeId/siege/retreat', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const [node, user, unitTypes] = await Promise.all([
        Node.findById(nodeId).select('name status'),
        User.findById(requestUserId).select('username role location allianceId armyRoster intelDomainSnapshots lastArrivedFromNodeId lastArrivedFromNodeName'),
        fetchArmyUnitTypes()
      ]);
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      if (user.role !== 'common') {
        return res.status(403).json({ error: '仅普通用户可执行撤退' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: true
      });

      const settled = await settleNodeSiegeState(node, new Date());
      if (settled.changed) {
        await upsertNodeSiegeState({
          nodeId: node._id,
          siegeState: settled.siegeState,
          actorUserId: requestUserId
        });
      }

      let targetGateKey = '';
      let retreatCount = 0;
      for (const gateKey of CITY_GATE_KEYS) {
        const initiator = await findActiveSiegeParticipant({
          nodeId: node._id,
          gateKey,
          userId: requestUserId
        });
        if (!initiator || !initiator.isInitiator) continue;
        targetGateKey = gateKey;
        const gatePreview = await getSiegeGatePreview({
          nodeId: node._id,
          gateKey,
          limit: 1
        });
        retreatCount = Math.max(0, Number(gatePreview.participantCount) || 0);
        break;
      }

      if (!targetGateKey) {
        return res.status(403).json({ error: '仅围城发起者可撤退并取消攻城' });
      }

      const now = new Date();
      await markSiegeParticipantsRetreated({
        nodeId: node._id,
        gateKey: targetGateKey,
        now
      });
      const workingSiegeState = getMutableNodeSiegeState(node);
      workingSiegeState[targetGateKey] = {
        ...createEmptySiegeGateState(),
        updatedAt: now
      };
      await upsertNodeSiegeState({
        nodeId: node._id,
        siegeState: workingSiegeState,
        actorUserId: requestUserId
      });

      const intelSnapshotRaw = findUserIntelSnapshotByNodeId(user, node._id);
      const intelSnapshot = intelSnapshotRaw ? serializeIntelSnapshot(intelSnapshotRaw) : null;
      const payload = buildSiegePayloadForUser({
        node,
        user,
        unitTypes,
        intelSnapshot
      });

      return res.json({
        success: true,
        message: `已在${CITY_GATE_LABELS[targetGateKey] || targetGateKey}撤退，攻城取消（撤回 ${retreatCount} 支部队）`,
        ...payload
      });
    } catch (error) {
      console.error('围城撤退错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.get('/me/siege-supports', authenticateToken, async (req, res) => {
    try {
      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }

      const activeParticipants = await findUserActiveParticipants({ userId: requestUserId });
      const nodeIds = Array.from(new Set(
        activeParticipants
          .map((item) => getIdString(item?.nodeId))
          .filter((id) => isValidObjectId(id))
      )).map((id) => new mongoose.Types.ObjectId(id));
      const nodeRows = nodeIds.length > 0
        ? await Node.find({
          _id: { $in: nodeIds },
          status: 'approved'
        }).select('_id name').lean()
        : [];
      const nodeNameMap = new Map(nodeRows.map((item) => [getIdString(item?._id), item?.name || '']));
      const unitTypes = await fetchArmyUnitTypes();
      const unitTypeMap = buildArmyUnitTypeMap(unitTypes);
      const nowMs = Date.now();

      const rows = [];
      for (const participant of activeParticipants) {
        const nodeId = getIdString(participant?.nodeId);
        if (!nodeNameMap.has(nodeId)) continue;
        const participantLike = { ...(participant || {}) };
        const arriveAtMs = new Date(participantLike.arriveAt || 0).getTime();
        if (participantLike.status === 'moving' && Number.isFinite(arriveAtMs) && arriveAtMs > 0 && arriveAtMs <= nowMs) {
          participantLike.status = 'sieging';
          participantLike.joinedAt = participantLike.joinedAt || new Date(nowMs);
        }
        const serialized = serializeSiegeAttacker(participantLike, unitTypeMap, nowMs);
        rows.push({
          nodeId,
          nodeName: nodeNameMap.get(nodeId) || '',
          gateKey: participantLike.gateKey || '',
          gateLabel: CITY_GATE_LABELS[participantLike.gateKey] || participantLike.gateKey || '',
          status: serialized.status,
          statusLabel: serialized.statusLabel,
          totalCount: serialized.totalCount,
          units: serialized.units,
          fromNodeName: serialized.fromNodeName,
          autoRetreatPercent: serialized.autoRetreatPercent,
          requestedAt: serialized.requestedAt,
          arriveAt: serialized.arriveAt,
          joinedAt: serialized.joinedAt,
          remainingSeconds: serialized.remainingSeconds
        });
      }

      rows.sort((a, b) => {
        const aTime = new Date(a.requestedAt || 0).getTime();
        const bTime = new Date(b.requestedAt || 0).getTime();
        return bTime - aTime;
      });

      return res.json({
        success: true,
        supports: rows
      });
    } catch (error) {
      console.error('获取围城支援状态错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });
};
