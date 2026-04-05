const mongoose = require('mongoose');

const KnowledgeBrocadeNodeSchema = new mongoose.Schema({
  brocadeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnowledgeBrocade',
    required: true,
    index: true
  },
  ownerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  parentNodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnowledgeBrocadeNode',
    default: null
  },
  isRoot: {
    type: Boolean,
    default: false
  },
  isStarred: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: '未命名节点',
    trim: true,
    maxlength: 80
  },
  previewText: {
    type: String,
    default: '',
    trim: true,
    maxlength: 240
  },
  contentText: {
    type: String,
    default: '',
    maxlength: 200000
  },
  position: {
    x: {
      type: Number,
      default: 0
    },
    y: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

KnowledgeBrocadeNodeSchema.index({ brocadeId: 1, parentNodeId: 1, createdAt: 1 });
KnowledgeBrocadeNodeSchema.index({ ownerUserId: 1, brocadeId: 1, updatedAt: -1 });

module.exports = mongoose.models.KnowledgeBrocadeNode || mongoose.model('KnowledgeBrocadeNode', KnowledgeBrocadeNodeSchema);
