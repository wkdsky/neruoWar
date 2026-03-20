import {
  buildStarMapLevelOrdering,
  estimateStarMapLabelMetrics
} from './starMapLayoutHelpers';

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

// eslint-disable-next-line no-unused-vars
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

const buildNodeSeedMetricsByKey = ({
  layer,
  levels = [],
  nodesByLevel = new Map(),
  graphMeta,
  labelMetricsByKey = new Map(),
  levelMax = 1,
  maxDegree = 1,
  maxChildCount = 1
}) => {
  const nodeSeedMetricsByKey = new Map();
  levels.forEach((level) => {
    const nodes = nodesByLevel.get(level) || [];
    nodes.forEach((node) => {
      const labelMetrics = labelMetricsByKey.get(node.key) || node.labelMetrics || estimateStarMapLabelMetrics(node.label);
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
      const radius = (Number(node.radius) || 12) * importance;
      const collisionRadius = Math.max(
        radius * 0.94,
        Math.hypot(labelMetrics.widthHint * 0.5, labelMetrics.heightHint * 0.5) * 0.72
      );
      const safetyRadius = clamp(
        18 + collisionRadius * 0.86 + degree * 4.1 + labelMetrics.widthHint * 0.11 + boundaryCount * 2.8,
        28,
        132
      );
      nodeSeedMetricsByKey.set(node.key, {
        radius,
        collisionRadius,
        safetyRadius,
        labelWidthHint: labelMetrics.widthHint,
        labelHeightHint: labelMetrics.heightHint,
        degree,
        childCount,
        boundaryCount,
        importance,
        labelMetrics
      });
    });
  });
  return nodeSeedMetricsByKey;
};

