import React from 'react';
import { Search, ArrowRight, Check } from 'lucide-react';

const AssociationAddFlowEditor = ({
  // constants
  steps,
  relationTypes,
  relSymbolSuperset,
  relSymbolSubset,

  // state
  currentStep,
  selectedRelationType,
  sourceDisplay,
  targetDisplay,
  secondTargetDisplay,
  nodeASenseOptions,
  selectedNodeASenseId,
  insertDirection,
  insertRelationAvailable = true,
  insertRelationUnavailableReason = '',

  // step1 search
  nodeASearchKeyword,
  nodeASearchAppliedKeyword,
  nodeASearchLoading,
  nodeASearchResults,

  // step3 candidates
  nodeBSearchAppliedKeyword,
  nodeBSearchLoading,
  nodeBCandidatesParents,
  nodeBCandidatesChildren,

  // preview
  previewCanvasRef,
  previewInfoText,

  // handlers
  onNodeASearchKeywordChange,
  onSubmitNodeASearch,
  onClearNodeASearch,
  onSelectNodeA,
  onChangeNodeASenseId,
  onSelectRelationType,
  onSubmitNodeBSearch,
  onSelectNodeBParent,
  onSelectNodeBChild,
  onConfirm,
  onBack,
  onCancel
}) => {
  if (!currentStep) return null;

  const stepItems = [
    { key: steps.SELECT_NODE_A, label: '选择目标释义' },
    { key: steps.SELECT_RELATION, label: '选择关系' },
    ...(selectedRelationType === relationTypes.INSERT ? [{ key: steps.SELECT_NODE_B, label: '第二目标释义' }] : []),
    { key: steps.PREVIEW, label: '预览确认' }
  ];
  const currentIndex = stepItems.findIndex((item) => item.key === currentStep);
  const insertRelationSymbol = insertDirection === 'bToA' ? relSymbolSubset : relSymbolSuperset;
  const previewRelationHint = (
    selectedRelationType === relationTypes.EXTENDS
      ? `${relSymbolSuperset}（当前释义在左）`
      : (
        selectedRelationType === relationTypes.CONTAINS
          ? `${relSymbolSubset}（当前释义在左）`
          : (
            selectedRelationType === relationTypes.INSERT
              ? `左侧释义 ${insertRelationSymbol} 当前释义 ${insertRelationSymbol} 右侧释义`
              : ''
          )
      )
  );

  return (
    <div className="admin-assoc-editor">
      <div className="admin-assoc-step-indicator">
        {stepItems.map((step, index) => (
          <React.Fragment key={step.key}>
            <div className={`admin-assoc-step-dot ${index <= currentIndex ? 'active' : ''} ${step.key === currentStep ? 'current' : ''}`}>
              {index + 1}
            </div>
            {index < stepItems.length - 1 && (
              <div className={`admin-assoc-step-line ${index < currentIndex ? 'active' : ''}`} />
            )}
          </React.Fragment>
        ))}
        <div className="admin-assoc-step-labels">
          {stepItems.map((step) => (
            <span key={step.key} className={`admin-assoc-step-label ${step.key === currentStep ? 'current' : ''}`}>
              {step.label}
            </span>
          ))}
        </div>
      </div>

      {currentStep === steps.SELECT_NODE_A && (
        <div className="admin-assoc-step">
          <h5>步骤 1：选择目标释义</h5>
          <p className="admin-assoc-step-description">
            当前正在编辑：<strong>{sourceDisplay || '-'}</strong>
          </p>
          <p className="admin-assoc-step-description">搜索并选择一个现有释义作为关联目标（可输入关键词，不区分大小写）</p>

          <div className="search-input-group">
            <div className="admin-assoc-search-input-wrap">
              <input
                type="text"
                value={nodeASearchKeyword || ''}
                onChange={(e) => onNodeASearchKeywordChange?.(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSubmitNodeASearch?.();
                  }
                }}
                placeholder="搜索标题或释义题目（回车或点击搜索）"
                className="form-input"
              />
              {!!nodeASearchKeyword && (
                <button type="button" className="admin-assoc-search-clear" onClick={onClearNodeASearch} aria-label="清空搜索">
                  X
                </button>
              )}
            </div>
            <button onClick={onSubmitNodeASearch} disabled={nodeASearchLoading} className="btn btn-primary">
              <Search className="icon-small" />
              {nodeASearchLoading ? '...' : '搜索'}
            </button>
          </div>

          {!nodeASearchLoading && !!nodeASearchAppliedKeyword && nodeASearchResults.length === 0 && (
            <p className="admin-assoc-step-description">未找到匹配释义</p>
          )}

          {nodeASearchResults.length > 0 && (
            <div className="search-results">
              {nodeASearchResults.map((node) => (
                <div
                  key={node.searchKey || `${node._id}_${node.senseId || 'sense'}`}
                  className="search-result-item clickable"
                  onClick={() => onSelectNodeA?.(node)}
                >
                  <div className="node-info">
                    <strong>{node.displayName || node.name}</strong>
                  </div>
                  <ArrowRight className="icon-small" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {currentStep === steps.SELECT_RELATION && (
        <div className="admin-assoc-step">
          <h5>步骤 2：选择关系类型</h5>
          <p className="admin-assoc-step-description">
            选择 <strong>{sourceDisplay || '-'}</strong> 与 <strong>{targetDisplay || '-'}</strong> 的关系
          </p>
          <p className="admin-assoc-step-description">
            当前释义固定为：<strong>{sourceDisplay || '-'}</strong>
          </p>

          <div className="admin-assoc-sense-selector-row">
            <label className="admin-assoc-sense-selector">
              目标释义
              <select
                value={selectedNodeASenseId || ''}
                onChange={(e) => onChangeNodeASenseId?.(e.target.value)}
                className="edit-input"
              >
                {nodeASenseOptions.length < 1 ? (
                  <option value="">无可选释义</option>
                ) : nodeASenseOptions.map((sense) => (
                  <option key={`target_a_${sense.senseId}`} value={sense.senseId}>{sense.title}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="admin-assoc-relation-cards">
            <div className="admin-assoc-relation-card" onClick={() => onSelectRelationType?.(relationTypes.EXTENDS)}>
              <div className="admin-assoc-relation-icon extends">↑</div>
              <div className="admin-assoc-relation-content">
                <h6>{relSymbolSuperset}（当前释义在左）</h6>
                <p>{`${sourceDisplay || '-'} ${relSymbolSuperset} ${targetDisplay || '-'}`}</p>
              </div>
            </div>

            <div className="admin-assoc-relation-card" onClick={() => onSelectRelationType?.(relationTypes.CONTAINS)}>
              <div className="admin-assoc-relation-icon contains">↓</div>
              <div className="admin-assoc-relation-content">
                <h6>{relSymbolSubset}（当前释义在左）</h6>
                <p>{`${sourceDisplay || '-'} ${relSymbolSubset} ${targetDisplay || '-'}`}</p>
              </div>
            </div>

            <div
              className={`admin-assoc-relation-card ${!insertRelationAvailable ? 'disabled' : ''}`}
              onClick={() => {
                if (!insertRelationAvailable) return;
                onSelectRelationType?.(relationTypes.INSERT);
              }}
            >
              <div className="admin-assoc-relation-icon insert">⇄</div>
              <div className="admin-assoc-relation-content">
                <h6>插入到两释义之间</h6>
                <p>{`将 ${sourceDisplay || '-'} 插入到 ${targetDisplay || '-'} 与另一个释义之间`}</p>
              </div>
            </div>
          </div>
          {!insertRelationAvailable && !!insertRelationUnavailableReason && (
            <p className="admin-assoc-step-warning">{insertRelationUnavailableReason}</p>
          )}
        </div>
      )}

      {currentStep === steps.SELECT_NODE_B && (
        <div className="admin-assoc-step">
          <h5>步骤 3：选择第二个目标释义</h5>
          <p className="admin-assoc-step-description">
            选择要与 <strong>{targetDisplay || '-'}</strong> 之间插入当前释义的另一侧释义
          </p>
          <p className="admin-assoc-step-description">
            请仅使用命令选择候选：<code>#include</code>（查看与左侧释义存在上级链路的候选）、
            <code>#expand</code>（查看与左侧释义存在下级链路的候选）
          </p>

          <div className="admin-assoc-command-buttons">
            <button type="button" className="admin-assoc-command-btn" onClick={() => onSubmitNodeBSearch?.('#include')}>#include</button>
            <button type="button" className="admin-assoc-command-btn" onClick={() => onSubmitNodeBSearch?.('#expand')}>#expand</button>
          </div>

          {nodeBCandidatesParents.length > 0 && (
            <div className="admin-assoc-candidate-section">
              <h6 className="admin-assoc-candidate-header parent">
                <span className="admin-assoc-candidate-icon">↑</span> 上层候选（{relSymbolSuperset}链路）
              </h6>
              <div className="admin-assoc-candidate-list">
                {nodeBCandidatesParents.map((node) => (
                  <div key={node.searchKey || node._id} className="admin-assoc-candidate-item" onClick={() => onSelectNodeBParent?.(node)}>
                    <span className="admin-assoc-candidate-name">{node.displayName || node.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {nodeBCandidatesChildren.length > 0 && (
            <div className="admin-assoc-candidate-section">
              <h6 className="admin-assoc-candidate-header child">
                <span className="admin-assoc-candidate-icon">↓</span> 下层候选（{relSymbolSubset}链路）
              </h6>
              <div className="admin-assoc-candidate-list">
                {nodeBCandidatesChildren.map((node) => (
                  <div key={node.searchKey || node._id} className="admin-assoc-candidate-item" onClick={() => onSelectNodeBChild?.(node)}>
                    <span className="admin-assoc-candidate-name">{node.displayName || node.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!nodeBSearchAppliedKeyword && (
            <p className="admin-assoc-step-description">点击上方命令按钮后展示候选释义。</p>
          )}
          {!!nodeBSearchAppliedKeyword && nodeBCandidatesParents.length === 0 && nodeBCandidatesChildren.length === 0 && !nodeBSearchLoading && (
            <p className="admin-assoc-step-description">未找到匹配释义</p>
          )}
        </div>
      )}

      {currentStep === steps.PREVIEW && (
        <div className="admin-assoc-step admin-assoc-preview-step">
          <h5>步骤 {selectedRelationType === relationTypes.INSERT ? '4' : '3'}：预览确认</h5>
          {!!previewRelationHint && (
            <p className="admin-assoc-step-description" style={{ textAlign: 'center' }}>
              <strong>{previewRelationHint}</strong>
            </p>
          )}

          {selectedRelationType !== relationTypes.INSERT && (
            <div className="admin-assoc-sense-selector-row">
              <label className="admin-assoc-sense-selector">
                目标释义
                <select value={selectedNodeASenseId || ''} onChange={(e) => onChangeNodeASenseId?.(e.target.value)} className="edit-input">
                  {nodeASenseOptions.length < 1 ? (
                    <option value="">无可选释义</option>
                  ) : nodeASenseOptions.map((sense) => (
                    <option key={`preview_target_a_${sense.senseId}`} value={sense.senseId}>{sense.title}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="admin-assoc-preview-canvas-container">
            <canvas ref={previewCanvasRef} width={360} height={240} className="admin-assoc-preview-canvas" />
          </div>

          <div className="admin-assoc-preview-info">
            <span>{previewInfoText || `${sourceDisplay || '-'} -> ${targetDisplay || '-'} ${secondTargetDisplay ? `-> ${secondTargetDisplay}` : ''}`}</span>
          </div>

          <div className="admin-assoc-preview-actions">
            <button onClick={onConfirm} className="btn btn-success">
              <Check className="icon-small" /> 确认关联
            </button>
          </div>
        </div>
      )}

      <div className="admin-assoc-editor-navigation">
        <button onClick={onBack} className="btn btn-secondary">
          返回
        </button>
        <button onClick={onCancel} className="btn btn-danger">
          取消
        </button>
      </div>
    </div>
  );
};

export default AssociationAddFlowEditor;
