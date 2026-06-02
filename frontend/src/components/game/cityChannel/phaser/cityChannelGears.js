import { createCellKey, createWallKey, normalizeRotation } from '../cityChannelSchema';
import { projectWorldOffset } from '../cityChannelGeometryUtils';
import { isPortalMaterial } from '../cityChannelMovePreview';
import {
  getCornerGearBindingCandidates,
  getGearMountLocalPosition,
  getGearSocketKind,
  getHorizontalGearSocketWorldPosition,
  isCornerGearSocket,
  normalizeGearMount
} from '../cityChannelMechanismRuntime';
import {
  hasDirectionalGearSurface,
  normalizeGearSurfaceForPanel
} from '../cityChannelGearPressurePlateRender';
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
  if (!hasDirectionalGearSurface(placement.panelType)) return true;
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
    mount.position === socket
    && normalizeGearSurfaceForPanel(placement?.panelType, mount.surface || 'front')
      === normalizeGearSurfaceForPanel(placement?.panelType, surface)
  ))
);

const normalizeIgnoreGearKeys = (ignoreGearKeys = new Set()) => (
  ignoreGearKeys instanceof Set
    ? ignoreGearKeys
    : new Set(Array.isArray(ignoreGearKeys) ? ignoreGearKeys : [])
);

export const getGearMountIdentity = (hostKind, hostKey, mountId) => `${hostKind || 'tile'}:${hostKey}:${mountId}`;

export const getGearSocketWorldPosition = (placement = {}, socket = 'center') => (
  getHorizontalGearSocketWorldPosition(placement, socket)
);

export const isSameHorizontalCornerPivot = (a = {}, b = {}, epsilon = 0.001) => !!a && !!b
  && Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) <= epsilon
  && Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) <= epsilon
  && Math.abs((Number(a.z) || 0) - (Number(b.z) || 0)) <= epsilon;

export const hasCornerGearConflict = ({
  mapData = {},
  pivotWorld = null,
  surface = 'front',
  ignoreGearKeys = new Set(),
  epsilon = 0.001
} = {}) => {
  if (!pivotWorld) return false;
  const ignored = normalizeIgnoreGearKeys(ignoreGearKeys);
  return Object.entries(mapData.tiles || {}).some(([hostKey, tile]) => {
    if (!tile || tile.edge || tile.isVertical) return false;
    const normalizedSurface = normalizeGearSurfaceForPanel(tile.panelType, surface);
    return (tile.gearMounts || []).some((mount) => {
      if (!isCornerGearSocket(mount.position)) return false;
      if (normalizeGearSurfaceForPanel(tile.panelType, mount.surface || 'front') !== normalizedSurface) return false;
      if (ignored.has(getGearMountIdentity('tile', hostKey, mount.id))) return false;
      const mountPivot = getGearSocketWorldPosition(tile, mount.position);
      return isSameHorizontalCornerPivot(mountPivot, pivotWorld, epsilon);
    });
  });
};

