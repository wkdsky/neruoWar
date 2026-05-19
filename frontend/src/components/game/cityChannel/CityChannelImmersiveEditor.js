import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Hand,
  Layers,
  LogOut,
  MousePointer2,
  Move,
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
  CITY_CHANNEL_HEIGHT,
  CITY_CHANNEL_LAYER_LABELS,
  CITY_CHANNEL_STORAGE_KEY,
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  CITY_CHANNEL_WIDTH,
  createCellKey,
  createWallKey,
  isValidCell,
  normalizeTemplateMeta,
  serializeCityChannelMap
} from './cityChannelSchema';
import useCityChannelEditorState from './useCityChannelEditorState';
import { getCityChannelMaterial } from './cityChannelCatalog';
import CityChannelMaterialPalette from './CityChannelMaterialPalette';
import { getMechanismGeometry } from './cityChannelMechanismGeometry';
import {
  buildCityChannelDomainModel
} from './cityChannelDomainModel';
import {
  createCityChannelRenderItems,
  createCityChannelGhostRenderItems,
  normalizeCityChannelCameraYaw
} from './cityChannelRenderModel';
import {
  rotateWorldPoint,
  projectWorldOffset,
  projectLocalPoint,
  formatPolygonPoints,
  createBox
} from './cityChannelGeometryUtils';
import './CityChannelImmersiveEditor.css';

const TILE_WIDTH = 120;
const TILE_HEIGHT = 64;
const TILE_RENDER_WIDTH = 160;
const TILE_RENDER_HEIGHT = 172;
const TILE_RENDER_CENTER = { x: 80, y: 98 };
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
const SELECTED_MOVE_HOLD_DELAY = 260;
const EDGE_NEIGHBOR_OFFSETS = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 }
};

const normalizeCameraYaw = normalizeCityChannelCameraYaw;

const createWallSelectionKey = (wall) => (
  wall ? createWallKey(wall.x, wall.y, wall.z, wall.edge) : ''
);

const createHitIdentity = (hit) => {
  if (!hit?.cell) return '';
  const cellKey = createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
  return [
    hit.type || '',
    cellKey,
    hit.edge || '',
    hit.hitZone || '',
    hit.connector?.id || ''
  ].join(':');
};

const normalizeClientRect = ({ startX, startY, endX, endY }) => ({
  left: Math.min(startX, endX),
  top: Math.min(startY, endY),
  right: Math.max(startX, endX),
  bottom: Math.max(startY, endY),
  width: Math.abs(endX - startX),
  height: Math.abs(endY - startY)
});

const rectsIntersect = (a, b) => (
  !!a
  && !!b
  && a.left <= b.right
  && a.right >= b.left
  && a.top <= b.bottom
  && a.bottom >= b.top
);

const normalizePointerAngleDelta = (delta) => {
  let normalized = delta;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
};

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

const toolLabelByKey = {
  [CITY_CHANNEL_TOOLS.BROWSE]: '浏览',
  [CITY_CHANNEL_TOOLS.SELECT]: '选择',
  [CITY_CHANNEL_TOOLS.ERASE]: '擦除',
  [CITY_CHANNEL_TOOLS.FLOOR]: '板材',
  [CITY_CHANNEL_TOOLS.WOOD_FLOOR]: '板材',
  [CITY_CHANNEL_TOOLS.WALL]: '墙板',
  [CITY_CHANNEL_TOOLS.ENTRANCE]: '入口',
  [CITY_CHANNEL_TOOLS.EXIT]: '出口'
};

const getInteractionHintConfig = ({
  activeTool,
  isPlaceMode,
  carryState,
  selectedCount,
  isTemporarySelection = false
}) => {
  if (activeTool === CITY_CHANNEL_TOOLS.BROWSE) {
    return {
      mode: '浏览',
      mouse: '左键拖拽平移 / 滚轮缩放 / 左键双击并按住拖拽旋转',
      keyboard: 'WASD 平移 / Q E 旋转'
    };
  }
  if (carryState) {
    return {
      mode: '移动',
      mouse: '移动鼠标预览落点 / 左键确认',
      keyboard: 'Esc 取消 / WASD 平移 / Q E 旋转'
    };
  }
  if (isPlaceMode || activeTool === CITY_CHANNEL_TOOLS.FLOOR) {
    return {
      mode: '放置',
      mouse: '左键放置 / 右键退出 / 滚轮旋转物件',
      keyboard: 'R 旋转 / Space 按当前吸附边切安装面 / WASD 平移 / Q E 旋转'
    };
  }
  if (activeTool === CITY_CHANNEL_TOOLS.SELECT) {
    return {
      mode: isTemporarySelection ? '临时选择' : '选择',
      mouse: isTemporarySelection
        ? '点击选择 / Shift 追加 / 空白拖拽框选 / 右键返回浏览'
        : '点击选择 / Shift 追加 / 空白拖拽框选',
      keyboard: selectedCount > 0
        ? 'M 移动 / Del 删除 / Space 翻转 / WASD 平移 / Q E 旋转'
        : 'WASD 平移 / Q E 旋转'
    };
  }
  return {
    mode: toolLabelByKey[activeTool] || '编辑',
    mouse: '按当前工具操作场景',
    keyboard: 'WASD 平移 / Q E 旋转'
  };
};

const fixedPanelClassByType = {
  [CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR]: 'is-floor',
  [CITY_CHANNEL_TILE_TYPES.STONE_FLOOR]: 'is-floor',
  [CITY_CHANNEL_TILE_TYPES.IRON_FLOOR]: 'is-floor',
  [CITY_CHANNEL_TILE_TYPES.WALL]: 'is-wall',
  [CITY_CHANNEL_TILE_TYPES.STAIR]: 'is-floor'
};

const getPanelClass = (panelType) => (
  fixedPanelClassByType[panelType] || `is-${String(panelType || 'floor').replace(/_/g, '-')}`
);

const findPointAtCell = (points = [], cell) => points.find((point) => (
  point.x === cell.x && point.y === cell.y && point.z === cell.z
));

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

const createWallThicknessOffset = (wallBase) => {
  const dx = wallBase[1].x - wallBase[0].x;
  const dy = wallBase[1].y - wallBase[0].y;
  const length = Math.max(1, Math.hypot(dx, dy));
  let offset = {
    x: (-dy / length) * 9,
    y: (dx / length) * 9
  };
  if (offset.y > 0) {
    offset = { x: -offset.x, y: -offset.y };
  }
  return offset;
};

const offsetPoint = (point, offset) => ({
  x: point.x + offset.x,
  y: point.y + offset.y
});

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
    [0, 1], [1, 2], [2, 3], [3, 0]
  ].map(([start, end]) => ({
    start, end,
    midpointY: (top[start].y + top[end].y) / 2
  })).sort((a, b) => b.midpointY - a.midpointY).slice(0, 2);
  const sides = lowerEdges.map(({ start, end }) => [
    top[start], top[end], bottom[end], bottom[start]
  ]);
  const tileDepthAnchorY = Math.max(...bottom.map((point) => point.y));

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
  const wallThicknessOffset = createWallThicknessOffset(wallBase);
  const rearBase = wallBase.map((point) => offsetPoint(point, wallThicknessOffset));
  const rearTop = wallTop.map((point) => offsetPoint(point, wallThicknessOffset));
  const wallBaseMaxY = Math.max(wallBase[0].y, wallBase[1].y);
  const wallTopMinY = Math.min(wallTop[0].y, wallTop[1].y);
  const wallHeightSpan = wallBaseMaxY - wallTopMinY;
  const verticalBaseY = wallTopMinY + (wallHeightSpan * 0.6);
  const wallFadeStartY = wallTopMinY + (wallHeightSpan * 0.34);
  const wallFadeEndY = wallBaseMaxY;

  return {
    top: formatPolygonPoints(top),
    sides: sides.map(formatPolygonPoints),
    wall: formatPolygonPoints([wallBase[0], wallBase[1], wallTop[1], wallTop[0]]),
    wallCap: formatPolygonPoints([wallTop[0], wallTop[1], rearTop[1], rearTop[0]]),
    wallSideStart: formatPolygonPoints([wallBase[0], wallTop[0], rearTop[0], rearBase[0]]),
    wallSideEnd: formatPolygonPoints([wallBase[1], rearBase[1], rearTop[1], wallTop[1]]),
    verticalBaseY,
    wallFadeStartY,
    wallFadeEndY,
    depthAnchorY: tileDepthAnchorY,
    wallDepthAnchorY: wallBaseMaxY
  };
};


const createPortalGeometry = (cameraYaw = 0, tileRotation = 0) => {
  const pillarW = 0.12;
  const pillarD = 0.1;
  const pillarH = 48;
  const pillarBottom = 4;
  const spacing = 0.32;

  const leftPillar = createBox(cameraYaw, -spacing - pillarW, -pillarD / 2, -spacing + pillarW, pillarD / 2, pillarBottom, pillarBottom + pillarH, pillarH, tileRotation);
  const rightPillar = createBox(cameraYaw, spacing - pillarW, -pillarD / 2, spacing + pillarW, pillarD / 2, pillarBottom, pillarBottom + pillarH, pillarH, tileRotation);

  const lintelBottom = pillarBottom + pillarH - 4;
  const lintelTop = lintelBottom + 10;
  const lintel = createBox(cameraYaw, -spacing - pillarW, -pillarD / 2, spacing + pillarW, pillarD / 2, lintelBottom, lintelTop, 10, tileRotation);

  const thresholdH = 5;
  const threshold = createBox(cameraYaw, -spacing - pillarW, -pillarD / 2 - 0.04, spacing + pillarW, pillarD / 2 + 0.04, 0, thresholdH, thresholdH, tileRotation);

  const archBottom = lintelBottom - 6;
  const archTop = lintelBottom;
  const arch = createBox(cameraYaw, -spacing + pillarW, -pillarD / 2 + 0.02, spacing - pillarW, pillarD / 2 - 0.02, archBottom, archTop, 6, tileRotation);

  const coreW = 0.16;
  const coreH = 32;
  const coreBottom = thresholdH + 2;
  const coreMid = rotateWorldPoint({ x: 0, y: 0 }, tileRotation);
  const coreCenter = projectLocalPoint(coreMid.x, coreMid.y, cameraYaw);
  const coreTop = coreCenter.y - coreBottom - coreH;
  const coreBottomY = coreCenter.y - coreBottom;

  const runePositions = [
    { x: -spacing + 0.02, y: 0, lift: pillarBottom + 12 },
    { x: spacing - 0.02, y: 0, lift: pillarBottom + 12 },
    { x: -spacing + 0.02, y: 0, lift: pillarBottom + 28 },
    { x: spacing - 0.02, y: 0, lift: pillarBottom + 28 }
  ].map((r) => {
    const rp = rotateWorldPoint({ x: r.x, y: r.y }, tileRotation);
    const p = projectLocalPoint(rp.x, rp.y, cameraYaw);
    return { x: p.x, y: p.y - r.lift };
  });

  const particles = Array.from({ length: 5 }, (_, i) => {
    const t = (i / 5) * 2 - 1;
    const pw = rotateWorldPoint({ x: t * coreW, y: 0 }, tileRotation);
    const pp = projectLocalPoint(pw.x, pw.y, cameraYaw);
    return { x: pp.x, y: coreBottomY - 8 - i * 6, delay: i * 0.5 };
  });

  return {
    leftPillar, rightPillar, lintel, threshold, arch,
    coreCenter: { x: coreCenter.x, y: (coreTop + coreBottomY) / 2 },
    coreRx: 8, coreRy: coreH / 2,
    runePositions, particles
  };
};


