import React from 'react';
import { normalizeDraftUnits } from '../../screens/battleSceneUtils';

const BattleDeployEditorPanel = ({
  open = false,
  deployEditingGroupId = '',
  deployEditorTeamLabel = '',
  deployEditorDraft = null,
  deployEditorTeam = 'attacker',
  deployEditorAvailableRows = [],
  deployEditorDragUnitId = '',
  deployEditorTotal = 0,
  deployEditorDraftSummary = '',
  onChangeDraftName,
  onSetDragUnitId,
  onOpenQuantityDialog,
  onDropUnit,
  onRemoveDraftUnit,
  onCancel,
  onConfirm
}) => {
  if (!open) return null;

  const draftUnits = normalizeDraftUnits(deployEditorDraft?.units || []);

  return (
    <div
      className="pve2-deploy-creator"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheelCapture={(event) => event.stopPropagation()}
    >
      <h4>{`${deployEditingGroupId ? '编辑部队' : '新建部队'}（${deployEditorTeamLabel}）`}</h4>
      <label>
        <span>部队名称</span>
        <input
          type="text"
          maxLength={32}
          value={deployEditorDraft?.name || ''}
          placeholder="不填则自动命名"
          onChange={(event) => onChangeDraftName?.(event.target.value || '')}
        />
      </label>
      <div className="pve2-deploy-editor-transfer">
        <div className="pve2-deploy-editor-col">
          <div className="pve2-deploy-editor-col-title">可用兵种（左侧）</div>
          <div className="pve2-deploy-editor-list">
            {deployEditorAvailableRows.map((row) => (
              <button
                key={`${deployEditorTeam}-left-${row.unitTypeId}`}
                type="button"
                className="pve2-deploy-unit-card"
                draggable={row.availableForDraft > 0}
                disabled={row.availableForDraft <= 0}
                onDragStart={(event) => {
                  event.dataTransfer?.setData('application/x-deploy-unit-id', row.unitTypeId);
                  event.dataTransfer?.setData('text/plain', row.unitTypeId);
                  onSetDragUnitId?.(row.unitTypeId);
                }}
                onDragEnd={() => onSetDragUnitId?.('')}
                onClick={() => onOpenQuantityDialog?.(row.unitTypeId)}
              >
                <strong>{row.unitName}</strong>
                <span>{`可用 ${row.availableForDraft}`}</span>
              </button>
            ))}
          </div>
        </div>
        <div
          className={`pve2-deploy-editor-col pve2-deploy-editor-col-right ${deployEditorDragUnitId ? 'is-dropzone' : ''}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => onDropUnit?.(event)}
        >
          <div className="pve2-deploy-editor-col-title">部队编组（右侧）</div>
          <div className="pve2-deploy-editor-list">
            {draftUnits.length <= 0 ? (
              <div className="pve2-deploy-editor-tip">拖拽左侧兵种到这里后，会弹出数量输入框。</div>
            ) : null}
            {draftUnits.map((entry) => (
              <div key={`${deployEditorTeam}-right-${entry.unitTypeId}`} className="pve2-deploy-editor-row">
                <span>{`${deployEditorAvailableRows.find((row) => row.unitTypeId === entry.unitTypeId)?.unitName || entry.unitTypeId} x${entry.count}`}</span>
                <div className="pve2-deploy-editor-row-actions">
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => onOpenQuantityDialog?.(entry.unitTypeId)}>数量</button>
                  <button type="button" className="btn btn-warning btn-small" onClick={() => onRemoveDraftUnit?.(entry.unitTypeId)}>移除</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="pve2-deploy-editor-summary">
        {`总兵力 ${deployEditorTotal}${deployEditorDraftSummary ? ` ｜ ${deployEditorDraftSummary}` : ''}`}
      </div>
      <div className="pve2-deploy-creator-actions">
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => onCancel?.()}
        >
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() => onConfirm?.()}
          disabled={deployEditorTotal <= 0}
        >
          确定编组
        </button>
      </div>
    </div>
  );
};

export default BattleDeployEditorPanel;
