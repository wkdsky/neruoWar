import React from 'react';
import { ASSOC_RELATION_TYPES } from '../../../../shared/associationFlowShared';
import { resolveDeleteBridgePairMode } from '../../../adminAssociationHelpers';

const AdminDeleteBridgeDecisionSection = ({
    pairs = [],
    beforeRelations = [],
    decisionMap = {},
    unresolvedCount = 0,
    sourceNode = null,
    loading = false,
    deleting = false,
    onDecision = null,
    resolveDecisionCurrentDisplay,
    resolveDecisionPairSideDisplay
}) => {
    const pairList = Array.isArray(pairs) ? pairs : [];

    if (pairList.length < 1) return null;

    return (
        <div className="admin-delete-bridge-decision-section">
            <h6>承接关系逐条确认</h6>
            <p className="admin-assoc-step-description" style={{ marginBottom: '0.45rem' }}>
                每条关系都需单独决策，并实时反映到下方删除后预览。
            </p>
            {unresolvedCount > 0 && (
                <p className="admin-assoc-step-description" style={{ marginBottom: '0.45rem', color: '#fca5a5' }}>
                    尚有 {unresolvedCount} 组未确认，不能删除。
                </p>
            )}
            <div className="admin-bridge-decision-list">
                {pairList.map((pair, index) => {
                    const pairKey = String(pair?.pairKey || '').trim();
                    const mode = resolveDeleteBridgePairMode(pair, beforeRelations);
                    const selectedAction = pairKey ? (decisionMap?.[pairKey] || '') : '';
                    const upperDisplay = resolveDecisionPairSideDisplay(pair, 'upper');
                    const sourceDisplay = resolveDecisionCurrentDisplay(sourceNode, pair?.sourceSenseId || '', sourceNode?.name || '当前标题');
                    const lowerDisplay = resolveDecisionPairSideDisplay(pair, 'lower');
                    const afterClassName = selectedAction === 'reconnect'
                        ? 'reconnect'
                        : (selectedAction === 'disconnect' ? 'disconnect' : 'pending');
                    const afterText = selectedAction === 'reconnect'
                        ? `${upperDisplay} ⇢ ${lowerDisplay}`
                        : (
                            selectedAction === 'disconnect'
                                ? `${upperDisplay} ✕ ${lowerDisplay}`
                                : '待决策：请选择两端是否承接'
                        );
                    const afterHint = selectedAction === 'reconnect'
                        ? '删除后保留承接链路'
                        : (
                            selectedAction === 'disconnect'
                                ? '删除后两端保持断开'
                                : '未决策前不可执行删除'
                        );
                    const reconnectTitle = mode === ASSOC_RELATION_TYPES.INSERT ? '两端直连' : '保留承接';
                    const reconnectHint = mode === ASSOC_RELATION_TYPES.INSERT
                        ? '删除后，原上下级释义恢复直接关联'
                        : '删除后，保持上下级之间承接';
                    const disconnectTitle = mode === ASSOC_RELATION_TYPES.INSERT ? '两端不连' : '断开独立';
                    const disconnectHint = mode === ASSOC_RELATION_TYPES.INSERT
                        ? '删除后，原上下级释义不再直连'
                        : '删除后，不保留上下级承接';
                    const modeText = mode === ASSOC_RELATION_TYPES.EXTENDS
                        ? '上级关系'
                        : (mode === ASSOC_RELATION_TYPES.CONTAINS ? '下级关系' : '插入关系');

                    return (
                        <div key={pairKey || `del_bridge_pair_${index}`} className="admin-bridge-decision-item">
                            <div className="admin-bridge-decision-line">
                                <span className={`admin-edit-relation-badge ${mode}`}>
                                    {modeText}
                                </span>
                                <span>{upperDisplay}</span>
                                <span className="arrow">⇢ {sourceDisplay} ⇢</span>
                                <span>{lowerDisplay}</span>
                            </div>
                            <div className="admin-assoc-delete-impact-item admin-delete-bridge-impact-item">
                                <div className="admin-assoc-delete-impact-line before">
                                    <span className="label">删除前</span>
                                    <span className="diagram">{`${upperDisplay} ⇢ ${sourceDisplay} ⇢ ${lowerDisplay}`}</span>
                                </div>
                                <div className={`admin-assoc-delete-impact-line after ${afterClassName}`}>
                                    <span className="label">删除后</span>
                                    <span className="diagram">{afterText}</span>
                                    <span className="hint">{afterHint}</span>
                                </div>
                            </div>
                            <div className="admin-assoc-delete-option-grid admin-delete-bridge-option-grid">
                                <button
                                    type="button"
                                    className={`admin-assoc-delete-option ${selectedAction === 'reconnect' ? 'active reconnect' : ''}`}
                                    onClick={() => {
                                        if (onDecision) {
                                            onDecision(pairKey, 'reconnect');
                                        }
                                    }}
                                    disabled={!pairKey || loading || deleting}
                                >
                                    <strong>{reconnectTitle}</strong>
                                    <small>{reconnectHint}</small>
                                </button>
                                <button
                                    type="button"
                                    className={`admin-assoc-delete-option ${selectedAction === 'disconnect' ? 'active disconnect' : ''}`}
                                    onClick={() => {
                                        if (onDecision) {
                                            onDecision(pairKey, 'disconnect');
                                        }
                                    }}
                                    disabled={!pairKey || loading || deleting}
                                >
                                    <strong>{disconnectTitle}</strong>
                                    <small>{disconnectHint}</small>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default AdminDeleteBridgeDecisionSection;
