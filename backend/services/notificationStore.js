const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const UserInboxState = require('../models/UserInboxState');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!isValidObjectId(String(value))) return null;
  return new mongoose.Types.ObjectId(String(value));
};

const parseEnvFlag = (rawValue, defaultValue = true) => {
  if (typeof rawValue !== 'string') return defaultValue;
  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const isNotificationCollectionReadEnabled = () => parseEnvFlag(process.env.NOTIFICATION_COLLECTION_READ, true);
const isNotificationDualWriteEnabled = () => parseEnvFlag(process.env.NOTIFICATION_DUAL_WRITE, true);

const normalizeNotificationDoc = (item = {}) => {
  const userId = toObjectIdOrNull(item.userId);
  if (!userId) return null;

  const notificationId = toObjectIdOrNull(item._id) || new mongoose.Types.ObjectId();
  const createdAt = item.createdAt ? new Date(item.createdAt) : new Date();
  const respondedAt = item.respondedAt ? new Date(item.respondedAt) : null;

  return {
    _id: notificationId,
    userId,
    type: typeof item.type === 'string' ? item.type : 'info',
    title: typeof item.title === 'string' ? item.title : '',
    message: typeof item.message === 'string' ? item.message : '',
    read: !!item.read,
    status: typeof item.status === 'string' ? item.status : 'info',
    nodeId: toObjectIdOrNull(item.nodeId),
    nodeName: typeof item.nodeName === 'string' ? item.nodeName : '',
    allianceId: toObjectIdOrNull(item.allianceId),
    allianceName: typeof item.allianceName === 'string' ? item.allianceName : '',
    inviterId: toObjectIdOrNull(item.inviterId),
    inviterUsername: typeof item.inviterUsername === 'string' ? item.inviterUsername : '',
    inviteeId: toObjectIdOrNull(item.inviteeId),
    inviteeUsername: typeof item.inviteeUsername === 'string' ? item.inviteeUsername : '',
    applicationReason: typeof item.applicationReason === 'string' ? item.applicationReason : '',
    requiresArrival: !!item.requiresArrival,
    respondedAt,
    createdAt
  };
};

const listUserNotificationsFromCollection = async (userId, { limit = 500 } = {}) => {
  const safeUserId = toObjectIdOrNull(userId);
  if (!safeUserId) return [];
  const safeLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 500));
  return Notification.find({ userId: safeUserId })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
};

const countUnreadNotificationsFromCollection = async (userId) => {
  const safeUserId = toObjectIdOrNull(userId);
  if (!safeUserId) return 0;
  return Notification.countDocuments({ userId: safeUserId, read: false });
};

const clearUserNotificationsFromCollection = async (userId) => {
  const safeUserId = toObjectIdOrNull(userId);
  if (!safeUserId) return 0;
  const result = await Notification.deleteMany({ userId: safeUserId });
  await UserInboxState.updateOne(
    { userId: safeUserId },
    { $set: { unreadCount: 0 } },
    { upsert: true }
  );
  return result?.deletedCount || 0;
};

const markAllNotificationsReadFromCollection = async (userId) => {
  const safeUserId = toObjectIdOrNull(userId);
  if (!safeUserId) return 0;
  const result = await Notification.updateMany(
    { userId: safeUserId, read: false },
    { $set: { read: true } }
  );
  await UserInboxState.updateOne(
    { userId: safeUserId },
    { $set: { unreadCount: 0 } },
    { upsert: true }
  );
  return result?.modifiedCount || 0;
};

const markNotificationReadFromCollection = async ({ userId, notificationId }) => {
  const safeUserId = toObjectIdOrNull(userId);
  const safeNotificationId = toObjectIdOrNull(notificationId);
  if (!safeUserId || !safeNotificationId) return false;

  const result = await Notification.updateOne(
    { _id: safeNotificationId, userId: safeUserId, read: false },
    { $set: { read: true } }
  );
  if ((result?.modifiedCount || 0) > 0) {
    await UserInboxState.updateOne(
      { userId: safeUserId },
      { $inc: { unreadCount: -1 } },
      { upsert: true }
    );
    return true;
  }
  return false;
};

