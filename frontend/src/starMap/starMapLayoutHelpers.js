import {
  STAR_MAP_LAYER,
  getStarMapCenterKey,
  getStarMapNodeKey
} from './starMapHelpers';

const TAU = Math.PI * 2;

const normalizeAngle = (angle = 0) => {
  let value = Number(angle) || 0;
  while (value <= -Math.PI) value += TAU;
  while (value > Math.PI) value -= TAU;
  return value;
};

const normalizePositiveAngle = (angle = 0) => {
  let value = Number(angle) || 0;
  while (value < 0) value += TAU;
  while (value >= TAU) value -= TAU;
  return value;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const CJK_CHAR_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const LATIN_WORD_RE = /[A-Za-z0-9]/;
const LIGHT_PUNCT_RE = /[，。！？、；：,.!?;:'"()（）【】《》「」『』·\s-]/;

const stableHash = (value = '') => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const hslToRgb = (h, s, l) => {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = clamp(s, 0, 1);
  const light = clamp(l, 0, 1);
  if (sat === 0) return [light, light, light];

  const hueToRgb = (p, q, t) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  return [
    hueToRgb(p, q, hue + 1 / 3),
    hueToRgb(p, q, hue),
    hueToRgb(p, q, hue - 1 / 3)
  ];
};

const estimateGlyphUnits = (char = '') => {
  if (!char) return 0;
  if (CJK_CHAR_RE.test(char)) return 1;
  if (LATIN_WORD_RE.test(char)) return 0.62;
  if (LIGHT_PUNCT_RE.test(char)) return 0.36;
  return 0.8;
};

const sumUnits = (chars = [], start = 0, end = chars.length) => {
  let total = 0;
  for (let index = start; index < end; index += 1) {
    total += chars[index]?.unit || 0;
  }
  return total;
};

const chooseBalancedWrap = (text = '', options = {}) => {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return {
      width: 0,
      height: 0,
      lineCount: 0
    };
  }

  const chars = Array.from(normalized).map((char) => ({
    char,
    unit: estimateGlyphUnits(char)
  }));
  const totalChars = chars.length;
  const totalUnits = sumUnits(chars);
  const minLines = Math.max(1, Number(options.minLines) || 1);
  const maxLines = Math.max(minLines, Math.min(totalChars, Number(options.maxLines) || 3));
  const charPx = Number(options.charPx) || 13;
  const lineHeight = Number(options.lineHeight) || 15;
  const paddingX = Number(options.paddingX) || 20;
  const paddingY = Number(options.paddingY) || 8;
  const minWidth = Number(options.minWidth) || 92;
  const maxWidth = Number(options.maxWidth) || 176;
  const targetAspect = Number(options.targetAspect) || 1.08;
  const maxLineUnits = Math.max(3.2, (maxWidth - paddingX) / Math.max(1, charPx));

  let best = null;
  const collectPartitions = (linesLeft, startIndex, cuts = []) => {
    if (linesLeft === 1) {
      const boundaries = cuts.concat(totalChars);
      let previous = 0;
      const lineUnits = boundaries.map((boundary) => {
        const value = sumUnits(chars, previous, boundary);
        previous = boundary;
        return value;
      });
      if (lineUnits.some((value) => value > maxLineUnits * 1.04)) return;
      const width = clamp(Math.max(...lineUnits) * charPx + paddingX, minWidth, maxWidth);
      const height = lineUnits.length * lineHeight + paddingY;
      const average = totalUnits / lineUnits.length;
      const variance = lineUnits.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / Math.max(1, lineUnits.length);
      const lastUnits = lineUnits[lineUnits.length - 1] || average;
      const lastChars = totalChars - (cuts[cuts.length - 1] || 0);
      const aspect = width / Math.max(1, height);
      const orphanPenalty = lastChars <= 2 && totalChars >= 7 ? 2.6 : 0;
      const skinnyPenalty = lastUnits < average * 0.54 ? (average * 0.54 - lastUnits) * 1.35 : 0;
      const aspectPenalty = Math.abs(Math.log(Math.max(0.42, aspect) / targetAspect)) * 2.3;
      const widthPressure = width >= maxWidth - 2 ? 0.4 : 0;
      const score = variance * 0.26 + orphanPenalty + skinnyPenalty + aspectPenalty + widthPressure + (lineUnits.length - 1) * 0.08;
      if (!best || score < best.score) {
        best = {
          width,
          height,
          lineCount: lineUnits.length,
          boundaries,
          score
        };
      }
      return;
    }

    const remainingLines = linesLeft - 1;
    const minEnd = startIndex + 1;
    const maxEnd = totalChars - remainingLines;
    for (let end = minEnd; end <= maxEnd; end += 1) {
      collectPartitions(remainingLines, end, cuts.concat(end));
    }
  };

  for (let lineCount = minLines; lineCount <= maxLines; lineCount += 1) {
    collectPartitions(lineCount, 0, []);
  }

  return best || {
    width: clamp(totalUnits * charPx + paddingX, minWidth, maxWidth),
    height: lineHeight + paddingY,
    lineCount: 1,
    boundaries: [totalChars]
  };
};

const buildWrappedLines = (text = '', boundaries = []) => {
  const chars = Array.from(String(text || '').trim());
  if (chars.length < 1) return [];
  const lines = [];
  let previous = 0;
  const normalizedBoundaries = Array.isArray(boundaries) && boundaries.length > 0
    ? boundaries
    : [chars.length];

  normalizedBoundaries.forEach((boundary) => {
    const nextBoundary = Math.max(previous + 1, Math.min(chars.length, Number(boundary) || chars.length));
    let line = chars.slice(previous, nextBoundary).join('').trim();
    previous = nextBoundary;
    if (line) {
      lines.push(line);
    }
  });

  if (previous < chars.length) {
    const tail = chars.slice(previous).join('').trim();
    if (tail) lines.push(tail);
  }

  return lines;
};

export const estimateStarMapLabelMetrics = (label = '') => {
  const normalized = String(label || '').trim();
  const lines = normalized ? normalized.split('\n').map((item) => item.trim()).filter(Boolean) : [];
  const title = lines[0] || '';
  const sense = lines.slice(1).join(' ') || '';
  const titleLength = title.length;
  const senseLength = sense.length;
  const titleBlock = chooseBalancedWrap(title, {
    minLines: 1,
    maxLines: titleLength >= 14 ? 3 : 2,
    charPx: 13.4,
    lineHeight: 15.2,
    paddingX: 18,
    paddingY: 6,
    minWidth: 94,
    maxWidth: sense ? 154 : 162,
    targetAspect: sense ? 1.18 : 1.04
  });
  const senseBlock = sense
    ? chooseBalancedWrap(sense, {
      minLines: 1,
      maxLines: senseLength >= 15 ? 2 : 1,
      charPx: 10.1,
      lineHeight: 11.8,
      paddingX: 12,
      paddingY: 4,
      minWidth: 82,
      maxWidth: 148,
      targetAspect: 1.22
    })
    : { width: 0, height: 0, lineCount: 0 };
  const widthHint = clamp(
    Math.max(titleBlock.width, senseBlock.width * (sense ? 1.04 : 1), 94),
    94,
    sense ? 156 : 164
  );
  const lineCount = titleBlock.lineCount + senseBlock.lineCount;
  const heightHint = clamp(
    titleBlock.height + (sense ? senseBlock.height + 3 : 0),
    sense ? 30 : 22,
    sense ? 58 : 46
  );
  const angularWeight = 1 + (widthHint - 96) / 108 + (heightHint - 24) / 44 + (lineCount - 1) * 0.18;
  return {
    widthHint,
    lineCount,
    heightHint,
    angularWeight,
    titleLength,
    senseLength,
    titleLines: buildWrappedLines(title, titleBlock.boundaries),
    senseLines: buildWrappedLines(sense, senseBlock.boundaries),
    titleWidthHint: titleBlock.width || widthHint,
    senseWidthHint: sense ? (senseBlock.width || widthHint) : 0,
    titleLineClamp: Math.max(1, titleBlock.lineCount || 1),
    senseLineClamp: Math.max(1, senseBlock.lineCount || (sense ? 1 : 0))
  };
};

const getEdgeEndpointKeys = (edge = {}, layer = STAR_MAP_LAYER.TITLE) => {
  const fromKey = layer === STAR_MAP_LAYER.SENSE
    ? String(edge?.fromVertexKey || '')
    : String(edge?.nodeAId || '');
  const toKey = layer === STAR_MAP_LAYER.SENSE
    ? String(edge?.toVertexKey || '')
    : String(edge?.nodeBId || '');
  return { fromKey, toKey };
};

export const buildStarMapShortestHopLevels = (graph = {}, layer = STAR_MAP_LAYER.TITLE) => {
  const centerKey = getStarMapCenterKey(graph, layer);
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const graphEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  const fallbackLevels = layer === STAR_MAP_LAYER.SENSE
    ? (graph?.levelByVertexKey || {})
    : (graph?.levelByNodeId || {});
  const nodeKeys = new Set();
  const adjacency = new Map();

  const ensureBucket = (key) => {
    if (!adjacency.has(key)) {
      adjacency.set(key, new Set());
    }
    return adjacency.get(key);
  };

  graphNodes.forEach((node) => {
    const key = getStarMapNodeKey(node, layer);
    if (!key) return;
    nodeKeys.add(key);
    ensureBucket(key);
  });

  if (centerKey) {
    nodeKeys.add(centerKey);
    ensureBucket(centerKey);
  }

  graphEdges.forEach((edge) => {
    const { fromKey, toKey } = getEdgeEndpointKeys(edge, layer);
    if (!fromKey || !toKey || fromKey === toKey) return;
    if (!nodeKeys.has(fromKey) || !nodeKeys.has(toKey)) return;
    ensureBucket(fromKey).add(toKey);
    ensureBucket(toKey).add(fromKey);
  });

  const levelByKey = {};
  if (centerKey && nodeKeys.has(centerKey)) {
    const queue = [centerKey];
    levelByKey[centerKey] = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const currentKey = queue[head];
      const currentLevel = Number(levelByKey[currentKey] || 0);
      const neighbors = Array.from(adjacency.get(currentKey) || []).sort();
      neighbors.forEach((neighborKey) => {
        if (Number.isFinite(levelByKey[neighborKey])) return;
        levelByKey[neighborKey] = currentLevel + 1;
        queue.push(neighborKey);
      });
    }
  }

  const reachedLevels = Object.values(levelByKey)
    .filter((value) => Number.isFinite(value))
    .map((value) => Number(value));
  const fallbackBase = reachedLevels.length > 0 ? Math.max(...reachedLevels) + 1 : 1;

  Array.from(nodeKeys)
    .sort()
    .forEach((key) => {
      if (Number.isFinite(levelByKey[key])) return;
      const rawLevel = Number(fallbackLevels?.[key]);
      levelByKey[key] = Number.isFinite(rawLevel) && rawLevel > 0
        ? Math.max(1, Math.floor(rawLevel))
        : fallbackBase;
    });

  return levelByKey;
};

