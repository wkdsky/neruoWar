const createSenseArticleMediaService = ({
  SenseArticleRevision,
  createMediaAssetRecord,
  diagLog,
  durationMs,
  enqueueTemporaryMediaCleanup,
  ensurePermission,
  ensureRevisionDerivedState,
  getArticleBundle,
  getIdString,
  loadEditorMediaLibrary,
  nowMs,
  releaseTemporaryMediaSession,
  serializeArticleSummary,
  serializeMediaAsset,
  syncTemporaryMediaSessionAssets,
  touchTemporaryMediaSession
} = {}) => {
  const uploadMediaAsset = async ({ nodeId, senseId, revisionId = '', userId, file, payload = {} }) => {
    ensurePermission(!!file, '请先选择媒体文件', 400, 'media_file_required');
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    ensurePermission(bundle.permissions.canCreateRevision, '当前用户无法上传百科正文媒体');
    const revision = revisionId
      ? await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id }).select('_id').lean()
      : null;
    const explicitKind = String(payload.kind || '').trim();
    const mimeType = String(file?.mimetype || '').toLowerCase();
    const inferredKind = explicitKind
      || (mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : '');
    ensurePermission(['image', 'audio', 'video'].includes(inferredKind), '不支持的媒体类型', 400, 'media_kind_invalid');
    const tempMediaSessionId = typeof payload.tempMediaSessionId === 'string' ? payload.tempMediaSessionId.trim() : '';
    const asset = await createMediaAssetRecord({
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      articleId: bundle.article?._id || null,
      revisionId: revision?._id || null,
      kind: inferredKind,
      file,
      userId,
      alt: typeof payload.alt === 'string' ? payload.alt.trim() : '',
      caption: typeof payload.caption === 'string' ? payload.caption.trim() : '',
      title: typeof payload.title === 'string' ? payload.title.trim() : '',
      description: typeof payload.description === 'string' ? payload.description.trim() : '',
      posterUrl: typeof payload.posterUrl === 'string' ? payload.posterUrl.trim() : '',
      width: payload.width,
      height: payload.height,
      duration: payload.duration,
      tempSessionId: tempMediaSessionId
    });
    if (asset?.tempExpiresAt) {
      await enqueueTemporaryMediaCleanup({ runAt: asset.tempExpiresAt });
    }
    return {
      ok: true,
      asset: serializeMediaAsset(asset)
    };
  };

  const touchMediaSession = async ({ nodeId, senseId, revisionId = '', userId, tempMediaSessionId = '' }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: false });
    if (!bundle.article) {
      return {
        ok: true,
        revisionId: revisionId || null,
        touchedAssetCount: 0,
        tempExpiresAt: null
      };
    }
    ensurePermission(bundle.permissions.canCreateRevision, '当前用户无法续租媒体临时缓存');
    const revision = revisionId
      ? await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id }).select('_id').lean()
      : null;
    const result = await touchTemporaryMediaSession({
      articleId: bundle.article._id,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      tempSessionId: tempMediaSessionId
    });
    if (result?.tempExpiresAt) {
      await enqueueTemporaryMediaCleanup({ runAt: result.tempExpiresAt });
    }
    return {
      ok: true,
      revisionId: revision?._id || revisionId || null,
      touchedAssetCount: Number(result?.matchedCount || 0),
      tempExpiresAt: result?.tempExpiresAt || null
    };
  };

  const releaseMediaSession = async ({ nodeId, senseId, revisionId = '', userId, tempMediaSessionId = '' }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: false });
    if (!bundle.article) {
      return {
        ok: true,
        revisionId: revisionId || null,
        deletedAssetCount: 0,
        deletedFileCount: 0
      };
    }
    ensurePermission(bundle.permissions.canCreateRevision, '当前用户无法释放媒体临时缓存');
    const revision = revisionId
      ? await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id }).select('_id').lean()
      : null;
    const deleted = await releaseTemporaryMediaSession({
      articleId: bundle.article._id,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      tempSessionId: tempMediaSessionId
    });
    return {
      ok: true,
      revisionId: revision?._id || revisionId || null,
      ...deleted
    };
  };

  const syncMediaSession = async ({ nodeId, senseId, revisionId = '', userId, tempMediaSessionId = '', activeUrls = [] }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: false });
    if (!bundle.article) {
      return {
        ok: true,
        revisionId: revisionId || null,
        deletedAssetCount: 0,
        deletedFileCount: 0,
        deletedAssetIds: [],
        deletedUrls: []
      };
    }
    ensurePermission(bundle.permissions.canCreateRevision, '当前用户无法同步媒体临时缓存');
    const revision = revisionId
      ? await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id }).select('_id').lean()
      : null;
    const deleted = await syncTemporaryMediaSessionAssets({
      articleId: bundle.article._id,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      tempSessionId: tempMediaSessionId,
      activeUrls
    });
    return {
      ok: true,
      revisionId: revision?._id || revisionId || null,
      ...deleted
    };
  };

  const listMediaAssets = async ({ nodeId, senseId, revisionId = '', userId }) => {
    const startedAt = nowMs();
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    ensurePermission(bundle.permissions.canRead, '当前用户无法查看媒体资源', 403, 'media_read_forbidden');
    if (revisionId) {
      const revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
      if (revision) {
        await ensureRevisionDerivedState({
          revision,
          nodeId: bundle.nodeId,
          senseId: bundle.senseId,
          persist: true
        });
      }
    }
    const mediaLibrary = await loadEditorMediaLibrary({
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      articleId: bundle.article._id,
      revisionId
    });
    const response = {
      article: serializeArticleSummary(bundle.article),
      revisionId: revisionId || null,
      ...mediaLibrary
    };
    diagLog('sense.media.library.response', {
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      revisionId: getIdString(revisionId),
      durationMs: durationMs(startedAt),
      referencedCount: Array.isArray(mediaLibrary?.referencedAssets) ? mediaLibrary.referencedAssets.length : 0,
      recentCount: Array.isArray(mediaLibrary?.recentAssets) ? mediaLibrary.recentAssets.length : 0,
      orphanCount: Array.isArray(mediaLibrary?.orphanCandidates) ? mediaLibrary.orphanCandidates.length : 0
    });
    return response;
  };

  return {
    listMediaAssets,
    releaseMediaSession,
    syncMediaSession,
    touchMediaSession,
    uploadMediaAsset
  };
};

module.exports = {
  createSenseArticleMediaService
};
