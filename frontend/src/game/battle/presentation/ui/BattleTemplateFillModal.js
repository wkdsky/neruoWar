import React from 'react';
import useDraggablePanel from './useDraggablePanel';

const BattleTemplateFillModal = ({
  open = false,
  preview = null,
  onClose,
  onConfirm
}) => {
  const { panelRef, panelStyle, handleHeaderPointerDown } = useDraggablePanel({
    open,
    defaultSize: { width: 760, height: 600 }
  });
  if (!open) return null;

  const totalRequested = Math.max(0, Number(preview?.totalRequested) || 0);
  const totalFilled = Math.max(0, Number(preview?.totalFilled) || 0);
  const fillPercent = totalRequested > 0 ? ((totalFilled / totalRequested) * 100) : 0;

  return (
    <div
      className="pve2-template-fill-backdrop"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className="pve2-template-fill-panel"
        style={panelStyle}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onWheelCapture={(event) => event.stopPropagation()}
      >
        <div className="pve2-template-fill-head pve2-drag-handle" onPointerDown={handleHeaderPointerDown}>
          <h4>{`模板填充：${preview?.template?.name || '未命名模板'}`}</h4>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            data-no-drag
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onClose?.()}
          >
            关闭
          </button>
        </div>
        <div className="pve2-template-fill-summary">
          <span>{`模板总兵力 ${totalRequested}`}</span>
          <span>{`当前可填充 ${totalFilled}`}</span>
          <strong>{`填充率 ${fillPercent.toFixed(1)}%`}</strong>
        </div>
        <div className="pve2-template-fill-list">
          {(preview?.rows || []).map((row) => (
            <div key={`fill-${row.unitTypeId}`} className="pve2-template-fill-row">
              <div className="pve2-template-fill-meta">
                <strong>{row.unitName || row.unitTypeId}</strong>
                <span>{`模板 ${row.requested} ｜ 可用 ${row.available} ｜ 填充 ${row.filled}`}</span>
              </div>
              <div className="pve2-template-fill-progress">
                <div className="pve2-template-fill-progress-bar" style={{ width: `${Math.max(0, Math.min(100, row.fillPercent || 0))}%` }} />
              </div>
              <em>{`${Math.max(0, Math.min(100, row.fillPercent || 0)).toFixed(1)}%`}</em>
            </div>
          ))}
        </div>
        <div className="pve2-template-fill-actions">
          <button type="button" className="btn btn-secondary" onClick={() => onClose?.()}>取消</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={totalFilled <= 0}
            onClick={() => onConfirm?.()}
          >
            生成部队
          </button>
        </div>
      </div>
    </div>
  );
};

export default BattleTemplateFillModal;
