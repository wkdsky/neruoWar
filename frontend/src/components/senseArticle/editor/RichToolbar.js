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

const buttonLabel = (label, icon) => (<>{icon}<span>{label}</span></>);

const RichToolbar = ({
  editor,
  onSearchReferences,
  onUploadMedia,
  mediaLibrary = null,
  onImportMarkdown = null
}) => {
  const [linkDialogMode, setLinkDialogMode] = useState('');
  const [mediaDialogKind, setMediaDialogKind] = useState('');
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [markdownDialogOpen, setMarkdownDialogOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [fontSizeInput, setFontSizeInput] = useState('16');
  const colorPopoverRef = useRef(null);
  const preservedSelectionRef = useRef(null);
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
        activeFontSize: normalizeFontSize(currentEditor.getAttributes('textStyle')?.fontSize || '16px') || '16px'
      };
    }
  });

  const paragraphType = editorUiState?.paragraphType || 'paragraph';

  const activeFontSize = editorUiState?.activeFontSize || '16px';

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

  if (!editor) return null;

  const closeFloatingUi = () => {
    setColorOpen(false);
    setLinkDialogMode('');
    setMediaDialogKind('');
    setTableDialogOpen(false);
    setMarkdownDialogOpen(false);
  };

  const preserveSelection = () => {
    const { from, to } = editor.state.selection;
    preservedSelectionRef.current = { from, to };
    preservedTextRef.current = editor.state.doc.textBetween(from, to, ' ');
  };

  const chainWithPreservedSelection = () => {
    const chain = editor.chain().focus();
    const selection = preservedSelectionRef.current;
    if (!selection) return chain;
    return chain.setTextSelection(selection);
  };

  const restoreSelection = () => {
    chainWithPreservedSelection().run();
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
    const chain = chainWithPreservedSelection();
    if (value === 'paragraph') {
      chain.clearNodes().setParagraph().run();
      return;
    }
    if (value === 'h1') chain.toggleHeading({ level: 1 }).run();
    if (value === 'h2') chain.toggleHeading({ level: 2 }).run();
    if (value === 'h3') chain.toggleHeading({ level: 3 }).run();
    if (value === 'h4') chain.toggleHeading({ level: 4 }).run();
    if (value === 'blockquote') chain.toggleBlockquote().run();
    if (value === 'codeBlock') chain.toggleCodeBlock().run();
  };

  const applyFontSize = (rawValue) => {
    const normalizedValue = normalizeFontSize(rawValue);
    if (!normalizedValue) return;
    chainWithPreservedSelection().setFontSize(normalizedValue).run();
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
    if (payload.kind === 'image') {
      if (editor.isActive('figureImage')) chainWithPreservedSelection().updateFigureImage(payload).run();
      else chainWithPreservedSelection().insertFigureImage(payload).run();
    }
    if (payload.kind === 'audio') {
      if (editor.isActive('audioNode')) chainWithPreservedSelection().updateAudioNode(payload).run();
      else chainWithPreservedSelection().insertAudioNode(payload).run();
    }
    if (payload.kind === 'video') {
      if (editor.isActive('videoNode')) chainWithPreservedSelection().updateVideoNode(payload).run();
      else chainWithPreservedSelection().insertVideoNode(payload).run();
    }
    closeFloatingUi();
  };

  const openSingleFloatingUi = (openCallback) => {
    preserveSelection();
    closeFloatingUi();
    openCallback();
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
          <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="粗体 (Ctrl/Cmd+B)" ariaLabel="切换粗体">{buttonLabel('粗体', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体 (Ctrl/Cmd+I)" ariaLabel="切换斜体">{buttonLabel('斜体', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="下划线" ariaLabel="切换下划线">{buttonLabel('下划线', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="删除线" ariaLabel="切换删除线">{buttonLabel('删除线', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="行内代码" ariaLabel="切换行内代码">{buttonLabel('行内代码', <FileCode2 size={16} />)}</ToolbarButton>
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
                onTextColorChange={(value) => editor.chain().focus().setColor(value).run()}
                onHighlightColorChange={(value) => editor.chain().focus().toggleHighlight({ color: value }).run()}
                onClearTextColor={() => editor.chain().focus().unsetColor().run()}
                onClearHighlight={() => editor.chain().focus().unsetHighlight().run()}
              />
            </div>
          </div>
        </ToolbarGroup>

        <ToolbarGroup title="对齐 / 缩进">
          <ToolbarButton title="左对齐" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} ariaLabel="左对齐"><AlignLeft size={16} /></ToolbarButton>
          <ToolbarButton title="居中对齐" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} ariaLabel="居中对齐"><AlignCenter size={16} /></ToolbarButton>
          <ToolbarButton title="右对齐" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} ariaLabel="右对齐"><AlignRight size={16} /></ToolbarButton>
          <ToolbarButton title="两端对齐" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} ariaLabel="两端对齐"><AlignJustify size={16} /></ToolbarButton>
          <ToolbarButton title="增加缩进" onClick={() => editor.chain().focus().increaseIndent().run()} ariaLabel="增加缩进"><Indent size={16} /></ToolbarButton>
          <ToolbarButton title="减少缩进" onClick={() => editor.chain().focus().decreaseIndent().run()} ariaLabel="减少缩进"><Outdent size={16} /></ToolbarButton>
        </ToolbarGroup>

        <ToolbarGroup title="列表">
          <ToolbarButton title="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().setBulletListStyle('disc').run()}>{buttonLabel('无序', <List size={16} />)}</ToolbarButton>
          <ToolbarButton title="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().setOrderedListStyle('decimal').run()}>{buttonLabel('有序', <ListOrdered size={16} />)}</ToolbarButton>
          <ToolbarButton title="任务列表" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>{buttonLabel('任务', <CheckSquare size={16} />)}</ToolbarButton>
          <div className="sense-rich-toolbar-select compact">
            <select
              aria-label="列表样式"
              value={editor.getAttributes('bulletList')?.listStyleType || editor.getAttributes('orderedList')?.listStyleType || 'disc'}
              onMouseDownCapture={preserveSelection}
              onChange={(event) => {
                const value = event.target.value;
                if (['disc', 'circle', 'square'].includes(value)) chainWithPreservedSelection().setBulletListStyle(value).run();
                else chainWithPreservedSelection().setOrderedListStyle(value).run();
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
          </div>
        </ToolbarGroup>

        <ToolbarGroup title="插入">
          <ToolbarButton title="插入分割线" onClick={() => editor.chain().focus().setHorizontalRule().createParagraphNear().run()}>{buttonLabel('分割线', <Minus size={16} />)}</ToolbarButton>
          <ToolbarButton title="插入表格" onClick={() => openSingleFloatingUi(() => setTableDialogOpen(true))}>表格</ToolbarButton>
          <ToolbarButton title="插入外部链接" onClick={() => openSingleFloatingUi(() => setLinkDialogMode('external'))}>{buttonLabel('链接', <Link2 size={16} />)}</ToolbarButton>
          <ToolbarButton title="插入内部引用" onClick={() => openSingleFloatingUi(() => setLinkDialogMode('internal'))}>{buttonLabel('内部引用', <ListChecks size={16} />)}</ToolbarButton>
          <ToolbarButton title="插入图片" onClick={() => openSingleFloatingUi(() => setMediaDialogKind('image'))}>{buttonLabel('图片', <ImageIcon size={16} />)}</ToolbarButton>
          <ToolbarButton title="插入音频" onClick={() => openSingleFloatingUi(() => setMediaDialogKind('audio'))}>{buttonLabel('音频', <Mic size={16} />)}</ToolbarButton>
          <ToolbarButton title="插入视频" onClick={() => openSingleFloatingUi(() => setMediaDialogKind('video'))}>{buttonLabel('视频', <Video size={16} />)}</ToolbarButton>
          <ToolbarButton title="导入 Markdown" onClick={() => openSingleFloatingUi(() => setMarkdownDialogOpen(true))}>导入 MD</ToolbarButton>
        </ToolbarGroup>

        <ToolbarGroup title="清除" compact>
          <ToolbarButton title="清除当前格式" onClick={() => {
            const chain = editor.chain().focus().unsetAllMarks();
            if (editor.isActive('heading') || editor.isActive('blockquote') || editor.isActive('codeBlock')) {
              chain.setParagraph();
            }
            chain.run();
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
        onClose={() => {
          restoreSelection();
          setMediaDialogKind('');
        }}
        onUpload={onUploadMedia}
        onSubmit={handleMediaSubmit}
        mediaLibrary={mediaLibrary}
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
