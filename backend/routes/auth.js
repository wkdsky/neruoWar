const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Node = require('../models/Node');
const EntropyAlliance = require('../models/EntropyAlliance');
const GameSetting = require('../models/GameSetting');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const getOrCreateSettings = async () => GameSetting.findOneAndUpdate(
  { key: 'global' },
  { $setOnInsert: { travelUnitSeconds: 60, distributionAnnouncementLeadHours: 24 } },
  { new: true, upsert: true, setDefaultsOnInsert: true }
);

const TRAVEL_STATUS = {
  IDLE: 'idle',
  MOVING: 'moving',
  STOPPING: 'stopping'
};
const RESIGN_REQUEST_EXPIRE_MS = 3 * 24 * 60 * 60 * 1000;
const DISTRIBUTION_ENTRY_LOCK_MS = 60 * 1000;

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const resolveDistributionLockTimeline = (lock = {}) => {
  const executeAtMs = new Date(lock?.executeAt || 0).getTime();
  if (!Number.isFinite(executeAtMs) || executeAtMs <= 0) {
    return {
      executeAtMs: 0,
      endAtMs: 0
    };
  }
  const endAtMsRaw = new Date(lock?.endAt || 0).getTime();
  const endAtMs = Number.isFinite(endAtMsRaw) && endAtMsRaw > 0
    ? endAtMsRaw
    : (executeAtMs + DISTRIBUTION_ENTRY_LOCK_MS);
  return {
    executeAtMs,
    endAtMs
  };
};

