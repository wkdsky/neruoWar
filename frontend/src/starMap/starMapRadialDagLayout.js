const TAU = Math.PI * 2;
const EPSILON = 0.0001;
const RADIAL_DENSITY_K = 0.92;
const RADIAL_MIN_RADIUS = 24;
const RADIAL_SEGMENT_PADDING = 0.16;
const SINGLE_ROTATION_SAMPLES = 8;
const DUAL_ROTATION_SAMPLES = 10;
const SINGLE_ROTATION_SAMPLES_COARSE = 4;
const DUAL_ROTATION_SAMPLES_COARSE = 5;
const INITIAL_SWEEP_ROUNDS = 3;
const GEOMETRY_ASSIGNMENT_PASSES = 3;
const OVERLAP_EXPANSION_PASSES = 5;
const SWAP_ROUNDS = 2;
const BLOCK_WINDOW_MIN = 3;
const BLOCK_WINDOW_MAX = 4;
const MAX_BLOCK_PATTERNS = 3;
const BLOCK_WINDOW_LARGE_THRESHOLD = 12;
const BLOCK_MOVE_SKIP_THRESHOLD = 18;
const RING_ROTATION_STEPS = [-2, -1, 1, 2];
const NODE_NUDGE_STEPS = [-2, -1, 1, 2];
const ROTATION_DELTA_MIN = 0.04;
const ROTATION_DELTA_MAX = 0.22;
const NODE_NUDGE_MIN = 0.02;
const NODE_NUDGE_MAX = 0.12;
const RADIUS_ADJUST_FACTOR = 0.18;
const HUB_MIN_GAP_FLOOR = 0.1;
const HUB_MIN_GAP_CEIL = 1.35;
const FINALIST_LIMIT = 3;
const FINE_TUNE_LIMIT = 3;
const PROXY_CANDIDATE_BUFFER = 2;
const HIGH_DEGREE_NODE_THRESHOLD = 4;

const now = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizePositiveAngle = (angle = 0) => {
  let value = Number(angle) || 0;
  while (value < 0) value += TAU;
  while (value >= TAU) value -= TAU;
  return value;
};

const unwrapAngleNear = (angle = 0, reference = 0) => {
  let value = Number(angle) || 0;
  const target = Number(reference) || 0;
  while ((value - target) > Math.PI) value -= TAU;
  while ((value - target) < -Math.PI) value += TAU;
  return value;
};

const stableTextCompare = (left = '', right = '') => (
  String(left || '').localeCompare(String(right || ''), 'zh-Hans-CN')
);

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

const resolveMedianAngle = (angles = [], fallback = -Math.PI / 2) => {
  if (!Array.isArray(angles) || angles.length < 1) return fallback;
  const anchor = averageAngles(angles.map((angle) => ({ angle, weight: 1 })), fallback);
  const sorted = angles
    .map((angle) => unwrapAngleNear(angle, anchor))
    .sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) * 0.5;
};

const buildOrderIndex = (order = []) => new Map(order.map((key, index) => [key, index]));

const buildPairKey = (left, right) => (
  left < right ? `${left}:${right}` : `${right}:${left}`
);

const cloneOrderByRing = (orderByRing) => {
  const next = new Map();
  orderByRing.forEach((value, key) => {
    next.set(key, value.slice());
  });
  return next;
};

const cloneNestedMap = (source) => {
  const next = new Map();
  source.forEach((value, key) => {
    if (value instanceof Map) {
      const inner = new Map();
      value.forEach((innerValue, innerKey) => {
        inner.set(innerKey, { ...innerValue });
      });
      next.set(key, inner);
    } else {
      next.set(key, value);
    }
  });
  return next;
};

const distanceBetweenPoints = (left, right) => Math.hypot(
  (Number(left?.x) || 0) - (Number(right?.x) || 0),
  (Number(left?.y) || 0) - (Number(right?.y) || 0)
);

const pointFromPolar = (origin, angle, radius) => ({
  x: Number(origin?.x || 0) + Math.cos(angle) * radius,
  y: Number(origin?.y || 0) + Math.sin(angle) * radius
});

const chordToAngle = (distance = 0, radius = 1) => {
  const safeRadius = Math.max(1, Number(radius) || 1);
  const safeDistance = Math.max(0, Number(distance) || 0);
  if (safeDistance <= EPSILON) return 0;
  return 2 * Math.asin(clamp(safeDistance / (2 * safeRadius), 0, 1));
};

const buildLabelRect = (body) => {
  const width = Number(body.labelWidthHint) || 112;
  const height = Number(body.labelHeightHint) || 28;
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
};

