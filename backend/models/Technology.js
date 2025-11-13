const mongoose = require('mongoose');

const TechnologySchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  techId: { 
    type: String, 
    required: true 
  },
  name: { 
    type: String, 
    required: true 
  },
  level: { 
    type: Number, 
    default: 0,
    min: 0,
    max: 10
  },
  unlockCost: {
    food: { type: Number, default: 0 },
    metal: { type: Number, default: 0 },
    energy: { type: Number, default: 0 }
  },
  effects: {
    prosperityBonus: { type: Number, default: 0 },
    productionBonus: { type: Number, default: 0 },
    militaryBonus: { type: Number, default: 0 }
  },
  unlockedAt: {
    type: Date,
    default: Date.now
  }
});

// 复合唯一索引
TechnologySchema.index({ userId: 1, techId: 1 }, { unique: true });

module.exports = mongoose.model('Technology', TechnologySchema);