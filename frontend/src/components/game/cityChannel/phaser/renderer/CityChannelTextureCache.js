import { CITY_CHANNEL_TILE_TYPES } from '../../cityChannelSchema';
import { getCityChannelMaterial, isMechanicalMaterial } from '../../cityChannelCatalog';
import { isTriggerMechanismTile } from '../../cityChannelMechanismRuntime';
import {
  TILE_RENDER_HEIGHT,
  TILE_RENDER_WIDTH,
  createEdgeWallGeometry,
  createPortalGeometry,
  createTileGeometry
} from './CityChannelGeometry';

const colorByPanelType = {
  wood_floor: { top: 0x87643f, side: 0x4b321f, edge: 0xfbbf24 },
  stone_floor: { top: 0x64748b, side: 0x334155, edge: 0xcbd5e1 },
  iron_floor: { top: 0x293445, side: 0x111827, edge: 0x94a3b8 },
  glass_floor: { top: 0x7dd3fc, side: 0x0e7490, edge: 0xbae6fd, alpha: 0.45 },
  wall: { top: 0x172232, side: 0x0f1726, edge: 0xe2e8f0 },
  glass_wall: { top: 0x7dd3fc, side: 0x0e7490, edge: 0xbae6fd, alpha: 0.38 },
  entrance: { top: 0x0e7490, side: 0x08304a, edge: 0x67e8f9 },
  exit: { top: 0xa16207, side: 0x451a03, edge: 0xfacc15 },
  pressure_plate: { top: 0x31525d, side: 0x0f2f3a, edge: 0x8b5cf6 },
  directional_pressure_plate: { top: 0x244f61, side: 0x0f2f3a, edge: 0x8b5cf6 },
  vertical_push_button: { top: 0x64748b, side: 0x334155, edge: 0xcbd5e1 },
  horizontal_push_button: { top: 0x64748b, side: 0x334155, edge: 0xcbd5e1 },
  rotary_button: { top: 0x64748b, side: 0x334155, edge: 0xcbd5e1 },
  external_gear_plate: { top: 0x284653, side: 0x102a34, edge: 0x5eead4 },
  internal_gear_plate: { top: 0x284653, side: 0x102a34, edge: 0x5eead4 },
  peg_gear_plate: { top: 0x284653, side: 0x102a34, edge: 0x5eead4 },
  trapdoor_plate: { top: 0x45505c, side: 0x272f3a, edge: 0xa1a1aa },
  side_pusher_plate: { top: 0x334155, side: 0x111827, edge: 0xef4444 },
  spring_plate: { top: 0x31514a, side: 0x0f2f3a, edge: 0x86efac }
};

const drawPolygon = (graphics, points, fill, alpha = 1, stroke = 0x0f172a, strokeAlpha = 0.55) => {
  if (!Array.isArray(points) || points.length < 3) return;
  graphics.fillStyle(fill, alpha);
  graphics.lineStyle(1, stroke, strokeAlpha);
  graphics.beginPath();
  graphics.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => graphics.lineTo(point.x, point.y));
  graphics.closePath();
  graphics.fillPath();
  graphics.strokePath();
};

const colorToRgba = (color, alpha = 1) => {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const traceCanvasPolygon = (ctx, points = []) => {
  if (!Array.isArray(points) || points.length < 3) return false;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  return true;
};

const drawCanvasPolygon = (ctx, points, {
  fill = null,
  stroke = null,
  lineWidth = 1,
  lineDash = []
} = {}) => {
  if (!traceCanvasPolygon(ctx, points)) return;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.save();
    ctx.setLineDash(lineDash);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.restore();
  }
};

const drawCanvasGradientPolygon = (ctx, points, color, alphaMultiplier, geometry) => {
  if (!traceCanvasPolygon(ctx, points)) return;
  const gradient = ctx.createLinearGradient(0, geometry.wallFadeStartY, 0, geometry.wallFadeEndY);
  gradient.addColorStop(0, colorToRgba(color, 0));
  gradient.addColorStop(0.18, colorToRgba(color, 0.24 * alphaMultiplier));
  gradient.addColorStop(0.56, colorToRgba(color, 0.82 * alphaMultiplier));
  gradient.addColorStop(1, colorToRgba(color, alphaMultiplier));
  ctx.fillStyle = gradient;
  ctx.fill();
};

const drawBoxPart = (graphics, part, colors) => {
  if (!part) return;
  drawPolygon(graphics, part.front, colors.stone, colors.alpha, colors.edge, 0.72);
  drawPolygon(graphics, part.side, colors.dark, colors.alpha * 0.9, 0x0f172a, 0.5);
  drawPolygon(graphics, part.top, colors.light, colors.alpha, colors.edge, 0.55);
};

