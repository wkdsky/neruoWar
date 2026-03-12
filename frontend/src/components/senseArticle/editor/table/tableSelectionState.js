import { findParentNodeClosestToPos } from '@tiptap/core';
import { CellSelection, TableMap, selectedRect } from '@tiptap/pm/tables';
import {
  normalizeExplicitBorderEdges,
  normalizeTableBorderPreset,
  TABLE_BORDER_EDGE_OPTIONS
} from './tableSchema';
import { isSenseEditorDebugEnabled, senseEditorDebugLog } from '../editorDebug';

const TABLE_CELL_TYPES = new Set(['tableCell', 'tableHeader']);
const EMPTY_SELECTION_STATE = Object.freeze({
  isTableActive: false,
  isMultiCellSelection: false,
  isEntireTableSelected: false,
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

export const isCellSelection = (selection = null) => selection instanceof CellSelection;

const areComparableValuesEqual = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const pickDebugCellAttrs = (attrs = {}) => ({
  textAlign: attrs.textAlign,
  verticalAlign: attrs.verticalAlign,
  backgroundColor: attrs.backgroundColor,
  textColor: attrs.textColor,
  borderEdges: attrs.borderEdges,
  borderWidth: attrs.borderWidth,
  borderColor: attrs.borderColor,
  diagonalMode: attrs.diagonalMode
});

const EDGE_OPPOSITE_MAP = Object.freeze({
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right'
});

const buildEdgeSetFromExplicitValue = (value = '') => {
  const normalizedValue = normalizeExplicitBorderEdges(value);
  if (normalizedValue === 'all') return new Set(TABLE_BORDER_EDGE_OPTIONS);
  if (!normalizedValue || normalizedValue === 'none') return new Set();
  return new Set(normalizedValue.split(',').filter(Boolean));
};

export const resolveEffectiveTableCellEdges = ({
  cellAttrs = {},
  cellRect = null,
  tableBorderPreset = 'all',
  tableWidth = 0,
  tableHeight = 0
} = {}) => {
  const explicitEdges = normalizeExplicitBorderEdges(cellAttrs.borderEdges || '');
  if (explicitEdges) return buildEdgeSetFromExplicitValue(explicitEdges);

  const normalizedPreset = normalizeTableBorderPreset(tableBorderPreset);
  const isFirstRow = Number(cellRect?.top) === 0;
  const isLastRow = Number(cellRect?.bottom) === Number(tableHeight);
  const isFirstColumn = Number(cellRect?.left) === 0;
  const isLastColumn = Number(cellRect?.right) === Number(tableWidth);

  if (normalizedPreset === 'none') return new Set();
  if (normalizedPreset === 'outer') {
    const edgeSet = new Set();
    if (isFirstRow) edgeSet.add('top');
    if (isLastRow) edgeSet.add('bottom');
    if (isFirstColumn) edgeSet.add('left');
    if (isLastColumn) edgeSet.add('right');
    return edgeSet;
  }
  if (normalizedPreset === 'three-line') {
    const edgeSet = new Set();
    if (isFirstRow) {
      edgeSet.add('top');
      edgeSet.add('bottom');
    }
    if (isLastRow) edgeSet.add('bottom');
    return edgeSet;
  }

  return new Set(TABLE_BORDER_EDGE_OPTIONS);
};

export const isTableCellEdgeVisible = ({
  cellAttrs = {},
  cellRect = null,
  tableBorderPreset = 'all',
  tableWidth = 0,
  tableHeight = 0,
  edge = ''
} = {}) => (
  resolveEffectiveTableCellEdges({
    cellAttrs,
    cellRect,
    tableBorderPreset,
    tableWidth,
    tableHeight
  }).has(String(edge || '').trim())
);

export const applyAttrsToSelectedTableCells = (editor, attrsOrResolver) => {
  if (!editor?.state?.selection || !editor?.view?.dispatch) return false;
  const originalSelection = editor.state.selection;
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
    senseEditorDebugLog('table-selection', 'Patching table cell attrs', {
      pos: entry.pos,
      patch,
      prevAttrs: pickDebugCellAttrs(cellNode.attrs || {}),
      nextAttrs: pickDebugCellAttrs(nextAttrs)
    });
    tr = tr.setNodeMarkup(entry.pos, null, nextAttrs);
    changed = true;
  });

  if (changed) {
    if (originalSelection instanceof CellSelection) {
      try {
        tr = tr.setSelection(CellSelection.create(
          tr.doc,
          tr.mapping.map(originalSelection.$anchorCell.pos),
          tr.mapping.map(originalSelection.$headCell.pos)
        ));
      } catch (_error) {
        // Ignore selection restoration errors and fall back to the mapped transaction selection.
      }
    }
    const changedDoc = !!tr.docChanged;
    editor.view.dispatch(tr);
    if (isSenseEditorDebugEnabled()) {
      const appliedHtml = String(editor.getHTML?.() || '');
      const patchKeys = entries.flatMap((entry, index) => {
        const cellNode = editor.state.doc.nodeAt(entry.pos);
        const patch = typeof attrsOrResolver === 'function'
          ? attrsOrResolver({
            attrs: cellNode?.attrs || {},
            entry,
            index,
            entries
          })
          : attrsOrResolver;
        return patch && typeof patch === 'object' ? Object.keys(patch) : [];
      });
      senseEditorDebugLog('table-selection', 'Applied table cell attrs', {
        changed,
        docChanged: changedDoc,
        selectedCellCount: entries.length,
        firstCellAttrsAfter: pickDebugCellAttrs(editor.state.doc.nodeAt(entries[0].pos)?.attrs || {}),
        htmlContains: Array.from(new Set(patchKeys)).reduce((result, key) => {
          const dataKey = key === 'textAlign'
            ? 'data-align'
            : key === 'verticalAlign'
              ? 'data-vertical-align'
              : key === 'backgroundColor'
                ? 'data-background-color'
                : key === 'textColor'
                  ? 'data-text-color'
                  : key === 'borderEdges'
                    ? 'data-border-edges'
                    : key === 'borderWidth'
                      ? 'data-border-width'
                      : key === 'borderColor'
                        ? 'data-border-color'
                        : key === 'diagonalMode'
                          ? 'data-diagonal'
                          : '';
          if (dataKey) result[dataKey] = appliedHtml.includes(dataKey);
          return result;
        }, {}),
        selectionFrom: editor.state.selection?.from,
        selectionTo: editor.state.selection?.to
      });
    }
  }
  return changed || entries.length > 0;
};

