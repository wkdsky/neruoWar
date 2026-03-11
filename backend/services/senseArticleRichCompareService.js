const { shortHash } = require('../utils/hash');

const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();
const getTableCellText = (cell = '') => (typeof cell === 'string' ? cell : String(cell?.text || '').trim());

const computeSimilarity = (left = '', right = '') => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  const leftTerms = new Set(a.toLowerCase().split(/[^\w\u4e00-\u9fa5]+/).filter(Boolean));
  const rightTerms = new Set(b.toLowerCase().split(/[^\w\u4e00-\u9fa5]+/).filter(Boolean));
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  let intersect = 0;
  leftTerms.forEach((term) => {
    if (rightTerms.has(term)) intersect += 1;
  });
  return intersect / Math.max(leftTerms.size, rightTerms.size, 1);
};

const resolveBlockKind = (block = {}) => {
  const type = String(block?.type || '').trim();
  if (type === 'heading') return 'heading';
  if (type === 'paragraph') return 'paragraph';
  if (type === 'list') return 'list';
  if (type === 'blockquote') return 'blockquote';
  if (type === 'code_block') return 'code_block';
  if (type === 'table') return 'table';
  if (type === 'image' || type === 'audio' || type === 'video') return 'media';
  if (type === 'horizontal_rule') return 'divider';
  return type || 'block';
};

const buildBlockLabel = (block = {}) => {
  const kind = resolveBlockKind(block);
  if (kind === 'heading') return `标题 H${block.level || 1}`;
  if (kind === 'paragraph') return '段落';
  if (kind === 'list') return block.ordered ? '有序列表' : '无序列表';
  if (kind === 'blockquote') return '引用块';
  if (kind === 'code_block') return '代码块';
  if (kind === 'table') return '表格';
  if (kind === 'media') {
    if (block.type === 'image') return '图片';
    if (block.type === 'audio') return '音频';
    if (block.type === 'video') return '视频';
    return '媒体';
  }
  if (kind === 'divider') return '分割线';
  return '内容块';
};

