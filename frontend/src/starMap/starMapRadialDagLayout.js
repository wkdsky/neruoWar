const TAU = Math.PI * 2;
const EPSILON = 0.0001;

const GRID_CELL_SIZE = 108;
const SEGMENT_GRID_SIZE = 160;
const BASE_LAYER_GAP = 96;
const BASE_NODE_GAP = 24;
const STRESS_ROUNDS = 28;
const STRESS_FINE_ROUNDS = 12;
const HUB_SPREAD_ROUNDS = 5;
const CROSSING_REFINEMENT_ROUNDS = 6;
const OVERLAP_ROUNDS = 10;
const COMPACTION_ROUNDS = 3;
const CLEARANCE_ROUNDS = 12;
const EDGE_SHORTEN_ROUNDS = 6;
const COUPLED_REPAIR_MAX_ROUNDS = 8;
const ADJACENT_SWAP_PASSES = 3;
const PROXIMITY_NEIGHBOR_LIMIT = 5;
const COARSE_NODE_LIMIT = 18;
const MAX_COARSE_STEP = 22;
const MAX_FINE_STEP = 12;

const now = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const stableTextCompare = (left = '', right = '') => (
  String(left || '').localeCompare(String(right || ''), 'zh-Hans-CN')
);

const distanceBetweenPoints = (left, right) => Math.hypot(
  (Number(left?.x) || 0) - (Number(right?.x) || 0),
  (Number(left?.y) || 0) - (Number(right?.y) || 0)
);

const normalize = (x = 0, y = 0, fallback = { x: 1, y: 0 }) => {
  const length = Math.hypot(x, y);
  if (length <= EPSILON) return { x: fallback.x, y: fallback.y };
  return { x: x / length, y: y / length };
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

const expandRect = (rect, padding = 0) => buildRectFromValues({
  left: rect.left - padding,
  right: rect.right + padding,
  top: rect.top - padding,
  bottom: rect.bottom + padding
});

const buildLabelRect = (body) => {
  const width = Number(body.labelWidthHint || body.labelMetrics?.widthHint) || 112;
  const height = Number(body.labelHeightHint || body.labelMetrics?.heightHint) || 28;
  const offsetY = Number(body.labelOffsetY || 0);
  return buildRectFromValues({
    left: body.x - width * 0.5,
    right: body.x + width * 0.5,
    top: body.y - height * 0.5 + offsetY,
    bottom: body.y + height * 0.5 + offsetY
  });
};

const buildNodeRect = (body, padding = 0) => buildRectFromValues({
  left: body.x - (body.collisionRadius || body.radius || 0) - padding,
  right: body.x + (body.collisionRadius || body.radius || 0) + padding,
  top: body.y - (body.collisionRadius || body.radius || 0) - padding,
  bottom: body.y + (body.collisionRadius || body.radius || 0) + padding
});

const buildBodyBoundsRect = (body, padding = 0) => {
  const nodeRect = buildNodeRect(body, padding);
  const labelRect = body.labelRect || buildLabelRect(body);
  return buildRectFromValues({
    left: Math.min(nodeRect.left, labelRect.left - padding),
    right: Math.max(nodeRect.right, labelRect.right + padding),
    top: Math.min(nodeRect.top, labelRect.top - padding),
    bottom: Math.max(nodeRect.bottom, labelRect.bottom + padding)
  });
};

const rectsOverlap = (left, right, padding = 0) => (
  left.left < right.right + padding
  && left.right > right.left - padding
  && left.top < right.bottom + padding
  && left.bottom > right.top - padding
);

const pointToRectDistance = (point, rect) => {
  const dx = point.x < rect.left
    ? rect.left - point.x
    : point.x > rect.right
      ? point.x - rect.right
      : 0;
  const dy = point.y < rect.top
    ? rect.top - point.y
    : point.y > rect.bottom
      ? point.y - rect.bottom
      : 0;
  return Math.hypot(dx, dy);
};

const orientation = (a, b, c) => (
  ((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x))
);

const onSegment = (a, b, p) => (
  p.x >= Math.min(a.x, b.x) - EPSILON
  && p.x <= Math.max(a.x, b.x) + EPSILON
  && p.y >= Math.min(a.y, b.y) - EPSILON
  && p.y <= Math.max(a.y, b.y) + EPSILON
);

const segmentsIntersect = (a1, a2, b1, b2) => {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if ((((o1 > EPSILON) && (o2 < -EPSILON)) || ((o1 < -EPSILON) && (o2 > EPSILON)))
    && (((o3 > EPSILON) && (o4 < -EPSILON)) || ((o3 < -EPSILON) && (o4 > EPSILON)))) {
    return true;
  }

  if (Math.abs(o1) <= EPSILON && onSegment(a1, a2, b1)) return true;
  if (Math.abs(o2) <= EPSILON && onSegment(a1, a2, b2)) return true;
  if (Math.abs(o3) <= EPSILON && onSegment(b1, b2, a1)) return true;
  if (Math.abs(o4) <= EPSILON && onSegment(b1, b2, a2)) return true;
  return false;
};

const distancePointToSegment = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= EPSILON) {
    return {
      distance: Math.hypot(point.x - start.x, point.y - start.y),
      projection: 0
    };
  }
  const projection = clamp(
    (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / lengthSq,
    0,
    1
  );
  const projectedX = start.x + dx * projection;
  const projectedY = start.y + dy * projection;
  return {
    distance: Math.hypot(point.x - projectedX, point.y - projectedY),
    projection,
    projectedX,
    projectedY
  };
};

const distanceSegmentToRect = (start, end, rect) => {
  if (
    pointToRectDistance(start, rect) <= EPSILON
    || pointToRectDistance(end, rect) <= EPSILON
    || segmentsIntersect(start, end, { x: rect.left, y: rect.top }, { x: rect.right, y: rect.top })
    || segmentsIntersect(start, end, { x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom })
    || segmentsIntersect(start, end, { x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom })
    || segmentsIntersect(start, end, { x: rect.left, y: rect.bottom }, { x: rect.left, y: rect.top })
  ) {
    return { distance: 0 };
  }

  const cornerDistances = [
    distancePointToSegment({ x: rect.left, y: rect.top }, start, end).distance,
    distancePointToSegment({ x: rect.right, y: rect.top }, start, end).distance,
    distancePointToSegment({ x: rect.right, y: rect.bottom }, start, end).distance,
    distancePointToSegment({ x: rect.left, y: rect.bottom }, start, end).distance,
    pointToRectDistance(start, rect),
    pointToRectDistance(end, rect)
  ];
  return {
    distance: Math.min(...cornerDistances)
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
    const rect = buildBodyBoundsRect(body);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  });

  return buildRectFromValues({ left, right, top, bottom });
};

const buildEdgeKeys = (edge = {}, layer = 'title') => ({
  fromKey: layer === 'sense'
    ? String(edge?.fromVertexKey || '')
    : String(edge?.nodeAId || ''),
  toKey: layer === 'sense'
    ? String(edge?.toVertexKey || '')
    : String(edge?.nodeBId || '')
});

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
  (Array.isArray(levels) ? levels : []).forEach((level) => {
    (nodesByLevel.get(level) || []).forEach((node) => {
      const labelMetrics = labelMetricsByKey.get(node.key) || node.labelMetrics || {};
      const radius = Number(node.radius || 0);
      const labelWidthHint = Number(labelMetrics.widthHint || node.labelWidthHint) || 94;
      const labelHeightHint = Number(labelMetrics.heightHint || node.labelHeightHint) || 28;
      const boxWidth = Math.max(radius * 2, labelWidthHint);
      const boxHeight = Math.max(radius * 2, labelHeightHint);
      const collisionRadius = Math.max(
        radius,
        Math.hypot(boxWidth * 0.5, boxHeight * 0.5) * 0.88
      );
      nodeByKey.set(node.key, {
        ...node,
        key: node.key,
        level: Number.isFinite(Number(node.level)) ? Number(node.level) : Number(level),
        rawNode: node.rawNode || graphMeta.nodeByKey.get(node.key) || null,
        labelMetrics,
        labelWidthHint,
        labelHeightHint,
        radius,
        boxWidth,
        boxHeight,
        collisionRadius,
        degree: graphMeta.adjacency.get(node.key)?.size || 0,
        importance: 1,
        primaryParentKey: '',
        clusterSignature: '',
        childCount: 0,
        siblingIndex: 0,
        siblingCount: 1,
        subtreeWeight: 1
      });
    });
  });

  if (centerKey && !nodeByKey.has(centerKey)) {
    const labelMetrics = labelMetricsByKey.get(centerKey) || center?.labelMetrics || {};
    const radius = Number(center?.radius || 0);
    const labelWidthHint = Number(labelMetrics.widthHint || center?.labelWidthHint) || 94;
    const labelHeightHint = Number(labelMetrics.heightHint || center?.labelHeightHint) || 28;
    nodeByKey.set(centerKey, {
      key: centerKey,
      level: 0,
      rawNode: center?.rawNode || graphMeta.nodeByKey.get(centerKey) || null,
      labelMetrics,
      labelWidthHint,
      labelHeightHint,
      radius,
      boxWidth: Math.max(radius * 2, labelWidthHint),
      boxHeight: Math.max(radius * 2, labelHeightHint),
      collisionRadius: Math.max(radius, Math.hypot(labelWidthHint * 0.5, labelHeightHint * 0.5) * 0.88),
      degree: graphMeta.adjacency.get(centerKey)?.size || 0,
      labelOffsetY: 0,
      labelPlacement: 'center',
      nodeType: 'center',
      importance: 1.42,
      primaryParentKey: '',
      clusterSignature: centerKey,
      childCount: 0,
      siblingIndex: 0,
      siblingCount: 1,
      subtreeWeight: 1
    });
  }

  const maxDegree = Math.max(1, ...Array.from(nodeByKey.values()).map((node) => node.degree || 0));
  const maxBoundary = Math.max(1, ...Array.from(nodeByKey.keys()).map((key) => graphMeta.boundaryCountByKey.get(key) || 0));
  const maxLevel = Math.max(1, ...Array.from(nodeByKey.values()).map((node) => Number(node.level) || 0));

  nodeByKey.forEach((node) => {
    const levelNorm = 1 - (Math.min(maxLevel, Math.max(0, Number(node.level) || 0)) / Math.max(1, maxLevel));
    const degreeNorm = (node.degree || 0) / maxDegree;
    const boundaryNorm = (graphMeta.boundaryCountByKey.get(node.key) || 0) / maxBoundary;
    node.importance = clamp(
      0.92
      + degreeNorm * 0.48
      + levelNorm * 0.24
      + boundaryNorm * 0.18
      + (node.key === centerKey ? 0.26 : 0),
      0.92,
      1.88
    );
  });

  return {
    nodeByKey,
    stableSort: buildStableNodeSort(nodeByKey)
  };
};

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

const buildUniqueGraphEdges = ({
  graphEdges = [],
  layer,
  nodeByKey,
  stableSort
}) => {
  const edgeKeySet = new Set();
  const edgeList = [];

  (Array.isArray(graphEdges) ? graphEdges : []).forEach((edge) => {
    const { fromKey, toKey } = buildEdgeKeys(edge, layer);
    if (!fromKey || !toKey || fromKey === toKey) return;
    if (!nodeByKey.has(fromKey) || !nodeByKey.has(toKey)) return;
    const left = stableSort(fromKey, toKey) <= 0 ? fromKey : toKey;
    const right = left === fromKey ? toKey : fromKey;
    const pairKey = `${left}|${right}`;
    if (edgeKeySet.has(pairKey)) return;
    edgeKeySet.add(pairKey);
    edgeList.push({
      pairKey,
      fromKey: left,
      toKey: right
    });
  });

  return edgeList;
};

const buildDirectedSkeleton = ({
  centerKey,
  nodeByKey,
  edgeList,
  inputLevelByKey,
  stableSort
}) => {
  const edgeKeySet = new Set();
  const directedEdges = [];
  const outgoing = new Map();
  const incoming = new Map();

  const ensureSet = (map, key) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = new Set();
      map.set(key, bucket);
    }
    return bucket;
  };

  edgeList.forEach((edge) => {
    const a = edge.fromKey;
    const b = edge.toKey;
    const levelA = Number(inputLevelByKey[a] || nodeByKey.get(a)?.level || 0);
    const levelB = Number(inputLevelByKey[b] || nodeByKey.get(b)?.level || 0);
    const importanceA = Number(nodeByKey.get(a)?.importance || 1);
    const importanceB = Number(nodeByKey.get(b)?.importance || 1);

    let source = a;
    let target = b;

    if (a === centerKey || b === centerKey) {
      source = a === centerKey ? a : b;
      target = source === a ? b : a;
    } else if (levelA !== levelB) {
      source = levelA < levelB ? a : b;
      target = source === a ? b : a;
    } else if (Math.abs(importanceA - importanceB) > 0.001) {
      source = importanceA >= importanceB ? a : b;
      target = source === a ? b : a;
    } else {
      source = stableSort(a, b) <= 0 ? a : b;
      target = source === a ? b : a;
    }

    const key = `${source}->${target}`;
    if (edgeKeySet.has(key)) return;
    edgeKeySet.add(key);
    directedEdges.push({ fromKey: source, toKey: target });
    ensureSet(outgoing, source).add(target);
    ensureSet(incoming, target).add(source);
  });

  nodeByKey.forEach((_, key) => {
    ensureSet(outgoing, key);
    ensureSet(incoming, key);
  });

  return {
    directedEdges,
    outgoing,
    incoming
  };
};

