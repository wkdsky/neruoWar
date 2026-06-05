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
  buildCityChannelThreeRenderModel,
  getThreeGearSurfacePoint,
  isThreePlacementVisible
} from './cityChannelThreeGeometry';
import {
  buildMechanicalAssemblies,
  getAssemblyForCell
} from '../cityChannelMechanismRuntime';
import CityChannelThreeRuntime from './CityChannelThreeRuntime';

const createRuntimeHarness = (overrides = {}) => ({
  clearLongPressTimer: jest.fn(),
  clearPlacementGhost: jest.fn(),
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

const createRuntimeObject = (overrides = {}) => Object.assign(
  Object.create(CityChannelThreeRuntime.prototype),
  overrides
);

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

  it('keeps carry ghost following the mouse even outside a drag gesture', () => {
    const runtime = createRuntimeHarness({
      pointerState: null,
      carryState: {
        mode: 'move',
        origins: [{ x: 2, y: 2, z: 0 }]
      },
      updateActiveGhost: CityChannelThreeRuntime.prototype.updateActiveGhost
    });

    CityChannelThreeRuntime.prototype.handlePointerMove.call(runtime, {
      clientX: 148,
      clientY: 96
    });

    expect(runtime.updateHover).toHaveBeenCalledTimes(1);
    expect(runtime.clearPlacementGhost).toHaveBeenCalledTimes(1);
    expect(runtime.updateCarryGhost).toHaveBeenCalledTimes(1);
    expect(runtime.updatePlacementGhost).not.toHaveBeenCalled();
  });

  it('uses the expected horizontal direction for double-click drag camera rotation', () => {
    const runtime = createRuntimeHarness({
      pointerState: {
        mode: 'rotateCamera',
        startX: 100,
        startY: 80,
        x: 100,
        y: 80,
        moved: false
      },
      rotateCameraYaw: jest.fn()
    });

    CityChannelThreeRuntime.prototype.handlePointerMove.call(runtime, {
      clientX: 112,
      clientY: 80
    });

    expect(runtime.rotateCameraYaw).toHaveBeenCalledTimes(1);
    expect(runtime.rotateCameraYaw.mock.calls[0][0]).toBeCloseTo(-4.08);
  });

  it('keeps the drag origin when committing a selection box on pointer release', () => {
    const pointerState = {
      mode: 'box',
      moved: true,
      startX: 40,
      startY: 50,
      shiftKey: false
    };
    const runtime = createRuntimeHarness({
      pointerState,
      commitBoxSelection: jest.fn()
    });

    CityChannelThreeRuntime.prototype.handlePointerUp.call(runtime, pointerUpEvent);

    expect(runtime.commitBoxSelection).toHaveBeenCalledWith(pointerUpEvent, false, pointerState);
    expect(runtime.pointerState).toBeNull();
  });
});

describe('CityChannelThreeRuntime carry ghost pose controls', () => {
  it('rotates only the single-placement carry ghost surface with R', () => {
    const source = createTile({
      x: 3,
      y: 4,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      rotation: 0,
      transmissionRotation: 0
    });
    const runtime = createRuntimeObject({
      renderModel: {
        mapData: {
          tiles: { [createCellKey(3, 4, 0)]: source },
          walls: {}
        }
      },
      carryState: {
        mode: 'move',
        origins: [{ x: 3, y: 4, z: 0 }],
        defaultPose: 'floor',
        surfaceRotation: 0,
        groupRotationSteps: 0,
        groupPoseSteps: 0
      },
      notifyStatus: jest.fn(),
      updateCarryGhost: jest.fn(),
      requestRender: jest.fn()
    });

    expect(CityChannelThreeRuntime.prototype.rotateCarryPlacementSurface.call(runtime, 'forward')).toBe(true);

    expect(runtime.carryState.surfaceRotation).toBe(90);
    expect(runtime.carryState.groupRotationSteps).toBe(0);
    expect(source.rotation).toBe(0);
    expect(source.transmissionRotation).toBe(0);
    expect(runtime.updateCarryGhost).toHaveBeenCalledTimes(1);
  });

  it('flips only the single-placement carry ghost default pose with Space', () => {
    const source = createTile({
      x: 3,
      y: 4,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      rotation: 0
    });
    const runtime = createRuntimeObject({
      renderModel: {
        mapData: {
          tiles: { [createCellKey(3, 4, 0)]: source },
          walls: {}
        }
      },
      carryState: {
        mode: 'move',
        origins: [{ x: 3, y: 4, z: 0 }],
        defaultPose: 'floor',
        surfaceRotation: 0
      },
      notifyStatus: jest.fn(),
      updateCarryGhost: jest.fn(),
      requestRender: jest.fn()
    });

    expect(CityChannelThreeRuntime.prototype.cycleCarrySnapAxisRotation.call(runtime)).toBe(true);
    const target = CityChannelThreeRuntime.prototype.applyCarryGhostPoseToTarget.call(runtime, { x: 8, y: 4, z: 0, edge: 'east' });

    expect(runtime.carryState.defaultPose).toBe('wall');
    expect(target).toEqual({
      x: 8,
      y: 4,
      z: 0,
      edge: 'east',
      isVertical: false,
      layFlat: false,
      rotation: 0
    });
    expect(source.isVertical).toBe(false);
    expect(runtime.updateCarryGhost).toHaveBeenCalledTimes(1);
  });

  it('commits a same-position move when the carry ghost surface changed over its source', () => {
    const sourceKey = createCellKey(3, 4, 0);
    const source = createTile({
      x: 3,
      y: 4,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      rotation: 0,
      transmissionRotation: 0
    });
    const onMovePlacements = jest.fn();
    const runtime = createRuntimeObject({
      renderModel: {
        mapData: {
          ...createBaseCityChannelMap({ name: 'same-position carry update' }),
          tiles: { [sourceKey]: source },
          walls: {}
        }
      },
      carryState: {
        mode: 'move',
        origins: [{ x: 3, y: 4, z: 0 }],
        defaultPose: 'floor',
        surfaceRotation: 90
      },
      config: {
        onMovePlacements,
        onToast: jest.fn()
      },
      getPlacementTargetFromHoverBoard: jest.fn(() => null),
      getHoverPlacementData: jest.fn(() => ({
        kind: 'tile',
        key: sourceKey,
        placement: source,
        transform: { kind: 'tile' }
      })),
      endCarryPreview: jest.fn()
    });

    expect(CityChannelThreeRuntime.prototype.commitCarryTarget.call(runtime)).toBe(true);

    expect(onMovePlacements).toHaveBeenCalledWith([
      {
        from: { x: 3, y: 4, z: 0 },
        to: {
          x: 3,
          y: 4,
          z: 0,
          rotation: 90,
          transmissionRotation: 90,
          layFlat: true
        }
      }
    ]);
    expect(runtime.endCarryPreview).toHaveBeenCalledTimes(1);
  });
});

