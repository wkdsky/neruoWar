const test = require('node:test');
const assert = require('node:assert/strict');

const { createSenseArticleWorkflowService } = require('../services/senseArticle/workflowService');

const makeObjectId = (value) => value.toString(16).padStart(24, '0');

const createExposeError = (message, statusCode = 400, code = '', details = null) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
};

const buildFindByIdChain = (value) => ({
  select: () => ({
    lean: async () => value
  }),
  lean: async () => value
});

const ensurePermissionOrThrow = (allowed, message, statusCode = 403, code = 'forbidden') => {
  if (!allowed) throw createExposeError(message, statusCode, code);
};

test('submitRevision 在没有实质变化时拒绝提交', async () => {
  const revision = {
    _id: makeObjectId(100),
    articleId: makeObjectId(10),
    proposerId: makeObjectId(1),
    revisionTitle: 'title',
    proposedSenseTitle: '旧标题',
    mediaReferences: [],
    validationSnapshot: null,
    diffFromBase: null,
    sourceMode: 'full',
    targetHeadingId: '',
    selectedRangeAnchor: null
  };

  const service = createSenseArticleWorkflowService({
    ACTIVE_SUPERSEDE_STATUSES: ['pending_review'],
    SenseArticle: {},
    SenseArticleRevision: {
      findOne: async () => revision
    },
    User: {
      findById: () => buildFindByIdChain({ _id: makeObjectId(1), username: 'alice' })
    },
    applyPublishedSenseTitle: async () => {},
    assertRevisionValidationBeforeWorkflow: () => {},
    buildReviewParticipantsFromNode: () => [],
    buildReviewPresentation: async () => ({ summary: { byRole: {} } }),
    buildRevisionMutationResponse: () => ({ shouldNotReach: true }),
    buildSummary: () => '',
    canUserUpdateSenseMetadata: () => false,
    createExposeError,
    detectContentFormat: () => 'rich_html',
    ensurePermission: (allowed, message, statusCode = 403, code = 'forbidden') => {
      if (!allowed) throw createExposeError(message, statusCode, code);
    },
    ensureReviewParticipantsSnapshot: () => [],
    ensureReviewVotesSnapshot: () => [],
    ensureRevisionDerivedState: async () => revision,
    getArticleBundle: async () => ({
      article: { _id: makeObjectId(10) },
      nodeSense: { title: '旧标题' },
      permissions: { isSystemAdmin: false },
      node: {},
      nodeId: makeObjectId(10),
      senseId: 's1'
    }),
    getIdString: (value) => (value == null ? '' : String(value)),
    isPendingReviewStatus: () => true,
    notifyDomainMasterDecision: async () => {},
    notifyReferencedDomains: async () => {},
    notifyRevisionSubmitted: async () => {},
    notifySupersededRevisions: async () => {},
    reasonToMessage: (reason) => reason,
    resolveProposedSenseTitle: async () => '旧标题',
    resolveReviewerRoleForUser: () => '',
    resolveRevisionTitleInput: ({ revisionTitle }) => revisionTitle,
    resolveSubmitOperation: () => ({ kind: 'noop' }),
    revisionHasMeaningfulSubmissionChanges: () => false,
    selectSupersedeCandidates: () => [],
    serializeArticleSummary: (value) => value,
    serializePermissions: (value) => value,
    serializeRevisionDetail: (value) => value,
    syncLegacySenseMirror: async () => {},
    refreshArticleMediaReferenceState: async () => {},
    validateRevisionContent: () => ({})
  });

  await assert.rejects(() => service.submitRevision({
    nodeId: makeObjectId(10),
    senseId: 's1',
    revisionId: revision._id,
    userId: makeObjectId(1)
  }), (error) => {
    assert.equal(error.code, 'unchanged_revision');
    assert.equal(error.statusCode, 409);
    return true;
  });
});

