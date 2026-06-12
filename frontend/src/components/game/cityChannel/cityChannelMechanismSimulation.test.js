import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from './cityChannelSchema';
import {
  buildMechanicalAssemblies,
  CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS
} from './cityChannelMechanismRuntime';
import {
  buildGearContactGraph,
  CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
  createAxisBindingRuntimeEntryFromGearNode,
  createMechanismRuntimeSnapshot,
  createRackTranslationRuntimeEntries,
  findRotationObstruction,
  getAngleErrorDegrees,
  getAllowedRotationAngle,
  getFixedAxisWorldAnchor,
  getGearPhase,
  getGearSurfaceKey,
  getGearWorldPosition,
  getGearTorqueRatio,
  getRackContactLimitedTranslationDistance,
  getRackTranslationDistance,
  getRackTranslationTravelLimits,
  isDrivenGearAxisBindingActive,
  resolveDrivenGearNodes,
  getRuntimePlacementAroundFixedGear,
  rotatePoint,
  validateFixedAxisSync
} from './cityChannelMechanismSimulation';
import {
  DOUBLE_SIDED_RACK_COMPONENT_TYPE,
  clipRackToCornerGearBlocker,
  getRackPlacementRuleStatus,
  isRackPointOnCornerGear,
  getRackGearContacts,
  getRackSideCandidates
} from './cityChannelRackModel';

