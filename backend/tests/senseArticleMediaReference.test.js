const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractMediaReferencesFromRevision,
  resolveAssetUsageStatus,
  summarizeMediaUsageAudit
} = require('../services/senseArticleMediaReferenceService');

test('media reference extraction keeps revision block relations', () => {
  const references = extractMediaReferencesFromRevision({
    nodeId: 'node_1',
    senseId: 'sense_1',
    revision: {
      _id: 'rev_1',
      ast: {
        blocks: [
          {
            id: 'image_1',
            type: 'image',
            headingId: 'intro',
            html: '<figure data-node-type="image"><img src="/uploads/sense-article-media/image.png" alt="示意图" width="75%" /><figcaption>图片说明</figcaption></figure>'
          },
          {
            id: 'audio_1',
            type: 'audio',
            headingId: 'intro',
            html: '<figure data-node-type="audio"><audio src="/uploads/sense-article-media/audio.mp3" controls data-title="语音说明"></audio><figcaption>语音说明</figcaption></figure>'
          }
        ]
      }
    }
  });

  assert.equal(references.length, 2);
  assert.equal(references[0].blockId, 'image_1');
  assert.equal(references[0].kind, 'image');
  assert.equal(references[1].kind, 'audio');
});

test('asset usage status distinguishes uploaded active and orphan candidate', () => {
  assert.equal(resolveAssetUsageStatus({ asset: {}, referencedRevisionIds: [] }), 'uploaded');
  assert.equal(resolveAssetUsageStatus({ asset: { firstReferencedAt: new Date().toISOString() }, referencedRevisionIds: [] }), 'orphan_candidate');
  assert.equal(resolveAssetUsageStatus({ asset: {}, referencedRevisionIds: ['rev_1'] }), 'active');
});

test('media usage audit summary groups uploaded active and orphan candidates', () => {
  const result = summarizeMediaUsageAudit({
    sampleLimit: 2,
    assets: [
      { _id: 'asset_uploaded', kind: 'image', url: '/uploads/sense-article-media/uploaded.png', fileSize: 10 },
      {
        _id: 'asset_active',
        kind: 'audio',
        url: '/uploads/sense-article-media/active.mp3',
        fileSize: 20,
        referencedRevisionIds: ['rev_1']
      },
      {
        _id: 'asset_orphan',
        kind: 'video',
        url: '/uploads/sense-article-media/orphan.mp4',
        fileSize: 30,
        firstReferencedAt: new Date().toISOString(),
        referencedRevisionIds: []
      }
    ]
  });

  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.uploaded, 1);
  assert.equal(result.summary.active, 1);
  assert.equal(result.summary.orphan_candidate, 1);
  assert.equal(result.summary.totalBytes, 60);
  assert.equal(result.uploadedAssets[0].assetId, 'asset_uploaded');
  assert.equal(result.activeAssets[0].assetId, 'asset_active');
  assert.equal(result.orphanCandidates[0].assetId, 'asset_orphan');
});
