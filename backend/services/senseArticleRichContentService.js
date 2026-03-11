const sanitizeHtml = require('sanitize-html');
const { parse } = require('node-html-parser');
const { AST_NODE_TYPES } = require('../constants/senseArticle');
const { shortHash } = require('../utils/hash');
const { parseSenseArticleSource, extractPlainText } = require('./senseArticleParser');
const {
  buildTableCompareDigest,
  extractTableMetaFromElement,
  normalizeBorderEdges,
  normalizeColor,
  normalizeEnum,
  normalizeTableWidthValue,
  parseColumnWidths,
  serializeColumnWidths,
  TABLE_BORDER_PRESETS,
  TABLE_BORDER_WIDTH_OPTIONS,
  TABLE_DIAGONAL_MODES,
  TABLE_STYLE_OPTIONS,
  TABLE_VERTICAL_ALIGN_OPTIONS,
  TABLE_WIDTH_MODES
} = require('./senseArticleTableMetaService');

const CONTENT_FORMATS = Object.freeze({
  LEGACY_MARKUP: 'legacy_markup',
  RICH_HTML: 'rich_html'
});

const SAFE_IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i;
const SAFE_AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
const SAFE_VIDEO_EXTENSIONS = /\.(mp4|webm|ogg|mov)$/i;
const SAFE_COLOR_PATTERNS = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgb(a)?\([\d\s.,%]+\)$/i,
  /^hsl(a)?\([\d\s.,%]+\)$/i
];
const SAFE_MEDIA_PATH_PREFIX = '/uploads/sense-article-media/';

const escapeHtml = (value = '') => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const isSafeHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || '').trim());
const isSafeRelativeMediaUrl = (value = '') => String(value || '').trim().startsWith(SAFE_MEDIA_PATH_PREFIX);
const isSafeHashUrl = (value = '') => String(value || '').trim().startsWith('#');
const isSafeUrl = (value = '', { allowHash = false, mediaOnly = false } = {}) => {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (allowHash && isSafeHashUrl(normalized)) return true;
  if (isSafeRelativeMediaUrl(normalized)) return true;
  if (isSafeHttpUrl(normalized)) return true;
  if (!mediaOnly && normalized.startsWith('/')) return true;
  return false;
};

const isAllowedColor = (value = '') => SAFE_COLOR_PATTERNS.some((pattern) => pattern.test(String(value || '').trim()));

