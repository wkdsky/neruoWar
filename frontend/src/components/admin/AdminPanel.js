import React, { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import AdminTabNavigation from './AdminTabNavigation';
import AdminUsersFeature from './features/users/AdminUsersFeature';
import AdminSettingsFeature from './features/settings/AdminSettingsFeature';
import AdminCatalogFeature from './features/catalog/AdminCatalogFeature';
import AdminPendingFeature from './features/pending/AdminPendingFeature';
import AdminAlliancesFeature from './features/alliances/AdminAlliancesFeature';
import AdminNodesFeature from './features/nodes/AdminNodesFeature';
import useAdminUsersFeature from './features/users/hooks/useAdminUsersFeature';
import useAdminSettingsFeature from './features/settings/hooks/useAdminSettingsFeature';
import useAdminCatalogFeature from './features/catalog/hooks/useAdminCatalogFeature';
import useAdminPendingFeature from './features/pending/hooks/useAdminPendingFeature';
import useAdminAlliancesFeature from './features/alliances/hooks/useAdminAlliancesFeature';
import useAdminNodesShellFeature from './features/nodes/hooks/useAdminNodesShellFeature';
import useAdminNodeRelationsSupport from './features/nodes/hooks/useAdminNodeRelationsSupport';
import useAdminNewSenseFeature from './features/nodes/hooks/useAdminNewSenseFeature';
import useAdminDeleteSenseFlow from './features/nodes/hooks/useAdminDeleteSenseFlow';
import useAdminDeleteNodeFlow from './features/nodes/hooks/useAdminDeleteNodeFlow';
import useAdminAssociationsFeature from './features/nodes/hooks/useAdminAssociationsFeature';
import { REL_SYMBOL_SUPERSET, REL_SYMBOL_SUBSET } from './adminAssociationHelpers';
import {
    ASSOC_STEPS,
    ASSOC_RELATION_TYPES
} from '../shared/associationFlowShared';
import { useUserCard } from '../social/UserCardContext';
import './Admin.css';
const ADMIN_USER_PAGE_SIZE_OPTIONS = [10, 20, 30, 50];
const ADMIN_DOMAIN_PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 30];

