export const AST_NODE_TYPES = {
  DOCUMENT: 'document',
  HEADING: 'heading',
  PARAGRAPH: 'paragraph',
  LIST: 'list',
  LIST_ITEM: 'list_item',
  BLOCKQUOTE: 'blockquote',
  TEXT: 'text',
  EMPHASIS: 'emphasis',
  STRONG: 'strong',
  CODE_INLINE: 'code_inline',
  FORMULA_INLINE: 'formula_inline',
  FORMULA_BLOCK: 'formula_block',
  SYMBOL: 'symbol',
  SENSE_REFERENCE: 'sense_reference',
  CODE_BLOCK: 'code_block'
};

export const SENSE_ARTICLE_CONTENT_FORMATS = {
  LEGACY_MARKUP: 'legacy_markup',
  RICH_HTML: 'rich_html'
};

export const SYMBOL_SHORTCUTS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', omega: 'ω',
  forall: '∀', exists: '∃', in: '∈', notin: '∉', sub: '⊂', subeq: '⊆', sup: '⊃', union: '∪', inter: '∩',
  and: '∧', or: '∨', implies: '⇒', iff: '⇔', to: '→', from: '←', mapsto: '↦', inf: '∞', approx: '≈', ne: '≠', le: '≤', ge: '≥', degree: '°'
};

const shortHash = (value = '', length = 12) => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36).slice(0, length);
};

const textNode = (value = '') => ({ type: AST_NODE_TYPES.TEXT, value: String(value || '') });

const createSlug = (text = '', used = new Map()) => {
  const raw = String(text || '').trim().toLowerCase();
  const normalized = Array.from(raw)
    .map((char) => (/[-\w\u4e00-\u9fa5]/.test(char) ? char : '-'))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
  const count = used.get(normalized) || 0;
  used.set(normalized, count + 1);
  return count > 0 ? `${normalized}-${count + 1}` : normalized;
};

const pushText = (nodes, value) => {
  const text = String(value || '');
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last?.type === AST_NODE_TYPES.TEXT) {
    last.value += text;
    return;
  }
  nodes.push(textNode(text));
};

export const extractPlainText = (nodes = []) => (
  (Array.isArray(nodes) ? nodes : []).map((node) => {
    if (!node) return '';
    if (node.type === AST_NODE_TYPES.TEXT) return node.value || '';
    if (node.type === AST_NODE_TYPES.SYMBOL) return node.value || '';
    if (node.type === AST_NODE_TYPES.SENSE_REFERENCE) return node.displayText || '';
    if (Array.isArray(node.children)) return extractPlainText(node.children);
    return node.value || '';
  }).join('')
);

const parseReferenceToken = (token = '') => {
  const inner = String(token || '').trim();
  if (!inner) return null;
  const pipeIndex = inner.indexOf('|');
  const targetPart = pipeIndex >= 0 ? inner.slice(0, pipeIndex).trim() : inner;
  const displayText = pipeIndex >= 0 ? inner.slice(pipeIndex + 1).trim() : '';
  const normalizedTarget = targetPart.startsWith('sense:') ? targetPart.slice('sense:'.length) : targetPart;
  const pieces = normalizedTarget.split(':').map((item) => item.trim()).filter(Boolean);
  if (pieces.length !== 2) return null;
  return {
    targetNodeId: pieces[0],
    targetSenseId: pieces[1],
    displayText: displayText || `${pieces[0]}:${pieces[1]}`
  };
};

