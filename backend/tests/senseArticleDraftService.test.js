const test = require('node:test');
const assert = require('node:assert/strict');

const { createSenseArticleDraftService } = require('../services/senseArticle/draftService');

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
  })
});

test('updateDraftRevision 在 expectedRevisionVersion 不匹配时返回冲突', async () => {
  const revision = {
    _id: makeObjectId(100),
    articleId: makeObjectId(10),
    proposerId: makeObjectId(1),
    status: 'draft',
    __v: 3,
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  };

  const service = createSenseArticleDraftService({
    CONTENT_FORMATS: { LEGACY_MARKUP: 'legacy_markup' },
    DRAFT_EDITABLE_STATUSES: ['draft'],
    SenseArticle: {},
    SenseArticleRevision: {
      findOne: async () => revision
    },
    User: {},
    buildRevisionBootstrapResponse: () => {
      throw new Error('should not reach bootstrap');
    },
    buildRevisionMediaAndValidation: async () => {
      throw new Error('should not build derived');
    },
    buildRevisionMutationResponse: () => {
      throw new Error('should not build response');
    },
    canUserUpdateSenseMetadata: () => false,
    convertLegacyMarkupToRichHtml: (value) => value,
    createAnchorFromSelection: () => null,
    createExposeError,
    detectContentFormat: () => 'legacy_markup',
    diagLog: () => {},
    diagWarn: () => {},
    durationMs: () => 0,
    ensurePermission: (allowed, message, statusCode = 403, code = 'forbidden') => {
      if (!allowed) throw createExposeError(message, statusCode, code);
    },
    ensureRevisionDerivedState: async (value) => value,
    extractMediaUrlsFromEditorSource: () => [],
    extractReferenceUrls: () => [],
    getArticleBundle: async () => ({
      article: { _id: makeObjectId(10) },
      permissions: { isSystemAdmin: false },
      nodeSense: {},
      currentRevision: null
    }),
    getIdString: (value) => (value == null ? '' : String(value)),
    materializeRevisionPayload: async () => ({}),
    normalizeTrimmedText: (value) => String(value || '').trim(),
    nowMs: () => 0,
    promoteMediaAssets: async () => {},
    releaseTemporaryMediaSession: async () => {},
    resolveProposedSenseTitle: async () => '',
    resolveRevisionTitleInput: () => '',
    scheduleArticleMediaMaintenance: () => {},
    serializeArticleSummary: (value) => value,
    serializePermissions: (value) => value,
    syncAndPruneArticleMedia: async () => {}
  });

  await assert.rejects(() => service.updateDraftRevision({
    nodeId: makeObjectId(10),
    senseId: 's1',
    revisionId: revision._id,
    userId: makeObjectId(1),
    payload: { expectedRevisionVersion: 2 }
  }), (error) => {
    assert.equal(error.code, 'revision_edit_conflict');
    assert.equal(error.statusCode, 409);
    assert.equal(error.details.serverRevisionVersion, 3);
    return true;
  });
});

test('deleteDraftRevision 会回退 latestDraftRevisionId 并触发媒体清理', async () => {
  const articleId = makeObjectId(10);
  const removedRevisionId = makeObjectId(100);
  const fallbackDraftId = makeObjectId(101);
  const calls = {
    articleUpdate: null,
    syncAndPrune: null
  };

  let findOneCount = 0;
  const service = createSenseArticleDraftService({
    CONTENT_FORMATS: { LEGACY_MARKUP: 'legacy_markup' },
    DRAFT_EDITABLE_STATUSES: ['draft'],
    SenseArticle: {
      updateOne: async (_filter, patch) => {
        calls.articleUpdate = patch;
        return { acknowledged: true };
      }
    },
    SenseArticleRevision: {
      findOne: (query) => {
        if (query?.status) {
          return {
            sort: () => ({
              select: () => ({
                lean: async () => ({ _id: fallbackDraftId })
              })
            })
          };
        }
        findOneCount += 1;
        return Promise.resolve({
          _id: removedRevisionId,
          articleId,
          proposerId: makeObjectId(1),
          status: 'draft'
        });
      },
      deleteOne: async () => ({ deletedCount: 1 })
    },
    User: {},
    buildRevisionBootstrapResponse: () => ({}),
    buildRevisionMediaAndValidation: async () => ({}),
    buildRevisionMutationResponse: () => ({}),
    canUserUpdateSenseMetadata: () => false,
    convertLegacyMarkupToRichHtml: (value) => value,
    createAnchorFromSelection: () => null,
    createExposeError,
    detectContentFormat: () => 'legacy_markup',
    diagLog: () => {},
    diagWarn: () => {},
    durationMs: () => 0,
    ensurePermission: (allowed, message, statusCode = 403, code = 'forbidden') => {
      if (!allowed) throw createExposeError(message, statusCode, code);
    },
    ensureRevisionDerivedState: async (value) => value,
    extractMediaUrlsFromEditorSource: () => [],
    extractReferenceUrls: () => [],
    getArticleBundle: async () => ({
      article: {
        _id: articleId,
        latestDraftRevisionId: removedRevisionId,
        toObject() {
          return { _id: articleId, latestDraftRevisionId: removedRevisionId };
        }
      },
      nodeId: makeObjectId(10),
      senseId: 's1',
      permissions: { isSystemAdmin: false, userId: makeObjectId(1) }
    }),
    getIdString: (value) => (value == null ? '' : String(value)),
    materializeRevisionPayload: async () => ({}),
    normalizeTrimmedText: (value) => String(value || '').trim(),
    nowMs: () => 0,
    promoteMediaAssets: async () => {},
    releaseTemporaryMediaSession: async () => {},
    resolveProposedSenseTitle: async () => '',
    resolveRevisionTitleInput: () => '',
    scheduleArticleMediaMaintenance: () => {},
    serializeArticleSummary: (value) => value,
    serializePermissions: (value) => value,
    syncAndPruneArticleMedia: async (payload) => {
      calls.syncAndPrune = payload;
    }
  });

  const result = await service.deleteDraftRevision({
    nodeId: makeObjectId(10),
    senseId: 's1',
    revisionId: removedRevisionId,
    userId: makeObjectId(1)
  });

  assert.equal(result.deletedRevisionId, removedRevisionId);
  assert.equal(result.article.latestDraftRevisionId, fallbackDraftId);
  assert.equal(calls.articleUpdate.$set.latestDraftRevisionId, fallbackDraftId);
  assert.equal(calls.syncAndPrune.articleId, articleId);
});
