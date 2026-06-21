import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Move, Trash2 } from 'lucide-react';
import { UNIT_CLASS_META, resolveUnitClassMeta } from './unitClassMeta';

const CELL_SIZE = 10;
const TILE_BASE_HEIGHT = 0.72;
const TILE_TOP_HEIGHT = 0.18;
const TILE_TOP_Z = TILE_BASE_HEIGHT + TILE_TOP_HEIGHT;
const TILE_SIZE = CELL_SIZE * 0.96;
const TILE_TOP_SIZE = CELL_SIZE * 0.86;
const UNIT_MARKER_Z = TILE_TOP_Z + 0.24;
const OCCUPANCY_OUTLINE_THICKNESS = 0.52;
const FORMATION_MARGIN_CELLS = 1;
const MIN_FORMATION_SPAN = 5;
const DRAG_SELECT_THRESHOLD_PX = 5;

export const ARMY_FORMATION_MAX_CELLS = 100;

export { UNIT_CLASS_META, resolveUnitClassMeta };

const createPlacementId = () => `slot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const normalizeFormationPlacements = (placements = []) => {
  const out = [];
  const occupied = new Set();
  (Array.isArray(placements) ? placements : []).forEach((placement, index) => {
    const unitTypeId = typeof placement?.unitTypeId === 'string' ? placement.unitTypeId.trim() : '';
    if (!unitTypeId || out.length >= ARMY_FORMATION_MAX_CELLS) return;
    const x = Math.max(-999, Math.min(999, Math.floor(Number(placement?.x) || 0)));
    const y = Math.max(-999, Math.min(999, Math.floor(Number(placement?.y) || 0)));
    const key = `${x}:${y}`;
    if (occupied.has(key)) return;
    occupied.add(key);
    out.push({
      id: typeof placement?.id === 'string' && placement.id ? placement.id : `slot_${index + 1}`,
      unitTypeId,
      x,
      y
    });
  });
  return out;
};

export const expandUnitsToFormationPlacements = (units = []) => {
  const placements = [];
  let cursor = 0;
  (Array.isArray(units) ? units : []).forEach((entry) => {
    const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
    if (!unitTypeId || count <= 0) return;
    for (let i = 0; i < count && cursor < ARMY_FORMATION_MAX_CELLS; i += 1) {
      const row = Math.floor(cursor / 10);
      placements.push({
        id: createPlacementId(),
        unitTypeId,
        x: (cursor % 10) - 4,
        y: row - 4
      });
      cursor += 1;
    }
  });
  return placements;
};

export const formationPlacementsToUnits = (placements = []) => {
  const counts = new Map();
  normalizeFormationPlacements(placements).forEach((placement) => {
    counts.set(placement.unitTypeId, (counts.get(placement.unitTypeId) || 0) + 1);
  });
  return Array.from(counts.entries()).map(([unitTypeId, count]) => ({ unitTypeId, count }));
};

const disposeOwnedThreeNode = (node) => {
  if (!node) return;
  if (node.userData?.disposeGeometryOnClear && node.geometry?.dispose) node.geometry.dispose();
  const disposeMaterial = (material) => {
    if (!material) return;
    if (material.userData?.disposeTextureOnClear?.dispose) {
      material.userData.disposeTextureOnClear.dispose();
    }
    material.dispose?.();
  };
  if (!node.userData?.disposeMaterialOnClear) return;
  if (Array.isArray(node.material)) {
    node.material.forEach((mat) => disposeMaterial(mat));
  } else {
    disposeMaterial(node.material);
  }
};

const clearGroup = (group, dispose = false) => {
  if (!group) return;
  while (group.children.length > 0) {
    const child = group.children[group.children.length - 1];
    group.remove(child);
    if (dispose) {
      child.traverse((node) => disposeOwnedThreeNode(node));
    }
  }
};

const gridToWorld = (x, y) => ({
  x: x * CELL_SIZE,
  y: -y * CELL_SIZE
});

const worldToGrid = (point) => ({
  x: Math.round((Number(point?.x) || 0) / CELL_SIZE),
  y: Math.round(-((Number(point?.y) || 0) / CELL_SIZE))
});

const getCellKey = (cell) => (
  cell ? `${Math.floor(Number(cell.x) || 0)}:${Math.floor(Number(cell.y) || 0)}` : ''
);

const clonePlacement = (placement = {}) => ({
  id: typeof placement.id === 'string' && placement.id ? placement.id : createPlacementId(),
  unitTypeId: typeof placement.unitTypeId === 'string' ? placement.unitTypeId.trim() : '',
  x: Math.floor(Number(placement.x) || 0),
  y: Math.floor(Number(placement.y) || 0)
});

const clonePlacements = (placements = []) => (
  normalizeFormationPlacements(placements).map((placement) => clonePlacement(placement))
);

const buildPlacementIndex = (placements = []) => {
  const normalized = clonePlacements(placements);
  const byCell = new Map();
  const countByUnit = new Map();
  normalized.forEach((placement, index) => {
    byCell.set(getCellKey(placement), { placement, index });
    countByUnit.set(placement.unitTypeId, (countByUnit.get(placement.unitTypeId) || 0) + 1);
  });
  return { placements: normalized, byCell, countByUnit };
};

const refreshPlacementIndex = (indexState) => {
  if (!indexState) return indexState;
  indexState.byCell.clear();
  indexState.countByUnit.clear();
  indexState.placements.forEach((placement, index) => {
    indexState.byCell.set(getCellKey(placement), { placement, index });
    indexState.countByUnit.set(placement.unitTypeId, (indexState.countByUnit.get(placement.unitTypeId) || 0) + 1);
  });
  return indexState;
};

const normalizePlacementIds = (ids = []) => (
  Array.from(new Set((Array.isArray(ids) ? ids : [ids])
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean)))
);

const getCanvasPointFromEvent = (event, canvas) => {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
};

const buildMarqueeRect = (start, end) => {
  if (!start || !end) return null;
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    left,
    top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y)
  };
};

export const getFormationOccupancyMetrics = (placements = []) => {
  const normalized = normalizeFormationPlacements(placements);
  if (normalized.length <= 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, count: 0 };
  }
  const xs = normalized.map((placement) => placement.x);
  const ys = normalized.map((placement) => placement.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    count: normalized.length
  };
};

export const getFormationBounds = (placements = []) => {
  const metrics = getFormationOccupancyMetrics(placements);
  if (metrics.count <= 0) {
    const half = Math.floor(MIN_FORMATION_SPAN / 2);
    return { minX: -half, maxX: half, minY: -half, maxY: half };
  }
  let minX = metrics.minX - FORMATION_MARGIN_CELLS;
  let maxX = metrics.maxX + FORMATION_MARGIN_CELLS;
  let minY = metrics.minY - FORMATION_MARGIN_CELLS;
  let maxY = metrics.maxY + FORMATION_MARGIN_CELLS;
  const expandAxis = (min, max) => {
    const span = max - min + 1;
    if (span >= MIN_FORMATION_SPAN) return [min, max];
    const missing = MIN_FORMATION_SPAN - span;
    return [min - Math.floor(missing / 2), max + Math.ceil(missing / 2)];
  };
  [minX, maxX] = expandAxis(minX, maxX);
  [minY, maxY] = expandAxis(minY, maxY);
  return { minX, maxX, minY, maxY };
};

export const resolveFormationMovePreview = (placements = [], placementIds = [], cell = null) => {
  const normalized = normalizeFormationPlacements(placements);
  const selectedIdSet = new Set(normalizePlacementIds(placementIds));
  const selected = normalized.filter((placement) => selectedIdSet.has(placement.id));
  if (normalized.length <= 0 || selected.length <= 0 || !cell) {
    return { placements: [], blocked: false, allSelected: false };
  }
  const allSelected = selected.length === normalized.length;
  const metrics = getFormationOccupancyMetrics(selected);
  const targetMinX = allSelected
    ? metrics.minX
    : Math.floor(Number(cell.x) || 0);
  const targetMinY = allSelected
    ? metrics.minY
    : Math.floor(Number(cell.y) || 0);
  const movedPlacements = selected.map((placement) => ({
    ...placement,
    x: targetMinX + (placement.x - metrics.minX),
    y: targetMinY + (placement.y - metrics.minY)
  }));
  const occupiedByUnselected = new Set(
    normalized
      .filter((placement) => !selectedIdSet.has(placement.id))
      .map((placement) => `${placement.x}:${placement.y}`)
  );
  const blocked = movedPlacements.some((placement) => occupiedByUnselected.has(`${placement.x}:${placement.y}`));
  return { placements: movedPlacements, blocked, allSelected };
};

const getUnitTier = (unit = {}) => (
  Math.max(1, Math.min(4, Math.floor(Number(unit?.tier ?? unit?.level) || 1)))
);

const resolveUnitTileColor = (unit = {}) => {
  const meta = resolveUnitClassMeta(unit);
  const color = new THREE.Color(meta.color);
  const tier = getUnitTier(unit);
  color.offsetHSL(0, 0.025 * (tier - 1), -0.055 * (tier - 1));
  return color;
};

const markOwnedMesh = (mesh) => {
  mesh.userData.disposeGeometryOnClear = true;
  mesh.userData.disposeMaterialOnClear = true;
  return mesh;
};

const markOwnedMaterialMesh = (mesh) => {
  mesh.userData.disposeMaterialOnClear = true;
  return mesh;
};

const SHARED_GEOMETRIES = {
  tileBase: new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_BASE_HEIGHT),
  tileTop: new THREE.BoxGeometry(TILE_TOP_SIZE, TILE_TOP_SIZE, TILE_TOP_HEIGHT),
  tileHighlight: new THREE.BoxGeometry(TILE_TOP_SIZE * 0.72, 0.16, 0.035),
  unitBase: new THREE.CylinderGeometry(2.9, 3.25, 0.72, 24),
  unitBody: new THREE.CylinderGeometry(1.62, 1.96, 3.15, 18),
  unitHead: new THREE.SphereGeometry(1.14, 18, 12),
  archerBow: new THREE.TorusGeometry(2.05, 0.16, 8, 36, Math.PI * 1.28),
  archerString: new THREE.BoxGeometry(0.16, 3.8, 0.16),
  cavalryCone: new THREE.ConeGeometry(1.15, 2.8, 4),
  cavalryLine: new THREE.BoxGeometry(4.8, 0.42, 0.36),
  artilleryTube: new THREE.CylinderGeometry(0.42, 0.5, 4.5, 14),
  artilleryWheel: new THREE.SphereGeometry(0.62, 12, 8),
  infantryShield: new THREE.CylinderGeometry(1.18, 1.18, 0.34, 24),
  infantrySpear: new THREE.BoxGeometry(0.24, 4.4, 0.24),
  selectedRing: new THREE.TorusGeometry(3.92, 0.22, 10, 44)
};

const createUnitLabelTexture = (label = '', color = '#ffffff') => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(2, 6, 23, 0.58)';
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(64, 64, 47, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 58px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(label || '').slice(0, 2), 64, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

const labelTextureCache = new Map();
const getCachedUnitLabelTexture = (label = '', color = '#ffffff') => {
  const key = `${String(label || '').slice(0, 2)}:${color}`;
  if (labelTextureCache.has(key)) return labelTextureCache.get(key);
  const texture = createUnitLabelTexture(label, color);
  if (texture) labelTextureCache.set(key, texture);
  return texture;
};

const createOwnedMaterial = (MaterialClass, params = {}) => {
  const material = new MaterialClass(params);
  material.userData.disposeMaterialOnClear = true;
  return material;
};

const addOwnedMesh = (group, geometry, material, configure = null) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.disposeGeometryOnClear = true;
  mesh.userData.disposeMaterialOnClear = true;
  if (typeof configure === 'function') configure(mesh);
  group.add(mesh);
  return mesh;
};

const addSharedGeometryMesh = (group, geometry, material, configure = null) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.disposeMaterialOnClear = true;
  if (typeof configure === 'function') configure(mesh);
  group.add(mesh);
  return mesh;
};

const addUnitLabel = (group, meta, ghost = false, invalid = false) => {
  const texture = getCachedUnitLabelTexture(meta.mark || meta.label || '?', invalid ? '#ef4444' : meta.color);
  if (!texture) return;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: ghost ? 0.68 : 0.96,
    depthWrite: false
  });
  material.userData.disposeMaterialOnClear = true;
  const sprite = new THREE.Sprite(material);
  sprite.userData.disposeMaterialOnClear = true;
  sprite.scale.set(5.8, 5.8, 1);
  sprite.position.set(0, 0, 7.6);
  group.add(sprite);
};

const applyGhostMaterial = (material, ghost = false, invalid = false) => {
  if (!material || !ghost) return material;
  material.transparent = true;
  material.opacity = invalid ? 0.36 : 0.56;
  material.depthWrite = false;
  return material;
};

const buildFormationUnitMarker = ({ unit, ghost = false, invalid = false }) => {
  const meta = resolveUnitClassMeta(unit);
  const baseColor = invalid ? new THREE.Color('#ef4444') : resolveUnitTileColor(unit);
  const darkColor = baseColor.clone().multiplyScalar(0.42);
  const lightColor = baseColor.clone().offsetHSL(0, -0.04, 0.18);
  const classTag = meta.key || 'infantry';
  const group = new THREE.Group();
  group.userData.unitClass = classTag;

  const baseMaterial = applyGhostMaterial(createOwnedMaterial(THREE.MeshStandardMaterial, {
    color: darkColor,
    roughness: 0.82,
    metalness: 0.08
  }), ghost, invalid);
  addSharedGeometryMesh(group, SHARED_GEOMETRIES.unitBase, baseMaterial, (mesh) => {
    mesh.position.z = 0.36;
  });

  const bodyMaterial = applyGhostMaterial(createOwnedMaterial(THREE.MeshStandardMaterial, {
    color: baseColor,
    roughness: 0.54,
    metalness: 0.12
  }), ghost, invalid);
  addSharedGeometryMesh(group, SHARED_GEOMETRIES.unitBody, bodyMaterial, (mesh) => {
    mesh.position.z = 2.45;
  });

  const headMaterial = applyGhostMaterial(createOwnedMaterial(THREE.MeshStandardMaterial, {
    color: lightColor,
    roughness: 0.42,
    metalness: 0.08
  }), ghost, invalid);
  addSharedGeometryMesh(group, SHARED_GEOMETRIES.unitHead, headMaterial, (mesh) => {
    mesh.position.z = 4.55;
    mesh.scale.z = 0.88;
  });

  const accentMaterial = applyGhostMaterial(createOwnedMaterial(THREE.MeshStandardMaterial, {
    color: invalid ? 0xffc4c4 : 0xfef3c7,
    roughness: 0.45,
    metalness: 0.22
  }), ghost, invalid);
  const lineMaterial = applyGhostMaterial(createOwnedMaterial(THREE.MeshBasicMaterial, {
    color: invalid ? 0xffc4c4 : 0xf8fafc
  }), ghost, invalid);

  if (classTag === 'archer') {
    addSharedGeometryMesh(group, SHARED_GEOMETRIES.archerBow, accentMaterial, (mesh) => {
      mesh.position.set(1.1, -0.35, 3.3);
      mesh.rotation.set(Math.PI * 0.54, 0.1, Math.PI * 0.15);
      mesh.scale.set(0.76, 1, 1);
    });
    addSharedGeometryMesh(group, SHARED_GEOMETRIES.archerString, lineMaterial, (mesh) => {
      mesh.position.set(1.38, -0.35, 3.28);
      mesh.rotation.z = Math.PI * 0.06;
    });
  } else if (classTag === 'cavalry') {
    addSharedGeometryMesh(group, SHARED_GEOMETRIES.cavalryCone, accentMaterial, (mesh) => {
      mesh.position.set(-0.1, 0.1, 5.4);
      mesh.rotation.z = Math.PI * 0.25;
    });
    addSharedGeometryMesh(group, SHARED_GEOMETRIES.cavalryLine, lineMaterial, (mesh) => {
      mesh.position.set(0, 0, 1.42);
      mesh.rotation.z = Math.PI * 0.04;
    });
  } else if (classTag === 'artillery') {
    addSharedGeometryMesh(group, SHARED_GEOMETRIES.artilleryTube, accentMaterial, (mesh) => {
      mesh.position.set(1.25, 0, 3.1);
      mesh.rotation.y = Math.PI * 0.5;
      mesh.rotation.z = Math.PI * 0.04;
    });
    addSharedGeometryMesh(group, SHARED_GEOMETRIES.artilleryWheel, lineMaterial, (mesh) => {
      mesh.position.set(-1.7, -1.25, 1.04);
    });
    addSharedGeometryMesh(group, SHARED_GEOMETRIES.artilleryWheel, lineMaterial, (mesh) => {
      mesh.position.set(-1.7, 1.25, 1.04);
    });
  } else {
    addSharedGeometryMesh(group, SHARED_GEOMETRIES.infantryShield, accentMaterial, (mesh) => {
      mesh.position.set(-1.45, -0.34, 3.15);
      mesh.rotation.x = Math.PI * 0.5;
      mesh.scale.set(1, 0.7, 1);
    });
    addSharedGeometryMesh(group, SHARED_GEOMETRIES.infantrySpear, lineMaterial, (mesh) => {
      mesh.position.set(1.48, 0.18, 3.24);
      mesh.rotation.z = Math.PI * 0.12;
    });
  }

  addUnitLabel(group, meta, ghost, invalid);
  return group;
};

const buildPlacementTile = ({ placement, unit, ghost = false, invalid = false }) => {
  const world = gridToWorld(placement.x, placement.y);
  const color = invalid ? new THREE.Color('#ef4444') : resolveUnitTileColor(unit);
  const baseColor = color.clone().multiplyScalar(0.54);
  const group = new THREE.Group();
  group.userData.placementId = placement.id;

  const base = markOwnedMaterialMesh(new THREE.Mesh(
    SHARED_GEOMETRIES.tileBase,
    new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.58,
      metalness: 0.12,
      transparent: ghost,
      opacity: ghost ? 0.45 : 1
    })
  ));
  base.position.set(world.x, world.y, TILE_BASE_HEIGHT * 0.5);
  group.add(base);

  const top = markOwnedMaterialMesh(new THREE.Mesh(
    SHARED_GEOMETRIES.tileTop,
    new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.18),
      roughness: 0.46,
      metalness: 0.1,
      transparent: ghost,
      opacity: ghost ? 0.58 : 1
    })
  ));
  top.position.set(world.x, world.y, TILE_BASE_HEIGHT + (TILE_TOP_HEIGHT * 0.5));
  group.add(top);

  const highlight = markOwnedMaterialMesh(new THREE.Mesh(
    SHARED_GEOMETRIES.tileHighlight,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: ghost ? 0.24 : 0.18,
      depthWrite: false
    })
  ));
  highlight.position.set(
    world.x - (TILE_TOP_SIZE * 0.08),
    world.y + (TILE_TOP_SIZE * 0.32),
    TILE_TOP_Z + 0.025
  );
  group.add(highlight);

  return group;
};

const createBoundaryStrip = ({ x, y, width, height, opacity = 0.86, color = 0x67e8f9, z = TILE_TOP_Z + 0.18 }) => {
  const mesh = markOwnedMesh(new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.22),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false
    })
  ));
  mesh.position.set(x, y, z);
  return mesh;
};

const buildOccupancyOutline = (placements = []) => {
  const normalized = normalizeFormationPlacements(placements);
  const group = new THREE.Group();
  if (normalized.length <= 0) return group;
  const keys = new Set(normalized.map((placement) => `${placement.x}:${placement.y}`));
  const half = CELL_SIZE * 0.5;
  const addEdge = (x, y, width, height) => {
    group.add(createBoundaryStrip({
      x,
      y,
      width: width + OCCUPANCY_OUTLINE_THICKNESS,
      height: height + OCCUPANCY_OUTLINE_THICKNESS,
      opacity: 0.2,
      color: 0xa78bfa,
      z: TILE_TOP_Z + 0.12
    }));
    group.add(createBoundaryStrip({
      x,
      y,
      width,
      height,
      opacity: 0.88,
      color: 0x67e8f9,
      z: TILE_TOP_Z + 0.26
    }));
  };

  normalized.forEach((placement) => {
    const world = gridToWorld(placement.x, placement.y);
    if (!keys.has(`${placement.x - 1}:${placement.y}`)) {
      addEdge(world.x - half, world.y, OCCUPANCY_OUTLINE_THICKNESS, CELL_SIZE + OCCUPANCY_OUTLINE_THICKNESS);
    }
    if (!keys.has(`${placement.x + 1}:${placement.y}`)) {
      addEdge(world.x + half, world.y, OCCUPANCY_OUTLINE_THICKNESS, CELL_SIZE + OCCUPANCY_OUTLINE_THICKNESS);
    }
    if (!keys.has(`${placement.x}:${placement.y - 1}`)) {
      addEdge(world.x, world.y + half, CELL_SIZE + OCCUPANCY_OUTLINE_THICKNESS, OCCUPANCY_OUTLINE_THICKNESS);
    }
    if (!keys.has(`${placement.x}:${placement.y + 1}`)) {
      addEdge(world.x, world.y - half, CELL_SIZE + OCCUPANCY_OUTLINE_THICKNESS, OCCUPANCY_OUTLINE_THICKNESS);
    }
  });
  return group;
};

const buildFormationGridStage = (bounds = getFormationBounds([])) => {
  const group = new THREE.Group();
  const minX = Math.floor(Number(bounds.minX) || 0);
  const maxX = Math.floor(Number(bounds.maxX) || 0);
  const minY = Math.floor(Number(bounds.minY) || 0);
  const maxY = Math.floor(Number(bounds.maxY) || 0);
  const widthCells = Math.max(1, maxX - minX + 1);
  const heightCells = Math.max(1, maxY - minY + 1);
  const worldMin = gridToWorld(minX - 0.5, maxY + 0.5);
  const worldMax = gridToWorld(maxX + 0.5, minY - 0.5);
  const centerX = (worldMin.x + worldMax.x) * 0.5;
  const centerY = (worldMin.y + worldMax.y) * 0.5;
  const width = widthCells * CELL_SIZE;
  const height = heightCells * CELL_SIZE;

  addOwnedMesh(
    group,
    new THREE.BoxGeometry(width + 1.2, height + 1.2, 0.32),
    createOwnedMaterial(THREE.MeshStandardMaterial, {
      color: 0x071827,
      roughness: 0.94,
      metalness: 0.03
    }),
    (mesh) => {
      mesh.position.set(centerX, centerY, -0.24);
    }
  );

  const createGridMaterial = (center = false) => createOwnedMaterial(THREE.MeshBasicMaterial, {
    color: center ? 0xf8fafc : 0x1f8da8,
    transparent: true,
    opacity: center ? 0.42 : 0.34,
    depthWrite: false
  });
  const lineZ = 0.02;
  for (let x = minX; x <= maxX + 1; x += 1) {
    const edge = gridToWorld(x - 0.5, 0).x;
    addOwnedMesh(
      group,
      new THREE.BoxGeometry(0.09, height, 0.06),
      createGridMaterial(x === 1 || x === 0),
      (mesh) => {
        mesh.position.set(edge, centerY, lineZ);
      }
    );
  }
  for (let y = minY; y <= maxY + 1; y += 1) {
    const edge = gridToWorld(0, y - 0.5).y;
    addOwnedMesh(
      group,
      new THREE.BoxGeometry(width, 0.09, 0.06),
      createGridMaterial(y === 1 || y === 0),
      (mesh) => {
        mesh.position.set(centerX, edge, lineZ);
      }
    );
  }

  const createBorderMaterial = () => createOwnedMaterial(THREE.MeshBasicMaterial, {
    color: 0x67e8f9,
    transparent: true,
    opacity: 0.68,
    depthWrite: false
  });
  [
    [centerX, worldMin.y, width + 0.2, 0.22],
    [centerX, worldMax.y, width + 0.2, 0.22],
    [worldMin.x, centerY, 0.22, height + 0.2],
    [worldMax.x, centerY, 0.22, height + 0.2]
  ].forEach(([x, y, w, h]) => {
    addOwnedMesh(group, new THREE.BoxGeometry(w, h, 0.08), createBorderMaterial(), (mesh) => {
      mesh.position.set(x, y, lineZ + 0.04);
    });
  });

  return group;
};

const buildPlacementUnit = ({ placement, unit, selected = false, ghost = false, invalid = false }) => {
  const world = gridToWorld(placement.x, placement.y);
  const group = buildFormationUnitMarker({ unit, ghost, invalid });
  group.position.set(world.x, world.y, UNIT_MARKER_Z + (ghost ? 0.24 : 0));
  group.rotation.z = Math.PI * 0.04;
  group.userData.placementId = placement.id;
  group.traverse((node) => {
    node.userData.placementId = placement.id;
  });

  if (selected) {
    const ring = new THREE.Mesh(
      SHARED_GEOMETRIES.selectedRing,
      new THREE.MeshBasicMaterial({
        color: 0xfef3c7,
        transparent: true,
        opacity: 0.9,
        depthWrite: false
      })
    );
    ring.position.set(0, 0, 0.3);
    ring.rotation.x = Math.PI / 2;
    ring.userData.disposeMaterialOnClear = true;
    group.add(ring);
  }

  return group;
};

const updateCameraForBounds = (camera, canvas, bounds) => {
  if (!camera || !canvas || !bounds) return;
  const width = Math.max(1, Math.floor(canvas.clientWidth || 1));
  const height = Math.max(1, Math.floor(canvas.clientHeight || 1));
  const aspect = width / Math.max(1, height);
  const spanX = Math.max(MIN_FORMATION_SPAN, bounds.maxX - bounds.minX + 1) * CELL_SIZE;
  const spanY = Math.max(MIN_FORMATION_SPAN, bounds.maxY - bounds.minY + 1) * CELL_SIZE;
  const view = Math.max(34, Math.max(spanY * 0.58, (spanX * 0.58) / Math.max(0.45, aspect)) + CELL_SIZE * 0.25);
  const center = gridToWorld((bounds.minX + bounds.maxX) * 0.5, (bounds.minY + bounds.maxY) * 0.5);
  camera.left = -view * aspect;
  camera.right = view * aspect;
  camera.top = view;
  camera.bottom = -view;
  camera.position.set(center.x, center.y - 118, 132);
  camera.lookAt(center.x, center.y + 4, 0);
  camera.updateProjectionMatrix();
};

const ArmyFormationThreeEditor = ({
  unitTypes = [],
  placements = [],
  selectedUnitTypeId = '',
  selectedPlacementId = '',
  selectedPlacementIds = [],
  isMoveSelectionMode = false,
  onPlaceUnit,
  onChangePlacements,
  onMovePlacement,
  onSelectPlacement,
  onSelectPlacements,
  onCancelAction,
  onBeginMoveSelection,
  onDeleteSelection,
  onMoveSelectionToCell,
  className = '',
  canPlaceUnit,
  unitBasis = []
}) => {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const groupsRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const hoverCellRef = useRef(null);
  const boundsRef = useRef(getFormationBounds([]));
  const dragSelectionRef = useRef(null);
  const placementDragRef = useRef(null);
  const requestRenderRef = useRef(() => {});
  const [marqueeRect, setMarqueeRect] = useState(null);
  const [selectionUi, setSelectionUi] = useState(null);
  const [rendererError, setRendererError] = useState('');
  const propsRef = useRef({
    unitTypes,
    placements,
    selectedUnitTypeId,
    selectedPlacementId,
    selectedPlacementIds,
    isMoveSelectionMode,
    onPlaceUnit,
    onChangePlacements,
    onMovePlacement,
    onSelectPlacement,
    onSelectPlacements,
    onCancelAction,
    onBeginMoveSelection,
    onDeleteSelection,
    onMoveSelectionToCell,
    canPlaceUnit,
    unitBasis
  });

  propsRef.current = {
    unitTypes,
    placements,
    selectedUnitTypeId,
    selectedPlacementId,
    selectedPlacementIds,
    isMoveSelectionMode,
    onPlaceUnit,
    onChangePlacements,
    onMovePlacement,
    onSelectPlacement,
    onSelectPlacements,
    onCancelAction,
    onBeginMoveSelection,
    onDeleteSelection,
    onMoveSelectionToCell,
    canPlaceUnit,
    unitBasis
  };

  const unitLimitMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(unitBasis) ? unitBasis : []).forEach((entry) => {
      const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
      if (!unitTypeId) return;
      map.set(unitTypeId, Math.max(0, Math.floor(Number(entry?.basis) || Number(entry?.count) || 0)));
    });
    return map;
  }, [unitBasis]);

  const unitMap = useMemo(() => (
    new Map(
      (Array.isArray(unitTypes) ? unitTypes : [])
        .map((unit) => [unit.unitTypeId || unit.id, unit])
        .filter(([unitTypeId]) => unitTypeId)
    )
  ), [unitTypes]);

  const normalizedSelectedPlacementIds = useMemo(() => {
    const ids = normalizePlacementIds(selectedPlacementIds);
    if (ids.length > 0) return ids;
    return normalizePlacementIds(selectedPlacementId);
  }, [selectedPlacementId, selectedPlacementIds]);

  const selectedPlacementIdSet = useMemo(
    () => new Set(normalizedSelectedPlacementIds),
    [normalizedSelectedPlacementIds]
  );

  const projectWorldToCanvas = useCallback((point) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera || !point) return null;
    const width = Math.max(1, canvas.clientWidth || 1);
    const height = Math.max(1, canvas.clientHeight || 1);
    const projected = point.clone().project(camera);
    return {
      x: ((projected.x + 1) * 0.5) * width,
      y: ((1 - projected.y) * 0.5) * height
    };
  }, []);

  const resolveSelectionScreenRect = useCallback((placementIds = []) => {
    const safeIds = normalizePlacementIds(placementIds);
    if (safeIds.length <= 0) return null;
    const selectedIds = new Set(safeIds);
    const selected = normalizeFormationPlacements(propsRef.current.placements)
      .filter((placement) => selectedIds.has(placement.id));
    if (selected.length <= 0) return null;
    const points = [];
    selected.forEach((placement) => {
      const center = gridToWorld(placement.x, placement.y);
      const half = CELL_SIZE * 0.5;
      [
        [center.x - half, center.y - half],
        [center.x + half, center.y - half],
        [center.x + half, center.y + half],
        [center.x - half, center.y + half]
      ].forEach(([x, y]) => {
        const point = projectWorldToCanvas(new THREE.Vector3(x, y, TILE_TOP_Z + 1.8));
        if (point) points.push(point);
      });
    });
    if (points.length <= 0) return null;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
      centerX: (left + right) * 0.5,
      count: selected.length
    };
  }, [projectWorldToCanvas]);

  const syncSelectionUi = useCallback(() => {
    const current = propsRef.current;
    const ids = normalizePlacementIds(current.selectedPlacementIds);
    const fallbackIds = ids.length > 0 ? ids : normalizePlacementIds(current.selectedPlacementId);
    setSelectionUi(resolveSelectionScreenRect(fallbackIds));
  }, [resolveSelectionScreenRect]);

  const resolvePlacementIdsInMarquee = useCallback((rect) => {
    if (!rect || rect.width <= DRAG_SELECT_THRESHOLD_PX || rect.height <= DRAG_SELECT_THRESHOLD_PX) return [];
    return normalizeFormationPlacements(propsRef.current.placements)
      .filter((placement) => {
        const center = gridToWorld(placement.x, placement.y);
        const point = projectWorldToCanvas(new THREE.Vector3(center.x, center.y, TILE_TOP_Z + 1.5));
        return point
          && point.x >= rect.left
          && point.x <= rect.right
          && point.y >= rect.top
          && point.y <= rect.bottom;
      })
      .map((placement) => placement.id);
  }, [projectWorldToCanvas]);

  const renderFormationScene = useCallback((nextPlacements = placements, options = {}) => {
    const groups = groupsRef.current;
    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    if (!groups) return;
    const normalized = clonePlacements(nextPlacements);
    const bounds = getFormationBounds(normalized);
    const selectedIds = options.selectedIds instanceof Set
      ? options.selectedIds
      : selectedPlacementIdSet;
    boundsRef.current = bounds;
    clearGroup(groups.floorGroup, true);
    clearGroup(groups.outlineGroup, true);
    clearGroup(groups.unitGroup, true);

    groups.floorGroup.add(buildFormationGridStage(bounds));
    normalized.forEach((placement) => {
      const unit = unitMap.get(placement.unitTypeId);
      if (!unit) return;
      groups.floorGroup.add(buildPlacementTile({
        placement,
        unit,
        ghost: false
      }));
      groups.unitGroup.add(buildPlacementUnit({
        placement,
        unit,
        selected: selectedIds.has(placement.id)
      }));
    });
    groups.outlineGroup.add(buildOccupancyOutline(normalized));
    updateCameraForBounds(camera, canvas, bounds);
    if (options.syncSelection !== false) {
      syncSelectionUi();
    }
    requestRenderRef.current();
  }, [placements, selectedPlacementIdSet, syncSelectionUi, unitMap]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let renderer = null;
    const handleContextLost = (event) => {
      event.preventDefault?.();
      setRendererError('阵型画布渲染上下文已丢失，请切换步骤或重新打开新建部队窗口');
    };
    const handleContextRestored = () => {
      setRendererError('');
    };

    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      });
    } catch (error) {
      setRendererError('阵型画布初始化失败，请切换步骤后重试');
      return () => {
        canvas.removeEventListener('webglcontextlost', handleContextLost, false);
        canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);
      };
    }
    setRendererError('');
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.setClearColor(0x020617, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-64, 64, 64, -64, 0.1, 900);
    camera.up.set(0, 0, 1);
    camera.position.set(78, -92, 88);
    camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x1e293b, 1.08);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff7ed, 0.86);
    key.position.set(42, -48, 92);
    scene.add(key);

    const floorGroup = new THREE.Group();
    const outlineGroup = new THREE.Group();
    const unitGroup = new THREE.Group();
    const ghostGroup = new THREE.Group();
    const hoverGroup = new THREE.Group();
    scene.add(floorGroup, outlineGroup, unitGroup, ghostGroup, hoverGroup);
    groupsRef.current = { floorGroup, outlineGroup, unitGroup, ghostGroup, hoverGroup };

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;

    let raf = 0;
    const renderFrame = () => {
      raf = 0;
      const width = Math.max(1, Math.floor(canvas.clientWidth || 1));
      const height = Math.max(1, Math.floor(canvas.clientHeight || 1));
      if (canvas.width !== width || canvas.height !== height) {
        renderer.setSize(width, height, false);
        updateCameraForBounds(camera, canvas, boundsRef.current);
        syncSelectionUi();
      }
      renderer.render(scene, camera);
    };
    const requestRender = () => {
      if (raf) return;
      raf = requestAnimationFrame(renderFrame);
    };
    requestRenderRef.current = requestRender;
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(requestRender);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener('resize', requestRender);
    }
    requestRender();

    return () => {
      cancelAnimationFrame(raf);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', requestRender);
      }
      requestRenderRef.current = () => {};
      clearGroup(floorGroup, true);
      clearGroup(outlineGroup, true);
      clearGroup(unitGroup, true);
      clearGroup(ghostGroup, true);
      clearGroup(hoverGroup, true);
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      groupsRef.current = null;
      canvas.removeEventListener('webglcontextlost', handleContextLost, false);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);
    };
  }, [syncSelectionUi]);

  const syncHoverVisual = useCallback((cell) => {
    const groups = groupsRef.current;
    if (!groups) return;
    clearGroup(groups.hoverGroup, true);
    clearGroup(groups.ghostGroup, true);
    if (!cell) {
      requestRenderRef.current();
      return;
    }

    const {
      selectedUnitTypeId: nextUnitTypeId,
      placements: nextPlacements,
      selectedPlacementId: currentSelectedPlacementId,
      selectedPlacementIds: currentSelectedPlacementIds,
      isMoveSelectionMode: movingSelection,
      canPlaceUnit: canPlace
    } = propsRef.current;
    if (movingSelection) {
      const moveIds = normalizePlacementIds(currentSelectedPlacementIds).length > 0
        ? currentSelectedPlacementIds
        : currentSelectedPlacementId;
      const preview = resolveFormationMovePreview(nextPlacements, moveIds, cell);
      preview.placements.forEach((placement) => {
        const unit = unitMap.get(placement.unitTypeId);
        if (!unit) return;
        groups.ghostGroup.add(buildPlacementTile({
          placement,
          unit,
          ghost: true,
          invalid: preview.blocked
        }));
        groups.ghostGroup.add(buildPlacementUnit({
          placement,
          unit,
          selected: false,
          ghost: true,
          invalid: preview.blocked
        }));
      });
      requestRenderRef.current();
      return;
    }
    const occupied = normalizeFormationPlacements(nextPlacements)
      .some((placement) => placement.x === cell.x && placement.y === cell.y);
    const unit = nextUnitTypeId ? unitMap.get(nextUnitTypeId) : null;
    const allowed = typeof canPlace === 'function' ? canPlace(nextUnitTypeId, cell) : true;
    if (unit && !occupied && allowed) {
      groups.ghostGroup.add(buildPlacementTile({
        placement: {
          id: '__ghost_tile__',
          unitTypeId: nextUnitTypeId,
          x: cell.x,
          y: cell.y
        },
        unit,
        ghost: true
      }));
      groups.ghostGroup.add(buildPlacementUnit({
        placement: {
          id: '__ghost__',
          unitTypeId: nextUnitTypeId,
          x: cell.x,
          y: cell.y
        },
        unit,
        selected: false,
        ghost: true
      }));
    }
    requestRenderRef.current();
  }, [unitMap]);

  useEffect(() => {
    renderFormationScene(placements, { selectedIds: selectedPlacementIdSet });
  }, [placements, selectedPlacementIdSet, renderFormationScene]);

  useEffect(() => {
    syncHoverVisual(hoverCellRef.current);
  }, [isMoveSelectionMode, placements, selectedPlacementId, selectedPlacementIds, selectedUnitTypeId, syncHoverVisual]);

  useEffect(() => {
    syncSelectionUi();
  }, [normalizedSelectedPlacementIds, syncSelectionUi]);

  const resolveCellFromEvent = (event) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera) return null;
    const rect = canvas.getBoundingClientRect();
    pointerRef.current.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointerRef.current.y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    raycasterRef.current.setFromCamera(pointerRef.current, camera);
    const hit = new THREE.Vector3();
    const ok = raycasterRef.current.ray.intersectPlane(planeRef.current, hit);
    if (!ok) return null;
    return worldToGrid(hit);
  };

  const tryPlaceUnit = (unitTypeId, cell) => {
    const safeUnitTypeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeUnitTypeId || !cell) return;
    const {
      placements: currentPlacements,
      onPlaceUnit: placeUnit,
      canPlaceUnit: canPlace
    } = propsRef.current;
    const normalized = normalizeFormationPlacements(currentPlacements);
    const hitPlacement = normalized.find((placement) => placement.x === cell.x && placement.y === cell.y) || null;
    if (hitPlacement) {
      placeUnit?.(safeUnitTypeId, cell);
      return;
    }
    const allowed = typeof canPlace === 'function' ? canPlace(safeUnitTypeId, cell) : true;
    if (!allowed) return;
    placeUnit?.(safeUnitTypeId, cell);
  };

  const getLocalUnitLimit = (unitTypeId) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return 0;
    if (unitLimitMap.has(safeId)) return unitLimitMap.get(safeId);
    return ARMY_FORMATION_MAX_CELLS;
  };

  const schedulePlacementDragSceneSync = useCallback((dragState) => {
    if (!dragState || dragState.syncRaf) return;
    dragState.syncRaf = requestAnimationFrame(() => {
      dragState.syncRaf = 0;
      renderFormationScene(dragState.index.placements, {
        selectedIds: new Set(),
        syncSelection: false
      });
    });
  }, [renderFormationScene]);

  const finishPlacementDrag = useCallback((dragState, options = {}) => {
    if (!dragState) return;
    if (dragState.syncRaf) {
      cancelAnimationFrame(dragState.syncRaf);
      dragState.syncRaf = 0;
    }
    clearGroup(groupsRef.current?.ghostGroup, true);
    clearGroup(groupsRef.current?.hoverGroup, true);
    const shouldCommit = options.commit !== false;
    if (!dragState.changed) {
      requestRenderRef.current();
      return;
    }
    if (!shouldCommit) {
      renderFormationScene(propsRef.current.placements, { selectedIds: selectedPlacementIdSet });
      return;
    }
    const nextPlacements = clonePlacements(dragState.index.placements);
    renderFormationScene(nextPlacements, {
      selectedIds: new Set(),
      syncSelection: false
    });
    if (typeof propsRef.current.onChangePlacements === 'function') {
      propsRef.current.onChangePlacements(nextPlacements);
      return;
    }
    renderFormationScene(propsRef.current.placements, { selectedIds: selectedPlacementIdSet });
  }, [renderFormationScene, selectedPlacementIdSet]);

  useEffect(() => {
    const clearActiveDrag = (event) => {
      const placementDragState = placementDragRef.current;
      if (placementDragState && (!event || placementDragState.pointerId === event.pointerId)) {
        placementDragRef.current = null;
        finishPlacementDrag(placementDragState, { commit: event?.type !== 'pointercancel' });
      }
      if (dragSelectionRef.current) {
        dragSelectionRef.current = null;
        setMarqueeRect(null);
      }
    };
    window.addEventListener('pointerup', clearActiveDrag);
    window.addEventListener('pointercancel', clearActiveDrag);
    return () => {
      window.removeEventListener('pointerup', clearActiveDrag);
      window.removeEventListener('pointercancel', clearActiveDrag);
    };
  }, [finishPlacementDrag]);

  const applyPlacementDragCell = (cell, dragState = placementDragRef.current) => {
    if (!dragState || !cell) return;
    const safeUnitTypeId = typeof dragState.unitTypeId === 'string' ? dragState.unitTypeId.trim() : '';
    const key = getCellKey(cell);
    if (!safeUnitTypeId || !key || dragState.visitedCells.has(key)) return;
    dragState.visitedCells.add(key);

    const hitEntry = dragState.index.byCell.get(key);
    const hitPlacement = hitEntry?.placement || null;
    if (dragState.mode === 'eraseSame') {
      if (hitPlacement?.unitTypeId === safeUnitTypeId) {
        dragState.index.placements.splice(hitEntry.index, 1);
        refreshPlacementIndex(dragState.index);
        dragState.changed = true;
        schedulePlacementDragSceneSync(dragState);
      }
      return;
    }
    if (hitPlacement?.unitTypeId === safeUnitTypeId) return;
    const currentUnitCount = dragState.index.countByUnit.get(safeUnitTypeId) || 0;
    if (currentUnitCount >= getLocalUnitLimit(safeUnitTypeId)) return;
    if (!hitPlacement && dragState.index.placements.length >= ARMY_FORMATION_MAX_CELLS) return;
    if (hitPlacement) {
      hitPlacement.unitTypeId = safeUnitTypeId;
    } else {
      dragState.index.placements.push({
        id: createPlacementId(),
        unitTypeId: safeUnitTypeId,
        x: cell.x,
        y: cell.y
      });
    }
    refreshPlacementIndex(dragState.index);
    dragState.changed = true;
    schedulePlacementDragSceneSync(dragState);
  };

  const commitPlacementSelection = (ids = [], options = {}) => {
    const current = propsRef.current;
    const safeIds = normalizePlacementIds(ids);
    const currentIds = normalizePlacementIds(current.selectedPlacementIds);
    const fallbackCurrent = currentIds.length > 0 ? currentIds : normalizePlacementIds(current.selectedPlacementId);
    const nextIds = options.additive
      ? Array.from(new Set([...fallbackCurrent, ...safeIds]))
      : safeIds;
    if (typeof current.onSelectPlacements === 'function') {
      current.onSelectPlacements(nextIds);
      return;
    }
    current.onSelectPlacement?.(nextIds[0] || '');
  };

  const handlePointerMove = (event) => {
    const cell = resolveCellFromEvent(event);
    const prev = hoverCellRef.current;
    const sameCell = prev?.x === cell?.x && prev?.y === cell?.y;

    const placementDragState = placementDragRef.current;
    if (placementDragState && placementDragState.pointerId === event.pointerId) {
      if (!sameCell) hoverCellRef.current = cell;
      if (!sameCell) applyPlacementDragCell(cell, placementDragState);
      return;
    }

    if (!sameCell) {
      hoverCellRef.current = cell;
      syncHoverVisual(cell);
    }

    const dragState = dragSelectionRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const currentPoint = getCanvasPointFromEvent(event, canvasRef.current);
    if (!currentPoint) return;
    const dx = Math.abs(currentPoint.x - dragState.startPoint.x);
    const dy = Math.abs(currentPoint.y - dragState.startPoint.y);
    if (dx > DRAG_SELECT_THRESHOLD_PX || dy > DRAG_SELECT_THRESHOLD_PX || dragState.dragging) {
      dragState.dragging = true;
      setMarqueeRect(buildMarqueeRect(dragState.startPoint, currentPoint));
    }
  };

  const handlePointerLeave = () => {
    hoverCellRef.current = null;
    if (placementDragRef.current) return;
    boundsRef.current = getFormationBounds(propsRef.current.placements);
    updateCameraForBounds(cameraRef.current, canvasRef.current, boundsRef.current);
    syncHoverVisual(null);
  };

  const handlePointerDown = (event) => {
    if (event.button === 2) {
      event.preventDefault();
      dragSelectionRef.current = null;
      if (placementDragRef.current) {
        finishPlacementDrag(placementDragRef.current, { commit: false });
      }
      placementDragRef.current = null;
      setMarqueeRect(null);
      propsRef.current.onCancelAction?.();
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    const cell = resolveCellFromEvent(event);
    if (!cell) return;
    const {
      placements: currentPlacements,
      selectedUnitTypeId: currentSelectedUnitTypeId,
      isMoveSelectionMode: movingSelection,
      onMoveSelectionToCell: moveSelectionToCell
    } = propsRef.current;
    const normalized = normalizeFormationPlacements(currentPlacements);
    const hitPlacement = normalized.find((placement) => placement.x === cell.x && placement.y === cell.y) || null;
    if (currentSelectedUnitTypeId) {
      const placementDragState = {
        pointerId: event.pointerId,
        unitTypeId: currentSelectedUnitTypeId,
        mode: hitPlacement?.unitTypeId === currentSelectedUnitTypeId ? 'eraseSame' : 'place',
        visitedCells: new Set(),
        index: buildPlacementIndex(currentPlacements),
        changed: false,
        syncRaf: 0
      };
      placementDragRef.current = placementDragState;
      dragSelectionRef.current = null;
      clearGroup(groupsRef.current?.ghostGroup, true);
      clearGroup(groupsRef.current?.hoverGroup, true);
      requestRenderRef.current();
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      applyPlacementDragCell(cell, placementDragState);
      return;
    }
    if (movingSelection) {
      moveSelectionToCell?.(cell);
      return;
    }
    const startPoint = getCanvasPointFromEvent(event, canvasRef.current);
    if (!startPoint) return;
    dragSelectionRef.current = {
      pointerId: event.pointerId,
      startPoint,
      startCell: cell,
      hitPlacement,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      dragging: false
    };
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  };

  const handlePointerUp = (event) => {
    const placementDragState = placementDragRef.current;
    if (placementDragState && placementDragState.pointerId === event.pointerId) {
      placementDragRef.current = null;
      event.currentTarget?.releasePointerCapture?.(event.pointerId);
      finishPlacementDrag(placementDragState, { commit: true });
      return;
    }

    const dragState = dragSelectionRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragSelectionRef.current = null;
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
    const currentPoint = getCanvasPointFromEvent(event, canvasRef.current);
    const rect = buildMarqueeRect(dragState.startPoint, currentPoint);
    setMarqueeRect(null);

    if (dragState.dragging) {
      commitPlacementSelection(resolvePlacementIdsInMarquee(rect), { additive: dragState.additive });
      return;
    }
    if (dragState.hitPlacement) {
      commitPlacementSelection([dragState.hitPlacement.id], { additive: dragState.additive });
      return;
    }
    commitPlacementSelection([]);
  };

  const handlePointerCancel = (event) => {
    if (placementDragRef.current?.pointerId === event.pointerId) {
      finishPlacementDrag(placementDragRef.current, { commit: false });
      placementDragRef.current = null;
    }
    if (dragSelectionRef.current?.pointerId === event.pointerId) {
      dragSelectionRef.current = null;
      setMarqueeRect(null);
    }
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const cell = resolveCellFromEvent(event);
    const unitTypeId = event.dataTransfer?.getData('application/x-army-unit-type-id')
      || event.dataTransfer?.getData('text/plain')
      || selectedUnitTypeId;
    tryPlaceUnit(unitTypeId, cell);
  };

  const showSelectionUi = Boolean(selectionUi && normalizedSelectedPlacementIds.length > 0 && !selectedUnitTypeId);
  const toolbarTop = showSelectionUi ? Math.max(12, selectionUi.top - 42) : 12;

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`${className} ${selectedUnitTypeId ? 'is-placement-mode' : ''} ${isMoveSelectionMode ? 'is-move-mode' : ''}`}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(event) => event.preventDefault()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      />
      {rendererError ? (
        <div className="army-formation-renderer-error">
          {rendererError}
        </div>
      ) : null}
      {marqueeRect ? (
        <div
          className="army-formation-marquee"
          style={{
            left: `${marqueeRect.left}px`,
            top: `${marqueeRect.top}px`,
            width: `${marqueeRect.width}px`,
            height: `${marqueeRect.height}px`
          }}
        />
      ) : null}
      {showSelectionUi ? (
        <div
          className={`army-formation-selection-frame ${isMoveSelectionMode ? 'is-moving' : ''}`}
          style={{
            left: `${selectionUi.left}px`,
            top: `${selectionUi.top}px`,
            width: `${selectionUi.width}px`,
            height: `${selectionUi.height}px`
          }}
        />
      ) : null}
      {showSelectionUi ? (
        <div
          className={`army-formation-selection-toolbar ${isMoveSelectionMode ? 'is-moving' : ''}`}
          style={{
            left: `${selectionUi.centerX}px`,
            top: `${toolbarTop}px`
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span>{selectionUi.count}</span>
          <button
            type="button"
            className={isMoveSelectionMode ? 'is-active' : ''}
            onClick={() => propsRef.current.onBeginMoveSelection?.()}
          >
            <Move size={13} aria-hidden="true" />
            移动
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={() => propsRef.current.onDeleteSelection?.()}
          >
            <Trash2 size={13} aria-hidden="true" />
            删除
          </button>
        </div>
      ) : null}
    </>
  );
};

export default ArmyFormationThreeEditor;
