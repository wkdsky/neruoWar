export const compareCityChannelHits = (a, b, { preferOcclusion = false } = {}) => {
  const bothGearSurface = !!(a.gearSurfacePlane && b.gearSurfacePlane);
  if (bothGearSurface) {
    const depthDelta = (b.depth || 0) - (a.depth || 0);
    if (depthDelta !== 0) return depthDelta;
  }

  const snapPriorityDelta = (b.snapPriority || 0) - (a.snapPriority || 0);
  if (snapPriorityDelta !== 0) return snapPriorityDelta;

  if (preferOcclusion) {
    const depthDelta = (b.depth || 0) - (a.depth || 0);
    if (depthDelta !== 0) return depthDelta;
    return (a.snapDistanceSquared ?? Infinity) - (b.snapDistanceSquared ?? Infinity);
  }

  const selectionPriorityDelta = (b.selectionPriority || 0) - (a.selectionPriority || 0);
  if (selectionPriorityDelta !== 0) return selectionPriorityDelta;

  const depthDelta = (b.depth || 0) - (a.depth || 0);
  if (depthDelta !== 0) return depthDelta;

  const snapDistanceDelta = (a.snapDistanceSquared ?? Infinity) - (b.snapDistanceSquared ?? Infinity);
  if (snapDistanceDelta !== 0) return snapDistanceDelta;

  return 0;
};

export const PAINT_DRAG_START_DISTANCE = 10;

const readPointerCoordinate = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const shouldStartPaintDrag = (dragState = {}, pointer = {}) => {
  const pointerX = readPointerCoordinate(pointer.x);
  const pointerY = readPointerCoordinate(pointer.y);
  const startX = readPointerCoordinate(dragState.startX, pointerX);
  const startY = readPointerCoordinate(dragState.startY, pointerY);
  return Math.hypot(pointerX - startX, pointerY - startY) >= PAINT_DRAG_START_DISTANCE;
};
