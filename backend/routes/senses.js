const express = require('express');
const mongoose = require('mongoose');
const Node = require('../models/Node');
const User = require('../models/User');
const NodeSenseEditSuggestion = require('../models/NodeSenseEditSuggestion');
const NodeSenseComment = require('../models/NodeSenseComment');
const NodeSenseFavorite = require('../models/NodeSenseFavorite');
const { authenticateToken } = require('../middleware/auth');
const schedulerService = require('../services/schedulerService');
const {
  isNodeSenseCollectionReadEnabled,
  isNodeSenseRepairEnabled,
  hydrateNodeSensesForNodes,
  resolveNodeSensesForNode,
  saveNodeSenses
} = require('../services/nodeSenseStore');
const { bootstrapArticleFromNodeSense } = require('../services/senseArticleService');

const router = express.Router();
const ENABLE_LEGACY_SENSES_MUTATION_ENDPOINTS = process.env.ENABLE_LEGACY_SENSES_MUTATION_ENDPOINTS === 'true';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const findSenseById = (senseList = [], senseId = '') => {
  const key = typeof senseId === 'string' ? senseId.trim() : '';
  if (!key) return null;
  return (Array.isArray(senseList) ? senseList : []).find((item) => item.senseId === key) || null;
};

const ensureSenseTitleUnique = (senseList = [], title = '', currentSenseId = '') => {
  const titleKey = String(title || '').trim().toLowerCase();
  if (!titleKey) return false;
  return !(Array.isArray(senseList) ? senseList : []).some((item) => {
    if (!item?.title) return false;
    if (currentSenseId && item.senseId === currentSenseId) return false;
    return String(item.title).trim().toLowerCase() === titleKey;
  });
};

const getNextSenseId = (senseList = []) => {
  let maxIndex = 0;
  (Array.isArray(senseList) ? senseList : []).forEach((item) => {
    const text = String(item?.senseId || '');
    const match = text.match(/^sense_(\d+)$/);
    if (!match) return;
    const idx = parseInt(match[1], 10);
    if (Number.isFinite(idx) && idx > maxIndex) {
      maxIndex = idx;
    }
  });
  return `sense_${maxIndex + 1}`;
};

const canManageNodeSenses = async (node, userId) => {
  const requesterId = getIdString(userId);
  if (!isValidObjectId(requesterId)) {
    return { allowed: false, status: 401, error: '无效用户身份' };
  }
  const user = await User.findById(requesterId).select('role');
  if (!user) {
    return { allowed: false, status: 404, error: '用户不存在' };
  }
  if (user.role === 'admin') {
    return { allowed: true, isAdmin: true };
  }
  const isMaster = getIdString(node?.domainMaster) === requesterId;
  const isDomainAdmin = (Array.isArray(node?.domainAdmins) ? node.domainAdmins : []).some((item) => getIdString(item) === requesterId);
  if (!isMaster && !isDomainAdmin) {
    return { allowed: false, status: 403, error: '仅域主、域相或系统管理员可编辑释义' };
  }
  return { allowed: true, isAdmin: false };
};

const enqueueNodeSenseBackfillFromSenseRoute = async (node = {}, actorUserId = null) => {
  if (!isNodeSenseCollectionReadEnabled() || !isNodeSenseRepairEnabled()) return;
  const nodeId = getIdString(node?._id);
  if (!isValidObjectId(nodeId)) return;
  const senseVersion = Number.isFinite(Number(node?.senseVersion)) ? Number(node.senseVersion) : 0;
  await schedulerService.enqueue({
    type: 'node_sense_backfill_job',
    payload: {
      nodeId,
      actorUserId: getIdString(actorUserId) || null
    },
    dedupeKey: `node_sense_backfill:${nodeId}:${senseVersion}`
  });
};

const resolveNodeSensesWithRepair = async (node = {}, actorUserId = null) => {
  const rows = Array.isArray(node) ? node : [node];
  await hydrateNodeSensesForNodes(rows);
  const resolved = resolveNodeSensesForNode(node, {
    fallbackDescription: typeof node?.description === 'string' ? node.description : ''
  });
  if (resolved.shouldEnqueueBackfill) {
    await enqueueNodeSenseBackfillFromSenseRoute(node, actorUserId);
  }
  return resolved.senses;
};

const persistNodeSenses = async ({ node, nextSenses = [], actorUserId = null }) => {
  const saved = await saveNodeSenses({
    nodeId: node?._id,
    senses: nextSenses,
    actorUserId,
    fallbackDescription: node?.description || ''
  });
  return saved.senses;
};

