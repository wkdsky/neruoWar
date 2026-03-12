import { buildTableWidthPayload, DEFAULT_TABLE_WIDTH_MODE, DEFAULT_TABLE_WIDTH_VALUE, resolveTableWidthValue } from './tableWidthUtils';

export const TABLE_STYLE_OPTIONS = Object.freeze(['default', 'compact', 'zebra', 'three-line']);
export const TABLE_BORDER_PRESETS = Object.freeze(['all', 'none', 'outer', 'inner-horizontal', 'inner-vertical', 'three-line']);
export const TABLE_BORDER_PRESET_OPTIONS = Object.freeze(['all', 'none', 'outer', 'three-line']);
export const TABLE_ALIGN_OPTIONS = Object.freeze(['left', 'center', 'right']);
export const TABLE_VERTICAL_ALIGN_OPTIONS = Object.freeze(['top', 'middle', 'bottom']);
export const TABLE_DIAGONAL_MODES = Object.freeze(['none', 'tl-br', 'tr-bl']);
export const TABLE_BORDER_EDGE_OPTIONS = Object.freeze(['top', 'right', 'bottom', 'left']);
export const TABLE_BORDER_WIDTH_OPTIONS = Object.freeze(['1', '2', '3']);
export const TABLE_COLOR_PALETTE = Object.freeze(['#0f172a', '#475569', '#0369a1', '#0f766e', '#b45309', '#b91c1c']);
export const TABLE_BACKGROUND_PALETTE = Object.freeze(['#ffffff', '#f8fafc', '#fef3c7', '#dcfce7', '#dbeafe', '#fde68a', '#fecaca']);

export const TABLE_STYLE_CLASS_MAP = Object.freeze({
  default: 'table-style-default',
  compact: 'table-style-compact',
  zebra: 'table-style-zebra',
  'three-line': 'table-style-three-line'
});

export const TABLE_BORDER_CLASS_MAP = Object.freeze({
  all: 'table-border-all',
  none: 'table-border-none',
  outer: 'table-border-outer',
  'inner-horizontal': 'table-border-inner-horizontal',
  'inner-vertical': 'table-border-inner-vertical',
  'three-line': 'table-border-three-line'
});

export const DEFAULT_TABLE_ATTRIBUTES = Object.freeze({
  tableStyle: 'default',
  tableBorderPreset: 'all',
  tableAlign: 'left',
  tableWidthMode: DEFAULT_TABLE_WIDTH_MODE,
  tableWidthValue: String(DEFAULT_TABLE_WIDTH_VALUE),
  columnWidths: ''
});

export const DEFAULT_CELL_ATTRIBUTES = Object.freeze({
  textAlign: 'left',
  verticalAlign: 'top',
  backgroundColor: '',
  textColor: '',
  borderEdges: '',
  borderWidth: '',
  borderColor: '',
  diagonalMode: 'none',
  colwidth: null
});

const SAFE_COLOR_PATTERNS = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgb(a)?\([\d\s.,%]+\)$/i,
  /^hsl(a)?\([\d\s.,%]+\)$/i
];

const parseDelimitedWidths = (value = '') => String(value || '')
  .split(',')
  .map((item) => Number.parseInt(String(item || '').trim(), 10))
  .filter((item) => Number.isFinite(item) && item >= 40 && item <= 1200);

export const serializeColumnWidths = (value = []) => {
  const widths = Array.isArray(value) ? value : parseDelimitedWidths(value);
  return widths
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item >= 40 && item <= 1200)
    .join(',');
};

export const parseColumnWidths = (value = '') => parseDelimitedWidths(value);

export const normalizeTableStyle = (value = '') => (
  TABLE_STYLE_OPTIONS.includes(String(value || '').trim()) ? String(value || '').trim() : DEFAULT_TABLE_ATTRIBUTES.tableStyle
);

export const normalizeTableBorderPreset = (value = '') => (
  TABLE_BORDER_PRESETS.includes(String(value || '').trim()) ? String(value || '').trim() : DEFAULT_TABLE_ATTRIBUTES.tableBorderPreset
);

export const normalizeTableAlign = (value = '') => (
  TABLE_ALIGN_OPTIONS.includes(String(value || '').trim()) ? String(value || '').trim() : DEFAULT_TABLE_ATTRIBUTES.tableAlign
);

