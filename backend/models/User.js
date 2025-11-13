const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  plainPassword: {
    type: String,
    default: ''  // 设置默认值，不是必填
  },
  level: {
    type: Number,
    default: 1
  },
  experience: {
    type: Number,
    default: 0
  },
  ownedNodes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node'
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);