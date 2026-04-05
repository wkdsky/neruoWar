const mongoose = require('mongoose');
const { createChatModel } = require('../config/chatDatabase');

const FRIENDSHIP_STATUSES = ['pending', 'accepted', 'rejected', 'blocked'];

const FriendshipSchema = new mongoose.Schema({
  requesterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  addresseeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  participantsKey: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: FRIENDSHIP_STATUSES,
    default: 'pending'
  },
  requestMessage: {
    type: String,
    default: ''
  },
  remarkByRequester: {
    type: String,
    default: ''
  },
  remarkByAddressee: {
    type: String,
    default: ''
  },
  acceptedAt: {
    type: Date,
    default: null
  },
  respondedAt: {
    type: Date,
    default: null
  },
  messageQuotaResetSeq: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

FriendshipSchema.index({ participantsKey: 1 }, { unique: true });
FriendshipSchema.index({ addresseeId: 1, status: 1, createdAt: -1 });
FriendshipSchema.index({ requesterId: 1, status: 1, createdAt: -1 });

module.exports = createChatModel('Friendship', FriendshipSchema);
