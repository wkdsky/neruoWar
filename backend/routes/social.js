const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const SocialChatError = require('../services/socialChatError');
const { socialService } = require('../services/socialService');
const { chatService } = require('../services/chatService');
const { emitToUser } = require('../services/socketGateway');

const router = express.Router();

const handleRouteError = (res, error, context = '社交接口错误') => {
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

const emitDirectConversationUpserts = async (userIds = [], conversationId = '') => {
  if (!conversationId) return;
  await Promise.all((Array.isArray(userIds) ? userIds : []).map(async (userId) => {
    try {
      const conversation = await chatService.serializeConversationForUserView({
        userId,
        conversationId
      });
      emitToUser(userId, 'chat:conversation-upsert', {
        conversation,
        emittedAt: new Date().toISOString()
      });
    } catch (_error) {
      // ignore users without visible access
    }
  }));
};

const ensureVisibleDirectConversationForUsers = async (userIdA, userIdB) => {
  const first = await chatService.ensureDirectConversationByUsers({
    requestUserId: userIdA,
    targetUserId: userIdB
  });
  const second = await chatService.ensureDirectConversationByUsers({
    requestUserId: userIdB,
    targetUserId: userIdA
  });
  return first?.conversation?.conversationId || second?.conversation?.conversationId || '';
};

router.get('/users/search', authenticateToken, async (req, res) => {
  try {
    const result = await socialService.searchUsers({
      requestUserId: req?.user?.userId,
      keyword: req.query?.keyword,
      limit: req.query?.limit
    });
    return res.json({
      success: true,
      rows: result.rows
    });
  } catch (error) {
    return handleRouteError(res, error, '搜索社交用户错误:');
  }
});

router.post('/friends/request', authenticateToken, async (req, res) => {
  try {
    const result = await socialService.requestFriendship({
      requesterId: req?.user?.userId,
      targetUserId: req.body?.targetUserId,
      message: req.body?.message
    });

    const emittedAt = new Date().toISOString();
    emitToUser(result?.addressee?._id, 'social:friend-request-created', {
      friendship: result.friendship,
      requester: result.requester,
      addressee: result.addressee,
      emittedAt
    });
    emitToUser(result?.requester?._id, 'social:friend-request-created', {
      friendship: result.friendship,
      requester: result.requester,
      addressee: result.addressee,
      emittedAt
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '发起好友申请错误:');
  }
});

router.get('/friends/requests', authenticateToken, async (req, res) => {
  try {
    const result = await socialService.listFriendRequests({
      userId: req?.user?.userId
    });
    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '获取好友申请列表错误:');
  }
});

router.post('/friends/:friendshipId/respond', authenticateToken, async (req, res) => {
  try {
    const result = await socialService.respondToFriendRequest({
      userId: req?.user?.userId,
      friendshipId: req.params?.friendshipId,
      action: req.body?.action
    });

    const emittedAt = new Date().toISOString();
    const eventName = result?.friendship?.action === 'ignore'
      ? 'social:relationship-updated'
      : 'social:friend-request-responded';
    emitToUser(result?.requester?._id, eventName, {
      friendship: result.friendship,
      requester: result.requester,
      addressee: result.addressee,
      emittedAt
    });
    emitToUser(result?.addressee?._id, eventName, {
      friendship: result.friendship,
      requester: result.requester,
      addressee: result.addressee,
      emittedAt
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '处理好友申请错误:');
  }
});

router.delete('/friends/:friendshipId', authenticateToken, async (req, res) => {
  try {
    const result = await socialService.removeFriend({
      userId: req?.user?.userId,
      friendshipId: req.params?.friendshipId
    });

    const conversationId = await ensureVisibleDirectConversationForUsers(
      result?.requester?._id,
      result?.addressee?._id
    );
    if (conversationId) {
      await emitDirectConversationUpserts([
        result?.requester?._id,
        result?.addressee?._id
      ], conversationId);
    }

    const emittedAt = new Date().toISOString();
    emitToUser(result?.requester?._id, 'social:relationship-updated', {
      friendship: result.friendship,
      requester: result.requester,
      addressee: result.addressee,
      emittedAt
    });
    emitToUser(result?.addressee?._id, 'social:relationship-updated', {
      friendship: result.friendship,
      requester: result.requester,
      addressee: result.addressee,
      emittedAt
    });

    return res.json({
      success: true,
      conversationId,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '删除好友错误:');
  }
});

router.post('/blocks', authenticateToken, async (req, res) => {
  try {
    const result = await socialService.blockUser({
      userId: req?.user?.userId,
      targetUserId: req.body?.targetUserId,
      friendshipId: req.body?.friendshipId
    });

    const conversationId = await ensureVisibleDirectConversationForUsers(
      result?.requester?._id,
      result?.addressee?._id
    );
    if (conversationId) {
      await emitDirectConversationUpserts([
        result?.requester?._id,
        result?.addressee?._id
      ], conversationId);
    }

    const emittedAt = new Date().toISOString();
    emitToUser(result?.requester?._id, 'social:relationship-updated', {
      friendship: result.friendship,
      requester: result.requester,
      addressee: result.addressee,
      emittedAt
    });
    emitToUser(result?.addressee?._id, 'social:relationship-updated', {
      friendship: result.friendship,
      requester: result.requester,
      addressee: result.addressee,
      emittedAt
    });

    return res.json({
      success: true,
      conversationId,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '拉黑用户错误:');
  }
});

router.delete('/blocks/:targetUserId', authenticateToken, async (req, res) => {
  try {
    const result = await socialService.unblockUser({
      userId: req?.user?.userId,
      targetUserId: req.params?.targetUserId
    });

    const emittedAt = new Date().toISOString();
    emitToUser(result?.requester?._id, 'social:relationship-updated', {
      friendship: result.friendship,
      requester: result.requester,
      addressee: result.addressee,
      emittedAt
    });
    emitToUser(result?.addressee?._id, 'social:relationship-updated', {
      friendship: result.friendship,
      requester: result.requester,
      addressee: result.addressee,
      emittedAt
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '解除拉黑错误:');
  }
});

router.get('/friends', authenticateToken, async (req, res) => {
  try {
    const result = await socialService.listFriends({
      userId: req?.user?.userId
    });
    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return handleRouteError(res, error, '获取好友列表错误:');
  }
});

module.exports = router;
