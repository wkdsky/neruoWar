const mongoose = require('mongoose');

const CitySiegeUnitEntrySchema = new mongoose.Schema({
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

const CitySiegeAttackerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    default: ''
  },
  allianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    default: null
  },
  units: {
    type: [CitySiegeUnitEntrySchema],
    default: []
  },
  fromNodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    default: null
  },
  fromNodeName: {
    type: String,
    default: ''
  },
  autoRetreatPercent: {
    type: Number,
    default: 40,
    min: 1,
    max: 99
  },
  status: {
    type: String,
    enum: ['moving', 'sieging', 'retreated'],
    default: 'sieging'
  },
  isInitiator: {
    type: Boolean,
    default: false
  },
  isReinforcement: {
    type: Boolean,
    default: false
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  arriveAt: {
    type: Date,
    default: null
  },
  joinedAt: {
    type: Date,
    default: null
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const CitySiegeGateStateSchema = new mongoose.Schema({
  active: {
    type: Boolean,
    default: false
  },
  startedAt: {
    type: Date,
    default: null
  },
  updatedAt: {
    type: Date,
    default: null
  },
  supportNotifiedAt: {
    type: Date,
    default: null
  },
  attackerAllianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    default: null
  },
  initiatorUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  initiatorUsername: {
    type: String,
    default: ''
  },
  attackers: {
    type: [CitySiegeAttackerSchema],
    default: []
  }
}, { _id: false });

const DomainSiegeStateSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  cheng: {
    type: CitySiegeGateStateSchema,
    default: () => ({})
  },
  qi: {
    type: CitySiegeGateStateSchema,
    default: () => ({})
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

DomainSiegeStateSchema.index({ nodeId: 1 }, { unique: true });
DomainSiegeStateSchema.index({ 'cheng.attackers.userId': 1, updatedAt: -1 });
DomainSiegeStateSchema.index({ 'qi.attackers.userId': 1, updatedAt: -1 });
DomainSiegeStateSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('DomainSiegeState', DomainSiegeStateSchema);
