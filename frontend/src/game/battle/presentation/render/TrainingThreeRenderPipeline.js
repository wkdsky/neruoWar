import * as THREE from 'three';
import {
  BUILDING_INSTANCE_STRIDE,
  EFFECT_INSTANCE_STRIDE,
  PROJECTILE_INSTANCE_STRIDE,
  UNIT_INSTANCE_STRIDE
} from '../snapshot/BattleSnapshotSchema';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + ((b - a) * t);
const smoothstep = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - (2 * t));
};
const tempMatrix = new THREE.Matrix4();
const tempQuat = new THREE.Quaternion();
const tempEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const tempScale = new THREE.Vector3();
const tempPos = new THREE.Vector3();
const tempColor = new THREE.Color();
const tempColorB = new THREE.Color();

const TEAM_ATTACKER_COLOR = new THREE.Color(0x4ea9ff);
const TEAM_DEFENDER_COLOR = new THREE.Color(0xff635f);
const TEAM_ATTACKER_DARK = new THREE.Color(0x185a8c);
const TEAM_DEFENDER_DARK = new THREE.Color(0x8b2424);
const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const SELECTED_COLOR = new THREE.Color(0xf6d45b);
const HOVER_COLOR = new THREE.Color(0x87ddff);
const GHOST_COLOR = new THREE.Color(0xb7d7ff);

export const TRAINING_FLAG_HIDE_DISTANCE = 460;
export const TRAINING_FLAG_SHOW_DISTANCE = 760;
export const TRAINING_FLAG_TOP_DOWN_PITCH_DEG = 75;
export const TRAINING_FLAG_OVERVIEW_SCALE_MAX = 1.85;

export const resolveTrainingFlagPresentation = (distance = 0, pitchDeg = 0, overviewZoomProgress = 0) => {
  const zoomProgress = smoothstep(
    (Math.max(0, Number(distance) || 0) - TRAINING_FLAG_HIDE_DISTANCE)
      / (TRAINING_FLAG_SHOW_DISTANCE - TRAINING_FLAG_HIDE_DISTANCE)
  );
  const topDown = Number(pitchDeg) >= TRAINING_FLAG_TOP_DOWN_PITCH_DEG;
  const arrowOpacity = 1 - zoomProgress;
  const uprightOpacity = topDown ? 0 : zoomProgress;
  const topDownOpacity = topDown ? zoomProgress : 0;
  const arrowScale = lerp(1.18, 0.9, zoomProgress);
  const uprightScale = lerp(0.92, 1.26, zoomProgress);
  const overviewScale = lerp(1, TRAINING_FLAG_OVERVIEW_SCALE_MAX, smoothstep(overviewZoomProgress));
  const topDownScale = lerp(1.18, 0.9, zoomProgress) * overviewScale;
  return {
    opacity: uprightOpacity,
    scale: uprightScale,
    groundOpacity: arrowOpacity,
    groundScale: arrowScale,
    arrowOpacity,
    arrowScale,
    uprightOpacity,
    uprightScale,
    topDownOpacity,
    topDownScale
  };
};

const finiteOr = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const resolveFlagStrength = (source = null) => {
  const direct = Math.max(0, finiteOr(source?.remain), finiteOr(source?.startCount));
  const unitCount = Object.values(source?.units || {})
    .reduce((sum, value) => sum + Math.max(0, finiteOr(value)), 0);
  return Math.max(direct, unitCount);
};

const resolveFlagScale = (source = null) => {
  const rect = source?.formationRect || {};
  const formationSpan = Math.max(finiteOr(rect.width), finiteOr(rect.depth));
  const baseRadius = Math.max(
    finiteOr(source?.radius),
    formationSpan * 0.32,
    Math.sqrt(Math.max(1, resolveFlagStrength(source))) * 0.3
  );
  return clamp(Math.max(11, baseRadius * 0.43), 11, 28);
};

const resolveFlagYaw = (source = null, team = TEAM_ATTACKER) => {
  const primaryX = finiteOr(source?.dirX, finiteOr(source?.vx));
  const primaryY = finiteOr(source?.dirY, finiteOr(source?.vy));
  if (Math.hypot(primaryX, primaryY) > 0.1) return Math.atan2(primaryY, primaryX);
  const facing = Number(source?.formationRect?.facingRad);
  if (Number.isFinite(facing)) return facing;
  return team === TEAM_DEFENDER ? Math.PI : 0;
};

const buildFlagAnchor = (source = null, team = TEAM_ATTACKER) => ({
  x: finiteOr(source?.centerX, finiteOr(source?.x)),
  y: finiteOr(source?.centerY, finiteOr(source?.y)),
  yaw: resolveFlagYaw(source, team),
  teamIndex: team === TEAM_DEFENDER ? 1 : 0,
  scale: resolveFlagScale(source)
});

