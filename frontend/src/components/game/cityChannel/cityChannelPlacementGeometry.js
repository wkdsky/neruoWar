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

const PANEL_THICKNESS = 0.08;
const WALL_THICKNESS = 0.08;
const BOX_EPSILON = 0.0001;

export const isPortalMaterial = (panelType) => (
  panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || panelType === CITY_CHANNEL_TILE_TYPES.EXIT
);

export const isFloorSupportPlacement = (placement) => (
  !!placement
  && !placement.edge
  && !placement.isVertical
);

export const sameCell = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;

const rotatePoint = (point, degrees = 0) => {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: (point.x * Math.cos(radians)) - (point.y * Math.sin(radians)),
    y: (point.x * Math.sin(radians)) + (point.y * Math.cos(radians))
  };
};

const dotVector3 = (left = {}, right = {}) => (
  ((Number(left.x) || 0) * (Number(right.x) || 0))
  + ((Number(left.y) || 0) * (Number(right.y) || 0))
  + ((Number(left.z) || 0) * (Number(right.z) || 0))
);

const subtractVector3 = (left = {}, right = {}) => ({
  x: (Number(left.x) || 0) - (Number(right.x) || 0),
  y: (Number(left.y) || 0) - (Number(right.y) || 0),
  z: (Number(left.z) || 0) - (Number(right.z) || 0)
});

const crossVector3 = (left = {}, right = {}) => ({
  x: ((Number(left.y) || 0) * (Number(right.z) || 0)) - ((Number(left.z) || 0) * (Number(right.y) || 0)),
  y: ((Number(left.z) || 0) * (Number(right.x) || 0)) - ((Number(left.x) || 0) * (Number(right.z) || 0)),
  z: ((Number(left.x) || 0) * (Number(right.y) || 0)) - ((Number(left.y) || 0) * (Number(right.x) || 0))
});

const getVector3Length = (vector = {}) => Math.hypot(
  Number(vector.x) || 0,
  Number(vector.y) || 0,
  Number(vector.z) || 0
);

const normalizeVector3 = (vector = {}, fallback = { x: 1, y: 0, z: 0 }) => {
  const length = getVector3Length(vector);
  if (length <= BOX_EPSILON) return fallback;
  return {
    x: (Number(vector.x) || 0) / length,
    y: (Number(vector.y) || 0) / length,
    z: (Number(vector.z) || 0) / length
  };
};

const addScaledVector3 = (point = {}, axis = {}, scale = 0) => ({
  x: (Number(point.x) || 0) + ((Number(axis.x) || 0) * scale),
  y: (Number(point.y) || 0) + ((Number(axis.y) || 0) * scale),
  z: (Number(point.z) || 0) + ((Number(axis.z) || 0) * scale)
});

const createBox = ({ minX, maxX, minY, maxY, minZ, maxZ }) => ({
  minX,
  maxX,
  minY,
  maxY,
  minZ,
  maxZ
});

const getVertexBounds = (vertices = []) => vertices.reduce((bounds, vertex) => ({
  minX: Math.min(bounds.minX, vertex.x),
  maxX: Math.max(bounds.maxX, vertex.x),
  minY: Math.min(bounds.minY, vertex.y),
  maxY: Math.max(bounds.maxY, vertex.y),
  minZ: Math.min(bounds.minZ, vertex.z),
  maxZ: Math.max(bounds.maxZ, vertex.z)
}), {
  minX: Infinity,
  maxX: -Infinity,
  minY: Infinity,
  maxY: -Infinity,
  minZ: Infinity,
  maxZ: -Infinity
});

const createObb = ({ center = {}, axes = [], halfSizes = [] } = {}) => ({
  center: {
    x: Number(center.x) || 0,
    y: Number(center.y) || 0,
    z: Number(center.z) || 0
  },
  axes: [
    normalizeVector3(axes[0], { x: 1, y: 0, z: 0 }),
    normalizeVector3(axes[1], { x: 0, y: 1, z: 0 }),
    normalizeVector3(axes[2], { x: 0, y: 0, z: 1 })
  ],
  halfSizes: [
    Math.max(0, Number(halfSizes[0]) || 0),
    Math.max(0, Number(halfSizes[1]) || 0),
    Math.max(0, Number(halfSizes[2]) || 0)
  ]
});

