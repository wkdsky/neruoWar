import { Mark } from '@tiptap/core';

const MediaAttachmentReference = Mark.create({
  name: 'mediaAttachmentReference',
  inclusive: false,
  excludes: 'link internalSenseReference',

  addAttributes() {
    return {
      href: {
        default: '#',
        parseHTML: (element) => String(element?.getAttribute?.('href') || '#').trim() || '#'
      },
      assetId: {
        default: '',
        parseHTML: (element) => String(element?.getAttribute?.('data-asset-id') || '').trim()
      },
      attachmentId: {
        default: '',
        parseHTML: (element) => String(element?.getAttribute?.('data-attachment-id') || '').trim()
      },
      attachmentIndex: {
        default: null,
        parseHTML: (element) => {
          const value = Number(element?.getAttribute?.('data-attachment-index'));
          return Number.isFinite(value) && value > 0 ? value : null;
        }
      },
      displayText: {
        default: '',
        parseHTML: (element) => String(element?.getAttribute?.('data-display-text') || element?.textContent || '').trim()
      }
    };
  },

  parseHTML() {
    return [{
      tag: 'a[data-reference-kind="media-attachment"]'
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', {
      class: 'sense-media-reference-link',
      href: HTMLAttributes.href || '#',
      'data-reference-kind': 'media-attachment',
      'data-asset-id': HTMLAttributes.assetId || '',
      'data-attachment-id': HTMLAttributes.attachmentId || '',
      'data-attachment-index': HTMLAttributes.attachmentIndex ? String(HTMLAttributes.attachmentIndex) : '',
      'data-display-text': HTMLAttributes.displayText || ''
    }, 0];
  },

  addCommands() {
    return {
      setMediaAttachmentReference: (attributes) => ({ commands }) => commands.setMark(this.name, attributes),
      unsetMediaAttachmentReference: () => ({ commands }) => commands.unsetMark(this.name)
    };
  }
});

export default MediaAttachmentReference;
