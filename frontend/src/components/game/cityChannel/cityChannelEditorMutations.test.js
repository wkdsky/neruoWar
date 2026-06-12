import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  normalizeCityChannelMap
} from './cityChannelSchema';
import {
  buildMechanicalAssemblies,
  getGearAxisBindingStatus,
  getGearSocketWorldPosition
} from './cityChannelMechanismRuntime';
import {
  applyPlacementOperationsToMap,
  deletePlacementsFromMap,
  movePlacementsInMap,
  rotatePlacementTransmissions
} from './cityChannelEditorMutations';
import {
  DOUBLE_SIDED_RACK_COMPONENT_TYPE,
  createRackKey
} from './cityChannelRackModel';

describe('cityChannelEditorMutations', () => {
  const expectSameGearPoint = (actual, expected) => {
    expect(actual?.x).toBeCloseTo(expected?.x, 4);
    expect(actual?.y).toBeCloseTo(expected?.y, 4);
    expect(actual?.z).toBeCloseTo(expected?.z, 4);
  };

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

  it('places a double-sided rack as a root map component', () => {
    const mapData = createBaseCityChannelMap({ name: 'rack mutation place' });
    const rack = {
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    };

    const next = applyPlacementOperationsToMap(mapData, [{
      kind: 'rack',
      action: 'place',
      rack
    }]);

    const key = createRackKey(rack);
    expect(next.racks[key]).toMatchObject({
      id: key,
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    });
  });

  it('skips gear mounts that overlap a rack', () => {
    const hostKey = createCellKey(1, 1, 0);
    const mapData = {
      ...createBaseCityChannelMap({ name: 'gear rack overlap mutation' }),
      tiles: {
        [hostKey]: createTile({
          x: 1,
          y: 1,
          z: 0,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        })
      },
      walls: {},
      racks: {
        rack_overlap: {
          id: 'rack_overlap',
          componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
          direction: 'x',
          z: 0,
          start: { x: 0.5, y: 0.5, z: 0 },
          end: { x: 2.5, y: 0.5, z: 0 }
        }
      }
    };

    const next = applyPlacementOperationsToMap(mapData, [{
      kind: 'gearMount',
      action: 'place',
      hostKind: 'tile',
      hostKey,
      mount: {
        id: 'gear_overlap',
        componentType: 'gear',
        position: 'corner_ne',
        surface: 'front'
      }
    }]);

    expect(next.tiles[hostKey].gearMounts || []).toHaveLength(0);
  });

  it('skips gear mounts whose vertical gear body would go below ground', () => {
    const wallKey = createWallKey(1, 1, 0, 'east');
    const mapData = {
      ...createBaseCityChannelMap({ name: 'gear below ground mutation' }),
      tiles: {},
      walls: {
        [wallKey]: createWall({
          x: 1,
          y: 1,
          z: 0,
          edge: 'east',
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        })
      }
    };

    const next = applyPlacementOperationsToMap(mapData, [{
      kind: 'gearMount',
      action: 'place',
      hostKind: 'wall',
      hostKey: wallKey,
      mount: {
        id: 'gear_below_ground',
        componentType: 'gear',
        position: 'corner_se',
        surface: 'front'
      }
    }]);

    expect(next.walls[wallKey].gearMounts || []).toHaveLength(0);
  });

  it('applies vertical tile placement intent instead of inheriting old pose', () => {
    const tileKey = createCellKey(4, 5, 1);
    const verticalMap = applyPlacementOperationsToMap(createBaseCityChannelMap({ name: 'vertical tile mutation' }), [{
      kind: 'tile',
      action: 'place',
      cell: { x: 4, y: 5, z: 1 },
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      rotation: 90,
      transmissionRotation: 90,
      isVertical: true
    }]);

    expect(verticalMap.tiles[tileKey]).toMatchObject({
      x: 4,
      y: 5,
      z: 1,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      rotation: 90,
      isVertical: true
    });

    const flattenedMap = applyPlacementOperationsToMap(verticalMap, [{
      kind: 'tile',
      action: 'place',
      cell: { x: 4, y: 5, z: 1 },
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      rotation: 0,
      transmissionRotation: 0
    }]);

    expect(flattenedMap.tiles[tileKey]).toMatchObject({
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      isVertical: false
    });
  });

  it('splits mechanical assemblies after replacing a middle vertical transmission board', () => {
    const createVerticalTransmission = (z) => ({
      ...createTile({
        x: 2,
        y: 3,
        z,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        rotation: 0,
        transmissionRotation: 0
      }),
      isVertical: true
    });
    const lowerKey = createCellKey(2, 3, 0);
    const lowerBridgeKey = createCellKey(2, 3, 1);
    const middleKey = createCellKey(2, 3, 2);
    const upperKey = createCellKey(2, 3, 3);
    const mapData = {
      ...createBaseCityChannelMap({ name: 'replace middle transmission', layers: 4 }),
      tiles: {
        [lowerKey]: createVerticalTransmission(0),
        [lowerBridgeKey]: createVerticalTransmission(1),
        [middleKey]: createVerticalTransmission(2),
        [upperKey]: createVerticalTransmission(3)
      },
      walls: {}
    };

    const replaced = normalizeCityChannelMap(applyPlacementOperationsToMap(mapData, [{
      kind: 'tile',
      action: 'place',
      cell: { x: 2, y: 3, z: 2 },
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE,
      rotation: 0,
      transmissionRotation: 0,
      isVertical: true
    }]));
    const graph = buildMechanicalAssemblies(replaced);

    expect(graph.assemblyByComponentKey[lowerKey]).toBe(graph.assemblyByComponentKey[lowerBridgeKey]);
    expect(graph.assemblyByComponentKey[lowerKey]).not.toBe(graph.assemblyByComponentKey[upperKey]);
  });

  it('expands map layers when placing above the current layer count', () => {
    const mapData = createBaseCityChannelMap({
      name: 'vertical layer expansion',
      layers: 1
    });
    const next = applyPlacementOperationsToMap(mapData, [{
      kind: 'wall',
      action: 'place',
      cell: { x: 4, y: 5, z: 1 },
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    }]);

    expect(next.layers).toBe(2);
    expect(next.walls[createWallKey(4, 5, 1, 'east')]).toMatchObject({
      x: 4,
      y: 5,
      z: 1,
      edge: 'east'
    });
  });

  it('expands map layers when moving boards upward', () => {
    const sourceKey = createCellKey(4, 5, 0);
    const mapData = {
      ...createBaseCityChannelMap({
        name: 'move layer expansion',
        layers: 1
      }),
      tiles: {
        [sourceKey]: createTile({
          x: 4,
          y: 5,
          z: 0,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        })
      }
    };
    const next = movePlacementsInMap(mapData, [{
      from: { x: 4, y: 5, z: 0 },
      to: { x: 4, y: 5, z: 1, isVertical: true }
    }]);

    expect(next.layers).toBe(2);
    expect(next.tiles[createCellKey(4, 5, 1)]).toMatchObject({
      x: 4,
      y: 5,
      z: 1,
      isVertical: true
    });
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

  it('updates a tile when a move lands back on the same cell with a new surface rotation', () => {
    const sourceKey = createCellKey(2, 3, 0);
    const mapData = {
      ...createBaseCityChannelMap({ name: 'same cell move update' }),
      tiles: {
        [sourceKey]: createTile({
          x: 2,
          y: 3,
          z: 0,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
          rotation: 0,
          transmissionRotation: 0
        })
      }
    };

    const next = movePlacementsInMap(mapData, [{
      from: { x: 2, y: 3, z: 0 },
      to: {
        x: 2,
        y: 3,
        z: 0,
        rotation: 90,
        transmissionRotation: 90,
        layFlat: true
      }
    }]);

    expect(next.tiles[sourceKey]).toMatchObject({
      x: 2,
      y: 3,
      z: 0,
      rotation: 90,
      transmissionRotation: 90,
      isVertical: false
    });
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

  it('deletes center gears with their host board', () => {
    const sourceKey = createCellKey(3, 3, 0);
    const tile = createTile({ x: 3, y: 3, z: 0 });
    tile.gearMounts = [{
      id: 'gear_center',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front'
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'delete center gear host' }),
      tiles: {
        [sourceKey]: tile
      },
      walls: {}
    };

    const next = deletePlacementsFromMap(mapData, [{ x: 3, y: 3, z: 0 }]);

    expect(next.tiles[sourceKey]).toBeUndefined();
    expect(Object.values(next.tiles).flatMap((item) => item.gearMounts || [])).toEqual([]);
    expect(Object.values(next.walls).flatMap((item) => item.gearMounts || [])).toEqual([]);
  });

  it('preserves corner gears when their host board is deleted', () => {
    const hostKey = createCellKey(16, 16, 0);
    const boundKey = createCellKey(17, 17, 0);
    const host = createTile({ x: 16, y: 16, z: 0 });
    const bound = createTile({ x: 17, y: 17, z: 0 });
    host.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_se',
      socketKind: 'corner',
      surface: 'front',
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'preserve deleted gear host' }),
      tiles: {
        [hostKey]: host,
        [boundKey]: bound
      },
      walls: {}
    };

    const next = deletePlacementsFromMap(mapData, [{ x: 16, y: 16, z: 0 }]);

    expect(next.tiles[hostKey]).toBeUndefined();
    expect(next.tiles[boundKey]?.gearMounts).toEqual([
      expect.objectContaining({
        id: 'gear_corner',
        position: 'corner_nw',
        axisBinding: expect.objectContaining({
          componentKey: hostKey,
          hostKind: 'tile',
          socket: 'corner_se'
        })
      })
    ]);
    expect(getGearAxisBindingStatus({
      mapData: next,
      placement: next.tiles[boundKey],
      mount: next.tiles[boundKey].gearMounts[0]
    })).toMatchObject({
      bound: true,
      valid: false,
      reason: 'missing_component'
    });
  });

  it('deletes corner gears when every board at their intersection is deleted', () => {
    const hostKey = createCellKey(16, 16, 0);
    const boundKey = createCellKey(17, 17, 0);
    const host = createTile({ x: 16, y: 16, z: 0 });
    const bound = createTile({ x: 17, y: 17, z: 0 });
    host.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_se',
      socketKind: 'corner',
      surface: 'front',
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'delete last corner gear hosts' }),
      tiles: {
        [hostKey]: host,
        [boundKey]: bound
      },
      walls: {}
    };

    const next = deletePlacementsFromMap(mapData, [
      { x: 16, y: 16, z: 0 },
      { x: 17, y: 17, z: 0 }
    ]);

    expect(next.tiles[hostKey]).toBeUndefined();
    expect(next.tiles[boundKey]).toBeUndefined();
    expect(Object.values(next.tiles).flatMap((item) => item.gearMounts || [])).toEqual([]);
    expect(Object.values(next.walls).flatMap((item) => item.gearMounts || [])).toEqual([]);
  });

  it('leaves source gears in place when only the bound board is deleted', () => {
    const hostKey = createCellKey(16, 16, 0);
    const boundKey = createCellKey(17, 17, 0);
    const host = createTile({ x: 16, y: 16, z: 0 });
    const bound = createTile({ x: 17, y: 17, z: 0 });
    host.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_se',
      socketKind: 'corner',
      surface: 'front',
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'preserve deleted bound board' }),
      tiles: {
        [hostKey]: host,
        [boundKey]: bound
      },
      walls: {}
    };

    const next = deletePlacementsFromMap(mapData, [{ x: 17, y: 17, z: 0 }]);

    expect(next.tiles[boundKey]).toBeUndefined();
    expect(next.tiles[hostKey]?.gearMounts).toHaveLength(1);
    expect(getGearAxisBindingStatus({
      mapData: next,
      placement: next.tiles[hostKey],
      mount: next.tiles[hostKey].gearMounts[0]
    })).toMatchObject({
      bound: true,
      valid: false,
      reason: 'missing_component'
    });
  });

  it('rebinds an existing gear to a rotated same-cell replacement board', () => {
    const hostKey = createCellKey(16, 16, 0);
    const boundKey = createCellKey(17, 17, 0);
    const host = createTile({
      x: 16,
      y: 16,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const bound = createTile({
      x: 17,
      y: 17,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    host.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_se',
      socketKind: 'corner',
      surface: 'front',
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'replace bound board' }),
      tiles: {
        [hostKey]: host,
        [boundKey]: bound
      },
      walls: {}
    };

    const next = applyPlacementOperationsToMap(mapData, [{
      kind: 'tile',
      action: 'place',
      cell: { x: 17, y: 17, z: 0 },
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      rotation: 90,
      transmissionRotation: 90
    }]);

    expect(next.tiles[boundKey]).toMatchObject({
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      rotation: 90
    });
    expect(next.tiles[hostKey]?.gearMounts[0].axisBinding).toEqual(expect.objectContaining({
      componentKey: boundKey,
      hostKind: 'tile',
      socket: 'corner_sw'
    }));
    expect(getGearAxisBindingStatus({
      mapData: next,
      placement: next.tiles[hostKey],
      mount: next.tiles[hostKey].gearMounts[0]
    })).toMatchObject({
      bound: true,
      valid: true,
      reason: 'ok'
    });
  });

  it('keeps an installed gear at the same world corner when replacing its host board rotation', () => {
    const tileKey = createCellKey(5, 6, 0);
    const tile = createTile({
      x: 5,
      y: 6,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE,
      rotation: 0
    });
    tile.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_ne',
      socketKind: 'corner',
      surface: 'front'
    }];
    const beforePoint = getGearSocketWorldPosition(tile, 'corner_ne', 'front');
    const mapData = {
      ...createBaseCityChannelMap({ name: 'replace gear host rotation' }),
      tiles: {
        [tileKey]: tile
      },
      walls: {}
    };

    const next = applyPlacementOperationsToMap(mapData, [{
      kind: 'tile',
      action: 'place',
      cell: { x: 5, y: 6, z: 0 },
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      rotation: 90,
      transmissionRotation: 90
    }]);
    const nextMount = next.tiles[tileKey]?.gearMounts[0];
    const afterPoint = getGearSocketWorldPosition(next.tiles[tileKey], nextMount.position, nextMount.surface);

    expect(nextMount).toEqual(expect.objectContaining({
      id: 'gear_corner',
      position: 'corner_nw',
      socketKind: 'corner'
    }));
    expectSameGearPoint(afterPoint, beforePoint);
  });

  it('preserves wall gears when replacing a wall panel', () => {
    const wallKey = createWallKey(3, 4, 0, 'east');
    const wall = createWall({
      x: 3,
      y: 4,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    wall.gearMounts = [{
      id: 'gear_wall',
      componentType: 'gear',
      position: 'corner_ne',
      socketKind: 'corner',
      surface: 'front'
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'replace wall gear host' }),
      tiles: {},
      walls: {
        [wallKey]: wall
      }
    };

    const next = applyPlacementOperationsToMap(mapData, [{
      kind: 'wall',
      action: 'place',
      cell: { x: 3, y: 4, z: 0 },
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      transmissionRotation: 90
    }]);

    expect(next.walls[wallKey]).toMatchObject({
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      transmissionRotation: 90
    });
    expect(next.walls[wallKey]?.gearMounts).toEqual([
      expect.objectContaining({ id: 'gear_wall' })
    ]);
    expectSameGearPoint(
      getGearSocketWorldPosition(next.walls[wallKey], next.walls[wallKey].gearMounts[0].position, next.walls[wallKey].gearMounts[0].surface),
      getGearSocketWorldPosition(wall, 'corner_ne', 'front')
    );
  });

  it('places an upper wall panel on the same edge above a lower wall', () => {
    const lowerWall = createWall({
      x: 3,
      y: 4,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'upper wall placement' }),
      tiles: {},
      walls: {
        [createWallKey(3, 4, 0, 'east')]: lowerWall
      }
    };
    const next = applyPlacementOperationsToMap(mapData, [{
      kind: 'wall',
      action: 'place',
      cell: { x: 3, y: 4, z: 1 },
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 90
    }]);

    expect(next.walls[createWallKey(3, 4, 0, 'east')]).toBeDefined();
    expect(next.walls[createWallKey(3, 4, 1, 'east')]).toMatchObject({
      x: 3,
      y: 4,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 90
    });
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
