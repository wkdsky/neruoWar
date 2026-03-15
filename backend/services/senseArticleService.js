const mongoose = require('mongoose');
const { parse } = require('node-html-parser');
const Node = require('../models/Node');
const User = require('../models/User');
const EntropyAlliance = require('../models/EntropyAlliance');
const NodeSense = require('../models/NodeSense');
const NodeSenseFavorite = require('../models/NodeSenseFavorite');
const SenseArticle = require('../models/SenseArticle');
const { hydrateNodeSensesForNodes, saveNodeSenses } = require('./nodeSenseStore');
const { syncDomainTitleProjectionFromNode } = require('./domainTitleProjectionStore');
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
const {
  CONTENT_FORMATS,
  convertLegacyMarkupToRichHtml,
  detectContentFormat,
  materializeRevisionContent
} = require('./senseArticleRichContentService');
const {
  extractMediaReferencesFromRevision,
  hydrateMediaReferenceAssets,
  listMediaAssetsForEditor,
  refreshArticleMediaReferenceState
} = require('./senseArticleMediaReferenceService');
const { ensurePermission, getUserRoleInfo } = require('./senseArticlePermissionService');
const {
  serializeAnnotation,
  serializeArticleSummary,
  serializeBacklinkEntry,
  serializePermissions,
  serializeReferencePreview,
  serializeRevisionBootstrap,
  serializeRevisionDetail,
  serializeRevisionMutationResult,
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
const { DOMAIN_ADMIN_PERMISSION_KEYS, getSenseArticleReviewerEntries, hasDomainAdminPermission } = require('../utils/domainAdminPermissions');
const { getIdString, isValidObjectId, toObjectIdOrNull } = require('../utils/objectId');
const { diagLog, diagWarn, durationMs, nowMs } = require('./senseArticleDiagnostics');
const schedulerService = require('./schedulerService');
const {
  buildCleanupBucketRunAt,
  createMediaAssetRecord,
  promoteMediaAssets,
  pruneExpiredTemporaryMediaAssets,
  pruneUnreferencedMediaAssets,
  releaseTemporaryMediaSession,
  syncTemporaryMediaSessionAssets,
  touchTemporaryMediaSession
} = require('./senseArticleMediaService');
const { validateRevisionContent } = require('./senseArticleValidationService');

const createExposeError = (message, statusCode = 400, code = '', details = null) => {
  const error = new Error(message);
  error.expose = true;
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
};

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

const applyPublishedSenseTitle = async ({ bundle, revision, userId }) => {
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
};

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

const reasonToMessage = (reason = '') => ({
  already_pending_domain_admin_review: '当前修订已提交，无需重复提交',
  already_approved_by_domain_admin: '当前修订已进入域主终审阶段',
  already_published: '当前修订已发布，无需重复操作',
  revision_superseded: '当前修订已被 superseded，不能继续提交',
  revision_withdrawn: '当前修订已撤回，不能继续提交',
  revision_rejected: '当前修订已被驳回，不能继续提交',
  unchanged_revision: '当前修订与基线版本相比没有任何实际变化，不能提交审核',
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

const isPendingReviewStatus = (status = '') => ['pending_review', 'pending_domain_admin_review', 'pending_domain_master_review'].includes(String(status || '').trim());

const buildReviewParticipantsFromNode = (node = null) => getSenseArticleReviewerEntries(node).map((item) => ({
  userId: item.userId,
  role: item.role
}));

const buildLegacyReviewVotes = (revision = {}) => {
  const votes = [];
  const domainAdminReviewerId = getIdString(revision?.domainAdminReviewerId);
  const domainAdminDecision = String(revision?.domainAdminDecision || '').trim();
  if (domainAdminReviewerId && domainAdminDecision && domainAdminDecision !== 'pending') {
    votes.push({
      userId: domainAdminReviewerId,
      role: 'domain_admin',
      decision: domainAdminDecision === 'approved' ? 'approved' : 'rejected',
      comment: revision?.domainAdminComment || '',
      reviewedAt: revision?.domainAdminReviewedAt || null
    });
  }
  const domainMasterReviewerId = getIdString(revision?.domainMasterReviewerId);
  const domainMasterDecision = String(revision?.domainMasterDecision || '').trim();
  if (domainMasterReviewerId && domainMasterDecision && domainMasterDecision !== 'pending') {
    votes.push({
      userId: domainMasterReviewerId,
      role: 'domain_master',
      decision: domainMasterDecision === 'approved' ? 'approved' : 'rejected',
      comment: revision?.domainMasterComment || '',
      reviewedAt: revision?.domainMasterReviewedAt || null
    });
  }
  return votes;
};

const ensureReviewParticipantsSnapshot = ({ revision = {}, node = null }) => {
  const existingParticipants = Array.isArray(revision?.reviewParticipants) ? revision.reviewParticipants : [];
  if (existingParticipants.length > 0) {
    return existingParticipants.map((item) => ({
      userId: getIdString(item?.userId),
      role: String(item?.role || 'domain_admin').trim() || 'domain_admin'
    })).filter((item) => !!item.userId);
  }
  const participants = buildReviewParticipantsFromNode(node);
  const seen = new Set(participants.map((item) => item.userId));
  buildLegacyReviewVotes(revision).forEach((vote) => {
    if (!vote.userId || seen.has(vote.userId)) return;
    participants.push({ userId: vote.userId, role: vote.role || 'domain_admin' });
    seen.add(vote.userId);
  });
  return participants;
};

const ensureReviewVotesSnapshot = (revision = {}) => {
  const sourceVotes = Array.isArray(revision?.reviewVotes) && revision.reviewVotes.length > 0
    ? revision.reviewVotes
    : buildLegacyReviewVotes(revision);
  const seen = new Set();
  return sourceVotes.map((item) => ({
    userId: getIdString(item?.userId),
    role: String(item?.role || 'domain_admin').trim() || 'domain_admin',
    decision: String(item?.decision || 'pending').trim() || 'pending',
    comment: typeof item?.comment === 'string' ? item.comment.trim() : '',
    reviewedAt: item?.reviewedAt || null
  })).filter((item) => {
    if (!item.userId || seen.has(item.userId)) return false;
    seen.add(item.userId);
    return true;
  });
};

const resolveReviewerRoleForUser = ({ bundle, revision, userId }) => {
  const normalizedUserId = getIdString(userId);
  if (!normalizedUserId) return '';
  if (bundle?.permissions?.isSystemAdmin) return 'system_admin';
  const participant = ensureReviewParticipantsSnapshot({ revision, node: bundle?.node }).find((item) => item.userId === normalizedUserId);
  if (participant?.role) return participant.role;
  if (bundle?.permissions?.isDomainMaster) return 'domain_master';
  if (bundle?.permissions?.isDomainAdmin) return 'domain_admin';
  return '';
};

const buildReviewPresentation = async ({ revision = {}, node = null, currentUserId = '' }) => {
  const reviewParticipants = ensureReviewParticipantsSnapshot({ revision, node });
  const reviewVotes = ensureReviewVotesSnapshot(revision);
  const relatedUserIds = Array.from(new Set(reviewParticipants.map((item) => item.userId).concat(reviewVotes.map((item) => item.userId)).filter(Boolean)));
  const users = relatedUserIds.length > 0
    ? await User.find({ _id: { $in: relatedUserIds } }).select('_id username avatar profession').lean()
    : [];
  const userMap = new Map(users.map((item) => [getIdString(item._id), item]));
  const voteMap = new Map(reviewVotes.map((item) => [item.userId, item]));
  const participants = reviewParticipants.map((item) => {
    const user = userMap.get(item.userId) || {};
    const vote = voteMap.get(item.userId) || null;
    return {
      userId: item.userId,
      role: item.role || 'domain_admin',
      username: user.username || '',
      avatar: user.avatar || '',
      profession: user.profession || '',
      decision: vote?.decision || 'pending',
      comment: vote?.comment || '',
      reviewedAt: vote?.reviewedAt || null,
      isCurrentUser: item.userId === getIdString(currentUserId)
    };
  });
  const summary = participants.reduce((acc, item) => {
    if (item.decision === 'approved') acc.approvedCount += 1;
    else if (item.decision === 'rejected') acc.rejectedCount += 1;
    else acc.pendingCount += 1;
    return acc;
  }, { total: participants.length, approvedCount: 0, rejectedCount: 0, pendingCount: 0 });
  summary.allApproved = summary.total > 0 && summary.approvedCount === summary.total;
  const byRole = ['domain_admin', 'domain_master', 'system_admin'].reduce((acc, role) => {
    const scopedParticipants = participants.filter((item) => item.role === role);
    const roleSummary = scopedParticipants.reduce((roleAcc, item) => {
      if (item.decision === 'approved') roleAcc.approvedCount += 1;
      else if (item.decision === 'rejected') roleAcc.rejectedCount += 1;
      else roleAcc.pendingCount += 1;
      return roleAcc;
    }, { total: scopedParticipants.length, approvedCount: 0, rejectedCount: 0, pendingCount: 0 });
    roleSummary.allApproved = roleSummary.total > 0 && roleSummary.approvedCount === roleSummary.total;
    acc[role] = roleSummary;
    return acc;
  }, {});
  summary.byRole = byRole;
  return { participants, summary };
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

const bootstrapArticleFromNodeSense = async ({ nodeId, senseId, userId }) => {
  return getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
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

const serializeEditorMediaLibrary = (mediaLibrary = {}) => ({
  referencedAssets: Array.isArray(mediaLibrary?.referencedAssets) ? mediaLibrary.referencedAssets.map((item) => serializeMediaAsset(item)) : [],
  recentAssets: Array.isArray(mediaLibrary?.recentAssets) ? mediaLibrary.recentAssets.map((item) => serializeMediaAsset(item)) : [],
  orphanCandidates: Array.isArray(mediaLibrary?.orphanCandidates) ? mediaLibrary.orphanCandidates.map((item) => serializeMediaAsset(item)) : []
});

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

const assertRevisionReadable = ({ revision, permissions, userId }) => {
  const proposerId = getIdString(revision?.proposerId);
  const currentUserId = getIdString(userId);
  const reviewParticipantIds = ensureReviewParticipantsSnapshot({ revision }).map((item) => item.userId);
  if (revision?.status === 'published') return;
  if (permissions.canReviewDomainAdmin || permissions.canReviewDomainMaster) return;
  if (reviewParticipantIds.includes(currentUserId)) return;
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
    } catch (error) {
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

const updateSenseMetadata = async ({ nodeId, senseId, userId, payload = {} }) => {
  throw createExposeError('释义名称修改已并入修订审核流程，请在编辑修订时保存并提交审核', 409, 'sense_metadata_revision_flow_only');
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
  const proposer = await User.findById(revision.proposerId).select('_id username').lean();
  const normalizedRevisionTitle = resolveRevisionTitleInput({
    revisionTitle: revision.revisionTitle,
    fallbackUsername: proposer?.username || ''
  });
  const normalizedProposedSenseTitle = await resolveProposedSenseTitle({
    bundle,
    senseId,
    proposedSenseTitle: revision.proposedSenseTitle,
    allowChange: canUserUpdateSenseMetadata(bundle.permissions)
  });
  if (normalizedRevisionTitle !== revision.revisionTitle || normalizedProposedSenseTitle !== revision.proposedSenseTitle) {
    revision.revisionTitle = normalizedRevisionTitle;
    revision.proposedSenseTitle = normalizedProposedSenseTitle;
    await revision.save();
  }
  revision = await ensureRevisionDerivedState({
    revision,
    nodeId: bundle.nodeId,
    senseId: bundle.senseId,
    persist: true,
    force: true
  });
  diagLog('sense.revision.submit.precheck', {
    nodeId: bundle.nodeId,
    senseId: bundle.senseId,
    revisionId: getIdString(revision?._id),
    baseRevisionId: getIdString(revision?.baseRevisionId),
    contentFormat: revision?.contentFormat || '',
    sourceMode: revision?.sourceMode || 'full',
    editorSourceLength: typeof revision?.editorSource === 'string' ? revision.editorSource.length : 0,
    plainTextLength: typeof revision?.plainTextSnapshot === 'string' ? revision.plainTextSnapshot.length : 0,
    headingCount: Array.isArray(revision?.headingIndex) ? revision.headingIndex.length : 0,
    hasMeaningfulChanges: revisionHasMeaningfulSubmissionChanges({
      revision,
      currentSenseTitle: bundle?.nodeSense?.title || senseId
    }),
    blockingCodes: Array.isArray(revision?.validationSnapshot?.blocking) ? revision.validationSnapshot.blocking.map((item) => item?.code || '').filter(Boolean) : []
  });
  if (!revisionHasMeaningfulSubmissionChanges({
    revision,
    currentSenseTitle: bundle?.nodeSense?.title || senseId
  })) {
    throw createExposeError(
      reasonToMessage('unchanged_revision'),
      409,
      'unchanged_revision',
      {
        compare: revision?.diffFromBase || null,
        sourceMode: revision?.sourceMode || 'full',
        targetHeadingId: revision?.targetHeadingId || '',
        selectedRangeAnchor: revision?.selectedRangeAnchor || null
      }
    );
  }
  assertRevisionValidationBeforeWorkflow({
    validationSnapshot: revision.validationSnapshot || validateRevisionContent({ revision, mediaReferences: revision.mediaReferences }),
    phase: 'submit'
  });
  let operation = resolveSubmitOperation(revision);
  if (operation.kind === 'invalid') throw createExposeError(reasonToMessage(operation.reason), 409, operation.reason);
  if (operation.kind === 'noop') {
    return buildRevisionMutationResponse({
      article: bundle.article,
      revision,
      permissions: bundle.permissions,
      userId
    });
  }

  const reviewParticipants = buildReviewParticipantsFromNode(bundle.node);
  const updated = await attemptConditionalRevisionUpdate({
    revision,
    articleId: bundle.article._id,
    expectedStatuses: [revision.status],
    setPatch: {
      ...operation.patch,
      reviewParticipants,
      reviewVotes: [],
      domainAdminDecision: 'pending',
      domainAdminReviewerId: null,
      domainAdminReviewedAt: null,
      domainAdminComment: '',
      domainMasterDecision: 'pending',
      domainMasterReviewerId: null,
      domainMasterReviewedAt: null,
      domainMasterComment: '',
      finalDecision: null,
      finalDecisionAt: null,
      publishedBy: null,
      publishedAt: null,
      updatedAt: new Date()
    }
  });
  if (!updated) {
    revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
    operation = resolveSubmitOperation(revision);
    if (operation.kind === 'noop') {
      return buildRevisionMutationResponse({
        article: bundle.article,
        revision,
        permissions: bundle.permissions,
        userId
      });
    }
    throw createExposeError(reasonToMessage(operation.reason), 409, operation.reason || 'submit_conflict');
  }

  await notifyRevisionSubmitted({ node: bundle.node, article: bundle.article, revision: updated, actorId: userId });
  return buildRevisionMutationResponse({
    article: bundle.article,
    revision: updated,
    permissions: bundle.permissions,
    userId
  });
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

const buildLegacyReviewFieldPatch = ({ reviewerRole = '', action = '', userId = '', comment = '', markPublished = false }) => {
  const now = new Date();
  const trimmedComment = String(comment || '').trim();
  const patch = {};
  const applyToDomainMasterFields = reviewerRole === 'domain_master' || reviewerRole === 'system_admin';
  if (applyToDomainMasterFields) {
    patch.domainMasterDecision = action === 'approve' ? 'approved' : 'rejected';
    patch.domainMasterReviewerId = userId || null;
    patch.domainMasterReviewedAt = now;
    patch.domainMasterComment = trimmedComment;
  } else {
    patch.domainAdminDecision = action === 'approve' ? 'approved' : 'rejected';
    patch.domainAdminReviewerId = userId || null;
    patch.domainAdminReviewedAt = now;
    patch.domainAdminComment = trimmedComment;
  }
  if (markPublished) {
    patch.domainAdminDecision = 'approved';
    patch.domainMasterDecision = 'approved';
  }
  return patch;
};

const reviewRevision = async ({ nodeId, senseId, revisionId, userId, action, comment = '', requiredRole = '' }) => {
  const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
  const normalizedAction = String(action || '').trim();
  if (!['approve', 'reject'].includes(normalizedAction)) {
    throw createExposeError(reasonToMessage('invalid_review_action'), 400, 'invalid_review_action');
  }

  let revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
  if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');

  const reviewerRole = resolveReviewerRoleForUser({ bundle, revision, userId });
  const reviewParticipants = ensureReviewParticipantsSnapshot({ revision, node: bundle.node });
  const isExplicitParticipant = reviewParticipants.some((item) => item.userId === getIdString(userId));
  const hasCurrentReviewPermission = !!bundle.permissions.isSystemAdmin
    || !!bundle.permissions.canReviewDomainAdmin
    || !!bundle.permissions.canReviewDomainMaster;
  const canReview = !!reviewerRole && (bundle.permissions.isSystemAdmin || (isExplicitParticipant && hasCurrentReviewPermission));
  ensurePermission(canReview, '当前用户不能参与该修订的审阅');
  if (requiredRole === 'domain_master') {
    ensurePermission(reviewerRole === 'domain_master' || reviewerRole === 'system_admin', '当前用户不能执行域主终审');
  }
  if (requiredRole === 'domain_admin') {
    ensurePermission(reviewerRole === 'domain_admin' || reviewerRole === 'domain_master' || reviewerRole === 'system_admin', '当前用户不能执行百科审阅');
  }

  if (revision.status === 'published' && normalizedAction === 'approve') {
    return {
      article: serializeArticleSummary(bundle.article),
      revision: serializeRevisionDetail(revision),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  }
  if ((revision.status === 'rejected' || revision.status === 'rejected_by_domain_admin' || revision.status === 'rejected_by_domain_master') && normalizedAction === 'reject') {
    return {
      article: serializeArticleSummary(bundle.article),
      revision: serializeRevisionDetail(revision),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  }
  if (!isPendingReviewStatus(revision.status)) {
    throw createExposeError(reasonToMessage('status_not_reviewable_by_domain_admin'), 409, 'status_not_reviewable_by_domain_admin');
  }

  const baseVotes = ensureReviewVotesSnapshot(revision);
  const nextVotes = [
    ...baseVotes.filter((item) => item.userId !== getIdString(userId)),
    {
      userId: getIdString(userId),
      role: reviewerRole,
      decision: normalizedAction === 'approve' ? 'approved' : 'rejected',
      comment: String(comment || '').trim(),
      reviewedAt: new Date()
    }
  ];

  const projectedPresentation = await buildReviewPresentation({
    revision: { ...revision.toObject(), reviewParticipants, reviewVotes: nextVotes },
    node: bundle.node,
    currentUserId: userId
  });
  const adminStageSummary = projectedPresentation.summary?.byRole?.domain_admin || { total: 0, approvedCount: 0, pendingCount: 0, allApproved: false };
  const masterStageSummary = projectedPresentation.summary?.byRole?.domain_master || { total: 0, approvedCount: 0, pendingCount: 0, allApproved: false };

  if (normalizedAction === 'reject') {
    const updated = await attemptConditionalRevisionUpdate({
      revision,
      articleId: bundle.article._id,
      expectedStatuses: [revision.status],
      setPatch: {
        status: 'rejected',
        reviewStage: 'completed',
        reviewParticipants,
        reviewVotes: nextVotes,
        finalDecision: 'rejected',
        finalDecisionAt: new Date(),
        updatedAt: new Date(),
        ...buildLegacyReviewFieldPatch({ reviewerRole, action: 'reject', userId, comment })
      }
    });
    if (!updated) {
      revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
      if (revision && (revision.status === 'rejected' || revision.status === 'published')) {
        return {
          article: serializeArticleSummary(bundle.article),
          revision: serializeRevisionDetail(revision),
          permissions: serializePermissions(bundle.permissions, userId)
        };
      }
      throw createExposeError('当前修订审核状态已变更，请刷新后重试', 409, 'review_conflict');
    }
    await notifyDomainMasterDecision({
      node: bundle.node,
      article: bundle.article,
      revision: updated,
      action: 'rejected',
      actorId: userId
    });
    return {
      article: serializeArticleSummary(bundle.article),
      revision: serializeRevisionDetail(updated),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  }

  if (reviewerRole === 'domain_admin' || (reviewerRole === 'system_admin' && revision.status !== 'pending_domain_master_review')) {
    if (!adminStageSummary.allApproved) {
      const updated = await attemptConditionalRevisionUpdate({
        revision,
        articleId: bundle.article._id,
        expectedStatuses: [revision.status],
        setPatch: {
          status: 'pending_domain_admin_review',
          reviewStage: 'domain_admin',
          reviewParticipants,
          reviewVotes: nextVotes,
          updatedAt: new Date(),
          ...buildLegacyReviewFieldPatch({ reviewerRole: 'domain_admin', action: 'approve', userId, comment })
        }
      });
      if (!updated) {
        revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
        if (revision && !isPendingReviewStatus(revision.status)) {
          return {
            article: serializeArticleSummary(bundle.article),
            revision: serializeRevisionDetail(revision),
            permissions: serializePermissions(bundle.permissions, userId)
          };
        }
        throw createExposeError('当前修订审核状态已变更，请刷新后重试', 409, 'review_conflict');
      }
      return {
        article: serializeArticleSummary(bundle.article),
        revision: serializeRevisionDetail(updated),
        permissions: serializePermissions(bundle.permissions, userId)
      };
    }

    if (masterStageSummary.total > 0) {
      const updated = await attemptConditionalRevisionUpdate({
        revision,
        articleId: bundle.article._id,
        expectedStatuses: [revision.status],
        setPatch: {
          status: 'pending_domain_master_review',
          reviewStage: 'domain_master',
          reviewParticipants,
          reviewVotes: nextVotes,
          updatedAt: new Date(),
          ...buildLegacyReviewFieldPatch({ reviewerRole: 'domain_admin', action: 'approve', userId, comment })
        }
      });
      if (!updated) {
        revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
        if (revision && !isPendingReviewStatus(revision.status)) {
          return {
            article: serializeArticleSummary(bundle.article),
            revision: serializeRevisionDetail(revision),
            permissions: serializePermissions(bundle.permissions, userId)
          };
        }
        throw createExposeError('当前修订审核状态已变更，请刷新后重试', 409, 'review_conflict');
      }
      return {
        article: serializeArticleSummary(bundle.article),
        revision: serializeRevisionDetail(updated),
        permissions: serializePermissions(bundle.permissions, userId)
      };
    }
  }

  if (!masterStageSummary.allApproved && masterStageSummary.total > 0) {
    const updated = await attemptConditionalRevisionUpdate({
      revision,
      articleId: bundle.article._id,
      expectedStatuses: [revision.status],
      setPatch: {
        status: 'pending_domain_master_review',
        reviewStage: 'domain_master',
        reviewParticipants,
        reviewVotes: nextVotes,
        updatedAt: new Date(),
        ...buildLegacyReviewFieldPatch({ reviewerRole: reviewerRole === 'system_admin' ? 'domain_master' : reviewerRole, action: 'approve', userId, comment })
      }
    });
    if (!updated) {
      revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
      if (revision && !isPendingReviewStatus(revision.status)) {
        return {
          article: serializeArticleSummary(bundle.article),
          revision: serializeRevisionDetail(revision),
          permissions: serializePermissions(bundle.permissions, userId)
        };
      }
      throw createExposeError('当前修订审核状态已变更，请刷新后重试', 409, 'review_conflict');
    }
    return {
      article: serializeArticleSummary(bundle.article),
      revision: serializeRevisionDetail(updated),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  }

  assertRevisionValidationBeforeWorkflow({
    validationSnapshot: revision.validationSnapshot || validateRevisionContent({ revision, mediaReferences: revision.mediaReferences }),
    phase: 'publish'
  });
  await applyPublishedSenseTitle({ bundle, revision, userId });

  const articleUpdate = await SenseArticle.findOneAndUpdate({
    _id: bundle.article._id,
    currentRevisionId: revision.baseRevisionId || null
  }, {
    $set: {
      currentRevisionId: revision._id,
      contentFormat: revision.contentFormat || detectContentFormat({ editorSource: revision.editorSource }),
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
      status: 'published',
      reviewStage: 'completed',
      reviewParticipants,
      reviewVotes: nextVotes,
      finalDecision: 'published',
      finalDecisionAt: new Date(),
      publishedBy: userId,
      publishedAt: new Date(),
      updatedAt: new Date(),
      ...buildLegacyReviewFieldPatch({ reviewerRole, action: 'approve', userId, comment, markPublished: true })
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
    if (revision && !isPendingReviewStatus(revision.status)) {
      return {
        article: serializeArticleSummary(bundle.article),
        revision: serializeRevisionDetail(revision),
        permissions: serializePermissions(bundle.permissions, userId)
      };
    }
    throw createExposeError('当前修订审核状态已变更，请刷新后重试', 409, 'publish_conflict');
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
  await refreshArticleMediaReferenceState({
    articleId: bundle.article._id,
    nodeId: bundle.nodeId,
    senseId: bundle.senseId
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

const reviewByDomainAdmin = async ({ nodeId, senseId, revisionId, userId, action, comment = '' }) => reviewRevision({
  nodeId,
  senseId,
  revisionId,
  userId,
  action,
  comment,
  requiredRole: 'domain_admin'
});

const reviewByDomainMaster = async ({ nodeId, senseId, revisionId, userId, action, comment = '' }) => reviewRevision({
  nodeId,
  senseId,
  revisionId,
  userId,
  action,
  comment,
  requiredRole: 'domain_master'
});

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

module.exports = {
  bootstrapArticleFromNodeSense,
  buildArticleSearchResult,
  buildBacklinkEntries,
  buildSenseArticleNotificationPayload,
  compareRevisions,
  createAnnotation,
  createDraftRevision,
  deleteAnnotation,
  deleteDraftRevision,
  getArticleBundle,
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
  resolveReferenceTargets,
  reviewByDomainAdmin,
  reviewByDomainMaster,
  releaseMediaSession,
  searchCurrentArticle,
  searchReferenceTargets,
  syncMediaSession,
  submitRevision,
  touchMediaSession,
  uploadMediaAsset,
  updateAnnotation,
  updateDraftRevision,
  updateSenseMetadata
};
