import * as THREE from 'three';
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
  getTileThreeTransform,
  getWallThreeTransform,
  buildCityChannelThreeRenderModel
} from './cityChannelThreeGeometry';
import {
  buildMechanicalAssemblies,
  getAssemblyForCell
} from '../cityChannelMechanismRuntime';
import CityChannelThreeRuntime from './CityChannelThreeRuntime';

const createRuntimeHarness = (overrides = {}) => ({
  clearLongPressTimer: jest.fn(),
  hideSelectionBox: jest.fn(),
  updateHover: jest.fn(),
  updatePlacementGhost: jest.fn(),
  updateCarryGhost: jest.fn(),
  commitCarryTarget: jest.fn(() => false),
  commitPlacementTarget: jest.fn(() => false),
  commitGearInstallTarget: jest.fn(() => false),
  eraseHovered: jest.fn(() => false),
  commitGearBindingCandidate: jest.fn(() => false),
  cancelMechanismRuntimePreview: jest.fn(),
  selectHovered: jest.fn(),
  renderer: {
    domElement: {
      releasePointerCapture: jest.fn()
    }
  },
  pointerState: {
    mode: 'click',
    moved: false,
    shiftKey: false
  },
  config: {
    activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE
  },
  ...overrides
});

const pointerUpEvent = {
  button: 0,
  pointerId: 1,
  shiftKey: false
};

const pointerDownEvent = {
  button: 0,
  pointerId: 1,
  clientX: 120,
  clientY: 80,
  shiftKey: false
};

describe('CityChannelThreeRuntime pointer release flow', () => {
  it('commits the currently displayed placement ghost before recalculating hover', () => {
    const runtime = createRuntimeHarness({
      commitPlacementTarget: jest.fn(() => true)
    });

    CityChannelThreeRuntime.prototype.handlePointerUp.call(runtime, pointerUpEvent);

    expect(runtime.commitPlacementTarget).toHaveBeenCalledTimes(1);
    expect(runtime.updateHover).not.toHaveBeenCalled();
    expect(runtime.updatePlacementGhost).not.toHaveBeenCalled();
    expect(runtime.selectHovered).not.toHaveBeenCalled();
  });

  it('locks the displayed ghost target on pointer down instead of retargeting to the clicked board', () => {
    const upperOperation = {
      kind: 'wall',
      action: 'place',
      cell: { x: 1, y: 1, z: 1 },
      edge: 'east'
    };
    const lowerOperation = {
      kind: 'wall',
      action: 'place',
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east'
    };
    const onCommitOperations = jest.fn();
    const runtime = createRuntimeHarness({
      placementTarget: {
        kind: 'wall',
        operation: upperOperation
      },
      pointerState: null,
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        onCommitOperations
      },
      renderer: {
        domElement: {
          setPointerCapture: jest.fn(),
          releasePointerCapture: jest.fn()
        }
      },
      commitPlacementTarget: CityChannelThreeRuntime.prototype.commitPlacementTarget,
      clearPlacementGhost: jest.fn(),
      requestRender: jest.fn()
    });

    CityChannelThreeRuntime.prototype.handlePointerDown.call(runtime, pointerDownEvent);
    runtime.placementTarget = {
      kind: 'wall',
      operation: lowerOperation
    };
    CityChannelThreeRuntime.prototype.handlePointerUp.call(runtime, pointerUpEvent);

    expect(runtime.updateHover).not.toHaveBeenCalled();
    expect(runtime.updatePlacementGhost).not.toHaveBeenCalled();
    expect(onCommitOperations).toHaveBeenCalledWith([upperOperation], {
      label: '3D 放置竖板'
    });
  });

  it('does not select the hovered board while tile placement mode owns the pointer', () => {
    const runtime = createRuntimeHarness();

    CityChannelThreeRuntime.prototype.handlePointerUp.call(runtime, pointerUpEvent);

    expect(runtime.commitPlacementTarget).toHaveBeenCalledTimes(2);
    expect(runtime.updateHover).toHaveBeenCalledTimes(1);
    expect(runtime.updatePlacementGhost).toHaveBeenCalledTimes(1);
    expect(runtime.selectHovered).not.toHaveBeenCalled();
  });

  it('does not select boards while carry preview owns the pointer', () => {
    const runtime = createRuntimeHarness({
      carryState: { mode: 'move' },
      config: {
        activeTool: CITY_CHANNEL_TOOLS.SELECT
      }
    });

    CityChannelThreeRuntime.prototype.handlePointerUp.call(runtime, pointerUpEvent);

    expect(runtime.commitCarryTarget).toHaveBeenCalledTimes(1);
    expect(runtime.updateCarryGhost).toHaveBeenCalledTimes(1);
    expect(runtime.selectHovered).not.toHaveBeenCalled();
  });
});

