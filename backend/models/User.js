const mongoose = require('mongoose');

const TravelPathNodeSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  nodeName: {
    type: String,
    required: true
  }
}, { _id: false });

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
  role: {
    type: String,
    enum: ['admin', 'common'],
    default: 'common'
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
  }],
  location: {
    type: String,
    default: ''  // 普通用户注册时为空，管理员为"任意"
  },
  allianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    default: null  // 默认不属于任何熵盟
  },
  profession: {
    type: String,
    default: '求知'  // 默认职业为"求知"
  },
  avatar: {
    type: String,
    default: 'default_male_1'  // 默认头像
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    default: 'male'
  },
  travelState: {
    status: {
      type: String,
      enum: ['idle', 'moving', 'stopping'],
      default: 'idle'
    },
    isTraveling: {
      type: Boolean,
      default: false
    },
    path: {
      type: [TravelPathNodeSchema],
      default: []
    },
    startedAt: {
      type: Date,
      default: null
    },
    unitDurationSeconds: {
      type: Number,
      default: 60,
      min: 1
    },
    targetNodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Node',
      default: null
    },
    stoppingNearestNodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Node',
      default: null
    },
    stoppingNearestNodeName: {
      type: String,
      default: ''
    },
    stopStartedAt: {
      type: Date,
      default: null
    },
    stopDurationSeconds: {
      type: Number,
      default: 0,
      min: 0
    },
    stopFromNode: {
      type: TravelPathNodeSchema,
      default: null
    },
    queuedTargetNodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Node',
      default: null
    },
    queuedTargetNodeName: {
      type: String,
      default: ''
    }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
