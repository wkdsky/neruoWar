import { CITY_CHANNEL_TILE_TYPES } from './cityChannelSchema';

export const isGearPressurePlatePanel = (panelType) => (
  panelType === CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
);
