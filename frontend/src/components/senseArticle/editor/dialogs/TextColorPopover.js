import React from 'react';

const preventFocusSteal = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

const TextColorPopover = ({
  open,
  textColor,
  highlightColor,
  onTextColorChange,
  onHighlightColorChange,
  onClearTextColor,
  onClearHighlight
}) => {
  if (!open) return null;

  return (
    <div className="sense-rich-color-popover" role="dialog" aria-label="文字颜色与高亮设置">
      <label>
        <span>文字颜色</span>
        <input
          type="color"
          value={textColor || '#0f172a'}
          onChange={(event) => onTextColorChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn btn-small btn-secondary"
        onMouseDown={preventFocusSteal}
        onClick={onClearTextColor}
      >
        清除文字颜色
      </button>
      <label>
        <span>高亮颜色</span>
        <input
          type="color"
          value={highlightColor || '#facc15'}
          onChange={(event) => onHighlightColorChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn btn-small btn-secondary"
        onMouseDown={preventFocusSteal}
        onClick={onClearHighlight}
      >
        清除高亮
      </button>
    </div>
  );
};

export default TextColorPopover;
