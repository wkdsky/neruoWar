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

const sameCell = (point, target) => (
  point
  && target
  && point.x === target.x
  && point.y === target.y
  && point.z === target.z
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
  let nextEntrances = current.entrances || [];
  let nextExits = current.exits || [];
  let nextMechanicalLinks = current.mechanicalLinks || [];

  operations.forEach((operation) => {
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
        && (mount.surface || 'front') === (operation.mount.surface || 'front')
      ));
      if (!duplicate) {
        targetMap[operation.hostKey] = {
          ...existing,
          gearMounts: [...(existing.gearMounts || []), operation.mount]
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
        delete nextWalls[wallKey];
        return;
      }
      nextWalls[wallKey] = createWall({
        x: cell.x,
        y: cell.y,
        z: cell.z,
        edge,
        panelType: operation.panelType,
        transmissionRotation: operation.transmissionRotation
      });
      const tileKey = createCellKey(cell.x, cell.y, cell.z);
      if (nextTiles[tileKey]?.isVertical) {
        delete nextTiles[tileKey];
        nextMechanicalLinks = removeMechanicalLinksForComponents(nextMechanicalLinks, new Set([tileKey]));
        nextEntrances = removePointsAtCell(nextEntrances, cell);
        nextExits = removePointsAtCell(nextExits, cell);
      }
      return;
    }

    const tileKey = createCellKey(cell.x, cell.y, cell.z);
    if (operation.action === 'erase') {
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

    const tempMap = { ...current, tiles: nextTiles };
    nextTiles = upsertTile(tempMap, cell, {
      panelType: operation.panelType,
      rotation: operation.rotation,
      transmissionRotation: operation.transmissionRotation,
      marker: existingMarker === 'safe' || existingMarker === 'highlight' ? existingMarker : null
    });
    nextEntrances = removePointsAtCell(nextEntrances, cell);
    nextExits = removePointsAtCell(nextExits, cell);
  });

  return {
    ...current,
    tiles: nextTiles,
    walls: nextWalls,
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
  const removedTileKeys = new Set();

  placements.forEach((placement) => {
    if (!placement) return;
    if (placement.edge) {
      delete nextWalls[createWallKey(placement.x, placement.y, placement.z, placement.edge)];
      return;
    }
    const tileKey = createCellKey(placement.x, placement.y, placement.z);
    delete nextTiles[tileKey];
    removedTileKeys.add(tileKey);
    nextEntrances = removePointsAtCell(nextEntrances, placement);
    nextExits = removePointsAtCell(nextExits, placement);
  });

  return {
    ...current,
    tiles: nextTiles,
    walls: nextWalls,
    entrances: nextEntrances,
    exits: nextExits,
    mechanicalLinks: removeMechanicalLinksForComponents(current.mechanicalLinks || [], removedTileKeys)
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
