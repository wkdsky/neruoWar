import { CITY_CHANNEL_TILE_TYPES } from './cityChannelSchema';

export const isGearPressurePlatePanel = (panelType) => (
  panelType === CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
);

export const hasDirectionalGearSurface = () => false;

export const normalizeGearSurfaceForPanel = () => 'front';

export const getGearSurfaceOffsetSignForPanel = () => 0;

export const getGearSurfaceNormalSignForPanel = () => 1;
