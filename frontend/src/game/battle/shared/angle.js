const TAU = Math.PI * 2;

export const normalizeDeg = (deg) => {
  const raw = Number(deg) || 0;
  return ((raw % 360) + 360) % 360;
};

export const degToRad = (deg) => (normalizeDeg(deg) * Math.PI) / 180;

export const radToDeg = (rad) => ((Number(rad) || 0) * 180) / Math.PI;

export const normalizeRad = (rad) => {
  const raw = Number(rad) || 0;
  const wrapped = ((raw + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return wrapped <= -Math.PI ? Math.PI : wrapped;
};

export const yawDegToUnitVec2 = (deg) => {
  const yawRad = degToRad(deg);
  return {
    x: Math.cos(yawRad),
    y: Math.sin(yawRad)
  };
};
