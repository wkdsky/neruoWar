const test = require('node:test');
const assert = require('node:assert/strict');

const { createSenseArticleSupportService } = require('../services/senseArticle/supportService');

const makeObjectId = (value) => value.toString(16).padStart(24, '0');

const createSupportHarness = ({
  users = [],
  revisions = [],
  nodeDoc = null
} = {}) => {
  const Node = {
    findById: () => ({
      select: () => ({
        lean: async () => nodeDoc
      })
    })
  };

  const User = {
    find: ({ _id: { $in } }) => ({
      select: () => ({
        lean: async () => users.filter((item) => $in.includes(item._id))
      })
    })
  };

  const SenseArticleRevision = {
    find: (query) => ({
      sort: () => ({
        limit: (limit) => ({
          lean: async () => revisions
            .filter((item) => (
              String(item.articleId) === String(query.articleId)
              && String(item.proposerId) === String(query.proposerId)
              && query.status.$in.includes(item.status)
            ))
            .slice(0, limit)
        })
      })
    })
  };

  const service = createSenseArticleSupportService({
    DRAFT_EDITABLE_STATUSES: ['draft', 'changes_requested'],
    Node,
    SenseArticleRevision,
    User,
    buildStructuredDiff: ({ fromRevision, toRevision }) => ({
      summary: {
        changedBlocks: String(fromRevision?.editorSource || '') === String(toRevision?.editorSource || '') ? 0 : 1
      },
      sections: [{ hasChanges: String(fromRevision?.editorSource || '') !== String(toRevision?.editorSource || '') }]
    }),
    createExposeError: (message, statusCode = 400, code = '') => {
      const error = new Error(message);
      error.statusCode = statusCode;
      error.code = code;
      return error;
    },
    ensurePermission: (allowed, message, statusCode = 403, code = 'forbidden') => {
      if (!allowed) {
        const error = new Error(message);
        error.statusCode = statusCode;
        error.code = code;
        throw error;
      }
    },
    getIdString: (value) => (value == null ? '' : String(value)),
    hydrateNodeSensesForNodes: async () => {},
    serializeRevisionSummary: (item) => ({
      _id: item._id,
      revisionTitle: item.revisionTitle,
      proposedSenseTitle: item.proposedSenseTitle,
      proposerUsername: item.proposerUsername,
      status: item.status
    }),
    serializeSearchGroup: (item) => item,
    serializeSearchMatch: (item) => item,
    serializeStructuredDiff: (item) => item,
    toObjectIdOrNull: (value) => value || null
  });

  return service;
};

test('decorateRevisionRecords 补齐 proposerUsername、revisionTitle 和 fallback sense title', async () => {
  const support = createSupportHarness({
    users: [
      { _id: makeObjectId(1), username: 'alice' }
    ]
  });

  const rows = await support.decorateRevisionRecords({
    revisions: [{
      _id: makeObjectId(100),
      proposerId: makeObjectId(1),
      revisionTitle: '',
      proposedSenseTitle: ''
    }],
    fallbackSenseTitle: '默认释义'
  });

  assert.equal(rows[0].proposerUsername, 'alice');
  assert.match(rows[0].revisionTitle, /alice/);
  assert.equal(rows[0].proposedSenseTitle, '默认释义');
});

test('loadMyVisibleRevisionSummaries 只返回允许状态的我的修订', async () => {
  const aliceId = makeObjectId(1);
  const support = createSupportHarness({
    users: [{ _id: aliceId, username: 'alice' }],
    revisions: [
      { _id: 'r1', articleId: 'a1', proposerId: aliceId, revisionTitle: '', proposedSenseTitle: '', status: 'draft' },
      { _id: 'r2', articleId: 'a1', proposerId: aliceId, revisionTitle: '', proposedSenseTitle: '', status: 'pending_review' },
      { _id: 'r3', articleId: 'a1', proposerId: aliceId, revisionTitle: '', proposedSenseTitle: '', status: 'published' }
    ]
  });

  const rows = await support.loadMyVisibleRevisionSummaries({
    articleId: 'a1',
    proposerId: aliceId,
    fallbackSenseTitle: '释义A'
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((item) => item.status), ['draft', 'pending_review']);
});

test('resolveProposedSenseTitle 会阻止同知识域内重名', async () => {
  const support = createSupportHarness({
    nodeDoc: {
      _id: makeObjectId(10),
      description: 'desc',
      synonymSenses: [
        { senseId: 's1', title: '原名' },
        { senseId: 's2', title: '重复标题' }
      ]
    }
  });

  await assert.rejects(() => support.resolveProposedSenseTitle({
    bundle: {
      nodeId: makeObjectId(10),
      nodeSense: { title: '原名' }
    },
    senseId: 's1',
    proposedSenseTitle: '重复标题',
    allowChange: true
  }), /重名/);
});

test('buildArticleSearchResult 会按 heading 分组并返回匹配', () => {
  const support = createSupportHarness();

  const result = support.buildArticleSearchResult({
    revision: {
      headingIndex: [{ headingId: 'h1', title: '第一节' }],
      ast: {
        blocks: [
          { id: 'b1', headingId: 'h1', plainText: '这里有量子纠缠和量子态。', blockHash: 'x1' }
        ]
      }
    },
    query: '量子'
  });

  assert.equal(result.total, 2);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].headingTitle, '第一节');
});

test('revisionHasMeaningfulSubmissionChanges 在仅改释义标题时也返回 true', () => {
  const support = createSupportHarness();

  const changed = support.revisionHasMeaningfulSubmissionChanges({
    revision: {
      proposedSenseTitle: '新标题',
      diffFromBase: { summary: { changedBlocks: 0 }, sections: [{ hasChanges: false }] }
    },
    currentSenseTitle: '旧标题'
  });

  assert.equal(changed, true);
});
