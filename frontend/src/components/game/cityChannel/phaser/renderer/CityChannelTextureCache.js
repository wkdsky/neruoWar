import { CITY_CHANNEL_TILE_TYPES } from '../../cityChannelSchema';
import { getCityChannelMaterial, isMechanicalMaterial } from '../../cityChannelCatalog';
import { getGearMountLocalPosition, isTriggerMechanismTile } from '../../cityChannelMechanismRuntime';
import {
  TILE_RENDER_HEIGHT,
  TILE_RENDER_WIDTH,
  createEdgeWallGeometry,
  createPortalGeometry,
  createTileGeometry,
  createVerticalTileWallGeometry,
  getVerticalMiterTextureKey,
  getTransmissionMidPlane
} from './CityChannelGeometry';
import { isGearPressurePlatePanel } from '../../cityChannelGearPressurePlateRender';

export const TILE_TEXTURE_SUPERSAMPLE = 2;
const TEXTURE_YAW_STEP = 2;
const TEXTURE_RENDER_WIDTH = TILE_RENDER_WIDTH * TILE_TEXTURE_SUPERSAMPLE;
const TEXTURE_RENDER_HEIGHT = TILE_RENDER_HEIGHT * TILE_TEXTURE_SUPERSAMPLE;
const TRANSMISSION_TRACE_ALPHA = 0.28;
const TRANSMISSION_STUB_ALPHA = 0.9;
const TRANSMISSION_STUB_LENGTH = 15;

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
  entrance: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 },
  exit: { top: 0xb8b1a4, side: 0x756f64, edge: 0xd8d2c4 }
};

const drawPolygonPath = (graphics, points = []) => {
  if (!Array.isArray(points) || points.length < 3) return;
  graphics.beginPath();
  graphics.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => graphics.lineTo(point.x, point.y));
  graphics.closePath();
};

const drawPolygon = (graphics, points, fill, alpha = 1, stroke = 0x0f172a, strokeAlpha = 0.55) => {
  if (!Array.isArray(points) || points.length < 3) return;
  graphics.fillStyle(fill, alpha);
  graphics.lineStyle(1, stroke, strokeAlpha);
  drawPolygonPath(graphics, points);
  graphics.fillPath();
  graphics.strokePath();
  graphics.lineStyle(2, 0x111827, 0.58);
  drawPolygonPath(graphics, points);
  graphics.strokePath();
};

