import { findParentNodeClosestToPos } from '@tiptap/core';
import { CellSelection, TableMap, selectedRect } from '@tiptap/pm/tables';
import { normalizeBorderEdges } from './tableSchema';

const TABLE_CELL_TYPES = new Set(['tableCell', 'tableHeader']);
const EMPTY_SELECTION_STATE = Object.freeze({
  isTableActive: false,
  isMultiCellSelection: false,
  canMerge: false,
  canSplit: false,
  currentTableAttrs: {},
  tableStructure: {
    hasHeaderRow: false,
    hasHeaderColumn: false
  },
  currentCellAttrs: {},
  selectionTouchesMergedRows: false,
  selectionTouchesMergedColumns: false,
  selectedCellCount: 0,
  selectedMergedCellCount: 0,
  selectedRangeLabel: '',
  selectionSummaryText: '',
  mergeAvailabilityReason: '',
  splitAvailabilityReason: '',
  deleteRowReason: '',
  deleteColumnReason: '',
  activeCellIsMerged: false
});

const resolveTableContext = (selection) => {
  const table = findParentNodeClosestToPos(selection?.$from, (node) => node.type.name === 'table');
  if (!table) return null;
  const cell = findParentNodeClosestToPos(selection?.$from, (node) => TABLE_CELL_TYPES.has(node.type.name));
  return { table, cell };
};

const getTableStart = (tableContext = null, selection = null) => {
  const tableDepth = Number(tableContext?.table?.depth);
  if (!selection?.$from || !Number.isInteger(tableDepth)) return null;
  try {
    return selection.$from.start(tableDepth);
  } catch (_error) {
    return null;
  }
};

const safeSelectedRect = (state) => {
  if (!state?.selection) return null;
  try {
    return selectedRect(state);
  } catch (_error) {
    return null;
  }
};

const resolveTableStructure = (tableNode = null) => {
  if (!tableNode?.childCount) {
    return {
      hasHeaderRow: false,
      hasHeaderColumn: false
    };
  }

  const firstRow = tableNode.firstChild;
  const hasHeaderRow = !!firstRow?.childCount && Array.from({ length: firstRow.childCount }).every((_, index) => (
    firstRow.child(index)?.type?.name === 'tableHeader'
  ));
  const hasHeaderColumn = Array.from({ length: tableNode.childCount }).every((_, rowIndex) => (
    tableNode.child(rowIndex)?.firstChild?.type?.name === 'tableHeader'
  ));

  return {
    hasHeaderRow,
    hasHeaderColumn
  };
};

const formatSelectionLabel = (rect = null, cellCount = 0) => {
  if (!rect || cellCount <= 0) return '';
  const rowLabel = rect.bottom - rect.top > 1 ? `${rect.top + 1}-${rect.bottom}` : `${rect.top + 1}`;
  const colLabel = rect.right - rect.left > 1 ? `${rect.left + 1}-${rect.right}` : `${rect.left + 1}`;
  return `R${rowLabel} / C${colLabel} · ${cellCount} 格`;
};

const formatSelectionSummary = ({ rect = null, cellCount = 0, activeCell = null, isMultiCellSelection = false } = {}) => {
  if (isMultiCellSelection && rect) {
    return `已选中 ${rect.bottom - rect.top} 行 × ${rect.right - rect.left} 列，共 ${cellCount} 个单元格`;
  }
  if (!activeCell?.rect) return '';
  return `当前单元格：第 ${activeCell.rect.top + 1} 行，第 ${activeCell.rect.left + 1} 列${activeCell.isMerged ? '（合并单元格）' : ''}`;
};

export const getSelectedTableCellEntries = (editor) => {
  const state = editor?.state;
  if (!state?.selection) return [];
  const tableContext = resolveTableContext(state.selection);
  if (!tableContext?.table?.node) return [];
  const rect = safeSelectedRect(state);
  if (!rect?.map) return [];
  const activeCellPos = state.selection instanceof CellSelection ? state.selection.$headCell.pos : tableContext.cell?.pos;
  return rect.map.cellsInRect(rect).map((relativePos) => {
    const absolutePos = rect.tableStart + relativePos;
    const cellNode = state.doc.nodeAt(absolutePos);
    const cellRect = rect.map.findCell(relativePos);
    const rowSpan = Math.max(1, Number(cellNode?.attrs?.rowspan || 1));
    const colSpan = Math.max(1, Number(cellNode?.attrs?.colspan || 1));
    return {
      pos: absolutePos,
      relativePos,
      attrs: cellNode?.attrs || {},
      rect: cellRect,
      isHeader: cellNode?.type?.name === 'tableHeader',
      isMerged: rowSpan > 1 || colSpan > 1,
      rowSpan,
      colSpan,
      isActive: absolutePos === activeCellPos
    };
  });
};

