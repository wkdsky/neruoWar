const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const SocialChatError = require('../services/socialChatError');
const { socialService } = require('../services/socialService');
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
    emitToUser(result?.requester?._id, 'social:friend-request-responded', {
      friendship: result.friendship,
      requester: result.requester,
      addressee: result.addressee,
      emittedAt
    });
    emitToUser(result?.addressee?._id, 'social:friend-request-responded', {
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
