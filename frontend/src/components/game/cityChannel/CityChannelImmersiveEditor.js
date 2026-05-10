import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DoorOpen,
  Eye,
  EyeOff,
  Flag,
  Layers,
  LogOut,
  MousePointer2,
  Redo2,
  Replace,
  RotateCcw,
  RotateCw,
  Save,
  Settings,
  Square,
  Tag,
  Trash2,
  Undo2,
  Wand2
} from 'lucide-react';
import {
  CITY_CHANNEL_HEIGHT,
  CITY_CHANNEL_LAYER_LABELS,
  CITY_CHANNEL_STORAGE_KEY,
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  CITY_CHANNEL_WIDTH,
  createCellKey,
  isValidCell,
  serializeCityChannelMap
} from './cityChannelSchema';
import useCityChannelEditorState from './useCityChannelEditorState';
import './CityChannelImmersiveEditor.css';

const TILE_WIDTH = 76;
const TILE_HEIGHT = 40;
const TILE_RENDER_WIDTH = 112;
const TILE_RENDER_HEIGHT = 118;
const TILE_RENDER_CENTER = {
  x: 56,
  y: 72
};
const FLOOR_THICKNESS = 14;
const WALL_HEIGHT = 62;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.8;
const MAP_CENTER = {
  x: Math.floor(CITY_CHANNEL_WIDTH / 2),
  y: Math.floor(CITY_CHANNEL_HEIGHT / 2)
};
const CAMERA_PAN_SPEED = 520;
const CAMERA_ROTATION_SPEED = 96;

const normalizeCameraYaw = (yaw = 0) => ((yaw % 360) + 360) % 360;

const TOOL_ITEMS = [
  { key: CITY_CHANNEL_TOOLS.SELECT, label: '选择', Icon: MousePointer2 },
  { key: CITY_CHANNEL_TOOLS.FLOOR, label: '板材', Icon: Square },
  { key: CITY_CHANNEL_TOOLS.ENTRANCE, label: '入口', Icon: DoorOpen },
  { key: CITY_CHANNEL_TOOLS.EXIT, label: '出口', Icon: Flag }
];

const FLOATING_PANELS = [
  { key: 'perspective', label: '透视' },
  { key: 'layers', label: '图层', Icon: Layers },
  { key: 'validate', label: '验证', Icon: Wand2 },
  { key: 'settings', label: '设置', Icon: Settings }
];

const toolLabelByKey = {
  [CITY_CHANNEL_TOOLS.SELECT]: '选择',
  [CITY_CHANNEL_TOOLS.ERASE]: '擦除',
  [CITY_CHANNEL_TOOLS.FLOOR]: '板材',
  [CITY_CHANNEL_TOOLS.WOOD_FLOOR]: '板材',
  [CITY_CHANNEL_TOOLS.WALL]: '墙板',
  [CITY_CHANNEL_TOOLS.ENTRANCE]: '入口',
  [CITY_CHANNEL_TOOLS.EXIT]: '出口'
};

const panelClassByType = {
  [CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR]: 'is-floor',
  [CITY_CHANNEL_TILE_TYPES.STONE_FLOOR]: 'is-floor',
  [CITY_CHANNEL_TILE_TYPES.IRON_FLOOR]: 'is-floor',
  [CITY_CHANNEL_TILE_TYPES.WALL]: 'is-wall',
  [CITY_CHANNEL_TILE_TYPES.STAIR]: 'is-floor'
};

const findPointAtCell = (points = [], cell) => points.find((point) => (
  point.x === cell.x && point.y === cell.y && point.z === cell.z
));

const sameCell = (a, b) => (
  a && b && a.x === b.x && a.y === b.y && a.z === b.z
);

const projectWorldOffset = (x, y, cameraYaw = 0) => {
  const radians = (cameraYaw * Math.PI) / 180;
  const rx = (x * Math.cos(radians)) - (y * Math.sin(radians));
  const ry = (x * Math.sin(radians)) + (y * Math.cos(radians));
  return {
    x: (rx - ry) * (TILE_WIDTH / 2),
    y: (rx + ry) * (TILE_HEIGHT / 2)
  };
};

const projectCell = (cell, cameraYaw = 0) => {
  const dx = cell.x - MAP_CENTER.x;
  const dy = cell.y - MAP_CENTER.y;
  const offset = projectWorldOffset(dx, dy, cameraYaw);
  return {
    left: offset.x,
    top: offset.y,
    depth: Math.round((offset.y / (TILE_HEIGHT / 2)) * 100)
  };
};

