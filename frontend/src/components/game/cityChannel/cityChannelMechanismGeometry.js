import {
  rotateWorldPoint,
  projectLocalPoint,
  createBox,
  createCylinder,
  createGearShape
} from './cityChannelGeometryUtils';

const buildPartGeometry = (part, cameraYaw, tileRotation) => {
  const { shape, params, color, opacity } = part;

  if (shape === 'box') {
    const geo = createBox(
      cameraYaw,
      params.x1, params.y1, params.x2, params.y2,
      params.bottomLift, params.topLift,
      Math.abs(params.topLift - params.bottomLift),
      tileRotation
    );
    return { ...geo, color, opacity };
  }

  if (shape === 'cylinder') {
    const geo = createCylinder(
      cameraYaw,
      params.cx, params.cy, params.radius,
      params.bottomLift, params.topLift,
      8,
      tileRotation
    );
    return { ...geo, color, opacity };
  }

  if (shape === 'gear') {
    const geo = createGearShape(
      cameraYaw,
      params.cx, params.cy,
      params.outerR, params.innerR, params.teeth,
      params.bottomLift, params.topLift,
      tileRotation
    );
    return { ...geo, color, opacity };
  }

  return null;
};

const buildConnectorPositions = (connectors, cameraYaw, tileRotation) => {
  if (!Array.isArray(connectors) || connectors.length === 0) return [];
  return connectors.map((connector) => {
    if (!connector || !connector.position) return null;
    const { dx, dy } = connector.position;
    const rotated = rotateWorldPoint({ x: dx * 0.8, y: dy * 0.8 }, tileRotation);
    const projected = projectLocalPoint(rotated.x, rotated.y, cameraYaw);
    return {
      id: connector.id,
      label: connector.label || connector.id,
      direction: connector.direction || 'out',
      screenX: projected.x,
      screenY: projected.y - 10
    };
  }).filter(Boolean);
};
export const getMechanismGeometry = (mechanismModel, connectors, tileRotation, cameraYaw) => {
  if (!mechanismModel || !Array.isArray(mechanismModel.parts)) {
    return { polygons: [], connectorPositions: [] };
  }

  const polygons = [];
  mechanismModel.parts.forEach((part) => {
    const geo = buildPartGeometry(part, cameraYaw, tileRotation);
    if (!geo) return;

    if (geo.topFace) {
      polygons.push({
        points: geo.topFace,
        fill: geo.color,
        stroke: geo.color,
        opacity: geo.opacity,
        face: 'top'
      });
    }
    if (geo.frontFace) {
      polygons.push({
        points: geo.frontFace,
        fill: geo.color,
        stroke: geo.color,
        opacity: (geo.opacity || 0.85) * 0.75,
        face: 'front'
      });
    }
    if (geo.sideFace) {
      polygons.push({
        points: geo.sideFace,
        fill: geo.color,
        stroke: geo.color,
        opacity: (geo.opacity || 0.85) * 0.6,
        face: 'side'
      });
    }
  });

  const connectorPositions = buildConnectorPositions(connectors, cameraYaw, tileRotation);

  return { polygons, connectorPositions };
};
