import React from 'react';
import { X } from 'lucide-react';
import { ASSOC_RELATION_TYPES } from '../../../../shared/associationFlowShared';

const AdminDeleteSenseDecisionModal = ({
    deletingSenseContext,
    deleteSenseDecisionPair,
    deleteSenseBeforeRelations,
    deleteSenseDecisionApplying,
    deleteSensePreviewLoading,
    isDeletingSense,
    resolveDeleteBridgePairMode,
    resolveDecisionPairSideDisplay,
    resolveDecisionCurrentDisplay,
    applyDeleteSensePairDecision,
    onClose
}) => {
    const node = deletingSenseContext?.node || null;

    if (!node || !deleteSenseDecisionPair) return null;

    const mode = resolveDeleteBridgePairMode(deleteSenseDecisionPair, deleteSenseBeforeRelations);
    const upperDisplay = resolveDecisionPairSideDisplay(deleteSenseDecisionPair, 'upper');
    const sourceDisplay = resolveDecisionCurrentDisplay(
        node,
        deleteSenseDecisionPair?.sourceSenseId || '',
        node?.name || '当前标题'
    );
    const lowerDisplay = resolveDecisionPairSideDisplay(deleteSenseDecisionPair, 'lower');
    const reconnectTitle = mode === ASSOC_RELATION_TYPES.INSERT ? '两端直连' : '保留承接';
    const reconnectHint = mode === ASSOC_RELATION_TYPES.INSERT
        ? '删除后，原上下级释义恢复直接关联'
        : '删除后，保持上下级之间承接';
    const disconnectTitle = mode === ASSOC_RELATION_TYPES.INSERT ? '两端不连' : '断开独立';
    const disconnectHint = mode === ASSOC_RELATION_TYPES.INSERT
        ? '删除后，原上下级释义不再直连'
        : '删除后，不保留上下级承接';

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content admin-assoc-delete-decision-modal admin-delete-sense-decision-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>处理关联关系</h3>
                    <button
                        className="btn-close"
                        onClick={onClose}
                        disabled={deleteSenseDecisionApplying}
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <p className="admin-assoc-step-description">
                        当前关系：<strong>{`${upperDisplay} ⇢ ${sourceDisplay} ⇢ ${lowerDisplay}`}</strong>
                    </p>
                    <div className="admin-assoc-delete-impact-item admin-delete-bridge-impact-item">
                        <div className="admin-assoc-delete-impact-line before">
                            <span className="label">删除前</span>
                            <span className="diagram">{`${upperDisplay} ⇢ ${sourceDisplay} ⇢ ${lowerDisplay}`}</span>
                        </div>
                        <div className="admin-assoc-delete-impact-line after pending">
                            <span className="label">删除后</span>
                            <span className="diagram">待选择：点下方任一选项后立即生效</span>
                        </div>
                    </div>
                    <div className="admin-assoc-delete-option-grid admin-delete-bridge-option-grid">
                        <button
                            type="button"
                            className="admin-assoc-delete-option"
                            onClick={() => applyDeleteSensePairDecision('reconnect')}
                            disabled={deleteSenseDecisionApplying || deleteSensePreviewLoading || isDeletingSense}
                        >
                            <strong>{reconnectTitle}</strong>
                            <small>{reconnectHint}</small>
                        </button>
                        <button
                            type="button"
                            className="admin-assoc-delete-option"
                            onClick={() => applyDeleteSensePairDecision('disconnect')}
                            disabled={deleteSenseDecisionApplying || deleteSensePreviewLoading || isDeletingSense}
                        >
                            <strong>{disconnectTitle}</strong>
                            <small>{disconnectHint}</small>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDeleteSenseDecisionModal;
