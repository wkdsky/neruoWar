const TILE_WIDTH = 120;
const TILE_HEIGHT = 64;
const TILE_RENDER_CENTER = { x: 80, y: 98 };

export const rotateWorldPoint = (point, degrees) => {
  const rad = (degrees * Math.PI) / 180;
  return {
    x: point.x * Math.cos(rad) - point.y * Math.sin(rad),
    y: point.x * Math.sin(rad) + point.y * Math.cos(rad)
  };
};

export const projectWorldOffset = (x, y, cameraYaw = 0) => {
  const radians = (cameraYaw * Math.PI) / 180;
  const rx = (x * Math.cos(radians)) - (y * Math.sin(radians));
  const ry = (x * Math.sin(radians)) + (y * Math.cos(radians));
  return {
    x: (rx - ry) * (TILE_WIDTH / 2),
    y: (rx + ry) * (TILE_HEIGHT / 2)
  };
};

export const projectLocalPoint = (wx, wy, cameraYaw = 0) => {
  const projected = projectWorldOffset(wx, wy, cameraYaw);
  return {
    x: TILE_RENDER_CENTER.x + projected.x,
    y: TILE_RENDER_CENTER.y + projected.y
  };
};

export const formatPolygonPoints = (points) => (
  points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
);

export const createBox = (cameraYaw, x1, y1, x2, y2, bottomLift, topLift, depth, tileRotation = 0) => {
  const corners = [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 }
  ].map((c) => rotateWorldPoint(c, tileRotation));

  const top = corners.map((c) => {
    const p = projectLocalPoint(c.x, c.y, cameraYaw);
    return { x: p.x, y: p.y - topLift };
  });
  const bottom = corners.map((c) => {
    const p = projectLocalPoint(c.x, c.y, cameraYaw);
    return { x: p.x, y: p.y - bottomLift };
  });

  const topFace = formatPolygonPoints(top);
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0]
  ].map(([s, e]) => ({
    s, e, midY: (bottom[s].y + bottom[e].y) / 2
  })).sort((a, b) => b.midY - a.midY).slice(0, 2);
  const frontFace = edges[0]
    ? formatPolygonPoints([top[edges[0].s], top[edges[0].e], bottom[edges[0].e], bottom[edges[0].s]])
    : '';
  const sideFace = edges[1]
    ? formatPolygonPoints([top[edges[1].s], top[edges[1].e], bottom[edges[1].e], bottom[edges[1].s]])
    : '';

  return { topFace, frontFace, sideFace };
};

export const createCylinder = (cameraYaw, cx, cy, radius, bottomLift, topLift, segments, tileRotation = 0) => {
  const angleStep = (2 * Math.PI) / segments;
  const topPoints = [];
  const bottomPoints = [];

  for (let i = 0; i < segments; i++) {
    const angle = i * angleStep;
    const wx = cx + radius * Math.cos(angle);
    const wy = cy + radius * Math.sin(angle);
    const rotated = rotateWorldPoint({ x: wx, y: wy }, tileRotation);
    const p = projectLocalPoint(rotated.x, rotated.y, cameraYaw);
    topPoints.push({ x: p.x, y: p.y - topLift });
    bottomPoints.push({ x: p.x, y: p.y - bottomLift });
  }

  const topFace = formatPolygonPoints(topPoints);

  let bestIdx = 0;
  let bestY = -Infinity;
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const midY = (bottomPoints[i].y + bottomPoints[next].y) / 2;
    if (midY > bestY) { bestY = midY; bestIdx = i; }
  }
  const frontStart = bestIdx;
  const frontEnd = (bestIdx + 1) % segments;
  const frontFace = formatPolygonPoints([
    topPoints[frontStart], topPoints[frontEnd],
    bottomPoints[frontEnd], bottomPoints[frontStart]
  ]);

  return { topFace, frontFace, topPoints, bottomPoints };
};

export const createGearShape = (cameraYaw, cx, cy, outerR, innerR, teeth, bottomLift, topLift, tileRotation = 0) => {
  const points = [];
  const angleStep = (2 * Math.PI) / (teeth * 2);

  for (let i = 0; i < teeth * 2; i++) {
    const angle = i * angleStep;
    const r = i % 2 === 0 ? outerR : innerR;
    const wx = cx + r * Math.cos(angle);
    const wy = cy + r * Math.sin(angle);
    const rotated = rotateWorldPoint({ x: wx, y: wy }, tileRotation);
    const p = projectLocalPoint(rotated.x, rotated.y, cameraYaw);
    points.push({ x: p.x, y: p.y - topLift });
  }

  const topFace = formatPolygonPoints(points);

  const bottomPoints = [];
  for (let i = 0; i < teeth * 2; i++) {
    const angle = i * angleStep;
    const r = i % 2 === 0 ? outerR : innerR;
    const wx = cx + r * Math.cos(angle);
    const wy = cy + r * Math.sin(angle);
    const rotated = rotateWorldPoint({ x: wx, y: wy }, tileRotation);
    const p = projectLocalPoint(rotated.x, rotated.y, cameraYaw);
    bottomPoints.push({ x: p.x, y: p.y - bottomLift });
  }

  let bestIdx = 0;
  let bestY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    const midY = (bottomPoints[i].y + bottomPoints[next].y) / 2;
    if (midY > bestY) { bestY = midY; bestIdx = i; }
  }
  const fi = bestIdx;
  const fn = (bestIdx + 1) % points.length;
  const frontFace = formatPolygonPoints([
    points[fi], points[fn], bottomPoints[fn], bottomPoints[fi]
  ]);

  return { topFace, frontFace };
};

export { TILE_WIDTH, TILE_HEIGHT, TILE_RENDER_CENTER };
