const createSenseArticleSupportService = ({
  DRAFT_EDITABLE_STATUSES,
  Node,
  SenseArticleRevision,
  User,
  buildStructuredDiff,
  createExposeError,
  ensurePermission,
  getIdString,
  hydrateNodeSensesForNodes,
  serializeRevisionSummary,
  serializeSearchGroup,
  serializeSearchMatch,
  serializeStructuredDiff,
  toObjectIdOrNull
} = {}) => {
  const MY_EDITS_VISIBLE_STATUSES = new Set([
    ...DRAFT_EDITABLE_STATUSES,
    'pending_review',
    'pending_domain_admin_review',
    'pending_domain_master_review'
  ]);

  const normalizeTrimmedText = (value = '') => (typeof value === 'string' ? value.trim() : '');

  const buildDefaultRevisionTitle = (username = '') => `来自 ${normalizeTrimmedText(username) || '该用户'} 的修订`;

  const resolveRevisionTitleInput = ({ revisionTitle = '', fallbackUsername = '' } = {}) => {
    const normalized = normalizeTrimmedText(revisionTitle);
    return normalized || buildDefaultRevisionTitle(fallbackUsername);
  };

  const canUserUpdateSenseMetadata = (permissions = {}) => (
    !!permissions.canReviewSenseArticle || !!permissions.isDomainMaster || !!permissions.isSystemAdmin
  );

  const loadRevisionProposerMap = async (revisions = []) => {
    const proposerIds = Array.from(new Set((Array.isArray(revisions) ? revisions : [])
      .map((item) => getIdString(item?.proposerId))
      .filter(Boolean)));
    if (proposerIds.length === 0) return new Map();
    const rows = await User.find({ _id: { $in: proposerIds } }).select('_id username').lean();
    return new Map(rows.map((item) => [String(item._id), normalizeTrimmedText(item.username)]));
  };

  const decorateRevisionRecords = async ({ revisions = [], fallbackSenseTitle = '' } = {}) => {
    const rows = Array.isArray(revisions) ? revisions : [];
    if (rows.length === 0) return [];
    const proposerMap = await loadRevisionProposerMap(rows);
    const normalizedFallbackSenseTitle = normalizeTrimmedText(fallbackSenseTitle);
    return rows.map((item) => {
      const revision = item?.toObject ? item.toObject() : { ...(item || {}) };
      const proposerUsername = proposerMap.get(getIdString(revision.proposerId)) || '';
      return {
        ...revision,
        proposerUsername,
        revisionTitle: resolveRevisionTitleInput({
          revisionTitle: revision.revisionTitle,
          fallbackUsername: proposerUsername
        }),
        proposedSenseTitle: normalizeTrimmedText(revision.proposedSenseTitle) || normalizedFallbackSenseTitle
      };
    });
  };

  const loadMyVisibleRevisionSummaries = async ({ articleId = null, proposerId = '', fallbackSenseTitle = '', limit = 50 } = {}) => {
    const normalizedProposerId = toObjectIdOrNull(proposerId);
    if (!articleId || !normalizedProposerId) return [];
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const rows = await SenseArticleRevision.find({
      articleId,
      proposerId: normalizedProposerId,
      status: { $in: Array.from(MY_EDITS_VISIBLE_STATUSES) }
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(safeLimit)
      .lean();
    const decorated = await decorateRevisionRecords({
      revisions: rows,
      fallbackSenseTitle
    });
    return decorated.map((item) => serializeRevisionSummary(item));
  };

  const resolveProposedSenseTitle = async ({ bundle, senseId, proposedSenseTitle = '', allowChange = false } = {}) => {
    const currentTitle = normalizeTrimmedText(bundle?.nodeSense?.title || senseId || '');
    const nextTitle = normalizeTrimmedText(proposedSenseTitle) || currentTitle;
    if (!nextTitle) {
      throw createExposeError('释义名称不能为空', 400, 'sense_title_required');
    }
    if (nextTitle === currentTitle) return currentTitle;
    ensurePermission(allowChange, '当前用户不能修改释义名称', 403, 'sense_title_forbidden');

    const nodeDoc = await Node.findById(bundle.nodeId).select('_id description synonymSenses').lean();
    if (!nodeDoc) {
      throw createExposeError('知识域不存在', 404, 'node_not_found');
    }
    await hydrateNodeSensesForNodes([nodeDoc]);
    const currentSenses = Array.isArray(nodeDoc.__senseCollectionRows) && nodeDoc.__senseCollectionRows.length > 0
      ? nodeDoc.__senseCollectionRows
      : (Array.isArray(nodeDoc.synonymSenses) ? nodeDoc.synonymSenses : []);
    const targetSense = currentSenses.find((item) => String(item?.senseId || '').trim() === String(senseId || '').trim());
    if (!targetSense) {
      throw createExposeError('释义不存在', 404, 'sense_not_found');
    }
    const duplicated = currentSenses.some((item) => (
      String(item?.senseId || '').trim() !== String(senseId || '').trim()
      && String(item?.title || '').trim().toLowerCase() === nextTitle.toLowerCase()
    ));
    if (duplicated) {
      throw createExposeError('同一知识域下多个释义题目不能重名', 400, 'sense_title_duplicated');
    }
    return nextTitle;
  };

  const buildArticleSearchResult = ({ revision = null, query = '' }) => {
    const q = String(query || '').trim();
    if (!q) return { query: q, matches: [], total: 0, groups: [] };
    const lowerQuery = q.toLowerCase();
    const blocks = Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks : [];
    const headingTitleMap = new Map((Array.isArray(revision?.headingIndex) ? revision.headingIndex : []).map((item) => [item.headingId, item.title || '']));
    const groupsByHeading = new Map();
    const matches = [];

    blocks.forEach((block) => {
      const text = String(block?.plainText || '');
      const lowerText = text.toLowerCase();
      let searchFrom = 0;
      while (searchFrom < lowerText.length) {
        const position = lowerText.indexOf(lowerQuery, searchFrom);
        if (position < 0) break;
        const start = Math.max(0, position - 28);
        const end = Math.min(text.length, position + q.length + 36);
        const headingId = block.headingId || 'root';
        const match = {
          blockId: block.id,
          headingId,
          headingTitle: headingTitleMap.get(headingId) || (headingId === 'root' ? '前言' : ''),
          snippet: `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`,
          position,
          matchLength: q.length,
          blockHash: block.blockHash || ''
        };
        matches.push(match);
        const group = groupsByHeading.get(headingId) || { headingId, headingTitle: match.headingTitle, count: 0, matches: [] };
        group.count += 1;
        group.matches.push(match);
        groupsByHeading.set(headingId, group);
        searchFrom = position + Math.max(1, q.length);
      }
    });

    return {
      query: q,
      total: matches.length,
      matches: matches.map((item) => serializeSearchMatch(item)),
      groups: Array.from(groupsByHeading.values()).map((item) => serializeSearchGroup(item))
    };
  };

  const buildRevisionComparePayload = ({ fromRevision = null, toRevision = null }) => (
    serializeStructuredDiff(buildStructuredDiff({ fromRevision, toRevision }))
  );

  const compareHasAnyChanges = (compare = null) => {
    if (!compare || typeof compare !== 'object') return false;
    const summary = compare.summary && typeof compare.summary === 'object' ? compare.summary : {};
    if (Object.values(summary).some((value) => Number(value || 0) > 0)) return true;
    if (Array.isArray(compare.sections) && compare.sections.some((section) => !!section?.hasChanges)) return true;
    return false;
  };

  const revisionHasMeaningfulSubmissionChanges = ({ revision = null, currentSenseTitle = '' } = {}) => {
    if (!revision) return false;
    if (compareHasAnyChanges(revision.diffFromBase)) return true;
    const normalizedCurrentTitle = normalizeTrimmedText(currentSenseTitle);
    const normalizedProposedTitle = normalizeTrimmedText(revision.proposedSenseTitle);
    if (normalizedProposedTitle && normalizedCurrentTitle && normalizedProposedTitle !== normalizedCurrentTitle) return true;
    return false;
  };

  const updateSenseMetadata = async () => {
    throw createExposeError('释义名称修改已并入修订审核流程，请在编辑修订时保存并提交审核', 409, 'sense_metadata_revision_flow_only');
  };

  return {
    buildArticleSearchResult,
    buildRevisionComparePayload,
    canUserUpdateSenseMetadata,
    compareHasAnyChanges,
    decorateRevisionRecords,
    loadMyVisibleRevisionSummaries,
    normalizeTrimmedText,
    resolveProposedSenseTitle,
    resolveRevisionTitleInput,
    revisionHasMeaningfulSubmissionChanges,
    updateSenseMetadata
  };
};

module.exports = {
  createSenseArticleSupportService
};
