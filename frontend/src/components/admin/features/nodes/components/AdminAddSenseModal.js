import React from 'react';
import { Plus, X } from 'lucide-react';
import AssociationAddFlowEditor from '../../../../shared/AssociationAddFlowEditor';

const AdminAddSenseModal = ({
    addingSenseNode,
    isSavingNewSense,
    newSenseForm,
    newSenseAssocFlow,
    assocSteps,
    assocRelationTypes,
    relSymbolSubset,
    relSymbolSuperset,
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
    onClose,
    onRemoveRelationFromNewSense,
    onSearchNewSenseAssocNodeA,
    onClearNewSenseAssocNodeASearch,
    onSelectNewSenseAssocNodeA,
    onHandleNewSenseAssocNodeASenseChange,
    onSelectNewSenseAssocRelationType,
    onSubmitNewSenseAssocNodeBSearch,
    onSelectNewSenseAssocNodeB,
    onConfirmNewSenseAssocRelation,
    onGoBackNewSenseAssocStep,
    onCancelNewSenseAssocFlow,
    onStartNewSenseRelationEditor,
    onSaveNewSense
}) => {
    if (!addingSenseNode) return null;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content admin-add-sense-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>新增释义：{addingSenseNode.name}</h3>
                    <button className="btn-close" onClick={onClose} disabled={isSavingNewSense}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <div className="form-group">
                        <label>释义题目</label>
                        <input
                            type="text"
                            className="form-input"
                            value={newSenseForm.title}
                            onChange={(e) => setNewSenseForm((prev) => ({ ...prev, title: e.target.value }))}
                            placeholder="同一知识域下不可重名"
                        />
                        {String(newSenseForm.title || '').trim() === '' && (
                            <span className="error-text inline-field-error">释义题目不能为空</span>
                        )}
                    </div>
                    <div className="admin-add-sense-relations">
                        <div className="admin-add-sense-relations-header">
                            <h4>关联管理</h4>
                            <span>已添加 {newSenseForm.relations.length} 条</span>
                        </div>

                        <div className="admin-add-sense-added-relations">
                            {newSenseForm.relations.length > 0 ? (
                                newSenseForm.relations.map((relation) => (
                                    <div key={relation.id} className="admin-add-sense-relation-item">
                                        {relation.kind === assocRelationTypes.INSERT ? (
                                            <span>
                                                插入：{relation.leftTarget?.displayName || '未知'} {relation.direction === assocRelationTypes.EXTENDS ? relSymbolSubset : relSymbolSuperset} 当前释义 {relation.direction === assocRelationTypes.EXTENDS ? relSymbolSubset : relSymbolSuperset} {relation.rightTarget?.displayName || '未知'}
                                            </span>
                                        ) : (
                                            <span>
                                                当前释义 {relation.relationType === assocRelationTypes.CONTAINS ? relSymbolSuperset : relSymbolSubset} {relation.target?.displayName || '未知'}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            className="btn btn-danger btn-small"
                                            onClick={() => onRemoveRelationFromNewSense(relation.id)}
                                        >
                                            删除
                                        </button>
                                    </div>
                                ))
                            ) : (
                                <p className="admin-add-sense-empty-relations">当前还没有关联关系</p>
                            )}
                        </div>

                        {newSenseAssocFlow.currentStep ? (
                            <AssociationAddFlowEditor
                                steps={assocSteps}
                                relationTypes={assocRelationTypes}
                                relSymbolSubset={relSymbolSubset}
                                relSymbolSuperset={relSymbolSuperset}
                                currentStep={newSenseAssocFlow.currentStep}
                                selectedRelationType={newSenseAssocFlow.selectedRelationType}
                                sourceDisplay={newSenseAssocSourceDisplay}
                                targetDisplay={newSenseAssocTargetDisplay}
                                secondTargetDisplay={newSenseAssocSecondTargetDisplay}
                                nodeASenseOptions={newSenseAssocNodeASenseOptions}
                                selectedNodeASenseId={newSenseAssocFlow.selectedNodeASenseId}
                                insertDirection={newSenseAssocFlow.insertDirection}
                                insertRelationAvailable={newSenseAssocInsertRelationAvailable}
                                insertRelationUnavailableReason={newSenseAssocInsertRelationUnavailableReason}
                                nodeASearchKeyword={newSenseAssocFlow.searchKeyword}
                                nodeASearchAppliedKeyword={newSenseAssocFlow.searchAppliedKeyword}
                                nodeASearchLoading={newSenseAssocFlow.searchLoading}
                                nodeASearchResults={newSenseAssocFlow.searchResults}
                                nodeBSearchAppliedKeyword={newSenseAssocFlow.nodeBSearchAppliedKeyword}
                                nodeBSearchLoading={false}
                                nodeBCandidatesParents={newSenseAssocNodeBCandidateView.parents}
                                nodeBCandidatesChildren={newSenseAssocNodeBCandidateView.children}
                                previewCanvasRef={newSenseAssocPreviewCanvasRef}
                                previewInfoText={newSenseAssocPreviewInfoText}
                                onNodeASearchKeywordChange={(keyword) => {
                                    setNewSenseAssocFlow((prev) => ({ ...prev, searchKeyword: keyword }));
                                }}
                                onSubmitNodeASearch={() => onSearchNewSenseAssocNodeA(newSenseAssocFlow.searchKeyword)}
                                onClearNodeASearch={onClearNewSenseAssocNodeASearch}
                                onSelectNodeA={onSelectNewSenseAssocNodeA}
                                onChangeNodeASenseId={onHandleNewSenseAssocNodeASenseChange}
                                onSelectRelationType={onSelectNewSenseAssocRelationType}
                                onSubmitNodeBSearch={onSubmitNewSenseAssocNodeBSearch}
                                onSelectNodeBParent={(node) => onSelectNewSenseAssocNodeB(node, true)}
                                onSelectNodeBChild={(node) => onSelectNewSenseAssocNodeB(node, false)}
                                onConfirm={onConfirmNewSenseAssocRelation}
                                onBack={onGoBackNewSenseAssocStep}
                                onCancel={onCancelNewSenseAssocFlow}
                            />
                        ) : (
                            <button
                                type="button"
                                className="btn btn-primary admin-add-association-btn"
                                onClick={onStartNewSenseRelationEditor}
                            >
                                <Plus className="icon-small" /> 添加关联
                            </button>
                        )}
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={isSavingNewSense}>取消</button>
                    <button className="btn btn-primary" onClick={onSaveNewSense} disabled={isSavingNewSense}>
                        {isSavingNewSense ? '保存中...' : '确认新增释义'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdminAddSenseModal;
