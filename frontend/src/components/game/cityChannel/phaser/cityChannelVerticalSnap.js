import {
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  isValidCell
} from '../cityChannelSchema';
import { isPortalMaterial } from '../cityChannelMovePreview';
import { getWorldTransmissionPorts } from '../cityChannelMechanismRuntime';
import { getCellVerticalEndpoints } from './renderer/CityChannelDepth';
import {
  EDGE_NEIGHBOR_OFFSETS,
  OPPOSITE_EDGE,
  WALL_EDGE_ENDPOINTS,
  formatAxisCoord,
  getDirectionFromEndpoint,
  rotateDirectionByDegrees,
  sameAxisPoint,
  sameAxisSegment
} from './cityChannelPhaserSceneUtils';

export const getAbsoluteWallEdgeEndpoints = (cell, edge = 'north') => {
  const endpoints = WALL_EDGE_ENDPOINTS[edge] || WALL_EDGE_ENDPOINTS.north;
  return endpoints.map((point) => ({
    x: (Number(cell?.x) || 0) + point.x,
    y: (Number(cell?.y) || 0) + point.y
  }));
};

export const getWallPhysicalKey = (cell, edge = 'north') => {
  const endpoints = getAbsoluteWallEdgeEndpoints(cell, edge)
    .map((point) => `${formatAxisCoord(point.x)},${formatAxisCoord(point.y)}`)
    .sort();
  return `${Number(cell?.z) || 0}:${endpoints.join('|')}`;
};

export const isWallPhysicalPlaneOccupied = ({ mapData = {}, cell, edge = 'north' } = {}) => {
  const physicalKey = getWallPhysicalKey(cell, edge);
  return Object.values(mapData.walls || {}).some((wall) => (
    getWallPhysicalKey(wall, wall.edge) === physicalKey
  ));
};

export const getSupportPrimaryEdge = (support) => {
  if (support?.kind === 'wall' && support.edge) return support.edge;
  return rotateDirectionByDegrees('north', support?.placement?.rotation || 0);
};

export const getSupportAxisSegment = (support) => {
  if (!support?.placement) return null;
  const localEndpoints = support.kind === 'wall'
    ? (WALL_EDGE_ENDPOINTS[support.placement.edge] || WALL_EDGE_ENDPOINTS.north)
    : getCellVerticalEndpoints(support.placement.rotation || 0);
  return localEndpoints.map((point) => ({
    x: (Number(support.placement.x) || 0) + point.x,
    y: (Number(support.placement.y) || 0) + point.y
  }));
};

export const getSupportAxisVertex = (support, direction) => {
  const segment = getSupportAxisSegment(support);
  if (!segment) return null;
  const endpointDirections = support.kind === 'wall'
    ? (WALL_EDGE_ENDPOINTS[support.placement.edge] || WALL_EDGE_ENDPOINTS.north).map(getDirectionFromEndpoint)
    : getCellVerticalEndpoints(support.placement.rotation || 0).map(getDirectionFromEndpoint);
  const index = endpointDirections.indexOf(direction);
  return segment[index >= 0 ? index : 0] || null;
};

export const getNearbyAxisCells = ({ mapData = {}, points = [], z = 0, padding = 1 } = {}) => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.floor(Math.min(...xs) - padding);
  const maxX = Math.ceil(Math.max(...xs) + padding);
  const minY = Math.floor(Math.min(...ys) - padding);
  const maxY = Math.ceil(Math.max(...ys) + padding);
  const cells = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (isValidCell(x, y, z, mapData)) cells.push({ x, y, z });
    }
  }
  return cells;
};

export const findWallCandidatesForSegment = ({ mapData = {}, segment, z = 0 } = {}) => {
  if (!Array.isArray(segment) || segment.length < 2) return [];
  const seen = new Set();
  const candidates = [];
  getNearbyAxisCells({ mapData, points: segment, z, padding: 1 }).forEach((cell) => {
    Object.keys(EDGE_NEIGHBOR_OFFSETS).forEach((edge) => {
      if (!sameAxisSegment(getAbsoluteWallEdgeEndpoints(cell, edge), segment)) return;
      const physicalKey = getWallPhysicalKey(cell, edge);
      if (seen.has(physicalKey)) return;
      seen.add(physicalKey);
      candidates.push({ cell, edge, physicalKey });
    });
  });
  return candidates;
};