const ensureApprovedNode = async (nodeId) => {
  if (!isValidObjectId(nodeId)) return null;
  const node = await Node.findById(nodeId)
    .select('_id name description status domainMaster domainAdmins associations synonymSenses senseVersion');
  if (!node || node.status !== 'approved') return null;
  return node;
};

const ensureSenseMutationPathEnabled = (res) => {
  if (ENABLE_LEGACY_SENSES_MUTATION_ENDPOINTS) return true;
  res.status(409).json({
    error: '旧释义直写入口已降级为兼容路径。新增释义元信息请使用 /api/nodes/:nodeId/admin/senses；百科正文必须改走 /api/sense-articles/:nodeId/:senseId/revisions。若需临时回退可设置 ENABLE_LEGACY_SENSES_MUTATION_ENDPOINTS=true',
    code: 'legacy_sense_mutation_disabled'
  });
  return false;
};

const rejectLegacyArticleContentMutation = (res, message = '百科正式正文已迁移到修订系统，请改用 /api/sense-articles/:nodeId/:senseId/revisions') => {
  res.status(409).json({
    error: message,
    code: 'sense_article_revision_flow_required'
  });
};

const sendSenseRouteError = (res, error, fallbackMessage = '服务器错误') => {
  if (error?.expose && error?.message) {
    return res.status(Number(error.statusCode) || 400).json({
      error: error.message || fallbackMessage,
      code: error.code || '',
      details: error.details || null
    });
  }
  return res.status(500).json({ error: fallbackMessage });
};

router.get('/node/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await ensureApprovedNode(nodeId);
    if (!node) return res.status(404).json({ error: '知识域不存在或未审批' });

    const senses = await resolveNodeSensesWithRepair(node, req.user?.userId || null);
    const [commentCounts, favoriteCounts] = await Promise.all([
      NodeSenseComment.aggregate([
        { $match: { nodeId: node._id, status: 'visible' } },
        { $group: { _id: '$senseId', count: { $sum: 1 } } }
      ]),
      NodeSenseFavorite.aggregate([
        { $match: { nodeId: node._id } },
        { $group: { _id: '$senseId', count: { $sum: 1 } } }
      ])
    ]);
    const commentMap = new Map(commentCounts.map((item) => [String(item._id), item.count || 0]));
    const favoriteMap = new Map(favoriteCounts.map((item) => [String(item._id), item.count || 0]));

    res.json({
      success: true,
      nodeId: getIdString(node._id),
      nodeName: node.name || '',
      senses: senses.map((sense) => ({
        ...sense,
        commentCount: commentMap.get(sense.senseId) || 0,
        favoriteCount: favoriteMap.get(sense.senseId) || 0
      }))
    });
  } catch (error) {
    console.error('获取释义列表错误:', error);
    sendSenseRouteError(res, (typeof error !== 'undefined' ? error : null));
  }
});

router.post('/node/:nodeId', authenticateToken, async (req, res) => {
  try {
    if (!ensureSenseMutationPathEnabled(res)) return;
    const { nodeId } = req.params;
    const node = await ensureApprovedNode(nodeId);
    if (!node) return res.status(404).json({ error: '知识域不存在或未审批' });

    const permission = await canManageNodeSenses(node, req.user.userId);
    if (!permission.allowed) {
      return res.status(permission.status).json({ error: permission.error });
    }

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!title || !content) {
      return res.status(400).json({ error: '释义标题和内容不能为空' });
    }

    const currentSenses = await resolveNodeSensesWithRepair(node, req.user?.userId || null);
    if (!ensureSenseTitleUnique(currentSenses, title)) {
      return res.status(400).json({ error: '同一知识域下多个释义题目不能重名' });
    }

    const nextSenses = currentSenses.concat([{
      senseId: getNextSenseId(currentSenses),
      title,
      content
    }]);
    const newSenseId = nextSenses[nextSenses.length - 1]?.senseId || '';
    const savedSenses = await persistNodeSenses({
      node,
      nextSenses,
      actorUserId: req.user.userId
    });
    if (newSenseId) {
      await bootstrapArticleFromNodeSense({
        nodeId: node._id,
        senseId: newSenseId,
        userId: req.user.userId
      });
    }

    res.json({
      success: true,
      message: '释义已新增',
      senses: savedSenses
    });
  } catch (error) {
    console.error('新增释义错误:', error);
    sendSenseRouteError(res, (typeof error !== 'undefined' ? error : null));
  }
});

