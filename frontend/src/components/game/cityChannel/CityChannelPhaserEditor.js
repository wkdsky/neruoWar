import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Hand,
  Layers,
  LogOut,
  MousePointer2,
  Move,
  PanelTop,
  Redo2,
  Replace,
  RotateCw,
  Save,
  Settings,
  Trash2,
  Undo2,
  Wand2
} from 'lucide-react';
import {
  CITY_CHANNEL_LAYER_LABELS,
  CITY_CHANNEL_STORAGE_KEY,
  CITY_CHANNEL_TOOLS,
  createCellKey,
  createWallKey,
  normalizeRotation,
  normalizeTemplateMeta,
  serializeCityChannelMap
} from './cityChannelSchema';
import { getCityChannelMaterial } from './cityChannelCatalog';
import {
  CITY_CHANNEL_MECHANISM_LIMITS,
  buildMechanicalAssemblies,
  getAssemblyForCell,
  getMechanismParamKey,
  normalizeMechanismParams
} from './cityChannelMechanismRuntime';
import useCityChannelEditorState from './useCityChannelEditorState';
import CityChannelMaterialPalette from './CityChannelMaterialPalette';
import CityChannelPressurePlateInspect3D from './CityChannelPressurePlateInspect3D';
import './CityChannelImmersiveEditor.css';
import './CityChannelPhaserEditor.css';

const TOOL_ITEMS = [
  { key: CITY_CHANNEL_TOOLS.BROWSE, label: '浏览', Icon: Hand },
  { key: CITY_CHANNEL_TOOLS.SELECT, label: '选择', Icon: MousePointer2 }
];

const FLOATING_PANELS = [
  { key: 'layers', label: '图层', Icon: Layers }
];

const WALL_VIEW_MODES = ['semi', 'perspective', 'solid'];

const WALL_VIEW_MODE_CONFIG = {
  semi: {
    label: '半透视',
    toast: '墙板显示：半透视'
  },
  perspective: {
    label: '透视',
    toast: '墙板显示：透视'
  },
  solid: {
    label: '不透视',
    toast: '墙板显示：不透视'
  }
};

const stopEditorPanelPointerEvent = (event) => {
  event.stopPropagation();
};

const toolLabelByKey = {
  [CITY_CHANNEL_TOOLS.BROWSE]: '浏览',
  [CITY_CHANNEL_TOOLS.SELECT]: '选择',
  [CITY_CHANNEL_TOOLS.ERASE]: '擦除',
  [CITY_CHANNEL_TOOLS.PLACE_TILE]: '放置'
};

