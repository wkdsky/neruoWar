import * as THREE from 'three';
import TrainingChibiUnitRenderer from './TrainingChibiUnitRenderer';

describe('TrainingChibiUnitRenderer crowd LOD', () => {
  test('draws only body silhouettes for dense formations', () => {
    const renderer = new TrainingChibiUnitRenderer(new THREE.Group());
    const unitCount = 160;
    const units = {
      count: unitCount,
      data: new Float32Array(unitCount * 20)
    };
    const skillStates = {
      count: unitCount,
      data: new Float32Array(unitCount * 4)
    };

    renderer.update(units, skillStates);

    expect(renderer.bodyMesh.count).toBe(unitCount);
    expect(renderer.headMesh.count).toBe(unitCount);
    expect(renderer.faceMesh.count).toBe(0);
    expect(renderer.eyeMesh.count).toBe(0);
    expect(renderer.helmetMesh.count).toBe(0);
    expect(renderer.weaponMeshes.every((mesh) => mesh.count === 0)).toBe(true);

    renderer.dispose();
  });
});
