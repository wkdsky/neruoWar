const mongoose = require('mongoose');
const Node = require('../models/Node');
const NodeSense = require('../models/NodeSense');
const SenseArticle = require('../models/SenseArticle');
const SenseArticleRevision = require('../models/SenseArticleRevision');
const SenseAnnotation = require('../models/SenseAnnotation');
const { ACTIVE_SUPERSEDE_STATUSES, DRAFT_EDITABLE_STATUSES } = require('../constants/senseArticle');
const { buildRichAnchor, createAnchorFromSelection, normalizeAnchor, relocateAnchor } = require('./senseArticleAnchorService');
const { buildLineDiff, buildStructuredDiff } = require('./senseArticleDiffService');
const { buildLegacyArticleSeed, buildSummary } = require('./senseArticleMigrationService');
const {
  buildSenseArticleNotificationPayload,
  notifyDomainAdminDecision,
  notifyDomainMasterDecision,
  notifyReferencedDomains,
  notifyRevisionSubmitted,
  notifySupersededRevisions
} = require('./senseArticleNotificationService');
const { parseSenseArticleSource } = require('./senseArticleParser');
const { ensurePermission, getUserRoleInfo } = require('./senseArticlePermissionService');
const {
  serializeAnnotation,
  serializeArticleSummary,
  serializeBacklinkEntry,
  serializePermissions,
  serializeReferencePreview,
  serializeRevisionDetail,
  serializeRevisionSummary,
  serializeSearchGroup,
  serializeSearchMatch,
  serializeStructuredDiff
} = require('./senseArticleSerializer');
const {
  isSupersedeEligibleStatus,
  resolveDomainAdminReviewOperation,
  resolveDomainMasterReviewOperation,
  resolveSubmitOperation,
  selectSupersedeCandidates
} = require('./senseArticleWorkflow');
const { getIdString, isValidObjectId, toObjectIdOrNull } = require('../utils/objectId');

