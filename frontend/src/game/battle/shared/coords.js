export const worldToMinimap = (worldX, worldY, fieldW, fieldH) => ({
  mx: (Number(worldX) || 0) + (Math.max(1, Number(fieldW) || 1) / 2),
  my: (Math.max(1, Number(fieldH) || 1) / 2) - (Number(worldY) || 0)
});

export const minimapToWorld = (mx, my, fieldW, fieldH) => ({
  x: (Number(mx) || 0) - (Math.max(1, Number(fieldW) || 1) / 2),
  y: (Math.max(1, Number(fieldH) || 1) / 2) - (Number(my) || 0)
});