export const buildStarMapGraphMeta = (graph = {}, layer = STAR_MAP_LAYER.TITLE, levelByKey = {}) => {
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const graphEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  const boundaryStubs = Array.isArray(graph?.boundaryStubs) ? graph.boundaryStubs : [];

  const nodeByKey = new Map();
  const adjacency = new Map();
  const previousLevelNeighbors = new Map();
  const nextLevelNeighbors = new Map();
  const sameLevelNeighbors = new Map();
  const boundaryCountByKey = new Map();

  const ensureSet = (map, key) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = new Set();
      map.set(key, bucket);
    }
    return bucket;
  };

  graphNodes.forEach((node) => {
    const key = getStarMapNodeKey(node, layer);
    if (!key) return;
    nodeByKey.set(key, node);
    adjacency.set(key, new Set());
  });

  graphEdges.forEach((edge) => {
    const { fromKey, toKey } = getEdgeEndpointKeys(edge, layer);
    if (!fromKey || !toKey || fromKey === toKey) return;
    ensureSet(adjacency, fromKey).add(toKey);
    ensureSet(adjacency, toKey).add(fromKey);

    const fromLevel = Number(levelByKey?.[fromKey] || 0);
    const toLevel = Number(levelByKey?.[toKey] || 0);
    if (fromLevel === toLevel) {
      ensureSet(sameLevelNeighbors, fromKey).add(toKey);
      ensureSet(sameLevelNeighbors, toKey).add(fromKey);
    } else if (Math.abs(fromLevel - toLevel) === 1) {
      if (fromLevel < toLevel) {
        ensureSet(previousLevelNeighbors, toKey).add(fromKey);
        ensureSet(nextLevelNeighbors, fromKey).add(toKey);
      } else {
        ensureSet(previousLevelNeighbors, fromKey).add(toKey);
        ensureSet(nextLevelNeighbors, toKey).add(fromKey);
      }
    }
  });

  boundaryStubs.forEach((stub) => {
    const sourceKey = layer === STAR_MAP_LAYER.SENSE
      ? String(stub?.sourceVertexKey || '')
      : String(stub?.sourceNodeId || '');
    if (!sourceKey) return;
    const nextCount = Math.max(0, Number(stub?.hiddenNeighborCount) || 0);
    boundaryCountByKey.set(sourceKey, nextCount);
  });

  return {
    nodeByKey,
    adjacency,
    previousLevelNeighbors,
    nextLevelNeighbors,
    sameLevelNeighbors,
    boundaryCountByKey
  };
};

