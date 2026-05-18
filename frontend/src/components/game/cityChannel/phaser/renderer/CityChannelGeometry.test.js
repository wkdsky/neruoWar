import { createBaseCityChannelMap } from '../../cityChannelSchema';
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
});
