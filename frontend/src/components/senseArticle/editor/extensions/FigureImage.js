import { Node } from '@tiptap/core';
import { resolveBackendAssetUrl } from '../../../../runtimeConfig';
import {
  buildAttachmentCaptionChildren,
  buildMediaAttachmentAttributes,
  buildMediaAttachmentFigureAttrs,
  createMediaAttachmentNodeView
} from './mediaAttachmentSupport';

const FigureImage = Node.create({
  name: 'figureImage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return buildMediaAttachmentAttributes({
      legacyCaptionAttr: 'data-caption',
      extraAttrs: {
        alt: {
          default: '',
          parseHTML: (element) => String(element?.querySelector?.('img')?.getAttribute?.('alt') || '').trim()
        }
      }
    });
  },

  parseHTML() {
    return [{
      tag: 'figure[data-node-type="image"]'
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const figureAttrs = buildMediaAttachmentFigureAttrs({ nodeName: this.name, attrs: HTMLAttributes });
    return ['figure', figureAttrs,
      ['img', {
        src: HTMLAttributes.src || '',
        alt: HTMLAttributes.alt || ''
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
        const image = document.createElement('img');
        image.draggable = false;
        return image;
      },
      syncMediaElement: (image, currentNode) => {
        const src = resolveBackendAssetUrl(currentNode?.attrs?.src || '');
        const alt = String(currentNode?.attrs?.alt || '').trim();
        if (image.getAttribute('src') !== src) {
          if (src) image.setAttribute('src', src);
          else image.removeAttribute('src');
        }
        image.setAttribute('alt', alt);
        image.style.width = '100%';
      },
      acceptsDirectPlayback: false
    });
  },

  addCommands() {
    return {
      insertFigureImage: (attributes) => ({ commands }) => commands.insertContent({ type: this.name, attrs: attributes }),
      updateFigureImage: (attributes) => ({ commands }) => commands.updateAttributes(this.name, attributes)
    };
  }
});

export default FigureImage;