const areComparableValuesEqual = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

export const applyAttrsToSelectedTableCells = (editor, attrsOrResolver) => {
  if (!editor?.state?.selection || !editor?.view?.dispatch) return false;
  const entries = getSelectedTableCellEntries(editor);
  if (entries.length === 0) return false;
  let tr = editor.state.tr;
  let changed = false;

  entries.forEach((entry, index) => {
    const cellNode = tr.doc.nodeAt(entry.pos);
    if (!cellNode) return;
    const patch = typeof attrsOrResolver === 'function'
      ? attrsOrResolver({
        attrs: cellNode.attrs || {},
        entry,
        index,
        entries
      })
      : attrsOrResolver;
    if (!patch || typeof patch !== 'object') return;
    const nextAttrs = { ...cellNode.attrs, ...patch };
    const patchChanged = Object.keys(patch).some((key) => !areComparableValuesEqual(cellNode.attrs?.[key], nextAttrs[key]));
    if (!patchChanged) return;
    tr = tr.setNodeMarkup(entry.pos, undefined, nextAttrs);
    changed = true;
  });

  if (changed) editor.view.dispatch(tr);
  if (typeof editor.view.focus === 'function') editor.view.focus();
  return changed || entries.length > 0;
};

const resolveRelativeCellRect = ({ tableContext, selection, cellPosition = 0 }) => {
  if (!tableContext?.table?.node) return null;
  const tableMap = TableMap.get(tableContext.table.node);
  const tableStart = getTableStart(tableContext, selection);
  if (!Number.isFinite(tableStart)) return null;
  try {
    return tableMap.findCell(cellPosition - tableStart);
  } catch (_error) {
    return null;
  }
};

const resolveSelectionRect = ({ selection, tableContext }) => {
  if (!selection || !tableContext?.table?.node) return null;
  const tableStart = getTableStart(tableContext, selection);
  if (!Number.isFinite(tableStart)) return null;
  if (selection instanceof CellSelection) {
    const tableMap = TableMap.get(tableContext.table.node);
    try {
      const anchorRect = tableMap.findCell(selection.$anchorCell.pos - tableStart);
      const headRect = tableMap.findCell(selection.$headCell.pos - tableStart);
      return {
        left: Math.min(anchorRect.left, headRect.left),
        right: Math.max(anchorRect.right, headRect.right),
        top: Math.min(anchorRect.top, headRect.top),
        bottom: Math.max(anchorRect.bottom, headRect.bottom)
      };
    } catch (_error) {
      return null;
    }
  }
  if (!tableContext.cell) return null;
  return resolveRelativeCellRect({ tableContext, selection, cellPosition: tableContext.cell.pos });
};

export const selectionTouchesMergedCells = ({ selection, kind = 'row', tableContext = null } = {}) => {
  if (!selection || !tableContext?.table?.node) return false;
  const rect = resolveSelectionRect({ selection, tableContext });
  if (!rect) return false;
  const tableMap = TableMap.get(tableContext.table.node);
  const tableNode = tableContext.table.node;
  const seen = new Set();
  for (let index = 0; index < tableMap.map.length; index += 1) {
    const cellPosition = tableMap.map[index];
    if (cellPosition == null || seen.has(cellPosition)) continue;
    seen.add(cellPosition);
    const cellRect = tableMap.findCell(cellPosition);
    const cellNode = tableNode.nodeAt(cellPosition);
    const rowSpan = Number(cellNode?.attrs?.rowspan || 1);
    const colSpan = Number(cellNode?.attrs?.colspan || 1);
    const isMerged = rowSpan > 1 || colSpan > 1;
    if (!isMerged) continue;
    const overlaps = kind === 'column'
      ? cellRect.left < rect.right && cellRect.right > rect.left
      : cellRect.top < rect.bottom && cellRect.bottom > rect.top;
    if (overlaps) return true;
  }
  return false;
};