export const findFloorCandidatesForSegment = ({ mapData = {}, segment, z = 0 } = {}) => {
  if (!Array.isArray(segment) || segment.length < 2) return [];
  const seen = new Set();
  const candidates = [];
  getNearbyAxisCells({ mapData, points: segment, z, padding: 1 }).forEach((cell) => {
    const hasSharedEdge = Object.keys(EDGE_NEIGHBOR_OFFSETS).some((edge) => (
      sameAxisSegment(getAbsoluteWallEdgeEndpoints(cell, edge), segment)
    ));
    if (!hasSharedEdge) return;
    const key = createCellKey(cell.x, cell.y, cell.z);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ cell, key });
  });
  return candidates;
};

export const findWallCandidatesForVertex = ({ mapData = {}, vertex, z = 0 } = {}) => {
  if (!vertex) return [];
  const seen = new Set();
  const candidates = [];
  getNearbyAxisCells({ mapData, points: [vertex], z, padding: 1 }).forEach((cell) => {
    Object.keys(EDGE_NEIGHBOR_OFFSETS).forEach((edge) => {
      if (!getAbsoluteWallEdgeEndpoints(cell, edge).some((point) => sameAxisPoint(point, vertex))) return;
      const physicalKey = getWallPhysicalKey(cell, edge);
      if (seen.has(physicalKey)) return;
      seen.add(physicalKey);
      candidates.push({ cell, edge, physicalKey });
    });
  });
  return candidates;
};

export const getSnapAxisEdge = (snap) => {
  if (!snap) return null;
  if (snap.axisEdge) return snap.axisEdge;
  if (snap.side === 'top') return getSupportPrimaryEdge(snap.support);
  return OPPOSITE_EDGE[snap.direction] || snap.direction || 'north';
};

export const getSnapAxisKey = (snap) => {
  if (!snap?.cell || !snap.support) return '';
  const axisEdge = getSnapAxisEdge(snap);
  return `${snap.support.key}:${snap.side || ''}:${snap.direction || ''}:${axisEdge || ''}:${createCellKey(snap.cell.x, snap.cell.y, snap.cell.z)}`;
};

export const getVerticalTopPortDirection = (support) => {
  if (!support?.placement) return null;
  if (support.kind === 'wall') return support.placement.edge || 'north';
  return rotateDirectionByDegrees('north', support.placement.rotation || 0);
};

export const hasTileSupport = ({ mapData = {}, cell } = {}) => {
  if (!cell) return false;
  if (cell.z <= 0) return true;
  return !!mapData.tiles?.[createCellKey(cell.x, cell.y, cell.z - 1)];
};

export const hasFloorPlacementSupport = ({ mapData = {}, cell, anchorCell = null } = {}) => {
  if (hasTileSupport({ mapData, cell })) return true;
  if (!cell || !anchorCell || Number(cell.z) !== Number(anchorCell.z)) return false;
  return Math.abs(Number(cell.x) - Number(anchorCell.x)) + Math.abs(Number(cell.y) - Number(anchorCell.y)) === 1
    && !!mapData.tiles?.[createCellKey(anchorCell.x, anchorCell.y, anchorCell.z)];
};

export const getStructuralPlacementKey = (placement = {}) => {
  if (!placement) return '';
  return placement.edge
    ? createWallKey(placement.x, placement.y, placement.z, placement.edge)
    : createCellKey(placement.x, placement.y, placement.z);
};

