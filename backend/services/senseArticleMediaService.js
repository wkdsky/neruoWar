const fs = require('fs');
const path = require('path');
const SenseArticleMediaAsset = require('../models/SenseArticleMediaAsset');

const MEDIA_PUBLIC_PATH = '/uploads/sense-article-media';
const MEDIA_STORAGE_DIR = path.join(__dirname, '..', 'uploads', 'sense-article-media');
const TEMP_MEDIA_TTL_MS = Math.max(60 * 1000, parseInt(process.env.SENSE_ARTICLE_TEMP_MEDIA_TTL_MS, 10) || 5 * 60 * 1000);
const TEMP_MEDIA_CLEANUP_BUCKET_MS = Math.max(60 * 1000, parseInt(process.env.SENSE_ARTICLE_TEMP_MEDIA_CLEANUP_BUCKET_MS, 10) || 1 * 60 * 1000);

const ensureMediaStorageDir = () => {
  fs.mkdirSync(MEDIA_STORAGE_DIR, { recursive: true });
  return MEDIA_STORAGE_DIR;
};

const buildMediaUrl = (fileName = '') => `${MEDIA_PUBLIC_PATH}/${fileName}`;
const normalizeTempSessionId = (value = '') => (typeof value === 'string' ? value.trim() : '');
const buildTempExpiry = (baseTime = new Date()) => new Date((baseTime instanceof Date ? baseTime : new Date(baseTime)).getTime() + TEMP_MEDIA_TTL_MS);
const buildCleanupBucketRunAt = (date = new Date()) => {
  const safeDate = date instanceof Date ? date : new Date(date);
  const bucket = Math.ceil(safeDate.getTime() / TEMP_MEDIA_CLEANUP_BUCKET_MS);
  return new Date(bucket * TEMP_MEDIA_CLEANUP_BUCKET_MS);
};

const normalizeFilter = ({ articleId = null, nodeId = null, senseId = '' } = {}) => (
  articleId
    ? { articleId }
    : { nodeId, senseId: String(senseId || '').trim() }
);