export const normalizeVerticalAlign = (value = '') => (
  TABLE_VERTICAL_ALIGN_OPTIONS.includes(String(value || '').trim()) ? String(value || '').trim() : DEFAULT_CELL_ATTRIBUTES.verticalAlign
);

export const normalizeDiagonalMode = (value = '') => (
  TABLE_DIAGONAL_MODES.includes(String(value || '').trim()) ? String(value || '').trim() : DEFAULT_CELL_ATTRIBUTES.diagonalMode
);

export const normalizeBorderWidth = (value = '') => (
  TABLE_BORDER_WIDTH_OPTIONS.includes(String(value || '').trim()) ? String(value || '').trim() : ''
);

export const normalizeColor = (value = '') => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return '';
  return SAFE_COLOR_PATTERNS.some((pattern) => pattern.test(normalizedValue)) ? normalizedValue : '';
};

export const normalizeBorderEdges = (value = '') => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue || normalizedValue === 'all') return 'all';
  if (normalizedValue === 'none') return 'none';
  const entries = normalizedValue
    .split(',')
    .map((item) => item.trim())
    .filter((item) => TABLE_BORDER_EDGE_OPTIONS.includes(item));
  if (entries.length === 0) return '';
  return Array.from(new Set(entries))
    .sort((left, right) => TABLE_BORDER_EDGE_OPTIONS.indexOf(left) - TABLE_BORDER_EDGE_OPTIONS.indexOf(right))
    .join(',');
};

export const normalizeExplicitBorderEdges = (value = '') => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return '';
  if (normalizedValue === 'all') return 'all';
  if (normalizedValue === 'none') return 'none';
  const entries = normalizedValue
    .split(',')
    .map((item) => item.trim())
    .filter((item) => TABLE_BORDER_EDGE_OPTIONS.includes(item));
  if (entries.length === 0) return '';
  return Array.from(new Set(entries))
    .sort((left, right) => TABLE_BORDER_EDGE_OPTIONS.indexOf(left) - TABLE_BORDER_EDGE_OPTIONS.indexOf(right))
    .join(',');
};

export const isBorderEdgeEnabled = (borderEdges = '', edge = '') => {
  const normalizedEdge = String(edge || '').trim();
  if (!TABLE_BORDER_EDGE_OPTIONS.includes(normalizedEdge)) return false;
  const normalizedValue = normalizeBorderEdges(borderEdges);
  if (!normalizedValue || normalizedValue === 'all') return true;
  if (normalizedValue === 'none') return false;
  return normalizedValue.split(',').includes(normalizedEdge);
};

export const buildTableAttributesPayload = (attributes = {}) => {
  const widthPayload = buildTableWidthPayload(attributes);
  const tableStyle = normalizeTableStyle(attributes.tableStyle);
  const tableBorderPreset = normalizeTableBorderPreset(attributes.tableBorderPreset || (tableStyle === 'three-line' ? 'three-line' : 'all'));
  return {
    tableStyle,
    tableBorderPreset,
    tableAlign: normalizeTableAlign(attributes.tableAlign),
    tableWidthMode: widthPayload.tableWidthMode,
    tableWidthValue: widthPayload.tableWidthValue,
    columnWidths: serializeColumnWidths(attributes.columnWidths)
  };
};

export const buildTableClassName = (attributes = {}) => {
  const tableStyle = normalizeTableStyle(attributes.tableStyle);
  const tableBorderPreset = normalizeTableBorderPreset(attributes.tableBorderPreset || (tableStyle === 'three-line' ? 'three-line' : 'all'));
  return [
    'sense-rich-table',
    TABLE_STYLE_CLASS_MAP[tableStyle] || TABLE_STYLE_CLASS_MAP.default,
    TABLE_BORDER_CLASS_MAP[tableBorderPreset] || TABLE_BORDER_CLASS_MAP.all
  ].filter(Boolean).join(' ');
};

export const resolveTableWidthStyle = (attributes = {}) => {
  const widthValue = resolveTableWidthValue(attributes);
  if (!widthValue) return '';
  return `width: ${widthValue}%`;
};

