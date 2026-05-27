import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  CITY_CHANNEL_MECHANISM_KINDS,
  getGearMountLocalPosition,
  getMechanismTemplateKind,
  normalizeMechanismParams
} from './cityChannelMechanismRuntime';
import { getCityChannelMaterial } from './cityChannelCatalog';

const ROTATE_SENSITIVITY = 0.009;
const MIN_PITCH = -45;
const MAX_PITCH = 60;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const createMaterial = (color, options = {}) => new THREE.MeshStandardMaterial({
  color,
  roughness: options.roughness ?? 0.56,
  metalness: options.metalness ?? 0.24,
  transparent: !!options.transparent,
  opacity: options.opacity ?? 1,
  side: options.side || THREE.FrontSide
});

const addBox = (group, name, size, position, material) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.name = name;
  mesh.position.set(position.x, position.y, position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
};

const addCylinder = (group, name, radius, depth, position, material, radialSegments = 24) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, radialSegments), material);
  mesh.name = name;
  mesh.position.set(position.x, position.y, position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
};

const addRodBetween = (group, name, start, end, radius, material) => {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = Math.max(0.001, direction.length());
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 16), material);
  mesh.name = name;
  mesh.position.copy(start).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
};

const addSpring = (group, name, x, z, height, material) => {
  const springGroup = new THREE.Group();
  springGroup.name = name;
  springGroup.position.set(x, -0.18, z);
  const points = [];
  const turns = 24;
  for (let index = 0; index <= turns; index += 1) {
    const t = index / turns;
    const angle = t * Math.PI * 2 * 5;
    points.push(new THREE.Vector3(
      Math.cos(angle) * 0.11,
      t * height,
      Math.sin(angle) * 0.11
    ));
  }
  springGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: material, transparent: true, opacity: 0.92 })
  ));
  group.add(springGroup);
  return springGroup;
};

const createGear = (material, radius = 0.34, teeth = 12) => {
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.12, teeth * 2), material);
  core.rotation.x = Math.PI / 2;
  core.castShadow = true;
  group.add(core);
  for (let index = 0; index < teeth; index += 1) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.16), material);
    const angle = (index / teeth) * Math.PI * 2;
    tooth.position.set(Math.cos(angle) * (radius + 0.05), Math.sin(angle) * (radius + 0.05), 0);
    tooth.rotation.z = angle;
    tooth.castShadow = true;
    group.add(tooth);
  }
  return group;
};

const addTransmissionLine = (group, start, end, material) => {
  addRodBetween(
    group,
    '传动骨骼',
    new THREE.Vector3(start.x, 0.16, start.z),
    new THREE.Vector3(end.x, 0.16, end.z),
    0.035,
    material
  );
};

const createBoardModel = (panelType, tile = null) => {
  const material = getCityChannelMaterial(panelType);
  const transmissionSkeleton = tile?.transmissionSkeleton || material.transmissionSkeleton;
  const gearMounts = Array.isArray(tile?.gearMounts) ? tile.gearMounts : (material.gearMounts || []);
  const root = new THREE.Group();
  const stone = createMaterial(0xb8b1a4, { metalness: 0.08, roughness: 0.74 });
  const side = createMaterial(0x756f64, { metalness: 0.1, roughness: 0.8 });
  const skeleton = createMaterial(0xfacc15, { metalness: 0.32, roughness: 0.34 });
  const gear = createMaterial(0x020617, { metalness: 0.36, roughness: 0.42 });
  const fixedHub = createMaterial(0x22d3ee, { metalness: 0.25, roughness: 0.32 });
  const freeHub = createMaterial(0xf8fafc, { metalness: 0.2, roughness: 0.34 });

  addBox(root, '灰色厚度', { x: 3.2, y: 0.22, z: 2.25 }, { x: 0, y: -0.16, z: 0 }, side);
  addBox(root, '石材板体', { x: 3.02, y: 0.12, z: 2.08 }, { x: 0, y: 0.02, z: 0 }, stone);

  const center = { x: 0, z: 0 };
  (transmissionSkeleton?.ports || []).forEach((port) => {
    addTransmissionLine(root, center, { x: (port.localPosition?.x || 0) * 2.7, z: (port.localPosition?.y || 0) * 1.8 }, skeleton);
    addCylinder(root, '连接端点', 0.07, 0.05, {
      x: (port.localPosition?.x || 0) * 2.7,
      y: 0.2,
      z: (port.localPosition?.y || 0) * 1.8
    }, createMaterial(0xf8fafc), 18);
  });

  if (material.gearIcon) {
    const icon = createGear(gear, 0.22, 10);
    icon.position.set(0, 0.25, 0);
    root.add(icon);
  }

  gearMounts.forEach((mount) => {
    const local = getGearMountLocalPosition(mount.position);
    const gearGroup = createGear(gear, 0.22, 12);
    gearGroup.position.set(local.x * 2.7, 0.28, local.y * 1.8);
    root.add(gearGroup);
    addCylinder(root, mount.axisType === 'fixedAxis' ? '固定轴' : '活动轴', 0.07, 0.12, {
      x: local.x * 2.7,
      y: 0.36,
      z: local.y * 1.8
    }, mount.axisType === 'fixedAxis' ? fixedHub : freeHub, 20);
  });

  root.userData.refs = { kind: getMechanismTemplateKind(panelType), gears: [] };
  root.rotation.x = -0.34;
  root.rotation.y = 0.58;
  return root;
};

