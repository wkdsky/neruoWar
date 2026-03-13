import { looksLikeMarkdown, markdownToRichHtml } from './markdownToRichContent';

const SAFE_INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'code', 'a', 'br']);
const SAFE_BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'blockquote', 'pre', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr']);

const escapeHtml = (value = '') => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const cleanHref = (href = '') => {
  const value = String(href || '').trim();
  if (/^https?:\/\//i.test(value) || value.startsWith('#') || value.startsWith('/uploads/sense-article-media/')) return value;
  return '';
};

const normalizeNode = (node, warnings) => {
  if (!node) return '';
  if (node.nodeType === 3) {
    return escapeHtml(node.textContent || '');
  }
  if (node.nodeType !== 1) return '';

  const tagName = String(node.tagName || '').toLowerCase();
  if (['script', 'style', 'meta', 'link', 'xml'].includes(tagName)) return '';
  if (tagName === 'img') {
    warnings.push('已忽略粘贴内容中的图片，请使用媒体上传入口插入图片。');
    return '';
  }

  const children = Array.from(node.childNodes || []).map((child) => normalizeNode(child, warnings)).join('');
  if (!children && !['hr', 'br'].includes(tagName)) return '';

  if (tagName === 'div' || tagName === 'span' || tagName === 'font') {
    return children;
  }

  if (tagName === 'a') {
    const href = cleanHref(node.getAttribute('href') || '');
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${children}</a>` : children;
  }

  if (tagName === 'b') return `<strong>${children}</strong>`;
  if (tagName === 'i') return `<em>${children}</em>`;

  if (SAFE_INLINE_TAGS.has(tagName) || SAFE_BLOCK_TAGS.has(tagName)) {
    return ['hr', 'br'].includes(tagName) ? `<${tagName} />` : `<${tagName}>${children}</${tagName}>`;
  }

  return children;
};

export const normalizePastedHtml = (html = '') => {
  const warnings = [];
  const source = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\sclass=("|')(Mso|Apple-|WordSection)[^"']*\1/gi, '')
    .replace(/\sstyle=("|')[^"']*\1/gi, '');
  if (!source.trim() || typeof DOMParser === 'undefined') {
    return { html: '', warnings };
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${source}</body>`, 'text/html');
  const normalized = Array.from(doc.body.childNodes || []).map((node) => normalizeNode(node, warnings)).join('').trim();
  return {
    html: normalized || '<p></p>',
    warnings: Array.from(new Set(warnings))
  };
};

export const normalizePastedText = (text = '') => {
  const source = String(text || '').replace(/\r\n/g, '\n');
  if (!source.trim()) {
    return { html: '', warnings: [] };
  }
  if (looksLikeMarkdown(source)) {
    return {
      html: markdownToRichHtml(source),
      warnings: ['已按 Markdown 结构导入粘贴内容。']
    };
  }
  return {
    html: '',
    warnings: []
  };
};