describe('CityChannelThreeRuntime placement rendering', () => {
  const createRenderRuntimeHarness = () => ({
    config: {
      wallViewMode: 'semi'
    },
    getPlacementRenderOrder: CityChannelThreeRuntime.prototype.getPlacementRenderOrder,
    materials: {
      getMaterial: jest.fn(() => new THREE.MeshStandardMaterial())
    }
  });

  const createDetailRuntimeHarness = () => {
    const sharedMaterial = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    const gearGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.04, 8);
    return {
      worldGroup: new THREE.Group(),
      pickables: [],
      transmissionNodeGeometry: new THREE.SphereGeometry(0.052, 8, 6),
      transmissionNodeMaterial: sharedMaterial,
      transmissionGlowMaterial: sharedMaterial,
      transmissionCoreMaterial: sharedMaterial,
      transmissionMaterial: new THREE.LineBasicMaterial(),
      gearGeometry,
      gearMaterial: sharedMaterial,
      gearSpokeGeometry: new THREE.BoxGeometry(0.2, 0.03, 0.02),
      gearHubGeometry: new THREE.CylinderGeometry(0.04, 0.04, 0.08, 8),
      gearAxleGeometry: new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8),
      gearInnerRingGeometry: new THREE.TorusGeometry(0.06, 0.006, 4, 12),
      gearOuterRingGeometry: new THREE.TorusGeometry(0.09, 0.006, 4, 12),
      gearHaloGeometry: new THREE.RingGeometry(0.11, 0.13, 12),
      gearTimingMarkerGeometry: new THREE.SphereGeometry(0.018, 8, 6),
      gearEdgeGeometry: new THREE.EdgesGeometry(gearGeometry),
      gearBindingInvalidBadgeRingGeometry: new THREE.RingGeometry(0.052, 0.078, 12),
      gearBindingInvalidBadgeFillGeometry: new THREE.CircleGeometry(0.052, 12),
      gearBindingInvalidStemGeometry: new THREE.BoxGeometry(0.018, 0.012, 0.056),
      gearBindingInvalidDotGeometry: new THREE.SphereGeometry(0.012, 8, 6),
      gearSpokeMaterial: sharedMaterial,
      gearHubMaterial: sharedMaterial,
      gearAxleMaterial: sharedMaterial,
      gearEdgeMaterial: new THREE.LineBasicMaterial({ depthTest: false, depthWrite: false }),
      gearReliefMaterial: sharedMaterial,
      gearHaloMaterial: sharedMaterial,
      gearTimingMarkerMaterial: sharedMaterial,
      gearBindingInvalidMaterial: sharedMaterial,
      gearBindingInvalidFillMaterial: sharedMaterial,
      gearBindingInvalidGlowMaterial: sharedMaterial,
      markerGeometry: new THREE.CylinderGeometry(0.12, 0.12, 0.28, 8),
      entranceMarkerMaterial: sharedMaterial,
      exitMarkerMaterial: sharedMaterial,
      addPlacementDetails: CityChannelThreeRuntime.prototype.addPlacementDetails,
      addTransmissionLines: CityChannelThreeRuntime.prototype.addTransmissionLines,
      addTransmissionTube: CityChannelThreeRuntime.prototype.addTransmissionTube,
      addGearMounts: CityChannelThreeRuntime.prototype.addGearMounts,
      getGearRenderOrder: CityChannelThreeRuntime.prototype.getGearRenderOrder,
      markSharedGearObject: CityChannelThreeRuntime.prototype.markSharedGearObject,
      createGearDetailMesh: CityChannelThreeRuntime.prototype.createGearDetailMesh,
      createGearDetailLine: CityChannelThreeRuntime.prototype.createGearDetailLine,
      getBasePlacementForTransform: CityChannelThreeRuntime.prototype.getBasePlacementForTransform,
      getGearBindingStatusForMount: CityChannelThreeRuntime.prototype.getGearBindingStatusForMount,
      getGearBindingWarningMessage: CityChannelThreeRuntime.prototype.getGearBindingWarningMessage,
      createGearBindingInvalidBadge: CityChannelThreeRuntime.prototype.createGearBindingInvalidBadge,
      addGearBindingInvalidBadge: CityChannelThreeRuntime.prototype.addGearBindingInvalidBadge,
      addGearVisualDetails: CityChannelThreeRuntime.prototype.addGearVisualDetails,
      addMarker: CityChannelThreeRuntime.prototype.addMarker,
      getGearSurfaceQuaternion: CityChannelThreeRuntime.prototype.getGearSurfaceQuaternion,
      getRuntimeGearState: CityChannelThreeRuntime.prototype.getRuntimeGearState,
      getGearQuaternion: CityChannelThreeRuntime.prototype.getGearQuaternion,
      renderModel: { mapData: { tiles: {}, walls: {} } },
      mechanismRuntimeSnapshot: null
    };
  };
  const createOverlayRuntimeHarness = () => ({
    worldGroup: new THREE.Group(),
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(),
    renderer: {
      render: jest.fn()
    },
    ghostGeometry: new THREE.BoxGeometry(1, 1, 1),
    hoverMaterial: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.34 }),
    hoverOutlineMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.98 }),
    hoverGlowMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.56 }),
    selectionMaterial: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42 }),
    selectionOutlineMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 1 }),
    selectionGlowMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.86 }),
    selectedMeshes: [],
    selectionOverlays: [],
    hoverMesh: null,
    createBoardOverlayGroup: CityChannelThreeRuntime.prototype.createBoardOverlayGroup,
    syncOverlayEdgeGeometry: CityChannelThreeRuntime.prototype.syncOverlayEdgeGeometry,
    syncBoardOverlayGroup: CityChannelThreeRuntime.prototype.syncBoardOverlayGroup,
    updateGearBindingOverlay: jest.fn(),
    updateMechanismObstructionFlash: jest.fn()
  });
  const createGhostRuntimeHarness = () => {
    const sharedMaterial = new THREE.MeshBasicMaterial();
    return {
      ghostValidMaterial: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.48 }),
      ghostInvalidMaterial: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4 }),
      ghostValidOutlineMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 1 }),
      ghostInvalidOutlineMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 1 }),
      transmissionNodeGeometry: new THREE.SphereGeometry(0.052, 8, 6),
      transmissionNodeMaterial: sharedMaterial,
      transmissionGlowMaterial: sharedMaterial,
      transmissionCoreMaterial: sharedMaterial,
      gearGeometry: new THREE.CylinderGeometry(0.1, 0.1, 0.04, 8),
      gearBindingActiveMaterial: sharedMaterial,
      gearSocketMarkerGeometry: new THREE.SphereGeometry(0.035, 8, 6),
      gearBindingCandidateMaterial: sharedMaterial,
      getPlacementRenderOrder: CityChannelThreeRuntime.prototype.getPlacementRenderOrder,
      createTransmissionTubeMesh: CityChannelThreeRuntime.prototype.createTransmissionTubeMesh,
      getGearSurfaceQuaternion: CityChannelThreeRuntime.prototype.getGearSurfaceQuaternion
    };
  };

  it('does not let lower transparent walls write depth over upper stacked walls', () => {
    const runtime = createRenderRuntimeHarness();
    const lowerTransform = {
      kind: 'wall',
      key: '0:1:1:east',
      panelType: 'basic_plate',
      size: { x: 0.08, y: 1, z: 1 },
      position: { x: 0, y: 0.5, z: 0 },
      placement: { x: 1, y: 1, z: 0, edge: 'east' }
    };
    const upperTransform = {
      ...lowerTransform,
      key: '1:1:1:east',
      position: { x: 0, y: 1.5, z: 0 },
      placement: { x: 1, y: 1, z: 1, edge: 'east' }
    };

    const lowerMesh = CityChannelThreeRuntime.prototype.createPlacementMesh.call(runtime, lowerTransform);
    const upperMesh = CityChannelThreeRuntime.prototype.createPlacementMesh.call(runtime, upperTransform);

    expect(lowerMesh.material.every((material) => (
      material.transparent
      && material.depthWrite === false
      && material.depthTest === false
    ))).toBe(true);
    expect(upperMesh.renderOrder).toBeGreaterThan(lowerMesh.renderOrder);
  });

  it('renders stacked vertical tiles with explicit transparent depth ordering', () => {
    const runtime = createRenderRuntimeHarness();
    const lowerTransform = {
      kind: 'verticalTile',
      key: createCellKey(1, 1, 0),
      panelType: 'basic_plate',
      size: { x: 1, y: 1, z: 0.08 },
      position: { x: 0, y: 0.5, z: 0 },
      placement: { x: 1, y: 1, z: 0, isVertical: true }
    };
    const upperTransform = {
      ...lowerTransform,
      key: createCellKey(1, 1, 1),
      position: { x: 0, y: 1.5, z: 0 },
      placement: { x: 1, y: 1, z: 1, isVertical: true }
    };

    const lowerMesh = CityChannelThreeRuntime.prototype.createPlacementMesh.call(runtime, lowerTransform);
    const upperMesh = CityChannelThreeRuntime.prototype.createPlacementMesh.call(runtime, upperTransform);

    expect(lowerMesh.material.every((material) => (
      material.transparent
      && material.depthWrite === false
      && material.depthTest === false
    ))).toBe(true);
    expect(upperMesh.renderOrder).toBeGreaterThan(lowerMesh.renderOrder);
  });

  it('keeps placement detail meshes in the same render layer as their board', () => {
    const runtime = createDetailRuntimeHarness();
    const detailOrder = 422;
    const transform = {
      kind: 'wall',
      key: '0:1:1:east',
      edge: 'east',
      panelType: 'basic_plate',
      size: { x: 0.08, y: 1, z: 1 },
      position: { x: 0, y: 0.5, z: 0 },
      placement: {
        x: 1,
        y: 1,
        z: 1,
        edge: 'east',
        panelType: 'basic_plate',
        transmissionSkeleton: {
          ports: [{
            id: 'east',
            localPosition: { x: 0.35, y: 0 }
          }]
        },
        gearMounts: [{
          id: 'gear_1',
          position: 'center',
          surface: 'front'
        }]
      }
    };

    CityChannelThreeRuntime.prototype.addPlacementDetails.call(runtime, transform, detailOrder);

    expect(runtime.worldGroup.children.length).toBeGreaterThan(0);
    expect(runtime.worldGroup.children.every((child) => child.renderOrder >= detailOrder)).toBe(true);
    expect(runtime.pickables.every((child) => child.renderOrder >= detailOrder)).toBe(true);
    const gear = runtime.pickables.find((child) => child.userData?.cityChannel?.kind === 'gear');
    expect(gear.material.depthTest).toBe(false);
    expect(gear.children.map((child) => child.userData.cityChannelGearRole)).toEqual(expect.arrayContaining([
      'halo',
      'spoke_0',
      'hub',
      'axle',
      'timing_marker',
      'tooth_edges'
    ]));
    expect(gear.renderOrder).toBeGreaterThan(detailOrder + 3);
  });

  it('shows an invalid binding badge when a bound board was deleted', () => {
    const runtime = createDetailRuntimeHarness();
    const hostKey = createCellKey(1, 1, 0);
    const transform = {
      kind: 'tile',
      key: hostKey,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      size: { x: 1, y: 0.16, z: 1 },
      position: { x: 0, y: 0, z: 0 },
      placement: {
        x: 1,
        y: 1,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
        gearMounts: [{
          id: 'gear_stale',
          position: 'corner_ne',
          surface: 'front',
          axisBinding: {
            hostKind: 'tile',
            componentKey: createCellKey(2, 0, 0),
            socket: 'corner_sw',
            surface: 'front'
          }
        }]
      }
    };
    runtime.renderModel.mapData = {
      tiles: {
        [hostKey]: transform.placement
      },
      walls: {}
    };

    CityChannelThreeRuntime.prototype.addGearMounts.call(runtime, transform, 420);

    const gear = runtime.pickables.find((child) => child.userData?.cityChannel?.kind === 'gear');
    expect(gear.userData.cityChannel).toMatchObject({
      axisBindingInvalid: true,
      axisBindingInvalidReason: 'missing_component',
      axisBindingWarning: '齿轮连轴失效：被绑定板材已删除'
    });
    expect(gear.children.map((child) => child.userData.cityChannelGearRole))
      .toEqual(expect.arrayContaining(['binding_invalid_badge']));
  });

  it('renders selected and hovered boards with fill plus outline overlays', () => {
    const runtime = createOverlayRuntimeHarness();
    const selectedMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 1), new THREE.MeshBasicMaterial());
    selectedMesh.position.set(1, 0.04, 1);
    const hoverMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 1), new THREE.MeshBasicMaterial());
    hoverMesh.position.set(2, 0.5, 1);
    runtime.selectedMeshes = [selectedMesh];
    runtime.hoverMesh = hoverMesh;

    CityChannelThreeRuntime.prototype.render.call(runtime);

    expect(runtime.selectionMaterial.opacity).toBeGreaterThanOrEqual(0.4);
    expect(runtime.hoverMaterial.opacity).toBeGreaterThanOrEqual(0.3);
    expect(runtime.selectionOverlays[0]).toBeInstanceOf(THREE.Group);
    expect(runtime.selectionOverlays[0].userData.fill.visible).toBe(true);
    expect(runtime.selectionOverlays[0].userData.outline).toBeInstanceOf(THREE.LineSegments);
    expect(runtime.selectionOverlays[0].userData.glow.renderOrder)
      .toBeGreaterThan(runtime.selectionOverlays[0].userData.fill.renderOrder);
    expect(runtime.hoverOverlayGroup.userData.outline).toBeInstanceOf(THREE.LineSegments);
    expect(runtime.hoverOverlayGroup.userData.fill.visible).toBe(true);
  });

  it('creates placement ghosts with stronger fill and explicit outline render order', () => {
    const runtime = createGhostRuntimeHarness();
    const transform = {
      kind: 'wall',
      key: '0:1:1:east',
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      size: { x: 0.08, y: 1, z: 1 },
      position: { x: 0, y: 0.5, z: 0 },
      placement: {
        x: 1,
        y: 1,
        z: 0,
        edge: 'east',
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }
    };

    const group = CityChannelThreeRuntime.prototype.createBoardGhostGroup.call(runtime, transform, {
      valid: true
    });

    expect(group.children[0].material.opacity).toBeGreaterThanOrEqual(0.45);
    expect(group.children[1].material).toBe(runtime.ghostValidOutlineMaterial);
    expect(group.children[1].renderOrder).toBeGreaterThan(group.children[0].renderOrder);
  });
});

