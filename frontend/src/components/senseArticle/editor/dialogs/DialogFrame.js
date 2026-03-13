import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { describeActiveElement, describeScrollPosition, senseEditorDebugLog } from '../editorDebug';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const resolveFocusTarget = (restoreFocusTarget, fallbackTarget) => {
  if (typeof restoreFocusTarget === 'function') {
    try {
      return restoreFocusTarget() || fallbackTarget;
    } catch (_error) {
      return fallbackTarget;
    }
  }
  if (restoreFocusTarget?.current) return restoreFocusTarget.current;
  return restoreFocusTarget || fallbackTarget;
};

const focusWithoutScroll = (target) => {
  if (!target?.focus) return;
  try {
    target.focus({ preventScroll: true });
  } catch (_error) {
    target.focus();
  }
};

const DialogFrame = ({
  open,
  title,
  description = '',
  onClose,
  children,
  footer = null,
  wide = false,
  restoreFocusOnClose = true,
  restoreFocusTarget = null,
  onAfterCloseFocus = null,
  autoFocusTarget = 'closeButton',
  portalTarget = null,
  dialogClassName = '',
  bodyClassName = ''
}) => {
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocusedElementRef = useRef(null);
  const titleIdRef = useRef(`sense-rich-dialog-title-${Math.random().toString(36).slice(2)}`);
  const descriptionIdRef = useRef(`sense-rich-dialog-description-${Math.random().toString(36).slice(2)}`);
  const latestOnCloseRef = useRef(onClose);
  const latestRestoreFocusOnCloseRef = useRef(restoreFocusOnClose);
  const latestRestoreFocusTargetRef = useRef(restoreFocusTarget);
  const latestAfterCloseFocusRef = useRef(onAfterCloseFocus);
  const latestTitleRef = useRef(title);

  useEffect(() => {
    latestOnCloseRef.current = onClose;
    latestRestoreFocusOnCloseRef.current = restoreFocusOnClose;
    latestRestoreFocusTargetRef.current = restoreFocusTarget;
    latestAfterCloseFocusRef.current = onAfterCloseFocus;
    latestTitleRef.current = title;
  }, [onAfterCloseFocus, onClose, restoreFocusOnClose, restoreFocusTarget, title]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusedElementRef.current = document.activeElement;
    const initialFocusTarget = autoFocusTarget === 'dialog'
      ? dialogRef.current
      : autoFocusTarget === 'none'
        ? null
        : closeButtonRef.current;
    if (initialFocusTarget) {
      focusWithoutScroll(initialFocusTarget);
    }
    senseEditorDebugLog('dialog-frame', 'Dialog opened', {
      title: latestTitleRef.current,
      autoFocusTarget,
      previousActiveElement: describeActiveElement(),
      scroll: describeScrollPosition()
    });
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        latestOnCloseRef.current && latestOnCloseRef.current();
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusableElements = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR));
        if (focusableElements.length === 0) return;
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          focusWithoutScroll(lastElement);
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          focusWithoutScroll(firstElement);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const shouldRestoreFocus = latestRestoreFocusOnCloseRef.current;
      senseEditorDebugLog('dialog-frame', 'Dialog cleanup start', {
        title: latestTitleRef.current,
        restoreFocusOnClose: shouldRestoreFocus,
        activeElementBeforeCleanup: describeActiveElement(),
        scrollBeforeCleanup: describeScrollPosition()
      });
      if (shouldRestoreFocus) {
        const nextFocusTarget = resolveFocusTarget(latestRestoreFocusTargetRef.current, previousFocusedElementRef.current);
        focusWithoutScroll(nextFocusTarget);
        senseEditorDebugLog('dialog-frame', 'Dialog restored focus on close', {
          title: latestTitleRef.current,
          nextFocusTargetTag: nextFocusTarget?.tagName || '',
          activeElementAfterRestore: describeActiveElement(),
          scrollAfterRestore: describeScrollPosition()
        });
      }
      if (typeof latestAfterCloseFocusRef.current === 'function') {
        latestAfterCloseFocusRef.current();
      }
    };
  }, [autoFocusTarget, open]);

  if (!open || typeof document === 'undefined') return null;

  const resolvedPortalTarget = portalTarget?.current || portalTarget || document.body;
  const dialogNode = (
    <div className="sense-rich-dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={`sense-rich-dialog${wide ? ' wide' : ''}${dialogClassName ? ` ${dialogClassName}` : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleIdRef.current}
        aria-describedby={description ? descriptionIdRef.current : undefined}
        tabIndex={-1}
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
        <div className={`sense-rich-dialog-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
        {footer ? <div className="sense-rich-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );

  if (!resolvedPortalTarget) return dialogNode;
  return createPortal(dialogNode, resolvedPortalTarget);
};

export default DialogFrame;
