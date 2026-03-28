module.exports = ({
  mongoose,
  User,
  DistributionParticipant,
  DistributionResult,
  KnowledgeDistributionService,
  getIdString,
  isValidObjectId,
  decodeTimeCursor,
  encodeTimeCursor,
  buildTimeCursorQuery
}) => {
  const toDistributionSessionExecuteAt = (lock = {}) => {
    const ms = new Date(lock?.executeAt || 0).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return new Date(ms);
  };

  const DISTRIBUTION_LOCK_PARTICIPANT_PREVIEW_LIMIT = 50;
  const DISTRIBUTION_JOIN_ORDER_SCAN_LIMIT = 5000;
  const DISTRIBUTION_LEGACY_PARTICIPANT_MIRROR_LIMIT = 2000;
  const DISTRIBUTION_POOL_USER_LIST_LIMIT = 200;
  const DISTRIBUTION_RESULT_PAGE_SIZE_MAX = 200;

  const parseDistributionResultCursor = (value = '') => {
    if (typeof value !== 'string') return null;
    return decodeTimeCursor(value);
  };

  const listDistributionResultsByNode = async ({
    nodeId,
    executeAt = null,
    limit = 50,
    cursor = null
  } = {}) => {
    if (!isValidObjectId(nodeId)) {
      return { rows: [], nextCursor: null };
    }
    const safeLimit = Math.max(1, Math.min(DISTRIBUTION_RESULT_PAGE_SIZE_MAX, parseInt(limit, 10) || 50));
    const query = {
      nodeId: new mongoose.Types.ObjectId(String(nodeId))
    };
    if (executeAt instanceof Date) {
      query.executeAt = executeAt;
    }
    const cursorQuery = buildTimeCursorQuery('createdAt', cursor);
    if (cursorQuery) {
      Object.assign(query, cursorQuery);
    }

    const rows = await DistributionResult.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(safeLimit)
      .select('nodeId executeAt userId amount createdAt')
      .lean();
    const tail = rows.length > 0 ? rows[rows.length - 1] : null;
    const nextCursor = rows.length >= safeLimit
      ? encodeTimeCursor({
        t: new Date(tail?.createdAt || 0),
        id: tail?._id
      })
      : null;
    return { rows, nextCursor };
  };

  const listDistributionResultsByUser = async ({
    userId,
    limit = 50,
    cursor = null
  } = {}) => {
    if (!isValidObjectId(userId)) {
      return { rows: [], nextCursor: null };
    }
    const safeLimit = Math.max(1, Math.min(DISTRIBUTION_RESULT_PAGE_SIZE_MAX, parseInt(limit, 10) || 50));
    const query = {
      userId: new mongoose.Types.ObjectId(String(userId))
    };
    const cursorQuery = buildTimeCursorQuery('createdAt', cursor);
    if (cursorQuery) {
      Object.assign(query, cursorQuery);
    }
    const rows = await DistributionResult.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(safeLimit)
      .select('nodeId executeAt userId amount createdAt')
      .lean();
    const tail = rows.length > 0 ? rows[rows.length - 1] : null;
    const nextCursor = rows.length >= safeLimit
      ? encodeTimeCursor({
        t: new Date(tail?.createdAt || 0),
        id: tail?._id
      })
      : null;
    return { rows, nextCursor };
  };

  const buildManualJoinOrderMapFromLegacyLock = (lock = {}, limit = DISTRIBUTION_JOIN_ORDER_SCAN_LIMIT) => {
    const map = new Map();
    const rows = Array.isArray(lock?.participants) ? lock.participants : [];
    const maxScan = Math.max(100, Math.min(20000, parseInt(limit, 10) || DISTRIBUTION_JOIN_ORDER_SCAN_LIMIT));
    for (let i = 0; i < rows.length && i < maxScan; i += 1) {
      const item = rows[i] || {};
      const userId = getIdString(item?.userId);
      if (!isValidObjectId(userId)) continue;
      const joinedAtMs = new Date(item?.joinedAt || 0).getTime();
      const orderMs = Number.isFinite(joinedAtMs) && joinedAtMs > 0 ? joinedAtMs : Number.MAX_SAFE_INTEGER;
      map.set(userId, orderMs);
    }
    return map;
  };

  const getActiveManualParticipantSet = async ({ nodeId = '', lock = {}, atMs = Date.now() } = {}) => {
    const ids = await KnowledgeDistributionService.loadActiveManualParticipantIds({
      nodeId,
      lock,
      atMs
    });
    return new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => getIdString(id))
        .filter((id) => isValidObjectId(id))
    );
  };

  const listDistributionParticipantsBySession = async ({
    nodeId,
    executeAt,
    page = 1,
    pageSize = 50,
    activeOnly = false
  } = {}) => {
    if (!isValidObjectId(nodeId) || !(executeAt instanceof Date)) {
      return {
        total: 0,
        page: 1,
        pageSize: 50,
        rows: []
      };
    }

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safePageSize = Math.max(1, Math.min(200, parseInt(pageSize, 10) || 50));
    const filter = {
      nodeId: new mongoose.Types.ObjectId(String(nodeId)),
      executeAt
    };
    if (activeOnly) {
      filter.exitedAt = null;
    }

    const [total, rows] = await Promise.all([
      DistributionParticipant.countDocuments(filter),
      DistributionParticipant.find(filter)
        .sort({ joinedAt: 1, _id: 1 })
        .skip((safePage - 1) * safePageSize)
        .limit(safePageSize)
        .select('userId joinedAt exitedAt')
        .lean()
    ]);

    return {
      total,
      page: safePage,
      pageSize: safePageSize,
      rows
    };
  };

  const syncDistributionParticipantJoinRecord = async ({
    nodeId,
    executeAt,
    userId,
    joinedAt
  }) => {
    if (!isValidObjectId(nodeId) || !isValidObjectId(userId) || !(executeAt instanceof Date)) return;
    await DistributionParticipant.updateOne(
      {
        nodeId: new mongoose.Types.ObjectId(String(nodeId)),
        executeAt,
        userId: new mongoose.Types.ObjectId(String(userId))
      },
      {
        $set: {
          joinedAt: joinedAt instanceof Date ? joinedAt : new Date(),
          exitedAt: null
        }
      },
      { upsert: true }
    );
  };

  const syncDistributionParticipantExitRecord = async ({
    nodeId,
    executeAt,
    userId,
    exitedAt
  }) => {
    if (!isValidObjectId(nodeId) || !isValidObjectId(userId) || !(executeAt instanceof Date)) return;
    await DistributionParticipant.updateOne(
      {
        nodeId: new mongoose.Types.ObjectId(String(nodeId)),
        executeAt,
        userId: new mongoose.Types.ObjectId(String(userId))
      },
      {
        $set: {
          exitedAt: exitedAt instanceof Date ? exitedAt : new Date()
        },
        $setOnInsert: {
          joinedAt: exitedAt instanceof Date ? exitedAt : new Date()
        }
      },
      { upsert: true }
    );
  };

  const READ_LEGACY_RESULTUSERREWARDS = process.env.READ_LEGACY_RESULTUSERREWARDS !== 'false';

  const clampPercent = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, parsed));
  };

  const round2 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed * 100) / 100;
  };

  const normalizePercentUserRules = (items = []) => {
    const result = [];
    const seen = new Set();
    for (const item of (Array.isArray(items) ? items : [])) {
      const userId = getIdString(item?.userId);
      if (!isValidObjectId(userId) || seen.has(userId)) continue;
      seen.add(userId);
      result.push({
        userId,
        percent: clampPercent(item?.percent, 0)
      });
    }
    return result;
  };

  const normalizePercentAllianceRules = (items = []) => {
    const result = [];
    const seen = new Set();
    for (const item of (Array.isArray(items) ? items : [])) {
      const allianceId = getIdString(item?.allianceId);
      if (!isValidObjectId(allianceId) || seen.has(allianceId)) continue;
      seen.add(allianceId);
      result.push({
        allianceId,
        percent: clampPercent(item?.percent, 0)
      });
    }
    return result;
  };

  const normalizeObjectIdArray = (items = []) => {
    const result = [];
    const seen = new Set();
    for (const item of (Array.isArray(items) ? items : [])) {
      const id = getIdString(item);
      if (!isValidObjectId(id) || seen.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
    return result;
  };

  const normalizeScheduleSlots = (items = []) => {
    const result = [];
    const seen = new Set();
    for (const item of (Array.isArray(items) ? items : [])) {
      const weekday = parseInt(item?.weekday, 10);
      const hour = parseInt(item?.hour, 10);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
      const key = `${weekday}-${hour}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ weekday, hour });
    }
    return result;
  };

  const sanitizeDistributionRuleInput = (rawRule = {}) => ({
    enabled: !!rawRule?.enabled,
    distributionScope: rawRule?.distributionScope === 'partial' ? 'partial' : 'all',
    distributionPercent: clampPercent(rawRule?.distributionPercent, 100),
    masterPercent: clampPercent(rawRule?.masterPercent, 10),
    adminPercents: normalizePercentUserRules(rawRule?.adminPercents),
    customUserPercents: normalizePercentUserRules(rawRule?.customUserPercents),
    nonHostileAlliancePercent: clampPercent(rawRule?.nonHostileAlliancePercent, 0),
    specificAlliancePercents: normalizePercentAllianceRules(rawRule?.specificAlliancePercents),
    noAlliancePercent: clampPercent(rawRule?.noAlliancePercent, 0),
    blacklistUserIds: normalizeObjectIdArray(
      rawRule?.blacklistUserIds ||
      (Array.isArray(rawRule?.blacklistUsers) ? rawRule.blacklistUsers.map((item) => item?.userId || item?._id || item) : [])
    ),
    blacklistAllianceIds: normalizeObjectIdArray(
      rawRule?.blacklistAllianceIds ||
      (Array.isArray(rawRule?.blacklistAlliances) ? rawRule.blacklistAlliances.map((item) => item?.allianceId || item?._id || item) : [])
    )
  });

  const sanitizeDistributionScheduleInput = (rawSchedule = []) => normalizeScheduleSlots(rawSchedule);

  const sanitizeDistributionRuleProfileInput = (rawProfile = {}, index = 0) => {
    const source = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
    const profileId = typeof source.profileId === 'string' && source.profileId.trim()
      ? source.profileId.trim()
      : `rule_${Date.now()}_${index + 1}`;
    const name = typeof source.name === 'string' && source.name.trim()
      ? source.name.trim()
      : `规则${index + 1}`;
    const ruleSource = source.rule && typeof source.rule === 'object' ? source.rule : source;
    return {
      profileId,
      name,
      rule: sanitizeDistributionRuleInput(ruleSource)
    };
  };

  const collectRuleUserIds = (rule = {}) => Array.from(new Set([
    ...(Array.isArray(rule?.adminPercents) ? rule.adminPercents.map((item) => getIdString(item?.userId)) : []),
    ...(Array.isArray(rule?.customUserPercents) ? rule.customUserPercents.map((item) => getIdString(item?.userId)) : []),
    ...(Array.isArray(rule?.blacklistUserIds) ? rule.blacklistUserIds.map((item) => getIdString(item)) : [])
  ].filter((id) => isValidObjectId(id))));

  const loadCommonUserIdSet = async (userIds = []) => {
    const targetIds = Array.from(new Set((Array.isArray(userIds) ? userIds : [])
      .map((id) => getIdString(id))
      .filter((id) => isValidObjectId(id))));
    if (targetIds.length === 0) return new Set();
    const commonUsers = await User.find({
      _id: { $in: targetIds },
      role: 'common'
    }).select('_id').lean();
    return new Set(commonUsers.map((item) => getIdString(item._id)).filter((id) => isValidObjectId(id)));
  };

  const filterRuleUsersByAllowedSet = (rule = {}, allowedUserIdSet = new Set()) => ({
    ...rule,
    adminPercents: (Array.isArray(rule?.adminPercents) ? rule.adminPercents : [])
      .filter((item) => allowedUserIdSet.has(getIdString(item?.userId))),
    customUserPercents: (Array.isArray(rule?.customUserPercents) ? rule.customUserPercents : [])
      .filter((item) => allowedUserIdSet.has(getIdString(item?.userId))),
    blacklistUserIds: (Array.isArray(rule?.blacklistUserIds) ? rule.blacklistUserIds : [])
      .map((item) => getIdString(item))
      .filter((id) => allowedUserIdSet.has(id))
  });

  const computeDistributionPercentSummary = (rule = {}, allianceContributionPercent = 0) => {
    const x = clampPercent(rule?.masterPercent, 10);
    const y = (Array.isArray(rule?.adminPercents) ? rule.adminPercents : [])
      .reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
    const z = clampPercent(allianceContributionPercent, 0);
    const b = (Array.isArray(rule?.customUserPercents) ? rule.customUserPercents : [])
      .reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
    const d = clampPercent(rule?.nonHostileAlliancePercent, 0);
    const e = (Array.isArray(rule?.specificAlliancePercents) ? rule.specificAlliancePercents : [])
      .reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
    const f = clampPercent(rule?.noAlliancePercent, 0);
    const total = x + y + z + b + d + e + f;
    return {
      x: round2(x),
      y: round2(y),
      z: round2(z),
      b: round2(b),
      d: round2(d),
      e: round2(e),
      f: round2(f),
      total: round2(total)
    };
  };

  const serializeDistributionRule = (rule = {}) => ({
    enabled: !!rule?.enabled,
    distributionScope: rule?.distributionScope === 'partial' ? 'partial' : 'all',
    distributionPercent: round2(clampPercent(rule?.distributionPercent, 100)),
    masterPercent: round2(clampPercent(rule?.masterPercent, 10)),
    adminPercents: (Array.isArray(rule?.adminPercents) ? rule.adminPercents : []).map((item) => ({
      userId: getIdString(item?.userId),
      percent: round2(clampPercent(item?.percent, 0))
    })),
    customUserPercents: (Array.isArray(rule?.customUserPercents) ? rule.customUserPercents : []).map((item) => ({
      userId: getIdString(item?.userId),
      percent: round2(clampPercent(item?.percent, 0))
    })),
    nonHostileAlliancePercent: round2(clampPercent(rule?.nonHostileAlliancePercent, 0)),
    specificAlliancePercents: (Array.isArray(rule?.specificAlliancePercents) ? rule.specificAlliancePercents : []).map((item) => ({
      allianceId: getIdString(item?.allianceId),
      percent: round2(clampPercent(item?.percent, 0))
    })),
    noAlliancePercent: round2(clampPercent(rule?.noAlliancePercent, 0)),
    blacklistUserIds: (Array.isArray(rule?.blacklistUserIds) ? rule.blacklistUserIds : []).map((item) => getIdString(item)).filter(Boolean),
    blacklistAllianceIds: (Array.isArray(rule?.blacklistAllianceIds) ? rule.blacklistAllianceIds : []).map((item) => getIdString(item)).filter(Boolean)
  });

  const serializeDistributionSchedule = (schedule = []) => (
    Array.isArray(schedule) ? schedule.map((item) => ({
      weekday: parseInt(item?.weekday, 10),
      hour: parseInt(item?.hour, 10)
    })).filter((item) => Number.isInteger(item.weekday) && Number.isInteger(item.hour)) : []
  );

  const serializeDistributionRuleProfile = (profile = {}) => ({
    profileId: typeof profile?.profileId === 'string' ? profile.profileId : '',
    name: typeof profile?.name === 'string' ? profile.name : '',
    rule: serializeDistributionRule(profile?.rule || {})
  });

  const serializeDistributionLock = (locked = null, options = {}) => {
    if (!locked) return null;
    const participantPreviewLimit = Math.max(
      0,
      Math.min(500, parseInt(options?.participantPreviewLimit, 10) || DISTRIBUTION_LOCK_PARTICIPANT_PREVIEW_LIMIT)
    );
    const executeAtMs = new Date(locked.executeAt || 0).getTime();
    const entryCloseAtMsRaw = new Date(locked.entryCloseAt || 0).getTime();
    const endAtMsRaw = new Date(locked.endAt || 0).getTime();
    const entryCloseAt = Number.isFinite(entryCloseAtMsRaw) && entryCloseAtMsRaw > 0
      ? new Date(entryCloseAtMsRaw)
      : (Number.isFinite(executeAtMs) && executeAtMs > 0 ? new Date(executeAtMs - 60 * 1000) : null);
    const endAt = Number.isFinite(endAtMsRaw) && endAtMsRaw > 0
      ? new Date(endAtMsRaw)
      : (Number.isFinite(executeAtMs) && executeAtMs > 0 ? new Date(executeAtMs + 60 * 1000) : null);
    const participants = [];
    let participantTotal = 0;
    let activeParticipantCount = 0;
    for (const item of (Array.isArray(locked.participants) ? locked.participants : [])) {
      const userId = getIdString(item?.userId);
      if (!isValidObjectId(userId)) continue;
      participantTotal += 1;
      const exitedAt = item?.exitedAt || null;
      if (!exitedAt) activeParticipantCount += 1;
      if (participants.length < participantPreviewLimit) {
        participants.push({
          userId,
          joinedAt: item?.joinedAt || null,
          exitedAt
        });
      }
    }
    const resultUserRewards = (Array.isArray(locked.resultUserRewards) ? locked.resultUserRewards : []).map((item) => ({
      userId: getIdString(item?.userId),
      amount: round2(Math.max(0, Number(item?.amount) || 0))
    })).filter((item) => isValidObjectId(item.userId));
    const rewardParticipantCount = Math.max(
      resultUserRewards.length,
      Math.max(0, Math.floor(Number(locked?.rewardParticipantCount) || 0))
    );
    return {
      executeAt: locked.executeAt || null,
      entryCloseAt: entryCloseAt || null,
      endAt: endAt || null,
      executedAt: locked.executedAt || null,
      announcedAt: locked.announcedAt || null,
      projectedTotal: round2(Number(locked.projectedTotal) || 0),
      projectedDistributableTotal: round2(Number(locked.projectedDistributableTotal) || 0),
      masterAllianceId: getIdString(locked.masterAllianceId) || '',
      masterAllianceName: locked.masterAllianceName || '',
      allianceContributionPercent: round2(clampPercent(locked.allianceContributionPercent, 0)),
      distributionScope: locked?.distributionScope === 'partial' ? 'partial' : 'all',
      distributionPercent: round2(clampPercent(locked?.distributionPercent, 100)),
      ruleProfileId: typeof locked.ruleProfileId === 'string' ? locked.ruleProfileId : '',
      ruleProfileName: typeof locked.ruleProfileName === 'string' ? locked.ruleProfileName : '',
      activeParticipantCount,
      participantTotal,
      participantsTruncated: participantTotal > participants.length,
      participants,
      distributedTotal: round2(Math.max(0, Number(locked?.distributedTotal) || 0)),
      rewardParticipantCount,
      resultUserRewardsTruncated: rewardParticipantCount > resultUserRewards.length,
      resultUserRewards,
      enemyAllianceIds: (Array.isArray(locked.enemyAllianceIds) ? locked.enemyAllianceIds : []).map((item) => getIdString(item)).filter(Boolean),
      ruleSnapshot: serializeDistributionRule(locked.ruleSnapshot || {})
    };
  };

  const parseDistributionExecuteAtHour = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return null;
    if (parsed.getMinutes() !== 0 || parsed.getSeconds() !== 0 || parsed.getMilliseconds() !== 0) {
      return null;
    }
    return parsed;
  };

  const extractDistributionProfilesFromNode = (node) => {
    const inputProfiles = Array.isArray(node?.knowledgeDistributionRuleProfiles)
      ? node.knowledgeDistributionRuleProfiles
      : [];
    const profiles = inputProfiles
      .map((profile, index) => sanitizeDistributionRuleProfileInput(profile, index))
      .filter((profile, index, arr) => profile.profileId && arr.findIndex((item) => item.profileId === profile.profileId) === index);

    if (profiles.length === 0) {
      profiles.push({
        profileId: 'default',
        name: '默认规则',
        rule: sanitizeDistributionRuleInput(node?.knowledgeDistributionRule || {})
      });
    }

    const rawActiveRuleId = typeof node?.knowledgeDistributionActiveRuleId === 'string'
      ? node.knowledgeDistributionActiveRuleId.trim()
      : '';
    const activeRuleId = profiles.some((profile) => profile.profileId === rawActiveRuleId)
      ? rawActiveRuleId
      : profiles[0].profileId;
    const scheduleSlots = serializeDistributionSchedule(
      Array.isArray(node?.knowledgeDistributionScheduleSlots) && node.knowledgeDistributionScheduleSlots.length > 0
        ? node.knowledgeDistributionScheduleSlots
        : node?.knowledgeDistributionRule?.scheduleSlots
    );

    return {
      profiles,
      activeRuleId,
      scheduleSlots
    };
  };

  const resolveDistributionLockTimeline = (lock = {}) => {
    const timeline = KnowledgeDistributionService.getLockTimeline(lock || {});
    return {
      executeAtMs: Number(timeline.executeAtMs) || 0,
      entryCloseAtMs: Number(timeline.entryCloseAtMs) || 0,
      endAtMs: Number(timeline.endAtMs) || 0
    };
  };

  const getDistributionLockPhase = (lock = {}, now = new Date()) => {
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const { executeAtMs, entryCloseAtMs, endAtMs } = resolveDistributionLockTimeline(lock);
    if (!Number.isFinite(executeAtMs) || executeAtMs <= 0) return 'none';
    if (Number.isFinite(endAtMs) && endAtMs > 0 && nowMs >= endAtMs) return 'ended';
    if (nowMs < entryCloseAtMs) return 'entry_open';
    if (nowMs < executeAtMs) return 'entry_closed';
    return 'settling';
  };

  const getTravelStatus = (travelState) => {
    if (!travelState) return 'idle';
    if (typeof travelState.status === 'string' && travelState.status) return travelState.status;
    return travelState.isTraveling ? 'moving' : 'idle';
  };

  const isUserIdleAtNode = (user, nodeName) => (
    !!user &&
    (user.location || '') === nodeName &&
    getTravelStatus(user.travelState) === 'idle'
  );

  return {
    toDistributionSessionExecuteAt,
    DISTRIBUTION_LOCK_PARTICIPANT_PREVIEW_LIMIT,
    DISTRIBUTION_LEGACY_PARTICIPANT_MIRROR_LIMIT,
    DISTRIBUTION_POOL_USER_LIST_LIMIT,
    DISTRIBUTION_RESULT_PAGE_SIZE_MAX,
    parseDistributionResultCursor,
    listDistributionResultsByNode,
    listDistributionResultsByUser,
    buildManualJoinOrderMapFromLegacyLock,
    getActiveManualParticipantSet,
    listDistributionParticipantsBySession,
    syncDistributionParticipantJoinRecord,
    syncDistributionParticipantExitRecord,
    READ_LEGACY_RESULTUSERREWARDS,
    clampPercent,
    round2,
    sanitizeDistributionRuleInput,
    sanitizeDistributionScheduleInput,
    sanitizeDistributionRuleProfileInput,
    collectRuleUserIds,
    loadCommonUserIdSet,
    filterRuleUsersByAllowedSet,
    computeDistributionPercentSummary,
    serializeDistributionRule,
    serializeDistributionRuleProfile,
    serializeDistributionLock,
    parseDistributionExecuteAtHour,
    extractDistributionProfilesFromNode,
    resolveDistributionLockTimeline,
    getDistributionLockPhase,
    isUserIdleAtNode
  };
};