const formatPolygonPoints = (points) => (
  points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
);

const createTileGeometry = (cameraYaw = 0, tileRotation = 0) => {
  const topWorldCorners = [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 }
  ];
  const top = topWorldCorners.map((corner) => {
    const projected = projectWorldOffset(corner.x, corner.y, cameraYaw);
    return {
      x: TILE_RENDER_CENTER.x + projected.x,
      y: TILE_RENDER_CENTER.y + projected.y
    };
  });
  const bottom = top.map((point) => ({ x: point.x, y: point.y + FLOOR_THICKNESS }));
  const lowerEdges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0]
  ]
    .map(([start, end]) => ({
      start,
      end,
      midpointY: (top[start].y + top[end].y) / 2
    }))
    .sort((a, b) => b.midpointY - a.midpointY)
    .slice(0, 2);
  const sides = lowerEdges.map(({ start, end }) => [
    top[start],
    top[end],
    bottom[end],
    bottom[start]
  ]);

  const normalizedRotation = ((Number.parseInt(tileRotation, 10) || 0) % 180 + 180) % 180;
  const wallWorldEndpoints = normalizedRotation === 90
    ? [{ x: 0, y: -0.5 }, { x: 0, y: 0.5 }]
    : [{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }];
  const wallBase = wallWorldEndpoints.map((point) => {
    const projected = projectWorldOffset(point.x, point.y, cameraYaw);
    return {
      x: TILE_RENDER_CENTER.x + projected.x,
      y: TILE_RENDER_CENTER.y + projected.y - 4
    };
  });
  const wallTop = wallBase.map((point) => ({ x: point.x, y: point.y - WALL_HEIGHT }));

  return {
    top: formatPolygonPoints(top),
    sides: sides.map(formatPolygonPoints),
    wall: formatPolygonPoints([wallBase[0], wallBase[1], wallTop[1], wallTop[0]]),
    wallCap: formatPolygonPoints([
      wallTop[0],
      wallTop[1],
      { x: wallTop[1].x + 7, y: wallTop[1].y + 8 },
      { x: wallTop[0].x + 7, y: wallTop[0].y + 8 }
    ])
  };
};

const screenToCell = ({ clientX, clientY, rect, offset, zoom, cameraYaw }) => {
  const localX = (clientX - rect.left - (rect.width / 2) - offset.x) / zoom;
  const localY = (clientY - rect.top - (rect.height / 2) - offset.y) / zoom;
  const rx = (localY / TILE_HEIGHT) + (localX / TILE_WIDTH);
  const ry = (localY / TILE_HEIGHT) - (localX / TILE_WIDTH);
  const radians = (cameraYaw * Math.PI) / 180;
  const dx = (rx * Math.cos(radians)) + (ry * Math.sin(radians));
  const dy = (-rx * Math.sin(radians)) + (ry * Math.cos(radians));
  const x = Math.round(dx + MAP_CENTER.x);
  const y = Math.round(dy + MAP_CENTER.y);
  const cell = { x, y, z: 0 };
  return isValidCell(x, y, 0, {
    width: CITY_CHANNEL_WIDTH,
    height: CITY_CHANNEL_HEIGHT,
    layers: 1
  }) ? cell : null;
};

const createHintCells = (mapData, hoverCell) => {
  const hints = new Map();
  const addHint = (x, y, z = 0) => {
    if (!isValidCell(x, y, z, mapData)) return;
    const key = createCellKey(x, y, z);
    if (mapData.tiles[key]) return;
    hints.set(key, { x, y, z });
  };

  Object.values(mapData.tiles || {}).forEach((tile) => {
    addHint(tile.x + 1, tile.y, tile.z);
    addHint(tile.x - 1, tile.y, tile.z);
    addHint(tile.x, tile.y + 1, tile.z);
    addHint(tile.x, tile.y - 1, tile.z);
  });

  if (hoverCell) {
    addHint(hoverCell.x, hoverCell.y, hoverCell.z);
    addHint(hoverCell.x + 1, hoverCell.y, hoverCell.z);
    addHint(hoverCell.x - 1, hoverCell.y, hoverCell.z);
    addHint(hoverCell.x, hoverCell.y + 1, hoverCell.z);
    addHint(hoverCell.x, hoverCell.y - 1, hoverCell.z);
  }

  return Array.from(hints.values());
};

