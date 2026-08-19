import * as THREE from 'three';
import TrainingChibiUnitRenderer from './TrainingChibiUnitRenderer';

test('adds a white geometry color baseline for instanced chibi parts', () => {
  const renderer = new TrainingChibiUnitRenderer(new THREE.Group());
  renderer.ensureCapacity(1);
  expect(renderer.bodyMesh.material.fog).toBe(false);

  [
    renderer.bodyMesh,
    renderer.headMesh,
    renderer.faceMesh,
    renderer.eyeMesh,
    renderer.helmetMesh,
    renderer.rangedCrestMesh,
    renderer.supportHaloMesh,
    ...renderer.weaponMeshes,
    ...renderer.weaponTipMeshes
  ].forEach((mesh) => {
    const colors = mesh.geometry.getAttribute('color');
    expect(colors).toBeTruthy();
    expect(Array.from(colors.array).every((value) => value === 1)).toBe(true);
  });

  renderer.dispose();
});

test('refreshes a chibi instance matrix when its snapshot position changes', () => {
  const renderer = new TrainingChibiUnitRenderer(new THREE.Group());
  const units = {
    count: 1,
    data: new Float32Array(20)
  };
  const skillStates = {
    count: 1,
    data: new Float32Array(4)
  };
  units.data[0] = -36;
  units.data[1] = 18;
  units.data[3] = 4;
  units.data[6] = 1;
  renderer.update(units, skillStates);

  const initialMatrix = new THREE.Matrix4();
  const initialPosition = new THREE.Vector3();
  renderer.bodyMesh.getMatrixAt(0, initialMatrix);
  initialPosition.setFromMatrixPosition(initialMatrix);

  units.data[0] = 84;
  units.data[1] = -52;
  renderer.update(units, skillStates);

  const updatedMatrix = new THREE.Matrix4();
  const updatedPosition = new THREE.Vector3();
  renderer.bodyMesh.getMatrixAt(0, updatedMatrix);
  updatedPosition.setFromMatrixPosition(updatedMatrix);

  expect(initialPosition.x).toBeCloseTo(-36);
  expect(initialPosition.y).toBeCloseTo(18);
  expect(updatedPosition.x).toBeCloseTo(84);
  expect(updatedPosition.y).toBeCloseTo(-52);
  renderer.dispose();
});

test('uses a darker base palette and stronger zoom-aware hover lift', () => {
  const renderer = new TrainingChibiUnitRenderer(new THREE.Group());
  const units = {
    count: 1,
    data: new Float32Array(20)
  };
  units.data[3] = 4;
  units.data[6] = 1;
  const skillStates = {
    count: 1,
    data: new Float32Array(4)
  };
  const normalBody = new THREE.Color();
  const normalHead = new THREE.Color();
  const hoveredBody = new THREE.Color();
  const hoveredHead = new THREE.Color();

  renderer.update(units, skillStates, { hoverZoomProgress: 0 });
  renderer.bodyMesh.getColorAt(0, normalBody);
  renderer.headMesh.getColorAt(0, normalHead);

  units.data[15] = 1;
  renderer.update(units, skillStates, { hoverZoomProgress: 0 });
  renderer.bodyMesh.getColorAt(0, hoveredBody);
  renderer.headMesh.getColorAt(0, hoveredHead);

  const nearHoverBrightness = hoveredBody.r + hoveredBody.g + hoveredBody.b;
  renderer.update(units, skillStates, { hoverZoomProgress: 1 });
  const distantHoverBody = new THREE.Color();
  renderer.bodyMesh.getColorAt(0, distantHoverBody);
  const distantHoverBrightness = distantHoverBody.r + distantHoverBody.g + distantHoverBody.b;

  expect(hoveredBody.getHex()).not.toBe(normalBody.getHex());
  expect(hoveredHead.getHex()).not.toBe(normalHead.getHex());
  expect(nearHoverBrightness).toBeGreaterThan(normalBody.r + normalBody.g + normalBody.b);
  expect(distantHoverBrightness).toBeGreaterThan(nearHoverBrightness);
  renderer.dispose();
});

test('matches the training map red, blue, and yellow faction palettes', () => {
  const renderer = new TrainingChibiUnitRenderer(new THREE.Group());
  const units = {
    count: 3,
    data: new Float32Array(60)
  };
  const skillStates = {
    count: 3,
    data: new Float32Array(12)
  };
  units.data[3] = 4;
  units.data[6] = 1;
  units.data[20 + 3] = 4;
  units.data[20 + 5] = 1;
  units.data[20 + 6] = 1;
  units.data[40 + 3] = 4;
  units.data[40 + 5] = 2;
  units.data[40 + 6] = 1;

  renderer.update(units, skillStates);

  const attacker = new THREE.Color();
  const defender = new THREE.Color();
  const neutral = new THREE.Color();
  renderer.bodyMesh.getColorAt(0, attacker);
  renderer.bodyMesh.getColorAt(1, defender);
  renderer.bodyMesh.getColorAt(2, neutral);

  expect(attacker.r).toBeGreaterThan(attacker.b);
  expect(defender.b).toBeGreaterThan(defender.r);
  expect(neutral.r).toBeGreaterThan(neutral.b);
  expect(neutral.g).toBeGreaterThan(neutral.b);
  renderer.dispose();
});
