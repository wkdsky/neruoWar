import { Node, mergeAttributes } from '@tiptap/core';

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

  addCommands() {
    return {
      insertAudioNode: (attributes) => ({ commands }) => commands.insertContent({ type: this.name, attrs: attributes }),
      updateAudioNode: (attributes) => ({ commands }) => commands.updateAttributes(this.name, attributes)
    };
  }
});

export default AudioNode;
