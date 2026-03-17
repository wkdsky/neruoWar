import { buildStarMapLevelOrdering } from './starMapLayoutHelpers';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const STAR_MAP_SECTOR_COUNT = 16;
const STAR_MAP_LAYOUT_SPREAD_ATTEMPTS = [1, 1.18, 1.36, 1.58];
const STAR_MAP_SECTOR_LOCAL_PASSES = 4;
const STAR_MAP_CLUSTER_SWAP_PASSES = 2;
const STAR_MAP_CLUSTER_SIFT_STEPS = [-2, -1, 1, 2];
const STAR_MAP_SECTOR_JITTER = TAU / STAR_MAP_SECTOR_COUNT * 0.14;
const STAR_MAP_MEASURED_LABEL_MAX_SHIFT = 20;
const STAR_MAP_MEASURED_LABEL_ITERATIONS = 14;
const STAR_MAP_DEBUG_SAMPLE_LIMIT = 48;

const STAR_MAP_LAYOUT_WEIGHTS = {
  sectorArea: 0.00024,
  sectorLabelArea: 0.00028,
  sectorCount: 18,
  sectorOverflow: 0.0018,
  preferredAngle: 58,
  parentAngle: 34,
  centerCrossing: 64,
  centerCrossingPair: 120,
  clusterCrossRisk: 18,
  leftRightImbalance: 0.00062,
  topBottomImbalance: 0.00028,
  edgeNearNode: 126,
  edgeNearLabel: 154,
  edgeNearCenterLabel: 180
};

// Phase 1.5: 子树质量感知的角度预算。
// mass 用于决定 cluster 在中心外圈拿到的 wedge span，避免大子树被压成一束长刺。
const STAR_MAP_SUBTREE_MASS_WEIGHTS = {
  visibleNodes: 1,
  labelArea: 0.00018,
  badgeCount: 0.64,
  badgeArea: 0.00026,
  externalEdges: 0.44,
  maxLabelWidth: 0.013,
  depth: 0.42
};

// Phase 1.5: mass-aware wedge budget 常量。
// min/max 约束避免过窄或过宽，padding 用于 wedge 之间留安全缝。
const STAR_MAP_WEDGE_BUDGET = {
  minSpan: TAU / 28,
  maxSpan: TAU / 5.6,
  padding: TAU / 180,
  preferredAngleWeight: 0.78,
  sectorAngleWeight: 0.34
};

const STAR_MAP_LOCAL_PACKING = {
  arcPadding: 18,
  safeGap: 12,
  badgeSafeGap: 16,
  subRingGap: 24,
  maxSubRings: 3,
  maxLocalRadiusExpand: 82
};

const STAR_MAP_BADGE_LAYOUT = {
  fontCharWidth: 6.6,
  minWidth: 22,
  height: 18,
  textPaddingX: 10,
  outwardGap: 6,
  anchorGap: 4,
  minSpacing: 14,
  maxBandExpand: 96
};

const STAR_MAP_MEASURED_LABEL_SCORE_WEIGHTS = {
  labelOverlap: 1,
  nodeLabelOverlap: 1.18,
  edgeNearLabel: 1.42,
  edgeNearNode: 1.22,
  centerCrossing: 1.5
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const stableHash = (value = '') => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const stableUnit = (value = '') => stableHash(value) / 0xffffffff;

const angleDistance = (left = 0, right = 0) => {
  let delta = Math.abs((Number(left) || 0) - (Number(right) || 0));
  while (delta > Math.PI) delta = Math.abs(delta - TAU);
  return delta;
};

const normalizePositiveAngle = (angle = 0) => {
  let value = Number(angle) || 0;
  while (value < 0) value += TAU;
  while (value >= TAU) value -= TAU;
  return value;
};

const averageAngles = (entries = [], fallback = -Math.PI / 2) => {
  if (!Array.isArray(entries) || entries.length < 1) return fallback;
  let sumX = 0;
  let sumY = 0;
  let totalWeight = 0;
  entries.forEach((entry) => {
    const angle = Number(entry?.angle);
    const weight = Math.max(0.0001, Number(entry?.weight) || 1);
    if (!Number.isFinite(angle)) return;
    sumX += Math.cos(angle) * weight;
    sumY += Math.sin(angle) * weight;
    totalWeight += weight;
  });
  if (totalWeight <= 0.0001 || (Math.abs(sumX) <= 0.0001 && Math.abs(sumY) <= 0.0001)) {
    return fallback;
  }
  return Math.atan2(sumY, sumX);
};

const normalize = (x, y, fallback = { x: 0, y: -1 }) => {
  const length = Math.hypot(x, y);
  if (length <= 0.0001) return { ...fallback };
  return {
    x: x / length,
    y: y / length
  };
};

const ensureForce = (forceByKey, key) => {
  let force = forceByKey.get(key);
  if (!force) {
    force = { x: 0, y: 0 };
    forceByKey.set(key, force);
  }
  return force;
};

const rectsOverlap = (left, right) => (
  left.left < right.right
  && left.right > right.left
  && left.top < right.bottom
  && left.bottom > right.top
);

const circleHitsRect = (circle, rect, padding = 0) => {
  const closestX = Math.max(rect.left, Math.min(circle.x, rect.right));
  const closestY = Math.max(rect.top, Math.min(circle.y, rect.bottom));
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  const radius = Math.max(0, circle.radius + padding);
  return (dx * dx + dy * dy) < radius * radius;
};

const distancePointToSegment = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.0001) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return {
      distance: Math.hypot(px, py),
      projection: 0,
      closestX: start.x,
      closestY: start.y
    };
  }

  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  );
  const closestX = start.x + dx * projection;
  const closestY = start.y + dy * projection;
  return {
    distance: Math.hypot(point.x - closestX, point.y - closestY),
    projection,
    closestX,
    closestY
  };
};

const cross2d = (ax, ay, bx, by) => ax * by - ay * bx;

const computeSegmentIntersection = (segmentA, segmentB) => {
  const p = segmentA.start;
  const rX = segmentA.end.x - segmentA.start.x;
  const rY = segmentA.end.y - segmentA.start.y;
  const q = segmentB.start;
  const sX = segmentB.end.x - segmentB.start.x;
  const sY = segmentB.end.y - segmentB.start.y;
  const denominator = cross2d(rX, rY, sX, sY);
  const qpx = q.x - p.x;
  const qpy = q.y - p.y;

  if (Math.abs(denominator) < 0.0001) {
    return { intersects: false };
  }

  const t = cross2d(qpx, qpy, sX, sY) / denominator;
  const u = cross2d(qpx, qpy, rX, rY) / denominator;
  if (t <= 0.06 || t >= 0.94 || u <= 0.06 || u >= 0.94) {
    return { intersects: false };
  }

  return {
    intersects: true,
    x: p.x + t * rX,
    y: p.y + t * rY,
    t,
    u
  };
};

const buildLabelRect = (body) => {
  const width = Number(body.labelWidthHint) || 112;
  const height = Number(body.labelHeightHint) || 28;
  if (body.labelPlacement === 'center') {
    return {
      left: body.x - width * 0.5,
      right: body.x + width * 0.5,
      top: body.y - height * 0.5,
      bottom: body.y + height * 0.5,
      width,
      height,
      centerX: body.x,
      centerY: body.y
    };
  }
  const top = body.y + body.radius + body.labelOffsetY;
  return {
    left: body.x - width * 0.5,
    right: body.x + width * 0.5,
    top,
    bottom: top + height,
    width,
    height,
    centerX: body.x,
    centerY: top + height * 0.5
  };
};

const buildContentBounds = (center, bodies) => {
  const centerLabel = buildLabelRect(center);
  let left = Math.min(center.x - center.radius, centerLabel.left);
  let right = Math.max(center.x + center.radius, centerLabel.right);
  let top = Math.min(center.y - center.radius, centerLabel.top);
  let bottom = Math.max(center.y + center.radius, centerLabel.bottom);

  bodies.forEach((body) => {
    left = Math.min(left, body.x - body.radius, body.labelRect.left);
    right = Math.max(right, body.x + body.radius, body.labelRect.right);
    top = Math.min(top, body.y - body.radius, body.labelRect.top);
    bottom = Math.max(bottom, body.y + body.radius, body.labelRect.bottom);
  });

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top
  };
};

const getSectorIndexForAngle = (angle = 0, sectorCount = STAR_MAP_SECTOR_COUNT) => {
  const normalized = normalizePositiveAngle(angle);
  return Math.max(0, Math.min(sectorCount - 1, Math.floor((normalized / TAU) * sectorCount)));
};

const getSectorCenterAngle = (sectorIndex = 0, sectorCount = STAR_MAP_SECTOR_COUNT) => (
  ((Number(sectorIndex) || 0) + 0.5) * (TAU / sectorCount)
);

const unwrapAngleNear = (angle = 0, reference = 0) => {
  let value = Number(angle) || 0;
  const target = Number(reference) || 0;
  while ((value - target) > Math.PI) value -= TAU;
  while ((value - target) < -Math.PI) value += TAU;
  return value;
};

const estimateStubBadgeMetrics = (hiddenNeighborCount = 0) => {
  const safeCount = Math.max(0, Number(hiddenNeighborCount) || 0);
  const text = `+${safeCount}`;
  const width = clamp(
    text.length * STAR_MAP_BADGE_LAYOUT.fontCharWidth + STAR_MAP_BADGE_LAYOUT.textPaddingX,
    STAR_MAP_BADGE_LAYOUT.minWidth,
    54
  );
  const height = STAR_MAP_BADGE_LAYOUT.height;
  return {
    text,
    width,
    height,
    area: width * height,
    radius: Math.max(8, Math.hypot(width * 0.5, height * 0.5) * 0.42)
  };
};

const buildBoundaryBadgeMeta = ({
  boundaryStubs = [],
  layer = 'title'
} = {}) => {
  const badges = [];
  const badgesBySourceKey = new Map();

  boundaryStubs.forEach((stub, index) => {
    const sourceKey = layer === 'sense'
      ? String(stub?.sourceVertexKey || '')
      : String(stub?.sourceNodeId || '');
    const hiddenNeighborCount = Math.max(0, Number(stub?.hiddenNeighborCount) || 0);
    if (!sourceKey || hiddenNeighborCount <= 0) return;
    const metrics = estimateStubBadgeMetrics(hiddenNeighborCount);
    const stubId = String(stub?.stubId || `${sourceKey}:${index}`);
    const meta = {
      key: `stub-badge:${stubId}`,
      stubId,
      sourceKey,
      sourceLevel: Math.max(1, Number(stub?.sourceLevel) || 1),
      hiddenNeighborCount,
      label: metrics.text,
      width: metrics.width,
      height: metrics.height,
      area: metrics.area,
      radius: metrics.radius
    };
    badges.push(meta);
    const bucket = badgesBySourceKey.get(sourceKey) || [];
    bucket.push(meta);
    badgesBySourceKey.set(sourceKey, bucket);
  });

  return {
    badges,
    badgesBySourceKey
  };
};

const allocateBoundedSpans = ({
  entries = [],
  totalSpan = TAU,
  minSpan = STAR_MAP_WEDGE_BUDGET.minSpan,
  maxSpan = STAR_MAP_WEDGE_BUDGET.maxSpan,
  getWeight = (entry) => entry?.weight || 1
} = {}) => {
  if (!Array.isArray(entries) || entries.length < 1 || totalSpan <= 0.0001) {
    return new Map();
  }

  const count = entries.length;
  const effectiveMin = Math.min(minSpan, totalSpan / Math.max(1, count) * 0.9);
  const effectiveMax = Math.max(
    effectiveMin,
    Math.min(maxSpan, totalSpan - effectiveMin * Math.max(0, count - 1))
  );
  const spans = new Map(entries.map((entry) => [entry.rootKey, effectiveMin]));
  let remaining = Math.max(0, totalSpan - effectiveMin * count);
  let active = entries.slice();

  while (remaining > 0.0001 && active.length > 0) {
    const totalWeight = active.reduce((sum, entry) => sum + Math.max(0.0001, Number(getWeight(entry)) || 1), 0);
    if (totalWeight <= 0.0001) break;
    let distributed = 0;
    const nextActive = [];
    const remainingSpan = remaining;
    active.forEach((entry) => {
      const current = spans.get(entry.rootKey) || effectiveMin;
      const room = effectiveMax - current;
      if (room <= 0.0001) return;
      const share = remainingSpan * (Math.max(0.0001, Number(getWeight(entry)) || 1) / totalWeight);
      const add = Math.min(room, share);
      if (add > 0.0001) {
        spans.set(entry.rootKey, current + add);
        distributed += add;
      }
      if ((room - add) > 0.0001) {
        nextActive.push(entry);
      }
    });
    if (distributed <= 0.0001) break;
    remaining = Math.max(0, remaining - distributed);
    active = nextActive;
  }

  if (remaining > 0.0001) {
    const extra = remaining / count;
    entries.forEach((entry) => {
      spans.set(entry.rootKey, (spans.get(entry.rootKey) || effectiveMin) + extra);
    });
  }

  return spans;
};

const evaluateLocalNodeOrdering = (ordered = [], metaByKey = new Map(), wedgeCenter = 0, wedgeSpan = Math.PI / 3) => {
  if (!Array.isArray(ordered) || ordered.length < 2) return 0;
  const slotSpan = Math.max(0.14, wedgeSpan * 0.82);
  const start = wedgeCenter - slotSpan * 0.5;
  let cost = 0;

  ordered.forEach((nodeKey, index) => {
    const meta = metaByKey.get(nodeKey);
    if (!meta) return;
    const ratio = ordered.length > 1 ? index / Math.max(1, ordered.length - 1) : 0.5;
    const slotAngle = start + slotSpan * ratio;
    cost += Math.abs(slotAngle - meta.targetAngleLinear) * (1.3 + meta.externalWeight * 0.4 + meta.parentWeight * 0.2);
    cost += Math.abs(index - meta.semanticIndex) * 0.18;
  });

  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const leftMeta = metaByKey.get(ordered[leftIndex]);
    if (!leftMeta) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const rightMeta = metaByKey.get(ordered[rightIndex]);
      if (!rightMeta) continue;
      const parentDelta = (leftMeta.parentOrder - rightMeta.parentOrder);
      if (Math.abs(parentDelta) > 0.35 && parentDelta > 0) {
        cost += 1.4 + Math.abs(parentDelta) * 0.2;
      }
      const externalDelta = leftMeta.externalAngleLinear - rightMeta.externalAngleLinear;
      if (Math.abs(externalDelta) > 0.14 && externalDelta > 0) {
        cost += 1 + (leftMeta.externalWeight + rightMeta.externalWeight) * 0.16;
      }
    }
  }

  return cost;
};

const buildRectFromValues = ({
  left = 0,
  right = 0,
  top = 0,
  bottom = 0
} = {}) => ({
  left,
  right,
  top,
  bottom,
  width: right - left,
  height: bottom - top,
  centerX: (left + right) * 0.5,
  centerY: (top + bottom) * 0.5
});

const pointInRect = (point, rect) => (
  point.x >= rect.left
  && point.x <= rect.right
  && point.y >= rect.top
  && point.y <= rect.bottom
);

const pointToRectDistance = (point, rect) => {
  const dx = point.x < rect.left
    ? rect.left - point.x
    : (point.x > rect.right ? point.x - rect.right : 0);
  const dy = point.y < rect.top
    ? rect.top - point.y
    : (point.y > rect.bottom ? point.y - rect.bottom : 0);
  return Math.hypot(dx, dy);
};

