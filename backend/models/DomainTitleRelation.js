const mongoose = require('mongoose');

const DomainTitleRelationSchema = new mongoose.Schema({
  sourceNodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  targetNodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  relationType: {
    type: String,
    enum: ['contains', 'extends'],
    required: true
  },
  sourceSenseId: {
    type: String,
    default: '',
    trim: true
  },
  targetSenseId: {
    type: String,
    default: '',
    trim: true
  },
  insertSide: {
    type: String,
    default: '',
    trim: true
  },
  insertGroupId: {
    type: String,
    default: '',
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active'
  }
}, {
  timestamps: true
});

DomainTitleRelationSchema.index({
  sourceNodeId: 1,
  targetNodeId: 1,
  relationType: 1,
  sourceSenseId: 1,
  targetSenseId: 1
}, {
  unique: true,
  name: 'uniq_domain_title_relation'
});
DomainTitleRelationSchema.index({ sourceNodeId: 1, relationType: 1, status: 1 });
DomainTitleRelationSchema.index({ targetNodeId: 1, relationType: 1, status: 1 });
DomainTitleRelationSchema.index({ sourceNodeId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('DomainTitleRelation', DomainTitleRelationSchema);