export const parseInline = (text = '', context = {}) => {
  const source = String(text || '');
  const nodes = [];
  let index = 0;
  const parseErrors = Array.isArray(context.parseErrors) ? context.parseErrors : [];

  const parseDelimited = (delimiter, type, errorCode) => {
    const nextIndex = source.indexOf(delimiter, index + delimiter.length);
    if (nextIndex < 0) {
      parseErrors.push({ code: errorCode, message: `未闭合的 ${delimiter} 标记`, raw: source.slice(index), line: context.lineNumber || null, column: index + 1 });
      pushText(nodes, delimiter);
      index += delimiter.length;
      return;
    }
    const inner = source.slice(index + delimiter.length, nextIndex);
    const children = type === AST_NODE_TYPES.CODE_INLINE || type === AST_NODE_TYPES.FORMULA_INLINE
      ? [textNode(inner)]
      : parseInline(inner, context);
    nodes.push({ type, value: inner, children });
    if (type === AST_NODE_TYPES.FORMULA_INLINE && Array.isArray(context.formulaRefs)) {
      context.formulaRefs.push({ formula: inner, headingId: context.headingId || '', blockId: context.blockId || '', line: context.lineNumber || null });
    }
    index = nextIndex + delimiter.length;
  };

  while (index < source.length) {
    if (source.startsWith('[[', index)) {
      const closeIndex = source.indexOf(']]', index + 2);
      if (closeIndex < 0) {
        parseErrors.push({ code: 'UNCLOSED_REFERENCE', message: '引用语法未闭合', raw: source.slice(index), line: context.lineNumber || null, column: index + 1 });
        pushText(nodes, source.slice(index));
        break;
      }
      const parsedRef = parseReferenceToken(source.slice(index + 2, closeIndex));
      if (!parsedRef) {
        parseErrors.push({ code: 'INVALID_REFERENCE_SYNTAX', message: '引用语法无效', raw: source.slice(index, closeIndex + 2), line: context.lineNumber || null, column: index + 1 });
        pushText(nodes, source.slice(index, closeIndex + 2));
        index = closeIndex + 2;
        continue;
      }
      const referenceId = `ref_${shortHash(`${parsedRef.targetNodeId}:${parsedRef.targetSenseId}:${parsedRef.displayText}:${context.blockId || ''}:${index}`, 16)}`;
      nodes.push({ type: AST_NODE_TYPES.SENSE_REFERENCE, referenceId, ...parsedRef });
      if (Array.isArray(context.referenceIndex)) {
        context.referenceIndex.push({ referenceId, ...parsedRef, blockId: context.blockId || '', headingId: context.headingId || '', position: index, isValid: true });
      }
      index = closeIndex + 2;
      continue;
    }
    if (source.startsWith('**', index)) { parseDelimited('**', AST_NODE_TYPES.STRONG, 'UNCLOSED_STRONG'); continue; }
    if (source[index] === '*') { parseDelimited('*', AST_NODE_TYPES.EMPHASIS, 'UNCLOSED_EMPHASIS'); continue; }
    if (source[index] === '`') { parseDelimited('`', AST_NODE_TYPES.CODE_INLINE, 'UNCLOSED_CODE_INLINE'); continue; }
    if (source[index] === '$') { parseDelimited('$', AST_NODE_TYPES.FORMULA_INLINE, 'UNCLOSED_FORMULA_INLINE'); continue; }
    if (source[index] === ':') {
      const closeIndex = source.indexOf(':', index + 1);
      if (closeIndex > index + 1) {
        const key = source.slice(index + 1, closeIndex).trim();
        if (SYMBOL_SHORTCUTS[key]) {
          nodes.push({ type: AST_NODE_TYPES.SYMBOL, shortcode: key, value: SYMBOL_SHORTCUTS[key] });
          if (Array.isArray(context.symbolRefs)) context.symbolRefs.push({ shortcode: key, value: SYMBOL_SHORTCUTS[key], blockId: context.blockId || '', headingId: context.headingId || '' });
          index = closeIndex + 1;
          continue;
        }
      }
    }
    pushText(nodes, source[index]);
    index += 1;
  }
  return nodes;
};

const buildBlockPlainText = (block) => {
  if (!block) return '';
  if (typeof block.plainText === 'string' && block.plainText.trim()) return block.plainText;
  if (block.type === AST_NODE_TYPES.HEADING || block.type === AST_NODE_TYPES.PARAGRAPH) return extractPlainText(block.children || []);
  if (block.type === AST_NODE_TYPES.LIST) return (block.items || []).map((item) => extractPlainText(item.children || [])).join('\n');
  if (block.type === AST_NODE_TYPES.BLOCKQUOTE) return (block.lines || []).map((item) => extractPlainText(item.children || [])).join('\n');
  if (Array.isArray(block.rows)) return block.rows.map((row) => (
    Array.isArray(row.cells)
      ? row.cells.map((cell) => (typeof cell === 'string' ? cell : cell?.text || '')).join(' ')
      : ''
  )).filter(Boolean).join('\n');
  return String(block.value || '');
};

const finalizeBlock = (block = {}, blocks = []) => {
  const plainText = buildBlockPlainText(block);
  const blockHash = shortHash(`${block.type}:${block.headingId || ''}:${plainText}`, 16);
  blocks.push({ ...block, plainText, blockHash });
};

