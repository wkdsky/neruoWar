export const DEFAULT_MAX_AGENT_WEIGHT = 50;
export const DEFAULT_DAMAGE_EXPONENT = 0.75;
export const DEFAULT_MAX_TOTAL_AGENTS = 360;

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

const resolveSquadMaxAgentWeight = (squad = {}, maxAgentWeight = DEFAULT_MAX_AGENT_WEIGHT) => {
  const globalMaxAgentWeight = Math.max(1, Number(maxAgentWeight) || DEFAULT_MAX_AGENT_WEIGHT);
  const representativeAgentWeightCap = Number(squad?.representativeAgentWeightCap);
  if (!Number.isFinite(representativeAgentWeightCap) || representativeAgentWeightCap <= 0) {
    return globalMaxAgentWeight;
  }
  return Math.min(globalMaxAgentWeight, Math.max(1, representativeAgentWeightCap));
};

export const estimateSquadRepAgents = (squads = [], maxAgentWeight = DEFAULT_MAX_AGENT_WEIGHT) => (
  (Array.isArray(squads) ? squads : [])
    .reduce((sum, squad) => sum + estimateRepAgents(
      squad?.units || {},
      resolveSquadMaxAgentWeight(squad, maxAgentWeight)
    ), 0)
);

export const buildRepConfig = (raw = {}) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    maxAgentWeight: Math.max(1, Number(source.maxAgentWeight) || DEFAULT_MAX_AGENT_WEIGHT),
    maxTotalAgents: Math.max(0, toSafeInt(source.maxTotalAgents, 0, 0)),
    damageExponent: Math.max(0.2, Math.min(1.25, Number(source.damageExponent) || DEFAULT_DAMAGE_EXPONENT)),
    strictAgentMapping: source.strictAgentMapping !== false
  };
};

export const resolveRepConfigForSquads = (squads = [], rawConfig = {}) => {
  const config = buildRepConfig(rawConfig);
  const requestedMaxAgentWeight = config.maxAgentWeight;
  const maxTotalAgents = config.maxTotalAgents;
  const estimate = (weight) => estimateSquadRepAgents(squads, weight);
  let effectiveMaxAgentWeight = requestedMaxAgentWeight;

  if (maxTotalAgents > 0 && estimate(effectiveMaxAgentWeight) > maxTotalAgents) {
    let upperBound = effectiveMaxAgentWeight;
    while (estimate(upperBound) > maxTotalAgents && upperBound < Number.MAX_SAFE_INTEGER / 2) {
      upperBound *= 2;
    }

    let lowerBound = effectiveMaxAgentWeight;
    while (lowerBound < upperBound) {
      const middle = lowerBound + Math.floor((upperBound - lowerBound) / 2);
      if (estimate(middle) <= maxTotalAgents) {
        upperBound = middle;
      } else {
        lowerBound = middle + 1;
      }
    }
    effectiveMaxAgentWeight = upperBound;
  }

  return {
    ...config,
    maxAgentWeight: effectiveMaxAgentWeight,
    requestedMaxAgentWeight,
    effectiveMaxAgentWeight,
    estimatedAgentCount: estimate(effectiveMaxAgentWeight)
  };
};

export const withRepConfig = (sim, rawConfig = {}) => {
  const config = buildRepConfig(rawConfig);
  return {
    ...sim,
    repConfig: {
      ...config,
      requestedMaxAgentWeight: Math.max(
        1,
        Number(rawConfig?.requestedMaxAgentWeight) || config.maxAgentWeight
      ),
      effectiveMaxAgentWeight: Math.max(
        1,
        Number(rawConfig?.effectiveMaxAgentWeight) || config.maxAgentWeight
      ),
      estimatedAgentCount: Math.max(0, toSafeInt(rawConfig?.estimatedAgentCount, 0, 0))
    }
  };
};
