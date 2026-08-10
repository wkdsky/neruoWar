import * as THREE from 'three';
import {
  BUILDING_INSTANCE_STRIDE,
  EFFECT_INSTANCE_STRIDE,
  PROJECTILE_INSTANCE_STRIDE,
  UNIT_INSTANCE_STRIDE
} from '../snapshot/BattleSnapshotSchema';
import {
  resolveTrainingDirectionArcLayout,
  sampleTrainingDirectionArc
} from '../../shared/trainingDirectionArc';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + ((b - a) * t);
const tempMatrix = new THREE.Matrix4();
const tempQuat = new THREE.Quaternion();
const tempEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const tempScale = new THREE.Vector3();
const tempPos = new THREE.Vector3();
const tempColor = new THREE.Color();
const tempColorB = new THREE.Color();
const tempWorldFlagAnchor = new THREE.Vector3();
const tempWorldFlagCameraForward = new THREE.Vector3();
const tempWorldFlagCameraUp = new THREE.Vector3();
const tempWorldFlagViewSize = new THREE.Vector2();

const TEAM_ATTACKER_COLOR = new THREE.Color(0x4ea9ff);
const TEAM_DEFENDER_COLOR = new THREE.Color(0xff635f);
const TEAM_ATTACKER_DARK = new THREE.Color(0x185a8c);
const TEAM_DEFENDER_DARK = new THREE.Color(0x8b2424);
const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const SELECTED_COLOR = new THREE.Color(0xf6d45b);
const HOVER_COLOR = new THREE.Color(0x87ddff);
const GHOST_COLOR = new THREE.Color(0xb7d7ff);

export const TRAINING_WORLD_FLAG_MAX_PITCH_DEG = 50;
export const TRAINING_WORLD_FLAG_TARGET_SCREEN_HEIGHT = 76;
export const TRAINING_WORLD_FLAG_MIN_SCREEN_SCALE = 0.85;
export const TRAINING_WORLD_FLAG_MAX_SCREEN_SCALE = 8;
export const TRAINING_DIRECTION_ARC_GROUND_ELEVATION = 0.1;

export const resolveTrainingFlagLod = (pitchDeg = 90) => {
  const normalizedPitch = Number.isFinite(Number(pitchDeg)) ? Number(pitchDeg) : 90;
  const worldFlag = normalizedPitch <= TRAINING_WORLD_FLAG_MAX_PITCH_DEG;
  return {
    worldFlag,
    infoLabel: !worldFlag
  };
};

const finiteOr = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const resolveTrainingWorldFlagScreenScale = ({
  clothHeight = 1,
  viewHeight = 0,
  viewportHeight = 0,
  verticalScreenFactor = 1
} = {}) => {
  const safeClothHeight = Math.max(1, finiteOr(clothHeight, 1));
  const safeViewHeight = Math.max(1e-4, finiteOr(viewHeight));
  const safeViewportHeight = Math.max(1, finiteOr(viewportHeight));
  const safeVerticalScreenFactor = clamp(Math.abs(finiteOr(verticalScreenFactor, 1)), 0.35, 1);
  const targetWorldHeight = (
    safeViewHeight
    * (TRAINING_WORLD_FLAG_TARGET_SCREEN_HEIGHT / safeViewportHeight)
  ) / safeVerticalScreenFactor;
  return clamp(
    targetWorldHeight / safeClothHeight,
    TRAINING_WORLD_FLAG_MIN_SCREEN_SCALE,
    TRAINING_WORLD_FLAG_MAX_SCREEN_SCALE
  );
};

const resolveMarkerStrength = (source = null) => {
  const direct = Math.max(0, finiteOr(source?.remain), finiteOr(source?.startCount));
  const unitCount = Object.values(source?.units || {})
    .reduce((sum, value) => sum + Math.max(0, finiteOr(value)), 0);
  return Math.max(direct, unitCount);
};

