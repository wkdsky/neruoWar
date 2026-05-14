import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  isValidCell,
  normalizeCityChannelMap
} from '../cityChannelSchema';
import { getCityChannelMaterial } from '../cityChannelCatalog';
import {
  TILE_RENDER_HEIGHT,
  TILE_RENDER_CENTER,
  TILE_RENDER_WIDTH,
  createEdgeWallGeometry,
  createPortalGeometry,
  createTileGeometry,
  detectNearestEdge,
  getNeighborCells,
  localToCell,
  pointInPolygon,
  projectCell,
  screenToLocal
} from './renderer/CityChannelGeometry';
import { getPlacementDepth } from './renderer/CityChannelDepth';
import CityChannelTextureCache, { getTextureYawBucket } from './renderer/CityChannelTextureCache';
import CityChannelRuntimeIndex from './runtime/CityChannelRuntimeIndex';
import { projectWorldOffset } from '../cityChannelGeometryUtils';
import {
  isTriggerMechanismTile,
  normalizeMechanismParams
} from '../cityChannelMechanismRuntime';

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.8;
const CAMERA_PAN_SPEED = 520;
const CAMERA_ROTATION_SPEED = 96;
const SELECTED_MOVE_HOLD_DELAY = 260;
const WALL_EDGE_SNAP_SCREEN_RADIUS = 40;
const DOUBLE_CLICK_MS = 320;
const DOUBLE_CLICK_DISTANCE = 22;
const PRESS_TRAVEL = 10;
const MOTION_RATIO = 2;
const VERTICAL_PUSH_TRAVEL = PRESS_TRAVEL * MOTION_RATIO;
const HORIZONTAL_PUSH_TRAVEL = PRESS_TRAVEL * MOTION_RATIO;
const EDGE_NEIGHBOR_OFFSETS = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 }
};

const normalizeCameraYaw = (yaw = 0) => ((yaw % 360) + 360) % 360;
const normalizeAngleDelta = (delta = 0) => ((delta + 540) % 360) - 180;

const isWallMaterial = (panelType) => (
  panelType === CITY_CHANNEL_TILE_TYPES.WALL || panelType === CITY_CHANNEL_TILE_TYPES.GLASS_WALL
);

const isPortalMaterial = (panelType) => (
  panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || panelType === CITY_CHANNEL_TILE_TYPES.EXIT
);

const createWallSelectionKey = (wall) => (
  wall ? createWallKey(wall.x, wall.y, wall.z, wall.edge) : ''
);

const sameCell = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;

const resolveMaterialName = (panelType) => getCityChannelMaterial(panelType)?.name || panelType || '未知物件';

const createLocalRect = ({ left, right, top, bottom } = {}) => ({
  left: Math.min(left, right),
  right: Math.max(left, right),
  top: Math.min(top, bottom),
  bottom: Math.max(top, bottom)
});

const rectsIntersect = (a, b) => !!a && !!b
  && a.left <= b.right
  && a.right >= b.left
  && a.top <= b.bottom
  && a.bottom >= b.top;

const rectContainsPoint = (rect, point) => !!rect && !!point
  && point.x >= rect.left
  && point.x <= rect.right
  && point.y >= rect.top
  && point.y <= rect.bottom;

const getPointBounds = (points = []) => {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return createLocalRect({
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys)
  });
};

const drawPolygonShape = (graphics, points = [], offsetX = 0, offsetY = 0) => {
  if (!Array.isArray(points) || points.length < 3) return;
  graphics.beginPath();
  graphics.moveTo(points[0].x + offsetX, points[0].y + offsetY);
  points.slice(1).forEach((point) => graphics.lineTo(point.x + offsetX, point.y + offsetY));
  graphics.closePath();
  graphics.fillPath();
  graphics.strokePath();
};

const drawLocalPolygon = (graphics, points = [], offsetX = 0, offsetY = 0) => {
  if (!Array.isArray(points) || points.length < 3) return;
  graphics.beginPath();
  graphics.moveTo(points[0].x + offsetX, points[0].y + offsetY);
  points.slice(1).forEach((point) => graphics.lineTo(point.x + offsetX, point.y + offsetY));
  graphics.closePath();
  graphics.fillPath();
  graphics.strokePath();
};

const createGearPoints = (outerRadius = 18, innerRadius = 13, teeth = 10) => {
  const points = [];
  const total = teeth * 2;
  for (let index = 0; index < total; index += 1) {
    const angle = ((Math.PI * 2) / total) * index;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    points.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    });
  }
  return points;
};

const rotateLocalPoint = (point, degrees = 0) => {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: (point.x * Math.cos(radians)) - (point.y * Math.sin(radians)),
    y: (point.x * Math.sin(radians)) + (point.y * Math.cos(radians))
  };
};

const drawGearShape = (graphics, cx, cy, outerRadius, innerRadius, teeth, angle = 0) => {
  const points = createGearPoints(outerRadius, innerRadius, teeth)
    .map((point) => rotateLocalPoint(point, angle));
  drawLocalPolygon(graphics, points, cx, cy);
};

const drawJoint = (graphics, x, y, radius = 4, fill = 0xf8fafc) => {
  graphics.fillStyle(0x020617, 0.9);
  graphics.fillCircle(x, y, radius + 2);
  graphics.lineStyle(1, 0xcbd5e1, 0.58);
  graphics.strokeCircle(x, y, radius + 2);
  graphics.fillStyle(fill, 0.92);
  graphics.fillCircle(x, y, radius);
};

const drawLink = (graphics, start, end, color = 0xcbd5e1, width = 4, alpha = 0.9) => {
  graphics.lineStyle(width + 2, 0x020617, 0.6);
  graphics.lineBetween(start.x, start.y, end.x, end.y);
  graphics.lineStyle(width, color, alpha);
  graphics.lineBetween(start.x, start.y, end.x, end.y);
};

const drawCoilSpring = (graphics, x, y1, y2, compression = 0) => {
  const turns = 5;
  const height = Math.max(10, y2 - y1);
  const amplitude = 5 - (compression * 1.6);
  const points = [];
  for (let index = 0; index <= turns * 2; index += 1) {
    const t = index / (turns * 2);
    points.push({
      x: x + (index % 2 === 0 ? -amplitude : amplitude),
      y: y1 + (height * t)
    });
  }
  graphics.lineStyle(2, 0x93c5fd, 0.72);
  graphics.beginPath();
  points.forEach((point, index) => {
    if (index === 0) graphics.moveTo(point.x, point.y);
    else graphics.lineTo(point.x, point.y);
  });
  graphics.strokePath();
};

const normalizeVector = (vector) => {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= 0.001) return { x: 1, y: 0 };
  return {
    x: vector.x / length,
    y: vector.y / length
  };
};

const distancePointToSegmentSquared = (point, start, end) => {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const wx = point.x - start.x;
  const wy = point.y - start.y;
  const lengthSquared = (vx * vx) + (vy * vy);
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((wx * vx) + (wy * vy)) / lengthSquared)) : 0;
  const px = start.x + (vx * t);
  const py = start.y + (vy * t);
  const dx = point.x - px;
  const dy = point.y - py;
  return (dx * dx) + (dy * dy);
};

const getRectCorners = (rect) => ([
  { x: rect.left, y: rect.top },
  { x: rect.right, y: rect.top },
  { x: rect.right, y: rect.bottom },
  { x: rect.left, y: rect.bottom }
]);

const getRectEdges = (rect) => {
  const corners = getRectCorners(rect);
  return [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]]
  ];
};

const getCross = (a, b, c) => ((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x));

const pointOnSegment = (point, start, end) => {
  const epsilon = 0.001;
  return Math.abs(getCross(start, end, point)) <= epsilon
    && point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.y >= Math.min(start.y, end.y) - epsilon
    && point.y <= Math.max(start.y, end.y) + epsilon;
};

const segmentsIntersect = (a1, a2, b1, b2) => {
  const d1 = getCross(a1, a2, b1);
  const d2 = getCross(a1, a2, b2);
  const d3 = getCross(b1, b2, a1);
  const d4 = getCross(b1, b2, a2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return pointOnSegment(b1, a1, a2)
    || pointOnSegment(b2, a1, a2)
    || pointOnSegment(a1, b1, b2)
    || pointOnSegment(a2, b1, b2);
};

const polygonIntersectsRect = (polygon = [], rect = null) => {
  if (!rect || !Array.isArray(polygon) || polygon.length < 3) return false;
  const polygonBounds = getPointBounds(polygon);
  if (!rectsIntersect(rect, polygonBounds)) return false;
  if (polygon.some((point) => rectContainsPoint(rect, point))) return true;
  if (getRectCorners(rect).some((point) => pointInPolygon(point, polygon))) return true;
  const rectEdges = getRectEdges(rect);
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (rectEdges.some(([rectStart, rectEnd]) => segmentsIntersect(start, end, rectStart, rectEnd))) return true;
  }
  return false;
};

const getPortalPolygons = (cameraYaw = 0, rotation = 0) => {
  const portal = createPortalGeometry(cameraYaw, rotation);
  return [
    portal.threshold.front,
    portal.threshold.side,
    portal.threshold.top,
    portal.leftPillar.front,
    portal.leftPillar.side,
    portal.leftPillar.top,
    portal.rightPillar.front,
    portal.rightPillar.side,
    portal.rightPillar.top,
    portal.lintel.front,
    portal.lintel.side,
    portal.lintel.top,
    portal.arch.front,
    portal.arch.top
  ].filter((polygon) => Array.isArray(polygon) && polygon.length >= 3);
};

