import {
  buildCellDataAttributes,
  buildCellInlineStyle,
  buildTableAttributesPayload,
  parseColumnWidths,
  serializeColumnWidths
} from './tableSchema';

test('table schema helpers normalize table payload and column width bridge', () => {
  expect(buildTableAttributesPayload({
    tableStyle: 'three-line',
    tableBorderPreset: 'three-line',
    tableWidthMode: 'custom',
    tableWidthValue: 76,
    columnWidths: [120, 180]
  })).toEqual({
    tableStyle: 'three-line',
    tableBorderPreset: 'three-line',
    tableWidthMode: 'custom',
    tableWidthValue: '76',
    columnWidths: '120,180'
  });
  expect(serializeColumnWidths([120, 180])).toBe('120,180');
  expect(parseColumnWidths('120,180')).toEqual([120, 180]);
  expect(buildTableAttributesPayload({
    tableStyle: 'default',
    tableBorderPreset: 'inner-horizontal',
    tableWidthMode: 'auto'
  }).tableBorderPreset).toBe('inner-horizontal');
});

test('table schema helpers build controlled cell attrs and inline style', () => {
  const dataAttributes = buildCellDataAttributes({
    textAlign: 'center',
    verticalAlign: 'middle',
    backgroundColor: '#fef3c7',
    textColor: '#0f172a',
    borderEdges: 'top,left',
    borderWidth: '2',
    borderColor: '#0f172a',
    diagonalMode: 'tl-br',
    colwidth: [160]
  });

  expect(dataAttributes['data-align']).toBe('center');
  expect(dataAttributes['data-vertical-align']).toBe('middle');
  expect(dataAttributes['data-diagonal']).toBe('tl-br');
  expect(dataAttributes['data-colwidth']).toBe('160');

  const inlineStyle = buildCellInlineStyle({
    textAlign: 'center',
    verticalAlign: 'middle',
    backgroundColor: '#fef3c7',
    textColor: '#0f172a',
    borderEdges: 'top,left',
    borderWidth: '2',
    borderColor: '#0f172a',
    colwidth: [160]
  });

  expect(inlineStyle).toContain('text-align: center');
  expect(inlineStyle).toContain('vertical-align: middle');
  expect(inlineStyle).toContain('background-color: #fef3c7');
  expect(inlineStyle).toContain('border-top: 2px solid #0f172a');
  expect(inlineStyle).toContain('border-right: none');
  expect(inlineStyle).toContain('width: 160px');
});
