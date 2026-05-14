import {
  CITY_CHANNEL_HEIGHT,
  CITY_CHANNEL_WIDTH,
  createCellKey,
  isValidCell
} from '../../cityChannelSchema';
import { TILE_HEIGHT, TILE_WIDTH, projectWorldOffset } from '../../cityChannelGeometryUtils';

export const TILE_RENDER_WIDTH = 160;
export const TILE_RENDER_HEIGHT = 172;
export const TILE_RENDER_CENTER = { x: 80, y: 98 };
export const FLOOR_THICKNESS = 14;
export const WALL_HEIGHT = 62;

export const getMapCenter = (mapData = {}) => ({
  x: Math.floor((Number.isInteger(mapData.width) ? mapData.width : CITY_CHANNEL_WIDTH) / 2),
  y: Math.floor((Number.isInteger(mapData.height) ? mapData.height : CITY_CHANNEL_HEIGHT) / 2)
});

export const projectCell = (cell, cameraYaw = 0, mapData = {}) => {
  const center = getMapCenter(mapData);
  const dx = cell.x - center.x;
  const dy = cell.y - center.y;
  const projected = projectWorldOffset(dx, dy, cameraYaw);
  return {
    x: projected.x,
    y: projected.y,
    depth: Math.round((projected.y / (TILE_HEIGHT / 2)) * 100)
  };
};

export const screenToLocal = ({ x, y, worldX, worldY, zoom }) => ({
  x: (x - worldX) / zoom,
  y: (y - worldY) / zoom
});

export const localToCell = ({ x, y, cameraYaw = 0, mapData = {} }) => {
  const center = getMapCenter(mapData);
  const rx = (y / TILE_HEIGHT) + (x / TILE_WIDTH);
  const ry = (y / TILE_HEIGHT) - (x / TILE_WIDTH);
  const radians = (cameraYaw * Math.PI) / 180;
  const dx = (rx * Math.cos(radians)) + (ry * Math.sin(radians));
  const dy = (-rx * Math.sin(radians)) + (ry * Math.cos(radians));
  const cellX = Math.round(dx + center.x);
  const cellY = Math.round(dy + center.y);
  return isValidCell(cellX, cellY, 0, mapData) ? { x: cellX, y: cellY, z: 0 } : null;
};

const createWallThicknessOffset = (wallBase) => {
  const dx = wallBase[1].x - wallBase[0].x;
  const dy = wallBase[1].y - wallBase[0].y;
  const length = Math.max(1, Math.hypot(dx, dy));
  let offset = {
    x: (-dy / length) * 9,
    y: (dx / length) * 9
  };
  if (offset.y > 0) offset = { x: -offset.x, y: -offset.y };
  return offset;
};

const offsetPoint = (point, offset) => ({
  x: point.x + offset.x,
  y: point.y + offset.y
});

const rotateWorldPoint = (point, degrees = 0) => {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: (point.x * Math.cos(radians)) - (point.y * Math.sin(radians)),
    y: (point.x * Math.sin(radians)) + (point.y * Math.cos(radians))
  };
};

const projectLocalPoint = (wx, wy, cameraYaw = 0) => {
  const projected = projectWorldOffset(wx, wy, cameraYaw);
  return {
    x: TILE_RENDER_CENTER.x + projected.x,
    y: TILE_RENDER_CENTER.y + projected.y
  };
};

const createRaisedBoxGeometry = (cameraYaw, x1, y1, x2, y2, bottomLift, topLift, tileRotation = 0) => {
  const corners = [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 }
  ].map((corner) => rotateWorldPoint(corner, tileRotation));

  const top = corners.map((corner) => {
    const point = projectLocalPoint(corner.x, corner.y, cameraYaw);
    return { x: point.x, y: point.y - topLift };
  });
  const bottom = corners.map((corner) => {
    const point = projectLocalPoint(corner.x, corner.y, cameraYaw);
    return { x: point.x, y: point.y - bottomLift };
  });
  const visibleEdges = [
    [0, 1], [1, 2], [2, 3], [3, 0]
  ].map(([start, end]) => ({
    start,
    end,
    midpointY: (bottom[start].y + bottom[end].y) / 2
  })).sort((a, b) => b.midpointY - a.midpointY).slice(0, 2);

  return {
    top,
    front: visibleEdges[0]
      ? [top[visibleEdges[0].start], top[visibleEdges[0].end], bottom[visibleEdges[0].end], bottom[visibleEdges[0].start]]
      : [],
    side: visibleEdges[1]
      ? [top[visibleEdges[1].start], top[visibleEdges[1].end], bottom[visibleEdges[1].end], bottom[visibleEdges[1].start]]
      : []
  };
};

