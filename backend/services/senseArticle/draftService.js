const createSenseArticleDraftService = ({
  CONTENT_FORMATS,
  DRAFT_EDITABLE_STATUSES,
  SenseArticle,
  SenseArticleRevision,
  User,
  buildRevisionBootstrapResponse,
  buildRevisionMediaAndValidation,
  buildRevisionMutationResponse,
  canUserUpdateSenseMetadata,
  convertLegacyMarkupToRichHtml,
  createAnchorFromSelection,
  createExposeError,
  detectContentFormat,
  diagLog,
  diagWarn,
  durationMs,
  ensurePermission,
  ensureRevisionDerivedState,
  extractMediaUrlsFromEditorSource,
  extractReferenceUrls,
  getArticleBundle,
  getIdString,
  materializeRevisionPayload,
  normalizeTrimmedText,
  nowMs,
  promoteMediaAssets,
  releaseTemporaryMediaSession,
  resolveProposedSenseTitle,
  resolveRevisionTitleInput,
  scheduleArticleMediaMaintenance,
  serializeArticleSummary,
  serializePermissions,
  syncAndPruneArticleMedia
} = {}) => {
  const normalizeScopedChangePayload = (payload = {}) => {
    if (!payload || typeof payload !== 'object') return null;
    const mode = String(payload.mode || payload.scopeMode || '').trim();
    if (!['selection', 'section'].includes(mode)) return null;
    return {
      mode,
      headingTitle: typeof payload.headingTitle === 'string' ? payload.headingTitle.trim() : '',
      originalText: typeof payload.originalText === 'string' ? payload.originalText : '',
      currentText: typeof payload.currentText === 'string' ? payload.currentText : '',
      resolveMessage: typeof payload.resolveMessage === 'string' ? payload.resolveMessage.trim() : ''
    };
  };

  const getNextRevisionNumber = async (articleId) => {
    const latest = await SenseArticleRevision.findOne({ articleId }).sort({ revisionNumber: -1 }).select('revisionNumber').lean();
    return (latest?.revisionNumber || 0) + 1;
  };

  const createDraftRevision = async ({ nodeId, senseId, userId, payload = {}, requestMeta = null }) => {
    const startedAt = nowMs();
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    ensurePermission(bundle.permissions.canCreateRevision, '当前用户无法创建百科修订');
    const proposer = await User.findById(userId).select('_id username').lean();
    const requestedBaseId = getIdString(payload.baseRevisionId) || getIdString(bundle.article.currentRevisionId);
    const baseRevision = requestedBaseId
      ? await SenseArticleRevision.findOne({ _id: requestedBaseId, articleId: bundle.article._id })
      : bundle.currentRevision;
    const requestedContentFormat = detectContentFormat({
      contentFormat: payload.contentFormat || CONTENT_FORMATS.RICH_HTML,
      editorSource: payload.editorSource
    });
    let editorSource = typeof payload.editorSource === 'string' && payload.editorSource.trim()
      ? payload.editorSource
      : (baseRevision?.editorSource || bundle.currentRevision?.editorSource || bundle.nodeSense.content || '');
    if (requestedContentFormat === CONTENT_FORMATS.RICH_HTML && detectContentFormat({
      contentFormat: baseRevision?.contentFormat || bundle.currentRevision?.contentFormat || bundle.nodeSense?.contentFormat,
      editorSource
    }) === CONTENT_FORMATS.LEGACY_MARKUP) {
      editorSource = convertLegacyMarkupToRichHtml(editorSource);
    }
    const revisionNumber = await getNextRevisionNumber(bundle.article._id);
    const materialized = await materializeRevisionPayload({
      editorSource,
      contentFormat: requestedContentFormat,
      baseRevision,
      requestMeta: {
        ...requestMeta,
        nodeId,
        senseId
      }
    });
    const revisionTitle = resolveRevisionTitleInput({
      revisionTitle: payload.revisionTitle,
      fallbackUsername: proposer?.username || ''
    });
    const proposedSenseTitle = await resolveProposedSenseTitle({
      bundle,
      senseId,
      proposedSenseTitle: payload.proposedSenseTitle,
      allowChange: canUserUpdateSenseMetadata(bundle.permissions)
    });
    const selectedAnchor = payload.sourceMode === 'selection' || payload.selectedRangeAnchor
      ? createAnchorFromSelection({
          revision: baseRevision || bundle.currentRevision,
          blockId: payload?.selectedRangeAnchor?.blockId || '',
          headingId: payload?.selectedRangeAnchor?.headingId || payload?.targetHeadingId || '',
          selectionText: payload?.selectedRangeAnchor?.selectionText || payload?.selectedRangeAnchor?.textQuote || '',
          textPositionStart: payload?.selectedRangeAnchor?.textPositionStart,
          textPositionEnd: payload?.selectedRangeAnchor?.textPositionEnd,
          prefixText: payload?.selectedRangeAnchor?.prefixText || payload?.selectedRangeAnchor?.beforeText || '',
          suffixText: payload?.selectedRangeAnchor?.suffixText || payload?.selectedRangeAnchor?.afterText || ''
        })
      : null;
    const draft = await SenseArticleRevision.create({
      articleId: bundle.article._id,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      revisionNumber,
      baseRevisionId: baseRevision?._id || null,
      parentRevisionId: getIdString(payload.parentRevisionId) || baseRevision?._id || null,
      sourceMode: payload.sourceMode || 'full',
      contentFormat: materialized.contentFormat,
      selectedRangeAnchor: selectedAnchor,
      targetHeadingId: typeof payload.targetHeadingId === 'string' ? payload.targetHeadingId.trim() : '',
      editorSource: materialized.editorSource,
      ast: materialized.ast,
      headingIndex: materialized.headingIndex,
      referenceIndex: materialized.referenceIndex,
      formulaRefs: materialized.formulaRefs,
      symbolRefs: materialized.symbolRefs,
      parseErrors: materialized.parseErrors,
      plainTextSnapshot: materialized.plainTextSnapshot,
      renderSnapshot: materialized.renderSnapshot,
      diffFromBase: materialized.diffFromBase,
      mediaReferences: [],
      validationSnapshot: null,
      scopedChange: normalizeScopedChangePayload(payload.scopedChange),
      proposerId: userId,
      proposerNote: typeof payload.proposerNote === 'string' ? payload.proposerNote.trim() : '',
      revisionTitle,
      proposedSenseTitle,
      status: 'draft',
      reviewStage: 'domain_admin'
    });
    await SenseArticle.updateOne({ _id: bundle.article._id }, {
      $set: {
        latestDraftRevisionId: draft._id,
        contentFormat: draft.contentFormat || requestedContentFormat,
        updatedBy: userId,
        updatedAt: new Date()
      }
    });
    const tempMediaSessionId = typeof payload.tempMediaSessionId === 'string' ? payload.tempMediaSessionId.trim() : '';
    if (tempMediaSessionId) {
      await promoteMediaAssets({
        articleId: bundle.article._id,
        nodeId: bundle.nodeId,
        senseId: bundle.senseId,
        urls: Array.from(new Set([
          ...extractMediaUrlsFromEditorSource(materialized.editorSource)
        ]))
      });
      await releaseTemporaryMediaSession({
        articleId: bundle.article._id,
        nodeId: bundle.nodeId,
        senseId: bundle.senseId,
        tempSessionId: tempMediaSessionId
      });
    }
    ensureRevisionDerivedState({
      revision: draft,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      persist: true,
      requestMeta
    }).catch((error) => {
      diagWarn('sense.revision.create_draft.derived_state_fail', {
        flowId: requestMeta?.flowId,
        requestId: requestMeta?.requestId,
        nodeId: bundle.nodeId,
        senseId: bundle.senseId,
        revisionId: getIdString(draft?._id),
        errorName: error?.name || 'Error',
        errorMessage: error?.message || 'create draft derived state failed'
      });
    });
    scheduleArticleMediaMaintenance({
      articleId: bundle.article._id,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      trigger: 'create_draft_revision'
    });
    const response = buildRevisionBootstrapResponse({
      node: bundle.node,
      nodeSense: bundle.nodeSense,
      article: bundle.article,
      revision: draft,
      permissions: bundle.permissions,
      userId,
      requestMeta
    });
    diagLog('sense.revision.create_draft.bootstrap', {
      flowId: requestMeta?.flowId,
      requestId: requestMeta?.requestId,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      revisionId: getIdString(draft?._id),
      durationMs: durationMs(startedAt)
    });
    return response;
  };

  const updateDraftRevision = async ({ nodeId, senseId, revisionId, userId, payload = {}, requestMeta = null }) => {
    const startedAt = nowMs();
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    const revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
    if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'expectedRevisionVersion')) {
      const expectedRevisionVersion = Number(payload.expectedRevisionVersion);
      if (Number.isFinite(expectedRevisionVersion) && expectedRevisionVersion !== Number(revision.__v || 0)) {
        throw createExposeError(
          '当前草稿已被其他保存更新，请刷新后确认差异再继续编辑',
          409,
          'revision_edit_conflict',
          {
            serverRevisionVersion: Number(revision.__v || 0),
            serverUpdatedAt: revision.updatedAt || null
          }
        );
      }
    }
    const currentUserId = getIdString(userId);
    ensurePermission(getIdString(revision.proposerId) === currentUserId || bundle.permissions.isSystemAdmin, '仅发起人或系统管理员可编辑草稿');
    ensurePermission(DRAFT_EDITABLE_STATUSES.includes(revision.status), '当前修订状态不可编辑');
    const proposer = await User.findById(revision.proposerId).select('_id username').lean();
    const baseRevision = revision.baseRevisionId ? await SenseArticleRevision.findById(revision.baseRevisionId) : null;
    const nextContentFormat = detectContentFormat({
      contentFormat: payload.contentFormat || revision.contentFormat || bundle.article?.contentFormat || CONTENT_FORMATS.LEGACY_MARKUP,
      editorSource: typeof payload.editorSource === 'string' ? payload.editorSource : revision.editorSource
    });
    const editorSource = typeof payload.editorSource === 'string' ? payload.editorSource : revision.editorSource;
    const materialized = await materializeRevisionPayload({
      editorSource,
      contentFormat: nextContentFormat,
      baseRevision,
      requestMeta: {
        ...requestMeta,
        nodeId,
        senseId,
        revisionId
      }
    });
    const derived = await buildRevisionMediaAndValidation({
      revisionLike: {
        _id: revision._id,
        nodeId: bundle.nodeId,
        senseId: bundle.senseId,
        ...materialized
      },
      nodeId: bundle.nodeId,
      senseId: bundle.senseId
    });
    revision.contentFormat = materialized.contentFormat;
    revision.editorSource = materialized.editorSource;
    revision.ast = materialized.ast;
    revision.headingIndex = materialized.headingIndex;
    revision.referenceIndex = materialized.referenceIndex;
    revision.formulaRefs = materialized.formulaRefs;
    revision.symbolRefs = materialized.symbolRefs;
    revision.parseErrors = materialized.parseErrors;
    revision.plainTextSnapshot = materialized.plainTextSnapshot;
    revision.renderSnapshot = materialized.renderSnapshot;
    revision.diffFromBase = materialized.diffFromBase;
    revision.mediaReferences = derived.mediaReferences;
    revision.validationSnapshot = derived.validationSnapshot;
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'scopedChange')) revision.scopedChange = normalizeScopedChangePayload(payload.scopedChange);
    if (typeof payload.proposerNote === 'string') revision.proposerNote = payload.proposerNote.trim();
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'revisionTitle')) {
      revision.revisionTitle = resolveRevisionTitleInput({
        revisionTitle: payload.revisionTitle,
        fallbackUsername: proposer?.username || ''
      });
    } else if (!normalizeTrimmedText(revision.revisionTitle)) {
      revision.revisionTitle = resolveRevisionTitleInput({
        revisionTitle: revision.revisionTitle,
        fallbackUsername: proposer?.username || ''
      });
    }
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'proposedSenseTitle') || !normalizeTrimmedText(revision.proposedSenseTitle)) {
      revision.proposedSenseTitle = await resolveProposedSenseTitle({
        bundle,
        senseId,
        proposedSenseTitle: Object.prototype.hasOwnProperty.call(payload || {}, 'proposedSenseTitle') ? payload.proposedSenseTitle : revision.proposedSenseTitle,
        allowChange: canUserUpdateSenseMetadata(bundle.permissions)
      });
    }
    if (payload.selectedRangeAnchor) {
      revision.selectedRangeAnchor = createAnchorFromSelection({
        revision: baseRevision || bundle.currentRevision,
        blockId: payload.selectedRangeAnchor.blockId,
        headingId: payload.selectedRangeAnchor.headingId || payload.targetHeadingId || revision.targetHeadingId,
        selectionText: payload.selectedRangeAnchor.selectionText || payload.selectedRangeAnchor.textQuote || '',
        textPositionStart: payload.selectedRangeAnchor.textPositionStart,
        textPositionEnd: payload.selectedRangeAnchor.textPositionEnd,
        prefixText: payload.selectedRangeAnchor.prefixText || payload.selectedRangeAnchor.beforeText || '',
        suffixText: payload.selectedRangeAnchor.suffixText || payload.selectedRangeAnchor.afterText || ''
      });
    }
    if (typeof payload.targetHeadingId === 'string') revision.targetHeadingId = payload.targetHeadingId.trim();
    await revision.save();
    await SenseArticle.updateOne({ _id: bundle.article._id }, {
      $set: {
        latestDraftRevisionId: revision._id,
        contentFormat: revision.contentFormat || nextContentFormat,
        updatedBy: userId
      }
    });
    const tempMediaSessionId = typeof payload.tempMediaSessionId === 'string' ? payload.tempMediaSessionId.trim() : '';
    if (tempMediaSessionId) {
      await promoteMediaAssets({
        articleId: bundle.article._id,
        nodeId: bundle.nodeId,
        senseId: bundle.senseId,
        urls: Array.from(new Set([
          ...extractReferenceUrls(derived.mediaReferences),
          ...extractMediaUrlsFromEditorSource(materialized.editorSource)
        ]))
      });
      await releaseTemporaryMediaSession({
        articleId: bundle.article._id,
        nodeId: bundle.nodeId,
        senseId: bundle.senseId,
        tempSessionId: tempMediaSessionId
      });
    }
    scheduleArticleMediaMaintenance({
      articleId: bundle.article._id,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      trigger: 'update_draft_revision'
    });
    const response = buildRevisionMutationResponse({
      article: bundle.article,
      revision,
      permissions: bundle.permissions,
      userId
    });
    diagLog('sense.revision.update_draft', {
      flowId: requestMeta?.flowId,
      requestId: requestMeta?.requestId,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      revisionId: getIdString(revision?._id),
      durationMs: durationMs(startedAt),
      contentFormat: revision?.contentFormat || '',
      sourceMode: revision?.sourceMode || 'full',
      editorSourceLength: typeof revision?.editorSource === 'string' ? revision.editorSource.length : 0,
      plainTextLength: typeof revision?.plainTextSnapshot === 'string' ? revision.plainTextSnapshot.length : 0,
      headingCount: Array.isArray(revision?.headingIndex) ? revision.headingIndex.length : 0,
      blockingCodes: Array.isArray(revision?.validationSnapshot?.blocking) ? revision.validationSnapshot.blocking.map((item) => item?.code || '').filter(Boolean) : []
    });
    return response;
  };

  const deleteDraftRevision = async ({ nodeId, senseId, revisionId, userId }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    const revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
    if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');

    const currentUserId = getIdString(userId);
    ensurePermission(getIdString(revision.proposerId) === currentUserId || bundle.permissions.isSystemAdmin, '仅发起人或系统管理员可放弃草稿');
    ensurePermission(DRAFT_EDITABLE_STATUSES.includes(revision.status), '仅未提交审核的修订可以放弃');

    await SenseArticleRevision.deleteOne({ _id: revision._id, articleId: bundle.article._id });

    const fallbackDraft = await SenseArticleRevision.findOne({
      articleId: bundle.article._id,
      status: { $in: DRAFT_EDITABLE_STATUSES }
    }).sort({ updatedAt: -1, createdAt: -1, revisionNumber: -1 }).select('_id').lean();

    const latestDraftId = getIdString(bundle.article.latestDraftRevisionId);
    const removedDraftId = getIdString(revision._id);
    if (latestDraftId === removedDraftId || !latestDraftId) {
      await SenseArticle.updateOne({ _id: bundle.article._id }, {
        $set: {
          latestDraftRevisionId: fallbackDraft?._id || null,
          updatedBy: userId,
          updatedAt: new Date()
        }
      });
    }
    await syncAndPruneArticleMedia({
      articleId: bundle.article._id,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId
    });

    return {
      ok: true,
      deletedRevisionId: removedDraftId,
      article: serializeArticleSummary({
        ...(bundle.article.toObject?.() || bundle.article),
        latestDraftRevisionId: fallbackDraft?._id || null
      }),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  };

  return {
    createDraftRevision,
    deleteDraftRevision,
    updateDraftRevision
  };
};

module.exports = {
  createSenseArticleDraftService
};
