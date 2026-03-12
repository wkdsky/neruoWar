import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  CheckSquare,
  ChevronDown,
  Eraser,
  FileCode2,
  Heading,
  Image as ImageIcon,
  Indent,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Mic,
  Minus,
  Outdent,
  Redo2,
  Type,
  Undo2,
  Video
} from 'lucide-react';
import { useEditorState } from '@tiptap/react';
import ToolbarButton from './ToolbarButton';
import ToolbarGroup from './ToolbarGroup';
import InsertLinkDialog from './dialogs/InsertLinkDialog';
import InsertTableDialog from './dialogs/InsertTableDialog';
import InsertMediaDialog from './dialogs/InsertMediaDialog';
import ImportMarkdownDialog from './dialogs/ImportMarkdownDialog';
import TextColorPopover from './dialogs/TextColorPopover';
import { FONT_SIZE_PRESETS, normalizeFontSize } from './extensions/FontSize';
import { buildTableWidthPayload } from './table/tableWidthUtils';
import { applyAttrsToSelectedTableCells, getTableSelectionState, isCellSelection } from './table/tableSelectionState';
import {
  describeActiveElement,
  describeEditorSelection,
  describeScrollPosition,
  senseEditorDebugLog
} from './editorDebug';

const buttonLabel = (label, icon) => (<>{icon}<span>{label}</span></>);

