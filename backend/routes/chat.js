const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const SocialChatError = require('../services/socialChatError');
const { chatService } = require('../services/chatService');
const { emitToUser, emitToUsers } = require('../services/socketGateway');

const router = express.Router();

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
    const result = await chatService.ensureDirectConversationForFriends({
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
