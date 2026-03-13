const express = require('express');
const path = require('path');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const {
  compareRevisions,
  createAnnotation,
  createDraftRevision,
  deleteAnnotation,
  deleteDraftRevision,
  getArticleOverview,
  getCurrentArticle,
  getCurrentArticleSideData,
  getGovernanceDashboard,
  getRevisionDetail,
  getRevisionValidation,
  listBacklinks,
  listCurrentReferences,
  listMediaAssets,
  listMyEdits,
  listMyAnnotations,
  listRevisions,
  releaseMediaSession,
  reviewByDomainAdmin,
  reviewByDomainMaster,
  searchCurrentArticle,
  searchReferenceTargets,
  syncMediaSession,
  submitRevision,
  touchMediaSession,
  uploadMediaAsset,
  updateAnnotation,
  updateDraftRevision,
  updateSenseMetadata
} = require('../services/senseArticleService');
const { ensureMediaStorageDir } = require('../services/senseArticleMediaService');

const router = express.Router();
ensureMediaStorageDir();

const MEDIA_LIMIT_BYTES = 15 * 1024 * 1024;
const allowedMimeTypes = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/aac',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'
]);

const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, ensureMediaStorageDir()),
    filename: (_req, file, callback) => {
      const ext = path.extname(file.originalname || '').slice(0, 12).toLowerCase();
      const base = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      callback(null, `${base}${ext}`);
    }
  }),
  limits: {
    fileSize: MEDIA_LIMIT_BYTES
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
      callback(new Error('unsupported_media_type'));
      return;
    }
    callback(null, true);
  }
});

const buildRequestMeta = (req) => ({
  flowId: typeof req.headers['x-sense-flow-id'] === 'string' ? req.headers['x-sense-flow-id'].trim() : '',
  requestId: typeof req.headers['x-sense-request-id'] === 'string' ? req.headers['x-sense-request-id'].trim() : '',
  nodeId: req.params?.nodeId || '',
  senseId: req.params?.senseId || '',
  revisionId: req.params?.revisionId || ''
});

const sendError = (res, error, fallback = '服务器错误') => {
  if (error?.message === 'unsupported_media_type') {
    return res.status(400).json({ error: '文件类型不受支持，仅允许图片、音频、视频白名单格式', code: 'unsupported_media_type' });
  }
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '媒体文件超过大小限制', code: 'media_file_too_large' });
  }
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
    sendError(res, error, '获取词条管理失败');
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
      userId: req.user.userId,
      requestMeta: buildRequestMeta(req)
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取当前发布版失败');
  }
});

