import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TableContextBand from './TableContextBand';

jest.mock('@tiptap/react', () => ({
  useEditorState: jest.fn()
}));

jest.mock('./table/tableSelectionState', () => ({
  applyAttrsToSelectedTableCells: jest.fn(() => true),
  getTableSelectionState: jest.fn(() => ({
    isTableActive: false,
    canMerge: false,
    canSplit: false,
    currentTableAttrs: {},
    tableStructure: { hasHeaderRow: false, hasHeaderColumn: false },
    currentCellAttrs: {},
    selectionTouchesMergedRows: false,
    selectionTouchesMergedColumns: false,
    selectionSummaryText: '',
    mergeAvailabilityReason: '',
    splitAvailabilityReason: '',
    deleteRowReason: '',
    deleteColumnReason: '',
    selectedMergedCellCount: 0,
    selectedRangeLabel: '',
    selectionEdgeState: {}
  }))
}));

const { useEditorState } = require('@tiptap/react');

const createEditorMock = () => {
  const run = jest.fn(() => true);
  const chain = {
    focus: jest.fn(() => chain),
    addRowBefore: jest.fn(() => chain),
    addRowAfter: jest.fn(() => chain),
    addColumnBefore: jest.fn(() => chain),
    addColumnAfter: jest.fn(() => chain),
    deleteRow: jest.fn(() => chain),
    deleteColumn: jest.fn(() => chain),
    toggleHeaderRow: jest.fn(() => chain),
    toggleHeaderColumn: jest.fn(() => chain),
    mergeCells: jest.fn(() => chain),
    splitCell: jest.fn(() => chain),
    deleteTable: jest.fn(() => chain),
    setTableStyle: jest.fn(() => chain),
    setTableWidth: jest.fn(() => chain),
    setTableBorderPreset: jest.fn(() => chain),
    setTableCellAttributes: jest.fn(() => chain),
    run
  };
  return {
    __chain: chain,
    can: () => ({ mergeCells: () => false, splitCell: () => false }),
    chain: () => chain
  };
};

test('TableContextBand hides outside table context', () => {
  useEditorState.mockReturnValue({ isTableActive: false });
  const editor = createEditorMock();
  const { container } = render(<TableContextBand editor={editor} onNotice={jest.fn()} />);
  expect(container.firstChild).toBeNull();
});

test('TableContextBand blocks row deletion when merged cells would be affected', () => {
  useEditorState.mockReturnValue({
    isTableActive: true,
    canMerge: false,
    canSplit: false,
    currentTableAttrs: { tableStyle: 'default', tableWidthMode: 'auto', tableWidthValue: '100', tableBorderPreset: 'all' },
    tableStructure: { hasHeaderRow: false, hasHeaderColumn: false },
    currentCellAttrs: {},
    selectionTouchesMergedRows: true,
    selectionTouchesMergedColumns: false,
    deleteRowReason: '当前行与合并单元格相交，请先拆分相关单元格。',
    deleteColumnReason: '',
    selectionSummaryText: '已选中 2 行 × 2 列，共 4 个单元格',
    mergeAvailabilityReason: '当前选区命中了已有合并单元格，请先调整为合法矩形区域。',
    splitAvailabilityReason: '当前单元格不是已合并单元格，无法拆分。',
    selectedMergedCellCount: 1,
    selectedRangeLabel: 'R1-2 / C1-2 · 4 格',
    selectionEdgeState: {}
  });
  const editor = createEditorMock();
  const onNotice = jest.fn();
  render(<TableContextBand editor={editor} onNotice={onNotice} />);

  fireEvent.change(screen.getByRole('combobox', { name: '删除单元格' }), { target: { value: 'row' } });
  expect(onNotice).toHaveBeenCalled();
  expect(editor.__chain.deleteRow).not.toHaveBeenCalled();
});

test('TableContextBand only shows merge feedback after the user tries the action', () => {
  useEditorState.mockReturnValue({
    isTableActive: true,
    canMerge: true,
    canSplit: false,
    currentTableAttrs: { tableStyle: 'default', tableWidthMode: 'auto', tableWidthValue: '100', tableBorderPreset: 'all' },
    tableStructure: { hasHeaderRow: true, hasHeaderColumn: false },
    currentCellAttrs: {},
    selectionTouchesMergedRows: false,
    selectionTouchesMergedColumns: false,
    deleteRowReason: '',
    deleteColumnReason: '',
    selectionSummaryText: '已选中 2 行 × 2 列，共 4 个单元格',
    mergeAvailabilityReason: '',
    splitAvailabilityReason: '当前单元格不是已合并单元格，无法拆分。',
    selectedMergedCellCount: 0,
    selectedRangeLabel: 'R2-3 / C1-2 · 4 格',
    selectionEdgeState: {}
  });
  const editor = createEditorMock();
  const onNotice = jest.fn();
  render(<TableContextBand editor={editor} onNotice={onNotice} />);

  expect(screen.queryByText('已选中 2 行 × 2 列，共 4 个单元格')).toBeNull();
  expect(screen.queryByText('当前选区可合并：R2-3 / C1-2 · 4 格')).toBeNull();
  expect(screen.queryByText('至少选中两个相邻单元格后才能合并。')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '合并选中单元格' }));
  expect(editor.__chain.mergeCells).toHaveBeenCalled();
  expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('保留左上角单元格的格式与主内容'), 'success');
});
