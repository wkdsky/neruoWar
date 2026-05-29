import {
  CITY_CHANNEL_TILE_TYPES,
  createCellKey,
  normalizeRotation
} from './cityChannelSchema';

export const EDGE_NEIGHBOR_OFFSETS = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 }
};

const PANEL_THICKNESS = 0.16;
const WALL_THICKNESS = 0.12;
const BOX_EPSILON = 0.0001;

export const isPortalMaterial = (panelType) => (
  panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || panelType === CITY_CHANNEL_TILE_TYPES.EXIT
);

export const isFloorSupportPlacement = (placement) => (
  !!placement
  && !placement.edge
  && !placement.isVertical
  && !isPortalMaterial(placement.panelType)
);

export const sameCell = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;

const rotatePoint = (point, degrees = 0) => {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: (point.x * Math.cos(radians)) - (point.y * Math.sin(radians)),
    y: (point.x * Math.sin(radians)) + (point.y * Math.cos(radians))
  };
};

const getPointBounds = (points = []) => points.reduce((bounds, point) => ({
  minX: Math.min(bounds.minX, point.x),
  maxX: Math.max(bounds.maxX, point.x),
  minY: Math.min(bounds.minY, point.y),
  maxY: Math.max(bounds.maxY, point.y)
}), {
  minX: Infinity,
  maxX: -Infinity,
  minY: Infinity,
  maxY: -Infinity
});

const createBox = ({ minX, maxX, minY, maxY, minZ, maxZ }) => ({
  minX,
  maxX,
  minY,
  maxY,
  minZ,
  maxZ
});

export const boxesIntersect = (a, b, epsilon = BOX_EPSILON) => !!a && !!b && !(
  a.maxX <= b.minX + epsilon
  || a.minX >= b.maxX - epsilon
  || a.maxY <= b.minY + epsilon
  || a.minY >= b.maxY - epsilon
  || a.maxZ <= b.minZ + epsilon
  || a.minZ >= b.maxZ - epsilon
);

export const boxSetsIntersect = (boxesA = [], boxesB = []) => (
  boxesA.some((boxA) => boxesB.some((boxB) => boxesIntersect(boxA, boxB)))
);

const getRotatedTileFootprint = (rotation = 0) => {
  const corners = [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 }
  ].map((point) => rotatePoint(point, rotation));
  return getPointBounds(corners);
};

const getCellVerticalFootprint = (rotation = 0) => {
  const normalizedRotation = normalizeRotation(rotation) % 180;
  return normalizedRotation === 90
    ? { minX: -WALL_THICKNESS / 2, maxX: WALL_THICKNESS / 2, minY: -0.5, maxY: 0.5 }
    : { minX: -0.5, maxX: 0.5, minY: -WALL_THICKNESS / 2, maxY: WALL_THICKNESS / 2 };
};

const getEdgeWallFootprint = (edge = 'north') => {
  if (edge === 'south') return { minX: -0.5, maxX: 0.5, minY: 0.5 - WALL_THICKNESS, maxY: 0.5 };
  if (edge === 'west') return { minX: -0.5, maxX: -0.5 + WALL_THICKNESS, minY: -0.5, maxY: 0.5 };
  if (edge === 'east') return { minX: 0.5 - WALL_THICKNESS, maxX: 0.5, minY: -0.5, maxY: 0.5 };
  return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: -0.5 + WALL_THICKNESS };
};

export const getCityChannelPlacementCollisionBoxes = (placement) => {
  if (!placement) return [];
  const z = Number(placement.z) || 0;
  const boxes = [];

  if (!placement.edge) {
    const floorFootprint = getRotatedTileFootprint(placement.rotation || 0);
    boxes.push(createBox({
      minX: placement.x + floorFootprint.minX,
      maxX: placement.x + floorFootprint.maxX,
      minY: placement.y + floorFootprint.minY,
      maxY: placement.y + floorFootprint.maxY,
      minZ: z,
      maxZ: z + PANEL_THICKNESS
    }));
  }

  if (placement.edge || placement.isVertical) {
    const wallFootprint = placement.edge
      ? getEdgeWallFootprint(placement.edge)
      : getCellVerticalFootprint(placement.rotation || 0);
    boxes.push(createBox({
      minX: placement.x + wallFootprint.minX,
      maxX: placement.x + wallFootprint.maxX,
      minY: placement.y + wallFootprint.minY,
      maxY: placement.y + wallFootprint.maxY,
      minZ: z + PANEL_THICKNESS + BOX_EPSILON,
      maxZ: z + 1
    }));
  }

  return boxes;
};

export const getCityChannelPlacementCollisionBox = (placement) => {
  const boxes = getCityChannelPlacementCollisionBoxes(placement);
  if (boxes.length <= 0) return null;
  return boxes.reduce((combined, box) => createBox({
    minX: Math.min(combined.minX, box.minX),
    maxX: Math.max(combined.maxX, box.maxX),
    minY: Math.min(combined.minY, box.minY),
    maxY: Math.max(combined.maxY, box.maxY),
    minZ: Math.min(combined.minZ, box.minZ),
    maxZ: Math.max(combined.maxZ, box.maxZ)
  }), boxes[0]);
};

export const getWallSupportCellKeys = (placement = {}) => {
  if (!placement?.edge) return [];
  const offset = EDGE_NEIGHBOR_OFFSETS[placement.edge] || EDGE_NEIGHBOR_OFFSETS.north;
  return [
    createCellKey(placement.x, placement.y, placement.z),
    createCellKey(placement.x + offset.x, placement.y + offset.y, placement.z)
  ];
};

export const isSupportCollisionExempt = (movingPlacement = {}, staticPlacement = {}) => {
  if (!movingPlacement || !staticPlacement) return false;
  if (!isFloorSupportPlacement(staticPlacement)) return false;
  if (movingPlacement.edge) {
    return getWallSupportCellKeys(movingPlacement).includes(
      createCellKey(staticPlacement.x, staticPlacement.y, staticPlacement.z)
    );
  }
  return movingPlacement.isVertical && sameCell(movingPlacement, staticPlacement);
};
