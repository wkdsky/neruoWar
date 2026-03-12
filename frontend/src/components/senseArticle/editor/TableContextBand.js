import React, { useEffect, useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  Merge,
  PaintBucket,
  Palette,
  SplitSquareHorizontal,
  StretchHorizontal,
  TableProperties,
  Trash2,
  LayoutPanelTop
} from 'lucide-react';
import ToolbarButton from './ToolbarButton';
import TableCellFormatPopover from './dialogs/TableCellFormatPopover';
import TableBorderPopover from './dialogs/TableBorderPopover';
import {
  getDeleteGuardMessage,
  mergeSelectedCellsWithRules,
  splitSelectedCellWithRules
} from './table/tableMergeUtils';
import {
  applyAttrsToSelectedTableCells,
  applySyncedTableBorderEdge,
  getTableSelectionState,
  isCellSelection,
} from './table/tableSelectionState';
import { buildTableWidthPayload } from './table/tableWidthUtils';
import { TABLE_STYLE_OPTIONS } from './table/tableSchema';
import {
  describeActiveElement,
  describeEditorSelection,
  describeScrollPosition,
  senseEditorDebugLog
} from './editorDebug';

const STYLE_LABEL_MAP = {
  default: '常规表格',
  compact: '紧凑表格',
  zebra: '斑马纹表格',
  'three-line': '三线表'
};

const tableActionLabel = (Icon, label) => (
  <>
    <Icon size={14} className="sense-rich-table-button-icon" />
    <span>{label}</span>
  </>
);

