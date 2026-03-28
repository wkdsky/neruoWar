const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const Node = require('../../models/Node');
const NodeSense = require('../../models/NodeSense');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const SiegeBattleRecord = require('../../models/SiegeBattleRecord');
const DistributionParticipant = require('../../models/DistributionParticipant');
const DistributionResult = require('../../models/DistributionResult');
const EntropyAlliance = require('../../models/EntropyAlliance');
const KnowledgeDistributionService = require('../../services/KnowledgeDistributionService');
const schedulerService = require('../../services/schedulerService');
const {
  normalizeUnits: normalizeSiegeParticipantUnits,
  upsertParticipant: upsertSiegeParticipant,
  migrateEmbeddedAttackers: migrateEmbeddedSiegeAttackers,
  settleArrivedParticipants: settleSiegeArrivedParticipants,
  markParticipantsRetreated: markSiegeParticipantsRetreated,
  getGatePreview: getSiegeGatePreview,
  listParticipants: listSiegeParticipants,
  findActiveParticipant: findActiveSiegeParticipant,
  findUserActiveParticipants
} = require('../../services/siegeParticipantStore');
const { fetchArmyUnitTypes } = require('../../services/armyUnitTypeService');
const { fetchUnitTypesWithComponents } = require('../../services/unitRegistryService');
const { UNIT_TYPE_DTO_VERSION } = require('../../services/unitTypeDtoService');
const {
  isNotificationCollectionReadEnabled,
  upsertNotificationsToCollection,
  writeNotificationsToCollection
} = require('../../services/notificationStore');
const {
  findShortestApprovedPathToAnyTargets,
  listApprovedNodesByNames
} = require('../../services/domainGraphTraversalService');
const {
  fetchBattlefieldItems,
  fetchCityBuildingTypes
} = require('../../services/placeableCatalogService');
const {
  ensureUserBattlefieldInventory,
  resolveUserItemLimitMap
} = require('../../services/battlefieldInventoryService');
const {
  isNodeSenseCollectionReadEnabled,
  isNodeSenseRepairEnabled,
  hydrateNodeSensesForNodes,
  resolveNodeSensesForNode,
  saveNodeSenses
} = require('../../services/nodeSenseStore');
const { bootstrapArticleFromNodeSense } = require('../../services/senseArticle/composeService');
const {
  DOMAIN_ADMIN_PERMISSION_DEFINITIONS,
  DOMAIN_ADMIN_PERMISSION_KEYS,
  buildDomainAdminPermissionState,
  getNodeDomainAdminPermissionMap,
  normalizePermissionKeys
} = require('../../utils/domainAdminPermissions');
const DomainTitleProjection = require('../../models/DomainTitleProjection');
const {
  isDomainTitleStateCollectionReadEnabled,
  BATTLEFIELD_FIELD_WIDTH,
  BATTLEFIELD_FIELD_HEIGHT,
  hydrateNodeTitleStatesForNodes,
  resolveNodeDefenseLayout,
  resolveNodeBattlefieldLayout,
  resolveNodeSiegeState,
  upsertNodeDefenseLayout,
  upsertNodeBattlefieldLayout,
  normalizeBattlefieldLayout,
  upsertNodeSiegeState,
  deleteNodeTitleStatesByNodeIds
} = require('../../services/domainTitleStateStore');
const {
  BATTLEFIELD_OBJECT_DEFAULT_WIDTH,
  BATTLEFIELD_OBJECT_DEFAULT_DEPTH,
  BATTLEFIELD_OBJECT_DEFAULT_HEIGHT,
  normalizeBattlefieldItemGeometryScale
} = require('../../services/battlefieldScale');
const {
  isDomainTitleProjectionReadEnabled,
  syncDomainTitleProjectionFromNode,
  deleteDomainTitleProjectionByNodeIds,
  listActiveTitleRelationsBySourceNodeIds,
  listActiveTitleRelationsByTargetNodeIds
} = require('../../services/domainTitleProjectionStore');
const {
  resolveEffectiveStarMapLimit
} = require('../../services/gameSettingsService');
const {
  traverseTitleStarMap,
  traverseSenseStarMap
} = require('../../services/starMapTraversalService');
const { authenticateToken } = require('../../middleware/auth');
const { isAdmin } = require('../../middleware/admin');
const { encodeTimeCursor, decodeTimeCursor, buildTimeCursorQuery } = require('../../utils/cursorPagination');
const createNodeRouteModuleDeps = require('./deps');
const createNodeRouteCommonHelpers = require('./shared/common');
const createNodeRouteSearchHelpers = require('./shared/search');
const createNodeRouteAssociationHelpers = require('./shared/associations');
const createNodeRouteVisualStyleHelpers = require('./shared/visualStyle');
const createNodeRouteDistributionHelpers = require('./shared/distribution');
const createNodeRouteIntelHelpers = require('./shared/intel');
const createNodeRouteDefenseHelpers = require('./shared/defense');
const createNodeRouteSiegeHelpers = require('./shared/siege');

