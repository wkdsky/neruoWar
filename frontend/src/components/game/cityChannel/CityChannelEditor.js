import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_LAYER_LABELS,
  CITY_CHANNEL_STORAGE_KEY,
  CITY_CHANNEL_TOOLS,
  createCellKey,
  createWallKey,
  normalizeRotation,
  normalizeTemplateMeta,
  serializeCityChannelMap
} from './cityChannelSchema';
import {
  buildMechanicalAssemblies,
  DEFAULT_CITY_CHANNEL_GEAR_ROTATION_DIRECTION,
  getAssemblyForCell,
  getGearAxisBindingStatus,
  getMechanismParamKey,
  isCornerGearSocket,
  normalizeGearRotationDirection,
  normalizeMechanismParams
} from './cityChannelMechanismRuntime';
import { canConfigureGearRotationDirection } from './cityChannelGearRotationConfig';
import useCityChannelEditorState from './useCityChannelEditorState';
import CityChannelMaterialPalette from './CityChannelMaterialPalette';
import CityChannelMechanismPanel, { CityChannelGearAxisPrompt } from './CityChannelMechanismPanel';
import {
  CityChannelEditorTopbar,
  CityChannelHotbar,
  CityChannelInteractionHints,
  CityChannelSelectionActions,
  CityChannelSettingsPopover,
  CityChannelStatusBar,
  CityChannelToastStack
} from './CityChannelEditorChrome';
import {
  getCityChannelLayerLabel,
  getCityChannelMapPlaneLevels
} from './CityChannelThumbnail';
import CityChannelThumbnail from './CityChannelThumbnail';
import CityChannelThreeRuntime from './three/CityChannelThreeRuntime';
import {
  expandVisibleLayerCutoffForTargetLayer,
  getMaxTargetLayerFromMoves,
  getMaxTargetLayerFromPlacementOperations,
  getRuntimeVisibleLayerCutoff
} from './cityChannelEditorVisibility';
import { isPortalMaterial } from './cityChannelPlacementGeometry';
import './CityChannelImmersiveEditor.css';
import './CityChannelEditor.css';

const CityChannelPressurePlateInspect3D = lazy(() => import('./CityChannelPressurePlateInspect3D'));

const stopEditorPanelPointerEvent = (event) => {
  event.stopPropagation();
};

