import React from 'react';
import { X } from 'lucide-react';
import { ASSOC_RELATION_TYPES } from '../../../../shared/associationFlowShared';

const AdminDeleteSenseModal = ({
    deletingSenseContext,
    deleteSenseWillDeleteNode,
    deleteSenseBeforeRelations,
    deleteSenseAfterRelations,
    deleteSensePreviewLoading,
    deleteSenseLostBridgePairs,
    deleteSensePendingBridgePairs,
    deleteSenseConfirmedBridgePairs,
    deleteSensePreviewData,
    isDeletingSense,
    formatRelationArrowText,
    resolveDeleteBridgePairMode,
    resolveDecisionPairSideDisplay,
    resolveDecisionCurrentDisplay,
    openDeleteSenseDecisionModal,
    rollbackDeleteSensePairDecision,
    onClose,
    onDelete
}) => {
    const node = deletingSenseContext?.node || null;
    const sense = deletingSenseContext?.sense || null;

    if (!node || !sense) return null;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content admin-delete-domain-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>删除释义确认：{sense.title}</h3>
                    <button className="btn-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <p className="admin-delete-domain-hint">
                        {deleteSenseWillDeleteNode
                            ? `该释义是标题「${node.name}」的最后一个释义。确认后会同时删除整个知识域，并清理相关关联。请先查看删除前/删除后关联变化并确认承接策略。`
                            : '删除后将清理该释义全部关联。请先查看删除前/删除后关联变化并确认承接策略。'}
                    </p>

                    <div className="admin-delete-domain-total-preview">
                        <span>删除前关联总数：{deleteSenseBeforeRelations.length}</span>
                        <span>删除后关联总数：{deleteSenseAfterRelations.length}</span>
                    </div>

                    {deleteSensePreviewLoading && (
                        <div className="admin-delete-domain-loading">正在计算删除前后关联预览...</div>
                    )}

                    <div className="admin-delete-domain-before-after-grid global">
                        <div className="admin-delete-domain-before-after-block before">
                            <h6>删除前</h6>
                            <div className="admin-delete-domain-assoc-list">
                                {deleteSenseBeforeRelations.length > 0 ? (
                                    deleteSenseBeforeRelations.map((line, index) => (
                                        <span key={`del_sense_before_${index}`} className="admin-delete-domain-assoc-chip outgoing">
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
                                {deleteSenseAfterRelations.length > 0 ? (
                                    deleteSenseAfterRelations.map((line, index) => (
                                        <span key={`del_sense_after_${index}`} className="admin-delete-domain-assoc-chip incoming">
                                            {`${line.source?.displayName || '未知释义'} ${formatRelationArrowText(line.relationType)} ${line.target?.displayName || '未知释义'}`}
                                        </span>
                                    ))
                                ) : (
                                    <span className="admin-delete-domain-assoc-empty">
                                        {deleteSenseWillDeleteNode ? '删除后该知识域将被整体移除，不再保留关联' : '删除后未保留该释义关联'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {deleteSenseLostBridgePairs.length > 0 && (
                        <div className="admin-delete-bridge-decision-section">
                            <h6>关联关系逐条处理</h6>
                            <p className="admin-assoc-step-description" style={{ marginBottom: '0.45rem' }}>
                                左侧是待处理关系，右侧是已确认的新关系。点击左侧任一关系进入二级弹窗并完成处理。
                            </p>
                            <div className="admin-delete-sense-decision-workspace">
                                <div className="admin-delete-sense-decision-column">
                                    <div className="admin-delete-sense-decision-column-header">
                                        待处理关系（{deleteSensePendingBridgePairs.length}）
                                    </div>
                                    <div className="admin-delete-sense-decision-list">
                                        {deleteSensePendingBridgePairs.length > 0 ? (
                                            deleteSensePendingBridgePairs.map((pair, index) => {
                                                const pairKey = String(pair?.pairKey || '').trim();
                                                const mode = resolveDeleteBridgePairMode(pair, deleteSenseBeforeRelations);
                                                const modeText = mode === ASSOC_RELATION_TYPES.EXTENDS
                                                    ? '上级关系'
                                                    : (mode === ASSOC_RELATION_TYPES.CONTAINS ? '下级关系' : '插入关系');
                                                const upperDisplay = resolveDecisionPairSideDisplay(pair, 'upper');
                                                const sourceDisplay = resolveDecisionCurrentDisplay(
                                                    node,
                                                    pair?.sourceSenseId || '',
                                                    node?.name || '当前标题'
                                                );
                                                const lowerDisplay = resolveDecisionPairSideDisplay(pair, 'lower');

                                                return (
                                                    <button
                                                        key={pairKey || `del_sense_pending_${index}`}
                                                        type="button"
                                                        className="admin-delete-sense-decision-item pending"
                                                        onClick={() => openDeleteSenseDecisionModal(pair)}
                                                        disabled={!pairKey || deleteSensePreviewLoading || isDeletingSense}
                                                    >
                                                        <span className={`admin-edit-relation-badge ${mode}`}>{modeText}</span>
                                                        <span className="line">{`${upperDisplay} ⇢ ${sourceDisplay} ⇢ ${lowerDisplay}`}</span>
                                                    </button>
                                                );
                                            })
                                        ) : (
                                            <div className="admin-delete-sense-decision-empty">待处理关系已全部确认</div>
                                        )}
                                    </div>
                                </div>

                                <div className="admin-delete-sense-decision-column confirmed">
                                    <div className="admin-delete-sense-decision-column-header">
                                        已确认新关系（{deleteSenseConfirmedBridgePairs.length}）
                                    </div>
                                    <div className="admin-delete-sense-decision-list">
                                        {deleteSenseConfirmedBridgePairs.length > 0 ? (
                                            deleteSenseConfirmedBridgePairs.map((pair, index) => {
                                                const pairKey = String(pair?.pairKey || '').trim();
                                                const mode = resolveDeleteBridgePairMode(pair, deleteSenseBeforeRelations);
                                                const modeText = mode === ASSOC_RELATION_TYPES.EXTENDS
                                                    ? '上级关系'
                                                    : (mode === ASSOC_RELATION_TYPES.CONTAINS ? '下级关系' : '插入关系');
                                                const upperDisplay = resolveDecisionPairSideDisplay(pair, 'upper');
                                                const sourceDisplay = resolveDecisionCurrentDisplay(
                                                    node,
                                                    pair?.sourceSenseId || '',
                                                    node?.name || '当前标题'
                                                );
                                                const lowerDisplay = resolveDecisionPairSideDisplay(pair, 'lower');
                                                const afterText = pair.action === 'reconnect'
                                                    ? `${upperDisplay} ⇢ ${lowerDisplay}`
                                                    : `${upperDisplay} ✕ ${lowerDisplay}`;
                                                const afterClassName = pair.action === 'reconnect' ? 'reconnect' : 'disconnect';

                                                return (
                                                    <div key={pairKey || `del_sense_confirmed_${index}`} className="admin-delete-sense-decision-item confirmed">
                                                        <div className="admin-delete-sense-decision-line">
                                                            <span className={`admin-edit-relation-badge ${mode}`}>{modeText}</span>
                                                            <span className="line">{`${upperDisplay} ⇢ ${sourceDisplay} ⇢ ${lowerDisplay}`}</span>
                                                        </div>
                                                        <div className={`admin-delete-sense-decision-result ${afterClassName}`}>
                                                            {`删除后：${afterText}`}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="btn btn-small btn-secondary"
                                                            onClick={() => rollbackDeleteSensePairDecision(pairKey)}
                                                            disabled={deleteSensePreviewLoading || isDeletingSense}
                                                        >
                                                            撤回到待处理
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="admin-delete-sense-decision-empty">尚未确认任何关系</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {(deleteSensePreviewData?.unresolvedBridgeDecisionCount || 0) > 0 && (
                                <p className="admin-assoc-step-description" style={{ marginTop: '0.55rem', color: '#fca5a5' }}>
                                    尚有 {deleteSensePreviewData.unresolvedBridgeDecisionCount} 组未完成处理，确认删除按钮不会点亮。
                                </p>
                            )}
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={isDeletingSense}>取消</button>
                    <button
                        className="btn btn-danger"
                        onClick={onDelete}
                        disabled={
                            isDeletingSense
                            || deleteSensePreviewLoading
                            || deleteSensePendingBridgePairs.length > 0
                            || (deleteSensePreviewData?.unresolvedBridgeDecisionCount || 0) > 0
                        }
                    >
                        {isDeletingSense ? '删除中...' : (deleteSenseWillDeleteNode ? '确认删除释义并删除标题' : '确认删除释义')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdminDeleteSenseModal;