export const createTileGeometry = (cameraYaw = 0, tileRotation = 0) => {
  const topWorldCorners = [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 }
  ];
  const top = topWorldCorners.map((corner) => {
    const projected = projectWorldOffset(corner.x, corner.y, cameraYaw);
    return {
      x: TILE_RENDER_CENTER.x + projected.x,
      y: TILE_RENDER_CENTER.y + projected.y
    };
  });
  const bottom = top.map((point) => ({ x: point.x, y: point.y + FLOOR_THICKNESS }));
  const lowerEdges = [
    [0, 1], [1, 2], [2, 3], [3, 0]
  ].map(([start, end]) => ({
    start,
    end,
    midpointY: (top[start].y + top[end].y) / 2
  })).sort((a, b) => b.midpointY - a.midpointY).slice(0, 2);
  const sides = lowerEdges.map(({ start, end }) => [
    top[start], top[end], bottom[end], bottom[start]
  ]);

  const normalizedRotation = ((Number.parseInt(tileRotation, 10) || 0) % 180 + 180) % 180;
  const wallWorldEndpoints = normalizedRotation === 90
    ? [{ x: 0, y: -0.5 }, { x: 0, y: 0.5 }]
    : [{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }];
  const wallBase = wallWorldEndpoints.map((point) => {
    const projected = projectWorldOffset(point.x, point.y, cameraYaw);
    return {
      x: TILE_RENDER_CENTER.x + projected.x,
      y: TILE_RENDER_CENTER.y + projected.y - 4
    };
  });
  const wallTop = wallBase.map((point) => ({ x: point.x, y: point.y - WALL_HEIGHT }));
  const wallThicknessOffset = createWallThicknessOffset(wallBase);
  const rearBase = wallBase.map((point) => offsetPoint(point, wallThicknessOffset));
  const rearTop = wallTop.map((point) => offsetPoint(point, wallThicknessOffset));
  const wallBaseMaxY = Math.max(wallBase[0].y, wallBase[1].y);
  const wallTopMinY = Math.min(wallTop[0].y, wallTop[1].y);
  const wallHeightSpan = wallBaseMaxY - wallTopMinY;

  return {
    top,
    sides,
    wall: [wallBase[0], wallBase[1], wallTop[1], wallTop[0]],
    wallCap: [wallTop[0], wallTop[1], rearTop[1], rearTop[0]],
    wallSideStart: [wallBase[0], wallTop[0], rearTop[0], rearBase[0]],
    wallSideEnd: [wallBase[1], rearBase[1], rearTop[1], wallTop[1]],
    verticalBaseY: wallTopMinY + (wallHeightSpan * 0.6),
    wallFadeStartY: wallTopMinY + (wallHeightSpan * 0.34),
    wallFadeEndY: wallBaseMaxY
  };
};

export const createPortalGeometry = (cameraYaw = 0, tileRotation = 0) => {
  const pillarWidth = 0.12;
  const pillarDepth = 0.1;
  const pillarHeight = 48;
  const pillarBottom = 4;
  const spacing = 0.32;

  const leftPillar = createRaisedBoxGeometry(
    cameraYaw,
    -spacing - pillarWidth,
    -pillarDepth / 2,
    -spacing + pillarWidth,
    pillarDepth / 2,
    pillarBottom,
    pillarBottom + pillarHeight,
    tileRotation
  );
  const rightPillar = createRaisedBoxGeometry(
    cameraYaw,
    spacing - pillarWidth,
    -pillarDepth / 2,
    spacing + pillarWidth,
    pillarDepth / 2,
    pillarBottom,
    pillarBottom + pillarHeight,
    tileRotation
  );

  const lintelBottom = pillarBottom + pillarHeight - 4;
  const lintel = createRaisedBoxGeometry(
    cameraYaw,
    -spacing - pillarWidth,
    -pillarDepth / 2,
    spacing + pillarWidth,
    pillarDepth / 2,
    lintelBottom,
    lintelBottom + 10,
    tileRotation
  );
  const threshold = createRaisedBoxGeometry(
    cameraYaw,
    -spacing - pillarWidth,
    (-pillarDepth / 2) - 0.04,
    spacing + pillarWidth,
    (pillarDepth / 2) + 0.04,
    0,
    5,
    tileRotation
  );
  const arch = createRaisedBoxGeometry(
    cameraYaw,
    -spacing + pillarWidth,
    (-pillarDepth / 2) + 0.02,
    spacing - pillarWidth,
    (pillarDepth / 2) - 0.02,
    lintelBottom - 6,
    lintelBottom,
    tileRotation
  );

  const coreWidth = 0.16;
  const coreHeight = 32;
  const coreBottom = 7;
  const coreMid = rotateWorldPoint({ x: 0, y: 0 }, tileRotation);
  const coreProjection = projectLocalPoint(coreMid.x, coreMid.y, cameraYaw);
  const coreBottomY = coreProjection.y - coreBottom;
  const coreTopY = coreBottomY - coreHeight;

  const runePositions = [
    { x: -spacing + 0.02, y: 0, lift: pillarBottom + 12 },
    { x: spacing - 0.02, y: 0, lift: pillarBottom + 12 },
    { x: -spacing + 0.02, y: 0, lift: pillarBottom + 28 },
    { x: spacing - 0.02, y: 0, lift: pillarBottom + 28 }
  ].map((rune) => {
    const rotated = rotateWorldPoint({ x: rune.x, y: rune.y }, tileRotation);
    const point = projectLocalPoint(rotated.x, rotated.y, cameraYaw);
    return { x: point.x, y: point.y - rune.lift };
  });

  const particles = Array.from({ length: 5 }, (_, index) => {
    const t = (index / 4) * 2 - 1;
    const rotated = rotateWorldPoint({ x: t * coreWidth, y: 0 }, tileRotation);
    const point = projectLocalPoint(rotated.x, rotated.y, cameraYaw);
    return { x: point.x, y: coreBottomY - 8 - (index * 6), radius: 1.4 + (index % 2) * 0.5 };
  });

  return {
    threshold,
    leftPillar,
    rightPillar,
    lintel,
    arch,
    coreCenter: { x: coreProjection.x, y: (coreTopY + coreBottomY) / 2 },
    coreRx: 8,
    coreRy: coreHeight / 2,
    runePositions,
    particles
  };
};

