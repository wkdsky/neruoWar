const mongoose = require('mongoose');

const KnowledgeBrocadeSchema = new mongoose.Schema({
  ownerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80
  },
  rootNodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnowledgeBrocadeNode',
    default: null
  },
  nodeCount: {
    type: Number,
    default: 1,
    min: 1
  },
  lastOpenedAt: {
    type: Date,
    default: null
  },
  archivedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

KnowledgeBrocadeSchema.index({ ownerUserId: 1, updatedAt: -1 });
KnowledgeBrocadeSchema.index({ ownerUserId: 1, name: 1 });

module.exports = mongoose.models.KnowledgeBrocade || mongoose.model('KnowledgeBrocade', KnowledgeBrocadeSchema);
