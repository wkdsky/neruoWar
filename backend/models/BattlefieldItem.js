const mongoose = require('mongoose');

const BattlefieldItemSchema = new mongoose.Schema({
  itemId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: '',
    trim: true
  },
  initialCount: {
    type: Number,
    default: 0,
    min: 0
  },
  width: {
    type: Number,
    required: true,
    min: 12,
    max: 360
  },
  depth: {
    type: Number,
    required: true,
    min: 12,
    max: 360
  },
  height: {
    type: Number,
    required: true,
    min: 10,
    max: 360
  },
  hp: {
    type: Number,
    required: true,
    min: 1
  },
  defense: {
    type: Number,
    required: true,
    min: 0.1
  },
  style: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  collider: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  renderProfile: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  interactions: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  sockets: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  maxStack: {
    type: Number,
    default: null,
    min: 1,
    max: 31
  },
  requiresSupport: {
    type: Boolean,
    default: false
  },
  snapPriority: {
    type: Number,
    default: 0
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  enabled: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

BattlefieldItemSchema.index({ sortOrder: 1, createdAt: 1 });

module.exports = mongoose.model('BattlefieldItem', BattlefieldItemSchema);