const segmentIntersectsRect = (start, end, rect) => {
  if (pointInRect(start, rect) || pointInRect(end, rect)) return true;
  const edges = [
    { start: { x: rect.left, y: rect.top }, end: { x: rect.right, y: rect.top } },
    { start: { x: rect.right, y: rect.top }, end: { x: rect.right, y: rect.bottom } },
    { start: { x: rect.right, y: rect.bottom }, end: { x: rect.left, y: rect.bottom } },
    { start: { x: rect.left, y: rect.bottom }, end: { x: rect.left, y: rect.top } }
  ];
  return edges.some((edge) => computeSegmentIntersection({ start, end }, edge).intersects);
};

const distanceSegmentToRect = (start, end, rect) => {
  if (segmentIntersectsRect(start, end, rect)) {
    return {
      distance: 0,
      closestX: Math.max(rect.left, Math.min((start.x + end.x) * 0.5, rect.right)),
      closestY: Math.max(rect.top, Math.min((start.y + end.y) * 0.5, rect.bottom))
    };
  }

  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom }
  ];
  const pointDistances = corners.map((corner) => distancePointToSegment(corner, start, end));
  const edgeDistances = [
    pointToRectDistance(start, rect),
    pointToRectDistance(end, rect)
  ];
  const closestPoint = pointDistances.sort((left, right) => left.distance - right.distance)[0];
  const minEdgeDistance = Math.min(...edgeDistances);
  if (minEdgeDistance < closestPoint.distance) {
    const closestPointToRect = minEdgeDistance === edgeDistances[0] ? start : end;
    return {
      distance: minEdgeDistance,
      closestX: Math.max(rect.left, Math.min(closestPointToRect.x, rect.right)),
      closestY: Math.max(rect.top, Math.min(closestPointToRect.y, rect.bottom))
    };
  }
  return {
    distance: closestPoint.distance,
    closestX: closestPoint.closestX,
    closestY: closestPoint.closestY
  };
};

const buildBandByLevel = ({
  levels,
  nodesByLevel,
  centerRadius,
  spreadFactor = 1
}) => {
  const bandByLevel = new Map();
  let cursor = centerRadius + 28 * spreadFactor;

  levels.forEach((level) => {
    const nodes = nodesByLevel.get(level) || [];
    const averageWidth = nodes.reduce((sum, node) => sum + (Number(node.labelMetrics?.widthHint) || 112), 0) / Math.max(1, nodes.length);
    const averageLabelHeight = nodes.reduce((sum, node) => sum + (Number(node.labelMetrics?.heightHint) || 28), 0) / Math.max(1, nodes.length);
    const averageRadius = nodes.reduce((sum, node) => sum + (Number(node.radius) || 12), 0) / Math.max(1, nodes.length);
    const bandThickness = clamp(
      (averageRadius * 1.92 + averageLabelHeight * 0.24 + averageWidth * 0.048 + 26) * spreadFactor,
      58,
      124
    );
    const min = cursor;
    const max = cursor + bandThickness;
    const ideal = min + bandThickness * 0.52;
    bandByLevel.set(level, {
      min,
      ideal,
      max,
      thickness: bandThickness
    });
    cursor += bandThickness * 0.68;
  });

  return bandByLevel;
};

const computeNodeImportance = ({
  layer,
  level = 1,
  levelMax = 1,
  degree = 0,
  childCount = 0,
  maxDegree = 1,
  maxChildCount = 1,
  boundaryCount = 0
}) => {
  const degreeNorm = Math.sqrt(Math.max(0, degree) / Math.max(1, maxDegree));
  const childNorm = Math.sqrt(Math.max(0, childCount) / Math.max(1, maxChildCount));
  const levelNorm = 1 - (Math.max(0, level - 1) / Math.max(1, levelMax));
  const boundaryNorm = Math.sqrt(Math.max(0, boundaryCount) / Math.max(1, maxDegree));

  if (layer === 'title') {
    return clamp(
      0.98 + degreeNorm * 0.4 + boundaryNorm * 0.12 + levelNorm * 0.08,
      0.96,
      1.54
    );
  }

  return clamp(
    0.98 + childNorm * 0.42 + levelNorm * 0.22 + degreeNorm * 0.08,
    0.98,
    1.62
  );
};

const pickPrimaryParent = (parents = [], clusterRootByKey = new Map()) => {
  if (!parents.length) return '';
  const scoreByRoot = new Map();
  parents.forEach((parentKey) => {
    const rootKey = clusterRootByKey.get(parentKey) || parentKey;
    const score = scoreByRoot.get(rootKey) || 0;
    scoreByRoot.set(rootKey, score + 1);
  });
  return Array.from(scoreByRoot.entries())
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))[0]?.[0] || '';
};

const buildClusterAssignments = ({
  levels,
  nodesByLevel,
  graphMeta
}) => {
  const clusterRootByKey = new Map();
  const clusterIndexByRoot = new Map();
  const topLevelNodes = (nodesByLevel.get(1) || []).slice().sort((left, right) => {
    const leftDegree = (graphMeta.adjacency.get(left.key)?.size || 0);
    const rightDegree = (graphMeta.adjacency.get(right.key)?.size || 0);
    return rightDegree - leftDegree || String(left.key).localeCompare(String(right.key));
  });

  topLevelNodes.forEach((node, index) => {
    clusterRootByKey.set(node.key, node.key);
    clusterIndexByRoot.set(node.key, index);
  });

  levels
    .filter((level) => level > 1)
    .forEach((level) => {
      const nodes = (nodesByLevel.get(level) || []).slice().sort((left, right) => String(left.key).localeCompare(String(right.key)));
      nodes.forEach((node) => {
        const parents = Array.from(graphMeta.previousLevelNeighbors.get(node.key) || []).sort();
        const primaryRoot = pickPrimaryParent(parents, clusterRootByKey);
        const resolvedRoot = primaryRoot || node.key;
        clusterRootByKey.set(node.key, resolvedRoot);
        if (!clusterIndexByRoot.has(resolvedRoot)) {
          clusterIndexByRoot.set(resolvedRoot, clusterIndexByRoot.size);
        }
      });
    });

  const clusters = new Map();
  levels.forEach((level) => {
    (nodesByLevel.get(level) || []).forEach((node) => {
      const clusterRoot = clusterRootByKey.get(node.key) || node.key;
      const cluster = clusters.get(clusterRoot) || {
        rootKey: clusterRoot,
        index: clusterIndexByRoot.get(clusterRoot) ?? clusters.size,
        nodes: [],
        weight: 0,
        totalDegree: 0,
        totalLabelWidth: 0
      };
      cluster.nodes.push(node);
      const degree = graphMeta.adjacency.get(node.key)?.size || 0;
      cluster.weight += 1 + degree * 0.18;
      cluster.totalDegree += degree;
      cluster.totalLabelWidth += Number(node.labelMetrics?.widthHint) || 112;
      clusters.set(clusterRoot, cluster);
    });
  });

  return {
    clusterRootByKey,
    clusters: Array.from(clusters.values())
      .map((cluster) => {
        const count = Math.max(1, cluster.nodes.length);
        const averageDegree = cluster.totalDegree / count;
        const averageLabelWidth = cluster.totalLabelWidth / count;
        return {
          ...cluster,
          averageDegree,
          averageLabelWidth,
          spreadScore: 1 + averageDegree * 0.72 + count * 0.32 + averageLabelWidth * 0.012
        };
      })
      .sort((left, right) => (
        right.spreadScore - left.spreadScore || right.weight - left.weight || left.index - right.index || String(left.rootKey).localeCompare(String(right.rootKey))
      ))
  };
};

const buildClusterAdjacencyMeta = ({
  clusters = [],
  clusterRootByKey = new Map(),
  graphMeta
}) => {
  const weightByPairKey = new Map();
  const degreeByRoot = new Map();
  graphMeta.adjacency.forEach((neighbors, key) => {
    const fromRoot = clusterRootByKey.get(key) || key;
    neighbors.forEach((neighborKey) => {
      const toRoot = clusterRootByKey.get(neighborKey) || neighborKey;
      if (!fromRoot || !toRoot || fromRoot === toRoot) return;
      const pairKey = fromRoot < toRoot ? `${fromRoot}|${toRoot}` : `${toRoot}|${fromRoot}`;
      weightByPairKey.set(pairKey, (weightByPairKey.get(pairKey) || 0) + 1);
      degreeByRoot.set(fromRoot, (degreeByRoot.get(fromRoot) || 0) + 1);
    });
  });

  const neighborWeightByRoot = new Map(clusters.map((cluster) => [cluster.rootKey, new Map()]));
  weightByPairKey.forEach((weight, pairKey) => {
    const [leftRoot, rightRoot] = pairKey.split('|');
    if (!neighborWeightByRoot.has(leftRoot)) neighborWeightByRoot.set(leftRoot, new Map());
    if (!neighborWeightByRoot.has(rightRoot)) neighborWeightByRoot.set(rightRoot, new Map());
    neighborWeightByRoot.get(leftRoot).set(rightRoot, weight);
    neighborWeightByRoot.get(rightRoot).set(leftRoot, weight);
  });

  return {
    neighborWeightByRoot,
    degreeByRoot
  };
};