const buildSccMeta = ({
  nodeByKey,
  outgoing,
  stableSort
}) => {
  let nextIndex = 0;
  const indexByKey = new Map();
  const lowByKey = new Map();
  const stack = [];
  const onStack = new Set();
  const componentIdByKey = new Map();
  const components = [];

  const strongConnect = (key) => {
    indexByKey.set(key, nextIndex);
    lowByKey.set(key, nextIndex);
    nextIndex += 1;
    stack.push(key);
    onStack.add(key);

    Array.from(outgoing.get(key) || []).sort(stableSort).forEach((neighborKey) => {
      if (!indexByKey.has(neighborKey)) {
        strongConnect(neighborKey);
        lowByKey.set(key, Math.min(lowByKey.get(key), lowByKey.get(neighborKey)));
      } else if (onStack.has(neighborKey)) {
        lowByKey.set(key, Math.min(lowByKey.get(key), indexByKey.get(neighborKey)));
      }
    });

    if (lowByKey.get(key) !== indexByKey.get(key)) return;

    const members = [];
    while (stack.length > 0) {
      const memberKey = stack.pop();
      onStack.delete(memberKey);
      componentIdByKey.set(memberKey, components.length);
      members.push(memberKey);
      if (memberKey === key) break;
    }
    components.push(members.sort(stableSort));
  };

  Array.from(nodeByKey.keys()).sort(stableSort).forEach((key) => {
    if (!indexByKey.has(key)) strongConnect(key);
  });

  return {
    componentIdByKey,
    components
  };
};

const assignDenseDagLayers = ({
  centerKey,
  nodeByKey,
  stableSort,
  directedEdges,
  inputLevelByKey,
  componentIdByKey,
  components
}) => {
  const compNodeSet = new Map();
  const compPreferred = new Map();
  const compOutgoing = new Map();
  const compIncomingCount = new Map();

  const ensureSet = (map, key) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = new Set();
      map.set(key, bucket);
    }
    return bucket;
  };

  components.forEach((members, componentId) => {
    compNodeSet.set(componentId, members);
    compPreferred.set(componentId, members.reduce((best, key) => {
      const level = key === centerKey ? 0 : Number(inputLevelByKey[key] || nodeByKey.get(key)?.level || 1);
      return Math.min(best, level);
    }, Number.POSITIVE_INFINITY));
    compIncomingCount.set(componentId, 0);
  });

  directedEdges.forEach((edge) => {
    const fromComp = componentIdByKey.get(edge.fromKey);
    const toComp = componentIdByKey.get(edge.toKey);
    if (fromComp === toComp) return;
    const bucket = ensureSet(compOutgoing, fromComp);
    if (bucket.has(toComp)) return;
    bucket.add(toComp);
    compIncomingCount.set(toComp, (compIncomingCount.get(toComp) || 0) + 1);
  });

  const queue = Array.from(compIncomingCount.entries())
    .filter(([, count]) => count === 0)
    .map(([componentId]) => componentId)
    .sort((left, right) => (
      (compPreferred.get(left) || 0) - (compPreferred.get(right) || 0)
      || stableSort(compNodeSet.get(left)?.[0] || '', compNodeSet.get(right)?.[0] || '')
    ));
  const topo = [];
  while (queue.length > 0) {
    const componentId = queue.shift();
    topo.push(componentId);
    Array.from(compOutgoing.get(componentId) || []).sort((left, right) => (
      (compPreferred.get(left) || 0) - (compPreferred.get(right) || 0)
      || stableSort(compNodeSet.get(left)?.[0] || '', compNodeSet.get(right)?.[0] || '')
    )).forEach((neighborId) => {
      const nextCount = (compIncomingCount.get(neighborId) || 0) - 1;
      compIncomingCount.set(neighborId, nextCount);
      if (nextCount === 0) {
        queue.push(neighborId);
        queue.sort((left, right) => (
          (compPreferred.get(left) || 0) - (compPreferred.get(right) || 0)
          || stableSort(compNodeSet.get(left)?.[0] || '', compNodeSet.get(right)?.[0] || '')
        ));
      }
    });
  }

  const requiredLayerByComp = new Map();
  const compLayerById = new Map();
  topo.forEach((componentId) => {
    const members = compNodeSet.get(componentId) || [];
    const preferredLayer = componentId === componentIdByKey.get(centerKey)
      ? 0
      : Math.max(1, Number(compPreferred.get(componentId) || 1));
    const layer = Math.max(preferredLayer, Number(requiredLayerByComp.get(componentId) || 0));
    compLayerById.set(componentId, layer);
    Array.from(compOutgoing.get(componentId) || []).forEach((neighborId) => {
      const current = Number(requiredLayerByComp.get(neighborId) || 0);
      const fromPreferred = Number(compPreferred.get(componentId) || 0);
      const toPreferred = Number(compPreferred.get(neighborId) || 0);
      const delta = toPreferred > fromPreferred ? 1 : 0;
      requiredLayerByComp.set(neighborId, Math.max(current, layer + delta));
    });
    members.forEach((key) => {
      if (!requiredLayerByComp.has(componentId) && key === centerKey) {
        requiredLayerByComp.set(componentId, 0);
      }
    });
  });

  const provisionalLevelByKey = {};
  nodeByKey.forEach((node, key) => {
    const componentId = componentIdByKey.get(key);
    const compLayer = Number(compLayerById.get(componentId) || 0);
    const inputLevel = key === centerKey ? 0 : Math.max(1, Number(inputLevelByKey[key] || node.level || 1));
    provisionalLevelByKey[key] = key === centerKey
      ? 0
      : Math.max(compLayer, inputLevel);
  });

  const normalizedLevels = Array.from(new Set(Object.values(provisionalLevelByKey).map((value) => Number(value) || 0)))
    .sort((left, right) => left - right);
  const normalizedIndexByValue = new Map(normalizedLevels.map((value, index) => [value, index]));

  const levelByKey = {};
  Object.entries(provisionalLevelByKey).forEach(([key, rawLevel]) => {
    levelByKey[key] = normalizedIndexByValue.get(rawLevel) || 0;
  });

  return {
    levelByKey,
    componentIdByKey
  };
};

const buildLayerOrdering = ({
  centerKey,
  nodeByKey,
  stableSort,
  directedEdges,
  levelByKey
}) => {
  const layerKeys = new Map();
  const predecessors = new Map();
  const successors = new Map();

  const ensureArray = (map, key) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
    }
    return bucket;
  };

  const sortedKeys = Array.from(nodeByKey.keys()).sort(stableSort);
  sortedKeys.forEach((key) => {
    const level = Number(levelByKey[key] || 0);
    ensureArray(layerKeys, level).push(key);
    ensureArray(predecessors, key);
    ensureArray(successors, key);
  });

  directedEdges.forEach((edge) => {
    const fromLevel = Number(levelByKey[edge.fromKey] || 0);
    const toLevel = Number(levelByKey[edge.toKey] || 0);
    if (toLevel < fromLevel) return;
    predecessors.get(edge.toKey)?.push(edge.fromKey);
    successors.get(edge.fromKey)?.push(edge.toKey);
  });

  layerKeys.forEach((keys, level) => {
    keys.sort((left, right) => {
      const leftNode = nodeByKey.get(left);
      const rightNode = nodeByKey.get(right);
      return (
        Number(rightNode?.importance || 0) - Number(leftNode?.importance || 0)
        || Number(rightNode?.degree || 0) - Number(leftNode?.degree || 0)
        || stableSort(left, right)
      );
    });
    if (level === 0 && centerKey && keys.includes(centerKey)) {
      keys.sort((left, right) => (
        left === centerKey ? -1 : right === centerKey ? 1 : stableSort(left, right)
      ));
    }
  });

  const buildOrderIndex = () => {
    const indexByKey = new Map();
    layerKeys.forEach((keys) => {
      keys.forEach((key, index) => {
        indexByKey.set(key, index);
      });
    });
    return indexByKey;
  };

  const computeReference = (key, refKeys, indexByKey) => {
    const references = (refKeys || []).map((refKey) => indexByKey.get(refKey)).filter(Number.isFinite);
    if (references.length < 1) return null;
    return references.reduce((sum, value) => sum + value, 0) / references.length;
  };

  for (let round = 0; round < 4; round += 1) {
    let indexByKey = buildOrderIndex();
    Array.from(layerKeys.keys()).sort((left, right) => left - right).forEach((level) => {
      if (level === 0) return;
      const keys = (layerKeys.get(level) || []).slice();
      keys.sort((left, right) => {
        const leftRef = computeReference(left, predecessors.get(left), indexByKey);
        const rightRef = computeReference(right, predecessors.get(right), indexByKey);
        return (
          (leftRef ?? Number(indexByKey.get(left) || 0)) - (rightRef ?? Number(indexByKey.get(right) || 0))
          || Number(nodeByKey.get(right)?.importance || 0) - Number(nodeByKey.get(left)?.importance || 0)
          || stableSort(left, right)
        );
      });
      layerKeys.set(level, keys);
    });

    indexByKey = buildOrderIndex();
    Array.from(layerKeys.keys()).sort((left, right) => right - left).forEach((level) => {
      if (level === 0) return;
      const keys = (layerKeys.get(level) || []).slice();
      keys.sort((left, right) => {
        const leftRef = computeReference(left, successors.get(left), indexByKey);
        const rightRef = computeReference(right, successors.get(right), indexByKey);
        return (
          (leftRef ?? Number(indexByKey.get(left) || 0)) - (rightRef ?? Number(indexByKey.get(right) || 0))
          || Number(nodeByKey.get(right)?.importance || 0) - Number(nodeByKey.get(left)?.importance || 0)
          || stableSort(left, right)
        );
      });
      layerKeys.set(level, keys);
    });
  }

  const orderIndexByKey = new Map();
  layerKeys.forEach((keys) => {
    keys.forEach((key, index) => {
      orderIndexByKey.set(key, index);
    });
  });

  return {
    layerKeys,
    orderIndexByKey,
    predecessors,
    successors
  };
};

const buildPrimaryTreeMeta = ({
  centerKey,
  nodeByKey,
  stableSort,
  levelByKey,
  orderIndexByKey,
  predecessors,
  componentIdByKey
}) => {
  const childrenByParent = new Map();
  const primaryParentByKey = new Map();

  const ensureArray = (map, key) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
    }
    return bucket;
  };

  const sortedKeys = Array.from(nodeByKey.keys()).sort((left, right) => (
    Number(levelByKey[left] || 0) - Number(levelByKey[right] || 0)
    || Number(orderIndexByKey.get(left) || 0) - Number(orderIndexByKey.get(right) || 0)
    || stableSort(left, right)
  ));

  sortedKeys.forEach((key) => {
    if (key === centerKey) {
      primaryParentByKey.set(key, '');
      return;
    }

    const level = Number(levelByKey[key] || 0);
    const candidateParents = (predecessors.get(key) || [])
      .filter((parentKey) => Number(levelByKey[parentKey] || 0) <= level)
      .slice()
      .sort((left, right) => {
        const leftLevel = Number(levelByKey[left] || 0);
        const rightLevel = Number(levelByKey[right] || 0);
        const leftGap = Math.abs(level - leftLevel);
        const rightGap = Math.abs(level - rightLevel);
        const leftOrderGap = Math.abs((orderIndexByKey.get(key) || 0) - (orderIndexByKey.get(left) || 0));
        const rightOrderGap = Math.abs((orderIndexByKey.get(key) || 0) - (orderIndexByKey.get(right) || 0));
        return (
          leftGap - rightGap
          || leftOrderGap - rightOrderGap
          || Number(nodeByKey.get(right)?.importance || 0) - Number(nodeByKey.get(left)?.importance || 0)
          || stableSort(left, right)
        );
      });

    const primaryParentKey = candidateParents[0] || '';
    primaryParentByKey.set(key, primaryParentKey);
    if (primaryParentKey) ensureArray(childrenByParent, primaryParentKey).push(key);
  });

  const siblingOrderByParent = new Map();
  childrenByParent.forEach((children, parentKey) => {
    const ordered = children.slice().sort((left, right) => (
      Number(levelByKey[left] || 0) - Number(levelByKey[right] || 0)
      || Number(orderIndexByKey.get(left) || 0) - Number(orderIndexByKey.get(right) || 0)
      || stableSort(left, right)
    ));
    siblingOrderByParent.set(parentKey, ordered);
  });

  const rootByKey = new Map();
  const resolveRoot = (key) => {
    if (rootByKey.has(key)) return rootByKey.get(key);
    const parentKey = primaryParentByKey.get(key);
    if (!parentKey || parentKey === centerKey || key === centerKey) {
      const root = key === centerKey ? centerKey : (parentKey || key);
      rootByKey.set(key, root);
      return root;
    }
    const root = resolveRoot(parentKey);
    rootByKey.set(key, root);
    return root;
  };

  sortedKeys.forEach((key) => {
    resolveRoot(key);
  });

  const reversedKeys = sortedKeys.slice().sort((left, right) => (
    Number(levelByKey[right] || 0) - Number(levelByKey[left] || 0)
    || stableSort(left, right)
  ));
  const subtreeWeightByKey = new Map();
  reversedKeys.forEach((key) => {
    const children = childrenByParent.get(key) || [];
    const subtotal = children.reduce((sum, childKey) => sum + (subtreeWeightByKey.get(childKey) || 1), 0);
    subtreeWeightByKey.set(key, 1 + subtotal);
  });

  nodeByKey.forEach((node, key) => {
    node.primaryParentKey = primaryParentByKey.get(key) || '';
    node.clusterSignature = key === centerKey
      ? centerKey
      : (rootByKey.get(key) || componentIdByKey.get(key) || key).toString();
    node.childCount = (childrenByParent.get(key) || []).length;
    node.subtreeWeight = subtreeWeightByKey.get(key) || 1;
  });

  siblingOrderByParent.forEach((children) => {
    children.forEach((key, index) => {
      const node = nodeByKey.get(key);
      if (!node) return;
      node.siblingIndex = index;
      node.siblingCount = children.length;
    });
  });

  return {
    primaryParentByKey,
    childrenByParent,
    siblingOrderByParent,
    subtreeWeightByKey
  };
};

