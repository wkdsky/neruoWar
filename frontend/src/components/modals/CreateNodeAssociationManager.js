import React from 'react';
import { X, Plus } from 'lucide-react';
import AssociationAddFlowEditor from '../shared/AssociationAddFlowEditor';

const CreateNodeAssociationManager = ({
  isOpen,
  relationManager,
  managedSense,
  managedSenseIndex,
  managedSenseFieldErrors,
  relSymbolSubset,
  relSymbolSuperset,
  buildRelationDisplayText,

  steps,
  relationTypes,
  sourceDisplay,
  targetDisplay,
  secondTargetDisplay,
  nodeASenseOptions,
  nodeBSenseOptions,
  nodeBCandidatesParents,
  nodeBCandidatesChildren,
  nodeBCandidatesExtra,
  previewCanvasRef,
  previewInfoText,
  insertRelationAvailable,

  onClose,
  onRequestDeleteRelation,
  onConfirmDeleteRelation,
  onCancelDeleteRelation,
  onStartManagedRelationEditor,

  onNodeASearchKeywordChange,
  onSubmitNodeASearch,
  onClearNodeASearch,
  onSelectNodeA,
  onChangeNodeASenseId,
  onSelectRelationType,

  onNodeBSearchKeywordChange,
  onSubmitNodeBSearch,
  onClearNodeBSearch,
  onSelectNodeBParent,
  onSelectNodeBChild,
  onSelectNodeBExtra,
  onChangeNodeBSenseId,
  onToggleInsertDirection,

  onConfirmManagedRelationAdd,
  onGoBackFlow,
  onCancelFlow
}) => {
  if (!isOpen) return null;

  return (
    <div className="create-relation-manager-overlay">
      <div className="create-relation-manager-panel" onClick={(event) => event.stopPropagation()}>
        <div className="target-selector-header">
          <strong>
            关联管理：释义 {managedSenseIndex >= 0 ? managedSenseIndex + 1 : '-'}
            {managedSense?.title?.trim() ? `（${managedSense.title.trim()}）` : ''}
          </strong>
          <button type="button" className="btn btn-danger btn-small" onClick={onClose}>
            <X className="icon-small" />
          </button>
        </div>

        {!managedSense ? (
          <div className="create-relation-manager-empty">当前释义不存在，请关闭后重试。</div>
        ) : (
          <>
            <div className="create-relation-manager-body">
              <div className="create-relation-manager-section admin-edit-associations-section">
                <div className="admin-edit-associations-header create-relation-manager-list-header">
                  <h4>
                    释义关联关系
                    <span className="create-relation-manager-count">
                      ({managedSense.relations.length}/{managedSense.relations.length})
                    </span>
                  </h4>
                </div>
                {managedSense.relations.length > 0 ? (
                  <div className="admin-edit-associations-list create-relation-manager-list">
                    {managedSense.relations.map((relation) => {
                      const isPendingDelete = relationManager.pendingDeleteRelationId === relation.id;
                      const relationType = relation.relationType === 'insert' ? 'insert' : relation.relationType;
                      return (
                        <div
                          key={relation.id}
                          className={`admin-edit-association-item ${isPendingDelete ? 'pending-removal' : ''}`}
                        >
                          <div className="admin-edit-association-info">
                            <span className={`admin-edit-association-display ${isPendingDelete ? 'pending-removal' : ''}`}>
                              {buildRelationDisplayText(relation, managedSense.title?.trim() || `当前释义${managedSenseIndex + 1}`)}
                            </span>
                            <span className={`admin-edit-relation-badge ${relationType} ${isPendingDelete ? 'pending-removal' : ''}`}>
                              {relationType === 'insert'
                                ? '插入'
                                : (relationType === 'extends' ? relSymbolSuperset : relSymbolSubset)}
                            </span>
                          </div>
                          <div className="admin-edit-association-actions">
                            {isPendingDelete ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-danger btn-small"
                                  onClick={onConfirmDeleteRelation}
                                >
                                  确定
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-small"
                                  onClick={onCancelDeleteRelation}
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-danger btn-small"
                                onClick={() => onRequestDeleteRelation(relation.id)}
                              >
                                删除
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="admin-assoc-step-description create-relation-manager-empty-list">暂无关联</p>
                )}
              </div>

              <div className="create-relation-manager-section admin-assoc-editor sense-relations-editor admin-add-sense-relations">
                {relationManager.currentStep ? (
                  <AssociationAddFlowEditor
                    steps={steps}
                    relationTypes={relationTypes}
                    relSymbolSubset={relSymbolSubset}
                    relSymbolSuperset={relSymbolSuperset}
                    currentStep={relationManager.currentStep}
                    selectedRelationType={relationManager.selectedRelationType}
                    sourceDisplay={sourceDisplay}
                    targetDisplay={targetDisplay}
                    secondTargetDisplay={secondTargetDisplay}
                    nodeASenseOptions={nodeASenseOptions}
                    selectedNodeASenseId={relationManager.selectedNodeASenseId}
                    nodeBSenseOptions={nodeBSenseOptions}
                    selectedNodeBSenseId={relationManager.selectedNodeBSenseId}
                    insertDirection={relationManager.insertDirection}
                    insertDirectionLocked={relationManager.insertDirectionLocked}
                    insertRelationAvailable={insertRelationAvailable}
                    nodeASearchKeyword={relationManager.searchKeyword}
                    nodeASearchAppliedKeyword={relationManager.searchAppliedKeyword}
                    nodeASearchLoading={relationManager.searchLoading}
                    nodeASearchResults={relationManager.searchResults}
                    nodeBSearchKeyword={relationManager.nodeBSearchKeyword}
                    nodeBSearchAppliedKeyword={relationManager.nodeBSearchAppliedKeyword}
                    nodeBSearchLoading={relationManager.nodeBExtraSearchLoading}
                    nodeBCandidatesParents={nodeBCandidatesParents}
                    nodeBCandidatesChildren={nodeBCandidatesChildren}
                    nodeBCandidatesExtra={nodeBCandidatesExtra}
                    previewCanvasRef={previewCanvasRef}
                    previewInfoText={previewInfoText}
                    onNodeASearchKeywordChange={onNodeASearchKeywordChange}
                    onSubmitNodeASearch={onSubmitNodeASearch}
                    onClearNodeASearch={onClearNodeASearch}
                    onSelectNodeA={onSelectNodeA}
                    onChangeNodeASenseId={onChangeNodeASenseId}
                    onSelectRelationType={onSelectRelationType}
                    onNodeBSearchKeywordChange={onNodeBSearchKeywordChange}
                    onSubmitNodeBSearch={onSubmitNodeBSearch}
                    onClearNodeBSearch={onClearNodeBSearch}
                    onSelectNodeBParent={onSelectNodeBParent}
                    onSelectNodeBChild={onSelectNodeBChild}
                    onSelectNodeBExtra={onSelectNodeBExtra}
                    onChangeNodeBSenseId={onChangeNodeBSenseId}
                    onToggleInsertDirection={onToggleInsertDirection}
                    onConfirm={onConfirmManagedRelationAdd}
                    onBack={onGoBackFlow}
                    onCancel={onCancelFlow}
                  />
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary admin-add-association-btn"
                    onClick={onStartManagedRelationEditor}
                  >
                    <Plus className="icon-small" /> 添加关联
                  </button>
                )}
                {managedSenseFieldErrors.relation && (
                  <span className="error-text inline-field-error">{managedSenseFieldErrors.relation}</span>
                )}
              </div>
            </div>

            <div className="target-selector-footer">
              <button type="button" className="btn btn-primary" onClick={onClose}>完成</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CreateNodeAssociationManager;