test('reviewByDomainAdmin 在 reject 时写入 rejected 并发送通知', async () => {
  const articleId = makeObjectId(10);
  const revisionId = makeObjectId(100);
  const userId = makeObjectId(2);
  const notifyCalls = [];

  const revisionDoc = {
    _id: revisionId,
    articleId,
    proposerId: makeObjectId(1),
    status: 'pending_review',
    __v: 1,
    toObject() {
      return {
        _id: revisionId,
        articleId,
        proposerId: makeObjectId(1),
        status: 'pending_review',
        reviewParticipants: [{ userId, role: 'domain_admin' }],
        reviewVotes: []
      };
    }
  };

  const service = createSenseArticleWorkflowService({
    ACTIVE_SUPERSEDE_STATUSES: ['pending_review'],
    SenseArticle: {},
    SenseArticleRevision: {
      findOne: async () => revisionDoc,
      findOneAndUpdate: async (_filter, update) => ({
        _id: revisionId,
        articleId,
        status: update.$set.status,
        reviewVotes: update.$set.reviewVotes,
        finalDecision: update.$set.finalDecision
      })
    },
    User: {},
    applyPublishedSenseTitle: async () => {},
    assertRevisionValidationBeforeWorkflow: () => {},
    buildReviewParticipantsFromNode: () => [],
    buildReviewPresentation: async () => ({
      summary: {
        byRole: {
          domain_admin: { total: 1, approvedCount: 0, pendingCount: 0, allApproved: false },
          domain_master: { total: 0, approvedCount: 0, pendingCount: 0, allApproved: false }
        }
      }
    }),
    buildRevisionMutationResponse: (value) => value,
    buildSummary: () => '',
    canUserUpdateSenseMetadata: () => false,
    createExposeError,
    detectContentFormat: () => 'rich_html',
    ensurePermission: (allowed, message, statusCode = 403, code = 'forbidden') => {
      if (!allowed) throw createExposeError(message, statusCode, code);
    },
    ensureReviewParticipantsSnapshot: () => [{ userId, role: 'domain_admin' }],
    ensureReviewVotesSnapshot: () => [],
    ensureRevisionDerivedState: async (value) => value,
    getArticleBundle: async () => ({
      article: { _id: articleId },
      node: {},
      permissions: {
        isSystemAdmin: false,
        canReviewDomainAdmin: true,
        canReviewDomainMaster: false
      }
    }),
    getIdString: (value) => (value == null ? '' : String(value)),
    isPendingReviewStatus: (status) => status === 'pending_review',
    notifyDomainMasterDecision: async (payload) => {
      notifyCalls.push(payload);
    },
    notifyReferencedDomains: async () => {},
    notifyRevisionSubmitted: async () => {},
    notifySupersededRevisions: async () => {},
    reasonToMessage: (reason) => reason,
    resolveProposedSenseTitle: async () => '',
    resolveReviewerRoleForUser: () => 'domain_admin',
    resolveRevisionTitleInput: ({ revisionTitle }) => revisionTitle,
    resolveSubmitOperation: () => ({ kind: 'noop' }),
    revisionHasMeaningfulSubmissionChanges: () => true,
    selectSupersedeCandidates: () => [],
    serializeArticleSummary: (value) => value,
    serializePermissions: (value) => value,
    serializeRevisionDetail: (value) => value,
    syncLegacySenseMirror: async () => {},
    refreshArticleMediaReferenceState: async () => {},
    validateRevisionContent: () => ({})
  });

  const result = await service.reviewByDomainAdmin({
    nodeId: makeObjectId(10),
    senseId: 's1',
    revisionId,
    userId,
    action: 'reject',
    comment: '需要重写'
  });

  assert.equal(result.revision.status, 'rejected');
  assert.equal(result.revision.finalDecision, 'rejected');
  assert.equal(result.revision.reviewVotes.length, 1);
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].action, 'rejected');
});

