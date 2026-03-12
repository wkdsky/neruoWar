import { Node, mergeAttributes } from '@tiptap/core';
import { resolveBackendAssetUrl } from '../../../../runtimeConfig';

const AudioNode = Node.create({
  name: 'audioNode',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: '' },
      title: { default: '' },
      description: { default: '' }
    };
  },

  parseHTML() {
    return [{
      tag: 'figure[data-node-type="audio"]'
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, {
      'data-node-type': 'audio',
      class: 'sense-rich-figure align-center size-100'
    }),
    ['audio', {
      src: HTMLAttributes.src || '',
      controls: 'controls',
      'data-title': HTMLAttributes.title || '',
      'data-description': HTMLAttributes.description || ''
    }],
    ['figcaption', { class: 'sense-rich-caption' }, HTMLAttributes.title || HTMLAttributes.description || '']];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('figure');
      const audio = document.createElement('audio');
      const caption = document.createElement('figcaption');

      dom.setAttribute('data-node-type', 'audio');
      dom.className = 'sense-rich-figure align-center size-100';
      dom.contentEditable = 'false';

      audio.controls = true;
      audio.setAttribute('data-title', '');
      audio.setAttribute('data-description', '');

      caption.className = 'sense-rich-caption';

      const syncFromNode = (currentNode) => {
        const src = resolveBackendAssetUrl(currentNode?.attrs?.src || '');
        const title = currentNode?.attrs?.title || '';
        const description = currentNode?.attrs?.description || '';
        if (audio.getAttribute('src') !== src) {
          if (src) audio.setAttribute('src', src);
          else audio.removeAttribute('src');
        }
        audio.setAttribute('data-title', title);
        audio.setAttribute('data-description', description);
        caption.textContent = title || description || '';
      };

      syncFromNode(node);
      dom.append(audio, caption);

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
        stopEvent: (event) => audio.contains(event.target),
        ignoreMutation: () => true
      };
    };
  },

  addCommands() {
    return {
      insertAudioNode: (attributes) => ({ commands }) => commands.insertContent({ type: this.name, attrs: attributes }),
      updateAudioNode: (attributes) => ({ commands }) => commands.updateAttributes(this.name, attributes)
    };
  }
});

export default AudioNode;
