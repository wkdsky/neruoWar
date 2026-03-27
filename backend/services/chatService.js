const socialRepository = require('../repositories/socialRepository');
const chatRepository = require('../repositories/chatRepository');
const { MAX_DIRECT_MESSAGE_LENGTH } = require('../constants/socialChat');
const SocialChatError = require('./socialChatError');
const {
  buildUserPairKey,
  getIdString,
  isValidObjectId,
  serializeConversationItem,
  serializeMessageForUserView,
  serializeUserSummary,
  truncateMessagePreview
} = require('./socialChatService');

const createChatService = ({
  socialRepo = socialRepository,
  chatRepo = chatRepository
} = {}) => {
  const assertValidUserId = (userId) => {
    const safeUserId = getIdString(userId);
    if (!isValidObjectId(safeUserId)) {
      throw new SocialChatError('无效的用户身份', {
        status: 401,
        code: 'INVALID_USER_IDENTITY'
      });
    }
    return safeUserId;
  };

  const assertFriendshipForDirectConversation = async (userIdA, userIdB) => {
    const friendship = await socialRepo.findAcceptedFriendshipByParticipantsKey(
      buildUserPairKey(userIdA, userIdB)
    );
    if (!friendship) {
      throw new SocialChatError('当前仅支持好友之间发起私聊', {
        status: 403,
        code: 'DIRECT_CHAT_REQUIRES_FRIENDSHIP'
      });
    }
    return friendship;
  };

  const createDirectConversation = async ({ userIdA, userIdB, openerUserId }) => {
    let conversation = null;
    const directKey = buildUserPairKey(userIdA, userIdB);
    try {
      conversation = await chatRepo.createConversation({
        type: 'direct',
        ownerId: openerUserId,
        directKey,
        memberCount: 2
      });
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
      conversation = await chatRepo.findDirectConversationByKey(directKey);
    }
    if (!conversation) {
      throw new SocialChatError('创建私聊会话失败', {
        status: 500,
        code: 'DIRECT_CONVERSATION_CREATE_FAILED'
      });
    }

    const now = new Date();
    await Promise.all([
      // 当前主动打开聊天的人立即可见；对侧先保持隐藏，直到其主动打开或收到新消息。
      chatRepo.ensureConversationMember({
        conversationId: conversation._id,
        userId: userIdA,
        set: {
          isActive: true,
          isVisible: getIdString(userIdA) === getIdString(openerUserId),
          leftAt: null,
          updatedAt: now
        }
      }),
      chatRepo.ensureConversationMember({
        conversationId: conversation._id,
        userId: userIdB,
        set: {
          isActive: true,
          isVisible: getIdString(userIdB) === getIdString(openerUserId),
          leftAt: null,
          updatedAt: now
        }
      })
    ]);

    return conversation;
  };

  const ensureDirectConversationForFriends = async ({
    requestUserId,
    targetUserId
  }) => {
    const safeRequestUserId = assertValidUserId(requestUserId);
    const safeTargetUserId = getIdString(targetUserId);
    if (!isValidObjectId(safeTargetUserId)) {
      throw new SocialChatError('无效的目标用户', {
        status: 400,
        code: 'INVALID_TARGET_USER_ID'
      });
    }
    if (safeRequestUserId === safeTargetUserId) {
      throw new SocialChatError('不能与自己建立私聊', {
        status: 400,
        code: 'SELF_DIRECT_CHAT_NOT_ALLOWED'
      });
    }

    await assertFriendshipForDirectConversation(safeRequestUserId, safeTargetUserId);
    const directKey = buildUserPairKey(safeRequestUserId, safeTargetUserId);
    let conversation = await chatRepo.findDirectConversationByKey(directKey);
    if (!conversation) {
      conversation = await createDirectConversation({
        userIdA: safeRequestUserId,
        userIdB: safeTargetUserId,
        openerUserId: safeRequestUserId
      });
    }

    const now = new Date();
    const existingRequestMember = await chatRepo.findConversationMember({
      conversationId: conversation._id,
      userId: safeRequestUserId,
      isActive: true
    });
    const [requestMember, targetMember, targetUser] = await Promise.all([
      chatRepo.ensureConversationMember({
        conversationId: conversation._id,
        userId: safeRequestUserId,
        set: {
          isActive: true,
          isVisible: true,
          leftAt: null,
          updatedAt: now
        }
      }),
      chatRepo.ensureConversationMember({
        conversationId: conversation._id,
        userId: safeTargetUserId,
        set: {
          isActive: true,
          leftAt: null
        },
        setOnInsert: {
          isVisible: false
        }
      }),
      socialRepo.findUserById(safeTargetUserId, '_id username avatar profession allianceId')
    ]);

    const latestVisibleMessage = await chatRepo.findLatestVisibleMessage({
      conversationId: conversation._id,
      clearedBeforeSeq: requestMember?.clearedBeforeSeq || 0
    });

    return {
      conversation: serializeConversationItem({
        conversation,
        member: requestMember,
        directUser: targetUser ? serializeUserSummary(targetUser) : null,
        latestVisibleMessage
      }),
      restoredVisibility: existingRequestMember ? !existingRequestMember.isVisible : false,
      targetVisible: !!targetMember?.isVisible
    };
  };

  const listVisibleConversationsForUser = async ({ userId }) => {
    const safeUserId = assertValidUserId(userId);
    const members = await chatRepo.listConversationMembersByUser({
      userId: safeUserId,
      isActive: true,
      isVisible: true
    });
    if (members.length === 0) {
      return { rows: [] };
    }

    const conversations = await chatRepo.listConversationsByIds(members.map((item) => item.conversationId));
    const conversationMap = new Map(conversations.map((item) => [getIdString(item?._id), item]));
    const directOtherMembers = await chatRepo.listConversationMembersByConversationIds({
      conversationIds: conversations.filter((item) => item?.type === 'direct').map((item) => item?._id),
      excludeUserId: safeUserId,
      isActive: true
    });
    const directUsers = await socialRepo.findUsersByIds(directOtherMembers.map((item) => item?.userId));
    const directUserMap = new Map(directUsers.map((item) => [getIdString(item?._id), item]));
    const directConversationUserMap = new Map(
      directOtherMembers.map((item) => [getIdString(item?.conversationId), directUserMap.get(getIdString(item?.userId)) || null])
    );

    const rows = [];
    for (const member of members) {
      const conversation = conversationMap.get(getIdString(member?.conversationId));
      if (!conversation) continue;
      const latestVisibleMessage = await chatRepo.findLatestVisibleMessage({
        conversationId: conversation._id,
        clearedBeforeSeq: member?.clearedBeforeSeq || 0
      });
      rows.push(serializeConversationItem({
        conversation,
        member,
        directUser: directConversationUserMap.get(getIdString(conversation?._id)) || null,
        latestVisibleMessage
      }));
    }

    rows.sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      const rightSortAt = new Date(right.lastMessageAt || 0).getTime();
      const leftSortAt = new Date(left.lastMessageAt || 0).getTime();
      return rightSortAt - leftSortAt;
    });

    return { rows };
  };

  const serializeConversationForUserView = async ({
    userId,
    conversationId
  }) => {
    const { conversation, member, userId: safeUserId } = await getConversationAccessContext({ userId, conversationId });

    let directUser = null;
    if (conversation?.type === 'direct') {
      const [otherMember] = await chatRepo.listConversationMembersByConversationIds({
        conversationIds: [conversation._id],
        excludeUserId: safeUserId,
        isActive: true
      });
      if (otherMember?.userId) {
        const otherUser = await socialRepo.findUserById(otherMember.userId, '_id username avatar profession allianceId');
        directUser = otherUser ? serializeUserSummary(otherUser) : null;
      }
    }

    const latestVisibleMessage = await chatRepo.findLatestVisibleMessage({
      conversationId: conversation._id,
      clearedBeforeSeq: member?.clearedBeforeSeq || 0
    });

    return serializeConversationItem({
      conversation,
      member,
      directUser,
      latestVisibleMessage
    });
  };

  const listConversationParticipantUserIds = async ({
    conversationId,
    isActive = true
  }) => {
    const safeConversationId = getIdString(conversationId);
    if (!isValidObjectId(safeConversationId)) {
      return [];
    }

    const members = await chatRepo.listConversationMembersByConversationId(safeConversationId, { isActive });
    return members.map((item) => getIdString(item?.userId)).filter(Boolean);
  };

  const getConversationAccessContext = async ({ userId, conversationId }) => {
    const safeUserId = assertValidUserId(userId);
    const safeConversationId = getIdString(conversationId);
    if (!isValidObjectId(safeConversationId)) {
      throw new SocialChatError('无效的会话ID', {
        status: 400,
        code: 'INVALID_CONVERSATION_ID'
      });
    }

    const [conversation, member] = await Promise.all([
      chatRepo.findConversationById(safeConversationId),
      chatRepo.findConversationMember({
        conversationId: safeConversationId,
        userId: safeUserId,
        isActive: true
      })
    ]);
    if (!conversation) {
      throw new SocialChatError('会话不存在', {
        status: 404,
        code: 'CONVERSATION_NOT_FOUND'
      });
    }
    if (!member) {
      throw new SocialChatError('你不在该会话中', {
        status: 403,
        code: 'CONVERSATION_ACCESS_DENIED'
      });
    }

    return {
      conversation,
      member,
      userId: safeUserId
    };
  };

  const listMessagesForUserView = async ({
    userId,
    conversationId,
    beforeSeq = 0,
    limit = 30
  }) => {
    const { conversation, member } = await getConversationAccessContext({ userId, conversationId });
    const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 30));
    const safeBeforeSeq = Math.max(0, parseInt(beforeSeq, 10) || 0);

    if (safeBeforeSeq > 0 && safeBeforeSeq <= (Number(member?.clearedBeforeSeq) || 0)) {
      return {
        rows: [],
        nextBeforeSeq: 0
      };
    }

    const messages = await chatRepo.listMessagesForConversationView({
      conversationId: conversation._id,
      clearedBeforeSeq: member?.clearedBeforeSeq || 0,
      beforeSeq: safeBeforeSeq,
      limit: safeLimit
    });
    const senderIds = Array.from(new Set(messages.map((item) => getIdString(item?.senderId)).filter((item) => isValidObjectId(item))));
    const senders = await socialRepo.findUsersByIds(senderIds);
    const senderMap = new Map(senders.map((item) => [getIdString(item?._id), item]));
    const orderedMessages = [...messages].reverse();
    const nextBeforeSeq = messages.length >= safeLimit ? Number(messages[messages.length - 1]?.seq) || 0 : 0;

    return {
      rows: orderedMessages.map((item) => serializeMessageForUserView(item, senderMap.get(getIdString(item?.senderId)) || null)),
      nextBeforeSeq
    };
  };

  const reactivateConversationForRecipientOnIncomingMessage = async ({
    conversationId,
    senderUserId,
    seq,
    at
  }) => {
    // 单边删除只隐藏/清空当前成员视图；新消息到达时重新把接收者会话拉回列表。
    await chatRepo.updateConversationMembers({
      conversationId,
      excludeUserId: senderUserId,
      isActive: true,
      update: {
        $inc: { unreadCount: 1 },
        $set: {
          isVisible: true,
          updatedAt: at,
          leftAt: null
        }
      }
    });
  };

  const sendMessage = async ({
    userId,
    conversationId,
    type = 'text',
    content,
    clientMessageId = ''
  }) => {
    const normalizedType = String(type || 'text').trim();
    const messageContent = String(content || '').trim();
    const normalizedClientMessageId = String(clientMessageId || '').trim().slice(0, 80);

    if (normalizedType !== 'text') {
      throw new SocialChatError('当前仅支持文本消息', {
        status: 400,
        code: 'UNSUPPORTED_MESSAGE_TYPE'
      });
    }
    if (!messageContent) {
      throw new SocialChatError('消息内容不能为空', {
        status: 400,
        code: 'EMPTY_MESSAGE_CONTENT'
      });
    }
    if (messageContent.length > MAX_DIRECT_MESSAGE_LENGTH) {
      throw new SocialChatError('消息内容过长', {
        status: 400,
        code: 'MESSAGE_CONTENT_TOO_LONG'
      });
    }

    const { conversation, member, userId: safeUserId } = await getConversationAccessContext({
      userId,
      conversationId
    });

    if (conversation.type === 'direct') {
      const directUserIds = String(conversation.directKey || '').split(':').filter(Boolean);
      if (directUserIds.length !== 2 || !directUserIds.includes(safeUserId)) {
        throw new SocialChatError('私聊会话参与者异常', {
          status: 400,
          code: 'INVALID_DIRECT_CONVERSATION_MEMBERS'
        });
      }
      const peerUserId = directUserIds.find((item) => item !== safeUserId);
      await assertFriendshipForDirectConversation(safeUserId, peerUserId);
    }

    if (normalizedClientMessageId) {
      const existingMessage = await chatRepo.findMessageByClientMessageId({
        conversationId: conversation._id,
        senderId: safeUserId,
        clientMessageId: normalizedClientMessageId
      });
      if (existingMessage) {
        const sender = await socialRepo.findUserById(safeUserId, '_id username avatar profession allianceId');
        return {
          conversationId: getIdString(conversation._id),
          message: serializeMessageForUserView(existingMessage, sender)
        };
      }
    }

    const seqRow = await chatRepo.allocateNextConversationSeq(conversation._id);
    const nextSeq = Number(seqRow?.messageSeq) || 0;
    if (nextSeq <= 0) {
      throw new SocialChatError('消息序号分配失败', {
        status: 500,
        code: 'MESSAGE_SEQ_ALLOCATION_FAILED'
      });
    }

    const createdAt = new Date();
    const message = await chatRepo.createMessage({
      conversationId: conversation._id,
      seq: nextSeq,
      senderId: safeUserId,
      type: normalizedType,
      content: messageContent,
      clientMessageId: normalizedClientMessageId,
      createdAt,
      updatedAt: createdAt
    });

    await Promise.all([
      chatRepo.updateConversationLastMessage({
        conversationId: conversation._id,
        messageId: message._id,
        preview: truncateMessagePreview(messageContent),
        at: createdAt
      }),
      reactivateConversationForRecipientOnIncomingMessage({
        conversationId: conversation._id,
        senderUserId: safeUserId,
        seq: nextSeq,
        at: createdAt
      }),
      chatRepo.updateConversationMember({
        conversationId: conversation._id,
        userId: safeUserId,
        update: {
          $set: {
            isVisible: true,
            isActive: true,
            lastReadSeq: nextSeq,
            unreadCount: 0,
            updatedAt: createdAt,
            leftAt: null
          }
        }
      })
    ]);

    const sender = await socialRepo.findUserById(safeUserId, '_id username avatar profession allianceId');
    return {
      conversationId: getIdString(conversation._id),
      message: serializeMessageForUserView(message, sender)
    };
  };

  const markConversationReadForUser = async ({
    userId,
    conversationId,
    lastReadSeq = 0
  }) => {
    const { conversation, member } = await getConversationAccessContext({ userId, conversationId });
    const currentLastReadSeq = Number(member.lastReadSeq) || 0;
    const clearedBeforeSeq = Number(member.clearedBeforeSeq) || 0;
    const maxSeq = Number(conversation.messageSeq) || 0;
    const requestedSeq = Math.max(0, parseInt(lastReadSeq, 10) || 0);
    const nextLastReadSeq = Math.max(
      currentLastReadSeq,
      Math.min(requestedSeq || maxSeq, maxSeq),
      clearedBeforeSeq
    );

    const nextUnreadCount = Math.max(0, maxSeq - nextLastReadSeq);
    await chatRepo.updateConversationMember({
      conversationId: conversation._id,
      userId: member.userId,
      update: {
        $set: {
          lastReadSeq: nextLastReadSeq,
          unreadCount: nextUnreadCount
        }
      }
    });

    return {
      conversationId: getIdString(conversation._id),
      lastReadSeq: nextLastReadSeq,
      unreadCount: nextUnreadCount
    };
  };

  const hideConversationForUser = async ({ userId, conversationId }) => {
    const { conversation, member } = await getConversationAccessContext({ userId, conversationId });
    if (conversation.type !== 'direct') {
      throw new SocialChatError('当前仅支持删除私聊会话', {
        status: 400,
        code: 'DIRECT_CONVERSATION_REQUIRED'
      });
    }

    const now = new Date();
    const currentMaxSeq = Number(conversation.messageSeq) || 0;
    const nextLastReadSeq = Math.max(Number(member.lastReadSeq) || 0, currentMaxSeq);
    const nextClearedBeforeSeq = Math.max(Number(member.clearedBeforeSeq) || 0, currentMaxSeq);

    // 删除私聊是单边行为：隐藏当前成员视图，并把历史可见边界推进到当前最新 seq。
    await chatRepo.updateConversationMember({
      conversationId: conversation._id,
      userId: member.userId,
      update: {
        $set: {
          isVisible: false,
          deletedAt: now,
          clearedAt: now,
          clearedBeforeSeq: nextClearedBeforeSeq,
          lastReadSeq: nextLastReadSeq,
          unreadCount: 0,
          updatedAt: now
        }
      }
    });

    return {
      conversationId: getIdString(conversation._id),
      friendRelationUnaffected: true,
      conversationHiddenForCurrentUser: true,
      historyClearedThroughSeq: nextClearedBeforeSeq,
      message: '当前用户侧会话已隐藏，历史消息已按当前边界清空'
    };
  };

  return {
    createDirectConversation,
    ensureDirectConversationForFriends,
    getConversationAccessContext,
    hideConversationForUser,
    listConversationParticipantUserIds,
    listMessagesForUserView,
    listVisibleConversationsForUser,
    markConversationReadForUser,
    reactivateConversationForRecipientOnIncomingMessage,
    serializeConversationForUserView,
    sendMessage
  };
};

module.exports = {
  chatService: createChatService(),
  createChatService
};
