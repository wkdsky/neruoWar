import {
  CITY_CHANNEL_TILE_TYPES,
  cloneConnectors,
  cloneGearMounts,
  cloneHiddenModule,
  cloneMechanicalPorts,
  clonePlainObject,
  cloneTransmissionSkeleton,
  createCellKey,
  createMechanicalLink,
  createTile,
  createWall,
  createWallKey,
  getTileDefinition,
  normalizeRotation,
  normalizeWallEdge
} from './cityChannelSchema';
import { getCityChannelMaterial } from './cityChannelCatalog';
import {
  createRackKey,
  normalizeRack
} from './cityChannelRackModel';
import {
  CITY_CHANNEL_GEAR_CORNER_SOCKETS,
  getGearSocketWorldPosition,
  isCornerGearSocket
} from './cityChannelMechanismRuntime';
import { normalizeGearSurfaceForPanel } from './cityChannelGearPressurePlateRender';

const sameCell = (point, target) => (
  point
  && target
  && point.x === target.x
  && point.y === target.y
  && point.z === target.z
);

const getLayerCountForCell = (cell = null) => {
  const z = Number.parseInt(cell?.z, 10);
  return Number.isInteger(z) && z >= 0 ? z + 1 : 0;
};

const expandLayerCountForCells = (currentLayers, cells = []) => (
  (Array.isArray(cells) ? cells : []).reduce((layerCount, cell) => (
    Math.max(layerCount, getLayerCountForCell(cell))
  ), Number.isInteger(currentLayers) && currentLayers > 0 ? currentLayers : 0)
);

const createPointId = (prefix, point) => (
  `${prefix}_${point.z}_${point.x}_${point.y}_${Date.now().toString(36)}`
);

const removePointsAtCell = (points = [], cell) => points.filter((point) => !sameCell(point, cell));

const movePointsAtCell = (points = [], from, to) => points.map((point) => (
  sameCell(point, from)
    ? { ...point, x: to.x, y: to.y, z: to.z }
    : point
));

const upsertTile = (mapData, cell, tilePatch = {}) => {
  const panelType = tilePatch.panelType || CITY_CHANNEL_TILE_TYPES.BASIC_PLATE;
  const definition = getTileDefinition(panelType);
  const catalogItem = getCityChannelMaterial(panelType);
  const key = createCellKey(cell.x, cell.y, cell.z);
  const existing = mapData.tiles[key] || {};
  const baseTile = createTile({ x: cell.x, y: cell.y, z: cell.z, panelType });
  return {
    ...mapData.tiles,
    [key]: {
      ...baseTile,
      ...existing,
      ...tilePatch,
      x: cell.x,
      y: cell.y,
      z: cell.z,
      panelType,
      boardRole: catalogItem.boardRole || baseTile.boardRole || 'basic',
      category: definition.category || catalogItem.category || 'structure',
      rotation: normalizeRotation(tilePatch.rotation !== undefined ? tilePatch.rotation : existing.rotation),
      transmissionRotation: normalizeRotation(
        tilePatch.transmissionRotation !== undefined
          ? tilePatch.transmissionRotation
          : (existing.transmissionRotation ?? tilePatch.rotation ?? existing.rotation)
      ),
      walkable: !!definition.walkable,
      solid: !!definition.solid,
      transparent: !!definition.transparent,
      transmissionSkeleton: tilePatch.transmissionSkeleton !== undefined
        ? cloneTransmissionSkeleton(tilePatch.transmissionSkeleton)
        : cloneTransmissionSkeleton(catalogItem.transmissionSkeleton),
      gearMounts: tilePatch.gearMounts !== undefined
        ? cloneGearMounts(tilePatch.gearMounts)
        : (Array.isArray(existing.gearMounts) && existing.gearMounts.length > 0
          ? cloneGearMounts(existing.gearMounts)
          : cloneGearMounts(catalogItem.gearMounts)),
      gearConfigs: tilePatch.gearConfigs !== undefined
        ? clonePlainObject(tilePatch.gearConfigs)
        : clonePlainObject(catalogItem.gearConfigs),
      triggerConfig: tilePatch.triggerConfig !== undefined
        ? clonePlainObject(tilePatch.triggerConfig)
        : clonePlainObject(catalogItem.triggerConfig),
      motionConfig: tilePatch.motionConfig !== undefined
        ? clonePlainObject(tilePatch.motionConfig)
        : clonePlainObject(catalogItem.motionConfig),
      marker: tilePatch.marker !== undefined
        ? tilePatch.marker
        : (catalogItem.markerType || existing.marker || null),
      hiddenModule: tilePatch.hiddenModule !== undefined
        ? tilePatch.hiddenModule
        : cloneHiddenModule(catalogItem.hiddenModule),
      mechanismModel: tilePatch.mechanismModel !== undefined
        ? tilePatch.mechanismModel
        : (catalogItem.mechanismModel || null),
      connectors: Array.isArray(tilePatch.connectors)
        ? tilePatch.connectors
        : cloneConnectors(catalogItem.connectors || catalogItem.hiddenModule?.connectorPoints || definition.connectors || []),
      mechanicalPorts: Array.isArray(tilePatch.mechanicalPorts)
        ? cloneMechanicalPorts(tilePatch.mechanicalPorts, catalogItem)
        : cloneMechanicalPorts(catalogItem.mechanicalPorts || baseTile.mechanicalPorts || [], catalogItem)
    }
  };
};

