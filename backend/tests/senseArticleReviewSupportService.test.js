const test = require('node:test');
const assert = require('node:assert/strict');

const { createSenseArticleReviewSupportService } = require('../services/senseArticle/reviewSupportService');

const makeObjectId = (value) => value.toString(16).padStart(24, '0');

const createReviewSupport = ({ users = [] } = {}) => createSenseArticleReviewSupportService({
  User: {
    find: ({ _id: { $in } }) => ({
      select: () => ({
        lean: async () => users.filter((item) => $in.includes(item._id))
      })
    })
  },
  ensurePermission: (allowed, message) => {
    if (!allowed) throw new Error(message);
  },
  getIdString: (value) => (value == null ? '' : String(value)),
  getSenseArticleReviewerEntries: (node) => node?.reviewers || []
});

test('ensureReviewParticipantsSnapshot 会合并 legacy reviewer 字段', () => {
  const service = createReviewSupport();

  const participants = service.ensureReviewParticipantsSnapshot({
    revision: {
      domainAdminReviewerId: makeObjectId(1),
      domainAdminDecision: 'approved',
      domainMasterReviewerId: makeObjectId(2),
      domainMasterDecision: 'rejected'
    },
    node: { reviewers: [] }
  });

  assert.deepEqual(participants, [
    { userId: makeObjectId(1), role: 'domain_admin' },
    { userId: makeObjectId(2), role: 'domain_master' }
  ]);
});

test('buildReviewPresentation 统计 byRole 并标记当前用户', async () => {
  const service = createReviewSupport({
    users: [
      { _id: makeObjectId(1), username: 'alice', avatar: 'a', profession: 'author' },
      { _id: makeObjectId(2), username: 'bob', avatar: 'b', profession: 'master' }
    ]
  });

  const presentation = await service.buildReviewPresentation({
    revision: {
      reviewParticipants: [
        { userId: makeObjectId(1), role: 'domain_admin' },
        { userId: makeObjectId(2), role: 'domain_master' }
      ],
      reviewVotes: [
        { userId: makeObjectId(1), role: 'domain_admin', decision: 'approved', comment: 'ok' }
      ]
    },
    currentUserId: makeObjectId(2)
  });

  assert.equal(presentation.summary.total, 2);
  assert.equal(presentation.summary.byRole.domain_admin.approvedCount, 1);
  assert.equal(presentation.summary.byRole.domain_master.pendingCount, 1);
  assert.equal(presentation.participants.find((item) => item.userId === makeObjectId(2)).isCurrentUser, true);
});

test('assertRevisionReadable 允许 proposer 查看未发布修订，但拒绝无关用户', () => {
  const service = createReviewSupport();
  const proposerId = makeObjectId(1);

  assert.doesNotThrow(() => service.assertRevisionReadable({
    revision: { proposerId, status: 'draft', reviewParticipants: [] },
    permissions: {},
    userId: proposerId
  }));

  assert.throws(() => service.assertRevisionReadable({
    revision: { proposerId, status: 'draft', reviewParticipants: [] },
    permissions: {},
    userId: makeObjectId(2)
  }), /仅发起人或审核者可查看未发布修订/);
});

test('resolveReviewerRoleForUser 优先 system_admin，然后回退到 participant role', () => {
  const service = createReviewSupport();

  const roleA = service.resolveReviewerRoleForUser({
    bundle: { permissions: { isSystemAdmin: true } },
    revision: {},
    userId: makeObjectId(1)
  });
  assert.equal(roleA, 'system_admin');

  const roleB = service.resolveReviewerRoleForUser({
    bundle: { permissions: { isDomainMaster: false, isDomainAdmin: false }, node: null },
    revision: {
      reviewParticipants: [{ userId: makeObjectId(2), role: 'domain_master' }]
    },
    userId: makeObjectId(2)
  });
  assert.equal(roleB, 'domain_master');
});
