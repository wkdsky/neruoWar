import React from 'react';
import AdminPendingTab from './components/AdminPendingTab';

const AdminPendingFeature = ({
    isActive,
    pendingApprovalCount,
    pendingNodes,
    pendingMasterApplications,
    groupedPendingNodes,
    groupedPendingMasterApplications,
    pendingNodeActionId,
    pendingNodeActionGroupName,
    pendingNodeSelectedSenseByNodeId,
    masterApplyActionId,
    normalizeNodeSenses,
    getPendingSenseAssociations,
    selectPendingNodeSense,
    approveNode,
    rejectNode,
    reviewMasterApplication,
    refreshPendingApprovals
}) => {
    if (!isActive) return null;
    return (
        <AdminPendingTab
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
    );
};

export default AdminPendingFeature;