const buildContentBounds = (bodies = []) => {
  if (!Array.isArray(bodies) || bodies.length < 1) {
    return {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0
    };
  }

  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  bodies.forEach((body) => {
    const rect = body.labelRect || buildLabelRect(body);
    left = Math.min(left, body.x - body.radius, rect.left);
    right = Math.max(right, body.x + body.radius, rect.right);
    top = Math.min(top, body.y - body.radius, rect.top);
    bottom = Math.max(bottom, body.y + body.radius, rect.bottom);
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

const buildStableNodeSort = (nodeByKey) => (leftKey, rightKey) => {
  const leftNode = nodeByKey.get(leftKey) || {};
  const rightNode = nodeByKey.get(rightKey) || {};
  return (
    stableTextCompare(leftNode.rawNode?.displayName || leftNode.rawNode?.name || '', rightNode.rawNode?.displayName || rightNode.rawNode?.name || '')
    || stableTextCompare(leftKey, rightKey)
  );
};

const buildNodeMeta = ({
  centerKey,
  center,
  levels,
  nodesByLevel,
  graphMeta,
  labelMetricsByKey
}) => {
  const nodeByKey = new Map();

  levels.forEach((level) => {
    (nodesByLevel.get(level) || []).forEach((node) => {
      const labelMetrics = labelMetricsByKey.get(node.key) || node.labelMetrics || {};
      const radius = Number(node.radius || 0);
      const boxWidth = Math.max(radius * 2, Number(labelMetrics.widthHint || 0) || 94);
      const boxHeight = Math.max(radius * 2, Number(labelMetrics.heightHint || 0) || 28);
      const effectiveSize = Math.max(radius * 2, Math.hypot(boxWidth, boxHeight));
      nodeByKey.set(node.key, {
        ...node,
        labelMetrics,
        radius,
        boxWidth,
        boxHeight,
        effectiveSize,
        collisionRadius: effectiveSize * 0.5,
        degree: graphMeta.adjacency.get(node.key)?.size || 0,
        parentKeys: [],
        childKeys: [],
        sameLayerKeys: [],
        primaryParentKey: '',
        clusterSignature: '',
        segmentKey: 'main',
        preferredCenterKey: '',
        importance: 1,
        subtreeWeight: 1
      });
    });
  });

  if (centerKey && !nodeByKey.has(centerKey)) {
    const labelMetrics = labelMetricsByKey.get(centerKey) || center?.labelMetrics || {};
    const radius = Number(center?.radius || 0);
    const boxWidth = Math.max(radius * 2, Number(labelMetrics.widthHint || center?.labelWidthHint || 0) || 94);
    const boxHeight = Math.max(radius * 2, Number(labelMetrics.heightHint || center?.labelHeightHint || 0) || 28);
    const effectiveSize = Math.max(radius * 2, Math.hypot(boxWidth, boxHeight));
    nodeByKey.set(centerKey, {
      key: centerKey,
      level: 0,
      rawNode: center?.rawNode || graphMeta.nodeByKey.get(centerKey) || null,
      labelMetrics,
      radius,
      boxWidth,
      boxHeight,
      effectiveSize,
      collisionRadius: effectiveSize * 0.5,
      labelOffsetY: 0,
      labelPlacement: 'center',
      nodeType: 'center',
      degree: graphMeta.adjacency.get(centerKey)?.size || 0,
      parentKeys: [],
      childKeys: [],
      sameLayerKeys: [],
      primaryParentKey: '',
      clusterSignature: centerKey,
      segmentKey: 'main',
      preferredCenterKey: '',
      importance: 1.18,
      subtreeWeight: 1
    });
  }

  const stableSort = buildStableNodeSort(nodeByKey);
  Array.from(nodeByKey.keys()).sort(stableSort).forEach((key) => {
    const node = nodeByKey.get(key);
    node.degree = graphMeta.adjacency.get(key)?.size || 0;
    node.importance = 1
      + node.degree * 0.08
      + (graphMeta.boundaryCountByKey.get(key) || 0) * 0.05
      + (key === centerKey ? 0.18 : 0);
  });

  return {
    nodeByKey,
    stableSort
  };
};

const buildStaticLayoutData = ({
  nodeByKey,
  graphMeta,
  graphEdges,
  layer,
  stableSort
}) => {
  const sortedKeys = Array.from(nodeByKey.keys()).sort(stableSort);
  const nodeKeySet = new Set(sortedKeys);
  const nodeIndexByKey = new Map(sortedKeys.map((key, index) => [key, index]));
  const sortedNeighborsByKey = new Map();
  const incidentEdgeIndexesByKey = new Map(sortedKeys.map((key) => [key, []]));
  const edgeList = [];

  sortedKeys.forEach((key) => {
    const neighbors = Array.from(graphMeta.adjacency.get(key) || [])
      .filter((neighborKey) => nodeKeySet.has(neighborKey))
      .sort(stableSort);
    sortedNeighborsByKey.set(key, neighbors);
  });

  graphEdges.forEach((edge, rawIndex) => {
    const fromKey = layer === 'sense'
      ? String(edge?.fromVertexKey || '')
      : String(edge?.nodeAId || '');
    const toKey = layer === 'sense'
      ? String(edge?.toVertexKey || '')
      : String(edge?.nodeBId || '');
    if (!fromKey || !toKey || fromKey === toKey) return;
    if (!nodeKeySet.has(fromKey) || !nodeKeySet.has(toKey)) return;
    const index = edgeList.length;
    edgeList.push({
      index,
      rawIndex,
      fromKey,
      toKey,
      pairKey: buildPairKey(fromKey, toKey)
    });
    incidentEdgeIndexesByKey.get(fromKey)?.push(index);
    incidentEdgeIndexesByKey.get(toKey)?.push(index);
  });

  return {
    sortedKeys,
    nodeKeySet,
    nodeIndexByKey,
    sortedNeighborsByKey,
    incidentEdgeIndexesByKey,
    edgeList
  };
};

const buildGraphDistances = ({
  nodeByKey,
  sortedKeys,
  sortedNeighborsByKey
}) => {
  const distancesBySource = new Map();
  const eccentricityByKey = new Map();
  let diameter = 0;

  sortedKeys.forEach((sourceKey) => {
    const queue = [sourceKey];
    const distanceByKey = new Map([[sourceKey, 0]]);
    for (let head = 0; head < queue.length; head += 1) {
      const currentKey = queue[head];
      const currentDistance = Number(distanceByKey.get(currentKey) || 0);
      const neighbors = sortedNeighborsByKey.get(currentKey) || [];
      neighbors.forEach((neighborKey) => {
        if (distanceByKey.has(neighborKey)) return;
        distanceByKey.set(neighborKey, currentDistance + 1);
        queue.push(neighborKey);
      });
    }
    distancesBySource.set(sourceKey, distanceByKey);
    let eccentricity = 0;
    distanceByKey.forEach((distance) => {
      eccentricity = Math.max(eccentricity, Number(distance) || 0);
    });
    eccentricityByKey.set(sourceKey, eccentricity);
    diameter = Math.max(diameter, eccentricity);
  });

  return {
    distancesBySource,
    eccentricityByKey,
    diameter
  };
};

const computePairStats = ({
  leftKey,
  rightKey,
  keys,
  distancesBySource,
  nodeByKey
}) => {
  const leftDistances = distancesBySource.get(leftKey) || new Map();
  const rightDistances = distancesBySource.get(rightKey) || new Map();
  let pairRadius = 0;
  let leftCount = 0;
  let rightCount = 0;

  keys.forEach((key) => {
    const d1 = Number.isFinite(leftDistances.get(key)) ? Number(leftDistances.get(key)) : Number.POSITIVE_INFINITY;
    const d2 = Number.isFinite(rightDistances.get(key)) ? Number(rightDistances.get(key)) : Number.POSITIVE_INFINITY;
    pairRadius = Math.max(pairRadius, Math.min(d1, d2));
    if (d1 <= d2) leftCount += 1;
    else rightCount += 1;
  });

  const balanceSkew = Math.abs(leftCount - rightCount) / Math.max(1, keys.length);
  return {
    pairRadius,
    farDistance: Number(leftDistances.get(rightKey) || 0),
    balanceSkew,
    combinedDegree: (nodeByKey.get(leftKey)?.degree || 0) + (nodeByKey.get(rightKey)?.degree || 0)
  };
};

const generateCenterSchemes = ({
  centerKey,
  nodeByKey,
  stableSort,
  distancesBySource,
  eccentricityByKey,
  diameter
}) => {
  const keys = Array.from(nodeByKey.keys()).sort(stableSort);
  const distanceToSelected = distancesBySource.get(centerKey) || new Map();
  const rankedSingles = keys
    .slice()
    .sort((leftKey, rightKey) => (
      (eccentricityByKey.get(leftKey) || Number.POSITIVE_INFINITY) - (eccentricityByKey.get(rightKey) || Number.POSITIVE_INFINITY)
      || (nodeByKey.get(rightKey)?.degree || 0) - (nodeByKey.get(leftKey)?.degree || 0)
      || (distanceToSelected.get(leftKey) || Number.POSITIVE_INFINITY) - (distanceToSelected.get(rightKey) || Number.POSITIVE_INFINITY)
      || stableSort(leftKey, rightKey)
    ));

  const bestSingle = rankedSingles[0] || centerKey;
  const bestSingleRadius = eccentricityByKey.get(bestSingle) || 0;
  const schemes = [];
  const pushScheme = (scheme) => {
    if (!scheme?.c1) return;
    const signature = scheme.useDualCenter ? `${scheme.c1}|${scheme.c2}` : scheme.c1;
    if (schemes.some((item) => item.signature === signature)) return;
    schemes.push({
      ...scheme,
      signature
    });
  };

  pushScheme({
    useDualCenter: false,
    c1: bestSingle,
    c2: '',
    rationale: 'single-graph-center'
  });

  if (centerKey && nodeByKey.has(centerKey) && centerKey !== bestSingle) {
    const bestEccentricity = eccentricityByKey.get(bestSingle) || Number.POSITIVE_INFINITY;
    const selectedEccentricity = eccentricityByKey.get(centerKey) || Number.POSITIVE_INFINITY;
    if (selectedEccentricity <= bestEccentricity + 1) {
      pushScheme({
        useDualCenter: false,
        c1: centerKey,
        c2: '',
        rationale: 'single-selected-center'
      });
    }
  }

  const pairCandidates = rankedSingles
    .slice(0, Math.min(6, rankedSingles.length))
    .flatMap((leftKey, leftIndex) => rankedSingles
      .slice(leftIndex + 1, Math.min(8, rankedSingles.length))
      .map((rightKey) => {
        const stats = computePairStats({
          leftKey,
          rightKey,
          keys,
          distancesBySource,
          nodeByKey
        });
        return {
          c1: leftKey,
          c2: rightKey,
          ...stats
        };
      })
    )
    .sort((left, right) => (
      left.pairRadius - right.pairRadius
      || left.balanceSkew - right.balanceSkew
      || right.farDistance - left.farDistance
      || right.combinedDegree - left.combinedDegree
      || stableSort(left.c1, right.c1)
      || stableSort(left.c2, right.c2)
    ));

  const elongated = diameter >= 5 && bestSingleRadius >= 3;
  pairCandidates.forEach((pairCandidate) => {
    if (schemes.filter((item) => item.useDualCenter).length >= 2) return;
    const relief = pairCandidate.pairRadius <= bestSingleRadius - 1;
    const balanced = pairCandidate.balanceSkew <= 0.36 && pairCandidate.farDistance >= 2;
    const strongElongation = elongated && pairCandidate.balanceSkew <= 0.5 && pairCandidate.farDistance >= 2;
    if (!relief && !balanced && !strongElongation) return;
    pushScheme({
      useDualCenter: true,
      c1: pairCandidate.c1,
      c2: pairCandidate.c2,
      pairRadius: pairCandidate.pairRadius,
      balanceSkew: pairCandidate.balanceSkew,
      rationale: 'dual-center'
    });
  });

  return schemes;
};

const buildRingAssignments = ({
  nodeByKey,
  sortedKeys,
  sortedNeighborsByKey,
  distancesBySource,
  centers
}) => {
  const centerKeys = centers.filter(Boolean);
  const centerKeySet = new Set(centerKeys);
  const c1 = centerKeys[0] || '';
  const c2 = centerKeys[1] || '';
  const c1Distances = distancesBySource.get(c1) || new Map();
  const c2Distances = c2 ? (distancesBySource.get(c2) || new Map()) : new Map();
  const logicalRingByKey = new Map();
  const preferredCenterByKey = new Map();
  let maxRing = 0;

  sortedKeys.forEach((key) => {
    if (centerKeySet.has(key)) {
      logicalRingByKey.set(key, 0);
      preferredCenterByKey.set(key, key);
      return;
    }
    const d1 = Number.isFinite(c1Distances.get(key)) ? Number(c1Distances.get(key)) : Number.POSITIVE_INFINITY;
    const d2 = c2
      ? (Number.isFinite(c2Distances.get(key)) ? Number(c2Distances.get(key)) : Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;
    const ring = Math.max(1, Math.min(d1, d2));
    logicalRingByKey.set(key, ring);
    maxRing = Math.max(maxRing, ring);

    let preferredCenterKey = c1;
    if (c2) {
      if (d2 < d1) {
        preferredCenterKey = c2;
      } else if (d1 === d2) {
        const neighbors = sortedNeighborsByKey.get(key) || [];
        const affinityDelta = neighbors.reduce((sum, neighborKey) => {
          const neighborD1 = Number.isFinite(c1Distances.get(neighborKey)) ? Number(c1Distances.get(neighborKey)) : Number.POSITIVE_INFINITY;
          const neighborD2 = Number.isFinite(c2Distances.get(neighborKey)) ? Number(c2Distances.get(neighborKey)) : Number.POSITIVE_INFINITY;
          if (neighborD1 < neighborD2) return sum + 1;
          if (neighborD2 < neighborD1) return sum - 1;
          return sum;
        }, 0);
        if (affinityDelta < 0) preferredCenterKey = c2;
      }
    }
    preferredCenterByKey.set(key, preferredCenterKey || c1);
  });

  return {
    logicalRingByKey,
    preferredCenterByKey,
    maxRing
  };
};

const buildRingRelationships = ({
  centerKey,
  nodeByKey,
  graphMeta,
  sortedKeys,
  nodeIndexByKey,
  sortedNeighborsByKey,
  ringByKey,
  preferredCenterByKey,
  centers
}) => {
  const primaryCenterKey = centers[0] || centerKey;
  const maxRing = sortedKeys.reduce((max, key) => Math.max(max, Number(ringByKey.get(key) || 0)), 0);

  sortedKeys.forEach((key) => {
    const node = nodeByKey.get(key);
    const ring = Number(ringByKey.get(key) || 0);
    const neighbors = sortedNeighborsByKey.get(key) || [];
    node.parentKeys = neighbors.filter((neighborKey) => Number(ringByKey.get(neighborKey) || 0) < ring);
    node.childKeys = neighbors.filter((neighborKey) => Number(ringByKey.get(neighborKey) || 0) > ring);
    node.sameLayerKeys = neighbors.filter((neighborKey) => Number(ringByKey.get(neighborKey) || 0) === ring);
    node.preferredCenterKey = preferredCenterByKey.get(key) || primaryCenterKey;
    node.segmentKey = centers.length > 1
      ? (node.preferredCenterKey === centers[1] ? centers[1] : centers[0])
      : 'main';
    node.primaryParentKey = node.parentKeys
      .slice()
      .sort((leftKey, rightKey) => (
        (Number(ringByKey.get(leftKey) || 0) - Number(ringByKey.get(rightKey) || 0))
        || (nodeByKey.get(rightKey)?.degree || 0) - (nodeByKey.get(leftKey)?.degree || 0)
        || (nodeIndexByKey.get(leftKey) || 0) - (nodeIndexByKey.get(rightKey) || 0)
      ))[0] || '';
    node.clusterSignature = ring === 0
      ? key
      : (node.preferredCenterKey || node.primaryParentKey || primaryCenterKey);
    node.importance = 1
      + node.degree * 0.08
      + node.childKeys.length * 0.1
      + (graphMeta.boundaryCountByKey.get(key) || 0) * 0.05
      + (key === centerKey ? 0.18 : 0);
  });

  for (let ring = maxRing; ring >= 0; ring -= 1) {
    sortedKeys.forEach((key) => {
      const node = nodeByKey.get(key);
      if (Number(ringByKey.get(key) || 0) !== ring) return;
      const childWeight = node.childKeys.reduce((sum, childKey) => (
        sum + (nodeByKey.get(childKey)?.subtreeWeight || 1)
      ), 0);
      const labelWeight = Number(node.labelMetrics?.angularWeight || 1);
      const boundaryWeight = Number(graphMeta.boundaryCountByKey.get(key) || 0) * 0.22;
      node.subtreeWeight = 1 + labelWeight * 0.24 + childWeight * 0.34 + boundaryWeight;
    });
  }
};

const buildRingMeta = ({
  rings,
  nodeByKey,
  stableSort,
  ringByKey,
  useDualCenter,
  c1,
  c2
}) => {
  const ringMetaByRing = new Map();
  rings.forEach((ring) => {
    const membersBySegment = new Map();
    if (useDualCenter) {
      membersBySegment.set(c1, []);
      membersBySegment.set(c2, []);
    } else {
      membersBySegment.set('main', []);
    }
    ringMetaByRing.set(ring, {
      segmentOrder: useDualCenter ? [c1, c2] : ['main'],
      membersBySegment
    });
  });

  Array.from(nodeByKey.keys())
    .sort(stableSort)
    .forEach((key) => {
      const ring = Number(ringByKey.get(key) || 0);
      if (ring < 1) return;
      const meta = ringMetaByRing.get(ring);
      if (!meta) return;
      const node = nodeByKey.get(key);
      const segmentKey = useDualCenter
        ? (node.segmentKey === c2 ? c2 : c1)
        : 'main';
      const members = meta.membersBySegment.get(segmentKey) || [];
      members.push(key);
      meta.membersBySegment.set(segmentKey, members);
    });

  return ringMetaByRing;
};

const arcFootprint = (node) => Math.max(0, Number(node?.effectiveSize || 0));

const targetGap = (leftNode, rightNode) => RADIAL_DENSITY_K * 0.5 * (arcFootprint(leftNode) + arcFootprint(rightNode));

const requiredCenterDistance = (leftNode, rightNode) => (
  arcFootprint(leftNode) * 0.5
  + arcFootprint(rightNode) * 0.5
  + targetGap(leftNode, rightNode)
);

const leadingEdgeDistance = (node) => arcFootprint(node) * (0.5 + RADIAL_DENSITY_K * 0.5);

const trailingEdgeDistance = (node) => arcFootprint(node) * (0.5 + RADIAL_DENSITY_K * 0.5);

const computeSegmentWeight = (keys = [], nodeByKey) => keys.reduce((sum, key) => {
  const node = nodeByKey.get(key);
  return sum + 1 + (node?.subtreeWeight || 1) * 0.55 + (arcFootprint(node) || 0) * 0.02;
}, 0);

const buildOrientationCandidates = ({
  useDualCenter,
  sampleCount = useDualCenter ? DUAL_ROTATION_SAMPLES : SINGLE_ROTATION_SAMPLES,
  anchorAngle = null,
  offsets = null
}) => {
  if (Number.isFinite(anchorAngle) && Array.isArray(offsets) && offsets.length > 0) {
    return offsets.map((offset) => {
      const angle = normalizePositiveAngle(Number(anchorAngle || 0) + Number(offset || 0));
      return {
        rotation: angle,
        axisAngle: angle
      };
    });
  }
  return Array.from({ length: sampleCount }, (_, index) => {
    const angle = (TAU * index) / sampleCount;
    return {
      rotation: angle,
      axisAngle: angle
    };
  });
};

const buildFineOrientationCandidates = ({ useDualCenter, orientation }) => {
  const coarseCount = useDualCenter ? DUAL_ROTATION_SAMPLES_COARSE : SINGLE_ROTATION_SAMPLES_COARSE;
  const fineStep = TAU / (coarseCount * 8);
  return buildOrientationCandidates({
    useDualCenter,
    anchorAngle: Number(orientation?.rotation || 0),
    offsets: [-2, -1, 0, 1, 2].map((factor) => factor * fineStep)
  });
};

const buildCoreBodies = ({
  center,
  nodeByKey,
  scheme,
  orientation
}) => {
  const centerX = Number(center?.x || 0);
  const centerY = Number(center?.y || 0);
  const coreBodyByKey = new Map();

  if (!scheme.useDualCenter) {
    const node = nodeByKey.get(scheme.c1);
    coreBodyByKey.set(scheme.c1, { x: centerX, y: centerY });
    return {
      coreBodyByKey,
      coreEnvelope: node?.collisionRadius || 0,
      coreMaxSize: arcFootprint(node),
      coreAverageSize: arcFootprint(node)
    };
  }

  const axisAngle = Number(orientation?.axisAngle || 0);
  const c1Node = nodeByKey.get(scheme.c1);
  const c2Node = nodeByKey.get(scheme.c2);
  const separation = requiredCenterDistance(c1Node, c2Node);
  const half = separation * 0.5;
  const c2Body = pointFromPolar({ x: centerX, y: centerY }, axisAngle, half);
  const c1Body = pointFromPolar({ x: centerX, y: centerY }, axisAngle + Math.PI, half);
  coreBodyByKey.set(scheme.c1, c1Body);
  coreBodyByKey.set(scheme.c2, c2Body);

  const sizes = [arcFootprint(c1Node), arcFootprint(c2Node)].filter((value) => value > 0);
  return {
    coreBodyByKey,
    coreEnvelope: Math.max(
      half + (c1Node?.collisionRadius || 0),
      half + (c2Node?.collisionRadius || 0)
    ),
    coreMaxSize: Math.max(...sizes, 0),
    coreAverageSize: sizes.length > 0 ? sizes.reduce((sum, value) => sum + value, 0) / sizes.length : 0
  };
};

const buildCenterAngleByKey = ({ scheme, orientation }) => {
  if (!scheme.useDualCenter) {
    return new Map([[scheme.c1, Number(orientation?.rotation || 0)]]);
  }
  const axisAngle = Number(orientation?.axisAngle || 0);
  return new Map([
    [scheme.c1, axisAngle + Math.PI],
    [scheme.c2, axisAngle]
  ]);
};

const buildSegmentDefinitionsByRing = ({
  rings,
  ringMetaByRing,
  nodeByKey,
  scheme,
  orientation
}) => {
  const defsByRing = new Map();
  const rotation = Number(orientation?.rotation || 0);
  const axisAngle = Number(orientation?.axisAngle || rotation);

  rings.forEach((ring) => {
    const meta = ringMetaByRing.get(ring);
    if (!meta) return;
    if (!scheme.useDualCenter) {
      defsByRing.set(ring, new Map([
        ['main', {
          key: 'main',
          centerAngle: rotation,
          start: rotation - Math.PI + RADIAL_SEGMENT_PADDING,
          end: rotation + Math.PI - RADIAL_SEGMENT_PADDING,
          span: TAU - RADIAL_SEGMENT_PADDING * 2,
          fallbackAngle: rotation
        }]
      ]));
      return;
    }

    const c1Keys = meta.membersBySegment.get(scheme.c1) || [];
    const c2Keys = meta.membersBySegment.get(scheme.c2) || [];
    const c1Weight = computeSegmentWeight(c1Keys, nodeByKey);
    const c2Weight = computeSegmentWeight(c2Keys, nodeByKey);
    const totalWeight = Math.max(1, c1Weight + c2Weight);
    const minSpan = 0.5;
    const maxShare = 0.78;
    const available = TAU - RADIAL_SEGMENT_PADDING * 6;
    const rawC2Share = c2Weight / totalWeight;
    const c2Share = clamp(rawC2Share, 1 - maxShare, maxShare);
    const c2Span = clamp(available * c2Share, minSpan, available - minSpan);
    const c1Span = clamp(available - c2Span, minSpan, available - minSpan);
    const c2Center = axisAngle;
    const c1Center = axisAngle + Math.PI;
    defsByRing.set(ring, new Map([
      [scheme.c1, {
        key: scheme.c1,
        centerAngle: c1Center,
        start: c1Center - c1Span * 0.5,
        end: c1Center + c1Span * 0.5,
        span: c1Span,
        fallbackAngle: c1Center
      }],
      [scheme.c2, {
        key: scheme.c2,
        centerAngle: c2Center,
        start: c2Center - c2Span * 0.5,
        end: c2Center + c2Span * 0.5,
        span: c2Span,
        fallbackAngle: c2Center
      }]
    ]));
  });

  return defsByRing;
};

const collectReferenceAngles = ({
  node,
  angleByKey,
  direction
}) => {
  if (!node) return [];
  const forward = direction === 'forward';
  const heavyKeys = forward ? node.parentKeys : node.childKeys;
  const lightKeys = forward ? node.childKeys : node.parentKeys;
  const entries = [];

  heavyKeys.forEach((key) => {
    const angle = angleByKey.get(key);
    if (Number.isFinite(angle)) entries.push({ angle, weight: 2.2 });
  });
  node.sameLayerKeys.forEach((key) => {
    const angle = angleByKey.get(key);
    if (Number.isFinite(angle)) entries.push({ angle, weight: 0.7 });
  });
  lightKeys.forEach((key) => {
    const angle = angleByKey.get(key);
    if (Number.isFinite(angle)) entries.push({ angle, weight: 0.9 });
  });
  return entries;
};

const computePreferredAngleForNode = ({
  key,
  nodeByKey,
  angleByKey,
  segmentDef,
  direction = 'forward',
  includeCurrent = true
}) => {
  const node = nodeByKey.get(key);
  const fallbackAngle = segmentDef?.fallbackAngle ?? segmentDef?.centerAngle ?? 0;
  if (!node) return fallbackAngle;

  const entries = collectReferenceAngles({
    node,
    angleByKey,
    direction
  });

  if (node.primaryParentKey && Number.isFinite(angleByKey.get(node.primaryParentKey))) {
    entries.push({ angle: angleByKey.get(node.primaryParentKey), weight: 1.3 });
  }
  if (includeCurrent && Number.isFinite(angleByKey.get(key))) {
    entries.push({ angle: angleByKey.get(key), weight: 0.3 });
  }
  if (Number.isFinite(segmentDef?.centerAngle)) {
    entries.push({
      angle: segmentDef.centerAngle,
      weight: 0.8 + Math.min(0.8, (node.degree || 0) * 0.05)
    });
  }

  if (entries.length < 1) return fallbackAngle;
  return averageAngles(entries, fallbackAngle);
};

const reorderRingSegment = ({
  orderedKeys,
  nodeByKey,
  angleByKey,
  direction,
  rule,
  stableSort,
  segmentDef
}) => {
  if (!Array.isArray(orderedKeys) || orderedKeys.length < 2) return orderedKeys;
  const indexByKey = buildOrderIndex(orderedKeys);
  return orderedKeys
    .slice()
    .map((key) => {
      const references = collectReferenceAngles({
        node: nodeByKey.get(key),
        angleByKey,
        direction
      }).map((entry) => entry.angle);
      const currentAngle = Number(angleByKey.get(key) || segmentDef?.centerAngle || 0);
      let targetAngle = currentAngle;
      if (references.length > 0) {
        targetAngle = rule === 'median'
          ? resolveMedianAngle(references, currentAngle)
          : averageAngles(references.map((angle) => ({ angle, weight: 1 })), currentAngle);
      } else {
        targetAngle = computePreferredAngleForNode({
          key,
          nodeByKey,
          angleByKey,
          segmentDef,
          direction
        });
      }
      return {
        key,
        targetAngle: unwrapAngleNear(targetAngle, segmentDef?.centerAngle ?? currentAngle),
        stableIndex: indexByKey.get(key) || 0
      };
    })
    .sort((left, right) => (
      left.targetAngle - right.targetAngle
      || left.stableIndex - right.stableIndex
      || stableSort(left.key, right.key)
    ))
    .map((entry) => entry.key);
};

const reorderRing = ({
  ring,
  orderByRing,
  ringMetaByRing,
  nodeByKey,
  angleByKey,
  segmentDefsByRing,
  direction,
  rule,
  stableSort
}) => {
  const meta = ringMetaByRing.get(ring);
  const currentOrder = orderByRing.get(ring) || [];
  if (!meta || currentOrder.length < 2) return;
  const nextOrder = [];
  meta.segmentOrder.forEach((segmentKey) => {
    const segmentDef = segmentDefsByRing.get(ring)?.get(segmentKey);
    const segmentKeys = currentOrder.filter((key) => (nodeByKey.get(key)?.segmentKey || 'main') === segmentKey);
    const reordered = reorderRingSegment({
      orderedKeys: segmentKeys,
      nodeByKey,
      angleByKey,
      direction,
      rule,
      stableSort,
      segmentDef
    });
    nextOrder.push(...reordered);
  });
  orderByRing.set(ring, nextOrder);
};

const computeSegmentDemandAngle = ({
  orderedKeys,
  radius,
  nodeByKey
}) => {
  if (!Array.isArray(orderedKeys) || orderedKeys.length < 1) return 0;
  const firstNode = nodeByKey.get(orderedKeys[0]);
  const lastNode = nodeByKey.get(orderedKeys[orderedKeys.length - 1]);
  let total = chordToAngle(leadingEdgeDistance(firstNode), radius) + chordToAngle(trailingEdgeDistance(lastNode), radius);
  for (let index = 1; index < orderedKeys.length; index += 1) {
    const leftNode = nodeByKey.get(orderedKeys[index - 1]);
    const rightNode = nodeByKey.get(orderedKeys[index]);
    total += chordToAngle(requiredCenterDistance(leftNode, rightNode), radius);
  }
  return total;
};

const solveMinRadiusForSegment = ({
  orderedKeys,
  availableSpan,
  nodeByKey
}) => {
  if (!Array.isArray(orderedKeys) || orderedKeys.length < 1) return 0;
  let low = Math.max(
    RADIAL_MIN_RADIUS,
    ...orderedKeys.map((key) => arcFootprint(nodeByKey.get(key)) * 0.5)
  );
  let high = Math.max(low, 96);
  while (computeSegmentDemandAngle({ orderedKeys, radius: high, nodeByKey }) > availableSpan && high < 100000) {
    high *= 1.35;
  }
  for (let index = 0; index < 26; index += 1) {
    const middle = (low + high) * 0.5;
    if (computeSegmentDemandAngle({ orderedKeys, radius: middle, nodeByKey }) <= availableSpan) high = middle;
    else low = middle;
  }
  return high;
};

const buildRingStats = ({
  orderByRing,
  rings,
  nodeByKey
}) => {
  const statsByRing = new Map();
  rings.forEach((ring) => {
    const order = orderByRing.get(ring) || [];
    const sizes = order.map((key) => arcFootprint(nodeByKey.get(key))).filter((value) => value > 0);
    statsByRing.set(ring, {
      maxSize: Math.max(...sizes, 0),
      averageSize: sizes.length > 0 ? sizes.reduce((sum, value) => sum + value, 0) / sizes.length : 0
    });
  });
  return statsByRing;
};

const buildMinimumRadii = ({
  rings,
  orderByRing,
  ringMetaByRing,
  segmentDefsByRing,
  nodeByKey,
  coreEnvelope,
  coreAverageSize
}) => {
  const statsByRing = buildRingStats({ orderByRing, rings, nodeByKey });
  const minimumRadiusByRing = new Map();
  const minCapacityRadiusByRing = new Map();
  let previousOuterBoundary = coreEnvelope;
  let previousAverageSize = coreAverageSize;

  rings.forEach((ring) => {
    const ringStats = statsByRing.get(ring) || { maxSize: 0, averageSize: 0 };
    const radialPadding = RADIAL_DENSITY_K * 0.5 * (
      Math.max(previousAverageSize, ringStats.averageSize)
      + Math.min(previousAverageSize || ringStats.averageSize, ringStats.averageSize || previousAverageSize)
    );
    const minRadiusByGap = previousOuterBoundary + ringStats.maxSize * 0.5 + radialPadding;
    let minRadiusByCapacity = 0;
    const meta = ringMetaByRing.get(ring);
    (meta?.segmentOrder || []).forEach((segmentKey) => {
      const orderedKeys = (orderByRing.get(ring) || []).filter((key) => (nodeByKey.get(key)?.segmentKey || 'main') === segmentKey);
      const segmentDef = segmentDefsByRing.get(ring)?.get(segmentKey);
      minRadiusByCapacity = Math.max(
        minRadiusByCapacity,
        solveMinRadiusForSegment({
          orderedKeys,
          availableSpan: segmentDef?.span || (TAU - RADIAL_SEGMENT_PADDING * 2),
          nodeByKey
        })
      );
    });
    minCapacityRadiusByRing.set(ring, minRadiusByCapacity);

    const radius = Math.max(RADIAL_MIN_RADIUS, minRadiusByGap, minRadiusByCapacity);
    minimumRadiusByRing.set(ring, radius);
    previousOuterBoundary = radius + ringStats.maxSize * 0.5;
    previousAverageSize = ringStats.averageSize;
  });

  return {
    minimumRadiusByRing,
    minCapacityRadiusByRing,
    statsByRing
  };
};

const assignAnglesInSegment = ({
  orderedKeys,
  radius,
  segmentDef,
  nodeByKey,
  angleByKey,
  direction
}) => {
  if (!Array.isArray(orderedKeys) || orderedKeys.length < 1) return;
  const centerAngle = Number(segmentDef?.centerAngle || 0);
  const firstNode = nodeByKey.get(orderedKeys[0]);
  const lastNode = nodeByKey.get(orderedKeys[orderedKeys.length - 1]);
  const leadAngle = chordToAngle(leadingEdgeDistance(firstNode), radius);
  const trailAngle = chordToAngle(trailingEdgeDistance(lastNode), radius);
  const gapAngles = [];
  for (let index = 1; index < orderedKeys.length; index += 1) {
    const leftNode = nodeByKey.get(orderedKeys[index - 1]);
    const rightNode = nodeByKey.get(orderedKeys[index]);
    gapAngles.push(chordToAngle(requiredCenterDistance(leftNode, rightNode), radius));
  }

  const startLimit = Number(segmentDef?.start ?? (centerAngle - Math.PI)) + leadAngle;
  const endLimit = Number(segmentDef?.end ?? (centerAngle + Math.PI)) - trailAngle;
  const targets = orderedKeys.map((key) => unwrapAngleNear(computePreferredAngleForNode({
    key,
    nodeByKey,
    angleByKey,
    segmentDef,
    direction
  }), centerAngle));

  if (orderedKeys.length === 1) {
    angleByKey.set(orderedKeys[0], clamp(targets[0], startLimit, endLimit));
    return;
  }

  const assigned = targets.map((value) => clamp(value, startLimit, endLimit));

  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 1; index < assigned.length; index += 1) {
      assigned[index] = Math.max(assigned[index], assigned[index - 1] + gapAngles[index - 1]);
    }
    for (let index = assigned.length - 2; index >= 0; index -= 1) {
      assigned[index] = Math.min(assigned[index], assigned[index + 1] - gapAngles[index]);
    }
    const lowerShift = startLimit - assigned[0];
    const upperShift = endLimit - assigned[assigned.length - 1];
    const desiredShift = targets.reduce((sum, value, index) => sum + (value - assigned[index]), 0) / assigned.length;
    const shift = clamp(desiredShift, lowerShift, upperShift);
    for (let index = 0; index < assigned.length; index += 1) {
      assigned[index] += shift;
    }
  }

  orderedKeys.forEach((key, index) => {
    angleByKey.set(key, assigned[index]);
  });
};

const assignAllAngles = ({
  rings,
  orderByRing,
  ringMetaByRing,
  radiusByRing,
  nodeByKey,
  angleByKey,
  segmentDefsByRing,
  passes = GEOMETRY_ASSIGNMENT_PASSES
}) => {
  for (let pass = 0; pass < passes; pass += 1) {
    rings.forEach((ring) => {
      const meta = ringMetaByRing.get(ring);
      const radius = radiusByRing.get(ring) || 1;
      const order = orderByRing.get(ring) || [];
      (meta?.segmentOrder || []).forEach((segmentKey) => {
        const segmentDef = segmentDefsByRing.get(ring)?.get(segmentKey);
        const orderedKeys = order.filter((key) => (nodeByKey.get(key)?.segmentKey || 'main') === segmentKey);
        assignAnglesInSegment({
          orderedKeys,
          radius,
          segmentDef,
          nodeByKey,
          angleByKey,
          direction: 'forward'
        });
      });
    });

    rings.slice().reverse().forEach((ring) => {
      const meta = ringMetaByRing.get(ring);
      const radius = radiusByRing.get(ring) || 1;
      const order = orderByRing.get(ring) || [];
      (meta?.segmentOrder || []).forEach((segmentKey) => {
        const segmentDef = segmentDefsByRing.get(ring)?.get(segmentKey);
        const orderedKeys = order.filter((key) => (nodeByKey.get(key)?.segmentKey || 'main') === segmentKey);
        assignAnglesInSegment({
          orderedKeys,
          radius,
          segmentDef,
          nodeByKey,
          angleByKey,
          direction: 'backward'
        });
      });
    });
  }
};

const buildBaseOrders = ({
  rings,
  ringMetaByRing,
  nodeByKey,
  stableSort,
  centerAngleByKey,
  segmentDefsByRing
}) => {
  const orderByRing = new Map();
  const angleByKey = new Map(centerAngleByKey);

  rings.forEach((ring) => {
    const meta = ringMetaByRing.get(ring);
    if (!meta) return;
    const order = [];
    meta.segmentOrder.forEach((segmentKey) => {
      const segmentDef = segmentDefsByRing.get(ring)?.get(segmentKey);
      const members = (meta.membersBySegment.get(segmentKey) || [])
        .slice()
        .sort((leftKey, rightKey) => {
          const leftTarget = unwrapAngleNear(computePreferredAngleForNode({
            key: leftKey,
            nodeByKey,
            angleByKey,
            segmentDef,
            direction: 'forward',
            includeCurrent: false
          }), segmentDef?.centerAngle || 0);
          const rightTarget = unwrapAngleNear(computePreferredAngleForNode({
            key: rightKey,
            nodeByKey,
            angleByKey,
            segmentDef,
            direction: 'forward',
            includeCurrent: false
          }), segmentDef?.centerAngle || 0);
          return leftTarget - rightTarget || stableSort(leftKey, rightKey);
        });
      order.push(...members);
      members.forEach((key, index) => {
        const ratio = members.length > 1 ? index / (members.length - 1) : 0.5;
        angleByKey.set(
          key,
          (segmentDef?.start || 0) + (segmentDef?.span || 0) * ratio
        );
      });
    });
    orderByRing.set(ring, order);
  });

  for (let round = 0; round < INITIAL_SWEEP_ROUNDS; round += 1) {
    rings.forEach((ring) => {
      reorderRing({
        ring,
        orderByRing,
        ringMetaByRing,
        nodeByKey,
        angleByKey,
        segmentDefsByRing,
        direction: 'forward',
        rule: round % 2 === 0 ? 'barycenter' : 'median',
        stableSort
      });
    });
    rings.slice().reverse().forEach((ring) => {
      reorderRing({
        ring,
        orderByRing,
        ringMetaByRing,
        nodeByKey,
        angleByKey,
        segmentDefsByRing,
        direction: 'backward',
        rule: round % 2 === 0 ? 'median' : 'barycenter',
        stableSort
      });
    });
  }

  return {
    orderByRing,
    angleByKey
  };
};

const buildNodeBodies = ({
  center,
  centerKey,
  scheme,
  rings,
  orderByRing,
  radiusByRing,
  angleByKey,
  nodeByKey,
  coreBodyByKey,
  centerAngleByKey
}) => {
  const bodies = [];
  const bodyByKey = new Map();
  const centers = scheme.useDualCenter ? [scheme.c1, scheme.c2] : [scheme.c1];

  centers.forEach((key, index) => {
    const node = nodeByKey.get(key);
    const coreBody = coreBodyByKey.get(key);
    if (!node || !coreBody) return;
    const body = {
      key,
      nodeKey: key,
      x: coreBody.x,
      y: coreBody.y,
      radius: Number(node.radius || 0),
      collisionRadius: node.collisionRadius,
      labelWidthHint: Number(node.labelMetrics?.widthHint || node.boxWidth),
      labelHeightHint: Number(node.labelMetrics?.heightHint || node.boxHeight),
      labelOffsetY: 0,
      labelPlacement: 'center',
      labelMetrics: node.labelMetrics,
      level: 0,
      angle: normalizePositiveAngle(centerAngleByKey.get(key) || (index === 0 ? Math.PI : 0)),
      rawNode: node.rawNode,
      nodeType: key === centerKey ? 'center' : node.nodeType,
      clusterSignature: node.clusterSignature,
      primaryParentKey: node.primaryParentKey,
      childCount: node.childKeys.length,
      degree: node.degree,
      importance: node.importance,
      subtreeWeight: node.subtreeWeight,
      siblingIndex: index,
      siblingCount: centers.length
    };
    body.labelRect = buildLabelRect(body);
    bodies.push(body);
    bodyByKey.set(key, body);
  });

  rings.forEach((ring) => {
    const order = orderByRing.get(ring) || [];
    const radius = radiusByRing.get(ring) || 0;
    order.forEach((key, index) => {
      if (bodyByKey.has(key)) return;
      const node = nodeByKey.get(key);
      if (!node) return;
      const rawAngle = Number(angleByKey.get(key) || 0);
      const body = {
        key,
        nodeKey: key,
        x: Number(center?.x || 0) + Math.cos(rawAngle) * radius,
        y: Number(center?.y || 0) + Math.sin(rawAngle) * radius,
        radius: Number(node.radius || 0),
        collisionRadius: node.collisionRadius,
        labelWidthHint: Number(node.labelMetrics?.widthHint || node.boxWidth),
        labelHeightHint: Number(node.labelMetrics?.heightHint || node.boxHeight),
        labelOffsetY: 0,
        labelPlacement: 'center',
        labelMetrics: node.labelMetrics,
        level: ring,
        angle: normalizePositiveAngle(rawAngle),
        rawNode: node.rawNode,
        nodeType: key === centerKey ? 'center' : node.nodeType,
        clusterSignature: node.clusterSignature,
        primaryParentKey: node.primaryParentKey,
        childCount: node.childKeys.length,
        degree: node.degree,
        importance: node.importance,
        subtreeWeight: node.subtreeWeight,
        siblingIndex: index,
        siblingCount: order.length
      };
      body.labelRect = buildLabelRect(body);
      bodies.push(body);
      bodyByKey.set(key, body);
    });
  });

  return {
    bodies,
    bodyByKey
  };
};

const segmentIntersection = (startA, endA, startB, endB) => {
  const sharedEndpoint = (
    distanceBetweenPoints(startA, startB) <= EPSILON
    || distanceBetweenPoints(startA, endB) <= EPSILON
    || distanceBetweenPoints(endA, startB) <= EPSILON
    || distanceBetweenPoints(endA, endB) <= EPSILON
  );
  if (sharedEndpoint) return false;

  const cross = (a, b, c) => (
    ((Number(b?.x) || 0) - (Number(a?.x) || 0)) * ((Number(c?.y) || 0) - (Number(a?.y) || 0))
    - ((Number(b?.y) || 0) - (Number(a?.y) || 0)) * ((Number(c?.x) || 0) - (Number(a?.x) || 0))
  );

  const onSegment = (a, b, c) => {
    const minX = Math.min(Number(a?.x) || 0, Number(b?.x) || 0) - EPSILON;
    const maxX = Math.max(Number(a?.x) || 0, Number(b?.x) || 0) + EPSILON;
    const minY = Math.min(Number(a?.y) || 0, Number(b?.y) || 0) - EPSILON;
    const maxY = Math.max(Number(a?.y) || 0, Number(b?.y) || 0) + EPSILON;
    return (
      (Number(c?.x) || 0) >= minX
      && (Number(c?.x) || 0) <= maxX
      && (Number(c?.y) || 0) >= minY
      && (Number(c?.y) || 0) <= maxY
    );
  };

  const d1 = cross(startA, endA, startB);
  const d2 = cross(startA, endA, endB);
  const d3 = cross(startB, endB, startA);
  const d4 = cross(startB, endB, endA);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (Math.abs(d1) <= EPSILON && onSegment(startA, endA, startB)) return true;
  if (Math.abs(d2) <= EPSILON && onSegment(startA, endA, endB)) return true;
  if (Math.abs(d3) <= EPSILON && onSegment(startB, endB, startA)) return true;
  if (Math.abs(d4) <= EPSILON && onSegment(startB, endB, endA)) return true;
  return false;
};

const buildEdgeSegments = ({
  edgeList = null,
  graphEdges = null,
  layer = 'title',
  bodyByKey
}) => {
  const segments = [];
  const sourceEdges = Array.isArray(edgeList)
    ? edgeList
    : (Array.isArray(graphEdges)
      ? graphEdges.map((edge, index) => ({
        index,
        fromKey: layer === 'sense'
          ? String(edge?.fromVertexKey || '')
          : String(edge?.nodeAId || ''),
        toKey: layer === 'sense'
          ? String(edge?.toVertexKey || '')
          : String(edge?.nodeBId || '')
      }))
      : []);
  sourceEdges.forEach((edge) => {
    const { fromKey, toKey, index } = edge;
    const start = bodyByKey.get(fromKey);
    const end = bodyByKey.get(toKey);
    if (!start || !end) return;
    segments.push({
      index,
      fromKey,
      toKey,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y }
    });
  });
  return segments;
};

const distancePointToSegment = (point, start, end) => {
  const dx = (Number(end?.x) || 0) - (Number(start?.x) || 0);
  const dy = (Number(end?.y) || 0) - (Number(start?.y) || 0);
  if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) return distanceBetweenPoints(point, start);
  const t = clamp(
    (((Number(point?.x) || 0) - (Number(start?.x) || 0)) * dx + ((Number(point?.y) || 0) - (Number(start?.y) || 0)) * dy)
      / (dx * dx + dy * dy),
    0,
    1
  );
  const projection = {
    x: (Number(start?.x) || 0) + dx * t,
    y: (Number(start?.y) || 0) + dy * t
  };
  return distanceBetweenPoints(point, projection);
};

