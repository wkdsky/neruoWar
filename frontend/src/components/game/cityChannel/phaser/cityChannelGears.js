import { createCellKey, createWallKey, normalizeRotation } from '../cityChannelSchema';
import { projectWorldOffset } from '../cityChannelGeometryUtils';
import { isPortalMaterial } from '../cityChannelMovePreview';
import { getGearMountLocalPosition } from '../cityChannelMechanismRuntime';
import { getCellVerticalEndpoints, getPlacementDepth } from './renderer/CityChannelDepth';
import { isPlacementVisible as isCityChannelPlacementVisible } from './cityChannelPhaserVisibility';
import {
  EDGE_NEIGHBOR_OFFSETS,
  GEAR_SOCKET_BLOCKED_BY_EDGE,
  GEAR_SOCKET_POSITIONS,
  OPPOSITE_EDGE,
  WALL_EDGE_ENDPOINTS,
  rotateDirectionByDegrees,
  rotateLocalPoint,
  sameAxisPoint
} from './cityChannelPhaserSceneUtils';

export const getGearSurfaceNormal = (placement, surfaceSide = 'front') => {
  if (!placement) return { x: 0, y: 1 };
  let normal = { x: 0, y: 1 };
  if (placement.edge) {
    normal = EDGE_NEIGHBOR_OFFSETS[placement.edge] || normal;
  } else if (placement.isVertical) {
    const normalizedRotation = ((Number.parseInt(placement.rotation, 10) || 0) % 180 + 180) % 180;
    normal = normalizedRotation === 90 ? { x: 1, y: 0 } : { x: 0, y: 1 };
  }
  return surfaceSide === 'back'
    ? { x: -normal.x, y: -normal.y }
    : normal;
};

export const getVisibleGearSurfaceSide = (placement, cameraYaw = 0) => {
  if (!placement?.edge && !placement?.isVertical) return 'front';
  const normal = getGearSurfaceNormal(placement, 'front');
  const projected = projectWorldOffset(normal.x, normal.y, cameraYaw);
  return projected.y >= 0 ? 'front' : 'back';
};

export const isGearSurfaceVisible = (placement, mount = {}) => {
  if (!placement || !mount) return false;
  if (!placement.edge && !placement.isVertical) return (mount.surface || 'front') === 'front';
  return true;
};

export const isGearOnCameraSide = (placement, mount = {}, cameraYaw = 0) => {
  if (!placement || !mount) return false;
  if (!placement.edge && !placement.isVertical) return (mount.surface || 'front') === 'front';
  return (mount.surface || 'front') === getVisibleGearSurfaceSide(placement, cameraYaw);
};

export const getMountedGearLayerKey = (hostKind, hostKey, side) => `gear-${side}:${hostKind}:${hostKey}`;

export const getMountedGearHostDepth = ({
  hostKind,
  placement,
  cameraYaw = 0,
  mapData
} = {}) => {
  if (!placement) return 0;
  const cell = { x: placement.x, y: placement.y, z: placement.z };
  if (hostKind === 'wall' || placement.edge) {
    return getPlacementDepth({
      cell,
      partType: 'wall_plane',
      physicalLayer: 'wall_plane',
      edge: placement.edge,
      rotation: placement.rotation || 0,
      cameraYaw,
      mapData
    });
  }
  const isPortal = isPortalMaterial(placement.panelType);
  return getPlacementDepth({
    cell,
    partType: isPortal ? 'portal_body' : placement.isVertical ? 'wall_plane' : 'floor_base',
    physicalLayer: isPortal ? 'portal_body' : placement.isVertical ? 'wall_plane' : 'floor_base',
    rotation: placement.rotation || 0,
    cameraYaw,
    mapData
  });
};