describe('CityChannelThreeRuntime click selection', () => {
  const createSelectionRuntime = ({ hoverData, selection }) => ({
    hoverMesh: {
      userData: {
        cityChannel: hoverData
      }
    },
    config: {
      activeTool: CITY_CHANNEL_TOOLS.SELECT,
      selection
    },
    getPlacementSelectionFromData: CityChannelThreeRuntime.prototype.getPlacementSelectionFromData,
    emitSelection: jest.fn(function emitSelection(nextSelection) {
      this.config.selection = nextSelection;
    }),
    requestRender: jest.fn(),
    emitStatus: jest.fn()
  });

  it('shift-clicking an already selected tile toggles it back off', () => {
    const runtime = createSelectionRuntime({
      hoverData: {
        kind: 'tile',
        placement: { x: 2, y: 3, z: 0 }
      },
      selection: {
        cells: [{ x: 1, y: 3, z: 0 }, { x: 2, y: 3, z: 0 }],
        walls: [],
        gears: [],
        scope: 'board'
      }
    });

    CityChannelThreeRuntime.prototype.selectHovered.call(runtime, true);

    expect(runtime.config.selection).toEqual({
      cells: [{ x: 1, y: 3, z: 0 }],
      walls: [],
      gears: [],
      scope: 'board'
    });
  });

  it('shift-clicking the final selected wall clears the board selection scope', () => {
    const runtime = createSelectionRuntime({
      hoverData: {
        kind: 'wall',
        placement: { x: 2, y: 3, z: 0, edge: 'east' }
      },
      selection: {
        cells: [],
        walls: [{ x: 2, y: 3, z: 0, edge: 'east' }],
        gears: [],
        scope: 'board'
      }
    });

    CityChannelThreeRuntime.prototype.selectHovered.call(runtime, true);

    expect(runtime.config.selection).toEqual({
      cells: [],
      walls: [],
      gears: [],
      scope: null
    });
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
      placementGroups: new Map(),
      gearMeshes: new Map(),
      config: {
        wallViewMode: 'semi'
      },
      materials: {
        getMaterial: jest.fn(() => sharedMaterial)
      },
      edgeMaterial: new THREE.LineBasicMaterial(),
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
      portalDeckGeometry: new THREE.BoxGeometry(0.58, 0.028, 0.72),
      portalRailGeometry: new THREE.BoxGeometry(0.075, 0.055, 0.78),
      portalLipGeometry: new THREE.BoxGeometry(0.58, 0.055, 0.075),
      portalLaneGeometry: new THREE.BoxGeometry(0.18, 0.014, 0.52),
      portalBeaconGeometry: new THREE.CylinderGeometry(0.034, 0.034, 0.052, 8),
      portalHoodGeometry: new THREE.BoxGeometry(0.56, 0.12, 0.24),
      portalHoodEdgeGeometry: new THREE.EdgesGeometry(new THREE.BoxGeometry(0.56, 0.12, 0.24)),
      portalArrowGeometry: new THREE.PlaneGeometry(0.2, 0.4),
      portalDeckMaterial: sharedMaterial,
      portalFrameMaterial: sharedMaterial,
      portalHoodMaterial: sharedMaterial,
      portalAttachmentEdgeMaterial: new THREE.LineBasicMaterial(),
      entranceMarkerMaterial: sharedMaterial,
      exitMarkerMaterial: sharedMaterial,
      entranceMarkerGlowMaterial: sharedMaterial,
      exitMarkerGlowMaterial: sharedMaterial,
      createPlacementMesh: CityChannelThreeRuntime.prototype.createPlacementMesh,
      createPlacementRenderGroup: CityChannelThreeRuntime.prototype.createPlacementRenderGroup,
      getRuntimeTransform: CityChannelThreeRuntime.prototype.getRuntimeTransform,
      getRuntimeWorldPointForPlacement: CityChannelThreeRuntime.prototype.getRuntimeWorldPointForPlacement,
      getRuntimeSurfacePointForPlacement: CityChannelThreeRuntime.prototype.getRuntimeSurfacePointForPlacement,
      getRuntimeGearSurfacePointForPlacement: CityChannelThreeRuntime.prototype.getRuntimeGearSurfacePointForPlacement,
      getBasePlacementTransform: CityChannelThreeRuntime.prototype.getBasePlacementTransform,
      getRuntimePlacementMatrix: CityChannelThreeRuntime.prototype.getRuntimePlacementMatrix,
      applyPlacementGroupMatrix: CityChannelThreeRuntime.prototype.applyPlacementGroupMatrix,
      syncMechanismRuntimeTransforms: CityChannelThreeRuntime.prototype.syncMechanismRuntimeTransforms,
      syncGearMeshRuntimeTransform: CityChannelThreeRuntime.prototype.syncGearMeshRuntimeTransform,
      syncSelectionFromConfig: jest.fn(),
      requestRender: jest.fn(),
      emitStatus: jest.fn(),
      getPlacementRenderOrder: CityChannelThreeRuntime.prototype.getPlacementRenderOrder,
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
      getGearAttachmentContext: CityChannelThreeRuntime.prototype.getGearAttachmentContext,
      getGearAttachmentWorldPoint: CityChannelThreeRuntime.prototype.getGearAttachmentWorldPoint,
      getGearAttachmentWorldQuaternion: CityChannelThreeRuntime.prototype.getGearAttachmentWorldQuaternion,
      createGearBindingInvalidBadge: CityChannelThreeRuntime.prototype.createGearBindingInvalidBadge,
      addGearBindingInvalidBadge: CityChannelThreeRuntime.prototype.addGearBindingInvalidBadge,
      addGearVisualDetails: CityChannelThreeRuntime.prototype.addGearVisualDetails,
      addPortalAttachment: CityChannelThreeRuntime.prototype.addPortalAttachment,
      getGearSurfaceQuaternion: CityChannelThreeRuntime.prototype.getGearSurfaceQuaternion,
      getGearSurfaceRotationDegrees: CityChannelThreeRuntime.prototype.getGearSurfaceRotationDegrees,
      getRuntimeGearState: CityChannelThreeRuntime.prototype.getRuntimeGearState,
      getGearQuaternion: CityChannelThreeRuntime.prototype.getGearQuaternion,
      hasRuntimePlacementGroupMatrix: CityChannelThreeRuntime.prototype.hasRuntimePlacementGroupMatrix,
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
      getGearSurfaceQuaternion: CityChannelThreeRuntime.prototype.getGearSurfaceQuaternion,
      addPortalAttachment: jest.fn()
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

  it('renders stored gear phase in the map-positive rotation direction', () => {
    const runtime = createDetailRuntimeHarness();
    const transform = {
      kind: 'tile',
      key: createCellKey(1, 1, 0),
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      size: { x: 1, y: 0.08, z: 1 },
      position: { x: 0, y: 0.04, z: 0 },
      rotationY: 0,
      placement: {
        x: 1,
        y: 1,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }
    };

    const sourceDirection = new THREE.Vector3(1, 0, 0).applyQuaternion(
      CityChannelThreeRuntime.prototype.getGearQuaternion.call(runtime, transform, { surface: 'front' }, 90)
    );
    const drivenDirection = new THREE.Vector3(1, 0, 0).applyQuaternion(
      CityChannelThreeRuntime.prototype.getGearQuaternion.call(runtime, transform, { surface: 'front' }, 270)
    );

    expect(sourceDirection.x).toBeCloseTo(0, 6);
    expect(sourceDirection.z).toBeCloseTo(1, 6);
    expect(drivenDirection.x).toBeCloseTo(0, 6);
    expect(drivenDirection.z).toBeCloseTo(-1, 6);
  });

  it('keeps a moving board, gear, and internal details as one rigid placement group', () => {
    const runtime = createDetailRuntimeHarness();
    const key = createCellKey(1, 1, 0);
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    tile.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_ne',
      surface: 'front',
      phase: 15
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [key]: tile
      },
      walls: {}
    };
    runtime.renderModel = { mapData };
    const transform = getTileThreeTransform(tile, mapData);

    const group = CityChannelThreeRuntime.prototype.createPlacementRenderGroup.call(runtime, transform);
    runtime.placementGroups.set(key, group);
    group.updateMatrixWorld(true);
    const body = group.children.find((child) => child.userData?.cityChannel?.kind === 'tile');
    const gear = runtime.gearMeshes.get(`${key}:gear_corner`);
    const bodyWorldBefore = body.getWorldPosition(new THREE.Vector3());
    const gearWorldBefore = gear.getWorldPosition(new THREE.Vector3());
    const gearLocalBefore = gear.position.clone();
    const gearQuaternionBefore = gear.quaternion.clone();

    runtime.mechanismRuntimeSnapshot = {
      placements: {
        [key]: {
          runtimeAngle: 90,
          runtimeFixedMountId: 'gear_corner'
        }
      },
      gears: {
        [`${key}:gear_corner`]: {
          phase: 225
        }
      }
    };
    CityChannelThreeRuntime.prototype.syncMechanismRuntimeTransforms.call(runtime);
    const bodyWorldAfter = body.getWorldPosition(new THREE.Vector3());
    const gearWorldAfter = gear.getWorldPosition(new THREE.Vector3());

    expect(body.parent).toBe(group);
    expect(gear.parent).toBe(group);
    expect(gear.position.distanceTo(gearLocalBefore)).toBeCloseTo(0, 6);
    expect(gear.quaternion.angleTo(gearQuaternionBefore)).toBeCloseTo(0, 6);
    expect(gearWorldAfter.distanceTo(gearWorldBefore)).toBeCloseTo(0, 5);
    expect(bodyWorldAfter.distanceTo(bodyWorldBefore)).toBeGreaterThan(0.4);
  });

  it('rotates a center gear with its board surface orientation', () => {
    const runtime = createDetailRuntimeHarness();
    const key = createCellKey(1, 1, 0);
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    tile.gearMounts = [{
      id: 'gear_center',
      componentType: 'gear',
      position: 'center',
      surface: 'front',
      phase: 0
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [key]: tile
      },
      walls: {}
    };
    runtime.renderModel = {
      mapData,
      tiles: [getTileThreeTransform(tile, mapData)],
      walls: []
    };
    const transform = runtime.renderModel.tiles[0];
    const group = CityChannelThreeRuntime.prototype.createPlacementRenderGroup.call(runtime, transform);
    runtime.placementGroups.set(key, group);
    const gear = runtime.gearMeshes.get(`${key}:gear_center`);
    const gearPositionBefore = gear.position.clone();

    runtime.mechanismRuntimeSnapshot = {
      placements: {
        [key]: {
          runtimeSurfaceRotation: 90
        }
      },
      gears: {}
    };
    CityChannelThreeRuntime.prototype.syncMechanismRuntimeTransforms.call(runtime);
    const direction = new THREE.Vector3(1, 0, 0).applyQuaternion(gear.quaternion);

    expect(gear.position.distanceTo(gearPositionBefore)).toBeCloseTo(0, 6);
    expect(direction.x).toBeCloseTo(0, 6);
    expect(direction.z).toBeCloseTo(1, 6);
  });

  it('moves a bound corner gear with the board it is bound to when that board surface turns', () => {
    const runtime = createDetailRuntimeHarness();
    const hostKey = createCellKey(1, 1, 0);
    const boundKey = createCellKey(2, 1, 0);
    const host = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    host.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_ne',
      socketKind: 'corner',
      surface: 'front',
      axisBinding: {
        hostKind: 'tile',
        componentKey: boundKey,
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const bound = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [hostKey]: host,
        [boundKey]: bound
      },
      walls: {}
    };
    runtime.renderModel = {
      mapData,
      tiles: [getTileThreeTransform(host, mapData), getTileThreeTransform(bound, mapData)],
      walls: []
    };
    runtime.renderModel.tiles.forEach((transform) => {
      const group = CityChannelThreeRuntime.prototype.createPlacementRenderGroup.call(runtime, transform);
      runtime.placementGroups.set(transform.key, group);
    });
    const gear = runtime.gearMeshes.get(`${hostKey}:gear_corner`);
    const baseWorld = gear.getWorldPosition(new THREE.Vector3());

    runtime.mechanismRuntimeSnapshot = {
      placements: {
        [boundKey]: {
          runtimeSurfaceRotation: 90
        }
      },
      gears: {}
    };
    CityChannelThreeRuntime.prototype.syncMechanismRuntimeTransforms.call(runtime);
    const runtimeBoundTransform = getTileThreeTransform({
      ...bound,
      runtimeSurfaceRotation: 90
    }, mapData);
    const expectedPoint = getThreeGearSurfacePoint(runtimeBoundTransform, {
      position: 'corner_nw',
      surface: 'front'
    });
    const gearWorld = gear.getWorldPosition(new THREE.Vector3());

    expect(gear.userData.cityChannel).toMatchObject({
      attachmentComponentKey: boundKey,
      followsAxisBinding: true
    });
    expect(gearWorld.x).toBeCloseTo(expectedPoint.x, 6);
    expect(gearWorld.z).toBeCloseTo(expectedPoint.z, 6);
    expect(gearWorld.distanceTo(baseWorld)).toBeGreaterThan(0.4);
  });

  it('spins a degraded free-axis corner gear when it is driven by a meshed active gear', () => {
    const runtime = createDetailRuntimeHarness();
    const sourceKey = createCellKey(1, 1, 0);
    const passiveKey = createCellKey(2, 1, 0);
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
      surface: 'front',
      phase: 0
    }];
    const passive = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    passive.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_nw',
      socketKind: 'corner',
      surface: 'front',
      phase: 0,
      axisBinding: {
        hostKind: 'tile',
        componentKey: sourceKey,
        socket: 'corner_ne',
        surface: 'front'
      }
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [passiveKey]: passive
      },
      walls: {}
    };
    runtime.renderModel = {
      mapData,
      tiles: [getTileThreeTransform(source, mapData), getTileThreeTransform(passive, mapData)],
      walls: []
    };
    runtime.renderModel.tiles.forEach((transform) => {
      const group = CityChannelThreeRuntime.prototype.createPlacementRenderGroup.call(runtime, transform);
      runtime.placementGroups.set(transform.key, group);
    });
    const gear = runtime.gearMeshes.get(`${passiveKey}:gear_corner`);
    const passiveTransform = runtime.renderModel.tiles.find((transform) => transform.key === passiveKey);
    const hostPoint = getThreeGearSurfacePoint(passiveTransform, passive.gearMounts[0]);

    runtime.mechanismRuntimeSnapshot = {
      placements: {
        [sourceKey]: {
          runtimeSurfaceRotation: 90
        }
      },
      gears: {
        [`${passiveKey}:gear_corner`]: {
          axisType: 'freeAxis',
          axisBinding: null,
          phase: 90,
          speedRatio: -1
        }
      }
    };
    CityChannelThreeRuntime.prototype.syncMechanismRuntimeTransforms.call(runtime);
    const direction = new THREE.Vector3(1, 0, 0).applyQuaternion(gear.quaternion);
    const gearWorld = gear.getWorldPosition(new THREE.Vector3());

    expect(gear.userData.cityChannel).toMatchObject({
      attachmentComponentKey: passiveKey,
      followsAxisBinding: false,
      axisBindingSuppressed: true
    });
    expect(gearWorld.x).toBeCloseTo(hostPoint.x, 6);
    expect(gearWorld.z).toBeCloseTo(hostPoint.z, 6);
    expect(direction.x).toBeCloseTo(0, 6);
    expect(direction.z).toBeCloseTo(1, 6);
  });

  it('uses an axis-binding socket as the rigid pivot even when the target board has no gear mount', () => {
    const runtime = createDetailRuntimeHarness();
    const key = createCellKey(1, 1, 0);
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [key]: tile
      },
      walls: {}
    };
    runtime.renderModel = {
      mapData,
      tiles: [getTileThreeTransform(tile, mapData)],
      walls: []
    };
    const transform = runtime.renderModel.tiles[0];
    const group = CityChannelThreeRuntime.prototype.createPlacementRenderGroup.call(runtime, transform);
    runtime.placementGroups.set(key, group);
    const pivot = getThreeGearSurfacePoint(transform, {
      position: 'corner_ne',
      surface: 'front'
    });
    const pivotBefore = new THREE.Vector3(pivot.x, pivot.y, pivot.z);

    runtime.mechanismRuntimeSnapshot = {
      placements: {
        [key]: {
          runtimeAngle: 90,
          runtimeFixedComponentKey: key,
          runtimeAxisSocket: 'corner_ne',
          runtimeAxisSurface: 'front'
        }
      },
      gears: {}
    };
    CityChannelThreeRuntime.prototype.syncMechanismRuntimeTransforms.call(runtime);
    const pivotAfter = pivotBefore.clone().applyMatrix4(group.matrix);

    expect(pivotAfter.distanceTo(pivotBefore)).toBeCloseTo(0, 5);
    expect(group.matrix.equals(new THREE.Matrix4())).toBe(false);
  });

  it('updates mechanism runtime frames without rebuilding the map', () => {
    const runtime = {
      mechanismRuntimeSnapshot: null,
      config: {
        onMechanismRuntimeSnapshot: jest.fn()
      },
      syncMechanismRuntimeTransforms: jest.fn(),
      rebuildMap: jest.fn()
    };

    CityChannelThreeRuntime.prototype.setMechanismRuntimeSnapshot.call(runtime, {
      placements: {},
      gears: {}
    });

    expect(runtime.syncMechanismRuntimeTransforms).toHaveBeenCalledTimes(1);
    expect(runtime.rebuildMap).not.toHaveBeenCalled();
  });

  it('keeps mechanism runtime poses visible through the original map placement', () => {
    const key = createCellKey(1, 1, 0);
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      gearMounts: [{
        id: 'gear_center',
        position: 'center',
        surface: 'front'
      }]
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      tiles: {
        [key]: tile
      }
    };
    const renderModel = buildCityChannelThreeRenderModel(mapData);
    const runtime = createRuntimeObject({
      renderModel,
      mechanismRuntimeSnapshot: {
        placements: {
          [key]: {
            x: 1.5,
            y: 1,
            z: 0.6,
            rotation: 90,
            runtimeSurfaceRotation: 90
          }
        }
      }
    });

    const runtimeTransform = CityChannelThreeRuntime.prototype.getRuntimeTransform.call(runtime, renderModel.tiles[0]);

    expect(runtimeTransform.placement).toMatchObject({
      x: 1.5,
      y: 1,
      z: 0.6,
      runtimeSurfaceRotation: 90
    });
    expect(runtimeTransform.visibilityPlacement).toEqual(renderModel.tiles[0].placement);
    expect(isThreePlacementVisible(runtimeTransform.placement, {
      mapData: renderModel.mapData,
      visibleLayerCutoff: 0
    })).toBe(false);
    expect(isThreePlacementVisible(runtimeTransform.visibilityPlacement, {
      mapData: renderModel.mapData,
      visibleLayerCutoff: 0
    })).toBe(true);
  });

  it('renders portals as low-profile ground attachments on a horizontal board', () => {
    const runtime = createDetailRuntimeHarness();
    const mapData = createBaseCityChannelMap({ width: 4, height: 4 });
    const transform = getTileThreeTransform(createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.ENTRANCE,
      rotation: 90,
      isVertical: true
    }), mapData);

    CityChannelThreeRuntime.prototype.addPortalAttachment.call(runtime, transform, 20);

    const attachment = runtime.worldGroup.children[0];
    expect(transform.kind).toBe('tile');
    expect(transform.size).toEqual({ x: 1, y: 0.08, z: 1 });
    expect(attachment.children.length).toBeGreaterThanOrEqual(9);
    expect(attachment.children.some((child) => child.geometry === runtime.portalArrowGeometry)).toBe(true);
    expect(attachment.children.some((child) => child.geometry === runtime.portalHoodGeometry)).toBe(true);
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
    getBasePlacementForTransform: CityChannelThreeRuntime.prototype.getBasePlacementForTransform,
    getGearHostKindAndPlacement: CityChannelThreeRuntime.prototype.getGearHostKindAndPlacement,
    getGearBindingStatusForMount: CityChannelThreeRuntime.prototype.getGearBindingStatusForMount,
    getGearAttachmentContext: CityChannelThreeRuntime.prototype.getGearAttachmentContext,
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
      ghostGeometry: new THREE.BoxGeometry(1, 1, 1),
      placementGroups: new Map(),
      getVisiblePlacementTransforms: CityChannelThreeRuntime.prototype.getVisiblePlacementTransforms,
      getRuntimeTransform: CityChannelThreeRuntime.prototype.getRuntimeTransform,
      getRuntimeWorldPointForPlacement: CityChannelThreeRuntime.prototype.getRuntimeWorldPointForPlacement,
      getRuntimeSurfacePointForPlacement: CityChannelThreeRuntime.prototype.getRuntimeSurfacePointForPlacement,
      getRuntimeGearSurfacePointForPlacement: CityChannelThreeRuntime.prototype.getRuntimeGearSurfacePointForPlacement,
      getPlacementMeshForComponent: CityChannelThreeRuntime.prototype.getPlacementMeshForComponent,
      getBasePlacementTransform: CityChannelThreeRuntime.prototype.getBasePlacementTransform,
      hasRuntimePlacementGroupMatrix: CityChannelThreeRuntime.prototype.hasRuntimePlacementGroupMatrix,
      getGearBindingSurfacesForPlacement: CityChannelThreeRuntime.prototype.getGearBindingSurfacesForPlacement,
      isSameThreePoint: CityChannelThreeRuntime.prototype.isSameThreePoint,
      getGearBindingCandidateKey: CityChannelThreeRuntime.prototype.getGearBindingCandidateKey,
      isSameGearBindingCandidate: CityChannelThreeRuntime.prototype.isSameGearBindingCandidate,
      getGearBindingWarningMessage: CityChannelThreeRuntime.prototype.getGearBindingWarningMessage,
      getGearAttachmentContext: CityChannelThreeRuntime.prototype.getGearAttachmentContext,
      getGearAttachmentWorldPoint: CityChannelThreeRuntime.prototype.getGearAttachmentWorldPoint,
      getGearAttachmentWorldQuaternion: CityChannelThreeRuntime.prototype.getGearAttachmentWorldQuaternion,
      getGearBindingCandidatesForPivot: CityChannelThreeRuntime.prototype.getGearBindingCandidatesForPivot,
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
      createBoardOverlayGroup: CityChannelThreeRuntime.prototype.createBoardOverlayGroup,
      syncOverlayEdgeGeometry: CityChannelThreeRuntime.prototype.syncOverlayEdgeGeometry,
      syncBoardOverlayGroup: CityChannelThreeRuntime.prototype.syncBoardOverlayGroup,
      createTransmissionTubeMesh: CityChannelThreeRuntime.prototype.createTransmissionTubeMesh,
      getGearSurfaceQuaternion: CityChannelThreeRuntime.prototype.getGearSurfaceQuaternion,
      getGearSurfaceRotationDegrees: CityChannelThreeRuntime.prototype.getGearSurfaceRotationDegrees,
      getGearQuaternion: CityChannelThreeRuntime.prototype.getGearQuaternion,
      mechanismRuntimeSnapshot: null
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

  it('offers every horizontal board around an intersection gear as a binding candidate', () => {
    const hostKey = createCellKey(16, 16, 0);
    const eastKey = createCellKey(17, 16, 0);
    const southKey = createCellKey(16, 17, 0);
    const diagonalKey = createCellKey(17, 17, 0);
    const host = createTile({
      x: 16,
      y: 16,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    host.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_se',
      socketKind: 'corner',
      surface: 'front'
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 20, height: 20, layers: 2 }),
      tiles: {
        [hostKey]: host,
        [eastKey]: createTile({ x: 17, y: 16, z: 0 }),
        [southKey]: createTile({ x: 16, y: 17, z: 0 }),
        [diagonalKey]: createTile({ x: 17, y: 17, z: 0 })
      },
      walls: {}
    };
    const runtime = createBindingVisualRuntimeHarness(mapData);
    const hostTransform = runtime.renderModel.tiles.find((transform) => transform.key === hostKey);
    const pivotWorld = getThreeGearSurfacePoint(hostTransform, host.gearMounts[0]);

    const candidates = CityChannelThreeRuntime.prototype.getGearBindingCandidatesForPivot.call(runtime, {
      pivotWorld,
      source: {
        hostKind: 'tile',
        hostKey,
        socket: 'corner_se',
        surface: 'front'
      }
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ componentKey: hostKey, socket: 'corner_se' }),
      expect.objectContaining({ componentKey: eastKey, socket: 'corner_sw' }),
      expect.objectContaining({ componentKey: southKey, socket: 'corner_ne' }),
      expect.objectContaining({ componentKey: diagonalKey, socket: 'corner_nw' })
    ]));
  });

  it('only gives directional vertical boards separate front and back binding surfaces', () => {
    const basicWall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const pressureWall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    const basicVertical = {
      ...createTile({
        x: 1,
        y: 1,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      isVertical: true
    };
    const pressureVertical = {
      ...createTile({
        x: 1,
        y: 1,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
      }),
      isVertical: true
    };

    expect(CityChannelThreeRuntime.prototype.getGearBindingSurfacesForPlacement.call({}, basicWall)).toEqual(['front']);
    expect(CityChannelThreeRuntime.prototype.getGearBindingSurfacesForPlacement.call({}, basicVertical)).toEqual(['front']);
    expect(CityChannelThreeRuntime.prototype.getGearBindingSurfacesForPlacement.call({}, pressureWall)).toEqual(['front', 'back']);
    expect(CityChannelThreeRuntime.prototype.getGearBindingSurfacesForPlacement.call({}, pressureVertical)).toEqual(['front', 'back']);
  });

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

  it('degrades a meshed bound intersection gear into an unbound passive gear', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const driverKey = createCellKey(2, 1, 0);
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
        componentKey: sourceKey,
        socket: 'corner_ne',
        surface: 'front'
      }
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [driverKey]: driver
      },
      walls: {}
    };
    const runtime = createTransmissionRuntimeHarness(mapData);
    const assemblyGraph = buildMechanicalAssemblies(mapData);
    const assembly = getAssemblyForCell(assemblyGraph, sourceKey);
    const nodes = CityChannelThreeRuntime.prototype.resolveDrivenGearNodes.call(runtime, assembly, sourceKey);
    const assemblyEntries = CityChannelThreeRuntime.prototype.createAxisBindingRuntimeEntries.call(
      runtime,
      nodes,
      assemblyGraph,
      assembly
    );
    const snapshot = CityChannelThreeRuntime.prototype.createRuntimeSnapshotForMechanism.call(runtime, {
      key: sourceKey,
      tile: source,
      assemblyEntries,
      gearNodes: nodes,
      sourceAngle: 90,
      basePhases: new Map(nodes.map((node) => [node.id, Number(node.mount?.phase) || 0]))
    });
    const cornerNode = nodes.find((node) => node.id === `${driverKey}:gear_corner`);

    expect(nodes.map((node) => node.id)).toEqual([`${sourceKey}:gear_center`, `${driverKey}:gear_corner`]);
    expect(cornerNode).toMatchObject({
      driveRatio: -1,
      isDriveRoot: false,
      axisBindingSuppressed: true
    });
    expect(assemblyEntries).toHaveLength(0);
    expect(snapshot.placements).toEqual({});
    expect(snapshot.gears[`${driverKey}:gear_corner`]).toMatchObject({
      axisType: 'freeAxis',
      axisBinding: null,
      phase: 270,
      speedRatio: -1
    });
  });

  it('degrades a meshed corner gear bound to another board in the pressure plate assembly', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const linkKey = createCellKey(1, 0, 0);
    const driverKey = createCellKey(2, 1, 0);
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
    const link = createTile({
      x: 1,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 0
    });
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
        componentKey: linkKey,
        socket: 'corner_se',
        surface: 'front'
      }
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [linkKey]: link,
        [driverKey]: driver
      },
      walls: {}
    };
    const runtime = createTransmissionRuntimeHarness(mapData);
    const assemblyGraph = buildMechanicalAssemblies(mapData);
    const assembly = getAssemblyForCell(assemblyGraph, sourceKey);
    const nodes = CityChannelThreeRuntime.prototype.resolveDrivenGearNodes.call(runtime, assembly, sourceKey);
    const assemblyEntries = CityChannelThreeRuntime.prototype.createAxisBindingRuntimeEntries.call(
      runtime,
      nodes,
      assemblyGraph,
      assembly
    );
    const snapshot = CityChannelThreeRuntime.prototype.createRuntimeSnapshotForMechanism.call(runtime, {
      key: sourceKey,
      tile: source,
      assemblyEntries,
      gearNodes: nodes,
      sourceAngle: 90,
      basePhases: new Map(nodes.map((node) => [node.id, Number(node.mount?.phase) || 0]))
    });
    const cornerNode = nodes.find((node) => node.id === `${driverKey}:gear_corner`);

    expect(assembly.componentKeys).toEqual(expect.arrayContaining([sourceKey, linkKey]));
    expect(cornerNode).toMatchObject({
      driveRatio: -1,
      isDriveRoot: false,
      axisBindingSuppressed: true
    });
    expect(assemblyEntries).toHaveLength(0);
    expect(snapshot.placements).toEqual({});
    expect(snapshot.gears[`${driverKey}:gear_corner`]).toMatchObject({
      axisType: 'freeAxis',
      axisBinding: null,
      phase: 270,
      speedRatio: -1
    });
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
      rotationDirection: 'left',
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(true);
    expect(runtime.playMechanismRuntimePreview).toHaveBeenCalledTimes(1);
    expect(runtime.mechanismRuntimeSnapshot.gears[`${sourceKey}:gear_center`]).toMatchObject({ phase: 270 });
    expect(runtime.mechanismRuntimeSnapshot.gears[`${driverKey}:gear_corner`]).toMatchObject({ phase: 90 });
    expect(runtime.mechanismRuntimeSnapshot.placements[boundKey]).toMatchObject({
      runtimeAxisBindingMountId: 'gear_corner',
      runtimeFixedMountId: 'gear_corner'
    });
    expect(runtime.mechanismRuntimeSnapshot.placements[boundKey].runtimeAngle).not.toBe(0);
  });

  it('blocks a bound board when gear transmission would rotate it into the source assembly', () => {
    const {
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

    expect(played).toBe(false);
    expect(runtime.playMechanismRuntimePreview).not.toHaveBeenCalled();
    expect(runtime.setMechanismRuntimeSnapshot).toHaveBeenLastCalledWith(null);
    expect(runtime.flashMechanismObstruction).toHaveBeenCalledTimes(1);
    expect(runtime.config.onToast).toHaveBeenLastCalledWith('旁边有遮挡物，当前齿轮组没有足够转动空间。', 'error');
  });

  it('drives every board in an axis-bound transmission assembly as one rigid body', () => {
    const sourceKey = createCellKey(1, 2, 0);
    const driverKey = createCellKey(2, 2, 0);
    const boundKey = createCellKey(1, 1, 0);
    const linkedKey = createCellKey(1, 0, 0);
    const source = createTile({
      x: 1,
      y: 2,
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
      y: 2,
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
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE
    });
    const linked = createTile({
      x: 1,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      transmissionRotation: 0
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

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 2, z: 0 }, {
      rotationAngle: 90,
      rotationDirection: 'left',
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
      getGearAttachmentContext: CityChannelThreeRuntime.prototype.getGearAttachmentContext,
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

  it('keeps the bound board highlight aligned with a runtime placement group', () => {
    const { drivenKey, mapData } = createBoundCornerGearMap();
    const runtime = createBindingVisualRuntimeHarness(mapData);
    const transform = runtime.renderModel.tiles.find((item) => item.key === drivenKey);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(transform.size.x, transform.size.y, transform.size.z),
      new THREE.MeshBasicMaterial()
    );
    mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
    mesh.rotation.y = transform.rotationY || 0;
    mesh.userData.cityChannel = {
      kind: transform.kind,
      key: transform.key,
      placement: transform.placement,
      transform
    };
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.matrix.makeTranslation(0.65, 0, 0.35);
    group.add(mesh);
    group.updateMatrixWorld(true);
    runtime.placementGroups.set(drivenKey, group);

    const visuals = CityChannelThreeRuntime.prototype.getAmbientGearBindingVisuals.call(runtime);
    CityChannelThreeRuntime.prototype.addGearBindingVisual.call(runtime, visuals[0].context, visuals[0].candidate, {
      ambient: true
    });

    const boardOverlay = runtime.overlayGroup.children.find((child) => child.userData.cityChannelGearRole === 'binding_board_ambient');
    const sourceMarker = runtime.overlayGroup.children.find((child) => child.userData.cityChannelGearRole === 'binding_source_ambient');
    const fillWorld = boardOverlay.userData.fill.position;
    const meshWorld = mesh.getWorldPosition(new THREE.Vector3());
    const socket = getThreeGearSurfacePoint(transform, {
      position: 'corner_nw',
      surface: 'front'
    });
    const socketWorld = new THREE.Vector3(socket.x, socket.y, socket.z).applyMatrix4(group.matrixWorld);
    expect(fillWorld.x).toBeCloseTo(meshWorld.x, 6);
    expect(fillWorld.z).toBeCloseTo(meshWorld.z, 6);
    expect(fillWorld.x).not.toBeCloseTo(transform.position.x, 6);
    expect(sourceMarker.position.x).toBeCloseTo(socketWorld.x, 6);
    expect(sourceMarker.position.z).toBeCloseTo(socketWorld.z, 6);
    expect(sourceMarker.position.x).not.toBeCloseTo(socket.x, 6);
  });

  it('keeps bound gear binding visuals aligned with runtime surface turns', () => {
    const { drivenKey, mapData } = createBoundCornerGearMap();
    const runtime = createBindingVisualRuntimeHarness(mapData);
    runtime.mechanismRuntimeSnapshot = {
      placements: {
        [drivenKey]: {
          runtimeSurfaceRotation: 90
        }
      },
      gears: {}
    };
    const driven = mapData.tiles[drivenKey];
    const runtimeDrivenTransform = getTileThreeTransform({
      ...driven,
      runtimeSurfaceRotation: 90
    }, mapData);
    const expectedSocket = getThreeGearSurfacePoint(runtimeDrivenTransform, {
      position: 'corner_nw',
      surface: 'front'
    });

    const visuals = CityChannelThreeRuntime.prototype.getAmbientGearBindingVisuals.call(runtime);
    CityChannelThreeRuntime.prototype.addGearBindingVisual.call(runtime, visuals[0].context, visuals[0].candidate, {
      ambient: true
    });

    const sourceMarker = runtime.overlayGroup.children.find((child) => child.userData.cityChannelGearRole === 'binding_source_ambient');
    const endpointMarker = runtime.overlayGroup.children.find((child) => child.userData.cityChannelGearRole === 'binding_endpoint_ambient');
    expect(visuals[0].context.pivotWorld.x).toBeCloseTo(expectedSocket.x, 6);
    expect(visuals[0].context.pivotWorld.z).toBeCloseTo(expectedSocket.z, 6);
    expect(sourceMarker.position.x).toBeCloseTo(expectedSocket.x, 6);
    expect(sourceMarker.position.z).toBeCloseTo(expectedSocket.z, 6);
    expect(endpointMarker.position.x).toBeCloseTo(expectedSocket.x, 6);
    expect(endpointMarker.position.z).toBeCloseTo(expectedSocket.z, 6);
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
  it('requires projected mesh bounds to be fully contained by the selection rectangle', () => {
    const runtime = {
      getMeshScreenBounds: jest.fn(() => ({
        left: 100,
        top: 100,
        right: 220,
        bottom: 180
      })),
      doesScreenRectContain: CityChannelThreeRuntime.prototype.doesScreenRectContain
    };
    const mesh = {
      geometry: {
        boundingBox: {}
      }
    };

    const crossing = CityChannelThreeRuntime.prototype.isMeshInsideSelectionRect.call(runtime, mesh, {
      left: 150,
      top: 80,
      right: 160,
      bottom: 220
    });
    const containing = CityChannelThreeRuntime.prototype.isMeshInsideSelectionRect.call(runtime, mesh, {
      left: 80,
      top: 80,
      right: 240,
      bottom: 200
    });

    expect(crossing).toBe(false);
    expect(containing).toBe(true);
  });

  it('keeps a partially visible mesh selectable and rejects a fully occluded mesh', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), new THREE.MeshBasicMaterial());
    mesh.userData.cityChannel = {
      kind: 'tile',
      placement: { x: 1, y: 1, z: 0 }
    };
    const blocker = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), new THREE.MeshBasicMaterial());
    blocker.position.z = 0.5;
    blocker.userData.cityChannel = {
      kind: 'tile',
      placement: { x: 2, y: 2, z: 1 }
    };
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const runtime = {
      camera,
      selectionRaycaster: new THREE.Raycaster(),
      pickables: [blocker, mesh],
      getMeshSelectionKey: CityChannelThreeRuntime.prototype.getMeshSelectionKey,
      getMeshSelectionVisibilitySamplePoints: CityChannelThreeRuntime.prototype.getMeshSelectionVisibilitySamplePoints
    };

    expect(CityChannelThreeRuntime.prototype.isMeshVisibleForSelection.call(runtime, mesh)).toBe(false);

    blocker.position.x = 0.4;
    blocker.updateMatrixWorld(true);
    expect(CityChannelThreeRuntime.prototype.isMeshVisibleForSelection.call(runtime, mesh)).toBe(true);
  });

  it('commits only visible boards fully contained by the dragged selection range', () => {
    const insideMesh = {
      geometry: { boundingBox: {} },
      userData: {
        cityChannel: {
          kind: 'tile',
          placement: { x: 1, y: 1, z: 0 }
        }
      }
    };
    const outsideMesh = {
      geometry: { boundingBox: {} },
      userData: {
        cityChannel: {
          kind: 'tile',
          placement: { x: 5, y: 5, z: 0 }
        }
      }
    };
    const hiddenMesh = {
      geometry: { boundingBox: {} },
      userData: {
        cityChannel: {
          kind: 'tile',
          placement: { x: 3, y: 3, z: 0 }
        }
      }
    };
    const runtime = {
      mount: {
        getBoundingClientRect: jest.fn(() => ({
          left: 0,
          top: 0,
          width: 300,
          height: 200
        }))
      },
      config: {
        selection: { cells: [], walls: [], gears: [], scope: null }
      },
      pickables: [insideMesh, outsideMesh, hiddenMesh],
      getSelectionBoxRect: CityChannelThreeRuntime.prototype.getSelectionBoxRect,
      getMeshScreenBounds: jest.fn((mesh) => (
        mesh === outsideMesh
          ? { left: 180, top: 120, right: 240, bottom: 180 }
          : { left: 20, top: 20, right: 60, bottom: 60 }
      )),
      doesScreenRectContain: CityChannelThreeRuntime.prototype.doesScreenRectContain,
      isMeshInsideSelectionRect: CityChannelThreeRuntime.prototype.isMeshInsideSelectionRect,
      isMeshVisibleForSelection: jest.fn((mesh) => mesh !== hiddenMesh),
      getPlacementSelectionFromData: CityChannelThreeRuntime.prototype.getPlacementSelectionFromData,
      emitSelection: jest.fn(function emitSelection(selection) {
        this.config.selection = selection;
      }),
      requestRender: jest.fn(),
      emitStatus: jest.fn()
    };

    const committed = CityChannelThreeRuntime.prototype.commitBoxSelection.call(
      runtime,
      { clientX: 100, clientY: 100 },
      false,
      { startX: 10, startY: 10 }
    );

    expect(committed).toBe(true);
    expect(runtime.config.selection).toMatchObject({
      scope: 'board',
      cells: [{ x: 1, y: 1, z: 0 }],
      walls: [],
      gears: []
    });
  });

  it('rejects invalid selection rectangles instead of treating them as containing everything', () => {
    expect(CityChannelThreeRuntime.prototype.doesScreenRectContain.call(
      {},
      { left: Number.NaN, top: 0, right: Number.NaN, bottom: 100 },
      { left: 20, top: 20, right: 60, bottom: 60 }
    )).toBe(false);
  });

  it('commits all visible contained boards into board selection scope', () => {
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
      isMeshVisibleForSelection: jest.fn(() => true),
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

  it('snaps a floor-pose board to a vertical wall target on a precise horizontal edge hit', () => {
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
      },
      walls: {}
    };
    const transform = getTileThreeTransform(tile, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x + 0.5,
        y: transform.position.y,
        z: transform.position.z
      },
      config: {
        panelPose: 'floor'
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false
    });

    expect(target).toMatchObject({
      kind: 'wall',
      snapKind: 'wallEdge',
      valid: true,
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east'
    });
    expect(target.operation).toMatchObject({
      kind: 'wall',
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east'
    });
  });

  it('keeps a floor edge hit as a horizontal neighbor when it is not on the precise edge line', () => {
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
      },
      walls: {}
    };
    const transform = getTileThreeTransform(tile, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x + 0.39,
        y: transform.position.y,
        z: transform.position.z
      },
      config: {
        panelPose: 'floor'
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false
    });

    expect(target).toMatchObject({
      kind: 'tile',
      snapKind: 'floorEdge',
      valid: true,
      cell: { x: 2, y: 1, z: 0 }
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
