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

const ArmyTemplatePlacementSchema = new mongoose.Schema({
  unitTypeId: {
    type: String,
    required: true
  },
  x: {
    type: Number,
    default: 0
  },
  y: {
    type: Number,
    default: 0
  }
}, { _id: false });

const ArmyTemplateFormationSchema = new mongoose.Schema({
  formationId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    default: ''
  },
  placements: {
    type: [ArmyTemplatePlacementSchema],
    default: []
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
  formations: {
    type: [ArmyTemplateFormationSchema],
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

// A template describes a composition, while an army instance records soldiers that
// belong to one player.  Keep the two concepts separate so a template can be
// edited without changing an already-created combat or training army.
const ArmyInstanceUnitSchema = new mongoose.Schema({
  unitTypeId: {
    type: String,
    required: true
  },
  count: {
    type: Number,
    required: true,
    min: 1
  }
}, { _id: false });

const ArmyInstanceFormationRectSchema = new mongoose.Schema({
  area: { type: Number, default: 0, min: 0 },
  width: { type: Number, default: 0, min: 0 },
  depth: { type: Number, default: 0, min: 0 },
  spacing: { type: Number, default: 0, min: 0 },
  facingRad: { type: Number, default: 0 },
  directionOffsetRad: { type: Number },
  directionRad: { type: Number },
  slotCount: { type: Number, default: 0, min: 0 },
  formationId: { type: String, default: '' },
  formationName: { type: String, default: '' }
}, { _id: false });

const ArmyInstanceDeploySlotSchema = new mongoose.Schema({
  side: { type: Number, default: 0 },
  front: { type: Number, default: 0 },
  row: { type: Number, default: 0, min: 0 },
  col: { type: Number, default: 0, min: 0 },
  unitTypeId: { type: String, default: '' },
  templateIndex: { type: Number, default: 0, min: 0 }
}, { _id: false });

const ArmyInstanceSkillSlotSchema = new mongoose.Schema({
  slotIndex: { type: Number, required: true, min: 0 },
  treeCategory: { type: String, default: '' },
  skillId: { type: String, default: '' },
  cooldownRemain: { type: Number, default: 0, min: 0 }
}, { _id: false });

const ArmyInstanceSchema = new mongoose.Schema({
  armyId: {
    type: String,
    required: true
  },
  // Training cards keep an explicit order in storage.
  sortOrder: {
    type: Number,
    default: 0,
    min: 0
  },
  controlMode: {
    type: String,
    enum: ['USER', 'AI']
  },
  templateId: {
    type: String,
    default: ''
  },
  templateName: {
    type: String,
    default: ''
  },
  name: {
    type: String,
    default: ''
  },
  units: {
    type: [ArmyInstanceUnitSchema],
    default: []
  },
  templateFormations: {
    type: [ArmyTemplateFormationSchema],
    default: []
  },
  activeFormationId: {
    type: String,
    default: ''
  },
  formationRect: {
    type: ArmyInstanceFormationRectSchema,
    default: null
  },
  deploySlots: {
    type: [ArmyInstanceDeploySlotSchema],
    default: []
  },
  skillSlots: {
    type: [ArmyInstanceSkillSlotSchema],
    default: []
  },
  x: {
    type: Number,
    default: 0
  },
  y: {
    type: Number,
    default: 0
  },
  placed: {
    type: Boolean,
    default: true
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

const TrainingArmySchema = new mongoose.Schema({
  ...ArmyInstanceSchema.obj,
  team: {
    type: String,
    enum: ['attacker', 'defender'],
    default: 'attacker'
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
  publicId: {
    type: String,
    default: undefined,
    trim: true
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
  // `armyRoster` is the account-owned total. Creating a combat army purchases
  // its soldiers with knowledge points, then `combatArmies` reserve them for battle.
  combatArmies: {
    type: [ArmyInstanceSchema],
    default: []
  },
  // Training armies are intentionally isolated from account-owned soldiers.
  trainingArmies: {
    type: [TrainingArmySchema],
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
userSchema.index({ publicId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('User', userSchema);
