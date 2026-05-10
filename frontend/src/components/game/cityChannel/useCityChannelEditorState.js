import { useCallback, useMemo, useState } from 'react';
import {
  CITY_CHANNEL_STORAGE_KEY,
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  clampLayer,
  createCellKey,
  createDefaultCityChannelMap,
  createTile,
  getTileDefinition,
  normalizeRotation,
  normalizeCityChannelMap,
  serializeCityChannelMap
} from './cityChannelSchema';
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

const upsertTile = (mapData, cell, tilePatch = {}) => {
  const panelType = tilePatch.panelType || CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR;
  const definition = getTileDefinition(panelType);
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
      rotation: normalizeRotation(tilePatch.rotation !== undefined ? tilePatch.rotation : existing.rotation),
      walkable: !!definition.walkable,
      solid: !!definition.solid,
      hiddenModule: tilePatch.hiddenModule !== undefined
        ? tilePatch.hiddenModule
        : (existing.hiddenModule || null),
      connectors: Array.isArray(tilePatch.connectors)
        ? tilePatch.connectors
        : (Array.isArray(existing.connectors) ? existing.connectors : [])
    }
  };
};

const clearSafeRoute = (mapData) => ({
  ...mapData,
  safeRoute: []
});

const createHistorySnapshot = (mapData) => serializeCityChannelMap(clearSafeRoute(mapData));

const useCityChannelEditorState = (initialMapData = null) => {
  const [mapData, setMapData] = useState(() => (
    initialMapData ? normalizeCityChannelMap(initialMapData) : createDefaultCityChannelMap()
  ));
  const [activeLayer, setActiveLayer] = useState(0);
  const [activeTool, setActiveTool] = useState(CITY_CHANNEL_TOOLS.SELECT);
  const [activeRotation, setActiveRotation] = useState(0);
  const [selectedCell, setSelectedCell] = useState(null);
  const [validationResult, setValidationResult] = useState(createInitialValidation);
  const [statusMessage, setStatusMessage] = useState('选择物品后，在虚空平面上点击放置。');
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

  const placeTile = useCallback((cell, panelType) => {
    if (!cell) return;
    applyMapMutation((current) => {
      const nextTiles = upsertTile(current, cell, {
        panelType: panelType === CITY_CHANNEL_TOOLS.FLOOR ? CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR : panelType,
        rotation: activeRotation,
        marker: panelType === CITY_CHANNEL_TILE_TYPES.WALL ? null : (current.tiles[createCellKey(cell.x, cell.y, cell.z)]?.marker || null)
      });
      return {
        ...current,
        tiles: nextTiles,
        entrances: panelType === CITY_CHANNEL_TILE_TYPES.WALL ? removePointsAtCell(current.entrances, cell) : current.entrances,
        exits: panelType === CITY_CHANNEL_TILE_TYPES.WALL ? removePointsAtCell(current.exits, cell) : current.exits
      };
    }, '板材已放置，白线验证结果已重置。');
  }, [activeRotation, applyMapMutation]);

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

  const setEntrance = useCallback((cell) => {
    if (!cell) return;
    applyMapMutation((current) => ({
      ...current,
      tiles: upsertTile(current, cell, {
        panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR,
        rotation: activeRotation,
        marker: current.tiles[createCellKey(cell.x, cell.y, cell.z)]?.marker || null
      }),
      entrances: [{ id: createPointId('entrance', cell), x: cell.x, y: cell.y, z: cell.z }],
      exits: removePointsAtCell(current.exits, cell)
    }), '入口已放置。');
  }, [activeRotation, applyMapMutation]);

  const setExit = useCallback((cell) => {
    if (!cell) return;
    applyMapMutation((current) => ({
      ...current,
      tiles: upsertTile(current, cell, {
        panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR,
        rotation: activeRotation,
        marker: current.tiles[createCellKey(cell.x, cell.y, cell.z)]?.marker || null
      }),
      exits: [{ id: createPointId('exit', cell), x: cell.x, y: cell.y, z: cell.z }],
      entrances: removePointsAtCell(current.entrances, cell)
    }), '出口已放置。');
  }, [activeRotation, applyMapMutation]);

  const setSafeMarker = useCallback((cell) => {
    if (!cell) return;
    applyMapMutation((current) => {
      const key = createCellKey(cell.x, cell.y, cell.z);
      const existing = current.tiles[key];
      const nextMarker = existing?.marker === 'safe' ? null : 'safe';
      return {
        ...current,
        tiles: upsertTile(current, cell, {
          panelType: existing?.panelType || CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR,
          marker: nextMarker
        })
      };
    }, '安全标记已更新。');
  }, [applyMapMutation]);

  const rotateTileAtCell = useCallback((cell) => {
    if (!cell) return;
    applyMapMutation((current) => {
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
    placeTile(cell, activeTool === CITY_CHANNEL_TOOLS.FLOOR ? CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR : activeTool);
  }, [
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
    activeRotation,
    selectedCell,
    validationResult,
    statusMessage,
    isDirty,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    routeKeySet,
    setActiveTool,
    setActiveRotation,
    setSelectedCell,
    placeTile,
    eraseTile,
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
    undo,
    redo
  };
};

export default useCityChannelEditorState;
