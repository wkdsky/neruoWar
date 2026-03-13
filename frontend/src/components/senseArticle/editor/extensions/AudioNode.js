import { Node } from '@tiptap/core';
import { resolveBackendAssetUrl } from '../../../../runtimeConfig';
import {
  buildAttachmentCaptionChildren,
  buildMediaAttachmentAttributes,
  buildMediaAttachmentFigureAttrs,
  createMediaAttachmentNodeView
} from './mediaAttachmentSupport';

const AudioNode = Node.create({
  name: 'audioNode',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return buildMediaAttachmentAttributes({
      legacyTitleAttr: 'data-title'
    });
  },

  parseHTML() {
    return [{
      tag: 'figure[data-node-type="audio"]'
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const figureAttrs = buildMediaAttachmentFigureAttrs({ nodeName: this.name, attrs: HTMLAttributes });
    return ['figure', figureAttrs,
      ['audio', {
        src: HTMLAttributes.src || '',
        controls: 'controls'
      }],
      ['figcaption', { class: 'sense-rich-caption' }, ...buildAttachmentCaptionChildren({
        attachmentIndex: HTMLAttributes.attachmentIndex,
        nodeName: this.name,
        attachmentTitle: HTMLAttributes.attachmentTitle
      })]
    ];
  },

  addNodeView() {
    return ({ node, view, getPos }) => createMediaAttachmentNodeView({
      node,
      view,
      getPos,
      createMediaElement: () => {
        const audio = document.createElement('audio');
        audio.controls = true;
        return audio;
      },
      syncMediaElement: (audio, currentNode) => {
        const src = resolveBackendAssetUrl(currentNode?.attrs?.src || '');
        if (audio.getAttribute('src') !== src) {
          if (src) audio.setAttribute('src', src);
          else audio.removeAttribute('src');
        }
        audio.style.width = '100%';
      },
      acceptsDirectPlayback: true,
      isResizable: false
    });
  },

  addCommands() {
    return {
      insertAudioNode: (attributes) => ({ commands }) => commands.insertContent({ type: this.name, attrs: attributes }),
      updateAudioNode: (attributes) => ({ commands }) => commands.updateAttributes(this.name, attributes)
    };
  }
});

export default AudioNode;
