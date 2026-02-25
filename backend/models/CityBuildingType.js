const mongoose = require('mongoose');

const CityBuildingTypeSchema = new mongoose.Schema({
  buildingTypeId: {
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
  radius: {
    type: Number,
    default: 0.17,
    min: 0.1,
    max: 0.24
  },
  level: {
    type: Number,
    default: 1,
    min: 1
  },
  nextUnitTypeId: {
    type: String,
    default: ''
  },
  upgradeCostKP: {
    type: Number,
    default: null,
    min: 0
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

CityBuildingTypeSchema.index({ sortOrder: 1, createdAt: 1 });

module.exports = mongoose.model('CityBuildingType', CityBuildingTypeSchema);