const segmentIntersectsRect = (start, end, rect) => {
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom }
  ];
  const within = (point) => (
    point.x >= rect.left - EPSILON
    && point.x <= rect.right + EPSILON
    && point.y >= rect.top - EPSILON
    && point.y <= rect.bottom + EPSILON
  );
  if (within(start) || within(end)) return true;
  for (let index = 0; index < corners.length; index += 1) {
    const nextIndex = (index + 1) % corners.length;
    if (segmentIntersection(start, end, corners[index], corners[nextIndex])) return true;
  }
  return false;
};

const computeMinIncidentGapAngle = ({
  node,
  neighborA,
  neighborB,
  body,
  bodyA,
  bodyB
}) => {
  const degreeFactor = 1 + Math.max(0, (node?.degree || 0) - 2) * 0.06;
  const sizeDemand = (
    (arcFootprint(node) || 0) * 0.42
    + (arcFootprint(neighborA) || 0) * 0.18
    + (arcFootprint(neighborB) || 0) * 0.18
  ) * degreeFactor;
  const distanceScale = Math.max(
    12,
    Math.min(distanceBetweenPoints(body, bodyA), distanceBetweenPoints(body, bodyB))
  );
  return clamp(sizeDemand / distanceScale, HUB_MIN_GAP_FLOOR, HUB_MIN_GAP_CEIL);
};

