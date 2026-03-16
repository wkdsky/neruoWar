const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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

const buildClusterAnchors = ({
  center,
  width,
  height,
  clusters,
  spreadFactor = 1
}) => {
  const anchors = new Map();
  const maxAnchorRadius = Math.min(width, height) * 0.26 * spreadFactor;
  const minAnchorRadius = Math.min(width, height) * 0.1 * spreadFactor;

  clusters.forEach((cluster, index) => {
    const unit = stableUnit(`${cluster.rootKey}:anchor`);
    const angle = GOLDEN_ANGLE * index + unit * 0.7;
    const radialUnit = clamp(
      0.18
        + Math.sqrt((index + 0.8) / Math.max(1, clusters.length + 0.8)) * 0.44
        + Math.min(0.32, (cluster.spreadScore - 1) * 0.04),
      0.18,
      0.96
    );
    const radius = minAnchorRadius + (maxAnchorRadius - minAnchorRadius) * radialUnit;
    anchors.set(cluster.rootKey, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      angle,
      radius
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
      force.x += toCenter.x * (idealDistance - distance) * 0.08;
      force.y += toCenter.y * (idealDistance - distance) * 0.08;
      anchor.x += force.x;
      anchor.y += force.y;
    });
  }

  return anchors;
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
  spreadFactor = 1
}) => {
  const { clusterRootByKey, clusters } = buildClusterAssignments({
    levels,
    nodesByLevel,
    graphMeta
  });
  const clusterAnchors = buildClusterAnchors({
    center,
    width,
    height,
    clusters,
    spreadFactor
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
  const membersByCluster = new Map();
  const siblingOrderByParent = new Map();
  const nodeConfigByKey = new Map();
  levels.forEach((level) => {
    const nodes = (nodesByLevel.get(level) || []).slice().sort((left, right) => {
      const leftDegree = (graphMeta.adjacency.get(left.key)?.size || 0);
      const rightDegree = (graphMeta.adjacency.get(right.key)?.size || 0);
      return rightDegree - leftDegree || String(left.key).localeCompare(String(right.key));
    });
    nodes.forEach((node) => {
      nodeConfigByKey.set(node.key, node);
      const clusterRoot = clusterRootByKey.get(node.key) || node.key;
      const members = membersByCluster.get(clusterRoot) || [];
      members.push(node.key);
      membersByCluster.set(clusterRoot, members);
    });
  });
  primaryParentByKey.forEach((parentKey, childKey) => {
    const bucket = siblingOrderByParent.get(parentKey) || [];
    bucket.push(childKey);
    siblingOrderByParent.set(parentKey, bucket);
  });
  siblingOrderByParent.forEach((bucket, parentKey) => {
    bucket.sort((leftKey, rightKey) => {
      const leftNode = nodeConfigByKey.get(leftKey);
      const rightNode = nodeConfigByKey.get(rightKey);
      const leftDegree = leftNode ? (graphMeta.adjacency.get(leftNode.key)?.size || 0) : 0;
      const rightDegree = rightNode ? (graphMeta.adjacency.get(rightNode.key)?.size || 0) : 0;
      return rightDegree - leftDegree || String(leftKey).localeCompare(String(rightKey));
    });
    siblingOrderByParent.set(parentKey, bucket);
  });

  levels.forEach((level) => {
    const nodes = (nodesByLevel.get(level) || []).slice().sort((left, right) => {
      const leftCluster = clusterRootByKey.get(left.key) || left.key;
      const rightCluster = clusterRootByKey.get(right.key) || right.key;
      return String(leftCluster).localeCompare(String(rightCluster)) || String(left.key).localeCompare(String(right.key));
    });
    const band = bandByLevel.get(level);
    nodes.forEach((node) => {
      const clusterRoot = clusterRootByKey.get(node.key) || node.key;
      const anchor = clusterAnchors.get(clusterRoot) || { x: center.x, y: center.y - band.ideal };
      const clusterMeta = clusterMetaByRoot.get(clusterRoot);
      const direction = normalize(anchor.x - center.x, anchor.y - center.y, {
        x: Math.cos(GOLDEN_ANGLE * (clusters.findIndex((cluster) => cluster.rootKey === clusterRoot) + 1)),
        y: Math.sin(GOLDEN_ANGLE * (clusters.findIndex((cluster) => cluster.rootKey === clusterRoot) + 1))
      });
      const tangent = { x: -direction.y, y: direction.x };
      const memberIndex = (membersByCluster.get(clusterRoot) || []).indexOf(node.key);
      const clusterSize = (membersByCluster.get(clusterRoot) || []).length;
      const labelMetrics = labelMetricsByKey.get(node.key) || node.labelMetrics;
      const clusterSpread = Number(clusterMeta?.spreadScore || 1);
      const radialBias = (stableUnit(`${node.key}:radial`) - 0.5) * band.thickness * 0.26;
      const localRadius = Math.sqrt(memberIndex + 1) * (8 + labelMetrics.widthHint * 0.018 + clusterSpread * 0.76) * spreadFactor;
      const localAngle = stableUnit(`${clusterRoot}:local-angle`) * TAU + memberIndex * GOLDEN_ANGLE;
      const scatterX = Math.cos(localAngle) * localRadius;
      const scatterY = Math.sin(localAngle) * localRadius * 0.82;
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
        18 + collisionRadius * 0.86 + degree * 4.1 + labelMetrics.widthHint * 0.11 + clusterSize * 1.8,
        28,
        124
      );
      const parentKey = primaryParentByKey.get(node.key) || '';
      const parentBody = parentKey ? seededBodyByKey.get(parentKey) : null;
      const siblings = parentKey ? (siblingOrderByParent.get(parentKey) || []) : [];
      const siblingIndex = parentKey ? Math.max(0, siblings.indexOf(node.key)) : memberIndex;
      const siblingCount = parentKey ? siblings.length : clusterSize;
      let seedDistance = clamp(
        band.ideal + radialBias + scatterY * 0.1,
        band.min + 4,
        band.max - 4
      );
      let x = center.x + direction.x * seedDistance + tangent.x * (scatterX * 0.56);
      let y = center.y + direction.y * seedDistance + tangent.y * (scatterX * 0.56) + scatterY * 0.12;

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
          siblingOffset * (14 + Math.min(30, labelMetrics.widthHint * 0.08) + Math.min(22, scaledRadius * 0.24)),
          -92,
          92
        );
        const childSpread = stableUnit(`${node.key}:branch`) - 0.5;
        x = parentBody.x + parentDirection.x * branchGap + parentTangent.x * (lateralGap + childSpread * 10);
        y = parentBody.y + parentDirection.y * branchGap + parentTangent.y * (lateralGap + childSpread * 10);
        const radialDistance = Math.hypot(x - center.x, y - center.y) || seedDistance;
        const clampedDistance = clamp(radialDistance, band.min + 2, band.max - 2);
        if (Math.abs(clampedDistance - radialDistance) > 0.001) {
          const adjustedDir = normalize(x - center.x, y - center.y, parentDirection);
          x = center.x + adjustedDir.x * clampedDistance;
          y = center.y + adjustedDir.y * clampedDistance;
        }
        seedDistance = clampedDistance;
      }
      const body = {
        ...node,
        clusterRoot,
        clusterSignature: clusterRoot,
        clusterSize,
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
        band,
        degree,
        childCount,
        importance,
        siblingIndex,
        siblingCount,
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
  });

  return {
    bodies,
    bandByLevel
  };
};

const computeClusterCentroids = (bodies) => {
  const centroidByCluster = new Map();
  const countByCluster = new Map();
  bodies.forEach((body) => {
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
  primaryParentKey: body.primaryParentKey
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
  labelMetricsByKey
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
    const { bodies, bandByLevel } = buildSeedBodies({
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
      spreadFactor
    });
    const bodyByKey = new Map(bodies.map((body) => [body.key, body]));
    const centerLabel = buildLabelRect(center);
    const centerCircle = {
      x: center.x,
      y: center.y,
      radius: center.radius
    };

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
      penalty: measureLayoutPenalty(center, bodies, springs, centerKey)
    };
  };

  const attempts = [1, 1.18, 1.36, 1.58];
  let best = null;
  attempts.forEach((spreadFactor) => {
    const result = solveAttempt(spreadFactor);
    if (!best || result.penalty < best.penalty) {
      best = result;
    }
  });

  return {
    bodyByKey: new Map(snapshotBodies(best.bodies).map((body) => [body.key, body])),
    bounds: best.bounds
  };
};
