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

  it('detects socket and wall placement blocking', () => {
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
    })).toBe(true);
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
    expect(getGearSurfaceKey({ x: 0, y: 0, z: 1, edge: 'east' }, { surface: 'back' })).toBe('edge:1:east:back');
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
});