const buildLayoutBody = ({
  node,
  x,
  y,
  center
}) => {
  const body = {
    key: node.key,
    nodeKey: node.key,
    level: Number(node.level || 0),
    x,
    y,
    seedX: x,
    seedY: y,
    radius: Number(node.radius || 0),
    collisionRadius: Number(node.collisionRadius || node.radius || 0),
    labelWidthHint: Number(node.labelWidthHint || node.labelMetrics?.widthHint || 94),
    labelHeightHint: Number(node.labelHeightHint || node.labelMetrics?.heightHint || 28),
    labelOffsetY: Number(node.labelOffsetY || 0),
    labelPlacement: node.labelPlacement || 'center',
    labelMetrics: node.labelMetrics || {},
    degree: node.degree || 0,
    childCount: node.childCount || 0,
    importance: node.importance || 1,
    siblingIndex: node.siblingIndex || 0,
    siblingCount: node.siblingCount || 1,
    clusterSignature: node.clusterSignature || node.key,
    primaryParentKey: node.primaryParentKey || '',
    subtreeWeight: node.subtreeWeight || 1
  };
  body.labelRect = buildLabelRect(body);
  body.angle = Math.atan2(body.y - center.y, body.x - center.x);
  body.stubAngle = body.angle;
  return body;
};

const cloneLayoutBody = ({
  node,
  body,
  center
}) => {
  const cloned = buildLayoutBody({
    node,
    x: Number(body?.x || 0),
    y: Number(body?.y || 0),
    center
  });
  cloned.seedX = Number(body?.seedX ?? cloned.x);
  cloned.seedY = Number(body?.seedY ?? cloned.y);
  return cloned;
};

const buildNodeSpacingHint = (node = {}) => ({
  x: clamp(
    Math.max(
      (Number(node.collisionRadius || node.radius || 0) * 2.2) + 16,
      (Number(node.labelWidthHint || 94) * 0.92)
    ),
    44,
    148
  ),
  y: clamp(
    Math.max(
      (Number(node.collisionRadius || node.radius || 0) * 1.8) + 14,
      (Number(node.labelHeightHint || 28) * 1.4) + 12
    ),
    32,
    82
  )
});

const buildLayerKeysForNodeSet = ({
  nodeKeys,
  levelByKey,
  orderIndexByKey,
  stableSort
}) => {
  const layerKeys = new Map();
  (Array.isArray(nodeKeys) ? nodeKeys : []).forEach((key) => {
    const level = Number(levelByKey[key] || 0);
    const bucket = layerKeys.get(level) || [];
    bucket.push(key);
    layerKeys.set(level, bucket);
  });
  layerKeys.forEach((keys, level) => {
    keys.sort((left, right) => (
      Number(orderIndexByKey.get(left) || 0) - Number(orderIndexByKey.get(right) || 0)
      || stableSort(left, right)
    ));
    layerKeys.set(level, keys);
  });
  return layerKeys;
};

const buildBaseYByLevel = ({
  center,
  layerKeys,
  nodeByKey
}) => {
  const levels = Array.from(layerKeys.keys()).sort((left, right) => left - right);
  const baseYByLevel = new Map([[0, Number(center?.y || 0)]]);
  let cursor = Number(center?.y || 0);
  for (let index = 1; index < levels.length; index += 1) {
    const level = levels[index];
    const keys = layerKeys.get(level) || [];
    const averageHeight = keys.reduce((sum, key) => {
      const node = nodeByKey.get(key);
      return sum + buildNodeSpacingHint(node).y;
    }, 0) / Math.max(1, keys.length);
    cursor += clamp((averageHeight * 1.1) + 28, 68, BASE_LAYER_GAP + 16);
    baseYByLevel.set(level, cursor);
  }
  return baseYByLevel;
};

const buildCompactCandidateOffsets = (rings = 8, xBias = 0) => {
  const offsets = [{ x: 0, y: 0 }];
  for (let ring = 1; ring <= rings; ring += 1) {
    const band = [];
    for (let dx = -ring; dx <= ring; dx += 1) {
      const dy = ring - Math.abs(dx);
      band.push({ x: dx, y: dy });
      if (dy > 0) band.push({ x: dx, y: -dy });
    }
    band.sort((left, right) => (
      Math.abs(left.y) - Math.abs(right.y)
      || (xBias >= 0 ? right.x - left.x : left.x - right.x)
      || left.y - right.y
    ));
    offsets.push(...band);
  }
  return offsets;
};

const buildSpatialIndex = ({
  items = [],
  getId = (_item, index) => index,
  getRect,
  cellSize = GRID_CELL_SIZE
}) => {
  const index = {
    cellSize,
    cells: new Map(),
    itemById: new Map(),
    rectById: new Map()
  };

  const insert = (item, id, rect) => {
    index.itemById.set(id, item);
    index.rectById.set(id, rect);
    const minX = Math.floor(rect.left / cellSize);
    const maxX = Math.floor(rect.right / cellSize);
    const minY = Math.floor(rect.top / cellSize);
    const maxY = Math.floor(rect.bottom / cellSize);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const cellKey = `${x}:${y}`;
        const bucket = index.cells.get(cellKey) || [];
        bucket.push(id);
        index.cells.set(cellKey, bucket);
      }
    }
  };

  items.forEach((item, indexValue) => {
    insert(item, getId(item, indexValue), getRect(item));
  });

  return {
    ...index,
    insert
  };
};

const querySpatialIndex = (index, rect) => {
  const results = [];
  const seen = new Set();
  const minX = Math.floor(rect.left / index.cellSize);
  const maxX = Math.floor(rect.right / index.cellSize);
  const minY = Math.floor(rect.top / index.cellSize);
  const maxY = Math.floor(rect.bottom / index.cellSize);
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const bucket = index.cells.get(`${x}:${y}`) || [];
      bucket.forEach((id) => {
        if (seen.has(id)) return;
        seen.add(id);
        const item = index.itemById.get(id);
        if (item) results.push(item);
      });
    }
  }
  return results;
};

const buildSpatialHashPairs = ({
  items = [],
  getRect,
  cellSize = GRID_CELL_SIZE
}) => {
  const cells = new Map();
  const pairs = [];
  const seen = new Set();

  items.forEach((item, index) => {
    const rect = getRect(item);
    const minX = Math.floor(rect.left / cellSize);
    const maxX = Math.floor(rect.right / cellSize);
    const minY = Math.floor(rect.top / cellSize);
    const maxY = Math.floor(rect.bottom / cellSize);
    const touched = new Set();
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const cellKey = `${x}:${y}`;
        const bucket = cells.get(cellKey) || [];
        bucket.forEach((otherIndex) => {
          const leftIndex = Math.min(index, otherIndex);
          const rightIndex = Math.max(index, otherIndex);
          const pairKey = `${leftIndex}:${rightIndex}`;
          if (seen.has(pairKey)) return;
          seen.add(pairKey);
          pairs.push([items[leftIndex], items[rightIndex]]);
        });
        if (!touched.has(cellKey)) {
          bucket.push(index);
          cells.set(cellKey, bucket);
          touched.add(cellKey);
        }
      }
    }
  });

  return pairs;
};

const buildSpatialJoinPairs = ({
  leftItems = [],
  rightItems = [],
  getLeftId,
  getRightId,
  getLeftRect,
  getRightRect,
  cellSize = GRID_CELL_SIZE
}) => {
  const index = buildSpatialIndex({
    items: leftItems,
    getId: getLeftId,
    getRect: getLeftRect,
    cellSize
  });
  const pairs = [];
  const seen = new Set();
  rightItems.forEach((rightItem, indexValue) => {
    const rightId = getRightId(rightItem, indexValue);
    querySpatialIndex(index, getRightRect(rightItem)).forEach((leftItem) => {
      const leftId = getLeftId(leftItem);
      const pairKey = `${leftId}:${rightId}`;
      if (seen.has(pairKey)) return;
      seen.add(pairKey);
      pairs.push([leftItem, rightItem]);
    });
  });
  return pairs;
};

const buildBodyOverlapSeparation = (left, right, padding = 8) => {
  const leftRect = buildBodyBoundsRect(left, padding);
  const rightRect = buildBodyBoundsRect(right, padding);
  if (!rectsOverlap(leftRect, rightRect)) return null;

  const overlapX = Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left);
  const overlapY = Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top);
  if (overlapX <= EPSILON || overlapY <= EPSILON) return null;

  const direction = normalize(right.x - left.x, right.y - left.y, {
    x: overlapX <= overlapY ? 1 : 0,
    y: overlapY < overlapX ? 1 : 0
  });
  const magnitude = Math.max(overlapX, overlapY) + 2;
  return {
    x: direction.x * magnitude,
    y: direction.y * magnitude
  };
};

const applyImpulse = (deltaByKey, key, dx, dy) => {
  const current = deltaByKey.get(key) || { x: 0, y: 0 };
  current.x += dx;
  current.y += dy;
  deltaByKey.set(key, current);
};

const applyBodyDeltas = ({
  bodyByKey,
  deltaByKey,
  lockedKeys,
  centerKey,
  maxStep
}) => {
  bodyByKey.forEach((body, key) => {
    if (lockedKeys.has(key) || key === centerKey) {
      if (key === centerKey) {
        body.x = Number(body.seedX || body.x);
        body.y = Number(body.seedY || body.y);
      }
      return;
    }
    const delta = deltaByKey.get(key);
    if (!delta) return;
    body.x += clamp(delta.x, -maxStep, maxStep);
    body.y += clamp(delta.y, -maxStep, maxStep);
  });
};

const updateBodyGeometry = ({
  bodyByKey,
  center,
  graphMeta
}) => {
  bodyByKey.forEach((body) => {
    body.labelRect = buildLabelRect(body);
    body.angle = Math.atan2(body.y - center.y, body.x - center.x);
    const neighbors = Array.from(graphMeta.adjacency.get(body.key) || []);
    const vector = neighbors.reduce((accumulator, neighborKey) => {
      const neighbor = bodyByKey.get(neighborKey);
      if (!neighbor) return accumulator;
      accumulator.x += body.x - neighbor.x;
      accumulator.y += body.y - neighbor.y;
      return accumulator;
    }, { x: 0, y: 0 });
    if (Math.hypot(vector.x, vector.y) > EPSILON) {
      body.stubAngle = Math.atan2(vector.y, vector.x);
    } else {
      body.stubAngle = body.angle;
    }
  });
};

