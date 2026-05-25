import { CITY_CHANNEL_TILE_TYPES } from './cityChannelSchema';
import { createTileGeometry, getTransmissionMidPlane, getTransmissionPortPlane } from './phaser/renderer/CityChannelGeometry';
import { isGearPressurePlatePanel } from './cityChannelGearPressurePlateRender';

describe('cityChannelGearPressurePlateRender', () => {
  it('identifies gear pressure plate panel type', () => {
    expect(isGearPressurePlatePanel(CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE)).toBe(true);
    expect(isGearPressurePlatePanel(CITY_CHANNEL_TILE_TYPES.BASIC_PLATE)).toBe(false);
  });

  it('shares the same transmission port plane as cross transmission boards', () => {
    const geometry = createTileGeometry(0, 0);
    const midPlane = getTransmissionMidPlane(geometry, 'floor');
    const portPlane = getTransmissionPortPlane(geometry, 'floor');

    expect(portPlane).toEqual(midPlane);
  });
});
