const MEDIA_TAGS = new Set(['img', 'audio', 'video', 'table', 'hr']);

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

export const isRichHtmlSemanticallyEmpty = (html = '') => !normalizeRichHtmlContent(html);
