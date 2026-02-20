const mongoose = require('mongoose');

const AssociationSchema = new mongoose.Schema({
  targetNode: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  sourceSenseId: {
    type: String,
    default: '',
    trim: true
  },
  targetSenseId: {
    type: String,
    default: '',
    trim: true
  },
  relationType: {
    type: String,
    enum: ['contains', 'extends', 'insert'],
    required: true
  },
  insertSide: {
    type: String,
    enum: ['', 'left', 'right'],
    default: '',
    trim: true
  },
  insertGroupId: {
    type: String,
    default: '',
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const SynonymSenseSchema = new mongoose.Schema({
  senseId: {
    type: String,
    required: true,
    trim: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

const PercentUserRuleSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  percent: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  }
}, { _id: false });

const PercentAllianceRuleSchema = new mongoose.Schema({
  allianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    required: true
  },
  percent: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  }
}, { _id: false });

const DistributionScheduleSlotSchema = new mongoose.Schema({
  weekday: {
    type: Number,
    required: true,
    min: 0,
    max: 6
  },
  hour: {
    type: Number,
    required: true,
    min: 0,
    max: 23
  }
}, { _id: false });

const NodeDistributionRuleSchema = new mongoose.Schema({
  enabled: {
    type: Boolean,
    default: false
  },
  distributionScope: {
    type: String,
    enum: ['all', 'partial'],
    default: 'all'
  },
  distributionPercent: {
    type: Number,
    default: 100,
    min: 0,
    max: 100
  },
  masterPercent: {
    type: Number,
    default: 10,
    min: 0,
    max: 100
  },
  adminPercents: {
    type: [PercentUserRuleSchema],
    default: []
  },
  customUserPercents: {
    type: [PercentUserRuleSchema],
    default: []
  },
  nonHostileAlliancePercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  specificAlliancePercents: {
    type: [PercentAllianceRuleSchema],
    default: []
  },
  noAlliancePercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  blacklistUserIds: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    default: []
  },
  blacklistAllianceIds: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EntropyAlliance'
    }],
    default: []
  },
  // 兼容旧结构：新逻辑使用 knowledgeDistributionScheduleSlots
  scheduleSlots: {
    type: [DistributionScheduleSlotSchema],
    default: []
  }
}, { _id: false });

const DistributionRuleProfileSchema = new mongoose.Schema({
  profileId: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  rule: {
    type: NodeDistributionRuleSchema,
    default: () => ({})
  }
}, { _id: false });

const DistributionParticipantSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  exitedAt: {
    type: Date,
    default: null
  }
}, { _id: false });

const DistributionResultUserRewardSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: false });

const NodeLockedDistributionSchema = new mongoose.Schema({
  executeAt: {
    type: Date,
    required: true
  },
  entryCloseAt: {
    type: Date,
    default: null
  },
  endAt: {
    type: Date,
    default: null
  },
  executedAt: {
    type: Date,
    default: null
  },
  announcedAt: {
    type: Date,
    required: true
  },
  projectedTotal: {
    type: Number,
    default: 0,
    min: 0
  },
  projectedDistributableTotal: {
    type: Number,
    default: 0,
    min: 0
  },
  masterAllianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    default: null
  },
  masterAllianceName: {
    type: String,
    default: ''
  },
  allianceContributionPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  distributionScope: {
    type: String,
    enum: ['all', 'partial'],
    default: 'all'
  },
  distributionPercent: {
    type: Number,
    default: 100,
    min: 0,
    max: 100
  },
  ruleProfileId: {
    type: String,
    default: ''
  },
  ruleProfileName: {
    type: String,
    default: ''
  },
  enemyAllianceIds: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EntropyAlliance'
    }],
    default: []
  },
  participants: {
    type: [DistributionParticipantSchema],
    default: []
  },
  resultUserRewards: {
    type: [DistributionResultUserRewardSchema],
    default: []
  },
  ruleSnapshot: {
    type: NodeDistributionRuleSchema,
    default: () => ({})
  }
}, { _id: false });

const CITY_BUILDING_LIMIT = 3;
const CITY_BUILDING_DEFAULT_RADIUS = 0.17;
const CITY_BUILDING_MIN_RADIUS = 0.1;
const CITY_BUILDING_MAX_RADIUS = 0.24;
const CITY_BUILDING_MIN_DISTANCE = 0.34;
const CITY_BUILDING_MAX_DISTANCE = 0.86;
const CITY_GATE_KEYS = ['cheng', 'qi'];

