const mongoose = require('mongoose');

const KnowledgePointSchema = new mongoose.Schema({
  value: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: null
  }
}, { _id: false });

const DomainTitleProjectionSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  domainMaster: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  domainAdmins: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    default: []
  },
  allianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    default: null
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: '',
    trim: true
  },
  relatedParentDomains: {
    type: [String],
    default: []
  },
  relatedChildDomains: {
    type: [String],
    default: []
  },
  contentScore: {
    type: Number,
    default: 1
  },
  knowledgePoint: {
    type: KnowledgePointSchema,
    default: () => ({ value: 0, lastUpdated: null })
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'approved'
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  featuredOrder: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUpdate: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

DomainTitleProjectionSchema.index({ nodeId: 1 }, { unique: true });
DomainTitleProjectionSchema.index({ status: 1, name: 1, nodeId: 1 });
DomainTitleProjectionSchema.index({ status: 1, isFeatured: 1, featuredOrder: 1, createdAt: -1 });
DomainTitleProjectionSchema.index({ status: 1, relatedParentDomains: 1 });
DomainTitleProjectionSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('DomainTitleProjection', DomainTitleProjectionSchema);