export const resolveTrainingFlagAnchors = (runtime = null) => {
  const phase = runtime?.getPhase?.() || runtime?.phase || 'deploy';
  if (phase === 'battle' || phase === 'ended') {
    return (Array.isArray(runtime?.sim?.squads) ? runtime.sim.squads : [])
      .filter((squad) => (
        squad
        && finiteOr(squad.remain) > 0
        && !(squad.team === TEAM_DEFENDER && squad.hiddenFromAttacker)
      ))
      .map((squad) => buildFlagAnchor(squad, squad.team));
  }

  const anchors = [];
  const appendTeam = (groups, team) => {
    if (team === TEAM_DEFENDER && runtime?.intelVisible === false) return;
    (Array.isArray(groups) ? groups : [])
      .filter((group) => group && group.placed !== false)
      .forEach((group) => anchors.push(buildFlagAnchor(group, team)));
  };
  appendTeam(runtime?.attackerDeployGroups, TEAM_ATTACKER);
  appendTeam(runtime?.defenderDeployGroups, TEAM_DEFENDER);
  return anchors;
};

const disposeObject = (object) => {
  if (!object) return;
  object.traverse?.((child) => {
    if (child.geometry?.dispose) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material) return;
      Object.values(material).forEach((value) => {
        if (value && typeof value === 'object' && typeof value.dispose === 'function') value.dispose();
      });
      material.dispose?.();
    });
  });
};

const clearGroup = (group) => {
  if (!group) return;
  while (group.children.length > 0) {
    const child = group.children.pop();
    disposeObject(child);
  }
};

export const prepareInstanceColorGeometry = (geometry) => {
  const position = geometry?.getAttribute?.('position');
  if (!position || position.count <= 0) return geometry;
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(new Float32Array(position.count * 3).fill(1), 3)
  );
  return geometry;
};

const createUnitGeometry = () => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.46, -0.34);
  shape.lineTo(0.18, -0.34);
  shape.lineTo(0.58, 0);
  shape.lineTo(0.18, 0.34);
  shape.lineTo(-0.46, 0.34);
  shape.lineTo(-0.46, -0.34);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelSize: 0.045,
    bevelThickness: 0.035,
    bevelSegments: 1
  });
  geometry.computeVertexNormals();
  return prepareInstanceColorGeometry(geometry);
};

export const createGroundFlagGeometry = () => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.94, -0.56);
  shape.lineTo(0.94, 0);
  shape.lineTo(-0.94, 0.56);
  shape.lineTo(-0.42, 0);
  shape.lineTo(-0.94, -0.56);
  return prepareInstanceColorGeometry(new THREE.ShapeGeometry(shape));
};

export const createTopDownFlagGeometry = () => prepareInstanceColorGeometry(
  new THREE.PlaneGeometry(1.72, 1.04, 1, 1)
);

const createBandMaterial = (color, roughness = 0.92) => new THREE.MeshStandardMaterial({
  color,
  roughness,
  metalness: 0.02
});

const makeInstancedMesh = (geometry, material, capacity) => {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
};

const getSnapshotCount = (bucket) => Math.max(0, Math.floor(Number(bucket?.count) || 0));

export default class TrainingThreeRenderPipeline {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setClearColor(0x07111d, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.sortObjects = true;
    this.pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.renderer.setPixelRatio(this.pixelRatio);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x07111d, 900, 2800);
    this.camera = new THREE.PerspectiveCamera(48, 1, 1, 8000);
    this.camera.up.set(0, 0, 1);
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;

    this.groundGroup = new THREE.Group();
    this.groundGroup.name = 'training-three-ground';
    this.scene.add(this.groundGroup);

    this.unitGroup = new THREE.Group();
    this.unitGroup.name = 'training-three-units';
    this.scene.add(this.unitGroup);

    this.buildingGroup = new THREE.Group();
    this.buildingGroup.name = 'training-three-buildings';
    this.scene.add(this.buildingGroup);

    this.projectileGroup = new THREE.Group();
    this.projectileGroup.name = 'training-three-projectiles';
    this.scene.add(this.projectileGroup);

    this.effectGroup = new THREE.Group();
    this.effectGroup.name = 'training-three-effects';
    this.scene.add(this.effectGroup);

