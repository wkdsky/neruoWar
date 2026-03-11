const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStructuredDiff } = require('../services/senseArticleDiffService');
const {
  CONTENT_FORMATS,
  materializeRichHtmlContent,
  materializeRevisionContent,
  sanitizeRichHtml
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

test('sanitize preserves controlled table attrs and strips unsafe table attrs', () => {
  const sanitized = sanitizeRichHtml([
    '<table class="sense-rich-table table-style-three-line table-border-three-line table-border-inner-horizontal unsafe-class" style="width: 72%; position: fixed" data-table-style="three-line" data-table-width-mode="custom" data-table-width-value="72" data-table-border-preset="inner-horizontal" data-column-widths="160,220">',
    '<tbody><tr>',
    '<th rowspan="2" colspan="2" style="text-align:center;vertical-align:middle;background-color:#fef3c7;color:#0f172a;border-top: 2px solid #0f172a" data-align="center" data-vertical-align="middle" data-background-color="#fef3c7" data-text-color="#0f172a" data-border-edges="top,left" data-border-width="2" data-border-color="#0f172a" data-diagonal="tl-br" data-colwidth="160">标题</th>',
    '</tr></tbody></table>'
  ].join(''));

  assert.match(sanitized, /data-table-style="three-line"/);
  assert.match(sanitized, /data-table-width-mode="custom"/);
  assert.match(sanitized, /data-table-border-preset="inner-horizontal"/);
  assert.match(sanitized, /data-column-widths="160,220"/);
  assert.match(sanitized, /table-border-inner-horizontal/);
  assert.match(sanitized, /data-colwidth="160"/);
  assert.match(sanitized, /rowspan="2"/);
  assert.match(sanitized, /colspan="2"/);
  assert.match(sanitized, /width:\s*72%/);
  assert.doesNotMatch(sanitized, /position:\s*fixed/);
  assert.doesNotMatch(sanitized, /unsafe-class/);
});

test('materialize extracts rich table meta for widths, diagonal and merged cells', () => {
  const materialized = materializeRichHtmlContent([
    '<table class="sense-rich-table table-style-three-line table-border-three-line" data-table-style="three-line" data-table-width-mode="custom" data-table-width-value="72" data-table-border-preset="three-line" data-column-widths="140,220">',
    '<tbody>',
    '<tr><th rowspan="2" colspan="2" data-diagonal="tl-br" data-colwidth="140">表头</th><th data-colwidth="220">数值</th></tr>',
    '<tr><td>内容</td></tr>',
    '</tbody></table>'
  ].join(''));

  const tableBlock = materialized.ast.blocks.find((block) => block.type === 'table');
  assert.ok(tableBlock);
  assert.equal(tableBlock.tableStyle, 'three-line');
  assert.equal(tableBlock.tableWidthMode, 'custom');
  assert.equal(tableBlock.tableWidthValue, '72');
  assert.equal(tableBlock.tableBorderPreset, 'three-line');
  assert.deepEqual(tableBlock.columnWidths, [140, 220]);
  assert.equal(tableBlock.diagonalCellCount, 1);
  assert.equal(tableBlock.mergeSummary.hasMergedCells, true);
  assert.equal(tableBlock.mergeSummary.mergedCellCount, 1);
  assert.equal(tableBlock.mergeSummary.areaPreview, 'R1-2 / C1-2');
  assert.equal(tableBlock.rows[0].cells[0].rowspan, 2);
  assert.equal(tableBlock.rows[0].cells[0].colspan, 2);
});

test('structured diff detects table width, column width, border, diagonal and merge changes', () => {
  const fromRevision = makeRichRevision(
    'rev_table_from',
    '<table class="sense-rich-table table-style-default table-border-all" data-table-style="default" data-table-width-mode="medium" data-table-width-value="72" data-table-border-preset="all" data-column-widths="120,180"><tbody><tr><th data-colwidth="120">项目</th><th data-colwidth="180">值</th></tr><tr><td>A</td><td>B</td></tr></tbody></table>'
  );
  const toRevision = makeRichRevision(
    'rev_table_to',
    '<table class="sense-rich-table table-style-three-line table-border-three-line" data-table-style="three-line" data-table-width-mode="custom" data-table-width-value="88" data-table-border-preset="three-line" data-column-widths="160,240"><tbody><tr><th rowspan="2" colspan="2" data-diagonal="tl-br" data-colwidth="160">项目</th></tr><tr></tr><tr><td>A</td><td>B</td></tr></tbody></table>'
  );

  const diff = buildStructuredDiff({ fromRevision, toRevision });
  const tableChange = diff.sections.flatMap((section) => section.blockDiff?.changes || []).find((item) => item.blockKind === 'table' && item.status === 'modified');
  assert.ok(tableChange);
  assert.notEqual(tableChange.details.fromMeta.tableStyle, tableChange.details.toMeta.tableStyle);
  assert.notEqual(tableChange.details.fromMeta.tableWidthValue, tableChange.details.toMeta.tableWidthValue);
  assert.notEqual(tableChange.details.fromMeta.columnWidths, tableChange.details.toMeta.columnWidths);
  assert.notEqual(tableChange.details.fromMeta.tableBorderPreset, tableChange.details.toMeta.tableBorderPreset);
  assert.notEqual(tableChange.details.fromMeta.diagonalCellCount, tableChange.details.toMeta.diagonalCellCount);
  assert.notEqual(tableChange.details.fromMeta.mergedCellCount, tableChange.details.toMeta.mergedCellCount);
  assert.notEqual(tableChange.details.fromMeta.mergedAreaPreview, tableChange.details.toMeta.mergedAreaPreview);
});

test('old rich html tables still materialize with default table meta', () => {
  const materialized = materializeRichHtmlContent('<table class="sense-rich-table table-style-default" data-table-style="default"><tbody><tr><td>旧表</td></tr></tbody></table>');
  const tableBlock = materialized.ast.blocks.find((block) => block.type === 'table');
  assert.ok(tableBlock);
  assert.equal(tableBlock.tableStyle, 'default');
  assert.equal(tableBlock.tableWidthMode, 'auto');
  assert.equal(tableBlock.tableBorderPreset, 'all');
});
