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
  createTileGeometry,
  createVerticalTileWallGeometry,
  detectNearestEdge,
  getTransmissionMidPlane,
  getTransmissionPortPlane,
  getNeighborCells,
  localToCellAtLayer,
  pointInPolygon,
  projectCell,
  screenToLocal
} from './renderer/CityChannelGeometry';
import { getCellVerticalEndpoints, getPlacementDepth } from './renderer/CityChannelDepth';
import {
  compareCityChannelHits,
  shouldStartPaintDrag
} from './cityChannelSceneInteraction';
import {
  closeInspectMode,
  inspectHitTile,
  isDoubleClickMechanismHit,
  normalizeInspectableHit,
  refreshInspectPreview
} from './cityChannelInspection';
import {
  playPreviewAnimation as playMechanismPreviewAnimation,
  requestMechanismPanel as requestMechanismPanelForScene,
  triggerMechanismAtCell as triggerMechanismAtSceneCell,
  triggerMechanismFromHit as triggerMechanismFromSceneHit
} from './cityChannelMechanismPlayback';
import {
  createMechanismObject as createMechanismObjectForScene,
  drawMechanismState as drawMechanismStateForScene,
  refreshMechanismVisuals as refreshMechanismVisualsForScene
} from './cityChannelMechanismVisuals';
import {
  applyPaint as applyPaintForScene,
  applySelectionScopeVisualState as applySelectionScopeVisualStateForScene,
  beginPaint as beginPaintForScene,
  commitPaint as commitPaintForScene,
  eraseHit as eraseHitForScene,
  isSelectedHit as isSelectedHitForScene,
  selectHit as selectHitForScene,
  setSelection as setSelectionForScene
} from './cityChannelEditorInteraction';
import CityChannelTextureCache, { getTextureYawBucket } from './renderer/CityChannelTextureCache';
import CityChannelRuntimeIndex from './runtime/CityChannelRuntimeIndex';
import { projectWorldOffset } from '../cityChannelGeometryUtils';
import {
  buildMechanicalAssemblies,
  getCornerGearBindingCandidates,
  getGearAxisBindingStatus,
  getGearMountLocalPosition,
  isCornerGearSocket,
  isTriggerMechanismTile,
  normalizeMechanismParams
} from '../cityChannelMechanismRuntime';
import {
  getFixedAxisWorldAnchor,
  getGearWorldPosition,
  getRuntimePlacementForFixedAxisAssemblyMember
} from '../cityChannelMechanismSimulation';
import {
  computeCityChannelMovePreviewModel,
  getSelectionAnchor,
  isPortalMaterial
} from '../cityChannelMovePreview';
import {
  hasDirectionalGearSurface,
  isGearPressurePlatePanel,
  normalizeGearSurfaceForPanel
} from '../cityChannelGearPressurePlateRender';
import {
  buildPlacementGhostAtTarget,
  getMovingHostKeysFromOrigins
} from '../cityChannelAttachedComponents';
import {
  canSelectBoardPlacement,
  canSelectComponentPlacement
} from '../cityChannelSelectionRules';
import {
  isLayerVisible as isCityChannelLayerVisible,
  isPlacementVisible as isCityChannelPlacementVisible
} from './cityChannelPhaserVisibility';
import {
  drawMechanicalLayers,
  getMechanicalPortHit,
  rotateTransmissionPlacementsInPlace
} from './cityChannelMechanicalSystems';
import {
  doesGearBlockWall as doesGearBlockWallForMap,
  getGearHit as getCityChannelGearHit,
  getGearInstallTargetForScene,
  getGearMountIdentity,
  getGearSurfaceNormal,
  getMountedGearHostDepth,
  getMountedGearLayerKey,
  hasCornerGearConflict,
  getVisibleGearSurfaceSide,
  isGearSocketBlockedBySurface as isCityChannelGearSocketBlockedBySurface,
  isGearOnCameraSide,
  isGearSurfaceVisible
} from './cityChannelGears';
import {
  createStructuralSupportResolver,
  getAbsoluteWallEdgeEndpoints,
  getAxisOptionIndex,
  getAxisOptionIndexInAllOptions,
  getAxisOptionKey,
  getAxisPlacementOptions as getAxisPlacementOptionsForMap,
  getAxisPlacementTarget as getAxisPlacementTargetFromOptions,
  getSnapAxisEdge,
  getSnapAxisKey,
  getSupportAxisSegment,
  getSupportAxisVertex,
  getSupportPrimaryEdge,
  getVerticalSupportConnectionCandidates,
  getVerticalTopSnapSpec as getVerticalTopSnapSpecForSupport,
  getWallPhysicalKey,
  hasTileSupport as hasTileSupportForMap,
  isWallPhysicalPlaneOccupied,
  resolveBestVerticalSnapConnection as resolveBestVerticalSnapConnectionForSupport,
  resolveFloorSnapConnection as resolveFloorSnapConnectionForMap,
  resolveVerticalSnapConnection as resolveVerticalSnapConnectionForSupport
} from './cityChannelVerticalSnap';
import {
  CAMERA_PAN_SPEED,
  CAMERA_ROTATION_SPEED,
  EDGE_NEIGHBOR_OFFSETS,
  FIXED_HORIZONTAL_TILE_TYPES,
  FLOOR_EDGE_SNAP_SCREEN_RADIUS,
  GEAR_AXLE_RADIUS_LOCAL,
  GEAR_COMPONENT_TYPE,
  GEAR_HUB_RADIUS_LOCAL,
  GEAR_OUTER_RADIUS_LOCAL,
  GEAR_PITCH_RADIUS_LOCAL,
  GEAR_ROOT_RADIUS_LOCAL,
  GEAR_SOCKET_POSITIONS,
  GEAR_TOOTH_COUNT,
  INSPECT_MAX_PITCH,
  INSPECT_MIN_PITCH,
  INSPECT_ROTATE_SENSITIVITY,
  MAX_ZOOM,
  MIN_ZOOM,
  OPPOSITE_EDGE,
  SELECTED_MOVE_HOLD_DELAY,
  TRANSMISSION_SOCKET_EPSILON,
  VERTICAL_SURFACE_EDGE_SNAP_SCREEN_RADIUS,
  WALL_EDGE_ENDPOINTS,
  WALL_EDGE_SNAP_SCREEN_RADIUS,
  WALL_EDGE_TANGENTS,
  createWallSelectionKey,
  distancePointToSegmentSquared,
  drawGearShape,
  drawLocalPolygon,
  drawPolygonShape,
  expandRect,
  getDirectionFromEndpoint,
  getPointBounds,
  getPortalPolygons,
  getTransmissionSurfaceRotation,
  getWallSurfaceRotation,
  isBoardMaterial,
  normalizeAngleDelta,
  normalizeCameraYaw,
  normalizeVector,
  rectContainsPoint,
  resolveMaterialName,
  rotateLocalPoint,
  sameAxisPoint,
  sameAxisSegment,
  sameCell
} from './cityChannelPhaserSceneUtils';

const GEAR_ATTACH_HIGHLIGHT_STYLE = Object.freeze({
  SOURCE_RING_COLOR: 0xf5faff,
  SOURCE_GLOW_COLOR: 0xb4dcff,
  SOURCE_ANCHOR_COLOR: 0xffffff,
  CANDIDATE_EDGE_COLOR: 0xdcf0ff,
  CANDIDATE_FILL_COLOR: 0xebf8ff,
  CANDIDATE_GLOW_COLOR: 0xb4dcff,
  HOVER_EDGE_COLOR: 0xffffff,
  HOVER_GLOW_COLOR: 0xbee6ff,
  PREVIEW_LINE_COLOR: 0xebf8ff,
  CONFIRMED_MARKER_COLOR: 0xf8fbff,
  CONFIRMED_CORE_COLOR: 0xdbeafe,
  GEAR_BOUND_HUB_COLOR: 0xdbeafe,
  GEAR_BOUND_SIDE_COLOR: 0x334155,
  AMBIENT_BINDING_COLOR: 0xfbbf24,
  AMBIENT_BINDING_FILL_COLOR: 0xf59e0b,
  AMBIENT_BINDING_GLOW_COLOR: 0xfde68a,
  AMBIENT_BINDING_DARK_COLOR: 0x451a03
});