export const buildStarMapEdgeColor = ({
  layer = STAR_MAP_LAYER.TITLE,
  fromNode = {},
  toNode = {},
  edge = {}
} = {}) => {
  if (layer === STAR_MAP_LAYER.SENSE) {
    const containsCount = Number(edge?.containsCount) || 0;
    const extendsCount = Number(edge?.extendsCount) || 0;
    return containsCount >= extendsCount
      ? [0.98, 0.78, 0.25, 0.66]
      : [0.14, 0.82, 0.62, 0.62];
  }

  const fromCluster = String(fromNode?.clusterSignature || '');
  const toCluster = String(toNode?.clusterSignature || '');
  const sharedCluster = fromCluster && fromCluster === toCluster;
  const centerEdge = Math.min(Number(fromNode?.starMapLevel || 0), Number(toNode?.starMapLevel || 0)) === 0;

  if (!sharedCluster) {
    return centerEdge
      ? [0.66, 0.76, 0.9, 0.34]
      : [0.48, 0.56, 0.68, 0.18];
  }

  const hue = 188 + (stableHash(fromCluster) % 120);
  const [r, g, b] = hslToRgb(hue, centerEdge ? 0.78 : 0.62, centerEdge ? 0.68 : 0.6);
  return [r, g, b, centerEdge ? 0.54 : 0.38];
};

