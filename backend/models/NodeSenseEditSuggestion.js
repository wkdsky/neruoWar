const mongoose = require('mongoose');

const NodeSenseEditSuggestionSchema = new mongoose.Schema({
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
  proposerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  proposedTitle: {
    type: String,
    default: '',
    trim: true
  },
  proposedContent: {
    type: String,
    default: '',
    trim: true
  },
  reason: {
    type: String,
    default: '',
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  reviewerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewComment: {
    type: String,
    default: '',
    trim: true
  },
  reviewedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

NodeSenseEditSuggestionSchema.index({ nodeId: 1, senseId: 1, status: 1, createdAt: -1 });
NodeSenseEditSuggestionSchema.index({ proposerId: 1, createdAt: -1 });

module.exports = mongoose.model('NodeSenseEditSuggestion', NodeSenseEditSuggestionSchema);
