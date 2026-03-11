const TABLE_STYLE_OPTIONS = new Set(['default', 'compact', 'zebra', 'three-line']);
const TABLE_BORDER_PRESETS = new Set(['all', 'none', 'outer', 'inner-horizontal', 'inner-vertical', 'three-line']);
const TABLE_WIDTH_MODES = new Set(['auto', 'narrow', 'medium', 'wide', 'full', 'custom']);
const TABLE_VERTICAL_ALIGN_OPTIONS = new Set(['top', 'middle', 'bottom']);
const TABLE_DIAGONAL_MODES = new Set(['none', 'tl-br', 'tr-bl']);
const TABLE_BORDER_EDGE_OPTIONS = ['top', 'right', 'bottom', 'left'];
const TABLE_BORDER_WIDTH_OPTIONS = new Set(['1', '2', '3']);
const SAFE_COLOR_PATTERNS = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgb(a)?\([\d\s.,%]+\)$/i,
  /^hsl(a)?\([\d\s.,%]+\)$/i
];

const DEFAULT_TABLE_META = Object.freeze({
  tableStyle: 'default',
  tableWidthMode: 'auto',
  tableWidthValue: '100',
  tableBorderPreset: 'all',
  columnWidths: []
});

const normalizeEnum = (value = '', allowSet = new Set(), fallback = '') => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return fallback;
  return allowSet.has(normalizedValue) ? normalizedValue : fallback;
};

const normalizeColor = (value = '') => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return '';
  return SAFE_COLOR_PATTERNS.some((pattern) => pattern.test(normalizedValue)) ? normalizedValue : '';
};

const normalizeBorderEdges = (value = '') => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue || normalizedValue === 'all') return 'all';
  if (normalizedValue === 'none') return 'none';
  const edges = normalizedValue
    .split(',')
    .map((item) => item.trim())
    .filter((item) => TABLE_BORDER_EDGE_OPTIONS.includes(item));
  if (edges.length === 0) return '';
  return Array.from(new Set(edges))
    .sort((left, right) => TABLE_BORDER_EDGE_OPTIONS.indexOf(left) - TABLE_BORDER_EDGE_OPTIONS.indexOf(right))
    .join(',');
};

const parseColumnWidths = (value = '') => String(value || '')
  .split(',')
  .map((item) => Number.parseInt(String(item || '').trim(), 10))
  .filter((item) => Number.isFinite(item) && item >= 40 && item <= 1200);

const serializeColumnWidths = (value = []) => {
  const widths = Array.isArray(value) ? value : parseColumnWidths(value);
  return widths
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item >= 40 && item <= 1200)
    .join(',');
};

const normalizeTableWidthValue = (value = '') => {
  const numericValue = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(numericValue)) return DEFAULT_TABLE_META.tableWidthValue;
  return String(Math.min(100, Math.max(40, numericValue)));
};

const extractCellText = (cell = null) => String(cell?.text || '').trim();

const extractTableCellMeta = (cell = null) => {
  const rowspan = Math.max(1, Number.parseInt(cell?.getAttribute?.('rowspan') || '1', 10) || 1);
  const colspan = Math.max(1, Number.parseInt(cell?.getAttribute?.('colspan') || '1', 10) || 1);
  const borderWidth = normalizeEnum(cell?.getAttribute?.('data-border-width') || '', TABLE_BORDER_WIDTH_OPTIONS, '');
  const diagonalMode = normalizeEnum(cell?.getAttribute?.('data-diagonal') || '', TABLE_DIAGONAL_MODES, 'none');
  return {
    text: extractCellText(cell),
    isHeader: String(cell?.tagName || '').toLowerCase() === 'th',
    rowspan,
    colspan,
    textAlign: String(cell?.getAttribute?.('data-align') || '').trim() || 'left',
    verticalAlign: normalizeEnum(cell?.getAttribute?.('data-vertical-align') || '', TABLE_VERTICAL_ALIGN_OPTIONS, 'top'),
    backgroundColor: normalizeColor(cell?.getAttribute?.('data-background-color') || ''),
    textColor: normalizeColor(cell?.getAttribute?.('data-text-color') || ''),
    borderEdges: normalizeBorderEdges(cell?.getAttribute?.('data-border-edges') || ''),
    borderWidth,
    borderColor: normalizeColor(cell?.getAttribute?.('data-border-color') || ''),
    diagonalMode,
    columnWidth: parseColumnWidths(cell?.getAttribute?.('data-colwidth') || '')[0] || null
  };
};