const buildClusterSectorPlan = ({
  center,
  centerKey = '',
  clusters = [],
  levels,
  nodesByLevel,
  graphMeta,
  labelMetricsByKey,
  primaryParentByKey,
  clusterRootByKey,
  boundaryBadgeMeta = { badges: [], badgesBySourceKey: new Map() },
  sectorCount = STAR_MAP_SECTOR_COUNT
}) => {
  if (!Array.isArray(clusters) || clusters.length < 1) {
    return {
      sectorCount,
      assignmentByRoot: new Map(),
      preferredAngleByRoot: new Map(),
      wedgeByRoot: new Map(),
      sectorState: Array.from({ length: sectorCount }, () => ({
        area: 0,
        labelArea: 0,
        nodeCount: 0,
        clusters: []
      })),
      clusterMetaByRoot: new Map(),
      angleByKey: new Map(),
      orderByKey: new Map(),
      subtreeWeightByKey: new Map(),
      debug: {
        sectorCount,
        sectors: [],
        wedges: []
      }
    };
  }

  const ordering = buildStarMapLevelOrdering({
    centerKey,
    levels,
    nodesByLevel,
    graphMeta,
    labelMetricsByKey
  });
  const { subtreeWeightByKey = new Map(), angleByKey = new Map() } = ordering || {};
  const clusterAdjacencyMeta = buildClusterAdjacencyMeta({
    clusters,
    clusterRootByKey,
    graphMeta
  });
  const badgesBySourceKey = boundaryBadgeMeta?.badgesBySourceKey || new Map();

  const clusterMetaByRoot = new Map();
  const preferredAngleByRoot = new Map();
  const assignmentByRoot = new Map();
  const sectorState = Array.from({ length: sectorCount }, () => ({
    area: 0,
    labelArea: 0,
    nodeCount: 0,
    clusters: []
  }));

  clusters.forEach((cluster, index) => {
    const nodeAngles = cluster.nodes.map((node) => ({
      angle: angleByKey.get(node.key),
      weight: (subtreeWeightByKey.get(node.key) || 1) + Math.max(0.2, (Number(node.labelMetrics?.angularWeight) || 1) * 0.2)
    })).filter((entry) => Number.isFinite(entry.angle));
    const fallbackAngle = GOLDEN_ANGLE * index + stableUnit(`${cluster.rootKey}:preferred`) * 0.62;
    const preferredAngle = averageAngles(nodeAngles, fallbackAngle);
    const parentAngle = averageAngles(
      cluster.nodes.flatMap((node) => {
        const parentKey = primaryParentByKey.get(node.key);
        const parentAngle = parentKey ? angleByKey.get(parentKey) : preferredAngle;
        return Number.isFinite(parentAngle)
          ? [{ angle: parentAngle, weight: 1 + (graphMeta.adjacency.get(node.key)?.size || 0) * 0.12 }]
          : [];
      }),
      preferredAngle
    );
    const area = cluster.nodes.reduce((sum, node) => {
      const labelMetrics = labelMetricsByKey.get(node.key) || node.labelMetrics;
      const radius = Number(node.radius) || 18;
      return sum + (Math.PI * radius * radius) + ((Number(labelMetrics?.widthHint) || 112) * (Number(labelMetrics?.heightHint) || 28));
    }, 0);
    const labelArea = cluster.nodes.reduce((sum, node) => {
      const labelMetrics = labelMetricsByKey.get(node.key) || node.labelMetrics;
      return sum + ((Number(labelMetrics?.widthHint) || 112) * (Number(labelMetrics?.heightHint) || 28));
    }, 0);
    const badgeEntries = cluster.nodes.flatMap((node) => badgesBySourceKey.get(node.key) || []);
    const badgeCount = badgeEntries.reduce((sum, badge) => sum + Math.max(1, Number(badge?.hiddenNeighborCount) || 0), 0);
    const badgeArea = badgeEntries.reduce((sum, badge) => sum + (Number(badge?.area) || 0), 0);
    const maxLabelWidth = cluster.nodes.reduce((sum, node) => {
      const labelMetrics = labelMetricsByKey.get(node.key) || node.labelMetrics;
      return Math.max(sum, Number(labelMetrics?.widthHint) || 112);
    }, badgeEntries.reduce((sum, badge) => Math.max(sum, Number(badge?.width) || 0), 0));
    const interconnectWeight = clusterAdjacencyMeta.degreeByRoot.get(cluster.rootKey) || 0;
    const centerTouchCount = cluster.nodes.filter((node) => {
      const previous = graphMeta.previousLevelNeighbors.get(node.key);
      return previous?.size > 0 && Array.from(previous).some((parentKey) => !clusterRootByKey.has(parentKey) || parentKey === cluster.rootKey);
    }).length;
    const levelValues = cluster.nodes
      .map((node) => Number(node?.level) || 1)
      .filter((value) => Number.isFinite(value));
    const clusterDepth = levelValues.length > 0
      ? (Math.max(...levelValues) - Math.min(...levelValues) + 1)
      : 1;
    const subtreeMass = (
      cluster.nodes.length * STAR_MAP_SUBTREE_MASS_WEIGHTS.visibleNodes
      + labelArea * STAR_MAP_SUBTREE_MASS_WEIGHTS.labelArea
      + badgeCount * STAR_MAP_SUBTREE_MASS_WEIGHTS.badgeCount
      + badgeArea * STAR_MAP_SUBTREE_MASS_WEIGHTS.badgeArea
      + interconnectWeight * STAR_MAP_SUBTREE_MASS_WEIGHTS.externalEdges
      + maxLabelWidth * STAR_MAP_SUBTREE_MASS_WEIGHTS.maxLabelWidth
      + clusterDepth * STAR_MAP_SUBTREE_MASS_WEIGHTS.depth
    );
    const meta = {
      ...cluster,
      preferredAngle,
      parentAngle,
      area,
      labelArea,
      badgeCount,
      badgeArea,
      maxLabelWidth,
      clusterDepth,
      subtreeMass,
      centerTouchCount,
      interconnectWeight
    };
    clusterMetaByRoot.set(cluster.rootKey, meta);
    preferredAngleByRoot.set(cluster.rootKey, preferredAngle);
  });

  const applyClusterToSector = (clusterRoot, sectorIndex) => {
    const cluster = clusterMetaByRoot.get(clusterRoot);
    const state = sectorState[sectorIndex];
    state.area += cluster.area;
    state.labelArea += cluster.labelArea;
    state.nodeCount += cluster.nodes.length;
    state.clusters.push(clusterRoot);
    assignmentByRoot.set(clusterRoot, sectorIndex);
  };

  const removeClusterFromSector = (clusterRoot, sectorIndex) => {
    const cluster = clusterMetaByRoot.get(clusterRoot);
    const state = sectorState[sectorIndex];
    state.area -= cluster.area;
    state.labelArea -= cluster.labelArea;
    state.nodeCount -= cluster.nodes.length;
    state.clusters = state.clusters.filter((item) => item !== clusterRoot);
    assignmentByRoot.delete(clusterRoot);
  };

  const evaluateSectorCost = (clusterRoot, sectorIndex) => {
    const cluster = clusterMetaByRoot.get(clusterRoot);
    const sectorAngle = getSectorCenterAngle(sectorIndex, sectorCount);
    const state = sectorState[sectorIndex];
    const angleOffset = angleDistance(sectorAngle, cluster.preferredAngle);
    const parentOffset = angleDistance(sectorAngle, cluster.parentAngle);
    const oppositeDelta = Math.max(0, angleOffset - Math.PI * 0.42);
    const centerCrossRisk = oppositeDelta * oppositeDelta * (1 + cluster.centerTouchCount * 0.4);
    const sectorAreaTotal = state.area + cluster.area;
    const sectorLabelTotal = state.labelArea + cluster.labelArea;
    const sectorCountTotal = state.nodeCount + cluster.nodes.length;
    const occupancyPenalty = (
      sectorAreaTotal * STAR_MAP_LAYOUT_WEIGHTS.sectorArea
      + sectorLabelTotal * STAR_MAP_LAYOUT_WEIGHTS.sectorLabelArea
      + sectorCountTotal * STAR_MAP_LAYOUT_WEIGHTS.sectorCount
    );
    const sectorOverflow = Math.max(0, sectorAreaTotal - 32000);
    let neighborCrossRisk = 0;
    const neighborWeights = clusterAdjacencyMeta.neighborWeightByRoot.get(clusterRoot) || new Map();
    neighborWeights.forEach((weight, neighborRoot) => {
      const neighborSector = assignmentByRoot.get(neighborRoot);
      if (!Number.isFinite(neighborSector)) return;
      const neighborMeta = clusterMetaByRoot.get(neighborRoot);
      const neighborAngle = getSectorCenterAngle(neighborSector, sectorCount);
      const placedAngleDelta = angleDistance(sectorAngle, neighborAngle);
      const preferredDelta = angleDistance(cluster.preferredAngle, neighborMeta?.preferredAngle || neighborAngle);
      neighborCrossRisk += Math.abs(placedAngleDelta - preferredDelta) * weight;
    });

    return (
      occupancyPenalty
      + sectorOverflow * sectorOverflow * STAR_MAP_LAYOUT_WEIGHTS.sectorOverflow
      + angleOffset * STAR_MAP_LAYOUT_WEIGHTS.preferredAngle
      + parentOffset * STAR_MAP_LAYOUT_WEIGHTS.parentAngle
      + centerCrossRisk * STAR_MAP_LAYOUT_WEIGHTS.centerCrossing
      + neighborCrossRisk * STAR_MAP_LAYOUT_WEIGHTS.clusterCrossRisk
    );
  };

  const orderedClusters = clusters
    .slice()
    .sort((left, right) => (
      (clusterMetaByRoot.get(right.rootKey)?.spreadScore || right.spreadScore || 0)
      - (clusterMetaByRoot.get(left.rootKey)?.spreadScore || left.spreadScore || 0)
      || String(left.rootKey).localeCompare(String(right.rootKey))
    ));

  orderedClusters.forEach((cluster) => {
    const best = Array.from({ length: sectorCount }, (_, sectorIndex) => ({
      sectorIndex,
      cost: evaluateSectorCost(cluster.rootKey, sectorIndex)
    })).sort((left, right) => left.cost - right.cost)[0];
    applyClusterToSector(cluster.rootKey, best.sectorIndex);
  });

  const maybeMoveCluster = (clusterRoot, nextSector) => {
    const currentSector = assignmentByRoot.get(clusterRoot);
    if (!Number.isFinite(currentSector) || currentSector === nextSector) return false;
    const currentCost = evaluateSectorCost(clusterRoot, currentSector);
    removeClusterFromSector(clusterRoot, currentSector);
    const nextCost = evaluateSectorCost(clusterRoot, nextSector);
    if (nextCost + 0.001 < currentCost) {
      applyClusterToSector(clusterRoot, nextSector);
      return true;
    }
    applyClusterToSector(clusterRoot, currentSector);
    return false;
  };

  const maybeSwapClusters = (leftRoot, rightRoot) => {
    const leftSector = assignmentByRoot.get(leftRoot);
    const rightSector = assignmentByRoot.get(rightRoot);
    if (!Number.isFinite(leftSector) || !Number.isFinite(rightSector) || leftSector === rightSector) return false;
    const baseline = evaluateSectorCost(leftRoot, leftSector) + evaluateSectorCost(rightRoot, rightSector);
    removeClusterFromSector(leftRoot, leftSector);
    removeClusterFromSector(rightRoot, rightSector);
    const swapped = evaluateSectorCost(leftRoot, rightSector) + evaluateSectorCost(rightRoot, leftSector);
    if (swapped + 0.001 < baseline) {
      applyClusterToSector(leftRoot, rightSector);
      applyClusterToSector(rightRoot, leftSector);
      return true;
    }
    applyClusterToSector(leftRoot, leftSector);
    applyClusterToSector(rightRoot, rightSector);
    return false;
  };

  for (let pass = 0; pass < STAR_MAP_SECTOR_LOCAL_PASSES; pass += 1) {
    orderedClusters.forEach((cluster) => {
      const currentSector = assignmentByRoot.get(cluster.rootKey);
      const oppositeSector = (currentSector + sectorCount / 2) % sectorCount;
      maybeMoveCluster(cluster.rootKey, oppositeSector);
      STAR_MAP_CLUSTER_SIFT_STEPS.forEach((step) => {
        const sector = (currentSector + step + sectorCount) % sectorCount;
        maybeMoveCluster(cluster.rootKey, sector);
      });
    });
  }

  for (let pass = 0; pass < STAR_MAP_CLUSTER_SWAP_PASSES; pass += 1) {
    for (let leftIndex = 0; leftIndex < orderedClusters.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < orderedClusters.length; rightIndex += 1) {
        maybeSwapClusters(orderedClusters[leftIndex].rootKey, orderedClusters[rightIndex].rootKey);
      }
    }
  }

  const sectorsDebug = sectorState.map((state, sectorIndex) => ({
    sectorIndex,
    angle: getSectorCenterAngle(sectorIndex, sectorCount),
    area: state.area,
    labelArea: state.labelArea,
    nodeCount: state.nodeCount,
    clusters: state.clusters.slice()
  }));

  const orderedWedges = clusters
    .slice()
    .sort((left, right) => {
      const leftSector = Number(assignmentByRoot.get(left.rootKey) ?? -1);
      const rightSector = Number(assignmentByRoot.get(right.rootKey) ?? -1);
      const leftMeta = clusterMetaByRoot.get(left.rootKey);
      const rightMeta = clusterMetaByRoot.get(right.rootKey);
      return (
        leftSector - rightSector
        || normalizePositiveAngle(leftMeta?.preferredAngle || 0) - normalizePositiveAngle(rightMeta?.preferredAngle || 0)
        || String(left.rootKey).localeCompare(String(right.rootKey))
      );
    })
    .map((cluster) => {
      const meta = clusterMetaByRoot.get(cluster.rootKey);
      const sectorIndex = assignmentByRoot.get(cluster.rootKey);
      const sectorAngle = getSectorCenterAngle(sectorIndex, sectorCount);
      return {
        ...cluster,
        sectorIndex,
        sectorAngle,
        preferredAngle: meta?.preferredAngle ?? sectorAngle,
        subtreeMass: meta?.subtreeMass || 1
      };
    });

  const totalPadding = STAR_MAP_WEDGE_BUDGET.padding * Math.max(0, orderedWedges.length);
  const usableSpan = Math.max(TAU * 0.42, TAU - totalPadding);
  const spanByRoot = allocateBoundedSpans({
    entries: orderedWedges,
    totalSpan: usableSpan,
    minSpan: STAR_MAP_WEDGE_BUDGET.minSpan,
    maxSpan: STAR_MAP_WEDGE_BUDGET.maxSpan,
    getWeight: (entry) => entry.subtreeMass
  });
  const wedgeByRoot = new Map();

  if (orderedWedges.length > 0) {
    const desiredCenters = [];
    orderedWedges.forEach((entry, index) => {
      const mixedAngle = averageAngles([
        { angle: entry.preferredAngle, weight: STAR_MAP_WEDGE_BUDGET.preferredAngleWeight },
        { angle: entry.sectorAngle, weight: STAR_MAP_WEDGE_BUDGET.sectorAngleWeight }
      ], entry.preferredAngle);
      if (index === 0) {
        desiredCenters.push(normalizePositiveAngle(mixedAngle));
        return;
      }
      const previous = orderedWedges[index - 1];
      const previousDesired = desiredCenters[index - 1];
      const minCenter = previousDesired
        + (spanByRoot.get(previous.rootKey) || STAR_MAP_WEDGE_BUDGET.minSpan) * 0.5
        + STAR_MAP_WEDGE_BUDGET.padding
        + (spanByRoot.get(entry.rootKey) || STAR_MAP_WEDGE_BUDGET.minSpan) * 0.5;
      desiredCenters.push(Math.max(minCenter, unwrapAngleNear(normalizePositiveAngle(mixedAngle), minCenter)));
    });

    const placedCenters = [];
    orderedWedges.forEach((entry, index) => {
      const span = spanByRoot.get(entry.rootKey) || STAR_MAP_WEDGE_BUDGET.minSpan;
      if (index === 0) {
        placedCenters.push(desiredCenters[index]);
        return;
      }
      const previousEntry = orderedWedges[index - 1];
      const previousCenter = placedCenters[index - 1];
      const minCenter = previousCenter
        + (spanByRoot.get(previousEntry.rootKey) || STAR_MAP_WEDGE_BUDGET.minSpan) * 0.5
        + STAR_MAP_WEDGE_BUDGET.padding
        + span * 0.5;
      placedCenters.push(Math.max(minCenter, desiredCenters[index]));
    });

    const weightedShift = orderedWedges.reduce((sum, entry, index) => {
      const desired = desiredCenters[index];
      const placed = placedCenters[index];
      const weight = Math.max(0.5, Number(entry.subtreeMass) || 1);
      return {
        delta: sum.delta + (desired - placed) * weight,
        weight: sum.weight + weight
      };
    }, { delta: 0, weight: 0 });
    const shift = weightedShift.weight > 0.0001 ? (weightedShift.delta / weightedShift.weight) : 0;

    orderedWedges.forEach((entry, index) => {
      const span = spanByRoot.get(entry.rootKey) || STAR_MAP_WEDGE_BUDGET.minSpan;
      const centerAngle = normalizePositiveAngle(placedCenters[index] + shift);
      wedgeByRoot.set(entry.rootKey, {
        rootKey: entry.rootKey,
        sectorIndex: entry.sectorIndex,
        centerAngle,
        startAngle: normalizePositiveAngle(centerAngle - span * 0.5),
        endAngle: normalizePositiveAngle(centerAngle + span * 0.5),
        span,
        padding: STAR_MAP_WEDGE_BUDGET.padding
      });
    });
  }

  return {
    sectorCount,
    assignmentByRoot,
    preferredAngleByRoot,
    wedgeByRoot,
    sectorState,
    clusterMetaByRoot,
    angleByKey,
    orderByKey: ordering?.orderByKey || new Map(),
    subtreeWeightByKey,
    debug: {
      sectorCount,
      sectors: sectorsDebug,
      wedges: orderedWedges.map((entry) => {
        const wedge = wedgeByRoot.get(entry.rootKey);
        return {
          rootKey: entry.rootKey,
          sectorIndex: entry.sectorIndex,
          preferredAngle: entry.preferredAngle,
          centerAngle: wedge?.centerAngle ?? entry.sectorAngle,
          span: wedge?.span ?? 0,
          subtreeMass: entry.subtreeMass
        };
      })
    }
  };
};

const buildClusterAnchors = ({
  center,
  width,
  height,
  clusters,
  spreadFactor = 1,
  sectorPlan = null
}) => {
  const anchors = new Map();
  const maxAnchorRadius = Math.min(width, height) * 0.26 * spreadFactor;
  const minAnchorRadius = Math.min(width, height) * 0.1 * spreadFactor;

  clusters.forEach((cluster, index) => {
    const unit = stableUnit(`${cluster.rootKey}:anchor`);
    const wedge = sectorPlan?.wedgeByRoot?.get?.(cluster.rootKey);
    const sectorCenterAngle = wedge?.centerAngle ?? (GOLDEN_ANGLE * index + unit * 0.7);
    const preferredAngle = sectorPlan?.preferredAngleByRoot?.get?.(cluster.rootKey);
    const jitterWindow = wedge?.span
      ? Math.min(STAR_MAP_SECTOR_JITTER, wedge.span * 0.12)
      : STAR_MAP_SECTOR_JITTER;
    const angle = sectorCenterAngle + ((unit - 0.5) * jitterWindow) + (Number.isFinite(preferredAngle) ? Math.sin(preferredAngle) * 0.02 : 0);
    const subtreeMass = Number(sectorPlan?.clusterMetaByRoot?.get?.(cluster.rootKey)?.subtreeMass || cluster.spreadScore || 1);
    const radialUnit = clamp(
      0.18
        + Math.sqrt((index + 0.8) / Math.max(1, clusters.length + 0.8)) * 0.44
        + Math.min(0.32, (cluster.spreadScore - 1) * 0.04)
        + Math.min(0.18, Math.sqrt(subtreeMass) * 0.012),
      0.18,
      0.96
    );
    const radius = minAnchorRadius + (maxAnchorRadius - minAnchorRadius) * radialUnit;
    anchors.set(cluster.rootKey, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      angle,
      radius,
      idealX: center.x + Math.cos(angle) * radius,
      idealY: center.y + Math.sin(angle) * radius,
      sectorIndex: wedge?.sectorIndex ?? -1
    });
  });

  for (let iteration = 0; iteration < 22; iteration += 1) {
    const forces = new Map();
    clusters.forEach((cluster) => {
      forces.set(cluster.rootKey, { x: 0, y: 0 });
    });

    for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
      const left = clusters[leftIndex];
      const leftAnchor = anchors.get(left.rootKey);
      for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
        const right = clusters[rightIndex];
        const rightAnchor = anchors.get(right.rootKey);
        const dx = rightAnchor.x - leftAnchor.x;
        const dy = rightAnchor.y - leftAnchor.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const minDistance = (
          82
          + Math.min(110, Math.sqrt(left.spreadScore * right.spreadScore) * 14)
        ) * spreadFactor;
        if (distance >= minDistance) continue;
        const push = (minDistance - distance) * 0.08;
        const unit = normalize(dx, dy, { x: 1, y: 0 });
        forces.get(left.rootKey).x -= unit.x * push;
        forces.get(left.rootKey).y -= unit.y * push;
        forces.get(right.rootKey).x += unit.x * push;
        forces.get(right.rootKey).y += unit.y * push;
      }
    }

    clusters.forEach((cluster) => {
      const anchor = anchors.get(cluster.rootKey);
      const force = forces.get(cluster.rootKey);
      const toCenter = normalize(anchor.x - center.x, anchor.y - center.y, { x: Math.cos(anchor.angle), y: Math.sin(anchor.angle) });
      const distance = Math.hypot(anchor.x - center.x, anchor.y - center.y);
      const idealDistance = anchor.radius;
      force.x += (anchor.idealX - anchor.x) * 0.08;
      force.y += (anchor.idealY - anchor.y) * 0.08;
      force.x += toCenter.x * (idealDistance - distance) * 0.08;
      force.y += toCenter.y * (idealDistance - distance) * 0.08;
      anchor.x += force.x;
      anchor.y += force.y;
    });
  }

  return anchors;
};

