import React from 'react';

const BattlefieldHeader = ({
  gateLabel = '',
  loadingLayout = false,
  effectiveCanEdit = false,
  editMode = false,
  savingLayout = false,
  onStartLayoutEditing,
  onCancelLayoutEditing,
  onSaveLayoutEditing,
  onClose
}) => (
  <div className="battlefield-modal-header">
    <div className="battlefield-modal-title">
      <strong>{gateLabel ? `${gateLabel} 战场预览` : '战场预览'}</strong>
      <span>{loadingLayout ? '正在加载战场配置...' : 'RTS 俯视战场：右键按住旋转视角，Space+左键或中键平移，滚轮缩放/旋转'}</span>
    </div>
    <div className="battlefield-modal-actions">
      {!effectiveCanEdit && (
        <button type="button" className="btn btn-small btn-secondary" disabled>
          仅预览
        </button>
      )}
      {effectiveCanEdit && !editMode && (
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={loadingLayout || savingLayout}
          onClick={onStartLayoutEditing}
        >
          布置战场
        </button>
      )}
      {effectiveCanEdit && editMode && (
        <>
          <button
            type="button"
            className="btn btn-small btn-warning"
            disabled={savingLayout}
            onClick={onCancelLayoutEditing}
          >
            取消布置
          </button>
          <button
            type="button"
            className="btn btn-small btn-primary"
            disabled={savingLayout || loadingLayout}
            onClick={onSaveLayoutEditing}
          >
            保存布置
          </button>
        </>
      )}
      <button type="button" className="btn btn-small btn-secondary" onClick={onClose}>
        关闭
      </button>
    </div>
  </div>
);

export default BattlefieldHeader;
