const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRevisionContent } = require('../services/senseArticleValidationService');

test('validation blocks empty body and invalid references', () => {
  const result = validateRevisionContent({
    revision: {
      ast: { blocks: [] },
      referenceIndex: [{ referenceId: 'ref_1', targetNodeId: 'node-x', targetSenseId: 'sense-x', isValid: false }],
      mediaReferences: []
    }
  });

  assert.equal(result.hasBlockingIssues, true);
  assert.ok(result.blocking.some((item) => item.code === 'empty_body'));
  assert.ok(result.blocking.some((item) => item.code === 'invalid_internal_references'));
});

test('validation warns on heading jumps, image alt missing and empty tables', () => {
  const result = validateRevisionContent({
    revision: {
      ast: {
        blocks: [
          { type: 'heading', level: 1, plainText: '一级标题' },
          { type: 'heading', level: 4, plainText: '四级标题' },
          { type: 'table', id: 'table_1', rows: [{ cells: ['', ''] }] }
        ]
      },
      headingIndex: [
        { headingId: 'h1', level: 1, title: '一级标题' },
        { headingId: 'h4', level: 4, title: '四级标题' }
      ],
      mediaReferences: [{ kind: 'image', url: '/uploads/sense-article-media/demo.png', alt: '' }]
    }
  });

  assert.equal(result.hasWarnings, true);
  assert.ok(result.warnings.some((item) => item.code === 'heading_level_jump'));
  assert.ok(result.warnings.some((item) => item.code === 'image_alt_missing'));
  assert.ok(result.warnings.some((item) => item.code === 'empty_tables'));
});

test('validation detects invalid table enums, width and merge structure', () => {
  const result = validateRevisionContent({
    revision: {
      ast: {
        blocks: [
          {
            type: 'table',
            id: 'table_invalid',
            tableStyle: 'not-exists',
            tableBorderPreset: 'unknown',
            tableWidthMode: 'custom',
            tableWidthValue: '130',
            columnWidths: [32, 160],
            mergeSummary: { mergedCellCount: 1, maxRowspan: 9 },
            rows: [
              {
                cells: [
                  { text: 'A', isHeader: false, rowspan: 0, colspan: 1, diagonalMode: 'tl-br' }
                ]
              }
            ]
          }
        ]
      }
    }
  });

  assert.equal(result.hasWarnings, true);
  assert.equal(result.hasBlockingIssues, true);
  assert.ok(result.warnings.some((item) => item.code === 'invalid_table_style'));
  assert.ok(result.warnings.some((item) => item.code === 'invalid_table_border_preset'));
  assert.ok(result.warnings.some((item) => item.code === 'invalid_table_width_value'));
  assert.ok(result.warnings.some((item) => item.code === 'invalid_table_column_widths'));
  assert.ok(result.warnings.some((item) => item.code === 'diagonal_on_non_header_cell'));
  assert.ok(result.blocking.some((item) => item.code === 'invalid_table_merge_span'));
});