describe('CityChannelThreeRuntime gear transmission', () => {
  const createTransmissionRuntimeHarness = (mapData) => ({
    renderModel: buildCityChannelThreeRenderModel(mapData),
    getBasePlacementTransform: CityChannelThreeRuntime.prototype.getBasePlacementTransform,
    getGearHostKindAndPlacement: CityChannelThreeRuntime.prototype.getGearHostKindAndPlacement,
    getGearNodesForMounts: CityChannelThreeRuntime.prototype.getGearNodesForMounts,
    getAllGearNodes: CityChannelThreeRuntime.prototype.getAllGearNodes,
    getAssemblyGearNodes: CityChannelThreeRuntime.prototype.getAssemblyGearNodes,
    resolveDrivenGearNodes: CityChannelThreeRuntime.prototype.resolveDrivenGearNodes,
    getGearRotationTransmissionEventKeys: CityChannelThreeRuntime.prototype.getGearRotationTransmissionEventKeys,
    createAxisBindingRuntimeEntries: CityChannelThreeRuntime.prototype.createAxisBindingRuntimeEntries,
    createFixedAxisRuntimeEntry: CityChannelThreeRuntime.prototype.createFixedAxisRuntimeEntry,
    getBasePlacementsForAssembly: CityChannelThreeRuntime.prototype.getBasePlacementsForAssembly,
    createRuntimeSnapshotForMechanism: CityChannelThreeRuntime.prototype.createRuntimeSnapshotForMechanism,
    triggerMechanismAtCell: CityChannelThreeRuntime.prototype.triggerMechanismAtCell
  });

  const createMeshedGearMap = () => {
    const sourceKey = createCellKey(1, 1, 0);
    const drivenKey = createCellKey(2, 1, 0);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    source.gearMounts = [{
      id: 'gear_center',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 10
    }];
    const driven = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    driven.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_nw',
      socketKind: 'corner',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [drivenKey]: driven
      },
      walls: {}
    };

    return {
      sourceKey,
      drivenKey,
      source,
      driven,
      mapData
    };
  };

  const createLinkedGearMap = () => {
    const sourceKey = createCellKey(1, 1, 0);
    const driverKey = createCellKey(2, 1, 0);
    const boundKey = createCellKey(1, 0, 0);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    source.gearMounts = [{
      id: 'gear_center',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const driver = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    driver.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_nw',
      socketKind: 'corner',
      surface: 'front',
      teeth: 18,
      phase: 0,
      axisBinding: {
        hostKind: 'tile',
        componentKey: boundKey,
        socket: 'corner_se',
        surface: 'front'
      }
    }];
    const bound = createTile({
      x: 1,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [driverKey]: driver,
        [boundKey]: bound
      },
      walls: {}
    };

    return {
      sourceKey,
      driverKey,
      boundKey,
      source,
      driver,
      bound,
      mapData
    };
  };

  const createBoundCornerGearMap = () => {
    const sourceKey = createCellKey(1, 1, 0);
    const drivenKey = createCellKey(2, 1, 0);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    source.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_ne',
      socketKind: 'corner',
      surface: 'front',
      axisBinding: {
        hostKind: 'tile',
        componentKey: drivenKey,
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const driven = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [drivenKey]: driven
      },
      walls: {}
    };

    return {
      sourceKey,
      drivenKey,
      source,
      driven,
      mapData
    };
  };

  const createBindingVisualRuntimeHarness = (mapData) => {
    const renderModel = buildCityChannelThreeRenderModel(mapData);
    const runtime = {
      renderModel,
      overlayGroup: new THREE.Group(),
      gearBindingMarkerGeometry: new THREE.SphereGeometry(0.055, 8, 6),
      gearBindingArrowGeometry: new THREE.ConeGeometry(0.055, 0.16, 8),
      gearHaloGeometry: new THREE.RingGeometry(0.12, 0.16, 12),
      gearBindingCandidateMaterial: new THREE.MeshBasicMaterial(),
      gearBindingActiveMaterial: new THREE.MeshBasicMaterial(),
      gearBindingAmbientCurveMaterial: new THREE.MeshBasicMaterial(),
      gearBindingAmbientGlowMaterial: new THREE.MeshBasicMaterial(),
      gearBindingAmbientBoardMaterial: new THREE.MeshBasicMaterial(),
      gearBindingAmbientOutlineMaterial: new THREE.LineBasicMaterial(),
      gearBindingActiveCurveMaterial: new THREE.MeshBasicMaterial(),
      gearBindingActiveGlowMaterial: new THREE.MeshBasicMaterial(),
      gearBindingActiveBoardMaterial: new THREE.MeshBasicMaterial(),
      gearBindingActiveOutlineMaterial: new THREE.LineBasicMaterial(),
      gearBindingInvalidMaterial: new THREE.MeshBasicMaterial(),
      gearBindingInvalidFillMaterial: new THREE.MeshBasicMaterial(),
      gearBindingInvalidGlowMaterial: new THREE.MeshBasicMaterial(),
      gearBindingInvalidBoardMaterial: new THREE.MeshBasicMaterial(),
      gearBindingInvalidOutlineMaterial: new THREE.LineBasicMaterial(),
      gearBindingInvalidBadgeRingGeometry: new THREE.RingGeometry(0.052, 0.078, 12),
      gearBindingInvalidBadgeFillGeometry: new THREE.CircleGeometry(0.052, 12),
      gearBindingInvalidStemGeometry: new THREE.BoxGeometry(0.018, 0.012, 0.056),
      gearBindingInvalidDotGeometry: new THREE.SphereGeometry(0.012, 8, 6),
      getVisiblePlacementTransforms: CityChannelThreeRuntime.prototype.getVisiblePlacementTransforms,
      getGearBindingSurfacesForPlacement: CityChannelThreeRuntime.prototype.getGearBindingSurfacesForPlacement,
      isSameThreePoint: CityChannelThreeRuntime.prototype.isSameThreePoint,
      getGearBindingCandidateKey: CityChannelThreeRuntime.prototype.getGearBindingCandidateKey,
      isSameGearBindingCandidate: CityChannelThreeRuntime.prototype.isSameGearBindingCandidate,
      getGearBindingWarningMessage: CityChannelThreeRuntime.prototype.getGearBindingWarningMessage,
      getGearBindingCandidateFromBinding: CityChannelThreeRuntime.prototype.getGearBindingCandidateFromBinding,
      getGearBindingBoardFocusPoint: CityChannelThreeRuntime.prototype.getGearBindingBoardFocusPoint,
      getGearBindingCurveControl: CityChannelThreeRuntime.prototype.getGearBindingCurveControl,
      getGearBindingCandidateVisual: CityChannelThreeRuntime.prototype.getGearBindingCandidateVisual,
      createGearBindingCurveMesh: CityChannelThreeRuntime.prototype.createGearBindingCurveMesh,
      addDashedGearBindingCurve: CityChannelThreeRuntime.prototype.addDashedGearBindingCurve,
      addGearBindingBoardOverlay: CityChannelThreeRuntime.prototype.addGearBindingBoardOverlay,
      addGearBindingEndpointMarker: CityChannelThreeRuntime.prototype.addGearBindingEndpointMarker,
      addGearBindingArrow: CityChannelThreeRuntime.prototype.addGearBindingArrow,
      markSharedGearObject: CityChannelThreeRuntime.prototype.markSharedGearObject,
      createGearDetailMesh: CityChannelThreeRuntime.prototype.createGearDetailMesh,
      createGearBindingInvalidBadge: CityChannelThreeRuntime.prototype.createGearBindingInvalidBadge,
      addGearBindingInvalidBadge: CityChannelThreeRuntime.prototype.addGearBindingInvalidBadge,
      addGearBindingSourceMarker: CityChannelThreeRuntime.prototype.addGearBindingSourceMarker,
      addGearBindingVisual: CityChannelThreeRuntime.prototype.addGearBindingVisual,
      addGearBindingInvalidWarning: CityChannelThreeRuntime.prototype.addGearBindingInvalidWarning,
      getAmbientGearBindingVisuals: CityChannelThreeRuntime.prototype.getAmbientGearBindingVisuals,
      createTransmissionTubeMesh: CityChannelThreeRuntime.prototype.createTransmissionTubeMesh,
      getGearSurfaceQuaternion: CityChannelThreeRuntime.prototype.getGearSurfaceQuaternion
    };
    runtime.pickables = [...renderModel.tiles, ...renderModel.walls].map((transform) => ({
      userData: {
        cityChannel: {
          kind: transform.kind,
          key: transform.key,
          placement: transform.placement,
          transform
        }
      }
    }));
    return runtime;
  };

  it('uses board-scale gear contact to drive a center gear into an intersection gear', () => {
    const {
      sourceKey,
      drivenKey,
      source,
      mapData
    } = createMeshedGearMap();
    const runtime = createTransmissionRuntimeHarness(mapData);
    const assemblyGraph = buildMechanicalAssemblies(mapData);
    const assembly = getAssemblyForCell(assemblyGraph, sourceKey);
    const nodes = CityChannelThreeRuntime.prototype.resolveDrivenGearNodes.call(runtime, assembly, sourceKey);
    const snapshot = CityChannelThreeRuntime.prototype.createRuntimeSnapshotForMechanism.call(runtime, {
      key: sourceKey,
      tile: source,
      gearNodes: nodes,
      sourceAngle: 90,
      basePhases: new Map(nodes.map((node) => [node.id, Number(node.mount?.phase) || 0]))
    });

    expect(nodes.map((node) => node.id)).toEqual([`${sourceKey}:gear_center`, `${drivenKey}:gear_corner`]);
    expect(nodes.map((node) => node.driveRatio)).toEqual([1, -1]);
    expect(snapshot.gears[`${sourceKey}:gear_center`]).toMatchObject({ phase: 100, speedRatio: 1 });
    expect(snapshot.gears[`${drivenKey}:gear_corner`]).toMatchObject({ phase: 270, speedRatio: -1 });
    expect(snapshot.placements).toEqual({});
  });

  it('drives a linked board from a bound intersection gear', () => {
    const {
      sourceKey,
      driverKey,
      boundKey,
      mapData
    } = createLinkedGearMap();
    const runtime = {
      ...createTransmissionRuntimeHarness(mapData),
      config: {
        mechanismParams: {},
        onToast: jest.fn()
      },
      mechanismRuntimeSnapshot: null,
      cancelMechanismRuntimePreview: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(function setMechanismRuntimeSnapshot(snapshot) {
        this.mechanismRuntimeSnapshot = snapshot;
      }),
      playMechanismRuntimePreview: jest.fn(function playMechanismRuntimePreview(args) {
        const basePhases = new Map(args.gearNodes.map((node) => [node.id, Number(node.mount?.phase) || 0]));
        this.setMechanismRuntimeSnapshot(this.createRuntimeSnapshotForMechanism({
          ...args,
          sourceAngle: args.targetAngle,
          basePhases
        }));
      }),
      flashMechanismObstruction: jest.fn()
    };

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 1, z: 0 }, {
      rotationAngle: 90,
      rotationDirection: 'right',
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(true);
    expect(runtime.playMechanismRuntimePreview).toHaveBeenCalledTimes(1);
    expect(runtime.mechanismRuntimeSnapshot.gears[`${sourceKey}:gear_center`]).toMatchObject({ phase: 90 });
    expect(runtime.mechanismRuntimeSnapshot.gears[`${driverKey}:gear_corner`]).toMatchObject({ phase: 270 });
    expect(runtime.mechanismRuntimeSnapshot.placements[boundKey]).toMatchObject({
      runtimeAxisBindingMountId: 'gear_corner',
      runtimeFixedMountId: 'gear_corner'
    });
    expect(runtime.mechanismRuntimeSnapshot.placements[boundKey].runtimeAngle).not.toBe(0);
  });

  it('drives every board in an axis-bound transmission assembly as one rigid body', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const driverKey = createCellKey(2, 1, 0);
    const boundKey = createCellKey(1, 0, 0);
    const linkedKey = createCellKey(2, 0, 0);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    source.gearMounts = [{
      id: 'gear_center',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const driver = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    driver.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_nw',
      socketKind: 'corner',
      surface: 'front',
      teeth: 18,
      phase: 0,
      axisBinding: {
        hostKind: 'tile',
        componentKey: boundKey,
        socket: 'corner_se',
        surface: 'front'
      }
    }];
    const bound = createTile({
      x: 1,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    const linked = createTile({
      x: 2,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 90
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [driverKey]: driver,
        [boundKey]: bound,
        [linkedKey]: linked
      },
      walls: {}
    };
    const assemblyGraph = buildMechanicalAssemblies(mapData);
    expect(assemblyGraph.assemblyByComponentKey[boundKey]).toBe(assemblyGraph.assemblyByComponentKey[linkedKey]);

    const runtime = {
      ...createTransmissionRuntimeHarness(mapData),
      config: {
        mechanismParams: {},
        onToast: jest.fn()
      },
      mechanismRuntimeSnapshot: null,
      cancelMechanismRuntimePreview: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(function setMechanismRuntimeSnapshot(snapshot) {
        this.mechanismRuntimeSnapshot = snapshot;
      }),
      playMechanismRuntimePreview: jest.fn(function playMechanismRuntimePreview(args) {
        const basePhases = new Map(args.gearNodes.map((node) => [node.id, Number(node.mount?.phase) || 0]));
        this.setMechanismRuntimeSnapshot(this.createRuntimeSnapshotForMechanism({
          ...args,
          sourceAngle: args.targetAngle,
          basePhases
        }));
      }),
      flashMechanismObstruction: jest.fn()
    };

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 1, z: 0 }, {
      rotationAngle: 90,
      rotationDirection: 'right',
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    const snapshot = runtime.mechanismRuntimeSnapshot;
    expect(played).toBe(true);
    expect(snapshot.placements[boundKey]).toMatchObject({
      runtimeAxisBindingMountId: 'gear_corner',
      runtimeFixedMountId: 'gear_corner'
    });
    expect(snapshot.placements[linkedKey]).toMatchObject({
      runtimeAxisBindingMountId: 'gear_corner',
      runtimeFixedMountId: 'gear_corner'
    });
    expect(snapshot.placements[linkedKey].runtimeAngle).toBeCloseTo(snapshot.placements[boundKey].runtimeAngle, 5);
    expect(snapshot.placements[linkedKey].rotation).toBe(snapshot.placements[boundKey].rotation);
    expect(runtime.config.onToast).toHaveBeenLastCalledWith(expect.stringContaining('2 块板材'), 'success');
  });

  it('renders active contact cues between meshed gears', () => {
    const {
      sourceKey,
      drivenKey,
      mapData
    } = createMeshedGearMap();
    const runtime = {
      ...createTransmissionRuntimeHarness(mapData),
      worldGroup: new THREE.Group(),
      mechanismRuntimeSnapshot: {
        sourceAngle: 45,
        gears: {
          [`${sourceKey}:gear_center`]: { phase: 45, speedRatio: 1 }
        }
      },
      gearContactMarkerGeometry: new THREE.SphereGeometry(0.05, 8, 6),
      gearContactMaterial: new THREE.MeshBasicMaterial(),
      gearContactActiveMaterial: new THREE.MeshBasicMaterial(),
      getRuntimeTransform: CityChannelThreeRuntime.prototype.getRuntimeTransform,
      getRuntimeGearState: CityChannelThreeRuntime.prototype.getRuntimeGearState,
      getRuntimeGearSurfacePointForNode: CityChannelThreeRuntime.prototype.getRuntimeGearSurfacePointForNode,
      addGearContactVisuals: CityChannelThreeRuntime.prototype.addGearContactVisuals,
      addTransmissionTube: CityChannelThreeRuntime.prototype.addTransmissionTube
    };

    CityChannelThreeRuntime.prototype.addGearContactVisuals.call(runtime, new Set([sourceKey, drivenKey]));

    const marker = runtime.worldGroup.children.find((child) => child.geometry === runtime.gearContactMarkerGeometry);
    const activeTube = runtime.worldGroup.children.find((child) => (
      child.geometry !== runtime.gearContactMarkerGeometry
      && child.material === runtime.gearContactActiveMaterial
    ));
    expect(marker.material).toBe(runtime.gearContactActiveMaterial);
    expect(marker.scale.x).toBeGreaterThan(0.9);
    expect(activeTube).toBeInstanceOf(THREE.Mesh);
  });

  it('renders bound corner gears as curved links to their driven board', () => {
    const { mapData } = createBoundCornerGearMap();
    const runtime = createBindingVisualRuntimeHarness(mapData);

    const visuals = CityChannelThreeRuntime.prototype.getAmbientGearBindingVisuals.call(runtime);
    expect(visuals).toHaveLength(1);

    CityChannelThreeRuntime.prototype.addGearBindingVisual.call(runtime, visuals[0].context, visuals[0].candidate, {
      ambient: true
    });
    expect(runtime.overlayGroup.children.map((child) => child.userData.cityChannelGearRole))
      .toEqual(expect.arrayContaining([
        'binding_board_ambient',
        'binding_board_outline_ambient',
        'binding_curve_dash',
        'binding_endpoint_ambient',
        'binding_source_ambient'
      ]));

    runtime.overlayGroup.clear();
    CityChannelThreeRuntime.prototype.addGearBindingVisual.call(runtime, visuals[0].context, visuals[0].candidate, {
      active: true,
      hovered: true
    });
    const activeCurve = runtime.overlayGroup.children.find((child) => child.userData.cityChannelGearRole === 'binding_curve');
    expect(activeCurve.geometry).toBeInstanceOf(THREE.TubeGeometry);
    expect(runtime.overlayGroup.children.map((child) => child.userData.cityChannelGearRole))
      .toEqual(expect.arrayContaining([
        'binding_board_active',
        'binding_board_outline_active',
        'binding_arrow',
        'binding_endpoint_active',
        'binding_source_active'
      ]));
  });

  it('keeps stale gear bindings visible as invalid ambient warnings', () => {
    const {
      sourceKey,
      source,
      mapData
    } = createBoundCornerGearMap();
    const staleMapData = {
      ...mapData,
      tiles: {
        [sourceKey]: source
      }
    };
    const runtime = createBindingVisualRuntimeHarness(staleMapData);

    const visuals = CityChannelThreeRuntime.prototype.getAmbientGearBindingVisuals.call(runtime);
    expect(visuals).toHaveLength(1);
    expect(visuals[0]).toMatchObject({
      invalid: true,
      status: {
        reason: 'missing_component'
      }
    });

    CityChannelThreeRuntime.prototype.addGearBindingInvalidWarning.call(runtime, visuals[0].context, visuals[0].status, {
      candidate: visuals[0].candidate
    });

    expect(runtime.overlayGroup.children.map((child) => child.userData.cityChannelGearRole))
      .toEqual(expect.arrayContaining([
        'binding_source_invalid',
        'binding_invalid_badge'
      ]));
  });
});