export const createEdgeWallGeometry = (cameraYaw = 0, edge = 'north') => {
  const edgeEndpoints = {
    north: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }],
    south: [{ x: -0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
    west: [{ x: -0.5, y: -0.5 }, { x: -0.5, y: 0.5 }],
    east: [{ x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }]
  };
  const endpoints = edgeEndpoints[edge] || edgeEndpoints.north;
  const wallBase = endpoints.map((point) => {
    const projected = projectWorldOffset(point.x, point.y, cameraYaw);
    return {
      x: TILE_RENDER_CENTER.x + projected.x,
      y: TILE_RENDER_CENTER.y + projected.y
    };
  });
  const wallTop = wallBase.map((point) => ({ x: point.x, y: point.y - WALL_HEIGHT }));
  const wallThicknessOffset = createWallThicknessOffset(wallBase);
  const rearBase = wallBase.map((point) => offsetPoint(point, wallThicknessOffset));
  const rearTop = wallTop.map((point) => offsetPoint(point, wallThicknessOffset));
  const wallBaseMaxY = Math.max(wallBase[0].y, wallBase[1].y);
  const wallTopMinY = Math.min(wallTop[0].y, wallTop[1].y);
  const wallHeightSpan = wallBaseMaxY - wallTopMinY;
  return {
    wall: [wallBase[0], wallBase[1], wallTop[1], wallTop[0]],
    wallCap: [wallTop[0], wallTop[1], rearTop[1], rearTop[0]],
    wallSideStart: [wallBase[0], wallTop[0], rearTop[0], rearBase[0]],
    wallSideEnd: [wallBase[1], rearBase[1], rearTop[1], wallTop[1]],
    verticalBaseY: wallTopMinY + (wallHeightSpan * 0.6),
    wallFadeStartY: wallTopMinY + (wallHeightSpan * 0.34),
    wallFadeEndY: wallBaseMaxY
  };
};

export const pointInPolygon = (point, polygon = []) => {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects = ((pi.y > point.y) !== (pj.y > point.y))
      && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / ((pj.y - pi.y) || 1) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

export const detectNearestEdge = ({ localPoint, cell, cameraYaw = 0, mapData = {} }) => {
  if (!localPoint || !cell) return 'north';
  const projection = projectCell(cell, cameraYaw, mapData);
  const relX = localPoint.x - projection.x;
  const relY = localPoint.y - projection.y;
  const edgeMidpoints = [
    { edge: 'north', x: 0, y: -0.5 },
    { edge: 'south', x: 0, y: 0.5 },
    { edge: 'west', x: -0.5, y: 0 },
    { edge: 'east', x: 0.5, y: 0 }
  ];
  let closest = 'north';
  let minDist = Infinity;
  edgeMidpoints.forEach(({ edge, x, y }) => {
    const projected = projectWorldOffset(x, y, cameraYaw);
    const dx = relX - projected.x;
    const dy = relY - projected.y;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      closest = edge;
    }
  });
  return closest;
};

export const getNeighborCells = (cell, mapData = {}) => {
  if (!cell) return [];
  const candidates = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      const z = cell.z;
      if (isValidCell(x, y, z, mapData)) candidates.push({ x, y, z, key: createCellKey(x, y, z) });
    }
  }
  return candidates;
};
