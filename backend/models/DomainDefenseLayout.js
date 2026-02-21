const mongoose = require('mongoose');

const CITY_BUILDING_DEFAULT_RADIUS = 0.17;

const CityBuildingSchema = new mongoose.Schema({
  buildingId: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    default: '',
    trim: true
  },
  x: {
    type: Number,
    required: true,
    min: -1,
    max: 1
  },
  y: {
    type: Number,
    required: true,
    min: -1,
    max: 1
  },
  radius: {
    type: Number,
    default: CITY_BUILDING_DEFAULT_RADIUS,
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
    default: null
  }
}, { _id: false });

const CityGateDefenseEntrySchema = new mongoose.Schema({
  unitTypeId: {
    type: String,
    required: true,
    trim: true
  },
  count: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: false });

const CityGateDefenseSchema = new mongoose.Schema({
  cheng: {
    type: [CityGateDefenseEntrySchema],
    default: []
  },
  qi: {
    type: [CityGateDefenseEntrySchema],
    default: []
  }
}, { _id: false });

const DomainDefenseLayoutSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  buildings: {
    type: [CityBuildingSchema],
    default: []
  },
  intelBuildingId: {
    type: String,
    default: ''
  },
  gateDefense: {
    type: CityGateDefenseSchema,
    default: () => ({ cheng: [], qi: [] })
  },
  gateDefenseViewAdminIds: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    default: []
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

DomainDefenseLayoutSchema.index({ nodeId: 1 }, { unique: true });
DomainDefenseLayoutSchema.index({ updatedAt: -1 });
DomainDefenseLayoutSchema.index({ gateDefenseViewAdminIds: 1, updatedAt: -1 });

module.exports = mongoose.model('DomainDefenseLayout', DomainDefenseLayoutSchema);
