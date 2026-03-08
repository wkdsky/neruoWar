const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLegacyArticleSeed,
  planLegacyBackfillOperation
} = require('../services/senseArticleMigrationService');

test('migration plan is idempotent for existing article and revision', () => {
  const first = planLegacyBackfillOperation({ article: null, currentRevision: null });
  const second = planLegacyBackfillOperation({ article: { _id: 'article_1' }, currentRevision: null });
  const third = planLegacyBackfillOperation({ article: { _id: 'article_1' }, currentRevision: { _id: 'rev_1' } });

  assert.equal(first.mode, 'create_article_and_revision');
  assert.equal(second.mode, 'create_missing_revision');
  assert.equal(third.mode, 'skip_existing_article');
  assert.equal(third.shouldCreateRevision, false);
});

test('legacy backfill seed still builds published revision snapshot', () => {
  const seed = buildLegacyArticleSeed({
    nodeId: '507f191e810c19729de860ea',
    senseId: 'sense_1',
    articleId: '507f191e810c19729de860eb',
    editorSource: '# 标题\n旧正文',
    proposerId: 'user_1'
  });

  assert.equal(seed.article.articleKey, '507f191e810c19729de860ea:sense_1');
  assert.equal(seed.revision.status, 'published');
  assert.equal(seed.revision.revisionNumber, 1);
  assert.match(seed.revision.plainTextSnapshot, /旧正文/);
});
