const {
  AST_NODE_TYPES,
  PARSER_CONTRACT_VERSION,
  PARSER_ERROR_CODES,
  SYMBOL_SHORTCUTS
} = require('../constants/senseArticle');
const { shortHash, stableHash } = require('../utils/hash');

const normalizeSource = (source = '') => String(source || '').replace(/\r\n/g, '\n');
const makeTextNode = (value = '') => ({ type: AST_NODE_TYPES.TEXT, value: String(value || '') });

const createSlug = (text = '', used = new Map()) => {
  const raw = String(text || '').trim().toLowerCase();
  const normalized = Array.from(raw)
    .map((ch) => (/[-\w\u4e00-\u9fa5]/.test(ch) ? ch : '-'))
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
  nodes.push(makeTextNode(text));
};

const createParserError = ({ code, message, line = null, column = null, raw = '' }) => ({
  code,
  message,
  line,
  column,
  raw
});

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

const extractPlainText = (nodes = []) => (
  (Array.isArray(nodes) ? nodes : []).map((node) => {
    if (!node || typeof node !== 'object') return '';
    if (node.type === AST_NODE_TYPES.TEXT) return node.value || '';
    if (node.type === AST_NODE_TYPES.SYMBOL) return node.value || '';
    if (node.type === AST_NODE_TYPES.SENSE_REFERENCE) return node.displayText || '';
    if (Array.isArray(node.children)) return extractPlainText(node.children);
    return node.value || '';
  }).join('')
);

const canonicalizeInlineNodes = (nodes = []) => JSON.stringify(nodes);