router.put('/node/:nodeId/:senseId', authenticateToken, async (req, res) => {
  try {
    if (!ensureSenseMutationPathEnabled(res)) return;
    const { nodeId, senseId } = req.params;
    const node = await ensureApprovedNode(nodeId);
    if (!node) return res.status(404).json({ error: '知识域不存在或未审批' });

    const permission = await canManageNodeSenses(node, req.user.userId);
    if (!permission.allowed) {
      return res.status(permission.status).json({ error: permission.error });
    }

    const currentSenses = await resolveNodeSensesWithRepair(node, req.user?.userId || null);
    const currentSense = findSenseById(currentSenses, senseId);
    if (!currentSense) {
      return res.status(404).json({ error: '释义不存在' });
    }

    const requestedTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const hasContentPayload = typeof req.body?.content === 'string';
    const nextTitle = requestedTitle || currentSense.title;
    const nextContent = currentSense.content;
    if (hasContentPayload && String(req.body.content || '').trim() !== String(currentSense.content || '').trim()) {
      return rejectLegacyArticleContentMutation(res);
    }
    if (!nextTitle || !nextContent) {
      return res.status(400).json({ error: '释义标题和内容不能为空' });
    }
    if (!ensureSenseTitleUnique(currentSenses, nextTitle, currentSense.senseId)) {
      return res.status(400).json({ error: '同一知识域下多个释义题目不能重名' });
    }

    const nextSenses = currentSenses.map((item) => (
      item.senseId === currentSense.senseId
        ? { ...item, title: nextTitle, content: item.content }
        : item
    ));
    const savedSenses = await persistNodeSenses({
      node,
      nextSenses,
      actorUserId: req.user.userId
    });

    res.json({
      success: true,
      message: '释义已更新',
      senses: savedSenses
    });
  } catch (error) {
    console.error('更新释义错误:', error);
    sendSenseRouteError(res, (typeof error !== 'undefined' ? error : null));
  }
});

router.delete('/node/:nodeId/:senseId', authenticateToken, async (req, res) => {
  try {
    if (!ensureSenseMutationPathEnabled(res)) return;
    const { nodeId, senseId } = req.params;
    const node = await ensureApprovedNode(nodeId);
    if (!node) return res.status(404).json({ error: '知识域不存在或未审批' });

    const permission = await canManageNodeSenses(node, req.user.userId);
    if (!permission.allowed) {
      return res.status(permission.status).json({ error: permission.error });
    }

    const currentSenses = await resolveNodeSensesWithRepair(node, req.user?.userId || null);
    const currentSense = findSenseById(currentSenses, senseId);
    if (!currentSense) {
      return res.status(404).json({ error: '释义不存在' });
    }
    if (currentSenses.length <= 1) {
      return res.status(400).json({ error: '知识域至少需要保留一个释义' });
    }

    const hasAssociationRef = (Array.isArray(node.associations) ? node.associations : []).some((assoc) => {
      const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
      const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
      return sourceSenseId === currentSense.senseId || targetSenseId === currentSense.senseId;
    });
    if (hasAssociationRef) {
      return res.status(400).json({ error: '该释义仍被关联关系引用，无法删除' });
    }

    const nextSenses = currentSenses.filter((item) => item.senseId !== currentSense.senseId);
    const savedSenses = await persistNodeSenses({
      node,
      nextSenses,
      actorUserId: req.user.userId
    });

    res.json({
      success: true,
      message: '释义已删除',
      senses: savedSenses
    });
  } catch (error) {
    console.error('删除释义错误:', error);
    sendSenseRouteError(res, (typeof error !== 'undefined' ? error : null));
  }
});

router.post('/node/:nodeId/:senseId/suggestions', authenticateToken, async (req, res) => {
  try {
    const { nodeId, senseId } = req.params;
    const node = await ensureApprovedNode(nodeId);
    if (!node) return res.status(404).json({ error: '知识域不存在或未审批' });

    const senses = await resolveNodeSensesWithRepair(node, req.user?.userId || null);
    const currentSense = findSenseById(senses, senseId);
    if (!currentSense) return res.status(404).json({ error: '释义不存在' });

    const proposedTitle = typeof req.body?.proposedTitle === 'string' ? req.body.proposedTitle.trim() : '';
    const proposedContent = typeof req.body?.proposedContent === 'string' ? req.body.proposedContent.trim() : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!proposedTitle && !proposedContent) {
      return res.status(400).json({ error: '至少需要提交一个修改项（标题或内容）' });
    }
    if (proposedContent) {
      return rejectLegacyArticleContentMutation(res, '旧 suggestion 正文提案已停用，请在百科阅读页或编辑页通过修订流提交正文修改');
    }
    if (proposedTitle && !ensureSenseTitleUnique(senses, proposedTitle, currentSense.senseId)) {
      return res.status(400).json({ error: '同一知识域下多个释义题目不能重名' });
    }

    const suggestion = await NodeSenseEditSuggestion.create({
      nodeId: node._id,
      senseId: currentSense.senseId,
      proposerId: req.user.userId,
      proposedTitle,
      proposedContent,
      reason
    });

    res.status(201).json({
      success: true,
      message: '释义修改建议已提交',
      suggestion
    });
  } catch (error) {
    console.error('提交释义建议错误:', error);
    sendSenseRouteError(res, (typeof error !== 'undefined' ? error : null));
  }
});

