require('dotenv').config();
const mongoose = require('mongoose');
const { scanOrphanMediaAssets } = require('../services/senseArticleMediaReferenceService');
const { toObjectIdOrNull, isValidObjectId } = require('../utils/objectId');

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

const resolveScanTarget = (args = {}) => {
  const articleId = String(args.articleId || '').trim();
  if (articleId) {
    if (!isValidObjectId(articleId)) {
      throw new Error('articleId 不是有效的 ObjectId');
    }
    return { articleId: toObjectIdOrNull(articleId), nodeId: '', senseId: '' };
  }

  const nodeId = String(args.nodeId || '').trim();
  const senseId = String(args.senseId || '').trim();
  if (!nodeId || !senseId) {
    throw new Error('未提供 articleId 时，必须同时传入 nodeId 和 senseId');
  }
  if (!isValidObjectId(nodeId)) {
    throw new Error('nodeId 不是有效的 ObjectId');
  }
  return { articleId: null, nodeId, senseId };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const sampleLimit = Math.max(1, Math.min(100, Number(args.limit) || 20));
  const target = resolveScanTarget(args);

  await connectMongo();

  const report = await scanOrphanMediaAssets({
    ...target,
    sampleLimit
  });

  console.log(JSON.stringify({
    scope: target.articleId ? 'article' : 'node_sense',
    articleId: target.articleId ? String(target.articleId) : null,
    nodeId: target.nodeId || null,
    senseId: target.senseId || null,
    sampleLimit,
    ...report
  }, null, 2));
};

main()
  .catch((error) => {
    console.error('[sense-article-media-audit] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (_error) {
      // ignore close errors
    }
  });
