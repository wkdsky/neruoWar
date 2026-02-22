const mongoose = require('mongoose');
const User = require('../models/User');
const Node = require('../models/Node');
const Notification = require('../models/Notification');
const {
  isNotificationCollectionReadEnabled,
  upsertNotificationsToCollection,
  writeNotificationsToCollection
} = require('./notificationStore');

const RESIGN_REQUEST_EXPIRE_MS = 3 * 24 * 60 * 60 * 1000;

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

const toCollectionNotificationDoc = (userId, notification = {}) => {
  const source = typeof notification?.toObject === 'function' ? notification.toObject() : notification;
  return {
    ...source,
    _id: source?._id,
    userId
  };
};

const pushNotificationToUser = (user, payload = {}) => {
  if (!user) return null;
  const notification = {
    ...payload,
    _id: payload?._id && mongoose.Types.ObjectId.isValid(String(payload._id))
      ? new mongoose.Types.ObjectId(String(payload._id))
      : new mongoose.Types.ObjectId(),
    createdAt: payload?.createdAt ? new Date(payload.createdAt) : new Date()
  };
  user.notifications = Array.isArray(user.notifications) ? user.notifications : [];
  user.notifications.unshift(notification);
  return notification;
};

const processExpiredDomainAdminResignRequests = async (now = new Date()) => {
  const nowDate = now instanceof Date ? now : new Date(now);
  const deadline = new Date(nowDate.getTime() - RESIGN_REQUEST_EXPIRE_MS);

  if (isNotificationCollectionReadEnabled()) {
    const expiredRows = await Notification.find({
      type: 'domain_admin_resign_request',
      status: 'pending',
      createdAt: { $lte: deadline }
    }).select('_id userId nodeId nodeName inviteeId').lean();

    for (const row of expiredRows) {
      const domainMasterId = getIdString(row?.userId);
      const requesterId = getIdString(row?.inviteeId);
      let node = null;
      let requester = null;

      if (isValidObjectId(getIdString(row?.nodeId))) {
        node = await Node.findById(row.nodeId).select('name status domainMaster domainAdmins');
      }
      if (isValidObjectId(requesterId)) {
        requester = await User.findById(requesterId).select('_id username');
      }

      if (
        node
        && node.status === 'approved'
        && getIdString(node.domainMaster) === domainMasterId
      ) {
        const before = (node.domainAdmins || []).length;
        node.domainAdmins = (node.domainAdmins || []).filter((adminId) => getIdString(adminId) !== requesterId);
        if (node.domainAdmins.length !== before) {
          await node.save();
        }
      }

      await Notification.updateOne(
        { _id: row._id, status: 'pending' },
        {
          $set: {
            status: 'accepted',
            read: true,
            respondedAt: nowDate
          }
        }
      );

      if (requester) {
        const requesterNotification = {
          _id: new mongoose.Types.ObjectId(),
          userId: requester._id,
          type: 'domain_admin_resign_result',
          title: `卸任申请结果：${row?.nodeName || node?.name || '知识域'}`,
          message: '你的卸任申请已超时自动同意',
          read: false,
          status: 'accepted',
          nodeId: node?._id || row?.nodeId || null,
          nodeName: node?.name || row?.nodeName || '',
          inviterId: row?.userId || null,
          inviterUsername: '',
          inviteeId: requester._id,
          inviteeUsername: requester.username || '',
          respondedAt: nowDate,
          createdAt: nowDate
        };
        await writeNotificationsToCollection([requesterNotification]);
      }
    }
    return;
  }

  const candidates = await User.find({
    notifications: {
      $elemMatch: {
        type: 'domain_admin_resign_request',
        status: 'pending',
        createdAt: { $lte: deadline }
      }
    }
  });

  for (const domainMaster of candidates) {
    let changed = false;
    const changedMasterNotificationDocs = [];

    for (const notification of domainMaster.notifications || []) {
      if (
        notification.type !== 'domain_admin_resign_request'
        || notification.status !== 'pending'
        || new Date(notification.createdAt || 0).getTime() > deadline.getTime()
      ) {
        continue;
      }

      const nodeId = getIdString(notification.nodeId);
      const requesterId = getIdString(notification.inviteeId);
      let node = null;
      let requester = null;

      if (nodeId && isValidObjectId(nodeId)) {
        node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
      }
      if (requesterId && isValidObjectId(requesterId)) {
        requester = await User.findById(requesterId);
      }

      if (node && node.status === 'approved' && getIdString(node.domainMaster) === getIdString(domainMaster._id)) {
        const before = (node.domainAdmins || []).length;
        node.domainAdmins = (node.domainAdmins || []).filter((adminId) => getIdString(adminId) !== requesterId);
        if (node.domainAdmins.length !== before) {
          await node.save();
        }
      }

      notification.status = 'accepted';
      notification.read = true;
      notification.respondedAt = nowDate;
      changed = true;
      changedMasterNotificationDocs.push(toCollectionNotificationDoc(domainMaster._id, notification));

      if (requester) {
        const requesterNotification = pushNotificationToUser(requester, {
          type: 'domain_admin_resign_result',
          title: `卸任申请结果：${notification.nodeName || node?.name || '知识域'}`,
          message: '你的卸任申请已超时自动同意',
          read: false,
          status: 'accepted',
          nodeId: node?._id || notification.nodeId || null,
          nodeName: node?.name || notification.nodeName || '',
          inviterId: domainMaster._id,
          inviterUsername: domainMaster.username,
          inviteeId: requester._id,
          inviteeUsername: requester.username,
          respondedAt: nowDate,
          createdAt: nowDate
        });
        await requester.save();
        await writeNotificationsToCollection([
          toCollectionNotificationDoc(requester._id, requesterNotification)
        ]);
      }
    }

    if (changed) {
      await domainMaster.save();
      if (changedMasterNotificationDocs.length > 0) {
        await upsertNotificationsToCollection(changedMasterNotificationDocs);
      }
    }
  }
};

module.exports = {
  processExpiredDomainAdminResignRequests,
  RESIGN_REQUEST_EXPIRE_MS
};
