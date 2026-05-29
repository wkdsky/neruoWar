import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from '../cityChannelSchema';
import {
  areMechanicalPortsCompatible,
  getMechanicalPortHit,
  getMechanicalPortPoint,
  getTransmissionRotationDelta,
  rotateTransmissionPlacementsInPlace
} from './cityChannelMechanicalSystems';

describe('cityChannelMechanicalSystems', () => {
  it('resolves mechanical port screen points from tile-local positions', () => {
    const mapData = createBaseCityChannelMap({ name: 'port point' });
    const tile = createTile({
      x: 2,
      y: 3,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const point = getMechanicalPortPoint({
      mapData,
      cameraYaw: 0,
      tile,
      port: { localPosition3d: { x: 0, y: 0, z: 0 } }
    });

    expect(point).toEqual(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number)
    }));
  });

  it('finds the nearest mechanical port hit', () => {
    const tileKey = createCellKey(2, 3, 0);
    const tile = createTile({
      x: 2,
      y: 3,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    tile.mechanicalPorts = [{
      id: 'port_a',
      label: 'A',
      direction: 'out',
      mediums: ['rigid_rod'],
      localPosition3d: { x: 0, y: 0, z: 0 }
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'port hit' }),
      tiles: { [tileKey]: tile }
    };
    const point = getMechanicalPortPoint({
      mapData,
      cameraYaw: 0,
      tile,
      port: tile.mechanicalPorts[0]
    });

    expect(getMechanicalPortHit({
      mapData,
      cameraYaw: 0,
      zoom: 1,
      visibleLayerCutoff: null,
      localPoint: point
    })).toMatchObject({
      type: 'mechanical_port',
      componentKey: tileKey,
      portId: 'port_a'
    });
  });

  it('checks medium and direction compatibility', () => {
    const output = {
      componentKey: 'a',
      portId: 'out',
      port: { direction: 'out', mediums: ['rigid_rod'] }
    };
    const input = {
      componentKey: 'b',
      portId: 'in',
      port: { direction: 'in', mediums: ['rigid_rod', 'rope'] }
    };
    const otherOutput = {
      componentKey: 'c',
      portId: 'out',
      port: { direction: 'out', mediums: ['rigid_rod'] }
    };

    expect(areMechanicalPortsCompatible(output, input)).toEqual({ ok: true, medium: 'rigid_rod' });
    expect(areMechanicalPortsCompatible(output, otherOutput)).toEqual({ ok: false, reason: 'direction' });
  });

  it('rotates tile and wall transmission values in place', () => {
    const tileKey = createCellKey(1, 1, 0);
    const wallKey = createWallKey(2, 2, 0, 'east');
    const mapData = {
      ...createBaseCityChannelMap({ name: 'rotation' }),
      tiles: {
        [tileKey]: {
          ...createTile({
            x: 1,
            y: 1,
            z: 0,
            panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
            rotation: 90
          }),
          transmissionRotation: 90
        }
      },
      walls: {
        [wallKey]: createWall({
          x: 2,
          y: 2,
          z: 0,
          edge: 'east',
          panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
          transmissionRotation: 0
        })
      }
    };

    const changed = rotateTransmissionPlacementsInPlace(mapData, [
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 2, z: 0, edge: 'east' },
      { x: 9, y: 9, z: 0 }
    ], 'reverse');

    expect(getTransmissionRotationDelta('forward')).toBe(90);
    expect(getTransmissionRotationDelta('reverse')).toBe(-90);
    expect(changed).toHaveLength(2);
    expect(mapData.tiles[tileKey].transmissionRotation).toBe(0);
    expect(mapData.walls[wallKey].transmissionRotation).toBe(270);
  });
});
