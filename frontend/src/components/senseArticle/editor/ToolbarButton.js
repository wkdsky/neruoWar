import React from 'react';

const ToolbarButton = ({ active = false, disabled = false, title = '', ariaLabel = '', onClick, children, onMouseDown, ...rest }) => (
  <button
    type="button"
    className={`sense-rich-toolbar-button${active ? ' active' : ''}`}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel || title || undefined}
    aria-pressed={active}
    onMouseDown={(event) => {
      if (!disabled) event.preventDefault();
      if (typeof onMouseDown === 'function') onMouseDown(event);
    }}
    onClick={onClick}
    {...rest}
  >
    {children}
  </button>
);

export default ToolbarButton;
