const Node = require('../../models/Node');
const User = require('../../models/User');
const EntropyAlliance = require('../../models/EntropyAlliance');
const { createSenseArticleAnnotationService } = require('./annotationService');
const { createSenseArticleCoreService } = require('./coreService');
const { createSenseArticleDraftService } = require('./draftService');
const { createSenseArticleMediaService } = require('./mediaService');
const { createSenseArticleQueryService } = require('./queryService');
const { createSenseArticleReadService } = require('./readService');
const { createSenseArticleReviewSupportService } = require('./reviewSupportService');
const { createSenseArticleSupportService } = require('./supportService');
const { createSenseArticleWorkflowService } = require('./workflowService');
const NodeSense = require('../../models/NodeSense');
const NodeSenseFavorite = require('../../models/NodeSenseFavorite');
const SenseArticle = require('../../models/SenseArticle');
const { hydrateNodeSensesForNodes, saveNodeSenses } = require('../nodeSenseStore');
const { syncDomainTitleProjectionFromNode } = require('../domainTitleProjectionStore');
const SenseArticleRevision = require('../../models/SenseArticleRevision');
const SenseAnnotation = require('../../models/SenseAnnotation');
const { ACTIVE_SUPERSEDE_STATUSES, DRAFT_EDITABLE_STATUSES } = require('../../constants/senseArticle');
const { createAnchorFromSelection, normalizeAnchor, relocateAnchor } = require('../senseArticleAnchorService');
const { buildStructuredDiff } = require('./../senseArticleDiffService');
const { buildLegacyArticleSeed, buildSummary } = require('./../senseArticleMigrationService');
const {
  buildSenseArticleNotificationPayload,
  notifyDomainAdminDecision,
  notifyDomainMasterDecision,
  notifyReferencedDomains,
  notifyRevisionSubmitted,
  notifySupersededRevisions
} = require('./../senseArticleNotificationService');
const {
  CONTENT_FORMATS,
  convertLegacyMarkupToRichHtml,
  detectContentFormat,
  materializeRevisionContent
} = require('./../senseArticleRichContentService');
const {
  extractMediaReferencesFromRevision,
  hydrateMediaReferenceAssets,
  listMediaAssetsForEditor,
  refreshArticleMediaReferenceState
} = require('./../senseArticleMediaReferenceService');
const { ensurePermission, getUserRoleInfo } = require('./../senseArticlePermissionService');
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
} = require('./../senseArticleSerializer');
const {
  resolveSubmitOperation,
  selectSupersedeCandidates
} = require('./../senseArticleWorkflow');
const { DOMAIN_ADMIN_PERMISSION_KEYS, getSenseArticleReviewerEntries, hasDomainAdminPermission } = require('../../utils/domainAdminPermissions');
const { getIdString, isValidObjectId, toObjectIdOrNull } = require('../../utils/objectId');
const { diagLog, diagWarn, durationMs, nowMs } = require('./../senseArticleDiagnostics');
const schedulerService = require('../schedulerService');
const {
  buildCleanupBucketRunAt,
  createMediaAssetRecord,
  promoteMediaAssets,
  pruneExpiredTemporaryMediaAssets,
  pruneUnreferencedMediaAssets,
  releaseTemporaryMediaSession,
  syncTemporaryMediaSessionAssets,
  touchTemporaryMediaSession
} = require('./../senseArticleMediaService');
const { validateRevisionContent } = require('./../senseArticleValidationService');

const createExposeError = (message, statusCode = 400, code = '', details = null) => {
  const error = new Error(message);
  error.expose = true;
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
};

const {
  buildArticleSearchResult,
  buildRevisionComparePayload,
  canUserUpdateSenseMetadata,
  decorateRevisionRecords,
  loadMyVisibleRevisionSummaries,
  normalizeTrimmedText,
  resolveProposedSenseTitle,
  resolveRevisionTitleInput,
  revisionHasMeaningfulSubmissionChanges,
  updateSenseMetadata
} = createSenseArticleSupportService({
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
});

