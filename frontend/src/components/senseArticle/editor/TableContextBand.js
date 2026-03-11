import React, { useEffect, useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import ToolbarButton from './ToolbarButton';
import TableCellFormatPopover from './dialogs/TableCellFormatPopover';
import TableBorderPopover from './dialogs/TableBorderPopover';
import {
  getDeleteGuardMessage,
  mergeSelectedCellsWithRules,
  splitSelectedCellWithRules
} from './table/tableMergeUtils';
import { applyAttrsToSelectedTableCells, getTableSelectionState } from './table/tableSelectionState';
import { buildTableWidthPayload } from './table/tableWidthUtils';
import { normalizeBorderEdges, TABLE_STYLE_OPTIONS } from './table/tableSchema';

const STYLE_LABEL_MAP = {
  default: '常规表格',
  compact: '紧凑表格',
  zebra: '斑马纹表格',
  'three-line': '三线表'
};

const EDGE_ORDER = ['top', 'right', 'bottom', 'left'];

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

  if (!editor || !selectionState?.isTableActive) return null;

  const showNotice = (message, tone = 'subtle') => {
    if (typeof onNotice === 'function') onNotice(message, tone);
  };

  const closeFloatingUi = () => {
    setFormatPopoverOpen(false);
    setBorderPopoverOpen(false);
  };

  const applyCellAttributes = (attrs = {}) => {
    const didApply = applyAttrsToSelectedTableCells(editor, attrs);
    if (!didApply) showNotice('当前没有可编辑的表格单元格。', 'danger');
  };

  const runStructureCommand = ({ run, failureMessage, successMessage = '', closeAfterRun = true }) => {
    const didRun = typeof run === 'function' ? run() : false;
    if (!didRun) {
      showNotice(failureMessage || '表格结构操作未执行，请检查当前选区。', 'danger');
      return;
    }
    if (successMessage) showNotice(successMessage, 'subtle');
    if (closeAfterRun) closeFloatingUi();
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
    let chain = editor.chain().focus();

    if (headerFlags.row !== shouldHaveRow) chain = chain.toggleHeaderRow();
    if (headerFlags.column !== shouldHaveColumn) chain = chain.toggleHeaderColumn();

    const didRun = chain.run();
    if (!didRun) {
      showNotice('设置表头位置失败，请确认当前光标仍在表格内。', 'danger');
    }
  };

  const toggleBorderEdge = (edge) => {
    const hasEdgeOnAll = !!selectionState?.selectionEdgeState?.[edge];
    const didApply = applyAttrsToSelectedTableCells(editor, ({ attrs }) => {
      const currentValue = normalizeBorderEdges(attrs.borderEdges || 'all');
      const nextEdges = currentValue === 'all'
        ? [...EDGE_ORDER]
        : currentValue === 'none'
          ? []
          : currentValue.split(',').filter(Boolean);
      const edgeSet = new Set(nextEdges);
      if (hasEdgeOnAll) edgeSet.delete(edge);
      else edgeSet.add(edge);
      const ordered = EDGE_ORDER.filter((item) => edgeSet.has(item));
      return {
        borderEdges: ordered.length === 0 ? 'none' : ordered.length === EDGE_ORDER.length ? 'all' : ordered.join(','),
        borderWidth: attrs.borderWidth || currentCellAttrs.borderWidth || '1',
        borderColor: attrs.borderColor || currentCellAttrs.borderColor || '#94a3b8'
      };
    });
    if (!didApply) showNotice('边框更新失败，请重新选择表格单元格后重试。', 'danger');
  };

  return (
    <div className="sense-table-context-band" role="toolbar" aria-label="表格上下文工具带">
      <div className="sense-table-context-band-row">
        <div className="sense-rich-toolbar-select compact">
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
            const result = mergeSelectedCellsWithRules({ editor, selectionState });
            showNotice(result.message, result.tone);
          }}
        >
          合并单元格
        </ToolbarButton>

        <ToolbarButton
          title="拆分当前合并单元格"
          active={selectionState.canSplit}
          onClick={() => {
            const result = splitSelectedCellWithRules({ editor, selectionState });
            showNotice(result.message, result.tone);
          }}
        >
          拆分单元格
        </ToolbarButton>

        <div className="sense-rich-toolbar-select compact">
          <select
            aria-label="表格样式"
            value={currentTableAttrs.tableStyle || 'default'}
            onChange={(event) => editor.chain().focus().setTableStyle(event.target.value).run()}
          >
            {TABLE_STYLE_OPTIONS.map((item) => <option key={item} value={item}>{STYLE_LABEL_MAP[item]}</option>)}
          </select>
          <ChevronDown size={14} />
        </div>

        <div className="sense-rich-toolbar-select compact">
          <select
            aria-label="表格宽度"
            value={String(currentTableAttrs.tableWidthMode || 'auto') === 'full' ? 'full' : 'auto'}
            onChange={(event) => {
              const nextMode = event.target.value === 'full' ? 'full' : 'auto';
              const payload = buildTableWidthPayload({
                tableWidthMode: nextMode,
                tableWidthValue: nextMode === 'full' ? '100' : currentTableAttrs.tableWidthValue
              });
              editor.chain().focus().setTableWidth(payload.tableWidthMode, payload.tableWidthValue).run();
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
            格式布局
          </ToolbarButton>
          <PortalDropdown open={formatPopoverOpen} anchorRef={formatButtonRef} onClose={() => setFormatPopoverOpen(false)}>
            <TableCellFormatPopover
              open={formatPopoverOpen}
              currentCellAttrs={currentCellAttrs}
              onTextAlignChange={(value) => applyCellAttributes({ textAlign: value })}
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
            表格边框
          </ToolbarButton>
          <PortalDropdown open={borderPopoverOpen} anchorRef={borderButtonRef} onClose={() => setBorderPopoverOpen(false)}>
            <TableBorderPopover
              open={borderPopoverOpen}
              currentTableAttrs={currentTableAttrs}
              currentCellAttrs={currentCellAttrs}
              selectionState={selectionState}
              onPresetChange={(value) => editor.chain().focus().setTableBorderPreset(value).run()}
              onBorderWidthChange={(value) => applyCellAttributes({
                borderEdges: currentCellAttrs.borderEdges || 'all',
                borderWidth: value,
                borderColor: currentCellAttrs.borderColor || '#94a3b8'
              })}
              onBorderColorChange={(value) => applyCellAttributes({
                borderEdges: currentCellAttrs.borderEdges || 'all',
                borderWidth: currentCellAttrs.borderWidth || '1',
                borderColor: value
              })}
              onEdgeToggle={toggleBorderEdge}
              onClearOverride={() => {
                const didApply = applyAttrsToSelectedTableCells(editor, {
                  borderEdges: '',
                  borderWidth: '',
                  borderColor: ''
                });
                if (!didApply) showNotice('当前没有可清除边框覆盖的单元格。', 'danger');
              }}
            />
          </PortalDropdown>
        </div>

        <div className="sense-rich-toolbar-select compact danger">
          <select
            aria-label="删除单元格"
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
            <option value="">删除单元格</option>
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