const {
  fetchEnabledUnitTypes,
  getIdString,
  isValidObjectId,
  pushNotificationToUser,
  toCollectionNotificationDoc,
  pushDomainCreateApplyResultNotification,
  isDomainMaster,
  isDomainAdmin,
  DOMAIN_CARD_SELECT,
  normalizeNodeSenseList,
  sendNodeRouteError,
  loadCanonicalNodeResponseById,
  mapProjectionRowToNodeLike,
  deleteNodeWithResources
} = createNodeRouteCommonHelpers({
  mongoose,
  Node,
  NodeSense,
  User,
  schedulerService,
  fetchUnitTypesWithComponents,
  isNodeSenseCollectionReadEnabled,
  isNodeSenseRepairEnabled,
  hydrateNodeSensesForNodes,
  resolveNodeSensesForNode,
  deleteNodeTitleStatesByNodeIds,
  deleteDomainTitleProjectionByNodeIds
});

const {
  buildNodeSenseDisplayName,
  normalizeRecentVisitMode,
  allocateNextSenseId,
  buildNodeSenseSearchEntries,
  compareSearchCoverageScore,
  computeAdminNodeSearchCoverageScore,
  computePublicSearchEntryCoverageScore,
  buildNodeTitleCard,
  toSafeInteger,
  encodeNameCursor,
  decodeNameCursor,
  escapeRegex,
  loadNodeSearchCandidates
} = createNodeRouteSearchHelpers({
  Node,
  NodeSense,
  getIdString,
  isValidObjectId,
  normalizeNodeSenseList,
  hydrateNodeSensesForNodes,
  isNodeSenseCollectionReadEnabled
});

const {
  normalizeAssociationRelationType,
  normalizeAssociationInsertSide,
  pickNodeSenseById,
  normalizeAssociationDraftList,
  dedupeAssociationList,
  validateAssociationRuleSet,
  normalizeAssociationRemovalStrategy,
  normalizeRelationAssociationList,
  normalizeTitleRelationAssociationList,
  countNodeSenseAssociationRefs,
  removeNodeReferencesForDeletion,
  computeLostBridgePairs,
  resolveReconnectPairsByDecisions,
  applyReconnectPairs,
  buildAssociationMutationSummary,
  validateAssociationMutationPermission,
  parseAssociationMutationPayload,
  buildAssociationMutationPreviewData,
  resolveAssociationsWithInsertPlans,
  rebuildRelatedDomainNamesForNodes,
  applyInsertAssociationRewire,
  syncReciprocalAssociationsForNode
} = createNodeRouteAssociationHelpers({
  Node,
  User,
  hydrateNodeSensesForNodes,
  syncDomainTitleProjectionFromNode,
  normalizeNodeSenseList,
  getIdString,
  isValidObjectId,
  isDomainMaster
});

const {
  attachVisualStyleToNodeList
} = createNodeRouteVisualStyleHelpers({
  User,
  EntropyAlliance,
  getIdString,
  isValidObjectId
});

