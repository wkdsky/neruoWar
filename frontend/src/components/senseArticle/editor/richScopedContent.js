const EMPTY_HTML = '<p></p>';

const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const escapeHtml = (value = '') => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const wrapPlainTextAsHtml = (value = '') => {
  const normalized = String(value || '').trim();
  return normalized ? `<p>${escapeHtml(normalized)}</p>` : EMPTY_HTML;
};

const parseBody = (html = '') => {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return null;
  const parser = new DOMParser();
  return parser.parseFromString(`<body>${html || ''}</body>`, 'text/html').body;
};

const serializeNode = (node) => {
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent || '';
  if (typeof node.outerHTML === 'string') return node.outerHTML;
  return node.textContent || '';
};

const serializeNodes = (nodes = []) => (Array.isArray(nodes) ? nodes : Array.from(nodes || [])).map((node) => serializeNode(node)).join('');

const slugifyHeading = (value = '', used = new Map()) => {
  const raw = String(value || '').trim().toLowerCase();
  const normalized = Array.from(raw)
    .map((char) => (/[-\w\u4e00-\u9fa5]/.test(char) ? char : '-'))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
  const count = used.get(normalized) || 0;
  used.set(normalized, count + 1);
  return count > 0 ? `${normalized}-${count + 1}` : normalized;
};

const isHeadingNode = (node) => node?.nodeType === 1 && /^H[1-4]$/.test(String(node.tagName || '').toUpperCase());

const buildHeadingRows = (body) => {
  if (!body) return [];
  const used = new Map();
  return Array.from(body.childNodes || []).reduce((rows, node, index) => {
    if (!isHeadingNode(node)) return rows;
    const title = normalizeText(node.textContent || '');
    if (!title) return rows;
    rows.push({
      nodeIndex: index,
      title,
      level: Number.parseInt(String(node.tagName || '').slice(1), 10) || 1,
      headingId: slugifyHeading(title, used)
    });
    return rows;
  }, []);
};

const resolveSectionBounds = ({ body, targetHeadingId = '', headingTitle = '' } = {}) => {
  const rows = buildHeadingRows(body);
  if (rows.length === 0) return null;
  const normalizedTargetId = String(targetHeadingId || '').trim();
  const normalizedHeadingTitle = normalizeText(headingTitle);
  const targetIndex = rows.findIndex((row) => (
    (normalizedTargetId && row.headingId === normalizedTargetId)
    || (normalizedHeadingTitle && row.title === normalizedHeadingTitle)
  ));
  if (targetIndex < 0) return null;
  const target = rows[targetIndex];
  const nextPeer = rows.slice(targetIndex + 1).find((row) => row.level <= target.level) || null;
  return {
    startIndex: target.nodeIndex,
    endIndex: nextPeer ? nextPeer.nodeIndex : Array.from(body.childNodes || []).length,
    headingTitle: target.title,
    headingId: target.headingId,
    level: target.level
  };
};

const collectTextEntriesFromNodes = (nodes = []) => {
  const entries = [];
  let cursor = 0;
  const safeNodes = Array.isArray(nodes) ? nodes : Array.from(nodes || []);
  safeNodes.forEach((node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      const text = node.textContent || '';
      entries.push({ node, start: cursor, end: cursor + text.length, text });
      cursor += text.length;
      return;
    }
    if (node.nodeType !== 1) return;
    const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      const text = current.nodeValue || '';
      entries.push({ node: current, start: cursor, end: cursor + text.length, text });
      cursor += text.length;
      current = walker.nextNode();
    }
  });
  return {
    text: entries.map((entry) => entry.text).join(''),
    entries
  };
};

const findAllOccurrences = (text = '', quote = '') => {
  if (!quote) return [];
  const hits = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const index = text.indexOf(quote, cursor);
    if (index < 0) break;
    hits.push(index);
    cursor = index + Math.max(1, quote.length);
  }
  return hits;
};

const matchesContext = ({ text = '', start = -1, quote = '', prefixText = '', suffixText = '' }) => {
  if (start < 0 || !quote) return false;
  const before = prefixText ? text.slice(Math.max(0, start - prefixText.length), start) : '';
  const after = suffixText ? text.slice(start + quote.length, start + quote.length + suffixText.length) : '';
  return (!prefixText || before.endsWith(prefixText)) && (!suffixText || after.startsWith(suffixText));
};

