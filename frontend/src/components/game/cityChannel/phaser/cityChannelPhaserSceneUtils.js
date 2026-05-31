import {
  CITY_CHANNEL_TILE_TYPES,
  createWallKey,
  normalizeRotation,
  wallEdgeToRotation
} from '../cityChannelSchema';
import { getCityChannelMaterial } from '../cityChannelCatalog';
import {
  EDGE_NEIGHBOR_OFFSETS,
  isPortalMaterial,
  sameCell
} from '../cityChannelPlacementGeometry';
import { createPortalGeometry } from './renderer/CityChannelGeometry';

export const MIN_ZOOM = 0.55;
export const MAX_ZOOM = 1.8;
export const CAMERA_PAN_SPEED = 520;
export const CAMERA_ROTATION_SPEED = 96;
export const SELECTED_MOVE_HOLD_DELAY = 260;
export const WALL_EDGE_SNAP_SCREEN_RADIUS = 30;
export const FLOOR_EDGE_SNAP_SCREEN_RADIUS = 16;
export const VERTICAL_SURFACE_EDGE_SNAP_SCREEN_RADIUS = 10;
export const DOUBLE_CLICK_MS = 280;
export const DOUBLE_CLICK_DISTANCE = 12;
export const INSPECT_ROTATE_SENSITIVITY = 0.009;
export const INSPECT_MIN_PITCH = -45;
export const INSPECT_MAX_PITCH = 60;
export const PRESS_TRAVEL = 10;
export const VERTICAL_PUSH_TRAVEL = PRESS_TRAVEL * 2;
export const HORIZONTAL_PUSH_TRAVEL = PRESS_TRAVEL * 2;
export const INSPECT_PREVIEW_SCALE = 2.05;
export const INSPECT_LIFT_DURATION = 620;
export const INSPECT_RETURN_DURATION = 420;
export const TRANSMISSION_SOCKET_EPSILON = 0.08;
export const GEAR_COMPONENT_TYPE = 'gear';
export const FIXED_HORIZONTAL_TILE_TYPES = new Set([
  CITY_CHANNEL_TILE_TYPES.ENTRANCE,
  CITY_CHANNEL_TILE_TYPES.EXIT
]);
export const GEAR_SOCKET_POSITIONS = ['center', 'corner_ne', 'corner_nw', 'corner_se', 'corner_sw'];
export const GEAR_SOCKET_BLOCKED_BY_EDGE = {
  north: new Set(['corner_ne', 'corner_nw']),
  east: new Set(['corner_ne', 'corner_se']),
  south: new Set(['corner_se', 'corner_sw']),
  west: new Set(['corner_nw', 'corner_sw'])
};
export const GEAR_PITCH_RADIUS_LOCAL = Math.SQRT2 / 4;
export const GEAR_ROOT_RADIUS_LOCAL = GEAR_PITCH_RADIUS_LOCAL * 0.78;
export const GEAR_OUTER_RADIUS_LOCAL = GEAR_PITCH_RADIUS_LOCAL * 1.08;
export const GEAR_HUB_RADIUS_LOCAL = GEAR_PITCH_RADIUS_LOCAL * 0.32;
export const GEAR_AXLE_RADIUS_LOCAL = GEAR_PITCH_RADIUS_LOCAL * 0.14;
export const GEAR_TOOTH_COUNT = 18;

export const OPPOSITE_EDGE = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east'
};

export const WALL_EDGE_ENDPOINTS = {
  north: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }],
  south: [{ x: -0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
  west: [{ x: -0.5, y: -0.5 }, { x: -0.5, y: 0.5 }],
  east: [{ x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }]
};

export const WALL_EDGE_TANGENTS = {
  north: { x: 1, y: 0 },
  south: { x: 1, y: 0 },
  west: { x: 0, y: 1 },
  east: { x: 0, y: 1 }
};

export { EDGE_NEIGHBOR_OFFSETS, sameCell };

export const getWallSurfaceRotation = (placement = {}) => wallEdgeToRotation(placement?.edge || 'north');

export const getTransmissionSurfaceRotation = (placement = {}) => normalizeRotation(
  (placement?.transmissionRotation ?? placement?.rotation ?? 0)
  + (Number(placement?.runtimeSurfaceRotation) || 0)
);

export const normalizeCameraYaw = (yaw = 0) => ((yaw % 360) + 360) % 360;

export const normalizeAngleDelta = (delta = 0) => ((delta + 540) % 360) - 180;

export const isBoardMaterial = (panelType) => {
  const material = getCityChannelMaterial(panelType);
  return !!material && material.placeable !== false && !isPortalMaterial(panelType);
};

export const createWallSelectionKey = (wall) => (
  wall ? createWallKey(wall.x, wall.y, wall.z, wall.edge) : ''
);

export const resolveMaterialName = (panelType) => getCityChannelMaterial(panelType)?.name || panelType || '未知物件';

export const getDirectionFromEndpoint = (point = {}) => (
  Math.abs(point.x || 0) >= Math.abs(point.y || 0)
    ? ((point.x || 0) < 0 ? 'west' : 'east')
    : ((point.y || 0) < 0 ? 'north' : 'south')
);

export const rotateDirectionByDegrees = (direction, rotation = 0) => {
  const order = ['north', 'east', 'south', 'west'];
  const index = order.indexOf(direction);
  if (index < 0) return direction;
  const steps = Math.round((((Number(rotation) || 0) % 360 + 360) % 360) / 90) % 4;
  return order[(index + steps) % 4];
};

export const formatAxisCoord = (value = 0) => Number(value || 0).toFixed(3);

export const sameAxisPoint = (a, b) => !!a && !!b
  && Math.abs((a.x || 0) - (b.x || 0)) <= 0.001
  && Math.abs((a.y || 0) - (b.y || 0)) <= 0.001;

export const sameAxisSegment = (a = [], b = []) => (
  Array.isArray(a)
  && Array.isArray(b)
  && a.length >= 2
  && b.length >= 2
  && (
    (sameAxisPoint(a[0], b[0]) && sameAxisPoint(a[1], b[1]))
    || (sameAxisPoint(a[0], b[1]) && sameAxisPoint(a[1], b[0]))
  )
);

export const createLocalRect = ({ left, right, top, bottom } = {}) => ({
  left: Math.min(left, right),
  right: Math.max(left, right),
  top: Math.min(top, bottom),
  bottom: Math.max(top, bottom)
});

export const rectContainsPoint = (rect, point) => !!rect && !!point
  && point.x >= rect.left
  && point.x <= rect.right
  && point.y >= rect.top
  && point.y <= rect.bottom;

export const expandRect = (rect, padding = 0) => (rect ? ({
  left: rect.left - padding,
  right: rect.right + padding,
  top: rect.top - padding,
  bottom: rect.bottom + padding
}) : null);

export const getPointBounds = (points = []) => {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return createLocalRect({
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys)
  });
};

