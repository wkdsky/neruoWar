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
