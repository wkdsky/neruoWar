import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const DialogFrame = ({ open, title, description = '', onClose, children, footer = null, wide = false }) => {
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocusedElementRef = useRef(null);
  const titleIdRef = useRef(`sense-rich-dialog-title-${Math.random().toString(36).slice(2)}`);
  const descriptionIdRef = useRef(`sense-rich-dialog-description-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusedElementRef.current = document.activeElement;
    closeButtonRef.current?.focus?.();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose && onClose();
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusableElements = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR));
        if (focusableElements.length === 0) return;
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusedElementRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="sense-rich-dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={`sense-rich-dialog${wide ? ' wide' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleIdRef.current}
        aria-describedby={description ? descriptionIdRef.current : undefined}
      >
        <div className="sense-rich-dialog-header">
          <div className="sense-rich-dialog-header-copy">
            <strong id={titleIdRef.current}>{title}</strong>
            {description ? <span id={descriptionIdRef.current} className="sense-rich-dialog-description">{description}</span> : null}
          </div>
          <button ref={closeButtonRef} type="button" className="sense-rich-dialog-close" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="sense-rich-dialog-body">{children}</div>
        {footer ? <div className="sense-rich-dialog-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
};

export default DialogFrame;
