import { useCallback, useMemo, useState } from 'react';
import {
  CITY_CHANNEL_STORAGE_KEY,
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  cloneConnectors,
  cloneHiddenModule,
  cloneMechanicalPorts,
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
  serializeCityChannelMap
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
  return {
    ...mapData.tiles,
    [key]: {
      ...createTile({ x: cell.x, y: cell.y, z: cell.z, panelType }),
      ...existing,
      ...tilePatch,
      x: cell.x,
      y: cell.y,
      z: cell.z,
      panelType,
      category: definition.category || catalogItem.category || 'structure',
      rotation: normalizeRotation(tilePatch.rotation !== undefined ? tilePatch.rotation : existing.rotation),
      walkable: !!definition.walkable,
      solid: !!definition.solid,
      transparent: !!definition.transparent,
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
        : cloneMechanicalPorts(catalogItem.mechanicalPorts || createTile({ x: cell.x, y: cell.y, z: cell.z, panelType }).mechanicalPorts || [], catalogItem)
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
      rotation: tile.rotation
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
  const [activeRotation, setActiveRotation] = useState(0);
  const [selectedCell, setSelectedCell] = useState(null);
  const [validationResult, setValidationResult] = useState(createInitialValidation);
  const [statusMessage, setStatusMessage] = useState('浏览模式：拖拽查看通道，滚轮缩放。');
  const [isDirty, setIsDirty] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const routeKeySet = useMemo(() => (
    new Set((mapData.safeRoute || []).map((point) => createCellKey(point.x, point.y, point.z)))
  ), [mapData.safeRoute]);

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

  const movePortalTile = useCallback((cell, portalType) => {
    if (!cell) return;
    const isEntrance = portalType === CITY_CHANNEL_TILE_TYPES.ENTRANCE;
    const marker = isEntrance ? 'entrance' : 'exit';
    const message = isEntrance
      ? '入口已放置，旧入口已还原为木质地板。'
      : '出口已放置，旧出口已还原为木质地板。';
    applyMapMutation((current) => {
      const withoutOldPortal = resetPortalTiles(current.tiles, marker);
      const tempMap = { ...current, tiles: withoutOldPortal };
      return {
        ...current,
        tiles: upsertTile(tempMap, cell, {
          panelType: portalType,
          rotation: activeRotation,
          marker
        }),
        entrances: isEntrance
          ? [{ id: createPointId('entrance', cell), x: cell.x, y: cell.y, z: cell.z }]
          : removePointsAtCell(current.entrances, cell),
        exits: isEntrance
          ? removePointsAtCell(current.exits, cell)
          : [{ id: createPointId('exit', cell), x: cell.x, y: cell.y, z: cell.z }]
      };
    }, message);
  }, [activeRotation, applyMapMutation]);

  const placeTile = useCallback((cell, panelType) => {
    if (!cell) return;
    if (panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || panelType === CITY_CHANNEL_TILE_TYPES.EXIT) {
      movePortalTile(cell, panelType);
      return;
    }
    applyMapMutation((current) => {
      const existingMarker = current.tiles[createCellKey(cell.x, cell.y, cell.z)]?.marker || null;
      const nextTiles = upsertTile(current, cell, {
        panelType: panelType === CITY_CHANNEL_TOOLS.FLOOR ? CITY_CHANNEL_TILE_TYPES.BASIC_PLATE : panelType,
        rotation: activeRotation,
        marker: existingMarker === 'safe' || existingMarker === 'highlight' ? existingMarker : null
      });
      return {
        ...current,
        tiles: nextTiles,
        entrances: removePointsAtCell(current.entrances, cell),
        exits: removePointsAtCell(current.exits, cell)
      };
    }, '板材已放置，白线验证结果已重置。');
  }, [activeRotation, applyMapMutation, movePortalTile]);

  const placeWall = useCallback((wallPlacement, panelType = CITY_CHANNEL_TILE_TYPES.BASIC_PLATE) => {
    if (!wallPlacement) return;
    const edge = normalizeWallEdge(wallPlacement.edge);
    applyMapMutation((current) => ({
      ...current,
      walls: {
        ...(current.walls || {}),
        [createWallKey(wallPlacement.x, wallPlacement.y, wallPlacement.z, edge)]: createWall({
          x: wallPlacement.x,
          y: wallPlacement.y,
          z: wallPlacement.z,
          edge,
          panelType
        })
      }
    }), '墙壁已吸附到边缘。');
  }, [applyMapMutation]);

  const eraseTile = useCallback((cell) => {
    if (!cell) return;
    applyMapMutation((current) => {
      const key = createCellKey(cell.x, cell.y, cell.z);
      const nextTiles = { ...current.tiles };
      delete nextTiles[key];
      return {
        ...current,
        tiles: nextTiles,
        entrances: removePointsAtCell(current.entrances, cell),
        exits: removePointsAtCell(current.exits, cell)
      };
    }, '格子内容已清除。');
  }, [applyMapMutation]);

  const eraseWall = useCallback((wallPlacement) => {
    if (!wallPlacement) return;
    applyMapMutation((current) => {
      const key = createWallKey(wallPlacement.x, wallPlacement.y, wallPlacement.z, wallPlacement.edge);
      const nextWalls = { ...(current.walls || {}) };
      delete nextWalls[key];
      return {
        ...current,
        walls: nextWalls
      };
    }, '墙壁已移除。');
  }, [applyMapMutation]);

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
            rotation: operation.rotation
          });
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
          panelType: operation.panelType === CITY_CHANNEL_TOOLS.FLOOR
            ? CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
            : operation.panelType,
          rotation: operation.rotation,
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

      moves.forEach(({ from, to }) => {
        if (!from || !to) return;
        if (from.edge) {
          const fromKey = createWallKey(from.x, from.y, from.z, from.edge);
          const existingWall = nextWalls[fromKey];
          if (!existingWall) return;
          wallMoves.push({ from, to, wall: existingWall });
          return;
        }

        const fromKey = createCellKey(from.x, from.y, from.z);
        const existingTile = nextTiles[fromKey];
        if (!existingTile) return;
        tileMoves.push({ from, to, tile: existingTile });
      });

      wallMoves.forEach(({ from }) => {
        delete nextWalls[createWallKey(from.x, from.y, from.z, from.edge)];
      });
      tileMoves.forEach(({ from }) => {
        delete nextTiles[createCellKey(from.x, from.y, from.z)];
      });

      wallMoves.forEach(({ from, to, wall }) => {
        const edge = normalizeWallEdge(to.edge || from.edge);
        nextWalls[createWallKey(to.x, to.y, to.z, edge)] = createWall({
          ...wall,
          x: to.x,
          y: to.y,
          z: to.z,
          edge
        });
      });
      tileMoves.forEach(({ from, to, tile }) => {
        nextTiles[createCellKey(to.x, to.y, to.z)] = {
          ...tile,
          x: to.x,
          y: to.y,
          z: to.z
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
            rotation: normalizeRotation((existingWall.rotation || 0) + 180)
          };
          return;
        }

        const key = createCellKey(placement.x, placement.y, placement.z);
        const existingTile = nextTiles[key];
        if (!existingTile) return;
        nextTiles[key] = {
          ...existingTile,
          rotation: normalizeRotation((existingTile.rotation || 0) + 90)
        };
      });

      return {
        ...current,
        tiles: nextTiles,
        walls: nextWalls
      };
    }, '已旋转选中板材。');
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
            rotation: normalizeRotation((existingWall.rotation || 0) - 180)
          };
          return;
        }

        const key = createCellKey(placement.x, placement.y, placement.z);
        const existingTile = nextTiles[key];
        if (!existingTile) return;
        nextTiles[key] = {
          ...existingTile,
          rotation: normalizeRotation((existingTile.rotation || 0) - 90)
        };
      });

      return {
        ...current,
        tiles: nextTiles,
        walls: nextWalls
      };
    }, '已反向旋转选中板材。');
  }, [applyMapMutation]);

  const flipPlacements = useCallback((placements = []) => {
    if (!Array.isArray(placements) || placements.length <= 0) return;
    applyMapMutation((current) => {
      const nextTiles = { ...(current.tiles || {}) };
      const nextWalls = { ...(current.walls || {}) };

      placements.forEach((placement) => {
        if (!placement) return;
        if (placement.edge) {
          const key = createWallKey(placement.x, placement.y, placement.z, placement.edge);
          const existing = nextWalls[key];
          if (!existing) return;
          nextWalls[key] = { ...existing, flipped: !existing.flipped };
          return;
        }
        const key = createCellKey(placement.x, placement.y, placement.z);
        const existing = nextTiles[key];
        if (!existing) return;
        nextTiles[key] = { ...existing, flipped: !existing.flipped };
      });

      return {
        ...current,
        tiles: nextTiles,
        walls: nextWalls
      };
    }, '已颠倒选中板材。');
  }, [applyMapMutation]);

  const setEntrance = useCallback((cell) => {
    if (!cell) return;
    movePortalTile(cell, CITY_CHANNEL_TILE_TYPES.ENTRANCE);
  }, [movePortalTile]);

  const setExit = useCallback((cell) => {
    if (!cell) return;
    movePortalTile(cell, CITY_CHANNEL_TILE_TYPES.EXIT);
  }, [movePortalTile]);

  const setSafeMarker = useCallback((cell) => {
    if (!cell) return;
    applyMapMutation((current) => {
      const key = createCellKey(cell.x, cell.y, cell.z);
      const existing = current.tiles[key];
      const nextMarker = existing?.marker === 'safe' ? null : 'safe';
      return {
        ...current,
        tiles: upsertTile(current, cell, {
          panelType: existing?.panelType || CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
          marker: nextMarker
        })
      };
    }, '安全标记已更新。');
  }, [applyMapMutation]);

  const rotateTileAtCell = useCallback((cell) => {
    if (!cell) return;
    applyMapMutation((current) => {
      if (cell.edge) {
        const key = createWallKey(cell.x, cell.y, cell.z, cell.edge);
        const existingWall = current.walls?.[key];
        if (!existingWall) return current;
        return {
          ...current,
          walls: {
            ...(current.walls || {}),
            [key]: {
              ...existingWall,
              rotation: normalizeRotation((existingWall.rotation || 0) + 180)
            }
          }
        };
      }
      const key = createCellKey(cell.x, cell.y, cell.z);
      const existing = current.tiles[key];
      if (!existing) return current;
      return {
        ...current,
        tiles: {
          ...current.tiles,
          [key]: {
            ...existing,
            rotation: normalizeRotation((existing.rotation || 0) + 90)
          }
        }
      };
    }, '已旋转选中板材。');
  }, [applyMapMutation]);

  const toggleTileHighlight = useCallback((cell) => {
    if (!cell) return;
    applyMapMutation((current) => {
      if (cell.edge) {
        const key = createWallKey(cell.x, cell.y, cell.z, cell.edge);
        const existingWall = current.walls?.[key];
        if (!existingWall) return current;
        return {
          ...current,
          walls: {
            ...(current.walls || {}),
            [key]: {
              ...existingWall,
              marker: existingWall.marker === 'highlight' ? null : 'highlight'
            }
          }
        };
      }
      const key = createCellKey(cell.x, cell.y, cell.z);
      const existing = current.tiles[key];
      if (!existing) return current;
      return {
        ...current,
        tiles: {
          ...current.tiles,
          [key]: {
            ...existing,
            marker: existing.marker === 'highlight' ? null : 'highlight'
          }
        }
      };
    }, '编辑标记已更新。');
  }, [applyMapMutation]);

  const switchLayer = useCallback((layer) => {
    const nextLayer = clampLayer(layer);
    setActiveLayer(nextLayer);
    setSelectedCell(null);
    setStatusMessage(`已切换到第 ${nextLayer + 1} 层。`);
  }, []);

  const resetMap = useCallback(() => {
    setMapData((current) => {
      setUndoStack((stack) => [...stack, createHistorySnapshot(current)].slice(-MAX_HISTORY_STEPS));
      setRedoStack([]);
      return createDefaultCityChannelMap();
    });
    setActiveLayer(0);
    setSelectedCell(null);
    setValidationResult(createInitialValidation());
    setIsDirty(true);
    setStatusMessage('地图已重置。');
  }, []);

  const loadMap = useCallback((nextMapData, message = '地图已加载。') => {
    const normalized = normalizeCityChannelMap(nextMapData || createDefaultCityChannelMap());
    setMapData(normalized);
    setActiveLayer(0);
    setSelectedCell(null);
    setValidationResult(createInitialValidation());
    setIsDirty(false);
    setUndoStack([]);
    setRedoStack([]);
    setStatusMessage(message);
  }, []);

  const markSavedMap = useCallback((nextMapData, validation, message = '保存成功，草稿已更新。') => {
    const normalized = normalizeCityChannelMap(nextMapData || mapData);
    setMapData(normalized);
    setSelectedCell(null);
    setValidationResult(validation || createInitialValidation());
    setIsDirty(false);
    setStatusMessage(message);
  }, [mapData]);

  const saveToLocal = useCallback(() => {
    try {
      localStorage.setItem(CITY_CHANNEL_STORAGE_KEY, JSON.stringify(serializeCityChannelMap(mapData)));
      setIsDirty(false);
      setStatusMessage('草稿已保存到本地。');
      return true;
    } catch (error) {
      setStatusMessage(`保存草稿失败：${error.message}`);
      return false;
    }
  }, [mapData]);

  const loadFromLocal = useCallback(() => {
    try {
      const raw = localStorage.getItem(CITY_CHANNEL_STORAGE_KEY);
      if (!raw) {
        setStatusMessage('没有找到本地草稿。');
        return false;
      }
      const parsed = JSON.parse(raw);
      const normalized = normalizeCityChannelMap(parsed);
      setMapData(normalized);
      setActiveLayer(0);
      setSelectedCell(null);
      setValidationResult(createInitialValidation());
      setIsDirty(false);
      setUndoStack([]);
      setRedoStack([]);
      setStatusMessage('本地草稿已加载。');
      return true;
    } catch (error) {
      setStatusMessage(`加载草稿失败：${error.message}`);
      return false;
    }
  }, []);

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

  const handleCellAction = useCallback((cell) => {
    if (!cell) return;
    if (activeTool === CITY_CHANNEL_TOOLS.BROWSE) {
      return;
    }
    setSelectedCell(cell);
    if (activeTool === CITY_CHANNEL_TOOLS.SELECT) {
      setStatusMessage('已选中格子。');
      return;
    }
    if (activeTool === CITY_CHANNEL_TOOLS.ERASE) {
      eraseTile(cell);
      return;
    }
    if (activeTool === CITY_CHANNEL_TOOLS.ENTRANCE) {
      setEntrance(cell);
      return;
    }
    if (activeTool === CITY_CHANNEL_TOOLS.EXIT) {
      setExit(cell);
      return;
    }
    if (activeTool === CITY_CHANNEL_TOOLS.SAFE_MARKER) {
      setSafeMarker(cell);
      return;
    }
    if (activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && activeTileType) {
      placeTile(cell, activeTileType);
      return;
    }
    placeTile(cell, activeTool === CITY_CHANNEL_TOOLS.FLOOR ? CITY_CHANNEL_TILE_TYPES.BASIC_PLATE : activeTool);
  }, [
    activeTileType,
    activeTool,
    eraseTile,
    placeTile,
    setEntrance,
    setExit,
    setSafeMarker
  ]);

  const rotateActiveItem = useCallback(() => {
    setActiveRotation((current) => normalizeRotation(current + 90));
    setStatusMessage('物品方向已旋转 90°。');
  }, []);

  const selectMaterial = useCallback((panelType) => {
    const material = getCityChannelMaterial(panelType);
    setActiveTileType(material.id);
    setActiveTool(CITY_CHANNEL_TOOLS.PLACE_TILE);
    setSelectedCell(null);
    setStatusMessage(`当前板材：${material.name}。`);
  }, []);

  const selectOperationTool = useCallback((tool) => {
    setActiveTool(tool);
    if (
      tool === CITY_CHANNEL_TOOLS.BROWSE
      || tool === CITY_CHANNEL_TOOLS.SELECT
      || tool === CITY_CHANNEL_TOOLS.ERASE
    ) {
      setActiveTileType(null);
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
    setSelectedCell(null);
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
    setSelectedCell(null);
    setValidationResult(createInitialValidation());
    setIsDirty(true);
    setStatusMessage('已重做一步，白线通路需要重新验证。');
  }, [mapData, redoStack]);

  return {
    mapData,
    activeLayer,
    activeTool,
    activeTileType,
    activeRotation,
    selectedCell,
    validationResult,
    statusMessage,
    isDirty,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    routeKeySet,
    setActiveTool,
    setActiveTileType,
    setActiveRotation,
    setSelectedCell,
    placeTile,
    placeWall,
    eraseTile,
    eraseWall,
    applyPlacementOperations,
    deletePlacements,
    movePlacements,
    rotatePlacements,
    rotatePlacementsReverse,
    flipPlacements,
    setEntrance,
    setExit,
    rotateTileAtCell,
    toggleTileHighlight,
    switchLayer,
    resetMap,
    loadMap,
    markSavedMap,
    saveToLocal,
    loadFromLocal,
    validateSafeRoute,
    handleCellAction,
    rotateActiveItem,
    selectMaterial,
    selectOperationTool,
    undo,
    redo
  };
};

export default useCityChannelEditorState;