const colorToRgba = (color, alpha = 1) => {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getInsetPoint = (start, end, distance = 0) => {
  if (!start || !end) return end || start || { x: 0, y: 0 };
  const dx = start.x - end.x;
  const dy = start.y - end.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  return {
    x: end.x + ((dx / length) * distance),
    y: end.y + ((dy / length) * distance)
  };
};

const drawCanvasTransmissionTrace = (ctx, center, point) => {
  const traceEnd = getInsetPoint(center, point, TRANSMISSION_STUB_LENGTH + 2);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = colorToRgba(0x78350f, 0.2);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(center.x, center.y);
  ctx.lineTo(traceEnd.x, traceEnd.y);
  ctx.stroke();
  ctx.strokeStyle = colorToRgba(0xfacc15, TRANSMISSION_TRACE_ALPHA);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(center.x, center.y);
  ctx.lineTo(traceEnd.x, traceEnd.y);
  ctx.stroke();
  ctx.restore();
};

const drawCanvasTransmissionSocket = (ctx, center, point, connected = false) => {
  const inner = getInsetPoint(center, point, connected ? TRANSMISSION_STUB_LENGTH + 4 : TRANSMISSION_STUB_LENGTH);
  const dx = center.x - point.x;
  const dy = center.y - point.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const cross = { x: -(dy / length), y: dx / length };
  const alpha = connected ? 0.94 : TRANSMISSION_STUB_ALPHA;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = colorToRgba(0x78350f, alpha * 0.72);
  ctx.lineWidth = connected ? 6 : 5;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(inner.x, inner.y);
  ctx.stroke();
  ctx.strokeStyle = colorToRgba(0xfacc15, alpha);
  ctx.lineWidth = connected ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(inner.x, inner.y);
  ctx.stroke();
  ctx.fillStyle = colorToRgba(0x451a03, alpha * 0.82);
  ctx.beginPath();
  ctx.arc(point.x, point.y, connected ? 4.5 : 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colorToRgba(connected ? 0xfef3c7 : 0xfacc15, connected ? 0.88 : 0.62);
  ctx.beginPath();
  ctx.arc(point.x + (cross.x * 2), point.y + (cross.y * 2), connected ? 1.6 : 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(point.x - (cross.x * 2), point.y - (cross.y * 2), connected ? 1.6 : 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
    ctx.setLineDash([]);
    ctx.lineWidth = lineWidth + 0.8;
    ctx.strokeStyle = colorToRgba(0x111827, 0.62);
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
  return Math.round(normalized / TEXTURE_YAW_STEP) * TEXTURE_YAW_STEP % 360;
};

export class CityChannelTextureCache {
  constructor(scene) {
    this.scene = scene;
    this.generatedKeys = new Set();
  }

  getTileTexture(panelType, rotation = 0, cameraYaw = 0, transmissionRotation = rotation, options = {}) {
    const textureYaw = getTextureYawBucket(cameraYaw);
    const verticalKey = options?.isVertical ? ':v1' : '';
    const miterKey = options?.isVertical ? getVerticalMiterTextureKey(options?.miter) : '';
    const key = `cc:tile:${panelType}:r${rotation}:tr${transmissionRotation}:y${textureYaw}${verticalKey}${miterKey}`;
    if (!this.generatedKeys.has(key)) this.createTileTexture(key, panelType, rotation, textureYaw, transmissionRotation, options);
    return key;
  }

  getWallTexture(panelType, edge = 'north', wallViewMode = 'semi', cameraYaw = 0, rotation = 0, miter = null, transmissionRotation = rotation) {
    const textureYaw = getTextureYawBucket(cameraYaw);
    const miterKey = miter ? `:m${Number(miter.start) || 0}_${Number(miter.end) || 0}` : ':m0_0';
    const key = `cc:wall:v2:${panelType}:${edge}:r${rotation}:tr${transmissionRotation}:${wallViewMode}:y${textureYaw}${miterKey}`;
    if (!this.generatedKeys.has(key)) this.createWallTexture(key, panelType, edge, wallViewMode, textureYaw, rotation, miter, transmissionRotation);
    return key;
  }

  createTileTexture(key, panelType, rotation, cameraYaw, transmissionRotation = rotation, options = {}) {
    const material = getCityChannelMaterial(panelType);
    const colors = colorByPanelType[material.id] || colorByPanelType.basic_plate;
    const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
    graphics.scaleCanvas(TILE_TEXTURE_SUPERSAMPLE, TILE_TEXTURE_SUPERSAMPLE);
    const geometry = options?.isVertical
      ? createVerticalTileWallGeometry(cameraYaw, rotation, transmissionRotation, options?.miter)
      : createTileGeometry(cameraYaw, rotation);
    const alpha = material.id === CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
      ? (colors.alpha || 0.94)
      : (isTriggerMechanismTile(panelType) ? 0.38 : (colors.alpha || 1));

    if (options?.isVertical) {
      drawPolygon(graphics, geometry.wallBack || geometry.wall, colors.side, alpha * 0.82, colors.edge, 0.34);
      drawPolygon(graphics, geometry.wallSideStart, colors.side, alpha * 0.76, 0xe2e8f0, 0.24);
      drawPolygon(graphics, geometry.wallSideEnd, colors.side, alpha * 0.68, 0xe2e8f0, 0.22);
      drawPolygon(graphics, geometry.wallCap, 0x334155, alpha * 0.5, 0xe2e8f0, 0.32);
      drawPolygon(graphics, geometry.wallFront || geometry.wall, colors.top, alpha, colors.edge, 0.72);
      this.drawStoneSurface(graphics, geometry.wallFront || geometry.wall, material.id);
    } else {
      geometry.sides.forEach((side, index) => {
        drawPolygon(graphics, side, colors.side, index === 0 ? 0.92 : 0.72, 0x0f172a, 0.5);
      });
      drawPolygon(graphics, geometry.top, colors.top, alpha, colors.edge, 0.72);
      this.drawStoneSurface(graphics, geometry.top, material.id);
    }

    if (panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || panelType === CITY_CHANNEL_TILE_TYPES.EXIT) {
      this.drawPortalModel(graphics, panelType, rotation, cameraYaw);
    } else if (isGearPressurePlatePanel(panelType)) {
      if (options?.isVertical) {
        const transmissionPlane = getTransmissionMidPlane(geometry, 'wall');
        this.drawWallTransmissionSkeleton(graphics, material, transmissionPlane, 0);
      } else {
        this.drawTransmissionSkeleton(graphics, material, transmissionRotation, geometry);
        this.drawGearPressurePlateCornerHint(graphics, geometry, 0.24);
      }
    } else {
      if (options?.isVertical) {
        const transmissionPlane = getTransmissionMidPlane(geometry, 'wall');
        const gearMountPlane = transmissionPlane;
        this.drawWallTransmissionSkeleton(graphics, material, transmissionPlane, 0);
        this.drawWallGearMounts(graphics, material, gearMountPlane, 0);
      } else {
        this.drawTransmissionSkeleton(graphics, material, transmissionRotation, geometry);
        this.drawGearMounts(graphics, material, transmissionRotation);
      }
      if (material.gearIcon) this.drawGearIcon(graphics, 80, 91, 16, 10, 0xfacc15);
      else if (isMechanicalMaterial(material) && !material.transmissionSkeleton && !material.gearMounts?.length) {
        this.drawMechanismGlyph(graphics, panelType);
      }
    }

    graphics.generateTexture(key, TEXTURE_RENDER_WIDTH, TEXTURE_RENDER_HEIGHT);
    graphics.destroy();
    this.generatedKeys.add(key);
  }

  createWallTexture(key, panelType, edge, wallViewMode, cameraYaw, rotation = 0, miter = null, transmissionRotation = rotation) {
    const material = getCityChannelMaterial(panelType);
    const colors = colorByPanelType[material.id] || colorByPanelType.basic_plate;
    const geometry = createEdgeWallGeometry(cameraYaw, edge, miter);
    const isSemi = wallViewMode === 'semi';
    if (isSemi) {
      const runtimeGeometry = createEdgeWallGeometry(cameraYaw, edge, miter, transmissionRotation);
      this.createSemiWallTexture(key, panelType, runtimeGeometry, colors, 0);
      return;
    }

    const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
    graphics.scaleCanvas(TILE_TEXTURE_SUPERSAMPLE, TILE_TEXTURE_SUPERSAMPLE);
    const isPerspective = wallViewMode === 'perspective';
    const isSolid = wallViewMode === 'solid';
    const baseAlpha = colors.alpha || 1;
    const wallAlpha = isPerspective ? 0.34 : baseAlpha;
    const outlineAlpha = isSolid ? 0 : (isPerspective ? 0.16 : 0.28);
    const hasStartMiter = !!geometry.miter?.start;
    const hasEndMiter = !!geometry.miter?.end;

    drawPolygon(graphics, geometry.wallBack || geometry.wall, colors.side, wallAlpha * 0.96, colors.edge, 0.42);
    if (!hasStartMiter) drawPolygon(graphics, geometry.wallSideStart, colors.side, wallAlpha * 0.9, 0xe2e8f0, 0.32);
    if (!hasEndMiter) drawPolygon(graphics, geometry.wallSideEnd, colors.side, wallAlpha * 0.78, 0xe2e8f0, 0.28);
    drawPolygon(graphics, geometry.wallCap, 0x334155, isSolid ? baseAlpha : Math.max(outlineAlpha, 0.22), 0xe2e8f0, 0.5);
    drawPolygon(graphics, geometry.wallFront || geometry.wall, colors.top, wallAlpha, colors.edge, 0.76);
    this.drawStoneSurface(graphics, geometry.wallFront || geometry.wall, material.id);
    const runtimeGeometry = createEdgeWallGeometry(cameraYaw, edge, miter, transmissionRotation);
    const transmissionPlane = getTransmissionMidPlane(runtimeGeometry, 'wall');
    const gearMountPlane = transmissionPlane;
    this.drawWallTransmissionSkeleton(graphics, material, transmissionPlane, 0);
    this.drawWallGearMounts(graphics, material, gearMountPlane, 0);
    if (material.gearIcon) {
      const center = this.mapBoardPointOnWall({ x: 0, y: 0 }, 0, gearMountPlane);
      this.drawGearIcon(graphics, center.x + 20, center.y - 8, 13, 10, 0xfacc15);
    }

    graphics.generateTexture(key, TEXTURE_RENDER_WIDTH, TEXTURE_RENDER_HEIGHT);
    graphics.destroy();
    this.generatedKeys.add(key);
  }

  createSemiWallTexture(key, panelType, geometry, colors, rotation = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_RENDER_WIDTH;
    canvas.height = TEXTURE_RENDER_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.scale(TILE_TEXTURE_SUPERSAMPLE, TILE_TEXTURE_SUPERSAMPLE);
    const baseAlpha = colors.alpha || 1;
    const hasStartMiter = !!geometry.miter?.start;
    const hasEndMiter = !!geometry.miter?.end;

    drawCanvasGradientPolygon(ctx, geometry.wallBack || geometry.wall, colors.side, baseAlpha * 0.94, geometry);
    if (!hasStartMiter) drawCanvasGradientPolygon(ctx, geometry.wallSideStart, colors.side, baseAlpha * 0.86, geometry);
    if (!hasEndMiter) drawCanvasGradientPolygon(ctx, geometry.wallSideEnd, colors.side, baseAlpha * 0.74, geometry);
    drawCanvasGradientPolygon(ctx, geometry.wallFront || geometry.wall, colors.top, baseAlpha, geometry);
    drawCanvasStoneSurface(ctx, geometry.wallFront || geometry.wall, panelType);

    const outline = colorToRgba(colors.edge, 0.72);
    const sideOutline = colorToRgba(0xe2e8f0, 0.46);
    [
      geometry.wallFront || geometry.wall,
      hasStartMiter ? null : geometry.wallSideStart,
      hasEndMiter ? null : geometry.wallSideEnd,
      geometry.wallCap
    ].forEach((points, index) => {
      if (!points) return;
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
      const transmissionPlane = getTransmissionMidPlane(geometry, 'wall');
      const center = this.mapBoardPointOnWall({ x: 0, y: 0 }, rotation, transmissionPlane);
      ports.forEach((port) => {
        const point = this.mapBoardPointOnWall(port.localPosition, rotation, transmissionPlane);
        drawCanvasTransmissionTrace(ctx, center, point);
      });
      ports.forEach((port) => {
        const point = this.mapBoardPointOnWall(port.localPosition, rotation, transmissionPlane);
        drawCanvasTransmissionSocket(ctx, center, point);
      });
      if (ports.length > 1) {
        ctx.fillStyle = colorToRgba(0xfacc15, 0.62);
        ctx.beginPath();
        ctx.arc(center.x, center.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    this.scene.textures.addCanvas(key, canvas);
    this.generatedKeys.add(key);
  }

  drawPortalGlyph(graphics, panelType) {
    const color = panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE ? 0x67e8f9 : 0xfacc15;
    graphics.lineStyle(3, color, 0.85);
    graphics.strokeRoundedRect(54, 70, 52, 28, 6);
    graphics.fillStyle(color, 0.22);
    graphics.fillRoundedRect(61, 76, 38, 16, 4);
  }

  drawPortalModel(graphics, panelType, rotation, cameraYaw) {
    const isEntrance = panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE;
    const accent = isEntrance ? 0x22d3ee : 0xfacc15;
    const frameColors = { stone: 0x64748b, light: 0x94a3b8, dark: 0x334155, edge: 0xe2e8f0, alpha: 0.96 };
    const deckColors = { stone: 0x111827, light: 0x1f2937, dark: 0x020617, edge: 0x475569, alpha: 0.98 };
    const hoodColors = { stone: 0x273449, light: 0x475569, dark: 0x0f172a, edge: 0x94a3b8, alpha: 0.98 };
    const portal = createPortalGeometry(cameraYaw, rotation);

    drawBoxPart(graphics, portal.threshold, deckColors);
    drawBoxPart(graphics, portal.leftPillar, frameColors);
    drawBoxPart(graphics, portal.rightPillar, frameColors);
    drawBoxPart(graphics, portal.arch, frameColors);
    drawBoxPart(graphics, portal.lintel, hoodColors);

    const arrow = isEntrance ? portal.arrow : portal.reverseArrow;
    drawPolygon(graphics, arrow, accent, 0.76, 0xffffff, 0.42);
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

  drawGearPressurePlateCornerHint(graphics, geometry = {}, alpha = 0.24) {
    const top = geometry.top;
    if (!Array.isArray(top) || top.length < 4) return;
    let cornerIndex = 0;
    let maxY = -Infinity;
    top.forEach((point, index) => {
      if (point.y > maxY) {
        maxY = point.y;
        cornerIndex = index;
      }
    });
    const corner = top[cornerIndex];
    const next = top[(cornerIndex + 1) % top.length];
    const prev = top[(cornerIndex + top.length - 1) % top.length];
    const inset = 0.3;
    const alongNext = {
      x: corner.x + ((next.x - corner.x) * inset),
      y: corner.y + ((next.y - corner.y) * inset)
    };
    const alongPrev = {
      x: corner.x + ((prev.x - corner.x) * inset),
      y: corner.y + ((prev.y - corner.y) * inset)
    };
    const inner = {
      x: (alongNext.x + alongPrev.x) * 0.5,
      y: (alongNext.y + alongPrev.y) * 0.5
    };

    graphics.fillStyle(0x0c4a6e, alpha);
    graphics.lineStyle(1, 0x67e8f9, Math.min(0.72, alpha + 0.22));
    graphics.fillTriangle(corner.x, corner.y, alongNext.x, alongNext.y, alongPrev.x, alongPrev.y);
    graphics.strokeTriangle(corner.x, corner.y, alongNext.x, alongNext.y, alongPrev.x, alongPrev.y);

    graphics.fillStyle(0x172033, alpha + 0.18);
    graphics.fillTriangle(alongNext.x, alongNext.y, alongPrev.x, alongPrev.y, inner.x, inner.y);

    const gearX = inner.x;
    const gearY = inner.y + 1;
    const points = [];
    const teeth = 6;
    const outer = 4.5;
    const innerR = 3.2;
    for (let index = 0; index < teeth * 2; index += 1) {
      const angle = (Math.PI * 2 * index) / (teeth * 2);
      const radius = index % 2 === 0 ? outer : innerR;
      points.push({
        x: gearX + (Math.cos(angle) * radius),
        y: gearY + (Math.sin(angle) * radius)
      });
    }
    graphics.fillStyle(0x020617, Math.min(0.82, alpha + 0.34));
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => graphics.lineTo(point.x, point.y));
    graphics.closePath();
    graphics.fillPath();
    graphics.fillStyle(0xf59e0b, Math.min(0.7, alpha + 0.28));
    graphics.fillCircle(gearX, gearY, 1.4);
  }

  drawTransmissionSkeleton(graphics, material, rotation = 0, geometry = null) {
    const ports = material.transmissionSkeleton?.ports || [];
    if (ports.length <= 0) return;
    const transmissionGeometry = { top: getTransmissionMidPlane(geometry, 'floor') };
    const center = this.mapBoardPointOnTile({ x: 0, y: 0 }, rotation, transmissionGeometry);
    ports.forEach((port) => {
      const point = this.mapBoardPointOnTile(port.localPosition, rotation, transmissionGeometry);
      this.drawTransmissionTrace(graphics, center, point);
    });
    ports.forEach((port) => {
      const point = this.mapBoardPointOnTile(port.localPosition, rotation, transmissionGeometry);
      this.drawTransmissionSocket(graphics, center, point);
    });
    if (ports.length > 1) {
      graphics.fillStyle(0xfacc15, 0.62);
      graphics.fillCircle(center.x, center.y, 4.5);
    }
  }

  drawWallTransmissionSkeleton(graphics, material, wallPolygon, rotation = 0) {
    const ports = material.transmissionSkeleton?.ports || [];
    if (ports.length <= 0) return;
    const center = this.mapBoardPointOnWall({ x: 0, y: 0 }, rotation, wallPolygon);
    ports.forEach((port) => {
      const point = this.mapBoardPointOnWall(port.localPosition, rotation, wallPolygon);
      this.drawTransmissionTrace(graphics, center, point);
    });
    ports.forEach((port) => {
      const point = this.mapBoardPointOnWall(port.localPosition, rotation, wallPolygon);
      this.drawTransmissionSocket(graphics, center, point);
    });
    if (ports.length > 1) {
      graphics.fillStyle(0xfacc15, 0.62);
      graphics.fillCircle(center.x, center.y, 4.5);
    }
  }

  drawTransmissionTrace(graphics, center, point) {
    const traceEnd = getInsetPoint(center, point, TRANSMISSION_STUB_LENGTH + 2);
    graphics.lineStyle(7, 0x78350f, 0.2);
    graphics.lineBetween(center.x, center.y, traceEnd.x, traceEnd.y);
    graphics.lineStyle(3, 0xfacc15, TRANSMISSION_TRACE_ALPHA);
    graphics.lineBetween(center.x, center.y, traceEnd.x, traceEnd.y);
  }

  drawTransmissionSocket(graphics, center, point, connected = false) {
    const inner = getInsetPoint(center, point, connected ? TRANSMISSION_STUB_LENGTH + 4 : TRANSMISSION_STUB_LENGTH);
    const dx = center.x - point.x;
    const dy = center.y - point.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const cross = { x: -(dy / length), y: dx / length };
    const alpha = connected ? 0.94 : TRANSMISSION_STUB_ALPHA;

    graphics.lineStyle(connected ? 6 : 5, 0x78350f, alpha * 0.72);
    graphics.lineBetween(point.x, point.y, inner.x, inner.y);
    graphics.lineStyle(connected ? 3 : 2, 0xfacc15, alpha);
    graphics.lineBetween(point.x, point.y, inner.x, inner.y);
    graphics.fillStyle(0x451a03, alpha * 0.82);
    graphics.fillCircle(point.x, point.y, connected ? 4.5 : 3.5);
    graphics.fillStyle(connected ? 0xfef3c7 : 0xfacc15, connected ? 0.88 : 0.62);
    graphics.fillCircle(point.x + (cross.x * 2), point.y + (cross.y * 2), connected ? 1.6 : 1.2);
    graphics.fillCircle(point.x - (cross.x * 2), point.y - (cross.y * 2), connected ? 1.6 : 1.2);
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
        mount.position === 'center' ? 18 : 16,
        10,
        mount.axisBinding ? 0xff8a3d : 0xf8fafc
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
        mount.position === 'center' ? 18 : 16,
        10,
        mount.axisBinding ? 0xff8a3d : 0xf8fafc
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