export const resolveTrainingWorldFlagDimensions = (source = null) => {
  const count = Math.max(1, resolveMarkerStrength(source));
  const radius = Math.max(0, finiteOr(source?.radius));
  const clothHeight = clamp(
    Math.max(17, radius * 0.16, Math.sqrt(count) * 0.33),
    17,
    25
  );
  const clothWidth = clamp(
    Math.max(36, clothHeight * 2.08, radius * 0.28, Math.sqrt(count) * 0.28),
    36,
    54
  );
  const clothBottom = 2.2;
  const poleHeight = clothBottom + clothHeight + 1.05;
  return {
    poleHeight,
    clothHeight,
    clothWidth,
    clothBottom
  };
};

export const resolveTrainingInfoLabelElevation = (source = null) => {
  const count = Math.max(1, resolveMarkerStrength(source));
  const radius = Math.max(0, finiteOr(source?.radius));
  return clamp(Math.max(6, radius * 0.1, 4 + (Math.sqrt(count) * 0.1)), 6, 14);
};

const buildDirectionArcAnchor = (
  source = null,
  team = TEAM_ATTACKER,
  skillPoints = 0,
  hoveredDirectionArcId = '',
  preferFormationFacing = false,
  selectedId = ''
) => {
  const startCount = Math.max(1, Math.floor(finiteOr(source?.startCount, resolveMarkerStrength(source))));
  const remain = Math.max(0, Math.floor(finiteOr(source?.remain, startCount)));
  const arcLayout = resolveTrainingDirectionArcLayout(source, team, { preferFormationFacing });
  return {
    x: finiteOr(source?.centerX, finiteOr(source?.x)),
    y: finiteOr(source?.centerY, finiteOr(source?.y)),
    yaw: arcLayout.directionYaw,
    teamIndex: team === TEAM_DEFENDER ? 1 : 0,
    team,
    name: String(source?.name || '部队'),
    remain,
    startCount,
    ratio: clamp(remain / startCount, 0, 1),
    skillPoints: Math.max(0, Math.floor(Number(skillPoints) || 0)),
    selected: !!source?.selected || String(source?.id || '') === String(selectedId || ''),
    hovered: String(source?.id || '') === String(hoveredDirectionArcId || ''),
    ...resolveTrainingWorldFlagDimensions(source),
    arcLayout
  };
};