const GEAR_ATTACH_CANDIDATE_PULSE_MS = 1800;
const GEAR_ATTACH_SOURCE_PULSE_MS = 1200;
const GEAR_ATTACH_CONFIRM_PULSE_MS = 160;

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
      this.mechanismRuntimeSnapshot = null;
      this.mechanismPreviewTargets = new Set();
      this.mechanismPreviewTimers = new Set();
      this.mechanismPreviewResetters = new Set();
      this.conflictFlashState = null;
      this.mapRevision = 0;
      this.lastGhostLayerKey = '';
      this.snapPlaneCycle = 0;
      this.activeSnapAxisKey = '';
      this.selectionSyncLock = null;
      this.gearBindingConfirmPulse = null;
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
      this.gearBindingCandidateLayer = this.add.graphics();
      this.gearBindingCandidateLayer.setBlendMode?.(Phaser.BlendModes?.SCREEN || 'SCREEN');
      this.ghostLayer = this.add.graphics();
      this.conflictFlashLayer = this.add.graphics();
      this.conflictFlashLayer.setBlendMode?.(Phaser.BlendModes?.SCREEN || 'SCREEN');
      this.inspectLayer = this.add.container(0, 0);
      this.inspectLayer.depth = 100000;
      this.debugText = null;

      this.worldLayer.add([this.mapLayer, this.mechanicalLinkLayer, this.routeLayer, this.helperLayer, this.selectionLayer, this.gearBindingCandidateLayer, this.mechanicalPortLayer, this.ghostLayer, this.conflictFlashLayer]);
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
      closeInspectMode(this, { animate: false, silent: true });
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
        closeInspectMode(this, { animate: false });
        this.cancelMechanismRuntimePreview({ silent: true });
        this.mapDataSource = next.mapData;
        this.mapData = normalizeCityChannelMap(next.mapData);
        this.mapRevision += 1;
        this.invalidateMechanicalGraph();
        this.index.rebuild(this.mapData);
        if (this.skipMapDataRenderCount > 0) {
          this.skipMapDataRenderCount -= 1;
          this.sortMapLayer();
          this.scheduleMechanicalLayerRedraw(40);
          this.redrawAllMountedGearLayers();
          this.drawSelectionLayer();
          this.drawGearBindingCandidates();
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
        refreshInspectPreview(this);
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
        this.drawGearBindingCandidates();
      }
    }

    isWallPlacementActive() {
      return (
        this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE
        && this.panelPose === 'wall'
        && this.activeTileType
        && isBoardMaterial(this.activeTileType)
        && !this.isFixedHorizontalPlacementType(this.activeTileType)
      );
    }

    isFixedHorizontalPlacementType(panelType = null) {
      return FIXED_HORIZONTAL_TILE_TYPES.has(panelType || this.activeTileType);
    }

    getEffectiveWallViewMode() {
      return this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE ? 'solid' : this.wallViewMode;
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

    setMechanismRuntimeSnapshot(snapshot = null) {
      this.mechanismRuntimeSnapshot = snapshot;
      this.config.onMechanismRuntimeSnapshot?.(snapshot);
    }

    registerMechanismPreviewTarget(target) {
      if (!target) return;
      this.mechanismPreviewTargets.add(target);
    }

    registerMechanismPreviewTimer(timer) {
      if (!timer) return;
      this.mechanismPreviewTimers.add(timer);
    }

    registerMechanismPreviewResetter(resetter) {
      if (typeof resetter !== 'function') return;
      this.mechanismPreviewResetters.add(resetter);
    }

    clearMechanismPreviewRegistrations() {
      this.mechanismPreviewTargets.clear();
      this.mechanismPreviewTimers.clear();
      this.mechanismPreviewResetters.clear();
    }

    mergeMechanismRuntimeGearStates(gears = {}) {
      const current = this.mechanismRuntimeSnapshot || {
        sourceAngle: 0,
        placements: {},
        gears: {},
        sync: [],
        obstruction: null
      };
      this.mechanismRuntimeSnapshot = {
        ...current,
        gears: {
          ...(current.gears || {}),
          ...(gears || {})
        }
      };
      this.config.onMechanismRuntimeSnapshot?.(this.mechanismRuntimeSnapshot);
    }

    clearMechanismRuntimeSnapshot() {
      if (!this.mechanismRuntimeSnapshot) return;
      this.mechanismRuntimeSnapshot = null;
      this.config.onMechanismRuntimeSnapshot?.(null);
      this.clearMechanismPreviewRegistrations();
      if (this.mapLayer) this.renderMap({ full: true });
    }

    drawConflictFlashPolygon(points = [], alpha = 1) {
      if (!this.conflictFlashLayer || !Array.isArray(points) || points.length < 3 || alpha <= 0) return;
      this.conflictFlashLayer.fillStyle(0xff0000, 0.26 * alpha);
      this.conflictFlashLayer.beginPath();
      this.conflictFlashLayer.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => this.conflictFlashLayer.lineTo(point.x, point.y));
      this.conflictFlashLayer.closePath();
      this.conflictFlashLayer.fillPath();
      this.conflictFlashLayer.lineStyle(16, 0xff0000, 0.2 * alpha);
      this.conflictFlashLayer.strokePath();
      this.conflictFlashLayer.lineStyle(9, 0x7f0000, 0.5 * alpha);
      this.conflictFlashLayer.strokePath();
      this.conflictFlashLayer.lineStyle(6, 0xff0000, alpha);
      this.conflictFlashLayer.strokePath();
      this.conflictFlashLayer.lineStyle(2, 0xffffff, 0.82 * alpha);
      this.conflictFlashLayer.strokePath();
    }

    drawConflictFlashPlacement(placement = null, alpha = 1) {
      if (!this.conflictFlashLayer) return false;
      this.conflictFlashLayer.clear();
      if (!placement || alpha <= 0) return false;
      const polygons = placement.edge
        ? this.getWallLocalPolygons(placement)
        : this.getTileLocalPolygons(placement);
      if (polygons.length <= 0) return false;
      this.conflictFlashLayer.depth = 10050;
      polygons.forEach((points) => this.drawConflictFlashPolygon(points, alpha));
      return true;
    }

    flashMechanismObstruction(obstruction = null) {
      const placement = obstruction?.obstacle || null;
      if (!placement || !this.conflictFlashLayer) return false;
      if (this.conflictFlashState) this.tweens?.killTweensOf?.(this.conflictFlashState);
      const state = { alpha: 0 };
      this.conflictFlashState = state;
      const redraw = () => this.drawConflictFlashPlacement(placement, state.alpha);
      if (!this.tweens?.add) {
        state.alpha = 1;
        redraw();
        return true;
      }
      this.tweens.add({
        targets: state,
        alpha: 1,
        duration: 220,
        yoyo: true,
        repeat: 1,
        repeatDelay: 120,
        ease: 'sine.inout',
        onUpdate: redraw,
        onComplete: () => {
          if (this.conflictFlashState === state) this.conflictFlashState = null;
          this.conflictFlashLayer?.clear();
        }
      });
      redraw();
      return true;
    }

    cancelMechanismRuntimePreview({ silent = false } = {}) {
      const hadPreview = !!this.mechanismRuntimeSnapshot
        || this.mechanismPreviewTargets.size > 0
        || this.mechanismPreviewTimers.size > 0
        || this.mechanismPreviewResetters.size > 0;
      this.mechanismPreviewTargets.forEach((target) => {
        this.tweens?.killTweensOf?.(target);
      });
      this.mechanismPreviewTimers.forEach((timer) => {
        timer?.remove?.(false);
      });
      this.mechanismPreviewResetters.forEach((resetter) => {
        try {
          resetter();
        } catch (error) {
          if (!silent) this.config.onToast?.(`机关预览复位失败：${error?.message || 'unknown error'}`, 'error');
        }
      });
      this.clearMechanismRuntimeSnapshot();
      this.clearMechanismPreviewRegistrations();
      this.config.onMechanismPreviewProgress?.(null);
      if (hadPreview && !this.mechanismRuntimeSnapshot) {
        if (this.selectionLayer) this.drawSelectionLayer();
        if (this.gearBindingCandidateLayer) this.drawGearBindingCandidates();
      }
      return hadPreview;
    }

    getRuntimePlacement(componentKey, placement) {
      return this.mechanismRuntimeSnapshot?.placements?.[componentKey] || placement;
    }

    getRuntimeGearState(componentKey, mountId) {
      return this.mechanismRuntimeSnapshot?.gears?.[`${componentKey}:${mountId}`] || null;
    }

    getRuntimePlacementScreenPoint(placement) {
      if (!placement) return null;
      return this.projectRuntimePlacement(placement);
    }

    projectRuntimePlacement(placement) {
      return projectCell(placement, this.cameraState.yaw, this.mapData);
    }

    getMountedGearLayerDepth(hostKind, placement, mount = null) {
      if (!placement) return 0;
      const isWallSurface = hostKind === 'wall' || placement.edge || placement.isVertical;
      const physicalLayer = isWallSurface ? 'wall_attachment' : 'floor_attachment';
      const anchor = mount ? getGearWorldPosition(placement, mount) : null;
      const getDepth = (cell) => getPlacementDepth({
        cell: cell || { x: placement.x, y: placement.y, z: placement.z },
        partType: physicalLayer,
        physicalLayer,
        edge: placement.edge,
        rotation: placement.rotation || 0,
        cameraYaw: this.cameraState.yaw,
        mapData: this.mapData
      });
      if (!isWallSurface && mount && isCornerGearSocket(mount.position)) {
        const pivotWorld = getGearWorldPosition(placement, mount);
        const candidateDepths = getCornerGearBindingCandidates({
          mapData: this.mapData,
          pivotWorld
        }).map((candidate) => {
          const tile = this.mapData.tiles?.[candidate.componentKey];
          return tile ? getDepth(tile) : null;
        }).filter(Number.isFinite);
        if (candidateDepths.length > 0) return Math.max(...candidateDepths);
      }
      return getDepth(anchor || { x: placement.x, y: placement.y, z: placement.z });
    }

    getGearSurfacePlaneKey(placement) {
      if (!placement) return '';
      const z = Math.round((Number(placement.z) || 0) * 1000);
      if (placement.edge) {
        const edge = placement.edge || 'north';
        const normal = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
        const endpoints = WALL_EDGE_ENDPOINTS[edge] || WALL_EDGE_ENDPOINTS.north;
        const center = {
          x: ((endpoints[0]?.x || 0) + (endpoints[1]?.x || 0)) * 0.5,
          y: ((endpoints[0]?.y || 0) + (endpoints[1]?.y || 0)) * 0.5
        };
        const axis = Math.abs(normal.x) > Math.abs(normal.y) ? 'x' : 'y';
        const coordinate = axis === 'x'
          ? (Number(placement.x) || 0) + center.x
          : (Number(placement.y) || 0) + center.y;
        return `wall:${axis}:${Math.round(coordinate * 1000)}`;
      }
      if (placement.isVertical) {
        const normal = getGearSurfaceNormal(placement, 'front');
        const axis = Math.abs(normal.x) > Math.abs(normal.y) ? 'x' : 'y';
        const coordinate = axis === 'x' ? Number(placement.x) || 0 : Number(placement.y) || 0;
        return `vertical:${axis}:${Math.round(coordinate * 1000)}`;
      }
      return `floor:${z}`;
    }

    getMountedGearScreenRadius(placement, mount = {}) {
      const centerLocal = getGearMountLocalPosition(mount.position);
      const center = this.mapGearLocalPointToSurface(placement, centerLocal, {
        surface: mount.surface || 'front',
        allowOverflow: true
      });
      if (!center) return 34;
      const samples = [
        { x: centerLocal.x + GEAR_OUTER_RADIUS_LOCAL, y: centerLocal.y },
        { x: centerLocal.x - GEAR_OUTER_RADIUS_LOCAL, y: centerLocal.y },
        { x: centerLocal.x, y: centerLocal.y + GEAR_OUTER_RADIUS_LOCAL },
        { x: centerLocal.x, y: centerLocal.y - GEAR_OUTER_RADIUS_LOCAL }
      ].map((local) => this.mapGearLocalPointToSurface(placement, local, {
        surface: mount.surface || 'front',
        allowOverflow: true
      })).filter(Boolean);
      const radius = samples.reduce((max, point) => Math.max(
        max,
        Math.hypot(point.x - center.x, point.y - center.y)
      ), 0);
      return Math.max(34, radius + 12);
    }

    getPlacementBoardDepth(hostKind, placement) {
      if (!placement) return null;
      const isWallSurface = hostKind === 'wall' || placement.edge || placement.isVertical;
      const isPortal = !isWallSurface && isPortalMaterial(placement.panelType);
      return getPlacementDepth({
        cell: { x: placement.x, y: placement.y, z: placement.z },
        partType: isPortal ? 'portal_body' : isWallSurface ? 'wall_plane' : 'floor_base',
        physicalLayer: isPortal ? 'portal_body' : isWallSurface ? 'wall_plane' : 'floor_base',
        edge: placement.edge,
        rotation: placement.edge ? getWallSurfaceRotation(placement) : placement.rotation || 0,
        cameraYaw: this.cameraState.yaw,
        mapData: this.mapData
      });
    }

    getMountedGearForegroundDepth(hostKind, placement, mount = {}, point = null, baseDepth = 0) {
      if (!placement || !mount || !point || !isGearOnCameraSide(placement, mount, this.cameraState.yaw)) return baseDepth;
      const planeKey = this.getGearSurfacePlaneKey(placement);
      if (!planeKey) return baseDepth;
      const radius = this.getMountedGearScreenRadius(placement, mount);
      let foregroundDepth = baseDepth;
      const visitPlacement = (candidateHostKind, componentKey, candidateSource) => {
        if (!candidateSource || !isCityChannelPlacementVisible(candidateSource, {
          mapData: this.mapData,
          visibleLayerCutoff: this.visibleLayerCutoff
        })) return;
        const candidate = this.getRuntimePlacement(componentKey, candidateSource);
        if (this.getGearSurfacePlaneKey(candidate) !== planeKey) return;
        const surfaceContext = this.getGearSurfaceContext(candidate, mount.surface || 'front');
        const polygon = Array.isArray(surfaceContext?.polygon)
          ? surfaceContext.polygon.map((vertex) => ({
            x: vertex.x + (surfaceContext.offsetX || 0),
            y: vertex.y + (surfaceContext.offsetY || 0)
          }))
          : [];
        if (polygon.length < 3) return;
        const bounds = expandRect(getPointBounds(polygon), radius);
        if (!rectContainsPoint(bounds, point)) return;
        const boardDepth = this.getPlacementBoardDepth(candidateHostKind, candidate);
        if (Number.isFinite(boardDepth)) foregroundDepth = Math.max(foregroundDepth, boardDepth + 75);
      };
      Object.entries(this.mapData.tiles || {}).forEach(([componentKey, tile]) => {
        visitPlacement('tile', componentKey, tile);
      });
      Object.entries(this.mapData.walls || {}).forEach(([componentKey, wall]) => {
        visitPlacement('wall', componentKey, wall);
      });
      return foregroundDepth;
    }

    setRuntimeSnapshotPlacement(componentKey, placement) {
      if (!componentKey || !placement || !this.mechanismRuntimeSnapshot) return;
      this.mechanismRuntimeSnapshot = {
        ...this.mechanismRuntimeSnapshot,
        placements: {
          ...(this.mechanismRuntimeSnapshot.placements || {}),
          [componentKey]: placement
        }
      };
    }

    applyMechanismRuntimePlacementTransforms(assembly, fixedAxisEntry, angle = 0) {
      if (!assembly || !fixedAxisEntry) return;
      const fixedMount = fixedAxisEntry.fixedMount || fixedAxisEntry.fixedAxis || fixedAxisEntry;
      const anchorWorld = fixedAxisEntry.pivotWorld || fixedAxisEntry.anchor || getFixedAxisWorldAnchor(this.mapData, fixedMount);
      const fixedPlacement = fixedMount?.componentKey
        ? (fixedAxisEntry.basePlacements?.[fixedMount.componentKey]
          || this.mapData.tiles?.[fixedMount.componentKey]
          || this.mapData.walls?.[fixedMount.componentKey])
        : null;
      (assembly.componentKeys || []).forEach((componentKey) => {
        const placement = fixedAxisEntry.basePlacements?.[componentKey]
          || this.mapData.tiles?.[componentKey]
          || this.mapData.walls?.[componentKey];
        if (!placement) return;
        const runtimePlacement = getRuntimePlacementForFixedAxisAssemblyMember({
          placement,
          componentKey,
          fixedMount,
          fixedPlacement,
          pivotWorld: anchorWorld,
          degrees: angle
        });
        this.setRuntimeSnapshotPlacement(componentKey, runtimePlacement);
        const runtimeProjection = this.getRuntimePlacementScreenPoint(runtimePlacement);
        if (placement.edge) {
          const wallObject = this.renderObjects.get(`wall:${componentKey}`);
          if (wallObject) {
            wallObject.setPosition(runtimeProjection.x, runtimeProjection.y);
            wallObject.setAngle?.(0);
            this.setBoardTexture(wallObject, this.textureCache.getWallTexture(
              placement.panelType,
              runtimePlacement.edge || placement.edge,
              this.getEffectiveWallViewMode(),
              this.cameraState.yaw,
              getWallSurfaceRotation(runtimePlacement),
              this.getWallMiterProfile(runtimePlacement),
              getTransmissionSurfaceRotation(runtimePlacement)
            ));
          }
          this.redrawMountedGearHostLayers('wall', componentKey, runtimePlacement, wallObject?.depth ?? null, placement);
          this.redrawVerticalStructureOverlay('wall', componentKey, runtimePlacement, wallObject?.depth ?? null);
          return;
        }

        const tileObject = this.renderObjects.get(`tile:${componentKey}`);
        if (tileObject) {
          tileObject.setPosition(runtimeProjection.x, runtimeProjection.y);
          tileObject.setAngle?.(0);
          this.setBoardTexture(tileObject, this.textureCache.getTileTexture(
            placement.panelType,
            runtimePlacement.rotation || 0,
            this.cameraState.yaw,
            getTransmissionSurfaceRotation(runtimePlacement),
            { isVertical: !!runtimePlacement.isVertical }
          ));
        }
        const label = this.renderObjects.get(`tile-label:${componentKey}`);
        if (label) {
          label.setPosition(runtimeProjection.x, runtimeProjection.y + 2);
          label.setAngle?.(0);
        }
        const mechanism = this.renderObjects.get(`mechanism:${componentKey}`);
        if (mechanism) {
          mechanism.setPosition(runtimeProjection.x, runtimeProjection.y);
          mechanism.setAngle?.(0);
        }
        this.redrawMountedGearHostLayers('tile', componentKey, runtimePlacement, tileObject?.depth ?? null, placement);
        this.redrawVerticalStructureOverlay('tile', componentKey, runtimePlacement, tileObject?.depth ?? null);
      });
      if (this.mechanicalLinkLayer && this.mechanicalPortLayer) drawMechanicalLayers(this);
      if (this.selectionLayer) this.drawSelectionLayer();
      if (this.gearBindingCandidateLayer) this.drawGearBindingCandidates();
      this.sortMapLayer();
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
          drawMechanicalLayers(this);
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
      drawMechanicalLayers(this);
      this.drawRouteLayer();
      this.drawHelperLayer();
      this.drawSelectionLayer();
      this.drawGearBindingCandidates();
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
      if (!isCityChannelPlacementVisible(tile, { mapData: this.mapData, visibleLayerCutoff: this.visibleLayerCutoff })) {
        this.removeTileObject(tile);
        return;
      }
      const key = createCellKey(tile.x, tile.y, tile.z);
      const runtimeTile = this.getRuntimePlacement(key, tile);
      this.removeTileObject(tile);
      const cell = { x: runtimeTile.x, y: runtimeTile.y, z: runtimeTile.z };
      const projection = this.getRuntimePlacementScreenPoint(runtimeTile);
      const texture = this.textureCache.getTileTexture(
        tile.panelType,
        runtimeTile.rotation || 0,
        this.cameraState.yaw,
        getTransmissionSurfaceRotation(runtimeTile),
        { isVertical: !!runtimeTile.isVertical }
      );
      const image = this.configureBoardImage(this.add.image(projection.x, projection.y, texture)
        .setOrigin(0.5, 0.57)
        .setAlpha(tile.transparent ? 0.72 : 1));
      const isPortal = isPortalMaterial(tile.panelType);
      const depth = getPlacementDepth({
        cell,
        partType: isPortal ? 'portal_body' : tile.isVertical ? 'wall_plane' : 'floor_base',
        physicalLayer: isPortal ? 'portal_body' : tile.isVertical ? 'wall_plane' : 'floor_base',
        rotation: runtimeTile.rotation || 0,
        cameraYaw: this.cameraState.yaw,
        mapData: this.mapData
      });
      image.setData('placementId', `tile:${key}`);
      image.setData('kind', 'tile');
      image.depth = depth;
      this.mapLayer.add(image);
      this.renderObjects.set(`tile:${key}`, image);
      this.redrawMountedGearHostLayers('tile', key, runtimeTile, depth, tile);
      this.redrawVerticalStructureOverlay('tile', key, runtimeTile, depth);
      if (isTriggerMechanismTile(tile.panelType)) {
        const mechanism = this.createMechanismObject(runtimeTile, key, depth + 0.35);
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
      if (!isCityChannelPlacementVisible(wall, { mapData: this.mapData, visibleLayerCutoff: this.visibleLayerCutoff })) {
        this.removeWallObject(wall);
        return;
      }
      const key = createWallKey(wall.x, wall.y, wall.z, wall.edge);
      const runtimeWall = this.getRuntimePlacement(key, wall);
      this.removeRenderObject(id);
      const cell = { x: runtimeWall.x, y: runtimeWall.y, z: runtimeWall.z };
      const projection = this.getRuntimePlacementScreenPoint(runtimeWall);
      const miter = this.getWallMiterProfile(runtimeWall);
      const wallRotation = getWallSurfaceRotation(runtimeWall);
      const texture = this.textureCache.getWallTexture(wall.panelType, runtimeWall.edge || wall.edge, this.getEffectiveWallViewMode(), this.cameraState.yaw, wallRotation, miter, getTransmissionSurfaceRotation(runtimeWall));
      const image = this.configureBoardImage(this.add.image(projection.x, projection.y, texture).setOrigin(0.5, 0.57));
      image.setData('placementId', id);
      image.setData('kind', 'wall');
      image.depth = getPlacementDepth({
        cell,
        partType: 'wall_plane',
        physicalLayer: 'wall_plane',
        edge: runtimeWall.edge,
        rotation: wallRotation,
        cameraYaw: this.cameraState.yaw,
        mapData: this.mapData
      });
      this.mapLayer.add(image);
      this.renderObjects.set(id, image);
      this.redrawMountedGearHostLayers('wall', key, runtimeWall, image.depth, wall);
      this.redrawVerticalStructureOverlay('wall', key, runtimeWall, image.depth);
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
        const otherNormal = getGearSurfaceNormal(other, 'front');
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
      return createMechanismObjectForScene(this, Phaser, tile, key, depth);
    }

    drawMechanismState(tile, runtime, progress = 0, params = {}, cameraYaw = this.cameraState.yaw) {
      drawMechanismStateForScene(this, tile, runtime, progress, params, cameraYaw);
    }

    refreshMechanismVisuals() {
      refreshMechanismVisualsForScene(this);
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
      this.drawGearBindingCandidates();
      this.updateDebugText();
    }

    refreshTileSurfaceTexture(tile) {
      if (!tile) return;
      const key = createCellKey(tile.x, tile.y, tile.z);
      const object = this.renderObjects.get(`tile:${key}`);
      if (!object) return;
      this.setBoardTexture(object, this.textureCache.getTileTexture(
        tile.panelType,
        this.getRuntimePlacement(key, tile).rotation || 0,
        this.cameraState.yaw,
        getTransmissionSurfaceRotation(this.getRuntimePlacement(key, tile)),
        { isVertical: !!this.getRuntimePlacement(key, tile).isVertical }
      ));
      this.redrawMountedGearHostLayers('tile', key, this.getRuntimePlacement(key, tile), object.depth || 0, tile);
    }

    refreshWallSurfaceTexture(wall) {
      if (!wall) return;
      const key = createWallKey(wall.x, wall.y, wall.z, wall.edge);
      const object = this.renderObjects.get(`wall:${key}`);
      if (!object) return;
      const runtimeWall = this.getRuntimePlacement(key, wall);
      this.setBoardTexture(object, this.textureCache.getWallTexture(
        wall.panelType,
        runtimeWall.edge || wall.edge,
        this.getEffectiveWallViewMode(),
        this.cameraState.yaw,
        getWallSurfaceRotation(runtimeWall),
        this.getWallMiterProfile(runtimeWall),
        getTransmissionSurfaceRotation(runtimeWall)
      ));
      this.redrawMountedGearHostLayers('wall', key, runtimeWall, object.depth || 0, wall);
    }

    rotateTransmissionForPlacements(placements = [], direction = 'forward') {
      const changedPlacements = rotateTransmissionPlacementsInPlace(this.mapData, placements, direction);
      changedPlacements.forEach(({ kind, placement }) => {
        if (kind === 'wall') {
          this.refreshWallSurfaceTexture(placement);
          return;
        }
        this.refreshTileSurfaceTexture(placement);
      });

      if (changedPlacements.length <= 0) return false;
      this.mapData.safeRoute = [];
      this.mapRevision += 1;
      this.invalidateMechanicalGraph();
      this.index.rebuild(this.mapData);
      drawMechanicalLayers(this);
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
        const runtimeTile = this.getRuntimePlacement(createCellKey(tile.x, tile.y, tile.z), tile);
        this.setBoardTexture(object, this.textureCache.getTileTexture(
          tile.panelType,
          runtimeTile.rotation || 0,
          this.cameraState.yaw,
          getTransmissionSurfaceRotation(runtimeTile),
          { isVertical: !!runtimeTile.isVertical }
        ));
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
      if (Object.keys(this.mechanismRuntimeSnapshot?.placements || {}).length > 0) {
        this.renderMap({ full: true });
        this.refreshPointerStateAfterViewChange();
        this.refreshMechanismVisuals();
        this.notifyCamera({ force: true });
        return;
      }
      Object.values(this.mapData.tiles || {}).forEach((tile) => {
        const key = createCellKey(tile.x, tile.y, tile.z);
        const runtimeTile = this.getRuntimePlacement(key, tile);
        const object = this.renderObjects.get(`tile:${key}`);
        if (!object) return;
        const cell = { x: runtimeTile.x, y: runtimeTile.y, z: runtimeTile.z };
        const projection = this.getRuntimePlacementScreenPoint(runtimeTile);
        object.setPosition(projection.x, projection.y);
        object.setAngle?.(0);
        if (shouldRefreshTextures) {
          this.setBoardTexture(object, this.textureCache.getTileTexture(
            tile.panelType,
            runtimeTile.rotation || 0,
            this.cameraState.yaw,
            getTransmissionSurfaceRotation(runtimeTile),
            { isVertical: !!runtimeTile.isVertical }
          ));
        }
        const isPortal = isPortalMaterial(tile.panelType);
        const depth = getPlacementDepth({
          cell,
          partType: isPortal ? 'portal_body' : tile.isVertical ? 'wall_plane' : 'floor_base',
          physicalLayer: isPortal ? 'portal_body' : tile.isVertical ? 'wall_plane' : 'floor_base',
          rotation: runtimeTile.rotation || 0,
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
            const nextMechanism = this.createMechanismObject(runtimeTile, key, depth + 0.35);
            if (nextMechanism) {
              this.mapLayer.add(nextMechanism);
              this.renderObjects.set(`mechanism:${key}`, nextMechanism);
            }
          } else {
            mechanism.setPosition(projection.x, projection.y);
            mechanism.setAngle?.(0);
            mechanism.depth = depth + 0.35;
          }
        }
      });
      Object.values(this.mapData.walls || {}).forEach((wall) => {
        const key = createWallKey(wall.x, wall.y, wall.z, wall.edge);
        const runtimeWall = this.getRuntimePlacement(key, wall);
        const object = this.renderObjects.get(`wall:${key}`);
        if (!object) return;
        const cell = { x: runtimeWall.x, y: runtimeWall.y, z: runtimeWall.z };
        const projection = this.getRuntimePlacementScreenPoint(runtimeWall);
        object.setPosition(projection.x, projection.y);
        object.setAngle?.(0);
        if (shouldRefreshTextures) {
          this.setBoardTexture(object, this.textureCache.getWallTexture(
            wall.panelType,
            wall.edge,
            this.getEffectiveWallViewMode(),
            this.cameraState.yaw,
            getWallSurfaceRotation(runtimeWall),
            this.getWallMiterProfile(runtimeWall),
            getTransmissionSurfaceRotation(runtimeWall)
          ));
        }
        object.depth = getPlacementDepth({
          cell,
          partType: 'wall_plane',
          physicalLayer: 'wall_plane',
          edge: runtimeWall.edge,
          rotation: getWallSurfaceRotation(runtimeWall),
          cameraYaw: this.cameraState.yaw,
          mapData: this.mapData
        });
      });
      this.redrawAllMountedGearLayers();
      this.redrawAllVerticalStructureOverlays();
      this.sortMapLayer();
      this.refreshPointerStateAfterViewChange();
      this.refreshMechanismVisuals();
      drawMechanicalLayers(this);
      this.drawRouteLayer();
      this.drawHelperLayer();
      this.drawSelectionLayer();
      this.drawGearBindingCandidates();
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
      if (this.gearBindingCandidateLayer && (this.selectedGears.length === 1 || this.gearBindingConfirmPulse)) {
        this.drawGearBindingCandidates(time);
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

    handleCanvasDoubleClick(event) {
      if (this.inspectState || this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE) return;
      const pointer = this.createPointerFromCanvasEvent(event);
      const hitInfo = this.hitTest(pointer, { allowOutline: true });
      const hit = normalizeInspectableHit(hitInfo.hit);
      if (!hit || hit.type !== 'tile' || !isTriggerMechanismTile(hit.panelType)) return;
      event.preventDefault();
      event.stopPropagation();
      this.lastMechanismDown = null;
      this.pendingMechanicalPort = null;
      inspectHitTile(this, hit);
      drawMechanicalLayers(this);
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
      return getAbsoluteWallEdgeEndpoints(this.getVerticalSnapSupportCell(support), direction);
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
        const segment = getSupportAxisSegment(snap.support);
        if (!segment) return false;
        if (edge) {
          return sameAxisSegment(getAbsoluteWallEdgeEndpoints(cell, edge), segment);
        }
        if (snap.forceVerticalAxis) {
          // 竖直向上选项：板的竖直轴与支撑顶边轴共面即视为有结构支撑（不依赖当前 panelPose）。
          const supportRotation = snap.support?.kind === 'wall'
            ? wallEdgeToRotation(snap.support.placement?.edge || 'north')
            : (snap.support?.placement?.rotation || 0);
          const verticalSegment = getCellVerticalEndpoints(supportRotation).map((point) => ({
            x: (Number(cell.x) || 0) + point.x,
            y: (Number(cell.y) || 0) + point.y
          }));
          return sameAxisSegment(verticalSegment, segment);
        }
        if (snap.forcePerpendicularFloor) {
          // 前/后水平平放：邻格落在竖板顶边的紧邻格（同高 z+1）即视为受顶边支撑。
          if ((Number(cell.z) || 0) !== supportCell.z + 1) return false;
          const dxPerp = Math.abs((Number(cell.x) || 0) - supportCell.x);
          const dyPerp = Math.abs((Number(cell.y) || 0) - supportCell.y);
          return dxPerp + dyPerp === 1;
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
          sameAxisSegment(getAbsoluteWallEdgeEndpoints(cell, direction), segment)
        ));
      }
      if (snap.side === 'side' && edge && snap.direction) {
        if (snap.support?.kind === 'wall') {
          const vertex = getSupportAxisVertex(snap.support, snap.direction);
          return getAbsoluteWallEdgeEndpoints(cell, edge)
            .some((point) => sameAxisPoint(point, vertex));
        }
        return sameAxisSegment(
          getAbsoluteWallEdgeEndpoints(cell, edge),
          this.getVerticalSnapSupportEdgeSegment(snap.support, snap.direction)
        );
      }
      return false;
    }

    resolveVerticalSnapConnection(targetCell, support, snap = {}) {
      return resolveVerticalSnapConnectionForSupport({
        targetCell,
        support,
        snap,
        activeTileType: this.activeTileType,
        activeRotation: this.activeRotation,
        socketEpsilon: TRANSMISSION_SOCKET_EPSILON,
        getTransmissionSurfacePortPoint: (placement, port, forcedSurface) => this.getTransmissionSurfacePortPoint(placement, port, forcedSurface),
        getTransmissionSocketPoint: (placement, port, forcedSurface) => this.getTransmissionSocketPoint(placement, port, forcedSurface)
      });
    }

    getVerticalSupportConnectionCandidates(targetCell, primarySupport = null) {
      return getVerticalSupportConnectionCandidates({
        targetCell,
        primarySupport,
        supports: this.getVerticalSnapSupportEntries(),
        isSupportEligibleForSnap: (support) => this.isSupportEligibleForSnap(support)
      });
    }

    resolveBestVerticalSnapConnection(targetCell, primarySupport, snap = {}) {
      return resolveBestVerticalSnapConnectionForSupport({
        targetCell,
        primarySupport,
        snap,
        supports: this.getVerticalSnapSupportEntries(),
        isSupportEligibleForSnap: (support) => this.isSupportEligibleForSnap(support),
        resolveConnection: (cell, support, candidateSnap) => this.resolveVerticalSnapConnection(cell, support, candidateSnap)
      });
    }

    resolveFloorSnapConnection(targetCell, supportTile = null) {
      return resolveFloorSnapConnectionForMap({
        mapData: this.mapData,
        targetCell,
        supportTile,
        activeTileType: this.activeTileType,
        activeRotation: this.activeRotation,
        socketEpsilon: TRANSMISSION_SOCKET_EPSILON,
        getTransmissionSurfacePortPoint: (placement, port, forcedSurface) => this.getTransmissionSurfacePortPoint(placement, port, forcedSurface),
        getTransmissionSocketPoint: (placement, port, forcedSurface) => this.getTransmissionSocketPoint(placement, port, forcedSurface)
      });
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
      const offsetX = projection.x - TILE_RENDER_CENTER.x;
      const offsetY = projection.y - TILE_RENDER_CENTER.y;
      if (forcedSurface === 'wall' || placement.edge) {
        const rotation = getTransmissionSurfaceRotation(placement);
        const geometry = placement.edge
          ? createEdgeWallGeometry(this.cameraState.yaw, placement.edge, null, rotation)
          : createVerticalTileWallGeometry(this.cameraState.yaw, placement.rotation || 0, rotation);
        const transmissionPlane = getTransmissionMidPlane(geometry, 'wall');
        return this.getGhostBoardPoint(
          transmissionPlane,
          port.localPosition,
          0,
          offsetX,
          offsetY,
          'wall'
        );
      }
      const geometry = placement.isVertical
        ? createVerticalTileWallGeometry(this.cameraState.yaw, placement.rotation || 0, getTransmissionSurfaceRotation(placement))
        : createTileGeometry(this.cameraState.yaw, placement.rotation || 0);
      const surface = placement.isVertical ? 'wall' : 'floor';
      const transmissionPlane = getTransmissionPortPlane(geometry, surface);
      return this.getGhostBoardPoint(
        transmissionPlane,
        port.localPosition,
        placement.isVertical ? 0 : getTransmissionSurfaceRotation(placement),
        offsetX,
        offsetY,
        surface
      );
    }

    getVerticalTopSnapSpec(support) {
      return getVerticalTopSnapSpecForSupport({
        support,
        getTransmissionSocketPoint: (placement, port, forcedSurface) => this.getTransmissionSocketPoint(placement, port, forcedSurface),
        getTransmissionSurfacePortPoint: (placement, port, forcedSurface) => this.getTransmissionSurfacePortPoint(placement, port, forcedSurface)
      });
    }

    matchesAxisOptionPose(option, pose = 'floor') {
      if (!option) return false;
      // 竖放姿态匹配「竖直」朝向（wall 墙面 或 isVertical 竖直向上的 floor）；
      // 水平姿态匹配平放 floor（排除竖直向上的 isVertical floor）。
      return pose === 'wall'
        ? (option.kind === 'wall' || !!option.isVertical)
        : (option.kind === 'floor' && !option.isVertical);
    }

    getPreferredAxisPlacementIndex(options = []) {
      if (!options.length) return 0;
      const preferredIndex = options.findIndex((option) => (
        this.matchesAxisOptionPose(option, this.panelPose) && option.valid !== false
      ));
      return preferredIndex >= 0 ? preferredIndex : 0;
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
        : support.placement.isVertical
          ? createVerticalTileWallGeometry(this.cameraState.yaw, support.placement.rotation || 0)
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
      if (hitInfo?.hit?.gearSurfacePlane) {
        const bottomDistanceSquared = distancePointToSegmentSquared(localPoint, wall[0], wall[1]);
        if (bottomDistanceSquared < best.distanceSquared) return null;
        return best;
      }
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
      return !!(primaryPlacement?.isVertical || material?.isVertical || this.panelPose === 'wall');
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
        if (!isCityChannelPlacementVisible(tile, { mapData: this.mapData, visibleLayerCutoff: this.visibleLayerCutoff })) return;
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
        const axisKey = getSnapAxisKey(snap);
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
        axisEdge: getSupportPrimaryEdge(support),
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
        ? getSupportPrimaryEdge(support)
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
      return createStructuralSupportResolver({
        mapData: this.mapData,
        getVerticalSupportEntries: () => this.getVerticalSupportEntries()
      }).isSupportStructurallyGrounded(support, new Set());
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
              ? getSupportPrimaryEdge(support)
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
        const edge = getSupportPrimaryEdge(support);
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
        const edge = getSupportPrimaryEdge(support);
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
        if (allowReplacement && hitTile) {
          return {
            kind: 'floor',
            cell: { x: hitTile.x, y: hitTile.y, z: hitTile.z },
            valid: true,
            replace: true
          };
        }
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
        if (this.carryState?.kind === 'placement' && !directTile && hasTileSupportForMap({ mapData: this.mapData, cell })) {
          return { x: cell.x, y: cell.y, z: cell.z, layFlat: true };
        }
        return null;
      }
      if (directTile) return cell;
      return hasTileSupportForMap({ mapData: this.mapData, cell }) ? cell : null;
    }

    getAxisPlacementOptions(snap) {
      return getAxisPlacementOptionsForMap({
        mapData: this.mapData,
        snap,
        activeVerticalBoardPlacement: this.isActiveVerticalBoardPlacement(),
        resolveVerticalSnapConnection: (cell, support, snapSpec) => this.resolveVerticalSnapConnection(cell, support, snapSpec),
        hasVerticalSnapStructuralEdgeSupport: (cell, edge, snapSpec) => this.hasVerticalSnapStructuralEdgeSupport(cell, edge, snapSpec),
        isPlacementCellOccupiedForSnap: (cell) => this.isPlacementCellOccupiedForSnap(cell),
        isPlacementWallOccupiedForSnap: (cell, edge) => this.isPlacementWallOccupiedForSnap(cell, edge),
        getVerticalSnapSupportEdgeSegment: (support, direction) => this.getVerticalSnapSupportEdgeSegment(support, direction),
        getTransmissionSocketPoint: (placement, port, forcedSurface) => this.getTransmissionSocketPoint(placement, port, forcedSurface),
        getTransmissionSurfacePortPoint: (placement, port, forcedSurface) => this.getTransmissionSurfacePortPoint(placement, port, forcedSurface)
      });
    }

    getAxisPlacementTarget(snap) {
      const options = this.getAxisPlacementOptions(snap);
      return getAxisPlacementTargetFromOptions({ options, snapPlaneCycle: this.snapPlaneCycle || 0 });
    }

    getPlacementTargetKey(target) {
      if (!target?.cell) return '';
      const cellKey = createCellKey(target.cell.x, target.cell.y, target.cell.z);
      if (target.kind === 'wall') return `wall:${cellKey}:${target.edge || ''}`;
      return target.isVertical ? `vfloor:${cellKey}` : `floor:${cellKey}`;
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
        const nextSnapAxisKey = getSnapAxisKey(nextSnap);
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
      const verticalSurfaceSnap = this.resolveVerticalSurfaceSnap(hitInfo);
      if (!this.isWallPlacementActive() && this.isVerticalSurfaceHit(hitInfo?.hit)) {
        return verticalSurfaceSnap?.side === 'top' ? verticalSurfaceSnap : null;
      }
      return verticalSurfaceSnap || this.resolveVerticalGapFloorSnap(hitInfo);
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
      return !!this.mapData.walls?.[key] || isWallPhysicalPlaneOccupied({ mapData: this.mapData, cell, edge });
    }

    resolveDynamicPlacementTarget(hitInfo, { forGhost = false, snap: suppliedSnap = undefined, allowReplacement = false } = {}) {
      const snap = suppliedSnap === undefined ? this.resolvePlacementEdgeSnap(hitInfo) : suppliedSnap;
      if (snap) {
        const axisTarget = this.getAxisPlacementTarget(snap);
        if (axisTarget?.cell) return axisTarget;
        if (allowReplacement && this.isWallPlacementActive()) {
          const wallTarget = this.resolveWallGhostTarget(hitInfo, { allowReplacement: true });
          if (wallTarget?.replace) {
            return {
              kind: 'wall',
              cell: wallTarget.cell,
              edge: wallTarget.edge,
              valid: true,
              replace: true,
              connection: wallTarget.connection || null
            };
          }
        }
        return null;
      }
      if (!snap && this.isWallPlacementActive()) {
        const wallTarget = forGhost
          ? this.resolveWallGhostTarget(hitInfo, { allowReplacement })
          : this.resolveWallPlacementTarget(hitInfo, { allowReplacement });
        if (wallTarget?.blocked) return null;
        if (!wallTarget?.cell) return null;
        const gearBlocked = doesGearBlockWallForMap({
          mapData: this.mapData,
          cell: wallTarget.cell,
          edge: wallTarget.edge
        });
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
      const isGearCarryActive = this.carryState?.kind === 'gear';
      const portHit = this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE || this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT
        ? null
        : getMechanicalPortHit({ mapData: this.mapData, cameraYaw: this.cameraState.yaw, zoom: this.cameraState.zoom, visibleLayerCutoff: this.visibleLayerCutoff, localPoint });
      const canHitMountedGear = (
        !isGearCarryActive
        && (
          this.activeTool === CITY_CHANNEL_TOOLS.BROWSE
          || this.activeTool === CITY_CHANNEL_TOOLS.SELECT
          || (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && this.selectedGears.length > 0)
        )
      );
      const rawGearHit = canHitMountedGear ? getCityChannelGearHit({
        mapData: this.mapData,
        cameraYaw: this.cameraState.yaw,
        zoom: this.cameraState.zoom,
        visibleLayerCutoff: this.visibleLayerCutoff,
        localPoint,
        getGearMountPoint: (placement, mount) => this.getGearMountPoint(placement, mount)
      }) : null;
      const gearHit = this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && rawGearHit && !this.isSelectedGearHit(rawGearHit)
        ? null
        : rawGearHit;
      const canHitGearBindingCandidate = (
        !isGearCarryActive
        && (
          this.activeTool === CITY_CHANNEL_TOOLS.BROWSE
          || this.activeTool === CITY_CHANNEL_TOOLS.SELECT
          || (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && this.selectedGears.length === 1)
        )
      );
      const gearBindingHit = canHitGearBindingCandidate && !this.isSelectedGearHit(gearHit)
        ? this.getGearBindingCandidateHit(localPoint)
        : null;
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
        if (!tile || seenCandidates.has(key) || !isCityChannelPlacementVisible(tile, { mapData: this.mapData, visibleLayerCutoff: this.visibleLayerCutoff })) return;
        if (this.isCarryMovingPlacement(tile)) return;
        seenCandidates.add(key);
        candidates.push({ kind: 'tile', cell: candidate, tile });
      };
      const addWallCandidate = (candidate, wall, candidateEdge = wall?.edge) => {
        const key = `wall:${createWallKey(candidate.x, candidate.y, candidate.z, candidateEdge)}`;
        if (!wall || seenCandidates.has(key) || !isCityChannelPlacementVisible(wall, { mapData: this.mapData, visibleLayerCutoff: this.visibleLayerCutoff })) return;
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

      const hits = [portHit, gearHit, gearBindingHit].filter(Boolean);
      candidates.forEach((candidate) => {
        const projection = projectCell(candidate.cell, this.cameraState.yaw, this.mapData);
        const point = {
          x: localPoint.x - projection.x + (TILE_RENDER_WIDTH * 0.5),
          y: localPoint.y - projection.y + (TILE_RENDER_HEIGHT * 0.57)
        };
        if (candidate.kind === 'wall') {
          const geometry = createEdgeWallGeometry(this.cameraState.yaw, candidate.wall.edge, this.getWallMiterProfile(candidate.wall));
          const visibleSurfaceSide = getVisibleGearSurfaceSide(candidate.wall, this.cameraState.yaw);
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

        const geometry = candidate.tile.isVertical
          ? createVerticalTileWallGeometry(this.cameraState.yaw, candidate.tile.rotation || 0, getTransmissionSurfaceRotation(candidate.tile))
          : createTileGeometry(this.cameraState.yaw, candidate.tile.rotation || 0);
        const floorPolygons = candidate.tile.isVertical
          ? []
          : [geometry.top, ...(geometry.sides || [])].filter((polygon) => Array.isArray(polygon) && polygon.length >= 3);
        const inTopFace = !candidate.tile.isVertical && pointInPolygon(point, geometry.top);
        const inTile = floorPolygons.some((polygon) => pointInPolygon(point, polygon));
        const isPortal = isPortalMaterial(candidate.tile.panelType);
        const inPortal = isPortal && getPortalPolygons(this.cameraState.yaw, candidate.tile.rotation || 0)
          .some((polygon) => pointInPolygon(point, polygon));
        const visibleVerticalSurfaceSide = candidate.tile.isVertical ? getVisibleGearSurfaceSide(candidate.tile, this.cameraState.yaw) : 'front';
        const visibleVerticalPlane = visibleVerticalSurfaceSide === 'back'
          ? (geometry.wallBack || geometry.wall)
          : (geometry.wallFront || geometry.wall);
        const verticalVisiblePolygons = candidate.tile.isVertical
          ? [
            visibleVerticalPlane,
            geometry.wallCap,
            geometry.wallSideStart,
            geometry.wallSideEnd
          ].filter((polygon) => Array.isArray(polygon) && polygon.length >= 3)
          : [];
        const inVisibleVertical = candidate.tile.isVertical
          && verticalVisiblePolygons.some((polygon) => pointInPolygon(point, polygon));
        const inVerticalWallPlane = candidate.tile.isVertical && pointInPolygon(point, visibleVerticalPlane);
        const verticalSurfacePolygons = candidate.tile.isVertical
          ? [
            geometry.wall,
            geometry.wallBack || geometry.wall,
            geometry.wallCap,
            geometry.wallSideStart,
            geometry.wallSideEnd
          ].filter((polygon) => Array.isArray(polygon) && polygon.length >= 3)
          : [];
        const inVerticalSelectionFallback = needsOcclusionCandidates
          && candidate.tile.isVertical
          && verticalSurfacePolygons.some((polygon) => pointInPolygon(point, polygon));
        const inVertical = isPortal
          ? inPortal
          : needsVisibleSurfaceHit
            ? (inVisibleVertical || inVerticalSelectionFallback)
            : candidate.tile.isVertical && verticalSurfacePolygons.some((polygon) => pointInPolygon(point, polygon));
        const verticalSurfaceBounds = candidate.tile.isVertical
          ? expandRect(getPointBounds(verticalSurfacePolygons.flat()), 10)
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

    triggerMechanismFromHit(hit) {
      return triggerMechanismFromSceneHit(this, hit);
    }

    triggerMechanismAtCell(cell, paramsOverride = null) {
      return triggerMechanismAtSceneCell(this, cell, paramsOverride);
    }

    requestMechanismPanel(hit) {
      requestMechanismPanelForScene(this, hit);
    }

    playPreviewAnimation(cell, paramsOverride = null) {
      return playMechanismPreviewAnimation(this, cell, paramsOverride);
    }

    handlePointerDown(pointer) {
      if (this.inspectState) {
        if (pointer.rightButtonDown()) {
          closeInspectMode(this);
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
      this.cancelMechanismRuntimePreview();
      const hit = this.hitTest(pointer, {
        allowOutline: this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && !!this.activeTileType
      });
      const normalizedHit = normalizeInspectableHit(hit.hit);
      if (
        (this.activeTool === CITY_CHANNEL_TOOLS.BROWSE || this.activeTool === CITY_CHANNEL_TOOLS.SELECT)
        && isDoubleClickMechanismHit(this, pointer, normalizedHit)
      ) {
        this.dragState = null;
        inspectHitTile(this, normalizedHit);
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
        if (this.isSelectedGearHit(normalizedHit)) {
          this.beginSelectedMoveHold(pointer, { ...hit, hit: normalizedHit }, { canBoxSelect: false });
          return;
        }
        if (hit.hit?.type === 'gearBindingCandidate') {
          this.dragState = {
            mode: 'click',
            startX: pointer.x,
            startY: pointer.y,
            lastX: pointer.x,
            lastY: pointer.y,
            moved: false,
            shiftKey: false,
            hit,
            canBoxSelect: false
          };
          return;
        }
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
      this.beginPointerClickDrag(pointer, { ...hit, hit: normalizedHit }, {
        canBoxSelect,
        enableHoldMove: selected
      });
    }

    beginPointerClickDrag(pointer, hitInfo, { canBoxSelect = false, enableHoldMove = false } = {}) {
      const normalizedHit = normalizeInspectableHit(hitInfo?.hit);
      if (normalizedHit || hitInfo?.cell) {
        this.hoverCell = hitInfo?.cell || normalizedHit?.cell || this.hoverCell;
        this.hoverEdge = hitInfo?.edge || normalizedHit?.edge || this.hoverEdge;
        this.hoverTarget = {
          key: this.hoverTarget?.key || 'pointer-down',
          hit: normalizedHit,
          localPoint: hitInfo?.localPoint || normalizedHit?.point || null
        };
      }
      this.dragState = {
        mode: canBoxSelect && !normalizedHit ? 'box' : 'click',
        startX: pointer.x,
        startY: pointer.y,
        lastX: pointer.x,
        lastY: pointer.y,
        moved: false,
        shiftKey: pointer.event?.shiftKey,
        hit: { ...hitInfo, hit: normalizedHit },
        canBoxSelect
      };
      if (!enableHoldMove) return;
      this.longPressTimer = setTimeout(() => {
        if (!this.dragState || this.dragState.moved) return;
        this.startCarry(normalizedHit || null);
        this.dragState.mode = 'carry';
        this.dragState.skipCarryCommitOnRelease = true;
        this.longPressTimer = null;
      }, SELECTED_MOVE_HOLD_DELAY);
    }

    beginSelectedMoveHold(pointer, hitInfo, options = {}) {
      this.beginPointerClickDrag(pointer, hitInfo, {
        ...options,
        enableHoldMove: true
      });
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
          refreshInspectPreview(this);
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
      const hit = { ...rawHit, hit: normalizeInspectableHit(rawHit.hit) };
      if (hit.hit?.type === 'gearBindingCandidate') {
        this.selectHit(hit.hit, false);
        return;
      }
      if (this.activeTool === CITY_CHANNEL_TOOLS.SELECT || this.activeTool === CITY_CHANNEL_TOOLS.BROWSE) {
        if (hit.hit) {
          if (hit.hit.type !== 'gearBindingCandidate' && this.triggerMechanismFromHit(hit.hit)) return;
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
        closeInspectMode(this);
        return;
      }
      this.cancelMechanismRuntimePreview();
      const hit = this.hitTest(pointer, { allowOutline: true });
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
        drawMechanicalLayers(this);
        return;
      }
      if (this.selectedCells.length || this.selectedWalls.length || this.selectedGears.length) {
        this.setSelection([], [], [], null);
        return;
      }
      if (this.activeTool === CITY_CHANNEL_TOOLS.BROWSE) return;
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType) {
        this.config.onExitPlaceMode?.();
        return;
      }
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && this.activeComponentType) {
        this.config.onExitPlaceMode?.();
        return;
      }
      this.eraseHit(hit);
    }

    handleWheel(pointer, gameObjects, deltaX, deltaY) {
      if (this.inspectState) return;
      const shiftHeld = !!pointer?.event?.shiftKey;
      const isCarryPlacement = this.carryState?.kind === 'placement';
      if (isCarryPlacement && shiftHeld) {
        this.cancelMechanismRuntimePreview();
        const direction = deltaY < 0 ? 'forward' : 'reverse';
        this.rotateCarryPlacementSurface(direction);
        return;
      }
      if (!isCarryPlacement && shiftHeld && (this.selectedCells.length || this.selectedWalls.length)) {
        this.cancelMechanismRuntimePreview();
        const direction = deltaY < 0 ? 'forward' : 'reverse';
        const placements = [...this.selectedCells, ...this.selectedWalls].map((placement) => ({ ...placement }));
        this.rotateTransmissionForPlacements(placements, direction);
        this.config.onRotateSelection?.(direction, { alreadyPreviewed: true, placements });
        return;
      }
      if (!isCarryPlacement && shiftHeld && this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType) {
        this.cancelMechanismRuntimePreview();
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
        if (this.isCarryForcedHorizontal()) {
          this.config.onHoverStatusChange?.('移动预览：入口/出口固定为平放');
          this.drawGhostLayer(true);
          return true;
        }
        const origins = this.carryState.origins || [];
        if (origins.length === 1 && this.getCarryAxisOptions()?.axisKey) {
          return this.cycleCarrySnapAxisRotation();
        }
        this.toggleCarryDefaultPose();
        return true;
      }
      if (!(this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType)) return false;
      if (this.isFixedHorizontalPlacementType(this.activeTileType)) {
        if (this.panelPose !== 'floor') this.setPlacementPose('floor');
        this.config.onHoverStatusChange?.('放置预览：入口/出口固定为平放');
        this.drawGhostLayer(true);
        return true;
      }
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
      const snapAxisKey = getSnapAxisKey(snap);
      if (snapAxisKey) {
        // 存在吸附轴：统一走 cycleActivePlacementSnapAxis 沿轴轮询可拼接方向。
        return this.cycleActivePlacementSnapAxis();
      }
      const nextPose = this.panelPose === 'wall' ? 'floor' : 'wall';
      this.setPlacementPose(nextPose);
      this.config.onHoverStatusChange?.(nextPose === 'wall' ? '放置预览：切换为竖放' : '放置预览：切换为平放');
      this.updateHover(hitInfo);
      this.drawGhostLayer(true);
      return true;
    }

    cycleActivePlacementSnapAxis() {
      if (!(this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType)) return false;
      const hitInfo = this.getActivePointerPlacementHitInfo();
      const snap = this.resolvePlacementEdgeSnap(hitInfo);
      const snapAxisKey = getSnapAxisKey(snap);
      if (!snapAxisKey) {
        this.config.onHoverStatusChange?.('放置预览：当前没有可旋转的吸附轴');
        this.drawGhostLayer(true);
        return true;
      }
      const allOptions = this.getAxisPlacementOptions(snap).filter((option) => option?.valid !== false);
      // 吸附轮询按当前姿态分组：水平姿态只在平放方向间轮询，竖直姿态只在竖直/墙面方向间轮询。
      // 上边沿吸附时，竖直方向仅「向上」一个，故竖放姿态下按 Space 不切换（与离开吸附后切姿态的逻辑互补）。
      const options = allOptions.filter((option) => this.matchesAxisOptionPose(option, this.panelPose));
      const currentTarget = snapAxisKey === this.activeSnapAxisKey
        ? this.resolveDynamicPlacementTarget(hitInfo, { forGhost: true, snap, allowReplacement: false })
        : null;
      let currentIndex = getAxisOptionIndex(options, currentTarget);
      if (options.length <= 1) {
        if (options.length === 1 && currentIndex < 0) {
          this.activeSnapAxisKey = snapAxisKey;
          const target = options[0];
          const targetIndex = getAxisOptionIndexInAllOptions(allOptions, target);
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
        currentIndex = getAxisOptionIndex(options, preferredTarget);
      } else if (currentIndex < 0 && allOptions.length > 0) {
        const cycleIndex = (((this.snapPlaneCycle || 0) % allOptions.length) + allOptions.length) % allOptions.length;
        currentIndex = getAxisOptionIndex(options, allOptions[cycleIndex]);
      } else if (currentIndex >= 0) {
        const currentAllIndex = getAxisOptionIndexInAllOptions(allOptions, options[currentIndex]);
        if (currentAllIndex >= 0) this.snapPlaneCycle = currentAllIndex;
      }
      if (currentIndex < 0) currentIndex = 0;
      const target = options[((currentIndex + 1) % options.length + options.length) % options.length] || options[0];
      const targetIndex = getAxisOptionIndexInAllOptions(allOptions, target);
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
          closeInspectMode(this);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        this.cancelMechanismRuntimePreview();
        this.config.onUndo?.();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault();
        this.cancelMechanismRuntimePreview();
        this.config.onRedo?.();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'c') {
        const hasBoardSelection = (this.selectedCells.length + this.selectedWalls.length) > 0
          && this.selectionScope !== 'component';
        if (!this.carryState && hasBoardSelection) {
          event.preventDefault();
          this.cancelMechanismRuntimePreview();
          const handled = this.config.onCopySelection?.();
          if (handled !== false) return;
          this.startCopyCarry();
          return;
        }
      }
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        this.cancelMechanismRuntimePreview();
        this.config.onDeleteSelection?.();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        this.cancelMechanismRuntimePreview();
        if (this.handleSpaceSurfaceToggle()) return;
      }
      if (key === 'r') {
        event.preventDefault();
        this.cancelMechanismRuntimePreview();
        if (this.handleRotateSurface()) return;
      }
      if (key === 'm') {
        event.preventDefault();
        this.cancelMechanismRuntimePreview();
        this.startCarry();
        return;
      }
      if (key === 'escape') {
        this.cancelMechanismRuntimePreview();
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
        drawMechanicalLayers(this);
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
      const snapAxisKey = getSnapAxisKey(placementSnap);
      if (snapAxisKey !== this.activeSnapAxisKey) {
        this.activeSnapAxisKey = snapAxisKey;
        this.snapPlaneCycle = snapAxisKey
          ? this.getPreferredAxisPlacementIndex(this.getAxisPlacementOptions(placementSnap))
          : 0;
      }
      const dynamicPlacementTarget = isPlacingTile
        ? this.resolveDynamicPlacementTarget(hitInfo, { forGhost: true, snap: placementSnap, allowReplacement: true })
        : null;
      const effectiveCell = dynamicPlacementTarget?.cell || hitInfo.cell;
      const effectiveEdge = dynamicPlacementTarget?.edge || hitInfo.edge;
      const effectiveCellKey = effectiveCell ? createCellKey(effectiveCell.x, effectiveCell.y, effectiveCell.z) : '';
      const nextKey = hitInfo.hit
        ? hitInfo.hit.type === 'gearBindingCandidate'
          ? `${hitInfo.hit.type}:${hitInfo.hit.hostKey}:${hitInfo.hit.mountId}:${hitInfo.hit.candidate?.hostKind || 'tile'}:${hitInfo.hit.candidate?.componentKey || ''}:${hitInfo.hit.candidate?.socket || ''}:${hitInfo.hit.candidate?.surface || 'front'}`
          : `${hitInfo.hit.type}:${createCellKey(hitInfo.hit.cell.x, hitInfo.hit.cell.y, hitInfo.hit.cell.z)}:${hitInfo.hit.edge || ''}:${hitInfo.hit.hitZone}:${effectiveCellKey}:${effectiveEdge || ''}`
        : (effectiveCell ? `cell:${effectiveCellKey}:${effectiveEdge || ''}:${dynamicPlacementTarget?.kind || ''}` : '');
      this.input?.setDefaultCursor?.(hitInfo.hit?.type === 'gearBindingCandidate' ? 'pointer' : 'default');
      if (this.hoverTarget?.key === nextKey) {
        this.hoverTarget = { ...this.hoverTarget, localPoint: hitInfo.localPoint };
        this.hoverCell = effectiveCell;
        this.hoverEdge = effectiveEdge;
        return;
      }
      this.hoverTarget = { key: nextKey, hit: hitInfo.hit, localPoint: hitInfo.localPoint };
      this.hoverCell = effectiveCell;
      this.hoverEdge = effectiveEdge;
      drawMechanicalLayers(this);
      if (this.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.activeTileType) {
        const material = resolveMaterialName(this.activeTileType);
        const pose = dynamicPlacementTarget
          ? (dynamicPlacementTarget.kind === 'wall' ? '竖放' : '平放')
          : (this.isWallPlacementActive() ? '竖放' : '平放');
        this.config.onHoverStatusChange?.(
          effectiveCell
            ? this.isFixedHorizontalPlacementType(this.activeTileType)
              ? `${material}｜平放｜${this.activeRotation}°｜R旋转（Space已锁定平放）`
              : `${material}｜${pose}｜${this.activeRotation}°｜R旋转 Space切吸附位`
            : `${material}｜未指向通道`
        );
        this.drawGearBindingCandidates();
        return;
      }
      if (hitInfo.hit) {
        if (hitInfo.hit.type === 'gearBindingCandidate') {
          const current = this.getSelectedCornerGearBindingContext()?.mount?.axisBinding || null;
          const candidate = hitInfo.hit.candidate;
          const sameBinding = current
            && this.isSameGearBindingCandidate(current, candidate);
          this.config.onHoverStatusChange?.(sameBinding ? '点击取消该板材联动' : '点击绑定该板材联动');
          this.drawGearBindingCandidates();
          return;
        }
        if (hitInfo.hit.type === 'mechanical_port') {
          const port = hitInfo.hit.port;
          this.config.onHoverStatusChange?.(`${port.label}｜${port.kind}｜${(port.mediums || []).join('/')}`);
          this.drawSelectionLayer();
          this.drawGearBindingCandidates();
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
      this.drawGearBindingCandidates();
      this.refreshMechanismVisuals();
    }

    beginPaint(pointer, hitInfo) {
      beginPaintForScene(this, pointer, hitInfo);
    }

    applyPaint(pointer, suppliedHitInfo = null) {
      applyPaintForScene(this, pointer, suppliedHitInfo);
    }

    commitPaint() {
      commitPaintForScene(this);
    }

    eraseHit(hitInfo) {
      eraseHitForScene(this, hitInfo);
    }

    selectHit(hit, additive = false) {
      selectHitForScene(this, hit, additive);
    }

    setSelection(cells, walls, gears = [], scope = null, { lockExternalSync = false } = {}) {
      setSelectionForScene(this, cells, walls, gears, scope, { lockExternalSync });
    }

    applySelectionScopeVisualState() {
      applySelectionScopeVisualStateForScene(this);
    }

    isSelectedHit(hit) {
      return isSelectedHitForScene(this, hit);
    }

    isSelectedGearHit(hit = null) {
      return hit?.type === 'gear'
        && this.selectedGears.some((gear) => (
          gear.hostKind === hit.hostKind
          && gear.hostKey === hit.hostKey
          && gear.mountId === hit.mount?.id
        ));
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
        this.redrawAllMountedGearLayers();
        this.drawGearBindingCandidates();
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
      if (this.isFixedHorizontalPlacementType(source?.panelType)) return 'floor';
      if (this.carryState?.defaultPose === 'wall' || this.carryState?.defaultPose === 'floor') {
        return this.carryState.defaultPose;
      }
      return source?.edge || source?.isVertical ? 'wall' : 'floor';
    }

    isCarryForcedHorizontal() {
      if (this.carryState?.kind !== 'placement') return false;
      const placement = this.getCarryPrimaryPlacement();
      return this.isFixedHorizontalPlacementType(placement?.panelType);
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
      if (this.isFixedHorizontalPlacementType(placement?.panelType)) {
        return {
          ...target,
          edge: undefined,
          rotation: surfaceRotation,
          layFlat: true
        };
      }
      if (target.isVertical) {
        // 竖直向上：占自身格但竖直绘制，不挂到边沿。
        return {
          ...target,
          edge: undefined,
          isVertical: true,
          layFlat: false,
          rotation: surfaceRotation
        };
      }
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
      if (this.isCarryForcedHorizontal()) {
        this.config.onHoverStatusChange?.('移动预览：入口/出口固定为平放');
        this.drawGhostLayer(true);
        return true;
      }
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
        const geometry = placement.edge
          ? createEdgeWallGeometry(this.cameraState.yaw, placement.edge, this.getWallMiterProfile(placement), getTransmissionSurfaceRotation(placement))
          : placement.isVertical
            ? createVerticalTileWallGeometry(this.cameraState.yaw, placement.rotation || 0, getTransmissionSurfaceRotation(placement))
            : createTileGeometry(this.cameraState.yaw, placement.rotation || 0);
        const polygons = placement.edge || placement.isVertical
          ? [geometry.wall, geometry.wallFront, geometry.wallBack, geometry.wallCap, geometry.wallSideStart, geometry.wallSideEnd]
          : [geometry.top, ...(geometry.sides || [])];
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
        const axisKey = getSnapAxisKey(snap);
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
        const axisKey = getSnapAxisKey(snap);
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
      // 与新放置一致：按当前默认姿态分组轮询。上边沿吸附时竖直方向仅「向上」一个，
      // 故竖放姿态下按 Space 不切换（用户离开吸附后再用 Space 切换姿态）。
      const options = allOptions.filter((option) => this.matchesAxisOptionPose(option, this.getCarryDefaultPose()));
      let currentIndex = getAxisOptionIndex(options, this.carryState.axisTarget);
      if (
        currentIndex < 0
        && this.carryState.snapAxisKey === result.axisKey
        && allOptions.length > 0
      ) {
        const cycleIndex = (((this.carryState.snapPlaneCycle || 0) % allOptions.length) + allOptions.length) % allOptions.length;
        currentIndex = getAxisOptionIndex(options, allOptions[cycleIndex]);
      }
      if (options.length <= 1) {
        if (options.length === 1 && currentIndex < 0) {
          this.carryState.snapAxisKey = result.axisKey;
          const target = options[0];
          const targetIndex = getAxisOptionIndexInAllOptions(allOptions, target);
          this.carryState.snapPlaneCycle = targetIndex >= 0 ? targetIndex : 0;
          this.carryState.axisTarget = this.buildCarryAxisTarget(target);
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
        currentIndex = getAxisOptionIndex(options, preferredTarget);
      } else if (currentIndex >= 0) {
        const currentAllIndex = getAxisOptionIndexInAllOptions(allOptions, options[currentIndex]);
        if (currentAllIndex >= 0) this.carryState.snapPlaneCycle = currentAllIndex;
      }
      if (currentIndex < 0) currentIndex = 0;
      const target = options[((currentIndex + 1) % options.length + options.length) % options.length] || options[0];
      const targetIndex = getAxisOptionIndexInAllOptions(allOptions, target);
      this.carryState.snapPlaneCycle = targetIndex >= 0 ? targetIndex : 0;
      this.carryState.axisTarget = this.buildCarryAxisTarget(target);
      this.carryState.manualSurfaceTarget = false;
      this.config.onHoverStatusChange?.('移动预览：沿当前吸附轴旋转到下一个空位');
      this.drawGhostLayer(true);
      return true;
    }

    buildCarryAxisTarget(target) {
      if (!target?.cell) return null;
      const base = { x: target.cell.x, y: target.cell.y, z: target.cell.z };
      if (target.kind === 'wall') return { ...base, edge: target.edge };
      // 竖直向上：竖直占位（不平放）；否则按平放处理。
      if (target.isVertical) return { ...base, isVertical: true, layFlat: false };
      return { ...base, layFlat: true };
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
      const host = gear.hostKind === 'wall' ? this.mapData.walls?.[gear.hostKey] : this.mapData.tiles?.[gear.hostKey];
      return host ? this.getRuntimePlacement(gear.hostKey, host) : null;
    }

    getGearBindingCandidatePlacement(candidate = {}) {
      if (!candidate?.componentKey) return null;
      const placement = candidate.hostKind === 'wall'
        ? this.mapData.walls?.[candidate.componentKey]
        : this.mapData.tiles?.[candidate.componentKey];
      return placement ? this.getRuntimePlacement(candidate.componentKey, placement) : null;
    }

    getGearBindingSurfacesForPlacement(placement = null) {
      if (!placement) return [];
      return hasDirectionalGearSurface(placement.panelType) && (placement.edge || placement.isVertical)
        ? ['front', 'back']
        : ['front'];
    }

    isSameGearWorldPoint(a = null, b = null, epsilon = 0.008) {
      return !!a && !!b
        && Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) <= epsilon
        && Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) <= epsilon
        && Math.abs((Number(a.z) || 0) - (Number(b.z) || 0)) <= epsilon;
    }

    getGearBindingCandidatesForPivot({ pivotWorld = null } = {}) {
      if (!pivotWorld) return [];
      const candidates = [];
      const appendPlacementCandidates = (hostKind, componentKey, placement) => {
        const runtimePlacement = placement ? this.getRuntimePlacement(componentKey, placement) : null;
        if (!runtimePlacement || !isCityChannelPlacementVisible(runtimePlacement, {
          mapData: this.mapData,
          visibleLayerCutoff: this.visibleLayerCutoff
        })) return;
        this.getGearBindingSurfacesForPlacement(runtimePlacement).forEach((surface) => {
          GEAR_SOCKET_POSITIONS.filter(isCornerGearSocket).forEach((socket) => {
            const socketWorld = getGearWorldPosition(runtimePlacement, { position: socket, surface });
            if (!this.isSameGearWorldPoint(socketWorld, pivotWorld)) return;
            candidates.push({
              componentKey,
              hostKind,
              socket,
              surface,
              pivotWorld: socketWorld
            });
          });
        });
      };
      Object.entries(this.mapData.tiles || {}).forEach(([componentKey, tile]) => {
        appendPlacementCandidates('tile', componentKey, tile);
      });
      Object.entries(this.mapData.walls || {}).forEach(([componentKey, wall]) => {
        appendPlacementCandidates('wall', componentKey, wall);
      });
      return candidates;
    }

    getSelectedCornerGearBindingContext() {
      if (this.selectedGears.length !== 1) return null;
      const selectedGear = this.selectedGears[0];
      const host = this.getGearHostFromSelection(selectedGear);
      const mount = host?.gearMounts?.find((item) => item.id === selectedGear.mountId);
      if (!host || !mount || !isCornerGearSocket(mount.position)) return null;
      const pivotWorld = getGearWorldPosition(host, mount);
      if (!pivotWorld) return null;
      const candidates = this.getGearBindingCandidatesForPivot({ pivotWorld });
      if (candidates.length <= 0) return null;
      return {
        hostKind: selectedGear.hostKind,
        hostKey: selectedGear.hostKey,
        mountId: selectedGear.mountId,
        cell: selectedGear.cell || { x: host.x, y: host.y, z: host.z },
        edge: selectedGear.edge || null,
        host,
        mount,
        pivotWorld,
        candidates
      };
    }

    getGearBindingCandidateHit(localPoint) {
      const context = this.getSelectedCornerGearBindingContext();
      if (!context || !localPoint) return null;
      const radius = Math.max(18, 30 / Math.max(0.45, this.cameraState.zoom || 1));
      const radiusSquared = radius * radius;
      let best = null;
      context.candidates.forEach((candidate, index) => {
        const placement = this.getGearBindingCandidatePlacement(candidate);
        if (!placement) return;
        const visual = this.getGearBindingCandidateVisual(context, candidate, index);
        if (!visual) return;
        const insidePanel = pointInPolygon(localPoint, visual.polygon || []);
        const panelBounds = expandRect(getPointBounds(visual.polygon || []), 12);
        const insideExpandedPanel = rectContainsPoint(panelBounds, localPoint);
        const anchorDistanceSquared = visual.hitAnchor
          ? ((localPoint.x - visual.hitAnchor.x) ** 2) + ((localPoint.y - visual.hitAnchor.y) ** 2)
          : Infinity;
        const bandDistanceSquared = Math.min(
          ...this.getGearBindingCandidateBandSegments(visual).map((segment) => (
            distancePointToSegmentSquared(localPoint, segment.start, segment.end)
          )),
          Infinity
        );
        const endpointDistanceSquared = ((localPoint.x - visual.end.x) ** 2) + ((localPoint.y - visual.end.y) ** 2);
        const curveDistanceSquared = this.getPointToQuadraticDistanceSquared(localPoint, visual.start, visual.control, visual.end);
        const visualDistanceSquared = Math.min(endpointDistanceSquared, curveDistanceSquared, bandDistanceSquared);
        const insideCandidate = insidePanel || insideExpandedPanel;
        if (!insideCandidate && visualDistanceSquared > radiusSquared) return;
        const rankDistanceSquared = insideCandidate ? anchorDistanceSquared : visualDistanceSquared + radiusSquared;
        if (!best || rankDistanceSquared < best.distanceSquared) {
          best = {
            type: 'gearBindingCandidate',
            hostKind: context.hostKind,
            hostKey: context.hostKey,
            mountId: context.mountId,
            cell: context.cell,
            edge: context.edge,
            candidate,
            point: visual.end,
            visual,
            distanceSquared: rankDistanceSquared,
            snapPriority: 8,
            selectionPriority: 8,
            depth: getPlacementDepth({
              cell: placement,
              partType: placement.edge || placement.isVertical ? 'wall_attachment' : 'floor_attachment',
              physicalLayer: placement.edge || placement.isVertical ? 'wall_attachment' : 'floor_attachment',
              edge: placement.edge,
              cameraYaw: this.cameraState.yaw,
              mapData: this.mapData
            }) + 12
          };
        }
      });
      return best;
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
      const target = getGearInstallTargetForScene(this, hitInfo);
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
      const ignoreGearKeys = new Set(
        gears.map((item) => getGearMountIdentity(item.hostKind, item.hostKey, item.mountId))
      );
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
        if (isCityChannelGearSocketBlockedBySurface({
          mapData: this.mapData,
          placement: target.placement,
          socket: nextSocket
        })) {
          this.config.onToast?.('目标吸附位被竖直板材遮挡。', 'error');
          return;
        }
        const targetSurface = normalizeGearSurfaceForPanel(target.placement?.panelType, target.surface || 'front');
        const nextKey = `${target.hostKey}:${targetSurface}:${nextSocket}`;
        if (usedKeys.has(nextKey)) {
          this.config.onToast?.('目标吸附位发生重叠。', 'error');
          return;
        }
        usedKeys.add(nextKey);
        const occupied = (target.placement?.gearMounts || []).some((mount) => (
          mount.position === nextSocket
          && normalizeGearSurfaceForPanel(target.placement?.panelType, mount.surface || 'front') === targetSurface
          && !selectedIds.has(mount.id)
        ));
        if (occupied) {
          this.config.onToast?.('目标吸附位已有齿轮。', 'error');
          return;
        }
        const pivotWorld = getGearWorldPosition(target.placement, {
          position: nextSocket,
          surface: targetSurface
        });
        if (isCornerGearSocket(nextSocket) && this.getGearBindingCandidatesForPivot({ pivotWorld }).length <= 0) {
          this.config.onToast?.('该顶角周围没有可联动的板材。', 'error');
          return;
        }
        if (isCornerGearSocket(nextSocket) && hasCornerGearConflict({
          mapData: this.mapData,
          pivotWorld,
          surface: targetSurface,
          ignoreGearKeys
        })) {
          this.config.onToast?.('该顶角已有共面顶角齿轮。', 'error');
          return;
        }
        movedMounts.push({
          gear,
          mount: {
            ...gear.mount,
            position: nextSocket,
            socketKind: nextSocket === 'center' ? 'center' : 'corner',
            surface: targetSurface,
            axisBinding: null
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

    getOrCreateMountedGearGraphics(hostKind, hostKey, side) {
      const key = getMountedGearLayerKey(hostKind, hostKey, side);
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
      const wallAlpha = placement.edge
        ? this.getEffectiveWallViewMode() === 'perspective' ? 0.34 : 0.82
        : placement.isVertical ? 0.82 : 0.96;
      this.drawProjectedSurfacePolygon(graphics, polygon, 0x2f3744, wallAlpha, 0x020617, 0.24, 1);
    }

    isHostMovingWithCarry(hostKey) {
      if (this.carryState?.kind !== 'placement' || !hostKey) return false;
      const movingHostKeys = getMovingHostKeysFromOrigins(this.carryState.origins || []);
      return movingHostKeys.has(hostKey);
    }

    isGearMovingWithCarry(hostKind, hostKey, mountId) {
      if (this.carryState?.kind !== 'gear' || !hostKey || !mountId) return false;
      return (this.carryState.gears || []).some((gear) => (
        gear.hostKind === hostKind
        && gear.hostKey === hostKey
        && gear.mountId === mountId
      ));
    }

    getGearCarryIgnoreKeys() {
      return new Set((this.carryState?.gears || []).map((gear) => (
        getGearMountIdentity(gear.hostKind, gear.hostKey, gear.mountId)
      )));
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
        if (!isGearSurfaceVisible(ghostPlacement, mount)) return;
        const point = this.getGearMountPoint(ghostPlacement, mount);
        if (!point) return;
        this.drawMountedGearPreview(this.ghostLayer, point, {
          placement: ghostPlacement,
          mount,
          valid,
          ghost: true,
          alpha: ghostAlpha,
          angle: mount.phase || 0
        });
      });
    }

    redrawMountedGearHostLayers(hostKind, hostKey, placement, suppliedDepth = null, sourcePlacement = null) {
      if (!placement || !hostKey) return;
      if (this.isHostMovingWithCarry(hostKey)) {
        this.removeRenderObject(getMountedGearLayerKey(hostKind, hostKey, 'far'));
        this.removeRenderObject(getMountedGearLayerKey(hostKind, hostKey, 'near'));
        return;
      }
      const mountSource = sourcePlacement || placement;
      const mounts = Array.isArray(mountSource.gearMounts)
        ? mountSource.gearMounts.filter((mount) => (
          isGearSurfaceVisible(placement, mount)
          && !this.isGearMovingWithCarry(hostKind, hostKey, mount.id)
        ))
        : [];
      const farKey = getMountedGearLayerKey(hostKind, hostKey, 'far');
      const nearKey = getMountedGearLayerKey(hostKind, hostKey, 'near');
      if (mounts.length <= 0) {
        this.removeRenderObject(farKey);
        this.removeRenderObject(nearKey);
        return;
      }

      const baseDepth = this.getMountedGearLayerDepth(hostKind, placement);
      const farGraphics = this.getOrCreateMountedGearGraphics(hostKind, hostKey, 'far');
      const nearGraphics = this.getOrCreateMountedGearGraphics(hostKind, hostKey, 'near');
      farGraphics.clear();
      nearGraphics.clear();
      farGraphics.setPosition(0, 0).setAngle(0).setScale(1, 1);
      nearGraphics.setPosition(0, 0).setAngle(0).setScale(1, 1);

      const visibleSurface = getVisibleGearSurfaceSide(placement, this.cameraState.yaw);
      let hasFarMount = false;
      let farDepth = null;
      let nearDepth = null;
      mounts.forEach((mount) => {
        const runtimeGear = this.getRuntimeGearState(hostKey, mount.id);
        const point = this.getGearMountPoint(placement, mount);
        if (!point) return;
        const selected = this.selectedGears.some((gear) => gear.hostKey === hostKey && gear.mountId === mount.id);
        const axisBindingStatus = getGearAxisBindingStatus({
          mapData: this.mapData,
          placement: mountSource,
          mount
        });
        const gearAngle = runtimeGear?.phase ?? mount.phase ?? 0;
        const visualGearAngle = gearAngle;
        const layer = isGearOnCameraSide(placement, mount, this.cameraState.yaw) ? nearGraphics : farGraphics;
        const mountDepth = this.getMountedGearLayerDepth(hostKind, placement, mount);
        if (layer === farGraphics) {
          hasFarMount = true;
          farDepth = Math.max(farDepth ?? -Infinity, mountDepth - 0.45);
        } else {
          nearDepth = Math.max(
            nearDepth ?? -Infinity,
            this.getMountedGearForegroundDepth(hostKind, placement, mount, point, mountDepth + 0.45)
          );
        }
        this.drawMountedGearPreview(layer, point, {
          placement,
          mount,
          selected,
          valid: true,
          angle: visualGearAngle,
          alpha: 0.94,
          axisBindingInvalid: axisBindingStatus.bound && !axisBindingStatus.valid
        });
      });

      farGraphics.depth = farDepth ?? (baseDepth - 0.45);
      nearGraphics.depth = nearDepth ?? (baseDepth + 0.45);
      if (hasFarMount) {
        this.drawGearHostSurfaceOccluder(farGraphics, placement, visibleSurface);
      }
    }

    redrawAllMountedGearLayers() {
      Object.entries(this.mapData.tiles || {}).forEach(([hostKey, tile]) => {
        if (!isCityChannelPlacementVisible(tile, { mapData: this.mapData, visibleLayerCutoff: this.visibleLayerCutoff })) {
          this.removeRenderObject(getMountedGearLayerKey('tile', hostKey, 'far'));
          this.removeRenderObject(getMountedGearLayerKey('tile', hostKey, 'near'));
          return;
        }
        this.redrawMountedGearHostLayers('tile', hostKey, this.getRuntimePlacement(hostKey, tile), null, tile);
      });
      Object.entries(this.mapData.walls || {}).forEach(([hostKey, wall]) => {
        if (!isCityChannelPlacementVisible(wall, { mapData: this.mapData, visibleLayerCutoff: this.visibleLayerCutoff })) {
          this.removeRenderObject(getMountedGearLayerKey('wall', hostKey, 'far'));
          this.removeRenderObject(getMountedGearLayerKey('wall', hostKey, 'near'));
          return;
        }
        this.redrawMountedGearHostLayers('wall', hostKey, this.getRuntimePlacement(hostKey, wall), null, wall);
      });
    }

    drawDashedSegment(graphics, start, end, dashLength = 8, gapLength = 5) {
      if (!graphics || !start || !end) return;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length <= 0.001) return;
      const ux = dx / length;
      const uy = dy / length;
      let offset = 0;
      while (offset < length) {
        const next = Math.min(length, offset + dashLength);
        graphics.lineBetween(
          start.x + (ux * offset),
          start.y + (uy * offset),
          start.x + (ux * next),
          start.y + (uy * next)
        );
        offset = next + gapLength;
      }
    }

    drawDashedPolygon(graphics, points = [], dashLength = 8, gapLength = 5) {
      if (!graphics || !Array.isArray(points) || points.length < 2) return;
      points.forEach((point, index) => {
        const next = points[(index + 1) % points.length];
        this.drawDashedSegment(graphics, point, next, dashLength, gapLength);
      });
    }

    getQuadraticPoint(start, control, end, t) {
      const inv = 1 - t;
      return {
        x: (inv * inv * start.x) + (2 * inv * t * control.x) + (t * t * end.x),
        y: (inv * inv * start.y) + (2 * inv * t * control.y) + (t * t * end.y)
      };
    }

    getQuadraticCurvePoints(start, control, end, segments = 28) {
      const points = [];
      for (let index = 0; index <= segments; index += 1) {
        points.push(this.getQuadraticPoint(start, control, end, index / segments));
      }
      return points;
    }

    drawDashedPolyline(graphics, points = [], dashLength = 8, gapLength = 5, dashOffset = 0) {
      if (!graphics || !Array.isArray(points) || points.length < 2) return;
      const patternLength = Math.max(0.001, dashLength + gapLength);
      const phase = ((dashOffset % patternLength) + patternLength) % patternLength;
      let drawing = phase < dashLength;
      let remaining = drawing ? dashLength - phase : patternLength - phase;
      for (let index = 0; index < points.length - 1; index += 1) {
        let cursor = points[index];
        const nextPoint = points[index + 1];
        let segmentLength = Math.hypot(nextPoint.x - cursor.x, nextPoint.y - cursor.y);
        if (segmentLength <= 0.001) continue;
        const ux = (nextPoint.x - cursor.x) / segmentLength;
        const uy = (nextPoint.y - cursor.y) / segmentLength;
        while (segmentLength > 0.001) {
          const step = Math.min(remaining, segmentLength);
          const target = {
            x: cursor.x + (ux * step),
            y: cursor.y + (uy * step)
          };
          if (drawing) graphics.lineBetween(cursor.x, cursor.y, target.x, target.y);
          cursor = target;
          segmentLength -= step;
          remaining -= step;
          if (remaining <= 0.001) {
            drawing = !drawing;
            remaining = drawing ? dashLength : gapLength;
          }
        }
      }
    }

    drawDashedQuadratic(graphics, start, control, end, dashLength = 8, gapLength = 5, dashOffset = 0) {
      this.drawDashedPolyline(
        graphics,
        this.getQuadraticCurvePoints(start, control, end, 32),
        dashLength,
        gapLength,
        dashOffset
      );
    }

    drawSolidQuadratic(graphics, start, control, end) {
      if (!graphics || !start || !control || !end) return;
      const points = this.getQuadraticCurvePoints(start, control, end, 36);
      points.slice(0, -1).forEach((point, index) => {
        const next = points[index + 1];
        graphics.lineBetween(point.x, point.y, next.x, next.y);
      });
    }

    lerpPoint(a, b, t) {
      return {
        x: (a.x || 0) + (((b.x || 0) - (a.x || 0)) * t),
        y: (a.y || 0) + (((b.y || 0) - (a.y || 0)) * t)
      };
    }

    getPolygonPathBetween(points = [], fromIndex = 0, toIndex = 0) {
      if (!Array.isArray(points) || points.length <= 0) return [];
      const path = [];
      let index = ((fromIndex % points.length) + points.length) % points.length;
      const target = ((toIndex % points.length) + points.length) % points.length;
      for (let guard = 0; guard <= points.length; guard += 1) {
        path.push(points[index]);
        if (index === target) break;
        index = (index + 1) % points.length;
      }
      return path;
    }

    getForwardProjectionAverage(points = [], origin, dir) {
      if (!points.length) return -Infinity;
      return points.reduce((sum, point) => (
        sum + (((point.x - origin.x) * dir.x) + ((point.y - origin.y) * dir.y))
      ), 0) / points.length;
    }

    getGearBindingBeamGeometry(visual) {
      if (!visual?.polygon?.length || !visual.gearPoint || !visual.boardCenter) return null;
      const { polygon, gearPoint, boardCenter } = visual;
      const dx = boardCenter.x - gearPoint.x;
      const dy = boardCenter.y - gearPoint.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const dir = { x: dx / distance, y: dy / distance };
      const perp = { x: -dir.y, y: dir.x };
      const tangentCandidates = polygon.map((point, index) => {
        const vx = point.x - gearPoint.x;
        const vy = point.y - gearPoint.y;
        const forward = Math.max(1, (vx * dir.x) + (vy * dir.y));
        const lateral = (vx * perp.x) + (vy * perp.y);
        return {
          point,
          index,
          angle: Math.atan2(lateral, forward)
        };
      });
      const left = tangentCandidates.reduce((best, item) => (item.angle > best.angle ? item : best), tangentCandidates[0]);
      const right = tangentCandidates.reduce((best, item) => (item.angle < best.angle ? item : best), tangentCandidates[0]);
      const apertureWidth = Math.max(11, Math.min(18, distance * 0.2));
      const apertureForward = Math.max(8, Math.min(18, distance * 0.15));
      const apertureLeft = {
        x: gearPoint.x + (dir.x * apertureForward) + (perp.x * apertureWidth),
        y: gearPoint.y + (dir.y * apertureForward) + (perp.y * apertureWidth)
      };
      const apertureRight = {
        x: gearPoint.x + (dir.x * apertureForward) - (perp.x * apertureWidth),
        y: gearPoint.y + (dir.y * apertureForward) - (perp.y * apertureWidth)
      };
      const curveBend = Math.min(46, Math.max(20, distance * 0.24));
      const leftControl = {
        x: (apertureLeft.x + left.point.x) * 0.5 + (perp.x * curveBend),
        y: (apertureLeft.y + left.point.y) * 0.5 + (perp.y * curveBend)
      };
      const rightControl = {
        x: (apertureRight.x + right.point.x) * 0.5 - (perp.x * curveBend),
        y: (apertureRight.y + right.point.y) * 0.5 - (perp.y * curveBend)
      };
      const leftCurve = this.getQuadraticCurvePoints(apertureLeft, leftControl, left.point, 18);
      const rightCurve = this.getQuadraticCurvePoints(apertureRight, rightControl, right.point, 18);
      const pathA = this.getPolygonPathBetween(polygon, left.index, right.index);
      const pathB = this.getPolygonPathBetween(polygon, right.index, left.index).reverse();
      const boardPath = this.getForwardProjectionAverage(pathA, gearPoint, dir) >= this.getForwardProjectionAverage(pathB, gearPoint, dir)
        ? pathA
        : pathB;
      const conePoints = [
        ...leftCurve,
        ...boardPath.slice(1, -1),
        ...rightCurve.slice().reverse()
      ];
      return {
        conePoints,
        apertureLeft,
        apertureRight,
        leftPoint: left.point,
        rightPoint: right.point,
        leftControl,
        rightControl,
        dir,
        perp,
        distance
      };
    }

    getGearBindingCandidateKey(candidate = {}) {
      if (!candidate?.componentKey || !candidate?.socket) return '';
      return [
        candidate.hostKind || 'tile',
        candidate.componentKey,
        candidate.socket,
        candidate.surface || 'front'
      ].join(':');
    }

    isSameGearBindingCandidate(a = null, b = null) {
      return !!a && !!b && this.getGearBindingCandidateKey(a) === this.getGearBindingCandidateKey(b);
    }

    getGearAttachOverlayTime(time = null) {
      return Number.isFinite(time) ? time : (this.time?.now || Date.now());
    }

    getGearAttachCandidateAlpha(time = null) {
      const now = this.getGearAttachOverlayTime(time);
      return 0.425 + (Math.sin((now / GEAR_ATTACH_CANDIDATE_PULSE_MS) * Math.PI * 2) * 0.075);
    }

    getGearBindingConfirmPulse(time = null) {
      if (!this.gearBindingConfirmPulse) return null;
      const now = this.getGearAttachOverlayTime(time);
      const elapsed = now - this.gearBindingConfirmPulse.startedAt;
      if (elapsed > this.gearBindingConfirmPulse.duration) {
        this.gearBindingConfirmPulse = null;
        return null;
      }
      return {
        ...this.gearBindingConfirmPulse,
        progress: Math.max(0, Math.min(1, elapsed / this.gearBindingConfirmPulse.duration))
      };
    }

    playGearBindingConfirmPulse(hit, nextBinding = null) {
      if (!hit?.candidate || !nextBinding) {
        this.gearBindingConfirmPulse = null;
        return;
      }
      this.gearBindingConfirmPulse = {
        hostKey: hit.hostKey,
        mountId: hit.mountId,
        candidateKey: this.getGearBindingCandidateKey(hit.candidate),
        startedAt: this.getGearAttachOverlayTime(),
        duration: GEAR_ATTACH_CONFIRM_PULSE_MS
      };
    }

    strokeGearBindingPolyline(graphics, points = [], { closed = false } = {}) {
      if (!graphics || !Array.isArray(points) || points.length < 2) return;
      for (let index = 0; index < points.length - 1; index += 1) {
        graphics.lineBetween(points[index].x, points[index].y, points[index + 1].x, points[index + 1].y);
      }
      if (closed && points.length > 2) {
        const last = points[points.length - 1];
        const first = points[0];
        graphics.lineBetween(last.x, last.y, first.x, first.y);
      }
    }

    getClosestPolygonVertexIndex(points = [], target = null) {
      if (!Array.isArray(points) || points.length <= 0 || !target) return -1;
      return points.reduce((bestIndex, point, index) => {
        const current = ((point.x - target.x) ** 2) + ((point.y - target.y) ** 2);
        const best = points[bestIndex]
          ? ((points[bestIndex].x - target.x) ** 2) + ((points[bestIndex].y - target.y) ** 2)
          : Infinity;
        return current < best ? index : bestIndex;
      }, 0);
    }

    getLimitedGearBindingSegment(start, end, ratio = 0.64) {
      if (!start || !end) return null;
      return {
        start,
        end: this.lerpPoint(start, end, Math.max(0.2, Math.min(1, ratio)))
      };
    }

    getGearBindingCandidateBandSegments(visual) {
      if (!visual?.polygon?.length || !visual.boardAnchor) return [];
      const anchorIndex = this.getClosestPolygonVertexIndex(visual.polygon, visual.boardAnchor);
      if (anchorIndex < 0) return [];
      const points = visual.polygon;
      const anchor = points[anchorIndex];
      const prev = points[(anchorIndex - 1 + points.length) % points.length];
      const next = points[(anchorIndex + 1) % points.length];
      return [
        this.getLimitedGearBindingSegment(anchor, prev),
        this.getLimitedGearBindingSegment(anchor, next)
      ].filter(Boolean);
    }

    getGearBindingPreviewControl(start, end, surfaceContext = null) {
      if (!start || !end) return null;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const extrusion = surfaceContext?.extrusion || { x: 0, y: -9 };
      const extrusionLength = Math.hypot(extrusion.x || 0, extrusion.y || 0);
      const outNormal = extrusionLength > 0.5
        ? { x: extrusion.x / extrusionLength, y: extrusion.y / extrusionLength }
        : { x: 0, y: -1 };
      const lift = Math.min(42, Math.max(18, length * 0.2));
      return {
        x: ((start.x + end.x) * 0.5) + (outNormal.x * lift),
        y: ((start.y + end.y) * 0.5) + (outNormal.y * lift)
      };
    }

    drawGearBindingCandidateBoardLight(graphics, visual, { hovered = false, selected = false, candidateAlpha = 0.42 } = {}) {
      if (!graphics || !visual?.polygon?.length) return;
      if (!selected) return;
      const style = GEAR_ATTACH_HIGHLIGHT_STYLE;
      const fillAlpha = hovered ? 0.1 : 0.045 + (candidateAlpha * 0.06);
      graphics.fillStyle(style.CANDIDATE_FILL_COLOR, Math.min(0.12, fillAlpha));
      graphics.fillPoints(visual.polygon, true, true);
      graphics.lineStyle(9, style.HOVER_GLOW_COLOR, hovered ? 0.22 : 0.14);
      this.strokeGearBindingPolyline(graphics, visual.polygon, { closed: true });
      graphics.lineStyle(4, style.HOVER_GLOW_COLOR, hovered ? 0.48 : 0.34);
      this.strokeGearBindingPolyline(graphics, visual.polygon, { closed: true });
      graphics.lineStyle(1.5, style.HOVER_EDGE_COLOR, hovered ? 0.98 : 0.82);
      this.strokeGearBindingPolyline(graphics, visual.polygon, { closed: true });
    }

    drawGearBindingPreviewArrow(graphics, start, control, end, { time = null } = {}) {
      if (!graphics || !start || !control || !end) return;
      const style = GEAR_ATTACH_HIGHLIGHT_STYLE;
      const now = this.getGearAttachOverlayTime(time);
      const before = this.getQuadraticPoint(start, control, end, 0.93);
      const dx = end.x - before.x;
      const dy = end.y - before.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const dir = { x: dx / length, y: dy / length };
      const perp = { x: -dir.y, y: dir.x };
      const bob = Math.sin(now / 145) * 2.4;
      const tip = {
        x: end.x + (dir.x * (7 + bob)),
        y: end.y + (dir.y * (7 + bob))
      };
      const base = {
        x: tip.x - (dir.x * 17),
        y: tip.y - (dir.y * 17)
      };
      const left = {
        x: base.x + (perp.x * 7.4),
        y: base.y + (perp.y * 7.4)
      };
      const right = {
        x: base.x - (perp.x * 7.4),
        y: base.y - (perp.y * 7.4)
      };
      graphics.fillStyle(style.HOVER_GLOW_COLOR, 0.22);
      graphics.fillCircle(tip.x, tip.y, 12);
      graphics.fillStyle(style.PREVIEW_LINE_COLOR, 0.48);
      graphics.fillTriangle?.(
        tip.x + (dir.x * 3.2),
        tip.y + (dir.y * 3.2),
        left.x + (perp.x * 2.2),
        left.y + (perp.y * 2.2),
        right.x - (perp.x * 2.2),
        right.y - (perp.y * 2.2)
      );
      graphics.fillStyle(style.HOVER_EDGE_COLOR, 0.92);
      graphics.fillTriangle?.(tip.x, tip.y, left.x, left.y, right.x, right.y);
    }

    drawGearBindingHoverPreview(graphics, visual, { time = null } = {}) {
      if (!graphics || !visual?.gearPoint || !visual.boardFocusPoint || !visual.control) return;
      const style = GEAR_ATTACH_HIGHLIGHT_STYLE;
      const now = this.getGearAttachOverlayTime(time);
      graphics.lineStyle(11, style.HOVER_GLOW_COLOR, 0.22);
      this.drawSolidQuadratic(graphics, visual.gearPoint, visual.control, visual.boardFocusPoint);
      graphics.lineStyle(5.2, style.PREVIEW_LINE_COLOR, 0.62);
      this.drawSolidQuadratic(graphics, visual.gearPoint, visual.control, visual.boardFocusPoint);
      graphics.lineStyle(2.2, style.HOVER_EDGE_COLOR, 0.96);
      this.drawSolidQuadratic(graphics, visual.gearPoint, visual.control, visual.boardFocusPoint);
      graphics.fillStyle(style.HOVER_GLOW_COLOR, 0.24);
      graphics.fillCircle(visual.boardFocusPoint.x, visual.boardFocusPoint.y, 7);
      graphics.fillStyle(style.HOVER_EDGE_COLOR, 0.92);
      graphics.fillCircle(visual.boardFocusPoint.x, visual.boardFocusPoint.y, 3.2);
      this.drawGearBindingPreviewArrow(graphics, visual.gearPoint, visual.control, visual.boardFocusPoint, { time: now });
    }

    drawGearBindingConfirmedMarker(graphics, visual, { pulse = null } = {}) {
      if (!graphics || !visual?.gearPoint || !visual.boardFocusPoint) return;
      const style = GEAR_ATTACH_HIGHLIGHT_STYLE;
      const distance = Math.hypot(
        visual.boardFocusPoint.x - visual.gearPoint.x,
        visual.boardFocusPoint.y - visual.gearPoint.y
      );
      if (distance <= 2) return;
      const start = this.lerpPoint(visual.gearPoint, visual.boardFocusPoint, 0.12);
      const end = this.lerpPoint(visual.gearPoint, visual.boardFocusPoint, 0.46);
      graphics.lineStyle(9, style.HOVER_GLOW_COLOR, 0.2);
      graphics.lineBetween(start.x, start.y, end.x, end.y);
      graphics.lineStyle(4, style.CONFIRMED_CORE_COLOR, 0.54);
      graphics.lineBetween(start.x, start.y, end.x, end.y);
      graphics.lineStyle(1.5, style.CONFIRMED_MARKER_COLOR, 0.96);
      graphics.lineBetween(start.x, start.y, end.x, end.y);
      graphics.fillStyle(style.HOVER_GLOW_COLOR, 0.28);
      graphics.fillCircle(end.x, end.y, 7);
      graphics.fillStyle(style.CONFIRMED_MARKER_COLOR, 0.95);
      graphics.fillCircle(end.x, end.y, 3);
      if (!pulse) return;
      const alpha = Math.max(0, 1 - pulse.progress);
      graphics.lineStyle(2.5, style.CONFIRMED_MARKER_COLOR, 0.7 * alpha);
      graphics.strokeCircle(end.x, end.y, 7 + (pulse.progress * 11));
    }

    drawGearBindingSourceMarker(graphics, context, time = null) {
      if (!graphics || !context?.host || !context.mount) return;
      const point = this.getGearMountPoint(context.host, context.mount);
      if (!point) return;
      const style = GEAR_ATTACH_HIGHLIGHT_STYLE;
      const now = this.getGearAttachOverlayTime(time);
      const pulse = 0.5 + (Math.sin((now / GEAR_ATTACH_SOURCE_PULSE_MS) * Math.PI * 2) * 0.5);
      const radius = 21 + (pulse * 1.8);
      graphics.lineStyle(9, style.SOURCE_GLOW_COLOR, 0.14 + (pulse * 0.08));
      graphics.strokeCircle(point.x, point.y, radius + 2);
      graphics.lineStyle(4, style.SOURCE_GLOW_COLOR, 0.34);
      graphics.strokeCircle(point.x, point.y, radius);
      graphics.lineStyle(1.45, style.SOURCE_RING_COLOR, 0.94);
      graphics.strokeCircle(point.x, point.y, radius - 1.5);
      graphics.fillStyle(style.SOURCE_GLOW_COLOR, 0.26);
      graphics.fillCircle(point.x, point.y, 6.5 + (pulse * 1.2));
      graphics.fillStyle(style.SOURCE_ANCHOR_COLOR, 0.92);
      graphics.fillCircle(point.x, point.y, 2.8);
    }

    drawGearBindingBeam(graphics, visual, { hovered = false, selected = false, candidateAlpha = 0.42, confirmPulse = null, time = null } = {}) {
      if (!graphics || !visual) return;
      this.drawGearBindingCandidateBoardLight(graphics, visual, { hovered, selected, candidateAlpha });
      if (selected) this.drawGearBindingConfirmedMarker(graphics, visual, { pulse: confirmPulse });
      if (hovered) this.drawGearBindingHoverPreview(graphics, visual, { time });
    }

    getAmbientGearBindingVisuals() {
      if (this.selectedGears.length > 0) return [];
      if (this.carryState?.kind === 'gear') return [];
      const visuals = [];
      const appendHostBindings = (hostKind, hostKey, host) => {
        const runtimeHost = host ? this.getRuntimePlacement(hostKey, host) : null;
        if (!runtimeHost || !isCityChannelPlacementVisible(runtimeHost, {
          mapData: this.mapData,
          visibleLayerCutoff: this.visibleLayerCutoff
        })) return;
        (host.gearMounts || []).forEach((mount) => {
          if (!mount?.axisBinding || !isCornerGearSocket(mount.position)) return;
          if (!isGearSurfaceVisible(runtimeHost, mount)) return;
          if (!isGearOnCameraSide(runtimeHost, mount, this.cameraState.yaw)) return;
          const bindingStatus = getGearAxisBindingStatus({
            mapData: this.mapData,
            placement: host,
            mount
          });
          if (!bindingStatus.bound || !bindingStatus.valid || !bindingStatus.binding || !bindingStatus.component) return;
          const runtimeComponent = this.getRuntimePlacement(bindingStatus.binding.componentKey, bindingStatus.component);
          if (!isCityChannelPlacementVisible(runtimeComponent, {
            mapData: this.mapData,
            visibleLayerCutoff: this.visibleLayerCutoff
          })) return;
          const bindingMount = {
            position: bindingStatus.binding.socket,
            surface: bindingStatus.binding.surface || 'front'
          };
          if (!isGearSurfaceVisible(runtimeComponent, bindingMount)) return;
          if (!isGearOnCameraSide(runtimeComponent, bindingMount, this.cameraState.yaw)) return;
          const context = {
            hostKind,
            hostKey,
            mountId: mount.id,
            cell: { x: runtimeHost.x, y: runtimeHost.y, z: runtimeHost.z },
            edge: runtimeHost.edge || null,
            host: runtimeHost,
            mount,
            pivotWorld: getGearWorldPosition(runtimeHost, mount),
            candidates: [bindingStatus.binding]
          };
          const visual = this.getGearBindingCandidateVisual(context, bindingStatus.binding);
          if (!visual) return;
          visuals.push({
            context,
            binding: bindingStatus.binding,
            visual
          });
        });
      };
      Object.entries(this.mapData.tiles || {}).forEach(([hostKey, tile]) => {
        appendHostBindings('tile', hostKey, tile);
      });
      Object.entries(this.mapData.walls || {}).forEach(([hostKey, wall]) => {
        appendHostBindings('wall', hostKey, wall);
      });
      return visuals;
    }

    drawAmbientGearBindingMarker(graphics, visual) {
      if (!graphics || !visual?.gearPoint || !visual?.boardFocusPoint) return;
      const style = GEAR_ATTACH_HIGHLIGHT_STYLE;
      const dashOffset = Math.abs(Math.round((visual.gearPoint.x || 0) + (visual.gearPoint.y || 0))) % 14;
      if (visual.polygon?.length) {
        graphics.fillStyle(style.AMBIENT_BINDING_FILL_COLOR, 0.048);
        graphics.fillPoints(visual.polygon, true, true);
        graphics.lineStyle(8, style.AMBIENT_BINDING_DARK_COLOR, 0.2);
        this.strokeGearBindingPolyline(graphics, visual.polygon, { closed: true });
        graphics.lineStyle(5, style.AMBIENT_BINDING_GLOW_COLOR, 0.18);
        this.strokeGearBindingPolyline(graphics, visual.polygon, { closed: true });
        graphics.lineStyle(2.35, style.AMBIENT_BINDING_COLOR, 0.74);
        this.strokeGearBindingPolyline(graphics, visual.polygon, { closed: true });
        graphics.lineStyle(1.15, 0xfffbeb, 0.62);
        this.drawDashedPolygon(graphics, visual.polygon, 8, 6);
      }
      if (visual.control) {
        graphics.lineStyle(6, style.AMBIENT_BINDING_DARK_COLOR, 0.14);
        this.drawDashedQuadratic(graphics, visual.gearPoint, visual.control, visual.boardFocusPoint, 7, 8, dashOffset);
        graphics.lineStyle(4, style.AMBIENT_BINDING_GLOW_COLOR, 0.14);
        this.drawDashedQuadratic(graphics, visual.gearPoint, visual.control, visual.boardFocusPoint, 7, 8, dashOffset);
        graphics.lineStyle(1.85, style.AMBIENT_BINDING_COLOR, 0.56);
        this.drawDashedQuadratic(graphics, visual.gearPoint, visual.control, visual.boardFocusPoint, 7, 8, dashOffset);
      }
      const boardPoint = visual.boardAnchor || visual.boardFocusPoint;
      graphics.lineStyle(2, style.AMBIENT_BINDING_COLOR, 0.74);
      graphics.strokeCircle(boardPoint.x, boardPoint.y, 10);
      graphics.fillStyle(style.AMBIENT_BINDING_DARK_COLOR, 0.72);
      graphics.fillCircle(boardPoint.x, boardPoint.y, 5.2);
      graphics.fillStyle(style.AMBIENT_BINDING_COLOR, 0.82);
      graphics.fillCircle(boardPoint.x, boardPoint.y, 2.7);
      graphics.lineStyle(1.9, style.AMBIENT_BINDING_COLOR, 0.68);
      graphics.strokeCircle(visual.gearPoint.x, visual.gearPoint.y, 14);
      graphics.fillStyle(style.AMBIENT_BINDING_DARK_COLOR, 0.68);
      graphics.fillCircle(visual.gearPoint.x, visual.gearPoint.y, 5.5);
      graphics.fillStyle(style.AMBIENT_BINDING_COLOR, 0.84);
      graphics.fillCircle(visual.gearPoint.x, visual.gearPoint.y, 2.8);
    }

    drawAmbientGearBindings() {
      const visuals = this.getAmbientGearBindingVisuals();
      if (visuals.length <= 0) return false;
      this.gearBindingCandidateLayer.depth = 10000;
      visuals.forEach(({ visual }) => {
        this.drawAmbientGearBindingMarker(this.gearBindingCandidateLayer, visual);
      });
      return true;
    }

    getPointToQuadraticDistanceSquared(point, start, control, end) {
      if (!point || !start || !control || !end) return Infinity;
      const curvePoints = this.getQuadraticCurvePoints(start, control, end, 36);
      return Math.min(...curvePoints.slice(0, -1).map((curvePoint, index) => (
        distancePointToSegmentSquared(point, curvePoint, curvePoints[index + 1])
      )));
    }

    getGearBindingCandidateVisual(context, candidate) {
      if (!context || !candidate) return null;
      const placement = this.getGearBindingCandidatePlacement(candidate);
      if (!placement) return null;
      const gearPoint = this.getGearMountPoint(context.host, context.mount);
      if (!gearPoint) return null;
      const boardAnchor = this.getGearMountPoint(placement, {
        position: candidate.socket,
        surface: candidate.surface || 'front'
      }) || gearPoint;
      const gearSurfaceContext = this.getGearSurfaceContext(context.host, context.mount.surface || 'front');
      const surfaceContext = this.getGearSurfaceContext(placement, candidate.surface || 'front');
      const polygon = Array.isArray(surfaceContext?.polygon)
        ? surfaceContext.polygon.map((point) => ({
          x: point.x + (surfaceContext.offsetX || 0),
          y: point.y + (surfaceContext.offsetY || 0)
        }))
        : [];
      if (polygon.length < 3) return null;
      const boardCenter = polygon.reduce((sum, point) => ({
        x: sum.x + point.x,
        y: sum.y + point.y
      }), { x: 0, y: 0 });
      boardCenter.x /= polygon.length;
      boardCenter.y /= polygon.length;
      const boardFocusPoint = boardCenter;
      const control = this.getGearBindingPreviewControl(gearPoint, boardFocusPoint, gearSurfaceContext);
      return {
        placement,
        polygon,
        gearPoint,
        boardAnchor,
        boardCenter,
        boardFocusPoint,
        hitAnchor: boardFocusPoint,
        start: gearPoint,
        control,
        end: boardFocusPoint
      };
    }

    drawGearBindingCandidates(time = null) {
      if (!this.gearBindingCandidateLayer) return;
      this.gearBindingCandidateLayer.clear();
      const now = this.getGearAttachOverlayTime(time);
      const confirmPulse = this.getGearBindingConfirmPulse(now);
      const context = this.getSelectedCornerGearBindingContext();
      if (!context) {
        this.drawAmbientGearBindings();
        return;
      }
      if (this.carryState?.kind === 'gear') return;
      if (this.isSelectedGearHit(this.hoverTarget?.hit)) return;
      this.gearBindingCandidateLayer.depth = 10000;
      const candidateAlpha = this.getGearAttachCandidateAlpha(now);
      const current = context.mount.axisBinding || null;
      const hoverHit = this.hoverTarget?.hit;
      const visuals = context.candidates.map((candidate, index) => {
        const selected = current
          && this.isSameGearBindingCandidate(current, candidate);
        const hovered = hoverHit?.type === 'gearBindingCandidate'
          && hoverHit.hostKey === context.hostKey
          && hoverHit.mountId === context.mountId
          && this.isSameGearBindingCandidate(hoverHit.candidate, candidate);
        const visual = this.getGearBindingCandidateVisual(context, candidate, index);
        if (!visual) return null;
        return { candidate, visual, hovered, selected };
      }).filter(Boolean);
      visuals
        .sort((a, b) => ((a.hovered ? 1 : 0) - (b.hovered ? 1 : 0)) || ((a.selected ? 1 : 0) - (b.selected ? 1 : 0)))
        .forEach(({ candidate, visual, hovered, selected }) => {
          const pulse = confirmPulse
            && confirmPulse.hostKey === context.hostKey
            && confirmPulse.mountId === context.mountId
            && confirmPulse.candidateKey === this.getGearBindingCandidateKey(candidate)
            ? confirmPulse
            : null;
          this.drawGearBindingBeam(this.gearBindingCandidateLayer, visual, {
            hovered,
            selected,
            candidateAlpha,
            confirmPulse: pulse,
            time: now
          });
      });
      this.drawGearBindingSourceMarker(this.gearBindingCandidateLayer, context, now);
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
      if (placement.edge) {
        return createEdgeWallGeometry(
          this.cameraState.yaw,
          placement.edge,
          this.getWallMiterProfile(placement),
          getTransmissionSurfaceRotation(placement)
        );
      }
      if (placement.isVertical) {
        return createVerticalTileWallGeometry(
          this.cameraState.yaw,
          placement.rotation || 0,
          getTransmissionSurfaceRotation(placement)
        );
      }
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
      const offsetX = projection.x - TILE_RENDER_CENTER.x;
      const offsetY = projection.y - TILE_RENDER_CENTER.y;
      const baseDepth = Number.isFinite(suppliedDepth)
        ? suppliedDepth
        : getMountedGearHostDepth({
          hostKind,
          placement,
          cameraYaw: this.cameraState.yaw,
          mapData: this.mapData
        });
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
        if (!isCityChannelPlacementVisible(tile, { mapData: this.mapData, visibleLayerCutoff: this.visibleLayerCutoff }) || !tile?.isVertical) {
          this.removeRenderObject(this.getVerticalStructureOverlayKey('tile', hostKey));
          return;
        }
        this.redrawVerticalStructureOverlay('tile', hostKey, tile);
      });
      Object.entries(this.mapData.walls || {}).forEach(([hostKey, wall]) => {
        if (!isCityChannelPlacementVisible(wall, { mapData: this.mapData, visibleLayerCutoff: this.visibleLayerCutoff })) {
          this.removeRenderObject(this.getVerticalStructureOverlayKey('wall', hostKey));
          return;
        }
        this.redrawVerticalStructureOverlay('wall', hostKey, wall);
      });
    }

    getGearSurfaceContext(placement, surfaceSide = 'front') {
      if (!placement) return null;
      const projection = projectCell(placement, this.cameraState.yaw, this.mapData);
      const offsetX = projection.x - TILE_RENDER_CENTER.x;
      const offsetY = projection.y - TILE_RENDER_CENTER.y;
      if (placement.edge) {
        const geometry = createEdgeWallGeometry(
          this.cameraState.yaw,
          placement.edge,
          this.getWallMiterProfile(placement),
          getTransmissionSurfaceRotation(placement)
        );
        const directionalSurface = hasDirectionalGearSurface(placement.panelType);
        const wall = directionalSurface
          ? (surfaceSide === 'back' ? (geometry.wallBack || geometry.wall) : (geometry.wallFront || geometry.wall))
          : getTransmissionMidPlane(geometry, 'wall');
        const normal = getGearSurfaceNormal(placement, surfaceSide);
        const normalOffset = directionalSurface ? 0.14 : 0;
        const projectedNormal = projectWorldOffset(normal.x * normalOffset, normal.y * normalOffset, this.cameraState.yaw);
        return {
          polygon: wall,
          rotation: 0,
          offsetX,
          offsetY,
          surface: 'wall',
          extrusion: {
            x: projectedNormal.x,
            y: projectedNormal.y
          }
        };
      }
      const geometry = placement.isVertical
        ? createVerticalTileWallGeometry(this.cameraState.yaw, placement.rotation || 0, getTransmissionSurfaceRotation(placement))
        : createTileGeometry(this.cameraState.yaw, placement.rotation || 0);
      const verticalNormal = getGearSurfaceNormal(placement, surfaceSide);
      const directionalSurface = hasDirectionalGearSurface(placement.panelType);
      const verticalNormalOffset = directionalSurface ? 0.14 : 0;
      const verticalExtrusion = projectWorldOffset(verticalNormal.x * verticalNormalOffset, verticalNormal.y * verticalNormalOffset, this.cameraState.yaw);
      const wallSurface = directionalSurface
        ? (surfaceSide === 'back' ? (geometry.wallBack || geometry.wall) : (geometry.wallFront || geometry.wall))
        : getTransmissionMidPlane(geometry, 'wall');
      return {
        polygon: placement.isVertical ? wallSurface : geometry.top,
        rotation: 0,
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

    drawRouteLayer() {
      this.routeLayer.clear();
      (this.mapData.safeRoute || []).forEach((cell) => {
        if (!isCityChannelLayerVisible(cell, this.visibleLayerCutoff)) return;
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
        return matchesSelectionHit(normalizeInspectableHit(hitInfo.hit), ref);
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
        if (!tile) return [];
        const runtimeTile = this.carryState?.kind === 'placement'
          ? tile
          : this.getRuntimePlacement(key, tile);
        const projection = this.getRuntimePlacementScreenPoint(runtimeTile);
        const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
        const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
        const geometry = runtimeTile?.isVertical
          ? createVerticalTileWallGeometry(
            this.cameraState.yaw,
            runtimeTile.rotation || 0,
            getTransmissionSurfaceRotation(runtimeTile)
          )
          : createTileGeometry(this.cameraState.yaw, runtimeTile?.rotation || 0);
        const polygons = runtimeTile?.isVertical
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
        const baseWall = this.mapData.walls?.[key] || wall;
        const wallPlacement = previewWall || this.getRuntimePlacement(key, baseWall);
        const projection = this.getRuntimePlacementScreenPoint(wallPlacement);
        const offsetX = projection.x - (TILE_RENDER_WIDTH * 0.5);
        const offsetY = projection.y - (TILE_RENDER_HEIGHT * 0.57);
        const geometry = createEdgeWallGeometry(
          this.cameraState.yaw,
          wallPlacement.edge,
          this.getWallMiterProfile(wallPlacement),
          getTransmissionSurfaceRotation(wallPlacement)
        );
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
      const geometry = tile.isVertical
        ? createVerticalTileWallGeometry(this.cameraState.yaw, tile.rotation || 0, getTransmissionSurfaceRotation(tile))
        : createTileGeometry(this.cameraState.yaw, tile.rotation || 0);
      const groups = tile.isVertical ? [] : [geometry.top];
      if (isPortalMaterial(tile.panelType)) {
        groups.push(...getPortalPolygons(this.cameraState.yaw, tile.rotation || 0));
      }
      if (tile.isVertical) {
        groups.push(
          ...(Array.isArray(geometry.sides) ? geometry.sides : []),
          geometry.wall,
          geometry.wallBack,
          geometry.wallFront,
          geometry.wallCap,
          geometry.wallSideStart,
          geometry.wallSideEnd
        );
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
      return this.matchesSelectionPlacementHit(normalizeInspectableHit(hitInfo.hit), ref);
    }

    isPolygonFullyInsideRect(points = [], rect) {
      if (!Array.isArray(points) || points.length < 3 || !rect) return false;
      return points.every((point) => rectContainsPoint(rect, point));
    }

    isPlacementFullyInsideRect(placement, rect) {
      if (!placement || !rect) return false;
      if (!isCityChannelPlacementVisible(placement, { mapData: this.mapData, visibleLayerCutoff: this.visibleLayerCutoff })) return false;
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
          if (!isCityChannelPlacementVisible(placement, { mapData: this.mapData, visibleLayerCutoff: this.visibleLayerCutoff })) return;
          placement.gearMounts.forEach((mount) => {
            if (!mount?.id || !isGearSurfaceVisible(placement, mount) || !isGearOnCameraSide(placement, mount, this.cameraState.yaw)) return;
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
          const target = getGearInstallTargetForScene(this, this.getGearCarryInstallHitInfo({
            cell: this.hoverCell,
            hit: this.hoverTarget?.hit,
            edge: this.hoverEdge,
            localPoint: this.hoverTarget?.localPoint
          }), {
            ignoreGearKeys: this.getGearCarryIgnoreKeys()
          });
          this.drawGearCarryGhost(target);
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
        const target = getGearInstallTargetForScene(this, {
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
      }, { forGhost: true, allowReplacement: true });
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
        const hasSupport = hasTileSupportForMap({ mapData: this.mapData, cell: this.hoverCell });
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
        isVertical: !!placementTarget.isVertical,
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
          socketKind: target.socketKind,
          surface: target.surface,
          axisBinding: null,
          phase: 0
        },
        valid: target.valid,
        alpha: target.valid ? 0.9 : 0.72,
        ghost: true
      });
    }

    getGearCarryInstallHitInfo(hitInfo = {}) {
      const hit = hitInfo.hit;
      if (hit?.type !== 'gear') return hitInfo;
      const placement = hit.hostKind === 'wall'
        ? this.mapData.walls?.[hit.hostKey]
        : this.mapData.tiles?.[hit.hostKey];
      if (!placement) return hitInfo;
      const surface = hit.mount?.surface || 'front';
      const context = this.getGearSurfaceContext(placement, surface);
      const point = hit.point || this.getGearMountPoint(placement, hit.mount);
      const localSurfacePoint = point && context
        ? {
          x: point.x - (context.offsetX || 0),
          y: point.y - (context.offsetY || 0)
        }
        : hit.localSurfacePoint;
      const surfaceHit = {
        type: hit.hostKind === 'wall' ? 'wall' : 'tile',
        cell: hit.cell || { x: placement.x, y: placement.y, z: placement.z },
        edge: hit.edge || placement.edge || null,
        panelType: placement.panelType,
        gearSurfacePlane: true,
        surfaceSide: surface,
        localSurfacePoint,
        ...(hit.hostKind === 'wall' ? { wall: placement } : { tile: placement })
      };
      return {
        ...hitInfo,
        cell: surfaceHit.cell,
        edge: surfaceHit.edge,
        hit: surfaceHit,
        localPoint: point || hitInfo.localPoint
      };
    }

    drawGearCarryGhost(target) {
      if (!target?.point) return;
      const gears = this.carryState?.gears || [];
      if (gears.length <= 0) {
        this.drawGearComponentGhost(target);
        return;
      }
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

      const anchorGear = gears[0];
      const anchorLocal = getGearMountLocalPosition(anchorGear.mount.position);
      const targetLocal = getGearMountLocalPosition(target.socket);
      const usedKeys = new Set();
      gears.forEach((gear) => {
        const sourceLocal = getGearMountLocalPosition(gear.mount.position);
        const nextSocket = gears.length === 1
          ? target.socket
          : this.getNearestGearSocket({
            x: sourceLocal.x + (targetLocal.x - anchorLocal.x),
            y: sourceLocal.y + (targetLocal.y - anchorLocal.y)
          });
        if (!nextSocket) return;
        const candidate = (target.candidates || []).find((item) => item.socket === nextSocket);
        const point = candidate?.point || this.mapGearLocalPointToSurface(
          target.placement,
          getGearMountLocalPosition(nextSocket),
          { surface: target.surface }
        );
        if (!point) return;
        const usedKey = `${target.hostKey}:${target.surface}:${nextSocket}`;
        const duplicate = usedKeys.has(usedKey);
        usedKeys.add(usedKey);
        this.drawMountedGearPreview(this.ghostLayer, point, {
          placement: target.placement,
          mount: {
            ...gear.mount,
            position: nextSocket,
            socketKind: nextSocket === 'center' ? 'center' : 'corner',
            surface: target.surface,
            axisBinding: null
          },
          valid: !duplicate && candidate?.valid !== false,
          alpha: duplicate || candidate?.valid === false ? 0.72 : 0.9,
          ghost: true,
          angle: gear.mount.phase || 0
        });
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

    drawProjectedGearPhaseMarker(graphics, placement, centerLocal = {}, angle = 0, surface = 'front', extrusion = { x: 0, y: 0 }, { alpha = 0.9, color = 0xfacc15 } = {}) {
      if (!graphics || !placement) return;
      const direction = rotateLocalPoint({ x: 1, y: -0.24 }, angle);
      const startLocal = {
        x: (centerLocal.x || 0) + (direction.x * GEAR_AXLE_RADIUS_LOCAL * 0.8),
        y: (centerLocal.y || 0) + (direction.y * GEAR_AXLE_RADIUS_LOCAL * 0.8)
      };
      const endLocal = {
        x: (centerLocal.x || 0) + (direction.x * GEAR_HUB_RADIUS_LOCAL * 1.35),
        y: (centerLocal.y || 0) + (direction.y * GEAR_HUB_RADIUS_LOCAL * 1.35)
      };
      const start = this.mapGearLocalPointToSurface(placement, startLocal, { surface, allowOverflow: true });
      const end = this.mapGearLocalPointToSurface(placement, endLocal, { surface, allowOverflow: true });
      if (!start || !end) return;
      const lift = {
        x: (extrusion.x || 0) * 1.46,
        y: (extrusion.y || 0) * 1.46
      };
      const sx = start.x + lift.x;
      const sy = start.y + lift.y;
      const ex = end.x + lift.x;
      const ey = end.y + lift.y;
      graphics.lineStyle(4.6, 0x020617, alpha * 0.72);
      graphics.lineBetween(sx, sy, ex, ey);
      graphics.lineStyle(2.4, color, alpha);
      graphics.lineBetween(sx, sy, ex, ey);
      graphics.fillStyle(0x020617, alpha * 0.72);
      graphics.fillCircle(ex, ey, 3.1);
      graphics.fillStyle(0xfef3c7, alpha);
      graphics.fillCircle(ex, ey, 1.65);
    }

    drawGearBindingInvalidBadge(graphics, point, { alpha = 0.96 } = {}) {
      if (!graphics || !point) return;
      const x = point.x + 18;
      const y = point.y - 30;
      graphics.fillStyle(0x7f1d1d, 0.34 * alpha);
      graphics.fillCircle(x, y + 2, 11);
      graphics.fillStyle(0xfef2f2, 0.96 * alpha);
      graphics.fillCircle(x, y, 8.5);
      graphics.lineStyle(2, 0xdc2626, 0.92 * alpha);
      graphics.strokeCircle(x, y, 8.5);
      graphics.lineStyle(2.4, 0x991b1b, 0.96 * alpha);
      graphics.lineBetween(x, y - 4.5, x, y + 1.5);
      graphics.fillStyle(0x991b1b, 0.96 * alpha);
      graphics.fillCircle(x, y + 5.2, 1.7);
    }

    getProjectedSurfaceCircle(placement, centerLocal = {}, radius = 0.1, segments = 32, angle = 0, surface = 'front') {
      const points = [];
      const baseAngle = ((Number(angle) || 0) * Math.PI) / 180;
      for (let index = 0; index < segments; index += 1) {
        const theta = baseAngle + ((Math.PI * 2 * index) / segments);
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
      const baseAngleRadians = ((Number(angle) || 0) * Math.PI) / 180;
      const toothStep = (Math.PI * 2) / teeth;
      const profile = [
        { t: -0.5, r: GEAR_ROOT_RADIUS_LOCAL },
        { t: -0.28, r: GEAR_PITCH_RADIUS_LOCAL },
        { t: -0.11, r: GEAR_OUTER_RADIUS_LOCAL },
        { t: 0.11, r: GEAR_OUTER_RADIUS_LOCAL },
        { t: 0.28, r: GEAR_PITCH_RADIUS_LOCAL }
      ];
      for (let tooth = 0; tooth < teeth; tooth += 1) {
        const base = baseAngleRadians + (tooth * toothStep);
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
      const mount = options.mount || { position: 'center' };
      const placement = options.placement || null;
      const axisBindingInvalid = !!options.axisBindingInvalid;
      const attachStyle = GEAR_ATTACH_HIGHLIGHT_STYLE;
      const color = valid ? (selected ? attachStyle.SOURCE_RING_COLOR : 0x111827) : 0xef4444;
      const hubColor = axisBindingInvalid
        ? 0xef4444
        : selected
          ? attachStyle.SOURCE_ANCHOR_COLOR
          : mount.axisBinding
            ? attachStyle.GEAR_BOUND_HUB_COLOR
            : (valid ? 0xfacc15 : 0xfca5a5);
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
        this.drawProjectedExtrusionSides(
          graphics,
          hubBase,
          hub,
          mount.axisBinding ? attachStyle.GEAR_BOUND_SIDE_COLOR : 0x854d0e,
          options.ghost ? 0.54 : 0.8
        );
        this.drawProjectedSurfacePolygon(graphics, hub, hubColor, 0.96, 0x020617, 0.74, 1);
        this.drawProjectedGearPhaseMarker(graphics, placement, centerLocal, gearAngle, surface, extrusion, {
          alpha: options.ghost ? 0.62 : 0.9,
          color: selected ? attachStyle.SOURCE_RING_COLOR : 0xfacc15
        });
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
          this.drawProjectedSurfacePolygon(graphics, ring, attachStyle.SOURCE_GLOW_COLOR, 0.05, attachStyle.SOURCE_RING_COLOR, 0.88, 1.6);
        }
        if (axisBindingInvalid) this.drawGearBindingInvalidBadge(graphics, point, { alpha });
        return;
      }
      graphics.fillStyle(0x020617, options.ghost ? 0.18 : 0.26);
      graphics.fillEllipse(point.x, point.y + 5, 30, 10);
      graphics.lineStyle(options.ghost ? 2 : 1, valid ? (selected ? attachStyle.SOURCE_RING_COLOR : 0xfacc15) : 0xef4444, options.ghost ? 0.72 : 0.34);
      graphics.strokeEllipse(point.x, point.y + 5, 24, 8);
      graphics.fillStyle(0x020617, alpha);
      graphics.lineStyle(selected ? 4 : 3, color, selected ? 1 : 0.9);
      drawGearShape(graphics, point.x, point.y, 15, 11, 12, options.angle || 0);
      graphics.fillStyle(hubColor, 0.96);
      graphics.fillCircle(point.x, point.y, 5);
      graphics.fillStyle(0x020617, 0.74);
      graphics.fillCircle(point.x, point.y, 2);
      graphics.lineStyle(2, hubColor, 0.86);
      const markerAngle = ((options.angle || 0) * Math.PI) / 180;
      const markerEnd = {
        x: point.x + (Math.cos(markerAngle) * 11),
        y: point.y + (Math.sin(markerAngle) * 11)
      };
      graphics.lineBetween(point.x, point.y, markerEnd.x, markerEnd.y);
      graphics.fillCircle(markerEnd.x, markerEnd.y, 2.4);
      if (selected) {
        graphics.lineStyle(2, attachStyle.SOURCE_RING_COLOR, 0.86);
        graphics.strokeCircle(point.x, point.y, 19);
      }
      if (axisBindingInvalid) this.drawGearBindingInvalidBadge(graphics, point, { alpha });
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
        this.ghostLayer.lineStyle(2, mount.axisBinding ? GEAR_ATTACH_HIGHLIGHT_STYLE.GEAR_BOUND_HUB_COLOR : 0xf8fafc, 0.82);
        drawGearShape(this.ghostLayer, point.x, point.y, mount.position === 'center' ? 15 : 13, mount.position === 'center' ? 11 : 9, 10);
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
        supportPolygon = getTransmissionMidPlane(createEdgeWallGeometry(
          this.cameraState.yaw,
          supportPlacement.edge,
          null,
          getTransmissionSurfaceRotation(supportPlacement)
        ), 'wall');
        supportSurface = 'wall';
      } else {
        const supportGeometry = supportPlacement.isVertical
          ? createVerticalTileWallGeometry(this.cameraState.yaw, supportPlacement.rotation || 0, getTransmissionSurfaceRotation(supportPlacement))
          : createTileGeometry(this.cameraState.yaw, supportPlacement.rotation || 0);
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
        const wallRotation = getTransmissionSurfaceRotation(placement);
        const geometry = createEdgeWallGeometry(this.cameraState.yaw, placement.edge, null, wallRotation);
        [geometry.wall, geometry.wallSideStart, geometry.wallSideEnd, geometry.wallCap].forEach((points) => {
          drawPolygonShape(this.ghostLayer, points, offsetX, offsetY);
        });
        this.drawGhostBoardDetails({
          panelType: placement.panelType || this.activeTileType
        }, getTransmissionMidPlane(geometry, 'wall'), offsetX, offsetY, 0, 'wall');
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
          transmissionRotation: placement.transmissionRotation ?? placement.rotation ?? this.activeRotation,
          isVertical: !!placement.isVertical
        });
      const ghostSurface = ghostTile.isVertical ? 'wall' : 'floor';
      const geometry = ghostTile.isVertical
        ? createVerticalTileWallGeometry(this.cameraState.yaw, ghostTile.rotation || 0, getTransmissionSurfaceRotation(ghostTile))
        : createTileGeometry(this.cameraState.yaw, ghostTile.rotation || 0);
      const ghostPolygons = ghostTile.isVertical
        ? [geometry.wall, geometry.wallSideStart, geometry.wallSideEnd, geometry.wallCap]
        : [...geometry.sides, geometry.top];
      ghostPolygons.forEach((points) => {
        drawPolygonShape(this.ghostLayer, points, offsetX, offsetY);
      });
      const ghostTransmissionPlane = getTransmissionPortPlane(geometry, ghostSurface);
      this.drawGhostBoardDetails(
        ghostTile,
        ghostTransmissionPlane,
        offsetX,
        offsetY,
        ghostTile.isVertical ? 0 : getTransmissionSurfaceRotation(ghostTile),
        ghostSurface
      );
      if (isGearPressurePlatePanel(ghostTile.panelType)) {
        const pressureFace = ghostTile.isVertical ? (geometry.wallFront || geometry.wall) : geometry.top;
        const screenTop = Array.isArray(pressureFace) ? pressureFace.map((point) => ({
          x: point.x + offsetX,
          y: point.y + offsetY
        })) : [];
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