test('reviewByDomainAdmin 在百科审阅完成后进入域主终审阶段', async () => {
  const articleId = makeObjectId(10);
  const revisionId = makeObjectId(101);
  const userId = makeObjectId(2);
  const domainMasterUserId = makeObjectId(3);

  const revisionDoc = {
    _id: revisionId,
    articleId,
    proposerId: makeObjectId(1),
    status: 'pending_review',
    __v: 1,
    toObject() {
      return {
        _id: revisionId,
        articleId,
        proposerId: makeObjectId(1),
        status: 'pending_review',
        reviewParticipants: [
          { userId, role: 'domain_admin' },
          { userId: domainMasterUserId, role: 'domain_master' }
        ],
        reviewVotes: []
      };
    }
  };

  const service = createSenseArticleWorkflowService({
    ACTIVE_SUPERSEDE_STATUSES: ['pending_review', 'pending_domain_admin_review', 'pending_domain_master_review'],
    SenseArticle: {},
    SenseArticleRevision: {
      findOne: async () => revisionDoc,
      findOneAndUpdate: async (_filter, update) => ({
        _id: revisionId,
        articleId,
        status: update.$set.status,
        reviewStage: update.$set.reviewStage,
        reviewVotes: update.$set.reviewVotes
      })
    },
    User: {},
    applyPublishedSenseTitle: async () => {
      throw new Error('should not publish directly');
    },
    assertRevisionValidationBeforeWorkflow: () => {},
    buildReviewParticipantsFromNode: () => [],
    buildReviewPresentation: async () => ({
      summary: {
        byRole: {
          domain_admin: { total: 1, approvedCount: 1, pendingCount: 0, allApproved: true },
          domain_master: { total: 1, approvedCount: 0, pendingCount: 1, allApproved: false }
        }
      }
    }),
    buildRevisionMutationResponse: (value) => value,
    buildSummary: () => '',
    canUserUpdateSenseMetadata: () => false,
    createExposeError,
    detectContentFormat: () => 'rich_html',
    ensurePermission: ensurePermissionOrThrow,
    ensureReviewParticipantsSnapshot: () => [
      { userId, role: 'domain_admin' },
      { userId: domainMasterUserId, role: 'domain_master' }
    ],
    ensureReviewVotesSnapshot: () => [],
    ensureRevisionDerivedState: async (value) => value,
    getArticleBundle: async () => ({
      article: { _id: articleId },
      node: {},
      permissions: {
        isSystemAdmin: false,
        canReviewDomainAdmin: true,
        canReviewDomainMaster: false
      }
    }),
    getIdString: (value) => (value == null ? '' : String(value)),
    isPendingReviewStatus: (status) => ['pending_review', 'pending_domain_admin_review', 'pending_domain_master_review'].includes(status),
    notifyDomainMasterDecision: async () => {
      throw new Error('should not notify final decision before publish');
    },
    notifyReferencedDomains: async () => {},
    notifyRevisionSubmitted: async () => {},
    notifySupersededRevisions: async () => {},
    reasonToMessage: (reason) => reason,
    resolveProposedSenseTitle: async () => '',
    resolveReviewerRoleForUser: () => 'domain_admin',
    resolveRevisionTitleInput: ({ revisionTitle }) => revisionTitle,
    resolveSubmitOperation: () => ({ kind: 'noop' }),
    revisionHasMeaningfulSubmissionChanges: () => true,
    selectSupersedeCandidates: () => [],
    serializeArticleSummary: (value) => value,
    serializePermissions: (value) => value,
    serializeRevisionDetail: (value) => value,
    syncLegacySenseMirror: async () => {},
    refreshArticleMediaReferenceState: async () => {},
    validateRevisionContent: () => ({})
  });

  const result = await service.reviewByDomainAdmin({
    nodeId: makeObjectId(10),
    senseId: 's1',
    revisionId,
    userId,
    action: 'approve',
    comment: '百科审阅通过'
  });

  assert.equal(result.revision.status, 'pending_domain_master_review');
  assert.equal(result.revision.reviewStage, 'domain_master');
  assert.equal(result.revision.reviewVotes.length, 1);
  assert.equal(result.revision.reviewVotes[0].role, 'domain_admin');
});

