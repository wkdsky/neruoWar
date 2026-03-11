import React from 'react';

const ToolbarGroup = ({ title = '', children, compact = false }) => (
  <div className={`sense-rich-toolbar-group${compact ? ' compact' : ''}`} role="group" aria-label={title || '编辑工具组'}>
    {title ? <span className="sense-rich-toolbar-group-title">{title}</span> : null}
    <div className="sense-rich-toolbar-group-body">{children}</div>
  </div>
);

export default ToolbarGroup;
