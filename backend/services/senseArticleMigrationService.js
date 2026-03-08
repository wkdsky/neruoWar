const { parseSenseArticleSource } = require('./senseArticleParser');

const buildSummary = (plainText = '') => {
  const trimmed = String(plainText || '').trim();
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
};

const planLegacyBackfillOperation = ({ article = null, currentRevision = null }) => {
  if (!article) {
    return {
      shouldCreateArticle: true,
      shouldCreateRevision: true,
      shouldUpdateArticle: true,
      mode: 'create_article_and_revision'
    };
  }
  if (!currentRevision) {
    return {
      shouldCreateArticle: false,
      shouldCreateRevision: true,
      shouldUpdateArticle: true,
      mode: 'create_missing_revision'
    };
  }
  return {
    shouldCreateArticle: false,
    shouldCreateRevision: false,
    shouldUpdateArticle: false,
    mode: 'skip_existing_article'
  };
};

const buildLegacyArticleSeed = ({
  nodeId,
  senseId,
  articleId,
  editorSource = '',
  proposerId = null,
  createdAt = new Date(),
  updatedAt = new Date(),
  referenceIndex = null
}) => {
  const parsed = parseSenseArticleSource(editorSource);
  const effectiveReferenceIndex = Array.isArray(referenceIndex) ? referenceIndex : parsed.referenceIndex;
  return {
    article: {
      _id: articleId,
      nodeId,
      senseId,
      articleKey: `${nodeId}:${senseId}`,
      summary: buildSummary(parsed.plainTextSnapshot),
      createdBy: proposerId,
      updatedBy: proposerId,
      createdAt,
      updatedAt,
      publishedAt: updatedAt
    },
    revision: {
      nodeId,
      senseId,
      articleId,
      revisionNumber: 1,
      baseRevisionId: null,
      parentRevisionId: null,
      sourceMode: 'full',
      editorSource: parsed.editorSource,
      ast: parsed.ast,
      headingIndex: parsed.headingIndex,
      referenceIndex: effectiveReferenceIndex,
      formulaRefs: parsed.formulaRefs,
      symbolRefs: parsed.symbolRefs,
      plainTextSnapshot: parsed.plainTextSnapshot,
      renderSnapshot: parsed.renderSnapshot,
      diffFromBase: { changes: [], stats: { added: 0, removed: 0 } },
      proposerId,
      proposerNote: 'legacy_backfill_initial_publish',
      status: 'published',
      reviewStage: 'completed',
      domainAdminDecision: 'approved',
      domainMasterDecision: 'approved',
      finalDecision: 'published',
      finalDecisionAt: updatedAt,
      publishedBy: proposerId,
      publishedAt: updatedAt,
      createdAt,
      updatedAt
    }
  };
};

module.exports = {
  buildLegacyArticleSeed,
  buildSummary,
  planLegacyBackfillOperation
};
