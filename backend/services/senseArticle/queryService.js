const createSenseArticleQueryService = ({
  DOMAIN_ADMIN_PERMISSION_KEYS,
  Node,
  NodeSense,
  SenseAnnotation,
  SenseArticle,
  SenseArticleRevision,
  assertRevisionReadable,
  buildArticleSearchResult,
  buildRevisionComparePayload,
  buildSummary,
  createExposeError,
  decorateRevisionRecords,
  ensurePermission,
  enrichNodeDomainMasterAlliance,
  getArticleBundle,
  getIdString,
  getUserRoleInfo,
  hasDomainAdminPermission,
  hydrateReferencePreviewEntries,
  relocateAnchor,
  serializeArticleSummary,
  serializeBacklinkEntry,
  serializePermissions,
  serializeReferencePreview,
  serializeRevisionSummary,
  toObjectIdOrNull
} = {}) => {
  const buildBacklinkEntries = ({ revisions = [], targetNodeId = '', targetSenseId = '', nodeMap = new Map(), senseMap = new Map() }) => (
    (Array.isArray(revisions) ? revisions : []).map((revision) => {
      const refs = (revision.referenceIndex || []).filter((item) => getIdString(item.targetNodeId) === getIdString(targetNodeId) && String(item.targetSenseId || '').trim() === String(targetSenseId || '').trim());
      return serializeBacklinkEntry({
        sourceNodeId: revision.nodeId,
        sourceSenseId: revision.senseId,
        sourceNodeName: nodeMap.get(String(revision.nodeId)) || '',
        sourceSenseTitle: senseMap.get(`${revision.nodeId}:${revision.senseId}`) || '',
        sourceArticleId: revision.articleId || null,
        sourceRevisionId: revision._id,
        sourceRevisionNumber: revision.revisionNumber || 0,
        sourcePublishedAt: revision.publishedAt || null,
        referenceCount: refs.length,
        headings: Array.from(new Set(refs.map((item) => item.headingId || '').filter(Boolean))),
        positions: refs.map((item) => item.position).filter((item) => Number.isFinite(Number(item)))
      });
    }).sort((left, right) => (right.referenceCount - left.referenceCount) || String(right.sourcePublishedAt || '').localeCompare(String(left.sourcePublishedAt || '')))
  );

  const buildManagedNodeFilter = async ({ userId, nodeId = '' }) => {
    if (!userId) throw createExposeError('无效用户身份', 401, 'invalid_user');
    const permissionsNode = nodeId ? await Node.findById(nodeId).select('_id domainMaster domainAdmins domainAdminPermissions').lean() : null;
    const roleInfo = permissionsNode ? await getUserRoleInfo(userId, permissionsNode) : await getUserRoleInfo(userId, null);
    if (nodeId) {
      ensurePermission(roleInfo.isSystemAdmin || roleInfo.isDomainMaster || roleInfo.canReviewSenseArticle, '当前用户不能查看该知识域词条管理');
      return { _id: toObjectIdOrNull(nodeId) };
    }
    if (roleInfo.isSystemAdmin) return {};
    return { $or: [{ domainMaster: toObjectIdOrNull(userId) }, { domainAdmins: toObjectIdOrNull(userId) }] };
  };

  const collectAnnotationHealthStats = async ({ userId, nodeIds = [] }) => {
    if (!userId || !Array.isArray(nodeIds) || nodeIds.length === 0) return { exact: 0, relocated: 0, uncertain: 0, broken: 0 };
    const annotations = await SenseAnnotation.find({ userId, nodeId: { $in: nodeIds } }).select('_id anchor articleId').lean();
    if (annotations.length === 0) return { exact: 0, relocated: 0, uncertain: 0, broken: 0 };
    const articleIds = Array.from(new Set(annotations.map((item) => getIdString(item.articleId)).filter(Boolean)));
    const articles = await SenseArticle.find({ _id: { $in: articleIds } }).select('_id currentRevisionId').lean();
    const revisionIds = Array.from(new Set(articles.map((item) => getIdString(item.currentRevisionId)).filter(Boolean)));
    const revisions = await SenseArticleRevision.find({ _id: { $in: revisionIds } }).lean();
    const revisionMap = new Map(revisions.map((item) => [String(item._id), item]));
    const articleMap = new Map(articles.map((item) => [String(item._id), item]));
    return annotations.reduce((acc, annotation) => {
      const article = articleMap.get(getIdString(annotation.articleId));
      const currentRevision = article ? revisionMap.get(getIdString(article.currentRevisionId)) : null;
      const relocation = relocateAnchor({ anchor: annotation.anchor, currentRevision });
      const status = relocation?.status || 'broken';
      if (!Object.prototype.hasOwnProperty.call(acc, status)) acc[status] = 0;
      acc[status] += 1;
      return acc;
    }, { exact: 0, relocated: 0, uncertain: 0, broken: 0 });
  };

  const compareRevisions = async ({ nodeId, senseId, fromRevisionId, toRevisionId, userId }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    const [fromRevision, toRevision] = await Promise.all([
      SenseArticleRevision.findOne({ _id: fromRevisionId, articleId: bundle.article._id }).lean(),
      SenseArticleRevision.findOne({ _id: toRevisionId, articleId: bundle.article._id }).lean()
    ]);
    if (!fromRevision || !toRevision) throw createExposeError('对比修订不存在', 404, 'compare_revision_not_found');
    assertRevisionReadable({ revision: fromRevision, permissions: bundle.permissions, userId });
    assertRevisionReadable({ revision: toRevision, permissions: bundle.permissions, userId });
    return {
      article: serializeArticleSummary(bundle.article),
      fromRevision: serializeRevisionSummary(fromRevision),
      toRevision: serializeRevisionSummary(toRevision),
      compare: buildRevisionComparePayload({ fromRevision, toRevision }),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  };

  const searchCurrentArticle = async ({ nodeId, senseId, userId, query }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    ensurePermission(!!bundle.currentRevision, '当前释义尚无已发布版本', 404);
    return buildArticleSearchResult({ revision: bundle.currentRevision, query });
  };

  const listCurrentReferences = async ({ nodeId, senseId, userId }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    ensurePermission(!!bundle.currentRevision, '当前释义尚无已发布版本', 404);
    const references = await hydrateReferencePreviewEntries(bundle.currentRevision.referenceIndex || []);
    return {
      revisionId: bundle.currentRevision._id,
      references: references.map((item) => serializeReferencePreview(item))
    };
  };

  const searchReferenceTargets = async ({ query }) => {
    const q = String(query || '').trim();
    if (!q) return { query: q, results: [] };
    const keywordRegex = { $regex: q, $options: 'i' };
    const [nodeSenses, revisions, articles] = await Promise.all([
      NodeSense.find({
        $or: [
          { title: keywordRegex },
          { legacySummary: keywordRegex }
        ]
      }).limit(20).lean(),
      SenseArticleRevision.find({
        status: 'published',
        plainTextSnapshot: keywordRegex
      }).select('nodeId senseId plainTextSnapshot').limit(20).lean(),
      SenseArticle.find({}).select('_id nodeId senseId currentRevisionId').limit(200).lean()
    ]);
    const mergedPairs = new Map();
    nodeSenses.forEach((item) => mergedPairs.set(`${item.nodeId}:${item.senseId}`, { nodeId: item.nodeId, senseId: item.senseId, senseTitle: item.title || '', summary: item.legacySummary || '' }));
    revisions.forEach((item) => {
      const key = `${item.nodeId}:${item.senseId}`;
      const previous = mergedPairs.get(key) || { nodeId: item.nodeId, senseId: item.senseId, senseTitle: '', summary: '' };
      if (!previous.summary && item.plainTextSnapshot) previous.summary = buildSummary(item.plainTextSnapshot);
      mergedPairs.set(key, previous);
    });
    const pairs = Array.from(mergedPairs.values()).slice(0, 20);
    const nodeIds = Array.from(new Set(pairs.map((item) => getIdString(item.nodeId)).filter(Boolean)));
    const [nodes, senses] = await Promise.all([
      Node.find({ _id: { $in: nodeIds } }).select('_id name').lean(),
      NodeSense.find({ nodeId: { $in: nodeIds } }).select('nodeId senseId title').lean()
    ]);
    const articleMap = new Map(articles.map((item) => [`${item.nodeId}:${item.senseId}`, item]));
    const nodeMap = new Map(nodes.map((item) => [String(item._id), item.name || '']));
    const senseMap = new Map(senses.map((item) => [`${item.nodeId}:${item.senseId}`, item.title || '']));
    return {
      query: q,
      results: pairs.map((item) => ({
        nodeId: item.nodeId,
        senseId: item.senseId,
        articleId: articleMap.get(`${item.nodeId}:${item.senseId}`)?._id || null,
        currentRevisionId: articleMap.get(`${item.nodeId}:${item.senseId}`)?.currentRevisionId || null,
        nodeName: nodeMap.get(String(item.nodeId)) || '',
        senseTitle: item.senseTitle || senseMap.get(`${item.nodeId}:${item.senseId}`) || '',
        summary: item.summary || '',
        displayLabel: `${nodeMap.get(String(item.nodeId)) || '知识域'} / ${item.senseTitle || senseMap.get(`${item.nodeId}:${item.senseId}`) || item.senseId}`
      }))
    };
  };

  const listBacklinks = async ({ nodeId, senseId, userId }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    ensurePermission(!!bundle.article, '百科页不存在', 404);
    const targetNodeId = getIdString(bundle.nodeId);
    const targetSenseId = String(bundle.senseId || '').trim();
    const revisions = await SenseArticleRevision.find({
      status: 'published',
      referenceIndex: { $elemMatch: { targetNodeId, targetSenseId } }
    }).select('_id nodeId senseId revisionNumber publishedAt referenceIndex articleId').lean();
    if (revisions.length === 0) return { article: serializeArticleSummary(bundle.article), backlinks: [] };
    const revisionIds = revisions.map((item) => item._id);
    const currentArticles = await SenseArticle.find({ currentRevisionId: { $in: revisionIds } }).select('_id nodeId senseId currentRevisionId').lean();
    const currentRevisionIdSet = new Set(currentArticles.map((item) => String(item.currentRevisionId)));
    const currentOnly = revisions.filter((item) => currentRevisionIdSet.has(String(item._id)) && !(String(item.nodeId) === targetNodeId && String(item.senseId) === targetSenseId));
    if (currentOnly.length === 0) return { article: serializeArticleSummary(bundle.article), backlinks: [] };
    const sourceNodeIds = Array.from(new Set(currentOnly.map((item) => getIdString(item.nodeId)).filter(Boolean)));
    const [nodes, senses] = await Promise.all([
      Node.find({ _id: { $in: sourceNodeIds } }).select('_id name').lean(),
      NodeSense.find({ nodeId: { $in: sourceNodeIds } }).select('nodeId senseId title').lean()
    ]);
    const nodeMap = new Map(nodes.map((item) => [String(item._id), item.name || '']));
    const senseMap = new Map(senses.map((item) => [`${item.nodeId}:${item.senseId}`, item.title || '']));
    const backlinks = buildBacklinkEntries({ revisions: currentOnly, targetNodeId, targetSenseId, nodeMap, senseMap });
    return {
      article: serializeArticleSummary(bundle.article),
      backlinks
    };
  };

  const getGovernanceDashboard = async ({ userId, nodeId = '' }) => {
    const filter = await buildManagedNodeFilter({ userId, nodeId });
    const nodes = await Node.find(filter).select('_id name domainMaster domainAdmins domainAdminPermissions').lean();
    const userRoleInfo = await getUserRoleInfo(userId, null);
    const userIdText = getIdString(userId);
    const reviewableNodes = nodes.filter((item) => (
      userRoleInfo.isSystemAdmin
      || getIdString(item.domainMaster) === userIdText
      || ((Array.isArray(item.domainAdmins) ? item.domainAdmins : []).some((adminId) => getIdString(adminId) === userIdText)
        && hasDomainAdminPermission({
          node: item,
          userId: userIdText,
          permissionKey: DOMAIN_ADMIN_PERMISSION_KEYS.SENSE_ARTICLE_REVIEW
        }))
    ));
    const nodeIds = reviewableNodes.map((item) => item._id);
    const nodeIdSet = new Set(nodeIds.map((item) => String(item)));
    const domainMasterNodeIds = new Set(reviewableNodes.filter((item) => getIdString(item.domainMaster) === userIdText).map((item) => String(item._id)));
    const articleRows = await SenseArticle.find({ nodeId: { $in: nodeIds } }).select('_id nodeId senseId currentRevisionId').lean();
    const articleMap = new Map(articleRows.map((item) => [`${item.nodeId}:${item.senseId}`, item]));
    const pendingFilter = { nodeId: { $in: nodeIds }, status: { $in: ['pending_review', 'pending_domain_admin_review', 'pending_domain_master_review'] } };
    const [pendingRows, requestedRows, publishedRows, allPublishedWithRefs, nodeSenses] = await Promise.all([
      SenseArticleRevision.find(pendingFilter).sort({ createdAt: 1 }).limit(30).lean(),
      SenseArticleRevision.find({ nodeId: { $in: nodeIds }, proposerId: toObjectIdOrNull(userId), status: { $in: ['changes_requested_by_domain_admin', 'changes_requested_by_domain_master'] } }).sort({ updatedAt: -1 }).limit(20).lean(),
      SenseArticleRevision.find({ nodeId: { $in: nodeIds }, status: 'published' }).sort({ publishedAt: -1 }).limit(20).lean(),
      SenseArticleRevision.find({ nodeId: { $in: nodeIds }, status: 'published', 'referenceIndex.0': { $exists: true } }).select('nodeId senseId referenceIndex').lean(),
      NodeSense.find({ nodeId: { $in: nodeIds } }).select('nodeId senseId title legacySummary').lean()
    ]);

    const pendingMyReview = pendingRows.filter((revision) => {
      if (revision.status === 'pending_review') return nodeIdSet.has(String(revision.nodeId));
      if (revision.status === 'pending_domain_admin_review') return nodeIdSet.has(String(revision.nodeId));
      if (revision.status === 'pending_domain_master_review') return userRoleInfo.isSystemAdmin || domainMasterNodeIds.has(String(revision.nodeId));
      return false;
    });

    const decoratedPending = await decorateRevisionRecords({ revisions: pendingRows, fallbackSenseTitle: '' });
    const pendingMap = new Map(decoratedPending.map((item) => [String(item._id), item]));
    const pendingMyReviewSerialized = pendingMyReview.map((item) => serializeRevisionSummary(pendingMap.get(String(item._id)) || item));

    const staleThreshold = Date.now() - (1000 * 60 * 60 * 24 * 7);
    const stalePending = pendingRows
      .filter((item) => new Date(item.createdAt || item.updatedAt || 0).getTime() <= staleThreshold)
      .map((item) => serializeRevisionSummary(pendingMap.get(String(item._id)) || item));

    const nodeNameMap = new Map(reviewableNodes.map((item) => [String(item._id), item.name || '']));
    const senseTitleMap = new Map(nodeSenses.map((item) => [`${item.nodeId}:${item.senseId}`, item.title || '']));

    const popularRefMap = new Map();
    allPublishedWithRefs.forEach((revision) => {
      (revision.referenceIndex || []).forEach((ref) => {
        const key = `${getIdString(ref.targetNodeId)}:${String(ref.targetSenseId || '').trim()}`;
        const row = popularRefMap.get(key) || { nodeId: ref.targetNodeId, senseId: ref.targetSenseId, count: 0 };
        row.count += 1;
        popularRefMap.set(key, row);
      });
    });
    const highFrequencyReferenced = Array.from(popularRefMap.values())
      .sort((left, right) => right.count - left.count)
      .slice(0, 10)
      .map((item) => ({
        nodeId: item.nodeId,
        senseId: item.senseId,
        nodeName: nodeNameMap.get(String(item.nodeId)) || '',
        senseTitle: senseTitleMap.get(`${item.nodeId}:${item.senseId}`) || '',
        referenceCount: item.count,
        articleId: articleMap.get(`${item.nodeId}:${item.senseId}`)?._id || null
      }));

    const articleKeySet = new Set(articleRows.map((item) => `${item.nodeId}:${item.senseId}`));
    const legacyUnmigrated = nodeSenses
      .filter((item) => !articleKeySet.has(`${item.nodeId}:${item.senseId}`) || !articleMap.get(`${item.nodeId}:${item.senseId}`)?.currentRevisionId)
      .slice(0, 20)
      .map((item) => ({
        nodeId: item.nodeId,
        senseId: item.senseId,
        nodeName: nodeNameMap.get(String(item.nodeId)) || '',
        senseTitle: item.title || '',
        legacySummary: item.legacySummary || ''
      }));

    const decoratedRequested = await decorateRevisionRecords({ revisions: requestedRows, fallbackSenseTitle: '' });
    const decoratedPublished = await decorateRevisionRecords({ revisions: publishedRows, fallbackSenseTitle: '' });

    const annotationHealth = await collectAnnotationHealthStats({ userId, nodeIds });
    const scopedNode = nodeId
      ? await enrichNodeDomainMasterAlliance(nodes.find((item) => String(item?._id) === String(nodeId)) || null)
      : null;
    return {
      scope: { nodeId: nodeId || null, totalNodes: nodeIds.length },
      node: scopedNode,
      pendingMyReview: pendingMyReviewSerialized,
      requestedChangesMine: decoratedRequested.map((item) => serializeRevisionSummary(item)),
      stalePending,
      recentlyPublished: decoratedPublished.map((item) => serializeRevisionSummary(item)),
      highFrequencyReferenced,
      legacyUnmigrated,
      annotationHealth
    };
  };

  return {
    buildBacklinkEntries,
    compareRevisions,
    getGovernanceDashboard,
    listBacklinks,
    listCurrentReferences,
    searchCurrentArticle,
    searchReferenceTargets
  };
};

module.exports = {
  createSenseArticleQueryService
};
