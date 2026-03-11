const fs = require('fs');
const path = require('path');
const SenseArticleMediaAsset = require('../models/SenseArticleMediaAsset');

const MEDIA_PUBLIC_PATH = '/uploads/sense-article-media';
const MEDIA_STORAGE_DIR = path.join(__dirname, '..', 'uploads', 'sense-article-media');

const ensureMediaStorageDir = () => {
  fs.mkdirSync(MEDIA_STORAGE_DIR, { recursive: true });
  return MEDIA_STORAGE_DIR;
};

const buildMediaUrl = (fileName = '') => `${MEDIA_PUBLIC_PATH}/${fileName}`;

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
  duration = null
}) => {
  // Deleting a media node from editor content does not delete the physical file immediately.
  // Keep asset metadata so a future orphan-cleanup job can safely GC unreferenced files.
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
    status: 'uploaded'
  });
  return asset;
};

module.exports = {
  MEDIA_PUBLIC_PATH,
  MEDIA_STORAGE_DIR,
  buildMediaUrl,
  createMediaAssetRecord,
  ensureMediaStorageDir
};
