import { Node, mergeAttributes } from '@tiptap/core';
import { createFormulaNodeView } from './formulaNodeView';

const resolveFormulaSource = (element) => (
  String(
    element?.getAttribute?.('data-formula-source')
    || element?.textContent
    || ''
  ).trim()
);

const FormulaBlock = Node.create({
  name: 'formulaBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      formulaSource: {
        default: '',
        parseHTML: (element) => resolveFormulaSource(element)
      },
      displayMode: {
        default: 'block',
        parseHTML: (element) => String(element?.getAttribute?.('data-formula-display') || 'block').trim() || 'block'
      }
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-formula-placeholder="true"][data-formula-display="block"]'
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const formulaSource = String(HTMLAttributes?.formulaSource || '').trim();
    return ['div', mergeAttributes({
      class: 'sense-formula-placeholder sense-formula-block',
      'data-formula-placeholder': 'true',
      'data-formula-source': formulaSource,
      'data-formula-display': 'block'
    }), formulaSource];
  },

  addNodeView() {
    return (props) => createFormulaNodeView(props);
  },

  addCommands() {
    return {
      insertFormulaBlock: (formulaSource) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: {
          formulaSource,
          displayMode: 'block'
        }
      }),
      updateFormulaBlock: (formulaSource) => ({ commands }) => commands.updateAttributes(this.name, {
        formulaSource,
        displayMode: 'block'
      })
    };
  }
});

export default FormulaBlock;