const summarizeCellFormats = (rows = []) => {
  const summary = {
    backgroundCellCount: 0,
    textColorCellCount: 0,
    borderOverrideCount: 0,
    diagonalCellCount: 0,
    verticalAlignments: [],
    alignments: [],
    diagonalModes: [],
    borderWidths: [],
    borderColors: []
  };
  const alignments = new Set();
  const verticalAlignments = new Set();
  const diagonalModes = new Set();
  const borderWidths = new Set();
  const borderColors = new Set();
  rows.forEach((row) => {
    (Array.isArray(row?.cells) ? row.cells : []).forEach((cell) => {
      if (!cell) return;
      if (cell.backgroundColor) summary.backgroundCellCount += 1;
      if (cell.textColor) summary.textColorCellCount += 1;
      if (cell.borderEdges || cell.borderWidth || cell.borderColor) summary.borderOverrideCount += 1;
      if (cell.diagonalMode && cell.diagonalMode !== 'none') summary.diagonalCellCount += 1;
      if (cell.textAlign) alignments.add(cell.textAlign);
      if (cell.verticalAlign) verticalAlignments.add(cell.verticalAlign);
      if (cell.diagonalMode && cell.diagonalMode !== 'none') diagonalModes.add(cell.diagonalMode);
      if (cell.borderWidth) borderWidths.add(cell.borderWidth);
      if (cell.borderColor) borderColors.add(cell.borderColor);
    });
  });
  summary.alignments = Array.from(alignments);
  summary.verticalAlignments = Array.from(verticalAlignments);
  summary.diagonalModes = Array.from(diagonalModes);
  summary.borderWidths = Array.from(borderWidths);
  summary.borderColors = Array.from(borderColors);
  return summary;
};

const buildMergedAreaSummary = (rows = []) => {
  const occupied = new Set();
  const mergedAreas = [];

  rows.forEach((row, rowIndex) => {
    let columnCursor = 0;
    (Array.isArray(row?.cells) ? row.cells : []).forEach((cell) => {
      while (occupied.has(`${rowIndex}:${columnCursor}`)) columnCursor += 1;
      const rowspan = Math.max(1, Number(cell?.rowspan || 1));
      const colspan = Math.max(1, Number(cell?.colspan || 1));
      if (rowspan > 1 || colspan > 1) {
        const rowStart = rowIndex + 1;
        const rowEnd = rowIndex + rowspan;
        const colStart = columnCursor + 1;
        const colEnd = columnCursor + colspan;
        mergedAreas.push({
          rowStart,
          rowEnd,
          colStart,
          colEnd,
          label: `R${rowStart}${rowEnd > rowStart ? `-${rowEnd}` : ''} / C${colStart}${colEnd > colStart ? `-${colEnd}` : ''}`
        });
      }
      for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
        for (let colOffset = 0; colOffset < colspan; colOffset += 1) {
          occupied.add(`${rowIndex + rowOffset}:${columnCursor + colOffset}`);
        }
      }
      columnCursor += colspan;
    });
  });

  return {
    areas: mergedAreas,
    areaPreview: mergedAreas.slice(0, 4).map((item) => item.label).join(', ')
  };
};

