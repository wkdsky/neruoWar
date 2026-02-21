const mongoose = require('mongoose');
const Node = require('../models/Node');
const User = require('../models/User');
const DistributionParticipant = require('../models/DistributionParticipant');
const EntropyAlliance = require('../models/EntropyAlliance');
const { writeNotificationsToCollection } = require('./notificationStore');

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
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
const toCents = (value) => Math.max(0, Math.round((Number(value) || 0) * 100));
const fromCents = (value) => round2((Number(value) || 0) / 100);
const getDistributionScopePercent = (ruleOrLock = {}) => {
  const scope = ruleOrLock?.distributionScope === 'partial' ? 'partial' : 'all';
  const percent = clampPercent(ruleOrLock?.distributionPercent, 100);
  return scope === 'partial' ? percent : 100;
};

const getTravelStatus = (travelState) => {
  if (!travelState) return 'idle';
  if (typeof travelState.status === 'string' && travelState.status) return travelState.status;
  return travelState.isTraveling ? 'moving' : 'idle';
};

const createIdleTravelState = (unitDurationSeconds = 60) => {
  const safeDuration = Math.max(1, parseInt(unitDurationSeconds, 10) || 60);
  return {
    status: 'idle',
    isTraveling: false,
    path: [],
    startedAt: null,
    unitDurationSeconds: safeDuration,
    targetNodeId: null,
    stoppingNearestNodeId: null,
    stoppingNearestNodeName: '',
    stopStartedAt: null,
    stopDurationSeconds: 0,
    stopFromNode: null,
    queuedTargetNodeId: null,
    queuedTargetNodeName: ''
  };
};

const resolveEffectiveUserPresence = (user, now = new Date()) => {
  const safeNowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const travel = user?.travelState || {};
  const status = getTravelStatus(travel);
  const currentLocation = user?.location || '';
  const unitDurationSeconds = Math.max(1, parseInt(travel.unitDurationSeconds, 10) || 60);

  if (status === 'moving') {
    const path = Array.isArray(travel.path) ? travel.path : [];
    const startedAtMs = new Date(travel.startedAt || 0).getTime();
    const totalDurationMs = (Math.max(0, path.length - 1) * unitDurationSeconds * 1000);
    if (path.length >= 2 && Number.isFinite(startedAtMs) && startedAtMs > 0 && safeNowMs >= startedAtMs + totalDurationMs) {
      const arrivedNodeName = path[path.length - 1]?.nodeName || currentLocation;
      return {
        location: arrivedNodeName,
        status: 'idle',
        shouldPersist: status !== 'idle' || arrivedNodeName !== currentLocation,
        nextTravelState: createIdleTravelState(unitDurationSeconds)
      };
    }
  }

  if (status === 'stopping') {
    const stopStartedAtMs = new Date(travel.stopStartedAt || 0).getTime();
    const stopDurationSeconds = Math.max(0, Number(travel.stopDurationSeconds) || 0);
    const stopDurationMs = stopDurationSeconds * 1000;
    const nearestNodeName = travel.stoppingNearestNodeName || currentLocation;
    if (Number.isFinite(stopStartedAtMs) && stopStartedAtMs > 0 && (stopDurationMs === 0 || safeNowMs >= stopStartedAtMs + stopDurationMs)) {
      return {
        location: nearestNodeName,
        status: 'idle',
        shouldPersist: status !== 'idle' || nearestNodeName !== currentLocation,
        nextTravelState: createIdleTravelState(unitDurationSeconds)
      };
    }
  }

  return {
    location: currentLocation,
    status: status || 'idle',
    shouldPersist: false,
    nextTravelState: null
  };
};

const resolveLockTimeline = (lock = {}) => {
  const executeAtMs = new Date(lock?.executeAt || 0).getTime();
  if (!Number.isFinite(executeAtMs) || executeAtMs <= 0) {
    return {
      executeAtMs: 0,
      entryCloseAtMs: 0,
      endAtMs: 0
    };
  }
  const entryCloseAtMsRaw = new Date(lock?.entryCloseAt || 0).getTime();
  const endAtMsRaw = new Date(lock?.endAt || 0).getTime();
  const entryCloseAtMs = Number.isFinite(entryCloseAtMsRaw) && entryCloseAtMsRaw > 0
    ? entryCloseAtMsRaw
    : (executeAtMs - 60 * 1000);
  const endAtMs = Number.isFinite(endAtMsRaw) && endAtMsRaw > 0
    ? endAtMsRaw
    : (executeAtMs + 60 * 1000);
  return {
    executeAtMs,
    entryCloseAtMs,
    endAtMs
  };
};