const deleteMediaAssets = async (assets = []) => {
  const rows = Array.isArray(assets) ? assets.filter(Boolean) : [];
  if (rows.length === 0) {
    return {
      deletedAssetCount: 0,
      deletedFileCount: 0
    };
  }

  const assetIds = rows.map((item) => item._id).filter(Boolean);
  const storagePaths = Array.from(new Set(rows.map((item) => String(item.storagePath || '').trim()).filter(Boolean)));

  if (assetIds.length > 0) {
    await SenseArticleMediaAsset.deleteMany({ _id: { $in: assetIds } });
  }

  let deletedFileCount = 0;
  for (const storagePath of storagePaths) {
    const remaining = await SenseArticleMediaAsset.countDocuments({ storagePath });
    if (remaining > 0) continue;
    const resolvedPath = path.resolve(storagePath);
    if (!resolvedPath.startsWith(MEDIA_STORAGE_DIR)) continue;
    try {
      await fs.promises.unlink(resolvedPath);
      deletedFileCount += 1;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  return {
    deletedAssetCount: assetIds.length,
    deletedFileCount
  };
};

const pruneUnreferencedMediaAssets = async ({ articleId = null, nodeId = null, senseId = '' } = {}) => {
  const filter = normalizeFilter({ articleId, nodeId, senseId });
  const staleAssets = await SenseArticleMediaAsset.find({
    ...filter,
    referencedRevisionIds: { $size: 0 },
    status: { $in: ['uploaded', 'orphan_candidate'] },
    isTemporary: false
  }).lean();
  return deleteMediaAssets(staleAssets);
};

const pruneExpiredTemporaryMediaAssets = async ({ now = new Date(), articleId = null, nodeId = null, senseId = '' } = {}) => {
  const filter = normalizeFilter({ articleId, nodeId, senseId });
  const safeNow = now instanceof Date ? now : new Date(now);
  const expiredAssets = await SenseArticleMediaAsset.find({
    ...filter,
    isTemporary: true,
    tempExpiresAt: { $lte: safeNow }
  }).lean();
  return deleteMediaAssets(expiredAssets);
};

const promoteMediaAssets = async ({ articleId = null, nodeId = null, senseId = '', urls = [] } = {}) => {
  const filter = normalizeFilter({ articleId, nodeId, senseId });
  const normalizedUrls = Array.from(new Set((Array.isArray(urls) ? urls : []).map((item) => String(item || '').trim()).filter(Boolean)));
  if (normalizedUrls.length === 0) return { matchedCount: 0, modifiedCount: 0 };
  return SenseArticleMediaAsset.updateMany({
    ...filter,
    url: { $in: normalizedUrls }
  }, {
    $set: {
      isTemporary: false,
      tempSessionId: '',
      tempExpiresAt: null
    }
  });
};

const touchTemporaryMediaSession = async ({ articleId = null, nodeId = null, senseId = '', tempSessionId = '', now = new Date() } = {}) => {
  const normalizedSessionId = normalizeTempSessionId(tempSessionId);
  if (!normalizedSessionId) return { matchedCount: 0, modifiedCount: 0, tempExpiresAt: null };
  const filter = normalizeFilter({ articleId, nodeId, senseId });
  const tempExpiresAt = buildTempExpiry(now);
  const result = await SenseArticleMediaAsset.updateMany({
    ...filter,
    isTemporary: true,
    tempSessionId: normalizedSessionId
  }, {
    $set: {
      tempExpiresAt
    }
  });
  const matchedCount = Number(result?.matchedCount || 0);
  const modifiedCount = Number(result?.modifiedCount || 0);
  return {
    matchedCount,
    modifiedCount,
    tempExpiresAt: matchedCount > 0 ? tempExpiresAt : null
  };
};

const releaseTemporaryMediaSession = async ({ articleId = null, nodeId = null, senseId = '', tempSessionId = '' } = {}) => {
  const normalizedSessionId = normalizeTempSessionId(tempSessionId);
  if (!normalizedSessionId) {
    return {
      deletedAssetCount: 0,
      deletedFileCount: 0
    };
  }
  const filter = normalizeFilter({ articleId, nodeId, senseId });
  const sessionAssets = await SenseArticleMediaAsset.find({
    ...filter,
    isTemporary: true,
    tempSessionId: normalizedSessionId
  }).lean();
  return deleteMediaAssets(sessionAssets);
};

const syncTemporaryMediaSessionAssets = async ({ articleId = null, nodeId = null, senseId = '', tempSessionId = '', activeUrls = [] } = {}) => {
  const normalizedSessionId = normalizeTempSessionId(tempSessionId);
  if (!normalizedSessionId) {
    return {
      deletedAssetCount: 0,
      deletedFileCount: 0,
      deletedAssetIds: [],
      deletedUrls: []
    };
  }
  const filter = normalizeFilter({ articleId, nodeId, senseId });
  const normalizedUrls = new Set((Array.isArray(activeUrls) ? activeUrls : []).map((item) => String(item || '').trim()).filter(Boolean));
  const staleAssets = await SenseArticleMediaAsset.find({
    ...filter,
    isTemporary: true,
    tempSessionId: normalizedSessionId,
    url: { $nin: Array.from(normalizedUrls) }
  }).lean();
  const deletedAssetIds = staleAssets.map((item) => item?._id).filter(Boolean);
  const deletedUrls = staleAssets.map((item) => String(item?.url || '').trim()).filter(Boolean);
  const deleted = await deleteMediaAssets(staleAssets);
  return {
    ...deleted,
    deletedAssetIds,
    deletedUrls
  };
};

const createMediaAssetRecord = async ({
  nodeId,
  senseId,
  articleId = null,
  revisionId = null,
  kind,
  file,
  userId,
  alt = '',
  caption = '',
  title = '',
  description = '',
  posterUrl = '',
  width = null,
  height = null,
  duration = null,
  tempSessionId = ''
}) => {
  const normalizedSessionId = normalizeTempSessionId(tempSessionId);
  const asset = await SenseArticleMediaAsset.create({
    nodeId,
    senseId,
    articleId,
    revisionId,
    kind,
    originalName: file?.originalname || '',
    fileName: file?.filename || '',
    storagePath: file?.path || '',
    url: buildMediaUrl(file?.filename || ''),
    mimeType: file?.mimetype || '',
    size: Number(file?.size || 0),
    fileSize: Number(file?.size || 0),
    width: Number.isFinite(Number(width)) ? Number(width) : null,
    height: Number.isFinite(Number(height)) ? Number(height) : null,
    duration: Number.isFinite(Number(duration)) ? Number(duration) : null,
    alt,
    caption,
    title,
    description,
    posterUrl,
    uploadedBy: userId,
    status: 'uploaded',
    isTemporary: !!normalizedSessionId,
    tempSessionId: normalizedSessionId,
    tempExpiresAt: normalizedSessionId ? buildTempExpiry() : null
  });
  return asset;
};

module.exports = {
  MEDIA_PUBLIC_PATH,
  MEDIA_STORAGE_DIR,
  TEMP_MEDIA_TTL_MS,
  TEMP_MEDIA_CLEANUP_BUCKET_MS,
  buildMediaUrl,
  buildCleanupBucketRunAt,
  createMediaAssetRecord,
  deleteMediaAssets,
  ensureMediaStorageDir,
  promoteMediaAssets,
  pruneExpiredTemporaryMediaAssets,
  pruneUnreferencedMediaAssets,
  releaseTemporaryMediaSession,
  syncTemporaryMediaSessionAssets,
  touchTemporaryMediaSession
};