export const getGearHit = ({
  mapData = {},
  cameraYaw = 0,
  zoom = 1,
  visibleLayerCutoff = null,
  localPoint,
  getGearMountPoint
}) => {
  if (!localPoint || typeof getGearMountPoint !== 'function') return null;
  const radius = Math.max(16, 24 / Math.max(0.45, zoom || 1));
  const radiusSquared = radius * radius;
  let best = null;
  Object.entries(mapData.tiles || {}).forEach(([hostKey, tile]) => {
    if (!isCityChannelPlacementVisible(tile, { mapData, visibleLayerCutoff })) return;
    (tile.gearMounts || []).forEach((mount) => {
      if (!isGearOnCameraSide(tile, mount, cameraYaw)) return;
      const point = getGearMountPoint(tile, mount);
      if (!point) return;
      const distanceSquared = ((localPoint.x - point.x) ** 2) + ((localPoint.y - point.y) ** 2);
      if (distanceSquared > radiusSquared) return;
      if (!best || distanceSquared < best.distanceSquared) {
        best = {
          type: 'gear',
          hostKind: 'tile',
          hostKey,
          cell: { x: tile.x, y: tile.y, z: tile.z },
          panelType: tile.panelType,
          mount,
          point,
          distanceSquared,
          snapPriority: 2,
          depth: getPlacementDepth({
            cell: tile,
            partType: 'floor_attachment',
            physicalLayer: 'floor_attachment',
            cameraYaw,
            mapData
          }) + 8
        };
      }
    });
  });
  Object.entries(mapData.walls || {}).forEach(([hostKey, wall]) => {
    if (!isCityChannelPlacementVisible(wall, { mapData, visibleLayerCutoff })) return;
    (wall.gearMounts || []).forEach((mount) => {
      if (!isGearOnCameraSide(wall, mount, cameraYaw)) return;
      const point = getGearMountPoint(wall, mount);
      if (!point) return;
      const distanceSquared = ((localPoint.x - point.x) ** 2) + ((localPoint.y - point.y) ** 2);
      if (distanceSquared > radiusSquared) return;
      if (!best || distanceSquared < best.distanceSquared) {
        best = {
          type: 'gear',
          hostKind: 'wall',
          hostKey,
          cell: { x: wall.x, y: wall.y, z: wall.z },
          edge: wall.edge,
          panelType: wall.panelType,
          mount,
          point,
          distanceSquared,
          snapPriority: 2,
          depth: getPlacementDepth({
            cell: wall,
            partType: 'wall_attachment',
            physicalLayer: 'wall_attachment',
            edge: wall.edge,
            cameraYaw,
            mapData
          }) + 8
        };
      }
    });
  });
  return best;
};

export const createGearHostKey = (placement = {}) => (
  placement.edge
    ? `${placement.z}:${placement.x}:${placement.y}:${placement.edge}`
    : createCellKey(placement.x, placement.y, placement.z)
);

export const getGearSurfaceForHit = (hit) => (hit?.gearSurfacePlane ? (hit.surfaceSide || 'front') : null);

export const getGearHostKey = (hit) => {
  if (!hit?.cell) return '';
  if (hit.type === 'wall') return createWallKey(hit.cell.x, hit.cell.y, hit.cell.z, hit.edge);
  return createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
};

export const getGearHostPlacement = ({ mapData = {}, hit } = {}) => {
  if (!hit?.cell) return null;
  const hostKey = getGearHostKey(hit);
  if (hit.type === 'wall') return mapData.walls?.[hostKey] || hit.wall || null;
  return mapData.tiles?.[hostKey] || hit.tile || null;
};

export const hasVerticalObstructionOnEdge = ({ mapData = {}, cell, edge = 'north' } = {}) => {
  if (!cell) return false;
  if (mapData.walls?.[createWallKey(cell.x, cell.y, cell.z, edge)]) return true;
  const neighborOffset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
  const neighbor = { x: cell.x + neighborOffset.x, y: cell.y + neighborOffset.y, z: cell.z };
  const opposite = OPPOSITE_EDGE[edge] || 'south';
  return !!mapData.walls?.[createWallKey(neighbor.x, neighbor.y, neighbor.z, opposite)];
};

