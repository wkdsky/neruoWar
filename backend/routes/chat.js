const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const SocialChatError = require('../services/socialChatError');
const { chatService } = require('../services/chatService');
const { emitToUser, emitToUsers } = require('../services/socketGateway');

const router = express.Router();
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const normalizeConversationId = (value) => {
  const normalizedValue = typeof value === 'string'
    ? value.trim()
    : value?.toString?.().trim?.() || '';
  return OBJECT_ID_PATTERN.test(normalizedValue) ? normalizedValue : '';
};

const handleRouteError = (res, error, context = '聊天接口错误') => {
  if (error instanceof SocialChatError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      details: error.details || null
    });
  }

  console.error(context, error);
  return res.status(500).json({
    error: '服务器错误',
    code: 'INTERNAL_SERVER_ERROR'
  });
};

const emitConversationUpserts = async (userIds = [], conversationId) => {
  const entries = await Promise.all(
    (Array.isArray(userIds) ? userIds : []).map(async (participantUserId) => {
      try {
        const conversation = await chatService.serializeConversationForUserView({
          userId: participantUserId,
          conversationId
        });
        return [participantUserId, conversation];
      } catch (_error) {
        return null;
      }
    })
  );

  const conversationEntryMap = new Map(entries.filter(Boolean));
  emitToUsers(Array.from(conversationEntryMap.keys()), 'chat:conversation-upsert', (participantUserId) => ({
    conversation: conversationEntryMap.get(participantUserId) || null,
    emittedAt: new Date().toISOString()
  }));
};

const emitGroupUpdated = (userIds = [], conversationId) => {
  const safeConversationId = normalizeConversationId(conversationId);
  if (!safeConversationId) return;
  emitToUsers(userIds, 'chat:group-updated', {
    conversationId: safeConversationId,
    emittedAt: new Date().toISOString()
  });
};

const emitGroupInvitationUpdated = (userIds = [], conversationId = '') => {
  const safeConversationId = normalizeConversationId(conversationId);
  emitToUsers(userIds, 'chat:group-invitation-updated', {
    conversationId: safeConversationId,
    emittedAt: new Date().toISOString()
  });
};

router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.listVisibleConversationsForUser({
      userId: req?.user?.userId
    });
    return res.json({
      success: true,
      rows: result.rows
    });
  } catch (error) {
    return handleRouteError(res, error, '获取会话列表错误:');
  }
});

router.post('/conversations/direct/:targetUserId', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.ensureDirectConversationByUsers({
      requestUserId: req?.user?.userId,
      targetUserId: req.params?.targetUserId
    });
    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '获取或创建私聊会话错误:');
  }
});

router.get('/groups', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.listGroupsForUser({
      userId: req?.user?.userId
    });
    return res.json({
      success: true,
      rows: result.rows
    });
  } catch (error) {
    return handleRouteError(res, error, '获取群聊列表错误:');
  }
});

router.post('/groups', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.createGroupConversation({
      ownerUserId: req?.user?.userId,
      title: req.body?.title,
      announcement: req.body?.announcement,
      memberUserIds: req.body?.memberUserIds
    });

    await emitConversationUpserts(result.participantUserIds, result.group.conversationId);
    emitGroupUpdated(result.participantUserIds, result.group.conversationId);

    return res.json({
      success: true,
      conversation: result.conversation,
      group: result.group
    });
  } catch (error) {
    return handleRouteError(res, error, '创建群聊错误:');
  }
});

router.get('/groups/invitations', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.listGroupInvitationsForUser({
      userId: req?.user?.userId
    });
    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '获取群聊邀请列表错误:');
  }
});

router.get('/groups/:conversationId', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.getGroupDetailForUser({
      userId: req?.user?.userId,
      conversationId: req.params?.conversationId
    });
    return res.json({
      success: true,
      conversation: result.conversation,
      group: result.group
    });
  } catch (error) {
    return handleRouteError(res, error, '获取群聊详情错误:');
  }
});

router.post('/groups/:conversationId/invitations', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.inviteGroupMembers({
      userId: req?.user?.userId,
      conversationId: req.params?.conversationId,
      inviteeUserIds: req.body?.inviteeUserIds
    });

    emitGroupInvitationUpdated([
      ...result.invitedUserIds,
      ...result.participantUserIds
    ], result.conversationId);

    return res.json({
      success: true,
      conversationId: result.conversationId,
      invitedUserIds: result.invitedUserIds
    });
  } catch (error) {
    return handleRouteError(res, error, '发送群聊邀请错误:');
  }
});

router.post('/groups/invitations/:invitationId/respond', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.respondToGroupInvitation({
      userId: req?.user?.userId,
      invitationId: req.params?.invitationId,
      action: req.body?.action
    });

    emitGroupInvitationUpdated([
      result?.inviter?._id,
      result?.invitee?._id
    ], result?.invitation?.conversationId || '');
    if (result.action === 'accept' && result.participantUserIds.length > 0) {
      await emitConversationUpserts(result.participantUserIds, result.invitation.conversationId);
      emitGroupUpdated(result.participantUserIds, result.invitation.conversationId);
    }

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '处理群聊邀请错误:');
  }
});