const removeMechanicalLinksForComponents = (links = [], componentKeys = new Set()) => (
  (Array.isArray(links) ? links : []).filter((link) => (
    !componentKeys.has(link.from?.componentKey) && !componentKeys.has(link.to?.componentKey)
  ))
);

const getGearSurfacesForPlacement = (placement = null) => (
  placement ? ['front'] : []
);

const sameGearWorldPoint = (a = null, b = null, epsilon = 0.008) => (
  !!a && !!b
  && Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) <= epsilon
  && Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) <= epsilon
  && Math.abs((Number(a.z) || 0) - (Number(b.z) || 0)) <= epsilon
);

const gearSocketOccupied = (placement = {}, socket = '', surface = 'front') => (
  (placement.gearMounts || []).some((mount) => (
    mount.position === socket
    && normalizeGearSurfaceForPanel(placement.panelType, mount.surface || 'front') === normalizeGearSurfaceForPanel(placement.panelType, surface || 'front')
  ))
);

const getAxisBindingToRemovedPlacement = ({ hostKind, componentKey, placement, mount }) => ({
  componentKey,
  hostKind,
  socket: mount.position,
  surface: normalizeGearSurfaceForPanel(placement?.panelType, mount.surface || 'front')
});

const GEAR_REPLACEMENT_SOCKET_EPSILON = 0.08;

const getGearReplacementSockets = (mount = {}) => (
  isCornerGearSocket(mount.position)
    ? Array.from(CITY_CHANNEL_GEAR_CORNER_SOCKETS)
    : [mount.position || 'center']
);

const getGearMountReplacementTarget = (fromPlacement = null, toPlacement = null, mount = {}) => {
  if (!fromPlacement || !toPlacement || !mount?.position) return null;
  const pivotWorld = getGearSocketWorldPosition(fromPlacement, mount.position, mount.surface || 'front');
  if (!pivotWorld) return null;
  for (const surface of getGearSurfacesForPlacement(toPlacement)) {
    for (const socket of getGearReplacementSockets(mount)) {
      const socketWorld = getGearSocketWorldPosition(toPlacement, socket, surface);
      if (!sameGearWorldPoint(socketWorld, pivotWorld, GEAR_REPLACEMENT_SOCKET_EPSILON)) continue;
      return {
        socket,
        socketKind: isCornerGearSocket(socket) ? 'corner' : 'center',
        surface: normalizeGearSurfaceForPanel(toPlacement.panelType, surface || 'front')
      };
    }
  }
  return null;
};

export const preserveGearMountsForReplacementPlacement = ({
  fromPlacement = null,
  toPlacement = null,
  gearMounts = null
} = {}) => {
  const sourceMounts = Array.isArray(gearMounts)
    ? gearMounts
    : (Array.isArray(fromPlacement?.gearMounts) ? fromPlacement.gearMounts : []);
  return cloneGearMounts(sourceMounts).map((mount) => {
    const replacementTarget = getGearMountReplacementTarget(fromPlacement, toPlacement, mount);
    if (!replacementTarget) return mount;
    return {
      ...mount,
      position: replacementTarget.socket,
      socketKind: replacementTarget.socketKind,
      surface: replacementTarget.surface
    };
  });
};

