const GameSetting = require('../models/GameSetting');

const DEFAULT_TRAVEL_UNIT_SECONDS = 60;
const DEFAULT_DISTRIBUTION_ANNOUNCEMENT_LEAD_HOURS = 24;
const DEFAULT_STAR_MAP_NODE_LIMIT = 50;

const SETTINGS_INSERT_DEFAULTS = {
  travelUnitSeconds: DEFAULT_TRAVEL_UNIT_SECONDS,
  distributionAnnouncementLeadHours: DEFAULT_DISTRIBUTION_ANNOUNCEMENT_LEAD_HOURS,
  starMapNodeLimit: DEFAULT_STAR_MAP_NODE_LIMIT
};

const normalizeInteger = (value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const getOrCreateSettings = async () => GameSetting.findOneAndUpdate(
  { key: 'global' },
  { $setOnInsert: SETTINGS_INSERT_DEFAULTS },
  { new: true, upsert: true, setDefaultsOnInsert: true }
);

const resolveConfiguredStarMapLimit = (settings = {}) => normalizeInteger(
  settings?.starMapNodeLimit,
  DEFAULT_STAR_MAP_NODE_LIMIT,
  { min: 10, max: 200 }
);

const resolveEffectiveStarMapLimit = async (requestedLimit) => {
  const settings = await getOrCreateSettings();
  const configuredLimit = resolveConfiguredStarMapLimit(settings);
  const effectiveLimit = normalizeInteger(requestedLimit, configuredLimit, { min: 10, max: 200 });
  return {
    settings,
    configuredLimit,
    effectiveLimit
  };
};

module.exports = {
  DEFAULT_TRAVEL_UNIT_SECONDS,
  DEFAULT_DISTRIBUTION_ANNOUNCEMENT_LEAD_HOURS,
  DEFAULT_STAR_MAP_NODE_LIMIT,
  SETTINGS_INSERT_DEFAULTS,
  normalizeInteger,
  getOrCreateSettings,
  resolveConfiguredStarMapLimit,
  resolveEffectiveStarMapLimit
};