const {
  toDistributionSessionExecuteAt,
  DISTRIBUTION_LEGACY_PARTICIPANT_MIRROR_LIMIT,
  DISTRIBUTION_POOL_USER_LIST_LIMIT,
  DISTRIBUTION_RESULT_PAGE_SIZE_MAX,
  parseDistributionResultCursor,
  listDistributionResultsByNode,
  buildManualJoinOrderMapFromLegacyLock,
  getActiveManualParticipantSet,
  listDistributionParticipantsBySession,
  syncDistributionParticipantJoinRecord,
  syncDistributionParticipantExitRecord,
  READ_LEGACY_RESULTUSERREWARDS,
  clampPercent,
  round2,
  sanitizeDistributionRuleInput,
  sanitizeDistributionRuleProfileInput,
  collectRuleUserIds,
  loadCommonUserIdSet,
  filterRuleUsersByAllowedSet,
  computeDistributionPercentSummary,
  serializeDistributionRule,
  serializeDistributionLock,
  parseDistributionExecuteAtHour,
  extractDistributionProfilesFromNode,
  resolveDistributionLockTimeline,
  getDistributionLockPhase,
  isUserIdleAtNode
} = createNodeRouteDistributionHelpers({
  mongoose,
  User,
  DistributionParticipant,
  DistributionResult,
  KnowledgeDistributionService,
  getIdString,
  isValidObjectId,
  decodeTimeCursor,
  encodeTimeCursor,
  buildTimeCursorQuery
});

const {
  serializeIntelSnapshot,
  normalizeUserIntelSnapshotStore,
  findUserIntelSnapshotByNodeId,
  checkIntelHeistPermission,
  buildIntelGateDefenseSnapshot,
  normalizeGateDefenseViewerAdminIds
} = createNodeRouteIntelHelpers({
  getIdString,
  isValidObjectId,
  isDomainMaster,
  isDomainAdmin,
  cityGateKeys: ['cheng', 'qi'],
  userIntelSnapshotLimit: 5
});

const {
  CITY_BUILDING_LIMIT,
  CITY_GATE_KEYS,
  USER_INTEL_SNAPSHOT_LIMIT,
  CITY_GATE_LABELS,
  BATTLEFIELD_DEPLOY_ZONE_RATIO,
  normalizeDefenseLayoutInput,
  serializeDefenseLayout,
  normalizeBattlefieldGateKey,
  normalizeBattlefieldLayoutId,
  findBattlefieldLayoutByGate,
  serializeBattlefieldStateForGate,
  mergeBattlefieldStateByGate,
  buildArmyUnitTypeMap,
  normalizeUnitCountEntries,
  buildUnitCountMap,
  mergeUnitCountMaps,
  mapToUnitCountEntries,
  normalizeUserRoster,
  isGateEnabledForNode,
  hasAnyGateDefenseSnapshotEntries,
  buildBattlefieldGateDefenseSnapshotFromNode,
  normalizeDefenderDeploymentUnits,
  buildGateDefenseView
} = createNodeRouteDefenseHelpers({
  normalizeBattlefieldLayout,
  normalizeBattlefieldItemGeometryScale,
  resolveNodeBattlefieldLayout,
  BATTLEFIELD_FIELD_WIDTH,
  BATTLEFIELD_FIELD_HEIGHT,
  BATTLEFIELD_OBJECT_DEFAULT_WIDTH,
  BATTLEFIELD_OBJECT_DEFAULT_DEPTH,
  BATTLEFIELD_OBJECT_DEFAULT_HEIGHT,
  normalizeGateDefenseViewerAdminIds
});

const {
  SIEGE_SUPPORT_UNIT_DURATION_SECONDS,
  SIEGE_PARTICIPANT_PREVIEW_LIMIT,
  SIEGE_PARTICIPANT_RESULT_LIMIT_MAX,
  SIEGE_PVE_UNITS_PER_SOLDIER,
  SIEGE_PVE_TIME_LIMIT_SEC,
  serializeSiegeAttacker,
  resolveAttackGateByArrival,
  getNodeGateState,
  createEmptySiegeGateState,
  getMutableNodeSiegeState,
  settleNodeSiegeState,
  isSameAlliance,
  isSiegeAttackerActive,
  buildSiegeGateSummary,
  buildSiegePayloadForUser,
  normalizeBattleResultSide,
  sanitizeBattleResultDetails,
  resolveSiegePveBattleContext
} = createNodeRouteSiegeHelpers({
  Node,
  User,
  fetchEnabledUnitTypes,
  hydrateNodeTitleStatesForNodes,
  resolveNodeSiegeState,
  resolveNodeDefenseLayout,
  upsertNodeSiegeState,
  migrateEmbeddedSiegeAttackers,
  settleSiegeArrivedParticipants,
  getSiegeGatePreview,
  getIdString,
  isValidObjectId,
  isDomainMaster,
  isDomainAdmin,
  serializeDefenseLayout,
  buildIntelGateDefenseSnapshot,
  hasAnyGateDefenseSnapshotEntries,
  buildBattlefieldGateDefenseSnapshotFromNode,
  buildGateDefenseView,
  buildUnitCountMap,
  mapToUnitCountEntries,
  mergeUnitCountMaps,
  normalizeUserRoster,
  buildArmyUnitTypeMap,
  isGateEnabledForNode,
  CITY_GATE_KEYS,
  CITY_GATE_LABELS
});

