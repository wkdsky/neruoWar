import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from '../cityChannelSchema';
import {
  getGearRotationTransmissionEventKeys,
  getGearNodesForMounts,
  playAssemblyGearRotation,
  setGearMountPhases,
  triggerMechanismFromHit
} from './cityChannelMechanismPlayback';
import { CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS } from '../cityChannelMechanismRuntime';
import * as mechanismSimulation from '../cityChannelMechanismSimulation';
import {
  getGearWorldPosition,
  getRuntimePlacementAroundFixedGear
} from '../cityChannelMechanismSimulation';
import { getPlacementDepth } from './renderer/CityChannelDepth';
import { projectCell } from './renderer/CityChannelGeometry';

describe('cityChannelMechanismPlayback', () => {
  it('opens the mechanism panel for trigger tile hits', () => {
    const tile = createTile({
      x: 2,
      y: 3,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    const scene = {
      activeTool: CITY_CHANNEL_TOOLS.BROWSE,
      cameraState: { yaw: 0, zoom: 1 },
      config: {
        onMechanismPanelRequest: jest.fn(),
        onRequestTool: jest.fn(),
        onToast: jest.fn()
      },
      isSelectedHit: jest.fn(() => false),
      mapData: createBaseCityChannelMap({ name: 'mechanism playback' }),
      mechanismParams: {},
      selectHit: jest.fn(),
      worldLayer: { x: 0, y: 0 }
    };

    expect(triggerMechanismFromHit(scene, {
      type: 'tile',
      cell: { x: tile.x, y: tile.y, z: tile.z },
      panelType: tile.panelType,
      tile
    })).toBe(true);

    expect(scene.selectHit).toHaveBeenCalled();
    expect(scene.config.onRequestTool).toHaveBeenCalledWith(CITY_CHANNEL_TOOLS.SELECT);
    expect(scene.config.onMechanismPanelRequest).toHaveBeenCalledWith(expect.objectContaining({
      key: createCellKey(tile.x, tile.y, tile.z),
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE,
      params: expect.any(Object)
    }));
  });

  it('builds gear nodes from live host placements', () => {
    const key = createCellKey(1, 1, 0);
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    tile.gearMounts = [{
      id: 'gear_a',
      position: 'center',
      surface: 'front',
      phase: 12
    }];
    const scene = {
      getGearMountPoint: jest.fn(() => ({ x: 100, y: 100 })),
      mapData: {
        tiles: { [key]: tile },
        walls: {}
      },
      mapGearLocalPointToSurface: jest.fn(() => ({ x: 122, y: 100 }))
    };

    const nodes = getGearNodesForMounts(scene, [{ id: 'gear_a', componentKey: key }]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: `${key}:gear_a`,
      componentKey: key,
      hostKind: 'tile',
      mountId: 'gear_a',
      surfaceKey: 'floor:0:front'
    });
    expect(nodes[0].pitchRadius).toBe(22);
  });

  it('publishes runtime gear phases without mutating mapData mounts', () => {
    const key = createCellKey(1, 1, 0);
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    tile.gearMounts = [{
      id: 'gear_a',
      position: 'center',
      surface: 'front',
      axisType: 'freeAxis',
      phase: 12
    }];
    const scene = {
      mapData: {
        tiles: { [key]: tile },
        walls: {}
      },
      setMechanismRuntimeSnapshot: jest.fn(),
      redrawMountedGearHostLayers: jest.fn(),
      sortMapLayer: jest.fn()
    };

    setGearMountPhases(scene, [{
      id: `${key}:gear_a`,
      componentKey: key,
      mountId: 'gear_a',
      mount: tile.gearMounts[0],
      driveRatio: -1
    }], 30, new Map([[`${key}:gear_a`, 12]]));

    expect(tile.gearMounts[0].phase).toBe(12);
    expect(scene.setMechanismRuntimeSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      gears: {
        [`${key}:gear_a`]: expect.objectContaining({
          phase: 342,
          speedRatio: -1,
          axisType: 'freeAxis'
        })
      }
    }));
    expect(scene.redrawMountedGearHostLayers).toHaveBeenCalledWith('tile', key, tile);
  });

  it('does not rotate a remote assembly through gear mesh alone', () => {
    const sourceKey = createCellKey(0, 0, 0);
    const remoteKey = createCellKey(1, 0, 0);
    const linkedKeys = [
      remoteKey,
      createCellKey(2, 0, 0),
      createCellKey(3, 0, 0),
      createCellKey(4, 0, 0),
      createCellKey(5, 0, 0)
    ];
    const source = createTile({
      x: 0,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const remote = createTile({
      x: 1,
      y: 0,
      z: 0,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    source.gearMounts = [{
      id: 'gear_source',
      position: 'corner_ne',
      surface: 'front',
      axisType: 'freeAxis',
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
    }];
    remote.gearMounts = [{ id: 'gear_remote', position: 'center', surface: 'front', axisType: 'fixedAxis' }];
    const sourceAssembly = {
      id: 'assembly_source',
      componentKeys: [sourceKey],
      edges: [],
      gearMounts: [{ ...source.gearMounts[0], componentKey: sourceKey }],
      fixedAxes: []
    };
    const remoteAssembly = {
      id: 'assembly_remote',
      componentKeys: linkedKeys,
      edges: [],
      gearMounts: [{ ...remote.gearMounts[0], componentKey: remoteKey }],
      fixedAxes: [{ ...remote.gearMounts[0], componentKey: remoteKey }]
    };
    const assemblyGraph = {
      assemblies: [sourceAssembly, remoteAssembly],
      assemblyByComponentKey: {
        [sourceKey]: sourceAssembly.id,
        ...Object.fromEntries(linkedKeys.map((key) => [key, remoteAssembly.id]))
      }
    };
    const scene = {
      getGearMountPoint: jest.fn((placement) => (
        placement === source ? { x: 100, y: 100 } : { x: 122, y: 122 }
      )),
      getMechanicalAssemblyGraph: jest.fn(() => assemblyGraph),
      mapData: {
        tiles: {
          [sourceKey]: source,
          [remoteKey]: remote,
          ...Object.fromEntries(linkedKeys.slice(1).map((key, index) => [
            key,
            createTile({
              x: 2 + index,
              y: 0,
              z: 0,
              panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
            })
          ]))
        },
        walls: {}
      },
      mapGearLocalPointToSurface: jest.fn((placement, localPosition) => ({
        x: (placement === source ? 100 : 122) + ((localPosition.x || 0) * 100),
        y: (placement === source ? 100 : 122) + ((localPosition.y || 0) * 100)
      })),
      applyMechanismRuntimePlacementTransforms: jest.fn(),
      mergeMechanismRuntimeGearStates: jest.fn(),
      redrawMountedGearHostLayers: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(),
      sortMapLayer: jest.fn(),
      time: { delayedCall: jest.fn() },
      tweens: {
        killTweensOf: jest.fn(),
        add: jest.fn((config) => {
          config.onUpdate?.();
          config.onComplete?.();
        })
      },
      config: {
        onMechanismPreviewProgress: jest.fn(),
        onToast: jest.fn()
      }
    };

    const played = playAssemblyGearRotation(scene, sourceAssembly, sourceKey, {
      rotationAngle: 45,
      rotationSpeedDegPerSec: 45,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(true);
    expect(scene.setMechanismRuntimeSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      gears: expect.objectContaining({
        [`${remoteKey}:gear_remote`]: expect.objectContaining({
          phase: 45
        })
      }),
      placements: {},
      sync: []
    }));
    expect(scene.applyMechanismRuntimePlacementTransforms).not.toHaveBeenCalled();
    expect(scene.config.onToast).toHaveBeenCalledWith('assembly_source 齿轮传动预览：2 个齿轮转动。', 'success');
  });

  it('rotates the full mechanical assembly selected by an axis binding', () => {
    const sourceKey = createCellKey(0, 0, 0);
    const fixedKey = createCellKey(1, 0, 0);
    const source = createTile({
      x: 0,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const fixed = createTile({
      x: 1,
      y: 0,
      z: 0,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    source.gearMounts = [{
      id: 'gear_source',
      position: 'corner_ne',
      surface: 'front',
      axisType: 'freeAxis',
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
    }];
    fixed.gearMounts = [{
      id: 'gear_fixed',
      position: 'center',
      surface: 'front',
      axisBinding: {
        componentKey: fixedKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const assembly = {
      id: 'assembly_linked',
      componentKeys: [sourceKey, fixedKey],
      edges: [{ componentKey: sourceKey, key: fixedKey }],
      gearMounts: [
        { ...source.gearMounts[0], componentKey: sourceKey },
        { ...fixed.gearMounts[0], componentKey: fixedKey }
      ],
      fixedAxes: [{ ...fixed.gearMounts[0], componentKey: fixedKey }]
    };
    const scene = {
      getGearMountPoint: jest.fn((placement) => (
        placement === source ? { x: 100, y: 100 } : { x: 122, y: 122 }
      )),
      getMechanicalAssemblyGraph: jest.fn(() => ({
        assemblies: [assembly],
        assemblyByComponentKey: {
          [sourceKey]: assembly.id,
          [fixedKey]: assembly.id
        }
      })),
      mapData: {
        tiles: {
          [sourceKey]: source,
          [fixedKey]: fixed
        },
        walls: {}
      },
      mapGearLocalPointToSurface: jest.fn((placement, localPosition) => ({
        x: (placement === source ? 100 : 122) + ((localPosition.x || 0) * 100),
        y: (placement === source ? 100 : 122) + ((localPosition.y || 0) * 100)
      })),
      applyMechanismRuntimePlacementTransforms: jest.fn(),
      mergeMechanismRuntimeGearStates: jest.fn(),
      redrawMountedGearHostLayers: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(),
      sortMapLayer: jest.fn(),
      time: { delayedCall: jest.fn() },
      tweens: {
        killTweensOf: jest.fn(),
        add: jest.fn((config) => {
          config.onUpdate?.();
          config.onComplete?.();
        })
      },
      config: {
        onMechanismPreviewProgress: jest.fn(),
        onToast: jest.fn()
      }
    };

    const played = playAssemblyGearRotation(scene, assembly, sourceKey, {
      rotationAngle: 45,
      rotationSpeedDegPerSec: 45,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(true);
    expect(scene.applyMechanismRuntimePlacementTransforms).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assembly_linked',
        componentKeys: [sourceKey, fixedKey]
      }),
      expect.objectContaining({
        componentKey: fixedKey,
        fixedMount: expect.objectContaining({
          id: 'gear_fixed',
          componentKey: fixedKey
        }),
        pivotWorld: getGearWorldPosition(fixed, { ...fixed.gearMounts[0], componentKey: fixedKey }),
        basePlacement: fixed,
        basePlacements: expect.objectContaining({
          [sourceKey]: source,
          [fixedKey]: fixed
        })
      }),
      45
    );
  });

  it('drives an externally bound corner gear only through real mesh direction', () => {
    const sourceKey = createCellKey(0, 0, 0);
    const cornerHostKey = createCellKey(1, -1, 0);
    const boundKey = createCellKey(1, 0, 0);
    const source = createTile({
      x: 0,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    const cornerHost = createTile({
      x: 1,
      y: -1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const bound = createTile({
      x: 1,
      y: 0,
      z: 0,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    source.gearMounts = [{ id: 'gear_center', position: 'center', surface: 'front', axisType: 'freeAxis' }];
    cornerHost.gearMounts = [{
      id: 'gear_corner',
      position: 'corner_sw',
      surface: 'front',
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const sourceAssembly = {
      id: 'assembly_pressure',
      componentKeys: [sourceKey, cornerHostKey],
      edges: [{ componentKey: sourceKey, key: cornerHostKey }],
      gearMounts: [
        { ...source.gearMounts[0], componentKey: sourceKey },
        { ...cornerHost.gearMounts[0], componentKey: cornerHostKey }
      ],
      fixedAxes: [{ ...cornerHost.gearMounts[0], componentKey: cornerHostKey }]
    };
    const scene = {
      getGearMountPoint: jest.fn((placement) => (
        placement === source ? { x: 100, y: 100 } : { x: 122, y: 100 }
      )),
      getMechanicalAssemblyGraph: jest.fn(() => ({
        assemblies: [sourceAssembly],
        assemblyByComponentKey: {
          [sourceKey]: sourceAssembly.id,
          [cornerHostKey]: sourceAssembly.id
        }
      })),
      mapData: {
        tiles: {
          [sourceKey]: source,
          [cornerHostKey]: cornerHost,
          [boundKey]: bound
        },
        walls: {}
      },
      mapGearLocalPointToSurface: jest.fn((placement, localPosition) => ({
        x: (placement === source ? 100 : 122) + ((localPosition.x || 0) * 100),
        y: 100 + ((localPosition.y || 0) * 100)
      })),
      applyMechanismRuntimePlacementTransforms: jest.fn(),
      mergeMechanismRuntimeGearStates: jest.fn(),
      redrawMountedGearHostLayers: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(),
      sortMapLayer: jest.fn(),
      time: { delayedCall: jest.fn() },
      tweens: {
        killTweensOf: jest.fn(),
        add: jest.fn((config) => {
          config.onUpdate?.();
          config.onComplete?.();
        })
      },
      config: {
        onMechanismPreviewProgress: jest.fn(),
        onToast: jest.fn()
      }
    };

    const obstructionSpy = jest
      .spyOn(mechanismSimulation, 'findRotationObstruction')
      .mockReturnValue(null);

    try {
      const played = playAssemblyGearRotation(scene, sourceAssembly, sourceKey, {
        rotationAngle: 45,
        rotationDirection: 'right',
        rotationSpeedDegPerSec: 45,
        triggerDelaySeconds: 0,
        autoReturn: false
      });

      expect(played).toBe(true);
      expect(scene.applyMechanismRuntimePlacementTransforms).toHaveBeenCalledWith(
        expect.objectContaining({
          id: `single_${boundKey}`,
          componentKeys: [boundKey]
        }),
        expect.objectContaining({
          componentKey: boundKey,
          sourceGearComponentKey: cornerHostKey,
          sourceGearMountId: 'gear_corner'
        }),
        -45
      );
    } finally {
      obstructionSpy.mockRestore();
    }
  });

  it('degrades a meshed bound corner gear into an unbound passive gear', () => {
    const sourceKey = createCellKey(0, 0, 0);
    const cornerHostKey = createCellKey(1, -1, 0);
    const source = createTile({
      x: 0,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    const cornerHost = createTile({
      x: 1,
      y: -1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    source.gearMounts = [{ id: 'gear_center', position: 'center', surface: 'front', axisType: 'freeAxis' }];
    cornerHost.gearMounts = [{
      id: 'gear_corner',
      position: 'corner_sw',
      surface: 'front',
      axisBinding: {
        componentKey: sourceKey,
        hostKind: 'tile',
        socket: 'corner_ne',
        surface: 'front'
      }
    }];
    const sourceAssembly = {
      id: 'assembly_pressure',
      componentKeys: [sourceKey, cornerHostKey],
      edges: [{ componentKey: sourceKey, key: cornerHostKey }],
      gearMounts: [
        { ...source.gearMounts[0], componentKey: sourceKey },
        { ...cornerHost.gearMounts[0], componentKey: cornerHostKey }
      ],
      fixedAxes: [{ ...cornerHost.gearMounts[0], componentKey: cornerHostKey }]
    };
    const scene = {
      getGearMountPoint: jest.fn((placement) => (
        placement === source ? { x: 100, y: 100 } : { x: 122, y: 100 }
      )),
      getMechanicalAssemblyGraph: jest.fn(() => ({
        assemblies: [sourceAssembly],
        assemblyByComponentKey: {
          [sourceKey]: sourceAssembly.id,
          [cornerHostKey]: sourceAssembly.id
        }
      })),
      mapData: {
        tiles: {
          [sourceKey]: source,
          [cornerHostKey]: cornerHost
        },
        walls: {}
      },
      mapGearLocalPointToSurface: jest.fn((placement, localPosition) => ({
        x: (placement === source ? 100 : 122) + ((localPosition.x || 0) * 100),
        y: 100 + ((localPosition.y || 0) * 100)
      })),
      applyMechanismRuntimePlacementTransforms: jest.fn(),
      mergeMechanismRuntimeGearStates: jest.fn(),
      redrawMountedGearHostLayers: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(),
      sortMapLayer: jest.fn(),
      time: { delayedCall: jest.fn() },
      tweens: {
        killTweensOf: jest.fn(),
        add: jest.fn((config) => {
          config.onUpdate?.();
          config.onComplete?.();
        })
      },
      config: {
        onMechanismPreviewProgress: jest.fn(),
        onToast: jest.fn()
      }
    };

    const played = playAssemblyGearRotation(scene, sourceAssembly, sourceKey, {
      rotationAngle: 45,
      rotationDirection: 'right',
      rotationSpeedDegPerSec: 45,
      triggerDelaySeconds: 0,
      autoReturn: false
    });
    const snapshotCalls = scene.setMechanismRuntimeSnapshot.mock.calls;
    const snapshot = snapshotCalls[snapshotCalls.length - 1]?.[0];

    expect(played).toBe(true);
    expect(scene.applyMechanismRuntimePlacementTransforms).not.toHaveBeenCalled();
    expect(snapshot.gears[`${cornerHostKey}:gear_corner`]).toMatchObject({
      axisType: 'freeAxis',
      axisBinding: null,
      phase: 315,
      speedRatio: -1
    });
  });

  it('does not treat a source-side vertical panel base as a floor-plane obstruction', () => {
    const sourceKey = createCellKey(0, 0, 0);
    const cornerHostKey = createCellKey(0, -1, 0);
    const blockerKey = createCellKey(1, -1, 0);
    const boundKey = createCellKey(1, 0, 0);
    const source = createTile({
      x: 0,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    const cornerHost = createTile({
      x: 0,
      y: -1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const blocker = {
      ...createTile({
        x: 1,
        y: -1,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        rotation: 0
      }),
      isVertical: true
    };
    const bound = createTile({
      x: 1,
      y: 0,
      z: 0,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    source.gearMounts = [{ id: 'gear_center', position: 'center', surface: 'front', axisType: 'freeAxis' }];
    cornerHost.gearMounts = [{
      id: 'gear_corner',
      position: 'corner_se',
      surface: 'front',
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const sourceAssembly = {
      id: 'assembly_pressure',
      componentKeys: [sourceKey, cornerHostKey, blockerKey],
      edges: [
        { componentKey: sourceKey, key: cornerHostKey },
        { componentKey: cornerHostKey, key: blockerKey }
      ],
      gearMounts: [
        { ...source.gearMounts[0], componentKey: sourceKey },
        { ...cornerHost.gearMounts[0], componentKey: cornerHostKey }
      ],
      fixedAxes: [{ ...cornerHost.gearMounts[0], componentKey: cornerHostKey }]
    };
    const scene = {
      getGearMountPoint: jest.fn((placement) => (
        placement === source ? { x: 100, y: 100 } : { x: 122, y: 100 }
      )),
      getMechanicalAssemblyGraph: jest.fn(() => ({
        assemblies: [sourceAssembly],
        assemblyByComponentKey: {
          [sourceKey]: sourceAssembly.id,
          [cornerHostKey]: sourceAssembly.id,
          [blockerKey]: sourceAssembly.id
        }
      })),
      mapData: {
        tiles: {
          [sourceKey]: source,
          [cornerHostKey]: cornerHost,
          [blockerKey]: blocker,
          [boundKey]: bound
        },
        walls: {}
      },
      mapGearLocalPointToSurface: jest.fn((placement, localPosition) => ({
        x: (placement === source ? 100 : 122) + ((localPosition.x || 0) * 100),
        y: 100 + ((localPosition.y || 0) * 100)
      })),
      applyMechanismRuntimePlacementTransforms: jest.fn(),
      clearMechanismRuntimeSnapshot: jest.fn(),
      flashMechanismObstruction: jest.fn(),
      mergeMechanismRuntimeGearStates: jest.fn(),
      redrawMountedGearHostLayers: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(),
      sortMapLayer: jest.fn(),
      time: { delayedCall: jest.fn() },
      tweens: {
        killTweensOf: jest.fn(),
        add: jest.fn()
      },
      config: {
        onMechanismPreviewProgress: jest.fn(),
        onToast: jest.fn()
      }
    };

    const played = playAssemblyGearRotation(scene, sourceAssembly, sourceKey, {
      rotationAngle: 90,
      rotationDirection: 'right',
      rotationSpeedDegPerSec: 45,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(true);
    expect(scene.clearMechanismRuntimeSnapshot).not.toHaveBeenCalled();
    expect(scene.flashMechanismObstruction).not.toHaveBeenCalled();
    expect(scene.tweens.add).toHaveBeenCalled();
  });

  it('builds a collision filter from every assembly in one gear rotation event', () => {
    const keys = getGearRotationTransmissionEventKeys(
      {
        id: 'assembly_source',
        componentKeys: ['source_floor', 'source_wall', 'source_vertical']
      },
      [
        { assembly: { id: 'assembly_bound_a', componentKeys: ['bound_a', 'bound_a_neighbor'] } },
        { assembly: { id: 'assembly_bound_b', componentKeys: ['bound_b'] } }
      ]
    );

    expect(Array.from(keys).sort()).toEqual([
      'bound_a',
      'bound_a_neighbor',
      'bound_b',
      'source_floor',
      'source_vertical',
      'source_wall'
    ]);
  });

  it('keeps source-side transmission participants blocking an axis-bound driven assembly', () => {
    const obstructionCalls = [];
    const obstructionSpy = jest
      .spyOn(mechanismSimulation, 'findRotationObstruction')
      .mockImplementation(({ excludedComponentKeys }) => {
        obstructionCalls.push(new Set(excludedComponentKeys || []));
        return {
          blocked: true,
          angle: 30,
          componentKey: sourceSideBlockerKey,
          obstacleComponentKey: sourceKey
        };
      });
    const sourceKey = createCellKey(0, 0, 0);
    const cornerHostKey = createCellKey(0, -1, 0);
    const sourceSideBlockerKey = createWallKey(0, -1, 0, 'east');
    const boundKey = createCellKey(1, 0, 0);
    const boundNeighborKey = createCellKey(2, 0, 0);
    const source = createTile({
      x: 0,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    const cornerHost = createTile({
      x: 0,
      y: -1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const sourceSideBlocker = createWall({
      x: 0,
      y: -1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const bound = createTile({
      x: 1,
      y: 0,
      z: 0,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    const boundNeighbor = createTile({
      x: 2,
      y: 0,
      z: 0,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    source.gearMounts = [{ id: 'gear_center', position: 'center', surface: 'front', axisType: 'freeAxis' }];
    cornerHost.gearMounts = [{
      id: 'gear_corner',
      position: 'corner_se',
      surface: 'front',
      axisBinding: {
        componentKey: boundKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const sourceAssembly = {
      id: 'assembly_pressure',
      componentKeys: [sourceKey, cornerHostKey, sourceSideBlockerKey],
      edges: [
        { componentKey: sourceKey, key: cornerHostKey },
        { componentKey: cornerHostKey, key: sourceSideBlockerKey }
      ],
      gearMounts: [
        { ...source.gearMounts[0], componentKey: sourceKey },
        { ...cornerHost.gearMounts[0], componentKey: cornerHostKey }
      ],
      fixedAxes: [{ ...cornerHost.gearMounts[0], componentKey: cornerHostKey }]
    };
    const boundAssembly = {
      id: 'assembly_bound',
      componentKeys: [boundKey, boundNeighborKey],
      edges: [{ componentKey: boundKey, key: boundNeighborKey }],
      gearMounts: [],
      fixedAxes: []
    };
    const scene = {
      getGearMountPoint: jest.fn((placement) => (
        placement === source ? { x: 100, y: 100 } : { x: 122, y: 100 }
      )),
      getMechanicalAssemblyGraph: jest.fn(() => ({
        assemblies: [sourceAssembly, boundAssembly],
        assemblyByComponentKey: {
          [sourceKey]: sourceAssembly.id,
          [cornerHostKey]: sourceAssembly.id,
          [sourceSideBlockerKey]: sourceAssembly.id,
          [boundKey]: boundAssembly.id,
          [boundNeighborKey]: boundAssembly.id
        }
      })),
      mapData: {
        tiles: {
          [sourceKey]: source,
          [cornerHostKey]: cornerHost,
          [boundKey]: bound,
          [boundNeighborKey]: boundNeighbor
        },
        walls: {
          [sourceSideBlockerKey]: sourceSideBlocker
        }
      },
      mapGearLocalPointToSurface: jest.fn((placement, localPosition) => ({
        x: (placement === source ? 100 : 122) + ((localPosition.x || 0) * 100),
        y: 100 + ((localPosition.y || 0) * 100)
      })),
      applyMechanismRuntimePlacementTransforms: jest.fn(),
      clearMechanismRuntimeSnapshot: jest.fn(),
      flashMechanismObstruction: jest.fn(),
      mergeMechanismRuntimeGearStates: jest.fn(),
      redrawMountedGearHostLayers: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(),
      sortMapLayer: jest.fn(),
      time: { delayedCall: jest.fn() },
      tweens: {
        killTweensOf: jest.fn(),
        add: jest.fn()
      },
      config: {
        onMechanismPreviewProgress: jest.fn(),
        onToast: jest.fn()
      }
    };

    try {
      const played = playAssemblyGearRotation(scene, sourceAssembly, sourceKey, {
        rotationAngle: 90,
        rotationDirection: 'right',
        rotationSpeedDegPerSec: 45,
        triggerDelaySeconds: 0,
        autoReturn: false
      });

      expect(played).toBe(false);
      expect(obstructionCalls).toHaveLength(1);
      expect(obstructionCalls[0].has(sourceKey)).toBe(false);
      expect(obstructionCalls[0].has(cornerHostKey)).toBe(false);
      expect(obstructionCalls[0].has(sourceSideBlockerKey)).toBe(false);
      expect(obstructionCalls[0].has(boundKey)).toBe(false);
      expect(obstructionCalls[0].has(boundNeighborKey)).toBe(false);
      expect(scene.flashMechanismObstruction).toHaveBeenCalledTimes(1);
      expect(scene.config.onToast).toHaveBeenLastCalledWith('旁边有遮挡物，当前齿轮组没有足够转动空间。', 'error');
    } finally {
      obstructionSpy.mockRestore();
    }
  });

  it('applies fixed-axis runtime placement in world space across camera yaw changes', () => {
    const PhaserStub = {
      Scene: class Scene {
        constructor() {}
      }
    };
    jest.isolateModules(() => {
      const { createCityChannelPhaserScene } = require('./CityChannelPhaserScene');
      const key = createCellKey(4, 4, 0);
      const tile = createTile({
        x: 4,
        y: 4,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        rotation: 0
      });
      const fixedMount = {
        id: 'gear_fixed',
        position: 'corner_ne',
        surface: 'front',
        axisType: 'fixedAxis',
        componentKey: key
      };
      tile.gearMounts = [fixedMount];
      const mapData = {
        ...createBaseCityChannelMap({ name: 'fixed gear world transform' }),
        tiles: { [key]: tile },
        walls: {}
      };
      const SceneClass = createCityChannelPhaserScene(PhaserStub, {
        mapData
      });
      const scene = new SceneClass();
      scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
      scene.mapData = mapData;
      scene.mechanismRuntimeSnapshot = {
        sourceAngle: 45,
        placements: {},
        gears: {
          [`${key}:gear_fixed`]: {
            componentKey: key,
            mountId: 'gear_fixed',
            axisType: 'fixedAxis',
            phase: 45
          }
        },
        sync: [],
        obstruction: null
      };
      const tileObject = {
        setPosition: jest.fn(),
        setAngle: jest.fn(),
        depth: 1
      };
      scene.renderObjects = new Map([
        [`tile:${key}`, tileObject]
      ]);
      scene.textureCache = {
        getTileTexture: jest.fn(() => 'tileTexture')
      };
      scene.setBoardTexture = jest.fn();
      scene.redrawMountedGearHostLayers = jest.fn();
      scene.redrawVerticalStructureOverlay = jest.fn();
      scene.sortMapLayer = jest.fn();
      scene.selectedGears = [];
      const basePoint = scene.getGearMountPoint(tile, fixedMount);
      const pivotWorld = getGearWorldPosition(tile, fixedMount);
      const runtimeEntry = {
        assembly: { id: 'assembly_1', componentKeys: [key] },
        componentKey: key,
        fixedMount,
        pivotWorld,
        anchor: pivotWorld,
        basePlacement: tile,
        basePlacements: { [key]: tile },
        driveRatio: 1
      };

      scene.applyMechanismRuntimePlacementTransforms(runtimeEntry.assembly, runtimeEntry, 45);

      const runtimePlacement = scene.mechanismRuntimeSnapshot.placements[key];
      expect(runtimePlacement.runtimeScreenTransform).toBeUndefined();
      expect(runtimePlacement.runtimeScreenPose).toBeUndefined();
      expect(tileObject.setAngle).toHaveBeenCalledWith(0);
      expect(scene.textureCache.getTileTexture).toHaveBeenCalledWith(
        tile.panelType,
        45,
        0,
        expect.any(Number),
        { isVertical: false }
      );
      expect(scene.redrawMountedGearHostLayers).toHaveBeenCalledWith(
        'tile',
        key,
        expect.objectContaining({ runtimeAngle: 45 }),
        1,
        tile
      );

      [0, 30, 90].forEach((yaw) => {
        scene.cameraState.yaw = yaw;
        const runtimePoint = scene.getGearMountPoint(runtimePlacement, fixedMount);
        const projectedPivot = projectCell(pivotWorld, yaw, mapData);
        expect(runtimePoint.x).toBeCloseTo(projectedPivot.x, 3);
        expect(runtimePoint.y).toBeCloseTo(projectedPivot.y, 3);
      });
      scene.cameraState.yaw = 0;
      const runtimePoint = scene.getGearMountPoint(runtimePlacement, fixedMount);
      expect(runtimePoint.x).toBeCloseTo(basePoint.x, 3);
      expect(runtimePoint.y).toBeCloseTo(basePoint.y, 3);
    });
  });

  it('projects vertical fixed-axis runtime placement from 3D world state across camera yaw changes', () => {
    const PhaserStub = {
      Scene: class Scene {
        constructor() {}
      }
    };
    jest.isolateModules(() => {
      const { createCityChannelPhaserScene } = require('./CityChannelPhaserScene');
      const key = createCellKey(4, 4, 1);
      const tile = createTile({
        x: 4,
        y: 4,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        rotation: 0,
        isVertical: true
      });
      const fixedMount = {
        id: 'gear_fixed',
        position: 'corner_ne',
        surface: 'front',
        axisType: 'fixedAxis',
        componentKey: key
      };
      tile.gearMounts = [fixedMount];
      const mapData = {
        ...createBaseCityChannelMap({ name: 'vertical fixed gear world transform' }),
        tiles: { [key]: tile },
        walls: {}
      };
      const SceneClass = createCityChannelPhaserScene(PhaserStub, {
        mapData
      });
      const scene = new SceneClass();
      scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
      scene.mapData = mapData;
      const pivotWorld = getGearWorldPosition(tile, fixedMount);
      const runtimePlacement = getRuntimePlacementAroundFixedGear(tile, fixedMount, pivotWorld, 45);

      [0, 30, 90].forEach((yaw) => {
        scene.cameraState.yaw = yaw;
        const runtimePoint = scene.getGearMountPoint(runtimePlacement, fixedMount);
        const projectedPivot = projectCell(pivotWorld, yaw, mapData);
        expect(runtimePoint.x).toBeCloseTo(projectedPivot.x, 3);
        expect(runtimePoint.y).toBeCloseTo(projectedPivot.y, 3);
      });
    });
  });

  it('projects edge-wall fixed-axis runtime placement from 3D world state across camera yaw changes', () => {
    const PhaserStub = {
      Scene: class Scene {
        constructor() {}
      }
    };
    jest.isolateModules(() => {
      const { createCityChannelPhaserScene } = require('./CityChannelPhaserScene');
      const key = createWallKey(4, 4, 1, 'north');
      const wall = createWall({
        x: 4,
        y: 4,
        z: 1,
        edge: 'north',
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      });
      const fixedMount = {
        id: 'gear_fixed',
        position: 'corner_ne',
        surface: 'front',
        axisType: 'fixedAxis',
        componentKey: key
      };
      wall.gearMounts = [fixedMount];
      const mapData = {
        ...createBaseCityChannelMap({ name: 'edge wall fixed gear world transform' }),
        tiles: {},
        walls: { [key]: wall }
      };
      const SceneClass = createCityChannelPhaserScene(PhaserStub, {
        mapData
      });
      const scene = new SceneClass();
      scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
      scene.mapData = mapData;
      scene.getWallMiterProfile = jest.fn(() => null);
      const pivotWorld = getGearWorldPosition(wall, fixedMount);
      const runtimePlacement = getRuntimePlacementAroundFixedGear(wall, fixedMount, pivotWorld, 45);

      expect(runtimePlacement.rotation).toBe(wall.rotation);
      expect(runtimePlacement.runtimeSurfaceRotation).toBe(45);
      [0, 30, 90].forEach((yaw) => {
        scene.cameraState.yaw = yaw;
        const runtimePoint = scene.getGearMountPoint(runtimePlacement, fixedMount);
        const projectedPivot = projectCell(pivotWorld, yaw, mapData);
        expect(runtimePoint.x).toBeCloseTo(projectedPivot.x, 3);
        expect(runtimePoint.y).toBeCloseTo(projectedPivot.y, 3);
      });
    });
  });

  it('ignores remote assembly obstructions when gears only mesh across assemblies', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const remoteKey = createCellKey(2, 1, 0);
    const obstacleKey = createCellKey(2, 2, 0);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const remote = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const obstacle = createTile({
      x: 2,
      y: 2,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    source.gearMounts = [{ id: 'gear_source', position: 'corner_ne', surface: 'front', axisType: 'freeAxis' }];
    remote.gearMounts = [{ id: 'gear_remote', position: 'center', surface: 'front', axisType: 'fixedAxis' }];
    const sourceAssembly = {
      id: 'assembly_source',
      componentKeys: [sourceKey],
      edges: [],
      gearMounts: [{ ...source.gearMounts[0], componentKey: sourceKey }],
      fixedAxes: []
    };
    const remoteAssembly = {
      id: 'assembly_remote',
      componentKeys: [remoteKey],
      edges: [],
      gearMounts: [{ ...remote.gearMounts[0], componentKey: remoteKey }],
      fixedAxes: [{ ...remote.gearMounts[0], componentKey: remoteKey }]
    };
    const scene = {
      getGearMountPoint: jest.fn((placement) => (
        placement === source ? { x: 100, y: 100 } : { x: 122, y: 100 }
      )),
      getMechanicalAssemblyGraph: jest.fn(() => ({
        assemblies: [sourceAssembly, remoteAssembly],
        assemblyByComponentKey: {
          [sourceKey]: sourceAssembly.id,
          [remoteKey]: remoteAssembly.id
        }
      })),
      mapData: {
        tiles: {
          [sourceKey]: source,
          [remoteKey]: remote,
          [obstacleKey]: obstacle
        },
        walls: {}
      },
      mapGearLocalPointToSurface: jest.fn((placement, localPosition) => ({
        x: (placement === source ? 100 : 122) + (localPosition.x || 0),
        y: 100 + (localPosition.y || 0)
      })),
      applyMechanismRuntimePlacementTransforms: jest.fn(),
      clearMechanismRuntimeSnapshot: jest.fn(),
      mergeMechanismRuntimeGearStates: jest.fn(),
      redrawMountedGearHostLayers: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(),
      sortMapLayer: jest.fn(),
      time: { delayedCall: jest.fn() },
      tweens: {
        killTweensOf: jest.fn(),
        add: jest.fn()
      },
      config: {
        onMechanismPreviewProgress: jest.fn(),
        onToast: jest.fn()
      }
    };

    const played = playAssemblyGearRotation(scene, sourceAssembly, sourceKey, {
      rotationAngle: 90,
      rotationDirection: 'right',
      rotationSpeedDegPerSec: 45,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(true);
    expect(scene.tweens.add).toHaveBeenCalled();
    expect(scene.applyMechanismRuntimePlacementTransforms).not.toHaveBeenCalled();
    expect(scene.clearMechanismRuntimeSnapshot).not.toHaveBeenCalled();
    expect(scene.config.onToast).toHaveBeenCalledWith('assembly_source 齿轮传动预览：2 个齿轮转动。', 'success');
  });

  it('redraws fixed-axis runtime gears with mounted surface projection and runtime phase', () => {
    const PhaserStub = {
      Scene: class Scene {
        constructor() {}
      }
    };
    jest.isolateModules(() => {
      const { createCityChannelPhaserScene } = require('./CityChannelPhaserScene');
      const key = createCellKey(3, 3, 0);
      const tile = createTile({
        x: 3,
        y: 3,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      });
      tile.gearMounts = [{
        id: 'gear_fixed',
        position: 'corner_ne',
        surface: 'front',
        axisType: 'fixedAxis',
        phase: 5
      }];
      const SceneClass = createCityChannelPhaserScene(PhaserStub, {
        mapData: {
          ...createBaseCityChannelMap({ name: 'fixed gear render phase' }),
          tiles: { [key]: tile },
          walls: {}
        }
      });
      const scene = new SceneClass();
      const farGraphics = { clear: jest.fn(), setPosition: jest.fn().mockReturnThis(), setAngle: jest.fn().mockReturnThis(), setScale: jest.fn().mockReturnThis(), depth: 0 };
      const nearGraphics = { clear: jest.fn(), setPosition: jest.fn().mockReturnThis(), setAngle: jest.fn().mockReturnThis(), setScale: jest.fn().mockReturnThis(), depth: 0 };
      scene.getOrCreateMountedGearGraphics = jest.fn((hostKind, hostKey, side) => (side === 'far' ? farGraphics : nearGraphics));
      scene.getGearMountPoint = jest.fn(() => ({ x: 144, y: 88 }));
      scene.getRuntimeGearState = jest.fn(() => ({
        axisType: 'fixedAxis',
        phase: 77
      }));
      scene.drawMountedGearPreview = jest.fn();
      scene.drawGearHostSurfaceOccluder = jest.fn();
      scene.selectedGears = [];

      scene.redrawMountedGearHostLayers('tile', key, {
        ...tile,
        runtimeAngle: 45,
        runtimeSurfaceRotation: 45,
        runtimeAxisAnchor: { x: 3.32, y: 2.68, z: 0 }
      }, 10, tile);

      expect(scene.getGearMountPoint).toHaveBeenCalledWith(expect.objectContaining({
        runtimeAxisAnchor: { x: 3.32, y: 2.68, z: 0 }
      }), tile.gearMounts[0]);
      expect(scene.drawMountedGearPreview).toHaveBeenCalledWith(
        nearGraphics,
        { x: 144, y: 88 },
        expect.objectContaining({
          angle: 77,
          mount: tile.gearMounts[0]
        })
      );
      expect(scene.drawMountedGearPreview.mock.calls[0][2]).not.toHaveProperty('lockedCenter');
    });
  });

  it('draws corner gears above adjacent same-plane floor boards', () => {
    const PhaserStub = {
      Scene: class Scene {
        constructor() {}
      }
    };
    jest.isolateModules(() => {
      const { createCityChannelPhaserScene } = require('./CityChannelPhaserScene');
      const key = createCellKey(3, 3, 0);
      const neighborKey = createCellKey(4, 3, 0);
      const tile = createTile({
        x: 3,
        y: 3,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      });
      const neighbor = createTile({
        x: 4,
        y: 3,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      });
      tile.gearMounts = [{
        id: 'gear_corner',
        position: 'corner_ne',
        surface: 'front',
        phase: 5
      }];
      const mapData = {
        ...createBaseCityChannelMap({ name: 'corner gear layer depth' }),
        tiles: { [key]: tile, [neighborKey]: neighbor },
        walls: {}
      };
      const SceneClass = createCityChannelPhaserScene(PhaserStub, { mapData });
      const scene = new SceneClass();
      const farGraphics = { clear: jest.fn(), setPosition: jest.fn().mockReturnThis(), setAngle: jest.fn().mockReturnThis(), setScale: jest.fn().mockReturnThis(), depth: 0 };
      const nearGraphics = { clear: jest.fn(), setPosition: jest.fn().mockReturnThis(), setAngle: jest.fn().mockReturnThis(), setScale: jest.fn().mockReturnThis(), depth: 0 };
      scene.getOrCreateMountedGearGraphics = jest.fn((hostKind, hostKey, side) => (side === 'far' ? farGraphics : nearGraphics));
      scene.getGearMountPoint = jest.fn(() => ({ x: 144, y: 88 }));
      scene.getRuntimeGearState = jest.fn(() => null);
      scene.drawMountedGearPreview = jest.fn();
      scene.drawGearHostSurfaceOccluder = jest.fn();
      scene.selectedGears = [];

      scene.redrawMountedGearHostLayers('tile', key, tile, null, tile);

      const neighborBoardDepth = getPlacementDepth({
        cell: neighbor,
        partType: 'floor_base',
        physicalLayer: 'floor_base',
        cameraYaw: scene.cameraState.yaw,
        mapData
      });
      expect(nearGraphics.depth).toBeGreaterThan(neighborBoardDepth);
      expect(scene.drawGearHostSurfaceOccluder).not.toHaveBeenCalled();
    });
  });

  it('keeps vertical front gears above same-plane vertical board bases', () => {
    const PhaserStub = {
      Scene: class Scene {
        constructor() {}
      }
    };
    jest.isolateModules(() => {
      const { createCityChannelPhaserScene } = require('./CityChannelPhaserScene');
      const key = createCellKey(3, 3, 0);
      const upperKey = createCellKey(3, 3, 1);
      const tile = createTile({
        x: 3,
        y: 3,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        isVertical: true
      });
      const upper = createTile({
        x: 3,
        y: 3,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        isVertical: true
      });
      tile.gearMounts = [{
        id: 'gear_vertical',
        position: 'corner_ne',
        surface: 'front',
        phase: 5
      }];
      const mapData = {
        ...createBaseCityChannelMap({ name: 'vertical gear layer depth' }),
        tiles: { [key]: tile, [upperKey]: upper },
        walls: {}
      };
      const SceneClass = createCityChannelPhaserScene(PhaserStub, { mapData });
      const scene = new SceneClass();
      const farGraphics = { clear: jest.fn(), setPosition: jest.fn().mockReturnThis(), setAngle: jest.fn().mockReturnThis(), setScale: jest.fn().mockReturnThis(), depth: 0 };
      const nearGraphics = { clear: jest.fn(), setPosition: jest.fn().mockReturnThis(), setAngle: jest.fn().mockReturnThis(), setScale: jest.fn().mockReturnThis(), depth: 0 };
      scene.getOrCreateMountedGearGraphics = jest.fn((hostKind, hostKey, side) => (side === 'far' ? farGraphics : nearGraphics));
      scene.getGearMountPoint = jest.fn(() => ({ x: 144, y: 88 }));
      scene.getRuntimeGearState = jest.fn(() => null);
      scene.drawMountedGearPreview = jest.fn();
      scene.drawGearHostSurfaceOccluder = jest.fn();
      scene.selectedGears = [];

      scene.redrawMountedGearHostLayers('tile', key, tile, null, tile);

      const boardDepth = getPlacementDepth({
        cell: tile,
        partType: 'wall_plane',
        physicalLayer: 'wall_plane',
        rotation: tile.rotation || 0,
        cameraYaw: scene.cameraState.yaw,
        mapData
      });
      expect(nearGraphics.depth).toBeGreaterThan(boardDepth);
    });
  });

  it('keeps vertical front gears above overlapping same-plane vertical boards', () => {
    const PhaserStub = {
      Scene: class Scene {
        constructor() {}
      }
    };
    jest.isolateModules(() => {
      const { createCityChannelPhaserScene } = require('./CityChannelPhaserScene');
      const key = createCellKey(3, 3, 0);
      const upperKey = createCellKey(3, 3, 1);
      const tile = createTile({
        x: 3,
        y: 3,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        isVertical: true
      });
      const upper = createTile({
        x: 3,
        y: 3,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        isVertical: true
      });
      tile.gearMounts = [{
        id: 'gear_vertical',
        position: 'corner_ne',
        surface: 'front',
        phase: 5
      }];
      const mapData = {
        ...createBaseCityChannelMap({ name: 'vertical gear overlapping board depth' }),
        tiles: { [key]: tile, [upperKey]: upper },
        walls: {}
      };
      const SceneClass = createCityChannelPhaserScene(PhaserStub, { mapData });
      const scene = new SceneClass();
      const farGraphics = { clear: jest.fn(), setPosition: jest.fn().mockReturnThis(), setAngle: jest.fn().mockReturnThis(), setScale: jest.fn().mockReturnThis(), depth: 0 };
      const nearGraphics = { clear: jest.fn(), setPosition: jest.fn().mockReturnThis(), setAngle: jest.fn().mockReturnThis(), setScale: jest.fn().mockReturnThis(), depth: 0 };
      scene.getOrCreateMountedGearGraphics = jest.fn((hostKind, hostKey, side) => (side === 'far' ? farGraphics : nearGraphics));
      scene.getRuntimeGearState = jest.fn(() => null);
      scene.drawMountedGearPreview = jest.fn();
      scene.drawGearHostSurfaceOccluder = jest.fn();
      scene.selectedGears = [];

      scene.redrawMountedGearHostLayers('tile', key, tile, null, tile);

      const upperBoardDepth = getPlacementDepth({
        cell: upper,
        partType: 'wall_plane',
        physicalLayer: 'wall_plane',
        rotation: upper.rotation || 0,
        cameraYaw: scene.cameraState.yaw,
        mapData
      });
      expect(nearGraphics.depth).toBeGreaterThan(upperBoardDepth);
    });
  });
});