const getPreservedGearTargetCandidates = ({ nextTiles, nextWalls, pivotWorld }) => {
  const candidates = [];
  const appendPlacement = (hostKind, componentKey, placement) => {
    if (!placement || !pivotWorld) return;
    getGearSurfacesForPlacement(placement).forEach((surface) => {
      Array.from(CITY_CHANNEL_GEAR_CORNER_SOCKETS).forEach((socket) => {
        if (gearSocketOccupied(placement, socket, surface)) return;
        const socketWorld = getGearSocketWorldPosition(placement, socket, surface);
        if (!sameGearWorldPoint(socketWorld, pivotWorld)) return;
        candidates.push({
          hostKind,
          componentKey,
          placement,
          socket,
          surface
        });
      });
    });
  };
  Object.entries(nextTiles || {}).forEach(([componentKey, tile]) => {
    appendPlacement('tile', componentKey, tile);
  });
  Object.entries(nextWalls || {}).forEach(([componentKey, wall]) => {
    appendPlacement('wall', componentKey, wall);
  });
  return candidates;
};

const pickPreservedGearTarget = (targets = [], preferredBinding = null) => {
  if (!targets.length) return null;
  if (preferredBinding?.componentKey) {
    const preferred = targets.find((target) => (
      target.componentKey === preferredBinding.componentKey
      && target.socket === preferredBinding.socket
      && normalizeGearSurfaceForPanel(target.placement?.panelType, target.surface || 'front')
        === normalizeGearSurfaceForPanel(target.placement?.panelType, preferredBinding.surface || 'front')
      && (target.hostKind || 'tile') === (preferredBinding.hostKind || 'tile')
    ));
    if (preferred) return preferred;
  }
  return targets[0];
};

const preserveCornerGearMountsFromRemovedPlacements = ({
  nextTiles,
  nextWalls,
  removedPlacements = []
}) => {
  removedPlacements.forEach(({ hostKind, componentKey, placement }) => {
    const mounts = Array.isArray(placement?.gearMounts) ? placement.gearMounts : [];
    mounts.forEach((mount) => {
      if (!mount?.id || !isCornerGearSocket(mount.position)) return;
      const pivotWorld = getGearSocketWorldPosition(placement, mount.position, mount.surface || 'front');
      const target = pickPreservedGearTarget(
        getPreservedGearTargetCandidates({ nextTiles, nextWalls, pivotWorld }),
        mount.axisBinding
      );
      if (!target) return;
      const targetMap = target.hostKind === 'wall' ? nextWalls : nextTiles;
      const currentTarget = targetMap[target.componentKey];
      if (!currentTarget) return;
      targetMap[target.componentKey] = {
        ...currentTarget,
        gearMounts: [
          ...(currentTarget.gearMounts || []),
          {
            ...mount,
            position: target.socket,
            socketKind: 'corner',
            surface: target.surface || 'front',
            axisBinding: getAxisBindingToRemovedPlacement({ hostKind, componentKey, placement, mount }),
            followMode: 'none',
            followDelaySeconds: 0
          }
        ]
      };
    });
  });
};

const getAxisBindingReplacementTarget = (replacement = null, binding = null) => {
  if (!replacement?.from?.placement || !replacement?.to?.placement || !binding?.socket) return null;
  const pivotWorld = getGearSocketWorldPosition(
    replacement.from.placement,
    binding.socket,
    binding.surface || 'front'
  );
  if (!pivotWorld) return null;
  for (const surface of getGearSurfacesForPlacement(replacement.to.placement)) {
    for (const socket of Array.from(CITY_CHANNEL_GEAR_CORNER_SOCKETS)) {
      const socketWorld = getGearSocketWorldPosition(replacement.to.placement, socket, surface);
      if (!sameGearWorldPoint(socketWorld, pivotWorld, 0.08)) continue;
      return {
        componentKey: replacement.to.componentKey,
        hostKind: replacement.to.hostKind,
        socket,
        surface: normalizeGearSurfaceForPanel(replacement.to.placement?.panelType, surface || 'front')
      };
    }
  }
  return null;
};

