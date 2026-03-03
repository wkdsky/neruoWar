const mongoose = require('mongoose');

const RpsTypeEnum = ['mobility', 'ranged', 'defense'];
const RarityEnum = ['common', 'rare', 'epic', 'legend'];

const VisualBattleSchema = new mongoose.Schema({
  bodyLayer: {
    type: Number,
    default: 0,
    min: 0
  },
  gearLayer: {
    type: Number,
    default: 0,
    min: 0
  },
  vehicleLayer: {
    type: Number,
    default: 0,
    min: 0
  },
  tint: {
    type: Number,
    default: 0
  },
  silhouetteLayer: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: false });

const VisualPreviewSchema = new mongoose.Schema({
  style: {
    type: String,
    default: 'procedural'
  },
  palette: {
    primary: { type: String, default: '#5aa3ff' },
    secondary: { type: String, default: '#cfd8e3' },
    accent: { type: String, default: '#ffd166' }
  }
}, { _id: false });

const ArmyUnitTypeSchema = new mongoose.Schema({
  unitTypeId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  roleTag: {
    type: String,
    enum: ['近战', '远程'],
    required: true
  },
  speed: {
    type: Number,
    required: true,
    min: 0
  },
  hp: {
    type: Number,
    required: true,
    min: 1
  },
  atk: {
    type: Number,
    required: true,
    min: 0
  },
  def: {
    type: Number,
    required: true,
    min: 0
  },
  range: {
    type: Number,
    required: true,
    min: 1
  },
  costKP: {
    type: Number,
    required: true,
    min: 1
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
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  enabled: {
    type: Boolean,
    default: true
  },
  rpsType: {
    type: String,
    enum: RpsTypeEnum,
    default: 'mobility'
  },
  professionId: {
    type: String,
    default: ''
  },
  tier: {
    type: Number,
    min: 1,
    max: 4,
    default: 1
  },
  rarity: {
    type: String,
    enum: RarityEnum,
    default: 'common'
  },
  tags: {
    type: [String],
    default: []
  },
  description: {
    type: String,
    default: ''
  },
  bodyId: {
    type: String,
    default: null
  },
  weaponIds: {
    type: [String],
    default: []
  },
  vehicleId: {
    type: String,
    default: null
  },
  abilityIds: {
    type: [String],
    default: []
  },
  behaviorProfileId: {
    type: String,
    default: null
  },
  stabilityProfileId: {
    type: String,
    default: null
  },
  visuals: {
    battle: {
      type: VisualBattleSchema,
      default: () => ({})
    },
    preview: {
      type: VisualPreviewSchema,
      default: () => ({})
    }
  }
}, {
  timestamps: true
});

ArmyUnitTypeSchema.index({ sortOrder: 1, createdAt: 1 });

ArmyUnitTypeSchema.pre('validate', function syncTierAndLevel(next) {
  const safeTier = Math.max(1, Math.floor(Number(this.tier) || Number(this.level) || 1));
  this.tier = safeTier;
  this.level = safeTier;
  next();
});

module.exports = mongoose.model('ArmyUnitType', ArmyUnitTypeSchema);
