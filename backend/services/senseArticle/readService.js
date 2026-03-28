const createSenseArticleReadService = ({
  DRAFT_EDITABLE_STATUSES,
  SenseAnnotation,
  SenseArticleRevision,
  buildReviewPresentation,
  buildRevisionBootstrapResponse,
  createExposeError,
  decorateRevisionRecords,
  diagLog,
  durationMs,
  ensurePermission,
  ensureRevisionDerivedState,
  getArticleBundle,
  getIdString,
  loadMyVisibleRevisionSummaries,
  nowMs,
  relocateAnchor,
  resolveSenseArticleReadingMeta,
  serializeAnnotation,
  serializeArticleSummary,
  serializePermissions,
  serializeRevisionDetail,
  serializeRevisionSummary,
  assertRevisionReadable
} = {}) => {
  const getArticleOverview = async ({ nodeId, senseId, userId }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    const myAnnotations = await SenseAnnotation.find({
      userId: bundle.permissions.userId,
      articleId: bundle.article._id
    }).sort({ updatedAt: -1 }).limit(50).lean();
    return {
      node: bundle.node,
      nodeSense: bundle.nodeSense,
      article: serializeArticleSummary(bundle.article),
      currentRevision: bundle.currentRevision ? serializeRevisionSummary(bundle.currentRevision) : null,
      permissions: serializePermissions(bundle.permissions, userId),
      annotationSummary: {
        count: myAnnotations.length,
        latestUpdatedAt: myAnnotations[0]?.updatedAt || null
      }
    };
  };

  const getCurrentArticle = async ({ nodeId, senseId, userId, requestMeta = null }) => {
    const startedAt = nowMs();
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    ensurePermission(!!bundle.currentRevision, '当前释义尚无已发布百科版本', 404);
    const response = {
      node: bundle.node,
      nodeSense: bundle.nodeSense,
      article: serializeArticleSummary(bundle.article),
      revision: serializeRevisionDetail(bundle.currentRevision, { requestMeta, phase: 'get_current_article' }),
      permissions: serializePermissions(bundle.permissions, userId)
    };
    diagLog('sense.current_article.bootstrap', {
      flowId: requestMeta?.flowId,
      requestId: requestMeta?.requestId,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      revisionId: getIdString(bundle.currentRevision?._id),
      durationMs: durationMs(startedAt)
    });
    return response;
  };

  const listMyEdits = async ({ nodeId, senseId, userId, requestMeta = null, limit = 50 }) => {
    const startedAt = nowMs();
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    const revisions = await loadMyVisibleRevisionSummaries({
      articleId: bundle.article._id,
      proposerId: userId,
      fallbackSenseTitle: bundle.nodeSense?.title || bundle.senseId || '',
      limit
    });
    const activeFullDraft = revisions.find((item) => item?.sourceMode === 'full' && DRAFT_EDITABLE_STATUSES.includes(String(item?.status || '').trim())) || null;
    const response = {
      node: bundle.node,
      nodeSense: bundle.nodeSense,
      article: serializeArticleSummary(bundle.article),
      revisions,
      activeFullDraft,
      permissions: serializePermissions(bundle.permissions, userId)
    };
    diagLog('sense.revision.list_my_edits', {
      flowId: requestMeta?.flowId,
      requestId: requestMeta?.requestId,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      durationMs: durationMs(startedAt),
      count: revisions.length,
      hasActiveFullDraft: !!activeFullDraft
    });
    return response;
  };

  const getCurrentArticleSideData = async ({ nodeId, senseId, userId, requestMeta = null }) => {
    const startedAt = nowMs();
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    ensurePermission(!!bundle.currentRevision, '当前释义尚无已发布百科版本', 404);
    const annotations = await SenseAnnotation.find({ userId: bundle.permissions.userId, articleId: bundle.article._id }).sort({ updatedAt: -1 }).lean();
    const serializedAnnotations = annotations.map((item) => serializeAnnotation(item, relocateAnchor({ anchor: item.anchor, currentRevision: bundle.currentRevision })));
    const readingMeta = await resolveSenseArticleReadingMeta({
      revision: bundle.currentRevision,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId
    });
    const response = {
      article: serializeArticleSummary(bundle.article),
      revisionId: bundle.currentRevision?._id || null,
      annotations: serializedAnnotations,
      readingMeta
    };
    diagLog('sense.current_article.side_data', {
      flowId: requestMeta?.flowId,
      requestId: requestMeta?.requestId,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      revisionId: getIdString(bundle.currentRevision?._id),
      durationMs: durationMs(startedAt),
      annotationCount: serializedAnnotations.length,
      hasReadingMeta: !!readingMeta
    });
    return response;
  };

  const listRevisions = async ({ nodeId, senseId, userId, status = '', page = 1, pageSize = 20 }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    const filter = { articleId: bundle.article._id };
    const normalizedStatus = String(status || '').trim();
    if (normalizedStatus === 'approved') filter.status = { $in: ['published', 'superseded'] };
    else if (normalizedStatus) filter.status = normalizedStatus;
    const safePageSize = Math.max(1, Math.min(100, Number(pageSize) || 20));
    const safePage = Math.max(1, Number(page) || 1);
    const revisions = await SenseArticleRevision.find(filter)
      .sort({ revisionNumber: -1, createdAt: -1 })
      .limit(safePageSize)
      .skip((safePage - 1) * safePageSize)
      .lean();
    const visible = revisions.filter((revision) => {
      try {
        assertRevisionReadable({ revision, permissions: bundle.permissions, userId });
        return true;
      } catch (_error) {
        return false;
      }
    });
    const decorated = await decorateRevisionRecords({
      revisions: visible,
      fallbackSenseTitle: bundle.nodeSense?.title || bundle.senseId || ''
    });
    return {
      node: bundle.node,
      nodeSense: bundle.nodeSense,
      article: serializeArticleSummary(bundle.article),
      currentRevisionId: bundle.article.currentRevisionId || null,
      revisions: decorated.map((item) => serializeRevisionSummary(item)),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  };

  const getRevisionDetail = async ({ nodeId, senseId, revisionId, userId, requestMeta = null, detailLevel = 'full' }) => {
    const startedAt = nowMs();
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    let revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id }).lean();
    if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');
    assertRevisionReadable({ revision, permissions: bundle.permissions, userId });
    const [decoratedRevision] = await decorateRevisionRecords({
      revisions: [revision],
      fallbackSenseTitle: bundle.nodeSense?.title || bundle.senseId || ''
    });
    const bootstrapRevision = decoratedRevision
      ? {
          ...decoratedRevision,
          mediaReferences: Array.isArray(revision?.mediaReferences) ? revision.mediaReferences : [],
          validationSnapshot: revision?.validationSnapshot || null
        }
      : revision;
    if (detailLevel === 'bootstrap') {
      const response = buildRevisionBootstrapResponse({
        node: bundle.node,
        nodeSense: bundle.nodeSense,
        article: bundle.article,
        revision: bootstrapRevision,
        permissions: bundle.permissions,
        userId,
        requestMeta
      });
      diagLog('sense.revision.detail.bootstrap', {
        flowId: requestMeta?.flowId,
        requestId: requestMeta?.requestId,
        nodeId: bundle.nodeId,
        senseId: bundle.senseId,
        revisionId: getIdString(revision?._id),
        durationMs: durationMs(startedAt)
      });
      return response;
    }
    revision = await ensureRevisionDerivedState({
      revision,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      persist: false,
      force: true,
      requestMeta
    });
    const fullRevision = decoratedRevision
      ? {
          ...decoratedRevision,
          mediaReferences: Array.isArray(revision?.mediaReferences) ? revision.mediaReferences : [],
          validationSnapshot: revision?.validationSnapshot || null
        }
      : revision;
    const baseRevision = revision.baseRevisionId ? await SenseArticleRevision.findById(revision.baseRevisionId).lean() : null;
    const reviewPresentation = await buildReviewPresentation({ revision, node: bundle.node, currentUserId: userId });
    const response = {
      node: bundle.node,
      nodeSense: bundle.nodeSense,
      article: serializeArticleSummary(bundle.article),
      revision: serializeRevisionDetail(fullRevision, { requestMeta, phase: 'get_revision_detail.revision' }),
      baseRevision: baseRevision ? serializeRevisionDetail(baseRevision, { requestMeta, phase: 'get_revision_detail.base_revision' }) : null,
      reviewParticipants: reviewPresentation.participants,
      reviewSummary: reviewPresentation.summary,
      permissions: serializePermissions(bundle.permissions, userId)
    };
    diagLog('sense.revision.detail.full', {
      flowId: requestMeta?.flowId,
      requestId: requestMeta?.requestId,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      revisionId: getIdString(revision?._id),
      durationMs: durationMs(startedAt)
    });
    return response;
  };

  const getRevisionValidation = async ({ nodeId, senseId, revisionId, userId, requestMeta = null }) => {
    const startedAt = nowMs();
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    let revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
    if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');
    assertRevisionReadable({ revision, permissions: bundle.permissions, userId });
    revision = await ensureRevisionDerivedState({
      revision,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      persist: true,
      force: true,
      requestMeta
    });
    const response = {
      article: serializeArticleSummary(bundle.article),
      revisionId: revision._id,
      validationSnapshot: revision.validationSnapshot || null,
      mediaReferenceCount: Array.isArray(revision.mediaReferences) ? revision.mediaReferences.length : 0
    };
    diagLog('sense.revision.validation.response', {
      flowId: requestMeta?.flowId,
      requestId: requestMeta?.requestId,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      revisionId: getIdString(revision?._id),
      durationMs: durationMs(startedAt),
      mediaReferenceCount: response.mediaReferenceCount,
      blockingCount: Array.isArray(response.validationSnapshot?.blocking) ? response.validationSnapshot.blocking.length : 0,
      warningCount: Array.isArray(response.validationSnapshot?.warnings) ? response.validationSnapshot.warnings.length : 0
    });
    return response;
  };

  return {
    getArticleOverview,
    getCurrentArticle,
    getCurrentArticleSideData,
    getRevisionDetail,
    getRevisionValidation,
    listMyEdits,
    listRevisions
  };
};

module.exports = {
  createSenseArticleReadService
};