export const createStructuralSupportResolver = ({
  mapData = {},
  getVerticalSupportEntries = () => []
} = {}) => {
  const isSupportStructurallyGrounded = (support, visited = new Set()) => {
    if (!support?.placement) return false;
    return isPlacementStructurallyGrounded(
      support.placement,
      support.key || getStructuralPlacementKey(support.placement),
      visited
    );
  };

  const isGroundedFloorTileAt = (cell, visited = new Set()) => {
    if (!cell || !isValidCell(cell.x, cell.y, cell.z, mapData)) return false;
    const key = createCellKey(cell.x, cell.y, cell.z);
    const tile = mapData.tiles?.[key];
    if (!tile || tile.isVertical || isPortalMaterial(tile.panelType)) return false;
    return isPlacementStructurallyGrounded(tile, key, visited);
  };

  const isGroundedWallAt = (cell, edge = 'north', visited = new Set()) => {
    if (!cell || !isValidCell(cell.x, cell.y, cell.z, mapData)) return false;
    const key = createWallKey(cell.x, cell.y, cell.z, edge);
    const wall = mapData.walls?.[key];
    if (!wall) return false;
    return isPlacementStructurallyGrounded(wall, key, visited);
  };

  const hasGroundedWallFootSupport = (cell, edge = 'north', visited = new Set()) => {
    if (!cell) return false;
    const offset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
    const supportCells = [
      { x: cell.x, y: cell.y, z: cell.z },
      { x: cell.x + offset.x, y: cell.y + offset.y, z: cell.z }
    ];
    if (supportCells.some((supportCell) => isGroundedFloorTileAt(supportCell, new Set(visited)))) return true;
    if ((Number(cell.z) || 0) <= 0) return false;
    const lowerSupportCells = supportCells.map((supportCell) => ({
      ...supportCell,
      z: supportCell.z - 1
    }));
    return lowerSupportCells.some((supportCell) => isGroundedFloorTileAt(supportCell, new Set(visited)))
      || isGroundedWallAt({ x: cell.x, y: cell.y, z: cell.z - 1 }, edge, new Set(visited));
  };

  const hasGroundedVerticalFloorSupport = (cell, visited = new Set()) => {
    if (!cell) return false;
    return getVerticalSupportEntries().some((support) => {
      if (!isSupportStructurallyGrounded(support, new Set(visited))) return false;
      const dx = Math.abs((Number(cell.x) || 0) - (Number(support.cell?.x) || 0));
      const dy = Math.abs((Number(cell.y) || 0) - (Number(support.cell?.y) || 0));
      if (dx + dy > 1) return false;
      const dz = (Number(cell.z) || 0) - (Number(support.cell?.z) || 0);
      return dz >= 0 && dz <= 1;
    });
  };

  const hasGroundedFloorPlacementSupport = (cell, anchorCell = null, primarySupport = null, visited = new Set()) => {
    if (!cell || !isValidCell(cell.x, cell.y, cell.z, mapData)) return false;
    if ((Number(cell.z) || 0) <= 0) return true;
    if (primarySupport && isSupportStructurallyGrounded(primarySupport, new Set(visited))) return true;
    if (isGroundedFloorTileAt({ x: cell.x, y: cell.y, z: cell.z - 1 }, new Set(visited))) return true;
    if (
      anchorCell
      && Number(cell.z) === Number(anchorCell.z)
      && Math.abs(Number(cell.x) - Number(anchorCell.x)) + Math.abs(Number(cell.y) - Number(anchorCell.y)) === 1
      && isGroundedFloorTileAt(anchorCell, new Set(visited))
    ) {
      return true;
    }
    if (Object.values(EDGE_NEIGHBOR_OFFSETS).some((offset) => isGroundedFloorTileAt({
      x: cell.x + offset.x,
      y: cell.y + offset.y,
      z: cell.z
    }, new Set(visited)))) {
      return true;
    }
    return hasGroundedVerticalFloorSupport(cell, new Set(visited));
  };

  const hasGroundedWallPlacementSupport = (cell, edge = 'north', primarySupport = null, visited = new Set()) => {
    if (!cell || !edge || !isValidCell(cell.x, cell.y, cell.z, mapData)) return false;
    if (primarySupport && isSupportStructurallyGrounded(primarySupport, new Set(visited))) return true;
    return hasGroundedWallFootSupport(cell, edge, new Set(visited));
  };

  const isPlacementStructurallyGrounded = (placement, key = '', visited = new Set()) => {
    if (!placement) return false;
    const placementKey = key || getStructuralPlacementKey(placement);
    if (!placementKey) return false;
    if (visited.has(placementKey)) return false;
    visited.add(placementKey);
    if ((Number(placement.z) || 0) <= 0) return true;
    if (placement.edge) {
      return hasGroundedWallFootSupport(placement, placement.edge, visited);
    }
    if (placement.isVertical) {
      return isGroundedFloorTileAt(placement, new Set(visited))
        || Object.values(EDGE_NEIGHBOR_OFFSETS).some((offset) => isGroundedFloorTileAt({
          x: placement.x + offset.x,
          y: placement.y + offset.y,
          z: placement.z
        }, new Set(visited)));
    }
    return hasGroundedFloorPlacementSupport(placement, null, null, visited);
  };

  return {
    getStructuralPlacementKey,
    hasGroundedFloorPlacementSupport,
    hasGroundedVerticalFloorSupport,
    hasGroundedWallFootSupport,
    hasGroundedWallPlacementSupport,
    isGroundedFloorTileAt,
    isGroundedWallAt,
    isPlacementStructurallyGrounded,
    isSupportStructurallyGrounded
  };
};

