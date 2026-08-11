import * as THREE from 'three';
import {
  resolveTrainingUnitVisualSize
} from '../../shared/trainingUnitSelection';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + ((b - a) * t);
const tempMatrix = new THREE.Matrix4();
const tempQuat = new THREE.Quaternion();
const tempEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const tempPos = new THREE.Vector3();
const tempScale = new THREE.Vector3();
const tempColor = new THREE.Color();
const tempAccent = new THREE.Color();

const TEAM_COLORS = [
  new THREE.Color(0x1677d2),
  new THREE.Color(0xde424b)
];
const SELECTED_COLOR = new THREE.Color(0xf4c542);
const GHOST_COLOR = new THREE.Color(0x80b9e8);
const HOVER_COLOR = new THREE.Color(0x9deaff);
const HEAD_HIGHLIGHT = new THREE.Color(0xd7efff);
const FACE_COLOR = new THREE.Color(0x172033);
const EYE_COLOR = new THREE.Color(0xe9f5ff);

const STYLE_ACCENTS = [
  new THREE.Color(0xe6a436),
  new THREE.Color(0x709fd1),
  new THREE.Color(0xd1d9ec),
  new THREE.Color(0x35c8e5),
  new THREE.Color(0x668aa5),
  new THREE.Color(0xf0b642),
  new THREE.Color(0x4fcf80),
  new THREE.Color(0xb48cff),
  new THREE.Color(0xed73be)
];

const prepareInstanceColorGeometry = (geometry) => {
  const position = geometry?.getAttribute?.('position');
  if (!position || position.count <= 0 || geometry.getAttribute('color')) return geometry;
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(new Float32Array(position.count * 3).fill(1), 3)
  );
  return geometry;
};

const createMaterial = (color = 0xffffff) => new THREE.MeshBasicMaterial({
  color,
  vertexColors: true,
  fog: false
});

const createInstancedMesh = (geometry, material, capacity) => {
  prepareInstanceColorGeometry(geometry);
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
};

const createWeaponGeometry = (styleIndex) => {
  if (styleIndex === 0) {
    const geometry = new THREE.CylinderGeometry(0.09, 0.13, 2.2, 7);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }
  if (styleIndex === 1) return new THREE.BoxGeometry(0.28, 0.16, 1.7);
  if (styleIndex === 2) return new THREE.BoxGeometry(0.12, 0.38, 1.95);
  if (styleIndex === 3) {
    const geometry = new THREE.TorusGeometry(0.52, 0.085, 6, 14, Math.PI * 1.55);
    geometry.rotateZ(Math.PI * 0.22);
    return geometry;
  }
  if (styleIndex === 4) return new THREE.BoxGeometry(1.18, 0.16, 0.26);
  if (styleIndex === 5) {
    const geometry = new THREE.CylinderGeometry(0.08, 0.11, 1.6, 8);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }
  if (styleIndex === 6) {
    const geometry = new THREE.CylinderGeometry(0.085, 0.14, 1.9, 8);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }
  if (styleIndex === 7) return new THREE.BoxGeometry(0.82, 0.22, 0.7);
  const geometry = new THREE.TorusGeometry(0.3, 0.09, 6, 12);
  geometry.rotateX(Math.PI / 2);
  return geometry;
};

const createWeaponTipGeometry = (styleIndex) => {
  if (styleIndex <= 2) return new THREE.ConeGeometry(0.22, 0.52, 6);
  if (styleIndex === 3 || styleIndex === 4 || styleIndex === 5) return new THREE.SphereGeometry(0.15, 8, 6);
  if (styleIndex === 6) return new THREE.OctahedronGeometry(0.26, 0);
  if (styleIndex === 7) return new THREE.BoxGeometry(0.18, 0.32, 0.18);
  return new THREE.SphereGeometry(0.2, 8, 6);
};

const styleFromFields = (categoryIndex, subtypeIndex) => {
  const category = clamp(Math.floor(Number(categoryIndex) || 0), 0, 2);
  const subtype = clamp(Math.floor(Number(subtypeIndex) || 0), 0, 2);
  return (category * 3) + subtype;
};

