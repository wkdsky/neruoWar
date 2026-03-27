import React from 'react';
import AdminAlliancesTab from './components/AdminAlliancesTab';
import AdminAllianceMemberModal from './components/AdminAllianceMemberModal';

const AdminAlliancesFeature = ({
    isActive,
    showAllianceMemberModal,
    editingAlliance,
    adminAlliancePagination,
    isAdminAllianceLoading,
    adminAlliances,
    editAllianceForm,
    editAllianceMembers,
    isAllianceMemberLoading,
    onRefreshAdminAlliances,
    onAllianceFieldChange,
    onOpenAllianceMemberModal,
    onSaveAllianceEdit,
    onCancelEditAlliance,
    onStartEditAlliance,
    onDeleteAlliance,
    onPrevPage,
    onNextPage,
    allianceMemberDraft,
    allianceMemberSearchKeyword,
    hasAllianceMemberSearchTriggered,
    allianceMemberSearchResults,
    isAllianceMemberSearchLoading,
    onCloseAllianceMemberModal,
    onAllianceMemberSearchKeywordChange,
    onSearchAllianceMemberCandidates,
    onAddAllianceMemberDraftUser,
    onRemoveAllianceMemberDraftUser,
    onConfirmAllianceMemberDraft
}) => (
    <>
        {isActive && (
            <AdminAlliancesTab
                adminAlliancePagination={adminAlliancePagination}
                isAdminAllianceLoading={isAdminAllianceLoading}
                adminAlliances={adminAlliances}
                editingAlliance={editingAlliance}
                editAllianceForm={editAllianceForm}
                editAllianceMembers={editAllianceMembers}
                isAllianceMemberLoading={isAllianceMemberLoading}
                onRefreshAdminAlliances={onRefreshAdminAlliances}
                onAllianceFieldChange={onAllianceFieldChange}
                onOpenAllianceMemberModal={onOpenAllianceMemberModal}
                onSaveAllianceEdit={onSaveAllianceEdit}
                onCancelEditAlliance={onCancelEditAlliance}
                onStartEditAlliance={onStartEditAlliance}
                onDeleteAlliance={onDeleteAlliance}
                onPrevPage={onPrevPage}
                onNextPage={onNextPage}
            />
        )}
        {showAllianceMemberModal && editingAlliance && (
            <AdminAllianceMemberModal
                editingAlliance={editingAlliance}
                allianceMemberDraft={allianceMemberDraft}
                isAllianceMemberLoading={isAllianceMemberLoading}
                allianceMemberSearchKeyword={allianceMemberSearchKeyword}
                hasAllianceMemberSearchTriggered={hasAllianceMemberSearchTriggered}
                allianceMemberSearchResults={allianceMemberSearchResults}
                isAllianceMemberSearchLoading={isAllianceMemberSearchLoading}
                onClose={onCloseAllianceMemberModal}
                onSearchKeywordChange={onAllianceMemberSearchKeywordChange}
                onSearchSubmit={onSearchAllianceMemberCandidates}
                onAddAllianceMemberDraftUser={onAddAllianceMemberDraftUser}
                onRemoveAllianceMemberDraftUser={onRemoveAllianceMemberDraftUser}
                onConfirmAllianceMemberDraft={onConfirmAllianceMemberDraft}
            />
        )}
    </>
);

export default AdminAlliancesFeature;