const PortalDropdown = ({ open, anchorRef, onClose, children }) => {
  const panelRef = useRef(null);
  const [inlineStyle, setInlineStyle] = useState(null);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;

    const updatePosition = () => {
      const anchor = anchorRef?.current;
      if (!anchor) return;

      if (window.innerWidth <= 980) {
        setInlineStyle({
          top: 72,
          left: 12,
          right: 12
        });
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const panelWidth = panelRef.current?.offsetWidth || 320;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
      const nextLeft = Math.min(Math.max(12, rect.left), Math.max(12, viewportWidth - panelWidth - 12));
      setInlineStyle({
        top: rect.bottom + 6,
        left: nextLeft
      });
    };

    const handlePointerDown = (event) => {
      const target = event.target;
      if (panelRef.current?.contains(target) || anchorRef?.current?.contains(target)) return;
      onClose?.();
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [anchorRef, onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      className="sense-rich-table-dropdown-portal"
      style={inlineStyle || undefined}
    >
      {children}
    </div>,
    document.body
  );
};

const TableContextBand = ({ editor, onNotice = null }) => {
  const [formatPopoverOpen, setFormatPopoverOpen] = useState(false);
  const [borderPopoverOpen, setBorderPopoverOpen] = useState(false);
  const [insertAction, setInsertAction] = useState('');
  const [deleteAction, setDeleteAction] = useState('');
  const formatButtonRef = useRef(null);
  const borderButtonRef = useRef(null);
  const lastTableSelectionBookmarkRef = useRef(null);
  const lastTableCellSelectionRef = useRef(null);
  const selectionState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => getTableSelectionState(currentEditor)
  });

  const currentTableAttrs = selectionState?.currentTableAttrs || {};
  const currentCellAttrs = selectionState?.currentCellAttrs || {};
  const headerFlags = {
    row: !!selectionState?.tableStructure?.hasHeaderRow,
    column: !!selectionState?.tableStructure?.hasHeaderColumn
  };

  useEffect(() => {
    const selection = editor?.state?.selection;
    const bookmark = selection?.getBookmark?.();
    if (selectionState?.isTableActive && bookmark) {
      lastTableSelectionBookmarkRef.current = bookmark;
    }
    if (isCellSelection(selection)) {
      lastTableCellSelectionRef.current = {
        anchor: selection.$anchorCell.pos,
        head: selection.$headCell.pos
      };
    }
  }, [editor, selectionState]);

  if (!editor || !selectionState?.isTableActive) return null;

  const showNotice = (message, tone = 'subtle') => {
    if (typeof onNotice === 'function') onNotice(message, tone);
  };

  const closeFloatingUi = () => {
    setFormatPopoverOpen(false);
    setBorderPopoverOpen(false);
  };

  const focusEditorView = (force = false) => {
    if (lastTableCellSelectionRef.current) return;
    if (!force && editor?.isFocused) return;
    if (typeof editor?.view?.focus === 'function') editor.view.focus();
  };

  const refreshTableSelectionVisibility = () => {
    const nextBookmark = editor?.state?.selection?.getBookmark?.();
    if (nextBookmark) lastTableSelectionBookmarkRef.current = nextBookmark;
    if (isCellSelection(editor?.state?.selection)) {
      lastTableCellSelectionRef.current = {
        anchor: editor.state.selection.$anchorCell.pos,
        head: editor.state.selection.$headCell.pos
      };
    }
    const restore = () => {
      restoreActiveTableSelection();
      if (!isCellSelection(editor?.state?.selection)) {
        focusEditorView(true);
      }
      const updatedBookmark = editor?.state?.selection?.getBookmark?.();
      if (updatedBookmark) lastTableSelectionBookmarkRef.current = updatedBookmark;
      if (isCellSelection(editor?.state?.selection)) {
        lastTableCellSelectionRef.current = {
          anchor: editor.state.selection.$anchorCell.pos,
          head: editor.state.selection.$headCell.pos
        };
      }
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(restore);
      return;
    }
    restore();
  };

  const restoreActiveTableSelection = () => {
    const preservedCellSelection = lastTableCellSelectionRef.current;
    if (preservedCellSelection && editor?.state?.tr && editor?.view?.dispatch) {
      try {
        const nextSelection = editor.state.selection?.constructor?.create?.(
          editor.state.doc,
          preservedCellSelection.anchor,
          preservedCellSelection.head
        );
        if (!nextSelection) throw new Error('CellSelection factory unavailable');
        if (!editor.state.selection?.eq?.(nextSelection)) {
          const tr = editor.state.tr.setSelection(nextSelection);
          editor.view.dispatch(tr);
        }
        return true;
      } catch (_error) {
        // Fall through to bookmark restoration.
      }
    }
    const bookmark = lastTableSelectionBookmarkRef.current;
    if (!bookmark || !editor?.state?.tr || !editor?.view?.dispatch) return true;
    try {
      const resolvedSelection = bookmark.resolve(editor.state.doc);
      if (editor.state.selection?.eq?.(resolvedSelection)) return true;
      const tr = editor.state.tr.setSelection(resolvedSelection);
      editor.view.dispatch(tr);
      return true;
    } catch (_error) {
      return false;
    }
  };

  const withActiveTableSelection = (run, restoreFailureMessage = '') => {
    if (!restoreActiveTableSelection()) {
      if (restoreFailureMessage) showNotice(restoreFailureMessage, 'danger');
      return false;
    }
    return typeof run === 'function' ? run() : false;
  };

  const applyCellAttributes = (attrs = {}) => {
    senseEditorDebugLog('table-band', 'Applying table cell attributes', {
      attrs,
      activeElementBefore: describeActiveElement(),
      scrollBefore: describeScrollPosition(),
      selectionBefore: describeEditorSelection(editor),
      currentCellAttrs,
      currentTableAttrs
    });
    const didApply = withActiveTableSelection(
      () => applyAttrsToSelectedTableCells(editor, attrs),
      '未能恢复当前表格选区，请重新将光标定位到目标表格后重试。'
    );
    if (!didApply) {
      showNotice('当前没有可编辑的表格单元格。', 'danger');
      return;
    }
    refreshTableSelectionVisibility();
    senseEditorDebugLog('table-band', 'Applied table cell attributes from context band', {
      attrs,
      activeElementAfter: describeActiveElement(),
      scrollAfter: describeScrollPosition(),
      selectionAfter: describeEditorSelection(editor),
      selectionFrom: editor.state.selection?.from,
      selectionTo: editor.state.selection?.to
    });
  };

  const runStructureCommand = ({ run, failureMessage, successMessage = '', closeAfterRun = true }) => {
    senseEditorDebugLog('table-band', 'Running table structure command', {
      activeElementBefore: describeActiveElement(),
      scrollBefore: describeScrollPosition(),
      selectionBefore: describeEditorSelection(editor)
    });
    const didRun = withActiveTableSelection(run);
    if (!didRun) {
      showNotice(failureMessage || '表格结构操作未执行，请检查当前选区。', 'danger');
      return false;
    }
    senseEditorDebugLog('table-band', 'Table structure command completed', {
      activeElementAfter: describeActiveElement(),
      scrollAfter: describeScrollPosition(),
      selectionAfter: describeEditorSelection(editor)
    });
    if (successMessage) showNotice(successMessage, 'subtle');
    if (closeAfterRun) closeFloatingUi();
    return true;
  };

  const handleDelete = (kind = 'row') => {
    const blocked = kind === 'column'
      ? selectionState.selectionTouchesMergedColumns
      : selectionState.selectionTouchesMergedRows;
    if (blocked) {
      showNotice(getDeleteGuardMessage({ kind, selectionState }), 'danger');
      return;
    }
    runStructureCommand({
      run: () => (kind === 'column' ? editor.chain().focus().deleteColumn().run() : editor.chain().focus().deleteRow().run()),
      failureMessage: kind === 'column' ? '删除列失败，请重新定位到目标列后重试。' : '删除行失败，请重新定位到目标行后重试。'
    });
  };

  const headerPlacementValue = headerFlags.row && headerFlags.column
    ? 'both'
    : headerFlags.row
      ? 'row'
      : headerFlags.column
        ? 'column'
        : 'none';

  const applyHeaderPlacement = (targetValue = 'none') => {
    const shouldHaveRow = targetValue === 'row' || targetValue === 'both';
    const shouldHaveColumn = targetValue === 'column' || targetValue === 'both';
    const didRun = withActiveTableSelection(() => {
      let chain = editor.chain().focus();
      if (headerFlags.row !== shouldHaveRow) chain = chain.toggleHeaderRow();
      if (headerFlags.column !== shouldHaveColumn) chain = chain.toggleHeaderColumn();
      return chain.run();
    });
    if (!didRun) {
      showNotice('设置表头位置失败，请确认当前光标仍在表格内。', 'danger');
      return;
    }
    refreshTableSelectionVisibility();
  };

  const toggleBorderEdge = (edge) => {
    const didApply = withActiveTableSelection(() => applySyncedTableBorderEdge({
      editor,
      selectionState,
      edge,
      borderWidth: currentCellAttrs.borderWidth || '1',
      borderColor: currentCellAttrs.borderColor || '#334155'
    }), '未能恢复当前表格选区，请重新将光标定位到目标表格后重试。');
    if (!didApply) {
      showNotice('边框更新失败，请重新选择表格单元格后重试。', 'danger');
      return;
    }
    refreshTableSelectionVisibility();
  };

  return (
    <div className="sense-table-context-band" role="toolbar" aria-label="表格上下文工具带">
      <div className="sense-table-context-band-row">
        <div className="sense-rich-toolbar-select compact">
          <TableProperties size={14} className="sense-rich-select-leading-icon" />
          <select
            aria-label="插入单元格"
            value={insertAction}
            onChange={(event) => {
              const nextValue = event.target.value;
              setInsertAction('');
              if (nextValue === 'row-before') {
                runStructureCommand({ run: () => editor.chain().focus().addRowBefore().run(), failureMessage: '插入上方行失败，请重新选择目标单元格后重试。' });
              } else if (nextValue === 'row-after') {
                runStructureCommand({ run: () => editor.chain().focus().addRowAfter().run(), failureMessage: '插入下方行失败，请重新选择目标单元格后重试。' });
              } else if (nextValue === 'column-before') {
                runStructureCommand({ run: () => editor.chain().focus().addColumnBefore().run(), failureMessage: '插入左侧列失败，请重新选择目标单元格后重试。' });
              } else if (nextValue === 'column-after') {
                runStructureCommand({ run: () => editor.chain().focus().addColumnAfter().run(), failureMessage: '插入右侧列失败，请重新选择目标单元格后重试。' });
              }
            }}
          >
            <option value="">插入单元格</option>
            <option value="row-before">上插行</option>
            <option value="row-after">下插行</option>
            <option value="column-before">左插列</option>
            <option value="column-after">右插列</option>
          </select>
          <ChevronDown size={14} />
        </div>

        <div className="sense-rich-toolbar-select compact">
          <LayoutPanelTop size={14} className="sense-rich-select-leading-icon" />
          <select
            aria-label="设置表头位置"
            value={headerPlacementValue}
            onChange={(event) => applyHeaderPlacement(event.target.value)}
          >
            <option value="none">无表头</option>
            <option value="row">首行表头</option>
            <option value="column">首列表头</option>
            <option value="both">首行+首列</option>
          </select>
          <ChevronDown size={14} />
        </div>

        <ToolbarButton
          title="合并选中单元格"
          active={selectionState.canMerge}
          onClick={() => {
            const restored = restoreActiveTableSelection();
            if (!restored) {
              showNotice('未能恢复当前表格选区，请重新将光标定位到目标表格后重试。', 'danger');
              return;
            }
            const result = mergeSelectedCellsWithRules({ editor, selectionState });
            showNotice(result.message, result.tone);
          }}
        >
          {tableActionLabel(Merge, '合并单元格')}
        </ToolbarButton>

        <ToolbarButton
          title="拆分当前合并单元格"
          active={selectionState.canSplit}
          onClick={() => {
            const restored = restoreActiveTableSelection();
            if (!restored) {
              showNotice('未能恢复当前表格选区，请重新将光标定位到目标表格后重试。', 'danger');
              return;
            }
            const result = splitSelectedCellWithRules({ editor, selectionState });
            showNotice(result.message, result.tone);
          }}
        >
          {tableActionLabel(SplitSquareHorizontal, '拆分单元格')}
        </ToolbarButton>

        <div className="sense-rich-toolbar-select compact">
          <Palette size={14} className="sense-rich-select-leading-icon" />
          <select
            aria-label="表格样式"
            value={currentTableAttrs.tableStyle || 'default'}
            onChange={(event) => {
              const didRun = runStructureCommand({
                run: () => editor.chain().focus().setTableStyle(event.target.value).run(),
                failureMessage: '切换表格样式失败，请重新将光标定位到目标表格后重试。',
                closeAfterRun: false
              });
              if (didRun) refreshTableSelectionVisibility();
            }}
          >
            {TABLE_STYLE_OPTIONS.map((item) => <option key={item} value={item}>{STYLE_LABEL_MAP[item]}</option>)}
          </select>
          <ChevronDown size={14} />
        </div>

        <div className="sense-rich-toolbar-select compact">
          <StretchHorizontal size={14} className="sense-rich-select-leading-icon" />
          <select
            aria-label="表格宽度"
            value={String(currentTableAttrs.tableWidthMode || 'auto') === 'full' ? 'full' : 'auto'}
            onChange={(event) => {
              const nextMode = event.target.value === 'full' ? 'full' : 'auto';
              const payload = buildTableWidthPayload({
                tableWidthMode: nextMode,
                tableWidthValue: nextMode === 'full' ? '100' : currentTableAttrs.tableWidthValue
              });
              const didRun = runStructureCommand({
                run: () => editor.chain().focus().setTableWidth(payload.tableWidthMode, payload.tableWidthValue).run(),
                failureMessage: '调整表格宽度失败，请重新将光标定位到目标表格后重试。',
                closeAfterRun: false
              });
              if (didRun) refreshTableSelectionVisibility();
            }}
          >
            <option value="auto">适应内容</option>
            <option value="full">占据整行</option>
          </select>
          <ChevronDown size={14} />
        </div>

        <div className="sense-table-band-popover-anchor" ref={formatButtonRef}>
          <ToolbarButton
            title="格式布局"
            active={formatPopoverOpen}
            onClick={() => {
              setBorderPopoverOpen(false);
              setFormatPopoverOpen((prev) => !prev);
            }}
          >
            {tableActionLabel(PaintBucket, '格式布局')}
          </ToolbarButton>
          <PortalDropdown open={formatPopoverOpen} anchorRef={formatButtonRef} onClose={() => setFormatPopoverOpen(false)}>
            <TableCellFormatPopover
              open={formatPopoverOpen}
              currentCellAttrs={currentCellAttrs}
              onVerticalAlignChange={(value) => applyCellAttributes({ verticalAlign: value })}
              onBackgroundColorChange={(value) => applyCellAttributes({ backgroundColor: value })}
              onTextColorChange={(value) => applyCellAttributes({ textColor: value })}
              onDiagonalModeChange={(value) => applyCellAttributes({ diagonalMode: value })}
            />
          </PortalDropdown>
        </div>

        <div className="sense-table-band-popover-anchor" ref={borderButtonRef}>
          <ToolbarButton
            title="表格边框"
            active={borderPopoverOpen}
            onClick={() => {
              setFormatPopoverOpen(false);
              setBorderPopoverOpen((prev) => !prev);
            }}
          >
            {tableActionLabel(TableProperties, '表格边框')}
          </ToolbarButton>
          <PortalDropdown open={borderPopoverOpen} anchorRef={borderButtonRef} onClose={() => setBorderPopoverOpen(false)}>
            <TableBorderPopover
              open={borderPopoverOpen}
              currentTableAttrs={currentTableAttrs}
              currentCellAttrs={currentCellAttrs}
              selectionState={selectionState}
              onPresetChange={(value) => {
                const didRun = runStructureCommand({
                  run: () => editor.chain().focus().setTableBorderPreset(value).run(),
                  failureMessage: '切换表格边框预设失败，请重新将光标定位到目标表格后重试。',
                  closeAfterRun: false
                });
                if (didRun) refreshTableSelectionVisibility();
              }}
              onBorderWidthChange={(value) => applyCellAttributes({
                borderEdges: currentCellAttrs.borderEdges || 'all',
                borderWidth: value,
                borderColor: currentCellAttrs.borderColor || '#334155'
              })}
              onBorderColorChange={(value) => applyCellAttributes({
                borderEdges: currentCellAttrs.borderEdges || 'all',
                borderWidth: currentCellAttrs.borderWidth || '1',
                borderColor: value
              })}
              onEdgeToggle={toggleBorderEdge}
              onClearOverride={() => {
                const didApply = withActiveTableSelection(() => {
                  return applyAttrsToSelectedTableCells(editor, {
                    borderEdges: '',
                    borderWidth: '',
                    borderColor: ''
                  });
                }, '未能恢复当前表格选区，请重新将光标定位到目标表格后重试。');
                if (!didApply) {
                  showNotice('当前没有可清除边框覆盖的单元格。', 'danger');
                  return;
                }
                refreshTableSelectionVisibility();
              }}
            />
          </PortalDropdown>
        </div>

        <div className="sense-rich-toolbar-select compact danger">
          <Trash2 size={14} className="sense-rich-select-leading-icon" />
          <select
            aria-label="删除操作"
            value={deleteAction}
            onChange={(event) => {
              const nextValue = event.target.value;
              setDeleteAction('');
              if (nextValue === 'row') handleDelete('row');
              else if (nextValue === 'column') handleDelete('column');
              else if (nextValue === 'table') {
                runStructureCommand({ run: () => editor.chain().focus().deleteTable().run(), failureMessage: '删除整表失败，请重新聚焦到表格后重试。' });
              }
            }}
          >
            <option value="">删除</option>
            <option value="row">删除当前行</option>
            <option value="column">删除当前列</option>
            <option value="table">删除整表</option>
          </select>
          <ChevronDown size={14} />
        </div>
      </div>
    </div>
  );
};

export default TableContextBand;