const rebindAxisBindingsForReplacementPlacements = ({
  nextTiles,
  nextWalls,
  replacementPlacements = []
}) => {
  if (!replacementPlacements.length) return;
  const replacementsByComponentKey = new Map(
    replacementPlacements.map((replacement) => [replacement.from?.componentKey, replacement])
  );
  const visitPlacement = (targetMap, componentKey) => {
    const placement = targetMap[componentKey];
    if (!placement || !Array.isArray(placement.gearMounts) || placement.gearMounts.length <= 0) return;
    let changed = false;
    const gearMounts = placement.gearMounts.map((mount) => {
      const binding = mount.axisBinding;
      const replacement = replacementsByComponentKey.get(binding?.componentKey);
      if (!replacement) return mount;
      const replacementBinding = getAxisBindingReplacementTarget(replacement, binding);
      if (!replacementBinding) return mount;
      changed = true;
      return {
        ...mount,
        axisBinding: replacementBinding
      };
    });
    if (changed) {
      targetMap[componentKey] = {
        ...placement,
        gearMounts
      };
    }
  };
  Object.keys(nextTiles || {}).forEach((componentKey) => visitPlacement(nextTiles, componentKey));
  Object.keys(nextWalls || {}).forEach((componentKey) => visitPlacement(nextWalls, componentKey));
};

const moveMechanicalLinksForTiles = (links = [], tileMoves = []) => {
  if (!Array.isArray(links) || tileMoves.length <= 0) return links || [];
  const keyMap = new Map(tileMoves.map(({ from, to }) => [
    createCellKey(from.x, from.y, from.z),
    createCellKey(to.x, to.y, to.z)
  ]));
  return links.map((link) => ({
    ...link,
    from: keyMap.has(link.from?.componentKey)
      ? { ...link.from, componentKey: keyMap.get(link.from.componentKey) }
      : link.from,
    to: keyMap.has(link.to?.componentKey)
      ? { ...link.to, componentKey: keyMap.get(link.to.componentKey) }
      : link.to
  }));
};

const resetPortalTiles = (tiles = {}, marker) => (
  Object.entries(tiles).reduce((nextTiles, [key, tile]) => {
    if (tile.marker !== marker && tile.panelType !== marker) {
      nextTiles[key] = tile;
      return nextTiles;
    }
    nextTiles[key] = createTile({
      x: tile.x,
      y: tile.y,
      z: tile.z,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      rotation: tile.rotation,
      transmissionRotation: tile.transmissionRotation ?? tile.rotation
    });
    return nextTiles;
  }, {})
);