const CityChannelImmersiveEditor = ({ initialMapData, templateName, onExit }) => {
  const editor = useCityChannelEditorState(initialMapData);
  const {
    mapData,
    activeTool,
    activeRotation,
    selectedCell,
    validationResult,
    statusMessage,
    isDirty,
    canUndo,
    canRedo,
    routeKeySet,
    setActiveTool,
    setSelectedCell,
    validateSafeRoute,
    handleCellAction,
    markSavedMap,
    placeTile,
    eraseTile,
    rotateTileAtCell,
    toggleTileHighlight,
    undo,
    redo
  } = editor;
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const cameraRotationFrameRef = useRef(null);
  const cameraRotationDirectionRef = useRef(0);
  const cameraRotationLastTimeRef = useRef(0);
  const cameraPanFrameRef = useRef(null);
  const cameraPanKeysRef = useRef(new Set());
  const cameraPanLastTimeRef = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: -40 });
  const [cameraYaw, setCameraYaw] = useState(0);
  const [hoverCell, setHoverCell] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [openPanel, setOpenPanel] = useState(null);
  const [notice, setNotice] = useState('');
  const [wallTransparency, setWallTransparency] = useState(false);
  const [showHelperGrid, setShowHelperGrid] = useState(false);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [panelPose, setPanelPose] = useState('floor');

  const stopCameraRotation = useCallback((direction = null) => {
    if (direction !== null && cameraRotationDirectionRef.current !== direction) return;
    cameraRotationDirectionRef.current = 0;
    cameraRotationLastTimeRef.current = 0;
    if (cameraRotationFrameRef.current) {
      cancelAnimationFrame(cameraRotationFrameRef.current);
      cameraRotationFrameRef.current = null;
    }
  }, []);

  const stopCameraPan = useCallback((key = null) => {
    if (key) {
      cameraPanKeysRef.current.delete(key);
    } else {
      cameraPanKeysRef.current.clear();
    }
    cameraPanLastTimeRef.current = 0;
    if (cameraPanKeysRef.current.size <= 0 && cameraPanFrameRef.current) {
      cancelAnimationFrame(cameraPanFrameRef.current);
      cameraPanFrameRef.current = null;
    }
  }, []);

  const startCameraPan = useCallback((key) => {
    if (!key) return;
    cameraPanKeysRef.current.add(key);
    if (cameraPanFrameRef.current) return;

    const panFrame = (timestamp) => {
      if (cameraPanKeysRef.current.size <= 0) {
        cameraPanFrameRef.current = null;
        cameraPanLastTimeRef.current = 0;
        return;
      }

      const lastTimestamp = cameraPanLastTimeRef.current || timestamp;
      const deltaSeconds = Math.min(0.05, Math.max(0, (timestamp - lastTimestamp) / 1000));
      cameraPanLastTimeRef.current = timestamp;
      const distance = CAMERA_PAN_SPEED * deltaSeconds;
      let dx = 0;
      let dy = 0;
      if (cameraPanKeysRef.current.has('w')) dy += distance;
      if (cameraPanKeysRef.current.has('s')) dy -= distance;
      if (cameraPanKeysRef.current.has('a')) dx += distance;
      if (cameraPanKeysRef.current.has('d')) dx -= distance;
      if (dx || dy) {
        setOffset((current) => ({
          x: current.x + dx,
          y: current.y + dy
        }));
      }
      cameraPanFrameRef.current = requestAnimationFrame(panFrame);
    };

    cameraPanFrameRef.current = requestAnimationFrame(panFrame);
  }, []);

  const startCameraRotation = useCallback((direction) => {
    if (!direction) return;
    if (cameraRotationDirectionRef.current === direction && cameraRotationFrameRef.current) return;

    cameraRotationDirectionRef.current = direction;
    cameraRotationLastTimeRef.current = 0;
    if (cameraRotationFrameRef.current) {
      cancelAnimationFrame(cameraRotationFrameRef.current);
    }

    const rotateFrame = (timestamp) => {
      const activeDirection = cameraRotationDirectionRef.current;
      if (!activeDirection) {
        cameraRotationFrameRef.current = null;
        return;
      }

      const lastTimestamp = cameraRotationLastTimeRef.current || timestamp;
      const deltaSeconds = Math.min(0.05, Math.max(0, (timestamp - lastTimestamp) / 1000));
      cameraRotationLastTimeRef.current = timestamp;
      setCameraYaw((current) => normalizeCameraYaw(current + (activeDirection * CAMERA_ROTATION_SPEED * deltaSeconds)));
      cameraRotationFrameRef.current = requestAnimationFrame(rotateFrame);
    };

    cameraRotationFrameRef.current = requestAnimationFrame(rotateFrame);
  }, []);

  useEffect(() => {
    document.body.classList.add('city-channel-immersive-active');
    return () => {
      document.body.classList.remove('city-channel-immersive-active');
      stopCameraRotation();
      stopCameraPan();
    };
  }, [stopCameraPan, stopCameraRotation]);

  const selectedTile = useMemo(() => {
    if (!selectedCell) return null;
    return mapData.tiles[createCellKey(selectedCell.x, selectedCell.y, selectedCell.z)] || null;
  }, [mapData.tiles, selectedCell]);

  const selectedProjection = selectedCell && selectedTile ? projectCell(selectedCell, cameraYaw) : null;

  const placePanelAtCell = useCallback((cell) => {
    if (!cell) return;
    placeTile(cell, panelPose === 'wall' ? CITY_CHANNEL_TILE_TYPES.WALL : CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR);
  }, [panelPose, placeTile]);

  const rotateCameraLeft = useCallback(() => {
    setNotice('相机持续左旋转。');
    startCameraRotation(-1);
  }, [startCameraRotation]);

  const rotateCameraRight = useCallback(() => {
    setNotice('相机持续右旋转。');
    startCameraRotation(1);
  }, [startCameraRotation]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const targetTag = event.target?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || event.target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (event.code === 'Space') {
        event.preventDefault();
        setPanelPose((current) => {
          const next = current === 'floor' ? 'wall' : 'floor';
          setNotice(next === 'floor' ? '板材模式：平放为地板。' : '板材模式：竖立为墙壁。');
          return next;
        });
        setActiveTool(CITY_CHANNEL_TOOLS.FLOOR);
        return;
      }
      if (key === 'q') {
        event.preventDefault();
        rotateCameraLeft();
        return;
      }
      if (key === 'e') {
        event.preventDefault();
        rotateCameraRight();
        return;
      }
      if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
        event.preventDefault();
        startCameraPan(key);
      }
    };
    const handleKeyUp = (event) => {
      const key = event.key.toLowerCase();
      if (key === 'q') {
        stopCameraRotation(-1);
        return;
      }
      if (key === 'e') {
        stopCameraRotation(1);
        return;
      }
      if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
        stopCameraPan(key);
      }
    };
    const handleWindowBlur = () => {
      stopCameraPan();
      stopCameraRotation();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [rotateCameraLeft, rotateCameraRight, setActiveTool, startCameraPan, stopCameraPan, stopCameraRotation]);

  const visibleItems = useMemo(() => {
    const tiles = Object.values(mapData.tiles || {}).map((tile) => ({
      kind: 'tile',
      cell: { x: tile.x, y: tile.y, z: tile.z },
      tile
    }));
    const hints = createHintCells(mapData, hoverCell).map((cell) => ({
      kind: 'hint',
      cell
    }));
    return [...hints, ...tiles]
      .map((item) => ({
        ...item,
        projection: projectCell(item.cell, cameraYaw)
      }))
      .sort((a, b) => a.projection.depth - b.projection.depth);
  }, [cameraYaw, hoverCell, mapData]);

  const updateHoverFromEvent = useCallback((event) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const cell = screenToCell({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      offset,
      zoom,
      cameraYaw
    });
    setHoverCell(cell);
    return cell;
  }, [cameraYaw, offset, zoom]);

  const runValidation = useCallback(() => {
    const result = validateSafeRoute();
    setNotice(result.message);
    return result;
  }, [validateSafeRoute]);

  const handleSave = useCallback(() => {
    const result = validateSafeRoute();
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    const nextMapData = {
      ...mapData,
      name: templateName || mapData.name || '城内通道草稿',
      safeRoute: result.route
    };
    try {
      localStorage.setItem(CITY_CHANNEL_STORAGE_KEY, JSON.stringify(serializeCityChannelMap(nextMapData)));
      markSavedMap(nextMapData, result, '保存成功，白通路已验证。');
      setNotice('保存成功：白通路已验证');
    } catch (error) {
      setNotice(`保存失败：${error.message}`);
    }
  }, [mapData, markSavedMap, templateName, validateSafeRoute]);

  const handleExit = useCallback(() => {
    if (isDirty && !window.confirm('当前模板有未保存修改，确定退出到城内工坊首页？')) return;
    onExit?.();
  }, [isDirty, onExit]);

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    const nextZoom = Number(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom - (event.deltaY * 0.0014))).toFixed(2));
    if (rect) {
      const pointerX = event.clientX - rect.left - (rect.width / 2);
      const pointerY = event.clientY - rect.top - (rect.height / 2);
      const worldX = (pointerX - offset.x) / zoom;
      const worldY = (pointerY - offset.y) / zoom;
      setOffset({
        x: pointerX - (worldX * nextZoom),
        y: pointerY - (worldY * nextZoom)
      });
    }
    setZoom(nextZoom);
  }, [offset, zoom]);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateHoverFromEvent(event);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false
    };
  }, [updateHoverFromEvent]);

  const handlePointerMove = useCallback((event) => {
    const cell = updateHoverFromEvent(event);
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const totalDx = event.clientX - dragState.startX;
    const totalDy = event.clientY - dragState.startY;
    if (Math.hypot(totalDx, totalDy) > 4) {
      dragState.moved = true;
      setIsPanning(true);
    }
    if (dragState.moved) {
      const dx = event.clientX - dragState.lastX;
      const dy = event.clientY - dragState.lastY;
      dragState.lastX = event.clientX;
      dragState.lastY = event.clientY;
      setOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
    } else if (cell) {
      setHoverCell(cell);
    }
  }, [updateHoverFromEvent]);

  const handlePointerUp = useCallback((event) => {
    const dragState = dragRef.current;
    dragRef.current = null;
    setIsPanning(false);
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (dragState.moved) return;
    const cell = updateHoverFromEvent(event);
    if (!cell) return;
    const clickedTile = mapData.tiles[createCellKey(cell.x, cell.y, cell.z)] || null;
    if ((activeTool === CITY_CHANNEL_TOOLS.SELECT || activeTool === CITY_CHANNEL_TOOLS.FLOOR) && clickedTile) {
      setSelectedCell(cell);
      setNotice('已选中板材。');
      return;
    }
    if (activeTool === CITY_CHANNEL_TOOLS.FLOOR) {
      placePanelAtCell(cell);
      return;
    }
    handleCellAction(cell);
  }, [activeTool, handleCellAction, mapData.tiles, placePanelAtCell, setSelectedCell, updateHoverFromEvent]);

  const canPlace = !!hoverCell;
  const activeLayerLabel = CITY_CHANNEL_LAYER_LABELS[0] || '地面层';

  return (
    <div className={`city-channel-immersive ${wallTransparency ? 'is-wall-transparent' : ''} ${showHelperGrid ? 'is-helper-grid-visible' : ''}`}>
      <div className="city-channel-immersive__void" aria-hidden="true" />

      <div className="city-channel-immersive__topbar">
        <button type="button" className="city-channel-glass-btn" onClick={handleExit}>
          <LogOut size={16} />
          退出
        </button>
        <button type="button" className="city-channel-glass-btn is-primary" onClick={handleSave}>
          <Save size={16} />
          保存
        </button>
        <button type="button" className="city-channel-glass-btn" onClick={undo} disabled={!canUndo}>
          <Undo2 size={16} />
          撤销
        </button>
        <button type="button" className="city-channel-glass-btn" onClick={redo} disabled={!canRedo}>
          <Redo2 size={16} />
          重做
        </button>
      </div>

      <div
        ref={viewportRef}
        className={`city-channel-viewport ${isPanning ? 'is-panning' : ''}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="city-channel-world"
          style={{
            transform: `translate(calc(50vw + ${offset.x}px), calc(50vh + ${offset.y}px)) scale(${zoom})`
          }}
        >
          {visibleItems.map((item) => {
            const key = `${item.kind}:${createCellKey(item.cell.x, item.cell.y, item.cell.z)}`;
            const entrance = findPointAtCell(mapData.entrances, item.cell);
            const exit = findPointAtCell(mapData.exits, item.cell);
            const isRoute = routeKeySet.has(createCellKey(item.cell.x, item.cell.y, item.cell.z));
            const isSelected = sameCell(selectedCell, item.cell);
            const tile = item.tile;
            const tileClass = tile ? panelClassByType[tile.panelType] || 'is-floor' : '';
            const geometry = createTileGeometry(cameraYaw, tile?.rotation || 0);
            return (
              <button
                key={key}
                type="button"
                className={[
                  'city-channel-build-item',
                  item.kind === 'hint' ? 'is-hint' : 'has-tile',
                  tileClass,
                  entrance ? 'has-entrance' : '',
                  exit ? 'has-exit' : '',
                  isRoute ? 'is-route' : '',
                  isSelected ? 'is-selected' : '',
                  tile?.marker === 'highlight' ? 'is-user-marked' : '',
                  wallTransparency && tile?.panelType === CITY_CHANNEL_TILE_TYPES.WALL ? 'is-transparent-wall' : ''
                ].filter(Boolean).join(' ')}
                style={{
                  left: `${item.projection.left}px`,
                  top: `${item.projection.top}px`,
                  zIndex: item.projection.depth + (tile?.panelType === CITY_CHANNEL_TILE_TYPES.WALL ? 10000 : 0),
                  '--tile-rotation': `${tile?.rotation || 0}deg`
                }}
                onPointerDown={(event) => event.preventDefault()}
                aria-label={`格点 ${item.cell.x},${item.cell.y}`}
              >
                <svg
                  className="city-channel-build-item__block"
                  viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}
                  aria-hidden="true"
                >
                  {geometry.sides.map((points, index) => (
                    <polygon key={points} className={`city-channel-block-side side-${index + 1}`} points={points} />
                  ))}
                  <polygon className="city-channel-block-top" points={geometry.top} />
                  {tile?.panelType === CITY_CHANNEL_TILE_TYPES.WALL ? (
                    <>
                      <polygon className="city-channel-block-wall" points={geometry.wall} />
                      <polygon className="city-channel-block-wall-cap" points={geometry.wallCap} />
                    </>
                  ) : null}
                </svg>
                {entrance ? <span className="city-channel-portal is-entrance" aria-hidden="true" /> : null}
                {exit ? <span className="city-channel-portal is-exit" aria-hidden="true" /> : null}
                {showCoordinates && item.kind === 'tile' ? (
                  <span className="city-channel-coordinate">{`${item.cell.x},${item.cell.y}`}</span>
                ) : null}
              </button>
            );
          })}

          {hoverCell ? (
            (() => {
              const ghostGeometry = createTileGeometry(cameraYaw, activeRotation);
              return (
                <div
                  className={`city-channel-ghost ${canPlace ? 'is-valid' : 'is-invalid'} ${activeTool === CITY_CHANNEL_TOOLS.FLOOR && panelPose === 'wall' ? 'is-wall' : ''}`}
                  style={{
                    left: `${projectCell(hoverCell, cameraYaw).left}px`,
                    top: `${projectCell(hoverCell, cameraYaw).top}px`,
                    zIndex: projectCell(hoverCell, cameraYaw).depth + 20000,
                    '--tile-rotation': `${activeRotation}deg`
                  }}
                >
                  <svg
                    className="city-channel-build-item__block"
                    viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}
                    aria-hidden="true"
                  >
                    {ghostGeometry.sides.map((points, index) => (
                      <polygon key={points} className={`city-channel-block-side side-${index + 1}`} points={points} />
                    ))}
                    <polygon className="city-channel-block-top" points={ghostGeometry.top} />
                    {activeTool === CITY_CHANNEL_TOOLS.FLOOR && panelPose === 'wall' ? (
                      <>
                        <polygon className="city-channel-block-wall" points={ghostGeometry.wall} />
                        <polygon className="city-channel-block-wall-cap" points={ghostGeometry.wallCap} />
                      </>
                    ) : null}
                  </svg>
                </div>
              );
            })()
          ) : null}
          {selectedProjection ? (
            <div
              className="city-channel-cell-actions"
              style={{
                left: `${selectedProjection.left}px`,
                top: `${selectedProjection.top - 58}px`,
                zIndex: selectedProjection.depth + 26000
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button type="button" onClick={() => eraseTile(selectedCell)} title="删除板材">
                <Trash2 size={14} />
                <span>删除</span>
              </button>
              <button type="button" onClick={() => rotateTileAtCell(selectedCell)} title="旋转选中板材">
                <RotateCw size={14} />
                <span>旋转</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTool(CITY_CHANNEL_TOOLS.FLOOR);
                  placePanelAtCell(selectedCell);
                }}
                title="按当前板材模式更换"
              >
                <Replace size={14} />
                <span>更换</span>
              </button>
              <button type="button" onClick={() => toggleTileHighlight(selectedCell)} title="标记板材">
                <Tag size={14} />
                <span>标记</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="city-channel-hotbar" aria-label="物品栏">
        {TOOL_ITEMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`city-channel-hotbar__item ${activeTool === key ? 'is-active' : ''}`}
            onClick={() => setActiveTool(key)}
            title={label}
          >
            <Icon size={18} />
            <span>{key === CITY_CHANNEL_TOOLS.FLOOR ? `${label}:${panelPose === 'floor' ? '平放' : '竖立'}` : label}</span>
            {key === CITY_CHANNEL_TOOLS.FLOOR ? <em>Space</em> : null}
          </button>
        ))}
        <span className="city-channel-hotbar__divider" aria-hidden="true" />
        <button
          type="button"
          className="city-channel-hotbar__item city-channel-hotbar__item--camera"
          onPointerEnter={rotateCameraLeft}
          onPointerLeave={() => stopCameraRotation(-1)}
          onFocus={rotateCameraLeft}
          onBlur={() => stopCameraRotation(-1)}
          title="悬停左旋转，快捷键 Q"
        >
          <RotateCcw size={18} />
          <span>左旋转</span>
          <em>Q</em>
        </button>
        <button
          type="button"
          className="city-channel-hotbar__item city-channel-hotbar__item--camera"
          onPointerEnter={rotateCameraRight}
          onPointerLeave={() => stopCameraRotation(1)}
          onFocus={rotateCameraRight}
          onBlur={() => stopCameraRotation(1)}
          title="悬停右旋转，快捷键 E"
        >
          <RotateCw size={18} />
          <span>右旋转</span>
          <em>E</em>
        </button>
      </div>

      <div className="city-channel-floating-tools" aria-label="悬浮工具">
        {FLOATING_PANELS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`city-channel-float-btn ${openPanel === key || (key === 'perspective' && wallTransparency) ? 'is-active' : ''}`}
            onClick={() => {
              if (key === 'perspective') {
                setWallTransparency((current) => {
                  const next = !current;
                  setNotice(next ? '透视模式已开启：墙体透明，机关层保持可见。' : '透视模式已关闭。');
                  return next;
                });
                setOpenPanel(null);
                return;
              }
              if (key === 'validate') runValidation();
              setOpenPanel((current) => (current === key ? null : key));
            }}
            title={label}
          >
            {key === 'perspective'
              ? (wallTransparency ? <EyeOff size={16} /> : <Eye size={16} />)
              : <Icon size={16} />}
          </button>
        ))}
      </div>

      {openPanel ? (
        <aside className="city-channel-popover">
          <strong>{FLOATING_PANELS.find((item) => item.key === openPanel)?.label}</strong>
          {openPanel === 'layers' ? <p>当前 MVP 只开放 {activeLayerLabel}，后续再扩展多层通道。</p> : null}
          {openPanel === 'validate' ? <p>{validationResult.message}</p> : null}
          {openPanel === 'settings' ? (
            <div className="city-channel-settings-list">
              <label>
                <input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} />
                吸附到格点
              </label>
              <label>
                <input type="checkbox" checked={showCoordinates} onChange={(event) => setShowCoordinates(event.target.checked)} />
                显示坐标
              </label>
              <label>
                <input type="checkbox" checked={showHelperGrid} onChange={(event) => setShowHelperGrid(event.target.checked)} />
                显示辅助网格
              </label>
            </div>
          ) : null}
        </aside>
      ) : null}

      <footer className={`city-channel-immersive-status ${validationResult.ok ? 'is-ok' : ''}`}>
        <span>{`工具：${toolLabelByKey[activeTool] || activeTool}`}</span>
        <span>{`板材：${panelPose === 'floor' ? '平放' : '竖立'}`}</span>
        <span>{`相机：${Math.round(cameraYaw)}°`}</span>
        <span>{`层级：${activeLayerLabel}`}</span>
        <span>{`缩放：${Math.round(zoom * 100)}%`}</span>
        <span>{wallTransparency ? '透视：开' : '透视：关'}</span>
        <span>{validationResult.message}</span>
        <span>快捷键：W/A/S/D 平移，按住 Q/E 连续旋转相机，Space 切换板材</span>
        <em>{notice || statusMessage}</em>
      </footer>
    </div>
  );
};

export default CityChannelImmersiveEditor;