const buildWeakAnchorPoint = ({
  key,
  center,
  centerKey,
  nodeByKey,
  bodyByKey,
  layerKeys,
  levelByKey,
  orderIndexByKey,
  primaryParentByKey,
  ownerAnchorByKey,
  baseYByLevel
}) => {
  if (key === centerKey) {
    return {
      x: Number(center?.x || 0),
      y: Number(center?.y || 0)
    };
  }

  const node = nodeByKey.get(key);
  const level = Number(levelByKey[key] || node?.level || 0);
  const levelKeys = layerKeys.get(level) || [];
  const midOrder = (levelKeys.length - 1) * 0.5;
  const orderIndex = Number(orderIndexByKey.get(key) || 0);
  const orderCentered = orderIndex - midOrder;
  const parentKey = primaryParentByKey.get(key) || '';
  const ownerKey = ownerAnchorByKey.get(key) || parentKey || centerKey;
  const parentBody = parentKey ? bodyByKey.get(parentKey) : null;
  const ownerBody = ownerKey ? bodyByKey.get(ownerKey) : null;
  const spacing = buildNodeSpacingHint(node);
  const orderX = Number(center?.x || 0) + orderCentered * spacing.x * 0.78;
  const inheritedX = parentBody ? parentBody.x : ownerBody ? ownerBody.x : orderX;
  const siblingCentered = Number(node?.siblingIndex || 0) - (((Number(node?.siblingCount || 1) - 1) * 0.5));
  let anchorY = Number(baseYByLevel.get(level) || center?.y || 0) + siblingCentered * Math.min(18, spacing.y * 0.28);
  if (parentBody) {
    anchorY = Math.max(
      anchorY,
      parentBody.y + clamp((parentBody.collisionRadius + (node?.collisionRadius || 0)) * 0.72 + 14, 22, 72)
    );
  }
  if (ownerBody && ownerBody !== parentBody) {
    anchorY = anchorY * 0.86 + (ownerBody.y + Math.max(14, spacing.y * 0.24)) * 0.14;
  }
  const importancePull = 1 - Math.min(0.22, Math.max(0, Number(node?.importance || 1) - 1) * 0.18);
  return {
    x: Number(center?.x || 0) + (((orderX * 0.54) + (inheritedX * 0.46)) - Number(center?.x || 0)) * importancePull,
    y: anchorY
  };
};

const buildCompactSeedBodies = ({
  center,
  centerKey,
  nodeByKey,
  layerKeys,
  levelByKey,
  orderIndexByKey,
  primaryParentByKey,
  ownerAnchorByKey = new Map(),
  existingBodyByKey = new Map(),
  stableSort,
  graphMeta
}) => {
  const bodyByKey = new Map();
  const baseYByLevel = buildBaseYByLevel({
    center,
    layerKeys,
    nodeByKey
  });
  const lockedExistingKeys = new Set(existingBodyByKey.keys());

  const spatialIndex = buildSpatialIndex({
    items: [],
    getId: (body) => body.key,
    getRect: (body) => buildBodyBoundsRect(body, 8),
    cellSize: GRID_CELL_SIZE
  });

  existingBodyByKey.forEach((body, key) => {
    const node = nodeByKey.get(key);
    if (!node) return;
    const cloned = cloneLayoutBody({
      node,
      body,
      center
    });
    bodyByKey.set(key, cloned);
    spatialIndex.insert(cloned, cloned.key, buildBodyBoundsRect(cloned, 8));
  });

  if (!bodyByKey.has(centerKey) && nodeByKey.has(centerKey)) {
    const centerBody = buildLayoutBody({
      node: nodeByKey.get(centerKey),
      x: Number(center?.x || 0),
      y: Number(center?.y || 0),
      center
    });
    bodyByKey.set(centerKey, centerBody);
    spatialIndex.insert(centerBody, centerBody.key, buildBodyBoundsRect(centerBody, 8));
  }

  const placementKeys = Array.from(nodeByKey.keys())
    .filter((key) => !bodyByKey.has(key))
    .sort((left, right) => (
      Number(levelByKey[left] || 0) - Number(levelByKey[right] || 0)
      || Number(nodeByKey.get(right)?.importance || 0) - Number(nodeByKey.get(left)?.importance || 0)
      || Number(orderIndexByKey.get(left) || 0) - Number(orderIndexByKey.get(right) || 0)
      || stableSort(left, right)
    ));

  placementKeys.forEach((key) => {
    const node = nodeByKey.get(key);
    if (!node) return;
    const anchor = buildWeakAnchorPoint({
      key,
      center,
      centerKey,
      nodeByKey,
      bodyByKey,
      layerKeys,
      levelByKey,
      orderIndexByKey,
      primaryParentByKey,
      ownerAnchorByKey,
      baseYByLevel
    });
    const spacing = buildNodeSpacingHint(node);
    const xBias = Number(orderIndexByKey.get(key) || 0) - (((layerKeys.get(Number(levelByKey[key] || 0)) || []).length - 1) * 0.5);
    const offsets = buildCompactCandidateOffsets(8 + Math.min(6, Number(levelByKey[key] || 0)), xBias);
    const parentKey = primaryParentByKey.get(key) || '';
    const parentBody = parentKey ? bodyByKey.get(parentKey) : null;
    const ownerKey = ownerAnchorByKey.get(key) || parentKey || centerKey;
    const ownerBody = ownerKey ? bodyByKey.get(ownerKey) : null;
    const neighborKeys = Array.from(graphMeta.adjacency.get(key) || []).filter((neighborKey) => bodyByKey.has(neighborKey));

    let bestBody = null;
    let bestScore = Number.POSITIVE_INFINITY;

    offsets.forEach((offset, offsetIndex) => {
      const candidateX = anchor.x + offset.x * spacing.x * 0.82;
      const candidateY = anchor.y + offset.y * spacing.y * 0.76;
      const candidate = buildLayoutBody({
        node,
        x: candidateX,
        y: candidateY,
        center
      });
      const candidateRect = buildBodyBoundsRect(candidate, 8);
      const nearbyBodies = querySpatialIndex(spatialIndex, candidateRect);
      let overlapPenalty = 0;
      let proximityPenalty = 0;

      nearbyBodies.forEach((otherBody) => {
        if (otherBody.key === candidate.key) return;
        const separation = buildBodyOverlapSeparation(candidate, otherBody, 4);
        if (separation) {
          overlapPenalty += Math.hypot(separation.x, separation.y);
        } else {
          proximityPenalty += Math.max(0, 18 - pointToRectDistance(candidate, buildBodyBoundsRect(otherBody, 6))) * 0.8;
        }
      });

      const edgeStretchPenalty = neighborKeys.reduce((sum, neighborKey) => {
        const neighborBody = bodyByKey.get(neighborKey);
        if (!neighborBody) return sum;
        return sum + distanceBetweenPoints(candidate, neighborBody);
      }, 0) * 0.09;

      // Penalize placement that sits on existing edges between already-placed nodes
      let edgeClearancePenalty = 0;
      nearbyBodies.forEach((otherBody) => {
        if (otherBody.key === candidate.key) return;
        const otherNeighborKeys = Array.from(graphMeta.adjacency.get(otherBody.key) || []);
        otherNeighborKeys.forEach((neighborKey) => {
          if (neighborKey === key) return;
          const neighborBody = bodyByKey.get(neighborKey);
          if (!neighborBody) return;
          const d = distancePointToSegment(candidate, otherBody, neighborBody);
          if (d.projection > 0.05 && d.projection < 0.95 && d.distance < 30) {
            edgeClearancePenalty += Math.max(0, 30 - d.distance) * 6;
          }
        });
      });

      const parentPenalty = parentBody && candidateY < parentBody.y + 10
        ? (parentBody.y + 10 - candidateY) * 16
        : 0;
      const ownerPenalty = ownerBody
        ? distanceBetweenPoints(candidate, ownerBody) * 0.04
        : 0;
      const anchorPenalty = Math.abs(candidateX - anchor.x) + Math.abs(candidateY - anchor.y);
      const lockedPenalty = lockedExistingKeys.has(ownerKey) ? 0 : 1;
      const score = overlapPenalty * 1600
        + proximityPenalty * 22
        + edgeStretchPenalty
        + edgeClearancePenalty
        + parentPenalty
        + ownerPenalty
        + anchorPenalty
        + offsetIndex * 0.01
        + lockedPenalty;

      if (score < bestScore) {
        bestScore = score;
        bestBody = candidate;
      }
    });

    if (!bestBody) {
      bestBody = buildLayoutBody({
        node,
        x: anchor.x,
        y: anchor.y,
        center
      });
    }
    bodyByKey.set(key, bestBody);
    spatialIndex.insert(bestBody, bestBody.key, buildBodyBoundsRect(bestBody, 8));
  });

  return bodyByKey;
};

const buildChildrenByParent = ({
  nodeKeys,
  primaryParentByKey,
  orderIndexByKey,
  stableSort
}) => {
  const childrenByParent = new Map();
  (Array.isArray(nodeKeys) ? nodeKeys : []).forEach((key) => {
    const parentKey = primaryParentByKey.get(key) || '';
    if (!parentKey) return;
    const bucket = childrenByParent.get(parentKey) || [];
    bucket.push(key);
    childrenByParent.set(parentKey, bucket);
  });
  childrenByParent.forEach((children, parentKey) => {
    children.sort((left, right) => (
      Number(orderIndexByKey.get(left) || 0) - Number(orderIndexByKey.get(right) || 0)
      || stableSort(left, right)
    ));
    childrenByParent.set(parentKey, children);
  });
  return childrenByParent;
};

const buildSparseLocalPairs = ({
  layerKeys,
  childrenByParent,
  nodeByKey,
  orderIndexByKey,
  stableSort
}) => {
  const pairs = [];
  const seen = new Set();
  const addPair = (leftKey, rightKey, type, weight = 1) => {
    if (!leftKey || !rightKey || leftKey === rightKey) return;
    const pairKey = stableSort(leftKey, rightKey) <= 0
      ? `${leftKey}|${rightKey}|${type}`
      : `${rightKey}|${leftKey}|${type}`;
    if (seen.has(pairKey)) return;
    seen.add(pairKey);
    const leftNode = nodeByKey.get(leftKey);
    const rightNode = nodeByKey.get(rightKey);
    pairs.push({
      leftKey,
      rightKey,
      type,
      weight,
      orderSign: Number(orderIndexByKey.get(rightKey) || 0) >= Number(orderIndexByKey.get(leftKey) || 0) ? 1 : -1,
      idealDistance: Math.max(
        (leftNode?.collisionRadius || 0) + (rightNode?.collisionRadius || 0) + (type === 'layer' ? 14 : 10),
        ((leftNode?.labelWidthHint || 0) + (rightNode?.labelWidthHint || 0)) * (type === 'layer' ? 0.34 : 0.28)
      )
    });
  };

  layerKeys.forEach((keys) => {
    for (let index = 1; index < keys.length; index += 1) {
      addPair(keys[index - 1], keys[index], 'layer', 1);
    }
    for (let index = 2; index < keys.length; index += 1) {
      addPair(keys[index - 2], keys[index], 'layer-skip', 0.42);
    }
  });

  childrenByParent.forEach((children) => {
    for (let index = 1; index < children.length; index += 1) {
      addPair(children[index - 1], children[index], 'siblings', 0.86);
    }
  });

  return pairs;
};