const createExposeError = (message, statusCode = 400, code = '') => {
  const error = new Error(message);
  error.expose = true;
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const reasonToMessage = (reason = '') => ({
  already_pending_domain_admin_review: '当前修订已提交，无需重复提交',
  already_approved_by_domain_admin: '当前修订已进入域主终审阶段',
  already_published: '当前修订已发布，无需重复操作',
  revision_superseded: '当前修订已被 superseded，不能继续提交',
  revision_withdrawn: '当前修订已撤回，不能继续提交',
  revision_rejected: '当前修订已被驳回，不能继续提交',
  status_not_submittable: '当前修订状态不可提交',
  published_cannot_be_reviewed: '已发布修订不能再次审核',
  superseded_cannot_be_reviewed: '已 superseded 修订不能再次审核',
  withdrawn_cannot_be_reviewed: '已撤回修订不能再次审核',
  already_exited_domain_admin_stage: '当前修订已离开域相审核阶段',
  status_not_reviewable_by_domain_admin: '当前修订不在域相可审核状态',
  domain_admin_approval_required: '必须先完成域相通过，域主才能终审',
  status_not_reviewable_by_domain_master: '当前修订不在域主可审核状态',
  invalid_review_action: '无效审核动作',
  publish_base_outdated: '该修订基线已过期，已有其他版本发布，当前修订不能再发布'
}[reason] || '当前操作不被允许');

const ensureNodeAndSense = async (nodeId, senseId) => {
  const safeNodeId = getIdString(nodeId);
  const safeSenseId = String(senseId || '').trim();
  if (!isValidObjectId(safeNodeId) || !safeSenseId) {
    throw createExposeError('无效的知识域或释义标识', 400, 'invalid_article_key');
  }
  const [node, nodeSense] = await Promise.all([
    Node.findById(safeNodeId)
      .select('_id name description status domainMaster domainAdmins owner synonymSenses associations')
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
  return {
    node,
    nodeSense: effectiveSense,
    nodeId: safeNodeId,
    senseId: safeSenseId
  };
};

const buildArticleKey = (nodeId, senseId) => `${nodeId}:${senseId}`;

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

const buildManagedNodeFilter = async ({ userId, nodeId = '' }) => {
  if (!userId) throw createExposeError('无效用户身份', 401, 'invalid_user');
  const permissionsNode = nodeId ? await Node.findById(nodeId).select('_id domainMaster domainAdmins').lean() : null;
  const roleInfo = permissionsNode ? await getUserRoleInfo(userId, permissionsNode) : await getUserRoleInfo(userId, null);
  if (nodeId) {
    ensurePermission(roleInfo.isSystemAdmin || roleInfo.isDomainMaster || roleInfo.isDomainAdmin, '当前用户不能查看该知识域内容治理面板');
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

const materializeRevisionPayload = async ({ editorSource, baseRevision = null }) => {
  const parsed = parseSenseArticleSource(editorSource);
  const referenceIndex = await resolveReferenceTargets(parsed.referenceIndex);
  const candidateRevision = {
    editorSource: parsed.editorSource,
    ast: parsed.ast,
    headingIndex: parsed.headingIndex,
    referenceIndex,
    formulaRefs: parsed.formulaRefs,
    symbolRefs: parsed.symbolRefs
  };
  return {
    ...parsed,
    referenceIndex,
    diffFromBase: buildRevisionComparePayload({ fromRevision: baseRevision, toRevision: candidateRevision })
  };
};

const syncLegacySenseMirror = async ({ nodeId, senseId, nodeSense, editorSource, plainTextSnapshot, actorUserId }) => {
  const filter = { nodeId: toObjectIdOrNull(nodeId), senseId: String(senseId || '').trim() };
  const legacySummary = buildSummary(plainTextSnapshot);
  await NodeSense.updateOne(filter, {
    $set: {
      title: nodeSense?.title || '未命名释义',
      content: editorSource,
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

const getNextRevisionNumber = async (articleId) => {
  const latest = await SenseArticleRevision.findOne({ articleId }).sort({ revisionNumber: -1 }).select('revisionNumber').lean();
  return (latest?.revisionNumber || 0) + 1;
};

const bootstrapArticleFromNodeSense = async ({ nodeId, senseId, userId }) => {
  return getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
};

const getArticleBundle = async ({ nodeId, senseId, userId, createIfMissing = true }) => {
  const base = await ensureNodeAndSense(nodeId, senseId);
  const permissions = await getUserRoleInfo(userId, base.node);
  let article = await SenseArticle.findOne({ nodeId: base.nodeId, senseId: base.senseId });

  if (!article && createIfMissing) {
    const materialized = await materializeRevisionPayload({ editorSource: base.nodeSense.content || '' });
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
    seed.revision.parseErrors = materialized.parseErrors;
    seed.revision.ast = materialized.ast;
    seed.revision.headingIndex = materialized.headingIndex;
    seed.revision.formulaRefs = materialized.formulaRefs;
    seed.revision.symbolRefs = materialized.symbolRefs;
    seed.revision.plainTextSnapshot = materialized.plainTextSnapshot;
    seed.revision.renderSnapshot = materialized.renderSnapshot;
    const revision = await SenseArticleRevision.create(seed.revision);
    article = await SenseArticle.create({
      ...seed.article,
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

const assertRevisionReadable = ({ revision, permissions, userId }) => {
  const proposerId = getIdString(revision?.proposerId);
  const currentUserId = getIdString(userId);
  if (revision?.status === 'published') return;
  if (permissions.canReviewDomainAdmin || permissions.canReviewDomainMaster) return;
  ensurePermission(proposerId === currentUserId, '仅发起人或审核者可查看未发布修订');
};

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

const getCurrentArticle = async ({ nodeId, senseId, userId }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  ensurePermission(!!bundle.currentRevision, '当前释义尚无已发布百科版本', 404);
  const annotations = await SenseAnnotation.find({ userId: bundle.permissions.userId, articleId: bundle.article._id }).sort({ updatedAt: -1 }).lean();
  const serializedAnnotations = annotations.map((item) => serializeAnnotation(item, relocateAnchor({ anchor: item.anchor, currentRevision: bundle.currentRevision })));
  return {
    node: bundle.node,
    nodeSense: bundle.nodeSense,
    article: serializeArticleSummary(bundle.article),
    revision: serializeRevisionDetail(bundle.currentRevision),
    permissions: serializePermissions(bundle.permissions, userId),
    annotations: serializedAnnotations
  };
};

const listRevisions = async ({ nodeId, senseId, userId, status = '', page = 1, pageSize = 20 }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  const filter = { articleId: bundle.article._id };
  if (status) filter.status = status;
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
    } catch (error) {
      return false;
    }
  });
  return {
    article: serializeArticleSummary(bundle.article),
    currentRevisionId: bundle.article.currentRevisionId || null,
    revisions: visible.map((item) => serializeRevisionSummary(item)),
    permissions: serializePermissions(bundle.permissions, userId)
  };
};

const getRevisionDetail = async ({ nodeId, senseId, revisionId, userId }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  const revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id }).lean();
  if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');
  assertRevisionReadable({ revision, permissions: bundle.permissions, userId });
  const baseRevision = revision.baseRevisionId ? await SenseArticleRevision.findById(revision.baseRevisionId).lean() : null;
  return {
    article: serializeArticleSummary(bundle.article),
    revision: serializeRevisionDetail(revision),
    baseRevision: baseRevision ? serializeRevisionDetail(baseRevision) : null,
    permissions: serializePermissions(bundle.permissions, userId)
  };
};

const createDraftRevision = async ({ nodeId, senseId, userId, payload = {} }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  ensurePermission(bundle.permissions.canCreateRevision, '当前用户无法创建百科修订');
  const requestedBaseId = getIdString(payload.baseRevisionId) || getIdString(bundle.article.currentRevisionId);
  const baseRevision = requestedBaseId
    ? await SenseArticleRevision.findOne({ _id: requestedBaseId, articleId: bundle.article._id })
    : bundle.currentRevision;
  const editorSource = typeof payload.editorSource === 'string' && payload.editorSource.trim()
    ? payload.editorSource
    : (baseRevision?.editorSource || bundle.currentRevision?.editorSource || bundle.nodeSense.content || '');
  const revisionNumber = await getNextRevisionNumber(bundle.article._id);
  const materialized = await materializeRevisionPayload({ editorSource, baseRevision });
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
    proposerId: userId,
    proposerNote: typeof payload.proposerNote === 'string' ? payload.proposerNote.trim() : '',
    status: 'draft',
    reviewStage: 'domain_admin'
  });
  await SenseArticle.updateOne({ _id: bundle.article._id }, {
    $set: {
      latestDraftRevisionId: draft._id,
      updatedBy: userId,
      updatedAt: new Date()
    }
  });
  return {
    article: serializeArticleSummary(bundle.article),
    revision: serializeRevisionDetail(draft),
    permissions: serializePermissions(bundle.permissions, userId)
  };
};

const updateDraftRevision = async ({ nodeId, senseId, revisionId, userId, payload = {} }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  const revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
  if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');
  const currentUserId = getIdString(userId);
  ensurePermission(getIdString(revision.proposerId) === currentUserId || bundle.permissions.isSystemAdmin, '仅发起人或系统管理员可编辑草稿');
  ensurePermission(DRAFT_EDITABLE_STATUSES.includes(revision.status), '当前修订状态不可编辑');
  const baseRevision = revision.baseRevisionId ? await SenseArticleRevision.findById(revision.baseRevisionId) : null;
  const editorSource = typeof payload.editorSource === 'string' ? payload.editorSource : revision.editorSource;
  const materialized = await materializeRevisionPayload({ editorSource, baseRevision });
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
  if (typeof payload.proposerNote === 'string') revision.proposerNote = payload.proposerNote.trim();
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
  await SenseArticle.updateOne({ _id: bundle.article._id }, { $set: { latestDraftRevisionId: revision._id, updatedBy: userId } });
  return {
    article: serializeArticleSummary(bundle.article),
    revision: serializeRevisionDetail(revision),
    permissions: serializePermissions(bundle.permissions, userId)
  };
};

const attemptConditionalRevisionUpdate = async ({ revision, articleId, expectedStatuses = [], setPatch = {} }) => {
  const filter = {
    _id: revision._id,
    articleId,
    __v: revision.__v
  };
  if (expectedStatuses.length > 0) filter.status = { $in: expectedStatuses };
  return SenseArticleRevision.findOneAndUpdate(
    filter,
    {
      $set: setPatch,
      $inc: { __v: 1 }
    },
    { new: true }
  );
};

const submitRevision = async ({ nodeId, senseId, revisionId, userId }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  let revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
  if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');
  ensurePermission(getIdString(revision.proposerId) === getIdString(userId) || bundle.permissions.isSystemAdmin, '仅发起人可提交当前修订');
  let operation = resolveSubmitOperation(revision);
  if (operation.kind === 'invalid') throw createExposeError(reasonToMessage(operation.reason), 409, operation.reason);
  if (operation.kind === 'noop') {
    return {
      article: serializeArticleSummary(bundle.article),
      revision: serializeRevisionDetail(revision),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  }

  const updated = await attemptConditionalRevisionUpdate({
    revision,
    articleId: bundle.article._id,
    expectedStatuses: [revision.status],
    setPatch: {
      ...operation.patch,
      updatedAt: new Date()
    }
  });
  if (!updated) {
    revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
    operation = resolveSubmitOperation(revision);
    if (operation.kind === 'noop') {
      return {
        article: serializeArticleSummary(bundle.article),
        revision: serializeRevisionDetail(revision),
        permissions: serializePermissions(bundle.permissions, userId)
      };
    }
    throw createExposeError(reasonToMessage(operation.reason), 409, operation.reason || 'submit_conflict');
  }

  await notifyRevisionSubmitted({ node: bundle.node, article: bundle.article, revision: updated, actorId: userId });
  return {
    article: serializeArticleSummary(bundle.article),
    revision: serializeRevisionDetail(updated),
    permissions: serializePermissions(bundle.permissions, userId)
  };
};

const supersedeSiblingRevisions = async ({ articleId, baseRevisionId, publishedRevisionId }) => {
  const query = {
    articleId,
    _id: { $ne: publishedRevisionId },
    status: { $in: ACTIVE_SUPERSEDE_STATUSES }
  };
  query.baseRevisionId = baseRevisionId || null;
  const revisions = await SenseArticleRevision.find(query).lean();
  const candidates = selectSupersedeCandidates({
    revisions,
    publishedRevisionId,
    baseRevisionId: baseRevisionId || null
  });
  if (candidates.length === 0) return [];
  await SenseArticleRevision.updateMany({ _id: { $in: candidates.map((item) => item._id) }, status: { $in: ACTIVE_SUPERSEDE_STATUSES } }, {
    $set: {
      status: 'superseded',
      reviewStage: 'completed',
      finalDecision: 'superseded',
      finalDecisionAt: new Date(),
      supersededByRevisionId: publishedRevisionId
    }
  });
  return candidates.map((item) => ({ ...item, status: 'superseded', supersededByRevisionId: publishedRevisionId }));
};

const reviewByDomainAdmin = async ({ nodeId, senseId, revisionId, userId, action, comment = '' }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  ensurePermission(bundle.permissions.canReviewDomainAdmin, '当前用户不能执行域相审核');
  let revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
  if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');

  let operation = resolveDomainAdminReviewOperation(revision, action);
  if (operation.kind === 'invalid') throw createExposeError(reasonToMessage(operation.reason), 409, operation.reason);
  if (operation.kind === 'noop') {
    return {
      article: serializeArticleSummary(bundle.article),
      revision: serializeRevisionDetail(revision),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  }

  const updated = await attemptConditionalRevisionUpdate({
    revision,
    articleId: bundle.article._id,
    expectedStatuses: [revision.status],
    setPatch: {
      ...operation.patch,
      domainAdminReviewerId: userId,
      domainAdminReviewedAt: new Date(),
      domainAdminComment: String(comment || '').trim(),
      ...(operation.patch.finalDecision ? { finalDecisionAt: new Date() } : {}),
      updatedAt: new Date()
    }
  });
  if (!updated) {
    revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
    operation = resolveDomainAdminReviewOperation(revision, action);
    if (operation.kind === 'noop') {
      return {
        article: serializeArticleSummary(bundle.article),
        revision: serializeRevisionDetail(revision),
        permissions: serializePermissions(bundle.permissions, userId)
      };
    }
    throw createExposeError(reasonToMessage(operation.reason), 409, operation.reason || 'domain_admin_review_conflict');
  }

  await notifyDomainAdminDecision({
    node: bundle.node,
    article: bundle.article,
    revision: updated,
    action: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'changes_requested',
    actorId: userId
  });
  return {
    article: serializeArticleSummary(bundle.article),
    revision: serializeRevisionDetail(updated),
    permissions: serializePermissions(bundle.permissions, userId)
  };
};

const reviewByDomainMaster = async ({ nodeId, senseId, revisionId, userId, action, comment = '' }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  ensurePermission(bundle.permissions.canReviewDomainMaster, '当前用户不能执行域主终审');
  let revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
  if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');

  let operation = resolveDomainMasterReviewOperation(revision, action);
  if (operation.kind === 'invalid') throw createExposeError(reasonToMessage(operation.reason), 409, operation.reason);
  if (operation.kind === 'noop') {
    return {
      article: serializeArticleSummary(bundle.article),
      revision: serializeRevisionDetail(revision),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  }

  if (action !== 'approve') {
    const updated = await attemptConditionalRevisionUpdate({
      revision,
      articleId: bundle.article._id,
      expectedStatuses: [revision.status],
      setPatch: {
        ...operation.patch,
        domainMasterReviewerId: userId,
        domainMasterReviewedAt: new Date(),
        domainMasterComment: String(comment || '').trim(),
        finalDecisionAt: new Date(),
        updatedAt: new Date()
      }
    });
    if (!updated) {
      revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
      operation = resolveDomainMasterReviewOperation(revision, action);
      if (operation.kind === 'noop') {
        return {
          article: serializeArticleSummary(bundle.article),
          revision: serializeRevisionDetail(revision),
          permissions: serializePermissions(bundle.permissions, userId)
        };
      }
      throw createExposeError(reasonToMessage(operation.reason), 409, operation.reason || 'domain_master_review_conflict');
    }
    await notifyDomainMasterDecision({
      node: bundle.node,
      article: bundle.article,
      revision: updated,
      action: action === 'reject' ? 'rejected' : 'changes_requested',
      actorId: userId
    });
    return {
      article: serializeArticleSummary(bundle.article),
      revision: serializeRevisionDetail(updated),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  }

  const articleUpdate = await SenseArticle.findOneAndUpdate({
    _id: bundle.article._id,
    currentRevisionId: revision.baseRevisionId || null
  }, {
    $set: {
      currentRevisionId: revision._id,
      summary: buildSummary(revision.plainTextSnapshot),
      publishedAt: new Date(),
      updatedBy: userId,
      updatedAt: new Date()
    }
  }, { new: true });

  if (!articleUpdate) {
    const freshArticle = await SenseArticle.findById(bundle.article._id).lean();
    if (String(freshArticle?.currentRevisionId || '') !== String(revision.baseRevisionId || '')) {
      await SenseArticleRevision.updateOne({
        _id: revision._id,
        articleId: bundle.article._id,
        status: { $in: ACTIVE_SUPERSEDE_STATUSES }
      }, {
        $set: {
          status: 'superseded',
          reviewStage: 'completed',
          finalDecision: 'superseded',
          finalDecisionAt: new Date(),
          supersededByRevisionId: freshArticle?.currentRevisionId || null
        }
      });
      revision = await SenseArticleRevision.findById(revision._id);
      throw createExposeError(reasonToMessage('publish_base_outdated'), 409, 'publish_base_outdated');
    }
  }

  const updatedRevision = await attemptConditionalRevisionUpdate({
    revision,
    articleId: bundle.article._id,
    expectedStatuses: [revision.status],
    setPatch: {
      ...operation.patch,
      domainMasterReviewerId: userId,
      domainMasterReviewedAt: new Date(),
      domainMasterComment: String(comment || '').trim(),
      finalDecisionAt: new Date(),
      publishedBy: userId,
      publishedAt: new Date(),
      updatedAt: new Date()
    }
  });

  if (!updatedRevision) {
    await SenseArticle.updateOne({ _id: bundle.article._id, currentRevisionId: revision._id }, {
      $set: {
        currentRevisionId: revision.baseRevisionId || null,
        updatedAt: new Date()
      }
    });
    revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
    operation = resolveDomainMasterReviewOperation(revision, action);
    if (operation.kind === 'noop') {
      return {
        article: serializeArticleSummary(bundle.article),
        revision: serializeRevisionDetail(revision),
        permissions: serializePermissions(bundle.permissions, userId)
      };
    }
    throw createExposeError(reasonToMessage(operation.reason), 409, operation.reason || 'publish_conflict');
  }

  const supersededRevisions = await supersedeSiblingRevisions({
    articleId: bundle.article._id,
    baseRevisionId: updatedRevision.baseRevisionId || null,
    publishedRevisionId: updatedRevision._id
  });

  await syncLegacySenseMirror({
    nodeId: bundle.nodeId,
    senseId: bundle.senseId,
    nodeSense: bundle.nodeSense,
    editorSource: updatedRevision.editorSource,
    plainTextSnapshot: updatedRevision.plainTextSnapshot,
    actorUserId: userId
  });
  await notifyDomainMasterDecision({ node: bundle.node, article: bundle.article, revision: updatedRevision, action: 'approved', actorId: userId });
  await notifySupersededRevisions({ node: bundle.node, article: bundle.article, publishedRevision: updatedRevision, supersededRevisions, actorId: userId });
  await notifyReferencedDomains({ node: bundle.node, article: bundle.article, revision: updatedRevision, actorId: userId });

  return {
    article: serializeArticleSummary({ ...bundle.article.toObject?.() || bundle.article, currentRevisionId: updatedRevision._id }),
    revision: serializeRevisionDetail(updatedRevision),
    permissions: serializePermissions(bundle.permissions, userId)
  };
};

const listMyAnnotations = async ({ nodeId, senseId, userId }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  const annotations = await SenseAnnotation.find({ userId, articleId: bundle.article._id }).sort({ updatedAt: -1 }).lean();
  return {
    article: serializeArticleSummary(bundle.article),
    revisionId: bundle.currentRevision?._id || null,
    annotations: annotations.map((item) => serializeAnnotation(item, relocateAnchor({ anchor: item.anchor, currentRevision: bundle.currentRevision })))
  };
};

const createAnnotation = async ({ nodeId, senseId, userId, payload = {} }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  const anchor = payload.anchorType === 'text_range'
    ? createAnchorFromSelection({
        revision: bundle.currentRevision,
        blockId: payload?.anchor?.blockId || '',
        headingId: payload?.anchor?.headingId || '',
        selectionText: payload?.anchor?.selectionText || payload?.anchor?.textQuote || '',
        textPositionStart: payload?.anchor?.textPositionStart,
        textPositionEnd: payload?.anchor?.textPositionEnd,
        prefixText: payload?.anchor?.prefixText || payload?.anchor?.beforeText || '',
        suffixText: payload?.anchor?.suffixText || payload?.anchor?.afterText || ''
      })
    : normalizeAnchor(payload.anchor, bundle.currentRevision?._id || null);
  const annotation = await SenseAnnotation.create({
    userId,
    nodeId: bundle.nodeId,
    senseId: bundle.senseId,
    articleId: bundle.article._id,
    revisionId: payload.revisionId || bundle.currentRevision?._id || null,
    anchorType: payload.anchorType || 'text_range',
    anchor,
    highlightColor: typeof payload.highlightColor === 'string' && payload.highlightColor.trim() ? payload.highlightColor.trim() : '#fde68a',
    note: typeof payload.note === 'string' ? payload.note.trim() : '',
    visibility: 'private'
  });
  return serializeAnnotation(annotation.toObject(), relocateAnchor({ anchor: annotation.anchor, currentRevision: bundle.currentRevision }));
};

const updateAnnotation = async ({ nodeId, senseId, annotationId, userId, payload = {} }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  const annotation = await SenseAnnotation.findOne({ _id: annotationId, userId, articleId: bundle.article._id });
  if (!annotation) throw createExposeError('标注不存在', 404, 'annotation_not_found');
  if (payload.anchor) {
    annotation.anchor = payload.anchorType === 'text_range'
      ? createAnchorFromSelection({
          revision: bundle.currentRevision,
          blockId: payload.anchor.blockId,
          headingId: payload.anchor.headingId,
          selectionText: payload.anchor.selectionText || payload.anchor.textQuote || '',
          textPositionStart: payload.anchor.textPositionStart,
          textPositionEnd: payload.anchor.textPositionEnd,
          prefixText: payload.anchor.prefixText || payload.anchor.beforeText || '',
          suffixText: payload.anchor.suffixText || payload.anchor.afterText || ''
        })
      : normalizeAnchor(payload.anchor, bundle.currentRevision?._id || null);
  }
  if (typeof payload.note === 'string') annotation.note = payload.note.trim();
  if (typeof payload.highlightColor === 'string' && payload.highlightColor.trim()) annotation.highlightColor = payload.highlightColor.trim();
  await annotation.save();
  return serializeAnnotation(annotation.toObject(), relocateAnchor({ anchor: annotation.anchor, currentRevision: bundle.currentRevision }));
};

const deleteAnnotation = async ({ nodeId, senseId, annotationId, userId }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  const result = await SenseAnnotation.deleteOne({ _id: annotationId, userId, articleId: bundle.article._id });
  return { deleted: (result?.deletedCount || 0) > 0 };
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
  const nodes = await Node.find(filter).select('_id name domainMaster domainAdmins').lean();
  const nodeIds = nodes.map((item) => item._id);
  const nodeIdSet = new Set(nodeIds.map((item) => String(item)));
  const userIdText = getIdString(userId);
  const domainMasterNodeIds = new Set(nodes.filter((item) => getIdString(item.domainMaster) === userIdText).map((item) => String(item._id)));
  const articleRows = await SenseArticle.find({ nodeId: { $in: nodeIds } }).select('_id nodeId senseId currentRevisionId').lean();
  const articleMap = new Map(articleRows.map((item) => [`${item.nodeId}:${item.senseId}`, item]));
  const pendingFilter = { nodeId: { $in: nodeIds }, status: { $in: ['pending_domain_admin_review', 'pending_domain_master_review'] } };
  const [pendingRows, requestedRows, publishedRows, allPublishedWithRefs, nodeSenses] = await Promise.all([
    SenseArticleRevision.find(pendingFilter).sort({ createdAt: 1 }).limit(30).lean(),
    SenseArticleRevision.find({ nodeId: { $in: nodeIds }, proposerId: toObjectIdOrNull(userId), status: { $in: ['changes_requested_by_domain_admin', 'changes_requested_by_domain_master'] } }).sort({ updatedAt: -1 }).limit(20).lean(),
    SenseArticleRevision.find({ nodeId: { $in: nodeIds }, status: 'published' }).sort({ publishedAt: -1 }).limit(20).lean(),
    SenseArticleRevision.find({ nodeId: { $in: nodeIds }, status: 'published', 'referenceIndex.0': { $exists: true } }).select('nodeId senseId referenceIndex').lean(),
    NodeSense.find({ nodeId: { $in: nodeIds } }).select('nodeId senseId title legacySummary').lean()
  ]);

  const pendingMyReview = pendingRows.filter((revision) => {
    if (revision.status === 'pending_domain_admin_review') return nodeIdSet.has(String(revision.nodeId));
    if (revision.status === 'pending_domain_master_review') return domainMasterNodeIds.has(String(revision.nodeId));
    return false;
  }).map((item) => serializeRevisionSummary(item));

  const staleThreshold = Date.now() - (1000 * 60 * 60 * 24 * 7);
  const stalePending = pendingRows.filter((item) => new Date(item.createdAt || item.updatedAt || 0).getTime() <= staleThreshold).map((item) => serializeRevisionSummary(item));

  const nodeNameMap = new Map(nodes.map((item) => [String(item._id), item.name || '']));
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

  const annotationHealth = await collectAnnotationHealthStats({ userId, nodeIds });
  return {
    scope: { nodeId: nodeId || null, totalNodes: nodeIds.length },
    pendingMyReview,
    requestedChangesMine: requestedRows.map((item) => serializeRevisionSummary(item)),
    stalePending,
    recentlyPublished: publishedRows.map((item) => serializeRevisionSummary(item)),
    highFrequencyReferenced,
    legacyUnmigrated,
    annotationHealth
  };
};

module.exports = {
  bootstrapArticleFromNodeSense,
  buildArticleSearchResult,
  buildBacklinkEntries,
  buildSenseArticleNotificationPayload,
  compareRevisions,
  createAnnotation,
  createDraftRevision,
  deleteAnnotation,
  getArticleBundle,
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
};