export const resolveTableAlignStyle = (attributes = {}) => {
  const tableAlign = normalizeTableAlign(attributes.tableAlign);
  if (tableAlign === 'center') return 'margin-left: auto; margin-right: auto';
  if (tableAlign === 'right') return 'margin-left: auto; margin-right: 0';
  return 'margin-left: 0; margin-right: auto';
};

export const buildCellClassName = (attributes = {}) => {
  const classes = [];
  const diagonalMode = normalizeDiagonalMode(attributes.diagonalMode);
  const verticalAlign = normalizeVerticalAlign(attributes.verticalAlign);
  if (diagonalMode !== 'none') classes.push(`table-cell-diagonal-${diagonalMode}`);
  if (verticalAlign !== 'top') classes.push(`table-cell-valign-${verticalAlign}`);
  return classes.join(' ');
};

export const buildCellDataAttributes = (attributes = {}) => {
  const borderEdges = normalizeExplicitBorderEdges(attributes.borderEdges);
  const borderWidth = normalizeBorderWidth(attributes.borderWidth);
  const backgroundColor = normalizeColor(attributes.backgroundColor);
  const textColor = normalizeColor(attributes.textColor);
  const diagonalMode = normalizeDiagonalMode(attributes.diagonalMode);
  const colwidth = serializeColumnWidths(attributes.colwidth).split(',')[0] || '';
  return {
    'data-align': attributes.textAlign || DEFAULT_CELL_ATTRIBUTES.textAlign,
    'data-vertical-align': normalizeVerticalAlign(attributes.verticalAlign),
    'data-background-color': backgroundColor || undefined,
    'data-text-color': textColor || undefined,
    'data-border-edges': borderEdges || undefined,
    'data-border-width': borderWidth || undefined,
    'data-border-color': normalizeColor(attributes.borderColor) || undefined,
    'data-diagonal': diagonalMode !== 'none' ? diagonalMode : undefined,
    'data-colwidth': colwidth || undefined
  };
};

export const buildCellInlineStyle = (attributes = {}) => {
  const style = [];
  const textAlign = String(attributes.textAlign || DEFAULT_CELL_ATTRIBUTES.textAlign).trim() || DEFAULT_CELL_ATTRIBUTES.textAlign;
  const verticalAlign = normalizeVerticalAlign(attributes.verticalAlign);
  const backgroundColor = normalizeColor(attributes.backgroundColor);
  const textColor = normalizeColor(attributes.textColor);
  const borderEdges = normalizeExplicitBorderEdges(attributes.borderEdges);
  const borderWidth = normalizeBorderWidth(attributes.borderWidth);
  const borderColor = normalizeColor(attributes.borderColor);
  const widthValue = serializeColumnWidths(attributes.colwidth).split(',')[0] || '';
  style.push(`text-align: ${textAlign}`);
  if (verticalAlign !== 'top') style.push(`vertical-align: ${verticalAlign}`);
  if (backgroundColor) style.push(`background-color: ${backgroundColor}`);
  if (textColor) style.push(`color: ${textColor}`);
  if (widthValue) style.push(`width: ${widthValue}px`);
  if (borderEdges) {
    const effectiveBorderWidth = borderWidth || '1';
    const effectiveBorderColor = borderColor || '#334155';
    TABLE_BORDER_EDGE_OPTIONS.forEach((edge) => {
      const property = `border-${edge}`;
      if (borderEdges === 'none') {
        style.push(`${property}: none`);
        return;
      }
      if (isBorderEdgeEnabled(borderEdges, edge)) {
        style.push(`${property}: ${effectiveBorderWidth}px solid ${effectiveBorderColor}`);
      } else {
        style.push(`${property}: none`);
      }
    });
  }
  return style.join('; ');
};

export const extractColumnWidthsFromTableNode = (node = null) => {
  if (!node?.firstChild) return [];
  const widths = [];
  const firstRow = node.firstChild;
  for (let index = 0; index < firstRow.childCount; index += 1) {
    const cell = firstRow.child(index);
    const { colspan, colwidth } = cell.attrs || {};
    const normalizedWidths = Array.isArray(colwidth) ? colwidth : [];
    for (let offset = 0; offset < (Number(colspan) || 1); offset += 1) {
      const widthValue = Number.parseInt(normalizedWidths[offset], 10);
      widths.push(Number.isFinite(widthValue) ? widthValue : 0);
    }
  }
  return widths.filter((item) => Number.isFinite(item) && item > 0);
};