const resolveTextRange = ({ text = '', anchor = {} } = {}) => {
  const quote = String(anchor?.selectionText || anchor?.textQuote || '').trim();
  const prefixText = String(anchor?.prefixText || anchor?.beforeText || '').trim();
  const suffixText = String(anchor?.suffixText || anchor?.afterText || '').trim();
  if (!quote) return null;
  const hits = findAllOccurrences(text, quote);
  const contextual = hits.find((start) => matchesContext({ text, start, quote, prefixText, suffixText }));
  if (Number.isFinite(contextual)) {
    return { start: contextual, end: contextual + quote.length, quote };
  }
  if (hits.length === 1) {
    return { start: hits[0], end: hits[0] + quote.length, quote };
  }
  if (Number.isFinite(Number(anchor?.textPositionStart)) && Number.isFinite(Number(anchor?.textPositionEnd))) {
    const start = Math.max(0, Math.min(text.length, Number(anchor.textPositionStart)));
    const end = Math.max(start, Math.min(text.length, Number(anchor.textPositionEnd)));
    if (end > start) return { start, end, quote: text.slice(start, end) || quote };
  }
  return null;
};

const createRangeFromOffsets = ({ doc, entries = [], start = 0, end = 0 } = {}) => {
  if (!doc || entries.length === 0) return null;
  const startEntry = entries.find((entry) => start >= entry.start && start <= entry.end) || entries[entries.length - 1];
  const endEntry = entries.find((entry) => end >= entry.start && end <= entry.end) || entries[entries.length - 1];
  if (!startEntry || !endEntry) return null;
  const range = doc.createRange();
  range.setStart(startEntry.node, Math.max(0, start - startEntry.start));
  range.setEnd(endEntry.node, Math.max(0, end - endEntry.start));
  return range;
};

const createFragmentFromHtml = (doc, html = '', { preferInline = false } = {}) => {
  const parsedBody = parseBody(html);
  const fragment = doc.createDocumentFragment();
  if (!parsedBody) return fragment;
  let sourceNodes = Array.from(parsedBody.childNodes || []);
  if (
    preferInline
    && sourceNodes.length === 1
    && sourceNodes[0]?.nodeType === 1
    && String(sourceNodes[0].tagName || '').toLowerCase() === 'p'
  ) {
    sourceNodes = Array.from(sourceNodes[0].childNodes || []);
  }
  sourceNodes.forEach((node) => {
    fragment.appendChild(doc.importNode(node, true));
  });
  return fragment;
};

const replaceSectionNodes = ({ body, bounds, nextHtml = '' } = {}) => {
  const doc = body?.ownerDocument;
  if (!body || !doc || !bounds) return '';
  const currentNodes = Array.from(body.childNodes || []);
  const beforeNodes = currentNodes.slice(0, bounds.startIndex);
  const afterNodes = currentNodes.slice(bounds.endIndex);
  const replacementBody = parseBody(nextHtml);
  return serializeNodes([
    ...beforeNodes,
    ...(replacementBody ? Array.from(replacementBody.childNodes || []) : []),
    ...afterNodes
  ]);
};

export const extractPlainTextFromRichHtml = (html = '') => {
  const body = parseBody(html);
  return normalizeText(body?.textContent || '');
};