    this.scene.add(new THREE.AmbientLight(0x8ca4c3, 1.45));
    const keyLight = new THREE.DirectionalLight(0xfff2d2, 2.2);
    keyLight.position.set(-340, -520, 840);
    this.scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x88c7ff, 0.72);
    rimLight.position.set(520, 240, 420);
    this.scene.add(rimLight);

    this.unitGeometry = createUnitGeometry();
    this.unitMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.04
    });
    this.unitMesh = null;
    this.unitCapacity = 0;

    this.selectedRingGeometry = new THREE.RingGeometry(0.72, 1.0, 40);
    this.selectedRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xf8df75,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.selectedRingMesh = null;
    this.selectedRingCapacity = 0;

    this.hoverRingGeometry = new THREE.RingGeometry(0.78, 1.03, 40);
    this.hoverRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x8ee7ff,
      transparent: true,
      opacity: 0.56,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.hoverRingMesh = null;
    this.hoverRingCapacity = 0;

    this.flagGroundGeometry = createGroundFlagGeometry();
    this.flagGroundMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false
    });
    this.flagTopDownGeometry = createTopDownFlagGeometry();
    this.flagTopDownMaterial = this.flagGroundMaterial.clone();
    this.flagPoleGeometry = new THREE.CylinderGeometry(0.055, 0.075, 3.45, 6);
    this.flagPoleGeometry.rotateX(Math.PI / 2);
    this.flagPoleGeometry.translate(0, 0, 1.725);
    this.flagPoleMaterial = new THREE.MeshStandardMaterial({
      color: 0x253447,
      transparent: true,
      opacity: 0,
      roughness: 0.64,
      metalness: 0.14,
      depthWrite: false
    });
    this.flagClothGeometry = prepareInstanceColorGeometry(new THREE.PlaneGeometry(1.72, 1.04, 1, 1));
    this.flagClothGeometry.rotateX(Math.PI / 2);
    this.flagClothGeometry.translate(0.86, 0, 2.72);
    this.flagClothCrossGeometry = this.flagClothGeometry.clone();
    this.flagClothCrossGeometry.rotateZ(Math.PI / 2);
    this.flagClothMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false
    });
    this.flagGroundMesh = null;
    this.flagTopDownMesh = null;
    this.flagPoleMesh = null;
    this.flagClothMesh = null;
    this.flagClothCrossMesh = null;
    this.flagCapacity = 0;
    this.flagGroundVisibility = 1;
    this.flagGroundScale = 1.18;
    this.flagTopDownVisibility = 0;
    this.flagTopDownScale = 1.18;
    this.flagVisibility = 0;
    this.flagScale = 0.92;
    this.flagPresentationUpdatedAt = 0;

    this.buildingGeometry = prepareInstanceColorGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.buildingMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.02
    });
    this.buildingMesh = null;
    this.buildingCapacity = 0;

    this.projectileGeometry = new THREE.SphereGeometry(1, 12, 8);
    this.effectGeometry = new THREE.SphereGeometry(1, 18, 10);
    this.projectileMaterials = {
      attacker: new THREE.MeshBasicMaterial({ color: 0x9dd7ff }),
      defender: new THREE.MeshBasicMaterial({ color: 0xffaaa3 }),
      shell: new THREE.MeshBasicMaterial({ color: 0xffc267 })
    };
    this.effectMaterials = {
      hit: new THREE.MeshBasicMaterial({ color: 0xfff0b5, transparent: true, opacity: 0.62, depthWrite: false }),
      explosion: new THREE.MeshBasicMaterial({ color: 0xff9d42, transparent: true, opacity: 0.5, depthWrite: false }),
      aura: new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.38, depthWrite: false }),
      dust: new THREE.MeshBasicMaterial({ color: 0xc9ab75, transparent: true, opacity: 0.34, depthWrite: false }),
      smoke: new THREE.MeshBasicMaterial({ color: 0xa8b0ba, transparent: true, opacity: 0.26, depthWrite: false })
    };
    this.projectilePool = [];
    this.effectPool = [];
    this.groundKey = '';
    this.gridVisible = true;
  }

  prepareFrame() {
    const canvas = this.canvas;
    if (!canvas) return { width: 0, height: 0 };
    const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.parentElement?.clientWidth || 1));
    const height = Math.max(1, Math.floor(canvas.clientHeight || canvas.parentElement?.clientHeight || 1));
    const needResize = canvas.width !== Math.floor(width * this.pixelRatio)
      || canvas.height !== Math.floor(height * this.pixelRatio);
    if (needResize) {
      this.renderer.setSize(width, height, false);
    }
    return { width: canvas.width, height: canvas.height };
  }

  updateCamera(cameraState) {
    if (!cameraState) return;
    this.camera.projectionMatrix.fromArray(cameraState.projection || []);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.matrixWorldInverse.fromArray(cameraState.viewWorld || cameraState.view || []);
    this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert();
    this.camera.matrix.copy(this.camera.matrixWorld);
    this.camera.position.setFromMatrixPosition(this.camera.matrixWorld);
    this.camera.matrixWorldNeedsUpdate = false;
    if (this.scene.fog) {
      const distance = Math.max(0, Number(cameraState.distance) || 0);
      const overviewProgress = clamp(Number(cameraState.overviewZoomProgress) || 0, 0, 1);
      this.scene.fog.near = lerp(900, 2600, overviewProgress);
      this.scene.fog.far = Math.max(2800, lerp(2800, 7000, overviewProgress), distance * 1.35);
    }
  }

  setGridVisible(visible = true) {
    const nextVisible = visible !== false;
    if (this.gridVisible === nextVisible) return;
    this.gridVisible = nextVisible;
    ['minor-grid', 'major-grid'].forEach((name) => {
      const lines = this.groundGroup.getObjectByName(name);
      if (lines) lines.visible = nextVisible;
    });
  }

  updateGround(runtime) {
    const field = runtime?.getField?.() || {};
    const range = runtime?.getDeployRange?.() || {};
    const width = Math.max(100, Number(field.width) || 2700);
    const height = Math.max(100, Number(field.height) || 1488);
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const attackerMaxX = clamp(Number(range.attackerMaxX) || -10, -halfW, halfW);
    const defenderMinX = clamp(Number(range.defenderMinX) || 10, -halfW, halfW);
    const key = `${Math.round(width)}:${Math.round(height)}:${Math.round(attackerMaxX)}:${Math.round(defenderMinX)}`;
    if (key === this.groundKey) return;
    this.groundKey = key;
    clearGroup(this.groundGroup);

    const addBand = (x1, x2, color, name) => {
      const bandW = Math.max(1, x2 - x1);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(bandW, height, 1, 1),
        createBandMaterial(color)
      );
      mesh.name = name;
      mesh.position.set((x1 + x2) * 0.5, 0, -0.04);
      this.groundGroup.add(mesh);
    };

    addBand(-halfW, attackerMaxX, 0x102b43, 'attacker-deploy-band');
    addBand(attackerMaxX, defenderMinX, 0x2c2a1d, 'center-engagement-band');
    addBand(defenderMinX, halfW, 0x421b1c, 'defender-deploy-band');

    const minorPositions = [];
    const majorPositions = [];
    const pushLine = (bucket, x1, y1, x2, y2, z = 0.05) => {
      bucket.push(x1, y1, z, x2, y2, z);
    };
    for (let x = Math.ceil(-halfW / 28) * 28; x <= halfW; x += 28) {
      const bucket = Math.abs(x % 112) <= 0.001 ? majorPositions : minorPositions;
      pushLine(bucket, x, -halfH, x, halfH);
    }
    for (let y = Math.ceil(-halfH / 28) * 28; y <= halfH; y += 28) {
      const bucket = Math.abs(y % 112) <= 0.001 ? majorPositions : minorPositions;
      pushLine(bucket, -halfW, y, halfW, y);
    }

    const addLines = (positions, color, opacity, name) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false
      });
      const lines = new THREE.LineSegments(geometry, material);
      lines.name = name;
      lines.visible = name === 'minor-grid' || name === 'major-grid' ? this.gridVisible : true;
      this.groundGroup.add(lines);
    };
    addLines(minorPositions, 0x7fa8bd, 0.16, 'minor-grid');
    addLines(majorPositions, 0xd7e8ef, 0.26, 'major-grid');

    const boundaryPositions = [];
    pushLine(boundaryPositions, attackerMaxX, -halfH, attackerMaxX, halfH, 0.08);
    pushLine(boundaryPositions, defenderMinX, -halfH, defenderMinX, halfH, 0.08);
    pushLine(boundaryPositions, -halfW, -halfH, halfW, -halfH, 0.08);
    pushLine(boundaryPositions, halfW, -halfH, halfW, halfH, 0.08);
    pushLine(boundaryPositions, halfW, halfH, -halfW, halfH, 0.08);
    pushLine(boundaryPositions, -halfW, halfH, -halfW, -halfH, 0.08);
    addLines(boundaryPositions, 0xffe08a, 0.62, 'deployment-boundaries');
  }

  ensureUnitCapacity(count) {
    if (count <= this.unitCapacity && this.unitMesh) return;
    const nextCapacity = Math.max(128, Math.ceil(count * 1.35));
    if (this.unitMesh) this.unitGroup.remove(this.unitMesh);
    this.unitMesh = makeInstancedMesh(this.unitGeometry, this.unitMaterial, nextCapacity);
    this.unitGroup.add(this.unitMesh);
    this.unitCapacity = nextCapacity;
  }

  ensureSelectedRingCapacity(count) {
    if (count <= this.selectedRingCapacity && this.selectedRingMesh) return;
    const nextCapacity = Math.max(32, Math.ceil(count * 1.35));
    if (this.selectedRingMesh) this.unitGroup.remove(this.selectedRingMesh);
    this.selectedRingMesh = makeInstancedMesh(this.selectedRingGeometry, this.selectedRingMaterial, nextCapacity);
    this.unitGroup.add(this.selectedRingMesh);
    this.selectedRingCapacity = nextCapacity;
  }

  ensureHoverRingCapacity(count) {
    if (count <= this.hoverRingCapacity && this.hoverRingMesh) return;
    const nextCapacity = Math.max(32, Math.ceil(count * 1.35));
    if (this.hoverRingMesh) this.unitGroup.remove(this.hoverRingMesh);
    this.hoverRingMesh = makeInstancedMesh(this.hoverRingGeometry, this.hoverRingMaterial, nextCapacity);
    this.unitGroup.add(this.hoverRingMesh);
    this.hoverRingCapacity = nextCapacity;
  }

  ensureFlagCapacity(count) {
    if (
      count <= this.flagCapacity
      && this.flagGroundMesh
      && this.flagTopDownMesh
      && this.flagPoleMesh
      && this.flagClothMesh
      && this.flagClothCrossMesh
    ) return;
    const nextCapacity = Math.max(32, Math.ceil(count * 1.35));
    if (this.flagGroundMesh) this.unitGroup.remove(this.flagGroundMesh);
    if (this.flagTopDownMesh) this.unitGroup.remove(this.flagTopDownMesh);
    if (this.flagPoleMesh) this.unitGroup.remove(this.flagPoleMesh);
    if (this.flagClothMesh) this.unitGroup.remove(this.flagClothMesh);
    if (this.flagClothCrossMesh) this.unitGroup.remove(this.flagClothCrossMesh);
    this.flagGroundMesh = makeInstancedMesh(this.flagGroundGeometry, this.flagGroundMaterial, nextCapacity);
    this.flagTopDownMesh = makeInstancedMesh(this.flagTopDownGeometry, this.flagTopDownMaterial, nextCapacity);
    this.flagPoleMesh = makeInstancedMesh(this.flagPoleGeometry, this.flagPoleMaterial, nextCapacity);
    this.flagClothMesh = makeInstancedMesh(this.flagClothGeometry, this.flagClothMaterial, nextCapacity);
    this.flagClothCrossMesh = makeInstancedMesh(this.flagClothCrossGeometry, this.flagClothMaterial, nextCapacity);
    this.flagGroundMesh.renderOrder = 2;
    this.flagTopDownMesh.renderOrder = 2;
    this.flagPoleMesh.renderOrder = 3;
    this.flagClothMesh.renderOrder = 3;
    this.flagClothCrossMesh.renderOrder = 3;
    this.unitGroup.add(
      this.flagGroundMesh,
      this.flagTopDownMesh,
      this.flagPoleMesh,
      this.flagClothMesh,
      this.flagClothCrossMesh
    );
    this.flagCapacity = nextCapacity;
  }

  updateFlagPresentation(cameraState) {
    const target = resolveTrainingFlagPresentation(
      cameraState?.distance,
      cameraState?.pitchDeg,
      cameraState?.overviewZoomProgress
    );
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    const previous = this.flagPresentationUpdatedAt || (now - (1000 / 60));
    const elapsedSec = clamp((now - previous) / 1000, 0, 0.1);
    const blend = 1 - Math.exp(-elapsedSec / 0.18);
    this.flagPresentationUpdatedAt = now;
    this.flagVisibility = lerp(this.flagVisibility, target.opacity, blend);
    this.flagScale = lerp(this.flagScale, target.scale, blend);
    this.flagGroundVisibility = lerp(this.flagGroundVisibility, target.groundOpacity, blend);
    this.flagGroundScale = lerp(this.flagGroundScale, target.groundScale, blend);
    this.flagTopDownVisibility = lerp(this.flagTopDownVisibility, target.topDownOpacity, blend);
    this.flagTopDownScale = lerp(this.flagTopDownScale, target.topDownScale, blend);
    this.flagPoleMaterial.opacity = this.flagVisibility * 0.88;
    this.flagClothMaterial.opacity = this.flagVisibility * 0.96;
    this.flagGroundMaterial.opacity = this.flagGroundVisibility * 0.94;
    this.flagTopDownMaterial.opacity = this.flagTopDownVisibility * 0.94;
    return {
      uprightScale: this.flagScale,
      groundScale: this.flagGroundScale,
      topDownScale: this.flagTopDownScale
    };
  }

  updateUnits(units) {
    const count = getSnapshotCount(units);
    this.ensureUnitCapacity(count);
    const data = units?.data || [];
    let selectedCount = 0;
    let hoveredCount = 0;
    for (let i = 0; i < count; i += 1) {
      const base = i * UNIT_INSTANCE_STRIDE;
      const x = Number(data[base + 0]) || 0;
      const y = Number(data[base + 1]) || 0;
      const z = Number(data[base + 2]) || 0;
      const size = Math.max(2.2, Number(data[base + 3]) || 4);
      const yaw = Number(data[base + 4]) || 0;
      const teamIndex = Number(data[base + 5]) || 0;
      const hpRatio = clamp(Number(data[base + 6]) || 0, 0, 1);
      const tint = Number.isFinite(Number(data[base + 11])) ? Number(data[base + 11]) : 1;
      const selected = Number(data[base + 12]) > 0.5;
      const ghost = Number(data[base + 14]) > 0.5;
      const hovered = Number(data[base + 15]) > 0.5;

      tempPos.set(x, y, z + 0.12);
      tempEuler.set(0, 0, yaw);
      tempQuat.setFromEuler(tempEuler);
      tempScale.set(size * 1.1, size * 0.92, Math.max(2.2, size * 0.46));
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.unitMesh.setMatrixAt(i, tempMatrix);

      tempColor.copy(teamIndex < 0.5 ? TEAM_ATTACKER_DARK : TEAM_DEFENDER_DARK);
      tempColorB.copy(teamIndex < 0.5 ? TEAM_ATTACKER_COLOR : TEAM_DEFENDER_COLOR);
      tempColor.lerp(tempColorB, 0.36 + (hpRatio * 0.58));
      if (hovered) tempColor.lerp(HOVER_COLOR, 0.26);
      if (selected) tempColor.lerp(SELECTED_COLOR, 0.36);
      if (ghost) tempColor.lerp(GHOST_COLOR, 0.52);
      tempColor.multiplyScalar(clamp(tint, 0.52, 1.55));
      this.unitMesh.setColorAt(i, tempColor);

      if (selected) selectedCount += 1;
      if (hovered) hoveredCount += 1;
    }
    this.unitMesh.count = count;
    this.unitMesh.instanceMatrix.needsUpdate = true;
    if (this.unitMesh.instanceColor) this.unitMesh.instanceColor.needsUpdate = true;

    this.ensureSelectedRingCapacity(selectedCount);
    this.ensureHoverRingCapacity(hoveredCount);
    let selectedIndex = 0;
    let hoveredIndex = 0;
    for (let i = 0; i < count; i += 1) {
      const base = i * UNIT_INSTANCE_STRIDE;
      const x = Number(data[base + 0]) || 0;
      const y = Number(data[base + 1]) || 0;
      const z = Number(data[base + 2]) || 0;
      const size = Math.max(2.2, Number(data[base + 3]) || 4);
      const selected = Number(data[base + 12]) > 0.5;
      const hovered = Number(data[base + 15]) > 0.5;
      if (selected) {
        tempPos.set(x, y, z + 0.14);
        tempQuat.identity();
        tempScale.set(size * 1.7, size * 1.7, 1);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        this.selectedRingMesh.setMatrixAt(selectedIndex, tempMatrix);
        selectedIndex += 1;
      }
      if (hovered) {
        tempPos.set(x, y, z + 0.13);
        tempQuat.identity();
        tempScale.set(size * 1.58, size * 1.58, 1);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        this.hoverRingMesh.setMatrixAt(hoveredIndex, tempMatrix);
        hoveredIndex += 1;
      }
    }
    this.selectedRingMesh.count = selectedCount;
    this.selectedRingMesh.instanceMatrix.needsUpdate = true;
    this.hoverRingMesh.count = hoveredCount;
    this.hoverRingMesh.instanceMatrix.needsUpdate = true;
  }

  updateFlags(runtime, presentation = {}) {
    const anchors = resolveTrainingFlagAnchors(runtime);
    const flagCount = anchors.length;
    this.ensureFlagCapacity(flagCount);
    const uprightScale = Math.max(0.1, Number(presentation?.uprightScale) || 0.92);
    const groundScale = Math.max(0.1, Number(presentation?.groundScale) || 1.18);
    const topDownScale = Math.max(0.1, Number(presentation?.topDownScale) || 1.18);
    anchors.forEach((anchor, index) => {
      const markerScale = Math.max(1, Number(anchor.scale) || 11);
      const yaw = Number(anchor.yaw) || 0;
      tempEuler.set(0, 0, yaw);
      tempQuat.setFromEuler(tempEuler);

      tempPos.set(anchor.x, anchor.y, 0.18);
      tempScale.setScalar(markerScale * uprightScale);
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.flagPoleMesh.setMatrixAt(index, tempMatrix);
      this.flagClothMesh.setMatrixAt(index, tempMatrix);
      this.flagClothCrossMesh.setMatrixAt(index, tempMatrix);

      tempPos.set(anchor.x, anchor.y, Math.max(3.6, markerScale * 0.32));
      tempScale.setScalar(markerScale * groundScale);
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.flagGroundMesh.setMatrixAt(index, tempMatrix);

      tempScale.setScalar(markerScale * topDownScale);
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.flagTopDownMesh.setMatrixAt(index, tempMatrix);

      tempColor.copy(anchor.teamIndex < 0.5 ? TEAM_ATTACKER_COLOR : TEAM_DEFENDER_COLOR);
      this.flagGroundMesh.setColorAt(index, tempColor);
      this.flagTopDownMesh.setColorAt(index, tempColor);
      this.flagClothMesh.setColorAt(index, tempColor);
      this.flagClothCrossMesh.setColorAt(index, tempColor);
    });

    const groundVisible = flagCount > 0 && this.flagGroundVisibility > 0.01;
    const topDownVisible = flagCount > 0 && this.flagTopDownVisibility > 0.01;
    const uprightVisible = flagCount > 0 && this.flagVisibility > 0.01;
    this.flagGroundMesh.visible = groundVisible;
    this.flagTopDownMesh.visible = topDownVisible;
    this.flagPoleMesh.visible = uprightVisible;
    this.flagClothMesh.visible = uprightVisible;
    this.flagClothCrossMesh.visible = uprightVisible;
    this.flagGroundMesh.count = flagCount;
    this.flagTopDownMesh.count = flagCount;
    this.flagPoleMesh.count = flagCount;
    this.flagClothMesh.count = flagCount;
    this.flagClothCrossMesh.count = flagCount;
    this.flagGroundMesh.instanceMatrix.needsUpdate = true;
    this.flagTopDownMesh.instanceMatrix.needsUpdate = true;
    this.flagPoleMesh.instanceMatrix.needsUpdate = true;
    this.flagClothMesh.instanceMatrix.needsUpdate = true;
    this.flagClothCrossMesh.instanceMatrix.needsUpdate = true;
    if (this.flagGroundMesh.instanceColor) this.flagGroundMesh.instanceColor.needsUpdate = true;
    if (this.flagTopDownMesh.instanceColor) this.flagTopDownMesh.instanceColor.needsUpdate = true;
    if (this.flagClothMesh.instanceColor) this.flagClothMesh.instanceColor.needsUpdate = true;
    if (this.flagClothCrossMesh.instanceColor) this.flagClothCrossMesh.instanceColor.needsUpdate = true;
  }

  ensureBuildingCapacity(count) {
    if (count <= this.buildingCapacity && this.buildingMesh) return;
    const nextCapacity = Math.max(64, Math.ceil(count * 1.35));
    if (this.buildingMesh) this.buildingGroup.remove(this.buildingMesh);
    this.buildingMesh = makeInstancedMesh(this.buildingGeometry, this.buildingMaterial, nextCapacity);
    this.buildingGroup.add(this.buildingMesh);
    this.buildingCapacity = nextCapacity;
  }

  updateBuildings(buildings) {
    const count = getSnapshotCount(buildings);
    this.ensureBuildingCapacity(count);
    const data = buildings?.data || [];
    for (let i = 0; i < count; i += 1) {
      const base = i * BUILDING_INSTANCE_STRIDE;
      const x = Number(data[base + 0]) || 0;
      const y = Number(data[base + 1]) || 0;
      const z = Number(data[base + 2]) || 0;
      const yaw = Number(data[base + 3]) || 0;
      const width = Math.max(1, Number(data[base + 4]) || 1);
      const depth = Math.max(1, Number(data[base + 5]) || 1);
      const height = Math.max(1, Number(data[base + 6]) || 1);
      const hpRatio = clamp(Number(data[base + 7]) || 0, 0, 1);
      const destroyed = Number(data[base + 8]) > 0.5;
      const foliageOpacity = clamp(Number(data[base + 15]) || 0, 0, 1);

      tempPos.set(x, y, z + (height * 0.5));
      tempEuler.set(0, 0, yaw);
      tempQuat.setFromEuler(tempEuler);
      tempScale.set(width, depth, destroyed ? 0.001 : height);
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.buildingMesh.setMatrixAt(i, tempMatrix);

      if (foliageOpacity > 0.001) {
        tempColor.setRGB(
          lerp(0.16, 0.28, hpRatio),
          lerp(0.35, 0.62, hpRatio),
          lerp(0.19, 0.28, hpRatio)
        );
      } else {
        const tr = Number(data[base + 9]) || 0.52;
        const tg = Number(data[base + 10]) || 0.58;
        const tb = Number(data[base + 11]) || 0.66;
        const sr = Number(data[base + 12]) || 0.38;
        const sg = Number(data[base + 13]) || 0.44;
        const sb = Number(data[base + 14]) || 0.52;
        tempColor.setRGB(
          lerp(sr, tr, 0.42) * lerp(0.42, 1, hpRatio),
          lerp(sg, tg, 0.42) * lerp(0.42, 1, hpRatio),
          lerp(sb, tb, 0.42) * lerp(0.42, 1, hpRatio)
        );
      }
      this.buildingMesh.setColorAt(i, tempColor);
    }
    this.buildingMesh.count = count;
    this.buildingMesh.instanceMatrix.needsUpdate = true;
    if (this.buildingMesh.instanceColor) this.buildingMesh.instanceColor.needsUpdate = true;
  }

  ensureProjectilePool(count) {
    while (this.projectilePool.length < count) {
      const mesh = new THREE.Mesh(this.projectileGeometry, this.projectileMaterials.attacker);
      mesh.frustumCulled = false;
      this.projectilePool.push(mesh);
      this.projectileGroup.add(mesh);
    }
  }

  updateProjectiles(projectiles) {
    const count = getSnapshotCount(projectiles);
    this.ensureProjectilePool(count);
    const data = projectiles?.data || [];
    for (let i = 0; i < this.projectilePool.length; i += 1) {
      const mesh = this.projectilePool[i];
      const visible = i < count;
      mesh.visible = visible;
      if (!visible) continue;
      const base = i * PROJECTILE_INSTANCE_STRIDE;
      const teamIndex = Number(data[base + 4]) || 0;
      const typeIndex = Number(data[base + 5]) || 0;
      const radius = Math.max(0.8, Number(data[base + 3]) || 2.2);
      mesh.material = typeIndex >= 0.5
        ? this.projectileMaterials.shell
        : (teamIndex < 0.5 ? this.projectileMaterials.attacker : this.projectileMaterials.defender);
      mesh.position.set(Number(data[base + 0]) || 0, Number(data[base + 1]) || 0, (Number(data[base + 2]) || 0) + radius);
      mesh.scale.setScalar(radius);
    }
  }

  ensureEffectPool(count) {
    while (this.effectPool.length < count) {
      const mesh = new THREE.Mesh(this.effectGeometry, this.effectMaterials.hit);
      mesh.frustumCulled = false;
      this.effectPool.push(mesh);
      this.effectGroup.add(mesh);
    }
  }

  updateEffects(effects) {
    const count = getSnapshotCount(effects);
    this.ensureEffectPool(count);
    const data = effects?.data || [];
    for (let i = 0; i < this.effectPool.length; i += 1) {
      const mesh = this.effectPool[i];
      const visible = i < count;
      mesh.visible = visible;
      if (!visible) continue;
      const base = i * EFFECT_INSTANCE_STRIDE;
      const typeIndex = Math.round(Number(data[base + 5]) || 0);
      const life01 = clamp(Number(data[base + 6]) || 0, 0, 1);
      const radius = Math.max(0.6, Number(data[base + 3]) || 2.2) * lerp(1.22, 0.62, life01);
      if (typeIndex === 1) mesh.material = this.effectMaterials.explosion;
      else if (typeIndex === 2) mesh.material = this.effectMaterials.aura;
      else if (typeIndex === 3) mesh.material = this.effectMaterials.dust;
      else if (typeIndex === 4) mesh.material = this.effectMaterials.smoke;
      else mesh.material = this.effectMaterials.hit;
      mesh.position.set(Number(data[base + 0]) || 0, Number(data[base + 1]) || 0, (Number(data[base + 2]) || 0) + radius * 0.42);
      mesh.scale.setScalar(radius);
    }
  }

  render({ cameraState, snapshot, runtime }) {
    if (!cameraState || !snapshot) return;
    this.updateCamera(cameraState);
    const flagPresentation = this.updateFlagPresentation(cameraState);
    this.updateGround(runtime);
    this.updateBuildings(snapshot.buildings);
    this.updateUnits(snapshot.units);
    this.updateFlags(runtime, flagPresentation);
    this.updateProjectiles(snapshot.projectiles);
    this.updateEffects(snapshot.effects);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    disposeObject(this.scene);
    this.renderer.dispose();
    this.unitMesh = null;
    this.selectedRingMesh = null;
    this.hoverRingMesh = null;
    this.flagGroundMesh = null;
    this.flagTopDownMesh = null;
    this.flagPoleMesh = null;
    this.flagClothMesh = null;
    this.flagClothCrossMesh = null;
    this.buildingMesh = null;
    this.projectilePool = [];
    this.effectPool = [];
  }
}
