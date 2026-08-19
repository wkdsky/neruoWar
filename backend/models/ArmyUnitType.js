const mongoose = require('mongoose');
const { normalizeAttackRange } = require('../services/attackRangeService');

const RpsTypeEnum = ['melee', 'ranged', 'support'];
const RarityEnum = ['common', 'rare', 'epic', 'legend'];
const UnitCategoryEnum = ['melee', 'ranged', 'support'];
const UnitSubtypeEnum = ['mobility', 'defense', 'balance', 'combination', 'comprehensive', 'intervention'];

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

const AttackRangeSchema = new mongoose.Schema({
  min: {
    type: Number,
    required: true,
    min: 0
  },
  max: {
    type: Number,
    required: true,
    min: 1
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
  unitCategory: {
    type: String,
    enum: UnitCategoryEnum,
    required: true,
    default: 'melee'
  },
  unitSubtype: {
    type: String,
    enum: UnitSubtypeEnum,
    required: true,
    default: 'balance'
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
  attackRange: {
    type: AttackRangeSchema,
    required: true,
    default: () => ({})
  },
  range: {
    type: Number,
    min: 1,
    default: 1
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
    default: 'melee'
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
  const attackRange = normalizeAttackRange({
    roleTag: this.roleTag,
    unitCategory: this.unitCategory,
    rpsType: this.rpsType,
    attackRange: this.attackRange,
    range: this.range
  });
  this.attackRange = attackRange;
  this.range = attackRange.max;
  if (this.roleTag === '远程' && attackRange.min <= 1) {
    this.invalidate('attackRange.min', '远程兵种攻击范围下限必须大于 1');
  }
  next();
});

module.exports = mongoose.model('ArmyUnitType', ArmyUnitTypeSchema);
