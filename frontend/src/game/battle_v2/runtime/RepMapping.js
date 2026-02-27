export const DEFAULT_MAX_AGENT_WEIGHT = 50;
export const DEFAULT_DAMAGE_EXPONENT = 0.75;

const toSafeInt = (value, fallback = 0, min = 0) => {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, num);
};

export const normalizeUnitsMap = (raw = {}) => {
  const out = {};
  Object.entries(raw || {}).forEach(([unitTypeId, count]) => {
    const id = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    const safe = toSafeInt(count, 0, 0);
    if (!id || safe <= 0) return;
    out[id] = safe;
  });
  return out;
};

export const sumUnitsMap = (unitsMap = {}) => (
  Object.values(unitsMap || {}).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0)
);

export const estimateRepAgents = (unitsMap = {}, maxAgentWeight = DEFAULT_MAX_AGENT_WEIGHT) => {
  const safeCap = Math.max(1, Number(maxAgentWeight) || DEFAULT_MAX_AGENT_WEIGHT);
  return Object.values(normalizeUnitsMap(unitsMap))
    .reduce((sum, count) => sum + Math.ceil(count / safeCap), 0);
};

export const buildRepConfig = (raw = {}) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    maxAgentWeight: Math.max(1, Number(source.maxAgentWeight) || DEFAULT_MAX_AGENT_WEIGHT),
    damageExponent: Math.max(0.2, Math.min(1.25, Number(source.damageExponent) || DEFAULT_DAMAGE_EXPONENT)),
    strictAgentMapping: source.strictAgentMapping !== false
  };
};

export const withRepConfig = (sim, rawConfig = {}) => {
  const config = buildRepConfig(rawConfig);
  return {
    ...sim,
    repConfig: config
  };
};
