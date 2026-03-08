const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSenseArticleNotificationPayload,
  validateNotificationPayloadShape
} = require('../services/senseArticleNotificationService');

test('notification payload schema is structured and validated', () => {
  const payload = buildSenseArticleNotificationPayload({
    type: 'sense_article_revision_superseded',
    node: { _id: '507f191e810c19729de860ea', name: '节点A' },
    article: { _id: '507f191e810c19729de860eb', senseId: 'sense_1' },
    revision: { _id: '507f191e810c19729de860ec', senseId: 'sense_1', reviewStage: 'completed', proposerId: 'user_a' },
    stage: 'completed',
    action: 'superseded',
    actorId: 'user_reviewer',
    extra: { publishedRevisionId: '507f191e810c19729de860ed' }
  });

  assert.equal(payload.nodeId, '507f191e810c19729de860ea');
  assert.equal(payload.articleId, '507f191e810c19729de860eb');
  assert.equal(payload.revisionId, '507f191e810c19729de860ec');
  assert.equal(validateNotificationPayloadShape({ type: 'sense_article_revision_superseded', payload }), true);
});

test('notification payload validation fails for missing required keys', () => {
  assert.equal(validateNotificationPayloadShape({
    type: 'sense_article_referenced',
    payload: { schemaVersion: 1, nodeId: 'a', senseId: 'sense_1' }
  }), false);
});
