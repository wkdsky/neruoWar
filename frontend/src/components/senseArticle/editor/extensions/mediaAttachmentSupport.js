import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  buildAttachmentCaptionChildren,
  buildAttachmentCaptionText,
  extractAttachmentTitleFromCaption,
  isMediaAttachmentNodeName,
  resolveAttachmentReferenceText,
  resolveMediaAttachmentKind,
  resolveMediaAttachmentTypeLabel
} from './mediaAttachmentFormat';

export {
  buildAttachmentCaptionChildren,
  buildAttachmentCaptionText,
  extractAttachmentTitleFromCaption,
  isMediaAttachmentNodeName,
  resolveAttachmentReferenceText,
  resolveMediaAttachmentKind,
  resolveMediaAttachmentTypeLabel
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toFiniteNumber = (value) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const hashString = (value = '') => {
  const source = String(value || '');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

const normalizeAttachmentId = (value = '') => String(value || '')
  .trim()
  .replace(/[^a-zA-Z0-9_-]/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

const buildAttachmentIdentity = ({ nodeName = '', assetId = '', src = '', occurrence = 1 } = {}) => {
  const base = String(assetId || '').trim() || hashString(`${nodeName}:${src || ''}`);
  return normalizeAttachmentId(`sense-attachment-${base}-${occurrence}`);
};

const pickFigureElement = (element) => {
  if (!element || typeof element.querySelector !== 'function') return null;
  return element;
};

const resolveMediaWidthStyle = (mediaWidth = null) => {
  const width = toFiniteNumber(mediaWidth);
  if (!width || width < 160) return '';
  return `width: ${Math.round(width)}px;`;
};

const parseAttachmentIndex = (element) => {
  const figure = pickFigureElement(element);
  const raw = figure?.getAttribute?.('data-attachment-index')
    || figure?.dataset?.attachmentIndex
    || '';
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseAttachmentId = (element) => {
  const figure = pickFigureElement(element);
  return normalizeAttachmentId(figure?.getAttribute?.('data-attachment-id') || figure?.id || '');
};

const parseAttachmentTitle = (element, fallback = '') => {
  const figure = pickFigureElement(element);
  const explicit = String(figure?.getAttribute?.('data-attachment-title') || '').trim();
  if (explicit) return explicit;
  const caption = String(figure?.querySelector?.('figcaption')?.textContent || fallback || '').trim();
  return extractAttachmentTitleFromCaption(caption);
};

const parseAlignment = (element, fallback = 'center') => {
  const figure = pickFigureElement(element);
  const explicit = String(figure?.getAttribute?.('data-align') || '').trim();
  if (['left', 'center', 'right'].includes(explicit)) return explicit;
  const className = String(figure?.getAttribute?.('class') || '');
  if (className.includes('align-left')) return 'left';
  if (className.includes('align-right')) return 'right';
  return fallback;
};

const parseMediaWidth = (element) => {
  const figure = pickFigureElement(element);
  const raw = figure?.getAttribute?.('data-media-width')
    || figure?.style?.width
    || figure?.querySelector?.('img, audio, video')?.getAttribute?.('width')
    || '';
  const parsed = Number.parseInt(String(raw || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) && parsed >= 160 ? parsed : null;
};

const attrsDiffer = (currentAttrs = {}, nextAttrs = {}) => Object.keys(nextAttrs).some((key) => String(currentAttrs?.[key] ?? '') !== String(nextAttrs?.[key] ?? ''));

const syncFigureShell = ({ dom, caption, labelSpan, titleSpan, node }) => {
  const align = ['left', 'center', 'right'].includes(String(node?.attrs?.align || '')) ? node.attrs.align : 'center';
  const mediaWidth = toFiniteNumber(node?.attrs?.mediaWidth);
  const attachmentId = normalizeAttachmentId(node?.attrs?.attachmentId || '');
  const attachmentIndex = toFiniteNumber(node?.attrs?.attachmentIndex);
  const attachmentTitle = String(node?.attrs?.attachmentTitle || '').trim();
  const attachmentLabel = `${resolveAttachmentReferenceText(attachmentIndex)}（${resolveMediaAttachmentTypeLabel(node?.type?.name)}）`;

  if (attachmentId) dom.id = attachmentId;
  else dom.removeAttribute('id');
  dom.setAttribute('data-node-type', resolveMediaAttachmentKind(node?.type?.name));
  dom.setAttribute('data-attachment-id', attachmentId || '');
  dom.setAttribute('data-attachment-index', attachmentIndex ? String(attachmentIndex) : '');
  dom.setAttribute('data-attachment-title', attachmentTitle);
  dom.setAttribute('data-align', align);
  dom.setAttribute('data-media-width', mediaWidth ? String(Math.round(mediaWidth)) : '');
  dom.className = `sense-rich-figure align-${align}`;
  if (mediaWidth) dom.style.width = `${Math.round(mediaWidth)}px`;
  else dom.style.removeProperty('width');

  caption.className = 'sense-rich-caption';
  labelSpan.className = 'sense-rich-attachment-label';
  titleSpan.className = 'sense-rich-attachment-title';
  labelSpan.textContent = attachmentLabel;
  titleSpan.textContent = attachmentTitle ? ` ${attachmentTitle}` : '';
};

const updateAttachmentNodeAttrs = ({ getPos, view, node, patch = {} }) => {
  if (typeof getPos !== 'function' || !view?.state?.tr || !view?.dispatch) return;
  const position = getPos();
  const nextAttrs = {
    ...(node?.attrs || {}),
    ...patch
  };
  view.dispatch(view.state.tr.setNodeMarkup(position, undefined, nextAttrs));
};

export const createMediaAttachmentNodeView = ({
  node,
  view,
  getPos,
  createMediaElement,
  syncMediaElement,
  acceptsDirectPlayback = false,
  isResizable = true
}) => {
  const dom = document.createElement('figure');
  const mediaElement = createMediaElement();
  const caption = document.createElement('figcaption');
  const labelSpan = document.createElement('span');
  const titleSpan = document.createElement('span');
  const resizeHandle = document.createElement('button');
  const deleteButton = document.createElement('button');

  dom.contentEditable = 'false';
  dom.className = 'sense-rich-figure align-center';
  caption.append(labelSpan, titleSpan);
  resizeHandle.type = 'button';
  resizeHandle.className = 'sense-rich-media-resize-handle';
  resizeHandle.setAttribute('aria-label', '调整附件尺寸');
  resizeHandle.hidden = !isResizable;
  deleteButton.type = 'button';
  deleteButton.className = 'sense-rich-media-delete-button';
  deleteButton.setAttribute('aria-label', '删除附件');
  deleteButton.textContent = '×';
  dom.append(mediaElement, caption, resizeHandle, deleteButton);

  let currentNodeRef = node;

  const promptForTitle = () => {
    const event = new CustomEvent('sense-media-attachment-edit-title', {
      detail: {
        pos: typeof getPos === 'function' ? getPos() : null,
        title: String(currentNodeRef?.attrs?.attachmentTitle || '').trim(),
        nodeName: String(currentNodeRef?.type?.name || '').trim()
      }
    });
    window.dispatchEvent(event);
  };

  const deleteNode = () => {
    if (typeof getPos !== 'function' || !view?.state?.tr || !view?.dispatch) return;
    const position = getPos();
    const transaction = view.state.tr.delete(position, position + currentNodeRef.nodeSize);
    view.dispatch(transaction);
  };

  const beginResize = (event) => {
    if (!isResizable) return;
    event.preventDefault();
    event.stopPropagation();
    const initialWidth = dom.getBoundingClientRect().width || 480;
    const startX = event.clientX;

    const handlePointerMove = (moveEvent) => {
      moveEvent.preventDefault();
      const nextWidth = Math.round(clamp(initialWidth + (moveEvent.clientX - startX), 160, 1200));
      updateAttachmentNodeAttrs({
        getPos,
        view,
        node: currentNodeRef,
        patch: {
          mediaWidth: nextWidth
        }
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  titleSpan.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    promptForTitle();
  });
  resizeHandle.addEventListener('pointerdown', beginResize);
  deleteButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    deleteNode();
  });

  const syncFromNode = (currentNode) => {
    currentNodeRef = currentNode;
    syncFigureShell({ dom, caption, labelSpan, titleSpan, node: currentNode });
    syncMediaElement(mediaElement, currentNode);
  };

  syncFromNode(node);

  return {
    dom,
    update: (updatedNode) => {
      if (updatedNode.type.name !== currentNodeRef.type.name) return false;
      syncFromNode(updatedNode);
      return true;
    },
    selectNode: () => {
      dom.classList.add('ProseMirror-selectednode');
    },
    deselectNode: () => {
      dom.classList.remove('ProseMirror-selectednode');
    },
    stopEvent: (event) => (
      resizeHandle.contains(event.target)
      || deleteButton.contains(event.target)
      || titleSpan.contains(event.target)
      || (acceptsDirectPlayback && mediaElement.contains(event.target))
    ),
    ignoreMutation: () => true
  };
};

export const buildMediaAttachmentAttributes = ({
  legacyTitleAttr = '',
  legacyCaptionAttr = '',
  extraAttrs = {}
} = {}) => ({
  src: {
    default: '',
    parseHTML: (element) => String(element?.querySelector?.('img, audio, video')?.getAttribute?.('src') || '').trim()
  },
  assetId: {
    default: '',
    parseHTML: (element) => String(element?.getAttribute?.('data-asset-id') || '').trim()
  },
  attachmentTitle: {
    default: '',
    parseHTML: (element) => {
      const legacyValue = legacyTitleAttr
        ? String(element?.querySelector?.('img, audio, video')?.getAttribute?.(legacyTitleAttr) || '').trim()
        : legacyCaptionAttr
          ? String(element?.getAttribute?.(legacyCaptionAttr) || '').trim()
          : '';
      return parseAttachmentTitle(element, legacyValue);
    }
  },
  attachmentIndex: {
    default: null,
    parseHTML: (element) => parseAttachmentIndex(element)
  },
  attachmentId: {
    default: '',
    parseHTML: (element) => parseAttachmentId(element)
  },
  align: {
    default: 'center',
    parseHTML: (element) => parseAlignment(element, 'center')
  },
  mediaWidth: {
    default: null,
    parseHTML: (element) => parseMediaWidth(element)
  },
  ...extraAttrs
});

export const buildMediaAttachmentFigureAttrs = ({ nodeName = '', attrs = {} } = {}) => {
  const align = ['left', 'center', 'right'].includes(String(attrs?.align || '')) ? attrs.align : 'center';
  const attachmentId = normalizeAttachmentId(attrs?.attachmentId || '');
  const attachmentTitle = String(attrs?.attachmentTitle || '').trim();
  const attachmentIndex = toFiniteNumber(attrs?.attachmentIndex);
  const mediaWidth = nodeName === 'audioNode' ? null : toFiniteNumber(attrs?.mediaWidth);
  return {
    id: attachmentId || undefined,
    class: `sense-rich-figure align-${align}`,
    style: resolveMediaWidthStyle(mediaWidth) || undefined,
    'data-node-type': resolveMediaAttachmentKind(nodeName),
    'data-asset-id': String(attrs?.assetId || '').trim() || undefined,
    'data-attachment-id': attachmentId || undefined,
    'data-attachment-index': attachmentIndex ? String(attachmentIndex) : undefined,
    'data-attachment-title': attachmentTitle || undefined,
    'data-align': align,
    'data-media-width': mediaWidth ? String(Math.round(mediaWidth)) : undefined
  };
};

const buildMediaAttachmentSyncTransaction = ({ schema, state, force = false, transactions = [] } = {}) => {
  if (!force && !transactions.some((transaction) => transaction.docChanged)) return null;

  const mediaReferenceMark = schema.marks.mediaAttachmentReference;
  const nodeUpdates = [];
  const textUpdates = [];
  const assetUsageCount = new Map();
  const mediaTargetsByAssetId = new Map();
  const mediaTargetsByAttachmentId = new Map();
  let attachmentIndex = 0;

  state.doc.descendants((node, pos) => {
    if (!isMediaAttachmentNodeName(node?.type?.name)) return;
    attachmentIndex += 1;
    const baseKey = String(node?.attrs?.assetId || '').trim() || hashString(`${node?.type?.name}:${node?.attrs?.src || ''}`);
    const occurrence = Number(assetUsageCount.get(baseKey) || 0) + 1;
    assetUsageCount.set(baseKey, occurrence);
    const nextAttachmentId = normalizeAttachmentId(String(node?.attrs?.attachmentId || '').trim()) || buildAttachmentIdentity({
      nodeName: node?.type?.name,
      assetId: node?.attrs?.assetId || '',
      src: node?.attrs?.src || '',
      occurrence
    });
    const nextAttrs = {
      ...node.attrs,
      attachmentId: nextAttachmentId,
      attachmentIndex,
      attachmentTitle: String(node?.attrs?.attachmentTitle || '').trim(),
      align: ['left', 'center', 'right'].includes(String(node?.attrs?.align || '')) ? node.attrs.align : 'center',
      mediaWidth: node?.type?.name === 'audioNode'
        ? null
        : clamp(toFiniteNumber(node?.attrs?.mediaWidth) || 480, 160, 1200)
    };
    if (attrsDiffer(node.attrs, nextAttrs)) {
      nodeUpdates.push({ pos, attrs: nextAttrs, type: node.type });
    }
    const target = {
      attachmentId: nextAttachmentId,
      attachmentIndex,
      assetId: String(node?.attrs?.assetId || '').trim()
    };
    if (target.assetId && !mediaTargetsByAssetId.has(target.assetId)) {
      mediaTargetsByAssetId.set(target.assetId, target);
    }
    mediaTargetsByAttachmentId.set(target.attachmentId, target);
  });

  if (mediaReferenceMark) {
    state.doc.descendants((node, pos) => {
      if (!node?.isText) return;
      const targetMark = (node.marks || []).find((mark) => mark.type === mediaReferenceMark);
      if (!targetMark) return;
      const assetId = String(targetMark.attrs?.assetId || '').trim();
      const attachmentId = normalizeAttachmentId(targetMark.attrs?.attachmentId || '');
      const target = (attachmentId && mediaTargetsByAttachmentId.get(attachmentId))
        || (assetId && mediaTargetsByAssetId.get(assetId))
        || null;
      const nextText = resolveAttachmentReferenceText(target?.attachmentIndex ?? null);
      const nextAttrs = {
        ...targetMark.attrs,
        attachmentId: target?.attachmentId || '',
        attachmentIndex: target?.attachmentIndex ?? null,
        displayText: nextText,
        href: target?.attachmentId ? `#${target.attachmentId}` : '#'
      };
      if (String(node.text || '') === nextText && !attrsDiffer(targetMark.attrs, nextAttrs)) return;
      textUpdates.push({
        from: pos,
        to: pos + node.nodeSize,
        text: nextText,
        marks: (node.marks || []).map((mark) => (mark.type === mediaReferenceMark ? mediaReferenceMark.create(nextAttrs) : mark))
      });
    });
  }

  if (nodeUpdates.length === 0 && textUpdates.length === 0) return null;

  const tr = state.tr;
  nodeUpdates
    .sort((left, right) => right.pos - left.pos)
    .forEach((entry) => {
      tr.setNodeMarkup(entry.pos, entry.type, entry.attrs);
    });
  textUpdates
    .sort((left, right) => right.from - left.from)
    .forEach((entry) => {
      tr.replaceWith(entry.from, entry.to, schema.text(entry.text, entry.marks));
    });
  return tr.docChanged ? tr : null;
};

export const createMediaAttachmentSyncPlugin = (schema) => {
  const pluginKey = new PluginKey('sense-media-attachment-sync');
  return new Plugin({
    key: pluginKey,
    view: (view) => {
      const dispatchInitialSync = () => {
        const tr = buildMediaAttachmentSyncTransaction({
          schema,
          state: view.state,
          force: true
        });
        if (tr) view.dispatch(tr);
      };
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(dispatchInitialSync);
      } else {
        dispatchInitialSync();
      }
      return {};
    },
    appendTransaction: (transactions, _oldState, newState) => buildMediaAttachmentSyncTransaction({
      schema,
      state: newState,
      transactions
    })
  });
};

export const MediaAttachmentSyncExtension = Extension.create({
  name: 'mediaAttachmentSync',
  addProseMirrorPlugins() {
    return [createMediaAttachmentSyncPlugin(this.editor.schema)];
  }
});
