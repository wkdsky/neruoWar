const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSenseArticleSource } = require('../services/senseArticleParser');
const { buildStructuredDiff } = require('../services/senseArticleDiffService');

const makeRevision = (id, source) => ({ _id: id, ...parseSenseArticleSource(source) });

test('structured diff detects added and removed headings', () => {
  const fromRevision = makeRevision('rev_from', '# A\n内容\n\n# B\n旧段落');
  const toRevision = makeRevision('rev_to', '# A\n内容\n\n# C\n全新段落\n\n# D\n新增段落');
  const diff = buildStructuredDiff({ fromRevision, toRevision });

  assert.ok(diff.sections.some((item) => item.changeTypes.includes('heading_removed')));
  assert.ok(diff.sections.some((item) => item.changeTypes.includes('heading_added')));
});

test('structured diff detects heading title changes', () => {
  const fromRevision = makeRevision('rev_from', '# 旧标题\n相同正文');
  const toRevision = makeRevision('rev_to', '# 新标题\n相同正文');
  const diff = buildStructuredDiff({ fromRevision, toRevision });

  assert.ok(diff.sections.some((item) => item.changeTypes.includes('heading_renamed')));
});

test('structured diff detects section content and formula changes', () => {
  const fromRevision = makeRevision('rev_from', '# A\n正文一\n\n$$\na+b\n$$');
  const toRevision = makeRevision('rev_to', '# A\n正文二\n\n$$\na+b+c\n$$');
  const diff = buildStructuredDiff({ fromRevision, toRevision });
  const targetSection = diff.sections.find((item) => item.headingTitle === 'A');

  assert.ok(targetSection.changeTypes.includes('section_modified'));
  assert.ok(targetSection.changeTypes.includes('formulas_changed'));
});

test('structured diff detects reference changes', () => {
  const fromRevision = makeRevision('rev_from', '# A\n[[sense:node1:sense_1|旧引用]]');
  const toRevision = makeRevision('rev_to', '# A\n[[sense:node1:sense_1|新引用]]\n[[sense:node2:sense_2|新增引用]]');
  const diff = buildStructuredDiff({ fromRevision, toRevision });
  const targetSection = diff.sections.find((item) => item.headingTitle === 'A');

  assert.ok(targetSection.changeTypes.includes('references_changed'));
  assert.equal(targetSection.referenceChanges.modified.length, 1);
  assert.equal(targetSection.referenceChanges.added.length, 1);
});