export const applyPlacementOperationsToMap = (current, operations = []) => {
  let nextTiles = { ...(current.tiles || {}) };
  const nextWalls = { ...(current.walls || {}) };
  const nextRacks = { ...(current.racks || {}) };
  let nextEntrances = current.entrances || [];
  let nextExits = current.exits || [];
  let nextMechanicalLinks = current.mechanicalLinks || [];
  const removedPlacements = [];
  const replacementPlacements = [];

  operations.forEach((operation) => {
    if (operation.kind === 'rack') {
      const rack = normalizeRack(operation.rack || operation, current);
      if (!rack) return;
      const key = createRackKey(rack);
      if (operation.action === 'erase') {
        delete nextRacks[key];
        return;
      }
      nextRacks[key] = rack;
      return;
    }
    if (operation.kind === 'gearMount') {
      if (!operation.hostKey || !operation.mount) return;
      const targetMap = operation.hostKind === 'wall' ? nextWalls : nextTiles;
      const existing = targetMap[operation.hostKey];
      if (!existing) return;
      if (operation.action === 'erase') {
        targetMap[operation.hostKey] = {
          ...existing,
          gearMounts: (existing.gearMounts || []).filter((mount) => mount.id !== operation.mount.id)
        };
        return;
      }
      const duplicate = (existing.gearMounts || []).some((mount) => (
        mount.position === operation.mount.position
        && normalizeGearSurfaceForPanel(existing.panelType, mount.surface || 'front')
          === normalizeGearSurfaceForPanel(existing.panelType, operation.mount.surface || 'front')
      ));
      if (!duplicate) {
        const bindingPlacement = operation.mount.axisBinding
          ? (operation.mount.axisBinding.hostKind === 'wall'
            ? nextWalls[operation.mount.axisBinding.componentKey]
            : nextTiles[operation.mount.axisBinding.componentKey])
          : null;
        const normalizedMount = {
          ...operation.mount,
          surface: normalizeGearSurfaceForPanel(existing.panelType, operation.mount.surface || 'front'),
          axisBinding: operation.mount.axisBinding
            ? {
              ...operation.mount.axisBinding,
              surface: normalizeGearSurfaceForPanel(bindingPlacement?.panelType, operation.mount.axisBinding.surface || 'front')
            }
            : operation.mount.axisBinding
        };
        targetMap[operation.hostKey] = {
          ...existing,
          gearMounts: [...(existing.gearMounts || []), normalizedMount]
        };
      }
      return;
    }
    if (operation.kind === 'mechanicalLink') {
      if (operation.action === 'erase' && operation.id) {
        nextMechanicalLinks = nextMechanicalLinks.filter((link) => link.id !== operation.id);
        return;
      }
      if (operation.action !== 'place' || !operation.from || !operation.to) return;
      const duplicate = nextMechanicalLinks.some((link) => (
        (link.from?.componentKey === operation.from.componentKey
          && link.from?.portId === operation.from.portId
          && link.to?.componentKey === operation.to.componentKey
          && link.to?.portId === operation.to.portId)
        || (link.from?.componentKey === operation.to.componentKey
          && link.from?.portId === operation.to.portId
          && link.to?.componentKey === operation.from.componentKey
          && link.to?.portId === operation.from.portId)
      ));
      if (!duplicate) {
        nextMechanicalLinks = [
          ...nextMechanicalLinks,
          createMechanicalLink({
            medium: operation.medium || 'rigid_rod',
            from: operation.from,
            to: operation.to,
            routing: operation.routing,
            tensionMode: operation.tensionMode || 'push_pull'
          })
        ];
      }
      return;
    }
    if (!operation?.cell) return;
    const { cell } = operation;
    if (operation.kind === 'wall') {
      const edge = normalizeWallEdge(operation.edge);
      const wallKey = createWallKey(cell.x, cell.y, cell.z, edge);
      if (operation.action === 'erase') {
        if (nextWalls[wallKey]) {
          removedPlacements.push({
            hostKind: 'wall',
            componentKey: wallKey,
            placement: nextWalls[wallKey]
          });
        }
        delete nextWalls[wallKey];
        return;
      }
      const existingWall = nextWalls[wallKey] || null;
      const wall = createWall({
        x: cell.x,
        y: cell.y,
        z: cell.z,
        edge,
        panelType: operation.panelType,
        transmissionRotation: operation.transmissionRotation
      });
      if (Array.isArray(existingWall?.gearMounts) && existingWall.gearMounts.length > 0) {
        wall.gearMounts = preserveGearMountsForReplacementPlacement({
          fromPlacement: existingWall,
          toPlacement: wall
        });
      }
      if (existingWall) {
        replacementPlacements.push({
          from: {
            hostKind: 'wall',
            componentKey: wallKey,
            placement: existingWall
          },
          to: {
            hostKind: 'wall',
            componentKey: wallKey,
            placement: wall
          }
        });
      }
      nextWalls[wallKey] = wall;
      const tileKey = createCellKey(cell.x, cell.y, cell.z);
      if (nextTiles[tileKey]?.isVertical) {
        const removedPlacement = nextTiles[tileKey];
        if (
          (!Array.isArray(existingWall?.gearMounts) || existingWall.gearMounts.length <= 0)
          && Array.isArray(removedPlacement?.gearMounts)
          && removedPlacement.gearMounts.length > 0
        ) {
          wall.gearMounts = preserveGearMountsForReplacementPlacement({
            fromPlacement: removedPlacement,
            toPlacement: wall
          });
        }
        replacementPlacements.push({
          from: {
            hostKind: 'tile',
            componentKey: tileKey,
            placement: removedPlacement
          },
          to: {
            hostKind: 'wall',
            componentKey: wallKey,
            placement: wall
          }
        });
        delete nextTiles[tileKey];
        nextMechanicalLinks = removeMechanicalLinksForComponents(nextMechanicalLinks, new Set([tileKey]));
        nextEntrances = removePointsAtCell(nextEntrances, cell);
        nextExits = removePointsAtCell(nextExits, cell);
      }
      return;
    }

    const tileKey = createCellKey(cell.x, cell.y, cell.z);
    if (operation.action === 'erase') {
      if (nextTiles[tileKey]) {
        removedPlacements.push({
          hostKind: 'tile',
          componentKey: tileKey,
          placement: nextTiles[tileKey]
        });
      }
      delete nextTiles[tileKey];
      nextMechanicalLinks = removeMechanicalLinksForComponents(nextMechanicalLinks, new Set([tileKey]));
      nextEntrances = removePointsAtCell(nextEntrances, cell);
      nextExits = removePointsAtCell(nextExits, cell);
      return;
    }

    const existingMarker = nextTiles[tileKey]?.marker || null;
    if (operation.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || operation.panelType === CITY_CHANNEL_TILE_TYPES.EXIT) {
      const isEntrance = operation.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE;
      const marker = isEntrance ? 'entrance' : 'exit';
      nextTiles = resetPortalTiles(nextTiles, marker);
      const tempMap = { ...current, tiles: nextTiles };
      nextTiles = upsertTile(tempMap, cell, {
        panelType: operation.panelType,
        rotation: operation.rotation,
        transmissionRotation: operation.transmissionRotation,
        marker
      });
      nextEntrances = isEntrance
        ? [{ id: createPointId('entrance', cell), x: cell.x, y: cell.y, z: cell.z }]
        : removePointsAtCell(nextEntrances, cell);
      nextExits = isEntrance
        ? removePointsAtCell(nextExits, cell)
        : [{ id: createPointId('exit', cell), x: cell.x, y: cell.y, z: cell.z }];
      return;
    }

    const existingTile = nextTiles[tileKey] || null;
    const tempMap = { ...current, tiles: nextTiles };
    const isVerticalPlacement = operation.isVertical === true;
    const replacementTile = createTile({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      panelType: operation.panelType,
      rotation: operation.rotation,
      transmissionRotation: operation.transmissionRotation,
      isVertical: isVerticalPlacement
    });
    const preservedGearMounts = Array.isArray(existingTile?.gearMounts) && existingTile.gearMounts.length > 0
      ? preserveGearMountsForReplacementPlacement({
        fromPlacement: existingTile,
        toPlacement: replacementTile
      })
      : undefined;
    nextTiles = upsertTile(tempMap, cell, {
      panelType: operation.panelType,
      rotation: operation.rotation,
      transmissionRotation: operation.transmissionRotation,
      isVertical: isVerticalPlacement,
      marker: existingMarker === 'safe' || existingMarker === 'highlight' ? existingMarker : null,
      ...(preservedGearMounts !== undefined ? { gearMounts: preservedGearMounts } : {})
    });
    if (existingTile) {
      replacementPlacements.push({
        from: {
          hostKind: 'tile',
          componentKey: tileKey,
          placement: existingTile
        },
        to: {
          hostKind: 'tile',
          componentKey: tileKey,
          placement: nextTiles[tileKey]
        }
      });
    }
    nextEntrances = removePointsAtCell(nextEntrances, cell);
    nextExits = removePointsAtCell(nextExits, cell);
  });

  preserveCornerGearMountsFromRemovedPlacements({
    nextTiles,
    nextWalls,
    removedPlacements
  });
  rebindAxisBindingsForReplacementPlacements({
    nextTiles,
    nextWalls,
    replacementPlacements
  });

  return {
    ...current,
    layers: expandLayerCountForCells(current.layers, operations.map((operation) => (
      operation?.kind === 'rack'
        ? { z: operation.rack?.z ?? operation.z }
        : operation?.cell
    ))),
    tiles: nextTiles,
    walls: nextWalls,
    racks: nextRacks,
    entrances: nextEntrances,
    exits: nextExits,
    mechanicalLinks: nextMechanicalLinks
  };
};

