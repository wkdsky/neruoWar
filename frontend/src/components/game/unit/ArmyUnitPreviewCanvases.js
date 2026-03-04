import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  createBattleGlContext,
  resizeCanvasToDisplaySize
} from '../../../game/battle/presentation/render/WebGL2Context';
import ImpostorRenderer, { UNIT_INSTANCE_STRIDE } from '../../../game/battle/presentation/render/ImpostorRenderer';
import createBattleProceduralTextures, {
  resolveTopLayer
} from '../../../game/battle/presentation/assets/ProceduralTextures';

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

const colorFromHex = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return fallback;
  return Number.parseInt(text, 16);
};

const CLOSEUP_GEOMETRY_CACHE = {
  body: new THREE.SphereGeometry(5.8, 28, 20),
  helmet: new THREE.SphereGeometry(4.45, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
  weapon: new THREE.BoxGeometry(0.95, 10.6, 0.95),
  stripe: new THREE.TorusGeometry(3.85, 0.38, 12, 40, Math.PI * 1.28),
  base: new THREE.CylinderGeometry(7.2, 8.4, 2.4, 28)
};

const CLOSEUP_MATERIAL_CACHE = new Map();

const getCloseupMaterials = (unit = {}) => {
  const palette = unit?.visuals?.preview?.palette || {};
  const key = `${palette.primary || ''}|${palette.secondary || ''}|${palette.accent || ''}`;
  if (CLOSEUP_MATERIAL_CACHE.has(key)) return CLOSEUP_MATERIAL_CACHE.get(key);
  const materials = {
    primary: new THREE.MeshStandardMaterial({
      color: colorFromHex(palette.primary, 0x5aa3ff),
      roughness: 0.36,
      metalness: 0.12
    }),
    secondary: new THREE.MeshStandardMaterial({
      color: colorFromHex(palette.secondary, 0xcfd8e3),
      roughness: 0.52,
      metalness: 0.1
    }),
    accent: new THREE.MeshStandardMaterial({
      color: colorFromHex(palette.accent, 0xffd166),
      roughness: 0.28,
      metalness: 0.22
    })
  };
  CLOSEUP_MATERIAL_CACHE.set(key, materials);
  return materials;
};

const buildCloseupMesh = (unit = {}) => {
  const group = new THREE.Group();
  const materials = getCloseupMaterials(unit);

  const body = new THREE.Mesh(CLOSEUP_GEOMETRY_CACHE.body, materials.primary);
  body.position.set(0, 0, 8.6);
  group.add(body);

  const helmet = new THREE.Mesh(CLOSEUP_GEOMETRY_CACHE.helmet, materials.secondary);
  helmet.position.set(0, 0, 12.1);
  helmet.rotation.x = Math.PI * 0.04;
  group.add(helmet);

  const weapon = new THREE.Mesh(CLOSEUP_GEOMETRY_CACHE.weapon, materials.accent);
  weapon.position.set(4.7, 0.5, 8.4);
  weapon.rotation.z = Math.PI * 0.42;
  weapon.rotation.y = Math.PI * 0.04;
  group.add(weapon);

  const stripe = new THREE.Mesh(CLOSEUP_GEOMETRY_CACHE.stripe, materials.accent);
  stripe.position.set(0.15, 0.25, 8.25);
  stripe.rotation.z = Math.PI * 0.45;
  stripe.rotation.x = Math.PI * 0.26;
  group.add(stripe);

  const base = new THREE.Mesh(CLOSEUP_GEOMETRY_CACHE.base, materials.secondary);
  base.position.set(0, 0, 1.2);
  group.add(base);

  return group;
};

export const ArmyCloseupThreePreview = ({ unit, rotationDeg = 0, className = '' }) => {
  const canvasRef = useRef(null);
  const rotationRef = useRef(0);
  rotationRef.current = Number(rotationDeg) || 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(canvas.clientWidth || 320, canvas.clientHeight || 220, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, Math.max(0.2, (canvas.clientWidth || 320) / Math.max(1, canvas.clientHeight || 220)), 0.1, 800);
    camera.position.set(0, -46, 26);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 8);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x4b5563, 1.05);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff7ed, 0.8);
    key.position.set(18, -18, 26);
    scene.add(key);

    const turntable = new THREE.Mesh(
      new THREE.CylinderGeometry(15.6, 16.4, 2.2, 40),
      new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.86, metalness: 0.12 })
    );
    turntable.position.set(0, 0, 0.6);
    scene.add(turntable);

    const group = buildCloseupMesh(unit);
    scene.add(group);

    let raf = 0;
    const renderFrame = () => {
      raf = requestAnimationFrame(renderFrame);
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 220;
      if (canvas.width !== w || canvas.height !== h) {
        renderer.setSize(w, h, false);
        camera.aspect = Math.max(0.2, w / Math.max(1, h));
        camera.updateProjectionMatrix();
      }
      group.rotation.z = (rotationRef.current * Math.PI) / 180;
      renderer.render(scene, camera);
    };
    renderFrame();

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      turntable.geometry.dispose();
      turntable.material.dispose();
    };
  }, [unit]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
};

