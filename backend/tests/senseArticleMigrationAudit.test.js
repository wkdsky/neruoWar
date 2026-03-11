const test = require('node:test');
const assert = require('node:assert/strict');
const { auditLegacyConversionCandidate } = require('../services/senseArticleMigrationService');

test('legacy migration audit reports successful structured conversion', () => {
  const result = auditLegacyConversionCandidate({
    editorSource: '# 标题\n\n[[sense:node_1:sense_1|内部引用]]\n\n- 列表项'
  });

  assert.equal(result.success, true);
  assert.ok(result.richHtmlLength > 0);
  assert.ok(result.richBlockCount > 0);
});
