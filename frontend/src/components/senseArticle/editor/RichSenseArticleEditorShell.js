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
import FontSize from './extensions/FontSize';
import Indent from './extensions/Indent';
import FigureImage from './extensions/FigureImage';
import AudioNode from './extensions/AudioNode';
import VideoNode from './extensions/VideoNode';
import InternalSenseReference from './extensions/InternalSenseReference';
import TableStyleExtension, { RichTableCell, RichTableHeader, RichTableRow } from './extensions/TableStyleExtension';
import TableContextBand from './TableContextBand';
import RichToolbar from './RichToolbar';
import { normalizeRichHtmlContent } from './richContentState';
import { normalizePastedHtml } from './paste/normalizePastedContent';
import { looksLikeMarkdown, markdownToRichHtml } from './paste/markdownToRichContent';
import { extractRichHtmlOutline } from './extractRichHtmlOutline';
import SenseArticleOutlineTree from '../SenseArticleOutlineTree';
import { formatTableWidthLabel, resolveTableWidthValue } from './table/tableWidthUtils';

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
  scopedFocus = null,
  mediaLibrary = null,
  onPasteNotice = null,
  onEditorNotice = null,
  onSaveDraft = null,
  saveDisabled = false,
  savePending = false
}) => {
  const toolbarRef = useRef(null);
  const editorHostRef = useRef(null);
  const editorPaneRef = useRef(null);
  const editorRef = useRef(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const [tableOverlayState, setTableOverlayState] = useState({ visible: false, top: 0, left: 0, label: '' });
  const toolbarHeightRef = useRef(0);
  const dragStateRef = useRef(null);
  const dragFrameRef = useRef(0);
  const outlineItems = useMemo(() => extractRichHtmlOutline(value || ''), [value]);

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
        heading: {
          levels: [1, 2, 3, 4]
        }
      }),
      RichBulletList,
      RichOrderedList,
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
      InternalSenseReference
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
        }
      }
    },
    onCreate: ({ editor: currentEditor }) => {
      editorRef.current = currentEditor;
    },
    onDestroy: () => {
      editorRef.current = null;
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange(normalizeRichHtmlContent(currentEditor.getHTML()));
    }
  });

  const updateTableOverlay = useCallback(() => {
    syncTableSelectionUi({ editorInstance: editor, editorHost: editorHostRef.current });
    if (!editor || !editorPaneRef.current || !editorHostRef.current || !editor.isActive('table')) {
      setTableOverlayState((prev) => (prev.visible ? { visible: false, top: 0, left: 0, label: '' } : prev));
      return;
    }
    const { tableElement, wrapperElement } = getActiveTableElements(editor);
    if (!tableElement || !wrapperElement) {
      setTableOverlayState((prev) => (prev.visible ? { visible: false, top: 0, left: 0, label: '' } : prev));
      return;
    }
    const paneRect = editorPaneRef.current.getBoundingClientRect();
    const targetRect = wrapperElement.getBoundingClientRect();
    const label = formatTableWidthLabel(editor.getAttributes('table') || {});
    setTableOverlayState({
      visible: true,
      top: targetRect.top - paneRect.top + 8,
      left: targetRect.right - paneRect.left - 18,
      label
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    const normalizedValue = value || '<p></p>';
    if (normalizedValue === currentHtml) return;
    editor.commands.setContent(normalizedValue, false);
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
    if (!editorHostRef.current) return;
    const container = editorHostRef.current;
    Array.from(container.querySelectorAll('.sense-scoped-editor-target')).forEach((element) => {
      element.classList.remove('sense-scoped-editor-target');
    });
    if (!scopedFocus?.enabled) return;
    const query = String(scopedFocus.headingText || scopedFocus.selectionText || scopedFocus.originalText || '').trim();
    const candidates = Array.from(container.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, pre, table, figure'));
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
    if (typeof matched.scrollIntoView === 'function') {
      matched.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [scopedFocus, value]);

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

  const stopTableWidthDrag = useCallback(() => {
    if (dragFrameRef.current) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = 0;
    }
    dragStateRef.current = null;
  }, []);

  useEffect(() => () => stopTableWidthDrag(), [stopTableWidthDrag]);

  const handleTableWidthDragStart = useCallback((event) => {
    if (!editor || !editorPaneRef.current || !editor.isActive('table') || event.button !== 0) return;
    event.preventDefault();
    const paneRect = editorPaneRef.current.getBoundingClientRect();
    const { wrapperElement } = getActiveTableElements(editor);
    const wrapperRect = wrapperElement?.getBoundingClientRect?.() || null;
    const tableAttrs = editor.getAttributes('table') || {};
    const resolvedValue = resolveTableWidthValue(tableAttrs)
      || Math.round(((wrapperRect?.width || 0) / Math.max(paneRect.width, 1)) * 100)
      || 100;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startValue: resolvedValue,
      paneWidth: paneRect.width
    };
    if (typeof event.currentTarget?.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (_error) {
        // Ignore capture failures.
      }
    }
  }, [editor]);

  const handleTableWidthDragMove = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!editor || !dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const nextValue = Math.min(100, Math.max(40, Math.round(dragState.startValue + ((event.clientX - dragState.startClientX) / Math.max(dragState.paneWidth, 1)) * 100)));
    if (dragFrameRef.current) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = 0;
      editor.chain().focus().setTableWidth('custom', nextValue).run();
      updateTableOverlay();
    });
  }, [editor, updateTableOverlay]);

  const handleTableWidthDragEnd = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (typeof event.currentTarget?.hasPointerCapture === 'function' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // Ignore release failures.
      }
    }
    stopTableWidthDrag();
  }, [stopTableWidthDrag]);

  return (
    <div className="sense-rich-editor-shell" style={{ '--sense-editor-toolbar-height': `${toolbarHeight}px` }}>
      <div ref={toolbarRef} className="sense-rich-toolbar-shell">
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
        </div>
        <RichToolbar
          editor={editor}
          onSearchReferences={onSearchReferences}
          onUploadMedia={onUploadMedia}
          mediaLibrary={mediaLibrary}
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
                onJump={handleOutlineJump}
                emptyTitle="暂无目录项"
                emptyDescription="当前内容还没有标题结构，可先插入 H1-H4。"
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
              className="sense-table-width-handle"
              style={{ top: `${tableOverlayState.top}px`, left: `${tableOverlayState.left}px` }}
              onPointerDown={handleTableWidthDragStart}
              onPointerMove={handleTableWidthDragMove}
              onPointerUp={handleTableWidthDragEnd}
              onPointerCancel={handleTableWidthDragEnd}
              title="拖拽调整表格整体宽度"
              aria-label={`拖拽调整表格整体宽度，当前 ${tableOverlayState.label}`}
            >
              <span>{tableOverlayState.label}</span>
            </button>
          ) : null}
          <div ref={editorHostRef}>
          <EditorContent editor={editor} />
          </div>
        </section>
      </div>
    </div>
  );
};

export default RichSenseArticleEditorShell;
