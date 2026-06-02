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

const createPrism = ({ points = [], minZ, maxZ }) => ({
  ...getPointBounds(points),
  points,
  minZ,
  maxZ
});

const getRectPoints = ({ minX, maxX, minY, maxY }) => [
  { x: minX, y: minY },
  { x: maxX, y: minY },
  { x: maxX, y: maxY },
  { x: minX, y: maxY }
];

const translatePoints = (points = [], placement = {}) => points.map((point) => ({
  x: (Number(placement.x) || 0) + point.x,
  y: (Number(placement.y) || 0) + point.y
}));

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

const getRotatedTileFootprintPoints = (rotation = 0) => (
  [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 }
  ].map((point) => rotatePoint(point, rotation))
);

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

export const getCityChannelPlacementCollisionPrisms = (placement) => {
  if (!placement) return [];
  const z = Number(placement.z) || 0;
  const prisms = [];

  if (!placement.edge && !placement.isVertical) {
    prisms.push(createPrism({
      points: translatePoints(getRotatedTileFootprintPoints(placement.rotation || 0), placement),
      minZ: z,
      maxZ: z + PANEL_THICKNESS
    }));
  }

  if (placement.edge || placement.isVertical) {
    const wallFootprint = placement.edge
      ? getEdgeWallFootprint(placement.edge)
      : getCellVerticalFootprint(placement.rotation || 0);
    prisms.push(createPrism({
      points: translatePoints(getRectPoints(wallFootprint), placement),
      minZ: z + PANEL_THICKNESS + BOX_EPSILON,
      maxZ: z + 1
    }));
  }

  return prisms;
};

export const getCityChannelPlacementCollisionBoxes = (placement) => (
  getCityChannelPlacementCollisionPrisms(placement).map((prism) => createBox(prism))
);

const getPolygonAxes = (points = []) => {
  const axes = [];
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    const dx = (to.x || 0) - (from.x || 0);
    const dy = (to.y || 0) - (from.y || 0);
    const length = Math.hypot(dx, dy);
    if (length <= BOX_EPSILON) continue;
    axes.push({ x: -dy / length, y: dx / length });
  }
  return axes;
};

const projectPolygon = (points = [], axis = {}) => points.reduce((range, point) => {
  const value = ((point.x || 0) * (axis.x || 0)) + ((point.y || 0) * (axis.y || 0));
  return {
    min: Math.min(range.min, value),
    max: Math.max(range.max, value)
  };
}, { min: Infinity, max: -Infinity });

const polygonsIntersect = (pointsA = [], pointsB = [], epsilon = BOX_EPSILON) => {
  if (pointsA.length < 3 || pointsB.length < 3) return false;
  const axes = [...getPolygonAxes(pointsA), ...getPolygonAxes(pointsB)];
  return axes.every((axis) => {
    const rangeA = projectPolygon(pointsA, axis);
    const rangeB = projectPolygon(pointsB, axis);
    return !(
      rangeA.max <= rangeB.min + epsilon
      || rangeB.max <= rangeA.min + epsilon
    );
  });
};

export const collisionPrismsIntersect = (a, b, epsilon = BOX_EPSILON) => (
  boxesIntersect(a, b, epsilon)
  && polygonsIntersect(a.points || [], b.points || [], epsilon)
);

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