const CityBuildingSchema = new mongoose.Schema({
  buildingId: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    default: '',
    trim: true
  },
  x: {
    type: Number,
    required: true,
    min: -1,
    max: 1
  },
  y: {
    type: Number,
    required: true,
    min: -1,
    max: 1
  },
  radius: {
    type: Number,
    default: CITY_BUILDING_DEFAULT_RADIUS,
    min: CITY_BUILDING_MIN_RADIUS,
    max: CITY_BUILDING_MAX_RADIUS
  },
  level: {
    type: Number,
    default: 1,
    min: 1
  },
  nextUnitTypeId: {
    type: String,
    default: ''
  },
  upgradeCostKP: {
    type: Number,
    default: null
  }
}, { _id: false });

const CityGateDefenseEntrySchema = new mongoose.Schema({
  unitTypeId: {
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

const CityGateDefenseSchema = new mongoose.Schema({
  cheng: {
    type: [CityGateDefenseEntrySchema],
    default: []
  },
  qi: {
    type: [CityGateDefenseEntrySchema],
    default: []
  }
}, { _id: false });

const CitySiegeUnitEntrySchema = new mongoose.Schema({
  unitTypeId: {
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

const CitySiegeAttackerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    default: ''
  },
  allianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    default: null
  },
  units: {
    type: [CitySiegeUnitEntrySchema],
    default: []
  },
  fromNodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    default: null
  },
  fromNodeName: {
    type: String,
    default: ''
  },
  autoRetreatPercent: {
    type: Number,
    default: 40,
    min: 1,
    max: 99
  },
  status: {
    type: String,
    enum: ['moving', 'sieging', 'retreated'],
    default: 'sieging'
  },
  isInitiator: {
    type: Boolean,
    default: false
  },
  isReinforcement: {
    type: Boolean,
    default: false
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  arriveAt: {
    type: Date,
    default: null
  },
  joinedAt: {
    type: Date,
    default: null
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const CitySiegeGateStateSchema = new mongoose.Schema({
  active: {
    type: Boolean,
    default: false
  },
  startedAt: {
    type: Date,
    default: null
  },
  updatedAt: {
    type: Date,
    default: null
  },
  supportNotifiedAt: {
    type: Date,
    default: null
  },
  attackerAllianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    default: null
  },
  initiatorUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  initiatorUsername: {
    type: String,
    default: ''
  },
  attackers: {
    type: [CitySiegeAttackerSchema],
    default: []
  }
}, { _id: false });

const CitySiegeStateSchema = new mongoose.Schema({
  cheng: {
    type: CitySiegeGateStateSchema,
    default: () => ({})
  },
  qi: {
    type: CitySiegeGateStateSchema,
    default: () => ({})
  }
}, { _id: false });

const CityDefenseLayoutSchema = new mongoose.Schema({
  buildings: {
    type: [CityBuildingSchema],
    default: []
  },
  intelBuildingId: {
    type: String,
    default: ''
  },
  gateDefense: {
    type: CityGateDefenseSchema,
    default: () => ({ cheng: [], qi: [] })
  },
  gateDefenseViewAdminIds: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    default: []
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const createCityBuildingId = (prefix = 'building') => (
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
);

const createDefaultCityDefenseLayout = () => {
  const coreId = 'core';
  return {
    buildings: [{
      buildingId: coreId,
      name: '建筑1',
      x: 0,
      y: 0,
      radius: CITY_BUILDING_DEFAULT_RADIUS,
      level: 1,
      nextUnitTypeId: '',
      upgradeCostKP: null
    }],
    intelBuildingId: coreId,
    gateDefense: {
      cheng: [],
      qi: []
    },
    gateDefenseViewAdminIds: [],
    updatedAt: new Date()
  };
};

const createDefaultCitySiegeState = () => ({
  cheng: {
    active: false,
    startedAt: null,
    updatedAt: null,
    supportNotifiedAt: null,
    attackerAllianceId: null,
    initiatorUserId: null,
    initiatorUsername: '',
    attackers: []
  },
  qi: {
    active: false,
    startedAt: null,
    updatedAt: null,
    supportNotifiedAt: null,
    attackerAllianceId: null,
    initiatorUserId: null,
    initiatorUsername: '',
    attackers: []
  }
});

const NodeSchema = new mongoose.Schema({
  nodeId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  domainMaster: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null  // 默认为null，节点的域主
  },
  allianceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EntropyAlliance',
    default: null
  },
  domainAdmins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  name: {
    type: String,
    required: true,
    trim: true
    // 注意：不再使用 unique 约束，改为在应用层检查
    // 只有 approved 状态的节点名称需要唯一
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  synonymSenses: {
    type: [SynonymSenseSchema],
    default: []
  },
  prosperity: { 
    type: Number, 
    default: 100,
    min: 0,
    max: 500
  },
  position: {
    x: { 
      type: Number, 
      required: true,
      min: 0,
      max: 800
    },
    y: { 
      type: Number, 
      required: true,
      min: 0,
      max: 500
    }
  },
  contentScore: { 
    type: Number, 
    default: 1,
    min: 1 
  },
  knowledgePoint: {
    value: { 
      type: Number, 
      default: 0,
      set: v => parseFloat(v.toFixed(2)) // 保留两位小数
    },
    lastUpdated: { 
      type: Date, 
      default: Date.now 
    }
  },
  knowledgeDistributionRule: {
    type: NodeDistributionRuleSchema,
    default: () => ({})
  },
  knowledgeDistributionRuleProfiles: {
    type: [DistributionRuleProfileSchema],
    default: []
  },
  knowledgeDistributionActiveRuleId: {
    type: String,
    default: ''
  },
  knowledgeDistributionScheduleSlots: {
    type: [DistributionScheduleSlotSchema],
    default: []
  },
  knowledgeDistributionLocked: {
    type: NodeLockedDistributionSchema,
    default: null
  },
  knowledgeDistributionCarryover: {
    type: Number,
    default: 0,
    min: 0
  },
  knowledgeDistributionLastAnnouncedAt: {
    type: Date,
    default: null
  },
  knowledgeDistributionLastExecutedAt: {
    type: Date,
    default: null
  },
  cityDefenseLayout: {
    type: CityDefenseLayoutSchema,
    default: () => createDefaultCityDefenseLayout()
  },
  citySiegeState: {
    type: CitySiegeStateSchema,
    default: () => createDefaultCitySiegeState()
  },
  associations: [AssociationSchema],
  relatedParentDomains: {
    type: [String],
    default: []
  },
  relatedChildDomains: {
    type: [String],
    default: []
  },
  level: {
    type: Number,
    default: 1,
    min: 1,
    max: 10
  },
  warDamage: { 
    type: Number, 
    default: 0,
    min: 0,
    max: 100
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'approved'
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  featuredOrder: {
    type: Number,
    default: 0
  },
  lastUpdate: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

// 约束：同一知识域内，域主与域相身份互斥；域相去重
NodeSchema.pre('validate', function ensureDomainRoleConsistency(next) {
  const normalizeSenseId = (value, fallbackIndex = 0) => {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    return `sense_${fallbackIndex + 1}`;
  };

  const senseSeen = new Set();
  const senseTitleSeen = new Set();
  const normalizedSenses = [];
  const sourceSenses = Array.isArray(this.synonymSenses) ? this.synonymSenses : [];
  for (let i = 0; i < sourceSenses.length; i += 1) {
    const item = sourceSenses[i] || {};
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!title || !content) continue;
    const titleKey = title.toLowerCase();
    if (senseTitleSeen.has(titleKey)) continue;
    senseTitleSeen.add(titleKey);

    const senseId = normalizeSenseId(item.senseId, normalizedSenses.length);
    if (senseSeen.has(senseId)) continue;
    senseSeen.add(senseId);
    normalizedSenses.push({
      senseId,
      title,
      content
    });
  }
  this.synonymSenses = normalizedSenses;
  const validSenseIds = new Set(normalizedSenses.map((item) => item.senseId));

  const normalizedAssociations = [];
  const associationSeen = new Set();
  const associationList = Array.isArray(this.associations) ? this.associations : [];
  for (const assoc of associationList) {
    const targetNodeId = getIdString(assoc?.targetNode);
    const relationType = assoc?.relationType === 'contains'
      ? 'contains'
      : (assoc?.relationType === 'extends' ? 'extends' : (assoc?.relationType === 'insert' ? 'insert' : ''));
    if (!targetNodeId || !relationType) continue;

    let sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
    if (sourceSenseId && !validSenseIds.has(sourceSenseId)) {
      sourceSenseId = '';
    }

    let targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
    if (targetSenseId.length > 80) {
      targetSenseId = targetSenseId.slice(0, 80);
    }

    const insertSideRaw = typeof assoc?.insertSide === 'string' ? assoc.insertSide.trim() : '';
    const insertSide = relationType === 'insert' && (insertSideRaw === 'left' || insertSideRaw === 'right')
      ? insertSideRaw
      : '';
    const insertGroupId = typeof assoc?.insertGroupId === 'string' ? assoc.insertGroupId.trim().slice(0, 80) : '';

    const dedupeKey = `${targetNodeId}|${sourceSenseId}|${targetSenseId}|${relationType}|${insertSide}`;
    if (associationSeen.has(dedupeKey)) continue;
    associationSeen.add(dedupeKey);
    normalizedAssociations.push({
      targetNode: assoc.targetNode,
      sourceSenseId,
      targetSenseId,
      relationType,
      insertSide,
      insertGroupId,
      createdAt: assoc?.createdAt || new Date()
    });
  }
  this.associations = normalizedAssociations;

  const domainMasterId = getIdString(this.domainMaster);
  if (!domainMasterId) {
    this.allianceId = null;
  }
  const seen = new Set();
  const normalizedAdmins = [];

  const adminList = Array.isArray(this.domainAdmins) ? this.domainAdmins : [];
  for (const adminId of adminList) {
    const adminIdStr = getIdString(adminId);
    if (!adminIdStr) continue;
    if (adminIdStr === domainMasterId) continue;
    if (seen.has(adminIdStr)) continue;
    seen.add(adminIdStr);
    normalizedAdmins.push(adminId);
  }

  this.domainAdmins = normalizedAdmins;

  const domainAdminSet = new Set(normalizedAdmins.map((adminId) => getIdString(adminId)).filter(Boolean));

  const dedupePercentUsers = (items = [], mustInDomainAdmins = false) => {
    const out = [];
    const userSeen = new Set();
    for (const item of (Array.isArray(items) ? items : [])) {
      const userId = getIdString(item?.userId);
      const percent = Number(item?.percent);
      if (!userId) continue;
      if (mustInDomainAdmins && !domainAdminSet.has(userId)) continue;
      if (userId === domainMasterId) continue;
      if (userSeen.has(userId)) continue;
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
      userSeen.add(userId);
      out.push({ userId: item.userId, percent });
    }
    return out;
  };

  const dedupePercentAlliances = (items = []) => {
    const out = [];
    const allianceSeen = new Set();
    for (const item of (Array.isArray(items) ? items : [])) {
      const allianceId = getIdString(item?.allianceId);
      const percent = Number(item?.percent);
      if (!allianceId) continue;
      if (allianceSeen.has(allianceId)) continue;
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
      allianceSeen.add(allianceId);
      out.push({ allianceId: item.allianceId, percent });
    }
    return out;
  };

  const dedupeObjectIds = (items = [], excludeId = '') => {
    const out = [];
    const itemSeen = new Set();
    for (const item of (Array.isArray(items) ? items : [])) {
      const id = getIdString(item);
      if (!id) continue;
      if (excludeId && id === excludeId) continue;
      if (itemSeen.has(id)) continue;
      itemSeen.add(id);
      out.push(item);
    }
    return out;
  };

  const dedupeScheduleSlots = (slots = []) => {
    const out = [];
    const slotSeen = new Set();
    for (const slot of (Array.isArray(slots) ? slots : [])) {
      const weekday = parseInt(slot?.weekday, 10);
      const hour = parseInt(slot?.hour, 10);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
      const key = `${weekday}-${hour}`;
      if (slotSeen.has(key)) continue;
      slotSeen.add(key);
      out.push({ weekday, hour });
    }
    return out;
  };

  const normalizeRule = (rule = {}) => {
    const normalized = {
      enabled: !!rule.enabled,
      distributionScope: rule.distributionScope === 'partial' ? 'partial' : 'all',
      distributionPercent: Number.isFinite(Number(rule.distributionPercent)) ? Number(rule.distributionPercent) : 100,
      masterPercent: Number.isFinite(Number(rule.masterPercent)) ? Number(rule.masterPercent) : 10,
      adminPercents: dedupePercentUsers(rule.adminPercents, true),
      customUserPercents: dedupePercentUsers(rule.customUserPercents, false),
      nonHostileAlliancePercent: Number.isFinite(Number(rule.nonHostileAlliancePercent)) ? Number(rule.nonHostileAlliancePercent) : 0,
      specificAlliancePercents: dedupePercentAlliances(rule.specificAlliancePercents),
      noAlliancePercent: Number.isFinite(Number(rule.noAlliancePercent)) ? Number(rule.noAlliancePercent) : 0,
      blacklistUserIds: dedupeObjectIds(rule.blacklistUserIds, domainMasterId),
      blacklistAllianceIds: dedupeObjectIds(rule.blacklistAllianceIds),
      scheduleSlots: dedupeScheduleSlots(rule.scheduleSlots)
    };

    normalized.distributionPercent = Math.max(0, Math.min(100, normalized.distributionPercent));
    normalized.masterPercent = Math.max(0, Math.min(100, normalized.masterPercent));
    normalized.nonHostileAlliancePercent = Math.max(0, Math.min(100, normalized.nonHostileAlliancePercent));
    normalized.noAlliancePercent = Math.max(0, Math.min(100, normalized.noAlliancePercent));
    return normalized;
  };

  const legacyRule = normalizeRule(this.knowledgeDistributionRule || {});

  const profileSeen = new Set();
  const normalizedProfiles = [];
  const inputProfiles = Array.isArray(this.knowledgeDistributionRuleProfiles) ? this.knowledgeDistributionRuleProfiles : [];
  for (const profile of inputProfiles) {
    const profileId = typeof profile?.profileId === 'string'
      ? profile.profileId.trim()
      : '';
    if (!profileId || profileSeen.has(profileId)) continue;
    profileSeen.add(profileId);

    const profileName = typeof profile?.name === 'string' && profile.name.trim()
      ? profile.name.trim()
      : `规则${normalizedProfiles.length + 1}`;
    const sourceRule = (profile?.rule && typeof profile.rule === 'object') ? profile.rule : profile;
    normalizedProfiles.push({
      profileId,
      name: profileName,
      rule: normalizeRule(sourceRule || {})
    });
  }

  if (normalizedProfiles.length === 0) {
    normalizedProfiles.push({
      profileId: 'default',
      name: '默认规则',
      rule: legacyRule
    });
  }

  let activeRuleId = typeof this.knowledgeDistributionActiveRuleId === 'string'
    ? this.knowledgeDistributionActiveRuleId.trim()
    : '';
  if (!activeRuleId || !normalizedProfiles.some((item) => item.profileId === activeRuleId)) {
    activeRuleId = normalizedProfiles[0].profileId;
  }

  const activeProfile = normalizedProfiles.find((item) => item.profileId === activeRuleId) || normalizedProfiles[0];
  this.knowledgeDistributionRuleProfiles = normalizedProfiles;
  this.knowledgeDistributionActiveRuleId = activeRuleId;
  this.knowledgeDistributionRule = activeProfile?.rule || legacyRule;

  this.knowledgeDistributionScheduleSlots = dedupeScheduleSlots(
    this.knowledgeDistributionScheduleSlots && this.knowledgeDistributionScheduleSlots.length > 0
      ? this.knowledgeDistributionScheduleSlots
      : legacyRule.scheduleSlots
  );

  if (!Number.isFinite(Number(this.knowledgeDistributionCarryover)) || Number(this.knowledgeDistributionCarryover) < 0) {
    this.knowledgeDistributionCarryover = 0;
  }

  const parseNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const sanitizeBuilding = (item, index) => {
    const sourceId = typeof item?.buildingId === 'string' ? item.buildingId.trim() : '';
    const buildingId = sourceId || createCityBuildingId(`building_${index + 1}`);
    const sourceName = typeof item?.name === 'string' ? item.name.trim() : '';
    const name = sourceName || `建筑${index + 1}`;
    const x = Math.max(-1, Math.min(1, parseNumber(item?.x, 0)));
    const y = Math.max(-1, Math.min(1, parseNumber(item?.y, 0)));
    const radius = Math.max(
      CITY_BUILDING_MIN_RADIUS,
      Math.min(CITY_BUILDING_MAX_RADIUS, parseNumber(item?.radius, CITY_BUILDING_DEFAULT_RADIUS))
    );
    const level = Math.max(1, Math.floor(parseNumber(item?.level, 1)));
    const nextUnitTypeId = typeof item?.nextUnitTypeId === 'string' ? item.nextUnitTypeId.trim() : '';
    const upgradeCostRaw = item?.upgradeCostKP;
    const upgradeCostNum = parseNumber(upgradeCostRaw, NaN);
    const upgradeCostKP = Number.isFinite(upgradeCostNum) && upgradeCostNum >= 0
      ? Number(upgradeCostNum.toFixed(2))
      : null;
    return {
      buildingId,
      name,
      x,
      y,
      radius,
      level,
      nextUnitTypeId,
      upgradeCostKP
    };
  };

  const sanitizeGateDefenseEntries = (entries = []) => {
    const list = [];
    const seenUnitTypeIds = new Set();
    for (const item of (Array.isArray(entries) ? entries : [])) {
      const unitTypeId = typeof item?.unitTypeId === 'string' ? item.unitTypeId.trim() : '';
      const count = Math.max(0, Math.floor(parseNumber(item?.count, 0)));
      if (!unitTypeId || count <= 0) continue;
      if (seenUnitTypeIds.has(unitTypeId)) continue;
      seenUnitTypeIds.add(unitTypeId);
      list.push({
        unitTypeId,
        count
      });
    }
    return list;
  };

  const sourceLayout = this.cityDefenseLayout && typeof this.cityDefenseLayout === 'object'
    ? this.cityDefenseLayout
    : {};
  const sourceBuildings = Array.isArray(sourceLayout.buildings) ? sourceLayout.buildings : [];
  const dedupedBuildings = [];
  const seenBuildingIds = new Set();

  for (let i = 0; i < sourceBuildings.length; i += 1) {
    const sanitized = sanitizeBuilding(sourceBuildings[i], i);
    if (!sanitized.buildingId || seenBuildingIds.has(sanitized.buildingId)) continue;
    seenBuildingIds.add(sanitized.buildingId);
    dedupedBuildings.push(sanitized);
    if (dedupedBuildings.length >= CITY_BUILDING_LIMIT) break;
  }

  let normalizedBuildings = dedupedBuildings;
  if (normalizedBuildings.length === 0) {
    normalizedBuildings = createDefaultCityDefenseLayout().buildings;
  }

  const validatePosition = (building, buildingList, selfIndex) => {
    const centerDistance = Math.sqrt((building.x ** 2) + (building.y ** 2));
    if (centerDistance > CITY_BUILDING_MAX_DISTANCE) return false;
    for (let index = 0; index < buildingList.length; index += 1) {
      if (index === selfIndex) continue;
      const target = buildingList[index];
      const dx = building.x - target.x;
      const dy = building.y - target.y;
      if (Math.sqrt((dx ** 2) + (dy ** 2)) < CITY_BUILDING_MIN_DISTANCE) {
        return false;
      }
    }
    return true;
  };

  if (normalizedBuildings.length > 1) {
    normalizedBuildings = normalizedBuildings.map((building, index) => {
      if (validatePosition(building, normalizedBuildings, index)) {
        return building;
      }
      const fallbackPositions = [
        { x: 0, y: 0 },
        { x: -0.46, y: -0.12 },
        { x: 0.46, y: -0.12 },
        { x: -0.34, y: 0.36 },
        { x: 0.34, y: 0.36 }
      ];
      const fallback = fallbackPositions[index] || { x: 0, y: 0 };
      return {
        ...building,
        x: fallback.x,
        y: fallback.y
      };
    });
  }

  const buildingIdSet = new Set(normalizedBuildings.map((item) => item.buildingId));
  const sourceIntelBuildingId = typeof sourceLayout.intelBuildingId === 'string'
    ? sourceLayout.intelBuildingId.trim()
    : '';
  const intelBuildingId = buildingIdSet.has(sourceIntelBuildingId)
    ? sourceIntelBuildingId
    : normalizedBuildings[0].buildingId;

  const sourceGateDefense = sourceLayout.gateDefense && typeof sourceLayout.gateDefense === 'object'
    ? sourceLayout.gateDefense
    : {};
  const gateDefense = CITY_GATE_KEYS.reduce((acc, key) => {
    acc[key] = sanitizeGateDefenseEntries(sourceGateDefense[key]);
    return acc;
  }, { cheng: [], qi: [] });
  const sourceGateDefenseViewAdminIds = Array.isArray(sourceLayout.gateDefenseViewAdminIds)
    ? sourceLayout.gateDefenseViewAdminIds
    : [];
  const gateDefenseViewAdminIds = [];
  const gateDefenseViewerSeen = new Set();
  for (const userId of sourceGateDefenseViewAdminIds) {
    const userIdStr = getIdString(userId);
    if (!userIdStr) continue;
    if (!domainAdminSet.has(userIdStr)) continue;
    if (gateDefenseViewerSeen.has(userIdStr)) continue;
    gateDefenseViewerSeen.add(userIdStr);
    gateDefenseViewAdminIds.push(userId);
  }

  this.cityDefenseLayout = {
    buildings: normalizedBuildings,
    intelBuildingId,
    gateDefense,
    gateDefenseViewAdminIds,
    updatedAt: new Date()
  };

  const sourceSiegeState = this.citySiegeState && typeof this.citySiegeState === 'object'
    ? this.citySiegeState
    : createDefaultCitySiegeState();
  const normalizeSiegeUnits = (entries = []) => {
    const out = [];
    const seen = new Set();
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
      const count = Math.max(0, Math.floor(parseNumber(entry?.count, 0)));
      if (!unitTypeId || count <= 0) continue;
      if (seen.has(unitTypeId)) continue;
      seen.add(unitTypeId);
      out.push({ unitTypeId, count });
    }
    return out;
  };
  const normalizeGateState = (gateState = {}) => {
    const sourceAttackers = Array.isArray(gateState?.attackers) ? gateState.attackers : [];
    const attackers = sourceAttackers.map((item) => {
      const userId = item?.userId || null;
      return {
        userId,
        username: typeof item?.username === 'string' ? item.username : '',
        allianceId: item?.allianceId || null,
        units: normalizeSiegeUnits(item?.units),
        fromNodeId: item?.fromNodeId || null,
        fromNodeName: typeof item?.fromNodeName === 'string' ? item.fromNodeName : '',
        autoRetreatPercent: Math.max(1, Math.min(99, parseNumber(item?.autoRetreatPercent, 40))),
        status: item?.status === 'moving' || item?.status === 'retreated' ? item.status : 'sieging',
        isInitiator: !!item?.isInitiator,
        isReinforcement: !!item?.isReinforcement,
        requestedAt: item?.requestedAt || null,
        arriveAt: item?.arriveAt || null,
        joinedAt: item?.joinedAt || null,
        updatedAt: item?.updatedAt || null
      };
    }).filter((item) => !!getIdString(item.userId));
    const hasActiveAttacker = attackers.some((item) => item.status === 'moving' || item.status === 'sieging');
    return {
      active: !!gateState?.active && hasActiveAttacker,
      startedAt: gateState?.startedAt || null,
      updatedAt: gateState?.updatedAt || null,
      supportNotifiedAt: gateState?.supportNotifiedAt || null,
      attackerAllianceId: gateState?.attackerAllianceId || null,
      initiatorUserId: gateState?.initiatorUserId || null,
      initiatorUsername: typeof gateState?.initiatorUsername === 'string' ? gateState.initiatorUsername : '',
      attackers
    };
  };
  this.citySiegeState = {
    cheng: normalizeGateState(sourceSiegeState.cheng),
    qi: normalizeGateState(sourceSiegeState.qi)
  };

  next();
});

// 索引优化
NodeSchema.index({ owner: 1 });
NodeSchema.index({ nodeId: 1 });
NodeSchema.index({ isFeatured: 1, featuredOrder: 1 });
NodeSchema.index({ status: 1 });
NodeSchema.index({ allianceId: 1, status: 1 });
NodeSchema.index({ name: 'text', description: 'text' });
NodeSchema.index({ 'synonymSenses.title': 1 });

// 更新知识点的静态方法
NodeSchema.statics.updateKnowledgePoint = async function(nodeId) {
  const node = await this.findById(nodeId);
  if (!node) return null;
  
  const now = new Date();
  const minutesElapsed = Math.max(0, (now - node.knowledgePoint.lastUpdated) / (1000 * 60));
  const increment = minutesElapsed * node.contentScore;
  
  node.knowledgePoint.value = parseFloat((node.knowledgePoint.value + increment).toFixed(2));
  node.knowledgePoint.lastUpdated = now;
  
  return node.save();
};

module.exports = mongoose.model('Node', NodeSchema);