export const getTextureYawBucket = (cameraYaw = 0) => {
  const normalized = ((cameraYaw % 360) + 360) % 360;
  return Math.round(normalized / 2) * 2 % 360;
};

export class CityChannelTextureCache {
  constructor(scene) {
    this.scene = scene;
    this.generatedKeys = new Set();
  }

  getTileTexture(panelType, rotation = 0, flipped = false, cameraYaw = 0) {
    const textureYaw = getTextureYawBucket(cameraYaw);
    const key = `cc:tile:${panelType}:r${rotation}:f${flipped ? 1 : 0}:y${textureYaw}`;
    if (!this.generatedKeys.has(key)) this.createTileTexture(key, panelType, rotation, textureYaw);
    return key;
  }

  getWallTexture(panelType, edge = 'north', wallViewMode = 'semi', cameraYaw = 0) {
    const textureYaw = getTextureYawBucket(cameraYaw);
    const key = `cc:wall:${panelType}:${edge}:${wallViewMode}:y${textureYaw}`;
    if (!this.generatedKeys.has(key)) this.createWallTexture(key, panelType, edge, wallViewMode, textureYaw);
    return key;
  }

  createTileTexture(key, panelType, rotation, cameraYaw) {
    const colors = colorByPanelType[panelType] || colorByPanelType.wood_floor;
    const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
    const geometry = createTileGeometry(cameraYaw, rotation);
    const alpha = colors.alpha || 1;

    geometry.sides.forEach((side, index) => {
      drawPolygon(graphics, side, colors.side, index === 0 ? 0.92 : 0.72, 0x0f172a, 0.5);
    });
    drawPolygon(graphics, geometry.top, colors.top, alpha, colors.edge, 0.72);

    if (panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || panelType === CITY_CHANNEL_TILE_TYPES.EXIT) {
      this.drawPortalModel(graphics, panelType, rotation, cameraYaw);
    } else if (isMechanicalMaterial(getCityChannelMaterial(panelType)) && !isTriggerMechanismTile(panelType)) {
      this.drawMechanismGlyph(graphics, panelType);
    }

    graphics.generateTexture(key, TILE_RENDER_WIDTH, TILE_RENDER_HEIGHT);
    graphics.destroy();
    this.generatedKeys.add(key);
  }

  createWallTexture(key, panelType, edge, wallViewMode, cameraYaw) {
    const colors = colorByPanelType[panelType] || colorByPanelType.wall;
    const geometry = createEdgeWallGeometry(cameraYaw, edge);
    const isSemi = wallViewMode === 'semi';
    if (isSemi) {
      this.createSemiWallTexture(key, panelType, geometry, colors);
      return;
    }

    const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
    const isPerspective = wallViewMode === 'perspective';
    const isSolid = wallViewMode === 'solid';
    const baseAlpha = panelType === CITY_CHANNEL_TILE_TYPES.GLASS_WALL ? 0.42 : 1;
    const wallAlpha = isPerspective ? 0.34 : baseAlpha;
    const outlineAlpha = isSolid ? 0 : (isPerspective ? 0.16 : 0.28);

    drawPolygon(graphics, geometry.wall, colors.top, wallAlpha, colors.edge, 0.76);
    drawPolygon(graphics, geometry.wallSideStart, colors.side, wallAlpha * 0.86, 0xe2e8f0, 0.32);
    drawPolygon(graphics, geometry.wallSideEnd, colors.side, wallAlpha * 0.74, 0xe2e8f0, 0.28);
    if (isSolid) {
      drawPolygon(graphics, geometry.wallCap, 0x334155, baseAlpha, 0xe2e8f0, 0.5);
    } else if (outlineAlpha > 0) {
      drawPolygon(graphics, geometry.wallCap, 0xe0f2fe, outlineAlpha, colors.edge, 0.68);
    }

    graphics.generateTexture(key, TILE_RENDER_WIDTH, TILE_RENDER_HEIGHT);
    graphics.destroy();
    this.generatedKeys.add(key);
  }

