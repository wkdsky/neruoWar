const normalizeSource = (value = '') => String(value || '').replace(/\r\n?/g, '\n');

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

const buildHeadingRows = (source = '') => {
  const normalized = normalizeSource(source);
  const lines = normalized.split('\n');
  const used = new Map();
  let cursor = 0;
  return lines.reduce((rows, line, index) => {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    const lineStart = cursor;
    const lineEnd = lineStart + line.length;
    cursor = lineEnd + 1;
    if (!match) return rows;
    const level = match[1].length;
    const title = match[2].trim();
    rows.push({
      lineIndex: index,
      lineStart,
      lineEnd,
      level,
      title,
      headingId: createSlug(title, used)
    });
    return rows;
  }, []);
};

export const extractSectionRange = (source = '', headingId = '') => {
  const normalized = normalizeSource(source);
  const safeHeadingId = String(headingId || '').trim();
  if (!safeHeadingId) {
    return {
      found: true,
      headingId: '',
      title: '',
      level: 0,
      sectionStart: 0,
      sectionEnd: normalized.length,
      bodyStart: 0,
      bodyEnd: normalized.length,
      headingSource: '',
      bodySource: normalized,
      fullSource: normalized
    };
  }

  const rows = buildHeadingRows(normalized);
  const targetIndex = rows.findIndex((row) => row.headingId === safeHeadingId);
  if (targetIndex < 0) {
    return {
      found: false,
      headingId: safeHeadingId,
      title: '',
      level: 0,
      sectionStart: 0,
      sectionEnd: 0,
      bodyStart: 0,
      bodyEnd: 0,
      headingSource: '',
      bodySource: '',
      fullSource: normalized
    };
  }

  const target = rows[targetIndex];
  const nextPeer = rows.slice(targetIndex + 1).find((row) => row.level <= target.level) || null;
  const sectionStart = target.lineStart;
  const headingLineEnd = target.lineEnd;
  const bodyStart = Math.min(normalized.length, headingLineEnd + 1);
  const sectionEnd = nextPeer ? nextPeer.lineStart : normalized.length;

  return {
    found: true,
    headingId: target.headingId,
    title: target.title,
    level: target.level,
    sectionStart,
    sectionEnd,
    bodyStart,
    bodyEnd: sectionEnd,
    headingSource: normalized.slice(sectionStart, Math.min(sectionEnd, bodyStart)),
    bodySource: normalized.slice(bodyStart, sectionEnd),
    fullSource: normalized.slice(sectionStart, sectionEnd)
  };
};

const matchesContext = ({ text = '', start = -1, quote = '', prefixText = '', suffixText = '' }) => {
  if (start < 0 || !quote) return false;
  const before = prefixText ? text.slice(Math.max(0, start - prefixText.length), start) : '';
  const after = suffixText ? text.slice(start + quote.length, start + quote.length + suffixText.length) : '';
  return (!prefixText || before.endsWith(prefixText)) && (!suffixText || after.startsWith(suffixText));
};