export const getVerticalPlacementSegmentWorld = (placement) => {
  if (!placement) return null;
  const endpoints = placement.edge
    ? (WALL_EDGE_ENDPOINTS[placement.edge] || WALL_EDGE_ENDPOINTS.north)
    : placement.isVertical
      ? getCellVerticalEndpoints(placement.rotation || 0)
      : null;
  if (!endpoints) return null;
  return endpoints.map((point) => ({
    x: (Number(placement.x) || 0) + point.x,
    y: (Number(placement.y) || 0) + point.y,
    z: Number(placement.z) || 0
  }));
};

export const getVerticalSegmentDirection = (segment = []) => {
  if (!Array.isArray(segment) || segment.length < 2) return null;
  const dx = (segment[1].x || 0) - (segment[0].x || 0);
  const dy = (segment[1].y || 0) - (segment[0].y || 0);
  const length = Math.hypot(dx, dy);
  if (length <= 0.001) return null;
  return { x: dx / length, y: dy / length };
};

export const getVerticalSocketEndpointIndex = (placement, localEdge = 'west') => {
  const segment = getVerticalPlacementSegmentWorld(placement);
  if (!segment) return null;
  if (placement.edge) return localEdge === 'west' ? 0 : 1;
  const sideLocal = localEdge === 'west' ? { x: -0.5, y: 0 } : { x: 0.5, y: 0 };
  const rotated = rotateLocalPoint(sideLocal, placement.rotation || 0);
  const sideWorld = {
    x: (Number(placement.x) || 0) + rotated.x,
    y: (Number(placement.y) || 0) + rotated.y,
    z: Number(placement.z) || 0
  };
  const firstDistance = Math.hypot(sideWorld.x - segment[0].x, sideWorld.y - segment[0].y);
  const secondDistance = Math.hypot(sideWorld.x - segment[1].x, sideWorld.y - segment[1].y);
  return firstDistance <= secondDistance ? 0 : 1;
};

export const isVerticalEndpointObstructed = ({ mapData = {}, placement, endpointIndex } = {}) => {
  const segment = getVerticalPlacementSegmentWorld(placement);
  const endpoint = segment?.[endpointIndex];
  const direction = getVerticalSegmentDirection(segment);
  if (!endpoint || !direction) return false;
  const candidates = [
    ...Object.values(mapData.walls || {}),
    ...Object.values(mapData.tiles || {}).filter((tile) => tile?.isVertical)
  ];
  return candidates.some((other) => {
    if (!other || other === placement) return false;
    const otherSegment = getVerticalPlacementSegmentWorld(other);
    const otherDirection = getVerticalSegmentDirection(otherSegment);
    if (!otherSegment || !otherDirection) return false;
    if (Math.abs((Number(other.z) || 0) - endpoint.z) > 0.001) return false;
    const sharesEndpoint = otherSegment.some((point) => sameAxisPoint(point, endpoint));
    if (!sharesEndpoint) return false;
    const dot = Math.abs((direction.x * otherDirection.x) + (direction.y * otherDirection.y));
    return dot < 0.2;
  });
};

export const isGearSocketBlockedBySurface = ({ mapData = {}, placement, socket } = {}) => {
  if (!placement || !socket) return false;
  if (!placement.edge && !placement.isVertical) {
    return Object.entries(GEAR_SOCKET_BLOCKED_BY_EDGE).some(([localEdge, blockedSockets]) => {
      if (!blockedSockets.has(socket)) return false;
      const worldEdge = rotateDirectionByDegrees(localEdge, placement.rotation || 0);
      return hasVerticalObstructionOnEdge({ mapData, cell: placement, edge: worldEdge });
    });
  }
  return ['west', 'east'].some((localEdge) => {
    const blockedSockets = GEAR_SOCKET_BLOCKED_BY_EDGE[localEdge];
    if (!blockedSockets?.has(socket)) return false;
    const endpointIndex = getVerticalSocketEndpointIndex(placement, localEdge);
    return endpointIndex !== null && isVerticalEndpointObstructed({ mapData, placement, endpointIndex });
  });
};