const getActiveManualParticipantIdSet = (lock = {}, atMs = Date.now()) => {
  const targetMs = Number.isFinite(Number(atMs)) ? Number(atMs) : Date.now();
  const participantSet = new Set();
  const rows = Array.isArray(lock?.participants) ? lock.participants : [];
  for (const item of rows) {
    const userId = getIdString(item?.userId);
    if (!isValidObjectId(userId)) continue;
    const joinedAtMs = new Date(item?.joinedAt || 0).getTime();
    if (Number.isFinite(joinedAtMs) && joinedAtMs > targetMs) continue;
    const exitedAtMs = new Date(item?.exitedAt || 0).getTime();
    if (Number.isFinite(exitedAtMs) && exitedAtMs > 0 && exitedAtMs <= targetMs) continue;
    participantSet.add(userId);
  }
  return participantSet;
};

let isProcessing = false;

class KnowledgeDistributionService {
  static getLockTimeline(lock = {}) {
    return resolveLockTimeline(lock);
  }

  static getActiveManualParticipantIds(lock = {}, atMs = Date.now()) {
    return Array.from(getActiveManualParticipantIdSet(lock, atMs));
  }

  static async loadActiveManualParticipantIds({ nodeId, lock = {}, atMs = Date.now() } = {}) {
    const targetMs = Number.isFinite(Number(atMs)) ? Number(atMs) : Date.now();
    const targetDate = new Date(targetMs);
    const executeAt = lock?.executeAt ? new Date(lock.executeAt) : null;
    const safeNodeId = getIdString(nodeId);

    if (
      executeAt instanceof Date &&
      Number.isFinite(executeAt.getTime()) &&
      executeAt.getTime() > 0 &&
      isValidObjectId(safeNodeId)
    ) {
      const rows = await DistributionParticipant.find({
        nodeId: new mongoose.Types.ObjectId(safeNodeId),
        executeAt,
        joinedAt: { $lte: targetDate },
        $or: [
          { exitedAt: null },
          { exitedAt: { $gt: targetDate } }
        ]
      }).select('userId').lean();

      if (rows.length > 0) {
        return Array.from(new Set(
          rows
            .map((item) => getIdString(item?.userId))
            .filter((id) => isValidObjectId(id))
        ));
      }
    }

    return this.getActiveManualParticipantIds(lock, targetMs);
  }

