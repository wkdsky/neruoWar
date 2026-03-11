import React from 'react';
import {
  TABLE_BORDER_EDGE_OPTIONS,
  TABLE_BORDER_PRESETS,
  TABLE_BORDER_WIDTH_OPTIONS,
  TABLE_COLOR_PALETTE
} from '../table/tableSchema';

const PRESET_LABEL_MAP = {
  all: '全边框',
  none: '无边框',
  outer: '仅外边框',
  'inner-horizontal': '内横线',
  'inner-vertical': '内竖线',
  'three-line': '三线表'
};

const EDGE_LABEL_MAP = {
  top: '上',
  right: '右',
  bottom: '下',
  left: '左'
};

const TableBorderPopover = ({
  open,
  currentTableAttrs = {},
  currentCellAttrs = {},
  selectionState = {},
  onPresetChange,
  onBorderWidthChange,
  onBorderColorChange,
  onEdgeToggle,
  onClearOverride
}) => {
  if (!open) return null;

  const activeEdges = selectionState?.selectionEdgeState || {};

  return (
    <div className="sense-rich-table-dropdown sense-rich-table-dropdown-border" role="dialog" aria-label="表格边框设置">
      <div className="sense-rich-table-popover-section">
        <strong>表格预设</strong>
        <div className="sense-rich-table-option-column">
          {TABLE_BORDER_PRESETS.map((item) => (
            <button
              key={item}
              type="button"
              className={`sense-rich-table-chip ${String(currentTableAttrs.tableBorderPreset || 'all') === item ? 'active' : ''}`}
              onClick={() => onPresetChange(item)}
            >
              {PRESET_LABEL_MAP[item]}
            </button>
          ))}
        </div>
      </div>

      <div className="sense-rich-table-popover-section">
        <strong>当前单元格边框</strong>
        <div className="sense-rich-table-option-row">
          {TABLE_BORDER_EDGE_OPTIONS.map((edge) => (
            <button
              key={edge}
              type="button"
              className={`sense-rich-table-chip ${activeEdges?.[edge] ? 'active' : ''}`}
              onClick={() => onEdgeToggle(edge)}
            >
              {EDGE_LABEL_MAP[edge]}
            </button>
          ))}
        </div>
        <button type="button" className="sense-rich-table-text-button" onClick={onClearOverride}>清除单元格边框覆盖</button>
      </div>

      <div className="sense-rich-table-popover-section">
        <strong>边框粗细</strong>
        <div className="sense-rich-table-option-row">
          {TABLE_BORDER_WIDTH_OPTIONS.map((item) => (
            <button
              key={item}
              type="button"
              className={`sense-rich-table-chip ${String(currentCellAttrs.borderWidth || '') === item ? 'active' : ''}`}
              onClick={() => onBorderWidthChange(item)}
            >
              {item}px
            </button>
          ))}
        </div>
      </div>

      <div className="sense-rich-table-popover-section">
        <strong>边框颜色</strong>
        <div className="sense-rich-color-grid">
          {TABLE_COLOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className={`sense-color-swatch ${String(currentCellAttrs.borderColor || '').toLowerCase() === color.toLowerCase() ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => onBorderColorChange(color)}
            />
          ))}
        </div>
        <input
          type="color"
          aria-label="自定义边框颜色"
          value={currentCellAttrs.borderColor || '#94a3b8'}
          onChange={(event) => onBorderColorChange(event.target.value)}
        />
      </div>

      <div className="sense-rich-table-popover-note">
        单元格显式边框优先于表格 preset；批量设置会统一应用到当前选区。
      </div>
    </div>
  );
};

export default TableBorderPopover;
