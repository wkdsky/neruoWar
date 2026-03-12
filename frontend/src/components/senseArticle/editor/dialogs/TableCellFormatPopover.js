import React from 'react';
import {
  AlignCenterVertical,
  CircleSlash2,
  GalleryVerticalEnd,
  SquareSlash,
  PanelTop
} from 'lucide-react';
import {
  TABLE_BACKGROUND_PALETTE,
  TABLE_COLOR_PALETTE,
  TABLE_DIAGONAL_MODES,
  TABLE_VERTICAL_ALIGN_OPTIONS
} from '../table/tableSchema';

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

const VALIGN_ICON_MAP = {
  top: PanelTop,
  middle: AlignCenterVertical,
  bottom: GalleryVerticalEnd
};

const DIAGONAL_ICON_MAP = {
  none: CircleSlash2,
  'tl-br': SquareSlash,
  'tr-bl': SquareSlash
};

const renderChipLabel = (Icon, label, extraClassName = '') => (
  <>
    <Icon size={14} className={`sense-rich-table-button-icon${extraClassName ? ` ${extraClassName}` : ''}`} />
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

const TableCellFormatPopover = ({
  open,
  currentCellAttrs = {},
  onVerticalAlignChange,
  onBackgroundColorChange,
  onTextColorChange,
  onDiagonalModeChange
}) => {
  if (!open) return null;

  return (
    <div className="sense-rich-table-dropdown sense-rich-table-dropdown-format" role="dialog" aria-label="单元格格式设置">
      <div className="sense-rich-table-popover-section">
        <strong>垂直对齐</strong>
        <div className="sense-rich-table-option-row">
          {TABLE_VERTICAL_ALIGN_OPTIONS.map((item) => (
            <button
              key={item}
              type="button"
              className={`sense-rich-table-chip ${String(currentCellAttrs.verticalAlign || 'top') === item ? 'active' : ''}`}
              onMouseDown={(event) => runActionOnMouseDown(event, () => onVerticalAlignChange(item))}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => runActionOnKeyDown(event, () => onVerticalAlignChange(item))}
            >
              {renderChipLabel(VALIGN_ICON_MAP[item], VALIGN_LABEL_MAP[item])}
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
              onMouseDown={(event) => runActionOnMouseDown(event, () => onBackgroundColorChange(color))}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => runActionOnKeyDown(event, () => onBackgroundColorChange(color))}
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
              onMouseDown={(event) => runActionOnMouseDown(event, () => onTextColorChange(color))}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => runActionOnKeyDown(event, () => onTextColorChange(color))}
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
              onMouseDown={(event) => runActionOnMouseDown(event, () => onDiagonalModeChange(item))}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => runActionOnKeyDown(event, () => onDiagonalModeChange(item))}
            >
              {renderChipLabel(DIAGONAL_ICON_MAP[item], DIAGONAL_LABEL_MAP[item], item === 'tr-bl' ? 'mirrored' : '')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TableCellFormatPopover;
