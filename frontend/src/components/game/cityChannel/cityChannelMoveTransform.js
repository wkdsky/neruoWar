import {
  normalizeRotation,
  wallEdgeToRotation
} from './cityChannelSchema';
import { EDGE_NEIGHBOR_OFFSETS } from './cityChannelPlacementGeometry';

export const rotateOffsetBySteps = (dx = 0, dy = 0, steps = 0) => {
  const normalized = ((steps % 4) + 4) % 4;
  if (normalized === 1) return { x: -dy, y: dx };
  if (normalized === 2) return { x: -dx, y: -dy };
  if (normalized === 3) return { x: dy, y: -dx };
  return { x: dx, y: dy };
};

const rotateVectorYawBySteps = ({ x = 0, y = 0, z = 0 } = {}, steps = 0) => {
  const rotated = rotateOffsetBySteps(x, y, steps);
  return {
    x: rotated.x,
    y: rotated.y,
    z
  };
};

const rotateVectorPitchByQuarter = ({ x = 0, y = 0, z = 0 } = {}, quarterTurns = 0) => {
  const normalized = ((quarterTurns % 4) + 4) % 4;
  if (normalized === 1) {
    // Roll forward 90 degrees around the local X axis.
    return { x, y: -z, z: y };
  }
  if (normalized === 2) return { x, y: -y, z: -z };
  if (normalized === 3) return { x, y: z, z: -y };
  return { x, y, z };
};

const roundGrid = (value = 0) => Math.round(Number(value) || 0);

const rotationToWallEdge = (rotation = 0) => {
  const normalized = ((Number(rotation) || 0) % 360 + 360) % 360;
  if (normalized === 90) return 'east';
  if (normalized === 180) return 'south';
  if (normalized === 270) return 'west';
  return 'north';
};

export const getEdgeCenterOffset = (edge = 'north') => {
  const offset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
  return {
    x: offset.x * 0.5,
    y: offset.y * 0.5
  };
};

export const getPlacementRigidPoint = (origin = {}, placement = null) => {
  const edge = origin.edge || placement?.edge || null;
  const edgeOffset = edge ? getEdgeCenterOffset(edge) : { x: 0, y: 0 };
  return {
    x: (Number(origin.x) || 0) + edgeOffset.x,
    y: (Number(origin.y) || 0) + edgeOffset.y,
    z: Number(origin.z) || 0
  };
};

export const getPlacementShapeRotation = (origin = {}, placement = null) => normalizeRotation(
  placement?.rotation
    ?? (origin.edge ? wallEdgeToRotation(origin.edge) : 0)
);

const getPlacementBaseRotation = (origin = {}, placement = null) => (
  origin.edge || placement?.edge ? wallEdgeToRotation(origin.edge || placement?.edge) : 0
);

const getPlacementSurfaceRotation = (origin = {}, placement = null) => normalizeRotation(
  placement?.transmissionRotation
    ?? placement?.rotation
    ?? (origin.edge ? wallEdgeToRotation(origin.edge) : 0)
);

const getPlacementWorldSurfaceRotation = (origin = {}, placement = null) => normalizeRotation(
  getPlacementBaseRotation(origin, placement) + getPlacementSurfaceRotation(origin, placement)
);

const rotateRotationBySteps = (rotation = 0, steps = 0) => normalizeRotation(rotation + (steps * 90));

export const getRotationSteps = (rotation = 0) => Math.round(normalizeRotation(rotation) / 90) % 4;

const rotateVectorPitchAroundYawByQuarter = (vector, axisSteps = 0, quarterTurns = 0) => {
  const normalizedQuarterTurns = ((quarterTurns % 4) + 4) % 4;
  if (normalizedQuarterTurns === 0) return vector;
  const local = rotateVectorYawBySteps(vector, -axisSteps);
  const pitched = rotateVectorPitchByQuarter(local, normalizedQuarterTurns);
  return rotateVectorYawBySteps(pitched, axisSteps);
};