const compareScores = (left, right) => {
  if (!right) return -1;
  const fields = [
    'nodeOverlapCount',
    'nodeOverlapPenalty',
    'edgeCrossings',
    'hubViolationCount',
    'hubPenalty',
    'edgeNodeHits',
    'edgeNodePenalty',
    'compactness'
  ];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const leftValue = Number(left?.[field] || 0);
    const rightValue = Number(right?.[field] || 0);
    if (Math.abs(leftValue - rightValue) <= (field.includes('Penalty') || field === 'compactness' ? 0.001 : 0)) {
      continue;
    }
    return leftValue < rightValue ? -1 : 1;
  }
  return 0;
};

const evaluateLayoutScore = ({
  bodyByKey,
  nodeByKey,
  graphEdges,
  layer,
  radiusByRing
}) => {
  const bodies = Array.from(bodyByKey.values());
  let nodeOverlapCount = 0;
  let nodeOverlapPenalty = 0;
  for (let leftIndex = 0; leftIndex < bodies.length; leftIndex += 1) {
    const left = bodies[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < bodies.length; rightIndex += 1) {
      const right = bodies[rightIndex];
      const overlap = (Number(left.collisionRadius || 0) + Number(right.collisionRadius || 0)) - distanceBetweenPoints(left, right);
      if (overlap > EPSILON) {
        nodeOverlapCount += 1;
        nodeOverlapPenalty += overlap;
      }
    }
  }

  const segments = buildEdgeSegments({
    graphEdges,
    layer,
    bodyByKey
  });

  let edgeCrossings = 0;
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    const left = segments[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const right = segments[rightIndex];
      if (
        left.fromKey === right.fromKey
        || left.fromKey === right.toKey
        || left.toKey === right.fromKey
        || left.toKey === right.toKey
      ) {
        continue;
      }
      if (segmentIntersection(left.start, left.end, right.start, right.end)) edgeCrossings += 1;
    }
  }

  const incidentByKey = new Map();
  segments.forEach((segment) => {
    const start = bodyByKey.get(segment.fromKey);
    const end = bodyByKey.get(segment.toKey);
    if (!start || !end) return;
    const startEntry = incidentByKey.get(segment.fromKey) || [];
    startEntry.push({
      neighborKey: segment.toKey,
      angle: Math.atan2(end.y - start.y, end.x - start.x)
    });
    incidentByKey.set(segment.fromKey, startEntry);

    const endEntry = incidentByKey.get(segment.toKey) || [];
    endEntry.push({
      neighborKey: segment.fromKey,
      angle: Math.atan2(start.y - end.y, start.x - end.x)
    });
    incidentByKey.set(segment.toKey, endEntry);
  });

  let hubViolationCount = 0;
  let hubPenalty = 0;
  incidentByKey.forEach((entries, key) => {
    if (!Array.isArray(entries) || entries.length < 2) return;
    const node = nodeByKey.get(key);
    const body = bodyByKey.get(key);
    if (!node || !body) return;
    const sorted = entries
      .slice()
      .sort((left, right) => normalizePositiveAngle(left.angle) - normalizePositiveAngle(right.angle));
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const next = sorted[(index + 1) % sorted.length];
      const bodyA = bodyByKey.get(current.neighborKey);
      const bodyB = bodyByKey.get(next.neighborKey);
      const nodeA = nodeByKey.get(current.neighborKey);
      const nodeB = nodeByKey.get(next.neighborKey);
      if (!bodyA || !bodyB || !nodeA || !nodeB) continue;
      const gap = normalizePositiveAngle(next.angle - current.angle || 0);
      const minGap = computeMinIncidentGapAngle({
        node,
        neighborA: nodeA,
        neighborB: nodeB,
        body,
        bodyA,
        bodyB
      });
      if (gap + EPSILON >= minGap) continue;
      const deficit = minGap - gap;
      hubViolationCount += 1;
      hubPenalty += deficit * deficit * 100;
    }
  });

  let edgeNodeHits = 0;
  let edgeNodePenalty = 0;
  segments.forEach((segment) => {
    bodies.forEach((body) => {
      if (body.key === segment.fromKey || body.key === segment.toKey) return;
      const rect = body.labelRect || buildLabelRect(body);
      const throughRect = segmentIntersectsRect(segment.start, segment.end, rect);
      const pointDistance = distancePointToSegment(body, segment.start, segment.end);
      if (!throughRect && pointDistance >= (Number(body.collisionRadius || 0) - 1)) return;
      edgeNodeHits += 1;
      edgeNodePenalty += throughRect ? 3 : Math.max(0.5, Number(body.collisionRadius || 0) - pointDistance);
    });
  });

  const outerRadius = Array.from(radiusByRing.values()).reduce((max, radius) => Math.max(max, Number(radius) || 0), 0);
  const radiusSum = Array.from(radiusByRing.values()).reduce((sum, radius) => sum + (Number(radius) || 0), 0);
  const bounds = buildContentBounds(bodies);
  const compactness = outerRadius * 4 + radiusSum + bounds.width * 0.02 + bounds.height * 0.02;

  return {
    nodeOverlapCount,
    nodeOverlapPenalty,
    edgeCrossings,
    hubViolationCount,
    hubPenalty,
    edgeNodeHits,
    edgeNodePenalty,
    compactness
  };
};

const countLayerPairCrossings = (innerEdges = [], outerOrder = new Map(), innerOrder = new Map()) => {
  let crossings = 0;
  for (let leftIndex = 0; leftIndex < innerEdges.length; leftIndex += 1) {
    const left = innerEdges[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < innerEdges.length; rightIndex += 1) {
      const right = innerEdges[rightIndex];
      const leftInner = innerOrder.get(left.fromKey);
      const rightInner = innerOrder.get(right.fromKey);
      const leftOuter = outerOrder.get(left.toKey);
      const rightOuter = outerOrder.get(right.toKey);
      if (!Number.isFinite(leftInner) || !Number.isFinite(rightInner) || !Number.isFinite(leftOuter) || !Number.isFinite(rightOuter)) {
        continue;
      }
      if ((leftInner - rightInner) * (leftOuter - rightOuter) < 0) crossings += 1;
    }
  }
  return crossings;
};

const countSameLayerCrossings = (layerEdges = [], order = new Map()) => {
  let crossings = 0;
  for (let leftIndex = 0; leftIndex < layerEdges.length; leftIndex += 1) {
    const left = layerEdges[leftIndex];
    const a = order.get(left.leftKey);
    const b = order.get(left.rightKey);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const minLeft = Math.min(a, b);
    const maxLeft = Math.max(a, b);
    for (let rightIndex = leftIndex + 1; rightIndex < layerEdges.length; rightIndex += 1) {
      const right = layerEdges[rightIndex];
      const c = order.get(right.leftKey);
      const d = order.get(right.rightKey);
      if (!Number.isFinite(c) || !Number.isFinite(d)) continue;
      const minRight = Math.min(c, d);
      const maxRight = Math.max(c, d);
      const interleave = (
        (minLeft < minRight && minRight < maxLeft && maxLeft < maxRight)
        || (minRight < minLeft && minLeft < maxRight && maxRight < maxLeft)
      );
      if (interleave) crossings += 1;
    }
  }
  return crossings;
};

const buildEdgeBuckets = ({
  edgeList = [],
  ringByKey = new Map(),
  nodeKeySet = new Set()
}) => {
  const betweenLevels = new Map();
  const sameLevel = new Map();

  edgeList.forEach((edge) => {
    const { fromKey, toKey } = edge;
    if (!fromKey || !toKey || fromKey === toKey) return;
    if (!nodeKeySet.has(fromKey) || !nodeKeySet.has(toKey)) return;
    const fromRing = Number(ringByKey.get(fromKey));
    const toRing = Number(ringByKey.get(toKey));
    if (!Number.isFinite(fromRing) || !Number.isFinite(toRing)) return;
    if (fromRing === toRing) {
      const bucket = sameLevel.get(fromRing) || [];
      bucket.push({ leftKey: fromKey, rightKey: toKey });
      sameLevel.set(fromRing, bucket);
      return;
    }
    const innerRing = Math.min(fromRing, toRing);
    const outerRing = Math.max(fromRing, toRing);
    const bucketKey = `${innerRing}:${outerRing}`;
    const bucket = betweenLevels.get(bucketKey) || [];
    bucket.push({
      fromKey: fromRing <= toRing ? fromKey : toKey,
      toKey: fromRing <= toRing ? toKey : fromKey
    });
    betweenLevels.set(bucketKey, bucket);
  });

  return { betweenLevels, sameLevel };
};

const compareProxyScores = (left, right) => {
  if (!right) return -1;
  const fields = [
    'proxyCrossings',
    'hubGapDeficit',
    'localOverlapCount',
    'localOverlapPenalty',
    'compactness'
  ];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const leftValue = Number(left?.[field] || 0);
    const rightValue = Number(right?.[field] || 0);
    if (Math.abs(leftValue - rightValue) <= (field.includes('Penalty') || field.includes('compactness') || field.includes('Deficit') ? 0.001 : 0)) {
      continue;
    }
    return leftValue < rightValue ? -1 : 1;
  }
  return 0;
};

const cloneBodyEntry = (body) => ({
  ...body,
  labelRect: body?.labelRect ? { ...body.labelRect } : undefined
});

const collectKeysForRings = (state, rings = []) => {
  const keySet = new Set();
  rings.forEach((ring) => {
    (state.orderByRing.get(ring) || []).forEach((key) => keySet.add(key));
  });
  return keySet;
};

const expandRingsWithNeighbors = (rings = [], state) => {
  const set = new Set();
  rings.forEach((ring) => {
    if (!Number.isFinite(ring)) return;
    set.add(ring);
    if (state.ringMetaByRing.has(ring - 1)) set.add(ring - 1);
    if (state.ringMetaByRing.has(ring + 1)) set.add(ring + 1);
  });
  return Array.from(set).sort((left, right) => left - right);
};

const createLocalTransaction = (state, {
  orderRings = [],
  angleKeys = [],
  radiusRings = [],
  bodyKeys = []
} = {}) => {
  const transaction = {
    orderByRing: new Map(),
    angleByKey: new Map(),
    radiusByRing: new Map(),
    bodyByKey: new Map(),
    bounds: state.bounds ? { ...state.bounds } : null
  };

  orderRings.forEach((ring) => {
    if (transaction.orderByRing.has(ring)) return;
    transaction.orderByRing.set(ring, (state.orderByRing.get(ring) || []).slice());
  });
  angleKeys.forEach((key) => {
    if (transaction.angleByKey.has(key)) return;
    transaction.angleByKey.set(key, state.angleByKey.get(key));
  });
  radiusRings.forEach((ring) => {
    if (transaction.radiusByRing.has(ring)) return;
    transaction.radiusByRing.set(ring, state.radiusByRing.get(ring));
  });
  bodyKeys.forEach((key) => {
    if (transaction.bodyByKey.has(key)) return;
    const body = state.bodyByKey.get(key);
    transaction.bodyByKey.set(key, body ? cloneBodyEntry(body) : null);
  });
  return transaction;
};

const rollbackLocalTransaction = (state, transaction) => {
  transaction.orderByRing.forEach((order, ring) => {
    state.orderByRing.set(ring, order);
  });
  transaction.angleByKey.forEach((angle, key) => {
    if (Number.isFinite(angle)) state.angleByKey.set(key, angle);
    else state.angleByKey.delete(key);
  });
  transaction.radiusByRing.forEach((radius, ring) => {
    if (Number.isFinite(radius)) state.radiusByRing.set(ring, radius);
    else state.radiusByRing.delete(ring);
  });
  transaction.bodyByKey.forEach((body, key) => {
    if (body) state.bodyByKey.set(key, body);
    else state.bodyByKey.delete(key);
  });
  state.bounds = transaction.bounds ? { ...transaction.bounds } : null;
  rebuildEdgeSegments(state);
};

