const mongoose = require('mongoose');

const AssociationSchema = new mongoose.Schema({
  targetNode: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
  relationType: {
    type: String,
    enum: ['contains', 'extends'],
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

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

const NodeLockedDistributionSchema = new mongoose.Schema({
  executeAt: {
    type: Date,
    required: true
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
  ruleSnapshot: {
    type: NodeDistributionRuleSchema,
    default: () => ({})
  }
}, { _id: false });

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

  next();
});

// 索引优化
NodeSchema.index({ owner: 1 });
NodeSchema.index({ nodeId: 1 });
NodeSchema.index({ isFeatured: 1, featuredOrder: 1 });
NodeSchema.index({ status: 1 });
NodeSchema.index({ allianceId: 1, status: 1 });
NodeSchema.index({ name: 'text', description: 'text' });

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
