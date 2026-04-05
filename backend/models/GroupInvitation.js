const mongoose = require('mongoose');
const { createChatModel } = require('../config/chatDatabase');

const GROUP_INVITATION_STATUSES = ['pending', 'accepted', 'rejected', 'ignored'];

const GroupInvitationSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  inviterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  inviteeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: GROUP_INVITATION_STATUSES,
    default: 'pending'
  },
  respondedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

GroupInvitationSchema.index({ conversationId: 1, inviteeId: 1 }, { unique: true });
GroupInvitationSchema.index({ inviteeId: 1, status: 1, updatedAt: -1 });
GroupInvitationSchema.index({ conversationId: 1, status: 1, updatedAt: -1 });

module.exports = createChatModel('GroupInvitation', GroupInvitationSchema);