const buildOverlapPairs = (bodyByKey) => {
  const bodies = Array.from(bodyByKey.values());
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < bodies.length; leftIndex += 1) {
    const left = bodies[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < bodies.length; rightIndex += 1) {
      const right = bodies[rightIndex];
      const overlap = (Number(left.collisionRadius || 0) + Number(right.collisionRadius || 0)) - distanceBetweenPoints(left, right);
      if (overlap > EPSILON) {
        overlaps.push({
          leftKey: left.key,
          rightKey: right.key,
          overlap
        });
      }
    }
  }
  return overlaps;
};

const buildBodyForKey = (state, key) => {
  const node = state.nodeByKey.get(key);
  if (!node) return null;
  const coreBody = state.coreBodyByKey.get(key);
  if (coreBody) {
    const body = {
      key,
      nodeKey: key,
      x: coreBody.x,
      y: coreBody.y,
      radius: Number(node.radius || 0),
      collisionRadius: node.collisionRadius,
      labelWidthHint: Number(node.labelMetrics?.widthHint || node.boxWidth),
      labelHeightHint: Number(node.labelMetrics?.heightHint || node.boxHeight),
      labelOffsetY: 0,
      labelPlacement: 'center',
      labelMetrics: node.labelMetrics,
      level: 0,
      angle: normalizePositiveAngle(state.centerAngleByKey.get(key) || 0),
      rawNode: node.rawNode,
      nodeType: key === state.centerKey ? 'center' : node.nodeType,
      clusterSignature: node.clusterSignature,
      primaryParentKey: node.primaryParentKey,
      childCount: node.childKeys.length,
      degree: node.degree,
      importance: node.importance,
      subtreeWeight: node.subtreeWeight,
      siblingIndex: 0,
      siblingCount: state.scheme.useDualCenter ? 2 : 1
    };
    body.labelRect = buildLabelRect(body);
    return body;
  }

  const ring = Number(state.ringByKey.get(key) || 0);
  const order = state.orderByRing.get(ring) || [];
  const angle = Number(state.angleByKey.get(key) || 0);
  const radius = Number(state.radiusByRing.get(ring) || 0);
  const body = {
    key,
    nodeKey: key,
    x: Number(state.center?.x || 0) + Math.cos(angle) * radius,
    y: Number(state.center?.y || 0) + Math.sin(angle) * radius,
    radius: Number(node.radius || 0),
    collisionRadius: node.collisionRadius,
    labelWidthHint: Number(node.labelMetrics?.widthHint || node.boxWidth),
    labelHeightHint: Number(node.labelMetrics?.heightHint || node.boxHeight),
    labelOffsetY: 0,
    labelPlacement: 'center',
    labelMetrics: node.labelMetrics,
    level: ring,
    angle: normalizePositiveAngle(angle),
    rawNode: node.rawNode,
    nodeType: key === state.centerKey ? 'center' : node.nodeType,
    clusterSignature: node.clusterSignature,
    primaryParentKey: node.primaryParentKey,
    childCount: node.childKeys.length,
    degree: node.degree,
    importance: node.importance,
    subtreeWeight: node.subtreeWeight,
    siblingIndex: Math.max(0, order.indexOf(key)),
    siblingCount: order.length
  };
  body.labelRect = buildLabelRect(body);
  return body;
};

const rebuildBodiesForKeys = (state, keys = []) => {
  keys.forEach((key) => {
    const body = buildBodyForKey(state, key);
    if (body) state.bodyByKey.set(key, body);
  });
};

const rebuildEdgeSegments = (state) => {
  state.edgeSegments = buildEdgeSegments({
    edgeList: state.edgeList,
    bodyByKey: state.bodyByKey
  });
};

const updateEdgeSegmentsForKeys = (state, keys = []) => {
  const affectedEdgeIndexes = new Set();
  keys.forEach((key) => {
    (state.incidentEdgeIndexesByKey.get(key) || []).forEach((edgeIndex) => affectedEdgeIndexes.add(edgeIndex));
  });
  affectedEdgeIndexes.forEach((edgeIndex) => {
    const edge = state.edgeList[edgeIndex];
    if (!edge) return;
    const start = state.bodyByKey.get(edge.fromKey);
    const end = state.bodyByKey.get(edge.toKey);
    if (!start || !end) {
      state.edgeSegments[edgeIndex] = null;
      return;
    }
    state.edgeSegments[edgeIndex] = {
      index: edgeIndex,
      fromKey: edge.fromKey,
      toKey: edge.toKey,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y }
    };
  });
  return affectedEdgeIndexes;
};

const updateBounds = (state) => {
  state.bounds = buildContentBounds(Array.from(state.bodyByKey.values()));
  return state.bounds;
};

const buildProxyCrossingBreakdown = (state) => {
  const orderIndexByRing = new Map();
  state.rings.forEach((ring) => {
    orderIndexByRing.set(ring, buildOrderIndex(state.orderByRing.get(ring) || []));
  });

  let total = 0;
  const crossingsByRing = new Map();
  state.edgeBuckets.betweenLevels.forEach((edges, bucketKey) => {
    const [innerRingText, outerRingText] = bucketKey.split(':');
    const innerRing = Number(innerRingText);
    const outerRing = Number(outerRingText);
    const count = countLayerPairCrossings(
      edges,
      orderIndexByRing.get(outerRing) || new Map(),
      orderIndexByRing.get(innerRing) || new Map()
    );
    total += count;
    crossingsByRing.set(innerRing, (crossingsByRing.get(innerRing) || 0) + count);
    crossingsByRing.set(outerRing, (crossingsByRing.get(outerRing) || 0) + count);
  });
  state.edgeBuckets.sameLevel.forEach((edges, ringText) => {
    const ring = Number(ringText);
    const count = countSameLayerCrossings(edges, orderIndexByRing.get(ring) || new Map());
    total += count;
    crossingsByRing.set(ring, (crossingsByRing.get(ring) || 0) + count);
  });

  return {
    proxyCrossings: total,
    crossingsByRing
  };
};

const evaluateProxyScore = (state) => {
  const crossingBreakdown = buildProxyCrossingBreakdown(state);
  const overlapByRing = new Map();
  let localOverlapCount = 0;
  let localOverlapPenalty = 0;
  const bodies = Array.from(state.bodyByKey.values());

  for (let leftIndex = 0; leftIndex < bodies.length; leftIndex += 1) {
    const left = bodies[leftIndex];
    const leftRing = Number(state.ringByKey.get(left.key) || 0);
    for (let rightIndex = leftIndex + 1; rightIndex < bodies.length; rightIndex += 1) {
      const right = bodies[rightIndex];
      const overlap = (Number(left.collisionRadius || 0) + Number(right.collisionRadius || 0)) - distanceBetweenPoints(left, right);
      if (overlap <= EPSILON) continue;
      const rightRing = Number(state.ringByKey.get(right.key) || 0);
      const targetRing = Math.max(leftRing, rightRing);
      localOverlapCount += 1;
      localOverlapPenalty += overlap;
      const ringEntry = overlapByRing.get(targetRing) || { count: 0, penalty: 0 };
      ringEntry.count += 1;
      ringEntry.penalty += overlap;
      overlapByRing.set(targetRing, ringEntry);
    }
  }

  const incidentByKey = new Map();
  state.edgeSegments.forEach((segment) => {
    if (!segment) return;
    const start = state.bodyByKey.get(segment.fromKey);
    const end = state.bodyByKey.get(segment.toKey);
    if (!start || !end) return;
    const startEntry = incidentByKey.get(segment.fromKey) || [];
    startEntry.push({
      neighborKey: segment.toKey,
      angle: Math.atan2(end.y - start.y, end.x - start.x)
    });
    incidentByKey.set(segment.fromKey, startEntry);

    const endEntry = incidentByKey.get(segment.toKey) || [];
    endEntry.push({
      neighborKey: segment.fromKey,
      angle: Math.atan2(start.y - end.y, start.x - end.x)
    });
    incidentByKey.set(segment.toKey, endEntry);
  });

  const hubGapByRing = new Map();
  let hubGapDeficit = 0;
  incidentByKey.forEach((entries, key) => {
    if (!Array.isArray(entries) || entries.length < 2) return;
    const node = state.nodeByKey.get(key);
    const body = state.bodyByKey.get(key);
    if (!node || !body) return;
    const sorted = entries
      .slice()
      .sort((left, right) => normalizePositiveAngle(left.angle) - normalizePositiveAngle(right.angle));
    let ringDeficit = 0;
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const next = sorted[(index + 1) % sorted.length];
      const bodyA = state.bodyByKey.get(current.neighborKey);
      const bodyB = state.bodyByKey.get(next.neighborKey);
      const nodeA = state.nodeByKey.get(current.neighborKey);
      const nodeB = state.nodeByKey.get(next.neighborKey);
      if (!bodyA || !bodyB || !nodeA || !nodeB) continue;
      const gap = normalizePositiveAngle(next.angle - current.angle || 0);
      const minGap = computeMinIncidentGapAngle({
        node,
        neighborA: nodeA,
        neighborB: nodeB,
        body,
        bodyA,
        bodyB
      });
      if (gap + EPSILON >= minGap) continue;
      ringDeficit += minGap - gap;
    }
    if (ringDeficit <= EPSILON) return;
    const ring = Number(state.ringByKey.get(key) || 0);
    hubGapByRing.set(ring, (hubGapByRing.get(ring) || 0) + ringDeficit);
    hubGapDeficit += ringDeficit;
  });

  const outerRadius = Array.from(state.radiusByRing.values()).reduce((max, radius) => Math.max(max, Number(radius) || 0), 0);
  const radiusSum = Array.from(state.radiusByRing.values()).reduce((sum, radius) => sum + (Number(radius) || 0), 0);
  const bounds = state.bounds || buildContentBounds(bodies);
  const compactness = outerRadius * 4 + radiusSum + bounds.width * 0.02 + bounds.height * 0.02;

  return {
    score: {
      proxyCrossings: crossingBreakdown.proxyCrossings,
      hubGapDeficit,
      localOverlapCount,
      localOverlapPenalty,
      compactness
    },
    metrics: {
      crossingsByRing: crossingBreakdown.crossingsByRing,
      hubGapByRing,
      overlapByRing
    }
  };
};

const computeNodeOverlapContribution = (state, leftKey, rightKey) => {
  const left = state.bodyByKey.get(leftKey);
  const right = state.bodyByKey.get(rightKey);
  if (!left || !right) return { count: 0, penalty: 0 };
  const overlap = (Number(left.collisionRadius || 0) + Number(right.collisionRadius || 0)) - distanceBetweenPoints(left, right);
  if (overlap <= EPSILON) return { count: 0, penalty: 0 };
  return { count: 1, penalty: overlap };
};

const computeEdgeCrossingContribution = (state, leftIndex, rightIndex) => {
  const left = state.edgeSegments[leftIndex];
  const right = state.edgeSegments[rightIndex];
  if (!left || !right) return { count: 0 };
  if (
    left.fromKey === right.fromKey
    || left.fromKey === right.toKey
    || left.toKey === right.fromKey
    || left.toKey === right.toKey
  ) {
    return { count: 0 };
  }
  return {
    count: segmentIntersection(left.start, left.end, right.start, right.end) ? 1 : 0
  };
};

const computeHubContributionForKey = (state, key) => {
  const incidentIndexes = state.incidentEdgeIndexesByKey.get(key) || [];
  if (incidentIndexes.length < 2) return { count: 0, penalty: 0 };
  const body = state.bodyByKey.get(key);
  const node = state.nodeByKey.get(key);
  if (!body || !node) return { count: 0, penalty: 0 };
  const entries = [];
  incidentIndexes.forEach((edgeIndex) => {
    const edge = state.edgeList[edgeIndex];
    const segment = state.edgeSegments[edgeIndex];
    if (!edge || !segment) return;
    const neighborKey = edge.fromKey === key ? edge.toKey : edge.fromKey;
    const neighborBody = state.bodyByKey.get(neighborKey);
    if (!neighborBody) return;
    entries.push({
      neighborKey,
      angle: Math.atan2(neighborBody.y - body.y, neighborBody.x - body.x)
    });
  });
  if (entries.length < 2) return { count: 0, penalty: 0 };
  const sorted = entries.slice().sort((left, right) => normalizePositiveAngle(left.angle) - normalizePositiveAngle(right.angle));
  let count = 0;
  let penalty = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next = sorted[(index + 1) % sorted.length];
    const bodyA = state.bodyByKey.get(current.neighborKey);
    const bodyB = state.bodyByKey.get(next.neighborKey);
    const nodeA = state.nodeByKey.get(current.neighborKey);
    const nodeB = state.nodeByKey.get(next.neighborKey);
    if (!bodyA || !bodyB || !nodeA || !nodeB) continue;
    const gap = normalizePositiveAngle(next.angle - current.angle || 0);
    const minGap = computeMinIncidentGapAngle({
      node,
      neighborA: nodeA,
      neighborB: nodeB,
      body,
      bodyA,
      bodyB
    });
    if (gap + EPSILON >= minGap) continue;
    const deficit = minGap - gap;
    count += 1;
    penalty += deficit * deficit * 100;
  }
  return { count, penalty };
};

const computeEdgeNodeContribution = (state, edgeIndex, nodeKey) => {
  const segment = state.edgeSegments[edgeIndex];
  const edge = state.edgeList[edgeIndex];
  const body = state.bodyByKey.get(nodeKey);
  if (!segment || !edge || !body) return { nodeKey, count: 0, penalty: 0 };
  if (nodeKey === edge.fromKey || nodeKey === edge.toKey) return { nodeKey, count: 0, penalty: 0 };
  const rect = body.labelRect || buildLabelRect(body);
  const throughRect = segmentIntersectsRect(segment.start, segment.end, rect);
  const pointDistance = distancePointToSegment(body, segment.start, segment.end);
  if (!throughRect && pointDistance >= (Number(body.collisionRadius || 0) - 1)) {
    return { nodeKey, count: 0, penalty: 0 };
  }
  return {
    nodeKey,
    count: 1,
    penalty: throughRect ? 3 : Math.max(0.5, Number(body.collisionRadius || 0) - pointDistance)
  };
};

const buildFullExactCache = (state) => {
  const overlapByPair = new Map();
  const crossingByPair = new Map();
  const hubByKey = new Map();
  const edgeNodeByPair = new Map();
  const edgeNodeByKey = new Map(state.sortedKeys.map((key) => [key, { count: 0, penalty: 0 }]));
  const score = {
    nodeOverlapCount: 0,
    nodeOverlapPenalty: 0,
    edgeCrossings: 0,
    hubViolationCount: 0,
    hubPenalty: 0,
    edgeNodeHits: 0,
    edgeNodePenalty: 0,
    compactness: 0
  };

  for (let leftIndex = 0; leftIndex < state.sortedKeys.length; leftIndex += 1) {
    const leftKey = state.sortedKeys[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < state.sortedKeys.length; rightIndex += 1) {
      const rightKey = state.sortedKeys[rightIndex];
      const contribution = computeNodeOverlapContribution(state, leftKey, rightKey);
      if (contribution.count > 0) {
        overlapByPair.set(`${leftIndex}:${rightIndex}`, contribution);
        score.nodeOverlapCount += contribution.count;
        score.nodeOverlapPenalty += contribution.penalty;
      }
    }
  }

  for (let leftIndex = 0; leftIndex < state.edgeList.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < state.edgeList.length; rightIndex += 1) {
      const contribution = computeEdgeCrossingContribution(state, leftIndex, rightIndex);
      if (contribution.count > 0) {
        crossingByPair.set(`${leftIndex}:${rightIndex}`, contribution);
        score.edgeCrossings += contribution.count;
      }
    }
  }

  state.sortedKeys.forEach((key) => {
    const contribution = computeHubContributionForKey(state, key);
    hubByKey.set(key, contribution);
    score.hubViolationCount += contribution.count;
    score.hubPenalty += contribution.penalty;
  });

  for (let edgeIndex = 0; edgeIndex < state.edgeList.length; edgeIndex += 1) {
    state.sortedKeys.forEach((key) => {
      const contribution = computeEdgeNodeContribution(state, edgeIndex, key);
      if (contribution.count > 0) {
        edgeNodeByPair.set(`${edgeIndex}:${state.nodeIndexByKey.get(key)}`, contribution);
        score.edgeNodeHits += contribution.count;
        score.edgeNodePenalty += contribution.penalty;
        const current = edgeNodeByKey.get(key) || { count: 0, penalty: 0 };
        current.count += contribution.count;
        current.penalty += contribution.penalty;
        edgeNodeByKey.set(key, current);
      }
    });
  }

  const outerRadius = Array.from(state.radiusByRing.values()).reduce((max, radius) => Math.max(max, Number(radius) || 0), 0);
  const radiusSum = Array.from(state.radiusByRing.values()).reduce((sum, radius) => sum + (Number(radius) || 0), 0);
  const bounds = state.bounds || buildContentBounds(Array.from(state.bodyByKey.values()));
  score.compactness = outerRadius * 4 + radiusSum + bounds.width * 0.02 + bounds.height * 0.02;

  return {
    score,
    overlapByPair,
    crossingByPair,
    hubByKey,
    edgeNodeByPair,
    edgeNodeByKey
  };
};