export const resolveTrainingDirectionArcAnchors = (runtime = null) => {
  const phase = runtime?.getPhase?.() || runtime?.phase || 'deploy';
  const skillPoints = runtime?.getTrainingState?.()?.points || 0;
  const hoveredDirectionArcId = runtime?.hoveredDeployDirectionArcId || '';
  if (phase === 'battle' || phase === 'ended') {
    return (Array.isArray(runtime?.sim?.squads) ? runtime.sim.squads : [])
      .filter((squad) => (
        squad
        && finiteOr(squad.remain) > 0
        && !(squad.team === TEAM_DEFENDER && squad.hiddenFromAttacker)
      ))
      .map((squad) => buildDirectionArcAnchor(
        squad,
        squad.team,
        skillPoints,
        hoveredDirectionArcId,
        false,
        runtime?.selectedBattleSquadId || ''
      ));
  }

  const anchors = [];
  const selectedDeployGroupId = runtime?.selectedDeploySquadId || '';
  const appendTeam = (groups, team) => {
    if (team === TEAM_DEFENDER && runtime?.intelVisible === false) return;
    (Array.isArray(groups) ? groups : [])
      .filter((group) => group && group.placed !== false)
      .forEach((group) => anchors.push(buildDirectionArcAnchor(
        group,
        team,
        skillPoints,
        hoveredDirectionArcId,
        true,
        selectedDeployGroupId
      )));
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

export const updateTrainingDirectionArcGeometry = (geometry, anchors = []) => {
  if (!geometry) return geometry;
  const positions = [];
  const colors = [];
  (Array.isArray(anchors) ? anchors : []).forEach((anchor) => {
    const samples = sampleTrainingDirectionArc(anchor?.arcLayout);
    const color = Array.isArray(anchor?.color) ? anchor.color : [1, 1, 1];
    for (let index = 1; index < samples.length; index += 1) {
      const prev = samples[index - 1];
      const next = samples[index];
      [
        prev.sideA,
        prev.sideB,
        next.sideA,
        next.sideA,
        prev.sideB,
        next.sideB
      ].forEach((point) => {
        positions.push(point.x, point.y, TRAINING_DIRECTION_ARC_GROUND_ELEVATION);
        colors.push(color[0], color[1], color[2]);
      });
    }
  });
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
};

export const createTrainingDirectionArcGeometry = (anchors = null) => {
  const geometry = new THREE.BufferGeometry();
  const source = Array.isArray(anchors)
    ? anchors
    : [{
      arcLayout: resolveTrainingDirectionArcLayout({
        formationRect: { width: 60, depth: 18, facingRad: 0, directionOffsetRad: 0 }
      }, TEAM_ATTACKER),
      color: [1, 1, 1]
    }];
  return updateTrainingDirectionArcGeometry(geometry, source);
};

export const createTrainingDirectionArcMaterial = () => new THREE.MeshBasicMaterial({
  color: 0xffffff,
  vertexColors: true,
  transparent: true,
  opacity: 0.94,
  side: THREE.DoubleSide,
  depthTest: true,
  depthWrite: false,
  fog: false
});

export const createTrainingFlagClothGeometry = () => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(1, 0);
  shape.lineTo(0.82, 0.5);
  shape.lineTo(1, 1);
  shape.lineTo(0, 1);
  shape.lineTo(0, 0);
  const geometry = prepareInstanceColorGeometry(new THREE.ShapeGeometry(shape));
  geometry.rotateX(Math.PI / 2);
  return geometry;
};

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

const TRAINING_FLAG_CANVAS_WIDTH = 512;
const TRAINING_FLAG_CANVAS_HEIGHT = 232;
const TRAINING_FLAG_CANVAS_TOP_INSET = 34;
const TRAINING_FLAG_CANVAS_BOTTOM_INSET = 86;

const TRAINING_FLAG_CANVAS_THEME = {
  attacker: {
    accent: '#7dd3fc',
    soft: 'rgba(14, 116, 144, 0.82)'
  },
  defender: {
    accent: '#fda4af',
    soft: 'rgba(153, 27, 27, 0.84)'
  }
};

const createTrainingFlagCanvas = () => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = TRAINING_FLAG_CANVAS_WIDTH;
  canvas.height = TRAINING_FLAG_CANVAS_HEIGHT;
  return canvas;
};

const traceTrainingFlagSilhouette = (context, width, height) => {
  const horizontalInset = 12;
  const notch = 62;
  context.beginPath();
  context.moveTo(horizontalInset, TRAINING_FLAG_CANVAS_TOP_INSET);
  context.lineTo(width - horizontalInset, TRAINING_FLAG_CANVAS_TOP_INSET);
  context.lineTo(width - notch, height * 0.5);
  context.lineTo(width - horizontalInset, height - TRAINING_FLAG_CANVAS_BOTTOM_INSET);
  context.lineTo(horizontalInset, height - TRAINING_FLAG_CANVAS_BOTTOM_INSET);
  context.closePath();
};

