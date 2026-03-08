const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBacklinkEntries } = require('../services/senseArticleService');

test('buildBacklinkEntries aggregates counts and headings', () => {
  const rows = buildBacklinkEntries({
    targetNodeId: 'node_target',
    targetSenseId: 'sense_target',
    nodeMap: new Map([['node_source', '来源词条']]),
    senseMap: new Map([['node_source:sense_1', '来源释义']]),
    revisions: [{
      _id: 'rev_1',
      nodeId: 'node_source',
      senseId: 'sense_1',
      revisionNumber: 3,
      publishedAt: '2026-03-08T00:00:00.000Z',
      referenceIndex: [
        { targetNodeId: 'node_target', targetSenseId: 'sense_target', headingId: 'sec-a', position: 10 },
        { targetNodeId: 'node_target', targetSenseId: 'sense_target', headingId: 'sec-a', position: 20 },
        { targetNodeId: 'node_x', targetSenseId: 'sense_x', headingId: 'sec-b', position: 1 }
      ]
    }]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].referenceCount, 2);
  assert.deepEqual(rows[0].headings, ['sec-a']);
  assert.deepEqual(rows[0].positions, [10, 20]);
});
