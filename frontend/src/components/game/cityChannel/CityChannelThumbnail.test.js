import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from './cityChannelSchema';
import {
  getCityChannelMapPlaneLevels,
  getThumbnailYawForThreeCamera
} from './CityChannelThumbnail';

describe('CityChannelThumbnail layer levels', () => {
  it('includes wall-only and vertical-tile-only upper layers', () => {
    const wall = createWall({
      x: 3,
      y: 4,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const verticalTile = {
      ...createTile({
        x: 5,
        y: 6,
        z: 2,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        rotation: 90
      }),
      isVertical: true
    };
    const mapData = {
      ...createBaseCityChannelMap({ layers: 4 }),
      tiles: {
        [createCellKey(5, 6, 2)]: verticalTile
      },
      walls: {
        [createWallKey(3, 4, 1, 'east')]: wall
      }
    };

    expect(getCityChannelMapPlaneLevels(mapData)).toEqual([0, 1, 2]);
  });

  it('maps Three camera yaw into the thumbnail projection yaw', () => {
    expect(getThumbnailYawForThreeCamera(45)).toBe(0);
    expect(getThumbnailYawForThreeCamera(90)).toBe(45);
    expect(getThumbnailYawForThreeCamera(0)).toBe(315);
  });
});
