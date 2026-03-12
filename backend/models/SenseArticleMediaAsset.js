const mongoose = require('mongoose');

const SenseArticleMediaAssetSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  senseId: {
    type: String,
    required: true,
    trim: true
  },
  articleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SenseArticle',
    default: null
  },
  revisionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SenseArticleRevision',
    default: null
  },
  kind: {
    type: String,
    enum: ['image', 'audio', 'video'],
    required: true
  },
  originalName: {
    type: String,
    default: '',
    trim: true
  },
  fileName: {
    type: String,
    required: true,
    trim: true
  },
  storagePath: {
    type: String,
    required: true,
    trim: true
  },
  url: {
    type: String,
    required: true,
    trim: true
  },
  mimeType: {
    type: String,
    default: '',
    trim: true
  },
  size: {
    type: Number,
    default: 0,
    min: 0
  },
  fileSize: {
    type: Number,
    default: 0,
    min: 0
  },
  width: {
    type: Number,
    default: null,
    min: 0
  },
  height: {
    type: Number,
    default: null,
    min: 0
  },
  duration: {
    type: Number,
    default: null,
    min: 0
  },
  alt: {
    type: String,
    default: '',
    trim: true
  },
  caption: {
    type: String,
    default: '',
    trim: true
  },
  title: {
    type: String,
    default: '',
    trim: true
  },
  description: {
    type: String,
    default: '',
    trim: true
  },
  posterUrl: {
    type: String,
    default: '',
    trim: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['uploaded', 'active', 'orphan_candidate'],
    default: 'uploaded'
  },
  firstReferencedAt: {
    type: Date,
    default: null
  },
  lastReferencedAt: {
    type: Date,
    default: null
  },
  referencedRevisionIds: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'SenseArticleRevision',
    default: []
  },
  publishedRevisionIds: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'SenseArticleRevision',
    default: []
  },
  isTemporary: {
    type: Boolean,
    default: false
  },
  tempSessionId: {
    type: String,
    default: '',
    trim: true
  },
  tempExpiresAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

SenseArticleMediaAssetSchema.index({ nodeId: 1, senseId: 1, createdAt: -1 });
SenseArticleMediaAssetSchema.index({ articleId: 1, createdAt: -1 });
SenseArticleMediaAssetSchema.index({ revisionId: 1, createdAt: -1 });
SenseArticleMediaAssetSchema.index({ articleId: 1, status: 1, createdAt: -1 });
SenseArticleMediaAssetSchema.index({ nodeId: 1, senseId: 1, url: 1 });
SenseArticleMediaAssetSchema.index({ isTemporary: 1, tempExpiresAt: 1 });
SenseArticleMediaAssetSchema.index({ articleId: 1, tempSessionId: 1, isTemporary: 1 });

module.exports = mongoose.model('SenseArticleMediaAsset', SenseArticleMediaAssetSchema);
