import { Node, mergeAttributes } from '@tiptap/core';

const FigureImage = Node.create({
  name: 'figureImage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      caption: { default: '' },
      width: { default: '75%' },
      align: { default: 'center' }
    };
  },

  parseHTML() {
    return [{
      tag: 'figure[data-node-type="image"]'
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const className = `sense-rich-figure align-${HTMLAttributes.align || 'center'} size-${String(HTMLAttributes.width || '75%').replace('%', '')}`;
    return ['figure', mergeAttributes(HTMLAttributes, {
      'data-node-type': 'image',
      'data-align': HTMLAttributes.align || 'center',
      'data-width': HTMLAttributes.width || '75%',
      class: className
    }),
    ['img', {
      src: HTMLAttributes.src || '',
      alt: HTMLAttributes.alt || '',
      width: HTMLAttributes.width || '75%',
      'data-align': HTMLAttributes.align || 'center'
    }],
    ['figcaption', { class: 'sense-rich-caption' }, HTMLAttributes.caption || '']];
  },

  addCommands() {
    return {
      insertFigureImage: (attributes) => ({ commands }) => commands.insertContent({ type: this.name, attrs: attributes }),
      updateFigureImage: (attributes) => ({ commands }) => commands.updateAttributes(this.name, attributes)
    };
  }
});

export default FigureImage;