export const hasGearOnSocket = (placement, socket, surface = 'front') => (
  (placement?.gearMounts || []).some((mount) => (
    mount.position === socket && (mount.surface || 'front') === surface
  ))
);

export const getGearSocketsForEdge = (edge = 'north') => GEAR_SOCKET_BLOCKED_BY_EDGE[edge] || new Set();

export const doesGearBlockWall = ({ mapData = {}, cell, edge = 'north' } = {}) => {
  if (!cell) return false;
  const ownTile = mapData.tiles?.[createCellKey(cell.x, cell.y, cell.z)];
  const ownBlockedSockets = getGearSocketsForEdge(edge);
  if ((ownTile?.gearMounts || []).some((mount) => ownBlockedSockets.has(mount.position))) return true;
  const neighborOffset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
  const neighbor = { x: cell.x + neighborOffset.x, y: cell.y + neighborOffset.y, z: cell.z };
  const neighborTile = mapData.tiles?.[createCellKey(neighbor.x, neighbor.y, neighbor.z)];
  const neighborBlockedSockets = getGearSocketsForEdge(OPPOSITE_EDGE[edge] || 'south');
  return (neighborTile?.gearMounts || []).some((mount) => neighborBlockedSockets.has(mount.position));
};

export const projectPointToSurfaceLocal = (point, origin, uAxis, vAxis, rotation = 0) => {
  const px = (point.x || 0) - (origin.x || 0);
  const py = (point.y || 0) - (origin.y || 0);
  const det = (uAxis.x * vAxis.y) - (uAxis.y * vAxis.x);
  if (Math.abs(det) < 0.0001) return null;
  const u = ((px * vAxis.y) - (py * vAxis.x)) / det;
  const v = ((uAxis.x * py) - (uAxis.y * px)) / det;
  return rotateLocalPoint({ x: u - 0.5, y: v - 0.5 }, -rotation);
};

export const getGearSurfaceLocalPointForHit = ({ mapData = {}, hit, getGearSurfaceContext } = {}) => {
  if (!hit?.localSurfacePoint || typeof getGearSurfaceContext !== 'function') return null;
  const placement = getGearHostPlacement({ mapData, hit });
  if (!placement) return null;
  const context = getGearSurfaceContext(placement, getGearSurfaceForHit(hit) || 'front');
  if (!context?.polygon || context.polygon.length < 4) return null;
  const point = hit.localSurfacePoint;
  if (context.surface === 'wall') {
    const [bottomLeft, bottomRight, topRight, topLeft] = context.polygon;
    const uAxis = {
      x: (topRight.x - topLeft.x + bottomRight.x - bottomLeft.x) * 0.5,
      y: (topRight.y - topLeft.y + bottomRight.y - bottomLeft.y) * 0.5
    };
    const vAxis = {
      x: (bottomLeft.x - topLeft.x + bottomRight.x - topRight.x) * 0.5,
      y: (bottomLeft.y - topLeft.y + bottomRight.y - topRight.y) * 0.5
    };
    return projectPointToSurfaceLocal(point, topLeft, uAxis, vAxis, context.rotation);
  }
  const [nw, ne, se, sw] = context.polygon;
  const uAxis = {
    x: (ne.x - nw.x + se.x - sw.x) * 0.5,
    y: (ne.y - nw.y + se.y - sw.y) * 0.5
  };
  const vAxis = {
    x: (sw.x - nw.x + se.x - ne.x) * 0.5,
    y: (sw.y - nw.y + se.y - ne.y) * 0.5
  };
  return projectPointToSurfaceLocal(point, nw, uAxis, vAxis, context.rotation);
};

