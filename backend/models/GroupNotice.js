const mongoose = require('mongoose');
const { createChatModel } = require('../config/chatDatabase');

const GroupNoticeSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  content: {
    type: String,
    required: true,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

GroupNoticeSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });

module.exports = createChatModel('GroupNotice', GroupNoticeSchema);