const chooseBetterConnection = (best, candidate) => {
  if (!candidate) return best;
  if (!best) return candidate;
  if (candidate.socketDistance < best.socketDistance) return candidate;
  if (
    Math.abs(candidate.socketDistance - best.socketDistance) <= 1e-6
    && candidate.endpointDistance < best.endpointDistance
  ) {
    return candidate;
  }
  return best;
};

export const resolveTransmissionPortConnection = ({
  activePlacement,
  activePorts = [],
  activeForcedSurface = null,
  support,
  supportPorts = [],
  supportForcedSurface = null,
  endpointMode = 'socket',
  activeDirection = null,
  supportDirection = null,
  activePortId = null,
  supportPortId = null,
  getTransmissionSurfacePortPoint,
  getTransmissionSocketPoint
} = {}) => {
  if (
    !activePlacement
    || !support?.placement
    || typeof getTransmissionSurfacePortPoint !== 'function'
    || typeof getTransmissionSocketPoint !== 'function'
  ) {
    return null;
  }
  const activeCandidates = activePortId
    ? activePorts.filter((port) => port.id === activePortId)
    : endpointMode === 'socket'
      ? activePorts
      : activePorts.filter((port) => !activeDirection || port.worldDirection === activeDirection);
  const supportCandidates = supportPortId
    ? supportPorts.filter((port) => port.id === supportPortId)
    : endpointMode === 'socket'
      ? supportPorts
      : supportPorts.filter((port) => !supportDirection || port.worldDirection === supportDirection);
  let best = null;
  activeCandidates.forEach((candidateActivePort) => {
    const candidateActivePoint = getTransmissionSurfacePortPoint(activePlacement, candidateActivePort, activeForcedSurface);
    const candidateActiveSocket = getTransmissionSocketPoint(activePlacement, candidateActivePort, activeForcedSurface);
    if (!candidateActivePoint || !candidateActiveSocket) return;
    supportCandidates.forEach((candidateSupportPort) => {
      const candidateSupportPoint = getTransmissionSurfacePortPoint(support.placement, candidateSupportPort, supportForcedSurface);
      const candidateSupportSocket = getTransmissionSocketPoint(support.placement, candidateSupportPort, supportForcedSurface);
      if (!candidateSupportPoint || !candidateSupportSocket) return;
      best = chooseBetterConnection(best, {
        activePort: candidateActivePort,
        activePoint: candidateActivePoint,
        activeSocket: candidateActiveSocket,
        supportPort: candidateSupportPort,
        supportPoint: candidateSupportPoint,
        supportSocket: candidateSupportSocket,
        endpointDistance: Math.hypot(
          candidateActivePoint.x - candidateSupportPoint.x,
          candidateActivePoint.y - candidateSupportPoint.y
        ),
        socketDistance: Math.hypot(
          candidateActiveSocket.x - candidateSupportSocket.x,
          candidateActiveSocket.y - candidateSupportSocket.y,
          candidateActiveSocket.z - candidateSupportSocket.z
        )
      });
    });
  });
  return best;
};

export const createConnectionResult = ({
  best = null,
  activePlacement = null,
  support = null,
  endpointMode = 'socket',
  socketEpsilon = 0
} = {}) => ({
  valid: !!best && best.socketDistance <= socketEpsilon,
  activeTile: activePlacement,
  activePort: best?.activePort || null,
  activePoint: best?.activePoint || null,
  activeSocket: best?.activeSocket || null,
  support,
  supportPort: best?.supportPort || null,
  supportPoint: best?.supportPoint || null,
  supportSocket: best?.supportSocket || null,
  endpointDistance: best?.endpointDistance ?? Infinity,
  socketDistance: best?.socketDistance ?? Infinity,
  endpointMode
});

