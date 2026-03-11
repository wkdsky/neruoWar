const getRangeLabel = (selectionState = {}) => (
  selectionState.selectedRangeLabel || selectionState.selectionSummaryText || '当前表格区域'
);

export const getDeleteGuardMessage = ({ kind = 'row', selectionState = null } = {}) => (
  selectionState?.[kind === 'column' ? 'deleteColumnReason' : 'deleteRowReason']
  || (
    kind === 'column'
      ? '当前列与合并单元格相交，请先拆分相关单元格后再删除列。'
      : '当前行与合并单元格相交，请先拆分相关单元格后再删除行。'
  )
);

export const getMergeUnavailableMessage = (selectionState = null) => (
  selectionState?.mergeAvailabilityReason || '当前选区不是可合并的矩形单元格区域，请先选择合法的矩形区域。'
);

export const getSplitUnavailableMessage = (selectionState = null) => (
  selectionState?.splitAvailabilityReason || '当前单元格不是已合并单元格，无法拆分。'
);

export const getMergeSuccessMessage = (selectionState = null) => (
  `${getRangeLabel(selectionState)}已合并，保留左上角单元格的格式与主内容。`
);

export const getSplitSuccessMessage = (selectionState = null) => (
  `${getRangeLabel(selectionState)}已拆分，内容保留在左上角，新单元格继承原单元格格式。`
);

export const mergeSelectedCellsWithRules = ({ editor, selectionState = null } = {}) => {
  if (!editor) return { ok: false, message: '表格编辑器未就绪，暂时无法合并单元格。', tone: 'danger' };
  if (!selectionState?.canMerge) {
    return { ok: false, message: getMergeUnavailableMessage(selectionState), tone: 'danger' };
  }
  const didMerge = editor.chain().focus().mergeCells().run();
  if (!didMerge) {
    return { ok: false, message: '合并单元格失败，请确认当前选区仍为合法矩形区域。', tone: 'danger' };
  }
  return { ok: true, message: getMergeSuccessMessage(selectionState), tone: 'success' };
};

export const splitSelectedCellWithRules = ({ editor, selectionState = null } = {}) => {
  if (!editor) return { ok: false, message: '表格编辑器未就绪，暂时无法拆分单元格。', tone: 'danger' };
  if (!selectionState?.canSplit) {
    return { ok: false, message: getSplitUnavailableMessage(selectionState), tone: 'danger' };
  }
  const didSplit = editor.chain().focus().splitCell().run();
  if (!didSplit) {
    return { ok: false, message: '拆分单元格失败，请先只定位到一个已合并单元格。', tone: 'danger' };
  }
  return { ok: true, message: getSplitSuccessMessage(selectionState), tone: 'success' };
};