router.get('/node/:nodeId/:senseId/suggestions', authenticateToken, async (req, res) => {
  try {
    const { nodeId, senseId } = req.params;
    const node = await ensureApprovedNode(nodeId);
    if (!node) return res.status(404).json({ error: '知识域不存在或未审批' });

    const permission = await canManageNodeSenses(node, req.user.userId);
    if (!permission.allowed) {
      return res.status(permission.status).json({ error: permission.error });
    }

    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(req.query?.pageSize, 10) || 30));
    const filter = {
      nodeId: node._id,
      senseId: String(senseId || '').trim()
    };
    if (req.query?.status === 'pending' || req.query?.status === 'approved' || req.query?.status === 'rejected') {
      filter.status = req.query.status;
    }

    const [total, rows] = await Promise.all([
      NodeSenseEditSuggestion.countDocuments(filter),
      NodeSenseEditSuggestion.find(filter)
        .populate('proposerId', 'username profession')
        .populate('reviewerId', 'username profession')
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
    ]);

    res.json({
      success: true,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
      suggestions: rows
    });
  } catch (error) {
    console.error('获取释义建议列表错误:', error);
    sendSenseRouteError(res, (typeof error !== 'undefined' ? error : null));
  }
});

router.post('/node/:nodeId/:senseId/suggestions/:suggestionId/review', authenticateToken, async (req, res) => {
  try {
    const { nodeId, senseId, suggestionId } = req.params;
    if (!isValidObjectId(suggestionId)) {
      return res.status(400).json({ error: '无效建议ID' });
    }

    const node = await ensureApprovedNode(nodeId);
    if (!node) return res.status(404).json({ error: '知识域不存在或未审批' });

    const permission = await canManageNodeSenses(node, req.user.userId);
    if (!permission.allowed) {
      return res.status(permission.status).json({ error: permission.error });
    }

    const suggestion = await NodeSenseEditSuggestion.findOne({
      _id: suggestionId,
      nodeId: node._id,
      senseId: String(senseId || '').trim()
    });
    if (!suggestion) return res.status(404).json({ error: '建议不存在' });
    if (suggestion.status !== 'pending') {
      return res.status(400).json({ error: '该建议已处理' });
    }

    const action = req.body?.action === 'approve' ? 'approve' : (req.body?.action === 'reject' ? 'reject' : '');
    if (!action) return res.status(400).json({ error: '无效审核动作' });
    if (action === 'approve' && !ensureSenseMutationPathEnabled(res)) return;
    if (action === 'approve' && suggestion.proposedContent) {
      return rejectLegacyArticleContentMutation(res, '旧 suggestion 正文审批已停用，请改走百科 revision 审核流');
    }

    const reviewComment = typeof req.body?.reviewComment === 'string' ? req.body.reviewComment.trim() : '';
    suggestion.status = action === 'approve' ? 'approved' : 'rejected';
    suggestion.reviewerId = req.user.userId;
    suggestion.reviewComment = reviewComment;
    suggestion.reviewedAt = new Date();

    if (action === 'approve') {
      const senses = await resolveNodeSensesWithRepair(node, req.user?.userId || null);
      const currentSense = findSenseById(senses, suggestion.senseId);
      if (!currentSense) {
        return res.status(404).json({ error: '对应释义不存在' });
      }
      const nextTitle = suggestion.proposedTitle ? suggestion.proposedTitle.trim() : currentSense.title;
      const nextContent = currentSense.content;
      if (!nextTitle || !nextContent) {
        return res.status(400).json({ error: '建议内容无效，无法应用' });
      }
      if (!ensureSenseTitleUnique(senses, nextTitle, currentSense.senseId)) {
        return res.status(400).json({ error: '建议标题与当前知识域其他释义重名，无法通过' });
      }
      const nextSenses = senses.map((item) => (
        item.senseId === currentSense.senseId
          ? { ...item, title: nextTitle, content: nextContent }
          : item
      ));
      await persistNodeSenses({
        node,
        nextSenses,
        actorUserId: req.user.userId
      });
    }

    await suggestion.save();

    res.json({
      success: true,
      message: action === 'approve' ? '建议已通过并应用' : '建议已驳回',
      suggestion
    });
  } catch (error) {
    console.error('审核释义建议错误:', error);
    sendSenseRouteError(res, (typeof error !== 'undefined' ? error : null));
  }
});

