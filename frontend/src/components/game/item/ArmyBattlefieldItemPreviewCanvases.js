import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getItemGeometry } from '../../../game/battlefield/items/ItemGeometryRegistry';

const clearObject3D = (root) => {
  if (!root || typeof root.traverse !== 'function') return;
  root.traverse((node) => {
    if (!node || node === root) return;
    if (node.geometry && typeof node.geometry.dispose === 'function') {
      node.geometry.dispose();
    }
    if (Array.isArray(node.material)) {
      node.material.forEach((mat) => {
        if (mat && typeof mat.dispose === 'function') mat.dispose();
      });
    } else if (node.material && typeof node.material.dispose === 'function') {
      node.material.dispose();
    }
  });
};

const buildBattlefieldItemMesh = (item = {}, options = {}) => {
  const geometry = getItemGeometry(item || {});
  const builder = geometry?.previewBuilder;
  return typeof builder === 'function'
    ? builder(null, options?.paletteOverride || null, options?.hintsOverride || null)
    : null;
};

const updateRendererSize = (canvas, renderer, camera) => {
  const width = canvas.clientWidth || 320;
  const height = canvas.clientHeight || 220;
  if (canvas.width === width && canvas.height === height) return;
  renderer.setSize(width, height, false);
  camera.aspect = Math.max(0.2, width / Math.max(1, height));
  camera.updateProjectionMatrix();
};

export const ArmyBattlefieldItemCloseupPreview = ({ item, rotationDeg = 0, className = '' }) => {
  const canvasRef = useRef(null);
  const rotationRef = useRef(0);
  const itemRef = useRef(item || null);
  rotationRef.current = Number(rotationDeg) || 0;
  itemRef.current = item || null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(canvas.clientWidth || 320, canvas.clientHeight || 220, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      44,
      Math.max(0.2, (canvas.clientWidth || 320) / Math.max(1, canvas.clientHeight || 220)),
      0.1,
      1200
    );
    camera.up.set(0, 0, 1);

    const hemi = new THREE.HemisphereLight(0xf8fafc, 0x334155, 1.02);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfffbeb, 0.92);
    key.position.set(28, -24, 34);
    scene.add(key);

    let currentGroup = null;

    const refreshMesh = () => {
      if (currentGroup) {
        scene.remove(currentGroup);
        clearObject3D(currentGroup);
      }
      currentGroup = buildBattlefieldItemMesh(itemRef.current || {}, { battleTone: false });
      scene.add(currentGroup);
    };

    refreshMesh();

    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      updateRendererSize(canvas, renderer, camera);
      if (!currentGroup) return;
      const radius = Math.max(6, Number(currentGroup.userData?.radius) || 6);
      const focusZ = Number(currentGroup.userData?.focusZ) || 3;
      camera.position.set(radius * 2.15, -radius * 2.4, radius * 1.5);
      camera.lookAt(0, 0, focusZ);
      currentGroup.rotation.z = (rotationRef.current * Math.PI) / 180;
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      if (currentGroup) {
        clearObject3D(currentGroup);
        scene.remove(currentGroup);
      }
      renderer.dispose();
    };
  }, [item]);

  return <canvas ref={canvasRef} className={className} style={{ width: '100%', height: '100%', display: 'block' }} />;
};

export const ArmyBattlefieldItemBattlePreview = ({ item, rotationDeg = 0, className = '' }) => {
  const canvasRef = useRef(null);
  const rotationRef = useRef(0);
  const itemRef = useRef(item || null);
  rotationRef.current = Number(rotationDeg) || 0;
  itemRef.current = item || null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(canvas.clientWidth || 320, canvas.clientHeight || 220, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      48,
      Math.max(0.2, (canvas.clientWidth || 320) / Math.max(1, canvas.clientHeight || 220)),
      0.1,
      1400
    );
    camera.up.set(0, 0, 1);

    const hemi = new THREE.HemisphereLight(0xe2fbe8, 0x1f2937, 0.94);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xf0fdf4, 0.88);
    key.position.set(-26, -22, 30);
    scene.add(key);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(42, 40),
      new THREE.MeshStandardMaterial({
        color: 0x1d2e2b,
        roughness: 0.92,
        metalness: 0.02
      })
    );
    ground.position.set(0, 0, 0.05);
    scene.add(ground);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(28, 36, 40),
      new THREE.MeshBasicMaterial({
        color: 0x4ade80,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide
      })
    );
    ring.rotation.x = THREE.MathUtils.degToRad(90);
    ring.position.z = 0.12;
    scene.add(ring);

    let currentGroup = null;

    const refreshMesh = () => {
      if (currentGroup) {
        scene.remove(currentGroup);
        clearObject3D(currentGroup);
      }
      currentGroup = buildBattlefieldItemMesh(itemRef.current || {}, { battleTone: true });
      scene.add(currentGroup);
    };

    refreshMesh();

    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      updateRendererSize(canvas, renderer, camera);
      if (!currentGroup) return;
      const radius = Math.max(6, Number(currentGroup.userData?.radius) || 6);
      const focusZ = Number(currentGroup.userData?.focusZ) || 3;
      camera.position.set(0, -radius * 3.2, radius * 2.35);
      camera.lookAt(0, 0, focusZ * 0.72);
      currentGroup.rotation.z = (rotationRef.current * Math.PI) / 180;
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      if (currentGroup) {
        clearObject3D(currentGroup);
        scene.remove(currentGroup);
      }
      if (ground.geometry) ground.geometry.dispose();
      if (ground.material) ground.material.dispose();
      if (ring.geometry) ring.geometry.dispose();
      if (ring.material) ring.material.dispose();
      renderer.dispose();
    };
  }, [item]);

  return <canvas ref={canvasRef} className={className} style={{ width: '100%', height: '100%', display: 'block' }} />;
};
