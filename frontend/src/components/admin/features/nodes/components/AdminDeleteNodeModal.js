import React from 'react';
import { X } from 'lucide-react';
import AdminDeleteBridgeDecisionSection from './AdminDeleteBridgeDecisionSection';

const AdminDeleteNodeModal = ({
    deletingNodeTarget,
    deletePreviewSummary,
    deleteBeforeRelations,
    deleteAfterRelations,
    deletingNodePreview,
    deletePreviewLoading,
    deletePreviewData,
    deleteLostBridgePairs,
    deleteBridgeDecisions,
    isDeletingNode,
    formatRelationArrowText,
    handleDeleteNodeBridgeDecision,
    resolveDecisionCurrentDisplay,
    resolveDecisionPairSideDisplay,
    onClose,
    onDelete
}) => {
    if (!deletingNodeTarget) return null;

    const beforeRelations = deletePreviewSummary ? deleteBeforeRelations : [];
    const afterRelations = deletePreviewSummary ? deleteAfterRelations : [];

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content admin-delete-domain-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>删除标题确认：{deletingNodeTarget.name}</h3>
                    <button className="btn-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <p className="admin-delete-domain-hint">
                        删除标题会同时删除该标题下全部释义，并清理它们的关联关系。下面是删除前/删除后关联预览。
                    </p>

                    <div className="admin-delete-domain-total-preview">
                        <span>删除前关联总数：{deletePreviewSummary ? deleteBeforeRelations.length : deletingNodePreview.totalBeforeCount}</span>
                        <span>删除后关联总数：{deletePreviewSummary ? deleteAfterRelations.length : deletingNodePreview.totalAfterCount}</span>
                    </div>

                    {deletePreviewLoading && (
                        <div className="admin-delete-domain-loading">正在计算删除前后关联预览...</div>
                    )}

                    <div className="admin-delete-domain-before-after-grid global">
                        <div className="admin-delete-domain-before-after-block before">
                            <h6>删除前</h6>
                            <div className="admin-delete-domain-assoc-list">
                                {beforeRelations.length > 0 ? (
                                    beforeRelations.map((line, index) => (
                                        <span key={`del_before_${index}`} className="admin-delete-domain-assoc-chip outgoing">
                                            {`${line.source?.displayName || '未知释义'} ${formatRelationArrowText(line.relationType)} ${line.target?.displayName || '未知释义'}`}
                                        </span>
                                    ))
                                ) : (
                                    <span className="admin-delete-domain-assoc-empty">删除前无关联</span>
                                )}
                            </div>
                        </div>
                        <div className="admin-delete-domain-before-after-block after">
                            <h6>删除后</h6>
                            <div className="admin-delete-domain-assoc-list">
                                {afterRelations.length > 0 ? (
                                    afterRelations.map((line, index) => (
                                        <span key={`del_after_${index}`} className="admin-delete-domain-assoc-chip incoming">
                                            {`${line.source?.displayName || '未知释义'} ${formatRelationArrowText(line.relationType)} ${line.target?.displayName || '未知释义'}`}
                                        </span>
                                    ))
                                ) : (
                                    <span className="admin-delete-domain-assoc-empty">删除后该标题释义已移除，未保留关联</span>
                                )}
                            </div>
                        </div>
                    </div>

                    <AdminDeleteBridgeDecisionSection
                        pairs={deleteLostBridgePairs}
                        beforeRelations={deleteBeforeRelations}
                        decisionMap={deleteBridgeDecisions}
                        unresolvedCount={deletePreviewData?.unresolvedBridgeDecisionCount || 0}
                        sourceNode={deletingNodeTarget}
                        loading={deletePreviewLoading}
                        deleting={isDeletingNode}
                        onDecision={handleDeleteNodeBridgeDecision}
                        resolveDecisionCurrentDisplay={resolveDecisionCurrentDisplay}
                        resolveDecisionPairSideDisplay={resolveDecisionPairSideDisplay}
                    />
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={isDeletingNode}>
                        取消
                    </button>
                    <button
                        className="btn btn-danger"
                        onClick={onDelete}
                        disabled={isDeletingNode || deletePreviewLoading || (deletePreviewData?.unresolvedBridgeDecisionCount || 0) > 0}
                    >
                        {isDeletingNode ? '删除中...' : '确认删除标题'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdminDeleteNodeModal;
