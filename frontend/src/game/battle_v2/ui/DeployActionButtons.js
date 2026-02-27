import React from 'react';

const ActionIcon = ({ type }) => {
  if (type === 'move') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l3 3h-2v4h4V8l3 3-3 3v-2h-4v4h2l-3 3-3-3h2v-4H7v2l-3-3 3-3v2h4V6H9z" />
      </svg>
    );
  }
  if (type === 'edit') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l10.06-10.06.92.92L5.92 19.58zM20.71 6.04a1 1 0 000-1.41L18.37 2.3a1 1 0 00-1.41 0l-1.13 1.13 3.75 3.75 1.13-1.14z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 6h10l-1 14H8L7 6zm3-3h4l1 2h4v2H5V5h4l1-2z" />
    </svg>
  );
};

const DeployActionButtons = ({
  layout = 'line',
  onMove,
  onEdit,
  onDelete
}) => (
  <div
    className={`pve2-deploy-actions pve2-deploy-actions-${layout}`}
    onMouseDown={(event) => event.stopPropagation()}
    onMouseUp={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => event.stopPropagation()}
  >
    <button
      type="button"
      className="pve2-icon-btn move"
      title="移动"
      aria-label="移动"
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (typeof onMove === 'function') onMove(event);
      }}
    >
      <ActionIcon type="move" />
    </button>
    <button
      type="button"
      className="pve2-icon-btn edit"
      title="编辑"
      aria-label="编辑"
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (typeof onEdit === 'function') onEdit(event);
      }}
    >
      <ActionIcon type="edit" />
    </button>
    <button
      type="button"
      className="pve2-icon-btn delete"
      title="删除"
      aria-label="删除"
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (typeof onDelete === 'function') onDelete(event);
      }}
    >
      <ActionIcon type="delete" />
    </button>
  </div>
);

export default DeployActionButtons;
