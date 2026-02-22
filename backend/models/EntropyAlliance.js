const mongoose = require('mongoose');

const VISUAL_PATTERN_TYPES = ['none', 'dots', 'grid', 'diagonal', 'rings', 'noise'];

const AllianceVisualStyleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  primaryColor: {
    type: String,
    required: true,
    default: '#7c3aed'
  },
  secondaryColor: {
    type: String,
    required: true,
    default: '#312e81'
  },
  glowColor: {
    type: String,
    required: true,
    default: '#c084fc'
  },
  rimColor: {
    type: String,
    required: true,
    default: '#f5d0fe'
  },
  textColor: {
    type: String,
    required: true,
    default: '#ffffff'
  },
  patternType: {
    type: String,
    enum: VISUAL_PATTERN_TYPES,
    default: 'diagonal'
  }
}, { timestamps: true });

const EntropyAllianceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  flag: {
    type: String,  // 存储颜色代码，如 "#FF5733"
    required: true,
    default: '#7c3aed'  // 默认紫色
  },
  declaration: {
    type: String,  // 熵盟号召/势力宣言
    required: true,
    trim: true
  },
  announcement: {
    type: String,  // 熵盟公告
    default: '',
    trim: true
  },
  announcementUpdatedAt: {
    type: Date,
    default: null
  },
  knowledgeContributionPercent: {
    type: Number,
    default: 10,
    min: 0,
    max: 100
  },
  knowledgeReserve: {
    type: Number,
    default: 0,
    min: 0
  },
  enemyAllianceIds: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EntropyAlliance'
    }],
    default: []
  },
  visualStyles: {
    type: [AllianceVisualStyleSchema],
    default: []
  },
  activeVisualStyleId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  founder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

EntropyAllianceSchema.pre('validate', function ensureVisualStyle(next) {
  if (!Array.isArray(this.visualStyles)) {
    this.visualStyles = [];
  }

  if (this.visualStyles.length === 0) {
    this.visualStyles.push({
      name: '默认风格',
      primaryColor: this.flag || '#7c3aed',
      secondaryColor: '#312e81',
      glowColor: '#c084fc',
      rimColor: '#f5d0fe',
      textColor: '#ffffff',
      patternType: 'diagonal'
    });
  }

  const activeId = this.activeVisualStyleId ? this.activeVisualStyleId.toString() : '';
  const hasActive = this.visualStyles.some((styleItem) => (
    styleItem?._id && styleItem._id.toString() === activeId
  ));
  if (!hasActive) {
    this.activeVisualStyleId = this.visualStyles[0]?._id || null;
  }

  next();
});

// 索引优化
EntropyAllianceSchema.index({ founder: 1 });
EntropyAllianceSchema.index({ createdAt: -1, _id: -1 });

// 虚拟字段：成员数量（通过查询User表计算）
EntropyAllianceSchema.virtual('memberCount', {
  ref: 'User',
  localField: '_id',
  foreignField: 'allianceId',
  count: true
});

// 确保虚拟字段在toJSON和toObject时包含
EntropyAllianceSchema.set('toJSON', { virtuals: true });
EntropyAllianceSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('EntropyAlliance', EntropyAllianceSchema);
