import { useCallback, useState } from 'react';
import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  cloneConnectors,
  cloneHiddenModule,
  cloneMechanicalPorts,
  clonePlainObject,
  cloneTransmissionSkeleton,
  clampLayer,
  createCellKey,
  createDefaultCityChannelMap,
  createMechanicalLink,
  createTile,
  createWall,
  createWallKey,
  getTileDefinition,
  normalizeRotation,
  normalizeWallEdge,
  normalizeCityChannelMap,
  cloneGearMounts
} from './cityChannelSchema';
import { getCityChannelMaterial } from './cityChannelCatalog';
import { validateCityChannelSafeRoute } from './cityChannelValidation';

const MAX_HISTORY_STEPS = 30;

const createInitialValidation = () => ({
  ok: false,
  message: '尚未验证白线通路',
  route: [],
  checkedCells: 0
});

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

const clearSafeRoute = (mapData) => ({
  ...mapData,
  safeRoute: []
});

const cloneList = (list = []) => (Array.isArray(list) ? list.map((item) => ({ ...item })) : []);

const createHistorySnapshot = (mapData) => {
  const next = clearSafeRoute(mapData);
  return {
    ...next,
    tiles: { ...(next.tiles || {}) },
    walls: { ...(next.walls || {}) },
    entrances: cloneList(next.entrances),
    exits: cloneList(next.exits),
    mechanisms: cloneList(next.mechanisms),
    mechanicalLinks: cloneList(next.mechanicalLinks),
    safeRoute: []
  };
};