const evaluateExactScore = (state, affected = null) => {
  const startedAt = now();
  if (!state.exactCache || affected?.full) {
    const cache = buildFullExactCache(state);
    state.timing.exactScoringStage += now() - startedAt;
    return cache;
  }

  const nextCache = {
    score: { ...state.exactCache.score },
    overlapByPair: new Map(state.exactCache.overlapByPair),
    crossingByPair: new Map(state.exactCache.crossingByPair),
    hubByKey: new Map(state.exactCache.hubByKey),
    edgeNodeByPair: new Map(state.exactCache.edgeNodeByPair),
    edgeNodeByKey: new Map(Array.from(state.exactCache.edgeNodeByKey.entries()).map(([key, value]) => [key, { ...value }]))
  };

  const affectedKeys = Array.from(affected?.affectedKeys || []);
  const affectedEdges = Array.from(affected?.affectedEdges || []);

  affectedKeys.forEach((key) => {
    const leftIndex = state.nodeIndexByKey.get(key);
    state.sortedKeys.forEach((otherKey) => {
      if (key === otherKey) return;
      const rightIndex = state.nodeIndexByKey.get(otherKey);
      const pairKey = leftIndex < rightIndex ? `${leftIndex}:${rightIndex}` : `${rightIndex}:${leftIndex}`;
      const previous = nextCache.overlapByPair.get(pairKey) || { count: 0, penalty: 0 };
      const next = computeNodeOverlapContribution(state, key, otherKey);
      nextCache.score.nodeOverlapCount += next.count - previous.count;
      nextCache.score.nodeOverlapPenalty += next.penalty - previous.penalty;
      if (next.count > 0) nextCache.overlapByPair.set(pairKey, next);
      else nextCache.overlapByPair.delete(pairKey);
    });
  });

  affectedEdges.forEach((edgeIndex) => {
    for (let otherIndex = 0; otherIndex < state.edgeList.length; otherIndex += 1) {
      if (otherIndex === edgeIndex) continue;
      const pairKey = edgeIndex < otherIndex ? `${edgeIndex}:${otherIndex}` : `${otherIndex}:${edgeIndex}`;
      const previous = nextCache.crossingByPair.get(pairKey) || { count: 0 };
      const next = computeEdgeCrossingContribution(state, edgeIndex, otherIndex);
      nextCache.score.edgeCrossings += next.count - previous.count;
      if (next.count > 0) nextCache.crossingByPair.set(pairKey, next);
      else nextCache.crossingByPair.delete(pairKey);
    }
  });

  const affectedHubKeys = new Set(affectedKeys);
  affectedKeys.forEach((key) => {
    (state.sortedNeighborsByKey.get(key) || []).forEach((neighborKey) => affectedHubKeys.add(neighborKey));
  });
  affectedHubKeys.forEach((key) => {
    const previous = nextCache.hubByKey.get(key) || { count: 0, penalty: 0 };
    const next = computeHubContributionForKey(state, key);
    nextCache.score.hubViolationCount += next.count - previous.count;
    nextCache.score.hubPenalty += next.penalty - previous.penalty;
    nextCache.hubByKey.set(key, next);
  });

  const touchedEdgeNodePairs = new Set();
  affectedEdges.forEach((edgeIndex) => {
    state.sortedKeys.forEach((key) => {
      touchedEdgeNodePairs.add(`${edgeIndex}:${state.nodeIndexByKey.get(key)}`);
    });
  });
  affectedKeys.forEach((key) => {
    const nodeIndex = state.nodeIndexByKey.get(key);
    for (let edgeIndex = 0; edgeIndex < state.edgeList.length; edgeIndex += 1) {
      touchedEdgeNodePairs.add(`${edgeIndex}:${nodeIndex}`);
    }
  });
  touchedEdgeNodePairs.forEach((pairKey) => {
    const [edgeIndexText, nodeIndexText] = pairKey.split(':');
    const edgeIndex = Number(edgeIndexText);
    const nodeIndex = Number(nodeIndexText);
    const nodeKey = state.sortedKeys[nodeIndex];
    const previous = nextCache.edgeNodeByPair.get(pairKey) || { nodeKey, count: 0, penalty: 0 };
    const next = computeEdgeNodeContribution(state, edgeIndex, nodeKey);
    const nodeSummary = nextCache.edgeNodeByKey.get(nodeKey) || { count: 0, penalty: 0 };
    nodeSummary.count += next.count - previous.count;
    nodeSummary.penalty += next.penalty - previous.penalty;
    nextCache.edgeNodeByKey.set(nodeKey, nodeSummary);
    nextCache.score.edgeNodeHits += next.count - previous.count;
    nextCache.score.edgeNodePenalty += next.penalty - previous.penalty;
    if (next.count > 0) nextCache.edgeNodeByPair.set(pairKey, next);
    else nextCache.edgeNodeByPair.delete(pairKey);
  });

  const outerRadius = Array.from(state.radiusByRing.values()).reduce((max, radius) => Math.max(max, Number(radius) || 0), 0);
  const radiusSum = Array.from(state.radiusByRing.values()).reduce((sum, radius) => sum + (Number(radius) || 0), 0);
  const bounds = state.bounds || buildContentBounds(Array.from(state.bodyByKey.values()));
  nextCache.score.compactness = outerRadius * 4 + radiusSum + bounds.width * 0.02 + bounds.height * 0.02;
  state.timing.exactScoringStage += now() - startedAt;
  return nextCache;
};

const syncProxyEvaluation = (state) => {
  const proxy = evaluateProxyScore(state);
  state.proxyScore = proxy.score;
  state.proxyMetrics = proxy.metrics;
  state.proxyCrossings = Number(proxy.score.proxyCrossings || 0);
  return proxy.score;
};

const syncExactEvaluation = (state, affected = { full: true }) => {
  const cache = evaluateExactScore(state, affected);
  state.exactCache = cache;
  state.score = cache.score;
  return cache.score;
};

const recomputeMinimumRadiiFrom = (state, startRing) => {
  let previousOuterBoundary = state.coreEnvelope;
  let previousAverageSize = state.coreAverageSize;
  const startIndex = state.rings.indexOf(startRing);
  if (startIndex > 0) {
    for (let index = 0; index < startIndex; index += 1) {
      const ring = state.rings[index];
      const ringStats = state.statsByRing.get(ring) || { maxSize: 0, averageSize: 0 };
      previousOuterBoundary = (state.radiusByRing.get(ring) || 0) + ringStats.maxSize * 0.5;
      previousAverageSize = ringStats.averageSize;
    }
  }
  for (let index = Math.max(0, startIndex); index < state.rings.length; index += 1) {
    const ring = state.rings[index];
    const ringStats = state.statsByRing.get(ring) || { maxSize: 0, averageSize: 0 };
    const padding = RADIAL_DENSITY_K * 0.5 * (
      Math.max(previousAverageSize, ringStats.averageSize)
      + Math.min(previousAverageSize || ringStats.averageSize, ringStats.averageSize || previousAverageSize)
    );
    const minRadiusByGap = previousOuterBoundary + ringStats.maxSize * 0.5 + padding;
    const minRadius = Math.max(
      RADIAL_MIN_RADIUS,
      minRadiusByGap,
      state.minCapacityRadiusByRing.get(ring) || 0
    );
    state.minimumRadiusByRing.set(ring, minRadius);
    state.radiusByRing.set(ring, Math.max(state.radiusByRing.get(ring) || 0, minRadius));
    previousOuterBoundary = (state.radiusByRing.get(ring) || 0) + ringStats.maxSize * 0.5;
    previousAverageSize = ringStats.averageSize;
  }
};

const assignAnglesForRings = (state, rings, passes = 2) => {
  const targetRings = Array.from(new Set(rings)).sort((left, right) => left - right);
  for (let pass = 0; pass < passes; pass += 1) {
    targetRings.forEach((ring) => {
      const meta = state.ringMetaByRing.get(ring);
      const radius = state.radiusByRing.get(ring) || 1;
      const order = state.orderByRing.get(ring) || [];
      (meta?.segmentOrder || []).forEach((segmentKey) => {
        const segmentDef = state.segmentDefsByRing.get(ring)?.get(segmentKey);
        const orderedKeys = order.filter((key) => (state.nodeByKey.get(key)?.segmentKey || 'main') === segmentKey);
        assignAnglesInSegment({
          orderedKeys,
          radius,
          segmentDef,
          nodeByKey: state.nodeByKey,
          angleByKey: state.angleByKey,
          direction: 'forward'
        });
      });
    });
    targetRings.slice().reverse().forEach((ring) => {
      const meta = state.ringMetaByRing.get(ring);
      const radius = state.radiusByRing.get(ring) || 1;
      const order = state.orderByRing.get(ring) || [];
      (meta?.segmentOrder || []).forEach((segmentKey) => {
        const segmentDef = state.segmentDefsByRing.get(ring)?.get(segmentKey);
        const orderedKeys = order.filter((key) => (state.nodeByKey.get(key)?.segmentKey || 'main') === segmentKey);
        assignAnglesInSegment({
          orderedKeys,
          radius,
          segmentDef,
          nodeByKey: state.nodeByKey,
          angleByKey: state.angleByKey,
          direction: 'backward'
        });
      });
    });
  }
};

const refreshGeometryLocal = (state, options = {}) => {
  const {
    kind = 'segmentOrder',
    rings = [],
    keys = [],
    startRing = null
  } = options;

  if (kind === 'segmentOrder') {
    const affectedRings = expandRingsWithNeighbors(rings, state);
    assignAnglesForRings(state, affectedRings, 2);
    const affectedKeys = collectKeysForRings(state, affectedRings);
    rebuildBodiesForKeys(state, Array.from(affectedKeys));
    const affectedEdges = updateEdgeSegmentsForKeys(state, Array.from(affectedKeys));
    updateBounds(state);
    return { affectedRings, affectedKeys, affectedEdges };
  }

  if (kind === 'nodeNudge') {
    rebuildBodiesForKeys(state, keys);
    const affectedEdges = updateEdgeSegmentsForKeys(state, keys);
    updateBounds(state);
    return { affectedRings: new Set(rings), affectedKeys: new Set(keys), affectedEdges };
  }

  if (kind === 'ringRotation') {
    const affectedKeys = collectKeysForRings(state, rings);
    rebuildBodiesForKeys(state, Array.from(affectedKeys));
    const affectedEdges = updateEdgeSegmentsForKeys(state, Array.from(affectedKeys));
    updateBounds(state);
    return { affectedRings: new Set(rings), affectedKeys, affectedEdges };
  }

  if (kind === 'radiusAdjust') {
    recomputeMinimumRadiiFrom(state, startRing);
    const affectedRings = state.rings.filter((ring) => ring >= startRing);
    const affectedKeys = collectKeysForRings(state, affectedRings);
    rebuildBodiesForKeys(state, Array.from(affectedKeys));
    const affectedEdges = updateEdgeSegmentsForKeys(state, Array.from(affectedKeys));
    updateBounds(state);
    return { affectedRings: new Set(affectedRings), affectedKeys, affectedEdges };
  }

  const affectedKeys = new Set(keys);
  rebuildBodiesForKeys(state, Array.from(affectedKeys));
  const affectedEdges = updateEdgeSegmentsForKeys(state, Array.from(affectedKeys));
  updateBounds(state);
  return { affectedRings: new Set(rings), affectedKeys, affectedEdges };
};

const refreshGeometry = (state, {
  mode = 'rebuild',
  scoreMode = 'exact',
  includeOverlapExpansion = scoreMode === 'exact'
} = {}) => {
  const core = buildCoreBodies({
    center: state.center,
    nodeByKey: state.nodeByKey,
    scheme: state.scheme,
    orientation: state.orientation
  });
  state.coreBodyByKey = core.coreBodyByKey;
  state.coreEnvelope = core.coreEnvelope;
  state.coreMaxSize = core.coreMaxSize;
  state.coreAverageSize = core.coreAverageSize;
  state.centerAngleByKey = buildCenterAngleByKey({
    scheme: state.scheme,
    orientation: state.orientation
  });
  state.centerAngleByKey.forEach((angle, key) => {
    state.angleByKey.set(key, angle);
  });

  state.segmentDefsByRing = buildSegmentDefinitionsByRing({
    rings: state.rings,
    ringMetaByRing: state.ringMetaByRing,
    nodeByKey: state.nodeByKey,
    scheme: state.scheme,
    orientation: state.orientation
  });

  const {
    minimumRadiusByRing,
    minCapacityRadiusByRing,
    statsByRing
  } = buildMinimumRadii({
    rings: state.rings,
    orderByRing: state.orderByRing,
    ringMetaByRing: state.ringMetaByRing,
    segmentDefsByRing: state.segmentDefsByRing,
    nodeByKey: state.nodeByKey,
    coreEnvelope: state.coreEnvelope,
    coreAverageSize: state.coreAverageSize
  });

  state.statsByRing = statsByRing;
  state.minimumRadiusByRing = new Map(minimumRadiusByRing);
  state.minCapacityRadiusByRing = new Map(minCapacityRadiusByRing);
  if (mode === 'rebuild' || state.radiusByRing.size < state.rings.length) {
    state.radiusByRing = new Map(minimumRadiusByRing);
  } else {
    state.rings.forEach((ring) => {
      state.radiusByRing.set(ring, Math.max(
        state.radiusByRing.get(ring) || 0,
        minimumRadiusByRing.get(ring) || 0
      ));
    });
  }
  recomputeMinimumRadiiFrom(state, state.rings[0] || 1);

  assignAllAngles({
    rings: state.rings,
    orderByRing: state.orderByRing,
    ringMetaByRing: state.ringMetaByRing,
    radiusByRing: state.radiusByRing,
    nodeByKey: state.nodeByKey,
    angleByKey: state.angleByKey,
    segmentDefsByRing: state.segmentDefsByRing
  });

  const builtBodies = buildNodeBodies({
    center: state.center,
    centerKey: state.centerKey,
    scheme: state.scheme,
    rings: state.rings,
    orderByRing: state.orderByRing,
    radiusByRing: state.radiusByRing,
    angleByKey: state.angleByKey,
    nodeByKey: state.nodeByKey,
    coreBodyByKey: state.coreBodyByKey,
    centerAngleByKey: state.centerAngleByKey
  });
  state.bodyByKey = builtBodies.bodyByKey;
  state.bounds = buildContentBounds(builtBodies.bodies);
  rebuildEdgeSegments(state);
  syncProxyEvaluation(state);

  if (includeOverlapExpansion) {
    for (let passIndex = 0; passIndex < OVERLAP_EXPANSION_PASSES; passIndex += 1) {
      const overlaps = buildOverlapPairs(state.bodyByKey);
      if (overlaps.length < 1) break;
      overlaps.forEach((entry) => {
        const leftRing = Number(state.ringByKey.get(entry.leftKey) || 0);
        const rightRing = Number(state.ringByKey.get(entry.rightKey) || 0);
        const targetRing = Math.max(leftRing, rightRing);
        if (targetRing < 1) return;
        state.radiusByRing.set(
          targetRing,
          (state.radiusByRing.get(targetRing) || 0) + entry.overlap + 2
        );
      });
      recomputeMinimumRadiiFrom(state, 1);
      assignAllAngles({
        rings: state.rings,
        orderByRing: state.orderByRing,
        ringMetaByRing: state.ringMetaByRing,
        radiusByRing: state.radiusByRing,
        nodeByKey: state.nodeByKey,
        angleByKey: state.angleByKey,
        segmentDefsByRing: state.segmentDefsByRing,
        passes: 2
      });
      const refreshedBodies = buildNodeBodies({
        center: state.center,
        centerKey: state.centerKey,
        scheme: state.scheme,
        rings: state.rings,
        orderByRing: state.orderByRing,
        radiusByRing: state.radiusByRing,
        angleByKey: state.angleByKey,
        nodeByKey: state.nodeByKey,
        coreBodyByKey: state.coreBodyByKey,
        centerAngleByKey: state.centerAngleByKey
      });
      state.bodyByKey = refreshedBodies.bodyByKey;
      state.bounds = buildContentBounds(refreshedBodies.bodies);
      rebuildEdgeSegments(state);
      syncProxyEvaluation(state);
    }
  }

  if (scoreMode === 'exact') {
    syncExactEvaluation(state, { full: true });
  } else {
    state.score = null;
    state.exactCache = null;
  }
  return state;
};

