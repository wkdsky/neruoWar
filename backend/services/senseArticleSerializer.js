// Sense article public DTO serializers. Keep field names stable across pages, notifications and compare/search panels.
const { getIdString } = require('../utils/objectId');
const { diagLog, safeJsonByteLength } = require('./senseArticleDiagnostics');

const serializeArticleSummary = (article = {}) => ({
  _id: article?._id || null,
  nodeId: article?.nodeId || null,
  senseId: article?.senseId || '',
  articleKey: article?.articleKey || '',
  currentRevisionId: article?.currentRevisionId || null,
  latestDraftRevisionId: article?.latestDraftRevisionId || null,
  summary: article?.summary || '',
  tocVersion: article?.tocVersion || 0,
  renderVersion: article?.renderVersion || 0,
  searchVersion: article?.searchVersion || 0,
  createdBy: article?.createdBy || null,
  updatedBy: article?.updatedBy || null,
  createdAt: article?.createdAt || null,
  updatedAt: article?.updatedAt || null,
  publishedAt: article?.publishedAt || null
});

const serializeRevisionSummary = (revision = {}) => ({
  _id: revision?._id || null,
  nodeId: revision?.nodeId || null,
  senseId: revision?.senseId || '',
  articleId: revision?.articleId || null,
  revisionNumber: revision?.revisionNumber || 0,
  baseRevisionId: revision?.baseRevisionId || null,
  parentRevisionId: revision?.parentRevisionId || null,
  sourceMode: revision?.sourceMode || 'full',
  targetHeadingId: revision?.targetHeadingId || '',
  proposerId: revision?.proposerId || null,
  proposerUsername: revision?.proposerUsername || '',
  proposerNote: revision?.proposerNote || '',
  revisionTitle: revision?.revisionTitle || '',
  proposedSenseTitle: revision?.proposedSenseTitle || '',
  status: revision?.status || 'draft',
  reviewStage: revision?.reviewStage || 'domain_admin',
  domainAdminDecision: revision?.domainAdminDecision || 'pending',
  domainAdminReviewerId: revision?.domainAdminReviewerId || null,
  domainAdminReviewedAt: revision?.domainAdminReviewedAt || null,
  domainAdminComment: revision?.domainAdminComment || '',
  domainMasterDecision: revision?.domainMasterDecision || 'pending',
  domainMasterReviewerId: revision?.domainMasterReviewerId || null,
  domainMasterReviewedAt: revision?.domainMasterReviewedAt || null,
  domainMasterComment: revision?.domainMasterComment || '',
  reviewParticipants: Array.isArray(revision?.reviewParticipants) ? revision.reviewParticipants : [],
  reviewVotes: Array.isArray(revision?.reviewVotes) ? revision.reviewVotes : [],
  finalDecision: revision?.finalDecision || null,
  finalDecisionAt: revision?.finalDecisionAt || null,
  publishedBy: revision?.publishedBy || null,
  publishedAt: revision?.publishedAt || null,
  supersededByRevisionId: revision?.supersededByRevisionId || null,
  selectedRangeAnchor: revision?.selectedRangeAnchor || null,
  createdAt: revision?.createdAt || null,
  updatedAt: revision?.updatedAt || null
});

const serializeRevisionDetail = (revision = {}, meta = {}) => {
  const detail = {
    ...serializeRevisionSummary(revision),
    editorSource: revision?.editorSource || '',
    ast: revision?.ast || null,
    headingIndex: Array.isArray(revision?.headingIndex) ? revision.headingIndex : [],
    referenceIndex: Array.isArray(revision?.referenceIndex) ? revision.referenceIndex : [],
    formulaRefs: Array.isArray(revision?.formulaRefs) ? revision.formulaRefs : [],
    symbolRefs: Array.isArray(revision?.symbolRefs) ? revision.symbolRefs : [],
    plainTextSnapshot: revision?.plainTextSnapshot || '',
    renderSnapshot: revision?.renderSnapshot || null,
    diffFromBase: revision?.diffFromBase || null,
    scopedChange: revision?.scopedChange || null
  };
  const requestMeta = meta?.requestMeta || meta || {};
  diagLog('sense.serializer.revision_detail', {
    phase: meta?.phase,
    flowId: requestMeta?.flowId,
    requestId: requestMeta?.requestId,
    nodeId: getIdString(revision?.nodeId),
    senseId: revision?.senseId || '',
    revisionId: getIdString(revision?._id),
    editorSourceLength: typeof revision?.editorSource === 'string' ? revision.editorSource.length : 0,
    plainTextLength: typeof revision?.plainTextSnapshot === 'string' ? revision.plainTextSnapshot.length : 0,
    headingCount: Array.isArray(revision?.headingIndex) ? revision.headingIndex.length : 0,
    referenceCount: Array.isArray(revision?.referenceIndex) ? revision.referenceIndex.length : 0,
    hasRenderSnapshot: !!revision?.renderSnapshot,
    hasDiffFromBase: !!revision?.diffFromBase,
    estimatedBytes: safeJsonByteLength(detail)
  });
  return detail;
};

