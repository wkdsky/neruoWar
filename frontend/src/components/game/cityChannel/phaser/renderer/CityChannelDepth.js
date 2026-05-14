import {
  CITY_CHANNEL_PHYSICAL_LAYERS,
  CITY_CHANNEL_SORT_PHASES
} from '../../cityChannelDomainModel';
import { projectWorldOffset, TILE_HEIGHT } from '../../cityChannelGeometryUtils';
import { projectCell } from './CityChannelGeometry';

const edgeEndpointsByEdge = {
  north: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }],
  south: [{ x: -0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
  west: [{ x: -0.5, y: -0.5 }, { x: -0.5, y: 0.5 }],
  east: [{ x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }]
};

const getProjectedBias = (points, cameraYaw) => {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const projectedY = Math.max(...points.map((point) => projectWorldOffset(point.x, point.y, cameraYaw).y));
  return Math.round((projectedY / (TILE_HEIGHT / 2)) * 100);
};

export const getCellVerticalEndpoints = (rotation = 0) => {
  const normalized = ((Number.parseInt(rotation, 10) || 0) % 180 + 180) % 180;
  return normalized === 90
    ? [{ x: 0, y: -0.5 }, { x: 0, y: 0.5 }]
    : [{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }];
};

export const getPlacementDepth = ({
  cell,
  partType = 'floor_base',
  physicalLayer = CITY_CHANNEL_PHYSICAL_LAYERS.FLOOR_BASE,
  edge = null,
  rotation = 0,
  cameraYaw = 0,
  mapData = {},
  subBias = 0
}) => {
  const projection = projectCell(cell, cameraYaw, mapData);
  let depthBias = 0;
  if (edge) {
    depthBias = getProjectedBias(edgeEndpointsByEdge[edge] || edgeEndpointsByEdge.north, cameraYaw);
  } else if (
    partType === 'wall_plane'
    || partType === 'wall_attachment'
    || partType === 'portal_body'
    || partType === 'mechanism_connector'
  ) {
    depthBias = getProjectedBias(getCellVerticalEndpoints(rotation), cameraYaw);
  }
  const sortDepth = projection.depth + depthBias;
  const phase = CITY_CHANNEL_SORT_PHASES[physicalLayer] ?? 0;
  return (sortDepth * 1000) + (phase * 10) + subBias;
};
