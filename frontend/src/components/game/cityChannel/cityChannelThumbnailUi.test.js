import { CITY_CHANNEL_TOOLS } from './cityChannelSchema';
import {
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
});
