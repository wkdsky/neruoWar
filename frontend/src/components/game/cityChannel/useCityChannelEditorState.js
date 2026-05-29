import { useCallback, useState } from 'react';
import {
  CITY_CHANNEL_TOOLS,
  clampLayer,
  createDefaultCityChannelMap,
  createWallKey,
  createCellKey,
  normalizeCityChannelMap
} from './cityChannelSchema';
import { getCityChannelMaterial } from './cityChannelCatalog';
import { validateCityChannelSafeRoute } from './cityChannelValidation';
import {
  applyPlacementOperationsToMap,
  deletePlacementsFromMap,
  movePlacementsInMap,
  rotatePlacementTransmissions
} from './cityChannelEditorMutations';

const MAX_HISTORY_STEPS = 30;

const createInitialValidation = () => ({
  ok: false,
  message: '尚未验证白线通路',
  route: [],
  checkedCells: 0
});

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
    applyMapMutation(
      (current) => applyPlacementOperationsToMap(current, cleanOperations),
      cleanOperations.length > 1 ? '板材已批量更新，白线验证结果已重置。' : '板材已更新，白线验证结果已重置。'
    );
  }, [applyMapMutation]);

  const deletePlacements = useCallback((placements = []) => {
    if (!Array.isArray(placements) || placements.length <= 0) return;
    applyMapMutation((current) => deletePlacementsFromMap(current, placements), '已删除选中板材。');
  }, [applyMapMutation]);

  const movePlacements = useCallback((moves = []) => {
    if (!Array.isArray(moves) || moves.length <= 0) return;
    applyMapMutation((current) => movePlacementsInMap(current, moves), '已移动选中板材。');
  }, [applyMapMutation]);

  const rotatePlacements = useCallback((placements = []) => {
    if (!Array.isArray(placements) || placements.length <= 0) return;
    applyMapMutation((current) => rotatePlacementTransmissions(current, placements, 90), '已旋转选中板材的传动骨骼。');
  }, [applyMapMutation]);

  const rotatePlacementsReverse = useCallback((placements = []) => {
    if (!Array.isArray(placements) || placements.length <= 0) return;
    applyMapMutation((current) => rotatePlacementTransmissions(current, placements, -90), '已反向旋转选中板材的传动骨骼。');
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