router.get('/:nodeId/:senseId/current/side-data', authenticateToken, async (req, res) => {
  try {
    const data = await getCurrentArticleSideData({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId,
      requestMeta: buildRequestMeta(req)
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取当前发布版辅助数据失败');
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
      userId: req.user.userId,
      requestMeta: buildRequestMeta(req)
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取修订对比失败');
  }
});

router.get('/:nodeId/:senseId/revisions/mine', authenticateToken, async (req, res) => {
  try {
    const data = await listMyEdits({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId,
      requestMeta: buildRequestMeta(req),
      limit: Number(req.query?.limit || 50)
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取我的编辑失败');
  }
});

router.get('/:nodeId/:senseId/revisions/:revisionId', authenticateToken, async (req, res) => {
  try {
    const data = await getRevisionDetail({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: req.params.revisionId,
      userId: req.user.userId,
      requestMeta: buildRequestMeta(req),
      detailLevel: typeof req.query?.mode === 'string' && req.query.mode.trim() === 'bootstrap' ? 'bootstrap' : 'full'
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取修订详情失败');
  }
});

router.get('/:nodeId/:senseId/revisions/:revisionId/validation', authenticateToken, async (req, res) => {
  try {
    const data = await getRevisionValidation({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: req.params.revisionId,
      userId: req.user.userId,
      requestMeta: buildRequestMeta(req)
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取修订校验摘要失败');
  }
});

router.post('/:nodeId/:senseId/media', authenticateToken, mediaUpload.single('file'), async (req, res) => {
  try {
    const data = await uploadMediaAsset({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: typeof req.body?.revisionId === 'string' ? req.body.revisionId.trim() : '',
      userId: req.user.userId,
      file: req.file,
      payload: req.body || {}
    });
    res.status(201).json(data);
  } catch (error) {
    sendError(res, error, '上传百科媒体失败');
  }
});

router.get('/:nodeId/:senseId/media', authenticateToken, async (req, res) => {
  try {
    const data = await listMediaAssets({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: typeof req.query?.revisionId === 'string' ? req.query.revisionId.trim() : '',
      userId: req.user.userId
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '获取百科媒体资源失败');
  }
});

router.post('/:nodeId/:senseId/media/session/touch', authenticateToken, async (req, res) => {
  try {
    const data = await touchMediaSession({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: typeof req.body?.revisionId === 'string' ? req.body.revisionId.trim() : '',
      userId: req.user.userId,
      tempMediaSessionId: typeof req.body?.tempMediaSessionId === 'string' ? req.body.tempMediaSessionId.trim() : ''
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '续租媒体临时缓存失败');
  }
});

router.post('/:nodeId/:senseId/media/session/release', authenticateToken, async (req, res) => {
  try {
    const data = await releaseMediaSession({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: typeof req.body?.revisionId === 'string' ? req.body.revisionId.trim() : '',
      userId: req.user.userId,
      tempMediaSessionId: typeof req.body?.tempMediaSessionId === 'string' ? req.body.tempMediaSessionId.trim() : ''
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '释放媒体临时缓存失败');
  }
});

router.post('/:nodeId/:senseId/media/session/sync', authenticateToken, async (req, res) => {
  try {
    const data = await syncMediaSession({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: typeof req.body?.revisionId === 'string' ? req.body.revisionId.trim() : '',
      userId: req.user.userId,
      tempMediaSessionId: typeof req.body?.tempMediaSessionId === 'string' ? req.body.tempMediaSessionId.trim() : '',
      activeUrls: Array.isArray(req.body?.activeUrls) ? req.body.activeUrls : []
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '同步媒体临时缓存失败');
  }
});

router.post('/:nodeId/:senseId/revisions/draft', authenticateToken, async (req, res) => {
  try {
    const data = await createDraftRevision({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId,
      payload: req.body || {},
      requestMeta: buildRequestMeta(req)
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
      payload: req.body || {},
      requestMeta: buildRequestMeta(req)
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '更新草稿失败');
  }
});

router.delete('/:nodeId/:senseId/revisions/:revisionId', authenticateToken, async (req, res) => {
  try {
    const data = await deleteDraftRevision({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: req.params.revisionId,
      userId: req.user.userId
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '放弃修订失败');
  }
});

router.put('/:nodeId/:senseId/metadata', authenticateToken, async (req, res) => {
  try {
    const data = await updateSenseMetadata({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      userId: req.user.userId,
      payload: req.body || {}
    });
    res.json(data);
  } catch (error) {
    sendError(res, error, '更新释义元信息失败');
  }
});

router.post('/:nodeId/:senseId/revisions/:revisionId/submit', authenticateToken, async (req, res) => {
  try {
    const data = await submitRevision({
      nodeId: req.params.nodeId,
      senseId: req.params.senseId,
      revisionId: req.params.revisionId,
      userId: req.user.userId,
      requestMeta: buildRequestMeta(req)
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
      },
      requestMeta: buildRequestMeta(req)
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
      },
      requestMeta: buildRequestMeta(req)
    });
    res.status(201).json(data);
  } catch (error) {
    sendError(res, error, '从小节创建修订失败');
  }
});

router.post('/:nodeId/:senseId/revisions/:revisionId/review', authenticateToken, async (req, res) => {
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
    sendError(res, error, '百科审阅失败');
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
