const mongoose = require('mongoose');

const DistributionResultSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  executeAt: {
    type: Date,
    required: true
  },
  lockId: {
    type: String,
    default: ''
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    default: 0,
    min: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

DistributionResultSchema.index({ nodeId: 1, executeAt: -1, userId: 1 }, { unique: true });
DistributionResultSchema.index({ userId: 1, createdAt: -1 });
DistributionResultSchema.index({ nodeId: 1, executeAt: -1, createdAt: -1, _id: -1 });
DistributionResultSchema.index({ userId: 1, createdAt: -1, _id: -1 });
DistributionResultSchema.index({ lockId: 1, userId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('DistributionResult', DistributionResultSchema);
