import { mergeAttributes } from '@tiptap/core';
import { Table, TableView, createColGroup } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import {
  buildCellClassName,
  buildCellDataAttributes,
  buildCellInlineStyle,
  buildTableAttributesPayload,
  buildTableClassName,
  DEFAULT_CELL_ATTRIBUTES,
  DEFAULT_TABLE_ATTRIBUTES,
  extractColumnWidthsFromTableNode,
  normalizeExplicitBorderEdges,
  normalizeBorderWidth,
  normalizeColor,
  normalizeDiagonalMode,
  normalizeTableAlign,
  normalizeTableBorderPreset,
  normalizeTableStyle,
  normalizeVerticalAlign,
  parseColumnWidths,
  resolveTableWidthStyle,
  resolveTableAlignStyle,
  serializeColumnWidths,
  TABLE_STYLE_CLASS_MAP
} from '../table/tableSchema';

const updateElementAttributes = (element, attributes = {}) => {
  Object.entries(attributes).forEach(([key, value]) => {
    if (value == null || value === '') {
      element.removeAttribute(key);
      return;
    }
    element.setAttribute(key, String(value));
  });
};

const MANAGED_CELL_CLASS_PATTERN = /^table-cell-(valign|diagonal)-/;

const syncCellDomAttributes = (cellElement, cellAttrs = {}) => {
  if (!cellElement) return;
  const dataAttributes = buildCellDataAttributes(cellAttrs);
  const managedClassName = buildCellClassName(cellAttrs);
  const preservedClasses = String(cellElement.getAttribute('class') || '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !MANAGED_CELL_CLASS_PATTERN.test(item));
  const nextClassName = [...preservedClasses, ...String(managedClassName || '').split(/\s+/).filter(Boolean)]
    .filter((item, index, list) => list.indexOf(item) === index)
    .join(' ');
  const nextStyle = buildCellInlineStyle(cellAttrs);

  updateElementAttributes(cellElement, dataAttributes);
  if (nextClassName) cellElement.setAttribute('class', nextClassName);
  else cellElement.removeAttribute('class');
  if (nextStyle) cellElement.setAttribute('style', nextStyle);
  else cellElement.removeAttribute('style');
};

const syncRenderedTableCells = (tableNode, tableElement) => {
  if (!tableNode?.childCount || !tableElement) return;
  const rowElements = Array.from(tableElement.querySelectorAll('tr'));
  for (let rowIndex = 0; rowIndex < tableNode.childCount; rowIndex += 1) {
    const rowNode = tableNode.child(rowIndex);
    const rowElement = rowElements[rowIndex];
    if (!rowNode || !rowElement) continue;
    const cellElements = Array.from(rowElement.children || []).filter((element) => {
      const tagName = String(element?.tagName || '').toLowerCase();
      return tagName === 'td' || tagName === 'th';
    });
    for (let cellIndex = 0; cellIndex < rowNode.childCount; cellIndex += 1) {
      syncCellDomAttributes(cellElements[cellIndex], rowNode.child(cellIndex)?.attrs || {});
    }
  }
};

class RichTableView extends TableView {
  constructor(node, cellMinWidth) {
    super(node, cellMinWidth);
    this.applyRichAttributes(node);
  }

  update(node) {
    const didUpdate = super.update(node);
    if (didUpdate) this.applyRichAttributes(node);
    return didUpdate;
  }

  applyRichAttributes(node) {
    const { attrs = {} } = node || {};
    const nextAttrs = buildTableAttributesPayload({
      ...attrs,
      columnWidths: attrs.columnWidths || extractColumnWidthsFromTableNode(node)
    });
    const className = buildTableClassName(nextAttrs);
    this.table.className = className;
    const widthStyle = resolveTableWidthStyle(nextAttrs);
    const alignStyle = resolveTableAlignStyle(nextAttrs);
    if (widthStyle) {
      const [, widthValue] = widthStyle.split(':');
      this.table.style.width = String(widthValue || '').trim();
    } else {
      this.table.style.removeProperty('width');
    }
    alignStyle.split(';').forEach((entry) => {
      const [property, value] = entry.split(':').map((item) => String(item || '').trim());
      if (!property) return;
      if (property === 'margin-left') this.table.style.marginLeft = value;
      if (property === 'margin-right') this.table.style.marginRight = value;
    });
    updateElementAttributes(this.table, {
      'data-table-style': nextAttrs.tableStyle,
      'data-table-align': nextAttrs.tableAlign,
      'data-table-width-mode': nextAttrs.tableWidthMode,
      'data-table-width-value': nextAttrs.tableWidthValue,
      'data-table-border-preset': nextAttrs.tableBorderPreset,
      'data-column-widths': nextAttrs.columnWidths || undefined
    });
    syncRenderedTableCells(node, this.table);
  }
}

const buildTableRenderStyle = (node, attributes) => {
  const styleParts = [];
  const widthStyle = resolveTableWidthStyle(attributes);
  if (widthStyle) styleParts.push(widthStyle);
  else {
    const computedWidths = extractColumnWidthsFromTableNode(node);
    if (computedWidths.length > 0) {
      const totalWidth = computedWidths.reduce((sum, item) => sum + Number(item || 0), 0);
      if (totalWidth > 0) styleParts.push(`min-width: ${totalWidth}px`);
    }
  }
  styleParts.push(resolveTableAlignStyle(attributes));
  return styleParts.filter(Boolean).join('; ');
};

const TableStyleExtension = Table.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      View: RichTableView
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      tableStyle: {
        default: DEFAULT_TABLE_ATTRIBUTES.tableStyle,
        parseHTML: (element) => normalizeTableStyle(element.getAttribute('data-table-style') || ''),
        renderHTML: () => ({})
      },
      tableWidthMode: {
        default: DEFAULT_TABLE_ATTRIBUTES.tableWidthMode,
        parseHTML: (element) => String(element.getAttribute('data-table-width-mode') || '').trim() || DEFAULT_TABLE_ATTRIBUTES.tableWidthMode,
        renderHTML: () => ({})
      },
      tableWidthValue: {
        default: DEFAULT_TABLE_ATTRIBUTES.tableWidthValue,
        parseHTML: (element) => String(element.getAttribute('data-table-width-value') || '').trim() || DEFAULT_TABLE_ATTRIBUTES.tableWidthValue,
        renderHTML: () => ({})
      },
      tableBorderPreset: {
        default: DEFAULT_TABLE_ATTRIBUTES.tableBorderPreset,
        parseHTML: (element) => normalizeTableBorderPreset(element.getAttribute('data-table-border-preset') || ''),
        renderHTML: () => ({})
      },
      tableAlign: {
        default: DEFAULT_TABLE_ATTRIBUTES.tableAlign,
        parseHTML: (element) => normalizeTableAlign(element.getAttribute('data-table-align') || ''),
        renderHTML: () => ({})
      },
      columnWidths: {
        default: DEFAULT_TABLE_ATTRIBUTES.columnWidths,
        parseHTML: (element) => serializeColumnWidths(element.getAttribute('data-column-widths') || ''),
        renderHTML: () => ({})
      }
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const attributes = buildTableAttributesPayload({
      ...HTMLAttributes,
      ...node.attrs,
      columnWidths: node.attrs.columnWidths || extractColumnWidthsFromTableNode(node)
    });
    const { colgroup } = createColGroup(node, this.options.cellMinWidth);
    const tableStyle = buildTableRenderStyle(node, attributes);
    return [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: buildTableClassName(attributes),
        style: tableStyle || undefined,
        'data-table-style': attributes.tableStyle,
        'data-table-align': attributes.tableAlign,
        'data-table-width-mode': attributes.tableWidthMode,
        'data-table-width-value': attributes.tableWidthValue,
        'data-table-border-preset': attributes.tableBorderPreset,
        'data-column-widths': attributes.columnWidths || undefined
      }),
      colgroup,
      ['tbody', 0]
    ];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setTableStyle: (tableStyle) => ({ commands, editor }) => {
        const normalizedStyle = normalizeTableStyle(tableStyle);
        const nextBorderPreset = normalizedStyle === 'three-line'
          ? 'three-line'
          : normalizeTableBorderPreset(editor.getAttributes('table')?.tableBorderPreset || DEFAULT_TABLE_ATTRIBUTES.tableBorderPreset);
        return commands.updateAttributes('table', {
          tableStyle: normalizedStyle,
          tableBorderPreset: nextBorderPreset
        });
      },
      setTableWidth: (tableWidthMode, tableWidthValue = DEFAULT_TABLE_ATTRIBUTES.tableWidthValue) => ({ commands }) => {
        const payload = buildTableAttributesPayload({ tableWidthMode, tableWidthValue });
        return commands.updateAttributes('table', payload);
      },
      setTableBorderPreset: (tableBorderPreset) => ({ commands }) => commands.updateAttributes('table', {
        tableBorderPreset: normalizeTableBorderPreset(tableBorderPreset)
      }),
      setTableAlign: (tableAlign) => ({ commands }) => commands.updateAttributes('table', {
        tableAlign: normalizeTableAlign(tableAlign)
      }),
      setTableColumnWidths: (columnWidths) => ({ commands }) => commands.updateAttributes('table', {
        columnWidths: serializeColumnWidths(columnWidths)
      }),
      setTableCellAttributes: (attributes = {}) => ({ commands }) => Object.entries(attributes).every(([name, value]) => commands.setCellAttribute(name, value)),
      clearTableCellBorderOverride: () => ({ commands }) => Object.entries({
        borderEdges: '',
        borderWidth: '',
        borderColor: ''
      }).every(([name, value]) => commands.setCellAttribute(name, value))
    };
  }
});