const serializeRevisionMutationResult = (revision = {}) => ({
  ...serializeRevisionSummary(revision),
  parseErrors: Array.isArray(revision?.parseErrors) ? revision.parseErrors : [],
  headingCount: Array.isArray(revision?.headingIndex) ? revision.headingIndex.length : 0,
  referenceCount: Array.isArray(revision?.referenceIndex) ? revision.referenceIndex.length : 0,
  plainTextLength: typeof revision?.plainTextSnapshot === 'string' ? revision.plainTextSnapshot.length : 0,
  saved: true
});

const serializeAnnotation = (annotation = {}, relocation = null) => ({
  _id: annotation?._id || null,
  userId: annotation?.userId || null,
  nodeId: annotation?.nodeId || null,
  senseId: annotation?.senseId || '',
  articleId: annotation?.articleId || null,
  revisionId: annotation?.revisionId || null,
  anchorType: annotation?.anchorType || 'text_range',
  anchor: annotation?.anchor || null,
  highlightColor: annotation?.highlightColor || '#fde68a',
  note: annotation?.note || '',
  visibility: annotation?.visibility || 'private',
  createdAt: annotation?.createdAt || null,
  updatedAt: annotation?.updatedAt || null,
  relocation: relocation || null
});

const serializePermissions = (permissions = {}, currentUserId = '') => ({
  isSystemAdmin: !!permissions.isSystemAdmin,
  isDomainMaster: !!permissions.isDomainMaster,
  isDomainAdmin: !!permissions.isDomainAdmin,
  canRead: !!permissions.canRead,
  canCreateRevision: !!permissions.canCreateRevision,
  canReviewSenseArticle: !!permissions.canReviewSenseArticle,
  canReviewDomainAdmin: !!permissions.canReviewDomainAdmin,
  canReviewDomainMaster: !!permissions.canReviewDomainMaster,
  canManageGraphAssociations: !!permissions.canManageGraphAssociations,
  currentUserId: getIdString(currentUserId)
});

const serializeSearchMatch = (match = {}) => ({
  blockId: match?.blockId || '',
  blockHash: match?.blockHash || '',
  headingId: match?.headingId || '',
  headingTitle: match?.headingTitle || '',
  snippet: match?.snippet || '',
  position: Number.isFinite(Number(match?.position)) ? Number(match.position) : 0,
  matchLength: Number.isFinite(Number(match?.matchLength)) ? Number(match.matchLength) : 0
});

const serializeSearchGroup = (group = {}) => ({
  headingId: group?.headingId || 'root',
  headingTitle: group?.headingTitle || '',
  count: Number(group?.count || 0),
  matches: Array.isArray(group?.matches) ? group.matches.map((item) => serializeSearchMatch(item)) : []
});

const serializeReferencePreview = (reference = {}) => ({
  referenceId: reference?.referenceId || '',
  targetNodeId: reference?.targetNodeId || null,
  targetSenseId: reference?.targetSenseId || '',
  displayText: reference?.displayText || '',
  targetTitle: reference?.targetTitle || '',
  targetNodeName: reference?.targetNodeName || '',
  targetArticleId: reference?.targetArticleId || null,
  targetCurrentRevisionId: reference?.targetCurrentRevisionId || null,
  targetSummary: reference?.targetSummary || '',
  targetStatus: reference?.targetStatus || '',
  targetPublishedAt: reference?.targetPublishedAt || null,
  isValid: !!reference?.isValid,
  headingId: reference?.headingId || '',
  blockId: reference?.blockId || '',
  position: Number.isFinite(Number(reference?.position)) ? Number(reference.position) : 0
});

const serializeBacklinkEntry = (entry = {}) => ({
  sourceNodeId: entry?.sourceNodeId || null,
  sourceSenseId: entry?.sourceSenseId || '',
  sourceNodeName: entry?.sourceNodeName || '',
  sourceSenseTitle: entry?.sourceSenseTitle || '',
  sourceArticleId: entry?.sourceArticleId || null,
  sourceRevisionId: entry?.sourceRevisionId || null,
  sourceRevisionNumber: Number(entry?.sourceRevisionNumber || 0),
  sourcePublishedAt: entry?.sourcePublishedAt || null,
  referenceCount: Number(entry?.referenceCount || 0),
  headings: Array.isArray(entry?.headings) ? entry.headings : [],
  positions: Array.isArray(entry?.positions) ? entry.positions : []
});

const serializeStructuredDiff = (compare = {}) => ({
  schemaVersion: Number(compare?.schemaVersion || 1),
  fromRevisionId: compare?.fromRevisionId || null,
  toRevisionId: compare?.toRevisionId || null,
  summary: compare?.summary || {},
  sections: Array.isArray(compare?.sections) ? compare.sections : [],
  lineDiff: compare?.lineDiff || { changes: [], stats: { added: 0, removed: 0, changed: 0 } },
  changes: Array.isArray(compare?.changes) ? compare.changes : [],
  stats: compare?.stats || { added: 0, removed: 0, changed: 0 }
});

module.exports = {
  serializeAnnotation,
  serializeArticleSummary,
  serializeBacklinkEntry,
  serializePermissions,
  serializeReferencePreview,
  serializeRevisionMutationResult,
  serializeRevisionDetail,
  serializeRevisionSummary,
  serializeSearchGroup,
  serializeSearchMatch,
  serializeStructuredDiff
};