export default class TrainingChibiUnitRenderer {
  constructor(group) {
    this.group = group;
    this.capacity = 0;
    this.bodyGeometry = new THREE.SphereGeometry(1, 14, 10);
    this.headGeometry = new THREE.SphereGeometry(0.58, 12, 8);
    this.faceGeometry = new THREE.BoxGeometry(0.56, 0.16, 0.18);
    this.eyeGeometry = new THREE.SphereGeometry(0.075, 8, 6);
    this.helmetGeometry = new THREE.ConeGeometry(0.52, 0.64, 7);
    this.rangedCrestGeometry = new THREE.BoxGeometry(0.7, 0.34, 0.18);
    this.supportHaloGeometry = new THREE.TorusGeometry(0.52, 0.08, 6, 16);
    this.bodyMaterial = createMaterial(0xffffff, 0.78, 0.05);
    this.headMaterial = createMaterial(0xffffff, 0.66, 0.08);
    this.faceMaterial = createMaterial(0x172033, 0.4, 0.22);
    this.eyeMaterial = createMaterial(0xf8fafc, 0.3, 0.12);
    this.helmetMaterial = createMaterial(0xffffff, 0.58, 0.2);
    this.rangedCrestMaterial = createMaterial(0xffffff, 0.5, 0.24);
    this.supportHaloMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      fog: false
    });
    this.weaponMaterials = Array.from({ length: 9 }, (_, index) => createMaterial(
      STYLE_ACCENTS[index],
      index >= 6 ? 0.38 : 0.48,
      index >= 3 ? 0.42 : 0.68
    ));
    this.weaponTipMaterials = Array.from({ length: 9 }, (_, index) => createMaterial(
      STYLE_ACCENTS[index],
      0.36,
      0.72
    ));
    this.bodyMesh = null;
    this.headMesh = null;
    this.faceMesh = null;
    this.eyeMesh = null;
    this.helmetMesh = null;
    this.rangedCrestMesh = null;
    this.supportHaloMesh = null;
    this.weaponMeshes = [];
    this.weaponTipMeshes = [];
  }

  ensureCapacity(count = 0) {
    const safeCount = Math.max(1, Math.floor(Number(count) || 0));
    if (safeCount <= this.capacity && this.bodyMesh) return;
    const nextCapacity = Math.max(64, Math.ceil(safeCount * 1.35));
    const oldMeshes = [
      this.bodyMesh,
      this.headMesh,
      this.faceMesh,
      this.eyeMesh,
      this.helmetMesh,
      this.rangedCrestMesh,
      this.supportHaloMesh,
      ...this.weaponMeshes,
      ...this.weaponTipMeshes
    ].filter(Boolean);
    oldMeshes.forEach((mesh) => this.group.remove(mesh));

    this.bodyMesh = createInstancedMesh(this.bodyGeometry, this.bodyMaterial, nextCapacity);
    this.headMesh = createInstancedMesh(this.headGeometry, this.headMaterial, nextCapacity);
    this.faceMesh = createInstancedMesh(this.faceGeometry, this.faceMaterial, nextCapacity);
    this.eyeMesh = createInstancedMesh(this.eyeGeometry, this.eyeMaterial, nextCapacity);
    this.helmetMesh = createInstancedMesh(this.helmetGeometry, this.helmetMaterial, nextCapacity);
    this.rangedCrestMesh = createInstancedMesh(this.rangedCrestGeometry, this.rangedCrestMaterial, nextCapacity);
    this.supportHaloMesh = createInstancedMesh(this.supportHaloGeometry, this.supportHaloMaterial, nextCapacity);
    this.weaponMeshes = Array.from({ length: 9 }, (_, index) => (
      createInstancedMesh(createWeaponGeometry(index), this.weaponMaterials[index], nextCapacity)
    ));
    this.weaponTipMeshes = Array.from({ length: 9 }, (_, index) => (
      createInstancedMesh(createWeaponTipGeometry(index), this.weaponTipMaterials[index], nextCapacity)
    ));
    this.group.add(
      this.bodyMesh,
      this.headMesh,
      this.faceMesh,
      this.eyeMesh,
      this.helmetMesh,
      this.rangedCrestMesh,
      this.supportHaloMesh,
      ...this.weaponMeshes,
      ...this.weaponTipMeshes
    );
    this.capacity = nextCapacity;
  }

  setInstance(mesh, index, position, quaternion, scale, color) {
    tempPos.set(position.x, position.y, position.z);
    tempQuat.copy(quaternion);
    tempScale.set(scale.x, scale.y, scale.z);
    tempMatrix.compose(tempPos, tempQuat, tempScale);
    mesh.setMatrixAt(index, tempMatrix);
    if (color) mesh.setColorAt(index, color);
  }

  update(units, skillStates = null, visualFocus = null) {
    const count = Math.max(0, Math.floor(Number(units?.count) || 0));
    this.ensureCapacity(count);
    const data = units?.data || [];
    const skillData = skillStates?.data || [];
    const weaponCounts = Array.from({ length: 9 }, () => 0);
    let helmetCount = 0;
    let rangedCrestCount = 0;
    let supportHaloCount = 0;

    for (let index = 0; index < count; index += 1) {
      const base = index * 20;
      const skillBase = index * 4;
      const x = Number(data[base + 0]) || 0;
      const y = Number(data[base + 1]) || 0;
      const z = Number(data[base + 2]) || 0;
      const size = resolveTrainingUnitVisualSize(data[base + 3]);
      const yaw = Number(data[base + 4]) || 0;
      const teamIndex = Number(data[base + 5]) > 0.5 ? 1 : 0;
      const hpRatio = clamp(Number(data[base + 6]) || 0, 0, 1);
      const selected = Number(data[base + 12]) > 0.5;
      const ghost = Number(data[base + 14]) > 0.5;
      const hovered = Number(data[base + 15]) > 0.5;
      const categoryIndex = clamp(Math.floor(Number(skillData[skillBase + 0]) || 0), 0, 2);
      const subtypeIndex = clamp(Math.floor(Number(skillData[skillBase + 1]) || 0), 0, 2);
      const actionIndex = clamp(Math.floor(Number(skillData[skillBase + 2]) || 0), 0, 3);
      const actionProgress = clamp(Number(skillData[skillBase + 3]) || 0, 0, 1);
      const shadowed = !!visualFocus?.shadowFlags?.[index];
      const shadowBrightness = clamp(Number(visualFocus?.shadowBrightness) || 0.3, 0.12, 1);
      const brightness = shadowed ? shadowBrightness : 1;
      const hoverZoomProgress = clamp(Number(visualFocus?.hoverZoomProgress) || 0, 0, 1);
      const styleIndex = styleFromFields(categoryIndex, subtypeIndex);
      const forwardX = Math.cos(yaw);
      const forwardY = Math.sin(yaw);
      const actionPulse = actionIndex > 0 ? Math.sin(actionProgress * Math.PI) : 0;
      const bodyBob = actionIndex === 3 ? actionPulse * size * 0.12 : actionPulse * size * 0.08;
      const bodyColor = tempColor.copy(TEAM_COLORS[teamIndex]);
      tempAccent.copy(STYLE_ACCENTS[styleIndex]);
      bodyColor.lerp(tempAccent, 0.12 + (hpRatio * 0.1));
      if (selected) bodyColor.lerp(SELECTED_COLOR, 0.18);
      if (ghost) bodyColor.lerp(GHOST_COLOR, 0.42);
      if (hovered) bodyColor.lerp(HOVER_COLOR, 0.32 + (hoverZoomProgress * 0.32));
      const baseBrightness = lerp(0.34, 0.72, hpRatio);
      const hoverBrightness = hovered ? lerp(1.12, 1.36, hoverZoomProgress) : 1;
      bodyColor.multiplyScalar(baseBrightness * brightness * hoverBrightness);
      const bodyQuaternion = tempQuat;
      bodyQuaternion.identity();
      tempPos.set(x, y, z + (size * 0.62) + bodyBob);
      tempScale.set(size * 0.68, size * 0.62, size * 0.74);
      tempMatrix.compose(tempPos, bodyQuaternion, tempScale);
      this.bodyMesh.setMatrixAt(index, tempMatrix);
      this.bodyMesh.setColorAt(index, bodyColor);

      const headHighlightMix = shadowed
        ? 0.04
        : (hovered ? 0.3 + (hoverZoomProgress * 0.28) : 0.07);
      const headColor = tempAccent.copy(bodyColor).lerp(
        HEAD_HIGHLIGHT,
        headHighlightMix
      );
      headColor.multiplyScalar(hovered ? 1.04 + (hoverZoomProgress * 0.1) : 0.84);
      tempPos.set(x + (forwardX * size * 0.05), y + (forwardY * size * 0.05), z + (size * 1.25) + bodyBob);
      tempScale.set(size * 0.45, size * 0.42, size * 0.45);
      tempMatrix.compose(tempPos, bodyQuaternion, tempScale);
      this.headMesh.setMatrixAt(index, tempMatrix);
      this.headMesh.setColorAt(index, headColor);

      tempEuler.set(0, 0, yaw);
      tempQuat.setFromEuler(tempEuler);
      tempPos.set(x + (forwardX * size * 0.39), y + (forwardY * size * 0.39), z + (size * 1.27) + bodyBob);
      tempScale.set(size * 0.34, size * 0.12, size * 0.16);
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.faceMesh.setMatrixAt(index, tempMatrix);
      this.faceMesh.setColorAt(index, tempColor.copy(FACE_COLOR).multiplyScalar(brightness));

      tempPos.set(x + (forwardX * size * 0.43), y + (forwardY * size * 0.43), z + (size * 1.39) + bodyBob);
      tempScale.set(size * 0.075, size * 0.075, size * 0.075);
      tempMatrix.compose(tempPos, bodyQuaternion, tempScale);
      this.eyeMesh.setMatrixAt(index, tempMatrix);
      this.eyeMesh.setColorAt(
        index,
        tempColor.copy(EYE_COLOR).multiplyScalar(brightness * (hovered ? 1.04 : 0.68))
      );

      const accessoryBrightness = brightness * (
        hovered ? 1.12 + (hoverZoomProgress * 0.12) : 0.72
      );

      if (categoryIndex === 0) {
        tempPos.set(x, y, z + (size * 1.68) + bodyBob);
        tempScale.set(size * 0.72, size * 0.72, size * 0.55);
        tempMatrix.compose(tempPos, bodyQuaternion, tempScale);
        this.helmetMesh.setMatrixAt(helmetCount, tempMatrix);
        this.helmetMesh.setColorAt(
          helmetCount,
          tempAccent.copy(STYLE_ACCENTS[styleIndex]).multiplyScalar(accessoryBrightness)
        );
        helmetCount += 1;
      } else if (categoryIndex === 1) {
        tempPos.set(x, y, z + (size * 1.64) + bodyBob);
        tempScale.set(size * 0.68, size * 0.68, size * 0.34);
        tempMatrix.compose(tempPos, bodyQuaternion, tempScale);
        this.rangedCrestMesh.setMatrixAt(rangedCrestCount, tempMatrix);
        this.rangedCrestMesh.setColorAt(
          rangedCrestCount,
          tempAccent.copy(STYLE_ACCENTS[styleIndex]).multiplyScalar(accessoryBrightness)
        );
        rangedCrestCount += 1;
      } else {
        tempPos.set(x, y, z + (size * 1.55) + bodyBob);
        tempScale.set(size * 0.74, size * 0.74, size * 0.74);
        tempMatrix.compose(tempPos, bodyQuaternion, tempScale);
        this.supportHaloMesh.setMatrixAt(supportHaloCount, tempMatrix);
        this.supportHaloMesh.setColorAt(
          supportHaloCount,
          tempAccent.copy(STYLE_ACCENTS[styleIndex]).multiplyScalar(accessoryBrightness)
        );
        supportHaloCount += 1;
      }

      const weaponIndex = weaponCounts[styleIndex];
      weaponCounts[styleIndex] += 1;
      const swing = actionIndex === 1 ? (Math.sin(actionProgress * Math.PI) * 0.92) : 0;
      const castTilt = actionIndex === 2 ? (Math.sin(actionProgress * Math.PI) * 0.32) : 0;
      const weaponYaw = yaw + swing + castTilt;
      tempEuler.set(0, 0, weaponYaw);
      tempQuat.setFromEuler(tempEuler);
      const handX = x + (forwardX * size * (0.52 + (actionIndex === 1 ? actionPulse * 0.26 : 0)));
      const handY = y + (forwardY * size * (0.52 + (actionIndex === 1 ? actionPulse * 0.26 : 0)));
      const weaponZ = z + (size * (0.92 + (actionIndex === 3 ? actionPulse * 0.16 : 0)));
      tempPos.set(handX, handY, weaponZ);
      const weaponScale = categoryIndex === 2 ? size * 0.74 : size * 0.82;
      tempScale.set(weaponScale, weaponScale, weaponScale);
      this.weaponMeshes[styleIndex].setMatrixAt(weaponIndex, tempMatrix.compose(tempPos, tempQuat, tempScale));
      this.weaponMeshes[styleIndex].setColorAt(
        weaponIndex,
        tempAccent.copy(STYLE_ACCENTS[styleIndex]).multiplyScalar(accessoryBrightness)
      );

      tempPos.set(
        handX + (forwardX * size * 0.55),
        handY + (forwardY * size * 0.55),
        weaponZ + (categoryIndex === 2 ? size * 0.22 : size * 0.38)
      );
      tempScale.set(size * 0.72, size * 0.72, size * 0.72);
      this.weaponTipMeshes[styleIndex].setMatrixAt(weaponIndex, tempMatrix.compose(tempPos, tempQuat, tempScale));
      this.weaponTipMeshes[styleIndex].setColorAt(
        weaponIndex,
        tempAccent.copy(STYLE_ACCENTS[styleIndex]).multiplyScalar(accessoryBrightness)
      );
    }

    this.bodyMesh.count = count;
    this.headMesh.count = count;
    this.faceMesh.count = count;
    this.eyeMesh.count = count;
    this.helmetMesh.count = helmetCount;
    this.rangedCrestMesh.count = rangedCrestCount;
    this.supportHaloMesh.count = supportHaloCount;
    [
      this.bodyMesh,
      this.headMesh,
      this.faceMesh,
      this.eyeMesh,
      this.helmetMesh,
      this.rangedCrestMesh,
      this.supportHaloMesh,
      ...this.weaponMeshes,
      ...this.weaponTipMeshes
    ].forEach((mesh) => {
      if (!mesh) return;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    this.weaponMeshes.forEach((mesh, index) => {
      mesh.count = weaponCounts[index];
      this.weaponTipMeshes[index].count = weaponCounts[index];
    });
  }

  dispose() {
    const meshes = [
      this.bodyMesh,
      this.headMesh,
      this.faceMesh,
      this.eyeMesh,
      this.helmetMesh,
      this.rangedCrestMesh,
      this.supportHaloMesh,
      ...this.weaponMeshes,
      ...this.weaponTipMeshes
    ].filter(Boolean);
    meshes.forEach((mesh) => this.group.remove(mesh));
    new Set([
      this.bodyGeometry,
      this.headGeometry,
      this.faceGeometry,
      this.eyeGeometry,
      this.helmetGeometry,
      this.rangedCrestGeometry,
      this.supportHaloGeometry,
      ...meshes.map((mesh) => mesh.geometry)
    ]).forEach((geometry) => geometry?.dispose?.());
    new Set([
      this.bodyMaterial,
      this.headMaterial,
      this.faceMaterial,
      this.eyeMaterial,
      this.helmetMaterial,
      this.rangedCrestMaterial,
      this.supportHaloMaterial,
      ...this.weaponMaterials,
      ...this.weaponTipMaterials
    ]).forEach((material) => material?.dispose?.());
    this.bodyMesh = null;
    this.headMesh = null;
    this.faceMesh = null;
    this.eyeMesh = null;
    this.helmetMesh = null;
    this.rangedCrestMesh = null;
    this.supportHaloMesh = null;
    this.weaponMeshes = [];
    this.weaponTipMeshes = [];
  }
}
