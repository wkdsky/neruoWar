const MEDIA_TAGS = new Set(['img', 'audio', 'video', 'table', 'hr']);

const normalizeStyleText = (styleText = '') => {
  const source = String(styleText || '').trim();
  if (!source) return '';
  if (typeof document !== 'undefined') {
    const probe = document.createElement('div');
    probe.style.cssText = source;
    return Array.from(probe.style)
      .map((property) => String(property || '').trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .map((property) => `${property}:${String(probe.style.getPropertyValue(property) || '').trim().replace(/\s+/g, ' ')}`)
      .join(';');
  }
  return source
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const colonIndex = item.indexOf(':');
      if (colonIndex <= 0) return '';
      const property = item.slice(0, colonIndex).trim().toLowerCase();
      const value = item.slice(colonIndex + 1).trim().replace(/\s+/g, ' ');
      return property && value ? `${property}:${value}` : '';
    })
    .filter(Boolean)
    .sort()
    .join(';');
};

const normalizeClassText = (classText = '') => String(classText || '')
  .split(/\s+/)
  .map((item) => item.trim())
  .filter(Boolean)
  .sort()
  .join(' ');

const serializeCanonicalNode = (node) => {
  if (!node) return '';
  if (node.nodeType === 3) return String(node.textContent || '');
  if (node.nodeType !== 1) return '';

  const tagName = String(node.tagName || '').toLowerCase();
  const attrs = Array.from(node.attributes || [])
    .map((attribute) => {
      const name = String(attribute.name || '').trim().toLowerCase();
      if (!name) return null;
      let value = String(attribute.value || '').trim();
      if (name === 'style') value = normalizeStyleText(value);
      if (name === 'class') value = normalizeClassText(value);
      return value ? `${name}="${value}"` : name;
    })
    .filter(Boolean)
    .sort()
    .join(' ');
  const children = Array.from(node.childNodes || []).map((child) => serializeCanonicalNode(child)).join('');
  return `<${tagName}${attrs ? ` ${attrs}` : ''}>${children}</${tagName}>`;
};

const walkMeaningfulNodes = (container) => {
  const elements = Array.from(container.querySelectorAll('*'));
  return elements.some((element) => {
    const tagName = String(element.tagName || '').toLowerCase();
    if (MEDIA_TAGS.has(tagName)) return true;
    if (tagName === 'input' && element.getAttribute('type') === 'checkbox') return true;
    return false;
  });
};

export const normalizeRichHtmlContent = (html = '') => {
  const source = String(html || '').trim();
  if (!source) return '';
  if (typeof DOMParser === 'undefined') return source;
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${source}</body>`, 'text/html');
  const body = doc.body;
  const plainText = String(body.textContent || '').replace(/\u200b/g, '').trim();
  if (!plainText && !walkMeaningfulNodes(body)) return '';
  return body.innerHTML;
};

export const canonicalizeRichHtmlContent = (html = '') => {
  const normalized = normalizeRichHtmlContent(html || '');
  if (!normalized) return '';
  if (typeof DOMParser === 'undefined') return normalized;
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${normalized}</body>`, 'text/html');
  return Array.from(doc.body.childNodes || []).map((node) => serializeCanonicalNode(node)).join('');
};

export const areRichHtmlContentsEquivalent = (left = '', right = '') => (
  canonicalizeRichHtmlContent(left || '<p></p>') === canonicalizeRichHtmlContent(right || '<p></p>')
);

export const isRichHtmlSemanticallyEmpty = (html = '') => !normalizeRichHtmlContent(html);