const buildClusterLocalOrdering = ({
  levels = [],
  nodesByLevel = new Map(),
  clusters = [],
  clusterRootByKey = new Map(),
  graphMeta,
  primaryParentByKey = new Map(),
  sectorPlan = null
}) => {
  const orderIndexByKey = new Map();
  const memberOrderByCluster = new Map();
  const siblingOrderByParent = new Map();
  const clusterByRoot = new Map(clusters.map((cluster) => [cluster.rootKey, cluster]));

  clusters.forEach((cluster) => {
    memberOrderByCluster.set(cluster.rootKey, []);
  });

  levels.forEach((level) => {
    const levelNodes = nodesByLevel.get(level) || [];
    const levelNodesByCluster = new Map();
    levelNodes.forEach((node) => {
      const clusterRoot = clusterRootByKey.get(node.key) || node.key;
      const bucket = levelNodesByCluster.get(clusterRoot) || [];
      bucket.push(node);
      levelNodesByCluster.set(clusterRoot, bucket);
    });

    levelNodesByCluster.forEach((nodes, clusterRoot) => {
      const wedge = sectorPlan?.wedgeByRoot?.get?.(clusterRoot);
      const clusterMeta = sectorPlan?.clusterMetaByRoot?.get?.(clusterRoot) || clusterByRoot.get(clusterRoot);
      const wedgeCenterLinear = normalizePositiveAngle(wedge?.centerAngle ?? clusterMeta?.preferredAngle ?? -Math.PI / 2);
      const wedgeSpan = wedge?.span || Math.max(TAU / STAR_MAP_SECTOR_COUNT, Math.PI / 5);
      const baseline = nodes
        .slice()
        .sort((left, right) => (
          (Number(sectorPlan?.orderByKey?.get?.(left.key) || 0) - Number(sectorPlan?.orderByKey?.get?.(right.key) || 0))
          || String(left.key).localeCompare(String(right.key))
        ))
        .map((node, index) => ({ key: node.key, index }));
      const baselineIndexByKey = new Map(baseline.map((entry) => [entry.key, entry.index]));
      const metaByKey = new Map();

      nodes.forEach((node) => {
        const parents = Array.from(graphMeta.previousLevelNeighbors.get(node.key) || []);
        const parentOrderValues = parents
          .map((parentKey) => Number(sectorPlan?.orderByKey?.get?.(parentKey)))
          .filter((value) => Number.isFinite(value));
        const parentAngleEntries = parents
          .map((parentKey) => {
            const parentAngle = sectorPlan?.angleByKey?.get?.(parentKey);
            return Number.isFinite(parentAngle)
              ? { angle: parentAngle, weight: 2.2 }
              : null;
          })
          .filter(Boolean);
        const externalNeighborEntries = Array.from(graphMeta.adjacency.get(node.key) || [])
          .filter((neighborKey) => (clusterRootByKey.get(neighborKey) || neighborKey) !== clusterRoot)
          .map((neighborKey) => {
            const neighborRoot = clusterRootByKey.get(neighborKey) || neighborKey;
            const neighborAngle = sectorPlan?.angleByKey?.get?.(neighborKey)
              ?? sectorPlan?.wedgeByRoot?.get?.(neighborRoot)?.centerAngle
              ?? sectorPlan?.preferredAngleByRoot?.get?.(neighborRoot);
            return Number.isFinite(neighborAngle)
              ? { angle: neighborAngle, weight: 1.3 }
              : null;
          })
          .filter(Boolean);
        const sameLevelExternalEntries = Array.from(graphMeta.sameLevelNeighbors.get(node.key) || [])
          .filter((neighborKey) => (clusterRootByKey.get(neighborKey) || neighborKey) !== clusterRoot)
          .map((neighborKey) => {
            const neighborAngle = sectorPlan?.angleByKey?.get?.(neighborKey)
              ?? sectorPlan?.wedgeByRoot?.get?.(clusterRootByKey.get(neighborKey) || neighborKey)?.centerAngle;
            return Number.isFinite(neighborAngle)
              ? { angle: neighborAngle, weight: 1.08 }
              : null;
          })
          .filter(Boolean);
        const targetAngle = averageAngles([
          { angle: wedge?.centerAngle ?? clusterMeta?.preferredAngle ?? -Math.PI / 2, weight: level <= 1 ? 2.8 : 1.2 },
          ...parentAngleEntries,
          ...externalNeighborEntries,
          ...sameLevelExternalEntries
        ], wedge?.centerAngle ?? clusterMeta?.preferredAngle ?? -Math.PI / 2);
        const externalAngle = averageAngles([
          ...externalNeighborEntries,
          ...sameLevelExternalEntries
        ], targetAngle);
        metaByKey.set(node.key, {
          key: node.key,
          targetAngleLinear: unwrapAngleNear(normalizePositiveAngle(targetAngle), wedgeCenterLinear),
          externalAngleLinear: unwrapAngleNear(normalizePositiveAngle(externalAngle), wedgeCenterLinear),
          externalWeight: externalNeighborEntries.length + sameLevelExternalEntries.length,
          parentOrder: parentOrderValues.length > 0
            ? parentOrderValues.reduce((sum, value) => sum + value, 0) / parentOrderValues.length
            : Number.POSITIVE_INFINITY,
          parentWeight: parentAngleEntries.length,
          semanticIndex: baselineIndexByKey.get(node.key) ?? 0
        });
      });

      let ordered = nodes
        .slice()
        .sort((left, right) => {
          const leftMeta = metaByKey.get(left.key);
          const rightMeta = metaByKey.get(right.key);
          return (
            (leftMeta?.targetAngleLinear || 0) - (rightMeta?.targetAngleLinear || 0)
            || (leftMeta?.parentOrder || 0) - (rightMeta?.parentOrder || 0)
            || (leftMeta?.semanticIndex || 0) - (rightMeta?.semanticIndex || 0)
            || String(left.key).localeCompare(String(right.key))
          );
        })
        .map((node) => node.key);

      for (let pass = 0; pass < 3; pass += 1) {
        for (let index = 0; index < ordered.length - 1; index += 1) {
          const currentScore = evaluateLocalNodeOrdering(ordered, metaByKey, wedgeCenterLinear, wedgeSpan);
          const swapped = ordered.slice();
          const next = swapped[index];
          swapped[index] = swapped[index + 1];
          swapped[index + 1] = next;
          const nextScore = evaluateLocalNodeOrdering(swapped, metaByKey, wedgeCenterLinear, wedgeSpan);
          if (nextScore + 0.001 < currentScore) {
            ordered = swapped;
          }
        }
      }

      const memberOrder = memberOrderByCluster.get(clusterRoot) || [];
      ordered.forEach((nodeKey, localIndex) => {
        memberOrder.push(nodeKey);
        orderIndexByKey.set(nodeKey, localIndex);
        const parentKey = primaryParentByKey.get(nodeKey);
        if (parentKey) {
          const bucket = siblingOrderByParent.get(parentKey) || [];
          bucket.push(nodeKey);
          siblingOrderByParent.set(parentKey, bucket);
        }
      });
      memberOrderByCluster.set(clusterRoot, memberOrder);
    });
  });

  siblingOrderByParent.forEach((bucket, parentKey) => {
    bucket.sort((leftKey, rightKey) => (
      (orderIndexByKey.get(leftKey) || 0) - (orderIndexByKey.get(rightKey) || 0)
      || String(leftKey).localeCompare(String(rightKey))
    ));
    siblingOrderByParent.set(parentKey, bucket);
  });

  return {
    orderIndexByKey,
    memberOrderByCluster,
    siblingOrderByParent
  };
};

const estimatePackingArcDemand = ({
  radius = 16,
  collisionRadius = 18,
  labelWidthHint = 112,
  safetyRadius = 32,
  isBadge = false,
  badgeWidth = 0
} = {}) => {
  const baseWidth = isBadge ? badgeWidth : labelWidthHint * 0.72;
  const baseGap = isBadge ? STAR_MAP_LOCAL_PACKING.badgeSafeGap : STAR_MAP_LOCAL_PACKING.safeGap;
  return Math.max(
    baseWidth + baseGap,
    collisionRadius * 2 + safetyRadius * 0.12 + baseGap,
    radius * 2 + baseGap
  );
};

const buildClusterPackingPlan = ({
  levels = [],
  nodesByLevel = new Map(),
  clusterRootByKey = new Map(),
  boundaryBadgeMeta = { badges: [], badgesBySourceKey: new Map() },
  nodeSeedMetricsByKey = new Map(),
  bandByLevel = new Map(),
  sectorPlan = null,
  memberOrderByCluster = new Map()
}) => {
  const packingByItemKey = new Map();
  const badgesBySourceKey = boundaryBadgeMeta?.badgesBySourceKey || new Map();

  levels.forEach((level) => {
    const levelNodes = nodesByLevel.get(level) || [];
    const itemsByCluster = new Map();

    levelNodes.forEach((node) => {
      const clusterRoot = clusterRootByKey.get(node.key) || node.key;
      const bucket = itemsByCluster.get(clusterRoot) || [];
      const metrics = nodeSeedMetricsByKey.get(node.key);
      bucket.push({
        key: node.key,
        kind: 'node',
        sourceKey: node.key,
        arcDemand: estimatePackingArcDemand(metrics || {}),
        outwardBias: 0
      });
      (badgesBySourceKey.get(node.key) || []).forEach((badgeMeta) => {
        bucket.push({
          key: badgeMeta.key,
          kind: 'badge',
          sourceKey: node.key,
          arcDemand: estimatePackingArcDemand({
            isBadge: true,
            badgeWidth: badgeMeta.width,
            radius: badgeMeta.radius,
            collisionRadius: badgeMeta.radius + 4,
            safetyRadius: badgeMeta.radius + STAR_MAP_BADGE_LAYOUT.minSpacing
          }),
          outwardBias: 1,
          badgeMeta
        });
      });
      itemsByCluster.set(clusterRoot, bucket);
    });

    itemsByCluster.forEach((items, clusterRoot) => {
      const wedge = sectorPlan?.wedgeByRoot?.get?.(clusterRoot);
      const band = bandByLevel.get(level);
      if (!band || !wedge) return;
      const usableSpan = Math.max(0.18, wedge.span - wedge.padding * 2);
      const order = memberOrderByCluster.get(clusterRoot) || [];
      const orderIndexByKey = new Map(order.map((key, index) => [key, index]));
      const sorted = items.slice().sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === 'node' ? -1 : 1;
        return (
          (orderIndexByKey.get(left.sourceKey) || 0) - (orderIndexByKey.get(right.sourceKey) || 0)
          || String(left.key).localeCompare(String(right.key))
        );
      });
      const totalArcDemand = sorted.reduce((sum, item) => sum + item.arcDemand, 0);
      const baseAvailableArc = Math.max(46, band.ideal * usableSpan - STAR_MAP_LOCAL_PACKING.arcPadding * 2);
      const subRingCount = clamp(
        Math.ceil(totalArcDemand / Math.max(1, baseAvailableArc)),
        1,
        STAR_MAP_LOCAL_PACKING.maxSubRings
      );
      const ringBuckets = Array.from({ length: subRingCount }, () => ({
        items: [],
        usedArc: 0
      }));

      sorted.forEach((item) => {
        const ringIndexes = item.kind === 'badge'
          ? Array.from({ length: subRingCount }, (_, index) => subRingCount - index - 1)
          : Array.from({ length: subRingCount }, (_, index) => index);
        let bestRingIndex = ringIndexes[0];
        let bestScore = Number.POSITIVE_INFINITY;
        ringIndexes.forEach((ringIndex) => {
          const ring = ringBuckets[ringIndex];
          const overflow = Math.max(0, (ring.usedArc + item.arcDemand) - baseAvailableArc);
          const score = overflow * 2 + ring.usedArc + Math.abs((item.kind === 'badge' ? subRingCount - 1 : 0) - ringIndex) * 18;
          if (score < bestScore) {
            bestScore = score;
            bestRingIndex = ringIndex;
          }
        });
        ringBuckets[bestRingIndex].items.push(item);
        ringBuckets[bestRingIndex].usedArc += item.arcDemand;
      });

      ringBuckets.forEach((ring, ringIndex) => {
        if (ring.items.length < 1) return;
        const baseRingRadius = band.ideal + ringIndex * STAR_MAP_LOCAL_PACKING.subRingGap;
        const requiredRingRadius = ring.usedArc / usableSpan;
        const ringRadius = Math.max(
          baseRingRadius,
          Math.min(
            band.max + STAR_MAP_LOCAL_PACKING.maxLocalRadiusExpand,
            requiredRingRadius + STAR_MAP_LOCAL_PACKING.arcPadding
          )
        );
        const bandOverride = {
          ...band,
          ideal: Math.max(band.ideal, ringRadius),
          max: Math.max(band.max, Math.min(band.max + STAR_MAP_BADGE_LAYOUT.maxBandExpand, ringRadius + 18))
        };
        const angleSpan = ring.usedArc / Math.max(1, ringRadius);
        let cursor = unwrapAngleNear(normalizePositiveAngle(wedge.centerAngle), 0) - angleSpan * 0.5;
        ring.items.forEach((item) => {
          const itemAngleSpan = item.arcDemand / Math.max(1, ringRadius);
          const angle = cursor + itemAngleSpan * 0.5;
          cursor += itemAngleSpan;
          packingByItemKey.set(item.key, {
            angle,
            distance: ringRadius + (item.kind === 'badge' ? STAR_MAP_BADGE_LAYOUT.outwardGap : 0),
            subRingIndex: ringIndex,
            bandOverride
          });
        });
      });
    });
  });

  return packingByItemKey;
};

