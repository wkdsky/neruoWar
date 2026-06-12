import {
  buildMechanicalAssemblies,
  getGearAxisBindingStatus,
  getGearMountLocalPosition,
  getWorldTransmissionPorts
} from './cityChannelMechanismRuntime';
import {
  CITY_CHANNEL_TILE_TYPES,
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  normalizeCityChannelMap,
  normalizeTile
} from './cityChannelSchema';

describe('city channel mechanism runtime', () => {
  it('uses true board corners for gear mounts', () => {
    expect(getGearMountLocalPosition('corner_ne')).toEqual({ x: 0.5, y: -0.5, z: 0 });
    expect(getGearMountLocalPosition('corner_sw')).toEqual({ x: -0.5, y: 0.5, z: 0 });
  });

  it('rotates transmission ports by runtime surface rotation', () => {
    const tile = {
      ...createTile({
        x: 2,
        y: 3,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        rotation: 0,
        transmissionRotation: 0
      }),
      isVertical: true,
      runtimeSurfaceRotation: 90
    };

    const ports = getWorldTransmissionPorts(tile, createCellKey(2, 3, 0));

    expect(ports.find((port) => port.id === 'north')).toMatchObject({
      worldDirection: 'east',
      worldLocalPosition: { x: 0.5, y: 0, z: 0 }
    });
    expect(ports.find((port) => port.id === 'south')).toMatchObject({
      worldDirection: 'west',
      worldLocalPosition: { x: -0.5, y: 0, z: 0 }
    });
  });

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

  it('splits a stacked vertical transmission chain when a middle board no longer has top-bottom ports', () => {
    const createVerticalTransmission = (z, patch = {}) => ({
      ...createTile({
        x: 2,
        y: 3,
        z,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        rotation: 0,
        transmissionRotation: 0,
        ...patch
      }),
      isVertical: true
    });
    const lower = createVerticalTransmission(0);
    const lowerBridge = createVerticalTransmission(1);
    const middle = createVerticalTransmission(2, { transmissionRotation: 90 });
    const upper = createVerticalTransmission(3);
    const lowerKey = createCellKey(2, 3, 0);
    const lowerBridgeKey = createCellKey(2, 3, 1);
    const middleKey = createCellKey(2, 3, 2);
    const upperKey = createCellKey(2, 3, 3);
    const mapData = {
      tiles: {
        [lowerKey]: lower,
        [lowerBridgeKey]: lowerBridge,
        [middleKey]: middle,
        [upperKey]: upper
      },
      walls: {}
    };

    const graph = buildMechanicalAssemblies(mapData);

    expect(graph.assemblyByComponentKey[lowerKey]).not.toBe(graph.assemblyByComponentKey[middleKey]);
    expect(graph.assemblyByComponentKey[upperKey]).not.toBe(graph.assemblyByComponentKey[middleKey]);
    expect(graph.assemblyByComponentKey[lowerKey]).toBe(graph.assemblyByComponentKey[lowerBridgeKey]);
    expect(graph.assemblyByComponentKey[lowerKey]).not.toBe(graph.assemblyByComponentKey[upperKey]);
    expect(graph.assemblies.find((assembly) => assembly.componentKeys.includes(middleKey))?.componentKeys).toEqual([middleKey]);
  });

  it('does not connect a vertical top-bottom skeleton to same-level neighbors without matching endpoints', () => {
    const vertical = {
      ...createTile({
        x: 2,
        y: 2,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        rotation: 0,
        transmissionRotation: 0
      }),
      isVertical: true
    };
    const northNeighbor = {
      ...createTile({
        x: 2,
        y: 1,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        transmissionRotation: 0
      }),
      isVertical: true
    };
    const southNeighbor = {
      ...createTile({
        x: 2,
        y: 3,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        transmissionRotation: 0
      }),
      isVertical: true
    };
    const verticalKey = createCellKey(vertical.x, vertical.y, vertical.z);
    const northKey = createCellKey(northNeighbor.x, northNeighbor.y, northNeighbor.z);
    const southKey = createCellKey(southNeighbor.x, southNeighbor.y, southNeighbor.z);

    const graph = buildMechanicalAssemblies({
      tiles: {
        [verticalKey]: vertical,
        [northKey]: northNeighbor,
        [southKey]: southNeighbor
      },
      walls: {}
    });

    expect(graph.assemblyByComponentKey[verticalKey]).not.toBe(graph.assemblyByComponentKey[northKey]);
    expect(graph.assemblyByComponentKey[verticalKey]).not.toBe(graph.assemblyByComponentKey[southKey]);
  });

  it('splits a stacked vertical transmission chain when a middle board turns to another plane', () => {
    const createVerticalTransmission = (z, patch = {}) => ({
      ...createTile({
        x: 2,
        y: 3,
        z,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        rotation: 0,
        transmissionRotation: 0,
        ...patch
      }),
      isVertical: true
    });
    const lower = createVerticalTransmission(0);
    const lowerBridge = createVerticalTransmission(1);
    const middle = createVerticalTransmission(2, { rotation: 90 });
    const upper = createVerticalTransmission(3);
    const lowerKey = createCellKey(2, 3, 0);
    const lowerBridgeKey = createCellKey(2, 3, 1);
    const middleKey = createCellKey(2, 3, 2);
    const upperKey = createCellKey(2, 3, 3);

    const graph = buildMechanicalAssemblies({
      tiles: {
        [lowerKey]: lower,
        [lowerBridgeKey]: lowerBridge,
        [middleKey]: middle,
        [upperKey]: upper
      },
      walls: {}
    });

    expect(graph.assemblyByComponentKey[lowerKey]).toBe(graph.assemblyByComponentKey[lowerBridgeKey]);
    expect(graph.assemblyByComponentKey[lowerKey]).not.toBe(graph.assemblyByComponentKey[middleKey]);
    expect(graph.assemblyByComponentKey[lowerKey]).not.toBe(graph.assemblyByComponentKey[upperKey]);
    expect(graph.assemblyByComponentKey[middleKey]).not.toBe(graph.assemblyByComponentKey[upperKey]);
  });

  it('splits a stacked vertical transmission chain when a middle board is replaced by a basic plate', () => {
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
    const lower = createVerticalTransmission(0);
    const lowerBridge = createVerticalTransmission(1);
    const middle = {
      ...createTile({
        x: 2,
        y: 3,
        z: 2,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        rotation: 0,
        transmissionRotation: 0
      }),
      isVertical: true,
      transmissionSkeleton: lower.transmissionSkeleton
    };
    const upper = createVerticalTransmission(3);
    const lowerKey = createCellKey(2, 3, 0);
    const lowerBridgeKey = createCellKey(2, 3, 1);
    const middleKey = createCellKey(2, 3, 2);
    const upperKey = createCellKey(2, 3, 3);

    const graph = buildMechanicalAssemblies({
      tiles: {
        [lowerKey]: lower,
        [lowerBridgeKey]: lowerBridge,
        [middleKey]: middle,
        [upperKey]: upper
      },
      walls: {}
    });

    expect(graph.assemblyByComponentKey[middleKey]).toBeUndefined();
    expect(graph.assemblyByComponentKey[lowerKey]).toBe(graph.assemblyByComponentKey[lowerBridgeKey]);
    expect(graph.assemblyByComponentKey[lowerKey]).not.toBe(graph.assemblyByComponentKey[upperKey]);
  });

  it.each([
    CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE,
    CITY_CHANNEL_TILE_TYPES.TRANSMISSION_T_PLATE,
    CITY_CHANNEL_TILE_TYPES.TRANSMISSION_ENDPOINT_PLATE
  ])('splits a stacked vertical transmission chain when the middle board is replaced by %s', (middlePanelType) => {
    const createVerticalTransmission = (z, panelType = CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE) => ({
      ...createTile({
        x: 2,
        y: 3,
        z,
        panelType,
        rotation: 0,
        transmissionRotation: 0
      }),
      isVertical: true
    });
    const lowerKey = createCellKey(2, 3, 0);
    const lowerBridgeKey = createCellKey(2, 3, 1);
    const middleKey = createCellKey(2, 3, 2);
    const upperKey = createCellKey(2, 3, 3);

    const graph = buildMechanicalAssemblies({
      tiles: {
        [lowerKey]: createVerticalTransmission(0),
        [lowerBridgeKey]: createVerticalTransmission(1),
        [middleKey]: createVerticalTransmission(2, middlePanelType),
        [upperKey]: createVerticalTransmission(3)
      },
      walls: {}
    });

    expect(graph.assemblyByComponentKey[lowerKey]).toBe(graph.assemblyByComponentKey[lowerBridgeKey]);
    expect(graph.assemblyByComponentKey[lowerKey]).not.toBe(graph.assemblyByComponentKey[upperKey]);
  });

  it('splits a stacked wall transmission chain when a middle wall no longer has top-bottom ports', () => {
    const createWallTransmission = (z, patch = {}) => createWall({
      x: 2,
      y: 3,
      z,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 0,
      ...patch
    });
    const lower = createWallTransmission(0);
    const lowerBridge = createWallTransmission(1);
    const middle = createWallTransmission(2, { transmissionRotation: 90 });
    const upper = createWallTransmission(3);
    const lowerKey = createWallKey(2, 3, 0, 'east');
    const lowerBridgeKey = createWallKey(2, 3, 1, 'east');
    const middleKey = createWallKey(2, 3, 2, 'east');
    const upperKey = createWallKey(2, 3, 3, 'east');

    const graph = buildMechanicalAssemblies({
      tiles: {},
      walls: {
        [lowerKey]: lower,
        [lowerBridgeKey]: lowerBridge,
        [middleKey]: middle,
        [upperKey]: upper
      }
    });

    expect(graph.assemblyByComponentKey[lowerKey]).toBe(graph.assemblyByComponentKey[lowerBridgeKey]);
    expect(graph.assemblyByComponentKey[lowerKey]).not.toBe(graph.assemblyByComponentKey[middleKey]);
    expect(graph.assemblyByComponentKey[lowerKey]).not.toBe(graph.assemblyByComponentKey[upperKey]);
    expect(graph.assemblyByComponentKey[middleKey]).not.toBe(graph.assemblyByComponentKey[upperKey]);
  });

  it('does not connect adjacent wall and floor transmissions when their sockets do not meet', () => {
    const wall = createWall({
      x: 0,
      y: 0,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 0
    });
    const floor = createTile({
      x: 0,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 0
    });
    const wallKey = createWallKey(wall.x, wall.y, wall.z, wall.edge);
    const floorKey = createCellKey(floor.x, floor.y, floor.z);

    const graph = buildMechanicalAssemblies({
      tiles: { [floorKey]: floor },
      walls: { [wallKey]: wall }
    });

    expect(graph.assemblyByComponentKey[wallKey]).not.toBe(graph.assemblyByComponentKey[floorKey]);
    expect(graph.assemblies).toHaveLength(2);
  });

  it('splits an assembly when a transmission surface rotation no longer aligns ports', () => {
    const left = createTile({
      x: 0,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 90
    });
    const right = createTile({
      x: 1,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 90
    });
    const leftKey = createCellKey(left.x, left.y, left.z);
    const rightKey = createCellKey(right.x, right.y, right.z);
    const connected = buildMechanicalAssemblies({
      tiles: { [leftKey]: left, [rightKey]: right },
      walls: {}
    });
    const disconnected = buildMechanicalAssemblies({
      tiles: {
        [leftKey]: left,
        [rightKey]: {
          ...right,
          transmissionRotation: 0
        }
      },
      walls: {}
    });

    expect(connected.assemblyByComponentKey[leftKey]).toBe(connected.assemblyByComponentKey[rightKey]);
    expect(disconnected.assemblyByComponentKey[leftKey]).not.toBe(disconnected.assemblyByComponentKey[rightKey]);
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

  it('normalizes transmission skeletons from the active panel type instead of stale saved data', () => {
    const oldTransmission = createTile({
      x: 1,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const mapData = normalizeCityChannelMap({
      tiles: {
        [createCellKey(1, 0, 0)]: {
          ...createTile({
            x: 1,
            y: 0,
            z: 0,
            panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
          }),
          transmissionSkeleton: oldTransmission.transmissionSkeleton
        }
      },
      walls: {}
    });

    expect(mapData.tiles[createCellKey(1, 0, 0)].transmissionSkeleton).toBeNull();
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

  it('validates gear axis bindings against the bound board corner', () => {
    const hostKey = createCellKey(0, 0, 0);
    const boundKey = createCellKey(1, 1, 0);
    const host = createTile({ x: 0, y: 0, z: 0 });
    const bound = createTile({ x: 1, y: 1, z: 0 });
    const mount = {
      id: 'gear_bound',
      componentType: 'gear',
      position: 'corner_se',
      surface: 'front',
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    };
    const mapData = {
      tiles: {
        [hostKey]: host,
        [boundKey]: bound
      },
      walls: {}
    };

    expect(getGearAxisBindingStatus({ mapData, placement: host, mount })).toMatchObject({
      bound: true,
      valid: true,
      reason: 'ok'
    });
    expect(getGearAxisBindingStatus({
      mapData: {
        ...mapData,
        tiles: {
          [hostKey]: host,
          [boundKey]: { ...bound, x: 2 }
        }
      },
      placement: host,
      mount
    })).toMatchObject({
      bound: true,
      valid: false,
      reason: 'detached_pivot'
    });
    expect(getGearAxisBindingStatus({
      mapData: { tiles: { [hostKey]: host }, walls: {} },
      placement: host,
      mount
    })).toMatchObject({
      bound: true,
      valid: false,
      reason: 'missing_component'
    });
  });

  it('validates gear axis bindings on vertical wall surfaces', () => {
    const hostKey = createWallKey(0, 0, 0, 'east');
    const boundKey = createWallKey(0, 0, 1, 'east');
    const host = createWall({ x: 0, y: 0, z: 0, edge: 'east' });
    const bound = createWall({ x: 0, y: 0, z: 1, edge: 'east' });
    const mount = {
      id: 'gear_wall_bound',
      componentType: 'gear',
      position: 'corner_ne',
      surface: 'front',
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'wall',
        socket: 'corner_se',
        surface: 'front'
      }
    };
    const mapData = {
      tiles: {},
      walls: {
        [hostKey]: host,
        [boundKey]: bound
      }
    };

    expect(getGearAxisBindingStatus({ mapData, placement: host, mount })).toMatchObject({
      bound: true,
      valid: true,
      reason: 'ok'
    });
    expect(getGearAxisBindingStatus({
      mapData: {
        tiles: {},
        walls: {
          [hostKey]: host,
          [boundKey]: { ...bound, z: 2 }
        }
      },
      placement: host,
      mount
    })).toMatchObject({
      bound: true,
      valid: false,
      reason: 'detached_pivot'
    });
  });

  it('does not use stale gear axis bindings as fixed axes', () => {
    const hostKey = createCellKey(0, 0, 0);
    const host = createTile({
      x: 0,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    host.gearMounts = [{
      id: 'gear_stale',
      componentType: 'gear',
      position: 'corner_se',
      surface: 'front',
      axisBinding: {
        componentKey: createCellKey(1, 1, 0),
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    }];

    const graph = buildMechanicalAssemblies({
      tiles: { [hostKey]: host },
      walls: {}
    });

    expect(graph.assemblies[0]?.fixedAxes).toHaveLength(0);
    expect(graph.assemblies[0]?.gearMounts[0]).toMatchObject({
      axisBinding: null,
      axisBindingInvalid: true,
      axisBindingInvalidReason: 'missing_component'
    });
  });

  it('does not create a mechanical assembly from gears without transmission skeletons', () => {
    const tile = {
      ...createTile({
        x: 4,
        y: 4,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      gearMounts: [{
        id: 'gear_free',
        componentType: 'gear',
        position: 'center',
        surface: 'front',
        axisType: 'freeAxis'
      }]
    };

    const graph = buildMechanicalAssemblies({
      tiles: {
        [createCellKey(tile.x, tile.y, tile.z)]: tile
      },
      walls: {}
    });

    expect(graph.assemblies).toHaveLength(0);
    expect(graph.assemblyByComponentKey[createCellKey(tile.x, tile.y, tile.z)]).toBeUndefined();
  });
});
