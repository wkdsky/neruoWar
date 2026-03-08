const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../config/database');
const Node = require('../models/Node');
const NodeSense = require('../models/NodeSense');
const SenseArticle = require('../models/SenseArticle');
const SenseArticleRevision = require('../models/SenseArticleRevision');
const { parseSenseArticleSource } = require('../services/senseArticleParser');
const { buildLegacyArticleSeed, planLegacyBackfillOperation } = require('../services/senseArticleMigrationService');

const enrichReferences = async (referenceIndex = []) => {
  const references = Array.isArray(referenceIndex) ? referenceIndex : [];
  const nodeIds = Array.from(new Set(
    references.map((item) => String(item.targetNodeId || '')).filter((item) => mongoose.Types.ObjectId.isValid(item))
  ));
  if (nodeIds.length === 0) {
    return references.map((item) => ({ ...item, isValid: false, targetTitle: '', targetNodeName: '' }));
  }
  const [nodes, senses] = await Promise.all([
    Node.find({ _id: { $in: nodeIds } }).select('_id name').lean(),
    NodeSense.find({ nodeId: { $in: nodeIds } }).select('nodeId senseId title').lean()
  ]);
  const nodeMap = new Map(nodes.map((item) => [String(item._id), item.name || '']));
  const senseMap = new Map(senses.map((item) => [`${item.nodeId}:${item.senseId}`, item.title || '']));
  return references.map((item) => {
    const key = `${item.targetNodeId || ''}:${item.targetSenseId || ''}`;
    const title = senseMap.get(key) || '';
    return {
      ...item,
      isValid: !!title,
      targetTitle: title,
      targetNodeName: nodeMap.get(String(item.targetNodeId || '')) || ''
    };
  });
};

const run = async () => {
  await connectDB();
  const cursor = NodeSense.find({}).sort({ nodeId: 1, order: 1, senseId: 1 }).cursor({ batchSize: 100 });

  let scanned = 0;
  let createdArticles = 0;
  let createdRevisions = 0;
  let updatedArticles = 0;

  for await (const sense of cursor) {
    scanned += 1;
    const nodeId = sense.nodeId;
    const senseId = sense.senseId;
    let article = await SenseArticle.findOne({ nodeId, senseId });
    let currentRevision = article?.currentRevisionId ? await SenseArticleRevision.findById(article.currentRevisionId) : null;

    const plan = planLegacyBackfillOperation({ article, currentRevision });

    if (plan.shouldCreateArticle) {
      article = new SenseArticle({
        nodeId,
        senseId,
        articleKey: `${nodeId}:${senseId}`,
        currentRevisionId: null,
        latestDraftRevisionId: null,
        summary: '',
        createdBy: sense.createdBy || null,
        updatedBy: sense.updatedBy || null,
        createdAt: sense.createdAt || new Date(),
        updatedAt: sense.updatedAt || new Date()
      });
      await article.save();
      createdArticles += 1;
    }

    if (plan.shouldCreateRevision) {
      const parsed = parseSenseArticleSource(sense.content || '');
      const referenceIndex = await enrichReferences(parsed.referenceIndex);
      const seed = buildLegacyArticleSeed({
        nodeId,
        senseId,
        articleId: article._id,
        editorSource: sense.content || '',
        proposerId: sense.updatedBy || sense.createdBy || null,
        createdAt: sense.createdAt || new Date(),
        updatedAt: sense.updatedAt || sense.createdAt || new Date(),
        referenceIndex
      });
      const revision = await SenseArticleRevision.create(seed.revision);
      article.currentRevisionId = revision._id;
      article.summary = seed.article.summary;
      article.publishedAt = revision.publishedAt;
      article.updatedBy = revision.proposerId || article.updatedBy || null;
      await article.save();

      if (!sense.legacySummary) {
        sense.legacySummary = article.summary;
        await sense.save();
      }

      createdRevisions += 1;
      updatedArticles += 1;
    }
  }

  console.log(`[sense-articles] scanned=${scanned}`);
  console.log(`[sense-articles] createdArticles=${createdArticles}`);
  console.log(`[sense-articles] createdRevisions=${createdRevisions}`);
  console.log(`[sense-articles] updatedArticles=${updatedArticles}`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('backfillSenseArticles failed:', error);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    // ignore
  }
  process.exit(1);
});
