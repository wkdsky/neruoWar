const mongoose = require('mongoose');

const UnitComponentKindEnum = [
  'body',
  'weapon',
  'vehicle',
  'ability',
  'behaviorProfile',
  'stabilityProfile',
  'staggerReaction',
  'interactionRule'
];

const UnitComponentSchema = new mongoose.Schema({
  componentId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  kind: {
    type: String,
    enum: UnitComponentKindEnum,
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  tags: {
    type: [String],
    default: []
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  version: {
    type: Number,
    default: 1,
    min: 1
  }
}, {
  timestamps: true
});

UnitComponentSchema.index({ kind: 1, createdAt: -1 });

module.exports = mongoose.model('UnitComponent', UnitComponentSchema);