const writeNotificationsToCollection = async (notifications = []) => {
  if (!isNotificationDualWriteEnabled()) {
    return { insertedCount: 0, skipped: true };
  }

  const docs = notifications
    .map((item) => normalizeNotificationDoc(item))
    .filter(Boolean);
  if (docs.length === 0) {
    return { insertedCount: 0, skipped: false };
  }

  let insertedDocs = [];
  try {
    insertedDocs = await Notification.insertMany(docs, { ordered: false });
  } catch (error) {
    if (Array.isArray(error?.insertedDocs)) {
      insertedDocs = error.insertedDocs;
    } else if (error?.writeErrors) {
      const isDupOnly = error.writeErrors.every((entry) => entry?.code === 11000);
      if (!isDupOnly) throw error;
    } else {
      throw error;
    }
  }

  if (insertedDocs.length > 0) {
    const stateMap = new Map();
    insertedDocs.forEach((item) => {
      const key = String(item.userId);
      if (!stateMap.has(key)) {
        stateMap.set(key, {
          userId: item.userId,
          unreadCount: 0,
          lastNotificationAt: item.createdAt || new Date()
        });
      }
      const current = stateMap.get(key);
      if (!item.read) current.unreadCount += 1;
      if (item.createdAt && item.createdAt > current.lastNotificationAt) {
        current.lastNotificationAt = item.createdAt;
      }
    });

    const ops = Array.from(stateMap.values()).map((item) => ({
      updateOne: {
        filter: { userId: item.userId },
        update: {
          $inc: { unreadCount: item.unreadCount },
          $max: { lastNotificationAt: item.lastNotificationAt }
        },
        upsert: true
      }
    }));
    if (ops.length > 0) {
      await UserInboxState.bulkWrite(ops, { ordered: false });
    }
  }

  return { insertedCount: insertedDocs.length, skipped: false };
};

const serializeNotificationForResponse = (notification = {}) => ({
  _id: notification._id,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  read: !!notification.read,
  status: notification.status,
  nodeId: notification.nodeId || null,
  nodeName: notification.nodeName || '',
  allianceId: notification.allianceId || null,
  allianceName: notification.allianceName || '',
  inviterId: notification.inviterId || null,
  inviterUsername: notification.inviterUsername || '',
  inviteeId: notification.inviteeId || null,
  inviteeUsername: notification.inviteeUsername || '',
  applicationReason: notification.applicationReason || '',
  createdAt: notification.createdAt || null,
  respondedAt: notification.respondedAt || null
});

const recomputeInboxStateByUserIds = async (userIds = []) => {
  const uniqueUserIds = Array.from(new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((item) => toObjectIdOrNull(item))
      .filter(Boolean)
      .map((item) => String(item))
  )).map((item) => new mongoose.Types.ObjectId(item));

  for (const userId of uniqueUserIds) {
    const [unreadCount, latest] = await Promise.all([
      Notification.countDocuments({ userId, read: false }),
      Notification.findOne({ userId }).sort({ createdAt: -1 }).select('createdAt').lean()
    ]);
    await UserInboxState.updateOne(
      { userId },
      {
        $set: {
          unreadCount: Math.max(0, parseInt(unreadCount, 10) || 0),
          lastNotificationAt: latest?.createdAt || null
        }
      },
      { upsert: true }
    );
  }
};

const upsertNotificationsToCollection = async (notifications = []) => {
  if (!isNotificationDualWriteEnabled()) {
    return { upsertedCount: 0, modifiedCount: 0, skipped: true };
  }

  const docs = notifications
    .map((item) => normalizeNotificationDoc(item))
    .filter(Boolean);
  if (docs.length === 0) {
    return { upsertedCount: 0, modifiedCount: 0, skipped: false };
  }

  const ops = docs.map((item) => ({
    updateOne: {
      filter: { _id: item._id },
      update: { $set: item },
      upsert: true
    }
  }));
  const result = await Notification.bulkWrite(ops, { ordered: false });
  await recomputeInboxStateByUserIds(docs.map((item) => item.userId));
  return {
    upsertedCount: result?.upsertedCount || 0,
    modifiedCount: result?.modifiedCount || 0,
    skipped: false
  };
};

module.exports = {
  countUnreadNotificationsFromCollection,
  clearUserNotificationsFromCollection,
  isNotificationCollectionReadEnabled,
  isNotificationDualWriteEnabled,
  listUserNotificationsFromCollection,
  markAllNotificationsReadFromCollection,
  markNotificationReadFromCollection,
  upsertNotificationsToCollection,
  serializeNotificationForResponse,
  writeNotificationsToCollection
};