const extractTableMetaFromElement = (table = null) => {
  const rows = table?.querySelectorAll?.('tr').map((row, rowIndex) => ({
    id: `row_${rowIndex + 1}`,
    cells: row.querySelectorAll('th,td').map((cell) => extractTableCellMeta(cell))
  })) || [];
  const columnWidths = parseColumnWidths(table?.getAttribute?.('data-column-widths') || '');
  const colCount = Math.max(0, ...rows.map((row) => (
    (Array.isArray(row.cells) ? row.cells : []).reduce((sum, cell) => sum + Math.max(1, Number(cell?.colspan || 1)), 0)
  )));
  const mergedCells = rows.flatMap((row) => row.cells || []).filter((cell) => Number(cell?.rowspan || 1) > 1 || Number(cell?.colspan || 1) > 1);
  const diagonalCellCount = rows.flatMap((row) => row.cells || []).filter((cell) => cell.diagonalMode && cell.diagonalMode !== 'none').length;
  const hasHeaderRow = rows.length > 0 && (rows[0].cells || []).every((cell) => cell?.isHeader);
  const hasHeaderColumn = rows.length > 0 && rows.every((row) => row?.cells?.[0]?.isHeader);
  const mergedAreaSummary = buildMergedAreaSummary(rows);
  return {
    tableStyle: normalizeEnum(table?.getAttribute?.('data-table-style') || '', TABLE_STYLE_OPTIONS, DEFAULT_TABLE_META.tableStyle),
    tableWidthMode: normalizeEnum(table?.getAttribute?.('data-table-width-mode') || '', TABLE_WIDTH_MODES, DEFAULT_TABLE_META.tableWidthMode),
    tableWidthValue: normalizeTableWidthValue(table?.getAttribute?.('data-table-width-value') || DEFAULT_TABLE_META.tableWidthValue),
    tableBorderPreset: normalizeEnum(table?.getAttribute?.('data-table-border-preset') || '', TABLE_BORDER_PRESETS, DEFAULT_TABLE_META.tableBorderPreset),
    columnWidths: columnWidths.length > 0 ? columnWidths : rows.flatMap((row, rowIndex) => (
      rowIndex === 0
        ? (row.cells || []).map((cell) => cell.columnWidth).filter((item) => Number.isFinite(Number(item)))
        : []
    )),
    rowCount: rows.length,
    colCount,
    hasHeaderRow,
    hasHeaderColumn,
    diagonalCellCount,
    mergedCellCount: mergedCells.length,
    mergeSummary: {
      hasMergedCells: mergedCells.length > 0,
      mergedCellCount: mergedCells.length,
      maxRowspan: Math.max(1, ...mergedCells.map((cell) => Number(cell.rowspan || 1))),
      maxColspan: Math.max(1, ...mergedCells.map((cell) => Number(cell.colspan || 1))),
      areas: mergedAreaSummary.areas,
      areaPreview: mergedAreaSummary.areaPreview
    },
    headerSummary: {
      hasHeaderRow,
      hasHeaderColumn,
      headerCellCount: rows.flatMap((row) => row.cells || []).filter((cell) => cell.isHeader).length
    },
    cellFormatSummary: summarizeCellFormats(rows),
    rows
  };
};

const buildTableCompareDigest = (tableMeta = {}) => JSON.stringify({
  tableStyle: tableMeta.tableStyle || DEFAULT_TABLE_META.tableStyle,
  tableWidthMode: tableMeta.tableWidthMode || DEFAULT_TABLE_META.tableWidthMode,
  tableWidthValue: tableMeta.tableWidthValue || DEFAULT_TABLE_META.tableWidthValue,
  tableBorderPreset: tableMeta.tableBorderPreset || DEFAULT_TABLE_META.tableBorderPreset,
  columnWidths: serializeColumnWidths(tableMeta.columnWidths || []),
  diagonalCellCount: Number(tableMeta.diagonalCellCount || 0),
  mergedCellCount: Number(tableMeta?.mergeSummary?.mergedCellCount || tableMeta.mergedCellCount || 0),
  mergedAreaPreview: tableMeta?.mergeSummary?.areaPreview || '',
  headerSummary: tableMeta.headerSummary || {},
  cellFormatSummary: tableMeta.cellFormatSummary || {}
});

module.exports = {
  DEFAULT_TABLE_META,
  TABLE_BORDER_EDGE_OPTIONS,
  TABLE_BORDER_PRESETS,
  TABLE_BORDER_WIDTH_OPTIONS,
  TABLE_DIAGONAL_MODES,
  TABLE_STYLE_OPTIONS,
  TABLE_VERTICAL_ALIGN_OPTIONS,
  TABLE_WIDTH_MODES,
  buildTableCompareDigest,
  extractTableCellMeta,
  extractTableMetaFromElement,
  normalizeBorderEdges,
  normalizeColor,
  normalizeEnum,
  normalizeTableWidthValue,
  parseColumnWidths,
  serializeColumnWidths
};
