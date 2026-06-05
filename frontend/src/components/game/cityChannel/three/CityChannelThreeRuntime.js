import * as THREE from 'three';
import { getCityChannelMaterial } from '../cityChannelCatalog';
import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  createCellKey,
  createWallKey,
  normalizeRotation,
  wallEdgeToRotation
} from '../cityChannelSchema';
import { computeCityChannelMovePreviewModel } from '../cityChannelMovePreview';
import {
  buildMechanicalAssemblies,
  findFixedAxisForTrigger,
  getAssemblyForCell,
  getGearAxisBindingStatus,
  getGearMountLocalPosition,
  getGearSocketKind,
  isCornerGearSocket,
  normalizeGearMount,
  normalizeMechanismParams
} from '../cityChannelMechanismRuntime';
import { hasDirectionalGearSurface, normalizeGearSurfaceForPanel } from '../cityChannelGearPressurePlateRender';
import { isPortalMaterial } from '../cityChannelPlacementGeometry';
import {
  buildGearContactGraph as buildGearContactGraphModel,
  CITY_CHANNEL_GEAR_AXLE_RADIUS_WORLD,
  CITY_CHANNEL_GEAR_HUB_RADIUS_WORLD,
  CITY_CHANNEL_GEAR_OUTER_RADIUS_WORLD,
  CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
  CITY_CHANNEL_GEAR_ROOT_RADIUS_WORLD,
  CITY_CHANNEL_GEAR_THICKNESS_WORLD,
  CITY_CHANNEL_GEAR_TOOTH_COUNT,
  createAxisBindingRuntimeEntryFromGearNode,
  createMechanismRuntimeSnapshot,
  findRotationObstruction,
  getAllowedRotationAngle,
  getAxisBindingForMount,
  getFixedAxisWorldAnchor,
  getGearMeshPlane,
  getGearRatioRadiusForMount,
  getGearSurfaceKey,
  getGearWorldPosition,
  isDrivenGearAxisBindingActive,
  resolveDrivenGearNodes as resolveDrivenGearNodesModel
} from '../cityChannelMechanismSimulation';
import {
  buildCityChannelThreeRenderModel,
  CITY_CHANNEL_THREE_DIMENSIONS,
  createThreeTilePlacementOperation,
  createThreeVerticalTilePlacementOperation,
  createThreeWallPlacementOperation,
  getThreeNearestCellEdge,
  getThreeVerticalFaceFloorPlacementCell,
  getThreeVerticalTilePlacementBlockReason,
  getThreeVerticalTileRotationForSupport,
  getThreeWallPlacementBlockReason,
  getThreeGearSurfacePoint,
  getThreeSurfaceNormal,
  getThreeSurfacePoint,
  getTileThreeTransform,
  getThreeTransmissionLineSegments,
  getThreeVerticalTopPlacementTarget,
  isThreePlacementVisible,
  getWallThreeTransform,
  resolveThreeHoverSnapIntent,
  threePositionToCell
} from './cityChannelThreeGeometry';
import { createCityChannelThreeMaterials } from './cityChannelThreeMaterials';

const CAMERA_VIEW_SIZE = 18;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 3;
const KEYBOARD_PAN_SPEED = 5.5;
const KEYBOARD_ROTATION_SPEED = 96;
const SELECTED_MOVE_HOLD_DELAY = 260;
const SELECTED_MOVE_CANCEL_DRAG_DISTANCE = 3;
const WALL_EDGE_SNAP_WORLD_RADIUS = 0.18;
const PRECISE_WALL_EDGE_SNAP_WORLD_RADIUS = 0.055;
const CENTER_REPLACEMENT_RADIUS = 0.31;
const VERTICAL_CENTER_REPLACEMENT_RADIUS = 0.22;
const GEAR_SOCKET_HOVER_RADIUS = CITY_CHANNEL_GEAR_OUTER_RADIUS_WORLD;
const GEAR_COMPONENT_TYPE = 'gear';
const GEAR_SOCKET_POSITIONS = ['center', 'corner_ne', 'corner_nw', 'corner_se', 'corner_sw'];
const GEAR_BINDING_EPSILON = 0.09;
const VERTICAL_PLACEMENT_RENDER_ORDER_BASE = 400;
const PLACEMENT_RENDER_ORDER_LAYER_STEP = 20;
const PLACEMENT_DETAIL_RENDER_ORDER_OFFSET = 2;
const SNAP_PRIORITIES = Object.freeze({
  VERTICAL_TOP: 500,
  VERTICAL_SIDE: 420,
  WALL_EDGE: 360,
  FLOOR_EDGE: 320,
  CENTER_REPLACE: 180,
  GROUND_WALL: 120,
  GROUND_FLOOR: 80
});
const HOVER_OVERLAY_RENDER_ORDER = 860;
const SELECTION_OVERLAY_RENDER_ORDER = 880;
const PLACEMENT_GHOST_RENDER_ORDER = 900;
const GEAR_DETAIL_RENDER_ORDER = HOVER_OVERLAY_RENDER_ORDER - 34;
const GEAR_CONTACT_RENDER_ORDER = HOVER_OVERLAY_RENDER_ORDER - 22;
const GEAR_BINDING_AMBIENT_RENDER_ORDER = HOVER_OVERLAY_RENDER_ORDER - 10;
const GEAR_BINDING_ACTIVE_RENDER_ORDER = SELECTION_OVERLAY_RENDER_ORDER + 8;
const MECHANISM_OBSTRUCTION_FLASH_RENDER_ORDER = SELECTION_OVERLAY_RENDER_ORDER + 18;

