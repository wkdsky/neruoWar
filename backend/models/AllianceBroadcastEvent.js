const mongoose = require('mongoose');

const AllianceBroadcastEventSchema = new mongoose.Schema({
  allianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['announcement', 'siege_support_request'],
    required: true
  },
  actorUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  actorUsername: {
    type: String,
    default: ''
  },
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    default: null
  },
  nodeName: {
    type: String,
    default: ''
  },
  gateKey: {
    type: String,
    enum: ['', 'cheng', 'qi'],
    default: ''
  },
  title: {
    type: String,
    default: ''
  },
  message: {
    type: String,
    default: ''
  },
  dedupeKey: {
    type: String,
    default: null,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

AllianceBroadcastEventSchema.index({ allianceId: 1, createdAt: -1, _id: -1 });
AllianceBroadcastEventSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('AllianceBroadcastEvent', AllianceBroadcastEventSchema);
