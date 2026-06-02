import { CITY_CHANNEL_TILE_TYPES } from './cityChannelSchema';

export const isGearPressurePlatePanel = (panelType) => (
  panelType === CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
);

export const hasDirectionalGearSurface = (panelType) => isGearPressurePlatePanel(panelType);

export const normalizeGearSurfaceForPanel = (panelType, surface = 'front') => (
  hasDirectionalGearSurface(panelType) && surface === 'back' ? 'back' : 'front'
);

export const getGearSurfaceOffsetSignForPanel = (panelType, surface = 'front') => {
  if (!hasDirectionalGearSurface(panelType)) return 0;
  return surface === 'back' ? -1 : 1;
};

export const getGearSurfaceNormalSignForPanel = (panelType, surface = 'front') => (
  normalizeGearSurfaceForPanel(panelType, surface) === 'back' ? -1 : 1
);
