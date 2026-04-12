const mongoose = require('mongoose');
const { createChatModel } = require('../config/chatDatabase');

const ChatSequenceSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  value: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

module.exports = createChatModel('ChatSequence', ChatSequenceSchema);