const drawTrainingFlagCanvas = (canvas, anchor = {}) => {
  const context = canvas?.getContext?.('2d');
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  const theme = TRAINING_FLAG_CANVAS_THEME[anchor.team] || TRAINING_FLAG_CANVAS_THEME.attacker;
  context.clearRect(0, 0, width, height);
  context.save();
  context.shadowColor = 'rgba(2, 6, 23, 0.72)';
  context.shadowBlur = 10;
  context.shadowOffsetY = 4;
  traceTrainingFlagSilhouette(context, width, height);
  const background = context.createLinearGradient(0, 0, width, 0);
  background.addColorStop(0, theme.soft);
  background.addColorStop(0.36, 'rgba(5, 12, 21, 0.96)');
  background.addColorStop(1, 'rgba(5, 12, 21, 0.88)');
  context.fillStyle = background;
  context.fill();
  context.restore();

  context.save();
  traceTrainingFlagSilhouette(context, width, height);
  context.strokeStyle = anchor.selected ? '#fde68a' : theme.accent;
  context.lineWidth = 4;
  context.globalAlpha = 0.88;
  context.stroke();
  context.restore();

  context.fillStyle = theme.accent;
  context.globalAlpha = 0.78;
  context.fillRect(
    16,
    TRAINING_FLAG_CANVAS_TOP_INSET + 4,
    10,
    height - TRAINING_FLAG_CANVAS_TOP_INSET - TRAINING_FLAG_CANVAS_BOTTOM_INSET - 8
  );
  context.globalAlpha = 1;
  context.textBaseline = 'middle';
  context.font = '800 28px "JetBrains Mono", ui-monospace, monospace';
  context.fillStyle = '#cbd5e1';
  context.fillText('兵', 44, 67);
  context.font = '900 43px "JetBrains Mono", ui-monospace, monospace';
  context.fillStyle = '#f8fafc';
  const remainText = String(Math.max(0, Math.floor(Number(anchor.remain) || 0)));
  context.fillText(remainText, 82, 67);
  const remainWidth = context.measureText(remainText).width;
  context.font = '700 24px "JetBrains Mono", ui-monospace, monospace';
  context.fillStyle = '#94a3b8';
  const startText = `/${Math.max(1, Math.floor(Number(anchor.startCount) || 1))}`;
  const startX = 88 + remainWidth;
  context.fillText(startText, startX, 67);
  const startWidth = context.measureText(startText).width;

  const pointSeparatorX = Math.min(width - 132, startX + startWidth + 22);
  context.strokeStyle = 'rgba(226, 232, 240, 0.28)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(pointSeparatorX, 34);
  context.lineTo(pointSeparatorX, 96);
  context.stroke();
  context.font = '800 27px "JetBrains Mono", ui-monospace, monospace';
  context.fillStyle = '#cbd5e1';
  context.fillText('点', pointSeparatorX + 18, 67);
  context.font = '900 39px "JetBrains Mono", ui-monospace, monospace';
  context.fillStyle = '#fde68a';
  context.fillText(String(Math.max(0, Math.floor(Number(anchor.skillPoints) || 0))), pointSeparatorX + 55, 67);

  const barX = 44;
  const barY = 116;
  const barWidth = width - barX - 84;
  const barHeight = 24;
  context.fillStyle = 'rgba(2, 6, 23, 0.84)';
  context.fillRect(barX, barY, barWidth, barHeight);
  context.fillStyle = Number(anchor.ratio) <= 0.25 ? '#fb7185' : (Number(anchor.ratio) <= 0.5 ? '#fbbf24' : '#4ade80');
  const healthWidth = (barWidth - 6) * clamp(Number(anchor.ratio) || 0, 0, 1);
  if (healthWidth > 0) context.fillRect(barX + 3, barY + 3, healthWidth, barHeight - 6);
  context.strokeStyle = 'rgba(226, 232, 240, 0.38)';
  context.lineWidth = 2;
  context.strokeRect(barX, barY, barWidth, barHeight);
};