const {
  assertRevisionReadable,
  buildReviewParticipantsFromNode,
  buildReviewPresentation,
  ensureReviewParticipantsSnapshot,
  ensureReviewVotesSnapshot,
  isPendingReviewStatus,
  reasonToMessage,
  resolveReviewerRoleForUser
} = createSenseArticleReviewSupportService({
  User,
  ensurePermission,
  getIdString,
  getSenseArticleReviewerEntries
});

const {
  applyPublishedSenseTitle: applyPublishedSenseTitleBase,
  assertRevisionValidationBeforeWorkflow,
  bootstrapArticleFromNodeSense,
  buildRevisionBootstrapResponse,
  buildRevisionMediaAndValidation,
  buildRevisionMutationResponse,
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
} = createSenseArticleCoreService({
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
});

const applyPublishedSenseTitle = async ({ bundle, revision, userId }) => (
  applyPublishedSenseTitleBase({ bundle, revision, userId, resolveProposedSenseTitle })
);

const {
  createAnnotation,
  deleteAnnotation,
  listMyAnnotations,
  updateAnnotation
} = createSenseArticleAnnotationService({
  SenseAnnotation,
  createAnchorFromSelection,
  createExposeError,
  getArticleBundle,
  normalizeAnchor,
  relocateAnchor,
  serializeAnnotation,
  serializeArticleSummary
});

const {
  buildBacklinkEntries,
  compareRevisions,
  getGovernanceDashboard,
  listBacklinks,
  listCurrentReferences,
  searchCurrentArticle,
  searchReferenceTargets
} = createSenseArticleQueryService({
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
});

const {
  getArticleOverview,
  getCurrentArticle,
  getCurrentArticleSideData,
  getRevisionDetail,
  getRevisionValidation,
  listMyEdits,
  listRevisions
} = createSenseArticleReadService({
  DRAFT_EDITABLE_STATUSES,
  SenseAnnotation,
  SenseArticleRevision,
  assertRevisionReadable,
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
  serializeRevisionSummary
});

const {
  createDraftRevision,
  deleteDraftRevision,
  updateDraftRevision
} = createSenseArticleDraftService({
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
});

const {
  reviewByDomainAdmin,
  reviewByDomainMaster,
  submitRevision
} = createSenseArticleWorkflowService({
  ACTIVE_SUPERSEDE_STATUSES,
  SenseArticle,
  SenseArticleRevision,
  User,
  applyPublishedSenseTitle,
  assertRevisionValidationBeforeWorkflow,
  buildReviewParticipantsFromNode,
  buildReviewPresentation,
  buildRevisionMutationResponse,
  buildSummary,
  canUserUpdateSenseMetadata,
  createExposeError,
  detectContentFormat,
  ensurePermission,
  ensureReviewParticipantsSnapshot,
  ensureReviewVotesSnapshot,
  ensureRevisionDerivedState,
  getArticleBundle,
  getIdString,
  isPendingReviewStatus,
  notifyDomainMasterDecision,
  notifyReferencedDomains,
  notifyRevisionSubmitted,
  notifySupersededRevisions,
  reasonToMessage,
  resolveProposedSenseTitle,
  resolveReviewerRoleForUser,
  resolveRevisionTitleInput,
  resolveSubmitOperation,
  revisionHasMeaningfulSubmissionChanges,
  selectSupersedeCandidates,
  serializeArticleSummary,
  serializePermissions,
  serializeRevisionDetail,
  syncLegacySenseMirror,
  refreshArticleMediaReferenceState,
  validateRevisionContent
});

const {
  listMediaAssets,
  releaseMediaSession,
  syncMediaSession,
  touchMediaSession,
  uploadMediaAsset
} = createSenseArticleMediaService({
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
});

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