const AdminPanel = ({ initialTab = 'users', onPendingMasterApplyHandled, onCreateNode }) => {
    const [adminTab, setAdminTab] = useState(initialTab);
    const { openUserCard } = useUserCard();
    
    const {
        allUsers,
        adminUserPagination,
        adminUserPageSize,
        isAdminUserLoading,
        adminUserSearchInput,
        adminUserSearchKeyword,
        adminUserActionFeedback,
        editingUser,
        editForm,
        setEditForm,
        setEditingUser,
        setAdminUserSearchInput,
        fetchAllUsers,
        submitAdminUserSearch,
        clearAdminUserSearch,
        handleAdminUserPageSizeChange,
        startEditUser,
        saveUserEdit,
        deleteUser,
        refreshUsers,
        goToPrevUserPage,
        goToNextUserPage
    } = useAdminUsersFeature();

    const {
        travelUnitInput,
        distributionLeadInput,
        starMapNodeLimitInput,
        travelUnitSeconds,
        distributionAnnouncementLeadHours,
        starMapNodeLimit,
        setTravelUnitInput,
        setDistributionLeadInput,
        setStarMapNodeLimitInput,
        fetchAdminSettings,
        saveAdminSettings
    } = useAdminSettingsFeature();
    const {
        armyUnitTypes,
        isCreatingUnitType,
        editingUnitTypeId,
        unitTypeForm,
        unitTypeActionId,
        setUnitTypeForm,
        fetchArmyUnitTypes,
        startCreateUnitType,
        saveUnitType,
        resetUnitTypeEditor,
        startEditUnitType,
        deleteUnitType,
        battlefieldItems,
        isCreatingBattlefieldItem,
        editingBattlefieldItemId,
        battlefieldItemForm,
        battlefieldItemActionId,
        setBattlefieldItemForm,
        fetchBattlefieldItemCatalog,
        startCreateBattlefieldItem,
        saveBattlefieldItem,
        resetBattlefieldItemEditor,
        startEditBattlefieldItem,
        deleteBattlefieldItem,
        cityBuildingTypes,
        isCreatingCityBuildingType,
        editingCityBuildingTypeId,
        cityBuildingTypeForm,
        cityBuildingTypeActionId,
        setCityBuildingTypeForm,
        fetchCityBuildingTypeCatalog,
        startCreateCityBuildingType,
        saveCityBuildingType,
        resetCityBuildingTypeEditor,
        startEditCityBuildingType,
        deleteCityBuildingType
    } = useAdminCatalogFeature();

    const {
        allNodes,
        adminDomainPage,
        adminDomainPagination,
        isAdminDomainLoading,
        adminDomainSearchInput,
        adminDomainSearchKeyword,
        adminDomainPageSize,
        editingNode,
        editNodeForm,
        showEditNodeModal,
        isSavingNodeEdit,
        editingSenseToken,
        editingSenseForm,
        editingSenseActionToken,
        showChangeMasterModal,
        changingMasterNode,
        masterSearchKeyword,
        masterSearchResults,
        isMasterSearchLoading,
        hasMasterSearchTriggered,
        selectedNewMaster,
        setAdminDomainSearchInput,
        setEditNodeForm,
        setEditingSenseForm,
        setMasterSearchKeyword,
        setMasterSearchResults,
        setHasMasterSearchTriggered,
        setSelectedNewMaster,
        setShowChangeMasterModal,
        fetchAllNodes,
        refreshAdminDomainLatest,
        submitAdminDomainSearch,
        clearAdminDomainSearch,
        handleAdminDomainPageSizeChange,
        startEditNode,
        closeEditNodeModal,
        saveNodeEdit,
        getSenseEditToken,
        startEditSenseText,
        cancelEditSenseText,
        saveSenseTextEdit,
        toggleFeaturedNode,
        searchUsersForMaster,
        openChangeMasterModal,
        confirmChangeMaster
    } = useAdminNodesShellFeature();

    // Master Change State
    const {
        adminAlliances,
        adminAlliancePagination,
        isAdminAllianceLoading,
        editingAlliance,
        editAllianceForm,
        showAllianceMemberModal,
        editAllianceMembers,
        allianceMemberDraft,
        isAllianceMemberLoading,
        allianceMemberSearchKeyword,
        allianceMemberSearchResults,
        isAllianceMemberSearchLoading,
        hasAllianceMemberSearchTriggered,
        fetchAdminAlliances,
        searchAllianceMemberCandidates,
        openAllianceMemberModal,
        closeAllianceMemberModal,
        addAllianceMemberDraftUser,
        removeAllianceMemberDraftUser,
        confirmAllianceMemberDraft,
        handleAllianceFieldChange,
        handleAllianceMemberSearchKeywordChange,
        startEditAlliance,
        cancelEditAlliance,
        saveAllianceEdit,
        deleteAlliance,
        refreshAdminAlliances,
        goToPrevAdminAlliancePage,
        goToNextAdminAlliancePage
    } = useAdminAlliancesFeature();

    // Initial Fetch
    useEffect(() => {
        fetchPendingNodes();
        fetchPendingMasterApplications();
        fetchAllUsers(1);
        fetchAllNodes(1);
        fetchAdminSettings();
        fetchArmyUnitTypes();
        fetchBattlefieldItemCatalog();
        fetchCityBuildingTypeCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Node Management Functions ---
    const {
        showDeleteSenseModal,
        deletingSenseContext,
        deleteSensePreviewData,
        deleteSensePreviewLoading,
        showDeleteSenseDecisionModal,
        deleteSenseDecisionPair,
        deleteSenseDecisionApplying,
        isDeletingSense,
        deleteSenseBeforeRelations,
        deleteSenseAfterRelations,
        deleteSenseWillDeleteNode,
        deleteSenseLostBridgePairs,
        deleteSensePendingBridgePairs,
        deleteSenseConfirmedBridgePairs,
        openDeleteSenseModal,
        closeDeleteSenseModal,
        closeDeleteSenseDecisionModal,
        openDeleteSenseDecisionModal,
        applyDeleteSensePairDecision,
        rollbackDeleteSensePairDecision,
        deleteSense
    } = useAdminDeleteSenseFlow({
        adminDomainPage,
        adminDomainSearchKeyword,
        allNodesLength: allNodes.length,
        fetchAllNodes
    });

    const {
        normalizeNodeSenses,
        formatBackendRelationExpression,
        formatUiRelationExpression,
        resolveAssociationDisplayType,
        resolveNodeSenseId,
        formatNodeSenseDisplay,
        resolveAssociationNodeId,
        resolveAssociationSenseId,
        toBridgeDecisionPayload,
        resolveDeleteBridgePairMode,
        formatRelationArrowText,
        normalizeAssociationCandidate,
        fetchSenseRelationContext,
        nodeByIdMap,
        resolveDecisionCurrentDisplay,
        resolveDecisionPairSideDisplay,
        resolveAssociationTargetDisplay,
        getEditableSenseAssociationCount,
        buildNodeDeletePreview,
        hierarchicalNodeList
    } = useAdminNodeRelationsSupport({ allNodes });
    const {
        pendingApprovalCount,
        pendingNodes,
        pendingMasterApplications,
        groupedPendingNodes,
        groupedPendingMasterApplications,
        pendingNodeActionId,
        pendingNodeActionGroupName,
        pendingNodeSelectedSenseByNodeId,
        masterApplyActionId,
        fetchPendingNodes,
        fetchPendingMasterApplications,
        refreshPendingApprovals,
        approveNode,
        rejectNode,
        reviewMasterApplication,
        getPendingSenseAssociations,
        selectPendingNodeSense
    } = useAdminPendingFeature({
        onPendingMasterApplyHandled,
        normalizeNodeSenses,
        formatBackendRelationExpression,
        formatNodeSenseDisplay,
        nodeByIdMap,
        resolveAssociationTargetDisplay
    });

    const {
        showDeleteNodeConfirmModal,
        deletingNodeTarget,
        isDeletingNode,
        deletePreviewData,
        deletePreviewLoading,
        deleteBridgeDecisions,
        deletingNodePreview,
        deletePreviewSummary,
        deleteBeforeRelations,
        deleteAfterRelations,
        deleteLostBridgePairs,
        openDeleteNodeConfirmModal,
        closeDeleteNodeConfirmModal,
        deleteNode,
        handleDeleteNodeBridgeDecision
    } = useAdminDeleteNodeFlow({
        adminDomainPage,
        adminDomainSearchKeyword,
        allNodesLength: allNodes.length,
        fetchAllNodes,
        buildNodeDeletePreview
    });

    const {
        showAddSenseModal,
        addingSenseNode,
        isSavingNewSense,
        newSenseForm,
        newSenseAssocFlow,
        newSenseAssocSourceDisplay,
        newSenseAssocTargetDisplay,
        newSenseAssocSecondTargetDisplay,
        newSenseAssocNodeASenseOptions,
        newSenseAssocInsertRelationAvailable,
        newSenseAssocInsertRelationUnavailableReason,
        newSenseAssocNodeBCandidateView,
        newSenseAssocPreviewCanvasRef,
        newSenseAssocPreviewInfoText,
        setNewSenseForm,
        setNewSenseAssocFlow,
        openAddSenseModal,
        closeAddSenseModal,
        removeRelationFromNewSense,
        searchNewSenseAssocNodeA,
        clearNewSenseAssocNodeASearch,
        selectNewSenseAssocNodeA,
        handleNewSenseAssocNodeASenseChange,
        selectNewSenseAssocRelationType,
        submitNewSenseAssocNodeBSearch,
        selectNewSenseAssocNodeB,
        confirmNewSenseAssocRelation,
        goBackNewSenseAssocStep,
        cancelNewSenseAssocFlow,
        startNewSenseRelationEditor,
        saveNewSense
    } = useAdminNewSenseFeature({
        allNodes,
        normalizeNodeSenses,
        normalizeAssociationCandidate,
        resolveAssociationSenseId,
        formatNodeSenseDisplay,
        fetchSenseRelationContext,
        fetchAllNodes,
        adminDomainPage,
        adminDomainSearchKeyword
    });

    const {
        showEditAssociationModal,
        editingAssociationNode,
        editingAssociationSenseId,
        editAssociations,
        isEditAssociationListExpanded,
        assocCurrentStep,
        assocSelectedRelationType,
        assocSelectedSourceSenseId,
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        assocSelectedNodeB,
        assocSelectedNodeBSenseId,
        assocInsertDirection,
        assocNodeASenseOptions,
        assocInsertRelationAvailable,
        assocInsertRelationUnavailableReason,
        assocSearchKeyword,
        assocSearchAppliedKeyword,
        assocSearchLoading,
        assocSearchResults,
        assocNodeBView,
        assocNodeBSearchAppliedKeyword,
        assocNodeBSearchKeyword,
        assocPreviewCanvasRef,
        assocPreviewInfoText,
        assocApplyLoading,
        setIsEditAssociationListExpanded,
        setAssocSearchKeyword,
        searchAssociationNodes,
        clearAssocNodeASearch,
        selectAssocNodeA,
        handleAssocNodeASenseChange,
        selectAssocRelationType,
        submitAssocNodeBSearch,
        selectAssocNodeB,
        confirmEditAssociation,
        goBackAssocStep,
        resetAssociationEditor,
        startAddEditAssociation,
        editExistingAssociation,
        removeEditAssociation,
        saveAssociationEdit,
        closeEditAssociationModal,
        openEditAssociationModal,
        showAssocDeleteDecisionModal,
        assocDeleteDecisionContext,
        assocDeleteDecisionAction,
        assocDeleteApplying,
        assocDeleteSelectedTarget,
        assocDeleteReplacementDisplay,
        shouldShowAssocDeleteSearch,
        assocDeleteSearchKeyword,
        assocDeleteSearchAppliedKeyword,
        assocDeleteSearchResults,
        assocDeleteSearchLoading,
        setAssocDeleteDecisionAction,
        setAssocDeleteSearchKeyword,
        setAssocDeleteSelectedTarget,
        searchAssocDeleteTargets,
        confirmAssocDeleteDecision,
        clearAssocDeleteSearch,
        closeAssocDeleteDecisionModal
    } = useAdminAssociationsFeature({
        allNodes,
        adminDomainPage,
        adminDomainSearchKeyword,
        fetchAllNodes,
        fetchSenseRelationContext,
        normalizeNodeSenses,
        normalizeAssociationCandidate,
        resolveAssociationDisplayType,
        resolveNodeSenseId,
        formatNodeSenseDisplay,
        resolveAssociationNodeId,
        resolveAssociationSenseId,
        toBridgeDecisionPayload,
        resolveDecisionCurrentDisplay,
        resolveDecisionPairSideDisplay,
        formatUiRelationExpression,
        nodeByIdMap
    });

    return (
        <div className="admin-section admin-section--shell">
            <h2 className="section-title-large">
                <Users className="icon" />
                管理员面板
            </h2>

            <AdminTabNavigation
                adminTab={adminTab}
                pendingApprovalCount={pendingApprovalCount}
                onSelectTab={(tabKey) => {
                    if (tabKey === 'users') {
                        setAdminTab('users');
                        fetchAllUsers(1, adminUserSearchKeyword);
                        return;
                    }
                    if (tabKey === 'nodes') {
                        setAdminTab('nodes');
                        fetchAllNodes(1, adminDomainSearchKeyword, adminDomainPageSize, { forceLatest: true });
                        return;
                    }
                    if (tabKey === 'pending') {
                        setAdminTab('pending');
                        refreshPendingApprovals();
                        return;
                    }
                    if (tabKey === 'alliances') {
                        setAdminTab('alliances');
                        fetchAdminAlliances(1);
                        return;
                    }
                    if (tabKey === 'settings') {
                        setAdminTab('settings');
                        fetchAdminSettings();
                        return;
                    }
                    if (tabKey === 'unitTypes') {
                        setAdminTab('unitTypes');
                        fetchArmyUnitTypes();
                        return;
                    }
                    if (tabKey === 'battlefieldItems') {
                        setAdminTab('battlefieldItems');
                        fetchBattlefieldItemCatalog();
                        return;
                    }
                    if (tabKey === 'cityBuildingTypes') {
                        setAdminTab('cityBuildingTypes');
                        fetchCityBuildingTypeCatalog();
                    }
                }}
            />

            <AdminUsersFeature
                isActive={adminTab === 'users'}
                onOpenUserCard={openUserCard}
                adminUserPagination={adminUserPagination}
                adminUserPageSize={adminUserPageSize}
                pageSizeOptions={ADMIN_USER_PAGE_SIZE_OPTIONS}
                isAdminUserLoading={isAdminUserLoading}
                adminUserSearchInput={adminUserSearchInput}
                adminUserSearchKeyword={adminUserSearchKeyword}
                adminUserActionFeedback={adminUserActionFeedback}
                allUsers={allUsers}
                editingUser={editingUser}
                editForm={editForm}
                setEditForm={setEditForm}
                setEditingUser={setEditingUser}
                onAdminUserSearchInputChange={setAdminUserSearchInput}
                onAdminUserSearchSubmit={submitAdminUserSearch}
                onAdminUserSearchClear={clearAdminUserSearch}
                onAdminUserPageSizeChange={handleAdminUserPageSizeChange}
                onRefreshUsers={refreshUsers}
                onSaveUserEdit={saveUserEdit}
                onStartEditUser={startEditUser}
                onDeleteUser={deleteUser}
                onPrevPage={goToPrevUserPage}
                onNextPage={goToNextUserPage}
            />

            <AdminSettingsFeature
                isActive={adminTab === 'settings'}
                travelUnitInput={travelUnitInput}
                distributionLeadInput={distributionLeadInput}
                starMapNodeLimitInput={starMapNodeLimitInput}
                travelUnitSeconds={travelUnitSeconds}
                distributionAnnouncementLeadHours={distributionAnnouncementLeadHours}
                starMapNodeLimit={starMapNodeLimit}
                onTravelUnitInputChange={setTravelUnitInput}
                onDistributionLeadInputChange={setDistributionLeadInput}
                onStarMapNodeLimitInputChange={setStarMapNodeLimitInput}
                onSaveAdminSettings={saveAdminSettings}
                onReloadAdminSettings={fetchAdminSettings}
            />

            <AdminCatalogFeature
                activeTab={adminTab}
                armyUnitTypes={armyUnitTypes}
                isCreatingUnitType={isCreatingUnitType}
                editingUnitTypeId={editingUnitTypeId}
                unitTypeForm={unitTypeForm}
                unitTypeActionId={unitTypeActionId}
                setUnitTypeForm={setUnitTypeForm}
                fetchArmyUnitTypes={fetchArmyUnitTypes}
                startCreateUnitType={startCreateUnitType}
                saveUnitType={saveUnitType}
                resetUnitTypeEditor={resetUnitTypeEditor}
                startEditUnitType={startEditUnitType}
                deleteUnitType={deleteUnitType}
                battlefieldItems={battlefieldItems}
                isCreatingBattlefieldItem={isCreatingBattlefieldItem}
                editingBattlefieldItemId={editingBattlefieldItemId}
                battlefieldItemForm={battlefieldItemForm}
                battlefieldItemActionId={battlefieldItemActionId}
                setBattlefieldItemForm={setBattlefieldItemForm}
                fetchBattlefieldItemCatalog={fetchBattlefieldItemCatalog}
                startCreateBattlefieldItem={startCreateBattlefieldItem}
                saveBattlefieldItem={saveBattlefieldItem}
                resetBattlefieldItemEditor={resetBattlefieldItemEditor}
                startEditBattlefieldItem={startEditBattlefieldItem}
                deleteBattlefieldItem={deleteBattlefieldItem}
                cityBuildingTypes={cityBuildingTypes}
                isCreatingCityBuildingType={isCreatingCityBuildingType}
                editingCityBuildingTypeId={editingCityBuildingTypeId}
                cityBuildingTypeForm={cityBuildingTypeForm}
                cityBuildingTypeActionId={cityBuildingTypeActionId}
                setCityBuildingTypeForm={setCityBuildingTypeForm}
                fetchCityBuildingTypeCatalog={fetchCityBuildingTypeCatalog}
                startCreateCityBuildingType={startCreateCityBuildingType}
                saveCityBuildingType={saveCityBuildingType}
                resetCityBuildingTypeEditor={resetCityBuildingTypeEditor}
                startEditCityBuildingType={startEditCityBuildingType}
                deleteCityBuildingType={deleteCityBuildingType}
            />

            <AdminPendingFeature
                isActive={adminTab === 'pending'}
                pendingApprovalCount={pendingApprovalCount}
                pendingNodes={pendingNodes}
                pendingMasterApplications={pendingMasterApplications}
                groupedPendingNodes={groupedPendingNodes}
                groupedPendingMasterApplications={groupedPendingMasterApplications}
                pendingNodeActionId={pendingNodeActionId}
                pendingNodeActionGroupName={pendingNodeActionGroupName}
                pendingNodeSelectedSenseByNodeId={pendingNodeSelectedSenseByNodeId}
                masterApplyActionId={masterApplyActionId}
                normalizeNodeSenses={normalizeNodeSenses}
                getPendingSenseAssociations={getPendingSenseAssociations}
                selectPendingNodeSense={selectPendingNodeSense}
                approveNode={approveNode}
                rejectNode={rejectNode}
                reviewMasterApplication={reviewMasterApplication}
                refreshPendingApprovals={refreshPendingApprovals}
            />

            <AdminNodesFeature
                isActive={adminTab === 'nodes'}
                showEditNodeModal={showEditNodeModal}
                editingNode={editingNode}
                editNodeForm={editNodeForm}
                isSavingNodeEdit={isSavingNodeEdit}
                setEditNodeForm={setEditNodeForm}
                closeEditNodeModal={closeEditNodeModal}
                saveNodeEdit={saveNodeEdit}
                showAddSenseModal={showAddSenseModal}
                addingSenseNode={addingSenseNode}
                isSavingNewSense={isSavingNewSense}
                newSenseForm={newSenseForm}
                newSenseAssocFlow={newSenseAssocFlow}
                assocSteps={ASSOC_STEPS}
                assocRelationTypes={ASSOC_RELATION_TYPES}
                relSymbolSubset={REL_SYMBOL_SUBSET}
                relSymbolSuperset={REL_SYMBOL_SUPERSET}
                newSenseAssocSourceDisplay={newSenseAssocSourceDisplay}
                newSenseAssocTargetDisplay={newSenseAssocTargetDisplay}
                newSenseAssocSecondTargetDisplay={newSenseAssocSecondTargetDisplay}
                newSenseAssocNodeASenseOptions={newSenseAssocNodeASenseOptions}
                newSenseAssocInsertRelationAvailable={newSenseAssocInsertRelationAvailable}
                newSenseAssocInsertRelationUnavailableReason={newSenseAssocInsertRelationUnavailableReason}
                newSenseAssocNodeBCandidateView={newSenseAssocNodeBCandidateView}
                newSenseAssocPreviewCanvasRef={newSenseAssocPreviewCanvasRef}
                newSenseAssocPreviewInfoText={newSenseAssocPreviewInfoText}
                setNewSenseForm={setNewSenseForm}
                setNewSenseAssocFlow={setNewSenseAssocFlow}
                closeAddSenseModal={closeAddSenseModal}
                removeRelationFromNewSense={removeRelationFromNewSense}
                searchNewSenseAssocNodeA={searchNewSenseAssocNodeA}
                clearNewSenseAssocNodeASearch={clearNewSenseAssocNodeASearch}
                selectNewSenseAssocNodeA={selectNewSenseAssocNodeA}
                handleNewSenseAssocNodeASenseChange={handleNewSenseAssocNodeASenseChange}
                selectNewSenseAssocRelationType={selectNewSenseAssocRelationType}
                submitNewSenseAssocNodeBSearch={submitNewSenseAssocNodeBSearch}
                selectNewSenseAssocNodeB={selectNewSenseAssocNodeB}
                confirmNewSenseAssocRelation={confirmNewSenseAssocRelation}
                goBackNewSenseAssocStep={goBackNewSenseAssocStep}
                cancelNewSenseAssocFlow={cancelNewSenseAssocFlow}
                startNewSenseRelationEditor={startNewSenseRelationEditor}
                saveNewSense={saveNewSense}
                showDeleteSenseModal={showDeleteSenseModal}
                deletingSenseContext={deletingSenseContext}
                deleteSenseWillDeleteNode={deleteSenseWillDeleteNode}
                deleteSenseBeforeRelations={deleteSenseBeforeRelations}
                deleteSenseAfterRelations={deleteSenseAfterRelations}
                deleteSensePreviewLoading={deleteSensePreviewLoading}
                deleteSenseLostBridgePairs={deleteSenseLostBridgePairs}
                deleteSensePendingBridgePairs={deleteSensePendingBridgePairs}
                deleteSenseConfirmedBridgePairs={deleteSenseConfirmedBridgePairs}
                deleteSensePreviewData={deleteSensePreviewData}
                isDeletingSense={isDeletingSense}
                formatRelationArrowText={formatRelationArrowText}
                resolveDeleteBridgePairMode={resolveDeleteBridgePairMode}
                resolveDecisionPairSideDisplay={resolveDecisionPairSideDisplay}
                resolveDecisionCurrentDisplay={resolveDecisionCurrentDisplay}
                openDeleteSenseDecisionModal={openDeleteSenseDecisionModal}
                rollbackDeleteSensePairDecision={rollbackDeleteSensePairDecision}
                closeDeleteSenseModal={closeDeleteSenseModal}
                deleteSense={deleteSense}
                showDeleteSenseDecisionModal={showDeleteSenseDecisionModal}
                deleteSenseDecisionPair={deleteSenseDecisionPair}
                deleteSenseDecisionApplying={deleteSenseDecisionApplying}
                applyDeleteSensePairDecision={applyDeleteSensePairDecision}
                closeDeleteSenseDecisionModal={closeDeleteSenseDecisionModal}
                showDeleteNodeConfirmModal={showDeleteNodeConfirmModal}
                deletingNodeTarget={deletingNodeTarget}
                deletePreviewSummary={deletePreviewSummary}
                deleteBeforeRelations={deleteBeforeRelations}
                deleteAfterRelations={deleteAfterRelations}
                deletingNodePreview={deletingNodePreview}
                deletePreviewLoading={deletePreviewLoading}
                deletePreviewData={deletePreviewData}
                deleteLostBridgePairs={deleteLostBridgePairs}
                deleteBridgeDecisions={deleteBridgeDecisions}
                isDeletingNode={isDeletingNode}
                handleDeleteNodeBridgeDecision={handleDeleteNodeBridgeDecision}
                closeDeleteNodeConfirmModal={closeDeleteNodeConfirmModal}
                deleteNode={deleteNode}
                showChangeMasterModal={showChangeMasterModal}
                changingMasterNode={changingMasterNode}
                masterSearchKeyword={masterSearchKeyword}
                masterSearchResults={masterSearchResults}
                isMasterSearchLoading={isMasterSearchLoading}
                hasMasterSearchTriggered={hasMasterSearchTriggered}
                selectedNewMaster={selectedNewMaster}
                setMasterSearchKeyword={setMasterSearchKeyword}
                setMasterSearchResults={setMasterSearchResults}
                setHasMasterSearchTriggered={setHasMasterSearchTriggered}
                setSelectedNewMaster={setSelectedNewMaster}
                searchUsersForMaster={searchUsersForMaster}
                confirmChangeMaster={confirmChangeMaster}
                setShowChangeMasterModal={setShowChangeMasterModal}
                showEditAssociationModal={showEditAssociationModal}
                editingAssociationNode={editingAssociationNode}
                editingAssociationSenseId={editingAssociationSenseId}
                editAssociations={editAssociations}
                isEditAssociationListExpanded={isEditAssociationListExpanded}
                assocCurrentStep={assocCurrentStep}
                assocSelectedRelationType={assocSelectedRelationType}
                assocSelectedSourceSenseId={assocSelectedSourceSenseId}
                assocSelectedNodeA={assocSelectedNodeA}
                assocSelectedNodeASenseId={assocSelectedNodeASenseId}
                assocSelectedNodeB={assocSelectedNodeB}
                assocSelectedNodeBSenseId={assocSelectedNodeBSenseId}
                assocInsertDirection={assocInsertDirection}
                assocNodeASenseOptions={assocNodeASenseOptions}
                assocInsertRelationAvailable={assocInsertRelationAvailable}
                assocInsertRelationUnavailableReason={assocInsertRelationUnavailableReason}
                assocSearchKeyword={assocSearchKeyword}
                assocSearchAppliedKeyword={assocSearchAppliedKeyword}
                assocSearchLoading={assocSearchLoading}
                assocSearchResults={assocSearchResults}
                assocNodeBView={assocNodeBView}
                assocNodeBSearchAppliedKeyword={assocNodeBSearchAppliedKeyword}
                assocNodeBSearchKeyword={assocNodeBSearchKeyword}
                assocPreviewCanvasRef={assocPreviewCanvasRef}
                assocPreviewInfoText={assocPreviewInfoText}
                assocApplyLoading={assocApplyLoading}
                formatNodeSenseDisplay={formatNodeSenseDisplay}
                resolveAssociationDisplayType={resolveAssociationDisplayType}
                setIsEditAssociationListExpanded={setIsEditAssociationListExpanded}
                setAssocSearchKeyword={setAssocSearchKeyword}
                searchAssociationNodes={searchAssociationNodes}
                clearAssocNodeASearch={clearAssocNodeASearch}
                selectAssocNodeA={selectAssocNodeA}
                handleAssocNodeASenseChange={handleAssocNodeASenseChange}
                selectAssocRelationType={selectAssocRelationType}
                submitAssocNodeBSearch={submitAssocNodeBSearch}
                selectAssocNodeB={selectAssocNodeB}
                confirmEditAssociation={confirmEditAssociation}
                goBackAssocStep={goBackAssocStep}
                resetAssociationEditor={resetAssociationEditor}
                startAddEditAssociation={startAddEditAssociation}
                editExistingAssociation={editExistingAssociation}
                removeEditAssociation={removeEditAssociation}
                saveAssociationEdit={saveAssociationEdit}
                closeEditAssociationModal={closeEditAssociationModal}
                showAssocDeleteDecisionModal={showAssocDeleteDecisionModal}
                assocDeleteDecisionContext={assocDeleteDecisionContext}
                assocDeleteDecisionAction={assocDeleteDecisionAction}
                assocDeleteApplying={assocDeleteApplying}
                assocDeleteSelectedTarget={assocDeleteSelectedTarget}
                assocDeleteReplacementDisplay={assocDeleteReplacementDisplay}
                shouldShowAssocDeleteSearch={shouldShowAssocDeleteSearch}
                assocDeleteSearchKeyword={assocDeleteSearchKeyword}
                assocDeleteSearchAppliedKeyword={assocDeleteSearchAppliedKeyword}
                assocDeleteSearchResults={assocDeleteSearchResults}
                assocDeleteSearchLoading={assocDeleteSearchLoading}
                setAssocDeleteDecisionAction={setAssocDeleteDecisionAction}
                setAssocDeleteSearchKeyword={setAssocDeleteSearchKeyword}
                setAssocDeleteSelectedTarget={setAssocDeleteSelectedTarget}
                searchAssocDeleteTargets={searchAssocDeleteTargets}
                confirmAssocDeleteDecision={confirmAssocDeleteDecision}
                clearAssocDeleteSearch={clearAssocDeleteSearch}
                closeAssocDeleteDecisionModal={closeAssocDeleteDecisionModal}
                adminDomainPagination={adminDomainPagination}
                adminDomainPageSize={adminDomainPageSize}
                pageSizeOptions={ADMIN_DOMAIN_PAGE_SIZE_OPTIONS}
                isAdminDomainLoading={isAdminDomainLoading}
                adminDomainSearchInput={adminDomainSearchInput}
                adminDomainSearchKeyword={adminDomainSearchKeyword}
                hierarchicalNodeList={hierarchicalNodeList}
                editingSenseToken={editingSenseToken}
                editingSenseForm={editingSenseForm}
                editingSenseActionToken={editingSenseActionToken}
                setAdminDomainSearchInput={setAdminDomainSearchInput}
                setEditingSenseForm={setEditingSenseForm}
                getSenseEditToken={getSenseEditToken}
                getEditableSenseAssociationCount={getEditableSenseAssociationCount}
                onCreateNode={onCreateNode}
                handleAdminDomainPageSizeChange={handleAdminDomainPageSizeChange}
                submitAdminDomainSearch={submitAdminDomainSearch}
                clearAdminDomainSearch={clearAdminDomainSearch}
                refreshAdminDomainLatest={refreshAdminDomainLatest}
                openChangeMasterModal={openChangeMasterModal}
                toggleFeaturedNode={toggleFeaturedNode}
                startEditNode={startEditNode}
                openAddSenseModal={openAddSenseModal}
                openDeleteNodeConfirmModal={openDeleteNodeConfirmModal}
                saveSenseTextEdit={saveSenseTextEdit}
                cancelEditSenseText={cancelEditSenseText}
                startEditSenseText={startEditSenseText}
                openEditAssociationModal={openEditAssociationModal}
                openDeleteSenseModal={openDeleteSenseModal}
                fetchAllNodes={fetchAllNodes}
            />

            <AdminAlliancesFeature
                isActive={adminTab === 'alliances'}
                showAllianceMemberModal={showAllianceMemberModal}
                editingAlliance={editingAlliance}
                adminAlliancePagination={adminAlliancePagination}
                isAdminAllianceLoading={isAdminAllianceLoading}
                adminAlliances={adminAlliances}
                editAllianceForm={editAllianceForm}
                editAllianceMembers={editAllianceMembers}
                isAllianceMemberLoading={isAllianceMemberLoading}
                allianceMemberDraft={allianceMemberDraft}
                allianceMemberSearchKeyword={allianceMemberSearchKeyword}
                hasAllianceMemberSearchTriggered={hasAllianceMemberSearchTriggered}
                allianceMemberSearchResults={allianceMemberSearchResults}
                isAllianceMemberSearchLoading={isAllianceMemberSearchLoading}
                onRefreshAdminAlliances={refreshAdminAlliances}
                onAllianceFieldChange={handleAllianceFieldChange}
                onOpenAllianceMemberModal={openAllianceMemberModal}
                onSaveAllianceEdit={saveAllianceEdit}
                onCancelEditAlliance={cancelEditAlliance}
                onStartEditAlliance={startEditAlliance}
                onDeleteAlliance={deleteAlliance}
                onPrevPage={goToPrevAdminAlliancePage}
                onNextPage={goToNextAdminAlliancePage}
                onCloseAllianceMemberModal={closeAllianceMemberModal}
                onAllianceMemberSearchKeywordChange={handleAllianceMemberSearchKeywordChange}
                onSearchAllianceMemberCandidates={searchAllianceMemberCandidates}
                onAddAllianceMemberDraftUser={addAllianceMemberDraftUser}
                onRemoveAllianceMemberDraftUser={removeAllianceMemberDraftUser}
                onConfirmAllianceMemberDraft={confirmAllianceMemberDraft}
            />
        </div>
    );
};

export default AdminPanel;
