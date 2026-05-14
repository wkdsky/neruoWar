import { CITY_CHANNEL_TILE_TYPES, createCellKey } from './cityChannelSchema';

export const CITY_CHANNEL_TRIGGER_MECHANISM_TYPES = new Set([
  CITY_CHANNEL_TILE_TYPES.VERTICAL_PUSH_BUTTON,
  CITY_CHANNEL_TILE_TYPES.HORIZONTAL_PUSH_BUTTON,
  CITY_CHANNEL_TILE_TYPES.ROTARY_BUTTON
]);

export const DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS = {
  durationSeconds: 1.5,
  rotationAngle: 90
};

export const CITY_CHANNEL_MECHANISM_LIMITS = {
  durationSeconds: { min: 0.5, max: 8, step: 0.5 },
  rotationAngle: { min: 15, max: 360, step: 15 }
};

const clampToStep = (value, { min, max, step }) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  const clamped = Math.max(min, Math.min(max, parsed));
  return Number((Math.round(clamped / step) * step).toFixed(2));
};

export const normalizeMechanismParams = (params = {}) => ({
  durationSeconds: clampToStep(
    params.durationSeconds ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.durationSeconds,
    CITY_CHANNEL_MECHANISM_LIMITS.durationSeconds
  ),
  rotationAngle: clampToStep(
    params.rotationAngle ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.rotationAngle,
    CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle
  )
});

export const isTriggerMechanismTile = (panelType) => CITY_CHANNEL_TRIGGER_MECHANISM_TYPES.has(panelType);

export const getMechanismParamKey = (cell) => (
  cell ? createCellKey(cell.x, cell.y, cell.z) : ''
);