export const deletePlacementsFromMap = (current, placements = []) => {
  const nextTiles = { ...(current.tiles || {}) };
  const nextWalls = { ...(current.walls || {}) };
  let nextEntrances = current.entrances || [];
  let nextExits = current.exits || [];
  const removedComponentKeys = new Set();
  const removedPlacements = [];

  placements.forEach((placement) => {
    if (!placement) return;
    if (placement.edge) {
      const wallKey = createWallKey(placement.x, placement.y, placement.z, placement.edge);
      if (nextWalls[wallKey]) {
        removedPlacements.push({
          hostKind: 'wall',
          componentKey: wallKey,
          placement: nextWalls[wallKey]
        });
      }
      delete nextWalls[wallKey];
      removedComponentKeys.add(wallKey);
      return;
    }
    const tileKey = createCellKey(placement.x, placement.y, placement.z);
    if (nextTiles[tileKey]) {
      removedPlacements.push({
        hostKind: 'tile',
        componentKey: tileKey,
        placement: nextTiles[tileKey]
      });
    }
    delete nextTiles[tileKey];
    removedComponentKeys.add(tileKey);
    nextEntrances = removePointsAtCell(nextEntrances, placement);
    nextExits = removePointsAtCell(nextExits, placement);
  });

  preserveCornerGearMountsFromRemovedPlacements({
    nextTiles,
    nextWalls,
    removedPlacements
  });

  return {
    ...current,
    tiles: nextTiles,
    walls: nextWalls,
    entrances: nextEntrances,
    exits: nextExits,
    mechanicalLinks: removeMechanicalLinksForComponents(current.mechanicalLinks || [], removedComponentKeys)
  };
};