export const resolveVerticalSnapConnection = ({
  targetCell,
  support,
  snap = {},
  activeTileType,
  activeRotation = 0,
  socketEpsilon = 0,
  getTransmissionSurfacePortPoint,
  getTransmissionSocketPoint
} = {}) => {
  if (!targetCell || !support?.placement) return { valid: false };
  const activeEdge = snap.activeEdge || null;
  const activePlacement = activeEdge
    ? createWall({
      x: targetCell.x,
      y: targetCell.y,
      z: targetCell.z,
      edge: activeEdge,
      panelType: activeTileType,
      transmissionRotation: activeRotation
    })
    : createTile({
      x: targetCell.x,
      y: targetCell.y,
      z: targetCell.z,
      panelType: activeTileType,
      rotation: activeRotation
    });
  const activeKey = activeEdge
    ? `${targetCell.z}:${targetCell.x}:${targetCell.y}:${activeEdge}`
    : createCellKey(targetCell.x, targetCell.y, targetCell.z);
  const endpointMode = snap.endpointMode || 'socket';
  const best = resolveTransmissionPortConnection({
    activePlacement,
    activePorts: getWorldTransmissionPorts(activePlacement, activeKey),
    activeForcedSurface: activeEdge ? 'wall' : null,
    support,
    supportPorts: getWorldTransmissionPorts(support.placement, support.key),
    supportForcedSurface: support.kind === 'wall' ? 'wall' : null,
    endpointMode,
    activeDirection: snap.activeDirection || null,
    supportDirection: snap.supportDirection || null,
    activePortId: snap.activePortId || null,
    supportPortId: snap.supportPortId || null,
    getTransmissionSurfacePortPoint,
    getTransmissionSocketPoint
  });
  return createConnectionResult({ best, activePlacement, support, endpointMode, socketEpsilon });
};

export const getVerticalSupportConnectionCandidates = ({
  targetCell,
  primarySupport = null,
  supports = [],
  isSupportEligibleForSnap = () => false
} = {}) => {
  if (!targetCell) return primarySupport ? [primarySupport] : [];
  const seen = new Set();
  const candidates = [];
  const addSupport = (support) => {
    if (!isSupportEligibleForSnap(support)) return;
    if (!support?.key || seen.has(support.key)) return;
    seen.add(support.key);
    candidates.push(support);
  };
  addSupport(primarySupport);
  supports.forEach((support) => {
    if (!support?.cell) return;
    const dz = Number(targetCell.z) - Number(support.cell.z);
    if (dz < 0 || dz > 1) return;
    if (Math.abs(Number(targetCell.x) - Number(support.cell.x)) > 1) return;
    if (Math.abs(Number(targetCell.y) - Number(support.cell.y)) > 1) return;
    addSupport(support);
  });
  return candidates;
};

export const resolveBestVerticalSnapConnection = ({
  targetCell,
  primarySupport,
  snap = {},
  supports = [],
  isSupportEligibleForSnap,
  resolveConnection
} = {}) => {
  const primaryConnection = resolveConnection(targetCell, primarySupport, snap);
  if (snap.allowAlternateSupport !== true) return primaryConnection;
  let best = primaryConnection;
  getVerticalSupportConnectionCandidates({
    targetCell,
    primarySupport,
    supports,
    isSupportEligibleForSnap
  }).forEach((support) => {
    const candidateSnap = support.key === primarySupport?.key
      ? snap
      : {
        activeEdge: snap.activeEdge || null,
        endpointMode: 'socket'
      };
    const connection = resolveConnection(targetCell, support, candidateSnap);
    if (
      !best
      || (connection.valid && !best.valid)
      || (
        connection.valid === best.valid
        && connection.socketDistance < best.socketDistance
      )
      || (
        connection.valid === best.valid
        && Math.abs(connection.socketDistance - best.socketDistance) <= 1e-6
        && connection.endpointDistance < best.endpointDistance
      )
    ) {
      best = connection;
    }
  });
  return best || primaryConnection;
};