const formatDurationCN = (secondsRaw = 0) => {
  const total = Math.max(0, Math.round(Number(secondsRaw) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return `${seconds}秒`;
  return `${minutes}分${seconds}秒`;
};

const appendArrivalNotification = (user, targetNodeName, spentSeconds = 0) => {
  if (!user || !targetNodeName) return;
  const message = `您已到达了${targetNodeName}，花费${formatDurationCN(spentSeconds)}。`;
  user.notifications = Array.isArray(user.notifications) ? user.notifications : [];
  user.notifications.unshift({
    type: 'info',
    title: `已到达：${targetNodeName}`,
    message,
    read: false,
    status: 'info',
    nodeName: targetNodeName,
    createdAt: new Date()
  });
};

const findActiveManualDistributionLockForUser = async (userId, now = new Date()) => {
  if (!isValidObjectId(userId)) return null;
  const currentTimeMs = now.getTime();
  const nodes = await Node.find({
    status: 'approved',
    'knowledgeDistributionLocked.participants': {
      $elemMatch: {
        userId: new mongoose.Types.ObjectId(userId),
        exitedAt: null
      }
    }
  }).select('name knowledgeDistributionLocked');
  for (const node of nodes) {
    const lock = node?.knowledgeDistributionLocked;
    if (!lock) continue;
    const timeline = resolveDistributionLockTimeline(lock);
    if (!timeline.endAtMs || currentTimeMs >= timeline.endAtMs) continue;
    return {
      node,
      lock,
      timeline
    };
  }
  return null;
};

const syncMasterDomainsAlliance = async ({ userId, allianceId }) => {
  const domainMasterId = getIdString(userId);
  if (!domainMasterId) return;
  await Node.updateMany(
    { domainMaster: domainMasterId },
    { $set: { allianceId: allianceId || null } }
  );
};

const isResignRequestExpired = (notification, now = Date.now()) => {
  const createdAtMs = new Date(notification?.createdAt || 0).getTime();
  if (!createdAtMs) return false;
  return (now - createdAtMs) >= RESIGN_REQUEST_EXPIRE_MS;
};

const handleResignRequestDecision = async ({
  domainMasterUser,
  notification,
  action = 'accept',
  isAuto = false
}) => {
  const nowDate = new Date();
  const domainMasterId = getIdString(domainMasterUser?._id);
  const nodeId = getIdString(notification?.nodeId);
  const requesterId = getIdString(notification?.inviteeId);

  if (!domainMasterId || !nodeId || !requesterId) {
    notification.status = 'accepted';
    notification.read = true;
    notification.respondedAt = nowDate;
    return {
      decision: 'accepted',
      message: isAuto ? '申请超时，已自动同意卸任' : '已同意卸任'
    };
  }

  const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
  const requester = await User.findById(requesterId);

  const shouldAccept = isAuto ? true : action === 'accept';
  let decision = shouldAccept ? 'accepted' : 'rejected';
  let decisionMessage = shouldAccept ? '已同意该域相卸任申请' : '已拒绝该域相卸任申请';

  if (shouldAccept && node && node.status === 'approved' && getIdString(node.domainMaster) === domainMasterId) {
    const beforeCount = (node.domainAdmins || []).length;
    node.domainAdmins = (node.domainAdmins || []).filter((adminId) => getIdString(adminId) !== requesterId);
    if (node.domainAdmins.length !== beforeCount) {
      await node.save();
      decisionMessage = isAuto ? '申请超时，已自动同意并完成卸任' : '已同意并完成卸任';
    } else {
      decisionMessage = isAuto ? '申请超时自动同意（该用户已非域相）' : '已同意（该用户已非域相）';
    }
  }

  notification.status = decision;
  notification.read = true;
  notification.respondedAt = nowDate;

  if (requester) {
    requester.notifications.unshift({
      type: 'domain_admin_resign_result',
      title: `卸任申请结果：${notification.nodeName || node?.name || '知识域'}`,
      message: decision === 'accepted'
        ? (isAuto ? '你的卸任申请已超时自动同意' : `${domainMasterUser.username} 已同意你的卸任申请`)
        : `${domainMasterUser.username} 已拒绝你的卸任申请`,
      read: false,
      status: decision,
      nodeId: node?._id || notification.nodeId || null,
      nodeName: node?.name || notification.nodeName || '',
      inviterId: domainMasterUser._id,
      inviterUsername: domainMasterUser.username,
      inviteeId: requester._id,
      inviteeUsername: requester.username,
      respondedAt: nowDate
    });
    await requester.save();
  }

  return {
    decision,
    message: decisionMessage
  };
};

const pushDomainMasterApplyResult = ({
  applicant,
  node,
  decision,
  processorUser,
  nowDate
}) => {
  if (!applicant || applicant.role !== 'common') return;

  applicant.notifications.unshift({
    type: 'domain_master_apply_result',
    title: `域主申请结果：${node?.name || '知识域'}`,
    message: decision === 'accepted'
      ? `${processorUser.username} 已同意你成为知识域「${node?.name || ''}」域主`
      : `${processorUser.username} 已拒绝你成为知识域「${node?.name || ''}」域主的申请`,
    read: false,
    status: decision,
    nodeId: node?._id || null,
    nodeName: node?.name || '',
    inviterId: processorUser._id,
    inviterUsername: processorUser.username,
    inviteeId: applicant._id,
    inviteeUsername: applicant.username,
    respondedAt: nowDate
  });
};

const handleDomainMasterApplyDecision = async ({
  processorUser,
  notification,
  action = 'reject'
}) => {
  const nowDate = new Date();
  const applicantId = getIdString(notification?.inviteeId);
  const nodeId = getIdString(notification?.nodeId);

  const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins allianceId knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionLocked');
  if (!node || node.status !== 'approved') {
    notification.status = 'rejected';
    notification.read = true;
    notification.respondedAt = nowDate;
    return {
      decision: 'rejected',
      message: '该知识域不存在或不可操作',
      saveCurrentUser: true
    };
  }

  const applicant = isValidObjectId(applicantId)
    ? await User.findById(applicantId).select('username role allianceId notifications')
    : null;

  if (action !== 'accept') {
    const adminUsers = await User.find({
      role: 'admin',
      notifications: {
        $elemMatch: {
          type: 'domain_master_apply',
          status: 'pending',
          nodeId: node._id
        }
      }
    }).select('_id notifications');

    const saveAdminUsers = [];
    for (const adminUser of adminUsers) {
      let changed = false;
      for (const adminNotification of adminUser.notifications || []) {
        if (
          adminNotification.type !== 'domain_master_apply' ||
          adminNotification.status !== 'pending' ||
          getIdString(adminNotification.nodeId) !== getIdString(node._id) ||
          getIdString(adminNotification.inviteeId) !== applicantId
        ) {
          continue;
        }
        adminNotification.status = 'rejected';
        adminNotification.read = true;
        adminNotification.respondedAt = nowDate;
        changed = true;
      }
      if (changed) {
        saveAdminUsers.push(adminUser.save());
      }
    }

    if (saveAdminUsers.length > 0) {
      await Promise.all(saveAdminUsers);
    } else {
      notification.status = 'rejected';
      notification.read = true;
      notification.respondedAt = nowDate;
    }

    if (applicant) {
      pushDomainMasterApplyResult({
        applicant,
        node,
        decision: 'rejected',
        processorUser,
        nowDate
      });
      await applicant.save();
    }
    return {
      decision: 'rejected',
      message: saveAdminUsers.length > 0 ? '已拒绝该域主申请，并已同步到其他管理员' : '已拒绝该域主申请',
      saveCurrentUser: saveAdminUsers.length === 0
    };
  }

  if (!applicant || applicant.role !== 'common') {
    notification.status = 'rejected';
    notification.read = true;
    notification.respondedAt = nowDate;
    return {
      decision: 'rejected',
      message: '申请用户不存在或不符合条件',
      saveCurrentUser: true
    };
  }

  const currentMasterId = getIdString(node.domainMaster);
  if (currentMasterId && currentMasterId !== applicantId) {
    notification.status = 'rejected';
    notification.read = true;
    notification.respondedAt = nowDate;
    return {
      decision: 'rejected',
      message: '该知识域已有域主，申请已失效',
      saveCurrentUser: true
    };
  }

  if (!currentMasterId) {
    node.domainMaster = applicant._id;
    node.allianceId = applicant.allianceId || null;
    node.domainAdmins = (node.domainAdmins || []).filter((adminId) => (
      getIdString(adminId) !== applicantId
    ));
    node.knowledgeDistributionRule = {
      ...(node.knowledgeDistributionRule?.toObject?.() || node.knowledgeDistributionRule || {}),
      blacklistUserIds: [],
      blacklistAllianceIds: []
    };
    node.knowledgeDistributionRuleProfiles = (Array.isArray(node.knowledgeDistributionRuleProfiles)
      ? node.knowledgeDistributionRuleProfiles
      : []
    ).map((profile) => ({
      profileId: profile.profileId,
      name: profile.name,
      rule: {
        ...(profile?.rule?.toObject?.() || profile?.rule || {}),
        blacklistUserIds: [],
        blacklistAllianceIds: []
      }
    }));
    node.knowledgeDistributionLocked = null;
    await node.save();
  } else if (currentMasterId === applicantId) {
    node.allianceId = applicant.allianceId || null;
    await node.save();
  }

  const adminUsers = await User.find({
    role: 'admin',
    notifications: {
      $elemMatch: {
        type: 'domain_master_apply',
        status: 'pending',
        nodeId: node._id
      }
    }
  }).select('_id notifications');

  const applicantDecisionMap = new Map();
  const updatedAdminUsers = [];

  for (const adminUser of adminUsers) {
    let changed = false;
    for (const adminNotification of adminUser.notifications || []) {
      if (
        adminNotification.type !== 'domain_master_apply' ||
        adminNotification.status !== 'pending' ||
        getIdString(adminNotification.nodeId) !== getIdString(node._id)
      ) {
        continue;
      }

      const candidateId = getIdString(adminNotification.inviteeId);
      const decision = candidateId === applicantId ? 'accepted' : 'rejected';
      adminNotification.status = decision;
      adminNotification.read = true;
      adminNotification.respondedAt = nowDate;
      applicantDecisionMap.set(candidateId, decision);
      changed = true;
    }
    if (changed) {
      updatedAdminUsers.push(adminUser.save());
    }
  }

  if (updatedAdminUsers.length > 0) {
    await Promise.all(updatedAdminUsers);
  } else {
    notification.status = 'accepted';
    notification.read = true;
    notification.respondedAt = nowDate;
    pushDomainMasterApplyResult({
      applicant,
      node,
      decision: 'accepted',
      processorUser,
      nowDate
    });
    await applicant.save();
    return {
      decision: 'accepted',
      message: '已同意该用户成为域主',
      saveCurrentUser: true
    };
  }

  const decisionApplicantIds = Array.from(applicantDecisionMap.keys()).filter((id) => isValidObjectId(id));
  if (decisionApplicantIds.length > 0) {
    const applicants = await User.find({ _id: { $in: decisionApplicantIds } })
      .select('_id username role notifications');
    const applicantMap = new Map(applicants.map((userItem) => [getIdString(userItem._id), userItem]));

    const saveApplicants = [];
    for (const [candidateId, decision] of applicantDecisionMap.entries()) {
      const candidate = applicantMap.get(candidateId);
      if (!candidate || candidate.role !== 'common') continue;
      pushDomainMasterApplyResult({
        applicant: candidate,
        node,
        decision,
        processorUser,
        nowDate
      });
      saveApplicants.push(candidate.save());
    }
    if (saveApplicants.length > 0) {
      await Promise.all(saveApplicants);
    }
  }

  return {
    decision: 'accepted',
    message: '已同意该用户成为域主，其他申请者已自动拒绝',
    saveCurrentUser: false
  };
};

const handleAllianceJoinApplyDecision = async ({
  leaderUser,
  notification,
  action = 'reject'
}) => {
  const nowDate = new Date();
  const allianceId = getIdString(notification?.allianceId);
  const applicantId = getIdString(notification?.inviteeId || notification?.inviterId);

  const alliance = isValidObjectId(allianceId)
    ? await EntropyAlliance.findById(allianceId).select('_id name founder')
    : null;

  if (!alliance) {
    notification.status = 'rejected';
    notification.read = true;
    notification.respondedAt = nowDate;
    return {
      decision: 'rejected',
      message: '该熵盟不存在或已解散',
      saveLeader: true
    };
  }

  if (getIdString(alliance.founder) !== getIdString(leaderUser?._id)) {
    return {
      error: '只有盟主可以处理该入盟申请'
    };
  }

  const applicant = isValidObjectId(applicantId)
    ? await User.findById(applicantId).select('_id username role allianceId notifications')
    : null;

  let decision = 'rejected';
  let decisionMessage = '已拒绝该入盟申请';

  if (action === 'accept') {
    if (!applicant || applicant.role !== 'common') {
      decision = 'rejected';
      decisionMessage = '申请用户不存在或不符合条件';
    } else {
      const applicantAllianceId = getIdString(applicant.allianceId);
      const targetAllianceId = getIdString(alliance._id);

      if (applicantAllianceId && applicantAllianceId !== targetAllianceId) {
        decision = 'rejected';
        decisionMessage = '该用户已加入其他熵盟，无法批准';
      } else {
        if (!applicantAllianceId) {
          applicant.allianceId = alliance._id;
        }
        decision = 'accepted';
        decisionMessage = applicantAllianceId === targetAllianceId
          ? '该用户已在该熵盟中'
          : '已同意该入盟申请';
        await syncMasterDomainsAlliance({
          userId: applicant._id,
          allianceId: alliance._id
        });
      }
    }
  }

  notification.status = decision;
  notification.read = true;
  notification.respondedAt = nowDate;

  if (applicant) {
    const allianceName = alliance.name || notification.allianceName || '熵盟';
    applicant.notifications.unshift({
      type: 'alliance_join_apply_result',
      title: `入盟申请结果：${allianceName}`,
      message: decision === 'accepted'
        ? `${leaderUser.username} 已同意你加入熵盟「${allianceName}」`
        : `${leaderUser.username} 已拒绝你加入熵盟「${allianceName}」的申请`,
      read: false,
      status: decision,
      allianceId: alliance._id,
      allianceName,
      inviterId: leaderUser._id,
      inviterUsername: leaderUser.username,
      inviteeId: applicant._id,
      inviteeUsername: applicant.username,
      respondedAt: nowDate
    });
    await applicant.save();
  }

  return {
    decision,
    message: decisionMessage,
    saveLeader: true
  };
};

const settleExpiredResignRequestsForUser = async (user) => {
  if (!user || !Array.isArray(user.notifications) || user.notifications.length === 0) return false;

  let changed = false;
  const now = Date.now();
  for (const notification of user.notifications) {
    if (
      notification.type === 'domain_admin_resign_request' &&
      notification.status === 'pending' &&
      isResignRequestExpired(notification, now)
    ) {
      await handleResignRequestDecision({
        domainMasterUser: user,
        notification,
        action: 'accept',
        isAuto: true
      });
      changed = true;
    }
  }

  if (changed) {
    await user.save();
  }
  return changed;
};

const getTravelStatus = (travelState) => {
  if (!travelState) return TRAVEL_STATUS.IDLE;
  if (travelState.status) return travelState.status;
  return travelState.isTraveling ? TRAVEL_STATUS.MOVING : TRAVEL_STATUS.IDLE;
};

const resetTravelState = (user, unitDurationSeconds = 60) => {
  const safeDuration = Math.max(1, parseInt(unitDurationSeconds, 10) || 60);
  user.travelState = {
    status: TRAVEL_STATUS.IDLE,
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

const calculateMovingProgress = (user, now = new Date()) => {
  const travel = user.travelState || {};
  const status = getTravelStatus(travel);
  const path = Array.isArray(travel.path) ? travel.path : [];
  const unitDurationSeconds = Math.max(1, parseInt(travel.unitDurationSeconds, 10) || 60);

  if (status !== TRAVEL_STATUS.MOVING || !travel.startedAt || path.length < 2) {
    return {
      status: TRAVEL_STATUS.IDLE,
      isTraveling: false,
      isStopping: false,
      path: [],
      unitDurationSeconds
    };
  }

  const totalSegments = path.length - 1;
  const segmentDurationMs = unitDurationSeconds * 1000;
  const totalDurationMs = totalSegments * segmentDurationMs;
  const elapsedMs = Math.max(0, now.getTime() - new Date(travel.startedAt).getTime());

  if (elapsedMs >= totalDurationMs) {
    return {
      status: TRAVEL_STATUS.MOVING,
      isTraveling: false,
      isStopping: false,
      arrived: true,
      path,
      unitDurationSeconds,
      totalDistanceUnits: totalSegments,
      completedDistanceUnits: totalSegments,
      remainingDistanceUnits: 0,
      elapsedSeconds: totalDurationMs / 1000,
      remainingSeconds: 0,
      arrivedNode: path[path.length - 1]
    };
  }

  const completedSegments = Math.floor(elapsedMs / segmentDurationMs);
  const progressInCurrentSegment = (elapsedMs - completedSegments * segmentDurationMs) / segmentDurationMs;
  const completedDistanceUnits = elapsedMs / segmentDurationMs;
  const remainingDistanceUnits = Math.max(0, totalSegments - completedDistanceUnits);

  return {
    status: TRAVEL_STATUS.MOVING,
    isTraveling: true,
    isStopping: false,
    path,
    unitDurationSeconds,
    totalDistanceUnits: totalSegments,
    completedDistanceUnits,
    remainingDistanceUnits,
    elapsedSeconds: elapsedMs / 1000,
    remainingSeconds: Math.max(0, (totalDurationMs - elapsedMs) / 1000),
    progressInCurrentSegment,
    currentSegmentIndex: completedSegments,
    lastReachedNode: path[completedSegments],
    nextNode: path[completedSegments + 1],
    targetNode: path[path.length - 1]
  };
};

const calculateStoppingProgress = (user, now = new Date()) => {
  const travel = user.travelState || {};
  const status = getTravelStatus(travel);
  const unitDurationSeconds = Math.max(1, parseInt(travel.unitDurationSeconds, 10) || 60);

  if (
    status !== TRAVEL_STATUS.STOPPING ||
    !travel.stopStartedAt ||
    !travel.stoppingNearestNodeId ||
    !travel.stoppingNearestNodeName
  ) {
    return {
      status: TRAVEL_STATUS.IDLE,
      isTraveling: false,
      isStopping: false,
      unitDurationSeconds
    };
  }

  const stopDurationSeconds = Math.max(0, Number(travel.stopDurationSeconds) || 0);
  const elapsedMs = Math.max(0, now.getTime() - new Date(travel.stopStartedAt).getTime());
  const totalDurationMs = stopDurationSeconds * 1000;

  const stoppingNearestNode = {
    nodeId: travel.stoppingNearestNodeId,
    nodeName: travel.stoppingNearestNodeName
  };
  const stopFromNode = travel.stopFromNode || null;
  const queuedTargetNode = travel.queuedTargetNodeId
    ? {
        nodeId: travel.queuedTargetNodeId,
        nodeName: travel.queuedTargetNodeName || ''
      }
    : null;

  if (totalDurationMs === 0 || elapsedMs >= totalDurationMs) {
    return {
      status: TRAVEL_STATUS.STOPPING,
      isTraveling: false,
      isStopping: true,
      arrived: true,
      unitDurationSeconds,
      stopDurationSeconds,
      elapsedSeconds: stopDurationSeconds,
      remainingSeconds: 0,
      progressInCurrentSegment: 1,
      stoppingNearestNode,
      stopFromNode,
      queuedTargetNode,
      targetNode: stoppingNearestNode,
      nextNode: stoppingNearestNode,
      lastReachedNode: stopFromNode || stoppingNearestNode
    };
  }

  const progress = elapsedMs / totalDurationMs;

  return {
    status: TRAVEL_STATUS.STOPPING,
    isTraveling: true,
    isStopping: true,
    unitDurationSeconds,
    stopDurationSeconds,
    elapsedSeconds: elapsedMs / 1000,
    remainingSeconds: Math.max(0, (totalDurationMs - elapsedMs) / 1000),
    progressInCurrentSegment: progress,
    stoppingNearestNode,
    stopFromNode,
    queuedTargetNode,
    targetNode: stoppingNearestNode,
    nextNode: stoppingNearestNode,
    lastReachedNode: stopFromNode || stoppingNearestNode,
    totalDistanceUnits: 1,
    completedDistanceUnits: progress,
    remainingDistanceUnits: Math.max(0, 1 - progress)
  };
};

const calculateTravelProgress = (user, now = new Date()) => {
  const status = getTravelStatus(user.travelState || {});
  if (status === TRAVEL_STATUS.STOPPING) {
    return calculateStoppingProgress(user, now);
  }
  if (status === TRAVEL_STATUS.MOVING) {
    return calculateMovingProgress(user, now);
  }
  return {
    status: TRAVEL_STATUS.IDLE,
    isTraveling: false,
    isStopping: false
  };
};

const toTravelResponse = (progress) => {
  if (!progress.isTraveling) {
    return {
      isTraveling: false,
      isStopping: false,
      status: progress.status || TRAVEL_STATUS.IDLE
    };
  }

  return {
    isTraveling: true,
    isStopping: !!progress.isStopping,
    status: progress.status || TRAVEL_STATUS.MOVING,
    unitDurationSeconds: progress.unitDurationSeconds,
    totalDistanceUnits: progress.totalDistanceUnits,
    completedDistanceUnits: parseFloat(progress.completedDistanceUnits.toFixed(3)),
    remainingDistanceUnits: parseFloat(progress.remainingDistanceUnits.toFixed(3)),
    elapsedSeconds: parseFloat(progress.elapsedSeconds.toFixed(2)),
    remainingSeconds: parseFloat(progress.remainingSeconds.toFixed(2)),
    progressInCurrentSegment: parseFloat(progress.progressInCurrentSegment.toFixed(4)),
    currentSegmentIndex: progress.currentSegmentIndex,
    lastReachedNode: progress.lastReachedNode,
    nextNode: progress.nextNode,
    targetNode: progress.targetNode,
    path: progress.path,
    stopDurationSeconds: progress.stopDurationSeconds,
    stoppingNearestNode: progress.stoppingNearestNode,
    stopFromNode: progress.stopFromNode,
    queuedTargetNode: progress.queuedTargetNode
  };
};

const buildNodeGraph = (nodes) => {
  const nameToId = new Map();
  const idToNode = new Map();
  const adjacency = new Map();

  nodes.forEach((node) => {
    const id = node._id.toString();
    nameToId.set(node.name, id);
    idToNode.set(id, node);
    adjacency.set(id, new Set());
  });

  const link = (a, b) => {
    if (!a || !b || a === b) return;
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  };

  nodes.forEach((node) => {
    const nodeId = node._id.toString();
    (node.relatedParentDomains || []).forEach((parentName) => {
      link(nodeId, nameToId.get(parentName));
    });
    (node.relatedChildDomains || []).forEach((childName) => {
      link(nodeId, nameToId.get(childName));
    });
  });

  return { nameToId, idToNode, adjacency };
};

const bfsShortestPath = (startId, targetId, adjacency) => {
  if (startId === targetId) return [startId];
  const queue = [startId];
  const visited = new Set([startId]);
  const prev = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || new Set();

    for (const next of neighbors) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, current);

      if (next === targetId) {
        const path = [targetId];
        let step = targetId;
        while (prev.has(step)) {
          step = prev.get(step);
          path.push(step);
        }
        return path.reverse();
      }

      queue.push(next);
    }
  }

  return null;
};

const assignMovingTravelState = (user, path, targetNodeId, unitDurationSeconds, startedAt = new Date()) => {
  user.travelState = {
    status: TRAVEL_STATUS.MOVING,
    isTraveling: true,
    path,
    startedAt,
    unitDurationSeconds,
    targetNodeId,
    stoppingNearestNodeId: null,
    stoppingNearestNodeName: '',
    stopStartedAt: null,
    stopDurationSeconds: 0,
    stopFromNode: null,
    queuedTargetNodeId: null,
    queuedTargetNodeName: ''
  };
};

const startTravelFromCurrentLocation = async (user, targetNodeId, options = {}) => {
  if (!user.location || user.location.trim() === '') {
    return { ok: false, statusCode: 400, error: '请先设置当前位置后再移动' };
  }

  const approvedNodes = await Node.find({ status: 'approved' })
    .select('_id name relatedParentDomains relatedChildDomains')
    .lean();
  const { nameToId, idToNode, adjacency } = buildNodeGraph(approvedNodes);

  const startNodeId = nameToId.get(user.location);
  if (!startNodeId) {
    return { ok: false, statusCode: 400, error: '当前位置节点不存在或未审批通过' };
  }

  const targetId = targetNodeId.toString();
  const targetNode = idToNode.get(targetId);
  if (!targetNode) {
    return { ok: false, statusCode: 404, error: '目标节点不存在或未审批通过' };
  }

  if (startNodeId === targetId) {
    return { ok: false, statusCode: 400, error: '目标节点与当前位置相同，无需移动' };
  }

  const shortestPathIds = bfsShortestPath(startNodeId, targetId, adjacency);
  if (!shortestPathIds || shortestPathIds.length < 2) {
    return { ok: false, statusCode: 400, error: '当前位置与目标节点之间不存在可达路径' };
  }

  const settings = await getOrCreateSettings();
  const safeUnitDuration = Math.max(
    1,
    parseInt(options.unitDurationSeconds, 10) || settings.travelUnitSeconds
  );
  const path = shortestPathIds.map((id) => ({
    nodeId: idToNode.get(id)._id,
    nodeName: idToNode.get(id).name
  }));

  assignMovingTravelState(user, path, targetNode._id, safeUnitDuration, options.startedAt || new Date());

  return {
    ok: true,
    path,
    targetNode,
    shortestDistance: shortestPathIds.length - 1,
    unitDurationSeconds: safeUnitDuration
  };
};

const settleTravelState = async (user) => {
  const progress = calculateTravelProgress(user);
  const travel = user.travelState || {};
  const currentStatus = getTravelStatus(travel);

  if (currentStatus === TRAVEL_STATUS.MOVING && progress.arrived) {
    const unitDurationSeconds = Math.max(1, parseInt(travel.unitDurationSeconds, 10) || 60);
    const arrivedNodeName = progress.arrivedNode?.nodeName || user.location || '';
    user.location = arrivedNodeName;
    appendArrivalNotification(user, arrivedNodeName, progress.elapsedSeconds || 0);
    resetTravelState(user, unitDurationSeconds);
    await user.save();
    return calculateTravelProgress(user);
  }

  if (currentStatus === TRAVEL_STATUS.STOPPING && progress.arrived) {
    const unitDurationSeconds = Math.max(1, parseInt(travel.unitDurationSeconds, 10) || 60);
    const nearestNodeName = travel.stoppingNearestNodeName || progress.stoppingNearestNode?.nodeName;
    const nearestNodeId = (travel.stoppingNearestNodeId || progress.stoppingNearestNode?.nodeId || '').toString();
    const queuedTargetNodeId = travel.queuedTargetNodeId ? travel.queuedTargetNodeId.toString() : '';

    if (nearestNodeName) {
      user.location = nearestNodeName;
    }

    resetTravelState(user, unitDurationSeconds);

    if (queuedTargetNodeId && queuedTargetNodeId !== nearestNodeId) {
      const queuedStartResult = await startTravelFromCurrentLocation(user, queuedTargetNodeId, {
        unitDurationSeconds
      });
      if (!queuedStartResult.ok) {
        resetTravelState(user, unitDurationSeconds);
      }
    }

    await user.save();
    return calculateTravelProgress(user);
  }

  return progress;
};

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // 验证输入
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: '用户名至少3个字符' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6个字符' });
    }
    
    // 检查用户是否已存在
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建用户
    const user = new User({ 
      username, 
      password: hashedPassword,
      plainPassword: password,
      role: 'common'
    });
    await user.save();

    // 生成token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    
    res.status(201).json({
      token,
      userId: user._id,
      username: user.username,
      role: user.role,
      location: user.location,
      profession: user.profession,
      avatar: user.avatar,
      gender: user.gender
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // 验证输入
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    
    // 查找用户
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 验证密码
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 生成token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      userId: user._id,
      username: user.username,
      role: user.role,
      location: user.location,
      profession: user.profession,
      avatar: user.avatar,
      gender: user.gender
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 更新用户location
router.put('/location', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { location } = req.body;

    if (!location || location.trim() === '') {
      return res.status(400).json({ error: 'location不能为空' });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const travelProgress = await settleTravelState(user);
    if (travelProgress.isTraveling) {
      return res.status(409).json({ error: '移动中无法手动修改位置，请先停止移动' });
    }

    user.location = location;
    await user.save();

    res.json({
      success: true,
      location: user.location
    });
  } catch (error) {
    console.error('更新location错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 找回密码（修改密码）
router.post('/reset-password', async (req, res) => {
  try {
    const { username, oldPassword, newPassword } = req.body;

    // 验证输入
    if (!username || !oldPassword || !newPassword) {
      return res.status(400).json({ error: '用户名、原密码和新密码不能为空' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少6个字符' });
    }

    // 查找用户
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: '用户名不存在' });
    }

    // 验证原密码
    const validPassword = await bcrypt.compare(oldPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '原密码错误' });
    }

    // 加密新密码
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // 更新密码
    user.password = hashedNewPassword;
    user.plainPassword = newPassword; // 同时更新明文密码（用于管理员查看）
    await user.save();

    res.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('重置密码错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取用户个人信息
router.get('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password -plainPassword');

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      userId: user._id,
      username: user.username,
      role: user.role,
      level: user.level,
      experience: user.experience,
      knowledgeBalance: user.knowledgeBalance || 0,
      location: user.location,
      profession: user.profession,
      avatar: user.avatar,
      gender: user.gender,
      ownedNodes: user.ownedNodes,
      allianceId: user.allianceId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 修改头像
router.put('/profile/avatar', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { avatar } = req.body;

    // 验证头像ID是否为有效的默认头像
    const validAvatars = [
      'default_male_1', 'default_male_2', 'default_male_3',
      'default_female_1', 'default_female_2', 'default_female_3'
    ];

    if (!avatar || !validAvatars.includes(avatar)) {
      return res.status(400).json({ error: '无效的头像选择' });
    }

    const user = await User.findByIdAndUpdate(
      decoded.userId,
      { avatar },
      { new: true }
    ).select('-password -plainPassword');

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      success: true,
      avatar: user.avatar
    });
  } catch (error) {
    console.error('修改头像错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 修改密码（已登录状态）
router.put('/profile/password', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { oldPassword, newPassword } = req.body;

    // 验证输入
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '原密码和新密码不能为空' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少6个字符' });
    }

    // 查找用户
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 验证原密码
    const validPassword = await bcrypt.compare(oldPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '原密码错误' });
    }

    // 加密新密码
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // 更新密码
    user.password = hashedNewPassword;
    user.plainPassword = newPassword;
    await user.save();

    res.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('修改密码错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 修改性别
router.put('/profile/gender', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { gender } = req.body;

    // 验证性别值
    const validGenders = ['male', 'female', 'other'];
    if (!gender || !validGenders.includes(gender)) {
      return res.status(400).json({ error: '无效的性别选择' });
    }

    const user = await User.findByIdAndUpdate(
      decoded.userId,
      { gender },
      { new: true }
    ).select('-password -plainPassword');

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      success: true,
      gender: user.gender
    });
  } catch (error) {
    console.error('修改性别错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取通知列表
router.get('/notifications', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('notifications');
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    await settleExpiredResignRequestsForUser(user);

    const notifications = [...(user.notifications || [])]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((notification) => ({
        _id: notification._id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        read: notification.read,
        status: notification.status,
        nodeId: notification.nodeId,
        nodeName: notification.nodeName,
        allianceId: notification.allianceId,
        allianceName: notification.allianceName,
        inviterId: notification.inviterId,
        inviterUsername: notification.inviterUsername,
        inviteeId: notification.inviteeId,
        inviteeUsername: notification.inviteeUsername,
        applicationReason: notification.applicationReason,
        createdAt: notification.createdAt,
        respondedAt: notification.respondedAt
      }));

    const unreadCount = notifications.filter((notification) => !notification.read).length;

    res.json({
      success: true,
      unreadCount,
      notifications
    });
  } catch (error) {
    console.error('获取通知列表错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 清空通知列表
router.post('/notifications/clear', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('notifications');
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const clearedCount = Array.isArray(user.notifications) ? user.notifications.length : 0;
    user.notifications = [];
    await user.save();

    res.json({
      success: true,
      clearedCount,
      message: '通知已清空'
    });
  } catch (error) {
    console.error('清空通知错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 全部标记为已读
router.post('/notifications/read-all', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('notifications');
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    let updatedCount = 0;
    for (const notification of (user.notifications || [])) {
      if (!notification.read) {
        notification.read = true;
        updatedCount += 1;
      }
    }

    if (updatedCount > 0) {
      await user.save();
    }

    res.json({
      success: true,
      updatedCount,
      message: '通知已全部标记为已读'
    });
  } catch (error) {
    console.error('全部标记已读错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 标记通知已读
router.post('/notifications/:notificationId/read', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const notification = user.notifications.id(req.params.notificationId);
    if (!notification) {
      return res.status(404).json({ error: '通知不存在' });
    }

    notification.read = true;
    await user.save();

    res.json({
      success: true,
      message: '通知已标记为已读'
    });
  } catch (error) {
    console.error('标记通知已读错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 响应通知动作（域相邀请/域相卸任申请/域主申请/熵盟入盟申请）
router.post('/notifications/:notificationId/respond', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const { action } = req.body;
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: '无效的操作类型' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const notification = user.notifications.id(req.params.notificationId);
    if (!notification) {
      return res.status(404).json({ error: '通知不存在' });
    }

    if (notification.status !== 'pending') {
      return res.status(400).json({ error: '该通知不可响应' });
    }

    let decision = 'rejected';
    let decisionMessage = '处理完成';

    if (notification.type === 'domain_admin_invite') {
      if (!notification.nodeId) {
        return res.status(400).json({ error: '邀请信息异常：缺少节点信息' });
      }

      const node = await Node.findById(notification.nodeId).select('name status domainMaster domainAdmins');
      if (!node || node.status !== 'approved') {
        return res.status(400).json({ error: '该知识域不存在或不可加入域相' });
      }

      if (!node.domainMaster || !notification.inviterId || getIdString(node.domainMaster) !== getIdString(notification.inviterId)) {
        return res.status(400).json({ error: '邀请已失效（域主已变化）' });
      }

      if (user.role !== 'common') {
        return res.status(400).json({ error: '只有普通用户可以接受该邀请' });
      }

      if (action === 'accept') {
        if (getIdString(node.domainMaster) === getIdString(user._id)) {
          decision = 'rejected';
          decisionMessage = '你已是该知识域域主，无需接受域相邀请';
        } else {
          const alreadyAdmin = (node.domainAdmins || []).some((id) => getIdString(id) === getIdString(user._id));
          if (!alreadyAdmin) {
            node.domainAdmins.push(user._id);
            await node.save();
          }
          decision = 'accepted';
          decisionMessage = alreadyAdmin ? '你已是该知识域域相' : '已接受邀请，成为知识域域相';
        }
      } else {
        decision = 'rejected';
        decisionMessage = '已拒绝邀请';
      }

      notification.status = decision;
      notification.read = true;
      notification.respondedAt = new Date();
      await user.save();

      if (notification.inviterId) {
        const inviter = await User.findById(notification.inviterId);
        if (inviter) {
          inviter.notifications.unshift({
            type: 'domain_admin_invite_result',
            title: `邀请结果：${notification.nodeName || '知识域'}`,
            message: `${user.username} ${decision === 'accepted' ? '已接受' : '已拒绝'}你的域相邀请`,
            read: false,
            status: decision,
            nodeId: notification.nodeId || null,
            nodeName: notification.nodeName || '',
            inviterId: inviter._id,
            inviterUsername: inviter.username,
            inviteeId: user._id,
            inviteeUsername: user.username,
            respondedAt: notification.respondedAt
          });
          await inviter.save();
        }
      }
    } else if (notification.type === 'domain_admin_resign_request') {
      const expired = isResignRequestExpired(notification);
      const result = await handleResignRequestDecision({
        domainMasterUser: user,
        notification,
        action: expired ? 'accept' : action,
        isAuto: expired
      });
      decision = result.decision;
      decisionMessage = result.message;
      await user.save();
    } else if (notification.type === 'domain_master_apply') {
      if (user.role !== 'admin') {
        return res.status(403).json({ error: '只有管理员可以处理域主申请' });
      }

      const result = await handleDomainMasterApplyDecision({
        processorUser: user,
        notification,
        action
      });
      decision = result.decision;
      decisionMessage = result.message;
      if (result.saveCurrentUser) {
        await user.save();
      }
    } else if (notification.type === 'alliance_join_apply') {
      const result = await handleAllianceJoinApplyDecision({
        leaderUser: user,
        notification,
        action
      });
      if (result.error) {
        return res.status(403).json({ error: result.error });
      }
      decision = result.decision;
      decisionMessage = result.message;
      if (result.saveLeader) {
        await user.save();
      }
    } else {
      return res.status(400).json({ error: '该通知类型不支持响应操作' });
    }

    res.json({
      success: true,
      decision,
      message: decisionMessage
    });
  } catch (error) {
    console.error('响应邀请通知错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取当前移动状态
router.get('/travel/status', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const progress = await settleTravelState(user);

    res.json({
      success: true,
      location: user.location,
      travel: toTravelResponse(progress)
    });
  } catch (error) {
    console.error('获取移动状态错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 预估移动耗时（不改变真实移动状态）
router.post('/travel/estimate', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ error: '管理员无需执行移动操作' });
    }

    const { targetNodeId } = req.body || {};
    if (!targetNodeId) {
      return res.status(400).json({ error: '目标节点不能为空' });
    }
    if (!isValidObjectId(targetNodeId)) {
      return res.status(400).json({ error: '无效的目标节点ID' });
    }

    const settledProgress = await settleTravelState(user);
    const currentStatus = getTravelStatus(user.travelState || {});
    if (currentStatus === TRAVEL_STATUS.MOVING && settledProgress.isTraveling) {
      return res.status(409).json({ error: '正在移动中，请先停止当前移动后再预估' });
    }
    if (currentStatus === TRAVEL_STATUS.STOPPING && settledProgress.isStopping) {
      return res.status(409).json({ error: '停止移动过程中暂不可预估，请等待停靠完成' });
    }

    const estimateResult = await startTravelFromCurrentLocation(
      { location: user.location, travelState: {} },
      targetNodeId
    );
    if (!estimateResult.ok) {
      return res.status(estimateResult.statusCode || 400).json({
        error: estimateResult.error || '预估移动失败'
      });
    }

    const estimatedSeconds = Math.max(
      0,
      (Number(estimateResult.shortestDistance) || 0) * (Number(estimateResult.unitDurationSeconds) || 60)
    );

    return res.json({
      success: true,
      fromNodeName: user.location || '',
      toNodeId: estimateResult.targetNode?._id || targetNodeId,
      toNodeName: estimateResult.targetNode?.name || '',
      distanceUnits: Number(estimateResult.shortestDistance) || 0,
      unitDurationSeconds: Number(estimateResult.unitDurationSeconds) || 60,
      estimatedSeconds: Number(estimatedSeconds.toFixed(2)),
      estimatedDurationText: formatDurationCN(estimatedSeconds)
    });
  } catch (error) {
    console.error('预估移动耗时错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 开始移动（普通用户）
router.post('/travel/start', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ error: '管理员无需执行移动操作' });
    }

    const { targetNodeId } = req.body;
    if (!targetNodeId) {
      return res.status(400).json({ error: '目标节点不能为空' });
    }
    if (!isValidObjectId(targetNodeId)) {
      return res.status(400).json({ error: '无效的目标节点ID' });
    }

    const settledProgress = await settleTravelState(user);
    const currentStatus = getTravelStatus(user.travelState || {});

    const activeManualDistributionLock = await findActiveManualDistributionLockForUser(decoded.userId, new Date());
    if (activeManualDistributionLock?.node) {
      return res.status(409).json({
        error: `你已参与知识域「${activeManualDistributionLock.node.name}」分发活动，分发结束前不可移动。请先在分发页面点击“退出分发活动”后再移动。`,
        lockNodeId: activeManualDistributionLock.node._id,
        lockNodeName: activeManualDistributionLock.node.name
      });
    }

    if (currentStatus === TRAVEL_STATUS.MOVING && settledProgress.isTraveling) {
      return res.status(409).json({ error: '正在移动中，请先停止当前移动' });
    }

    if (currentStatus === TRAVEL_STATUS.STOPPING) {
      const targetNode = await Node.findOne({ _id: targetNodeId, status: 'approved' }).select('_id name');
      if (!targetNode) {
        return res.status(404).json({ error: '目标节点不存在或未审批通过' });
      }

      const nearestNodeId = user.travelState?.stoppingNearestNodeId?.toString?.() || '';
      if (nearestNodeId && nearestNodeId === targetNode._id.toString()) {
        return res.status(400).json({ error: '停止移动期间不能把最近节点设为新的目标' });
      }

      user.travelState.queuedTargetNodeId = targetNode._id;
      user.travelState.queuedTargetNodeName = targetNode.name;
      await user.save();

      const stoppingProgress = calculateTravelProgress(user);
      return res.json({
        success: true,
        message: `已记录新的目标节点 ${targetNode.name}，将在停止完成后自动出发`,
        location: user.location,
        travel: toTravelResponse(stoppingProgress)
      });
    }

    const startResult = await startTravelFromCurrentLocation(user, targetNodeId);
    if (!startResult.ok) {
      return res.status(startResult.statusCode || 400).json({ error: startResult.error || '开始移动失败' });
    }

    await user.save();

    const progress = calculateTravelProgress(user);

    res.json({
      success: true,
      message: `已开始前往 ${startResult.targetNode.name}，总距离 ${startResult.shortestDistance} 单位`,
      location: user.location,
      travel: toTravelResponse(progress)
    });
  } catch (error) {
    console.error('开始移动错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 停止移动（按当前进度就近停靠）
router.post('/travel/stop', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ error: '管理员无需执行移动操作' });
    }

    const progress = await settleTravelState(user);
    const currentStatus = getTravelStatus(user.travelState || {});

    if (currentStatus === TRAVEL_STATUS.IDLE || !progress.isTraveling) {
      return res.status(400).json({ error: '当前不在移动状态' });
    }

    if (currentStatus === TRAVEL_STATUS.STOPPING) {
      return res.json({
        success: true,
        message: '已在停止移动过程中，请等待到达最近节点',
        location: user.location,
        travel: toTravelResponse(progress)
      });
    }

    const nearestIsNext = progress.progressInCurrentSegment >= 0.5;
    const nearestNode = nearestIsNext ? progress.nextNode : progress.lastReachedNode;
    const stopFromNode = nearestIsNext ? progress.lastReachedNode : progress.nextNode;
    if (!nearestNode) {
      return res.status(400).json({ error: '当前移动状态异常，无法停止移动' });
    }
    const unitDurationSeconds = Math.max(1, parseInt(progress.unitDurationSeconds, 10) || 60);
    const stopDurationSeconds = nearestIsNext
      ? (1 - progress.progressInCurrentSegment) * unitDurationSeconds
      : progress.progressInCurrentSegment * unitDurationSeconds;

    user.travelState.status = TRAVEL_STATUS.STOPPING;
    user.travelState.isTraveling = true;
    user.travelState.path = [];
    user.travelState.startedAt = null;
    user.travelState.targetNodeId = null;
    user.travelState.stoppingNearestNodeId = nearestNode.nodeId;
    user.travelState.stoppingNearestNodeName = nearestNode.nodeName;
    user.travelState.stopStartedAt = new Date();
    user.travelState.stopDurationSeconds = parseFloat(stopDurationSeconds.toFixed(3));
    user.travelState.stopFromNode = stopFromNode || null;
    user.travelState.queuedTargetNodeId = null;
    user.travelState.queuedTargetNodeName = '';
    await user.save();

    const stoppingProgress = calculateTravelProgress(user);

    res.json({
      success: true,
      message: `已开始停止移动，将在 ${Math.ceil(stoppingProgress.remainingSeconds || 0)} 秒后到达 ${nearestNode.nodeName}`,
      location: user.location,
      snappedNode: nearestNode,
      travel: toTravelResponse(stoppingProgress)
    });
  } catch (error) {
    console.error('停止移动错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
