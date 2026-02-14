const mongoose = require('mongoose');

const gameSettingSchema = new mongoose.Schema({
  key: {
    type: String,
    default: 'global',
    unique: true
  },
  travelUnitSeconds: {
    type: Number,
    default: 60,
    min: 1,
    max: 86400
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('GameSetting', gameSettingSchema);