const filterAllowedStyle = (styleText = '') => {
  const result = {};
  String(styleText || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const colonIndex = item.indexOf(':');
      if (colonIndex <= 0) return;
      const property = item.slice(0, colonIndex).trim().toLowerCase();
      const value = item.slice(colonIndex + 1).trim();
      if (!value) return;
      if (property === 'color' && isAllowedColor(value)) result.color = value;
      if (property === 'background-color' && isAllowedColor(value)) result['background-color'] = value;
      if (property === 'text-align' && /^(left|center|right|justify)$/i.test(value)) result['text-align'] = value.toLowerCase();
      if (property === 'vertical-align' && /^(top|middle|bottom)$/i.test(value)) result['vertical-align'] = value.toLowerCase();
      if (property === 'font-size' && /^(12|14|16|18|24|32)px$/i.test(value)) result['font-size'] = value.toLowerCase();
      if (property === 'list-style-type' && /^(disc|circle|square|decimal|decimal-leading-zero|lower-alpha|lower-roman)$/i.test(value)) {
        result['list-style-type'] = value.toLowerCase();
      }
      if (property === 'width' && (/^(25|50|60|72|75|88|100)%$/i.test(value) || /^([4-9]\d|1[01]\d|1200)px$/i.test(value))) {
        result.width = value.toLowerCase();
      }
      if (/^border-(top|right|bottom|left)$/.test(property) && /^(none|[123]px\s+solid\s+(#[0-9a-f]{3,8}|rgb(a)?\([\d\s.,%]+\)|hsl(a)?\([\d\s.,%]+\)))$/i.test(value)) {
        result[property] = value;
      }
    });
  return Object.entries(result).map(([property, value]) => `${property}: ${value}`).join('; ');
};

const normalizeClassNames = (classText = '', allowed = []) => {
  const allowSet = new Set(allowed);
  return String(classText || '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => allowSet.has(item))
    .join(' ');
};

const sanitizeAnchor = (attribs = {}) => {
  const isInternal = attribs['data-reference-kind'] === 'internal-sense';
  const href = String(attribs.href || '').trim();
  const next = { ...attribs };
  delete next.onclick;
  delete next.onmouseover;
  delete next.onmouseenter;
  if (isInternal) {
    const nodeId = String(attribs['data-node-id'] || '').trim();
    const senseId = String(attribs['data-sense-id'] || '').trim();
    if (!nodeId || !senseId) {
      delete next.href;
      delete next['data-node-id'];
      delete next['data-sense-id'];
      return next;
    }
    next.href = isSafeUrl(href, { allowHash: true }) ? href : `#sense-ref-${nodeId}-${senseId}`;
    next.rel = 'nofollow noopener noreferrer';
    return next;
  }
  if (!isSafeUrl(href)) {
    delete next.href;
    delete next.target;
    delete next.rel;
    return next;
  }
  if (next.target === '_blank') {
    next.rel = 'noopener noreferrer nofollow';
  } else {
    delete next.target;
    delete next.rel;
  }
  return next;
};

const sanitizeMediaAttribs = (attribs = {}, { kind = 'image' } = {}) => {
  const next = { ...attribs };
  const src = String(next.src || '').trim();
  const poster = String(next.poster || '').trim();
  if (src && !isSafeUrl(src, { mediaOnly: true })) delete next.src;
  if (kind === 'video' && poster && !isSafeUrl(poster, { mediaOnly: true })) delete next.poster;
  if (kind === 'image' && next.width && !/^(25|50|75|100)%$/.test(String(next.width))) delete next.width;
  if (kind === 'video' && next.width && !/^(50|75|100)%$/.test(String(next.width))) delete next.width;
  if (kind === 'audio') {
    next.controls = 'controls';
    delete next.autoplay;
  }
  if (kind === 'video') {
    next.controls = 'controls';
    delete next.autoplay;
  }
  if (kind === 'image') {
    delete next.loading;
  }
  delete next.style;
  delete next.onloadeddata;
  delete next.onerror;
  delete next.src;
  delete next.poster;
  if (src) next.src = src;
  if (kind === 'video' && poster) next.poster = poster;
  return next;
};

const sanitizeRichHtml = (html = '') => sanitizeHtml(String(html || ''), {
  allowedTags: [
    'a', 'audio', 'blockquote', 'br', 'code', 'div', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4',
    'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 's', 'source', 'span', 'strong', 'table', 'tbody', 'td',
    'thead', 'th', 'tr', 'u', 'ul', 'video'
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'class', 'style', 'data-reference-kind', 'data-node-id', 'data-sense-id', 'data-display-text', 'data-reference-id'],
    audio: ['src', 'controls', 'class', 'data-title', 'data-description'],
    blockquote: ['class', 'style', 'data-indent'],
    code: ['class'],
    div: ['class', 'data-node-type', 'data-align'],
    figure: ['class', 'data-node-type', 'data-align', 'data-width'],
    figcaption: ['class'],
    h1: ['id', 'class', 'style', 'data-indent'],
    h2: ['id', 'class', 'style', 'data-indent'],
    h3: ['id', 'class', 'style', 'data-indent'],
    h4: ['id', 'class', 'style', 'data-indent'],
    img: ['src', 'alt', 'width', 'class', 'data-align'],
    input: ['type', 'checked', 'disabled'],
    li: ['class', 'style', 'data-checked'],
    ol: ['class', 'style', 'data-list-style-type'],
    p: ['class', 'style', 'data-indent'],
    pre: ['class'],
    source: ['src', 'type'],
    span: ['class', 'style', 'data-formula-placeholder', 'data-font-size', 'data-highlight'],
    strong: ['class'],
    table: ['class', 'style', 'data-table-style', 'data-table-width-mode', 'data-table-width-value', 'data-table-border-preset', 'data-column-widths'],
    td: ['class', 'style', 'colspan', 'rowspan', 'data-align', 'data-vertical-align', 'data-background-color', 'data-text-color', 'data-border-edges', 'data-border-width', 'data-border-color', 'data-diagonal', 'data-colwidth'],
    th: ['class', 'style', 'colspan', 'rowspan', 'data-align', 'data-vertical-align', 'data-background-color', 'data-text-color', 'data-border-edges', 'data-border-width', 'data-border-color', 'data-diagonal', 'data-colwidth'],
    tr: ['class'],
    ul: ['class', 'style', 'data-list-style-type'],
    video: ['src', 'poster', 'controls', 'class', 'width']
  },
  allowedClasses: {
    a: ['sense-rich-link', 'sense-internal-reference'],
    blockquote: ['sense-rich-blockquote'],
    code: ['language-text'],
    figure: ['sense-rich-figure', 'align-left', 'align-center', 'align-right', 'size-25', 'size-50', 'size-75', 'size-100'],
    figcaption: ['sense-rich-caption'],
    h1: ['align-left', 'align-center', 'align-right', 'align-justify'],
    h2: ['align-left', 'align-center', 'align-right', 'align-justify'],
    h3: ['align-left', 'align-center', 'align-right', 'align-justify'],
    h4: ['align-left', 'align-center', 'align-right', 'align-justify'],
    img: ['align-left', 'align-center', 'align-right'],
    li: ['task-item'],
    ol: ['list-style-decimal', 'list-style-leading-zero', 'list-style-lower-alpha', 'list-style-lower-roman'],
    p: ['align-left', 'align-center', 'align-right', 'align-justify'],
    span: ['sense-inline-code', 'sense-formula-placeholder', 'has-highlight'],
    table: ['sense-rich-table', 'table-style-default', 'table-style-compact', 'table-style-zebra', 'table-style-three-line', 'table-border-all', 'table-border-none', 'table-border-outer', 'table-border-inner-horizontal', 'table-border-inner-vertical', 'table-border-three-line'],
    td: ['align-left', 'align-center', 'align-right', 'align-justify', 'table-cell-valign-middle', 'table-cell-valign-bottom', 'table-cell-diagonal-tl-br', 'table-cell-diagonal-tr-bl'],
    th: ['align-left', 'align-center', 'align-right', 'align-justify', 'table-cell-valign-middle', 'table-cell-valign-bottom', 'table-cell-diagonal-tl-br', 'table-cell-diagonal-tr-bl'],
    ul: ['list-style-disc', 'list-style-circle', 'list-style-square'],
    video: ['size-50', 'size-75', 'size-100']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  selfClosing: ['img', 'br', 'hr', 'source', 'input'],
  transformTags: {
    a: (_tagName, attribs) => ({ tagName: 'a', attribs: sanitizeAnchor(attribs) }),
    img: (_tagName, attribs) => ({ tagName: 'img', attribs: sanitizeMediaAttribs(attribs, { kind: 'image' }) }),
    audio: (_tagName, attribs) => ({ tagName: 'audio', attribs: sanitizeMediaAttribs(attribs, { kind: 'audio' }) }),
    video: (_tagName, attribs) => ({ tagName: 'video', attribs: sanitizeMediaAttribs(attribs, { kind: 'video' }) }),
    source: (_tagName, attribs) => ({
      tagName: 'source',
      attribs: isSafeUrl(attribs.src, { mediaOnly: true }) ? { src: attribs.src, type: attribs.type || '' } : {}
    }),
    span: (_tagName, attribs) => ({
      tagName: 'span',
      attribs: {
        ...attribs,
        class: normalizeClassNames(attribs.class, ['sense-inline-code', 'sense-formula-placeholder', 'has-highlight']),
        style: filterAllowedStyle(attribs.style)
      }
    }),
    p: (_tagName, attribs) => ({
      tagName: 'p',
      attribs: {
        ...attribs,
        class: normalizeClassNames(attribs.class, ['align-left', 'align-center', 'align-right', 'align-justify']),
        style: filterAllowedStyle(attribs.style)
      }
    }),
    h1: (_tagName, attribs) => ({ tagName: 'h1', attribs: { ...attribs, class: normalizeClassNames(attribs.class, ['align-left', 'align-center', 'align-right', 'align-justify']), style: filterAllowedStyle(attribs.style) } }),
    h2: (_tagName, attribs) => ({ tagName: 'h2', attribs: { ...attribs, class: normalizeClassNames(attribs.class, ['align-left', 'align-center', 'align-right', 'align-justify']), style: filterAllowedStyle(attribs.style) } }),
    h3: (_tagName, attribs) => ({ tagName: 'h3', attribs: { ...attribs, class: normalizeClassNames(attribs.class, ['align-left', 'align-center', 'align-right', 'align-justify']), style: filterAllowedStyle(attribs.style) } }),
    h4: (_tagName, attribs) => ({ tagName: 'h4', attribs: { ...attribs, class: normalizeClassNames(attribs.class, ['align-left', 'align-center', 'align-right', 'align-justify']), style: filterAllowedStyle(attribs.style) } }),
    ul: (_tagName, attribs) => ({ tagName: 'ul', attribs: { ...attribs, class: normalizeClassNames(attribs.class, ['list-style-disc', 'list-style-circle', 'list-style-square']), style: filterAllowedStyle(attribs.style) } }),
    ol: (_tagName, attribs) => ({ tagName: 'ol', attribs: { ...attribs, class: normalizeClassNames(attribs.class, ['list-style-decimal', 'list-style-leading-zero', 'list-style-lower-alpha', 'list-style-lower-roman']), style: filterAllowedStyle(attribs.style) } }),
    li: (_tagName, attribs) => ({ tagName: 'li', attribs: { ...attribs, class: normalizeClassNames(attribs.class, ['task-item']), style: filterAllowedStyle(attribs.style) } }),
    td: (_tagName, attribs) => ({
      tagName: 'td',
      attribs: {
        ...attribs,
        class: normalizeClassNames(attribs.class, ['align-left', 'align-center', 'align-right', 'align-justify', 'table-cell-valign-middle', 'table-cell-valign-bottom', 'table-cell-diagonal-tl-br', 'table-cell-diagonal-tr-bl']),
        style: filterAllowedStyle(attribs.style),
        'data-vertical-align': normalizeEnum(attribs['data-vertical-align'], TABLE_VERTICAL_ALIGN_OPTIONS, '') || undefined,
        'data-background-color': normalizeColor(attribs['data-background-color']) || undefined,
        'data-text-color': normalizeColor(attribs['data-text-color']) || undefined,
        'data-border-edges': normalizeBorderEdges(attribs['data-border-edges']) || undefined,
        'data-border-width': normalizeEnum(attribs['data-border-width'], TABLE_BORDER_WIDTH_OPTIONS, '') || undefined,
        'data-border-color': normalizeColor(attribs['data-border-color']) || undefined,
        'data-diagonal': normalizeEnum(attribs['data-diagonal'], TABLE_DIAGONAL_MODES, '') || undefined,
        'data-colwidth': serializeColumnWidths(parseColumnWidths(attribs['data-colwidth'])) || undefined
      }
    }),
    th: (_tagName, attribs) => ({
      tagName: 'th',
      attribs: {
        ...attribs,
        class: normalizeClassNames(attribs.class, ['align-left', 'align-center', 'align-right', 'align-justify', 'table-cell-valign-middle', 'table-cell-valign-bottom', 'table-cell-diagonal-tl-br', 'table-cell-diagonal-tr-bl']),
        style: filterAllowedStyle(attribs.style),
        'data-vertical-align': normalizeEnum(attribs['data-vertical-align'], TABLE_VERTICAL_ALIGN_OPTIONS, '') || undefined,
        'data-background-color': normalizeColor(attribs['data-background-color']) || undefined,
        'data-text-color': normalizeColor(attribs['data-text-color']) || undefined,
        'data-border-edges': normalizeBorderEdges(attribs['data-border-edges']) || undefined,
        'data-border-width': normalizeEnum(attribs['data-border-width'], TABLE_BORDER_WIDTH_OPTIONS, '') || undefined,
        'data-border-color': normalizeColor(attribs['data-border-color']) || undefined,
        'data-diagonal': normalizeEnum(attribs['data-diagonal'], TABLE_DIAGONAL_MODES, '') || undefined,
        'data-colwidth': serializeColumnWidths(parseColumnWidths(attribs['data-colwidth'])) || undefined
      }
    }),
    table: (_tagName, attribs) => ({
      tagName: 'table',
      attribs: {
        ...attribs,
        class: normalizeClassNames(attribs.class, ['sense-rich-table', 'table-style-default', 'table-style-compact', 'table-style-zebra', 'table-style-three-line', 'table-border-all', 'table-border-none', 'table-border-outer', 'table-border-inner-horizontal', 'table-border-inner-vertical', 'table-border-three-line']),
        style: filterAllowedStyle(attribs.style),
        'data-table-style': normalizeEnum(attribs['data-table-style'], TABLE_STYLE_OPTIONS, 'default'),
        'data-table-width-mode': normalizeEnum(attribs['data-table-width-mode'], TABLE_WIDTH_MODES, 'auto'),
        'data-table-width-value': normalizeTableWidthValue(attribs['data-table-width-value'] || '100'),
        'data-table-border-preset': normalizeEnum(attribs['data-table-border-preset'], TABLE_BORDER_PRESETS, 'all'),
        'data-column-widths': serializeColumnWidths(parseColumnWidths(attribs['data-column-widths'])) || undefined
      }
    }),
    figure: (_tagName, attribs) => ({
      tagName: 'figure',
      attribs: {
        ...attribs,
        class: normalizeClassNames(attribs.class, ['sense-rich-figure', 'align-left', 'align-center', 'align-right', 'size-25', 'size-50', 'size-75', 'size-100'])
      }
    })
  }
});

const createSlug = (text = '', used = new Map()) => {
  const normalized = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
  const count = used.get(normalized) || 0;
  used.set(normalized, count + 1);
  return count > 0 ? `${normalized}-${count + 1}` : normalized;
};

const finalizeHeadingRanges = (headingIndex = [], totalBlocks = 0) => headingIndex.map((heading, index) => {
  let lineEnd = Math.max(0, totalBlocks - 1);
  for (let cursor = index + 1; cursor < headingIndex.length; cursor += 1) {
    if ((headingIndex[cursor].level || 1) <= (heading.level || 1)) {
      lineEnd = Math.max(heading.lineStart || 0, (headingIndex[cursor].lineStart || 0) - 1);
      break;
    }
  }
  return {
    ...heading,
    lineEnd
  };
});

const collectReferenceEntries = ({ element = null, blockId = '', headingId = '' }) => {
  if (!element?.querySelectorAll) return [];
  return element.querySelectorAll('a').map((anchor, index) => {
    const nodeId = String(anchor.getAttribute('data-node-id') || '').trim();
    const senseId = String(anchor.getAttribute('data-sense-id') || '').trim();
    if (anchor.getAttribute('data-reference-kind') !== 'internal-sense' || !nodeId || !senseId) return null;
    const displayText = anchor.text.trim() || String(anchor.getAttribute('data-display-text') || '').trim() || `${nodeId}:${senseId}`;
    return {
      referenceId: String(anchor.getAttribute('data-reference-id') || `ref_${shortHash(`${blockId}:${nodeId}:${senseId}:${index}`, 16)}`).trim(),
      targetNodeId: nodeId,
      targetSenseId: senseId,
      displayText,
      headingId,
      blockId,
      isValid: false,
      targetTitle: '',
      targetNodeName: '',
      position: index
    };
  }).filter(Boolean);
};

const collectFormulaRefs = ({ element = null, blockId = '', headingId = '' }) => {
  if (!element?.querySelectorAll) return [];
  return element.querySelectorAll('[data-formula-placeholder]').map((node, index) => ({
    formula: node.text.trim(),
    headingId,
    blockId,
    line: index + 1
  })).filter((item) => !!item.formula);
};

const buildListItems = (element) => element.querySelectorAll(':scope > li').map((item, index) => ({
  id: `item_${shortHash(`${item.text}:${index}`, 12)}`,
  type: AST_NODE_TYPES.LIST_ITEM,
  plainText: item.text.trim(),
  html: item.toString()
}));

const buildMediaBlockType = (element) => {
  if (element.querySelector('img')) return 'image';
  if (element.querySelector('audio')) return 'audio';
  if (element.querySelector('video')) return 'video';
  return 'media';
};

const shouldKeepNode = (node) => {
  if (!node) return false;
  if (node.nodeType === 3) return String(node.rawText || '').trim().length > 0;
  if (node.nodeType !== 1) return false;
  const tagName = String(node.tagName || '').toLowerCase();
  return ['h1', 'h2', 'h3', 'h4', 'p', 'blockquote', 'pre', 'ul', 'ol', 'table', 'figure', 'hr', 'div'].includes(tagName);
};

const materializeRichHtmlContent = (html = '') => {
  const sanitizedHtml = sanitizeRichHtml(html);
  const root = parse(`<div class="sense-rich-root">${sanitizedHtml}</div>`, {
    lowerCaseTagName: false,
    blockTextElements: {
      script: false,
      style: false,
      pre: true
    }
  });
  const container = root.querySelector('.sense-rich-root');
  const blocks = [];
  const headingIndex = [];
  const referenceIndex = [];
  const formulaRefs = [];
  const usedHeadingIds = new Map();
  let currentHeadingId = '';

  (container?.childNodes || [])
    .filter(shouldKeepNode)
    .forEach((node, index) => {
      if (node.nodeType === 3) {
        const text = String(node.rawText || '').trim();
        if (!text) return;
        blocks.push({
          id: `paragraph_${shortHash(`text:${index}:${text}`, 12)}`,
          type: AST_NODE_TYPES.PARAGRAPH,
          headingId: currentHeadingId,
          plainText: text,
          html: `<p>${escapeHtml(text)}</p>`
        });
        return;
      }
      const tagName = String(node.tagName || '').toLowerCase();
      const plainText = node.text.trim();
      const blockId = `${tagName}_${shortHash(`${tagName}:${index}:${plainText}`, 12)}`;
      const blockHtml = node.toString();
      const blockRefs = collectReferenceEntries({ element: node, blockId, headingId: currentHeadingId });
      const blockFormulaRefs = collectFormulaRefs({ element: node, blockId, headingId: currentHeadingId });
      referenceIndex.push(...blockRefs);
      formulaRefs.push(...blockFormulaRefs);

      if (/^h[1-4]$/.test(tagName)) {
        const level = Number(tagName.slice(1));
        const headingId = createSlug(node.text.trim() || `section-${index + 1}`, usedHeadingIds);
        currentHeadingId = headingId;
        blocks.push({
          id: blockId,
          type: AST_NODE_TYPES.HEADING,
          level,
          headingId,
          plainText,
          html: blockHtml
        });
        headingIndex.push({
          headingId,
          level,
          title: plainText,
          blockId,
          lineStart: blocks.length - 1
        });
        return;
      }

      if (tagName === 'pre') {
        blocks.push({
          id: blockId,
          type: AST_NODE_TYPES.CODE_BLOCK,
          headingId: currentHeadingId,
          language: '',
          value: node.text,
          plainText: node.text,
          html: blockHtml
        });
        return;
      }

      if (tagName === 'blockquote') {
        blocks.push({
          id: blockId,
          type: AST_NODE_TYPES.BLOCKQUOTE,
          headingId: currentHeadingId,
          plainText,
          lines: node.querySelectorAll('p').map((line, lineIndex) => ({
            id: `${blockId}_line_${lineIndex + 1}`,
            plainText: line.text.trim(),
            html: line.toString()
          })),
          html: blockHtml
        });
        return;
      }

      if (tagName === 'ul' || tagName === 'ol') {
        blocks.push({
          id: blockId,
          type: AST_NODE_TYPES.LIST,
          headingId: currentHeadingId,
          ordered: tagName === 'ol',
          listStyleType: node.getAttribute('data-list-style-type') || '',
          plainText,
          items: buildListItems(node),
          html: blockHtml
        });
        return;
      }

      if (tagName === 'table') {
        const tableMeta = extractTableMetaFromElement(node);
        blocks.push({
          id: blockId,
          type: 'table',
          headingId: currentHeadingId,
          plainText,
          tableStyle: tableMeta.tableStyle,
          tableWidthMode: tableMeta.tableWidthMode,
          tableWidthValue: tableMeta.tableWidthValue,
          tableBorderPreset: tableMeta.tableBorderPreset,
          columnWidths: tableMeta.columnWidths,
          headerSummary: tableMeta.headerSummary,
          mergeSummary: tableMeta.mergeSummary,
          cellFormatSummary: tableMeta.cellFormatSummary,
          diagonalCellCount: tableMeta.diagonalCellCount,
          tableMetaDigest: buildTableCompareDigest(tableMeta),
          rows: tableMeta.rows.map((row, rowIndex) => ({
            id: `${blockId}_row_${rowIndex + 1}`,
            cells: row.cells
          })),
          html: blockHtml
        });
        return;
      }

      if (tagName === 'figure') {
        blocks.push({
          id: blockId,
          type: buildMediaBlockType(node),
          headingId: currentHeadingId,
          plainText,
          html: blockHtml
        });
        return;
      }

      if (tagName === 'hr') {
        blocks.push({
          id: blockId,
          type: 'horizontal_rule',
          headingId: currentHeadingId,
          plainText: '',
          html: '<hr />'
        });
        return;
      }

      blocks.push({
        id: blockId,
        type: AST_NODE_TYPES.PARAGRAPH,
        headingId: currentHeadingId,
        plainText,
        html: tagName === 'div' ? `<p>${node.innerHTML}</p>` : blockHtml
      });
    });

  const finalizedHeadingIndex = finalizeHeadingRanges(headingIndex, blocks.length);
  const hasMeaningfulBlocks = blocks.some((block) => {
    if (!block) return false;
    if (['image', 'audio', 'video', 'table', 'horizontal_rule'].includes(block.type)) return true;
    return String(block.plainText || '').trim().length > 0;
  });
  const normalizedBlocks = hasMeaningfulBlocks
    ? blocks
    : blocks.filter((block) => ['image', 'audio', 'video', 'table', 'horizontal_rule'].includes(block?.type) || String(block?.plainText || '').trim());
  const plainTextSnapshot = normalizedBlocks.map((block) => String(block.plainText || '')).filter(Boolean).join('\n\n').trim();
  const normalizedHtml = hasMeaningfulBlocks ? sanitizedHtml : '';

  return {
    contentFormat: CONTENT_FORMATS.RICH_HTML,
    editorSource: normalizedHtml,
    ast: {
      type: AST_NODE_TYPES.DOCUMENT,
      contractVersion: 3,
      contentFormat: CONTENT_FORMATS.RICH_HTML,
      blocks: normalizedBlocks
    },
    headingIndex: finalizedHeadingIndex,
    referenceIndex,
    formulaRefs,
    symbolRefs: [],
    parseErrors: [],
    plainTextSnapshot,
    renderSnapshot: {
      type: AST_NODE_TYPES.DOCUMENT,
      contractVersion: 3,
      contentFormat: CONTENT_FORMATS.RICH_HTML,
      html: normalizedHtml
    }
  };
};

const renderInlineNodeToRichHtml = (node = {}) => {
  if (!node || typeof node !== 'object') return '';
  if (node.type === AST_NODE_TYPES.TEXT) return escapeHtml(node.value || '');
  if (node.type === AST_NODE_TYPES.STRONG) return `<strong>${(node.children || []).map(renderInlineNodeToRichHtml).join('')}</strong>`;
  if (node.type === AST_NODE_TYPES.EMPHASIS) return `<em>${(node.children || []).map(renderInlineNodeToRichHtml).join('')}</em>`;
  if (node.type === AST_NODE_TYPES.CODE_INLINE) return `<code>${escapeHtml(node.value || '')}</code>`;
  if (node.type === AST_NODE_TYPES.FORMULA_INLINE) return `<span class="sense-formula-placeholder" data-formula-placeholder="true">${escapeHtml(node.value || '')}</span>`;
  if (node.type === AST_NODE_TYPES.SYMBOL) return escapeHtml(node.value || '');
  if (node.type === AST_NODE_TYPES.SENSE_REFERENCE) {
    const href = `#sense-ref-${escapeHtml(node.targetNodeId || '')}-${escapeHtml(node.targetSenseId || '')}`;
    return `<a class="sense-internal-reference" href="${href}" data-reference-kind="internal-sense" data-node-id="${escapeHtml(node.targetNodeId || '')}" data-sense-id="${escapeHtml(node.targetSenseId || '')}" data-display-text="${escapeHtml(node.displayText || '')}">${escapeHtml(node.displayText || `${node.targetNodeId || ''}:${node.targetSenseId || ''}`)}</a>`;
  }
  if (Array.isArray(node.children)) return node.children.map(renderInlineNodeToRichHtml).join('');
  return escapeHtml(node.value || '');
};

const renderLegacyBlockToRichHtml = (block = {}) => {
  if (!block || typeof block !== 'object') return '';
  if (block.type === AST_NODE_TYPES.HEADING) {
    const level = Math.max(1, Math.min(4, Number(block.level) || 1));
    return `<h${level}>${(block.children || []).map(renderInlineNodeToRichHtml).join('')}</h${level}>`;
  }
  if (block.type === AST_NODE_TYPES.PARAGRAPH) {
    return `<p>${(block.children || []).map(renderInlineNodeToRichHtml).join('')}</p>`;
  }
  if (block.type === AST_NODE_TYPES.LIST) {
    const tag = block.ordered ? 'ol' : 'ul';
    return `<${tag}>${(block.items || []).map((item) => `<li>${(item.children || []).map(renderInlineNodeToRichHtml).join('')}</li>`).join('')}</${tag}>`;
  }
  if (block.type === AST_NODE_TYPES.BLOCKQUOTE) {
    return `<blockquote>${(block.lines || []).map((line) => `<p>${(line.children || []).map(renderInlineNodeToRichHtml).join('')}</p>`).join('')}</blockquote>`;
  }
  if (block.type === AST_NODE_TYPES.CODE_BLOCK) {
    return `<pre><code>${escapeHtml(block.value || '')}</code></pre>`;
  }
  if (block.type === AST_NODE_TYPES.FORMULA_BLOCK) {
    return `<pre><code>${escapeHtml(block.value || '')}</code></pre>`;
  }
  return '';
};

const convertLegacyMarkupToRichHtml = (legacyMarkup = '') => {
  const parsed = parseSenseArticleSource(legacyMarkup);
  return (Array.isArray(parsed?.ast?.blocks) ? parsed.ast.blocks : [])
    .map(renderLegacyBlockToRichHtml)
    .filter(Boolean)
    .join('');
};

const detectContentFormat = ({ contentFormat = '', editorSource = '' } = {}) => {
  if (contentFormat === CONTENT_FORMATS.RICH_HTML) return CONTENT_FORMATS.RICH_HTML;
  if (contentFormat === CONTENT_FORMATS.LEGACY_MARKUP) return CONTENT_FORMATS.LEGACY_MARKUP;
  const source = String(editorSource || '').trim();
  if (!source) return CONTENT_FORMATS.RICH_HTML;
  if (/^\s*</.test(source) && /<\/?[a-z][^>]*>/i.test(source)) return CONTENT_FORMATS.RICH_HTML;
  return CONTENT_FORMATS.LEGACY_MARKUP;
};

const normalizeEditorSourceByFormat = ({ editorSource = '', contentFormat = CONTENT_FORMATS.LEGACY_MARKUP } = {}) => {
  if (contentFormat === CONTENT_FORMATS.RICH_HTML) return String(editorSource || '');
  return String(editorSource || '').replace(/\r\n/g, '\n');
};

const materializeRevisionContent = ({ editorSource = '', contentFormat = CONTENT_FORMATS.LEGACY_MARKUP } = {}) => {
  const normalizedFormat = detectContentFormat({ contentFormat, editorSource });
  if (normalizedFormat === CONTENT_FORMATS.RICH_HTML) {
    return materializeRichHtmlContent(normalizeEditorSourceByFormat({ editorSource, contentFormat: normalizedFormat }));
  }
  return {
    contentFormat: CONTENT_FORMATS.LEGACY_MARKUP,
    ...parseSenseArticleSource(normalizeEditorSourceByFormat({ editorSource, contentFormat: normalizedFormat }))
  };
};

const shouldTreatAsImageUrl = (url = '') => SAFE_IMAGE_EXTENSIONS.test(String(url || '').trim());
const shouldTreatAsAudioUrl = (url = '') => SAFE_AUDIO_EXTENSIONS.test(String(url || '').trim());
const shouldTreatAsVideoUrl = (url = '') => SAFE_VIDEO_EXTENSIONS.test(String(url || '').trim());

module.exports = {
  CONTENT_FORMATS,
  convertLegacyMarkupToRichHtml,
  detectContentFormat,
  materializeRevisionContent,
  materializeRichHtmlContent,
  sanitizeRichHtml,
  shouldTreatAsAudioUrl,
  shouldTreatAsImageUrl,
  shouldTreatAsVideoUrl
};