export const resolveSingleFloorSnapConnection = ({
  targetCell,
  activePlacement,
  activePorts = [],
  supportTile,
  socketEpsilon = 0,
  getTransmissionSurfacePortPoint,
  getTransmissionSocketPoint
} = {}) => {
  if (!targetCell || !activePlacement || !supportTile) return { valid: false };
  const support = {
    kind: 'tile',
    key: createCellKey(supportTile.x, supportTile.y, supportTile.z),
    cell: { x: supportTile.x, y: supportTile.y, z: supportTile.z },
    placement: supportTile
  };
  if (activePorts.length <= 0) {
    return {
      valid: true,
      activeTile: activePlacement,
      support,
      socketDistance: 0,
      endpointDistance: 0,
      endpointMode: 'socket'
    };
  }
  const best = resolveTransmissionPortConnection({
    activePlacement,
    activePorts,
    support,
    supportPorts: getWorldTransmissionPorts(supportTile, support.key),
    endpointMode: 'socket',
    getTransmissionSurfacePortPoint,
    getTransmissionSocketPoint
  });
  return createConnectionResult({
    best,
    activePlacement,
    support,
    endpointMode: 'socket',
    socketEpsilon
  });
};

export const resolveFloorSnapConnection = ({
  mapData = {},
  targetCell,
  supportTile = null,
  activeTileType,
  activeRotation = 0,
  socketEpsilon = 0,
  getTransmissionSurfacePortPoint,
  getTransmissionSocketPoint
} = {}) => {
  if (!targetCell) return { valid: false };
  const activePlacement = createTile({
    x: targetCell.x,
    y: targetCell.y,
    z: targetCell.z,
    panelType: activeTileType,
    rotation: activeRotation
  });
  const activeKey = createCellKey(targetCell.x, targetCell.y, targetCell.z);
  const activePorts = getWorldTransmissionPorts(activePlacement, activeKey);
  const supportCandidates = [];
  const seen = new Set();
  const addSupport = (tile) => {
    if (!tile || tile.isVertical || isPortalMaterial(tile.panelType)) return;
    const key = createCellKey(tile.x, tile.y, tile.z);
    if (seen.has(key)) return;
    seen.add(key);
    supportCandidates.push(tile);
  };
  addSupport(supportTile);
  Object.values(EDGE_NEIGHBOR_OFFSETS).forEach((offset) => {
    const tile = mapData.tiles?.[createCellKey(
      targetCell.x + offset.x,
      targetCell.y + offset.y,
      targetCell.z
    )];
    addSupport(tile);
  });
  if (activePorts.length <= 0) {
    const support = supportCandidates[0]
      ? {
        kind: 'tile',
        key: createCellKey(supportCandidates[0].x, supportCandidates[0].y, supportCandidates[0].z),
        cell: { x: supportCandidates[0].x, y: supportCandidates[0].y, z: supportCandidates[0].z },
        placement: supportCandidates[0]
      }
      : null;
    return {
      valid: true,
      activeTile: activePlacement,
      support,
      socketDistance: 0,
      endpointDistance: 0,
      endpointMode: 'socket'
    };
  }
  let best = null;
  supportCandidates.forEach((candidateSupportTile) => {
    const connection = resolveSingleFloorSnapConnection({
      targetCell,
      activePlacement,
      activePorts,
      supportTile: candidateSupportTile,
      socketEpsilon,
      getTransmissionSurfacePortPoint,
      getTransmissionSocketPoint
    });
    if (
      !best
      || (connection.valid && !best.valid)
      || (
        connection.valid === best.valid
        && connection.socketDistance < best.socketDistance
      )
      || (
        connection.valid === best.valid
        && Math.abs(connection.socketDistance - best.socketDistance) <= 1e-6
        && connection.endpointDistance < best.endpointDistance
      )
    ) {
      best = connection;
    }
  });
  return best || {
    valid: false,
    activeTile: activePlacement,
    support: null,
    endpointDistance: Infinity,
    socketDistance: Infinity,
    endpointMode: 'socket'
  };
};

export const getVerticalTopSnapSpec = ({
  support,
  getTransmissionSocketPoint,
  getTransmissionSurfacePortPoint
} = {}) => {
  if (!support?.placement) return {};
  const ports = getWorldTransmissionPorts(support.placement, support.key);
  const topPort = ports
    .map((port) => ({
      port,
      socket: getTransmissionSocketPoint(support.placement, port, support.kind === 'wall' ? 'wall' : null),
      point: getTransmissionSurfacePortPoint(support.placement, port, support.kind === 'wall' ? 'wall' : null)
    }))
    .filter((entry) => entry.socket)
    .sort((a, b) => (
      (b.socket.z - a.socket.z)
      || ((a.point?.y ?? 0) - (b.point?.y ?? 0))
    ))[0]?.port || null;
  return {
    activeDirection: OPPOSITE_EDGE[topPort?.worldDirection],
    supportDirection: topPort?.worldDirection,
    supportPortId: topPort?.id,
    endpointMode: 'socket'
  };
};