const getNeighborCoordinatesForEdge = (rect = null, edge = '') => {
  const coordinates = [];
  if (!rect) return coordinates;
  if (edge === 'top') {
    const row = Number(rect.top) - 1;
    if (row < 0) return coordinates;
    for (let col = Number(rect.left); col < Number(rect.right); col += 1) {
      coordinates.push({ row, col });
    }
    return coordinates;
  }
  if (edge === 'bottom') {
    const row = Number(rect.bottom);
    for (let col = Number(rect.left); col < Number(rect.right); col += 1) {
      coordinates.push({ row, col });
    }
    return coordinates;
  }
  if (edge === 'left') {
    const col = Number(rect.left) - 1;
    if (col < 0) return coordinates;
    for (let row = Number(rect.top); row < Number(rect.bottom); row += 1) {
      coordinates.push({ row, col });
    }
    return coordinates;
  }
  if (edge === 'right') {
    const col = Number(rect.right);
    for (let row = Number(rect.top); row < Number(rect.bottom); row += 1) {
      coordinates.push({ row, col });
    }
  }
  return coordinates;
};

const resolveTableCellRectByAbsolutePos = ({ tableMap, tableStart, absolutePos }) => {
  if (!tableMap || !Number.isFinite(tableStart) || !Number.isFinite(absolutePos)) return null;
  try {
    return tableMap.findCell(absolutePos - tableStart);
  } catch (_error) {
    return null;
  }
};