export const getGearBoardPointForHit = ({
  mapData = {},
  hit,
  socket,
  mapGearLocalPointToSurface
} = {}) => {
  if (!hit?.cell || typeof mapGearLocalPointToSurface !== 'function') return null;
  const placement = getGearHostPlacement({ mapData, hit });
  if (!placement) return null;
  return mapGearLocalPointToSurface(
    placement,
    getGearMountLocalPosition(socket),
    { surface: getGearSurfaceForHit(hit) || 'front' }
  );
};

export const getGearInstallTarget = ({
  mapData = {},
  hitInfo,
  getGearSurfaceContext,
  mapGearLocalPointToSurface
} = {}) => {
  const hit = hitInfo?.hit;
  if (!hit || !['tile', 'wall'].includes(hit.type)) return null;
  if (isPortalMaterial(hit.panelType)) return null;
  const placement = getGearHostPlacement({ mapData, hit });
  if (!placement) return null;
  const surface = getGearSurfaceForHit(hit);
  if (!surface) return null;
  const pointerLocal = getGearSurfaceLocalPointForHit({ mapData, hit, getGearSurfaceContext });
  const candidates = GEAR_SOCKET_POSITIONS.map((socket) => {
    const point = getGearBoardPointForHit({ mapData, hit, socket, mapGearLocalPointToSurface });
    const socketLocal = getGearMountLocalPosition(socket);
    const occupied = hasGearOnSocket(placement, socket, surface);
    const blocked = isGearSocketBlockedBySurface({ mapData, placement, socket });
    return {
      socket,
      point,
      valid: !!point && !occupied && !blocked,
      occupied,
      blocked,
      distance: pointerLocal
        ? Math.hypot((socketLocal.x || 0) - pointerLocal.x, (socketLocal.y || 0) - pointerLocal.y)
        : point && hitInfo.localPoint ? Math.hypot(point.x - hitInfo.localPoint.x, point.y - hitInfo.localPoint.y) : Infinity
    };
  }).filter((candidate) => candidate.point);
  const nearest = candidates.sort((a, b) => a.distance - b.distance)[0];
  if (!nearest) return null;
  return {
    hit,
    cell: hit.cell,
    hostKey: getGearHostKey(hit),
    hostKind: hit.type,
    edge: hit.edge || null,
    surface,
    socket: nearest.socket,
    point: nearest.point,
    placement,
    candidates,
    valid: nearest.valid,
    reason: nearest.occupied ? 'occupied' : nearest.blocked ? 'blocked_by_wall' : 'ok'
  };
};

export const getGearInstallTargetForScene = (scene, hitInfo) => getGearInstallTarget({
  mapData: scene?.mapData,
  hitInfo,
  getGearSurfaceContext: (placement, surface) => scene.getGearSurfaceContext(placement, surface),
  mapGearLocalPointToSurface: (placement, localPosition, options) => (
    scene.mapGearLocalPointToSurface(placement, localPosition, options)
  )
});

export const getGearSurfaceKey = (placement, mount = {}) => {
  const surface = mount.surface || 'front';
  if (!placement) return `unknown:${surface}`;
  if (placement.edge) return `edge:${placement.z || 0}:${placement.edge}:${surface}`;
  if (placement.isVertical) {
    const axis = normalizeRotation(placement.rotation || 0) % 180;
    return `vertical:${placement.z || 0}:${axis}:${surface}`;
  }
  return `floor:${placement.z || 0}:${surface}`;
};

export const getGearContactThreshold = () => 56;

export const buildGearContactGraph = (nodes = [], threshold = getGearContactThreshold()) => {
  const graph = new Map(nodes.map((node) => [node.id, []]));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.surfaceKey !== b.surfaceKey) continue;
      const distance = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
      const pitchContact = (a.pitchRadius || 24) + (b.pitchRadius || 24);
      const contactDistance = Math.max(18, Math.min(threshold, pitchContact * 1.18));
      if (distance > contactDistance) continue;
      if (distance < Math.max(8, pitchContact * 0.28)) continue;
      graph.get(a.id)?.push({ id: b.id, ratio: -((a.pitchRadius || 1) / (b.pitchRadius || 1)) });
      graph.get(b.id)?.push({ id: a.id, ratio: -((b.pitchRadius || 1) / (a.pitchRadius || 1)) });
    }
  }
  return graph;
};

