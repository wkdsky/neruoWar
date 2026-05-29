import {
  CITY_CHANNEL_TOOLS,
  createCellKey
} from '../cityChannelSchema';
import {
  isTriggerMechanismTile,
  normalizeMechanismParams
} from '../cityChannelMechanismRuntime';
import { isPortalMaterial } from '../cityChannelMovePreview';
import { projectCell } from './renderer/CityChannelGeometry';
import { drawMechanicalLayers } from './cityChannelMechanicalSystems';
import {
  DOUBLE_CLICK_DISTANCE,
  DOUBLE_CLICK_MS,
  INSPECT_LIFT_DURATION,
  INSPECT_PREVIEW_SCALE,
  INSPECT_RETURN_DURATION,
  getTransmissionSurfaceRotation,
  resolveMaterialName
} from './cityChannelPhaserSceneUtils';

export const normalizeInspectableHit = (hit) => {
  if (hit?.type === 'mechanical_port') {
    return {
      type: 'tile',
      cell: hit.cell,
      panelType: hit.panelType,
      hitZone: 'base',
      tile: hit.tile
    };
  }
  return hit;
};

export const isDoubleClickMechanismHit = (scene, pointer, hit) => {
  if (!hit || hit.type !== 'tile' || isPortalMaterial(hit.panelType)) return false;
  const now = scene.time?.now || Date.now();
  const key = createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
  const previous = scene.lastMechanismDown;
  scene.lastMechanismDown = {
    key,
    time: now,
    x: pointer.x,
    y: pointer.y
  };
  return !!previous
    && previous.key === key
    && now - previous.time <= DOUBLE_CLICK_MS
    && Math.hypot(pointer.x - previous.x, pointer.y - previous.y) <= DOUBLE_CLICK_DISTANCE;
};

export const inspectHitTile = (scene, hit) => {
  if (!hit?.cell || hit.type !== 'tile') return false;
  if (!scene.isSelectedHit(hit)) scene.selectHit(hit, false);
  if (scene.activeTool === CITY_CHANNEL_TOOLS.BROWSE) scene.config.onRequestTool?.(CITY_CHANNEL_TOOLS.SELECT);
  const key = createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
  const tile = scene.mapData.tiles?.[key] || hit.tile;
  if (!tile) return false;
  return inspectTile(scene, { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z }, tile);
};

export const getMechanismScreenAnchor = (scene, cell) => {
  if (!cell) return null;
  const projection = projectCell(cell, scene.cameraState.yaw, scene.mapData);
  const zoom = scene.cameraState.zoom || 1;
  return {
    left: scene.worldLayer.x + (projection.x * zoom),
    top: scene.worldLayer.y + ((projection.y - 58) * zoom)
  };
};

export const getCellScreenPosition = (scene, cell) => {
  if (!cell) return { x: scene.scale.width / 2, y: scene.scale.height / 2 };
  const projection = projectCell(cell, scene.cameraState.yaw, scene.mapData);
  const zoom = scene.cameraState.zoom || 1;
  return {
    x: scene.worldLayer.x + (projection.x * zoom),
    y: scene.worldLayer.y + (projection.y * zoom)
  };
};

export const getSourceDisplayObjects = (scene, key) => [
  scene.renderObjects.get(`tile:${key}`),
  scene.renderObjects.get(`gear-far:tile:${key}`),
  scene.renderObjects.get(`gear-near:tile:${key}`),
  scene.renderObjects.get(`edge-overlay:tile:${key}`),
  scene.renderObjects.get(`mechanism:${key}`),
  scene.renderObjects.get(`tile-label:${key}`)
].filter(Boolean);

export const setSourceInspectAlpha = (scene, key, alpha = 1) => {
  getSourceDisplayObjects(scene, key).forEach((object) => {
    if (!object.getData('inspectOriginalAlpha')) object.setData('inspectOriginalAlpha', object.alpha);
    object.setAlpha(alpha);
  });
};

export const restoreSourceInspectAlpha = (scene, key) => {
  getSourceDisplayObjects(scene, key).forEach((object) => {
    const originalAlpha = object.getData('inspectOriginalAlpha');
    object.setAlpha(Number.isFinite(originalAlpha) ? originalAlpha : 1);
    object.setData('inspectOriginalAlpha', null);
  });
};

