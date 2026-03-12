export const isSenseEditorDebugEnabled = () => (
  process.env.NODE_ENV !== 'production'
  && typeof window !== 'undefined'
  && window.__SENSE_EDITOR_DEBUG__ === true
);

export const senseEditorDebugLog = (scope, message, payload = null) => {
  if (!isSenseEditorDebugEnabled()) return;
  if (payload == null) {
    console.debug(`[sense-editor:${scope}] ${message}`);
    return;
  }
  console.debug(`[sense-editor:${scope}] ${message}`, payload);
};

export const describeActiveElement = () => {
  if (typeof document === 'undefined') return 'n/a';
  const element = document.activeElement;
  if (!element) return 'none';
  const tagName = String(element.tagName || '').toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const className = typeof element.className === 'string'
    ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((item) => `.${item}`).join('')
    : '';
  const ariaLabel = element.getAttribute?.('aria-label') ? `[aria-label="${element.getAttribute('aria-label')}"]` : '';
  return `${tagName}${id}${className}${ariaLabel}`;
};

export const describeScrollPosition = () => ({
  x: typeof window !== 'undefined' ? window.scrollX : 0,
  y: typeof window !== 'undefined' ? window.scrollY : 0
});

export const describeEditorSelection = (editor) => {
  const selection = editor?.state?.selection;
  if (!selection) return { type: 'none', from: -1, to: -1, empty: true };
  return {
    type: selection.constructor?.name || 'UnknownSelection',
    from: Number(selection.from ?? -1),
    to: Number(selection.to ?? -1),
    empty: !!selection.empty
  };
};
