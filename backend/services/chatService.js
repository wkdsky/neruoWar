const socialRepository = require('../repositories/socialRepository');
const chatRepository = require('../repositories/chatRepository');
const {
  MAX_DIRECT_MESSAGE_LENGTH,
  MAX_GROUP_ANNOUNCEMENT_LENGTH,
  MAX_GROUP_MEMBER_COUNT,
  MAX_GROUP_MEMBERSHIP_COUNT,
  MAX_GROUP_TITLE_LENGTH
} = require('../constants/socialChat');
const SocialChatError = require('./socialChatError');
const {
  buildUserPairKey,
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

  const dedupeUserIds = (values = []) => Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((item) => getIdString(item))
      .filter((item) => isValidObjectId(item))
  ));

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

  const assertGroupMembershipQuota = async (userIds = []) => {
    for (const userId of dedupeUserIds(userIds)) {
      const count = await countActiveGroupMembershipsForUser(userId);
      if (count >= MAX_GROUP_MEMBERSHIP_COUNT) {
        const user = await socialRepo.findUserById(userId, '_id username');
        throw new SocialChatError(
          `${user?.username || '该用户'}加入的群聊数量已达上限，当前最多支持 ${MAX_GROUP_MEMBERSHIP_COUNT} 个群聊`,
          {
            status: 400,
            code: 'GROUP_MEMBERSHIP_LIMIT_REACHED'
          }
        );
      }
    }
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

    const members = await chatRepo.listConversationMembersByConversationId(conversation._id, {
      isActive: true
    });
    const users = await socialRepo.findUsersByIds(members.map((item) => item?.userId));
    const userMap = new Map(users.map((item) => [getIdString(item?._id), item]));
    const latestVisibleMessage = await chatRepo.findLatestVisibleMessage({
      conversationId: conversation._id,
      clearedBeforeSeq: member?.clearedBeforeSeq || 0
    });

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
        announcement: conversation?.announcement || '',
        ownerId: getIdString(conversation?.ownerId),
        memberCount: Number(conversation?.memberCount) || sortedMembers.length,
        currentUserRole: member?.role || 'member',
        canManage: member?.role === 'owner',
        canLeave: member?.role !== 'owner',
        members: sortedMembers.map((item) => serializeGroupMemberItem({
          member: item,
          user: userMap.get(getIdString(item?.userId)) || null
        }))
      }
    };
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
      buildDirectUserSummary({
        currentUserId: safeRequestUserId,
        peerUserId: safeTargetUserId
      })
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

  const listGroupsForUser = async ({ userId }) => {
    const result = await listVisibleConversationsForUser({ userId });
    return {
      rows: result.rows.filter((item) => item?.type === 'group')
    };
  };

  const createGroupConversation = async ({
    ownerUserId,
    title,
    announcement = '',
    memberUserIds = []
  }) => {
    const safeOwnerUserId = assertValidUserId(ownerUserId);
    const normalizedTitle = normalizeGroupTitle(title);
    const normalizedAnnouncement = normalizeGroupAnnouncement(announcement);
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
      assertGroupMembershipQuota(allParticipantUserIds)
    ]);

    const now = new Date();
    const conversation = await chatRepo.createConversation({
      type: 'group',
      title: normalizedTitle,
      announcement: normalizedAnnouncement,
      announcementUpdatedAt: normalizedAnnouncement ? now : null,
      announcementUpdatedBy: normalizedAnnouncement ? safeOwnerUserId : null,
      ownerId: safeOwnerUserId,
      memberCount: allParticipantUserIds.length
    });

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
    announcement
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

    if (typeof title === 'string') {
      updateSet.title = normalizeGroupTitle(title);
    }

    if (typeof announcement === 'string') {
      updateSet.announcement = normalizeGroupAnnouncement(announcement);
      updateSet.announcementUpdatedAt = new Date();
      updateSet.announcementUpdatedBy = safeUserId;
    }

    await chatRepo.updateConversation({
      conversationId: conversation._id,
      update: {
        $set: updateSet
      }
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
      assertGroupMembershipQuota(newUserIds)
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

    if (conversation.type === 'direct') {
      const directUserIds = String(conversation.directKey || '').split(':').filter(Boolean);
      if (directUserIds.length !== 2 || !directUserIds.includes(safeUserId)) {
        throw new SocialChatError('私聊会话参与者异常', {
          status: 400,
          code: 'INVALID_DIRECT_CONVERSATION_MEMBERS'
        });
      }
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
    createDirectConversation,
    createGroupConversation,
    ensureDirectConversationByUsers,
    ensureDirectConversationForFriends: ensureDirectConversationByUsers,
    getConversationAccessContext,
    getGroupConversationAccessContext,
    getGroupDetailForUser,
    hideConversationForUser,
    leaveGroupConversation,
    listConversationParticipantUserIds,
    listGroupsForUser,
    listMessagesForUserView,
    listVisibleConversationsForUser,
    markConversationReadForUser,
    reactivateConversationForRecipientOnIncomingMessage,
    removeGroupMember,
    serializeConversationForUserView,
    sendMessage,
    transferGroupOwnership,
    updateGroupConversation
  };
};

module.exports = {
  chatService: createChatService(),
  createChatService
};
