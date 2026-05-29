import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from '../cityChannelSchema';
import {
  createStructuralSupportResolver,
  findWallCandidatesForSegment,
  findWallCandidatesForVertex,
  getAbsoluteWallEdgeEndpoints,
  getAxisOptionIndex,
  getAxisOptionKey,
  getAxisPlacementOptions,
  getSnapAxisKey,
  getVerticalSupportConnectionCandidates,
  getWallPhysicalKey,
  hasTileSupport,
  isWallPhysicalPlaneOccupied,
  resolveFloorSnapConnection,
  resolveTransmissionPortConnection
} from './cityChannelVerticalSnap';

const createMap = ({ tiles = {}, walls = {} } = {}) => ({
  ...createBaseCityChannelMap({
    name: 'vertical snap',
    width: 16,
    height: 16,
    layers: 4
  }),
  tiles,
  walls
});

describe('cityChannelVerticalSnap', () => {
  it('finds axis-aligned wall candidates and shared-vertex fallbacks', () => {
    const mapData = createMap();
    const segment = getAbsoluteWallEdgeEndpoints({ x: 3, y: 4, z: 1 }, 'east');
    const segmentCandidates = findWallCandidatesForSegment({ mapData, segment, z: 1 });
    const vertexCandidates = findWallCandidatesForVertex({ mapData, vertex: { x: 0.5, y: 0.5 }, z: 1 });

    expect(segmentCandidates).toContainEqual(expect.objectContaining({
      cell: { x: 3, y: 4, z: 1 },
      edge: 'east'
    }));
    expect(segmentCandidates.some((item) => item.cell.x === 4 && item.cell.y === 5)).toBe(false);
    expect(vertexCandidates.some((item) => item.cell.x === 0 && item.cell.y === 1)).toBe(true);
  });

  it('deduplicates and detects occupied physical wall planes', () => {
    const wall = createWall({ x: 1, y: 1, z: 0, edge: 'east' });
    const mapData = createMap({
      walls: {
        [createWallKey(wall.x, wall.y, wall.z, wall.edge)]: wall
      }
    });

    expect(getWallPhysicalKey({ x: 1, y: 1, z: 0 }, 'east')).toBe(
      getWallPhysicalKey({ x: 2, y: 1, z: 0 }, 'west')
    );
    expect(isWallPhysicalPlaneOccupied({
      mapData,
      cell: { x: 2, y: 1, z: 0 },
      edge: 'west'
    })).toBe(true);
  });

  it('supports grounded structural placements and rejects floating ones', () => {
    const lowerTile = createTile({ x: 1, y: 1, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE });
    const wall = createWall({ x: 1, y: 1, z: 1, edge: 'north', panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE });
    const floatingTile = createTile({ x: 2, y: 2, z: 2, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE });
    const mapData = createMap({
      tiles: {
        [createCellKey(lowerTile.x, lowerTile.y, lowerTile.z)]: lowerTile,
        [createCellKey(floatingTile.x, floatingTile.y, floatingTile.z)]: floatingTile
      },
      walls: {
        [createWallKey(wall.x, wall.y, wall.z, wall.edge)]: wall
      }
    });
    const resolver = createStructuralSupportResolver({ mapData });

    expect(hasTileSupport({ mapData, cell: { x: 1, y: 1, z: 1 } })).toBe(true);
    expect(resolver.isPlacementStructurallyGrounded(wall)).toBe(true);
    expect(resolver.isPlacementStructurallyGrounded(floatingTile)).toBe(false);
  });

  it('selects transmission port connections by socket and endpoint distance', () => {
    const activePlacement = { id: 'active' };
    const supportPlacement = { id: 'support' };
    const activePorts = [{ id: 'a' }];
    const supportPorts = [{ id: 'far' }, { id: 'near' }];
    const sockets = {
      a: { x: 0, y: 0, z: 0 },
      far: { x: 0, y: 0, z: 0 },
      near: { x: 0, y: 0, z: 0 }
    };
    const points = {
      a: { x: 0, y: 0 },
      far: { x: 20, y: 0 },
      near: { x: 5, y: 0 }
    };

    const best = resolveTransmissionPortConnection({
      activePlacement,
      activePorts,
      support: { placement: supportPlacement },
      supportPorts,
      getTransmissionSocketPoint: (placement, port) => sockets[port.id],
      getTransmissionSurfacePortPoint: (placement, port) => points[port.id]
    });

    expect(best.supportPort.id).toBe('near');
    expect(best.socketDistance).toBe(0);
    expect(best.endpointDistance).toBe(5);
  });

  it('filters alternate supports and resolves no-port floor snaps', () => {
    const supportTile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = createMap({
      tiles: {
        [createCellKey(supportTile.x, supportTile.y, supportTile.z)]: supportTile
      }
    });

    expect(getVerticalSupportConnectionCandidates({
      targetCell: { x: 5, y: 5, z: 1 },
      primarySupport: { key: 'near', cell: { x: 5, y: 6, z: 0 }, placement: {} },
      supports: [
        { key: 'near', cell: { x: 5, y: 6, z: 0 }, placement: {} },
        { key: 'far', cell: { x: 9, y: 9, z: 0 }, placement: {} },
        { key: 'blocked', cell: { x: 5, y: 5, z: 0 }, placement: {} }
      ],
      isSupportEligibleForSnap: (support) => support.key !== 'blocked'
    }).map((support) => support.key)).toEqual(['near']);

    expect(resolveFloorSnapConnection({
      mapData,
      targetCell: { x: 1, y: 2, z: 0 },
      supportTile,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      activeRotation: 0,
      getTransmissionSocketPoint: () => null,
      getTransmissionSurfacePortPoint: () => null
    })).toMatchObject({
      valid: true,
      support: {
        key: createCellKey(1, 1, 0)
      }
    });
  });

  it('builds stable snap axis and placement option keys', () => {
    const supportWall = createWall({
      x: 5,
      y: 5,
      z: 0,
      edge: 'south',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const support = {
      kind: 'wall',
      key: createWallKey(supportWall.x, supportWall.y, supportWall.z, supportWall.edge),
      cell: { x: supportWall.x, y: supportWall.y, z: supportWall.z },
      edge: supportWall.edge,
      placement: supportWall
    };
    const mapData = createMap({
      tiles: {
        [createCellKey(5, 5, 0)]: createTile({ x: 5, y: 5, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE })
      },
      walls: {
        [support.key]: supportWall
      }
    });
    const snap = {
      cell: { x: 5, y: 5, z: 1 },
      support,
      side: 'top',
      direction: 'up',
      axisEdge: 'south'
    };
    const options = getAxisPlacementOptions({
      mapData,
      snap,
      resolveVerticalSnapConnection: () => ({ valid: true }),
      hasVerticalSnapStructuralEdgeSupport: () => true,
      isPlacementCellOccupiedForSnap: () => false,
      isPlacementWallOccupiedForSnap: () => false,
      getTransmissionSocketPoint: () => null,
      getTransmissionSurfacePortPoint: () => null
    });

    expect(getSnapAxisKey(snap)).toBe(`${support.key}:top:up:south:${createCellKey(5, 5, 1)}`);
    expect(options.some((option) => option.kind === 'floor')).toBe(true);
    expect(options.some((option) => option.kind === 'wall')).toBe(true);
    expect(getAxisOptionIndex([
      { kind: 'floor', cell: { x: 1, y: 1, z: 0 } },
      { kind: 'wall', cell: { x: 1, y: 1, z: 0 }, edge: 'east' }
    ], {
      kind: 'wall',
      cell: { x: 2, y: 1, z: 0 },
      edge: 'west'
    })).toBe(1);
    expect(getAxisOptionKey({
      kind: 'wall',
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east'
    })).toBe(getAxisOptionKey({
      kind: 'wall',
      cell: { x: 2, y: 1, z: 0 },
      edge: 'west'
    }));
  });
});
