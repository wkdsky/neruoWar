import { createBaseCityChannelMap } from '../../cityChannelSchema';
import { getPlacementDepth } from './CityChannelDepth';
import { localToCellAtLayer, projectCell } from './CityChannelGeometry';

describe('CityChannelGeometry', () => {
  it('maps a projected upper-layer point back to the same x/y on that layer', () => {
    const mapData = createBaseCityChannelMap({ name: 'layer picking test' });
    const cell = { x: 16, y: 16, z: 1 };
    const projected = projectCell(cell, 0, mapData);

    expect(localToCellAtLayer({
      x: projected.x,
      y: projected.y,
      z: cell.z,
      cameraYaw: 0,
      mapData
    })).toEqual(cell);
  });

  it('keeps upper layer placements above foreground lower layer placements', () => {
    const mapData = createBaseCityChannelMap({ name: 'layer depth test' });
    const lowerForeground = getPlacementDepth({
      cell: { x: 16, y: 17, z: 0 },
      cameraYaw: 0,
      mapData
    });
    const upperBackground = getPlacementDepth({
      cell: { x: 16, y: 16, z: 1 },
      cameraYaw: 0,
      mapData
    });

    expect(upperBackground).toBeGreaterThan(lowerForeground);
  });
});