const getObbVertices = (obb = {}) => {
  const vertices = [];
  [-1, 1].forEach((xSign) => {
    [-1, 1].forEach((ySign) => {
      [-1, 1].forEach((zSign) => {
        const withX = addScaledVector3(obb.center, obb.axes[0], xSign * (obb.halfSizes?.[0] || 0));
        const withY = addScaledVector3(withX, obb.axes[1], ySign * (obb.halfSizes?.[1] || 0));
        vertices.push(addScaledVector3(withY, obb.axes[2], zSign * (obb.halfSizes?.[2] || 0)));
      });
    });
  });
  return vertices;
};

const createObbPrism = (obbInput = {}) => {
  const obb = createObb(obbInput);
  const vertices = getObbVertices(obb);
  const bounds = getVertexBounds(vertices);
  return {
    ...bounds,
    points: getRectPoints(bounds),
    minZ: bounds.minZ,
    maxZ: bounds.maxZ,
    obb
  };
};

const getRectPoints = ({ minX, maxX, minY, maxY }) => [
  { x: minX, y: minY },
  { x: maxX, y: minY },
  { x: maxX, y: maxY },
  { x: minX, y: maxY }
];

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

const edgeAxes = {
  north: {
    axis: { x: 1, y: 0 },
    normal: { x: 0, y: -1 },
    originOffset: { x: 0, y: -0.5 }
  },
  south: {
    axis: { x: 1, y: 0 },
    normal: { x: 0, y: 1 },
    originOffset: { x: 0, y: 0.5 }
  },
  west: {
    axis: { x: 0, y: 1 },
    normal: { x: -1, y: 0 },
    originOffset: { x: -0.5, y: 0 }
  },
  east: {
    axis: { x: 0, y: 1 },
    normal: { x: 1, y: 0 },
    originOffset: { x: 0.5, y: 0 }
  }
};

const getVerticalCollisionFrame = (placement = {}) => {
  if (placement.edge) return edgeAxes[placement.edge] || edgeAxes.north;
  const yaw = normalizeRotation(placement.rotation || 0);
  return {
    axis: rotatePoint({ x: 1, y: 0 }, yaw),
    normal: rotatePoint({ x: 0, y: 1 }, yaw),
    originOffset: { x: 0, y: 0 }
  };
};

const getRuntimeSurfaceRotation = (placement = {}) => (
  Number.isFinite(Number(placement.runtimeSurfaceRotation))
    ? Number(placement.runtimeSurfaceRotation)
    : 0
);

const createHorizontalPlacementPrism = (placement = {}, z = 0) => {
  const rotation = normalizeRotation(placement.rotation || 0);
  const radians = (rotation * Math.PI) / 180;
  return createObbPrism({
    center: {
      x: Number(placement.x) || 0,
      y: Number(placement.y) || 0,
      z: z + (PANEL_THICKNESS / 2)
    },
    axes: [
      { x: Math.cos(radians), y: Math.sin(radians), z: 0 },
      { x: -Math.sin(radians), y: Math.cos(radians), z: 0 },
      { x: 0, y: 0, z: 1 }
    ],
    halfSizes: [0.5, 0.5, PANEL_THICKNESS / 2]
  });
};