const buildSeedBodies = ({
  center,
  width,
  height,
  layer,
  levels,
  nodesByLevel,
  graphMeta,
  labelMetricsByKey,
  primaryParentByKey = new Map(),
  levelMax = 1,
  maxDegree = 1,
  maxChildCount = 1,
  spreadFactor = 1,
  centerKey = '',
  boundaryStubs = []
}) => {
  const boundaryBadgeMeta = buildBoundaryBadgeMeta({
    boundaryStubs,
    layer
  });
  const { clusterRootByKey, clusters } = buildClusterAssignments({
    levels,
    nodesByLevel,
    graphMeta
  });
  const sectorPlan = buildClusterSectorPlan({
    center,
    centerKey,
    clusters,
    levels,
    nodesByLevel,
    graphMeta,
    labelMetricsByKey,
    primaryParentByKey,
    clusterRootByKey,
    boundaryBadgeMeta
  });
  const clusterAnchors = buildClusterAnchors({
    center,
    width,
    height,
    clusters,
    spreadFactor,
    sectorPlan
  });
  const clusterMetaByRoot = new Map(clusters.map((cluster) => [cluster.rootKey, cluster]));
  const bandByLevel = buildBandByLevel({
    levels,
    nodesByLevel,
    centerRadius: center.radius,
    spreadFactor
  });

  const bodies = [];
  const seededBodyByKey = new Map();
  const nodeConfigByKey = new Map();
  const nodeSeedMetricsByKey = new Map();
  levels.forEach((level) => {
    const nodes = (nodesByLevel.get(level) || []).slice().sort((left, right) => {
      const leftDegree = (graphMeta.adjacency.get(left.key)?.size || 0);
      const rightDegree = (graphMeta.adjacency.get(right.key)?.size || 0);
      return rightDegree - leftDegree || String(left.key).localeCompare(String(right.key));
    });
    nodes.forEach((node) => {
      nodeConfigByKey.set(node.key, node);
      const labelMetrics = labelMetricsByKey.get(node.key) || node.labelMetrics;
      const degree = graphMeta.adjacency.get(node.key)?.size || 0;
      const childCount = graphMeta.nextLevelNeighbors.get(node.key)?.size || 0;
      const boundaryCount = graphMeta.boundaryCountByKey.get(node.key) || 0;
      const importance = computeNodeImportance({
        layer,
        level,
        levelMax,
        degree,
        childCount,
        maxDegree,
        maxChildCount,
        boundaryCount
      });
      const scaledRadius = (Number(node.radius) || 12) * importance;
      const collisionRadius = Math.max(
        scaledRadius * 0.94,
        Math.hypot(labelMetrics.widthHint * 0.5, labelMetrics.heightHint * 0.5) * 0.72
      );
      const safetyRadius = clamp(
        18 + collisionRadius * 0.86 + degree * 4.1 + labelMetrics.widthHint * 0.11 + boundaryCount * 2.8,
        28,
        132
      );
      nodeSeedMetricsByKey.set(node.key, {
        radius: scaledRadius,
        collisionRadius,
        safetyRadius,
        labelWidthHint: labelMetrics.widthHint,
        labelHeightHint: labelMetrics.heightHint,
        degree,
        childCount,
        importance
      });
    });
  });

  const {
    orderIndexByKey,
    memberOrderByCluster,
    siblingOrderByParent
  } = buildClusterLocalOrdering({
    levels,
    nodesByLevel,
    clusters,
    clusterRootByKey,
    graphMeta,
    primaryParentByKey,
    sectorPlan
  });
  const packingByItemKey = buildClusterPackingPlan({
    levels,
    nodesByLevel,
    clusterRootByKey,
    boundaryBadgeMeta,
    nodeSeedMetricsByKey,
    bandByLevel,
    sectorPlan,
    memberOrderByCluster
  });

  levels.forEach((level) => {
    const nodes = (nodesByLevel.get(level) || []).slice().sort((left, right) => {
      const leftCluster = clusterRootByKey.get(left.key) || left.key;
      const rightCluster = clusterRootByKey.get(right.key) || right.key;
      return (
        String(leftCluster).localeCompare(String(rightCluster))
        || (orderIndexByKey.get(left.key) || 0) - (orderIndexByKey.get(right.key) || 0)
        || String(left.key).localeCompare(String(right.key))
      );
    });
    const band = bandByLevel.get(level);
    nodes.forEach((node) => {
      const clusterRoot = clusterRootByKey.get(node.key) || node.key;
      const anchor = clusterAnchors.get(clusterRoot) || { x: center.x, y: center.y - band.ideal };
      const clusterMeta = clusterMetaByRoot.get(clusterRoot);
      const wedge = sectorPlan?.wedgeByRoot?.get?.(clusterRoot);
      const packing = packingByItemKey.get(node.key);
      const seedMeta = nodeSeedMetricsByKey.get(node.key) || {};
      const anchorDirection = normalize(anchor.x - center.x, anchor.y - center.y, {
        x: Math.cos(GOLDEN_ANGLE * (clusters.findIndex((cluster) => cluster.rootKey === clusterRoot) + 1)),
        y: Math.sin(GOLDEN_ANGLE * (clusters.findIndex((cluster) => cluster.rootKey === clusterRoot) + 1))
      });
      const clusterSize = (memberOrderByCluster.get(clusterRoot) || []).length;
      const memberIndex = Math.max(0, orderIndexByKey.get(node.key) || 0);
      const labelMetrics = labelMetricsByKey.get(node.key) || node.labelMetrics;
      const clusterSpread = Number(clusterMeta?.spreadScore || 1);
      const radialBias = (stableUnit(`${node.key}:radial`) - 0.5) * band.thickness * 0.08;
      const degree = seedMeta.degree || (graphMeta.adjacency.get(node.key)?.size || 0);
      const childCount = seedMeta.childCount || (graphMeta.nextLevelNeighbors.get(node.key)?.size || 0);
      const importance = seedMeta.importance || 1;
      const scaledRadius = seedMeta.radius || (Number(node.radius) || 12);
      const collisionRadius = seedMeta.collisionRadius || scaledRadius;
      const safetyRadius = seedMeta.safetyRadius || 28;
      const parentKey = primaryParentByKey.get(node.key) || '';
      const parentBody = parentKey ? seededBodyByKey.get(parentKey) : null;
      const siblings = parentKey ? (siblingOrderByParent.get(parentKey) || []) : [];
      const siblingIndex = parentKey ? Math.max(0, siblings.indexOf(node.key)) : memberIndex;
      const siblingCount = parentKey ? siblings.length : clusterSize;
      const packedAngle = packing?.angle
        ?? unwrapAngleNear(normalizePositiveAngle(wedge?.centerAngle ?? clusterMeta?.preferredAngle ?? Math.atan2(anchorDirection.y, anchorDirection.x)), 0);
      let seedAngle = packedAngle;
      if (parentBody) {
        const parentAngle = Math.atan2(parentBody.y - center.y, parentBody.x - center.x);
        seedAngle = averageAngles([
          { angle: packedAngle, weight: 2.4 },
          { angle: parentAngle, weight: 1.42 }
        ], packedAngle);
      }
      const packedBand = packing?.bandOverride || band;
      let seedDistance = clamp(
        (packing?.distance || band.ideal) + radialBias + Math.min(12, clusterSpread * 0.6) * 0.08,
        packedBand.min + 4,
        packedBand.max - 4
      );
      let direction = { x: Math.cos(seedAngle), y: Math.sin(seedAngle) };
      let x = center.x + direction.x * seedDistance;
      let y = center.y + direction.y * seedDistance;

      if (parentBody) {
        const parentDirection = normalize(parentBody.x - center.x, parentBody.y - center.y, direction);
        const parentTangent = { x: -parentDirection.y, y: parentDirection.x };
        const siblingOffset = siblingIndex - (siblingCount - 1) * 0.5;
        const branchGap = clamp(
          parentBody.radius + scaledRadius + 22 + (parentBody.safetyRadius + safetyRadius) * 0.09,
          48,
          88
        ) * (level <= 2 ? 0.96 : 1);
        const lateralGap = clamp(
          siblingOffset * (10 + Math.min(18, labelMetrics.widthHint * 0.06) + Math.min(18, scaledRadius * 0.16)),
          -92,
          92
        );
        const childSpread = stableUnit(`${node.key}:branch`) - 0.5;
        x = parentBody.x + parentDirection.x * branchGap + parentTangent.x * (lateralGap + childSpread * 10);
        y = parentBody.y + parentDirection.y * branchGap + parentTangent.y * (lateralGap + childSpread * 10);
        const radialDistance = Math.hypot(x - center.x, y - center.y) || seedDistance;
        const clampedDistance = clamp(radialDistance, packedBand.min + 2, packedBand.max - 2);
        if (Math.abs(clampedDistance - radialDistance) > 0.001) {
          const adjustedDir = normalize(x - center.x, y - center.y, parentDirection);
          x = center.x + adjustedDir.x * clampedDistance;
          y = center.y + adjustedDir.y * clampedDistance;
        }
        seedDistance = clampedDistance;
        seedAngle = Math.atan2(y - center.y, x - center.x);
        direction = normalize(x - center.x, y - center.y, direction);
      }
      const body = {
        ...node,
        clusterRoot,
        clusterSignature: clusterRoot,
        clusterSize,
        sectorIndex: clusterAnchors.get(clusterRoot)?.sectorIndex ?? -1,
        x,
        y,
        vx: 0,
        vy: 0,
        seedX: x,
        seedY: y,
        targetDistance: seedDistance,
        radiusBias: radialBias,
        radius: scaledRadius,
        collisionRadius,
        labelWidthHint: labelMetrics.widthHint,
        labelHeightHint: labelMetrics.heightHint,
        labelOffsetY: node.labelOffsetY,
        labelMetrics,
        band: packedBand,
        degree,
        childCount,
        importance,
        siblingIndex,
        siblingCount,
        subRingIndex: packing?.subRingIndex || 0,
        primaryParentKey: parentKey,
        safetyRadius,
        labelRect: buildLabelRect({
          x,
          y,
          radius: scaledRadius,
          labelWidthHint: labelMetrics.widthHint,
          labelHeightHint: labelMetrics.heightHint,
          labelOffsetY: node.labelOffsetY,
          labelPlacement: node.labelPlacement
        })
      };
      bodies.push(body);
      seededBodyByKey.set(node.key, body);
    });

    nodes.forEach((node) => {
      const sourceBadges = boundaryBadgeMeta.badgesBySourceKey.get(node.key) || [];
      if (sourceBadges.length < 1) return;
      const sourceBody = seededBodyByKey.get(node.key);
      if (!sourceBody) return;
      sourceBadges.forEach((badgeMeta) => {
        const clusterRoot = clusterRootByKey.get(node.key) || node.key;
        const packing = packingByItemKey.get(badgeMeta.key);
        const sourceAngle = Math.atan2(sourceBody.y - center.y, sourceBody.x - center.x);
        const seedAngle = averageAngles([
          { angle: packing?.angle ?? sourceAngle, weight: 2.8 },
          { angle: sourceAngle, weight: 1.6 }
        ], sourceAngle);
        const seedDistance = sourceBody.targetDistance
          + sourceBody.radius
          + badgeMeta.radius
          + STAR_MAP_BADGE_LAYOUT.outwardGap;
        const direction = normalize(Math.cos(seedAngle), Math.sin(seedAngle), {
          x: Math.cos(sourceAngle),
          y: Math.sin(sourceAngle)
        });
        const bandOverride = packing?.bandOverride || {
          ...(sourceBody.band || band),
          ideal: seedDistance,
          max: Math.max(sourceBody.band?.max || band.max, seedDistance + 8)
        };
        const x = center.x + direction.x * seedDistance;
        const y = center.y + direction.y * seedDistance;
        const body = {
          key: badgeMeta.key,
          label: badgeMeta.label,
          level,
          clusterRoot,
          clusterSignature: clusterRoot,
          clusterSize: (memberOrderByCluster.get(clusterRoot) || []).length,
          sectorIndex: clusterAnchors.get(clusterRoot)?.sectorIndex ?? -1,
          x,
          y,
          vx: 0,
          vy: 0,
          seedX: x,
          seedY: y,
          targetDistance: seedDistance,
          radiusBias: seedDistance - (sourceBody.band?.ideal || band.ideal),
          radius: badgeMeta.radius,
          collisionRadius: badgeMeta.radius + 4,
          labelWidthHint: badgeMeta.width,
          labelHeightHint: badgeMeta.height,
          labelOffsetY: 0,
          labelPlacement: 'center',
          labelMetrics: {
            widthHint: badgeMeta.width,
            heightHint: badgeMeta.height
          },
          band: bandOverride,
          degree: 0,
          childCount: 0,
          importance: 0.72,
          siblingIndex: 0,
          siblingCount: 1,
          subRingIndex: packing?.subRingIndex || 0,
          primaryParentKey: node.key,
          safetyRadius: badgeMeta.radius + STAR_MAP_BADGE_LAYOUT.minSpacing,
          isStubBadge: true,
          stubId: badgeMeta.stubId,
          sourceKey: node.key,
          labelRect: buildLabelRect({
            x,
            y,
            radius: badgeMeta.radius,
            labelWidthHint: badgeMeta.width,
            labelHeightHint: badgeMeta.height,
            labelOffsetY: 0,
            labelPlacement: 'center'
          })
        };
        bodies.push(body);
        seededBodyByKey.set(badgeMeta.key, body);
      });
    });
  });

  return {
    bodies,
    bandByLevel,
    sectorPlan,
    boundaryBadgeMeta
  };
};

const computeClusterCentroids = (bodies) => {
  const centroidByCluster = new Map();
  const countByCluster = new Map();
  bodies.forEach((body) => {
    if (body.isStubBadge) return;
    const centroid = centroidByCluster.get(body.clusterRoot) || { x: 0, y: 0 };
    centroid.x += body.x;
    centroid.y += body.y;
    centroidByCluster.set(body.clusterRoot, centroid);
    countByCluster.set(body.clusterRoot, (countByCluster.get(body.clusterRoot) || 0) + 1);
  });
  centroidByCluster.forEach((centroid, key) => {
    const count = Math.max(1, countByCluster.get(key) || 1);
    centroid.x /= count;
    centroid.y /= count;
  });
  return centroidByCluster;
};

const buildSectorOccupancyMetrics = (center, bodies, sectorCount = STAR_MAP_SECTOR_COUNT) => {
  const sectors = Array.from({ length: sectorCount }, (_, sectorIndex) => ({
    sectorIndex,
    angle: getSectorCenterAngle(sectorIndex, sectorCount),
    area: 0,
    labelArea: 0,
    nodeCount: 0
  }));
  const halfPlane = {
    leftArea: 0,
    rightArea: 0,
    topArea: 0,
    bottomArea: 0
  };

  bodies.forEach((body) => {
    const bodyArea = Math.PI * Math.pow(Math.max(body.radius, body.collisionRadius || 0), 2);
    const labelArea = (body.labelRect?.width || body.labelWidthHint || 0) * (body.labelRect?.height || body.labelHeightHint || 0);
    const totalArea = bodyArea + labelArea;
    const angle = Math.atan2(body.y - center.y, body.x - center.x);
    const sectorIndex = getSectorIndexForAngle(angle, sectorCount);
    const sector = sectors[sectorIndex];
    sector.area += bodyArea;
    sector.labelArea += labelArea;
    sector.nodeCount += 1;
    if (body.x < center.x) halfPlane.leftArea += totalArea;
    else halfPlane.rightArea += totalArea;
    if (body.y < center.y) halfPlane.topArea += totalArea;
    else halfPlane.bottomArea += totalArea;
  });

  return {
    sectors,
    halfPlane
  };
};

const measureSectorPenalty = (center, bodies) => {
  const metrics = buildSectorOccupancyMetrics(center, bodies);
  const sectorPenalty = metrics.sectors.reduce((sum, sector) => {
    const combined = sector.area + sector.labelArea;
    const countPressure = sector.nodeCount * sector.nodeCount;
    const overload = Math.max(0, combined - 28000);
    return sum
      + combined * STAR_MAP_LAYOUT_WEIGHTS.sectorArea
      + sector.labelArea * STAR_MAP_LAYOUT_WEIGHTS.sectorLabelArea
      + countPressure * STAR_MAP_LAYOUT_WEIGHTS.sectorCount
      + overload * overload * STAR_MAP_LAYOUT_WEIGHTS.sectorOverflow;
  }, 0);

  const horizontalDelta = metrics.halfPlane.leftArea - metrics.halfPlane.rightArea;
  const verticalDelta = metrics.halfPlane.topArea - metrics.halfPlane.bottomArea;
  const balancePenalty = (
    horizontalDelta * horizontalDelta * STAR_MAP_LAYOUT_WEIGHTS.leftRightImbalance
    + verticalDelta * verticalDelta * STAR_MAP_LAYOUT_WEIGHTS.topBottomImbalance
  );

  return {
    penalty: sectorPenalty + balancePenalty,
    metrics
  };
};

