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
