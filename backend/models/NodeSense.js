const mongoose = require('mongoose');

const NodeSenseSchema = new mongoose.Schema({
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
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  contentFormat: {
    type: String,
    enum: ['legacy_markup', 'rich_html'],
    default: 'legacy_markup'
  },
  legacySummary: {
    type: String,
    default: '',
    trim: true
  },
  order: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active'
  },
  // 写入水位线（审计用途）：与 Node.senseWatermark 对齐，便于追踪一次写批次。
  watermark: {
    type: String,
    default: '',
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

NodeSenseSchema.index({ nodeId: 1, senseId: 1 }, { unique: true });
NodeSenseSchema.index({ nodeId: 1, order: 1, senseId: 1 });
NodeSenseSchema.index({ nodeId: 1, title: 1 });
NodeSenseSchema.index({ title: 'text', content: 'text' });

module.exports = mongoose.model('NodeSense', NodeSenseSchema);
