import React from 'react';

const SystemConfirmDialog = ({
  open = false,
  title = '请确认',
  message = '',
  confirmText = '确认',
  cancelText = '取消',
  confirmTone = 'danger',
  busy = false,
  onConfirm,
  onClose
}) => {
  if (!open) return null;

  const confirmButtonClassName = confirmTone === 'primary'
    ? 'btn btn-primary'
    : confirmTone === 'warning'
      ? 'btn btn-warning'
      : 'btn btn-danger';

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose && onClose()}>
      <div
        className="modal-content system-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="system-confirm-title">{title}</h3>
        </div>
        <div className="modal-body">
          <p className="system-confirm-message">{message}</p>
        </div>
        <div className="modal-footer system-confirm-actions">
          <button type="button" className="btn btn-secondary" onClick={() => onClose && onClose()} disabled={busy}>
            {cancelText}
          </button>
          <button type="button" className={confirmButtonClassName} onClick={() => onConfirm && onConfirm()} disabled={busy}>
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SystemConfirmDialog;