const measureCenterCrossingPenalty = (center, springs = [], centerKey = '') => {
  const centerLabel = buildLabelRect(center);
  let penalty = 0;
  const highRiskSegments = [];

  springs.forEach((spring) => {
    const start = spring.fromBody || (spring.fromKey === centerKey ? center : null);
    const end = spring.toBody || (spring.toKey === centerKey ? center : null);
    if (!start || !end) return;
    if (spring.fromKey === centerKey || spring.toKey === centerKey) return;
    const segmentDistance = distancePointToSegment(center, start, end);
    if (segmentDistance.projection <= 0.12 || segmentDistance.projection >= 0.88) return;
    const centerClearance = center.radius + 18;
    if (segmentDistance.distance < centerClearance) {
      const overlap = centerClearance - segmentDistance.distance;
      penalty += overlap * overlap * STAR_MAP_LAYOUT_WEIGHTS.centerCrossingPair;
      if (highRiskSegments.length < STAR_MAP_DEBUG_SAMPLE_LIMIT) {
        highRiskSegments.push({
          fromKey: spring.fromKey,
          toKey: spring.toKey,
          distance: segmentDistance.distance
        });
      }
    }
    const labelDistance = distanceSegmentToRect(start, end, centerLabel);
    if (labelDistance.distance < 12) {
      const overlap = 12 - labelDistance.distance;
      penalty += overlap * overlap * STAR_MAP_LAYOUT_WEIGHTS.edgeNearCenterLabel;
    }
  });

  return {
    penalty,
    highRiskSegments
  };
};

const measureLayoutPenalty = (center, bodies, springs = [], centerKey = '') => {
  const centerLabel = buildLabelRect(center);
  let penalty = 0;

  for (let leftIndex = 0; leftIndex < bodies.length; leftIndex += 1) {
    const left = bodies[leftIndex];
    if (rectsOverlap(left.labelRect, centerLabel)) {
      const overlapX = Math.min(left.labelRect.right, centerLabel.right) - Math.max(left.labelRect.left, centerLabel.left);
      const overlapY = Math.min(left.labelRect.bottom, centerLabel.bottom) - Math.max(left.labelRect.top, centerLabel.top);
      penalty += overlapX * overlapY * 1.2;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < bodies.length; rightIndex += 1) {
      const right = bodies[rightIndex];
      if (rectsOverlap(left.labelRect, right.labelRect)) {
        const overlapX = Math.min(left.labelRect.right, right.labelRect.right) - Math.max(left.labelRect.left, right.labelRect.left);
        const overlapY = Math.min(left.labelRect.bottom, right.labelRect.bottom) - Math.max(left.labelRect.top, right.labelRect.top);
        penalty += overlapX * overlapY;
      }
      if (circleHitsRect({ x: left.x, y: left.y, radius: Math.max(left.radius, left.collisionRadius || 0) + left.safetyRadius * 0.08 }, right.labelRect, 8)) {
        penalty += 220;
      }
      if (circleHitsRect({ x: right.x, y: right.y, radius: Math.max(right.radius, right.collisionRadius || 0) + right.safetyRadius * 0.08 }, left.labelRect, 8)) {
        penalty += 220;
      }
      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      const minGap = (left.collisionRadius || left.radius) + (right.collisionRadius || right.radius) + Math.max(8, (left.safetyRadius + right.safetyRadius) * 0.22);
      if (distance < minGap) {
        penalty += (minGap - distance) * 180;
      }
    }
  }

  for (let leftIndex = 0; leftIndex < springs.length; leftIndex += 1) {
    const leftSpring = springs[leftIndex];
    const leftStart = leftSpring.fromBody || (leftSpring.fromKey === centerKey ? center : null);
    const leftEnd = leftSpring.toBody || (leftSpring.toKey === centerKey ? center : null);
    if (!leftStart || !leftEnd) continue;

    for (const body of bodies) {
      if (body.key === leftSpring.fromKey || body.key === leftSpring.toKey) continue;
      const bodyDistance = distancePointToSegment(body, leftStart, leftEnd);
      const nodeClearance = Math.max(18, (body.collisionRadius || body.radius || 0) + 12);
      if (bodyDistance.projection > 0.08 && bodyDistance.projection < 0.92 && bodyDistance.distance < nodeClearance) {
        penalty += (nodeClearance - bodyDistance.distance) * STAR_MAP_LAYOUT_WEIGHTS.edgeNearNode;
      }
      const labelDistance = distanceSegmentToRect(leftStart, leftEnd, body.labelRect);
      const labelClearance = Math.max(10, (body.labelRect?.height || body.labelHeightHint || 24) * 0.34);
      if (labelDistance.distance < labelClearance) {
        penalty += (labelClearance - labelDistance.distance) * STAR_MAP_LAYOUT_WEIGHTS.edgeNearLabel;
      }
    }

    for (let rightIndex = leftIndex + 1; rightIndex < springs.length; rightIndex += 1) {
      const rightSpring = springs[rightIndex];
      if (
        leftSpring.fromKey === rightSpring.fromKey
        || leftSpring.fromKey === rightSpring.toKey
        || leftSpring.toKey === rightSpring.fromKey
        || leftSpring.toKey === rightSpring.toKey
      ) {
        continue;
      }
      const rightStart = rightSpring.fromBody || (rightSpring.fromKey === centerKey ? center : null);
      const rightEnd = rightSpring.toBody || (rightSpring.toKey === centerKey ? center : null);
      if (!rightStart || !rightEnd) continue;
      if (computeSegmentIntersection({ start: leftStart, end: leftEnd }, { start: rightStart, end: rightEnd }).intersects) {
        penalty += 520 * Math.min(
          Number(leftSpring.hierarchyWeight || 1),
          Number(rightSpring.hierarchyWeight || 1)
        );
      }
    }
  }

  const sectorPenalty = measureSectorPenalty(center, bodies);
  penalty += sectorPenalty.penalty;
  const centerCrossPenalty = measureCenterCrossingPenalty(center, springs, centerKey);
  penalty += centerCrossPenalty.penalty;

  return penalty;
};

const snapshotBodies = (bodies) => bodies.map((body) => ({
  key: body.key,
  x: body.x,
  y: body.y,
  vx: 0,
  vy: 0,
  seedX: body.seedX,
  seedY: body.seedY,
  targetDistance: body.targetDistance,
  radius: body.radius,
  labelWidthHint: body.labelWidthHint,
  labelHeightHint: body.labelHeightHint,
  labelOffsetY: body.labelOffsetY,
  labelRect: body.labelRect,
  labelPlacement: body.labelPlacement,
  clusterRoot: body.clusterRoot,
  clusterSignature: body.clusterSignature,
  clusterSize: body.clusterSize,
  level: body.level,
  band: body.band,
  labelMetrics: body.labelMetrics,
  degree: body.degree,
  childCount: body.childCount,
  siblingIndex: body.siblingIndex,
  siblingCount: body.siblingCount,
  importance: body.importance,
  collisionRadius: body.collisionRadius,
  safetyRadius: body.safetyRadius,
  rawNode: body.rawNode,
  nodeType: body.nodeType,
  radiusBias: body.radiusBias,
  label: body.label,
  angle: body.angle,
  nodeKey: body.nodeKey,
  primaryParentKey: body.primaryParentKey,
  subRingIndex: body.subRingIndex,
  isStubBadge: !!body.isStubBadge,
  stubId: body.stubId,
  sourceKey: body.sourceKey
}));

