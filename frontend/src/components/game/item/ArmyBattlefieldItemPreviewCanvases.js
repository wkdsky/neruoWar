import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

const clampStyleNumber = (value, fallback, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
};

const colorFromHex = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return fallback;
  return Number.parseInt(text, 16);
};

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
  const style = item?.style && typeof item.style === 'object' ? item.style : {};
  const renderShape = typeof style.shape === 'string' ? style.shape.trim().toLowerCase() : '';
  const isBattleTone = options?.battleTone === true;
  const bodyColor = colorFromHex(style.color, isBattleTone ? 0x5f6b76 : 0x8c6a44);
  const spikeColor = colorFromHex(style.spikeColor, isBattleTone ? 0x95a3b3 : 0x9ca3af);
  const accentColor = colorFromHex(style.accentColor, isBattleTone ? 0x86efac : 0xf59e0b);

  const width = Math.max(12, Number(item?.width) || 84);
  const depth = Math.max(12, Number(item?.depth) || 24);
  const height = Math.max(10, Number(item?.height) || 32);

  const sx = Math.max(2.2, width * 0.08);
  const sy = Math.max(1.6, depth * 0.08);
  const sz = Math.max(2.2, height * 0.08);
  const maxSpan = Math.max(sx, sy, sz);
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.66,
    metalness: isBattleTone ? 0.18 : 0.06
  });
  const spikeMaterial = new THREE.MeshStandardMaterial({
    color: spikeColor,
    roughness: 0.52,
    metalness: 0.22
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.48,
    metalness: 0.18
  });

  if (renderShape === 'stakes') {
    const beamCount = Math.round(clampStyleNumber(style.beamCount, 2, 2, 3));
    const spikeCount = Math.round(clampStyleNumber(style.spikeCount, 8, 4, 14));
    const beamSpreadDeg = clampStyleNumber(style.beamSpreadDeg, 34, 10, 60);
    const beamThicknessRatio = clampStyleNumber(style.beamThicknessRatio, 0.13, 0.08, 0.24);
    const spikeLengthRatio = clampStyleNumber(style.spikeLengthRatio, 0.48, 0.25, 0.8);
    const beamThickness = Math.max(0.36, sz * beamThicknessRatio);
    const beamLength = Math.max(2.2, sx);
    const beamGeo = new THREE.BoxGeometry(beamLength, beamThickness, beamThickness);
    const spikeGeo = new THREE.ConeGeometry(Math.max(0.12, beamThickness * 0.32), Math.max(0.8, sz * spikeLengthRatio), 8);

    for (let i = 0; i < beamCount; i += 1) {
      const ratio = beamCount <= 1 ? 0 : (i / (beamCount - 1));
      const angle = THREE.MathUtils.degToRad((-beamSpreadDeg * 0.5) + (ratio * beamSpreadDeg));
      const beam = new THREE.Mesh(beamGeo, bodyMaterial);
      beam.position.set(0, 0, Math.max(0.8, sz * 0.26) + (i * beamThickness * 0.68));
      beam.rotation.z = angle;
      group.add(beam);

      for (let s = 0; s < spikeCount; s += 1) {
        const t = spikeCount <= 1 ? 0 : (s / (spikeCount - 1));
        const localX = (t - 0.5) * (beamLength * 0.92);
        const spike = new THREE.Mesh(spikeGeo, spikeMaterial);
        spike.position.set(
          localX * Math.cos(angle),
          localX * Math.sin(angle),
          beam.position.z + (beamThickness * 0.46) + (spike.geometry.parameters.height * 0.5)
        );
        spike.rotation.y = THREE.MathUtils.degToRad(90);
        spike.rotation.z = angle;
        group.add(spike);
      }
    }

    const strap = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(0.9, beamLength * 0.36), Math.max(0.08, beamThickness * 0.15), 10, 28),
      accentMaterial
    );
    strap.position.set(0, 0, Math.max(0.8, sz * 0.3));
    strap.rotation.x = THREE.MathUtils.degToRad(88);
    group.add(strap);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), bodyMaterial);
    body.position.set(0, 0, sz * 0.5);
    group.add(body);

    const topBand = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(1.2, sx * 0.88), Math.max(0.6, sy * 0.88), Math.max(0.22, sz * 0.12)),
      accentMaterial
    );
    topBand.position.set(0, 0, sz * 0.94);
    group.add(topBand);
  }

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(maxSpan * 0.7, maxSpan * 0.78, Math.max(0.4, maxSpan * 0.08), 24),
    new THREE.MeshStandardMaterial({
      color: isBattleTone ? 0x1f2937 : 0x253243,
      roughness: 0.88,
      metalness: 0.08
    })
  );
  base.position.set(0, 0, Math.max(0.2, maxSpan * 0.04));
  group.add(base);

  group.userData = {
    radius: maxSpan,
    focusZ: Math.max(1.2, sz * 0.5)
  };
  return group;
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