export const createCityChannelPhaserScene = (Phaser, initialConfig = {}) => {
  return class CityChannelPhaserScene extends Phaser.Scene {
    constructor() {
      super({ key: 'CityChannelPhaserScene' });
      this.config = initialConfig;
      this.mapData = normalizeCityChannelMap(initialConfig.mapData || {});
      this.activeTool = initialConfig.activeTool || CITY_CHANNEL_TOOLS.BROWSE;
      this.activeTileType = initialConfig.activeTileType || null;
      this.activeRotation = initialConfig.activeRotation || 0;
      this.wallViewMode = initialConfig.wallViewMode || 'semi';
      this.showHelperGrid = !!initialConfig.showHelperGrid;
      this.showCoordinates = !!initialConfig.showCoordinates;
      this.panelPose = 'floor';
      this.cameraState = {
        offsetX: 0,
        offsetY: -40,
        zoom: 1,
        yaw: 0
      };
      this.selectedCells = [];
      this.selectedWalls = [];
      this.renderObjects = new Map();
      this.index = new CityChannelRuntimeIndex();
      this.dragState = null;
      this.hoverTarget = null;
      this.hoverCell = null;
      this.hoverEdge = 'north';
      this.paintStroke = null;
      this.carryState = null;
      this.longPressTimer = null;
      this.keyState = new Set();
      this.lastCameraNotifyAt = 0;
      this.textureYawBucket = getTextureYawBucket(this.cameraState.yaw);
      this.mechanismParams = initialConfig.mechanismParams || {};
      this.lastMechanismDown = null;
    }

    create() {
      this.textureCache = new CityChannelTextureCache(this);
      this.worldLayer = this.add.container(this.scale.width / 2, this.scale.height / 2 - 40);
      this.mapLayer = this.add.container(0, 0);
      this.routeLayer = this.add.graphics();
      this.helperLayer = this.add.graphics();
      this.selectionLayer = this.add.graphics();
      this.ghostLayer = this.add.graphics();
      this.debugText = null;

      this.worldLayer.add([this.mapLayer, this.routeLayer, this.helperLayer, this.selectionLayer, this.ghostLayer]);
      this.input.setTopOnly(false);
      this.input.on('pointerdown', this.handlePointerDown, this);
      this.input.on('pointermove', this.handlePointerMove, this);
      this.input.on('pointerup', this.handlePointerUp, this);
      this.input.on('wheel', this.handleWheel, this);
      this.input.mouse?.disableContextMenu();
      this.input.keyboard.on('keydown', this.handleKeyDown, this);
      this.input.keyboard.on('keyup', this.handleKeyUp, this);
      this.scale.on('resize', this.handleResize, this);
      this.events.on('shutdown', this.destroyScene, this);
      this.events.on('destroy', this.destroyScene, this);

      this.index.rebuild(this.mapData);
      this.renderMap({ full: true });
      this.updateCameraTransform();
      this.emitStatus();
      this.config.onSceneReady?.(this);
    }

    destroyScene() {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      this.textureCache?.destroy();
      this.input?.off('pointerdown', this.handlePointerDown, this);
      this.input?.off('pointermove', this.handlePointerMove, this);
      this.input?.off('pointerup', this.handlePointerUp, this);
      this.input?.off('wheel', this.handleWheel, this);
      this.input?.keyboard?.off('keydown', this.handleKeyDown, this);
      this.input?.keyboard?.off('keyup', this.handleKeyUp, this);
      this.scale?.off('resize', this.handleResize, this);
    }

    updateConfig(next = {}) {
      const previousMap = this.mapData;
      this.config = { ...this.config, ...next };
      if (next.mapData && next.mapData !== previousMap) {
        this.mapData = normalizeCityChannelMap(next.mapData);
        this.index.rebuild(this.mapData);
        this.renderMap({ full: true });
      }
      if (next.activeTool !== undefined) this.activeTool = next.activeTool;
      if (next.activeTileType !== undefined) this.activeTileType = next.activeTileType;
      if (next.activeRotation !== undefined) this.activeRotation = next.activeRotation;
      if (next.mechanismParams !== undefined) this.mechanismParams = next.mechanismParams || {};
      if (next.wallViewMode !== undefined && next.wallViewMode !== this.wallViewMode) {
        this.wallViewMode = next.wallViewMode;
        this.refreshWallTextures();
      }
      if (next.showHelperGrid !== undefined) {
        this.showHelperGrid = !!next.showHelperGrid;
        this.drawHelperLayer();
      }
      if (next.showCoordinates !== undefined) {
        this.showCoordinates = !!next.showCoordinates;
        this.renderMap({ full: true });
      }
      if (next.selection) {
        this.selectedCells = next.selection.cells || [];
        this.selectedWalls = next.selection.walls || [];
        this.drawSelectionLayer();
      }
    }

    handleResize(gameSize) {
      const width = gameSize?.width || this.scale.width;
      const height = gameSize?.height || this.scale.height;
      this.worldLayer.setPosition((width / 2) + this.cameraState.offsetX, (height / 2) + this.cameraState.offsetY);
    }

    renderMap() {
      this.mapLayer.removeAll(true);
      this.renderObjects.clear();
      Object.values(this.mapData.tiles || {}).forEach((tile) => this.renderTileObject(tile));
      Object.values(this.mapData.walls || {}).forEach((wall) => this.renderWallObject(wall));
      this.sortMapLayer();
      this.drawRouteLayer();
      this.drawHelperLayer();
      this.drawSelectionLayer();
      this.updateDebugText();
    }

    removeRenderObject(id) {
      const object = this.renderObjects.get(id);
      if (!object) return;
      this.renderObjects.delete(id);
      object.destroy();
    }

    removeTileObject(cell) {
      const key = createCellKey(cell.x, cell.y, cell.z);
      this.removeRenderObject(`tile:${key}`);
      this.removeRenderObject(`tile-label:${key}`);
      this.removeRenderObject(`mechanism:${key}`);
    }

    removeWallObject(wall) {
      this.removeRenderObject(`wall:${createWallKey(wall.x, wall.y, wall.z, wall.edge)}`);
    }

    renderTileObject(tile) {
      if (!tile) return;
      const key = createCellKey(tile.x, tile.y, tile.z);
      this.removeTileObject(tile);
      const cell = { x: tile.x, y: tile.y, z: tile.z };
      const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
      const texture = this.textureCache.getTileTexture(tile.panelType, tile.rotation || 0, !!tile.flipped, this.cameraState.yaw);
      const image = this.add.image(projection.x, projection.y, texture)
        .setOrigin(0.5, 0.57)
        .setAlpha(tile.transparent ? 0.72 : 1);
      const isPortal = isPortalMaterial(tile.panelType);
      const depth = getPlacementDepth({
        cell,
        partType: isPortal ? 'portal_body' : tile.isVertical ? 'wall_plane' : 'floor_base',
        physicalLayer: isPortal ? 'portal_body' : tile.isVertical ? 'wall_plane' : 'floor_base',
        rotation: tile.rotation || 0,
        cameraYaw: this.cameraState.yaw,
        mapData: this.mapData
      });
      image.setData('placementId', `tile:${key}`);
      image.setData('kind', 'tile');
      image.depth = depth;
      this.mapLayer.add(image);
      this.renderObjects.set(`tile:${key}`, image);
      if (isTriggerMechanismTile(tile.panelType)) {
        const mechanism = this.createMechanismObject(tile, key, depth + 0.35);
        if (mechanism) {
          this.mapLayer.add(mechanism);
          this.renderObjects.set(`mechanism:${key}`, mechanism);
        }
      }

      if (this.showCoordinates) {
        const label = this.add.text(projection.x, projection.y + 2, `${tile.x},${tile.y}`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#e0f2fe'
        }).setOrigin(0.5, 0.5).setAlpha(0.7);
        label.depth = depth + 1;
        this.mapLayer.add(label);
        this.renderObjects.set(`tile-label:${key}`, label);
      }
    }

    renderWallObject(wall) {
      if (!wall) return;
      const id = `wall:${createWallKey(wall.x, wall.y, wall.z, wall.edge)}`;
      this.removeRenderObject(id);
      const cell = { x: wall.x, y: wall.y, z: wall.z };
      const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
      const texture = this.textureCache.getWallTexture(wall.panelType, wall.edge, this.wallViewMode, this.cameraState.yaw);
      const image = this.add.image(projection.x, projection.y, texture).setOrigin(0.5, 0.57);
      image.setData('placementId', id);
      image.setData('kind', 'wall');
      image.depth = getPlacementDepth({
        cell,
        partType: 'wall_plane',
        physicalLayer: 'wall_plane',
        edge: wall.edge,
        rotation: wall.rotation || 0,
        cameraYaw: this.cameraState.yaw,
        mapData: this.mapData
      });
      this.mapLayer.add(image);
      this.renderObjects.set(id, image);
    }

    createMechanismObject(tile, key, depth) {
      const cell = { x: tile.x, y: tile.y, z: tile.z };
      const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
      const container = this.add.container(projection.x, projection.y);
      container.depth = depth;
      container.setData('placementId', `mechanism:${key}`);
      container.setData('kind', 'mechanism');
      container.setData('cellKey', key);
      container.setData('panelType', tile.panelType);

      const graphics = this.add.graphics();
      container.add(graphics);
      const runtime = {
        graphics,
        state: { progress: 0 }
      };
      container.setData('runtime', runtime);
      this.drawMechanismState(tile, runtime, 0, normalizeMechanismParams(this.mechanismParams?.[key]));
      return container;
    }

    getPressureCapPoints(tile, depression = 0) {
      const geometry = createTileGeometry(this.cameraState.yaw, tile.rotation || 0);
      return geometry.top.map((point) => ({
        x: point.x - TILE_RENDER_CENTER.x,
        y: point.y - TILE_RENDER_CENTER.y + depression
      }));
    }

    drawPressureCap(graphics, tile, progress = 0) {
      const depression = PRESS_TRAVEL * progress;
      const original = this.getPressureCapPoints(tile, 0);
      const lowered = this.getPressureCapPoints(tile, depression);
      if (progress > 0.02) {
        graphics.fillStyle(0x0f172a, 0.5);
        graphics.lineStyle(1, 0x38bdf8, 0.2);
        original.forEach((point, index) => {
          const nextIndex = (index + 1) % original.length;
          drawLocalPolygon(graphics, [
            point,
            original[nextIndex],
            lowered[nextIndex],
            lowered[index]
          ]);
        });
      }
      graphics.fillStyle(0x64748b, 0.96);
      graphics.lineStyle(2, progress > 0.02 ? 0x38bdf8 : 0xcbd5e1, progress > 0.02 ? 0.54 : 0.16);
      drawLocalPolygon(graphics, lowered);
      graphics.fillStyle(0x020617, 0.18);
      drawLocalPolygon(graphics, this.getPressureCapPoints(tile, depression + 3));
    }

    drawMechanismChamber(graphics) {
      graphics.fillStyle(0x020617, 0.72);
      graphics.lineStyle(1, 0x38bdf8, 0.24);
      graphics.fillEllipse(0, 31, 108, 44);
      graphics.strokeEllipse(0, 31, 108, 44);
      graphics.fillStyle(0x0f172a, 0.58);
      graphics.fillRoundedRect(-45, 16, 90, 30, 7);
      graphics.lineStyle(1, 0x475569, 0.46);
      graphics.strokeRoundedRect(-45, 16, 90, 30, 7);
    }

    drawTransmissionCore(graphics, progress = 0) {
      const inputTop = { x: -28, y: 1 + (PRESS_TRAVEL * progress) };
      const inputBottom = { x: -26, y: 26 + (PRESS_TRAVEL * progress) };
      const pivot = { x: -5, y: 31 };
      const leverAngle = -18 + (progress * 44);
      const leftArm = rotateLocalPoint({ x: -26, y: 0 }, leverAngle);
      const rightArm = rotateLocalPoint({ x: 34, y: 0 }, leverAngle);
      const leftJoint = { x: pivot.x + leftArm.x, y: pivot.y + leftArm.y };
      const rightJoint = { x: pivot.x + rightArm.x, y: pivot.y + rightArm.y };
      const pulley = { x: 33, y: 24 };

      drawCoilSpring(graphics, -40, 2, 24 + (PRESS_TRAVEL * progress * 0.35), progress);
      drawLink(graphics, inputTop, inputBottom, 0x93c5fd, 3, 0.86);
      drawLink(graphics, inputBottom, leftJoint, 0xa5b4fc, 3, 0.86);
      drawLink(graphics, leftJoint, rightJoint, 0xe2e8f0, 5, 0.9);
      drawJoint(graphics, pivot.x, pivot.y, 4, 0xfbbf24);
      drawJoint(graphics, leftJoint.x, leftJoint.y, 3, 0xbfdbfe);
      drawJoint(graphics, rightJoint.x, rightJoint.y, 3, 0xbfdbfe);

      graphics.lineStyle(3, 0xf8fafc, 0.72);
      graphics.strokeCircle(pulley.x, pulley.y, 11);
      graphics.lineStyle(2, 0x94a3b8, 0.72);
      const pulleyAngle = progress * 220;
      const spokeA = rotateLocalPoint({ x: 10, y: 0 }, pulleyAngle);
      const spokeB = rotateLocalPoint({ x: 0, y: 10 }, pulleyAngle);
      graphics.lineBetween(pulley.x - spokeA.x, pulley.y - spokeA.y, pulley.x + spokeA.x, pulley.y + spokeA.y);
      graphics.lineBetween(pulley.x - spokeB.x, pulley.y - spokeB.y, pulley.x + spokeB.x, pulley.y + spokeB.y);
      graphics.lineStyle(2, 0xfde68a, 0.88);
      graphics.lineBetween(rightJoint.x, rightJoint.y, pulley.x - 10, pulley.y);
      return { rightJoint, pulley };
    }

    drawLinearOutput(graphics, tile, progress = 0, horizontal = false) {
      const outputTravel = (horizontal ? HORIZONTAL_PUSH_TRAVEL : VERTICAL_PUSH_TRAVEL) * progress;
      if (!horizontal) {
        const socket = { x: 28, y: 26 };
        graphics.lineStyle(2, 0xfde68a, 0.88);
        graphics.lineBetween(socket.x, socket.y - 8, socket.x, socket.y + outputTravel);
        graphics.fillStyle(0x155e75, 0.92);
        graphics.fillRoundedRect(socket.x - 8, socket.y + outputTravel - 2, 16, 28, 5);
        graphics.fillStyle(0xa5f3fc, 0.82);
        graphics.fillEllipse(socket.x, socket.y + outputTravel - 3, 22, 8);
        graphics.lineStyle(1, 0x67e8f9, 0.34);
        graphics.strokeRoundedRect(socket.x - 12, socket.y - 9, 24, 42 + outputTravel, 6);
        return;
      }

      const projected = projectWorldOffset(
        Math.cos(((tile.rotation || 0) * Math.PI) / 180),
        Math.sin(((tile.rotation || 0) * Math.PI) / 180),
        this.cameraState.yaw
      );
      const direction = normalizeVector(projected);
      const normal = { x: -direction.y, y: direction.x };
      const base = { x: 14, y: 28 };
      const tip = {
        x: base.x + (direction.x * outputTravel),
        y: base.y + (direction.y * outputTravel)
      };
      const width = 8;
      const piston = [
        { x: base.x + (normal.x * width), y: base.y + (normal.y * width) },
        { x: tip.x + (normal.x * width), y: tip.y + (normal.y * width) },
        { x: tip.x - (normal.x * width), y: tip.y - (normal.y * width) },
        { x: base.x - (normal.x * width), y: base.y - (normal.y * width) }
      ];
      graphics.fillStyle(0x155e75, 0.9);
      graphics.lineStyle(1, 0x67e8f9, 0.36);
      drawLocalPolygon(graphics, piston);
      graphics.fillStyle(0xa5f3fc, 0.82);
      graphics.fillCircle(tip.x, tip.y, 6);
      graphics.lineStyle(2, 0xfde68a, 0.82);
      graphics.lineBetween(32, 24, base.x, base.y);
    }

    drawRotaryTransmission(graphics, progress = 0, params = {}) {
      const inputY = 2 + (PRESS_TRAVEL * progress);
      const driveAngle = progress * 180;
      const outputAngle = progress * (params.rotationAngle || 90);
      graphics.lineStyle(3, 0x93c5fd, 0.86);
      graphics.lineBetween(-30, inputY, -30, 34);
      graphics.fillStyle(0xcbd5e1, 0.78);
      for (let index = 0; index < 5; index += 1) {
        graphics.fillRect(-24, 8 + (index * 5) + (progress * 3), 9, 2);
      }
      graphics.fillStyle(0xd97706, 0.88);
      graphics.lineStyle(2, 0xfef3c7, 0.54);
      drawGearShape(graphics, -5, 31, 14, 10, 8, driveAngle);
      graphics.fillStyle(0xf59e0b, 0.9);
      drawGearShape(graphics, 29, 29, 21, 15, 12, -outputAngle);
      graphics.lineStyle(3, 0xfde68a, 0.7);
      graphics.strokeEllipse(12, 30, 55, 26);
      const crank = rotateLocalPoint({ x: 18, y: 0 }, -outputAngle);
      drawLink(graphics, { x: 29, y: 29 }, { x: 29 + crank.x, y: 29 + crank.y }, 0xfef3c7, 3, 0.86);
      drawJoint(graphics, 29, 29, 4, 0xfbbf24);
      drawJoint(graphics, 29 + crank.x, 29 + crank.y, 3, 0xfef3c7);
    }

    drawMechanismState(tile, runtime, progress = 0, params = {}) {
      const graphics = runtime.graphics;
      if (!graphics) return;
      const p = Math.max(0, Math.min(1, Number(progress) || 0));
      graphics.clear();
      this.drawMechanismChamber(graphics);
      if (tile.panelType === CITY_CHANNEL_TILE_TYPES.VERTICAL_PUSH_BUTTON) {
        this.drawTransmissionCore(graphics, p);
        this.drawLinearOutput(graphics, tile, p, false);
      } else if (tile.panelType === CITY_CHANNEL_TILE_TYPES.HORIZONTAL_PUSH_BUTTON) {
        this.drawTransmissionCore(graphics, p);
        this.drawLinearOutput(graphics, tile, p, true);
      } else if (tile.panelType === CITY_CHANNEL_TILE_TYPES.ROTARY_BUTTON) {
        this.drawRotaryTransmission(graphics, p, params);
      }
      this.drawPressureCap(graphics, tile, p);
    }

    sortMapLayer() {
      this.mapLayer.list.sort((a, b) => (a.depth || 0) - (b.depth || 0));
    }

    refreshAfterIncrementalEdit() {
      this.mapData.safeRoute = [];
      this.index.rebuild(this.mapData);
      this.sortMapLayer();
      this.drawRouteLayer();
      this.drawHelperLayer();
      this.drawSelectionLayer();
      this.updateDebugText();
    }

    refreshWallTextures() {
      Object.values(this.mapData.walls || {}).forEach((wall) => {
        const object = this.renderObjects.get(`wall:${createWallKey(wall.x, wall.y, wall.z, wall.edge)}`);
        if (!object) return;
        object.setTexture(this.textureCache.getWallTexture(wall.panelType, wall.edge, this.wallViewMode, this.cameraState.yaw));
      });
      Object.values(this.mapData.tiles || {}).forEach((tile) => {
        if (!tile.isVertical) return;
        const object = this.renderObjects.get(`tile:${createCellKey(tile.x, tile.y, tile.z)}`);
        if (!object) return;
        object.setTexture(this.textureCache.getTileTexture(tile.panelType, tile.rotation || 0, !!tile.flipped, this.cameraState.yaw));
      });
    }

    updateYaw(nextYaw) {
      this.cameraState.yaw = normalizeCameraYaw(nextYaw);
      const nextTextureYawBucket = getTextureYawBucket(this.cameraState.yaw);
      const shouldRefreshTextures = nextTextureYawBucket !== this.textureYawBucket;
      this.textureYawBucket = nextTextureYawBucket;
      Object.values(this.mapData.tiles || {}).forEach((tile) => {
        const key = createCellKey(tile.x, tile.y, tile.z);
        const object = this.renderObjects.get(`tile:${key}`);
        if (!object) return;
        const cell = { x: tile.x, y: tile.y, z: tile.z };
        const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
        object.setPosition(projection.x, projection.y);
        if (shouldRefreshTextures) {
          object.setTexture(this.textureCache.getTileTexture(tile.panelType, tile.rotation || 0, !!tile.flipped, this.cameraState.yaw));
        }
        const isPortal = isPortalMaterial(tile.panelType);
        const depth = getPlacementDepth({
          cell,
          partType: isPortal ? 'portal_body' : tile.isVertical ? 'wall_plane' : 'floor_base',
          physicalLayer: isPortal ? 'portal_body' : tile.isVertical ? 'wall_plane' : 'floor_base',
          rotation: tile.rotation || 0,
          cameraYaw: this.cameraState.yaw,
          mapData: this.mapData
        });
        object.depth = depth;
        const label = this.renderObjects.get(`tile-label:${key}`);
        if (label) {
          label.setPosition(projection.x, projection.y + 2);
          label.depth = depth + 1;
        }
        const mechanism = this.renderObjects.get(`mechanism:${key}`);
        if (mechanism) {
          if (shouldRefreshTextures && isTriggerMechanismTile(tile.panelType)) {
            this.removeRenderObject(`mechanism:${key}`);
            const nextMechanism = this.createMechanismObject(tile, key, depth + 0.35);
            if (nextMechanism) {
              this.mapLayer.add(nextMechanism);
              this.renderObjects.set(`mechanism:${key}`, nextMechanism);
            }
          } else {
            mechanism.setPosition(projection.x, projection.y);
            mechanism.depth = depth + 0.35;
          }
        }
      });
      Object.values(this.mapData.walls || {}).forEach((wall) => {
        const object = this.renderObjects.get(`wall:${createWallKey(wall.x, wall.y, wall.z, wall.edge)}`);
        if (!object) return;
        const cell = { x: wall.x, y: wall.y, z: wall.z };
        const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
        object.setPosition(projection.x, projection.y);
        if (shouldRefreshTextures) {
          object.setTexture(this.textureCache.getWallTexture(wall.panelType, wall.edge, this.wallViewMode, this.cameraState.yaw));
        }
        object.depth = getPlacementDepth({
          cell,
          partType: 'wall_plane',
          physicalLayer: 'wall_plane',
          edge: wall.edge,
          rotation: wall.rotation || 0,
          cameraYaw: this.cameraState.yaw,
          mapData: this.mapData
        });
      });
      this.sortMapLayer();
      this.drawRouteLayer();
      this.drawHelperLayer();
      this.drawSelectionLayer();
      this.drawGhostLayer();
      this.notifyCamera();
      this.updateDebugText();
    }

    updateCameraTransform() {
      this.worldLayer.setPosition(
        (this.scale.width / 2) + this.cameraState.offsetX,
        (this.scale.height / 2) + this.cameraState.offsetY
      );
      this.worldLayer.setScale(this.cameraState.zoom);
      this.notifyCamera();
    }

    notifyCamera() {
      const now = this.time?.now || Date.now();
      if (now - this.lastCameraNotifyAt < 100) return;
      this.lastCameraNotifyAt = now;
      this.config.onCameraChange?.({
        zoom: this.cameraState.zoom,
        yaw: Math.round(this.cameraState.yaw)
      });
    }

    update(time, delta) {
      if (this.keyState.size > 0) {
        const seconds = Math.min(0.05, Math.max(0, delta / 1000));
        const distance = CAMERA_PAN_SPEED * seconds;
        let dx = 0;
        let dy = 0;
        if (this.keyState.has('w')) dy += distance;
        if (this.keyState.has('s')) dy -= distance;
        if (this.keyState.has('a')) dx += distance;
        if (this.keyState.has('d')) dx -= distance;
        if (dx || dy) {
          this.cameraState.offsetX += dx;
          this.cameraState.offsetY += dy;
          this.updateCameraTransform();
        }
        if (this.keyState.has('q')) this.updateYaw(this.cameraState.yaw - (CAMERA_ROTATION_SPEED * seconds));
        if (this.keyState.has('e')) this.updateYaw(this.cameraState.yaw + (CAMERA_ROTATION_SPEED * seconds));
      }
    }

    toLocal(pointer) {
      return screenToLocal({
        x: pointer.x,
        y: pointer.y,
        worldX: this.worldLayer.x,
        worldY: this.worldLayer.y,
        zoom: this.cameraState.zoom
      });
    }

    getPointerRotationAngle(pointer) {
      const dx = pointer.x - this.worldLayer.x;
      const dy = pointer.y - this.worldLayer.y;
      if (Math.hypot(dx, dy) < 24) return null;
      return (Math.atan2(dy, dx) * 180) / Math.PI;
    }

    getPointerCell(pointer) {
      const localPoint = this.toLocal(pointer);
      const cell = localToCell({ x: localPoint.x, y: localPoint.y, cameraYaw: this.cameraState.yaw, mapData: this.mapData });
      return { localPoint, cell };
    }

    resolveWallSnapTarget(localPoint, seedCell = null) {
      if (!localPoint) return null;
      const candidateCells = new Map();
      const addCandidateCell = (cell) => {
        if (!cell || !isValidCell(cell.x, cell.y, cell.z, this.mapData)) return;
        candidateCells.set(createCellKey(cell.x, cell.y, cell.z), { x: cell.x, y: cell.y, z: cell.z });
      };
      if (seedCell) getNeighborCells(seedCell, this.mapData).forEach(addCandidateCell);
      Object.values(this.mapData.tiles || {}).forEach(addCandidateCell);

      const snapRadius = Math.max(28, WALL_EDGE_SNAP_SCREEN_RADIUS / Math.max(0.2, this.cameraState.zoom || 1));
      const snapRadiusSquared = snapRadius * snapRadius;
      let best = null;
      candidateCells.forEach((cell) => {
        ['north', 'south', 'east', 'west'].forEach((edge) => {
          if (!this.hasWallSupport(cell, edge)) return;
          const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
          const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
          const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
          const geometry = createEdgeWallGeometry(this.cameraState.yaw, edge);
          const start = {
            x: geometry.wall[0].x + offsetX,
            y: geometry.wall[0].y + offsetY
          };
          const end = {
            x: geometry.wall[1].x + offsetX,
            y: geometry.wall[1].y + offsetY
          };
          const distanceSquared = distancePointToSegmentSquared(localPoint, start, end);
          if (!best || distanceSquared < best.distanceSquared) {
            best = { cell, edge, distanceSquared };
          }
        });
      });
      return best && best.distanceSquared <= snapRadiusSquared
        ? { cell: best.cell, edge: best.edge }
        : null;
    }

    resolveWallPlacementTarget(hitInfo) {
      const snapped = hitInfo?.wallSnap || this.resolveWallSnapTarget(hitInfo?.localPoint, hitInfo?.cell);
      if (snapped?.cell) return snapped;
      return null;
    }

    resolveWallGhostTarget(hitInfo) {
      const placementTarget = this.resolveWallPlacementTarget(hitInfo);
      if (placementTarget?.cell) return placementTarget;
      const cell = hitInfo?.cell;
      if (!cell) return null;
      return {
        cell,
        edge: hitInfo.edge || 'north'
      };
    }

    hitTest(pointer, { allowOutline = false } = {}) {
      const { localPoint, cell } = this.getPointerCell(pointer);
      const needsWallSnap = this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && isWallMaterial(this.activeTileType);
      if (!cell) {
        return {
          cell: null,
          hit: null,
          edge: 'north',
          localPoint,
          wallSnap: needsWallSnap ? this.resolveWallSnapTarget(localPoint, null) : null
        };
      }
      const edge = detectNearestEdge({ localPoint, cell, cameraYaw: this.cameraState.yaw, mapData: this.mapData });
      const wallSnap = needsWallSnap ? this.resolveWallSnapTarget(localPoint, cell) : null;
      const candidates = [];
      getNeighborCells(cell, this.mapData).forEach((candidate) => {
        const tile = this.mapData.tiles?.[createCellKey(candidate.x, candidate.y, candidate.z)];
        if (tile) candidates.push({ kind: 'tile', cell: candidate, tile });
        ['north', 'south', 'east', 'west'].forEach((candidateEdge) => {
          const wall = this.mapData.walls?.[createWallKey(candidate.x, candidate.y, candidate.z, candidateEdge)];
          if (wall) candidates.push({ kind: 'wall', cell: candidate, wall, edge: candidateEdge });
        });
      });

      const hits = [];
      candidates.forEach((candidate) => {
        const projection = projectCell(candidate.cell, this.cameraState.yaw, this.mapData);
        const point = {
          x: localPoint.x - projection.x + (TILE_RENDER_WIDTH * 0.5),
          y: localPoint.y - projection.y + (TILE_RENDER_HEIGHT * 0.57)
        };
        if (candidate.kind === 'wall') {
          const geometry = createEdgeWallGeometry(this.cameraState.yaw, candidate.wall.edge);
          const inBase = pointInPolygon(point, geometry.wall) && point.y >= geometry.verticalBaseY;
          const inOutline = pointInPolygon(point, geometry.wall) || pointInPolygon(point, geometry.wallCap);
          if (!inBase && !(allowOutline && inOutline)) return;
          hits.push({
            type: 'wall',
            cell: candidate.cell,
            edge: candidate.wall.edge,
            panelType: candidate.wall.panelType,
            hitZone: inBase ? 'base' : 'outline',
            wall: candidate.wall,
            depth: getPlacementDepth({
              cell: candidate.cell,
              partType: 'wall_plane',
              physicalLayer: 'wall_plane',
              edge: candidate.wall.edge,
              cameraYaw: this.cameraState.yaw,
              mapData: this.mapData
            })
          });
          return;
        }

        const geometry = createTileGeometry(this.cameraState.yaw, candidate.tile.rotation || 0);
        const inTile = pointInPolygon(point, geometry.top) || geometry.sides.some((poly) => pointInPolygon(point, poly));
        const isPortal = isPortalMaterial(candidate.tile.panelType);
        const inPortal = isPortal && getPortalPolygons(this.cameraState.yaw, candidate.tile.rotation || 0)
          .some((polygon) => pointInPolygon(point, polygon));
        const inVertical = isPortal
          ? inPortal
          : candidate.tile.isVertical && (pointInPolygon(point, geometry.wall) || pointInPolygon(point, geometry.wallCap));
        if (!inTile && !inVertical) return;
        const hitZone = isPortal && inPortal
          ? 'base'
          : candidate.tile.isVertical && point.y < geometry.verticalBaseY && inVertical ? 'outline' : 'base';
        if (hitZone === 'outline' && !allowOutline) return;
        hits.push({
          type: 'tile',
          cell: candidate.cell,
          panelType: candidate.tile.panelType,
          hitZone,
          tile: candidate.tile,
          depth: getPlacementDepth({
            cell: candidate.cell,
            partType: isPortal ? 'portal_body' : candidate.tile.isVertical ? 'wall_plane' : 'floor_base',
            physicalLayer: isPortal ? 'portal_body' : candidate.tile.isVertical ? 'wall_plane' : 'floor_base',
            rotation: candidate.tile.rotation || 0,
            cameraYaw: this.cameraState.yaw,
            mapData: this.mapData
          })
        });
      });
      hits.sort((a, b) => b.depth - a.depth);
      return { cell, hit: hits[0] || null, edge, localPoint, wallSnap };
    }

    isDoubleClickMechanismHit(pointer, hit) {
      if (!hit || hit.type !== 'tile' || !isTriggerMechanismTile(hit.panelType)) return false;
      const now = pointer.downTime || Date.now();
      const key = createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
      const previous = this.lastMechanismDown;
      this.lastMechanismDown = {
        key,
        time: now,
        x: pointer.x,
        y: pointer.y
      };
      return !!previous
        && previous.key === key
        && now - previous.time <= DOUBLE_CLICK_MS
        && Math.hypot(pointer.x - previous.x, pointer.y - previous.y) <= DOUBLE_CLICK_DISTANCE;
    }

    getMechanismScreenAnchor(cell) {
      if (!cell) return null;
      const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
      const zoom = this.cameraState.zoom || 1;
      return {
        left: this.worldLayer.x + (projection.x * zoom),
        top: this.worldLayer.y + ((projection.y - 58) * zoom)
      };
    }

    triggerMechanismFromHit(hit) {
      if (!hit?.cell || !isTriggerMechanismTile(hit.panelType)) return false;
      if (!this.isSelectedHit(hit)) this.selectHit(hit, false);
      if (this.activeTool === CITY_CHANNEL_TOOLS.BROWSE) this.config.onRequestTool?.(CITY_CHANNEL_TOOLS.SELECT);
      const key = createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
      const tile = this.mapData.tiles?.[key] || hit.tile;
      const params = normalizeMechanismParams(this.mechanismParams?.[key]);
      this.playMechanismAction(tile, key, params);
      this.config.onMechanismPanelRequest?.({
        cell: { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z },
        panelType: hit.panelType,
        params,
        anchor: this.getMechanismScreenAnchor(hit.cell)
      });
      return true;
    }

    triggerMechanismAtCell(cell, paramsOverride = null) {
      if (!cell) return false;
      const key = createCellKey(cell.x, cell.y, cell.z);
      const tile = this.mapData.tiles?.[key];
      if (!tile || !isTriggerMechanismTile(tile.panelType)) return false;
      const params = normalizeMechanismParams(paramsOverride || this.mechanismParams?.[key]);
      this.playMechanismAction(tile, key, params);
      return true;
    }

    requestMechanismPanel(hit) {
      if (!hit?.cell || !isTriggerMechanismTile(hit.panelType)) {
        this.config.onMechanismPanelRequest?.(null);
        return;
      }
      const key = createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
      this.config.onMechanismPanelRequest?.({
        cell: { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z },
        panelType: hit.panelType,
        params: normalizeMechanismParams(this.mechanismParams?.[key]),
        anchor: this.getMechanismScreenAnchor(hit.cell)
      });
    }

    playMechanismAction(tile, key, params) {
      if (!tile || !key) return;
      const object = this.renderObjects.get(`mechanism:${key}`);
      const runtime = object?.getData('runtime');
      if (!object || !runtime) return;
      const duration = Math.round(Math.max(0.5, params.durationSeconds || 1.5) * 1000);
      const travelDuration = Math.max(120, Math.round(duration / 2));
      this.tweens.killTweensOf(runtime.state);
      runtime.state.progress = 0;
      this.drawMechanismState(tile, runtime, 0, params);
      this.tweens.add({
        targets: runtime.state,
        progress: 1,
        duration: travelDuration,
        yoyo: true,
        ease: 'cubic.inout',
        onUpdate: () => this.drawMechanismState(tile, runtime, runtime.state.progress, params),
        onComplete: () => {
          runtime.state.progress = 0;
          this.drawMechanismState(tile, runtime, 0, params);
        }
      });
    }

    handlePointerDown(pointer) {
      if (pointer.rightButtonDown()) {
        this.handleContextAction(pointer);
        return;
      }
      const hit = this.hitTest(pointer);
      if (
        (this.activeTool === CITY_CHANNEL_TOOLS.BROWSE || this.activeTool === CITY_CHANNEL_TOOLS.SELECT)
        && this.isDoubleClickMechanismHit(pointer, hit.hit)
      ) {
        this.dragState = null;
        this.triggerMechanismFromHit(hit.hit);
        return;
      }
      const isDoubleHoldRotate = this.activeTool === CITY_CHANNEL_TOOLS.BROWSE
        && pointer.downTime
        && pointer.downTime - (this.lastBrowseDownAt || 0) <= 320
        && Math.hypot(pointer.x - (this.lastBrowseDownX || 0), pointer.y - (this.lastBrowseDownY || 0)) <= 22;
      this.lastBrowseDownAt = pointer.downTime || Date.now();
      this.lastBrowseDownX = pointer.x;
      this.lastBrowseDownY = pointer.y;

      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType) {
        this.beginPaint(pointer, hit);
        return;
      }

      if (this.activeTool === CITY_CHANNEL_TOOLS.BROWSE) {
        this.dragState = {
          mode: isDoubleHoldRotate ? 'rotateCamera' : 'pan',
          startX: pointer.x,
          startY: pointer.y,
          lastX: pointer.x,
          lastY: pointer.y,
          lastRotationAngle: isDoubleHoldRotate ? this.getPointerRotationAngle(pointer) : null,
          moved: false
        };
        return;
      }

      if (this.carryState) {
        this.dragState = { mode: 'carryConfirm' };
        return;
      }

      const selected = hit.hit && this.isSelectedHit(hit.hit);
      const canBoxSelect = this.activeTool === CITY_CHANNEL_TOOLS.SELECT;
      this.dragState = {
        mode: canBoxSelect && !hit.hit ? 'box' : 'click',
        startX: pointer.x,
        startY: pointer.y,
        lastX: pointer.x,
        lastY: pointer.y,
        moved: false,
        shiftKey: pointer.event?.shiftKey,
        hit,
        canBoxSelect
      };
      if (selected) {
        this.longPressTimer = setTimeout(() => {
          if (!this.dragState || this.dragState.moved) return;
          this.startCarry();
          this.dragState.mode = 'carry';
          this.longPressTimer = null;
        }, SELECTED_MOVE_HOLD_DELAY);
      }
    }

    handlePointerMove(pointer) {
      const hit = this.hitTest(pointer, { allowOutline: true });
      this.updateHover(hit);
      if (!this.dragState) {
        this.drawGhostLayer();
        return;
      }

      if (this.dragState.mode === 'paint') {
        this.applyPaint(pointer);
        return;
      }

      if (this.dragState.mode === 'pan' || this.dragState.mode === 'rotateCamera') {
        const dx = pointer.x - this.dragState.lastX;
        const dy = pointer.y - this.dragState.lastY;
        const totalDx = pointer.x - this.dragState.startX;
        const totalDy = pointer.y - this.dragState.startY;
        if (Math.hypot(totalDx, totalDy) > 4) this.dragState.moved = true;
        this.dragState.lastX = pointer.x;
        this.dragState.lastY = pointer.y;
        if (!this.dragState.moved) return;
        if (this.dragState.mode === 'rotateCamera') {
          const currentAngle = this.getPointerRotationAngle(pointer);
          if (Number.isFinite(currentAngle) && Number.isFinite(this.dragState.lastRotationAngle)) {
            this.updateYaw(this.cameraState.yaw + normalizeAngleDelta(currentAngle - this.dragState.lastRotationAngle));
          } else {
            this.updateYaw(this.cameraState.yaw + (dx * 0.34));
          }
          if (Number.isFinite(currentAngle)) this.dragState.lastRotationAngle = currentAngle;
        } else {
          this.cameraState.offsetX += dx;
          this.cameraState.offsetY += dy;
          this.updateCameraTransform();
        }
        return;
      }

      if (this.carryState || this.dragState.mode === 'carry') {
        this.drawGhostLayer();
        return;
      }

      if (this.dragState.mode === 'box' || this.dragState.mode === 'click') {
        const totalDx = pointer.x - this.dragState.startX;
        const totalDy = pointer.y - this.dragState.startY;
        if (Math.hypot(totalDx, totalDy) > 4) {
          this.dragState.moved = true;
          if (this.dragState.mode === 'click' && this.dragState.canBoxSelect) {
            if (this.longPressTimer) {
              clearTimeout(this.longPressTimer);
              this.longPressTimer = null;
            }
            this.dragState.mode = 'box';
          }
        }
        if (this.dragState.mode === 'box' && this.dragState.moved) this.drawBoxSelect(pointer);
      }
    }

    handlePointerUp(pointer) {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      const dragState = this.dragState;
      this.dragState = null;
      if (!dragState) return;

      if (dragState.mode === 'paint') {
        this.commitPaint();
        return;
      }

      if (this.carryState || dragState.mode === 'carry' || dragState.mode === 'carryConfirm') {
        const { cell } = this.hitTest(pointer);
        if (cell) this.commitCarry(cell);
        return;
      }

      if (dragState.mode === 'box' && dragState.moved) {
        this.commitBoxSelect(pointer, dragState);
        return;
      }

      if (dragState.moved) return;
      const hit = this.hitTest(pointer);
      if (this.activeTool === CITY_CHANNEL_TOOLS.SELECT || this.activeTool === CITY_CHANNEL_TOOLS.BROWSE) {
        if (hit.hit) {
          this.selectHit(hit.hit, !!dragState.shiftKey);
          if (this.activeTool === CITY_CHANNEL_TOOLS.BROWSE) this.config.onRequestTool?.(CITY_CHANNEL_TOOLS.SELECT);
        } else if (!dragState.shiftKey) {
          this.setSelection([], []);
        }
        return;
      }
      if (this.activeTool === CITY_CHANNEL_TOOLS.ERASE) {
        this.eraseHit(hit);
      }
    }

    handleContextAction(pointer) {
      const hit = this.hitTest(pointer, { allowOutline: true });
      if (this.activeTool === CITY_CHANNEL_TOOLS.BROWSE) return;
      if (this.carryState) {
        this.carryState = null;
        this.drawGhostLayer();
        return;
      }
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType) {
        this.config.onExitPlaceMode?.();
        return;
      }
      if (this.selectedCells.length || this.selectedWalls.length) {
        this.setSelection([], []);
        return;
      }
      this.eraseHit(hit);
    }

    handleWheel(pointer, gameObjects, deltaX, deltaY) {
      if ((this.selectedCells.length || this.selectedWalls.length) && this.activeTool !== CITY_CHANNEL_TOOLS.BROWSE) {
        this.config.onRotateSelection?.(deltaY < 0 ? 'forward' : 'reverse');
        return;
      }
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType) {
        this.config.onRotateActive?.(deltaY < 0 ? 90 : 270);
        return;
      }
      const nextZoom = Number(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.cameraState.zoom - (deltaY * 0.0014))).toFixed(2));
      this.cameraState.zoom = nextZoom;
      this.updateCameraTransform();
      this.drawGhostLayer();
      this.updateDebugText();
    }

    handleKeyDown(event) {
      const key = String(event.key || '').toLowerCase();
      if (event.target?.tagName?.toLowerCase() === 'input' || event.target?.tagName?.toLowerCase() === 'textarea') return;
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        this.config.onUndo?.();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault();
        this.config.onRedo?.();
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        this.config.onDeleteSelection?.();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        if (this.selectedCells.length || this.selectedWalls.length) this.config.onFlipSelection?.();
        return;
      }
      if (key === 'm') {
        event.preventDefault();
        this.startCarry();
        return;
      }
      if (key === 'escape') {
        if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType) {
          event.preventDefault();
          this.config.onExitPlaceMode?.();
          return;
        }
        this.carryState = null;
        this.setSelection([], []);
        this.drawGhostLayer();
        return;
      }
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(key)) {
        event.preventDefault();
        this.keyState.add(key);
      }
    }

    handleKeyUp(event) {
      this.keyState.delete(String(event.key || '').toLowerCase());
    }

    updateHover(hitInfo) {
      const wallPlacementTarget = this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && isWallMaterial(this.activeTileType)
        ? this.resolveWallGhostTarget(hitInfo)
        : null;
      const effectiveCell = wallPlacementTarget?.cell || hitInfo.cell;
      const effectiveEdge = wallPlacementTarget?.edge || hitInfo.edge;
      const effectiveCellKey = effectiveCell ? createCellKey(effectiveCell.x, effectiveCell.y, effectiveCell.z) : '';
      const nextKey = hitInfo.hit
        ? `${hitInfo.hit.type}:${createCellKey(hitInfo.hit.cell.x, hitInfo.hit.cell.y, hitInfo.hit.cell.z)}:${hitInfo.hit.edge || ''}:${hitInfo.hit.hitZone}:${effectiveCellKey}:${effectiveEdge || ''}`
        : (effectiveCell ? `cell:${effectiveCellKey}:${effectiveEdge || ''}` : '');
      if (this.hoverTarget?.key === nextKey) return;
      this.hoverTarget = { key: nextKey, hit: hitInfo.hit };
      this.hoverCell = effectiveCell;
      this.hoverEdge = effectiveEdge;
      if (hitInfo.hit) {
        const material = resolveMaterialName(hitInfo.hit.panelType);
        const suffix = hitInfo.hit.hitZone === 'outline' ? '轮廓穿透' : '可选择';
        this.config.onHoverStatusChange?.(`${material}，${suffix}`);
      } else {
        this.config.onHoverStatusChange?.(effectiveCell ? '空地，可吸附放置' : '未指向通道');
      }
      this.drawSelectionLayer();
    }

    beginPaint(pointer, hitInfo) {
      const isWall = isWallMaterial(this.activeTileType);
      const wallPlacementTarget = isWall ? this.resolveWallPlacementTarget(hitInfo) : null;
      const cell = isWall ? wallPlacementTarget?.cell : hitInfo.cell;
      if (!cell) return;
      const edge = isWall ? wallPlacementTarget?.edge : null;
      const existing = isWall
        ? this.mapData.walls?.[createWallKey(cell.x, cell.y, cell.z, edge)]
        : this.mapData.tiles?.[createCellKey(cell.x, cell.y, cell.z)];
      const intent = existing && (!isWall || existing.panelType === this.activeTileType) ? 'erase' : 'place';
      this.paintStroke = {
        intent,
        isWall,
        touched: new Set(),
        operations: []
      };
      this.dragState = { mode: 'paint' };
      this.applyPaint(pointer);
    }

    applyPaint(pointer) {
      if (!this.paintStroke) return;
      const hitInfo = this.hitTest(pointer);
      const isWall = this.paintStroke.isWall;
      const wallPlacementTarget = isWall ? this.resolveWallPlacementTarget(hitInfo) : null;
      const cell = isWall ? wallPlacementTarget?.cell : hitInfo.cell;
      if (!cell) {
        this.drawGhostLayer();
        return;
      }
      const edge = isWall ? wallPlacementTarget?.edge : null;
      const key = isWall ? `${createCellKey(cell.x, cell.y, cell.z)}:${edge}` : createCellKey(cell.x, cell.y, cell.z);
      if (this.paintStroke.touched.has(key)) {
        this.drawGhostLayer();
        return;
      }

      if (isWall) {
        if (!this.hasWallSupport(cell, edge)) {
          this.drawGhostLayer();
          return;
        }
        this.paintStroke.touched.add(key);
        const wallKey = createWallKey(cell.x, cell.y, cell.z, edge);
        const existing = this.mapData.walls?.[wallKey];
        if (this.paintStroke.intent === 'erase') {
          if (existing) this.paintStroke.operations.push({ kind: 'wall', action: 'erase', cell, edge });
          delete this.mapData.walls[wallKey];
          this.removeWallObject({ ...cell, edge });
        } else if (!existing) {
          const wall = createWall({ x: cell.x, y: cell.y, z: cell.z, edge, panelType: this.activeTileType });
          this.paintStroke.operations.push({ kind: 'wall', action: 'place', cell, edge, panelType: this.activeTileType });
          this.mapData.walls[wallKey] = wall;
          this.renderWallObject(wall);
        }
      } else if (this.activeTileType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || this.activeTileType === CITY_CHANNEL_TILE_TYPES.EXIT) {
        this.paintStroke.touched.add(key);
        const tileKey = createCellKey(cell.x, cell.y, cell.z);
        const existing = this.mapData.tiles?.[tileKey];
        if (this.paintStroke.intent === 'erase') {
          if (existing?.panelType === this.activeTileType) this.paintStroke.operations.push({ kind: 'tile', action: 'erase', cell });
          delete this.mapData.tiles[tileKey];
          this.removeTileObject(cell);
        } else {
          const marker = this.activeTileType === CITY_CHANNEL_TILE_TYPES.ENTRANCE ? 'entrance' : 'exit';
          Object.values(this.mapData.tiles || {}).forEach((tile) => {
            if (tile.marker !== marker && tile.panelType !== this.activeTileType) return;
            const oldKey = createCellKey(tile.x, tile.y, tile.z);
            const floor = createTile({
              x: tile.x,
              y: tile.y,
              z: tile.z,
              panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR,
              rotation: tile.rotation || 0
            });
            this.mapData.tiles[oldKey] = floor;
            this.renderTileObject(floor);
          });
          const tile = createTile({
            x: cell.x,
            y: cell.y,
            z: cell.z,
            panelType: this.activeTileType,
            rotation: this.activeRotation
          });
          this.paintStroke.operations.push({
            kind: 'tile',
            action: 'place',
            cell,
            panelType: this.activeTileType,
            rotation: this.activeRotation
          });
          this.mapData.tiles[tileKey] = tile;
          this.renderTileObject(tile);
        }
      } else {
        this.paintStroke.touched.add(key);
        const tileKey = createCellKey(cell.x, cell.y, cell.z);
        const existing = this.mapData.tiles?.[tileKey];
        if (this.paintStroke.intent === 'erase') {
          if (existing?.panelType === this.activeTileType) this.paintStroke.operations.push({ kind: 'tile', action: 'erase', cell });
          delete this.mapData.tiles[tileKey];
          this.removeTileObject(cell);
        } else if (!existing || existing.panelType !== this.activeTileType) {
          const tile = createTile({ x: cell.x, y: cell.y, z: cell.z, panelType: this.activeTileType, rotation: this.activeRotation });
          this.paintStroke.operations.push({
            kind: 'tile',
            action: 'place',
            cell,
            panelType: this.activeTileType,
            rotation: this.activeRotation
          });
          this.mapData.tiles[tileKey] = tile;
          this.renderTileObject(tile);
        }
      }
      this.refreshAfterIncrementalEdit();
      this.drawGhostLayer();
    }

    commitPaint() {
      const operations = this.paintStroke?.operations || [];
      this.paintStroke = null;
      if (operations.length > 0) this.config.onCommitOperations?.(operations, { label: '批量建造' });
      this.drawGhostLayer();
    }

    eraseHit(hitInfo) {
      const operations = [];
      if (hitInfo.hit?.type === 'wall') {
        operations.push({ kind: 'wall', action: 'erase', cell: hitInfo.hit.cell, edge: hitInfo.hit.edge });
      } else if (hitInfo.hit?.type === 'tile') {
        operations.push({ kind: 'tile', action: 'erase', cell: hitInfo.hit.cell });
      }
      if (operations.length) this.config.onCommitOperations?.(operations, { label: '擦除' });
    }

    selectHit(hit, additive = false) {
      if (hit.type === 'wall') {
        const wall = { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z, edge: hit.edge };
        let nextWalls = additive ? [...this.selectedWalls] : [];
        const key = createWallSelectionKey(wall);
        if (additive && nextWalls.some((item) => createWallSelectionKey(item) === key)) {
          nextWalls = nextWalls.filter((item) => createWallSelectionKey(item) !== key);
        } else {
          nextWalls.push(wall);
        }
        this.setSelection(additive ? this.selectedCells : [], nextWalls);
        this.config.onMechanismPanelRequest?.(null);
        return;
      }
      const cell = { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z };
      let nextCells = additive ? [...this.selectedCells] : [];
      const key = createCellKey(cell.x, cell.y, cell.z);
      if (additive && nextCells.some((item) => createCellKey(item.x, item.y, item.z) === key)) {
        nextCells = nextCells.filter((item) => createCellKey(item.x, item.y, item.z) !== key);
      } else {
        nextCells.push(cell);
      }
      this.setSelection(nextCells, additive ? this.selectedWalls : []);
      if (!additive && nextCells.length === 1) {
        this.requestMechanismPanel(hit);
      } else {
        this.config.onMechanismPanelRequest?.(null);
      }
    }

    setSelection(cells, walls) {
      this.selectedCells = cells;
      this.selectedWalls = walls;
      this.config.onSelectionChange?.({ cells, walls });
      this.drawSelectionLayer();
    }

    isSelectedHit(hit) {
      if (!hit) return false;
      if (hit.type === 'wall') {
        return this.selectedWalls.some((wall) => createWallSelectionKey(wall) === createWallSelectionKey({
          x: hit.cell.x,
          y: hit.cell.y,
          z: hit.cell.z,
          edge: hit.edge
        }));
      }
      return this.selectedCells.some((cell) => sameCell(cell, hit.cell));
    }

    startCarry() {
      const origins = [...this.selectedCells, ...this.selectedWalls].map((item) => ({ ...item }));
      if (origins.length <= 0) return;
      this.carryState = { origins };
      this.drawGhostLayer();
    }

    commitCarry(targetCell) {
      if (!this.carryState || !targetCell) return;
      const { valid, moves } = this.computeMovePreview(targetCell);
      if (!valid) {
        this.config.onToast?.('目标位置存在冲突，无法完成移动。', 'error');
        return;
      }
      this.carryState = null;
      this.drawGhostLayer();
      this.config.onMovePlacements?.(moves);
    }

    computeMovePreview(targetCell) {
      const origins = this.carryState?.origins || [];
      if (origins.length <= 0 || !targetCell) return { valid: true, moves: [], conflicts: [], conflictKeys: new Set() };
      const anchor = origins[0];
      const dx = targetCell.x - anchor.x;
      const dy = targetCell.y - anchor.y;
      const movingTileKeys = new Set(origins.filter((item) => !item.edge).map((item) => createCellKey(item.x, item.y, item.z)));
      const movingWallKeys = new Set(origins.filter((item) => item.edge).map(createWallSelectionKey));
      const targetTileKeys = new Set();
      const targetWallKeys = new Set();
      const conflicts = [];
      const conflictKeys = new Set();
      const moves = origins.map((origin) => ({
        from: origin,
        to: {
          x: origin.x + dx,
          y: origin.y + dy,
          z: origin.z,
          ...(origin.edge ? { edge: origin.edge } : {})
        }
      }));
      const addConflict = (reason, to) => {
        conflicts.push(reason);
        if (to?.edge) conflictKeys.add(createWallSelectionKey(to));
        else if (to) conflictKeys.add(createCellKey(to.x, to.y, to.z));
      };
      moves.forEach(({ to }) => {
        if (!isValidCell(to.x, to.y, to.z, this.mapData)) addConflict('out_of_bounds', to);
        if (to.edge) {
          const key = createWallSelectionKey(to);
          if (targetWallKeys.has(key)) addConflict('wall_overlap', to);
          targetWallKeys.add(key);
          if (this.mapData.walls?.[key] && !movingWallKeys.has(key)) addConflict('wall_occupied', to);
          const ownCellKey = createCellKey(to.x, to.y, to.z);
          const neighborOffset = EDGE_NEIGHBOR_OFFSETS[to.edge] || EDGE_NEIGHBOR_OFFSETS.north;
          const neighbor = { x: to.x + neighborOffset.x, y: to.y + neighborOffset.y, z: to.z };
          const neighborKey = createCellKey(neighbor.x, neighbor.y, neighbor.z);
          if (!this.mapData.tiles?.[ownCellKey] && !this.mapData.tiles?.[neighborKey] && !targetTileKeys.has(ownCellKey) && !targetTileKeys.has(neighborKey)) {
            addConflict('wall_without_support', to);
          }
          return;
        }
        const key = createCellKey(to.x, to.y, to.z);
        if (targetTileKeys.has(key)) addConflict('tile_overlap', to);
        targetTileKeys.add(key);
        if (this.mapData.tiles?.[key] && !movingTileKeys.has(key)) addConflict('tile_occupied', to);
      });
      return { valid: conflicts.length === 0, moves, conflicts, conflictKeys };
    }

    drawRouteLayer() {
      this.routeLayer.clear();
      (this.mapData.safeRoute || []).forEach((cell) => {
        const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
        this.routeLayer.fillStyle(0x22c55e, 0.28);
        this.routeLayer.fillCircle(projection.x, projection.y + 2, 9);
      });
    }

    drawHelperLayer() {
      this.helperLayer.clear();
      if (!this.showHelperGrid) return;
      this.helperLayer.lineStyle(1, 0x38bdf8, 0.16);
      for (let y = 0; y < this.mapData.height; y += 1) {
        for (let x = 0; x < this.mapData.width; x += 1) {
          const projection = projectCell({ x, y, z: 0 }, this.cameraState.yaw, this.mapData);
          const geometry = createTileGeometry(this.cameraState.yaw, 0);
          this.helperLayer.beginPath();
          this.helperLayer.moveTo(projection.x + geometry.top[0].x - 80, projection.y + geometry.top[0].y - 98);
          geometry.top.slice(1).forEach((point) => this.helperLayer.lineTo(projection.x + point.x - 80, projection.y + point.y - 98));
          this.helperLayer.closePath();
          this.helperLayer.strokePath();
        }
      }
    }

    drawSelectionLayer() {
      this.selectionLayer.clear();
      const drawCell = (cell, color = 0x67e8f9) => {
        const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
        const geometry = createTileGeometry(this.cameraState.yaw, 0);
        this.selectionLayer.lineStyle(3, color, 0.88);
        this.selectionLayer.beginPath();
        this.selectionLayer.moveTo(projection.x + geometry.top[0].x - 80, projection.y + geometry.top[0].y - 98);
        geometry.top.slice(1).forEach((point) => this.selectionLayer.lineTo(projection.x + point.x - 80, projection.y + point.y - 98));
        this.selectionLayer.closePath();
        this.selectionLayer.strokePath();
      };
      const strokePolygon = (points = [], color = 0xfacc15, alpha = 0.92) => {
        if (!Array.isArray(points) || points.length < 3) return;
        this.selectionLayer.lineStyle(3, color, alpha);
        this.selectionLayer.beginPath();
        this.selectionLayer.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => this.selectionLayer.lineTo(point.x, point.y));
        this.selectionLayer.closePath();
        this.selectionLayer.strokePath();
      };
      const drawWall = (wall, color = 0xfacc15) => {
        const projection = projectCell(wall, this.cameraState.yaw, this.mapData);
        const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
        const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
        const geometry = createEdgeWallGeometry(this.cameraState.yaw, wall.edge);
        [
          geometry.wall,
          geometry.wallSideStart,
          geometry.wallSideEnd,
          geometry.wallCap
        ].forEach((points) => {
          strokePolygon(points.map((point) => ({
            x: point.x + offsetX,
            y: point.y + offsetY
          })), color);
        });
      };
      this.selectedCells.forEach((cell) => drawCell(cell));
      this.selectedWalls.forEach((wall) => drawWall(wall, 0xfacc15));
      if (this.hoverCell && !this.hoverTarget?.hit) drawCell(this.hoverCell, 0x22d3ee);
    }

    drawBoxSelect(pointer) {
      this.selectionLayer.clear();
      const start = screenToLocal({
        x: this.dragState.startX,
        y: this.dragState.startY,
        worldX: this.worldLayer.x,
        worldY: this.worldLayer.y,
        zoom: this.cameraState.zoom
      });
      const current = this.toLocal(pointer);
      this.selectionLayer.fillStyle(0x38bdf8, 0.08);
      this.selectionLayer.lineStyle(2, 0x67e8f9, 0.5);
      this.selectionLayer.fillRect(Math.min(start.x, current.x), Math.min(start.y, current.y), Math.abs(current.x - start.x), Math.abs(current.y - start.y));
      this.selectionLayer.strokeRect(Math.min(start.x, current.x), Math.min(start.y, current.y), Math.abs(current.x - start.x), Math.abs(current.y - start.y));
    }

    translateGeometryGroups(placement, groups = []) {
      const projection = projectCell(placement, this.cameraState.yaw, this.mapData);
      const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
      const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
      return groups
        .filter((points) => Array.isArray(points) && points.length >= 3)
        .map((points) => points.map((point) => ({
          x: point.x + offsetX,
          y: point.y + offsetY
        })));
    }

    getTileLocalPolygons(tile) {
      if (!tile) return [];
      const geometry = createTileGeometry(this.cameraState.yaw, tile.rotation || 0);
      const groups = [geometry.top, ...geometry.sides];
      if (isPortalMaterial(tile.panelType)) {
        groups.push(...getPortalPolygons(this.cameraState.yaw, tile.rotation || 0));
      }
      if (tile.isVertical) {
        groups.push(geometry.wall, geometry.wallCap, geometry.wallSideStart, geometry.wallSideEnd);
      }
      return this.translateGeometryGroups(tile, groups);
    }

    getWallLocalPolygons(wall) {
      if (!wall) return [];
      const geometry = createEdgeWallGeometry(this.cameraState.yaw, wall.edge);
      return this.translateGeometryGroups(wall, [
        geometry.wall,
        geometry.wallCap,
        geometry.wallSideStart,
        geometry.wallSideEnd
      ]);
    }

    commitBoxSelect(pointer, dragState) {
      if (!dragState) return;
      const start = screenToLocal({
        x: dragState.startX,
        y: dragState.startY,
        worldX: this.worldLayer.x,
        worldY: this.worldLayer.y,
        zoom: this.cameraState.zoom
      });
      const current = this.toLocal(pointer);
      const rect = {
        left: Math.min(start.x, current.x),
        right: Math.max(start.x, current.x),
        top: Math.min(start.y, current.y),
        bottom: Math.max(start.y, current.y)
      };
      const cells = dragState.shiftKey ? [...this.selectedCells] : [];
      const walls = dragState.shiftKey ? [...this.selectedWalls] : [];
      const seenCells = new Set(cells.map((cell) => createCellKey(cell.x, cell.y, cell.z)));
      const seenWalls = new Set(walls.map(createWallSelectionKey));
      Object.values(this.mapData.tiles || {}).forEach((tile) => {
        if (this.getTileLocalPolygons(tile).some((polygon) => polygonIntersectsRect(polygon, rect))) {
          const key = createCellKey(tile.x, tile.y, tile.z);
          if (!seenCells.has(key)) {
            seenCells.add(key);
            cells.push({ x: tile.x, y: tile.y, z: tile.z });
          }
        }
      });
      Object.values(this.mapData.walls || {}).forEach((wall) => {
        if (this.getWallLocalPolygons(wall).some((polygon) => polygonIntersectsRect(polygon, rect))) {
          const key = createWallSelectionKey(wall);
          if (!seenWalls.has(key)) {
            seenWalls.add(key);
            walls.push({ x: wall.x, y: wall.y, z: wall.z, edge: wall.edge });
          }
        }
      });
      this.setSelection(cells, walls);
    }

    drawGhostLayer() {
      this.ghostLayer.clear();
      if (this.carryState && this.hoverCell) {
        const { moves, conflictKeys } = this.computeMovePreview(this.hoverCell);
        moves.forEach(({ from, to }) => {
          const conflictKey = to.edge ? createWallSelectionKey(to) : createCellKey(to.x, to.y, to.z);
          const color = conflictKeys.has(conflictKey) ? 0xef4444 : 0x22c55e;
          this.drawPlacementGhost({ ...to, source: from }, color, 0.22, true);
        });
        return;
      }
      if (this.activeTool !== CITY_CHANNEL_TOOLS.PLACE_TILE || !this.activeTileType || !this.hoverCell) return;
      if (isWallMaterial(this.activeTileType)) {
        const hasSupport = this.hasWallSupport(this.hoverCell, this.hoverEdge);
        this.drawPlacementGhost({
          ...this.hoverCell,
          edge: this.hoverEdge || 'north',
          panelType: this.activeTileType
        }, hasSupport ? 0x67e8f9 : 0xef4444, 0.2, false);
        return;
      }
      this.drawPlacementGhost({
        ...this.hoverCell,
        panelType: this.activeTileType,
        rotation: this.activeRotation
      }, 0x67e8f9, 0.18, false);
    }

    hasWallSupport(cell, edge = 'north') {
      if (!cell) return false;
      const ownCellKey = createCellKey(cell.x, cell.y, cell.z);
      const neighborOffset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
      const neighbor = { x: cell.x + neighborOffset.x, y: cell.y + neighborOffset.y, z: cell.z };
      const neighborKey = createCellKey(neighbor.x, neighbor.y, neighbor.z);
      return !!this.mapData.tiles?.[ownCellKey] || !!this.mapData.tiles?.[neighborKey];
    }

    drawPlacementGhost(placement, color = 0x67e8f9, alpha = 0.18, fromMove = false) {
      if (!placement) return;
      const projection = projectCell(placement, this.cameraState.yaw, this.mapData);
      const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
      const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
      this.ghostLayer.lineStyle(fromMove ? 2 : 2, color, fromMove ? 0.92 : 0.78);
      this.ghostLayer.fillStyle(color, alpha);
      if (placement.edge) {
        const geometry = createEdgeWallGeometry(this.cameraState.yaw, placement.edge);
        [geometry.wall, geometry.wallSideStart, geometry.wallSideEnd, geometry.wallCap].forEach((points) => {
          drawPolygonShape(this.ghostLayer, points, offsetX, offsetY);
        });
        return;
      }

      const source = placement.source || placement;
      const sourceTile = this.mapData.tiles?.[createCellKey(source.x, source.y, source.z)];
      const ghostTile = sourceTile && fromMove
        ? sourceTile
        : createTile({
          x: placement.x,
          y: placement.y,
          z: placement.z,
          panelType: placement.panelType || this.activeTileType,
          rotation: placement.rotation || this.activeRotation
        });
      const geometry = createTileGeometry(this.cameraState.yaw, ghostTile.rotation || 0);
      [...geometry.sides, geometry.top].forEach((points) => {
        drawPolygonShape(this.ghostLayer, points, offsetX, offsetY);
      });
      if (isPortalMaterial(ghostTile.panelType)) {
        getPortalPolygons(this.cameraState.yaw, ghostTile.rotation || 0).forEach((points) => {
          drawPolygonShape(this.ghostLayer, points, offsetX, offsetY);
        });
      } else if (ghostTile.isVertical) {
        [geometry.wall, geometry.wallSideStart, geometry.wallSideEnd, geometry.wallCap].forEach((points) => {
          drawPolygonShape(this.ghostLayer, points, offsetX, offsetY);
        });
      }
    }

    emitStatus() {
      this.config.onHoverStatusChange?.('浏览模式');
      this.notifyCamera();
    }

    updateDebugText() {
      if (!this.debugText) return;
      const tileCount = Object.keys(this.mapData.tiles || {}).length;
      const wallCount = Object.keys(this.mapData.walls || {}).length;
      this.debugText.setText(`Phaser ${tileCount + wallCount} objs | ${Math.round(this.cameraState.zoom * 100)}% | yaw ${Math.round(this.cameraState.yaw)}`);
    }
  };
};

export default createCityChannelPhaserScene;