const deps = createNodeRouteModuleDeps({
  models: {
    mongoose,
    Node,
    NodeSense,
    User,
    Notification,
    DomainTitleProjection,
    SiegeBattleRecord,
    DistributionParticipant,
    DistributionResult,
    EntropyAlliance
  },
  platform: {
    randomUUID,
    KnowledgeDistributionService,
    schedulerService,
    fetchArmyUnitTypes,
    fetchBattlefieldItems,
    fetchCityBuildingTypes,
    UNIT_TYPE_DTO_VERSION,
    ensureUserBattlefieldInventory,
    resolveUserItemLimitMap,
    upsertNotificationsToCollection,
    normalizeSiegeParticipantUnits,
    upsertSiegeParticipant,
    markSiegeParticipantsRetreated,
    getSiegeGatePreview,
    listSiegeParticipants,
    findActiveSiegeParticipant,
    findUserActiveParticipants,
    findShortestApprovedPathToAnyTargets,
    listApprovedNodesByNames
  },
  state: {
    hydrateNodeSensesForNodes,
    hydrateNodeTitleStatesForNodes,
    isDomainTitleStateCollectionReadEnabled,
    resolveNodeDefenseLayout,
    resolveNodeSiegeState,
    resolveNodeBattlefieldLayout,
    upsertNodeDefenseLayout,
    upsertNodeSiegeState,
    upsertNodeBattlefieldLayout,
    deleteNodeTitleStatesByNodeIds,
    deleteDomainTitleProjectionByNodeIds,
    saveNodeSenses
  },
  projections: {
    isDomainTitleProjectionReadEnabled,
    mapProjectionRowToNodeLike,
    listActiveTitleRelationsBySourceNodeIds,
    listActiveTitleRelationsByTargetNodeIds,
    resolveEffectiveStarMapLimit,
    traverseTitleStarMap,
    traverseSenseStarMap,
    syncDomainTitleProjectionFromNode,
    loadCanonicalNodeResponseById,
    attachVisualStyleToNodeList
  },
  search: {
    toSafeInteger,
    decodeNameCursor,
    encodeNameCursor,
    escapeRegex,
    allocateNextSenseId,
    loadNodeSearchCandidates,
    buildNodeSenseSearchEntries,
    computeAdminNodeSearchCoverageScore,
    computePublicSearchEntryCoverageScore,
    compareSearchCoverageScore,
    buildNodeTitleCard,
    pickNodeSenseById,
    normalizeAssociationRelationType,
    buildNodeSenseDisplayName,
    normalizeNodeSenseList
  },
  auth: {
    authenticateToken,
    isAdmin,
    sendNodeRouteError,
    isValidObjectId,
    getIdString,
    DOMAIN_CARD_SELECT,
    normalizeRecentVisitMode,
    pushNotificationToUser,
    pushDomainCreateApplyResultNotification,
    toCollectionNotificationDoc,
    writeNotificationsToCollection,
    isDomainMaster,
    isDomainAdmin,
    isNotificationCollectionReadEnabled
  },
  permissions: {
    buildDomainAdminPermissionState,
    DOMAIN_ADMIN_PERMISSION_KEYS,
    DOMAIN_ADMIN_PERMISSION_DEFINITIONS,
    normalizeGateDefenseViewerAdminIds,
    getNodeDomainAdminPermissionMap,
    normalizePermissionKeys
  },
  defense: {
    normalizeDefenseLayoutInput,
    serializeDefenseLayout,
    buildBattlefieldGateDefenseSnapshotFromNode,
    buildIntelGateDefenseSnapshot,
    hasAnyGateDefenseSnapshotEntries,
    normalizeUserIntelSnapshotStore,
    findUserIntelSnapshotByNodeId,
    serializeIntelSnapshot,
    checkIntelHeistPermission,
    serializeBattlefieldStateForGate,
    mergeBattlefieldStateByGate,
    normalizeBattlefieldGateKey,
    normalizeBattlefieldLayoutId,
    buildArmyUnitTypeMap,
    normalizeUnitCountEntries,
    findBattlefieldLayoutByGate,
    BATTLEFIELD_FIELD_WIDTH,
    BATTLEFIELD_DEPLOY_ZONE_RATIO,
    normalizeDefenderDeploymentUnits,
    USER_INTEL_SNAPSHOT_LIMIT,
    CITY_GATE_KEYS,
    CITY_BUILDING_LIMIT,
    CITY_GATE_LABELS,
    mapToUnitCountEntries,
    normalizeUserRoster,
    buildUnitCountMap,
    mergeUnitCountMaps
  },
  siege: {
    settleNodeSiegeState,
    buildSiegePayloadForUser,
    serializeSiegeAttacker,
    SIEGE_PARTICIPANT_RESULT_LIMIT_MAX,
    SIEGE_PARTICIPANT_PREVIEW_LIMIT,
    buildSiegeGateSummary,
    resolveSiegePveBattleContext,
    SIEGE_PVE_TIME_LIMIT_SEC,
    SIEGE_PVE_UNITS_PER_SOLDIER,
    normalizeBattleResultSide,
    sanitizeBattleResultDetails,
    resolveAttackGateByArrival,
    isGateEnabledForNode,
    getNodeGateState,
    isSiegeAttackerActive,
    isSameAlliance,
    getMutableNodeSiegeState,
    createEmptySiegeGateState,
    SIEGE_SUPPORT_UNIT_DURATION_SECONDS
  },
  distribution: {
    extractDistributionProfilesFromNode,
    serializeDistributionRule,
    serializeDistributionLock,
    filterRuleUsersByAllowedSet,
    computeDistributionPercentSummary,
    round2,
    clampPercent,
    collectRuleUserIds,
    loadCommonUserIdSet,
    sanitizeDistributionRuleProfileInput,
    sanitizeDistributionRuleInput,
    parseDistributionExecuteAtHour,
    toDistributionSessionExecuteAt,
    resolveDistributionLockTimeline,
    getDistributionLockPhase,
    READ_LEGACY_RESULTUSERREWARDS,
    getActiveManualParticipantSet,
    buildManualJoinOrderMapFromLegacyLock,
    DISTRIBUTION_POOL_USER_LIST_LIMIT,
    listDistributionParticipantsBySession,
    listDistributionResultsByNode,
    parseDistributionResultCursor,
    DISTRIBUTION_RESULT_PAGE_SIZE_MAX,
    syncDistributionParticipantJoinRecord,
    syncDistributionParticipantExitRecord,
    DISTRIBUTION_LEGACY_PARTICIPANT_MIRROR_LIMIT,
    isUserIdleAtNode
  },
  associations: {
    normalizeAssociationDraftList,
    validateAssociationRuleSet,
    normalizeRelationAssociationList,
    dedupeAssociationList,
    normalizeAssociationRemovalStrategy,
    normalizeTitleRelationAssociationList,
    resolveAssociationsWithInsertPlans,
    rebuildRelatedDomainNamesForNodes,
    applyInsertAssociationRewire,
    syncReciprocalAssociationsForNode,
    countNodeSenseAssociationRefs,
    removeNodeReferencesForDeletion,
    deleteNodeWithResources,
    computeLostBridgePairs,
    resolveReconnectPairsByDecisions,
    applyReconnectPairs,
    buildAssociationMutationSummary,
    validateAssociationMutationPermission,
    parseAssociationMutationPayload,
    buildAssociationMutationPreviewData,
    bootstrapArticleFromNodeSense
  }
});

module.exports = {
  deps
};
