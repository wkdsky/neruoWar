const SocialChatError = require('./socialChatError');
const socialRepository = require('../repositories/socialRepository');
const chatRepository = require('../repositories/chatRepository');
const { MAX_FRIEND_COUNT } = require('../constants/socialChat');
const {
  buildUserPairKey,
  getIdString,
  isValidObjectId,
  sendNotificationToUser,
  serializeFriendItem,
  serializeUserSummary
} = require('./socialChatService');

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const createSocialService = ({
  socialRepo = socialRepository,
  chatRepo = chatRepository,
  notificationSender = sendNotificationToUser
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

  const searchUsers = async ({ requestUserId, keyword, limit = 20 }) => {
    const safeUserId = assertValidUserId(requestUserId);
    const trimmedKeyword = String(keyword || '').trim();
    if (!trimmedKeyword) {
      return { rows: [] };
    }

    const keywordRegex = new RegExp(escapeRegex(trimmedKeyword), 'i');
    const rows = await socialRepo.searchUsersByKeyword({
      excludeUserId: safeUserId,
      keywordRegex,
      limit: Math.max(1, Math.min(50, parseInt(limit, 10) || 20))
    });

    const friendshipKeys = rows.map((item) => buildUserPairKey(safeUserId, item?._id));
    const friendshipRows = await socialRepo.listFriendshipsByParticipantsKeys(friendshipKeys);
    const friendshipMap = new Map(friendshipRows.map((item) => [item.participantsKey, item]));

    const allianceRows = await socialRepo.findAllianceNamesByIds(rows.map((item) => item?.allianceId));
    const allianceMap = new Map(allianceRows.map((item) => [getIdString(item?._id), item?.name || '']));

    return {
      rows: rows.map((item) => {
        const friendship = friendshipMap.get(buildUserPairKey(safeUserId, item?._id));
        let friendStatus = 'none';
        if (friendship?.status === 'accepted') {
          friendStatus = 'friend';
        } else if (friendship?.status === 'blocked') {
          friendStatus = 'blocked';
        } else if (friendship?.status === 'pending') {
          friendStatus = getIdString(friendship?.requesterId) === safeUserId ? 'pending_sent' : 'pending_received';
        }

        return {
          ...serializeUserSummary(item, {
            allianceName: allianceMap.get(getIdString(item?.allianceId)) || ''
          }),
          friendStatus
        };
      })
    };
  };

  const requestFriendship = async ({ requesterId, targetUserId, message = '' }) => {
    const safeRequesterId = assertValidUserId(requesterId);
    const safeTargetUserId = getIdString(targetUserId);
    const requestMessage = String(message || '').trim().slice(0, 120);

    if (!isValidObjectId(safeTargetUserId)) {
      throw new SocialChatError('无效的目标用户', {
        status: 400,
        code: 'INVALID_TARGET_USER_ID'
      });
    }
    if (safeRequesterId === safeTargetUserId) {
      throw new SocialChatError('不能添加自己为好友', {
        status: 400,
        code: 'SELF_FRIEND_REQUEST_NOT_ALLOWED'
      });
    }

    const [requester, targetUser] = await Promise.all([
      socialRepo.findUserById(safeRequesterId, '_id username'),
      socialRepo.findUserById(safeTargetUserId, '_id username')
    ]);
    if (!requester || !targetUser) {
      throw new SocialChatError('目标用户不存在', {
        status: 404,
        code: 'TARGET_USER_NOT_FOUND'
      });
    }

    const requesterFriendCount = await socialRepo.countAcceptedFriendshipsForUser(safeRequesterId);
    if (requesterFriendCount >= MAX_FRIEND_COUNT) {
      throw new SocialChatError(`好友数量已达上限，当前最多支持 ${MAX_FRIEND_COUNT} 个好友`, {
        status: 400,
        code: 'FRIEND_LIMIT_REACHED'
      });
    }

    const pairKey = buildUserPairKey(safeRequesterId, safeTargetUserId);
    let friendship = await socialRepo.findFriendshipByParticipantsKey(pairKey);

    if (friendship?.status === 'accepted') {
      throw new SocialChatError('你们已经是好友', {
        status: 409,
        code: 'ALREADY_FRIENDS'
      });
    }
    if (friendship?.status === 'blocked') {
      throw new SocialChatError('当前无法发起好友申请', {
        status: 403,
        code: 'FRIEND_REQUEST_BLOCKED'
      });
    }
    if (friendship?.status === 'pending') {
      if (getIdString(friendship.requesterId) === safeRequesterId) {
        throw new SocialChatError('好友申请已发送，请等待对方处理', {
          status: 409,
          code: 'FRIEND_REQUEST_ALREADY_SENT'
        });
      }
      throw new SocialChatError('对方已向你发送好友申请，请直接处理该申请', {
        status: 409,
        code: 'FRIEND_REQUEST_ALREADY_RECEIVED'
      });
    }

    if (!friendship) {
      friendship = await socialRepo.createFriendship({
        requesterId: safeRequesterId,
        addresseeId: safeTargetUserId,
        participantsKey: pairKey,
        status: 'pending',
        requestMessage
      });
    } else {
      friendship.requesterId = safeRequesterId;
      friendship.addresseeId = safeTargetUserId;
      friendship.status = 'pending';
      friendship.requestMessage = requestMessage;
      friendship.acceptedAt = null;
      friendship.respondedAt = null;
      await friendship.save();
    }

    await notificationSender(safeTargetUserId, {
      type: 'friend_request',
      title: `新的好友申请：${requester.username}`,
      message: requestMessage || `${requester.username} 向你发送了好友申请`,
      read: false,
      status: 'pending',
      inviterId: requester._id,
      inviterUsername: requester.username,
      inviteeId: targetUser._id,
      inviteeUsername: targetUser.username,
      applicationReason: requestMessage,
      payload: {
        friendshipId: getIdString(friendship._id)
      }
    });

    return {
      friendship: {
        friendshipId: getIdString(friendship._id),
        status: friendship.status,
        requestMessage: friendship.requestMessage,
        requesterId: getIdString(friendship.requesterId),
        addresseeId: getIdString(friendship.addresseeId),
        createdAt: friendship.createdAt
      },
      requester: serializeUserSummary(requester),
      addressee: serializeUserSummary(targetUser)
    };
  };

  const listFriendRequests = async ({ userId }) => {
    const safeUserId = assertValidUserId(userId);
    const [received, sent] = await Promise.all([
      socialRepo.listPendingFriendshipsForUser({ userId: safeUserId, direction: 'received' }),
      socialRepo.listPendingFriendshipsForUser({ userId: safeUserId, direction: 'sent' })
    ]);

    const users = await socialRepo.findUsersByIds([
      ...received.map((item) => item.requesterId),
      ...sent.map((item) => item.addresseeId)
    ]);
    const userMap = new Map(users.map((item) => [getIdString(item?._id), item]));

    return {
      received: received.map((item) => serializeFriendItem({
        friendship: item,
        currentUserId: safeUserId,
        otherUser: serializeUserSummary(userMap.get(getIdString(item?.requesterId)))
      })),
      sent: sent.map((item) => serializeFriendItem({
        friendship: item,
        currentUserId: safeUserId,
        otherUser: serializeUserSummary(userMap.get(getIdString(item?.addresseeId)))
      }))
    };
  };

  const respondToFriendRequest = async ({ userId, friendshipId, action }) => {
    const safeUserId = assertValidUserId(userId);
    const safeFriendshipId = getIdString(friendshipId);
    const normalizedAction = String(action || '').trim();

    if (!isValidObjectId(safeFriendshipId)) {
      throw new SocialChatError('无效的好友申请', {
        status: 400,
        code: 'INVALID_FRIENDSHIP_ID'
      });
    }
    if (!['accept', 'reject'].includes(normalizedAction)) {
      throw new SocialChatError('无效的操作类型', {
        status: 400,
        code: 'INVALID_FRIENDSHIP_ACTION'
      });
    }

    const friendship = await socialRepo.findFriendshipById(safeFriendshipId);
    if (!friendship) {
      throw new SocialChatError('好友申请不存在', {
        status: 404,
        code: 'FRIENDSHIP_NOT_FOUND'
      });
    }
    if (friendship.status !== 'pending') {
      throw new SocialChatError('该好友申请已处理', {
        status: 400,
        code: 'FRIENDSHIP_ALREADY_RESOLVED'
      });
    }
    if (getIdString(friendship.addresseeId) !== safeUserId) {
      throw new SocialChatError('无权处理该好友申请', {
        status: 403,
        code: 'FORBIDDEN_FRIENDSHIP_ACTION'
      });
    }

    const [requester, addressee] = await Promise.all([
      socialRepo.findUserById(friendship.requesterId, '_id username'),
      socialRepo.findUserById(friendship.addresseeId, '_id username')
    ]);
    if (!requester || !addressee) {
      throw new SocialChatError('申请相关用户不存在', {
        status: 400,
        code: 'FRIENDSHIP_USER_NOT_FOUND'
      });
    }

    if (normalizedAction === 'accept') {
      const [requesterFriendCount, addresseeFriendCount] = await Promise.all([
        socialRepo.countAcceptedFriendshipsForUser(requester._id),
        socialRepo.countAcceptedFriendshipsForUser(addressee._id)
      ]);
      if (requesterFriendCount >= MAX_FRIEND_COUNT) {
        throw new SocialChatError(`对方好友数量已达上限，当前最多支持 ${MAX_FRIEND_COUNT} 个好友`, {
          status: 400,
          code: 'TARGET_FRIEND_LIMIT_REACHED'
        });
      }
      if (addresseeFriendCount >= MAX_FRIEND_COUNT) {
        throw new SocialChatError(`你的好友数量已达上限，当前最多支持 ${MAX_FRIEND_COUNT} 个好友`, {
          status: 400,
          code: 'FRIEND_LIMIT_REACHED'
        });
      }
    }

    friendship.status = normalizedAction === 'accept' ? 'accepted' : 'rejected';
    friendship.respondedAt = new Date();
    friendship.acceptedAt = normalizedAction === 'accept' ? new Date() : null;
    await friendship.save();

    await notificationSender(requester._id, {
      type: 'friend_request_result',
      title: `好友申请${normalizedAction === 'accept' ? '已通过' : '被拒绝'}`,
      message: `${addressee.username}${normalizedAction === 'accept' ? '已同意' : '已拒绝'}你的好友申请`,
      read: false,
      status: normalizedAction === 'accept' ? 'accepted' : 'rejected',
      inviterId: requester._id,
      inviterUsername: requester.username,
      inviteeId: addressee._id,
      inviteeUsername: addressee.username,
      respondedAt: friendship.respondedAt,
      payload: {
        friendshipId: getIdString(friendship._id)
      }
    });

    return {
      friendship: {
        friendshipId: getIdString(friendship._id),
        requesterId: getIdString(friendship.requesterId),
        addresseeId: getIdString(friendship.addresseeId),
        status: friendship.status,
        respondedAt: friendship.respondedAt,
        acceptedAt: friendship.acceptedAt
      },
      requester: serializeUserSummary(requester),
      addressee: serializeUserSummary(addressee)
    };
  };

  const listFriends = async ({ userId }) => {
    const safeUserId = assertValidUserId(userId);
    const friendships = await socialRepo.listAcceptedFriendshipsForUser(safeUserId);
    const otherUserIds = friendships.map((item) => (
      getIdString(item?.requesterId) === safeUserId ? item?.addresseeId : item?.requesterId
    ));
    const users = await socialRepo.findUsersByIds(otherUserIds);
    const userMap = new Map(users.map((item) => [getIdString(item?._id), item]));

    const directKeys = friendships.map((item) => buildUserPairKey(item?.requesterId, item?.addresseeId));
    const conversations = await chatRepo.listDirectConversationsByKeys(directKeys);
    const conversationMap = new Map(conversations.map((item) => [item.directKey, item]));
    const conversationMembers = await chatRepo.listConversationMembersByUser({
      userId: safeUserId,
      isActive: true,
      isVisible: null
    });
    const memberMap = new Map(conversationMembers.map((item) => [getIdString(item?.conversationId), item]));

    return {
      rows: friendships.map((item) => {
        const otherUserId = getIdString(item?.requesterId) === safeUserId
          ? getIdString(item?.addresseeId)
          : getIdString(item?.requesterId);
        const directKey = buildUserPairKey(item?.requesterId, item?.addresseeId);
        const conversation = conversationMap.get(directKey) || null;
        const member = conversation ? memberMap.get(getIdString(conversation?._id)) || null : null;

        return serializeFriendItem({
          friendship: item,
          currentUserId: safeUserId,
          otherUser: serializeUserSummary(userMap.get(otherUserId)),
          conversation,
          conversationMember: member
        });
      })
    };
  };

  return {
    listFriends,
    listFriendRequests,
    requestFriendship,
    respondToFriendRequest,
    searchUsers
  };
};

module.exports = {
  createSocialService,
  socialService: createSocialService()
};
