const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSenseArticleSource } = require('../services/senseArticleParser');
const { relocateAnchor } = require('../services/senseArticleAnchorService');

const makeRevision = (id, source) => ({ _id: id, ...parseSenseArticleSource(source) });

test('anchor relocates after paragraph insertion via block hash / heading context', () => {
  const base = makeRevision('rev1', '# 总论\n第一段\n\n第二段目标文本');
  const targetBlock = base.ast.blocks.find((block) => block.plainText.includes('第二段目标文本'));
  const relocation = relocateAnchor({
    anchor: {
      revisionId: 'rev1',
      headingId: '总论',
      blockId: targetBlock.id,
      blockHash: targetBlock.blockHash,
      selectionText: '目标文本',
      textQuote: '目标文本',
      prefixText: '第二段',
      suffixText: ''
    },
    currentRevision: makeRevision('rev2', '# 总论\n新增段落\n\n第一段\n\n第二段目标文本')
  });

  assert.equal(relocation.status, 'relocated');
  assert.equal(relocation.anchor.selectionText, '目标文本');
});

test('anchor relocates after text offset changes under same heading', () => {
  const base = makeRevision('rev1', '# 术语\n这里是关键定义。');
  const block = base.ast.blocks.find((item) => item.type === 'paragraph');
  const relocation = relocateAnchor({
    anchor: {
      revisionId: 'rev1',
      headingId: '术语',
      blockId: block.id,
      selectionText: '关键定义',
      textQuote: '关键定义',
      prefixText: '这里是',
      suffixText: '。'
    },
    currentRevision: makeRevision('rev2', '# 术语\n这里是经过扩展的关键定义。')
  });

  assert.equal(relocation.status, 'relocated');
});

test('anchor falls back to uncertain or broken when text is rewritten', () => {
  const base = makeRevision('rev1', '# 术语\n这里是关键定义。');
  const block = base.ast.blocks.find((item) => item.type === 'paragraph');
  const relocation = relocateAnchor({
    anchor: {
      revisionId: 'rev1',
      headingId: '术语',
      blockId: block.id,
      selectionText: '关键定义',
      textQuote: '关键定义',
      prefixText: '这里是',
      suffixText: '。'
    },
    currentRevision: makeRevision('rev2', '# 术语\n这里内容已经完全重写。')
  });

  assert.ok(['uncertain', 'broken'].includes(relocation.status));
});