export const createInspectPreview = (scene, tile, yaw) => {
  const container = scene.add.container(0, 0);
  const shadow = scene.add.graphics();
  shadow.fillStyle(0x020617, 0.34);
  shadow.fillEllipse(0, 48, 126, 38);
  container.add(shadow);
  const texture = scene.textureCache.getTileTexture(
    tile.panelType,
    tile.rotation || 0,
    yaw,
    getTransmissionSurfaceRotation(tile)
  );
  const tileImage = scene.configureBoardImage(scene.add.image(0, 0, texture).setOrigin(0.5, 0.57));
  container.add(tileImage);

  let runtime = null;
  if (isTriggerMechanismTile(tile.panelType)) {
    const mechanism = scene.add.container(0, 0);
    const graphics = scene.add.graphics();
    mechanism.add(graphics);
    runtime = {
      graphics,
      state: { progress: 0 }
    };
    scene.drawMechanismState(
      tile,
      runtime,
      0,
      normalizeMechanismParams(scene.mechanismParams?.[createCellKey(tile.x, tile.y, tile.z)]),
      yaw
    );
    container.add(mechanism);
  }

  return { container, tileImage, runtime, shadow };
};

export const applyInspectTransform = (state, values = {}) => {
  if (!state?.container) return;
  if (Number.isFinite(values.x) || Number.isFinite(values.y)) {
    state.container.setPosition(
      Number.isFinite(values.x) ? values.x : state.container.x,
      Number.isFinite(values.y) ? values.y : state.container.y
    );
  }
  if (Number.isFinite(values.alpha)) state.container.setAlpha(values.alpha);
  if (Number.isFinite(values.scale)) state.displayScale = values.scale;
  const scale = state.displayScale || INSPECT_PREVIEW_SCALE;
  const pitch = state.pitch || 0;
  const pitchRadians = (pitch * Math.PI) / 180;
  const pitchFacing = Math.cos(pitchRadians);
  const pitchScaleY = (pitchFacing < 0 ? -1 : 1) * Math.max(0.14, Math.abs(pitchFacing));
  state.container.setScale(scale, scale * pitchScaleY);
  state.container.setAngle(state.roll || 0);
  if (state.shadow) {
    state.shadow.setAlpha(Math.max(0.14, Math.min(0.48, 0.16 + (Math.abs(pitchFacing) * 0.18))));
  }
};

export const refreshInspectPreview = (scene) => {
  const state = scene.inspectState;
  if (!state || state.isClosing || state.external) return;
  const tile = scene.mapData.tiles?.[state.key] || state.tile;
  if (!tile) {
    closeInspectMode(scene, { animate: false });
    return;
  }
  state.tile = tile;
  scene.setBoardTexture(
    state.tileImage,
    scene.textureCache.getTileTexture(tile.panelType, tile.rotation || 0, state.yaw, getTransmissionSurfaceRotation(tile))
  );
  if (state.runtime) {
    scene.drawMechanismState(
      tile,
      state.runtime,
      state.runtime.state.progress,
      normalizeMechanismParams(scene.mechanismParams?.[state.key]),
      state.yaw
    );
  }
  applyInspectTransform(state);
};

export const inspectSelectedTile = (scene) => {
  if (scene.selectedCells.length !== 1 || scene.selectedWalls.length > 0) return false;
  const cell = scene.selectedCells[0];
  const key = createCellKey(cell.x, cell.y, cell.z);
  const tile = scene.mapData.tiles?.[key];
  if (!tile) return false;
  return inspectTile(scene, cell, tile);
};

