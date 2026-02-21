const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Notification = require('../models/Notification');
const UserInboxState = require('../models/UserInboxState');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const text = String(value);
  if (!mongoose.Types.ObjectId.isValid(text)) return null;
  return new mongoose.Types.ObjectId(text);
};

const normalizeLegacyNotification = (userId, notification = {}) => {
  const source = typeof notification.toObject === 'function' ? notification.toObject() : notification;
  const notificationId = toObjectIdOrNull(source?._id) || new mongoose.Types.ObjectId();
  const createdAt = source?.createdAt ? new Date(source.createdAt) : new Date();
  const respondedAt = source?.respondedAt ? new Date(source.respondedAt) : null;
  return {
    _id: notificationId,
    userId,
    type: typeof source?.type === 'string' ? source.type : 'info',
    title: typeof source?.title === 'string' ? source.title : '',
    message: typeof source?.message === 'string' ? source.message : '',
    read: !!source?.read,
    status: typeof source?.status === 'string' ? source.status : 'info',
    nodeId: toObjectIdOrNull(source?.nodeId),
    nodeName: typeof source?.nodeName === 'string' ? source.nodeName : '',
    allianceId: toObjectIdOrNull(source?.allianceId),
    allianceName: typeof source?.allianceName === 'string' ? source.allianceName : '',
    inviterId: toObjectIdOrNull(source?.inviterId),
    inviterUsername: typeof source?.inviterUsername === 'string' ? source.inviterUsername : '',
    inviteeId: toObjectIdOrNull(source?.inviteeId),
    inviteeUsername: typeof source?.inviteeUsername === 'string' ? source.inviteeUsername : '',
    applicationReason: typeof source?.applicationReason === 'string' ? source.applicationReason : '',
    requiresArrival: !!source?.requiresArrival,
    respondedAt,
    createdAt
  };
};

const buildInboxStateFromNotifications = (notifications = []) => {
  let unreadCount = 0;
  let lastNotificationAt = null;
  for (const item of notifications) {
    if (!item?.read) unreadCount += 1;
    const ts = item?.createdAt ? new Date(item.createdAt) : null;
    if (ts && (!lastNotificationAt || ts > lastNotificationAt)) {
      lastNotificationAt = ts;
    }
  }
  return {
    unreadCount,
    lastNotificationAt
  };
};

async function migrateNotifications() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已连接到 MongoDB');

    const users = await User.find({}).select('_id notifications').lean();
    let totalLegacyNotifications = 0;
    let upsertedNotifications = 0;
    let usersWithLegacyNotifications = 0;
    let inboxStateUpserts = 0;

    for (const user of users) {
      const userId = toObjectIdOrNull(user?._id);
      if (!userId) continue;
      const sourceNotifications = Array.isArray(user?.notifications) ? user.notifications : [];
      if (sourceNotifications.length > 0) {
        usersWithLegacyNotifications += 1;
      }
      totalLegacyNotifications += sourceNotifications.length;

      const normalized = sourceNotifications.map((item) => normalizeLegacyNotification(userId, item));
      if (normalized.length > 0) {
        const notificationOps = normalized.map((item) => ({
          updateOne: {
            filter: { _id: item._id },
            update: { $setOnInsert: item },
            upsert: true
          }
        }));
        const result = await Notification.bulkWrite(notificationOps, { ordered: false });
        upsertedNotifications += (result?.upsertedCount || 0);
      }

      const inboxState = buildInboxStateFromNotifications(normalized);
      await UserInboxState.updateOne(
        { userId },
        {
          $set: {
            unreadCount: inboxState.unreadCount,
            lastNotificationAt: inboxState.lastNotificationAt
          }
        },
        { upsert: true }
      );
      inboxStateUpserts += 1;
    }

    console.log(`用户总数: ${users.length}`);
    console.log(`携带旧通知的用户数: ${usersWithLegacyNotifications}`);
    console.log(`旧通知总数: ${totalLegacyNotifications}`);
    console.log(`新集合新增通知数: ${upsertedNotifications}`);
    console.log(`收件箱状态 upsert 数: ${inboxStateUpserts}`);
    console.log('迁移完成。可通过 NOTIFICATION_COLLECTION_READ=true 灰度切换读取。');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('迁移通知到独立集合失败:', error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // ignore
    }
    process.exit(1);
  }
}

migrateNotifications();

