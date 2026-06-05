import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from '../cityChannelSchema';
import {
  buildGearContactGraph,
  doesGearBlockWall,
  getGearHit,
  getGearInstallTarget,
  getGearPhase,
  getGearSurfaceKey,
  getGearSurfaceNormal,
  hasCornerGearConflict,
  getMountedGearLayerKey,
  getVisibleGearSurfaceSide,
  isGearOnCameraSide,
  isGearSocketBlockedBySurface,
  isGearSurfaceVisible,
  projectPointToSurfaceLocal,
  resolveDrivenGearNodes
} from './cityChannelGears';
import { getCornerGearBindingCandidates } from '../cityChannelMechanismRuntime';

describe('cityChannelGears', () => {
  const createSurfaceMappers = () => ({
    getGearSurfaceContext: () => ({
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ],
      rotation: 0,
      surface: 'floor'
    }),
    mapGearLocalPointToSurface: (placement, localPosition) => ({
      x: (localPosition.x + 0.5) * 100,
      y: (localPosition.y + 0.5) * 100
    })
  });

  it('resolves surface visibility and layer keys', () => {
    expect(getGearSurfaceNormal({ edge: 'north' }, 'front')).toEqual({ x: 0, y: -1 });
    expect(getGearSurfaceNormal({ edge: 'north' }, 'back')).toEqual({ x: -0, y: 1 });

    const floor = { x: 1, y: 1, z: 0 };
    expect(isGearSurfaceVisible(floor, { surface: 'front' })).toBe(true);
    expect(isGearSurfaceVisible(floor, { surface: 'back' })).toBe(false);
    expect(isGearOnCameraSide(floor, { surface: 'front' }, 0)).toBe(true);

    const wall = { x: 1, y: 1, z: 0, edge: 'north' };
    const visibleSurface = getVisibleGearSurfaceSide(wall, 0);
    expect(['front', 'back']).toContain(visibleSurface);
    expect(isGearOnCameraSide(wall, { surface: visibleSurface }, 0)).toBe(true);
    expect(isGearOnCameraSide(wall, { surface: visibleSurface === 'front' ? 'back' : 'front' }, 0)).toBe(true);
    expect(isGearOnCameraSide(
      { ...wall, panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE },
      { surface: visibleSurface === 'front' ? 'back' : 'front' },
      0
    )).toBe(false);
    expect(getMountedGearLayerKey('tile', '0:1:2', 'near')).toBe('gear-near:tile:0:1:2');
  });

  it('returns the nearest visible gear hit and ignores hidden floor gears', () => {
    const tileKey = createCellKey(1, 1, 0);
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    tile.gearMounts = [{
      id: 'gear_a',
      position: 'center',
      surface: 'front'
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'gear hit' }),
      tiles: { [tileKey]: tile }
    };

    expect(getGearHit({
      mapData,
      cameraYaw: 0,
      zoom: 1,
      localPoint: { x: 100, y: 100 },
      getGearMountPoint: () => ({ x: 100, y: 100 })
    })).toMatchObject({
      type: 'gear',
      hostKind: 'tile',
      hostKey: tileKey,
      mount: { id: 'gear_a' }
    });

    tile.gearMounts = [{
      id: 'gear_back',
      position: 'center',
      surface: 'back'
    }];
    expect(getGearHit({
      mapData,
      cameraYaw: 0,
      zoom: 1,
      localPoint: { x: 100, y: 100 },
      getGearMountPoint: () => ({ x: 100, y: 100 })
    })).toBeNull();
  });

  it('returns nearest valid gear install socket and marks occupied sockets invalid', () => {
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const tileKey = createCellKey(tile.x, tile.y, tile.z);
    const mapData = {
      ...createBaseCityChannelMap({ name: 'gear placement' }),
      tiles: { [tileKey]: tile }
    };
    const target = getGearInstallTarget({
      mapData,
      hitInfo: {
        hit: {
          type: 'tile',
          cell: { x: tile.x, y: tile.y, z: tile.z },
          tile,
          panelType: tile.panelType,
          gearSurfacePlane: true,
          surfaceSide: 'front',
          localSurfacePoint: { x: 50, y: 50 }
        },
        localPoint: { x: 50, y: 50 }
      },
      ...createSurfaceMappers()
    });

    expect(target).toMatchObject({
      hostKind: 'tile',
      hostKey: tileKey,
      socket: 'center',
      valid: true,
      reason: 'ok'
    });

    tile.gearMounts = [{ id: 'existing', position: 'center', surface: 'front' }];
    expect(getGearInstallTarget({
      mapData,
      hitInfo: {
        hit: {
          type: 'tile',
          cell: { x: tile.x, y: tile.y, z: tile.z },
          tile,
          panelType: tile.panelType,
          gearSurfacePlane: true,
          surfaceSide: 'front',
          localSurfacePoint: { x: 50, y: 50 }
        },
        localPoint: { x: 50, y: 50 }
      },
      ...createSurfaceMappers()
    })).toMatchObject({
      socket: 'center',
      valid: false,
      reason: 'occupied'
    });
  });

  it('normalizes non-directional board back surface hits to the shared front surface', () => {
    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'north',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const wallKey = createWallKey(wall.x, wall.y, wall.z, wall.edge);
    const mapData = {
      ...createBaseCityChannelMap({ name: 'neutral surface gear placement' }),
      walls: { [wallKey]: wall }
    };
    const target = getGearInstallTarget({
      mapData,
      hitInfo: {
        hit: {
          type: 'wall',
          cell: { x: wall.x, y: wall.y, z: wall.z },
          edge: wall.edge,
          wall,
          panelType: wall.panelType,
          gearSurfacePlane: true,
          surfaceSide: 'back',
          localSurfacePoint: { x: 50, y: 50 }
        },
        localPoint: { x: 50, y: 50 }
      },
      ...createSurfaceMappers()
    });

    expect(target).toMatchObject({
      hostKind: 'wall',
      hostKey: wallKey,
      surface: 'front'
    });
  });

  it('returns corner binding candidates and rejects duplicate corner gears', () => {
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const neighbor = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const tileKey = createCellKey(tile.x, tile.y, tile.z);
    const neighborKey = createCellKey(neighbor.x, neighbor.y, neighbor.z);
    const mapData = {
      ...createBaseCityChannelMap({ name: 'corner binding' }),
      tiles: { [tileKey]: tile, [neighborKey]: neighbor }
    };
    const target = getGearInstallTarget({
      mapData,
      hitInfo: {
        hit: {
          type: 'tile',
          cell: { x: tile.x, y: tile.y, z: tile.z },
          tile,
          panelType: tile.panelType,
          gearSurfacePlane: true,
          surfaceSide: 'front',
          localSurfacePoint: { x: 100, y: 0 }
        },
        localPoint: { x: 100, y: 0 }
      },
      ...createSurfaceMappers()
    });

    expect(target).toMatchObject({
      socket: 'corner_ne',
      socketKind: 'corner',
      valid: true,
      reason: 'ok'
    });
    expect(target.bindingCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ componentKey: tileKey, socket: 'corner_ne' }),
      expect.objectContaining({ componentKey: neighborKey, socket: 'corner_nw' })
    ]));
    expect(getCornerGearBindingCandidates({
      mapData,
      pivotWorld: target.pivotWorld
    })).toHaveLength(2);

    tile.gearMounts = [{ id: 'existing', position: 'corner_ne', surface: 'front' }];
    expect(hasCornerGearConflict({ mapData, pivotWorld: target.pivotWorld, surface: 'front' })).toBe(true);
    expect(getGearInstallTarget({
      mapData,
      hitInfo: {
        hit: {
          type: 'tile',
          cell: { x: neighbor.x, y: neighbor.y, z: neighbor.z },
          tile: neighbor,
          panelType: neighbor.panelType,
          gearSurfacePlane: true,
          surfaceSide: 'front',
          localSurfacePoint: { x: 0, y: 0 }
        },
        localPoint: { x: 0, y: 0 }
      },
      ...createSurfaceMappers()
    })).toMatchObject({
      socket: 'corner_nw',
      valid: false,
      reason: 'corner_occupied'
    });
  });

  it('detects socket blocking while gears do not block wall placement', () => {
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'north',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'gear blocked' }),
      tiles: { [createCellKey(tile.x, tile.y, tile.z)]: tile },
      walls: { [createWallKey(wall.x, wall.y, wall.z, wall.edge)]: wall }
    };

    expect(isGearSocketBlockedBySurface({
      mapData,
      placement: tile,
      socket: 'corner_ne'
    })).toBe(true);

    tile.gearMounts = [{ id: 'edge_gear', position: 'corner_ne', surface: 'front' }];
    expect(doesGearBlockWall({
      mapData,
      cell: { x: tile.x, y: tile.y, z: tile.z },
      edge: 'north'
    })).toBe(false);
  });

  it('does not block wall edges touched by a corner gear', () => {
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    tile.gearMounts = [{ id: 'corner_gear', position: 'corner_ne', surface: 'front' }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'corner gear cross edge blocking' }),
      tiles: { [createCellKey(tile.x, tile.y, tile.z)]: tile },
      walls: {}
    };

    [
      [{ x: 1, y: 1, z: 0 }, 'north'],
      [{ x: 1, y: 1, z: 0 }, 'east'],
      [{ x: 2, y: 0, z: 0 }, 'south'],
      [{ x: 2, y: 0, z: 0 }, 'west'],
      [{ x: 1, y: 1, z: 0 }, 'south'],
      [{ x: 1, y: 1, z: 0 }, 'west'],
      [{ x: 2, y: 0, z: 0 }, 'north'],
      [{ x: 2, y: 0, z: 0 }, 'east']
    ].forEach(([cell, edge]) => {
      expect(doesGearBlockWall({ mapData, cell, edge })).toBe(false);
    });
  });

  it('ignores directional gear surfaces for wall placement blocking', () => {
    const tile = createTile({
      x: 4,
      y: 4,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    tile.gearMounts = [{ id: 'front_gear', position: 'corner_ne', surface: 'front' }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'gear surface wall blocking' }),
      tiles: { [createCellKey(tile.x, tile.y, tile.z)]: tile },
      walls: {}
    };

    expect(doesGearBlockWall({
      mapData,
      cell: { x: tile.x, y: tile.y, z: tile.z },
      edge: 'north',
      surface: 'front'
    })).toBe(false);
    expect(doesGearBlockWall({
      mapData,
      cell: { x: tile.x, y: tile.y, z: tile.z },
      edge: 'north',
      surface: 'back'
    })).toBe(false);

    tile.gearMounts = [{ id: 'back_gear', position: 'corner_ne', surface: 'back' }];
    expect(doesGearBlockWall({
      mapData,
      cell: { x: tile.x, y: tile.y, z: tile.z },
      edge: 'north',
      surface: 'front'
    })).toBe(false);
    expect(doesGearBlockWall({
      mapData,
      cell: { x: tile.x, y: tile.y, z: tile.z },
      edge: 'north',
      surface: 'back'
    })).toBe(false);
  });

  it('projects surface points into local coordinates', () => {
    expect(projectPointToSurfaceLocal(
      { x: 50, y: 50 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      0
    )).toEqual({ x: 0, y: 0 });
  });

  it('resolves contact graph and driven gear phase', () => {
    expect(getGearSurfaceKey({ x: 0, y: 0, z: 2 }, { surface: 'front' })).toBe('floor:2:front');
    expect(getGearSurfaceKey({ x: 0, y: 0, z: 1, edge: 'east' }, { surface: 'back' })).toBe('edge:1:east:front');
    expect(getGearSurfaceKey(
      { x: 0, y: 0, z: 1, edge: 'east', panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE },
      { surface: 'back' }
    )).toBe('edge:1:east:back');
    expect(getGearSurfaceKey({ x: 0, y: 0, z: 3, isVertical: true, rotation: 90 }, {})).toBe('vertical:3:90:front');

    const nodes = [
      { id: 'a', surfaceKey: 'floor:0:front', point: { x: 0, y: 0 }, pitchRadius: 18 },
      { id: 'b', surfaceKey: 'floor:0:front', point: { x: 35, y: 0 }, pitchRadius: 18 },
      { id: 'c', surfaceKey: 'floor:0:back', point: { x: 35, y: 0 }, pitchRadius: 18 },
      { id: 'd', surfaceKey: 'floor:0:front', point: { x: 120, y: 0 }, pitchRadius: 18 }
    ];
    const graph = buildGearContactGraph(nodes);
    expect(graph.get('a')).toEqual([{ id: 'b', ratio: -1 }]);
    expect(graph.get('b')).toEqual([{ id: 'a', ratio: -1 }]);
    expect(graph.get('c')).toEqual([]);
    expect(graph.get('d')).toEqual([]);

    const assembly = {
      componentKeys: ['tile:0', 'tile:1'],
      edges: [{ componentKey: 'tile:0', key: 'tile:1' }]
    };
    const allNodes = [
      { id: 'tile:0:gear_a', componentKey: 'tile:0', point: { x: 0, y: 0 }, surfaceKey: 'floor:0:front', pitchRadius: 18 },
      { id: 'tile:1:gear_b', componentKey: 'tile:1', point: { x: 35, y: 0 }, surfaceKey: 'floor:0:front', pitchRadius: 18 },
      { id: 'tile:2:gear_c', componentKey: 'tile:2', point: { x: 70, y: 0 }, surfaceKey: 'floor:0:front', pitchRadius: 18 }
    ];

    const driven = resolveDrivenGearNodes({
      assembly,
      assemblyNodes: allNodes.slice(0, 2),
      allNodes,
      sourceComponentKey: 'tile:0'
    });

    expect(driven.map((node) => node.id)).toEqual(['tile:0:gear_a', 'tile:1:gear_b', 'tile:2:gear_c']);
    expect(driven.map((node) => node.direction)).toEqual([1, -1, 1]);
    expect(getGearPhase(driven[1], 45, 10)).toBe(325);
    expect(getGearPhase(driven[2], 45, 10)).toBe(55);
  });

  it('does not pin two meshed gear roots to the same direction', () => {
    const assembly = {
      componentKeys: ['source', 'gear_a_host', 'gear_b_host'],
      edges: [
        { componentKey: 'source', key: 'gear_a_host' },
        { componentKey: 'source', key: 'gear_b_host' }
      ]
    };
    const allNodes = [
      { id: 'gear_a', componentKey: 'gear_a_host', point: { x: 0, y: 0 }, surfaceKey: 'floor:0:front', pitchRadius: 18 },
      { id: 'gear_b', componentKey: 'gear_b_host', point: { x: 35, y: 0 }, surfaceKey: 'floor:0:front', pitchRadius: 18 }
    ];

    const driven = resolveDrivenGearNodes({
      assembly,
      assemblyNodes: allNodes,
      allNodes,
      sourceComponentKey: 'source'
    });

    expect(driven.map((node) => node.id)).toEqual(['gear_a', 'gear_b']);
    expect(driven.map((node) => node.direction)).toEqual([1, -1]);
  });

  it('does not direct-drive a corner gear bound to a board outside the pressure assembly', () => {
    const assembly = {
      componentKeys: ['pressure', 'corner_host'],
      edges: [{ componentKey: 'pressure', key: 'corner_host' }]
    };
    const allNodes = [
      {
        id: 'pressure:gear_center',
        componentKey: 'pressure',
        point: { x: 0, y: 0 },
        surfaceKey: 'floor:0:front',
        pitchRadius: 18
      },
      {
        id: 'corner_host:gear_corner',
        componentKey: 'corner_host',
        point: { x: 100, y: 0 },
        surfaceKey: 'floor:0:front',
        pitchRadius: 18,
        mount: {
          axisBinding: {
            componentKey: 'bound_board',
            hostKind: 'tile',
            socket: 'corner_nw',
            surface: 'front'
          }
        }
      }
    ];

    const driven = resolveDrivenGearNodes({
      assembly,
      assemblyNodes: allNodes,
      allNodes,
      sourceComponentKey: 'pressure'
    });

    expect(driven.map((node) => node.id)).toEqual(['pressure:gear_center']);
  });

  it('keeps a meshed corner gear bound to the active center gear board spinning as passive', () => {
    const assembly = {
      componentKeys: ['pressure', 'corner_host'],
      edges: [{ componentKey: 'pressure', key: 'corner_host' }]
    };
    const allNodes = [
      {
        id: 'pressure:gear_center',
        componentKey: 'pressure',
        point: { x: 0, y: 0 },
        surfaceKey: 'floor:0:front',
        pitchRadius: 18
      },
      {
        id: 'corner_host:gear_corner',
        componentKey: 'corner_host',
        point: { x: 36, y: 0 },
        surfaceKey: 'floor:0:front',
        pitchRadius: 18,
        mount: {
          position: 'corner_nw',
          axisBinding: {
            componentKey: 'pressure',
            hostKind: 'tile',
            socket: 'corner_nw',
            surface: 'front'
          }
        }
      }
    ];

    const driven = resolveDrivenGearNodes({
      assembly,
      assemblyNodes: allNodes,
      allNodes,
      sourceComponentKey: 'pressure'
    });

    expect(driven.map((node) => node.id)).toEqual(['pressure:gear_center', 'corner_host:gear_corner']);
    expect(driven[1]).toMatchObject({
      direction: -1,
      isDriveRoot: false,
      drivenByGearId: 'pressure:gear_center',
      axisBindingSuppressed: true
    });
  });

  it('keeps a meshed corner gear bound to another source-assembly board spinning as passive', () => {
    const assembly = {
      componentKeys: ['pressure', 'vertical_link'],
      edges: [{ componentKey: 'pressure', key: 'vertical_link' }]
    };
    const sourceNode = {
      id: 'pressure:gear_center',
      componentKey: 'pressure',
      point: { x: 0, y: 0 },
      surfaceKey: 'floor:0:front',
      pitchRadius: 18,
      mount: {
        id: 'gear_center',
        position: 'center'
      }
    };
    const cornerNode = {
      id: 'corner_host:gear_corner',
      componentKey: 'corner_host',
      point: { x: 36, y: 0 },
      surfaceKey: 'floor:0:front',
      pitchRadius: 18,
      mount: {
        id: 'gear_corner',
        position: 'corner_nw',
        axisBinding: {
          componentKey: 'vertical_link',
          hostKind: 'tile',
          socket: 'corner_se',
          surface: 'front'
        }
      }
    };

    const driven = resolveDrivenGearNodes({
      assembly,
      assemblyNodes: [sourceNode],
      allNodes: [sourceNode, cornerNode],
      sourceComponentKey: 'pressure'
    });
    const corner = driven.find((node) => node.id === 'corner_host:gear_corner');

    expect(corner).toMatchObject({
      direction: -1,
      isDriveRoot: false,
      drivenByGearId: 'pressure:gear_center',
      axisBindingSuppressed: true
    });
  });

  it('does not let a same-board bound corner gear become a root before its center gear', () => {
    const assembly = {
      componentKeys: ['pressure', 'driver'],
      edges: [{ componentKey: 'pressure', key: 'driver' }]
    };
    const allNodes = [
      {
        id: 'driver:gear_corner',
        componentKey: 'driver',
        point: { x: 35, y: 0 },
        surfaceKey: 'floor:0:front',
        pitchRadius: 18,
        mount: {
          id: 'gear_corner',
          position: 'corner_se',
          axisBinding: {
            componentKey: 'driver',
            hostKind: 'tile',
            socket: 'corner_se',
            surface: 'front'
          }
        }
      },
      {
        id: 'driver:gear_center',
        componentKey: 'driver',
        point: { x: 0, y: 0 },
        surfaceKey: 'floor:0:front',
        pitchRadius: 18,
        mount: {
          id: 'gear_center',
          position: 'center'
        }
      }
    ];

    const driven = resolveDrivenGearNodes({
      assembly,
      assemblyNodes: allNodes,
      allNodes,
      sourceComponentKey: 'pressure'
    });
    const center = driven.find((node) => node.id === 'driver:gear_center');
    const corner = driven.find((node) => node.id === 'driver:gear_corner');

    expect(center).toMatchObject({
      direction: 1,
      isDriveRoot: true
    });
    expect(corner).toMatchObject({
      direction: -1,
      isDriveRoot: false,
      drivenByGearId: 'driver:gear_center',
      axisBindingSuppressed: true
    });
  });

  it('uses stable world positions and tooth counts for gear mesh ratios', () => {
    const nodes = [
      {
        id: 'a',
        surfaceKey: 'floor:0:front',
        point: { x: 1000, y: 1000 },
        worldPoint: { x: 0, y: 0, z: 0 },
        pitchRadiusWorld: 0.2,
        gearRatioRadius: 12
      },
      {
        id: 'b',
        surfaceKey: 'floor:0:front',
        point: { x: -1000, y: -1000 },
        worldPoint: { x: 0.4, y: 0, z: 0 },
        pitchRadiusWorld: 0.2,
        gearRatioRadius: 24
      }
    ];

    const graph = buildGearContactGraph(nodes);

    expect(graph.get('a')).toEqual([{ id: 'b', ratio: -0.5 }]);
    expect(graph.get('b')).toEqual([{ id: 'a', ratio: -2 }]);
  });

  it('uses physical mesh planes for adjacent gears on different render surfaces', () => {
    const nodes = [
      {
        id: 'a',
        surfaceKey: 'vertical:0:0:front',
        point: { x: 100, y: 100 },
        worldPoint: { x: 10, y: 10, z: 0 },
        pitchRadius: 18,
        pitchRadiusWorld: 0.2,
        meshPlane: {
          kind: 'vertical',
          normal: { x: 0, y: 1, z: 0 },
          planeOffset: 0,
          u: 0,
          v: 0
        }
      },
      {
        id: 'b',
        surfaceKey: 'edge:0:east:front',
        point: { x: 135, y: 100 },
        worldPoint: { x: 20, y: 20, z: 0 },
        pitchRadius: 18,
        pitchRadiusWorld: 0.2,
        meshPlane: {
          kind: 'vertical',
          normal: { x: 0, y: 1, z: 0 },
          planeOffset: 0,
          u: 0.4,
          v: 0
        }
      },
      {
        id: 'c',
        surfaceKey: 'vertical:0:0:back',
        point: { x: 100, y: 100 },
        worldPoint: { x: 10, y: 10, z: 0 },
        pitchRadius: 1,
        pitchRadiusWorld: 0.2,
        meshPlane: {
          kind: 'vertical',
          normal: { x: 0, y: -1, z: 0 },
          planeOffset: 0,
          u: 0,
          v: 0
        }
      },
      {
        id: 'd',
        surfaceKey: 'vertical:0:0:front',
        point: { x: 100, y: 100 },
        worldPoint: { x: 10, y: 10, z: 0 },
        pitchRadius: 1,
        pitchRadiusWorld: 0.2,
        meshPlane: {
          kind: 'vertical',
          normal: { x: 0, y: 1, z: 0 },
          planeOffset: 0.3,
          u: 0,
          v: 0
        }
      }
    ];

    const graph = buildGearContactGraph(nodes);

    expect(graph.get('a')).toEqual([{ id: 'b', ratio: -1 }]);
    expect(graph.get('b')).toEqual([{ id: 'a', ratio: -1 }]);
    expect(graph.get('c')).toEqual([]);
    expect(graph.get('d')).toEqual([]);
  });
});