describe('CityChannelThreeRuntime mechanism preview cancellation', () => {
  it('cancels a mechanism preview when interaction config changes', () => {
    const runtime = {
      config: {
        activeTool: CITY_CHANNEL_TOOLS.BROWSE,
        activeTileType: null,
        activeComponentType: null,
        activeRotation: 0,
        activeLayer: 0,
        panelPose: 'floor'
      },
      renderModel: {
        mapData: { tiles: {}, walls: {} }
      },
      mechanismRuntimeSnapshot: { placements: {}, gears: {} },
      mechanismPreviewFrame: null,
      mechanismPreviewTimer: null,
      hasMechanismRuntimePreview: CityChannelThreeRuntime.prototype.hasMechanismRuntimePreview,
      shouldCancelMechanismRuntimePreviewForConfig: CityChannelThreeRuntime.prototype.shouldCancelMechanismRuntimePreviewForConfig,
      cancelMechanismRuntimePreview: jest.fn(function cancelMechanismRuntimePreview() {
        this.mechanismRuntimeSnapshot = null;
        return true;
      }),
      setConfig: jest.fn(function setConfig(next) {
        this.config = { ...this.config, ...next };
      }),
      setMapData: jest.fn(),
      rebuildMap: jest.fn()
    };

    CityChannelThreeRuntime.prototype.updateConfig.call(runtime, {
      activeTool: CITY_CHANNEL_TOOLS.SELECT
    });

    expect(runtime.cancelMechanismRuntimePreview).toHaveBeenCalledTimes(1);
    expect(runtime.config.activeTool).toBe(CITY_CHANNEL_TOOLS.SELECT);
  });

  it('keeps a mechanism preview while using WASDQE camera keys', () => {
    const event = {
      key: 'w',
      preventDefault: jest.fn()
    };
    const runtime = {
      config: {},
      keyState: new Set(),
      isEditableKeyboardTarget: jest.fn(() => false),
      startKeyboardNavigation: jest.fn(),
      cancelMechanismRuntimePreview: jest.fn()
    };

    CityChannelThreeRuntime.prototype.handleKeyDown.call(runtime, event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(runtime.keyState.has('w')).toBe(true);
    expect(runtime.startKeyboardNavigation).toHaveBeenCalledTimes(1);
    expect(runtime.cancelMechanismRuntimePreview).not.toHaveBeenCalled();
  });

  it('creates a red flash overlay for mechanism obstructions', () => {
    const obstacleKey = createCellKey(2, 2, 0);
    const obstacle = createTile({
      x: 2,
      y: 2,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [obstacleKey]: obstacle
      },
      walls: {}
    };
    const runtime = {
      renderModel: buildCityChannelThreeRenderModel(mapData),
      mechanismFlashGroup: new THREE.Group(),
      mechanismObstructionFillMaterial: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
      mechanismObstructionOutlineMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 0 }),
      mechanismObstructionGlowMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 0 }),
      mechanismObstructionFlash: null,
      requestRender: jest.fn(),
      getObstructionPlacementTransform: CityChannelThreeRuntime.prototype.getObstructionPlacementTransform,
      addObstructionFlashPlacement: CityChannelThreeRuntime.prototype.addObstructionFlashPlacement,
      clearMechanismObstructionFlash: CityChannelThreeRuntime.prototype.clearMechanismObstructionFlash,
      flashMechanismObstruction: CityChannelThreeRuntime.prototype.flashMechanismObstruction,
      updateMechanismObstructionFlash: CityChannelThreeRuntime.prototype.updateMechanismObstructionFlash
    };

    const flashed = CityChannelThreeRuntime.prototype.flashMechanismObstruction.call(runtime, {
      obstacle
    });

    expect(flashed).toBe(true);
    expect(runtime.mechanismFlashGroup.children.map((child) => child.userData.cityChannelGearRole))
      .toEqual(expect.arrayContaining([
        'mechanism_obstruction_fill',
        'mechanism_obstruction_glow',
        'mechanism_obstruction_outline'
      ]));
    expect(runtime.mechanismObstructionFillMaterial.opacity).toBeGreaterThan(0);
    expect(runtime.requestRender).toHaveBeenCalled();
  });
});

