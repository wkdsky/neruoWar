const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSenseArticleSource } = require('../services/senseArticleParser');

test('parser builds stable ast contract for mixed content', () => {
  const source = `# 总论\n这里有 *强调*、**加粗**、\`inline\` 与 [[sense:507f191e810c19729de860ea:sense_2|引用词条]]。\n\n## 公式\n$E=mc^2$ 与 :alpha:\n\n- 列表一\n- 列表二\n\n> 引用块`; 
  const parsed = parseSenseArticleSource(source);

  assert.equal(parsed.ast.type, 'document');
  assert.equal(parsed.headingIndex.length, 2);
  assert.equal(parsed.headingIndex[0].headingId, '总论');
  assert.equal(parsed.referenceIndex.length, 1);
  assert.equal(parsed.referenceIndex[0].targetSenseId, 'sense_2');
  assert.equal(parsed.formulaRefs.length, 1);
  assert.equal(parsed.symbolRefs.length, 1);
  assert.match(parsed.plainTextSnapshot, /引用词条/);
  assert.ok(parsed.ast.blocks.every((block) => block.id && block.blockHash));
});

test('parser records invalid reference syntax and duplicate headings stably', () => {
  const source = `# 小节\n[[broken-reference]]\n\n# 小节\n正文`;
  const parsed = parseSenseArticleSource(source);

  assert.equal(parsed.headingIndex[0].headingId, '小节');
  assert.equal(parsed.headingIndex[1].headingId, '小节-2');
  assert.ok(parsed.parseErrors.some((item) => item.code === 'invalid_reference_syntax'));
});

test('parser handles empty and large documents', () => {
  const empty = parseSenseArticleSource('');
  assert.equal(empty.ast.blocks.length, 0);
  assert.equal(empty.plainTextSnapshot, '');

  const bigSource = Array.from({ length: 120 }, (_, index) => `## 段 ${index + 1}\n正文 ${index + 1}`).join('\n\n');
  const big = parseSenseArticleSource(bigSource);
  assert.equal(big.headingIndex.length, 120);
  assert.ok(big.plainTextSnapshot.includes('正文 120'));
});

test('parser preserves unclosed markers as structured parse errors', () => {
  const parsed = parseSenseArticleSource('# 标题\n这里有 [[sense:1 和 *未闭合强调');
  assert.ok(parsed.parseErrors.some((item) => item.code === 'unclosed_reference'));
});