export const parseSenseArticleSource = (source = '') => {
  const normalized = String(source || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks = [];
  const headingIndex = [];
  const referenceIndex = [];
  const formulaRefs = [];
  const symbolRefs = [];
  const parseErrors = [];
  const usedHeadings = new Map();
  let currentHeadingId = '';
  let blockIndex = 0;

  const nextBlockId = (prefix, seed = '') => `${prefix}_${shortHash(`${prefix}:${blockIndex += 1}:${currentHeadingId}:${seed}`, 12)}`;
  const parseInlineForBlock = (content, extra = {}) => parseInline(content, {
    parseErrors,
    referenceIndex,
    formulaRefs,
    symbolRefs,
    headingId: currentHeadingId,
    ...extra
  });

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (!trimmed) {
      lineIndex += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const title = headingMatch[2].trim();
      const headingId = createSlug(title, usedHeadings);
      const blockId = nextBlockId('heading', title);
      const children = parseInlineForBlock(title, { blockId, lineNumber: lineIndex + 1, headingId });
      currentHeadingId = headingId;
      finalizeBlock({ id: blockId, type: AST_NODE_TYPES.HEADING, level: headingMatch[1].length, headingId, children }, blocks);
      headingIndex.push({ headingId, level: headingMatch[1].length, title: extractPlainText(children), blockId });
      lineIndex += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const contentLines = [];
      lineIndex += 1;
      while (lineIndex < lines.length && !lines[lineIndex].startsWith('```')) {
        contentLines.push(lines[lineIndex]);
        lineIndex += 1;
      }
      if (lineIndex < lines.length) lineIndex += 1;
      finalizeBlock({ id: nextBlockId('code', language), type: AST_NODE_TYPES.CODE_BLOCK, headingId: currentHeadingId, language, value: contentLines.join('\n') }, blocks);
      continue;
    }

    if (line.startsWith('$$')) {
      const contentLines = [];
      lineIndex += 1;
      while (lineIndex < lines.length && !lines[lineIndex].startsWith('$$')) {
        contentLines.push(lines[lineIndex]);
        lineIndex += 1;
      }
      if (lineIndex < lines.length) lineIndex += 1;
      const value = contentLines.join('\n');
      const blockId = nextBlockId('formula', value);
      formulaRefs.push({ formula: value, headingId: currentHeadingId, blockId, line: lineIndex + 1 });
      finalizeBlock({ id: blockId, type: AST_NODE_TYPES.FORMULA_BLOCK, headingId: currentHeadingId, value }, blocks);
      continue;
    }

    if (/^\s*((?:[-*])|(?:\d+\.))\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const blockId = nextBlockId('list', line);
      const items = [];
      while (lineIndex < lines.length && /^\s*((?:[-*])|(?:\d+\.))\s+/.test(lines[lineIndex])) {
        const match = lines[lineIndex].match(/^\s*((?:[-*])|(?:\d+\.))\s+(.+)$/);
        const itemBlockId = nextBlockId('list_item', match?.[2] || '');
        const children = parseInlineForBlock(match?.[2] || '', { blockId: itemBlockId, lineNumber: lineIndex + 1 });
        items.push({ id: itemBlockId, type: AST_NODE_TYPES.LIST_ITEM, children, plainText: extractPlainText(children), blockHash: shortHash(`list_item:${currentHeadingId}:${extractPlainText(children)}`, 16) });
        lineIndex += 1;
      }
      finalizeBlock({ id: blockId, type: AST_NODE_TYPES.LIST, headingId: currentHeadingId, ordered, items }, blocks);
      continue;
    }

    if (line.startsWith('>')) {
      const blockId = nextBlockId('blockquote', line);
      const quoteLines = [];
      while (lineIndex < lines.length && lines[lineIndex].startsWith('>')) {
        const content = lines[lineIndex].replace(/^>\s?/, '');
        const lineBlockId = nextBlockId('quote_line', content);
        const children = parseInlineForBlock(content, { blockId: lineBlockId, lineNumber: lineIndex + 1 });
        quoteLines.push({ id: lineBlockId, children, plainText: extractPlainText(children), blockHash: shortHash(`quote_line:${currentHeadingId}:${extractPlainText(children)}`, 16) });
        lineIndex += 1;
      }
      finalizeBlock({ id: blockId, type: AST_NODE_TYPES.BLOCKQUOTE, headingId: currentHeadingId, lines: quoteLines }, blocks);
      continue;
    }

    const paragraphLines = [];
    const paragraphStart = lineIndex;
    while (lineIndex < lines.length && lines[lineIndex].trim() && !/^(#{1,3})\s+/.test(lines[lineIndex]) && !/^\s*((?:[-*])|(?:\d+\.))\s+/.test(lines[lineIndex]) && !lines[lineIndex].startsWith('>') && !lines[lineIndex].startsWith('```') && !lines[lineIndex].startsWith('$$')) {
      paragraphLines.push(lines[lineIndex]);
      lineIndex += 1;
    }
    const blockId = nextBlockId('paragraph', paragraphLines.join('\n'));
    const paragraphText = paragraphLines.join('\n');
    const children = parseInlineForBlock(paragraphText, { blockId, lineNumber: paragraphStart + 1 });
    finalizeBlock({ id: blockId, type: AST_NODE_TYPES.PARAGRAPH, headingId: currentHeadingId, children }, blocks);
  }

  const plainTextSnapshot = blocks.map((block) => block.plainText || '').filter(Boolean).join('\n\n').trim();
  const renderSnapshot = { contractVersion: 2, blocks };

  return {
    editorSource: normalized,
    ast: { type: AST_NODE_TYPES.DOCUMENT, blocks },
    headingIndex,
    referenceIndex,
    formulaRefs,
    symbolRefs,
    plainTextSnapshot,
    renderSnapshot,
    parseErrors
  };
};
