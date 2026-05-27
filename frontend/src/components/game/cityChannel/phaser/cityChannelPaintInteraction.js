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
