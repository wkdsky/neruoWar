const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSenseArticleSource } = require('../services/senseArticleParser');
const { buildArticleSearchResult } = require('../services/senseArticleService');

test('article search returns grouped stable result shape', () => {
  const revision = parseSenseArticleSource('# 总论\n这是测试词。测试词再次出现。\n\n## 第二节\n另一个测试词');
  const result = buildArticleSearchResult({ revision, query: '测试词' });

  assert.equal(result.total, 3);
  assert.ok(Array.isArray(result.matches));
  assert.ok(Array.isArray(result.groups));
  assert.ok(result.matches.every((item) => typeof item.headingTitle === 'string'));
  assert.ok(result.groups.some((group) => group.headingTitle === '总论'));
});