export const inspectTile = (scene, cell, tile) => {
  if (!cell || !tile) return false;
  const key = createCellKey(cell.x, cell.y, cell.z);
  closeInspectMode(scene, { animate: false, silent: true });
  scene.keyState.clear();
  scene.pendingMechanicalPort = null;
  drawMechanicalLayers(scene);

  const source = getCellScreenPosition(scene, cell);
  if (scene.config.externalInspectOverlay) {
    setSourceInspectAlpha(scene, key, 0.2);
    scene.inspectState = {
      key,
      cell: { x: cell.x, y: cell.y, z: cell.z },
      tile,
      panelType: tile.panelType,
      source,
      external: true,
      isClosing: false
    };
    scene.config.onInspectChange?.({
      active: true,
      key,
      cell: { x: cell.x, y: cell.y, z: cell.z },
      panelType: tile.panelType,
      tile: {
        panelType: tile.panelType,
        rotation: tile.rotation || 0,
        transmissionRotation: tile.transmissionRotation ?? tile.rotation ?? 0,
        transmissionSkeleton: tile.transmissionSkeleton || null,
        gearMounts: tile.gearMounts || []
      },
      source
    });
    if (isTriggerMechanismTile(tile.panelType)) {
      scene.requestMechanismPanel({
        type: 'tile',
        cell,
        panelType: tile.panelType,
        tile
      });
    }
    scene.config.onHoverStatusChange?.(`${resolveMaterialName(tile.panelType)}，观察中`);
    return true;
  }

  const target = {
    x: scene.scale.width / 2,
    y: Math.max(170, scene.scale.height / 2 - 24)
  };
  const preview = createInspectPreview(scene, tile, scene.cameraState.yaw);
  const backdrop = scene.add.graphics();
  backdrop.fillStyle(0x020617, 0.62);
  backdrop.fillRect(0, 0, scene.scale.width, scene.scale.height);
  backdrop.lineStyle(1, 0x67e8f9, 0.18);
  backdrop.strokeCircle(source.x, source.y, 34);
  backdrop.setAlpha(0);

  const startScale = Math.max(0.4, scene.cameraState.zoom || 1);
  preview.container.setPosition(source.x, source.y);
  preview.container.setAlpha(0.22);
  scene.inspectLayer.add([backdrop, preview.container]);
  setSourceInspectAlpha(scene, key, 0.2);

  scene.inspectState = {
    key,
    cell: { x: cell.x, y: cell.y, z: cell.z },
    tile,
    panelType: tile.panelType,
    yaw: scene.cameraState.yaw,
    startX: source.x,
    startY: source.y,
    backdrop,
    container: preview.container,
    tileImage: preview.tileImage,
    shadow: preview.shadow,
    runtime: preview.runtime,
    displayScale: startScale,
    pitch: 0,
    roll: 0,
    isClosing: false
  };
  applyInspectTransform(scene.inspectState, {
    x: source.x,
    y: source.y,
    scale: startScale,
    alpha: 0.22
  });

  const motion = { t: 0 };
  scene.inspectState.motion = motion;
  scene.tweens.add({
    targets: motion,
    t: 1,
    duration: INSPECT_LIFT_DURATION,
    ease: 'sine.inout',
    onUpdate: () => {
      const t = motion.t;
      backdrop.setAlpha(t);
      applyInspectTransform(scene.inspectState, {
        x: source.x + ((target.x - source.x) * t),
        y: source.y + ((target.y - source.y) * t) - (Math.sin(t * Math.PI) * 34),
        scale: startScale + ((INSPECT_PREVIEW_SCALE - startScale) * t),
        alpha: 0.22 + (0.78 * t)
      });
    },
    onComplete: () => {
      if (!scene.inspectState || scene.inspectState.key !== key) return;
      scene.inspectState.motion = null;
      applyInspectTransform(scene.inspectState, {
        x: target.x,
        y: target.y,
        scale: INSPECT_PREVIEW_SCALE,
        alpha: 1
      });
    }
  });

  scene.config.onInspectChange?.({
    active: true,
    key,
    cell: { x: cell.x, y: cell.y, z: cell.z },
    panelType: tile.panelType
  });
  if (isTriggerMechanismTile(tile.panelType)) {
    scene.requestMechanismPanel({
      type: 'tile',
      cell,
      panelType: tile.panelType,
      tile
    });
  }
  scene.config.onHoverStatusChange?.(`${resolveMaterialName(tile.panelType)}，观察中`);
  return true;
};

export const closeInspectMode = (scene, options = {}) => {
  const { animate = true, silent = false } = options || {};
  const state = scene.inspectState;
  if (!state) return false;
  scene.inspectState = null;
  state.isClosing = true;
  scene.dragState = null;
  scene.keyState.clear();
  if (!silent) scene.config.onInspectChange?.(null);
  const finish = () => {
    if (state.runtime?.state) scene.tweens.killTweensOf(state.runtime.state);
    state.container?.destroy(true);
    state.backdrop?.destroy();
    restoreSourceInspectAlpha(scene, state.key);
  };
  if (state.external || !animate) {
    finish();
    return true;
  }
  const source = getCellScreenPosition(scene, state.cell);
  if (state.motion) scene.tweens.killTweensOf(state.motion);
  const start = {
    x: state.container.x,
    y: state.container.y,
    scale: state.displayScale || INSPECT_PREVIEW_SCALE,
    alpha: state.container.alpha
  };
  const targetScale = Math.max(0.4, scene.cameraState.zoom || 1);
  const motion = { t: 0 };
  state.motion = motion;
  scene.tweens.add({
    targets: motion,
    t: 1,
    duration: INSPECT_RETURN_DURATION,
    ease: 'sine.inout',
    onUpdate: () => {
      const t = motion.t;
      state.backdrop?.setAlpha(1 - t);
      applyInspectTransform(state, {
        x: start.x + ((source.x - start.x) * t),
        y: start.y + ((source.y - start.y) * t) - (Math.sin(t * Math.PI) * 18),
        scale: start.scale + ((targetScale - start.scale) * t),
        alpha: start.alpha + ((0.22 - start.alpha) * t)
      });
    },
    onComplete: finish
  });
  return true;
};