const CityChannelPhaserEditor = ({
  initialMapData,
  templateId = null,
  templateName,
  templateSource = 'local',
  onExit
}) => {
  const editor = useCityChannelEditorState(initialMapData);
  const {
    mapData,
    activeLayer,
    activeTool,
    activeTileType,
    activeRotation,
    validationResult,
    statusMessage,
    isDirty,
    canUndo,
    canRedo,
    setActiveRotation,
    setSelectedCell,
    applyPlacementOperations,
    deletePlacements,
    movePlacements,
    rotatePlacements,
    rotatePlacementsReverse,
    flipPlacements,
    markSavedMap,
    validateSafeRoute,
    switchLayer,
    selectMaterial,
    selectOperationTool,
    undo,
    redo
  } = editor;

  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const sceneRef = useRef(null);
  const placeReturnToolRef = useRef(CITY_CHANNEL_TOOLS.BROWSE);
  const [phaserStatus, setPhaserStatus] = useState('loading');
  const [wallViewMode, setWallViewMode] = useState('semi');
  const [panelPose, setPanelPose] = useState('floor');
  const [showHelperGrid, setShowHelperGrid] = useState(false);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [selectedCells, setSelectedCells] = useState([]);
  const [selectedWalls, setSelectedWalls] = useState([]);
  const [openPanel, setOpenPanel] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [hoverStatusLabel, setHoverStatusLabel] = useState('浏览模式');
  const [cameraSummary, setCameraSummary] = useState({ zoom: 1, yaw: 0 });
  const [mechanismParams, setMechanismParams] = useState(() => mapData.mechanismParams || {});
  const [mechanismPanel, setMechanismPanel] = useState(null);
  const [inspectMode, setInspectMode] = useState(null);
  const [mechanismPreviewState, setMechanismPreviewState] = useState(null);

  const activeLayerLabel = CITY_CHANNEL_LAYER_LABELS[activeLayer] || `第 ${activeLayer + 1} 层`;
  const wallViewModeConfig = WALL_VIEW_MODE_CONFIG[wallViewMode] || WALL_VIEW_MODE_CONFIG.semi;
  const selectedPlacements = useMemo(() => (
    [...selectedCells, ...selectedWalls]
  ), [selectedCells, selectedWalls]);
  const selectedCount = selectedPlacements.length;
  const selectedTileKey = selectedCells.length === 1 && selectedWalls.length === 0
    ? createCellKey(selectedCells[0].x, selectedCells[0].y, selectedCells[0].z)
    : '';
  const selectedWallKey = selectedWalls.length === 1 && selectedCells.length === 0
    ? createWallKey(selectedWalls[0].x, selectedWalls[0].y, selectedWalls[0].z, selectedWalls[0].edge)
    : '';
  const selectedTile = selectedTileKey ? mapData.tiles?.[selectedTileKey] : null;
  const selectedWall = selectedWallKey ? mapData.walls?.[selectedWallKey] : null;
  const canInspectSelectedTile = !!selectedTile;
  const shouldBuildAssemblyGraph = !!(selectedTileKey || selectedWallKey || mechanismPanel?.key);
  const assemblyGraph = useMemo(() => (
    shouldBuildAssemblyGraph ? buildMechanicalAssemblies(mapData) : null
  ), [mapData, shouldBuildAssemblyGraph]);
  const selectedAssembly = useMemo(() => (
    selectedTileKey || selectedWallKey ? getAssemblyForCell(assemblyGraph, selectedTileKey || selectedWallKey) : null
  ), [assemblyGraph, selectedTileKey, selectedWallKey]);
  const objectCounts = useMemo(() => ({
    tiles: Object.keys(mapData.tiles || {}).length,
    walls: Object.keys(mapData.walls || {}).length
  }), [mapData.tiles, mapData.walls]);
  const activePanelKey = mechanismPanel?.key || selectedTileKey || selectedWallKey;
  const activePanelTile = mechanismPanel?.key
    ? (mapData.tiles?.[mechanismPanel.key] || mapData.walls?.[mechanismPanel.key])
    : (selectedTile || selectedWall);
  const activePanelPanelType = mechanismPanel?.panelType || activePanelTile?.panelType || '';
  const mechanismPanelParams = useMemo(() => (
    normalizeMechanismParams(mechanismParams[activePanelKey])
  ), [activePanelKey, mechanismParams]);
  const mechanismPanelMaterial = activePanelPanelType
    ? getCityChannelMaterial(activePanelPanelType)
    : null;
  const mechanismPanelStyle = useMemo(() => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    return {
      right: viewportWidth <= 760 ? '12px' : 'max(18px, env(safe-area-inset-right))',
      top: inspectMode?.active ? '50%' : '74px',
      transform: inspectMode?.active ? 'translateY(-50%)' : 'none'
    };
  }, [inspectMode?.active]);

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, message, type, timestamp: Date.now() }]);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedCells([]);
    setSelectedWalls([]);
    setSelectedCell(null);
    sceneRef.current?.setSelection?.([], []);
  }, [setSelectedCell]);

  const handleSelectionChange = useCallback(({ cells = [], walls = [] } = {}) => {
    setSelectedCells(cells);
    setSelectedWalls(walls);
    setSelectedCell(cells[0] || walls[0] || null);
  }, [setSelectedCell]);

  const handleMaterialSelect = useCallback((panelType) => {
    if (activeTool !== CITY_CHANNEL_TOOLS.PLACE_TILE) {
      placeReturnToolRef.current = activeTool === CITY_CHANNEL_TOOLS.SELECT
        ? CITY_CHANNEL_TOOLS.SELECT
        : CITY_CHANNEL_TOOLS.BROWSE;
    }
    clearSelection();
    selectMaterial(panelType);
  }, [activeTool, clearSelection, selectMaterial]);

  const handleRequestTool = useCallback((tool) => {
    if (tool === CITY_CHANNEL_TOOLS.BROWSE || tool === CITY_CHANNEL_TOOLS.SELECT) {
      placeReturnToolRef.current = tool;
    }
    selectOperationTool(tool);
  }, [selectOperationTool]);

  const handleExitPlaceMode = useCallback(() => {
    const returnTool = placeReturnToolRef.current === CITY_CHANNEL_TOOLS.SELECT
      ? CITY_CHANNEL_TOOLS.SELECT
      : CITY_CHANNEL_TOOLS.BROWSE;
    clearSelection();
    selectOperationTool(returnTool);
    addToast('已退出放置模式。', 'info');
  }, [addToast, clearSelection, selectOperationTool]);

  const handleCommitOperations = useCallback((operations) => {
    applyPlacementOperations(operations);
  }, [applyPlacementOperations]);

  const handleMovePlacements = useCallback((moves) => {
    if (!Array.isArray(moves) || moves.length <= 0) return;
    movePlacements(moves);
    setMechanismParams((current) => {
      const next = { ...current };
      moves.forEach(({ from, to }) => {
        if (!from || !to || to.edge) return;
        const fromKey = createCellKey(from.x, from.y, from.z);
        const toKey = createCellKey(to.x, to.y, to.z);
        if (next[fromKey]) {
          next[toKey] = next[fromKey];
          delete next[fromKey];
        }
      });
      return next;
    });
    const nextCells = [];
    const nextWalls = [];
    moves.forEach(({ to }) => {
      if (!to) return;
      if (to.edge) nextWalls.push({ x: to.x, y: to.y, z: to.z, edge: to.edge });
      else nextCells.push({ x: to.x, y: to.y, z: to.z });
    });
    setSelectedCells(nextCells);
    setSelectedWalls(nextWalls);
  }, [movePlacements]);

  const handleMechanismPanelRequest = useCallback((payload = null) => {
    if (!payload) {
      setMechanismPanel(null);
      return;
    }
    const key = payload.key || (payload.edge
      ? createWallKey(payload.cell.x, payload.cell.y, payload.cell.z, payload.edge)
      : getMechanismParamKey(payload.cell));
    if (!key) {
      setMechanismPanel(null);
      return;
    }
    if (payload.edge) {
      setSelectedCells([]);
      setSelectedWalls([{ ...payload.cell, edge: payload.edge }]);
      setSelectedCell({ ...payload.cell, edge: payload.edge });
    } else {
      setSelectedCells([payload.cell]);
      setSelectedWalls([]);
      setSelectedCell(payload.cell);
    }
    setMechanismParams((current) => ({
      ...current,
      [key]: normalizeMechanismParams(current[key] || payload.params)
    }));
    setMechanismPanel({
      key,
      cell: payload.cell,
      edge: payload.edge || null,
      panelType: payload.panelType,
      anchor: payload.anchor || null
    });
  }, [setSelectedCell]);

  const updateMechanismParam = useCallback((field, value) => {
    if (!activePanelKey) return;
    setMechanismParams((current) => ({
      ...current,
      [activePanelKey]: normalizeMechanismParams({
        ...(current[activePanelKey] || {}),
        [field]: value
      })
    }));
  }, [activePanelKey]);

  const executeMechanismPanelAction = useCallback(() => {
    const cell = mechanismPanel?.cell || selectedCells[0];
    if (!cell) return;
    const executed = sceneRef.current?.triggerMechanismAtCell?.(cell, mechanismPanelParams);
    if (!executed) {
      addToast('当前机关无法运行。', 'error');
      return;
    }
    addToast('运行预览已启动。', 'info');
  }, [addToast, mechanismPanel?.cell, mechanismPanelParams, selectedCells]);

  const handleMechanismPreviewProgress = useCallback((payload = null) => {
    setMechanismPreviewState(payload);
  }, []);

  const handleInspectChange = useCallback((payload = null) => {
    setInspectMode(payload?.active ? payload : null);
  }, []);

  const handleInspectSelected = useCallback(() => {
    if (inspectMode?.active) {
      sceneRef.current?.closeInspectMode?.();
      return;
    }
    const opened = sceneRef.current?.inspectSelectedTile?.();
    if (!opened) addToast('请选择一个可观察的地块。', 'error');
  }, [addToast, inspectMode?.active]);

  const handleDeleteSelection = useCallback(() => {
    if (selectedPlacements.length <= 0) return;
    setMechanismParams((current) => {
      const next = { ...current };
      selectedCells.forEach((cell) => {
        delete next[createCellKey(cell.x, cell.y, cell.z)];
      });
      return next;
    });
    deletePlacements(selectedPlacements);
    clearSelection();
  }, [clearSelection, deletePlacements, selectedCells, selectedPlacements]);

  const handleRotateSelection = useCallback((direction = 'forward') => {
    if (selectedPlacements.length <= 0) return;
    if (direction === 'reverse') rotatePlacementsReverse(selectedPlacements);
    else rotatePlacements(selectedPlacements);
  }, [rotatePlacements, rotatePlacementsReverse, selectedPlacements]);

  const handleFlipSelection = useCallback(() => {
    if (selectedPlacements.length <= 0) return;
    flipPlacements(selectedPlacements);
  }, [flipPlacements, selectedPlacements]);

  const handleRotateActive = useCallback((delta = 90) => {
    setActiveRotation((current) => normalizeRotation(current + delta));
  }, [setActiveRotation]);

  const runValidation = useCallback(() => {
    const result = validateSafeRoute();
    if (result.ok) addToast('验证通过：入口可到达出口', 'success');
    else addToast(`验证失败：${result.message}`, 'error');
    return result;
  }, [addToast, validateSafeRoute]);

  const handleSave = useCallback(() => {
    const result = validateSafeRoute();
    if (!result.ok) {
      addToast(`保存失败：${result.message}`, 'error');
      return;
    }
    const nextMapData = {
      ...mapData,
      name: templateName || mapData.name || '城内通道草稿',
      templateMeta: normalizeTemplateMeta({
        ...mapData.templateMeta,
        source: templateSource || mapData.templateMeta?.source || 'local',
        templateId: mapData.templateMeta?.templateId || templateId,
        parentTemplateId: mapData.templateMeta?.parentTemplateId || (templateSource && templateSource !== 'draft' ? templateId : null),
        rootTemplateId: mapData.templateMeta?.rootTemplateId || templateId,
        originalTemplateId: mapData.templateMeta?.originalTemplateId || templateId,
        savedAt: new Date().toISOString()
      }, mapData.templateMeta),
      safeRoute: result.route,
      mechanismParams
    };
    try {
      localStorage.setItem(CITY_CHANNEL_STORAGE_KEY, JSON.stringify(serializeCityChannelMap(nextMapData)));
      markSavedMap(nextMapData, result, '保存成功。');
      addToast('保存成功，白通路已验证', 'success');
    } catch (error) {
      addToast(`保存失败：${error.message}`, 'error');
    }
  }, [addToast, mapData, markSavedMap, mechanismParams, templateId, templateName, templateSource, validateSafeRoute]);

  const handleExit = useCallback(() => {
    if (isDirty && !window.confirm('当前模板有未保存修改，确定退出到城内工坊首页？')) return;
    onExit?.();
  }, [isDirty, onExit]);

  const sceneConfig = useMemo(() => ({
    mapData,
    activeTool,
    activeTileType,
    activeRotation,
    activeLayer,
    panelPose,
    wallViewMode,
    showHelperGrid,
    showCoordinates,
    selection: {
      cells: selectedCells,
      walls: selectedWalls
    },
    onSceneReady: (scene) => {
      sceneRef.current = scene;
      setPhaserStatus('ready');
    },
    onCommitOperations: handleCommitOperations,
    onSelectionChange: handleSelectionChange,
    onHoverStatusChange: setHoverStatusLabel,
    onCameraChange: setCameraSummary,
    onRequestTool: handleRequestTool,
    onExitPlaceMode: handleExitPlaceMode,
    onRotateSelection: handleRotateSelection,
    onRotateActive: handleRotateActive,
    onTogglePanelPose: () => {
      setPanelPose((current) => (current === 'wall' ? 'floor' : 'wall'));
    },
    onUndo: undo,
    onRedo: redo,
    onDeleteSelection: handleDeleteSelection,
    onFlipSelection: handleFlipSelection,
    onMovePlacements: handleMovePlacements,
    onMechanismPanelRequest: handleMechanismPanelRequest,
    onInspectChange: handleInspectChange,
    onMechanismPreviewProgress: handleMechanismPreviewProgress,
    externalInspectOverlay: true,
    mechanismParams,
    onToast: addToast
  }), [
    activeRotation,
    activeLayer,
    activeTileType,
    activeTool,
    addToast,
    handleCommitOperations,
    handleDeleteSelection,
    handleFlipSelection,
    handleMovePlacements,
    handleMechanismPanelRequest,
    handleInspectChange,
    handleMechanismPreviewProgress,
    handleRotateActive,
    setPanelPose,
    handleRotateSelection,
    handleSelectionChange,
    mapData,
    mechanismParams,
    panelPose,
    redo,
    handleExitPlaceMode,
    handleRequestTool,
    selectedCells,
    selectedWalls,
    showCoordinates,
    showHelperGrid,
    undo,
    wallViewMode
  ]);
  const latestSceneConfigRef = useRef(sceneConfig);
  latestSceneConfigRef.current = sceneConfig;

  useEffect(() => {
    document.body.classList.add('city-channel-immersive-active');
    return () => document.body.classList.remove('city-channel-immersive-active');
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return undefined;
    const timer = setTimeout(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((toast) => now - toast.timestamp < 3000));
    }, 3100);
    return () => clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    let cancelled = false;
    let game = null;

    const bootPhaser = async () => {
      try {
        setPhaserStatus('loading');
        const [phaserModule, sceneModule] = await Promise.all([
          import('phaser'),
          import('./phaser/CityChannelPhaserScene')
        ]);
        if (cancelled || !containerRef.current) return;
        const Phaser = phaserModule.default || phaserModule;
        const SceneClass = sceneModule.createCityChannelPhaserScene(Phaser, latestSceneConfigRef.current);
        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: containerRef.current,
          width: Math.max(1, containerRef.current.clientWidth || window.innerWidth),
          height: Math.max(1, containerRef.current.clientHeight || window.innerHeight),
          backgroundColor: '#020617',
          render: {
            antialias: true,
            antialiasGL: true,
            roundPixels: false,
            powerPreference: 'high-performance'
          },
          scale: {
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.CENTER_BOTH
          },
          scene: SceneClass
        });
        gameRef.current = game;
      } catch (error) {
        setPhaserStatus('error');
        addToast(`Phaser 编辑器加载失败：${error.message}`, 'error');
      }
    };

    bootPhaser();

    return () => {
      cancelled = true;
      sceneRef.current = null;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      } else if (game) {
        game.destroy(true);
      }
    };
  }, [addToast]);

  useEffect(() => {
    sceneRef.current?.updateConfig?.(sceneConfig);
  }, [sceneConfig]);

  useEffect(() => {
    if (!mechanismPanel?.cell) return;
    const selectedKey = selectedCells.length === 1 && selectedWalls.length === 0
      ? createCellKey(selectedCells[0].x, selectedCells[0].y, selectedCells[0].z)
      : selectedWalls.length === 1 && selectedCells.length === 0
        ? createWallKey(selectedWalls[0].x, selectedWalls[0].y, selectedWalls[0].z, selectedWalls[0].edge)
        : '';
    const placement = mapData.tiles?.[mechanismPanel.key] || mapData.walls?.[mechanismPanel.key];
    if (selectedKey !== mechanismPanel.key || !placement) {
      setMechanismPanel(null);
    }
  }, [mapData.tiles, mapData.walls, mechanismPanel, selectedCells, selectedWalls]);

  useEffect(() => {
    if (!inspectMode?.active) return;
    if (!canInspectSelectedTile || selectedTileKey !== inspectMode.key) {
      sceneRef.current?.closeInspectMode?.({ animate: false });
    }
  }, [canInspectSelectedTile, inspectMode, selectedTileKey]);

  return (
    <div
      className={[
        'city-channel-immersive',
        'city-channel-phaser-editor',
        'has-palette',
        wallViewMode === 'perspective' ? 'is-wall-transparent' : '',
        wallViewMode === 'solid' ? 'is-wall-solid' : '',
        showHelperGrid ? 'is-helper-grid-visible' : ''
      ].filter(Boolean).join(' ')}
    >
      <div className="city-channel-immersive__void" aria-hidden="true" />

      <CityChannelMaterialPalette
        activeTileType={activeTileType}
        onMaterialSelect={handleMaterialSelect}
      />

      <div className="city-channel-toast-container" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`city-channel-toast is-${toast.type}`}>{toast.message}</div>
        ))}
      </div>

      <div className="city-channel-immersive__topbar">
        <button type="button" className="city-channel-glass-btn" onClick={handleExit}>
          <LogOut size={16} /> 退出
        </button>
        <button type="button" className="city-channel-glass-btn is-primary" onClick={handleSave}>
          <Save size={16} /> 保存
        </button>
        <button type="button" className="city-channel-glass-btn" onClick={undo} disabled={!canUndo}>
          <Undo2 size={16} /> 撤销
        </button>
        <button type="button" className="city-channel-glass-btn" onClick={redo} disabled={!canRedo}>
          <Redo2 size={16} /> 重做
        </button>
      </div>

      <div className="city-channel-viewport city-channel-phaser-viewport">
        <div ref={containerRef} className="city-channel-phaser-stage" />
        {phaserStatus !== 'ready' ? (
          <div className={`city-channel-phaser-loader is-${phaserStatus}`}>
            {phaserStatus === 'error' ? 'Phaser 编辑器加载失败' : '正在加载 Phaser 编辑器'}
          </div>
        ) : null}
      </div>

      {selectedCount > 0 && (
        <div className="city-channel-selection-actions" onPointerDown={stopEditorPanelPointerEvent}>
          <span className="city-channel-selection-actions__count">{selectedCount}</span>
          <button type="button" className="city-channel-selection-action" onClick={() => sceneRef.current?.startCarry?.()} title="移动 (M)">
            <Move size={14} />
            <span>移动</span>
            <em className="city-channel-shortcut-hint">M</em>
          </button>
          <button type="button" className="city-channel-selection-action" onClick={() => handleRotateSelection('forward')} title="旋转 (滚轮↑)">
            <RotateCw size={14} />
            <span>旋转</span>
            <em className="city-channel-shortcut-hint">滚轮</em>
          </button>
          <button type="button" className="city-channel-selection-action" onClick={handleFlipSelection} title="颠倒 (Space)">
            <Replace size={14} />
            <span>颠倒</span>
            <em className="city-channel-shortcut-hint">Space</em>
          </button>
          {canInspectSelectedTile && (
            <button
              type="button"
              className={`city-channel-selection-action ${inspectMode?.active ? 'is-active' : ''}`}
              onClick={handleInspectSelected}
              title={inspectMode?.active ? '放回' : '观察'}
            >
              <Eye size={14} />
              <span>{inspectMode?.active ? '放回' : '观察'}</span>
            </button>
          )}
          <button type="button" className="city-channel-selection-action is-danger" onClick={handleDeleteSelection} title="删除 (Del)">
            <Trash2 size={14} />
            <span>删除</span>
            <em className="city-channel-shortcut-hint">Del</em>
          </button>
        </div>
      )}

      <CityChannelPressurePlateInspect3D
        inspectMode={inspectMode}
        mechanismParams={mechanismParams[inspectMode?.key]}
        previewState={mechanismPreviewState}
      />

      <div className="city-channel-hotbar" aria-label="物品栏">
        {TOOL_ITEMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`city-channel-hotbar__item ${activeTool === key ? 'is-active' : ''}`}
            onClick={() => {
              clearSelection();
              handleRequestTool(key);
            }}
            title={label}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
        <span className="city-channel-hotbar__divider" aria-hidden="true" />
        <button
          type="button"
          className={`city-channel-hotbar__item ${panelPose === 'wall' ? 'is-active' : ''}`}
          onClick={() => {
            setPanelPose((current) => (current === 'wall' ? 'floor' : 'wall'));
            addToast(panelPose === 'wall' ? '板材平放：作为地板放置' : '板材竖放：作为墙板放置', 'info');
          }}
          title={panelPose === 'wall' ? '当前：竖放为墙板' : '当前：平放为地板'}
        >
          <PanelTop size={18} />
          <span>{panelPose === 'wall' ? '竖放' : '平放'}</span>
        </button>
        <button
          type="button"
          className={[
            'city-channel-hotbar__item',
            wallViewMode === 'perspective' ? 'is-active' : '',
            `is-wall-view-${wallViewMode}`
          ].filter(Boolean).join(' ')}
          onClick={() => {
            setWallViewMode((current) => {
              const currentIndex = WALL_VIEW_MODES.indexOf(current);
              const next = WALL_VIEW_MODES[(Math.max(0, currentIndex) + 1) % WALL_VIEW_MODES.length];
              addToast(WALL_VIEW_MODE_CONFIG[next].toast, 'info');
              return next;
            });
          }}
          title={`墙板显示：${wallViewModeConfig.label}`}
        >
          {wallViewMode === 'perspective' ? <EyeOff size={18} /> : <Eye size={18} />}
          <span>{wallViewModeConfig.label}</span>
        </button>
        <button type="button" className="city-channel-hotbar__item" onClick={runValidation} title="验证白通路">
          <Wand2 size={18} />
          <span>验证</span>
        </button>
        <button
          type="button"
          className={`city-channel-hotbar__item ${openPanel === 'settings' ? 'is-active' : ''}`}
          onClick={() => setOpenPanel((current) => (current === 'settings' ? null : 'settings'))}
          title="设置"
        >
          <Settings size={18} />
          <span>设置</span>
        </button>
      </div>

      <section className="city-channel-interaction-hints" aria-live="polite">
        <strong>{activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE ? '放置模式' : toolLabelByKey[activeTool] || activeTool}</strong>
        {activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE ? (
          <>
            <span>左键放置，右键或 Esc 取消</span>
            <span>R 顺转，Shift+R 逆转，V/Tab 切换平放/竖放</span>
          </>
        ) : (
          <>
            <span>拖拽平移，双击后拖拽或 Q/E 旋转视角</span>
            <span>滚轮缩放；选中后 M 移动、Del 删除</span>
          </>
        )}
        {selectedCount > 0 ? <em>{selectedCount} 个选中</em> : null}
      </section>

      <div className="city-channel-floating-tools" aria-label="悬浮工具">
        {FLOATING_PANELS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`city-channel-float-btn ${openPanel === key ? 'is-active' : ''}`}
            onClick={() => setOpenPanel((current) => (current === key ? null : key))}
            title={label}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>

      {openPanel && (
        <aside className="city-channel-popover">
          <strong>{openPanel === 'settings' ? '设置' : FLOATING_PANELS.find((panel) => panel.key === openPanel)?.label}</strong>
          {openPanel === 'layers' && (
            <div className="city-channel-layer-list">
              {CITY_CHANNEL_LAYER_LABELS.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  className={activeLayer === index ? 'is-active' : ''}
                  onClick={() => switchLayer(index)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {openPanel === 'settings' && (
            <div className="city-channel-settings-list">
              <label>
                <input type="checkbox" checked={showHelperGrid} onChange={(event) => setShowHelperGrid(event.target.checked)} />
                显示辅助网格
              </label>
              <label>
                <input type="checkbox" checked={showCoordinates} onChange={(event) => setShowCoordinates(event.target.checked)} />
                显示坐标
              </label>
            </div>
          )}
        </aside>
      )}

      {(mechanismPanel || selectedTile || selectedWall) && (
        <aside
          className={`city-channel-mechanism-params ${inspectMode?.active ? 'is-inspect-docked' : ''}`}
          style={mechanismPanelStyle}
          onPointerDown={stopEditorPanelPointerEvent}
          onPointerMove={stopEditorPanelPointerEvent}
          onClick={stopEditorPanelPointerEvent}
        >
          <div className="city-channel-mechanism-params__head">
            <strong>{mechanismPanelMaterial?.shortName || mechanismPanelMaterial?.name || '机关参数'}</strong>
            <div className="city-channel-mechanism-params__actions">
              <button type="button" onClick={executeMechanismPanelAction}>运行</button>
              {inspectMode?.active && (
                <button
                  type="button"
                  className="city-channel-mechanism-params__close"
                  onClick={handleInspectSelected}
                  aria-label="关闭观察"
                  title="关闭观察"
                >
                  X
                </button>
              )}
            </div>
          </div>
          <div className="city-channel-mechanism-summary">
            <span>{`所属整体：${selectedAssembly?.id || '未连接'}`}</span>
            <span>{`端点：${activePanelTile?.transmissionSkeleton?.ports?.length || 0}`}</span>
            <span>{`齿轮：${activePanelTile?.gearMounts?.length || 0}`}</span>
          </div>
          {activePanelTile?.transmissionSkeleton ? (
            <div className="city-channel-mechanism-summary is-detail">
              <span>{`传动骨骼：${activePanelTile.transmissionSkeleton.type}`}</span>
              <span>{(activePanelTile.transmissionSkeleton.ports || []).map((port) => port.direction).join(' / ')}</span>
            </div>
          ) : null}
          {activePanelTile?.gearMounts?.length > 0 ? (
            <div className="city-channel-mechanism-summary is-detail">
              {activePanelTile.gearMounts.map((mount) => (
                <span key={mount.id}>{`${mount.position}｜${mount.axisType === 'fixedAxis' ? '固定轴' : '活动轴'}｜${mount.followMode === 'sameDirection' ? '同向跟随' : mount.followMode === 'oppositeDirection' ? '反向跟随' : '不跟随'}`}</span>
              ))}
            </div>
          ) : null}
          <label className="city-channel-mechanism-param">
            <span>转动角度</span>
            <div className="city-channel-mechanism-param__row">
              <input
                type="range"
                min={CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle.min}
                max={CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle.max}
                step={CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle.step}
                value={mechanismPanelParams.rotationAngle}
                onChange={(event) => updateMechanismParam('rotationAngle', event.target.value)}
              />
              <input
                type="number"
                min={CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle.min}
                max={CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle.max}
                step={CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle.step}
                value={mechanismPanelParams.rotationAngle}
                onChange={(event) => updateMechanismParam('rotationAngle', event.target.value)}
                aria-label="转动角度"
              />
              <em>度</em>
            </div>
          </label>
          <label className="city-channel-mechanism-param">
            <span>转动速度</span>
            <div className="city-channel-mechanism-param__row">
              <input
                type="range"
                min={CITY_CHANNEL_MECHANISM_LIMITS.rotationSpeedDegPerSec.min}
                max={CITY_CHANNEL_MECHANISM_LIMITS.rotationSpeedDegPerSec.max}
                step={CITY_CHANNEL_MECHANISM_LIMITS.rotationSpeedDegPerSec.step}
                value={mechanismPanelParams.rotationSpeedDegPerSec}
                onChange={(event) => updateMechanismParam('rotationSpeedDegPerSec', event.target.value)}
              />
              <input
                type="number"
                min={CITY_CHANNEL_MECHANISM_LIMITS.rotationSpeedDegPerSec.min}
                max={CITY_CHANNEL_MECHANISM_LIMITS.rotationSpeedDegPerSec.max}
                step={CITY_CHANNEL_MECHANISM_LIMITS.rotationSpeedDegPerSec.step}
                value={mechanismPanelParams.rotationSpeedDegPerSec}
                onChange={(event) => updateMechanismParam('rotationSpeedDegPerSec', event.target.value)}
                aria-label="转动速度"
              />
              <em>度/秒</em>
            </div>
          </label>
          <label className="city-channel-mechanism-param">
            <span>转动方向</span>
            <select
              value={mechanismPanelParams.rotationDirection}
              onChange={(event) => updateMechanismParam('rotationDirection', event.target.value)}
            >
              <option value="right">右</option>
              <option value="left">左</option>
            </select>
          </label>
          <label className="city-channel-mechanism-param">
            <span>延迟触发</span>
            <div className="city-channel-mechanism-param__row">
              <input
                type="number"
                min={CITY_CHANNEL_MECHANISM_LIMITS.triggerDelaySeconds.min}
                max={CITY_CHANNEL_MECHANISM_LIMITS.triggerDelaySeconds.max}
                step={CITY_CHANNEL_MECHANISM_LIMITS.triggerDelaySeconds.step}
                value={mechanismPanelParams.triggerDelaySeconds}
                onChange={(event) => updateMechanismParam('triggerDelaySeconds', event.target.value)}
                aria-label="延迟触发秒数"
              />
              <em>秒</em>
            </div>
          </label>
          <label className="city-channel-mechanism-param is-inline">
            <input
              type="checkbox"
              checked={mechanismPanelParams.autoReturn}
              onChange={(event) => updateMechanismParam('autoReturn', event.target.checked)}
            />
            <span>自动转回</span>
          </label>
          {mechanismPanelParams.autoReturn ? (
            <label className="city-channel-mechanism-param">
              <span>自动转回延迟</span>
              <div className="city-channel-mechanism-param__row">
                <input
                  type="number"
                  min={CITY_CHANNEL_MECHANISM_LIMITS.autoReturnDelaySeconds.min}
                  max={CITY_CHANNEL_MECHANISM_LIMITS.autoReturnDelaySeconds.max}
                  step={CITY_CHANNEL_MECHANISM_LIMITS.autoReturnDelaySeconds.step}
                  value={mechanismPanelParams.autoReturnDelaySeconds}
                  onChange={(event) => updateMechanismParam('autoReturnDelaySeconds', event.target.value)}
                  aria-label="自动转回延迟秒数"
                />
                <em>秒</em>
              </div>
            </label>
          ) : null}
        </aside>
      )}

      <footer className={`city-channel-immersive-status ${validationResult.ok ? 'is-ok' : ''}`}>
        <span>{toolLabelByKey[activeTool] || activeTool}</span>
        <span>{activeLayerLabel}</span>
        <span title={statusMessage}>{hoverStatusLabel}</span>
        <span>{`${Math.round((cameraSummary.zoom || 1) * 100)}%`}</span>
        <span>{`${Math.round(cameraSummary.yaw || 0)}°`}</span>
        <span>{`${objectCounts.tiles + objectCounts.walls}物件`}</span>
        <span>{validationResult.ok ? '白通路✓' : '未验证'}</span>
      </footer>

    </div>
  );
};

export default CityChannelPhaserEditor;
