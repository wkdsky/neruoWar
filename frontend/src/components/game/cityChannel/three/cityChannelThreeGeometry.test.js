import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from '../cityChannelSchema';
import { CITY_CHANNEL_GEAR_THICKNESS_WORLD } from '../cityChannelMechanismSimulation';
import {
  buildCityChannelThreeRenderModel,
  cellToThreePosition,
  createThreeTilePlacementOperation,
  createThreeVerticalTilePlacementOperation,
  createThreeWallPlacementOperation,
  getThreeNearestCellEdge,
  getThreeVerticalTilePlacementBlockReason,
  getThreeVerticalTilePlacementCell,
  getThreeVerticalTileRotationForSupport,
  getThreeVerticalTopPlacementTarget,
  getThreeWallPlacementBlockReason,
  getTileThreeTransform,
  getThreeGearSurfacePoint,
  getThreeSurfaceNormal,
  getThreeSurfacePoint,
  getThreeTransmissionLineSegments,
  getWallThreeTransform,
  hasThreeWallSupport,
  isThreePlacementVisible,
  isThreeVerticalSupportTopHit,
  isThreeWallPhysicalPlaneOccupied,
  resolveThreeHoverSnapIntent,
  threePositionToCell
} from './cityChannelThreeGeometry';

describe('cityChannelThreeGeometry', () => {
  it('maps cells into centered Three world coordinates', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4 });
    expect(cellToThreePosition({ x: 0, y: 0, z: 0 }, mapData)).toMatchObject({
      x: -1.5,
      y: 0.04,
      z: -1.5
    });
    expect(cellToThreePosition({ x: 3, y: 3, z: 2 }, mapData)).toMatchObject({
      x: 1.5,
      y: 2.04,
      z: 1.5
    });
    expect(threePositionToCell({ x: -1.5, z: -1.5 }, mapData, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(threePositionToCell({ x: 1.49, z: 1.51 }, mapData, 2)).toEqual({ x: 3, y: 3, z: 2 });
    expect(threePositionToCell({ x: 8, z: 0 }, mapData, 0)).toBeNull();
  });

  it('creates floor and vertical tile transforms from normalized map data', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4 });
    const floor = createTile({
      x: 1,
      y: 2,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      rotation: 90
    });
    const vertical = {
      ...createTile({
        x: 2,
        y: 1,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        rotation: 90
      }),
      isVertical: true
    };

    const floorTransform = getTileThreeTransform(floor, mapData);
    expect(floorTransform).toMatchObject({
      kind: 'tile',
      key: createCellKey(1, 2, 0),
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      size: { x: 1, y: 0.08, z: 1 }
    });
    expect(floorTransform.rotationY).toBeCloseTo(Math.PI / 2);

    const verticalTransform = getTileThreeTransform(vertical, mapData);
    expect(verticalTransform).toMatchObject({
      kind: 'verticalTile',
      key: createCellKey(2, 1, 1),
      size: { x: 0.08, y: 1, z: 1 }
    });
    expect(verticalTransform.position.y).toBeCloseTo(1.5);

    const eastWestVerticalTransform = getTileThreeTransform({
      ...vertical,
      rotation: 0
    }, mapData);
    expect(eastWestVerticalTransform.size).toEqual({ x: 1, y: 1, z: 0.08 });

    const portalTransform = getTileThreeTransform(createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.ENTRANCE,
      isVertical: true
    }), mapData);
    expect(portalTransform).toMatchObject({
      kind: 'tile',
      panelType: CITY_CHANNEL_TILE_TYPES.ENTRANCE,
      size: { x: 1, y: 0.08, z: 1 }
    });
  });

  it('places edge walls on their real cell edge', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4 });
    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const transform = getWallThreeTransform(wall, mapData);
    expect(transform).toMatchObject({
      kind: 'wall',
      key: createWallKey(1, 1, 0, 'east'),
      edge: 'east',
      size: { x: 0.08, y: 1, z: 1 }
    });
    expect(transform.rotationY).toBe(0);
    expect(transform.position.x).toBeCloseTo(0);
    expect(transform.position.z).toBeCloseTo(-0.5);

    const oppositeTransform = getWallThreeTransform({
      ...wall,
      x: 2,
      edge: 'west'
    }, mapData);
    expect(oppositeTransform.position.x).toBeCloseTo(transform.position.x);
    expect(oppositeTransform.position.z).toBeCloseTo(transform.position.z);
    expect(oppositeTransform.size).toEqual(transform.size);

    const eastSurface = getThreeSurfacePoint(transform, { x: 0, y: 0 }, { lift: 0.04 });
    const westSurface = getThreeSurfacePoint(oppositeTransform, { x: 0, y: 0 }, { lift: 0.04 });
    expect(westSurface.x).toBeCloseTo(eastSurface.x);
    expect(westSurface.z).toBeCloseTo(eastSurface.z);
  });

  it('builds a render model for floor tiles and edge walls', () => {
    const tile = createTile({ x: 1, y: 1, z: 0 });
    const wall = createWall({ x: 1, y: 1, z: 0, edge: 'north' });
    const mapData = {
      ...createBaseCityChannelMap({
        width: 4,
        height: 4
      }),
      tiles: {
        [createCellKey(1, 1, 0)]: tile
      },
      walls: {
        [createWallKey(1, 1, 0, 'north')]: wall
      }
    };
    const model = buildCityChannelThreeRenderModel(mapData);
    expect(model.tiles).toHaveLength(1);
    expect(model.walls).toHaveLength(1);
    expect(model.tiles[0].key).toBe(createCellKey(1, 1, 0));
    expect(model.walls[0].key).toBe(createWallKey(1, 1, 0, 'north'));
  });

  it('keeps upper vertical wall layers when legacy layer count is too small', () => {
    const lowerWall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const upperWall = createWall({
      x: 1,
      y: 1,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({
        width: 4,
        height: 4,
        layers: 1
      }),
      walls: {
        [createWallKey(1, 1, 0, 'east')]: lowerWall,
        [createWallKey(1, 1, 1, 'east')]: upperWall
      }
    };

    const model = buildCityChannelThreeRenderModel(mapData);
    const lowerTransform = model.walls.find((transform) => transform.key === createWallKey(1, 1, 0, 'east'));
    const upperTransform = model.walls.find((transform) => transform.key === createWallKey(1, 1, 1, 'east'));

    expect(model.mapData.layers).toBe(2);
    expect(model.walls).toHaveLength(2);
    expect(lowerTransform?.position.y + (lowerTransform?.size.y * 0.5)).toBeCloseTo(1);
    expect(upperTransform?.position.y - (upperTransform?.size.y * 0.5)).toBeCloseTo(1);
  });

  it('keeps stacked vertical tile attachments visible above the current floor cut', () => {
    const floor = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const lowerVertical = {
      ...createTile({
        x: 1,
        y: 1,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      isVertical: true
    };
    const upperVertical = {
      ...createTile({
        x: 1,
        y: 1,
        z: 2,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
      }),
      isVertical: true
    };
    const unrelatedVertical = {
      ...createTile({
        x: 3,
        y: 3,
        z: 2,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      isVertical: true
    };
    const hiddenFloor = createTile({
      x: 2,
      y: 2,
      z: 1,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles: {
        [createCellKey(1, 1, 0)]: floor,
        [createCellKey(1, 1, 1)]: lowerVertical,
        [createCellKey(1, 1, 2)]: upperVertical,
        [createCellKey(3, 3, 2)]: unrelatedVertical,
        [createCellKey(2, 2, 1)]: hiddenFloor
      }
    };

    expect(isThreePlacementVisible(lowerVertical, { mapData, visibleLayerCutoff: 0 })).toBe(true);
    expect(isThreePlacementVisible(upperVertical, { mapData, visibleLayerCutoff: 0 })).toBe(true);
    expect(isThreePlacementVisible(unrelatedVertical, { mapData, visibleLayerCutoff: 0 })).toBe(false);
    expect(isThreePlacementVisible(hiddenFloor, { mapData, visibleLayerCutoff: 0 })).toBe(false);
  });

  it('keeps horizontal panels attached to visible vertical supports visible above the floor cut', () => {
    const floor = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const lowerWall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const upperWall = createWall({
      x: 1,
      y: 1,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const frontFloor = createTile({
      x: 2,
      y: 1,
      z: 1,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const backFloor = createTile({
      x: 1,
      y: 1,
      z: 1,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    const hiddenFloor = createTile({
      x: 3,
      y: 3,
      z: 1,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 5, height: 5, layers: 3 }),
      tiles: {
        [createCellKey(1, 1, 0)]: floor,
        [createCellKey(2, 1, 1)]: frontFloor,
        [createCellKey(1, 1, 1)]: backFloor,
        [createCellKey(3, 3, 1)]: hiddenFloor
      },
      walls: {
        [createWallKey(1, 1, 0, 'east')]: lowerWall,
        [createWallKey(1, 1, 1, 'east')]: upperWall
      }
    };

    expect(isThreePlacementVisible(upperWall, { mapData, visibleLayerCutoff: 0 })).toBe(true);
    expect(isThreePlacementVisible(frontFloor, { mapData, visibleLayerCutoff: 0 })).toBe(true);
    expect(isThreePlacementVisible(backFloor, { mapData, visibleLayerCutoff: 0 })).toBe(true);
    expect(isThreePlacementVisible(hiddenFloor, { mapData, visibleLayerCutoff: 0 })).toBe(false);
  });

  it('projects transmission skeletons onto the 3D panel surface', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4 });
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const transform = getTileThreeTransform(tile, mapData);
    const segments = getThreeTransmissionLineSegments(transform);
    expect(segments).toHaveLength(4);
    segments.forEach((segment) => {
      expect(segment.start.y).toBeCloseTo(0.08 + 0.028);
      expect(segment.end.y).toBeCloseTo(0.08 + 0.028);
    });
  });

  it('applies runtime surface rotation to transmission skeleton points', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4 });
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      transmissionRotation: 0
    });
    tile.runtimeSurfaceRotation = 90;
    const transform = getTileThreeTransform(tile, mapData);
    const northSegment = getThreeTransmissionLineSegments(transform)
      .find((segment) => segment.port.id === 'north');

    expect(northSegment.start.x).toBeCloseTo(-0.5);
    expect(northSegment.start.z).toBeCloseTo(-0.5);
    expect(northSegment.end.x).toBeCloseTo(0);
    expect(northSegment.end.z).toBeCloseTo(-0.5);
  });

  it('projects gear mounts into floor and wall midplanes', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4 });
    const gearTile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.ACTUATOR_CENTER_GEAR_PLATE
    });
    const floorTransform = getTileThreeTransform(gearTile, mapData);
    const floorGearPoint = getThreeGearSurfacePoint(floorTransform, gearTile.gearMounts[0]);
    expect(floorGearPoint).toMatchObject({
      x: -0.5,
      z: -0.5
    });
    expect(floorGearPoint.y).toBeCloseTo(0.04);

    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'north',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const wallTransform = getWallThreeTransform(wall, mapData);
    const wallCenter = getThreeSurfacePoint(wallTransform, { x: 0, y: 0 }, { lift: 0.04 });
    expect(wallCenter.x).toBeCloseTo(-0.5);
    expect(wallCenter.z).toBeLessThan(-0.9);
    expect(wallCenter.y).toBeCloseTo(0.5);
    expect(getThreeSurfaceNormal(floorTransform)).toEqual({ x: 0, y: 1, z: 0 });
    expect(getThreeSurfaceNormal(wallTransform)).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('keeps opposite wall storage keys on the same embedded 3D surface', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4 });
    const eastWall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    const westWall = createWall({
      x: 2,
      y: 1,
      z: 0,
      edge: 'west',
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    const eastTransform = getWallThreeTransform(eastWall, mapData);
    const westTransform = getWallThreeTransform(westWall, mapData);
    const eastFront = getThreeGearSurfacePoint(eastTransform, { position: 'center', surface: 'front' });
    const westFront = getThreeGearSurfacePoint(westTransform, { position: 'center', surface: 'front' });
    const eastBack = getThreeGearSurfacePoint(eastTransform, { position: 'center', surface: 'back' });

    expect(westFront.x).toBeCloseTo(eastFront.x);
    expect(westFront.z).toBeCloseTo(eastFront.z);
    expect(getThreeSurfaceNormal(eastTransform, 'front')).toEqual({ x: 1, y: 0, z: 0 });
    expect(getThreeSurfaceNormal(westTransform, 'front')).toEqual({ x: 1, y: 0, z: 0 });
    expect(getThreeSurfaceNormal(eastTransform, 'back')).toEqual({ x: 1, y: 0, z: 0 });
    expect(eastBack.x).toBeCloseTo(eastFront.x);
    expect(eastBack.z).toBeCloseTo(eastFront.z);
  });

  it('classifies hover zones without changing the hovered board orientation', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4 });
    const floorTransform = getTileThreeTransform(createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    }), mapData);
    const verticalTransform = getTileThreeTransform({
      ...createTile({
        x: 1,
        y: 1,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        rotation: 90
      }),
      isVertical: true
    }, mapData);

    expect(resolveThreeHoverSnapIntent(floorTransform, { x: 0.02, y: 0.02 })).toMatchObject({
      zone: 'center'
    });
    expect(resolveThreeHoverSnapIntent(floorTransform, { x: 0.48, y: 0.02 })).toMatchObject({
      zone: 'edge',
      edge: 'east'
    });
    expect(resolveThreeHoverSnapIntent(verticalTransform, { x: 0.02, y: 0.02 })).toMatchObject({
      zone: 'center'
    });
    expect(resolveThreeHoverSnapIntent(verticalTransform, { x: 0.02, y: -0.45 })).toMatchObject({
      zone: 'top'
    });
    expect(resolveThreeHoverSnapIntent(verticalTransform, { x: 0.32, y: 0.02 })).toMatchObject({
      zone: 'side',
      side: 'right'
    });
  });

  it('creates a floor placement operation only for valid empty cells in place mode', () => {
    const existing = createTile({ x: 1, y: 1, z: 0 });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4 }),
      tiles: {
        [createCellKey(1, 1, 0)]: existing
      }
    };
    expect(createThreeTilePlacementOperation({
      cell: { x: 2, y: 1, z: 0 },
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE,
      activeRotation: 90
    })).toMatchObject({
      kind: 'tile',
      action: 'place',
      cell: { x: 2, y: 1, z: 0 },
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE,
      rotation: 90,
      transmissionRotation: 90
    });
    expect(createThreeTilePlacementOperation({
      cell: { x: 1, y: 1, z: 0 },
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    })).toBeNull();
    expect(createThreeTilePlacementOperation({
      cell: { x: 1, y: 1, z: 0 },
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      activeRotation: 180,
      allowReplacement: true
    })).toMatchObject({
      kind: 'tile',
      action: 'place',
      cell: { x: 1, y: 1, z: 0 },
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      rotation: 180,
      transmissionRotation: 180
    });
    expect(createThreeTilePlacementOperation({
      cell: { x: 2, y: 1, z: 0 },
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.BROWSE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    })).toBeNull();
  });

  it('resolves the nearest real cell edge from a Three hit point', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4 });
    expect(getThreeNearestCellEdge({ x: -0.04, z: -0.5 }, mapData, { x: 1, y: 1, z: 0 })).toMatchObject({
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east'
    });
    expect(getThreeNearestCellEdge({ x: -0.5, z: -0.96 }, mapData, { x: 1, y: 1, z: 0 })).toMatchObject({
      edge: 'north'
    });
    expect(getThreeNearestCellEdge({ x: -0.5, z: -0.02 }, mapData, { x: 1, y: 1, z: 0 })).toMatchObject({
      edge: 'south'
    });
    expect(getThreeNearestCellEdge({ x: -0.97, z: -0.5 }, mapData, { x: 1, y: 1, z: 0 })).toMatchObject({
      edge: 'west'
    });
  });

  it('validates wall placement support and physical plane occupancy', () => {
    const floor = createTile({ x: 1, y: 1, z: 0 });
    const oppositeWall = createWall({ x: 2, y: 1, z: 0, edge: 'west' });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4 }),
      tiles: {
        [createCellKey(1, 1, 0)]: floor
      },
      walls: {
        [createWallKey(2, 1, 0, 'west')]: oppositeWall
      }
    };

    expect(hasThreeWallSupport({ mapData, cell: { x: 1, y: 1, z: 0 }, edge: 'east' })).toBe(true);
    expect(isThreeWallPhysicalPlaneOccupied({ mapData, cell: { x: 1, y: 1, z: 0 }, edge: 'east' })).toBe(true);
    expect(getThreeWallPlacementBlockReason({
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east',
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    })).toBe('occupied');

    const unsupportedMap = createBaseCityChannelMap({ width: 4, height: 4 });
    expect(hasThreeWallSupport({ mapData: unsupportedMap, cell: { x: 1, y: 1, z: 0 }, edge: 'east' })).toBe(false);
    expect(getThreeWallPlacementBlockReason({
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east',
      mapData: unsupportedMap,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    })).toBe('unsupported');

    const portalFloor = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.EXIT
    });
    const portalMap = {
      ...unsupportedMap,
      tiles: {
        [createCellKey(1, 1, 0)]: portalFloor
      }
    };
    expect(hasThreeWallSupport({ mapData: portalMap, cell: { x: 1, y: 1, z: 0 }, edge: 'east' })).toBe(true);
  });

  it('allows same-layer side-connected walls to support continued wall placement', () => {
    const floor = createTile({ x: 1, y: 1, z: 0 });
    const lowerWall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const upperWall = createWall({
      x: 1,
      y: 1,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      tiles: {
        [createCellKey(1, 1, 0)]: floor
      },
      walls: {
        [createWallKey(1, 1, 0, 'east')]: lowerWall,
        [createWallKey(1, 1, 1, 'east')]: upperWall
      }
    };

    expect(hasThreeWallSupport({
      mapData,
      cell: { x: 1, y: 2, z: 1 },
      edge: 'east'
    })).toBe(true);
    expect(getThreeWallPlacementBlockReason({
      cell: { x: 1, y: 2, z: 1 },
      edge: 'east',
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    })).toBeNull();
    expect(createThreeWallPlacementOperation({
      cell: { x: 1, y: 2, z: 1 },
      edge: 'east',
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    })).toMatchObject({
      kind: 'wall',
      action: 'place',
      cell: { x: 1, y: 2, z: 1 },
      edge: 'east'
    });
  });

  it('creates a wall placement operation only for supported empty physical edges', () => {
    const floor = createTile({ x: 1, y: 1, z: 0 });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4 }),
      tiles: {
        [createCellKey(1, 1, 0)]: floor
      }
    };

    expect(createThreeWallPlacementOperation({
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east',
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE,
      activeRotation: 270
    })).toMatchObject({
      kind: 'wall',
      action: 'place',
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE,
      transmissionRotation: 270
    });

    expect(createThreeWallPlacementOperation({
      cell: { x: 1, y: 1, z: 0 },
      edge: 'north',
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.ENTRANCE
    })).toBeNull();
    expect(createThreeWallPlacementOperation({
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east',
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.BROWSE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    })).toBeNull();

    mapData.walls = {
      [createWallKey(1, 1, 0, 'east')]: createWall({
        x: 1,
        y: 1,
        z: 0,
        edge: 'east',
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      })
    };
    expect(createThreeWallPlacementOperation({
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east',
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE,
      allowReplacement: true
    })).toMatchObject({
      kind: 'wall',
      action: 'place',
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
  });

  it('creates a vertical tile placement operation from the top of a vertical tile support', () => {
    const supportTile = {
      ...createTile({
        x: 1,
        y: 1,
        z: 0,
        rotation: 90,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      isVertical: true
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      tiles: {
        [createCellKey(1, 1, 0)]: supportTile
      }
    };
    const supportTransform = getTileThreeTransform(supportTile, mapData);

    expect(getThreeVerticalTilePlacementCell(supportTile)).toEqual({ x: 1, y: 1, z: 1 });
    expect(getThreeVerticalTileRotationForSupport(supportTile)).toBe(90);
    expect(isThreeVerticalSupportTopHit(supportTransform, {
      x: supportTransform.position.x,
      y: supportTransform.position.y + (supportTransform.size.y * 0.5) - 0.02,
      z: supportTransform.position.z
    })).toBe(true);
    expect(isThreeVerticalSupportTopHit(supportTransform, {
      x: supportTransform.position.x,
      y: supportTransform.position.y,
      z: supportTransform.position.z
    })).toBe(false);

    expect(createThreeVerticalTilePlacementOperation({
      supportPlacement: supportTile,
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    })).toMatchObject({
      kind: 'tile',
      action: 'place',
      cell: { x: 1, y: 1, z: 1 },
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      rotation: 90,
      transmissionRotation: 90,
      isVertical: true
    });
    expect(createThreeVerticalTilePlacementOperation({
      supportPlacement: supportTile,
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_ENDPOINT_PLATE,
      activeRotation: 180
    })).toMatchObject({
      kind: 'tile',
      action: 'place',
      cell: { x: 1, y: 1, z: 1 },
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_ENDPOINT_PLATE,
      rotation: 90,
      transmissionRotation: 180,
      isVertical: true
    });
  });

  it('continues edge walls upward on the same physical wall plane', () => {
    const supportWall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      walls: {
        [createWallKey(1, 1, 0, 'east')]: supportWall
      }
    };
    const supportTransform = getWallThreeTransform(supportWall, mapData);
    const topTarget = getThreeVerticalTopPlacementTarget(supportWall);
    const topWall = createWall({
      ...topTarget.cell,
      edge: topTarget.edge,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const topTransform = getWallThreeTransform(topWall, mapData);

    expect(topTarget).toMatchObject({
      kind: 'wall',
      cell: { x: 1, y: 1, z: 1 },
      edge: 'east'
    });
    expect(isThreeVerticalSupportTopHit(supportTransform, {
      x: supportTransform.position.x,
      y: supportTransform.position.y + (supportTransform.size.y * 0.5) - 0.02,
      z: supportTransform.position.z
    })).toBe(true);
    expect(createThreeVerticalTilePlacementOperation({
      supportPlacement: supportWall,
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    })).toBeNull();
    expect(hasThreeWallSupport({ mapData, cell: topTarget.cell, edge: topTarget.edge })).toBe(true);
    expect(getThreeWallPlacementBlockReason({
      cell: topTarget.cell,
      edge: topTarget.edge,
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    })).toBeNull();
    expect(supportTransform.position.y + (supportTransform.size.y * 0.5))
      .toBeCloseTo(topTransform.position.y - (topTransform.size.y * 0.5));
    expect(topTransform.position.x).toBeCloseTo(supportTransform.position.x);
    expect(topTransform.position.z).toBeCloseTo(supportTransform.position.z);
    expect(createThreeWallPlacementOperation({
      cell: topTarget.cell,
      edge: topTarget.edge,
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      activeRotation: 90
    })).toMatchObject({
      kind: 'wall',
      action: 'place',
      cell: { x: 1, y: 1, z: 1 },
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
  });

  it('blocks vertical tile placement when the target is occupied or invalid', () => {
    const supportTile = {
      ...createTile({ x: 1, y: 1, z: 1, rotation: 0 }),
      isVertical: true
    };
    const occupiedMap = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      tiles: {
        [createCellKey(1, 1, 1)]: supportTile,
        [createCellKey(1, 1, 2)]: createTile({ x: 1, y: 1, z: 2 })
      }
    };

    expect(getThreeVerticalTilePlacementBlockReason({
      supportPlacement: supportTile,
      mapData: occupiedMap,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    })).toBe('occupied');
    expect(createThreeVerticalTilePlacementOperation({
      supportPlacement: supportTile,
      mapData: occupiedMap,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    })).toBeNull();

    const topLayerSupport = {
      ...supportTile,
      z: 2
    };
    expect(getThreeVerticalTilePlacementBlockReason({
      supportPlacement: topLayerSupport,
      mapData: occupiedMap,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    })).toBe('invalidCell');
    expect(getThreeVerticalTilePlacementBlockReason({
      supportPlacement: supportTile,
      mapData: occupiedMap,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.ENTRANCE
    })).toBe('invalidMaterial');
    expect(createThreeTilePlacementOperation({
      cell: { x: 1, y: 1, z: 1 },
      mapData: occupiedMap,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.EXIT,
      allowReplacement: true,
      isVertical: true
    })).toBeNull();
  });
});
