import { Node } from '@tiptap/core';
import { resolveBackendAssetUrl } from '../../../../runtimeConfig';
import {
  buildAttachmentCaptionChildren,
  buildMediaAttachmentAttributes,
  buildMediaAttachmentFigureAttrs,
  createMediaAttachmentNodeView
} from './mediaAttachmentSupport';

const VideoNode = Node.create({
  name: 'videoNode',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return buildMediaAttachmentAttributes({
      legacyCaptionAttr: 'data-caption',
      extraAttrs: {
        poster: {
          default: '',
          parseHTML: (element) => String(element?.querySelector?.('video')?.getAttribute?.('poster') || '').trim()
        }
      }
    });
  },

  parseHTML() {
    return [{
      tag: 'figure[data-node-type="video"]'
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const figureAttrs = buildMediaAttachmentFigureAttrs({ nodeName: this.name, attrs: HTMLAttributes });
    return ['figure', figureAttrs,
      ['video', {
        src: HTMLAttributes.src || '',
        poster: HTMLAttributes.poster || '',
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
        const video = document.createElement('video');
        video.controls = true;
        return video;
      },
      syncMediaElement: (video, currentNode) => {
        const src = resolveBackendAssetUrl(currentNode?.attrs?.src || '');
        const poster = resolveBackendAssetUrl(currentNode?.attrs?.poster || '');
        if (video.getAttribute('src') !== src) {
          if (src) video.setAttribute('src', src);
          else video.removeAttribute('src');
        }
        if (poster) video.setAttribute('poster', poster);
        else video.removeAttribute('poster');
        video.style.width = '100%';
      },
      acceptsDirectPlayback: true
    });
  },

  addCommands() {
    return {
      insertVideoNode: (attributes) => ({ commands }) => commands.insertContent({ type: this.name, attrs: attributes }),
      updateVideoNode: (attributes) => ({ commands }) => commands.updateAttributes(this.name, attributes)
    };
  }
});

export default VideoNode;