export const getAssemblyComponentDistances = (assembly, sourceComponentKey) => {
  const distances = new Map();
  if (!assembly || !sourceComponentKey) return distances;
  const componentKeys = new Set(assembly.componentKeys || []);
  if (!componentKeys.has(sourceComponentKey)) return distances;
  const adjacency = new Map([...componentKeys].map((key) => [key, []]));
  (assembly.edges || []).forEach((edge) => {
    if (!edge?.componentKey || !edge?.key) return;
    if (!componentKeys.has(edge.componentKey) || !componentKeys.has(edge.key)) return;
    adjacency.get(edge.componentKey)?.push(edge.key);
  });
  const queue = [sourceComponentKey];
  distances.set(sourceComponentKey, 0);
  while (queue.length > 0) {
    const current = queue.shift();
    const nextDistance = (distances.get(current) || 0) + 1;
    (adjacency.get(current) || []).forEach((nextKey) => {
      if (distances.has(nextKey)) return;
      distances.set(nextKey, nextDistance);
      queue.push(nextKey);
    });
  }
  return distances;
};

export const getDrivenGearRoots = (assembly, nodes = [], sourceComponentKey = '') => {
  if (nodes.length <= 0) return [];
  const distances = getAssemblyComponentDistances(assembly, sourceComponentKey);
  const reachable = nodes
    .map((node) => ({ node, distance: distances.has(node.componentKey) ? distances.get(node.componentKey) : Infinity }))
    .filter((item) => Number.isFinite(item.distance));
  if (reachable.length <= 0) return [nodes[0]];
  const minDistance = Math.min(...reachable.map((item) => item.distance));
  return reachable.filter((item) => item.distance === minDistance).map((item) => item.node);
};

export const resolveDrivenGearNodes = ({
  assembly,
  assemblyNodes = [],
  allNodes = [],
  contactGraph = null,
  sourceComponentKey = ''
} = {}) => {
  if (assemblyNodes.length <= 0) return [];
  const byId = new Map(allNodes.map((node) => [node.id, node]));
  const graph = contactGraph || buildGearContactGraph(allNodes);
  const roots = getDrivenGearRoots(assembly, assemblyNodes, sourceComponentKey);
  const visited = new Set();
  const queue = [];
  roots.forEach((root) => {
    if (!root?.id || visited.has(root.id)) return;
    const liveRoot = byId.get(root.id);
    if (!liveRoot) return;
    liveRoot.driveRatio = 1;
    liveRoot.direction = 1;
    visited.add(root.id);
    queue.push(root.id);
  });
  while (queue.length > 0) {
    const currentId = queue.shift();
    const current = byId.get(currentId);
    (graph.get(currentId) || []).forEach((edge) => {
      const nextId = edge.id;
      if (visited.has(nextId)) return;
      const next = byId.get(nextId);
      if (!next || !current) return;
      next.driveRatio = (current.driveRatio || 1) * (edge.ratio || -1);
      next.direction = next.driveRatio >= 0 ? 1 : -1;
      visited.add(nextId);
      queue.push(nextId);
    });
  }
  const driven = allNodes.filter((node) => visited.has(node.id));
  return driven.length > 0
    ? driven
    : assemblyNodes.map((node, index) => ({
      ...node,
      driveRatio: index % 2 === 0 ? 1 : -1,
      direction: index % 2 === 0 ? 1 : -1
    }));
};

export const getGearPhase = (node, angle = 0, basePhase = 0) => normalizeRotation(
  basePhase + ((node.driveRatio || node.direction || 1) * angle)
);
