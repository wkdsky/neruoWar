import { Mark, mergeAttributes } from '@tiptap/core';

const InternalSenseReference = Mark.create({
  name: 'internalSenseReference',
  inclusive: false,
  excludes: 'link',

  addAttributes() {
    return {
      href: {
        default: null
      },
      nodeId: {
        default: ''
      },
      senseId: {
        default: ''
      },
      displayText: {
        default: ''
      },
      referenceId: {
        default: ''
      }
    };
  },

  parseHTML() {
    return [{
      tag: 'a[data-reference-kind="internal-sense"]'
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, {
      class: 'sense-internal-reference',
      href: HTMLAttributes.href || `#sense-ref-${HTMLAttributes.nodeId}-${HTMLAttributes.senseId}`,
      'data-reference-kind': 'internal-sense',
      'data-node-id': HTMLAttributes.nodeId || '',
      'data-sense-id': HTMLAttributes.senseId || '',
      'data-display-text': HTMLAttributes.displayText || '',
      'data-reference-id': HTMLAttributes.referenceId || ''
    }), 0];
  },

  addCommands() {
    return {
      setInternalSenseReference: (attributes) => ({ commands }) => commands.setMark(this.name, attributes),
      unsetInternalSenseReference: () => ({ commands }) => commands.unsetMark(this.name)
    };
  }
});

export default InternalSenseReference;
