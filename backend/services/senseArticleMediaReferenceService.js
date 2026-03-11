const { parse } = require('node-html-parser');
const SenseArticleMediaAsset = require('../models/SenseArticleMediaAsset');
const SenseArticleRevision = require('../models/SenseArticleRevision');
const { getIdString, toObjectIdOrNull } = require('../utils/objectId');
const { diagWarn } = require('./senseArticleDiagnostics');

const MEDIA_TAG_TO_KIND = {
  img: 'image',
  audio: 'audio',
  video: 'video'
};

const uniqueBy = (rows = [], buildKey = (item) => item) => {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter((item) => {
    const key = buildKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeUrl = (value = '') => String(value || '').trim();

const extractMediaAttributesFromFigure = (figureHtml = '', fallback = {}) => {
  if (!figureHtml) return null;
  try {
    const root = parse(figureHtml);
    const targetTag = ['img', 'audio', 'video'].find((tagName) => !!root.querySelector(tagName));
    if (!targetTag) return null;
    const mediaElement = root.querySelector(targetTag);
    const caption = root.querySelector('figcaption')?.text?.trim?.() || fallback.caption || '';
    const width = Number.parseInt(String(mediaElement.getAttribute('width') || fallback.width || '').replace(/[^\d]/g, ''), 10) || null;
    return {
      kind: MEDIA_TAG_TO_KIND[targetTag] || fallback.kind || '',
      url: normalizeUrl(mediaElement.getAttribute('src') || fallback.url || ''),
      alt: normalizeUrl(mediaElement.getAttribute('alt') || fallback.alt || ''),
      caption,
      title: normalizeUrl(mediaElement.getAttribute('data-title') || fallback.title || ''),
      description: normalizeUrl(mediaElement.getAttribute('data-description') || fallback.description || ''),
      posterUrl: normalizeUrl(mediaElement.getAttribute('poster') || fallback.posterUrl || ''),
      width
    };
  } catch (error) {
    diagWarn('sense.media.extract_failed', {
      errorName: error?.name || 'Error',
      errorMessage: error?.message || 'failed to parse media figure html'
    });
    return null;
  }
};

const extractMediaReferencesFromRevision = ({ revision = null, nodeId = '', senseId = '' } = {}) => {
  const blocks = Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks : [];
  const refs = blocks
    .filter((block) => ['image', 'audio', 'video'].includes(String(block?.type || '').trim()))
    .map((block) => {
      const extracted = extractMediaAttributesFromFigure(block?.html || '', {
        kind: block?.type || '',
        caption: block?.plainText || ''
      });
      if (!extracted?.url) return null;
      return {
        assetId: null,
        nodeId: getIdString(nodeId || revision?.nodeId),
        senseId: String(senseId || revision?.senseId || '').trim(),
        revisionId: getIdString(revision?._id),
        blockId: String(block?.id || '').trim(),
        headingId: String(block?.headingId || '').trim(),
        kind: extracted.kind,
        url: extracted.url,
        alt: extracted.alt,
        caption: extracted.caption,
        title: extracted.title,
        description: extracted.description,
        posterUrl: extracted.posterUrl,
        width: extracted.width,
        isTrackedAsset: false,
        missingAsset: false
      };
    })
    .filter(Boolean);
  return uniqueBy(refs, (item) => `${item.kind}:${item.url}:${item.blockId}`);
};

const hydrateMediaReferenceAssets = async ({ nodeId = '', senseId = '', references = [] } = {}) => {
  const uniqueUrls = uniqueBy((Array.isArray(references) ? references : []).map((item) => normalizeUrl(item.url)).filter(Boolean), (item) => item);
  if (uniqueUrls.length === 0) return [];
  const assets = await SenseArticleMediaAsset.find({
    nodeId: toObjectIdOrNull(nodeId),
    senseId: String(senseId || '').trim(),
    url: { $in: uniqueUrls }
  }).select('_id url kind status mimeType fileSize size width height duration originalName createdAt').lean();
  const assetMap = new Map(assets.map((item) => [normalizeUrl(item.url), item]));
  return (Array.isArray(references) ? references : []).map((item) => {
    const asset = assetMap.get(normalizeUrl(item.url));
    return {
      ...item,
      assetId: asset?._id || null,
      kind: item.kind || asset?.kind || '',
      mimeType: asset?.mimeType || '',
      originalName: asset?.originalName || '',
      fileSize: Number(asset?.fileSize || asset?.size || 0),
      width: item.width || asset?.width || null,
      height: asset?.height || null,
      duration: asset?.duration || null,
      assetStatus: asset?.status || '',
      createdAt: asset?.createdAt || null,
      isTrackedAsset: !!asset,
      missingAsset: !asset && normalizeUrl(item.url).startsWith('/uploads/sense-article-media/')
    };
  });
};

const resolveAssetUsageStatus = ({ asset = {}, referencedRevisionIds = [] } = {}) => {
  const hasRefs = (Array.isArray(referencedRevisionIds) ? referencedRevisionIds : []).length > 0;
  const wasReferenced = !!asset?.firstReferencedAt || (Array.isArray(asset?.referencedRevisionIds) && asset.referencedRevisionIds.length > 0) || hasRefs;
  if (hasRefs) return 'active';
  if (wasReferenced) return 'orphan_candidate';
  return 'uploaded';
};

const serializeUsageAuditAsset = (asset = {}) => ({
  assetId: getIdString(asset._id),
  kind: asset?.kind || '',
  url: normalizeUrl(asset?.url),
  originalName: asset?.originalName || '',
  status: asset?.status || 'uploaded',
  fileSize: Number(asset?.fileSize || asset?.size || 0),
  mimeType: asset?.mimeType || '',
  referencedRevisionIds: Array.isArray(asset?.referencedRevisionIds) ? asset.referencedRevisionIds.map((item) => getIdString(item)).filter(Boolean) : [],
  publishedRevisionIds: Array.isArray(asset?.publishedRevisionIds) ? asset.publishedRevisionIds.map((item) => getIdString(item)).filter(Boolean) : [],
  firstReferencedAt: asset?.firstReferencedAt || null,
  lastReferencedAt: asset?.lastReferencedAt || null,
  createdAt: asset?.createdAt || null,
  updatedAt: asset?.updatedAt || null
});

const summarizeMediaUsageAudit = ({ assets = [], sampleLimit = 20 } = {}) => {
  const safeLimit = Math.max(1, Math.min(100, Number(sampleLimit) || 20));
  const buckets = {
    uploaded: [],
    active: [],
    orphan_candidate: []
  };
  const summary = {
    total: 0,
    uploaded: 0,
    active: 0,
    orphan_candidate: 0,
    totalBytes: 0
  };

  (Array.isArray(assets) ? assets : []).forEach((asset) => {
    const status = resolveAssetUsageStatus({
      asset,
      referencedRevisionIds: Array.isArray(asset?.referencedRevisionIds) ? asset.referencedRevisionIds : []
    });
    summary.total += 1;
    summary.totalBytes += Number(asset?.fileSize || asset?.size || 0);
    summary[status] += 1;
    if (buckets[status].length < safeLimit) {
      buckets[status].push(serializeUsageAuditAsset({
        ...asset,
        status
      }));
    }
  });

  return {
    summary,
    uploadedAssets: buckets.uploaded,
    activeAssets: buckets.active,
    orphanCandidates: buckets.orphan_candidate
  };
};

const refreshArticleMediaReferenceState = async ({ articleId = null, nodeId = '', senseId = '' } = {}) => {
  const filter = articleId
    ? { articleId }
    : { nodeId: toObjectIdOrNull(nodeId), senseId: String(senseId || '').trim() };
  const [assets, revisions] = await Promise.all([
    SenseArticleMediaAsset.find(filter).lean(),
    articleId
      ? SenseArticleRevision.find({ articleId }).select('_id status mediaReferences').lean()
      : SenseArticleRevision.find({ nodeId: toObjectIdOrNull(nodeId), senseId: String(senseId || '').trim() }).select('_id status mediaReferences').lean()
  ]);
  const referenceMap = new Map();
  const publishedMap = new Map();
  (Array.isArray(revisions) ? revisions : []).forEach((revision) => {
    (Array.isArray(revision.mediaReferences) ? revision.mediaReferences : []).forEach((item) => {
      const assetId = getIdString(item?.assetId);
      if (!assetId) return;
      const revisionIds = referenceMap.get(assetId) || new Set();
      revisionIds.add(getIdString(revision._id));
      referenceMap.set(assetId, revisionIds);
      if (revision.status === 'published') {
        const publishedIds = publishedMap.get(assetId) || new Set();
        publishedIds.add(getIdString(revision._id));
        publishedMap.set(assetId, publishedIds);
      }
    });
  });

  const now = new Date();
  const operations = (Array.isArray(assets) ? assets : []).map((asset) => {
    const assetId = getIdString(asset._id);
    const referencedRevisionIds = Array.from(referenceMap.get(assetId) || []);
    const publishedRevisionIds = Array.from(publishedMap.get(assetId) || []);
    const nextStatus = resolveAssetUsageStatus({ asset, referencedRevisionIds });
    const nextFirstReferencedAt = referencedRevisionIds.length > 0 ? (asset.firstReferencedAt || now) : (asset.firstReferencedAt || null);
    const nextLastReferencedAt = referencedRevisionIds.length > 0 ? now : (asset.lastReferencedAt || null);
    return {
      updateOne: {
        filter: { _id: asset._id },
        update: {
          $set: {
            status: nextStatus,
            referencedRevisionIds: referencedRevisionIds.map((item) => toObjectIdOrNull(item)).filter(Boolean),
            publishedRevisionIds: publishedRevisionIds.map((item) => toObjectIdOrNull(item)).filter(Boolean),
            firstReferencedAt: nextFirstReferencedAt,
            lastReferencedAt: nextLastReferencedAt
          }
        }
      }
    };
  });

  if (operations.length > 0) {
    await SenseArticleMediaAsset.bulkWrite(operations);
  }

  const summary = (Array.isArray(assets) ? assets : []).reduce((acc, asset) => {
    const assetId = getIdString(asset._id);
    const status = resolveAssetUsageStatus({ asset, referencedRevisionIds: Array.from(referenceMap.get(assetId) || []) });
    acc.total += 1;
    acc[status] += 1;
    return acc;
  }, { total: 0, uploaded: 0, active: 0, orphan_candidate: 0 });

  return summary;
};

const listMediaAssetsForEditor = async ({ nodeId = '', senseId = '', articleId = null, revisionId = '', recentLimit = 12 } = {}) => {
  const filter = articleId
    ? { articleId }
    : { nodeId: toObjectIdOrNull(nodeId), senseId: String(senseId || '').trim() };
  const [recentAssets, revision] = await Promise.all([
    SenseArticleMediaAsset.find(filter).sort({ createdAt: -1 }).limit(Math.max(1, Math.min(24, Number(recentLimit) || 12))).lean(),
    revisionId ? SenseArticleRevision.findById(revisionId).select('_id mediaReferences').lean() : Promise.resolve(null)
  ]);
  const referencedAssetIds = new Set((Array.isArray(revision?.mediaReferences) ? revision.mediaReferences : []).map((item) => getIdString(item?.assetId)).filter(Boolean));
  const referencedAssets = referencedAssetIds.size > 0
    ? await SenseArticleMediaAsset.find({ _id: { $in: Array.from(referencedAssetIds).map((item) => toObjectIdOrNull(item)).filter(Boolean) } }).sort({ updatedAt: -1 }).lean()
    : [];
  const orphanCandidates = await SenseArticleMediaAsset.find({
    ...filter,
    status: { $in: ['uploaded', 'orphan_candidate'] }
  }).sort({ updatedAt: -1 }).limit(8).lean();
  return {
    referencedAssets,
    recentAssets,
    orphanCandidates
  };
};

const scanOrphanMediaAssets = async ({ articleId = null, nodeId = '', senseId = '', sampleLimit = 20 } = {}) => {
  await refreshArticleMediaReferenceState({ articleId, nodeId, senseId });
  const filter = articleId
    ? { articleId }
    : { nodeId: toObjectIdOrNull(nodeId), senseId: String(senseId || '').trim() };
  const assets = await SenseArticleMediaAsset.find(filter).sort({ updatedAt: -1, createdAt: -1 }).lean();
  return summarizeMediaUsageAudit({ assets, sampleLimit });
};

module.exports = {
  extractMediaReferencesFromRevision,
  hydrateMediaReferenceAssets,
  listMediaAssetsForEditor,
  refreshArticleMediaReferenceState,
  resolveAssetUsageStatus,
  summarizeMediaUsageAudit,
  scanOrphanMediaAssets
};