export const createRigidTransform = ({
  sourceCenterPoint,
  normalizedRotationSteps,
  poseQuarterTurns,
  basisRotationSteps
}) => {
  const axisSteps = (basisRotationSteps + normalizedRotationSteps + 4) % 4;
  return (point = {}) => {
    const offset = {
      x: (Number(point.x) || 0) - sourceCenterPoint.x,
      y: (Number(point.y) || 0) - sourceCenterPoint.y,
      z: (Number(point.z) || 0) - sourceCenterPoint.z
    };
    const yawed = rotateVectorYawBySteps(offset, normalizedRotationSteps);
    const transformed = rotateVectorPitchAroundYawByQuarter(yawed, axisSteps, poseQuarterTurns);
    return {
      x: sourceCenterPoint.x + transformed.x,
      y: sourceCenterPoint.y + transformed.y,
      z: sourceCenterPoint.z + transformed.z
    };
  };
};

const rotateVectorWithRigidParams = (
  vector,
  normalizedRotationSteps = 0,
  poseQuarterTurns = 0,
  basisRotationSteps = 0
) => {
  const axisSteps = (basisRotationSteps + normalizedRotationSteps + 4) % 4;
  const yawed = rotateVectorYawBySteps(vector, normalizedRotationSteps);
  return rotateVectorPitchAroundYawByQuarter(yawed, axisSteps, poseQuarterTurns);
};

const vectorToWallEdge = (vector = {}) => {
  const absX = Math.abs(Number(vector.x) || 0);
  const absY = Math.abs(Number(vector.y) || 0);
  if (absX >= absY) {
    return (Number(vector.x) || 0) >= 0 ? 'east' : 'west';
  }
  return (Number(vector.y) || 0) >= 0 ? 'south' : 'north';
};

const vectorToShapeRotation = (vector = {}) => normalizeRotation(
  Math.round((Math.atan2(Number(vector.y) || 0, Number(vector.x) || 0) * 180) / Math.PI / 90) * 90
);

const getPlacementLocalBasis = (origin = {}, placement = null) => {
  const surfaceSteps = getRotationSteps(getPlacementSurfaceRotation(origin, placement));
  const tangent = rotateOffsetBySteps(1, 0, surfaceSteps);

  if (origin.edge || placement?.edge) {
    const edge = origin.edge || placement.edge;
    const offset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
    return {
      normal: { x: offset.x, y: offset.y, z: 0 },
      tangent: { x: tangent.x, y: tangent.y, z: 0 },
      sourceKind: 'wall'
    };
  }

  if (placement?.isVertical) {
    const faceSteps = getRotationSteps(getPlacementShapeRotation(origin, placement));
    const normal = rotateOffsetBySteps(0, -1, faceSteps);
    return {
      normal: { x: normal.x, y: normal.y, z: 0 },
      tangent: { x: tangent.x, y: tangent.y, z: 0 },
      sourceKind: 'vertical'
    };
  }

  return {
    normal: { x: 0, y: 0, z: 1 },
    tangent: { x: tangent.x, y: tangent.y, z: 0 },
    sourceKind: 'floor'
  };
};

const withLocalSurfaceRotation = (shape) => ({
  ...shape,
  surfaceRotation: normalizeRotation(
    shape.worldSurfaceRotation - (shape.edge ? wallEdgeToRotation(shape.edge) : 0)
  )
});

