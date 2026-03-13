import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';

const BULLET_STYLE_CLASS_MAP = {
  disc: 'list-style-disc',
  circle: 'list-style-circle',
  square: 'list-style-square'
};

const ORDERED_STYLE_CLASS_MAP = {
  decimal: 'list-style-decimal',
  'decimal-leading-zero': 'list-style-leading-zero',
  'lower-alpha': 'list-style-lower-alpha',
  'lower-roman': 'list-style-lower-roman'
};

const RichBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listStyleType: {
        default: 'disc',
        parseHTML: (element) => element.getAttribute('data-list-style-type') || 'disc',
        renderHTML: (attributes) => ({
          'data-list-style-type': attributes.listStyleType || 'disc',
          class: BULLET_STYLE_CLASS_MAP[attributes.listStyleType] || BULLET_STYLE_CLASS_MAP.disc
        })
      }
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setBulletListStyle: (listStyleType = 'disc') => ({ chain, editor }) => {
        if (editor.isActive('bulletList')) {
          return chain().updateAttributes('bulletList', { listStyleType }).run();
        }
        return chain().toggleBulletList().updateAttributes('bulletList', { listStyleType }).run();
      }
    };
  }
});

const RichOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listStyleType: {
        default: 'decimal',
        parseHTML: (element) => element.getAttribute('data-list-style-type') || 'decimal',
        renderHTML: (attributes) => ({
          'data-list-style-type': attributes.listStyleType || 'decimal',
          class: ORDERED_STYLE_CLASS_MAP[attributes.listStyleType] || ORDERED_STYLE_CLASS_MAP.decimal
        })
      }
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setOrderedListStyle: (listStyleType = 'decimal') => ({ chain, editor }) => {
        if (editor.isActive('orderedList')) {
          return chain().updateAttributes('orderedList', { listStyleType }).run();
        }
        return chain().toggleOrderedList().updateAttributes('orderedList', { listStyleType }).run();
      }
    };
  }
});

export { BULLET_STYLE_CLASS_MAP, ORDERED_STYLE_CLASS_MAP, RichBulletList, RichOrderedList };