export const movePlacementsInMap = (current, moves = []) => {
  const nextTiles = { ...(current.tiles || {}) };
  const nextWalls = { ...(current.walls || {}) };
  let nextEntrances = current.entrances || [];
  let nextExits = current.exits || [];
  const tileMoves = [];
  const wallMoves = [];
  const tileToWallMoves = [];
  const wallToTileMoves = [];

  moves.forEach(({ from, to }) => {
    if (!from || !to) return;
    if (from.edge) {
      const fromKey = createWallKey(from.x, from.y, from.z, from.edge);
      const existingWall = nextWalls[fromKey];
      if (!existingWall) return;
      if (!to.edge) {
        wallToTileMoves.push({ from, to, wall: existingWall });
        return;
      }
      wallMoves.push({ from, to, wall: existingWall });
      return;
    }

    const fromKey = createCellKey(from.x, from.y, from.z);
    const existingTile = nextTiles[fromKey];
    if (!existingTile) return;
    if (to.edge) {
      tileToWallMoves.push({ from, to, tile: existingTile });
      return;
    }
    tileMoves.push({ from, to, tile: existingTile });
  });

  wallMoves.forEach(({ from }) => {
    delete nextWalls[createWallKey(from.x, from.y, from.z, from.edge)];
  });
  wallToTileMoves.forEach(({ from }) => {
    delete nextWalls[createWallKey(from.x, from.y, from.z, from.edge)];
  });
  tileMoves.forEach(({ from }) => {
    delete nextTiles[createCellKey(from.x, from.y, from.z)];
  });
  tileToWallMoves.forEach(({ from }) => {
    delete nextTiles[createCellKey(from.x, from.y, from.z)];
  });

  wallMoves.forEach(({ from, to, wall }) => {
    const edge = normalizeWallEdge(to.edge || from.edge);
    nextWalls[createWallKey(to.x, to.y, to.z, edge)] = {
      ...createWall({
        x: to.x,
        y: to.y,
        z: to.z,
        edge,
        panelType: wall.panelType,
        transmissionRotation: to.transmissionRotation ?? to.rotation ?? wall.transmissionRotation ?? wall.rotation ?? 0,
        marker: wall.marker
      }),
      gearMounts: cloneGearMounts(wall.gearMounts || []),
      gearConfigs: wall.gearConfigs || {},
      triggerConfig: wall.triggerConfig || {},
      motionConfig: wall.motionConfig || {},
      hiddenModule: wall.hiddenModule,
      transmissionSkeleton: wall.transmissionSkeleton,
      mechanismModel: wall.mechanismModel
    };
  });
  wallToTileMoves.forEach(({ from, to, wall }) => {
    const tile = createTile({
      x: to.x,
      y: to.y,
      z: to.z,
      panelType: wall.panelType,
      rotation: to.rotation ?? wall.rotation ?? 0,
      transmissionRotation: to.transmissionRotation ?? to.rotation ?? wall.transmissionRotation ?? wall.rotation ?? 0
    });
    nextTiles[createCellKey(to.x, to.y, to.z)] = {
      ...tile,
      ...(to.layFlat ? { isVertical: false } : (to.isVertical ? { isVertical: true } : {})),
      gearMounts: cloneGearMounts(wall.gearMounts || []),
      gearConfigs: wall.gearConfigs || tile.gearConfigs,
      triggerConfig: wall.triggerConfig || tile.triggerConfig,
      motionConfig: wall.motionConfig || tile.motionConfig
    };
    nextEntrances = movePointsAtCell(nextEntrances, from, to);
    nextExits = movePointsAtCell(nextExits, from, to);
  });
  tileMoves.forEach(({ from, to, tile }) => {
    nextTiles[createCellKey(to.x, to.y, to.z)] = {
      ...tile,
      x: to.x,
      y: to.y,
      z: to.z,
      ...(to.rotation !== undefined ? { rotation: normalizeRotation(to.rotation) } : {}),
      ...(to.transmissionRotation !== undefined || to.rotation !== undefined
        ? { transmissionRotation: normalizeRotation(to.transmissionRotation ?? to.rotation) }
        : {}),
      ...(to.layFlat ? { isVertical: false } : (to.isVertical ? { isVertical: true } : {})),
      gearMounts: cloneGearMounts(tile.gearMounts || [])
    };
    nextEntrances = movePointsAtCell(nextEntrances, from, to);
    nextExits = movePointsAtCell(nextExits, from, to);
  });
  tileToWallMoves.forEach(({ from, to, tile }) => {
    const edge = normalizeWallEdge(to.edge);
    const wall = createWall({
      x: to.x,
      y: to.y,
      z: to.z,
      edge,
      panelType: tile.panelType,
      transmissionRotation: to.transmissionRotation ?? to.rotation ?? tile.transmissionRotation ?? tile.rotation ?? 0
    });
    nextWalls[createWallKey(to.x, to.y, to.z, edge)] = {
      ...wall,
      gearMounts: cloneGearMounts(tile.gearMounts || []),
      gearConfigs: tile.gearConfigs || wall.gearConfigs,
      triggerConfig: tile.triggerConfig || wall.triggerConfig,
      motionConfig: tile.motionConfig || wall.motionConfig
    };
    nextEntrances = movePointsAtCell(nextEntrances, from, to);
    nextExits = movePointsAtCell(nextExits, from, to);
  });

  return {
    ...current,
    layers: expandLayerCountForCells(current.layers, moves.map((move) => move?.to)),
    tiles: nextTiles,
    walls: nextWalls,
    entrances: nextEntrances,
    exits: nextExits,
    mechanicalLinks: moveMechanicalLinksForTiles(current.mechanicalLinks || [], tileMoves)
  };
};

export const rotatePlacementTransmissions = (current, placements = [], delta = 90) => {
  const nextTiles = { ...(current.tiles || {}) };
  const nextWalls = { ...(current.walls || {}) };

  placements.forEach((placement) => {
    if (!placement) return;
    if (placement.edge) {
      const key = createWallKey(placement.x, placement.y, placement.z, placement.edge);
      const existingWall = nextWalls[key];
      if (!existingWall) return;
      nextWalls[key] = {
        ...existingWall,
        transmissionRotation: normalizeRotation((existingWall.transmissionRotation || 0) + delta)
      };
      return;
    }

    const key = createCellKey(placement.x, placement.y, placement.z);
    const existingTile = nextTiles[key];
    if (!existingTile) return;
    nextTiles[key] = {
      ...existingTile,
      transmissionRotation: normalizeRotation((existingTile.transmissionRotation ?? existingTile.rotation ?? 0) + delta)
    };
  });

  return {
    ...current,
    tiles: nextTiles,
    walls: nextWalls
  };
};
