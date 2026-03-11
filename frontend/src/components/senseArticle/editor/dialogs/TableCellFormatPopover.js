import React from 'react';
import {
  TABLE_BACKGROUND_PALETTE,
  TABLE_COLOR_PALETTE,
  TABLE_DIAGONAL_MODES,
  TABLE_VERTICAL_ALIGN_OPTIONS
} from '../table/tableSchema';

const ALIGN_LABEL_MAP = {
  left: '左对齐',
  center: '居中',
  right: '右对齐'
};

const DIAGONAL_LABEL_MAP = {
  none: '无',
  'tl-br': '左上到右下',
  'tr-bl': '右上到左下'
};

const VALIGN_LABEL_MAP = {
  top: '上',
  middle: '中',
  bottom: '下'
};

const TableCellFormatPopover = ({
  open,
  currentCellAttrs = {},
  onTextAlignChange,
  onVerticalAlignChange,
  onBackgroundColorChange,
  onTextColorChange,
  onDiagonalModeChange
}) => {
  if (!open) return null;

  return (
    <div className="sense-rich-table-dropdown sense-rich-table-dropdown-format" role="dialog" aria-label="单元格格式设置">
      <div className="sense-rich-table-popover-section">
        <strong>水平对齐</strong>
        <div className="sense-rich-table-option-row">
          {['left', 'center', 'right'].map((item) => (
            <button
              key={item}
              type="button"
              className={`sense-rich-table-chip ${String(currentCellAttrs.textAlign || 'left') === item ? 'active' : ''}`}
              onClick={() => onTextAlignChange(item)}
            >
              {ALIGN_LABEL_MAP[item]}
            </button>
          ))}
        </div>
      </div>
      <div className="sense-rich-table-popover-section">
        <strong>垂直对齐</strong>
        <div className="sense-rich-table-option-row">
          {TABLE_VERTICAL_ALIGN_OPTIONS.map((item) => (
            <button
              key={item}
              type="button"
              className={`sense-rich-table-chip ${String(currentCellAttrs.verticalAlign || 'top') === item ? 'active' : ''}`}
              onClick={() => onVerticalAlignChange(item)}
            >
              {VALIGN_LABEL_MAP[item]}
            </button>
          ))}
        </div>
      </div>
      <div className="sense-rich-table-popover-section">
        <strong>单元格底色</strong>
        <div className="sense-rich-color-grid">
          {TABLE_BACKGROUND_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className={`sense-color-swatch ${String(currentCellAttrs.backgroundColor || '').toLowerCase() === color.toLowerCase() ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => onBackgroundColorChange(color)}
            />
          ))}
        </div>
        <input
          type="color"
          aria-label="自定义单元格底色"
          value={currentCellAttrs.backgroundColor || '#ffffff'}
          onChange={(event) => onBackgroundColorChange(event.target.value)}
        />
      </div>
      <div className="sense-rich-table-popover-section">
        <strong>文字颜色</strong>
        <div className="sense-rich-color-grid">
          {TABLE_COLOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className={`sense-color-swatch ${String(currentCellAttrs.textColor || '').toLowerCase() === color.toLowerCase() ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => onTextColorChange(color)}
            />
          ))}
        </div>
        <input
          type="color"
          aria-label="自定义文字颜色"
          value={currentCellAttrs.textColor || '#0f172a'}
          onChange={(event) => onTextColorChange(event.target.value)}
        />
      </div>
      <div className="sense-rich-table-popover-section">
        <strong>斜线单元格</strong>
        <div className="sense-rich-table-option-column">
          {TABLE_DIAGONAL_MODES.map((item) => (
            <button
              key={item}
              type="button"
              className={`sense-rich-table-chip ${String(currentCellAttrs.diagonalMode || 'none') === item ? 'active' : ''}`}
              onClick={() => onDiagonalModeChange(item)}
            >
              {DIAGONAL_LABEL_MAP[item]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TableCellFormatPopover;
