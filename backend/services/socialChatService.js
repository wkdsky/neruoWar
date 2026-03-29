const mongoose = require('mongoose');

const User = require('../models/User');
const { writeNotificationsToCollection } = require('./notificationStore');

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (value && typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (value && typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(getIdString(value));

const toObjectId = (value) => (
  isValidObjectId(value)
    ? new mongoose.Types.ObjectId(getIdString(value))
    : null
);

const buildUserPairKey = (userIdA, userIdB) => (
  [getIdString(userIdA), getIdString(userIdB)]
    .filter(Boolean)
    .sort()
    .join(':')
);

const deriveFriendStatus = (friendship = null, currentUserId = '') => {
  if (!friendship) return 'none';
  if (friendship?.status === 'accepted') return 'friend';
  if (friendship?.status === 'blocked') return 'blocked';
  if (friendship?.status === 'pending') {
    return getIdString(friendship?.requesterId) === getIdString(currentUserId)
      ? 'pending_sent'
      : 'pending_received';
  }
  return 'none';
};

const truncateMessagePreview = (value = '', maxLength = 120) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
};

const buildNotificationPayload = (payload = {}) => ({
  ...payload,
  _id: payload?._id && isValidObjectId(payload._id)
    ? new mongoose.Types.ObjectId(getIdString(payload._id))
    : new mongoose.Types.ObjectId(),
  createdAt: payload?.createdAt ? new Date(payload.createdAt) : new Date()
});

const pushNotificationToUser = (user, payload = {}) => {
  if (!user) return null;
  const notification = buildNotificationPayload(payload);
  user.notifications = Array.isArray(user.notifications) ? user.notifications : [];
  user.notifications.unshift(notification);
  return notification;
};

const toCollectionNotificationDoc = (userId, notification = {}) => {
  const source = typeof notification?.toObject === 'function' ? notification.toObject() : notification;
  return {
    ...source,
    _id: source?._id,
    userId
  };
};

const sendNotificationToUser = async (userId, payload = {}) => {
  const safeUserId = getIdString(userId);
  if (!isValidObjectId(safeUserId)) return null;
  const user = await User.findById(safeUserId).select('_id username notifications');
  if (!user) return null;
  const notification = pushNotificationToUser(user, payload);
  await user.save();
  if (notification) {
    await writeNotificationsToCollection([
      toCollectionNotificationDoc(user._id, notification)
    ]);
  }
  return notification;
};

const serializeUserSummary = (user = {}, extras = {}) => {
  const summary = {
    _id: getIdString(user?._id),
    username: user?.username || '',
    avatar: user?.avatar || 'default_male_1',
    profession: user?.profession || '',
    allianceId: getIdString(user?.allianceId),
    ...extras
  };

  if (typeof extras?.allianceName !== 'string' && typeof user?.allianceName === 'string') {
    summary.allianceName = user.allianceName;
  }
  if (typeof extras?.friendStatus !== 'string' && typeof user?.friendStatus === 'string') {
    summary.friendStatus = user.friendStatus;
  }

  return summary;
};

const serializeFriendItem = ({
  friendship = {},
  currentUserId,
  otherUser = null,
  conversation = null,
  conversationMember = null
} = {}) => ({
  friendshipId: getIdString(friendship?._id),
  status: friendship?.status || 'pending',
  requestMessage: friendship?.requestMessage || '',
  requesterId: getIdString(friendship?.requesterId),
  addresseeId: getIdString(friendship?.addresseeId),
  acceptedAt: friendship?.acceptedAt || null,
  respondedAt: friendship?.respondedAt || null,
  createdAt: friendship?.createdAt || null,
  direction: getIdString(friendship?.requesterId) === getIdString(currentUserId) ? 'sent' : 'received',
  hasConversation: Boolean(conversation?._id),
  conversationId: conversation?._id ? getIdString(conversation._id) : null,
  conversationVisible: !!conversationMember?.isVisible,
  user: otherUser || null
});

const serializeMessageForUserView = (message = {}, sender = null) => ({
  _id: getIdString(message?._id),
  conversationId: getIdString(message?.conversationId),
  seq: Number(message?.seq) || 0,
  senderId: getIdString(message?.senderId),
  type: message?.type || 'text',
  content: message?.content || '',
  clientMessageId: message?.clientMessageId || '',
  createdAt: message?.createdAt || null,
  editedAt: message?.editedAt || null,
  recalledAt: message?.recalledAt || null,
  sender: sender ? serializeUserSummary(sender) : null
});

const serializeConversationItem = ({
  conversation = {},
  member = {},
  directUser = null,
  latestVisibleMessage = null
} = {}) => ({
  conversationId: getIdString(conversation?._id),
  type: conversation?.type || 'direct',
  title: conversation?.type === 'direct'
    ? (directUser?.username || conversation?.title || '私聊')
    : (conversation?.title || '群聊'),
  ownerId: getIdString(conversation?.ownerId),
  announcement: conversation?.type === 'group' ? (conversation?.announcement || '') : '',
  avatar: conversation?.type === 'direct'
    ? (directUser?.avatar || 'default_male_1')
    : (conversation?.avatar || ''),
  memberCount: Number(conversation?.memberCount) || (conversation?.type === 'direct' ? 2 : 0),
  lastMessagePreview: latestVisibleMessage?.content
    ? truncateMessagePreview(latestVisibleMessage.content)
    : '',
  lastMessageAt: latestVisibleMessage?.createdAt || null,
  lastReadSeq: Number(member?.lastReadSeq) || 0,
  unreadCount: Number(member?.unreadCount) || 0,
  pinned: !!member?.pinned,
  mute: !!member?.mute,
  isVisible: !!member?.isVisible,
  clearedBeforeSeq: Number(member?.clearedBeforeSeq) || 0,
  currentUserRole: member?.role || 'member',
  directUser: directUser ? serializeUserSummary(directUser) : null
});

const serializeGroupMemberItem = ({
  member = {},
  user = null
} = {}) => ({
  userId: getIdString(member?.userId || user?._id),
  role: member?.role || 'member',
  nicknameInGroup: member?.nicknameInGroup || '',
  joinedAt: member?.joinedAt || null,
  isActive: member?.isActive !== false,
  user: user ? serializeUserSummary(user) : null
});

module.exports = {
  buildUserPairKey,
  deriveFriendStatus,
  getIdString,
  isValidObjectId,
  pushNotificationToUser,
  sendNotificationToUser,
  serializeConversationItem,
  serializeGroupMemberItem,
  serializeFriendItem,
  serializeMessageForUserView,
  serializeUserSummary,
  toCollectionNotificationDoc,
  toObjectId,
  truncateMessagePreview
};
