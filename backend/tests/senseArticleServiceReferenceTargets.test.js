const test = require('node:test');
const assert = require('node:assert/strict');

const Node = require('../models/Node');
const NodeSense = require('../models/NodeSense');
const SenseArticle = require('../models/SenseArticle');
const { resolveReferenceTargets } = require('../services/senseArticleService');

const createLeanQuery = (rows) => ({
  select() {
    return this;
  },
  lean: async () => rows
});

test('resolveReferenceTargets uses queried nodes and returns node names', async () => {
  const originals = {
    nodeFind: Node.find,
    nodeSenseFind: NodeSense.find,
    articleFind: SenseArticle.find
  };

  const nodeId = '507f1f77bcf86cd799439011';

  Node.find = () => createLeanQuery([
    { _id: nodeId, name: '测试词条' }
  ]);
  NodeSense.find = () => createLeanQuery([
    { nodeId, senseId: 'sense_1', title: '测试释义' }
  ]);
  SenseArticle.find = () => createLeanQuery([
    { _id: 'rev_article_1', nodeId, senseId: 'sense_1', currentRevisionId: 'rev_current_1' }
  ]);

  try {
    const results = await resolveReferenceTargets([
      { targetNodeId: nodeId, targetSenseId: 'sense_1', referenceId: 'ref_1' }
    ]);

    assert.equal(results.length, 1);
    assert.equal(results[0].isValid, true);
    assert.equal(results[0].targetNodeName, '测试词条');
    assert.equal(results[0].targetTitle, '测试释义');
    assert.equal(results[0].targetArticleId, 'rev_article_1');
    assert.equal(results[0].targetCurrentRevisionId, 'rev_current_1');
  } finally {
    Node.find = originals.nodeFind;
    NodeSense.find = originals.nodeSenseFind;
    SenseArticle.find = originals.articleFind;
  }
});
