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
