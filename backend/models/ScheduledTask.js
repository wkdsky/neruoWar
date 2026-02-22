const mongoose = require('mongoose');

const ScheduledTaskSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    trim: true
  },
  runAt: {
    type: Date,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['ready', 'running', 'done', 'failed'],
    default: 'ready',
    index: true
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({})
  },
  dedupeKey: {
    type: String,
    default: null,
    trim: true
  },
  lockOwner: {
    type: String,
    default: ''
  },
  lockedUntil: {
    type: Date,
    default: null
  },
  attempts: {
    type: Number,
    default: 0,
    min: 0
  },
  lastError: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

ScheduledTaskSchema.index({ status: 1, runAt: 1 });
ScheduledTaskSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
ScheduledTaskSchema.index({ lockedUntil: 1 });

module.exports = mongoose.model('ScheduledTask', ScheduledTaskSchema);
