const mongoose = require('mongoose');

const NodeSenseCommentSchema = new mongoose.Schema({
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
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  replyToCommentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'NodeSenseComment',
    default: null
  },
  status: {
    type: String,
    enum: ['visible', 'deleted'],
    default: 'visible'
  }
}, {
  timestamps: true
});

NodeSenseCommentSchema.index({ nodeId: 1, senseId: 1, status: 1, createdAt: -1 });
NodeSenseCommentSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('NodeSenseComment', NodeSenseCommentSchema);
