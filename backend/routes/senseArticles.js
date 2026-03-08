const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
  compareRevisions,
  createAnnotation,
  createDraftRevision,
  deleteAnnotation,
  getArticleOverview,
  getCurrentArticle,
  getGovernanceDashboard,
  getRevisionDetail,
  listBacklinks,
  listCurrentReferences,
  listMyAnnotations,
  listRevisions,
  reviewByDomainAdmin,
  reviewByDomainMaster,
  searchCurrentArticle,
  searchReferenceTargets,
  submitRevision,
  updateAnnotation,
  updateDraftRevision
} = require('../services/senseArticleService');

const router = express.Router();

const sendError = (res, error, fallback = '服务器错误') => {
  if (error?.expose) {
    return res.status(error.statusCode || 400).json({
      error: error.message || fallback,
      code: error.code || '',
      details: error.details || null
    });
  }
  return res.status(500).json({ error: fallback });
};

router.get('/reference-targets/search', authenticateToken, async (req, res) => {
  try {
    const data = await searchReferenceTargets({ query: req.query?.q || '' });
    res.json(data);
  } catch (error) {
    sendError(res, error, '引用目标搜索失败');
  }
});

router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const data = await getGovernanceDashboard({
      userId: req.user.userId,
      nodeId: typeof req.query?.nodeId === 'string' ? req.query.nodeId.trim() : ''
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取内容治理面板失败');
  }
});

router.get('/:nodeId/:senseId', authenticateToken, async (req, res) => {
  try {
    const data = await getArticleOverview({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取百科概览失败');
  }
});

router.get('/:nodeId/:senseId/current', authenticateToken, async (req, res) => {
  try {
    const data = await getCurrentArticle({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取当前发布版失败');
  }
});

router.get('/:nodeId/:senseId/revisions', authenticateToken, async (req, res) => {
  try {
    const data = await listRevisions({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId,
      status: typeof req.query?.status === 'string' ? req.query.status.trim() : '',
      page: req.query?.page,
      pageSize: req.query?.pageSize
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取修订列表失败');
  }
});

router.get('/:nodeId/:senseId/revisions/compare', authenticateToken, async (req, res) => {
  try {
    const data = await compareRevisions({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      fromRevisionId: req.query?.from || '',
      toRevisionId: req.query?.to || '',
      userId: req.user.userId
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取修订对比失败');
  }
});

router.get('/:nodeId/:senseId/revisions/:revisionId', authenticateToken, async (req, res) => {
  try {
    const data = await getRevisionDetail({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: req.params.revisionId,
      userId: req.user.userId
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取修订详情失败');
  }
});

router.post('/:nodeId/:senseId/revisions/draft', authenticateToken, async (req, res) => {
  try {
    const data = await createDraftRevision({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId,
      payload: req.body || {}
    });
    res.status(201).json(data);
  } catch (error) {
    sendError(res, error, '创建草稿失败');
  }
});

router.put('/:nodeId/:senseId/revisions/:revisionId', authenticateToken, async (req, res) => {
  try {
    const data = await updateDraftRevision({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: req.params.revisionId,
      userId: req.user.userId,
      payload: req.body || {}
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '更新草稿失败');
  }
});

router.post('/:nodeId/:senseId/revisions/:revisionId/submit', authenticateToken, async (req, res) => {
  try {
    const data = await submitRevision({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: req.params.revisionId,
      userId: req.user.userId
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '提交审核失败');
  }
});

router.post('/:nodeId/:senseId/revisions/from-selection', authenticateToken, async (req, res) => {
  try {
    const data = await createDraftRevision({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId,
      payload: {
        ...(req.body || {}),
        sourceMode: 'selection'
      }
    });
    res.status(201).json(data);
  } catch (error) {
    sendError(res, error, '从选段创建修订失败');
  }
});

router.post('/:nodeId/:senseId/revisions/from-heading', authenticateToken, async (req, res) => {
  try {
    const data = await createDraftRevision({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId,
      payload: {
        ...(req.body || {}),
        sourceMode: 'section'
      }
    });
    res.status(201).json(data);
  } catch (error) {
    sendError(res, error, '从小节创建修订失败');
  }
});

router.post('/:nodeId/:senseId/revisions/:revisionId/review/domain-admin', authenticateToken, async (req, res) => {
  try {
    const data = await reviewByDomainAdmin({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: req.params.revisionId,
      userId: req.user.userId,
      action: req.body?.action,
      comment: req.body?.comment || ''
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '域相审核失败');
  }
});

router.post('/:nodeId/:senseId/revisions/:revisionId/review/domain-master', authenticateToken, async (req, res) => {
  try {
    const data = await reviewByDomainMaster({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: req.params.revisionId,
      userId: req.user.userId,
      action: req.body?.action,
      comment: req.body?.comment || ''
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '域主终审失败');
  }
});

router.get('/:nodeId/:senseId/annotations/me', authenticateToken, async (req, res) => {
  try {
    const data = await listMyAnnotations({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取私有标注失败');
  }
});

router.post('/:nodeId/:senseId/annotations', authenticateToken, async (req, res) => {
  try {
    const data = await createAnnotation({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId,
      payload: req.body || {}
    });
    res.status(201).json(data);
  } catch (error) {
    sendError(res, error, '创建私有标注失败');
  }
});

router.put('/:nodeId/:senseId/annotations/:annotationId', authenticateToken, async (req, res) => {
  try {
    const data = await updateAnnotation({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      annotationId: req.params.annotationId,
      userId: req.user.userId,
      payload: req.body || {}
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '更新私有标注失败');
  }
});

router.delete('/:nodeId/:senseId/annotations/:annotationId', authenticateToken, async (req, res) => {
  try {
    const data = await deleteAnnotation({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      annotationId: req.params.annotationId,
      userId: req.user.userId
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '删除私有标注失败');
  }
});

router.get('/:nodeId/:senseId/search', authenticateToken, async (req, res) => {
  try {
    const data = await searchCurrentArticle({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId,
      query: req.query?.q || ''
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '页内搜索失败');
  }
});

router.get('/:nodeId/:senseId/references', authenticateToken, async (req, res) => {
  try {
    const data = await listCurrentReferences({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取引用索引失败');
  }
});

router.get('/:nodeId/:senseId/backlinks', authenticateToken, async (req, res) => {
  try {
    const data = await listBacklinks({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取被引用情况失败');
  }
});

module.exports = router;