test('reviewByDomainMaster 在终审通过后发布修订并触发后续同步', async () => {
  const articleId = makeObjectId(10);
  const baseRevisionId = makeObjectId(99);
  const revisionId = makeObjectId(102);
  const userId = makeObjectId(3);
  const calls = {
    applyPublishedSenseTitle: [],
    assertRevisionValidationBeforeWorkflow: [],
    articleUpdates: [],
    notifyDomainMasterDecision: [],
    notifyReferencedDomains: [],
    notifySupersededRevisions: [],
    refreshArticleMediaReferenceState: [],
    syncLegacySenseMirror: []
  };

  const articleDoc = {
    _id: articleId,
    currentRevisionId: baseRevisionId,
    toObject() {
      return {
        _id: articleId,
        currentRevisionId: baseRevisionId
      };
    }
  };

  const revisionDoc = {
    _id: revisionId,
    articleId,
    proposerId: makeObjectId(1),
    status: 'pending_domain_master_review',
    baseRevisionId,
    contentFormat: 'rich_html',
    plainTextSnapshot: '发布摘要',
    editorSource: '<p>published</p>',
    mediaReferences: [],
    validationSnapshot: { ok: true },
    __v: 1,
    toObject() {
      return {
        _id: revisionId,
        articleId,
        proposerId: makeObjectId(1),
        status: 'pending_domain_master_review',
        baseRevisionId,
        reviewParticipants: [{ userId, role: 'domain_master' }],
        reviewVotes: []
      };
    }
  };

  const service = createSenseArticleWorkflowService({
    ACTIVE_SUPERSEDE_STATUSES: ['pending_review', 'pending_domain_admin_review', 'pending_domain_master_review'],
    SenseArticle: {
      findOneAndUpdate: async (filter, update) => {
        calls.articleUpdates.push({ filter, update });
        return {
          _id: articleId,
          currentRevisionId: revisionId
        };
      },
      updateOne: async () => {
        throw new Error('should not rollback published article');
      }
    },
    SenseArticleRevision: {
      findOne: async () => revisionDoc,
      findOneAndUpdate: async (_filter, update) => ({
        _id: revisionId,
        articleId,
        baseRevisionId,
        status: update.$set.status,
        reviewStage: update.$set.reviewStage,
        reviewVotes: update.$set.reviewVotes,
        finalDecision: update.$set.finalDecision,
        publishedBy: update.$set.publishedBy
      }),
      find: () => ({
        lean: async () => []
      }),
      updateMany: async () => {
        throw new Error('should not supersede when there are no sibling revisions');
      }
    },
    User: {},
    applyPublishedSenseTitle: async (payload) => {
      calls.applyPublishedSenseTitle.push(payload);
    },
    assertRevisionValidationBeforeWorkflow: (payload) => {
      calls.assertRevisionValidationBeforeWorkflow.push(payload);
    },
    buildReviewParticipantsFromNode: () => [],
    buildReviewPresentation: async () => ({
      summary: {
        byRole: {
          domain_admin: { total: 0, approvedCount: 0, pendingCount: 0, allApproved: false },
          domain_master: { total: 1, approvedCount: 1, pendingCount: 0, allApproved: true }
        }
      }
    }),
    buildRevisionMutationResponse: (value) => value,
    buildSummary: (value) => `summary:${value}`,
    canUserUpdateSenseMetadata: () => false,
    createExposeError,
    detectContentFormat: () => 'rich_html',
    ensurePermission: ensurePermissionOrThrow,
    ensureReviewParticipantsSnapshot: () => [{ userId, role: 'domain_master' }],
    ensureReviewVotesSnapshot: () => [],
    ensureRevisionDerivedState: async (value) => value,
    getArticleBundle: async () => ({
      article: articleDoc,
      node: {},
      nodeSense: { title: '旧标题' },
      permissions: {
        isSystemAdmin: false,
        canReviewDomainAdmin: false,
        canReviewDomainMaster: true
      },
      nodeId: articleId,
      senseId: 's1'
    }),
    getIdString: (value) => (value == null ? '' : String(value)),
    isPendingReviewStatus: (status) => ['pending_review', 'pending_domain_admin_review', 'pending_domain_master_review'].includes(status),
    notifyDomainMasterDecision: async (payload) => {
      calls.notifyDomainMasterDecision.push(payload);
    },
    notifyReferencedDomains: async (payload) => {
      calls.notifyReferencedDomains.push(payload);
    },
    notifyRevisionSubmitted: async () => {},
    notifySupersededRevisions: async (payload) => {
      calls.notifySupersededRevisions.push(payload);
    },
    reasonToMessage: (reason) => reason,
    resolveProposedSenseTitle: async () => '',
    resolveReviewerRoleForUser: () => 'domain_master',
    resolveRevisionTitleInput: ({ revisionTitle }) => revisionTitle,
    resolveSubmitOperation: () => ({ kind: 'noop' }),
    revisionHasMeaningfulSubmissionChanges: () => true,
    selectSupersedeCandidates: () => [],
    serializeArticleSummary: (value) => value,
    serializePermissions: (value) => value,
    serializeRevisionDetail: (value) => value,
    syncLegacySenseMirror: async (payload) => {
      calls.syncLegacySenseMirror.push(payload);
    },
    refreshArticleMediaReferenceState: async (payload) => {
      calls.refreshArticleMediaReferenceState.push(payload);
    },
    validateRevisionContent: () => ({})
  });

  const result = await service.reviewByDomainMaster({
    nodeId: makeObjectId(10),
    senseId: 's1',
    revisionId,
    userId,
    action: 'approve',
    comment: '终审通过'
  });

  assert.equal(result.article.currentRevisionId, revisionId);
  assert.equal(result.revision.status, 'published');
  assert.equal(result.revision.finalDecision, 'published');
  assert.equal(result.revision.publishedBy, userId);
  assert.equal(calls.applyPublishedSenseTitle.length, 1);
  assert.equal(calls.assertRevisionValidationBeforeWorkflow.length, 1);
  assert.equal(calls.assertRevisionValidationBeforeWorkflow[0].phase, 'publish');
  assert.equal(calls.articleUpdates.length, 1);
  assert.equal(calls.articleUpdates[0].filter.currentRevisionId, baseRevisionId);
  assert.equal(calls.articleUpdates[0].update.$set.summary, 'summary:发布摘要');
  assert.equal(calls.syncLegacySenseMirror.length, 1);
  assert.equal(calls.refreshArticleMediaReferenceState.length, 1);
  assert.equal(calls.notifyDomainMasterDecision.length, 1);
  assert.equal(calls.notifyDomainMasterDecision[0].action, 'approved');
  assert.equal(calls.notifySupersededRevisions.length, 1);
  assert.deepEqual(calls.notifySupersededRevisions[0].supersededRevisions, []);
  assert.equal(calls.notifyReferencedDomains.length, 1);
});