export const getTableSelectionState = (editor) => {
  if (!editor?.state?.selection) {
    return EMPTY_SELECTION_STATE;
  }
  const selection = editor.state.selection;
  const tableContext = resolveTableContext(selection);
  if (!tableContext?.table) {
    return EMPTY_SELECTION_STATE;
  }
  const entries = getSelectedTableCellEntries(editor);
  const activeCell = entries.find((entry) => entry.isActive) || entries[0] || null;
  const isMultiCellSelection = selection instanceof CellSelection && entries.length > 1;
  const canMerge = editor.can().mergeCells();
  const canSplit = editor.can().splitCell();
  const selectionTouchesMergedRows = selectionTouchesMergedCells({ selection, kind: 'row', tableContext });
  const selectionTouchesMergedColumns = selectionTouchesMergedCells({ selection, kind: 'column', tableContext });
  const selectedRange = safeSelectedRect(editor.state);
  const selectedMergedCellCount = entries.filter((entry) => entry.isMerged).length;
  const currentCellAttrs = activeCell?.attrs || editor.getAttributes('tableCell') || editor.getAttributes('tableHeader') || {};
  const tableStructure = resolveTableStructure(tableContext.table.node);
  const mergeAvailabilityReason = canMerge
    ? ''
    : entries.length <= 1
      ? '至少选中两个相邻单元格后才能合并。'
      : selectedMergedCellCount > 0
        ? '当前选区命中了已有合并单元格，请先调整为合法矩形区域。'
        : '当前选区不是可合并的矩形区域。';
  const splitAvailabilityReason = canSplit
    ? ''
    : activeCell?.isMerged
      ? '请先只聚焦一个合并单元格，再执行拆分。'
      : '当前单元格不是已合并单元格，无法拆分。';
  const currentBorderEdges = normalizeBorderEdges(currentCellAttrs.borderEdges || 'all');
  return {
    isTableActive: true,
    isMultiCellSelection,
    canMerge,
    canSplit,
    currentTableAttrs: editor.getAttributes('table') || {},
    tableStructure,
    currentCellAttrs,
    selectionTouchesMergedRows,
    selectionTouchesMergedColumns,
    selectedCellCount: entries.length,
    selectedMergedCellCount,
    selectedRangeLabel: formatSelectionLabel(selectedRange, entries.length),
    selectionSummaryText: formatSelectionSummary({
      rect: selectedRange,
      cellCount: entries.length,
      activeCell,
      isMultiCellSelection
    }),
    mergeAvailabilityReason,
    splitAvailabilityReason,
    deleteRowReason: selectionTouchesMergedRows ? '当前行与合并单元格相交，请先拆分相关单元格。' : '',
    deleteColumnReason: selectionTouchesMergedColumns ? '当前列与合并单元格相交，请先拆分相关单元格。' : '',
    activeCellIsMerged: !!activeCell?.isMerged,
    activeCellRect: activeCell?.rect || null,
    selectionEdgeState: {
      currentBorderEdges,
      top: entries.length > 0 && entries.every((entry) => normalizeBorderEdges(entry.attrs?.borderEdges || 'all') === 'all' || normalizeBorderEdges(entry.attrs?.borderEdges || 'all').split(',').includes('top')),
      right: entries.length > 0 && entries.every((entry) => normalizeBorderEdges(entry.attrs?.borderEdges || 'all') === 'all' || normalizeBorderEdges(entry.attrs?.borderEdges || 'all').split(',').includes('right')),
      bottom: entries.length > 0 && entries.every((entry) => normalizeBorderEdges(entry.attrs?.borderEdges || 'all') === 'all' || normalizeBorderEdges(entry.attrs?.borderEdges || 'all').split(',').includes('bottom')),
      left: entries.length > 0 && entries.every((entry) => normalizeBorderEdges(entry.attrs?.borderEdges || 'all') === 'all' || normalizeBorderEdges(entry.attrs?.borderEdges || 'all').split(',').includes('left'))
    }
  };
};