export const solveStarMapConstellationLayout = ({
  width,
  height,
  center,
  centerKey,
  layer,
  levels,
  nodesByLevel,
  graphMeta,
  labelMetricsByKey,
  boundaryStubs = []
}) => {
  const levelMax = Math.max(1, ...levels);
  const degreeValues = [];
  const childValues = [];
  (nodesByLevel instanceof Map ? Array.from(nodesByLevel.values()) : []).forEach((nodes) => {
    nodes.forEach((node) => {
      degreeValues.push(graphMeta.adjacency.get(node.key)?.size || 0);
      childValues.push(graphMeta.nextLevelNeighbors.get(node.key)?.size || 0);
    });
  });
  const maxDegree = Math.max(1, ...degreeValues);
  const maxChildCount = Math.max(1, ...childValues);
  const primaryParentByKey = new Map();
  levels.forEach((level) => {
    if (level <= 1) return;
    const nodes = nodesByLevel.get(level) || [];
    nodes.forEach((node) => {
      const parents = Array.from(graphMeta.previousLevelNeighbors.get(node.key) || []);
      if (parents.length < 1) return;
      const bestParent = parents
        .map((parentKey) => ({
          parentKey,
          childCount: graphMeta.nextLevelNeighbors.get(parentKey)?.size || 0,
          degree: graphMeta.adjacency.get(parentKey)?.size || 0
        }))
        .sort((left, right) => (
          right.childCount - left.childCount
          || right.degree - left.degree
          || String(left.parentKey).localeCompare(String(right.parentKey))
        ))[0];
      if (bestParent?.parentKey) {
        primaryParentByKey.set(node.key, bestParent.parentKey);
      }
    });
  });

  const solveAttempt = (spreadFactor) => {
    const { bodies, bandByLevel, sectorPlan, boundaryBadgeMeta } = buildSeedBodies({
      center,
      width,
      height,
      layer,
      levels,
      nodesByLevel,
      graphMeta,
      labelMetricsByKey,
      primaryParentByKey,
      levelMax,
      maxDegree,
      maxChildCount,
      spreadFactor,
      centerKey,
      boundaryStubs
    });
    const bodyByKey = new Map(bodies.map((body) => [body.key, body]));
    const centerLabel = buildLabelRect(center);
    const centerCircle = {
      x: center.x,
      y: center.y,
      radius: center.radius
    };

    const springs = [];
    const badgeAttachments = [];
    graphMeta.adjacency.forEach((neighbors, key) => {
      neighbors.forEach((neighborKey) => {
        if (key >= neighborKey) return;
        const fromBody = bodyByKey.get(key);
        const toBody = bodyByKey.get(neighborKey);
        const isHierarchyEdge = (
          key === centerKey
          || neighborKey === centerKey
          || primaryParentByKey.get(key) === neighborKey
          || primaryParentByKey.get(neighborKey) === key
        );
        const hierarchyWeight = isHierarchyEdge ? (
          key === centerKey || neighborKey === centerKey ? 3 : 2
        ) : 1;
        springs.push({
          fromKey: key,
          toKey: neighborKey,
          fromBody,
          toBody,
          isHierarchyEdge,
          hierarchyWeight
        });
      });
    });
    (boundaryBadgeMeta?.badges || []).forEach((badgeMeta) => {
      const badgeBody = bodyByKey.get(badgeMeta.key);
      const sourceBody = bodyByKey.get(badgeMeta.sourceKey);
      if (!badgeBody || !sourceBody) return;
      badgeAttachments.push({
        badgeBody,
        sourceBody,
        idealDistance: Math.max(
          28,
          badgeBody.targetDistance - sourceBody.targetDistance
        )
      });
    });

    const iterations = 128;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const cooling = 1 - iteration / Math.max(1, iterations - 1);
      const forces = new Map();
      const clusterCentroids = computeClusterCentroids(bodies);

      bodies.forEach((body) => {
        const force = ensureForce(forces, body.key);
        const deltaX = body.x - center.x;
        const deltaY = body.y - center.y;
        const distance = Math.hypot(deltaX, deltaY) || 0.001;
        const outward = normalize(deltaX, deltaY, normalize(body.seedX - center.x, body.seedY - center.y));
        const band = body.band || bandByLevel.get(body.level);

        if (distance < band.min) {
          const push = (band.min - distance) * 0.18;
          force.x += outward.x * push;
          force.y += outward.y * push;
        } else if (distance > band.max) {
          const pull = (distance - band.max) * 0.14;
          force.x -= outward.x * pull;
          force.y -= outward.y * pull;
        } else {
          const soft = (body.targetDistance - distance) * 0.024;
          force.x += outward.x * soft;
          force.y += outward.y * soft;
        }

        force.x += (body.seedX - body.x) * 0.018;
        force.y += (body.seedY - body.y) * 0.018;

        const clusterCentroid = clusterCentroids.get(body.clusterRoot);
        if (clusterCentroid && body.clusterSize > 1) {
          force.x += (clusterCentroid.x - body.x) * 0.014;
          force.y += (clusterCentroid.y - body.y) * 0.014;
        }

        const centerDistance = Math.hypot(body.x - centerCircle.x, body.y - centerCircle.y) || 0.001;
        const centerGap = centerCircle.radius + Math.max(body.radius, body.collisionRadius || 0) + 12;
        if (centerDistance < centerGap) {
          const dir = normalize(body.x - centerCircle.x, body.y - centerCircle.y, outward);
          const push = (centerGap - centerDistance) * 0.24;
          force.x += dir.x * push;
          force.y += dir.y * push;
        }

        if (circleHitsRect({ x: body.x, y: body.y, radius: Math.max(body.radius, body.collisionRadius || 0) }, centerLabel, 10)) {
          force.x += outward.x * 3.1;
          force.y += outward.y * 3.8;
        }

        if (rectsOverlap(body.labelRect, centerLabel)) {
          force.x += outward.x * 2.8;
          force.y += outward.y * 3.2;
        }
      });

      springs.forEach((spring) => {
        const start = spring.fromBody || (spring.fromKey === centerKey ? center : null);
        const end = spring.toBody || (spring.toKey === centerKey ? center : null);
        if (!start || !end) return;

        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const unit = normalize(dx, dy, { x: 1, y: 0 });

        const fromLevel = Number(spring.fromBody?.level || 0);
        const toLevel = Number(spring.toBody?.level || 0);
        const sameCluster = spring.fromBody && spring.toBody && spring.fromBody.clusterRoot === spring.toBody.clusterRoot;
        const fromSafety = Number(spring.fromBody?.safetyRadius || 26);
        const toSafety = Number(spring.toBody?.safetyRadius || 26);
        const fromCollision = Number(spring.fromBody?.collisionRadius || spring.fromBody?.radius || 22);
        const toCollision = Number(spring.toBody?.collisionRadius || spring.toBody?.radius || 22);
        const safetySpacing = (fromSafety + toSafety) * 0.22;
        const idealDistance = spring.fromKey === centerKey || spring.toKey === centerKey
          ? 48 + Math.max(fromCollision, toCollision) * 1.08 + Math.max(fromLevel, toLevel) * 8 * spreadFactor
          : sameCluster
            ? 42 + fromCollision + toCollision + Math.abs(fromLevel - toLevel) * 8 * spreadFactor + safetySpacing
            : 60 + fromCollision + toCollision + Math.abs(fromLevel - toLevel) * 14 * spreadFactor + safetySpacing * 0.88;
        const tension = (distance - idealDistance) * (sameCluster ? 0.024 : 0.011);

        if (spring.fromBody) {
          const force = ensureForce(forces, spring.fromBody.key);
          force.x += unit.x * tension;
          force.y += unit.y * tension;
        }
        if (spring.toBody) {
          const force = ensureForce(forces, spring.toBody.key);
          force.x -= unit.x * tension;
          force.y -= unit.y * tension;
        }
      });

      badgeAttachments.forEach((attachment) => {
        const { badgeBody, sourceBody, idealDistance } = attachment;
        const dx = badgeBody.x - sourceBody.x;
        const dy = badgeBody.y - sourceBody.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const unit = normalize(dx, dy, normalize(badgeBody.x - center.x, badgeBody.y - center.y));
        const badgeForce = ensureForce(forces, badgeBody.key);
        const sourceForce = ensureForce(forces, sourceBody.key);
        const spring = (distance - idealDistance) * 0.042;
        badgeForce.x -= unit.x * spring;
        badgeForce.y -= unit.y * spring;
        sourceForce.x += unit.x * spring * 0.2;
        sourceForce.y += unit.y * spring * 0.2;

        const outward = normalize(badgeBody.x - center.x, badgeBody.y - center.y, unit);
        const desiredX = center.x + outward.x * badgeBody.targetDistance;
        const desiredY = center.y + outward.y * badgeBody.targetDistance;
        badgeForce.x += (desiredX - badgeBody.x) * 0.06;
        badgeForce.y += (desiredY - badgeBody.y) * 0.06;
      });

      // 节点与“无关边”避让：
      // 如果节点或它的标签占地压到别人的边上，就同时推开节点和边的端点，
      // 尽量减少“节点坐在线上”的读图障碍。
      springs.forEach((spring) => {
        const start = spring.fromBody || (spring.fromKey === centerKey ? center : null);
        const end = spring.toBody || (spring.toKey === centerKey ? center : null);
        if (!start || !end) return;

        const edgeDx = end.x - start.x;
        const edgeDy = end.y - start.y;
        const edgeLength = Math.hypot(edgeDx, edgeDy) || 0.001;
        if (edgeLength < 22) return;

        bodies.forEach((body) => {
          if (body.key === spring.fromKey || body.key === spring.toKey) return;

          const clearance = Math.max(
            18,
            (body.collisionRadius || body.radius || 18) + Math.min(18, (body.labelWidthHint || 96) * 0.05)
          );
          const segmentDistance = distancePointToSegment(body, start, end);
          if (segmentDistance.projection <= 0.08 || segmentDistance.projection >= 0.92) return;
          if (segmentDistance.distance >= clearance) return;

          const awayX = body.x - segmentDistance.closestX;
          const awayY = body.y - segmentDistance.closestY;
          const normal = normalize(
            awayX,
            awayY,
            stableUnit(`${body.key}|${spring.fromKey}|${spring.toKey}:edge`) > 0.5
              ? { x: -edgeDy / edgeLength, y: edgeDx / edgeLength }
              : { x: edgeDy / edgeLength, y: -edgeDx / edgeLength }
          );
          const overlap = clearance - segmentDistance.distance;
          const push = overlap * 0.18;
          const bodyForce = ensureForce(forces, body.key);
          bodyForce.x += normal.x * push;
          bodyForce.y += normal.y * push;

          const labelDistance = distanceSegmentToRect(start, end, body.labelRect);
          const labelClearance = Math.max(10, (body.labelRect?.height || body.labelHeightHint || 24) * 0.38);
          if (labelDistance.distance < labelClearance) {
            const labelAwayX = body.labelRect.centerX - labelDistance.closestX;
            const labelAwayY = body.labelRect.centerY - labelDistance.closestY;
            const labelNormal = normalize(
              labelAwayX,
              labelAwayY,
              normal
            );
            const labelPush = (labelClearance - labelDistance.distance) * 0.22;
            bodyForce.x += labelNormal.x * labelPush;
            bodyForce.y += labelNormal.y * labelPush;
          }

          if (spring.fromBody) {
            const fromForce = ensureForce(forces, spring.fromBody.key);
            fromForce.x -= normal.x * push * 0.16 * (1 - segmentDistance.projection);
            fromForce.y -= normal.y * push * 0.16 * (1 - segmentDistance.projection);
          }
          if (spring.toBody) {
            const toForce = ensureForce(forces, spring.toBody.key);
            toForce.x -= normal.x * push * 0.16 * segmentDistance.projection;
            toForce.y -= normal.y * push * 0.16 * segmentDistance.projection;
          }
        });
      });

      // 边与边交叉避让：
      // 把“显然可避免的交叉”当成独立惩罚，优先保护中心骨架和主父链，
      // 让次级边更愿意绕开，而不是所有边都维持同样优先级。
      for (let leftIndex = 0; leftIndex < springs.length; leftIndex += 1) {
        const leftSpring = springs[leftIndex];
        const leftStart = leftSpring.fromBody || (leftSpring.fromKey === centerKey ? center : null);
        const leftEnd = leftSpring.toBody || (leftSpring.toKey === centerKey ? center : null);
        if (!leftStart || !leftEnd) continue;

        for (let rightIndex = leftIndex + 1; rightIndex < springs.length; rightIndex += 1) {
          const rightSpring = springs[rightIndex];
          if (
            leftSpring.fromKey === rightSpring.fromKey
            || leftSpring.fromKey === rightSpring.toKey
            || leftSpring.toKey === rightSpring.fromKey
            || leftSpring.toKey === rightSpring.toKey
          ) {
            continue;
          }

          const rightStart = rightSpring.fromBody || (rightSpring.fromKey === centerKey ? center : null);
          const rightEnd = rightSpring.toBody || (rightSpring.toKey === centerKey ? center : null);
          if (!rightStart || !rightEnd) continue;

          const intersection = computeSegmentIntersection(
            { start: leftStart, end: leftEnd },
            { start: rightStart, end: rightEnd }
          );
          if (!intersection.intersects) continue;

          const leftDx = leftEnd.x - leftStart.x;
          const leftDy = leftEnd.y - leftStart.y;
          const rightDx = rightEnd.x - rightStart.x;
          const rightDy = rightEnd.y - rightStart.y;
          const leftLength = Math.hypot(leftDx, leftDy) || 1;
          const rightLength = Math.hypot(rightDx, rightDy) || 1;
          const leftNormal = normalize(-leftDy, leftDx, { x: 0, y: -1 });
          const rightNormal = normalize(-rightDy, rightDx, { x: 0, y: -1 });
          const centerDeltaX = ((rightStart.x + rightEnd.x) - (leftStart.x + leftEnd.x)) * 0.5;
          const centerDeltaY = ((rightStart.y + rightEnd.y) - (leftStart.y + leftEnd.y)) * 0.5;
          const leftSign = Math.sign(centerDeltaX * leftNormal.x + centerDeltaY * leftNormal.y)
            || (stableUnit(`${leftSpring.fromKey}|${leftSpring.toKey}|${rightSpring.fromKey}|${rightSpring.toKey}:left`) > 0.5 ? 1 : -1);
          const rightSign = -(
            Math.sign(centerDeltaX * rightNormal.x + centerDeltaY * rightNormal.y)
            || (stableUnit(`${leftSpring.fromKey}|${leftSpring.toKey}|${rightSpring.fromKey}|${rightSpring.toKey}:right`) > 0.5 ? 1 : -1)
          );
          const leftPriority = Number(leftSpring.hierarchyWeight || 1);
          const rightPriority = Number(rightSpring.hierarchyWeight || 1);
          const leftMoveScale = leftPriority >= rightPriority ? 0.08 : 0.18;
          const rightMoveScale = rightPriority >= leftPriority ? 0.08 : 0.18;
          const pushStrength = (0.72 + cooling * 0.48) * Math.min(1.2, Math.max(0.7, Math.min(leftLength, rightLength) / 120));

          if (leftSpring.fromBody) {
            const force = ensureForce(forces, leftSpring.fromBody.key);
            force.x += leftNormal.x * leftSign * pushStrength * leftMoveScale * (1 - intersection.t);
            force.y += leftNormal.y * leftSign * pushStrength * leftMoveScale * (1 - intersection.t);
          }
          if (leftSpring.toBody) {
            const force = ensureForce(forces, leftSpring.toBody.key);
            force.x += leftNormal.x * leftSign * pushStrength * leftMoveScale * intersection.t;
            force.y += leftNormal.y * leftSign * pushStrength * leftMoveScale * intersection.t;
          }
          if (rightSpring.fromBody) {
            const force = ensureForce(forces, rightSpring.fromBody.key);
            force.x += rightNormal.x * rightSign * pushStrength * rightMoveScale * (1 - intersection.u);
            force.y += rightNormal.y * rightSign * pushStrength * rightMoveScale * (1 - intersection.u);
          }
          if (rightSpring.toBody) {
            const force = ensureForce(forces, rightSpring.toBody.key);
            force.x += rightNormal.x * rightSign * pushStrength * rightMoveScale * intersection.u;
            force.y += rightNormal.y * rightSign * pushStrength * rightMoveScale * intersection.u;
          }
        }
      }

      const sectorMetrics = buildSectorOccupancyMetrics(center, bodies);
      sectorMetrics.sectors.forEach((sector) => {
        const combinedArea = sector.area + sector.labelArea;
        const overload = Math.max(0, combinedArea - 28000);
        if (overload <= 0 && sector.nodeCount <= 3) return;
        const sectorAngle = sector.angle;
        const sectorDirection = { x: Math.cos(sectorAngle), y: Math.sin(sectorAngle) };
        bodies.forEach((body) => {
          const bodyAngle = Math.atan2(body.y - center.y, body.x - center.x);
          if (getSectorIndexForAngle(bodyAngle, sectorMetrics.sectors.length) !== sector.sectorIndex) return;
          const force = ensureForce(forces, body.key);
          const pushStrength = overload > 0 ? Math.min(3.2, overload * 0.00004) : 0.6;
          force.x += sectorDirection.x * pushStrength;
          force.y += sectorDirection.y * pushStrength;
        });
      });

      const horizontalDelta = sectorMetrics.halfPlane.leftArea - sectorMetrics.halfPlane.rightArea;
      const verticalDelta = sectorMetrics.halfPlane.topArea - sectorMetrics.halfPlane.bottomArea;
      bodies.forEach((body) => {
        const force = ensureForce(forces, body.key);
        const horizontalBias = horizontalDelta * 0.0000045;
        const verticalBias = verticalDelta * 0.0000026;
        force.x += body.x < center.x ? -horizontalBias : horizontalBias;
        force.y += body.y < center.y ? -verticalBias : verticalBias;
      });

      const centerCrossPenalty = measureCenterCrossingPenalty(center, springs, centerKey);
      if (centerCrossPenalty.highRiskSegments.length > 0) {
        centerCrossPenalty.highRiskSegments.forEach((segmentMeta) => {
          const spring = springs.find((item) => item.fromKey === segmentMeta.fromKey && item.toKey === segmentMeta.toKey);
          if (!spring) return;
          const fromForce = spring.fromBody ? ensureForce(forces, spring.fromBody.key) : null;
          const toForce = spring.toBody ? ensureForce(forces, spring.toBody.key) : null;
          const start = spring.fromBody || (spring.fromKey === centerKey ? center : null);
          const end = spring.toBody || (spring.toKey === centerKey ? center : null);
          if (!start || !end) return;
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const normal = normalize(-dy, dx, { x: 0, y: -1 });
          const sign = stableUnit(`${spring.fromKey}|${spring.toKey}:center-cross`) > 0.5 ? 1 : -1;
          const push = Math.max(0.5, (center.radius + 18 - segmentMeta.distance) * 0.09);
          if (fromForce) {
            fromForce.x += normal.x * sign * push * 0.9;
            fromForce.y += normal.y * sign * push * 0.9;
          }
          if (toForce) {
            toForce.x += normal.x * sign * push * 0.9;
            toForce.y += normal.y * sign * push * 0.9;
          }
        });
      }

      for (let leftIndex = 0; leftIndex < bodies.length; leftIndex += 1) {
        const left = bodies[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < bodies.length; rightIndex += 1) {
          const right = bodies[rightIndex];
          const dx = right.x - left.x;
          const dy = right.y - left.y;
          const distance = Math.hypot(dx, dy) || 0.001;
          const unit = normalize(dx, dy, { x: 1, y: 0 });
          const leftForce = ensureForce(forces, left.key);
          const rightForce = ensureForce(forces, right.key);

          const nodeGap = (left.collisionRadius || left.radius) + (right.collisionRadius || right.radius) + Math.max(20, (left.safetyRadius + right.safetyRadius) * 0.46);
          if (distance < nodeGap) {
            const push = (nodeGap - distance) * 0.28;
            leftForce.x -= unit.x * push;
            leftForce.y -= unit.y * push;
            rightForce.x += unit.x * push;
            rightForce.y += unit.y * push;
          } else {
            const softField = 92 + (left.collisionRadius || left.radius) + (right.collisionRadius || right.radius) + (left.labelWidthHint + right.labelWidthHint) * 0.08 + (left.safetyRadius + right.safetyRadius) * 0.24;
            if (distance < softField) {
              const push = (softField - distance) * 0.02;
              leftForce.x -= unit.x * push;
              leftForce.y -= unit.y * push;
              rightForce.x += unit.x * push;
              rightForce.y += unit.y * push;
            }
          }

          if (rectsOverlap(left.labelRect, right.labelRect)) {
            const overlapX = Math.min(left.labelRect.right, right.labelRect.right) - Math.max(left.labelRect.left, right.labelRect.left);
            const overlapY = Math.min(left.labelRect.bottom, right.labelRect.bottom) - Math.max(left.labelRect.top, right.labelRect.top);
            const dirX = Math.abs(dx) > 0.001 ? Math.sign(dx) : (stableUnit(`${left.key}|${right.key}:x`) > 0.5 ? 1 : -1);
            const dirY = Math.abs(dy) > 0.001 ? Math.sign(dy) : (stableUnit(`${left.key}|${right.key}:y`) > 0.5 ? 1 : -1);
            leftForce.x -= dirX * overlapX * 0.38;
            rightForce.x += dirX * overlapX * 0.38;
            leftForce.y -= dirY * overlapY * 0.2;
            rightForce.y += dirY * overlapY * 0.2;
          }

          if (circleHitsRect({ x: left.x, y: left.y, radius: Math.max(left.radius, left.collisionRadius || 0) + left.safetyRadius * 0.08 }, right.labelRect, 12)) {
            leftForce.x -= unit.x * 2.2;
            leftForce.y -= Math.max(0.8, Math.abs(unit.y)) * 2.8;
            rightForce.x += unit.x * 1.5;
            rightForce.y += Math.max(0.5, Math.abs(unit.y)) * 1.8;
          }
          if (circleHitsRect({ x: right.x, y: right.y, radius: Math.max(right.radius, right.collisionRadius || 0) + right.safetyRadius * 0.08 }, left.labelRect, 12)) {
            leftForce.x -= unit.x * 1.5;
            leftForce.y -= Math.max(0.5, Math.abs(unit.y)) * 1.8;
            rightForce.x += unit.x * 2.2;
            rightForce.y += Math.max(0.8, Math.abs(unit.y)) * 2.8;
          }
        }
      }

      bodies.forEach((body) => {
        const force = ensureForce(forces, body.key);
        const manyBodyX = body.x - center.x;
        const manyBodyY = body.y - center.y;
        const manyBodyDistance = Math.hypot(manyBodyX, manyBodyY) || 1;
        const manyBodyUnit = normalize(manyBodyX, manyBodyY, { x: 0, y: -1 });
        const spread = clamp((manyBodyDistance - body.band.min) * 0.012, -0.8, 2.2);
        force.x += manyBodyUnit.x * spread;
        force.y += manyBodyUnit.y * spread;

        body.vx = (body.vx + force.x * 0.2) * 0.76;
        body.vy = (body.vy + force.y * 0.2) * 0.76;
        const stepLimit = 10 + cooling * 8;
        body.vx = clamp(body.vx, -stepLimit, stepLimit);
        body.vy = clamp(body.vy, -stepLimit, stepLimit);
      body.x += body.vx;
      body.y += body.vy;
      body.labelRect = buildLabelRect(body);
    });
  }

    bodies.forEach((body) => {
      body.labelRect = buildLabelRect(body);
      body.angle = Math.atan2(body.y - center.y, body.x - center.x);
      body.nodeKey = body.key;
      body.primaryParentKey = primaryParentByKey.get(body.key) || '';
    });

    return {
      bodies,
      bounds: buildContentBounds(center, bodies),
      penalty: measureLayoutPenalty(center, bodies, springs, centerKey),
      sectorPlan
    };
  };

  const attempts = STAR_MAP_LAYOUT_SPREAD_ATTEMPTS;
  let best = null;
  attempts.forEach((spreadFactor) => {
    const result = solveAttempt(spreadFactor);
    if (!best || result.penalty < best.penalty) {
      best = result;
    }
  });

  const snappedBodies = snapshotBodies(best.bodies);
  const badgeBodyByStubId = new Map(
    snappedBodies
      .filter((body) => body.isStubBadge && body.stubId)
      .map((body) => [body.stubId, body])
  );

  return {
    bodyByKey: new Map(snappedBodies.map((body) => [body.key, body])),
    badgeBodyByStubId,
    bounds: best.bounds,
    debug: {
      sectorPlan: best?.sectorPlan?.debug || null
    }
  };
};

