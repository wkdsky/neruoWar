import { createCellKey } from '../cityChannelSchema';
import {
  CITY_CHANNEL_MECHANISM_KINDS,
  getMechanismTemplateKind,
  isTriggerMechanismTile,
  normalizeMechanismParams
} from '../cityChannelMechanismRuntime';
import {
  TILE_RENDER_CENTER,
  createTileGeometry,
  projectCell
} from './renderer/CityChannelGeometry';

export const createMechanismObject = (scene, Phaser, tile, key, depth) => {
  const cell = { x: tile.x, y: tile.y, z: tile.z };
  const projection = projectCell(cell, scene.cameraState.yaw, scene.mapData);
  const container = scene.add.container(projection.x, projection.y);
  container.depth = depth;
  container.setData('placementId', `mechanism:${key}`);
  container.setData('kind', 'mechanism');
  container.setData('cellKey', key);
  container.setData('panelType', tile.panelType);
  container.setSize(96, 70);
  container.setInteractive(new Phaser.Geom.Rectangle(-48, -12, 96, 70), Phaser.Geom.Rectangle.Contains);

  const graphics = scene.add.graphics();
  container.add(graphics);
  const runtime = {
    graphics,
    state: { progress: 0 }
  };
  container.setData('runtime', runtime);
  drawMechanismState(scene, tile, runtime, 0, normalizeMechanismParams(scene.mechanismParams?.[key]));
  return container;
};

export const getMechanismVisualFlags = (scene, tile, progress = 0) => {
  const key = tile ? createCellKey(tile.x, tile.y, tile.z) : '';
  const isSelected = scene.selectedCells.some((cell) => createCellKey(cell.x, cell.y, cell.z) === key);
  const hoverHit = scene.hoverTarget?.hit;
  const isHover = !!hoverHit?.cell
    && hoverHit.type === 'tile'
    && createCellKey(hoverHit.cell.x, hoverHit.cell.y, hoverHit.cell.z) === key;
  return {
    isSelected,
    isHover,
    isRunning: progress > 0.02
  };
};

export const drawMechanismSelectionGlow = (graphics, flags = {}) => {
  if (!flags.isSelected && !flags.isHover && !flags.isRunning) return;
  const alpha = flags.isSelected ? 0.58 : flags.isHover ? 0.34 : 0.26;
  graphics.lineStyle(flags.isSelected ? 3 : 2, flags.isRunning ? 0x22d3ee : 0x67e8f9, alpha);
  graphics.strokeEllipse(0, 27, flags.isSelected ? 118 : 108, flags.isSelected ? 42 : 36);
  graphics.fillStyle(0x22d3ee, flags.isSelected ? 0.08 : 0.04);
  graphics.fillEllipse(0, 29, 112, 38);
};

export const drawGearPressurePlateMechanism = (
  scene,
  graphics,
  tile,
  progress = 0,
  params = {},
  cameraYaw = scene.cameraState.yaw,
  flags = {}
) => {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  drawMechanismSelectionGlow(graphics, flags);
  if (p <= 0.02 && !flags.isSelected && !flags.isHover && !flags.isRunning) return;
  const geometry = createTileGeometry(cameraYaw, tile.rotation || 0);
  const top = geometry.top.map((point) => ({
    x: point.x - TILE_RENDER_CENTER.x,
    y: point.y - TILE_RENDER_CENTER.y
  }));
  scene.textureCache.drawGearPressurePlateCornerHint(graphics, { top }, 0.26 + (p * 0.34));
};

export const applyMechanismPose = (
  scene,
  tile,
  runtime,
  progress = 0,
  params = {},
  cameraYaw = scene.cameraState.yaw
) => {
  const graphics = runtime.graphics;
  if (!graphics) return;
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const kind = getMechanismTemplateKind(tile.panelType);
  const flags = getMechanismVisualFlags(scene, tile, p);
  graphics.clear();
  if (kind === CITY_CHANNEL_MECHANISM_KINDS.GEAR_PRESSURE_PLATE) {
    drawGearPressurePlateMechanism(scene, graphics, tile, p, params, cameraYaw, flags);
  }
};

export const drawMechanismState = (scene, tile, runtime, progress = 0, params = {}, cameraYaw = scene.cameraState.yaw) => {
  applyMechanismPose(scene, tile, runtime, progress, params, cameraYaw);
};

export const refreshMechanismVisuals = (scene) => {
  Object.values(scene.mapData.tiles || {}).forEach((tile) => {
    if (!isTriggerMechanismTile(tile.panelType)) return;
    const key = createCellKey(tile.x, tile.y, tile.z);
    const object = scene.renderObjects.get(`mechanism:${key}`);
    const runtime = object?.getData('runtime');
    if (runtime) {
      drawMechanismState(
        scene,
        tile,
        runtime,
        runtime.state.progress || 0,
        normalizeMechanismParams(scene.mechanismParams?.[key])
      );
    }
  });
};