const createThreeGearGeometry = ({
  teeth = CITY_CHANNEL_GEAR_TOOTH_COUNT,
  rootRadius = CITY_CHANNEL_GEAR_ROOT_RADIUS_WORLD,
  pitchRadius = CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
  outerRadius = CITY_CHANNEL_GEAR_OUTER_RADIUS_WORLD,
  thickness = CITY_CHANNEL_GEAR_THICKNESS_WORLD
} = {}) => {
  const safeTeeth = Math.max(8, Math.round(Number(teeth) || CITY_CHANNEL_GEAR_TOOTH_COUNT));
  const toothStep = (Math.PI * 2) / safeTeeth;
  const profile = [
    { t: -0.5, r: rootRadius },
    { t: -0.28, r: pitchRadius },
    { t: -0.11, r: outerRadius },
    { t: 0.11, r: outerRadius },
    { t: 0.28, r: pitchRadius }
  ];
  const outline = [];
  for (let tooth = 0; tooth < safeTeeth; tooth += 1) {
    const base = tooth * toothStep;
    profile.forEach(({ t, r }) => {
      const theta = base + (t * toothStep);
      outline.push({
        x: Math.cos(theta) * r,
        z: Math.sin(theta) * r
      });
    });
  }

  const halfThickness = thickness * 0.5;
  const positions = [
    0, halfThickness, 0,
    0, -halfThickness, 0
  ];
  outline.forEach((point) => positions.push(point.x, halfThickness, point.z));
  outline.forEach((point) => positions.push(point.x, -halfThickness, point.z));

  const topCenter = 0;
  const bottomCenter = 1;
  const topStart = 2;
  const bottomStart = 2 + outline.length;
  const indices = [];
  for (let index = 0; index < outline.length; index += 1) {
    const next = (index + 1) % outline.length;
    indices.push(topCenter, topStart + index, topStart + next);
    indices.push(bottomCenter, bottomStart + next, bottomStart + index);
    indices.push(topStart + index, bottomStart + index, bottomStart + next);
    indices.push(topStart + index, bottomStart + next, topStart + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};

const createGearPlaneRingGeometry = (innerRadius, outerRadius, segments = 72) => {
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
};

const createGearPlaneCircleGeometry = (radius, segments = 32) => {
  const geometry = new THREE.CircleGeometry(radius, segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
};

const createGearTorusGeometry = (radius, tubeRadius, segments = 56) => {
  const geometry = new THREE.TorusGeometry(radius, tubeRadius, 8, segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
};

const createPortalHoodGeometry = () => {
  const halfWidth = 0.28;
  const halfDepth = 0.12;
  const frontHeight = 0.065;
  const rearHeight = 0.16;
  const positions = [
    -halfWidth, 0, -halfDepth,
    halfWidth, 0, -halfDepth,
    halfWidth, 0, halfDepth,
    -halfWidth, 0, halfDepth,
    -halfWidth, rearHeight, -halfDepth,
    halfWidth, rearHeight, -halfDepth,
    halfWidth, frontHeight, halfDepth,
    -halfWidth, frontHeight, halfDepth
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const createPortalArrowGeometry = () => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.075, -0.28);
  shape.lineTo(0.075, -0.28);
  shape.lineTo(0.075, 0.04);
  shape.lineTo(0.2, 0.04);
  shape.lineTo(0, 0.29);
  shape.lineTo(-0.2, 0.04);
  shape.lineTo(-0.075, 0.04);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
};

const disposeNode = (node) => {
  if (node.geometry && !node.userData?.sharedGeometry) node.geometry.dispose();
  if (node.material && !node.userData?.sharedMaterial) {
    const disposeMaterial = (material) => {
      material.map?.dispose?.();
      material.dispose?.();
    };
    if (Array.isArray(node.material)) node.material.forEach(disposeMaterial);
    else disposeMaterial(node.material);
  }
};

const clearGroup = (group) => {
  if (!group) return;
  [...group.children].forEach((child) => {
    group.remove(child);
    child.traverse?.(disposeNode);
    disposeNode(child);
  });
};

const getPlacementLabel = (placement = {}) => {
  const material = getCityChannelMaterial(placement.panelType);
  const base = material?.shortName || material?.name || placement.panelType || '板材';
  if (placement.edge) return `${base}：${placement.x},${placement.y},${placement.z} ${placement.edge}`;
  return `${base}：${placement.x},${placement.y},${placement.z}`;
};

const createCoordinateLabelSprite = (label) => {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 40;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(2, 6, 23, 0.72)';
  context.strokeStyle = 'rgba(125, 211, 252, 0.34)';
  context.lineWidth = 2;
  context.beginPath();
  if (typeof context.roundRect === 'function') context.roundRect(4, 6, 88, 28, 8);
  else context.rect(4, 6, 88, 28);
  context.fill();
  context.stroke();
  context.fillStyle = '#e0f2fe';
  context.font = '700 17px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 48, 20);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.72, 0.3, 1);
  return sprite;
};

export default class CityChannelThreeRuntime {
  constructor({
    mount,
    onStatusChange,
    ...initialConfig
  }) {
    const {
      mapData,
      activeTool = CITY_CHANNEL_TOOLS.BROWSE,
      activeTileType = null,
      activeComponentType = null,
      activeRotation = 0,
      activeLayer = 0,
      panelPose = 'floor',
      visibleLayerCutoff = null,
      selection = {},
      onCommitOperations = null
    } = initialConfig;
    this.mount = mount;
    this.onStatusChange = onStatusChange;
    this.config = {
      ...initialConfig,
      activeTool,
      activeTileType,
      activeComponentType,
      activeRotation,
      activeLayer,
      visibleLayerCutoff,
      panelPose,
      selection,
      onCommitOperations
    };
    this.materials = createCityChannelThreeMaterials();
    this.pickables = [];
    this.pointerState = null;
    this.longPressTimer = null;
    this.carryState = null;
    this.placementGroups = new Map();
    this.gearMeshes = new Map();
    this.mechanismPreviewTimer = null;
    this.mechanismPreviewFrame = null;
    this.mechanismRuntimeSnapshot = null;
    this.mechanismObstructionFlash = null;
    this.zoom = 1;
    this.cameraYaw = 45;
    this.cameraTarget = new THREE.Vector3(0, 0, 0);
    this.renderRequested = false;
    this.keyState = new Set();
    this.keyboardFrameId = null;
    this.lastKeyboardFrameAt = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020617);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.position.set(9, 8, 9);
    this.camera.lookAt(this.cameraTarget);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(this.renderer.domElement);
    this.selectionBoxElement = document.createElement('div');
    Object.assign(this.selectionBoxElement.style, {
      position: 'absolute',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '5',
      border: '1px solid rgba(34, 211, 238, 0.95)',
      background: 'rgba(34, 211, 238, 0.14)',
      boxShadow: '0 0 0 1px rgba(8, 47, 73, 0.72), 0 0 18px rgba(34, 211, 238, 0.24)'
    });
    mount.appendChild(this.selectionBoxElement);

    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this.overlayGroup = new THREE.Group();
    this.scene.add(this.overlayGroup);
    this.mechanismFlashGroup = new THREE.Group();
    this.scene.add(this.mechanismFlashGroup);
    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.34,
      depthTest: false,
      depthWrite: false
    });
    this.transmissionMaterial = new THREE.LineBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.92,
      depthWrite: false
    });
    this.transmissionCoreMaterial = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false
    });
    this.transmissionGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.28,
      depthTest: false,
      depthWrite: false
    });
    this.transmissionNodeMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.94,
      depthTest: false,
      depthWrite: false
    });
    this.gearMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.52,
      metalness: 0.42,
      emissive: 0x000000,
      emissiveIntensity: 0.04,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.gearSpokeMaterial = new THREE.MeshStandardMaterial({
      color: 0x9a4a12,
      roughness: 0.58,
      metalness: 0.36,
      emissive: 0x2b1204,
      emissiveIntensity: 0.08,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.gearHubMaterial = new THREE.MeshStandardMaterial({
      color: 0xf08a24,
      roughness: 0.42,
      metalness: 0.5,
      emissive: 0x4a1903,
      emissiveIntensity: 0.12,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.gearAxleMaterial = new THREE.MeshStandardMaterial({
      color: 0xc45a12,
      roughness: 0.36,
      metalness: 0.62,
      emissive: 0x2b1204,
      emissiveIntensity: 0.1,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.gearEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.38,
      depthTest: false,
      depthWrite: false
    });
    this.gearReliefMaterial = new THREE.MeshBasicMaterial({
      color: 0xb45309,
      transparent: true,
      opacity: 0.18,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.gearHaloMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.08,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.gearTimingMarkerMaterial = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.34,
      depthTest: false,
      depthWrite: false
    });
    this.gearContactMaterial = new THREE.MeshBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 0.58,
      depthTest: false,
      depthWrite: false
    });
    this.gearContactActiveMaterial = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.86,
      depthTest: false,
      depthWrite: false
    });
    this.portalDeckMaterial = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.48,
      metalness: 0.52
    });
    this.portalFrameMaterial = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.34,
      metalness: 0.68
    });
    this.portalHoodMaterial = new THREE.MeshStandardMaterial({
      color: 0x273449,
      roughness: 0.42,
      metalness: 0.58
    });
    this.portalAttachmentEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.46,
      depthTest: false,
      depthWrite: false
    });
    this.entranceMarkerMaterial = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.32,
      metalness: 0.22,
      emissive: 0x075985,
      emissiveIntensity: 0.72
    });
    this.exitMarkerMaterial = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.32,
      metalness: 0.22,
      emissive: 0x92400e,
      emissiveIntensity: 0.68
    });
    this.entranceMarkerGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.42,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.exitMarkerGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xfcd34d,
      transparent: true,
      opacity: 0.42,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.hoverMaterial = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.34,
      depthTest: false,
      depthWrite: false
    });
    this.hoverOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0xa5f3fc,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false
    });
    this.hoverGlowMaterial = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.56,
      depthTest: false,
      depthWrite: false
    });
    this.selectionMaterial = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.42,
      depthTest: false,
      depthWrite: false
    });
    this.selectionOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false
    });
    this.selectionGlowMaterial = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.86,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingLineMaterial = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.72,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingCandidateMaterial = new THREE.MeshBasicMaterial({
      color: 0xfef3c7,
      transparent: true,
      opacity: 0.86,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingActiveMaterial = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingAmbientCurveMaterial = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.56,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingAmbientGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0x451a03,
      transparent: true,
      opacity: 0.16,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingAmbientBoardMaterial = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.075,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingAmbientOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 0.66,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingActiveCurveMaterial = new THREE.MeshBasicMaterial({
      color: 0xf8fbff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingActiveGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.24,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingActiveBoardMaterial = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.13,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingActiveOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingInvalidMaterial = new THREE.MeshBasicMaterial({
      color: 0xdc2626,
      transparent: true,
      opacity: 0.94,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.gearBindingInvalidFillMaterial = new THREE.MeshBasicMaterial({
      color: 0xfef2f2,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.gearBindingInvalidGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0x7f1d1d,
      transparent: true,
      opacity: 0.28,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.gearBindingInvalidBoardMaterial = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.12,
      depthTest: false,
      depthWrite: false
    });
    this.gearBindingInvalidOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0xfca5a5,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false
    });
    this.mechanismObstructionFillMaterial = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false
    });
    this.mechanismObstructionOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false
    });
    this.mechanismObstructionGlowMaterial = new THREE.LineBasicMaterial({
      color: 0xdc2626,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false
    });
    this.ghostValidMaterial = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.48,
      depthTest: false,
      depthWrite: false
    });
    this.ghostInvalidMaterial = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.4,
      depthTest: false,
      depthWrite: false
    });
    this.ghostValidOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0xbbf7d0,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false
    });
    this.ghostInvalidOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0xfca5a5,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false
    });
    this.gearGeometry = createThreeGearGeometry();
    this.gearEdgeGeometry = new THREE.EdgesGeometry(this.gearGeometry, 12);
    this.gearSpokeGeometry = new THREE.BoxGeometry(
      CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD * 1.34,
      CITY_CHANNEL_GEAR_THICKNESS_WORLD * 0.76,
      CITY_CHANNEL_GEAR_ROOT_RADIUS_WORLD * 0.12
    );
    this.gearHubGeometry = new THREE.CylinderGeometry(
      CITY_CHANNEL_GEAR_HUB_RADIUS_WORLD,
      CITY_CHANNEL_GEAR_HUB_RADIUS_WORLD,
      CITY_CHANNEL_GEAR_THICKNESS_WORLD * 1.72,
      28
    );
    this.gearAxleGeometry = new THREE.CylinderGeometry(
      CITY_CHANNEL_GEAR_AXLE_RADIUS_WORLD,
      CITY_CHANNEL_GEAR_AXLE_RADIUS_WORLD,
      CITY_CHANNEL_GEAR_THICKNESS_WORLD * 2,
      20
    );
    this.gearInnerRingGeometry = createGearTorusGeometry(
      CITY_CHANNEL_GEAR_HUB_RADIUS_WORLD * 1.38,
      CITY_CHANNEL_GEAR_THICKNESS_WORLD * 0.055,
      52
    );
    this.gearOuterRingGeometry = createGearTorusGeometry(
      CITY_CHANNEL_GEAR_ROOT_RADIUS_WORLD * 0.9,
      CITY_CHANNEL_GEAR_THICKNESS_WORLD * 0.045,
      64
    );
    this.gearHaloGeometry = createGearPlaneRingGeometry(
      CITY_CHANNEL_GEAR_OUTER_RADIUS_WORLD * 1.02,
      CITY_CHANNEL_GEAR_OUTER_RADIUS_WORLD * 1.16,
      72
    );
    this.gearTimingMarkerGeometry = new THREE.SphereGeometry(
      CITY_CHANNEL_GEAR_AXLE_RADIUS_WORLD * 0.78,
      14,
      8
    );
    this.gearContactMarkerGeometry = new THREE.SphereGeometry(0.05, 14, 8);
    this.portalDeckGeometry = new THREE.BoxGeometry(0.58, 0.028, 0.72);
    this.portalRailGeometry = new THREE.BoxGeometry(0.075, 0.055, 0.78);
    this.portalLipGeometry = new THREE.BoxGeometry(0.58, 0.055, 0.075);
    this.portalLaneGeometry = new THREE.BoxGeometry(0.18, 0.014, 0.52);
    this.portalBeaconGeometry = new THREE.CylinderGeometry(0.034, 0.034, 0.052, 16);
    this.portalHoodGeometry = createPortalHoodGeometry();
    this.portalHoodEdgeGeometry = new THREE.EdgesGeometry(this.portalHoodGeometry, 12);
    this.portalArrowGeometry = createPortalArrowGeometry();
    this.ghostGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.gearBindingMarkerGeometry = new THREE.SphereGeometry(0.055, 12, 8);
    this.gearSocketMarkerGeometry = new THREE.SphereGeometry(0.035, 12, 8);
    this.gearBindingArrowGeometry = new THREE.ConeGeometry(0.055, 0.16, 16);
    this.gearBindingInvalidBadgeRingGeometry = createGearPlaneRingGeometry(0.052, 0.078, 28);
    this.gearBindingInvalidBadgeFillGeometry = createGearPlaneCircleGeometry(0.052, 28);
    this.gearBindingInvalidStemGeometry = new THREE.BoxGeometry(0.018, 0.012, 0.056);
    this.gearBindingInvalidDotGeometry = new THREE.SphereGeometry(0.012, 8, 6);
    this.transmissionNodeGeometry = new THREE.SphereGeometry(0.052, 14, 8);

    this.scene.add(new THREE.HemisphereLight(0xf8fafc, 0x172033, 1.35));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.12);
    keyLight.position.set(4, 9, 5);
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x67e8f9, 0.38);
    fillLight.position.set(-5, 3, -4);
    this.scene.add(fillLight);

    this.raycaster = new THREE.Raycaster();
    this.selectionRaycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.hasPointerRay = false;
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.groundHitPoint = new THREE.Vector3();
    this.hoverMesh = null;
    this.hoverHit = null;
    this.selectedMesh = null;
    this.selectedMeshes = [];
    this.placementTarget = null;
    this.lastPointerEvent = null;

    this.handleResize = this.handleResize.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerUp);
    this.renderer.domElement.addEventListener('wheel', this.handleWheel, { passive: false });
    this.renderer.domElement.addEventListener('contextmenu', this.handleContextMenu);

    this.handleResize();
    this.setMapData(mapData);
    this.config.onSceneReady?.(this);
  }

  setMapData(mapData) {
    this.renderModel = buildCityChannelThreeRenderModel(mapData);
    this.rebuildMap();
  }

  getRuntimeTransform(transform = null) {
    if (!transform?.key) return transform;
    const runtimePlacement = this.mechanismRuntimeSnapshot?.placements?.[transform.key];
    if (!runtimePlacement) return transform;
    const placement = {
      ...(transform.placement || {}),
      ...runtimePlacement
    };
    const mapData = this.renderModel?.mapData || {};
    const runtimeTransform = (transform.kind === 'wall' || placement.edge)
      ? getWallThreeTransform(placement, mapData)
      : getTileThreeTransform(placement, mapData);
    return {
      ...runtimeTransform,
      key: transform.key,
      kind: transform.kind,
      edge: transform.edge,
      placement,
      visibilityPlacement: transform.placement
    };
  }

  getRuntimeRenderTransforms() {
    return [
      ...(this.renderModel?.tiles || []),
      ...(this.renderModel?.walls || [])
    ].map((transform) => this.getRuntimeTransform(transform));
  }

  getRuntimePlacementMatrix(transform = null, runtimePlacement = null) {
    if (!transform?.placement || !runtimePlacement) return null;
    const angle = Number(runtimePlacement.runtimeAngle);
    if (!Number.isFinite(angle) || Math.abs(angle) <= 0.000001) return new THREE.Matrix4();
    const fixedTransform = runtimePlacement.runtimeFixedComponentKey
      ? (this.getBasePlacementTransform?.(runtimePlacement.runtimeFixedComponentKey) || transform)
      : transform;
    const mountId = runtimePlacement.runtimeFixedMountId || runtimePlacement.runtimeAxisBindingMountId;
    const surface = runtimePlacement.runtimeAxisSurface || 'front';
    const mount = (fixedTransform.placement?.gearMounts || []).find((item) => item.id === mountId)
      || (runtimePlacement.runtimeAxisSocket ? {
        position: runtimePlacement.runtimeAxisSocket,
        surface
      } : null);
    const pivot = mount
      ? getThreeGearSurfacePoint(fixedTransform, mount)
      : (runtimePlacement.runtimeAnchorLocal ? getThreeSurfacePoint(fixedTransform, runtimePlacement.runtimeAnchorLocal, {
        lift: (CITY_CHANNEL_GEAR_THICKNESS_WORLD * 0.5) + 0.012,
        rotate: fixedTransform.kind === 'tile',
        surface
      }) : null);
    const normal = getThreeSurfaceNormal(fixedTransform, mount?.surface || surface);
    if (!pivot || !normal) return null;
    const axis = new THREE.Vector3(normal.x || 0, normal.y || 0, normal.z || 0);
    if (axis.lengthSq() <= 0.000001) return null;
    axis.normalize();
    const pivotMatrix = new THREE.Matrix4().makeTranslation(pivot.x || 0, pivot.y || 0, pivot.z || 0);
    const rotationMatrix = new THREE.Matrix4().makeRotationAxis(axis, -(angle * Math.PI / 180));
    const unpivotMatrix = new THREE.Matrix4().makeTranslation(-(pivot.x || 0), -(pivot.y || 0), -(pivot.z || 0));
    return pivotMatrix.multiply(rotationMatrix).multiply(unpivotMatrix);
  }

  applyPlacementGroupMatrix(group = null, matrix = null) {
    if (!group) return;
    group.matrixAutoUpdate = false;
    group.matrix.copy(matrix || new THREE.Matrix4());
    group.matrixWorldNeedsUpdate = true;
    group.updateMatrixWorld(true);
  }

  syncMechanismRuntimeTransforms() {
    const snapshot = this.mechanismRuntimeSnapshot || null;
    const placements = snapshot?.placements || {};
    (this.placementGroups || new Map()).forEach((group, key) => {
      const baseTransform = group.userData?.cityChannelPlacement?.baseTransform || null;
      const matrix = this.getRuntimePlacementMatrix(baseTransform, placements[key]);
      this.applyPlacementGroupMatrix(group, matrix);
    });
    (this.gearMeshes || new Map()).forEach((gear, gearKey) => {
      this.syncGearMeshRuntimeTransform(gear, gearKey, placements, snapshot);
    });
    this.syncSelectionFromConfig?.();
    this.requestRender?.();
    this.emitStatus?.();
  }

  setMechanismRuntimeSnapshot(snapshot = null) {
    const hadSnapshot = !!this.mechanismRuntimeSnapshot;
    this.mechanismRuntimeSnapshot = snapshot || null;
    this.config.onMechanismRuntimeSnapshot?.(this.mechanismRuntimeSnapshot);
    if (hadSnapshot || snapshot) this.syncMechanismRuntimeTransforms();
  }

  hasMechanismRuntimePreview() {
    return !!this.mechanismRuntimeSnapshot || !!this.mechanismPreviewFrame || !!this.mechanismPreviewTimer;
  }

  shouldCancelMechanismRuntimePreviewForConfig(next = {}) {
    if (!this.hasMechanismRuntimePreview()) return false;
    if (next.mapData && next.mapData !== this.renderModel?.mapData) return true;
    return [
      'activeTool',
      'activeTileType',
      'activeComponentType',
      'activeRotation',
      'activeLayer',
      'panelPose'
    ].some((key) => (
      Object.prototype.hasOwnProperty.call(next, key)
      && next[key] !== this.config[key]
    ));
  }

  updateConfig(next = {}) {
    const nextMapData = next.mapData;
    const shouldRebuildForConfig = (
      next.visibleLayerCutoff !== undefined && next.visibleLayerCutoff !== this.config.visibleLayerCutoff
    ) || (
      next.showHelperGrid !== undefined && next.showHelperGrid !== this.config.showHelperGrid
    ) || (
      next.showCoordinates !== undefined && next.showCoordinates !== this.config.showCoordinates
    ) || (
      next.wallViewMode !== undefined && next.wallViewMode !== this.config.wallViewMode
    );
    if (this.shouldCancelMechanismRuntimePreviewForConfig(next)) {
      this.cancelMechanismRuntimePreview();
    }
    this.setConfig(next);
    if (nextMapData && nextMapData !== this.renderModel?.mapData) {
      this.setMapData(nextMapData);
    } else if (shouldRebuildForConfig) {
      this.rebuildMap();
    }
  }

  setConfig(next = {}) {
    this.config = {
      ...this.config,
      ...next
    };
    this.updateActiveGhost();
    this.syncSelectionFromConfig();
    this.emitStatus();
    this.emitCamera();
    this.requestRender();
  }

  notifyStatus(message) {
    this.onStatusChange?.(message);
    this.config.onHoverStatusChange?.(message);
  }

  emitCamera() {
    this.config.onCameraChange?.({
      zoom: this.zoom,
      yaw: this.cameraYaw
    });
  }

  rebuildMap() {
    clearGroup(this.worldGroup);
    this.pickables = [];
    this.placementGroups = new Map();
    this.gearMeshes = new Map();
    this.hoverMesh = null;
    this.hoverHit = null;
    this.hoverOverlayGroup = null;
    this.selectedMesh = null;
    this.selectedMeshes = [];
    this.selectionOverlay = null;
    this.selectionOverlays = [];
    this.placementTarget = null;
    this.ghostMesh = null;
    this.ghostGroup = null;
    this.carryGhostGroup = null;
    const visibleLayerCutoff = Number.isFinite(Number(this.config.visibleLayerCutoff))
      ? Number(this.config.visibleLayerCutoff)
      : null;
    const transforms = [
      ...(this.renderModel?.tiles || []),
      ...(this.renderModel?.walls || [])
    ].filter((transform) => isThreePlacementVisible(transform.placement, {
      mapData: this.renderModel?.mapData || {},
      visibleLayerCutoff
    }));
    const visibleComponentKeys = new Set(transforms.map((transform) => transform.key));

    transforms.forEach((transform) => {
      const group = this.createPlacementRenderGroup(transform);
      this.worldGroup.add(group);
      this.placementGroups.set(transform.key, group);
    });

    this.addGearContactVisuals(visibleComponentKeys);
    this.addGroundGrid();
    this.addCoordinateLabels();
    this.syncMechanismRuntimeTransforms();
    this.syncSelectionFromConfig();
    this.requestRender();
    this.emitStatus();
  }

  createPlacementRenderGroup(transform = null) {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.userData.cityChannelPlacement = {
      key: transform?.key || '',
      baseTransform: transform
    };
    const mesh = this.createPlacementMesh(transform);
    group.add(mesh);
    this.pickables.push(mesh);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      this.edgeMaterial
    );
    edge.userData.sharedMaterial = true;
    edge.position.copy(mesh.position);
    edge.rotation.copy(mesh.rotation);
    edge.scale.copy(mesh.scale);
    edge.renderOrder = this.getPlacementRenderOrder(transform, 1);
    group.add(edge);
    this.addPlacementDetails(transform, this.getPlacementRenderOrder(transform, PLACEMENT_DETAIL_RENDER_ORDER_OFFSET), group);
    return group;
  }

  createPlacementMesh(transform) {
    const geometry = new THREE.BoxGeometry(transform.size.x, transform.size.y, transform.size.z);
    const top = this.materials.getMaterial(transform.panelType, 'top');
    const side = this.materials.getMaterial(transform.panelType, 'side');
    const isVerticalSurface = transform.kind === 'wall' || transform.kind === 'verticalTile';
    const wallViewMode = this.config.wallViewMode || 'semi';
    const shouldCloneWallMaterials = isVerticalSurface && wallViewMode !== 'solid';
    const materialOpacity = wallViewMode === 'perspective' ? 0.38 : 0.72;
    top.side = THREE.DoubleSide;
    side.side = THREE.DoubleSide;
    const meshMaterials = shouldCloneWallMaterials
      ? [side, side, top, side, side, side].map((material) => {
        const clone = material.clone();
        clone.transparent = true;
        clone.opacity = materialOpacity;
        clone.depthTest = false;
        clone.depthWrite = false;
        clone.side = THREE.DoubleSide;
        return clone;
      })
      : [side, side, top, side, side, side];
    const mesh = new THREE.Mesh(geometry, meshMaterials);
    mesh.userData.sharedMaterial = !shouldCloneWallMaterials;
    mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
    mesh.rotation.y = transform.rotationY || 0;
    mesh.renderOrder = this.getPlacementRenderOrder(transform);
    mesh.userData.cityChannel = {
      kind: transform.kind,
      key: transform.key,
      placement: transform.placement,
      transform
    };
    return mesh;
  }

  getPlacementRenderOrder(transform = {}, offset = 0) {
    const layer = Number(transform.placement?.z) || 0;
    const isVerticalSurface = transform.kind === 'wall' || transform.kind === 'verticalTile';
    return (
      (isVerticalSurface ? VERTICAL_PLACEMENT_RENDER_ORDER_BASE : 0)
      + (layer * PLACEMENT_RENDER_ORDER_LAYER_STEP)
      + offset
    );
  }

  getPlacementSelectionFromData(data = null) {
    if (!data?.placement) return null;
    if (data.kind === 'gear') {
      return {
        cells: [],
        walls: [],
        gears: [{
          hostKind: data.hostKind || 'tile',
          hostKey: data.hostKey,
          mountId: data.mount?.id,
          cell: data.cell,
          edge: data.edge || null
        }],
        scope: 'component'
      };
    }
    if (data.kind === 'wall' || data.placement.edge) {
      return {
        cells: [],
        walls: [{
          x: data.placement.x,
          y: data.placement.y,
          z: data.placement.z,
          edge: data.placement.edge
        }],
        gears: [],
        scope: 'board'
      };
    }
    return {
      cells: [{
        x: data.placement.x,
        y: data.placement.y,
        z: data.placement.z
      }],
      walls: [],
      gears: [],
      scope: 'board'
    };
  }

  emitSelection(selection = {}) {
    const normalized = {
      cells: selection.cells || [],
      walls: selection.walls || [],
      gears: selection.gears || [],
      scope: selection.scope || null
    };
    this.config.selection = normalized;
    this.config.onSelectionChange?.(normalized);
    this.syncSelectionFromConfig();
  }

  setSelection(cells = [], walls = [], gears = [], scope = null) {
    this.emitSelection({
      cells,
      walls,
      gears,
      scope: scope || (gears.length ? 'component' : (cells.length || walls.length) ? 'board' : null)
    });
  }

  getMeshSelectionKey(mesh = null) {
    const data = mesh?.userData?.cityChannel;
    if (!data) return '';
    if (data.kind === 'gear') return `gear:${data.hostKind || 'tile'}:${data.hostKey}:${data.mount?.id || ''}`;
    if (data.kind === 'wall' || data.placement?.edge) {
      const placement = data.placement;
      return `wall:${createWallKey(placement.x, placement.y, placement.z, placement.edge)}`;
    }
    const placement = data.placement;
    return placement ? `tile:${createCellKey(placement.x, placement.y, placement.z)}` : '';
  }

  getSelectionKeys(selection = this.config.selection || {}) {
    const keys = new Set();
    (selection.cells || []).forEach((cell) => {
      keys.add(`tile:${createCellKey(cell.x, cell.y, cell.z)}`);
    });
    (selection.walls || []).forEach((wall) => {
      keys.add(`wall:${createWallKey(wall.x, wall.y, wall.z, wall.edge)}`);
    });
    (selection.gears || []).forEach((gear) => {
      keys.add(`gear:${gear.hostKind || 'tile'}:${gear.hostKey}:${gear.mountId || ''}`);
    });
    return keys;
  }

  syncSelectionFromConfig() {
    const keys = this.getSelectionKeys();
    this.selectedMeshes = this.pickables.filter((mesh) => keys.has(this.getMeshSelectionKey(mesh)));
    this.selectedMesh = this.selectedMeshes[0] || null;
  }

  createBoardOverlayGroup({
    fillMaterial,
    outlineMaterial,
    glowMaterial,
    renderOrder = SELECTION_OVERLAY_RENDER_ORDER
  } = {}) {
    const group = new THREE.Group();
    group.renderOrder = renderOrder;

    const fill = new THREE.Mesh(this.ghostGeometry, fillMaterial);
    fill.userData.sharedGeometry = true;
    fill.userData.sharedMaterial = true;
    fill.renderOrder = renderOrder;
    group.add(fill);

    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(this.ghostGeometry), outlineMaterial);
    outline.userData.sharedMaterial = true;
    outline.renderOrder = renderOrder + 1;
    group.add(outline);

    const glow = new THREE.LineSegments(new THREE.EdgesGeometry(this.ghostGeometry), glowMaterial);
    glow.userData.sharedMaterial = true;
    glow.renderOrder = renderOrder + 2;
    group.add(glow);

    group.userData.fill = fill;
    group.userData.outline = outline;
    group.userData.glow = glow;
    group.visible = false;
    return group;
  }

  syncOverlayEdgeGeometry(line = null, sourceGeometry = null) {
    if (!line || !sourceGeometry || line.userData.sourceGeometry === sourceGeometry) return;
    if (line.geometry && !line.userData.sharedGeometry) line.geometry.dispose();
    line.geometry = new THREE.EdgesGeometry(sourceGeometry);
    line.userData.sourceGeometry = sourceGeometry;
  }

  syncBoardOverlayGroup(group = null, mesh = null, {
    fillScale = 1.024,
    outlineScale = 1.034,
    glowScale = 1.055,
    renderOrder = SELECTION_OVERLAY_RENDER_ORDER
  } = {}) {
    if (!group || !mesh) return;
    const { fill, outline, glow } = group.userData || {};
    if (!fill || !outline || !glow) return;
    this.syncOverlayEdgeGeometry(outline, mesh.geometry);
    this.syncOverlayEdgeGeometry(glow, mesh.geometry);
    fill.geometry = mesh.geometry;
    fill.userData.sharedGeometry = true;
    const baseRenderOrder = Math.max(
      renderOrder,
      (Number.isFinite(mesh.renderOrder) ? mesh.renderOrder : 0) + 12
    );

    mesh.updateWorldMatrix(true, false);
    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    mesh.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);

    const syncObject = (object, scaleFactor, orderOffset) => {
      object.position.copy(worldPosition);
      object.quaternion.copy(worldQuaternion);
      object.scale.copy(worldScale).multiplyScalar(scaleFactor);
      object.renderOrder = baseRenderOrder + orderOffset;
      object.visible = true;
    };

    syncObject(fill, fillScale, 0);
    syncObject(outline, outlineScale, 1);
    syncObject(glow, glowScale, 2);
    group.renderOrder = baseRenderOrder;
    group.visible = true;
  }

  addPlacementDetails(transform, renderOrder = 0, targetGroup = this.worldGroup) {
    this.addTransmissionLines(transform, renderOrder, targetGroup);
    this.addGearMounts(transform, renderOrder, targetGroup);
    this.addPortalAttachment(transform, renderOrder, targetGroup);
  }

  addTransmissionLines(transform, renderOrder = 0, targetGroup = this.worldGroup) {
    const segments = getThreeTransmissionLineSegments(transform);
    if (segments.length <= 0) return;
    const points = [];
    const nodeKeys = new Set();
    const appendNode = (point, scale = 1) => {
      const key = `${point.x.toFixed(3)}:${point.y.toFixed(3)}:${point.z.toFixed(3)}`;
      if (nodeKeys.has(key)) return;
      nodeKeys.add(key);
      const node = new THREE.Mesh(this.transmissionNodeGeometry, this.transmissionNodeMaterial);
      node.userData.sharedGeometry = true;
      node.userData.sharedMaterial = true;
      node.scale.setScalar(scale);
      node.position.set(point.x, point.y, point.z);
      node.renderOrder = renderOrder + 2;
      targetGroup.add(node);
    };
    segments.forEach(({ start, end }) => {
      points.push(new THREE.Vector3(start.x, start.y, start.z));
      points.push(new THREE.Vector3(end.x, end.y, end.z));
      this.addTransmissionTube(start, end, 0.052, this.transmissionGlowMaterial, renderOrder, targetGroup);
      this.addTransmissionTube(start, end, 0.018, this.transmissionCoreMaterial, renderOrder + 1, targetGroup);
      appendNode(start, 1.18);
      appendNode(end, 0.92);
    });
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      this.transmissionMaterial
    );
    lines.userData.sharedMaterial = true;
    lines.renderOrder = renderOrder + 1;
    targetGroup.add(lines);
  }

  addTransmissionTube(start = null, end = null, radius = 0.02, material = this.transmissionCoreMaterial, renderOrder = 0, targetGroup = this.worldGroup) {
    if (!start || !end) return;
    const from = new THREE.Vector3(start.x, start.y, start.z);
    const to = new THREE.Vector3(end.x, end.y, end.z);
    const direction = to.clone().sub(from);
    const length = direction.length();
    if (length <= 0.001) return;
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 12);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.sharedMaterial = true;
    mesh.position.copy(from.add(to).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.renderOrder = renderOrder;
    targetGroup.add(mesh);
  }

  createTransmissionTubeMesh(start = null, end = null, radius = 0.02, material = this.transmissionCoreMaterial) {
    if (!start || !end) return null;
    const from = new THREE.Vector3(start.x, start.y, start.z);
    const to = new THREE.Vector3(end.x, end.y, end.z);
    const direction = to.clone().sub(from);
    const length = direction.length();
    if (length <= 0.001) return null;
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 12);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.sharedMaterial = true;
    mesh.position.copy(from.add(to).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  }

  createBoardGhostGroup(transform = null, { valid = true, showGearSockets = false, previewMount = null } = {}) {
    if (!transform?.size || !transform?.position) return null;
    const group = new THREE.Group();
    const catalogItem = getCityChannelMaterial(transform.panelType || transform.placement?.panelType);
    const detailTransform = {
      ...transform,
      placement: {
        ...(transform.placement || {}),
        panelType: transform.panelType || transform.placement?.panelType,
        transmissionSkeleton: transform.placement?.transmissionSkeleton || catalogItem.transmissionSkeleton || null,
        gearMounts: Array.isArray(transform.placement?.gearMounts)
          ? transform.placement.gearMounts
          : (catalogItem.gearMounts || [])
      }
    };
    const material = valid ? this.ghostValidMaterial : this.ghostInvalidMaterial;
    const outlineMaterial = valid ? this.ghostValidOutlineMaterial : this.ghostInvalidOutlineMaterial;
    const renderOrder = Math.max(
      PLACEMENT_GHOST_RENDER_ORDER,
      this.getPlacementRenderOrder(detailTransform, 8)
    );
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(detailTransform.size.x, detailTransform.size.y, detailTransform.size.z),
      material
    );
    body.userData.sharedMaterial = true;
    body.position.set(detailTransform.position.x, detailTransform.position.y, detailTransform.position.z);
    body.rotation.y = detailTransform.rotationY || 0;
    body.renderOrder = renderOrder;
    group.add(body);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry),
      outlineMaterial
    );
    edges.userData.sharedMaterial = true;
    edges.position.copy(body.position);
    edges.rotation.copy(body.rotation);
    edges.scale.set(1.018, 1.018, 1.018);
    edges.renderOrder = renderOrder + 1;
    group.add(edges);

    const segments = getThreeTransmissionLineSegments(detailTransform);
    const nodeKeys = new Set();
    const addNode = (point, scale = 1) => {
      const key = `${point.x.toFixed(3)}:${point.y.toFixed(3)}:${point.z.toFixed(3)}`;
      if (nodeKeys.has(key)) return;
      nodeKeys.add(key);
      const node = new THREE.Mesh(this.transmissionNodeGeometry, this.transmissionNodeMaterial);
      node.userData.sharedGeometry = true;
      node.userData.sharedMaterial = true;
      node.scale.setScalar(scale);
      node.position.set(point.x, point.y, point.z);
      node.renderOrder = renderOrder + 4;
      group.add(node);
    };
    segments.forEach(({ start, end }) => {
      const glow = this.createTransmissionTubeMesh(start, end, 0.052, this.transmissionGlowMaterial);
      const core = this.createTransmissionTubeMesh(start, end, 0.018, this.transmissionCoreMaterial);
      if (glow) {
        glow.renderOrder = renderOrder + 2;
        group.add(glow);
      }
      if (core) {
        core.renderOrder = renderOrder + 3;
        group.add(core);
      }
      addNode(start, 1.18);
      addNode(end, 0.92);
    });

    if (showGearSockets) {
      const occupied = new Set((detailTransform.placement?.gearMounts || []).map((mount) => (
        `${mount.position}:${normalizeGearSurfaceForPanel(detailTransform.placement.panelType, mount.surface || 'front')}`
      )));
      GEAR_SOCKET_POSITIONS.forEach((socket) => {
        const surface = normalizeGearSurfaceForPanel(detailTransform.placement?.panelType, 'front');
        const marker = new THREE.Mesh(
          this.gearSocketMarkerGeometry,
          occupied.has(`${socket}:${surface}`) ? this.ghostInvalidMaterial : this.gearBindingCandidateMaterial
        );
        marker.userData.sharedGeometry = true;
        marker.userData.sharedMaterial = true;
        marker.scale.setScalar(socket === 'center' ? 1.35 : 1);
        const point = getThreeGearSurfacePoint(detailTransform, { position: socket, surface });
        marker.position.set(point.x, point.y, point.z);
        marker.renderOrder = renderOrder + 4;
        group.add(marker);
      });
    }

    (detailTransform.placement?.gearMounts || []).forEach((mount) => {
      if (!mount?.position) return;
      const point = getThreeGearSurfacePoint(detailTransform, mount);
      const gear = new THREE.Mesh(this.gearGeometry, this.gearBindingActiveMaterial);
      gear.userData.sharedGeometry = true;
      gear.userData.sharedMaterial = true;
      gear.scale.setScalar(0.92);
      gear.position.set(point.x, point.y, point.z);
      gear.quaternion.copy(this.getGearSurfaceQuaternion(detailTransform, mount.surface || 'front'));
      gear.renderOrder = renderOrder + 4;
      this.addGearVisualDetails(gear, gear.renderOrder);
      group.add(gear);
    });

    if (previewMount?.position) {
      const point = getThreeGearSurfacePoint(detailTransform, previewMount);
      const gear = new THREE.Mesh(this.gearGeometry, this.gearBindingActiveMaterial);
      gear.userData.sharedGeometry = true;
      gear.userData.sharedMaterial = true;
      gear.scale.setScalar(1.18);
      gear.position.set(point.x, point.y, point.z);
      gear.quaternion.copy(this.getGearSurfaceQuaternion(detailTransform, previewMount.surface || 'front'));
      gear.renderOrder = renderOrder + 5;
      this.addGearVisualDetails(gear, gear.renderOrder);
      group.add(gear);
    }

    this.addPortalAttachment(detailTransform, renderOrder + 1, group);
    return group;
  }

  replaceGhostGroup(propertyName, group = null) {
    const existing = this[propertyName];
    if (existing) {
      this.worldGroup.remove(existing);
      existing.traverse?.(disposeNode);
      disposeNode(existing);
    }
    this[propertyName] = group;
    if (group) this.worldGroup.add(group);
  }

  clearPlacementGhost() {
    if (this.ghostMesh) this.ghostMesh.visible = false;
    this.replaceGhostGroup('ghostGroup', null);
  }

  clearCarryGhost() {
    this.replaceGhostGroup('carryGhostGroup', null);
  }

  updateActiveGhost() {
    if (this.carryState) {
      this.clearPlacementGhost();
      return this.updateCarryGhost();
    }
    return this.updatePlacementGhost();
  }

  getGearSurfaceQuaternion(transform = {}, surface = 'front') {
    const normal = getThreeSurfaceNormal(transform, surface);
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(normal.x, normal.y, normal.z).normalize()
    );
    return quaternion;
  }

  getGearSurfaceRotationDegrees(transform = {}) {
    const placement = transform?.placement || {};
    return normalizeRotation(
      (placement.transmissionRotation ?? placement.rotation ?? 0)
      + (Number(placement.runtimeSurfaceRotation) || 0)
    );
  }

  getRuntimeGearState(componentKey = '', mountId = '') {
    if (!componentKey || !mountId) return null;
    return this.mechanismRuntimeSnapshot?.gears?.[`${componentKey}:${mountId}`] || null;
  }

  getGearQuaternion(transform = {}, mount = {}, phase = 0) {
    const surfaceQuaternion = this.getGearSurfaceQuaternion(transform, mount.surface || 'front');
    const surfaceSpinQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -((this.getGearSurfaceRotationDegrees(transform) * Math.PI) / 180)
    );
    const spinQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -((Number(phase) || 0) * Math.PI / 180)
    );
    return surfaceQuaternion.multiply(surfaceSpinQuaternion).multiply(spinQuaternion);
  }

  hasRuntimePlacementGroupMatrix(runtimePlacement = null) {
    const angle = Number(runtimePlacement?.runtimeAngle);
    return Number.isFinite(angle) && Math.abs(angle) > 0.000001;
  }

  getGearAttachmentContext(transform = null, mount = null, bindingStatus = null, {
    suppressAxisBinding = false
  } = {}) {
    const hostKind = transform?.kind === 'wall' ? 'wall' : 'tile';
    const fallback = {
      componentKey: transform?.key || '',
      hostKind,
      placement: transform?.placement || null,
      transform,
      mount,
      binding: null,
      followsAxisBinding: false
    };
    if (!transform || !mount) return fallback;
    if (suppressAxisBinding) return fallback;
    const status = bindingStatus || this.getGearBindingStatusForMount(transform, mount);
    const binding = status?.valid ? status.binding : null;
    if (!binding?.componentKey) return fallback;
    const mapData = this.renderModel?.mapData || {};
    const placement = binding.hostKind === 'wall'
      ? mapData.walls?.[binding.componentKey]
      : mapData.tiles?.[binding.componentKey];
    const attachmentTransform = this.getBasePlacementTransform(binding.componentKey);
    if (!placement || !attachmentTransform) return fallback;
    return {
      componentKey: binding.componentKey,
      hostKind: binding.hostKind === 'wall' ? 'wall' : 'tile',
      placement,
      transform: attachmentTransform,
      mount: {
        ...mount,
        position: binding.socket,
        surface: normalizeGearSurfaceForPanel(placement.panelType, binding.surface || 'front')
      },
      binding,
      followsAxisBinding: true
    };
  }

  getGearAttachmentWorldPoint(attachment = null, placements = {}) {
    if (!attachment?.transform || !attachment.mount) return null;
    return this.getRuntimeGearSurfacePointForPlacement(
      attachment.componentKey,
      attachment.transform,
      attachment.mount
    );
  }

  getGearAttachmentWorldQuaternion(attachment = null, phase = 0, placements = {}) {
    if (!attachment?.transform || !attachment.mount) return new THREE.Quaternion();
    const runtimePlacement = placements?.[attachment.componentKey] || null;
    const localTransform = this.hasRuntimePlacementGroupMatrix(runtimePlacement)
      ? attachment.transform
      : (runtimePlacement ? this.getRuntimeTransform(attachment.transform) : attachment.transform);
    const localQuaternion = this.getGearQuaternion(localTransform, attachment.mount, phase);
    if (!this.hasRuntimePlacementGroupMatrix(runtimePlacement)) return localQuaternion;
    const group = this.placementGroups?.get(attachment.componentKey);
    if (!group) return localQuaternion;
    group.updateWorldMatrix(true, false);
    const groupQuaternion = group.getWorldQuaternion(new THREE.Quaternion());
    return groupQuaternion.multiply(localQuaternion);
  }

  syncGearMeshRuntimeTransform(gear = null, gearKey = '', placements = {}, snapshot = this.mechanismRuntimeSnapshot || null) {
    const data = gear?.userData?.cityChannel || null;
    if (!gear || !data?.transform || !data?.mount) return;
    const runtimeGear = snapshot?.gears?.[gearKey || `${data.hostKey || data.transform.key}:${data.mount.id}`] || null;
    const suppressAxisBinding = !!(
      runtimeGear
      && runtimeGear.axisType === 'freeAxis'
      && !runtimeGear.axisBinding
    );
    const attachment = this.getGearAttachmentContext(data.transform, data.mount, data.axisBindingStatus, {
      suppressAxisBinding
    });
    const attachmentHasRuntimePlacement = !!placements?.[attachment.componentKey];
    const phase = runtimeGear && suppressAxisBinding
      ? (runtimeGear.phase ?? data.mount.phase ?? 0)
      : attachmentHasRuntimePlacement
      ? (Number(data.mount.phase) || 0)
      : (runtimeGear?.phase ?? data.mount.phase ?? 0);
    const worldPoint = this.getGearAttachmentWorldPoint(attachment, placements);
    if (worldPoint) {
      const position = new THREE.Vector3(worldPoint.x || 0, worldPoint.y || 0, worldPoint.z || 0);
      const parent = gear.parent || null;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        parent.worldToLocal(position);
      }
      gear.position.copy(position);
    }
    const worldQuaternion = this.getGearAttachmentWorldQuaternion(attachment, phase, placements);
    const parent = gear.parent || null;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      const parentQuaternion = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      gear.quaternion.copy(parentQuaternion.multiply(worldQuaternion));
    } else {
      gear.quaternion.copy(worldQuaternion);
    }
    data.attachmentComponentKey = attachment.componentKey;
    data.attachmentHostKind = attachment.hostKind;
    data.attachmentMount = attachment.mount;
    data.followsAxisBinding = attachment.followsAxisBinding;
    data.axisBindingSuppressed = suppressAxisBinding;
    gear.updateMatrixWorld(true);
  }

  getGearRenderOrder(renderOrder = 0, offset = 0) {
    return Math.max(renderOrder + 12 + offset, GEAR_DETAIL_RENDER_ORDER + offset);
  }

  markSharedGearObject(object, role = '') {
    object.userData.sharedGeometry = true;
    object.userData.sharedMaterial = true;
    if (role) object.userData.cityChannelGearRole = role;
    return object;
  }

  createGearDetailMesh(geometry, material, renderOrder = GEAR_DETAIL_RENDER_ORDER, role = '') {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    return this.markSharedGearObject(mesh, role);
  }

  createGearDetailLine(geometry, material, renderOrder = GEAR_DETAIL_RENDER_ORDER, role = '') {
    const line = new THREE.LineSegments(geometry, material);
    line.renderOrder = renderOrder;
    return this.markSharedGearObject(line, role);
  }

  getBasePlacementForTransform(transform = null) {
    if (!transform?.key) return transform?.placement || null;
    const mapData = this.renderModel?.mapData || {};
    return transform.kind === 'wall'
      ? (mapData.walls?.[transform.key] || transform.placement || null)
      : (mapData.tiles?.[transform.key] || transform.placement || null);
  }

  getGearBindingStatusForMount(transform = null, mount = null) {
    const placement = this.getBasePlacementForTransform(transform);
    return getGearAxisBindingStatus({
      mapData: this.renderModel?.mapData || {},
      placement,
      mount,
      epsilon: GEAR_BINDING_EPSILON
    });
  }

  getGearBindingWarningMessage(status = null) {
    if (!status?.bound || status.valid) return '';
    if (status.reason === 'missing_component') return '齿轮连轴失效：被绑定板材已删除';
    if (status.reason === 'detached_pivot') return '齿轮连轴失效：被绑定板材已离开交叉轴点';
    if (status.reason === 'invalid_host') return '齿轮连轴失效：当前齿轮不在可绑定交叉轴点';
    return '齿轮连轴失效：请重新绑定板材';
  }

  createGearBindingInvalidBadge(renderOrder = GEAR_BINDING_ACTIVE_RENDER_ORDER) {
    const group = new THREE.Group();
    group.userData.cityChannelGearRole = 'binding_invalid_badge';

    const glow = this.createGearDetailMesh(
      this.gearBindingInvalidBadgeRingGeometry,
      this.gearBindingInvalidGlowMaterial,
      renderOrder,
      'binding_invalid_badge_glow'
    );
    glow.scale.setScalar(1.32);
    group.add(glow);

    const fill = this.createGearDetailMesh(
      this.gearBindingInvalidBadgeFillGeometry,
      this.gearBindingInvalidFillMaterial,
      renderOrder + 1,
      'binding_invalid_badge_fill'
    );
    group.add(fill);

    const ring = this.createGearDetailMesh(
      this.gearBindingInvalidBadgeRingGeometry,
      this.gearBindingInvalidMaterial,
      renderOrder + 2,
      'binding_invalid_badge_ring'
    );
    group.add(ring);

    const stem = this.createGearDetailMesh(
      this.gearBindingInvalidStemGeometry,
      this.gearBindingInvalidMaterial,
      renderOrder + 3,
      'binding_invalid_badge_stem'
    );
    stem.position.set(0, 0.014, -0.01);
    group.add(stem);

    const dot = this.createGearDetailMesh(
      this.gearBindingInvalidDotGeometry,
      this.gearBindingInvalidMaterial,
      renderOrder + 4,
      'binding_invalid_badge_dot'
    );
    dot.position.set(0, 0.018, 0.036);
    group.add(dot);

    return group;
  }

  addGearBindingInvalidBadge(parent = null, {
    position = null,
    quaternion = null,
    renderOrder = GEAR_BINDING_ACTIVE_RENDER_ORDER,
    scale = 1
  } = {}) {
    if (!parent) return null;
    const badge = this.createGearBindingInvalidBadge(renderOrder);
    if (position) badge.position.set(position.x || 0, position.y || 0, position.z || 0);
    if (quaternion) badge.quaternion.copy(quaternion);
    badge.scale.setScalar(scale);
    parent.add(badge);
    return badge;
  }

  addGearVisualDetails(gear, renderOrder = GEAR_DETAIL_RENDER_ORDER) {
    if (!gear) return;
    gear.userData.cityChannelGearRole = 'body';

    const halo = this.createGearDetailMesh(this.gearHaloGeometry, this.gearHaloMaterial, renderOrder - 1, 'halo');
    halo.position.y = -CITY_CHANNEL_GEAR_THICKNESS_WORLD * 0.02;
    gear.add(halo);

    [0, Math.PI / 3, (Math.PI * 2) / 3].forEach((angle, index) => {
      const spoke = this.createGearDetailMesh(this.gearSpokeGeometry, this.gearSpokeMaterial, renderOrder + 1, `spoke_${index}`);
      spoke.position.y = CITY_CHANNEL_GEAR_THICKNESS_WORLD * 0.55;
      spoke.rotation.y = angle;
      gear.add(spoke);
    });

    const outerRing = this.createGearDetailMesh(this.gearOuterRingGeometry, this.gearReliefMaterial, renderOrder + 2, 'outer_ring');
    outerRing.position.y = CITY_CHANNEL_GEAR_THICKNESS_WORLD * 0.64;
    gear.add(outerRing);

    const innerRing = this.createGearDetailMesh(this.gearInnerRingGeometry, this.gearReliefMaterial, renderOrder + 2, 'inner_ring');
    innerRing.position.y = CITY_CHANNEL_GEAR_THICKNESS_WORLD * 0.66;
    gear.add(innerRing);

    const hub = this.createGearDetailMesh(this.gearHubGeometry, this.gearHubMaterial, renderOrder + 3, 'hub');
    hub.position.y = CITY_CHANNEL_GEAR_THICKNESS_WORLD * 0.18;
    gear.add(hub);

    const axle = this.createGearDetailMesh(this.gearAxleGeometry, this.gearAxleMaterial, renderOrder + 4, 'axle');
    axle.position.y = CITY_CHANNEL_GEAR_THICKNESS_WORLD * 0.28;
    gear.add(axle);

    const marker = this.createGearDetailMesh(this.gearTimingMarkerGeometry, this.gearTimingMarkerMaterial, renderOrder + 5, 'timing_marker');
    marker.position.set(
      CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD * 0.68,
      CITY_CHANNEL_GEAR_THICKNESS_WORLD * 0.98,
      0
    );
    gear.add(marker);

    const edges = this.createGearDetailLine(this.gearEdgeGeometry, this.gearEdgeMaterial, renderOrder + 6, 'tooth_edges');
    gear.add(edges);
  }

  addGearMounts(transform, renderOrder = 0, targetGroup = this.worldGroup) {
    const mounts = transform.placement?.gearMounts || [];
    if (!Array.isArray(mounts) || mounts.length <= 0) return;
    mounts.forEach((mount) => {
      const hostKind = transform.kind === 'wall' ? 'wall' : 'tile';
      const bindingStatus = this.getGearBindingStatusForMount(transform, mount);
      const axisBindingInvalid = !!(bindingStatus.bound && !bindingStatus.valid);
      const point = getThreeGearSurfacePoint(transform, mount);
      const gear = new THREE.Mesh(this.gearGeometry, this.gearMaterial);
      const runtimeGear = this.getRuntimeGearState(transform.key, mount.id);
      const phase = runtimeGear?.phase ?? mount.phase ?? 0;
      gear.userData.sharedGeometry = true;
      gear.userData.sharedMaterial = true;
      gear.position.set(point.x, point.y, point.z);
      gear.quaternion.copy(this.getGearQuaternion(transform, mount, phase));
      gear.renderOrder = this.getGearRenderOrder(renderOrder);
      this.addGearVisualDetails(gear, gear.renderOrder);
      if (axisBindingInvalid) {
        this.addGearBindingInvalidBadge(gear, {
          position: {
            x: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD * 0.7,
            y: CITY_CHANNEL_GEAR_THICKNESS_WORLD * 1.28,
            z: -CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD * 0.74
          },
          renderOrder: gear.renderOrder + 12,
          scale: 1.12
        });
      }
      gear.userData.cityChannel = {
        kind: 'gear',
        hostKind,
        hostKey: transform.key,
        cell: {
          x: transform.placement.x,
          y: transform.placement.y,
          z: transform.placement.z
        },
        edge: transform.edge || transform.placement.edge || null,
        placement: transform.placement,
        transform,
        mount,
        axisBindingStatus: bindingStatus,
        axisBindingInvalid,
        axisBindingInvalidReason: axisBindingInvalid ? bindingStatus.reason : null,
        axisBindingWarning: this.getGearBindingWarningMessage(bindingStatus)
      };
      targetGroup.add(gear);
      this.pickables.push(gear);
      this.gearMeshes?.set(`${transform.key}:${mount.id}`, gear);
    });
  }

  getRuntimeGearSurfacePointForNode(node = null) {
    if (!node?.transform || !node?.mount) return null;
    const attachment = node.attachmentTransform
      ? {
        componentKey: node.attachmentComponentKey || node.componentKey,
        hostKind: node.attachmentHostKind || node.hostKind,
        placement: node.attachmentPlacement || node.placement,
        transform: node.attachmentTransform,
        mount: node.attachmentMount || node.mount
      }
      : this.getGearAttachmentContext(node.transform, node.mount);
    const transform = this.getRuntimeTransform(attachment.transform);
    return getThreeGearSurfacePoint(transform, attachment.mount);
  }

  addGearContactVisuals(visibleComponentKeys = null) {
    const nodes = this.getAllGearNodes().filter((node) => (
      !visibleComponentKeys
      || visibleComponentKeys.size <= 0
      || visibleComponentKeys.has(node.componentKey)
    ));
    if (nodes.length <= 1) return;
    const graph = buildGearContactGraphModel(nodes);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const drawn = new Set();
    let edgeIndex = 0;

    graph.forEach((edges, sourceId) => {
      const source = byId.get(sourceId);
      if (!source) return;
      edges.forEach((edge) => {
        const target = byId.get(edge.id);
        if (!target) return;
        const key = [sourceId, edge.id].sort().join('|');
        if (drawn.has(key)) return;
        drawn.add(key);

        const sourcePoint = this.getRuntimeGearSurfacePointForNode(source);
        const targetPoint = this.getRuntimeGearSurfacePointForNode(target);
        if (!sourcePoint || !targetPoint) return;
        const from = new THREE.Vector3(sourcePoint.x, sourcePoint.y, sourcePoint.z);
        const to = new THREE.Vector3(targetPoint.x, targetPoint.y, targetPoint.z);
        const direction = to.clone().sub(from);
        const distance = direction.length();
        if (distance <= 0.001) return;
        direction.normalize();

        const midpoint = from.clone().add(to).multiplyScalar(0.5);
        const runtimeTransform = this.getRuntimeTransform(source.transform);
        const surfaceNormal = getThreeSurfaceNormal(runtimeTransform, source.mount?.surface || 'front');
        const normal = new THREE.Vector3(surfaceNormal.x || 0, surfaceNormal.y || 0, surfaceNormal.z || 0);
        if (normal.lengthSq() <= 0.001) normal.set(0, 1, 0);
        normal.normalize();
        const tangent = new THREE.Vector3().crossVectors(normal, direction);
        if (tangent.lengthSq() <= 0.001) tangent.set(-direction.z, 0, direction.x);
        if (tangent.lengthSq() <= 0.001) tangent.set(1, 0, 0);
        tangent.normalize();

        const span = Math.min(CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD * 0.72, distance * 0.34);
        const start = midpoint.clone().add(tangent.clone().multiplyScalar(span * 0.5));
        const end = midpoint.clone().add(tangent.clone().multiplyScalar(span * -0.5));
        const active = !!(
          this.getRuntimeGearState(source.componentKey, source.mountId)
          || this.getRuntimeGearState(target.componentKey, target.mountId)
        );
        const material = active ? this.gearContactActiveMaterial : this.gearContactMaterial;
        const renderOrder = GEAR_CONTACT_RENDER_ORDER + (active ? 2 : 0);
        this.addTransmissionTube(
          { x: start.x, y: start.y, z: start.z },
          { x: end.x, y: end.y, z: end.z },
          active ? 0.017 : 0.012,
          material,
          renderOrder
        );

        const marker = new THREE.Mesh(this.gearContactMarkerGeometry, material);
        marker.userData.sharedGeometry = true;
        marker.userData.sharedMaterial = true;
        marker.position.copy(midpoint);
        const sourceAngle = Number(this.mechanismRuntimeSnapshot?.sourceAngle) || 0;
        const pulse = active
          ? 1 + (Math.sin(((sourceAngle + (edgeIndex * 37)) * Math.PI) / 90) * 0.22)
          : 0.82;
        marker.scale.setScalar(Math.max(0.68, pulse));
        marker.renderOrder = renderOrder + 1;
        this.worldGroup.add(marker);
        edgeIndex += 1;
      });
    });
  }

  addPortalAttachment(transform, renderOrder = 0, targetGroup = this.worldGroup) {
    const panelType = transform.placement?.panelType;
    if (panelType !== CITY_CHANNEL_TILE_TYPES.ENTRANCE && panelType !== CITY_CHANNEL_TILE_TYPES.EXIT) return;
    if (transform.kind !== 'tile') return;
    const isEntrance = panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE;
    const accentMaterial = isEntrance ? this.entranceMarkerMaterial : this.exitMarkerMaterial;
    const glowMaterial = isEntrance ? this.entranceMarkerGlowMaterial : this.exitMarkerGlowMaterial;
    const point = getThreeSurfacePoint(transform, { x: 0, y: 0 }, {
      lift: 0.006,
      rotate: false
    });
    const group = new THREE.Group();
    group.position.set(point.x, point.y, point.z);
    group.rotation.y = transform.rotationY || 0;
    group.renderOrder = renderOrder + 3;

    const addMesh = (geometry, material, {
      x = 0,
      y = 0,
      z = 0,
      rotationY = 0,
      orderOffset = 0
    } = {}) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.sharedGeometry = true;
      mesh.userData.sharedMaterial = true;
      mesh.position.set(x, y, z);
      mesh.rotation.y = rotationY;
      mesh.renderOrder = renderOrder + 3 + orderOffset;
      group.add(mesh);
      return mesh;
    };

    addMesh(this.portalDeckGeometry, this.portalDeckMaterial, { y: 0.014 });
    addMesh(this.portalRailGeometry, this.portalFrameMaterial, { x: -0.34, y: 0.0275 });
    addMesh(this.portalRailGeometry, this.portalFrameMaterial, { x: 0.34, y: 0.0275 });
    addMesh(this.portalLipGeometry, this.portalFrameMaterial, { y: 0.0275, z: 0.35 });
    addMesh(this.portalHoodGeometry, this.portalHoodMaterial, { z: -0.24, orderOffset: 1 });
    addMesh(this.portalLaneGeometry, glowMaterial, { y: 0.043, z: 0.07, orderOffset: 2 });

    const arrow = addMesh(this.portalArrowGeometry, accentMaterial, {
      y: 0.056,
      z: 0.08,
      rotationY: isEntrance ? 0 : Math.PI,
      orderOffset: 3
    });
    arrow.scale.set(0.82, 0.82, 0.82);

    [-0.23, 0.23].forEach((x) => {
      addMesh(this.portalBeaconGeometry, accentMaterial, {
        x,
        y: 0.026,
        z: -0.31,
        orderOffset: 3
      });
    });

    const hoodEdge = new THREE.LineSegments(this.portalHoodEdgeGeometry, this.portalAttachmentEdgeMaterial);
    hoodEdge.userData.sharedGeometry = true;
    hoodEdge.userData.sharedMaterial = true;
    hoodEdge.position.z = -0.24;
    hoodEdge.renderOrder = renderOrder + 7;
    group.add(hoodEdge);

    targetGroup.add(group);
  }

  addGroundGrid() {
    if (!this.config.showHelperGrid) return;
    const mapData = this.renderModel?.mapData || {};
    const width = Number.isInteger(mapData.width) ? mapData.width : 32;
    const height = Number.isInteger(mapData.height) ? mapData.height : 32;
    const centerX = (width - 1) / 2;
    const centerY = (height - 1) / 2;
    const points = [];
    for (let x = 0; x <= width; x += 1) {
      const px = x - 0.5 - centerX;
      points.push(new THREE.Vector3(px, 0.004, -0.5 - centerY));
      points.push(new THREE.Vector3(px, 0.004, height - 0.5 - centerY));
    }
    for (let y = 0; y <= height; y += 1) {
      const pz = y - 0.5 - centerY;
      points.push(new THREE.Vector3(-0.5 - centerX, 0.004, pz));
      points.push(new THREE.Vector3(width - 0.5 - centerX, 0.004, pz));
    }
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: 0x334155,
        transparent: true,
        opacity: 0.28
      })
    );
    this.worldGroup.add(grid);
  }

  addCoordinateLabels() {
    if (!this.config.showCoordinates) return;
    const mapData = this.renderModel?.mapData || {};
    const width = Number.isInteger(mapData.width) ? mapData.width : 32;
    const height = Number.isInteger(mapData.height) ? mapData.height : 32;
    const centerX = (width - 1) / 2;
    const centerY = (height - 1) / 2;
    const layer = Number.isInteger(this.config.activeLayer) ? this.config.activeLayer : 0;
    const labelY = (layer * CITY_CHANNEL_THREE_DIMENSIONS.layerHeight) + 0.16;
    for (let x = 0; x < width; x += 1) {
      const sprite = createCoordinateLabelSprite(`${x}`);
      sprite.position.set(x - centerX, labelY, -0.86 - centerY);
      this.worldGroup.add(sprite);
    }
    for (let y = 0; y < height; y += 1) {
      const sprite = createCoordinateLabelSprite(`${y}`);
      sprite.position.set(-0.86 - centerX, labelY, y - centerY);
      this.worldGroup.add(sprite);
    }
  }

  handleResize() {
    const rect = this.mount.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const aspect = width / height;
    this.camera.left = -CAMERA_VIEW_SIZE * aspect * 0.5;
    this.camera.right = CAMERA_VIEW_SIZE * aspect * 0.5;
    this.camera.top = CAMERA_VIEW_SIZE * 0.5;
    this.camera.bottom = -CAMERA_VIEW_SIZE * 0.5;
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.requestRender();
  }

  handlePointerDown(event) {
    if (event.button === 2) {
      event.preventDefault();
      this.clearLongPressTimer();
      this.updateHover(event);
      this.handleContextAction();
      return;
    }
    this.cancelMechanismRuntimePreview();
    const lockedPlacementTarget = (
      this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE
      && this.placementTarget?.operation
    ) ? this.placementTarget : null;
    if (!lockedPlacementTarget) {
      this.updateHover(event);
      this.updateActiveGhost();
    }
    const now = Date.now();
    const isBrowseTool = this.config.activeTool === CITY_CHANNEL_TOOLS.BROWSE;
    const isBoxSelection = this.config.activeTool === CITY_CHANNEL_TOOLS.SELECT;
    const isDoubleHoldRotate = isBrowseTool
      && now - (this.lastBrowseDownAt || 0) <= 320
      && Math.hypot(event.clientX - (this.lastBrowseDownX || 0), event.clientY - (this.lastBrowseDownY || 0)) <= 22;
    if (isBrowseTool) {
      this.lastBrowseDownAt = now;
      this.lastBrowseDownX = event.clientX;
      this.lastBrowseDownY = event.clientY;
    }
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
    const isSelectedBoardHit = isBoxSelection && this.isHoverSelectionSelected() && this.hasBoardSelection();
    const pointerMode = this.carryState
      ? 'carry'
      : isBrowseTool
        ? (isDoubleHoldRotate ? 'rotateCamera' : 'pan')
        : isBoxSelection
          ? (this.hoverMesh ? 'click' : 'box')
          : 'click';
    const currentPlacementTarget = (
      this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE
      && this.placementTarget?.operation
    ) ? this.placementTarget : null;
    this.pointerState = {
      mode: pointerMode,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      shiftKey: !!event.shiftKey,
      moved: false,
      canBoxSelect: isBoxSelection,
      skipCarryCommitOnRelease: false,
      lockedPlacementTarget: lockedPlacementTarget || currentPlacementTarget
    };
    if (isBoxSelection) {
      this.hideSelectionBox();
      if (isSelectedBoardHit) this.scheduleLongPressCarry();
    }
  }

  handlePointerMove(event) {
    if (this.pointerState) {
      const dx = event.clientX - this.pointerState.x;
      const dy = event.clientY - this.pointerState.y;
      const totalDx = event.clientX - this.pointerState.startX;
      const totalDy = event.clientY - this.pointerState.startY;
      const moved = this.pointerState.moved || Math.hypot(totalDx, totalDy) > 4;
      this.pointerState = {
        ...this.pointerState,
        x: event.clientX,
        y: event.clientY,
        moved
      };
      if (moved) this.clearLongPressTimer();
      if (this.pointerState.mode === 'box') {
        this.updateSelectionBox(event);
        return;
      }
      if (this.pointerState.mode === 'click') {
        this.updateHover(event);
        this.updatePlacementGhost();
        if (moved && this.pointerState.canBoxSelect) {
          this.clearLongPressTimer();
          this.pointerState.mode = 'box';
          this.updateSelectionBox(event);
        }
        return;
      }
      if (this.pointerState.mode === 'carry') {
        this.updateHover(event);
        this.refreshPointerRayFromCamera();
        this.updateCarryGhost();
        return;
      }
      if (this.pointerState.mode === 'rotateCamera') {
        this.rotateCameraYaw(-dx * 0.34);
        return;
      }
      this.panCamera(dx, dy);
      return;
    }
    this.updateHover(event);
    this.updateActiveGhost();
  }

  handlePointerUp(event) {
    this.clearLongPressTimer();
    if (event.button === 2) {
      event.preventDefault();
      this.pointerState = null;
      this.hideSelectionBox();
      return;
    }
    const pointerState = this.pointerState;
    const wasDrag = !!this.pointerState?.moved;
    const pointerMode = this.pointerState?.mode || 'pan';
    const boxShiftKey = !!this.pointerState?.shiftKey || !!event.shiftKey;
    const skipCarryCommitOnRelease = !!this.pointerState?.skipCarryCommitOnRelease;
    const lockedPlacementTarget = this.pointerState?.lockedPlacementTarget || null;
    this.renderer.domElement.releasePointerCapture?.(event.pointerId);
    this.pointerState = null;
    if (pointerMode === 'box') {
      if (wasDrag) {
        this.commitBoxSelection(event, boxShiftKey, pointerState);
        this.hideSelectionBox();
        return;
      }
      this.hideSelectionBox();
    }
    if (pointerMode === 'carry' && skipCarryCommitOnRelease) return;
    if (wasDrag) return;

    if (this.carryState) {
      if (this.commitCarryTarget()) return;
      this.updateHover(event);
      this.updateCarryGhost();
      return;
    }

    if (this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE) {
      if (this.commitPlacementTarget(lockedPlacementTarget)) return;
      this.updateHover(event);
      this.updatePlacementGhost();
      if (this.commitPlacementTarget()) return;
      return;
    }

    this.updateHover(event);
    this.updatePlacementGhost();
    if (this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && this.commitGearInstallTarget()) return;
    if (this.config.activeTool === CITY_CHANNEL_TOOLS.ERASE && this.eraseHovered()) return;
    if (this.commitGearBindingCandidate()) return;
    this.selectHovered(!!event.shiftKey);
  }

  handleContextMenu(event) {
    event.preventDefault();
  }

  handleContextAction() {
    this.clearLongPressTimer();
    this.cancelMechanismRuntimePreview();
    if (this.carryState) {
      this.endCarryPreview();
      return true;
    }
    const hasSelection = (
      (this.config.selection?.cells || []).length
      + (this.config.selection?.walls || []).length
      + (this.config.selection?.gears || []).length
    ) > 0;
    if (hasSelection) {
      this.emitSelection({ cells: [], walls: [], gears: [], scope: null });
      return true;
    }
    if (
      (this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.config.activeTileType)
      || (this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && this.config.activeComponentType)
    ) {
      this.config.onExitPlaceMode?.();
      return true;
    }
    return false;
  }

  getSelectionBoxRect(event, pointerState = this.pointerState) {
    const mountRect = this.mount.getBoundingClientRect();
    const startClientX = Number(pointerState?.startX);
    const startClientY = Number(pointerState?.startY);
    const endClientX = Number(event?.clientX);
    const endClientY = Number(event?.clientY);
    if (![startClientX, startClientY, endClientX, endClientY].every(Number.isFinite)) return null;
    const startX = Math.max(0, Math.min(startClientX - mountRect.left, mountRect.width));
    const startY = Math.max(0, Math.min(startClientY - mountRect.top, mountRect.height));
    const endX = Math.max(0, Math.min(endClientX - mountRect.left, mountRect.width));
    const endY = Math.max(0, Math.min(endClientY - mountRect.top, mountRect.height));
    return {
      left: Math.min(startX, endX),
      top: Math.min(startY, endY),
      right: Math.max(startX, endX),
      bottom: Math.max(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY)
    };
  }

  updateSelectionBox(event) {
    const rect = this.getSelectionBoxRect(event);
    if (!rect || (rect.width < 3 && rect.height < 3)) {
      this.hideSelectionBox();
      return;
    }
    Object.assign(this.selectionBoxElement.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  }

  hideSelectionBox() {
    if (this.selectionBoxElement) this.selectionBoxElement.style.display = 'none';
  }

  clearLongPressTimer() {
    if (!this.longPressTimer) return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  scheduleLongPressCarry() {
    this.clearLongPressTimer();
    const startX = this.pointerState?.startX;
    const startY = this.pointerState?.startY;
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      if (!this.pointerState || this.pointerState.moved || this.pointerState.mode !== 'click') return;
      if (
        Math.hypot(
          (this.pointerState.x || 0) - (startX || 0),
          (this.pointerState.y || 0) - (startY || 0)
        ) > SELECTED_MOVE_CANCEL_DRAG_DISTANCE
      ) {
        return;
      }
      if (!this.startCarry()) return;
      this.pointerState = {
        ...this.pointerState,
        mode: 'carry',
        skipCarryCommitOnRelease: true
      };
    }, SELECTED_MOVE_HOLD_DELAY);
  }

  getMeshScreenPoints(mesh) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const points = [];
    mesh.updateMatrixWorld(true);
    const appendProjectedPoint = (point) => {
      const projected = point.clone().project(this.camera);
      points.push({
        x: ((projected.x + 1) * 0.5) * rect.width,
        y: ((1 - projected.y) * 0.5) * rect.height
      });
    };
    appendProjectedPoint(mesh.getWorldPosition(new THREE.Vector3()));
    if (mesh.geometry?.boundingBox) {
      const box = mesh.geometry.boundingBox;
      [
        [box.min.x, box.min.y, box.min.z],
        [box.min.x, box.min.y, box.max.z],
        [box.min.x, box.max.y, box.min.z],
        [box.min.x, box.max.y, box.max.z],
        [box.max.x, box.min.y, box.min.z],
        [box.max.x, box.min.y, box.max.z],
        [box.max.x, box.max.y, box.min.z],
        [box.max.x, box.max.y, box.max.z]
      ].forEach(([x, y, z]) => {
        appendProjectedPoint(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld));
      });
    }
    return points;
  }

  getMeshScreenBounds(mesh) {
    const points = this.getMeshScreenPoints(mesh).filter((point) => (
      Number.isFinite(point.x) && Number.isFinite(point.y)
    ));
    if (points.length <= 0) return null;
    return points.reduce((bounds, point) => ({
      left: Math.min(bounds.left, point.x),
      top: Math.min(bounds.top, point.y),
      right: Math.max(bounds.right, point.x),
      bottom: Math.max(bounds.bottom, point.y)
    }), {
      left: Infinity,
      top: Infinity,
      right: -Infinity,
      bottom: -Infinity
    });
  }

  doesScreenRectContain(containerRect = null, contentRect = null) {
    if (!containerRect || !contentRect) return false;
    const values = [
      containerRect.left,
      containerRect.top,
      containerRect.right,
      containerRect.bottom,
      contentRect.left,
      contentRect.top,
      contentRect.right,
      contentRect.bottom
    ];
    if (!values.every(Number.isFinite)) return false;
    return (
      contentRect.left >= containerRect.left
      && contentRect.top >= containerRect.top
      && contentRect.right <= containerRect.right
      && contentRect.bottom <= containerRect.bottom
    );
  }

  isMeshInsideSelectionRect(mesh, rect) {
    if (!mesh.geometry?.boundingBox) mesh.geometry?.computeBoundingBox?.();
    return this.doesScreenRectContain(rect, this.getMeshScreenBounds(mesh));
  }

  getMeshSelectionVisibilitySamplePoints(mesh = null) {
    if (!mesh?.geometry) return [];
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox?.();
    const box = mesh.geometry.boundingBox;
    if (!box) return [];
    mesh.updateMatrixWorld(true);
    const values = [0.01, 0.25, 0.5, 0.75, 0.99];
    const lerp = (min, max, ratio) => min + ((max - min) * ratio);
    const points = [mesh.getWorldPosition(new THREE.Vector3())];
    const keys = new Set();
    // Cover every box face so a board with only an exposed edge remains selectable.
    const appendLocalPoint = (x, y, z) => {
      const key = `${x.toFixed(5)}:${y.toFixed(5)}:${z.toFixed(5)}`;
      if (keys.has(key)) return;
      keys.add(key);
      points.push(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld));
    };
    values.forEach((u) => {
      values.forEach((v) => {
        const x = lerp(box.min.x, box.max.x, u);
        const y = lerp(box.min.y, box.max.y, u);
        const z = lerp(box.min.z, box.max.z, v);
        const crossY = lerp(box.min.y, box.max.y, v);
        appendLocalPoint(box.min.x, y, z);
        appendLocalPoint(box.max.x, y, z);
        appendLocalPoint(x, box.min.y, z);
        appendLocalPoint(x, box.max.y, z);
        appendLocalPoint(x, crossY, box.min.z);
        appendLocalPoint(x, crossY, box.max.z);
      });
    });
    return points;
  }

  isMeshVisibleForSelection(mesh = null) {
    if (!mesh || !this.camera || !this.selectionRaycaster) return false;
    const selectionKey = this.getMeshSelectionKey(mesh);
    if (!selectionKey) return false;
    const pointer = new THREE.Vector2();
    return this.getMeshSelectionVisibilitySamplePoints(mesh).some((point) => {
      const projected = point.clone().project(this.camera);
      if (
        !Number.isFinite(projected.x)
        || !Number.isFinite(projected.y)
        || !Number.isFinite(projected.z)
        || projected.x < -1
        || projected.x > 1
        || projected.y < -1
        || projected.y > 1
        || projected.z < -1
        || projected.z > 1
      ) {
        return false;
      }
      pointer.set(projected.x, projected.y);
      this.selectionRaycaster.setFromCamera(pointer, this.camera);
      const hit = this.selectionRaycaster.intersectObjects(this.pickables, false)[0] || null;
      return this.getMeshSelectionKey(hit?.object) === selectionKey;
    });
  }

  commitBoxSelection(event, additive = false, pointerState = this.pointerState) {
    const rect = this.getSelectionBoxRect(event, pointerState);
    if (!rect || (rect.width < 4 && rect.height < 4)) return false;
    const next = additive
      ? {
        cells: [...(this.config.selection?.cells || [])],
        walls: [...(this.config.selection?.walls || [])],
        gears: [...(this.config.selection?.gears || [])],
        scope: this.config.selection?.scope || null
      }
      : { cells: [], walls: [], gears: [], scope: null };
    const cellKeys = new Set(next.cells.map((cell) => createCellKey(cell.x, cell.y, cell.z)));
    const wallKeys = new Set(next.walls.map((wall) => createWallKey(wall.x, wall.y, wall.z, wall.edge)));
    const gearKeys = new Set(next.gears.map((gear) => `${gear.hostKind || 'tile'}:${gear.hostKey}:${gear.mountId}`));
    this.pickables.forEach((mesh) => {
      if (!this.isMeshInsideSelectionRect(mesh, rect)) return;
      if (!this.isMeshVisibleForSelection(mesh)) return;
      const selection = this.getPlacementSelectionFromData(mesh.userData?.cityChannel || null);
      (selection?.cells || []).forEach((cell) => {
        const key = createCellKey(cell.x, cell.y, cell.z);
        if (cellKeys.has(key)) return;
        cellKeys.add(key);
        next.cells.push(cell);
      });
      (selection?.walls || []).forEach((wall) => {
        const key = createWallKey(wall.x, wall.y, wall.z, wall.edge);
        if (wallKeys.has(key)) return;
        wallKeys.add(key);
        next.walls.push(wall);
      });
      (selection?.gears || []).forEach((gear) => {
        const key = `${gear.hostKind || 'tile'}:${gear.hostKey}:${gear.mountId}`;
        if (gearKeys.has(key)) return;
        gearKeys.add(key);
        next.gears.push(gear);
      });
    });
    next.scope = next.gears.length > 0 && next.cells.length + next.walls.length === 0
      ? 'component'
      : (next.cells.length + next.walls.length > 0 ? 'board' : null);
    this.emitSelection(next);
    this.requestRender();
    this.emitStatus();
    return true;
  }

  handleWheel(event) {
    event.preventDefault();
    const selectedPlacementCount = (this.config.selection?.cells || []).length + (this.config.selection?.walls || []).length;
    if (event.shiftKey && this.carryState) {
      this.cancelMechanismRuntimePreview();
      this.rotateCarryPlacementSurface(event.deltaY < 0 ? 'forward' : 'reverse');
      return;
    }
    if (event.shiftKey && selectedPlacementCount > 0 && !this.carryState) {
      this.cancelMechanismRuntimePreview();
      this.config.onRotateSelection?.(event.deltaY < 0 ? 'forward' : 'reverse');
      this.requestRender();
      return;
    }
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom - (event.deltaY * 0.0014)));
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
    this.requestRender();
    this.emitCamera();
    this.emitStatus();
  }

  handleKeyDown(event) {
    const key = String(event.key || '').toLowerCase();
    if (this.isEditableKeyboardTarget(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && key === 'z' && event.shiftKey) {
      event.preventDefault();
      this.cancelMechanismRuntimePreview();
      this.config.onRedo?.();
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
      const hasBoardSelection = (
        ((this.config.selection?.cells || []).length + (this.config.selection?.walls || []).length) > 0
        && this.config.selection?.scope !== 'component'
      );
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
    if (event.code === 'Space' || key === ' ') {
      event.preventDefault();
      this.cancelMechanismRuntimePreview();
      if (this.handleSpaceSurfaceToggle()) return;
      return;
    }
    if (key === 'r') {
      event.preventDefault();
      this.cancelMechanismRuntimePreview();
      if (this.handleRotateSurface()) return;
      return;
    }
    if (key === 'm') {
      event.preventDefault();
      this.cancelMechanismRuntimePreview();
      this.startCarry();
      return;
    }
    if (key === 'escape') {
      event.preventDefault();
      this.clearLongPressTimer();
      this.cancelMechanismRuntimePreview();
      if (this.carryState) {
        this.endCarryPreview();
        return;
      }
      if (
        (this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.config.activeTileType)
        || (this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && this.config.activeComponentType)
      ) {
        this.config.onExitPlaceMode?.();
        return;
      }
      this.closeInspectMode();
      this.emitSelection({ cells: [], walls: [], gears: [], scope: null });
      return;
    }
    if (['w', 'a', 's', 'd', 'q', 'e'].includes(key)) {
      event.preventDefault();
      this.keyState.add(key);
      this.startKeyboardNavigation();
    }
  }

  handleKeyUp(event) {
    this.keyState.delete(String(event.key || '').toLowerCase());
  }

  hasBoardSelection() {
    return this.config.selection?.scope !== 'component'
      && ((this.config.selection?.cells || []).length + (this.config.selection?.walls || []).length) > 0;
  }

  isHoverSelectionSelected() {
    if (!this.hoverMesh) return false;
    const key = this.getMeshSelectionKey(this.hoverMesh);
    return !!key && this.getSelectionKeys().has(key);
  }

  isEditableKeyboardTarget(target = null) {
    const tagName = target?.tagName?.toLowerCase();
    return tagName === 'input'
      || tagName === 'textarea'
      || tagName === 'select'
      || target?.isContentEditable;
  }

  handleSpaceSurfaceToggle() {
    if (this.carryState) return this.cycleCarrySnapAxisRotation();
    if (!(this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.config.activeTileType)) return false;
    if (isPortalMaterial(this.config.activeTileType)) {
      this.config.onSetPanelPose?.('floor');
      this.notifyStatus('入口/出口仅支持平放');
      return true;
    }
    this.config.onTogglePanelPose?.();
    if (!this.config.onTogglePanelPose) {
      this.config.onSetPanelPose?.(this.config.panelPose === 'wall' ? 'floor' : 'wall');
    }
    this.updatePlacementGhost();
    return true;
  }

  handleRotateSurface(direction = 'forward') {
    if (this.carryState) return this.rotateCarryPlacementSurface(direction);
    if (this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.config.activeTileType) {
      this.config.onRotateActive?.(direction === 'reverse' ? -90 : 90);
      return true;
    }
    const selectedPlacementCount = (this.config.selection?.cells || []).length + (this.config.selection?.walls || []).length;
    if (this.config.selection?.scope !== 'component' && selectedPlacementCount > 0) {
      this.config.onRotateSelection?.(direction);
      return true;
    }
    return false;
  }

  startKeyboardNavigation() {
    if (this.keyboardFrameId || this.keyState.size <= 0) return;
    this.lastKeyboardFrameAt = null;
    const tick = (timestamp) => {
      if (this.disposed || this.keyState.size <= 0) {
        this.keyboardFrameId = null;
        this.lastKeyboardFrameAt = null;
        return;
      }
      const previous = this.lastKeyboardFrameAt || timestamp;
      this.lastKeyboardFrameAt = timestamp;
      const seconds = Math.min(0.05, Math.max(0, (timestamp - previous) / 1000));
      this.applyKeyboardNavigation(seconds);
      this.keyboardFrameId = requestAnimationFrame(tick);
    };
    this.keyboardFrameId = requestAnimationFrame(tick);
  }

  applyKeyboardNavigation(seconds) {
    const distance = KEYBOARD_PAN_SPEED * seconds;
    let screenX = 0;
    let screenY = 0;
    if (this.keyState.has('w')) screenY += distance;
    if (this.keyState.has('s')) screenY -= distance;
    if (this.keyState.has('a')) screenX -= distance;
    if (this.keyState.has('d')) screenX += distance;
    if (screenX || screenY) this.panCameraByUnits(screenX, screenY);
    if (this.keyState.has('q')) this.rotateCameraYaw(-(KEYBOARD_ROTATION_SPEED * seconds));
    if (this.keyState.has('e')) this.rotateCameraYaw(KEYBOARD_ROTATION_SPEED * seconds);
  }

  panCameraByUnits(screenX, screenY) {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const offset = new THREE.Vector3()
      .addScaledVector(right, screenX)
      .addScaledVector(up, screenY);
    this.camera.position.add(offset);
    this.cameraTarget.add(offset);
    this.camera.lookAt(this.cameraTarget);
    this.refreshPointerRayFromCamera();
    this.requestRender();
    this.emitCamera();
    this.updateActiveGhost();
  }

  rotateCameraYaw(delta) {
    this.cameraYaw = ((this.cameraYaw + delta) % 360 + 360) % 360;
    const offset = this.camera.position.clone().sub(this.cameraTarget);
    const radius = Math.max(1, Math.hypot(offset.x, offset.z));
    const radians = this.cameraYaw * Math.PI / 180;
    this.camera.position.set(
      this.cameraTarget.x + (Math.sin(radians) * radius),
      this.cameraTarget.y + offset.y,
      this.cameraTarget.z + (Math.cos(radians) * radius)
    );
    this.camera.lookAt(this.cameraTarget);
    this.refreshPointerRayFromCamera();
    this.requestRender();
    this.emitCamera();
    this.updateActiveGhost();
  }

  panCamera(dx, dy) {
    const rect = this.mount.getBoundingClientRect();
    const unitsPerPixel = CAMERA_VIEW_SIZE / Math.max(1, rect.height) / this.zoom;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const offset = new THREE.Vector3()
      .addScaledVector(right, -dx * unitsPerPixel)
      .addScaledVector(up, dy * unitsPerPixel);
    this.camera.position.add(offset);
    this.cameraTarget.add(offset);
    this.camera.lookAt(this.cameraTarget);
    this.refreshPointerRayFromCamera();
    this.requestRender();
    this.emitCamera();
  }

  updatePointerRay(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1)
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    this.hasPointerRay = true;
  }

  refreshPointerRayFromCamera() {
    if (!this.hasPointerRay) return;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
  }

  updateHover(event) {
    this.updatePointerRay(event);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0] || null;
    const nextMesh = hit?.object || null;
    this.hoverHit = hit;
    if (nextMesh !== this.hoverMesh) {
      this.hoverMesh = nextMesh;
      this.requestRender();
      this.emitStatus();
    }
  }

  getPointerLayerCell(layer = null) {
    if (!this.hasPointerRay) return null;
    const mapData = this.renderModel?.mapData || {};
    const targetLayer = Number.isInteger(layer)
      ? layer
      : Number.isInteger(this.config.activeLayer) ? this.config.activeLayer : 0;
    const planeY = (targetLayer * CITY_CHANNEL_THREE_DIMENSIONS.layerHeight) + CITY_CHANNEL_THREE_DIMENSIONS.tileThickness;
    this.groundPlane.set(new THREE.Vector3(0, 1, 0), -planeY);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.groundHitPoint);
    return hit ? threePositionToCell(hit, mapData, targetLayer) : null;
  }

  getCarryOrigins() {
    const selection = this.config.selection || {};
    return [
      ...(selection.cells || []).map((cell) => ({ x: cell.x, y: cell.y, z: cell.z })),
      ...(selection.walls || []).map((wall) => ({
        x: wall.x,
        y: wall.y,
        z: wall.z,
        edge: wall.edge
      }))
    ];
  }

  getCarryPrimaryPlacement() {
    const origin = this.carryState?.origins?.[0] || null;
    if (!origin) return null;
    const mapData = this.renderModel?.mapData || {};
    return origin.edge
      ? mapData.walls?.[createWallKey(origin.x, origin.y, origin.z, origin.edge)] || null
      : mapData.tiles?.[createCellKey(origin.x, origin.y, origin.z)] || null;
  }

  getCarryDefaultPose(placement = this.getCarryPrimaryPlacement()) {
    if (this.carryState?.defaultPose) return this.carryState.defaultPose;
    return placement?.edge || placement?.isVertical ? 'wall' : 'floor';
  }

  getPlacementDefaultPose(placement = null) {
    return placement?.edge || placement?.isVertical ? 'wall' : 'floor';
  }

  getCarrySurfaceRotation(placement = this.getCarryPrimaryPlacement()) {
    return normalizeRotation(
      this.carryState?.surfaceRotation
        ?? placement?.transmissionRotation
        ?? placement?.rotation
        ?? (placement?.edge ? wallEdgeToRotation(placement.edge) : 0)
    );
  }

  hasSingleCarryPoseChange() {
    const origins = this.carryState?.origins || [];
    if (origins.length !== 1) return false;
    const placement = this.getCarryPrimaryPlacement();
    if (!placement) return false;
    const sourceSurfaceRotation = normalizeRotation(
      placement.transmissionRotation
        ?? placement.rotation
        ?? (placement.edge ? wallEdgeToRotation(placement.edge) : 0)
    );
    return (
      this.getCarryDefaultPose(placement) !== this.getPlacementDefaultPose(placement)
      || this.getCarrySurfaceRotation(placement) !== sourceSurfaceRotation
    );
  }

  getCarryOriginTargetCell() {
    const origin = this.carryState?.origins?.[0] || null;
    if (!origin) return null;
    const placement = this.getCarryPrimaryPlacement();
    const target = {
      x: origin.x,
      y: origin.y,
      z: origin.z
    };
    if (origin.edge || placement?.edge) return { ...target, edge: origin.edge || placement.edge };
    if (placement?.isVertical) return { ...target, isVertical: true };
    return { ...target, layFlat: true };
  }

  isCarrySourceHoverData(data = null) {
    const origin = this.carryState?.origins?.[0] || null;
    if (!origin || !data?.placement) return false;
    const sourceKey = origin.edge
      ? createWallKey(origin.x, origin.y, origin.z, origin.edge)
      : createCellKey(origin.x, origin.y, origin.z);
    return data.key === sourceKey;
  }

  applyCarryGhostPoseToTarget(targetCell = null) {
    if (!this.carryState || !targetCell) return targetCell;
    const origins = this.carryState.origins || [];
    if (origins.length !== 1) return { ...targetCell };
    const placement = this.getCarryPrimaryPlacement();
    const surfaceRotation = this.getCarrySurfaceRotation(placement);
    if (isPortalMaterial(placement?.panelType)) {
      return {
        ...targetCell,
        edge: undefined,
        isVertical: false,
        layFlat: true,
        rotation: surfaceRotation
      };
    }
    if (targetCell.isVertical) {
      return {
        ...targetCell,
        edge: undefined,
        isVertical: true,
        layFlat: false,
        rotation: surfaceRotation
      };
    }
    const targetPose = targetCell.edge ? 'wall' : (targetCell.layFlat ? 'floor' : this.getCarryDefaultPose(placement));
    if (targetPose === 'wall') {
      return {
        ...targetCell,
        edge: targetCell.edge || placement?.edge || 'north',
        isVertical: false,
        layFlat: false,
        rotation: surfaceRotation
      };
    }
    return {
      ...targetCell,
      edge: undefined,
      isVertical: false,
      layFlat: true,
      rotation: surfaceRotation
    };
  }

  startCarry() {
    const origins = this.getCarryOrigins();
    if (origins.length <= 0) return false;
    if ((this.config.selection?.gears || []).length > 0) {
      this.config.onToast?.('Three 编辑器暂不支持拖拽移动齿轮，请先删除后重新安装。', 'error');
      return false;
    }
    const primaryOrigin = origins[0];
    const primaryPlacement = primaryOrigin?.edge
      ? this.renderModel?.mapData?.walls?.[createWallKey(primaryOrigin.x, primaryOrigin.y, primaryOrigin.z, primaryOrigin.edge)]
      : this.renderModel?.mapData?.tiles?.[createCellKey(primaryOrigin.x, primaryOrigin.y, primaryOrigin.z)];
    this.carryState = {
      mode: 'move',
      origins,
      defaultPose: origins.length === 1 && primaryPlacement
        ? (primaryPlacement.edge || primaryPlacement.isVertical ? 'wall' : 'floor')
        : null,
      surfaceRotation: origins.length === 1 && primaryPlacement
        ? normalizeRotation(
          primaryPlacement.transmissionRotation
            ?? primaryPlacement.rotation
            ?? (primaryPlacement.edge ? wallEdgeToRotation(primaryPlacement.edge) : 0)
        )
        : null,
      groupRotationSteps: 0,
      groupPoseSteps: 0
    };
    this.config.onCarryStateChange?.(true);
    this.notifyStatus('移动预览：点击目标位置完成移动');
    this.updateCarryGhost();
    this.requestRender();
    return true;
  }

  startCopyCarry() {
    const started = this.startCarry();
    if (!started) return false;
    this.carryState.mode = 'copy';
    this.notifyStatus('复制预览：点击目标位置完成复制');
    return true;
  }

  endCarryPreview() {
    this.carryState = null;
    this.config.onCarryStateChange?.(false);
    this.clearCarryGhost();
    this.updatePlacementGhost();
    this.emitStatus();
  }

  rotateCarryPlacementSurface(direction = 'forward') {
    if (!this.carryState) return false;
    const delta = direction === 'reverse' ? -1 : 1;
    const origins = this.carryState.origins || [];
    if (origins.length === 1) {
      const placement = this.getCarryPrimaryPlacement();
      this.carryState.surfaceRotation = normalizeRotation(this.getCarrySurfaceRotation(placement) + (delta * 90));
      this.notifyStatus('移动预览：表面朝向已旋转');
    } else {
      this.carryState.groupRotationSteps = ((this.carryState.groupRotationSteps || 0) + delta + 4) % 4;
      this.notifyStatus('多选移动预览：整体朝向已旋转 90°');
    }
    this.updateCarryGhost();
    this.requestRender();
    return true;
  }

  cycleCarrySnapAxisRotation() {
    if (!this.carryState) return false;
    const origins = this.carryState.origins || [];
    if (origins.length === 1) {
      const placement = this.getCarryPrimaryPlacement();
      this.carryState.defaultPose = this.getCarryDefaultPose(placement) === 'wall' ? 'floor' : 'wall';
      this.notifyStatus(this.carryState.defaultPose === 'wall' ? '移动预览：默认竖直吸附' : '移动预览：默认水平摆放');
    } else {
      this.carryState.groupPoseSteps = ((this.carryState.groupPoseSteps || 0) + 1) % 4;
      this.notifyStatus('多选移动预览：整体向前翻滚 90°');
    }
    this.updateCarryGhost();
    this.requestRender();
    return true;
  }

  getCarryTargetFromPointerRay() {
    const origins = this.carryState?.origins || [];
    if (origins.length <= 0) return null;
    const anchor = origins[0];
    const sourcePlacement = anchor.edge
      ? this.renderModel?.mapData?.walls?.[createWallKey(anchor.x, anchor.y, anchor.z, anchor.edge)]
      : this.renderModel?.mapData?.tiles?.[createCellKey(anchor.x, anchor.y, anchor.z)];
    const defaultPose = origins.length === 1 ? this.getCarryDefaultPose(sourcePlacement) : null;
    const preferWallPose = origins.length === 1
      ? defaultPose === 'wall'
      : !!(sourcePlacement?.isVertical || anchor.edge);
    const placementTarget = this.getPlacementTargetFromHoverBoard({
      sourcePlacement,
      preferWallPose,
      allowReplacement: false
    });
    if (placementTarget?.cell) {
      if (placementTarget.edge) return { ...placementTarget.cell, edge: placementTarget.edge };
      const targetCell = { ...placementTarget.cell };
      if (placementTarget.kind === 'verticalTile') targetCell.isVertical = true;
      if (placementTarget.kind === 'tile' && defaultPose === 'floor') targetCell.layFlat = true;
      return targetCell;
    }
    const hoverPlacementData = this.getHoverPlacementData();
    if (hoverPlacementData?.placement) {
      return this.isCarrySourceHoverData(hoverPlacementData) && this.hasSingleCarryPoseChange()
        ? this.getCarryOriginTargetCell()
        : null;
    }
    const layer = Number.isInteger(this.config.activeLayer)
      ? this.config.activeLayer
      : origins[0].z || 0;
    const cell = this.getPointerLayerCell(layer);
    if (!cell) return null;
    if (anchor.edge || sourcePlacement?.isVertical || defaultPose === 'wall') {
      const edgeTarget = getThreeNearestCellEdge(this.groundHitPoint, this.renderModel?.mapData || {}, cell);
      if (edgeTarget?.edge && edgeTarget.distance <= WALL_EDGE_SNAP_WORLD_RADIUS) return { ...cell, edge: edgeTarget.edge };
    }
    return cell;
  }

  updateCarryGhost() {
    if (!this.carryState) {
      this.clearCarryGhost();
      return null;
    }
    const targetCell = this.applyCarryGhostPoseToTarget(this.getCarryTargetFromPointerRay());
    if (!targetCell) {
      this.clearCarryGhost();
      this.requestRender();
      return null;
    }
    const preview = computeCityChannelMovePreviewModel({
      mapData: this.renderModel?.mapData || {},
      origins: this.carryState.origins,
      targetCell,
      explicitSurfaceTarget: targetCell.edge ? targetCell : null,
      groupRotationSteps: this.carryState.groupRotationSteps || 0,
      groupPoseSteps: this.carryState.groupPoseSteps || 0,
      includeConflictKeys: true,
      preserveOrigins: this.carryState.mode === 'copy'
    });
    const group = new THREE.Group();
    [...(preview.movedTilePlacements || []), ...(preview.movedWallPlacements || [])].forEach((placement) => {
      const transform = placement.edge
        ? getWallThreeTransform(placement, this.renderModel?.mapData || {})
        : getTileThreeTransform(placement, this.renderModel?.mapData || {});
      const item = this.createBoardGhostGroup(transform, { valid: preview.valid });
      if (item) group.add(item);
    });
    this.replaceGhostGroup('carryGhostGroup', group.children.length > 0 ? group : null);
    this.requestRender();
    return preview;
  }

  buildCopyPlacementOperations(moves = []) {
    const mapData = this.renderModel?.mapData || {};
    return moves.map((move) => {
      const from = move?.from;
      const to = move?.to;
      if (!from || !to) return null;
      const sourcePlacement = from.edge
        ? mapData.walls?.[createWallKey(from.x, from.y, from.z, from.edge)]
        : mapData.tiles?.[createCellKey(from.x, from.y, from.z)];
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
              ?? 0
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
        ),
        isVertical: to.layFlat ? false : !!(to.isVertical || sourcePlacement.isVertical)
      };
    }).filter(Boolean);
  }

  commitCarryTarget() {
    if (!this.carryState) return false;
    const targetCell = this.applyCarryGhostPoseToTarget(this.getCarryTargetFromPointerRay());
    if (!targetCell) return false;
    const preview = computeCityChannelMovePreviewModel({
      mapData: this.renderModel?.mapData || {},
      origins: this.carryState.origins,
      targetCell,
      explicitSurfaceTarget: targetCell.edge ? targetCell : null,
      groupRotationSteps: this.carryState.groupRotationSteps || 0,
      groupPoseSteps: this.carryState.groupPoseSteps || 0,
      includeConflictKeys: true,
      preserveOrigins: this.carryState.mode === 'copy'
    });
    if (!preview.valid || !Array.isArray(preview.moves) || preview.moves.length <= 0) {
      this.config.onToast?.('目标位置存在冲突，无法完成移动。', 'error');
      return false;
    }
    if (this.carryState.mode === 'copy') {
      const operations = this.buildCopyPlacementOperations(preview.moves);
      if (operations.length <= 0) return false;
      this.config.onCommitOperations?.(operations, { label: '复制板材' });
      const nextCells = preview.moves.filter((move) => !move.to.edge).map((move) => ({ x: move.to.x, y: move.to.y, z: move.to.z }));
      const nextWalls = preview.moves.filter((move) => !!move.to.edge).map((move) => ({ x: move.to.x, y: move.to.y, z: move.to.z, edge: move.to.edge }));
      this.emitSelection({ cells: nextCells, walls: nextWalls, gears: [], scope: 'board' });
    } else {
      this.config.onMovePlacements?.(preview.moves);
    }
    this.endCarryPreview();
    return true;
  }

  getGearInstallSurfaceForHover(transform = null, placement = null) {
    if (!transform || !placement) return 'front';
    const surface = (transform.kind === 'wall' || transform.kind === 'verticalTile' || placement.edge || placement.isVertical)
      ? this.getHoverVerticalSurfaceSide(transform)
      : 'front';
    return normalizeGearSurfaceForPanel(placement.panelType, surface);
  }

  hasCornerGearAtPivot({ pivotWorld = null, surface = 'front' } = {}) {
    if (!pivotWorld) return false;
    return this.getVisiblePlacementTransforms().some((data) => {
      const placement = data.placement;
      return (placement?.gearMounts || []).some((mount) => {
        if (!isCornerGearSocket(mount.position)) return false;
        if (normalizeGearSurfaceForPanel(placement.panelType, mount.surface || 'front') !== surface) return false;
        const point = getThreeGearSurfacePoint(data.transform, {
          position: mount.position,
          surface
        });
        return this.isSameThreePoint(point, pivotWorld);
      });
    });
  }

  getGearInstallTargetFromHoverHit() {
    if (
      this.config.activeTool !== CITY_CHANNEL_TOOLS.PLACE_COMPONENT
      || this.config.activeComponentType !== GEAR_COMPONENT_TYPE
    ) {
      return null;
    }
    const hitData = this.getHoverPlacementData();
    if (!hitData?.placement || hitData.kind === 'gear') return null;
    const placement = hitData.placement;
    if (placement.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || placement.panelType === CITY_CHANNEL_TILE_TYPES.EXIT) return null;
    const hostKind = hitData.kind === 'wall' ? 'wall' : 'tile';
    const hostKey = hitData.key;
    const transform = hitData.transform;
    const surface = this.getGearInstallSurfaceForHover(transform, placement);
    const local = this.getHoverLocalPoint(transform);
    const candidates = GEAR_SOCKET_POSITIONS.map((socket) => {
      const point = getThreeGearSurfacePoint(transform, { position: socket, surface });
      const socketLocal = getGearMountLocalPosition(socket);
      const occupied = (placement.gearMounts || []).some((mount) => (
        mount.position === socket
        && normalizeGearSurfaceForPanel(placement.panelType, mount.surface || 'front') === surface
      ));
      return {
        socket,
        point,
        occupied,
        distance: local
          ? Math.hypot((local.x || 0) - (socketLocal.x || 0), (local.y || 0) - (socketLocal.y || 0))
          : Infinity
      };
    }).sort((left, right) => left.distance - right.distance);
    const nearest = candidates.find((candidate) => !candidate.occupied) || candidates[0];
    if (!nearest || nearest.distance > GEAR_SOCKET_HOVER_RADIUS) return { valid: false, reason: 'miss', placement };
    if (!nearest || nearest.occupied) return { valid: false, reason: 'occupied', placement };
    if (isCornerGearSocket(nearest.socket) && this.hasCornerGearAtPivot({
      pivotWorld: nearest.point,
      surface
    })) {
      return { valid: false, reason: 'corner_occupied', placement };
    }
    const mount = normalizeGearMount({
      id: `gear_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      componentType: GEAR_COMPONENT_TYPE,
      position: nearest.socket,
      socketKind: getGearSocketKind(nearest.socket),
      surface,
      axisBinding: null,
      followMode: 'none',
      followDelaySeconds: 0,
      radius: 1,
      teeth: 12,
      phase: 0
    });
    return {
      valid: true,
      hostKind,
      hostKey,
      cell: { x: placement.x, y: placement.y, z: placement.z },
      edge: placement.edge || null,
      placement,
      transform,
      point: nearest.point,
      mount
    };
  }

  commitGearInstallTarget() {
    const target = this.getGearInstallTargetFromHoverHit();
    if (!target) return false;
    if (!target.valid) {
      this.config.onToast?.('目标齿轮位已被占用。', 'error');
      return false;
    }
    this.config.onCommitOperations?.([{
      kind: 'gearMount',
      action: 'place',
      hostKind: target.hostKind,
      hostKey: target.hostKey,
      cell: target.cell,
      edge: target.edge,
      mount: target.mount
    }], { label: '安装齿轮' });
    this.emitSelection({
      cells: [],
      walls: [],
      gears: [{
        hostKind: target.hostKind,
        hostKey: target.hostKey,
        mountId: target.mount.id,
        cell: target.cell,
        edge: target.edge
      }],
      scope: 'component'
    });
    return true;
  }

  getVisiblePlacementTransforms() {
    const seen = new Set();
    return this.pickables.map((mesh) => mesh.userData?.cityChannel || null)
      .filter((data) => {
        if (!data?.transform || data.kind === 'gear' || seen.has(data.key)) return false;
        seen.add(data.key);
        return true;
      });
  }

  getRuntimeWorldPointForPlacement(componentKey = '', point = null) {
    if (!point || !componentKey) return point;
    const group = this.placementGroups?.get(componentKey);
    if (!group) return point;
    group.updateMatrixWorld(true);
    const vector = new THREE.Vector3(point.x || 0, point.y || 0, point.z || 0).applyMatrix4(group.matrixWorld);
    return { x: vector.x, y: vector.y, z: vector.z };
  }

  getRuntimeSurfacePointForPlacement(componentKey = '', transform = null, localPoint = null, options = {}) {
    if (!transform || !localPoint) return null;
    const runtimePlacement = this.mechanismRuntimeSnapshot?.placements?.[componentKey] || null;
    if (this.hasRuntimePlacementGroupMatrix(runtimePlacement)) {
      return this.getRuntimeWorldPointForPlacement(
        componentKey,
        getThreeSurfacePoint(transform, localPoint, options)
      );
    }
    const runtimeTransform = runtimePlacement ? this.getRuntimeTransform(transform) : transform;
    return this.getRuntimeWorldPointForPlacement(
      componentKey,
      getThreeSurfacePoint(runtimeTransform, localPoint, options)
    );
  }

  getRuntimeGearSurfacePointForPlacement(componentKey = '', transform = null, mount = {}) {
    if (!transform || !mount) return null;
    const runtimePlacement = this.mechanismRuntimeSnapshot?.placements?.[componentKey] || null;
    if (this.hasRuntimePlacementGroupMatrix(runtimePlacement)) {
      return this.getRuntimeWorldPointForPlacement(
        componentKey,
        getThreeGearSurfacePoint(transform, mount)
      );
    }
    const runtimeTransform = runtimePlacement ? this.getRuntimeTransform(transform) : transform;
    return this.getRuntimeWorldPointForPlacement(
      componentKey,
      getThreeGearSurfacePoint(runtimeTransform, mount)
    );
  }

  getPlacementMeshForComponent(componentKey = '', hostKind = 'tile') {
    if (!componentKey) return null;
    const isRenderableMesh = (mesh = null) => !!mesh?.geometry && typeof mesh.updateWorldMatrix === 'function';
    const expectedKind = hostKind === 'wall' ? 'wall' : 'tile';
    const group = this.placementGroups?.get(componentKey);
    const fromGroup = (group?.children || []).find((child) => {
      if (!isRenderableMesh(child)) return false;
      const data = child.userData?.cityChannel;
      if (!data?.placement || data.kind === 'gear') return false;
      if (data.key !== componentKey) return false;
      return expectedKind === 'wall' ? data.kind === 'wall' : data.kind !== 'wall';
    });
    if (fromGroup) return fromGroup;
    return (this.pickables || []).find((mesh) => {
      if (!isRenderableMesh(mesh)) return false;
      const data = mesh.userData?.cityChannel;
      if (!data?.placement || data.kind === 'gear') return false;
      if (data.key !== componentKey) return false;
      return expectedKind === 'wall' ? data.kind === 'wall' : data.kind !== 'wall';
    }) || null;
  }

  getGearBindingSurfacesForPlacement(placement = null) {
    if (!placement) return [];
    if (hasDirectionalGearSurface(placement.panelType) && (placement.edge || placement.isVertical)) return ['front', 'back'];
    return ['front'];
  }

  isSameThreePoint(a = null, b = null, epsilon = GEAR_BINDING_EPSILON) {
    return !!a && !!b
      && Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) <= epsilon
      && Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) <= epsilon
      && Math.abs((Number(a.z) || 0) - (Number(b.z) || 0)) <= epsilon;
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

  getGearBindingCandidateFromBinding(binding = null, visibleByKey = null) {
    if (!binding?.componentKey) return null;
    const map = visibleByKey || new Map(this.getVisiblePlacementTransforms().map((data) => [
      `${data.kind === 'wall' ? 'wall' : 'tile'}:${data.key}`,
      data
    ]));
    const boundKind = binding.hostKind === 'wall' ? 'wall' : 'tile';
    const boundData = map.get(`${boundKind}:${binding.componentKey}`);
    if (!boundData) return null;
    const surface = normalizeGearSurfaceForPanel(boundData.placement?.panelType, binding.surface || 'front');
    const point = this.getRuntimeGearSurfacePointForPlacement(binding.componentKey, boundData.transform, {
      position: binding.socket,
      surface
    });
    if (!point) return null;
    return {
      ...binding,
      hostKind: boundKind,
      surface,
      point,
      transform: boundData.transform,
      placement: boundData.placement
    };
  }

  getSelectedGearBindingContext() {
    const selectedGear = (this.config.selection?.gears || [])[0] || null;
    if (!selectedGear || (this.config.selection?.gears || []).length !== 1) return null;
    const visibleTransforms = this.getVisiblePlacementTransforms();
    const visibleByKey = new Map(visibleTransforms.map((data) => [
      `${data.kind === 'wall' ? 'wall' : 'tile'}:${data.key}`,
      data
    ]));
    const hostData = visibleTransforms.find((data) => (
      data.key === selectedGear.hostKey
      && (data.kind === 'wall' ? 'wall' : 'tile') === (selectedGear.hostKind || 'tile')
    ));
    const host = hostData?.placement || null;
    const mount = host?.gearMounts?.find((item) => item.id === selectedGear.mountId);
    if (!hostData || !host || !mount || !isCornerGearSocket(mount.position)) return null;
    const bindingStatus = this.getGearBindingStatusForMount(hostData.transform, mount);
    const attachment = this.getGearAttachmentContext(hostData.transform, mount, bindingStatus);
    const pivotWorld = this.getGearAttachmentWorldPoint(attachment);
    if (!pivotWorld) return null;
    const candidates = this.getGearBindingCandidatesForPivot({
      pivotWorld,
      source: {
        hostKind: selectedGear.hostKind || 'tile',
        hostKey: selectedGear.hostKey,
        socket: mount.position,
        surface: normalizeGearSurfaceForPanel(host.panelType, mount.surface || 'front')
      }
    });
    if (candidates.length <= 0 && !bindingStatus.bound) return null;
    return {
      hostKind: selectedGear.hostKind || 'tile',
      hostKey: selectedGear.hostKey,
      mountId: selectedGear.mountId,
      host,
      hostTransform: hostData.transform,
      mount,
      attachment,
      attachmentTransform: attachment.transform,
      attachmentMount: attachment.mount,
      attachmentComponentKey: attachment.componentKey,
      pivotWorld,
      candidates,
      bindingStatus,
      invalidCandidate: bindingStatus.bound && !bindingStatus.valid
        ? this.getGearBindingCandidateFromBinding(bindingStatus.binding, visibleByKey)
        : null,
      axisBindingWarning: this.getGearBindingWarningMessage(bindingStatus)
    };
  }

  getGearBindingCandidatesForPivot({ pivotWorld = null } = {}) {
    if (!pivotWorld) return [];
    const candidates = [];
    this.getVisiblePlacementTransforms().forEach((data) => {
      const placement = data.placement;
      const hostKind = data.kind === 'wall' ? 'wall' : 'tile';
      this.getGearBindingSurfacesForPlacement(placement).forEach((surface) => {
        GEAR_SOCKET_POSITIONS.filter(isCornerGearSocket).forEach((socket) => {
          const normalizedSurface = normalizeGearSurfaceForPanel(placement.panelType, surface || 'front');
          const point = this.getRuntimeGearSurfacePointForPlacement(data.key, data.transform, {
            position: socket,
            surface: normalizedSurface
          });
          if (!this.isSameThreePoint(point, pivotWorld)) return;
          candidates.push({
            componentKey: data.key,
            hostKind,
            socket,
            surface: normalizedSurface,
            point,
            transform: data.transform,
            placement
          });
        });
      });
    });
    return candidates;
  }

  getHoveredGearBindingCandidate() {
    const context = this.getSelectedGearBindingContext();
    if (!context || !this.hoverHit?.object) return null;
    const hoverData = this.hoverHit.object.userData?.cityChannel || null;
    if (!hoverData?.placement || hoverData.kind === 'gear') return null;
    const hoverHostKind = hoverData.kind === 'wall' ? 'wall' : 'tile';
    const candidates = context.candidates.filter((candidate) => (
      candidate.hostKind === hoverHostKind && candidate.componentKey === hoverData.key
    ));
    if (candidates.length <= 0) return null;
    return candidates.reduce((best, candidate) => {
      const distance = candidate.point && this.hoverHit?.point
        ? Math.hypot(
          candidate.point.x - this.hoverHit.point.x,
          candidate.point.y - this.hoverHit.point.y,
          candidate.point.z - this.hoverHit.point.z
        )
        : Infinity;
      return !best || distance < best.distance ? { candidate, distance, context } : best;
    }, null);
  }

  commitGearBindingCandidate() {
    if (
      this.config.activeTool !== CITY_CHANNEL_TOOLS.BROWSE
      && this.config.activeTool !== CITY_CHANNEL_TOOLS.SELECT
    ) {
      return false;
    }
    const target = this.getHoveredGearBindingCandidate();
    if (!target?.candidate || !target.context?.mount) return false;
    const current = target.context.mount.axisBinding || null;
    const nextBinding = this.isSameGearBindingCandidate(current, target.candidate)
      ? null
      : {
        hostKind: target.candidate.hostKind,
        componentKey: target.candidate.componentKey,
        socket: target.candidate.socket,
        surface: target.candidate.surface || 'front'
      };
    this.config.onUpdateGearMountConfig?.(target.context.mount.id, { axisBinding: nextBinding });
    this.config.onGearAxisPrompt?.(null);
    this.notifyStatus(nextBinding ? '齿轮连轴：已绑定候选板材' : '齿轮连轴：已取消绑定');
    this.requestRender();
    return true;
  }

  getGearBindingBoardFocusPoint(candidate = null) {
    if (!candidate?.transform) return null;
    return this.getRuntimeSurfacePointForPlacement(candidate.componentKey, candidate.transform, { x: 0, y: 0 }, {
      lift: 0.18,
      rotate: false,
      surface: candidate.surface || 'front'
    });
  }

  getGearBindingCurveControl(start = null, end = null, hostTransform = null, mount = {}) {
    if (!start || !end) return null;
    const startVector = new THREE.Vector3(start.x, start.y, start.z);
    const endVector = new THREE.Vector3(end.x, end.y, end.z);
    const distance = startVector.distanceTo(endVector);
    const surfaceNormal = hostTransform
      ? getThreeSurfaceNormal(hostTransform, mount.surface || 'front')
      : { x: 0, y: 1, z: 0 };
    const normal = new THREE.Vector3(surfaceNormal.x || 0, surfaceNormal.y || 0, surfaceNormal.z || 0);
    if (normal.lengthSq() <= 0.001) normal.set(0, 1, 0);
    normal.normalize();
    const lift = Math.min(0.62, Math.max(0.24, distance * 0.24));
    const control = startVector.clone().add(endVector).multiplyScalar(0.5).add(normal.multiplyScalar(lift));
    return { x: control.x, y: control.y, z: control.z };
  }

  getGearBindingCandidateVisual(context = null, candidate = null) {
    if (!context?.pivotWorld || !candidate?.transform) return null;
    const boardFocusPoint = this.getGearBindingBoardFocusPoint(candidate);
    const boardAnchor = candidate.point || this.getRuntimeGearSurfacePointForPlacement(
      candidate.componentKey,
      candidate.transform,
      {
        position: candidate.socket,
        surface: candidate.surface || 'front'
      }
    );
    if (!boardFocusPoint || !boardAnchor) return null;
    const control = this.getGearBindingCurveControl(
      context.pivotWorld,
      boardFocusPoint,
      context.attachmentTransform || context.hostTransform,
      context.attachmentMount || context.mount
    );
    if (!control) return null;
    return {
      context,
      candidate,
      gearPoint: context.pivotWorld,
      boardAnchor,
      boardFocusPoint,
      control,
      transform: candidate.transform
    };
  }

  createGearBindingCurveMesh(visual = null, {
    material = this.gearBindingActiveCurveMaterial,
    radius = 0.018,
    renderOrder = GEAR_BINDING_ACTIVE_RENDER_ORDER
  } = {}) {
    if (!visual?.gearPoint || !visual?.control || !visual?.boardFocusPoint) return null;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(visual.gearPoint.x, visual.gearPoint.y, visual.gearPoint.z),
      new THREE.Vector3(visual.control.x, visual.control.y, visual.control.z),
      new THREE.Vector3(visual.boardFocusPoint.x, visual.boardFocusPoint.y, visual.boardFocusPoint.z)
    );
    const geometry = new THREE.TubeGeometry(curve, 32, radius, 8, false);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.sharedMaterial = true;
    mesh.userData.cityChannelGearRole = 'binding_curve';
    mesh.renderOrder = renderOrder;
    return mesh;
  }

  addDashedGearBindingCurve(visual = null, {
    material = this.gearBindingAmbientCurveMaterial,
    radius = 0.011,
    renderOrder = GEAR_BINDING_AMBIENT_RENDER_ORDER
  } = {}) {
    if (!visual?.gearPoint || !visual?.control || !visual?.boardFocusPoint) return;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(visual.gearPoint.x, visual.gearPoint.y, visual.gearPoint.z),
      new THREE.Vector3(visual.control.x, visual.control.y, visual.control.z),
      new THREE.Vector3(visual.boardFocusPoint.x, visual.boardFocusPoint.y, visual.boardFocusPoint.z)
    );
    const points = curve.getPoints(26);
    points.slice(0, -1).forEach((point, index) => {
      if (index % 2 !== 0) return;
      const next = points[index + 1];
      const tube = this.createTransmissionTubeMesh(
        { x: point.x, y: point.y, z: point.z },
        { x: next.x, y: next.y, z: next.z },
        radius,
        material
      );
      if (!tube) return;
      tube.userData.cityChannelGearRole = 'binding_curve_dash';
      tube.renderOrder = renderOrder;
      this.overlayGroup.add(tube);
    });
  }

  addGearBindingBoardOverlay(transform = null, {
    candidate = null,
    active = false,
    invalid = false,
    renderOrder = GEAR_BINDING_AMBIENT_RENDER_ORDER
  } = {}) {
    if (!transform?.size || !transform?.position) return;
    const fillMaterial = invalid
      ? this.gearBindingInvalidBoardMaterial
      : (active ? this.gearBindingActiveBoardMaterial : this.gearBindingAmbientBoardMaterial);
    const outlineMaterial = invalid
      ? this.gearBindingInvalidOutlineMaterial
      : (active ? this.gearBindingActiveOutlineMaterial : this.gearBindingAmbientOutlineMaterial);
    const mesh = this.getPlacementMeshForComponent(candidate?.componentKey, candidate?.hostKind);
    if (mesh) {
      const overlay = this.createBoardOverlayGroup({
        fillMaterial,
        outlineMaterial,
        glowMaterial: outlineMaterial,
        renderOrder
      });
      overlay.userData.cityChannelGearRole = invalid ? 'binding_board_invalid' : (active ? 'binding_board_active' : 'binding_board_ambient');
      this.syncBoardOverlayGroup(overlay, mesh, {
        fillScale: invalid ? 1.05 : (active ? 1.045 : 1.026),
        outlineScale: invalid ? 1.071 : (active ? 1.062 : 1.036),
        glowScale: invalid ? 1.085 : (active ? 1.078 : 1.047),
        renderOrder
      });
      this.overlayGroup.add(overlay);
      return;
    }
    const geometry = new THREE.BoxGeometry(transform.size.x, transform.size.y, transform.size.z);
    const fill = new THREE.Mesh(geometry, fillMaterial);
    fill.userData.sharedMaterial = true;
    fill.userData.cityChannelGearRole = invalid ? 'binding_board_invalid' : (active ? 'binding_board_active' : 'binding_board_ambient');
    fill.position.set(transform.position.x, transform.position.y, transform.position.z);
    fill.rotation.y = transform.rotationY || 0;
    fill.scale.setScalar(invalid ? 1.05 : (active ? 1.045 : 1.026));
    fill.renderOrder = renderOrder;
    this.overlayGroup.add(fill);

    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), outlineMaterial);
    outline.userData.sharedMaterial = true;
    outline.userData.cityChannelGearRole = invalid ? 'binding_board_outline_invalid' : (active ? 'binding_board_outline_active' : 'binding_board_outline_ambient');
    outline.position.copy(fill.position);
    outline.rotation.copy(fill.rotation);
    outline.scale.copy(fill.scale).multiplyScalar(invalid ? 1.02 : (active ? 1.016 : 1.01));
    outline.renderOrder = renderOrder + 1;
    this.overlayGroup.add(outline);
  }

  addGearBindingEndpointMarker(visual = null, {
    active = false,
    invalid = false,
    renderOrder = GEAR_BINDING_AMBIENT_RENDER_ORDER
  } = {}) {
    const boardPoint = visual?.boardAnchor || visual?.boardFocusPoint;
    if (!boardPoint) return;
    const material = invalid
      ? this.gearBindingInvalidMaterial
      : (active ? this.gearBindingActiveMaterial : this.gearBindingCandidateMaterial);
    const marker = new THREE.Mesh(this.gearBindingMarkerGeometry, material);
    marker.userData.sharedGeometry = true;
    marker.userData.sharedMaterial = true;
    marker.userData.cityChannelGearRole = invalid ? 'binding_endpoint_invalid' : (active ? 'binding_endpoint_active' : 'binding_endpoint_ambient');
    marker.position.set(boardPoint.x, boardPoint.y, boardPoint.z);
    marker.scale.setScalar(invalid ? 1.36 : (active ? 1.28 : 0.92));
    marker.renderOrder = renderOrder + 3;
    this.overlayGroup.add(marker);
  }

  addGearBindingArrow(visual = null, {
    renderOrder = GEAR_BINDING_ACTIVE_RENDER_ORDER
  } = {}) {
    if (!visual?.gearPoint || !visual?.control || !visual?.boardFocusPoint) return;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(visual.gearPoint.x, visual.gearPoint.y, visual.gearPoint.z),
      new THREE.Vector3(visual.control.x, visual.control.y, visual.control.z),
      new THREE.Vector3(visual.boardFocusPoint.x, visual.boardFocusPoint.y, visual.boardFocusPoint.z)
    );
    const before = curve.getPoint(0.9);
    const end = curve.getPoint(0.98);
    const direction = end.clone().sub(before);
    if (direction.lengthSq() <= 0.001) return;
    direction.normalize();
    const arrow = new THREE.Mesh(this.gearBindingArrowGeometry, this.gearBindingActiveCurveMaterial);
    arrow.userData.sharedGeometry = true;
    arrow.userData.sharedMaterial = true;
    arrow.userData.cityChannelGearRole = 'binding_arrow';
    arrow.position.copy(end);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    arrow.renderOrder = renderOrder + 5;
    this.overlayGroup.add(arrow);
  }

  addGearBindingSourceMarker(context = null, {
    active = false,
    invalid = false,
    renderOrder = GEAR_BINDING_AMBIENT_RENDER_ORDER
  } = {}) {
    if (!context?.pivotWorld || !context.hostTransform) return;
    const material = invalid
      ? this.gearBindingInvalidGlowMaterial
      : (active ? this.gearBindingActiveGlowMaterial : this.gearBindingAmbientGlowMaterial);
    const ring = new THREE.Mesh(this.gearHaloGeometry, material);
    ring.userData.sharedGeometry = true;
    ring.userData.sharedMaterial = true;
    ring.userData.cityChannelGearRole = invalid ? 'binding_source_invalid' : (active ? 'binding_source_active' : 'binding_source_ambient');
    ring.position.set(context.pivotWorld.x, context.pivotWorld.y, context.pivotWorld.z);
    const attachment = context.attachment || {
      componentKey: context.attachmentComponentKey || context.hostKey,
      hostKind: context.attachmentHostKind || context.hostKind,
      placement: context.attachmentPlacement || context.host,
      transform: context.attachmentTransform || context.hostTransform,
      mount: context.attachmentMount || context.mount
    };
    const quaternion = this.getGearAttachmentWorldQuaternion(
      attachment,
      Number(context.mount?.phase) || 0,
      this.mechanismRuntimeSnapshot?.placements || {}
    );
    ring.quaternion.copy(quaternion);
    ring.scale.setScalar(invalid ? 1.5 : (active ? 1.42 : 1.18));
    ring.renderOrder = renderOrder + 2;
    this.overlayGroup.add(ring);
    if (invalid) {
      this.addGearBindingInvalidBadge(this.overlayGroup, {
        position: context.pivotWorld,
        quaternion,
        renderOrder: renderOrder + 6,
        scale: 1.04
      });
    }
  }

  addGearBindingVisual(context = null, candidate = null, {
    active = false,
    hovered = false,
    ambient = false,
    invalid = false,
    showSource = true,
    renderOrder = GEAR_BINDING_AMBIENT_RENDER_ORDER
  } = {}) {
    const visual = this.getGearBindingCandidateVisual(context, candidate);
    if (!visual) return;
    if (active || ambient || invalid) {
      this.addGearBindingBoardOverlay(candidate.transform, {
        candidate,
        active,
        invalid,
        renderOrder
      });
    }
    if (active) {
      const glow = this.createGearBindingCurveMesh(visual, {
        material: this.gearBindingActiveGlowMaterial,
        radius: hovered ? 0.052 : 0.044,
        renderOrder
      });
      if (glow) this.overlayGroup.add(glow);
      const core = this.createGearBindingCurveMesh(visual, {
        material: this.gearBindingActiveCurveMaterial,
        radius: hovered ? 0.02 : 0.016,
        renderOrder: renderOrder + 1
      });
      if (core) this.overlayGroup.add(core);
      this.addGearBindingArrow(visual, { renderOrder });
    } else {
      this.addDashedGearBindingCurve(visual, {
        material: invalid ? this.gearBindingInvalidMaterial : this.gearBindingAmbientCurveMaterial,
        radius: invalid ? 0.014 : (ambient ? 0.012 : 0.01),
        renderOrder
      });
    }
    this.addGearBindingEndpointMarker(visual, { active, invalid, renderOrder });
    if (showSource) this.addGearBindingSourceMarker(context, { active, invalid, renderOrder });
  }

  addGearBindingInvalidWarning(context = null, status = null, {
    candidate = null,
    renderOrder = GEAR_BINDING_ACTIVE_RENDER_ORDER
  } = {}) {
    if (!context?.pivotWorld) return;
    if (candidate?.transform) {
      this.addGearBindingVisual(context, candidate, {
        invalid: true,
        ambient: true,
        renderOrder
      });
      return;
    }
    this.addGearBindingSourceMarker(context, {
      invalid: true,
      renderOrder
    });
    const message = this.getGearBindingWarningMessage(status);
    if (message) context.axisBindingWarning = message;
  }

  getAmbientGearBindingVisuals() {
    const mapData = this.renderModel?.mapData || {};
    const visibleTransforms = this.getVisiblePlacementTransforms();
    const visibleByKey = new Map(visibleTransforms.map((data) => [
      `${data.kind === 'wall' ? 'wall' : 'tile'}:${data.key}`,
      data
    ]));
    const visuals = [];
    visibleTransforms.forEach((data) => {
      const hostKind = data.kind === 'wall' ? 'wall' : 'tile';
      const basePlacement = hostKind === 'wall' ? mapData.walls?.[data.key] : mapData.tiles?.[data.key];
      if (!basePlacement) return;
      (basePlacement.gearMounts || []).forEach((mount) => {
        if (!mount?.axisBinding || !isCornerGearSocket(mount.position)) return;
        const status = getGearAxisBindingStatus({
          mapData,
          placement: basePlacement,
          mount,
          epsilon: GEAR_BINDING_EPSILON
        });
        if (!status.bound || !status.binding) return;
        const attachment = this.getGearAttachmentContext(data.transform, mount, status);
        const context = {
          hostKind,
          hostKey: data.key,
          mountId: mount.id,
          host: data.placement,
          hostTransform: data.transform,
          mount,
          attachment,
          attachmentTransform: attachment.transform,
          attachmentMount: attachment.mount,
          attachmentComponentKey: attachment.componentKey,
          pivotWorld: this.getGearAttachmentWorldPoint(attachment),
          candidates: [],
          bindingStatus: status,
          axisBindingWarning: this.getGearBindingWarningMessage(status)
        };
        const candidate = this.getGearBindingCandidateFromBinding(status.binding, visibleByKey);
        if (!status.valid) {
          visuals.push({
            context,
            candidate,
            invalid: true,
            status
          });
          return;
        }
        if (!candidate) return;
        context.candidates = [candidate];
        visuals.push({ context, candidate, invalid: false, status });
      });
    });
    return visuals;
  }

  updateGearBindingOverlay() {
    clearGroup(this.overlayGroup);
    if (
      this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT
      && this.config.activeComponentType === GEAR_COMPONENT_TYPE
    ) {
      this.updateGearInstallOverlay();
      return;
    }
    const context = this.getSelectedGearBindingContext();
    if (!context) {
      this.getAmbientGearBindingVisuals().forEach((visual) => {
        if (visual.invalid) {
          this.addGearBindingInvalidWarning(visual.context, visual.status, {
            candidate: visual.candidate,
            renderOrder: GEAR_BINDING_AMBIENT_RENDER_ORDER + 2
          });
          return;
        }
        this.addGearBindingVisual(visual.context, visual.candidate, {
          active: false,
          ambient: true,
          renderOrder: GEAR_BINDING_AMBIENT_RENDER_ORDER
        });
      });
      return;
    }
    if (context.bindingStatus?.bound && !context.bindingStatus.valid) {
      this.addGearBindingInvalidWarning(context, context.bindingStatus, {
        candidate: context.invalidCandidate,
        renderOrder: GEAR_BINDING_ACTIVE_RENDER_ORDER
      });
    }
    const current = context.mount.axisBinding || null;
    const hoverCandidate = this.getHoveredGearBindingCandidate()?.candidate || null;
    context.candidates.forEach((candidate) => {
      const active = this.isSameGearBindingCandidate(current, candidate) || this.isSameGearBindingCandidate(hoverCandidate, candidate);
      this.addGearBindingVisual(context, candidate, {
        active,
        hovered: this.isSameGearBindingCandidate(hoverCandidate, candidate),
        showSource: false,
        renderOrder: active ? GEAR_BINDING_ACTIVE_RENDER_ORDER : GEAR_BINDING_AMBIENT_RENDER_ORDER
      });
    });
    if (!context.bindingStatus?.bound || context.bindingStatus.valid) {
      this.addGearBindingSourceMarker(context, {
        active: true,
        renderOrder: GEAR_BINDING_ACTIVE_RENDER_ORDER
      });
    }
  }

  updateGearInstallOverlay() {
    const data = this.getHoverPlacementData();
    if (!data?.placement || !data.transform) return;
    const target = this.getGearInstallTargetFromHoverHit();
    const occupied = new Set((data.placement.gearMounts || []).map((mount) => (
      `${mount.position}:${normalizeGearSurfaceForPanel(data.placement.panelType, mount.surface || 'front')}`
    )));
    const surface = this.getGearInstallSurfaceForHover(data.transform, data.placement);
    GEAR_SOCKET_POSITIONS.forEach((socket) => {
      const point = getThreeGearSurfacePoint(data.transform, { position: socket, surface });
      const active = target?.valid && target.mount?.position === socket;
      const marker = new THREE.Mesh(
        active ? this.gearGeometry : this.gearSocketMarkerGeometry,
        active ? this.gearBindingActiveMaterial : (occupied.has(`${socket}:${surface}`) ? this.ghostInvalidMaterial : this.gearBindingCandidateMaterial)
      );
      marker.userData.sharedGeometry = true;
      marker.userData.sharedMaterial = true;
      marker.scale.setScalar(active ? 1.16 : (socket === 'center' ? 1.45 : 1));
      marker.position.set(point.x, point.y, point.z);
      marker.quaternion.copy(this.getGearSurfaceQuaternion(data.transform, surface));
      marker.renderOrder = active ? GEAR_DETAIL_RENDER_ORDER + 8 : GEAR_CONTACT_RENDER_ORDER;
      if (active) this.addGearVisualDetails(marker, marker.renderOrder);
      this.overlayGroup.add(marker);
    });
  }

  eraseHovered() {
    const data = this.hoverHit?.object?.userData?.cityChannel || this.hoverMesh?.userData?.cityChannel;
    if (!data) return false;
    if (data.kind === 'gear') {
      this.config.onCommitOperations?.([{
        kind: 'gearMount',
        action: 'erase',
        hostKind: data.hostKind,
        hostKey: data.hostKey,
        mount: data.mount
      }], { label: '删除齿轮' });
      this.emitSelection({ cells: [], walls: [], gears: [], scope: null });
      return true;
    }
    const placement = data.placement;
    if (!placement) return false;
    if (placement.edge) {
      this.config.onCommitOperations?.([{
        kind: 'wall',
        action: 'erase',
        cell: { x: placement.x, y: placement.y, z: placement.z },
        edge: placement.edge
      }], { label: '擦除' });
    } else {
      this.config.onCommitOperations?.([{
        kind: 'tile',
        action: 'erase',
        cell: { x: placement.x, y: placement.y, z: placement.z }
      }], { label: '擦除' });
    }
    this.emitSelection({ cells: [], walls: [], gears: [], scope: null });
    return true;
  }

  rotateTransmissionForPlacements() {
    this.requestRender();
    return true;
  }

  inspectSelectedTile() {
    const selection = this.config.selection || {};
    if ((selection.cells || []).length !== 1 || (selection.walls || []).length > 0) return false;
    const cell = selection.cells[0];
    const key = createCellKey(cell.x, cell.y, cell.z);
    const tile = this.renderModel?.mapData?.tiles?.[key];
    if (!tile) return false;
    this.config.onInspectChange?.({
      active: true,
      key,
      cell,
      panelType: tile.panelType,
      tile
    });
    return true;
  }

  closeInspectMode() {
    this.config.onInspectChange?.(null);
  }

  cancelMechanismRuntimePreview() {
    const hadPreview = this.hasMechanismRuntimePreview();
    if (this.mechanismPreviewFrame) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this.mechanismPreviewFrame);
      } else {
        clearTimeout(this.mechanismPreviewFrame);
      }
      this.mechanismPreviewFrame = null;
    }
    if (this.mechanismPreviewTimer) {
      clearTimeout(this.mechanismPreviewTimer);
      this.mechanismPreviewTimer = null;
    }
    this.config.onMechanismPreviewProgress?.(null);
    this.setMechanismRuntimeSnapshot(null);
    return hadPreview;
  }

  getObstructionPlacementTransform(placement = null) {
    if (!placement) return null;
    const mapData = this.renderModel?.mapData || {};
    return placement.edge
      ? getWallThreeTransform(placement, mapData)
      : getTileThreeTransform(placement, mapData);
  }

  addObstructionFlashPlacement(placement = null) {
    const transform = this.getObstructionPlacementTransform(placement);
    if (!transform?.size || !transform?.position) return false;
    const geometry = new THREE.BoxGeometry(transform.size.x, transform.size.y, transform.size.z);
    const fill = new THREE.Mesh(geometry, this.mechanismObstructionFillMaterial);
    fill.userData.sharedMaterial = true;
    fill.userData.cityChannelGearRole = 'mechanism_obstruction_fill';
    fill.position.set(transform.position.x, transform.position.y, transform.position.z);
    fill.rotation.y = transform.rotationY || 0;
    fill.scale.setScalar(1.046);
    fill.renderOrder = MECHANISM_OBSTRUCTION_FLASH_RENDER_ORDER;
    this.mechanismFlashGroup.add(fill);

    const glow = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), this.mechanismObstructionGlowMaterial);
    glow.userData.sharedMaterial = true;
    glow.userData.cityChannelGearRole = 'mechanism_obstruction_glow';
    glow.position.copy(fill.position);
    glow.rotation.copy(fill.rotation);
    glow.scale.copy(fill.scale).multiplyScalar(1.056);
    glow.renderOrder = MECHANISM_OBSTRUCTION_FLASH_RENDER_ORDER + 1;
    this.mechanismFlashGroup.add(glow);

    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), this.mechanismObstructionOutlineMaterial);
    outline.userData.sharedMaterial = true;
    outline.userData.cityChannelGearRole = 'mechanism_obstruction_outline';
    outline.position.copy(fill.position);
    outline.rotation.copy(fill.rotation);
    outline.scale.copy(fill.scale).multiplyScalar(1.022);
    outline.renderOrder = MECHANISM_OBSTRUCTION_FLASH_RENDER_ORDER + 2;
    this.mechanismFlashGroup.add(outline);
    return true;
  }

  clearMechanismObstructionFlash() {
    this.mechanismObstructionFlash = null;
    clearGroup(this.mechanismFlashGroup);
    if (this.mechanismObstructionFillMaterial) this.mechanismObstructionFillMaterial.opacity = 0;
    if (this.mechanismObstructionGlowMaterial) this.mechanismObstructionGlowMaterial.opacity = 0;
    if (this.mechanismObstructionOutlineMaterial) this.mechanismObstructionOutlineMaterial.opacity = 0;
  }

  flashMechanismObstruction(obstruction = null) {
    const placement = obstruction?.obstacle || null;
    if (!placement || !this.mechanismFlashGroup) return false;
    this.clearMechanismObstructionFlash();
    if (!this.addObstructionFlashPlacement(placement)) return false;
    this.mechanismObstructionFlash = {
      startedAt: Date.now(),
      duration: 820
    };
    this.updateMechanismObstructionFlash();
    this.requestRender();
    return true;
  }

  updateMechanismObstructionFlash() {
    if (!this.mechanismObstructionFlash) return false;
    const elapsed = Date.now() - this.mechanismObstructionFlash.startedAt;
    const duration = Math.max(1, this.mechanismObstructionFlash.duration || 820);
    const progress = Math.max(0, Math.min(1, elapsed / duration));
    if (progress >= 1) {
      this.clearMechanismObstructionFlash();
      return false;
    }
    const pulse = Math.abs(Math.sin(progress * Math.PI * 4));
    const envelope = Math.sin(progress * Math.PI);
    const alpha = Math.max(0, Math.min(1, (0.28 + (pulse * 0.72)) * envelope));
    this.mechanismObstructionFillMaterial.opacity = 0.12 + (0.24 * alpha);
    this.mechanismObstructionGlowMaterial.opacity = 0.28 + (0.42 * alpha);
    this.mechanismObstructionOutlineMaterial.opacity = 0.46 + (0.5 * alpha);
    this.requestRender();
    return true;
  }

  requestMechanismFrame(callback) {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame(callback);
    }
    return setTimeout(() => callback(Date.now()), 16);
  }

  getBasePlacementTransform(componentKey = '') {
    return [
      ...(this.renderModel?.tiles || []),
      ...(this.renderModel?.walls || [])
    ].find((transform) => transform.key === componentKey) || null;
  }

  getGearHostKindAndPlacement(componentKey = '') {
    const mapData = this.renderModel?.mapData || {};
    const tile = mapData.tiles?.[componentKey];
    if (tile) return { hostKind: 'tile', placement: tile };
    const wall = mapData.walls?.[componentKey];
    if (wall) return { hostKind: 'wall', placement: wall };
    return { hostKind: null, placement: null };
  }

  getBasePlacementsForAssembly(assembly = null) {
    const mapData = this.renderModel?.mapData || {};
    return (assembly?.componentKeys || []).reduce((placements, componentKey) => {
      const placement = mapData.tiles?.[componentKey] || mapData.walls?.[componentKey];
      if (placement) placements[componentKey] = placement;
      return placements;
    }, {});
  }

  createFixedAxisRuntimeEntry(assembly = null, fixedMount = null, {
    pivotWorld = null,
    driveRatio = 1
  } = {}) {
    if (!assembly || !fixedMount) return null;
    const mapData = this.renderModel?.mapData || {};
    const basePlacement = mapData.tiles?.[fixedMount.componentKey] || mapData.walls?.[fixedMount.componentKey] || null;
    const resolvedPivot = pivotWorld || getGearWorldPosition(basePlacement, fixedMount) || getFixedAxisWorldAnchor(mapData, fixedMount);
    return {
      assembly,
      componentKey: fixedMount.componentKey,
      fixedAxis: fixedMount,
      fixedMount,
      pivotWorld: resolvedPivot,
      anchor: resolvedPivot,
      anchorLocal: getGearMountLocalPosition(fixedMount.position),
      basePlacement,
      basePlacements: this.getBasePlacementsForAssembly(assembly),
      baseRotation: basePlacement?.edge ? 0 : (Number(basePlacement?.rotation) || 0),
      driveRatio: Number(driveRatio) || 1,
      phase: Number(fixedMount.phase) || 0
    };
  }

  getGearNodesForMounts(mounts = []) {
    if (!Array.isArray(mounts) || mounts.length <= 0) return [];
    const mapData = this.renderModel?.mapData || {};
    return mounts.map((mount) => {
      if (!mount?.componentKey || !mount?.id) return null;
      const { hostKind, placement } = this.getGearHostKindAndPlacement(mount.componentKey);
      const transform = this.getBasePlacementTransform(mount.componentKey);
      if (!hostKind || !placement || !transform) return null;
      const liveMount = (placement.gearMounts || []).find((item) => item.id === mount.id) || mount;
      const nodeMount = {
        ...liveMount,
        axisBinding: getAxisBindingForMount({
          mapData,
          mount: liveMount,
          componentKey: mount.componentKey,
          placement
        })
      };
      const bindingStatus = this.getGearBindingStatusForMount(transform, nodeMount);
      const attachment = this.getGearAttachmentContext(transform, nodeMount, bindingStatus);
      const point = getThreeGearSurfacePoint(attachment.transform, attachment.mount);
      const worldPoint = getGearWorldPosition(attachment.placement, attachment.mount);
      if (!point || !worldPoint) return null;
      return {
        id: `${mount.componentKey}:${liveMount.id}`,
        componentKey: mount.componentKey,
        hostKind,
        placement,
        transform,
        attachmentComponentKey: attachment.componentKey,
        attachmentHostKind: attachment.hostKind,
        attachmentPlacement: attachment.placement,
        attachmentTransform: attachment.transform,
        attachmentMount: attachment.mount,
        followsAxisBinding: attachment.followsAxisBinding,
        mountId: liveMount.id,
        mount: nodeMount,
        point,
        worldPoint,
        meshPlane: getGearMeshPlane(attachment.placement, attachment.mount, worldPoint),
        pitchRadius: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: getGearRatioRadiusForMount(nodeMount),
        surfaceKey: getGearSurfaceKey(attachment.placement, attachment.mount),
        driveRatio: 0,
        direction: 0
      };
    }).filter(Boolean);
  }

  getAllGearNodes() {
    const mapData = this.renderModel?.mapData || {};
    const mounts = [];
    Object.entries(mapData.tiles || {}).forEach(([componentKey, tile]) => {
      (tile.gearMounts || []).forEach((mount) => mounts.push({ ...mount, componentKey }));
    });
    Object.entries(mapData.walls || {}).forEach(([componentKey, wall]) => {
      (wall.gearMounts || []).forEach((mount) => mounts.push({ ...mount, componentKey }));
    });
    return this.getGearNodesForMounts(mounts);
  }

  getAssemblyGearNodes(assembly = null) {
    return this.getGearNodesForMounts(assembly?.gearMounts || []);
  }

  resolveDrivenGearNodes(assembly = null, sourceComponentKey = '') {
    const assemblyNodes = this.getAssemblyGearNodes(assembly);
    if (assemblyNodes.length <= 0) return [];
    const allNodes = this.getAllGearNodes();
    const contactGraph = buildGearContactGraphModel(allNodes);
    return resolveDrivenGearNodesModel({
      assembly,
      assemblyNodes,
      allNodes,
      contactGraph,
      sourceComponentKey
    });
  }

  getGearRotationTransmissionEventKeys(assembly = null, assemblyEntries = []) {
    const eventKeys = new Set(assembly?.componentKeys || []);
    assemblyEntries.forEach((entry) => {
      (entry?.assembly?.componentKeys || []).forEach((componentKey) => {
        eventKeys.add(componentKey);
      });
    });
    return eventKeys;
  }

  createAxisBindingRuntimeEntries(nodes = [], assemblyGraph = null, sourceAssembly = null) {
    const mapData = this.renderModel?.mapData || {};
    const seenAxisBindings = new Set();
    return nodes.filter((node) => isDrivenGearAxisBindingActive(node, sourceAssembly)).map((node) => {
      const axisBinding = getAxisBindingForMount({
        mapData,
        mount: node.mount,
        componentKey: node.componentKey,
        placement: node.placement,
        pivotWorld: node.worldPoint || getGearWorldPosition(node.placement, node.mount)
      });
      if (!axisBinding) return null;
      const entryKey = `${axisBinding.componentKey}:${axisBinding.socket}:${node.componentKey}:${node.mountId}`;
      if (seenAxisBindings.has(entryKey)) return null;
      seenAxisBindings.add(entryKey);
      return createAxisBindingRuntimeEntryFromGearNode({
        mapData,
        assemblyGraph,
        gearNode: node,
        axisBinding,
        pivotWorld: node.worldPoint || getGearWorldPosition(node.placement, node.mount),
        driveRatio: node.driveRatio || 1
      });
    }).filter(Boolean);
  }

  createRuntimeSnapshotForMechanism({
    key,
    tile,
    assemblyEntries = [],
    gearNodes = [],
    sourceAngle = 0,
    basePhases = new Map(),
    obstruction = null
  } = {}) {
    const mapData = this.renderModel?.mapData || {};
    if (assemblyEntries.length > 0 || gearNodes.length > 0) {
      return createMechanismRuntimeSnapshot({
        mapData,
        assemblyEntries,
        gearNodes,
        sourceAngle,
        basePhases,
        obstruction
      });
    }
    return {
      sourceAngle,
      placements: {
        [key]: {
          ...tile,
          runtimeSurfaceRotation: normalizeRotation((tile.runtimeSurfaceRotation || 0) + sourceAngle)
        }
      },
      gears: {},
      sync: [],
      obstruction
    };
  }

  playMechanismRuntimePreview({
    key,
    tile,
    params,
    sourceAssembly = null,
    assemblyEntries = [],
    gearNodes = [],
    targetAngle = 0,
    obstruction = null
  } = {}) {
    const normalized = normalizeMechanismParams(params);
    const duration = Math.max(120, Math.round((Math.max(1, Math.abs(targetAngle)) / Math.max(1, normalized.rotationSpeedDegPerSec)) * 1000));
    const delay = Math.round(normalized.triggerDelaySeconds * 1000);
    const basePhases = new Map(gearNodes.map((node) => [node.id, Number(node.mount?.phase) || 0]));
    const startedAt = Date.now() + delay;
    const applyAngle = (angle) => {
      const snapshot = this.createRuntimeSnapshotForMechanism({
        key,
        tile,
        assemblyEntries,
        gearNodes,
        sourceAngle: angle,
        basePhases,
        obstruction
      });
      this.setMechanismRuntimeSnapshot(snapshot);
      this.config.onMechanismPreviewProgress?.({
        active: true,
        key,
        panelType: tile?.panelType,
        progress: Math.min(1, Math.abs(angle) / Math.max(1, Math.abs(targetAngle))),
        params: normalized,
        assemblyId: sourceAssembly?.id || assemblyEntries[0]?.assembly?.id || null
      });
    };
    const animateTo = (fromAngle, toAngle, done = null) => {
      const runStartedAt = Date.now();
      const runFrame = () => {
        const now = Date.now();
        if (now < startedAt && fromAngle === 0) {
          this.mechanismPreviewFrame = this.requestMechanismFrame(runFrame);
          return;
        }
        const elapsed = now - (fromAngle === 0 ? startedAt : runStartedAt);
        const progress = Math.max(0, Math.min(1, elapsed / duration));
        const eased = 0.5 - (Math.cos(progress * Math.PI) * 0.5);
        applyAngle(fromAngle + ((toAngle - fromAngle) * eased));
        if (progress < 1) {
          this.mechanismPreviewFrame = this.requestMechanismFrame(runFrame);
          return;
        }
        this.mechanismPreviewFrame = null;
        done?.();
      };
      this.mechanismPreviewFrame = this.requestMechanismFrame(runFrame);
    };

    applyAngle(0);
    animateTo(0, targetAngle, () => {
      applyAngle(targetAngle);
      if (!normalized.autoReturn) return;
      this.mechanismPreviewTimer = setTimeout(() => {
        animateTo(targetAngle, 0, () => {
          applyAngle(0);
          this.cancelMechanismRuntimePreview();
        });
      }, Math.round(normalized.autoReturnDelaySeconds * 1000));
    });
  }

  triggerMechanismAtCell(cell, paramsOverride = null) {
    if (!cell) return false;
    const key = createCellKey(cell.x, cell.y, cell.z);
    const tile = this.renderModel?.mapData?.tiles?.[key];
    if (!tile || tile.panelType !== CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE) return false;
    this.cancelMechanismRuntimePreview();
    const mapData = this.renderModel?.mapData || {};
    const normalized = normalizeMechanismParams(paramsOverride || this.config.mechanismParams?.[key]);
    const sign = normalized.rotationDirection === 'left' ? -1 : 1;
    const targetAngle = sign * normalized.rotationAngle;
    const assemblyGraph = buildMechanicalAssemblies(mapData);
    const sourceAssembly = getAssemblyForCell(assemblyGraph, key);
    const gearNodes = sourceAssembly?.gearMounts?.length > 0
      ? this.resolveDrivenGearNodes(sourceAssembly, key)
      : [];
    let assemblyEntries = this.createAxisBindingRuntimeEntries(gearNodes, assemblyGraph, sourceAssembly);
    let driveFailure = null;

    if (gearNodes.length <= 0 && assemblyEntries.length <= 0) {
      const drive = findFixedAxisForTrigger(mapData, cell);
      if (drive.ok && drive.assembly && drive.fixedAxis) {
        const runtimeEntry = this.createFixedAxisRuntimeEntry(drive.assembly, drive.fixedAxis);
        assemblyEntries = runtimeEntry ? [runtimeEntry] : [];
      } else {
        driveFailure = drive;
      }
    }
    if (gearNodes.length <= 0 && assemblyEntries.length <= 0) {
      this.config.onToast?.(driveFailure?.message || '当前传动网络中没有可驱动的承动组件。', 'error');
      return false;
    }

    const obstructions = assemblyEntries.map((entry) => {
      const driveRatio = Number(entry.driveRatio) || 1;
      const obstruction = findRotationObstruction({
        mapData,
        assembly: entry.assembly,
        anchor: entry.anchor,
        fixedMount: entry.fixedMount,
        targetAngle: targetAngle * driveRatio
      });
      if (!obstruction) return null;
      return {
        ...obstruction,
        assemblyId: entry.assembly?.id,
        fixedAxisId: entry.fixedAxis?.id,
        assemblyAngle: obstruction.angle,
        sourceAngle: obstruction.angle / driveRatio
      };
    }).filter(Boolean);
    const obstruction = obstructions.sort((a, b) => Math.abs(a.sourceAngle) - Math.abs(b.sourceAngle))[0] || null;
    const limitingObstruction = obstruction ? { ...obstruction, angle: obstruction.sourceAngle } : null;
    const allowedRotation = getAllowedRotationAngle({
      targetAngle,
      obstruction: limitingObstruction
    });
    if (limitingObstruction || !allowedRotation.canRotate) {
      this.setMechanismRuntimeSnapshot(null);
      this.flashMechanismObstruction(limitingObstruction);
      this.config.onToast?.('旁边有遮挡物，当前齿轮组没有足够转动空间。', 'error');
      return false;
    }
    this.playMechanismRuntimePreview({
      key,
      tile,
      params: normalized,
      sourceAssembly,
      assemblyEntries,
      gearNodes,
      targetAngle: allowedRotation.angle,
      obstruction: limitingObstruction
    });
    const gearCount = gearNodes.length;
    const drivenBoardCount = assemblyEntries.reduce((count, entry) => (
      count + (entry.assembly?.componentKeys?.length || 0)
    ), 0);
    this.config.onToast?.(
      gearCount > 0
        ? `齿轮传动预览：${gearCount} 个齿轮，${drivenBoardCount} 块板材。`
        : `固定轴预览：${drivenBoardCount || 1} 块板材。`,
      'success'
    );
    return true;
  }

  getHoverPlacementData() {
    const data = this.hoverHit?.object?.userData?.cityChannel || null;
    if (!data?.placement) return null;
    if (data.kind === 'gear') {
      const hostData = this.getVisiblePlacementTransforms().find((item) => (
        item.key === data.hostKey
        && (item.kind === 'wall' ? 'wall' : 'tile') === (data.hostKind || 'tile')
      ));
      return hostData || data;
    }
    return data;
  }

  getHoverLocalPoint(transform = null) {
    if (!transform || !this.hoverHit?.point) return null;
    const point = this.hoverHit.point;
    if (transform.kind === 'tile') {
      const local = new THREE.Vector3(
        point.x - transform.position.x,
        0,
        point.z - transform.position.z
      );
      local.applyAxisAngle(new THREE.Vector3(0, 1, 0), -(transform.rotationY || 0));
      return { x: local.x, y: local.z };
    }
    if (transform.kind === 'verticalTile') {
      const axisIsX = (transform.size?.x || 0) >= (transform.size?.z || 0);
      const local = {
        x: axisIsX ? point.x - transform.position.x : point.z - transform.position.z,
        y: transform.position.y - point.y
      };
      const rotation = normalizeRotation(transform.placement?.rotation || 0);
      if (rotation === 180 || rotation === 270) local.x *= -1;
      return local;
    }
    const edge = transform.edge || 'north';
    const axisIsX = edge === 'north' || edge === 'south';
    return {
      x: axisIsX ? point.x - transform.position.x : point.z - transform.position.z,
      y: transform.position.y - point.y
    };
  }

  getHoverSnapIntent(transform = null) {
    return resolveThreeHoverSnapIntent(transform, this.getHoverLocalPoint(transform), {
      centerReplacementRadius: CENTER_REPLACEMENT_RADIUS,
      wallEdgeSnapWorldRadius: WALL_EDGE_SNAP_WORLD_RADIUS,
      verticalCenterRadius: VERTICAL_CENTER_REPLACEMENT_RADIUS
    });
  }

  createSnapCandidate(target = null, {
    priority = 0,
    snapKind = target?.snapMode || 'snap',
    distance = Infinity,
    source = 'hover'
  } = {}) {
    if (!target?.cell || !target?.transform) return null;
    return {
      ...target,
      snapKind,
      snapMode: target.snapMode || snapKind,
      priority,
      distance,
      source
    };
  }

  chooseSnapCandidate(candidates = []) {
    return candidates
      .filter(Boolean)
      .sort((left, right) => (
        (right.priority - left.priority)
        || ((left.distance ?? Infinity) - (right.distance ?? Infinity))
      ))[0] || null;
  }

  getCellFromHorizontalEdge(placement = null, edge = 'north') {
    if (!placement) return null;
    const offsets = {
      north: { x: 0, y: -1 },
      east: { x: 1, y: 0 },
      south: { x: 0, y: 1 },
      west: { x: -1, y: 0 }
    };
    const offset = offsets[edge] || offsets.north;
    return {
      x: (Number(placement.x) || 0) + offset.x,
      y: (Number(placement.y) || 0) + offset.y,
      z: Number(placement.z) || 0
    };
  }

  createTileTarget(cell = null, { isVertical = false, rotation = this.config.activeRotation, allowReplacement = false, snapMode = 'floor' } = {}) {
    if (!cell) return null;
    const mapData = this.renderModel?.mapData || {};
    const transform = getTileThreeTransform({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      panelType: this.config.activeTileType,
      rotation,
      transmissionRotation: rotation,
      isVertical
    }, mapData);
    const operation = createThreeTilePlacementOperation({
      cell,
      mapData,
      activeTool: this.config.activeTool,
      activeTileType: this.config.activeTileType,
      activeRotation: rotation,
      allowReplacement,
      isVertical
    });
    return {
      cell,
      transform,
      operation,
      blockReason: operation ? null : 'occupied',
      kind: isVertical ? 'verticalTile' : 'tile',
      replace: allowReplacement,
      snapMode,
      valid: !!operation
    };
  }

  createWallTarget(cell = null, edge = 'north', { allowReplacement = false, snapMode = 'edge' } = {}) {
    if (!cell || !edge) return null;
    const mapData = this.renderModel?.mapData || {};
    const transform = getWallThreeTransform({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      edge,
      panelType: this.config.activeTileType,
      transmissionRotation: this.config.activeRotation
    }, mapData);
    const blockReason = getThreeWallPlacementBlockReason({
      cell,
      edge,
      mapData,
      activeTool: this.config.activeTool,
      activeTileType: this.config.activeTileType,
      allowReplacement
    });
    const operation = createThreeWallPlacementOperation({
      cell,
      edge,
      mapData,
      activeTool: this.config.activeTool,
      activeTileType: this.config.activeTileType,
      activeRotation: this.config.activeRotation,
      allowReplacement
    });
    return {
      cell,
      edge,
      transform,
      operation,
      blockReason,
      kind: 'wall',
      replace: allowReplacement,
      snapMode,
      valid: !!operation
    };
  }

  createReplacementTargetForPlacement(placement = null, transform = null) {
    if (!placement || !transform) return null;
    if (transform.kind === 'wall' || placement.edge) {
      return this.createWallTarget(
        { x: placement.x, y: placement.y, z: placement.z },
        placement.edge,
        { allowReplacement: true, snapMode: 'replace' }
      );
    }
    return this.createTileTarget(
      { x: placement.x, y: placement.y, z: placement.z },
      {
        isVertical: transform.kind === 'verticalTile' || !!placement.isVertical,
        rotation: normalizeRotation(placement.rotation ?? this.config.activeRotation ?? 0),
        allowReplacement: true,
        snapMode: 'replace'
      }
    );
  }

  createVerticalSideSnapTarget(placement = null, transform = null, side = 'left') {
    if (!placement || !transform) return null;
    const sideCell = this.getVerticalSidePlacementCell(placement, transform, side);
    if (!sideCell) return null;
    if (transform.kind === 'wall' || placement.edge) {
      const edge = placement.edge || transform.edge || 'north';
      return this.createWallTarget(sideCell, edge, {
        allowReplacement: false,
        snapMode: 'sideSnap'
      });
    }
    if (placement.isVertical) {
      return this.createTileTarget(sideCell, {
        isVertical: true,
        rotation: normalizeRotation(placement.rotation || 0),
        allowReplacement: false,
        snapMode: 'sideSnap'
      });
    }
    return null;
  }

  createVerticalSideFloorSnapTarget(placement = null, transform = null, side = 'left') {
    if (!placement || !transform) return null;
    const surface = this.getHoverVerticalSurfaceSide(transform);
    const faceCell = getThreeVerticalFaceFloorPlacementCell(placement, transform, surface, 0);
    if (!faceCell) return null;
    return this.createTileTarget(faceCell, {
      isVertical: false,
      allowReplacement: false,
      snapMode: 'sideFloorSnap'
    });
  }

  createVerticalTopFloorSnapTarget(placement = null, transform = null) {
    const surface = this.getHoverVerticalSurfaceSide(transform);
    const topCell = getThreeVerticalFaceFloorPlacementCell(placement, transform, surface, 1);
    if (!topCell) return null;
    return this.createTileTarget(topCell, {
      isVertical: false,
      allowReplacement: false,
      snapMode: 'topFloorSnap'
    });
  }

  getVerticalSidePlacementCell(placement = null, transform = null, side = 'left') {
    if (!placement || !transform) return null;
    const offsetSign = side === 'right' ? 1 : -1;
    if (transform.kind === 'wall' || placement.edge) {
      const edge = placement.edge || transform.edge || 'north';
      const wallRunsEastWest = edge === 'north' || edge === 'south';
      return {
        x: (Number(placement.x) || 0) + (wallRunsEastWest ? offsetSign : 0),
        y: (Number(placement.y) || 0) + (wallRunsEastWest ? 0 : offsetSign),
        z: Number(placement.z) || 0
      };
    }
    if (placement.isVertical) {
      const axisIsX = (transform.size?.x || 0) >= (transform.size?.z || 0);
      return {
        x: (Number(placement.x) || 0) + (axisIsX ? offsetSign : 0),
        y: (Number(placement.y) || 0) + (axisIsX ? 0 : offsetSign),
        z: Number(placement.z) || 0
      };
    }
    return null;
  }

  getHoverVerticalSurfaceSide(transform = null) {
    if (!transform) return 'front';
    const frontNormal = getThreeSurfaceNormal(transform, 'front');
    const frontVector = new THREE.Vector3(frontNormal.x || 0, frontNormal.y || 0, frontNormal.z || 0);
    if (frontVector.lengthSq() <= 0.000001) return 'front';
    frontVector.normalize();
    let hitNormal = null;
    if (this.hoverHit?.face?.normal) {
      hitNormal = this.hoverHit.face.normal.clone();
      if (this.hoverHit.object?.matrixWorld) hitNormal.transformDirection(this.hoverHit.object.matrixWorld);
    } else if (this.raycaster?.ray?.direction) {
      hitNormal = this.raycaster.ray.direction.clone().multiplyScalar(-1);
    }
    if (!hitNormal || hitNormal.lengthSq() <= 0.000001) return 'front';
    hitNormal.normalize();
    return hitNormal.dot(frontVector) >= 0 ? 'front' : 'back';
  }

  createVerticalTopSnapTarget(placement = null) {
    const topTarget = getThreeVerticalTopPlacementTarget(placement);
    if (!topTarget?.cell) return null;
    if (topTarget.kind === 'wall') {
      return this.createWallTarget(topTarget.cell, topTarget.edge, {
        allowReplacement: false,
        snapMode: 'topSnap'
      });
    }
    const cell = topTarget.cell;
    const rotation = topTarget.rotation ?? getThreeVerticalTileRotationForSupport(placement);
    const target = this.createTileTarget(cell, {
      isVertical: true,
      rotation,
      allowReplacement: false,
      snapMode: 'topSnap'
    });
    if (!target) return null;
    target.blockReason = getThreeVerticalTilePlacementBlockReason({
      supportPlacement: placement,
      cell,
      mapData: this.renderModel?.mapData || {},
      activeTool: this.config.activeTool,
      activeTileType: this.config.activeTileType
    });
    target.operation = createThreeVerticalTilePlacementOperation({
      supportPlacement: placement,
      cell,
      mapData: this.renderModel?.mapData || {},
      activeTool: this.config.activeTool,
      activeTileType: this.config.activeTileType
    });
    target.valid = !!target.operation;
    return target;
  }

  getHoverBoardSnapCandidates({
    preferWallPose = false,
    allowReplacement = true
  } = {}) {
    const data = this.getHoverPlacementData();
    const placement = data?.placement || null;
    const transform = data?.transform || null;
    if (!placement || !transform) return [];
    const intent = this.getHoverSnapIntent(transform);
    if (!intent) return [];
    const wantsWallPose = preferWallPose || this.config.panelPose === 'wall';
    const isVerticalSurface = (
      transform.kind === 'wall'
      || transform.kind === 'verticalTile'
      || !!placement.edge
      || !!placement.isVertical
    );
    const candidates = [];

    const canCenterReplace = (
      intent.zone === 'center'
      && allowReplacement
      && (wantsWallPose || transform.kind === 'tile')
    );

    if (canCenterReplace) {
      candidates.push(this.createSnapCandidate(
        this.createReplacementTargetForPlacement(placement, transform),
        {
          priority: SNAP_PRIORITIES.CENTER_REPLACE,
          snapKind: 'centerReplace',
          distance: intent.centerDistance,
          source: 'hover'
        }
      ));
    }

    if (isVerticalSurface) {
      if (intent.zone === 'top') {
        candidates.push(this.createSnapCandidate(
          wantsWallPose
            ? this.createVerticalTopSnapTarget(placement)
            : this.createVerticalTopFloorSnapTarget(placement, transform),
          {
            priority: SNAP_PRIORITIES.VERTICAL_TOP,
            snapKind: wantsWallPose ? 'verticalTop' : 'verticalTopFloor',
            distance: intent.topDistance,
            source: 'hover'
          }
        ));
      }

      if (intent.zone === 'side' || (!wantsWallPose && intent.zone === 'center')) {
        candidates.push(this.createSnapCandidate(
          wantsWallPose
            ? this.createVerticalSideSnapTarget(placement, transform, intent.side)
            : this.createVerticalSideFloorSnapTarget(placement, transform, intent.side),
          {
            priority: SNAP_PRIORITIES.VERTICAL_SIDE,
            snapKind: wantsWallPose ? 'verticalSide' : 'verticalSideFloor',
            distance: intent.sideDistance,
            source: 'hover'
          }
        ));
      }

      return candidates;
    }

    if (transform.kind === 'tile') {
      if (intent.zone === 'edge') {
        const wantsPreciseWallEdge = (
          intent.edgeDistance <= PRECISE_WALL_EDGE_SNAP_WORLD_RADIUS
          && !isPortalMaterial(this.config.activeTileType)
        );
        if (wantsWallPose || wantsPreciseWallEdge) {
          candidates.push(this.createSnapCandidate(
            this.createWallTarget(
              { x: placement.x, y: placement.y, z: placement.z },
              intent.edge,
              { allowReplacement: false, snapMode: 'edgeSnap' }
            ),
            {
              priority: SNAP_PRIORITIES.WALL_EDGE,
              snapKind: 'wallEdge',
              distance: intent.edgeDistance,
              source: 'hover'
            }
          ));
        } else {
          const cell = this.getCellFromHorizontalEdge(placement, intent.edge);
          candidates.push(this.createSnapCandidate(
            this.createTileTarget(cell, { isVertical: false, allowReplacement: false, snapMode: 'edgeSnap' }),
            {
              priority: SNAP_PRIORITIES.FLOOR_EDGE,
              snapKind: 'floorEdge',
              distance: intent.edgeDistance,
              source: 'hover'
            }
          ));
        }
      }
      return candidates;
    }

    return candidates;
  }

  getPlacementTargetFromHoverBoard(options = {}) {
    return this.chooseSnapCandidate(this.getHoverBoardSnapCandidates(options));
  }

  getGroundSnapCandidate({
    activeLayer = Number.isInteger(this.config.activeLayer) ? this.config.activeLayer : 0
  } = {}) {
    if (!this.hasPointerRay) return null;
    const mapData = this.renderModel?.mapData || {};
    const planeY = (activeLayer * CITY_CHANNEL_THREE_DIMENSIONS.layerHeight) + CITY_CHANNEL_THREE_DIMENSIONS.tileThickness;
    this.groundPlane.set(new THREE.Vector3(0, 1, 0), -planeY);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.groundHitPoint);
    if (!hit) return null;
    const cell = threePositionToCell(hit, mapData, activeLayer);
    if (!cell) return null;
    if (this.config.panelPose === 'wall') {
      const edgeTarget = getThreeNearestCellEdge(hit, mapData, cell);
      if (!edgeTarget || edgeTarget.distance > WALL_EDGE_SNAP_WORLD_RADIUS) return null;
      return this.createSnapCandidate(
        this.createWallTarget(cell, edgeTarget.edge, { allowReplacement: false, snapMode: 'groundWall' }),
        {
          priority: SNAP_PRIORITIES.GROUND_WALL,
          snapKind: 'groundWall',
          distance: edgeTarget.distance,
          source: 'ground'
        }
      );
    }
    return this.createSnapCandidate(
      this.createTileTarget(cell, { isVertical: false, allowReplacement: false, snapMode: 'groundFloor' }),
      {
        priority: SNAP_PRIORITIES.GROUND_FLOOR,
        snapKind: 'groundFloor',
        distance: 0,
        source: 'ground'
      }
    );
  }

  getPlacementTargetFromPointerRay() {
    if (!this.hasPointerRay) return null;
    if (this.config.activeTool !== CITY_CHANNEL_TOOLS.PLACE_TILE || !this.config.activeTileType) return null;
    const activeLayer = Number.isInteger(this.config.activeLayer) ? this.config.activeLayer : 0;
    const hoverTarget = this.getPlacementTargetFromHoverBoard({ allowReplacement: true });
    if (hoverTarget) return hoverTarget;
    if (this.hoverHit?.object?.userData?.cityChannel?.placement) return null;
    return this.getGroundSnapCandidate({ activeLayer });
  }

  updatePlacementGhost() {
    const target = this.getPlacementTargetFromPointerRay();
    this.placementTarget = target;
    if (!target?.transform) {
      this.clearPlacementGhost();
      this.emitStatus();
      this.requestRender();
      return;
    }
    const ghostPlacement = {
      ...(target.transform.placement || {}),
      panelType: this.config.activeTileType
    };
    const ghostTransform = {
      ...target.transform,
      panelType: this.config.activeTileType,
      placement: ghostPlacement
    };
    this.replaceGhostGroup('ghostGroup', this.createBoardGhostGroup(ghostTransform, {
      valid: target.valid,
      showGearSockets: false
    }));
    this.emitStatus();
    this.requestRender();
  }

  commitPlacementTarget(target = this.placementTarget) {
    if (!target?.operation || typeof this.config.onCommitOperations !== 'function') return false;
    this.config.onCommitOperations([target.operation], {
      label: target.kind === 'wall' || target.kind === 'verticalTile'
        ? '3D 放置竖板'
        : '3D 放置板材'
    });
    this.selectedMesh = null;
    this.placementTarget = null;
    this.clearPlacementGhost();
    this.requestRender();
    return true;
  }

  selectHovered(additive = false) {
    const data = this.hoverMesh?.userData?.cityChannel || null;
    const selection = this.getPlacementSelectionFromData(data);
    if (selection) {
      if (!additive) {
        this.emitSelection(selection);
      } else {
        const current = this.config.selection || {};
        const next = {
          cells: [...(current.cells || [])],
          walls: [...(current.walls || [])],
          gears: [...(current.gears || [])],
          scope: selection.scope || current.scope || null
        };
        const toggleByKey = (items, target, getKey) => {
          const targetKey = getKey(target);
          const index = items.findIndex((item) => getKey(item) === targetKey);
          if (index < 0) return [...items, target];
          return items.filter((_, itemIndex) => itemIndex !== index);
        };
        (selection.cells || []).forEach((cell) => {
          next.cells = toggleByKey(next.cells, cell, (item) => createCellKey(item.x, item.y, item.z));
        });
        (selection.walls || []).forEach((wall) => {
          next.walls = toggleByKey(next.walls, wall, (item) => createWallKey(item.x, item.y, item.z, item.edge));
        });
        (selection.gears || []).forEach((gear) => {
          next.gears = toggleByKey(next.gears, gear, (item) => `${item.hostKind || 'tile'}:${item.hostKey}:${item.mountId}`);
        });
        if (next.cells.length + next.walls.length + next.gears.length <= 0) next.scope = null;
        else if (next.cells.length + next.walls.length > 0) next.scope = 'board';
        else if (next.gears.length > 0) next.scope = 'component';
        this.emitSelection(next);
      }
      if (this.config.activeTool === CITY_CHANNEL_TOOLS.BROWSE) this.config.onRequestTool?.(CITY_CHANNEL_TOOLS.SELECT);
    } else {
      if (!additive) this.emitSelection({ cells: [], walls: [], gears: [], scope: null });
    }
    this.requestRender();
    this.emitStatus();
  }

  emitStatus() {
    if (this.carryState) {
      this.notifyStatus(this.carryState.mode === 'copy' ? '复制预览：点击目标位置完成复制' : '移动预览：点击目标位置完成移动');
      return;
    }
    const gearBindingContext = (
      this.config.activeTool === CITY_CHANNEL_TOOLS.BROWSE
      || this.config.activeTool === CITY_CHANNEL_TOOLS.SELECT
    ) ? this.getSelectedGearBindingContext() : null;
    if (gearBindingContext) {
      if (gearBindingContext.bindingStatus?.bound && !gearBindingContext.bindingStatus.valid) {
        this.notifyStatus(gearBindingContext.axisBindingWarning || '齿轮连轴失效：请重新绑定板材');
        return;
      }
      const target = this.getHoveredGearBindingCandidate();
      if (target?.candidate) {
        const current = gearBindingContext.mount.axisBinding || null;
        this.notifyStatus(
          this.isSameGearBindingCandidate(current, target.candidate)
            ? '齿轮连轴：点击取消当前绑定'
            : '齿轮连轴：点击绑定候选板材'
        );
        return;
      }
      this.notifyStatus('齿轮连轴：点击高亮候选板材绑定');
      return;
    }
    if (
      this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT
      && this.config.activeComponentType === GEAR_COMPONENT_TYPE
    ) {
      const target = this.getGearInstallTargetFromHoverHit();
      if (target?.valid) {
        this.notifyStatus(`齿轮安装：${target.cell.x},${target.cell.y},${target.cell.z} ${target.mount.position}`);
        return;
      }
      this.notifyStatus(target ? '齿轮安装：目标轴点已占用' : '齿轮安装：请选择板材表面');
      return;
    }
    if (this.config.activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && this.placementTarget?.cell) {
      const { x, y, z } = this.placementTarget.cell;
      if (this.placementTarget.kind === 'verticalTile') {
        const invalidReason = this.placementTarget.blockReason === 'invalidCell'
          ? '超出层高'
          : (this.placementTarget.blockReason === 'invalidMaterial' ? '入口/出口不能竖放' : '已有板材');
        this.notifyStatus(
          this.placementTarget.valid
            ? `正交 3D 竖直板预览：${x},${y},${z}`
            : `正交 3D 竖直板预览：${x},${y},${z} ${invalidReason}`
        );
        return;
      }
      if (this.placementTarget.kind === 'wall') {
        const edge = this.placementTarget.edge || 'north';
        const invalidReason = this.placementTarget.blockReason === 'unsupported'
          ? '缺少支撑'
          : (this.placementTarget.blockReason === 'invalidMaterial' ? '入口/出口不能竖放' : '已有竖板');
        this.notifyStatus(
          this.placementTarget.valid
            ? `正交 3D 竖板预览：${x},${y},${z} ${edge}`
            : `正交 3D 竖板预览：${x},${y},${z} ${edge} ${invalidReason}`
        );
        return;
      }
      this.notifyStatus(
        this.placementTarget.valid
          ? `正交 3D 放置预览：${x},${y},${z}`
          : `正交 3D 放置预览：${x},${y},${z} 已有板材`
      );
      return;
    }
    if (this.selectedMesh?.userData?.cityChannel?.kind === 'gear') {
      const data = this.selectedMesh.userData.cityChannel;
      if (data.axisBindingInvalid) {
        this.notifyStatus(data.axisBindingWarning || '齿轮连轴失效：请重新绑定板材');
        return;
      }
      this.notifyStatus(`正交 3D：已选中齿轮 ${data.mount?.position || ''}`);
      return;
    }
    if (this.selectedMesh?.userData?.cityChannel?.placement) {
      this.notifyStatus(`正交 3D：已选中 ${getPlacementLabel(this.selectedMesh.userData.cityChannel.placement)}`);
      return;
    }
    if (this.hoverMesh?.userData?.cityChannel?.kind === 'gear') {
      const data = this.hoverMesh.userData.cityChannel;
      if (data.axisBindingInvalid) {
        this.notifyStatus(data.axisBindingWarning || '齿轮连轴失效：请重新绑定板材');
        return;
      }
      this.notifyStatus(`正交 3D：齿轮 ${data.mount?.position || ''}`);
      return;
    }
    if (this.hoverMesh?.userData?.cityChannel?.placement) {
      this.notifyStatus(`正交 3D：${getPlacementLabel(this.hoverMesh.userData.cityChannel.placement)}`);
      return;
    }
    const tileCount = Object.keys(this.renderModel?.mapData?.tiles || {}).length;
    const wallCount = Object.keys(this.renderModel?.mapData?.walls || {}).length;
    this.notifyStatus(`正交 3D 编辑：${tileCount} 地板 / ${wallCount} 竖板，缩放 ${this.zoom.toFixed(2)}x`);
  }

  requestRender() {
    if (this.disposed) return;
    if (this.renderRequested) return;
    this.renderRequested = true;
    requestAnimationFrame(() => {
      if (this.disposed) return;
      this.renderRequested = false;
      this.render();
    });
  }

  render() {
    const selectedMeshes = this.selectedMeshes || [];
    if (!this.selectionOverlays) this.selectionOverlays = [];
    while (this.selectionOverlays.length < selectedMeshes.length) {
      const overlay = this.createBoardOverlayGroup({
        fillMaterial: this.selectionMaterial,
        outlineMaterial: this.selectionOutlineMaterial,
        glowMaterial: this.selectionGlowMaterial,
        renderOrder: SELECTION_OVERLAY_RENDER_ORDER
      });
      this.worldGroup.add(overlay);
      this.selectionOverlays.push(overlay);
    }
    this.selectionOverlays.forEach((overlay, index) => {
      const mesh = selectedMeshes[index] || null;
      if (!mesh) {
        overlay.visible = false;
        (overlay.children || []).forEach((child) => {
          child.visible = false;
        });
        return;
      }
      this.syncBoardOverlayGroup(overlay, mesh, {
        fillScale: 1.026,
        outlineScale: 1.04,
        glowScale: 1.072,
        renderOrder: SELECTION_OVERLAY_RENDER_ORDER
      });
    });

    if (this.hoverMesh) {
      if (!this.hoverOverlayGroup) {
        this.hoverOverlayGroup = this.createBoardOverlayGroup({
          fillMaterial: this.hoverMaterial,
          outlineMaterial: this.hoverOutlineMaterial,
          glowMaterial: this.hoverGlowMaterial,
          renderOrder: HOVER_OVERLAY_RENDER_ORDER
        });
        this.worldGroup.add(this.hoverOverlayGroup);
      }
      this.syncBoardOverlayGroup(this.hoverOverlayGroup, this.hoverMesh, {
        fillScale: 1.018,
        outlineScale: 1.03,
        glowScale: 1.052,
        renderOrder: HOVER_OVERLAY_RENDER_ORDER
      });
    } else if (this.hoverOverlayGroup) {
      this.hoverOverlayGroup.visible = false;
      this.hoverOverlayGroup.children.forEach((child) => {
        child.visible = false;
      });
    }
    this.updateGearBindingOverlay();
    this.updateMechanismObstructionFlash();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('wheel', this.handleWheel);
    this.renderer.domElement.removeEventListener('contextmenu', this.handleContextMenu);
    if (this.keyboardFrameId) {
      cancelAnimationFrame(this.keyboardFrameId);
      this.keyboardFrameId = null;
    }
    this.clearLongPressTimer();
    this.keyState.clear();
    this.cancelMechanismRuntimePreview();
    this.config.onCarryStateChange?.(false);
    clearGroup(this.worldGroup);
    clearGroup(this.overlayGroup);
    clearGroup(this.mechanismFlashGroup);
    this.scene.remove(this.overlayGroup);
    this.scene.remove(this.mechanismFlashGroup);
    this.edgeMaterial.dispose();
    this.transmissionMaterial.dispose();
    this.transmissionCoreMaterial.dispose();
    this.transmissionGlowMaterial.dispose();
    this.transmissionNodeMaterial.dispose();
    this.gearMaterial.dispose();
    this.gearSpokeMaterial.dispose();
    this.gearHubMaterial.dispose();
    this.gearAxleMaterial.dispose();
    this.gearEdgeMaterial.dispose();
    this.gearReliefMaterial.dispose();
    this.gearHaloMaterial.dispose();
    this.gearTimingMarkerMaterial.dispose();
    this.gearContactMaterial.dispose();
    this.gearContactActiveMaterial.dispose();
    this.portalDeckMaterial.dispose();
    this.portalFrameMaterial.dispose();
    this.portalHoodMaterial.dispose();
    this.portalAttachmentEdgeMaterial.dispose();
    this.entranceMarkerMaterial.dispose();
    this.exitMarkerMaterial.dispose();
    this.entranceMarkerGlowMaterial.dispose();
    this.exitMarkerGlowMaterial.dispose();
    this.hoverMaterial.dispose();
    this.hoverOutlineMaterial.dispose();
    this.hoverGlowMaterial.dispose();
    this.selectionMaterial.dispose();
    this.selectionOutlineMaterial.dispose();
    this.selectionGlowMaterial.dispose();
    this.gearBindingLineMaterial.dispose();
    this.gearBindingCandidateMaterial.dispose();
    this.gearBindingActiveMaterial.dispose();
    this.gearBindingAmbientCurveMaterial.dispose();
    this.gearBindingAmbientGlowMaterial.dispose();
    this.gearBindingAmbientBoardMaterial.dispose();
    this.gearBindingAmbientOutlineMaterial.dispose();
    this.gearBindingActiveCurveMaterial.dispose();
    this.gearBindingActiveGlowMaterial.dispose();
    this.gearBindingActiveBoardMaterial.dispose();
    this.gearBindingActiveOutlineMaterial.dispose();
    this.gearBindingInvalidMaterial.dispose();
    this.gearBindingInvalidFillMaterial.dispose();
    this.gearBindingInvalidGlowMaterial.dispose();
    this.gearBindingInvalidBoardMaterial.dispose();
    this.gearBindingInvalidOutlineMaterial.dispose();
    this.mechanismObstructionFillMaterial.dispose();
    this.mechanismObstructionOutlineMaterial.dispose();
    this.mechanismObstructionGlowMaterial.dispose();
    this.ghostValidMaterial.dispose();
    this.ghostInvalidMaterial.dispose();
    this.ghostValidOutlineMaterial.dispose();
    this.ghostInvalidOutlineMaterial.dispose();
    this.gearGeometry.dispose();
    this.gearEdgeGeometry.dispose();
    this.gearSpokeGeometry.dispose();
    this.gearHubGeometry.dispose();
    this.gearAxleGeometry.dispose();
    this.gearInnerRingGeometry.dispose();
    this.gearOuterRingGeometry.dispose();
    this.gearHaloGeometry.dispose();
    this.gearTimingMarkerGeometry.dispose();
    this.gearContactMarkerGeometry.dispose();
    this.portalDeckGeometry.dispose();
    this.portalRailGeometry.dispose();
    this.portalLipGeometry.dispose();
    this.portalLaneGeometry.dispose();
    this.portalBeaconGeometry.dispose();
    this.portalHoodGeometry.dispose();
    this.portalHoodEdgeGeometry.dispose();
    this.portalArrowGeometry.dispose();
    this.ghostGeometry.dispose();
    this.gearBindingMarkerGeometry.dispose();
    this.gearSocketMarkerGeometry.dispose();
    this.gearBindingArrowGeometry.dispose();
    this.gearBindingInvalidBadgeRingGeometry.dispose();
    this.gearBindingInvalidBadgeFillGeometry.dispose();
    this.gearBindingInvalidStemGeometry.dispose();
    this.gearBindingInvalidDotGeometry.dispose();
    this.transmissionNodeGeometry.dispose();
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.onStatusChange = null;
  }
}

export const getThreePlacementKeyForCell = (cell = {}) => createCellKey(cell.x, cell.y, cell.z);
