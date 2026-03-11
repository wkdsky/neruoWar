import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
import RichToolbar from './RichToolbar';
import SenseArticleRenderer from '../SenseArticleRenderer';
import useSenseEditorPreviewPane from '../useSenseEditorPreviewPane';
import { isRichHtmlSemanticallyEmpty, normalizeRichHtmlContent } from './richContentState';
import { normalizePastedHtml } from './paste/normalizePastedContent';
import { looksLikeMarkdown, markdownToRichHtml } from './paste/markdownToRichContent';
import { extractRichHtmlOutline } from './extractRichHtmlOutline';
import SenseArticleOutlineTree from '../SenseArticleOutlineTree';
import SenseArticleStateView from '../SenseArticleStateView';

const RichSenseArticleEditorShell = ({
  value,
  onChange,
  previewRevision,
  onSearchReferences,
  onUploadMedia,
  scopedFocus = null,
  mediaLibrary = null,
  onPasteNotice = null,
  onSaveDraft = null,
  saveDisabled = false,
  savePending = false
}) => {
  const editorLayoutRef = useRef(null);
  const toolbarRef = useRef(null);
  const editorHostRef = useRef(null);
  const previewBodyRef = useRef(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const toolbarHeightRef = useRef(0);
  const deferredValue = useDeferredValue(value);
  const outlineItems = useMemo(() => extractRichHtmlOutline(deferredValue || value || ''), [deferredValue, value]);
  const {
    isDesktopResizable,
    isPreviewBodyMounted,
    isPreviewCollapsed,
    layoutClassName,
    layoutStyle,
    dividerClassName,
    previewPaneClassName,
    previewVisibilityPhase,
    togglePreviewCollapsed,
    resizeHandleProps
  } = useSenseEditorPreviewPane({ layoutRef: editorLayoutRef });

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
          if (!html && looksLikeMarkdown(text) && editor) {
            event.preventDefault();
            editor.chain().focus().insertContent(markdownToRichHtml(text)).run();
            onPasteNotice && onPasteNotice('已按 Markdown 结构导入粘贴内容。');
            return true;
          }
          return false;
        }
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange(normalizeRichHtmlContent(currentEditor.getHTML()));
    }
  });

  useEffect(() => {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    const normalizedValue = value || '<p></p>';
    if (normalizedValue === currentHtml) return;
    editor.commands.setContent(normalizedValue, false);
  }, [editor, value]);

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
  }, [deferredValue, scopedFocus]);

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

  const deferredPreviewRevision = useMemo(() => ({
    ...(previewRevision || {}),
    editorSource: previewRevision?.contentFormat === 'rich_html' ? deferredValue : previewRevision?.editorSource,
    renderSnapshot: previewRevision?.contentFormat === 'rich_html'
      ? {
          ...(previewRevision?.renderSnapshot || {}),
          html: deferredValue
        }
      : previewRevision?.renderSnapshot
  }), [deferredValue, previewRevision]);
  const isPreviewEmpty = useMemo(() => isRichHtmlSemanticallyEmpty(deferredPreviewRevision?.editorSource || deferredPreviewRevision?.renderSnapshot?.html || ''), [deferredPreviewRevision]);

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
              className="sense-rich-editor-utility-button preview-toggle"
              onClick={() => setIsOutlineCollapsed((prev) => !prev)}
            >
              {isOutlineCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
              <span>{isOutlineCollapsed ? '展开目录' : '收起目录'}</span>
            </button>
            <button
              type="button"
              className="sense-rich-editor-utility-button preview-toggle"
              onClick={togglePreviewCollapsed}
            >
              {isPreviewCollapsed ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
              <span>{isPreviewCollapsed ? '展开预览' : '收起预览'}</span>
            </button>
          </div>
        </div>
        <RichToolbar
          editor={editor}
          onSearchReferences={onSearchReferences}
          onUploadMedia={onUploadMedia}
          mediaLibrary={mediaLibrary}
        />
      </div>

      <div ref={editorLayoutRef} className={`${layoutClassName}${isOutlineCollapsed ? ' toc-collapsed' : ''}`} style={layoutStyle}>
        {!isOutlineCollapsed ? (
          <section className="sense-editor-pane sense-editor-outline-pane">
            <div className="sense-editor-outline-shell" aria-label="正文目录导航">
              <div className="sense-editor-outline-header">
                <div className="sense-editor-pane-title">目录导航</div>
                <div className="sense-editor-preview-status">{outlineItems.length > 0 ? `${outlineItems.length} 个标题` : '暂无目录项'}</div>
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

        <section className="sense-editor-pane editor-primary sense-rich-editor-pane">
          {scopedFocus?.enabled ? (
            <div className="sense-scoped-focus-banner">
              <strong>{scopedFocus.label || '局部修订范围'}</strong>
              <span>{scopedFocus.description || '当前为整页富文本编辑，但已在正文中定位并高亮相关块。'}</span>
            </div>
          ) : null}
          <div ref={editorHostRef}>
          <EditorContent editor={editor} />
          </div>
        </section>

        {isDesktopResizable ? (
          <div className={dividerClassName}>
            <button type="button" className="sense-editor-resize-handle" {...resizeHandleProps}>
              <span className="sense-editor-resize-handle-lines" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <section className={previewPaneClassName}>
          <div className={`sense-editor-preview-body${isPreviewBodyMounted ? '' : ' hidden'}`}>
            <div ref={previewBodyRef} className="sense-editor-preview-renderer">
              {isPreviewEmpty ? (
                <SenseArticleStateView compact kind="empty" title="预览区为空" description="开始输入正文、插入标题或导入 Markdown 后，这里会显示实时预览。" />
              ) : (
                <SenseArticleRenderer revision={deferredPreviewRevision} activeHeadingId={scopedFocus?.previewHeadingId || ''} activeBlockId={scopedFocus?.previewBlockId || ''} preferHtmlSnapshot />
              )}
            </div>
          </div>
          <div className={`sense-editor-preview-phase-marker preview-phase-${previewVisibilityPhase}`} />
        </section>
      </div>
    </div>
  );
};

export default RichSenseArticleEditorShell;
