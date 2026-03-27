import React from 'react';
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import AssociationAddFlowEditor from '../../../../shared/AssociationAddFlowEditor';
import { ASSOC_RELATION_TYPES, ASSOC_STEPS } from '../../../../shared/associationFlowShared';

const AdminEditAssociationModal = ({
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
    assocNodeBSearchKeyword,
    assocPreviewCanvasRef,
    assocPreviewInfoText,
    assocApplyLoading,
    relSymbolSubset,
    relSymbolSuperset,
    formatNodeSenseDisplay,
    resolveAssociationDisplayType,
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
    onClose
}) => {
    if (!editingAssociationNode) return null;

    return (
        <div className="modal-backdrop">
            <div className="modal-content admin-edit-association-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>编辑释义关联: {formatNodeSenseDisplay(editingAssociationNode, editingAssociationSenseId)}</h3>
                    <button className="btn-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <div className="admin-edit-associations-section">
                        <div
                            className="admin-edit-associations-header"
                            onClick={() => setIsEditAssociationListExpanded(!isEditAssociationListExpanded)}
                        >
                            <h4>
                                释义关联关系
                                <span className="association-count">
                                    ({editAssociations.filter((item) => !item?.pendingRemoval).length}/{editAssociations.length})
                                </span>
                            </h4>
                            {isEditAssociationListExpanded ? <ChevronUp className="icon-small" /> : <ChevronDown className="icon-small" />}
                        </div>

                        {isEditAssociationListExpanded && editAssociations.length > 0 && (
                            <div className="admin-edit-associations-list">
                                {editAssociations.map((association, index) => {
                                    const isPendingRemoval = !!association?.pendingRemoval;
                                    const isUnsavedNew = !!association?.isNewDraft && !isPendingRemoval;
                                    const pendingDecisionLines = Array.isArray(association?.pendingDecisionLines)
                                        ? association.pendingDecisionLines
                                        : [];
                                    const displayAssociationType = resolveAssociationDisplayType(association);

                                    return (
                                        <div
                                            key={index}
                                            className={`admin-edit-association-item ${isPendingRemoval ? 'pending-removal' : 'clickable'}`}
                                            onClick={() => {
                                                if (isPendingRemoval) return;
                                                editExistingAssociation(index);
                                            }}
                                        >
                                            <div className="admin-edit-association-info">
                                                <span className={`admin-edit-association-display ${isPendingRemoval ? 'pending-removal' : ''}`}>
                                                    {association.displayText}
                                                </span>
                                                <span className={`admin-edit-relation-badge ${displayAssociationType} ${isPendingRemoval ? 'pending-removal' : ''}`}>
                                                    {isPendingRemoval
                                                        ? '待删除'
                                                        : (
                                                            displayAssociationType === ASSOC_RELATION_TYPES.EXTENDS
                                                                ? relSymbolSuperset
                                                                : (displayAssociationType === ASSOC_RELATION_TYPES.CONTAINS ? relSymbolSubset : '插入')
                                                        )}
                                                </span>
                                                {isUnsavedNew && (
                                                    <span className="admin-edit-relation-badge new">
                                                        新增
                                                    </span>
                                                )}
                                                {isPendingRemoval && pendingDecisionLines.length > 0 && (
                                                    <div className="admin-edit-association-pending-result">
                                                        {pendingDecisionLines.map((line, lineIndex) => (
                                                            <div
                                                                key={`assoc_pending_${index}_${lineIndex}`}
                                                                className="admin-edit-association-pending-line"
                                                            >
                                                                {line}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="admin-edit-association-actions">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        removeEditAssociation(index);
                                                    }}
                                                    className={`btn btn-small ${isPendingRemoval || isUnsavedNew ? 'btn-secondary' : 'btn-danger'}`}
                                                    disabled={assocCurrentStep !== null}
                                                >
                                                    {isPendingRemoval || isUnsavedNew ? '撤回' : <X className="icon-small" />}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {assocCurrentStep ? (
                            <AssociationAddFlowEditor
                                steps={ASSOC_STEPS}
                                relationTypes={ASSOC_RELATION_TYPES}
                                relSymbolSubset={relSymbolSubset}
                                relSymbolSuperset={relSymbolSuperset}
                                currentStep={assocCurrentStep}
                                selectedRelationType={assocSelectedRelationType}
                                sourceDisplay={formatNodeSenseDisplay(editingAssociationNode, assocSelectedSourceSenseId || editingAssociationSenseId)}
                                targetDisplay={formatNodeSenseDisplay(assocSelectedNodeA, assocSelectedNodeASenseId)}
                                secondTargetDisplay={formatNodeSenseDisplay(assocSelectedNodeB, assocSelectedNodeBSenseId)}
                                nodeASenseOptions={assocNodeASenseOptions}
                                selectedNodeASenseId={assocSelectedNodeASenseId}
                                insertDirection={assocInsertDirection}
                                insertRelationAvailable={assocInsertRelationAvailable}
                                insertRelationUnavailableReason={assocInsertRelationUnavailableReason}
                                nodeASearchKeyword={assocSearchKeyword}
                                nodeASearchAppliedKeyword={assocSearchAppliedKeyword}
                                nodeASearchLoading={assocSearchLoading}
                                nodeASearchResults={assocSearchResults}
                                nodeBSearchAppliedKeyword={assocNodeBView.appliedKeyword}
                                nodeBSearchLoading={false}
                                nodeBCandidatesParents={assocNodeBView.parents}
                                nodeBCandidatesChildren={assocNodeBView.children}
                                previewCanvasRef={assocPreviewCanvasRef}
                                previewInfoText={assocPreviewInfoText}
                                onNodeASearchKeywordChange={setAssocSearchKeyword}
                                onSubmitNodeASearch={() => searchAssociationNodes(assocSearchKeyword)}
                                onClearNodeASearch={clearAssocNodeASearch}
                                onSelectNodeA={selectAssocNodeA}
                                onChangeNodeASenseId={handleAssocNodeASenseChange}
                                onSelectRelationType={selectAssocRelationType}
                                onSubmitNodeBSearch={(keyword) => submitAssocNodeBSearch(keyword ?? assocNodeBSearchKeyword)}
                                onSelectNodeBParent={(node) => selectAssocNodeB(node, true)}
                                onSelectNodeBChild={(node) => selectAssocNodeB(node, false)}
                                onConfirm={confirmEditAssociation}
                                onBack={goBackAssocStep}
                                onCancel={resetAssociationEditor}
                            />
                        ) : (
                            <button onClick={startAddEditAssociation} className="btn btn-primary admin-add-association-btn">
                                <Plus className="icon-small" /> 添加关联
                            </button>
                        )}
                    </div>

                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>取消</button>
                    <button
                        className="btn btn-primary"
                        onClick={saveAssociationEdit}
                        disabled={assocCurrentStep !== null || assocApplyLoading}
                    >
                        {assocApplyLoading ? '保存中...' : '应用更改'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdminEditAssociationModal;
