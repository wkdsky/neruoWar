import React, { useEffect, useRef } from 'react';
import { resolveUnitClassMeta } from './unitClassMeta';

const colorFromHex = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return fallback;
  return Number.parseInt(text, 16);
};

const numberToCanvasColor = (value, fallback = '#5aa3ff') => {
  const safe = Number.isFinite(Number(value)) ? Number(value) : null;
  if (safe === null) return fallback;
  return `#${Math.max(0, Math.min(0xffffff, safe)).toString(16).padStart(6, '0')}`;
};

const getUnitPreviewPalette = (unit = {}) => {
  const palette = unit?.visuals?.preview?.palette || {};
  const meta = resolveUnitClassMeta(unit);
  return {
    primary: numberToCanvasColor(colorFromHex(palette.primary, meta.floor || 0x5aa3ff)),
    secondary: numberToCanvasColor(colorFromHex(palette.secondary, 0xcfd8e3)),
    accent: numberToCanvasColor(colorFromHex(palette.accent, 0xffd166))
  };
};

const resizeCanvasFor2d = (canvas) => {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width || canvas.clientWidth || 320));
  const height = Math.max(1, Math.floor(rect.height || canvas.clientHeight || 220));
  const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.floor(width * ratio));
  const pixelHeight = Math.max(1, Math.floor(height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
};

const drawUnitFigure2d = (ctx, unit = {}, rotationDeg = 0, options = {}) => {
  const width = Number(options.width) || 320;
  const height = Number(options.height) || 220;
  const palette = getUnitPreviewPalette(unit);
  const meta = resolveUnitClassMeta(unit);
  const yaw = ((Number(rotationDeg) || 0) * Math.PI) / 180;
  const side = Math.sin(yaw);
  const front = Math.max(0.36, Math.cos(yaw) * 0.24 + 0.76);
  const cx = width * 0.5;
  const cy = height * (options.battle ? 0.55 : 0.57);
  const scale = Math.max(0.68, Math.min(1.35, Math.min(width / 320, height / 220)));
  const bodyW = (options.battle ? 28 : 42) * scale * front;
  const bodyH = (options.battle ? 52 : 72) * scale;
  const headR = (options.battle ? 10 : 15) * scale;
  const floorY = cy + bodyH * 0.58;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(cx, floorY);
  ctx.scale(1, 0.26);
  const baseGradient = ctx.createRadialGradient(0, 0, 2, 0, 0, 70 * scale);
  baseGradient.addColorStop(0, options.battle ? 'rgba(74, 222, 128, 0.36)' : 'rgba(148, 163, 184, 0.34)');
  baseGradient.addColorStop(1, 'rgba(15, 23, 42, 0.02)');
  ctx.fillStyle = baseGradient;
  ctx.beginPath();
  ctx.arc(0, 0, 70 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx + side * 12 * scale, cy);
  ctx.rotate(side * 0.12);

  ctx.fillStyle = 'rgba(2, 6, 23, 0.32)';
  ctx.beginPath();
  ctx.ellipse(0, bodyH * 0.62, bodyW * 0.95, 7 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.secondary;
  ctx.beginPath();
  ctx.roundRect(-bodyW * 0.62, bodyH * 0.45, bodyW * 1.24, 14 * scale, 7 * scale);
  ctx.fill();

  const bodyGradient = ctx.createLinearGradient(-bodyW, -bodyH * 0.2, bodyW, bodyH * 0.45);
  bodyGradient.addColorStop(0, palette.primary);
  bodyGradient.addColorStop(1, '#0f172a');
  ctx.fillStyle = bodyGradient;
  ctx.beginPath();
  ctx.roundRect(-bodyW * 0.58, -bodyH * 0.28, bodyW * 1.16, bodyH * 0.82, 15 * scale);
  ctx.fill();

  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.roundRect(-bodyW * 0.46, bodyH * 0.02, bodyW * 0.92, 5 * scale, 3 * scale);
  ctx.fill();

  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = Math.max(3, 4 * scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bodyW * 0.45, -bodyH * 0.12);
  ctx.lineTo(bodyW * 0.9 + side * 12 * scale, bodyH * 0.48);
  ctx.stroke();

  ctx.fillStyle = palette.secondary;
  ctx.beginPath();
  ctx.arc(0, -bodyH * 0.46, headR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.accent;
  if (meta.key === 'archer') {
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(3, 5 * scale);
    ctx.beginPath();
    ctx.arc(bodyW * 0.82, -bodyH * 0.02, 20 * scale, -Math.PI * 0.5, Math.PI * 0.55);
    ctx.stroke();
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.beginPath();
    ctx.moveTo(bodyW * 0.82, -bodyH * 0.36);
    ctx.lineTo(bodyW * 0.82, bodyH * 0.32);
    ctx.stroke();
  } else if (meta.key === 'cavalry') {
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.28, -bodyH * 0.68);
    ctx.lineTo(bodyW * 0.2, -bodyH * 0.92);
    ctx.lineTo(bodyW * 0.56, -bodyH * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-bodyW * 0.86, bodyH * 0.42, bodyW * 1.72, Math.max(3, 4 * scale));
  } else if (meta.key === 'artillery') {
    ctx.fillStyle = palette.accent;
    ctx.save();
    ctx.translate(bodyW * 0.55, -bodyH * 0.02);
    ctx.rotate(-0.08);
    ctx.fillRect(0, -4 * scale, 38 * scale, 8 * scale);
    ctx.restore();
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(-bodyW * 0.7, bodyH * 0.58, 7 * scale, 0, Math.PI * 2);
    ctx.arc(bodyW * 0.68, bodyH * 0.58, 7 * scale, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(-bodyW * 0.56, -bodyH * 0.05, 12 * scale, 17 * scale, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = Math.max(3, 4 * scale);
    ctx.beginPath();
    ctx.moveTo(bodyW * 0.65, -bodyH * 0.42);
    ctx.lineTo(bodyW * 0.98, bodyH * 0.45);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.beginPath();
  ctx.ellipse(-bodyW * 0.18, -bodyH * 0.17, bodyW * 0.16, bodyH * 0.28, -0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
  ctx.beginPath();
  ctx.arc(0, bodyH * 0.01, 19 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = meta.color;
  ctx.lineWidth = Math.max(2, 3 * scale);
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.font = `700 ${Math.round(22 * scale)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.mark || '?', 0, bodyH * 0.015);
  ctx.restore();
};

export const ArmyUnitCloseupCanvasPreview = ({ unit, rotationDeg = 0, className = '' }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let raf = 0;
    const renderFrame = () => {
      const result = resizeCanvasFor2d(canvas);
      if (result) {
        drawUnitFigure2d(result.ctx, unit, rotationDeg, {
          width: result.width,
          height: result.height,
          battle: false
        });
      }
    };
    raf = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [unit, rotationDeg]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
};

export const ArmyUnitBattleCanvasPreview = ({ unit, rotationDeg = 0, className = '' }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let raf = 0;
    const renderFrame = () => {
      const result = resizeCanvasFor2d(canvas);
      if (result) {
        drawUnitFigure2d(result.ctx, unit, rotationDeg, {
          width: result.width,
          height: result.height,
          battle: true
        });
      }
    };
    raf = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [unit, rotationDeg]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
};
