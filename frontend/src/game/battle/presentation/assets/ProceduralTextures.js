const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));

const paintLayer = (size, painter) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array(size * size * 4);
  painter(ctx, size);
  const img = ctx.getImageData(0, 0, size, size);
  return img.data;
};

const createTextureArray = (gl, size, layers, painters) => {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (let i = 0; i < layers; i += 1) {
    const painter = painters[i] || painters[painters.length - 1];
    const data = paintLayer(size, painter);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return tex;
};

const paintCircle = (ctx, size, colorA, colorB) => {
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.1, size * 0.5, size * 0.5, size * 0.5);
  grad.addColorStop(0, colorA);
  grad.addColorStop(1, colorB);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, size * 0.48, 0, Math.PI * 2);
  ctx.fill();
};

const paintArrow = (ctx, size) => {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(225, 241, 255, 0.92)';
  ctx.beginPath();
  ctx.moveTo(size * 0.14, size * 0.58);
  ctx.lineTo(size * 0.7, size * 0.58);
  ctx.lineTo(size * 0.7, size * 0.72);
  ctx.lineTo(size * 0.92, size * 0.5);
  ctx.lineTo(size * 0.7, size * 0.28);
  ctx.lineTo(size * 0.7, size * 0.42);
  ctx.lineTo(size * 0.14, size * 0.42);
  ctx.closePath();
  ctx.fill();
};

const paintRing = (ctx, size, rgba = 'rgba(255, 170, 70, 0.95)') => {
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = rgba;
  ctx.lineWidth = size * 0.16;
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, size * 0.34, 0, Math.PI * 2);
  ctx.stroke();
};

const paintSmoke = (ctx, size) => {
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x / Math.max(1, size - 1)) - 0.5;
      const dy = (y / Math.max(1, size - 1)) - 0.5;
      const rr = Math.hypot(dx, dy);
      const n = Math.sin((x * 0.29) + (y * 0.37)) * 0.5 + 0.5;
      const a = clampByte((1 - rr) * 180 * n);
      const idx = ((y * size) + x) * 4;
      data[idx + 0] = 160 + Math.floor(n * 30);
      data[idx + 1] = 160 + Math.floor(n * 30);
      data[idx + 2] = 168 + Math.floor(n * 34);
      data[idx + 3] = Math.max(0, a);
    }
  }
  ctx.putImageData(img, 0, 0);
};

export const createBattleProceduralTextures = (gl) => {
  if (!gl) return null;
  const unitLayerCount = 64;
  const unitPainters = [];
  for (let i = 0; i < unitLayerCount; i += 1) {
    const hue = (i % unitLayerCount) / Math.max(1, unitLayerCount);
    const primary = `hsla(${Math.round(hue * 360)}, 76%, 70%, 0.95)`;
    const secondary = `hsla(${Math.round(hue * 360)}, 70%, 22%, 0)`;
    if (i % 11 === 0) {
      unitPainters.push((ctx, size) => paintArrow(ctx, size));
    } else if (i % 7 === 0) {
      unitPainters.push((ctx, size) => paintRing(ctx, size, `hsla(${Math.round(hue * 360)}, 88%, 66%, 0.92)`));
    } else if (i % 5 === 0) {
      unitPainters.push((ctx, size) => paintSmoke(ctx, size));
    } else {
      unitPainters.push((ctx, size) => paintCircle(ctx, size, primary, secondary));
    }
  }
  const unitTexArray = createTextureArray(gl, 64, unitLayerCount, unitPainters);

  const projectileTexArray = createTextureArray(gl, 32, 4, [
    (ctx, size) => paintCircle(ctx, size, 'rgba(235, 250, 255, 0.95)', 'rgba(60, 110, 160, 0)'),
    (ctx, size) => paintCircle(ctx, size, 'rgba(255, 224, 160, 0.95)', 'rgba(145, 80, 10, 0)'),
    (ctx, size) => paintRing(ctx, size, 'rgba(255, 156, 64, 0.92)'),
    (ctx, size) => paintSmoke(ctx, size)
  ]);

  const effectTexArray = createTextureArray(gl, 64, 6, [
    (ctx, size) => paintRing(ctx, size, 'rgba(96, 214, 255, 0.92)'),
    (ctx, size) => paintRing(ctx, size, 'rgba(255, 158, 94, 0.94)'),
    (ctx, size) => paintRing(ctx, size, 'rgba(124, 255, 146, 0.88)'),
    (ctx, size) => paintSmoke(ctx, size),
    (ctx, size) => paintCircle(ctx, size, 'rgba(255, 220, 128, 0.95)', 'rgba(80, 50, 10, 0)'),
    (ctx, size) => paintArrow(ctx, size)
  ]);

  return {
    unitTexArray,
    unitTexLayerCount: unitLayerCount,
    projectileTexArray,
    effectTexArray,
    dispose() {
      if (unitTexArray) gl.deleteTexture(unitTexArray);
      if (projectileTexArray) gl.deleteTexture(projectileTexArray);
      if (effectTexArray) gl.deleteTexture(effectTexArray);
    }
  };
};

export default createBattleProceduralTextures;