const parseColwidthAttribute = (element) => {
  const explicitValue = element.getAttribute('data-colwidth') || element.getAttribute('colwidth') || '';
  const widths = parseColumnWidths(explicitValue);
  return widths.length > 0 ? widths : null;
};

const buildTableCellLike = (Base, tagName) => Base.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colwidth: {
        default: null,
        parseHTML: (element) => parseColwidthAttribute(element),
        renderHTML: () => ({})
      },
      textAlign: {
        default: DEFAULT_CELL_ATTRIBUTES.textAlign,
        parseHTML: (element) => element.getAttribute('data-align') || element.style.textAlign || DEFAULT_CELL_ATTRIBUTES.textAlign,
        renderHTML: () => ({})
      },
      verticalAlign: {
        default: DEFAULT_CELL_ATTRIBUTES.verticalAlign,
        parseHTML: (element) => normalizeVerticalAlign(element.getAttribute('data-vertical-align') || element.style.verticalAlign || DEFAULT_CELL_ATTRIBUTES.verticalAlign),
        renderHTML: () => ({})
      },
      backgroundColor: {
        default: DEFAULT_CELL_ATTRIBUTES.backgroundColor,
        parseHTML: (element) => normalizeColor(element.getAttribute('data-background-color') || element.style.backgroundColor || ''),
        renderHTML: () => ({})
      },
      textColor: {
        default: DEFAULT_CELL_ATTRIBUTES.textColor,
        parseHTML: (element) => normalizeColor(element.getAttribute('data-text-color') || element.style.color || ''),
        renderHTML: () => ({})
      },
      borderEdges: {
        default: DEFAULT_CELL_ATTRIBUTES.borderEdges,
        parseHTML: (element) => normalizeExplicitBorderEdges(element.getAttribute('data-border-edges') || ''),
        renderHTML: () => ({})
      },
      borderWidth: {
        default: DEFAULT_CELL_ATTRIBUTES.borderWidth,
        parseHTML: (element) => normalizeBorderWidth(element.getAttribute('data-border-width') || ''),
        renderHTML: () => ({})
      },
      borderColor: {
        default: DEFAULT_CELL_ATTRIBUTES.borderColor,
        parseHTML: (element) => normalizeColor(element.getAttribute('data-border-color') || ''),
        renderHTML: () => ({})
      },
      diagonalMode: {
        default: DEFAULT_CELL_ATTRIBUTES.diagonalMode,
        parseHTML: (element) => normalizeDiagonalMode(element.getAttribute('data-diagonal') || ''),
        renderHTML: () => ({})
      }
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const cellAttrs = {
      ...(HTMLAttributes || {}),
      ...(node?.attrs || {})
    };
    const className = buildCellClassName(cellAttrs);
    const dataAttributes = buildCellDataAttributes(cellAttrs);
    const style = buildCellInlineStyle(cellAttrs);
    return [
      tagName,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, dataAttributes, {
        class: className || undefined,
        style: style || undefined
      }),
      0
    ];
  }
});

export const RichTableCell = buildTableCellLike(TableCell, 'td');
export const RichTableHeader = buildTableCellLike(TableHeader, 'th');
export const RichTableRow = TableRow;
export { DEFAULT_CELL_ATTRIBUTES, DEFAULT_TABLE_ATTRIBUTES, TABLE_STYLE_CLASS_MAP };
export default TableStyleExtension;