const deriveShapeFromRigidTransform = ({
  origin,
  sourcePlacement,
  normalizedRotationSteps,
  normalizedGroupPoseSteps,
  basisRotationSteps
}) => {
  const basis = getPlacementLocalBasis(origin, sourcePlacement);
  const transformedNormal = rotateVectorWithRigidParams(
    basis.normal,
    normalizedRotationSteps,
    normalizedGroupPoseSteps,
    basisRotationSteps
  );
  const transformedTangent = rotateVectorWithRigidParams(
    basis.tangent,
    normalizedRotationSteps,
    normalizedGroupPoseSteps,
    basisRotationSteps
  );
  const absX = Math.abs(transformedNormal.x);
  const absY = Math.abs(transformedNormal.y);
  const absZ = Math.abs(transformedNormal.z);
  const sourceWorldSurfaceRotation = getPlacementWorldSurfaceRotation(origin, sourcePlacement);
  const rotatedWorldSurfaceRotation = rotateRotationBySteps(sourceWorldSurfaceRotation, normalizedRotationSteps);
  const shapeRotationFromTangent = vectorToShapeRotation(transformedTangent);
  const target = {
    shapeRotation: shapeRotationFromTangent,
    worldSurfaceRotation: rotatedWorldSurfaceRotation,
    includeRotation: true
  };

  if (absZ >= absX && absZ >= absY) {
    if (basis.sourceKind === 'wall' || origin.edge) {
      return withLocalSurfaceRotation({ ...target, layFlat: true });
    }
    if (basis.sourceKind === 'vertical') {
      return withLocalSurfaceRotation({ ...target, layFlat: true });
    }
    return withLocalSurfaceRotation(target);
  }

  const edge = vectorToWallEdge(transformedNormal);
  if (basis.sourceKind === 'wall' || origin.edge) {
    return withLocalSurfaceRotation({
      ...target,
      edge,
      shapeRotation: wallEdgeToRotation(edge)
    });
  }
  if (basis.sourceKind === 'vertical') {
    return withLocalSurfaceRotation({
      ...target,
      isVertical: true,
      shapeRotation: shapeRotationFromTangent
    });
  }
  return withLocalSurfaceRotation({
    ...target,
    isVertical: true,
    shapeRotation: shapeRotationFromTangent
  });
};

export const getPlacementTargetShape = ({
  origin,
  sourcePlacement,
  targetCell,
  originsLength,
  normalizedGroupPoseSteps,
  normalizedRotationSteps,
  basisRotationSteps,
  layFlatTarget
}) => {
  const normalizedPoseSteps = ((normalizedGroupPoseSteps % 4) + 4) % 4;
  const hasGroupTransform = originsLength > 1 && (normalizedRotationSteps !== 0 || normalizedPoseSteps !== 0);

  if (hasGroupTransform) {
    return deriveShapeFromRigidTransform({
      origin,
      sourcePlacement,
      normalizedRotationSteps,
      normalizedGroupPoseSteps: normalizedPoseSteps,
      basisRotationSteps
    });
  }

  const sourceShapeRotation = getPlacementShapeRotation(origin, sourcePlacement);
  const sourceWorldSurfaceRotation = getPlacementWorldSurfaceRotation(origin, sourcePlacement);
  const rotatedShapeRotation = rotateRotationBySteps(sourceShapeRotation, normalizedRotationSteps);
  const rotatedWorldSurfaceRotation = rotateRotationBySteps(sourceWorldSurfaceRotation, normalizedRotationSteps);
  const target = {
    shapeRotation: targetCell.rotation !== undefined
      ? normalizeRotation(targetCell.rotation)
      : rotatedShapeRotation,
    worldSurfaceRotation: targetCell.rotation !== undefined
      ? normalizeRotation(targetCell.rotation)
      : rotatedWorldSurfaceRotation,
    includeRotation: targetCell.rotation !== undefined
  };

  if (targetCell.edge && originsLength === 1) {
    return withLocalSurfaceRotation({
      ...target,
      edge: targetCell.edge
    });
  }
  if (origin.edge && !layFlatTarget) {
    return withLocalSurfaceRotation({
      ...target,
      edge: rotationToWallEdge(rotateRotationBySteps(wallEdgeToRotation(origin.edge), normalizedRotationSteps))
    });
  }
  if (layFlatTarget) {
    return withLocalSurfaceRotation({
      ...target,
      layFlat: true
    });
  }
  if (targetCell.isVertical && !targetCell.edge && originsLength === 1) {
    // 沿上边沿竖直向上搭：目标格竖直占位，ghost 竖直渲染。
    return withLocalSurfaceRotation({
      ...target,
      isVertical: true
    });
  }
  return withLocalSurfaceRotation(target);
};

export const createPlacementTargetCell = ({
  transformedPoint,
  targetShape,
  dx,
  dy,
  dz
}) => {
  const edgeOffset = targetShape.edge ? getEdgeCenterOffset(targetShape.edge) : { x: 0, y: 0 };
  return {
    x: roundGrid(transformedPoint.x + dx - edgeOffset.x),
    y: roundGrid(transformedPoint.y + dy - edgeOffset.y),
    z: roundGrid(transformedPoint.z + dz)
  };
};