  createSemiWallTexture(key, panelType, geometry, colors) {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_RENDER_WIDTH;
    canvas.height = TILE_RENDER_HEIGHT;
    const ctx = canvas.getContext('2d');
    const baseAlpha = panelType === CITY_CHANNEL_TILE_TYPES.GLASS_WALL ? 0.42 : 1;

    drawCanvasGradientPolygon(ctx, geometry.wall, colors.top, baseAlpha, geometry);
    drawCanvasGradientPolygon(ctx, geometry.wallSideStart, colors.side, baseAlpha * 0.86, geometry);
    drawCanvasGradientPolygon(ctx, geometry.wallSideEnd, colors.side, baseAlpha * 0.74, geometry);

    const outline = colorToRgba(colors.edge, 0.72);
    const sideOutline = colorToRgba(0xe2e8f0, 0.46);
    [
      geometry.wall,
      geometry.wallSideStart,
      geometry.wallSideEnd,
      geometry.wallCap
    ].forEach((points, index) => {
      drawCanvasPolygon(ctx, points, {
        fill: index === 3 ? colorToRgba(0xe0f2fe, 0.18) : null,
        stroke: index === 0 ? outline : sideOutline,
        lineWidth: index === 0 ? 2 : 1.6,
        lineDash: [7, 4]
      });
    });

    this.scene.textures.addCanvas(key, canvas);
    this.generatedKeys.add(key);
  }

  drawPortalGlyph(graphics, panelType) {
    const color = panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE ? 0x67e8f9 : 0xfacc15;
    graphics.lineStyle(3, color, 0.85);
    graphics.strokeRoundedRect(58, 42, 44, 64, 12);
    graphics.fillStyle(color, 0.22);
    graphics.fillEllipse(80, 78, 28, 42);
  }

  drawPortalModel(graphics, panelType, rotation, cameraYaw) {
    const isEntrance = panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE;
    const accent = isEntrance ? 0x22d3ee : 0xfacc15;
    const glow = isEntrance ? 0x06b6d4 : 0xeab308;
    const colors = isEntrance
      ? { stone: 0x5b6474, light: 0x7a8594, dark: 0x3b4454, edge: 0xcbd5e1, alpha: 0.96 }
      : { stone: 0x6b5a3a, light: 0x8a7a5a, dark: 0x3d3018, edge: 0xfde68a, alpha: 0.96 };
    const portal = createPortalGeometry(cameraYaw, rotation);

    drawBoxPart(graphics, portal.threshold, {
      ...colors,
      stone: colors.light,
      light: isEntrance ? 0x83a7b6 : 0xa08b5a,
      alpha: 0.92
    });
    drawBoxPart(graphics, portal.leftPillar, colors);
    drawBoxPart(graphics, portal.rightPillar, colors);
    drawBoxPart(graphics, portal.lintel, colors);
    drawBoxPart(graphics, portal.arch, {
      ...colors,
      stone: isEntrance ? 0x287486 : 0x8d6c25,
      light: isEntrance ? 0x38a0b5 : 0xb58b2c
    });

    graphics.fillStyle(glow, 0.22);
    graphics.fillEllipse(portal.coreCenter.x, portal.coreCenter.y, portal.coreRx + 7, portal.coreRy + 8);
    graphics.lineStyle(2, accent, 0.82);
    graphics.fillStyle(isEntrance ? 0x083344 : 0x451a03, 0.62);
    graphics.fillEllipse(portal.coreCenter.x, portal.coreCenter.y, portal.coreRx + 4, portal.coreRy + 4);
    graphics.lineStyle(1, 0xffffff, 0.52);
    graphics.fillStyle(accent, 0.36);
    graphics.fillEllipse(portal.coreCenter.x, portal.coreCenter.y, portal.coreRx, portal.coreRy);

    graphics.fillStyle(accent, 0.82);
    portal.runePositions.forEach((rune, index) => {
      const width = index % 2 === 0 ? 4 : 3;
      graphics.fillRoundedRect(rune.x - (width / 2), rune.y - 3, width, 7, 1);
    });
    graphics.fillStyle(accent, 0.58);
    portal.particles.forEach((particle) => {
      graphics.fillCircle(particle.x, particle.y, particle.radius);
    });
  }

  drawMechanismGlyph(graphics, panelType) {
    const material = getCityChannelMaterial(panelType);
    const color = material.category === 'mechanical_gear' ? 0xf59e0b : 0x8b5cf6;
    graphics.lineStyle(2, color, 0.82);
    graphics.fillStyle(color, 0.22);
    graphics.fillCircle(80, 91, material.category === 'mechanical_gear' ? 16 : 11);
    graphics.strokeCircle(80, 91, material.category === 'mechanical_gear' ? 20 : 15);
    if (material.category === 'mechanical_actuator') {
      graphics.strokeRect(64, 78, 32, 22);
    }
  }

  destroy() {
    this.generatedKeys.forEach((key) => {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    });
    this.generatedKeys.clear();
  }
}

export default CityChannelTextureCache;