  static async processTick() {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const now = new Date();
      const nearFuture = new Date(now.getTime() + 60 * 1000);
      const nodes = await Node.find({
        status: 'approved',
        knowledgeDistributionLocked: { $ne: null },
        $or: [
          { 'knowledgeDistributionLocked.executeAt': { $lte: nearFuture } },
          { 'knowledgeDistributionLocked.endAt': { $lte: now } }
        ]
      }).select(
        '_id name status contentScore knowledgePoint knowledgeDistributionLocked knowledgeDistributionCarryover domainMaster'
      );

      for (const node of nodes) {
        try {
          await this.processNode(node, now);
        } catch (error) {
          console.error(`知识点分发处理失败 node=${node?._id || 'unknown'}:`, error);
        }
      }
    } finally {
      isProcessing = false;
    }
  }

  static async processNode(node, now) {
    const lock = node.knowledgeDistributionLocked || null;
    if (!lock?.executeAt) return;
    const timeline = resolveLockTimeline(lock);
    const nowMs = now.getTime();

    if (timeline.executeAtMs > 0 && timeline.executeAtMs <= nowMs && !lock.executedAt) {
      await this.executeLockedDistribution(node._id, now);
      return;
    }

    if (timeline.endAtMs > 0 && timeline.endAtMs <= nowMs) {
      await Node.findByIdAndUpdate(node._id, {
        $set: { knowledgeDistributionLocked: null }
      });
    }
  }

  static getCommonRuleSets(ruleSnapshot = {}, lock = {}) {
    const adminPercentMap = new Map();
    const customUserPercentMap = new Map();
    const specificAlliancePercentMap = new Map();

    for (const item of (Array.isArray(ruleSnapshot.adminPercents) ? ruleSnapshot.adminPercents : [])) {
      const userId = getIdString(item?.userId);
      if (!isValidObjectId(userId)) continue;
      adminPercentMap.set(userId, clampPercent(item?.percent, 0));
    }
    for (const item of (Array.isArray(ruleSnapshot.customUserPercents) ? ruleSnapshot.customUserPercents : [])) {
      const userId = getIdString(item?.userId);
      if (!isValidObjectId(userId)) continue;
      customUserPercentMap.set(userId, clampPercent(item?.percent, 0));
    }
    for (const item of (Array.isArray(ruleSnapshot.specificAlliancePercents) ? ruleSnapshot.specificAlliancePercents : [])) {
      const allianceId = getIdString(item?.allianceId);
      if (!isValidObjectId(allianceId)) continue;
      specificAlliancePercentMap.set(allianceId, (specificAlliancePercentMap.get(allianceId) || 0) + clampPercent(item?.percent, 0));
    }

    return {
      masterPercent: clampPercent(ruleSnapshot.masterPercent, 10),
      adminPercentMap,
      customUserPercentMap,
      nonHostileAlliancePercent: clampPercent(ruleSnapshot.nonHostileAlliancePercent, 0),
      specificAlliancePercentMap,
      noAlliancePercent: clampPercent(ruleSnapshot.noAlliancePercent, 0),
      blacklistUserIds: new Set((Array.isArray(ruleSnapshot.blacklistUserIds) ? ruleSnapshot.blacklistUserIds : []).map((item) => getIdString(item)).filter((id) => isValidObjectId(id))),
      blacklistAllianceIds: new Set((Array.isArray(ruleSnapshot.blacklistAllianceIds) ? ruleSnapshot.blacklistAllianceIds : []).map((item) => getIdString(item)).filter((id) => isValidObjectId(id))),
      enemyAllianceIds: new Set((Array.isArray(lock.enemyAllianceIds) ? lock.enemyAllianceIds : []).map((item) => getIdString(item)).filter((id) => isValidObjectId(id)))
    };
  }

  static isUserBlocked({ userId, allianceId, masterAllianceId, blacklistUserIds, blacklistAllianceIds, enemyAllianceIds }) {
    if (!userId || !isValidObjectId(userId)) return true;
    if (blacklistUserIds.has(userId)) return true;
    if (allianceId && blacklistAllianceIds.has(allianceId)) return true;
    if (masterAllianceId && allianceId && enemyAllianceIds.has(allianceId)) return true;
    return false;
  }

  static resolvePreferredCustomPoolForUser({ userId, allianceId, rules, masterAllianceId }) {
    if (!userId || !isValidObjectId(userId) || !rules) return null;

    const candidates = [];
    const customUserPercent = clampPercent(rules.customUserPercentMap?.get(userId), 0);
    if (customUserPercent > 0) {
      candidates.push({
        key: 'custom_user',
        percent: customUserPercent,
        priority: 4
      });
    }

    const safeAllianceId = getIdString(allianceId);
    if (safeAllianceId) {
      const specificAlliancePercent = clampPercent(rules.specificAlliancePercentMap?.get(safeAllianceId), 0);
      if (specificAlliancePercent > 0) {
        candidates.push({
          key: 'specific_alliance',
          percent: specificAlliancePercent,
          allianceId: safeAllianceId,
          priority: 3
        });
      }

      const nonHostileAlliancePercent = clampPercent(rules.nonHostileAlliancePercent, 0);
      if (
        masterAllianceId &&
        !rules.enemyAllianceIds?.has(safeAllianceId) &&
        nonHostileAlliancePercent > 0
      ) {
        candidates.push({
          key: 'non_hostile_alliance',
          percent: nonHostileAlliancePercent,
          priority: 2
        });
      }
    } else {
      const noAlliancePercent = clampPercent(rules.noAlliancePercent, 0);
      if (noAlliancePercent > 0) {
        candidates.push({
          key: 'no_alliance',
          percent: noAlliancePercent,
          priority: 1
        });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const percentDiff = (Number(b.percent) || 0) - (Number(a.percent) || 0);
      if (percentDiff !== 0) return percentDiff;
      return (Number(b.priority) || 0) - (Number(a.priority) || 0);
    });
    return candidates[0];
  }

  static calculateProjectedMaxPercentForUser({ user, node, lock }) {
    const userId = getIdString(user?._id);
    const allianceId = getIdString(user?.allianceId);
    const masterId = getIdString(node?.domainMaster);
    const masterAllianceId = getIdString(lock?.masterAllianceId);
    const rules = this.getCommonRuleSets(lock?.ruleSnapshot || {}, lock);

    if (this.isUserBlocked({
      userId,
      allianceId,
      masterAllianceId,
      blacklistUserIds: rules.blacklistUserIds,
      blacklistAllianceIds: rules.blacklistAllianceIds,
      enemyAllianceIds: rules.enemyAllianceIds
    })) {
      return 0;
    }

    if (userId === masterId) {
      return round2(Math.max(0, clampPercent(rules.masterPercent, 0)));
    }
    if (rules.adminPercentMap.has(userId)) {
      return round2(Math.max(0, clampPercent(rules.adminPercentMap.get(userId), 0)));
    }

    const preferredPool = this.resolvePreferredCustomPoolForUser({
      userId,
      allianceId,
      rules,
      masterAllianceId
    });
    return round2(Math.max(0, Number(preferredPool?.percent) || 0));
  }

  static async publishAnnouncementNotifications({ node, masterUser, lock }) {
    const users = await User.find({ role: 'common' }).select('_id allianceId');
    if (!users.length) return;

    const projectedTotalCents = toCents(
      Number.isFinite(Number(lock?.projectedDistributableTotal))
        ? lock.projectedDistributableTotal
        : (lock?.projectedTotal || 0)
    );
    const executeAtText = new Date(lock.executeAt).toLocaleString('zh-CN', { hour12: false });
    const timeline = resolveLockTimeline(lock);
    const entryCloseText = timeline.entryCloseAtMs > 0
      ? new Date(timeline.entryCloseAtMs).toLocaleString('zh-CN', { hour12: false })
      : '';
    const nowDate = new Date();
    const masterId = getIdString(node?.domainMaster);
    const rules = this.getCommonRuleSets(lock?.ruleSnapshot || {}, lock);

    const ops = [];
    const collectionNotificationDocs = [];
    for (const user of users) {
      const userId = getIdString(user?._id);
      const isFixedRecipient = userId === masterId || rules.adminPercentMap.has(userId);
      const maxPercent = this.calculateProjectedMaxPercentForUser({ user, node, lock });
      const estimatedMaxCents = Math.floor(projectedTotalCents * (maxPercent / 100));
      const estimatedMax = fromCents(estimatedMaxCents);
      const message = isFixedRecipient
        ? `知识域「${node.name}」将在 ${executeAtText} 分发知识点。按当前规则你预计最多可获得 ${estimatedMax.toFixed(2)} 点。`
        : `知识域「${node.name}」将在 ${executeAtText} 分发知识点。按当前规则你预计最多可获得 ${estimatedMax.toFixed(2)} 点。请前往知识域「${node.name}」参与分发，点击前往${entryCloseText ? `（入场截止 ${entryCloseText}）` : ''}。`;
      const notificationId = new mongoose.Types.ObjectId();

      ops.push({
        updateOne: {
          filter: { _id: user._id },
          update: {
            $push: {
              notifications: {
                $each: [{
                  _id: notificationId,
                  type: 'domain_distribution_announcement',
                  title: `知识点分发预告：${node.name}`,
                  message,
                  read: false,
                  status: 'info',
                  nodeId: node._id,
                  nodeName: node.name,
                  requiresArrival: !isFixedRecipient,
                  allianceId: lock.masterAllianceId || null,
                  allianceName: lock.masterAllianceName || '',
                  inviterId: masterUser._id,
                  inviterUsername: masterUser.username,
                  createdAt: nowDate
                }],
                $position: 0
              }
            }
          }
        }
      });

      collectionNotificationDocs.push({
        _id: notificationId,
        userId: user._id,
        type: 'domain_distribution_announcement',
        title: `知识点分发预告：${node.name}`,
        message,
        read: false,
        status: 'info',
        nodeId: node._id,
        nodeName: node.name,
        requiresArrival: !isFixedRecipient,
        allianceId: lock.masterAllianceId || null,
        allianceName: lock.masterAllianceName || '',
        inviterId: masterUser._id,
        inviterUsername: masterUser.username,
        createdAt: nowDate
      });
    }

    if (ops.length > 0) {
      await User.bulkWrite(ops, { ordered: false });
      await writeNotificationsToCollection(collectionNotificationDocs);
    }
  }

  static async executeLockedDistribution(nodeId, now = new Date()) {
    const node = await Node.findById(nodeId);
    if (!node || !node.knowledgeDistributionLocked) return;
    Node.applyKnowledgePointProjection(node, now);

    const lock = node.knowledgeDistributionLocked;
    const timeline = resolveLockTimeline(lock);
    if (!lock.executeAt || timeline.executeAtMs > now.getTime()) return;
    if (lock.executedAt) return;

    const masterId = getIdString(node.domainMaster);
    const masterAllianceId = getIdString(lock.masterAllianceId);
    const rules = this.getCommonRuleSets(lock.ruleSnapshot || {}, lock);
    const activeManualParticipantSet = new Set(await this.loadActiveManualParticipantIds({
      nodeId: node?._id,
      lock,
      atMs: timeline.executeAtMs || now.getTime()
    }));
    const totalPoolCents = toCents((Number(node.knowledgePoint?.value) || 0) + (Number(node.knowledgeDistributionCarryover) || 0));
    const distributionPercent = getDistributionScopePercent(lock.ruleSnapshot || lock);
    const distributionPoolCents = Math.floor(totalPoolCents * (distributionPercent / 100));

    const finalizeDistribution = async ({ carryoverCents, executedAt, resultUserRewards = [] }) => {
      node.knowledgePoint.value = 0;
      node.knowledgePoint.lastUpdated = executedAt;
      node.knowledgeDistributionCarryover = fromCents(carryoverCents);
      node.knowledgeDistributionLastExecutedAt = executedAt;
      if (node.knowledgeDistributionLocked) {
        node.knowledgeDistributionLocked.executedAt = executedAt;
        node.knowledgeDistributionLocked.resultUserRewards = Array.isArray(resultUserRewards)
          ? resultUserRewards
          : [];
        if (!node.knowledgeDistributionLocked.entryCloseAt) {
          node.knowledgeDistributionLocked.entryCloseAt = new Date(timeline.entryCloseAtMs || (timeline.executeAtMs - 60 * 1000));
        }
        if (!node.knowledgeDistributionLocked.endAt) {
          node.knowledgeDistributionLocked.endAt = new Date(timeline.endAtMs || (timeline.executeAtMs + 60 * 1000));
        }
      }
      if (timeline.endAtMs > 0 && executedAt.getTime() >= timeline.endAtMs) {
        node.knowledgeDistributionLocked = null;
      }
      await node.save();
    };

    if (!isValidObjectId(masterId)) {
      await finalizeDistribution({
        carryoverCents: totalPoolCents,
        executedAt: now,
        resultUserRewards: []
      });
      return;
    }

    const masterUser = await User.findById(masterId).select('_id username role allianceId');
    if (!masterUser || masterUser.role !== 'common') {
      await finalizeDistribution({
        carryoverCents: totalPoolCents,
        executedAt: now,
        resultUserRewards: []
      });
      return;
    }

    const fixedUserIds = Array.from(new Set([
      masterId,
      ...Array.from(rules.adminPercentMap.keys()),
      ...Array.from(rules.customUserPercentMap.keys()),
      ...Array.from(activeManualParticipantSet.values())
    ].filter((id) => isValidObjectId(id))));
    const fixedObjectIds = fixedUserIds.map((id) => new mongoose.Types.ObjectId(id));

    const userOrConditions = [
      { location: node.name },
      { 'travelState.status': { $in: ['moving', 'stopping'] } },
      { 'travelState.isTraveling': true }
    ];
    if (fixedObjectIds.length > 0) {
      userOrConditions.push({ _id: { $in: fixedObjectIds } });
    }
    const userQuery = {
      role: 'common',
      $or: userOrConditions
    };
    const candidateUsers = await User.find(userQuery).select('_id username allianceId location travelState knowledgeBalance');
    const userMap = new Map(candidateUsers.map((item) => [getIdString(item._id), item]));
    const settleOps = [];
    for (const user of candidateUsers) {
      const userId = getIdString(user._id);
      if (!isValidObjectId(userId)) continue;
      const effectivePresence = resolveEffectiveUserPresence(user, now);
      if (!effectivePresence.shouldPersist || !effectivePresence.nextTravelState) continue;
      settleOps.push({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(userId) },
          update: {
            $set: {
              location: effectivePresence.location || '',
              travelState: effectivePresence.nextTravelState
            }
          }
        }
      });
    }
    if (settleOps.length > 0) {
      await User.bulkWrite(settleOps, { ordered: false });
    }

    const isEligible = (user, requireArrival = false) => {
      if (!user) return false;
      const userId = getIdString(user._id);
      const allianceId = getIdString(user.allianceId);
      if (this.isUserBlocked({
        userId,
        allianceId,
        masterAllianceId,
        blacklistUserIds: rules.blacklistUserIds,
        blacklistAllianceIds: rules.blacklistAllianceIds,
        enemyAllianceIds: rules.enemyAllianceIds
      })) {
        return false;
      }
      if (requireArrival) {
        const isMasterOrAdmin = userId === masterId || rules.adminPercentMap.has(userId);
        if (!isMasterOrAdmin) {
          if (!activeManualParticipantSet.has(userId)) {
            return false;
          }
        }
      }
      return true;
    };

    const userRewardCents = new Map();
    const addUserReward = (userId, cents) => {
      const parsed = Math.max(0, parseInt(cents, 10) || 0);
      if (!parsed) return;
      userRewardCents.set(userId, (userRewardCents.get(userId) || 0) + parsed);
    };
    const percentPoolCents = (percent) => Math.floor(distributionPoolCents * (clampPercent(percent, 0) / 100));
    const distributeGroupPool = (poolCents, participantIds = []) => {
      if (!poolCents || !participantIds.length) return 0;
      const share = Math.floor(poolCents / participantIds.length);
      let remainder = poolCents - share * participantIds.length;
      let allocated = 0;
      for (const userId of participantIds) {
        const cents = share + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        if (cents <= 0) continue;
        addUserReward(userId, cents);
        allocated += cents;
      }
      return allocated;
    };

    // 固定规则 1：域主
    const masterPoolCents = percentPoolCents(rules.masterPercent);
    if (masterPoolCents > 0 && isEligible(userMap.get(masterId), false)) {
      addUserReward(masterId, masterPoolCents);
    }

    // 固定规则 2：域相按各自比例
    for (const [adminUserId, percent] of rules.adminPercentMap.entries()) {
      const poolCents = percentPoolCents(percent);
      if (poolCents <= 0) continue;
      if (!isEligible(userMap.get(adminUserId), false)) continue;
      addUserReward(adminUserId, poolCents);
    }

    // 固定规则 3：贡献给域主所在熵盟
    let allianceContributionCents = 0;
    const allianceContributionPercent = clampPercent(lock.allianceContributionPercent, 0);
    if (allianceContributionPercent > 0 && isValidObjectId(masterAllianceId)) {
      allianceContributionCents = percentPoolCents(allianceContributionPercent);
    }

    const assignedCustomPoolByUserId = new Map();
    for (const user of candidateUsers) {
      const userId = getIdString(user?._id);
      if (!isValidObjectId(userId)) continue;
      if (userId === masterId || rules.adminPercentMap.has(userId)) continue;
      if (!isEligible(user, true)) continue;
      const preferredPool = this.resolvePreferredCustomPoolForUser({
        userId,
        allianceId: getIdString(user?.allianceId),
        rules,
        masterAllianceId
      });
      if (!preferredPool || clampPercent(preferredPool.percent, 0) <= 0) continue;
      assignedCustomPoolByUserId.set(userId, preferredPool);
    }

    // 自定义规则 1：指定用户（要求到达）
    for (const [targetUserId, percent] of rules.customUserPercentMap.entries()) {
      const poolCents = percentPoolCents(percent);
      if (poolCents <= 0) continue;
      const targetUser = userMap.get(targetUserId);
      if (!isEligible(targetUser, true)) continue;
      const assignedPool = assignedCustomPoolByUserId.get(targetUserId);
      if (assignedPool?.key !== 'custom_user') continue;
      addUserReward(targetUserId, poolCents);
    }

    // 自定义规则 2：非敌对熵盟成员（要求到达）
    if (masterAllianceId && rules.nonHostileAlliancePercent > 0) {
      const poolCents = percentPoolCents(rules.nonHostileAlliancePercent);
      const participants = [];
      for (const user of candidateUsers) {
        const userId = getIdString(user._id);
        const allianceId = getIdString(user.allianceId);
        if (!allianceId) continue;
        if (!isEligible(user, true)) continue;
        if (rules.enemyAllianceIds.has(allianceId)) continue;
        const assignedPool = assignedCustomPoolByUserId.get(userId);
        if (assignedPool?.key !== 'non_hostile_alliance') continue;
        participants.push(userId);
      }
      distributeGroupPool(poolCents, participants);
    }

    // 自定义规则 3：指定熵盟成员（要求到达）
    for (const [targetAllianceId, percent] of rules.specificAlliancePercentMap.entries()) {
      const poolCents = percentPoolCents(percent);
      if (poolCents <= 0) continue;
      const participants = [];
      for (const user of candidateUsers) {
        const userId = getIdString(user._id);
        const allianceId = getIdString(user.allianceId);
        if (!allianceId || allianceId !== targetAllianceId) continue;
        if (!isEligible(user, true)) continue;
        const assignedPool = assignedCustomPoolByUserId.get(userId);
        if (assignedPool?.key !== 'specific_alliance') continue;
        participants.push(userId);
      }
      distributeGroupPool(poolCents, participants);
    }

    // 自定义规则 4：无熵盟用户（要求到达）
    if (rules.noAlliancePercent > 0) {
      const poolCents = percentPoolCents(rules.noAlliancePercent);
      const participants = [];
      for (const user of candidateUsers) {
        const userId = getIdString(user._id);
        const allianceId = getIdString(user.allianceId);
        if (allianceId) continue;
        if (!isEligible(user, true)) continue;
        const assignedPool = assignedCustomPoolByUserId.get(userId);
        if (assignedPool?.key !== 'no_alliance') continue;
        participants.push(userId);
      }
      distributeGroupPool(poolCents, participants);
    }

    const distributedUserCents = Array.from(userRewardCents.values()).reduce((sum, item) => sum + item, 0);
    const effectiveAllianceContributionCents = Math.min(
      Math.max(0, allianceContributionCents),
      Math.max(0, distributionPoolCents - distributedUserCents)
    );

    if (effectiveAllianceContributionCents > 0 && isValidObjectId(masterAllianceId)) {
      await EntropyAlliance.findByIdAndUpdate(masterAllianceId, {
        $inc: { knowledgeReserve: fromCents(effectiveAllianceContributionCents) }
      });
    }

    const notificationTime = new Date();
    const userOps = [];
    const collectionNotificationDocs = [];
    for (const [userId, cents] of userRewardCents.entries()) {
      if (!isValidObjectId(userId) || cents <= 0) continue;
      const amount = fromCents(cents);
      const notificationId = new mongoose.Types.ObjectId();
      userOps.push({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(userId) },
          update: {
            $inc: { knowledgeBalance: amount },
            $push: {
              notifications: {
                $each: [{
                  _id: notificationId,
                  type: 'domain_distribution_result',
                  title: `知识点到账：${node.name}`,
                  message: `你从知识域「${node.name}」获得了 ${amount.toFixed(2)} 知识点，已存入个人账户。`,
                  read: false,
                  status: 'info',
                  nodeId: node._id,
                  nodeName: node.name,
                  allianceId: masterAllianceId || null,
                  allianceName: lock.masterAllianceName || '',
                  inviterId: masterUser._id,
                  inviterUsername: masterUser.username,
                  createdAt: notificationTime
                }],
                $position: 0
              }
            }
          }
        }
      });

      collectionNotificationDocs.push({
        _id: notificationId,
        userId: new mongoose.Types.ObjectId(userId),
        type: 'domain_distribution_result',
        title: `知识点到账：${node.name}`,
        message: `你从知识域「${node.name}」获得了 ${amount.toFixed(2)} 知识点，已存入个人账户。`,
        read: false,
        status: 'info',
        nodeId: node._id,
        nodeName: node.name,
        allianceId: masterAllianceId || null,
        allianceName: lock.masterAllianceName || '',
        inviterId: masterUser._id,
        inviterUsername: masterUser.username,
        createdAt: notificationTime
      });
    }
    if (userOps.length > 0) {
      await User.bulkWrite(userOps, { ordered: false });
      await writeNotificationsToCollection(collectionNotificationDocs);
    }

    const resultUserRewards = Array.from(userRewardCents.entries())
      .filter(([userId, cents]) => isValidObjectId(userId) && cents > 0)
      .map(([userId, cents]) => ({
        userId: new mongoose.Types.ObjectId(userId),
        amount: fromCents(cents)
      }));

    const distributedTotalCents = distributedUserCents + effectiveAllianceContributionCents;
    const carryoverCents = Math.max(0, totalPoolCents - distributedTotalCents);
    await finalizeDistribution({
      carryoverCents,
      executedAt: now,
      resultUserRewards
    });
  }
}

module.exports = KnowledgeDistributionService;
