import { Node, mergeAttributes } from '@tiptap/core';

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

  addCommands() {
    return {
      insertVideoNode: (attributes) => ({ commands }) => commands.insertContent({ type: this.name, attrs: attributes }),
      updateVideoNode: (attributes) => ({ commands }) => commands.updateAttributes(this.name, attributes)
    };
  }
});

export default VideoNode;
