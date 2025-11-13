const mongoose = require('mongoose');

const ArmySchema = new mongoose.Schema({
  nodeId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Node',
    required: true
  },
  type: { 
    type: String, 
    enum: ['infantry', 'cavalry', 'archer', 'siege'], 
    required: true 
  },
  level: { 
    type: Number, 
    default: 1, 
    min: 1, 
    max: 5 
  },
  count: { 
    type: Number, 
    default: 0,
    min: 0
  },
  attack: { 
    type: Number, 
    required: true,
    min: 0
  },
  defense: { 
    type: Number, 
    required: true,
    min: 0
  },
  speed: { 
    type: Number, 
    required: true,
    min: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// 复合索引
ArmySchema.index({ nodeId: 1, type: 1 });

module.exports = mongoose.model('Army', ArmySchema);