import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Calculator,
  Check,
  CheckSquare,
  ChevronDown,
  Eraser,
  FileText,
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
import { resolveBackendAssetUrl } from '../../../runtimeConfig';
import ToolbarButton from './ToolbarButton';
import ToolbarGroup from './ToolbarGroup';
import InsertLinkDialog from './dialogs/InsertLinkDialog';
import InsertTableDialog from './dialogs/InsertTableDialog';
import InsertMediaDialog from './dialogs/InsertMediaDialog';
import ImportMarkdownDialog from './dialogs/ImportMarkdownDialog';
import FormulaEditorDialog from './dialogs/FormulaEditorDialog';
import { buildAttachmentCaptionText, resolveAttachmentReferenceText } from './extensions/mediaAttachmentFormat';
import { buildTableWidthPayload } from './table/tableWidthUtils';
import { applyAttrsToSelectedTableCells, getTableSelectionState, isCellSelection } from './table/tableSelectionState';
import {
  describeActiveElement,
  describeEditorSelection,
  describeScrollPosition,
  senseEditorDebugLog
} from './editorDebug';

const buttonLabel = (label, icon) => (<>{icon}<span>{label}</span></>);
const menuButtonLabel = (label, icon) => (<>{icon}<span>{label}</span><ChevronDown size={14} /></>);

const MEDIA_KIND_BY_NODE_NAME = {
  figureImage: 'image',
  audioNode: 'audio',
  videoNode: 'video'
};

const BULLET_LIST_STYLE_OPTIONS = [
  { value: 'disc', label: '实心圆点' },
  { value: 'circle', label: '空心圆点' },
  { value: 'square', label: '方形圆点' }
];

const ORDERED_LIST_STYLE_OPTIONS = [
  { value: 'decimal', label: '1. 2. 3.' },
  { value: 'decimal-leading-zero', label: '01. 02. 03.' },
  { value: 'lower-alpha', label: 'a. b. c.' },
  { value: 'lower-roman', label: 'i. ii. iii.' }
];

const collectSavedMediaAttachments = (editor, mediaLibrary = null) => {
  if (!editor?.state?.doc?.descendants) return [];
  const savedAssets = Array.isArray(mediaLibrary?.referencedAssets) ? mediaLibrary.referencedAssets : [];
  const assetById = new Map();
  const assetByUrl = new Map();
  savedAssets.forEach((asset) => {
    const assetId = String(asset?._id || '').trim();
    const resolvedUrl = resolveBackendAssetUrl(asset?.url || asset?.src || '');
    if (assetId && !assetById.has(assetId)) assetById.set(assetId, asset);
    if (resolvedUrl && !assetByUrl.has(resolvedUrl)) assetByUrl.set(resolvedUrl, asset);
  });

  const rows = [];
  editor.state.doc.descendants((node) => {
    const nodeName = String(node?.type?.name || '').trim();
    const kind = MEDIA_KIND_BY_NODE_NAME[nodeName];
    if (!kind) return;
    const resolvedSrc = resolveBackendAssetUrl(node?.attrs?.src || '');
    const assetId = String(node?.attrs?.assetId || '').trim();
    const savedAsset = (assetId && assetById.get(assetId)) || (resolvedSrc && assetByUrl.get(resolvedSrc)) || null;
    if (!savedAsset) return;
    const attachmentIndex = Number(node?.attrs?.attachmentIndex || 0);
    const attachmentId = String(node?.attrs?.attachmentId || '').trim();
    const attachmentTitle = String(node?.attrs?.attachmentTitle || savedAsset?.title || savedAsset?.originalName || '').trim();
    rows.push({
      key: attachmentId || `${kind}:${savedAsset?._id || resolvedSrc}:${rows.length + 1}`,
      kind,
      assetId: assetId || String(savedAsset?._id || ''),
      attachmentId,
      attachmentIndex: attachmentIndex || rows.length + 1,
      attachmentTitle,
      displayLabel: buildAttachmentCaptionText({
        attachmentIndex: attachmentIndex || rows.length + 1,
        nodeName,
        attachmentTitle
      }),
      statusLabel: `${savedAsset?.mimeType || kind} · 已保存于正文`,
      isSaved: true
    });
  });

  return rows.sort((left, right) => Number(left.attachmentIndex || 0) - Number(right.attachmentIndex || 0));
};

