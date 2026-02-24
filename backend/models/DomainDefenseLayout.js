const mongoose = require('mongoose');

const CITY_BUILDING_DEFAULT_RADIUS = 0.17;
const BATTLEFIELD_DEFAULT_VERSION = 1;
const BATTLEFIELD_FIELD_WIDTH = 900;
const BATTLEFIELD_FIELD_HEIGHT = 620;
const BATTLEFIELD_FIELD_LIMIT = 5000;
const BATTLEFIELD_MAX_STACK_LEVEL = 5;
const BATTLEFIELD_GATE_KEYS = ['cheng', 'qi'];
const BATTLEFIELD_WALL_DEFAULT = {
  type: 'wood_wall',
  width: 104,
  depth: 24,
  height: 42,
  hp: 240,
  defense: 1.1
};

const createDefaultBattlefieldLayouts = () => (
  BATTLEFIELD_GATE_KEYS.map((gateKey) => ({
    layoutId: `${gateKey}_default`,
    name: gateKey === 'cheng' ? '承门战场' : '启门战场',
    gateKey,
    fieldWidth: BATTLEFIELD_FIELD_WIDTH,
    fieldHeight: BATTLEFIELD_FIELD_HEIGHT,
    maxItemsPerType: 10,
    updatedAt: new Date()
  }))
);

const createDefaultBattlefieldItems = () => ([
  {
    itemType: BATTLEFIELD_WALL_DEFAULT.type,
    name: '木墙',
    width: BATTLEFIELD_WALL_DEFAULT.width,
    depth: BATTLEFIELD_WALL_DEFAULT.depth,
    height: BATTLEFIELD_WALL_DEFAULT.height,
    hp: BATTLEFIELD_WALL_DEFAULT.hp,
    defense: BATTLEFIELD_WALL_DEFAULT.defense
  }
]);

const createDefaultBattlefieldObjects = () => {
  const objects = [];
  BATTLEFIELD_GATE_KEYS.forEach((gateKey) => {
    const layoutId = `${gateKey}_default`;
    for (let i = 0; i < 10; i += 1) {
      const row = Math.floor(i / 5);
      const col = i % 5;
      objects.push({
        layoutId,
        objectId: `${layoutId}_seed_${i + 1}`,
        itemType: BATTLEFIELD_WALL_DEFAULT.type,
        x: -240 + (col * 120),
        y: -78 + (row * 170),
        z: 0,
        rotation: row % 2 === 0 ? 0 : 90
      });
    }
  });
  return objects;
};

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
    min: 0.1,
    max: 0.24
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

const BattlefieldObjectSchema = new mongoose.Schema({
  layoutId: {
    type: String,
    required: true,
    trim: true
  },
  objectId: {
    type: String,
    required: true,
    trim: true
  },
  itemType: {
    type: String,
    enum: ['wood_wall'],
    default: BATTLEFIELD_WALL_DEFAULT.type
  },
  x: {
    type: Number,
    required: true,
    min: -(BATTLEFIELD_FIELD_LIMIT / 2),
    max: BATTLEFIELD_FIELD_LIMIT / 2
  },
  y: {
    type: Number,
    required: true,
    min: -(BATTLEFIELD_FIELD_LIMIT / 2),
    max: BATTLEFIELD_FIELD_LIMIT / 2
  },
  z: {
    type: Number,
    default: 0,
    min: 0,
    max: BATTLEFIELD_MAX_STACK_LEVEL - 1
  },
  rotation: {
    type: Number,
    default: 0,
    min: 0,
    max: 359.999
  }
}, { _id: false });

const BattlefieldLayoutMetaSchema = new mongoose.Schema({
  layoutId: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    default: '',
    trim: true
  },
  gateKey: {
    type: String,
    enum: ['', 'cheng', 'qi'],
    default: ''
  },
  fieldWidth: {
    type: Number,
    default: BATTLEFIELD_FIELD_WIDTH,
    min: 200,
    max: 5000
  },
  fieldHeight: {
    type: Number,
    default: BATTLEFIELD_FIELD_HEIGHT,
    min: 200,
    max: 5000
  },
  maxItemsPerType: {
    type: Number,
    default: 10,
    min: 0,
    max: 9999
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const BattlefieldItemSchema = new mongoose.Schema({
  itemType: {
    type: String,
    enum: ['wood_wall'],
    required: true,
    trim: true
  },
  name: {
    type: String,
    default: '',
    trim: true
  },
  width: {
    type: Number,
    default: BATTLEFIELD_WALL_DEFAULT.width,
    min: 12,
    max: 360
  },
  depth: {
    type: Number,
    default: BATTLEFIELD_WALL_DEFAULT.depth,
    min: 12,
    max: 360
  },
  height: {
    type: Number,
    default: BATTLEFIELD_WALL_DEFAULT.height,
    min: 10,
    max: 360
  },
  hp: {
    type: Number,
    default: BATTLEFIELD_WALL_DEFAULT.hp,
    min: 1
  },
  defense: {
    type: Number,
    default: BATTLEFIELD_WALL_DEFAULT.defense,
    min: 0.1
  }
}, { _id: false });

const DomainDefenseLayoutSchema = new mongoose.Schema({
  nodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Node',
    required: true
  },
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
  battlefieldLayout: {
    // 兼容旧字段，后续迁移后可清理
    type: new mongoose.Schema({
      version: {
        type: Number,
        default: BATTLEFIELD_DEFAULT_VERSION,
        min: 1
      },
      fieldWidth: {
        type: Number,
        default: BATTLEFIELD_FIELD_WIDTH,
        min: 200,
        max: 5000
      },
      fieldHeight: {
        type: Number,
        default: BATTLEFIELD_FIELD_HEIGHT,
        min: 200,
        max: 5000
      },
      objects: {
        type: [new mongoose.Schema({
          objectId: {
            type: String,
            required: true,
            trim: true
          },
          type: {
            type: String,
            enum: ['wood_wall'],
            default: BATTLEFIELD_WALL_DEFAULT.type
          },
          x: { type: Number, default: 0 },
          y: { type: Number, default: 0 },
          z: { type: Number, default: 0 },
          rotation: { type: Number, default: 0 },
          width: { type: Number, default: BATTLEFIELD_WALL_DEFAULT.width },
          depth: { type: Number, default: BATTLEFIELD_WALL_DEFAULT.depth },
          height: { type: Number, default: BATTLEFIELD_WALL_DEFAULT.height },
          hp: { type: Number, default: BATTLEFIELD_WALL_DEFAULT.hp },
          defense: { type: Number, default: BATTLEFIELD_WALL_DEFAULT.defense }
        }, { _id: false })],
        default: []
      },
      updatedAt: {
        type: Date,
        default: Date.now
      }
    }, { _id: false }),
    default: () => ({})
  },
  battlefieldLayouts: {
    type: [BattlefieldLayoutMetaSchema],
    default: () => createDefaultBattlefieldLayouts()
  },
  battlefieldObjects: {
    type: [BattlefieldObjectSchema],
    default: () => createDefaultBattlefieldObjects()
  },
  battlefieldItems: {
    type: [BattlefieldItemSchema],
    default: () => createDefaultBattlefieldItems()
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

DomainDefenseLayoutSchema.index({ nodeId: 1 }, { unique: true });
DomainDefenseLayoutSchema.index({ updatedAt: -1 });
DomainDefenseLayoutSchema.index({ gateDefenseViewAdminIds: 1, updatedAt: -1 });

module.exports = mongoose.model('DomainDefenseLayout', DomainDefenseLayoutSchema);
