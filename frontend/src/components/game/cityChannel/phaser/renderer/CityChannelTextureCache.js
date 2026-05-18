import { CITY_CHANNEL_TILE_TYPES } from '../../cityChannelSchema';
import { getCityChannelMaterial, isMechanicalMaterial } from '../../cityChannelCatalog';
import { getGearMountLocalPosition, isTriggerMechanismTile } from '../../cityChannelMechanismRuntime';
import {
  TILE_RENDER_HEIGHT,
  TILE_RENDER_WIDTH,
  createEdgeWallGeometry,
  createPortalGeometry,
  createTileGeometry
} from './CityChannelGeometry';

const colorByPanelType = {
  basic_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  transmission_straight_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  transmission_cross_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  transmission_t_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  transmission_l_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  transmission_endpoint_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  gear_pressure_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4, alpha: 0.98 },
  actuator_center_gear_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  actuator_single_corner_gear_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  actuator_same_side_gear_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  actuator_opposite_corner_gear_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  actuator_triangle_gear_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  actuator_four_corner_gear_plate: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  wood_floor: { top: 0x87643f, side: 0x4b321f, edge: 0xfbbf24 },
  stone_floor: { top: 0x64748b, side: 0x334155, edge: 0xcbd5e1 },
  iron_floor: { top: 0x293445, side: 0x111827, edge: 0x94a3b8 },
  glass_floor: { top: 0x7dd3fc, side: 0x0e7490, edge: 0xbae6fd, alpha: 0.45 },
  wall: { top: 0x172232, side: 0x0f1726, edge: 0xe2e8f0 },
  glass_wall: { top: 0x7dd3fc, side: 0x0e7490, edge: 0xbae6fd, alpha: 0.38 },
  entrance: { top: 0x0e7490, side: 0x08304a, edge: 0x67e8f9 },
  exit: { top: 0xa16207, side: 0x451a03, edge: 0xfacc15 },
  pressure_plate: { top: 0x7dd3fc, side: 0x0f2f3a, edge: 0x8b5cf6, alpha: 0.42 },
  directional_pressure_plate: { top: 0x7dd3fc, side: 0x0f2f3a, edge: 0x8b5cf6, alpha: 0.42 },
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

const pseudoRandom = (seed) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

const getSeedFromString = (value = '') => (
  Array.from(String(value)).reduce((sum, char, index) => sum + (char.charCodeAt(0) * (index + 1)), 0)
);

const interpolatePolygonPoint = (polygon = [], u = 0, v = 0) => {
  if (!Array.isArray(polygon) || polygon.length < 4) return { x: 0, y: 0 };
  const [nw, ne, se, sw] = polygon;
  const lerp = (a, b, t) => a + ((b - a) * t);
  return {
    x: lerp(lerp(nw.x, ne.x, u), lerp(sw.x, se.x, u), v),
    y: lerp(lerp(nw.y, ne.y, u), lerp(sw.y, se.y, u), v)
  };
};

