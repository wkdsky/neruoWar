const mongoose = require('mongoose');
const { createChatModel } = require('../config/chatDatabase');

const CONVERSATION_MEMBER_ROLES = ['owner', 'admin', 'member'];

const ConversationMemberSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: CONVERSATION_MEMBER_ROLES,
    default: 'member'
  },
  nicknameInGroup: {
    type: String,
    default: ''
  },
  mute: {
    type: Boolean,
    default: false
  },
  pinned: {
    type: Boolean,
    default: false
  },
  lastReadSeq: {
    type: Number,
    default: 0,
    min: 0
  },
  unreadCount: {
    type: Number,
    default: 0,
    min: 0
  },
  isVisible: {
    type: Boolean,
    default: true
  },
  deletedAt: {
    type: Date,
    default: null
  },
  clearedBeforeSeq: {
    type: Number,
    default: 0,
    min: 0
  },
  clearedAt: {
    type: Date,
    default: null
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  leftAt: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

ConversationMemberSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
ConversationMemberSchema.index({ userId: 1, isActive: 1, isVisible: 1, updatedAt: -1 });
ConversationMemberSchema.index({ userId: 1, isActive: 1, unreadCount: -1, updatedAt: -1 });
ConversationMemberSchema.index({ conversationId: 1, isActive: 1, role: 1 });

module.exports = createChatModel('ConversationMember', ConversationMemberSchema);
