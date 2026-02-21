const mongoose = require('mongoose');

const NodeSenseFavoriteSchema = new mongoose.Schema({
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
  }
}, {
  timestamps: true
});

NodeSenseFavoriteSchema.index({ nodeId: 1, senseId: 1, userId: 1 }, { unique: true });
NodeSenseFavoriteSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('NodeSenseFavorite', NodeSenseFavoriteSchema);
