const mongoose = require('mongoose');
const { parse } = require('node-html-parser');

const createSenseArticleCoreService = ({
  CONTENT_FORMATS,
  EntropyAlliance,
  Node,
  NodeSense,
  NodeSenseFavorite,
  SenseArticle,
  SenseArticleRevision,
  User,
  buildCleanupBucketRunAt,
  buildLegacyArticleSeed,
  buildRevisionComparePayload,
  buildSummary,
  createExposeError,
  detectContentFormat,
  diagLog,
  diagWarn,
  durationMs,
  ensurePermission,
  getIdString,
  getUserRoleInfo,
  hydrateMediaReferenceAssets,
  hydrateNodeSensesForNodes,
  isValidObjectId,
  listMediaAssetsForEditor,
  materializeRevisionContent,
  nowMs,
  refreshArticleMediaReferenceState,
  releaseTemporaryMediaSession,
  saveNodeSenses,
  schedulerService,
  serializeArticleSummary,
  serializePermissions,
  serializeRevisionBootstrap,
  serializeRevisionMutationResult,
  syncDomainTitleProjectionFromNode,
  toObjectIdOrNull,
  validateRevisionContent,
  extractMediaReferencesFromRevision,
  pruneExpiredTemporaryMediaAssets,
  pruneUnreferencedMediaAssets
} = {}) => {
  const normalizeTrimmedText = (value = '') => (typeof value === 'string' ? value.trim() : '');

  const serializeAllianceThemePayload = (alliance = null) => {
    if (!alliance || typeof alliance !== 'object') return null;
    return {
      _id: alliance._id || null,
      name: alliance.name || '',
      flag: alliance.flag || '',
      visualStyles: Array.isArray(alliance.visualStyles) ? alliance.visualStyles : [],
      activeVisualStyleId: alliance.activeVisualStyleId || null,
      senseArticleStyles: Array.isArray(alliance.senseArticleStyles) ? alliance.senseArticleStyles : [],
      activeSenseArticleStyleId: alliance.activeSenseArticleStyleId || null
    };
  };

  const enrichNodeDomainMasterAlliance = async (node = null) => {
    if (!node || typeof node !== 'object') return node;
    const domainMasterId = getIdString(node.domainMaster);
    if (!domainMasterId) return node;

    const domainMasterUser = await User.findById(domainMasterId)
      .select('_id username avatar profession allianceId')
      .lean();
    if (!domainMasterUser) return node;

    const allianceId = getIdString(domainMasterUser.allianceId);
    const alliance = allianceId
      ? await EntropyAlliance.findById(allianceId)
        .select('_id name flag visualStyles activeVisualStyleId senseArticleStyles activeSenseArticleStyleId')
        .lean()
      : null;

    return {
      ...node,
      domainMaster: {
        _id: domainMasterUser._id || null,
        username: domainMasterUser.username || '',
        avatar: domainMasterUser.avatar || '',
        profession: domainMasterUser.profession || '',
        allianceId: domainMasterUser.allianceId || null,
        alliance: serializeAllianceThemePayload(alliance)
      }
    };
  };

  const resolveSenseArticleReadingMeta = async ({ revision = null, nodeId = '', senseId = '' }) => {
    const favoritePromise = (nodeId && senseId)
      ? NodeSenseFavorite.countDocuments({ nodeId: toObjectIdOrNull(nodeId), senseId: String(senseId || '').trim() })
      : Promise.resolve(0);

    const preferredAuthorId = getIdString(revision?.proposerId || revision?.publishedBy);
    const authorPromise = preferredAuthorId
      ? User.findById(preferredAuthorId).select('_id username avatar profession').lean()
      : Promise.resolve(null);

    const [favoriteCount, author] = await Promise.all([favoritePromise, authorPromise]);
    return {
      favoriteCount: Number(favoriteCount || 0),
      revisionAuthor: author ? {
        _id: author._id || null,
        username: author.username || '',
        avatar: author.avatar || '',
        profession: author.profession || ''
      } : null
    };
  };

  const ensureNodeAndSense = async (nodeId, senseId) => {
    const safeNodeId = getIdString(nodeId);
    const safeSenseId = String(senseId || '').trim();
    if (!isValidObjectId(safeNodeId) || !safeSenseId) {
      throw createExposeError('无效的知识域或释义标识', 400, 'invalid_article_key');
    }
    const [node, nodeSense] = await Promise.all([
      Node.findById(safeNodeId)
        .select('_id name description status domainMaster domainAdmins domainAdminPermissions owner synonymSenses associations')
        .lean(),
      NodeSense.findOne({ nodeId: safeNodeId, senseId: safeSenseId }).lean()
    ]);
    if (!node) throw createExposeError('知识域不存在', 404, 'node_not_found');

    let effectiveSense = nodeSense;
    if (!effectiveSense) {
      const embeddedSense = (Array.isArray(node.synonymSenses) ? node.synonymSenses : []).find((item) => item?.senseId === safeSenseId);
      if (embeddedSense) {
        effectiveSense = {
          nodeId: node._id,
          senseId: safeSenseId,
          title: embeddedSense.title || '未命名释义',
          content: embeddedSense.content || node.description || '',
          legacySummary: embeddedSense.content || node.description || '',
          order: 0,
          status: 'active'
        };
      }
    }
    if (!effectiveSense) throw createExposeError('释义不存在', 404, 'sense_not_found');
    const enrichedNode = await enrichNodeDomainMasterAlliance(node);
    return {
      node: enrichedNode,
      nodeSense: effectiveSense,
      nodeId: safeNodeId,
      senseId: safeSenseId
    };
  };

  const resolveReferenceTargets = async (referenceIndex = []) => {
    const references = Array.isArray(referenceIndex) ? referenceIndex : [];
    const uniquePairs = Array.from(new Set(
      references.map((item) => `${item.targetNodeId || ''}:${item.targetSenseId || ''}`).filter((item) => item !== ':')
    ));
    if (uniquePairs.length === 0) return [];

    const nodeIds = Array.from(new Set(uniquePairs.map((item) => item.split(':')[0]).filter((item) => isValidObjectId(item))));
    const [nodes, nodeSenses, articles] = await Promise.all([
      Node.find({ _id: { $in: nodeIds } }).select('_id name').lean(),
      NodeSense.find({ nodeId: { $in: nodeIds } }).select('nodeId senseId title').lean(),
      SenseArticle.find({ nodeId: { $in: nodeIds } }).select('_id nodeId senseId currentRevisionId').lean()
    ]);
    const nodeNameMap = new Map(nodes.map((item) => [String(item._id), item.name || '']));
    const senseMap = new Map(nodeSenses.map((item) => [`${item.nodeId}:${item.senseId}`, item.title || '']));
    const articleMap = new Map(articles.map((item) => [`${item.nodeId}:${item.senseId}`, item]));

    return references.map((item) => {
      const key = `${item.targetNodeId || ''}:${item.targetSenseId || ''}`;
      const senseTitle = senseMap.get(key) || '';
      const article = articleMap.get(key) || null;
      return {
        ...item,
        isValid: !!senseTitle,
        targetTitle: senseTitle,
        targetNodeName: nodeNameMap.get(String(item.targetNodeId || '')) || '',
        targetArticleId: article?._id || null,
        targetCurrentRevisionId: article?.currentRevisionId || null
      };
    });
  };

  const hydrateReferencePreviewEntries = async (referenceIndex = []) => {
    const resolved = await resolveReferenceTargets(referenceIndex);
    const revisionIds = Array.from(new Set(resolved.map((item) => getIdString(item.targetCurrentRevisionId)).filter(Boolean)));
    if (revisionIds.length === 0) {
      return resolved.map((item) => ({
        ...item,
        targetSummary: '',
        targetStatus: item.isValid ? 'unpublished' : 'missing',
        targetPublishedAt: null
      }));
    }
    const revisions = await SenseArticleRevision.find({ _id: { $in: revisionIds } })
      .select('_id plainTextSnapshot publishedAt status')
      .lean();
    const revisionMap = new Map(revisions.map((item) => [String(item._id), item]));
    return resolved.map((item) => {
      const revision = revisionMap.get(getIdString(item.targetCurrentRevisionId)) || null;
      return {
        ...item,
        targetSummary: revision?.plainTextSnapshot ? buildSummary(revision.plainTextSnapshot) : '',
        targetStatus: !item.isValid ? 'missing' : (revision ? (revision.status || 'published') : 'unpublished'),
        targetPublishedAt: revision?.publishedAt || null
      };
    });
  };

  const materializeRevisionPayload = async ({ editorSource, contentFormat = CONTENT_FORMATS.LEGACY_MARKUP, baseRevision = null, requestMeta = null }) => {
    const totalStartedAt = nowMs();
    const parseStartedAt = nowMs();
    const parsed = materializeRevisionContent({ editorSource, contentFormat });
    const parseMs = durationMs(parseStartedAt);
    const resolveRefsStartedAt = nowMs();
    const referenceIndex = await resolveReferenceTargets(parsed.referenceIndex);
    const resolveRefsMs = durationMs(resolveRefsStartedAt);
    const candidateRevision = {
      contentFormat: parsed.contentFormat || contentFormat,
      editorSource: parsed.editorSource,
      ast: parsed.ast,
      headingIndex: parsed.headingIndex,
      referenceIndex,
      formulaRefs: parsed.formulaRefs,
      symbolRefs: parsed.symbolRefs
    };
    const buildDiffStartedAt = nowMs();
    const diffFromBase = buildRevisionComparePayload({ fromRevision: baseRevision, toRevision: candidateRevision });
    const buildDiffMs = durationMs(buildDiffStartedAt);
    diagLog('sense.service.materialize_payload', {
      flowId: requestMeta?.flowId,
      requestId: requestMeta?.requestId,
      nodeId: requestMeta?.nodeId,
      senseId: requestMeta?.senseId,
      revisionId: requestMeta?.revisionId,
      parseMs,
      resolveRefsMs,
      buildDiffMs,
      totalMs: durationMs(totalStartedAt),
      contentFormat: parsed.contentFormat || contentFormat,
      editorSourceLength: typeof parsed.editorSource === 'string' ? parsed.editorSource.length : 0,
      blockCount: Array.isArray(parsed.ast?.blocks) ? parsed.ast.blocks.length : 0,
      headingCount: Array.isArray(parsed.headingIndex) ? parsed.headingIndex.length : 0,
      referenceCount: Array.isArray(referenceIndex) ? referenceIndex.length : 0,
      diffSectionCount: Array.isArray(diffFromBase?.sections) ? diffFromBase.sections.length : 0,
      parseErrors: Array.isArray(parsed.parseErrors) ? parsed.parseErrors.length : 0
    });
    return {
      ...parsed,
      referenceIndex,
      diffFromBase
    };
  };

  const buildRevisionMediaAndValidation = async ({ revisionLike = null, nodeId = '', senseId = '' } = {}) => {
    const rawMediaReferences = extractMediaReferencesFromRevision({ revision: revisionLike, nodeId, senseId });
    const mediaReferences = await hydrateMediaReferenceAssets({
      nodeId: getIdString(nodeId || revisionLike?.nodeId),
      senseId: String(senseId || revisionLike?.senseId || '').trim(),
      references: rawMediaReferences
    });
    const revisionForValidation = revisionLike?.toObject
      ? {
          ...revisionLike.toObject(),
          mediaReferences
        }
      : {
          ...(revisionLike || {}),
          mediaReferences
        };
    const validationSnapshot = validateRevisionContent({
      revision: revisionForValidation,
      mediaReferences
    });
    return {
      mediaReferences,
      validationSnapshot
    };
  };

  const assertRevisionValidationBeforeWorkflow = ({ validationSnapshot = null, phase = 'submit' } = {}) => {
    if (!validationSnapshot?.hasBlockingIssues) return;
    const label = phase === 'publish' ? '发布' : '提交';
    const blockingMessages = (Array.isArray(validationSnapshot?.blocking) ? validationSnapshot.blocking : [])
      .map((item) => String(item?.message || '').trim())
      .filter(Boolean);
    const detailMessage = blockingMessages.slice(0, 3).join('；');
    diagWarn('sense.validation.blocked_workflow', {
      phase,
      blockingCount: Array.isArray(validationSnapshot?.blocking) ? validationSnapshot.blocking.length : 0
    });
    throw createExposeError(
      detailMessage
        ? `${label}前校验失败：${detailMessage}${blockingMessages.length > 3 ? `；另有 ${blockingMessages.length - 3} 项问题` : ''}`
        : `${label}前校验失败，请先修复正文中的阻塞问题`,
      409,
      'revision_validation_failed',
      { validation: validationSnapshot }
    );
  };

  const syncLegacySenseMirror = async ({ nodeId, senseId, nodeSense, editorSource, plainTextSnapshot, actorUserId }) => {
    const filter = { nodeId: toObjectIdOrNull(nodeId), senseId: String(senseId || '').trim() };
    const legacySummary = buildSummary(plainTextSnapshot);
    await NodeSense.updateOne(filter, {
      $set: {
        title: nodeSense?.title || '未命名释义',
        content: editorSource,
        contentFormat: detectContentFormat({ editorSource }),
        legacySummary,
        updatedBy: actorUserId || null
      },
      $setOnInsert: {
        createdBy: actorUserId || nodeSense?.createdBy || null,
        order: Number.isFinite(Number(nodeSense?.order)) ? Number(nodeSense.order) : 0,
        status: 'active'
      }
    }, { upsert: true });
  };

  const getArticleBundle = async ({ nodeId, senseId, userId, createIfMissing = true }) => {
    const base = await ensureNodeAndSense(nodeId, senseId);
    const permissions = await getUserRoleInfo(userId, base.node);
    let article = await SenseArticle.findOne({ nodeId: base.nodeId, senseId: base.senseId });

    if (!article && createIfMissing) {
      const initialContentFormat = detectContentFormat({
        contentFormat: base.nodeSense.contentFormat,
        editorSource: base.nodeSense.content || ''
      });
      const materialized = await materializeRevisionPayload({
        editorSource: base.nodeSense.content || '',
        contentFormat: initialContentFormat
      });
      const articleId = new mongoose.Types.ObjectId();
      const seed = buildLegacyArticleSeed({
        nodeId: base.nodeId,
        senseId: base.senseId,
        articleId,
        editorSource: base.nodeSense.content || '',
        proposerId: base.nodeSense.updatedBy || base.node.domainMaster || base.node.owner || userId,
        createdAt: base.nodeSense.createdAt || new Date(),
        updatedAt: base.nodeSense.updatedAt || base.nodeSense.createdAt || new Date(),
        referenceIndex: materialized.referenceIndex
      });
      seed.article.summary = buildSummary(materialized.plainTextSnapshot);
      seed.revision.contentFormat = initialContentFormat;
      seed.revision.editorSource = materialized.editorSource;
      seed.revision.parseErrors = materialized.parseErrors;
      seed.revision.ast = materialized.ast;
      seed.revision.headingIndex = materialized.headingIndex;
      seed.revision.formulaRefs = materialized.formulaRefs;
      seed.revision.symbolRefs = materialized.symbolRefs;
      seed.revision.plainTextSnapshot = materialized.plainTextSnapshot;
      seed.revision.renderSnapshot = materialized.renderSnapshot;
      const derived = await buildRevisionMediaAndValidation({
        revisionLike: {
          nodeId: base.nodeId,
          senseId: base.senseId,
          ...materialized
        },
        nodeId: base.nodeId,
        senseId: base.senseId
      });
      seed.revision.mediaReferences = derived.mediaReferences;
      seed.revision.validationSnapshot = derived.validationSnapshot;
      const revision = await SenseArticleRevision.create(seed.revision);
      article = await SenseArticle.create({
        ...seed.article,
        contentFormat: initialContentFormat,
        currentRevisionId: revision._id,
        latestDraftRevisionId: null
      });
    }

    const currentRevision = article?.currentRevisionId
      ? await SenseArticleRevision.findById(article.currentRevisionId)
      : null;

    return {
      ...base,
      article,
      currentRevision,
      permissions
    };
  };

  const bootstrapArticleFromNodeSense = async ({ nodeId, senseId, userId }) => (
    getArticleBundle({ nodeId, senseId, userId, createIfMissing: true })
  );

  const extractReferenceUrls = (mediaReferences = []) => (
    Array.from(new Set((Array.isArray(mediaReferences) ? mediaReferences : [])
      .map((item) => String(item?.url || '').trim())
      .filter(Boolean)))
  );

  const extractMediaUrlsFromEditorSource = (editorSource = '') => {
    const source = String(editorSource || '').trim();
    if (!source) return [];
    try {
      const root = parse(`<div class="sense-rich-root">${source}</div>`);
      const container = root.querySelector('.sense-rich-root');
      const urls = (container?.querySelectorAll?.('img, audio, video') || [])
        .map((element) => String(element.getAttribute('src') || '').trim())
        .filter(Boolean);
      return Array.from(new Set(urls));
    } catch (_error) {
      return [];
    }
  };

  const enqueueTemporaryMediaCleanup = async ({ runAt = new Date() } = {}) => {
    const cleanupAt = buildCleanupBucketRunAt(runAt);
    const bucket = cleanupAt.toISOString().slice(0, 16);
    await schedulerService.enqueue({
      type: 'sense_article_temp_media_cleanup_tick',
      runAt: cleanupAt,
      payload: {},
      dedupeKey: `sense_article_temp_media_cleanup:${bucket}`
    });
  };

  const pruneArticleMedia = async ({ articleId = null, nodeId = '', senseId = '', now = new Date() } = {}) => {
    await pruneExpiredTemporaryMediaAssets({
      articleId,
      nodeId: toObjectIdOrNull(nodeId),
      senseId,
      now
    });
    return pruneUnreferencedMediaAssets({
      articleId,
      nodeId: toObjectIdOrNull(nodeId),
      senseId
    });
  };

  const syncAndPruneArticleMedia = async ({ articleId = null, nodeId = '', senseId = '' } = {}) => {
    await refreshArticleMediaReferenceState({ articleId, nodeId, senseId });
    return pruneArticleMedia({
      articleId,
      nodeId,
      senseId
    });
  };

  const serializeMediaAsset = (asset = {}) => ({
    _id: asset?._id || null,
    nodeId: asset?.nodeId || null,
    senseId: asset?.senseId || '',
    articleId: asset?.articleId || null,
    revisionId: asset?.revisionId || null,
    kind: asset?.kind || 'image',
    originalName: asset?.originalName || '',
    fileName: asset?.fileName || '',
    url: asset?.url || '',
    mimeType: asset?.mimeType || '',
    size: Number(asset?.size || 0),
    fileSize: Number(asset?.fileSize || asset?.size || 0),
    width: Number.isFinite(Number(asset?.width)) ? Number(asset.width) : null,
    height: Number.isFinite(Number(asset?.height)) ? Number(asset.height) : null,
    duration: Number.isFinite(Number(asset?.duration)) ? Number(asset.duration) : null,
    alt: asset?.alt || '',
    caption: asset?.caption || '',
    title: asset?.title || '',
    description: asset?.description || '',
    posterUrl: asset?.posterUrl || '',
    status: asset?.status || 'uploaded',
    isTemporary: !!asset?.isTemporary,
    tempSessionId: asset?.tempSessionId || '',
    tempExpiresAt: asset?.tempExpiresAt || null,
    referencedRevisionIds: Array.isArray(asset?.referencedRevisionIds) ? asset.referencedRevisionIds : [],
    publishedRevisionIds: Array.isArray(asset?.publishedRevisionIds) ? asset.publishedRevisionIds : [],
    createdAt: asset?.createdAt || null
  });

  const serializeEditorMediaLibrary = (mediaLibrary = {}) => ({
    referencedAssets: Array.isArray(mediaLibrary?.referencedAssets) ? mediaLibrary.referencedAssets.map((item) => serializeMediaAsset(item)) : [],
    recentAssets: Array.isArray(mediaLibrary?.recentAssets) ? mediaLibrary.recentAssets.map((item) => serializeMediaAsset(item)) : [],
    orphanCandidates: Array.isArray(mediaLibrary?.orphanCandidates) ? mediaLibrary.orphanCandidates.map((item) => serializeMediaAsset(item)) : []
  });

  const loadEditorMediaLibrary = async ({ articleId = null, nodeId = '', senseId = '', revisionId = '' } = {}) => {
    const startedAt = nowMs();
    const mediaLibrary = await listMediaAssetsForEditor({
      nodeId,
      senseId,
      articleId,
      revisionId
    });
    diagLog('sense.media.library.load', {
      nodeId: getIdString(nodeId),
      senseId,
      articleId: getIdString(articleId),
      revisionId: getIdString(revisionId),
      durationMs: durationMs(startedAt),
      referencedCount: Array.isArray(mediaLibrary?.referencedAssets) ? mediaLibrary.referencedAssets.length : 0,
      recentCount: Array.isArray(mediaLibrary?.recentAssets) ? mediaLibrary.recentAssets.length : 0,
      orphanCount: Array.isArray(mediaLibrary?.orphanCandidates) ? mediaLibrary.orphanCandidates.length : 0
    });
    return serializeEditorMediaLibrary(mediaLibrary);
  };

  const buildRevisionMutationResponse = ({ article, revision, permissions, userId, mediaLibrary = null }) => ({
    article: serializeArticleSummary(article),
    revision: serializeRevisionMutationResult(revision),
    ...(mediaLibrary ? { mediaLibrary: serializeEditorMediaLibrary(mediaLibrary) } : {}),
    permissions: serializePermissions(permissions, userId)
  });

  const buildRevisionBootstrapResponse = ({ article, revision, permissions, userId, node = null, nodeSense = null, requestMeta = null }) => ({
    ...(node ? { node } : {}),
    ...(nodeSense ? { nodeSense } : {}),
    article: serializeArticleSummary(article),
    revision: serializeRevisionBootstrap(revision, { requestMeta, phase: 'revision_bootstrap' }),
    permissions: serializePermissions(permissions, userId)
  });

  const scheduleArticleMediaMaintenance = ({ articleId = null, nodeId = '', senseId = '', trigger = 'unspecified' } = {}) => {
    const normalizedArticleId = getIdString(articleId);
    const normalizedNodeId = getIdString(nodeId);
    const normalizedSenseId = String(senseId || '').trim();
    setTimeout(async () => {
      const startedAt = nowMs();
      diagLog('sense.media.maintenance.start', {
        trigger,
        articleId: normalizedArticleId,
        nodeId: normalizedNodeId,
        senseId: normalizedSenseId
      });
      try {
        await syncAndPruneArticleMedia({
          articleId: normalizedArticleId,
          nodeId: normalizedNodeId,
          senseId: normalizedSenseId
        });
        diagLog('sense.media.maintenance.finish', {
          trigger,
          articleId: normalizedArticleId,
          nodeId: normalizedNodeId,
          senseId: normalizedSenseId,
          durationMs: durationMs(startedAt)
        });
      } catch (error) {
        diagWarn('sense.media.maintenance.fail', {
          trigger,
          articleId: normalizedArticleId,
          nodeId: normalizedNodeId,
          senseId: normalizedSenseId,
          durationMs: durationMs(startedAt),
          errorName: error?.name || 'Error',
          errorMessage: error?.message || 'media maintenance failed'
        });
      }
    }, 0);
  };

  const ensureRevisionDerivedState = async ({
    revision = null,
    nodeId = '',
    senseId = '',
    persist = true,
    force = false,
    requestMeta = null
  } = {}) => {
    if (!revision) return null;
    const needsMediaReferences = !Array.isArray(revision.mediaReferences) || revision.mediaReferences.length === 0;
    const needsValidationSnapshot = !revision.validationSnapshot;
    if (!force && !needsMediaReferences && !needsValidationSnapshot) return revision;
    const startedAt = nowMs();
    const derived = await buildRevisionMediaAndValidation({
      revisionLike: revision,
      nodeId,
      senseId
    });
    const nextRevision = revision?.toObject
      ? revision
      : {
          ...(revision || {}),
          mediaReferences: derived.mediaReferences,
          validationSnapshot: derived.validationSnapshot
        };
    if (revision) {
      revision.mediaReferences = derived.mediaReferences;
      revision.validationSnapshot = derived.validationSnapshot;
    }
    if (persist && revision?.save) {
      await revision.save();
    }
    diagLog('sense.revision.derived_state', {
      flowId: requestMeta?.flowId,
      requestId: requestMeta?.requestId,
      nodeId: getIdString(nodeId || revision?.nodeId),
      senseId: String(senseId || revision?.senseId || '').trim(),
      revisionId: getIdString(revision?._id),
      persisted: !!(persist && revision?.save),
      forced: !!force,
      durationMs: durationMs(startedAt),
      mediaReferenceCount: Array.isArray(derived.mediaReferences) ? derived.mediaReferences.length : 0,
      blockingCount: Array.isArray(derived.validationSnapshot?.blocking) ? derived.validationSnapshot.blocking.length : 0,
      warningCount: Array.isArray(derived.validationSnapshot?.warnings) ? derived.validationSnapshot.warnings.length : 0
    });
    if (!revision?.toObject) return nextRevision;
    return revision;
  };

  return {
    applyPublishedSenseTitle: async ({ bundle, revision, userId, resolveProposedSenseTitle }) => {
      const nextTitle = await resolveProposedSenseTitle({
        bundle,
        senseId: bundle?.senseId || revision?.senseId || '',
        proposedSenseTitle: revision?.proposedSenseTitle || bundle?.nodeSense?.title || '',
        allowChange: true
      });
      const currentTitle = normalizeTrimmedText(bundle?.nodeSense?.title || '');
      if (!nextTitle || nextTitle === currentTitle) return nextTitle;

      const nodeDoc = await Node.findById(bundle.nodeId).select('_id description synonymSenses').lean();
      if (!nodeDoc) {
        throw createExposeError('知识域不存在', 404, 'node_not_found');
      }
      await hydrateNodeSensesForNodes([nodeDoc]);
      const currentSenses = Array.isArray(nodeDoc.__senseCollectionRows) && nodeDoc.__senseCollectionRows.length > 0
        ? nodeDoc.__senseCollectionRows
        : (Array.isArray(nodeDoc.synonymSenses) ? nodeDoc.synonymSenses : []);
      const nextSenses = currentSenses.map((item) => (
        String(item?.senseId || '').trim() === String(bundle.senseId || '').trim()
          ? { ...item, title: nextTitle, content: typeof item?.content === 'string' ? item.content : String(nodeDoc.description || '').trim() }
          : item
      ));
      await saveNodeSenses({
        nodeId: bundle.nodeId,
        senses: nextSenses,
        actorUserId: userId,
        fallbackDescription: nodeDoc.description || ''
      });
      const freshNode = await Node.findById(bundle.nodeId).select('_id name domainMaster domainAdmins domainAdminPermissions synonymSenses description').lean();
      if (freshNode) {
        await hydrateNodeSensesForNodes([freshNode]);
        await syncDomainTitleProjectionFromNode(freshNode);
      }
      return nextTitle;
    },
    assertRevisionValidationBeforeWorkflow,
    bootstrapArticleFromNodeSense,
    buildRevisionBootstrapResponse,
    buildRevisionMediaAndValidation,
    buildRevisionMutationResponse,
    detectContentFormat,
    ensureNodeAndSense,
    ensureRevisionDerivedState,
    enqueueTemporaryMediaCleanup,
    enrichNodeDomainMasterAlliance,
    extractMediaUrlsFromEditorSource,
    extractReferenceUrls,
    getArticleBundle,
    hydrateReferencePreviewEntries,
    loadEditorMediaLibrary,
    materializeRevisionPayload,
    resolveReferenceTargets,
    resolveSenseArticleReadingMeta,
    scheduleArticleMediaMaintenance,
    serializeMediaAsset,
    syncAndPruneArticleMedia,
    syncLegacySenseMirror
  };
};

module.exports = {
  createSenseArticleCoreService
};
