import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  isValidCell,
  normalizeCityChannelMap,
  normalizeRotation,
  wallEdgeToRotation
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
  getTransmissionMidPlane,
  getTransmissionPortPlane,
  getNeighborCells,
  localToCellAtLayer,
  pointInPolygon,
  projectCell,
  screenToLocal
} from './renderer/CityChannelGeometry';
import { getPlacementDepth } from './renderer/CityChannelDepth';
import { getCellVerticalEndpoints } from './renderer/CityChannelDepth';
import { compareCityChannelHits } from './cityChannelHitSelection';
import CityChannelTextureCache, { getTextureYawBucket } from './renderer/CityChannelTextureCache';
import CityChannelRuntimeIndex from './runtime/CityChannelRuntimeIndex';
import { projectWorldOffset } from '../cityChannelGeometryUtils';
import {
  canSelectBoardPlacement,
  canSelectComponentPlacement
} from '../cityChannelSelectionRules';
import {
  PRESSURE_PLATE_LAYOUT,
  layoutColor,
  mapLayoutToScreen
} from '../cityChannelPressurePlateLayout';
import {
  buildMechanicalAssemblies,
  findFixedAxisForTrigger,
  getAssemblyForCell,
  getGearMountLocalPosition,
  CITY_CHANNEL_MECHANISM_KINDS,
  getMechanismTemplateKind,
  getWorldTransmissionPorts,
  isTriggerMechanismTile,
  normalizeMechanismParams
} from '../cityChannelMechanismRuntime';
import {
  computeCityChannelMovePreviewModel,
  getSelectionAnchor,
  isPortalMaterial
} from '../cityChannelMovePreview';
import { isGearPressurePlatePanel } from '../cityChannelGearPressurePlateRender';
import {
  buildPlacementGhostAtTarget,
  getMovingHostKeysFromOrigins
} from '../cityChannelAttachedComponents';
import { shouldStartPaintDrag } from './cityChannelPaintInteraction';

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.8;
const CAMERA_PAN_SPEED = 520;
const CAMERA_ROTATION_SPEED = 96;
const SELECTED_MOVE_HOLD_DELAY = 260;
const WALL_EDGE_SNAP_SCREEN_RADIUS = 30;
const FLOOR_EDGE_SNAP_SCREEN_RADIUS = 16;
const VERTICAL_SURFACE_EDGE_SNAP_SCREEN_RADIUS = 10;
const DOUBLE_CLICK_MS = 280;
const DOUBLE_CLICK_DISTANCE = 12;
const INSPECT_ROTATE_SENSITIVITY = 0.009;
const INSPECT_MIN_PITCH = -45;
const INSPECT_MAX_PITCH = 60;
const PRESS_TRAVEL = 10;
const MOTION_RATIO = 2;
const VERTICAL_PUSH_TRAVEL = PRESS_TRAVEL * MOTION_RATIO;
const HORIZONTAL_PUSH_TRAVEL = PRESS_TRAVEL * MOTION_RATIO;
const INSPECT_PREVIEW_SCALE = 2.05;
const INSPECT_LIFT_DURATION = 620;
const INSPECT_RETURN_DURATION = 420;
const EDGE_NEIGHBOR_OFFSETS = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 }
};
const getWallSurfaceRotation = (placement = {}) => wallEdgeToRotation(placement?.edge || 'north');
const getTransmissionSurfaceRotation = (placement = {}) => normalizeRotation(
  placement?.transmissionRotation ?? placement?.rotation ?? 0
);
const OPPOSITE_EDGE = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east'
};
const WALL_EDGE_ENDPOINTS = {
  north: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }],
  south: [{ x: -0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
  west: [{ x: -0.5, y: -0.5 }, { x: -0.5, y: 0.5 }],
  east: [{ x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }]
};
const WALL_EDGE_TANGENTS = {
  north: { x: 1, y: 0 },
  south: { x: 1, y: 0 },
  west: { x: 0, y: 1 },
  east: { x: 0, y: 1 }
};
const TRANSMISSION_SOCKET_EPSILON = 0.08;
const GEAR_COMPONENT_TYPE = 'gear';
const GEAR_SOCKET_POSITIONS = ['center', 'corner_ne', 'corner_nw', 'corner_se', 'corner_sw'];
const GEAR_SOCKET_BLOCKED_BY_EDGE = {
  north: new Set(['corner_ne', 'corner_nw']),
  east: new Set(['corner_ne', 'corner_se']),
  south: new Set(['corner_se', 'corner_sw']),
  west: new Set(['corner_nw', 'corner_sw'])
};
const GEAR_SOCKET_CORNER_OFFSET = 0.32;
const GEAR_PITCH_RADIUS_LOCAL = (Math.SQRT2 * GEAR_SOCKET_CORNER_OFFSET) / 2;
const GEAR_ROOT_RADIUS_LOCAL = GEAR_PITCH_RADIUS_LOCAL * 0.78;
const GEAR_OUTER_RADIUS_LOCAL = GEAR_PITCH_RADIUS_LOCAL * 1.08;
const GEAR_HUB_RADIUS_LOCAL = GEAR_PITCH_RADIUS_LOCAL * 0.32;
const GEAR_AXLE_RADIUS_LOCAL = GEAR_PITCH_RADIUS_LOCAL * 0.14;
const GEAR_TOOTH_COUNT = 18;

const normalizeCameraYaw = (yaw = 0) => ((yaw % 360) + 360) % 360;
const normalizeAngleDelta = (delta = 0) => ((delta + 540) % 360) - 180;

const isBoardMaterial = (panelType) => {
  const material = getCityChannelMaterial(panelType);
  return !!material && material.placeable !== false && !isPortalMaterial(panelType);
};

const createWallSelectionKey = (wall) => (
  wall ? createWallKey(wall.x, wall.y, wall.z, wall.edge) : ''
);

const sameCell = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;

const resolveMaterialName = (panelType) => getCityChannelMaterial(panelType)?.name || panelType || '未知物件';

const getDirectionFromEndpoint = (point = {}) => (
  Math.abs(point.x || 0) >= Math.abs(point.y || 0)
    ? ((point.x || 0) < 0 ? 'west' : 'east')
    : ((point.y || 0) < 0 ? 'north' : 'south')
);

const rotateDirectionByDegrees = (direction, rotation = 0) => {
  const order = ['north', 'east', 'south', 'west'];
  const index = order.indexOf(direction);
  if (index < 0) return direction;
  const steps = Math.round((((Number(rotation) || 0) % 360 + 360) % 360) / 90) % 4;
  return order[(index + steps) % 4];
};

const formatAxisCoord = (value = 0) => Number(value || 0).toFixed(3);

const sameAxisPoint = (a, b) => !!a && !!b
  && Math.abs((a.x || 0) - (b.x || 0)) <= 0.001
  && Math.abs((a.y || 0) - (b.y || 0)) <= 0.001;

const sameAxisSegment = (a = [], b = []) => (
  Array.isArray(a)
  && Array.isArray(b)
  && a.length >= 2
  && b.length >= 2
  && (
    (sameAxisPoint(a[0], b[0]) && sameAxisPoint(a[1], b[1]))
    || (sameAxisPoint(a[0], b[1]) && sameAxisPoint(a[1], b[0]))
  )
);

const createLocalRect = ({ left, right, top, bottom } = {}) => ({
  left: Math.min(left, right),
  right: Math.max(left, right),
  top: Math.min(top, bottom),
  bottom: Math.max(top, bottom)
});

const rectContainsPoint = (rect, point) => !!rect && !!point
  && point.x >= rect.left
  && point.x <= rect.right
  && point.y >= rect.top
  && point.y <= rect.bottom;

const expandRect = (rect, padding = 0) => (rect ? ({
  left: rect.left - padding,
  right: rect.right + padding,
  top: rect.top - padding,
  bottom: rect.bottom + padding
}) : null);

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
      this.mapDataSource = initialConfig.mapData || {};
      this.mapData = normalizeCityChannelMap(initialConfig.mapData || {});
      this.activeTool = initialConfig.activeTool || CITY_CHANNEL_TOOLS.BROWSE;
      this.activeTileType = initialConfig.activeTileType || null;
      this.activeComponentType = initialConfig.activeComponentType || null;
      this.activeRotation = initialConfig.activeRotation || 0;
      this.activeLayer = Number.isInteger(initialConfig.activeLayer) ? initialConfig.activeLayer : 0;
      this.visibleLayerCutoff = Number.isInteger(initialConfig.visibleLayerCutoff)
        ? initialConfig.visibleLayerCutoff
        : null;
      this.wallViewMode = initialConfig.wallViewMode || 'semi';
      this.showHelperGrid = !!initialConfig.showHelperGrid;
      this.showCoordinates = !!initialConfig.showCoordinates;
      this.panelPose = initialConfig.panelPose || 'floor';
      this.cameraState = {
        offsetX: 0,
        offsetY: -40,
        zoom: 1,
        yaw: 0
      };
      this.selectedCells = [];
      this.selectedWalls = [];
      this.selectedGears = [];
      this.selectionScope = null;
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
      this.inspectState = null;
      this.pendingMechanicalPort = null;
      this.hoverGearInstallTarget = null;
      this.pendingGearAxisPrompt = null;
      this.skipMapDataRenderCount = 0;
      this.pendingCommitTimers = [];
      this.mechanicalLayerTimer = null;
      this.mechanicalGraphCache = null;
      this.mechanicalGraphRevision = -1;
      this.mapRevision = 0;
      this.lastGhostLayerKey = '';
      this.snapPlaneCycle = 0;
      this.activeSnapAxisKey = '';
      this.selectionSyncLock = null;
    }

    create() {
      this.textureCache = new CityChannelTextureCache(this);
      this.worldLayer = this.add.container(this.scale.width / 2, this.scale.height / 2 - 40);
      this.mapLayer = this.add.container(0, 0);
      this.mechanicalLinkLayer = this.add.graphics();
      this.mechanicalPortLayer = this.add.graphics();
      this.routeLayer = this.add.graphics();
      this.helperLayer = this.add.graphics();
      this.selectionLayer = this.add.graphics();
      this.ghostLayer = this.add.graphics();
      this.inspectLayer = this.add.container(0, 0);
      this.inspectLayer.depth = 100000;
      this.debugText = null;

      this.worldLayer.add([this.mapLayer, this.mechanicalLinkLayer, this.routeLayer, this.helperLayer, this.selectionLayer, this.mechanicalPortLayer, this.ghostLayer]);
      this.input.setTopOnly(false);
      this.input.on('pointerdown', this.handlePointerDown, this);
      this.input.on('pointermove', this.handlePointerMove, this);
      this.input.on('pointerup', this.handlePointerUp, this);
      this.input.on('wheel', this.handleWheel, this);
      this.input.mouse?.disableContextMenu();
      this.input.keyboard.on('keydown', this.handleKeyDown, this);
      this.input.keyboard.on('keyup', this.handleKeyUp, this);
      this.scale.on('resize', this.handleResize, this);
      this.canvasDblClickHandler = (event) => this.handleCanvasDoubleClick(event);
      this.game?.canvas?.addEventListener('dblclick', this.canvasDblClickHandler);
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
      if (this.mechanicalLayerTimer) {
        this.mechanicalLayerTimer.remove(false);
        this.mechanicalLayerTimer = null;
      }
      this.pendingCommitTimers.forEach(({ frameId, timerId }) => {
        if (frameId && typeof window !== 'undefined') window.cancelAnimationFrame?.(frameId);
        if (timerId) clearTimeout(timerId);
      });
      this.pendingCommitTimers = [];
      this.closeInspectMode({ animate: false, silent: true });
      this.textureCache?.destroy();
      this.input?.off('pointerdown', this.handlePointerDown, this);
      this.input?.off('pointermove', this.handlePointerMove, this);
      this.input?.off('pointerup', this.handlePointerUp, this);
      this.input?.off('wheel', this.handleWheel, this);
      this.input?.keyboard?.off('keydown', this.handleKeyDown, this);
      this.input?.keyboard?.off('keyup', this.handleKeyUp, this);
      this.scale?.off('resize', this.handleResize, this);
      if (this.canvasDblClickHandler) {
        this.game?.canvas?.removeEventListener('dblclick', this.canvasDblClickHandler);
        this.canvasDblClickHandler = null;
      }
    }

    updateConfig(next = {}) {
      this.config = { ...this.config, ...next };
      if (next.mapData && next.mapData !== this.mapDataSource) {
        this.closeInspectMode({ animate: false });
        this.mapDataSource = next.mapData;
        this.mapData = normalizeCityChannelMap(next.mapData);
        this.mapRevision += 1;
        this.invalidateMechanicalGraph();
        this.index.rebuild(this.mapData);
        if (this.skipMapDataRenderCount > 0) {
          this.skipMapDataRenderCount -= 1;
          this.sortMapLayer();
          this.scheduleMechanicalLayerRedraw(40);
          this.drawSelectionLayer();
        } else {
          this.renderMap({ full: true });
        }
      }
      if (next.activeTool !== undefined && next.activeTool !== this.activeTool) {
        const wasPlacing = this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE;
        this.activeTool = next.activeTool;
        if (wasPlacing !== (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE)) this.refreshWallTextures();
        this.drawGhostLayer();
      } else if (next.activeTool !== undefined) {
        this.activeTool = next.activeTool;
      }
      if (next.activeTileType !== undefined && next.activeTileType !== this.activeTileType) {
        this.activeTileType = next.activeTileType;
        this.drawGhostLayer();
      } else if (next.activeTileType !== undefined) {
        this.activeTileType = next.activeTileType;
      }
      if (next.activeComponentType !== undefined && next.activeComponentType !== this.activeComponentType) {
        this.activeComponentType = next.activeComponentType;
        this.drawGhostLayer();
      } else if (next.activeComponentType !== undefined) {
        this.activeComponentType = next.activeComponentType;
      }
      if (next.activeRotation !== undefined && next.activeRotation !== this.activeRotation) {
        this.activeRotation = next.activeRotation;
        this.drawGhostLayer();
      } else if (next.activeRotation !== undefined) {
        this.activeRotation = next.activeRotation;
      }
      if (next.activeLayer !== undefined) {
        this.activeLayer = Number.isInteger(next.activeLayer) ? next.activeLayer : 0;
        this.drawGhostLayer();
      }
      if (next.visibleLayerCutoff !== undefined) {
        const nextCutoff = Number.isInteger(next.visibleLayerCutoff) ? next.visibleLayerCutoff : null;
        if (nextCutoff !== this.visibleLayerCutoff) {
          this.visibleLayerCutoff = nextCutoff;
          this.renderMap({ full: true });
          this.refreshPointerStateAfterViewChange();
        }
      }
      if (next.panelPose !== undefined) {
        this.panelPose = next.panelPose === 'wall' ? 'wall' : 'floor';
        this.drawGhostLayer();
      }
      if (next.mechanismParams !== undefined) {
        this.mechanismParams = next.mechanismParams || {};
        this.refreshMechanismVisuals();
        this.refreshInspectPreview();
      }
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
        const selectionLock = this.selectionSyncLock;
        if (selectionLock) {
          const now = Date.now();
          const lockExpired = now > selectionLock.expiresAt;
          const nextCells = next.selection.cells || [];
          const nextWalls = next.selection.walls || [];
          const nextGears = next.selection.gears || [];
          const nextScope = next.selection.scope || null;
          const sameCells = nextCells.length === selectionLock.cells.size
            && nextCells.every((cell) => selectionLock.cells.has(createCellKey(cell.x, cell.y, cell.z)));
          const sameWalls = nextWalls.length === selectionLock.walls.size
            && nextWalls.every((wall) => selectionLock.walls.has(createWallSelectionKey(wall)));
          const sameGears = nextGears.length === selectionLock.gears.size
            && nextGears.every((gear) => selectionLock.gears.has(`${gear.hostKey}:${gear.mountId}`));
          const sameScope = nextScope === selectionLock.scope;
          if (!lockExpired && !(sameCells && sameWalls && sameGears && sameScope)) return;
          this.selectionSyncLock = null;
        }
        this.selectedCells = next.selection.cells || [];
        this.selectedWalls = next.selection.walls || [];
        this.selectedGears = next.selection.gears || [];
        this.selectionScope = next.selection.scope || null;
        this.redrawAllMountedGearLayers();
        this.sortMapLayer();
        this.drawSelectionLayer();
      }
    }

    isWallPlacementActive() {
      return (
        this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE
        && this.panelPose === 'wall'
        && this.activeTileType
        && isBoardMaterial(this.activeTileType)
      );
    }

    getEffectiveWallViewMode() {
      return this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE ? 'solid' : this.wallViewMode;
    }

    isLayerVisible(cell = {}) {
      return this.visibleLayerCutoff === null || (Number(cell.z) || 0) <= this.visibleLayerCutoff;
    }

    getPlaneLevels() {
      const levels = new Set([0]);
      Object.values(this.mapData.tiles || {}).forEach((tile) => {
        if (tile && !tile.isVertical) levels.add(Number(tile.z) || 0);
      });
      return Array.from(levels).sort((a, b) => a - b);
    }

    getNextHiddenPlaneLevel() {
      if (this.visibleLayerCutoff === null) return null;
      const cutoff = Number(this.visibleLayerCutoff) || 0;
      return this.getPlaneLevels().find((level) => level > cutoff) ?? null;
    }

    isVerticalAttachmentPlacement(placement = {}) {
      if (!placement) return false;
      if (placement.edge) return true;
      return !!placement.isVertical;
    }

    isPlacementVisible(placement = {}) {
      if (this.visibleLayerCutoff === null) return true;
      const z = Number(placement?.z) || 0;
      if (z <= this.visibleLayerCutoff) return true;
      const nextHiddenPlaneLevel = this.getNextHiddenPlaneLevel();
      return (
        this.isVerticalAttachmentPlacement(placement)
        && nextHiddenPlaneLevel !== null
        && z < nextHiddenPlaneLevel
      );
    }

    setPlacementPose(pose) {
      const nextPose = pose === 'wall' ? 'wall' : 'floor';
      if (this.panelPose === nextPose) return;
      this.panelPose = nextPose;
      if (this.config.onSetPanelPose) {
        this.config.onSetPanelPose(nextPose);
      } else {
        this.config.onTogglePanelPose?.();
      }
    }

    scheduleReactCommit(operations, meta) {
      const commit = () => {
        this.config.onCommitOperations?.(operations, meta);
      };
      if (typeof window === 'undefined' || !window.requestAnimationFrame) {
        const entry = { timerId: null };
        entry.timerId = setTimeout(() => {
          this.pendingCommitTimers = this.pendingCommitTimers.filter((item) => item !== entry);
          commit();
        }, 0);
        this.pendingCommitTimers.push(entry);
        return;
      }
      const entry = { frameId: null, timerId: null };
      entry.frameId = window.requestAnimationFrame(() => {
        entry.frameId = null;
        entry.timerId = setTimeout(() => {
          this.pendingCommitTimers = this.pendingCommitTimers.filter((item) => item !== entry);
          commit();
        }, 0);
      });
      this.pendingCommitTimers.push(entry);
    }

    invalidateMechanicalGraph() {
      this.mechanicalGraphCache = null;
      this.mechanicalGraphRevision = -1;
    }

    getMechanicalAssemblyGraph() {
      if (this.mechanicalGraphCache && this.mechanicalGraphRevision === this.mapRevision) {
        return this.mechanicalGraphCache;
      }
      this.mechanicalGraphCache = buildMechanicalAssemblies(this.mapData);
      this.mechanicalGraphRevision = this.mapRevision;
      return this.mechanicalGraphCache;
    }

    scheduleMechanicalLayerRedraw(delay = 48) {
      if (this.mechanicalLayerTimer) {
        this.mechanicalLayerTimer.remove(false);
        this.mechanicalLayerTimer = null;
      }
      this.mechanicalLayerTimer = this.time.addEvent({
        delay,
        callback: () => {
          this.mechanicalLayerTimer = null;
          this.drawMechanicalLayers();
        }
      });
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
      this.drawMechanicalLayers();
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
      this.removeRenderObject(`gear-far:tile:${key}`);
      this.removeRenderObject(`gear-near:tile:${key}`);
      this.removeRenderObject(`edge-overlay:tile:${key}`);
      this.removeRenderObject(`tile:${key}`);
      this.removeRenderObject(`tile-label:${key}`);
      this.removeRenderObject(`mechanism:${key}`);
    }

    removeWallObject(wall) {
      const key = createWallKey(wall.x, wall.y, wall.z, wall.edge);
      this.removeRenderObject(`gear-far:wall:${key}`);
      this.removeRenderObject(`gear-near:wall:${key}`);
      this.removeRenderObject(`edge-overlay:wall:${key}`);
      this.removeRenderObject(`wall:${key}`);
    }

    configureBoardImage(image) {
      if (!image) return image;
      return image.setDisplaySize(TILE_RENDER_WIDTH, TILE_RENDER_HEIGHT);
    }

    setBoardTexture(image, texture) {
      if (!image) return;
      image.setTexture(texture);
      this.configureBoardImage(image);
    }

    renderTileObject(tile) {
      if (!tile) return;
      if (!this.isPlacementVisible(tile)) {
        this.removeTileObject(tile);
        return;
      }
      const key = createCellKey(tile.x, tile.y, tile.z);
      this.removeTileObject(tile);
      const cell = { x: tile.x, y: tile.y, z: tile.z };
      const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
      const texture = this.textureCache.getTileTexture(tile.panelType, tile.rotation || 0, false, this.cameraState.yaw, getTransmissionSurfaceRotation(tile));
      const image = this.configureBoardImage(this.add.image(projection.x, projection.y, texture)
        .setOrigin(0.5, 0.57)
        .setAlpha(tile.transparent ? 0.72 : 1));
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
      this.redrawMountedGearHostLayers('tile', key, tile, depth);
      this.redrawVerticalStructureOverlay('tile', key, tile, depth);
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
      if (!this.isPlacementVisible(wall)) {
        this.removeWallObject(wall);
        return;
      }
      this.removeRenderObject(id);
      const cell = { x: wall.x, y: wall.y, z: wall.z };
      const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
      const miter = this.getWallMiterProfile(wall);
      const wallRotation = getWallSurfaceRotation(wall);
      const texture = this.textureCache.getWallTexture(wall.panelType, wall.edge, this.getEffectiveWallViewMode(), this.cameraState.yaw, wallRotation, miter, getTransmissionSurfaceRotation(wall));
      const image = this.configureBoardImage(this.add.image(projection.x, projection.y, texture).setOrigin(0.5, 0.57));
      image.setData('placementId', id);
      image.setData('kind', 'wall');
      image.depth = getPlacementDepth({
        cell,
        partType: 'wall_plane',
        physicalLayer: 'wall_plane',
        edge: wall.edge,
        rotation: wallRotation,
        cameraYaw: this.cameraState.yaw,
        mapData: this.mapData
      });
      this.mapLayer.add(image);
      this.renderObjects.set(id, image);
      this.redrawMountedGearHostLayers('wall', createWallKey(wall.x, wall.y, wall.z, wall.edge), wall, image.depth);
      this.redrawVerticalStructureOverlay('wall', createWallKey(wall.x, wall.y, wall.z, wall.edge), wall, image.depth);
    }

    getWallEndpointWorld(wall, endpointIndex = 0) {
      const endpoints = WALL_EDGE_ENDPOINTS[wall?.edge] || WALL_EDGE_ENDPOINTS.north;
      const endpoint = endpoints[endpointIndex] || endpoints[0];
      return {
        x: (Number(wall?.x) || 0) + endpoint.x,
        y: (Number(wall?.y) || 0) + endpoint.y,
        z: Number(wall?.z) || 0
      };
    }

    getWallMiterProfile(wall) {
      if (!wall?.edge) return null;
      const tangent = WALL_EDGE_TANGENTS[wall.edge] || WALL_EDGE_TANGENTS.north;
      const endpoints = [this.getWallEndpointWorld(wall, 0), this.getWallEndpointWorld(wall, 1)];
      const result = { start: 0, end: 0 };
      Object.values(this.mapData.walls || {}).forEach((other) => {
        if (!other || other === wall || other.edge === wall.edge || other.edge === OPPOSITE_EDGE[wall.edge]) return;
        const otherNormal = this.getGearSurfaceNormal(other, 'front');
        const sign = Math.sign((otherNormal.x * tangent.x) + (otherNormal.y * tangent.y));
        if (!sign) return;
        [0, 1].forEach((otherEndpointIndex) => {
          const otherPoint = this.getWallEndpointWorld(other, otherEndpointIndex);
          endpoints.forEach((endpoint, endpointIndex) => {
            if (Math.abs(endpoint.z - otherPoint.z) > 0.001) return;
            if (Math.hypot(endpoint.x - otherPoint.x, endpoint.y - otherPoint.y) > 0.001) return;
            if (endpointIndex === 0) result.start = sign;
            else result.end = sign;
          });
        });
      });
      return result.start || result.end ? result : null;
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
      container.setSize(96, 70);
      container.setInteractive(new Phaser.Geom.Rectangle(-48, -12, 96, 70), Phaser.Geom.Rectangle.Contains);

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

    getPressureCapPoints(tile, depression = 0, cameraYaw = this.cameraState.yaw) {
      const geometry = createTileGeometry(cameraYaw, tile.rotation || 0);
      return geometry.top.map((point) => ({
        x: point.x - TILE_RENDER_CENTER.x,
        y: point.y - TILE_RENDER_CENTER.y + depression
      }));
    }

    drawPressureCap(graphics, tile, progress = 0, cameraYaw = this.cameraState.yaw) {
      const depression = PRESS_TRAVEL * progress;
      const original = this.getPressureCapPoints(tile, 0, cameraYaw);
      const lowered = this.getPressureCapPoints(tile, depression, cameraYaw);
      const isInspectableCap = isTriggerMechanismTile(tile.panelType);
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
      graphics.fillStyle(isInspectableCap ? 0x7dd3fc : 0x64748b, isInspectableCap ? 0.38 : 0.96);
      graphics.lineStyle(2, progress > 0.02 ? 0x38bdf8 : 0xcbd5e1, progress > 0.02 ? 0.54 : 0.16);
      drawLocalPolygon(graphics, lowered);
      graphics.fillStyle(0x020617, isInspectableCap ? 0.06 : 0.18);
      drawLocalPolygon(graphics, this.getPressureCapPoints(tile, depression + 3, cameraYaw));
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

    drawCenteredPressureMechanism(graphics, tile, progress = 0, cameraYaw = this.cameraState.yaw, params = {}) {
      const layout = PRESSURE_PLATE_LAYOUT;
      const p = Math.max(0, Math.min(1, progress));
      const center = mapLayoutToScreen(layout.center);
      const springBottom = 38;
      const springTop = 4 + (PRESS_TRAVEL * p * 0.35);

      graphics.fillStyle(layoutColor.chamber, 0.72);
      graphics.lineStyle(1, 0x38bdf8, 0.24);
      graphics.fillEllipse(0, 31, 112, 48);
      graphics.strokeEllipse(0, 31, 112, 48);

      layout.springOffsets.forEach((spring) => {
        const point = mapLayoutToScreen(spring);
        drawCoilSpring(graphics, point.x, springTop, springBottom, p);
      });

      const plungerY = center.y + 5 + (PRESS_TRAVEL * p);
      graphics.fillStyle(layoutColor.plunger, 0.9);
      graphics.lineStyle(2, 0xc4b5fd, 0.48);
      graphics.fillEllipse(center.x, plungerY, 24, 12);
      graphics.fillRoundedRect(center.x - 8, plungerY, 16, 34, 5);

      const verticalTravel = layout.verticalPost.travel * 44 * p;
      graphics.fillStyle(0x155e75, 0.92);
      graphics.lineStyle(1, 0x67e8f9, 0.42);
      graphics.fillRoundedRect(center.x - 9, center.y - 18 - verticalTravel, 18, 42 + verticalTravel, 6);
      graphics.fillStyle(0xa5f3fc, 0.82);
      graphics.fillEllipse(center.x, center.y - 18 - verticalTravel, 28, 10);

      const projected = projectWorldOffset(
        Math.cos(((tile.rotation || 0) * Math.PI) / 180),
        Math.sin(((tile.rotation || 0) * Math.PI) / 180),
        cameraYaw
      );
      const direction = normalizeVector(projected);
      const normal = { x: -direction.y, y: direction.x };
      const base = { x: center.x, y: center.y + 14 };
      const horizontalTravel = layout.horizontalPost.travel * 44 * p;
      const length = (layout.horizontalPost.length * 44) + horizontalTravel;
      const tip = {
        x: base.x + (direction.x * length),
        y: base.y + (direction.y * length)
      };
      const width = 7;
      graphics.fillStyle(0xa5f3fc, 0.82);
      graphics.lineStyle(1, 0x67e8f9, 0.36);
      drawLocalPolygon(graphics, [
        { x: base.x + (normal.x * width), y: base.y + (normal.y * width) },
        { x: tip.x + (normal.x * width), y: tip.y + (normal.y * width) },
        { x: tip.x - (normal.x * width), y: tip.y - (normal.y * width) },
        { x: base.x - (normal.x * width), y: base.y - (normal.y * width) }
      ]);

      const gearAngle = p * (params.rotationAngle || 90);
      graphics.fillStyle(layoutColor.gear, 0.9);
      graphics.lineStyle(2, 0xfef3c7, 0.56);
      drawGearShape(graphics, center.x, center.y + 22, layout.gear.radius * 42, layout.gear.radius * 29, layout.gear.teeth, -gearAngle);
      drawJoint(graphics, center.x, center.y + 22, 4, 0xfbbf24);

      const signal = mapLayoutToScreen(layout.outputPorts.signal);
      graphics.fillStyle(layoutColor.port, 0.9);
      graphics.fillCircle(signal.x, signal.y + 10, 5);
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

    drawLinearOutput(graphics, tile, progress = 0, horizontal = false, cameraYaw = this.cameraState.yaw) {
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
        cameraYaw
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

    getMechanismVisualFlags(tile, progress = 0) {
      const key = tile ? createCellKey(tile.x, tile.y, tile.z) : '';
      const isSelected = this.selectedCells.some((cell) => createCellKey(cell.x, cell.y, cell.z) === key);
      const hoverHit = this.hoverTarget?.hit;
      const isHover = !!hoverHit?.cell && hoverHit.type === 'tile' && createCellKey(hoverHit.cell.x, hoverHit.cell.y, hoverHit.cell.z) === key;
      return {
        isSelected,
        isHover,
        isRunning: progress > 0.02
      };
    }

    drawMechanismSelectionGlow(graphics, flags = {}) {
      if (!flags.isSelected && !flags.isHover && !flags.isRunning) return;
      const alpha = flags.isSelected ? 0.58 : flags.isHover ? 0.34 : 0.26;
      graphics.lineStyle(flags.isSelected ? 3 : 2, flags.isRunning ? 0x22d3ee : 0x67e8f9, alpha);
      graphics.strokeEllipse(0, 27, flags.isSelected ? 118 : 108, flags.isSelected ? 42 : 36);
      graphics.fillStyle(0x22d3ee, flags.isSelected ? 0.08 : 0.04);
      graphics.fillEllipse(0, 29, 112, 38);
    }

    drawGearPressurePlateMechanism(graphics, tile, progress = 0, params = {}, cameraYaw = this.cameraState.yaw, flags = {}) {
      const p = Math.max(0, Math.min(1, Number(progress) || 0));
      this.drawMechanismSelectionGlow(graphics, flags);
      if (p <= 0.02 && !flags.isSelected && !flags.isHover && !flags.isRunning) return;
      const geometry = createTileGeometry(cameraYaw, tile.rotation || 0);
      const top = geometry.top.map((point) => ({
        x: point.x - TILE_RENDER_CENTER.x,
        y: point.y - TILE_RENDER_CENTER.y
      }));
      this.textureCache.drawGearPressurePlateCornerHint(graphics, { top }, 0.26 + (p * 0.34));
    }

    applyMechanismPose(tile, runtime, progress = 0, params = {}, cameraYaw = this.cameraState.yaw) {
      const graphics = runtime.graphics;
      if (!graphics) return;
      const p = Math.max(0, Math.min(1, Number(progress) || 0));
      const kind = getMechanismTemplateKind(tile.panelType);
      const flags = this.getMechanismVisualFlags(tile, p);
      graphics.clear();
      if (kind === CITY_CHANNEL_MECHANISM_KINDS.GEAR_PRESSURE_PLATE) {
        this.drawGearPressurePlateMechanism(graphics, tile, p, params, cameraYaw, flags);
      }
    }

    drawMechanismState(tile, runtime, progress = 0, params = {}, cameraYaw = this.cameraState.yaw) {
      this.applyMechanismPose(tile, runtime, progress, params, cameraYaw);
    }

    refreshMechanismVisuals() {
      Object.values(this.mapData.tiles || {}).forEach((tile) => {
        if (!isTriggerMechanismTile(tile.panelType)) return;
        const key = createCellKey(tile.x, tile.y, tile.z);
        const object = this.renderObjects.get(`mechanism:${key}`);
        const runtime = object?.getData('runtime');
        if (runtime) {
          this.drawMechanismState(tile, runtime, runtime.state.progress || 0, normalizeMechanismParams(this.mechanismParams?.[key]));
        }
      });
    }

    refreshPointerStateAfterViewChange() {
      const pointer = this.input?.activePointer;
      if (!pointer) {
        this.hoverTarget = null;
        this.hoverCell = null;
        this.hoverEdge = 'north';
        this.activeSnapAxisKey = '';
        this.snapPlaneCycle = 0;
        return;
      }
      const hitInfo = this.hitTest(pointer, {
        allowOutline: this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && !!this.activeTileType
      });
      this.updateHover(hitInfo);
    }

    sortMapLayer() {
      this.mapLayer.list.sort((a, b) => (a.depth || 0) - (b.depth || 0));
    }

    refreshAfterIncrementalEdit() {
      this.mapData.safeRoute = [];
      this.mapRevision += 1;
      this.invalidateMechanicalGraph();
      this.index.rebuild(this.mapData);
      this.sortMapLayer();
      this.drawRouteLayer();
      this.updateDebugText();
    }

    refreshTileSurfaceTexture(tile) {
      if (!tile) return;
      const key = createCellKey(tile.x, tile.y, tile.z);
      const object = this.renderObjects.get(`tile:${key}`);
      if (!object) return;
      this.setBoardTexture(object, this.textureCache.getTileTexture(
        tile.panelType,
        tile.rotation || 0,
        false,
        this.cameraState.yaw,
        getTransmissionSurfaceRotation(tile)
      ));
      this.redrawMountedGearHostLayers('tile', key, tile, object.depth || 0);
    }

    refreshWallSurfaceTexture(wall) {
      if (!wall) return;
      const key = createWallKey(wall.x, wall.y, wall.z, wall.edge);
      const object = this.renderObjects.get(`wall:${key}`);
      if (!object) return;
      this.setBoardTexture(object, this.textureCache.getWallTexture(
        wall.panelType,
        wall.edge,
        this.getEffectiveWallViewMode(),
        this.cameraState.yaw,
        getWallSurfaceRotation(wall),
        this.getWallMiterProfile(wall),
        getTransmissionSurfaceRotation(wall)
      ));
      this.redrawMountedGearHostLayers('wall', key, wall, object.depth || 0);
    }

    rotateTransmissionForPlacements(placements = [], direction = 'forward') {
      const list = Array.isArray(placements) ? placements : [];
      if (list.length <= 0) return false;
      const delta = direction === 'reverse' ? -90 : 90;
      let changed = false;

      list.forEach((placement) => {
        if (!placement) return;
        if (placement.edge) {
          const key = createWallKey(placement.x, placement.y, placement.z, placement.edge);
          const wall = this.mapData.walls?.[key];
          if (!wall) return;
          wall.transmissionRotation = normalizeRotation((wall.transmissionRotation || 0) + delta);
          this.refreshWallSurfaceTexture(wall);
          changed = true;
          return;
        }

        const key = createCellKey(placement.x, placement.y, placement.z);
        const tile = this.mapData.tiles?.[key];
        if (!tile) return;
        tile.transmissionRotation = normalizeRotation((tile.transmissionRotation ?? tile.rotation ?? 0) + delta);
        this.refreshTileSurfaceTexture(tile);
        changed = true;
      });

      if (!changed) return false;
      this.mapData.safeRoute = [];
      this.mapRevision += 1;
      this.invalidateMechanicalGraph();
      this.index.rebuild(this.mapData);
      this.drawMechanicalLayers();
      this.drawSelectionLayer();
      this.sortMapLayer();
      this.updateDebugText();
      return true;
    }

    refreshWallTextures() {
      Object.values(this.mapData.walls || {}).forEach((wall) => {
        const object = this.renderObjects.get(`wall:${createWallKey(wall.x, wall.y, wall.z, wall.edge)}`);
        if (!object) return;
        this.setBoardTexture(object, this.textureCache.getWallTexture(
          wall.panelType,
          wall.edge,
          this.getEffectiveWallViewMode(),
          this.cameraState.yaw,
          getWallSurfaceRotation(wall),
          this.getWallMiterProfile(wall),
          getTransmissionSurfaceRotation(wall)
        ));
      });
      Object.values(this.mapData.tiles || {}).forEach((tile) => {
        if (!tile.isVertical) return;
        const object = this.renderObjects.get(`tile:${createCellKey(tile.x, tile.y, tile.z)}`);
        if (!object) return;
        this.setBoardTexture(object, this.textureCache.getTileTexture(tile.panelType, tile.rotation || 0, false, this.cameraState.yaw, getTransmissionSurfaceRotation(tile)));
      });
      this.redrawAllMountedGearLayers();
      this.redrawAllVerticalStructureOverlays();
      this.sortMapLayer();
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
          this.setBoardTexture(object, this.textureCache.getTileTexture(tile.panelType, tile.rotation || 0, false, this.cameraState.yaw, getTransmissionSurfaceRotation(tile)));
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
          this.setBoardTexture(object, this.textureCache.getWallTexture(
            wall.panelType,
            wall.edge,
            this.getEffectiveWallViewMode(),
            this.cameraState.yaw,
            getWallSurfaceRotation(wall),
            this.getWallMiterProfile(wall),
            getTransmissionSurfaceRotation(wall)
          ));
        }
        object.depth = getPlacementDepth({
          cell,
          partType: 'wall_plane',
          physicalLayer: 'wall_plane',
          edge: wall.edge,
          rotation: getWallSurfaceRotation(wall),
          cameraYaw: this.cameraState.yaw,
          mapData: this.mapData
        });
      });
      this.redrawAllMountedGearLayers();
      this.redrawAllVerticalStructureOverlays();
      this.sortMapLayer();
      this.refreshPointerStateAfterViewChange();
      this.refreshMechanismVisuals();
      this.drawMechanicalLayers();
      this.drawRouteLayer();
      this.drawHelperLayer();
      this.drawSelectionLayer();
      this.drawGhostLayer(true);
      this.notifyCamera({ force: true });
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

    notifyCamera({ force = false } = {}) {
      const now = this.time?.now || Date.now();
      if (!force && now - this.lastCameraNotifyAt < 100) return;
      this.lastCameraNotifyAt = now;
      this.config.onCameraChange?.({
        zoom: this.cameraState.zoom,
        yaw: this.cameraState.yaw
      });
    }

    update(time, delta) {
      if (this.inspectState) return;
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
          this.refreshPointerStateAfterViewChange();
          this.drawSelectionLayer();
          this.drawGhostLayer(true);
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
      const cell = localToCellAtLayer({
        x: localPoint.x,
        y: localPoint.y,
        z: this.activeLayer || 0,
        cameraYaw: this.cameraState.yaw,
        mapData: this.mapData
      });
      return { localPoint, cell };
    }

    createPointerFromCanvasEvent(event) {
      const rect = this.game?.canvas?.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { x: event.clientX || 0, y: event.clientY || 0 };
      }
      return {
        x: ((event.clientX - rect.left) / rect.width) * this.scale.width,
        y: ((event.clientY - rect.top) / rect.height) * this.scale.height
      };
    }

    normalizeInspectableHit(hit) {
      if (hit?.type === 'mechanical_port') {
        return {
          type: 'tile',
          cell: hit.cell,
          panelType: hit.panelType,
          hitZone: 'base',
          tile: hit.tile
        };
      }
      return hit;
    }

    handleCanvasDoubleClick(event) {
      if (this.inspectState || this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE) return;
      const pointer = this.createPointerFromCanvasEvent(event);
      const hitInfo = this.hitTest(pointer, { allowOutline: true });
      const hit = this.normalizeInspectableHit(hitInfo.hit);
      if (!hit || hit.type !== 'tile' || !isTriggerMechanismTile(hit.panelType)) return;
      event.preventDefault();
      event.stopPropagation();
      this.lastMechanismDown = null;
      this.pendingMechanicalPort = null;
      this.inspectHitTile(hit);
      this.drawMechanicalLayers();
    }

    resolveWallSnapTarget(localPoint, seedCell = null) {
      if (!localPoint) return null;
      const candidateCells = new Map();
      const addCandidateCell = (cell) => {
        if (!cell || !isValidCell(cell.x, cell.y, cell.z, this.mapData)) return;
        candidateCells.set(createCellKey(cell.x, cell.y, cell.z), { x: cell.x, y: cell.y, z: cell.z });
      };
      if (seedCell) getNeighborCells(seedCell, this.mapData).forEach(addCandidateCell);
      else Object.values(this.mapData.tiles || {}).forEach((tile) => {
        if (this.isCarryMovingPlacement(tile)) return;
        addCandidateCell(tile);
      });

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

    resolveWallPlacementTarget(hitInfo, { allowReplacement = false } = {}) {
      if (this.isVerticalSurfaceHit(hitInfo?.hit)) {
        const target = this.resolveVerticalSurfaceWallSnap(hitInfo, { allowReplacement });
        return target?.valid ? target : null;
      }
      const visibleFloorCell = hitInfo?.hit?.type === 'tile'
        && hitInfo.hit.tile
        && !this.isCarryMovingPlacement(hitInfo.hit.tile)
        && !hitInfo.hit.tile.isVertical
        ? hitInfo.hit.cell
        : null;
      const snapped = visibleFloorCell
        ? this.resolveWallSnapTarget(hitInfo?.localPoint, visibleFloorCell)
        : (hitInfo?.wallSnap || this.resolveWallSnapTarget(hitInfo?.localPoint, hitInfo?.cell));
      if (snapped?.cell) return snapped;
      return null;
    }

    resolveWallGhostTarget(hitInfo, { allowReplacement = false } = {}) {
      if (this.isVerticalSurfaceHit(hitInfo?.hit)) return this.resolveVerticalSurfaceWallSnap(hitInfo, { allowReplacement });
      const placementTarget = this.resolveWallPlacementTarget(hitInfo, { allowReplacement });
      if (placementTarget?.cell) return placementTarget;
      return null;
    }

    isVerticalSurfaceHit(hit) {
      return !!hit && (
        hit.type === 'wall'
        || (hit.type === 'tile' && hit.tile?.isVertical)
      );
    }

    hasTileSupport(cell) {
      if (!cell) return false;
      if (cell.z <= 0) return true;
      return !!this.mapData.tiles?.[createCellKey(cell.x, cell.y, cell.z - 1)];
    }

    hasFloorPlacementSupport(cell, anchorCell = null) {
      if (this.hasTileSupport(cell)) return true;
      if (!cell || !anchorCell || Number(cell.z) !== Number(anchorCell.z)) return false;
      return Math.abs(Number(cell.x) - Number(anchorCell.x)) + Math.abs(Number(cell.y) - Number(anchorCell.y)) === 1
        && !!this.mapData.tiles?.[createCellKey(anchorCell.x, anchorCell.y, anchorCell.z)];
    }

    getStructuralPlacementKey(placement = {}) {
      if (!placement) return '';
      return placement.edge
        ? createWallKey(placement.x, placement.y, placement.z, placement.edge)
        : createCellKey(placement.x, placement.y, placement.z);
    }

    isSupportStructurallyGrounded(support, visited = new Set()) {
      if (!support?.placement) return false;
      return this.isPlacementStructurallyGrounded(
        support.placement,
        support.key || this.getStructuralPlacementKey(support.placement),
        visited
      );
    }

    isGroundedFloorTileAt(cell, visited = new Set()) {
      if (!cell || !isValidCell(cell.x, cell.y, cell.z, this.mapData)) return false;
      const key = createCellKey(cell.x, cell.y, cell.z);
      const tile = this.mapData.tiles?.[key];
      if (!tile || tile.isVertical || isPortalMaterial(tile.panelType)) return false;
      return this.isPlacementStructurallyGrounded(tile, key, visited);
    }

    isGroundedWallAt(cell, edge = 'north', visited = new Set()) {
      if (!cell || !isValidCell(cell.x, cell.y, cell.z, this.mapData)) return false;
      const key = createWallKey(cell.x, cell.y, cell.z, edge);
      const wall = this.mapData.walls?.[key];
      if (!wall) return false;
      return this.isPlacementStructurallyGrounded(wall, key, visited);
    }

    hasGroundedWallFootSupport(cell, edge = 'north', visited = new Set()) {
      if (!cell) return false;
      const offset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
      const supportCells = [
        { x: cell.x, y: cell.y, z: cell.z },
        { x: cell.x + offset.x, y: cell.y + offset.y, z: cell.z }
      ];
      if (supportCells.some((supportCell) => this.isGroundedFloorTileAt(supportCell, new Set(visited)))) return true;
      if ((Number(cell.z) || 0) <= 0) return false;
      const lowerSupportCells = supportCells.map((supportCell) => ({
        ...supportCell,
        z: supportCell.z - 1
      }));
      return lowerSupportCells.some((supportCell) => this.isGroundedFloorTileAt(supportCell, new Set(visited)))
        || this.isGroundedWallAt({ x: cell.x, y: cell.y, z: cell.z - 1 }, edge, new Set(visited));
    }

    hasGroundedVerticalFloorSupport(cell, visited = new Set()) {
      if (!cell) return false;
      return this.getVerticalSupportEntries().some((support) => {
        if (!this.isSupportStructurallyGrounded(support, new Set(visited))) return false;
        const dx = Math.abs((Number(cell.x) || 0) - (Number(support.cell?.x) || 0));
        const dy = Math.abs((Number(cell.y) || 0) - (Number(support.cell?.y) || 0));
        if (dx + dy > 1) return false;
        const dz = (Number(cell.z) || 0) - (Number(support.cell?.z) || 0);
        return dz >= 0 && dz <= 1;
      });
    }

    getVerticalSnapSupportCell(support = {}) {
      const placement = support.placement || support.cell || {};
      return {
        x: Number(placement.x) || 0,
        y: Number(placement.y) || 0,
        z: Number(placement.z) || 0
      };
    }

    getVerticalSnapSupportEdgeSegment(support, direction = 'north') {
      if (!support?.placement && !support?.cell) return null;
      return this.getAbsoluteWallEdgeEndpoints(this.getVerticalSnapSupportCell(support), direction);
    }

    getActiveVerticalPlacementAxisSegment(cell) {
      if (!cell || !this.isActiveVerticalBoardPlacement()) return null;
      const endpoints = getCellVerticalEndpoints(this.activeRotation || 0);
      if (!Array.isArray(endpoints) || endpoints.length < 2) return null;
      return endpoints.map((point) => ({
        x: (Number(cell.x) || 0) + point.x,
        y: (Number(cell.y) || 0) + point.y
      }));
    }

    hasVerticalSnapStructuralEdgeSupport(cell, edge = null, snap = {}) {
      if (!cell || !snap?.support) return false;
      const supportCell = this.getVerticalSnapSupportCell(snap.support);
      if (snap.side === 'top') {
        const segment = this.getSupportAxisSegment(snap.support);
        if (!segment) return false;
        if (edge) {
          return sameAxisSegment(this.getAbsoluteWallEdgeEndpoints(cell, edge), segment);
        }
        const activeVerticalSegment = this.getActiveVerticalPlacementAxisSegment(cell);
        if (activeVerticalSegment) {
          return sameAxisSegment(activeVerticalSegment, segment);
        }
        if ((Number(cell.z) || 0) !== supportCell.z + 1) return false;
        const dx = Math.abs((Number(cell.x) || 0) - supportCell.x);
        const dy = Math.abs((Number(cell.y) || 0) - supportCell.y);
        const sameSupportCell = dx === 0 && dy === 0;
        if (sameSupportCell && snap.support?.kind !== 'wall') return false;
        if (!sameSupportCell && dx + dy !== 1) return false;
        return Object.keys(EDGE_NEIGHBOR_OFFSETS).some((direction) => (
          sameAxisSegment(this.getAbsoluteWallEdgeEndpoints(cell, direction), segment)
        ));
      }
      if (snap.side === 'side' && edge && snap.direction) {
        if (snap.support?.kind === 'wall') {
          const vertex = this.getSupportAxisVertex(snap.support, snap.direction);
          return this.getAbsoluteWallEdgeEndpoints(cell, edge)
            .some((point) => sameAxisPoint(point, vertex));
        }
        return sameAxisSegment(
          this.getAbsoluteWallEdgeEndpoints(cell, edge),
          this.getVerticalSnapSupportEdgeSegment(snap.support, snap.direction)
        );
      }
      return false;
    }

    hasGroundedFloorPlacementSupport(cell, anchorCell = null, primarySupport = null, visited = new Set()) {
      if (!cell || !isValidCell(cell.x, cell.y, cell.z, this.mapData)) return false;
      if ((Number(cell.z) || 0) <= 0) return true;
      if (primarySupport && this.isSupportStructurallyGrounded(primarySupport, new Set(visited))) return true;
      if (this.isGroundedFloorTileAt({ x: cell.x, y: cell.y, z: cell.z - 1 }, new Set(visited))) return true;
      if (
        anchorCell
        && Number(cell.z) === Number(anchorCell.z)
        && Math.abs(Number(cell.x) - Number(anchorCell.x)) + Math.abs(Number(cell.y) - Number(anchorCell.y)) === 1
        && this.isGroundedFloorTileAt(anchorCell, new Set(visited))
      ) {
        return true;
      }
      if (Object.values(EDGE_NEIGHBOR_OFFSETS).some((offset) => this.isGroundedFloorTileAt({
        x: cell.x + offset.x,
        y: cell.y + offset.y,
        z: cell.z
      }, new Set(visited)))) {
        return true;
      }
      return this.hasGroundedVerticalFloorSupport(cell, new Set(visited));
    }

    hasGroundedWallPlacementSupport(cell, edge = 'north', primarySupport = null, visited = new Set()) {
      if (!cell || !edge || !isValidCell(cell.x, cell.y, cell.z, this.mapData)) return false;
      if (primarySupport && this.isSupportStructurallyGrounded(primarySupport, new Set(visited))) return true;
      return this.hasGroundedWallFootSupport(cell, edge, new Set(visited));
    }

    isPlacementStructurallyGrounded(placement, key = '', visited = new Set()) {
      if (!placement) return false;
      const placementKey = key || this.getStructuralPlacementKey(placement);
      if (!placementKey) return false;
      if (visited.has(placementKey)) return false;
      visited.add(placementKey);
      if ((Number(placement.z) || 0) <= 0) return true;
      if (placement.edge) {
        return this.hasGroundedWallFootSupport(placement, placement.edge, visited);
      }
      if (placement.isVertical) {
        return this.isGroundedFloorTileAt(placement, new Set(visited))
          || Object.values(EDGE_NEIGHBOR_OFFSETS).some((offset) => this.isGroundedFloorTileAt({
            x: placement.x + offset.x,
            y: placement.y + offset.y,
            z: placement.z
          }, new Set(visited)));
      }
      return this.hasGroundedFloorPlacementSupport(placement, null, null, visited);
    }

    resolveVerticalSnapConnection(targetCell, support, snap = {}) {
      if (!targetCell || !support?.placement) return { valid: false };
      const activeEdge = snap.activeEdge || null;
      const activePlacement = activeEdge
        ? createWall({
          x: targetCell.x,
          y: targetCell.y,
          z: targetCell.z,
          edge: activeEdge,
          panelType: this.activeTileType,
          transmissionRotation: this.activeRotation
        })
        : createTile({
          x: targetCell.x,
          y: targetCell.y,
          z: targetCell.z,
          panelType: this.activeTileType,
          rotation: this.activeRotation
        });
      const activeKey = activeEdge
        ? createWallKey(targetCell.x, targetCell.y, targetCell.z, activeEdge)
        : createCellKey(targetCell.x, targetCell.y, targetCell.z);
      const activePorts = getWorldTransmissionPorts(activePlacement, activeKey);
      const supportPorts = getWorldTransmissionPorts(support.placement, support.key);
      const endpointMode = snap.endpointMode || 'socket';
      const activeDirection = snap.activeDirection || null;
      const supportDirection = snap.supportDirection || null;
      const activeCandidates = snap.activePortId
        ? activePorts.filter((port) => port.id === snap.activePortId)
        : endpointMode === 'socket'
          ? activePorts
          : activePorts.filter((port) => !activeDirection || port.worldDirection === activeDirection);
      const supportCandidates = snap.supportPortId
        ? supportPorts.filter((port) => port.id === snap.supportPortId)
        : endpointMode === 'socket'
          ? supportPorts
          : supportPorts.filter((port) => !supportDirection || port.worldDirection === supportDirection);
      let best = null;
      activeCandidates.forEach((candidateActivePort) => {
        const candidateActivePoint = this.getTransmissionSurfacePortPoint(activePlacement, candidateActivePort, activeEdge ? 'wall' : null);
        const candidateActiveSocket = this.getTransmissionSocketPoint(activePlacement, candidateActivePort, activeEdge ? 'wall' : null);
        if (!candidateActivePoint || !candidateActiveSocket) return;
        supportCandidates.forEach((candidateSupportPort) => {
          const candidateSupportPoint = this.getTransmissionSurfacePortPoint(support.placement, candidateSupportPort, support.kind === 'wall' ? 'wall' : null);
          const candidateSupportSocket = this.getTransmissionSocketPoint(support.placement, candidateSupportPort, support.kind === 'wall' ? 'wall' : null);
          if (!candidateSupportPoint || !candidateSupportSocket) return;
          const socketDistance = Math.hypot(
            candidateActiveSocket.x - candidateSupportSocket.x,
            candidateActiveSocket.y - candidateSupportSocket.y,
            candidateActiveSocket.z - candidateSupportSocket.z
          );
          const endpointDistance = Math.hypot(
            candidateActivePoint.x - candidateSupportPoint.x,
            candidateActivePoint.y - candidateSupportPoint.y
          );
          if (
            best
            && (
              socketDistance > best.socketDistance
              || (Math.abs(socketDistance - best.socketDistance) <= 1e-6 && endpointDistance >= best.endpointDistance)
            )
          ) return;
          best = {
            activePort: candidateActivePort,
            activePoint: candidateActivePoint,
            activeSocket: candidateActiveSocket,
            supportPort: candidateSupportPort,
            supportPoint: candidateSupportPoint,
            supportSocket: candidateSupportSocket,
            endpointDistance,
            socketDistance
          };
        });
      });
      return {
        valid: !!best && best.socketDistance <= TRANSMISSION_SOCKET_EPSILON,
        activeTile: activePlacement,
        activePort: best?.activePort || null,
        activePoint: best?.activePoint || null,
        activeSocket: best?.activeSocket || null,
        support,
        supportPort: best?.supportPort || null,
        supportPoint: best?.supportPoint || null,
        supportSocket: best?.supportSocket || null,
        endpointDistance: best?.endpointDistance ?? Infinity,
        socketDistance: best?.socketDistance ?? Infinity,
        endpointMode
      };
    }

    getVerticalSupportConnectionCandidates(targetCell, primarySupport = null) {
      if (!targetCell) return primarySupport ? [primarySupport] : [];
      const supports = this.getVerticalSnapSupportEntries();
      const seen = new Set();
      const candidates = [];
      const addSupport = (support) => {
        if (!this.isSupportEligibleForSnap(support)) return;
        if (!support?.key || seen.has(support.key)) return;
        seen.add(support.key);
        candidates.push(support);
      };
      addSupport(primarySupport);
      supports.forEach((support) => {
        if (!support?.cell) return;
        const dz = Number(targetCell.z) - Number(support.cell.z);
        if (dz < 0 || dz > 1) return;
        if (Math.abs(Number(targetCell.x) - Number(support.cell.x)) > 1) return;
        if (Math.abs(Number(targetCell.y) - Number(support.cell.y)) > 1) return;
        addSupport(support);
      });
      return candidates;
    }

    resolveBestVerticalSnapConnection(targetCell, primarySupport, snap = {}) {
      const primaryConnection = this.resolveVerticalSnapConnection(targetCell, primarySupport, snap);
      if (snap.allowAlternateSupport !== true) return primaryConnection;
      let best = primaryConnection;
      this.getVerticalSupportConnectionCandidates(targetCell, primarySupport).forEach((support) => {
        const candidateSnap = support.key === primarySupport?.key
          ? snap
          : {
            activeEdge: snap.activeEdge || null,
            endpointMode: 'socket'
          };
        const connection = this.resolveVerticalSnapConnection(targetCell, support, candidateSnap);
        if (
          !best
          || (connection.valid && !best.valid)
          || (
            connection.valid === best.valid
            && connection.socketDistance < best.socketDistance
          )
          || (
            connection.valid === best.valid
            && Math.abs(connection.socketDistance - best.socketDistance) <= 1e-6
            && connection.endpointDistance < best.endpointDistance
          )
        ) {
          best = connection;
        }
      });
      return best || primaryConnection;
    }

    resolveSingleFloorSnapConnection(targetCell, activePlacement, activePorts, supportTile) {
      if (!targetCell || !activePlacement || !supportTile) return { valid: false };
      const support = {
        kind: 'tile',
        key: createCellKey(supportTile.x, supportTile.y, supportTile.z),
        cell: { x: supportTile.x, y: supportTile.y, z: supportTile.z },
        placement: supportTile
      };
      const supportPorts = getWorldTransmissionPorts(supportTile, support.key);
      if (activePorts.length <= 0) {
        return {
          valid: true,
          activeTile: activePlacement,
          support,
          socketDistance: 0,
          endpointDistance: 0,
          endpointMode: 'socket'
        };
      }
      let best = null;
      activePorts.forEach((candidateActivePort) => {
        const candidateActivePoint = this.getTransmissionSurfacePortPoint(activePlacement, candidateActivePort);
        const candidateActiveSocket = this.getTransmissionSocketPoint(activePlacement, candidateActivePort);
        if (!candidateActivePoint || !candidateActiveSocket) return;
        supportPorts.forEach((candidateSupportPort) => {
          const candidateSupportPoint = this.getTransmissionSurfacePortPoint(supportTile, candidateSupportPort);
          const candidateSupportSocket = this.getTransmissionSocketPoint(supportTile, candidateSupportPort);
          if (!candidateSupportPoint || !candidateSupportSocket) return;
          const socketDistance = Math.hypot(
            candidateActiveSocket.x - candidateSupportSocket.x,
            candidateActiveSocket.y - candidateSupportSocket.y,
            candidateActiveSocket.z - candidateSupportSocket.z
          );
          const endpointDistance = Math.hypot(
            candidateActivePoint.x - candidateSupportPoint.x,
            candidateActivePoint.y - candidateSupportPoint.y
          );
          if (
            best
            && (
              socketDistance > best.socketDistance
              || (Math.abs(socketDistance - best.socketDistance) <= 1e-6 && endpointDistance >= best.endpointDistance)
            )
          ) return;
          best = {
            activePort: candidateActivePort,
            activePoint: candidateActivePoint,
            activeSocket: candidateActiveSocket,
            supportPort: candidateSupportPort,
            supportPoint: candidateSupportPoint,
            supportSocket: candidateSupportSocket,
            endpointDistance,
            socketDistance
          };
        });
      });
      return {
        valid: !!best && best.socketDistance <= TRANSMISSION_SOCKET_EPSILON,
        activeTile: activePlacement,
        activePort: best?.activePort || null,
        activePoint: best?.activePoint || null,
        activeSocket: best?.activeSocket || null,
        support,
        supportPort: best?.supportPort || null,
        supportPoint: best?.supportPoint || null,
        supportSocket: best?.supportSocket || null,
        endpointDistance: best?.endpointDistance ?? Infinity,
        socketDistance: best?.socketDistance ?? Infinity,
        endpointMode: 'socket'
      };
    }

    resolveFloorSnapConnection(targetCell, supportTile = null) {
      if (!targetCell) return { valid: false };
      const activePlacement = createTile({
        x: targetCell.x,
        y: targetCell.y,
        z: targetCell.z,
        panelType: this.activeTileType,
        rotation: this.activeRotation
      });
      const activeKey = createCellKey(targetCell.x, targetCell.y, targetCell.z);
      const activePorts = getWorldTransmissionPorts(activePlacement, activeKey);
      const supportCandidates = [];
      const seen = new Set();
      const addSupport = (tile) => {
        if (!tile || tile.isVertical || isPortalMaterial(tile.panelType)) return;
        const key = createCellKey(tile.x, tile.y, tile.z);
        if (seen.has(key)) return;
        seen.add(key);
        supportCandidates.push(tile);
      };
      addSupport(supportTile);
      Object.values(EDGE_NEIGHBOR_OFFSETS).forEach((offset) => {
        const tile = this.mapData.tiles?.[createCellKey(
          targetCell.x + offset.x,
          targetCell.y + offset.y,
          targetCell.z
        )];
        addSupport(tile);
      });
      if (activePorts.length <= 0) {
        const support = supportCandidates[0]
          ? {
            kind: 'tile',
            key: createCellKey(supportCandidates[0].x, supportCandidates[0].y, supportCandidates[0].z),
            cell: { x: supportCandidates[0].x, y: supportCandidates[0].y, z: supportCandidates[0].z },
            placement: supportCandidates[0]
          }
          : null;
        return {
          valid: true,
          activeTile: activePlacement,
          support,
          socketDistance: 0,
          endpointDistance: 0,
          endpointMode: 'socket'
        };
      }
      let best = null;
      supportCandidates.forEach((candidateSupportTile) => {
        const connection = this.resolveSingleFloorSnapConnection(targetCell, activePlacement, activePorts, candidateSupportTile);
        if (
          !best
          || (connection.valid && !best.valid)
          || (
            connection.valid === best.valid
            && connection.socketDistance < best.socketDistance
          )
          || (
            connection.valid === best.valid
            && Math.abs(connection.socketDistance - best.socketDistance) <= 1e-6
            && connection.endpointDistance < best.endpointDistance
          )
        ) {
          best = connection;
        }
      });
      return best || {
        valid: false,
        activeTile: activePlacement,
        support: null,
        endpointDistance: Infinity,
        socketDistance: Infinity,
        endpointMode: 'socket'
      };
    }

    getTransmissionSocketPoint(placement, port, forcedSurface = null) {
      if (!placement || !port) return null;
      const rotation = getTransmissionSurfaceRotation(placement);
      const local = port.worldLocalPosition || rotateLocalPoint(port.localPosition || { x: 0, y: 0 }, rotation);
      if (forcedSurface === 'wall' || placement.edge || placement.isVertical) {
        const endpoints = placement.edge
          ? (WALL_EDGE_ENDPOINTS[placement.edge] || WALL_EDGE_ENDPOINTS.north)
          : getCellVerticalEndpoints(placement.rotation || 0);
        const u = Math.max(0, Math.min(1, (local.x || 0) + 0.5));
        const lerp = (a, b, t) => a + ((b - a) * t);
        return {
          x: (Number(placement.x) || 0) + lerp(endpoints[0].x, endpoints[1].x, u),
          y: (Number(placement.y) || 0) + lerp(endpoints[0].y, endpoints[1].y, u),
          z: (Number(placement.z) || 0) + 0.5 - (local.y || 0)
        };
      }
      return {
        x: (Number(placement.x) || 0) + (local.x || 0),
        y: (Number(placement.y) || 0) + (local.y || 0),
        z: Number(placement.z) || 0
      };
    }

    getTransmissionSurfacePortPoint(placement, port, forcedSurface = null) {
      if (!placement || !port) return null;
      const projection = projectCell(placement, this.cameraState.yaw, this.mapData);
      const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
      const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
      if (forcedSurface === 'wall' || placement.edge) {
        const rotation = getTransmissionSurfaceRotation(placement);
        const geometry = placement.edge
          ? createEdgeWallGeometry(this.cameraState.yaw, placement.edge)
          : createTileGeometry(this.cameraState.yaw, rotation);
        const transmissionPlane = getTransmissionMidPlane(geometry, 'wall');
        return this.getGhostBoardPoint(
          transmissionPlane,
          port.localPosition,
          rotation,
          offsetX,
          offsetY,
          'wall'
        );
      }
      const geometry = createTileGeometry(this.cameraState.yaw, placement.rotation || 0);
      const surface = placement.isVertical ? 'wall' : 'floor';
      const transmissionPlane = getTransmissionPortPlane(geometry, surface);
      return this.getGhostBoardPoint(
        transmissionPlane,
        port.localPosition,
        getTransmissionSurfaceRotation(placement),
        offsetX,
        offsetY,
        surface
      );
    }

    getVerticalTopSnapSpec(support) {
      if (!support?.placement) return {};
      const ports = getWorldTransmissionPorts(support.placement, support.key);
      const topPort = ports
        .map((port) => ({
          port,
          socket: this.getTransmissionSocketPoint(support.placement, port, support.kind === 'wall' ? 'wall' : null),
          point: this.getTransmissionSurfacePortPoint(support.placement, port, support.kind === 'wall' ? 'wall' : null)
        }))
        .filter((entry) => entry.socket)
        .sort((a, b) => (
          (b.socket.z - a.socket.z)
          || ((a.point?.y ?? 0) - (b.point?.y ?? 0))
        ))[0]?.port || null;
      return {
        activeDirection: OPPOSITE_EDGE[topPort?.worldDirection],
        supportDirection: topPort?.worldDirection,
        supportPortId: topPort?.id,
        endpointMode: 'socket'
      };
    }

    getSupportPrimaryEdge(support) {
      if (support?.kind === 'wall' && support.edge) return support.edge;
      return rotateDirectionByDegrees('north', support?.placement?.rotation || 0);
    }

    getAbsoluteWallEdgeEndpoints(cell, edge = 'north') {
      const endpoints = WALL_EDGE_ENDPOINTS[edge] || WALL_EDGE_ENDPOINTS.north;
      return endpoints.map((point) => ({
        x: (Number(cell?.x) || 0) + point.x,
        y: (Number(cell?.y) || 0) + point.y
      }));
    }

    getWallPhysicalKey(cell, edge = 'north') {
      const endpoints = this.getAbsoluteWallEdgeEndpoints(cell, edge)
        .map((point) => `${formatAxisCoord(point.x)},${formatAxisCoord(point.y)}`)
        .sort();
      return `${Number(cell?.z) || 0}:${endpoints.join('|')}`;
    }

    isWallPhysicalPlaneOccupied(cell, edge = 'north') {
      const physicalKey = this.getWallPhysicalKey(cell, edge);
      return Object.values(this.mapData.walls || {}).some((wall) => (
        this.getWallPhysicalKey(wall, wall.edge) === physicalKey
      ));
    }

    getSupportAxisSegment(support) {
      if (!support?.placement) return null;
      const localEndpoints = support.kind === 'wall'
        ? (WALL_EDGE_ENDPOINTS[support.placement.edge] || WALL_EDGE_ENDPOINTS.north)
        : getCellVerticalEndpoints(support.placement.rotation || 0);
      return localEndpoints.map((point) => ({
        x: (Number(support.placement.x) || 0) + point.x,
        y: (Number(support.placement.y) || 0) + point.y
      }));
    }

    getSupportAxisVertex(support, direction) {
      const segment = this.getSupportAxisSegment(support);
      if (!segment) return null;
      const endpointDirections = support.kind === 'wall'
        ? (WALL_EDGE_ENDPOINTS[support.placement.edge] || WALL_EDGE_ENDPOINTS.north).map(getDirectionFromEndpoint)
        : getCellVerticalEndpoints(support.placement.rotation || 0).map(getDirectionFromEndpoint);
      const index = endpointDirections.indexOf(direction);
      return segment[index >= 0 ? index : 0] || null;
    }

    getNearbyAxisCells(points = [], z = 0, padding = 1) {
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const minX = Math.floor(Math.min(...xs) - padding);
      const maxX = Math.ceil(Math.max(...xs) + padding);
      const minY = Math.floor(Math.min(...ys) - padding);
      const maxY = Math.ceil(Math.max(...ys) + padding);
      const cells = [];
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          if (isValidCell(x, y, z, this.mapData)) cells.push({ x, y, z });
        }
      }
      return cells;
    }

    findWallCandidatesForSegment(segment, z = 0) {
      if (!Array.isArray(segment) || segment.length < 2) return [];
      const seen = new Set();
      const candidates = [];
      this.getNearbyAxisCells(segment, z, 1).forEach((cell) => {
        Object.keys(EDGE_NEIGHBOR_OFFSETS).forEach((edge) => {
          if (!sameAxisSegment(this.getAbsoluteWallEdgeEndpoints(cell, edge), segment)) return;
          const physicalKey = this.getWallPhysicalKey(cell, edge);
          if (seen.has(physicalKey)) return;
          seen.add(physicalKey);
          candidates.push({ cell, edge, physicalKey });
        });
      });
      return candidates;
    }

    findFloorCandidatesForSegment(segment, z = 0) {
      if (!Array.isArray(segment) || segment.length < 2) return [];
      const seen = new Set();
      const candidates = [];
      this.getNearbyAxisCells(segment, z, 1).forEach((cell) => {
        const hasSharedEdge = Object.keys(EDGE_NEIGHBOR_OFFSETS).some((edge) => (
          sameAxisSegment(this.getAbsoluteWallEdgeEndpoints(cell, edge), segment)
        ));
        if (!hasSharedEdge) return;
        const key = createCellKey(cell.x, cell.y, cell.z);
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({ cell, key });
      });
      return candidates;
    }

    findWallCandidatesForVertex(vertex, z = 0) {
      if (!vertex) return [];
      const seen = new Set();
      const candidates = [];
      this.getNearbyAxisCells([vertex], z, 1).forEach((cell) => {
        Object.keys(EDGE_NEIGHBOR_OFFSETS).forEach((edge) => {
          if (!this.getAbsoluteWallEdgeEndpoints(cell, edge).some((point) => sameAxisPoint(point, vertex))) return;
          const physicalKey = this.getWallPhysicalKey(cell, edge);
          if (seen.has(physicalKey)) return;
          seen.add(physicalKey);
          candidates.push({ cell, edge, physicalKey });
        });
      });
      return candidates;
    }

    getPreferredAxisPlacementIndex(options = []) {
      if (!options.length) return 0;
      const preferredKind = this.panelPose === 'wall' ? 'wall' : 'floor';
      const preferredIndex = options.findIndex((option) => option.kind === preferredKind && option.valid !== false);
      return preferredIndex >= 0 ? preferredIndex : 0;
    }

    getSnapAxisEdge(snap) {
      if (!snap) return null;
      if (snap.axisEdge) return snap.axisEdge;
      if (snap.side === 'top') return this.getSupportPrimaryEdge(snap.support);
      return OPPOSITE_EDGE[snap.direction] || snap.direction || 'north';
    }

    getSnapAxisKey(snap) {
      if (!snap?.cell || !snap.support) return '';
      const axisEdge = this.getSnapAxisEdge(snap);
      return `${snap.support.key}:${snap.side || ''}:${snap.direction || ''}:${axisEdge || ''}:${createCellKey(snap.cell.x, snap.cell.y, snap.cell.z)}`;
    }

    getVerticalTopPortDirection(support) {
      if (!support?.placement) return null;
      if (support.kind === 'wall') return support.placement.edge || 'north';
      return rotateDirectionByDegrees('north', support.placement.rotation || 0);
    }

    getVerticalSurfaceSnapEdge(hitInfo, support) {
      if (!hitInfo?.localPoint || !support?.placement) return null;
      const projection = projectCell(support.placement, this.cameraState.yaw, this.mapData);
      const localPoint = {
        x: hitInfo.localPoint.x - projection.x + (TILE_RENDER_WIDTH * 0.5),
        y: hitInfo.localPoint.y - projection.y + (TILE_RENDER_HEIGHT * 0.57)
      };
      const geometry = support.kind === 'wall'
        ? createEdgeWallGeometry(this.cameraState.yaw, support.placement.edge)
        : createTileGeometry(this.cameraState.yaw, support.placement.rotation || 0);
      const wall = geometry.wall;
      if (!Array.isArray(wall) || wall.length < 4) return null;
      const threshold = Math.max(12, (VERTICAL_SURFACE_EDGE_SNAP_SCREEN_RADIUS * 1.8) / Math.max(0.55, this.cameraState.zoom || 1));
      const endpointDirections = support.kind === 'wall'
        ? (WALL_EDGE_ENDPOINTS[support.placement.edge] || WALL_EDGE_ENDPOINTS.north).map(getDirectionFromEndpoint)
        : getCellVerticalEndpoints(support.placement.rotation || 0).map(getDirectionFromEndpoint);
      const edges = [
        {
          side: 'side',
          direction: endpointDirections[0],
          distanceSquared: distancePointToSegmentSquared(localPoint, wall[0], wall[3])
        },
        {
          side: 'side',
          direction: endpointDirections[1],
          distanceSquared: distancePointToSegmentSquared(localPoint, wall[1], wall[2])
        },
        {
          side: 'top',
          direction: 'up',
          distanceSquared: distancePointToSegmentSquared(localPoint, wall[2], wall[3])
        }
      ].sort((a, b) => a.distanceSquared - b.distanceSquared);
      const best = edges[0];
      if (!best) return null;
      if (best.distanceSquared <= threshold * threshold) return best;
      // 鼠标已命中竖直可见面时，允许退化到“最近边”吸附，避免穿透到背后。
      if (hitInfo?.hit?.gearSurfacePlane) return best;
      return null;
    }

    getFloorSurfaceSnapIntent(hitInfo, tile) {
      if (!hitInfo?.localPoint || !tile || tile.isVertical || isPortalMaterial(tile.panelType)) return null;
      const projection = projectCell(tile, this.cameraState.yaw, this.mapData);
      const localPoint = {
        x: hitInfo.localPoint.x - projection.x + (TILE_RENDER_WIDTH * 0.5),
        y: hitInfo.localPoint.y - projection.y + (TILE_RENDER_HEIGHT * 0.57)
      };
      const geometry = createTileGeometry(this.cameraState.yaw, tile.rotation || 0);
      if (!pointInPolygon(localPoint, geometry.top)) return null;
      const threshold = Math.max(8, FLOOR_EDGE_SNAP_SCREEN_RADIUS / Math.max(0.45, this.cameraState.zoom || 1));
      const edges = [
        { direction: 'north', distanceSquared: distancePointToSegmentSquared(localPoint, geometry.top[0], geometry.top[1]) },
        { direction: 'east', distanceSquared: distancePointToSegmentSquared(localPoint, geometry.top[1], geometry.top[2]) },
        { direction: 'south', distanceSquared: distancePointToSegmentSquared(localPoint, geometry.top[2], geometry.top[3]) },
        { direction: 'west', distanceSquared: distancePointToSegmentSquared(localPoint, geometry.top[3], geometry.top[0]) }
      ].sort((a, b) => a.distanceSquared - b.distanceSquared);
      const best = edges[0];
      if (best && best.distanceSquared <= threshold * threshold) {
        return { mode: 'edge', ...best };
      }
      return {
        mode: 'center',
        direction: best?.direction || 'north',
        distanceSquared: best?.distanceSquared ?? Infinity
      };
    }

    getFloorSurfaceSnapEdge(hitInfo, tile) {
      const intent = this.getFloorSurfaceSnapIntent(hitInfo, tile);
      return intent?.mode === 'edge' ? intent : null;
    }

    getFloorReplacementTarget(hitInfo) {
      const hit = hitInfo?.hit;
      if (!hit || hit.type !== 'tile' || !hit.tile || hit.tile.isVertical || isPortalMaterial(hit.tile.panelType)) return null;
      const intent = this.getFloorSurfaceSnapIntent(hitInfo, hit.tile);
      if (intent?.mode !== 'center') return null;
      return {
        kind: 'floor',
        cell: { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z },
        valid: true,
        replace: true
      };
    }

    isActiveVerticalBoardPlacement() {
      const primaryPlacement = this.carryState?.kind === 'placement'
        ? this.getCarryPrimaryPlacement()
        : null;
      if (this.carryState?.kind === 'placement') {
        return this.getCarryDefaultPose(primaryPlacement) === 'wall';
      }
      const material = getCityChannelMaterial(this.activeTileType);
      return !!(primaryPlacement?.isVertical || material?.isVertical);
    }

    findHorizontalFloorTileUnderPointer(hitInfo) {
      if (!hitInfo?.localPoint) return null;
      const hit = hitInfo.hit;
      if (
        hit?.type === 'tile'
        && hit.tile
        && !this.isCarryMovingPlacement(hit.tile)
        && !hit.tile.isVertical
        && !isPortalMaterial(hit.tile.panelType)
      ) {
        const directIntent = this.getFloorSurfaceSnapIntent(hitInfo, hit.tile);
        if (directIntent) return hit.tile;
      }
      let best = null;
      Object.values(this.mapData.tiles || {}).forEach((tile) => {
        if (!tile || tile.isVertical || isPortalMaterial(tile.panelType)) return;
        if (this.isCarryMovingPlacement(tile)) return;
        if (!this.isPlacementVisible(tile)) return;
        const intent = this.getFloorSurfaceSnapIntent(hitInfo, tile);
        if (!intent) return;
        const distanceSquared = intent.mode === 'center'
          ? 0
          : (Number.isFinite(intent.distanceSquared) ? intent.distanceSquared : Infinity);
        const projection = projectCell(tile, this.cameraState.yaw, this.mapData);
        const foregroundBias = projection.y || 0;
        const score = distanceSquared - (foregroundBias * 0.02);
        if (!best || score < best.score) {
          best = { tile, score, distanceSquared };
        }
      });
      return best?.tile || null;
    }

    getCarryOriginTargetCell() {
      const anchor = this.carryState?.anchor || getSelectionAnchor(this.carryState?.origins || []);
      if (!anchor) return null;
      if (this.carryState?.kind === 'placement' && this.getCarryDefaultPose() === 'floor') {
        return {
          x: anchor.x,
          y: anchor.y,
          z: anchor.z
        };
      }
      return {
        x: anchor.x,
        y: anchor.y,
        z: anchor.z,
        ...(anchor.edge ? { edge: anchor.edge } : {})
      };
    }

    hasCarryPointerMoved(hitInfo = null) {
      const grab = this.carryState?.grabLocalPoint;
      const point = hitInfo?.localPoint;
      if (!grab || !point) return false;
      return Math.hypot(point.x - grab.x, point.y - grab.y) > 12;
    }

    normalizeCarryHitInfoLayer(hitInfo = null) {
      if (this.carryState?.kind !== 'placement' || !hitInfo?.cell || hitInfo.hit) return hitInfo;
      const anchor = this.carryState.anchor || getSelectionAnchor(this.carryState.origins || []);
      const anchorZ = Number(anchor?.z);
      if (!Number.isFinite(anchorZ)) return hitInfo;
      return {
        ...hitInfo,
        cell: {
          ...hitInfo.cell,
          z: anchorZ
        }
      };
    }

    getCarryEffectiveHitInfo(hitInfo = null) {
      const base = hitInfo || this.getCarryPlacementHitInfo();
      const center = this.carryState?.geometricCenter;
      const grab = this.carryState?.grabLocalPoint;
      if (!base?.localPoint || !center || !grab) return this.normalizeCarryHitInfoLayer(base);
      const effectiveLocalPoint = {
        x: center.x + (base.localPoint.x - grab.x),
        y: center.y + (base.localPoint.y - grab.y)
      };
      const zoom = this.cameraState.zoom || 1;
      const pointer = {
        x: this.worldLayer.x + (effectiveLocalPoint.x * zoom),
        y: this.worldLayer.y + (effectiveLocalPoint.y * zoom)
      };
      const effectiveHit = this.hitTest(pointer, { allowOutline: true });
      return this.normalizeCarryHitInfoLayer({
        ...(effectiveHit || base),
        localPoint: effectiveLocalPoint
      });
    }

    resolveCarryPlacementLikePlace(hitInfo) {
      const snap = this.resolvePlacementEdgeSnap(hitInfo);
      if (snap) {
        const axisKey = this.getSnapAxisKey(snap);
        const options = this.getAxisPlacementOptions(snap).filter((option) => option?.valid !== false);
        if (axisKey && options.length > 0) {
          if (this.carryState?.snapAxisKey !== axisKey) {
            if (this.carryState) {
              this.carryState.snapAxisKey = axisKey;
              this.carryState.snapPlaneCycle = this.getPreferredAxisPlacementIndex(options);
            }
          }
          const cycle = this.carryState?.snapPlaneCycle || 0;
          const index = ((cycle % options.length) + options.length) % options.length;
          const option = options[index] || options[0];
          if (option?.cell) {
            return {
              x: option.cell.x,
              y: option.cell.y,
              z: option.cell.z,
              ...(option.kind === 'wall' ? { edge: option.edge } : {})
            };
          }
        }
      }
      const target = this.resolveDynamicPlacementTarget(hitInfo, {
        forGhost: true,
        snap: null,
        allowReplacement: false
      });
      if (!target?.cell) return null;
      if (target.valid === false || target.blocked) {
        return { blocked: true, reason: target.reason || 'placement_occupied' };
      }
      return {
        x: target.cell.x,
        y: target.cell.y,
        z: target.cell.z,
        ...(target.kind === 'wall' && target.edge ? { edge: target.edge } : {}),
        ...(target.layFlat || target.cell.layFlat ? { layFlat: true } : {})
      };
    }

    resolveVerticalPanelFloorTopSnap(hitInfo) {
      if (!hitInfo?.localPoint || !isBoardMaterial(this.activeTileType) || isPortalMaterial(this.activeTileType)) return null;
      if (!this.isActiveVerticalBoardPlacement()) return null;
      const hit = hitInfo.hit;
      const floorTile = this.findHorizontalFloorTileUnderPointer(hitInfo)
        || (hit?.type === 'tile' && hit.tile && !hit.tile.isVertical && !isPortalMaterial(hit.tile.panelType) ? hit.tile : null);
      if (!floorTile) return null;
      const intent = this.getFloorSurfaceSnapIntent(hitInfo, floorTile);
      if (!intent) return null;
      const cell = { x: floorTile.x, y: floorTile.y, z: floorTile.z + 1 };
      if (!isValidCell(cell.x, cell.y, cell.z, this.mapData)) return null;
      const support = {
        kind: 'tile',
        key: createCellKey(floorTile.x, floorTile.y, floorTile.z),
        cell: { x: floorTile.x, y: floorTile.y, z: floorTile.z },
        placement: floorTile
      };
      const occupied = this.isPlacementCellOccupiedForSnap(cell);
      const connection = this.resolveVerticalSnapConnection(cell, support, this.getVerticalTopSnapSpec(support));
      const snap = {
        cell,
        occupied,
        valid: !occupied,
        connection,
        support,
        side: 'top',
        direction: 'up',
        axisEdge: this.getSupportPrimaryEdge(support),
        distanceSquared: intent.mode === 'center' ? 0 : intent.distanceSquared
      };
      return occupied
        ? { ...snap, blocked: true, reason: 'placement_occupied' }
        : snap;
    }

    resolveFloorEdgePlacementTarget(hitInfo, { forceNearestEdge = false } = {}) {
      if (!hitInfo?.localPoint || !isBoardMaterial(this.activeTileType) || isPortalMaterial(this.activeTileType)) return null;
      const hit = hitInfo.hit;
      if (!hit || hit.type !== 'tile' || !hit.tile || hit.tile.isVertical || isPortalMaterial(hit.tile.panelType)) return null;
      const edgeIntent = this.getFloorSurfaceSnapIntent(hitInfo, hit.tile);
      if (!edgeIntent || (edgeIntent.mode !== 'edge' && !forceNearestEdge)) return null;
      const edgeHit = edgeIntent;
      const offset = EDGE_NEIGHBOR_OFFSETS[edgeHit.direction];
      const target = {
        x: hit.tile.x + (offset?.x || 0),
        y: hit.tile.y + (offset?.y || 0),
        z: hit.tile.z
      };
      if (!isValidCell(target.x, target.y, target.z, this.mapData)) return null;
      const occupied = this.isPlacementCellOccupiedForSnap(target);
      if (occupied) {
        return {
          blocked: true,
          reason: 'placement_occupied',
          cell: target,
          sourceSnap: {
            side: 'floor',
            direction: edgeHit.direction,
            cell: target
          }
        };
      }
      const support = {
        kind: 'tile',
        key: createCellKey(hit.tile.x, hit.tile.y, hit.tile.z),
        cell: { x: hit.tile.x, y: hit.tile.y, z: hit.tile.z },
        placement: hit.tile
      };
      // 搬运竖直板时，边缘吸附到水平地板的邻居格必须强制转水平（layFlat）。
      // 否则竖直板会以“水平占位、视觉竖直”的状态落到空白邻居，造成数据与渲染不一致。
      const layFlatForCarry = this.carryState?.kind === 'placement' && this.isActiveVerticalBoardPlacement();
      return {
        kind: 'floor',
        cell: target,
        valid: true,
        connection: null,
        sourceSnap: {
          side: 'floor',
          direction: edgeHit.direction,
          support,
          cell: target
        },
        distanceSquared: edgeHit.distanceSquared,
        ...(layFlatForCarry ? { layFlat: true } : {})
      };
    }

    resolveVerticalSurfaceSnap(hitInfo) {
      const hit = hitInfo?.hit;
      if (!hit || !isBoardMaterial(this.activeTileType) || isPortalMaterial(this.activeTileType)) return null;
      let support = null;
      if (hit.type === 'wall') {
        const wall = hit.wall || this.mapData.walls?.[createWallKey(hit.cell.x, hit.cell.y, hit.cell.z, hit.edge)];
        if (!wall) return null;
        support = {
          kind: 'wall',
          key: createWallKey(hit.cell.x, hit.cell.y, hit.cell.z, hit.edge),
          edge: hit.edge,
          placement: wall
        };
      } else if (hit.type === 'tile' && hit.tile?.isVertical) {
        support = {
          kind: 'tile',
          key: createCellKey(hit.cell.x, hit.cell.y, hit.cell.z),
          edge: null,
          placement: hit.tile
        };
      }
      if (!support) return null;
      if (!this.isSupportEligibleForSnap(support)) return null;
      const snapEdge = this.getVerticalSurfaceSnapEdge(hitInfo, support);
      if (!snapEdge) return null;
      const sideOffset = snapEdge.side === 'side' ? EDGE_NEIGHBOR_OFFSETS[snapEdge.direction] : null;
      const axisEdge = snapEdge.side === 'top'
        ? this.getSupportPrimaryEdge(support)
        : (OPPOSITE_EDGE[snapEdge.direction] || snapEdge.direction || 'north');
      const zCandidates = snapEdge.side === 'side'
        ? [hit.cell.z, hit.cell.z + 1]
        : [hit.cell.z + 1];
      let best = null;
      zCandidates.forEach((z, index) => {
        const cell = {
          x: hit.cell.x + (sideOffset?.x || 0),
          y: hit.cell.y + (sideOffset?.y || 0),
          z
        };
        if (!isValidCell(cell.x, cell.y, cell.z, this.mapData)) return;
        const occupied = this.isPlacementCellOccupiedForSnap(cell);
        const snapSpec = snapEdge.side === 'side'
          ? {
            activeDirection: OPPOSITE_EDGE[snapEdge.direction],
            supportDirection: snapEdge.direction,
            endpointMode: 'socket'
          }
          : this.getVerticalTopSnapSpec(support);
        const connection = this.resolveVerticalSnapConnection(cell, support, snapSpec);
        const candidate = {
          cell,
          occupied,
          valid: !occupied,
          connection,
          support,
          axisEdge,
          side: snapEdge.side,
          direction: snapEdge.direction,
          priority: index
        };
        if (
          !best
          || (candidate.valid && !best.valid)
          || (candidate.valid === best.valid && candidate.priority < best.priority)
        ) {
          best = candidate;
        }
      });
      return best?.occupied
        ? { ...best, blocked: true, reason: 'placement_occupied' }
        : best;
    }

    getVerticalSupportEntries() {
      const supports = [];
      Object.values(this.mapData.tiles || {}).forEach((tile) => {
        if (!tile?.isVertical || isPortalMaterial(tile.panelType)) return;
        supports.push({
          kind: 'tile',
          key: createCellKey(tile.x, tile.y, tile.z),
          cell: { x: tile.x, y: tile.y, z: tile.z },
          placement: tile
        });
      });
      Object.values(this.mapData.walls || {}).forEach((wall) => {
        supports.push({
          kind: 'wall',
          key: createWallKey(wall.x, wall.y, wall.z, wall.edge),
          cell: { x: wall.x, y: wall.y, z: wall.z },
          edge: wall.edge,
          placement: wall
        });
      });
      return supports;
    }

    isSupportFromCarryMovingSelection(support) {
      if (!support?.key || this.carryState?.kind !== 'placement') return false;
      const movingHostKeys = getMovingHostKeysFromOrigins(this.carryState.origins || []);
      return movingHostKeys.has(support.key);
    }

    isSupportEligibleForSnap(support) {
      if (!support?.placement) return false;
      if (this.isSupportFromCarryMovingSelection(support)) return false;
      return this.isSupportStructurallyGrounded(support, new Set());
    }

    getVerticalSnapSupportEntries() {
      return this.getVerticalSupportEntries().filter((support) => this.isSupportEligibleForSnap(support));
    }

    getVerticalGapCandidateCells(support) {
      if (!support?.cell) return [];
      const base = support.cell;
      const cells = [
        { x: base.x, y: base.y, z: base.z + 1, snapSide: 'top', direction: 'up' }
      ];
      Object.entries(EDGE_NEIGHBOR_OFFSETS).forEach(([direction, offset]) => {
        cells.push({
          x: base.x + offset.x,
          y: base.y + offset.y,
          z: base.z + 1,
          snapSide: 'side',
          direction
        });
      });
      if (support.kind === 'wall' && support.edge) {
        const offset = EDGE_NEIGHBOR_OFFSETS[support.edge];
        if (offset) {
          cells.push({
            x: base.x + offset.x,
            y: base.y + offset.y,
            z: base.z + 1,
            snapSide: 'side',
            direction: support.edge
          });
        }
      }
      return cells;
    }

    resolveVerticalGapFloorSnap(hitInfo) {
      if (!hitInfo?.localPoint || !isBoardMaterial(this.activeTileType) || isPortalMaterial(this.activeTileType)) return null;
      const geometry = createTileGeometry(this.cameraState.yaw, this.activeRotation);
      const hitSupportKey = hitInfo.hit?.type === 'wall'
        ? createWallKey(hitInfo.hit.cell.x, hitInfo.hit.cell.y, hitInfo.hit.cell.z, hitInfo.hit.edge)
        : hitInfo.hit?.type === 'tile' && hitInfo.hit.tile?.isVertical
          ? createCellKey(hitInfo.hit.cell.x, hitInfo.hit.cell.y, hitInfo.hit.cell.z)
          : null;
      if (!hitSupportKey) return null;
      let best = null;
      const seen = new Set();
      this.getVerticalSnapSupportEntries().forEach((support) => {
        if (hitSupportKey && support.key !== hitSupportKey) return;
        const supportSnapEdge = this.getVerticalSurfaceSnapEdge(hitInfo, support);
        if (!supportSnapEdge) return;
        this.getVerticalGapCandidateCells(support).forEach((candidate) => {
          if (candidate.snapSide !== supportSnapEdge.side) return;
          if (candidate.snapSide === 'side' && candidate.direction !== supportSnapEdge.direction) return;
          if (!isValidCell(candidate.x, candidate.y, candidate.z, this.mapData)) return;
          const key = `${createCellKey(candidate.x, candidate.y, candidate.z)}:${support.key}:${candidate.direction}`;
          if (seen.has(key)) return;
          seen.add(key);
          const projection = projectCell(candidate, this.cameraState.yaw, this.mapData);
          const point = {
            x: hitInfo.localPoint.x - projection.x + (TILE_RENDER_WIDTH * 0.5),
            y: hitInfo.localPoint.y - projection.y + (TILE_RENDER_HEIGHT * 0.57)
          };
          const bounds = expandRect(getPointBounds(geometry.top), 10);
          if (!pointInPolygon(point, geometry.top) && !rectContainsPoint(bounds, point)) return;
          const center = this.getGhostBoardPoint(
            geometry.top,
            { x: 0, y: 0 },
            this.activeRotation,
            projection.x - (TILE_RENDER_WIDTH * 0.5),
            projection.y - (TILE_RENDER_HEIGHT * 0.57),
            'floor'
          );
          const distanceSquared = center
            ? ((hitInfo.localPoint.x - center.x) ** 2) + ((hitInfo.localPoint.y - center.y) ** 2)
            : 0;
          const snap = candidate.snapSide === 'side'
            ? {
              activeDirection: OPPOSITE_EDGE[candidate.direction],
              supportDirection: candidate.direction,
              endpointMode: 'socket'
            }
            : this.getVerticalTopSnapSpec(support);
          const cell = { x: candidate.x, y: candidate.y, z: candidate.z };
          const occupied = this.isPlacementCellOccupiedForSnap(cell);
          const connection = this.resolveVerticalSnapConnection(cell, support, snap);
          const candidateSnap = {
            cell,
            occupied,
            valid: !occupied,
            connection,
            support,
            axisEdge: candidate.snapSide === 'top'
              ? this.getSupportPrimaryEdge(support)
              : (OPPOSITE_EDGE[candidate.direction] || candidate.direction || 'north'),
            side: candidate.snapSide,
            direction: candidate.direction,
            distanceSquared
          };
          if (
            !best
            || (candidateSnap.valid && !best.valid)
            || (candidateSnap.valid === best.valid && candidateSnap.distanceSquared < best.distanceSquared)
          ) {
            best = candidateSnap;
          }
        });
      });
      return best?.occupied
        ? { ...best, blocked: true, reason: 'placement_occupied' }
        : best;
    }

    resolveVerticalSurfaceWallSnap(hitInfo, { allowReplacement = false } = {}) {
      const hit = hitInfo?.hit;
      if (!hit || !isBoardMaterial(this.activeTileType) || isPortalMaterial(this.activeTileType)) return null;
      let support = null;
      if (hit.type === 'wall') {
        const wall = hit.wall || this.mapData.walls?.[createWallKey(hit.cell.x, hit.cell.y, hit.cell.z, hit.edge)];
        if (!wall) return null;
        support = {
          kind: 'wall',
          key: createWallKey(hit.cell.x, hit.cell.y, hit.cell.z, hit.edge),
          edge: hit.edge,
          placement: wall
        };
      } else if (hit.type === 'tile' && hit.tile?.isVertical) {
        support = {
          kind: 'tile',
          key: createCellKey(hit.cell.x, hit.cell.y, hit.cell.z),
          edge: null,
          placement: hit.tile
        };
      }
      if (!support) return null;
      if (allowReplacement && support.kind === 'wall') {
        return {
          cell: { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z },
          edge: support.edge,
          valid: true,
          replace: true,
          connection: this.resolveVerticalSnapConnection(
            { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z },
            support,
            {
              activeEdge: support.edge,
              endpointMode: 'socket'
            }
          )
        };
      }
      if (allowReplacement && support.kind === 'tile') {
        const edge = this.getSupportPrimaryEdge(support);
        return {
          cell: { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z },
          edge,
          valid: true,
          replace: true,
          connection: this.resolveVerticalSnapConnection(
            { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z },
            support,
            {
              activeEdge: edge,
              endpointMode: 'socket'
            }
          )
        };
      }
      if (!this.isSupportEligibleForSnap(support)) return null;
      const snapEdge = this.getVerticalSurfaceSnapEdge(hitInfo, support);
      if (!snapEdge) return null;
      if (snapEdge.side === 'top') {
        const cell = { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z + 1 };
        const edge = this.getSupportPrimaryEdge(support);
        const blocked = this.isPlacementWallOccupiedForSnap(cell, edge);
        const connection = this.resolveVerticalSnapConnection(cell, support, {
          activeEdge: edge,
          ...this.getVerticalTopSnapSpec(support)
        });
        const structurallySupported = this.hasVerticalSnapStructuralEdgeSupport(cell, edge, {
          support,
          side: 'top',
          direction: snapEdge.direction
        });
        if (blocked) {
          if (allowReplacement) return { cell, edge, valid: true, replace: true, connection };
          return { cell, edge, blocked: true, reason: 'placement_occupied', connection };
        }
        return {
          cell,
          edge,
          valid: structurallySupported && isValidCell(cell.x, cell.y, cell.z, this.mapData) && !blocked,
          connection
        };
      }
      const sideOffset = EDGE_NEIGHBOR_OFFSETS[snapEdge.direction];
      if (!sideOffset) return null;
      const cell = {
        x: hit.cell.x + sideOffset.x,
        y: hit.cell.y + sideOffset.y,
        z: hit.cell.z
      };
      const edge = OPPOSITE_EDGE[snapEdge.direction] || snapEdge.direction;
      const connection = this.resolveVerticalSnapConnection(cell, support, {
        activeEdge: edge,
        activeDirection: OPPOSITE_EDGE[snapEdge.direction],
        supportDirection: snapEdge.direction,
        endpointMode: 'socket'
      });
      const structurallySupported = this.hasVerticalSnapStructuralEdgeSupport(cell, edge, {
        support,
        side: 'side',
        direction: snapEdge.direction
      });
      const blocked = this.isPlacementWallOccupiedForSnap(cell, edge);
      if (blocked) {
        if (allowReplacement) return { cell, edge, valid: true, replace: true, connection };
        return { cell, edge, blocked: true, reason: 'placement_occupied', connection };
      }
      return {
        cell,
        edge,
        valid: structurallySupported && isValidCell(cell.x, cell.y, cell.z, this.mapData) && !blocked,
        connection
      };
    }

    resolveFloorPlacementTarget(hitInfo, { allowReplacement = false, forceEdgeSnap = !allowReplacement } = {}) {
      const floorEdgeTarget = this.resolveFloorEdgePlacementTarget(hitInfo, { forceNearestEdge: forceEdgeSnap });
      if (floorEdgeTarget) return floorEdgeTarget;
      const verticalSnap = this.resolveVerticalSurfaceSnap(hitInfo) || this.resolveVerticalGapFloorSnap(hitInfo);
      if (verticalSnap?.blocked) return verticalSnap;
      if (verticalSnap) return verticalSnap.valid ? verticalSnap.cell : null;
      const hitTile = hitInfo?.hit?.type === 'tile' ? hitInfo.hit.tile : null;
      const hitTileMoving = this.isCarryMovingPlacement(hitTile);
      if (hitInfo?.hit?.type === 'wall' || (hitTile && !hitTileMoving && hitTile.isVertical)) {
        return null;
      }
      if (allowReplacement) {
        const replacementTarget = this.getFloorReplacementTarget(hitInfo);
        if (replacementTarget) return replacementTarget;
      }
      if (hitTile && !hitTileMoving && !isPortalMaterial(hitTile.panelType)) return null;
      const cell = hitInfo?.cell;
      if (!cell) return null;
      if (!isBoardMaterial(this.activeTileType) || isPortalMaterial(this.activeTileType)) return cell;
      const activeVertical = this.isActiveVerticalBoardPlacement();

      const directKey = createCellKey(cell.x, cell.y, cell.z);
      const rawDirectTile = this.mapData.tiles?.[directKey];
      const directTile = this.isCarryMovingPlacement(rawDirectTile) ? null : rawDirectTile;
      if (activeVertical) {
        if (directTile && !directTile.isVertical && !isPortalMaterial(directTile.panelType)) {
          // 搬运竖直板悬停到已有水平地板的格子上：标记为 layFlat。
          // 这样 move preview 会按“水平板覆盖到原水平地板”的方式参与碰撞检测，
          // 直接给出红色冲突反馈，避免原本的“悬空竖直”或“静默覆盖地板”。
          if (this.carryState?.kind === 'placement') {
            return { x: cell.x, y: cell.y, z: cell.z, layFlat: true };
          }
          return cell;
        }
        // 搬运（move）时允许将竖直板放平到有结构支撑的空格，使其转为水平板。
        if (this.carryState?.kind === 'placement' && !directTile && this.hasTileSupport(cell)) {
          return { x: cell.x, y: cell.y, z: cell.z, layFlat: true };
        }
        return null;
      }
      if (directTile) return cell;
      return this.hasTileSupport(cell) ? cell : null;
    }

    resolveAxisRotatedWallTarget(snap) {
      if (!snap?.cell || !snap.support) return null;
      const edge = this.getSnapAxisEdge(snap) || 'north';
      const connection = this.resolveVerticalSnapConnection(snap.cell, snap.support, {
        activeEdge: edge,
        endpointMode: 'socket'
      });
      const structurallySupported = this.hasVerticalSnapStructuralEdgeSupport(snap.cell, edge, snap);
      return {
        cell: snap.cell,
        edge,
        valid: structurallySupported
          && isValidCell(snap.cell.x, snap.cell.y, snap.cell.z, this.mapData)
          && !this.isPlacementWallOccupiedForSnap(snap.cell, edge),
        connection,
        sourceSnap: snap
      };
    }

    createAxisFloorTarget(cell, snap) {
      if (!cell || !snap?.support) return null;
      if (!isValidCell(cell.x, cell.y, cell.z, this.mapData)) return null;
      if (this.isPlacementCellOccupiedForSnap(cell)) return null;
      if (this.isActiveVerticalBoardPlacement()) {
        const floorTile = this.mapData.tiles?.[createCellKey(cell.x, cell.y, cell.z)];
        if (!floorTile || floorTile.isVertical || isPortalMaterial(floorTile.panelType)) return null;
      }
      const connection = this.resolveVerticalSnapConnection(cell, snap.support, snap.side === 'top'
        ? this.getVerticalTopSnapSpec(snap.support)
        : {
          activeDirection: OPPOSITE_EDGE[snap.direction],
          supportDirection: snap.direction,
          endpointMode: 'socket'
        });
      if (!this.hasVerticalSnapStructuralEdgeSupport(cell, null, snap)) return null;
      return {
        kind: 'floor',
        cell: { x: cell.x, y: cell.y, z: cell.z },
        valid: true,
        connection,
        sourceSnap: snap
      };
    }

    createAxisWallTarget(cell, edge, snap) {
      if (!cell || !edge || !snap?.support) return null;
      if (!isValidCell(cell.x, cell.y, cell.z, this.mapData)) return null;
      if (this.isPlacementWallOccupiedForSnap(cell, edge)) return null;
      const connection = this.resolveVerticalSnapConnection(cell, snap.support, {
        activeEdge: edge,
        endpointMode: 'socket'
      });
      if (!this.hasVerticalSnapStructuralEdgeSupport(cell, edge, snap)) return null;
      return {
        kind: 'wall',
        cell: { x: cell.x, y: cell.y, z: cell.z },
        edge,
        valid: true,
        connection,
        sourceSnap: snap
      };
    }

    getAxisPlacementOptions(snap) {
      if (!snap?.cell || !snap.support) return [];
      const options = [];
      const seen = new Set();
      const addOption = (option) => {
        if (!option?.cell) return;
        const key = this.getAxisOptionKey(option);
        if (seen.has(key)) return;
        seen.add(key);
        options.push(option);
      };

      if (snap.side === 'top') {
        const segment = this.getSupportAxisSegment(snap.support);
        const z = snap.cell.z;
        const floorCandidates = this.findFloorCandidatesForSegment(segment, z);
        const wallCandidates = this.findWallCandidatesForSegment(segment, z);
        const floorCells = floorCandidates.length > 0
          ? floorCandidates.map((candidate) => candidate.cell)
          : [snap.cell];
        floorCells.forEach((cell) => addOption(this.createAxisFloorTarget(cell, snap)));
        wallCandidates.forEach((candidate) => {
          addOption(this.createAxisWallTarget(candidate.cell, candidate.edge, snap));
        });
        if (wallCandidates.length <= 0) {
          const fallbackWall = this.resolveAxisRotatedWallTarget(snap);
          addOption(fallbackWall ? { ...fallbackWall, kind: 'wall' } : null);
        }
        return options;
      }

      const sideSegment = this.getVerticalSnapSupportEdgeSegment(snap.support, snap.direction);
      const wallCandidates = [];
      if (sideSegment) {
        wallCandidates.push(...this.findWallCandidatesForSegment(sideSegment, snap.cell.z));
      }
      if (snap.support?.kind === 'wall') {
        const vertex = this.getSupportAxisVertex(snap.support, snap.direction);
        if (vertex) {
          wallCandidates.push(...this.findWallCandidatesForVertex(vertex, snap.cell.z));
        }
      }
      wallCandidates.forEach((candidate) => {
        addOption(this.createAxisWallTarget(candidate.cell, candidate.edge, snap));
      });
      if (wallCandidates.length <= 0) {
        const fallbackWall = this.resolveAxisRotatedWallTarget(snap);
        if (fallbackWall && this.hasVerticalSnapStructuralEdgeSupport(fallbackWall.cell, fallbackWall.edge, snap)) {
          addOption({ ...fallbackWall, kind: 'wall' });
        }
      }
      return options;
    }

    getAxisOptionKey(target) {
      if (!target?.cell) return '';
      const isWall = target.kind === 'wall' || !!target.edge;
      return isWall
        ? `wall:${this.getWallPhysicalKey(target.cell, target.edge)}`
        : `floor:${createCellKey(target.cell.x, target.cell.y, target.cell.z)}`;
    }

    getAxisOptionKindForPose(pose = 'floor') {
      return pose === 'wall' ? 'wall' : 'floor';
    }

    getAxisOptionIndex(options = [], target = null) {
      const key = this.getAxisOptionKey(target);
      return key
        ? options.findIndex((option) => this.getAxisOptionKey(option) === key)
        : -1;
    }

    getAxisOptionIndexInAllOptions(allOptions = [], target = null) {
      const key = this.getAxisOptionKey(target);
      return key
        ? allOptions.findIndex((option) => this.getAxisOptionKey(option) === key)
        : -1;
    }

    getAxisPlacementTarget(snap) {
      const options = this.getAxisPlacementOptions(snap);
      if (!options.length) return null;
      const index = ((this.snapPlaneCycle || 0) % options.length + options.length) % options.length;
      return options[index] || options[0];
    }

    getPlacementTargetKey(target) {
      if (!target?.cell) return '';
      const cellKey = createCellKey(target.cell.x, target.cell.y, target.cell.z);
      return target.kind === 'wall'
        ? `wall:${cellKey}:${target.edge || ''}`
        : `floor:${cellKey}`;
    }

    getActivePointerPlacementHitInfo() {
      const pointer = this.input?.activePointer;
      return pointer
        ? this.hitTest(pointer, { allowOutline: true })
        : {
          cell: this.hoverCell,
          hit: this.hoverTarget?.hit,
          edge: this.hoverEdge,
          localPoint: this.hoverTarget?.localPoint
        };
    }

    rotateActivePlacement(delta) {
      const hitInfo = this.getActivePointerPlacementHitInfo();
      const previousSnap = this.resolvePlacementEdgeSnap(hitInfo);
      const previousTarget = this.resolveDynamicPlacementTarget(hitInfo, {
        forGhost: true,
        snap: previousSnap,
        allowReplacement: false
      });
      const previousTargetKey = this.getPlacementTargetKey(previousTarget);
      this.activeRotation = ((this.activeRotation + delta) % 360 + 360) % 360;
      this.config.onRotateActive?.(delta);
      if (previousTargetKey && previousSnap) {
        const nextSnap = this.resolvePlacementEdgeSnap(hitInfo);
        const nextSnapAxisKey = this.getSnapAxisKey(nextSnap);
        const nextOptions = this.getAxisPlacementOptions(nextSnap);
        const nextIndex = nextOptions.findIndex((option) => this.getPlacementTargetKey(option) === previousTargetKey);
        if (nextIndex >= 0) {
          this.activeSnapAxisKey = nextSnapAxisKey;
          this.snapPlaneCycle = nextIndex;
        }
      }
      this.drawGhostLayer(true);
    }

    resolvePlacementEdgeSnap(hitInfo) {
      const floorEdgeTarget = this.resolveFloorEdgePlacementTarget(hitInfo);
      if (floorEdgeTarget?.valid && !this.isWallPlacementActive()) return null;
      return this.resolveVerticalSurfaceSnap(hitInfo) || this.resolveVerticalGapFloorSnap(hitInfo);
    }

    isPlacementCellOccupiedForSnap(cell) {
      if (!cell) return false;
      const key = createCellKey(cell.x, cell.y, cell.z);
      if (this.carryState?.kind === 'placement') {
        const isMoving = (this.carryState.origins || []).some((origin) => (
          !origin.edge && createCellKey(origin.x, origin.y, origin.z) === key
        ));
        if (isMoving) return false;
      }
      const existing = this.mapData.tiles?.[key];
      if (!existing) return false;
      if (this.isActiveVerticalBoardPlacement()) {
        return !!existing.isVertical || isPortalMaterial(existing.panelType);
      }
      return true;
    }

    isPlacementWallOccupiedForSnap(cell, edge) {
      if (!cell || !edge) return false;
      const key = createWallKey(cell.x, cell.y, cell.z, edge);
      if (this.carryState?.kind === 'placement') {
        const isMoving = (this.carryState.origins || []).some((origin) => (
          origin.edge && createWallKey(origin.x, origin.y, origin.z, origin.edge) === key
        ));
        if (isMoving) return false;
      }
      return !!this.mapData.walls?.[key] || this.isWallPhysicalPlaneOccupied(cell, edge);
    }

    resolveDynamicPlacementTarget(hitInfo, { forGhost = false, snap: suppliedSnap = undefined, allowReplacement = false } = {}) {
      const snap = suppliedSnap === undefined ? this.resolvePlacementEdgeSnap(hitInfo) : suppliedSnap;
      if (snap) {
        const axisTarget = this.getAxisPlacementTarget(snap);
        if (axisTarget?.cell) return axisTarget;
        return null;
      }
      if (!snap && this.isWallPlacementActive()) {
        const wallTarget = forGhost
          ? this.resolveWallGhostTarget(hitInfo, { allowReplacement })
          : this.resolveWallPlacementTarget(hitInfo, { allowReplacement });
        if (wallTarget?.blocked) return null;
        if (!wallTarget?.cell) return null;
        const gearBlocked = this.doesGearBlockWall(wallTarget.cell, wallTarget.edge);
        return {
          ...wallTarget,
          kind: 'wall',
          valid: wallTarget.valid === false ? false : !gearBlocked,
          reason: gearBlocked ? 'gear_blocks_wall_edge' : wallTarget.reason
        };
      }
      const floorTarget = this.resolveFloorPlacementTarget(hitInfo, { allowReplacement });
      if (floorTarget?.blocked) return null;
      if (floorTarget?.cell) return {
        kind: floorTarget.kind || 'floor',
        cell: floorTarget.cell,
        valid: floorTarget.valid !== false,
        connection: floorTarget.valid === false ? null : (floorTarget.connection || null),
        sourceSnap: floorTarget.sourceSnap || null,
        layFlat: !!floorTarget.layFlat
      };
      const cell = snap?.cell || floorTarget;
      if (!cell) return null;
      return {
        kind: 'floor',
        cell,
        valid: snap ? snap.valid : true,
        connection: snap?.valid ? snap.connection : null,
        sourceSnap: snap || null,
        layFlat: !!floorTarget?.layFlat
      };
    }

    hitTest(pointer, { allowOutline = false } = {}) {
      const { localPoint, cell } = this.getPointerCell(pointer);
      const portHit = this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE || this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT
        ? null
        : this.getMechanicalPortHit(localPoint);
      const gearHit = (
        this.activeTool === CITY_CHANNEL_TOOLS.BROWSE
        || this.activeTool === CITY_CHANNEL_TOOLS.SELECT
      ) ? this.getGearHit(localPoint) : null;
      const needsOcclusionCandidates = (
        this.activeTool === CITY_CHANNEL_TOOLS.SELECT
        || this.activeTool === CITY_CHANNEL_TOOLS.BROWSE
      );
      const needsVisibleSurfaceHit = needsOcclusionCandidates
        || this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE
        || this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT;
      const needsWallSnap = this.isWallPlacementActive();
      const needsVerticalEdgeSnapHit = this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE
        && isBoardMaterial(this.activeTileType)
        && !isPortalMaterial(this.activeTileType);
      const edge = cell ? detectNearestEdge({ localPoint, cell, cameraYaw: this.cameraState.yaw, mapData: this.mapData }) : 'north';
      const wallSnap = needsWallSnap ? this.resolveWallSnapTarget(localPoint, cell) : null;
      const candidates = [];
      const seenCandidates = new Set();
      const addTileCandidate = (candidate, tile) => {
        const key = `tile:${createCellKey(candidate.x, candidate.y, candidate.z)}`;
        if (!tile || seenCandidates.has(key) || !this.isPlacementVisible(tile)) return;
        if (this.isCarryMovingPlacement(tile)) return;
        seenCandidates.add(key);
        candidates.push({ kind: 'tile', cell: candidate, tile });
      };
      const addWallCandidate = (candidate, wall, candidateEdge = wall?.edge) => {
        const key = `wall:${createWallKey(candidate.x, candidate.y, candidate.z, candidateEdge)}`;
        if (!wall || seenCandidates.has(key) || !this.isPlacementVisible(wall)) return;
        if (this.isCarryMovingPlacement({ ...wall, edge: candidateEdge || wall.edge })) return;
        seenCandidates.add(key);
        candidates.push({ kind: 'wall', cell: candidate, wall, edge: candidateEdge });
      };

      if (cell) getNeighborCells(cell, this.mapData).forEach((candidate) => {
        const tile = this.mapData.tiles?.[createCellKey(candidate.x, candidate.y, candidate.z)];
        addTileCandidate(candidate, tile);
        ['north', 'south', 'east', 'west'].forEach((candidateEdge) => {
          const wall = this.mapData.walls?.[createWallKey(candidate.x, candidate.y, candidate.z, candidateEdge)];
          addWallCandidate(candidate, wall, candidateEdge);
        });
      });
      if (
        allowOutline
        || this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE
        || this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT
        || needsOcclusionCandidates
      ) {
        Object.values(this.mapData.tiles || {}).forEach((tile) => {
          if (
            needsOcclusionCandidates
            || this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE
            || this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT
            || tile?.isVertical
            || isPortalMaterial(tile?.panelType)
          ) {
            addTileCandidate({ x: tile.x, y: tile.y, z: tile.z }, tile);
          }
        });
        Object.values(this.mapData.walls || {}).forEach((wall) => {
          addWallCandidate({ x: wall.x, y: wall.y, z: wall.z }, wall, wall.edge);
        });
      }

      const hits = [portHit, gearHit].filter(Boolean);
      candidates.forEach((candidate) => {
        const projection = projectCell(candidate.cell, this.cameraState.yaw, this.mapData);
        const point = {
          x: localPoint.x - projection.x + (TILE_RENDER_WIDTH * 0.5),
          y: localPoint.y - projection.y + (TILE_RENDER_HEIGHT * 0.57)
        };
        if (candidate.kind === 'wall') {
          const geometry = createEdgeWallGeometry(this.cameraState.yaw, candidate.wall.edge, this.getWallMiterProfile(candidate.wall));
          const visibleSurfaceSide = this.getVisibleGearSurfaceSide(candidate.wall);
          const visibleWallPlane = visibleSurfaceSide === 'back'
            ? (geometry.wallBack || geometry.wall)
            : (geometry.wallFront || geometry.wall);
          const inWallPlane = pointInPolygon(point, visibleWallPlane);
          const wallVisiblePolygons = [
            visibleWallPlane,
            geometry.wallCap,
            geometry.wallSideStart,
            geometry.wallSideEnd
          ];
          const inVisibleWall = wallVisiblePolygons.some((polygon) => pointInPolygon(point, polygon));
          const inBase = needsVisibleSurfaceHit
            ? inVisibleWall
            : inWallPlane && point.y >= geometry.verticalBaseY;
          const inOutline = inWallPlane || pointInPolygon(point, geometry.wallCap);
          const surfaceBounds = expandRect(getPointBounds([
            ...geometry.wall,
            ...geometry.wallCap,
            ...geometry.wallSideStart,
            ...geometry.wallSideEnd
          ]), 10);
          const inSurfaceBounds = (allowOutline || needsVisibleSurfaceHit)
            && rectContainsPoint(surfaceBounds, point);
          if (!inBase && !(allowOutline && inOutline) && !inSurfaceBounds) return;
          const verticalSnapEdge = needsVerticalEdgeSnapHit && inWallPlane
            ? this.getVerticalSurfaceSnapEdge({ localPoint, hit: { type: 'wall', cell: candidate.cell, edge: candidate.wall.edge } }, {
              kind: 'wall',
              key: createWallKey(candidate.cell.x, candidate.cell.y, candidate.cell.z, candidate.wall.edge),
              cell: candidate.cell,
              edge: candidate.wall.edge,
              placement: candidate.wall
            })
            : null;
          hits.push({
            type: 'wall',
            cell: candidate.cell,
            edge: candidate.wall.edge,
            panelType: candidate.wall.panelType,
            hitZone: inBase ? 'base' : inSurfaceBounds ? 'surface' : 'outline',
            gearSurfacePlane: inWallPlane,
            surfaceSide: visibleSurfaceSide,
            wall: candidate.wall,
            localSurfacePoint: point,
            snapPriority: verticalSnapEdge ? 2 : 0,
            selectionPriority: needsVisibleSurfaceHit && (inVisibleWall || inSurfaceBounds) ? 1 : 0,
            snapDistanceSquared: verticalSnapEdge?.distanceSquared ?? Infinity,
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
        const inTopFace = pointInPolygon(point, geometry.top);
        const inTile = inTopFace || geometry.sides.some((poly) => pointInPolygon(point, poly));
        const isPortal = isPortalMaterial(candidate.tile.panelType);
        const inPortal = isPortal && getPortalPolygons(this.cameraState.yaw, candidate.tile.rotation || 0)
          .some((polygon) => pointInPolygon(point, polygon));
        const visibleVerticalSurfaceSide = candidate.tile.isVertical ? this.getVisibleGearSurfaceSide(candidate.tile) : 'front';
        const visibleVerticalPlane = visibleVerticalSurfaceSide === 'back'
          ? (geometry.wallBack || geometry.wall)
          : (geometry.wallFront || geometry.wall);
        const verticalVisiblePolygons = candidate.tile.isVertical
          ? [
            visibleVerticalPlane,
            geometry.wallCap,
            geometry.wallSideStart,
            geometry.wallSideEnd
          ]
          : [];
        const inVisibleVertical = candidate.tile.isVertical
          && verticalVisiblePolygons.some((polygon) => pointInPolygon(point, polygon));
        const inVerticalWallPlane = candidate.tile.isVertical && pointInPolygon(point, visibleVerticalPlane);
        const inVerticalSelectionFallback = needsOcclusionCandidates
          && candidate.tile.isVertical
          && (
            pointInPolygon(point, geometry.wall)
            || pointInPolygon(point, geometry.wallBack || geometry.wall)
            || pointInPolygon(point, geometry.wallCap)
          );
        const inVertical = isPortal
          ? inPortal
          : needsVisibleSurfaceHit
            ? (inVisibleVertical || inVerticalSelectionFallback)
            : candidate.tile.isVertical && (pointInPolygon(point, geometry.wall) || pointInPolygon(point, geometry.wallCap));
        const verticalSurfaceBounds = candidate.tile.isVertical
          ? expandRect(getPointBounds([
            ...geometry.wall,
            ...geometry.wallCap,
            ...geometry.wallSideStart,
            ...geometry.wallSideEnd
          ]), 10)
          : null;
        const inVerticalSurfaceBounds = candidate.tile.isVertical
          && (allowOutline || needsVisibleSurfaceHit)
          && rectContainsPoint(verticalSurfaceBounds, point);
        if (!inTile && !inVertical && !inVerticalSurfaceBounds) return;
        const hitZone = isPortal && inPortal
          ? 'base'
          : needsVisibleSurfaceHit && candidate.tile.isVertical && inVertical ? 'base'
            : candidate.tile.isVertical
              && !needsVisibleSurfaceHit
              && point.y < geometry.verticalBaseY
              && (inVertical || inVerticalSurfaceBounds)
              ? 'outline'
              : inVerticalSurfaceBounds ? 'surface' : 'base';
        if (hitZone === 'outline' && !allowOutline) return;
        const verticalSnapEdge = needsVerticalEdgeSnapHit && candidate.tile.isVertical && inVerticalWallPlane
          ? this.getVerticalSurfaceSnapEdge({ localPoint, hit: { type: 'tile', cell: candidate.cell, tile: candidate.tile } }, {
            kind: 'tile',
            key: createCellKey(candidate.cell.x, candidate.cell.y, candidate.cell.z),
            cell: candidate.cell,
            edge: null,
            placement: candidate.tile
          })
          : null;
        hits.push({
          type: 'tile',
          cell: candidate.cell,
          panelType: candidate.tile.panelType,
          hitZone,
          gearSurfacePlane: candidate.tile.isVertical ? inVerticalWallPlane : inTopFace,
          surfaceSide: visibleVerticalSurfaceSide,
          tile: candidate.tile,
          localSurfacePoint: point,
          snapPriority: verticalSnapEdge ? 2 : 0,
          selectionPriority: needsVisibleSurfaceHit && candidate.tile.isVertical && (inVertical || inVerticalSurfaceBounds) ? 1 : 0,
          snapDistanceSquared: verticalSnapEdge?.distanceSquared ?? Infinity,
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
      hits.sort((a, b) => compareCityChannelHits(a, b, { preferOcclusion: needsOcclusionCandidates }));
      return { cell, hit: hits[0] || null, edge, localPoint, wallSnap };
    }

    isDoubleClickMechanismHit(pointer, hit) {
      if (!hit || hit.type !== 'tile' || isPortalMaterial(hit.panelType)) return false;
      const now = this.time?.now || Date.now();
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

    inspectHitTile(hit) {
      if (!hit?.cell || hit.type !== 'tile') return false;
      if (!this.isSelectedHit(hit)) this.selectHit(hit, false);
      if (this.activeTool === CITY_CHANNEL_TOOLS.BROWSE) this.config.onRequestTool?.(CITY_CHANNEL_TOOLS.SELECT);
      const key = createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
      const tile = this.mapData.tiles?.[key] || hit.tile;
      if (!tile) return false;
      return this.inspectTile({ x: hit.cell.x, y: hit.cell.y, z: hit.cell.z }, tile);
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

    getCellScreenPosition(cell) {
      if (!cell) return { x: this.scale.width / 2, y: this.scale.height / 2 };
      const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
      const zoom = this.cameraState.zoom || 1;
      return {
        x: this.worldLayer.x + (projection.x * zoom),
        y: this.worldLayer.y + (projection.y * zoom)
      };
    }

    getSourceDisplayObjects(key) {
      return [
        this.renderObjects.get(`tile:${key}`),
        this.renderObjects.get(`gear-far:tile:${key}`),
        this.renderObjects.get(`gear-near:tile:${key}`),
        this.renderObjects.get(`edge-overlay:tile:${key}`),
        this.renderObjects.get(`mechanism:${key}`),
        this.renderObjects.get(`tile-label:${key}`)
      ].filter(Boolean);
    }

    setSourceInspectAlpha(key, alpha = 1) {
      this.getSourceDisplayObjects(key).forEach((object) => {
        if (!object.getData('inspectOriginalAlpha')) object.setData('inspectOriginalAlpha', object.alpha);
        object.setAlpha(alpha);
      });
    }

    restoreSourceInspectAlpha(key) {
      this.getSourceDisplayObjects(key).forEach((object) => {
        const originalAlpha = object.getData('inspectOriginalAlpha');
        object.setAlpha(Number.isFinite(originalAlpha) ? originalAlpha : 1);
        object.setData('inspectOriginalAlpha', null);
      });
    }

    createInspectPreview(tile, yaw) {
      const container = this.add.container(0, 0);
      const shadow = this.add.graphics();
      shadow.fillStyle(0x020617, 0.34);
      shadow.fillEllipse(0, 48, 126, 38);
      container.add(shadow);
      const texture = this.textureCache.getTileTexture(tile.panelType, tile.rotation || 0, false, yaw, getTransmissionSurfaceRotation(tile));
      const tileImage = this.configureBoardImage(this.add.image(0, 0, texture).setOrigin(0.5, 0.57));
      container.add(tileImage);

      let runtime = null;
      if (isTriggerMechanismTile(tile.panelType)) {
        const mechanism = this.add.container(0, 0);
        const graphics = this.add.graphics();
        mechanism.add(graphics);
        runtime = {
          graphics,
          state: { progress: 0 }
        };
        this.drawMechanismState(
          tile,
          runtime,
          0,
          normalizeMechanismParams(this.mechanismParams?.[createCellKey(tile.x, tile.y, tile.z)]),
          yaw
        );
        container.add(mechanism);
      }

      return { container, tileImage, runtime, shadow };
    }

    applyInspectTransform(state, values = {}) {
      if (!state?.container) return;
      if (Number.isFinite(values.x) || Number.isFinite(values.y)) {
        state.container.setPosition(
          Number.isFinite(values.x) ? values.x : state.container.x,
          Number.isFinite(values.y) ? values.y : state.container.y
        );
      }
      if (Number.isFinite(values.alpha)) state.container.setAlpha(values.alpha);
      if (Number.isFinite(values.scale)) state.displayScale = values.scale;
      const scale = state.displayScale || INSPECT_PREVIEW_SCALE;
      const pitch = state.pitch || 0;
      const pitchRadians = (pitch * Math.PI) / 180;
      const pitchFacing = Math.cos(pitchRadians);
      const pitchScaleY = (pitchFacing < 0 ? -1 : 1) * Math.max(0.14, Math.abs(pitchFacing));
      state.container.setScale(scale, scale * pitchScaleY);
      state.container.setAngle(state.roll || 0);
      if (state.shadow) {
        state.shadow.setAlpha(Math.max(0.14, Math.min(0.48, 0.16 + (Math.abs(pitchFacing) * 0.18))));
      }
    }

    refreshInspectPreview() {
      const state = this.inspectState;
      if (!state || state.isClosing || state.external) return;
      const tile = this.mapData.tiles?.[state.key] || state.tile;
      if (!tile) {
        this.closeInspectMode({ animate: false });
        return;
      }
      state.tile = tile;
      this.setBoardTexture(state.tileImage, this.textureCache.getTileTexture(tile.panelType, tile.rotation || 0, false, state.yaw, getTransmissionSurfaceRotation(tile)));
      if (state.runtime) {
        this.drawMechanismState(
          tile,
          state.runtime,
          state.runtime.state.progress,
          normalizeMechanismParams(this.mechanismParams?.[state.key]),
          state.yaw
        );
      }
      this.applyInspectTransform(state);
    }

    inspectSelectedTile() {
      if (this.selectedCells.length !== 1 || this.selectedWalls.length > 0) return false;
      const cell = this.selectedCells[0];
      const key = createCellKey(cell.x, cell.y, cell.z);
      const tile = this.mapData.tiles?.[key];
      if (!tile) return false;
      return this.inspectTile(cell, tile);
    }

    inspectTile(cell, tile) {
      if (!cell || !tile) return false;
      const key = createCellKey(cell.x, cell.y, cell.z);
      this.closeInspectMode({ animate: false, silent: true });
      this.keyState.clear();
      this.pendingMechanicalPort = null;
      this.drawMechanicalLayers();

      const source = this.getCellScreenPosition(cell);
      if (this.config.externalInspectOverlay) {
        this.setSourceInspectAlpha(key, 0.2);
        this.inspectState = {
          key,
          cell: { x: cell.x, y: cell.y, z: cell.z },
          tile,
          panelType: tile.panelType,
          source,
          external: true,
          isClosing: false
        };
        this.config.onInspectChange?.({
          active: true,
          key,
          cell: { x: cell.x, y: cell.y, z: cell.z },
          panelType: tile.panelType,
          tile: {
            panelType: tile.panelType,
            rotation: tile.rotation || 0,
            transmissionRotation: tile.transmissionRotation ?? tile.rotation ?? 0,
            transmissionSkeleton: tile.transmissionSkeleton || null,
            gearMounts: tile.gearMounts || []
          },
          source
        });
        if (isTriggerMechanismTile(tile.panelType)) {
          this.requestMechanismPanel({
            type: 'tile',
            cell,
            panelType: tile.panelType,
            tile
          });
        }
        this.config.onHoverStatusChange?.(`${resolveMaterialName(tile.panelType)}，观察中`);
        return true;
      }
      const target = {
        x: this.scale.width / 2,
        y: Math.max(170, this.scale.height / 2 - 24)
      };
      const preview = this.createInspectPreview(tile, this.cameraState.yaw);
      const backdrop = this.add.graphics();
      backdrop.fillStyle(0x020617, 0.62);
      backdrop.fillRect(0, 0, this.scale.width, this.scale.height);
      backdrop.lineStyle(1, 0x67e8f9, 0.18);
      backdrop.strokeCircle(source.x, source.y, 34);
      backdrop.setAlpha(0);

      const startScale = Math.max(0.4, this.cameraState.zoom || 1);
      preview.container.setPosition(source.x, source.y);
      preview.container.setAlpha(0.22);
      this.inspectLayer.add([backdrop, preview.container]);
      this.setSourceInspectAlpha(key, 0.2);

      this.inspectState = {
        key,
        cell: { x: cell.x, y: cell.y, z: cell.z },
        tile,
        panelType: tile.panelType,
        yaw: this.cameraState.yaw,
        startX: source.x,
        startY: source.y,
        backdrop,
        container: preview.container,
        tileImage: preview.tileImage,
        shadow: preview.shadow,
        runtime: preview.runtime,
        displayScale: startScale,
        pitch: 0,
        roll: 0,
        isClosing: false
      };
      this.applyInspectTransform(this.inspectState, {
        x: source.x,
        y: source.y,
        scale: startScale,
        alpha: 0.22
      });

      const motion = { t: 0 };
      this.inspectState.motion = motion;
      this.tweens.add({
        targets: motion,
        t: 1,
        duration: INSPECT_LIFT_DURATION,
        ease: 'sine.inout',
        onUpdate: () => {
          const t = motion.t;
          backdrop.setAlpha(t);
          this.applyInspectTransform(this.inspectState, {
            x: source.x + ((target.x - source.x) * t),
            y: source.y + ((target.y - source.y) * t) - (Math.sin(t * Math.PI) * 34),
            scale: startScale + ((INSPECT_PREVIEW_SCALE - startScale) * t),
            alpha: 0.22 + (0.78 * t)
          });
        },
        onComplete: () => {
          if (!this.inspectState || this.inspectState.key !== key) return;
          this.inspectState.motion = null;
          this.applyInspectTransform(this.inspectState, {
            x: target.x,
            y: target.y,
            scale: INSPECT_PREVIEW_SCALE,
            alpha: 1
          });
        }
      });

      this.config.onInspectChange?.({
        active: true,
        key,
        cell: { x: cell.x, y: cell.y, z: cell.z },
        panelType: tile.panelType
      });
      if (isTriggerMechanismTile(tile.panelType)) {
        this.requestMechanismPanel({
          type: 'tile',
          cell,
          panelType: tile.panelType,
          tile
        });
      }
      this.config.onHoverStatusChange?.(`${resolveMaterialName(tile.panelType)}，观察中`);
      return true;
    }

    closeInspectMode(options = {}) {
      const { animate = true, silent = false } = options || {};
      const state = this.inspectState;
      if (!state) return false;
      this.inspectState = null;
      state.isClosing = true;
      this.dragState = null;
      this.keyState.clear();
      if (!silent) this.config.onInspectChange?.(null);
      const finish = () => {
        if (state.runtime?.state) this.tweens.killTweensOf(state.runtime.state);
        state.container?.destroy(true);
        state.backdrop?.destroy();
        this.restoreSourceInspectAlpha(state.key);
      };
      if (state.external || !animate) {
        finish();
        return true;
      }
      const source = this.getCellScreenPosition(state.cell);
      if (state.motion) this.tweens.killTweensOf(state.motion);
      const start = {
        x: state.container.x,
        y: state.container.y,
        scale: state.displayScale || INSPECT_PREVIEW_SCALE,
        alpha: state.container.alpha
      };
      const targetScale = Math.max(0.4, this.cameraState.zoom || 1);
      const motion = { t: 0 };
      state.motion = motion;
      this.tweens.add({
        targets: motion,
        t: 1,
        duration: INSPECT_RETURN_DURATION,
        ease: 'sine.inout',
        onUpdate: () => {
          const t = motion.t;
          state.backdrop?.setAlpha(1 - t);
          this.applyInspectTransform(state, {
            x: start.x + ((source.x - start.x) * t),
            y: start.y + ((source.y - start.y) * t) - (Math.sin(t * Math.PI) * 18),
            scale: start.scale + ((targetScale - start.scale) * t),
            alpha: start.alpha + ((0.22 - start.alpha) * t)
          });
        },
        onComplete: finish
      });
      return true;
    }

    triggerMechanismFromHit(hit) {
      if (!hit?.cell || !isTriggerMechanismTile(hit.panelType)) return false;
      try {
        if (!this.isSelectedHit(hit)) this.selectHit(hit, false);
        if (this.activeTool === CITY_CHANNEL_TOOLS.BROWSE) this.config.onRequestTool?.(CITY_CHANNEL_TOOLS.SELECT);
        const key = hit.type === 'wall'
          ? createWallKey(hit.cell.x, hit.cell.y, hit.cell.z, hit.edge)
          : createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
        const params = normalizeMechanismParams(this.mechanismParams?.[key]);
        this.config.onMechanismPanelRequest?.({
          key,
          cell: { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z },
          edge: hit.type === 'wall' ? hit.edge : null,
          panelType: hit.panelType,
          params,
          anchor: this.getMechanismScreenAnchor(hit.cell)
        });
      } catch (error) {
        if (!this.isSelectedHit(hit)) this.selectHit(hit, false);
        this.config.onToast?.(`机关面板打开失败：${error?.message || 'unknown error'}`, 'error');
      }
      return true;
    }

    triggerMechanismAtCell(cell, paramsOverride = null) {
      if (!cell) return false;
      const key = createCellKey(cell.x, cell.y, cell.z);
      const tile = this.mapData.tiles?.[key];
      if (!tile) return false;
      if (!isTriggerMechanismTile(tile.panelType)) return false;
      const params = normalizeMechanismParams(paramsOverride || this.mechanismParams?.[key]);
      let driveStarted = false;
      const startDrive = () => {
        if (driveStarted) return false;
        driveStarted = true;
        const graph = this.getMechanicalAssemblyGraph();
        const sourceAssembly = getAssemblyForCell(graph, key);
        if (sourceAssembly?.gearMounts?.length > 0) {
          this.playAssemblyGearRotation(sourceAssembly, key, params);
          return true;
        }
        const drive = findFixedAxisForTrigger(this.mapData, cell);
        if (!drive.ok || !drive.assembly || !drive.fixedAxis) {
          this.config.onToast?.(drive.message || '没有可驱动的承动组件。', 'error');
          return false;
        }
        this.playAssemblyRotation(drive.assembly, drive.fixedAxis, params);
        return true;
      };
      if (isTriggerMechanismTile(tile.panelType)) {
        const actionPlayed = this.playMechanismAction(tile, key, params, { onEngage: startDrive });
        this.playInspectMechanismAction(tile, key, params);
        if (!actionPlayed) startDrive();
      }
      return true;
    }

    requestMechanismPanel(hit) {
      if (!hit?.cell) {
        this.config.onMechanismPanelRequest?.(null);
        return;
      }
      const key = hit.type === 'wall'
        ? createWallKey(hit.cell.x, hit.cell.y, hit.cell.z, hit.edge)
        : createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
      this.config.onMechanismPanelRequest?.({
        key,
        cell: { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z },
        edge: hit.type === 'wall' ? hit.edge : null,
        panelType: hit.panelType,
        params: normalizeMechanismParams(this.mechanismParams?.[key]),
        anchor: this.getMechanismScreenAnchor(hit.cell)
      });
    }

    notifyMechanismPreviewProgress(key, tile, progress, params) {
      this.config.onMechanismPreviewProgress?.({
        key,
        panelType: tile?.panelType,
        progress: Math.max(0, Math.min(1, Number(progress) || 0)),
        params: normalizeMechanismParams(params),
        kind: tile ? getMechanismTemplateKind(tile.panelType) : null
      });
    }

    playPreviewAnimation(cell, paramsOverride = null) {
      return this.triggerMechanismAtCell(cell, paramsOverride);
    }

    playAssemblyRotation(assembly, fixedAxis, params) {
      if (!assembly || !fixedAxis) return false;
      const axisCell = fixedAxis.cell || { x: 0, y: 0, z: 0 };
      const axisHost = fixedAxis.componentKey
        ? (this.mapData.tiles?.[fixedAxis.componentKey] || this.mapData.walls?.[fixedAxis.componentKey])
        : (this.mapData.tiles?.[createCellKey(axisCell.x, axisCell.y, axisCell.z)] || null);
      const anchor = this.getGearMountPoint(axisHost, fixedAxis) || projectCell(axisCell, this.cameraState.yaw, this.mapData);
      const members = assembly.componentKeys.flatMap((componentKey) => ([
        this.renderObjects.get(`tile:${componentKey}`),
        this.renderObjects.get(`wall:${componentKey}`),
        this.renderObjects.get(`gear-far:tile:${componentKey}`),
        this.renderObjects.get(`gear-near:tile:${componentKey}`),
        this.renderObjects.get(`gear-far:wall:${componentKey}`),
        this.renderObjects.get(`gear-near:wall:${componentKey}`),
        this.renderObjects.get(`edge-overlay:tile:${componentKey}`),
        this.renderObjects.get(`edge-overlay:wall:${componentKey}`),
        this.renderObjects.get(`mechanism:${componentKey}`),
        this.renderObjects.get(`tile-label:${componentKey}`)
      ].filter(Boolean)));
      if (members.length <= 0) return false;

      const normalized = normalizeMechanismParams(params);
      const sign = normalized.rotationDirection === 'left' ? -1 : 1;
      const targetAngle = sign * normalized.rotationAngle;
      const duration = Math.max(120, Math.round((Math.max(1, normalized.rotationAngle) / Math.max(1, normalized.rotationSpeedDegPerSec)) * 1000));
      const delay = Math.round(normalized.triggerDelaySeconds * 1000);
      const originals = members.map((object) => ({
        object,
        x: object.x,
        y: object.y,
        angle: object.angle || 0
      }));
      const applyAngle = (degrees) => {
        const radians = (degrees * Math.PI) / 180;
        originals.forEach((item) => {
          const dx = item.x - anchor.x;
          const dy = item.y - anchor.y;
          item.object.setPosition(
            anchor.x + (dx * Math.cos(radians)) - (dy * Math.sin(radians)),
            anchor.y + (dx * Math.sin(radians)) + (dy * Math.cos(radians))
          );
          item.object.setAngle(item.angle + degrees);
        });
      };
      const motion = { angle: 0 };
      this.tweens.killTweensOf(motion);
      this.tweens.add({
        targets: motion,
        angle: targetAngle,
        delay,
        duration,
        ease: 'sine.inout',
        onUpdate: () => {
          applyAngle(motion.angle);
          this.config.onMechanismPreviewProgress?.({
            key: fixedAxis.componentKey,
            panelType: this.mapData.tiles?.[fixedAxis.componentKey]?.panelType,
            progress: Math.min(1, Math.abs(motion.angle) / Math.max(1, normalized.rotationAngle)),
            params: normalized,
            kind: CITY_CHANNEL_MECHANISM_KINDS.FIXED_AXIS_ASSEMBLY,
            assemblyId: assembly.id
          });
        },
        onComplete: () => {
          if (!normalized.autoReturn) return;
          this.time.delayedCall(Math.round(normalized.autoReturnDelaySeconds * 1000), () => {
            this.tweens.add({
              targets: motion,
              angle: 0,
              duration,
              ease: 'sine.inout',
              onUpdate: () => applyAngle(motion.angle),
              onComplete: () => {
                applyAngle(0);
                this.config.onMechanismPreviewProgress?.(null);
              }
            });
          });
        }
      });
      this.config.onToast?.(`${assembly.id} 运行预览：固定轴驱动 ${assembly.componentKeys.length} 块板材。`, 'success');
      return true;
    }

    getGearHostKindAndPlacement(componentKey) {
      const tile = this.mapData.tiles?.[componentKey];
      if (tile) return { hostKind: 'tile', placement: tile };
      const wall = this.mapData.walls?.[componentKey];
      if (wall) return { hostKind: 'wall', placement: wall };
      return { hostKind: null, placement: null };
    }

    getAssemblyGearNodes(assembly) {
      if (!assembly?.gearMounts?.length) return [];
      return this.getGearNodesForMounts(assembly.gearMounts);
    }

    getGearSurfaceKey(placement, mount = {}) {
      const surface = mount.surface || 'front';
      if (!placement) return `unknown:${surface}`;
      if (placement.edge) return `edge:${placement.z || 0}:${placement.edge}:${surface}`;
      if (placement.isVertical) {
        const axis = normalizeRotation(placement.rotation || 0) % 180;
        return `vertical:${placement.z || 0}:${axis}:${surface}`;
      }
      return `floor:${placement.z || 0}:${surface}`;
    }

    getGearPitchRadiusAtPoint(placement, mount = {}, point = null) {
      if (!placement || !mount || !point) return 24;
      const local = getGearMountLocalPosition(mount.position);
      const edgePoint = this.mapGearLocalPointToSurface(
        placement,
        { x: (local.x || 0) + GEAR_PITCH_RADIUS_LOCAL, y: local.y || 0 },
        { surface: mount.surface || 'front', allowOverflow: true }
      );
      if (!edgePoint) return 24;
      return Math.max(14, Math.min(34, Math.hypot(edgePoint.x - point.x, edgePoint.y - point.y)));
    }

    getGearNodesForMounts(mounts = []) {
      if (!Array.isArray(mounts) || mounts.length <= 0) return [];
      return mounts.map((mount) => {
        const { hostKind, placement } = this.getGearHostKindAndPlacement(mount.componentKey);
        if (!hostKind || !placement) return null;
        const liveMount = (placement.gearMounts || []).find((item) => item.id === mount.id) || mount;
        const point = this.getGearMountPoint(placement, liveMount);
        if (!point) return null;
        return {
          id: `${mount.componentKey}:${mount.id}`,
          componentKey: mount.componentKey,
          hostKind,
          placement,
          mountId: liveMount.id,
          mount: liveMount,
          point,
          pitchRadius: this.getGearPitchRadiusAtPoint(placement, liveMount, point),
          surfaceKey: this.getGearSurfaceKey(placement, liveMount),
          driveRatio: 0,
          direction: 0
        };
      }).filter(Boolean);
    }

    getAllGearNodes({ visibleOnly = false } = {}) {
      const mounts = [];
      Object.entries(this.mapData.tiles || {}).forEach(([componentKey, tile]) => {
        if (visibleOnly && !this.isPlacementVisible(tile)) return;
        (tile.gearMounts || []).forEach((mount) => mounts.push({ ...mount, componentKey }));
      });
      Object.entries(this.mapData.walls || {}).forEach(([componentKey, wall]) => {
        if (visibleOnly && !this.isPlacementVisible(wall)) return;
        (wall.gearMounts || []).forEach((mount) => mounts.push({ ...mount, componentKey }));
      });
      return this.getGearNodesForMounts(mounts);
    }

    getGearContactThreshold() {
      return 56;
    }

    buildGearContactGraph(nodes = []) {
      const threshold = this.getGearContactThreshold();
      const graph = new Map(nodes.map((node) => [node.id, []]));
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          if (a.surfaceKey !== b.surfaceKey) continue;
          const distance = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
          const pitchContact = (a.pitchRadius || 24) + (b.pitchRadius || 24);
          const contactDistance = Math.max(18, Math.min(threshold, pitchContact * 1.18));
          if (distance > contactDistance) continue;
          if (distance < Math.max(8, pitchContact * 0.28)) continue;
          graph.get(a.id)?.push({ id: b.id, ratio: -((a.pitchRadius || 1) / (b.pitchRadius || 1)) });
          graph.get(b.id)?.push({ id: a.id, ratio: -((b.pitchRadius || 1) / (a.pitchRadius || 1)) });
        }
      }
      return graph;
    }

    getAssemblyComponentDistances(assembly, sourceComponentKey) {
      const distances = new Map();
      if (!assembly || !sourceComponentKey) return distances;
      const componentKeys = new Set(assembly.componentKeys || []);
      if (!componentKeys.has(sourceComponentKey)) return distances;
      const adjacency = new Map([...componentKeys].map((key) => [key, []]));
      (assembly.edges || []).forEach((edge) => {
        if (!edge?.componentKey || !edge?.key) return;
        if (!componentKeys.has(edge.componentKey) || !componentKeys.has(edge.key)) return;
        adjacency.get(edge.componentKey)?.push(edge.key);
      });
      const queue = [sourceComponentKey];
      distances.set(sourceComponentKey, 0);
      while (queue.length > 0) {
        const current = queue.shift();
        const nextDistance = (distances.get(current) || 0) + 1;
        (adjacency.get(current) || []).forEach((nextKey) => {
          if (distances.has(nextKey)) return;
          distances.set(nextKey, nextDistance);
          queue.push(nextKey);
        });
      }
      return distances;
    }

    getDrivenGearRoots(assembly, nodes = [], sourceComponentKey = '') {
      if (nodes.length <= 0) return [];
      const distances = this.getAssemblyComponentDistances(assembly, sourceComponentKey);
      const reachable = nodes
        .map((node) => ({ node, distance: distances.has(node.componentKey) ? distances.get(node.componentKey) : Infinity }))
        .filter((item) => Number.isFinite(item.distance));
      if (reachable.length <= 0) return [nodes[0]];
      const minDistance = Math.min(...reachable.map((item) => item.distance));
      return reachable.filter((item) => item.distance === minDistance).map((item) => item.node);
    }

    resolveDrivenGearNodes(assembly, sourceComponentKey = '') {
      const assemblyNodes = this.getAssemblyGearNodes(assembly);
      if (assemblyNodes.length <= 0) return [];
      const allNodes = this.getAllGearNodes();
      const byId = new Map(allNodes.map((node) => [node.id, node]));
      const contactGraph = this.buildGearContactGraph(allNodes);
      const roots = this.getDrivenGearRoots(assembly, assemblyNodes, sourceComponentKey);
      const visited = new Set();
      const queue = [];
      roots.forEach((root) => {
        if (!root?.id || visited.has(root.id)) return;
        const liveRoot = byId.get(root.id);
        if (!liveRoot) return;
        liveRoot.driveRatio = 1;
        liveRoot.direction = 1;
        visited.add(root.id);
        queue.push(root.id);
      });
      while (queue.length > 0) {
        const currentId = queue.shift();
        const current = byId.get(currentId);
        (contactGraph.get(currentId) || []).forEach((edge) => {
          const nextId = edge.id;
          if (visited.has(nextId)) return;
          const next = byId.get(nextId);
          if (!next || !current) return;
          next.driveRatio = (current.driveRatio || 1) * (edge.ratio || -1);
          next.direction = next.driveRatio >= 0 ? 1 : -1;
          visited.add(nextId);
          queue.push(nextId);
        });
      }
      const driven = allNodes.filter((node) => visited.has(node.id));
      return driven.length > 0
        ? driven
        : assemblyNodes.map((node, index) => ({
          ...node,
          driveRatio: index % 2 === 0 ? 1 : -1,
          direction: index % 2 === 0 ? 1 : -1
        }));
    }

    setGearMountPhases(nodes = [], angle = 0, basePhases = new Map()) {
      const dirtyHosts = new Map();
      nodes.forEach((node) => {
        const { hostKind, placement } = this.getGearHostKindAndPlacement(node.componentKey);
        if (!hostKind || !placement || !Array.isArray(placement.gearMounts)) return;
        const mount = placement.gearMounts.find((item) => item.id === node.mountId);
        if (!mount) return;
        const base = basePhases.get(node.id) || 0;
        mount.phase = normalizeRotation(base + ((node.driveRatio || node.direction || 1) * angle));
        dirtyHosts.set(node.componentKey, { hostKind, placement });
      });
      dirtyHosts.forEach(({ hostKind, placement }, hostKey) => {
        this.redrawMountedGearHostLayers(hostKind, hostKey, placement);
      });
      this.sortMapLayer();
    }

    playAssemblyGearRotation(assembly, sourceComponentKey, params) {
      const nodes = this.resolveDrivenGearNodes(assembly, sourceComponentKey);
      if (nodes.length <= 0) return false;
      const normalized = normalizeMechanismParams(params);
      const sign = normalized.rotationDirection === 'left' ? -1 : 1;
      const targetAngle = sign * normalized.rotationAngle;
      const duration = Math.max(120, Math.round((Math.max(1, normalized.rotationAngle) / Math.max(1, normalized.rotationSpeedDegPerSec)) * 1000));
      const delay = Math.round(normalized.triggerDelaySeconds * 1000);
      const basePhases = new Map(nodes.map((node) => [node.id, Number(node.mount?.phase) || 0]));
      const motion = { angle: 0 };
      this.tweens.killTweensOf(motion);
      this.tweens.add({
        targets: motion,
        angle: targetAngle,
        delay,
        duration,
        ease: 'sine.inout',
        onUpdate: () => {
          this.setGearMountPhases(nodes, motion.angle, basePhases);
          this.config.onMechanismPreviewProgress?.({
            key: sourceComponentKey,
            panelType: this.mapData.tiles?.[sourceComponentKey]?.panelType,
            progress: Math.min(1, Math.abs(motion.angle) / Math.max(1, normalized.rotationAngle)),
            params: normalized,
            kind: CITY_CHANNEL_MECHANISM_KINDS.FIXED_AXIS_ASSEMBLY,
            assemblyId: assembly.id
          });
        },
        onComplete: () => {
          this.setGearMountPhases(nodes, targetAngle, basePhases);
          if (!normalized.autoReturn) return;
          this.time.delayedCall(Math.round(normalized.autoReturnDelaySeconds * 1000), () => {
            this.tweens.add({
              targets: motion,
              angle: 0,
              duration,
              ease: 'sine.inout',
              onUpdate: () => this.setGearMountPhases(nodes, motion.angle, basePhases),
              onComplete: () => {
                this.setGearMountPhases(nodes, 0, basePhases);
                this.config.onMechanismPreviewProgress?.(null);
              }
            });
          });
        }
      });
      this.config.onToast?.(`${assembly.id} 齿轮传动预览：${nodes.length} 个齿轮转动。`, 'success');
      return true;
    }

    playMechanismAction(tile, key, params, options = {}) {
      if (!tile || !key) return;
      const object = this.renderObjects.get(`mechanism:${key}`);
      const runtime = object?.getData('runtime');
      if (!object || !runtime) return false;
      const { onEngage } = options || {};
      const duration = Math.round(Math.max(0.5, params.durationSeconds || 1.5) * 1000);
      const travelDuration = Math.max(120, Math.round(duration / 2));
      let engaged = false;
      const engage = () => {
        if (engaged) return;
        engaged = true;
        onEngage?.();
      };
      this.tweens.killTweensOf(runtime.state);
      runtime.state.progress = 0;
      runtime.state.running = true;
      this.drawMechanismState(tile, runtime, 0, params);
      this.notifyMechanismPreviewProgress(key, tile, 0, params);
      this.tweens.add({
        targets: runtime.state,
        progress: 1,
        duration: travelDuration,
        yoyo: true,
        hold: 150,
        ease: 'cubic.out',
        onUpdate: () => {
          this.drawMechanismState(tile, runtime, runtime.state.progress, params);
          this.notifyMechanismPreviewProgress(key, tile, runtime.state.progress, params);
          if (runtime.state.progress >= 0.98) engage();
        },
        onComplete: () => {
          engage();
          runtime.state.progress = 0;
          runtime.state.running = false;
          this.drawMechanismState(tile, runtime, 0, params);
          this.notifyMechanismPreviewProgress(key, tile, 0, params);
        }
      });
      return true;
    }

    playInspectMechanismAction(tile, key, params) {
      const state = this.inspectState;
      if (!state || state.key !== key || !state.runtime) return;
      const duration = Math.round(Math.max(0.5, params.durationSeconds || 1.5) * 1000);
      const travelDuration = Math.max(120, Math.round(duration / 2));
      this.tweens.killTweensOf(state.runtime.state);
      state.runtime.state.progress = 0;
      this.drawMechanismState(tile, state.runtime, 0, params, state.yaw);
      this.tweens.add({
        targets: state.runtime.state,
        progress: 1,
        duration: travelDuration,
        yoyo: true,
        ease: 'cubic.inout',
        onUpdate: () => this.drawMechanismState(tile, state.runtime, state.runtime.state.progress, params, state.yaw),
        onComplete: () => {
          state.runtime.state.progress = 0;
          this.drawMechanismState(tile, state.runtime, 0, params, state.yaw);
        }
      });
    }

    handlePointerDown(pointer) {
      if (this.inspectState) {
        if (pointer.rightButtonDown()) {
          this.closeInspectMode();
          return;
        }
        this.dragState = {
          mode: 'inspectOrbit',
          lastX: pointer.x,
          lastY: pointer.y,
          lastAngle: Math.atan2(pointer.y - (this.inspectState.container?.y || pointer.y), pointer.x - (this.inspectState.container?.x || pointer.x)),
          moved: false
        };
        return;
      }
      this.config.onGearAxisPrompt?.(null);
      if (pointer.rightButtonDown()) {
        this.handleContextAction(pointer);
        return;
      }
      const hit = this.hitTest(pointer, {
        allowOutline: this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && !!this.activeTileType
      });
      const normalizedHit = this.normalizeInspectableHit(hit.hit);
      if (
        (this.activeTool === CITY_CHANNEL_TOOLS.BROWSE || this.activeTool === CITY_CHANNEL_TOOLS.SELECT)
        && this.isDoubleClickMechanismHit(pointer, normalizedHit)
      ) {
        this.dragState = null;
        this.inspectHitTile(normalizedHit);
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
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && this.activeComponentType) {
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
        this.dragState = { mode: 'carry' };
        return;
      }

      const selected = normalizedHit && this.isSelectedHit(normalizedHit);
      const canBoxSelect = this.activeTool === CITY_CHANNEL_TOOLS.SELECT;
      this.dragState = {
        mode: canBoxSelect && !normalizedHit ? 'box' : 'click',
        startX: pointer.x,
        startY: pointer.y,
        lastX: pointer.x,
        lastY: pointer.y,
        moved: false,
        shiftKey: pointer.event?.shiftKey,
        hit: { ...hit, hit: normalizedHit },
        canBoxSelect
      };
      if (selected) {
        this.longPressTimer = setTimeout(() => {
          if (!this.dragState || this.dragState.moved) return;
          this.startCarry(hit.hit || null);
          this.dragState.mode = 'carry';
          this.dragState.skipCarryCommitOnRelease = true;
          this.longPressTimer = null;
        }, SELECTED_MOVE_HOLD_DELAY);
      }
    }

    handlePointerMove(pointer) {
      if (this.inspectState) {
        if (this.dragState?.mode === 'inspectOrbit') {
          const dx = pointer.x - this.dragState.lastX;
          const dy = pointer.y - this.dragState.lastY;
          if (Math.hypot(dx, dy) > 0.5) this.dragState.moved = true;
          this.dragState.lastX = pointer.x;
          this.dragState.lastY = pointer.y;
          const degreesPerPixel = (INSPECT_ROTATE_SENSITIVITY * 180) / Math.PI;
          this.inspectState.yaw = normalizeCameraYaw((this.inspectState.yaw || 0) + (dx * degreesPerPixel));
          this.inspectState.pitch = Math.max(
            INSPECT_MIN_PITCH,
            Math.min(INSPECT_MAX_PITCH, (this.inspectState.pitch || 0) - (dy * degreesPerPixel))
          );
          this.refreshInspectPreview();
        }
        return;
      }

      if (this.dragState?.mode === 'pan' || this.dragState?.mode === 'rotateCamera') {
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

      if (this.dragState?.mode === 'paint') {
        if (!this.dragState.moved && !shouldStartPaintDrag(this.dragState, pointer)) return;
        this.dragState.moved = true;
        const hit = this.hitTest(pointer, { allowOutline: true });
        this.updateHover(hit);
        this.applyPaint(pointer, hit);
        return;
      }

      const hit = this.hitTest(pointer, { allowOutline: true });
      this.updateHover(hit);
      if (!this.dragState) {
        this.drawGhostLayer(
          (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && !!this.activeTileType)
          || (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && !!this.activeComponentType)
        );
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

      if (dragState.mode === 'inspectOrbit') return;

      if (dragState.mode === 'paint') {
        this.commitPaint();
        return;
      }

      if (this.carryState || dragState.mode === 'carry' || dragState.mode === 'carryConfirm') {
        if (dragState.skipCarryCommitOnRelease) {
          const hitInfo = this.hitTest(pointer, { allowOutline: true });
          this.updateCarrySelectionPreview(hitInfo);
          this.drawGhostLayer(true);
          return;
        }
        const hitInfo = this.hitTest(pointer, { allowOutline: true });
        const isRightClick = pointer?.event?.button === 2 || pointer?.rightButtonDown?.();
        if (!isRightClick && this.carryState?.kind === 'placement') {
          this.commitCarry(hitInfo, { keepCarry: true });
        } else {
          this.updateCarrySelectionPreview(hitInfo);
        }
        this.drawGhostLayer(true);
        return;
      }

      if (dragState.mode === 'box' && dragState.moved) {
        this.commitBoxSelect(pointer, dragState);
        return;
      }

      if (dragState.moved) return;
      const rawHit = this.hitTest(pointer);
      const hit = { ...rawHit, hit: this.normalizeInspectableHit(rawHit.hit) };
      if (this.activeTool === CITY_CHANNEL_TOOLS.SELECT || this.activeTool === CITY_CHANNEL_TOOLS.BROWSE) {
        if (hit.hit) {
          if (this.triggerMechanismFromHit(hit.hit)) return;
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
      if (this.inspectState) {
        this.closeInspectMode();
        return;
      }
      const hit = this.hitTest(pointer, { allowOutline: true });
      if (this.activeTool === CITY_CHANNEL_TOOLS.BROWSE) return;
      if (this.carryState) {
        const isRightClick = pointer?.event?.button === 2 || pointer?.rightButtonDown?.();
        if (!isRightClick) return;
        const hitInfo = this.hitTest(pointer, { allowOutline: true });
        if (this.carryState?.kind === 'gear' && hitInfo?.cell) this.commitCarry(hitInfo);
        if (this.carryState) this.endCarryPreview();
        return;
      }
      if (this.pendingMechanicalPort) {
        this.pendingMechanicalPort = null;
        this.drawMechanicalLayers();
        return;
      }
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType) {
        this.config.onExitPlaceMode?.();
        return;
      }
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && this.activeComponentType) {
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
      if (this.inspectState) return;
      const shiftHeld = !!pointer?.event?.shiftKey;
      const isCarryPlacement = this.carryState?.kind === 'placement';
      if (isCarryPlacement && shiftHeld) {
        const direction = deltaY < 0 ? 'forward' : 'reverse';
        this.rotateCarryPlacementSurface(direction);
        return;
      }
      if (!isCarryPlacement && shiftHeld && (this.selectedCells.length || this.selectedWalls.length)) {
        const direction = deltaY < 0 ? 'forward' : 'reverse';
        const placements = [...this.selectedCells, ...this.selectedWalls].map((placement) => ({ ...placement }));
        this.rotateTransmissionForPlacements(placements, direction);
        this.config.onRotateSelection?.(direction, { alreadyPreviewed: true, placements });
        return;
      }
      if (!isCarryPlacement && shiftHeld && this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType) {
        const delta = deltaY < 0 ? 90 : 270;
        this.rotateActivePlacement(delta);
        this.config.onHoverStatusChange?.(`放置预览：${delta === 90 ? '顺时针' : '逆时针'}旋转 90°`);
        return;
      }
      const nextZoom = Number(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.cameraState.zoom - (deltaY * 0.0014))).toFixed(2));
      this.cameraState.zoom = nextZoom;
      this.updateCameraTransform();
      this.refreshPointerStateAfterViewChange();
      this.drawSelectionLayer();
      this.drawGhostLayer(true);
      this.updateDebugText();
    }

    handleSpaceSurfaceToggle() {
      if (this.carryState?.kind === 'placement') {
        this.toggleCarryDefaultPose();
        return true;
      }
      if (!(this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType)) return false;
      const pointer = this.input?.activePointer;
      const hitInfo = pointer
        ? this.hitTest(pointer, { allowOutline: true })
        : {
          cell: this.hoverCell,
          hit: this.hoverTarget?.hit,
          edge: this.hoverEdge,
          localPoint: this.hoverTarget?.localPoint
        };
      const snap = this.resolvePlacementEdgeSnap(hitInfo);
      const snapAxisKey = this.getSnapAxisKey(snap);
      if (!snapAxisKey) {
        const nextPose = this.panelPose === 'wall' ? 'floor' : 'wall';
        this.setPlacementPose(nextPose);
        this.config.onHoverStatusChange?.(nextPose === 'wall' ? '放置预览：切换为竖放' : '放置预览：切换为平放');
        this.updateHover(hitInfo);
        this.drawGhostLayer(true);
        return true;
      }
      const options = this.getAxisPlacementOptions(snap);
      if (options.length <= 0) {
        const nextPose = this.panelPose === 'wall' ? 'floor' : 'wall';
        this.setPlacementPose(nextPose);
        this.config.onHoverStatusChange?.(
          nextPose === 'wall'
            ? '放置预览：吸附轴无空位，切换为默认竖放'
            : '放置预览：吸附轴无空位，切换为默认平放'
        );
        this.updateHover(hitInfo);
        this.drawGhostLayer(true);
        return true;
      }
      if (snapAxisKey !== this.activeSnapAxisKey) {
        this.activeSnapAxisKey = snapAxisKey;
        this.snapPlaneCycle = this.getPreferredAxisPlacementIndex(options);
      }
      this.snapPlaneCycle = ((this.snapPlaneCycle || 0) + 1) % options.length;
      const target = options[this.snapPlaneCycle] || options[0];
      this.setPlacementPose(target.kind === 'wall' ? 'wall' : 'floor');
      this.config.onHoverStatusChange?.('放置预览：围绕当前吸附边切换安装面');
      this.updateHover(hitInfo);
      this.drawGhostLayer(true);
      return true;
    }

    cycleActivePlacementSnapAxis() {
      if (!(this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType)) return false;
      const hitInfo = this.getActivePointerPlacementHitInfo();
      const snap = this.resolvePlacementEdgeSnap(hitInfo);
      const snapAxisKey = this.getSnapAxisKey(snap);
      if (!snapAxisKey) {
        this.config.onHoverStatusChange?.('放置预览：当前没有可旋转的吸附轴');
        this.drawGhostLayer(true);
        return true;
      }
      const allOptions = this.getAxisPlacementOptions(snap).filter((option) => option?.valid !== false);
      const poseKind = this.getAxisOptionKindForPose(this.panelPose);
      const options = allOptions.filter((option) => option.kind === poseKind);
      const currentTarget = snapAxisKey === this.activeSnapAxisKey
        ? this.resolveDynamicPlacementTarget(hitInfo, { forGhost: true, snap, allowReplacement: false })
        : null;
      let currentIndex = this.getAxisOptionIndex(options, currentTarget);
      if (options.length <= 1) {
        if (options.length === 1 && currentIndex < 0) {
          this.activeSnapAxisKey = snapAxisKey;
          const target = options[0];
          const targetIndex = this.getAxisOptionIndexInAllOptions(allOptions, target);
          this.snapPlaneCycle = targetIndex >= 0 ? targetIndex : 0;
          this.config.onHoverStatusChange?.('放置预览：沿当前吸附轴旋转到空位');
          this.updateHover(hitInfo);
          this.drawGhostLayer(true);
          return true;
        }
        this.config.onHoverStatusChange?.('放置预览：当前吸附轴没有其他空余方向');
        this.drawGhostLayer(true);
        return true;
      }
      if (snapAxisKey !== this.activeSnapAxisKey) {
        this.activeSnapAxisKey = snapAxisKey;
        const preferredTarget = allOptions[this.getPreferredAxisPlacementIndex(allOptions)];
        currentIndex = this.getAxisOptionIndex(options, preferredTarget);
      } else if (currentIndex < 0 && allOptions.length > 0) {
        const cycleIndex = (((this.snapPlaneCycle || 0) % allOptions.length) + allOptions.length) % allOptions.length;
        currentIndex = this.getAxisOptionIndex(options, allOptions[cycleIndex]);
      } else if (currentIndex >= 0) {
        const currentAllIndex = this.getAxisOptionIndexInAllOptions(allOptions, options[currentIndex]);
        if (currentAllIndex >= 0) this.snapPlaneCycle = currentAllIndex;
      }
      if (currentIndex < 0) currentIndex = 0;
      const target = options[((currentIndex + 1) % options.length + options.length) % options.length] || options[0];
      const targetIndex = this.getAxisOptionIndexInAllOptions(allOptions, target);
      this.snapPlaneCycle = targetIndex >= 0 ? targetIndex : 0;
      this.config.onHoverStatusChange?.('放置预览：沿当前吸附轴旋转到下一个空位');
      this.updateHover(hitInfo);
      this.drawGhostLayer(true);
      return true;
    }

    handleRotateSurface() {
      if (this.carryState?.kind === 'placement') {
        this.rotateCarryPlacementSurface('forward');
        return true;
      }
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType) {
        this.rotateActivePlacement(90);
        this.config.onHoverStatusChange?.('放置预览：顺时针旋转 90°');
        return true;
      }
      const selectedPlacements = [...this.selectedCells, ...this.selectedWalls].map((placement) => ({ ...placement }));
      if (
        this.activeTool === CITY_CHANNEL_TOOLS.SELECT
        && this.selectionScope !== 'component'
        && selectedPlacements.length === 1
      ) {
        this.rotateTransmissionForPlacements(selectedPlacements, 'forward');
        this.config.onRotateSelection?.('forward', {
          alreadyPreviewed: true,
          placements: selectedPlacements
        });
        this.config.onHoverStatusChange?.('选中板材：表面朝向顺时针旋转 90°');
        return true;
      }
      return false;
    }

    handleKeyDown(event) {
      const key = String(event.key || '').toLowerCase();
      if (event.target?.tagName?.toLowerCase() === 'input' || event.target?.tagName?.toLowerCase() === 'textarea') return;
      if (this.inspectState) {
        if (key === 'escape') {
          event.preventDefault();
          this.closeInspectMode();
        }
        return;
      }
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
      if ((event.ctrlKey || event.metaKey) && key === 'c') {
        const hasBoardSelection = (this.selectedCells.length + this.selectedWalls.length) > 0
          && this.selectionScope !== 'component';
        if (!this.carryState && hasBoardSelection) {
          event.preventDefault();
          const handled = this.config.onCopySelection?.();
          if (handled !== false) return;
          this.startCopyCarry();
          return;
        }
      }
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        this.config.onDeleteSelection?.();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        if (this.handleSpaceSurfaceToggle()) return;
      }
      if (key === 'r') {
        event.preventDefault();
        if (this.handleRotateSurface()) return;
      }
      if (key === 'm') {
        event.preventDefault();
        this.startCarry();
        return;
      }
      if (key === 'escape') {
        if (
          (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType)
          || (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && this.activeComponentType)
        ) {
          event.preventDefault();
          this.config.onExitPlaceMode?.();
          return;
        }
        this.endCarryPreview();
        this.pendingMechanicalPort = null;
        this.setSelection([], []);
        this.drawMechanicalLayers();
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
      const isPlacingTile = this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType;
      const placementSnap = isPlacingTile ? this.resolvePlacementEdgeSnap(hitInfo) : null;
      const snapAxisKey = this.getSnapAxisKey(placementSnap);
      if (snapAxisKey !== this.activeSnapAxisKey) {
        this.activeSnapAxisKey = snapAxisKey;
        this.snapPlaneCycle = snapAxisKey
          ? this.getPreferredAxisPlacementIndex(this.getAxisPlacementOptions(placementSnap))
          : 0;
      }
      const dynamicPlacementTarget = isPlacingTile
        ? this.resolveDynamicPlacementTarget(hitInfo, { forGhost: true, snap: placementSnap, allowReplacement: false })
        : null;
      const effectiveCell = dynamicPlacementTarget?.cell || hitInfo.cell;
      const effectiveEdge = dynamicPlacementTarget?.edge || hitInfo.edge;
      const effectiveCellKey = effectiveCell ? createCellKey(effectiveCell.x, effectiveCell.y, effectiveCell.z) : '';
      const nextKey = hitInfo.hit
        ? `${hitInfo.hit.type}:${createCellKey(hitInfo.hit.cell.x, hitInfo.hit.cell.y, hitInfo.hit.cell.z)}:${hitInfo.hit.edge || ''}:${hitInfo.hit.hitZone}:${effectiveCellKey}:${effectiveEdge || ''}`
        : (effectiveCell ? `cell:${effectiveCellKey}:${effectiveEdge || ''}:${dynamicPlacementTarget?.kind || ''}` : '');
      if (this.hoverTarget?.key === nextKey) {
        this.hoverTarget = { ...this.hoverTarget, localPoint: hitInfo.localPoint };
        this.hoverCell = effectiveCell;
        this.hoverEdge = effectiveEdge;
        return;
      }
      this.hoverTarget = { key: nextKey, hit: hitInfo.hit, localPoint: hitInfo.localPoint };
      this.hoverCell = effectiveCell;
      this.hoverEdge = effectiveEdge;
      this.drawMechanicalLayers();
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType) {
        const material = resolveMaterialName(this.activeTileType);
        const pose = dynamicPlacementTarget
          ? (dynamicPlacementTarget.kind === 'wall' ? '竖放' : '平放')
          : (this.isWallPlacementActive() ? '竖放' : '平放');
        this.config.onHoverStatusChange?.(
          effectiveCell
            ? `${material}｜${pose}｜${this.activeRotation}°｜R旋转 Space切吸附位`
            : `${material}｜未指向通道`
        );
        return;
      }
      if (hitInfo.hit) {
        if (hitInfo.hit.type === 'mechanical_port') {
          const port = hitInfo.hit.port;
          this.config.onHoverStatusChange?.(`${port.label}｜${port.kind}｜${(port.mediums || []).join('/')}`);
          this.drawSelectionLayer();
          this.refreshMechanismVisuals();
          return;
        }
        const material = resolveMaterialName(hitInfo.hit.panelType);
        const suffix = hitInfo.hit.hitZone === 'outline' ? '轮廓穿透' : '可选择';
        this.config.onHoverStatusChange?.(`${material}，${suffix}`);
      } else {
        this.config.onHoverStatusChange?.(effectiveCell ? '空地，可吸附放置' : '未指向通道');
      }
      this.drawSelectionLayer();
      this.refreshMechanismVisuals();
    }

    beginPaint(pointer, hitInfo) {
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && this.activeComponentType === GEAR_COMPONENT_TYPE) {
        this.paintStroke = {
          intent: 'place',
          isComponent: true,
          touched: new Set(),
          operations: [],
          label: '安装齿轮'
        };
        this.dragState = {
          mode: 'paint',
          startX: pointer.x,
          startY: pointer.y,
          moved: false
        };
        this.applyPaint(pointer, hitInfo);
        return;
      }
      const placementSnap = this.resolvePlacementEdgeSnap(hitInfo);
      const snapAxisKey = this.getSnapAxisKey(placementSnap);
      if (snapAxisKey !== this.activeSnapAxisKey) {
        this.activeSnapAxisKey = snapAxisKey;
        this.snapPlaneCycle = snapAxisKey
          ? this.getPreferredAxisPlacementIndex(this.getAxisPlacementOptions(placementSnap))
          : 0;
      }
      const placementTarget = this.resolveDynamicPlacementTarget(hitInfo, { snap: placementSnap, allowReplacement: false });
      if (placementTarget?.valid === false) return;
      const isWall = placementTarget?.kind === 'wall';
      const cell = placementTarget?.cell;
      if (!cell) return;
      this.paintStroke = {
        intent: 'place',
        isWall,
        touched: new Set(),
        operations: []
      };
      this.dragState = {
        mode: 'paint',
        startX: pointer.x,
        startY: pointer.y,
        moved: false
      };
      this.applyPaint(pointer, hitInfo);
    }

    applyPaint(pointer, suppliedHitInfo = null) {
      if (!this.paintStroke) return;
      const hitInfo = suppliedHitInfo || this.hitTest(pointer, { allowOutline: true });
      if (this.paintStroke.isComponent) {
        const target = this.getGearInstallTarget(hitInfo);
        if (!target?.valid) {
          this.drawGhostLayer();
          return;
        }
        const key = `${target.hostKey}:${target.surface}:${target.socket}`;
        if (this.paintStroke.touched.has(key)) {
          this.drawGhostLayer();
          return;
        }
        this.paintStroke.touched.add(key);
        const mount = {
          id: `gear_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          componentType: GEAR_COMPONENT_TYPE,
          position: target.socket,
          surface: target.surface,
          axisType: 'freeAxis',
          followMode: 'none',
          followDelaySeconds: 0,
          radius: 1,
          teeth: 12,
          phase: 0
        };
        this.paintStroke.operations.push({
          kind: 'gearMount',
          action: 'place',
          hostKind: target.hostKind,
          hostKey: target.hostKey,
          cell: target.cell,
          edge: target.edge,
          mount
        });
        this.pendingGearAxisPrompt = {
          hostKind: target.hostKind,
          hostKey: target.hostKey,
          mountId: mount.id,
          cell: target.cell,
          edge: target.edge,
          axisType: mount.axisType,
          socket: target.socket,
          surface: target.surface,
          anchor: this.getScreenAnchorForLocalPoint(target.point)
        };
        const hostMap = target.hostKind === 'wall' ? this.mapData.walls : this.mapData.tiles;
        const host = hostMap?.[target.hostKey];
        if (host) {
          host.gearMounts = [...(host.gearMounts || []), mount];
          if (target.hostKind === 'wall') this.renderWallObject(host);
          else this.renderTileObject(host);
          this.drawMechanicalLayers();
        }
        this.refreshAfterIncrementalEdit();
        this.drawGhostLayer(true);
        return;
      }
      const placementSnap = this.resolvePlacementEdgeSnap(hitInfo);
      const snapAxisKey = this.getSnapAxisKey(placementSnap);
      if (snapAxisKey !== this.activeSnapAxisKey) {
        this.activeSnapAxisKey = snapAxisKey;
        this.snapPlaneCycle = snapAxisKey
          ? this.getPreferredAxisPlacementIndex(this.getAxisPlacementOptions(placementSnap))
          : 0;
      }
      const placementTarget = this.resolveDynamicPlacementTarget(hitInfo, { snap: placementSnap, allowReplacement: false });
      const isWall = placementTarget?.kind === 'wall';
      const cell = placementTarget?.cell;
      if (!cell) {
        this.drawGhostLayer();
        return;
      }
      if (placementTarget?.valid === false) {
        this.drawGhostLayer();
        return;
      }
      const edge = isWall ? placementTarget?.edge : null;
      const key = isWall ? `${createCellKey(cell.x, cell.y, cell.z)}:${edge}` : createCellKey(cell.x, cell.y, cell.z);
      if (this.paintStroke.touched.has(key)) {
        this.drawGhostLayer();
        return;
      }

      if (isWall) {
        if (placementTarget?.valid !== true && !this.hasWallSupport(cell, edge)) {
          this.drawGhostLayer();
          return;
        }
        this.paintStroke.touched.add(key);
        const wallKey = createWallKey(cell.x, cell.y, cell.z, edge);
        const existing = this.mapData.walls?.[wallKey];
        const nextTransmissionRotation = normalizeRotation(this.activeRotation);
        const existingTransmissionRotation = normalizeRotation(
          existing?.transmissionRotation
            ?? existing?.rotation
            ?? wallEdgeToRotation(edge)
        );
        const shouldReplaceWall = !existing
          || existing.panelType !== this.activeTileType
          || existingTransmissionRotation !== nextTransmissionRotation;
        if (this.paintStroke.intent === 'erase') {
          if (existing) this.paintStroke.operations.push({ kind: 'wall', action: 'erase', cell, edge });
          delete this.mapData.walls[wallKey];
          this.removeWallObject({ ...cell, edge });
        } else if (shouldReplaceWall) {
          const legacyVerticalKey = createCellKey(cell.x, cell.y, cell.z);
          const legacyVerticalTile = this.mapData.tiles?.[legacyVerticalKey];
          if (legacyVerticalTile?.isVertical) {
            this.paintStroke.operations.push({ kind: 'tile', action: 'erase', cell });
            delete this.mapData.tiles[legacyVerticalKey];
            this.removeTileObject(cell);
          }
          const wall = createWall({
            x: cell.x,
            y: cell.y,
            z: cell.z,
            edge,
            panelType: this.activeTileType,
            transmissionRotation: this.activeRotation
          });
          this.paintStroke.operations.push({
            kind: 'wall',
            action: 'place',
            cell,
            edge,
            panelType: this.activeTileType,
            transmissionRotation: this.activeRotation
          });
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
              panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
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
            rotation: this.activeRotation,
            transmissionRotation: this.activeRotation
          });
          this.mapData.tiles[tileKey] = tile;
          this.renderTileObject(tile);
        }
      } else {
        this.paintStroke.touched.add(key);
        const tileKey = createCellKey(cell.x, cell.y, cell.z);
        const existing = this.mapData.tiles?.[tileKey];
        const nextRotation = normalizeRotation(this.activeRotation);
        const existingRotation = normalizeRotation(existing?.rotation || 0);
        const existingTransmissionRotation = normalizeRotation(
          existing?.transmissionRotation
            ?? existing?.rotation
            ?? 0
        );
        const shouldReplaceTile = !existing
          || existing.panelType !== this.activeTileType
          || existingRotation !== nextRotation
          || existingTransmissionRotation !== nextRotation;
        if (this.paintStroke.intent === 'erase') {
          if (existing?.panelType === this.activeTileType) this.paintStroke.operations.push({ kind: 'tile', action: 'erase', cell });
          delete this.mapData.tiles[tileKey];
          this.removeTileObject(cell);
        } else if (shouldReplaceTile) {
          const tile = createTile({ x: cell.x, y: cell.y, z: cell.z, panelType: this.activeTileType, rotation: this.activeRotation });
          this.paintStroke.operations.push({
            kind: 'tile',
            action: 'place',
            cell,
            panelType: this.activeTileType,
            rotation: this.activeRotation,
            transmissionRotation: this.activeRotation
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
      const label = this.paintStroke?.label || '批量建造';
      const gearAxisPrompt = this.pendingGearAxisPrompt;
      this.pendingGearAxisPrompt = null;
      this.paintStroke = null;
      if (operations.length > 0) {
        this.skipMapDataRenderCount += 1;
        this.scheduleReactCommit(operations, { label });
        if (gearAxisPrompt) {
          if (typeof window !== 'undefined') {
            window.setTimeout(() => this.config.onGearAxisPrompt?.(gearAxisPrompt), 0);
          } else {
            this.config.onGearAxisPrompt?.(gearAxisPrompt);
          }
        }
      }
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
      if (hit.type === 'mechanical_port') {
        this.handleMechanicalPortHit(hit);
        return;
      }
      if (hit.type === 'gear') {
        if (!canSelectComponentPlacement(this.selectionScope, additive)) return;
        const gear = {
          hostKind: hit.hostKind,
          hostKey: hit.hostKey,
          mountId: hit.mount?.id,
          cell: hit.cell,
          edge: hit.edge || null
        };
        let nextGears = additive ? [...this.selectedGears] : [];
        const key = `${gear.hostKey}:${gear.mountId}`;
        if (additive && nextGears.some((item) => `${item.hostKey}:${item.mountId}` === key)) {
          nextGears = nextGears.filter((item) => `${item.hostKey}:${item.mountId}` !== key);
        } else {
          nextGears.push(gear);
        }
        this.setSelection([], [], nextGears, 'component');
        this.config.onMechanismPanelRequest?.(null);
        return;
      }
      if (hit.type === 'wall') {
        if (!canSelectBoardPlacement(this.selectionScope, additive)) return;
        const wall = { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z, edge: hit.edge };
        let nextWalls = additive ? [...this.selectedWalls] : [];
        const key = createWallSelectionKey(wall);
        if (additive && nextWalls.some((item) => createWallSelectionKey(item) === key)) {
          nextWalls = nextWalls.filter((item) => createWallSelectionKey(item) !== key);
        } else {
          nextWalls.push(wall);
        }
        this.setSelection(additive ? this.selectedCells : [], nextWalls, [], 'board');
        if (!additive && nextWalls.length === 1) {
          this.requestMechanismPanel(hit);
        } else {
          this.config.onMechanismPanelRequest?.(null);
        }
        return;
      }
      if (!canSelectBoardPlacement(this.selectionScope, additive)) return;
      const cell = { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z };
      let nextCells = additive ? [...this.selectedCells] : [];
      const key = createCellKey(cell.x, cell.y, cell.z);
      if (additive && nextCells.some((item) => createCellKey(item.x, item.y, item.z) === key)) {
        nextCells = nextCells.filter((item) => createCellKey(item.x, item.y, item.z) !== key);
      } else {
        nextCells.push(cell);
      }
      this.setSelection(nextCells, additive ? this.selectedWalls : [], [], 'board');
      if (!additive && nextCells.length === 1) {
        this.requestMechanismPanel(hit);
      } else {
        this.config.onMechanismPanelRequest?.(null);
      }
    }

    setSelection(cells, walls, gears = [], scope = null, { lockExternalSync = false } = {}) {
      this.selectedCells = cells;
      this.selectedWalls = walls;
      this.selectedGears = gears;
      this.selectionScope = scope || (gears.length ? 'component' : (cells.length || walls.length) ? 'board' : null);
      if (lockExternalSync) {
        this.selectionSyncLock = {
          cells: new Set(cells.map((cell) => createCellKey(cell.x, cell.y, cell.z))),
          walls: new Set(walls.map(createWallSelectionKey)),
          gears: new Set(gears.map((gear) => `${gear.hostKey}:${gear.mountId}`)),
          scope: this.selectionScope,
          expiresAt: Date.now() + 1000
        };
      }
      this.config.onSelectionChange?.({ cells, walls, gears, scope: this.selectionScope });
      this.applySelectionScopeVisualState();
      this.drawSelectionLayer();
      this.refreshMechanismVisuals();
    }

    applySelectionScopeVisualState() {
      const componentMode = this.selectionScope === 'component';
      this.renderObjects.forEach((object, key) => {
        if (key.startsWith('tile:') || key.startsWith('wall:')) {
          object.setAlpha?.(componentMode ? 0.46 : 1);
          object.setTint?.(componentMode ? 0x94a3b8 : 0xffffff);
          if (!componentMode) object.clearTint?.();
        }
      });
    }

    isSelectedHit(hit) {
      if (!hit) return false;
      if (hit.type === 'gear') {
        return this.selectedGears.some((gear) => gear.hostKey === hit.hostKey && gear.mountId === hit.mount?.id);
      }
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

    setCarryState(nextState) {
      this.restoreCarrySourceVisuals();
      this.carryState = nextState || null;
      if (this.carryState?.kind === 'placement' && this.carryState?.mode !== 'copy') {
        this.hideCarrySourceVisuals(this.carryState.origins || []);
      }
      this.config.onCarryStateChange?.(!!this.carryState);
    }

    getCarrySourceRenderObjectKeys(origin = {}) {
      if (!origin) return [];
      if (origin.edge) {
        const key = createWallSelectionKey(origin);
        return [
          `wall:${key}`,
          `gear-far:wall:${key}`,
          `gear-near:wall:${key}`,
          `edge-overlay:wall:${key}`
        ];
      }
      const key = createCellKey(origin.x, origin.y, origin.z);
      return [
        `tile:${key}`,
        `gear-far:tile:${key}`,
        `gear-near:tile:${key}`,
        `edge-overlay:tile:${key}`,
        `mechanism:${key}`,
        `tile-label:${key}`
      ];
    }

    hideCarrySourceVisuals(origins = []) {
      this.carrySourceVisuals = [];
      origins.forEach((origin) => {
        this.getCarrySourceRenderObjectKeys(origin).forEach((key) => {
          const object = this.renderObjects.get(key);
          if (!object || this.carrySourceVisuals.some((entry) => entry.object === object)) return;
          this.carrySourceVisuals.push({
            object,
            visible: object.visible !== false,
            alpha: object.alpha
          });
          object.setVisible?.(false);
        });
      });
    }

    restoreCarrySourceVisuals() {
      (this.carrySourceVisuals || []).forEach(({ object, visible, alpha }) => {
        if (!object || object.destroyed) return;
        object.setVisible?.(visible);
        if (Number.isFinite(alpha)) object.setAlpha?.(alpha);
      });
      this.carrySourceVisuals = [];
    }

    startCopyCarry(anchorHit = null) {
      return this.startCarry(anchorHit, { mode: 'copy' });
    }

    startCarry(anchorHit = null, options = {}) {
      const carryMode = options?.mode === 'copy' ? 'copy' : 'move';
      if (this.selectionScope === 'component' && this.selectedGears.length > 0) {
        const gears = this.selectedGears.map((gear) => {
          const host = gear.hostKind === 'wall' ? this.mapData.walls?.[gear.hostKey] : this.mapData.tiles?.[gear.hostKey];
          const mount = host?.gearMounts?.find((item) => item.id === gear.mountId);
          return host && mount ? { ...gear, edge: gear.edge || host.edge || null, mount: { ...mount } } : null;
        }).filter(Boolean);
        if (gears.length <= 0) return;
        this.setCarryState({ kind: 'gear', gears });
        this.config.onHoverStatusChange?.('移动齿轮：选择一个合法吸附点');
        this.drawGhostLayer(true);
        return;
      }
      const origins = [...this.selectedCells, ...this.selectedWalls].map((item) => ({ ...item }));
      if (origins.length <= 0) return;
      const selectedPlacements = origins.map((origin) => (
        origin.edge
          ? this.mapData.walls?.[createWallSelectionKey(origin)] || origin
          : this.mapData.tiles?.[createCellKey(origin.x, origin.y, origin.z)] || origin
      )).filter(Boolean);
      const geometricCenter = this.getSelectionGeometricScreenCenter(selectedPlacements);
      const stableAnchor = getSelectionAnchor(origins) || origins[0] || null;
      const pointerHit = anchorHit?.cell
        ? { cell: anchorHit.cell, edge: anchorHit.edge, hit: anchorHit, localPoint: anchorHit.localPoint }
        : this.getCarryPlacementHitInfo();
      const grabLocalPoint = geometricCenter || pointerHit?.localPoint;
      this.setCarryState({
        kind: 'placement',
        mode: carryMode,
        origins,
        geometricCenter,
        anchor: stableAnchor,
        grabLocalPoint,
        defaultPose: selectedPlacements[0]?.edge || selectedPlacements[0]?.isVertical ? 'wall' : 'floor',
        groupRotationSteps: 0,
        groupPoseSteps: 0
      });
      if (geometricCenter) {
        const scenePoint = {
          x: this.worldLayer.x + (geometricCenter.x * (this.cameraState.zoom || 1)),
          y: this.worldLayer.y + (geometricCenter.y * (this.cameraState.zoom || 1))
        };
        const centerPointer = scenePoint;
        const centerHit = this.getPointerCell(centerPointer);
        this.hoverTarget = {
          key: `carry-center:${Math.round(geometricCenter.x)}:${Math.round(geometricCenter.y)}`,
          hit: centerHit?.hit || pointerHit?.hit || null,
          localPoint: geometricCenter
        };
        this.hoverCell = centerHit?.cell || stableAnchor;
        this.hoverEdge = null;
      }
      if (carryMode === 'copy') {
        this.setSelection([], [], [], null, { lockExternalSync: true });
        this.config.onHoverStatusChange?.('复制预览：选择一个合法放置位置');
      }
      this.drawGhostLayer(true);
      this.refreshCarryAttachedComponentLayers();
      return true;
    }

    getCarryPrimaryPlacement() {
      const origins = this.carryState?.origins || [];
      const origin = this.getCarrySnapReferenceOrigin(origins);
      if (!origin) return null;
      return origin.edge
        ? this.mapData.walls?.[createWallSelectionKey(origin)] || null
        : this.mapData.tiles?.[createCellKey(origin.x, origin.y, origin.z)] || null;
    }

    getCarryPlacementFromOrigin(origin = null) {
      if (!origin) return null;
      return origin.edge
        ? this.mapData.walls?.[createWallSelectionKey(origin)] || null
        : this.mapData.tiles?.[createCellKey(origin.x, origin.y, origin.z)] || null;
    }

    getCarryOriginWithPlacement(origin = null) {
      if (!origin) return null;
      const placement = this.getCarryPlacementFromOrigin(origin);
      return placement
        ? {
          ...origin,
          isVertical: !!placement.isVertical,
          panelType: placement.panelType
        }
        : { ...origin };
    }

    areCarryOriginsConnected(left = null, right = null) {
      if (!left || !right) return false;
      if (left.x === right.x && left.y === right.y && left.z === right.z && (left.edge || null) === (right.edge || null)) {
        return true;
      }
      const leftWall = !!left.edge;
      const rightWall = !!right.edge;
      const leftVertical = !!left.isVertical && !leftWall;
      const rightVertical = !!right.isVertical && !rightWall;
      if (leftWall && rightWall) {
        return left.edge === right.edge
          && left.x === right.x
          && left.y === right.y
          && Math.abs((Number(left.z) || 0) - (Number(right.z) || 0)) === 1;
      }
      const sameCell = left.x === right.x && left.y === right.y && left.z === right.z;
      const wallFloorConnected = (wall, floor) => {
        const offset = EDGE_NEIGHBOR_OFFSETS[wall.edge] || EDGE_NEIGHBOR_OFFSETS.north;
        const own = floor.x === wall.x && floor.y === wall.y && floor.z === wall.z;
        const neighbor = floor.x === wall.x + offset.x && floor.y === wall.y + offset.y && floor.z === wall.z;
        return own || neighbor;
      };
      if (leftWall && !rightWall) return wallFloorConnected(left, right) || (leftVertical && sameCell);
      if (rightWall && !leftWall) return wallFloorConnected(right, left) || (rightVertical && sameCell);
      if (leftVertical || rightVertical) return sameCell;
      return Number(left.z) === Number(right.z)
        && Math.abs((Number(left.x) || 0) - (Number(right.x) || 0)) + Math.abs((Number(left.y) || 0) - (Number(right.y) || 0)) === 1;
    }

    getCarrySnapReferenceOrigin(origins = null) {
      const sourceOrigins = Array.isArray(origins) ? origins : (this.carryState?.origins || []);
      if (!sourceOrigins.length) return null;
      if (sourceOrigins.length === 1) return sourceOrigins[0];
      const nodes = sourceOrigins.map((origin, index) => ({
        index,
        origin,
        enriched: this.getCarryOriginWithPlacement(origin)
      }));
      const graph = new Map(nodes.map((node) => [node.index, []]));
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          if (!this.areCarryOriginsConnected(nodes[i].enriched, nodes[j].enriched)) continue;
          graph.get(i)?.push(j);
          graph.get(j)?.push(i);
        }
      }
      const allCenter = nodes.reduce((acc, node) => ({
        x: acc.x + (Number(node.origin.x) || 0),
        y: acc.y + (Number(node.origin.y) || 0),
        z: acc.z + (Number(node.origin.z) || 0)
      }), { x: 0, y: 0, z: 0 });
      allCenter.x /= nodes.length;
      allCenter.y /= nodes.length;
      allCenter.z /= nodes.length;
      const visited = new Set();
      const components = [];
      nodes.forEach((node) => {
        if (visited.has(node.index)) return;
        const queue = [node.index];
        const indices = [];
        visited.add(node.index);
        while (queue.length) {
          const current = queue.shift();
          indices.push(current);
          (graph.get(current) || []).forEach((next) => {
            if (visited.has(next)) return;
            visited.add(next);
            queue.push(next);
          });
        }
        const center = indices.reduce((acc, idx) => ({
          x: acc.x + (Number(nodes[idx].origin.x) || 0),
          y: acc.y + (Number(nodes[idx].origin.y) || 0),
          z: acc.z + (Number(nodes[idx].origin.z) || 0)
        }), { x: 0, y: 0, z: 0 });
        center.x /= indices.length;
        center.y /= indices.length;
        center.z /= indices.length;
        const centerDist = Math.hypot(center.x - allCenter.x, center.y - allCenter.y);
        components.push({ indices, center, centerDist });
      });
      components.sort((a, b) => (b.indices.length - a.indices.length) || (a.centerDist - b.centerDist));
      const primary = components[0] || { indices: [0], center: allCenter };
      let best = nodes[primary.indices[0]];
      let bestDist = Infinity;
      primary.indices.forEach((idx) => {
        const current = nodes[idx];
        const dist = Math.hypot(
          (Number(current.origin.x) || 0) - primary.center.x,
          (Number(current.origin.y) || 0) - primary.center.y
        );
        if (dist < bestDist) {
          best = current;
          bestDist = dist;
        }
      });
      return best?.origin || sourceOrigins[0];
    }

    getCarryDefaultPose(placement = null) {
      const source = placement || this.getCarryPrimaryPlacement();
      if (this.carryState?.defaultPose === 'wall' || this.carryState?.defaultPose === 'floor') {
        return this.carryState.defaultPose;
      }
      return source?.edge || source?.isVertical ? 'wall' : 'floor';
    }

    isCarryVerticalSource(placement = null) {
      const source = placement || this.getCarryPrimaryPlacement();
      return !!(source?.edge || source?.isVertical);
    }

    isCarryMovingTileCell(cell = null) {
      if (this.carryState?.kind !== 'placement' || !cell) return false;
      const key = createCellKey(cell.x, cell.y, cell.z);
      return (this.carryState.origins || []).some((origin) => (
        !origin.edge && createCellKey(origin.x, origin.y, origin.z) === key
      ));
    }

    isCarryMovingWallCell(cell = null, edge = null) {
      if (this.carryState?.kind !== 'placement' || !cell || !edge) return false;
      const key = createWallKey(cell.x, cell.y, cell.z, edge);
      return (this.carryState.origins || []).some((origin) => (
        origin.edge && createWallKey(origin.x, origin.y, origin.z, origin.edge) === key
      ));
    }

    isCarryMovingPlacement(placement = null) {
      if (!placement) return false;
      return placement.edge
        ? this.isCarryMovingWallCell(placement, placement.edge)
        : this.isCarryMovingTileCell(placement);
    }

    getCarrySurfaceRotation(placement = null) {
      const source = placement || this.getCarryPrimaryPlacement();
      return normalizeRotation(
        this.carryState?.surfaceRotation
          ?? source?.transmissionRotation
          ?? source?.rotation
          ?? (source?.edge ? wallEdgeToRotation(source.edge) : 0)
      );
    }

    applyCarryGhostPoseToTarget(target) {
      if (this.carryState?.kind !== 'placement' || !target) return target;
      const origins = this.carryState.origins || [];
      if (origins.length > 1) {
        return { ...target };
      }
      const placement = this.getCarryPrimaryPlacement();
      const pose = this.getCarryDefaultPose(placement);
      const surfaceRotation = this.getCarrySurfaceRotation(placement);
      const targetPose = target.edge ? 'wall' : (target.layFlat ? 'floor' : pose);
      if (targetPose === 'wall') {
        const edge = target.edge || placement?.edge || this.hoverEdge || 'north';
        return {
          ...target,
          edge,
          rotation: surfaceRotation
        };
      }
      return {
        ...target,
        edge: undefined,
        rotation: surfaceRotation,
        layFlat: true
      };
    }

    toggleCarryDefaultPose() {
      if (this.carryState?.kind !== 'placement') return false;
      const origins = this.carryState.origins || [];
      if (origins.length > 1) {
        this.carryState.groupPoseSteps = ((this.carryState.groupPoseSteps || 0) + 1) % 4;
        this.carryState.axisTarget = null;
        this.carryState.snapAxisKey = null;
        this.carryState.snapPlaneCycle = 0;
        this.carryState.manualSurfaceTarget = false;
        this.config.onHoverStatusChange?.('多选移动预览：整体向前翻滚 90°');
        this.drawGhostLayer(true);
        return true;
      }
      const placement = this.getCarryPrimaryPlacement();
      if (!placement) return false;
      const nextPose = this.getCarryDefaultPose(placement) === 'wall' ? 'floor' : 'wall';
      this.carryState.defaultPose = nextPose;
      this.carryState.axisTarget = null;
      this.carryState.snapAxisKey = null;
      this.carryState.snapPlaneCycle = 0;
      this.carryState.manualSurfaceTarget = false;
      this.config.onHoverStatusChange?.(nextPose === 'wall' ? '移动预览：默认竖直吸附' : '移动预览：默认水平摆放');
      this.drawGhostLayer(true);
      return true;
    }

    rotateCarryPlacementSurface(direction = 'forward') {
      if (this.carryState?.kind !== 'placement') return false;
      const origins = this.carryState.origins || [];
      if (origins.length > 1) {
        const deltaStep = direction === 'reverse' ? -1 : 1;
        this.carryState.groupRotationSteps = ((this.carryState.groupRotationSteps || 0) + deltaStep + 4) % 4;
        this.carryState.axisTarget = null;
        this.carryState.snapAxisKey = null;
        this.carryState.snapPlaneCycle = 0;
        this.carryState.manualSurfaceTarget = false;
        this.config.onHoverStatusChange?.('多选移动预览：整体朝向已旋转 90°');
        this.drawGhostLayer(true);
        return true;
      }
      const placement = this.getCarryPrimaryPlacement();
      if (!placement) return false;
      const delta = direction === 'reverse' ? -90 : 90;
      this.carryState.surfaceRotation = normalizeRotation(this.getCarrySurfaceRotation(placement) + delta);
      if (this.carryState.axisTarget && !this.carryState.axisTarget.edge) {
        this.carryState.axisTarget = {
          ...this.carryState.axisTarget,
          rotation: this.carryState.surfaceRotation
        };
      }
      this.config.onHoverStatusChange?.('移动预览：表面朝向已旋转');
      this.drawGhostLayer(true);
      return true;
    }

    getSelectionGeometricScreenCenter(placements = []) {
      const points = [];
      placements.forEach((placement) => {
        if (!placement) return;
        const projection = projectCell(placement, this.cameraState.yaw, this.mapData);
        const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
        const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
        const polygons = placement.edge
          ? [
            createEdgeWallGeometry(this.cameraState.yaw, placement.edge, this.getWallMiterProfile(placement)).wall,
            createEdgeWallGeometry(this.cameraState.yaw, placement.edge, this.getWallMiterProfile(placement)).wallFront,
            createEdgeWallGeometry(this.cameraState.yaw, placement.edge, this.getWallMiterProfile(placement)).wallBack,
            createEdgeWallGeometry(this.cameraState.yaw, placement.edge, this.getWallMiterProfile(placement)).wallCap,
            createEdgeWallGeometry(this.cameraState.yaw, placement.edge, this.getWallMiterProfile(placement)).wallSideStart,
            createEdgeWallGeometry(this.cameraState.yaw, placement.edge, this.getWallMiterProfile(placement)).wallSideEnd
          ]
          : [
            createTileGeometry(this.cameraState.yaw, placement.rotation || 0).top,
            createTileGeometry(this.cameraState.yaw, placement.rotation || 0).wall,
            createTileGeometry(this.cameraState.yaw, placement.rotation || 0).wallFront,
            createTileGeometry(this.cameraState.yaw, placement.rotation || 0).wallBack,
            createTileGeometry(this.cameraState.yaw, placement.rotation || 0).wallCap,
            createTileGeometry(this.cameraState.yaw, placement.rotation || 0).wallSideStart,
            createTileGeometry(this.cameraState.yaw, placement.rotation || 0).wallSideEnd,
            ...(createTileGeometry(this.cameraState.yaw, placement.rotation || 0).sides || [])
          ];
        polygons.filter((polygon) => Array.isArray(polygon) && polygon.length >= 3).forEach((polygon) => {
          polygon.forEach((point) => {
            points.push({
              x: point.x + offsetX,
              y: point.y + offsetY
            });
          });
        });
      });
      if (points.length <= 0) return null;
      const bounds = getPointBounds(points);
      return bounds
        ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
        : null;
    }

    withCarryActivePanel(callback) {
      const placement = this.getCarryPrimaryPlacement();
      if (!placement || typeof callback !== 'function') return null;
      const previousTool = this.activeTool;
      const previousTileType = this.activeTileType;
      const previousRotation = this.activeRotation;
      const previousPose = this.panelPose;
      this.activeTool = CITY_CHANNEL_TOOLS.PLACE_TILE;
      this.activeTileType = placement.panelType;
      this.activeRotation = normalizeRotation(placement.transmissionRotation ?? placement.rotation ?? 0);
      this.panelPose = this.getCarryDefaultPose(placement);
      try {
        return callback(placement);
      } finally {
        this.activeTool = previousTool;
        this.activeTileType = previousTileType;
        this.activeRotation = previousRotation;
        this.panelPose = previousPose;
      }
    }

    getCarryPlacementHitInfo() {
      const pointer = this.input?.activePointer;
      return pointer
        ? this.hitTest(pointer, { allowOutline: true })
        : {
          cell: this.hoverCell,
          hit: this.hoverTarget?.hit,
          edge: this.hoverEdge,
          localPoint: this.hoverTarget?.localPoint
        };
    }

    getCarryAxisOptions(hitInfo = null) {
      if (this.carryState?.kind !== 'placement') return null;
      return this.withCarryActivePanel(() => {
        const effectiveHit = this.getCarryEffectiveHitInfo(hitInfo || this.getCarryPlacementHitInfo());
        const snap = this.resolvePlacementEdgeSnap(effectiveHit);
        const axisKey = this.getSnapAxisKey(snap);
        const options = axisKey ? this.getAxisPlacementOptions(snap).filter((option) => option?.valid !== false) : [];
        return { hitInfo: effectiveHit, snap, axisKey, options };
      });
    }

    getCarryPlacementSnapTarget(hitInfo = null) {
      if (this.carryState?.kind !== 'placement') return null;
      const origins = this.carryState.origins || [];
      const anchor = origins.length > 1
        ? this.getCarrySnapReferenceOrigin(origins)
        : (this.carryState.anchor || getSelectionAnchor(origins));
      return this.withCarryActivePanel(() => {
        const effectiveHit = this.getCarryEffectiveHitInfo(hitInfo || this.getCarryPlacementHitInfo());
        const snap = this.resolvePlacementEdgeSnap(effectiveHit);
        const axisKey = this.getSnapAxisKey(snap);
        if (axisKey) {
          const options = this.getAxisPlacementOptions(snap);
          if (this.carryState.snapAxisKey !== axisKey) {
            this.carryState.snapAxisKey = axisKey;
            this.carryState.snapPlaneCycle = this.getPreferredAxisPlacementIndex(options);
          }
          const option = options[this.carryState.snapPlaneCycle] || options[0];
          if (option?.cell) {
            return {
              x: option.cell.x,
              y: option.cell.y,
              z: option.cell.z,
              ...(option.kind === 'wall' ? { edge: option.edge } : {})
            };
          }
          if (snap?.cell) {
            if (this.isActiveVerticalBoardPlacement()) {
              const floorTile = this.mapData.tiles?.[createCellKey(snap.cell.x, snap.cell.y, snap.cell.z)];
              if (!floorTile || floorTile.isVertical || isPortalMaterial(floorTile.panelType)) {
                return null;
              }
              if (!this.hasVerticalSnapStructuralEdgeSupport(snap.cell, null, snap)) {
                return null;
              }
            }
            return {
              x: snap.cell.x,
              y: snap.cell.y,
              z: snap.cell.z
            };
          }
        } else if (this.carryState.snapAxisKey) {
          this.carryState.snapAxisKey = null;
          this.carryState.snapPlaneCycle = 0;
        }

        if (anchor?.edge) {
          const wallTarget = this.resolveWallGhostTarget(effectiveHit);
          if (wallTarget?.blocked) return { blocked: true };
          if (wallTarget?.cell) {
            return {
              x: wallTarget.cell.x,
              y: wallTarget.cell.y,
              z: wallTarget.cell.z,
              edge: wallTarget.edge || anchor.edge
            };
          }
        }

        const floorTarget = this.resolveFloorPlacementTarget(effectiveHit);
        if (floorTarget?.blocked) return { blocked: true };
        if (floorTarget?.cell) {
          return {
            x: floorTarget.cell.x,
            y: floorTarget.cell.y,
            z: floorTarget.cell.z
          };
        }

        return null;
      });
    }

    cycleCarryPlacementSurface({ allowMultiple = false } = {}) {
      if (this.carryState?.kind !== 'placement') return;
      const origins = this.carryState.origins || [];
      if (!allowMultiple && origins.length !== 1) {
        this.config.onHoverStatusChange?.('移动预览：仅单选可用滚轮翻面');
        return;
      }
      const result = this.getCarryAxisOptions();
      if (!result?.axisKey || result.options.length <= 0) {
        if (origins.length === 1) {
          this.toggleCarryDefaultPose();
          return;
        }
        this.config.onHoverStatusChange?.('移动预览：当前吸附轴周围没有空余安装面');
        this.drawGhostLayer(true);
        return;
      }
      if (this.carryState.snapAxisKey !== result.axisKey) {
        this.carryState.snapAxisKey = result.axisKey;
        this.carryState.snapPlaneCycle = 0;
      } else {
        this.carryState.snapPlaneCycle = ((this.carryState.snapPlaneCycle || 0) + 1) % result.options.length;
      }
      const target = result.options[this.carryState.snapPlaneCycle] || result.options[0];
      this.carryState.axisTarget = {
        x: target.cell.x,
        y: target.cell.y,
        z: target.cell.z,
        ...(target.kind === 'wall' ? { edge: target.edge } : {}),
        ...(target.kind !== 'wall'
          ? { layFlat: this.getCarryDefaultPose() === 'floor' }
          : {})
      };
      this.carryState.manualSurfaceTarget = false;
      this.config.onHoverStatusChange?.(
        allowMultiple
          ? '移动预览：按整体切换朝向，内部相对位置保持不变'
          : '移动预览：围绕当前吸附边切换安装面'
      );
      this.drawGhostLayer(true);
    }

    cycleCarrySnapAxisRotation() {
      if (this.carryState?.kind !== 'placement') return false;
      const origins = this.carryState.origins || [];
      if (origins.length !== 1) {
        this.config.onHoverStatusChange?.('移动预览：仅单选可沿吸附轴旋转');
        this.drawGhostLayer(true);
        return true;
      }
      const result = this.getCarryAxisOptions();
      if (!result?.axisKey) {
        this.config.onHoverStatusChange?.('移动预览：当前没有可旋转的吸附轴');
        this.drawGhostLayer(true);
        return true;
      }
      const allOptions = result.options;
      const poseKind = this.getAxisOptionKindForPose(this.getCarryDefaultPose());
      const options = allOptions.filter((option) => option.kind === poseKind);
      let currentIndex = this.getAxisOptionIndex(options, this.carryState.axisTarget);
      if (
        currentIndex < 0
        && this.carryState.snapAxisKey === result.axisKey
        && allOptions.length > 0
      ) {
        const cycleIndex = (((this.carryState.snapPlaneCycle || 0) % allOptions.length) + allOptions.length) % allOptions.length;
        currentIndex = this.getAxisOptionIndex(options, allOptions[cycleIndex]);
      }
      if (options.length <= 1) {
        if (options.length === 1 && currentIndex < 0) {
          this.carryState.snapAxisKey = result.axisKey;
          const target = options[0];
          const targetIndex = this.getAxisOptionIndexInAllOptions(allOptions, target);
          this.carryState.snapPlaneCycle = targetIndex >= 0 ? targetIndex : 0;
          this.carryState.axisTarget = {
            x: target.cell.x,
            y: target.cell.y,
            z: target.cell.z,
            ...(target.kind === 'wall' ? { edge: target.edge } : {}),
            ...(target.kind !== 'wall'
              ? { layFlat: this.getCarryDefaultPose() === 'floor' }
              : {})
          };
          this.carryState.manualSurfaceTarget = false;
          this.config.onHoverStatusChange?.('移动预览：沿当前吸附轴旋转到空位');
          this.drawGhostLayer(true);
          return true;
        }
        this.config.onHoverStatusChange?.('移动预览：当前吸附轴没有其他空余方向');
        this.drawGhostLayer(true);
        return true;
      }
      if (this.carryState.snapAxisKey !== result.axisKey) {
        this.carryState.snapAxisKey = result.axisKey;
        const preferredTarget = allOptions[this.getPreferredAxisPlacementIndex(allOptions)];
        currentIndex = this.getAxisOptionIndex(options, preferredTarget);
      } else if (currentIndex >= 0) {
        const currentAllIndex = this.getAxisOptionIndexInAllOptions(allOptions, options[currentIndex]);
        if (currentAllIndex >= 0) this.carryState.snapPlaneCycle = currentAllIndex;
      }
      if (currentIndex < 0) currentIndex = 0;
      const target = options[((currentIndex + 1) % options.length + options.length) % options.length] || options[0];
      const targetIndex = this.getAxisOptionIndexInAllOptions(allOptions, target);
      this.carryState.snapPlaneCycle = targetIndex >= 0 ? targetIndex : 0;
      this.carryState.axisTarget = {
        x: target.cell.x,
        y: target.cell.y,
        z: target.cell.z,
        ...(target.kind === 'wall' ? { edge: target.edge } : {}),
        ...(target.kind !== 'wall'
          ? { layFlat: this.getCarryDefaultPose() === 'floor' }
          : {})
      };
      this.carryState.manualSurfaceTarget = false;
      this.config.onHoverStatusChange?.('移动预览：沿当前吸附轴旋转到下一个空位');
      this.drawGhostLayer(true);
      return true;
    }

    getCarryPlacementTarget(hitInfo = null) {
      if (this.carryState?.kind !== 'placement') return null;
      const effectiveHit = this.getCarryEffectiveHitInfo(hitInfo || this.getCarryPlacementHitInfo());
      const pointerMoved = this.hasCarryPointerMoved(effectiveHit);
      if (this.carryState.axisTarget && (this.carryState.manualSurfaceTarget || !pointerMoved)) {
        return this.applyCarryGhostPoseToTarget(this.carryState.axisTarget);
      }
      if (!pointerMoved) {
        return this.applyCarryGhostPoseToTarget(this.getCarryOriginTargetCell());
      }
      const result = this.getCarryAxisOptions(effectiveHit);
      if (!result?.axisKey || this.carryState.snapAxisKey !== result.axisKey) {
        this.carryState.axisTarget = null;
        this.carryState.snapAxisKey = null;
        this.carryState.manualSurfaceTarget = false;
      }
      if (this.carryState.axisTarget) return this.applyCarryGhostPoseToTarget(this.carryState.axisTarget);
      const placementHitInfo = result?.hitInfo || effectiveHit;
      const placementTarget = this.withCarryActivePanel(() => this.resolveCarryPlacementLikePlace(placementHitInfo));
      if (placementTarget?.blocked) return placementTarget;
      if (placementTarget) return this.applyCarryGhostPoseToTarget(placementTarget);
      if (effectiveHit?.cell) {
        return this.applyCarryGhostPoseToTarget({
          x: effectiveHit.cell.x,
          y: effectiveHit.cell.y,
          z: effectiveHit.cell.z,
          ...(effectiveHit.edge ? { edge: effectiveHit.edge } : {})
        });
      }
      return this.applyCarryGhostPoseToTarget(this.getCarryOriginTargetCell());
    }

    updateCarrySelectionPreview(hitInfo = null) {
      if (this.carryState?.kind !== 'placement') return false;
      const targetCell = this.getCarryPlacementTarget(hitInfo) || hitInfo?.cell || hitInfo;
      if (!targetCell || targetCell?.blocked) return false;
      const { valid, moves, previewTiles, previewWalls } = this.computeMovePreview(targetCell);
      if (!valid || !Array.isArray(moves) || moves.length <= 0) return false;
      this.carryState.previewSelection = {
        cells: moves
          .filter((move) => !move?.to?.edge)
          .map((move) => ({ x: move.to.x, y: move.to.y, z: move.to.z })),
        walls: moves
          .filter((move) => !!move?.to?.edge)
          .map((move) => ({ x: move.to.x, y: move.to.y, z: move.to.z, edge: move.to.edge }))
      };
      this.carryState.previewTiles = previewTiles || null;
      this.carryState.previewWalls = previewWalls || null;
      this.drawSelectionLayer();
      return true;
    }

    commitCarry(hitInfo, { keepCarry = false } = {}) {
      if (!this.carryState) return;
      if (this.carryState.kind === 'gear') {
        this.commitGearCarry(hitInfo);
        return;
      }
      const targetCell = this.getCarryPlacementTarget(hitInfo) || hitInfo?.cell || hitInfo;
      if (targetCell?.blocked) return;
      if (!targetCell) return;
      const { valid, moves, previewTiles, previewWalls } = this.computeMovePreview(targetCell);
      const unsupportedWallMove = moves.find((move) => (
        move?.to?.edge && !this.hasWallSupportInPreviewMaps(move.to, move.to.edge, previewTiles, previewWalls)
      ));
      if (unsupportedWallMove) {
        this.config.onToast?.('竖直板缺少支撑，无法放置在该位置。', 'error');
        return;
      }
      if (!valid) {
        this.config.onToast?.(
          this.carryState?.mode === 'copy'
            ? '目标位置存在冲突，无法完成复制。'
            : '目标位置存在冲突，无法完成移动。',
          'error'
        );
        return;
      }
      const nextCells = moves
        .filter((move) => !move?.to?.edge)
        .map((move) => ({ x: move.to.x, y: move.to.y, z: move.to.z }));
      const nextWalls = moves
        .filter((move) => !!move?.to?.edge)
        .map((move) => ({ x: move.to.x, y: move.to.y, z: move.to.z, edge: move.to.edge }));
      this.setSelection(nextCells, nextWalls, [], (nextCells.length || nextWalls.length) ? 'board' : null, {
        lockExternalSync: true
      });
      if (previewTiles && previewWalls) {
        this.mapData = {
          ...this.mapData,
          tiles: Object.fromEntries(previewTiles),
          walls: Object.fromEntries(previewWalls)
        };
        this.refreshAfterIncrementalEdit();
        this.renderMap();
      }
      if (this.carryState?.mode === 'copy') {
        const copyOperations = this.buildCopyPlacementOperations(moves);
        if (copyOperations.length <= 0) {
          this.config.onToast?.('复制失败：选中对象无可复制内容。', 'error');
          return;
        }
        this.config.onCommitOperations?.(copyOperations, { label: '复制板材' });
      } else {
        this.config.onMovePlacements?.(moves);
      }
      if (keepCarry) {
        if (this.carryState?.mode === 'copy') this.startCopyCarry();
        else this.startCarry();
        return;
      }
      this.endCarryPreview();
    }

    buildCopyPlacementOperations(moves = []) {
      if (!Array.isArray(moves) || moves.length <= 0) return [];
      return moves.map((move) => {
        const from = move?.from;
        const to = move?.to;
        if (!from || !to) return null;
        const sourcePlacement = from.edge
          ? this.mapData.walls?.[createWallSelectionKey(from)]
          : this.mapData.tiles?.[createCellKey(from.x, from.y, from.z)];
        if (!sourcePlacement) return null;
        if (to.edge) {
          return {
            kind: 'wall',
            action: 'place',
            cell: { x: to.x, y: to.y, z: to.z },
            edge: to.edge,
            panelType: sourcePlacement.panelType,
            transmissionRotation: normalizeRotation(
              to.transmissionRotation
                ?? to.rotation
                ?? sourcePlacement.transmissionRotation
                ?? sourcePlacement.rotation
                ?? wallEdgeToRotation(to.edge)
            )
          };
        }
        return {
          kind: 'tile',
          action: 'place',
          cell: { x: to.x, y: to.y, z: to.z },
          panelType: sourcePlacement.panelType,
          rotation: normalizeRotation(to.rotation ?? sourcePlacement.rotation ?? 0),
          transmissionRotation: normalizeRotation(
            to.transmissionRotation ?? to.rotation ?? sourcePlacement.transmissionRotation ?? sourcePlacement.rotation ?? 0
          )
        };
      }).filter(Boolean);
    }

    getGearHostFromSelection(gear) {
      if (!gear?.hostKey) return null;
      return gear.hostKind === 'wall' ? this.mapData.walls?.[gear.hostKey] : this.mapData.tiles?.[gear.hostKey];
    }

    getNearestGearSocket(localPosition) {
      if (!localPosition) return null;
      let best = null;
      GEAR_SOCKET_POSITIONS.forEach((socket) => {
        const socketLocal = getGearMountLocalPosition(socket);
        const distance = Math.hypot((localPosition.x || 0) - socketLocal.x, (localPosition.y || 0) - socketLocal.y);
        if (!best || distance < best.distance) best = { socket, distance };
      });
      return best?.distance <= 0.09 ? best.socket : null;
    }

    commitGearCarry(hitInfo) {
      const gears = this.carryState?.gears || [];
      if (gears.length <= 0) return;
      const target = this.getGearInstallTarget(hitInfo);
      if (!target?.point) {
        this.config.onToast?.('请选择板材表面的合法吸附点。', 'error');
        return;
      }
      const sourceHostKeys = new Set(gears.map((gear) => gear.hostKey));
      if (gears.length > 1 && sourceHostKeys.size > 1) {
        this.config.onToast?.('多选移动需要来自同一块板材。', 'error');
        return;
      }
      const anchorGear = gears[0];
      const anchorLocal = getGearMountLocalPosition(anchorGear.mount.position);
      const targetLocal = getGearMountLocalPosition(target.socket);
      const selectedIds = new Set(gears.map((gear) => gear.mountId));
      const movedMounts = [];
      const usedKeys = new Set();
      for (const gear of gears) {
        const sourceHost = this.getGearHostFromSelection(gear);
        if (!sourceHost) {
          this.config.onToast?.('齿轮宿主不存在，无法移动。', 'error');
          return;
        }
        const sourceLocal = getGearMountLocalPosition(gear.mount.position);
        const nextSocket = gears.length === 1
          ? target.socket
          : this.getNearestGearSocket({
            x: sourceLocal.x + (targetLocal.x - anchorLocal.x),
            y: sourceLocal.y + (targetLocal.y - anchorLocal.y)
          });
        if (!nextSocket) {
          this.config.onToast?.('目标板材没有足够的对应吸附位。', 'error');
          return;
        }
        if (this.isGearSocketBlockedBySurface(target.placement, nextSocket)) {
          this.config.onToast?.('目标吸附位被竖直板材遮挡。', 'error');
          return;
        }
        const nextKey = `${target.hostKey}:${target.surface}:${nextSocket}`;
        if (usedKeys.has(nextKey)) {
          this.config.onToast?.('目标吸附位发生重叠。', 'error');
          return;
        }
        usedKeys.add(nextKey);
        const occupied = (target.placement?.gearMounts || []).some((mount) => (
          mount.position === nextSocket
          && (mount.surface || 'front') === target.surface
          && !selectedIds.has(mount.id)
        ));
        if (occupied) {
          this.config.onToast?.('目标吸附位已有齿轮。', 'error');
          return;
        }
        movedMounts.push({
          gear,
          mount: {
            ...gear.mount,
            position: nextSocket,
            surface: target.surface
          }
        });
      }
      const operations = movedMounts.flatMap(({ gear, mount }) => ([
        {
          kind: 'gearMount',
          action: 'erase',
          hostKind: gear.hostKind,
          hostKey: gear.hostKey,
          mount: gear.mount
        },
        {
          kind: 'gearMount',
          action: 'place',
          hostKind: target.hostKind,
          hostKey: target.hostKey,
          cell: target.cell,
          edge: target.edge,
          mount
        }
      ]));
      this.setCarryState(null);
      this.setSelection([], [], movedMounts.map(({ mount }) => ({
        hostKind: target.hostKind,
        hostKey: target.hostKey,
        mountId: mount.id,
        cell: target.cell,
        edge: target.edge || null
      })), 'component');
      this.config.onCommitOperations?.(operations, { label: '移动齿轮' });
      this.drawGhostLayer(true);
    }

    computeMovePreview(targetCell) {
      const origins = this.carryState?.origins || [];
      if (origins.length <= 0 || !targetCell) return { valid: true, moves: [], conflicts: [], conflictKeys: new Set() };
      const explicitSurfaceTarget = origins.length === 1
        ? (targetCell.edge ? targetCell : null)
        : null;
      const selectionAnchor = origins.length > 1
        ? this.getCarrySnapReferenceOrigin(origins)
        : (this.carryState?.anchor || getSelectionAnchor(origins));
      const groupRotationSteps = origins.length > 1 ? (this.carryState?.groupRotationSteps || 0) : 0;
      const groupPoseSteps = origins.length > 1 ? (this.carryState?.groupPoseSteps || 0) : 0;
      const preserveOrigins = this.carryState?.mode === 'copy';
      const preview = computeCityChannelMovePreviewModel({
        mapData: this.mapData,
        origins,
        targetCell,
        anchor: selectionAnchor,
        explicitSurfaceTarget,
        preserveOrigins,
        groupRotationSteps,
        groupPoseSteps,
        includeConflictKeys: true
      });
      const {
        moves,
        conflicts,
        conflictKeys,
        invalidPlacementKeys,
        componentResults,
        previewTiles,
        previewWalls
      } = preview;
      return {
        valid: conflicts.length === 0 && Array.from(componentResults.values()).every((component) => component.valid),
        moves,
        conflicts,
        conflictKeys,
        invalidPlacementKeys,
        componentResults,
        previewTiles,
        previewWalls
      };
    }

    getTransmissionPortPoint(tile, port) {
      if (!tile || !port) return null;
      const point = this.getTransmissionSurfacePortPoint(tile, port, tile.edge ? 'wall' : null);
      if (!point) return null;
      return {
        x: point.x,
        y: point.y - ((Number(port.localPosition?.z) || 0) * 52)
      };
    }

    hasWallSupportInPreviewMaps(cell, edge = 'north', previewTiles = new Map(), previewWalls = new Map()) {
      if (!cell || !edge) return false;
      const ownCell = { x: Number(cell.x) || 0, y: Number(cell.y) || 0, z: Number(cell.z) || 0 };
      const neighborOffset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
      const neighbor = {
        x: ownCell.x + neighborOffset.x,
        y: ownCell.y + neighborOffset.y,
        z: ownCell.z
      };
      const hasSupportingFloor = (candidate) => {
        const tile = previewTiles.get(createCellKey(candidate.x, candidate.y, candidate.z));
        return !!tile && !tile.isVertical && !isPortalMaterial(tile.panelType);
      };
      if (hasSupportingFloor(ownCell) || hasSupportingFloor(neighbor)) return true;
      if (ownCell.z <= 0) return false;
      const belowOwn = { ...ownCell, z: ownCell.z - 1 };
      const belowNeighbor = { ...neighbor, z: neighbor.z - 1 };
      if (hasSupportingFloor(belowOwn) || hasSupportingFloor(belowNeighbor)) return true;
      return !!previewWalls.get(createWallKey(ownCell.x, ownCell.y, ownCell.z - 1, edge));
    }

    getTransmissionCenterPoint(tile) {
      if (!tile) return null;
      const centerPort = { localPosition: { x: 0, y: 0, z: 0 } };
      return this.getTransmissionPortPoint(tile, centerPort);
    }

    drawTransmissionRail(graphics, center, point, {
      alpha = 0.82,
      color = 0xfacc15,
      width = 2.5,
      endpointRadius = 3.4
    } = {}) {
      if (!graphics || !center || !point) return;
      const dx = center.x - point.x;
      const dy = center.y - point.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const cross = { x: -(dy / length), y: dx / length };
      graphics.lineStyle(width + 3, 0x78350f, alpha * 0.42);
      graphics.lineBetween(center.x, center.y, point.x, point.y);
      graphics.lineStyle(width, color, alpha);
      graphics.lineBetween(center.x, center.y, point.x, point.y);
      graphics.fillStyle(0x451a03, alpha * 0.76);
      graphics.fillCircle(point.x, point.y, endpointRadius + 1);
      graphics.fillStyle(color, alpha);
      graphics.fillCircle(point.x, point.y, endpointRadius);
      graphics.fillStyle(0xfef3c7, alpha * 0.8);
      graphics.fillCircle(point.x + (cross.x * 1.6), point.y + (cross.y * 1.6), 1.1);
      graphics.fillCircle(point.x - (cross.x * 1.6), point.y - (cross.y * 1.6), 1.1);
    }

    drawTransmissionPortSocket(graphics, tile, port, connected = false) {
      const point = this.getTransmissionPortPoint(tile, port);
      if (!graphics || !point) return;
      const center = this.getTransmissionCenterPoint(tile);
      this.drawTransmissionRail(graphics, center || point, point, {
        alpha: connected ? 0.82 : 0.5,
        color: connected ? 0xfacc15 : 0xb45309,
        width: connected ? 2.5 : 2,
        endpointRadius: connected ? 3.2 : 2.7
      });
    }

    getScreenAnchorForLocalPoint(point) {
      if (!point) return null;
      const zoom = this.cameraState.zoom || 1;
      const scenePoint = {
        x: this.worldLayer.x + (point.x * zoom),
        y: this.worldLayer.y + (point.y * zoom)
      };
      const rect = this.game?.canvas?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0 && this.scale.width > 0 && this.scale.height > 0) {
        return {
          left: rect.left + ((scenePoint.x / this.scale.width) * rect.width),
          top: rect.top + ((scenePoint.y / this.scale.height) * rect.height)
        };
      }
      return {
        left: scenePoint.x,
        top: scenePoint.y
      };
    }

    getGearSurfaceNormal(placement, surfaceSide = 'front') {
      if (!placement) return { x: 0, y: 1 };
      let normal = { x: 0, y: 1 };
      if (placement.edge) {
        normal = EDGE_NEIGHBOR_OFFSETS[placement.edge] || normal;
      } else if (placement.isVertical) {
        const normalizedRotation = ((Number.parseInt(placement.rotation, 10) || 0) % 180 + 180) % 180;
        normal = normalizedRotation === 90 ? { x: 1, y: 0 } : { x: 0, y: 1 };
      }
      return surfaceSide === 'back'
        ? { x: -normal.x, y: -normal.y }
        : normal;
    }

    getVisibleGearSurfaceSide(placement) {
      if (!placement?.edge && !placement?.isVertical) return 'front';
      const normal = this.getGearSurfaceNormal(placement, 'front');
      const projected = projectWorldOffset(normal.x, normal.y, this.cameraState.yaw);
      return projected.y >= 0 ? 'front' : 'back';
    }

    isGearSurfaceVisible(placement, mount = {}) {
      if (!placement || !mount) return false;
      if (!placement.edge && !placement.isVertical) return (mount.surface || 'front') === 'front';
      return true;
    }

    isGearOnCameraSide(placement, mount = {}) {
      if (!placement || !mount) return false;
      if (!placement.edge && !placement.isVertical) return (mount.surface || 'front') === 'front';
      return (mount.surface || 'front') === this.getVisibleGearSurfaceSide(placement);
    }

    getMountedGearLayerKey(hostKind, hostKey, side) {
      return `gear-${side}:${hostKind}:${hostKey}`;
    }

    getMountedGearHostDepth(hostKind, placement) {
      if (!placement) return 0;
      const cell = { x: placement.x, y: placement.y, z: placement.z };
      if (hostKind === 'wall' || placement.edge) {
        return getPlacementDepth({
          cell,
          partType: 'wall_plane',
          physicalLayer: 'wall_plane',
          edge: placement.edge,
          rotation: placement.rotation || 0,
          cameraYaw: this.cameraState.yaw,
          mapData: this.mapData
        });
      }
      const isPortal = isPortalMaterial(placement.panelType);
      return getPlacementDepth({
        cell,
        partType: isPortal ? 'portal_body' : placement.isVertical ? 'wall_plane' : 'floor_base',
        physicalLayer: isPortal ? 'portal_body' : placement.isVertical ? 'wall_plane' : 'floor_base',
        rotation: placement.rotation || 0,
        cameraYaw: this.cameraState.yaw,
        mapData: this.mapData
      });
    }

    getOrCreateMountedGearGraphics(hostKind, hostKey, side) {
      const key = this.getMountedGearLayerKey(hostKind, hostKey, side);
      let graphics = this.renderObjects.get(key);
      if (!graphics) {
        graphics = this.add.graphics();
        graphics.setData('placementId', key);
        graphics.setData('kind', 'gear-layer');
        this.mapLayer.add(graphics);
        this.renderObjects.set(key, graphics);
      }
      return graphics;
    }

    drawGearHostSurfaceOccluder(graphics, placement, surfaceSide = 'front') {
      const context = this.getGearSurfaceContext(placement, surfaceSide);
      if (!context?.polygon || context.polygon.length < 3) return;
      const polygon = context.polygon.map((point) => ({
        x: point.x + context.offsetX,
        y: point.y + context.offsetY
      }));
      this.drawProjectedSurfacePolygon(graphics, polygon, 0x2f3744, 0.96, 0x020617, 0.24, 1);
    }

    isHostMovingWithCarry(hostKey) {
      if (this.carryState?.kind !== 'placement' || !hostKey) return false;
      const movingHostKeys = getMovingHostKeysFromOrigins(this.carryState.origins || []);
      return movingHostKeys.has(hostKey);
    }

    refreshCarryAttachedComponentLayers() {
      if (this.carryState?.kind === 'placement') {
        this.redrawAllMountedGearLayers();
      }
    }

    endCarryPreview() {
      this.setCarryState(null);
      this.drawGhostLayer(true);
      this.drawSelectionLayer();
      this.redrawAllMountedGearLayers();
    }

    drawPlacementGhostAttachedComponents(ghostPlacement, { valid = true } = {}) {
      if (!ghostPlacement) return;
      const mounts = Array.isArray(ghostPlacement.gearMounts) ? ghostPlacement.gearMounts : [];
      if (mounts.length <= 0) return;
      const ghostAlpha = valid ? 0.86 : 0.68;
      mounts.forEach((mount) => {
        if (!this.isGearSurfaceVisible(ghostPlacement, mount)) return;
        const point = this.getGearMountPoint(ghostPlacement, mount);
        if (!point) return;
        this.drawMountedGearPreview(this.ghostLayer, point, {
          placement: ghostPlacement,
          mount,
          valid,
          ghost: true,
          alpha: ghostAlpha,
          axisType: mount.axisType,
          angle: mount.phase || 0
        });
      });
    }

    redrawMountedGearHostLayers(hostKind, hostKey, placement, suppliedDepth = null) {
      if (!placement || !hostKey) return;
      if (this.isHostMovingWithCarry(hostKey)) {
        this.removeRenderObject(this.getMountedGearLayerKey(hostKind, hostKey, 'far'));
        this.removeRenderObject(this.getMountedGearLayerKey(hostKind, hostKey, 'near'));
        return;
      }
      const mounts = Array.isArray(placement.gearMounts)
        ? placement.gearMounts.filter((mount) => this.isGearSurfaceVisible(placement, mount))
        : [];
      const farKey = this.getMountedGearLayerKey(hostKind, hostKey, 'far');
      const nearKey = this.getMountedGearLayerKey(hostKind, hostKey, 'near');
      if (mounts.length <= 0) {
        this.removeRenderObject(farKey);
        this.removeRenderObject(nearKey);
        return;
      }

      const baseDepth = Number.isFinite(suppliedDepth) ? suppliedDepth : this.getMountedGearHostDepth(hostKind, placement);
      const farGraphics = this.getOrCreateMountedGearGraphics(hostKind, hostKey, 'far');
      const nearGraphics = this.getOrCreateMountedGearGraphics(hostKind, hostKey, 'near');
      farGraphics.clear();
      nearGraphics.clear();
      farGraphics.setPosition(0, 0).setAngle(0).setScale(1, 1);
      nearGraphics.setPosition(0, 0).setAngle(0).setScale(1, 1);
      farGraphics.depth = baseDepth - 0.45;
      nearGraphics.depth = baseDepth + 0.45;

      const visibleSurface = this.getVisibleGearSurfaceSide(placement);
      let hasFarMount = false;
      mounts.forEach((mount) => {
        const point = this.getGearMountPoint(placement, mount);
        if (!point) return;
        const selected = this.selectedGears.some((gear) => gear.hostKey === hostKey && gear.mountId === mount.id);
        const layer = this.isGearOnCameraSide(placement, mount) ? nearGraphics : farGraphics;
        if (layer === farGraphics) hasFarMount = true;
        this.drawMountedGearPreview(layer, point, {
          placement,
          mount,
          selected,
          valid: true,
          axisType: mount.axisType,
          angle: mount.phase || 0,
          alpha: 0.94
        });
      });

      if (hasFarMount) {
        this.drawGearHostSurfaceOccluder(farGraphics, placement, visibleSurface);
      }
    }

    redrawAllMountedGearLayers() {
      Object.entries(this.mapData.tiles || {}).forEach(([hostKey, tile]) => {
        if (!this.isPlacementVisible(tile)) {
          this.removeRenderObject(this.getMountedGearLayerKey('tile', hostKey, 'far'));
          this.removeRenderObject(this.getMountedGearLayerKey('tile', hostKey, 'near'));
          return;
        }
        this.redrawMountedGearHostLayers('tile', hostKey, tile);
      });
      Object.entries(this.mapData.walls || {}).forEach(([hostKey, wall]) => {
        if (!this.isPlacementVisible(wall)) {
          this.removeRenderObject(this.getMountedGearLayerKey('wall', hostKey, 'far'));
          this.removeRenderObject(this.getMountedGearLayerKey('wall', hostKey, 'near'));
          return;
        }
        this.redrawMountedGearHostLayers('wall', hostKey, wall);
      });
    }

    getVerticalStructureOverlayKey(hostKind, hostKey) {
      return `edge-overlay:${hostKind}:${hostKey}`;
    }

    getOrCreateVerticalStructureOverlay(hostKind, hostKey) {
      const key = this.getVerticalStructureOverlayKey(hostKind, hostKey);
      let graphics = this.renderObjects.get(key);
      if (!graphics) {
        graphics = this.add.graphics();
        graphics.setData('placementId', key);
        graphics.setData('kind', 'edge-overlay');
        this.mapLayer.add(graphics);
        this.renderObjects.set(key, graphics);
      }
      return graphics;
    }

    getVerticalStructureGeometry(placement) {
      if (!placement) return null;
      if (placement.edge) return createEdgeWallGeometry(this.cameraState.yaw, placement.edge, this.getWallMiterProfile(placement));
      if (placement.isVertical) return createTileGeometry(this.cameraState.yaw, placement.rotation || 0);
      return null;
    }

    drawStructureLine(graphics, start, end, offsetX = 0, offsetY = 0, color = 0x1f2937, alpha = 0.74, width = 1.4) {
      if (!graphics || !start || !end) return;
      graphics.lineStyle(width + 1.2, 0xf8fafc, alpha * 0.28);
      graphics.lineBetween(start.x + offsetX, start.y + offsetY, end.x + offsetX, end.y + offsetY);
      graphics.lineStyle(width, color, alpha);
      graphics.lineBetween(start.x + offsetX, start.y + offsetY, end.x + offsetX, end.y + offsetY);
    }

    drawStructurePolyline(graphics, points = [], offsetX = 0, offsetY = 0, closed = false, color = 0x1f2937, alpha = 0.74, width = 1.4) {
      if (!Array.isArray(points) || points.length < 2) return;
      for (let index = 0; index < points.length - 1; index += 1) {
        this.drawStructureLine(graphics, points[index], points[index + 1], offsetX, offsetY, color, alpha, width);
      }
      if (closed && points.length > 2) {
        this.drawStructureLine(graphics, points[points.length - 1], points[0], offsetX, offsetY, color, alpha, width);
      }
    }

    redrawVerticalStructureOverlay(hostKind, hostKey, placement, suppliedDepth = null) {
      const key = this.getVerticalStructureOverlayKey(hostKind, hostKey);
      const geometry = this.getVerticalStructureGeometry(placement);
      if (!geometry || !hostKey || (!placement.edge && !placement.isVertical)) {
        this.removeRenderObject(key);
        return;
      }
      const projection = projectCell(placement, this.cameraState.yaw, this.mapData);
      const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
      const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
      const baseDepth = Number.isFinite(suppliedDepth) ? suppliedDepth : this.getMountedGearHostDepth(hostKind, placement);
      const graphics = this.getOrCreateVerticalStructureOverlay(hostKind, hostKey);
      graphics.clear();
      graphics.setPosition(0, 0).setAngle(0).setScale(1, 1);
      graphics.depth = baseDepth + 0.28;

      this.drawStructurePolyline(graphics, geometry.wallCap, offsetX, offsetY, true, 0x0f172a, 0.68, 1.25);
      if (geometry.wallFront?.length >= 4) {
        this.drawStructureLine(graphics, geometry.wallFront[3], geometry.wallFront[2], offsetX, offsetY, 0x111827, 0.56, 1.1);
      }
      if (geometry.wallBack?.length >= 4) {
        this.drawStructureLine(graphics, geometry.wallBack[2], geometry.wallBack[3], offsetX, offsetY, 0x111827, 0.42, 1);
      }
      [
        geometry.miter?.start ? null : geometry.wallSideStart,
        geometry.miter?.end ? null : geometry.wallSideEnd
      ].forEach((side) => {
        if (!Array.isArray(side) || side.length < 4) return;
        this.drawStructureLine(graphics, side[1], side[2], offsetX, offsetY, 0x111827, 0.58, 1.1);
      });
    }

    redrawAllVerticalStructureOverlays() {
      Object.entries(this.mapData.tiles || {}).forEach(([hostKey, tile]) => {
        if (!this.isPlacementVisible(tile) || !tile?.isVertical) {
          this.removeRenderObject(this.getVerticalStructureOverlayKey('tile', hostKey));
          return;
        }
        this.redrawVerticalStructureOverlay('tile', hostKey, tile);
      });
      Object.entries(this.mapData.walls || {}).forEach(([hostKey, wall]) => {
        if (!this.isPlacementVisible(wall)) {
          this.removeRenderObject(this.getVerticalStructureOverlayKey('wall', hostKey));
          return;
        }
        this.redrawVerticalStructureOverlay('wall', hostKey, wall);
      });
    }

    getGearSurfaceContext(placement, surfaceSide = 'front') {
      if (!placement) return null;
      const projection = projectCell(placement, this.cameraState.yaw, this.mapData);
      const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
      const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
      if (placement.edge) {
        const geometry = createEdgeWallGeometry(this.cameraState.yaw, placement.edge, this.getWallMiterProfile(placement));
        const wall = surfaceSide === 'back' ? (geometry.wallBack || geometry.wall) : (geometry.wallFront || geometry.wall);
        const normal = this.getGearSurfaceNormal(placement, surfaceSide);
        const projectedNormal = projectWorldOffset(normal.x * 0.14, normal.y * 0.14, this.cameraState.yaw);
        return {
          polygon: wall,
          rotation: placement.rotation || 0,
          offsetX,
          offsetY,
          surface: 'wall',
          extrusion: {
            x: projectedNormal.x,
            y: projectedNormal.y
          }
        };
      }
      const geometry = createTileGeometry(this.cameraState.yaw, placement.rotation || 0);
      const verticalNormal = this.getGearSurfaceNormal(placement, surfaceSide);
      const verticalExtrusion = projectWorldOffset(verticalNormal.x * 0.14, verticalNormal.y * 0.14, this.cameraState.yaw);
      const wallSurface = surfaceSide === 'back' ? (geometry.wallBack || geometry.wall) : (geometry.wallFront || geometry.wall);
      return {
        polygon: placement.isVertical ? wallSurface : geometry.top,
        rotation: placement.rotation || 0,
        offsetX,
        offsetY,
        surface: placement.isVertical ? 'wall' : 'floor',
        extrusion: placement.isVertical ? verticalExtrusion : { x: 0, y: -9 }
      };
    }

    mapGearLocalPointToSurface(placement, localPosition = {}, options = {}) {
      const context = this.getGearSurfaceContext(placement, options.surface || 'front');
      if (!context) return null;
      if (!options.allowOverflow) {
        return this.getGhostBoardPoint(
          context.polygon,
          localPosition,
          context.rotation,
          context.offsetX,
          context.offsetY,
          context.surface
        );
      }
      const rotated = rotateLocalPoint({
        x: localPosition.x || 0,
        y: localPosition.y || 0
      }, context.rotation);
      if (context.surface === 'wall') {
        const [bottomLeft, bottomRight, topRight, topLeft] = context.polygon;
        const uAxis = {
          x: (topRight.x - topLeft.x + bottomRight.x - bottomLeft.x) * 0.5,
          y: (topRight.y - topLeft.y + bottomRight.y - bottomLeft.y) * 0.5
        };
        const vAxis = {
          x: (bottomLeft.x - topLeft.x + bottomRight.x - topRight.x) * 0.5,
          y: (bottomLeft.y - topLeft.y + bottomRight.y - topRight.y) * 0.5
        };
        return {
          x: context.offsetX + topLeft.x + ((rotated.x + 0.5) * uAxis.x) + ((rotated.y + 0.5) * vAxis.x),
          y: context.offsetY + topLeft.y + ((rotated.x + 0.5) * uAxis.y) + ((rotated.y + 0.5) * vAxis.y)
        };
      }
      const [nw, ne, se, sw] = context.polygon;
      const uAxis = {
        x: (ne.x - nw.x + se.x - sw.x) * 0.5,
        y: (ne.y - nw.y + se.y - sw.y) * 0.5
      };
      const vAxis = {
        x: (sw.x - nw.x + se.x - ne.x) * 0.5,
        y: (sw.y - nw.y + se.y - ne.y) * 0.5
      };
      return {
        x: context.offsetX + nw.x + ((rotated.x + 0.5) * uAxis.x) + ((rotated.y + 0.5) * vAxis.x),
        y: context.offsetY + nw.y + ((rotated.x + 0.5) * uAxis.y) + ((rotated.y + 0.5) * vAxis.y)
      };
    }

    getGearMountPoint(placement, mount) {
      if (!placement || !mount) return null;
      return this.mapGearLocalPointToSurface(placement, getGearMountLocalPosition(mount.position), {
        surface: mount.surface || 'front'
      });
    }

    getGearHit(localPoint) {
      if (!localPoint) return null;
      const radius = Math.max(16, 24 / Math.max(0.45, this.cameraState.zoom || 1));
      const radiusSquared = radius * radius;
      let best = null;
      Object.entries(this.mapData.tiles || {}).forEach(([hostKey, tile]) => {
        if (!this.isPlacementVisible(tile)) return;
        (tile.gearMounts || []).forEach((mount) => {
          if (!this.isGearOnCameraSide(tile, mount)) return;
          const point = this.getGearMountPoint(tile, mount);
          if (!point) return;
          const distanceSquared = ((localPoint.x - point.x) ** 2) + ((localPoint.y - point.y) ** 2);
          if (distanceSquared > radiusSquared) return;
          if (!best || distanceSquared < best.distanceSquared) {
            best = {
              type: 'gear',
              hostKind: 'tile',
              hostKey,
              cell: { x: tile.x, y: tile.y, z: tile.z },
              panelType: tile.panelType,
              mount,
              point,
              distanceSquared,
              snapPriority: 2,
              depth: getPlacementDepth({
                cell: tile,
                partType: 'floor_attachment',
                physicalLayer: 'floor_attachment',
                cameraYaw: this.cameraState.yaw,
                mapData: this.mapData
              }) + 8
            };
          }
        });
      });
      Object.entries(this.mapData.walls || {}).forEach(([hostKey, wall]) => {
        if (!this.isPlacementVisible(wall)) return;
        (wall.gearMounts || []).forEach((mount) => {
          if (!this.isGearOnCameraSide(wall, mount)) return;
          const point = this.getGearMountPoint(wall, mount);
          if (!point) return;
          const distanceSquared = ((localPoint.x - point.x) ** 2) + ((localPoint.y - point.y) ** 2);
          if (distanceSquared > radiusSquared) return;
          if (!best || distanceSquared < best.distanceSquared) {
            best = {
              type: 'gear',
              hostKind: 'wall',
              hostKey,
              cell: { x: wall.x, y: wall.y, z: wall.z },
              edge: wall.edge,
              panelType: wall.panelType,
              mount,
              point,
              distanceSquared,
              snapPriority: 2,
              depth: getPlacementDepth({
                cell: wall,
                partType: 'wall_attachment',
                physicalLayer: 'wall_attachment',
                edge: wall.edge,
                cameraYaw: this.cameraState.yaw,
                mapData: this.mapData
              }) + 8
            };
          }
        });
      });
      return best;
    }

    getMechanicalPortPoint(tile, port) {
      if (!tile || !port) return null;
      const cell = { x: tile.x, y: tile.y, z: tile.z };
      const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
      const local = port.localPosition3d || { x: 0, y: 0, z: 0 };
      const rotated = rotateLocalPoint({ x: local.x || 0, y: local.y || 0 }, tile.rotation || 0);
      const offset = projectWorldOffset(rotated.x, rotated.y, this.cameraState.yaw);
      return {
        x: projection.x + offset.x,
        y: projection.y + offset.y - ((Number(local.z) || 0) * 52)
      };
    }

    getMechanicalEndpointPoint(endpoint) {
      const tile = this.mapData.tiles?.[endpoint?.componentKey];
      if (!this.isPlacementVisible(tile)) return null;
      if (!tile) return null;
      const port = (tile.mechanicalPorts || []).find((item) => item.id === endpoint.portId);
      return this.getMechanicalPortPoint(tile, port);
    }

    getMechanicalPortHit(localPoint) {
      if (!localPoint) return null;
      const radius = Math.max(8, 13 / Math.max(0.45, this.cameraState.zoom || 1));
      const radiusSquared = radius * radius;
      let best = null;
      Object.entries(this.mapData.tiles || {}).forEach(([componentKey, tile]) => {
        if (!this.isPlacementVisible(tile)) return;
        (tile.mechanicalPorts || []).forEach((port) => {
          const point = this.getMechanicalPortPoint(tile, port);
          if (!point) return;
          const distanceSquared = ((localPoint.x - point.x) ** 2) + ((localPoint.y - point.y) ** 2);
          if (distanceSquared > radiusSquared) return;
          if (!best || distanceSquared < best.distanceSquared) {
            best = {
              type: 'mechanical_port',
              cell: { x: tile.x, y: tile.y, z: tile.z },
              componentKey,
              portId: port.id,
              port,
              panelType: tile.panelType,
              tile,
              point,
              distanceSquared,
              depth: 999999
            };
          }
        });
      });
      return best;
    }

    areMechanicalPortsCompatible(fromHit, toHit) {
      if (!fromHit || !toHit) return { ok: false, reason: 'missing' };
      if (fromHit.componentKey === toHit.componentKey && fromHit.portId === toHit.portId) {
        return { ok: false, reason: 'same_port' };
      }
      const fromMedia = new Set(fromHit.port?.mediums || []);
      const medium = (toHit.port?.mediums || []).find((item) => fromMedia.has(item));
      if (!medium) return { ok: false, reason: 'medium' };
      const fromDirection = fromHit.port?.direction || 'bidirectional';
      const toDirection = toHit.port?.direction || 'bidirectional';
      if (fromDirection === toDirection && fromDirection !== 'bidirectional') {
        return { ok: false, reason: 'direction' };
      }
      return { ok: true, medium };
    }

    handleMechanicalPortHit(hit) {
      if (!hit?.port) return false;
      if (!this.pendingMechanicalPort) {
        this.pendingMechanicalPort = hit;
        this.config.onHoverStatusChange?.(`${hit.port.label}，选择另一个连接口`);
        this.drawMechanicalLayers();
        return true;
      }
      const from = this.pendingMechanicalPort;
      this.pendingMechanicalPort = null;
      const compatibility = this.areMechanicalPortsCompatible(from, hit);
      if (!compatibility.ok) {
        this.config.onToast?.('连接口不兼容，无法连接。', 'error');
        this.drawMechanicalLayers();
        return true;
      }
      this.config.onCommitOperations?.([{
        kind: 'mechanicalLink',
        action: 'place',
        medium: compatibility.medium,
        from: { componentKey: from.componentKey, portId: from.portId },
        to: { componentKey: hit.componentKey, portId: hit.portId },
        tensionMode: compatibility.medium === 'rope' ? 'tension_only' : 'push_pull'
      }], { label: '连接机械端口' });
      this.config.onToast?.('机械连接已建立。', 'success');
      this.drawMechanicalLayers();
      return true;
    }

    drawMechanicalLayers() {
      this.mechanicalLinkLayer.clear();
      this.mechanicalPortLayer.clear();
      this.redrawAllMountedGearLayers();
      this.sortMapLayer();
      const assemblyGraph = this.getMechanicalAssemblyGraph();
      const components = Object.fromEntries(
        Object.entries({ ...(this.mapData.tiles || {}), ...(this.mapData.walls || {}) })
          .filter(([, placement]) => this.isPlacementVisible(placement))
      );
      const portsByComponentKey = new Map();
      Object.entries(components).forEach(([componentKey, tile]) => {
        portsByComponentKey.set(componentKey, getWorldTransmissionPorts(tile, componentKey));
      });
      const assemblyById = new Map((assemblyGraph.assemblies || []).map((assembly) => [assembly.id, assembly]));
      const connectedPortKeys = new Set();
      const focusedComponentKeys = new Set();
      this.selectedCells.forEach((cell) => focusedComponentKeys.add(createCellKey(cell.x, cell.y, cell.z)));
      this.selectedWalls.forEach((wall) => focusedComponentKeys.add(createWallKey(wall.x, wall.y, wall.z, wall.edge)));
      this.selectedGears.forEach((gear) => {
        if (gear.hostKey) focusedComponentKeys.add(gear.hostKey);
      });
      const hoverHit = this.hoverTarget?.hit;
      if (hoverHit?.type === 'tile') {
        focusedComponentKeys.add(createCellKey(hoverHit.cell.x, hoverHit.cell.y, hoverHit.cell.z));
      } else if (hoverHit?.type === 'wall') {
        focusedComponentKeys.add(createWallKey(hoverHit.cell.x, hoverHit.cell.y, hoverHit.cell.z, hoverHit.edge));
      } else if (hoverHit?.type === 'gear' && hoverHit.hostKey) {
        focusedComponentKeys.add(hoverHit.hostKey);
      } else if (hoverHit?.type === 'mechanical_port' && hoverHit.componentKey) {
        focusedComponentKeys.add(hoverHit.componentKey);
      }
      const focusedAssemblyIds = new Set();
      focusedComponentKeys.forEach((componentKey) => {
        const assemblyId = assemblyGraph.assemblyByComponentKey?.[componentKey];
        if (assemblyId) focusedAssemblyIds.add(assemblyId);
      });
      const revealConnectionSockets = this.pendingMechanicalPort || focusedAssemblyIds.size > 0;
      (assemblyGraph.assemblies || []).forEach((assembly) => {
        assembly.edges.forEach((edge) => {
          if (edge.from?.componentKey && edge.from?.portId) connectedPortKeys.add(`${edge.from.componentKey}:${edge.from.portId}`);
          if (edge.to?.componentKey && edge.to?.portId) connectedPortKeys.add(`${edge.to.componentKey}:${edge.to.portId}`);
        });
      });
      Object.entries(components).forEach(([componentKey, tile]) => {
        (portsByComponentKey.get(componentKey) || []).forEach((port) => {
          const assemblyId = assemblyGraph.assemblyByComponentKey?.[componentKey];
          const connected = !!assemblyById.get(assemblyId) && connectedPortKeys.has(`${componentKey}:${port.id}`);
          const shouldReveal = revealConnectionSockets && focusedAssemblyIds.has(assemblyId);
          if (!connected) return;
          if (!shouldReveal) return;
          this.drawTransmissionPortSocket(this.mechanicalPortLayer, tile, port, true);
        });
      });
      const mediumColor = {
        rigid_rod: 0xe2e8f0,
        rope: 0xfacc15,
        belt: 0x38bdf8,
        gear_mesh: 0xfb923c
      };
      (this.mapData.mechanicalLinks || []).forEach((link) => {
        const fromTile = this.mapData.tiles?.[link.from?.componentKey];
        const toTile = this.mapData.tiles?.[link.to?.componentKey];
        if (!this.isPlacementVisible(fromTile) || !this.isPlacementVisible(toTile)) return;
        const from = this.getMechanicalEndpointPoint(link.from);
        const to = this.getMechanicalEndpointPoint(link.to);
        if (!from || !to) return;
        const color = mediumColor[link.medium] || 0xcbd5e1;
        this.mechanicalLinkLayer.lineStyle(link.medium === 'rope' ? 2 : 4, color, link.medium === 'rope' ? 0.74 : 0.82);
        if (link.medium === 'rope') {
          const sag = Math.min(26, Math.max(8, Math.hypot(to.x - from.x, to.y - from.y) * 0.08));
          this.mechanicalLinkLayer.beginPath();
          this.mechanicalLinkLayer.moveTo(from.x, from.y);
          this.mechanicalLinkLayer.lineTo((from.x + to.x) / 2, ((from.y + to.y) / 2) + sag);
          this.mechanicalLinkLayer.lineTo(to.x, to.y);
          this.mechanicalLinkLayer.strokePath();
        } else {
          this.mechanicalLinkLayer.lineBetween(from.x, from.y, to.x, to.y);
        }
      });

      Object.entries(this.mapData.tiles || {}).forEach(([componentKey, tile]) => {
        if (!this.isPlacementVisible(tile)) return;
        (tile.mechanicalPorts || []).forEach((port) => {
          const point = this.getMechanicalPortPoint(tile, port);
          if (!point) return;
          const isPending = this.pendingMechanicalPort?.componentKey === componentKey && this.pendingMechanicalPort?.portId === port.id;
          const isOutput = port.direction === 'out';
          const color = port.kind === 'signal' ? 0xfacc15 : port.kind?.includes('rotary') ? 0xfb923c : 0x67e8f9;
          this.mechanicalPortLayer.fillStyle(0x020617, 0.94);
          this.mechanicalPortLayer.fillCircle(point.x, point.y, isPending ? 7 : 5);
          this.mechanicalPortLayer.lineStyle(isPending ? 3 : 2, isPending ? 0xffffff : color, isPending ? 0.96 : 0.86);
          this.mechanicalPortLayer.strokeCircle(point.x, point.y, isPending ? 8 : 6);
          if (isOutput) {
            this.mechanicalPortLayer.fillStyle(color, 0.82);
            this.mechanicalPortLayer.fillTriangle(point.x + 7, point.y, point.x + 2, point.y - 3, point.x + 2, point.y + 3);
          }
        });
      });
    }

    drawRouteLayer() {
      this.routeLayer.clear();
      (this.mapData.safeRoute || []).forEach((cell) => {
        if (!this.isLayerVisible(cell)) return;
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
      const previewSelection = this.carryState?.kind === 'placement'
        ? this.carryState.previewSelection
        : null;
      const selectedCells = previewSelection?.cells || this.selectedCells;
      const selectedWalls = previewSelection?.walls || this.selectedWalls;
      const zoom = this.cameraState.zoom || 1;
      const toScreenPointer = (point) => ({
        x: this.worldLayer.x + (point.x * zoom),
        y: this.worldLayer.y + (point.y * zoom)
      });
      const matchesSelectionHit = (hit, ref) => {
        if (!hit || !ref) return false;
        if (ref.edge) {
          return hit.type === 'wall' && createWallSelectionKey({
            x: hit.cell.x,
            y: hit.cell.y,
            z: hit.cell.z,
            edge: hit.edge
          }) === createWallSelectionKey(ref);
        }
        return hit.type === 'tile' && sameCell(hit.cell, ref);
      };
      const isSegmentVisible = (start, end, centroid, ref) => {
        const mid = {
          x: (start.x + end.x) * 0.5,
          y: (start.y + end.y) * 0.5
        };
        const towardCenter = {
          x: centroid.x - mid.x,
          y: centroid.y - mid.y
        };
        const length = Math.max(1, Math.hypot(towardCenter.x, towardCenter.y));
        const sample = {
          x: mid.x + ((towardCenter.x / length) * 3),
          y: mid.y + ((towardCenter.y / length) * 3)
        };
        const hitInfo = this.hitTest(toScreenPointer(sample), { allowOutline: false });
        return matchesSelectionHit(this.normalizeInspectableHit(hitInfo.hit), ref);
      };
      const strokePolygon = (points = [], color = 0xfacc15, alpha = 0.92, ref = null) => {
        if (!Array.isArray(points) || points.length < 3) return;
        const centroid = points.reduce((acc, point) => ({
          x: acc.x + point.x,
          y: acc.y + point.y
        }), { x: 0, y: 0 });
        centroid.x /= points.length;
        centroid.y /= points.length;
        this.selectionLayer.lineStyle(3, color, alpha);
        points.forEach((point, index) => {
          const next = points[(index + 1) % points.length];
          if (ref && !isSegmentVisible(point, next, centroid, ref)) return;
          this.selectionLayer.lineBetween(point.x, point.y, next.x, next.y);
        });
      };
      const getTileSelectionPolygons = (cell) => {
        const key = createCellKey(cell.x, cell.y, cell.z);
        const tile = this.carryState?.kind === 'placement'
          ? (this.carryState.previewTiles?.get?.(key) || this.mapData.tiles?.[key])
          : this.mapData.tiles?.[key];
        const projection = projectCell(cell, this.cameraState.yaw, this.mapData);
        const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
        const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
        const geometry = createTileGeometry(this.cameraState.yaw, tile?.rotation || 0);
        const polygons = tile?.isVertical
          ? [geometry.wall, geometry.wallSideStart, geometry.wallSideEnd, geometry.wallCap]
          : [geometry.top];
        return polygons.map((polygon) => polygon.map((point) => ({
          x: point.x + offsetX,
          y: point.y + offsetY
        })));
      };
      const drawCell = (cell, color = 0x67e8f9) => {
        getTileSelectionPolygons(cell).forEach((points) => strokePolygon(points, color, 0.88, null));
      };
      const drawWall = (wall, color = 0xfacc15) => {
        const key = createWallSelectionKey(wall);
        const previewWall = this.carryState?.kind === 'placement'
          ? this.carryState.previewWalls?.get?.(key)
          : null;
        const wallPlacement = previewWall || wall;
        const projection = projectCell(wall, this.cameraState.yaw, this.mapData);
        const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
        const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
        const geometry = createEdgeWallGeometry(this.cameraState.yaw, wallPlacement.edge);
        [
          geometry.wall,
          geometry.wallSideStart,
          geometry.wallSideEnd,
          geometry.wallCap
        ].forEach((points) => {
          strokePolygon(points.map((point) => ({
            x: point.x + offsetX,
            y: point.y + offsetY
          })), color, 0.92, null);
        });
      };
      selectedCells.forEach((cell) => drawCell(cell));
      selectedWalls.forEach((wall) => drawWall(wall, 0xfacc15));
      if (this.hoverCell && !this.hoverTarget?.hit) {
        getTileSelectionPolygons(this.hoverCell).forEach((points) => strokePolygon(points, 0x22d3ee, 0.88));
      }
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
      const groups = [geometry.top];
      if (isPortalMaterial(tile.panelType)) {
        groups.push(...getPortalPolygons(this.cameraState.yaw, tile.rotation || 0));
      }
      if (tile.isVertical) {
        groups.push(...geometry.sides, geometry.wall, geometry.wallCap, geometry.wallSideStart, geometry.wallSideEnd);
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

    matchesSelectionPlacementHit(hit, ref) {
      if (!hit || !ref) return false;
      if (ref.edge) {
        return hit.type === 'wall' && createWallSelectionKey({
          x: hit.cell.x,
          y: hit.cell.y,
          z: hit.cell.z,
          edge: hit.edge
        }) === createWallSelectionKey(ref);
      }
      return hit.type === 'tile' && sameCell(hit.cell, ref);
    }

    isSelectionPolygonVisible(points = [], ref = null) {
      if (!Array.isArray(points) || points.length < 3 || !ref) return false;
      const centroid = points.reduce((acc, point) => ({
        x: acc.x + point.x,
        y: acc.y + point.y
      }), { x: 0, y: 0 });
      centroid.x /= points.length;
      centroid.y /= points.length;
      const zoom = this.cameraState.zoom || 1;
      const hitInfo = this.hitTest({
        x: this.worldLayer.x + (centroid.x * zoom),
        y: this.worldLayer.y + (centroid.y * zoom)
      }, { allowOutline: false });
      return this.matchesSelectionPlacementHit(this.normalizeInspectableHit(hitInfo.hit), ref);
    }

    isPolygonFullyInsideRect(points = [], rect) {
      if (!Array.isArray(points) || points.length < 3 || !rect) return false;
      return points.every((point) => rectContainsPoint(rect, point));
    }

    isPlacementFullyInsideRect(placement, rect) {
      if (!placement || !rect) return false;
      if (!this.isPlacementVisible(placement)) return false;
      const polygons = placement.edge
        ? this.getWallLocalPolygons(placement)
        : this.getTileLocalPolygons(placement);
      if (polygons.length <= 0) return false;
      return polygons.every((points) => this.isPolygonFullyInsideRect(points, rect));
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
      const gears = dragState.shiftKey ? [...this.selectedGears] : [];
      const boardSelectionAllowed = canSelectBoardPlacement(this.selectionScope, true);
      const componentSelectionAllowed = canSelectComponentPlacement(this.selectionScope, true);
      const seenCells = new Set(cells.map((cell) => createCellKey(cell.x, cell.y, cell.z)));
      const seenWalls = new Set(walls.map(createWallSelectionKey));
      const seenGears = new Set(gears.map((gear) => `${gear.hostKey}:${gear.mountId}`));
      if (boardSelectionAllowed) {
        Object.values(this.mapData.tiles || {}).forEach((tile) => {
          if (!tile || !this.isPlacementFullyInsideRect(tile, rect)) return;
          const key = createCellKey(tile.x, tile.y, tile.z);
          if (seenCells.has(key)) return;
          seenCells.add(key);
          cells.push({ x: tile.x, y: tile.y, z: tile.z });
        });
        Object.values(this.mapData.walls || {}).forEach((wall) => {
          if (!wall || !this.isPlacementFullyInsideRect(wall, rect)) return;
          const key = createWallSelectionKey(wall);
          if (seenWalls.has(key)) return;
          seenWalls.add(key);
          walls.push({ x: wall.x, y: wall.y, z: wall.z, edge: wall.edge });
        });
      }
      if (componentSelectionAllowed) {
        const appendVisibleGear = (hostKind, hostKey, placement) => {
          if (!placement || !Array.isArray(placement.gearMounts)) return;
          if (!this.isPlacementVisible(placement)) return;
          placement.gearMounts.forEach((mount) => {
            if (!mount?.id || !this.isGearSurfaceVisible(placement, mount) || !this.isGearOnCameraSide(placement, mount)) return;
            const point = this.getGearMountPoint(placement, mount);
            if (!rectContainsPoint(rect, point)) return;
            const key = `${hostKey}:${mount.id}`;
            if (seenGears.has(key)) return;
            seenGears.add(key);
            gears.push({
              hostKind,
              hostKey,
              mountId: mount.id,
              cell: { x: placement.x, y: placement.y, z: placement.z },
              edge: placement.edge || null
            });
          });
        };
        Object.values(this.mapData.tiles || {}).forEach((tile) => {
          appendVisibleGear('tile', createCellKey(tile.x, tile.y, tile.z), tile);
        });
        Object.values(this.mapData.walls || {}).forEach((wall) => {
          appendVisibleGear('wall', createWallKey(wall.x, wall.y, wall.z, wall.edge), wall);
        });
      }
      if (gears.length > 0 && cells.length === 0 && walls.length === 0) {
        this.setSelection([], [], gears, 'component');
      } else {
        this.setSelection(cells, walls, [], cells.length || walls.length ? 'board' : null);
      }
    }

    getGhostLayerStateKey() {
      const hover = this.hoverCell
        ? `${this.hoverCell.z}:${this.hoverCell.x}:${this.hoverCell.y}:${this.hoverEdge || ''}`
        : 'none';
      const hoverTarget = this.hoverTarget?.key || 'none';
      const carry = this.carryState
        ? `${this.carryState.kind || ''}:${this.carryState.mode || 'move'}:${this.carryState.origins?.length || 0}:${this.carryState.defaultPose || ''}:${this.carryState.surfaceRotation ?? ''}:${this.carryState.groupRotationSteps || 0}:${this.carryState.groupPoseSteps || 0}:${this.carryState.snapAxisKey || ''}:${this.carryState.snapPlaneCycle || 0}:${this.carryState.axisTarget ? `${createCellKey(this.carryState.axisTarget.x, this.carryState.axisTarget.y, this.carryState.axisTarget.z)}:${this.carryState.axisTarget.edge || ''}:${this.carryState.axisTarget.rotation ?? ''}:${this.carryState.axisTarget.layFlat ? 'flat' : ''}` : ''}:${this.hoverCell ? createCellKey(this.hoverCell.x, this.hoverCell.y, this.hoverCell.z) : ''}`
        : 'none';
      return [
        this.mapRevision,
        this.activeTool,
        this.activeTileType || '',
        this.activeComponentType || '',
        this.panelPose || '',
        this.activeRotation || 0,
        Math.round((this.cameraState.yaw || 0) * 10) / 10,
        this.snapPlaneCycle || 0,
        this.activeSnapAxisKey || '',
        hover,
        hoverTarget,
        carry
      ].join('|');
    }

    drawGhostLayer(force = false) {
      const ghostKey = this.getGhostLayerStateKey();
      if (!force && this.lastGhostLayerKey === ghostKey) return;
      this.lastGhostLayerKey = ghostKey;
      this.ghostLayer.clear();
      if (this.carryState && this.hoverCell) {
        if (this.carryState.kind === 'gear') {
          const target = this.getGearInstallTarget({
            cell: this.hoverCell,
            hit: this.hoverTarget?.hit,
            edge: this.hoverEdge,
            localPoint: this.hoverTarget?.localPoint
          });
          this.drawGearComponentGhost(target);
          return;
        }
        const target = this.getCarryPlacementTarget({
          cell: this.hoverCell,
          hit: this.hoverTarget?.hit,
          edge: this.hoverEdge,
          localPoint: this.hoverTarget?.localPoint
        });
        if (target?.blocked) return;
        const {
          moves,
          invalidPlacementKeys,
          previewTiles,
          previewWalls
        } = this.computeMovePreview(target);
        this.carryState.previewSelection = {
          cells: moves
            .filter((move) => !move?.to?.edge)
            .map((move) => ({ x: move.to.x, y: move.to.y, z: move.to.z })),
          walls: moves
            .filter((move) => !!move?.to?.edge)
            .map((move) => ({ x: move.to.x, y: move.to.y, z: move.to.z, edge: move.to.edge }))
        };
        this.carryState.previewTiles = previewTiles || null;
        this.carryState.previewWalls = previewWalls || null;
        this.drawSelectionLayer();
        moves.forEach(({ from, to }) => {
          const placementKey = to.edge
            ? createWallSelectionKey(to)
            : createCellKey(to.x, to.y, to.z);
          const unsupportedWall = !!to.edge
            && !this.hasWallSupportInPreviewMaps(to, to.edge, previewTiles, previewWalls);
          const color = (
            invalidPlacementKeys?.has(placementKey)
            || unsupportedWall
          ) ? 0xef4444 : 0x22c55e;
          const sourcePlacement = from.edge
            ? this.mapData.walls?.[createWallSelectionKey(from)]
            : this.mapData.tiles?.[createCellKey(from.x, from.y, from.z)];
          this.drawPlacementGhost({
            ...to,
            source: from,
            panelType: sourcePlacement?.panelType,
            rotation: to.edge ? wallEdgeToRotation(to.edge) : (to.rotation ?? sourcePlacement?.rotation ?? 0),
            transmissionRotation: to.edge
              ? (to.transmissionRotation ?? to.rotation ?? sourcePlacement?.transmissionRotation ?? sourcePlacement?.rotation ?? 0)
              : (to.transmissionRotation ?? to.rotation ?? sourcePlacement?.transmissionRotation ?? sourcePlacement?.rotation ?? 0)
          }, color, 0.22, true);
        });
        return;
      }
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && this.activeComponentType === GEAR_COMPONENT_TYPE) {
        const target = this.getGearInstallTarget({
          cell: this.hoverCell,
          hit: this.hoverTarget?.hit,
          edge: this.hoverEdge,
          localPoint: this.hoverTarget?.localPoint
        });
        this.hoverGearInstallTarget = target;
        this.drawGearComponentGhost(target);
        return;
      }
      if (this.activeTool !== CITY_CHANNEL_TOOLS.PLACE_TILE || !this.activeTileType || !this.hoverCell) return;
      const placementTarget = this.resolveDynamicPlacementTarget({
        cell: this.hoverCell,
        hit: this.hoverTarget?.hit,
        edge: this.hoverEdge,
        localPoint: this.hoverTarget?.localPoint
      }, { forGhost: true, allowReplacement: false });
      if (!placementTarget?.cell) {
        if (this.hoverTarget?.hit) return;
        if (this.isWallPlacementActive()) {
          const fallbackEdge = this.hoverEdge || 'north';
          const hasSupport = this.hasWallSupport(this.hoverCell, fallbackEdge);
          this.drawPlacementGhost({
            ...this.hoverCell,
            edge: fallbackEdge,
            panelType: this.activeTileType,
            rotation: wallEdgeToRotation(fallbackEdge),
            transmissionRotation: this.activeRotation
          }, hasSupport ? 0x67e8f9 : 0xef4444, 0.2, false);
          return;
        }
        const hasSupport = this.hasTileSupport(this.hoverCell);
        this.drawPlacementGhost({
          ...this.hoverCell,
          panelType: this.activeTileType,
          rotation: this.activeRotation
        }, hasSupport ? 0x67e8f9 : 0xef4444, 0.18, false);
        return;
      }
      if (placementTarget.kind === 'wall') {
        const hasSupport = placementTarget.valid !== undefined
          ? placementTarget.valid
          : this.hasWallSupport(placementTarget.cell, placementTarget.edge);
        this.drawPlacementGhost({
          ...placementTarget.cell,
          edge: placementTarget.edge || 'north',
          panelType: this.activeTileType,
          rotation: wallEdgeToRotation(placementTarget.edge || 'north'),
          transmissionRotation: this.activeRotation,
          snapConnection: hasSupport ? (placementTarget.connection || null) : null
        }, hasSupport ? 0x67e8f9 : 0xef4444, 0.2, false);
        return;
      }
      this.drawPlacementGhost({
        ...placementTarget.cell,
        panelType: this.activeTileType,
        rotation: this.activeRotation,
        snapConnection: placementTarget.valid === false ? null : (placementTarget.connection || null)
      }, placementTarget.valid === false ? 0xef4444 : 0x67e8f9, 0.18, false);
    }

    isSupportingFloorTile(tile = null) {
      if (!tile || this.isCarryMovingPlacement(tile)) return false;
      return !tile.isVertical && !isPortalMaterial(tile.panelType);
    }

    hasWallSupport(cell, edge = 'north') {
      if (!cell) return false;
      const ownCellKey = createCellKey(cell.x, cell.y, cell.z);
      const neighborOffset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
      const neighbor = { x: cell.x + neighborOffset.x, y: cell.y + neighborOffset.y, z: cell.z };
      const neighborKey = createCellKey(neighbor.x, neighbor.y, neighbor.z);
      const ownTile = this.mapData.tiles?.[ownCellKey];
      const neighborTile = this.mapData.tiles?.[neighborKey];
      if (this.isSupportingFloorTile(ownTile) || this.isSupportingFloorTile(neighborTile)) return true;
      if (cell.z <= 0) return false;
      const belowOwn = createCellKey(cell.x, cell.y, cell.z - 1);
      const belowNeighbor = createCellKey(neighbor.x, neighbor.y, neighbor.z - 1);
      const belowWall = createWallKey(cell.x, cell.y, cell.z - 1, edge);
      const belowOwnTile = this.mapData.tiles?.[belowOwn];
      const belowNeighborTile = this.mapData.tiles?.[belowNeighbor];
      const belowWallPlacement = this.mapData.walls?.[belowWall];
      return this.isSupportingFloorTile(belowOwnTile)
        || this.isSupportingFloorTile(belowNeighborTile)
        || !!(belowWallPlacement && !this.isCarryMovingPlacement(belowWallPlacement));
    }

    getGearSurfaceForHit(hit) {
      return hit?.gearSurfacePlane ? (hit.surfaceSide || 'front') : null;
    }

    getGearHostKey(hit) {
      if (!hit?.cell) return '';
      if (hit.type === 'wall') return createWallKey(hit.cell.x, hit.cell.y, hit.cell.z, hit.edge);
      return createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
    }

    getGearHostPlacement(hit) {
      if (!hit?.cell) return null;
      if (hit.type === 'wall') return this.mapData.walls?.[this.getGearHostKey(hit)] || hit.wall || null;
      return this.mapData.tiles?.[this.getGearHostKey(hit)] || hit.tile || null;
    }

    hasVerticalObstructionOnEdge(cell, edge = 'north') {
      if (!cell) return false;
      if (this.mapData.walls?.[createWallKey(cell.x, cell.y, cell.z, edge)]) return true;
      const neighborOffset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
      const neighbor = { x: cell.x + neighborOffset.x, y: cell.y + neighborOffset.y, z: cell.z };
      const opposite = OPPOSITE_EDGE[edge] || 'south';
      return !!this.mapData.walls?.[createWallKey(neighbor.x, neighbor.y, neighbor.z, opposite)];
    }

    getVerticalPlacementSegmentWorld(placement) {
      if (!placement) return null;
      const endpoints = placement.edge
        ? (WALL_EDGE_ENDPOINTS[placement.edge] || WALL_EDGE_ENDPOINTS.north)
        : placement.isVertical
          ? getCellVerticalEndpoints(placement.rotation || 0)
          : null;
      if (!endpoints) return null;
      return endpoints.map((point) => ({
        x: (Number(placement.x) || 0) + point.x,
        y: (Number(placement.y) || 0) + point.y,
        z: Number(placement.z) || 0
      }));
    }

    getVerticalSegmentDirection(segment = []) {
      if (!Array.isArray(segment) || segment.length < 2) return null;
      const dx = (segment[1].x || 0) - (segment[0].x || 0);
      const dy = (segment[1].y || 0) - (segment[0].y || 0);
      const length = Math.hypot(dx, dy);
      if (length <= 0.001) return null;
      return { x: dx / length, y: dy / length };
    }

    getVerticalSocketEndpointIndex(placement, localEdge = 'west') {
      const segment = this.getVerticalPlacementSegmentWorld(placement);
      if (!segment) return null;
      if (placement.edge) return localEdge === 'west' ? 0 : 1;
      const sideLocal = localEdge === 'west' ? { x: -0.5, y: 0 } : { x: 0.5, y: 0 };
      const rotated = rotateLocalPoint(sideLocal, placement.rotation || 0);
      const sideWorld = {
        x: (Number(placement.x) || 0) + rotated.x,
        y: (Number(placement.y) || 0) + rotated.y,
        z: Number(placement.z) || 0
      };
      const firstDistance = Math.hypot(sideWorld.x - segment[0].x, sideWorld.y - segment[0].y);
      const secondDistance = Math.hypot(sideWorld.x - segment[1].x, sideWorld.y - segment[1].y);
      return firstDistance <= secondDistance ? 0 : 1;
    }

    isVerticalEndpointObstructed(placement, endpointIndex) {
      const segment = this.getVerticalPlacementSegmentWorld(placement);
      const endpoint = segment?.[endpointIndex];
      const direction = this.getVerticalSegmentDirection(segment);
      if (!endpoint || !direction) return false;
      const candidates = [
        ...Object.values(this.mapData.walls || {}),
        ...Object.values(this.mapData.tiles || {}).filter((tile) => tile?.isVertical)
      ];
      return candidates.some((other) => {
        if (!other || other === placement) return false;
        const otherSegment = this.getVerticalPlacementSegmentWorld(other);
        const otherDirection = this.getVerticalSegmentDirection(otherSegment);
        if (!otherSegment || !otherDirection) return false;
        if (Math.abs((Number(other.z) || 0) - endpoint.z) > 0.001) return false;
        const sharesEndpoint = otherSegment.some((point) => sameAxisPoint(point, endpoint));
        if (!sharesEndpoint) return false;
        const dot = Math.abs((direction.x * otherDirection.x) + (direction.y * otherDirection.y));
        return dot < 0.2;
      });
    }

    isGearSocketBlockedBySurface(placement, socket) {
      if (!placement || !socket) return false;
      if (!placement.edge && !placement.isVertical) {
        return Object.entries(GEAR_SOCKET_BLOCKED_BY_EDGE).some(([localEdge, blockedSockets]) => {
          if (!blockedSockets.has(socket)) return false;
          const worldEdge = rotateDirectionByDegrees(localEdge, placement.rotation || 0);
          return this.hasVerticalObstructionOnEdge(placement, worldEdge);
        });
      }
      return ['west', 'east'].some((localEdge) => {
        const blockedSockets = GEAR_SOCKET_BLOCKED_BY_EDGE[localEdge];
        if (!blockedSockets?.has(socket)) return false;
        const endpointIndex = this.getVerticalSocketEndpointIndex(placement, localEdge);
        return endpointIndex !== null && this.isVerticalEndpointObstructed(placement, endpointIndex);
      });
    }

    hasGearOnSocket(placement, socket, surface = 'front') {
      return (placement?.gearMounts || []).some((mount) => (
        mount.position === socket && (mount.surface || 'front') === surface
      ));
    }

    getGearSocketsForEdge(edge = 'north') {
      return GEAR_SOCKET_BLOCKED_BY_EDGE[edge] || new Set();
    }

    doesGearBlockWall(cell, edge = 'north') {
      if (!cell) return false;
      const ownTile = this.mapData.tiles?.[createCellKey(cell.x, cell.y, cell.z)];
      const ownBlockedSockets = this.getGearSocketsForEdge(edge);
      if ((ownTile?.gearMounts || []).some((mount) => ownBlockedSockets.has(mount.position))) return true;
      const neighborOffset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
      const neighbor = { x: cell.x + neighborOffset.x, y: cell.y + neighborOffset.y, z: cell.z };
      const neighborTile = this.mapData.tiles?.[createCellKey(neighbor.x, neighbor.y, neighbor.z)];
      const neighborBlockedSockets = this.getGearSocketsForEdge(OPPOSITE_EDGE[edge] || 'south');
      return (neighborTile?.gearMounts || []).some((mount) => neighborBlockedSockets.has(mount.position));
    }

    getGearBoardPointForHit(hit, socket) {
      if (!hit?.cell) return null;
      const placement = this.getGearHostPlacement(hit);
      if (!placement) return null;
      return this.mapGearLocalPointToSurface(
        placement,
        getGearMountLocalPosition(socket),
        { surface: this.getGearSurfaceForHit(hit) || 'front' }
      );
    }

    getGearSurfaceLocalPointForHit(hit) {
      if (!hit?.localSurfacePoint) return null;
      const placement = this.getGearHostPlacement(hit);
      if (!placement) return null;
      const context = this.getGearSurfaceContext(placement, this.getGearSurfaceForHit(hit) || 'front');
      if (!context?.polygon || context.polygon.length < 4) return null;
      const point = hit.localSurfacePoint;
      if (context.surface === 'wall') {
        const [bottomLeft, bottomRight, topRight, topLeft] = context.polygon;
        const uAxis = {
          x: (topRight.x - topLeft.x + bottomRight.x - bottomLeft.x) * 0.5,
          y: (topRight.y - topLeft.y + bottomRight.y - bottomLeft.y) * 0.5
        };
        const vAxis = {
          x: (bottomLeft.x - topLeft.x + bottomRight.x - topRight.x) * 0.5,
          y: (bottomLeft.y - topLeft.y + bottomRight.y - topRight.y) * 0.5
        };
        return this.projectPointToSurfaceLocal(point, topLeft, uAxis, vAxis, context.rotation);
      }
      const [nw, ne, se, sw] = context.polygon;
      const uAxis = {
        x: (ne.x - nw.x + se.x - sw.x) * 0.5,
        y: (ne.y - nw.y + se.y - sw.y) * 0.5
      };
      const vAxis = {
        x: (sw.x - nw.x + se.x - ne.x) * 0.5,
        y: (sw.y - nw.y + se.y - ne.y) * 0.5
      };
      return this.projectPointToSurfaceLocal(point, nw, uAxis, vAxis, context.rotation);
    }

    projectPointToSurfaceLocal(point, origin, uAxis, vAxis, rotation = 0) {
      const px = (point.x || 0) - (origin.x || 0);
      const py = (point.y || 0) - (origin.y || 0);
      const det = (uAxis.x * vAxis.y) - (uAxis.y * vAxis.x);
      if (Math.abs(det) < 0.0001) return null;
      const u = ((px * vAxis.y) - (py * vAxis.x)) / det;
      const v = ((uAxis.x * py) - (uAxis.y * px)) / det;
      return rotateLocalPoint({ x: u - 0.5, y: v - 0.5 }, -rotation);
    }

    getGearInstallTarget(hitInfo) {
      const hit = hitInfo?.hit;
      if (!hit || !['tile', 'wall'].includes(hit.type)) return null;
      if (isPortalMaterial(hit.panelType)) return null;
      const placement = this.getGearHostPlacement(hit);
      if (!placement) return null;
      const surface = this.getGearSurfaceForHit(hit);
      if (!surface) return null;
      const pointerLocal = this.getGearSurfaceLocalPointForHit(hit);
      const candidates = GEAR_SOCKET_POSITIONS.map((socket) => {
        const point = this.getGearBoardPointForHit(hit, socket);
        const socketLocal = getGearMountLocalPosition(socket);
        const occupied = this.hasGearOnSocket(placement, socket, surface);
        const blocked = this.isGearSocketBlockedBySurface(placement, socket);
        return {
          socket,
          point,
          valid: !!point && !occupied && !blocked,
          occupied,
          blocked,
          distance: pointerLocal
            ? Math.hypot((socketLocal.x || 0) - pointerLocal.x, (socketLocal.y || 0) - pointerLocal.y)
            : point && hitInfo.localPoint ? Math.hypot(point.x - hitInfo.localPoint.x, point.y - hitInfo.localPoint.y) : Infinity
        };
      }).filter((candidate) => candidate.point);
      const nearest = candidates.sort((a, b) => a.distance - b.distance)[0];
      if (!nearest) return null;
      return {
        hit,
        cell: hit.cell,
        hostKey: this.getGearHostKey(hit),
        hostKind: hit.type,
        edge: hit.edge || null,
        surface,
        socket: nearest.socket,
        point: nearest.point,
        placement,
        candidates,
        valid: nearest.valid,
        reason: nearest.occupied ? 'occupied' : nearest.blocked ? 'blocked_by_wall' : 'ok'
      };
    }

    drawGearComponentGhost(target) {
      if (!target?.point) return;
      (target.candidates || []).forEach((candidate) => {
        if (!candidate?.point || candidate.socket === target.socket) return;
        const color = candidate.valid ? 0xfacc15 : 0xef4444;
        this.ghostLayer.fillStyle(0x020617, candidate.valid ? 0.34 : 0.18);
        this.ghostLayer.fillEllipse(candidate.point.x, candidate.point.y + 3, 17, 7);
        this.ghostLayer.lineStyle(2, color, candidate.valid ? 0.7 : 0.58);
        this.ghostLayer.strokeCircle(candidate.point.x, candidate.point.y, 6);
        this.ghostLayer.fillStyle(candidate.valid ? 0xf8fafc : 0xfca5a5, 0.84);
        this.ghostLayer.fillCircle(candidate.point.x, candidate.point.y, 2.5);
      });
      this.drawMountedGearPreview(this.ghostLayer, target.point, {
        placement: target.placement,
        mount: {
          position: target.socket,
          surface: target.surface,
          axisType: 'freeAxis',
          phase: 0
        },
        valid: target.valid,
        axisType: 'freeAxis',
        alpha: target.valid ? 0.9 : 0.72,
        ghost: true
      });
    }

    drawProjectedSurfacePolygon(graphics, points = [], fillColor, fillAlpha = 1, strokeColor = null, strokeAlpha = 1, strokeWidth = 1) {
      if (!graphics || !Array.isArray(points) || points.length < 3) return;
      graphics.fillStyle(fillColor, fillAlpha);
      if (strokeColor !== null) graphics.lineStyle(strokeWidth, strokeColor, strokeAlpha);
      else graphics.lineStyle(0, fillColor, 0);
      graphics.beginPath();
      graphics.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => graphics.lineTo(point.x, point.y));
      graphics.closePath();
      graphics.fillPath();
      if (strokeColor !== null && strokeAlpha > 0 && strokeWidth > 0) graphics.strokePath();
    }

    offsetProjectedPoints(points = [], vector = { x: 0, y: 0 }) {
      return points.map((point) => ({
        x: point.x + (vector.x || 0),
        y: point.y + (vector.y || 0)
      }));
    }

    drawProjectedExtrusionSides(graphics, basePoints = [], topPoints = [], color = 0x0f172a, alpha = 0.82) {
      if (!graphics || basePoints.length < 3 || topPoints.length !== basePoints.length) return;
      for (let index = 0; index < basePoints.length; index += 1) {
        const nextIndex = (index + 1) % basePoints.length;
        const side = [basePoints[index], basePoints[nextIndex], topPoints[nextIndex], topPoints[index]];
        const shade = index % 2 === 0 ? color : 0x020617;
        this.drawProjectedSurfacePolygon(graphics, side, shade, alpha, 0x020617, 0.42, 1);
      }
    }

    getProjectedSurfaceCircle(placement, centerLocal = {}, radius = 0.1, segments = 32, angle = 0, surface = 'front') {
      const points = [];
      for (let index = 0; index < segments; index += 1) {
        const theta = angle + ((Math.PI * 2 * index) / segments);
        const point = this.mapGearLocalPointToSurface(placement, {
          x: (centerLocal.x || 0) + (Math.cos(theta) * radius),
          y: (centerLocal.y || 0) + (Math.sin(theta) * radius)
        }, {
          surface,
          allowOverflow: true
        });
        if (point) points.push(point);
      }
      return points;
    }

    getProjectedSurfaceGearOutline(placement, centerLocal = {}, teeth = GEAR_TOOTH_COUNT, angle = 0, surface = 'front') {
      const points = [];
      const toothStep = (Math.PI * 2) / teeth;
      const profile = [
        { t: -0.5, r: GEAR_ROOT_RADIUS_LOCAL },
        { t: -0.28, r: GEAR_PITCH_RADIUS_LOCAL },
        { t: -0.11, r: GEAR_OUTER_RADIUS_LOCAL },
        { t: 0.11, r: GEAR_OUTER_RADIUS_LOCAL },
        { t: 0.28, r: GEAR_PITCH_RADIUS_LOCAL }
      ];
      for (let tooth = 0; tooth < teeth; tooth += 1) {
        const base = angle + (tooth * toothStep);
        profile.forEach(({ t, r }) => {
          const theta = base + (t * toothStep);
          const point = this.mapGearLocalPointToSurface(placement, {
            x: (centerLocal.x || 0) + (Math.cos(theta) * r),
            y: (centerLocal.y || 0) + (Math.sin(theta) * r)
          }, {
            surface,
            allowOverflow: true
          });
          if (point) points.push(point);
        });
      }
      return points;
    }

    drawMountedGearPreview(graphics, point, options = {}) {
      if (!graphics || !point) return;
      const valid = options.valid !== false;
      const selected = !!options.selected;
      const mount = options.mount || { position: 'center', axisType: options.axisType };
      const placement = options.placement || null;
      const color = valid ? (selected ? 0xfacc15 : 0x111827) : 0xef4444;
      const hubColor = options.axisType === 'fixedAxis' || mount.axisType === 'fixedAxis' ? 0x22d3ee : (valid ? 0xfacc15 : 0xfca5a5);
      const alpha = Number.isFinite(options.alpha) ? options.alpha : 0.92;
      if (placement && mount.position) {
        const centerLocal = getGearMountLocalPosition(mount.position);
        const gearAngle = options.angle || 0;
        const surface = mount.surface || 'front';
        const context = this.getGearSurfaceContext(placement, surface);
        const extrusion = context?.extrusion || { x: 0, y: -8 };
        const shadow = this.getProjectedSurfaceCircle(placement, centerLocal, GEAR_OUTER_RADIUS_LOCAL * 1.04, 48, gearAngle, surface);
        this.drawProjectedSurfacePolygon(graphics, shadow, 0x020617, options.ghost ? 0.18 : 0.22);
        const baseOutline = this.getProjectedSurfaceGearOutline(placement, centerLocal, GEAR_TOOTH_COUNT, gearAngle, surface);
        const outline = this.offsetProjectedPoints(baseOutline, extrusion);
        this.drawProjectedExtrusionSides(graphics, baseOutline, outline, valid ? 0x111827 : 0x4c1111, options.ghost ? 0.62 : 0.9);
        this.drawProjectedSurfacePolygon(
          graphics,
          outline,
          valid ? 0x111827 : 0x3f1111,
          alpha,
          options.ghost || selected ? color : 0x020617,
          options.ghost || selected ? 0.9 : 0.58,
          options.ghost || selected ? 2 : 1
        );
        const root = this.offsetProjectedPoints(
          this.getProjectedSurfaceCircle(placement, centerLocal, GEAR_ROOT_RADIUS_LOCAL * 0.88, 48, gearAngle, surface),
          extrusion
        );
        this.drawProjectedSurfacePolygon(graphics, root, valid ? 0x1f2937 : 0x7f1d1d, 0.94, 0x020617, 0.42, 1);
        const hubBase = this.getProjectedSurfaceCircle(placement, centerLocal, GEAR_HUB_RADIUS_LOCAL, 32, gearAngle, surface);
        const hub = this.offsetProjectedPoints(hubBase, {
          x: extrusion.x * 1.22,
          y: extrusion.y * 1.22
        });
        this.drawProjectedExtrusionSides(graphics, hubBase, hub, hubColor === 0x22d3ee ? 0x0e7490 : 0x854d0e, options.ghost ? 0.54 : 0.8);
        this.drawProjectedSurfacePolygon(graphics, hub, hubColor, 0.96, 0x020617, 0.74, 1);
        const axle = this.offsetProjectedPoints(
          this.getProjectedSurfaceCircle(placement, centerLocal, GEAR_AXLE_RADIUS_LOCAL, 24, gearAngle, surface),
          {
            x: extrusion.x * 1.38,
            y: extrusion.y * 1.38
          }
        );
        this.drawProjectedSurfacePolygon(graphics, axle, 0x020617, 0.82);
        if (selected) {
          const ring = this.offsetProjectedPoints(
            this.getProjectedSurfaceCircle(placement, centerLocal, GEAR_OUTER_RADIUS_LOCAL * 1.18, 56, gearAngle, surface),
            extrusion
          );
          this.drawProjectedSurfacePolygon(graphics, ring, 0xfacc15, 0.06, 0xfacc15, 0.86, 2);
        }
        return;
      }
      graphics.fillStyle(0x020617, options.ghost ? 0.18 : 0.26);
      graphics.fillEllipse(point.x, point.y + 5, 30, 10);
      graphics.lineStyle(options.ghost ? 2 : 1, valid ? 0xfacc15 : 0xef4444, options.ghost ? 0.72 : 0.34);
      graphics.strokeEllipse(point.x, point.y + 5, 24, 8);
      graphics.fillStyle(0x020617, alpha);
      graphics.lineStyle(selected ? 4 : 3, color, selected ? 1 : 0.9);
      drawGearShape(graphics, point.x, point.y, 15, 11, 12, options.angle || 0);
      graphics.fillStyle(hubColor, 0.96);
      graphics.fillCircle(point.x, point.y, 5);
      graphics.fillStyle(0x020617, 0.74);
      graphics.fillCircle(point.x, point.y, 2);
      graphics.lineStyle(2, hubColor, 0.86);
      graphics.lineBetween(point.x, point.y - 11, point.x, point.y + 11);
      if (selected) {
        graphics.lineStyle(2, 0xfef3c7, 0.86);
        graphics.strokeCircle(point.x, point.y, 19);
      }
    }

    getGhostBoardPoint(polygon, localPosition = {}, rotation = 0, offsetX = 0, offsetY = 0, surface = 'floor') {
      if (!Array.isArray(polygon) || polygon.length < 4) return null;
      const rotated = rotateLocalPoint({
        x: localPosition.x || 0,
        y: localPosition.y || 0
      }, rotation);
      const u = Math.max(0, Math.min(1, rotated.x + 0.5));
      const v = Math.max(0, Math.min(1, rotated.y + 0.5));
      if (surface === 'wall') {
        const [bottomLeft, bottomRight, topRight, topLeft] = polygon;
        const lerp = (a, b, t) => a + ((b - a) * t);
        return {
          x: offsetX + lerp(lerp(topLeft.x, topRight.x, u), lerp(bottomLeft.x, bottomRight.x, u), v),
          y: offsetY + lerp(lerp(topLeft.y, topRight.y, u), lerp(bottomLeft.y, bottomRight.y, u), v)
        };
      }
      const [nw, ne, se, sw] = polygon;
      const lerp = (a, b, t) => a + ((b - a) * t);
      return {
        x: offsetX + lerp(lerp(nw.x, ne.x, u), lerp(sw.x, se.x, u), v),
        y: offsetY + lerp(lerp(nw.y, ne.y, u), lerp(sw.y, se.y, u), v)
      };
    }

    drawGhostBoardDetails(ghostTile, polygon, offsetX = 0, offsetY = 0, rotation = 0, surface = 'floor') {
      const material = getCityChannelMaterial(ghostTile?.panelType);
      if (!material) return;
      const ports = material.transmissionSkeleton?.ports || [];
      const center = this.getGhostBoardPoint(polygon, { x: 0, y: 0 }, rotation, offsetX, offsetY, surface);
      if (ports.length > 0 && center) {
        ports.forEach((port) => {
          const point = this.getGhostBoardPoint(polygon, port.localPosition, rotation, offsetX, offsetY, surface);
          if (!point) return;
          this.drawTransmissionRail(this.ghostLayer, center, point, {
            alpha: 0.72,
            width: 2.2,
            endpointRadius: 3
          });
        });
      }

      if (material.gearIcon && center && !isGearPressurePlatePanel(ghostTile?.panelType)) {
        this.ghostLayer.fillStyle(0x020617, 0.88);
        this.ghostLayer.lineStyle(2, 0xf8fafc, 0.34);
        drawGearShape(this.ghostLayer, center.x + 24, center.y - 8, 12, 9, 10);
      }

      (material.gearMounts || []).forEach((mount) => {
        const point = this.getGhostBoardPoint(polygon, getGearMountLocalPosition(mount.position), rotation, offsetX, offsetY, surface);
        if (!point) return;
        this.ghostLayer.fillStyle(0x020617, 0.9);
        this.ghostLayer.lineStyle(2, mount.axisType === 'fixedAxis' ? 0x22d3ee : 0xf8fafc, 0.82);
        drawGearShape(this.ghostLayer, point.x, point.y, mount.position === 'center' ? 15 : 11, mount.position === 'center' ? 11 : 8, 10);
      });
    }

    drawGhostSnapConnection(placement, geometry, offsetX, offsetY) {
      const connection = placement?.snapConnection;
      if (!connection?.valid || !connection.activePort || !connection.supportPort || !connection.support?.placement) return;
      const activeSurface = placement.edge || placement.isVertical ? 'wall' : 'floor';
      const activePolygon = getTransmissionPortPlane(geometry, activeSurface);
      const activePoint = this.getGhostBoardPoint(
        activePolygon,
        connection.activePort.localPosition,
        getTransmissionSurfaceRotation(placement),
        offsetX,
        offsetY,
        activeSurface
      );
      const supportPlacement = connection.support.placement;
      const supportProjection = projectCell(supportPlacement, this.cameraState.yaw, this.mapData);
      const supportOffsetX = supportProjection.x - (TILE_RENDER_WIDTH * 0.5);
      const supportOffsetY = supportProjection.y - (TILE_RENDER_HEIGHT * 0.57);
      let supportPolygon = null;
      let supportSurface = 'floor';
      if (connection.support.kind === 'wall') {
        supportPolygon = getTransmissionMidPlane(createEdgeWallGeometry(this.cameraState.yaw, supportPlacement.edge), 'wall');
        supportSurface = 'wall';
      } else {
        const supportGeometry = createTileGeometry(this.cameraState.yaw, supportPlacement.rotation || 0);
        supportSurface = supportPlacement.isVertical ? 'wall' : 'floor';
        supportPolygon = getTransmissionPortPlane(supportGeometry, supportSurface);
      }
      const supportPoint = this.getGhostBoardPoint(
        supportPolygon,
        connection.supportPort.localPosition,
        getTransmissionSurfaceRotation(supportPlacement),
        supportOffsetX,
        supportOffsetY,
        supportSurface
      );
      if (!activePoint || !supportPoint) return;
      [activePoint, supportPoint].forEach((point) => {
        this.ghostLayer.fillStyle(0xfacc15, 0.86);
        this.ghostLayer.fillCircle(point.x, point.y, 5);
        this.ghostLayer.lineStyle(2, 0x22d3ee, 0.78);
        this.ghostLayer.strokeCircle(point.x, point.y, 8);
        this.ghostLayer.lineStyle(1, 0xffffff, 0.9);
        this.ghostLayer.strokeCircle(point.x, point.y, 3);
      });
    }

    drawPlacementGhost(placement, color = 0x67e8f9, alpha = 0.18, fromMove = false) {
      if (!placement) return;
      const projection = projectCell(placement, this.cameraState.yaw, this.mapData);
      const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
      const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
      this.ghostLayer.lineStyle(fromMove ? 2 : 2, color, fromMove ? 0.92 : 0.78);
      this.ghostLayer.fillStyle(color, placement.edge ? Math.max(alpha, 0.72) : alpha);
      const ghostValid = color !== 0xef4444;
      if (placement.edge) {
        const source = placement.source || placement;
        const sourceWall = this.mapData.walls?.[createWallKey(source.x, source.y, source.z, source.edge)];
        const geometry = createEdgeWallGeometry(this.cameraState.yaw, placement.edge);
        [geometry.wall, geometry.wallSideStart, geometry.wallSideEnd, geometry.wallCap].forEach((points) => {
          drawPolygonShape(this.ghostLayer, points, offsetX, offsetY);
        });
        const wallRotation = getTransmissionSurfaceRotation(placement);
        this.drawGhostBoardDetails({
          panelType: placement.panelType || this.activeTileType
        }, getTransmissionMidPlane(geometry, 'wall'), offsetX, offsetY, wallRotation, 'wall');
        this.drawGhostSnapConnection(placement, geometry, offsetX, offsetY);
        if (fromMove) {
          const ghostWall = sourceWall
            ? buildPlacementGhostAtTarget(sourceWall, placement)
            : null;
          this.drawPlacementGhostAttachedComponents(ghostWall, { valid: ghostValid });
        }
        return;
      }

      const source = placement.source || placement;
      const sourcePlacement = source.edge
        ? this.mapData.walls?.[createWallSelectionKey(source)]
        : this.mapData.tiles?.[createCellKey(source.x, source.y, source.z)];
      const ghostTile = sourcePlacement && fromMove
        ? buildPlacementGhostAtTarget(sourcePlacement, placement)
        : createTile({
          x: placement.x,
          y: placement.y,
          z: placement.z,
          panelType: placement.panelType || this.activeTileType,
          rotation: placement.rotation || this.activeRotation,
          transmissionRotation: placement.transmissionRotation ?? placement.rotation ?? this.activeRotation
        });
      const geometry = createTileGeometry(this.cameraState.yaw, ghostTile.rotation || 0);
      [...geometry.sides, geometry.top].forEach((points) => {
        drawPolygonShape(this.ghostLayer, points, offsetX, offsetY);
      });
      const ghostSurface = ghostTile.isVertical ? 'wall' : 'floor';
      const ghostTransmissionPlane = getTransmissionPortPlane(geometry, ghostSurface);
      this.drawGhostBoardDetails(
        ghostTile,
        ghostTransmissionPlane,
        offsetX,
        offsetY,
        getTransmissionSurfaceRotation(ghostTile),
        ghostSurface
      );
      if (isGearPressurePlatePanel(ghostTile.panelType)) {
        const screenTop = geometry.top.map((point) => ({
          x: point.x + offsetX,
          y: point.y + offsetY
        }));
        this.textureCache.drawGearPressurePlateCornerHint(this.ghostLayer, { top: screenTop }, 0.22);
      }
      this.drawGhostSnapConnection(placement, geometry, offsetX, offsetY);
      if (isPortalMaterial(ghostTile.panelType)) {
        getPortalPolygons(this.cameraState.yaw, ghostTile.rotation || 0).forEach((points) => {
          drawPolygonShape(this.ghostLayer, points, offsetX, offsetY);
        });
      } else if (ghostTile.isVertical) {
        [geometry.wall, geometry.wallSideStart, geometry.wallSideEnd, geometry.wallCap].forEach((points) => {
          drawPolygonShape(this.ghostLayer, points, offsetX, offsetY);
        });
      }
      if (fromMove) {
        this.drawPlacementGhostAttachedComponents(ghostTile, { valid: ghostValid });
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