export const buildStarMapLevelOrdering = ({
  centerKey = '',
  levels = [],
  nodesByLevel = new Map(),
  graphMeta,
  labelMetricsByKey = new Map()
} = {}) => {
  const orderByKey = new Map(centerKey ? [[centerKey, 0]] : []);
  const angleByKey = new Map(centerKey ? [[centerKey, -Math.PI / 2]] : []);
  const subtreeWeightByKey = new Map();
  const { adjacency, previousLevelNeighbors, sameLevelNeighbors, boundaryCountByKey } = graphMeta;

  const levelIndexByKey = new Map();
  levels.forEach((level) => {
    (nodesByLevel.get(level) || []).forEach((node) => {
      levelIndexByKey.set(node.key, level);
    });
  });
  if (centerKey) {
    levelIndexByKey.set(centerKey, 0);
  }

  const reversedLevels = levels.slice().sort((a, b) => b - a);
  reversedLevels.forEach((level) => {
    const levelNodes = nodesByLevel.get(level) || [];
    levelNodes.forEach((node) => {
      const key = node.key;
      const labelMetrics = labelMetricsByKey.get(key) || estimateStarMapLabelMetrics(node.label);
      const outwardWeight = Array.from(adjacency.get(key) || []).reduce((sum, neighborKey) => {
        const neighborLevel = Number(levelIndexByKey.get(neighborKey) || 0);
        if (neighborLevel <= level) return sum;
        return sum + (subtreeWeightByKey.get(neighborKey) || 1);
      }, 0);
      const boundaryWeight = (boundaryCountByKey.get(key) || 0) * 0.56;
      const sameLevelWeight = (sameLevelNeighbors.get(key)?.size || 0) * 0.22;
      subtreeWeightByKey.set(
        key,
        1 + labelMetrics.angularWeight + outwardWeight * 0.34 + boundaryWeight + sameLevelWeight
      );
    });
  });

  levels.forEach((level) => {
    const levelNodes = (nodesByLevel.get(level) || []).slice();
    if (levelNodes.length < 1) return;

    levelNodes.forEach((node) => {
      const parentAngles = Array.from(previousLevelNeighbors.get(node.key) || [])
        .map((parentKey) => angleByKey.get(parentKey))
        .filter((value) => Number.isFinite(value));
      const parentOrders = Array.from(previousLevelNeighbors.get(node.key) || [])
        .map((parentKey) => orderByKey.get(parentKey))
        .filter((value) => Number.isFinite(value));
      const sameLevelDegree = sameLevelNeighbors.get(node.key)?.size || 0;
      const boundaryCount = boundaryCountByKey.get(node.key) || 0;
      const subtreeWeight = subtreeWeightByKey.get(node.key) || 1;
      const labelMetrics = labelMetricsByKey.get(node.key) || estimateStarMapLabelMetrics(node.label);
      const anchorAngle = parentAngles.length > 0
        ? parentAngles.reduce((sum, value) => sum + value, 0) / parentAngles.length
        : -Math.PI / 2;
      const anchorOrder = parentOrders.length > 0
        ? parentOrders.reduce((sum, value) => sum + value, 0) / parentOrders.length
        : Number.MAX_SAFE_INTEGER;
      node.layoutMeta = {
        anchorAngle,
        anchorOrder,
        sameLevelDegree,
        boundaryCount,
        subtreeWeight,
        labelMetrics
      };
    });

    const seedNode = levelNodes
      .slice()
      .sort((left, right) => (
        (right.layoutMeta.sameLevelDegree - left.layoutMeta.sameLevelDegree)
        || (right.layoutMeta.subtreeWeight - left.layoutMeta.subtreeWeight)
        || (left.layoutMeta.anchorOrder - right.layoutMeta.anchorOrder)
      ))[0];
    const remaining = new Map(levelNodes.map((node) => [node.key, node]));
    const ordered = [];
    if (seedNode) {
      remaining.delete(seedNode.key);
      ordered.push(seedNode);
    }

    while (remaining.size > 0) {
      const previous = ordered[ordered.length - 1];
      const nextNode = Array.from(remaining.values()).sort((left, right) => {
        const leftShared = previous
          ? (sameLevelNeighbors.get(previous.key)?.has(left.key) ? 1 : 0)
          : 0;
        const rightShared = previous
          ? (sameLevelNeighbors.get(previous.key)?.has(right.key) ? 1 : 0)
          : 0;
        return (
          rightShared - leftShared
          || (left.layoutMeta.anchorOrder - right.layoutMeta.anchorOrder)
          || (right.layoutMeta.subtreeWeight - left.layoutMeta.subtreeWeight)
          || normalizePositiveAngle(left.layoutMeta.anchorAngle) - normalizePositiveAngle(right.layoutMeta.anchorAngle)
        );
      })[0];
      remaining.delete(nextNode.key);
      ordered.push(nextNode);
    }

    const grouped = [];
    ordered.forEach((node) => {
      const lastGroup = grouped[grouped.length - 1];
      const parentSignature = Array.from(previousLevelNeighbors.get(node.key) || [])
        .sort()
        .join('|') || `root:${level}`;
      if (!lastGroup || lastGroup.signature !== parentSignature) {
        grouped.push({
          signature: parentSignature,
          nodes: [node]
        });
        return;
      }
      lastGroup.nodes.push(node);
    });

    const flattened = grouped
      .sort((left, right) => {
        const leftOrder = left.nodes.reduce((sum, item) => sum + (item.layoutMeta.anchorOrder || 0), 0) / left.nodes.length;
        const rightOrder = right.nodes.reduce((sum, item) => sum + (item.layoutMeta.anchorOrder || 0), 0) / right.nodes.length;
        return leftOrder - rightOrder;
      })
      .flatMap((group) => group.nodes);

    flattened.forEach((node, index) => {
      orderByKey.set(node.key, index);
    });

    const totalWeight = flattened.reduce((sum, node) => (
      sum
      + (node.layoutMeta.labelMetrics.angularWeight || 1)
      + (node.layoutMeta.subtreeWeight || 1) * 0.12
      + (node.layoutMeta.boundaryCount || 0) * 0.08
    ), 0);
    const groupGap = clamp(0.1 + Math.max(0, grouped.length - 1) * 0.018, 0.08, 0.28);
    const totalGap = Math.max(0, grouped.length - 1) * groupGap;
    const usableAngle = TAU - totalGap;
    let cursor = -Math.PI / 2;

    grouped
      .sort((left, right) => {
        const leftOrder = left.nodes.reduce((sum, item) => sum + (item.layoutMeta.anchorOrder || 0), 0) / left.nodes.length;
        const rightOrder = right.nodes.reduce((sum, item) => sum + (item.layoutMeta.anchorOrder || 0), 0) / right.nodes.length;
        return leftOrder - rightOrder;
      })
      .forEach((group, groupIndex) => {
        group.nodes.forEach((node) => {
          const weight = (
            (node.layoutMeta.labelMetrics.angularWeight || 1)
            + (node.layoutMeta.subtreeWeight || 1) * 0.12
            + (node.layoutMeta.boundaryCount || 0) * 0.08
          );
          const span = usableAngle * (weight / Math.max(1, totalWeight));
          const angle = normalizeAngle(cursor + span * 0.5);
          angleByKey.set(node.key, angle);
          cursor += span;
        });
        if (groupIndex < grouped.length - 1) {
          cursor += groupGap;
        }
      });
  });

  return {
    orderByKey,
    angleByKey,
    subtreeWeightByKey
  };
};

