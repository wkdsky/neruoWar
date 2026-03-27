import React from 'react';
import { Search, X } from 'lucide-react';

const AdminAssocDeleteDecisionModal = ({
    assocDeleteDecisionContext,
    assocDeleteDecisionAction,
    assocDeleteApplying,
    editingAssociationNode,
    assocDeleteSelectedTarget,
    assocDeleteReplacementDisplay,
    shouldShowAssocDeleteSearch,
    assocDeleteSearchKeyword,
    assocDeleteSearchAppliedKeyword,
    assocDeleteSearchResults,
    assocDeleteSearchLoading,
    formatNodeSenseDisplay,
    resolveDecisionPairSideDisplay,
    resolveDecisionCurrentDisplay,
    setAssocDeleteDecisionAction,
    setAssocDeleteSearchKeyword,
    setAssocDeleteSelectedTarget,
    searchAssocDeleteTargets,
    confirmAssocDeleteDecision,
    onClearSearch,
    onClose
}) => {
    if (!assocDeleteDecisionContext) return null;

    return (
        <div className="modal-backdrop">
            <div className="modal-content admin-assoc-delete-decision-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>删除关联决策</h3>
                    <button
                        className="btn-close"
                        onClick={onClose}
                        disabled={assocDeleteApplying}
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <p className="admin-assoc-step-description">
                        即将删除：<strong>{assocDeleteDecisionContext?.association?.displayText || ''}</strong>
                    </p>
                    <div className="admin-assoc-delete-option-grid">
                        <>
                            <button
                                type="button"
                                className={`admin-assoc-delete-option ${assocDeleteDecisionAction === 'disconnect' ? 'active disconnect' : ''}`}
                                onClick={() => setAssocDeleteDecisionAction('disconnect')}
                                disabled={assocDeleteApplying}
                            >
                                <strong>直接删除</strong>
                                <small>删除后，下级释义不改接新上级</small>
                            </button>
                            <button
                                type="button"
                                className={`admin-assoc-delete-option ${assocDeleteDecisionAction === 'reassign_upper' ? 'active reconnect' : ''}`}
                                onClick={() => setAssocDeleteDecisionAction('reassign_upper')}
                                disabled={assocDeleteApplying}
                            >
                                <strong>改接新上级</strong>
                                <small>删除后，为该下级释义指定新的上级</small>
                            </button>
                        </>
                    </div>

                    {Array.isArray(assocDeleteDecisionContext?.bridgeItems) && assocDeleteDecisionContext.bridgeItems.length > 0 ? (
                        <div className="admin-assoc-delete-impact-list">
                            {assocDeleteDecisionContext.bridgeItems.map((item, index) => {
                                const upperDisplay = resolveDecisionPairSideDisplay(item, 'upper');
                                const sourceDisplay = resolveDecisionCurrentDisplay(
                                    editingAssociationNode,
                                    item?.sourceSenseId || '',
                                    editingAssociationNode?.name || '当前标题'
                                );
                                const lowerDisplay = resolveDecisionPairSideDisplay(item, 'lower');
                                const isReassignUpper = assocDeleteDecisionAction === 'reassign_upper';
                                const afterClassName = isReassignUpper
                                    ? (assocDeleteSelectedTarget ? 'reconnect' : 'pending')
                                    : 'disconnect';
                                const afterText = isReassignUpper
                                    ? (
                                        assocDeleteSelectedTarget
                                            ? `${assocDeleteReplacementDisplay} ⇢ ${lowerDisplay}`
                                            : `待改接：${lowerDisplay}`
                                    )
                                    : `${upperDisplay} ✕ ${lowerDisplay}`;
                                const afterHint = isReassignUpper
                                    ? (assocDeleteSelectedTarget ? '删除后改接新上级' : '请先选择新的上级释义')
                                    : '删除后不改接，保持断开';

                                return (
                                    <div key={item?.pairKey || `assoc_delete_bridge_${index}`} className="admin-assoc-delete-impact-item">
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
                                );
                            })}
                        </div>
                    ) : (
                        <p className="admin-assoc-step-description">该删除不会产生额外的链路承接冲突。</p>
                    )}

                    {shouldShowAssocDeleteSearch && (
                        <div className="admin-assoc-delete-search-panel">
                            <h4>选择新的上级释义</h4>
                            <p className="admin-assoc-step-description">仅在“改接新上级”模式下生效；不会显示当前释义和当前下级释义。</p>
                            <div className="search-input-group">
                                <div className="admin-assoc-search-input-wrap">
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="搜索标题或释义题目（回车/搜索）"
                                        value={assocDeleteSearchKeyword}
                                        onChange={(e) => setAssocDeleteSearchKeyword(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                searchAssocDeleteTargets(assocDeleteSearchKeyword);
                                            }
                                        }}
                                    />
                                    {!!assocDeleteSearchKeyword && (
                                        <button
                                            type="button"
                                            className="admin-assoc-search-clear"
                                            onClick={onClearSearch}
                                            aria-label="清空搜索"
                                            disabled={assocDeleteApplying}
                                        >
                                            X
                                        </button>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => searchAssocDeleteTargets(assocDeleteSearchKeyword)}
                                    disabled={assocDeleteSearchLoading || assocDeleteApplying}
                                >
                                    <Search className="icon-small" />
                                    {assocDeleteSearchLoading ? '...' : '搜索'}
                                </button>
                            </div>
                            {assocDeleteSearchAppliedKeyword && assocDeleteSearchResults.length === 0 && !assocDeleteSearchLoading && (
                                <p className="admin-assoc-step-description">未找到可用上级释义。</p>
                            )}
                            {assocDeleteSearchResults.length > 0 && (
                                <div className="admin-assoc-delete-search-results">
                                    {assocDeleteSearchResults.map((item) => (
                                        <div
                                            key={item?.searchKey || `${item?.nodeId}:${item?.senseId}`}
                                            className={`admin-assoc-delete-search-item ${assocDeleteSelectedTarget?.searchKey === item?.searchKey ? 'selected' : ''}`}
                                            onClick={() => setAssocDeleteSelectedTarget(item)}
                                        >
                                            <span>{item?.displayName || formatNodeSenseDisplay(item, item?.senseId || '')}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {assocDeleteSelectedTarget && (
                                <p className="admin-assoc-step-description">
                                    已选择新上级：<strong>{formatNodeSenseDisplay(assocDeleteSelectedTarget, assocDeleteSelectedTarget?.senseId || '')}</strong>
                                </p>
                            )}
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button
                        className="btn btn-secondary"
                        onClick={onClose}
                        disabled={assocDeleteApplying}
                    >
                        取消
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={confirmAssocDeleteDecision}
                        disabled={assocDeleteApplying}
                    >
                        {assocDeleteApplying ? '处理中...' : '确认暂存删除'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdminAssocDeleteDecisionModal;
