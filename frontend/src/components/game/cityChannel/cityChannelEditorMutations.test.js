import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWallKey
} from './cityChannelSchema';
import {
  applyPlacementOperationsToMap,
  deletePlacementsFromMap,
  movePlacementsInMap,
  rotatePlacementTransmissions
} from './cityChannelEditorMutations';

describe('cityChannelEditorMutations', () => {
  it('places a floor tile and keeps the map shape', () => {
    const mapData = createBaseCityChannelMap({ name: 'mutation place' });
    const next = applyPlacementOperationsToMap(mapData, [{
      action: 'place',
      cell: { x: 4, y: 5, z: 0 },
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      rotation: 90
    }]);

    expect(next.tiles[createCellKey(4, 5, 0)]).toMatchObject({
      x: 4,
      y: 5,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      rotation: 90
    });
    expect(next.walls).toEqual({});
  });

  it('moves tile placements and preserves attached gear mounts', () => {
    const sourceKey = createCellKey(2, 3, 0);
    const mapData = {
      ...createBaseCityChannelMap({ name: 'mutation move' }),
      tiles: {
        [sourceKey]: createTile({
          x: 2,
          y: 3,
          z: 0,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        })
      }
    };
    mapData.tiles[sourceKey].gearMounts = [{
      id: 'gear_a',
      componentType: 'gear',
      position: 'center',
      surface: 'front'
    }];

    const next = movePlacementsInMap(mapData, [{
      from: { x: 2, y: 3, z: 0 },
      to: { x: 6, y: 7, z: 1 }
    }]);

    expect(next.tiles[sourceKey]).toBeUndefined();
    expect(next.tiles[createCellKey(6, 7, 1)]?.gearMounts).toHaveLength(1);
  });

  it('deletes tiles and related mechanical links', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const targetKey = createCellKey(1, 2, 0);
    const mapData = {
      ...createBaseCityChannelMap({ name: 'mutation delete' }),
      tiles: {
        [sourceKey]: createTile({ x: 1, y: 1, z: 0 }),
        [targetKey]: createTile({ x: 1, y: 2, z: 0 })
      },
      mechanicalLinks: [{
        id: 'link_a',
        from: { componentKey: sourceKey, portId: 'port_a' },
        to: { componentKey: targetKey, portId: 'port_b' }
      }]
    };

    const next = deletePlacementsFromMap(mapData, [{ x: 1, y: 1, z: 0 }]);

    expect(next.tiles[sourceKey]).toBeUndefined();
    expect(next.mechanicalLinks).toEqual([]);
  });

  it('rotates wall transmission without changing wall identity', () => {
    const mapData = applyPlacementOperationsToMap(createBaseCityChannelMap({ name: 'mutation rotate' }), [{
      kind: 'wall',
      action: 'place',
      cell: { x: 3, y: 4, z: 0 },
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 0
    }]);

    const wallKey = createWallKey(3, 4, 0, 'east');
    const next = rotatePlacementTransmissions(mapData, [{ x: 3, y: 4, z: 0, edge: 'east' }], -90);

    expect(next.walls[wallKey]).toMatchObject({
      x: 3,
      y: 4,
      z: 0,
      edge: 'east',
      transmissionRotation: 270
    });
  });
});
