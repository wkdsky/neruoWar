module.exports = ({
  Node,
  User,
  fetchEnabledUnitTypes,
  hydrateNodeTitleStatesForNodes,
  resolveNodeSiegeState,
  resolveNodeDefenseLayout,
  upsertNodeSiegeState,
  migrateEmbeddedSiegeAttackers,
  settleSiegeArrivedParticipants,
  getSiegeGatePreview,
  getIdString,
  isValidObjectId,
  isDomainMaster,
  isDomainAdmin,
  serializeDefenseLayout,
  buildIntelGateDefenseSnapshot,
  hasAnyGateDefenseSnapshotEntries,
  buildBattlefieldGateDefenseSnapshotFromNode,
  buildGateDefenseView,
  buildUnitCountMap,
  mapToUnitCountEntries,
  mergeUnitCountMaps,
  normalizeUserRoster,
  buildArmyUnitTypeMap,
  isGateEnabledForNode,
  CITY_GATE_KEYS,
  CITY_GATE_LABELS
}) => {
  const SIEGE_SUPPORT_UNIT_DURATION_SECONDS = 60;
  const SIEGE_PARTICIPANT_PREVIEW_LIMIT = Math.max(1, parseInt(process.env.SIEGE_PARTICIPANT_PREVIEW_LIMIT, 10) || 50);
  const SIEGE_PARTICIPANT_RESULT_LIMIT_MAX = Math.max(10, parseInt(process.env.SIEGE_PARTICIPANT_RESULT_LIMIT_MAX, 10) || 200);
  const SIEGE_MIGRATE_EMBEDDED_ATTACKERS_ON_READ = process.env.SIEGE_MIGRATE_EMBEDDED_ATTACKERS_ON_READ !== 'false';
  const SIEGE_PVE_UNITS_PER_SOLDIER = Math.max(1, parseInt(process.env.SIEGE_PVE_UNITS_PER_SOLDIER, 10) || 10);
  const SIEGE_PVE_TIME_LIMIT_SEC = Math.max(60, parseInt(process.env.SIEGE_PVE_TIME_LIMIT_SEC, 10) || 240);
  const SIEGE_VIEWER_ROLE_COMMON = 'common';
  const SIEGE_VIEWER_ROLE_DOMAIN_MASTER = 'domainMaster';
  const SIEGE_VIEWER_ROLE_DOMAIN_ADMIN = 'domainAdmin';

  const getSnapshotGateDefenseByUnitMap = (snapshot = {}) => {
    const source = snapshot?.gateDefense && typeof snapshot.gateDefense === 'object'
      ? snapshot.gateDefense
      : {};
    return CITY_GATE_KEYS.reduce((acc, gateKey) => {
      acc[gateKey] = buildUnitCountMap(source[gateKey] || []);
      return acc;
    }, { cheng: new Map(), qi: new Map() });
  };

  const parseSupportStatusLabel = (status = '') => {
    if (status === 'moving') return '支援中';
    if (status === 'sieging') return '围城中';
    return '已撤退';
  };

  const serializeSiegeAttacker = (attacker = {}, unitTypeMap = new Map(), now = Date.now()) => {
    const units = mapToUnitCountEntries(buildUnitCountMap(attacker?.units || []), unitTypeMap);
    const totalCount = units.reduce((sum, item) => sum + item.count, 0);
    const arriveAtMs = new Date(attacker?.arriveAt || 0).getTime();
    const remainingSeconds = attacker?.status === 'moving' && Number.isFinite(arriveAtMs) && arriveAtMs > now
      ? Math.ceil((arriveAtMs - now) / 1000)
      : 0;
    return {
      userId: getIdString(attacker?.userId),
      username: typeof attacker?.username === 'string' ? attacker.username : '',
      allianceId: getIdString(attacker?.allianceId),
      status: attacker?.status === 'moving' || attacker?.status === 'retreated' ? attacker.status : 'sieging',
      statusLabel: parseSupportStatusLabel(attacker?.status),
      isInitiator: !!attacker?.isInitiator,
      isReinforcement: !!attacker?.isReinforcement,
      autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(attacker?.autoRetreatPercent) || 40))),
      fromNodeId: getIdString(attacker?.fromNodeId),
      fromNodeName: typeof attacker?.fromNodeName === 'string' ? attacker.fromNodeName : '',
      requestedAt: attacker?.requestedAt || null,
      arriveAt: attacker?.arriveAt || null,
      joinedAt: attacker?.joinedAt || null,
      updatedAt: attacker?.updatedAt || null,
      totalCount,
      remainingSeconds,
      units
    };
  };

  const resolveAttackGateByArrival = (node, user) => {
    const fromNodeId = getIdString(user?.lastArrivedFromNodeId);
    const fromNodeName = typeof user?.lastArrivedFromNodeName === 'string' ? user.lastArrivedFromNodeName.trim() : '';
    const parentNames = new Set((Array.isArray(node?.relatedParentDomains) ? node.relatedParentDomains : []).map((name) => (typeof name === 'string' ? name.trim() : '')).filter(Boolean));
    const childNames = new Set((Array.isArray(node?.relatedChildDomains) ? node.relatedChildDomains : []).map((name) => (typeof name === 'string' ? name.trim() : '')).filter(Boolean));

    const arrivedFromParent = fromNodeName && parentNames.has(fromNodeName);
    const arrivedFromChild = fromNodeName && childNames.has(fromNodeName);
    if (arrivedFromParent) return 'cheng';
    if (arrivedFromChild) return 'qi';

    if (!fromNodeId && !fromNodeName) {
      const hasCheng = isGateEnabledForNode(node, 'cheng');
      const hasQi = isGateEnabledForNode(node, 'qi');
      if (hasCheng && !hasQi) return 'cheng';
      if (!hasCheng && hasQi) return 'qi';
    }
    return '';
  };

  const getNodeGateState = (node, gateKey) => {
    const source = (node?.__workingCitySiegeState && typeof node.__workingCitySiegeState === 'object')
      ? node.__workingCitySiegeState
      : resolveNodeSiegeState(node, {});
    const gate = source?.[gateKey] && typeof source[gateKey] === 'object' ? source[gateKey] : {};
    const attackers = Array.isArray(gate.attackers) ? gate.attackers : [];
    return {
      active: !!gate.active,
      startedAt: gate.startedAt || null,
      updatedAt: gate.updatedAt || null,
      supportNotifiedAt: gate.supportNotifiedAt || null,
      attackerAllianceId: gate.attackerAllianceId || null,
      initiatorUserId: gate.initiatorUserId || null,
      initiatorUsername: gate.initiatorUsername || '',
      participantCount: Math.max(attackers.length, Math.floor(Number(gate.participantCount) || 0)),
      attackers
    };
  };

  const createEmptySiegeGateState = () => ({
    active: false,
    startedAt: null,
    updatedAt: null,
    supportNotifiedAt: null,
    attackerAllianceId: null,
    initiatorUserId: null,
    initiatorUsername: '',
    participantCount: 0,
    attackers: []
  });

  const createDefaultNodeSiegeState = () => ({
    cheng: createEmptySiegeGateState(),
    qi: createEmptySiegeGateState()
  });

  const clonePlainObject = (input = {}) => JSON.parse(JSON.stringify(input || {}));

  const getMutableNodeSiegeState = (node) => {
    if (!node || typeof node !== 'object') {
      return createDefaultNodeSiegeState();
    }
    if (!node.__workingCitySiegeState || typeof node.__workingCitySiegeState !== 'object') {
      const source = resolveNodeSiegeState(node, {});
      const cloned = clonePlainObject(source && typeof source === 'object' ? source : {});
      node.__workingCitySiegeState = {
        cheng: cloned?.cheng && typeof cloned.cheng === 'object'
          ? cloned.cheng
          : createEmptySiegeGateState(),
        qi: cloned?.qi && typeof cloned.qi === 'object'
          ? cloned.qi
          : createEmptySiegeGateState()
      };
    }
    return node.__workingCitySiegeState;
  };

  const isSameGatePreviewState = (before = {}, after = {}) => {
    if (!!before?.active !== !!after?.active) return false;
    if (Math.max(0, Number(before?.participantCount) || 0) !== Math.max(0, Number(after?.participantCount) || 0)) return false;
    if (getIdString(before?.attackerAllianceId) !== getIdString(after?.attackerAllianceId)) return false;
    if (getIdString(before?.initiatorUserId) !== getIdString(after?.initiatorUserId)) return false;
    if ((before?.initiatorUsername || '') !== (after?.initiatorUsername || '')) return false;
    const beforeAttackers = Array.isArray(before?.attackers) ? before.attackers : [];
    const afterAttackers = Array.isArray(after?.attackers) ? after.attackers : [];
    if (beforeAttackers.length !== afterAttackers.length) return false;
    for (let index = 0; index < beforeAttackers.length; index += 1) {
      const prev = beforeAttackers[index] || {};
      const next = afterAttackers[index] || {};
      if (getIdString(prev?.userId) !== getIdString(next?.userId)) return false;
      if ((prev?.status || '') !== (next?.status || '')) return false;
      if ((prev?.username || '') !== (next?.username || '')) return false;
    }
    return true;
  };

  const settleNodeSiegeState = async (node, nowDate = new Date()) => {
    const siegeState = getMutableNodeSiegeState(node);
    let changed = false;

    for (const gateKey of CITY_GATE_KEYS) {
      const gate = siegeState?.[gateKey];
      if (!gate || typeof gate !== 'object') continue;
      const legacyAttackers = Array.isArray(gate.attackers) ? gate.attackers : [];
      if (SIEGE_MIGRATE_EMBEDDED_ATTACKERS_ON_READ && legacyAttackers.length > 0) {
        await migrateEmbeddedSiegeAttackers({
          nodeId: node?._id,
          gateKey,
          attackers: legacyAttackers
        });
      }

      await settleSiegeArrivedParticipants({
        nodeId: node?._id,
        gateKey,
        now: nowDate
      });

      const preview = await getSiegeGatePreview({
        nodeId: node?._id,
        gateKey,
        limit: SIEGE_PARTICIPANT_PREVIEW_LIMIT
      });
      const initiator = (preview.attackers || []).find((item) => !!item?.isInitiator) || null;
      const nextGate = {
        ...(gate || createEmptySiegeGateState()),
        active: !!preview.active,
        startedAt: preview.active ? (gate.startedAt || nowDate) : null,
        updatedAt: nowDate,
        supportNotifiedAt: gate.supportNotifiedAt || null,
        attackerAllianceId: preview.active ? (preview.firstActiveAllianceId || gate.attackerAllianceId || null) : null,
        initiatorUserId: preview.active ? (initiator?.userId || gate.initiatorUserId || null) : null,
        initiatorUsername: preview.active ? (initiator?.username || gate.initiatorUsername || '') : '',
        participantCount: Math.max(0, Number(preview.participantCount) || 0),
        attackers: Array.isArray(preview.attackers) ? preview.attackers.slice(0, SIEGE_PARTICIPANT_PREVIEW_LIMIT) : []
      };
      if (!preview.active) {
        nextGate.attackerAllianceId = null;
        nextGate.initiatorUserId = null;
        nextGate.initiatorUsername = '';
        nextGate.participantCount = 0;
        nextGate.attackers = [];
      }
      if (!isSameGatePreviewState(gate, nextGate)) {
        changed = true;
      }
      siegeState[gateKey] = nextGate;
    }
    return {
      changed,
      siegeState
    };
  };

  const isSameAlliance = (allianceA, allianceB) => {
    const a = getIdString(allianceA);
    const b = getIdString(allianceB);
    return !!a && !!b && a === b;
  };

  const isSiegeAttackerActive = (attacker) => (
    attacker?.status === 'moving' || attacker?.status === 'sieging'
  );

  const buildSiegeGateSummary = (node, gateKey, unitTypeMap = new Map()) => {
    const gateState = getNodeGateState(node, gateKey);
    const now = Date.now();
    const attackers = (gateState.attackers || [])
      .map((attacker) => serializeSiegeAttacker(attacker, unitTypeMap, now))
      .filter((item) => !!item.userId);
    const activeAttackers = attackers.filter((item) => item.status === 'moving' || item.status === 'sieging');
    const aggregateMap = activeAttackers.reduce(
      (acc, item) => mergeUnitCountMaps(acc, buildUnitCountMap(item.units || [])),
      new Map()
    );
    const aggregateUnits = mapToUnitCountEntries(aggregateMap, unitTypeMap);
    const totalCount = aggregateUnits.reduce((sum, item) => sum + item.count, 0);
    const participantCount = Math.max(
      activeAttackers.length,
      Math.max(0, Math.floor(Number(gateState.participantCount) || 0))
    );
    const active = !!gateState.active && participantCount > 0;
    return {
      gateKey,
      gateLabel: CITY_GATE_LABELS[gateKey] || gateKey,
      enabled: isGateEnabledForNode(node, gateKey),
      active,
      startedAt: gateState.startedAt || null,
      updatedAt: gateState.updatedAt || null,
      supportNotifiedAt: gateState.supportNotifiedAt || null,
      attackerAllianceId: getIdString(gateState.attackerAllianceId),
      initiatorUserId: getIdString(gateState.initiatorUserId),
      initiatorUsername: gateState.initiatorUsername || '',
      participantCount,
      attackersTruncated: participantCount > attackers.length,
      attackers,
      activeAttackers,
      aggregateUnits,
      totalCount
    };
  };

  const pickDomainAdminAttackerView = (attacker = {}) => ({
    userId: getIdString(attacker?.userId),
    username: typeof attacker?.username === 'string' ? attacker.username : '',
    status: typeof attacker?.status === 'string' ? attacker.status : 'sieging',
    statusLabel: typeof attacker?.statusLabel === 'string' ? attacker.statusLabel : '',
    isInitiator: !!attacker?.isInitiator,
    isReinforcement: !!attacker?.isReinforcement,
    fromNodeName: typeof attacker?.fromNodeName === 'string' ? attacker.fromNodeName : '',
    requestedAt: attacker?.requestedAt || null,
    arriveAt: attacker?.arriveAt || null,
    joinedAt: attacker?.joinedAt || null,
    updatedAt: attacker?.updatedAt || null,
    totalCount: 0,
    remainingSeconds: Math.max(0, Math.floor(Number(attacker?.remainingSeconds) || 0)),
    units: []
  });

  const maskSiegeGateStateForDomainAdmin = (gateState = {}) => {
    const activeAttackersSource = Array.isArray(gateState?.activeAttackers)
      ? gateState.activeAttackers
      : (Array.isArray(gateState?.attackers) ? gateState.attackers : []).filter((item) => isSiegeAttackerActive(item));
    const participantCount = Math.max(
      activeAttackersSource.length,
      Math.max(0, Math.floor(Number(gateState?.participantCount) || 0))
    );
    const activeAttackers = activeAttackersSource
      .map((item) => pickDomainAdminAttackerView(item))
      .filter((item) => !!item.userId);
    return {
      gateKey: typeof gateState?.gateKey === 'string' ? gateState.gateKey : '',
      gateLabel: typeof gateState?.gateLabel === 'string' ? gateState.gateLabel : '',
      enabled: !!gateState?.enabled,
      active: !!gateState?.active && activeAttackers.length > 0,
      startedAt: gateState?.startedAt || null,
      updatedAt: gateState?.updatedAt || null,
      supportNotifiedAt: gateState?.supportNotifiedAt || null,
      attackerAllianceId: getIdString(gateState?.attackerAllianceId),
      initiatorUserId: getIdString(gateState?.initiatorUserId),
      initiatorUsername: typeof gateState?.initiatorUsername === 'string' ? gateState.initiatorUsername : '',
      participantCount,
      attackersTruncated: participantCount > activeAttackers.length,
      attackers: activeAttackers,
      activeAttackers,
      aggregateUnits: [],
      totalCount: 0
    };
  };

  const maskSiegePayloadForDomainAdmin = (payload = {}) => {
    const sourceGateStates = payload?.gateStates && typeof payload.gateStates === 'object'
      ? payload.gateStates
      : {};
    const gateStates = CITY_GATE_KEYS.reduce((acc, gateKey) => {
      acc[gateKey] = maskSiegeGateStateForDomainAdmin(sourceGateStates[gateKey] || {});
      return acc;
    }, {
      cheng: maskSiegeGateStateForDomainAdmin({ gateKey: 'cheng', gateLabel: CITY_GATE_LABELS.cheng }),
      qi: maskSiegeGateStateForDomainAdmin({ gateKey: 'qi', gateLabel: CITY_GATE_LABELS.qi })
    });
    const activeGateKeys = CITY_GATE_KEYS.filter((gateKey) => !!gateStates[gateKey]?.active);
    const compareGate = (activeGateKeys.includes(payload?.compareGate) ? payload.compareGate : activeGateKeys[0]) || '';
    const compareSupporters = (gateStates[compareGate]?.activeAttackers || []).map((item) => ({
      userId: item.userId,
      username: item.username || '未知成员',
      status: item.status,
      statusLabel: item.statusLabel,
      totalCount: 0
    }));

    return {
      ...payload,
      viewerRole: SIEGE_VIEWER_ROLE_DOMAIN_ADMIN,
      intelUsed: false,
      intelCapturedAt: null,
      intelDeploymentUpdatedAt: null,
      hasActiveSiege: activeGateKeys.length > 0,
      activeGateKeys,
      preferredGate: compareGate,
      compareGate,
      canStartSiege: false,
      startDisabledReason: '域相仅可查看攻方动态，无法发起攻占',
      canRequestSupport: false,
      canSupportSameBattlefield: false,
      supportDisabledReason: '域相仅可查看攻方动态，无法派遣支援',
      supportGate: '',
      canRetreat: false,
      retreatDisabledReason: '域相仅可查看攻方动态，无法执行撤退',
      ownRoster: {
        totalCount: 0,
        units: []
      },
      gateStates,
      compare: {
        gateKey: compareGate,
        gateLabel: CITY_GATE_LABELS[compareGate] || '',
        attacker: {
          totalCount: 0,
          units: [],
          supporters: compareSupporters
        },
        defender: {
          source: 'hidden',
          totalCount: null,
          gates: []
        }
      }
    };
  };

  const applySiegePayloadViewerRole = ({ payload, node, userId }) => {
    const currentUserId = getIdString(userId);
    if (isDomainMaster(node, currentUserId)) {
      return {
        ...payload,
        viewerRole: SIEGE_VIEWER_ROLE_DOMAIN_MASTER
      };
    }
    if (isDomainAdmin(node, currentUserId)) {
      return maskSiegePayloadForDomainAdmin(payload);
    }
    return {
      ...payload,
      viewerRole: SIEGE_VIEWER_ROLE_COMMON
    };
  };

  const buildSiegePayloadForUser = ({
    node,
    user,
    unitTypes = [],
    intelSnapshot = null
  }) => {
    const unitTypeMap = buildArmyUnitTypeMap(unitTypes);
    const roster = normalizeUserRoster(user?.armyRoster, unitTypes);
    const ownRosterMap = buildUnitCountMap(roster);
    const ownUnits = mapToUnitCountEntries(ownRosterMap, unitTypeMap);
    const ownTotalCount = ownUnits.reduce((sum, item) => sum + item.count, 0);
    const userId = getIdString(user?._id);
    const userAllianceId = getIdString(user?.allianceId);
    const isNodeMaster = isDomainMaster(node, userId);
    const isNodeAdmin = isDomainAdmin(node, userId);

    const gateSummaryMap = CITY_GATE_KEYS.reduce((acc, gateKey) => {
      acc[gateKey] = buildSiegeGateSummary(node, gateKey, unitTypeMap);
      return acc;
    }, { cheng: null, qi: null });
    const activeGateKeys = CITY_GATE_KEYS.filter((gateKey) => gateSummaryMap[gateKey]?.active);

    let userActiveGate = '';
    let userActiveAttacker = null;
    for (const gateKey of activeGateKeys) {
      const matched = gateSummaryMap[gateKey].activeAttackers.find((item) => item.userId === userId) || null;
      if (matched) {
        userActiveGate = gateKey;
        userActiveAttacker = matched;
        break;
      }
    }

    const inferredGate = resolveAttackGateByArrival(node, user);
    const preferredGate = userActiveGate || inferredGate || '';

    const serializedDefenseLayout = serializeDefenseLayout(resolveNodeDefenseLayout(node, {}));
    const layoutGateDefenseSnapshot = buildIntelGateDefenseSnapshot(serializedDefenseLayout.gateDefense, unitTypeMap);
    const layoutHasDefenseSnapshot = hasAnyGateDefenseSnapshotEntries(layoutGateDefenseSnapshot);
    const battlefieldGateDefenseSnapshot = buildBattlefieldGateDefenseSnapshotFromNode(node, unitTypeMap);
    const battlefieldHasDefenseSnapshot = hasAnyGateDefenseSnapshotEntries(battlefieldGateDefenseSnapshot.gateDefense);
    const preferredGateDefenseSnapshot = battlefieldHasDefenseSnapshot
      ? battlefieldGateDefenseSnapshot.gateDefense
      : layoutGateDefenseSnapshot;
    const preferredDefenseDeploymentUpdatedAt = battlefieldHasDefenseSnapshot
      ? (battlefieldGateDefenseSnapshot.updatedAt || serializedDefenseLayout?.updatedAt || null)
      : (serializedDefenseLayout?.updatedAt || battlefieldGateDefenseSnapshot.updatedAt || null);
    const domainMasterDefenseSnapshot = isNodeMaster
      ? {
          nodeId: getIdString(node?._id),
          nodeName: node?.name || '',
          sourceBuildingId: '',
          deploymentUpdatedAt: preferredDefenseDeploymentUpdatedAt,
          capturedAt: null,
          gateDefense: preferredGateDefenseSnapshot
        }
      : null;
    const intelHasDefenseSnapshot = hasAnyGateDefenseSnapshotEntries(intelSnapshot?.gateDefense || {});
    const normalizedIntelSnapshot = (!isNodeMaster && intelSnapshot && !intelHasDefenseSnapshot && (layoutHasDefenseSnapshot || battlefieldHasDefenseSnapshot))
      ? {
          ...intelSnapshot,
          deploymentUpdatedAt: intelSnapshot?.deploymentUpdatedAt || preferredDefenseDeploymentUpdatedAt,
          gateDefense: preferredGateDefenseSnapshot
        }
      : intelSnapshot;
    const effectiveDefenderSnapshot = domainMasterDefenseSnapshot || normalizedIntelSnapshot;
    const intelNodeId = getIdString(effectiveDefenderSnapshot?.nodeId);
    const defenderHasIntel = !!effectiveDefenderSnapshot && intelNodeId === getIdString(node?._id);
    const defenderSource = defenderHasIntel ? 'intel' : 'unknown';
    const defenderGateView = defenderHasIntel
      ? buildGateDefenseView(node, getSnapshotGateDefenseByUnitMap(effectiveDefenderSnapshot), unitTypeMap, preferredGate)
      : [];
    const defenderTotalCount = defenderSource === 'intel'
      ? defenderGateView.reduce((sum, gate) => sum + Math.max(0, Math.floor(Number(gate?.totalCount) || 0)), 0)
      : null;

    const atNode = (typeof user?.location === 'string' ? user.location.trim() : '') === (node?.name || '');
    const canAttemptSiege = user?.role === 'common' && atNode && !isNodeMaster && !isNodeAdmin;
    const selectedStartGate = inferredGate;
    const selectedStartGateState = selectedStartGate ? gateSummaryMap[selectedStartGate] : null;
    const selectedStartGateBlockedByOther = !!selectedStartGateState
      && selectedStartGateState.active
      && !isSameAlliance(selectedStartGateState.attackerAllianceId, userAllianceId)
      && selectedStartGateState.activeAttackers.some((item) => item.userId !== userId);

    let canStartSiege = canAttemptSiege
      && ownTotalCount > 0
      && !!selectedStartGate
      && !!selectedStartGateState?.enabled
      && !selectedStartGateBlockedByOther
      && !selectedStartGateState?.active;
    let startDisabledReason = '';
    if (!canAttemptSiege) {
      if (user?.role !== 'common') {
        startDisabledReason = '仅普通用户可发起攻占';
      } else if (!atNode) {
        startDisabledReason = '需先抵达该知识域后才能攻占';
      } else if (isNodeMaster || isNodeAdmin) {
        startDisabledReason = '域主/域相不可发起攻占';
      } else {
        startDisabledReason = '当前不可攻占';
      }
      canStartSiege = false;
    } else if (ownTotalCount <= 0) {
      canStartSiege = false;
      startDisabledReason = '至少需要拥有一名兵力';
    } else if (!selectedStartGate) {
      canStartSiege = false;
      startDisabledReason = '无法判定围攻门向，请从相邻知识域移动后再试';
    } else if (!selectedStartGateState?.enabled) {
      canStartSiege = false;
      startDisabledReason = '目标门不可用，无法发起围城';
    } else if (selectedStartGateBlockedByOther) {
      canStartSiege = false;
      startDisabledReason = '该门已被其他势力围城';
    } else if (selectedStartGateState?.active) {
      canStartSiege = false;
      startDisabledReason = isSameAlliance(selectedStartGateState.attackerAllianceId, userAllianceId)
        ? '该门已在围城中，可通过支援加入'
        : '该门已在围城中';
    }

    const sameAllianceActiveGates = activeGateKeys.filter((gateKey) => (
      isSameAlliance(gateSummaryMap[gateKey]?.attackerAllianceId, userAllianceId)
    ));
    const supportGate = userActiveGate || (
      preferredGate && sameAllianceActiveGates.includes(preferredGate)
        ? preferredGate
        : sameAllianceActiveGates[0]
    ) || '';
    const canSupportSameBattlefield = !!supportGate
      && !!userAllianceId
      && !userActiveAttacker
      && user?.role === 'common';
    const supportDisabledReason = canSupportSameBattlefield
      ? ''
      : (!userAllianceId
          ? '未加入熵盟，无法请求支援'
          : (userActiveAttacker ? '你已在该战场中' : '当前无可支援的同盟围城战场'));
    const canRetreat = !!userActiveAttacker && !!userActiveAttacker.isInitiator;
    const retreatDisabledReason = canRetreat
      ? ''
      : (userActiveAttacker ? '仅围城发起者可撤退并取消攻城' : '你未参与当前围城');

    const compareGate = userActiveGate || supportGate || preferredGate || '';
    const attackerCompareUnits = compareGate && gateSummaryMap[compareGate]?.active
      ? gateSummaryMap[compareGate].aggregateUnits
      : ownUnits;
    const attackerCompareTotal = attackerCompareUnits.reduce((sum, item) => sum + item.count, 0);
    const supporterRows = compareGate && gateSummaryMap[compareGate]?.active
      ? gateSummaryMap[compareGate].activeAttackers.map((item) => ({
          userId: item.userId,
          username: item.username || '未知成员',
          status: item.status,
          statusLabel: item.statusLabel,
          totalCount: item.totalCount
        }))
      : [];

    const payload = {
      nodeId: getIdString(node?._id),
      nodeName: node?.name || '',
      intelUsed: !domainMasterDefenseSnapshot && defenderHasIntel,
      intelCapturedAt: !domainMasterDefenseSnapshot && defenderHasIntel ? (effectiveDefenderSnapshot?.capturedAt || null) : null,
      intelDeploymentUpdatedAt: defenderHasIntel ? (effectiveDefenderSnapshot?.deploymentUpdatedAt || null) : null,
      gateStates: {
        cheng: gateSummaryMap.cheng,
        qi: gateSummaryMap.qi
      },
      activeGateKeys,
      hasActiveSiege: activeGateKeys.length > 0,
      preferredGate,
      inferredGate,
      compareGate,
      canStartSiege,
      startDisabledReason,
      canRequestSupport: !!userActiveAttacker && !!userActiveAttacker.isInitiator && !!userAllianceId,
      canSupportSameBattlefield,
      supportDisabledReason,
      supportGate,
      canRetreat,
      retreatDisabledReason,
      ownRoster: {
        totalCount: ownTotalCount,
        units: ownUnits
      },
      compare: {
        gateKey: compareGate,
        gateLabel: CITY_GATE_LABELS[compareGate] || '',
        attacker: {
          totalCount: attackerCompareTotal,
          units: attackerCompareUnits,
          supporters: supporterRows
        },
        defender: {
          source: defenderSource,
          totalCount: defenderTotalCount,
          gates: defenderGateView
        }
      }
    };
    return applySiegePayloadViewerRole({
      payload,
      node,
      userId
    });
  };

  const createRouteExposeError = (statusCode = 400, message = '请求参数错误', code = '') => {
    const error = new Error(message || '请求参数错误');
    error.statusCode = Number(statusCode) || 400;
    error.expose = true;
    if (code) error.code = code;
    return error;
  };

  const normalizeBattleResultSide = (raw = {}) => {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      start: Math.max(0, Math.floor(Number(source.start) || 0)),
      remain: Math.max(0, Math.floor(Number(source.remain) || 0)),
      kills: Math.max(0, Math.floor(Number(source.kills) || 0))
    };
  };

  const sanitizeBattleResultDetails = (raw = {}) => {
    if (!raw || typeof raw !== 'object') return {};
    const details = { ...raw };
    if (details.byUnitType && typeof details.byUnitType === 'object') {
      const nextByUnitType = {};
      Object.entries(details.byUnitType).forEach(([unitTypeId, item]) => {
        if (typeof unitTypeId !== 'string' || !unitTypeId.trim()) return;
        if (!item || typeof item !== 'object') return;
        nextByUnitType[unitTypeId.trim()] = {
          start: Math.max(0, Math.floor(Number(item.start) || 0)),
          remain: Math.max(0, Math.floor(Number(item.remain) || 0)),
          kills: Math.max(0, Math.floor(Number(item.kills) || 0))
        };
      });
      details.byUnitType = nextByUnitType;
    }
    if (details.buildingsDestroyed !== undefined) {
      details.buildingsDestroyed = Math.max(0, Math.floor(Number(details.buildingsDestroyed) || 0));
    }
    return details;
  };

  const resolveSiegePveBattleContext = async ({ nodeId = '', requestUserId = '', gateKey = '' } = {}) => {
    const safeNodeId = getIdString(nodeId);
    const safeUserId = getIdString(requestUserId);
    if (!isValidObjectId(safeUserId)) {
      throw createRouteExposeError(401, '无效的用户身份');
    }
    if (!isValidObjectId(safeNodeId)) {
      throw createRouteExposeError(400, '无效的知识域ID');
    }
    if (!CITY_GATE_KEYS.includes(gateKey)) {
      throw createRouteExposeError(400, 'gateKey 必须为 cheng 或 qi');
    }

    const [node, user, unitTypes] = await Promise.all([
      Node.findById(safeNodeId).select('name status domainMaster domainAdmins relatedParentDomains relatedChildDomains'),
      User.findById(safeUserId).select('username role allianceId armyRoster intelDomainSnapshots'),
      fetchEnabledUnitTypes()
    ]);
    if (!node || node.status !== 'approved') {
      throw createRouteExposeError(404, '知识域不存在或不可操作');
    }
    if (!user) {
      throw createRouteExposeError(404, '用户不存在');
    }
    if (user.role !== 'common') {
      throw createRouteExposeError(403, '仅普通用户可进入围城战斗');
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
        actorUserId: safeUserId
      });
    }

    const unitTypeMap = buildArmyUnitTypeMap(unitTypes);
    const gateSummaryMap = CITY_GATE_KEYS.reduce((acc, key) => {
      acc[key] = buildSiegeGateSummary(node, key, unitTypeMap);
      return acc;
    }, { cheng: null, qi: null });
    const activeGateKeys = CITY_GATE_KEYS.filter((key) => !!gateSummaryMap[key]?.active);
    if (!activeGateKeys.includes(gateKey)) {
      throw createRouteExposeError(403, '该门当前无有效围城战斗');
    }
    const gateSummary = gateSummaryMap[gateKey];
    const participant = (gateSummary?.activeAttackers || []).find((item) => item.userId === safeUserId) || null;
    if (!participant) {
      throw createRouteExposeError(403, '仅该门围城攻方参战者可进入战斗');
    }

    return {
      node,
      user,
      unitTypes,
      unitTypeMap,
      gateSummary,
      participant,
      activeGateKeys
    };
  };

  return {
    SIEGE_SUPPORT_UNIT_DURATION_SECONDS,
    SIEGE_PARTICIPANT_PREVIEW_LIMIT,
    SIEGE_PARTICIPANT_RESULT_LIMIT_MAX,
    SIEGE_PVE_UNITS_PER_SOLDIER,
    SIEGE_PVE_TIME_LIMIT_SEC,
    serializeSiegeAttacker,
    resolveAttackGateByArrival,
    getNodeGateState,
    createEmptySiegeGateState,
    getMutableNodeSiegeState,
    settleNodeSiegeState,
    isSameAlliance,
    isSiegeAttackerActive,
    buildSiegeGateSummary,
    buildSiegePayloadForUser,
    normalizeBattleResultSide,
    sanitizeBattleResultDetails,
    resolveSiegePveBattleContext
  };
};
