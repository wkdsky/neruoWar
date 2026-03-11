const normalizeHeadingId = (rawId = '', index = 0) => {
  const normalized = String(rawId || '').trim();
  return normalized || `rich-heading-${index + 1}`;
};

const normalizeHeadingText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

export const extractRichHtmlOutline = (html = '') => {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const headings = Array.from(doc.body.querySelectorAll('h1, h2, h3, h4'));
  return headings
    .map((heading, index) => {
      const title = normalizeHeadingText(heading.textContent || '');
      if (!title) return null;
      return {
        headingId: normalizeHeadingId(heading.getAttribute('id') || '', index),
        level: Number.parseInt(heading.tagName.slice(1), 10) || 1,
        title
      };
    })
    .filter(Boolean);
};

export const buildFallbackRichBlocks = (html = '') => {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return [];
  const outline = extractRichHtmlOutline(html);
  const headingIdsByTitle = new Map(outline.map((item) => [item.title, item.headingId]));
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html || ''}</body>`, 'text/html');
  let currentHeadingId = '';
  return Array.from(doc.body.childNodes || [])
    .filter((node) => (node.nodeType === 3 ? String(node.textContent || '').trim() : node.nodeType === 1))
    .map((node, index) => {
      if (node.nodeType === 3) {
        return {
          id: `fallback-text-${index}`,
          type: 'paragraph',
          headingId: currentHeadingId,
          html: `<p>${node.textContent || ''}</p>`
        };
      }
      const tagName = String(node.tagName || '').toLowerCase();
      const isHeading = /^h[1-4]$/.test(tagName);
      if (isHeading) {
        const headingTitle = normalizeHeadingText(node.textContent || '');
        currentHeadingId = normalizeHeadingId(node.getAttribute('id') || headingIdsByTitle.get(headingTitle) || '', index);
      }
      return {
        id: `fallback-${tagName}-${index}`,
        type: isHeading ? 'heading' : tagName === 'hr' ? 'horizontal_rule' : 'paragraph',
        headingId: isHeading ? currentHeadingId : currentHeadingId,
        html: node.outerHTML || ''
      };
    });
};