router.patch('/groups/:conversationId', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.updateGroupConversation({
      userId: req?.user?.userId,
      conversationId: req.params?.conversationId,
      title: req.body?.title,
      announcement: req.body?.announcement
    });

    await emitConversationUpserts(result.participantUserIds, result.group.conversationId);
    emitGroupUpdated(result.participantUserIds, result.group.conversationId);

    return res.json({
      success: true,
      conversation: result.conversation,
      group: result.group
    });
  } catch (error) {
    return handleRouteError(res, error, '更新群聊错误:');
  }
});

router.post('/groups/:conversationId/members', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.addGroupMembers({
      userId: req?.user?.userId,
      conversationId: req.params?.conversationId,
      memberUserIds: req.body?.memberUserIds
    });

    await emitConversationUpserts(result.participantUserIds, result.group.conversationId);
    emitGroupUpdated(result.participantUserIds, result.group.conversationId);

    return res.json({
      success: true,
      conversation: result.conversation,
      group: result.group,
      addedUserIds: result.addedUserIds
    });
  } catch (error) {
    return handleRouteError(res, error, '添加群成员错误:');
  }
});

router.delete('/groups/:conversationId/members/:targetUserId', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.removeGroupMember({
      userId: req?.user?.userId,
      conversationId: req.params?.conversationId,
      targetUserId: req.params?.targetUserId
    });

    await emitConversationUpserts(result.participantUserIds, result.group.conversationId);
    emitGroupUpdated(result.participantUserIds, result.group.conversationId);
    emitToUser(result.removedUserId, 'chat:conversation-hidden', {
      conversationId: result.group.conversationId,
      conversationHiddenForCurrentUser: true,
      emittedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      conversation: result.conversation,
      group: result.group,
      removedUserId: result.removedUserId
    });
  } catch (error) {
    return handleRouteError(res, error, '移除群成员错误:');
  }
});

router.post('/groups/:conversationId/transfer', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.transferGroupOwnership({
      userId: req?.user?.userId,
      conversationId: req.params?.conversationId,
      targetUserId: req.body?.targetUserId
    });

    await emitConversationUpserts(result.participantUserIds, result.group.conversationId);
    emitGroupUpdated(result.participantUserIds, result.group.conversationId);

    return res.json({
      success: true,
      conversation: result.conversation,
      group: result.group,
      newOwnerUserId: result.newOwnerUserId
    });
  } catch (error) {
    return handleRouteError(res, error, '转让群主错误:');
  }
});

router.post('/groups/:conversationId/leave', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.leaveGroupConversation({
      userId: req?.user?.userId,
      conversationId: req.params?.conversationId
    });

    await emitConversationUpserts(result.participantUserIds, result.conversationId);
    emitGroupUpdated(result.participantUserIds, result.conversationId);
    emitToUser(result.leftUserId, 'chat:conversation-hidden', {
      conversationId: result.conversationId,
      conversationHiddenForCurrentUser: true,
      emittedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '退出群聊错误:');
  }
});

router.get('/conversations/:conversationId/messages', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.listMessagesForUserView({
      userId: req?.user?.userId,
      conversationId: req.params?.conversationId,
      beforeSeq: req.query?.beforeSeq,
      limit: req.query?.limit
    });
    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '获取会话消息错误:');
  }
});

router.post('/conversations/:conversationId/messages', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.sendMessage({
      userId: req?.user?.userId,
      conversationId: req.params?.conversationId,
      type: req.body?.type,
      content: req.body?.content,
      clientMessageId: req.body?.clientMessageId
    });

    const participantUserIds = await chatService.listConversationParticipantUserIds({
      conversationId: result.conversationId
    });
    const conversationEntries = await Promise.all(
      participantUserIds.map(async (participantUserId) => ([
        participantUserId,
        await chatService.serializeConversationForUserView({
          userId: participantUserId,
          conversationId: result.conversationId
        })
      ]))
    );
    const conversationEntryMap = new Map(conversationEntries);

    emitToUsers(participantUserIds, 'chat:message', (participantUserId) => ({
      conversation: conversationEntryMap.get(participantUserId) || null,
      message: result.message,
      emittedAt: new Date().toISOString()
    }));

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '发送会话消息错误:');
  }
});

router.post('/conversations/:conversationId/read', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.markConversationReadForUser({
      userId: req?.user?.userId,
      conversationId: req.params?.conversationId,
      lastReadSeq: req.body?.lastReadSeq
    });

    emitToUser(req?.user?.userId, 'chat:conversation-read', {
      ...result,
      emittedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '标记会话已读错误:');
  }
});

router.delete('/conversations/:conversationId', authenticateToken, async (req, res) => {
  try {
    const result = await chatService.hideConversationForUser({
      userId: req?.user?.userId,
      conversationId: req.params?.conversationId
    });

    emitToUser(req?.user?.userId, 'chat:conversation-hidden', {
      ...result,
      emittedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '删除私聊会话错误:');
  }
});

module.exports = router;