describe('cityChannelMechanismSimulation', () => {
  it('finds only side boards along a double-sided rack', () => {
    const mapData = createBaseCityChannelMap({ name: 'rack side candidates' });
    [1, 2].forEach((x) => {
      [0, 1].forEach((y) => {
        mapData.tiles[createCellKey(x, y, 0)] = createTile({
          x,
          y,
          z: 0,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        });
      });
    });
    mapData.tiles[createCellKey(0, 0, 0)] = createTile({ x: 0, y: 0, z: 0 });
    mapData.tiles[createCellKey(3, 1, 0)] = createTile({ x: 3, y: 1, z: 0 });
    const rack = {
      id: 'rack_test',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    };

    expect(getRackSideCandidates(mapData, rack).map((candidate) => candidate.componentKey).sort()).toEqual([
      createCellKey(1, 0, 0),
      createCellKey(1, 1, 0),
      createCellKey(2, 0, 0),
      createCellKey(2, 1, 0)
    ].sort());
  });

  it('rejects double-sided rack anchors on installed corner gears', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4, layers: 1, name: 'rack corner anchor' });
    const hostKey = createCellKey(1, 1, 0);
    const host = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    host.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_nw',
      surface: 'front'
    }];
    mapData.tiles[hostKey] = host;
    const rack = {
      id: 'rack_corner_anchor',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    };

    expect(isRackPointOnCornerGear(mapData, rack.start)).toBe(true);
    expect(getRackPlacementRuleStatus(mapData, rack)).toMatchObject({
      valid: false,
      reason: 'cornerGearEndpoint'
    });
  });

  it('rejects double-sided racks that cross installed gears away from endpoints', () => {
    const mapData = createBaseCityChannelMap({ width: 5, height: 4, layers: 1, name: 'rack gear overlap path' });
    const hostKey = createCellKey(2, 1, 0);
    const host = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    host.gearMounts = [{
      id: 'gear_path',
      componentType: 'gear',
      position: 'corner_ne',
      surface: 'front'
    }];
    mapData.tiles[hostKey] = host;
    const rack = {
      id: 'rack_path_overlap',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 4.5, y: 0.5, z: 0 }
    };

    expect(getRackPlacementRuleStatus(mapData, rack)).toMatchObject({
      valid: false,
      reason: 'cornerGearBlocked'
    });
  });

  it('clips rack extension before an installed corner gear blocker', () => {
    const mapData = createBaseCityChannelMap({ width: 5, height: 4, layers: 1, name: 'rack corner blocker' });
    const hostKey = createCellKey(2, 1, 0);
    const host = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    host.gearMounts = [{
      id: 'gear_blocker',
      componentType: 'gear',
      position: 'corner_ne',
      surface: 'front'
    }];
    mapData.tiles[hostKey] = host;
    const rack = {
      id: 'rack_corner_blocker',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 4.5, y: 0.5, z: 0 }
    };

    expect(clipRackToCornerGearBlocker(mapData, rack)).toMatchObject({
      end: { x: 1.5, y: 0.5, z: 0 }
    });
  });

  it('allows a double-sided rack when any segment has side board support', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4, layers: 1, name: 'rack side support rule' });
    mapData.tiles[createCellKey(1, 0, 0)] = createTile({
      x: 1,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const rack = {
      id: 'rack_missing_support',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    };

    expect(getRackPlacementRuleStatus(mapData, rack)).toMatchObject({
      valid: true,
      reason: 'ok'
    });
  });

  it('rejects double-sided racks without any adjacent side board', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4, layers: 1, name: 'rack side support missing' });
    const rack = {
      id: 'rack_no_support',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    };

    expect(getRackPlacementRuleStatus(mapData, rack)).toMatchObject({
      valid: false,
      reason: 'missingSideBoard'
    });
  });

  it('meshes gears through a double-sided rack by side', () => {
    const rack = {
      id: 'rack_mesh',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    };
    const createNode = (id, x, hostY) => ({
      id,
      componentKey: `${id}_host`,
      worldPoint: { x, y: 0.5, z: 0 },
      point: { x, y: 0.5, z: 0 },
      placement: { x: Math.round(x), y: hostY, z: 0 },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      surfaceKey: 'floor:0:front',
      mount: { id: `${id}_mount`, position: 'corner_ne' }
    });
    const nodes = [
      createNode('same_a', 1.5, 0),
      createNode('same_b', 2.5, 0),
      createNode('opposite', 1.5, 1)
    ];

    const graph = buildGearContactGraph(nodes, undefined, [rack]);

    expect(graph.get('same_a')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'same_b', ratio: 1, viaRackId: 'rack_mesh' }),
      expect.objectContaining({ id: 'opposite', ratio: -1, viaRackId: 'rack_mesh' })
    ]));
  });

  it('meshes center gears on the side pitch line of a double-sided rack', () => {
    const rack = {
      id: 'rack_center_side_mesh',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 1.5, z: 0 },
      end: { x: 2.5, y: 1.5, z: 0 }
    };
    const createNode = (id, x, y) => ({
      id,
      componentKey: `${id}_host`,
      worldPoint: { x, y, z: 0 },
      point: { x, y, z: 0 },
      placement: { x, y, z: 0 },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      surfaceKey: 'floor:0:front',
      mount: { id: `${id}_mount`, position: 'center' }
    });
    const negative = createNode('negative_center', 1.5, 1);
    const positive = createNode('positive_center', 1.5, 2);
    const contacts = getRackGearContacts(rack, [negative, positive]);
    const graph = buildGearContactGraph([negative, positive], undefined, [rack]);

    expect(contacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ node: expect.objectContaining({ id: negative.id }), sideSign: -1 }),
      expect.objectContaining({ node: expect.objectContaining({ id: positive.id }), sideSign: 1 })
    ]));
    expect(graph.get(negative.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: positive.id, ratio: -1, viaRackId: rack.id })
    ]));
  });

  it('moves an unbound rack along its own axis when driven by a meshed gear', () => {
    const rack = {
      id: 'rack_free_drive',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    };
    const node = {
      id: 'driver:gear_corner',
      componentKey: 'driver',
      mountId: 'gear_corner',
      worldPoint: { x: 1.5, y: 0.5, z: 0 },
      point: { x: 1.5, y: 0.5, z: 0 },
      placement: { x: 1, y: 0, z: 0 },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      driveRatio: 1,
      mount: { id: 'gear_corner', position: 'corner_ne' }
    };
    const mapData = {
      ...createBaseCityChannelMap({ name: 'free rack translation' }),
      tiles: {},
      walls: {},
      racks: { [rack.id]: rack }
    };

    const entries = createRackTranslationRuntimeEntries({ mapData, nodes: [node] });
    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: entries,
      gearNodes: [node],
      sourceAngle: 90
    });
    const distance = getRackTranslationDistance(entries[0], 90);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      motionType: 'rackTranslation',
      componentKey: null,
      rackId: rack.id
    });
    expect(snapshot.placements).toEqual({});
    expect(snapshot.racks[rack.id].start.x).toBeCloseTo(rack.start.x + distance, 6);
    expect(snapshot.racks[rack.id].end.x).toBeCloseTo(rack.end.x + distance, 6);
  });

  it('drives a rack when the gear pitch circle touches the rack side', () => {
    const rack = {
      id: 'rack_side_drive',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    };
    const node = {
      id: 'driver:gear_side',
      componentKey: 'driver',
      mountId: 'gear_side',
      worldPoint: { x: 1.5, y: 0.5 - CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD, z: 0 },
      point: { x: 1.5, y: 0.5 - CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD, z: 0 },
      placement: { x: 1, y: 0, z: 0 },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      driveRatio: 1,
      mount: { id: 'gear_side', position: 'corner_ne' }
    };
    const mapData = {
      ...createBaseCityChannelMap({ name: 'side rack translation' }),
      tiles: {},
      walls: {},
      racks: { [rack.id]: rack }
    };

    const entries = createRackTranslationRuntimeEntries({ mapData, nodes: [node] });
    const distance = getRackTranslationDistance(entries[0], 90);
    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: entries,
      gearNodes: [node],
      sourceAngle: 90
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      motionType: 'rackTranslation',
      contactSideSign: -1,
      rackId: rack.id
    });
    expect(snapshot.racks[rack.id].start.x).toBeCloseTo(rack.start.x + distance, 6);
  });

  it('drives a rack when a neighboring center gear meshes with its side teeth', () => {
    const rack = {
      id: 'rack_center_side_drive',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 1.5, z: 0 },
      end: { x: 2.5, y: 1.5, z: 0 }
    };
    const node = {
      id: 'driver:gear_center',
      componentKey: 'driver',
      mountId: 'gear_center',
      worldPoint: { x: 1.5, y: 1, z: 0 },
      point: { x: 1.5, y: 1, z: 0 },
      placement: { x: 1, y: 1, z: 0 },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      driveRatio: 1,
      mount: { id: 'gear_center', position: 'center' }
    };
    const mapData = {
      ...createBaseCityChannelMap({ name: 'center side rack translation' }),
      tiles: {},
      walls: {},
      racks: { [rack.id]: rack }
    };

    const entries = createRackTranslationRuntimeEntries({ mapData, nodes: [node] });
    const distance = getRackTranslationDistance(entries[0], 90);
    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: entries,
      gearNodes: [node],
      sourceAngle: 90
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      motionType: 'rackTranslation',
      contactSideSign: -1,
      rackId: rack.id
    });
    expect(snapshot.racks[rack.id].start.x).toBeCloseTo(rack.start.x + distance, 6);
  });

  it('translates a rack-bound transmission assembly as one rigid body', () => {
    const boundKey = createCellKey(2, 1, 0);
    const neighborKey = createCellKey(3, 1, 0);
    const bound = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    const neighbor = createTile({
      x: 3,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 90
    });
    const rack = {
      id: 'rack_bound_drive',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 1.5, y: 0.5, z: 0 },
      end: { x: 3.5, y: 0.5, z: 0 },
      axisBinding: {
        hostKind: 'tile',
        componentKey: boundKey
      }
    };
    const node = {
      id: 'driver:gear_corner',
      componentKey: 'driver',
      mountId: 'gear_corner',
      worldPoint: { x: 2.5, y: 0.5, z: 0 },
      point: { x: 2.5, y: 0.5, z: 0 },
      placement: { x: 2, y: 0, z: 0 },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      driveRatio: 1,
      mount: { id: 'gear_corner', position: 'corner_ne' }
    };
    const mapData = {
      ...createBaseCityChannelMap({ name: 'rack-bound rigid translation' }),
      tiles: {
        [boundKey]: bound,
        [neighborKey]: neighbor
      },
      walls: {},
      racks: { [rack.id]: rack }
    };

    const entries = createRackTranslationRuntimeEntries({ mapData, nodes: [node] });
    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: entries,
      gearNodes: [node],
      sourceAngle: 90
    });
    const distance = getRackTranslationDistance(entries[0], 90);

    expect(entries[0].assembly.componentKeys).toEqual(expect.arrayContaining([boundKey, neighborKey]));
    expect(snapshot.placements[boundKey].x).toBeCloseTo(bound.x + distance, 6);
    expect(snapshot.placements[neighborKey].x).toBeCloseTo(neighbor.x + distance, 6);
    expect(snapshot.placements[neighborKey].x - snapshot.placements[boundKey].x).toBeCloseTo(1, 6);
    expect(snapshot.placements[neighborKey].y - snapshot.placements[boundKey].y).toBeCloseTo(0, 6);
    expect(snapshot.placements[boundKey]).toMatchObject({
      runtimeMotionType: 'rackTranslation',
      runtimeRackId: rack.id
    });
  });

  it('finds vertical side boards along a wall-surface rack', () => {
    const mapData = createBaseCityChannelMap({ name: 'vertical rack side candidates' });
    const leftKey = createCellKey(1, 1, 0);
    const rightKey = createCellKey(2, 1, 0);
    mapData.tiles[leftKey] = createTile({
      x: 1,
      y: 1,
      z: 0,
      rotation: 0,
      isVertical: true,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    mapData.tiles[rightKey] = createTile({
      x: 2,
      y: 1,
      z: 0,
      rotation: 0,
      isVertical: true,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const rack = {
      id: 'vertical_rack',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      normalAxis: 'y',
      direction: 'z',
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 1 }
    };

    expect(getRackSideCandidates(mapData, rack).map((candidate) => candidate.componentKey).sort()).toEqual([
      leftKey,
      rightKey
    ].sort());
  });

  it('meshes vertical gears through a wall-surface rack by side', () => {
    const rack = {
      id: 'vertical_rack_mesh',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      normalAxis: 'y',
      direction: 'z',
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 1 }
    };
    const createNode = (id, hostX) => ({
      id,
      componentKey: `${id}_host`,
      worldPoint: { x: hostX, y: 1, z: 0.5 },
      point: { x: hostX, y: 1, z: 0.5 },
      placement: { x: hostX, y: 1, z: 0, isVertical: true },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      surfaceKey: 'vertical:1:front',
      mount: { id: `${id}_mount`, position: 'corner_ne' }
    });
    const nodes = [
      createNode('left', 1),
      createNode('right', 2)
    ];

    const graph = buildGearContactGraph(nodes, undefined, [rack]);

    expect(graph.get('left')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'right', ratio: -1, viaRackId: 'vertical_rack_mesh' })
    ]));
  });

  it('moves a vertical rack up and down when driven by a side gear', () => {
    const rack = {
      id: 'vertical_rack_drive',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      normalAxis: 'y',
      direction: 'z',
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 1 }
    };
    const node = {
      id: 'driver:gear_center',
      componentKey: 'driver',
      mountId: 'gear_center',
      worldPoint: { x: 1, y: 1, z: 0.5 },
      point: { x: 1, y: 1, z: 0.5 },
      placement: { x: 1, y: 1, z: 0, isVertical: true },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      driveRatio: 1,
      surfaceKey: 'vertical:1:front',
      mount: { id: 'gear_center', position: 'center' }
    };
    const mapData = {
      ...createBaseCityChannelMap({ name: 'vertical rack translation' }),
      tiles: {},
      walls: {},
      racks: { [rack.id]: rack }
    };

    const entries = createRackTranslationRuntimeEntries({ mapData, nodes: [node] });
    const rawForwardDistance = getRackTranslationDistance(entries[0], 90);
    const forwardDistance = getRackContactLimitedTranslationDistance(entries[0], 90);
    const forwardSnapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: entries,
      gearNodes: [node],
      sourceAngle: 90
    });
    const rawReverseDistance = getRackTranslationDistance(entries[0], -90);
    const reverseDistance = getRackContactLimitedTranslationDistance(entries[0], -90);
    const reverseSnapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: entries,
      gearNodes: [node],
      sourceAngle: -90
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      motionType: 'rackTranslation',
      contactSideSign: -1,
      rackId: rack.id,
      translationAxis: { x: 0, y: 0, z: 1 }
    });
    expect(Math.abs(forwardDistance)).toBeLessThan(Math.abs(rawForwardDistance));
    expect(Math.abs(reverseDistance)).toBeLessThan(Math.abs(rawReverseDistance));
    expect(forwardSnapshot.racks[rack.id].start.z).toBeCloseTo(rack.start.z + forwardDistance, 6);
    expect(forwardSnapshot.racks[rack.id].end.z).toBeCloseTo(rack.end.z + forwardDistance, 6);
    expect(reverseSnapshot.racks[rack.id].start.z).toBeCloseTo(rack.start.z + reverseDistance, 6);
    expect(reverseSnapshot.racks[rack.id].end.z).toBeCloseTo(rack.end.z + reverseDistance, 6);
    expect(forwardSnapshot.racks[rack.id].start.z).toBeLessThan(rack.start.z);
    expect(reverseSnapshot.racks[rack.id].start.z).toBeGreaterThan(rack.start.z);
  });

  it('stops a finite vertical rack when the driving gear reaches the rack end', () => {
    const rack = {
      id: 'vertical_rack_contact_stop',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      normalAxis: 'y',
      direction: 'z',
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 1 }
    };
    const node = {
      id: 'driver:gear_lower',
      componentKey: 'driver',
      mountId: 'gear_lower',
      worldPoint: { x: 1, y: 1, z: 0.5 },
      point: { x: 1, y: 1, z: 0.5 },
      placement: { x: 1, y: 1, z: 0, isVertical: true },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      driveRatio: 1,
      surfaceKey: 'vertical:1:front',
      mount: { id: 'gear_lower', position: 'center' }
    };
    const mapData = {
      ...createBaseCityChannelMap({ name: 'vertical finite rack contact stop' }),
      tiles: {},
      walls: {},
      racks: { [rack.id]: rack }
    };

    const entries = createRackTranslationRuntimeEntries({ mapData, nodes: [node] });
    const rawDistance = getRackTranslationDistance(entries[0], -180);
    const limitedDistance = getRackContactLimitedTranslationDistance(entries[0], -180);
    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: entries,
      gearNodes: [node],
      sourceAngle: -180
    });

    expect(getRackTranslationTravelLimits(entries[0])).toMatchObject({
      min: -0.5,
      max: 0.5
    });
    expect(rawDistance).toBeGreaterThan(0.5);
    expect(limitedDistance).toBeCloseTo(0.5, 6);
    expect(snapshot.racks[rack.id].start.z).toBeCloseTo(0.5, 6);
    expect(snapshot.racks[rack.id].end.z).toBeCloseTo(1.5, 6);
    expect(snapshot.racks[rack.id].runtimeLinearDistance).toBeCloseTo(0.5, 6);
  });

  it('rotates a passive upper gear when a translated rack reaches it', () => {
    const rack = {
      id: 'vertical_rack_drives_upper_passive',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      normalAxis: 'y',
      direction: 'z',
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 1 }
    };
    const lowerGear = {
      id: 'driver:gear_lower',
      componentKey: 'driver',
      mountId: 'gear_lower',
      worldPoint: { x: 1, y: 1, z: 0.5 },
      point: { x: 1, y: 1, z: 0.5 },
      placement: { x: 1, y: 1, z: 0, isVertical: true },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      driveRatio: 1,
      surfaceKey: 'vertical:1:front',
      mount: { id: 'gear_lower', position: 'center' }
    };
    const upperGear = {
      id: 'upper:gear_passive',
      componentKey: 'upper',
      mountId: 'gear_passive',
      worldPoint: { x: 1, y: 1, z: 1.25 },
      point: { x: 1, y: 1, z: 1.25 },
      placement: { x: 1, y: 1, z: 1, isVertical: true },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      surfaceKey: 'vertical:1:front',
      mount: { id: 'gear_passive', position: 'center', phase: 0 }
    };
    const mapData = {
      ...createBaseCityChannelMap({ name: 'vertical rack passive gear pickup' }),
      tiles: {},
      walls: {},
      racks: { [rack.id]: rack }
    };

    const entries = createRackTranslationRuntimeEntries({ mapData, nodes: [lowerGear] });
    const limitedDistance = getRackContactLimitedTranslationDistance(entries[0], -180);
    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: entries,
      gearNodes: [lowerGear],
      rackContactGearNodes: [lowerGear, upperGear],
      sourceAngle: -180,
      basePhases: new Map([
        [lowerGear.id, 0],
        [upperGear.id, 0]
      ])
    });
    const upperEngagedDistance = limitedDistance - (upperGear.worldPoint.z - rack.end.z);
    const expectedUpperAngle = (-upperEngagedDistance * 180) / (Math.PI * CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD);
    const expectedUpperPhase = ((Math.trunc(expectedUpperAngle) % 360) + 360) % 360;

    expect(limitedDistance).toBeCloseTo(0.5, 6);
    expect(upperEngagedDistance).toBeCloseTo(0.25, 6);
    expect(snapshot.gears[lowerGear.id].phase).toBe(180);
    expect(snapshot.gears[upperGear.id]).toMatchObject({
      componentKey: upperGear.componentKey,
      mountId: upperGear.mountId,
      axisType: 'freeAxis'
    });
    expect(snapshot.gears[upperGear.id].phase).toBe(expectedUpperPhase);
    expect(snapshot.gears[upperGear.id].speedRatio).toBeCloseTo(expectedUpperAngle / -180, 6);
  });

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

  it('meshes center and corner gears at board-scale pitch radius', () => {
    const nodes = [
      {
        id: 'center',
        componentKey: 'source',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0, y: 0, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18
      },
      {
        id: 'corner',
        componentKey: 'driven',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0.5, y: 0.5, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18
      },
      {
        id: 'far',
        componentKey: 'far',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 1.4, y: 0, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18
      },
      {
        id: 'loose',
        componentKey: 'loose',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0.86, y: 0, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18
      }
    ];

    const graph = buildGearContactGraph(nodes);

    expect(graph.get('center')).toEqual([{ id: 'corner', ratio: -1 }]);
    expect(graph.get('corner')).toEqual([{ id: 'center', ratio: -1 }]);
    expect(graph.get('far')).toEqual([]);
    expect(graph.get('loose')).toEqual([]);
  });

  it('propagates driven gear direction and phase through the shared contact graph', () => {
    expect(getGearSurfaceKey({ x: 0, y: 0, z: 0 }, { surface: 'front' })).toBe('floor:0:front');
    const assembly = {
      componentKeys: ['source', 'driven'],
      edges: [{ componentKey: 'source', key: 'driven' }]
    };
    const allNodes = [
      {
        id: 'source:gear_center',
        componentKey: 'source',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0, y: 0, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18
      },
      {
        id: 'driven:gear_corner',
        componentKey: 'driven',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0.5, y: 0.5, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18
      }
    ];
    const driven = resolveDrivenGearNodes({
      assembly,
      assemblyNodes: allNodes,
      allNodes,
      sourceComponentKey: 'source'
    });

    expect(driven.map((node) => node.id)).toEqual(['source:gear_center', 'driven:gear_corner']);
    expect(driven.map((node) => node.driveRatio)).toEqual([1, -1]);
    expect(getGearPhase(driven[1], 90, 15)).toBe(285);
  });

  it('uses the drive root gear rotation direction instead of pressure plate direction params', () => {
    const assembly = {
      componentKeys: ['source', 'driven'],
      edges: [{ componentKey: 'source', key: 'driven' }]
    };
    const allNodes = [
      {
        id: 'source:gear_center',
        componentKey: 'source',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0, y: 0, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18,
        mount: {
          id: 'gear_center',
          position: 'center',
          rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
        }
      },
      {
        id: 'driven:gear_corner',
        componentKey: 'driven',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0.5, y: 0.5, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18,
        mount: {
          id: 'gear_corner',
          position: 'corner_nw'
        }
      }
    ];

    const driven = resolveDrivenGearNodes({
      assembly,
      assemblyNodes: allNodes,
      allNodes,
      sourceComponentKey: 'source'
    });

    expect(driven.map((node) => node.driveRatio)).toEqual([-1, 1]);
    expect(getGearPhase(driven[0], 90, 0)).toBe(270);
    expect(getGearPhase(driven[1], 90, 0)).toBe(90);
  });

  it('starts every reachable active intermediate gear in the pressure plate assembly', () => {
    const assembly = {
      componentKeys: ['pressure', 'near_branch', 'far_branch'],
      edges: [
        { componentKey: 'pressure', key: 'near_branch' },
        { componentKey: 'near_branch', key: 'far_branch' }
      ]
    };
    const allNodes = [
      {
        id: 'near_branch:gear_corner',
        componentKey: 'near_branch',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0, y: 0, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18,
        mount: {
          id: 'gear_corner',
          position: 'corner_nw',
          rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE
        }
      },
      {
        id: 'far_branch:gear_corner',
        componentKey: 'far_branch',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 3, y: 0, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18,
        mount: {
          id: 'gear_corner',
          position: 'corner_ne',
          rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
        }
      }
    ];

    const driven = resolveDrivenGearNodes({
      assembly,
      assemblyNodes: allNodes,
      allNodes,
      sourceComponentKey: 'pressure'
    });

    expect(driven.map((node) => node.id)).toEqual([
      'near_branch:gear_corner',
      'far_branch:gear_corner'
    ]);
    expect(driven.map((node) => node.isDriveRoot)).toEqual([true, true]);
    expect(driven.map((node) => node.driveRatio)).toEqual([1, -1]);
  });

  it('lets a passive gear transmit mesh rotation without driving its bound board', () => {
    const assembly = {
      componentKeys: ['source', 'relay'],
      edges: [{ componentKey: 'source', key: 'relay' }]
    };
    const allNodes = [
      {
        id: 'source:gear_center',
        componentKey: 'source',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0, y: 0, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18,
        mount: {
          id: 'gear_center',
          position: 'center'
        }
      },
      {
        id: 'relay:gear_corner',
        componentKey: 'relay',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0.5, y: 0.5, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18,
        mount: {
          id: 'gear_corner',
          position: 'corner_nw',
          rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE,
          axisBinding: {
            componentKey: 'bound',
            hostKind: 'tile',
            socket: 'corner_se',
            surface: 'front'
          }
        }
      }
    ];

    const driven = resolveDrivenGearNodes({
      assembly,
      assemblyNodes: allNodes,
      allNodes,
      sourceComponentKey: 'source'
    });
    const passive = driven.find((node) => node.id === 'relay:gear_corner');

    expect(driven.map((node) => node.id)).toEqual(['source:gear_center', 'relay:gear_corner']);
    expect(passive).toMatchObject({
      driveRatio: -1,
      isDriveRoot: false,
      drivenByGearId: 'source:gear_center'
    });
    expect(isDrivenGearAxisBindingActive(passive, assembly)).toBe(false);
  });

  it('degrades a meshed corner gear bound to the active center gear board', () => {
    const assembly = {
      componentKeys: ['pressure', 'corner_host'],
      edges: [{ componentKey: 'pressure', key: 'corner_host' }]
    };
    const allNodes = [
      {
        id: 'pressure:gear_center',
        componentKey: 'pressure',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0, y: 0, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18
      },
      {
        id: 'corner_host:gear_corner',
        componentKey: 'corner_host',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0.5, y: 0.5, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18,
        mount: {
          id: 'gear_corner',
          position: 'corner_nw',
          axisBinding: {
            componentKey: 'pressure',
            hostKind: 'tile',
            socket: 'corner_se',
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
    const corner = driven.find((node) => node.id === 'corner_host:gear_corner');
    const snapshot = createMechanismRuntimeSnapshot({
      gearNodes: driven,
      sourceAngle: 90,
      basePhases: new Map()
    });

    expect(driven.map((node) => node.id)).toEqual(['pressure:gear_center', 'corner_host:gear_corner']);
    expect(corner).toMatchObject({
      driveRatio: -1,
      isDriveRoot: false,
      drivenByGearId: 'pressure:gear_center',
      axisBindingSuppressed: true
    });
    expect(isDrivenGearAxisBindingActive(corner, assembly)).toBe(false);
    expect(snapshot.placements).toEqual({});
    expect(snapshot.gears['corner_host:gear_corner']).toMatchObject({
      axisType: 'freeAxis',
      axisBinding: null,
      phase: 270,
      speedRatio: -1
    });
  });

  it('degrades a meshed corner gear bound to any board in the active source assembly', () => {
    const assembly = {
      componentKeys: ['pressure', 'vertical_link'],
      edges: [{ componentKey: 'pressure', key: 'vertical_link' }]
    };
    const sourceNode = {
      id: 'pressure:gear_center',
      componentKey: 'pressure',
      surfaceKey: 'floor:0:front',
      worldPoint: { x: 0, y: 0, z: 0 },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      mount: {
        id: 'gear_center',
        position: 'center'
      }
    };
    const passiveNode = {
      id: 'corner_host:gear_corner',
      componentKey: 'corner_host',
      surfaceKey: 'floor:0:front',
      worldPoint: { x: 0.5, y: 0.5, z: 0 },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
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
    const allNodes = [sourceNode, passiveNode];

    const driven = resolveDrivenGearNodes({
      assembly,
      assemblyNodes: [sourceNode],
      allNodes,
      sourceComponentKey: 'pressure'
    });
    const corner = driven.find((node) => node.id === 'corner_host:gear_corner');
    const snapshot = createMechanismRuntimeSnapshot({
      gearNodes: driven,
      sourceAngle: 90,
      basePhases: new Map()
    });

    expect(corner).toMatchObject({
      driveRatio: -1,
      isDriveRoot: false,
      drivenByGearId: 'pressure:gear_center',
      axisBindingSuppressed: true
    });
    expect(isDrivenGearAxisBindingActive(corner, assembly)).toBe(false);
    expect(snapshot.placements).toEqual({});
    expect(snapshot.gears['corner_host:gear_corner']).toMatchObject({
      axisType: 'freeAxis',
      axisBinding: null,
      phase: 270,
      speedRatio: -1
    });
  });

  it('keeps a same-board bound corner gear passive when the center gear is the active root', () => {
    const assembly = {
      componentKeys: ['pressure', 'driver'],
      edges: [{ componentKey: 'pressure', key: 'driver' }]
    };
    const allNodes = [
      {
        id: 'driver:gear_corner',
        componentKey: 'driver',
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0.5, y: 0.5, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18,
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
        surfaceKey: 'floor:0:front',
        worldPoint: { x: 0, y: 0, z: 0 },
        pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
        gearRatioRadius: 18,
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
      driveRatio: 1,
      isDriveRoot: true
    });
    expect(corner).toMatchObject({
      driveRatio: -1,
      isDriveRoot: false,
      drivenByGearId: 'driver:gear_center',
      axisBindingSuppressed: true
    });
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
    expect(runtimePlacement.runtimeSurfaceRotation).toBe(delta);
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

  it('treats front and back as the same mechanical surface for ordinary vertical boards', () => {
    const tile = createTile({
      x: 4,
      y: 5,
      z: 1,
      rotation: 90,
      isVertical: true,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const front = getGearWorldPosition(tile, { id: 'front', position: 'corner_ne', surface: 'front' });
    const back = getGearWorldPosition(tile, { id: 'back', position: 'corner_ne', surface: 'back' });

    expect(back.x).toBeCloseTo(front.x, 5);
    expect(back.y).toBeCloseTo(front.y, 5);
    expect(back.z).toBeCloseTo(front.z, 5);
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

  it('keeps vertical-plane assembly members connected during fixed-axis rotation', () => {
    const upperKey = createCellKey(4, 5, 1);
    const lowerKey = createCellKey(4, 5, 0);
    const upper = {
      ...createTile({
        x: 4,
        y: 5,
        z: 1,
        rotation: 0,
        transmissionRotation: 0,
        isVertical: true,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
      }),
      isVertical: true
    };
    const lower = {
      ...createTile({
        x: 4,
        y: 5,
        z: 0,
        rotation: 0,
        transmissionRotation: 0,
        isVertical: true,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
      }),
      isVertical: true
    };
    const fixedMount = {
      id: 'gear_fixed',
      position: 'center',
      surface: 'front',
      axisType: 'fixedAxis',
      componentKey: upperKey
    };
    upper.gearMounts = [fixedMount];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'vertical plane compound runtime' }),
      tiles: {
        [upperKey]: upper,
        [lowerKey]: lower
      },
      walls: {}
    };
    const pivotWorld = getGearWorldPosition(upper, fixedMount);

    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: [{
        assembly: {
          id: 'assembly_vertical',
          componentKeys: [upperKey, lowerKey]
        },
        fixedMount,
        pivotWorld,
        driveRatio: 1,
        basePlacements: {
          [upperKey]: upper,
          [lowerKey]: lower
        }
      }],
      sourceAngle: 90
    });

    expect(snapshot.placements[upperKey].runtimeSurfaceRotation).toBe(90);
    expect(snapshot.placements[lowerKey]).toMatchObject({
      x: 3,
      y: 5,
      z: 1,
      runtimeSurfaceRotation: 90
    });
    const runtimeGraph = buildMechanicalAssemblies({
      ...mapData,
      tiles: {
        [upperKey]: snapshot.placements[upperKey],
        [lowerKey]: snapshot.placements[lowerKey]
      },
      walls: {}
    });
    expect(runtimeGraph.assemblyByComponentKey[upperKey]).toBe(runtimeGraph.assemblyByComponentKey[lowerKey]);
  });

  it('uses only the explicit axis-bound board as the driven runtime assembly', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const boundKey = createCellKey(2, 1, 0);
    const neighborKey = createCellKey(3, 1, 0);
    const bound = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    const neighbor = createTile({
      x: 3,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'single axis-bound board' }),
      tiles: {
        [boundKey]: bound,
        [neighborKey]: neighbor
      },
      walls: {}
    };
    const entry = createAxisBindingRuntimeEntryFromGearNode({
      mapData,
      gearNode: {
        id: `${sourceKey}:gear_driver`,
        componentKey: sourceKey,
        mountId: 'gear_driver',
        mount: { id: 'gear_driver', position: 'corner_ne', surface: 'front' },
        driveRatio: -1
      },
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      },
      pivotWorld: { x: 2, y: 0.5, z: 0 },
      driveRatio: -1
    });

    expect(entry.assembly.componentKeys).toEqual([boundKey]);
    expect(Object.keys(entry.basePlacements)).toEqual([boundKey]);
    expect(entry.basePlacements[neighborKey]).toBeUndefined();
  });

  it('uses the bound board mechanical assembly when an assembly graph is available', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const boundKey = createCellKey(2, 1, 0);
    const neighborKey = createCellKey(3, 1, 0);
    const bound = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    const neighbor = createTile({
      x: 3,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'assembly axis-bound board' }),
      tiles: {
        [boundKey]: bound,
        [neighborKey]: neighbor
      },
      walls: {}
    };
    const assembly = {
      id: 'assembly_bound',
      componentKeys: [boundKey, neighborKey],
      edges: [{ componentKey: boundKey, key: neighborKey }],
      gearMounts: [],
      fixedAxes: []
    };
    const entry = createAxisBindingRuntimeEntryFromGearNode({
      mapData,
      assemblyGraph: {
        assemblies: [assembly],
        assemblyByComponentKey: {
          [boundKey]: assembly.id,
          [neighborKey]: assembly.id
        }
      },
      gearNode: {
        id: `${sourceKey}:gear_driver`,
        componentKey: sourceKey,
        mountId: 'gear_driver',
        mount: { id: 'gear_driver', position: 'corner_ne', surface: 'front' },
        driveRatio: -1
      },
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      },
      pivotWorld: { x: 2, y: 0.5, z: 0 },
      driveRatio: -1
    });

    expect(entry.assembly).toBe(assembly);
    expect(entry.assembly.componentKeys).toEqual([boundKey, neighborKey]);
    expect(entry.basePlacements).toMatchObject({
      [boundKey]: bound,
      [neighborKey]: neighbor
    });
  });

  it('resolves the bound board mechanical assembly from map data when no assembly graph is supplied', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const boundKey = createCellKey(2, 1, 0);
    const neighborKey = createCellKey(3, 1, 0);
    const bound = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    const neighbor = createTile({
      x: 3,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 90
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'fallback assembly axis-bound board' }),
      tiles: {
        [boundKey]: bound,
        [neighborKey]: neighbor
      },
      walls: {}
    };
    const entry = createAxisBindingRuntimeEntryFromGearNode({
      mapData,
      gearNode: {
        id: `${sourceKey}:gear_driver`,
        componentKey: sourceKey,
        mountId: 'gear_driver',
        mount: { id: 'gear_driver', position: 'corner_ne', surface: 'front' },
        driveRatio: -1
      },
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      },
      pivotWorld: { x: 2, y: 0.5, z: 0 },
      driveRatio: -1
    });

    expect(entry.assembly.componentKeys).toEqual(expect.arrayContaining([boundKey, neighborKey]));
    expect(entry.basePlacements).toMatchObject({
      [boundKey]: bound,
      [neighborKey]: neighbor
    });
  });

  it('keeps an axis-bound horizontal transmission assembly rigid after runtime rotation', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const boundKey = createCellKey(2, 1, 0);
    const neighborKey = createCellKey(3, 1, 0);
    const bound = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    const neighbor = createTile({
      x: 3,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 90
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'axis-bound rigid horizontal assembly' }),
      tiles: {
        [boundKey]: bound,
        [neighborKey]: neighbor
      },
      walls: {}
    };
    const entry = createAxisBindingRuntimeEntryFromGearNode({
      mapData,
      gearNode: {
        id: `${sourceKey}:gear_driver`,
        componentKey: sourceKey,
        mountId: 'gear_driver',
        mount: { id: 'gear_driver', position: 'corner_ne', surface: 'front' },
        driveRatio: 1
      },
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      },
      pivotWorld: getGearWorldPosition(bound, { position: 'corner_nw', surface: 'front' }),
      driveRatio: 1
    });

    const snapshot = createMechanismRuntimeSnapshot({
      mapData,
      assemblyEntries: [entry],
      sourceAngle: 90
    });
    const runtimeGraph = buildMechanicalAssemblies({
      ...mapData,
      tiles: {
        [boundKey]: snapshot.placements[boundKey],
        [neighborKey]: snapshot.placements[neighborKey]
      },
      walls: {}
    });

    expect(snapshot.placements[neighborKey].x - snapshot.placements[boundKey].x).toBeCloseTo(0, 5);
    expect(snapshot.placements[neighborKey].y - snapshot.placements[boundKey].y).toBeCloseTo(1, 5);
    expect(runtimeGraph.assemblyByComponentKey[boundKey]).toBe(runtimeGraph.assemblyByComponentKey[neighborKey]);
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

  it('ignores rotated AABB overlap when board footprints do not collide', () => {
    const moverKey = createCellKey(0, 0, 0);
    const obstacleKey = createCellKey(1.1, 1.1, 0);
    const mover = createTile({
      x: 0,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const obstacle = createTile({
      x: 1.1,
      y: 1.1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'runtime aabb-only overlap' }),
      tiles: {
        [moverKey]: mover,
        [obstacleKey]: obstacle
      },
      walls: {}
    };

    expect(findRotationObstruction({
      mapData,
      assembly: { id: 'assembly_1', componentKeys: [moverKey] },
      anchor: { x: 0, y: 0, z: 0 },
      targetAngle: 45,
      stepDegrees: 45
    })).toBeNull();
  });

  it('does not use an invisible horizontal base for vertical board collision', () => {
    const moverKey = createCellKey(0, 0, 0);
    const verticalKey = createCellKey(1, 0, 0);
    const mover = createTile({
      x: 0,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    const vertical = {
      ...createTile({
        x: 1,
        y: 0,
        z: 0,
        rotation: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
      }),
      isVertical: true
    };
    const mapData = {
      ...createBaseCityChannelMap({ name: 'vertical base collision' }),
      tiles: {
        [moverKey]: mover,
        [verticalKey]: vertical
      },
      walls: {}
    };

    expect(findRotationObstruction({
      mapData,
      assembly: { id: 'assembly_1', componentKeys: [moverKey] },
      anchor: { x: 0.5, y: -0.5, z: 0 },
      targetAngle: 90,
      stepDegrees: 90
    })).toBeNull();
  });

  it('does not treat a wall support floor as a rotation obstruction', () => {
    const supportKey = createCellKey(2, 2, 1);
    const wallKey = createWallKey(2, 2, 1, 'north');
    const support = createTile({
      x: 2,
      y: 2,
      z: 1,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const wall = createWall({
      x: 2,
      y: 2,
      z: 1,
      edge: 'north',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'support collision exemption' }),
      tiles: {
        [supportKey]: support
      },
      walls: {
        [wallKey]: wall
      },
    };

    expect(findRotationObstruction({
      mapData,
      assembly: { id: 'assembly_wall', componentKeys: [wallKey] },
      anchor: { x: 2, y: 2, z: 1 },
      targetAngle: 45,
      stepDegrees: 5
    })).toBeNull();
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
