const mongoose = require('mongoose');

const ChatSequence = require('../models/ChatSequence');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const GroupInvitation = require('../models/GroupInvitation');
const GroupNotice = require('../models/GroupNotice');
const Message = require('../models/Message');
const { getIdString, isValidObjectId } = require('../services/socialChatService');
const { GROUP_NO_SEQUENCE_KEY, GROUP_NO_SEQUENCE_START } = require('../constants/socialChat');

const toObjectId = (value) => new mongoose.Types.ObjectId(getIdString(value));

const findDirectConversationByKey = async (directKey) => Conversation.findOne({
  type: 'direct',
  directKey
});

const findGroupConversationByGroupNo = async (groupNo, select = null) => {
  const safeGroupNo = String(groupNo || '').trim();
  if (!safeGroupNo) return null;
  const query = Conversation.findOne({
    type: 'group',
    groupNo: safeGroupNo,
    isArchived: { $ne: true }
  });
  return select ? query.select(select) : query;
};

const listDirectConversationsByKeys = async (directKeys = []) => {
  const safeKeys = Array.from(new Set((Array.isArray(directKeys) ? directKeys : []).filter(Boolean)));
  if (safeKeys.length === 0) return [];
  return Conversation.find({
    type: 'direct',
    directKey: { $in: safeKeys }
  }).lean();
};

const createConversation = async (doc) => Conversation.create(doc);
const createGroupNotice = async (doc) => GroupNotice.create(doc);
const findGroupNoticeById = async (noticeId) => {
  const safeId = getIdString(noticeId);
  if (!isValidObjectId(safeId)) return null;
  return GroupNotice.findById(safeId);
};
const deleteGroupNoticeById = async (noticeId) => {
  const safeId = getIdString(noticeId);
  if (!isValidObjectId(safeId)) return { deletedCount: 0 };
  return GroupNotice.deleteOne({ _id: toObjectId(safeId) });
};

const allocateNextSequenceValue = async (key, startValue = 0) => {
  const safeKey = String(key || '').trim();
  if (!safeKey) return null;

  const loadNextSequenceValue = () => ChatSequence.findOneAndUpdate(
    { key: safeKey },
    {
      $inc: { value: 1 }
    },
    {
      new: true
    }
  ).lean();

  const existingSequence = await loadNextSequenceValue();
  if (existingSequence) {
    return existingSequence;
  }

  try {
    await ChatSequence.create({
      key: safeKey,
      value: Number(startValue) || 0
    });
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
  }

  return loadNextSequenceValue();
};

const allocateNextGroupNo = async () => {
  const sequence = await allocateNextSequenceValue(GROUP_NO_SEQUENCE_KEY, GROUP_NO_SEQUENCE_START);
  return Number(sequence?.value) || 0;
};

const countGroupConversationsByCreator = async (creatorId) => {
  const safeCreatorId = getIdString(creatorId);
  if (!isValidObjectId(safeCreatorId)) return 0;

  return Conversation.countDocuments({
    type: 'group',
    isArchived: { $ne: true },
    $or: [
      { creatorId: toObjectId(safeCreatorId) },
      {
        creatorId: null,
        ownerId: toObjectId(safeCreatorId)
      }
    ]
  });
};

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
}) => {
  const insertDefaults = {
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
  };

  Object.keys(set || {}).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(insertDefaults, key)) {
      delete insertDefaults[key];
    }
  });

  return ConversationMember.findOneAndUpdate(
    {
      conversationId: toObjectId(conversationId),
      userId: toObjectId(userId)
    },
    {
      $set: set,
      $setOnInsert: insertDefaults
    },
    {
      upsert: true,
      new: true
    }
  );
};

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

const findGroupInvitationById = async (invitationId) => {
  const safeId = getIdString(invitationId);
  if (!isValidObjectId(safeId)) return null;
  return GroupInvitation.findById(safeId);
};

const findGroupInvitationByConversationAndInvitee = async ({
  conversationId,
  inviteeId
}) => GroupInvitation.findOne({
  conversationId: toObjectId(conversationId),
  inviteeId: toObjectId(inviteeId)
});

const listGroupInvitationsByInvitee = async ({
  inviteeId,
  status = null
}) => GroupInvitation.find({
  inviteeId: toObjectId(inviteeId),
  ...(status ? { status } : {})
})
  .sort({ updatedAt: -1, createdAt: -1 })
  .lean();

const listGroupNoticesByConversationId = async (
  conversationId,
  { limit = 20 } = {}
) => GroupNotice.find({
  conversationId: toObjectId(conversationId)
})
  .sort({ createdAt: -1, _id: -1 })
  .limit(Math.max(1, Math.min(50, Number(limit) || 20)))
  .lean();

const createGroupInvitation = async (doc) => GroupInvitation.create(doc);

const countMessagesByConversationAndSender = async ({
  conversationId,
  senderId,
  createdAfter = null,
  afterSeq = 0
}) => Message.countDocuments({
  conversationId: toObjectId(conversationId),
  senderId: toObjectId(senderId),
  ...(afterSeq > 0 ? { seq: { $gt: afterSeq } } : {}),
  ...(createdAfter ? { createdAt: { $gte: new Date(createdAfter) } } : {})
});

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
  allocateNextGroupNo,
  countMessagesByConversationAndSender,
  countGroupConversationsByCreator,
  createGroupInvitation,
  createGroupNotice,
  createConversation,
  createMessage,
  deleteGroupNoticeById,
  ensureConversationMember,
  findConversationById,
  findConversationMember,
  findDirectConversationByKey,
  findGroupNoticeById,
  findGroupConversationByGroupNo,
  findGroupInvitationByConversationAndInvitee,
  findGroupInvitationById,
  findLatestVisibleMessage,
  findMessageByClientMessageId,
  listGroupInvitationsByInvitee,
  listGroupNoticesByConversationId,
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
