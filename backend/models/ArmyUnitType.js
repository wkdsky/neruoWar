const mongoose = require('mongoose');

const ArmyUnitTypeSchema = new mongoose.Schema({
  unitTypeId: {
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
  roleTag: {
    type: String,
    enum: ['近战', '远程'],
    required: true
  },
  speed: {
    type: Number,
    required: true,
    min: 0
  },
  hp: {
    type: Number,
    required: true,
    min: 1
  },
  atk: {
    type: Number,
    required: true,
    min: 0
  },
  def: {
    type: Number,
    required: true,
    min: 0
  },
  range: {
    type: Number,
    required: true,
    min: 1
  },
  costKP: {
    type: Number,
    required: true,
    min: 1
  },
  level: {
    type: Number,
    default: 1,
    min: 1
  },
  nextUnitTypeId: {
    type: String,
    default: null
  },
  upgradeCostKP: {
    type: Number,
    default: null,
    min: 0
  },
  sortOrder: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

ArmyUnitTypeSchema.index({ unitTypeId: 1 }, { unique: true });
ArmyUnitTypeSchema.index({ sortOrder: 1, createdAt: 1 });

module.exports = mongoose.model('ArmyUnitType', ArmyUnitTypeSchema);
