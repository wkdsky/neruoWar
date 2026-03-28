import React from 'react';

const DefenderEditorPanel = ({
  defenderEditingDeployId = '',
  effectiveCanEdit = false,
  defenderEditorTotalCount = 0,
  defenderEditorDraft = { name: '', sortOrder: 1, units: [] },
  defenderEditorAvailableRows = [],
  defenderEditorUnits = [],
  defenderRosterMap = new Map(),
  onClose,
  onSave,
  onDraftChange,
  onOpenQuantityDialog,
  onRemoveDraftUnit
}) => (
  <div className="battlefield-defender-editor" onClick={(event) => event.stopPropagation()}>
    <div className="battlefield-defender-editor-head">
      <strong>{defenderEditingDeployId ? '编辑守城部队' : '新建守城部队'}</strong>
      <div className="battlefield-sidebar-row">
        <button type="button" className="btn btn-small btn-secondary" onClick={onClose}>关闭</button>
        <button
          type="button"
          className="btn btn-small btn-warning"
          onClick={onSave}
          disabled={!effectiveCanEdit || defenderEditorTotalCount <= 0}
        >
          确定编组
        </button>
      </div>
    </div>
    <div className="battlefield-defender-editor-grid">
      <label>
        部队名称
        <input
          type="text"
          maxLength={32}
          value={defenderEditorDraft.name || ''}
          placeholder="不填则自动命名"
          onChange={(event) => {
            const value = typeof event.target.value === 'string' ? event.target.value : '';
            onDraftChange({ ...defenderEditorDraft, name: value });
          }}
        />
      </label>
      <label>
        排序
        <input
          type="number"
          min={1}
          max={9999}
          value={Math.max(1, Math.floor(Number(defenderEditorDraft.sortOrder) || 1))}
          onChange={(event) => {
            const raw = Math.max(1, Math.floor(Number(event.target.value) || 1));
            onDraftChange({ ...defenderEditorDraft, sortOrder: raw });
          }}
        />
      </label>
    </div>
    <div className="battlefield-defender-editor-transfer">
      <div className="battlefield-defender-editor-col">
        <div className="battlefield-defender-editor-col-title">可用兵种（左侧）</div>
        {defenderEditorAvailableRows.map((item) => (
          <button
            key={`def-editor-left-${item.unitTypeId}`}
            type="button"
            className="battlefield-item-card"
            draggable={effectiveCanEdit && item.available > 0}
            disabled={item.available <= 0}
            onDragStart={(event) => {
              event.dataTransfer?.setData('application/x-defender-unit-id', item.unitTypeId);
              event.dataTransfer?.setData('text/plain', item.unitTypeId);
            }}
            onClick={() => onOpenQuantityDialog(item.unitTypeId)}
          >
            <strong>{item.unitName || item.unitTypeId}</strong>
            <span>{`可用 ${item.available}`}</span>
          </button>
        ))}
      </div>
      <div
        className="battlefield-defender-editor-col is-dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const droppedUnitTypeId = event.dataTransfer?.getData('application/x-defender-unit-id')
            || event.dataTransfer?.getData('text/plain')
            || '';
          onOpenQuantityDialog(droppedUnitTypeId);
        }}
      >
        <div className="battlefield-defender-editor-col-title">部队编组（右侧）</div>
        {defenderEditorUnits.length <= 0 && (
          <div className="battlefield-sidebar-tip">拖拽左侧兵种到这里后，会弹出数量输入框。</div>
        )}
        {defenderEditorUnits.map((entry) => (
          <div key={`def-editor-right-${entry.unitTypeId}`} className="battlefield-sidebar-meta-row">
            <span>{`${defenderRosterMap.get(entry.unitTypeId)?.unitName || entry.unitTypeId} x${entry.count}`}</span>
            <div className="battlefield-sidebar-row">
              <button
                type="button"
                className="btn btn-small btn-secondary"
                onClick={() => onOpenQuantityDialog(entry.unitTypeId)}
              >
                数量
              </button>
              <button
                type="button"
                className="btn btn-small btn-warning"
                onClick={() => onRemoveDraftUnit(entry.unitTypeId)}
              >
                移除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
    <div className="battlefield-defender-editor-tip">
      {`总兵力 ${defenderEditorTotalCount}。确定后会生成或更新守军部队卡片；可通过卡片右上角“编辑/删除”管理部队，若该部队已部署会自动从战场撤回。`}
    </div>
  </div>
);

export default DefenderEditorPanel;