const createVerticalPlacementPrism = (placement = {}, z = 0) => {
  const frame = getVerticalCollisionFrame(placement);
  const surfaceRotation = getRuntimeSurfaceRotation(placement);
  const radians = (surfaceRotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const edgeNormalOffset = placement.edge ? -(WALL_THICKNESS / 2) : 0;
  return createObbPrism({
    center: {
      x: (Number(placement.x) || 0)
        + (frame.originOffset.x || 0)
        + ((frame.normal.x || 0) * edgeNormalOffset),
      y: (Number(placement.y) || 0)
        + (frame.originOffset.y || 0)
        + ((frame.normal.y || 0) * edgeNormalOffset),
      z: z + 0.5
    },
    axes: [
      { x: (frame.axis.x || 0) * cos, y: (frame.axis.y || 0) * cos, z: -sin },
      { x: (frame.axis.x || 0) * sin, y: (frame.axis.y || 0) * sin, z: cos },
      { x: frame.normal.x || 0, y: frame.normal.y || 0, z: 0 }
    ],
    halfSizes: [
      0.5,
      0.5,
      WALL_THICKNESS / 2
    ]
  });
};

export const getCityChannelPlacementCollisionPrisms = (placement) => {
  if (!placement) return [];
  const z = Number(placement.z) || 0;
  const prisms = [];

  if (!placement.edge && !placement.isVertical) {
    prisms.push(createHorizontalPlacementPrism(placement, z));
  }

  if (placement.edge || placement.isVertical) {
    prisms.push(createVerticalPlacementPrism(placement, z));
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

const getPolygonPenetration = (pointsA = [], pointsB = [], epsilon = BOX_EPSILON) => {
  if (pointsA.length < 3 || pointsB.length < 3) return 0;
  const axes = [...getPolygonAxes(pointsA), ...getPolygonAxes(pointsB)];
  let minPenetration = Infinity;
  for (const axis of axes) {
    const rangeA = projectPolygon(pointsA, axis);
    const rangeB = projectPolygon(pointsB, axis);
    const overlap = Math.min(rangeA.max, rangeB.max) - Math.max(rangeA.min, rangeB.min);
    if (overlap <= epsilon) return 0;
    minPenetration = Math.min(minPenetration, overlap);
  }
  return Number.isFinite(minPenetration) ? minPenetration : 0;
};

const obbsIntersect = (a = {}, b = {}, epsilon = BOX_EPSILON) => {
  if (!a?.obb || !b?.obb) return false;
  const axes = [
    ...(a.obb.axes || []),
    ...(b.obb.axes || [])
  ];
  (a.obb.axes || []).forEach((leftAxis) => {
    (b.obb.axes || []).forEach((rightAxis) => {
      const crossAxis = crossVector3(leftAxis, rightAxis);
      if (getVector3Length(crossAxis) > BOX_EPSILON) {
        axes.push(normalizeVector3(crossAxis));
      }
    });
  });
  const centerDelta = subtractVector3(a.obb.center, b.obb.center);
  let minPenetration = Infinity;
  for (const axis of axes) {
    const leftRadius = (a.obb.axes || []).reduce((sum, obbAxis, index) => (
      sum + Math.abs(dotVector3(obbAxis, axis)) * (a.obb.halfSizes?.[index] || 0)
    ), 0);
    const rightRadius = (b.obb.axes || []).reduce((sum, obbAxis, index) => (
      sum + Math.abs(dotVector3(obbAxis, axis)) * (b.obb.halfSizes?.[index] || 0)
    ), 0);
    const overlap = (leftRadius + rightRadius) - Math.abs(dotVector3(centerDelta, axis));
    if (overlap <= epsilon) return false;
    minPenetration = Math.min(minPenetration, overlap);
  }
  return {
    intersecting: true,
    penetration: Number.isFinite(minPenetration) ? minPenetration : 0
  };
};

export const collisionPrismsIntersect = (a, b, epsilon = BOX_EPSILON) => (
  !!boxesIntersect(a, b, epsilon) && (
    a?.obb && b?.obb
      ? !!obbsIntersect(a, b, epsilon)
      : polygonsIntersect(a.points || [], b.points || [], epsilon)
  )
);

export const getCollisionPrismPenetration = (a, b, epsilon = BOX_EPSILON) => {
  if (!boxesIntersect(a, b, epsilon)) return 0;
  if (a?.obb && b?.obb) {
    const result = obbsIntersect(a, b, epsilon);
    return result?.penetration || 0;
  }
  const zOverlap = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (zOverlap <= epsilon) return 0;
  const xyOverlap = getPolygonPenetration(a.points || [], b.points || [], epsilon);
  if (xyOverlap <= epsilon) return 0;
  return Math.min(zOverlap, xyOverlap);
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