const createModel = (panelType, tile = null) => {
  const kind = getMechanismTemplateKind(panelType);
  const material = getCityChannelMaterial(panelType);
  if (
    material.boardRole !== 'power_source'
    || kind === CITY_CHANNEL_MECHANISM_KINDS.TRANSMISSION_BOARD
    || kind === CITY_CHANNEL_MECHANISM_KINDS.ACTUATOR_BOARD
  ) {
    return createBoardModel(panelType, tile);
  }
  const root = new THREE.Group();
  const refs = { kind };
  const metal = createMaterial(0x263241, { metalness: 0.34, roughness: 0.48 });
  const dark = createMaterial(0x0b1220, { metalness: 0.18, roughness: 0.72 });
  const glass = createMaterial(0x38bdf8, { metalness: 0.08, roughness: 0.35, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
  const plate = createMaterial(0xb8b1a4, { metalness: 0.08, roughness: 0.74 });
  const brass = createMaterial(0xf59e0b, { metalness: 0.42, roughness: 0.34 });
  const rod = createMaterial(0xcbd5e1, { metalness: 0.55, roughness: 0.28 });
  const cyan = createMaterial(0xa5f3fc, { metalness: 0.34, roughness: 0.28 });

  addBox(root, 'base', { x: 3.35, y: 0.22, z: 2.35 }, { x: 0, y: -0.42, z: 0 }, dark);
  addBox(root, 'cutaway-back-shell', { x: 3.18, y: 0.92, z: 0.12 }, { x: 0, y: -0.02, z: 1.12 }, glass);
  addBox(root, 'left-rail', { x: 0.08, y: 1.08, z: 2.12 }, { x: -1.45, y: 0.05, z: 0 }, metal);
  addBox(root, 'right-rail', { x: 0.08, y: 1.08, z: 2.12 }, { x: 1.45, y: 0.05, z: 0 }, metal);
  refs.plate = addBox(root, 'pressure-plate', { x: 2.58, y: 0.18, z: 1.72 }, { x: 0, y: 0.45, z: 0 }, plate);
  refs.plunger = addCylinder(root, 'center-plunger', 0.12, 0.9, { x: 0, y: 0.02, z: 0 }, rod);
  refs.springs = [
    addSpring(root, 'spring-left', -0.72, -0.48, 0.56, 0x93c5fd),
    addSpring(root, 'spring-right', 0.72, -0.48, 0.56, 0x93c5fd)
  ];
  refs.rack = addBox(root, 'rack', { x: 0.1, y: 0.68, z: 0.1 }, { x: -0.46, y: -0.04, z: -0.18 }, rod);
  refs.gear = createGear(brass, 0.3, 12);
  refs.gear.position.set(-0.18, -0.16, 0.08);
  root.add(refs.gear);

  refs.crank = addRodBetween(root, 'crank', new THREE.Vector3(-0.18, -0.16, 0.08), new THREE.Vector3(0.45, -0.18, 0.08), 0.035, brass);
  refs.link = addRodBetween(root, 'link', new THREE.Vector3(0.45, -0.18, 0.08), new THREE.Vector3(0.58, -0.46, 0.08), 0.035, rod);
  refs.sleeve = addCylinder(root, 'bottom-guide-sleeve', 0.24, 0.42, { x: 0.58, y: -0.54, z: 0.08 }, metal, 24);
  refs.output = addCylinder(root, 'down-output-rod', 0.16, 0.62, { x: 0.58, y: -0.82, z: 0.08 }, cyan, 24);

  root.userData.refs = refs;
  root.rotation.x = -0.26;
  root.rotation.y = 0.54;
  return root;
};

const applyPose = (model, progress, params) => {
  if (!model?.userData?.refs) return;
  const refs = model.userData.refs;
  const p = clamp(Number(progress) || 0, 0, 1);
  const normalized = normalizeMechanismParams(params);
  if (!refs.plate || !refs.gear) {
    model.rotation.z = THREE.MathUtils.degToRad((normalized.rotationDirection === 'left' ? -1 : 1) * normalized.rotationAngle * p);
    return;
  }
  const press = 0.18 * p;
  refs.plate.position.y = 0.45 - press;
  refs.plunger.position.y = 0.02 - (press * 0.8);
  refs.rack.position.y = -0.04 - (0.22 * p);
  refs.springs.forEach((spring) => {
    spring.scale.y = 1 - (p * 0.38);
  });
  const angle = THREE.MathUtils.degToRad(normalized.rotationAngle * p);
  refs.gear.rotation.z = -angle;

  const travel = (normalized.verticalExtensionLength / 140) * 1.08 * p;
  refs.output.position.y = -0.82 - travel;
  refs.sleeve.scale.y = 1 + (travel * 0.3);
  refs.crank.rotation.z = angle;
  refs.link.rotation.z = angle * 0.36;
};

const CityChannelPressurePlateInspect3D = ({
  inspectMode,
  mechanismParams,
  previewState
}) => {
  const mountRef = useRef(null);
  const modelRef = useRef(null);
  const dragRef = useRef(null);
  const orbitRef = useRef({ yaw: 0.54, pitch: -0.26 });

  useEffect(() => {
    if (!inspectMode?.active || !mountRef.current) return undefined;
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 2.25, 6.1);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x0f172a, 1.55));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.25);
    keyLight.position.set(3, 5, 4);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const fill = new THREE.DirectionalLight(0x67e8f9, 0.88);
    fill.position.set(-4, 2, -2);
    scene.add(fill);

    const model = createModel(inspectMode.panelType, inspectMode.tile);
    model.scale.setScalar(1);
    model.position.y = -0.04;
    modelRef.current = model;
    orbitRef.current = { yaw: 0.54, pitch: -0.26 };
    scene.add(model);
    applyPose(model, 0, {});

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    let frameId = 0;
    const render = () => {
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(render);
    };
    frameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
      modelRef.current = null;
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [inspectMode?.active, inspectMode?.panelType, inspectMode?.tile]);

  useEffect(() => {
    if (!modelRef.current || !inspectMode?.active) return;
    const progress = previewState?.key === inspectMode.key ? previewState.progress : 0;
    applyPose(modelRef.current, progress, previewState?.key === inspectMode.key ? previewState.params : mechanismParams);
  }, [inspectMode?.active, inspectMode?.key, mechanismParams, previewState]);

  const handlePointerDown = (event) => {
    if (!modelRef.current) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event) => {
    if (!modelRef.current || !dragRef.current) return;
    event.stopPropagation();
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    orbitRef.current.yaw += dx * ROTATE_SENSITIVITY;
    orbitRef.current.pitch = THREE.MathUtils.degToRad(clamp(
      THREE.MathUtils.radToDeg(orbitRef.current.pitch) - (dy * ROTATE_SENSITIVITY * 180 / Math.PI),
      MIN_PITCH,
      MAX_PITCH
    ));
    modelRef.current.rotation.y = orbitRef.current.yaw;
    modelRef.current.rotation.x = orbitRef.current.pitch;
  };

  const handlePointerUp = (event) => {
    event.stopPropagation();
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  if (!inspectMode?.active) return null;

  return (
    <div className="city-channel-inspect3d" onPointerDown={(event) => event.stopPropagation()}>
      <div
        ref={mountRef}
        className="city-channel-inspect3d__stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
};

export default CityChannelPressurePlateInspect3D;