const createInitialState = ({
  center,
  centerKey,
  layer,
  graphEdges,
  graphMeta,
  nodeByKey,
  stableSort,
  sortedKeys,
  sortedNeighborsByKey,
  nodeIndexByKey,
  edgeBuckets,
  edgeList,
  incidentEdgeIndexesByKey,
  scheme,
  orientation,
  ringByKey,
  ringMetaByRing,
  rings
}) => {
  const centerAngleByKey = buildCenterAngleByKey({ scheme, orientation });
  const segmentDefsByRing = buildSegmentDefinitionsByRing({
    rings,
    ringMetaByRing,
    nodeByKey,
    scheme,
    orientation
  });
  const { orderByRing, angleByKey } = buildBaseOrders({
    rings,
    ringMetaByRing,
    nodeByKey,
    stableSort,
    centerAngleByKey,
    segmentDefsByRing
  });

  const state = {
    center,
    centerKey,
    layer,
    graphEdges,
    graphMeta,
    nodeByKey,
    stableSort,
    sortedKeys,
    sortedNeighborsByKey,
    nodeIndexByKey,
    edgeBuckets,
    edgeList,
    incidentEdgeIndexesByKey,
    scheme,
    orientation,
    ringByKey,
    ringMetaByRing,
    rings,
    centerAngleByKey,
    segmentDefsByRing,
    orderByRing,
    angleByKey,
    radiusByRing: new Map(),
    statsByRing: new Map(),
    coreBodyByKey: new Map(),
    coreEnvelope: 0,
    coreMaxSize: 0,
    coreAverageSize: 0,
    bodyByKey: new Map(),
    edgeSegments: [],
    score: null,
    exactCache: null,
    proxyScore: null,
    proxyMetrics: null,
    proxyCrossings: 0,
    bounds: null,
    initialScore: null,
    minimumRadiusByRing: new Map(),
    minCapacityRadiusByRing: new Map(),
    timing: {
      exactScoringStage: 0
    }
  };

  refreshGeometry(state, {
    mode: 'rebuild',
    scoreMode: 'proxy',
    includeOverlapExpansion: false
  });
  return state;
};

const rotateArrayLeft = (values = [], offset = 0) => {
  if (!Array.isArray(values) || values.length < 2) return values.slice();
  const normalized = ((offset % values.length) + values.length) % values.length;
  if (normalized === 0) return values.slice();
  return values.slice(normalized).concat(values.slice(0, normalized));
};

const replaceRingSegmentOrder = ({
  state,
  ring,
  segmentKey,
  nextSegmentOrder
}) => {
  const meta = state.ringMetaByRing.get(ring);
  const currentOrder = state.orderByRing.get(ring) || [];
  if (!meta) return;
  const nextOrder = [];
  meta.segmentOrder.forEach((candidateSegmentKey) => {
    if (candidateSegmentKey === segmentKey) {
      nextOrder.push(...nextSegmentOrder);
      return;
    }
    nextOrder.push(
      ...currentOrder.filter((key) => (state.nodeByKey.get(key)?.segmentKey || 'main') === candidateSegmentKey)
    );
  });
  state.orderByRing.set(ring, nextOrder);
};

const isProxyWorthExact = (candidateProxy, baselineProxy) => (
  compareProxyScores(candidateProxy, baselineProxy) < 0
  || (
    Number(candidateProxy?.proxyCrossings || 0) <= Number(baselineProxy?.proxyCrossings || 0) + PROXY_CANDIDATE_BUFFER
    && Number(candidateProxy?.hubGapDeficit || 0) <= Number(baselineProxy?.hubGapDeficit || 0) * 1.15 + 0.2
    && Number(candidateProxy?.localOverlapPenalty || 0) <= Number(baselineProxy?.localOverlapPenalty || 0) * 1.15 + 0.5
  )
);

const tryLocalMove = (state, {
  transaction,
  mutate,
  refresh
}) => {
  const baselineScore = state.score ? { ...state.score } : null;
  const baselineProxy = state.proxyScore ? { ...state.proxyScore } : null;
  mutate();
  const affected = refreshGeometryLocal(state, refresh);
  const proxy = evaluateProxyScore(state);
  if (!isProxyWorthExact(proxy.score, baselineProxy)) {
    rollbackLocalTransaction(state, transaction);
    return false;
  }
  const exact = evaluateExactScore(state, affected);
  if (!baselineScore || compareScores(exact.score, baselineScore) < 0) {
    state.proxyScore = proxy.score;
    state.proxyMetrics = proxy.metrics;
    state.proxyCrossings = Number(proxy.score.proxyCrossings || 0);
    state.exactCache = exact;
    state.score = exact.score;
    return true;
  }
  rollbackLocalTransaction(state, transaction);
  return false;
};

const getDirtyRings = (state) => {
  const dirty = new Set();
  state.proxyMetrics?.crossingsByRing?.forEach((count, ring) => {
    if (count > 0) dirty.add(Number(ring));
  });
  state.proxyMetrics?.hubGapByRing?.forEach((value, ring) => {
    if (value > EPSILON) dirty.add(Number(ring));
  });
  state.proxyMetrics?.overlapByRing?.forEach((entry, ring) => {
    if ((entry?.count || 0) > 0 || (entry?.penalty || 0) > EPSILON) dirty.add(Number(ring));
  });
  state.exactCache?.hubByKey?.forEach((entry, key) => {
    if ((entry?.count || 0) < 1 && (entry?.penalty || 0) <= EPSILON) return;
    dirty.add(Number(state.ringByKey.get(key) || 0));
  });
  state.exactCache?.edgeNodeByKey?.forEach((entry, key) => {
    if ((entry?.count || 0) < 1 && (entry?.penalty || 0) <= EPSILON) return;
    dirty.add(Number(state.ringByKey.get(key) || 0));
  });
  return state.rings.filter((ring) => dirty.has(ring));
};

const getBadNodes = (state) => {
  const bad = new Set();
  state.exactCache?.hubByKey?.forEach((entry, key) => {
    if ((entry?.count || 0) > 0 || (entry?.penalty || 0) > EPSILON) bad.add(key);
  });
  state.exactCache?.edgeNodeByKey?.forEach((entry, key) => {
    if ((entry?.count || 0) > 0 || (entry?.penalty || 0) > EPSILON) bad.add(key);
  });
  state.sortedKeys.forEach((key) => {
    const node = state.nodeByKey.get(key);
    if ((node?.degree || 0) >= HIGH_DEGREE_NODE_THRESHOLD) bad.add(key);
  });
  return bad;
};

const optimizeAdjacentSwaps = (state) => {
  for (let round = 0; round < SWAP_ROUNDS; round += 1) {
    let improved = false;
    state.rings.forEach((ring) => {
      const meta = state.ringMetaByRing.get(ring);
      (meta?.segmentOrder || []).forEach((segmentKey) => {
        const segmentKeys = (state.orderByRing.get(ring) || []).filter((key) => (state.nodeByKey.get(key)?.segmentKey || 'main') === segmentKey);
        for (let index = 0; index < segmentKeys.length - 1; index += 1) {
          const nextSegmentOrder = segmentKeys.slice();
          [nextSegmentOrder[index], nextSegmentOrder[index + 1]] = [nextSegmentOrder[index + 1], nextSegmentOrder[index]];
          const affectedRings = expandRingsWithNeighbors([ring], state);
          const angleKeys = Array.from(collectKeysForRings(state, affectedRings));
          const transaction = createLocalTransaction(state, {
            orderRings: [ring],
            angleKeys,
            bodyKeys: angleKeys
          });
          const accepted = tryLocalMove(state, {
            transaction,
            mutate: () => {
              replaceRingSegmentOrder({
                state,
                ring,
                segmentKey,
                nextSegmentOrder
              });
            },
            refresh: {
              kind: 'segmentOrder',
              rings: [ring]
            }
          });
          if (accepted) improved = true;
        }
      });
    });
    if (!improved) break;
  }
};

const buildBlockPatterns = (block = []) => {
  const patterns = [];
  if (block.length >= 3) {
    patterns.push(rotateArrayLeft(block, 1));
    patterns.push(rotateArrayLeft(block, -1));
    patterns.push(block.slice().reverse());
  }
  return patterns
    .slice(0, MAX_BLOCK_PATTERNS)
    .filter((pattern, index, array) => array.findIndex((candidate) => candidate.join('|') === pattern.join('|')) === index);
};

const optimizeBlockMoves = (state) => {
  let improved = false;
  const dirtyRings = getDirtyRings(state);
  dirtyRings.forEach((ring) => {
    const meta = state.ringMetaByRing.get(ring);
    (meta?.segmentOrder || []).forEach((segmentKey) => {
      const segmentKeys = (state.orderByRing.get(ring) || []).filter((key) => (state.nodeByKey.get(key)?.segmentKey || 'main') === segmentKey);
      if (segmentKeys.length > BLOCK_MOVE_SKIP_THRESHOLD) return;
      const maxWindow = segmentKeys.length > BLOCK_WINDOW_LARGE_THRESHOLD ? 3 : Math.min(BLOCK_WINDOW_MAX, segmentKeys.length);
      for (let windowSize = BLOCK_WINDOW_MIN; windowSize <= maxWindow; windowSize += 1) {
        for (let start = 0; start + windowSize <= segmentKeys.length; start += 1) {
          const block = segmentKeys.slice(start, start + windowSize);
          const patterns = buildBlockPatterns(block);
          for (let patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
            const pattern = patterns[patternIndex];
            const nextSegmentOrder = segmentKeys.slice();
            nextSegmentOrder.splice(start, windowSize, ...pattern);
            const affectedRings = expandRingsWithNeighbors([ring], state);
            const angleKeys = Array.from(collectKeysForRings(state, affectedRings));
            const transaction = createLocalTransaction(state, {
              orderRings: [ring],
              angleKeys,
              bodyKeys: angleKeys
            });
            const accepted = tryLocalMove(state, {
              transaction,
              mutate: () => {
                replaceRingSegmentOrder({
                  state,
                  ring,
                  segmentKey,
                  nextSegmentOrder
                });
              },
              refresh: {
                kind: 'segmentOrder',
                rings: [ring]
              }
            });
            if (accepted) improved = true;
          }
        }
      }
    });
  });
  return improved;
};

const shiftAnglesForKeys = ({
  state,
  ring,
  keys,
  segmentDef,
  delta
}) => {
  if (!Array.isArray(keys) || keys.length < 1) return false;
  const radius = state.radiusByRing.get(ring) || 1;
  const firstKey = keys[0];
  const lastKey = keys[keys.length - 1];
  const firstNode = state.nodeByKey.get(firstKey);
  const lastNode = state.nodeByKey.get(lastKey);
  const lowerBound = Number(segmentDef?.start || 0) + chordToAngle(leadingEdgeDistance(firstNode), radius);
  const upperBound = Number(segmentDef?.end || 0) - chordToAngle(trailingEdgeDistance(lastNode), radius);
  const currentMin = Number(state.angleByKey.get(firstKey) || lowerBound);
  const currentMax = Number(state.angleByKey.get(lastKey) || upperBound);
  const actualDelta = clamp(delta, lowerBound - currentMin, upperBound - currentMax);
  if (Math.abs(actualDelta) <= EPSILON) return false;
  keys.forEach((key) => {
    state.angleByKey.set(key, Number(state.angleByKey.get(key) || 0) + actualDelta);
  });
  return true;
};

const optimizeRingRotations = (state) => {
  let improved = false;
  getDirtyRings(state).forEach((ring) => {
    const radius = state.radiusByRing.get(ring) || 1;
    const deltaUnit = clamp(24 / Math.max(24, radius), ROTATION_DELTA_MIN, ROTATION_DELTA_MAX);
    const meta = state.ringMetaByRing.get(ring);
    const ringKeys = state.orderByRing.get(ring) || [];
    const firstSegmentDef = meta?.segmentOrder?.[0]
      ? state.segmentDefsByRing.get(ring)?.get(meta.segmentOrder[0])
      : null;
    RING_ROTATION_STEPS.forEach((step) => {
      const transaction = createLocalTransaction(state, {
        angleKeys: ringKeys,
        bodyKeys: ringKeys
      });
      const accepted = tryLocalMove(state, {
        transaction,
        mutate: () => {
          shiftAnglesForKeys({
            state,
            ring,
            keys: ringKeys,
            segmentDef: {
              start: Math.min(...(meta.segmentOrder || []).map((segmentKey) => state.segmentDefsByRing.get(ring)?.get(segmentKey)?.start || 0)),
              end: Math.max(...(meta.segmentOrder || []).map((segmentKey) => state.segmentDefsByRing.get(ring)?.get(segmentKey)?.end || 0))
            },
            delta: deltaUnit * step
          });
        },
        refresh: {
          kind: 'ringRotation',
          rings: [ring]
        }
      });
      if (accepted) improved = true;
    });

    (meta?.segmentOrder || []).forEach((segmentKey) => {
      const segmentKeys = ringKeys.filter((key) => (state.nodeByKey.get(key)?.segmentKey || 'main') === segmentKey);
      const segmentDef = state.segmentDefsByRing.get(ring)?.get(segmentKey) || firstSegmentDef;
      RING_ROTATION_STEPS.forEach((step) => {
        const transaction = createLocalTransaction(state, {
          angleKeys: segmentKeys,
          bodyKeys: segmentKeys
        });
        const accepted = tryLocalMove(state, {
          transaction,
          mutate: () => {
            shiftAnglesForKeys({
              state,
              ring,
              keys: segmentKeys,
              segmentDef,
              delta: deltaUnit * step
            });
          },
          refresh: {
            kind: 'ringRotation',
            rings: [ring]
          }
        });
        if (accepted) improved = true;
      });
    });
  });
  return improved;
};