export const drawLocalPolygon = (graphics, points = [], offsetX = 0, offsetY = 0) => {
  if (!Array.isArray(points) || points.length < 3) return;
  graphics.beginPath();
  graphics.moveTo(points[0].x + offsetX, points[0].y + offsetY);
  points.slice(1).forEach((point) => graphics.lineTo(point.x + offsetX, point.y + offsetY));
  graphics.closePath();
  graphics.fillPath();
  graphics.strokePath();
};

export const drawPolygonShape = drawLocalPolygon;

const createGearPoints = (outerRadius = 18, innerRadius = 13, teeth = 10) => {
  const points = [];
  const total = teeth * 2;
  for (let index = 0; index < total; index += 1) {
    const angle = ((Math.PI * 2) / total) * index;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    points.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    });
  }
  return points;
};

export const rotateLocalPoint = (point, degrees = 0) => {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: (point.x * Math.cos(radians)) - (point.y * Math.sin(radians)),
    y: (point.x * Math.sin(radians)) + (point.y * Math.cos(radians))
  };
};

export const drawGearShape = (graphics, cx, cy, outerRadius, innerRadius, teeth, angle = 0) => {
  const points = createGearPoints(outerRadius, innerRadius, teeth)
    .map((point) => rotateLocalPoint(point, angle));
  drawLocalPolygon(graphics, points, cx, cy);
};

export const drawJoint = (graphics, x, y, radius = 4, fill = 0xf8fafc) => {
  graphics.fillStyle(0x020617, 0.9);
  graphics.fillCircle(x, y, radius + 2);
  graphics.lineStyle(1, 0xcbd5e1, 0.58);
  graphics.strokeCircle(x, y, radius + 2);
  graphics.fillStyle(fill, 0.92);
  graphics.fillCircle(x, y, radius);
};

export const drawLink = (graphics, start, end, color = 0xcbd5e1, width = 4, alpha = 0.9) => {
  graphics.lineStyle(width + 2, 0x020617, 0.6);
  graphics.lineBetween(start.x, start.y, end.x, end.y);
  graphics.lineStyle(width, color, alpha);
  graphics.lineBetween(start.x, start.y, end.x, end.y);
};

export const drawCoilSpring = (graphics, x, y1, y2, compression = 0) => {
  const turns = 5;
  const height = Math.max(10, y2 - y1);
  const amplitude = 5 - (compression * 1.6);
  const points = [];
  for (let index = 0; index <= turns * 2; index += 1) {
    const t = index / (turns * 2);
    points.push({
      x: x + (index % 2 === 0 ? -amplitude : amplitude),
      y: y1 + (height * t)
    });
  }
  graphics.lineStyle(2, 0x93c5fd, 0.72);
  graphics.beginPath();
  points.forEach((point, index) => {
    if (index === 0) graphics.moveTo(point.x, point.y);
    else graphics.lineTo(point.x, point.y);
  });
  graphics.strokePath();
};

export const normalizeVector = (vector) => {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= 0.001) return { x: 1, y: 0 };
  return {
    x: vector.x / length,
    y: vector.y / length
  };
};

export const distancePointToSegmentSquared = (point, start, end) => {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const wx = point.x - start.x;
  const wy = point.y - start.y;
  const lengthSquared = (vx * vx) + (vy * vy);
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((wx * vx) + (wy * vy)) / lengthSquared)) : 0;
  const px = start.x + (vx * t);
  const py = start.y + (vy * t);
  const dx = point.x - px;
  const dy = point.y - py;
  return (dx * dx) + (dy * dy);
};

export const getPortalPolygons = (cameraYaw = 0, rotation = 0) => {
  const portal = createPortalGeometry(cameraYaw, rotation);
  return [
    portal.threshold.front,
    portal.threshold.side,
    portal.threshold.top,
    portal.leftPillar.front,
    portal.leftPillar.side,
    portal.leftPillar.top,
    portal.rightPillar.front,
    portal.rightPillar.side,
    portal.rightPillar.top,
    portal.lintel.front,
    portal.lintel.side,
    portal.lintel.top,
    portal.arch.front,
    portal.arch.top
  ].filter((polygon) => Array.isArray(polygon) && polygon.length >= 3);
};