const buildCameraState = (width, height, orbitDeg = 0) => {
  const camera = new THREE.PerspectiveCamera(44, Math.max(0.2, width / Math.max(1, height)), 0.1, 600);
  const orbitRad = (Number(orbitDeg) || 0) * (Math.PI / 180);
  const orbitRadius = 58;
  camera.position.set(
    Math.sin(orbitRad) * orbitRadius,
    -Math.cos(orbitRad) * orbitRadius,
    32
  );
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 8);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const right = new THREE.Vector3();
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  return {
    viewProjection: viewProjection.elements.slice(0),
    cameraRight: [right.x, right.y, right.z]
  };
};

export const ArmyBattleImpostorPreview = ({ unit, rotationDeg = 0, className = '' }) => {
  const canvasRef = useRef(null);
  const rotationRef = useRef(0);
  const unitRef = useRef(unit || null);
  rotationRef.current = Number(rotationDeg) || 0;
  unitRef.current = unit || null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const gl = createBattleGlContext(canvas);
    if (!gl) return undefined;
    const renderer = new ImpostorRenderer(gl, { maxSlices: 64, textureSize: 64 });
    const proceduralTextures = createBattleProceduralTextures(gl);
    renderer.setTextureArray(proceduralTextures?.unitTexArray || null, proceduralTextures?.unitTexLayerCount || 64);

    const snapshot = {
      count: 1,
      data: new Float32Array(UNIT_INSTANCE_STRIDE)
    };

    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      resizeCanvasToDisplaySize(canvas, gl);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      const safeUnit = unitRef.current || {};
      const battleVisual = safeUnit?.visuals?.battle || {};
      snapshot.data[0] = 0;
      snapshot.data[1] = 0;
      snapshot.data[2] = 0;
      snapshot.data[3] = 8.4;
      snapshot.data[4] = 0;
      snapshot.data[5] = 0;
      snapshot.data[6] = 1;
      snapshot.data[7] = Number(battleVisual.bodyLayer) || 0;
      snapshot.data[8] = Number(battleVisual.gearLayer) || 0;
      snapshot.data[9] = Number(battleVisual.vehicleLayer) || 0;
      snapshot.data[10] = Number(battleVisual.silhouetteLayer) || 0;
      snapshot.data[11] = clamp01((Number(battleVisual.tint) || 1) / 1.2);
      snapshot.data[12] = 1;
      snapshot.data[13] = 1;
      snapshot.data[14] = 0;
      snapshot.data[15] = 0;
      const frontLayer = Number(battleVisual.spriteFrontLayer ?? battleVisual.bodyLayer) || 0;
      const bodyTopLayer = Number.isFinite(Number(battleVisual.spriteTopLayer))
        ? Math.max(0, Math.floor(Number(battleVisual.spriteTopLayer)))
        : resolveTopLayer(frontLayer);
      snapshot.data[16] = bodyTopLayer;
      snapshot.data[17] = resolveTopLayer(Number(battleVisual.gearLayer) || 0);
      snapshot.data[18] = resolveTopLayer(Number(battleVisual.vehicleLayer) || 0);
      snapshot.data[19] = resolveTopLayer(Number(battleVisual.silhouetteLayer) || 0);
      renderer.updateFromSnapshot(snapshot);
      const cameraState = buildCameraState(
        Math.max(1, gl.drawingBufferWidth),
        Math.max(1, gl.drawingBufferHeight),
        -rotationRef.current
      );
      renderer.render(cameraState, 0.2);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      if (proceduralTextures?.dispose) proceduralTextures.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
};
