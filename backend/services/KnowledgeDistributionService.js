const mongoose = require('mongoose');
const Node = require('../models/Node');
const User = require('../models/User');
const EntropyAlliance = require('../models/EntropyAlliance');

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

const isUserArrivedAtNode = (user, nodeName) => {
  if (!user || !nodeName) return false;
  if ((user.location || '') !== nodeName) return false;
  return getTravelStatus(user.travelState) === 'idle';
};

let isProcessing = false;

class KnowledgeDistributionService {
  static async processTick() {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const now = new Date();
      const nodes = await Node.find({
        status: 'approved',
        knowledgeDistributionLocked: { $ne: null }
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

    if (new Date(lock.executeAt).getTime() <= now.getTime()) {
      await this.executeLockedDistribution(node._id, now);
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

    let percent = 0;
    if (userId === masterId) percent += rules.masterPercent;
    if (rules.adminPercentMap.has(userId)) percent += rules.adminPercentMap.get(userId);
    if (rules.customUserPercentMap.has(userId)) percent += rules.customUserPercentMap.get(userId);

    if (allianceId) {
      if (masterAllianceId && !rules.enemyAllianceIds.has(allianceId)) {
        percent += rules.nonHostileAlliancePercent;
      }
      if (rules.specificAlliancePercentMap.has(allianceId)) {
        percent += rules.specificAlliancePercentMap.get(allianceId);
      }
    } else {
      percent += rules.noAlliancePercent;
    }

    return round2(Math.max(0, percent));
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
    const nowDate = new Date();
    const masterId = getIdString(node?.domainMaster);
    const rules = this.getCommonRuleSets(lock?.ruleSnapshot || {}, lock);

    const ops = [];
    for (const user of users) {
      const userId = getIdString(user?._id);
      const isFixedRecipient = userId === masterId || rules.adminPercentMap.has(userId);
      const maxPercent = this.calculateProjectedMaxPercentForUser({ user, node, lock });
      const estimatedMaxCents = Math.floor(projectedTotalCents * (maxPercent / 100));
      const estimatedMax = fromCents(estimatedMaxCents);
      const message = isFixedRecipient
        ? `知识域「${node.name}」将在 ${executeAtText} 分发知识点。按当前规则你预计最多可获得 ${estimatedMax.toFixed(2)} 点。`
        : `知识域「${node.name}」将在 ${executeAtText} 分发知识点。按当前规则你预计最多可获得 ${estimatedMax.toFixed(2)} 点。请前往知识域「${node.name}」参与，点击前往（与知识域旁“前往”按钮效果一致）。`;

      ops.push({
        updateOne: {
          filter: { _id: user._id },
          update: {
            $push: {
              notifications: {
                $each: [{
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
    }

    if (ops.length > 0) {
      await User.bulkWrite(ops, { ordered: false });
    }
  }

  static async executeLockedDistribution(nodeId, now = new Date()) {
    const node = await Node.updateKnowledgePoint(nodeId);
    if (!node || !node.knowledgeDistributionLocked) return;

    const lock = node.knowledgeDistributionLocked;
    if (!lock.executeAt || new Date(lock.executeAt).getTime() > now.getTime()) return;

    const masterId = getIdString(node.domainMaster);
    const masterAllianceId = getIdString(lock.masterAllianceId);
    const rules = this.getCommonRuleSets(lock.ruleSnapshot || {}, lock);
    const totalPoolCents = toCents((Number(node.knowledgePoint?.value) || 0) + (Number(node.knowledgeDistributionCarryover) || 0));
    const distributionPercent = getDistributionScopePercent(lock.ruleSnapshot || lock);
    const distributionPoolCents = Math.floor(totalPoolCents * (distributionPercent / 100));

    const finalizeWithoutDistribution = async () => {
      node.knowledgePoint.value = 0;
      node.knowledgePoint.lastUpdated = now;
      node.knowledgeDistributionCarryover = fromCents(totalPoolCents);
      node.knowledgeDistributionLocked = null;
      node.knowledgeDistributionLastExecutedAt = now;
      await node.save();
    };

    if (!isValidObjectId(masterId)) {
      await finalizeWithoutDistribution();
      return;
    }

    const masterUser = await User.findById(masterId).select('_id username role allianceId');
    if (!masterUser || masterUser.role !== 'common') {
      await finalizeWithoutDistribution();
      return;
    }

    const fixedUserIds = Array.from(new Set([
      masterId,
      ...Array.from(rules.adminPercentMap.keys()),
      ...Array.from(rules.customUserPercentMap.keys())
    ].filter((id) => isValidObjectId(id))));
    const fixedObjectIds = fixedUserIds.map((id) => new mongoose.Types.ObjectId(id));

    const userQuery = {
      role: 'common',
      $or: [
        { location: node.name },
        { _id: { $in: fixedObjectIds } }
      ]
    };
    const candidateUsers = await User.find(userQuery).select('_id username allianceId location travelState knowledgeBalance');
    const userMap = new Map(candidateUsers.map((item) => [getIdString(item._id), item]));

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
      if (requireArrival && !isUserArrivedAtNode(user, node.name)) {
        return false;
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

    // 自定义规则 1：指定用户（要求到达）
    for (const [targetUserId, percent] of rules.customUserPercentMap.entries()) {
      const poolCents = percentPoolCents(percent);
      if (poolCents <= 0) continue;
      const targetUser = userMap.get(targetUserId);
      if (!isEligible(targetUser, true)) continue;
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
    for (const [userId, cents] of userRewardCents.entries()) {
      if (!isValidObjectId(userId) || cents <= 0) continue;
      const amount = fromCents(cents);
      userOps.push({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(userId) },
          update: {
            $inc: { knowledgeBalance: amount },
            $push: {
              notifications: {
                $each: [{
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
    }
    if (userOps.length > 0) {
      await User.bulkWrite(userOps, { ordered: false });
    }

    const distributedTotalCents = distributedUserCents + effectiveAllianceContributionCents;
    const carryoverCents = Math.max(0, totalPoolCents - distributedTotalCents);
    node.knowledgePoint.value = 0;
    node.knowledgePoint.lastUpdated = now;
    node.knowledgeDistributionCarryover = fromCents(carryoverCents);
    node.knowledgeDistributionLocked = null;
    node.knowledgeDistributionLastExecutedAt = now;
    await node.save();
  }
}

module.exports = KnowledgeDistributionService;
