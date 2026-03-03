import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  createBattleGlContext,
  resizeCanvasToDisplaySize
} from '../../../game/battle/presentation/render/WebGL2Context';
import ImpostorRenderer, { UNIT_INSTANCE_STRIDE } from '../../../game/battle/presentation/render/ImpostorRenderer';
import createBattleProceduralTextures from '../../../game/battle/presentation/assets/ProceduralTextures';

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

const colorFromHex = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return fallback;
  return Number.parseInt(text, 16);
};

const buildCloseupMesh = (unit = {}) => {
  const group = new THREE.Group();
  const palette = unit?.visuals?.preview?.palette || {};
  const primary = new THREE.MeshStandardMaterial({ color: colorFromHex(palette.primary, 0x5aa3ff), roughness: 0.38, metalness: 0.18 });
  const secondary = new THREE.MeshStandardMaterial({ color: colorFromHex(palette.secondary, 0xcfd8e3), roughness: 0.58, metalness: 0.08 });
  const accent = new THREE.MeshStandardMaterial({ color: colorFromHex(palette.accent, 0xffd166), roughness: 0.32, metalness: 0.24 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(4.6, 8.8, 6, 10), primary);
  body.position.set(0, 0, 8.2);
  group.add(body);

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(7.5, 2.8, 2), secondary);
  shoulder.position.set(0, 0, 11.4);
  group.add(shoulder);

  const weaponLength = 8 + Math.min(10, Number(unit?.range) || 1);
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(1.1, weaponLength, 1.1), accent);
  weapon.position.set(4.5, 0, 8.6);
  weapon.rotation.z = Math.PI * 0.4;
  group.add(weapon);

  const vehicle = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 8.2, 2.2, 20), secondary);
  vehicle.position.set(0, 0, 2.1);
  group.add(vehicle);

  return {
    group,
    materials: [primary, secondary, accent]
  };
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

    const { group, materials } = buildCloseupMesh(unit);
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
      group.rotation.y = (rotationRef.current * Math.PI) / 180;
      renderer.render(scene, camera);
    };
    renderFrame();

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      materials.forEach((mat) => mat.dispose());
      group.traverse((node) => {
        if (node?.geometry && typeof node.geometry.dispose === 'function') node.geometry.dispose();
      });
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

const buildCameraState = (width, height) => {
  const camera = new THREE.PerspectiveCamera(44, Math.max(0.2, width / Math.max(1, height)), 0.1, 600);
  camera.position.set(0, -58, 32);
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
      snapshot.data[4] = (rotationRef.current * Math.PI) / 180;
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
      renderer.updateFromSnapshot(snapshot);
      const cameraState = buildCameraState(Math.max(1, gl.drawingBufferWidth), Math.max(1, gl.drawingBufferHeight));
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
