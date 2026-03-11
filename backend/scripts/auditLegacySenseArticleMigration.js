require('dotenv').config();
const mongoose = require('mongoose');
const NodeSense = require('../models/NodeSense');
const SenseArticleRevision = require('../models/SenseArticleRevision');
const { auditLegacyConversionCandidate } = require('../services/senseArticleMigrationService');

const parseArgs = (argv = []) => argv.reduce((acc, item) => {
  if (!item.startsWith('--')) return acc;
  const [rawKey, rawValue] = item.slice(2).split('=');
  acc[rawKey] = rawValue === undefined ? true : rawValue;
  return acc;
}, {});

const connectMongo = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/strategy_game';
  await mongoose.connect(uri);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const limit = Math.max(1, Math.min(5000, Number(args.limit) || 500));
  const scope = String(args.scope || 'revisions').trim();

  await connectMongo();

  const rows = scope === 'node-sense'
    ? await NodeSense.find({
      $or: [
        { contentFormat: 'legacy_markup' },
        { contentFormat: { $exists: false } }
      ]
    }).select('_id nodeId senseId content contentFormat').limit(limit).lean()
    : await SenseArticleRevision.find({
      $or: [
        { contentFormat: 'legacy_markup' },
        { contentFormat: { $exists: false } }
      ]
    }).select('_id articleId nodeId senseId editorSource contentFormat').limit(limit).lean();

  const summary = rows.reduce((acc, row) => {
    const source = scope === 'node-sense' ? row.content : row.editorSource;
    const result = auditLegacyConversionCandidate({ editorSource: source || '' });
    acc.total += 1;
    if (result.success) acc.success += 1;
    else acc.failed += 1;
    result.warnings.forEach((warning) => {
      acc.warningCounts[warning] = (acc.warningCounts[warning] || 0) + 1;
    });
    if (!result.success) {
      acc.failedSamples.push({
        id: String(row._id),
        nodeId: String(row.nodeId || ''),
        senseId: String(row.senseId || ''),
        warnings: result.warnings
      });
    }
    return acc;
  }, {
    total: 0,
    success: 0,
    failed: 0,
    warningCounts: {},
    failedSamples: []
  });

  console.log(JSON.stringify({
    scope,
    limit,
    total: summary.total,
    success: summary.success,
    failed: summary.failed,
    warningCounts: summary.warningCounts,
    failedSamples: summary.failedSamples.slice(0, 20)
  }, null, 2));
};

main()
  .catch((error) => {
    console.error('[sense-article-migration-audit] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (_error) {
      // ignore close errors
    }
  });