const computeNodeAngleBounds = ({
  state,
  ring,
  key
}) => {
  const order = state.orderByRing.get(ring) || [];
  const index = order.indexOf(key);
  const node = state.nodeByKey.get(key);
  const segmentKey = node?.segmentKey || 'main';
  const segmentDef = state.segmentDefsByRing.get(ring)?.get(segmentKey);
  const segmentKeys = order.filter((candidateKey) => (state.nodeByKey.get(candidateKey)?.segmentKey || 'main') === segmentKey);
  const localIndex = segmentKeys.indexOf(key);
  const previousKey = localIndex > 0 ? segmentKeys[localIndex - 1] : '';
  const nextKey = localIndex < segmentKeys.length - 1 ? segmentKeys[localIndex + 1] : '';
  const radius = state.radiusByRing.get(ring) || 1;
  const lowerBound = previousKey
    ? Number(state.angleByKey.get(previousKey) || 0) + chordToAngle(requiredCenterDistance(state.nodeByKey.get(previousKey), node), radius)
    : Number(segmentDef?.start || 0) + chordToAngle(leadingEdgeDistance(node), radius);
  const upperBound = nextKey
    ? Number(state.angleByKey.get(nextKey) || 0) - chordToAngle(requiredCenterDistance(node, state.nodeByKey.get(nextKey)), radius)
    : Number(segmentDef?.end || 0) - chordToAngle(trailingEdgeDistance(node), radius);
  return {
    lowerBound,
    upperBound,
    segmentDef,
    index
  };
};

const optimizeNodeNudges = (state) => {
  let improved = false;
  const badNodes = getBadNodes(state);
  state.rings.forEach((ring) => {
    const radius = state.radiusByRing.get(ring) || 1;
    const deltaUnit = clamp(16 / Math.max(24, radius), NODE_NUDGE_MIN, NODE_NUDGE_MAX);
    (state.orderByRing.get(ring) || []).forEach((key) => {
      if (!badNodes.has(key)) return;
      NODE_NUDGE_STEPS.forEach((step) => {
        const transaction = createLocalTransaction(state, {
          angleKeys: [key],
          bodyKeys: [key]
        });
        const accepted = tryLocalMove(state, {
          transaction,
          mutate: () => {
          const { lowerBound, upperBound } = computeNodeAngleBounds({ state, ring, key });
          const current = Number(state.angleByKey.get(key) || 0);
          const candidate = clamp(current + deltaUnit * step, lowerBound, upperBound);
          if (Math.abs(candidate - current) <= EPSILON) return;
          state.angleByKey.set(key, candidate);
          },
          refresh: {
            kind: 'nodeNudge',
            rings: [ring],
            keys: [key]
          }
        });
        if (accepted) improved = true;
      });
    });
  });
  return improved;
};

const optimizeRingRadii = (state) => {
  let improved = false;
  getDirtyRings(state).forEach((ring) => {
    const stats = state.statsByRing.get(ring) || { averageSize: 0 };
    const delta = Math.max(4, stats.averageSize * RADIUS_ADJUST_FACTOR);
    [-delta, delta].forEach((radiusDelta) => {
      const affectedRings = state.rings.filter((candidateRing) => candidateRing >= ring);
      const bodyKeys = Array.from(collectKeysForRings(state, affectedRings));
      const transaction = createLocalTransaction(state, {
        radiusRings: affectedRings,
        bodyKeys
      });
      const accepted = tryLocalMove(state, {
        transaction,
        mutate: () => {
          state.radiusByRing.set(
            ring,
            Math.max(
              state.minimumRadiusByRing.get(ring) || RADIAL_MIN_RADIUS,
              (state.radiusByRing.get(ring) || 0) + radiusDelta
            )
          );
        },
        refresh: {
          kind: 'radiusAdjust',
          startRing: ring
        }
      });
      if (accepted) improved = true;
    });
  });
  return improved;
};

const optimizeCandidateState = (state) => {
  refreshGeometry(state, {
    mode: 'rebuild',
    scoreMode: 'exact',
    includeOverlapExpansion: true
  });
  state.initialScore = state.score ? { ...state.score } : null;
  syncProxyEvaluation(state);
  const confirmStartedAt = now();
  state.score = evaluateLayoutScore({
    bodyByKey: state.bodyByKey,
    nodeByKey: state.nodeByKey,
    graphEdges: state.graphEdges,
    layer: state.layer,
    radiusByRing: state.radiusByRing
  });
  state.timing.exactScoringStage += now() - confirmStartedAt;
  if (state.exactCache) state.exactCache.score = { ...state.score };
  return state;
};

const buildBadgeBodies = ({
  bodyByKey,
  boundaryStubs,
  layer
}) => {
  const badgeBodyByStubId = new Map();
  (Array.isArray(boundaryStubs) ? boundaryStubs : []).forEach((stub, index) => {
    const sourceKey = layer === 'sense'
      ? String(stub?.sourceVertexKey || '')
      : String(stub?.sourceNodeId || '');
    const sourceBody = bodyByKey.get(sourceKey);
    if (!sourceBody) return;
    const stubId = String(stub?.stubId || `${sourceKey}:${index}`);
    const hiddenCount = Math.max(0, Number(stub?.hiddenNeighborCount) || 0);
    if (hiddenCount < 1) return;
    const label = `+${hiddenCount}`;
    const labelWidthHint = clamp(22 + label.length * 7, 22, 54);
    const labelHeightHint = 18;
    const radius = Math.max(8, Math.hypot(labelWidthHint * 0.5, labelHeightHint * 0.5) * 0.42);
    const distance = sourceBody.radius + sourceBody.collisionRadius + radius + 10;
    const angle = Number(sourceBody.angle || 0);
    badgeBodyByStubId.set(stubId, {
      stubId,
      isStubBadge: true,
      sourceKey,
      x: sourceBody.x + Math.cos(angle) * distance,
      y: sourceBody.y + Math.sin(angle) * distance,
      radius,
      label,
      labelWidthHint,
      labelHeightHint
    });
  });
  return badgeBodyByStubId;
};

const collectBodies = (bodyByKey) => Array.from(bodyByKey.values()).map((body) => ({
  ...body,
  labelRect: body.labelRect || buildLabelRect(body)
}));

const buildInputLevelByKey = ({
  centerKey,
  levels,
  nodesByLevel
}) => {
  const levelByKey = {};
  if (centerKey) levelByKey[centerKey] = 0;
  (Array.isArray(levels) ? levels : []).forEach((level) => {
    (nodesByLevel.get(level) || []).forEach((node) => {
      if (!node?.key) return;
      levelByKey[node.key] = Number.isFinite(Number(node.level)) ? Number(node.level) : Number(level);
    });
  });
  return levelByKey;
};

const isSameOrientation = (left, right) => (
  Math.abs(Number(left?.rotation || 0) - Number(right?.rotation || 0)) <= EPSILON
  && Math.abs(Number(left?.axisAngle || 0) - Number(right?.axisAngle || 0)) <= EPSILON
);

const cloneBestState = (state) => ({
  ...state,
  orderByRing: cloneOrderByRing(state.orderByRing),
  angleByKey: new Map(state.angleByKey),
  radiusByRing: new Map(state.radiusByRing),
  statsByRing: new Map(state.statsByRing),
  minimumRadiusByRing: new Map(state.minimumRadiusByRing),
  minCapacityRadiusByRing: new Map(state.minCapacityRadiusByRing),
  segmentDefsByRing: cloneNestedMap(state.segmentDefsByRing),
  coreBodyByKey: new Map(state.coreBodyByKey),
  centerAngleByKey: new Map(state.centerAngleByKey),
  bodyByKey: new Map(Array.from(state.bodyByKey.entries()).map(([key, body]) => [key, cloneBodyEntry(body)])),
  score: state.score ? { ...state.score } : null,
  proxyScore: state.proxyScore ? { ...state.proxyScore } : null,
  initialScore: state.initialScore ? { ...state.initialScore } : null,
  bounds: state.bounds ? { ...state.bounds } : null,
  ringByKey: new Map(state.ringByKey),
  rings: state.rings.slice(),
  scheme: { ...state.scheme },
  orientation: { ...state.orientation },
  timing: state.timing ? { ...state.timing } : { exactScoringStage: 0 }
});

export const radialDagLayout = ({
  width,
  height,
  center,
  centerKey,
  layer,
  levels,
  nodesByLevel,
  graphEdges = [],
  graphMeta,
  labelMetricsByKey,
  boundaryStubs = []
}) => {
  const {
    nodeByKey,
    stableSort
  } = buildNodeMeta({
    centerKey,
    center,
    levels,
    nodesByLevel,
    graphMeta,
    labelMetricsByKey
  });

  const staticData = buildStaticLayoutData({
    nodeByKey,
    graphMeta,
    graphEdges,
    layer,
    stableSort
  });

  const inputLevelByKey = buildInputLevelByKey({
    centerKey,
    levels,
    nodesByLevel
  });

  const {
    distancesBySource,
    eccentricityByKey,
    diameter
  } = buildGraphDistances({
    nodeByKey,
    sortedKeys: staticData.sortedKeys,
    sortedNeighborsByKey: staticData.sortedNeighborsByKey
  });

  const layoutTiming = {
    candidateGeneration: 0,
    proxyStage: 0,
    finalOptimizationStage: 0,
    exactScoringStage: 0
  };

  const centerSchemes = centerKey && nodeByKey.has(centerKey)
    ? [{
      useDualCenter: false,
      c1: centerKey,
      c2: '',
      rationale: 'single-selected-center',
      signature: centerKey
    }]
    : generateCenterSchemes({
      centerKey,
      nodeByKey,
      stableSort,
      distancesBySource,
      eccentricityByKey,
      diameter
    });

  const coarseCandidates = [];
  let bestState = null;
  centerSchemes.forEach((scheme) => {
    const generationStartedAt = now();
    const centers = scheme.useDualCenter ? [scheme.c1, scheme.c2] : [scheme.c1];
    const {
      logicalRingByKey,
      preferredCenterByKey,
      maxRing
    } = buildRingAssignments({
      nodeByKey,
      sortedKeys: staticData.sortedKeys,
      sortedNeighborsByKey: staticData.sortedNeighborsByKey,
      distancesBySource,
      centers
    });

    buildRingRelationships({
      centerKey,
      nodeByKey,
      graphMeta,
      sortedKeys: staticData.sortedKeys,
      nodeIndexByKey: staticData.nodeIndexByKey,
      sortedNeighborsByKey: staticData.sortedNeighborsByKey,
      ringByKey: logicalRingByKey,
      preferredCenterByKey,
      centers
    });

    const rings = Array.from({ length: maxRing }, (_, index) => index + 1);
    const ringMetaByRing = buildRingMeta({
      rings,
      nodeByKey,
      stableSort,
      ringByKey: logicalRingByKey,
      useDualCenter: scheme.useDualCenter,
      c1: scheme.c1,
      c2: scheme.c2
    });
    const edgeBuckets = buildEdgeBuckets({
      edgeList: staticData.edgeList,
      ringByKey: logicalRingByKey,
      nodeKeySet: staticData.nodeKeySet
    });
    layoutTiming.candidateGeneration += now() - generationStartedAt;

    const coarseOrientations = buildOrientationCandidates({
      useDualCenter: scheme.useDualCenter,
      sampleCount: scheme.useDualCenter ? DUAL_ROTATION_SAMPLES_COARSE : SINGLE_ROTATION_SAMPLES_COARSE
    });
    coarseOrientations.forEach((orientation) => {
      const proxyStartedAt = now();
      const state = createInitialState({
        center,
        centerKey,
        layer,
        graphEdges,
        graphMeta,
        nodeByKey,
        stableSort,
        sortedKeys: staticData.sortedKeys,
        sortedNeighborsByKey: staticData.sortedNeighborsByKey,
        nodeIndexByKey: staticData.nodeIndexByKey,
        edgeBuckets,
        edgeList: staticData.edgeList,
        incidentEdgeIndexesByKey: staticData.incidentEdgeIndexesByKey,
        scheme,
        orientation,
        ringByKey: logicalRingByKey,
        ringMetaByRing,
        rings
      });
      layoutTiming.proxyStage += now() - proxyStartedAt;
      coarseCandidates.push({
        state,
        scheme,
        orientation,
        ringByKey: logicalRingByKey,
        ringMetaByRing,
        rings,
        edgeBuckets
      });
    });
  });

  const finalistCount = coarseCandidates.length <= 1
    ? coarseCandidates.length
    : Math.min(FINALIST_LIMIT, Math.max(2, coarseCandidates.length));
  const finalists = coarseCandidates
    .slice()
    .sort((left, right) => (
      compareProxyScores(left.state.proxyScore, right.state.proxyScore)
      || stableSort(left.scheme.c1, right.scheme.c1)
    ))
    .slice(0, finalistCount);

  finalists.forEach((seed) => {
    const fineOrientationCandidates = buildFineOrientationCandidates({
      useDualCenter: seed.scheme.useDualCenter,
      orientation: seed.orientation
    }).slice(0, FINE_TUNE_LIMIT);
    const testedOrientations = [];
    fineOrientationCandidates.forEach((orientation) => {
      if (testedOrientations.some((candidate) => isSameOrientation(candidate, orientation))) return;
      testedOrientations.push(orientation);
      const state = isSameOrientation(seed.orientation, orientation)
        ? seed.state
        : createInitialState({
          center,
          centerKey,
          layer,
          graphEdges,
          graphMeta,
          nodeByKey,
          stableSort,
          sortedKeys: staticData.sortedKeys,
          sortedNeighborsByKey: staticData.sortedNeighborsByKey,
          nodeIndexByKey: staticData.nodeIndexByKey,
          edgeBuckets: seed.edgeBuckets,
          edgeList: staticData.edgeList,
          incidentEdgeIndexesByKey: staticData.incidentEdgeIndexesByKey,
          scheme: seed.scheme,
          orientation,
          ringByKey: seed.ringByKey,
          ringMetaByRing: seed.ringMetaByRing,
          rings: seed.rings
        });

      const optimizationStartedAt = now();
      optimizeCandidateState(state);
      layoutTiming.finalOptimizationStage += now() - optimizationStartedAt;
      layoutTiming.exactScoringStage += Number(state.timing?.exactScoringStage || 0);

      if (!bestState || compareScores(state.score, bestState.score) < 0) {
        bestState = cloneBestState(state);
      }
    });
  });

  if (!bestState) {
    return {
      levelByKey: {},
      bodyByKey: new Map(),
      badgeBodyByStubId: new Map(),
      bounds: { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 },
      geometryCenter: {
        x: Number(center?.x || 0),
        y: Number(center?.y || 0)
      },
      debug: {
        sectorPlan: {
          kind: 'radial-dag',
          mode: 'empty'
        }
      }
    };
  }

  const bodies = collectBodies(bestState.bodyByKey);
  const badgeBodyByStubId = buildBadgeBodies({
    bodyByKey: bestState.bodyByKey,
    boundaryStubs,
    layer
  });

  return {
    levelByKey: inputLevelByKey,
    bodyByKey: bestState.bodyByKey,
    badgeBodyByStubId,
    bounds: bestState.bounds || buildContentBounds(bodies),
    geometryCenter: {
      x: Number(center?.x || 0),
      y: Number(center?.y || 0)
    },
    debug: {
      sectorPlan: {
        kind: 'radial-dag',
        mode: bestState.scheme.useDualCenter ? 'dual-center' : 'single-center',
        c1: bestState.scheme.c1,
        c2: bestState.scheme.c2,
        selectedCenterKey: centerKey,
        rationale: bestState.scheme.rationale,
        rotation: Number(bestState.orientation.rotation || 0),
        axisAngle: Number(bestState.orientation.axisAngle || 0),
        proxyCrossings: Number(bestState.proxyCrossings || 0),
        proxyScore: bestState.proxyScore,
        initialScore: bestState.initialScore,
        finalScore: bestState.score,
        timing: {
          candidateGeneration: layoutTiming.candidateGeneration,
          proxyStage: layoutTiming.proxyStage,
          finalOptimizationStage: layoutTiming.finalOptimizationStage,
          exactScoringStage: layoutTiming.exactScoringStage
        },
        densityK: RADIAL_DENSITY_K,
        canvas: {
          width: Number(width || 0),
          height: Number(height || 0)
        },
        levels: [0, ...bestState.rings].map((ring) => ({
          level: ring,
          count: ring === 0
            ? (bestState.scheme.useDualCenter ? 2 : 1)
            : (bestState.orderByRing.get(ring) || []).length,
          radius: ring === 0 ? 0 : (bestState.radiusByRing.get(ring) || 0)
        }))
      }
    }
  };
};
