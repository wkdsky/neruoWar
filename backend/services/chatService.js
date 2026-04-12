const { randomInt } = require('crypto');

const socialRepository = require('../repositories/socialRepository');
const chatRepository = require('../repositories/chatRepository');
const {
  DEFAULT_GROUP_AVATAR,
  GROUP_NO_LENGTH,
  GROUP_AVATAR_KEYS,
  MAX_DIRECT_MESSAGE_LENGTH,
  MAX_GROUP_ANNOUNCEMENT_LENGTH,
  MAX_GROUP_CREATED_COUNT,
  MAX_GROUP_MEMBER_COUNT,
  MAX_GROUP_SHARE_TARGET_COUNT,
  MAX_GROUP_MEMBERSHIP_COUNT,
  MAX_GROUP_TITLE_LENGTH,
  MAX_NON_FRIEND_DIRECT_MESSAGES
} = require('../constants/socialChat');
const SocialChatError = require('./socialChatError');
const {
  buildUserPairKey,
  buildMessagePreviewText,
  deriveFriendStatus,
  getIdString,
  isValidObjectId,
  serializeConversationItem,
  serializeGroupMemberItem,
  serializeMessageForUserView,
  serializeUserSummary,
  truncateMessagePreview
} = require('./socialChatService');

const createChatService = ({
  socialRepo = socialRepository,
  chatRepo = chatRepository
} = {}) => {
  const GROUP_NO_RANDOM_MIN = 10 ** Math.max(0, GROUP_NO_LENGTH - 1);
  const GROUP_NO_RANDOM_MAX = 10 ** GROUP_NO_LENGTH;
  const MAX_GROUP_NO_GENERATION_ATTEMPTS = 12;

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

  const normalizeGroupTitle = (value) => {
    const title = String(value || '').trim();
    if (!title) {
      throw new SocialChatError('群名称不能为空', {
        status: 400,
        code: 'EMPTY_GROUP_TITLE'
      });
    }
    if (title.length > MAX_GROUP_TITLE_LENGTH) {
      throw new SocialChatError(`群名称不能超过 ${MAX_GROUP_TITLE_LENGTH} 个字符`, {
        status: 400,
        code: 'GROUP_TITLE_TOO_LONG'
      });
    }
    return title;
  };

  const normalizeGroupAnnouncement = (value) => {
    const announcement = String(value || '').trim();
    if (announcement.length > MAX_GROUP_ANNOUNCEMENT_LENGTH) {
      throw new SocialChatError(`群公告不能超过 ${MAX_GROUP_ANNOUNCEMENT_LENGTH} 个字符`, {
        status: 400,
        code: 'GROUP_ANNOUNCEMENT_TOO_LONG'
      });
    }
    return announcement;
  };

  const normalizeGroupAvatar = (value, { allowEmpty = false } = {}) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      if (allowEmpty) return '';
      return DEFAULT_GROUP_AVATAR;
    }
    if (!GROUP_AVATAR_KEYS.includes(normalizedValue)) {
      throw new SocialChatError('群头像选项无效', {
        status: 400,
        code: 'INVALID_GROUP_AVATAR'
      });
    }
    return normalizedValue;
  };

  const dedupeUserIds = (values = []) => Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((item) => getIdString(item))
      .filter((item) => isValidObjectId(item))
  ));

  const formatGroupNo = (value) => {
    const numericValue = Number(value);
    if (!Number.isInteger(numericValue) || numericValue <= 0) {
      throw new SocialChatError('群号分配失败，请稍后重试', {
        status: 500,
        code: 'INVALID_GROUP_NO_SEQUENCE'
      });
    }

    const groupNo = String(numericValue).padStart(GROUP_NO_LENGTH, '0');
    if (groupNo.length > GROUP_NO_LENGTH) {
      throw new SocialChatError('群号容量已满，请联系管理员扩容', {
        status: 500,
        code: 'GROUP_NO_EXHAUSTED'
      });
    }
    return groupNo;
  };

  const buildRandomGroupNo = () => formatGroupNo(
    randomInt(GROUP_NO_RANDOM_MIN, GROUP_NO_RANDOM_MAX)
  );

  const allocateUniqueRandomGroupNo = async () => {
    for (let attempt = 0; attempt < MAX_GROUP_NO_GENERATION_ATTEMPTS; attempt += 1) {
      const nextGroupNo = buildRandomGroupNo();
      const existingConversation = await chatRepo.findGroupConversationByGroupNo(nextGroupNo, '_id');
      if (!existingConversation?._id) {
        return nextGroupNo;
      }
    }

    throw new SocialChatError('群号分配失败，请稍后重试', {
      status: 500,
      code: 'GROUP_NO_ALLOCATION_FAILED'
    });
  };

  const createGroupConversationRecord = async (payload = {}) => {
    for (let attempt = 0; attempt < MAX_GROUP_NO_GENERATION_ATTEMPTS; attempt += 1) {
      const nextGroupNo = await allocateUniqueRandomGroupNo();
      try {
        return await chatRepo.createConversation({
          ...payload,
          groupNo: nextGroupNo
        });
      } catch (error) {
        if (error?.code === 11000) {
          continue;
        }
        throw error;
      }
    }

    throw new SocialChatError('群号分配失败，请稍后重试', {
      status: 500,
      code: 'GROUP_NO_ALLOCATION_FAILED'
    });
  };

  const normalizeGroupNo = (value, { allowEmpty = false } = {}) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      if (allowEmpty) return '';
      throw new SocialChatError('群号不能为空', {
        status: 400,
        code: 'EMPTY_GROUP_NO'
      });
    }

    if (!/^\d+$/.test(normalizedValue)) {
      throw new SocialChatError('群号格式无效', {
        status: 400,
        code: 'INVALID_GROUP_NO'
      });
    }

    if (normalizedValue.length > GROUP_NO_LENGTH) {
      throw new SocialChatError('群号格式无效', {
        status: 400,
        code: 'INVALID_GROUP_NO'
      });
    }

    return normalizedValue.padStart(GROUP_NO_LENGTH, '0');
  };

  const getConversationCreatorId = (conversation = {}) => {
    const creatorId = getIdString(conversation?.creatorId || conversation?.ownerId);
    return isValidObjectId(creatorId) ? creatorId : '';
  };

  const materializeConversation = (conversation = {}, patch = {}) => {
    const baseConversation = typeof conversation?.toObject === 'function'
      ? conversation.toObject()
      : { ...conversation };
    return {
      ...baseConversation,
      ...patch
    };
  };

  const ensureLegacyGroupConversationMetadata = async (conversation = null) => {
    if (!conversation || conversation?.type !== 'group') {
      return conversation;
    }

    const updateSet = {};
    const currentGroupNo = String(conversation?.groupNo || '').trim();
    const currentAvatar = String(conversation?.avatar || '').trim();
    const currentCreatorId = getIdString(conversation?.creatorId);
    const fallbackCreatorId = getConversationCreatorId(conversation);

    if (!currentAvatar) {
      updateSet.avatar = DEFAULT_GROUP_AVATAR;
    }
    if (!isValidObjectId(currentCreatorId) && fallbackCreatorId) {
      updateSet.creatorId = fallbackCreatorId;
    }

    if (Object.keys(updateSet).length === 0) {
      return conversation;
    }

    for (let attempt = 0; attempt < MAX_GROUP_NO_GENERATION_ATTEMPTS; attempt += 1) {
      const nextUpdateSet = {
        ...updateSet,
        ...(currentGroupNo ? {} : { groupNo: await allocateUniqueRandomGroupNo() }),
        updatedAt: new Date()
      };

      try {
        await chatRepo.updateConversation({
          conversationId: conversation._id,
          update: {
            $set: nextUpdateSet
          }
        });
        return materializeConversation(conversation, nextUpdateSet);
      } catch (error) {
        if (!currentGroupNo && error?.code === 11000) {
          continue;
        }
        throw error;
      }
    }

    throw new SocialChatError('群号分配失败，请稍后重试', {
      status: 500,
      code: 'GROUP_NO_ALLOCATION_FAILED'
    });
  };

  const buildDirectUserSummary = async ({
    currentUserId,
    peerUserId
  }) => {
    const safeCurrentUserId = assertValidUserId(currentUserId);
    const safePeerUserId = getIdString(peerUserId);
    if (!isValidObjectId(safePeerUserId)) {
      throw new SocialChatError('无效的目标用户', {
        status: 400,
        code: 'INVALID_TARGET_USER_ID'
      });
    }

    const [peerUser, friendship] = await Promise.all([
      socialRepo.findUserById(safePeerUserId, '_id username avatar profession allianceId'),
      socialRepo.findFriendshipByParticipantsKey(buildUserPairKey(safeCurrentUserId, safePeerUserId))
    ]);

    if (!peerUser) {
      throw new SocialChatError('目标用户不存在', {
        status: 404,
        code: 'TARGET_USER_NOT_FOUND'
      });
    }

    return serializeUserSummary(peerUser, {
      friendStatus: deriveFriendStatus(friendship, safeCurrentUserId)
    });
  };

  const buildSharedGroupCardPayload = (conversation = {}) => ({
    group: {
      conversationId: getIdString(conversation?._id),
      title: conversation?.title || '群聊',
      announcement: conversation?.announcement || '',
      avatar: conversation?.avatar || DEFAULT_GROUP_AVATAR,
      groupNo: String(conversation?.groupNo || ''),
      memberCount: Number(conversation?.memberCount) || 0,
      ownerId: getIdString(conversation?.ownerId)
    }
  });

  const serializeGroupNoticeItem = ({
    notice = {},
    user = null
  } = {}) => ({
    noticeId: getIdString(notice?._id),
    content: notice?.content || '',
    createdAt: notice?.createdAt || null,
    createdBy: user ? serializeUserSummary(user) : null
  });

  const recordGroupNotice = async ({
    conversationId,
    content,
    createdBy,
    createdAt = new Date()
  }) => {
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent) {
      return null;
    }

    return chatRepo.createGroupNotice({
      conversationId,
      content: normalizedContent,
      createdBy,
      createdAt,
      updatedAt: createdAt
    });
  };

  const syncConversationAnnouncementFromLatestNotice = async ({
    conversationId,
    fallbackConversation = null
  }) => {
    const conversation = fallbackConversation || await chatRepo.findConversationById(conversationId);
    if (!conversation?._id) {
      return null;
    }

    const latestNoticeRows = await chatRepo.listGroupNoticesByConversationId(conversation._id, {
      limit: 1
    });
    const latestNotice = latestNoticeRows[0] || null;
    const updateSet = {
      announcement: latestNotice?.content || '',
      announcementUpdatedAt: latestNotice?.createdAt || null,
      announcementUpdatedBy: latestNotice?.createdBy || null,
      updatedAt: new Date()
    };

    await chatRepo.updateConversation({
      conversationId: conversation._id,
      update: {
        $set: updateSet
      }
    });

    return materializeConversation(conversation, updateSet);
  };

  const countActiveGroupMembershipsForUser = async (userId) => {
    const safeUserId = assertValidUserId(userId);
    const memberships = await chatRepo.listConversationMembersByUser({
      userId: safeUserId,
      isActive: true
    });
    if (memberships.length === 0) return 0;

    const conversations = await chatRepo.listConversationsByIds(
      memberships.map((item) => item?.conversationId)
    );
    return conversations.filter((item) => item?.type === 'group').length;
  };

  const countJoinedExternalGroupsForUser = async (userId) => {
    const safeUserId = assertValidUserId(userId);
    const memberships = await chatRepo.listConversationMembersByUser({
      userId: safeUserId,
      isActive: true
    });
    if (memberships.length === 0) return 0;

    const conversations = await chatRepo.listConversationsByIds(
      memberships.map((item) => item?.conversationId)
    );

    return conversations.filter((item) => {
      if (item?.type !== 'group') return false;
      const creatorId = getConversationCreatorId(item);
      return creatorId ? creatorId !== safeUserId : true;
    }).length;
  };

  const assertJoinedExternalGroupQuota = async (userIds = [], { conversationCreatorId = '' } = {}) => {
    const safeConversationCreatorId = getIdString(conversationCreatorId);
    for (const userId of dedupeUserIds(userIds)) {
      if (safeConversationCreatorId && safeConversationCreatorId === userId) {
        continue;
      }

      const count = await countJoinedExternalGroupsForUser(userId);
      if (count >= MAX_GROUP_MEMBERSHIP_COUNT) {
        const user = await socialRepo.findUserById(userId, '_id username');
        throw new SocialChatError(
          `${user?.username || '该用户'}加入的他人群聊数量已达上限，当前最多支持 ${MAX_GROUP_MEMBERSHIP_COUNT} 个`,
          {
            status: 400,
            code: 'GROUP_MEMBERSHIP_LIMIT_REACHED'
          }
        );
      }
    }
  };

  const assertGroupCreateQuota = async (userId) => {
    const safeUserId = assertValidUserId(userId);
    const count = await chatRepo.countGroupConversationsByCreator(safeUserId);
    if (count < MAX_GROUP_CREATED_COUNT) return;

    const user = await socialRepo.findUserById(safeUserId, '_id username');
    throw new SocialChatError(
      `${user?.username || '该用户'}最多只能创建 ${MAX_GROUP_CREATED_COUNT} 个群聊`,
      {
        status: 400,
        code: 'GROUP_CREATE_LIMIT_REACHED'
      }
    );
  };

  const ensureUsersExist = async (userIds = [], { allowEmpty = false } = {}) => {
    const safeIds = dedupeUserIds(userIds);
    if (!allowEmpty && safeIds.length === 0) {
      throw new SocialChatError('用户列表不能为空', {
        status: 400,
        code: 'EMPTY_USER_LIST'
      });
    }
    const users = await socialRepo.findUsersByIds(safeIds);
    const userMap = new Map(users.map((item) => [getIdString(item?._id), item]));
    const missingIds = safeIds.filter((item) => !userMap.has(item));
    if (missingIds.length > 0) {
      throw new SocialChatError('存在无效的群成员用户', {
        status: 400,
        code: 'GROUP_MEMBER_NOT_FOUND'
      });
    }
    return {
      userMap,
      users
    };
  };

  const syncConversationMemberCount = async (conversationId) => {
    const members = await chatRepo.listConversationMembersByConversationId(conversationId, {
      isActive: true
    });
    const memberCount = members.length;
    await chatRepo.updateConversationMemberCount(conversationId, memberCount);
    return memberCount;
  };

  const persistConversationMessage = async ({
    conversation,
    senderUserId,
    type = 'text',
    content = '',
    clientMessageId = '',
    payload = null
  }) => {
    const safeSenderUserId = assertValidUserId(senderUserId);
    const normalizedClientMessageId = String(clientMessageId || '').trim().slice(0, 80);

    if (!conversation?._id) {
      throw new SocialChatError('会话不存在', {
        status: 404,
        code: 'CONVERSATION_NOT_FOUND'
      });
    }

    if (normalizedClientMessageId) {
      const existingMessage = await chatRepo.findMessageByClientMessageId({
        conversationId: conversation._id,
        senderId: safeSenderUserId,
        clientMessageId: normalizedClientMessageId
      });
      if (existingMessage) {
        return {
          message: existingMessage,
          reusedExisting: true
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
    const messageDoc = {
      conversationId: conversation._id,
      seq: nextSeq,
      senderId: safeSenderUserId,
      type,
      content,
      clientMessageId: normalizedClientMessageId,
      createdAt,
      updatedAt: createdAt
    };
    if (payload && typeof payload === 'object') {
      messageDoc.payload = payload;
    }

    const message = await chatRepo.createMessage(messageDoc);
    const previewText = truncateMessagePreview(buildMessagePreviewText({
      type,
      content,
      payload
    }));

    await Promise.all([
      chatRepo.updateConversationLastMessage({
        conversationId: conversation._id,
        messageId: message._id,
        preview: previewText,
        at: createdAt
      }),
      reactivateConversationForRecipientOnIncomingMessage({
        conversationId: conversation._id,
        senderUserId: safeSenderUserId,
        at: createdAt
      }),
      chatRepo.updateConversationMember({
        conversationId: conversation._id,
        userId: safeSenderUserId,
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

    return {
      message,
      reusedExisting: false
    };
  };

  const buildGroupSearchResultForUser = async ({
    userId,
    conversation
  }) => {
    const safeUserId = assertValidUserId(userId);
    if (!conversation || conversation?.type !== 'group') {
      return null;
    }
    const normalizedConversation = await ensureLegacyGroupConversationMetadata(conversation);

    const [member, ownerUser] = await Promise.all([
      chatRepo.findConversationMember({
        conversationId: normalizedConversation._id,
        userId: safeUserId,
        isActive: true
      }),
      normalizedConversation?.ownerId
        ? socialRepo.findUserById(normalizedConversation.ownerId, '_id username avatar profession allianceId')
        : Promise.resolve(null)
    ]);

    const currentUserRole = member?.role || '';
    const membershipStatus = member
      ? currentUserRole === 'owner'
        ? 'owner'
        : getConversationCreatorId(normalizedConversation) === safeUserId
          ? 'creator'
          : 'joined'
      : 'none';

    return {
      conversationId: getIdString(normalizedConversation?._id),
      title: normalizedConversation?.title || '群聊',
      avatar: normalizedConversation?.avatar || DEFAULT_GROUP_AVATAR,
      groupNo: String(normalizedConversation?.groupNo || ''),
      announcement: normalizedConversation?.announcement || '',
      memberCount: Number(normalizedConversation?.memberCount) || 0,
      currentUserRole,
      membershipStatus,
      canJoin: !member,
      owner: ownerUser ? serializeUserSummary(ownerUser) : null
    };
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

    const normalizedConversation = conversation?.type === 'group'
      ? await ensureLegacyGroupConversationMetadata(conversation)
      : conversation;

    return {
      conversation: normalizedConversation,
      member,
      userId: safeUserId
    };
  };

  const getGroupConversationAccessContext = async ({ userId, conversationId }) => {
    const context = await getConversationAccessContext({ userId, conversationId });
    if (context.conversation?.type !== 'group') {
      throw new SocialChatError('当前仅支持群聊操作', {
        status: 400,
        code: 'GROUP_CONVERSATION_REQUIRED'
      });
    }
    return context;
  };

  const assertGroupOwnerAccess = (member) => {
    if (member?.role !== 'owner') {
      throw new SocialChatError('只有群主可以执行该操作', {
        status: 403,
        code: 'GROUP_OWNER_REQUIRED'
      });
    }
  };

  const buildGroupDetailForUser = async ({
    userId,
    conversationId
  }) => {
    const {
      conversation,
      member,
      userId: safeUserId
    } = await getGroupConversationAccessContext({ userId, conversationId });

    const [members, notices, latestVisibleMessage] = await Promise.all([
      chatRepo.listConversationMembersByConversationId(conversation._id, {
        isActive: true
      }),
      chatRepo.listGroupNoticesByConversationId(conversation._id, {
        limit: 20
      }),
      chatRepo.findLatestVisibleMessage({
        conversationId: conversation._id,
        clearedBeforeSeq: member?.clearedBeforeSeq || 0
      })
    ]);
    const relatedUserIds = dedupeUserIds([
      ...members.map((item) => item?.userId),
      ...notices.map((item) => item?.createdBy),
      conversation?.announcementUpdatedBy
    ]);
    const users = await socialRepo.findUsersByIds(relatedUserIds);
    const userMap = new Map(users.map((item) => [getIdString(item?._id), item]));

    const sortedMembers = [...members].sort((left, right) => {
      if (left?.role !== right?.role) {
        if (left?.role === 'owner') return -1;
        if (right?.role === 'owner') return 1;
      }
      return new Date(left?.joinedAt || 0).getTime() - new Date(right?.joinedAt || 0).getTime();
    });

    return {
      conversation: serializeConversationItem({
        conversation,
        member,
        latestVisibleMessage
      }),
      group: {
        conversationId: getIdString(conversation?._id),
        title: conversation?.title || '群聊',
        avatar: conversation?.avatar || DEFAULT_GROUP_AVATAR,
        groupNo: String(conversation?.groupNo || ''),
        announcement: conversation?.announcement || '',
        createdAt: conversation?.createdAt || null,
        lastActiveAt: conversation?.lastMessageAt || conversation?.updatedAt || conversation?.createdAt || null,
        announcementUpdatedAt: conversation?.announcementUpdatedAt || null,
        announcementUpdatedByUser: serializeUserSummary(
          userMap.get(getIdString(conversation?.announcementUpdatedBy)) || null
        ),
        ownerId: getIdString(conversation?.ownerId),
        memberCount: Number(conversation?.memberCount) || sortedMembers.length,
        currentUserRole: member?.role || 'member',
        canManage: member?.role === 'owner',
        canLeave: member?.role !== 'owner',
        noticeHistory: notices.map((item) => serializeGroupNoticeItem({
          notice: item,
          user: userMap.get(getIdString(item?.createdBy)) || null
        })),
        members: sortedMembers.map((item) => serializeGroupMemberItem({
          member: item,
          user: userMap.get(getIdString(item?.userId)) || null
        }))
      }
    };
  };

  const serializeGroupInvitationItem = ({
    invitation = {},
    conversation = null,
    inviter = null
  } = {}) => ({
    invitationId: getIdString(invitation?._id),
    conversationId: getIdString(invitation?.conversationId || conversation?._id),
    status: invitation?.status || 'pending',
    createdAt: invitation?.createdAt || null,
    updatedAt: invitation?.updatedAt || null,
    respondedAt: invitation?.respondedAt || null,
    group: conversation
      ? {
        conversationId: getIdString(conversation?._id),
        title: conversation?.title || '群聊',
        groupNo: String(conversation?.groupNo || ''),
        announcement: conversation?.announcement || '',
        memberCount: Number(conversation?.memberCount) || 0,
        avatar: conversation?.avatar || ''
      }
      : null,
    inviter: inviter ? serializeUserSummary(inviter) : null
  });

  const ensureConversationMemberSafely = async ({
    conversationId,
    userId,
    set = {},
    setOnInsert = {}
  }) => {
    try {
      return await chatRepo.ensureConversationMember({
        conversationId,
        userId,
        set,
        setOnInsert
      });
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }

      await chatRepo.updateConversationMember({
        conversationId,
        userId,
        update: {
          $set: set
        }
      });
      return chatRepo.findConversationMember({
        conversationId,
        userId,
        isActive: typeof set?.isActive === 'boolean' ? set.isActive : true
      });
    }
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
      ensureConversationMemberSafely({
        conversationId: conversation._id,
        userId: userIdA,
        set: {
          isActive: true,
          isVisible: getIdString(userIdA) === getIdString(openerUserId),
          leftAt: null,
          updatedAt: now
        }
      }),
      ensureConversationMemberSafely({
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

  const ensureDirectConversationByUsers = async ({
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

    const directUserSummary = await buildDirectUserSummary({
      currentUserId: safeRequestUserId,
      peerUserId: safeTargetUserId
    });
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
      ensureConversationMemberSafely({
          conversationId: conversation._id,
          userId: safeRequestUserId,
          set: {
            isActive: true,
            isVisible: true,
            leftAt: null,
            updatedAt: now
          }
      }),
      ensureConversationMemberSafely({
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
      Promise.resolve(directUserSummary)
    ]);

    const latestVisibleMessage = await chatRepo.findLatestVisibleMessage({
      conversationId: conversation._id,
      clearedBeforeSeq: requestMember?.clearedBeforeSeq || 0
    });

    return {
      conversation: serializeConversationItem({
        conversation,
        member: requestMember,
        directUser: targetUser || null,
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
    const friendshipRows = await socialRepo.listFriendshipsByParticipantsKeys(
      directOtherMembers.map((item) => buildUserPairKey(safeUserId, item?.userId))
    );
    const friendshipMap = new Map(friendshipRows.map((item) => [item.participantsKey, item]));
    const directConversationUserMap = new Map(
      directOtherMembers.map((item) => {
        const otherUser = directUserMap.get(getIdString(item?.userId));
        const friendship = friendshipMap.get(buildUserPairKey(safeUserId, item?.userId)) || null;
        return [
          getIdString(item?.conversationId),
          otherUser ? serializeUserSummary(otherUser, {
            friendStatus: deriveFriendStatus(friendship, safeUserId)
          }) : null
        ];
      })
    );

    const rows = [];
    for (const member of members) {
      const conversation = conversationMap.get(getIdString(member?.conversationId));
      if (!conversation) continue;
      const normalizedConversation = conversation?.type === 'group'
        ? await ensureLegacyGroupConversationMetadata(conversation)
        : conversation;
      const latestVisibleMessage = await chatRepo.findLatestVisibleMessage({
        conversationId: normalizedConversation._id,
        clearedBeforeSeq: member?.clearedBeforeSeq || 0
      });
      rows.push(serializeConversationItem({
        conversation: normalizedConversation,
        member,
        directUser: directConversationUserMap.get(getIdString(normalizedConversation?._id)) || null,
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

  const listGroupsForUser = async ({ userId }) => {
    const result = await listVisibleConversationsForUser({ userId });
    return {
      rows: result.rows.filter((item) => item?.type === 'group')
    };
  };

  const searchGroupConversationByGroupNo = async ({
    userId,
    groupNo
  }) => {
    assertValidUserId(userId);
    const normalizedGroupNo = normalizeGroupNo(groupNo);
    const conversation = await chatRepo.findGroupConversationByGroupNo(normalizedGroupNo);
    if (!conversation) {
      return { group: null };
    }

    return {
      group: await buildGroupSearchResultForUser({
        userId,
        conversation
      })
    };
  };

  const createGroupConversation = async ({
    ownerUserId,
    title,
    announcement = '',
    avatar = DEFAULT_GROUP_AVATAR,
    memberUserIds = []
  }) => {
    const safeOwnerUserId = assertValidUserId(ownerUserId);
    const normalizedTitle = normalizeGroupTitle(title);
    const normalizedAnnouncement = normalizeGroupAnnouncement(announcement);
    const normalizedAvatar = normalizeGroupAvatar(avatar);
    const inviteeUserIds = dedupeUserIds(memberUserIds).filter((item) => item !== safeOwnerUserId);
    const allParticipantUserIds = [safeOwnerUserId, ...inviteeUserIds];

    if (allParticipantUserIds.length > MAX_GROUP_MEMBER_COUNT) {
      throw new SocialChatError(`群成员数量不能超过 ${MAX_GROUP_MEMBER_COUNT} 人`, {
        status: 400,
        code: 'GROUP_MEMBER_COUNT_EXCEEDED'
      });
    }

    await Promise.all([
      ensureUsersExist(allParticipantUserIds),
      assertJoinedExternalGroupQuota(inviteeUserIds, {
        conversationCreatorId: safeOwnerUserId
      }),
      assertGroupCreateQuota(safeOwnerUserId)
    ]);

    const now = new Date();
    const conversation = await createGroupConversationRecord({
      type: 'group',
      title: normalizedTitle,
      announcement: normalizedAnnouncement,
      announcementUpdatedAt: normalizedAnnouncement ? now : null,
      announcementUpdatedBy: normalizedAnnouncement ? safeOwnerUserId : null,
      avatar: normalizedAvatar,
      ownerId: safeOwnerUserId,
      creatorId: safeOwnerUserId,
      memberCount: allParticipantUserIds.length
    });

    if (normalizedAnnouncement) {
      await recordGroupNotice({
        conversationId: conversation._id,
        content: normalizedAnnouncement,
        createdBy: safeOwnerUserId,
        createdAt: now
      });
    }

    await Promise.all(allParticipantUserIds.map((participantUserId) => chatRepo.ensureConversationMember({
      conversationId: conversation._id,
      userId: participantUserId,
      set: {
        role: participantUserId === safeOwnerUserId ? 'owner' : 'member',
        isActive: true,
        isVisible: true,
        leftAt: null,
        deletedAt: null,
        clearedAt: null,
        clearedBeforeSeq: 0,
        lastReadSeq: 0,
        unreadCount: 0,
        updatedAt: now,
        joinedAt: now
      }
    })));

    const detail = await buildGroupDetailForUser({
      userId: safeOwnerUserId,
      conversationId: conversation._id
    });

    return {
      ...detail,
      participantUserIds: allParticipantUserIds
    };
  };

  const getGroupDetailForUser = async ({
    userId,
    conversationId
  }) => buildGroupDetailForUser({
    userId,
    conversationId
  });

  const updateGroupConversation = async ({
    userId,
    conversationId,
    title,
    announcement,
    avatar
  }) => {
    const {
      conversation,
      member,
      userId: safeUserId
    } = await getGroupConversationAccessContext({ userId, conversationId });
    assertGroupOwnerAccess(member);

    const updateSet = {
      updatedAt: new Date()
    };
    let shouldRecordGroupNotice = false;
    let nextAnnouncement = '';
    let announcementUpdatedAt = null;

    if (typeof title === 'string') {
      updateSet.title = normalizeGroupTitle(title);
    }

    if (typeof announcement === 'string') {
      nextAnnouncement = normalizeGroupAnnouncement(announcement);
      announcementUpdatedAt = new Date();
      updateSet.announcement = nextAnnouncement;
      updateSet.announcementUpdatedAt = announcementUpdatedAt;
      updateSet.announcementUpdatedBy = safeUserId;
      shouldRecordGroupNotice = Boolean(nextAnnouncement)
        && nextAnnouncement !== String(conversation?.announcement || '').trim();
    }

    if (typeof avatar === 'string') {
      updateSet.avatar = normalizeGroupAvatar(avatar);
    }

    await chatRepo.updateConversation({
      conversationId: conversation._id,
      update: {
        $set: updateSet
      }
    });

    if (shouldRecordGroupNotice) {
      await recordGroupNotice({
        conversationId: conversation._id,
        content: nextAnnouncement,
        createdBy: safeUserId,
        createdAt: announcementUpdatedAt || new Date()
      });
    }

    const detail = await buildGroupDetailForUser({
      userId: safeUserId,
      conversationId: conversation._id
    });

    const participantUserIds = await listConversationParticipantUserIds({
      conversationId: conversation._id
    });

    return {
      ...detail,
      participantUserIds
    };
  };

  const createGroupNotice = async ({
    userId,
    conversationId,
    content
  }) => {
    const {
      conversation,
      member,
      userId: safeUserId
    } = await getGroupConversationAccessContext({ userId, conversationId });
    assertGroupOwnerAccess(member);

    const normalizedContent = normalizeGroupAnnouncement(content);
    if (!normalizedContent) {
      throw new SocialChatError('群公告不能为空', {
        status: 400,
        code: 'EMPTY_GROUP_NOTICE'
      });
    }

    const createdAt = new Date();
    await recordGroupNotice({
      conversationId: conversation._id,
      content: normalizedContent,
      createdBy: safeUserId,
      createdAt
    });
    await syncConversationAnnouncementFromLatestNotice({
      conversationId: conversation._id,
      fallbackConversation: conversation
    });

    const detail = await buildGroupDetailForUser({
      userId: safeUserId,
      conversationId: conversation._id
    });
    const participantUserIds = await listConversationParticipantUserIds({
      conversationId: conversation._id
    });

    return {
      ...detail,
      participantUserIds
    };
  };

  const deleteGroupNotice = async ({
    userId,
    conversationId,
    noticeId
  }) => {
    const {
      conversation,
      member,
      userId: safeUserId
    } = await getGroupConversationAccessContext({ userId, conversationId });
    assertGroupOwnerAccess(member);

    const notice = await chatRepo.findGroupNoticeById(noticeId);
    if (!notice?._id || getIdString(notice?.conversationId) !== getIdString(conversation?._id)) {
      throw new SocialChatError('群公告不存在', {
        status: 404,
        code: 'GROUP_NOTICE_NOT_FOUND'
      });
    }

    await chatRepo.deleteGroupNoticeById(notice._id);
    await syncConversationAnnouncementFromLatestNotice({
      conversationId: conversation._id,
      fallbackConversation: conversation
    });

    const detail = await buildGroupDetailForUser({
      userId: safeUserId,
      conversationId: conversation._id
    });
    const participantUserIds = await listConversationParticipantUserIds({
      conversationId: conversation._id
    });

    return {
      ...detail,
      participantUserIds,
      deletedNoticeId: getIdString(notice._id)
    };
  };

  const addGroupMembers = async ({
    userId,
    conversationId,
    memberUserIds = []
  }) => {
    const {
      conversation,
      member,
      userId: safeUserId
    } = await getGroupConversationAccessContext({ userId, conversationId });
    assertGroupOwnerAccess(member);

    const targetUserIds = dedupeUserIds(memberUserIds).filter((item) => item !== safeUserId);
    if (targetUserIds.length === 0) {
      throw new SocialChatError('请至少选择一名要加入群聊的成员', {
        status: 400,
        code: 'EMPTY_GROUP_MEMBER_LIST'
      });
    }

    const currentMembers = await chatRepo.listConversationMembersByConversationId(conversation._id, {
      isActive: true
    });
    const activeMemberIdSet = new Set(currentMembers.map((item) => getIdString(item?.userId)));
    const newUserIds = targetUserIds.filter((item) => !activeMemberIdSet.has(item));
    if (newUserIds.length === 0) {
      throw new SocialChatError('所选成员已全部在群聊中', {
        status: 400,
        code: 'GROUP_MEMBERS_ALREADY_INCLUDED'
      });
    }
    if (currentMembers.length + newUserIds.length > MAX_GROUP_MEMBER_COUNT) {
      throw new SocialChatError(`群成员数量不能超过 ${MAX_GROUP_MEMBER_COUNT} 人`, {
        status: 400,
        code: 'GROUP_MEMBER_COUNT_EXCEEDED'
      });
    }

    await Promise.all([
      ensureUsersExist(newUserIds),
      assertJoinedExternalGroupQuota(newUserIds, {
        conversationCreatorId: getConversationCreatorId(conversation)
      })
    ]);

    const now = new Date();
    const currentSeq = Number(conversation?.messageSeq) || 0;
    await Promise.all(newUserIds.map((targetUserId) => chatRepo.ensureConversationMember({
      conversationId: conversation._id,
      userId: targetUserId,
      set: {
        role: 'member',
        isActive: true,
        isVisible: true,
        leftAt: null,
        deletedAt: null,
        clearedAt: currentSeq > 0 ? now : null,
        clearedBeforeSeq: currentSeq,
        lastReadSeq: currentSeq,
        unreadCount: 0,
        updatedAt: now
      },
      setOnInsert: {
        joinedAt: now
      }
    })));

    await syncConversationMemberCount(conversation._id);
    const detail = await buildGroupDetailForUser({
      userId: safeUserId,
      conversationId: conversation._id
    });
    const participantUserIds = await listConversationParticipantUserIds({
      conversationId: conversation._id
    });

    return {
      ...detail,
      participantUserIds,
      addedUserIds: newUserIds
    };
  };

  const inviteGroupMembers = async ({
    userId,
    conversationId,
    inviteeUserIds = []
  }) => {
    const {
      conversation,
      member,
      userId: safeUserId
    } = await getGroupConversationAccessContext({ userId, conversationId });
    assertGroupOwnerAccess(member);

    const targetUserIds = dedupeUserIds(inviteeUserIds).filter((item) => item !== safeUserId);
    if (targetUserIds.length === 0) {
      throw new SocialChatError('请至少选择一名要邀请的成员', {
        status: 400,
        code: 'EMPTY_GROUP_INVITEE_LIST'
      });
    }

    const [currentMembers, inviter] = await Promise.all([
      chatRepo.listConversationMembersByConversationId(conversation._id, {
        isActive: true
      }),
      socialRepo.findUserById(safeUserId, '_id username avatar profession allianceId')
    ]);
    const activeMemberIdSet = new Set(currentMembers.map((item) => getIdString(item?.userId)));
    const candidateUserIds = targetUserIds.filter((item) => !activeMemberIdSet.has(item));
    if (candidateUserIds.length === 0) {
      throw new SocialChatError('所选用户已全部在群聊中', {
        status: 400,
        code: 'GROUP_INVITEES_ALREADY_INCLUDED'
      });
    }

    const { users } = await ensureUsersExist(candidateUserIds);
    const userMap = new Map(users.map((item) => [getIdString(item?._id), item]));
    const invitedUserIds = [];

    for (const inviteeUserId of candidateUserIds) {
      const existingInvitation = await chatRepo.findGroupInvitationByConversationAndInvitee({
        conversationId: conversation._id,
        inviteeId: inviteeUserId
      });
      if (existingInvitation?.status === 'pending') {
        continue;
      }

      if (existingInvitation) {
        existingInvitation.inviterId = safeUserId;
        existingInvitation.status = 'pending';
        existingInvitation.respondedAt = null;
        await existingInvitation.save();
      } else {
        await chatRepo.createGroupInvitation({
          conversationId: conversation._id,
          inviterId: safeUserId,
          inviteeId: inviteeUserId,
          status: 'pending'
        });
      }
      invitedUserIds.push(inviteeUserId);
    }

    if (invitedUserIds.length === 0) {
      throw new SocialChatError('这些用户已经收到待处理邀请', {
        status: 409,
        code: 'GROUP_INVITATION_ALREADY_SENT'
      });
    }

    return {
      conversationId: getIdString(conversation._id),
      invitedUserIds,
      inviter: inviter ? serializeUserSummary(inviter) : null,
      invitees: invitedUserIds.map((item) => serializeUserSummary(userMap.get(item))),
      participantUserIds: currentMembers.map((item) => getIdString(item?.userId)).filter(Boolean)
    };
  };

  const listGroupInvitationsForUser = async ({ userId }) => {
    const safeUserId = assertValidUserId(userId);
    const invitations = await chatRepo.listGroupInvitationsByInvitee({
      inviteeId: safeUserId,
      status: 'pending'
    });
    if (invitations.length === 0) {
      return { received: [] };
    }

    const [conversations, inviters] = await Promise.all([
      chatRepo.listConversationsByIds(invitations.map((item) => item?.conversationId)),
      socialRepo.findUsersByIds(invitations.map((item) => item?.inviterId))
    ]);
    const conversationMap = new Map(conversations.map((item) => [getIdString(item?._id), item]));
    const inviterMap = new Map(inviters.map((item) => [getIdString(item?._id), item]));

    return {
      received: invitations
        .map((item) => serializeGroupInvitationItem({
          invitation: item,
          conversation: conversationMap.get(getIdString(item?.conversationId)) || null,
          inviter: inviterMap.get(getIdString(item?.inviterId)) || null
        }))
        .filter((item) => item?.group?.conversationId)
    };
  };

  const respondToGroupInvitation = async ({
    userId,
    invitationId,
    action
  }) => {
    const safeUserId = assertValidUserId(userId);
    const safeInvitationId = getIdString(invitationId);
    const normalizedAction = String(action || '').trim();

    if (!isValidObjectId(safeInvitationId)) {
      throw new SocialChatError('无效的群聊邀请', {
        status: 400,
        code: 'INVALID_GROUP_INVITATION_ID'
      });
    }
    if (!['accept', 'reject', 'ignore'].includes(normalizedAction)) {
      throw new SocialChatError('无效的邀请操作', {
        status: 400,
        code: 'INVALID_GROUP_INVITATION_ACTION'
      });
    }

    const invitation = await chatRepo.findGroupInvitationById(safeInvitationId);
    if (!invitation) {
      throw new SocialChatError('群聊邀请不存在', {
        status: 404,
        code: 'GROUP_INVITATION_NOT_FOUND'
      });
    }
    if (invitation.status !== 'pending') {
      throw new SocialChatError('该群聊邀请已处理', {
        status: 400,
        code: 'GROUP_INVITATION_ALREADY_RESOLVED'
      });
    }
    if (getIdString(invitation.inviteeId) !== safeUserId) {
      throw new SocialChatError('无权处理该群聊邀请', {
        status: 403,
        code: 'FORBIDDEN_GROUP_INVITATION_ACTION'
      });
    }

    const [conversation, inviter, invitee] = await Promise.all([
      chatRepo.findConversationById(invitation.conversationId),
      socialRepo.findUserById(invitation.inviterId, '_id username avatar profession allianceId'),
      socialRepo.findUserById(invitation.inviteeId, '_id username avatar profession allianceId')
    ]);
    if (!conversation || conversation?.type !== 'group') {
      throw new SocialChatError('群聊不存在', {
        status: 404,
        code: 'GROUP_CONVERSATION_NOT_FOUND'
      });
    }
    if (!inviter || !invitee) {
      throw new SocialChatError('邀请相关用户不存在', {
        status: 400,
        code: 'GROUP_INVITATION_USER_NOT_FOUND'
      });
    }

    let participantUserIds = [];
    if (normalizedAction === 'accept') {
      await assertJoinedExternalGroupQuota([safeUserId], {
        conversationCreatorId: getConversationCreatorId(conversation)
      });
      const currentMembers = await chatRepo.listConversationMembersByConversationId(conversation._id, {
        isActive: true
      });
      const activeMemberIdSet = new Set(currentMembers.map((item) => getIdString(item?.userId)));
      if (!activeMemberIdSet.has(safeUserId)) {
        if (currentMembers.length >= MAX_GROUP_MEMBER_COUNT) {
          throw new SocialChatError(`群成员数量不能超过 ${MAX_GROUP_MEMBER_COUNT} 人`, {
            status: 400,
            code: 'GROUP_MEMBER_COUNT_EXCEEDED'
          });
        }
        const now = new Date();
        const currentSeq = Number(conversation?.messageSeq) || 0;
        await ensureConversationMemberSafely({
          conversationId: conversation._id,
          userId: safeUserId,
          set: {
            role: 'member',
            isActive: true,
            isVisible: true,
            leftAt: null,
            deletedAt: null,
            clearedAt: currentSeq > 0 ? now : null,
            clearedBeforeSeq: currentSeq,
            lastReadSeq: currentSeq,
            unreadCount: 0,
            updatedAt: now
          },
          setOnInsert: {
            joinedAt: now
          }
        });
        await syncConversationMemberCount(conversation._id);
      }
      const nextMembers = await chatRepo.listConversationMembersByConversationId(conversation._id, {
        isActive: true
      });
      participantUserIds = nextMembers.map((item) => getIdString(item?.userId)).filter(Boolean);
    }

    invitation.status = normalizedAction === 'accept'
      ? 'accepted'
      : normalizedAction === 'ignore'
        ? 'ignored'
        : 'rejected';
    invitation.respondedAt = new Date();
    await invitation.save();

    return {
      invitation: serializeGroupInvitationItem({
        invitation,
        conversation,
        inviter
      }),
      action: normalizedAction,
      inviter: serializeUserSummary(inviter),
      invitee: serializeUserSummary(invitee),
      participantUserIds
    };
  };

  const joinGroupConversation = async ({
    userId,
    conversationId = '',
    groupNo = ''
  }) => {
    const safeUserId = assertValidUserId(userId);
    const safeConversationId = getIdString(conversationId);
    const normalizedGroupNo = groupNo ? normalizeGroupNo(groupNo) : '';

    let conversation = null;
    if (safeConversationId && isValidObjectId(safeConversationId)) {
      conversation = await chatRepo.findConversationById(safeConversationId);
    } else if (normalizedGroupNo) {
      conversation = await chatRepo.findGroupConversationByGroupNo(normalizedGroupNo);
    } else {
      throw new SocialChatError('请提供有效的群聊标识', {
        status: 400,
        code: 'GROUP_IDENTIFIER_REQUIRED'
      });
    }

    if (!conversation || conversation?.type !== 'group') {
      throw new SocialChatError('群聊不存在', {
        status: 404,
        code: 'GROUP_CONVERSATION_NOT_FOUND'
      });
    }

    const currentMembers = await chatRepo.listConversationMembersByConversationId(conversation._id, {
      isActive: true
    });
    const activeMemberIdSet = new Set(currentMembers.map((item) => getIdString(item?.userId)));
    const alreadyJoined = activeMemberIdSet.has(safeUserId);

    if (!alreadyJoined) {
      if (currentMembers.length >= MAX_GROUP_MEMBER_COUNT) {
        throw new SocialChatError(`群成员数量不能超过 ${MAX_GROUP_MEMBER_COUNT} 人`, {
          status: 400,
          code: 'GROUP_MEMBER_COUNT_EXCEEDED'
        });
      }

      await assertJoinedExternalGroupQuota([safeUserId], {
        conversationCreatorId: getConversationCreatorId(conversation)
      });

      const now = new Date();
      const currentSeq = Number(conversation?.messageSeq) || 0;
      await ensureConversationMemberSafely({
        conversationId: conversation._id,
        userId: safeUserId,
        set: {
          role: 'member',
          isActive: true,
          isVisible: true,
          leftAt: null,
          deletedAt: null,
          clearedAt: currentSeq > 0 ? now : null,
          clearedBeforeSeq: currentSeq,
          lastReadSeq: currentSeq,
          unreadCount: 0,
          updatedAt: now
        },
        setOnInsert: {
          joinedAt: now
        }
      });
      await syncConversationMemberCount(conversation._id);
    }

    const detail = await buildGroupDetailForUser({
      userId: safeUserId,
      conversationId: conversation._id
    });
    const participantUserIds = await listConversationParticipantUserIds({
      conversationId: conversation._id
    });

    return {
      ...detail,
      participantUserIds,
      alreadyJoined
    };
  };

  const removeGroupMember = async ({
    userId,
    conversationId,
    targetUserId
  }) => {
    const {
      conversation,
      member,
      userId: safeUserId
    } = await getGroupConversationAccessContext({ userId, conversationId });
    assertGroupOwnerAccess(member);

    const safeTargetUserId = getIdString(targetUserId);
    if (!isValidObjectId(safeTargetUserId)) {
      throw new SocialChatError('无效的群成员', {
        status: 400,
        code: 'INVALID_GROUP_MEMBER_ID'
      });
    }
    if (safeTargetUserId === safeUserId) {
      throw new SocialChatError('群主不能直接移除自己，请先转让群主后再退群', {
        status: 400,
        code: 'GROUP_OWNER_REMOVE_SELF_NOT_ALLOWED'
      });
    }

    const targetMember = await chatRepo.findConversationMember({
      conversationId: conversation._id,
      userId: safeTargetUserId,
      isActive: true
    });
    if (!targetMember) {
      throw new SocialChatError('目标成员不在该群聊中', {
        status: 404,
        code: 'GROUP_MEMBER_NOT_FOUND'
      });
    }

    const now = new Date();
    const currentSeq = Number(conversation?.messageSeq) || 0;
    await chatRepo.updateConversationMember({
      conversationId: conversation._id,
      userId: safeTargetUserId,
      update: {
        $set: {
          isActive: false,
          isVisible: false,
          leftAt: now,
          updatedAt: now,
          unreadCount: 0,
          lastReadSeq: currentSeq
        }
      }
    });

    await syncConversationMemberCount(conversation._id);
    const detail = await buildGroupDetailForUser({
      userId: safeUserId,
      conversationId: conversation._id
    });
    const participantUserIds = await listConversationParticipantUserIds({
      conversationId: conversation._id
    });

    return {
      ...detail,
      participantUserIds,
      removedUserId: safeTargetUserId
    };
  };

  const transferGroupOwnership = async ({
    userId,
    conversationId,
    targetUserId
  }) => {
    const {
      conversation,
      member,
      userId: safeUserId
    } = await getGroupConversationAccessContext({ userId, conversationId });
    assertGroupOwnerAccess(member);

    const safeTargetUserId = getIdString(targetUserId);
    if (!isValidObjectId(safeTargetUserId)) {
      throw new SocialChatError('无效的群成员', {
        status: 400,
        code: 'INVALID_GROUP_MEMBER_ID'
      });
    }
    if (safeTargetUserId === safeUserId) {
      throw new SocialChatError('目标成员已经是当前群主', {
        status: 400,
        code: 'GROUP_OWNER_TRANSFER_SELF'
      });
    }

    const targetMember = await chatRepo.findConversationMember({
      conversationId: conversation._id,
      userId: safeTargetUserId,
      isActive: true
    });
    if (!targetMember) {
      throw new SocialChatError('目标成员不在该群聊中', {
        status: 404,
        code: 'GROUP_MEMBER_NOT_FOUND'
      });
    }

    const now = new Date();
    await Promise.all([
      chatRepo.updateConversation({
        conversationId: conversation._id,
        update: {
          $set: {
            ownerId: safeTargetUserId,
            updatedAt: now
          }
        }
      }),
      chatRepo.updateConversationMember({
        conversationId: conversation._id,
        userId: safeUserId,
        update: {
          $set: {
            role: 'member',
            updatedAt: now
          }
        }
      }),
      chatRepo.updateConversationMember({
        conversationId: conversation._id,
        userId: safeTargetUserId,
        update: {
          $set: {
            role: 'owner',
            updatedAt: now
          }
        }
      })
    ]);

    const detail = await buildGroupDetailForUser({
      userId: safeUserId,
      conversationId: conversation._id
    });
    const participantUserIds = await listConversationParticipantUserIds({
      conversationId: conversation._id
    });

    return {
      ...detail,
      participantUserIds,
      newOwnerUserId: safeTargetUserId
    };
  };

  const leaveGroupConversation = async ({
    userId,
    conversationId
  }) => {
    const {
      conversation,
      member,
      userId: safeUserId
    } = await getGroupConversationAccessContext({ userId, conversationId });
    if (member?.role === 'owner') {
      throw new SocialChatError('群主退出前请先转让群主身份', {
        status: 400,
        code: 'GROUP_OWNER_MUST_TRANSFER_FIRST'
      });
    }

    const now = new Date();
    const currentSeq = Number(conversation?.messageSeq) || 0;
    await chatRepo.updateConversationMember({
      conversationId: conversation._id,
      userId: safeUserId,
      update: {
        $set: {
          isActive: false,
          isVisible: false,
          leftAt: now,
          updatedAt: now,
          unreadCount: 0,
          lastReadSeq: currentSeq
        }
      }
    });

    await syncConversationMemberCount(conversation._id);
    const participantUserIds = await listConversationParticipantUserIds({
      conversationId: conversation._id
    });

    return {
      conversationId: getIdString(conversation._id),
      participantUserIds,
      leftUserId: safeUserId,
      conversationHiddenForCurrentUser: true
    };
  };

  const disbandGroupConversation = async ({
    userId,
    conversationId
  }) => {
    const {
      conversation,
      member,
      userId: safeUserId
    } = await getGroupConversationAccessContext({ userId, conversationId });
    assertGroupOwnerAccess(member);

    const participantUserIds = await listConversationParticipantUserIds({
      conversationId: conversation._id
    });
    const now = new Date();
    const currentSeq = Number(conversation?.messageSeq) || 0;

    await Promise.all([
      chatRepo.updateConversation({
        conversationId: conversation._id,
        update: {
          $set: {
            isArchived: true,
            updatedAt: now
          }
        }
      }),
      chatRepo.updateConversationMembers({
        conversationId: conversation._id,
        isActive: true,
        update: {
          $set: {
            isActive: false,
            isVisible: false,
            leftAt: now,
            updatedAt: now,
            unreadCount: 0,
            lastReadSeq: currentSeq
          }
        }
      })
    ]);

    return {
      conversationId: getIdString(conversation._id),
      participantUserIds,
      groupDisbanded: true,
      ownerUserId: safeUserId
    };
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
        directUser = await buildDirectUserSummary({
          currentUserId: safeUserId,
          peerUserId: otherMember.userId
        });
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

  const updateConversationPinnedForUser = async ({
    userId,
    conversationId,
    pinned
  }) => {
    const {
      conversation,
      member,
      userId: safeUserId
    } = await getConversationAccessContext({ userId, conversationId });

    if (typeof pinned !== 'boolean') {
      throw new SocialChatError('置顶状态无效', {
        status: 400,
        code: 'INVALID_CONVERSATION_PINNED_STATE'
      });
    }

    if (!!member?.pinned !== pinned) {
      await chatRepo.updateConversationMember({
        conversationId: conversation._id,
        userId: safeUserId,
        update: {
          $set: {
            pinned,
            updatedAt: new Date()
          }
        }
      });
    }

    return {
      conversation: await serializeConversationForUserView({
        userId: safeUserId,
        conversationId: conversation._id
      })
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
    at
  }) => {
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

    let directUserIds = [];
    if (conversation.type === 'direct') {
      directUserIds = String(conversation.directKey || '').split(':').filter(Boolean);
      if (directUserIds.length !== 2 || !directUserIds.includes(safeUserId)) {
        throw new SocialChatError('私聊会话参与者异常', {
          status: 400,
          code: 'INVALID_DIRECT_CONVERSATION_MEMBERS'
        });
      }
    }

    let temporaryMessageInfo = null;
    if (conversation.type === 'direct') {
      const targetUserId = directUserIds.find((item) => item !== safeUserId) || '';
      const friendship = await socialRepo.findFriendshipByParticipantsKey(buildUserPairKey(safeUserId, targetUserId));
      if (friendship?.status === 'blocked') {
        const isBlockedByCurrentUser = getIdString(friendship?.requesterId) === safeUserId;
        throw new SocialChatError(
          isBlockedByCurrentUser
            ? '你已将对方加入黑名单，请先解除拉黑后再发送消息'
            : '对方已将你加入黑名单，消息已被拒绝',
          {
            status: 403,
            code: 'DIRECT_MESSAGE_BLOCKED'
          }
        );
      }

      if (friendship?.status !== 'accepted') {
        const resetBoundarySeq = friendship?.status === 'rejected'
          ? Math.max(0, Number(friendship?.messageQuotaResetSeq) || 0)
          : 0;
        const sentCount = await chatRepo.countMessagesByConversationAndSender({
          conversationId: conversation._id,
          senderId: safeUserId,
          afterSeq: resetBoundarySeq
        });
        if (sentCount >= MAX_NON_FRIEND_DIRECT_MESSAGES) {
          throw new SocialChatError(`非好友用户最多只能累计发送 ${MAX_NON_FRIEND_DIRECT_MESSAGES} 条临时消息`, {
            status: 403,
            code: 'NON_FRIEND_MESSAGE_LIMIT_REACHED'
          });
        }
        temporaryMessageInfo = {
          usedCount: sentCount + 1,
          remainingCount: Math.max(0, MAX_NON_FRIEND_DIRECT_MESSAGES - sentCount - 1),
          maxCount: MAX_NON_FRIEND_DIRECT_MESSAGES
        };
      }
    }

    const { message } = await persistConversationMessage({
      conversation,
      senderUserId: safeUserId,
      type: normalizedType,
      content: messageContent,
      clientMessageId: normalizedClientMessageId
    });

    const sender = await socialRepo.findUserById(safeUserId, '_id username avatar profession allianceId');
    return {
      conversationId: getIdString(conversation._id),
      message: serializeMessageForUserView(message, sender),
      temporaryMessageInfo
    };
  };

  const shareGroupConversationCard = async ({
    userId,
    conversationId,
    targetUserIds = [],
    targetConversationIds = []
  }) => {
    const {
      conversation,
      userId: safeUserId
    } = await getGroupConversationAccessContext({ userId, conversationId });

    const safeTargetUserIds = dedupeUserIds(targetUserIds).filter((item) => item !== safeUserId);
    const safeTargetConversationIds = dedupeUserIds(targetConversationIds).filter((item) => item !== getIdString(conversation?._id));
    const totalTargetCount = safeTargetUserIds.length + safeTargetConversationIds.length;

    if (totalTargetCount === 0) {
      throw new SocialChatError('请至少选择一个好友或群聊', {
        status: 400,
        code: 'EMPTY_GROUP_SHARE_TARGETS'
      });
    }
    if (totalTargetCount > MAX_GROUP_SHARE_TARGET_COUNT) {
      throw new SocialChatError(`单次最多只能分享给 ${MAX_GROUP_SHARE_TARGET_COUNT} 个目标`, {
        status: 400,
        code: 'GROUP_SHARE_TARGET_LIMIT_EXCEEDED'
      });
    }

    const [sender, friendUserContext] = await Promise.all([
      socialRepo.findUserById(safeUserId, '_id username avatar profession allianceId'),
      ensureUsersExist(safeTargetUserIds, { allowEmpty: true })
    ]);

    for (const targetUserId of safeTargetUserIds) {
      const friendship = await socialRepo.findAcceptedFriendshipByParticipantsKey(buildUserPairKey(safeUserId, targetUserId));
      if (!friendship) {
        throw new SocialChatError('只能将群分享给好友', {
          status: 403,
          code: 'GROUP_SHARE_FRIEND_REQUIRED'
        });
      }
    }

    const targetConversationMap = new Map();

    for (const targetUserId of safeTargetUserIds) {
      const direct = await ensureDirectConversationByUsers({
        requestUserId: safeUserId,
        targetUserId
      });
      const directConversation = await chatRepo.findConversationById(direct.conversation.conversationId);
      if (directConversation?._id) {
        targetConversationMap.set(getIdString(directConversation._id), directConversation);
      }
    }

    for (const targetConversationId of safeTargetConversationIds) {
      const targetContext = await getGroupConversationAccessContext({
        userId: safeUserId,
        conversationId: targetConversationId
      });
      if (targetContext?.conversation?._id) {
        targetConversationMap.set(getIdString(targetContext.conversation._id), targetContext.conversation);
      }
    }

    if (targetConversationMap.size === 0) {
      throw new SocialChatError('没有可发送的目标会话', {
        status: 400,
        code: 'GROUP_SHARE_TARGETS_INVALID'
      });
    }

    const shareCardPayload = buildSharedGroupCardPayload(conversation);
    const deliveries = [];
    for (const targetConversation of targetConversationMap.values()) {
      const targetConversationId = getIdString(targetConversation?._id);
      const { message } = await persistConversationMessage({
        conversation: targetConversation,
        senderUserId: safeUserId,
        type: 'group_share',
        content: buildMessagePreviewText({
          type: 'group_share',
          payload: shareCardPayload
        }),
        clientMessageId: `share:${getIdString(conversation?._id)}:${targetConversationId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        payload: shareCardPayload
      });

      deliveries.push({
        conversationId: targetConversationId,
        participantUserIds: await listConversationParticipantUserIds({
          conversationId: targetConversationId
        }),
        message: serializeMessageForUserView(message, sender)
      });
    }

    return {
      deliveries,
      sharedGroup: {
        conversationId: getIdString(conversation?._id),
        title: conversation?.title || '群聊',
        announcement: conversation?.announcement || '',
        groupNo: String(conversation?.groupNo || '')
      },
      targetCount: deliveries.length,
      targetUserIds: friendUserContext.users.map((item) => getIdString(item?._id)),
      targetConversationIds: Array.from(targetConversationMap.keys())
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
    addGroupMembers,
    createGroupNotice,
    createDirectConversation,
    createGroupConversation,
    deleteGroupNotice,
    ensureDirectConversationByUsers,
    ensureDirectConversationForFriends: ensureDirectConversationByUsers,
    getConversationAccessContext,
    getGroupConversationAccessContext,
    getGroupDetailForUser,
    hideConversationForUser,
    inviteGroupMembers,
    joinGroupConversation,
    disbandGroupConversation,
    leaveGroupConversation,
    listConversationParticipantUserIds,
    listGroupInvitationsForUser,
    listGroupsForUser,
    listMessagesForUserView,
    listVisibleConversationsForUser,
    markConversationReadForUser,
    reactivateConversationForRecipientOnIncomingMessage,
    removeGroupMember,
    respondToGroupInvitation,
    searchGroupConversationByGroupNo,
    serializeConversationForUserView,
    sendMessage,
    shareGroupConversationCard,
    transferGroupOwnership,
    updateConversationPinnedForUser,
    updateGroupConversation
  };
};

module.exports = {
  chatService: createChatService(),
  createChatService
};
