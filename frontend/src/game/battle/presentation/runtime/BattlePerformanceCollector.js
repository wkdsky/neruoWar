export const PERFORMANCE_REPORT_SCHEMA_VERSION = 1;

const DEFAULT_SAMPLE_LIMIT = 2048;
const MAX_SAMPLE_LIMIT = 4096;
const DEBUG_SUMMARY_REFRESH_MS = 1000;
const METRIC_KEYS = Object.freeze(['simulationMs', 'renderMs', 'fps']);

const resolveNowMs = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
};

const normalizeSampleLimit = (value) => {
  const numeric = Math.floor(Number(value) || DEFAULT_SAMPLE_LIMIT);
  return Math.min(MAX_SAMPLE_LIMIT, Math.max(1, numeric));
};

const normalizeScenario = (value) => {
  const scenario = String(value || '').trim();
  return scenario.slice(0, 160) || '未标注场景';
};

const cloneSerializable = (value, fallback = {}) => {
  if (!value || typeof value !== 'object') return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return fallback;
  }
};

const resolvePercentile = (sortedValues, percentile) => {
  if (sortedValues.length <= 0) return 0;
  const index = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = index - lowerIndex;
  return sortedValues[lowerIndex] + ((sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight);
};

const createEmptyMetricSummary = () => ({
  count: 0,
  totalCount: 0,
  discardedCount: 0,
  min: 0,
  average: 0,
  p50: 0,
  p95: 0,
  max: 0
});

class RollingMetricSamples {
  constructor(limit) {
    this.limit = limit;
    this.values = new Array(limit);
    this.count = 0;
    this.nextIndex = 0;
    this.sum = 0;
    this.totalCount = 0;
  }

  clear() {
    this.values = new Array(this.limit);
    this.count = 0;
    this.nextIndex = 0;
    this.sum = 0;
    this.totalCount = 0;
  }

  push(value) {
    this.totalCount += 1;
    if (this.count >= this.limit) {
      this.sum -= this.values[this.nextIndex];
    } else {
      this.count += 1;
    }
    this.values[this.nextIndex] = value;
    this.sum += value;
    this.nextIndex = (this.nextIndex + 1) % this.limit;
  }

  toArray() {
    if (this.count <= 0) return [];
    if (this.count < this.limit) return this.values.slice(0, this.count);
    return this.values.slice(this.nextIndex).concat(this.values.slice(0, this.nextIndex));
  }

  summary() {
    if (this.count <= 0) return createEmptyMetricSummary();
    const sortedValues = this.toArray().sort((left, right) => left - right);
    return {
      count: this.count,
      totalCount: this.totalCount,
      discardedCount: Math.max(0, this.totalCount - this.count),
      min: sortedValues[0],
      average: this.sum / Math.max(1, this.count),
      p50: resolvePercentile(sortedValues, 0.5),
      p95: resolvePercentile(sortedValues, 0.95),
      max: sortedValues[sortedValues.length - 1]
    };
  }
}

export default class BattlePerformanceCollector {
  constructor({ sampleLimit = DEFAULT_SAMPLE_LIMIT } = {}) {
    this.sampleLimit = normalizeSampleLimit(sampleLimit);
    this.metrics = Object.fromEntries(
      METRIC_KEYS.map((metricKey) => [metricKey, new RollingMetricSamples(this.sampleLimit)])
    );
    this.active = false;
    this.scenario = '未标注场景';
    this.metadata = {};
    this.startedAtMs = 0;
    this.endedAtMs = 0;
    this.startContext = {};
    this._cachedDebugMetrics = null;
    this._lastDebugMetricRefreshAtMs = 0;
  }

  start({ scenario = '', metadata = {}, context = {}, nowMs } = {}) {
    METRIC_KEYS.forEach((metricKey) => this.metrics[metricKey].clear());
    this.active = true;
    this.scenario = normalizeScenario(scenario);
    this.metadata = cloneSerializable(metadata);
    this.startedAtMs = resolveNowMs(nowMs);
    this.endedAtMs = 0;
    this.startContext = cloneSerializable(context);
    this._cachedDebugMetrics = null;
    this._lastDebugMetricRefreshAtMs = 0;
    return this.getStatus({ nowMs: this.startedAtMs });
  }

  stop({ nowMs } = {}) {
    if (this.active) {
      this.endedAtMs = Math.max(this.startedAtMs, resolveNowMs(nowMs));
      this.active = false;
    }
    this._cachedDebugMetrics = null;
    return this.getStatus({ nowMs: this.endedAtMs || nowMs });
  }

  record(metricKey, value) {
    if (!this.active) return false;
    const bucket = this.metrics[metricKey];
    const numeric = Number(value);
    if (!bucket || !Number.isFinite(numeric) || numeric < 0) return false;
    if (metricKey === 'fps' && numeric <= 0) return false;
    bucket.push(numeric);
    return true;
  }

  getStatus({ nowMs } = {}) {
    const currentMs = resolveNowMs(nowMs);
    const endMs = this.active ? currentMs : (this.endedAtMs || this.startedAtMs || currentMs);
    return {
      active: this.active,
      scenario: this.scenario,
      sampleLimit: this.sampleLimit,
      startedAtMs: this.startedAtMs,
      endedAtMs: this.endedAtMs,
      durationMs: Math.max(0, endMs - this.startedAtMs),
      sampleCounts: Object.fromEntries(
        METRIC_KEYS.map((metricKey) => [metricKey, this.metrics[metricKey].count])
      )
    };
  }

  getDebugSummary({ nowMs } = {}) {
    const currentMs = resolveNowMs(nowMs);
    if (
      !this._cachedDebugMetrics
      || currentMs - this._lastDebugMetricRefreshAtMs >= DEBUG_SUMMARY_REFRESH_MS
    ) {
      this._cachedDebugMetrics = Object.fromEntries(
        METRIC_KEYS.map((metricKey) => [metricKey, this.metrics[metricKey].summary()])
      );
      this._lastDebugMetricRefreshAtMs = currentMs;
    }
    return {
      ...this.getStatus({ nowMs: currentMs }),
      metrics: this._cachedDebugMetrics
    };
  }

  getReport({ context = {}, nowMs } = {}) {
    const currentMs = resolveNowMs(nowMs);
    const status = this.getStatus({ nowMs: currentMs });
    return {
      schemaVersion: PERFORMANCE_REPORT_SCHEMA_VERSION,
      generatedAt: new Date(currentMs).toISOString(),
      capture: {
        ...status,
        metadata: cloneSerializable(this.metadata)
      },
      context: {
        start: cloneSerializable(this.startContext),
        end: cloneSerializable(context)
      },
      metrics: Object.fromEntries(
        METRIC_KEYS.map((metricKey) => [metricKey, this.metrics[metricKey].summary()])
      )
    };
  }
}