const buildPrimaryTreeMeta = ({
  centerKey = '',
  levels = [],
  nodesByLevel = new Map(),
  graphMeta,
  labelMetricsByKey = new Map(),
  nodeSeedMetricsByKey = new Map()
}) => {
  const primaryParentByKey = new Map();
  const childrenByParent = new Map();
  const clusterRootByKey = new Map();
  const depthByKey = new Map(centerKey ? [[centerKey, 0]] : []);
  const nodeByKey = new Map();
  const levelByKey = new Map(centerKey ? [[centerKey, 0]] : []);

  levels.forEach((level) => {
    (nodesByLevel.get(level) || []).forEach((node) => {
      nodeByKey.set(node.key, node);
      levelByKey.set(node.key, level);
    });
  });

  const ensureChildren = (parentKey) => {
    let bucket = childrenByParent.get(parentKey);
    if (!bucket) {
      bucket = [];
      childrenByParent.set(parentKey, bucket);
    }
    return bucket;
  };

  levels.forEach((level) => {
    const nodes = (nodesByLevel.get(level) || []).slice().sort((left, right) => {
      const leftDegree = graphMeta.adjacency.get(left.key)?.size || 0;
      const rightDegree = graphMeta.adjacency.get(right.key)?.size || 0;
      return rightDegree - leftDegree || String(left.key).localeCompare(String(right.key));
    });
    nodes.forEach((node) => {
      const parentCandidates = Array.from(graphMeta.previousLevelNeighbors.get(node.key) || []);
      if (level === 1 && centerKey && !parentCandidates.includes(centerKey)) {
        parentCandidates.unshift(centerKey);
      }
      const rootSupportByKey = new Map();
      parentCandidates.forEach((parentKey) => {
        const rootKey = parentKey === centerKey
          ? node.key
          : (clusterRootByKey.get(parentKey) || parentKey);
        rootSupportByKey.set(rootKey, (rootSupportByKey.get(rootKey) || 0) + 1);
      });
      const parentKey = parentCandidates
        .map((candidateKey) => {
          const candidateMetrics = nodeSeedMetricsByKey.get(candidateKey) || {};
          const rootKey = candidateKey === centerKey
            ? node.key
            : (clusterRootByKey.get(candidateKey) || candidateKey);
          return {
            candidateKey,
            rootSupport: rootSupportByKey.get(rootKey) || 0,
            childCount: graphMeta.nextLevelNeighbors.get(candidateKey)?.size || 0,
            degree: graphMeta.adjacency.get(candidateKey)?.size || 0,
            safetyRadius: Number(candidateMetrics.safetyRadius) || 0
          };
        })
        .sort((left, right) => (
          right.rootSupport - left.rootSupport
          || right.childCount - left.childCount
          || right.degree - left.degree
          || right.safetyRadius - left.safetyRadius
          || String(left.candidateKey).localeCompare(String(right.candidateKey))
        ))[0]?.candidateKey || centerKey;

      if (parentKey) {
        primaryParentByKey.set(node.key, parentKey);
        ensureChildren(parentKey).push(node.key);
      }
      depthByKey.set(node.key, level);
      if (level === 1 || parentKey === centerKey) {
        clusterRootByKey.set(node.key, node.key);
      } else {
        clusterRootByKey.set(node.key, clusterRootByKey.get(parentKey) || parentKey || node.key);
      }
    });
  });

  const treeEdgeKeySet = new Set();
  primaryParentByKey.forEach((parentKey, nodeKey) => {
    const edgeKey = parentKey < nodeKey ? `${parentKey}|${nodeKey}` : `${nodeKey}|${parentKey}`;
    treeEdgeKeySet.add(edgeKey);
  });

  const crossEdgeCountByKey = new Map();
  const crossEdges = [];
  graphMeta.adjacency.forEach((neighbors, fromKey) => {
    neighbors.forEach((toKey) => {
      if (fromKey >= toKey) return;
      const edgeKey = fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`;
      if (treeEdgeKeySet.has(edgeKey)) return;
      crossEdges.push({ fromKey, toKey });
      crossEdgeCountByKey.set(fromKey, (crossEdgeCountByKey.get(fromKey) || 0) + 1);
      crossEdgeCountByKey.set(toKey, (crossEdgeCountByKey.get(toKey) || 0) + 1);
    });
  });

  const subtreeNodeCountByKey = new Map();
  const subtreeLabelAreaByKey = new Map();
  const subtreeMaxDepthByKey = new Map();
  const subtreeDemandByKey = new Map();
  const requiredSpanByKey = new Map();
  const requiredRadiusByKey = new Map();
  const overflowByKey = new Map();

  levels
    .slice()
    .sort((left, right) => right - left)
    .forEach((level) => {
      const nodes = nodesByLevel.get(level) || [];
      nodes.forEach((node) => {
        const key = node.key;
        const labelMetrics = labelMetricsByKey.get(key) || node.labelMetrics || estimateStarMapLabelMetrics(node.label);
        const children = childrenByParent.get(key) || [];
        const ownLabelArea = (Number(labelMetrics.widthHint) || 112) * (Number(labelMetrics.heightHint) || 28);
        const ownBoundaryCount = graphMeta.boundaryCountByKey.get(key) || 0;
        const ownCrossCount = crossEdgeCountByKey.get(key) || 0;
        const ownMetrics = nodeSeedMetricsByKey.get(key) || {};
        const childNodeCount = children.reduce((sum, childKey) => sum + (subtreeNodeCountByKey.get(childKey) || 0), 0);
        const childLabelArea = children.reduce((sum, childKey) => sum + (subtreeLabelAreaByKey.get(childKey) || 0), 0);
        const childDemand = children.reduce((sum, childKey) => sum + (subtreeDemandByKey.get(childKey) || 0), 0);
        const childMaxDepth = children.reduce((max, childKey) => Math.max(max, subtreeMaxDepthByKey.get(childKey) || 1), 0);
        const ownRadius = Number(ownMetrics.radius) || (Number(node.radius) || 18);
        const ownSafetyRadius = Number(ownMetrics.safetyRadius) || 28;
        const ownBaseSpan = clamp(
          (
            ((Number(labelMetrics.widthHint) || 112) + ownSafetyRadius * 0.6)
            / Math.max(40, ownRadius + ownSafetyRadius * 0.5)
          ) * 0.18,
          0.16,
          0.72
        );
        const childRequiredSpans = children.map((childKey) => requiredSpanByKey.get(childKey) || 0.18);
        const siblingGap = children.length > 1 ? (children.length - 1) * 0.06 : 0;
        const childrenSpan = childRequiredSpans.reduce((sum, value) => sum + value, 0) + siblingGap;
        const ownRequiredSpan = children.length > 0
          ? clamp(Math.max(ownBaseSpan, childrenSpan * 1.04), ownBaseSpan, Math.min(3.4, ownBaseSpan + childrenSpan + 0.4))
          : ownBaseSpan;
        const ownRequiredRadius = clamp(
          ownRadius + ownSafetyRadius * 0.42 + (children.length > 0 ? Math.max(...children.map((childKey) => requiredRadiusByKey.get(childKey) || ownRadius * 1.2)) * 0.58 : 0),
          ownRadius + 12,
          320
        );
        const ownDemand = (
          1
          + ownLabelArea * 0.00022
          + ownBoundaryCount * 0.58
          + ownCrossCount * 0.42
          + (nodeSeedMetricsByKey.get(key)?.degree || 0) * 0.06
        );
        subtreeNodeCountByKey.set(key, 1 + childNodeCount);
        subtreeLabelAreaByKey.set(key, ownLabelArea + childLabelArea);
        subtreeMaxDepthByKey.set(key, Math.max(1, childMaxDepth + 1));
        subtreeDemandByKey.set(key, ownDemand + childDemand);
        requiredSpanByKey.set(key, ownRequiredSpan);
        requiredRadiusByKey.set(key, ownRequiredRadius);
        overflowByKey.set(key, 0);
      });
    });

  const clusterMembersByRoot = new Map();
  levels.forEach((level) => {
    (nodesByLevel.get(level) || []).forEach((node) => {
      const clusterRoot = clusterRootByKey.get(node.key) || node.key;
      const bucket = clusterMembersByRoot.get(clusterRoot) || [];
      bucket.push(node);
      clusterMembersByRoot.set(clusterRoot, bucket);
    });
  });

  const topLevelNodes = (nodesByLevel.get(1) || []).slice();
  const clusterIndexByRoot = new Map();
  topLevelNodes.forEach((node, index) => {
    clusterIndexByRoot.set(node.key, index);
  });

  const clusters = topLevelNodes.map((rootNode) => {
    const nodes = clusterMembersByRoot.get(rootNode.key) || [rootNode];
    const totalDegree = nodes.reduce((sum, node) => sum + (graphMeta.adjacency.get(node.key)?.size || 0), 0);
    const totalLabelWidth = nodes.reduce((sum, node) => {
      const labelMetrics = labelMetricsByKey.get(node.key) || node.labelMetrics || estimateStarMapLabelMetrics(node.label);
      return sum + (Number(labelMetrics.widthHint) || 112);
    }, 0);
    const totalBoundary = nodes.reduce((sum, node) => sum + (graphMeta.boundaryCountByKey.get(node.key) || 0), 0);
    const rootDemand = subtreeDemandByKey.get(rootNode.key) || nodes.length;
    return {
      rootKey: rootNode.key,
      index: clusterIndexByRoot.get(rootNode.key) ?? 0,
      nodes,
      weight: rootDemand,
      totalDegree,
      totalLabelWidth,
      averageDegree: totalDegree / Math.max(1, nodes.length),
      averageLabelWidth: totalLabelWidth / Math.max(1, nodes.length),
      spreadScore: rootDemand + nodes.length * 0.32 + totalBoundary * 0.18
    };
  }).sort((left, right) => (
    right.spreadScore - left.spreadScore
    || right.weight - left.weight
    || left.index - right.index
    || String(left.rootKey).localeCompare(String(right.rootKey))
  ));

  return {
    primaryParentByKey,
    childrenByParent,
    clusterRootByKey,
    depthByKey,
    levelByKey,
    nodeByKey,
    crossEdges,
    crossEdgeCountByKey,
    subtreeNodeCountByKey,
    subtreeLabelAreaByKey,
    subtreeMaxDepthByKey,
    subtreeDemandByKey,
    requiredSpanByKey,
    requiredRadiusByKey,
    overflowByKey,
    clusterMembersByRoot,
    clusters
  };
};

const buildSiblingOrderingByParent = ({
  centerKey = '',
  childrenByParent = new Map(),
  clusterRootByKey = new Map(),
  graphMeta,
  sectorPlan = null,
  subtreeDemandByKey = new Map()
}) => {
  const siblingOrderByParent = new Map();
  const childPreferredAngleByKey = new Map();

  childrenByParent.forEach((children, parentKey) => {
    const ordered = children
      .map((childKey, index) => {
        const clusterRoot = clusterRootByKey.get(childKey) || childKey;
        const wedge = sectorPlan?.wedgeByRoot?.get?.(clusterRoot);
        const externalAngles = Array.from(graphMeta.adjacency.get(childKey) || [])
          .filter((neighborKey) => neighborKey !== parentKey)
          .map((neighborKey) => {
            const neighborRoot = clusterRootByKey.get(neighborKey) || neighborKey;
            return sectorPlan?.wedgeByRoot?.get?.(neighborRoot)?.centerAngle
              ?? sectorPlan?.preferredAngleByRoot?.get?.(neighborRoot);
          })
          .filter((value) => Number.isFinite(value))
          .map((angle) => ({ angle, weight: 1.2 }));
        const preferredAngle = averageAngles([
          { angle: wedge?.centerAngle ?? -Math.PI / 2, weight: parentKey === centerKey ? 2.8 : 1.6 },
          ...externalAngles
        ], wedge?.centerAngle ?? -Math.PI / 2);
        childPreferredAngleByKey.set(childKey, preferredAngle);
        return {
          childKey,
          preferredAngle: normalizePositiveAngle(preferredAngle),
          demand: subtreeDemandByKey.get(childKey) || 1,
          baselineIndex: index
        };
      })
      .sort((left, right) => (
        left.preferredAngle - right.preferredAngle
        || right.demand - left.demand
        || left.baselineIndex - right.baselineIndex
        || String(left.childKey).localeCompare(String(right.childKey))
      ))
      .map((entry) => entry.childKey);

    siblingOrderByParent.set(parentKey, ordered);
  });

  return {
    siblingOrderByParent,
    childPreferredAngleByKey
  };
};

const buildTreeNodeScopes = ({
  centerKey = '',
  childrenByParent = new Map(),
  siblingOrderByParent = new Map(),
  subtreeDemandByKey = new Map(),
  requiredSpanByKey = new Map(),
  requiredRadiusByKey = new Map(),
  clusterRootByKey = new Map(),
  sectorPlan = null
}) => {
  const scopeByKey = new Map();
  const radialOffsetByKey = new Map();
  const siblingYieldByParent = new Map();

  const measureAvailableSpan = (parentKey, parentScope, childCount) => clamp(
    parentKey === centerKey
      ? parentScope.span
      : parentScope.span * (childCount > 1 ? 0.8 : 0.56),
    Math.max(0.2, childCount * 0.12),
    Math.max(0.24, parentScope.span * 0.92)
  );

  const assignChildren = (parentKey, parentScope) => {
    const children = siblingOrderByParent.get(parentKey) || childrenByParent.get(parentKey) || [];
    if (children.length < 1) return;
    const usableSpan = measureAvailableSpan(parentKey, parentScope, children.length);
    const gapCount = Math.max(0, children.length - 1);
    const baseGap = children.length > 1 ? 0.06 : 0;
    const requestedSpan = children.reduce((sum, childKey) => sum + (requiredSpanByKey.get(childKey) || 0.18), 0) + gapCount * baseGap;
    const overflow = Math.max(0, requestedSpan - usableSpan);
    siblingYieldByParent.set(parentKey, overflow);
    const shrinkRatio = requestedSpan > 0.0001
      ? Math.min(1, usableSpan / requestedSpan)
      : 1;
    const spanByKey = new Map();
    const flexibleChildren = [];
    children.forEach((childKey) => {
      const requested = requiredSpanByKey.get(childKey) || 0.18;
      const minSpan = Math.max(0.12, requested * 0.72);
      const nextSpan = overflow > 0
        ? Math.max(minSpan, requested * shrinkRatio)
        : requested;
      spanByKey.set(childKey, nextSpan);
      const flexibility = requested - minSpan;
      if (flexibility > 0.001) {
        flexibleChildren.push(childKey);
      }
    });
    let allocatedSpan = children.reduce((sum, childKey) => sum + (spanByKey.get(childKey) || 0), 0) + gapCount * baseGap;
    if (allocatedSpan > usableSpan && flexibleChildren.length > 0) {
      let extraOverflow = allocatedSpan - usableSpan;
      const totalFlex = flexibleChildren.reduce((sum, childKey) => {
        const requested = requiredSpanByKey.get(childKey) || 0.18;
        const minSpan = Math.max(0.12, requested * 0.72);
        return sum + Math.max(0, (spanByKey.get(childKey) || requested) - minSpan);
      }, 0);
      if (totalFlex > 0.001) {
        flexibleChildren.forEach((childKey) => {
          const current = spanByKey.get(childKey) || (requiredSpanByKey.get(childKey) || 0.18);
          const minSpan = Math.max(0.12, (requiredSpanByKey.get(childKey) || 0.18) * 0.72);
          const reducible = Math.max(0, current - minSpan);
          const cut = extraOverflow * (reducible / totalFlex);
          spanByKey.set(childKey, Math.max(minSpan, current - cut));
        });
      }
      allocatedSpan = children.reduce((sum, childKey) => sum + (spanByKey.get(childKey) || 0), 0) + gapCount * baseGap;
    }
    if (allocatedSpan < usableSpan) {
      const spare = usableSpan - allocatedSpan;
      const totalWeight = children.reduce((sum, childKey) => sum + Math.max(0.2, subtreeDemandByKey.get(childKey) || 1), 0);
      children.forEach((childKey) => {
        const current = spanByKey.get(childKey) || 0.18;
        const add = spare * (Math.max(0.2, subtreeDemandByKey.get(childKey) || 1) / Math.max(0.0001, totalWeight));
        spanByKey.set(childKey, current + add);
      });
      allocatedSpan = children.reduce((sum, childKey) => sum + (spanByKey.get(childKey) || 0), 0) + gapCount * baseGap;
    }
    const centeredSpan = Math.min(usableSpan, allocatedSpan);
    let cursor = parentScope.centerAngle - centeredSpan * 0.5;
    children.forEach((childKey) => {
      const span = spanByKey.get(childKey) || Math.max(0.12, usableSpan / Math.max(1, children.length));
      const centerAngle = cursor + span * 0.5;
      const clusterRoot = clusterRootByKey.get(childKey) || childKey;
      const wedge = sectorPlan?.wedgeByRoot?.get?.(clusterRoot);
      const requestedRadius = requiredRadiusByKey.get(childKey) || 0;
      const radialOffset = overflow > 0
        ? Math.min(56, overflow * 54 + Math.max(0, requestedRadius - 84) * 0.08)
        : 0;
      const childScope = {
        centerAngle: unwrapAngleNear(centerAngle, parentScope.centerAngle),
        span,
        clusterRoot,
        sectorIndex: wedge?.sectorIndex ?? parentScope.sectorIndex ?? -1,
        radialOffset
      };
      scopeByKey.set(childKey, childScope);
      radialOffsetByKey.set(childKey, radialOffset);
      assignChildren(childKey, childScope);
      cursor += span + baseGap;
    });
  };

  (childrenByParent.get(centerKey) || []).forEach((rootKey) => {
    const wedge = sectorPlan?.wedgeByRoot?.get?.(rootKey);
    const rootScope = {
      centerAngle: wedge?.centerAngle ?? -Math.PI / 2,
      span: Math.max(0.2, (wedge?.span || (TAU / Math.max(1, childrenByParent.get(centerKey)?.length || 1))) - (wedge?.padding || 0) * 2),
      clusterRoot: rootKey,
      sectorIndex: wedge?.sectorIndex ?? -1,
      radialOffset: 0
    };
    scopeByKey.set(rootKey, rootScope);
    radialOffsetByKey.set(rootKey, 0);
    assignChildren(rootKey, rootScope);
  });

  return {
    scopeByKey,
    radialOffsetByKey,
    siblingYieldByParent
  };
};

const buildLayoutSprings = ({
  graphMeta,
  bodyByKey = new Map(),
  center,
  centerKey = '',
  primaryParentByKey = new Map()
}) => {
  const springs = [];
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
      springs.push({
        fromKey: key,
        toKey: neighborKey,
        fromBody,
        toBody,
        isHierarchyEdge,
        hierarchyWeight: isHierarchyEdge ? (key === centerKey || neighborKey === centerKey ? 3 : 2) : 1
      });
    });
  });
  return springs;
};

const collectSubtreeKeys = (rootKey, childrenByParent = new Map(), cache = new Map()) => {
  if (cache.has(rootKey)) return cache.get(rootKey);
  const keys = [rootKey];
  (childrenByParent.get(rootKey) || []).forEach((childKey) => {
    keys.push(...collectSubtreeKeys(childKey, childrenByParent, cache));
  });
  cache.set(rootKey, keys);
  return keys;
};

const buildBodyFromPlacement = ({
  node,
  nodeKey,
  center,
  x,
  y,
  band,
  scope,
  clusterRoot,
  clusterSize,
  parentKey = '',
  siblingIndex = 0,
  siblingCount = 1,
  seedMetrics = {},
  labelMetrics = {}
}) => ({
  ...node,
  key: nodeKey,
  nodeKey,
  clusterRoot,
  clusterSignature: clusterRoot,
  clusterSize,
  sectorIndex: scope?.sectorIndex ?? -1,
  x,
  y,
  vx: 0,
  vy: 0,
  seedX: x,
  seedY: y,
  targetDistance: Math.hypot(x - center.x, y - center.y),
  radiusBias: Math.hypot(x - center.x, y - center.y) - (band?.ideal || 0),
  radius: seedMetrics.radius || (Number(node?.radius) || 12),
  collisionRadius: seedMetrics.collisionRadius || (seedMetrics.radius || (Number(node?.radius) || 12)),
  labelWidthHint: labelMetrics.widthHint || seedMetrics.labelWidthHint || 112,
  labelHeightHint: labelMetrics.heightHint || seedMetrics.labelHeightHint || 28,
  labelOffsetY: node.labelOffsetY,
  labelPlacement: node.labelPlacement,
  labelMetrics,
  band,
  degree: seedMetrics.degree || 0,
  childCount: seedMetrics.childCount || 0,
  importance: seedMetrics.importance || 1,
  siblingIndex,
  siblingCount,
  subRingIndex: 0,
  primaryParentKey: parentKey,
  safetyRadius: seedMetrics.safetyRadius || 28,
  labelRect: buildLabelRect({
    x,
    y,
    radius: seedMetrics.radius || (Number(node?.radius) || 12),
    labelWidthHint: labelMetrics.widthHint || seedMetrics.labelWidthHint || 112,
    labelHeightHint: labelMetrics.heightHint || seedMetrics.labelHeightHint || 28,
    labelOffsetY: node.labelOffsetY,
    labelPlacement: node.labelPlacement
  })
});

const buildSegmentForBodies = (fromBody, toBody) => {
  if (!fromBody || !toBody) return null;
  return buildWorldSegment(fromBody, toBody, 2);
};

const evaluatePlacementCandidate = ({
  candidateBody,
  nodeKey = '',
  parentKey = '',
  parentBody = null,
  center,
  centerKey = '',
  band,
  scope,
  placedBodies = new Map(),
  segments = [],
  graphMeta
}) => {
  const radialDistance = Math.hypot(candidateBody.x - center.x, candidateBody.y - center.y);
  const angle = Math.atan2(candidateBody.y - center.y, candidateBody.x - center.x);
  const angleOffset = angleDistance(angle, scope?.centerAngle ?? angle);
  const centerLabel = buildLabelRect(center);
  const centerDistance = Math.hypot(candidateBody.x - center.x, candidateBody.y - center.y);
  const centerGap = center.radius + Math.max(candidateBody.radius, candidateBody.collisionRadius || 0) + 12;
  let penalty = 0;

  if (band) {
    if (radialDistance < band.min) {
      return Number.POSITIVE_INFINITY;
    }
    penalty += Math.abs(radialDistance - band.ideal) * 0.35;
  }

  if (scope) {
    const maxAngleOffset = Math.max(0.12, scope.span * 0.5);
    if (angleOffset > maxAngleOffset) {
      return Number.POSITIVE_INFINITY;
    }
    penalty += angleOffset * 120;
  }

  if (centerDistance < centerGap) {
    return Number.POSITIVE_INFINITY;
  }
  if (circleHitsRect({
    x: candidateBody.x,
    y: candidateBody.y,
    radius: Math.max(candidateBody.radius, candidateBody.collisionRadius || 0)
  }, centerLabel, 12)) {
    return Number.POSITIVE_INFINITY;
  }
  if (rectsOverlap(candidateBody.labelRect, centerLabel)) {
    return Number.POSITIVE_INFINITY;
  }

  placedBodies.forEach((body, key) => {
    if (!Number.isFinite(penalty)) return;
    if (key === nodeKey) return;
    const dx = candidateBody.x - body.x;
    const dy = candidateBody.y - body.y;
    const distance = Math.hypot(dx, dy) || 0.001;
    const minGap = (candidateBody.collisionRadius || candidateBody.radius || 0)
      + (body.collisionRadius || body.radius || 0)
      + 8;
    if (distance < minGap) {
      penalty = Number.POSITIVE_INFINITY;
      return;
    }
    if (rectsOverlap(candidateBody.labelRect, body.labelRect)) {
      penalty = Number.POSITIVE_INFINITY;
      return;
    }
    if (circleHitsRect({ x: candidateBody.x, y: candidateBody.y, radius: candidateBody.collisionRadius || candidateBody.radius || 0 }, body.labelRect, 10)) {
      penalty = Number.POSITIVE_INFINITY;
      return;
    }
    if (circleHitsRect({ x: body.x, y: body.y, radius: body.collisionRadius || body.radius || 0 }, candidateBody.labelRect, 10)) {
      penalty = Number.POSITIVE_INFINITY;
      return;
    }
  });
  if (!Number.isFinite(penalty)) return Number.POSITIVE_INFINITY;

  const incomingStart = parentBody || center;
  const incomingSegment = buildSegmentForBodies(incomingStart, candidateBody);
  if (incomingSegment) {
    placedBodies.forEach((body, key) => {
      if (!Number.isFinite(penalty)) return;
      if (key === nodeKey || key === parentKey) return;
      const bodyDistance = distancePointToSegment(body, incomingSegment.start, incomingSegment.end);
      const nodeClearance = Math.max(18, (body.collisionRadius || body.radius || 0) + 10);
      if (bodyDistance.projection > 0.06 && bodyDistance.projection < 0.94 && bodyDistance.distance < nodeClearance) {
        penalty = Number.POSITIVE_INFINITY;
        return;
      }
      const labelDistance = distanceSegmentToRect(incomingSegment.start, incomingSegment.end, body.labelRect);
      const labelClearance = Math.max(10, (body.labelRect?.height || body.labelHeightHint || 24) * 0.32);
      if (labelDistance.distance < labelClearance) {
        penalty = Number.POSITIVE_INFINITY;
        return;
      }
    });
    if (!Number.isFinite(penalty)) return Number.POSITIVE_INFINITY;

    segments.forEach((segmentMeta) => {
      if (!Number.isFinite(penalty)) return;
      if (
        segmentMeta.fromKey === parentKey
        || segmentMeta.toKey === parentKey
        || segmentMeta.fromKey === nodeKey
        || segmentMeta.toKey === nodeKey
      ) {
        return;
      }
      const intersection = computeSegmentIntersection(
        incomingSegment,
        { start: segmentMeta.start, end: segmentMeta.end }
      );
      if (intersection.intersects) {
        penalty = Number.POSITIVE_INFINITY;
      }
    });
  }
  if (!Number.isFinite(penalty)) return Number.POSITIVE_INFINITY;

  if (parentBody) {
    const branchDistance = Math.hypot(candidateBody.x - parentBody.x, candidateBody.y - parentBody.y);
    const idealBranchDistance = clamp(
      parentBody.radius + candidateBody.radius + 22 + (parentBody.safetyRadius + candidateBody.safetyRadius) * 0.1,
      54,
      124
    );
    penalty += Math.abs(branchDistance - idealBranchDistance) * 2.2;
  }

  const adjacency = graphMeta.adjacency.get(nodeKey) || new Set();
  adjacency.forEach((neighborKey) => {
    if (!Number.isFinite(penalty)) return;
    if (!placedBodies.has(neighborKey) || neighborKey === parentKey) return;
    const neighborBody = placedBodies.get(neighborKey);
    const segment = buildSegmentForBodies(candidateBody, neighborBody);
    if (!segment) return;
    penalty += Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y) * 0.12;
    placedBodies.forEach((body, key) => {
      if (!Number.isFinite(penalty)) return;
      if (key === nodeKey || key === neighborKey) return;
      const bodyDistance = distancePointToSegment(body, segment.start, segment.end);
      const nodeClearance = Math.max(18, (body.collisionRadius || body.radius || 0) + 10);
      if (bodyDistance.projection > 0.06 && bodyDistance.projection < 0.94 && bodyDistance.distance < nodeClearance) {
        penalty = Number.POSITIVE_INFINITY;
        return;
      }
    });
  });

  return penalty;
};

const evaluateFallbackPlacementCandidate = ({
  candidateBody,
  nodeKey = '',
  parentKey = '',
  parentBody = null,
  center,
  band,
  scope,
  placedBodies = new Map(),
  segments = [],
  graphMeta
}) => {
  let penalty = 0;
  const radialDistance = Math.hypot(candidateBody.x - center.x, candidateBody.y - center.y);
  const angle = Math.atan2(candidateBody.y - center.y, candidateBody.x - center.x);

  if (band) {
    if (radialDistance < band.min) penalty += (band.min - radialDistance) * 640;
    penalty += Math.abs(radialDistance - band.ideal) * 0.65;
  }

  if (scope) {
    penalty += angleDistance(angle, scope.centerAngle ?? angle) * 140;
  }

  if (parentBody) {
    penalty += Math.hypot(candidateBody.x - parentBody.x, candidateBody.y - parentBody.y) * 0.9;
  }

  placedBodies.forEach((body, key) => {
    if (key === nodeKey) return;
    const distance = Math.hypot(candidateBody.x - body.x, candidateBody.y - body.y) || 0.001;
    const minGap = (candidateBody.collisionRadius || candidateBody.radius || 0)
      + (body.collisionRadius || body.radius || 0)
      + 8;
    if (distance < minGap) {
      penalty += 500000 + (minGap - distance) * 1800;
    }
    if (rectsOverlap(candidateBody.labelRect, body.labelRect)) {
      const overlapX = Math.max(0, Math.min(candidateBody.labelRect.right, body.labelRect.right) - Math.max(candidateBody.labelRect.left, body.labelRect.left));
      const overlapY = Math.max(0, Math.min(candidateBody.labelRect.bottom, body.labelRect.bottom) - Math.max(candidateBody.labelRect.top, body.labelRect.top));
      penalty += 450000 + overlapX * overlapY * 32;
    }
    if (circleHitsRect({ x: candidateBody.x, y: candidateBody.y, radius: candidateBody.collisionRadius || candidateBody.radius || 0 }, body.labelRect, 10)) {
      penalty += 320000;
    }
    if (circleHitsRect({ x: body.x, y: body.y, radius: body.collisionRadius || body.radius || 0 }, candidateBody.labelRect, 10)) {
      penalty += 320000;
    }
  });

  const incomingStart = parentBody || center;
  const incomingSegment = buildSegmentForBodies(incomingStart, candidateBody);
  if (incomingSegment) {
    placedBodies.forEach((body, key) => {
      if (key === nodeKey || key === parentKey) return;
      const bodyDistance = distancePointToSegment(body, incomingSegment.start, incomingSegment.end);
      const nodeClearance = Math.max(18, (body.collisionRadius || body.radius || 0) + 10);
      if (bodyDistance.projection > 0.06 && bodyDistance.projection < 0.94 && bodyDistance.distance < nodeClearance) {
        penalty += 420000 + (nodeClearance - bodyDistance.distance) * 1600;
      }
      const labelDistance = distanceSegmentToRect(incomingSegment.start, incomingSegment.end, body.labelRect);
      const labelClearance = Math.max(10, (body.labelRect?.height || body.labelHeightHint || 24) * 0.32);
      if (labelDistance.distance < labelClearance) {
        penalty += 360000 + (labelClearance - labelDistance.distance) * 1200;
      }
    });

    segments.forEach((segmentMeta) => {
      if (
        segmentMeta.fromKey === parentKey
        || segmentMeta.toKey === parentKey
        || segmentMeta.fromKey === nodeKey
        || segmentMeta.toKey === nodeKey
      ) {
        return;
      }
      if (computeSegmentIntersection(incomingSegment, { start: segmentMeta.start, end: segmentMeta.end }).intersects) {
        penalty += segmentMeta.isHierarchyEdge ? 380000 : 240000;
      }
    });
  }

  const adjacency = graphMeta.adjacency.get(nodeKey) || new Set();
  adjacency.forEach((neighborKey) => {
    if (!placedBodies.has(neighborKey) || neighborKey === parentKey) return;
    const neighborBody = placedBodies.get(neighborKey);
    const segment = buildSegmentForBodies(candidateBody, neighborBody);
    if (!segment) return;
    penalty += Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y) * 0.18;
  });

  return penalty;
};

const buildPlacementCandidates = ({
  center,
  centerKey = '',
  nodeKey = '',
  parentKey = '',
  parentBody = null,
  band,
  scope,
  childPreferredAngle = null,
  siblingIndex = 0,
  siblingCount = 1,
  seedMetrics = {}
}) => {
  const parentAngle = parentBody
    ? Math.atan2(parentBody.y - center.y, parentBody.x - center.x)
    : (scope?.centerAngle ?? -Math.PI / 2);
  const idealAngle = averageAngles([
    { angle: scope?.centerAngle ?? parentAngle, weight: 2.8 },
    { angle: parentAngle, weight: parentKey === centerKey ? 1.1 : 1.8 },
    ...(Number.isFinite(childPreferredAngle) ? [{ angle: childPreferredAngle, weight: 1.6 }] : [])
  ], scope?.centerAngle ?? parentAngle);
  const baseDistance = parentBody
    ? clamp(
      Math.max(
        band?.min || 0,
        Math.hypot(parentBody.x - center.x, parentBody.y - center.y) + (seedMetrics.radius || 16) * 0.5 + 24
      ),
      (band?.min || 0) + 2,
      Math.max((band?.min || 0) + 2, (band?.ideal || 0) + 2400)
    )
    : clamp(
      band?.ideal || 0,
      (band?.min || 0) + 2,
      Math.max((band?.min || 0) + 2, (band?.ideal || 0) + 2400)
    );
  const siblingBias = siblingCount > 1
    ? (siblingIndex - (siblingCount - 1) * 0.5) / Math.max(1, siblingCount - 1)
    : 0;
  const angleWindow = clamp(
    Math.max(0.12, (scope?.span || Math.PI / 8) * 0.46),
    0.12,
    0.88
  );
  const angleOffsets = parentBody
    ? [
      siblingBias * angleWindow * 0.72,
      0,
      -angleWindow * 0.18,
      angleWindow * 0.18,
      -angleWindow * 0.34,
      angleWindow * 0.34,
      -angleWindow * 0.52,
      angleWindow * 0.52,
      -angleWindow * 0.72,
      angleWindow * 0.72
    ]
    : [
      siblingBias * angleWindow * 0.42,
      0,
      -angleWindow * 0.26,
      angleWindow * 0.26,
      -angleWindow * 0.5,
      angleWindow * 0.5,
      -angleWindow * 0.74,
      angleWindow * 0.74
    ];
  const distanceOffsets = parentBody
    ? [0, 12, 24, 40, 60, 84, 120, 168, 228, 300, 384, 480, 588, 708, 840, 984]
    : [0, 16, 30, 48, 72, 108, 156, 216, 288, 372, 468, 576, 696, 828, 972, 1128];
  const candidates = [];

  angleOffsets.forEach((angleOffset) => {
    distanceOffsets.forEach((distanceOffset) => {
      const angle = idealAngle + angleOffset;
      if (parentBody) {
        const branchDistance = clamp(
          Math.max(
            parentBody.radius + (seedMetrics.radius || 16) + 24,
            (seedMetrics.safetyRadius || 28) * 0.55 + 34
          ) + distanceOffset,
          52,
          2400
        );
        const x = parentBody.x + Math.cos(angle) * branchDistance;
        const y = parentBody.y + Math.sin(angle) * branchDistance;
        const radialDistance = Math.hypot(x - center.x, y - center.y);
        if (band && radialDistance < band.min + 2) {
          return;
        }
        candidates.push({
          angle,
          distance: radialDistance,
          localDistance: branchDistance,
          x,
          y
        });
        return;
      }
      const distance = clamp(
        baseDistance + distanceOffset,
        (band?.min || 0) + 2,
        Math.max((band?.min || 0) + 2, baseDistance + 2400)
      );
      candidates.push({
        angle,
        distance,
        x: center.x + Math.cos(angle) * distance,
        y: center.y + Math.sin(angle) * distance
      });
    });
  });

  return candidates;
};

const buildBodiesWithPrefixFreeze = ({
  center,
  centerKey = '',
  levels = [],
  nodesByLevel = new Map(),
  graphMeta,
  labelMetricsByKey = new Map(),
  nodeSeedMetricsByKey = new Map(),
  bandByLevel = new Map(),
  primaryTreeMeta,
  sectorPlan = null
}) => {
  const {
    primaryParentByKey,
    childrenByParent,
    clusterRootByKey,
    subtreeDemandByKey,
    requiredSpanByKey,
    requiredRadiusByKey,
    clusters,
    nodeByKey
  } = primaryTreeMeta;
  const { siblingOrderByParent, childPreferredAngleByKey } = buildSiblingOrderingByParent({
    centerKey,
    childrenByParent,
    clusterRootByKey,
    graphMeta,
    sectorPlan,
    subtreeDemandByKey
  });
  const {
    scopeByKey,
    radialOffsetByKey,
    siblingYieldByParent
  } = buildTreeNodeScopes({
    centerKey,
    childrenByParent,
    siblingOrderByParent,
    subtreeDemandByKey,
    requiredSpanByKey,
    requiredRadiusByKey,
    clusterRootByKey,
    sectorPlan
  });

  const placedBodies = new Map();
  const bodies = [];
  const segments = [];
  const segmentKeySet = new Set();
  const clusterSizeByRoot = new Map(clusters.map((cluster) => [cluster.rootKey, cluster.nodes.length]));
  const orderedRootKeys = (childrenByParent.get(centerKey) || []).slice().sort((leftKey, rightKey) => {
    const leftWedge = sectorPlan?.wedgeByRoot?.get?.(leftKey);
    const rightWedge = sectorPlan?.wedgeByRoot?.get?.(rightKey);
    return (
      normalizePositiveAngle(leftWedge?.centerAngle ?? -Math.PI / 2)
      - normalizePositiveAngle(rightWedge?.centerAngle ?? -Math.PI / 2)
      || String(leftKey).localeCompare(String(rightKey))
    );
  });

  const registerSegmentsForNode = (nodeKey, body) => {
    const neighbors = graphMeta.adjacency.get(nodeKey) || new Set();
    neighbors.forEach((neighborKey) => {
      if (neighborKey !== centerKey && !placedBodies.has(neighborKey)) return;
      const edgeKey = nodeKey < neighborKey ? `${nodeKey}|${neighborKey}` : `${neighborKey}|${nodeKey}`;
      if (segmentKeySet.has(edgeKey)) return;
      const startBody = nodeKey === centerKey ? center : body;
      const endBody = neighborKey === centerKey ? center : placedBodies.get(neighborKey);
      const segment = buildSegmentForBodies(startBody, endBody);
      if (!segment) return;
      segmentKeySet.add(edgeKey);
      segments.push({
        fromKey: nodeKey,
        toKey: neighborKey,
        start: segment.start,
        end: segment.end,
        isHierarchyEdge: primaryParentByKey.get(nodeKey) === neighborKey || primaryParentByKey.get(neighborKey) === nodeKey || nodeKey === centerKey || neighborKey === centerKey
      });
    });
  };

  const placeNode = (nodeKey) => {
    const node = nodeByKey.get(nodeKey);
    if (!node) return;
    const parentKey = primaryParentByKey.get(nodeKey) || centerKey;
    const parentBody = parentKey === centerKey ? null : placedBodies.get(parentKey);
    const band = bandByLevel.get(Number(node.level || primaryTreeMeta.levelByKey.get(nodeKey) || 1));
    const scope = scopeByKey.get(nodeKey) || {
      centerAngle: sectorPlan?.wedgeByRoot?.get?.(clusterRootByKey.get(nodeKey) || nodeKey)?.centerAngle ?? -Math.PI / 2,
      span: Math.PI / 8,
      clusterRoot: clusterRootByKey.get(nodeKey) || nodeKey,
      sectorIndex: sectorPlan?.wedgeByRoot?.get?.(clusterRootByKey.get(nodeKey) || nodeKey)?.sectorIndex ?? -1
    };
    const labelMetrics = labelMetricsByKey.get(nodeKey) || node.labelMetrics || estimateStarMapLabelMetrics(node.label);
    const seedMetrics = nodeSeedMetricsByKey.get(nodeKey) || {};
    const siblings = siblingOrderByParent.get(parentKey) || [];
    const siblingIndex = Math.max(0, siblings.indexOf(nodeKey));
    const siblingCount = Math.max(1, siblings.length);
    const clusterRoot = clusterRootByKey.get(nodeKey) || nodeKey;
    const clusterSize = clusterSizeByRoot.get(clusterRoot) || 1;
    const radialOffset = radialOffsetByKey.get(nodeKey) || scope?.radialOffset || 0;
    const candidates = buildPlacementCandidates({
      center,
      centerKey,
      nodeKey,
      parentKey,
      parentBody,
      band,
      scope,
      childPreferredAngle: childPreferredAngleByKey.get(nodeKey),
      siblingIndex,
      siblingCount,
      seedMetrics
    }).map((candidate) => {
      if (!radialOffset) return candidate;
      const direction = parentBody
        ? normalize(candidate.x - parentBody.x, candidate.y - parentBody.y, {
          x: Math.cos(candidate.angle),
          y: Math.sin(candidate.angle)
        })
        : normalize(candidate.x - center.x, candidate.y - center.y, {
          x: Math.cos(candidate.angle),
          y: Math.sin(candidate.angle)
        });
      const nextX = (parentBody ? parentBody.x : center.x) + direction.x * ((parentBody ? Math.hypot(candidate.x - parentBody.x, candidate.y - parentBody.y) : candidate.distance) + radialOffset);
      const nextY = (parentBody ? parentBody.y : center.y) + direction.y * ((parentBody ? Math.hypot(candidate.x - parentBody.x, candidate.y - parentBody.y) : candidate.distance) + radialOffset);
      const nextDistance = Math.hypot(nextX - center.x, nextY - center.y);
      if (band && nextDistance < band.min + 2) {
        return candidate;
      }
      return {
        ...candidate,
        distance: nextDistance,
        x: nextX,
        y: nextY
      };
    });

    let bestBody = null;
    let bestPenalty = Number.POSITIVE_INFINITY;
    candidates.forEach((candidate) => {
      const body = buildBodyFromPlacement({
        node,
        nodeKey,
        center,
        x: candidate.x,
        y: candidate.y,
        band,
        scope,
        clusterRoot,
        clusterSize,
        parentKey,
        siblingIndex,
        siblingCount,
        seedMetrics,
        labelMetrics
      });
      const penalty = evaluatePlacementCandidate({
        candidateBody: body,
        nodeKey,
        parentKey,
        parentBody,
        center,
        centerKey,
        band,
        scope,
        placedBodies,
        segments,
        graphMeta
      });
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestBody = body;
      }
    });

    if (!bestBody) {
      const relaxedBand = band
        ? {
          ...band,
          min: Math.max(center.radius + 10, band.min - 28),
          max: band.max + 92,
          ideal: band.ideal + 26
        }
        : band;
      const relaxedScope = scope
        ? {
          ...scope,
          span: Math.min(Math.PI * 1.25, Math.max(scope.span * 1.9, scope.span + 0.42))
        }
        : scope;
      const relaxedCandidates = buildPlacementCandidates({
        center,
        centerKey,
        nodeKey,
        parentKey,
        parentBody,
        band: relaxedBand,
        scope: relaxedScope,
        childPreferredAngle: childPreferredAngleByKey.get(nodeKey),
        siblingIndex,
        siblingCount,
        seedMetrics
      });
      relaxedCandidates.forEach((candidate) => {
        const body = buildBodyFromPlacement({
          node,
          nodeKey,
          center,
          x: candidate.x,
          y: candidate.y,
          band: relaxedBand || band,
          scope: relaxedScope || scope,
          clusterRoot,
          clusterSize,
          parentKey,
          siblingIndex,
          siblingCount,
          seedMetrics,
          labelMetrics
        });
        const penalty = evaluatePlacementCandidate({
          candidateBody: body,
          nodeKey,
          parentKey,
          parentBody,
          center,
          centerKey,
          band: relaxedBand || band,
          scope: relaxedScope || scope,
          placedBodies,
          segments,
          graphMeta
        });
        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          bestBody = body;
        }
      });
    }

    if (!bestBody) {
      const fallbackScope = scope
        ? {
          ...scope,
          span: Math.min(Math.PI * 1.4, Math.max(scope.span * 2.4, scope.span + 0.8))
        }
        : scope;
      const fallbackBand = band
        ? {
          ...band,
          min: Math.max(center.radius + 10, band.min - 42),
          max: band.max + 140,
          ideal: band.ideal + 42
        }
        : band;
      const fallbackCandidates = buildPlacementCandidates({
        center,
        centerKey,
        nodeKey,
        parentKey,
        parentBody,
        band: fallbackBand,
        scope: fallbackScope,
        childPreferredAngle: childPreferredAngleByKey.get(nodeKey),
        siblingIndex,
        siblingCount,
        seedMetrics
      });
      fallbackCandidates.forEach((candidate) => {
        const body = buildBodyFromPlacement({
          node,
          nodeKey,
          center,
          x: candidate.x,
          y: candidate.y,
          band: fallbackBand || band,
          scope: fallbackScope || scope,
          clusterRoot,
          clusterSize,
          parentKey,
          siblingIndex,
          siblingCount,
          seedMetrics,
          labelMetrics
        });
        const penalty = evaluateFallbackPlacementCandidate({
          candidateBody: body,
          nodeKey,
          parentKey,
          parentBody,
          center,
          band: fallbackBand || band,
          scope: fallbackScope || scope,
          placedBodies,
          segments,
          graphMeta
        });
        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          bestBody = body;
        }
      });
    }

    if (!bestBody) {
      const emergencyAngle = (scope?.centerAngle ?? -Math.PI / 2) + (siblingIndex - (siblingCount - 1) * 0.5) * 0.18;
      const emergencyDistance = parentBody
        ? Math.max(
          56,
          Math.hypot(parentBody.x - center.x, parentBody.y - center.y) + parentBody.radius + (seedMetrics.radius || 16) + 28
        )
        : Math.max(center.radius + 44, band?.ideal || center.radius + 80);
      const emergencyX = parentBody
        ? parentBody.x + Math.cos(emergencyAngle) * Math.min(164, emergencyDistance * 0.34)
        : center.x + Math.cos(emergencyAngle) * emergencyDistance;
      const emergencyY = parentBody
        ? parentBody.y + Math.sin(emergencyAngle) * Math.min(164, emergencyDistance * 0.34)
        : center.y + Math.sin(emergencyAngle) * emergencyDistance;
      bestBody = buildBodyFromPlacement({
        node,
        nodeKey,
        center,
        x: emergencyX,
        y: emergencyY,
        band,
        scope,
        clusterRoot,
        clusterSize,
        parentKey,
        siblingIndex,
        siblingCount,
        seedMetrics,
        labelMetrics
      });
    }

    placedBodies.set(nodeKey, bestBody);
    bodies.push(bestBody);
    registerSegmentsForNode(nodeKey, bestBody);
    const children = siblingOrderByParent.get(nodeKey) || childrenByParent.get(nodeKey) || [];
    children.forEach((childKey) => {
      placeNode(childKey);
    });
  };

  orderedRootKeys.forEach((rootKey) => {
    placeNode(rootKey);
  });

  return {
    bodies,
    bodyByKey: placedBodies,
    scopeByKey,
    radialOffsetByKey,
    siblingYieldByParent,
    siblingOrderByParent
  };
};

const buildBadgeBodiesFromPlacedNodes = ({
  center,
  boundaryBadgeMeta = { badges: [], badgesBySourceKey: new Map() },
  bodyByKey = new Map(),
  clusterRootByKey = new Map()
}) => {
  const badgeBodies = [];
  const badgeBodyByStubId = new Map();
  const existingBodies = Array.from(bodyByKey.values());

  boundaryBadgeMeta.badges.forEach((badgeMeta, index) => {
    const sourceBody = bodyByKey.get(badgeMeta.sourceKey);
    if (!sourceBody) return;
    const baseAngle = Math.atan2(sourceBody.y - center.y, sourceBody.x - center.x);
    const angleOffsets = [0, -0.22, 0.22, -0.4, 0.4, -0.62, 0.62, -0.86, 0.86];
    const distanceOffsets = [0, 14, 28, 48, 72, 108, 156, 216, 288, 372];
    let bestBody = null;
    let bestPenalty = Number.POSITIVE_INFINITY;

    angleOffsets.forEach((offset) => {
      distanceOffsets.forEach((distanceOffset) => {
        const angle = baseAngle + offset + (index % 2 === 0 ? 0 : 0.04);
        const distance = sourceBody.targetDistance + sourceBody.radius + badgeMeta.radius + STAR_MAP_BADGE_LAYOUT.outwardGap + distanceOffset;
        const x = center.x + Math.cos(angle) * distance;
        const y = center.y + Math.sin(angle) * distance;
        const candidate = {
        key: badgeMeta.key,
        label: badgeMeta.label,
        level: badgeMeta.sourceLevel,
        clusterRoot: clusterRootByKey.get(badgeMeta.sourceKey) || badgeMeta.sourceKey,
        clusterSignature: clusterRootByKey.get(badgeMeta.sourceKey) || badgeMeta.sourceKey,
        clusterSize: sourceBody.clusterSize || 1,
        sectorIndex: sourceBody.sectorIndex,
        x,
        y,
        vx: 0,
        vy: 0,
        seedX: x,
        seedY: y,
        targetDistance: distance,
        radiusBias: distance - sourceBody.targetDistance,
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
        band: sourceBody.band,
        degree: 0,
        childCount: 0,
        importance: 0.72,
        siblingIndex: 0,
        siblingCount: 1,
        subRingIndex: 0,
        primaryParentKey: badgeMeta.sourceKey,
        safetyRadius: badgeMeta.radius + STAR_MAP_BADGE_LAYOUT.minSpacing,
        isStubBadge: true,
        stubId: badgeMeta.stubId,
        sourceKey: badgeMeta.sourceKey,
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

        let penalty = 0;
        existingBodies.forEach((body) => {
          const distanceToBody = Math.hypot(candidate.x - body.x, candidate.y - body.y);
          const minGap = (candidate.collisionRadius || candidate.radius) + (body.collisionRadius || body.radius || 0) + 8;
          if (distanceToBody < minGap) {
            penalty += 180000 + (minGap - distanceToBody) * 900;
          }
          if (rectsOverlap(candidate.labelRect, body.labelRect)) {
            penalty += 120000;
          }
        });

        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          bestBody = candidate;
        }
      });
    });

    if (!bestBody) {
      const angle = baseAngle + (index % 2 === 0 ? 0.18 : -0.18);
      const distance = sourceBody.targetDistance + sourceBody.radius + badgeMeta.radius + STAR_MAP_BADGE_LAYOUT.outwardGap + 420;
      const x = center.x + Math.cos(angle) * distance;
      const y = center.y + Math.sin(angle) * distance;
      bestBody = {
        key: badgeMeta.key,
        label: badgeMeta.label,
        level: badgeMeta.sourceLevel,
        clusterRoot: clusterRootByKey.get(badgeMeta.sourceKey) || badgeMeta.sourceKey,
        clusterSignature: clusterRootByKey.get(badgeMeta.sourceKey) || badgeMeta.sourceKey,
        clusterSize: sourceBody.clusterSize || 1,
        sectorIndex: sourceBody.sectorIndex,
        x,
        y,
        vx: 0,
        vy: 0,
        seedX: x,
        seedY: y,
        targetDistance: distance,
        radiusBias: distance - sourceBody.targetDistance,
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
        band: sourceBody.band,
        degree: 0,
        childCount: 0,
        importance: 0.72,
        siblingIndex: 0,
        siblingCount: 1,
        subRingIndex: 0,
        primaryParentKey: badgeMeta.sourceKey,
        safetyRadius: badgeMeta.radius + STAR_MAP_BADGE_LAYOUT.minSpacing,
        isStubBadge: true,
        stubId: badgeMeta.stubId,
        sourceKey: badgeMeta.sourceKey,
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
    }
    badgeBodies.push(bestBody);
    badgeBodyByStubId.set(bestBody.stubId, bestBody);
    bodyByKey.set(bestBody.key, bestBody);
    existingBodies.push(bestBody);
  });

  return {
    badgeBodies,
    badgeBodyByStubId
  };
};

const runSubtreeRepairPasses = ({
  center,
  centerKey = '',
  graphMeta,
  primaryParentByKey = new Map(),
  childrenByParent = new Map(),
  scopeByKey = new Map(),
  bodyByKey = new Map(),
  bandByLevel = new Map(),
  levelByKey = new Map(),
  labelMetricsByKey = new Map()
}) => {
  const subtreeCache = new Map();
  const movableKeys = Array.from(bodyByKey.values())
    .filter((body) => !body.isStubBadge)
    .sort((left, right) => (
      (levelByKey.get(right.key) || right.level || 0) - (levelByKey.get(left.key) || left.level || 0)
      || String(left.key).localeCompare(String(right.key))
    ))
    .map((body) => body.key);

  const evaluateBodies = (candidateBodyByKey) => {
    const candidateBodies = Array.from(candidateBodyByKey.values()).filter((body) => !body.isStubBadge);
    const springs = buildLayoutSprings({
      graphMeta,
      bodyByKey: candidateBodyByKey,
      center,
      centerKey,
      primaryParentByKey
    });
    return measureLayoutPenalty(center, candidateBodies, springs, centerKey);
  };

  let bestPenalty = evaluateBodies(bodyByKey);

  for (let pass = 0; pass < 2; pass += 1) {
    // eslint-disable-next-line no-loop-func
    movableKeys.forEach((nodeKey) => {
      const parentKey = primaryParentByKey.get(nodeKey) || centerKey;
      if (!parentKey) return;
      const currentBody = bodyByKey.get(nodeKey);
      if (!currentBody) return;
      const scope = scopeByKey.get(nodeKey);
      const band = bandByLevel.get(levelByKey.get(nodeKey) || currentBody.level || 1);
      const subtreeKeys = collectSubtreeKeys(nodeKey, childrenByParent, subtreeCache);
      const subtreeKeySet = new Set(subtreeKeys);
      Array.from(bodyByKey.values()).forEach((body) => {
        if (body.isStubBadge && subtreeKeySet.has(body.sourceKey)) {
          subtreeKeySet.add(body.key);
        }
      });

      const baseAngle = Math.atan2(currentBody.y - center.y, currentBody.x - center.x);
      const baseDistance = Math.hypot(currentBody.x - center.x, currentBody.y - center.y);
      const angleOffsets = [0, -0.08, 0.08, -0.16, 0.16];
      const distanceOffsets = [0, 14, 28];

      // eslint-disable-next-line no-loop-func
      angleOffsets.forEach((angleOffset) => {
        distanceOffsets.forEach((distanceOffset) => {
          const nextAngle = baseAngle + angleOffset;
          const nextDistance = clamp(
            baseDistance + distanceOffset,
            (band?.min || 0) + 2,
            (band?.max || baseDistance + distanceOffset) - 2
          );
          if (scope && angleDistance(nextAngle, scope.centerAngle) > Math.max(0.14, scope.span * 0.52)) return;
          const nextX = center.x + Math.cos(nextAngle) * nextDistance;
          const nextY = center.y + Math.sin(nextAngle) * nextDistance;
          const dx = nextX - currentBody.x;
          const dy = nextY - currentBody.y;
          if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;

          const candidateBodyByKey = new Map(bodyByKey);
          let invalid = false;
          subtreeKeySet.forEach((key) => {
            const body = candidateBodyByKey.get(key);
            if (!body) return;
            const nextBody = {
              ...body,
              x: body.x + dx,
              y: body.y + dy
            };
            nextBody.labelRect = buildLabelRect({
              x: nextBody.x,
              y: nextBody.y,
              radius: nextBody.radius,
              labelWidthHint: nextBody.labelWidthHint,
              labelHeightHint: nextBody.labelHeightHint,
              labelOffsetY: nextBody.labelOffsetY,
              labelPlacement: nextBody.labelPlacement
            });
            if (!nextBody.isStubBadge) {
              const nextBand = bandByLevel.get(levelByKey.get(nextBody.key) || nextBody.level || 1);
              const radialDistance = Math.hypot(nextBody.x - center.x, nextBody.y - center.y);
              if (nextBand && (radialDistance < nextBand.min - 6 || radialDistance > nextBand.max + 22)) {
                invalid = true;
              }
            }
            candidateBodyByKey.set(key, nextBody);
          });
          if (invalid) return;

          const penalty = evaluateBodies(candidateBodyByKey);
          if (penalty + 0.001 < bestPenalty) {
            bestPenalty = penalty;
            candidateBodyByKey.forEach((body, key) => {
              bodyByKey.set(key, body);
            });
          }
        });
      });
    });
  }

  return {
    bodyByKey,
    penalty: bestPenalty
  };
};

// eslint-disable-next-line no-unused-vars
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
  const nodeSeedMetricsByKey = buildNodeSeedMetricsByKey({
    layer,
    levels,
    nodesByLevel,
    graphMeta,
    labelMetricsByKey,
    levelMax,
    maxDegree,
    maxChildCount
  });
  const primaryTreeMeta = buildPrimaryTreeMeta({
    centerKey,
    levels,
    nodesByLevel,
    graphMeta,
    labelMetricsByKey,
    nodeSeedMetricsByKey
  });
  const boundaryBadgeMeta = buildBoundaryBadgeMeta({
    boundaryStubs,
    layer
  });

  const attempts = STAR_MAP_LAYOUT_SPREAD_ATTEMPTS;
  let best = null;

  attempts.forEach((spreadFactor) => {
    const bandByLevel = buildBandByLevel({
      levels,
      nodesByLevel,
      centerRadius: center.radius,
      spreadFactor
    });
    const sectorPlan = buildClusterSectorPlan({
      center,
      centerKey,
      clusters: primaryTreeMeta.clusters,
      levels,
      nodesByLevel,
      graphMeta,
      labelMetricsByKey,
      primaryParentByKey: primaryTreeMeta.primaryParentByKey,
      clusterRootByKey: primaryTreeMeta.clusterRootByKey,
      boundaryBadgeMeta
    });
    const placed = buildBodiesWithPrefixFreeze({
      center,
      centerKey,
      levels,
      nodesByLevel,
      graphMeta,
      labelMetricsByKey,
      nodeSeedMetricsByKey,
      bandByLevel,
      primaryTreeMeta,
      sectorPlan
    });
    const { badgeBodyByStubId } = buildBadgeBodiesFromPlacedNodes({
      center,
      boundaryBadgeMeta,
      bodyByKey: placed.bodyByKey,
      clusterRootByKey: primaryTreeMeta.clusterRootByKey
    });
    const repaired = runSubtreeRepairPasses({
      center,
      centerKey,
      graphMeta,
      primaryParentByKey: primaryTreeMeta.primaryParentByKey,
      childrenByParent: primaryTreeMeta.childrenByParent,
      scopeByKey: placed.scopeByKey,
      bodyByKey: placed.bodyByKey,
      bandByLevel,
      levelByKey: primaryTreeMeta.levelByKey,
      labelMetricsByKey
    });
    const candidateBodies = Array.from(repaired.bodyByKey.values());
    const springs = buildLayoutSprings({
      graphMeta,
      bodyByKey: repaired.bodyByKey,
      center,
      centerKey,
      primaryParentByKey: primaryTreeMeta.primaryParentByKey
    });
    candidateBodies.forEach((body) => {
      body.labelRect = buildLabelRect(body);
      body.angle = Math.atan2(body.y - center.y, body.x - center.x);
      body.nodeKey = body.key;
      if (!body.isStubBadge) {
        body.primaryParentKey = primaryTreeMeta.primaryParentByKey.get(body.key) || '';
      }
    });
    const penalty = measureLayoutPenalty(
      center,
      candidateBodies.filter((body) => !body.isStubBadge),
      springs,
      centerKey
    );
    const result = {
      bodies: candidateBodies,
      badgeBodyByStubId,
      bounds: buildContentBounds(center, candidateBodies),
      penalty,
      sectorPlan
    };
    if (!best || result.penalty < best.penalty) {
      best = result;
    }
  });

  const snappedBodies = snapshotBodies(best?.bodies || []);
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
