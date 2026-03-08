const mongoose = require('mongoose');
const {
  ANCHOR_TYPES,
  ANNOTATION_VISIBILITIES
} = require('../constants/senseArticle');

const AnnotationAnchorSchema = new mongoose.Schema({
  revisionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SenseArticleRevision',
    default: null
  },
  headingId: {
    type: String,
    default: '',
    trim: true
  },
  blockId: {
    type: String,
    default: '',
    trim: true
  },
  blockHash: {
    type: String,
    default: '',
    trim: true
  },
  textQuote: {
    type: String,
    default: '',
    trim: true
  },
  selectionText: {
    type: String,
    default: '',
    trim: true
  },
  selectedTextHash: {
    type: String,
    default: '',
    trim: true
  },
  prefixText: {
    type: String,
    default: '',
    trim: true
  },
  suffixText: {
    type: String,
    default: '',
    trim: true
  },
  textPositionStart: {
    type: Number,
    default: null
  },
  textPositionEnd: {
    type: Number,
    default: null
  }
}, { _id: false });

const SenseAnnotationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
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
    required: true
  },
  revisionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SenseArticleRevision',
    default: null
  },
  anchorType: {
    type: String,
    enum: ANCHOR_TYPES,
    default: 'text_range'
  },
  anchor: {
    type: AnnotationAnchorSchema,
    required: true
  },
  highlightColor: {
    type: String,
    default: '#fde68a',
    trim: true
  },
  note: {
    type: String,
    default: '',
    trim: true
  },
  visibility: {
    type: String,
    enum: ANNOTATION_VISIBILITIES,
    default: 'private'
  }
}, {
  timestamps: true
});

SenseAnnotationSchema.index({ userId: 1, articleId: 1, updatedAt: -1 });
SenseAnnotationSchema.index({ userId: 1, nodeId: 1, senseId: 1, createdAt: -1 });

module.exports = mongoose.model('SenseAnnotation', SenseAnnotationSchema);
