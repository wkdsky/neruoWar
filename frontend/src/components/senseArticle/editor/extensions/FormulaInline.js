import { Node, mergeAttributes } from '@tiptap/core';
import { createFormulaNodeView } from './formulaNodeView';

const resolveFormulaSource = (element) => (
  String(
    element?.getAttribute?.('data-formula-source')
    || element?.textContent
    || ''
  ).trim()
);

const FormulaInline = Node.create({
  name: 'formulaInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      formulaSource: {
        default: '',
        parseHTML: (element) => resolveFormulaSource(element)
      },
      displayMode: {
        default: 'inline',
        parseHTML: (element) => String(element?.getAttribute?.('data-formula-display') || 'inline').trim() || 'inline'
      }
    };
  },

  parseHTML() {
    return [{
      tag: 'span[data-formula-placeholder="true"]'
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const formulaSource = String(HTMLAttributes?.formulaSource || '').trim();
    return ['span', mergeAttributes({
      class: 'sense-formula-placeholder',
      'data-formula-placeholder': 'true',
      'data-formula-source': formulaSource,
      'data-formula-display': 'inline'
    }), formulaSource];
  },

  addNodeView() {
    return (props) => createFormulaNodeView(props);
  },

  addCommands() {
    return {
      insertFormulaInline: (formulaSource) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: {
          formulaSource,
          displayMode: 'inline'
        }
      }),
      updateFormulaInline: (formulaSource) => ({ commands }) => commands.updateAttributes(this.name, {
        formulaSource,
        displayMode: 'inline'
      })
    };
  }
});

export default FormulaInline;
