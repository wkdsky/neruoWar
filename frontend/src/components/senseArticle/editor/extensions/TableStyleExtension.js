import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';

const TABLE_STYLE_CLASS_MAP = {
  default: 'table-style-default',
  compact: 'table-style-compact',
  zebra: 'table-style-zebra'
};

const TableStyleExtension = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tableStyle: {
        default: 'default',
        parseHTML: (element) => element.getAttribute('data-table-style') || 'default',
        renderHTML: (attributes) => ({
          'data-table-style': attributes.tableStyle || 'default',
          class: `sense-rich-table ${TABLE_STYLE_CLASS_MAP[attributes.tableStyle] || TABLE_STYLE_CLASS_MAP.default}`
        })
      }
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setTableStyle: (tableStyle) => ({ commands }) => commands.updateAttributes('table', { tableStyle })
    };
  }
});

const buildTableCellLike = (Base) => Base.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: 'left',
        parseHTML: (element) => element.getAttribute('data-align') || element.style.textAlign || 'left',
        renderHTML: (attributes) => ({
          'data-align': attributes.textAlign || 'left',
          style: attributes.textAlign ? `text-align: ${attributes.textAlign}` : ''
        })
      }
    };
  }
});

export const RichTableCell = buildTableCellLike(TableCell);
export const RichTableHeader = buildTableCellLike(TableHeader);
export const RichTableRow = TableRow;
export { TABLE_STYLE_CLASS_MAP };
export default TableStyleExtension;
