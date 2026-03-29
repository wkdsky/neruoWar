const mongoose = require('mongoose');

const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const Message = require('../models/Message');
const { getIdString, isValidObjectId } = require('../services/socialChatService');

const toObjectId = (value) => new mongoose.Types.ObjectId(getIdString(value));

const findDirectConversationByKey = async (directKey) => Conversation.findOne({
  type: 'direct',
  directKey
});

const listDirectConversationsByKeys = async (directKeys = []) => {
  const safeKeys = Array.from(new Set((Array.isArray(directKeys) ? directKeys : []).filter(Boolean)));
  if (safeKeys.length === 0) return [];
  return Conversation.find({
    type: 'direct',
    directKey: { $in: safeKeys }
  }).lean();
};

const createConversation = async (doc) => Conversation.create(doc);

const updateConversation = async ({
  conversationId,
  update
}) => Conversation.updateOne(
  { _id: toObjectId(conversationId) },
  update
);

const findConversationById = async (conversationId, select = null) => {
  const safeId = getIdString(conversationId);
  if (!isValidObjectId(safeId)) return null;
  const query = Conversation.findById(safeId);
  return select ? query.select(select) : query;
};

const listConversationsByIds = async (ids = []) => {
  const safeIds = Array.from(new Set(
    (Array.isArray(ids) ? ids : [])
      .map((item) => getIdString(item))
      .filter((item) => isValidObjectId(item))
  ));
  if (safeIds.length === 0) return [];
  return Conversation.find({
    _id: { $in: safeIds.map((item) => toObjectId(item)) },
    isArchived: { $ne: true }
  }).lean();
};

const allocateNextConversationSeq = async (conversationId) => Conversation.findOneAndUpdate(
  { _id: toObjectId(conversationId) },
  { $inc: { messageSeq: 1 } },
  { new: true, select: '_id messageSeq' }
).lean();

const updateConversationLastMessage = async ({
  conversationId,
  messageId,
  preview,
  at
}) => Conversation.updateOne(
  { _id: toObjectId(conversationId) },
  {
    $set: {
      lastMessageId: messageId || null,
      lastMessagePreview: preview || '',
      lastMessageAt: at || null,
      updatedAt: at || new Date()
    }
  }
);

const updateConversationMemberCount = async (conversationId, memberCount) => Conversation.updateOne(
  { _id: toObjectId(conversationId) },
  {
    $set: {
      memberCount: Math.max(0, Number(memberCount) || 0)
    }
  }
);

const ensureConversationMember = async ({
  conversationId,
  userId,
  set = {},
  setOnInsert = {}
}) => ConversationMember.findOneAndUpdate(
  {
    conversationId: toObjectId(conversationId),
    userId: toObjectId(userId)
  },
  {
    $set: set,
    $setOnInsert: {
      role: 'member',
      mute: false,
      pinned: false,
      lastReadSeq: 0,
      unreadCount: 0,
      isVisible: true,
      deletedAt: null,
      clearedBeforeSeq: 0,
      clearedAt: null,
      joinedAt: new Date(),
      isActive: true,
      ...setOnInsert
    }
  },
  {
    upsert: true,
    new: true
  }
);

const findConversationMember = async ({
  conversationId,
  userId,
  isActive = true
}) => ConversationMember.findOne({
  conversationId: toObjectId(conversationId),
  userId: toObjectId(userId),
  ...(typeof isActive === 'boolean' ? { isActive } : {})
});

const listConversationMembersByConversationId = async (conversationId, { isActive = true } = {}) => ConversationMember.find({
  conversationId: toObjectId(conversationId),
  ...(typeof isActive === 'boolean' ? { isActive } : {})
}).lean();

const listConversationMembersByUser = async ({
  userId,
  isActive = true,
  isVisible = null
}) => ConversationMember.find({
  userId: toObjectId(userId),
  ...(typeof isActive === 'boolean' ? { isActive } : {}),
  ...(typeof isVisible === 'boolean' ? { isVisible } : {})
})
  .select('conversationId userId role mute pinned lastReadSeq unreadCount isVisible deletedAt clearedBeforeSeq clearedAt joinedAt leftAt isActive updatedAt')
  .lean();

const listConversationMembersByConversationIds = async ({
  conversationIds = [],
  excludeUserId = null,
  isActive = true
}) => {
  const safeIds = Array.from(new Set(
    (Array.isArray(conversationIds) ? conversationIds : [])
      .map((item) => getIdString(item))
      .filter((item) => isValidObjectId(item))
  ));
  if (safeIds.length === 0) return [];
  return ConversationMember.find({
    conversationId: { $in: safeIds.map((item) => toObjectId(item)) },
    ...(excludeUserId && isValidObjectId(excludeUserId) ? { userId: { $ne: toObjectId(excludeUserId) } } : {}),
    ...(typeof isActive === 'boolean' ? { isActive } : {})
  })
    .select('conversationId userId role isVisible clearedBeforeSeq updatedAt')
    .lean();
};

const updateConversationMember = async ({
  conversationId,
  userId,
  update
}) => ConversationMember.updateOne({
  conversationId: toObjectId(conversationId),
  userId: toObjectId(userId)
}, update);

const updateConversationMembers = async ({
  conversationId,
  excludeUserId = null,
  update,
  isActive = true
}) => ConversationMember.updateMany({
  conversationId: toObjectId(conversationId),
  ...(excludeUserId && isValidObjectId(excludeUserId) ? { userId: { $ne: toObjectId(excludeUserId) } } : {}),
  ...(typeof isActive === 'boolean' ? { isActive } : {})
}, update);

const findMessageByClientMessageId = async ({
  conversationId,
  senderId,
  clientMessageId
}) => {
  if (!clientMessageId) return null;
  return Message.findOne({
    conversationId: toObjectId(conversationId),
    senderId: toObjectId(senderId),
    clientMessageId
  }).lean();
};

const createMessage = async (doc) => Message.create(doc);

const listMessagesForConversationView = async ({
  conversationId,
  clearedBeforeSeq = 0,
  beforeSeq = 0,
  limit = 30
}) => {
  const query = {
    conversationId: toObjectId(conversationId),
    seq: { $gt: Math.max(0, Number(clearedBeforeSeq) || 0) }
  };
  if (beforeSeq > 0) {
    query.seq.$lt = beforeSeq;
  }
  return Message.find(query)
    .sort({ seq: -1 })
    .limit(limit)
    .lean();
};

const findLatestVisibleMessage = async ({
  conversationId,
  clearedBeforeSeq = 0
}) => Message.findOne({
  conversationId: toObjectId(conversationId),
  seq: { $gt: Math.max(0, Number(clearedBeforeSeq) || 0) }
})
  .sort({ seq: -1 })
  .lean();

module.exports = {
  allocateNextConversationSeq,
  createConversation,
  createMessage,
  ensureConversationMember,
  findConversationById,
  findConversationMember,
  findDirectConversationByKey,
  findLatestVisibleMessage,
  findMessageByClientMessageId,
  listConversationMembersByConversationId,
  listConversationMembersByConversationIds,
  listConversationMembersByUser,
  listConversationsByIds,
  listDirectConversationsByKeys,
  listMessagesForConversationView,
  updateConversation,
  updateConversationLastMessage,
  updateConversationMember,
  updateConversationMemberCount,
  updateConversationMembers
};