const createEdgeWallGeometry = (cameraYaw = 0, edge = 'north') => {
  const edgeEndpoints = {
    north: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }],
    south: [{ x: -0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
    west: [{ x: -0.5, y: -0.5 }, { x: -0.5, y: 0.5 }],
    east: [{ x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }]
  };
  const endpoints = edgeEndpoints[edge] || edgeEndpoints.north;
  const wallBase = endpoints.map((point) => {
    const projected = projectWorldOffset(point.x, point.y, cameraYaw);
    return {
      x: TILE_RENDER_CENTER.x + projected.x,
      y: TILE_RENDER_CENTER.y + projected.y
    };
  });
  const wallTop = wallBase.map((point) => ({ x: point.x, y: point.y - WALL_HEIGHT }));
  const wallThicknessOffset = createWallThicknessOffset(wallBase);
  const rearBase = wallBase.map((point) => offsetPoint(point, wallThicknessOffset));
  const rearTop = wallTop.map((point) => offsetPoint(point, wallThicknessOffset));
  const wallBaseMaxY = Math.max(wallBase[0].y, wallBase[1].y);
  const wallTopMinY = Math.min(wallTop[0].y, wallTop[1].y);
  const wallHeightSpan = wallBaseMaxY - wallTopMinY;
  const verticalBaseY = wallTopMinY + (wallHeightSpan * 0.6);
  const wallFadeStartY = wallTopMinY + (wallHeightSpan * 0.34);
  const wallFadeEndY = wallBaseMaxY;
  return {
    wall: formatPolygonPoints([wallBase[0], wallBase[1], wallTop[1], wallTop[0]]),
    wallCap: formatPolygonPoints([wallTop[0], wallTop[1], rearTop[1], rearTop[0]]),
    wallSideStart: formatPolygonPoints([wallBase[0], wallTop[0], rearTop[0], rearBase[0]]),
    wallSideEnd: formatPolygonPoints([wallBase[1], rearBase[1], rearTop[1], wallTop[1]]),
    verticalBaseY,
    wallFadeStartY,
    wallFadeEndY,
    depthAnchorY: wallBaseMaxY
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
  return isValidCell(x, y, 0, {
    width: CITY_CHANNEL_WIDTH,
    height: CITY_CHANNEL_HEIGHT,
    layers: 1
  }) ? { x, y, z: 0 } : null;
};

const isWallMaterial = (tileType) => (
  tileType === CITY_CHANNEL_TILE_TYPES.WALL || tileType === CITY_CHANNEL_TILE_TYPES.GLASS_WALL
);

const isPortalPanelType = (tileType) => (
  tileType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || tileType === CITY_CHANNEL_TILE_TYPES.EXIT
);

const shouldUseVerticalOutline = (tile) => !!tile && isWallMaterial(tile.panelType);

const parsePolygonPoints = (points = '') => String(points).trim().split(/\s+/).map((pair) => {
  const [x, y] = pair.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}).filter(Boolean);

const pointInPolygon = (point, polygonPoints = '') => {
  const polygon = Array.isArray(polygonPoints) ? polygonPoints : parsePolygonPoints(polygonPoints);
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects = ((pi.y > point.y) !== (pj.y > point.y))
      && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / ((pj.y - pi.y) || 1) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

const polygonAverageY = (points = '') => {
  const parsed = parsePolygonPoints(points);
  if (parsed.length === 0) return 0;
  return parsed.reduce((sum, point) => sum + point.y, 0) / parsed.length;
};

const CityChannelImmersiveEditor = ({ initialMapData, templateId = null, templateName, templateSource = 'local', onExit }) => {
  const editor = useCityChannelEditorState(initialMapData);
  const {
    mapData,
    activeTool,
    activeTileType,
    activeRotation,
    setActiveRotation,
    validationResult,
    statusMessage,
    isDirty,
    canUndo,
    canRedo,
    routeKeySet,
    setActiveTool,
    setSelectedCell,
    selectMaterial,
    validateSafeRoute,
    handleCellAction,
    markSavedMap,
    placeTile,
    eraseTile,
    eraseWall,
    applyPlacementOperations,
    deletePlacements,
    movePlacements,
    rotatePlacements,
    rotatePlacementsReverse,
    flipPlacements,
    selectOperationTool,
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
  const clampOffsetRef = useRef((candidateOffset) => candidateOffset);
  const keyboardActionsRef = useRef({});
  const movePreviewRef = useRef({ valid: true, conflicts: [], targetKey: '' });
  const browsePointerSequenceRef = useRef({ lastDownAt: 0, lastX: 0, lastY: 0 });
  const selectedMoveHoldTimerRef = useRef(null);
  const hoverSnapshotRef = useRef({ cellKey: '', actionKey: '', verticalKey: '', edge: '' });
  const paintOperationQueueRef = useRef([]);
  const paintFlushFrameRef = useRef(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: -40 });
  const [cameraYaw, setCameraYaw] = useState(0);
  const [hoverCell, setHoverCell] = useState(null);
  const [hoverEdge, setHoverEdge] = useState(null);
  const [hoverActionHit, setHoverActionHit] = useState(null);
  const [hoverVerticalTarget, setHoverVerticalTarget] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isBrowseRotating, setIsBrowseRotating] = useState(false);
  const [openPanel, setOpenPanel] = useState(null);
  const [wallViewMode, setWallViewMode] = useState('semi');
  const [showHelperGrid, setShowHelperGrid] = useState(false);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [panelPose, setPanelPose] = useState('floor');
  const [selectedCells, setSelectedCells] = useState([]);
  const [selectedWalls, setSelectedWalls] = useState([]);
  const [selectionModeOrigin, setSelectionModeOrigin] = useState(null);
  const [placeReturnState, setPlaceReturnState] = useState(null);
  const [selectionBox, setSelectionBox] = useState(null);
  const [carryState, setCarryState] = useState(null);
  const [toasts, setToasts] = useState([]);
  const domainModel = useMemo(() => buildCityChannelDomainModel(mapData), [mapData]);
  const isPlaceMode = activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && !!activeTileType;
  const isWallPerspectiveMode = wallViewMode === 'perspective';
  const isWallSolidMode = wallViewMode === 'solid';
  const wallViewModeConfig = WALL_VIEW_MODE_CONFIG[wallViewMode] || WALL_VIEW_MODE_CONFIG.semi;

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, message, type, timestamp: Date.now() }]);
  }, []);

  const flushPaintOperations = useCallback(() => {
    if (paintFlushFrameRef.current) {
      cancelAnimationFrame(paintFlushFrameRef.current);
      paintFlushFrameRef.current = null;
    }
    const operations = paintOperationQueueRef.current;
    if (operations.length <= 0) return;
    paintOperationQueueRef.current = [];
    applyPlacementOperations(operations);
  }, [applyPlacementOperations]);

  const queuePaintOperation = useCallback((operation) => {
    if (!operation) return;
    paintOperationQueueRef.current.push(operation);
    if (paintFlushFrameRef.current) return;
    paintFlushFrameRef.current = requestAnimationFrame(flushPaintOperations);
  }, [flushPaintOperations]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.timestamp < 3000));
    }, 3100);
    return () => clearTimeout(timer);
  }, [toasts]);


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
        setOffset((current) => clampOffsetRef.current({ x: current.x + dx, y: current.y + dy }));
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
      if (selectedMoveHoldTimerRef.current) {
        clearTimeout(selectedMoveHoldTimerRef.current);
        selectedMoveHoldTimerRef.current = null;
      }
      if (paintFlushFrameRef.current) {
        cancelAnimationFrame(paintFlushFrameRef.current);
        paintFlushFrameRef.current = null;
      }
      paintOperationQueueRef.current = [];
      stopCameraRotation();
      stopCameraPan();
    };
  }, [stopCameraPan, stopCameraRotation]);

  const rotateCameraLeft = useCallback(() => startCameraRotation(-1), [startCameraRotation]);
  const rotateCameraRight = useCallback(() => startCameraRotation(1), [startCameraRotation]);


  const getTileGeometry = useMemo(() => {
    const cache = new Map();
    return (yaw, rotation) => {
      const key = `${Math.round(yaw)}:${rotation}`;
      if (!cache.has(key)) cache.set(key, createTileGeometry(yaw, rotation));
      return cache.get(key);
    };
  }, []);

  const getPortalGeometry = useMemo(() => {
    const cache = new Map();
    return (yaw, rotation) => {
      const key = `${Math.round(yaw)}:${rotation}`;
      if (!cache.has(key)) cache.set(key, createPortalGeometry(yaw, rotation));
      return cache.get(key);
    };
  }, []);

  const placePanelAtCell = useCallback((cell) => {
    if (!cell) return;
    placeTile(cell, panelPose === 'wall' ? CITY_CHANNEL_TILE_TYPES.WALL : CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR);
  }, [panelPose, placeTile]);

  const clearSelection = useCallback(() => {
    setSelectedCells([]);
    setSelectedCell(null);
    setSelectedWalls([]);
    setSelectionBox(null);
    setCarryState(null);
  }, [setSelectedCell]);

  const enterBrowseMode = useCallback(() => {
    clearSelection();
    setSelectionModeOrigin(null);
    setPlaceReturnState(null);
    setIsBrowseRotating(false);
    browsePointerSequenceRef.current = { lastDownAt: 0, lastX: 0, lastY: 0 };
    selectOperationTool(CITY_CHANNEL_TOOLS.BROWSE);
  }, [clearSelection, selectOperationTool]);

  const selectedPlacements = useMemo(() => (
    [...selectedCells, ...selectedWalls]
  ), [selectedCells, selectedWalls]);

  const commitPlacementsMove = useCallback((origins, targetCell) => {
    if (!Array.isArray(origins) || origins.length === 0 || !targetCell) return false;
    const targetKey = createCellKey(targetCell.x, targetCell.y, targetCell.z);
    if (
      movePreviewRef.current?.targetKey !== targetKey
      || !movePreviewRef.current?.valid
    ) {
      addToast('目标位置存在冲突，无法完成移动。', 'error');
      return false;
    }
    const anchor = origins[0];
    const dx = targetCell.x - anchor.x;
    const dy = targetCell.y - anchor.y;
    if (dx === 0 && dy === 0) {
      setCarryState(null);
      return true;
    }
    const moves = origins.map((placement) => ({
      from: placement,
      to: {
        x: placement.x + dx,
        y: placement.y + dy,
        z: placement.z,
        ...(placement.edge ? { edge: placement.edge } : {})
      }
    }));
    movePlacements(moves);
    setSelectedCells(moves.filter((move) => !move.to.edge).map((move) => move.to));
    setSelectedWalls(moves.filter((move) => !!move.to.edge).map((move) => move.to));
    setSelectedCell(moves.find((move) => !move.to.edge)?.to || null);
    setCarryState(null);
    return true;
  }, [addToast, movePlacements, setSelectedCell]);

  const startCarry = useCallback(() => {
    if (selectedPlacements.length === 0) return;
    setCarryState({ origins: selectedPlacements.map((placement) => ({ ...placement })) });
  }, [selectedPlacements]);

  const commitCarry = useCallback((targetCell) => {
    if (!carryState || !targetCell) return;
    const origins = Array.isArray(carryState.origins) ? carryState.origins : [];
    commitPlacementsMove(origins, targetCell);
  }, [carryState, commitPlacementsMove]);

  const flipSelectedWalls = useCallback(() => {
    if (selectedWalls.length === 0) return;
    flipPlacements(selectedWalls);
  }, [flipPlacements, selectedWalls]);

  keyboardActionsRef.current = {
    deleteSelection: () => {
      if (selectedPlacements.length === 0) return;
      deletePlacements(selectedPlacements);
      clearSelection();
    },
    rotateSelection: () => {
      if (selectedPlacements.length === 0) return;
      rotatePlacements(selectedPlacements);
    },
    rotateSelectionReverse: () => {
      if (selectedPlacements.length === 0) return;
      rotatePlacementsReverse(selectedPlacements);
    },
    flipSelection: () => {
      if (selectedPlacements.length === 0) return;
      flipPlacements(selectedPlacements);
    },
    flipWall: selectedWalls.length > 0 ? flipSelectedWalls : null,
    startCarry,
    commitCarry
  };


  useEffect(() => {
    const handleKeyDown = (event) => {
      const targetTag = event.target?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || event.target?.isContentEditable) return;
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }

      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        keyboardActionsRef.current.deleteSelection();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        if (selectedPlacements.length > 0) {
          keyboardActionsRef.current.flipSelection();
        } else if (keyboardActionsRef.current.flipWall) {
          keyboardActionsRef.current.flipWall();
        } else {
          setPanelPose((current) => (current === 'floor' ? 'wall' : 'floor'));
          setSelectionModeOrigin(null);
          setActiveTool(CITY_CHANNEL_TOOLS.FLOOR);
        }
        return;
      }
      if (key === 'm') {
        event.preventDefault();
        keyboardActionsRef.current.startCarry();
        return;
      }
      if (key === 'q') { event.preventDefault(); rotateCameraLeft(); return; }
      if (key === 'e') { event.preventDefault(); rotateCameraRight(); return; }
      if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
        event.preventDefault();
        startCameraPan(key);
      }
      if (key === 'escape') {
        clearSelection();
        return;
      }
    };
    const handleKeyUp = (event) => {
      const key = event.key.toLowerCase();
      if (key === 'q') { stopCameraRotation(-1); return; }
      if (key === 'e') { stopCameraRotation(1); return; }
      if (key === 'w' || key === 'a' || key === 's' || key === 'd') { stopCameraPan(key); }
    };
    const handleWindowBlur = () => { stopCameraPan(); stopCameraRotation(); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [clearSelection, redo, rotateCameraLeft, rotateCameraRight, selectedPlacements.length, setActiveTool, startCameraPan, stopCameraPan, stopCameraRotation, undo]);

  const visibleItems = useMemo(() => {
    return createCityChannelRenderItems({
      domainModel,
      mapData,
      cameraYaw,
      hoverCell
    });
  }, [cameraYaw, domainModel, hoverCell, mapData]);

  const sceneContentBounds = useMemo(() => {
    const items = visibleItems.filter((item) => item.kind !== 'hint');
    if (items.length === 0) return null;
    return items.reduce((bounds, item) => {
      const left = item.projection.left - (TILE_RENDER_WIDTH * 0.5);
      const right = item.projection.left + (TILE_RENDER_WIDTH * 0.5);
      const top = item.projection.top - (TILE_RENDER_HEIGHT * 0.57);
      const bottom = item.projection.top + (TILE_RENDER_HEIGHT * 0.43);
      return {
        left: Math.min(bounds.left, left),
        right: Math.max(bounds.right, right),
        top: Math.min(bounds.top, top),
        bottom: Math.max(bounds.bottom, bottom)
      };
    }, {
      left: Infinity,
      right: -Infinity,
      top: Infinity,
      bottom: -Infinity
    });
  }, [visibleItems]);

  const clampOffsetToVisibleContent = useCallback((candidateOffset, nextZoom = zoom) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || !sceneContentBounds) return candidateOffset;
    const basePadding = 24;
    const paletteRect = document.querySelector('.city-channel-material-palette')?.getBoundingClientRect();
    const paletteInset = paletteRect && paletteRect.width > 0
      ? Math.max(basePadding, Math.ceil(paletteRect.right - rect.left + 18))
      : basePadding;
    const safeFrame = {
      left: paletteInset - (rect.width / 2),
      right: (rect.width / 2) - basePadding,
      top: basePadding - (rect.height / 2),
      bottom: (rect.height / 2) - basePadding
    };
    const usableWidth = Math.max(1, safeFrame.right - safeFrame.left);
    const usableHeight = Math.max(1, safeFrame.bottom - safeFrame.top);
    const logicalOverscanX = Math.max(120 / nextZoom, (usableWidth * 0.54) / nextZoom);
    const logicalOverscanY = Math.max(92 / nextZoom, (usableHeight * 0.5) / nextZoom);
    const logicalBounds = {
      left: sceneContentBounds.left - logicalOverscanX,
      right: sceneContentBounds.right + logicalOverscanX,
      top: sceneContentBounds.top - logicalOverscanY,
      bottom: sceneContentBounds.bottom + logicalOverscanY
    };
    const clampAxis = (value, logicalMin, logicalMax, frameMin, frameMax) => {
      const scaledMin = logicalMin * nextZoom;
      const scaledMax = logicalMax * nextZoom;
      const logicalSpan = scaledMax - scaledMin;
      const frameSpan = frameMax - frameMin;
      const min = logicalSpan <= frameSpan
        ? frameMin - scaledMin
        : frameMax - scaledMax;
      const max = logicalSpan <= frameSpan
        ? frameMax - scaledMax
        : frameMin - scaledMin;
      return Math.min(Math.max(value, min), max);
    };
    return {
      x: clampAxis(candidateOffset.x, logicalBounds.left, logicalBounds.right, safeFrame.left, safeFrame.right),
      y: clampAxis(candidateOffset.y, logicalBounds.top, logicalBounds.bottom, safeFrame.top, safeFrame.bottom)
    };
  }, [sceneContentBounds, zoom]);

  clampOffsetRef.current = clampOffsetToVisibleContent;

  useEffect(() => {
    setOffset((current) => {
      const next = clampOffsetToVisibleContent(current);
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [clampOffsetToVisibleContent, offset.x, offset.y]);

  useEffect(() => {
    const clampCurrentOffset = () => {
      setOffset((current) => {
        const next = clampOffsetToVisibleContent(current);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    };
    const viewport = viewportRef.current;
    const palette = document.querySelector('.city-channel-material-palette');
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(clampCurrentOffset)
      : null;

    window.addEventListener('resize', clampCurrentOffset);
    if (viewport) resizeObserver?.observe(viewport);
    if (palette) resizeObserver?.observe(palette);

    return () => {
      window.removeEventListener('resize', clampCurrentOffset);
      resizeObserver?.disconnect();
    };
  }, [clampOffsetToVisibleContent]);

  const selectedCellKeySet = useMemo(() => (
    new Set(selectedCells.map((c) => createCellKey(c.x, c.y, c.z)))
  ), [selectedCells]);

  const selectedWallKeySet = useMemo(() => (
    new Set(selectedWalls.map(createWallSelectionKey))
  ), [selectedWalls]);

  const movePreview = useMemo(() => {
    if (!carryState || !hoverCell) {
      return { items: [], conflicts: [], valid: true, targetKey: '' };
    }
    const origins = Array.isArray(carryState.origins) ? carryState.origins : [];
    if (origins.length === 0) {
      return { items: [], conflicts: [], valid: true, targetKey: '' };
    }

    const anchor = origins[0];
    const dx = hoverCell.x - anchor.x;
    const dy = hoverCell.y - anchor.y;
    const movingTileOriginKeys = new Set(
      origins
        .filter((placement) => !placement.edge)
        .map((placement) => createCellKey(placement.x, placement.y, placement.z))
    );
    const movingWallOriginKeys = new Set(
      origins
        .filter((placement) => !!placement.edge)
        .map(createWallSelectionKey)
    );

    const previewTiles = {};
    const previewWalls = {};
    const targetTileKeys = new Set();
    const targetWallKeys = new Set();
    const targetPlacements = [];
    const conflicts = [];
    const seenConflictKeys = new Set();
    const addConflict = ({ cell, edge = null, reason }) => {
      if (!cell) return;
      const key = `${cell.z}:${cell.x}:${cell.y}:${edge || 'cell'}:${reason}`;
      if (seenConflictKeys.has(key)) return;
      seenConflictKeys.add(key);
      conflicts.push({
        key,
        cell,
        edge,
        reason,
        projection: projectCell(cell, cameraYaw)
      });
    };

    origins.forEach((placement) => {
      const target = {
        x: placement.x + dx,
        y: placement.y + dy,
        z: placement.z,
        ...(placement.edge ? { edge: placement.edge } : {})
      };
      targetPlacements.push({ from: placement, to: target });

      if (!isValidCell(target.x, target.y, target.z, mapData)) {
        addConflict({ cell: target, edge: target.edge || null, reason: 'out_of_bounds' });
        return;
      }

      if (placement.edge) {
        const originKey = createWallSelectionKey(placement);
        const sourceWall = mapData.walls?.[originKey];
        if (!sourceWall) return;
        const targetKey = createWallSelectionKey(target);
        if (targetWallKeys.has(targetKey)) {
          addConflict({ cell: target, edge: target.edge, reason: 'wall_overlap' });
        }
        targetWallKeys.add(targetKey);
        if (mapData.walls?.[targetKey] && !movingWallOriginKeys.has(targetKey)) {
          addConflict({ cell: target, edge: target.edge, reason: 'wall_occupied' });
        }
        previewWalls[targetKey] = {
          ...sourceWall,
          x: target.x,
          y: target.y,
          z: target.z,
          edge: target.edge
        };
        return;
      }

      const originKey = createCellKey(placement.x, placement.y, placement.z);
      const sourceTile = mapData.tiles?.[originKey];
      if (!sourceTile) return;
      const targetKey = createCellKey(target.x, target.y, target.z);
      if (targetTileKeys.has(targetKey)) {
        addConflict({ cell: target, reason: 'tile_overlap' });
      }
      targetTileKeys.add(targetKey);
      if (mapData.tiles?.[targetKey] && !movingTileOriginKeys.has(targetKey)) {
        addConflict({ cell: target, reason: 'tile_occupied' });
      }
      previewTiles[targetKey] = {
        ...sourceTile,
        x: target.x,
        y: target.y,
        z: target.z
      };
    });

    targetPlacements.forEach(({ to }) => {
      if (!to.edge || !isValidCell(to.x, to.y, to.z, mapData)) return;
      const ownCellKey = createCellKey(to.x, to.y, to.z);
      const neighborOffset = EDGE_NEIGHBOR_OFFSETS[to.edge] || EDGE_NEIGHBOR_OFFSETS.north;
      const neighborCell = {
        x: to.x + neighborOffset.x,
        y: to.y + neighborOffset.y,
        z: to.z
      };
      const neighborValid = isValidCell(neighborCell.x, neighborCell.y, neighborCell.z, mapData);
      const neighborCellKey = neighborValid
        ? createCellKey(neighborCell.x, neighborCell.y, neighborCell.z)
        : '';
      const hasOwnSupport = targetTileKeys.has(ownCellKey)
        || (!!mapData.tiles?.[ownCellKey] && !movingTileOriginKeys.has(ownCellKey));
      const hasNeighborSupport = neighborValid && (
        targetTileKeys.has(neighborCellKey)
        || (!!mapData.tiles?.[neighborCellKey] && !movingTileOriginKeys.has(neighborCellKey))
      );
      if (!hasOwnSupport && !hasNeighborSupport) {
        addConflict({ cell: to, edge: to.edge, reason: 'wall_without_floor_support' });
      }
    });

    const ghostMapData = {
      ...mapData,
      tiles: previewTiles,
      walls: previewWalls,
      entrances: [],
      exits: [],
      safeRoute: [],
      mechanisms: []
    };
    const valid = conflicts.length === 0;
    const conflictPlacementKeys = new Set(conflicts.map((conflict) => (
      conflict.edge
        ? createWallKey(conflict.cell.x, conflict.cell.y, conflict.cell.z, conflict.edge)
        : createCellKey(conflict.cell.x, conflict.cell.y, conflict.cell.z)
    )));
    const items = createCityChannelRenderItems({
      mapData: ghostMapData,
      cameraYaw,
      includeHints: false
    }).map((item) => ({
      ...item,
      id: `move-ghost:${item.id}`,
      isGhost: true,
      ghost: {
        valid: item.kind === 'wall'
          ? !conflictPlacementKeys.has(createWallKey(item.cell.x, item.cell.y, item.cell.z, item.wall?.edge))
          : !conflictPlacementKeys.has(createCellKey(item.cell.x, item.cell.y, item.cell.z)),
        mode: 'move',
        placementKind: item.kind,
        conflictCount: conflicts.length
      }
    }));

    return {
      items,
      conflicts,
      valid,
      targetKey: createCellKey(hoverCell.x, hoverCell.y, hoverCell.z)
    };
  }, [cameraYaw, carryState, hoverCell, mapData]);
  movePreviewRef.current = movePreview;

  const ghostItems = useMemo(() => {
    if (carryState) return movePreview.items;
    const shouldShowGhost = hoverCell && (isPlaceMode || activeTool === CITY_CHANNEL_TOOLS.FLOOR || !!carryState);
    if (!shouldShowGhost) return [];
    const isWallGhost = isWallMaterial(activeTileType) || (activeTool === CITY_CHANNEL_TOOLS.FLOOR && panelPose === 'wall');
    const panelType = activeTileType || (isWallGhost ? CITY_CHANNEL_TILE_TYPES.WALL : CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR);
    const placementKind = isPlaceMode && isWallMaterial(activeTileType) ? 'edge_wall' : 'tile';
    const hasFloor = !!mapData.tiles[createCellKey(hoverCell.x, hoverCell.y, hoverCell.z)];
    return createCityChannelGhostRenderItems({
      mapData,
      cell: hoverCell,
      panelType,
      rotation: activeRotation,
      edge: hoverEdge || 'north',
      placementKind,
      cameraYaw,
      valid: placementKind !== 'edge_wall' || hasFloor,
      mode: carryState ? 'move' : 'place'
    });
  }, [activeTileType, activeTool, activeRotation, cameraYaw, carryState, hoverCell, hoverEdge, isPlaceMode, mapData, movePreview.items, panelPose]);

  const sceneItems = useMemo(() => (
    [...visibleItems, ...ghostItems].sort((a, b) => (
      (a.renderOrder - b.renderOrder)
      || (a.isGhost === b.isGhost ? 0 : (a.isGhost ? 1 : -1))
      || String(a.part?.id || a.id || '').localeCompare(String(b.part?.id || b.id || ''))
    ))
  ), [ghostItems, visibleItems]);

  const buildHitStackFromEvent = useCallback((event) => {
    const hits = [];
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return hits;
    const getLocalPoint = (cell) => {
      const cellProj = projectCell(cell, cameraYaw);
      const cellScreenX = rect.left + rect.width / 2 + offset.x + cellProj.left * zoom;
      const cellScreenY = rect.top + rect.height / 2 + offset.y + cellProj.top * zoom;
      const left = cellScreenX - (TILE_RENDER_WIDTH * 0.5 * zoom);
      const top = cellScreenY - (TILE_RENDER_HEIGHT * 0.57 * zoom);
      const right = left + (TILE_RENDER_WIDTH * zoom);
      const bottom = top + (TILE_RENDER_HEIGHT * zoom);
      if (
        event.clientX < left - 6
        || event.clientX > right + 6
        || event.clientY < top - 6
        || event.clientY > bottom + 6
      ) {
        return null;
      }
      return {
        x: (event.clientX - left) / zoom,
        y: (event.clientY - top) / zoom
      };
    };

    visibleItems.forEach((item) => {
      if (item.kind === 'hint') return;
      const partType = item.part?.partType || 'body';
      if (
        partType === 'floor_attachment'
        || partType === 'wall_attachment'
        || partType === 'mechanism_connector'
        || partType === 'portal_body'
      ) {
        return;
      }
      const localPoint = getLocalPoint(item.cell);
      if (!localPoint) return;
      const cellKey = createCellKey(item.cell.x, item.cell.y, item.cell.z);

      if (item.kind === 'wall') {
        const wallGeo = createEdgeWallGeometry(cameraYaw, item.wall.edge);
        const inWall = pointInPolygon(localPoint, wallGeo.wall) || pointInPolygon(localPoint, wallGeo.wallCap);
        if (!inWall) return;
        const hitZone = localPoint.y >= wallGeo.verticalBaseY ? 'base' : 'outline';
        hits.push({
          type: 'tile',
          tileKey: createWallKey(item.cell.x, item.cell.y, item.cell.z, item.wall.edge),
          panelType: item.wall.panelType,
          isVertical: true,
          hitZone,
          priority: hitZone === 'base' ? 90 : 10,
          cell: item.cell,
          edge: item.wall.edge,
          item,
          screenBounds: wallGeo
        });
        return;
      }

      const tile = item.tile;
      if (!tile) return;
      const geometry = getTileGeometry(cameraYaw, tile.rotation || 0);
      const tileIsVertical = shouldUseVerticalOutline(tile);
      const tileBodyHit = pointInPolygon(localPoint, geometry.top)
        || geometry.sides.some((points) => pointInPolygon(localPoint, points));
      const verticalPlaneHit = pointInPolygon(localPoint, geometry.wall) || pointInPolygon(localPoint, geometry.wallCap);
      const isPortal = tile.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || tile.panelType === CITY_CHANNEL_TILE_TYPES.EXIT;
      const portalBodyHit = isPortal
        && localPoint.x >= 36
        && localPoint.x <= 124
        && localPoint.y >= 42
        && localPoint.y <= 134;

      if (tile.mechanismModel) {
        const mechGeo = getMechanismGeometry(tile.mechanismModel, tile.connectors, tile.rotation || 0, cameraYaw);
        mechGeo.connectorPositions.forEach((conn) => {
          const dx = localPoint.x - conn.screenX;
          const dy = localPoint.y - conn.screenY;
          if ((dx * dx) + (dy * dy) <= 100) {
            hits.push({
              type: 'connector',
              tileKey: cellKey,
              panelType: tile.panelType,
              isVertical: tileIsVertical,
              hitZone: 'connector',
              priority: 130,
              cell: item.cell,
              connector: conn,
              item,
              screenBounds: { x: conn.screenX, y: conn.screenY, radius: 10 }
            });
          }
        });
      }

      if (tileIsVertical) {
        const inVerticalBody = verticalPlaneHit || portalBodyHit || (tileBodyHit && localPoint.y >= geometry.verticalBaseY);
        if (!inVerticalBody) return;
        const hitZone = localPoint.y >= geometry.verticalBaseY ? 'base' : 'outline';
        hits.push({
          type: 'tile',
          tileKey: cellKey,
          panelType: tile.panelType,
          isVertical: true,
          hitZone,
          priority: hitZone === 'base' ? 80 : 8,
          cell: item.cell,
          item,
          screenBounds: geometry
        });
        return;
      }

      if (!tileBodyHit) return;
      hits.push({
        type: 'tile',
        tileKey: cellKey,
        panelType: tile.panelType,
        isVertical: false,
        hitZone: 'body',
        priority: 50,
        cell: item.cell,
        item,
        screenBounds: geometry
      });
    });

    return hits
      .sort((a, b) => (
        ((b.item?.renderOrder || 0) - (a.item?.renderOrder || 0))
        || (b.priority - a.priority)
      ));
  }, [cameraYaw, getTileGeometry, offset.x, offset.y, visibleItems, zoom]);

  const resolveActionHit = useCallback((hitStack) => (
    hitStack.find((hit) => !(hit.isVertical && hit.hitZone === 'outline')) || null
  ), []);

  const hoverStatusLabel = useMemo(() => {
    if (hoverActionHit?.type === 'connector') {
      return `连接点：${hoverActionHit.connector?.label || hoverActionHit.connector?.id || '未命名'}`;
    }
    if (hoverActionHit?.type === 'tile') {
      const materialName = getCityChannelMaterial(hoverActionHit.panelType)?.name || hoverActionHit.panelType;
      if (hoverActionHit.isVertical && hoverActionHit.hitZone === 'base') {
        return `${materialName}基座，可点击选择`;
      }
      return materialName || '地面板';
    }
    if (hoverVerticalTarget?.hitZone === 'outline') {
      return '竖立轮廓，点击将穿透';
    }
    return hoverCell ? '空地，可吸附放置' : '未指向通道';
  }, [hoverActionHit, hoverCell, hoverVerticalTarget]);

  const updateHoverFromEvent = useCallback((event, { hitTest = true } = {}) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const groundCell = screenToCell({ clientX: event.clientX, clientY: event.clientY, rect, offset, zoom, cameraYaw });
    const hitStack = hitTest ? buildHitStackFromEvent(event) : [];
    const actionHit = resolveActionHit(hitStack);
    const outlineHit = hitStack.find((hit) => hit.isVertical && hit.hitZone === 'outline') || null;
    const cell = actionHit?.cell || groundCell;
    const verticalTarget = outlineHit || (actionHit?.isVertical ? actionHit : null);
    let nextHoverEdge = null;
    if (cell) {
      const cellProj = projectCell(cell, cameraYaw);
      const centerScreenX = rect.left + rect.width / 2 + offset.x + cellProj.left * zoom;
      const centerScreenY = rect.top + rect.height / 2 + offset.y + cellProj.top * zoom;
      const relX = (event.clientX - centerScreenX) / zoom;
      const relY = (event.clientY - centerScreenY) / zoom;
      const edgeMidpoints = [
        { edge: 'north', x: 0, y: -0.5 },
        { edge: 'south', x: 0, y: 0.5 },
        { edge: 'west', x: -0.5, y: 0 },
        { edge: 'east', x: 0.5, y: 0 }
      ];
      let closest = 'north';
      let minDist = Infinity;
      edgeMidpoints.forEach(({ edge, x, y }) => {
        const proj = projectWorldOffset(x, y, cameraYaw);
        const dx = relX - proj.x;
        const dy = relY - proj.y;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) { minDist = dist; closest = edge; }
      });
      nextHoverEdge = closest;
    }

    const nextSnapshot = {
      cellKey: cell ? createCellKey(cell.x, cell.y, cell.z) : '',
      actionKey: createHitIdentity(actionHit),
      verticalKey: createHitIdentity(verticalTarget),
      edge: nextHoverEdge || ''
    };
    const currentSnapshot = hoverSnapshotRef.current;
    if (
      currentSnapshot.cellKey !== nextSnapshot.cellKey
      || currentSnapshot.actionKey !== nextSnapshot.actionKey
      || currentSnapshot.verticalKey !== nextSnapshot.verticalKey
      || currentSnapshot.edge !== nextSnapshot.edge
    ) {
      hoverSnapshotRef.current = nextSnapshot;
      setHoverCell(cell);
      setHoverActionHit(actionHit || null);
      setHoverVerticalTarget(verticalTarget);
      setHoverEdge(nextHoverEdge);
    }
    return cell;
  }, [buildHitStackFromEvent, cameraYaw, offset, resolveActionHit, zoom]);


  const runValidation = useCallback(() => {
    const result = validateSafeRoute();
    if (result.ok) {
      addToast('验证通过：入口可到达出口', 'success');
    } else {
      addToast(`验证失败：${result.message}`, 'error');
    }
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
      safeRoute: result.route
    };
    try {
      localStorage.setItem(CITY_CHANNEL_STORAGE_KEY, JSON.stringify(serializeCityChannelMap(nextMapData)));
      markSavedMap(nextMapData, result, '保存成功。');
      addToast('保存成功，白通路已验证', 'success');
    } catch (error) {
      addToast(`保存失败：${error.message}`, 'error');
    }
  }, [addToast, mapData, markSavedMap, templateId, templateName, templateSource, validateSafeRoute]);

  const handleExit = useCallback(() => {
    if (isDirty && !window.confirm('当前模板有未保存修改，确定退出到城内工坊首页？')) return;
    onExit?.();
  }, [isDirty, onExit]);

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    if (activeTool === CITY_CHANNEL_TOOLS.BROWSE) {
      const rect = viewportRef.current?.getBoundingClientRect();
      const nextZoom = Number(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom - (event.deltaY * 0.0014))).toFixed(2));
      if (rect) {
        const pointerX = event.clientX - rect.left - (rect.width / 2);
        const pointerY = event.clientY - rect.top - (rect.height / 2);
        const worldX = (pointerX - offset.x) / zoom;
        const worldY = (pointerY - offset.y) / zoom;
        setOffset(clampOffsetToVisibleContent({
          x: pointerX - (worldX * nextZoom),
          y: pointerY - (worldY * nextZoom)
        }, nextZoom));
      }
      setZoom(nextZoom);
      return;
    }
    if (selectedPlacements.length > 0) {
      if (event.deltaY < 0) {
        keyboardActionsRef.current.rotateSelection();
      } else {
        keyboardActionsRef.current.rotateSelectionReverse();
      }
      return;
    }
    if (isPlaceMode) {
      setActiveRotation((current) => (current + (event.deltaY < 0 ? 90 : 270)) % 360);
      return;
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    const nextZoom = Number(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom - (event.deltaY * 0.0014))).toFixed(2));
    if (rect) {
      const pointerX = event.clientX - rect.left - (rect.width / 2);
      const pointerY = event.clientY - rect.top - (rect.height / 2);
      const worldX = (pointerX - offset.x) / zoom;
      const worldY = (pointerY - offset.y) / zoom;
      setOffset(clampOffsetToVisibleContent({
        x: pointerX - (worldX * nextZoom),
        y: pointerY - (worldY * nextZoom)
      }, nextZoom));
    }
    setZoom(nextZoom);
  }, [activeTool, clampOffsetToVisibleContent, isPlaceMode, offset, selectedPlacements.length, setActiveRotation, zoom]);

  const detectNearestEdge = useCallback((clientX, clientY, cell) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return 'north';
    const cellProj = projectCell(cell, cameraYaw);
    const centerScreenX = rect.left + rect.width / 2 + offset.x + cellProj.left * zoom;
    const centerScreenY = rect.top + rect.height / 2 + offset.y + cellProj.top * zoom;
    const relX = (clientX - centerScreenX) / zoom;
    const relY = (clientY - centerScreenY) / zoom;
    const edgeMidpoints = [
      { edge: 'north', x: 0, y: -0.5 },
      { edge: 'south', x: 0, y: 0.5 },
      { edge: 'west', x: -0.5, y: 0 },
      { edge: 'east', x: 0.5, y: 0 }
    ];
    let closest = 'north';
    let minDist = Infinity;
    edgeMidpoints.forEach(({ edge, x, y }) => {
      const proj = projectWorldOffset(x, y, cameraYaw);
      const dx = relX - proj.x;
      const dy = relY - proj.y;
      const dist = dx * dx + dy * dy;
      if (dist < minDist) { minDist = dist; closest = edge; }
    });
    return closest;
  }, [cameraYaw, offset, zoom]);

  const applyPlaceModeAction = useCallback((cell, placeStroke, event) => {
    const paintedCells = placeStroke?.paintedCells;
    if (!paintedCells) return;
    const key = createCellKey(cell.x, cell.y, cell.z);
    if (activeTileType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || activeTileType === CITY_CHANNEL_TILE_TYPES.EXIT) {
      if (paintedCells.has(key)) return;
      paintedCells.add(key);
      placeTile(cell, activeTileType);
      return;
    }
    const ensurePaintIntent = (intent) => {
      if (!placeStroke.paintIntent) {
        placeStroke.paintIntent = intent;
      }
      return placeStroke.paintIntent;
    };

    if (isWallMaterial(activeTileType)) {
      const existingTile = mapData.tiles[key];
      if (!existingTile) return;
      const edge = detectNearestEdge(event.clientX, event.clientY, cell);
      const wallKey = `${key}:${edge}`;
      if (paintedCells.has(wallKey)) return;
      paintedCells.add(wallKey);
      const existingWall = mapData.walls[createWallKey(cell.x, cell.y, cell.z, edge)];
      const intent = ensurePaintIntent(existingWall ? 'erase' : 'place');
      if (intent === 'erase') {
        if (!existingWall) return;
        queuePaintOperation({
          kind: 'wall',
          action: 'erase',
          cell,
          edge
        });
        return;
      }
      if (!existingWall) {
        queuePaintOperation({
          kind: 'wall',
          action: 'place',
          cell,
          edge,
          panelType: activeTileType
        });
      }
      return;
    }

    if (paintedCells.has(key)) return;
    paintedCells.add(key);
    const existingTile = mapData.tiles[key];
    const intent = ensurePaintIntent(
      existingTile?.panelType === activeTileType ? 'erase' : 'place'
    );
    if (intent === 'erase') {
      if (existingTile?.panelType === activeTileType) {
        queuePaintOperation({
          kind: 'tile',
          action: 'erase',
          cell
        });
      }
      return;
    }
    if (!existingTile || existingTile.panelType !== activeTileType) {
      queuePaintOperation({
        kind: 'tile',
        action: 'place',
        cell,
        panelType: activeTileType,
        rotation: activeRotation
      });
    }
  }, [activeRotation, activeTileType, detectNearestEdge, mapData.tiles, mapData.walls, placeTile, queuePaintOperation]);

  const getRenderItemClientBounds = useCallback((item) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || !item?.cell) return null;
    const cellProj = projectCell(item.cell, cameraYaw);
    const cellScreenX = rect.left + rect.width / 2 + offset.x + (cellProj.left * zoom);
    const cellScreenY = rect.top + rect.height / 2 + offset.y + (cellProj.top * zoom);
    const toClientPoint = (point) => ({
      x: cellScreenX - (TILE_RENDER_WIDTH * 0.5 * zoom) + (point.x * zoom),
      y: cellScreenY - (TILE_RENDER_HEIGHT * 0.57 * zoom) + (point.y * zoom)
    });
    const points = [];
    if (item.kind === 'wall' && item.wall) {
      const wallGeometry = createEdgeWallGeometry(cameraYaw, item.wall.edge);
      [wallGeometry.wall, wallGeometry.wallCap, wallGeometry.wallSideStart, wallGeometry.wallSideEnd]
        .flatMap(parsePolygonPoints)
        .forEach((point) => points.push(toClientPoint(point)));
    } else if (item.tile) {
      const tileGeometry = getTileGeometry(cameraYaw, item.tile.rotation || 0);
      [tileGeometry.top, ...tileGeometry.sides]
        .flatMap(parsePolygonPoints)
        .forEach((point) => points.push(toClientPoint(point)));
      if (shouldUseVerticalOutline(item.tile)) {
        [tileGeometry.wall, tileGeometry.wallCap, tileGeometry.wallSideStart, tileGeometry.wallSideEnd]
          .flatMap(parsePolygonPoints)
          .forEach((point) => points.push(toClientPoint(point)));
      }
    }
    if (points.length === 0) return null;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys)
    };
  }, [cameraYaw, getTileGeometry, offset.x, offset.y, zoom]);

  const collectSelectionsInRect = useCallback((selectionRect, additive = false) => {
    if (!selectionRect) return;
    const tileByKey = new Map();
    const wallByKey = new Map();
    visibleItems.forEach((item) => {
      const partType = item.part?.partType || '';
      const selectableTile = item.kind === 'tile' && partType === 'floor_base' && item.tile;
      const selectableWall = item.kind === 'wall' && partType === 'wall_plane' && item.wall;
      if (!selectableTile && !selectableWall) return;
      const bounds = getRenderItemClientBounds(item);
      if (!rectsIntersect(selectionRect, bounds)) return;
      if (selectableTile) {
        const key = createCellKey(item.cell.x, item.cell.y, item.cell.z);
        tileByKey.set(key, { x: item.cell.x, y: item.cell.y, z: item.cell.z });
      }
      if (selectableWall) {
        const wallSelection = {
          x: item.cell.x,
          y: item.cell.y,
          z: item.cell.z,
          edge: item.wall.edge
        };
        wallByKey.set(createWallSelectionKey(wallSelection), wallSelection);
      }
    });

    setSelectedCells((current) => {
      const next = additive
        ? new Map(current.map((cell) => [createCellKey(cell.x, cell.y, cell.z), cell]))
        : new Map();
      tileByKey.forEach((value, key) => next.set(key, value));
      return Array.from(next.values());
    });
    setSelectedWalls((current) => {
      const next = additive
        ? new Map(current.map((wall) => [createWallSelectionKey(wall), wall]))
        : new Map();
      wallByKey.forEach((value, key) => next.set(key, value));
      return Array.from(next.values());
    });
    setSelectedCell(Array.from(tileByKey.values())[0] || null);
  }, [getRenderItemClientBounds, setSelectedCell, visibleItems]);

  const selectPlacementFromHit = useCallback(({ actionHit, clickedCell, additive = false }) => {
    if (!actionHit || !clickedCell) return false;
    if (actionHit.edge && actionHit.hitZone === 'base') {
      const clickedWall = { x: clickedCell.x, y: clickedCell.y, z: clickedCell.z, edge: actionHit.edge };
      const clickedWallKey = createWallSelectionKey(clickedWall);
      if (additive) {
        setSelectedWalls((prev) => (
          selectedWallKeySet.has(clickedWallKey)
            ? prev.filter((wall) => createWallSelectionKey(wall) !== clickedWallKey)
            : [...prev, clickedWall]
        ));
      } else {
        setSelectedWalls([clickedWall]);
        setSelectedCells([]);
      }
      setSelectedCell(null);
      return true;
    }

    const clickedTile = actionHit.type === 'tile' || actionHit.type === 'connector'
      ? (mapData.tiles[createCellKey(actionHit.cell.x, actionHit.cell.y, actionHit.cell.z)] || null)
      : null;
    if (!clickedTile) return false;

    if (!additive) {
      setSelectedWalls([]);
      setSelectedCells([clickedCell]);
      setSelectedCell(clickedCell);
      return true;
    }

    const cellKey = createCellKey(clickedCell.x, clickedCell.y, clickedCell.z);
    setSelectedCells((prev) => (
      selectedCellKeySet.has(cellKey)
        ? prev.filter((cell) => createCellKey(cell.x, cell.y, cell.z) !== cellKey)
        : [...prev, clickedCell]
    ));
    setSelectedCell(clickedCell);
    return true;
  }, [mapData.tiles, selectedCellKeySet, selectedWallKeySet, setSelectedCell]);

  const isSelectedPlacementHit = useCallback((actionHit) => {
    if (!actionHit?.cell) return false;
    if (actionHit.edge && actionHit.hitZone === 'base') {
      return selectedWallKeySet.has(createWallSelectionKey({
        x: actionHit.cell.x,
        y: actionHit.cell.y,
        z: actionHit.cell.z,
        edge: actionHit.edge
      }));
    }
    if (actionHit.type === 'tile' || actionHit.type === 'connector') {
      return selectedCellKeySet.has(createCellKey(actionHit.cell.x, actionHit.cell.y, actionHit.cell.z));
    }
    return false;
  }, [selectedCellKeySet, selectedWallKeySet]);

  const getPointerOrbitAngle = useCallback((clientX, clientY) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    if (Math.hypot(dx, dy) < 28) return null;
    return Math.atan2(dy, dx);
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (event.button === 2) return;
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const cell = updateHoverFromEvent(event);
    const actionHit = resolveActionHit(buildHitStackFromEvent(event));
    if (isPlaceMode) {
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        placeMode: true,
        paintedCells: new Set(),
        paintIntent: null
      };
      if (cell) applyPlaceModeAction(cell, dragRef.current, event);
      return;
    }
    if (activeTool === CITY_CHANNEL_TOOLS.BROWSE) {
      const lastBrowseDown = browsePointerSequenceRef.current;
      const downAt = Number(event.timeStamp) || Date.now();
      const downDistance = Math.hypot(
        event.clientX - lastBrowseDown.lastX,
        event.clientY - lastBrowseDown.lastY
      );
      const isDoubleHoldRotate = (
        lastBrowseDown.lastDownAt > 0
        && downAt - lastBrowseDown.lastDownAt <= 320
        && downDistance <= 20
      );
      browsePointerSequenceRef.current = isDoubleHoldRotate
        ? { lastDownAt: 0, lastX: 0, lastY: 0 }
        : { lastDownAt: downAt, lastX: event.clientX, lastY: event.clientY };
      setIsBrowseRotating(isDoubleHoldRotate);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        browseMode: isDoubleHoldRotate ? 'rotate' : 'pan',
        orbitAngle: isDoubleHoldRotate ? getPointerOrbitAngle(event.clientX, event.clientY) : null
      };
      return;
    }
    const shouldStartHoldMove = (
      activeTool === CITY_CHANNEL_TOOLS.SELECT
      && !carryState
      && selectedPlacements.length > 0
      && isSelectedPlacementHit(actionHit)
    );
    const dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      shiftKey: event.shiftKey,
      selectionMode: activeTool === CITY_CHANNEL_TOOLS.SELECT && !carryState && !actionHit,
      holdMoveCandidate: shouldStartHoldMove
    };
    dragRef.current = dragState;
    if (shouldStartHoldMove) {
      if (selectedMoveHoldTimerRef.current) clearTimeout(selectedMoveHoldTimerRef.current);
      const origins = selectedPlacements.map((placement) => ({ ...placement }));
      selectedMoveHoldTimerRef.current = setTimeout(() => {
        selectedMoveHoldTimerRef.current = null;
        const currentDrag = dragRef.current;
        if (!currentDrag || currentDrag.pointerId !== event.pointerId || currentDrag.moved) return;
        currentDrag.longPressCarryStarted = true;
        currentDrag.longPressOrigins = origins;
        currentDrag.selectionMode = false;
        setSelectionBox(null);
        setCarryState({ origins });
      }, SELECTED_MOVE_HOLD_DELAY);
    }
  }, [activeTool, applyPlaceModeAction, buildHitStackFromEvent, carryState, getPointerOrbitAngle, isPlaceMode, isSelectedPlacementHit, resolveActionHit, selectedPlacements, updateHoverFromEvent]);

  const handleContextMenu = useCallback((event) => {
    event.preventDefault();
    if (activeTool === CITY_CHANNEL_TOOLS.BROWSE) {
      return;
    }
    if (activeTool === CITY_CHANNEL_TOOLS.SELECT && selectionModeOrigin === 'browse') {
      enterBrowseMode();
      return;
    }
    if (isPlaceMode) {
      const returnState = placeReturnState || { tool: CITY_CHANNEL_TOOLS.SELECT, selectionModeOrigin: null };
      setPlaceReturnState(null);
      if (returnState.tool === CITY_CHANNEL_TOOLS.BROWSE) {
        enterBrowseMode();
        return;
      }
      setSelectionModeOrigin(returnState.selectionModeOrigin || null);
      selectOperationTool(CITY_CHANNEL_TOOLS.SELECT);
      return;
    }
    if (activeTool === CITY_CHANNEL_TOOLS.SELECT) {
      if (selectedPlacements.length > 0) {
        clearSelection();
      }
      return;
    }
    if (selectedPlacements.length > 0) {
      clearSelection();
      return;
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cell = screenToCell({ clientX: event.clientX, clientY: event.clientY, rect, offset, zoom, cameraYaw });
    if (!cell) return;
    const actionHit = resolveActionHit(buildHitStackFromEvent(event));
    if (actionHit?.edge && actionHit.hitZone === 'base') {
      eraseWall({ x: actionHit.cell.x, y: actionHit.cell.y, z: actionHit.cell.z, edge: actionHit.edge });
      return;
    }
    if (actionHit?.type === 'tile') {
      eraseTile(actionHit.cell);
    }
  }, [activeTool, buildHitStackFromEvent, cameraYaw, clearSelection, enterBrowseMode, eraseTile, eraseWall, isPlaceMode, offset, placeReturnState, resolveActionHit, selectOperationTool, selectedPlacements.length, selectionModeOrigin, zoom]);

  const handlePointerMove = useCallback((event) => {
    const dragState = dragRef.current;
    if (!dragState) {
      updateHoverFromEvent(event, { hitTest: !carryState });
      return;
    }
    if (dragState.pointerId !== event.pointerId) return;
    if (dragState.placeMode) {
      const cell = updateHoverFromEvent(event);
      if (cell) applyPlaceModeAction(cell, dragState, event);
      return;
    }
    if (dragState.browseMode) {
      const totalDx = event.clientX - dragState.startX;
      const totalDy = event.clientY - dragState.startY;
      if (Math.hypot(totalDx, totalDy) > 4) {
        dragState.moved = true;
        setIsPanning(true);
      }
      if (!dragState.moved) return;
      const dx = event.clientX - dragState.lastX;
      const dy = event.clientY - dragState.lastY;
      dragState.lastX = event.clientX;
      dragState.lastY = event.clientY;
      if (dragState.browseMode === 'rotate') {
        const nextOrbitAngle = getPointerOrbitAngle(event.clientX, event.clientY);
        if (nextOrbitAngle !== null && dragState.orbitAngle !== null) {
          const delta = normalizePointerAngleDelta(nextOrbitAngle - dragState.orbitAngle);
          dragState.orbitAngle = nextOrbitAngle;
          setCameraYaw((current) => normalizeCameraYaw(current + ((delta * 180) / Math.PI)));
        } else {
          dragState.orbitAngle = nextOrbitAngle;
          setCameraYaw((current) => normalizeCameraYaw(current + (dx * 0.34)));
        }
      } else {
        setOffset((current) => clampOffsetToVisibleContent({ x: current.x + dx, y: current.y + dy }));
      }
      return;
    }
    const totalDx = event.clientX - dragState.startX;
    const totalDy = event.clientY - dragState.startY;
    if (dragState.longPressCarryStarted) {
      updateHoverFromEvent(event, { hitTest: false });
      if (Math.hypot(totalDx, totalDy) > 4) {
        dragState.moved = true;
      }
      return;
    }
    if (dragState.holdMoveCandidate && Math.hypot(totalDx, totalDy) > 6) {
      dragState.holdMoveCandidate = false;
      if (selectedMoveHoldTimerRef.current) {
        clearTimeout(selectedMoveHoldTimerRef.current);
        selectedMoveHoldTimerRef.current = null;
      }
    }
    if (Math.hypot(totalDx, totalDy) > 4) {
      dragState.moved = true;
      if (!dragState.selectionMode) {
        setIsPanning(true);
      }
    }
    if (dragState.moved) {
      if (dragState.selectionMode) {
        setSelectionBox(normalizeClientRect({
          startX: dragState.startX,
          startY: dragState.startY,
          endX: event.clientX,
          endY: event.clientY
        }));
        return;
      }
      const dx = event.clientX - dragState.lastX;
      const dy = event.clientY - dragState.lastY;
      dragState.lastX = event.clientX;
      dragState.lastY = event.clientY;
      setOffset((current) => clampOffsetToVisibleContent({ x: current.x + dx, y: current.y + dy }));
    }
  }, [applyPlaceModeAction, carryState, clampOffsetToVisibleContent, getPointerOrbitAngle, updateHoverFromEvent]);

  const handlePointerUp = useCallback((event) => {
    const dragState = dragRef.current;
    dragRef.current = null;
    if (selectedMoveHoldTimerRef.current) {
      clearTimeout(selectedMoveHoldTimerRef.current);
      selectedMoveHoldTimerRef.current = null;
    }
    setIsPanning(false);
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (dragState.placeMode) {
      flushPaintOperations();
      return;
    }
    if (dragState.longPressCarryStarted) {
      const cell = updateHoverFromEvent(event, { hitTest: false });
      if (cell) {
        commitPlacementsMove(dragState.longPressOrigins || [], cell);
      } else {
        setCarryState(null);
      }
      return;
    }
    if (dragState.browseMode) {
      if (dragState.browseMode === 'rotate') {
        setIsBrowseRotating(false);
      } else if (dragState.moved) {
        browsePointerSequenceRef.current = { lastDownAt: 0, lastX: 0, lastY: 0 };
      } else {
        const hitStack = buildHitStackFromEvent(event);
        const actionHit = resolveActionHit(hitStack);
        const clickedCell = actionHit?.cell || updateHoverFromEvent(event);
        if (selectPlacementFromHit({ actionHit, clickedCell })) {
          setSelectionModeOrigin('browse');
          selectOperationTool(CITY_CHANNEL_TOOLS.SELECT);
        }
      }
      return;
    }
    if (dragState.moved && dragState.selectionMode) {
      const nextRect = normalizeClientRect({
        startX: dragState.startX,
        startY: dragState.startY,
        endX: event.clientX,
        endY: event.clientY
      });
      collectSelectionsInRect(nextRect, dragState.shiftKey);
      setSelectionBox(null);
      return;
    }
    if (dragState.moved) return;

    const cell = updateHoverFromEvent(event);
    if (!cell) return;

    if (carryState) {
      keyboardActionsRef.current.commitCarry(cell);
      return;
    }

    const hitStack = buildHitStackFromEvent(event);
    const actionHit = resolveActionHit(hitStack);
    const clickedCell = actionHit?.cell || cell;

    if (activeTool === CITY_CHANNEL_TOOLS.SELECT) {
      if (selectPlacementFromHit({ actionHit, clickedCell, additive: dragState.shiftKey })) {
        return;
      }
      if (!dragState.shiftKey) { clearSelection(); }
      return;
    }

    if (activeTool === CITY_CHANNEL_TOOLS.FLOOR && selectPlacementFromHit({ actionHit, clickedCell, additive: dragState.shiftKey })) {
      return;
    }

    if (activeTool === CITY_CHANNEL_TOOLS.ERASE) {
      if (actionHit?.edge && actionHit.hitZone === 'base') {
        eraseWall({ x: clickedCell.x, y: clickedCell.y, z: clickedCell.z, edge: actionHit.edge });
      } else if (actionHit?.type === 'tile' || actionHit?.type === 'connector') {
        eraseTile(clickedCell);
      }
      return;
    }

    if (activeTool === CITY_CHANNEL_TOOLS.FLOOR && !actionHit) {
      // The default floor tool intentionally snaps to the ground cell when the
      // pointer is over a vertical outline; only solid base hits block it.
      placePanelAtCell(cell);
      return;
    }
    handleCellAction(cell);
  }, [activeTool, buildHitStackFromEvent, carryState, clearSelection, collectSelectionsInRect, commitPlacementsMove, eraseTile, eraseWall, flushPaintOperations, handleCellAction, placePanelAtCell, resolveActionHit, selectOperationTool, selectPlacementFromHit, updateHoverFromEvent]);

  const handleMaterialSelect = useCallback((panelType) => {
    setPlaceReturnState((current) => current || {
      tool: activeTool === CITY_CHANNEL_TOOLS.SELECT ? CITY_CHANNEL_TOOLS.SELECT : CITY_CHANNEL_TOOLS.BROWSE,
      selectionModeOrigin
    });
    selectMaterial(panelType);
    setSelectedCells([]);
    setSelectedWalls([]);
    setSelectionBox(null);
    setCarryState(null);
  }, [activeTool, selectMaterial, selectionModeOrigin]);


  const activeLayerLabel = CITY_CHANNEL_LAYER_LABELS[0] || '地面层';
  const interactionHint = getInteractionHintConfig({
    activeTool,
    isPlaceMode,
    carryState,
    selectedCount: selectedPlacements.length,
    isTemporarySelection: activeTool === CITY_CHANNEL_TOOLS.SELECT && selectionModeOrigin === 'browse'
  });


  const renderPortalObject = (tile, isEntrance) => {
    const portalGeo = getPortalGeometry(cameraYaw, tile.rotation || 0);
    const portalClass = `city-channel-portal-object ${isEntrance ? 'is-entrance' : 'is-exit'} ${tile.flipped ? 'is-flipped' : ''}`;
    return (
      <div className={portalClass} aria-hidden="true">
        <svg className="city-channel-portal-object__svg" viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}>
          <polygon className="city-channel-portal-object__threshold-front" points={portalGeo.threshold.frontFace} />
          <polygon className="city-channel-portal-object__threshold-side" points={portalGeo.threshold.sideFace} />
          <polygon className="city-channel-portal-object__threshold-top" points={portalGeo.threshold.topFace} />
          <polygon className="city-channel-portal-object__pillar-front" points={portalGeo.leftPillar.frontFace} />
          <polygon className="city-channel-portal-object__pillar-side" points={portalGeo.leftPillar.sideFace} />
          <polygon className="city-channel-portal-object__pillar-top" points={portalGeo.leftPillar.topFace} />
          <polygon className="city-channel-portal-object__pillar-front" points={portalGeo.rightPillar.frontFace} />
          <polygon className="city-channel-portal-object__pillar-side" points={portalGeo.rightPillar.sideFace} />
          <polygon className="city-channel-portal-object__pillar-top" points={portalGeo.rightPillar.topFace} />
          <polygon className="city-channel-portal-object__lintel-front" points={portalGeo.lintel.frontFace} />
          <polygon className="city-channel-portal-object__lintel-side" points={portalGeo.lintel.sideFace} />
          <polygon className="city-channel-portal-object__lintel-top" points={portalGeo.lintel.topFace} />
          <polygon className="city-channel-portal-object__arch-front" points={portalGeo.arch.frontFace} />
          <polygon className="city-channel-portal-object__arch-top" points={portalGeo.arch.topFace} />
          <ellipse
            className="city-channel-portal-object__core-outer"
            cx={portalGeo.coreCenter.x} cy={portalGeo.coreCenter.y}
            rx={portalGeo.coreRx + 3} ry={portalGeo.coreRy + 3}
          />
          <ellipse
            className="city-channel-portal-object__core-inner"
            cx={portalGeo.coreCenter.x} cy={portalGeo.coreCenter.y}
            rx={portalGeo.coreRx} ry={portalGeo.coreRy}
            fill={isEntrance ? 'rgba(34,211,238,0.35)' : 'rgba(250,204,21,0.35)'}
          />
          {portalGeo.runePositions.map((rune, i) => (
            <g key={i} className="city-channel-portal-object__rune-group">
              <rect className="city-channel-portal-object__rune" x={rune.x - 2} y={rune.y - 3} width={4} height={6} rx={1} />
            </g>
          ))}
          {portalGeo.particles.map((p, i) => (
            <circle
              key={i} className="city-channel-portal-object__particle"
              cx={p.x} cy={p.y} r={1.5}
              style={{ animationDelay: `${p.delay}s` }}
            />
          ))}
        </svg>
      </div>
    );
  };

  const selectionAuraItems = useMemo(() => {
    const tileItems = selectedCells.map((cell) => {
      const cellKey = createCellKey(cell.x, cell.y, cell.z);
      const tile = mapData.tiles[cellKey];
      if (!tile) return null;
      return {
        id: `selection-aura:tile:${cellKey}`,
        kind: 'tile',
        cell,
        tile,
        projection: projectCell(cell, cameraYaw)
      };
    }).filter(Boolean);

    const wallItems = selectedWalls.map((selectedWall) => {
      const wallKey = createWallSelectionKey(selectedWall);
      const wall = mapData.walls?.[wallKey];
      if (!wall) return null;
      return {
        id: `selection-aura:wall:${wallKey}`,
        kind: 'wall',
        cell: {
          x: selectedWall.x,
          y: selectedWall.y,
          z: selectedWall.z
        },
        wall,
        projection: projectCell(selectedWall, cameraYaw)
      };
    }).filter(Boolean);

    return [...tileItems, ...wallItems];
  }, [cameraYaw, mapData.tiles, mapData.walls, selectedCells, selectedWalls]);

  const renderSelectionAura = (item) => {
    const tile = item.tile || null;
    const wall = item.wall || null;
    const tileGeometry = tile
      ? getTileGeometry(cameraYaw, tile.rotation || 0)
      : getTileGeometry(cameraYaw, 0);
    const wallGeometry = wall ? createEdgeWallGeometry(cameraYaw, wall.edge) : null;
    const portalGeometry = tile && isPortalPanelType(tile.panelType)
      ? getPortalGeometry(cameraYaw, tile.rotation || 0)
      : null;
    const mechGeo = tile?.mechanismModel
      ? getMechanismGeometry(tile.mechanismModel, tile.connectors, tile.rotation || 0, cameraYaw)
      : null;
    const isVerticalTile = !!tile && shouldUseVerticalOutline(tile);

    return (
      <div
        key={item.id}
        className={[
          'city-channel-selection-aura',
          item.kind === 'wall' ? 'is-wall-aura' : 'is-tile-aura',
          isVerticalTile ? 'is-vertical-aura' : ''
        ].filter(Boolean).join(' ')}
        style={{
          left: `${item.projection.left}px`,
          top: `${item.projection.top}px`
        }}
        aria-hidden="true"
      >
        <svg
          className="city-channel-selection-aura__svg"
          viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}
        >
          {tile ? (
            <>
              {tileGeometry.sides.map((points, index) => (
                <polygon
                  key={`selection-side-${index}`}
                  className="city-channel-selection-aura__surface is-muted"
                  points={points}
                />
              ))}
              <polygon className="city-channel-selection-aura__surface" points={tileGeometry.top} />
            </>
          ) : null}

          {tile && isVerticalTile ? (
            <>
              <polygon className="city-channel-selection-aura__surface is-outline-only" points={tileGeometry.wall} />
              <polygon className="city-channel-selection-aura__surface is-outline-only" points={tileGeometry.wallSideStart} />
              <polygon className="city-channel-selection-aura__surface is-outline-only" points={tileGeometry.wallSideEnd} />
              <polygon className="city-channel-selection-aura__surface is-outline-only" points={tileGeometry.wallCap} />
            </>
          ) : null}

          {wallGeometry ? (
            <>
              <polygon className="city-channel-selection-aura__surface is-outline-only" points={wallGeometry.wall} />
              <polygon className="city-channel-selection-aura__surface is-outline-only" points={wallGeometry.wallSideStart} />
              <polygon className="city-channel-selection-aura__surface is-outline-only" points={wallGeometry.wallSideEnd} />
              <polygon className="city-channel-selection-aura__surface is-outline-only" points={wallGeometry.wallCap} />
            </>
          ) : null}

          {portalGeometry ? (
            <>
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.threshold.frontFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.threshold.sideFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.threshold.topFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.leftPillar.frontFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.leftPillar.sideFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.leftPillar.topFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.rightPillar.frontFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.rightPillar.sideFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.rightPillar.topFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.lintel.frontFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.lintel.sideFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.lintel.topFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.arch.frontFace} />
              <polygon className="city-channel-selection-aura__detail" points={portalGeometry.arch.topFace} />
              <ellipse
                className="city-channel-selection-aura__node"
                cx={portalGeometry.coreCenter.x}
                cy={portalGeometry.coreCenter.y}
                rx={portalGeometry.coreRx + 4}
                ry={portalGeometry.coreRy + 4}
              />
            </>
          ) : null}

          {mechGeo?.polygons?.map((poly, index) => (
            <polygon
              key={`selection-mech-${index}`}
              className="city-channel-selection-aura__detail"
              points={poly.points}
            />
          ))}

          {mechGeo?.connectorPositions?.map((connector) => (
            <circle
              key={`selection-connector-${connector.id}`}
              className="city-channel-selection-aura__node"
              cx={connector.screenX}
              cy={connector.screenY}
              r={6}
            />
          ))}
        </svg>
      </div>
    );
  };


  return (
    <div
      className={[
        'city-channel-immersive',
        'has-palette',
        isWallPerspectiveMode ? 'is-wall-transparent' : '',
        isWallSolidMode ? 'is-wall-solid' : '',
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

      <div
        ref={viewportRef}
        className={`city-channel-viewport ${isPanning ? 'is-panning' : ''}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
      >
        <div
          className="city-channel-world"
          style={{ transform: `translate(calc(50vw + ${offset.x}px), calc(50vh + ${offset.y}px)) scale(${zoom})` }}
        >
          {sceneItems.map((item) => {
            const cellKey = createCellKey(item.cell.x, item.cell.y, item.cell.z);
            const partType = item.part?.partType || 'editor_overlay';
            const tile = item.tile || null;
            const wall = item.wall || null;
            const isGhost = !!item.isGhost;
            const key = isGhost
              ? item.id
              : (item.part?.id || `${item.kind}:${cellKey}:${partType}`);
            const ghostClass = isGhost
              ? `city-channel-ghost ${item.ghost?.valid === false ? 'is-invalid' : (item.ghost?.mode === 'move' ? 'is-move-valid' : 'is-valid')} ${item.ghost?.mode === 'move' ? 'is-moving-selection' : ''}`
              : '';
            const isHint = item.kind === 'hint';
            const tileClass = tile ? getPanelClass(tile.panelType) : '';
            const tileGeometry = tile ? getTileGeometry(cameraYaw, tile.rotation || 0) : getTileGeometry(cameraYaw, 0);
            const wallGeometry = wall ? createEdgeWallGeometry(cameraYaw, wall.edge) : null;
            const portalGeometry = tile && isPortalPanelType(tile.panelType) ? getPortalGeometry(cameraYaw, tile.rotation || 0) : null;
            const mechGeo = tile?.mechanismModel
              ? getMechanismGeometry(tile.mechanismModel, tile.connectors, tile.rotation || 0, cameraYaw)
              : null;
            const entrance = tile ? findPointAtCell(mapData.entrances, item.cell) : null;
            const exit = tile ? findPointAtCell(mapData.exits, item.cell) : null;
            const isRoute = tile ? routeKeySet.has(cellKey) : false;
            const isCarryOrigin = tile && carryState && selectedCellKeySet.has(cellKey);
            const isWallCarryOrigin = wall && carryState && selectedWallKeySet.has(createWallSelectionKey({
              x: item.cell.x,
              y: item.cell.y,
              z: item.cell.z,
              edge: wall.edge
            }));
            const isTilePlacementSelected = item.kind === 'tile' && selectedCellKeySet.has(cellKey);
            const isTileVertical = !!tile && shouldUseVerticalOutline(tile);
            const isTileHovered = hoverVerticalTarget
              && !hoverVerticalTarget.edge
              && item.cell.x === hoverVerticalTarget.cell?.x
              && item.cell.y === hoverVerticalTarget.cell?.y
              && item.cell.z === hoverVerticalTarget.cell?.z;
            const isWallHovered = wall && hoverVerticalTarget
              && hoverVerticalTarget.edge === wall.edge
              && item.cell.x === hoverVerticalTarget.cell?.x
              && item.cell.y === hoverVerticalTarget.cell?.y
              && item.cell.z === hoverVerticalTarget.cell?.z;
            const tileVerticalHoverClass = isTileHovered && isTileVertical
              ? (hoverVerticalTarget.hitZone === 'base' ? 'is-vertical-base-hover' : 'is-vertical-outline-hover')
              : '';
            const wallVerticalHoverClass = isWallHovered
              ? (hoverVerticalTarget.hitZone === 'base' ? 'is-vertical-base-hover' : 'is-vertical-outline-hover')
              : '';
            const commonStyle = {
              left: `${item.projection.left}px`,
              top: `${item.projection.top}px`,
              zIndex: item.renderOrder
            };

            if (isHint) {
              return (
                <button
                  key={key}
                  type="button"
                  className="city-channel-build-item is-hint"
                  style={commonStyle}
                  onPointerDown={(e) => e.preventDefault()}
                  aria-label={`提示格点 ${item.cell.x},${item.cell.y}`}
                >
                  <svg className="city-channel-build-item__block" viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`} aria-hidden="true">
                    {tileGeometry.sides.map((points, index) => (
                      <polygon key={points} className={`city-channel-block-side side-${index + 1}`} points={points} />
                    ))}
                    <polygon className="city-channel-block-top" points={tileGeometry.top} />
                  </svg>
                </button>
              );
            }

            if (partType === 'portal_body' && tile && portalGeometry) {
              return (
                <div
                  key={key}
                  className={`${isGhost ? ghostClass : 'city-channel-build-item'} city-channel-portal-render-layer ${tile.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE ? 'is-entrance-tile' : 'is-exit-tile'} ${isTilePlacementSelected && !isGhost ? 'is-selected' : ''}`}
                  style={commonStyle}
                  aria-hidden="true"
                >
                  {renderPortalObject(tile, tile.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE)}
                </div>
              );
            }

            if (partType === 'mechanism_connector' && mechGeo) {
              return (
                <div
                  key={key}
                  className={`${isGhost ? ghostClass : 'city-channel-build-item'} city-channel-mechanism-connectors ${isTilePlacementSelected && !isGhost ? 'is-selected' : ''} ${isTileVertical ? 'city-channel-tile--vertical-connector' : ''}`}
                  style={commonStyle}
                  aria-hidden="true"
                >
                  <svg className={`city-channel-mechanism-group ${isTileVertical ? 'city-channel-tile--vertical-mechanism-outline' : ''}`} viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}>
                    {mechGeo.connectorPositions.map((conn) => (
                      <circle
                        key={conn.id}
                        className={`city-channel-connector-node is-${conn.direction} ${isTileVertical && conn.screenY < tileGeometry.verticalBaseY ? 'is-outline-zone' : 'is-base-zone'}`}
                        cx={conn.screenX}
                        cy={conn.screenY}
                        r={4}
                      >
                        <title>{conn.label}</title>
                      </circle>
                    ))}
                  </svg>
                </div>
              );
            }

            if ((partType === 'floor_attachment' || partType === 'wall_attachment') && mechGeo) {
              const isVerticalAttachment = partType === 'wall_attachment' && isTileVertical;
              const AttachmentTag = isGhost ? 'div' : 'button';
              return (
                <AttachmentTag
                  key={key}
                  type={isGhost ? undefined : 'button'}
                  className={[
                    isGhost ? ghostClass : 'city-channel-build-item',
                    tileClass,
                    'has-mechanical-module',
                    isVerticalAttachment ? 'is-vertical' : '',
                    isVerticalAttachment ? 'city-channel-tile--vertical' : '',
                    isTilePlacementSelected && !isGhost ? 'is-selected' : '',
                    isCarryOrigin && !isGhost ? 'is-move-origin' : '',
                    tile?.marker === 'highlight' && !isGhost ? 'is-user-marked' : '',
                    tile?.flipped && !isGhost ? 'is-flipped' : '',
                    isWallPerspectiveMode && isWallMaterial(tile?.panelType) && !isGhost ? 'is-transparent-wall' : ''
                  ].filter(Boolean).join(' ')}
                  style={{
                    ...commonStyle,
                    '--tile-rotation': `${tile?.rotation || 0}deg`
                  }}
                  onPointerDown={isGhost ? undefined : (e) => e.preventDefault()}
                  aria-label={isGhost ? undefined : `机关 ${item.cell.x},${item.cell.y}`}
                  aria-hidden={isGhost ? 'true' : undefined}
                >
                  <svg
                    className={`city-channel-mechanism-group ${isVerticalAttachment ? 'city-channel-tile--vertical-mechanism-outline' : ''}`}
                    viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}
                    aria-hidden="true"
                  >
                    {mechGeo.polygons.map((poly, pi) => {
                      const isBasePart = !isVerticalAttachment || polygonAverageY(poly.points) >= tileGeometry.verticalBaseY;
                      return (
                        <polygon
                          key={pi}
                          className={`city-channel-mechanism-polygon is-${poly.face} ${isBasePart ? 'is-base-zone' : 'is-outline-zone'}`}
                          points={poly.points}
                          fill={isVerticalAttachment && !isBasePart ? 'transparent' : poly.fill}
                          stroke={poly.stroke}
                          opacity={isVerticalAttachment && !isBasePart ? 0.28 : poly.opacity}
                        />
                      );
                    })}
                  </svg>
                </AttachmentTag>
              );
            }

            if (partType === 'wall_plane') {
              if (wallGeometry && wall) {
                const isWallSelected = selectedWallKeySet.has(createWallSelectionKey({
                  x: item.cell.x,
                  y: item.cell.y,
                  z: item.cell.z,
                  edge: wall.edge
                }));
                const fadeMaskId = `vfade-ew-${item.cell.x}-${item.cell.y}-${wall.edge}`;
                const fadeGradId = `vfadegrad-ew-${item.cell.x}-${item.cell.y}-${wall.edge}`;
                const wallFadeMask = isWallSolidMode ? undefined : `url(#${fadeMaskId})`;
                return (
                  <div
                    key={key}
                    className={[
                      isGhost ? ghostClass : 'city-channel-build-item',
                      'has-tile',
                      'is-wall',
                      wall.panelType === CITY_CHANNEL_TILE_TYPES.GLASS_WALL ? 'is-glass-wall' : '',
                      'is-edge-wall',
                      'is-vertical',
                      'city-channel-tile--vertical',
                      wall.flipped && !isGhost ? 'is-flipped' : '',
                      isWallSelected && !isGhost ? 'is-selected' : '',
                      isWallCarryOrigin && !isGhost ? 'is-move-origin' : '',
                      isWallPerspectiveMode && !isGhost ? 'is-transparent-wall' : '',
                      !isGhost ? wallVerticalHoverClass : ''
                    ].filter(Boolean).join(' ')}
                    style={{
                      ...commonStyle,
                      '--tile-rotation': `${wall.rotation || 0}deg`
                    }}
                    aria-label={isGhost ? undefined : `墙板 ${item.cell.x},${item.cell.y} ${wall.edge}`}
                    aria-hidden={isGhost ? 'true' : undefined}
                  >
                    <svg
                      className="city-channel-build-item__block"
                      viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}
                      aria-hidden="true"
                    >
                      {!isWallSolidMode ? (
                        <defs>
                          <linearGradient
                            id={fadeGradId}
                            gradientUnits="userSpaceOnUse"
                            x1="80"
                            y1={wallGeometry.wallFadeStartY}
                            x2="80"
                            y2={wallGeometry.wallFadeEndY}
                          >
                            <stop offset="0%" stopColor="white" stopOpacity="0" />
                            <stop offset="18%" stopColor="white" stopOpacity="0.24" />
                            <stop offset="56%" stopColor="white" stopOpacity="0.82" />
                            <stop offset="100%" stopColor="white" stopOpacity="1" />
                          </linearGradient>
                          <mask id={fadeMaskId}>
                            <rect x="0" y="0" width={TILE_RENDER_WIDTH} height={TILE_RENDER_HEIGHT} fill={`url(#${fadeGradId})`} />
                          </mask>
                        </defs>
                      ) : null}
                      <g className="city-channel-vertical-outline">
                        <polygon className="city-channel-block-wall city-channel-tile--vertical-outline" points={wallGeometry.wall} />
                        <polygon className="city-channel-block-wall-side city-channel-tile--vertical-outline" points={wallGeometry.wallSideStart} />
                        <polygon className="city-channel-block-wall-side city-channel-tile--vertical-outline" points={wallGeometry.wallSideEnd} />
                        <polygon className="city-channel-block-wall-cap city-channel-tile--vertical-outline" points={wallGeometry.wallCap} />
                      </g>
                      <polygon className="city-channel-block-wall city-channel-wall-opacity-gradient" points={wallGeometry.wall} mask={wallFadeMask} />
                      <polygon className="city-channel-block-wall-side city-channel-wall-opacity-gradient" points={wallGeometry.wallSideStart} mask={wallFadeMask} />
                      <polygon className="city-channel-block-wall-side city-channel-wall-opacity-gradient" points={wallGeometry.wallSideEnd} mask={wallFadeMask} />
                      {isWallSolidMode ? (
                        <polygon className="city-channel-block-wall-cap city-channel-wall-opacity-gradient" points={wallGeometry.wallCap} />
                      ) : null}
                    </svg>
                  </div>
                );
              }

              if (tile && isTileVertical) {
                const isTileWallSelected = selectedCellKeySet.has(cellKey);
                const tileWallMaskId = `vfade-tw-${item.cell.x}-${item.cell.y}`;
                const tileWallGradId = `vfadegrad-tw-${item.cell.x}-${item.cell.y}`;
                const tileWallFadeMask = isWallSolidMode ? undefined : `url(#${tileWallMaskId})`;
                const TileWallTag = isGhost ? 'div' : 'button';
                return (
                  <TileWallTag
                    key={key}
                    type={isGhost ? undefined : 'button'}
                    className={[
                      isGhost ? ghostClass : 'city-channel-build-item',
                      'has-tile',
                      tileClass,
                      'is-wall',
                      'is-vertical',
                      'city-channel-tile--vertical',
                      isTileWallSelected && !isGhost ? 'is-selected' : '',
                      !isGhost ? tileVerticalHoverClass : '',
                      isWallPerspectiveMode && isWallMaterial(tile?.panelType) && !isGhost ? 'is-transparent-wall' : ''
                    ].filter(Boolean).join(' ')}
                    style={{
                      ...commonStyle,
                      '--tile-rotation': `${tile?.rotation || 0}deg`
                    }}
                    onPointerDown={isGhost ? undefined : (e) => e.preventDefault()}
                    aria-label={isGhost ? undefined : `墙板 ${item.cell.x},${item.cell.y}`}
                    aria-hidden={isGhost ? 'true' : undefined}
                  >
                    <svg
                      className="city-channel-build-item__block"
                      viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}
                      aria-hidden="true"
                    >
                      {!isWallSolidMode ? (
                        <defs>
                          <linearGradient
                            id={tileWallGradId}
                            gradientUnits="userSpaceOnUse"
                            x1="80"
                            y1={tileGeometry.wallFadeStartY}
                            x2="80"
                            y2={tileGeometry.wallFadeEndY}
                          >
                            <stop offset="0%" stopColor="white" stopOpacity="0" />
                            <stop offset="18%" stopColor="white" stopOpacity="0.24" />
                            <stop offset="56%" stopColor="white" stopOpacity="0.82" />
                            <stop offset="100%" stopColor="white" stopOpacity="1" />
                          </linearGradient>
                          <mask id={tileWallMaskId}>
                            <rect x="0" y="0" width={TILE_RENDER_WIDTH} height={TILE_RENDER_HEIGHT} fill={`url(#${tileWallGradId})`} />
                          </mask>
                        </defs>
                      ) : null}
                      <g className="city-channel-vertical-outline">
                        <polygon className="city-channel-block-wall city-channel-tile--vertical-outline" points={tileGeometry.wall} />
                        <polygon className="city-channel-block-wall-side city-channel-tile--vertical-outline" points={tileGeometry.wallSideStart} />
                        <polygon className="city-channel-block-wall-side city-channel-tile--vertical-outline" points={tileGeometry.wallSideEnd} />
                        <polygon className="city-channel-block-wall-cap city-channel-tile--vertical-outline" points={tileGeometry.wallCap} />
                      </g>
                      <polygon className="city-channel-block-wall city-channel-wall-opacity-gradient" points={tileGeometry.wall} mask={tileWallFadeMask} />
                      <polygon className="city-channel-block-wall-side city-channel-wall-opacity-gradient" points={tileGeometry.wallSideStart} mask={tileWallFadeMask} />
                      <polygon className="city-channel-block-wall-side city-channel-wall-opacity-gradient" points={tileGeometry.wallSideEnd} mask={tileWallFadeMask} />
                      {isWallSolidMode ? (
                        <polygon className="city-channel-block-wall-cap city-channel-wall-opacity-gradient" points={tileGeometry.wallCap} />
                      ) : null}
                    </svg>
                  </TileWallTag>
                );
              }
            }

            const tileBaseClass = tile ? getPanelClass(tile.panelType) : '';
            const TileBaseTag = isGhost ? 'div' : 'button';
            return (
              <TileBaseTag
                key={key}
                type={isGhost ? undefined : 'button'}
                className={[
                  isGhost ? ghostClass : 'city-channel-build-item',
                  'has-tile',
                  tileBaseClass,
                  entrance && !isGhost ? 'has-entrance' : '',
                  exit && !isGhost ? 'has-exit' : '',
                  isRoute && !isGhost ? 'is-route' : '',
                  isTilePlacementSelected && !isGhost ? 'is-selected' : '',
                  isCarryOrigin && !isGhost ? 'is-move-origin' : '',
                  tile?.marker === 'highlight' && !isGhost ? 'is-user-marked' : '',
                  tile?.flipped && !isGhost ? 'is-flipped' : '',
                  tile?.mechanismModel ? 'has-mechanical-module' : '',
                  isTileVertical ? 'is-vertical' : '',
                  isTileVertical ? 'city-channel-tile--vertical' : '',
                  !isGhost ? tileVerticalHoverClass : '',
                  isWallPerspectiveMode && isWallMaterial(tile?.panelType) && !isGhost ? 'is-transparent-wall' : ''
                ].filter(Boolean).join(' ')}
                style={{
                  ...commonStyle,
                  '--tile-rotation': `${tile?.rotation || 0}deg`
                }}
                onPointerDown={isGhost ? undefined : (e) => e.preventDefault()}
                aria-label={isGhost ? undefined : `格点 ${item.cell.x},${item.cell.y}`}
                aria-hidden={isGhost ? 'true' : undefined}
              >
                <svg
                  className="city-channel-build-item__block"
                  viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}
                  aria-hidden="true"
                >
                  {tileGeometry.sides.map((points, index) => (
                    <polygon key={points} className={`city-channel-block-side side-${index + 1}`} points={points} />
                  ))}
                  <polygon className="city-channel-block-top" points={tileGeometry.top} />
                </svg>
                {showCoordinates && item.kind === 'tile' && partType === 'floor_base' && (
                  <span className="city-channel-coordinate">{`${item.cell.x},${item.cell.y}`}</span>
                )}
              </TileBaseTag>
            );
          })}
          {selectionAuraItems.map(renderSelectionAura)}
        </div>
      </div>

      {selectionBox ? (
        <div
          className="city-channel-selection-box"
          style={{
            left: `${selectionBox.left}px`,
            top: `${selectionBox.top}px`,
            width: `${selectionBox.width}px`,
            height: `${selectionBox.height}px`
          }}
          aria-hidden="true"
        />
      ) : null}

      {selectedPlacements.length > 0 && (
        <div className="city-channel-selection-actions" onPointerDown={(e) => e.stopPropagation()}>
          <span className="city-channel-selection-actions__count">{selectedPlacements.length}</span>
          <button type="button" className="city-channel-selection-action" onClick={startCarry} title="移动 (M)">
            <Move size={14} />
            <span>移动</span>
            <em className="city-channel-shortcut-hint">M</em>
          </button>
          <button type="button" className="city-channel-selection-action" onClick={() => rotatePlacements(selectedPlacements)} title="旋转 (滚轮↑)">
            <RotateCw size={14} />
            <span>旋转</span>
            <em className="city-channel-shortcut-hint">滚轮</em>
          </button>
          <button type="button" className="city-channel-selection-action" onClick={() => flipPlacements(selectedPlacements)} title="颠倒 (Space)">
            <Replace size={14} />
            <span>颠倒</span>
            <em className="city-channel-shortcut-hint">Space</em>
          </button>
          <button type="button" className="city-channel-selection-action is-danger" onClick={() => { deletePlacements(selectedPlacements); clearSelection(); }} title="删除 (Del)">
            <Trash2 size={14} />
            <span>删除</span>
            <em className="city-channel-shortcut-hint">Del</em>
          </button>
        </div>
      )}

      <div className="city-channel-hotbar" aria-label="物品栏">
        {TOOL_ITEMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`city-channel-hotbar__item ${activeTool === key ? 'is-active' : ''}`}
            onClick={() => {
              setSelectionModeOrigin(null);
              setPlaceReturnState(null);
              if (key === CITY_CHANNEL_TOOLS.BROWSE) {
                enterBrowseMode();
                return;
              }
              selectOperationTool(key);
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
          className={[
            'city-channel-hotbar__item',
            isWallPerspectiveMode ? 'is-active' : '',
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
          {isWallPerspectiveMode ? <EyeOff size={18} /> : <Eye size={18} />}
          <span>{wallViewModeConfig.label}</span>
        </button>
        <button type="button" className="city-channel-hotbar__item" onClick={runValidation} title="验证白通路">
          <Wand2 size={18} />
          <span>验证</span>
        </button>
        <button
          type="button"
          className={`city-channel-hotbar__item ${openPanel === 'settings' ? 'is-active' : ''}`}
          onClick={() => setOpenPanel((c) => c === 'settings' ? null : 'settings')}
          title="设置"
        >
          <Settings size={18} />
          <span>设置</span>
        </button>
      </div>

      <section className="city-channel-interaction-hints" aria-live="polite">
        <strong>{interactionHint.mode}</strong>
        <span>{interactionHint.mouse}</span>
        <span>{interactionHint.keyboard}</span>
        {isBrowseRotating && activeTool === CITY_CHANNEL_TOOLS.BROWSE ? (
          <em>按住旋转中</em>
        ) : null}
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
          <strong>{openPanel === 'settings' ? '设置' : FLOATING_PANELS.find((p) => p.key === openPanel)?.label}</strong>
          {openPanel === 'layers' && <p>当前 MVP 只开放 {activeLayerLabel}，后续再扩展多层通道。</p>}
          {openPanel === 'settings' && (
            <div className="city-channel-settings-list">
              <label>
                <input type="checkbox" checked={showHelperGrid} onChange={(e) => setShowHelperGrid(e.target.checked)} />
                显示辅助网格
              </label>
              <label>
                <input type="checkbox" checked={showCoordinates} onChange={(e) => setShowCoordinates(e.target.checked)} />
                显示坐标
              </label>
            </div>
          )}
        </aside>
      )}

      <footer className={`city-channel-immersive-status ${validationResult.ok ? 'is-ok' : ''}`}>
        <span>{toolLabelByKey[activeTool] || activeTool}</span>
        <span>{activeLayerLabel}</span>
        <span title={statusMessage}>{hoverStatusLabel}</span>
        <span>{`${Math.round(zoom * 100)}%`}</span>
        <span>{`${domainModel.stats.renderParts}渲染件`}</span>
        <span>{validationResult.ok ? '白通路✓' : '未验证'}</span>
      </footer>
    </div>
  );
};

export default CityChannelImmersiveEditor;
