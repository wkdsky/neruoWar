import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { ChevronsLeft, ChevronsRight, Save } from 'lucide-react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { RichBulletList, RichOrderedList } from './extensions/ListStyle';
import ListKeymapExtension from './extensions/ListKeymapExtension';
import FontSize from './extensions/FontSize';
import Indent from './extensions/Indent';
import FigureImage from './extensions/FigureImage';
import AudioNode from './extensions/AudioNode';
import VideoNode from './extensions/VideoNode';
import FormulaInline from './extensions/FormulaInline';
import FormulaBlock from './extensions/FormulaBlock';
import InternalSenseReference from './extensions/InternalSenseReference';
import MediaAttachmentReference from './extensions/MediaAttachmentReference';
import { MediaAttachmentSyncExtension } from './extensions/mediaAttachmentSupport';
import TableStyleExtension, { RichTableCell, RichTableHeader, RichTableRow } from './extensions/TableStyleExtension';
import TableContextBand from './TableContextBand';
import RichToolbar from './RichToolbar';
import AttachmentTitleDialog from './dialogs/AttachmentTitleDialog';
import FormulaEditorDialog from './dialogs/FormulaEditorDialog';
import { areRichHtmlContentsEquivalent, normalizeRichHtmlContent } from './richContentState';
import { normalizePastedHtml } from './paste/normalizePastedContent';
import { looksLikeMarkdown, markdownToRichHtml } from './paste/markdownToRichContent';
import { extractRichHtmlOutline } from './extractRichHtmlOutline';
import SenseArticleOutlineTree from '../SenseArticleOutlineTree';
import { getTableSelectionState, selectEntireTable } from './table/tableSelectionState';
import {
  describeActiveElement,
  describeEditorSelection,
  describeScrollPosition,
  senseEditorDebugLog
} from './editorDebug';
import { resolveMediaAttachmentTypeLabel } from './extensions/mediaAttachmentFormat';

const getActiveTableElements = (editorInstance) => {
  if (!editorInstance?.view?.domAtPos) return { tableElement: null, wrapperElement: null };
  const domAtPos = editorInstance.view.domAtPos(editorInstance.state.selection.from);
  const sourceNode = domAtPos?.node?.nodeType === 1 ? domAtPos.node : domAtPos?.node?.parentElement;
  const tableElement = sourceNode?.closest?.('table') || null;
  const wrapperElement = sourceNode?.closest?.('.tableWrapper') || tableElement;
  return { tableElement, wrapperElement };
};

const syncTableSelectionUi = ({ editorInstance, editorHost }) => {
  if (!editorHost) return;
  Array.from(editorHost.querySelectorAll('.sense-table-active-cell, .sense-table-active-merged-cell, .sense-table-selected-merged-cell')).forEach((element) => {
    element.classList.remove('sense-table-active-cell', 'sense-table-active-merged-cell', 'sense-table-selected-merged-cell');
  });
  editorHost.dataset.tableSelectionMode = 'none';
  if (!editorInstance?.isActive?.('table')) return;

  const domAtPos = editorInstance.view.domAtPos(editorInstance.state.selection.from);
  const sourceNode = domAtPos?.node?.nodeType === 1 ? domAtPos.node : domAtPos?.node?.parentElement;
  const activeCell = sourceNode?.closest?.('td,th');
  if (activeCell) {
    activeCell.classList.add('sense-table-active-cell');
    if ((activeCell.getAttribute('rowspan') && activeCell.getAttribute('rowspan') !== '1') || (activeCell.getAttribute('colspan') && activeCell.getAttribute('colspan') !== '1')) {
      activeCell.classList.add('sense-table-active-merged-cell');
    }
  }

  const selectedCells = Array.from(editorHost.querySelectorAll('.selectedCell'));
  editorHost.dataset.tableSelectionMode = selectedCells.length > 1 ? 'multi' : selectedCells.length === 1 ? 'single' : 'caret';
  selectedCells.forEach((cell) => {
    if ((cell.getAttribute('rowspan') && cell.getAttribute('rowspan') !== '1') || (cell.getAttribute('colspan') && cell.getAttribute('colspan') !== '1')) {
      cell.classList.add('sense-table-selected-merged-cell');
    }
  });
};

