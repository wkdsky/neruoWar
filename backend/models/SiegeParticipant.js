const mongoose = require('mongoose');

const SiegeParticipantUnitSchema = new mongoose.Schema({
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

const SiegeParticipantSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  gateKey: {
    type: String,
    enum: ['cheng', 'qi'],
    required: true
  },
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
    type: [SiegeParticipantUnitSchema],
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
}, {
  timestamps: true
});

SiegeParticipantSchema.index({ nodeId: 1, gateKey: 1, userId: 1 }, { unique: true });
SiegeParticipantSchema.index({ nodeId: 1, gateKey: 1, status: 1, updatedAt: -1 });
SiegeParticipantSchema.index({ nodeId: 1, gateKey: 1, updatedAt: -1, _id: -1 });
SiegeParticipantSchema.index({ allianceId: 1, status: 1, updatedAt: -1 });
SiegeParticipantSchema.index({ userId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('SiegeParticipant', SiegeParticipantSchema);
