const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStructuredDiff } = require('../services/senseArticleDiffService');
const {
  CONTENT_FORMATS,
  materializeRichHtmlContent,
  materializeRevisionContent
} = require('../services/senseArticleRichContentService');

const makeRichRevision = (id, html) => ({
  _id: id,
  ...materializeRevisionContent({
    editorSource: html,
    contentFormat: CONTENT_FORMATS.RICH_HTML
  })
});

test('rich html empty document normalizes to semantic empty payload', () => {
  const materialized = materializeRichHtmlContent('<p></p><p> </p>');

  assert.equal(materialized.contentFormat, CONTENT_FORMATS.RICH_HTML);
  assert.equal(materialized.editorSource, '');
  assert.equal(materialized.plainTextSnapshot, '');
  assert.equal(materialized.ast.blocks.length, 0);
});

test('structured diff detects rich html heading level, table and media changes', () => {
  const fromRevision = makeRichRevision(
    'rev_from',
    [
      '<h2>战术部署</h2>',
      '<p>旧段落说明。</p>',
      '<table class="sense-rich-table table-style-default" data-table-style="default"><tbody><tr><td>旧数据</td></tr></tbody></table>'
    ].join('')
  );
  const toRevision = makeRichRevision(
    'rev_to',
    [
      '<h3>战术部署</h3>',
      '<p>新段落说明，补充了更多细节。</p>',
      '<table class="sense-rich-table table-style-zebra" data-table-style="zebra"><tbody><tr><td>新数据</td></tr></tbody></table>',
      '<figure data-node-type="image" class="sense-rich-figure align-center size-75" data-align="center" data-width="75%">',
      '<img src="/uploads/sense-article-media/example.png" alt="示意图" width="75%" />',
      '<figcaption class="sense-rich-caption">战术示意图</figcaption>',
      '</figure>'
    ].join('')
  );

  const diff = buildStructuredDiff({ fromRevision, toRevision });
  const section = diff.sections.find((item) => item.headingTitle === '战术部署');

  assert.ok(section);
  assert.ok(section.changeTypes.includes('section_modified'));
  assert.ok(section.changeTypes.includes('heading_level_changed'));
  assert.ok(section.changeTypes.includes('tables_changed'));
  assert.ok(section.changeTypes.includes('media_changed'));
  assert.equal(section.blockDiff.summary.tableChanged, 1);
  assert.equal(section.blockDiff.summary.mediaChanged, 1);
  assert.ok(section.blockDiff.changes.some((item) => item.blockKind === 'media' && item.status === 'added'));
  assert.equal(diff.summary.headingLevelChanged, 1);
  assert.equal(diff.summary.tableChanged, 1);
  assert.equal(diff.summary.mediaChanged, 1);
});
