import { createBaseCityChannelMap } from '../../cityChannelSchema';
import { getPlacementDepth } from './CityChannelDepth';
import {
  FLOOR_THICKNESS,
  createEdgeWallGeometry,
  createTileGeometry,
  createVerticalTileWallGeometry,
  getVerticalMiterTextureKey,
  getTransmissionMidPlane,
  localToCellAtLayer,
  projectCell
} from './CityChannelGeometry';

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

  it('places floor transmission geometry on the board thickness mid-plane', () => {
    const geometry = createTileGeometry(0, 0);
    const midPlane = getTransmissionMidPlane(geometry, 'floor');

    expect(midPlane).toHaveLength(4);
    midPlane.forEach((point, index) => {
      expect(point.x).toBeCloseTo(geometry.top[index].x);
      expect(point.y).toBeCloseTo(geometry.top[index].y + (FLOOR_THICKNESS * 0.5));
    });
  });

  it('places wall transmission geometry halfway between front and back faces', () => {
    const geometry = createEdgeWallGeometry(0, 'south');
    const midPlane = getTransmissionMidPlane(geometry, 'wall');

    expect(midPlane).toHaveLength(4);
    expect(midPlane[0].x).toBeCloseTo((geometry.wallFront[0].x + geometry.wallBack[1].x) * 0.5);
    expect(midPlane[1].x).toBeCloseTo((geometry.wallFront[1].x + geometry.wallBack[0].x) * 0.5);
    expect(midPlane[2].y).toBeCloseTo((geometry.wallFront[2].y + geometry.wallBack[3].y) * 0.5);
    expect(midPlane[3].y).toBeCloseTo((geometry.wallFront[3].y + geometry.wallBack[2].y) * 0.5);
  });

  it('rotates vertical tile wall geometry in its own surface plane', () => {
    const base = createVerticalTileWallGeometry(0, 0, 0);
    const rotated = createVerticalTileWallGeometry(0, 0, 90);

    expect(rotated.wallFront[0].y).not.toBeCloseTo(base.wallFront[0].y);
    expect((rotated.wallFront[2].y - rotated.wallFront[0].y)).not.toBeCloseTo(base.wallFront[2].y - base.wallFront[0].y);
  });

  it('applies vertical miter profiles to tile wall geometry and texture keys', () => {
    const base = createVerticalTileWallGeometry(0, 0, 0);
    const mitered = createVerticalTileWallGeometry(0, 0, 0, { start: 1, end: -1 });

    expect(mitered.miter).toEqual({ start: 1, end: -1 });
    expect(mitered.wallFront[0].x).not.toBeCloseTo(base.wallFront[0].x);
    expect(mitered.wallFront[1].x).not.toBeCloseTo(base.wallFront[1].x);
    expect(getVerticalMiterTextureKey({ start: 2, end: -2 })).toBe(':m1_-1');
  });
});