export const getAxisOptionKey = (target) => {
  if (!target?.cell) return '';
  const isWall = target.kind === 'wall' || !!target.edge;
  return isWall
    ? `wall:${getWallPhysicalKey(target.cell, target.edge)}`
    : `floor:${createCellKey(target.cell.x, target.cell.y, target.cell.z)}`;
};

export const getAxisOptionKindForPose = (pose = 'floor') => (pose === 'wall' ? 'wall' : 'floor');

export const getAxisOptionIndex = (options = [], target = null) => {
  const key = getAxisOptionKey(target);
  return key
    ? options.findIndex((option) => getAxisOptionKey(option) === key)
    : -1;
};

export const getAxisOptionIndexInAllOptions = (allOptions = [], target = null) => {
  const key = getAxisOptionKey(target);
  return key
    ? allOptions.findIndex((option) => getAxisOptionKey(option) === key)
    : -1;
};

export const resolveAxisRotatedWallTarget = ({
  mapData = {},
  snap,
  resolveVerticalSnapConnection,
  hasVerticalSnapStructuralEdgeSupport,
  isPlacementWallOccupiedForSnap
} = {}) => {
  if (!snap?.cell || !snap.support) return null;
  const edge = getSnapAxisEdge(snap) || 'north';
  const connection = resolveVerticalSnapConnection(snap.cell, snap.support, {
    activeEdge: edge,
    endpointMode: 'socket'
  });
  const structurallySupported = hasVerticalSnapStructuralEdgeSupport(snap.cell, edge, snap);
  return {
    cell: snap.cell,
    edge,
    valid: structurallySupported
      && isValidCell(snap.cell.x, snap.cell.y, snap.cell.z, mapData)
      && !isPlacementWallOccupiedForSnap(snap.cell, edge),
    connection,
    sourceSnap: snap
  };
};

export const createAxisFloorTarget = ({
  mapData = {},
  cell,
  snap,
  activeVerticalBoardPlacement = false,
  resolveVerticalSnapConnection,
  hasVerticalSnapStructuralEdgeSupport,
  isPlacementCellOccupiedForSnap
} = {}) => {
  if (!cell || !snap?.support) return null;
  if (!isValidCell(cell.x, cell.y, cell.z, mapData)) return null;
  if (isPlacementCellOccupiedForSnap(cell)) return null;
  if (activeVerticalBoardPlacement) {
    const floorTile = mapData.tiles?.[createCellKey(cell.x, cell.y, cell.z)];
    if (!floorTile || floorTile.isVertical || isPortalMaterial(floorTile.panelType)) return null;
  }
  const connection = resolveVerticalSnapConnection(cell, snap.support, snap.side === 'top'
    ? getVerticalTopSnapSpec({
      support: snap.support,
      getTransmissionSocketPoint: snap.getTransmissionSocketPoint,
      getTransmissionSurfacePortPoint: snap.getTransmissionSurfacePortPoint
    })
    : {
      activeDirection: OPPOSITE_EDGE[snap.direction],
      supportDirection: snap.direction,
      endpointMode: 'socket'
    });
  if (!hasVerticalSnapStructuralEdgeSupport(cell, null, snap)) return null;
  return {
    kind: 'floor',
    cell: { x: cell.x, y: cell.y, z: cell.z },
    valid: true,
    connection,
    sourceSnap: snap
  };
};