const buildBlockCompareText = (block = {}) => {
  if (block.type === 'table') {
    return (Array.isArray(block.rows) ? block.rows : [])
      .map((row) => (Array.isArray(row.cells) ? row.cells.map((cell) => getTableCellText(cell)).join(' | ') : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (block.type === 'list') {
    return (Array.isArray(block.items) ? block.items : [])
      .map((item) => item.plainText || '')
      .filter(Boolean)
      .join('\n');
  }
  if (block.type === 'blockquote') {
    return (Array.isArray(block.lines) ? block.lines : [])
      .map((item) => item.plainText || '')
      .filter(Boolean)
      .join('\n');
  }
  return block.plainText || block.value || '';
};

const buildBlockPreview = (block = {}) => {
  if (block.type === 'table') {
    const rows = Array.isArray(block.rows) ? block.rows : [];
    const rowCount = rows.length;
    const colCount = Math.max(0, ...rows.map((row) => (
      Array.isArray(row.cells)
        ? row.cells.reduce((sum, cell) => sum + Math.max(1, Number(cell?.colspan || 1)), 0)
        : 0
    )));
    const widthLabel = block.tableWidthMode === 'auto'
      ? '自适应'
      : `${block.tableWidthValue || '100'}%`;
    return `${rowCount} 行 × ${colCount} 列 · ${block.tableStyle || 'default'} · ${widthLabel}`;
  }
  if (block.type === 'image' || block.type === 'audio' || block.type === 'video') {
    return normalizeText(block.plainText || buildBlockLabel(block));
  }
  return normalizeText(buildBlockCompareText(block)).slice(0, 180);
};

const countTableColumns = (block = {}) => Math.max(0, ...(Array.isArray(block.rows) ? block.rows : []).map((row) => (
  Array.isArray(row.cells)
    ? row.cells.reduce((sum, cell) => sum + Math.max(1, Number(cell?.colspan || 1)), 0)
    : 0
)));

const extractComparableBlocks = (section = {}) => (Array.isArray(section.blocks) ? section.blocks : []).map((block, index) => ({
  key: block.id || `${section.sectionKey || 'section'}:${index}:${shortHash(buildBlockCompareText(block), 8)}`,
  blockId: block.id || '',
  kind: resolveBlockKind(block),
  type: block.type || '',
  label: buildBlockLabel(block),
  compareText: buildBlockCompareText(block),
  previewText: buildBlockPreview(block),
  level: Number(block.level || 0),
  order: index,
  meta: {
    tableStyle: block.tableStyle || '',
    tableWidthMode: block.tableWidthMode || 'auto',
    tableWidthValue: block.tableWidthValue || '100',
    tableBorderPreset: block.tableBorderPreset || 'all',
    columnWidths: Array.isArray(block.columnWidths) ? block.columnWidths.join(',') : '',
    diagonalCellCount: Number(block.diagonalCellCount || 0),
    mergedCellCount: Number(block?.mergeSummary?.mergedCellCount || 0),
    mergedAreaPreview: String(block?.mergeSummary?.areaPreview || ''),
    cellFormatSummary: JSON.stringify(block.cellFormatSummary || {}),
    headerSummary: JSON.stringify(block.headerSummary || {}),
    mediaType: block.type === 'image' || block.type === 'audio' || block.type === 'video' ? block.type : '',
    rowCount: Array.isArray(block.rows) ? block.rows.length : 0,
    colCount: countTableColumns(block),
    itemCount: Array.isArray(block.items) ? block.items.length : 0
  }
}));

const computePairScore = ({ fromBlock, toBlock, fromIndex, toIndex }) => {
  if (!fromBlock || !toBlock) return -1;
  if (fromBlock.kind !== toBlock.kind) return -1;
  const similarity = computeSimilarity(fromBlock.compareText || fromBlock.previewText, toBlock.compareText || toBlock.previewText);
  const orderDistance = Math.abs(fromIndex - toIndex);
  const orderScore = Math.max(0, 0.28 - orderDistance * 0.06);
  let score = similarity + orderScore;

  if (fromBlock.kind === 'heading') {
    if (normalizeText(fromBlock.previewText) === normalizeText(toBlock.previewText)) score += 0.5;
    if (fromBlock.level === toBlock.level) score += 0.08;
  }

  if (fromBlock.kind === 'table') {
    if (fromBlock.meta.rowCount === toBlock.meta.rowCount) score += 0.2;
    if (fromBlock.meta.colCount === toBlock.meta.colCount) score += 0.2;
    if (fromBlock.meta.tableStyle === toBlock.meta.tableStyle) score += 0.08;
  }

  if (fromBlock.kind === 'media') {
    if (fromBlock.meta.mediaType === toBlock.meta.mediaType) score += 0.3;
  }

  if (fromBlock.kind === 'paragraph' || fromBlock.kind === 'blockquote' || fromBlock.kind === 'code_block' || fromBlock.kind === 'list') {
    score += 0.12;
  }

  return score;
};

const pairBlocks = ({ fromBlocks = [], toBlocks = [] }) => {
  const usedTo = new Set();
  const pairs = [];
  fromBlocks.forEach((fromBlock, fromIndex) => {
    let matchedIndex = -1;
    let bestScore = 0;
    toBlocks.forEach((toBlock, toIndex) => {
      if (usedTo.has(toIndex)) return;
      const score = computePairScore({ fromBlock, toBlock, fromIndex, toIndex });
      if (score > bestScore) {
        bestScore = score;
        matchedIndex = toIndex;
      }
    });
    if (matchedIndex >= 0 && bestScore >= 0.36) {
      usedTo.add(matchedIndex);
      pairs.push([fromBlock, toBlocks[matchedIndex]]);
      return;
    }
    pairs.push([fromBlock, null]);
  });
  toBlocks.forEach((toBlock, index) => {
    if (!usedTo.has(index)) pairs.push([null, toBlock]);
  });
  return pairs;
};

const buildBlockDiff = ({ fromSection = null, toSection = null }) => {
  const pairs = pairBlocks({
    fromBlocks: extractComparableBlocks(fromSection || {}),
    toBlocks: extractComparableBlocks(toSection || {})
  });
  const changes = pairs.map(([fromBlock, toBlock]) => {
    if (!fromBlock && toBlock) {
      return {
        status: 'added',
        blockKind: toBlock.kind,
        label: toBlock.label,
        toPreview: toBlock.previewText,
        fromPreview: '',
        details: {
          toMeta: toBlock.meta
        }
      };
    }
    if (fromBlock && !toBlock) {
      return {
        status: 'removed',
        blockKind: fromBlock.kind,
        label: fromBlock.label,
        fromPreview: fromBlock.previewText,
        toPreview: '',
        details: {
          fromMeta: fromBlock.meta
        }
      };
    }
    const isLevelChanged = fromBlock.level !== toBlock.level;
    const isMetaChanged = JSON.stringify(fromBlock.meta || {}) !== JSON.stringify(toBlock.meta || {});
    const similarity = computeSimilarity(fromBlock.compareText || fromBlock.previewText, toBlock.compareText || toBlock.previewText);
    const status = similarity >= 0.985 && !isLevelChanged && !isMetaChanged ? 'equal' : 'modified';
    return {
      status,
      blockKind: toBlock.kind,
      label: toBlock.label,
      fromPreview: fromBlock.previewText,
      toPreview: toBlock.previewText,
      details: {
        levelChanged: isLevelChanged,
        fromLevel: fromBlock.level,
        toLevel: toBlock.level,
        metaChanged: isMetaChanged,
        fromMeta: fromBlock.meta,
        toMeta: toBlock.meta
      }
    };
  });

  const summary = changes.reduce((acc, item) => {
    if (item.status === 'added') acc.added += 1;
    if (item.status === 'removed') acc.removed += 1;
    if (item.status === 'modified') acc.modified += 1;
    if (item.blockKind === 'table' && item.status !== 'equal') acc.tableChanged += 1;
    if (item.blockKind === 'media' && item.status !== 'equal') acc.mediaChanged += 1;
    return acc;
  }, { added: 0, removed: 0, modified: 0, tableChanged: 0, mediaChanged: 0 });

  return {
    changes,
    summary
  };
};

module.exports = {
  buildBlockDiff,
  buildBlockLabel,
  buildBlockPreview,
  buildBlockCompareText,
  extractComparableBlocks
};