test('reviewByDomainMaster 在发布基线已过期时返回 publish_base_outdated', async () => {
  const articleId = makeObjectId(10);
  const baseRevisionId = makeObjectId(99);
  const revisionId = makeObjectId(103);
  const newerRevisionId = makeObjectId(120);
  const userId = makeObjectId(3);
  const updateOneCalls = [];
  const notifyCalls = [];

  const revisionDoc = {
    _id: revisionId,
    articleId,
    proposerId: makeObjectId(1),
    status: 'pending_domain_master_review',
    baseRevisionId,
    contentFormat: 'rich_html',
    plainTextSnapshot: '发布摘要',
    editorSource: '<p>published</p>',
    mediaReferences: [],
    validationSnapshot: { ok: true },
    __v: 1,
    toObject() {
      return {
        _id: revisionId,
        articleId,
        proposerId: makeObjectId(1),
        status: 'pending_domain_master_review',
        baseRevisionId,
        reviewParticipants: [{ userId, role: 'domain_master' }],
        reviewVotes: []
      };
    }
  };

  const service = createSenseArticleWorkflowService({
    ACTIVE_SUPERSEDE_STATUSES: ['pending_review', 'pending_domain_admin_review', 'pending_domain_master_review'],
    SenseArticle: {
      findOneAndUpdate: async () => null,
      findById: () => buildFindByIdChain({
        _id: articleId,
        currentRevisionId: newerRevisionId
      }),
      updateOne: async () => {
        throw new Error('should not rollback article when publish base is already outdated');
      }
    },
    SenseArticleRevision: {
      findOne: async () => revisionDoc,
      findById: async () => ({
        _id: revisionId,
        status: 'superseded'
      }),
      updateOne: async (filter, update) => {
        updateOneCalls.push({ filter, update });
      }
    },
    User: {},
    applyPublishedSenseTitle: async () => {},
    assertRevisionValidationBeforeWorkflow: () => {},
    buildReviewParticipantsFromNode: () => [],
    buildReviewPresentation: async () => ({
      summary: {
        byRole: {
          domain_admin: { total: 0, approvedCount: 0, pendingCount: 0, allApproved: false },
          domain_master: { total: 1, approvedCount: 1, pendingCount: 0, allApproved: true }
        }
      }
    }),
    buildRevisionMutationResponse: (value) => value,
    buildSummary: (value) => `summary:${value}`,
    canUserUpdateSenseMetadata: () => false,
    createExposeError,
    detectContentFormat: () => 'rich_html',
    ensurePermission: ensurePermissionOrThrow,
    ensureReviewParticipantsSnapshot: () => [{ userId, role: 'domain_master' }],
    ensureReviewVotesSnapshot: () => [],
    ensureRevisionDerivedState: async (value) => value,
    getArticleBundle: async () => ({
      article: {
        _id: articleId,
        currentRevisionId: baseRevisionId
      },
      node: {},
      nodeSense: { title: '旧标题' },
      permissions: {
        isSystemAdmin: false,
        canReviewDomainAdmin: false,
        canReviewDomainMaster: true
      },
      nodeId: articleId,
      senseId: 's1'
    }),
    getIdString: (value) => (value == null ? '' : String(value)),
    isPendingReviewStatus: (status) => ['pending_review', 'pending_domain_admin_review', 'pending_domain_master_review'].includes(status),
    notifyDomainMasterDecision: async (payload) => {
      notifyCalls.push(payload);
    },
    notifyReferencedDomains: async () => {},
    notifyRevisionSubmitted: async () => {},
    notifySupersededRevisions: async () => {},
    reasonToMessage: (reason) => reason,
    resolveProposedSenseTitle: async () => '',
    resolveReviewerRoleForUser: () => 'domain_master',
    resolveRevisionTitleInput: ({ revisionTitle }) => revisionTitle,
    resolveSubmitOperation: () => ({ kind: 'noop' }),
    revisionHasMeaningfulSubmissionChanges: () => true,
    selectSupersedeCandidates: () => [],
    serializeArticleSummary: (value) => value,
    serializePermissions: (value) => value,
    serializeRevisionDetail: (value) => value,
    syncLegacySenseMirror: async () => {},
    refreshArticleMediaReferenceState: async () => {},
    validateRevisionContent: () => ({})
  });

  await assert.rejects(() => service.reviewByDomainMaster({
    nodeId: makeObjectId(10),
    senseId: 's1',
    revisionId,
    userId,
    action: 'approve',
    comment: '终审通过'
  }), (error) => {
    assert.equal(error.code, 'publish_base_outdated');
    assert.equal(error.statusCode, 409);
    return true;
  });

  assert.equal(updateOneCalls.length, 1);
  assert.equal(updateOneCalls[0].update.$set.status, 'superseded');
  assert.equal(updateOneCalls[0].update.$set.supersededByRevisionId, newerRevisionId);
  assert.equal(notifyCalls.length, 0);
});
