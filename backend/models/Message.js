const mongoose = require('mongoose');
const { createChatModel } = require('../config/chatDatabase');

const MESSAGE_TYPES = ['text', 'system'];

const MessageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  seq: {
    type: Number,
    required: true,
    min: 1
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: MESSAGE_TYPES,
    default: 'text'
  },
  content: {
    type: String,
    default: ''
  },
  mentions: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },
  clientMessageId: {
    type: String,
    default: ''
  },
  editedAt: {
    type: Date,
    default: null
  },
  recalledAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

MessageSchema.index({ conversationId: 1, seq: 1 }, { unique: true });
MessageSchema.index({ conversationId: 1, seq: -1 });
MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1, createdAt: -1 });
MessageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      clientMessageId: { $exists: true, $type: 'string', $ne: '' }
    }
  }
);

module.exports = createChatModel('Message', MessageSchema);
