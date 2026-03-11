import { Extension } from '@tiptap/core';

const INDENT_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock'];
const MAX_INDENT = 4;

const resolveActiveNodeType = (editor, types = []) => types.find((type) => editor.isActive(type)) || types[0];

const Indent = Extension.create({
  name: 'indent',

  addOptions() {
    return {
      types: INDENT_TYPES
    };
  },

  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element) => Number(element.getAttribute('data-indent') || 0),
          renderHTML: (attributes) => {
            const indent = Number(attributes.indent || 0);
            if (!indent) return {};
            return {
              'data-indent': String(indent)
            };
          }
        }
      }
    }];
  },

  addCommands() {
    return {
      increaseIndent: () => ({ editor, commands }) => {
        const type = resolveActiveNodeType(editor, this.options.types);
        const currentIndent = Number(editor.getAttributes(type)?.indent || 0);
        return commands.updateAttributes(type, { indent: Math.min(MAX_INDENT, currentIndent + 1) });
      },
      decreaseIndent: () => ({ editor, commands }) => {
        const type = resolveActiveNodeType(editor, this.options.types);
        const currentIndent = Number(editor.getAttributes(type)?.indent || 0);
        return commands.updateAttributes(type, { indent: Math.max(0, currentIndent - 1) });
      }
    };
  }
});

export default Indent;