const trainingFlagTextureSignature = (anchor = {}) => [
  anchor.team,
  anchor.remain,
  anchor.startCount,
  Number(anchor.ratio || 0).toFixed(3),
  anchor.skillPoints,
  anchor.selected ? 'selected' : 'normal'
].join(':');

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
    this.viewportCssHeight = 1;

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

    this.directionArcGeometry = createTrainingDirectionArcGeometry([]);
    this.directionArcMaterial = createTrainingDirectionArcMaterial();
    this.worldFlagPoleGeometry = new THREE.CylinderGeometry(0.32, 0.42, 1, 10);
    this.worldFlagPoleGeometry.rotateX(Math.PI / 2);
    this.worldFlagPoleGeometry.translate(0, 0, 0.5);
    this.worldFlagPoleMaterial = new THREE.MeshStandardMaterial({
      color: 0xb8c7d9,
      roughness: 0.3,
      metalness: 0.68
    });
    this.worldFlagClothGeometry = createTrainingFlagClothGeometry();
    this.worldFlagFinialGeometry = new THREE.SphereGeometry(1, 12, 8);
    this.worldFlagFinialMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5d481,
      roughness: 0.26,
      metalness: 0.72
    });
    this.directionArcMesh = new THREE.Mesh(this.directionArcGeometry, this.directionArcMaterial);
    this.directionArcMesh.frustumCulled = false;
    this.directionArcMesh.renderOrder = 3;
    this.unitGroup.add(this.directionArcMesh);
    this.worldFlagPoleMesh = null;
    this.worldFlagFinialMesh = null;
    this.worldFlagClothPool = [];
    this.directionMarkerCapacity = 0;

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
    this.viewportCssHeight = height;
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

  ensureDirectionMarkerCapacity(count) {
    if (
      count <= this.directionMarkerCapacity
      && this.worldFlagPoleMesh
      && this.worldFlagFinialMesh
    ) {
      this.ensureWorldFlagClothPool(count);
      return;
    }
    const nextCapacity = Math.max(32, Math.ceil(count * 1.35));
    if (this.worldFlagPoleMesh) this.unitGroup.remove(this.worldFlagPoleMesh);
    if (this.worldFlagFinialMesh) this.unitGroup.remove(this.worldFlagFinialMesh);
    this.worldFlagPoleMesh = makeInstancedMesh(this.worldFlagPoleGeometry, this.worldFlagPoleMaterial, nextCapacity);
    this.worldFlagFinialMesh = makeInstancedMesh(this.worldFlagFinialGeometry, this.worldFlagFinialMaterial, nextCapacity);
    this.worldFlagPoleMesh.renderOrder = 2;
    this.worldFlagFinialMesh.renderOrder = 4;
    this.unitGroup.add(
      this.worldFlagPoleMesh,
      this.worldFlagFinialMesh
    );
    this.directionMarkerCapacity = nextCapacity;
    this.ensureWorldFlagClothPool(nextCapacity);
  }

  ensureWorldFlagClothPool(count) {
    while (this.worldFlagClothPool.length < count) {
      const canvas = createTrainingFlagCanvas();
      const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
      }
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.04,
        roughness: 0.76,
        metalness: 0.02
      });
      const mesh = new THREE.Mesh(this.worldFlagClothGeometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.unitGroup.add(mesh);
      this.worldFlagClothPool.push({ canvas, texture, material, mesh, signature: '' });
    }
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

  updateDirectionMarkers(runtime, cameraState = {}) {
    const anchors = resolveTrainingDirectionArcAnchors(runtime);
    const markerCount = anchors.length;
    this.ensureDirectionMarkerCapacity(markerCount);
    const arcAnchors = anchors.map((anchor) => {
      tempColor.copy(anchor.teamIndex < 0.5 ? TEAM_ATTACKER_COLOR : TEAM_DEFENDER_COLOR);
      if (anchor.selected) tempColor.lerp(SELECTED_COLOR, 0.4);
      if (anchor.hovered) tempColor.lerp(HOVER_COLOR, 0.72);
      return {
        ...anchor,
        color: [tempColor.r, tempColor.g, tempColor.b]
      };
    });
    updateTrainingDirectionArcGeometry(this.directionArcGeometry, arcAnchors);
    const flagLod = resolveTrainingFlagLod(cameraState?.pitchDeg);
    const viewportHeight = Math.max(
      1,
      finiteOr(this.viewportCssHeight, finiteOr(this.canvas?.clientHeight, 1))
    );
    tempWorldFlagCameraForward.set(0, 0, -1).transformDirection(this.camera.matrixWorld);
    tempWorldFlagCameraUp.set(0, 1, 0).transformDirection(this.camera.matrixWorld);
    const verticalScreenFactor = clamp(Math.abs(tempWorldFlagCameraUp.z), 0.35, 1);
    anchors.forEach((anchor, index) => {
      const clothBottom = Math.max(1.2, Number(anchor.clothBottom) || 2.2);
      const clothHeight = Math.max(1, Number(anchor.clothHeight) || 4);
      const clothWidth = Math.max(1, Number(anchor.clothWidth) || 5);
      const poleHeight = Math.max(clothBottom + 1, Number(anchor.poleHeight) || 10);
      const poleHeadroom = Math.max(0.7, poleHeight - clothBottom - clothHeight);
      tempWorldFlagAnchor.set(anchor.x, anchor.y, clothBottom).sub(this.camera.position);
      const cameraDepth = Math.max(1, tempWorldFlagAnchor.dot(tempWorldFlagCameraForward));
      this.camera.getViewSize(cameraDepth, tempWorldFlagViewSize);
      const worldFlagScale = resolveTrainingWorldFlagScreenScale({
        clothHeight,
        viewHeight: tempWorldFlagViewSize.y,
        viewportHeight,
        verticalScreenFactor
      });
      const scaledPoleHeight = clothBottom + ((clothHeight + poleHeadroom) * worldFlagScale);
      tempPos.set(anchor.x, anchor.y, -0.35);
      tempQuat.identity();
      tempScale.set(
        worldFlagScale,
        worldFlagScale,
        scaledPoleHeight + (0.35 * worldFlagScale)
      );
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.worldFlagPoleMesh.setMatrixAt(index, tempMatrix);

      const cameraYaw = Math.atan2(
        this.camera.position.y - anchor.y,
        this.camera.position.x - anchor.x
      );
      tempEuler.set(0, 0, cameraYaw + (Math.PI / 2));
      tempQuat.setFromEuler(tempEuler);
      tempPos.set(anchor.x, anchor.y, clothBottom);
      tempScale.set(
        clothWidth * worldFlagScale,
        1,
        clothHeight * worldFlagScale
      );
      const clothEntry = this.worldFlagClothPool[index];
      if (clothEntry) {
        clothEntry.mesh.position.copy(tempPos);
        clothEntry.mesh.quaternion.copy(tempQuat);
        clothEntry.mesh.scale.copy(tempScale);
        clothEntry.mesh.visible = markerCount > 0 && flagLod.worldFlag;
        const textureSignature = trainingFlagTextureSignature(anchor);
        if (textureSignature !== clothEntry.signature) {
          drawTrainingFlagCanvas(clothEntry.canvas, anchor);
          if (clothEntry.texture) clothEntry.texture.needsUpdate = true;
          clothEntry.signature = textureSignature;
        }
      }

      tempPos.set(anchor.x, anchor.y, scaledPoleHeight + (0.4 * worldFlagScale));
      tempQuat.identity();
      tempScale.setScalar(0.64 * worldFlagScale);
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.worldFlagFinialMesh.setMatrixAt(index, tempMatrix);

      tempColor.copy(anchor.teamIndex < 0.5 ? TEAM_ATTACKER_COLOR : TEAM_DEFENDER_COLOR);
      if (anchor.selected) tempColor.lerp(SELECTED_COLOR, 0.4);
    });

    this.directionArcMesh.visible = markerCount > 0;
    this.worldFlagPoleMesh.visible = markerCount > 0 && flagLod.worldFlag;
    this.worldFlagFinialMesh.visible = markerCount > 0 && flagLod.worldFlag;
    this.worldFlagPoleMesh.count = markerCount;
    this.worldFlagFinialMesh.count = markerCount;
    this.worldFlagPoleMesh.instanceMatrix.needsUpdate = true;
    this.worldFlagFinialMesh.instanceMatrix.needsUpdate = true;
    for (let index = markerCount; index < this.worldFlagClothPool.length; index += 1) {
      this.worldFlagClothPool[index].mesh.visible = false;
    }
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
    this.updateGround(runtime);
    this.updateBuildings(snapshot.buildings);
    this.updateUnits(snapshot.units);
    this.updateDirectionMarkers(runtime, cameraState);
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
    this.directionArcMesh = null;
    this.worldFlagPoleMesh = null;
    this.worldFlagFinialMesh = null;
    this.worldFlagClothPool.forEach((entry) => {
      entry.texture?.dispose?.();
      entry.material?.dispose?.();
    });
    this.worldFlagClothPool = [];
    this.buildingMesh = null;
    this.projectilePool = [];
    this.effectPool = [];
  }
}
