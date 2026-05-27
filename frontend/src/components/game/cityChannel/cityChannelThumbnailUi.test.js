import { CITY_CHANNEL_TOOLS } from './cityChannelSchema';
import {
  buildThumbnailAssemblyColorMap,
  getDistanceToBoundingRect,
  isCityChannelThumbnailInteractionLocked,
  isPointerNearThumbnail
} from './cityChannelThumbnailUi';

describe('cityChannelThumbnailUi', () => {
  it('locks thumbnail interaction during place and carry', () => {
    expect(isCityChannelThumbnailInteractionLocked({
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: 'basic_floor'
    })).toBe(true);
    expect(isCityChannelThumbnailInteractionLocked({
      activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
      activeComponentType: 'gear'
    })).toBe(true);
    expect(isCityChannelThumbnailInteractionLocked({
      activeTool: CITY_CHANNEL_TOOLS.SELECT,
      carryActive: true
    })).toBe(true);
    expect(isCityChannelThumbnailInteractionLocked({
      activeTool: CITY_CHANNEL_TOOLS.SELECT
    })).toBe(false);
  });

  it('detects pointer proximity to thumbnail bounds', () => {
    const rect = { left: 100, top: 100, right: 200, bottom: 200 };
    expect(getDistanceToBoundingRect(150, 150, rect)).toBe(0);
    expect(isPointerNearThumbnail(150, 150, rect, 10)).toBe(true);
    expect(isPointerNearThumbnail(300, 150, rect, 10)).toBe(false);
    expect(isPointerNearThumbnail(205, 150, rect, 10)).toBe(true);
  });

  it('assigns one thumbnail color per mechanical assembly and separates adjacent assemblies', () => {
    const palette = [
      { top: '#111111', side: '#111111', edge: '#ffffff' },
      { top: '#222222', side: '#222222', edge: '#ffffff' }
    ];
    const colors = buildThumbnailAssemblyColorMap({
      assemblyGraph: {
        assemblyByComponentKey: {
          a: 'assembly_1',
          b: 'assembly_1',
          c: 'assembly_2'
        }
      },
      componentKeys: ['a', 'b', 'c'],
      adjacentPairs: [['b', 'c']],
      palette
    });

    expect(colors.assembly_1).toBe(palette[0]);
    expect(colors.assembly_2).toBe(palette[1]);
  });
});