const CityChannelEditor = ({
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
    activeComponentType,
    activeRotation,
    validationResult,
    statusMessage,
    isDirty,
    canUndo,
    canRedo,
    setActiveRotation,
    applyPlacementOperations,
    deletePlacements,
    movePlacements,
    rotatePlacements,
    rotatePlacementsReverse,
    updatePlacement,
    markSavedMap,
    validateSafeRoute,
    switchLayer,
    selectMaterial,
    selectComponent,
    selectOperationTool,
    undo,
    redo
  } = editor;

  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const placeReturnToolRef = useRef(CITY_CHANNEL_TOOLS.BROWSE);
  const [rendererStatus, setRendererStatus] = useState('loading');
  const [wallViewMode, setWallViewMode] = useState('semi');
  const [panelPose, setPanelPose] = useState('floor');
  const [showHelperGrid, setShowHelperGrid] = useState(false);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [selectedCells, setSelectedCells] = useState([]);
  const [selectedWalls, setSelectedWalls] = useState([]);
  const [selectedGears, setSelectedGears] = useState([]);
  const [selectedRacks, setSelectedRacks] = useState([]);
  const [selectionScope, setSelectionScope] = useState(null);
  const [gearAxisPrompt, setGearAxisPrompt] = useState(null);
  const [openPanel, setOpenPanel] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [hoverStatusLabel, setHoverStatusLabel] = useState('浏览模式');
  const [cameraSummary, setCameraSummary] = useState({ zoom: 1, yaw: 0 });
  const [mechanismParams, setMechanismParams] = useState(() => mapData.mechanismParams || {});
  const [mechanismPanel, setMechanismPanel] = useState(null);
  const [inspectMode, setInspectMode] = useState(null);
  const [mechanismPreviewState, setMechanismPreviewState] = useState(null);
  const [mechanismRuntimeSnapshot, setMechanismRuntimeSnapshot] = useState(null);
  const [carryActive, setCarryActive] = useState(false);
  const [visibleLayerCutoff, setVisibleLayerCutoff] = useState(null);
  const [lastGearRotationDirection, setLastGearRotationDirection] = useState(DEFAULT_CITY_CHANNEL_GEAR_ROTATION_DIRECTION);

  const planeLevels = useMemo(() => getCityChannelMapPlaneLevels(mapData), [mapData]);
  const highestPlaneLevel = planeLevels[planeLevels.length - 1] ?? 0;
  const effectiveVisibleLayerCutoff = visibleLayerCutoff === null
    ? highestPlaneLevel
    : Math.max(0, Math.min(visibleLayerCutoff, highestPlaneLevel));
  const activeLayerLabel = visibleLayerCutoff === null
    ? (CITY_CHANNEL_LAYER_LABELS[activeLayer] || `第 ${activeLayer + 1} 层`)
    : `显示至${getCityChannelLayerLabel(effectiveVisibleLayerCutoff)}`;
  const selectedPlacements = useMemo(() => (
    [...selectedCells, ...selectedWalls]
  ), [selectedCells, selectedWalls]);
  const selectedCount = selectedPlacements.length + selectedGears.length + selectedRacks.length;
  const selectedTileKey = selectedCells.length === 1 && selectedWalls.length === 0
    ? createCellKey(selectedCells[0].x, selectedCells[0].y, selectedCells[0].z)
    : '';
  const selectedWallKey = selectedWalls.length === 1 && selectedCells.length === 0
    ? createWallKey(selectedWalls[0].x, selectedWalls[0].y, selectedWalls[0].z, selectedWalls[0].edge)
    : '';
  const selectedTile = selectedTileKey ? mapData.tiles?.[selectedTileKey] : null;
  const selectedWall = selectedWallKey ? mapData.walls?.[selectedWallKey] : null;
  const canInspectSelectedTile = !!selectedTile;
  const assemblyGraph = useMemo(() => (
    buildMechanicalAssemblies(mapData)
  ), [mapData]);
  const selectedAssembly = useMemo(() => (
    selectedTileKey || selectedWallKey ? getAssemblyForCell(assemblyGraph, selectedTileKey || selectedWallKey) : null
  ), [assemblyGraph, selectedTileKey, selectedWallKey]);
  const objectCounts = useMemo(() => ({
    tiles: Object.keys(mapData.tiles || {}).length,
    walls: Object.keys(mapData.walls || {}).length,
    racks: Object.keys(mapData.racks || {}).length
  }), [mapData.racks, mapData.tiles, mapData.walls]);
  const activePanelKey = mechanismPanel?.key || selectedTileKey || selectedWallKey;
  const activePanelTile = mechanismPanel?.key
    ? (mapData.tiles?.[mechanismPanel.key] || mapData.walls?.[mechanismPanel.key])
    : (selectedTile || selectedWall);
  const selectedGear = selectedGears.length === 1 ? selectedGears[0] : null;
  const selectedGearHost = selectedGear
    ? (selectedGear.hostKind === 'wall' ? mapData.walls?.[selectedGear.hostKey] : mapData.tiles?.[selectedGear.hostKey])
    : null;
  const selectedGearMount = selectedGearHost?.gearMounts?.find((mount) => mount.id === selectedGear?.mountId) || null;
  const selectedGearCanConfigureRotation = !!(
    selectedGear
    && selectedGearMount
    && canConfigureGearRotationDirection({
      mapData,
      assemblyGraph,
      componentKey: selectedGear.hostKey,
      placement: selectedGearHost,
      mount: selectedGearMount
    })
  );
  const selectedGearItems = useMemo(() => (
    selectedGears.map((gear) => {
      const host = gear.hostKind === 'wall' ? mapData.walls?.[gear.hostKey] : mapData.tiles?.[gear.hostKey];
      const mount = host?.gearMounts?.find((item) => item.id === gear.mountId) || null;
      return host && mount ? { gear, host, mount } : null;
    }).filter(Boolean)
  ), [mapData.tiles, mapData.walls, selectedGears]);
  const activePanelPlacement = useMemo(() => (
    activePanelTile
      ? {
        x: activePanelTile.x,
        y: activePanelTile.y,
        z: activePanelTile.z,
        edge: activePanelTile.edge || null
      }
      : selectedGearHost
        ? {
          x: selectedGearHost.x,
          y: selectedGearHost.y,
          z: selectedGearHost.z,
          edge: selectedGearHost.edge || null
        }
      : null
  ), [activePanelTile, selectedGearHost]);
  const activePanelPanelType = mechanismPanel?.panelType || activePanelTile?.panelType || '';
  const canRunActivePanel = activePanelPanelType === CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE;
  const gearMountsForPanel = useMemo(() => (
    selectedGearMount
      ? [selectedGearMount]
      : Array.isArray(activePanelTile?.gearMounts) ? activePanelTile.gearMounts : []
  ), [activePanelTile?.gearMounts, selectedGearMount]);
  const gearMountBindingStatusById = useMemo(() => {
    const placement = selectedGearMount ? selectedGearHost : activePanelTile;
    return (gearMountsForPanel || []).reduce((statuses, mount) => {
      if (mount?.id) {
        statuses[mount.id] = getGearAxisBindingStatus({ mapData, placement, mount });
      }
      return statuses;
    }, {});
  }, [activePanelTile, gearMountsForPanel, mapData, selectedGearHost, selectedGearMount]);
  const mechanismPanelParams = useMemo(() => (
    normalizeMechanismParams(mechanismParams[activePanelKey])
  ), [activePanelKey, mechanismParams]);

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, message, type, timestamp: Date.now() }]);
  }, []);

  const resetMechanismPreview = useCallback(() => {
    sceneRef.current?.cancelMechanismRuntimePreview?.();
    setMechanismRuntimeSnapshot(null);
    setMechanismPreviewState(null);
  }, []);

  const handleEditorPointerDownCapture = useCallback((event) => {
    const target = event.target;
    if (!target?.closest?.('button')) return;
    resetMechanismPreview();
  }, [resetMechanismPreview]);

  const clearSelection = useCallback(() => {
    setSelectedCells([]);
    setSelectedWalls([]);
    setSelectedGears([]);
    setSelectedRacks([]);
    setSelectionScope(null);
    setGearAxisPrompt(null);
    sceneRef.current?.setSelection?.([], [], [], [], null);
  }, []);

  const handleSelectionChange = useCallback(({ cells = [], walls = [], gears = [], racks = [], scope = null } = {}) => {
    setSelectedCells(cells);
    setSelectedWalls(walls);
    setSelectedGears(gears);
    setSelectedRacks(racks);
    setSelectionScope(scope);
    setGearAxisPrompt(null);
  }, []);

  const handleMaterialSelect = useCallback((panelType) => {
    resetMechanismPreview();
    if (activeTool !== CITY_CHANNEL_TOOLS.PLACE_TILE) {
      placeReturnToolRef.current = activeTool === CITY_CHANNEL_TOOLS.SELECT
        ? CITY_CHANNEL_TOOLS.SELECT
        : CITY_CHANNEL_TOOLS.BROWSE;
    }
    clearSelection();
    if (isPortalMaterial(panelType)) setPanelPose('floor');
    selectMaterial(panelType);
  }, [activeTool, clearSelection, resetMechanismPreview, selectMaterial]);

  const handleComponentSelect = useCallback((componentType) => {
    resetMechanismPreview();
    if (activeTool !== CITY_CHANNEL_TOOLS.PLACE_COMPONENT) {
      placeReturnToolRef.current = activeTool === CITY_CHANNEL_TOOLS.SELECT
        ? CITY_CHANNEL_TOOLS.SELECT
        : CITY_CHANNEL_TOOLS.BROWSE;
    }
    clearSelection();
    selectComponent(componentType);
  }, [activeTool, clearSelection, resetMechanismPreview, selectComponent]);

  const handleRequestTool = useCallback((tool) => {
    resetMechanismPreview();
    if (tool === CITY_CHANNEL_TOOLS.BROWSE || tool === CITY_CHANNEL_TOOLS.SELECT) {
      placeReturnToolRef.current = tool;
    }
    selectOperationTool(tool);
  }, [resetMechanismPreview, selectOperationTool]);

  const handleExitPlaceMode = useCallback(() => {
    resetMechanismPreview();
    const returnTool = placeReturnToolRef.current === CITY_CHANNEL_TOOLS.SELECT
      ? CITY_CHANNEL_TOOLS.SELECT
      : CITY_CHANNEL_TOOLS.BROWSE;
    clearSelection();
    selectOperationTool(returnTool);
    addToast('已退出放置模式。', 'info');
  }, [addToast, clearSelection, resetMechanismPreview, selectOperationTool]);

  const handleCommitOperations = useCallback((operations) => {
    const maxTargetLayer = getMaxTargetLayerFromPlacementOperations(operations);
    if (maxTargetLayer !== null) {
      setVisibleLayerCutoff((current) => expandVisibleLayerCutoffForTargetLayer(current, maxTargetLayer));
    }
    applyPlacementOperations(operations);
  }, [applyPlacementOperations]);

  const handleMovePlacements = useCallback((moves) => {
    if (!Array.isArray(moves) || moves.length <= 0) return;
    const maxTargetLayer = getMaxTargetLayerFromMoves(moves);
    if (maxTargetLayer !== null) {
      setVisibleLayerCutoff((current) => expandVisibleLayerCutoffForTargetLayer(current, maxTargetLayer));
    }
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
    } else {
      setSelectedCells([payload.cell]);
      setSelectedWalls([]);
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
  }, []);

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

  const updateGearMountConfig = useCallback((mountId, patch = {}) => {
    if (!activePanelPlacement || !mountId) return;
    updatePlacement(activePanelPlacement, (placement) => {
      const mounts = Array.isArray(placement.gearMounts) ? placement.gearMounts : [];
      const nextMounts = mounts.map((mount) => {
        if (mount.id !== mountId) return mount;
        const nextMount = { ...mount, ...patch };
        nextMount.socketKind = isCornerGearSocket(nextMount.position) ? 'corner' : 'center';
        if (nextMount.axisBinding === undefined) nextMount.axisBinding = mount.axisBinding || null;
        nextMount.followMode = 'none';
        nextMount.followDelaySeconds = 0;
        return nextMount;
      });
      return { gearMounts: nextMounts };
    }, '齿轮承动配置已更新。');
  }, [activePanelPlacement, updatePlacement]);

  const updateGearMountRotationDirection = useCallback((mountId, direction) => {
    const rotationDirection = normalizeGearRotationDirection(direction);
    setLastGearRotationDirection(rotationDirection);
    updateGearMountConfig(mountId, { rotationDirection });
  }, [updateGearMountConfig]);

  const clearSelectedGearBindings = useCallback(() => {
    if (selectedGearItems.length <= 0) return;
    const groups = new Map();
    selectedGearItems.forEach(({ gear, host }) => {
      if (!groups.has(gear.hostKey)) {
        groups.set(gear.hostKey, {
          placement: {
            x: host.x,
            y: host.y,
            z: host.z,
            edge: host.edge || null
          },
          mountIds: new Set()
        });
      }
      groups.get(gear.hostKey).mountIds.add(gear.mountId);
    });
    groups.forEach(({ placement, mountIds }) => {
      updatePlacement(placement, (currentPlacement) => ({
        gearMounts: (currentPlacement.gearMounts || []).map((mount) => (
          mountIds.has(mount.id)
            ? {
              ...mount,
              axisBinding: null,
              socketKind: isCornerGearSocket(mount.position) ? 'corner' : 'center',
              followMode: 'none',
              followDelaySeconds: 0
            }
            : mount
        ))
      }), '已取消选中齿轮的连轴绑定。');
    });
  }, [selectedGearItems, updatePlacement]);

  const updatePromptGearAxis = useCallback(() => {
    setGearAxisPrompt(null);
  }, []);

  const dismissGearAxisPrompt = useCallback(() => {
    setGearAxisPrompt(null);
  }, []);

  const executeMechanismPanelAction = useCallback(() => {
    resetMechanismPreview();
    if (!canRunActivePanel) {
      addToast('只有齿轮压力板可以运行预览。', 'error');
      return;
    }
    const cell = mechanismPanel?.cell || selectedCells[0];
    if (!cell) return;
    const executed = sceneRef.current?.triggerMechanismAtCell?.(cell, mechanismPanelParams);
    if (!executed) {
      addToast('当前机关无法运行。', 'error');
      return;
    }
    addToast('运行预览已启动。', 'info');
  }, [addToast, canRunActivePanel, mechanismPanel?.cell, mechanismPanelParams, resetMechanismPreview, selectedCells]);

  const handleMechanismPreviewProgress = useCallback((payload = null) => {
    setMechanismPreviewState(payload);
  }, []);

  const handleInspectChange = useCallback((payload = null) => {
    setInspectMode(payload?.active ? payload : null);
  }, []);

  const handleInspectSelected = useCallback(() => {
    resetMechanismPreview();
    if (inspectMode?.active) {
      sceneRef.current?.closeInspectMode?.();
      return;
    }
    const opened = sceneRef.current?.inspectSelectedTile?.();
    if (!opened) addToast('请选择一个可观察的地块。', 'error');
  }, [addToast, inspectMode?.active, resetMechanismPreview]);

  const handleDeleteSelection = useCallback(() => {
    resetMechanismPreview();
    if (selectionScope === 'component') {
      if (selectedGearItems.length <= 0 && selectedRacks.length <= 0) return;
      const groups = new Map();
      selectedGearItems.forEach(({ gear, host }) => {
        if (!groups.has(gear.hostKey)) {
          groups.set(gear.hostKey, {
            placement: {
              x: host.x,
              y: host.y,
              z: host.z,
              edge: host.edge || null
            },
            mountIds: new Set()
          });
        }
        groups.get(gear.hostKey).mountIds.add(gear.mountId);
      });
      groups.forEach(({ placement, mountIds }) => {
        updatePlacement(placement, (currentPlacement) => ({
          gearMounts: (currentPlacement.gearMounts || []).filter((mount) => !mountIds.has(mount.id))
        }), '已删除选中齿轮。');
      });
      const rackOperations = selectedRacks.map((rack) => {
        const existing = mapData.racks?.[rack.id];
        return existing ? {
          kind: 'rack',
          action: 'erase',
          rack: existing
        } : null;
      }).filter(Boolean);
      if (rackOperations.length > 0) {
        handleCommitOperations(rackOperations);
      }
      clearSelection();
      return;
    }
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
  }, [clearSelection, deletePlacements, handleCommitOperations, mapData.racks, resetMechanismPreview, selectedCells, selectedGearItems, selectedPlacements, selectedRacks, selectionScope, updatePlacement]);

  const handleCopySelection = useCallback(() => {
    resetMechanismPreview();
    if (selectionScope === 'component' || selectedPlacements.length <= 0) {
      addToast('请先选择一个或多个板材再复制。', 'error');
      return false;
    }
    const started = sceneRef.current?.startCopyCarry?.();
    if (!started) {
      addToast('当前状态无法启动复制预览。', 'error');
      return false;
    }
    return true;
  }, [addToast, resetMechanismPreview, selectedPlacements.length, selectionScope]);

  const handleRotateSelection = useCallback((direction = 'forward', meta = null) => {
    resetMechanismPreview();
    const targetPlacements = selectedPlacements.length > 0 ? selectedPlacements : (meta?.placements || []);
    if (targetPlacements.length <= 0) return;
    if (!meta?.alreadyPreviewed) {
      sceneRef.current?.rotateTransmissionForPlacements?.(targetPlacements, direction, { expectReactEcho: true });
    }
    if (direction === 'reverse') rotatePlacementsReverse(targetPlacements);
    else rotatePlacements(targetPlacements);
  }, [resetMechanismPreview, rotatePlacements, rotatePlacementsReverse, selectedPlacements]);

  const handleRotateActive = useCallback((delta = 90) => {
    setActiveRotation((current) => normalizeRotation(current + delta));
  }, [setActiveRotation]);

  const runValidation = useCallback(() => {
    resetMechanismPreview();
    const result = validateSafeRoute();
    if (result.ok) addToast('验证通过：入口可到达出口', 'success');
    else addToast(`验证失败：${result.message}`, 'error');
    return result;
  }, [addToast, resetMechanismPreview, validateSafeRoute]);

  const handleSave = useCallback(() => {
    resetMechanismPreview();
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
  }, [addToast, mapData, markSavedMap, mechanismParams, resetMechanismPreview, templateId, templateName, templateSource, validateSafeRoute]);

  const handleExit = useCallback(() => {
    resetMechanismPreview();
    if (isDirty && !window.confirm('当前模板有未保存修改，确定退出到城内工坊首页？')) return;
    onExit?.();
  }, [isDirty, onExit, resetMechanismPreview]);

  const sceneConfig = useMemo(() => ({
    mapData,
    activeTool,
    activeTileType,
    activeComponentType,
    activeRotation,
    activeLayer,
    panelPose,
    wallViewMode,
    showHelperGrid,
    showCoordinates,
    visibleLayerCutoff: getRuntimeVisibleLayerCutoff({
      visibleLayerCutoff,
      activeTool,
      carryActive
    }),
    selection: {
      cells: selectedCells,
      walls: selectedWalls,
      gears: selectedGears,
      racks: selectedRacks,
      scope: selectionScope
    },
    onSceneReady: (scene) => {
      sceneRef.current = scene;
      setRendererStatus('ready');
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
      if (isPortalMaterial(activeTileType)) {
        setPanelPose('floor');
        addToast('入口/出口仅支持平放', 'info');
        return;
      }
      setPanelPose((current) => (current === 'wall' ? 'floor' : 'wall'));
    },
    onSetPanelPose: (pose) => {
      if (isPortalMaterial(activeTileType)) {
        setPanelPose('floor');
        return;
      }
      setPanelPose(pose === 'wall' ? 'wall' : 'floor');
    },
    onUndo: undo,
    onRedo: redo,
    onDeleteSelection: handleDeleteSelection,
    onCopySelection: handleCopySelection,
    onMovePlacements: handleMovePlacements,
    onMechanismPanelRequest: handleMechanismPanelRequest,
    onGearAxisPrompt: setGearAxisPrompt,
    onUpdateGearMountConfig: updateGearMountConfig,
    onInspectChange: handleInspectChange,
    onMechanismPreviewProgress: handleMechanismPreviewProgress,
    onMechanismRuntimeSnapshot: setMechanismRuntimeSnapshot,
    externalInspectOverlay: true,
    mechanismParams,
    defaultGearRotationDirection: lastGearRotationDirection,
    onToast: addToast,
    onCarryStateChange: setCarryActive
  }), [
    activeRotation,
    activeLayer,
    activeTileType,
    activeComponentType,
    activeTool,
    addToast,
    carryActive,
    handleCommitOperations,
    handleDeleteSelection,
    handleCopySelection,
    handleMovePlacements,
    handleMechanismPanelRequest,
    handleInspectChange,
    handleMechanismPreviewProgress,
    handleRotateActive,
    setMechanismRuntimeSnapshot,
    setPanelPose,
    handleRotateSelection,
    handleSelectionChange,
    updateGearMountConfig,
    mapData,
    mechanismParams,
    panelPose,
    redo,
    handleExitPlaceMode,
    handleRequestTool,
    lastGearRotationDirection,
    selectedCells,
    selectedGears,
    selectedRacks,
    selectedWalls,
    selectionScope,
    showCoordinates,
    showHelperGrid,
    undo,
    visibleLayerCutoff,
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
    if (!containerRef.current) return undefined;
    let runtime = null;
    try {
      setRendererStatus('loading');
      runtime = new CityChannelThreeRuntime({
        mount: containerRef.current,
        ...latestSceneConfigRef.current,
        onStatusChange: setHoverStatusLabel
      });
    } catch (error) {
      setRendererStatus('error');
      addToast(`正交 3D 编辑器加载失败：${error.message}`, 'error');
    }

    return () => {
      if (sceneRef.current === runtime) sceneRef.current = null;
      runtime?.dispose?.();
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
        'city-channel-orthographic-editor',
        'has-palette',
        wallViewMode === 'perspective' ? 'is-wall-transparent' : '',
        wallViewMode === 'solid' ? 'is-wall-solid' : '',
        showHelperGrid ? 'is-helper-grid-visible' : ''
      ].filter(Boolean).join(' ')}
      onPointerDownCapture={handleEditorPointerDownCapture}
    >
      <div className="city-channel-immersive__void" aria-hidden="true" />

      <CityChannelMaterialPalette
        activeTileType={activeTileType}
        activeComponentType={activeComponentType}
        onMaterialSelect={handleMaterialSelect}
        onComponentSelect={handleComponentSelect}
      />

      <CityChannelToastStack toasts={toasts} />

      <CityChannelEditorTopbar
        canUndo={canUndo}
        canRedo={canRedo}
        onExit={handleExit}
        onSave={handleSave}
        onUndo={undo}
        onRedo={redo}
      />

      <div className="city-channel-viewport city-channel-three-viewport">
        <div ref={containerRef} className="city-channel-three-stage" />
        {rendererStatus !== 'ready' ? (
          <div className={`city-channel-three-loader is-${rendererStatus}`}>
            {rendererStatus === 'error' ? '正交 3D 编辑器加载失败' : '正在加载正交 3D 编辑器'}
          </div>
        ) : null}
        <CityChannelGearAxisPrompt
          prompt={gearAxisPrompt}
          onDismiss={dismissGearAxisPrompt}
          onUpdateAxis={updatePromptGearAxis}
        />
      </div>

      <CityChannelThumbnail
        mapData={mapData}
        assemblyGraph={assemblyGraph}
        runtimeSnapshot={mechanismRuntimeSnapshot}
        cameraYaw={cameraSummary.yaw}
        activeTool={activeTool}
        activeTileType={activeTileType}
        activeComponentType={activeComponentType}
        carryActive={carryActive}
        visibleLayerCutoff={visibleLayerCutoff}
        onVisibleLayerCutoffChange={setVisibleLayerCutoff}
        onSwitchLayer={switchLayer}
      />

      <CityChannelSelectionActions
        selectedCount={selectedCount}
        selectionScope={selectionScope}
        selectedPlacementCount={selectedPlacements.length}
        carryActive={carryActive}
        canInspectSelectedTile={canInspectSelectedTile}
        isInspectActive={!!inspectMode?.active}
        onPointerDown={stopEditorPanelPointerEvent}
        onStartCarry={() => sceneRef.current?.startCarry?.()}
        onCopySelection={handleCopySelection}
        onRotateSelection={handleRotateSelection}
        onRotateCarrySurface={() => sceneRef.current?.rotateCarryPlacementSurface?.()}
        onCycleCarrySnapAxisRotation={() => sceneRef.current?.cycleCarrySnapAxisRotation?.()}
        onInspectSelected={handleInspectSelected}
        onDeleteSelection={handleDeleteSelection}
        onSetSelectedGearAxis={clearSelectedGearBindings}
      />

      {inspectMode?.active ? (
        <Suspense fallback={null}>
          <CityChannelPressurePlateInspect3D
            inspectMode={inspectMode}
            mechanismParams={mechanismParams[inspectMode?.key]}
            previewState={mechanismPreviewState}
          />
        </Suspense>
      ) : null}

      <CityChannelHotbar
        activeTool={activeTool}
        panelPose={panelPose}
        fixedHorizontal={isPortalMaterial(activeTileType)}
        wallViewMode={wallViewMode}
        openPanel={openPanel}
        onClearSelection={clearSelection}
        onRequestTool={handleRequestTool}
        onSetPanelPose={setPanelPose}
        onSetWallViewMode={setWallViewMode}
        onRunValidation={runValidation}
        onSetOpenPanel={setOpenPanel}
        onToast={addToast}
      />

      <CityChannelInteractionHints
        activeTool={activeTool}
        selectedCount={selectedCount}
      />

      <CityChannelSettingsPopover
        openPanel={openPanel}
        showHelperGrid={showHelperGrid}
        showCoordinates={showCoordinates}
        onShowHelperGridChange={setShowHelperGrid}
        onShowCoordinatesChange={setShowCoordinates}
      />

      <CityChannelMechanismPanel
        isOpen={!!(mechanismPanel || selectedTile || selectedWall || selectedGearMount)}
        inspectActive={!!inspectMode?.active}
        selectedGear={selectedGear}
        selectedGearMount={selectedGearMount}
        selectedGearCanConfigureRotation={selectedGearCanConfigureRotation}
        selectedAssembly={selectedAssembly}
        activePanelTile={activePanelTile}
        activePanelPanelType={activePanelPanelType}
        canRunActivePanel={canRunActivePanel}
        gearMountsForPanel={gearMountsForPanel}
        gearMountBindingStatusById={gearMountBindingStatusById}
        mechanismPanelParams={mechanismPanelParams}
        onCloseInspect={handleInspectSelected}
        onExecute={executeMechanismPanelAction}
        onUpdateGearMountConfig={updateGearMountConfig}
        onUpdateGearRotationDirection={updateGearMountRotationDirection}
        onUpdateMechanismParam={updateMechanismParam}
      />

      <CityChannelStatusBar
        activeTool={activeTool}
        activeLayerLabel={activeLayerLabel}
        statusMessage={statusMessage}
        hoverStatusLabel={hoverStatusLabel}
        cameraSummary={cameraSummary}
        objectCount={objectCounts.tiles + objectCounts.walls + objectCounts.racks}
        validationOk={validationResult.ok}
      />

    </div>
  );
};

export default CityChannelEditor;