describe('CityChannelThreeRuntime selection box', () => {
  it('treats a selection rectangle crossing projected mesh bounds as selected', () => {
    const runtime = {
      getMeshScreenBounds: jest.fn(() => ({
        left: 100,
        top: 100,
        right: 220,
        bottom: 180
      })),
      doScreenRectsIntersect: CityChannelThreeRuntime.prototype.doScreenRectsIntersect
    };
    const mesh = {
      geometry: {
        boundingBox: {}
      }
    };

    const selected = CityChannelThreeRuntime.prototype.isMeshInsideSelectionRect.call(runtime, mesh, {
      left: 150,
      top: 80,
      right: 160,
      bottom: 220
    });

    expect(selected).toBe(true);
  });

  it('commits all intersected boards into board selection scope', () => {
    const tileMesh = {
      geometry: { boundingBox: {} },
      userData: {
        cityChannel: {
          kind: 'tile',
          placement: { x: 1, y: 1, z: 0 }
        }
      }
    };
    const wallMesh = {
      geometry: { boundingBox: {} },
      userData: {
        cityChannel: {
          kind: 'wall',
          placement: { x: 2, y: 1, z: 0, edge: 'east' }
        }
      }
    };
    const runtime = {
      config: {
        selection: { cells: [], walls: [], gears: [], scope: null }
      },
      pickables: [tileMesh, wallMesh],
      getSelectionBoxRect: jest.fn(() => ({
        left: 10,
        top: 10,
        right: 120,
        bottom: 120,
        width: 110,
        height: 110
      })),
      isMeshInsideSelectionRect: jest.fn(() => true),
      getPlacementSelectionFromData: CityChannelThreeRuntime.prototype.getPlacementSelectionFromData,
      emitSelection: jest.fn(function emitSelection(selection) {
        this.config.selection = selection;
      }),
      requestRender: jest.fn(),
      emitStatus: jest.fn()
    };

    const committed = CityChannelThreeRuntime.prototype.commitBoxSelection.call(runtime, {}, false);
    const emitted = runtime.emitSelection.mock.calls[0][0];

    expect(committed).toBe(true);
    expect(emitted.scope).toBe('board');
    expect(emitted.cells).toEqual([{ x: 1, y: 1, z: 0 }]);
    expect(emitted.walls).toEqual([{ x: 2, y: 1, z: 0, edge: 'east' }]);
  });
});

