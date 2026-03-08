const mongoose = require('mongoose');
const { NOTIFICATION_STATUSES, NOTIFICATION_TYPES } = require('../constants/senseArticle');

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

const NotificationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: NOTIFICATION_TYPES,
    default: 'info'
  },
  title: {
    type: String,
    default: ''
  },
  message: {
    type: String,
    default: ''
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  read: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: NOTIFICATION_STATUSES,
    default: 'info'
  },
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    default: null
  },
  nodeName: {
    type: String,
    default: ''
  },
  allianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    default: null
  },
  allianceName: {
    type: String,
    default: ''
  },
  inviterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  inviterUsername: {
    type: String,
    default: ''
  },
  inviteeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  inviteeUsername: {
    type: String,
    default: ''
  },
  applicationReason: {
    type: String,
    default: ''
  },
  respondedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const RecentVisitedDomainSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  visitMode: {
    type: String,
    enum: ['title', 'sense'],
    default: 'title'
  },
  senseId: {
    type: String,
    default: ''
  },
  visitedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const ArmyRosterEntrySchema = new mongoose.Schema({
  unitTypeId: {
    type: String,
    required: true
  },
  count: {
    type: Number,
    default: 0,
    min: 0
  },
  level: {
    type: Number,
    default: 1,
    min: 1
  },
  nextUnitTypeId: {
    type: String,
    default: null
  },
  upgradeCostKP: {
    type: Number,
    default: null,
    min: 0
  }
}, { _id: false });

const ArmyTemplateUnitSchema = new mongoose.Schema({
  unitTypeId: {
    type: String,
    required: true
  },
  count: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: false });

const ArmyTemplateSchema = new mongoose.Schema({
  templateId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    default: ''
  },
  units: {
    type: [ArmyTemplateUnitSchema],
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const BattlefieldItemInventoryEntrySchema = new mongoose.Schema({
  itemId: {
    type: String,
    required: true,
    trim: true
  },
  count: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: false });

const IntelGateDefenseEntrySchema = new mongoose.Schema({
  unitTypeId: {
    type: String,
    required: true
  },
  unitName: {
    type: String,
    default: ''
  },
  count: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: false });

const IntelGateDefenseSnapshotSchema = new mongoose.Schema({
  cheng: {
    type: [IntelGateDefenseEntrySchema],
    default: []
  },
  qi: {
    type: [IntelGateDefenseEntrySchema],
    default: []
  }
}, { _id: false });

const IntelDomainSnapshotSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  nodeName: {
    type: String,
    default: ''
  },
  sourceBuildingId: {
    type: String,
    default: ''
  },
  deploymentUpdatedAt: {
    type: Date,
    default: null
  },
  capturedAt: {
    type: Date,
    default: Date.now
  },
  gateDefense: {
    type: IntelGateDefenseSnapshotSchema,
    default: () => ({ cheng: [], qi: [] })
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
    default: 0
  },
  knowledgeBalance: {
    type: Number,
    default: 0,
    min: 0
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
  lastArrivedFromNodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    default: null
  },
  lastArrivedFromNodeName: {
    type: String,
    default: ''
  },
  lastArrivedAt: {
    type: Date,
    default: null
  },
  allianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    default: null  // 默认不属于任何熵盟
  },
  allianceBroadcastSeenAt: {
    type: Date,
    default: null
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
  },
  notifications: {
    type: [NotificationSchema],
    default: []
  },
  favoriteDomains: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Node'
    }],
    default: []
  },
  recentVisitedDomains: {
    type: [RecentVisitedDomainSchema],
    default: []
  },
  armyRoster: {
    type: [ArmyRosterEntrySchema],
    default: []
  },
  armyTemplates: {
    type: [ArmyTemplateSchema],
    default: []
  },
  battlefieldItemInventory: {
    type: [BattlefieldItemInventoryEntrySchema],
    default: []
  },
  intelDomainSnapshots: {
    type: Map,
    of: IntelDomainSnapshotSchema,
    default: () => ({})
  }
}, {
  timestamps: true
});

userSchema.index({ role: 1 });
userSchema.index({ allianceId: 1, role: 1 });
userSchema.index({ location: 1, role: 1 });
userSchema.index({ 'travelState.status': 1, role: 1 });
userSchema.index({ allianceId: 1, createdAt: -1 });
userSchema.index({ role: 1, location: 1, _id: 1 });
userSchema.index({ role: 1, 'travelState.targetNodeId': 1, 'travelState.status': 1 });
userSchema.index({ role: 1, 'travelState.stoppingNearestNodeId': 1, 'travelState.status': 1 });

module.exports = mongoose.model('User', userSchema);