export const createAxisWallTarget = ({
  mapData = {},
  cell,
  edge,
  snap,
  resolveVerticalSnapConnection,
  hasVerticalSnapStructuralEdgeSupport,
  isPlacementWallOccupiedForSnap
} = {}) => {
  if (!cell || !edge || !snap?.support) return null;
  if (!isValidCell(cell.x, cell.y, cell.z, mapData)) return null;
  if (isPlacementWallOccupiedForSnap(cell, edge)) return null;
  const connection = resolveVerticalSnapConnection(cell, snap.support, {
    activeEdge: edge,
    endpointMode: 'socket'
  });
  if (!hasVerticalSnapStructuralEdgeSupport(cell, edge, snap)) return null;
  return {
    kind: 'wall',
    cell: { x: cell.x, y: cell.y, z: cell.z },
    edge,
    valid: true,
    connection,
    sourceSnap: snap
  };
};

export const getAxisPlacementOptions = ({
  mapData = {},
  snap,
  activeVerticalBoardPlacement = false,
  resolveVerticalSnapConnection,
  hasVerticalSnapStructuralEdgeSupport,
  isPlacementCellOccupiedForSnap,
  isPlacementWallOccupiedForSnap,
  getTransmissionSocketPoint,
  getTransmissionSurfacePortPoint
} = {}) => {
  if (!snap?.cell || !snap.support) return [];
  const options = [];
  const seen = new Set();
  const enrichedSnap = {
    ...snap,
    getTransmissionSocketPoint,
    getTransmissionSurfacePortPoint
  };
  const addOption = (option) => {
    if (!option?.cell) return;
    const key = getAxisOptionKey(option);
    if (seen.has(key)) return;
    seen.add(key);
    options.push(option);
  };
  const createFloor = (cell) => createAxisFloorTarget({
    mapData,
    cell,
    snap: enrichedSnap,
    activeVerticalBoardPlacement,
    resolveVerticalSnapConnection,
    hasVerticalSnapStructuralEdgeSupport,
    isPlacementCellOccupiedForSnap
  });
  const createWall = (cell, edge) => createAxisWallTarget({
    mapData,
    cell,
    edge,
    snap: enrichedSnap,
    resolveVerticalSnapConnection,
    hasVerticalSnapStructuralEdgeSupport,
    isPlacementWallOccupiedForSnap
  });
  const resolveFallbackWall = () => resolveAxisRotatedWallTarget({
    mapData,
    snap: enrichedSnap,
    resolveVerticalSnapConnection,
    hasVerticalSnapStructuralEdgeSupport,
    isPlacementWallOccupiedForSnap
  });

  if (snap.side === 'top') {
    const segment = getSupportAxisSegment(snap.support);
    const z = snap.cell.z;
    const floorCandidates = findFloorCandidatesForSegment({ mapData, segment, z });
    const wallCandidates = findWallCandidatesForSegment({ mapData, segment, z });
    const floorCells = floorCandidates.length > 0
      ? floorCandidates.map((candidate) => candidate.cell)
      : [snap.cell];
    floorCells.forEach((cell) => addOption(createFloor(cell)));
    wallCandidates.forEach((candidate) => {
      addOption(createWall(candidate.cell, candidate.edge));
    });
    if (wallCandidates.length <= 0) {
      const fallbackWall = resolveFallbackWall();
      addOption(fallbackWall ? { ...fallbackWall, kind: 'wall' } : null);
    }
    return options;
  }

  const sideSegment = snap.getVerticalSnapSupportEdgeSegment?.(snap.support, snap.direction);
  const wallCandidates = [];
  if (sideSegment) {
    wallCandidates.push(...findWallCandidatesForSegment({ mapData, segment: sideSegment, z: snap.cell.z }));
  }
  if (snap.support?.kind === 'wall') {
    const vertex = getSupportAxisVertex(snap.support, snap.direction);
    if (vertex) {
      wallCandidates.push(...findWallCandidatesForVertex({ mapData, vertex, z: snap.cell.z }));
    }
  }
  wallCandidates.forEach((candidate) => {
    addOption(createWall(candidate.cell, candidate.edge));
  });
  if (wallCandidates.length <= 0) {
    const fallbackWall = resolveFallbackWall();
    if (fallbackWall && hasVerticalSnapStructuralEdgeSupport(fallbackWall.cell, fallbackWall.edge, enrichedSnap)) {
      addOption({ ...fallbackWall, kind: 'wall' });
    }
  }
  return options;
};

export const getAxisPlacementTarget = ({ options = [], snapPlaneCycle = 0 } = {}) => {
  if (!options.length) return null;
  const index = ((snapPlaneCycle % options.length) + options.length) % options.length;
  return options[index] || options[0];
};