export const extractScopedRichEditorDocument = ({
  fullHtml = '',
  sourceMode = 'full',
  targetHeadingId = '',
  selectedRangeAnchor = null,
  headingTitle = ''
} = {}) => {
  const normalizedMode = String(sourceMode || 'full').trim();
  if (normalizedMode !== 'section' && normalizedMode !== 'selection') {
    return {
      mode: 'full',
      resolved: true,
      editableHtml: fullHtml || EMPTY_HTML,
      headingTitle: normalizeText(headingTitle),
      resolveMessage: '',
      originalText: extractPlainTextFromRichHtml(fullHtml || '')
    };
  }

  const body = parseBody(fullHtml);
  if (!body) {
    const fallbackText = selectedRangeAnchor?.selectionText || '';
    return {
      mode: normalizedMode,
      resolved: false,
      editableHtml: wrapPlainTextAsHtml(fallbackText),
      headingTitle: normalizeText(headingTitle),
      resolveMessage: '当前局部范围无法解析，已退回到纯文本局部内容。',
      originalText: normalizeText(fallbackText)
    };
  }

  const sectionBounds = resolveSectionBounds({
    body,
    targetHeadingId: targetHeadingId || selectedRangeAnchor?.headingId || '',
    headingTitle
  });
  const sectionNodes = sectionBounds
    ? Array.from(body.childNodes || []).slice(sectionBounds.startIndex, sectionBounds.endIndex)
    : Array.from(body.childNodes || []);
  const sectionHtml = serializeNodes(sectionNodes);

  if (normalizedMode === 'section') {
    if (!sectionBounds) {
      return {
        mode: 'section',
        resolved: false,
        editableHtml: wrapPlainTextAsHtml(selectedRangeAnchor?.selectionText || ''),
        headingTitle: normalizeText(headingTitle),
        resolveMessage: '当前小节未能精确定位，已退回到纯文本局部内容。',
        originalText: normalizeText(selectedRangeAnchor?.selectionText || '')
      };
    }
    return {
      mode: 'section',
      resolved: true,
      editableHtml: sectionHtml || EMPTY_HTML,
      headingTitle: sectionBounds.headingTitle,
      resolveMessage: '',
      originalText: extractPlainTextFromRichHtml(sectionHtml || '')
    };
  }

  const sectionBody = parseBody(sectionHtml);
  const { text, entries } = collectTextEntriesFromNodes(Array.from(sectionBody?.childNodes || []));
  const selectionRange = resolveTextRange({ text, anchor: selectedRangeAnchor || {} });
  if (!sectionBody || !selectionRange) {
    const fallbackText = selectedRangeAnchor?.selectionText || selectedRangeAnchor?.textQuote || '';
    return {
      mode: 'selection',
      resolved: false,
      editableHtml: wrapPlainTextAsHtml(fallbackText),
      headingTitle: sectionBounds?.headingTitle || normalizeText(headingTitle),
      resolveMessage: '当前选段未能精确定位，已退回到纯文本局部内容。',
      originalText: normalizeText(fallbackText)
    };
  }
  const range = createRangeFromOffsets({
    doc: sectionBody.ownerDocument,
    entries,
    start: selectionRange.start,
    end: selectionRange.end
  });
  const fragmentContainer = sectionBody.ownerDocument.createElement('div');
  fragmentContainer.appendChild(range.cloneContents());
  const editableHtml = fragmentContainer.innerHTML || wrapPlainTextAsHtml(selectionRange.quote || '');
  return {
    mode: 'selection',
    resolved: true,
    editableHtml,
    headingTitle: sectionBounds?.headingTitle || normalizeText(headingTitle),
    resolveMessage: '',
    originalText: normalizeText(selectionRange.quote || '')
  };
};

export const composeScopedRichEditorDocument = ({
  fullHtml = '',
  sourceMode = 'full',
  targetHeadingId = '',
  selectedRangeAnchor = null,
  headingTitle = '',
  editableHtml = ''
} = {}) => {
  const normalizedMode = String(sourceMode || 'full').trim();
  if (normalizedMode !== 'section' && normalizedMode !== 'selection') {
    return editableHtml || EMPTY_HTML;
  }

  const body = parseBody(fullHtml);
  if (!body) return fullHtml || EMPTY_HTML;
  const sectionBounds = resolveSectionBounds({
    body,
    targetHeadingId: targetHeadingId || selectedRangeAnchor?.headingId || '',
    headingTitle
  });

  if (normalizedMode === 'section') {
    if (!sectionBounds) return fullHtml || EMPTY_HTML;
    return replaceSectionNodes({
      body,
      bounds: sectionBounds,
      nextHtml: editableHtml || EMPTY_HTML
    }) || EMPTY_HTML;
  }

  const sectionNodes = sectionBounds
    ? Array.from(body.childNodes || []).slice(sectionBounds.startIndex, sectionBounds.endIndex)
    : Array.from(body.childNodes || []);
  const { text, entries } = collectTextEntriesFromNodes(sectionNodes);
  const selectionRange = resolveTextRange({ text, anchor: selectedRangeAnchor || {} });
  if (!selectionRange || entries.length === 0) return fullHtml || EMPTY_HTML;
  const range = createRangeFromOffsets({
    doc: body.ownerDocument,
    entries,
    start: selectionRange.start,
    end: selectionRange.end
  });
  if (!range) return fullHtml || EMPTY_HTML;
  range.deleteContents();
  const insertion = createFragmentFromHtml(body.ownerDocument, editableHtml || EMPTY_HTML, { preferInline: true });
  range.insertNode(insertion);
  return body.innerHTML || EMPTY_HTML;
};