const findAllIndexes = (text = '', quote = '') => {
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

export const locateSelectionRange = ({ text = '', anchor = {} }) => {
  const quote = String(anchor?.selectionText || anchor?.textQuote || '').trim();
  const prefixText = String(anchor?.prefixText || anchor?.beforeText || '').trim();
  const suffixText = String(anchor?.suffixText || anchor?.afterText || '').trim();
  if (!quote) return { found: false, start: 0, end: 0, text: '', reason: 'missing_quote' };
  const positions = findAllIndexes(text, quote);
  const contextual = positions.find((start) => matchesContext({ text, start, quote, prefixText, suffixText }));
  if (Number.isFinite(contextual)) {
    return { found: true, start: contextual, end: contextual + quote.length, text: quote, reason: 'context' };
  }
  if (positions.length === 1) {
    return { found: true, start: positions[0], end: positions[0] + quote.length, text: quote, reason: 'single_match' };
  }
  return { found: false, start: 0, end: 0, text: quote, reason: positions.length > 1 ? 'ambiguous_quote' : 'quote_not_found' };
};

export const buildScopedRevisionScope = ({
  sourceMode = 'full',
  baseSource = '',
  targetHeadingId = '',
  selectedRangeAnchor = null,
  fallbackOriginalText = ''
}) => {
  const normalizedBase = normalizeSource(baseSource || '');
  const mode = String(sourceMode || 'full').trim();
  const isScoped = mode === 'selection' || mode === 'section';
  if (!isScoped) {
    return {
      isScoped: false,
      mode: 'full',
      scopeResolved: true,
      originalText: normalizedBase,
      headingTitle: '',
      scopeLabel: '整页修订',
      composeSource: (nextText = '') => normalizeSource(nextText),
      previewSource: normalizedBase,
      normalizedBase
    };
  }

  const section = extractSectionRange(normalizedBase, targetHeadingId || selectedRangeAnchor?.headingId || '');
  if (!section.found) {
    return {
      isScoped: true,
      mode,
      scopeResolved: false,
      originalText: String(fallbackOriginalText || '').trim(),
      headingTitle: '',
      scopeLabel: mode === 'selection' ? '选段修订' : '本节修订',
      resolveMessage: '当前局部范围无法稳定定位到正文源码，暂不能提交此局部修订。',
      composeSource: () => normalizedBase,
      previewSource: normalizedBase,
      normalizedBase,
      headingId: '',
      sectionRange: null,
      selectionRange: null
    };
  }

  if (mode === 'section') {
    const originalText = typeof fallbackOriginalText === 'string' && fallbackOriginalText ? fallbackOriginalText : section.bodySource;
    return {
      isScoped: true,
      mode,
      scopeResolved: true,
      originalText,
      headingId: section.headingId,
      headingTitle: section.title,
      scopeLabel: '本节修订',
      resolveMessage: '',
      composeSource: (nextText = '') => `${normalizedBase.slice(0, section.bodyStart)}${normalizeSource(nextText)}${normalizedBase.slice(section.bodyEnd)}`,
      previewSource: `${normalizedBase.slice(0, section.bodyStart)}${normalizeSource(originalText)}${normalizedBase.slice(section.bodyEnd)}`,
      normalizedBase,
      sectionRange: section,
      selectionRange: null
    };
  }

  const selection = locateSelectionRange({ text: section.bodySource, anchor: selectedRangeAnchor || {} });
  if (!selection.found) {
    const fallbackOriginal = String(fallbackOriginalText || selectedRangeAnchor?.selectionText || '').trim();
    return {
      isScoped: true,
      mode,
      scopeResolved: false,
      originalText: fallbackOriginal,
      headingId: section.headingId,
      headingTitle: section.title,
      scopeLabel: '选段修订',
      resolveMessage: '当前选区含有无法稳定映射的格式内容，请重新选中纯正文文本后再发起修订。',
      composeSource: () => normalizedBase,
      previewSource: normalizedBase,
      normalizedBase,
      sectionRange: section,
      selectionRange: null
    };
  }

  const originalText = typeof fallbackOriginalText === 'string' && fallbackOriginalText ? fallbackOriginalText : section.bodySource.slice(selection.start, selection.end);
  const absoluteStart = section.bodyStart + selection.start;
  const absoluteEnd = section.bodyStart + selection.end;
  return {
    isScoped: true,
    mode,
    scopeResolved: true,
    originalText,
    headingId: section.headingId,
    headingTitle: section.title,
    scopeLabel: '选段修订',
    resolveMessage: '',
    composeSource: (nextText = '') => `${normalizedBase.slice(0, absoluteStart)}${normalizeSource(nextText)}${normalizedBase.slice(absoluteEnd)}`,
    previewSource: `${normalizedBase.slice(0, absoluteStart)}${normalizeSource(originalText)}${normalizedBase.slice(absoluteEnd)}`,
    normalizedBase,
    sectionRange: section,
    selectionRange: {
      ...selection,
      absoluteStart,
      absoluteEnd
    }
  };
};

export const resolveScopedRevisionText = ({
  scope = null,
  currentSource = '',
  fallbackCurrentText = '',
  preferFallbackCurrentText = false
} = {}) => {
  const resolvedScope = scope || buildScopedRevisionScope({});
  const normalizedCurrent = normalizeSource(currentSource || resolvedScope.normalizedBase || '');

  if (!resolvedScope.isScoped) {
    return preferFallbackCurrentText ? normalizeSource(fallbackCurrentText) : normalizedCurrent;
  }

  if (preferFallbackCurrentText) {
    return normalizeSource(fallbackCurrentText);
  }

  if (!resolvedScope.scopeResolved) {
    return normalizeSource(fallbackCurrentText || resolvedScope.originalText || '');
  }

  if (resolvedScope.mode === 'section') {
    const currentSection = extractSectionRange(normalizedCurrent, resolvedScope.headingId || '');
    if (currentSection.found) return currentSection.bodySource;
    return normalizeSource(fallbackCurrentText || resolvedScope.originalText || '');
  }

  return normalizeSource(fallbackCurrentText || resolvedScope.originalText || '');
};

export const buildScopedRevisionState = ({
  scope = null,
  sourceMode = 'full',
  baseSource = '',
  currentSource = '',
  targetHeadingId = '',
  selectedRangeAnchor = null,
  fallbackOriginalText = '',
  fallbackCurrentText = '',
  preferFallbackCurrentText = false
}) => {
  const resolvedScope = scope || buildScopedRevisionScope({
    sourceMode,
    baseSource,
    targetHeadingId,
    selectedRangeAnchor,
    fallbackOriginalText
  });
  const currentText = resolveScopedRevisionText({
    scope: resolvedScope,
    currentSource,
    fallbackCurrentText,
    preferFallbackCurrentText
  });
  return {
    ...resolvedScope,
    currentText,
    previewSource: resolvedScope.isScoped ? resolvedScope.composeSource(currentText) : normalizeSource(currentSource || resolvedScope.normalizedBase || '')
  };
};

const tokenize = (text = '', mode = 'word') => {
  const source = String(text || '');
  if (!source) return [];
  if (mode === 'line') {
    const parts = source.split(/(\n)/);
    return parts.filter((item) => item !== '');
  }
  return source.match(/\s+|[^\s]+/g) || [];
};

const compactTokens = (tokens = []) => tokens.reduce((result, token) => {
  const value = String(token?.value || '');
  if (!value) return result;
  const last = result[result.length - 1];
  if (last && last.type === token.type) {
    last.value += value;
    return result;
  }
  result.push({ type: token.type, value });
  return result;
}, []);

export const buildTrackedChangeTokens = (fromText = '', toText = '') => {
  const wordA = tokenize(fromText, 'word');
  const wordB = tokenize(toText, 'word');
  const mode = wordA.length * wordB.length > 40000 ? 'line' : 'word';
  const a = mode === 'line' ? tokenize(fromText, 'line') : wordA;
  const b = mode === 'line' ? tokenize(toText, 'line') : wordB;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let indexA = a.length - 1; indexA >= 0; indexA -= 1) {
    for (let indexB = b.length - 1; indexB >= 0; indexB -= 1) {
      if (a[indexA] === b[indexB]) dp[indexA][indexB] = dp[indexA + 1][indexB + 1] + 1;
      else dp[indexA][indexB] = Math.max(dp[indexA + 1][indexB], dp[indexA][indexB + 1]);
    }
  }

  const tokens = [];
  let indexA = 0;
  let indexB = 0;
  while (indexA < a.length && indexB < b.length) {
    if (a[indexA] === b[indexB]) {
      tokens.push({ type: 'equal', value: a[indexA] });
      indexA += 1;
      indexB += 1;
    } else if (dp[indexA + 1][indexB] >= dp[indexA][indexB + 1]) {
      tokens.push({ type: 'removed', value: a[indexA] });
      indexA += 1;
    } else {
      tokens.push({ type: 'added', value: b[indexB] });
      indexB += 1;
    }
  }
  while (indexA < a.length) {
    tokens.push({ type: 'removed', value: a[indexA] });
    indexA += 1;
  }
  while (indexB < b.length) {
    tokens.push({ type: 'added', value: b[indexB] });
    indexB += 1;
  }
  return compactTokens(tokens);
};
