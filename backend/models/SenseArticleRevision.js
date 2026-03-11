const mongoose = require('mongoose');
const {
  REVISION_DECISIONS,
  REVISION_FINAL_DECISIONS,
  REVISION_REVIEW_STAGES,
  REVISION_SOURCE_MODES,
  REVISION_STATUSES
} = require('../constants/senseArticle');


const ReviewParticipantSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['domain_master', 'domain_admin', 'system_admin'],
    default: 'domain_admin'
  }
}, { _id: false });

const ReviewVoteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['domain_master', 'domain_admin', 'system_admin'],
    default: 'domain_admin'
  },
  decision: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  comment: {
    type: String,
    default: '',
    trim: true
  },
  reviewedAt: {
    type: Date,
    default: null
  }
}, { _id: false });

const AnchorSchema = new mongoose.Schema({
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

const SenseArticleRevisionSchema = new mongoose.Schema({
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
  revisionNumber: {
    type: Number,
    required: true,
    min: 1
  },
  baseRevisionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SenseArticleRevision',
    default: null
  },
  parentRevisionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SenseArticleRevision',
    default: null
  },
  sourceMode: {
    type: String,
    enum: REVISION_SOURCE_MODES,
    default: 'full'
  },
  selectedRangeAnchor: {
    type: AnchorSchema,
    default: null
  },
  targetHeadingId: {
    type: String,
    default: '',
    trim: true
  },
  editorSource: {
    type: String,
    default: '',
    trim: true
  },
  contentFormat: {
    type: String,
    enum: ['legacy_markup', 'rich_html'],
    default: 'legacy_markup'
  },
  ast: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  headingIndex: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  referenceIndex: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  formulaRefs: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  symbolRefs: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  parseErrors: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  plainTextSnapshot: {
    type: String,
    default: '',
    trim: true
  },
  renderSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  diffFromBase: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  mediaReferences: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  validationSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  scopedChange: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  proposerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  proposerNote: {
    type: String,
    default: '',
    trim: true
  },
  revisionTitle: {
    type: String,
    default: '',
    trim: true
  },
  proposedSenseTitle: {
    type: String,
    default: '',
    trim: true
  },
  status: {
    type: String,
    enum: REVISION_STATUSES,
    default: 'draft'
  },
  reviewStage: {
    type: String,
    enum: REVISION_REVIEW_STAGES,
    default: 'domain_admin'
  },
  domainAdminDecision: {
    type: String,
    enum: REVISION_DECISIONS,
    default: 'pending'
  },
  domainAdminReviewerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  domainAdminReviewedAt: {
    type: Date,
    default: null
  },
  domainAdminComment: {
    type: String,
    default: '',
    trim: true
  },
  domainMasterDecision: {
    type: String,
    enum: REVISION_DECISIONS,
    default: 'pending'
  },
  domainMasterReviewerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  domainMasterReviewedAt: {
    type: Date,
    default: null
  },
  domainMasterComment: {
    type: String,
    default: '',
    trim: true
  },
  reviewParticipants: {
    type: [ReviewParticipantSchema],
    default: []
  },
  reviewVotes: {
    type: [ReviewVoteSchema],
    default: []
  },
  finalDecision: {
    type: String,
    enum: REVISION_FINAL_DECISIONS,
    default: null
  },
  finalDecisionAt: {
    type: Date,
    default: null
  },
  publishedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  publishedAt: {
    type: Date,
    default: null
  },
  supersededByRevisionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SenseArticleRevision',
    default: null
  }
}, {
  timestamps: true
});

SenseArticleRevisionSchema.index({ articleId: 1, revisionNumber: -1 }, { unique: true });
SenseArticleRevisionSchema.index({ nodeId: 1, senseId: 1, status: 1, createdAt: -1 });
SenseArticleRevisionSchema.index({ proposerId: 1, createdAt: -1 });
SenseArticleRevisionSchema.index({ baseRevisionId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('SenseArticleRevision', SenseArticleRevisionSchema);
