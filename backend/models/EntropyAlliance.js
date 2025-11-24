const mongoose = require('mongoose');

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

// 索引优化
EntropyAllianceSchema.index({ name: 1 });
EntropyAllianceSchema.index({ founder: 1 });

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