const collectSharedEdgeNeighborCells = ({ entry = null, edge = '', tableMap, tableStart = 0 }) => {
  const coordinates = getNeighborCoordinatesForEdge(entry?.rect, edge);
  const neighbors = [];
  const seen = new Set();
  coordinates.forEach(({ row, col }) => {
    if (row < 0 || col < 0 || row >= tableMap.height || col >= tableMap.width) return;
    const relativePos = tableMap.map[(row * tableMap.width) + col];
    if (!Number.isFinite(relativePos)) return;
    const absolutePos = tableStart + relativePos;
    if (!Number.isFinite(absolutePos) || absolutePos === entry?.pos || seen.has(absolutePos)) return;
    seen.add(absolutePos);
    neighbors.push({
      pos: absolutePos,
      rect: resolveTableCellRectByAbsolutePos({ tableMap, tableStart, absolutePos })
    });
  });
  return neighbors;
};

export const applySyncedTableBorderEdge = ({
  editor,
  selectionState = null,
  edge = '',
  borderWidth = '',
  borderColor = ''
} = {}) => {
  if (!editor?.state?.selection || !editor?.view?.dispatch) return false;
  const originalSelection = editor.state.selection;
  if (!TABLE_BORDER_EDGE_OPTIONS.includes(String(edge || '').trim())) return false;

  const entries = getSelectedTableCellEntries(editor);
  if (entries.length === 0) return false;

  const selection = editor.state.selection;
  const tableContext = resolveTableContext(selection);
  const tableNode = tableContext?.table?.node;
  const tableStart = getTableStart(tableContext, selection);
  if (!tableNode || !Number.isFinite(tableStart)) return false;

  const tableMap = TableMap.get(tableNode);
  const tableBorderPreset = tableNode.attrs?.tableBorderPreset;
  const shouldEnable = !selectionState?.selectionEdgeState?.[edge];
  const patchStateMap = new Map();

  const getOrCreatePatchState = (absolutePos, cellRect = null) => {
    if (!Number.isFinite(absolutePos)) return null;
    if (patchStateMap.has(absolutePos)) return patchStateMap.get(absolutePos);
    const cellNode = editor.state.doc.nodeAt(absolutePos);
    if (!cellNode) return null;
    const nextState = {
      pos: absolutePos,
      rect: cellRect || resolveTableCellRectByAbsolutePos({ tableMap, tableStart, absolutePos }),
      attrs: cellNode.attrs || {},
      edgeSet: resolveEffectiveTableCellEdges({
        cellAttrs: cellNode.attrs || {},
        cellRect: cellRect || resolveTableCellRectByAbsolutePos({ tableMap, tableStart, absolutePos }),
        tableBorderPreset,
        tableWidth: tableMap.width,
        tableHeight: tableMap.height
      })
    };
    patchStateMap.set(absolutePos, nextState);
    return nextState;
  };

  entries.forEach((entry) => {
    const activeCellState = getOrCreatePatchState(entry.pos, entry.rect);
    if (activeCellState) {
      if (shouldEnable) activeCellState.edgeSet.add(edge);
      else activeCellState.edgeSet.delete(edge);
    }

    const oppositeEdge = EDGE_OPPOSITE_MAP[edge];
    collectSharedEdgeNeighborCells({
      entry,
      edge,
      tableMap,
      tableStart
    }).forEach((neighbor) => {
      const neighborState = getOrCreatePatchState(neighbor.pos, neighbor.rect);
      if (!neighborState) return;
      if (shouldEnable) neighborState.edgeSet.add(oppositeEdge);
      else neighborState.edgeSet.delete(oppositeEdge);
    });
  });

  let tr = editor.state.tr;
  let changed = false;

  patchStateMap.forEach((item) => {
    const orderedEdges = TABLE_BORDER_EDGE_OPTIONS.filter((candidate) => item.edgeSet.has(candidate));
    const nextBorderEdges = orderedEdges.length === 0
      ? 'none'
      : orderedEdges.length === TABLE_BORDER_EDGE_OPTIONS.length
        ? 'all'
        : orderedEdges.join(',');
    const nextAttrs = {
      ...item.attrs,
      borderEdges: nextBorderEdges,
      borderWidth: item.attrs.borderWidth || borderWidth || '1',
      borderColor: item.attrs.borderColor || borderColor || '#334155'
    };
    const patchChanged = ['borderEdges', 'borderWidth', 'borderColor']
      .some((key) => !areComparableValuesEqual(item.attrs?.[key], nextAttrs[key]));
    if (!patchChanged) return;
    tr = tr.setNodeMarkup(item.pos, null, nextAttrs);
    changed = true;
  });

  if (changed) {
    if (originalSelection instanceof CellSelection) {
      try {
        tr = tr.setSelection(CellSelection.create(
          tr.doc,
          tr.mapping.map(originalSelection.$anchorCell.pos),
          tr.mapping.map(originalSelection.$headCell.pos)
        ));
      } catch (_error) {
        // Ignore selection restoration errors and fall back to the mapped transaction selection.
      }
    }
    editor.view.dispatch(tr);
  }
  return changed || entries.length > 0;
};

