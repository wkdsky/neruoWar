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
  name: { 
    type: String, 
    required: true,
    trim: true,
    unique: true
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
  associations: [AssociationSchema],
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
  lastUpdate: { 
    type: Date, 
    default: Date.now 
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// 索引优化
NodeSchema.index({ owner: 1 });
NodeSchema.index({ nodeId: 1 });

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
