const mongoose = require('mongoose');
const {
  ARTICLE_RENDER_VERSION,
  ARTICLE_SEARCH_VERSION,
  ARTICLE_TOC_VERSION
} = require('../constants/senseArticle');

const SenseArticleSchema = new mongoose.Schema({
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
  articleKey: {
    type: String,
    default: '',
    trim: true
  },
  currentRevisionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SenseArticleRevision',
    default: null
  },
  latestDraftRevisionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SenseArticleRevision',
    default: null
  },
  summary: {
    type: String,
    default: '',
    trim: true
  },
  tocVersion: {
    type: Number,
    default: ARTICLE_TOC_VERSION
  },
  renderVersion: {
    type: Number,
    default: ARTICLE_RENDER_VERSION
  },
  searchVersion: {
    type: Number,
    default: ARTICLE_SEARCH_VERSION
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  publishedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

SenseArticleSchema.index({ nodeId: 1, senseId: 1 }, { unique: true });
SenseArticleSchema.index({ currentRevisionId: 1 });

module.exports = mongoose.model('SenseArticle', SenseArticleSchema);