export const validateGearPlacement = ({
  mapData = {},
  target = null,
  ignoreGearKeys = new Set()
} = {}) => {
  if (!target?.placement || !target.socket) {
    return {
      valid: false,
      reason: 'missing_target',
      bindingCandidates: []
    };
  }
  const ignored = normalizeIgnoreGearKeys(ignoreGearKeys);
  const ownIdentity = getGearMountIdentity(target.hostKind, target.hostKey, target.mountId);
  const targetSurface = normalizeGearSurfaceForPanel(target.placement.panelType, target.surface || 'front');
  const occupied = (target.placement.gearMounts || []).some((mount) => (
    mount.position === target.socket
    && normalizeGearSurfaceForPanel(target.placement.panelType, mount.surface || 'front') === targetSurface
    && mount.id !== target.mountId
    && !ignored.has(getGearMountIdentity(target.hostKind, target.hostKey, mount.id))
    && !ignored.has(ownIdentity)
  ));
  if (occupied) {
    return {
      valid: false,
      reason: 'occupied',
      occupied: true,
      bindingCandidates: []
    };
  }
  const blocked = isGearSocketBlockedBySurface({
    mapData,
    placement: target.placement,
    socket: target.socket
  });
  if (blocked) {
    return {
      valid: false,
      reason: 'blocked_by_wall',
      blocked: true,
      bindingCandidates: []
    };
  }
  if (!isCornerGearSocket(target.socket) || target.hostKind !== 'tile' || target.placement.edge || target.placement.isVertical) {
    return {
      valid: true,
      reason: 'ok',
      bindingCandidates: []
    };
  }
  const pivotWorld = target.pivotWorld || getGearSocketWorldPosition(target.placement, target.socket);
  const bindingCandidates = getCornerGearBindingCandidates({ mapData, pivotWorld });
  if (bindingCandidates.length <= 0) {
    return {
      valid: false,
      reason: 'no_adjacent_corner_board',
      pivotWorld,
      bindingCandidates
    };
  }
  const conflict = hasCornerGearConflict({
    mapData,
    pivotWorld,
    surface: target.surface,
    ignoreGearKeys: ignored
  });
  if (conflict) {
    return {
      valid: false,
      reason: 'corner_occupied',
      pivotWorld,
      bindingCandidates
    };
  }
  return {
    valid: true,
    reason: 'ok',
    pivotWorld,
    bindingCandidates
  };
};

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
  mapGearLocalPointToSurface,
  ignoreGearKeys = new Set()
} = {}) => {
  const hit = hitInfo?.hit;
  if (!hit || !['tile', 'wall'].includes(hit.type)) return null;
  if (isPortalMaterial(hit.panelType)) return null;
  const placement = getGearHostPlacement({ mapData, hit });
  if (!placement) return null;
  const hitSurface = getGearSurfaceForHit(hit);
  if (!hitSurface) return null;
  const surface = normalizeGearSurfaceForPanel(placement.panelType, hitSurface);
  const pointerLocal = getGearSurfaceLocalPointForHit({ mapData, hit, getGearSurfaceContext });
  const candidates = GEAR_SOCKET_POSITIONS.map((socket) => {
    const point = getGearBoardPointForHit({ mapData, hit, socket, mapGearLocalPointToSurface });
    const socketLocal = getGearMountLocalPosition(socket);
    const pivotWorld = getGearSocketWorldPosition(placement, socket);
    const validity = validateGearPlacement({
      mapData,
      target: {
        hit,
        cell: hit.cell,
        hostKey: getGearHostKey(hit),
        hostKind: hit.type,
        surface,
        socket,
        socketKind: getGearSocketKind(socket),
        point,
        pivotWorld,
        placement
      },
      ignoreGearKeys
    });
    return {
      socket,
      socketKind: getGearSocketKind(socket),
      point,
      pivotWorld,
      bindingCandidates: validity.bindingCandidates || [],
      valid: !!point && validity.valid,
      occupied: !!validity.occupied,
      blocked: !!validity.blocked,
      reason: validity.reason,
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
    socketKind: nearest.socketKind,
    point: nearest.point,
    pivotWorld: nearest.pivotWorld,
    placement,
    candidates,
    bindingCandidates: nearest.bindingCandidates || [],
    valid: nearest.valid,
    reason: nearest.reason || (nearest.occupied ? 'occupied' : nearest.blocked ? 'blocked_by_wall' : 'ok')
  };
};

export const getGearInstallTargetForScene = (scene, hitInfo, options = {}) => getGearInstallTarget({
  mapData: scene?.mapData,
  hitInfo,
  getGearSurfaceContext: (placement, surface) => scene.getGearSurfaceContext(placement, surface),
  mapGearLocalPointToSurface: (placement, localPosition, options) => (
    scene.mapGearLocalPointToSurface(placement, localPosition, options)
  ),
  ignoreGearKeys: options.ignoreGearKeys
});

export const getGearSurfaceKey = (placement, mount = {}) => {
  const surface = normalizeGearSurfaceForPanel(placement?.panelType, mount.surface || 'front');
  if (!placement) return `unknown:${surface}`;
  if (placement.edge) return `edge:${placement.z || 0}:${placement.edge}:${surface}`;
  if (placement.isVertical) {
    const axis = normalizeRotation(placement.rotation || 0) % 180;
    return `vertical:${placement.z || 0}:${axis}:${surface}`;
  }
  return `floor:${placement.z || 0}:${surface}`;
};

export const getGearContactThreshold = () => 56;

const getGearContactPoint = (node = {}) => node.worldPoint || node.point || { x: 0, y: 0, z: 0 };

const getGearPitchRadius = (node = {}) => Number(node.pitchRadiusWorld ?? node.pitchRadius) || 1;

const getGearScreenPitchRadius = (node = {}) => Number(node.pitchRadius) || Number(node.pitchRadiusWorld) || 1;

const getGearRatioRadius = (node = {}) => Number(node.gearRatioRadius ?? node.pitchRadiusWorld ?? node.pitchRadius) || 1;

const getGearMeshPlaneDistance = (a = {}, b = {}) => {
  const aPlane = a.meshPlane;
  const bPlane = b.meshPlane;
  if (!aPlane || !bPlane) return null;
  if (aPlane.kind !== bPlane.kind) return null;
  const aNormal = aPlane.normal || {};
  const bNormal = bPlane.normal || {};
  const normalDot = ((Number(aNormal.x) || 0) * (Number(bNormal.x) || 0))
    + ((Number(aNormal.y) || 0) * (Number(bNormal.y) || 0))
    + ((Number(aNormal.z) || 0) * (Number(bNormal.z) || 0));
  if (normalDot < 0.98) return null;
  if (Math.abs((Number(aPlane.planeOffset) || 0) - (Number(bPlane.planeOffset) || 0)) > 0.08) return null;
  return Math.hypot((Number(aPlane.u) || 0) - (Number(bPlane.u) || 0), (Number(aPlane.v) || 0) - (Number(bPlane.v) || 0));
};

const getSurfacePlaneWithoutSide = (surfaceKey = '') => {
  if (!surfaceKey) return '';
  const parts = String(surfaceKey).split(':');
  if (parts.length <= 1) return surfaceKey;
  return parts.slice(0, -1).join(':');
};

const areOppositeSidesOfSamePlane = (a = {}, b = {}) => (
  a.surfaceKey !== b.surfaceKey
  && getSurfacePlaneWithoutSide(a.surfaceKey) === getSurfacePlaneWithoutSide(b.surfaceKey)
);

export const buildGearContactGraph = (nodes = [], threshold = getGearContactThreshold()) => {
  const graph = new Map(nodes.map((node) => [node.id, []]));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const sameSurface = a.surfaceKey === b.surfaceKey;
      if (!sameSurface && areOppositeSidesOfSamePlane(a, b)) continue;
      const meshPlaneDistance = getGearMeshPlaneDistance(a, b);
      if ((a.meshPlane || b.meshPlane) && meshPlaneDistance === null) continue;
      const aPoint = meshPlaneDistance !== null || sameSurface ? getGearContactPoint(a) : (a.point || getGearContactPoint(a));
      const bPoint = meshPlaneDistance !== null || sameSurface ? getGearContactPoint(b) : (b.point || getGearContactPoint(b));
      if (meshPlaneDistance === null && sameSurface && Math.abs((Number(aPoint.z) || 0) - (Number(bPoint.z) || 0)) > 0.08) continue;
      const distance = meshPlaneDistance ?? Math.hypot(aPoint.x - bPoint.x, aPoint.y - bPoint.y);
      const aRadius = meshPlaneDistance !== null || sameSurface ? getGearPitchRadius(a) : getGearScreenPitchRadius(a);
      const bRadius = meshPlaneDistance !== null || sameSurface ? getGearPitchRadius(b) : getGearScreenPitchRadius(b);
      const pitchContact = aRadius + bRadius;
      const contactDistance = meshPlaneDistance !== null || sameSurface
        ? pitchContact * 1.22
        : Math.max(pitchContact * 1.22, Math.min(threshold, pitchContact * 1.22));
      if (distance > contactDistance) continue;
      if (distance < Math.max(pitchContact * 0.28, 0.08)) continue;
      const aRatioRadius = getGearRatioRadius(a);
      const bRatioRadius = getGearRatioRadius(b);
      graph.get(a.id)?.push({ id: b.id, ratio: -(aRatioRadius / bRatioRadius) });
      graph.get(b.id)?.push({ id: a.id, ratio: -(bRatioRadius / aRatioRadius) });
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
  const assemblyComponentKeys = new Set(assembly?.componentKeys || []);
  const directDriveNodes = nodes.filter((node) => {
    const boundComponentKey = node?.mount?.axisBinding?.componentKey;
    return !boundComponentKey || assemblyComponentKeys.has(boundComponentKey);
  });
  if (directDriveNodes.length <= 0) return [];
  const distances = getAssemblyComponentDistances(assembly, sourceComponentKey);
  const reachable = directDriveNodes
    .map((node) => ({ node, distance: distances.has(node.componentKey) ? distances.get(node.componentKey) : Infinity }))
    .filter((item) => Number.isFinite(item.distance));
  if (reachable.length <= 0) return [directDriveNodes[0]];
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
  if (roots.length <= 0) return [];
  const visited = new Set();
  roots.forEach((root) => {
    if (!root?.id || visited.has(root.id)) return;
    const liveRoot = byId.get(root.id);
    if (!liveRoot) return;
    liveRoot.driveRatio = 1;
    liveRoot.direction = 1;
    visited.add(root.id);
    const queue = [root.id];
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
  });
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

export const gearMountHasAxisBinding = (mount = {}) => !!normalizeGearMount(mount).axisBinding;
