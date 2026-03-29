const mongoose = require('mongoose');
const { createChatModel } = require('../config/chatDatabase');

const CONVERSATION_TYPES = ['direct', 'group'];

const ConversationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: CONVERSATION_TYPES,
    required: true
  },
  title: {
    type: String,
    default: ''
  },
  announcement: {
    type: String,
    default: ''
  },
  announcementUpdatedAt: {
    type: Date,
    default: null
  },
  announcementUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  avatar: {
    type: String,
    default: ''
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  directKey: {
    type: String,
    default: ''
  },
  memberCount: {
    type: Number,
    default: 0,
    min: 0
  },
  lastMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  lastMessagePreview: {
    type: String,
    default: ''
  },
  lastMessageAt: {
    type: Date,
    default: null
  },
  messageSeq: {
    type: Number,
    default: 0,
    min: 0
  },
  isArchived: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

ConversationSchema.index(
  { type: 1, directKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'direct',
      directKey: { $exists: true, $type: 'string', $ne: '' }
    }
  }
);
ConversationSchema.index({ lastMessageAt: -1, updatedAt: -1 });
ConversationSchema.index({ type: 1, lastMessageAt: -1 });
ConversationSchema.index({ type: 1, memberCount: 1, updatedAt: -1 });

module.exports = createChatModel('Conversation', ConversationSchema);
