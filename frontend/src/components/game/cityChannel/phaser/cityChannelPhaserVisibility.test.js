import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile
} from '../cityChannelSchema';
import {
  getCityChannelPlaneLevels,
  getNextHiddenPlaneLevel,
  isLayerVisible,
  isPlacementVisible,
  isVerticalAttachmentPlacement
} from './cityChannelPhaserVisibility';

describe('cityChannelPhaserVisibility', () => {
  it('collects horizontal plane levels and ignores vertical tiles', () => {
    const mapData = {
      ...createBaseCityChannelMap({ name: 'visibility levels' }),
      tiles: {
        [createCellKey(1, 1, 2)]: createTile({
          x: 1,
          y: 1,
          z: 2,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        }),
        [createCellKey(2, 2, 3)]: {
          ...createTile({
            x: 2,
            y: 2,
            z: 3,
            panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
          }),
          isVertical: true
        }
      }
    };

    expect(getCityChannelPlaneLevels(mapData)).toEqual([0, 2]);
    expect(getNextHiddenPlaneLevel(mapData, 0)).toBe(2);
  });

  it('keeps vertical attachments below the next hidden plane visible', () => {
    const mapData = {
      ...createBaseCityChannelMap({ name: 'visibility attachment' }),
      tiles: {
        [createCellKey(1, 1, 3)]: createTile({
          x: 1,
          y: 1,
          z: 3,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        })
      }
    };

    expect(isLayerVisible({ z: 1 }, 0)).toBe(false);
    expect(isVerticalAttachmentPlacement({ x: 1, y: 1, z: 2, edge: 'north' })).toBe(true);
    expect(isPlacementVisible({ x: 1, y: 1, z: 2, edge: 'north' }, {
      mapData,
      visibleLayerCutoff: 0
    })).toBe(true);
    expect(isPlacementVisible({ x: 1, y: 1, z: 3, edge: 'north' }, {
      mapData,
      visibleLayerCutoff: 0
    })).toBe(false);
  });
});
