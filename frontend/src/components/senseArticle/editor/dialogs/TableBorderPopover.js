import React from 'react';
import {
  Eraser,
  GalleryHorizontalEnd,
  GalleryVerticalEnd,
  LayoutPanelLeft,
  LayoutPanelTop,
  RectangleHorizontal,
  TableProperties
} from 'lucide-react';
import {
  TABLE_BORDER_EDGE_OPTIONS,
  TABLE_BORDER_PRESET_OPTIONS,
  TABLE_BORDER_WIDTH_OPTIONS,
  TABLE_COLOR_PALETTE
} from '../table/tableSchema';

const PRESET_LABEL_MAP = {
  all: '全边框',
  none: '无边框',
  outer: '仅外边框',
  'three-line': '三线表'
};

const EDGE_LABEL_MAP = {
  top: '上',
  right: '右',
  bottom: '下',
  left: '左'
};

const EDGE_ICON_MAP = {
  top: LayoutPanelTop,
  right: GalleryHorizontalEnd,
  bottom: GalleryVerticalEnd,
  left: LayoutPanelLeft
};

const renderChipLabel = (Icon, label) => (
  <>
    <Icon size={14} className="sense-rich-table-button-icon" />
    <span>{label}</span>
  </>
);

const preventFocusSteal = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

const runActionOnMouseDown = (event, action) => {
  preventFocusSteal(event);
  if (typeof action === 'function') action();
};

const runActionOnKeyDown = (event, action) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  if (typeof action === 'function') action();
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
        <div className="sense-rich-table-option-row sense-rich-table-option-row-tight">
          {TABLE_BORDER_PRESET_OPTIONS.map((item) => (
            <button
              key={item}
              type="button"
              className={`sense-rich-table-chip ${String(currentTableAttrs.tableBorderPreset || 'all') === item ? 'active' : ''}`}
              onMouseDown={(event) => runActionOnMouseDown(event, () => onPresetChange(item))}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => runActionOnKeyDown(event, () => onPresetChange(item))}
            >
              {renderChipLabel(TableProperties, PRESET_LABEL_MAP[item])}
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
              className="sense-rich-table-chip sense-rich-table-chip-edge"
              aria-pressed={activeEdges?.[edge] ? 'true' : 'false'}
              onMouseDown={(event) => runActionOnMouseDown(event, () => onEdgeToggle(edge))}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => runActionOnKeyDown(event, () => onEdgeToggle(edge))}
            >
              {renderChipLabel(EDGE_ICON_MAP[edge], EDGE_LABEL_MAP[edge])}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="sense-rich-table-text-button"
          onMouseDown={(event) => runActionOnMouseDown(event, onClearOverride)}
          onClick={(event) => event.preventDefault()}
          onKeyDown={(event) => runActionOnKeyDown(event, onClearOverride)}
        >
          <Eraser size={14} className="sense-rich-table-button-icon" />
          <span>清除单元格边框覆盖</span>
        </button>
      </div>

      <div className="sense-rich-table-popover-section">
        <strong>边框粗细</strong>
        <div className="sense-rich-table-option-row">
          {TABLE_BORDER_WIDTH_OPTIONS.map((item) => (
            <button
              key={item}
              type="button"
              className={`sense-rich-table-chip ${String(currentCellAttrs.borderWidth || '') === item ? 'active' : ''}`}
              onMouseDown={(event) => runActionOnMouseDown(event, () => onBorderWidthChange(item))}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => runActionOnKeyDown(event, () => onBorderWidthChange(item))}
            >
              {renderChipLabel(RectangleHorizontal, `${item}px`)}
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
              onMouseDown={(event) => runActionOnMouseDown(event, () => onBorderColorChange(color))}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => runActionOnKeyDown(event, () => onBorderColorChange(color))}
            />
          ))}
        </div>
        <input
          type="color"
          aria-label="自定义边框颜色"
          value={currentCellAttrs.borderColor || '#334155'}
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