const buildCollapsedEdgeList = ({
  edges,
  ownerByKey,
  stableSort,
  directed = false
}) => {
  const edgeByKey = new Map();
  (Array.isArray(edges) ? edges : []).forEach((edge) => {
    const rawFrom = directed ? edge.fromKey : edge.fromKey;
    const rawTo = directed ? edge.toKey : edge.toKey;
    const fromKey = ownerByKey.get(rawFrom) || rawFrom;
    const toKey = ownerByKey.get(rawTo) || rawTo;
    if (!fromKey || !toKey || fromKey === toKey) return;
    const key = directed
      ? `${fromKey}->${toKey}`
      : (stableSort(fromKey, toKey) <= 0 ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`);
    if (!edgeByKey.has(key)) {
      edgeByKey.set(key, {
        pairKey: directed ? key : key,
        fromKey: directed ? fromKey : (stableSort(fromKey, toKey) <= 0 ? fromKey : toKey),
        toKey: directed ? toKey : (stableSort(fromKey, toKey) <= 0 ? toKey : fromKey),
        weight: 0
      });
    }
    edgeByKey.get(key).weight += Number(edge.weight || 1);
  });
  return Array.from(edgeByKey.values());
};

const buildCoarseNodeMeta = ({
  centerKey,
  nodeByKey,
  primaryParentByKey,
  levelByKey,
  orderIndexByKey,
  stableSort
}) => {
  const desiredSupportCount = Math.max(8, Math.min(COARSE_NODE_LIMIT, Math.round(Math.sqrt(nodeByKey.size) * 2.6)));
  const supportKeys = new Set(centerKey ? [centerKey] : []);
  const sortedKeys = Array.from(nodeByKey.keys()).sort((left, right) => (
    Number(levelByKey[left] || 0) - Number(levelByKey[right] || 0)
    || Number(nodeByKey.get(right)?.importance || 0) - Number(nodeByKey.get(left)?.importance || 0)
    || stableSort(left, right)
  ));

  sortedKeys.forEach((key) => {
    if (key === centerKey) return;
    const node = nodeByKey.get(key);
    const level = Number(levelByKey[key] || 0);
    if (
      level <= 1
      || Number(node?.degree || 0) >= 4
      || Number(node?.childCount || 0) > 0
      || Number(node?.importance || 1) >= 1.44
    ) {
      supportKeys.add(key);
    }
  });

  const clusterSeen = new Set(Array.from(supportKeys).map((key) => `${nodeByKey.get(key)?.clusterSignature || key}|${levelByKey[key] || 0}`));
  sortedKeys.forEach((key) => {
    if (supportKeys.size >= desiredSupportCount) return;
    const clusterKey = `${nodeByKey.get(key)?.clusterSignature || key}|${levelByKey[key] || 0}`;
    if (clusterSeen.has(clusterKey)) return;
    clusterSeen.add(clusterKey);
    supportKeys.add(key);
  });

  const ownerSupportByKey = new Map();
  const supportList = Array.from(supportKeys);
  const resolveOwner = (key) => {
    if (ownerSupportByKey.has(key)) return ownerSupportByKey.get(key);
    if (supportKeys.has(key)) {
      ownerSupportByKey.set(key, key);
      return key;
    }
    const parentKey = primaryParentByKey.get(key) || '';
    if (parentKey) {
      const owner = resolveOwner(parentKey);
      ownerSupportByKey.set(key, owner);
      return owner;
    }
    let bestKey = centerKey || supportList[0] || key;
    let bestScore = Number.POSITIVE_INFINITY;
    supportList.forEach((candidateKey) => {
      const candidateNode = nodeByKey.get(candidateKey);
      const score = (
        Math.abs(Number(levelByKey[candidateKey] || 0) - Number(levelByKey[key] || 0)) * 100
        + Math.abs(Number(orderIndexByKey.get(candidateKey) || 0) - Number(orderIndexByKey.get(key) || 0)) * 4
        - Number(candidateNode?.importance || 1) * 6
      );
      if (score < bestScore) {
        bestScore = score;
        bestKey = candidateKey;
      }
    });
    ownerSupportByKey.set(key, bestKey);
    return bestKey;
  };

  sortedKeys.forEach((key) => {
    resolveOwner(key);
  });

  const membersBySupportKey = new Map();
  ownerSupportByKey.forEach((supportKey, key) => {
    const bucket = membersBySupportKey.get(supportKey) || [];
    bucket.push(key);
    membersBySupportKey.set(supportKey, bucket);
  });

  const coarseNodeByKey = new Map();
  supportList.forEach((supportKey) => {
    const baseNode = nodeByKey.get(supportKey);
    const members = membersBySupportKey.get(supportKey) || [supportKey];
    const maxCollisionRadius = members.reduce((best, memberKey) => Math.max(best, Number(nodeByKey.get(memberKey)?.collisionRadius || 0)), 0);
    coarseNodeByKey.set(supportKey, {
      ...baseNode,
      collisionRadius: Math.max(Number(baseNode?.collisionRadius || 0), maxCollisionRadius * 0.78),
      importance: Math.min(2.24, Number(baseNode?.importance || 1) + Math.min(0.22, members.length * 0.03)),
      coarseWeight: members.length
    });
  });

  const coarsePrimaryParentByKey = new Map();
  supportList.forEach((supportKey) => {
    let cursor = primaryParentByKey.get(supportKey) || '';
    while (cursor && !supportKeys.has(cursor)) {
      cursor = primaryParentByKey.get(cursor) || '';
    }
    coarsePrimaryParentByKey.set(supportKey, cursor || '');
  });

  const coarseLevelByKey = {};
  supportList.forEach((supportKey) => {
    coarseLevelByKey[supportKey] = Number(levelByKey[supportKey] || 0);
  });
  const coarseOrderIndexByKey = new Map();
  supportList.forEach((supportKey) => {
    const members = membersBySupportKey.get(supportKey) || [supportKey];
    const averageOrder = members.reduce((sum, memberKey) => sum + Number(orderIndexByKey.get(memberKey) || 0), 0) / Math.max(1, members.length);
    coarseOrderIndexByKey.set(supportKey, averageOrder);
  });

  return {
    supportKeys: supportList,
    ownerSupportByKey,
    membersBySupportKey,
    coarseNodeByKey,
    coarsePrimaryParentByKey,
    coarseLevelByKey,
    coarseOrderIndexByKey
  };
};

const buildSegmentEntries = ({
  edgeList,
  bodyByKey
}) => edgeList
  .map((edge, index) => {
    const fromBody = bodyByKey.get(edge.fromKey);
    const toBody = bodyByKey.get(edge.toKey);
    if (!fromBody || !toBody) return null;
    const dx = toBody.x - fromBody.x;
    const dy = toBody.y - fromBody.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= EPSILON) return null;
    const dirX = dx / distance;
    const dirY = dy / distance;
    const startInset = Math.min(distance * 0.4, Math.max(2, (fromBody.collisionRadius || fromBody.radius || 0) - 2));
    const endInset = Math.min(distance * 0.4, Math.max(2, (toBody.collisionRadius || toBody.radius || 0) - 2));
    const start = {
      x: fromBody.x + dirX * startInset,
      y: fromBody.y + dirY * startInset
    };
    const end = {
      x: toBody.x - dirX * endInset,
      y: toBody.y - dirY * endInset
    };
    return {
      id: `${edge.pairKey}:${index}`,
      fromKey: edge.fromKey,
      toKey: edge.toKey,
      start,
      end,
      bbox: buildRectFromValues({
        left: Math.min(start.x, end.x),
        right: Math.max(start.x, end.x),
        top: Math.min(start.y, end.y),
        bottom: Math.max(start.y, end.y)
      })
    };
  })
  .filter(Boolean);

const buildEdgeIdealDistance = ({
  fromBody,
  toBody,
  layerDelta = 0
}) => Math.max(
  (fromBody.collisionRadius || 0) + (toBody.collisionRadius || 0) + BASE_NODE_GAP + 8,
  ((fromBody.labelWidthHint || 0) + (toBody.labelWidthHint || 0)) * 0.52,
  ((fromBody.labelHeightHint || 0) + (toBody.labelHeightHint || 0)) * 0.6,
  56 + layerDelta * 22
);

const buildEdgeWeightByPairKey = (edgeList = []) => new Map(
  edgeList.map((edge) => [edge.pairKey, Number(edge.weight || 1)])
);

const runConstrainedStressStage = ({
  center,
  centerKey,
  bodyByKey,
  edgeList,
  directedEdges,
  sparsePairs,
  levelByKey,
  orderIndexByKey,
  graphMeta,
  rounds,
  maxStep,
  edgeWeightByPairKey,
  lockedKeys
}) => {
  for (let round = 0; round < rounds; round += 1) {
    const cooling = 1 - (round / Math.max(1, rounds));
    const deltaByKey = new Map();

    edgeList.forEach((edge) => {
      const fromBody = bodyByKey.get(edge.fromKey);
      const toBody = bodyByKey.get(edge.toKey);
      if (!fromBody || !toBody) return;
      const direction = normalize(toBody.x - fromBody.x, toBody.y - fromBody.y, { x: 1, y: 0 });
      const distance = Math.max(EPSILON, distanceBetweenPoints(fromBody, toBody));
      const ideal = buildEdgeIdealDistance({
        fromBody,
        toBody,
        layerDelta: Math.abs(Number(levelByKey[edge.fromKey] || 0) - Number(levelByKey[edge.toKey] || 0))
      });
      const weight = clamp(0.82 + Math.min(1.4, (edgeWeightByPairKey.get(edge.pairKey) || 1) * 0.16), 0.82, 2.22);
      const force = (distance - ideal) * 0.11 * weight * (0.72 + cooling * 0.55);
      applyImpulse(deltaByKey, edge.fromKey, direction.x * force * 0.5, direction.y * force * 0.5);
      applyImpulse(deltaByKey, edge.toKey, -direction.x * force * 0.5, -direction.y * force * 0.5);
    });

    sparsePairs.forEach((pair) => {
      const leftBody = bodyByKey.get(pair.leftKey);
      const rightBody = bodyByKey.get(pair.rightKey);
      if (!leftBody || !rightBody) return;
      const direction = normalize(rightBody.x - leftBody.x, rightBody.y - leftBody.y, { x: 1, y: 0 });
      const distance = Math.max(EPSILON, distanceBetweenPoints(leftBody, rightBody));
      const force = (distance - pair.idealDistance) * 0.06 * Number(pair.weight || 1) * (0.7 + cooling * 0.4);
      applyImpulse(deltaByKey, pair.leftKey, direction.x * force * 0.5, direction.y * force * 0.5);
      applyImpulse(deltaByKey, pair.rightKey, -direction.x * force * 0.5, -direction.y * force * 0.5);

      const desiredXGap = Math.max(12, pair.idealDistance * 0.42);
      const actualGap = pair.orderSign >= 0
        ? rightBody.x - leftBody.x
        : leftBody.x - rightBody.x;
      const shortage = desiredXGap - actualGap;
      if (shortage > 0) {
        const push = shortage * 0.08 * Number(pair.weight || 1);
        if (pair.orderSign >= 0) {
          applyImpulse(deltaByKey, pair.leftKey, -push, 0);
          applyImpulse(deltaByKey, pair.rightKey, push, 0);
        } else {
          applyImpulse(deltaByKey, pair.leftKey, push, 0);
          applyImpulse(deltaByKey, pair.rightKey, -push, 0);
        }
      }
    });

    directedEdges.forEach((edge) => {
      const fromBody = bodyByKey.get(edge.fromKey);
      const toBody = bodyByKey.get(edge.toKey);
      if (!fromBody || !toBody) return;
      const fromLevel = Number(levelByKey[edge.fromKey] || 0);
      const toLevel = Number(levelByKey[edge.toKey] || 0);
      const levelDelta = Math.max(0, toLevel - fromLevel);
      const desiredDy = Math.max(8, 10 + levelDelta * 16);
      const dyShortage = desiredDy - (toBody.y - fromBody.y);
      if (dyShortage > 0) {
        applyImpulse(deltaByKey, edge.fromKey, 0, -dyShortage * 0.11 * cooling);
        applyImpulse(deltaByKey, edge.toKey, 0, dyShortage * 0.11 * cooling);
      }
      if (fromLevel === toLevel) {
        const orderGap = Number(orderIndexByKey.get(edge.toKey) || 0) - Number(orderIndexByKey.get(edge.fromKey) || 0);
        if (Math.abs(orderGap) > EPSILON) {
          const expectedSign = orderGap >= 0 ? 1 : -1;
          const actual = expectedSign >= 0 ? toBody.x - fromBody.x : fromBody.x - toBody.x;
          const shortage = Math.max(0, 10 - actual);
          if (shortage > 0) {
            const push = shortage * 0.08;
            applyImpulse(deltaByKey, edge.fromKey, -expectedSign * push, 0);
            applyImpulse(deltaByKey, edge.toKey, expectedSign * push, 0);
          }
        }
      }
    });

    bodyByKey.forEach((body, key) => {
      if (lockedKeys.has(key) || key === centerKey) return;
      const pull = clamp(0.025 + Math.max(0, Number(body.importance || 1) - 1) * 0.02, 0.025, 0.06);
      applyImpulse(
        deltaByKey,
        key,
        (Number(body.seedX || body.x) - body.x) * pull,
        (Number(body.seedY || body.y) - body.y) * (pull + 0.008)
      );

      const neighbors = Array.from(graphMeta.adjacency.get(key) || [])
        .map((neighborKey) => bodyByKey.get(neighborKey))
        .filter(Boolean);
      if (neighbors.length > 0) {
        const barycenter = neighbors.reduce((accumulator, neighborBody) => {
          accumulator.x += neighborBody.x;
          accumulator.y += neighborBody.y;
          return accumulator;
        }, { x: 0, y: 0 });
        barycenter.x /= neighbors.length;
        barycenter.y /= neighbors.length;
        applyImpulse(
          deltaByKey,
          key,
          (barycenter.x - body.x) * 0.035,
          (barycenter.y - body.y) * 0.028
        );
      } else {
        applyImpulse(
          deltaByKey,
          key,
          (Number(center?.x || 0) - body.x) * 0.012,
          (Number(center?.y || 0) - body.y) * 0.01
        );
      }
    });

    buildSpatialHashPairs({
      items: Array.from(bodyByKey.values()),
      cellSize: GRID_CELL_SIZE,
      getRect: (body) => buildBodyBoundsRect(body, 10)
    }).forEach(([leftBody, rightBody]) => {
      const separation = buildBodyOverlapSeparation(leftBody, rightBody, 6);
      if (!separation) return;
      const leftWeight = leftBody.key === centerKey ? 0.14 : 1 / Math.max(0.9, Number(leftBody.importance || 1));
      const rightWeight = rightBody.key === centerKey ? 0.14 : 1 / Math.max(0.9, Number(rightBody.importance || 1));
      const totalWeight = leftWeight + rightWeight;
      applyImpulse(deltaByKey, leftBody.key, -separation.x * (leftWeight / totalWeight) * 0.72, -separation.y * (leftWeight / totalWeight) * 0.72);
      applyImpulse(deltaByKey, rightBody.key, separation.x * (rightWeight / totalWeight) * 0.72, separation.y * (rightWeight / totalWeight) * 0.72);
    });

    applyBodyDeltas({
      bodyByKey,
      deltaByKey,
      lockedKeys,
      centerKey,
      maxStep
    });
    updateBodyGeometry({ bodyByKey, center, graphMeta });
  }
};

const buildProximityPairs = ({
  bodyByKey
}) => {
  const candidatePairs = buildSpatialHashPairs({
    items: Array.from(bodyByKey.values()),
    cellSize: GRID_CELL_SIZE,
    getRect: (body) => expandRect(buildBodyBoundsRect(body), 72)
  });
  const neighborEntriesByKey = new Map();
  candidatePairs.forEach(([leftBody, rightBody]) => {
    const distance = distanceBetweenPoints(leftBody, rightBody);
    const pushEntry = (sourceKey, targetBody) => {
      const bucket = neighborEntriesByKey.get(sourceKey) || [];
      bucket.push({
        targetKey: targetBody.key,
        distance
      });
      neighborEntriesByKey.set(sourceKey, bucket);
    };
    pushEntry(leftBody.key, rightBody);
    pushEntry(rightBody.key, leftBody);
  });

  const pairs = [];
  const seen = new Set();
  neighborEntriesByKey.forEach((entries, key) => {
    entries
      .sort((left, right) => left.distance - right.distance || stableTextCompare(left.targetKey, right.targetKey))
      .slice(0, PROXIMITY_NEIGHBOR_LIMIT)
      .forEach((entry) => {
        const pairKey = stableTextCompare(key, entry.targetKey) <= 0
          ? `${key}|${entry.targetKey}`
          : `${entry.targetKey}|${key}`;
        if (seen.has(pairKey)) return;
        seen.add(pairKey);
        pairs.push([key, entry.targetKey]);
      });
  });
  return pairs;
};

const runPrismOverlapRemoval = ({
  center,
  centerKey,
  bodyByKey,
  graphMeta,
  lockedKeys,
  anchorByKey
}) => {
  let overlapHits = 0;

  for (let round = 0; round < OVERLAP_ROUNDS + 6; round += 1) {
    const cooling = 1 - (Math.min(round, OVERLAP_ROUNDS) / Math.max(1, OVERLAP_ROUNDS));
    const deltaByKey = new Map();
    let roundOverlapHits = 0;

    buildProximityPairs({ bodyByKey }).forEach(([leftKey, rightKey]) => {
      const leftBody = bodyByKey.get(leftKey);
      const rightBody = bodyByKey.get(rightKey);
      const leftAnchor = anchorByKey.get(leftKey);
      const rightAnchor = anchorByKey.get(rightKey);
      if (!leftBody || !rightBody || !leftAnchor || !rightAnchor) return;
      const currentDx = rightBody.x - leftBody.x;
      const currentDy = rightBody.y - leftBody.y;
      const anchorDx = rightAnchor.x - leftAnchor.x;
      const anchorDy = rightAnchor.y - leftAnchor.y;
      applyImpulse(deltaByKey, leftKey, (anchorDx - currentDx) * 0.026, (anchorDy - currentDy) * 0.026);
      applyImpulse(deltaByKey, rightKey, (currentDx - anchorDx) * 0.026, (currentDy - anchorDy) * 0.026);
    });

    buildSpatialHashPairs({
      items: Array.from(bodyByKey.values()),
      cellSize: GRID_CELL_SIZE,
      getRect: (body) => buildBodyBoundsRect(body, 6)
    }).forEach(([leftBody, rightBody]) => {
      const separation = buildBodyOverlapSeparation(leftBody, rightBody, 2);
      if (!separation) return;
      overlapHits += 1;
      roundOverlapHits += 1;
      const leftWeight = leftBody.key === centerKey ? 0.18 : 1 / Math.max(0.9, Number(leftBody.importance || 1));
      const rightWeight = rightBody.key === centerKey ? 0.18 : 1 / Math.max(0.9, Number(rightBody.importance || 1));
      const totalWeight = leftWeight + rightWeight;
      const pushFactor = 0.78 + cooling * 0.22;
      applyImpulse(deltaByKey, leftBody.key, -separation.x * pushFactor * (leftWeight / totalWeight), -separation.y * pushFactor * (leftWeight / totalWeight));
      applyImpulse(deltaByKey, rightBody.key, separation.x * pushFactor * (rightWeight / totalWeight), separation.y * pushFactor * (rightWeight / totalWeight));
    });

    bodyByKey.forEach((body, key) => {
      if (key === centerKey || lockedKeys.has(key)) return;
      const anchor = anchorByKey.get(key);
      if (!anchor) return;
      applyImpulse(deltaByKey, key, (anchor.x - body.x) * 0.04, (anchor.y - body.y) * 0.04);
      applyImpulse(
        deltaByKey,
        key,
        (Number(center?.x || 0) - body.x) * 0.01,
        (Number(center?.y || 0) - body.y) * 0.008
      );
    });

    applyBodyDeltas({
      bodyByKey,
      deltaByKey,
      lockedKeys,
      centerKey,
      maxStep: clamp(10 * cooling + 4, 4, 10)
    });
    updateBodyGeometry({ bodyByKey, center, graphMeta });
    if (round >= 2 && roundOverlapHits < 1) break;
  }

  return overlapHits;
};

const runHardOverlapClearance = ({
  center,
  centerKey,
  bodyByKey,
  graphMeta,
  lockedKeys,
  anchorByKey
}) => {
  let overlapHits = 0;

  for (let round = 0; round < CLEARANCE_ROUNDS + 4; round += 1) {
    const deltaByKey = new Map();
    let roundHits = 0;

    buildSpatialHashPairs({
      items: Array.from(bodyByKey.values()),
      cellSize: GRID_CELL_SIZE,
      getRect: (body) => buildBodyBoundsRect(body, 2)
    }).forEach(([leftBody, rightBody]) => {
      const separation = buildBodyOverlapSeparation(leftBody, rightBody, 0);
      if (!separation) return;
      roundHits += 1;
      overlapHits += 1;
      const leftWeight = leftBody.key === centerKey ? 0.14 : 1 / Math.max(0.9, Number(leftBody.importance || 1));
      const rightWeight = rightBody.key === centerKey ? 0.14 : 1 / Math.max(0.9, Number(rightBody.importance || 1));
      const totalWeight = leftWeight + rightWeight;
      applyImpulse(deltaByKey, leftBody.key, -separation.x * 0.92 * (leftWeight / totalWeight), -separation.y * 0.92 * (leftWeight / totalWeight));
      applyImpulse(deltaByKey, rightBody.key, separation.x * 0.92 * (rightWeight / totalWeight), separation.y * 0.92 * (rightWeight / totalWeight));
    });

    if (roundHits < 1) break;

    bodyByKey.forEach((body, key) => {
      if (key === centerKey || lockedKeys.has(key)) return;
      const anchor = anchorByKey.get(key);
      if (!anchor) return;
      applyImpulse(deltaByKey, key, (anchor.x - body.x) * 0.018, (anchor.y - body.y) * 0.018);
      applyImpulse(deltaByKey, key, (Number(center?.x || 0) - body.x) * 0.008, (Number(center?.y || 0) - body.y) * 0.006);
    });

    applyBodyDeltas({
      bodyByKey,
      deltaByKey,
      lockedKeys,
      centerKey,
      maxStep: 14
    });
    updateBodyGeometry({ bodyByKey, center, graphMeta });
  }

  return overlapHits;
};

const buildNodeEdgeCandidatePairs = ({
  segments,
  bodies
}) => buildSpatialJoinPairs({
  leftItems: segments,
  rightItems: bodies,
  getLeftId: (segment) => segment.id,
  getRightId: (body) => body.key,
  getLeftRect: (segment) => expandRect(segment.bbox, 18),
  getRightRect: (body) => expandRect(buildBodyBoundsRect(body), 8),
  cellSize: SEGMENT_GRID_SIZE
});

const runHubAngleSpreading = ({
  center,
  centerKey,
  graphMeta,
  bodyByKey,
  lockedKeys
}) => {
  for (let round = 0; round < HUB_SPREAD_ROUNDS; round += 1) {
    const deltaByKey = new Map();
    bodyByKey.forEach((body, key) => {
      const neighborKeys = Array.from(graphMeta.adjacency.get(key) || []);
      if (neighborKeys.length < 2) return;
      const entries = neighborKeys
        .map((neighborKey) => {
          const neighborBody = bodyByKey.get(neighborKey);
          if (!neighborBody) return null;
          return {
            neighborKey,
            angle: Math.atan2(neighborBody.y - body.y, neighborBody.x - body.x),
            distance: distanceBetweenPoints(body, neighborBody)
          };
        })
        .filter(Boolean)
        .sort((left, right) => left.angle - right.angle);

      const minGap = clamp(TAU / Math.max(8, entries.length * 3.2), 0.16, 0.42);
      for (let index = 0; index < entries.length; index += 1) {
        const current = entries[index];
        const next = entries[(index + 1) % entries.length];
        let gap = next.angle - current.angle;
        if (index === entries.length - 1) gap += TAU;
        if (gap >= minGap) continue;
        const deficit = minGap - gap;
        const currentNeighbor = bodyByKey.get(current.neighborKey);
        const nextNeighbor = bodyByKey.get(next.neighborKey);
        if (!currentNeighbor || !nextNeighbor) continue;
        const currentDir = normalize(currentNeighbor.x - body.x, currentNeighbor.y - body.y, { x: 1, y: 0 });
        const nextDir = normalize(nextNeighbor.x - body.x, nextNeighbor.y - body.y, { x: 1, y: 0 });
        const tangentMagnitude = deficit * Math.min(14, Math.max(4, Math.min(current.distance, next.distance) * 0.1));
        applyImpulse(deltaByKey, current.neighborKey, currentDir.y * tangentMagnitude * 0.5, -currentDir.x * tangentMagnitude * 0.5);
        applyImpulse(deltaByKey, next.neighborKey, -nextDir.y * tangentMagnitude * 0.5, nextDir.x * tangentMagnitude * 0.5);
        if (key !== centerKey) {
          applyImpulse(deltaByKey, key, ((-currentDir.y + nextDir.y) * tangentMagnitude) * 0.12, ((currentDir.x - nextDir.x) * tangentMagnitude) * 0.12);
        }
      }
    });

    bodyByKey.forEach((body, key) => {
      if (key === centerKey || lockedKeys.has(key)) return;
      applyImpulse(deltaByKey, key, (Number(body.seedX || body.x) - body.x) * 0.025, (Number(body.seedY || body.y) - body.y) * 0.025);
    });

    applyBodyDeltas({
      bodyByKey,
      deltaByKey,
      lockedKeys,
      centerKey,
      maxStep: 8
    });
    updateBodyGeometry({ bodyByKey, center, graphMeta });
  }
};

const runCrossingRefinement = ({
  center,
  centerKey,
  bodyByKey,
  edgeList,
  graphMeta,
  lockedKeys
}) => {
  let crossings = 0;

  for (let round = 0; round < CROSSING_REFINEMENT_ROUNDS; round += 1) {
    const segments = buildSegmentEntries({ edgeList, bodyByKey });
    const segmentPairs = buildSpatialHashPairs({
      items: segments,
      cellSize: SEGMENT_GRID_SIZE,
      getRect: (segment) => expandRect(segment.bbox, 10)
    });
    const deltaByKey = new Map();
    let roundCrossings = 0;

    segmentPairs.forEach(([firstSegment, secondSegment]) => {
      if (
        firstSegment.fromKey === secondSegment.fromKey
        || firstSegment.fromKey === secondSegment.toKey
        || firstSegment.toKey === secondSegment.fromKey
        || firstSegment.toKey === secondSegment.toKey
      ) {
        return;
      }
      if (!segmentsIntersect(firstSegment.start, firstSegment.end, secondSegment.start, secondSegment.end)) return;
      roundCrossings += 1;

      [
        { moveKey: firstSegment.fromKey, anchorStart: secondSegment.start, anchorEnd: secondSegment.end },
        { moveKey: firstSegment.toKey, anchorStart: secondSegment.start, anchorEnd: secondSegment.end },
        { moveKey: secondSegment.fromKey, anchorStart: firstSegment.start, anchorEnd: firstSegment.end },
        { moveKey: secondSegment.toKey, anchorStart: firstSegment.start, anchorEnd: firstSegment.end }
      ]
        .sort((left, right) => (
          Number(bodyByKey.get(left.moveKey)?.importance || 1) - Number(bodyByKey.get(right.moveKey)?.importance || 1)
          || stableTextCompare(left.moveKey, right.moveKey)
        ))
        .slice(0, 2)
        .forEach(({ moveKey, anchorStart, anchorEnd }) => {
          if (moveKey === centerKey || lockedKeys.has(moveKey)) return;
          const body = bodyByKey.get(moveKey);
          if (!body) return;
          const closest = distancePointToSegment(body, anchorStart, anchorEnd);
          const direction = normalize(
            body.x - closest.projectedX,
            body.y - closest.projectedY,
            {
              x: anchorStart.y - anchorEnd.y,
              y: anchorEnd.x - anchorStart.x
            }
          );
          const magnitude = Math.max(5, Math.min(12, 6 + (1.8 - Math.min(1.8, Number(body.importance || 1))) * 4));
          applyImpulse(deltaByKey, moveKey, direction.x * magnitude, direction.y * magnitude);
        });
    });

    crossings += roundCrossings;
    if (roundCrossings < 1) break;

    applyBodyDeltas({
      bodyByKey,
      deltaByKey,
      lockedKeys,
      centerKey,
      maxStep: 9
    });
    updateBodyGeometry({ bodyByKey, center, graphMeta });
  }

  return crossings;
};

const runEdgeShorteningRefinement = ({
  center,
  centerKey,
  bodyByKey,
  edgeList,
  levelByKey,
  graphMeta,
  lockedKeys
}) => {
  for (let round = 0; round < EDGE_SHORTEN_ROUNDS; round += 1) {
    const deltaByKey = new Map();
    let actions = 0;

    edgeList
      .map((edge) => {
        const fromBody = bodyByKey.get(edge.fromKey);
        const toBody = bodyByKey.get(edge.toKey);
        if (!fromBody || !toBody) return null;
        const distance = distanceBetweenPoints(fromBody, toBody);
        const ideal = buildEdgeIdealDistance({
          fromBody,
          toBody,
          layerDelta: Math.abs(Number(levelByKey[edge.fromKey] || 0) - Number(levelByKey[edge.toKey] || 0))
        });
        return {
          edge,
          distance,
          ideal,
          excess: distance - ideal
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.excess - left.excess)
      .slice(0, Math.max(6, Math.ceil(edgeList.length * 0.5)))
      .forEach(({ edge, excess }) => {
        if (excess < 6) return;
        const fromBody = bodyByKey.get(edge.fromKey);
        const toBody = bodyByKey.get(edge.toKey);
        if (!fromBody || !toBody) return;
        const direction = normalize(toBody.x - fromBody.x, toBody.y - fromBody.y, { x: 1, y: 0 });
        const moveMagnitude = Math.min(14, excess * 0.18);
        const fromLocked = edge.fromKey === centerKey || lockedKeys.has(edge.fromKey);
        const toLocked = edge.toKey === centerKey || lockedKeys.has(edge.toKey);
        const fromLevel = Number(levelByKey[edge.fromKey] || 0);
        const toLevel = Number(levelByKey[edge.toKey] || 0);
        const desiredDy = Math.max(6, 8 + Math.max(0, toLevel - fromLevel) * 14);

        if (!fromLocked) {
          let dx = direction.x * moveMagnitude * 0.5;
          let dy = direction.y * moveMagnitude * 0.5;
          if (toBody.y - (fromBody.y + dy) < desiredDy) {
            dy = Math.max(0, (toBody.y - fromBody.y - desiredDy) * 0.45);
          }
          applyImpulse(deltaByKey, edge.fromKey, dx, dy);
        }
        if (!toLocked) {
          let dx = -direction.x * moveMagnitude * 0.5;
          let dy = -direction.y * moveMagnitude * 0.5;
          if ((toBody.y + dy) - fromBody.y < desiredDy) {
            dy = Math.min(0, (fromBody.y + desiredDy - toBody.y) * 0.45);
          }
          applyImpulse(deltaByKey, edge.toKey, dx, dy);
        }
        actions += 1;
      });

    if (actions < 1) break;

    applyBodyDeltas({
      bodyByKey,
      deltaByKey,
      lockedKeys,
      centerKey,
      maxStep: 8
    });
    updateBodyGeometry({ bodyByKey, center, graphMeta });
  }
};

const runNodeEdgeClearance = ({
  center,
  centerKey,
  bodyByKey,
  edgeList,
  graphMeta,
  lockedKeys
}) => {
  let clearanceHits = 0;

  for (let round = 0; round < CLEARANCE_ROUNDS; round += 1) {
    const segments = buildSegmentEntries({ edgeList, bodyByKey });
    const deltaByKey = new Map();
    let roundHits = 0;

    buildNodeEdgeCandidatePairs({
      segments,
      bodies: Array.from(bodyByKey.values())
    }).forEach(([segment, body]) => {
      if (
        body.key === segment.fromKey
        || body.key === segment.toKey
      ) {
        return;
      }

      const nodeRect = expandRect(buildNodeRect(body), Math.max(16, body.collisionRadius * 0.3));
      const labelRect = expandRect(body.labelRect || buildLabelRect(body), 10);
      const nodeDistance = distanceSegmentToRect(segment.start, segment.end, nodeRect).distance;
      const labelDistance = distanceSegmentToRect(segment.start, segment.end, labelRect).distance;
      const nodeViolation = Math.max(0, Math.max(16, body.collisionRadius * 0.3) - nodeDistance);
      const labelViolation = Math.max(0, 10 - labelDistance);
      if (nodeViolation <= EPSILON && labelViolation <= EPSILON) return;

      roundHits += 1;
      const focusPoint = nodeViolation >= labelViolation
        ? { x: body.x, y: body.y }
        : { x: labelRect.centerX, y: labelRect.centerY };
      const closest = distancePointToSegment(focusPoint, segment.start, segment.end);
      const direction = normalize(
        focusPoint.x - closest.projectedX,
        focusPoint.y - closest.projectedY,
        {
          x: segment.start.y - segment.end.y,
          y: segment.end.x - segment.start.x
        }
      );
      const magnitude = Math.max(nodeViolation, labelViolation) * 1.2 + 2.5;
      applyImpulse(deltaByKey, body.key, direction.x * magnitude, direction.y * magnitude);
    });

    clearanceHits += roundHits;
    if (roundHits < 1) break;

    applyBodyDeltas({
      bodyByKey,
      deltaByKey,
      lockedKeys,
      centerKey,
      maxStep: 14
    });
    updateBodyGeometry({ bodyByKey, center, graphMeta });
  }

  return clearanceHits;
};

const runCompactPacking = ({
  center,
  centerKey,
  bodyByKey,
  graphMeta,
  lockedKeys
}) => {
  for (let round = 0; round < COMPACTION_ROUNDS; round += 1) {
    const deltaByKey = new Map();
    bodyByKey.forEach((body, key) => {
      if (key === centerKey || lockedKeys.has(key)) return;
      const neighborBodies = Array.from(graphMeta.adjacency.get(key) || [])
        .map((neighborKey) => bodyByKey.get(neighborKey))
        .filter(Boolean);
      if (neighborBodies.length > 0) {
        const anchor = neighborBodies.reduce((accumulator, neighborBody) => {
          accumulator.x += neighborBody.x;
          accumulator.y += neighborBody.y;
          return accumulator;
        }, { x: 0, y: 0 });
        anchor.x /= neighborBodies.length;
        anchor.y /= neighborBodies.length;
        applyImpulse(deltaByKey, key, (anchor.x - body.x) * 0.11, (anchor.y - body.y) * 0.08);
      }
      applyImpulse(deltaByKey, key, (Number(center?.x || 0) - body.x) * 0.018, (Number(center?.y || 0) - body.y) * 0.012);
    });
    applyBodyDeltas({
      bodyByKey,
      deltaByKey,
      lockedKeys,
      centerKey,
      maxStep: 6
    });
    updateBodyGeometry({ bodyByKey, center, graphMeta });
  }
};

const runAdjacentSwapCrossingReduction = ({
  center,
  centerKey,
  bodyByKey,
  edgeList,
  layerKeys,
  graphMeta,
  lockedKeys
}) => {
  let totalSwaps = 0;

  const countLocalCrossings = (keySet) => {
    const segments = buildSegmentEntries({ edgeList, bodyByKey });
    const relevantSegments = segments.filter((seg) =>
      keySet.has(seg.fromKey) || keySet.has(seg.toKey)
    );
    let count = 0;
    relevantSegments.forEach((seg) => {
      segments.forEach((other) => {
        if (seg === other) return;
        if (
          seg.fromKey === other.fromKey || seg.fromKey === other.toKey
          || seg.toKey === other.fromKey || seg.toKey === other.toKey
        ) return;
        if (segmentsIntersect(seg.start, seg.end, other.start, other.end)) count += 1;
      });
    });
    return count;
  };

  for (let pass = 0; pass < ADJACENT_SWAP_PASSES; pass += 1) {
    let passSwaps = 0;
    const sortedLevels = Array.from(layerKeys.keys()).sort((left, right) => left - right);
    sortedLevels.forEach((level) => {
      const keys = layerKeys.get(level);
      if (!keys || keys.length < 2) return;
      for (let index = 0; index < keys.length - 1; index += 1) {
        const leftKey = keys[index];
        const rightKey = keys[index + 1];
        if (leftKey === centerKey || rightKey === centerKey) continue;
        if (lockedKeys.has(leftKey) || lockedKeys.has(rightKey)) continue;
        const leftBody = bodyByKey.get(leftKey);
        const rightBody = bodyByKey.get(rightKey);
        if (!leftBody || !rightBody) continue;
        const swapSet = new Set([leftKey, rightKey]);
        const beforeCrossings = countLocalCrossings(swapSet);
        const leftX = leftBody.x;
        const leftY = leftBody.y;
        const rightX = rightBody.x;
        const rightY = rightBody.y;
        leftBody.x = rightX;
        leftBody.y = rightY;
        rightBody.x = leftX;
        rightBody.y = leftY;
        leftBody.labelRect = buildLabelRect(leftBody);
        rightBody.labelRect = buildLabelRect(rightBody);
        const afterCrossings = countLocalCrossings(swapSet);
        if (afterCrossings < beforeCrossings) {
          keys[index] = rightKey;
          keys[index + 1] = leftKey;
          passSwaps += 1;
        } else {
          leftBody.x = leftX;
          leftBody.y = leftY;
          rightBody.x = rightX;
          rightBody.y = rightY;
          leftBody.labelRect = buildLabelRect(leftBody);
          rightBody.labelRect = buildLabelRect(rightBody);
        }
      }
    });
    totalSwaps += passSwaps;
    if (passSwaps < 1) break;
    updateBodyGeometry({ bodyByKey, center, graphMeta });
  }
  return totalSwaps;
};

const runCoupledConstraintRepair = ({
  center,
  centerKey,
  bodyByKey,
  edgeList,
  graphMeta,
  lockedKeys,
  anchorByKey
}) => {
  let prevTotal = Number.POSITIVE_INFINITY;
  for (let round = 0; round < COUPLED_REPAIR_MAX_ROUNDS; round += 1) {
    const clearanceHits = runNodeEdgeClearance({
      center,
      centerKey,
      bodyByKey,
      edgeList,
      graphMeta,
      lockedKeys
    });
    const overlapHits = runHardOverlapClearance({
      center,
      centerKey,
      bodyByKey,
      graphMeta,
      lockedKeys,
      anchorByKey
    });
    const total = clearanceHits + overlapHits;
    if (total < 1) break;
    if (round >= 4 && total >= prevTotal) {
      // Stalled — run one more aggressive overlap pass with extra padding
      buildSpatialHashPairs({
        items: Array.from(bodyByKey.values()),
        cellSize: GRID_CELL_SIZE,
        getRect: (body) => buildBodyBoundsRect(body, 4)
      }).forEach(([leftBody, rightBody]) => {
        const separation = buildBodyOverlapSeparation(leftBody, rightBody, 4);
        if (!separation) return;
        const deltaByKey = new Map();
        applyImpulse(deltaByKey, leftBody.key, -separation.x * 0.6, -separation.y * 0.6);
        applyImpulse(deltaByKey, rightBody.key, separation.x * 0.6, separation.y * 0.6);
        applyBodyDeltas({ bodyByKey, deltaByKey, lockedKeys, centerKey, maxStep: 18 });
      });
      updateBodyGeometry({ bodyByKey, center, graphMeta });
    }
    prevTotal = total;
  }
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
    const distance = sourceBody.radius + sourceBody.collisionRadius + radius + 12;
    const angle = Number((sourceBody.stubAngle ?? sourceBody.angle) || 0);
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

const countRealEdgeCrossings = ({
  edgeList,
  bodyByKey
}) => {
  const segments = buildSegmentEntries({ edgeList, bodyByKey });
  let count = 0;
  buildSpatialHashPairs({
    items: segments,
    cellSize: SEGMENT_GRID_SIZE,
    getRect: (segment) => segment.bbox
  }).forEach(([leftSegment, rightSegment]) => {
    if (
      leftSegment.fromKey === rightSegment.fromKey
      || leftSegment.fromKey === rightSegment.toKey
      || leftSegment.toKey === rightSegment.fromKey
      || leftSegment.toKey === rightSegment.toKey
    ) {
      return;
    }
    if (segmentsIntersect(leftSegment.start, leftSegment.end, rightSegment.start, rightSegment.end)) count += 1;
  });
  return count;
};

const countBodyOverlaps = (bodyByKey) => {
  let count = 0;
  buildSpatialHashPairs({
    items: Array.from(bodyByKey.values()),
    cellSize: GRID_CELL_SIZE,
    getRect: (body) => buildBodyBoundsRect(body, 4)
  }).forEach(([leftBody, rightBody]) => {
    if (buildBodyOverlapSeparation(leftBody, rightBody, 0)) count += 1;
  });
  return count;
};

const countNodeEdgeViolations = ({
  edgeList,
  bodyByKey
}) => {
  const segments = buildSegmentEntries({ edgeList, bodyByKey });
  let count = 0;
  buildNodeEdgeCandidatePairs({
    segments,
    bodies: Array.from(bodyByKey.values())
  }).forEach(([segment, body]) => {
    if (body.key === segment.fromKey || body.key === segment.toKey) return;
    const nodeRect = expandRect(buildNodeRect(body), Math.max(16, body.collisionRadius * 0.3));
    const labelRect = expandRect(body.labelRect || buildLabelRect(body), 10);
    if (
      distanceSegmentToRect(segment.start, segment.end, nodeRect).distance < Math.max(16, body.collisionRadius * 0.3) - EPSILON
      || distanceSegmentToRect(segment.start, segment.end, labelRect).distance < 10 - EPSILON
    ) {
      count += 1;
    }
  });
  return count;
};

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
  const startedAt = now();
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

  const inputLevelByKey = buildInputLevelByKey({
    centerKey,
    levels,
    nodesByLevel
  });

  const edgeList = buildUniqueGraphEdges({
    graphEdges,
    layer,
    nodeByKey,
    stableSort
  });

  if (nodeByKey.size < 1) {
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
          kind: 'constrained-dag-pack',
          mode: 'empty'
        }
      }
    };
  }

  const skeletonStartedAt = now();
  const {
    directedEdges,
    outgoing
  } = buildDirectedSkeleton({
    centerKey,
    nodeByKey,
    edgeList,
    inputLevelByKey,
    stableSort
  });
  const {
    componentIdByKey,
    components
  } = buildSccMeta({
    nodeByKey,
    outgoing,
    stableSort
  });
  const {
    levelByKey
  } = assignDenseDagLayers({
    centerKey,
    nodeByKey,
    stableSort,
    directedEdges,
    inputLevelByKey,
    componentIdByKey,
    components
  });
  nodeByKey.forEach((node, key) => {
    node.level = Number(levelByKey[key] || 0);
  });
  const {
    layerKeys,
    orderIndexByKey,
    predecessors
  } = buildLayerOrdering({
    centerKey,
    nodeByKey,
    stableSort,
    directedEdges,
    levelByKey
  });
  const primaryTreeMeta = buildPrimaryTreeMeta({
    centerKey,
    nodeByKey,
    stableSort,
    levelByKey,
    orderIndexByKey,
    predecessors,
    componentIdByKey
  });
  const normalizedLevels = Array.from(layerKeys.keys()).sort((left, right) => left - right);
  const skeletonTiming = now() - skeletonStartedAt;

  const coarseMetaStartedAt = now();
  const coarseMeta = buildCoarseNodeMeta({
    centerKey,
    nodeByKey,
    primaryParentByKey: primaryTreeMeta.primaryParentByKey,
    levelByKey,
    orderIndexByKey,
    stableSort
  });
  const coarseEdgeList = buildCollapsedEdgeList({
    edges: edgeList,
    ownerByKey: coarseMeta.ownerSupportByKey,
    stableSort
  });
  const coarseDirectedEdges = buildCollapsedEdgeList({
    edges: directedEdges,
    ownerByKey: coarseMeta.ownerSupportByKey,
    stableSort,
    directed: true
  });
  const coarseLayerKeys = buildLayerKeysForNodeSet({
    nodeKeys: coarseMeta.supportKeys,
    levelByKey: coarseMeta.coarseLevelByKey,
    orderIndexByKey: coarseMeta.coarseOrderIndexByKey,
    stableSort
  });
  const coarseChildrenByParent = buildChildrenByParent({
    nodeKeys: coarseMeta.supportKeys,
    primaryParentByKey: coarseMeta.coarsePrimaryParentByKey,
    orderIndexByKey: coarseMeta.coarseOrderIndexByKey,
    stableSort
  });
  const coarseSparsePairs = buildSparseLocalPairs({
    layerKeys: coarseLayerKeys,
    childrenByParent: coarseChildrenByParent,
    nodeByKey: coarseMeta.coarseNodeByKey,
    orderIndexByKey: coarseMeta.coarseOrderIndexByKey,
    stableSort
  });
  const hierarchyTiming = now() - coarseMetaStartedAt;

  const seedStartedAt = now();
  const coarseBodyByKey = buildCompactSeedBodies({
    center,
    centerKey,
    nodeByKey: coarseMeta.coarseNodeByKey,
    layerKeys: coarseLayerKeys,
    levelByKey: coarseMeta.coarseLevelByKey,
    orderIndexByKey: coarseMeta.coarseOrderIndexByKey,
    primaryParentByKey: coarseMeta.coarsePrimaryParentByKey,
    stableSort,
    graphMeta
  });
  updateBodyGeometry({
    bodyByKey: coarseBodyByKey,
    center,
    graphMeta
  });
  const seedTiming = now() - seedStartedAt;

  const lockedKeys = new Set(centerKey ? [centerKey] : []);
  const coarseStartedAt = now();
  runConstrainedStressStage({
    center,
    centerKey,
    bodyByKey: coarseBodyByKey,
    edgeList: coarseEdgeList,
    directedEdges: coarseDirectedEdges,
    sparsePairs: coarseSparsePairs,
    levelByKey: coarseMeta.coarseLevelByKey,
    orderIndexByKey: coarseMeta.coarseOrderIndexByKey,
    graphMeta,
    rounds: STRESS_ROUNDS,
    maxStep: MAX_COARSE_STEP,
    edgeWeightByPairKey: buildEdgeWeightByPairKey(coarseEdgeList),
    lockedKeys
  });
  const coarseTiming = now() - coarseStartedAt;

  const projectStartedAt = now();
  const fineBodyByKey = buildCompactSeedBodies({
    center,
    centerKey,
    nodeByKey,
    layerKeys,
    levelByKey,
    orderIndexByKey,
    primaryParentByKey: primaryTreeMeta.primaryParentByKey,
    ownerAnchorByKey: coarseMeta.ownerSupportByKey,
    existingBodyByKey: coarseBodyByKey,
    stableSort,
    graphMeta
  });
  updateBodyGeometry({
    bodyByKey: fineBodyByKey,
    center,
    graphMeta
  });
  const projectTiming = now() - projectStartedAt;

  const fineChildrenByParent = buildChildrenByParent({
    nodeKeys: Array.from(nodeByKey.keys()),
    primaryParentByKey: primaryTreeMeta.primaryParentByKey,
    orderIndexByKey,
    stableSort
  });
  const fineSparsePairs = buildSparseLocalPairs({
    layerKeys,
    childrenByParent: fineChildrenByParent,
    nodeByKey,
    orderIndexByKey,
    stableSort
  });

  const refineStartedAt = now();
  runConstrainedStressStage({
    center,
    centerKey,
    bodyByKey: fineBodyByKey,
    edgeList,
    directedEdges,
    sparsePairs: fineSparsePairs,
    levelByKey,
    orderIndexByKey,
    graphMeta,
    rounds: STRESS_FINE_ROUNDS,
    maxStep: MAX_FINE_STEP,
    edgeWeightByPairKey: buildEdgeWeightByPairKey(edgeList),
    lockedKeys
  });
  runHubAngleSpreading({
    center,
    centerKey,
    graphMeta,
    bodyByKey: fineBodyByKey,
    lockedKeys
  });
  // Phase A: Edge shortening BEFORE crossing refinement so shorter edges
  // produce fewer crossing opportunities.
  runEdgeShorteningRefinement({
    center,
    centerKey,
    bodyByKey: fineBodyByKey,
    edgeList,
    levelByKey,
    graphMeta,
    lockedKeys
  });
  // Phase B: Crossing refinement (local nudges).
  const crossingCount = runCrossingRefinement({
    center,
    centerKey,
    bodyByKey: fineBodyByKey,
    edgeList,
    graphMeta,
    lockedKeys
  });
  // Phase C: Global crossing reduction via adjacent swap heuristic.
  runAdjacentSwapCrossingReduction({
    center,
    centerKey,
    bodyByKey: fineBodyByKey,
    edgeList,
    layerKeys,
    levelByKey,
    graphMeta,
    lockedKeys
  });
  // Phase D: Compact packing BEFORE clearance/overlap passes so it doesn't
  // undo the hard constraint fixes.
  runCompactPacking({
    center,
    centerKey,
    bodyByKey: fineBodyByKey,
    graphMeta,
    lockedKeys
  });
  // Phase E: Initial clearance + overlap removal.
  const clearancePassHits = runNodeEdgeClearance({
    center,
    centerKey,
    bodyByKey: fineBodyByKey,
    edgeList,
    graphMeta,
    lockedKeys
  });
  const overlapAnchorByKey = new Map(Array.from(fineBodyByKey.entries()).map(([key, body]) => [key, { x: body.x, y: body.y }]));
  const overlapPassHits = runPrismOverlapRemoval({
    center,
    centerKey,
    bodyByKey: fineBodyByKey,
    graphMeta,
    lockedKeys,
    anchorByKey: overlapAnchorByKey
  });
  runHardOverlapClearance({
    center,
    centerKey,
    bodyByKey: fineBodyByKey,
    graphMeta,
    lockedKeys,
    anchorByKey: overlapAnchorByKey
  });
  // Phase F: Coupled constraint repair loop — alternate clearance and overlap
  // removal until both report zero violations, enforcing both hard constraints.
  runCoupledConstraintRepair({
    center,
    centerKey,
    bodyByKey: fineBodyByKey,
    edgeList,
    graphMeta,
    lockedKeys,
    anchorByKey: overlapAnchorByKey
  });
  updateBodyGeometry({
    bodyByKey: fineBodyByKey,
    center,
    graphMeta
  });
  const refineTiming = now() - refineStartedAt;

  const bounds = buildContentBounds(Array.from(fineBodyByKey.values()));
  const badgeBodyByStubId = buildBadgeBodies({
    bodyByKey: fineBodyByKey,
    boundaryStubs,
    layer
  });
  const actualCrossings = countRealEdgeCrossings({
    edgeList,
    bodyByKey: fineBodyByKey
  });
  const remainingOverlaps = countBodyOverlaps(fineBodyByKey);
  const nodeEdgeViolations = countNodeEdgeViolations({
    edgeList,
    bodyByKey: fineBodyByKey
  });
  const finishedAt = now();

  return {
    levelByKey,
    bodyByKey: fineBodyByKey,
    badgeBodyByStubId,
    bounds,
    geometryCenter: {
      x: Number(center?.x || 0),
      y: Number(center?.y || 0)
    },
    debug: {
      sectorPlan: {
        kind: 'constrained-dag-pack',
        mode: 'weak-layered-constrained-dag-packing',
        canvas: {
          width: Number(width || 0),
          height: Number(height || 0)
        },
        centerKey,
        metrics: {
          nodeCount: nodeByKey.size,
          edgeCount: edgeList.length,
          sccCount: components.length,
          coarseNodeCount: coarseMeta.supportKeys.length,
          levels: normalizedLevels.map((level) => ({
            level,
            count: (layerKeys.get(level) || []).length
          })),
          localCrossingNudges: crossingCount,
          realEdgeCrossings: actualCrossings,
          overlapPassHits,
          clearancePassHits,
          remainingOverlaps,
          nodeEdgeViolations
        },
        timing: {
          skeletonStage: skeletonTiming,
          hierarchyStage: hierarchyTiming,
          seedStage: seedTiming,
          coarseStage: coarseTiming,
          projectStage: projectTiming,
          refineStage: refineTiming,
          total: finishedAt - startedAt
        }
      }
    }
  };
};
