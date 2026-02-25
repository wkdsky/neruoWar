const mongoose = require('mongoose');

const SiegeBattleRecordSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  gateKey: {
    type: String,
    enum: ['cheng', 'qi'],
    required: true,
    index: true
  },
  battleId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  attackerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  attackerAllianceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true
  },
  startedAt: {
    type: Date,
    default: null
  },
  endedAt: {
    type: Date,
    required: true,
    index: true
  },
  durationSec: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  attacker: {
    start: { type: Number, min: 0, default: 0 },
    remain: { type: Number, min: 0, default: 0 },
    kills: { type: Number, min: 0, default: 0 }
  },
  defender: {
    start: { type: Number, min: 0, default: 0 },
    remain: { type: Number, min: 0, default: 0 },
    kills: { type: Number, min: 0, default: 0 }
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  minimize: false
});

SiegeBattleRecordSchema.index({ nodeId: 1, gateKey: 1, endedAt: -1 });
SiegeBattleRecordSchema.index({ attackerUserId: 1, endedAt: -1 });

module.exports = mongoose.model('SiegeBattleRecord', SiegeBattleRecordSchema);
