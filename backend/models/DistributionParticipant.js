const mongoose = require('mongoose');

const DistributionParticipantSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  executeAt: {
    type: Date,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  joinedAt: {
    type: Date,
    required: true
  },
  exitedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

DistributionParticipantSchema.index({ nodeId: 1, executeAt: 1, userId: 1 }, { unique: true });
DistributionParticipantSchema.index({ nodeId: 1, executeAt: 1, exitedAt: 1 });
DistributionParticipantSchema.index({ userId: 1, joinedAt: -1 });

module.exports = mongoose.model('DistributionParticipant', DistributionParticipantSchema);

