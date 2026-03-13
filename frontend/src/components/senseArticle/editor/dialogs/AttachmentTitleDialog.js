import React, { useEffect, useRef, useState } from 'react';
import DialogFrame from './DialogFrame';

const AttachmentTitleDialog = ({
  open,
  initialTitle = '',
  mediaLabel = '附件',
  onClose,
  onSubmit,
  portalTarget = null
}) => {
  const [title, setTitle] = useState('');
  const lastOpenRef = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      lastOpenRef.current = false;
      return;
    }
    if (lastOpenRef.current) return;
    lastOpenRef.current = true;
    setTitle(String(initialTitle || '').trim());
  }, [initialTitle, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (!inputRef.current) return;
      try {
        inputRef.current.focus({ preventScroll: true });
      } catch (_error) {
        inputRef.current.focus();
      }
      inputRef.current.select?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  return (
    <DialogFrame
      open={open}
      title="编辑附件标题"
      description={`修改${mediaLabel}的标题部分；“附件n（类型）”前缀会自动维护。`}
      onClose={onClose}
      restoreFocusOnClose={false}
      autoFocusTarget="dialog"
      portalTarget={portalTarget}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => onSubmit(title.trim())}>保存</button>
        </>
      )}
    >
      <div className="sense-rich-form-grid">
        <label>
          <span>附件标题</span>
          <input
            ref={inputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              onSubmit(title.trim());
            }}
            placeholder="输入附件标题"
          />
        </label>
      </div>
    </DialogFrame>
  );
};

export default AttachmentTitleDialog;