const buildWorldSegment = (fromNode, toNode, inset = 2) => {
  const dx = (Number(toNode?.x) || 0) - (Number(fromNode?.x) || 0);
  const dy = (Number(toNode?.y) || 0) - (Number(fromNode?.y) || 0);
  const centerDistance = Math.hypot(dx, dy);
  if (centerDistance <= 0.001) return null;
  const dirX = dx / centerDistance;
  const dirY = dy / centerDistance;
  const fromRadius = Math.max(0, Number(fromNode?.radius) || 0);
  const toRadius = Math.max(0, Number(toNode?.radius) || 0);
  const fromOffset = Math.max(0, Math.min(Math.max(0, fromRadius - inset), centerDistance * 0.45));
  const toOffset = Math.max(0, Math.min(Math.max(0, toRadius - inset), centerDistance * 0.45));
  const start = {
    x: (Number(fromNode?.x) || 0) + dirX * fromOffset,
    y: (Number(fromNode?.y) || 0) + dirY * fromOffset
  };
  const end = {
    x: (Number(toNode?.x) || 0) - dirX * toOffset,
    y: (Number(toNode?.y) || 0) - dirY * toOffset
  };
  if (Math.hypot(end.x - start.x, end.y - start.y) <= 0.001) return null;
  return { start, end };
};

const translateRect = (rect, dx = 0, dy = 0) => buildRectFromValues({
  left: rect.left + dx,
  right: rect.right + dx,
  top: rect.top + dy,
  bottom: rect.bottom + dy
});

const buildMeasuredLabelRect = (node, measuredRect) => {
  if (measuredRect && Number.isFinite(measuredRect.left) && Number.isFinite(measuredRect.right) && Number.isFinite(measuredRect.top) && Number.isFinite(measuredRect.bottom)) {
    return buildRectFromValues(measuredRect);
  }
  return buildLabelRect({
    x: node.x,
    y: node.y,
    radius: node.radius,
    labelWidthHint: node.labelWidthHint,
    labelHeightHint: node.labelHeightHint,
    labelOffsetY: node.labelOffsetY,
    labelPlacement: node.labelPlacement
  });
};

const computeMeasuredLayoutScore = ({
  centerNode,
  movableBodies = [],
  staticBodies = [],
  lineEntries = []
}) => {
  let labelOverlap = 0;
  let nodeLabelOverlap = 0;
  let edgeNearLabel = 0;
  let edgeNearNode = 0;

  const allBodies = [...movableBodies, ...staticBodies];
  for (let leftIndex = 0; leftIndex < allBodies.length; leftIndex += 1) {
    const left = allBodies[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < allBodies.length; rightIndex += 1) {
      const right = allBodies[rightIndex];
      if (rectsOverlap(left.labelRect, right.labelRect)) {
        const overlapX = Math.min(left.labelRect.right, right.labelRect.right) - Math.max(left.labelRect.left, right.labelRect.left);
        const overlapY = Math.min(left.labelRect.bottom, right.labelRect.bottom) - Math.max(left.labelRect.top, right.labelRect.top);
        labelOverlap += overlapX * overlapY;
      }
      if (circleHitsRect({ x: left.x, y: left.y, radius: left.radius + 6 }, right.labelRect, 6)) {
        nodeLabelOverlap += 1 + Math.max(0, 16 - pointToRectDistance({ x: left.x, y: left.y }, right.labelRect));
      }
      if (circleHitsRect({ x: right.x, y: right.y, radius: right.radius + 6 }, left.labelRect, 6)) {
        nodeLabelOverlap += 1 + Math.max(0, 16 - pointToRectDistance({ x: right.x, y: right.y }, left.labelRect));
      }
    }
  }

  lineEntries.forEach((line) => {
    const segment = buildWorldSegment(line.fromNode, line.toNode, 2);
    if (!segment) return;
    allBodies.forEach((body) => {
      if (body.id === line.fromNode.id || body.id === line.toNode.id) return;
      const nodeDistance = distancePointToSegment(body, segment.start, segment.end);
      const nodeClearance = Math.max(12, body.radius + 8);
      if (nodeDistance.projection > 0.08 && nodeDistance.projection < 0.92 && nodeDistance.distance < nodeClearance) {
        edgeNearNode += nodeClearance - nodeDistance.distance;
      }
      const labelDistance = distanceSegmentToRect(segment.start, segment.end, body.labelRect);
      const labelClearance = Math.max(8, Math.min(22, body.labelRect.height * 0.32));
      if (labelDistance.distance < labelClearance) {
        edgeNearLabel += labelClearance - labelDistance.distance;
      }
    });
  });

  const centerCrossing = measureCenterCrossingPenalty(
    {
      x: centerNode.x,
      y: centerNode.y,
      radius: centerNode.radius,
      labelWidthHint: centerNode.labelRect.width,
      labelHeightHint: centerNode.labelRect.height,
      labelPlacement: 'center',
      labelOffsetY: 0
    },
    lineEntries.map((line) => ({
      fromKey: line.fromNode.id,
      toKey: line.toNode.id,
      fromBody: line.fromNode,
      toBody: line.toNode
    })),
    centerNode.id
  ).penalty;

  const total = (
    labelOverlap * STAR_MAP_MEASURED_LABEL_SCORE_WEIGHTS.labelOverlap
    + nodeLabelOverlap * STAR_MAP_MEASURED_LABEL_SCORE_WEIGHTS.nodeLabelOverlap
    + edgeNearLabel * STAR_MAP_MEASURED_LABEL_SCORE_WEIGHTS.edgeNearLabel
    + edgeNearNode * STAR_MAP_MEASURED_LABEL_SCORE_WEIGHTS.edgeNearNode
    + centerCrossing * STAR_MAP_MEASURED_LABEL_SCORE_WEIGHTS.centerCrossing
  );

  return {
    labelOverlap,
    nodeLabelOverlap,
    edgeNearLabel,
    edgeNearNode,
    centerCrossing,
    total
  };
};

export const refineStarMapLayoutWithMeasuredLabels = ({
  layout = {},
  measuredLabelBoxes = [],
  maxShift = STAR_MAP_MEASURED_LABEL_MAX_SHIFT,
  iterations = STAR_MAP_MEASURED_LABEL_ITERATIONS
} = {}) => {
  const layoutNodes = Array.isArray(layout?.nodes) ? layout.nodes : [];
  const layoutLines = Array.isArray(layout?.lines) ? layout.lines : [];
  const centerNode = layoutNodes.find((node) => node?.type === 'center' && node?.data?.starMapLayer);
  if (!centerNode) {
    return {
      applied: false,
      reason: 'missing_center',
      beforeScore: null,
      afterScore: null,
      layout
    };
  }

  const measuredById = new Map(
    (Array.isArray(measuredLabelBoxes) ? measuredLabelBoxes : [])
      .filter((item) => item?.nodeId)
      .map((item) => [item.nodeId, item])
  );

  const mutableBodies = layoutNodes
    .filter((node) => node?.data?.starMapLayer && node.type !== 'stub-anchor' && node.type !== 'center')
    .map((node) => {
      const labelRect = buildMeasuredLabelRect(node, measuredById.get(node.id));
      return {
        id: node.id,
        x: Number(node.x) || 0,
        y: Number(node.y) || 0,
        radius: Number(node.radius) || 0,
        clusterSignature: String(node?.data?.starMapClusterSignature || ''),
        baseX: Number(node.x) || 0,
        baseY: Number(node.y) || 0,
        baseLabelRect: labelRect,
        labelRect
      };
    });

  if (mutableBodies.length < 1) {
    return {
      applied: false,
      reason: 'no_mutable_bodies',
      beforeScore: null,
      afterScore: null,
      layout
    };
  }

  const staticBodies = [centerNode].map((node) => ({
    id: node.id,
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
    radius: Number(node.radius) || 0,
    labelRect: buildMeasuredLabelRect(node, measuredById.get(node.id))
  }));

  const nodeById = new Map([
    ...mutableBodies.map((body) => [body.id, body]),
    ...staticBodies.map((body) => [body.id, body])
  ]);
  const lineEntries = layoutLines
    .filter((line) => !line?.isStub)
    .map((line) => ({
      line,
      fromNode: nodeById.get(line.from),
      toNode: nodeById.get(line.to)
    }))
    .filter((entry) => entry.fromNode && entry.toNode);

  const scoreBefore = computeMeasuredLayoutScore({
    centerNode: staticBodies[0],
    movableBodies: mutableBodies,
    staticBodies: [],
    lineEntries
  });

  for (let iterationIndex = 0; iterationIndex < iterations; iterationIndex += 1) {
    const cooling = 1 - iterationIndex / Math.max(1, iterations - 1);
    const forceById = new Map();
    const ensureBodyForce = (id) => ensureForce(forceById, id);

    for (let leftIndex = 0; leftIndex < mutableBodies.length; leftIndex += 1) {
      const left = mutableBodies[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < mutableBodies.length; rightIndex += 1) {
        const right = mutableBodies[rightIndex];
        const leftForce = ensureBodyForce(left.id);
        const rightForce = ensureBodyForce(right.id);
        if (rectsOverlap(left.labelRect, right.labelRect)) {
          const overlapX = Math.min(left.labelRect.right, right.labelRect.right) - Math.max(left.labelRect.left, right.labelRect.left);
          const overlapY = Math.min(left.labelRect.bottom, right.labelRect.bottom) - Math.max(left.labelRect.top, right.labelRect.top);
          const dirX = Math.sign((right.labelRect.centerX || right.x) - (left.labelRect.centerX || left.x)) || (stableUnit(`${left.id}|${right.id}:measured-x`) > 0.5 ? 1 : -1);
          const dirY = Math.sign((right.labelRect.centerY || right.y) - (left.labelRect.centerY || left.y)) || (stableUnit(`${left.id}|${right.id}:measured-y`) > 0.5 ? 1 : -1);
          leftForce.x -= dirX * overlapX * 0.18;
          rightForce.x += dirX * overlapX * 0.18;
          leftForce.y -= dirY * overlapY * 0.16;
          rightForce.y += dirY * overlapY * 0.16;
        }
      }
    }

    mutableBodies.forEach((body) => {
      const force = ensureBodyForce(body.id);
      [...mutableBodies, ...staticBodies].forEach((other) => {
        if (other.id === body.id) return;
        if (circleHitsRect({ x: body.x, y: body.y, radius: body.radius + 6 }, other.labelRect, 6)) {
          const away = normalize(body.x - other.labelRect.centerX, body.y - other.labelRect.centerY, { x: 0, y: -1 });
          force.x += away.x * 2.2;
          force.y += away.y * 2.4;
        }
      });
    });

    lineEntries.forEach((entry) => {
      const segment = buildWorldSegment(entry.fromNode, entry.toNode, 2);
      if (!segment) return;
      mutableBodies.forEach((body) => {
        if (body.id === entry.fromNode.id || body.id === entry.toNode.id) return;
        const force = ensureBodyForce(body.id);
        const nodeDistance = distancePointToSegment(body, segment.start, segment.end);
        const nodeClearance = Math.max(12, body.radius + 8);
        if (nodeDistance.projection > 0.08 && nodeDistance.projection < 0.92 && nodeDistance.distance < nodeClearance) {
          const normal = normalize(body.x - nodeDistance.closestX, body.y - nodeDistance.closestY, { x: 0, y: -1 });
          const push = (nodeClearance - nodeDistance.distance) * 0.22;
          force.x += normal.x * push;
          force.y += normal.y * push;
        }
        const labelDistance = distanceSegmentToRect(segment.start, segment.end, body.labelRect);
        const labelClearance = Math.max(8, Math.min(22, body.labelRect.height * 0.32));
        if (labelDistance.distance < labelClearance) {
          const normal = normalize(body.labelRect.centerX - labelDistance.closestX, body.labelRect.centerY - labelDistance.closestY, { x: 0, y: -1 });
          const push = (labelClearance - labelDistance.distance) * 0.26;
          force.x += normal.x * push;
          force.y += normal.y * push;
        }
      });
    });

    mutableBodies.forEach((body) => {
      const force = ensureBodyForce(body.id);
      const dxFromBase = body.x - body.baseX;
      const dyFromBase = body.y - body.baseY;
      force.x += -dxFromBase * 0.22;
      force.y += -dyFromBase * 0.22;
      const stepLimit = 3.8 + cooling * 2.4;
      const nextDx = clamp(force.x * 0.22, -stepLimit, stepLimit);
      const nextDy = clamp(force.y * 0.22, -stepLimit, stepLimit);
      const proposedX = body.x + nextDx;
      const proposedY = body.y + nextDy;
      const shiftX = clamp(proposedX - body.baseX, -maxShift, maxShift);
      const shiftY = clamp(proposedY - body.baseY, -maxShift, maxShift);
      body.x = body.baseX + shiftX;
      body.y = body.baseY + shiftY;
      body.labelRect = translateRect(body.baseLabelRect, shiftX, shiftY);
    });
  }

  const scoreAfter = computeMeasuredLayoutScore({
    centerNode: staticBodies[0],
    movableBodies: mutableBodies,
    staticBodies: [],
    lineEntries
  });

  if (!(scoreAfter.total + 0.001 < scoreBefore.total)) {
    return {
      applied: false,
      reason: 'score_not_improved',
      beforeScore: scoreBefore,
      afterScore: scoreAfter,
      layout
    };
  }

  const nextNodes = layoutNodes.map((node) => {
    const body = nodeById.get(node.id);
    if (!body || node.type === 'center' || node.type === 'stub-anchor') return { ...node };
    return {
      ...node,
      x: body.x,
      y: body.y
    };
  });

  const boundCenter = staticBodies[0];
  let left = Math.min(boundCenter.x - boundCenter.radius, boundCenter.labelRect.left);
  let right = Math.max(boundCenter.x + boundCenter.radius, boundCenter.labelRect.right);
  let top = Math.min(boundCenter.y - boundCenter.radius, boundCenter.labelRect.top);
  let bottom = Math.max(boundCenter.y + boundCenter.radius, boundCenter.labelRect.bottom);
  mutableBodies.forEach((body) => {
    left = Math.min(left, body.x - body.radius, body.labelRect.left);
    right = Math.max(right, body.x + body.radius, body.labelRect.right);
    top = Math.min(top, body.y - body.radius, body.labelRect.top);
    bottom = Math.max(bottom, body.y + body.radius, body.labelRect.bottom);
  });

  return {
    applied: true,
    reason: 'score_improved',
    beforeScore: scoreBefore,
    afterScore: scoreAfter,
    layout: {
      ...layout,
      nodes: nextNodes,
      bounds: {
        left,
        right,
        top,
        bottom,
        width: right - left,
        height: bottom - top
      },
      debug: {
        ...(layout?.debug || {}),
        measuredLabelRefinement: {
          before: scoreBefore,
          after: scoreAfter
        }
      }
    }
  };
};