describe('CityChannelThreeRuntime snap candidates', () => {
  const createSnapRuntimeHarness = ({
    mapData,
    transform,
    point,
    faceNormal = null,
    config = {}
  }) => ({
    config: {
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      activeRotation: 0,
      panelPose: 'wall',
      ...config
    },
    renderModel: {
      mapData
    },
    hoverHit: {
      point,
      face: faceNormal ? {
        normal: new THREE.Vector3(faceNormal.x || 0, faceNormal.y || 0, faceNormal.z || 0)
      } : null,
      object: {
        matrixWorld: new THREE.Matrix4(),
        userData: {
          cityChannel: {
            kind: transform.kind,
            key: transform.key,
            placement: transform.placement,
            transform
          }
        }
      }
    },
    getVisiblePlacementTransforms: jest.fn(() => [transform]),
    getHoverPlacementData: CityChannelThreeRuntime.prototype.getHoverPlacementData,
    getHoverLocalPoint: CityChannelThreeRuntime.prototype.getHoverLocalPoint,
    getHoverSnapIntent: CityChannelThreeRuntime.prototype.getHoverSnapIntent,
    createSnapCandidate: CityChannelThreeRuntime.prototype.createSnapCandidate,
    chooseSnapCandidate: CityChannelThreeRuntime.prototype.chooseSnapCandidate,
    getHoverBoardSnapCandidates: CityChannelThreeRuntime.prototype.getHoverBoardSnapCandidates,
    getPlacementTargetFromHoverBoard: CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard,
    createReplacementTargetForPlacement: CityChannelThreeRuntime.prototype.createReplacementTargetForPlacement,
    createVerticalSideSnapTarget: CityChannelThreeRuntime.prototype.createVerticalSideSnapTarget,
    createVerticalSideFloorSnapTarget: CityChannelThreeRuntime.prototype.createVerticalSideFloorSnapTarget,
    createVerticalTopFloorSnapTarget: CityChannelThreeRuntime.prototype.createVerticalTopFloorSnapTarget,
    getVerticalSidePlacementCell: CityChannelThreeRuntime.prototype.getVerticalSidePlacementCell,
    getHoverVerticalSurfaceSide: CityChannelThreeRuntime.prototype.getHoverVerticalSurfaceSide,
    createVerticalTopSnapTarget: CityChannelThreeRuntime.prototype.createVerticalTopSnapTarget,
    createTileTarget: CityChannelThreeRuntime.prototype.createTileTarget,
    createWallTarget: CityChannelThreeRuntime.prototype.createWallTarget,
    getCellFromHorizontalEdge: CityChannelThreeRuntime.prototype.getCellFromHorizontalEdge
  });

  it('allows new placement to replace the center of an existing board', () => {
    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      tiles: {
        [createCellKey(1, 1, 0)]: createTile({
          x: 1,
          y: 1,
          z: 0,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        })
      },
      walls: {
        [createWallKey(1, 1, 0, 'east')]: wall
      }
    };
    const transform = getWallThreeTransform(wall, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: { ...transform.position }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: true
    });

    expect(target).toMatchObject({
      kind: 'wall',
      replace: true,
      snapKind: 'centerReplace',
      valid: true
    });
    expect(target.operation).toMatchObject({
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east'
    });
  });

  it('allows floor pose to replace the center of an existing horizontal board', () => {
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      tiles: {
        [createCellKey(1, 1, 0)]: tile
      }
    };
    const transform = getTileThreeTransform(tile, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: { ...transform.position },
      config: {
        panelPose: 'floor',
        activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        activeRotation: 90
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: true
    });

    expect(target).toMatchObject({
      kind: 'tile',
      replace: true,
      snapKind: 'centerReplace',
      valid: true
    });
    expect(target.operation).toMatchObject({
      kind: 'tile',
      cell: { x: 1, y: 1, z: 0 },
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      rotation: 0,
      transmissionRotation: 0
    });
  });

  it('does not create a replacement candidate while moving an existing board', () => {
    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      walls: {
        [createWallKey(1, 1, 0, 'east')]: wall
      }
    };
    const transform = getWallThreeTransform(wall, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: { ...transform.position }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false,
      preferWallPose: true
    });

    expect(target).toBeNull();
  });

  it('prioritizes the top edge of a vertical board as an upper snap candidate', () => {
    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      walls: {
        [createWallKey(1, 1, 0, 'east')]: wall
      }
    };
    const transform = getWallThreeTransform(wall, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x,
        y: transform.position.y + (transform.size.y * 0.5) - 0.02,
        z: transform.position.z
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false,
      preferWallPose: true
    });

    expect(target).toMatchObject({
      kind: 'wall',
      snapKind: 'verticalTop',
      valid: true,
      cell: { x: 1, y: 1, z: 1 },
      edge: 'east'
    });
  });

  it('keeps vertical hover snap direction even when active panel pose is floor', () => {
    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      walls: {
        [createWallKey(1, 1, 0, 'east')]: wall
      }
    };
    const transform = getWallThreeTransform(wall, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x,
        y: transform.position.y + (transform.size.y * 0.5) - 0.02,
        z: transform.position.z
      },
      faceNormal: { x: -1, y: 0, z: 0 },
      config: {
        panelPose: 'floor'
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false
    });

    expect(target).toMatchObject({
      kind: 'tile',
      snapKind: 'verticalTopFloor',
      valid: true,
      cell: { x: 1, y: 1, z: 1 }
    });
  });

  it('snaps vertical wall body hits to same-layer side continuation targets', () => {
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
    const transform = getWallThreeTransform(upperWall, mapData);
    const frontRuntime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x,
        y: transform.position.y,
        z: transform.position.z + 0.32
      },
      faceNormal: { x: 1, y: 0, z: 0 },
      config: {
        panelPose: 'floor'
      }
    });
    const backRuntime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x,
        y: transform.position.y,
        z: transform.position.z + 0.32
      },
      faceNormal: { x: -1, y: 0, z: 0 },
      config: {
        panelPose: 'floor'
      }
    });

    const frontTarget = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(frontRuntime, {
      allowReplacement: false
    });
    const backTarget = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(backRuntime, {
      allowReplacement: false
    });

    expect(frontTarget).toMatchObject({
      kind: 'tile',
      snapKind: 'verticalSideFloor',
      valid: true,
      cell: { x: 2, y: 1, z: 1 }
    });
    expect(frontTarget.operation).toMatchObject({
      kind: 'tile',
      cell: { x: 2, y: 1, z: 1 }
    });
    expect(backTarget).toMatchObject({
      kind: 'tile',
      snapKind: 'verticalSideFloor',
      valid: true,
      cell: { x: 1, y: 1, z: 1 }
    });
  });

  it('targets the next layer from the visible top of a stacked vertical tile', () => {
    const lowerVertical = {
      ...createTile({
        x: 1,
        y: 1,
        z: 0,
        rotation: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      isVertical: true
    };
    const upperVertical = {
      ...createTile({
        x: 1,
        y: 1,
        z: 1,
        rotation: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      isVertical: true
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles: {
        [createCellKey(1, 1, 0)]: lowerVertical,
        [createCellKey(1, 1, 1)]: upperVertical
      }
    };
    const transform = getTileThreeTransform(upperVertical, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x,
        y: transform.position.y + (transform.size.y * 0.5) - 0.02,
        z: transform.position.z
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false,
      preferWallPose: true
    });

    expect(target).toMatchObject({
      kind: 'verticalTile',
      snapKind: 'verticalTop',
      valid: true,
      cell: { x: 1, y: 1, z: 2 }
    });
    expect(target.operation).toMatchObject({
      kind: 'tile',
      cell: { x: 1, y: 1, z: 2 },
      isVertical: true
    });
  });
});