export const buildStarMapLineVisual = ({
  line,
  fromNode = {},
  toNode = {},
  fromLevel = 0,
  toLevel = 0,
  centerX = 0,
  centerY = 0,
  layer = STAR_MAP_LAYER.TITLE
} = {}) => {
  const pairWeight = Math.max(1, Number(line?.edgeMeta?.pairCount || line?.pairCount || 1));
  const level = Math.max(fromLevel, toLevel);
  const levelDelta = Math.abs(fromLevel - toLevel);
  const sameBand = levelDelta === 0;
  const sameCluster = fromNode?.clusterSignature && fromNode?.clusterSignature === toNode?.clusterSignature;
  const parentNode = fromLevel <= toLevel ? fromNode : toNode;
  const childNode = fromLevel <= toLevel ? toNode : fromNode;
  const touchesCenter = Math.min(fromLevel, toLevel) === 0;
  const isPrimaryHierarchyEdge = levelDelta === 1
    && String(childNode?.primaryParentKey || '') === String(parentNode?.nodeKey || '');
  const isPrimarySenseBranch = layer === STAR_MAP_LAYER.SENSE
    && isPrimaryHierarchyEdge;
  const isSenseTrunk = layer === STAR_MAP_LAYER.SENSE && (touchesCenter || (isPrimarySenseBranch && Math.min(fromLevel, toLevel) <= 1));
  const isSenseBranch = layer === STAR_MAP_LAYER.SENSE && isPrimarySenseBranch && !isSenseTrunk;
  const isSenseCross = layer === STAR_MAP_LAYER.SENSE && !isPrimarySenseBranch;
  const dx = Number(toNode?.x || 0) - Number(fromNode?.x || 0);
  const dy = Number(toNode?.y || 0) - Number(fromNode?.y || 0);
  const distance = Math.hypot(dx, dy) || 1;
  const siblingSide = Math.max(
    -1.5,
    Math.min(
      1.5,
      Number(childNode?.siblingIndex || 0) - ((Number(childNode?.siblingCount || 1) - 1) * 0.5)
    )
  );
  const fromAngle = Math.atan2((fromNode?.y || 0) - centerY, (fromNode?.x || 0) - centerX);
  const toAngle = Math.atan2((toNode?.y || 0) - centerY, (toNode?.x || 0) - centerX);
  const angleDelta = Math.abs(normalizeAngle(toAngle - fromAngle));
  const centerCross = (
    ((fromNode?.x || 0) - centerX) * ((toNode?.y || 0) - centerY)
    - ((fromNode?.y || 0) - centerY) * ((toNode?.x || 0) - centerX)
  );
  const hierarchyCurveSign = siblingSide === 0 ? 0 : Math.sign(siblingSide);
  const baseCurveSign = hierarchyCurveSign || (centerCross >= 0 ? 1 : -1);
  const trunkBias = Math.max(
    Number(parentNode?.childCount || 0),
    Number(childNode?.childCount || 0),
    Number(parentNode?.degree || 0) * 0.5,
    Number(childNode?.degree || 0) * 0.4
  );
  let curveStrength = 0;
  if (isSenseTrunk) {
    curveStrength = clamp(1.2 + Math.abs(siblingSide) * 2.1 + angleDelta * 1.8 + trunkBias * 0.05, 0.8, 5.2);
  } else if (isSenseBranch) {
    curveStrength = clamp(3.8 + Math.abs(siblingSide) * 2.8 + distance * 0.012 + trunkBias * 0.04, 3.8, 9.6);
  } else if (isPrimaryHierarchyEdge) {
    curveStrength = clamp(3.2 + Math.abs(siblingSide) * 2.2 + distance * 0.01, 2.8, 8.4);
  } else if (touchesCenter) {
    curveStrength = clamp(3 + angleDelta * 4.4, 2.8, 8.8);
  } else if (sameBand && sameCluster) {
    curveStrength = clamp(5 + distance * 0.04, 4, 12);
  } else if (sameBand) {
    curveStrength = clamp(10 + distance * 0.05 + angleDelta * 12, 10, 22);
  } else {
    curveStrength = clamp(12 + distance * 0.04 + angleDelta * 10, 10, 26);
  }

  const opacity = clamp(
    (isSenseTrunk
      ? 0.4
      : isSenseBranch
        ? 0.28
        : touchesCenter
          ? 0.28
          : 0.18)
      + pairWeight * 0.028
      - level * 0.016
      + (sameCluster ? 0.03 : -0.01)
      - (isSenseCross ? 0.05 : 0),
    0.08,
    0.42
  );
  const glowAlpha = clamp(opacity * 0.55, 0.08, 0.2);
  const lineWidth = clamp(
    (isSenseTrunk
      ? 1.95
      : isSenseBranch
        ? 1.34
        : touchesCenter
          ? 1.26
          : 0.94)
      + pairWeight * 0.05
      + (sameCluster ? 0.05 : -0.04)
      + (isSenseCross ? -0.12 : 0)
      - level * 0.03,
    0.72,
    2.1
  );
  const glowWidth = clamp(
    lineWidth * (isSenseTrunk ? 3.2 : 2.6) + (sameBand ? 0.5 : 0),
    2.2,
    6.8
  );
  const drawOrder = (
    isSenseTrunk
      ? 228
      : isSenseBranch
        ? 184
        : touchesCenter
          ? 148
          : 108
  ) + level * 14 + (sameCluster ? 4 : -6);

  return {
    curveOffset: curveStrength * baseCurveSign,
    lineOpacity: opacity,
    glowOpacity: glowAlpha,
    lineWidth,
    glowWidth,
    drawOrder,
    lineVariant: isSenseTrunk
      ? 'sense-trunk'
      : isSenseBranch
        ? 'sense-branch'
        : isSenseCross
          ? 'sense-cross'
          : sameBand
            ? (sameCluster ? 'same-cluster' : 'cross-cluster')
            : (layer === STAR_MAP_LAYER.TITLE ? 'title-bridge' : 'sense-bridge')
  };
};

export const buildStarMapStubVisual = ({
  hiddenNeighborCount = 0,
  sourceLevel = 0
} = {}) => ({
  curveOffset: clamp(16 + hiddenNeighborCount * 3 + sourceLevel * 2, 16, 36),
  lineOpacity: clamp(0.16 + hiddenNeighborCount * 0.02 - sourceLevel * 0.01, 0.12, 0.28),
  glowOpacity: clamp(0.1 + hiddenNeighborCount * 0.015, 0.08, 0.18),
  lineWidth: clamp(1 + hiddenNeighborCount * 0.04, 1, 1.8),
  glowWidth: clamp(3.4 + hiddenNeighborCount * 0.12, 3.4, 5.8)
});