const RichToolbar = ({
  editor,
  onSearchReferences,
  onUploadMedia,
  mediaLibrary = null,
  mediaLibraryState = 'idle',
  mediaLibraryError = null,
  onRetryMediaLibrary = null,
  onImportMarkdown = null,
  dialogPortalTarget = null
}) => {
  const [referenceDialogMode, setReferenceDialogMode] = useState('');
  const [mediaDialogKind, setMediaDialogKind] = useState('');
  const [toolbarMenu, setToolbarMenu] = useState('');
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [markdownDialogOpen, setMarkdownDialogOpen] = useState(false);
  const [formulaDialogOpen, setFormulaDialogOpen] = useState(false);
  const mediaToolbarGroupRef = useRef(null);
  const mediaMenuAnchorRef = useRef(null);
  const referenceMenuAnchorRef = useRef(null);
  const bulletListMenuAnchorRef = useRef(null);
  const orderedListMenuAnchorRef = useRef(null);
  const formatBlockMenuAnchorRef = useRef(null);
  const preservedSelectionBookmarkRef = useRef(null);
  const preservedCellSelectionRef = useRef(null);
  const preservedTextRef = useRef('');

  const selectedImage = editor?.isActive('figureImage') ? editor.getAttributes('figureImage') : null;
  const selectedAudio = editor?.isActive('audioNode') ? editor.getAttributes('audioNode') : null;
  const selectedVideo = editor?.isActive('videoNode') ? editor.getAttributes('videoNode') : null;
  const selectedFormula = editor?.isActive('formulaInline')
    ? { ...editor.getAttributes('formulaInline'), nodeType: 'formulaInline' }
    : editor?.isActive('formulaBlock')
      ? { ...editor.getAttributes('formulaBlock'), nodeType: 'formulaBlock' }
      : null;

  const editorUiState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor) {
        return { paragraphType: 'paragraph', formatBlockType: '' };
      }
      let paragraphType = 'paragraph';
      if (currentEditor.isActive('heading', { level: 1 })) paragraphType = 'h1';
      else if (currentEditor.isActive('heading', { level: 2 })) paragraphType = 'h2';
      else if (currentEditor.isActive('heading', { level: 3 })) paragraphType = 'h3';
      const formatBlockType = currentEditor.isActive('blockquote')
        ? 'blockquote'
        : currentEditor.isActive('codeBlock')
          ? 'codeBlock'
          : '';

      return {
        paragraphType,
        formatBlockType,
        tableSelectionState: getTableSelectionState(currentEditor)
      };
    }
  });

  const paragraphType = editorUiState?.paragraphType || 'paragraph';
  const formatBlockType = editorUiState?.formatBlockType || '';
  const tableSelectionState = editorUiState?.tableSelectionState || {};
  const mediaAttachments = collectSavedMediaAttachments(editor, mediaLibrary);
  const activeBulletListStyle = editor.getAttributes('bulletList')?.listStyleType || 'disc';
  const activeOrderedListStyle = editor.getAttributes('orderedList')?.listStyleType || 'decimal';

  useEffect(() => {
    if (!toolbarMenu) return undefined;
    const handlePointerDown = (event) => {
      const mediaMenuOpen = toolbarMenu === 'media';
      const referenceMenuOpen = toolbarMenu === 'reference';
      const bulletListMenuOpen = toolbarMenu === 'bullet-list';
      const orderedListMenuOpen = toolbarMenu === 'ordered-list';
      const formatBlockMenuOpen = toolbarMenu === 'format-block';
      if (mediaMenuOpen && mediaMenuAnchorRef.current?.contains(event.target)) return;
      if (referenceMenuOpen && referenceMenuAnchorRef.current?.contains(event.target)) return;
      if (bulletListMenuOpen && bulletListMenuAnchorRef.current?.contains(event.target)) return;
      if (orderedListMenuOpen && orderedListMenuAnchorRef.current?.contains(event.target)) return;
      if (formatBlockMenuOpen && formatBlockMenuAnchorRef.current?.contains(event.target)) return;
      setToolbarMenu('');
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setToolbarMenu('');
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [toolbarMenu]);

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
    setReferenceDialogMode('');
    setMediaDialogKind('');
    setToolbarMenu('');
    setTableDialogOpen(false);
    setMarkdownDialogOpen(false);
    setFormulaDialogOpen(false);
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
    const normalizedValue = value === 'justify' ? 'center' : value;
    if (editor.isActive('figureImage')) {
      chainWithPreservedSelection().updateFigureImage({ align: normalizedValue }).run();
      return;
    }
    if (editor.isActive('audioNode')) {
      chainWithPreservedSelection().updateAudioNode({ align: normalizedValue }).run();
      return;
    }
    if (editor.isActive('videoNode')) {
      chainWithPreservedSelection().updateVideoNode({ align: normalizedValue }).run();
      return;
    }
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
    if (editor.isActive('figureImage') || editor.isActive('audioNode') || editor.isActive('videoNode')) {
      const activeAttrs = editor.isActive('figureImage')
        ? editor.getAttributes('figureImage')
        : editor.isActive('audioNode')
          ? editor.getAttributes('audioNode')
          : editor.getAttributes('videoNode');
      return String(activeAttrs?.align || 'center') === (value === 'justify' ? 'center' : value);
    }
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

  const applyStandardLink = ({ href, target = '_blank', rel = null, className = '', text = '' }) => {
    const attrs = {
      href,
      target,
      rel,
      class: className || null
    };
    if (editor.state.selection.empty) {
      insertOrUpdateMarkedText('link', attrs, text || href);
      return;
    }
    chainWithPreservedSelection().extendMarkRange('link').setLink(attrs).run();
  };

  const handleParagraphChange = (value) => {
    runWithPreservedSelection((chain) => {
      if (value === 'paragraph') return chain.clearNodes().setParagraph().run();
      if (value === 'h1') return chain.toggleHeading({ level: 1 }).run();
      if (value === 'h2') return chain.toggleHeading({ level: 2 }).run();
      if (value === 'h3') return chain.toggleHeading({ level: 3 }).run();
      return false;
    });
  };

  const handleFormatBlockChange = (value) => {
    if (!value) return;
    runWithPreservedSelection((chain) => {
      if (value === 'blockquote') return chain.toggleBlockquote().run();
      if (value === 'codeBlock') return chain.toggleCodeBlock().run();
      return false;
    });
    setToolbarMenu('');
  };

  const handleLinkSubmit = (payload) => {
    if (payload.type === 'external') {
      applyStandardLink({
        href: payload.href,
        target: payload.target,
        rel: payload.target === '_blank' ? 'noopener noreferrer nofollow' : null,
        text: payload.displayText || payload.href
      });
    } else if (payload.type === 'literature') {
      applyStandardLink({
        href: payload.href,
        target: payload.target,
        rel: payload.target === '_blank' ? 'noopener noreferrer nofollow' : null,
        className: 'sense-literature-reference',
        text: payload.displayText || payload.title || payload.href
      });
    } else if (payload.type === 'media') {
      const attrs = {
        assetId: payload.assetId || '',
        attachmentId: payload.attachmentId || '',
        attachmentIndex: payload.attachmentIndex ?? null,
        displayText: resolveAttachmentReferenceText(payload.attachmentIndex),
        href: payload.attachmentId ? `#${payload.attachmentId}` : '#'
      };
      chainWithPreservedSelection().insertContent({
        type: 'text',
        text: resolveAttachmentReferenceText(payload.attachmentIndex),
        marks: [{ type: 'mediaAttachmentReference', attrs }]
      }).run();
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

  const handleFormulaSubmit = ({ latex, displayMode }) => {
    restoreSelectionFromBookmark();
    const normalizedSource = String(latex || '').trim();
    const normalizedDisplayMode = String(displayMode || '').trim() === 'block' ? 'block' : 'inline';
    if (!normalizedSource) return;
    if (editor.isActive('formulaInline') && normalizedDisplayMode === 'inline') {
      chainWithPreservedSelection().updateFormulaInline(normalizedSource).run();
    } else if (editor.isActive('formulaBlock') && normalizedDisplayMode === 'block') {
      chainWithPreservedSelection().updateFormulaBlock(normalizedSource).run();
    } else if (editor.isActive('formulaInline') || editor.isActive('formulaBlock')) {
      chainWithPreservedSelection().deleteSelection().insertContent({
        type: normalizedDisplayMode === 'block' ? 'formulaBlock' : 'formulaInline',
        attrs: {
          formulaSource: normalizedSource,
          displayMode: normalizedDisplayMode
        }
      }).run();
    } else if (normalizedDisplayMode === 'block') {
      chainWithPreservedSelection().insertFormulaBlock(normalizedSource).run();
    } else {
      chainWithPreservedSelection().insertFormulaInline(normalizedSource).run();
    }
    closeFloatingUi();
    window.requestAnimationFrame(() => {
      focusEditor('formula-submit');
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

  const closeReferenceDialog = (reason = 'cancel') => {
    setReferenceDialogMode('');
    window.requestAnimationFrame(() => {
      restoreSelection();
      senseEditorDebugLog('toolbar', 'Reference dialog closed', {
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

  const toggleToolbarMenu = (menuName) => {
    preserveSelection();
    setReferenceDialogMode('');
    setMediaDialogKind('');
    setTableDialogOpen(false);
    setMarkdownDialogOpen(false);
    setToolbarMenu((prev) => (prev === menuName ? '' : menuName));
  };

  const applyBulletListStyle = (styleValue) => {
    runWithPreservedSelection((chain) => chain.setBulletListStyle(styleValue).run());
    setToolbarMenu('');
  };

  const applyOrderedListStyle = (styleValue) => {
    runWithPreservedSelection((chain) => chain.setOrderedListStyle(styleValue).run());
    setToolbarMenu('');
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
            </select>
            <ChevronDown size={14} />
          </div>
        </ToolbarGroup>

        <ToolbarGroup title="格式块">
          <div ref={formatBlockMenuAnchorRef} className="sense-table-menu-anchor">
            <ToolbarButton
              title="格式块"
              active={formatBlockType === 'blockquote' || formatBlockType === 'codeBlock' || toolbarMenu === 'format-block'}
              onMouseDownCapture={preserveSelection}
              onClick={() => toggleToolbarMenu('format-block')}
            >
              {menuButtonLabel('格式块', <FileText size={16} />)}
            </ToolbarButton>
            {toolbarMenu === 'format-block' ? (
              <div className="sense-table-menu-panel" role="menu" aria-label="格式块菜单">
                <button
                  type="button"
                  className={`sense-table-menu-item${formatBlockType === 'blockquote' ? ' checked' : ''}`}
                  onClick={() => handleFormatBlockChange('blockquote')}
                >
                  <span className="sense-table-menu-check">{formatBlockType === 'blockquote' ? <Check size={14} /> : null}</span>
                  <span>引用块</span>
                </button>
                <button
                  type="button"
                  className={`sense-table-menu-item${formatBlockType === 'codeBlock' ? ' checked' : ''}`}
                  onClick={() => handleFormatBlockChange('codeBlock')}
                >
                  <span className="sense-table-menu-check">{formatBlockType === 'codeBlock' ? <Check size={14} /> : null}</span>
                  <span>代码块</span>
                </button>
              </div>
            ) : null}
          </div>
        </ToolbarGroup>

        <ToolbarGroup title="文字样式">
          <ToolbarButton active={editor.isActive('bold')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.toggleBold().run())} title="粗体 (Ctrl/Cmd+B)" ariaLabel="切换粗体">{buttonLabel('粗体', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('italic')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.toggleItalic().run())} title="斜体 (Ctrl/Cmd+I)" ariaLabel="切换斜体">{buttonLabel('斜体', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('underline')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.toggleUnderline().run())} title="下划线" ariaLabel="切换下划线">{buttonLabel('下划线', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('strike')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.toggleStrike().run())} title="删除线" ariaLabel="切换删除线">{buttonLabel('删除线', <Type size={16} />)}</ToolbarButton>
          <ToolbarButton active={editor.isActive('formulaInline') || editor.isActive('formulaBlock') || formulaDialogOpen} onMouseDownCapture={preserveSelection} onClick={() => openSingleFloatingUi(() => setFormulaDialogOpen(true), 'formula-dialog')} title="公式 / 特殊字符" ariaLabel="插入公式或特殊字符">{buttonLabel('公式/特殊字符', <Calculator size={16} />)}</ToolbarButton>
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
          <div ref={bulletListMenuAnchorRef} className="sense-table-menu-anchor">
            <ToolbarButton
              title="无序列表"
              active={editor.isActive('bulletList') || toolbarMenu === 'bullet-list'}
              onMouseDownCapture={preserveSelection}
              onClick={() => toggleToolbarMenu('bullet-list')}
            >
              {menuButtonLabel('无序', <List size={16} />)}
            </ToolbarButton>
            {toolbarMenu === 'bullet-list' ? (
              <div className="sense-table-menu-panel" role="menu" aria-label="无序列表样式菜单">
                {BULLET_LIST_STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`sense-table-menu-item${editor.isActive('bulletList') && activeBulletListStyle === option.value ? ' checked' : ''}`}
                    onClick={() => applyBulletListStyle(option.value)}
                  >
                    <span className="sense-table-menu-check">{editor.isActive('bulletList') && activeBulletListStyle === option.value ? <Check size={14} /> : null}</span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div ref={orderedListMenuAnchorRef} className="sense-table-menu-anchor">
            <ToolbarButton
              title="有序列表"
              active={editor.isActive('orderedList') || toolbarMenu === 'ordered-list'}
              onMouseDownCapture={preserveSelection}
              onClick={() => toggleToolbarMenu('ordered-list')}
            >
              {menuButtonLabel('有序', <ListOrdered size={16} />)}
            </ToolbarButton>
            {toolbarMenu === 'ordered-list' ? (
              <div className="sense-table-menu-panel" role="menu" aria-label="有序列表样式菜单">
                {ORDERED_LIST_STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`sense-table-menu-item${editor.isActive('orderedList') && activeOrderedListStyle === option.value ? ' checked' : ''}`}
                    onClick={() => applyOrderedListStyle(option.value)}
                  >
                    <span className="sense-table-menu-check">{editor.isActive('orderedList') && activeOrderedListStyle === option.value ? <Check size={14} /> : null}</span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <ToolbarButton title="任务列表" active={editor.isActive('taskList')} onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.toggleTaskList().run())}>{buttonLabel('任务', <CheckSquare size={16} />)}</ToolbarButton>
        </ToolbarGroup>

        <div ref={mediaToolbarGroupRef} className="sense-rich-toolbar-insert-cluster">
          <ToolbarGroup title="插入">
            <ToolbarButton title="插入分割线" onMouseDownCapture={preserveSelection} onClick={() => runWithPreservedSelection((chain) => chain.setHorizontalRule().createParagraphNear().run())}>{buttonLabel('分割线', <Minus size={16} />)}</ToolbarButton>
            <ToolbarButton title="插入表格" onClick={() => openSingleFloatingUi(() => setTableDialogOpen(true), 'table-dialog')}>表格</ToolbarButton>
            <div ref={mediaMenuAnchorRef} className="sense-table-menu-anchor">
              <ToolbarButton
                title="插入多媒体"
                active={toolbarMenu === 'media'}
                onMouseDownCapture={preserveSelection}
                onClick={() => setToolbarMenu((prev) => (prev === 'media' ? '' : 'media'))}
              >
                {menuButtonLabel('插入多媒体', <ImageIcon size={16} />)}
              </ToolbarButton>
              {toolbarMenu === 'media' ? (
                <div className="sense-table-menu-panel" role="menu" aria-label="插入多媒体菜单">
                  <button type="button" className="sense-table-menu-item" onClick={() => openSingleFloatingUi(() => setMediaDialogKind('image'), 'media-image-dialog')}>
                    <span className="sense-table-menu-icon"><ImageIcon size={14} /></span>
                    <span>图片</span>
                  </button>
                  <button type="button" className="sense-table-menu-item" onClick={() => openSingleFloatingUi(() => setMediaDialogKind('audio'), 'media-audio-dialog')}>
                    <span className="sense-table-menu-icon"><Mic size={14} /></span>
                    <span>音频</span>
                  </button>
                  <button type="button" className="sense-table-menu-item" onClick={() => openSingleFloatingUi(() => setMediaDialogKind('video'), 'media-video-dialog')}>
                    <span className="sense-table-menu-icon"><Video size={14} /></span>
                    <span>视频</span>
                  </button>
                </div>
              ) : null}
            </div>
            <div ref={referenceMenuAnchorRef} className="sense-table-menu-anchor">
              <ToolbarButton
                title="引用"
                active={toolbarMenu === 'reference'}
                onMouseDownCapture={preserveSelection}
                onClick={() => setToolbarMenu((prev) => (prev === 'reference' ? '' : 'reference'))}
              >
                {menuButtonLabel('引用', <Link2 size={16} />)}
              </ToolbarButton>
              {toolbarMenu === 'reference' ? (
                <div className="sense-table-menu-panel" role="menu" aria-label="引用菜单">
                  <button type="button" className="sense-table-menu-item" onClick={() => openSingleFloatingUi(() => setReferenceDialogMode('media'), 'reference-media-dialog')}>
                    <span className="sense-table-menu-icon"><ImageIcon size={14} /></span>
                    <span>引用内部多媒体</span>
                  </button>
                  <button type="button" className="sense-table-menu-item" onClick={() => openSingleFloatingUi(() => setReferenceDialogMode('external'), 'reference-external-dialog')}>
                    <span className="sense-table-menu-icon"><Link2 size={14} /></span>
                    <span>引用外部链接</span>
                  </button>
                  <button type="button" className="sense-table-menu-item" onClick={() => openSingleFloatingUi(() => setReferenceDialogMode('literature'), 'reference-literature-dialog')}>
                    <span className="sense-table-menu-icon"><FileText size={14} /></span>
                    <span>引用文献</span>
                  </button>
                  <button type="button" className="sense-table-menu-item" onClick={() => openSingleFloatingUi(() => setReferenceDialogMode('internal'), 'reference-internal-dialog')}>
                    <span className="sense-table-menu-icon"><ListChecks size={14} /></span>
                    <span>引用其他释义</span>
                  </button>
                </div>
              ) : null}
            </div>
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
        open={!!referenceDialogMode}
        mode={referenceDialogMode || 'external'}
        initialValue={{
          ...editor.getAttributes(referenceDialogMode === 'internal' ? 'internalSenseReference' : 'link'),
          displayText: editor.state.selection.empty ? (editor.getAttributes('internalSenseReference')?.displayText || preservedTextRef.current || '') : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')
        }}
        onClose={() => closeReferenceDialog('cancel')}
        onSubmit={handleLinkSubmit}
        onSearchReferences={onSearchReferences}
        mediaLibrary={mediaLibrary}
        mediaLibraryState={mediaLibraryState}
        mediaLibraryError={mediaLibraryError}
        onRetryMediaLibrary={onRetryMediaLibrary}
        mediaAttachments={mediaAttachments}
        restoreFocusOnClose={false}
        autoFocusTarget="dialog"
        portalTarget={dialogPortalTarget}
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
      <FormulaEditorDialog
        open={formulaDialogOpen}
        initialValue={selectedFormula?.formulaSource || ''}
        initialDisplayMode={selectedFormula?.displayMode || (selectedFormula?.nodeType === 'formulaBlock' ? 'block' : 'inline')}
        submitLabel={selectedFormula ? '确认修改' : '插入公式'}
        onClose={() => {
          restoreSelection();
          setFormulaDialogOpen(false);
        }}
        onSubmit={handleFormulaSubmit}
        restoreFocusOnClose={false}
        autoFocusTarget="none"
        portalTarget={dialogPortalTarget}
      />
    </>
  );
};

export default RichToolbar;
