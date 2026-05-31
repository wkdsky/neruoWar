import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from './cityChannelSchema';
import {
  createMechanismRuntimeSnapshot,
  findRotationObstruction,
  getAngleErrorDegrees,
  getAllowedRotationAngle,
  getFixedAxisWorldAnchor,
  getGearWorldPosition,
  getGearTorqueRatio,
  getRuntimePlacementAroundFixedGear,
  rotatePoint,
  validateFixedAxisSync
} from './cityChannelMechanismSimulation';

describe('cityChannelMechanismSimulation', () => {
  it('creates runtime snapshots without mutating static mapData', () => {
    const key = createCellKey(2, 2, 0);
    const tile = createTile({
      x: 2,
      y: 2,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.ACTUATOR_CENTER_GEAR_PLATE
    });
    tile.gearMounts = [{
      id: 'gear_center',
      position: 'center',
      axisType: 'fixedAxis',
      phase: 7,
      teeth: 24
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'runtime snapshot' }),
      tiles: { [key]: tile },
      walls: {}
    };
    const before = JSON.stringify(mapData);
    const fixedAxis = { ...tile.gearMounts[0], componentKey: key, cell: { x: 2, y: 2, z: 0 } };

    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: [{
        assembly: { id: 'assembly_1', componentKeys: [key] },
        fixedAxis,
        anchor: getFixedAxisWorldAnchor(mapData, fixedAxis)
      }],
      gearNodes: [{
        id: `${key}:gear_center`,
        componentKey: key,
        mountId: 'gear_center',
        mount: tile.gearMounts[0],
        driveRatio: 1
      }],
      sourceAngle: 45,
      basePhases: new Map([[`${key}:gear_center`, 7]])
    });

    expect(JSON.stringify(mapData)).toBe(before);
    expect(snapshot.placements[key]).toMatchObject({ runtimeAngle: 45 });
    expect(snapshot.gears[`${key}:gear_center`]).toMatchObject({
      phase: 52,
      speedRatio: 1,
      torqueRatio: 1,
      teeth: 24
    });
    expect(snapshot.sync[0]).toMatchObject({ ok: true, error: 0 });
  });

  it('keeps fixed-axis gear mount anchored while its board rotates', () => {
    const key = createCellKey(2, 2, 0);
    const tile = createTile({
      x: 2,
      y: 2,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    tile.gearMounts = [{
      id: 'gear_corner',
      position: 'corner_ne',
      axisType: 'fixedAxis'
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'fixed axis anchor' }),
      tiles: { [key]: tile },
      walls: {}
    };
    const fixedAxis = { ...tile.gearMounts[0], componentKey: key, cell: { x: 2, y: 2, z: 0 } };
    const anchor = getFixedAxisWorldAnchor(mapData, fixedAxis);

    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: [{
        assembly: { id: 'assembly_1', componentKeys: [key] },
        fixedAxis,
        anchor
      }],
      sourceAngle: 90
    });
    const runtimeMountWorld = getGearWorldPosition(snapshot.placements[key], fixedAxis);

    expect(snapshot.placements[key].runtimeAxisAnchor).toEqual(anchor);
    expect(runtimeMountWorld.x).toBeCloseTo(anchor.x, 4);
    expect(runtimeMountWorld.y).toBeCloseTo(anchor.y, 4);
  });

  it.each([
    ['center', 15],
    ['center', 0],
    ['corner_ne', 0],
    ['corner_ne', 30],
    ['corner_ne', 90]
  ])('keeps %s fixed gear at pivot after %s degree board rotation', (position, delta) => {
    const tile = createTile({
      x: 4,
      y: 5,
      z: 0,
      rotation: 15,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const fixedMount = {
      id: `gear_${position}`,
      position,
      axisType: 'fixedAxis'
    };
    const pivotWorld = getGearWorldPosition(tile, fixedMount);
    const runtimePlacement = getRuntimePlacementAroundFixedGear(tile, fixedMount, pivotWorld, delta);
    const runtimeMountWorld = getGearWorldPosition(runtimePlacement, fixedMount);
    const boardAngle = (15 + delta + 360) % 360;
    const rotatedAnchor = rotatePoint(runtimePlacement.runtimeAnchorLocal, boardAngle);

    expect(runtimePlacement.rotation).toBe(boardAngle);
    expect(runtimePlacement.x).toBeCloseTo(pivotWorld.x - rotatedAnchor.x, 4);
    expect(runtimePlacement.y).toBeCloseTo(pivotWorld.y - rotatedAnchor.y, 4);
    expect(runtimeMountWorld.x).toBeCloseTo(pivotWorld.x, 4);
    expect(runtimeMountWorld.y).toBeCloseTo(pivotWorld.y, 4);
  });

  it.each([
    ['center', 0],
    ['corner_ne', 30],
    ['corner_ne', 90]
  ])('keeps vertical %s fixed gear at 3D pivot after %s degree board rotation', (position, delta) => {
    const tile = createTile({
      x: 4,
      y: 5,
      z: 1,
      rotation: 0,
      isVertical: true,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const fixedMount = {
      id: `gear_${position}`,
      position,
      axisType: 'fixedAxis'
    };
    const pivotWorld = getGearWorldPosition(tile, fixedMount);
    const runtimePlacement = getRuntimePlacementAroundFixedGear(tile, fixedMount, pivotWorld, delta);
    const runtimeMountWorld = getGearWorldPosition(runtimePlacement, fixedMount);

    expect(runtimePlacement.rotation).toBe(tile.rotation);
    expect(runtimePlacement.runtimeSurfaceRotation).toBe(delta);
    expect(runtimeMountWorld.x).toBeCloseTo(pivotWorld.x, 4);
    expect(runtimeMountWorld.y).toBeCloseTo(pivotWorld.y, 4);
    expect(runtimeMountWorld.z).toBeCloseTo(pivotWorld.z, 4);
  });

  it.each([
    ['corner_ne', 30],
    ['corner_nw', 90]
  ])('keeps edge wall %s fixed gear at 3D pivot after %s degree board rotation', (position, delta) => {
    const wall = createWall({
      x: 6,
      y: 5,
      z: 1,
      edge: 'north',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const fixedMount = {
      id: `gear_${position}`,
      position,
      axisType: 'fixedAxis'
    };
    const pivotWorld = getGearWorldPosition(wall, fixedMount);
    const runtimePlacement = getRuntimePlacementAroundFixedGear(wall, fixedMount, pivotWorld, delta);
    const runtimeMountWorld = getGearWorldPosition(runtimePlacement, fixedMount);

    expect(runtimePlacement.edge).toBe('north');
    expect(runtimePlacement.rotation).toBe(wall.rotation);
    expect(runtimePlacement.runtimeSurfaceRotation).toBe(delta);
    expect(runtimeMountWorld.x).toBeCloseTo(pivotWorld.x, 4);
    expect(runtimeMountWorld.y).toBeCloseTo(pivotWorld.y, 4);
    expect(runtimeMountWorld.z).toBeCloseTo(pivotWorld.z, 4);
  });

  it('creates snapshots with explicit fixed gear pivot metadata', () => {
    const key = createCellKey(6, 6, 0);
    const tile = createTile({
      x: 6,
      y: 6,
      z: 0,
      rotation: 30,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const fixedMount = {
      id: 'gear_corner',
      position: 'corner_ne',
      axisType: 'fixedAxis',
      componentKey: key
    };
    tile.gearMounts = [fixedMount];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'explicit fixed pivot' }),
      tiles: { [key]: tile },
      walls: {}
    };
    const pivotWorld = getGearWorldPosition(tile, fixedMount);

    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: [{
        assembly: { id: 'assembly_1', componentKeys: [key] },
        fixedMount,
        pivotWorld,
        driveRatio: 1,
        basePlacements: { [key]: tile }
      }],
      sourceAngle: 60
    });

    const runtimeMountWorld = getGearWorldPosition(snapshot.placements[key], fixedMount);
    expect(snapshot.placements[key]).toMatchObject({
      runtimeFixedMountId: 'gear_corner',
      runtimeAngle: 60
    });
    expect(snapshot.placements[key].runtimeAxisAnchor).toEqual(pivotWorld);
    expect(runtimeMountWorld.x).toBeCloseTo(pivotWorld.x, 4);
    expect(runtimeMountWorld.y).toBeCloseTo(pivotWorld.y, 4);
    expect(snapshot.placements[key].rotation).toBe(90);
  });

  it('creates snapshots for vertical fixed-axis boards without changing wall yaw', () => {
    const key = createWallKey(5, 5, 1, 'east');
    const wall = createWall({
      x: 5,
      y: 5,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      transmissionRotation: 15
    });
    const fixedMount = {
      id: 'gear_corner',
      position: 'corner_ne',
      axisType: 'fixedAxis',
      componentKey: key
    };
    wall.gearMounts = [fixedMount];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'vertical explicit fixed pivot' }),
      tiles: {},
      walls: { [key]: wall }
    };
    const pivotWorld = getGearWorldPosition(wall, fixedMount);

    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: [{
        assembly: { id: 'assembly_wall', componentKeys: [key] },
        fixedMount,
        pivotWorld,
        driveRatio: 1,
        basePlacements: { [key]: wall }
      }],
      sourceAngle: 60
    });

    const runtimeMountWorld = getGearWorldPosition(snapshot.placements[key], fixedMount);
    expect(snapshot.placements[key].rotation).toBe(wall.rotation);
    expect(snapshot.placements[key].transmissionRotation).toBe(15);
    expect(snapshot.placements[key].runtimeSurfaceRotation).toBe(60);
    expect(runtimeMountWorld.x).toBeCloseTo(pivotWorld.x, 4);
    expect(runtimeMountWorld.y).toBeCloseTo(pivotWorld.y, 4);
    expect(runtimeMountWorld.z).toBeCloseTo(pivotWorld.z, 4);
  });

  it('measures fixed axis one-to-one sync tolerance', () => {
    expect(getAngleErrorDegrees(359.8, 0.1)).toBeCloseTo(0.3, 5);
    expect(validateFixedAxisSync({ gearAngle: 90, assemblyAngle: 90.4 }).ok).toBe(true);
    expect(validateFixedAxisSync({ gearAngle: 90, assemblyAngle: 90.6 }).ok).toBe(false);
    expect(getGearTorqueRatio(-0.5)).toBe(2);
  });

  it('finds rotation obstructions before the target angle', () => {
    const moverKey = createCellKey(2, 2, 0);
    const obstacleKey = createCellKey(3, 3, 0);
    const mover = createTile({
      x: 2,
      y: 2,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const obstacle = createTile({
      x: 3,
      y: 3,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'runtime collision' }),
      tiles: {
        [moverKey]: mover,
        [obstacleKey]: obstacle
      },
      walls: {}
    };

    const obstruction = findRotationObstruction({
      mapData,
      assembly: { id: 'assembly_1', componentKeys: [moverKey] },
      anchor: { x: 2, y: 3, z: 0 },
      targetAngle: 90,
      stepDegrees: 5
    });

    expect(obstruction).toMatchObject({
      blocked: true,
      obstacleKey
    });
    expect(Math.abs(obstruction.angle)).toBeLessThanOrEqual(90);
  });

  it('blocks tiny obstructed rotations before starting preview motion', () => {
    expect(getAllowedRotationAngle({
      targetAngle: 90,
      obstruction: { blocked: true, angle: 5 },
      minimumDegrees: 12
    })).toMatchObject({
      canRotate: false,
      angle: 5,
      blockedBeforeMinimum: true
    });

    expect(getAllowedRotationAngle({
      targetAngle: 90,
      obstruction: { blocked: true, angle: 30 },
      minimumDegrees: 12
    })).toMatchObject({
      canRotate: true,
      angle: 30,
      blockedBeforeMinimum: false
    });
  });
});