const RichToolbar = ({
  editor,
  onSearchReferences,
  onUploadMedia,
  mediaLibrary = null,
  onImportMarkdown = null,
  dialogPortalTarget = null
}) => {
  const [linkDialogMode, setLinkDialogMode] = useState('');
  const [mediaDialogKind, setMediaDialogKind] = useState('');
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [markdownDialogOpen, setMarkdownDialogOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [fontSizeInput, setFontSizeInput] = useState('16');
  const colorPopoverRef = useRef(null);
  const mediaToolbarGroupRef = useRef(null);
  const preservedSelectionBookmarkRef = useRef(null);
  const preservedCellSelectionRef = useRef(null);
  const preservedTextRef = useRef('');

  const selectedImage = editor?.isActive('figureImage') ? editor.getAttributes('figureImage') : null;
  const selectedAudio = editor?.isActive('audioNode') ? editor.getAttributes('audioNode') : null;
  const selectedVideo = editor?.isActive('videoNode') ? editor.getAttributes('videoNode') : null;

  const editorUiState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor) {
        return { paragraphType: 'paragraph', activeFontSize: '16px' };
      }
      let paragraphType = 'paragraph';
      if (currentEditor.isActive('heading', { level: 1 })) paragraphType = 'h1';
      else if (currentEditor.isActive('heading', { level: 2 })) paragraphType = 'h2';
      else if (currentEditor.isActive('heading', { level: 3 })) paragraphType = 'h3';
      else if (currentEditor.isActive('heading', { level: 4 })) paragraphType = 'h4';
      else if (currentEditor.isActive('blockquote')) paragraphType = 'blockquote';
      else if (currentEditor.isActive('codeBlock')) paragraphType = 'codeBlock';

      return {
        paragraphType,
        activeFontSize: normalizeFontSize(currentEditor.getAttributes('textStyle')?.fontSize || '16px') || '16px',
        tableSelectionState: getTableSelectionState(currentEditor)
      };
    }
  });

  const paragraphType = editorUiState?.paragraphType || 'paragraph';

  const activeFontSize = editorUiState?.activeFontSize || '16px';
  const tableSelectionState = editorUiState?.tableSelectionState || {};

  useEffect(() => {
    setFontSizeInput(String(activeFontSize).replace(/px$/, ''));
  }, [activeFontSize]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!colorOpen) return;
      if (colorPopoverRef.current?.contains(event.target)) return;
      setColorOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setColorOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [colorOpen]);

  useEffect(() => {
    if (!editor) return;
    senseEditorDebugLog('toolbar', 'Media dialog state changed', {
      mediaDialogKind: mediaDialogKind || '',
      activeElement: describeActiveElement(),
      scroll: describeScrollPosition(),
      selection: describeEditorSelection(editor),
      editorFocused: editor.isFocused
    });
  }, [editor, mediaDialogKind]);

  if (!editor) return null;

  const closeFloatingUi = () => {
    setColorOpen(false);
    setLinkDialogMode('');
    setMediaDialogKind('');
    setTableDialogOpen(false);
    setMarkdownDialogOpen(false);
  };

  const preserveSelection = () => {
    const selection = editor.state.selection;
    const { from, to } = selection;
    preservedSelectionBookmarkRef.current = selection?.getBookmark?.() || null;
    preservedCellSelectionRef.current = isCellSelection(selection)
      ? {
        anchor: selection.$anchorCell.pos,
        head: selection.$headCell.pos
      }
      : null;
    preservedTextRef.current = editor.state.doc.textBetween(from, to, ' ');
  };

  const clearBrowserSelection = () => {
    if (typeof window === 'undefined' || !window.getSelection) return;
    const selection = window.getSelection();
    if (!selection) return;
    try {
      selection.removeAllRanges();
    } catch (_error) {
      // Ignore DOM selection cleanup failures.
    }
  };

  const restoreSelectionFromBookmark = () => {
    const preservedCellSelection = preservedCellSelectionRef.current;
    if (preservedCellSelection && editor?.state?.tr && editor?.view?.dispatch) {
      try {
        const nextSelection = editor.state.selection?.constructor?.create?.(
          editor.state.doc,
          preservedCellSelection.anchor,
          preservedCellSelection.head
        );
        if (!nextSelection) throw new Error('CellSelection factory unavailable');
        if (!editor.state.selection?.eq?.(nextSelection)) {
          editor.view.dispatch(editor.state.tr.setSelection(nextSelection));
        }
        return true;
      } catch (_error) {
        // Fall through to bookmark restoration.
      }
    }
    const bookmark = preservedSelectionBookmarkRef.current;
    if (!bookmark || !editor?.state?.tr || !editor?.view?.dispatch) return false;
    try {
      const selection = bookmark.resolve(editor.state.doc);
      if (!editor.state.selection?.eq?.(selection)) {
        editor.view.dispatch(editor.state.tr.setSelection(selection));
      }
      return true;
    } catch (_error) {
      return false;
    }
  };

  const chainWithPreservedSelection = () => {
    restoreSelectionFromBookmark();
    return editor.chain().focus();
  };

  const restoreSelection = () => {
    const restored = restoreSelectionFromBookmark();
    if (restored && !preservedCellSelectionRef.current && typeof editor?.view?.focus === 'function') {
      editor.view.focus();
      return;
    }
    if (!preservedCellSelectionRef.current) {
      editor.chain().focus().run();
    }
  };

  const focusEditor = (reason = '') => {
    if (preservedCellSelectionRef.current) {
      senseEditorDebugLog('toolbar', 'Skipped editor focus to preserve multi-cell selection', {
        reason,
        activeElement: describeActiveElement(),
        scroll: describeScrollPosition(),
        selection: describeEditorSelection(editor)
      });
      return;
    }
    if (typeof editor?.view?.focus === 'function') editor.view.focus();
    else editor.chain().focus().run();
    senseEditorDebugLog('toolbar', 'Focused editor', {
      reason,
      activeElement: describeActiveElement(),
      scroll: describeScrollPosition(),
      selection: describeEditorSelection(editor)
    });
  };

  const refreshPreservedSelectionVisibility = () => {
    const nextBookmark = editor?.state?.selection?.getBookmark?.();
    if (nextBookmark) preservedSelectionBookmarkRef.current = nextBookmark;
    if (isCellSelection(editor?.state?.selection)) {
      preservedCellSelectionRef.current = {
        anchor: editor.state.selection.$anchorCell.pos,
        head: editor.state.selection.$headCell.pos
      };
    }
    const restore = () => {
      restoreSelection();
      const updatedBookmark = editor?.state?.selection?.getBookmark?.();
      if (updatedBookmark) preservedSelectionBookmarkRef.current = updatedBookmark;
      if (isCellSelection(editor?.state?.selection)) {
        preservedCellSelectionRef.current = {
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

  const runWithPreservedSelection = (command) => {
    restoreSelectionFromBookmark();
    const didRun = typeof command === 'function' ? command(editor.chain().focus()) : false;
    if (didRun !== false) refreshPreservedSelectionVisibility();
    return didRun;
  };

  const applyAlignment = (value) => {
    restoreSelectionFromBookmark();
    const latestTableSelectionState = getTableSelectionState(editor);
    if (latestTableSelectionState?.isTableActive) {
      if (latestTableSelectionState.isEntireTableSelected) {
        if (value === 'justify') {
          runWithPreservedSelection((chain) => chain.setTableAlign('left').setTableWidth('full', '100').run());
          return;
        }
        runWithPreservedSelection((chain) => chain.setTableAlign(value).run());
        return;
      }
      const didApply = applyAttrsToSelectedTableCells(editor, { textAlign: value });
      if (didApply) {
        refreshPreservedSelectionVisibility();
      }
      return;
    }
    runWithPreservedSelection((chain) => chain.setTextAlign(value).run());
  };

  const isAlignmentActive = (value) => {
    if (tableSelectionState?.isTableActive) {
      if (tableSelectionState.isEntireTableSelected) {
        if (value === 'justify') {
          return String(tableSelectionState?.currentTableAttrs?.tableWidthMode || 'auto') === 'full';
        }
        return String(tableSelectionState?.currentTableAttrs?.tableAlign || 'left') === value;
      }
      return String(tableSelectionState?.currentCellAttrs?.textAlign || 'left') === value;
    }
    return editor.isActive({ textAlign: value });
  };

  const insertOrUpdateMarkedText = (markName, attrs, text) => {
    const selection = editor.state.selection;
    if (selection.empty) {
      editor.chain().focus().insertContent({
        type: 'text',
        text,
        marks: [{ type: markName, attrs }]
      }).run();
      return;
    }
    editor.chain().focus().setMark(markName, attrs).run();
  };

  const handleParagraphChange = (value) => {
    runWithPreservedSelection((chain) => {
      if (value === 'paragraph') return chain.clearNodes().setParagraph().run();
      if (value === 'h1') return chain.toggleHeading({ level: 1 }).run();
      if (value === 'h2') return chain.toggleHeading({ level: 2 }).run();
      if (value === 'h3') return chain.toggleHeading({ level: 3 }).run();
      if (value === 'h4') return chain.toggleHeading({ level: 4 }).run();
      if (value === 'blockquote') return chain.toggleBlockquote().run();
      if (value === 'codeBlock') return chain.toggleCodeBlock().run();
      return false;
    });
  };

  const applyFontSize = (rawValue) => {
    const normalizedValue = normalizeFontSize(rawValue);
    if (!normalizedValue) return;
    runWithPreservedSelection((chain) => chain.setFontSize(normalizedValue).run());
  };

  const handleLinkSubmit = (payload) => {
    if (payload.type === 'external') {
      const attrs = {
        href: payload.href,
        target: payload.target,
        rel: payload.target === '_blank' ? 'noopener noreferrer nofollow' : null
      };
      if (editor.state.selection.empty) {
        insertOrUpdateMarkedText('link', attrs, payload.href);
      } else {
        chainWithPreservedSelection().extendMarkRange('link').setLink(attrs).run();
      }
    } else {
      const attrs = {
        nodeId: payload.nodeId,
        senseId: payload.senseId,
        displayText: payload.displayText,
        href: `#sense-ref-${payload.nodeId}-${payload.senseId}`,
        referenceId: `${payload.nodeId}_${payload.senseId}_${Date.now()}`
      };
      if (editor.state.selection.empty) {
        insertOrUpdateMarkedText('internalSenseReference', attrs, payload.displayText);
      } else {
        chainWithPreservedSelection().setInternalSenseReference(attrs).run();
      }
    }
    closeFloatingUi();
  };

  const handleTableSubmit = ({ rows, cols, withHeaderRow, withHeaderColumn, tableStyle, tableWidthMode }) => {
    const tableWidthPayload = buildTableWidthPayload({ tableWidthMode });
    let chain = chainWithPreservedSelection().insertTable({ rows, cols, withHeaderRow });
    if (withHeaderColumn) chain = chain.toggleHeaderColumn();
    chain
      .setTableStyle(tableStyle)
      .setTableWidth(tableWidthPayload.tableWidthMode, tableWidthPayload.tableWidthValue)
      .setTableBorderPreset(tableStyle === 'three-line' ? 'three-line' : 'all')
      .run();
    closeFloatingUi();
  };

  const handleMediaSubmit = (payload) => {
    senseEditorDebugLog('toolbar', 'Submitting media payload', {
      kind: payload.kind,
      activeElementBefore: describeActiveElement(),
      scrollBefore: describeScrollPosition(),
      selectionBefore: describeEditorSelection(editor),
      editorFocused: editor.isFocused
    });
    let didRun = false;
    if (payload.kind === 'image') {
      if (editor.isActive('figureImage')) didRun = chainWithPreservedSelection().updateFigureImage(payload).run();
      else didRun = chainWithPreservedSelection().insertFigureImage(payload).run();
    }
    if (payload.kind === 'audio') {
      if (editor.isActive('audioNode')) didRun = chainWithPreservedSelection().updateAudioNode(payload).run();
      else didRun = chainWithPreservedSelection().insertAudioNode(payload).run();
    }
    if (payload.kind === 'video') {
      if (editor.isActive('videoNode')) didRun = chainWithPreservedSelection().updateVideoNode(payload).run();
      else didRun = chainWithPreservedSelection().insertVideoNode(payload).run();
    }
    senseEditorDebugLog('toolbar', 'Media command executed', {
      kind: payload.kind,
      didRun,
      activeElementAfterRun: describeActiveElement(),
      scrollAfterRun: describeScrollPosition(),
      selectionAfterRun: describeEditorSelection(editor)
    });
    closeFloatingUi();
    window.requestAnimationFrame(() => {
      focusEditor('media-submit');
      senseEditorDebugLog('toolbar', 'Media dialog closed after submit', {
        activeElementAfter: describeActiveElement(),
        scrollAfter: describeScrollPosition(),
        selectionAfter: describeEditorSelection(editor),
        editorFocused: editor.isFocused
      });
    });
  };

  const openSingleFloatingUi = (openCallback, reason = 'generic') => {
    preserveSelection();
    senseEditorDebugLog('toolbar', 'Opening floating UI', {
      reason,
      activeElementBefore: describeActiveElement(),
      scrollBefore: describeScrollPosition(),
      selectionBefore: describeEditorSelection(editor),
      editorFocused: editor.isFocused
    });
    if (typeof editor?.commands?.blur === 'function') {
      editor.commands.blur();
    }
    if (editor?.view?.dom?.blur) {
      try {
        editor.view.dom.blur();
      } catch (_error) {
        // Ignore DOM blur failures.
      }
    }
    clearBrowserSelection();
    closeFloatingUi();
    openCallback();
  };

  const closeMediaDialog = (reason = 'cancel') => {
    setMediaDialogKind('');
    window.requestAnimationFrame(() => {
      restoreSelection();
      senseEditorDebugLog('toolbar', 'Media dialog closed', {
        reason,
        activeElementAfter: describeActiveElement(),
        scrollAfter: describeScrollPosition(),
        selectionAfter: describeEditorSelection(editor),
        editorFocused: editor.isFocused
      });
    });
  };

  const applyIndentChange = (direction = 'increase') => {
    restoreSelectionFromBookmark();
    if (editor.isActive('listItem')) {
      const didRun = runWithPreservedSelection((chain) => (
        direction === 'increase'
          ? chain.sinkListItem('listItem').run()
          : chain.liftListItem('listItem').run()
      ));
      if (!didRun) focusEditor(`list-${direction}-noop`);
      return;
    }
    if (direction === 'increase') {
      runWithPreservedSelection((chain) => chain.increaseIndent().run());
      return;
    }
    runWithPreservedSelection((chain) => chain.decreaseIndent().run());
  };

  return (
    <>
      <div className="sense-rich-toolbar" role="toolbar" aria-label="百科富文本工具栏">
        <ToolbarGroup title="撤销">
          <ToolbarButton title="撤销" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} ariaLabel="撤销">{buttonLabel('撤销', <Undo2 size={16} />)}</ToolbarButton>
          <ToolbarButton title="重做" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} ariaLabel="重做">{buttonLabel('重做', <Redo2 size={16} />)}</ToolbarButton>
        </ToolbarGroup>

        <ToolbarGroup title="段落">
          <div className="sense-rich-toolbar-select">
            <Heading size={16} />
            <select
              aria-label="段落类型"
              value={paragraphType}
              onMouseDownCapture={preserveSelection}
              onChange={(event) => handleParagraphChange(event.target.value)}
            >
              <option value="paragraph">正文</option>
              <option value="h1">标题 1</option>
              <option value="h2">标题 2</option>
              <option value="h3">标题 3</option>
              <option value="h4">标题 4</option>
              <option value="blockquote">引用块</option>
              <option value="codeBlock">代码块</option>
            </select>
            <ChevronDown size={14} />
          </div>
        </ToolbarGroup>

        <ToolbarGroup title="文字样式">
          <ToolbarButton active={editor.isActive('bold')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.toggleBold().run())} title="粗体 (Ctrl/Cmd+B)" ariaLabel="切换粗体">{buttonLabel('粗体', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('italic')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.toggleItalic().run())} title="斜体 (Ctrl/Cmd+I)" ariaLabel="切换斜体">{buttonLabel('斜体', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('underline')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.toggleUnderline().run())} title="下划线" ariaLabel="切换下划线">{buttonLabel('下划线', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('strike')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.toggleStrike().run())} title="删除线" ariaLabel="切换删除线">{buttonLabel('删除线', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('code')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.toggleCode().run())} title="行内代码" ariaLabel="切换行内代码">{buttonLabel('行内代码', <FileCode2 size={16} />)}</ToolbarButton>
          <div className="sense-rich-toolbar-fontsize" aria-label="字号控制">
            <input
              type="text"
              inputMode="decimal"
              aria-label="输入字号像素值"
              value={fontSizeInput}
              onMouseDownCapture={preserveSelection}
              onChange={(event) => setFontSizeInput(event.target.value.replace(/[^\d.]/g, ''))}
              onBlur={() => {
                const normalizedValue = normalizeFontSize(fontSizeInput);
                if (!normalizedValue) {
                  setFontSizeInput(activeFontSize.replace(/px$/, ''));
                  return;
                }
                applyFontSize(normalizedValue);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyFontSize(fontSizeInput);
                }
              }}
            />
            <span className="sense-rich-toolbar-fontsize-unit">px</span>
            <select
              aria-label="字号预设"
              value={activeFontSize}
              onMouseDownCapture={preserveSelection}
              onChange={(event) => {
                setFontSizeInput(event.target.value.replace(/px$/, ''));
                applyFontSize(event.target.value);
              }}
            >
              {FONT_SIZE_PRESETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
        </ToolbarGroup>

        <ToolbarGroup title="颜色">
          <div className="sense-rich-toolbar-color">
            <ToolbarButton title="文字颜色与高亮" active={colorOpen} onClick={() => {
              preserveSelection();
              setLinkDialogMode('');
              setMediaDialogKind('');
              setTableDialogOpen(false);
              setMarkdownDialogOpen(false);
              setColorOpen((prev) => !prev);
            }} ariaLabel="打开文字颜色与高亮设置">颜色</ToolbarButton>
            <div ref={colorPopoverRef}>
              <TextColorPopover
                open={colorOpen}
                textColor={editor.getAttributes('textStyle')?.color || '#0f172a'}
                highlightColor={editor.getAttributes('highlight')?.color || '#facc15'}
                onTextColorChange={(value) => runWithPreservedSelection((chain) => chain.setColor(value).run())}
                onHighlightColorChange={(value) => runWithPreservedSelection((chain) => chain.toggleHighlight({ color: value }).run())}
                onClearTextColor={() => runWithPreservedSelection((chain) => chain.unsetColor().run())}
                onClearHighlight={() => runWithPreservedSelection((chain) => chain.unsetHighlight().run())}
              />
            </div>
          </div>
        </ToolbarGroup>

        <ToolbarGroup title="对齐 / 缩进">
          <ToolbarButton title="左对齐" active={isAlignmentActive('left')} onMouseDownCapture={preserveSelection} onClick={() => applyAlignment('left')} ariaLabel="左对齐"><AlignLeft size={16} /></ToolbarButton>
          <ToolbarButton title="居中对齐" active={isAlignmentActive('center')} onMouseDownCapture={preserveSelection} onClick={() => applyAlignment('center')} ariaLabel="居中对齐"><AlignCenter size={16} /></ToolbarButton>
          <ToolbarButton title="右对齐" active={isAlignmentActive('right')} onMouseDownCapture={preserveSelection} onClick={() => applyAlignment('right')} ariaLabel="右对齐"><AlignRight size={16} /></ToolbarButton>
          <ToolbarButton title="两端对齐" active={isAlignmentActive('justify')} onMouseDownCapture={preserveSelection} onClick={() => applyAlignment('justify')} ariaLabel="两端对齐"><AlignJustify size={16} /></ToolbarButton>
          <ToolbarButton title="增加缩进" onMouseDownCapture={preserveSelection} onClick={() => applyIndentChange('increase')} ariaLabel="增加缩进"><Indent size={16} /></ToolbarButton>
          <ToolbarButton title="减少缩进" onMouseDownCapture={preserveSelection} onClick={() => applyIndentChange('decrease')} ariaLabel="减少缩进"><Outdent size={16} /></ToolbarButton>
        </ToolbarGroup>

        <ToolbarGroup title="列表">
          <ToolbarButton title="无序列表" active={editor.isActive('bulletList')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.setBulletListStyle('disc').run())}>{buttonLabel('无序', <List size={16} />)}</ToolbarButton>
          <ToolbarButton title="有序列表" active={editor.isActive('orderedList')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.setOrderedListStyle('decimal').run())}>{buttonLabel('有序', <ListOrdered size={16} />)}</ToolbarButton>
          <ToolbarButton title="任务列表" active={editor.isActive('taskList')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.toggleTaskList().run())}>{buttonLabel('任务', <CheckSquare size={16} />)}</ToolbarButton>
          <div className="sense-rich-toolbar-select compact">
            <ListOrdered size={16} className="sense-rich-select-leading-icon" />
            <select
              aria-label="列表样式"
              value={editor.getAttributes('bulletList')?.listStyleType || editor.getAttributes('orderedList')?.listStyleType || 'disc'}
              onMouseDownCapture={preserveSelection}
              onChange={(event) => {
                const value = event.target.value;
                if (['disc', 'circle', 'square'].includes(value)) {
                  runWithPreservedSelection((chain) => chain.setBulletListStyle(value).run());
                  return;
                }
                runWithPreservedSelection((chain) => chain.setOrderedListStyle(value).run());
              }}
            >
              <option value="disc">disc</option>
              <option value="circle">circle</option>
              <option value="square">square</option>
              <option value="decimal">decimal</option>
              <option value="decimal-leading-zero">leading-zero</option>
              <option value="lower-alpha">lower-alpha</option>
              <option value="lower-roman">lower-roman</option>
            </select>
            <ChevronDown size={14} />
          </div>
        </ToolbarGroup>

        <div ref={mediaToolbarGroupRef} className="sense-rich-toolbar-insert-cluster">
          <ToolbarGroup title="插入">
            <ToolbarButton title="插入分割线" onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.setHorizontalRule().createParagraphNear().run())}>{buttonLabel('分割线', <Minus size={16} />)}</ToolbarButton>
            <ToolbarButton title="插入表格" onClick={() => openSingleFloatingUi(() => setTableDialogOpen(true), 'table-dialog')}>表格</ToolbarButton>
            <ToolbarButton title="插入外部链接" onClick={() => openSingleFloatingUi(() => setLinkDialogMode('external'), 'external-link-dialog')}>{buttonLabel('链接', <Link2 size={16} />)}</ToolbarButton>
            <ToolbarButton title="插入内部引用" onClick={() => openSingleFloatingUi(() => setLinkDialogMode('internal'), 'internal-link-dialog')}>{buttonLabel('内部引用', <ListChecks size={16} />)}</ToolbarButton>
            <ToolbarButton title="插入图片" onClick={() => openSingleFloatingUi(() => setMediaDialogKind('image'), 'media-image')}>{buttonLabel('图片', <ImageIcon size={16} />)}</ToolbarButton>
            <ToolbarButton title="插入音频" onClick={() => openSingleFloatingUi(() => setMediaDialogKind('audio'), 'media-audio')}>{buttonLabel('音频', <Mic size={16} />)}</ToolbarButton>
            <ToolbarButton title="插入视频" onClick={() => openSingleFloatingUi(() => setMediaDialogKind('video'), 'media-video')}>{buttonLabel('视频', <Video size={16} />)}</ToolbarButton>
            <ToolbarButton title="导入 Markdown" onClick={() => openSingleFloatingUi(() => setMarkdownDialogOpen(true), 'markdown-dialog')}>导入 MD</ToolbarButton>
          </ToolbarGroup>
        </div>

        <ToolbarGroup title="清除" compact>
          <ToolbarButton title="清除当前格式" onMouseDownCapture={preserveSelection} onClick={() => {
            runWithPreservedSelection((chain) => {
              const nextChain = chain.unsetAllMarks();
              if (editor.isActive('heading') || editor.isActive('blockquote') || editor.isActive('codeBlock')) {
                nextChain.setParagraph();
              }
              return nextChain.run();
            });
          }}>{buttonLabel('清除格式', <Eraser size={16} />)}</ToolbarButton>
        </ToolbarGroup>
      </div>

      <InsertLinkDialog
        open={!!linkDialogMode}
        mode={linkDialogMode || 'external'}
        initialValue={{
          ...editor.getAttributes(linkDialogMode === 'internal' ? 'internalSenseReference' : 'link'),
          displayText: editor.state.selection.empty ? (editor.getAttributes('internalSenseReference')?.displayText || preservedTextRef.current || '') : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')
        }}
        onClose={() => {
          restoreSelection();
          setLinkDialogMode('');
        }}
        onSubmit={handleLinkSubmit}
        onSearchReferences={onSearchReferences}
      />
      <InsertTableDialog open={tableDialogOpen} onClose={() => {
        restoreSelection();
        setTableDialogOpen(false);
      }} onSubmit={handleTableSubmit} />
      <InsertMediaDialog
        open={!!mediaDialogKind}
        kind={mediaDialogKind || 'image'}
        initialValue={mediaDialogKind === 'image' ? (selectedImage || {}) : mediaDialogKind === 'audio' ? (selectedAudio || {}) : (selectedVideo || {})}
        onClose={() => closeMediaDialog('cancel')}
        onUpload={onUploadMedia}
        onSubmit={handleMediaSubmit}
        mediaLibrary={mediaLibrary}
        restoreFocusOnClose={false}
        presentation="dialog"
        anchorRef={mediaToolbarGroupRef}
        portalTarget={dialogPortalTarget}
      />
      <ImportMarkdownDialog
        open={markdownDialogOpen}
        onClose={() => {
          restoreSelection();
          setMarkdownDialogOpen(false);
        }}
        onSubmit={({ html }) => {
          restoreSelection();
          editor.chain().focus().insertContent(html).run();
          closeFloatingUi();
          if (typeof onImportMarkdown === 'function') onImportMarkdown();
        }}
      />
    </>
  );
};

export default RichToolbar;