const parseInline = (text = '', context = {}) => {
  const source = String(text || '');
  const nodes = [];
  let index = 0;

  const recordError = (error) => {
    if (Array.isArray(context.parseErrors)) context.parseErrors.push(error);
  };

  const parseDelimited = (delimiter, type, errorCode) => {
    const nextIndex = source.indexOf(delimiter, index + delimiter.length);
    if (nextIndex < 0) {
      recordError(createParserError({
        code: errorCode,
        message: `未闭合的 ${delimiter} 标记`,
        line: context.lineNumber,
        column: index + 1,
        raw: source.slice(index)
      }));
      pushText(nodes, delimiter);
      index += delimiter.length;
      return;
    }
    const inner = source.slice(index + delimiter.length, nextIndex);
    const childNodes = type === AST_NODE_TYPES.CODE_INLINE || type === AST_NODE_TYPES.FORMULA_INLINE
      ? [makeTextNode(inner)]
      : parseInline(inner, context);
    const entry = {
      type,
      value: inner,
      children: childNodes
    };
    nodes.push(entry);
    if (type === AST_NODE_TYPES.FORMULA_INLINE && Array.isArray(context.formulaRefs)) {
      context.formulaRefs.push({
        formula: inner,
        headingId: context.headingId || '',
        blockId: context.blockId || '',
        line: context.lineNumber || null
      });
    }
    index = nextIndex + delimiter.length;
  };

  while (index < source.length) {
    if (source.startsWith('[[', index)) {
      const closeIndex = source.indexOf(']]', index + 2);
      if (closeIndex < 0) {
        recordError(createParserError({
          code: PARSER_ERROR_CODES.UNCLOSED_REFERENCE,
          message: '引用语法未闭合',
          line: context.lineNumber,
          column: index + 1,
          raw: source.slice(index)
        }));
        pushText(nodes, source.slice(index));
        break;
      }
      const rawRef = source.slice(index + 2, closeIndex);
      const parsedRef = parseReferenceToken(rawRef);
      if (!parsedRef) {
        recordError(createParserError({
          code: PARSER_ERROR_CODES.INVALID_REFERENCE_SYNTAX,
          message: '引用语法无效，应为 [[nodeId:senseId]] 或 [[sense:nodeId:senseId|显示文本]]',
          line: context.lineNumber,
          column: index + 1,
          raw: rawRef
        }));
        pushText(nodes, source.slice(index, closeIndex + 2));
        index = closeIndex + 2;
        continue;
      }
      const referenceId = `ref_${(context.references || []).length + 1}`;
      const referenceNode = {
        type: AST_NODE_TYPES.SENSE_REFERENCE,
        referenceId,
        displayText: parsedRef.displayText,
        targetNodeId: parsedRef.targetNodeId,
        targetSenseId: parsedRef.targetSenseId
      };
      if (Array.isArray(context.references)) {
        context.references.push({
          referenceId,
          displayText: parsedRef.displayText,
          targetNodeId: parsedRef.targetNodeId,
          targetSenseId: parsedRef.targetSenseId,
          headingId: context.headingId || '',
          blockId: context.blockId || '',
          blockHash: context.blockHash || '',
          line: context.lineNumber || null,
          firstOffset: Number.isFinite(context.offsetBase)
            ? context.offsetBase + extractPlainText(nodes).length
            : null
        });
      }
      nodes.push(referenceNode);
      index = closeIndex + 2;
      continue;
    }

    if (source.startsWith('**', index)) {
      parseDelimited('**', AST_NODE_TYPES.STRONG, PARSER_ERROR_CODES.UNCLOSED_INLINE_MARK);
      continue;
    }
    if (source[index] === '*') {
      parseDelimited('*', AST_NODE_TYPES.EMPHASIS, PARSER_ERROR_CODES.UNCLOSED_INLINE_MARK);
      continue;
    }
    if (source[index] === '`') {
      parseDelimited('`', AST_NODE_TYPES.CODE_INLINE, PARSER_ERROR_CODES.UNCLOSED_INLINE_MARK);
      continue;
    }
    if (source[index] === '$') {
      parseDelimited('$', AST_NODE_TYPES.FORMULA_INLINE, PARSER_ERROR_CODES.UNCLOSED_INLINE_MARK);
      continue;
    }
    if (source[index] === ':') {
      const closeIndex = source.indexOf(':', index + 1);
      if (closeIndex > index + 1) {
        const symbolKey = source.slice(index + 1, closeIndex).trim();
        if (SYMBOL_SHORTCUTS[symbolKey]) {
          nodes.push({
            type: AST_NODE_TYPES.SYMBOL,
            shortcode: symbolKey,
            value: SYMBOL_SHORTCUTS[symbolKey]
          });
          if (Array.isArray(context.symbolRefs)) {
            context.symbolRefs.push({
              shortcode: symbolKey,
              value: SYMBOL_SHORTCUTS[symbolKey],
              headingId: context.headingId || '',
              blockId: context.blockId || '',
              blockHash: context.blockHash || '',
              line: context.lineNumber || null
            });
          }
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

const getInlineText = (value = '', inlineContext = {}) => {
  const nodes = parseInline(value, inlineContext);
  return {
    nodes,
    plainText: extractPlainText(nodes)
  };
};

const buildBlockPlainText = (block = {}) => {
  if (!block) return '';
  if (block.type === AST_NODE_TYPES.HEADING || block.type === AST_NODE_TYPES.PARAGRAPH) {
    return extractPlainText(block.children || []);
  }
  if (block.type === AST_NODE_TYPES.LIST) {
    return (block.items || []).map((item) => extractPlainText(item.children || [])).join('\n');
  }
  if (block.type === AST_NODE_TYPES.BLOCKQUOTE) {
    return (block.lines || []).map((line) => extractPlainText(line.children || [])).join('\n');
  }
  if (block.type === AST_NODE_TYPES.FORMULA_BLOCK || block.type === AST_NODE_TYPES.CODE_BLOCK) {
    return block.value || '';
  }
  return '';
};

const buildStableIdFactory = () => {
  const counters = new Map();
  return ({ type, headingId = '', canonicalContent = '', slug = '' }) => {
    const scope = headingId || 'root';
    const baseHash = shortHash(`${type}|${scope}|${slug || canonicalContent}`, 10);
    const key = `${type}:${scope}:${baseHash}`;
    const count = counters.get(key) || 0;
    counters.set(key, count + 1);
    return count > 0 ? `${key}:${count + 1}` : key;
  };
};

const finalizeHeadingRanges = (headingIndex = [], lineCount = 0) => headingIndex.map((heading, index) => {
  let lineEnd = Math.max(0, lineCount - 1);
  for (let cursor = index + 1; cursor < headingIndex.length; cursor += 1) {
    if (headingIndex[cursor].level <= heading.level) {
      lineEnd = Math.max(heading.lineStart, headingIndex[cursor].lineStart - 1);
      break;
    }
  }
  return {
    ...heading,
    lineEnd
  };
});

const parseSenseArticleSource = (source = '') => {
  const normalized = normalizeSource(source);
  const lines = normalized.split('\n');
  const blocks = [];
  const headingIndex = [];
  const referenceIndex = [];
  const formulaRefs = [];
  const symbolRefs = [];
  const parseErrors = [];
  const usedHeadingIds = new Map();
  const nextStableId = buildStableIdFactory();
  let currentHeadingId = '';
  let plainTextOffset = 0;

  const pushBlock = (block) => {
    const plainText = buildBlockPlainText(block);
    const blockHash = stableHash(`${block.type}|${currentHeadingId || 'root'}|${plainText}`);
    const result = {
      ...block,
      blockHash,
      plainText
    };
    blocks.push(result);
    plainTextOffset += plainText.length + 1;
    return result;
  };

  const createInlineContext = ({ lineNumber, headingId, blockId, blockHash = '' }) => ({
    headingId,
    blockId,
    blockHash,
    lineNumber,
    offsetBase: plainTextOffset,
    references: referenceIndex,
    formulaRefs,
    symbolRefs,
    parseErrors
  });

  const emitParagraph = (paragraphLines, lineStart, lineEnd) => {
    const text = paragraphLines.join('\n').trim();
    if (!text) return;
    const blockId = nextStableId({ type: AST_NODE_TYPES.PARAGRAPH, headingId: currentHeadingId, canonicalContent: text });
    const firstPassBlockHash = stableHash(`${AST_NODE_TYPES.PARAGRAPH}|${currentHeadingId || 'root'}|${text}`);
    const { nodes } = getInlineText(text, createInlineContext({
      lineNumber: lineStart + 1,
      headingId: currentHeadingId,
      blockId,
      blockHash: firstPassBlockHash
    }));
    pushBlock({
      id: blockId,
      type: AST_NODE_TYPES.PARAGRAPH,
      headingId: currentHeadingId,
      lineStart,
      lineEnd,
      children: nodes
    });
  };

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const rawLine = lines[lineIndex];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      lineIndex += 1;
      continue;
    }

    const headingMatch = rawLine.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const headingId = createSlug(title, usedHeadingIds);
      const blockId = headingId;
      const blockHash = stableHash(`${AST_NODE_TYPES.HEADING}|${headingId}|${title}`);
      const { nodes, plainText } = getInlineText(title, createInlineContext({
        lineNumber: lineIndex + 1,
        headingId,
        blockId,
        blockHash
      }));
      currentHeadingId = headingId;
      const block = pushBlock({
        id: blockId,
        type: AST_NODE_TYPES.HEADING,
        headingId,
        level,
        lineStart: lineIndex,
        lineEnd: lineIndex,
        children: nodes
      });
      headingIndex.push({
        headingId,
        level,
        title: plainText,
        lineStart: lineIndex,
        blockId: block.id,
        blockHash: block.blockHash,
        order: headingIndex.length
      });
      lineIndex += 1;
      continue;
    }

    if (rawLine.startsWith('```')) {
      const language = rawLine.slice(3).trim();
      const start = lineIndex;
      const rows = [];
      lineIndex += 1;
      while (lineIndex < lines.length && !lines[lineIndex].startsWith('```')) {
        rows.push(lines[lineIndex]);
        lineIndex += 1;
      }
      if (lineIndex < lines.length) lineIndex += 1;
      const value = rows.join('\n');
      const blockId = nextStableId({ type: AST_NODE_TYPES.CODE_BLOCK, headingId: currentHeadingId, canonicalContent: value });
      pushBlock({
        id: blockId,
        type: AST_NODE_TYPES.CODE_BLOCK,
        headingId: currentHeadingId,
        language,
        lineStart: start,
        lineEnd: Math.max(start, lineIndex - 1),
        value
      });
      continue;
    }

    if (rawLine.startsWith('$$')) {
      const start = lineIndex;
      let value = rawLine.slice(2);
      const rows = [];
      const singleLineClosed = value.endsWith('$$');
      if (singleLineClosed) {
        rows.push(value.slice(0, -2));
        lineIndex += 1;
      } else {
        if (value) rows.push(value);
        lineIndex += 1;
        while (lineIndex < lines.length && !lines[lineIndex].startsWith('$$')) {
          rows.push(lines[lineIndex]);
          lineIndex += 1;
        }
        if (lineIndex < lines.length) {
          const closingTail = lines[lineIndex].slice(2);
          if (closingTail) rows.push(closingTail);
          lineIndex += 1;
        }
      }
      value = rows.join('\n').trim();
      const blockId = nextStableId({ type: AST_NODE_TYPES.FORMULA_BLOCK, headingId: currentHeadingId, canonicalContent: value });
      const block = pushBlock({
        id: blockId,
        type: AST_NODE_TYPES.FORMULA_BLOCK,
        headingId: currentHeadingId,
        lineStart: start,
        lineEnd: Math.max(start, lineIndex - 1),
        value
      });
      formulaRefs.push({ formula: value, headingId: currentHeadingId, blockId, blockHash: block.blockHash, line: start + 1 });
      continue;
    }

    const listMatch = rawLine.match(/^\s*((?:[-*])|(?:\d+\.))\s+(.+)$/);
    if (listMatch) {
      const start = lineIndex;
      const items = [];
      while (lineIndex < lines.length) {
        const matched = lines[lineIndex].match(/^\s*((?:[-*])|(?:\d+\.))\s+(.+)$/);
        if (!matched) break;
        const itemText = matched[2].trim();
        const itemId = nextStableId({ type: AST_NODE_TYPES.LIST_ITEM, headingId: currentHeadingId, canonicalContent: itemText });
        const itemHash = stableHash(`${AST_NODE_TYPES.LIST_ITEM}|${currentHeadingId || 'root'}|${itemText}`);
        const { nodes } = getInlineText(itemText, createInlineContext({
          lineNumber: lineIndex + 1,
          headingId: currentHeadingId,
          blockId: itemId,
          blockHash: itemHash
        }));
        items.push({
          id: itemId,
          type: AST_NODE_TYPES.LIST_ITEM,
          marker: matched[1],
          blockHash: itemHash,
          children: nodes,
          plainText: extractPlainText(nodes)
        });
        plainTextOffset += extractPlainText(nodes).length + 1;
        lineIndex += 1;
      }
      const listPlainText = items.map((item) => item.plainText).join('\n');
      const blockId = nextStableId({ type: AST_NODE_TYPES.LIST, headingId: currentHeadingId, canonicalContent: listPlainText });
      pushBlock({
        id: blockId,
        type: AST_NODE_TYPES.LIST,
        headingId: currentHeadingId,
        ordered: /^\d+\.$/.test(listMatch[1]),
        lineStart: start,
        lineEnd: Math.max(start, lineIndex - 1),
        items
      });
      continue;
    }

    if (rawLine.startsWith('>')) {
      const start = lineIndex;
      const quoteLines = [];
      while (lineIndex < lines.length && lines[lineIndex].startsWith('>')) {
        const quoteText = lines[lineIndex].replace(/^>\s?/, '');
        const quoteId = nextStableId({ type: `${AST_NODE_TYPES.BLOCKQUOTE}_line`, headingId: currentHeadingId, canonicalContent: quoteText });
        const quoteHash = stableHash(`${AST_NODE_TYPES.BLOCKQUOTE}|${currentHeadingId || 'root'}|${quoteText}`);
        const { nodes } = getInlineText(quoteText, createInlineContext({
          lineNumber: lineIndex + 1,
          headingId: currentHeadingId,
          blockId: quoteId,
          blockHash: quoteHash
        }));
        quoteLines.push({
          id: quoteId,
          type: AST_NODE_TYPES.PARAGRAPH,
          blockHash: quoteHash,
          children: nodes,
          plainText: extractPlainText(nodes)
        });
        plainTextOffset += extractPlainText(nodes).length + 1;
        lineIndex += 1;
      }
      const quotePlainText = quoteLines.map((item) => item.plainText).join('\n');
      const blockId = nextStableId({ type: AST_NODE_TYPES.BLOCKQUOTE, headingId: currentHeadingId, canonicalContent: quotePlainText });
      pushBlock({
        id: blockId,
        type: AST_NODE_TYPES.BLOCKQUOTE,
        headingId: currentHeadingId,
        lineStart: start,
        lineEnd: Math.max(start, lineIndex - 1),
        lines: quoteLines
      });
      continue;
    }

    const paragraphStart = lineIndex;
    const paragraphLines = [];
    while (lineIndex < lines.length) {
      const candidate = lines[lineIndex];
      const candidateTrimmed = candidate.trim();
      if (!candidateTrimmed) break;
      if (/^(#{1,3})\s+/.test(candidate)) break;
      if (/^\s*((?:[-*])|(?:\d+\.))\s+/.test(candidate)) break;
      if (candidate.startsWith('>') || candidate.startsWith('```') || candidate.startsWith('$$')) break;
      paragraphLines.push(candidate);
      lineIndex += 1;
    }
    emitParagraph(paragraphLines, paragraphStart, Math.max(paragraphStart, lineIndex - 1));
  }

  const finalizedHeadingIndex = finalizeHeadingRanges(headingIndex, lines.length);
  const plainTextSnapshot = blocks.map((block) => buildBlockPlainText(block)).filter(Boolean).join('\n\n').trim();
  const ast = {
    type: AST_NODE_TYPES.DOCUMENT,
    contractVersion: PARSER_CONTRACT_VERSION,
    blocks
  };

  return {
    editorSource: normalized,
    ast,
    headingIndex: finalizedHeadingIndex,
    referenceIndex: referenceIndex.map((entry) => ({
      ...entry,
      isValid: false,
      targetTitle: '',
      targetNodeName: ''
    })),
    formulaRefs,
    symbolRefs,
    parseErrors,
    plainTextSnapshot,
    renderSnapshot: {
      type: AST_NODE_TYPES.DOCUMENT,
      contractVersion: PARSER_CONTRACT_VERSION,
      blocks,
      invalidatedBy: ['editorSource', 'ast.contractVersion']
    }
  };
};

module.exports = {
  AST_NODE_TYPES,
  buildBlockPlainText,
  canonicalizeInlineNodes,
  createParserError,
  createSlug,
  extractPlainText,
  normalizeSource,
  parseInline,
  parseReferenceToken,
  parseSenseArticleSource
};
