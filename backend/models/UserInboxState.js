const mongoose = require('mongoose');

const UserInboxStateSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  unreadCount: {
    type: Number,
    default: 0,
    min: 0
  },
  lastNotificationAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('UserInboxState', UserInboxStateSchema);
