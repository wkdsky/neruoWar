import { Node, mergeAttributes } from '@tiptap/core';
import { resolveBackendAssetUrl } from '../../../../runtimeConfig';

const VideoNode = Node.create({
  name: 'videoNode',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: '' },
      poster: { default: '' },
      caption: { default: '' },
      width: { default: '100%' }
    };
  },

  parseHTML() {
    return [{
      tag: 'figure[data-node-type="video"]'
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const widthClass = `size-${String(HTMLAttributes.width || '100%').replace('%', '')}`;
    return ['figure', mergeAttributes(HTMLAttributes, {
      'data-node-type': 'video',
      class: `sense-rich-figure align-center ${widthClass}`
    }),
    ['video', {
      src: HTMLAttributes.src || '',
      poster: HTMLAttributes.poster || '',
      controls: 'controls',
      width: HTMLAttributes.width || '100%'
    }],
    ['figcaption', { class: 'sense-rich-caption' }, HTMLAttributes.caption || '']];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('figure');
      const video = document.createElement('video');
      const caption = document.createElement('figcaption');

      dom.setAttribute('data-node-type', 'video');
      dom.contentEditable = 'false';

      video.controls = true;
      caption.className = 'sense-rich-caption';

      const syncFromNode = (currentNode) => {
        const src = resolveBackendAssetUrl(currentNode?.attrs?.src || '');
        const poster = resolveBackendAssetUrl(currentNode?.attrs?.poster || '');
        const width = currentNode?.attrs?.width || '100%';
        const widthClass = `size-${String(width).replace('%', '')}`;

        dom.className = `sense-rich-figure align-center ${widthClass}`;
        if (src) video.setAttribute('src', src);
        else video.removeAttribute('src');
        if (poster) video.setAttribute('poster', poster);
        else video.removeAttribute('poster');
        video.setAttribute('width', width);
        caption.textContent = currentNode?.attrs?.caption || '';
      };

      syncFromNode(node);
      dom.append(video, caption);

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) return false;
          syncFromNode(updatedNode);
          return true;
        },
        selectNode: () => {
          dom.classList.add('ProseMirror-selectednode');
        },
        deselectNode: () => {
          dom.classList.remove('ProseMirror-selectednode');
        },
        stopEvent: (event) => video.contains(event.target),
        ignoreMutation: () => true
      };
    };
  },

  addCommands() {
    return {
      insertVideoNode: (attributes) => ({ commands }) => commands.insertContent({ type: this.name, attrs: attributes }),
      updateVideoNode: (attributes) => ({ commands }) => commands.updateAttributes(this.name, attributes)
    };
  }
});

export default VideoNode;