router.get('/node/:nodeId/:senseId/comments', async (req, res) => {
  try {
    const { nodeId, senseId } = req.params;
    const node = await ensureApprovedNode(nodeId);
    if (!node) return res.status(404).json({ error: '知识域不存在或未审批' });

    const senses = await resolveNodeSensesWithRepair(node, req.user?.userId || null);
    const currentSense = findSenseById(senses, senseId);
    if (!currentSense) return res.status(404).json({ error: '释义不存在' });

    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(200, parseInt(req.query?.pageSize, 10) || 50));
    const filter = {
      nodeId: node._id,
      senseId: currentSense.senseId,
      status: 'visible'
    };

    const [total, rows] = await Promise.all([
      NodeSenseComment.countDocuments(filter),
      NodeSenseComment.find(filter)
        .populate('userId', 'username profession avatar level')
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
    ]);

    res.json({
      success: true,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
      comments: rows
    });
  } catch (error) {
    console.error('获取释义评论错误:', error);
    sendSenseRouteError(res, (typeof error !== 'undefined' ? error : null));
  }
});

router.post('/node/:nodeId/:senseId/comments', authenticateToken, async (req, res) => {
  try {
    const { nodeId, senseId } = req.params;
    const node = await ensureApprovedNode(nodeId);
    if (!node) return res.status(404).json({ error: '知识域不存在或未审批' });

    const senses = await resolveNodeSensesWithRepair(node, req.user?.userId || null);
    const currentSense = findSenseById(senses, senseId);
    if (!currentSense) return res.status(404).json({ error: '释义不存在' });

    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) return res.status(400).json({ error: '评论内容不能为空' });

    const replyToCommentId = isValidObjectId(req.body?.replyToCommentId)
      ? new mongoose.Types.ObjectId(String(req.body.replyToCommentId))
      : null;

    const row = await NodeSenseComment.create({
      nodeId: node._id,
      senseId: currentSense.senseId,
      userId: req.user.userId,
      content,
      replyToCommentId
    });
    const populated = await NodeSenseComment.findById(row._id)
      .populate('userId', 'username profession avatar level')
      .lean();

    res.status(201).json({
      success: true,
      message: '评论已发布',
      comment: populated
    });
  } catch (error) {
    console.error('发布释义评论错误:', error);
    sendSenseRouteError(res, (typeof error !== 'undefined' ? error : null));
  }
});

router.post('/node/:nodeId/:senseId/favorite', authenticateToken, async (req, res) => {
  try {
    const { nodeId, senseId } = req.params;
    const node = await ensureApprovedNode(nodeId);
    if (!node) return res.status(404).json({ error: '知识域不存在或未审批' });

    const senses = await resolveNodeSensesWithRepair(node, req.user?.userId || null);
    const currentSense = findSenseById(senses, senseId);
    if (!currentSense) return res.status(404).json({ error: '释义不存在' });

    const filter = {
      nodeId: node._id,
      senseId: currentSense.senseId,
      userId: req.user.userId
    };
    const existed = await NodeSenseFavorite.findOne(filter).select('_id').lean();
    if (existed) {
      await NodeSenseFavorite.deleteOne({ _id: existed._id });
      const count = await NodeSenseFavorite.countDocuments({
        nodeId: node._id,
        senseId: currentSense.senseId
      });
      return res.json({
        success: true,
        favorited: false,
        favoriteCount: count
      });
    }

    await NodeSenseFavorite.create(filter);
    const count = await NodeSenseFavorite.countDocuments({
      nodeId: node._id,
      senseId: currentSense.senseId
    });
    res.json({
      success: true,
      favorited: true,
      favoriteCount: count
    });
  } catch (error) {
    console.error('释义收藏切换错误:', error);
    sendSenseRouteError(res, (typeof error !== 'undefined' ? error : null));
  }
});

module.exports = router;