const drawCanvasStoneSurface = (ctx, polygon, seedKey = '') => {
  if (!traceCanvasPolygon(ctx, polygon)) return;
  const seedBase = getSeedFromString(seedKey);
  ctx.save();
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.strokeStyle = colorToRgba(0xf2eee5, 0.14);
  ctx.lineWidth = 1;
  [0.26, 0.53, 0.78].forEach((v) => {
    const start = interpolatePolygonPoint(polygon, 0.08, v);
    const end = interpolatePolygonPoint(polygon, 0.92, v + ((pseudoRandom(seedBase + v * 100) - 0.5) * 0.035));
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  });
  for (let index = 0; index < 24; index += 1) {
    const u = 0.08 + (pseudoRandom(seedBase + index + 1) * 0.84);
    const v = 0.08 + (pseudoRandom(seedBase + index + 31) * 0.84);
    const point = interpolatePolygonPoint(polygon, u, v);
    ctx.fillStyle = colorToRgba(index % 3 === 0 ? 0xe8e0d2 : 0x6f685f, index % 3 === 0 ? 0.14 : 0.1);
    ctx.beginPath();
    ctx.arc(point.x, point.y, index % 3 === 0 ? 1.2 : 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  return Math.round(normalized / 10) * 10 % 360;
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

  getWallTexture(panelType, edge = 'north', wallViewMode = 'semi', cameraYaw = 0, rotation = 0) {
    const textureYaw = getTextureYawBucket(cameraYaw);
    const key = `cc:wall:${panelType}:${edge}:r${rotation}:${wallViewMode}:y${textureYaw}`;
    if (!this.generatedKeys.has(key)) this.createWallTexture(key, panelType, edge, wallViewMode, textureYaw, rotation);
    return key;
  }

  createTileTexture(key, panelType, rotation, cameraYaw) {
    const material = getCityChannelMaterial(panelType);
    const colors = colorByPanelType[material.id] || colorByPanelType.basic_plate;
    const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
    const geometry = createTileGeometry(cameraYaw, rotation);
    const alpha = material.id === CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
      ? (colors.alpha || 0.94)
      : (isTriggerMechanismTile(panelType) ? 0.38 : (colors.alpha || 1));

    geometry.sides.forEach((side, index) => {
      drawPolygon(graphics, side, colors.side, index === 0 ? 0.92 : 0.72, 0x0f172a, 0.5);
    });
    drawPolygon(graphics, geometry.top, colors.top, alpha, colors.edge, 0.72);
    this.drawStoneSurface(graphics, geometry.top, material.id);

    if (panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || panelType === CITY_CHANNEL_TILE_TYPES.EXIT) {
      this.drawPortalModel(graphics, panelType, rotation, cameraYaw);
    } else {
      this.drawTransmissionSkeleton(graphics, material, rotation, geometry);
      this.drawGearMounts(graphics, material, rotation);
      if (material.gearIcon) this.drawGearIcon(graphics, 80, 91, 16, 10, 0xfacc15);
      else if (isMechanicalMaterial(material) && !material.transmissionSkeleton && !material.gearMounts?.length) {
        this.drawMechanismGlyph(graphics, panelType);
      }
    }

    graphics.generateTexture(key, TILE_RENDER_WIDTH, TILE_RENDER_HEIGHT);
    graphics.destroy();
    this.generatedKeys.add(key);
  }

  createWallTexture(key, panelType, edge, wallViewMode, cameraYaw, rotation = 0) {
    const material = getCityChannelMaterial(panelType);
    const colors = colorByPanelType[material.id] || colorByPanelType.basic_plate;
    const geometry = createEdgeWallGeometry(cameraYaw, edge);
    const isSemi = wallViewMode === 'semi';
    if (isSemi) {
      this.createSemiWallTexture(key, panelType, geometry, colors, rotation);
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
    this.drawStoneSurface(graphics, geometry.wall, material.id);
    if (isSolid) {
      drawPolygon(graphics, geometry.wallCap, 0x334155, baseAlpha, 0xe2e8f0, 0.5);
    } else if (outlineAlpha > 0) {
      drawPolygon(graphics, geometry.wallCap, 0xe0f2fe, outlineAlpha, colors.edge, 0.68);
    }
    this.drawWallTransmissionSkeleton(graphics, material, geometry.wall, rotation);
    this.drawWallGearMounts(graphics, material, geometry.wall, rotation);
    if (material.gearIcon) {
      const center = this.mapBoardPointOnWall({ x: 0, y: 0 }, rotation, geometry.wall);
      this.drawGearIcon(graphics, center.x + 20, center.y - 8, 13, 10, 0xfacc15);
    }

    graphics.generateTexture(key, TILE_RENDER_WIDTH, TILE_RENDER_HEIGHT);
    graphics.destroy();
    this.generatedKeys.add(key);
  }

  createSemiWallTexture(key, panelType, geometry, colors, rotation = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_RENDER_WIDTH;
    canvas.height = TILE_RENDER_HEIGHT;
    const ctx = canvas.getContext('2d');
    const baseAlpha = panelType === CITY_CHANNEL_TILE_TYPES.GLASS_WALL ? 0.42 : 1;

    drawCanvasGradientPolygon(ctx, geometry.wall, colors.top, baseAlpha, geometry);
    drawCanvasGradientPolygon(ctx, geometry.wallSideStart, colors.side, baseAlpha * 0.86, geometry);
    drawCanvasGradientPolygon(ctx, geometry.wallSideEnd, colors.side, baseAlpha * 0.74, geometry);
    drawCanvasStoneSurface(ctx, geometry.wall, panelType);

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
    const material = getCityChannelMaterial(panelType);
    const ports = material.transmissionSkeleton?.ports || [];
    if (ports.length > 0) {
      ctx.save();
      ctx.strokeStyle = colorToRgba(0xfacc15, 0.92);
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      const center = this.mapBoardPointOnWall({ x: 0, y: 0 }, rotation, geometry.wall);
      ports.forEach((port) => {
        const point = this.mapBoardPointOnWall(port.localPosition, rotation, geometry.wall);
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      });
      ctx.strokeStyle = colorToRgba(0x78350f, 0.82);
      ctx.fillStyle = colorToRgba(0xf8fafc, 0.96);
      ctx.lineWidth = 2;
      ports.forEach((port) => {
        const point = this.mapBoardPointOnWall(port.localPosition, rotation, geometry.wall);
        const rotated = this.rotateLocalPoint(port.localPosition || {}, rotation);
        const isHorizontalEdge = Math.abs(rotated.y || 0) >= Math.abs(rotated.x || 0);
        ctx.beginPath();
        ctx.ellipse(point.x, point.y, isHorizontalEdge ? 14 : 7, isHorizontalEdge ? 7 : 14, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

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

  drawStoneSurface(graphics, polygon, seedKey = '') {
    if (!Array.isArray(polygon) || polygon.length < 4) return;
    const seedBase = getSeedFromString(seedKey);

    graphics.lineStyle(1, 0xf2eee5, 0.16);
    [0.26, 0.53, 0.78].forEach((v) => {
      const start = interpolatePolygonPoint(polygon, 0.08, v);
      const end = interpolatePolygonPoint(polygon, 0.92, v + ((pseudoRandom(seedBase + v * 100) - 0.5) * 0.035));
      graphics.lineBetween(start.x, start.y, end.x, end.y);
    });

    for (let index = 0; index < 24; index += 1) {
      const u = 0.08 + (pseudoRandom(seedBase + index + 1) * 0.84);
      const v = 0.08 + (pseudoRandom(seedBase + index + 31) * 0.84);
      const point = interpolatePolygonPoint(polygon, u, v);
      const light = index % 3 === 0;
      graphics.fillStyle(light ? 0xe8e0d2 : 0x6f685f, light ? 0.15 : 0.1);
      graphics.fillCircle(point.x, point.y, light ? 1.2 : 0.9);
    }
  }

  rotateLocalPoint(point, degrees = 0) {
    const radians = (degrees * Math.PI) / 180;
    return {
      x: (point.x * Math.cos(radians)) - (point.y * Math.sin(radians)),
      y: (point.x * Math.sin(radians)) + (point.y * Math.cos(radians))
    };
  }

  mapBoardPoint(point = {}, rotation = 0) {
    const rotated = this.rotateLocalPoint({ x: point.x || 0, y: point.y || 0 }, rotation);
    return {
      x: 80 + (rotated.x * 78),
      y: 91 + (rotated.y * 44)
    };
  }

  mapBoardPointOnTile(point = {}, rotation = 0, geometry = null) {
    if (!geometry?.top || geometry.top.length < 4) return this.mapBoardPoint(point, rotation);
    const rotated = this.rotateLocalPoint({ x: point.x || 0, y: point.y || 0 }, rotation);
    const u = Math.max(0, Math.min(1, rotated.x + 0.5));
    const v = Math.max(0, Math.min(1, rotated.y + 0.5));
    const [nw, ne, se, sw] = geometry.top;
    return {
      x: (nw.x * (1 - u) * (1 - v)) + (ne.x * u * (1 - v)) + (se.x * u * v) + (sw.x * (1 - u) * v),
      y: (nw.y * (1 - u) * (1 - v)) + (ne.y * u * (1 - v)) + (se.y * u * v) + (sw.y * (1 - u) * v)
    };
  }

  mapBoardPointOnWall(point = {}, rotation = 0, wallPolygon = null) {
    if (!Array.isArray(wallPolygon) || wallPolygon.length < 4) return this.mapBoardPoint(point, rotation);
    const rotated = this.rotateLocalPoint({ x: point.x || 0, y: point.y || 0 }, rotation);
    const u = Math.max(0, Math.min(1, rotated.x + 0.5));
    const v = Math.max(0, Math.min(1, rotated.y + 0.5));
    const [bottomLeft, bottomRight, topRight, topLeft] = wallPolygon;
    return {
      x: (topLeft.x * (1 - u) * (1 - v)) + (topRight.x * u * (1 - v)) + (bottomRight.x * u * v) + (bottomLeft.x * (1 - u) * v),
      y: (topLeft.y * (1 - u) * (1 - v)) + (topRight.y * u * (1 - v)) + (bottomRight.y * u * v) + (bottomLeft.y * (1 - u) * v)
    };
  }

  drawTransmissionSkeleton(graphics, material, rotation = 0, geometry = null) {
    const ports = material.transmissionSkeleton?.ports || [];
    if (ports.length <= 0) return;
    const center = this.mapBoardPointOnTile({ x: 0, y: 0 }, rotation, geometry);
    graphics.lineStyle(8, 0xfacc15, 0.94);
    ports.forEach((port) => {
      const point = this.mapBoardPointOnTile(port.localPosition, rotation, geometry);
      graphics.lineBetween(center.x, center.y, point.x, point.y);
    });
    graphics.lineStyle(2, 0x78350f, 0.82);
    ports.forEach((port) => {
      const point = this.mapBoardPointOnTile(port.localPosition, rotation, geometry);
      const rotated = this.rotateLocalPoint(port.localPosition || {}, rotation);
      const isHorizontalEdge = Math.abs(rotated.y || 0) >= Math.abs(rotated.x || 0);
      graphics.fillStyle(0xf8fafc, 0.2);
      graphics.fillEllipse(point.x, point.y, isHorizontalEdge ? 28 : 14, isHorizontalEdge ? 14 : 28);
      graphics.strokeEllipse(point.x, point.y, isHorizontalEdge ? 28 : 14, isHorizontalEdge ? 14 : 28);
      graphics.fillStyle(0xf8fafc, 0.95);
      graphics.fillCircle(point.x, point.y, 4);
    });
    graphics.fillStyle(0xfacc15, 0.95);
    graphics.fillCircle(center.x, center.y, ports.length > 1 ? 6 : 0);
  }

  drawWallTransmissionSkeleton(graphics, material, wallPolygon, rotation = 0) {
    const ports = material.transmissionSkeleton?.ports || [];
    if (ports.length <= 0) return;
    const center = this.mapBoardPointOnWall({ x: 0, y: 0 }, rotation, wallPolygon);
    graphics.lineStyle(8, 0xfacc15, 0.94);
    ports.forEach((port) => {
      const point = this.mapBoardPointOnWall(port.localPosition, rotation, wallPolygon);
      graphics.lineBetween(center.x, center.y, point.x, point.y);
    });
    graphics.lineStyle(2, 0x78350f, 0.82);
    ports.forEach((port) => {
      const point = this.mapBoardPointOnWall(port.localPosition, rotation, wallPolygon);
      const rotated = this.rotateLocalPoint(port.localPosition || {}, rotation);
      const isHorizontalEdge = Math.abs(rotated.y || 0) >= Math.abs(rotated.x || 0);
      graphics.fillStyle(0xf8fafc, 0.2);
      graphics.fillEllipse(point.x, point.y, isHorizontalEdge ? 28 : 14, isHorizontalEdge ? 14 : 28);
      graphics.strokeEllipse(point.x, point.y, isHorizontalEdge ? 28 : 14, isHorizontalEdge ? 14 : 28);
      graphics.fillStyle(0xf8fafc, 0.95);
      graphics.fillCircle(point.x, point.y, 4);
    });
    graphics.fillStyle(0xfacc15, 0.95);
    graphics.fillCircle(center.x, center.y, ports.length > 1 ? 6 : 0);
  }

  drawGearIcon(graphics, cx, cy, radius = 16, teeth = 10, hubColor = 0x67e8f9) {
    const points = [];
    for (let index = 0; index < teeth * 2; index += 1) {
      const angle = (Math.PI * 2 * index) / (teeth * 2);
      const r = index % 2 === 0 ? radius : radius * 0.76;
      points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    }
    graphics.fillStyle(0x020617, 0.96);
    graphics.lineStyle(2, 0xf8fafc, 0.42);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => graphics.lineTo(point.x, point.y));
    graphics.closePath();
    graphics.fillPath();
    graphics.strokePath();
    graphics.fillStyle(hubColor, 0.92);
    graphics.fillCircle(cx, cy, radius * 0.24);
  }

  drawGearMounts(graphics, material, rotation = 0) {
    const mounts = Array.isArray(material.gearMounts) ? material.gearMounts : [];
    mounts.forEach((mount) => {
      const point = this.mapBoardPoint(getGearMountLocalPosition(mount.position), rotation);
      this.drawGearIcon(
        graphics,
        point.x,
        point.y,
        mount.position === 'center' ? 18 : 13,
        10,
        mount.axisType === 'fixedAxis' ? 0x22d3ee : 0xf8fafc
      );
    });
  }

  drawWallGearMounts(graphics, material, wallPolygon, rotation = 0) {
    const mounts = Array.isArray(material.gearMounts) ? material.gearMounts : [];
    mounts.forEach((mount) => {
      const point = this.mapBoardPointOnWall(getGearMountLocalPosition(mount.position), rotation, wallPolygon);
      this.drawGearIcon(
        graphics,
        point.x,
        point.y,
        mount.position === 'center' ? 18 : 13,
        10,
        mount.axisType === 'fixedAxis' ? 0x22d3ee : 0xf8fafc
      );
    });
  }

  destroy() {
    this.generatedKeys.forEach((key) => {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    });
    this.generatedKeys.clear();
  }
}

export default CityChannelTextureCache;