const RichSenseArticleEditorShell = ({
  value,
  onChange,
  onSearchReferences,
  onUploadMedia,
  outlineResetKey = '',
  scopedFocus = null,
  mediaLibrary = null,
  mediaLibraryState = 'idle',
  mediaLibraryError = null,
  onRetryMediaLibrary = null,
  onPasteNotice = null,
  onEditorNotice = null,
  onSaveDraft = null,
  saveDisabled = false,
  savePending = false,
  headerContent = null,
  commandbarActions = null
}) => {
  const toolbarRef = useRef(null);
  const shellRef = useRef(null);
  const editorHostRef = useRef(null);
  const editorPaneRef = useRef(null);
  const editorRef = useRef(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const [tableOverlayState, setTableOverlayState] = useState({
    visible: false,
    selectTop: 0,
    selectLeft: 0,
    isEntireTableSelected: false
  });
  const [attachmentTitleDialogState, setAttachmentTitleDialogState] = useState({
    open: false,
    pos: null,
    title: '',
    nodeName: ''
  });
  const [formulaDialogState, setFormulaDialogState] = useState({
    open: false,
    pos: null,
    latex: '',
    displayMode: 'inline'
  });
  const toolbarHeightRef = useRef(0);
  const lastEmittedHtmlRef = useRef(normalizeRichHtmlContent(value || '<p></p>') || '<p></p>');
  const lastAppliedValueRef = useRef(lastEmittedHtmlRef.current);
  const isApplyingExternalValueRef = useRef(false);
  const lastScopedFocusTargetRef = useRef('');
  const outlineItems = useMemo(() => extractRichHtmlOutline(value || ''), [value]);
  const scopedFocusTargetKey = useMemo(() => JSON.stringify({
    enabled: !!scopedFocus?.enabled,
    headingText: scopedFocus?.headingText || '',
    selectionText: scopedFocus?.selectionText || '',
    originalText: scopedFocus?.originalText || '',
    previewHeadingId: scopedFocus?.previewHeadingId || '',
    previewBlockId: scopedFocus?.previewBlockId || ''
  }), [
    scopedFocus?.enabled,
    scopedFocus?.headingText,
    scopedFocus?.selectionText,
    scopedFocus?.originalText,
    scopedFocus?.previewHeadingId,
    scopedFocus?.previewBlockId
  ]);

  useEffect(() => {
    if (!toolbarRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const nextHeight = Math.ceil(entries[0]?.contentRect?.height || 0);
      if (nextHeight === toolbarHeightRef.current) return;
      toolbarHeightRef.current = nextHeight;
      setToolbarHeight(nextHeight);
    });
    observer.observe(toolbarRef.current);
    return () => observer.disconnect();
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: false,
        orderedList: false,
        link: false,
        underline: false,
        heading: {
          levels: [1, 2, 3]
        }
      }),
      RichBulletList,
      RichOrderedList,
      ListKeymapExtension,
      Link.configure({
        openOnClick: false,
        autolink: true
      }),
      Underline,
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      FontSize,
      TextAlign.configure({
        types: ['heading', 'paragraph', 'blockquote']
      }),
      TaskList,
      TaskItem.configure({
        nested: false
      }),
      Placeholder.configure({
        placeholder: '开始编写百科正文…'
      }),
      Indent,
      TableStyleExtension.configure({
        resizable: true
      }),
      RichTableRow,
      RichTableHeader,
      RichTableCell,
      FigureImage,
      AudioNode,
      VideoNode,
      FormulaInline,
      FormulaBlock,
      InternalSenseReference,
      MediaAttachmentReference,
      MediaAttachmentSyncExtension
    ],
    content: value || '<p></p>',
    editorProps: {
      attributes: {
        class: 'sense-rich-editor-surface'
      },
      transformPastedHTML: (html) => {
        const normalized = normalizePastedHtml(html);
        if (normalized.warnings.length > 0 && typeof onPasteNotice === 'function') {
          onPasteNotice(normalized.warnings.join(' '));
        }
        return normalized.html;
      },
      handleDOMEvents: {
        paste: (_view, event) => {
          if ((event.clipboardData?.files?.length || 0) > 0) {
            onPasteNotice && onPasteNotice('暂不支持直接粘贴本地图片或媒体文件，请使用工具栏中的媒体上传入口。');
            event.preventDefault();
            return true;
          }
          const html = event.clipboardData?.getData('text/html') || '';
          const text = event.clipboardData?.getData('text/plain') || '';
          const activeEditor = editorRef.current;
          if (!html && looksLikeMarkdown(text) && activeEditor) {
            event.preventDefault();
            activeEditor.chain().focus().insertContent(markdownToRichHtml(text)).run();
            onPasteNotice && onPasteNotice('已按 Markdown 结构导入粘贴内容。');
            return true;
          }
          return false;
        },
        dragstart: (_view, event) => {
          const target = event.target;
          const mediaFigure = target?.closest?.('figure[data-node-type="image"], figure[data-node-type="audio"], figure[data-node-type="video"]');
          if (mediaFigure) return false;
          event.preventDefault();
          senseEditorDebugLog('shell', 'Prevented editor dragstart', {
            targetTag: target?.tagName || ''
          });
          return true;
        },
        drop: (_view, event) => {
          if ((event.dataTransfer?.files?.length || 0) > 0) {
            event.preventDefault();
            onPasteNotice && onPasteNotice('暂不支持通过拖放插入本地媒体文件，请使用工具栏中的媒体上传入口。');
            return true;
          }
          const mediaFigure = event.target?.closest?.('figure[data-node-type="image"], figure[data-node-type="audio"], figure[data-node-type="video"]');
          if (mediaFigure) return false;
          event.preventDefault();
          senseEditorDebugLog('shell', 'Prevented editor drop', {
            targetTag: event.target?.tagName || ''
          });
          return true;
        }
      }
    },
    onCreate: ({ editor: currentEditor }) => {
      editorRef.current = currentEditor;
      const normalizedInitialHtml = normalizeRichHtmlContent(currentEditor.getHTML() || value || '<p></p>') || '<p></p>';
      lastEmittedHtmlRef.current = normalizedInitialHtml;
      lastAppliedValueRef.current = normalizedInitialHtml;
      senseEditorDebugLog('shell', 'Editor created', {
        htmlLength: normalizedInitialHtml.length,
        activeElement: describeActiveElement(),
        scroll: describeScrollPosition(),
        selection: describeEditorSelection(currentEditor)
      });
    },
    onDestroy: () => {
      senseEditorDebugLog('shell', 'Editor destroyed', {
        activeElement: describeActiveElement(),
        scroll: describeScrollPosition()
      });
      editorRef.current = null;
    },
    onUpdate: ({ editor: currentEditor }) => {
      const normalizedHtml = normalizeRichHtmlContent(currentEditor.getHTML()) || '<p></p>';
      lastEmittedHtmlRef.current = normalizedHtml;
      lastAppliedValueRef.current = normalizedHtml;
      senseEditorDebugLog('shell', 'onUpdate emitted editor HTML', {
        isApplyingExternalValue: isApplyingExternalValueRef.current,
        htmlLength: normalizedHtml.length,
        activeElement: describeActiveElement(),
        scroll: describeScrollPosition(),
        selection: describeEditorSelection(currentEditor)
      });
      onChange(normalizedHtml);
    }
  });

  const updateTableOverlay = useCallback(() => {
    syncTableSelectionUi({ editorInstance: editor, editorHost: editorHostRef.current });
    if (!editor || !editorPaneRef.current || !editorHostRef.current || !editor.isActive('table')) {
      setTableOverlayState((prev) => (prev.visible ? { visible: false, selectTop: 0, selectLeft: 0, isEntireTableSelected: false } : prev));
      return;
    }
    const { tableElement, wrapperElement } = getActiveTableElements(editor);
    if (!tableElement || !wrapperElement) {
      setTableOverlayState((prev) => (prev.visible ? { visible: false, selectTop: 0, selectLeft: 0, isEntireTableSelected: false } : prev));
      return;
    }
    const paneRect = editorPaneRef.current.getBoundingClientRect();
    const targetRect = wrapperElement.getBoundingClientRect();
    const selectionState = getTableSelectionState(editor);
    setTableOverlayState({
      visible: true,
      selectTop: targetRect.top - paneRect.top + 8,
      selectLeft: targetRect.left - paneRect.left + 8,
      isEntireTableSelected: !!selectionState?.isEntireTableSelected
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const normalizedValue = normalizeRichHtmlContent(value || '<p></p>') || '<p></p>';
    const currentHtml = normalizeRichHtmlContent(editor.getHTML() || '<p></p>') || '<p></p>';
    const matchesCurrent = areRichHtmlContentsEquivalent(currentHtml, normalizedValue);
    const matchesLastEmitted = areRichHtmlContentsEquivalent(lastEmittedHtmlRef.current || '<p></p>', normalizedValue);
    const matchesLastApplied = areRichHtmlContentsEquivalent(lastAppliedValueRef.current || '<p></p>', normalizedValue);

    if (matchesCurrent || matchesLastEmitted || matchesLastApplied) {
      lastAppliedValueRef.current = normalizedValue;
      senseEditorDebugLog('shell', 'Skipped external setContent', {
        matchesCurrent,
        matchesLastEmitted,
        matchesLastApplied,
        activeElement: describeActiveElement(),
        scroll: describeScrollPosition()
      });
      return;
    }

    senseEditorDebugLog('shell', 'Applying external value via setContent', {
      normalizedValueLength: normalizedValue.length,
      currentHtmlLength: currentHtml.length,
      activeElement: describeActiveElement(),
      scroll: describeScrollPosition(),
      selectionBefore: describeEditorSelection(editor)
    });
    isApplyingExternalValueRef.current = true;
    try {
      editor.commands.setContent(normalizedValue, false);
      lastAppliedValueRef.current = normalizedValue;
      lastEmittedHtmlRef.current = normalizedValue;
      senseEditorDebugLog('shell', 'Applied external value via setContent', {
        activeElement: describeActiveElement(),
        scroll: describeScrollPosition(),
        selectionAfter: describeEditorSelection(editor)
      });
    } finally {
      isApplyingExternalValueRef.current = false;
    }
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return undefined;
    const syncOverlay = () => updateTableOverlay();
    syncOverlay();
    editor.on('selectionUpdate', syncOverlay);
    editor.on('update', syncOverlay);
    window.addEventListener('resize', syncOverlay);
    window.addEventListener('scroll', syncOverlay, true);
    return () => {
      editor.off('selectionUpdate', syncOverlay);
      editor.off('update', syncOverlay);
      window.removeEventListener('resize', syncOverlay);
      window.removeEventListener('scroll', syncOverlay, true);
    };
  }, [editor, updateTableOverlay]);

  useEffect(() => {
    const handleAttachmentTitleEdit = (event) => {
      const detail = event?.detail || {};
      setAttachmentTitleDialogState({
        open: true,
        pos: Number.isFinite(Number(detail.pos)) ? Number(detail.pos) : null,
        title: String(detail.title || '').trim(),
        nodeName: String(detail.nodeName || '').trim()
      });
    };
    window.addEventListener('sense-media-attachment-edit-title', handleAttachmentTitleEdit);
    return () => window.removeEventListener('sense-media-attachment-edit-title', handleAttachmentTitleEdit);
  }, []);

  useEffect(() => {
    const handleFormulaEdit = (event) => {
      const detail = event?.detail || {};
      setFormulaDialogState({
        open: true,
        pos: Number.isFinite(Number(detail.pos)) ? Number(detail.pos) : null,
        latex: String(detail.latex || '').trim(),
        displayMode: String(detail.displayMode || 'inline').trim() === 'block' ? 'block' : 'inline'
      });
    };
    window.addEventListener('sense-formula-edit', handleFormulaEdit);
    return () => window.removeEventListener('sense-formula-edit', handleFormulaEdit);
  }, []);

  const closeAttachmentTitleDialog = useCallback(() => {
    setAttachmentTitleDialogState((prev) => ({
      ...prev,
      open: false
    }));
    window.requestAnimationFrame(() => {
      if (typeof editor?.view?.focus === 'function') editor.view.focus();
    });
  }, [editor]);

  const closeFormulaDialog = useCallback(() => {
    setFormulaDialogState((prev) => ({
      ...prev,
      open: false
    }));
    window.requestAnimationFrame(() => {
      if (typeof editor?.view?.focus === 'function') editor.view.focus();
    });
  }, [editor]);

  const handleAttachmentTitleSubmit = useCallback((nextTitle) => {
    if (!editor?.state?.doc || !editor?.view?.dispatch) {
      closeAttachmentTitleDialog();
      return;
    }
    const position = Number(attachmentTitleDialogState.pos);
    const node = Number.isFinite(position) ? editor.state.doc.nodeAt(position) : null;
    if (!node) {
      closeAttachmentTitleDialog();
      return;
    }
    const transaction = editor.state.tr.setNodeMarkup(position, undefined, {
      ...node.attrs,
      attachmentTitle: String(nextTitle || '').trim()
    });
    editor.view.dispatch(transaction);
    closeAttachmentTitleDialog();
  }, [attachmentTitleDialogState.pos, closeAttachmentTitleDialog, editor]);

  const handleFormulaDialogSubmit = useCallback(({ latex, displayMode }) => {
    if (!editor?.state?.doc || !editor?.view?.dispatch) {
      closeFormulaDialog();
      return;
    }
    const position = Number(formulaDialogState.pos);
    const node = Number.isFinite(position) ? editor.state.doc.nodeAt(position) : null;
    const normalizedLatex = String(latex || '').trim();
    const normalizedDisplayMode = String(displayMode || '').trim() === 'block' ? 'block' : 'inline';
    if (!node || !normalizedLatex) {
      closeFormulaDialog();
      return;
    }
    if (node.type.name === (normalizedDisplayMode === 'block' ? 'formulaBlock' : 'formulaInline')) {
      const transaction = editor.state.tr.setNodeMarkup(position, undefined, {
        ...node.attrs,
        formulaSource: normalizedLatex,
        displayMode: normalizedDisplayMode
      });
      editor.view.dispatch(transaction);
      closeFormulaDialog();
      return;
    }
    editor.chain().focus().setNodeSelection(position).deleteSelection().insertContent({
      type: normalizedDisplayMode === 'block' ? 'formulaBlock' : 'formulaInline',
      attrs: {
        formulaSource: normalizedLatex,
        displayMode: normalizedDisplayMode
      }
    }).run();
    closeFormulaDialog();
  }, [closeFormulaDialog, editor, formulaDialogState.pos]);

  useEffect(() => {
    if (!editorHostRef.current) return;
    const container = editorHostRef.current;
    Array.from(container.querySelectorAll('.sense-scoped-editor-target')).forEach((element) => {
      element.classList.remove('sense-scoped-editor-target');
    });
    if (!scopedFocus?.enabled) {
      lastScopedFocusTargetRef.current = '';
      return;
    }
    const query = String(scopedFocus.headingText || scopedFocus.selectionText || scopedFocus.originalText || '').trim();
    const candidates = Array.from(container.querySelectorAll('h1, h2, h3, p, li, blockquote, pre, table, figure'));
    const matched = candidates.find((element) => {
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text && element.tagName.toLowerCase() === 'figure') {
        return String(scopedFocus.mediaHint || '').trim() && element.textContent?.includes(scopedFocus.mediaHint);
      }
      if (scopedFocus.headingText && /^H\d/.test(element.tagName)) {
        return text.includes(scopedFocus.headingText);
      }
      return query ? text.includes(query) : false;
    });
    if (!matched) return;
    matched.classList.add('sense-scoped-editor-target');
    if (lastScopedFocusTargetRef.current === scopedFocusTargetKey) return;
    lastScopedFocusTargetRef.current = scopedFocusTargetKey;
    if (typeof matched.scrollIntoView === 'function') {
      senseEditorDebugLog('shell', 'Scoped focus scrolling target into view', {
        targetTag: matched.tagName || '',
        targetText: String(matched.textContent || '').slice(0, 80),
        scrollBefore: describeScrollPosition()
      });
      window.requestAnimationFrame(() => {
        matched.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
  }, [scopedFocus, scopedFocusTargetKey]);

  const handleOutlineJump = useCallback((heading) => {
    if (!editorHostRef.current || !heading?.title) return;
    const normalizedTitle = String(heading.title || '').replace(/\s+/g, ' ').trim();
    const headingLevel = Number(heading.level) || 1;
    const duplicateIndex = outlineItems
      .slice(0, Number(heading.flatIndex) + 1)
      .filter((item) => Number(item?.level || 1) === headingLevel && String(item?.title || '').replace(/\s+/g, ' ').trim() === normalizedTitle)
      .length - 1;

    const editorHeadings = Array.from(editorHostRef.current.querySelectorAll(`h${headingLevel}`))
      .filter((element) => String(element.textContent || '').replace(/\s+/g, ' ').trim() === normalizedTitle);
    const editorTarget = editorHeadings[Math.max(0, duplicateIndex)] || editorHeadings[0];
    if (!editorTarget) return;
    editorTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [outlineItems]);

  const showEditorNotice = useCallback((message, tone = 'subtle') => {
    if (typeof onEditorNotice === 'function') onEditorNotice(message, tone);
  }, [onEditorNotice]);

  const handleSelectEntireTable = useCallback(() => {
    if (!editor) return;
    const didSelect = selectEntireTable(editor);
    if (!didSelect) return;
    window.requestAnimationFrame(() => {
      updateTableOverlay();
    });
  }, [editor, updateTableOverlay]);

  return (
    <div ref={shellRef} className="sense-rich-editor-shell" style={{ '--sense-editor-toolbar-height': `${toolbarHeight}px` }}>
      <div ref={toolbarRef} className="sense-rich-toolbar-shell">
        {headerContent ? (
          <div className="sense-rich-editor-shell-head">
            {headerContent}
          </div>
        ) : null}
        <div className="sense-rich-editor-commandbar">
          <div className="sense-rich-editor-commandbar-actions">
            <button
              type="button"
              className="sense-rich-editor-utility-button save-draft"
              onClick={typeof onSaveDraft === 'function' ? onSaveDraft : undefined}
              disabled={saveDisabled || typeof onSaveDraft !== 'function'}
            >
              <Save size={16} />
              <span>{savePending ? '保存中…' : '保存草稿'}</span>
            </button>
            <button
              type="button"
              className="sense-rich-editor-utility-button outline-toggle"
              onClick={() => setIsOutlineCollapsed((prev) => !prev)}
            >
              {isOutlineCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
              <span>{isOutlineCollapsed ? '展开目录' : '收起目录'}</span>
            </button>
          </div>
          {commandbarActions ? (
            <div className="sense-rich-editor-commandbar-actions sense-rich-editor-commandbar-actions-extra">
              {commandbarActions}
            </div>
          ) : null}
        </div>
        <RichToolbar
          editor={editor}
          onSearchReferences={onSearchReferences}
          onUploadMedia={onUploadMedia}
          mediaLibrary={mediaLibrary}
          mediaLibraryState={mediaLibraryState}
          mediaLibraryError={mediaLibraryError}
          onRetryMediaLibrary={onRetryMediaLibrary}
          dialogPortalTarget={shellRef}
        />
        <TableContextBand editor={editor} onNotice={showEditorNotice} />
      </div>

      <div className={`sense-editor-layout sense-editor-layout-wysiwyg${isOutlineCollapsed ? ' toc-collapsed' : ''}`}>
        {!isOutlineCollapsed ? (
          <section className="sense-editor-pane sense-editor-outline-pane">
            <div className="sense-editor-outline-shell" aria-label="正文目录导航">
              <div className="sense-editor-outline-header">
                <div className="sense-editor-pane-title">目录导航</div>
                <div className="sense-editor-outline-status">{outlineItems.length > 0 ? `${outlineItems.length} 个标题` : '暂无目录项'}</div>
              </div>
              <SenseArticleOutlineTree
                items={outlineItems}
                resetKey={outlineResetKey}
                onJump={handleOutlineJump}
                emptyTitle="暂无目录项"
                emptyDescription=""
              />
            </div>
          </section>
        ) : null}

        <section ref={editorPaneRef} className="sense-editor-pane editor-primary sense-rich-editor-pane">
          {scopedFocus?.enabled ? (
            <div className="sense-scoped-focus-banner">
              <strong>{scopedFocus.label || '局部修订范围'}</strong>
              <span>{scopedFocus.description || '当前为整页富文本编辑，但已在正文中定位并高亮相关块。'}</span>
            </div>
          ) : null}
          {tableOverlayState.visible ? (
            <button
              type="button"
              className={`sense-table-select-handle${tableOverlayState.isEntireTableSelected ? ' active' : ''}`}
              style={{ top: `${tableOverlayState.selectTop}px`, left: `${tableOverlayState.selectLeft}px` }}
              onMouseDown={(event) => {
                event.preventDefault();
                handleSelectEntireTable();
              }}
              title="全选表格"
              aria-label="全选表格"
            >
              <span aria-hidden="true">⊞</span>
            </button>
          ) : null}
          <div ref={editorHostRef}>
          <EditorContent editor={editor} />
          </div>
        </section>
      </div>
      <AttachmentTitleDialog
        open={attachmentTitleDialogState.open}
        initialTitle={attachmentTitleDialogState.title}
        mediaLabel={resolveMediaAttachmentTypeLabel(attachmentTitleDialogState.nodeName)}
        onClose={closeAttachmentTitleDialog}
        onSubmit={handleAttachmentTitleSubmit}
        portalTarget={shellRef}
      />
      <FormulaEditorDialog
        open={formulaDialogState.open}
        initialValue={formulaDialogState.latex}
        initialDisplayMode={formulaDialogState.displayMode}
        submitLabel="确认修改"
        onClose={closeFormulaDialog}
        onSubmit={handleFormulaDialogSubmit}
        restoreFocusOnClose={false}
        autoFocusTarget="none"
        portalTarget={shellRef}
      />
    </div>
  );
};

export default RichSenseArticleEditorShell;
