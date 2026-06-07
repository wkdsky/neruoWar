import { CITY_CHANNEL_TILE_TYPES } from './cityChannelSchema';
import { createTileGeometry, getTransmissionMidPlane, getTransmissionPortPlane } from './phaser/renderer/CityChannelGeometry';
import {
  getGearSurfaceOffsetSignForPanel,
  hasDirectionalGearSurface,
  isGearPressurePlatePanel,
  normalizeGearSurfaceForPanel
} from './cityChannelGearPressurePlateRender';

describe('cityChannelGearPressurePlateRender', () => {
  it('treats gear mounts as embedded single-surface components', () => {
    expect(isGearPressurePlatePanel(CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE)).toBe(true);
    expect(isGearPressurePlatePanel(CITY_CHANNEL_TILE_TYPES.BASIC_PLATE)).toBe(false);
    expect(hasDirectionalGearSurface(CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE)).toBe(false);
    expect(hasDirectionalGearSurface(CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE)).toBe(false);
    expect(normalizeGearSurfaceForPanel(CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE, 'back')).toBe('front');
    expect(normalizeGearSurfaceForPanel(CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE, 'back')).toBe('front');
    expect(getGearSurfaceOffsetSignForPanel(CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE, 'back')).toBe(0);
    expect(getGearSurfaceOffsetSignForPanel(CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE, 'back')).toBe(0);
  });

  it('shares the same transmission port plane as cross transmission boards', () => {
    const geometry = createTileGeometry(0, 0);
    const midPlane = getTransmissionMidPlane(geometry, 'floor');
    const portPlane = getTransmissionPortPlane(geometry, 'floor');

    expect(portPlane).toEqual(midPlane);
  });
});