export const selectEntireTable = (editor) => {
  const state = editor?.state;
  const dispatch = editor?.view?.dispatch;
  if (!state?.selection || typeof dispatch !== 'function') return false;
  const tableContext = resolveTableContext(state.selection);
  if (!tableContext?.table?.node) return false;
  const tableStart = getTableStart(tableContext, state.selection);
  if (!Number.isFinite(tableStart)) return false;
  const tableMap = TableMap.get(tableContext.table.node);
  const cellPositions = tableMap.cellsInRect({
    left: 0,
    top: 0,
    right: tableMap.width,
    bottom: tableMap.height
  });
  if (!cellPositions.length) return false;
  try {
    const anchor = tableStart + cellPositions[0];
    const head = tableStart + cellPositions[cellPositions.length - 1];
    const selection = CellSelection.create(state.doc, anchor, head);
    dispatch(state.tr.setSelection(selection));
    return true;
  } catch (_error) {
    return false;
  }
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
  const tableMap = TableMap.get(tableContext.table.node);
  const isEntireTableSelected = !!selectedRange
    && selectedRange.left === 0
    && selectedRange.top === 0
    && selectedRange.right === tableMap.width
    && selectedRange.bottom === tableMap.height
    && entries.length > 0
    && selection instanceof CellSelection;
  const selectedMergedCellCount = entries.filter((entry) => entry.isMerged).length;
  const currentCellAttrs = activeCell?.attrs || editor.getAttributes('tableCell') || editor.getAttributes('tableHeader') || {};
  const currentTableAttrs = tableContext.table.node?.attrs || {};
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
  const currentBorderEdges = normalizeExplicitBorderEdges(currentCellAttrs.borderEdges || '');
  return {
    isTableActive: true,
    isMultiCellSelection,
    isEntireTableSelected,
    canMerge,
    canSplit,
    currentTableAttrs,
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
    tableDimensions: {
      width: tableMap.width,
      height: tableMap.height
    },
    selectionEdgeState: {
      currentBorderEdges,
      top: entries.length > 0 && entries.every((entry) => isTableCellEdgeVisible({
        cellAttrs: entry.attrs,
        cellRect: entry.rect,
        tableBorderPreset: currentTableAttrs.tableBorderPreset,
        tableWidth: tableMap.width,
        tableHeight: tableMap.height,
        edge: 'top'
      })),
      right: entries.length > 0 && entries.every((entry) => isTableCellEdgeVisible({
        cellAttrs: entry.attrs,
        cellRect: entry.rect,
        tableBorderPreset: currentTableAttrs.tableBorderPreset,
        tableWidth: tableMap.width,
        tableHeight: tableMap.height,
        edge: 'right'
      })),
      bottom: entries.length > 0 && entries.every((entry) => isTableCellEdgeVisible({
        cellAttrs: entry.attrs,
        cellRect: entry.rect,
        tableBorderPreset: currentTableAttrs.tableBorderPreset,
        tableWidth: tableMap.width,
        tableHeight: tableMap.height,
        edge: 'bottom'
      })),
      left: entries.length > 0 && entries.every((entry) => isTableCellEdgeVisible({
        cellAttrs: entry.attrs,
        cellRect: entry.rect,
        tableBorderPreset: currentTableAttrs.tableBorderPreset,
        tableWidth: tableMap.width,
        tableHeight: tableMap.height,
        edge: 'left'
      }))
    }
  };
};
