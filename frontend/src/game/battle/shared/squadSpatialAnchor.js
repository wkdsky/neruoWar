const DEFAULT_CLUSTER_EXPANSION = 1.75;
const DEFAULT_CLUSTER_PADDING = 8;

const finiteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const median = (values = []) => {
  if (!Array.isArray(values) || values.length <= 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length * 0.5);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
};

const normalizePoints = (points = []) => (
  (Array.isArray(points) ? points : [])
    .map((point, index) => ({
      index,
      x: Number(point?.x),
      y: Number(point?.y)
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
);

export const resolveSquadSpatialAnchor = (points = [], {
  fallbackX = 0,
  fallbackY = 0,
  minimumRadius = 0,
  radiusPadding = 0,
  clusterExpansion = DEFAULT_CLUSTER_EXPANSION,
  clusterPadding = DEFAULT_CLUSTER_PADDING
} = {}) => {
  const rows = normalizePoints(points);
  if (rows.length <= 0) {
    return {
      x: finiteNumber(fallbackX),
      y: finiteNumber(fallbackY),
      radius: Math.max(0, finiteNumber(minimumRadius)),
      count: 0,
      inlierCount: 0
    };
  }

  const medianX = median(rows.map((point) => point.x));
  const medianY = median(rows.map((point) => point.y));
  const ranked = rows
    .map((point) => ({
      ...point,
      distance: Math.hypot(point.x - medianX, point.y - medianY)
    }))
    .sort((left, right) => (
      left.distance - right.distance
      || left.index - right.index
    ));
  const majorityCount = Math.min(
    ranked.length,
    Math.max(1, Math.floor(ranked.length * 0.5) + 1)
  );
  const majorityRadius = ranked[majorityCount - 1]?.distance || 0;
  const inclusionRadius = Math.max(
    majorityRadius * Math.max(1, finiteNumber(clusterExpansion, DEFAULT_CLUSTER_EXPANSION)),
    majorityRadius + Math.max(0, finiteNumber(clusterPadding, DEFAULT_CLUSTER_PADDING))
  );
  const inliers = ranked.filter((point, index) => (
    index < majorityCount || point.distance <= inclusionRadius
  ));
  const center = inliers.reduce((aggregate, point) => ({
    x: aggregate.x + point.x,
    y: aggregate.y + point.y
  }), { x: 0, y: 0 });
  const x = center.x / Math.max(1, inliers.length);
  const y = center.y / Math.max(1, inliers.length);
  const radius = inliers.reduce((maximum, point) => (
    Math.max(maximum, Math.hypot(point.x - x, point.y - y))
  ), 0);

  return {
    x,
    y,
    radius: Math.max(
      Math.max(0, finiteNumber(minimumRadius)),
      radius + Math.max(0, finiteNumber(radiusPadding))
    ),
    count: rows.length,
    inlierCount: inliers.length
  };
};

export default resolveSquadSpatialAnchor;
