const mongoose = require('mongoose');

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
  resources: {
    food: { 
      type: Number, 
      default: 1000,
      min: 0
    },
    metal: { 
      type: Number, 
      default: 500,
      min: 0
    },
    energy: { 
      type: Number, 
      default: 300,
      min: 0
    }
  },
  productionRates: {
    food: { 
      type: Number, 
      default: 10,
      min: 0
    },
    metal: { 
      type: Number, 
      default: 5,
      min: 0
    },
    energy: { 
      type: Number, 
      default: 3,
      min: 0
    }
  },
  connectedNodes: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Node' 
  }],
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

module.exports = mongoose.model('Node', NodeSchema);