import { buildMechanicalAssemblies, getWorldTransmissionPorts } from './cityChannelMechanismRuntime';
import {
  CITY_CHANNEL_TILE_TYPES,
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  normalizeTile
} from './cityChannelSchema';

describe('city channel mechanism runtime', () => {
  it('connects a wall transmission socket to a floor socket on the layer above', () => {
    const wall = createWall({
      x: 0,
      y: 0,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 0
    });
    const upperFloor = createTile({
      x: 0,
      y: 0,
      z: 1,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 90
    });
    const mapData = {
      tiles: {
        [createCellKey(upperFloor.x, upperFloor.y, upperFloor.z)]: upperFloor
      },
      walls: {
        [createWallKey(wall.x, wall.y, wall.z, wall.edge)]: wall
      }
    };

    const graph = buildMechanicalAssemblies(mapData);

    expect(graph.assemblies).toHaveLength(1);
    expect(graph.assemblies[0].componentKeys).toEqual(expect.arrayContaining([
      createWallKey(0, 0, 0, 'east'),
      createCellKey(0, 0, 1)
    ]));
  });

  it('connects stacked vertical tile transmissions through their top and bottom sockets', () => {
    const lower = {
      ...createTile({
        x: 2,
        y: 3,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        rotation: 0,
        transmissionRotation: 0
      }),
      isVertical: true
    };
    const upper = {
      ...createTile({
        x: 2,
        y: 3,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        rotation: 0,
        transmissionRotation: 0
      }),
      isVertical: true
    };
    const mapData = {
      tiles: {
        [createCellKey(lower.x, lower.y, lower.z)]: lower,
        [createCellKey(upper.x, upper.y, upper.z)]: upper
      },
      walls: {}
    };

    const graph = buildMechanicalAssemblies(mapData);

    expect(graph.assemblies).toHaveLength(1);
    expect(graph.assemblies[0].componentKeys).toEqual(expect.arrayContaining([
      createCellKey(2, 3, 0),
      createCellKey(2, 3, 1)
    ]));
  });

  it('ignores stale transmission skeleton data on basic plates when building assemblies', () => {
    const endpoint = createTile({
      x: 1,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_ENDPOINT_PLATE,
      transmissionRotation: 0
    });
    const basicWithStaleSkeleton = {
      ...createTile({
        x: 2,
        y: 0,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        transmissionRotation: 0
      }),
      transmissionSkeleton: endpoint.transmissionSkeleton
    };
    const mapData = {
      tiles: {
        [createCellKey(endpoint.x, endpoint.y, endpoint.z)]: endpoint,
        [createCellKey(basicWithStaleSkeleton.x, basicWithStaleSkeleton.y, basicWithStaleSkeleton.z)]: basicWithStaleSkeleton
      },
      walls: {}
    };

    expect(getWorldTransmissionPorts(basicWithStaleSkeleton)).toEqual([]);
    const graph = buildMechanicalAssemblies(mapData);
    const basicKey = createCellKey(2, 0, 0);
    expect(graph.assemblyByComponentKey[basicKey]).toBeUndefined();
    expect(graph.assemblies[0]?.componentKeys || []).not.toContain(basicKey);
  });

  it('preserves user-installed gear mounts when normalizing basic plates', () => {
    const tile = normalizeTile({
      ...createTile({
        x: 3,
        y: 4,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      gearMounts: [{
        id: 'gear_test',
        componentType: 'gear',
        position: 'center',
        surface: 'front',
        axisType: 'freeAxis'
      }]
    });

    expect(tile.gearMounts).toHaveLength(1);
    expect(tile.gearMounts[0].id).toBe('gear_test');
  });
});
