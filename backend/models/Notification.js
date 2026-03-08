const mongoose = require('mongoose');
const { NOTIFICATION_STATUSES, NOTIFICATION_TYPES } = require('../constants/senseArticle');

const NotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: NOTIFICATION_TYPES,
    default: 'info'
  },
  title: {
    type: String,
    default: ''
  },
  message: {
    type: String,
    default: ''
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  read: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: NOTIFICATION_STATUSES,
    default: 'info'
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
  allianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    default: null
  },
  allianceName: {
    type: String,
    default: ''
  },
  inviterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  inviterUsername: {
    type: String,
    default: ''
  },
  inviteeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  inviteeUsername: {
    type: String,
    default: ''
  },
  applicationReason: {
    type: String,
    default: ''
  },
  requiresArrival: {
    type: Boolean,
    default: false
  },
  respondedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, type: 1, status: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, type: 1, status: 1, allianceId: 1, inviteeId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