const useCityChannelEditorState = (initialMapData = null) => {
  const [mapData, setMapData] = useState(() => (
    initialMapData ? normalizeCityChannelMap(initialMapData) : createDefaultCityChannelMap()
  ));
  const [activeLayer, setActiveLayer] = useState(0);
  const [activeTool, setActiveTool] = useState(CITY_CHANNEL_TOOLS.BROWSE);
  const [activeTileType, setActiveTileType] = useState(null);
  const [activeComponentType, setActiveComponentType] = useState(null);
  const [activeRotation, setActiveRotation] = useState(0);
  const [validationResult, setValidationResult] = useState(createInitialValidation);
  const [statusMessage, setStatusMessage] = useState('浏览模式：拖拽查看通道，滚轮缩放。');
  const [isDirty, setIsDirty] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const applyMapMutation = useCallback((producer, message) => {
    setMapData((current) => {
      setUndoStack((stack) => [...stack, createHistorySnapshot(current)].slice(-MAX_HISTORY_STEPS));
      setRedoStack([]);
      const next = normalizeCityChannelMap(producer(clearSafeRoute(current)));
      return next;
    });
    setIsDirty(true);
    setValidationResult(createInitialValidation());
    if (message) setStatusMessage(message);
  }, []);

  const applyPlacementOperations = useCallback((operations = []) => {
    const cleanOperations = Array.isArray(operations) ? operations.filter(Boolean) : [];
    if (cleanOperations.length <= 0) return;
    applyMapMutation((current) => {
      let nextTiles = { ...(current.tiles || {}) };
      const nextWalls = { ...(current.walls || {}) };
      let nextEntrances = current.entrances || [];
      let nextExits = current.exits || [];
      let nextMechanicalLinks = current.mechanicalLinks || [];

      cleanOperations.forEach((operation) => {
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
    }, cleanOperations.length > 1 ? '板材已批量更新，白线验证结果已重置。' : '板材已更新，白线验证结果已重置。');
  }, [applyMapMutation]);

  const deletePlacements = useCallback((placements = []) => {
    if (!Array.isArray(placements) || placements.length <= 0) return;
    applyMapMutation((current) => {
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
    }, '已删除选中板材。');
  }, [applyMapMutation]);

  const movePlacements = useCallback((moves = []) => {
    if (!Array.isArray(moves) || moves.length <= 0) return;
    applyMapMutation((current) => {
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
    }, '已移动选中板材。');
  }, [applyMapMutation]);

  const rotatePlacements = useCallback((placements = []) => {
    if (!Array.isArray(placements) || placements.length <= 0) return;
    applyMapMutation((current) => {
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
            transmissionRotation: normalizeRotation((existingWall.transmissionRotation || 0) + 90)
          };
          return;
        }

        const key = createCellKey(placement.x, placement.y, placement.z);
        const existingTile = nextTiles[key];
        if (!existingTile) return;
        nextTiles[key] = {
          ...existingTile,
          transmissionRotation: normalizeRotation((existingTile.transmissionRotation ?? existingTile.rotation ?? 0) + 90)
        };
      });

      return {
        ...current,
        tiles: nextTiles,
        walls: nextWalls
      };
    }, '已旋转选中板材的传动骨骼。');
  }, [applyMapMutation]);

  const rotatePlacementsReverse = useCallback((placements = []) => {
    if (!Array.isArray(placements) || placements.length <= 0) return;
    applyMapMutation((current) => {
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
            transmissionRotation: normalizeRotation((existingWall.transmissionRotation || 0) - 90)
          };
          return;
        }

        const key = createCellKey(placement.x, placement.y, placement.z);
        const existingTile = nextTiles[key];
        if (!existingTile) return;
        nextTiles[key] = {
          ...existingTile,
          transmissionRotation: normalizeRotation((existingTile.transmissionRotation ?? existingTile.rotation ?? 0) - 90)
        };
      });

      return {
        ...current,
        tiles: nextTiles,
        walls: nextWalls
      };
    }, '已反向旋转选中板材的传动骨骼。');
  }, [applyMapMutation]);

  const updatePlacement = useCallback((placement, updater, message = '板材配置已更新。') => {
    if (!placement || typeof updater !== 'function') return;
    applyMapMutation((current) => {
      if (placement.edge) {
        const key = createWallKey(placement.x, placement.y, placement.z, placement.edge);
        const existingWall = current.walls?.[key];
        if (!existingWall) return current;
        const nextWall = updater(existingWall);
        if (!nextWall) return current;
        return {
          ...current,
          walls: {
            ...(current.walls || {}),
            [key]: {
              ...existingWall,
              ...nextWall,
              x: existingWall.x,
              y: existingWall.y,
              z: existingWall.z,
              edge: existingWall.edge
            }
          }
        };
      }

      const key = createCellKey(placement.x, placement.y, placement.z);
      const existingTile = current.tiles?.[key];
      if (!existingTile) return current;
      const nextTile = updater(existingTile);
      if (!nextTile) return current;
      return {
        ...current,
        tiles: {
          ...(current.tiles || {}),
          [key]: {
            ...existingTile,
            ...nextTile,
            x: existingTile.x,
            y: existingTile.y,
            z: existingTile.z
          }
        }
      };
    }, message);
  }, [applyMapMutation]);

  const switchLayer = useCallback((layer) => {
    const nextLayer = clampLayer(layer);
    setActiveLayer(nextLayer);
    setStatusMessage(`已切换到第 ${nextLayer + 1} 层。`);
  }, []);

  const markSavedMap = useCallback((nextMapData, validation, message = '保存成功，草稿已更新。') => {
    const normalized = normalizeCityChannelMap(nextMapData || mapData);
    setMapData(normalized);
    setValidationResult(validation || createInitialValidation());
    setIsDirty(false);
    setStatusMessage(message);
  }, [mapData]);

  const validateSafeRoute = useCallback(() => {
    const result = validateCityChannelSafeRoute(mapData);
    setValidationResult(result);
    setMapData((current) => ({
      ...current,
      safeRoute: Array.isArray(result.route) ? result.route : []
    }));
    setStatusMessage(result.message);
    return result;
  }, [mapData]);

  const selectMaterial = useCallback((panelType) => {
    const material = getCityChannelMaterial(panelType);
    setActiveTileType(material.id);
    setActiveComponentType(null);
    setActiveTool(CITY_CHANNEL_TOOLS.PLACE_TILE);
    setStatusMessage(`当前板材：${material.name}。`);
  }, []);

  const selectComponent = useCallback((componentType) => {
    setActiveComponentType(componentType);
    setActiveTileType(null);
    setActiveTool(CITY_CHANNEL_TOOLS.PLACE_COMPONENT);
    setStatusMessage(componentType === 'gear' ? '当前组件：齿轮。' : `当前组件：${componentType}。`);
  }, []);

  const selectOperationTool = useCallback((tool) => {
    setActiveTool(tool);
    if (
      tool === CITY_CHANNEL_TOOLS.BROWSE
      || tool === CITY_CHANNEL_TOOLS.SELECT
      || tool === CITY_CHANNEL_TOOLS.ERASE
    ) {
      setActiveTileType(null);
      setActiveComponentType(null);
    }
    if (tool === CITY_CHANNEL_TOOLS.BROWSE) {
      setStatusMessage('浏览模式：拖拽查看通道，滚轮缩放。');
      return;
    }
    setStatusMessage(tool === CITY_CHANNEL_TOOLS.ERASE ? '擦除模式：点击板材删除。' : '选择模式：点击格子查看信息。');
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length <= 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, createHistorySnapshot(mapData)].slice(-MAX_HISTORY_STEPS));
    setMapData(normalizeCityChannelMap(previous));
    setValidationResult(createInitialValidation());
    setIsDirty(true);
    setStatusMessage('已撤销上一步，白线通路需要重新验证。');
  }, [mapData, undoStack]);

  const redo = useCallback(() => {
    if (redoStack.length <= 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, createHistorySnapshot(mapData)].slice(-MAX_HISTORY_STEPS));
    setMapData(normalizeCityChannelMap(next));
    setValidationResult(createInitialValidation());
    setIsDirty(true);
    setStatusMessage('已重做一步，白线通路需要重新验证。');
  }, [mapData, redoStack]);

  return {
    mapData,
    activeLayer,
    activeTool,
    activeTileType,
    activeComponentType,
    activeRotation,
    validationResult,
    statusMessage,
    isDirty,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    setActiveRotation,
    applyPlacementOperations,
    deletePlacements,
    movePlacements,
    rotatePlacements,
    rotatePlacementsReverse,
    updatePlacement,
    switchLayer,
    markSavedMap,
    validateSafeRoute,
    selectMaterial,
    selectComponent,
    selectOperationTool,
    undo,
    redo
  };
};

export default useCityChannelEditorState;
