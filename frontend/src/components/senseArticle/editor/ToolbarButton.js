import React from 'react';

const ToolbarButton = ({ active = false, disabled = false, title = '', ariaLabel = '', onClick, children }) => (
  <button
    type="button"
    className={`sense-rich-toolbar-button${active ? ' active' : ''}`}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel || title || undefined}
    aria-pressed={active}
    onClick={onClick}
  >
    {children}
  </button>
);

export default ToolbarButton;
