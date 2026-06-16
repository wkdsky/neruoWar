import * as THREE from 'three';
import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  normalizeRotation
} from '../cityChannelSchema';
import {
  getTileThreeTransform,
  getWallThreeTransform,
  buildCityChannelThreeRenderModel,
  getThreeGearSurfacePoint,
  getThreeSurfacePoint,
  isThreeVerticalSupportPlacement,
  isThreePlacementVisible
} from './cityChannelThreeGeometry';
import {
  buildMechanicalAssemblies,
  CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS,
  getAssemblyForCell
} from '../cityChannelMechanismRuntime';
import {
  buildGearContactGraph,
  CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
  createRackTranslationRuntimeEntries,
  getRackContactLimitedTranslationDistance
} from '../cityChannelMechanismSimulation';
import {
  DOUBLE_SIDED_RACK_COMPONENT_TYPE,
  DOUBLE_SIDED_RACK_TOOTH_DEPTH_WORLD,
  RACK_DIRECTIONS,
  RACK_PLANES
} from '../cityChannelRackModel';
import CityChannelThreeRuntime, {
  createGearDirectionArcGeometry,
  createGearDirectionArrowHeadGeometry,
  getGearDirectionArrowTip
} from './CityChannelThreeRuntime';

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
  cancelRackPlacement: CityChannelThreeRuntime.prototype.cancelRackPlacement,
  getRackPlacementBlockStatusMessage: CityChannelThreeRuntime.prototype.getRackPlacementBlockStatusMessage,
  exitActivePlacementMode: CityChannelThreeRuntime.prototype.exitActivePlacementMode,
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
  it('allows the orthographic canvas to zoom to 400 percent', () => {
    const runtime = createRuntimeObject({
      zoom: 3.95,
      camera: {
        zoom: 3.95,
        updateProjectionMatrix: jest.fn()
      },
      config: {
        selection: { cells: [], walls: [] }
      },
      requestRender: jest.fn(),
      emitCamera: jest.fn(),
      emitStatus: jest.fn()
    });
    const event = {
      deltaY: -1000,
      preventDefault: jest.fn()
    };

    CityChannelThreeRuntime.prototype.handleWheel.call(runtime, event);

    expect(runtime.zoom).toBe(4);
    expect(runtime.camera.zoom).toBe(4);
    expect(runtime.camera.updateProjectionMatrix).toHaveBeenCalled();
    expect(runtime.emitCamera).toHaveBeenCalled();
  });

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

  it('exits tile placement on first right click even when a board is selected', () => {
    const onExitPlaceMode = jest.fn();
    const emitSelection = jest.fn();
    const runtime = createRuntimeHarness({
      pointerState: null,
      emitSelection,
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        selection: {
          cells: [{ x: 1, y: 1, z: 0 }],
          walls: [],
          gears: []
        },
        onExitPlaceMode
      }
    });

    expect(CityChannelThreeRuntime.prototype.handleContextAction.call(runtime)).toBe(true);
    expect(onExitPlaceMode).toHaveBeenCalledTimes(1);
    expect(emitSelection).not.toHaveBeenCalled();
  });

  it('cancels the double-sided rack anchor on first right click while keeping the rack tool selected', () => {
    const onExitPlaceMode = jest.fn();
    const runtime = createRuntimeHarness({
      pointerState: {
        mode: 'rackPlaceClick',
        startX: 120,
        startY: 80,
        x: 126,
        y: 86,
        moved: true
      },
      rackPlacementState: {
        start: {
          x: 1.5,
          y: 0.5,
          z: 0,
          plane: 'vertical',
          normalAxis: 'x',
          normalSign: 1
        },
        rack: null,
        valid: false
      },
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
        activeComponentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
        onExitPlaceMode
      }
    });

    expect(CityChannelThreeRuntime.prototype.handleContextAction.call(runtime)).toBe(true);
    expect(runtime.pointerState).toBeNull();
    expect(runtime.rackPlacementState).toBeNull();
    expect(runtime.clearPlacementGhost).toHaveBeenCalledTimes(1);
    expect(onExitPlaceMode).not.toHaveBeenCalled();
  });

  it('exits double-sided rack placement on right click when no anchor is active', () => {
    const onExitPlaceMode = jest.fn();
    const runtime = createRuntimeHarness({
      pointerState: null,
      rackPlacementState: null,
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
        activeComponentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
        onExitPlaceMode
      }
    });

    expect(CityChannelThreeRuntime.prototype.handleContextAction.call(runtime)).toBe(true);
    expect(runtime.rackPlacementState).toBeNull();
    expect(onExitPlaceMode).toHaveBeenCalledTimes(1);
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

  it('arms long-press move for selected boards while browsing', () => {
    const runtime = createRuntimeHarness({
      pointerState: null,
      config: {
        activeTool: CITY_CHANNEL_TOOLS.BROWSE
      },
      renderer: {
        domElement: {
          setPointerCapture: jest.fn(),
          releasePointerCapture: jest.fn()
        }
      },
      updateActiveGhost: jest.fn(),
      isHoverSelectionSelected: jest.fn(() => true),
      hasBoardSelection: jest.fn(() => true),
      scheduleLongPressCarry: jest.fn()
    });

    CityChannelThreeRuntime.prototype.handlePointerDown.call(runtime, pointerDownEvent);

    expect(runtime.pointerState.mode).toBe('click');
    expect(runtime.scheduleLongPressCarry).toHaveBeenCalledTimes(1);
  });

  it('uses two clicks for double-sided rack placement', () => {
    const onCommitOperations = jest.fn();
    const mapData = createBaseCityChannelMap({ width: 4, height: 4, layers: 1 });
    mapData.tiles[createCellKey(1, 0, 0)] = createTile({
      x: 1,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const rack = {
      id: 'rack_two_click',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'horizontal',
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 1.5, y: 0.5, z: 0 }
    };
    const runtime = createRuntimeHarness({
      pointerState: null,
      renderModel: { mapData },
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
        activeComponentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
        onCommitOperations
      },
      renderer: {
        domElement: {
          setPointerCapture: jest.fn(),
          releasePointerCapture: jest.fn()
        }
      },
      updateHover: jest.fn(),
      getRackSnapPointFromPointer: jest.fn(() => rack.start),
      updateRackPlacementGhost: jest.fn(),
      beginRackPlacement: CityChannelThreeRuntime.prototype.beginRackPlacement,
      commitRackPlacement: CityChannelThreeRuntime.prototype.commitRackPlacement,
      notifyStatus: jest.fn(),
      clearPlacementGhost: jest.fn(),
      requestRender: jest.fn(),
      emitSelection: jest.fn()
    });

    CityChannelThreeRuntime.prototype.handleRackPlacementPointerDown.call(runtime, pointerDownEvent);

    expect(runtime.rackPlacementState.start).toEqual(rack.start);
    expect(onCommitOperations).not.toHaveBeenCalled();

    runtime.rackPlacementState = {
      start: rack.start,
      rack,
      valid: true
    };
    CityChannelThreeRuntime.prototype.handleRackPlacementPointerDown.call(runtime, pointerDownEvent);

    expect(onCommitOperations).toHaveBeenCalledWith([{
      kind: 'rack',
      action: 'place',
      rack
    }], { label: '放置双面齿条' });
    expect(runtime.pointerState.mode).toBe('rackPlaceClick');
  });

  it('does not start a double-sided rack from an empty horizontal ray', () => {
    const runtime = createRuntimeObject({
      renderModel: { mapData: createBaseCityChannelMap({ width: 4, height: 4, layers: 1 }) },
      hasPointerRay: false,
      getHoverPlacementData: jest.fn(() => null),
      getRackSnapPointFromHover: jest.fn(() => null),
      getRackSnapPointFromPointer: CityChannelThreeRuntime.prototype.getRackSnapPointFromPointer
    });

    expect(CityChannelThreeRuntime.prototype.getRackSnapPointFromPointer.call(runtime)).toBeNull();
  });

  it('does not start a double-sided rack on an installed corner gear', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4, layers: 1 });
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
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      getRackSurfaceSnapCandidatesFromPointer: jest.fn(() => []),
      getRackSnapPointFromHover: jest.fn(() => ({
        x: 0.5,
        y: 0.5,
        z: 0,
        plane: 'horizontal'
      }))
    });

    expect(CityChannelThreeRuntime.prototype.getRackStartSnapPointFromPointer.call(runtime)).toBeNull();
  });

  it('starts a double-sided rack on the hovered vertical board surface', () => {
    const wallKey = createWallKey(1, 1, 0, 'east');
    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 1 }),
      tiles: {},
      walls: { [wallKey]: wall }
    };
    const renderModel = buildCityChannelThreeRenderModel(mapData);
    const wallTransform = renderModel.walls.find((transform) => transform.key === wallKey);
    const hoverData = {
      kind: wallTransform.kind,
      key: wallTransform.key,
      placement: wallTransform.placement,
      transform: wallTransform
    };
    const runtime = createRuntimeObject({
      renderModel,
      getHoverPlacementData: jest.fn(() => hoverData),
      getHoverVerticalSurfaceSide: jest.fn(() => 'front'),
      getRackSnapPointFromHover: CityChannelThreeRuntime.prototype.getRackSnapPointFromHover,
      getRackSnapPointFromPointer: CityChannelThreeRuntime.prototype.getRackSnapPointFromPointer
    });
    runtime.hoverHit = {
      point: getThreeSurfacePoint(wallTransform, { x: 0, y: 0.1 }, { surface: 'front', lift: 0.04 })
    };

    expect(CityChannelThreeRuntime.prototype.getRackSnapPointFromPointer.call(runtime)).toMatchObject({
      plane: 'vertical',
      normalAxis: 'x',
      x: 1.5,
      y: 1.5,
      z: 0
    });
  });

  it('snaps vertical rack starts to board-boundary tangent lines', () => {
    const runtime = createRuntimeObject({});

    expect(CityChannelThreeRuntime.prototype.normalizeRackStartSnapPoint.call(runtime, {
      x: 1.49,
      y: 1.05,
      z: 0.4,
      plane: 'vertical',
      normalAxis: 'x'
    })).toMatchObject({
      plane: 'vertical',
      normalAxis: 'x',
      x: 1.5,
      y: 1.5,
      z: 0
    });
    expect(CityChannelThreeRuntime.prototype.normalizeRackStartSnapPoint.call(runtime, {
      x: 1.05,
      y: 0.51,
      z: 1.6,
      plane: 'vertical',
      normalAxis: 'y'
    })).toMatchObject({
      plane: 'vertical',
      normalAxis: 'y',
      x: 1.5,
      y: 0.5,
      z: 2
    });
  });

  it('does not use vertical tile middle faces as rack vertical planes', () => {
    const verticalTile = {
      ...createTile({
        x: 1,
        y: 1,
        z: 0,
        rotation: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      isVertical: true
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 1 }),
      tiles: {
        [createCellKey(1, 1, 0)]: verticalTile
      }
    };
    const transform = getTileThreeTransform(verticalTile, mapData);

    expect(CityChannelThreeRuntime.prototype.getRackVerticalPlaneFromPlacement.call(
      createRuntimeObject({}),
      verticalTile,
      transform
    )).toBeNull();
  });

  it('prefers a vertical board ray hit over a horizontal floor hover for rack starts', () => {
    const tileKey = createCellKey(1, 1, 0);
    const wallKey = createWallKey(1, 1, 0, 'east');
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
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 1 }),
      tiles: { [tileKey]: tile },
      walls: { [wallKey]: wall }
    };
    const renderModel = buildCityChannelThreeRenderModel(mapData);
    const tileTransform = renderModel.tiles.find((transform) => transform.key === tileKey);
    const wallTransform = renderModel.walls.find((transform) => transform.key === wallKey);
    const tileData = {
      kind: tileTransform.kind,
      key: tileTransform.key,
      placement: tileTransform.placement,
      transform: tileTransform
    };
    const wallData = {
      kind: wallTransform.kind,
      key: wallTransform.key,
      placement: wallTransform.placement,
      transform: wallTransform
    };
    const wallPoint = getThreeSurfacePoint(wallTransform, { x: 0, y: 0.1 }, { surface: 'front', lift: 0 });
    const tileObject = {
      matrixWorld: new THREE.Matrix4(),
      userData: { cityChannel: tileData }
    };
    const wallObject = {
      matrixWorld: new THREE.Matrix4(),
      userData: { cityChannel: wallData }
    };
    const runtime = createRuntimeObject({
      renderModel,
      hasPointerRay: true,
      pickables: [tileObject, wallObject],
      raycaster: {
        ray: new THREE.Ray(new THREE.Vector3(wallPoint.x + 4, wallPoint.y, wallPoint.z), new THREE.Vector3(-1, 0, 0)),
        intersectObjects: jest.fn(() => [
          {
            object: tileObject,
            point: getThreeSurfacePoint(tileTransform, { x: 0, y: 0 }, { lift: 0.04 }),
            distance: 1,
            face: { normal: new THREE.Vector3(0, 1, 0) }
          },
          {
            object: wallObject,
            point: wallPoint,
            distance: 2,
            face: { normal: new THREE.Vector3(1, 0, 0) }
          }
        ])
      },
      getRackVerticalPlaneFromPlacement: CityChannelThreeRuntime.prototype.getRackVerticalPlaneFromPlacement,
      normalizeRackStartSnapPoint: CityChannelThreeRuntime.prototype.normalizeRackStartSnapPoint,
      getRackPlacementDataFromHit: CityChannelThreeRuntime.prototype.getRackPlacementDataFromHit,
      getRackIntersectionWorldNormal: CityChannelThreeRuntime.prototype.getRackIntersectionWorldNormal,
      getRackVerticalSurfaceSideFromHit: CityChannelThreeRuntime.prototype.getRackVerticalSurfaceSideFromHit,
      getRackSnapPointFromSurfaceHit: CityChannelThreeRuntime.prototype.getRackSnapPointFromSurfaceHit,
      getRackSurfaceSnapCandidatesFromPointer: CityChannelThreeRuntime.prototype.getRackSurfaceSnapCandidatesFromPointer,
      chooseRackSurfaceSnapPoint: CityChannelThreeRuntime.prototype.chooseRackSurfaceSnapPoint,
      getRackStartSnapPointFromPointer: CityChannelThreeRuntime.prototype.getRackStartSnapPointFromPointer,
      getHoverPlacementData: jest.fn(() => tileData),
      getRackSnapPointFromHover: CityChannelThreeRuntime.prototype.getRackSnapPointFromHover,
      getRackSnapPointFromPointer: CityChannelThreeRuntime.prototype.getRackSnapPointFromPointer,
      getRackHorizontalSnapPointFromPointerRay: jest.fn(() => ({ x: 1.5, y: 1.5, z: 0, plane: 'horizontal' }))
    });
    runtime.hoverHit = {
      point: getThreeSurfacePoint(tileTransform, { x: 0, y: 0 }, { lift: 0.04 })
    };

    expect(CityChannelThreeRuntime.prototype.getRackSnapPointFromPointer.call(runtime)).toMatchObject({
      plane: 'vertical',
      normalAxis: 'x',
      x: 1.5,
      y: 1.5,
      z: 0
    });
  });

  it('keeps rack extension on the vertical plane when a floor is the nearest hit', () => {
    const tileKey = createCellKey(1, 1, 0);
    const wallKey = createWallKey(1, 1, 0, 'east');
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
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: { [tileKey]: tile },
      walls: { [wallKey]: wall }
    };
    const renderModel = buildCityChannelThreeRenderModel(mapData);
    const tileTransform = renderModel.tiles.find((transform) => transform.key === tileKey);
    const wallTransform = renderModel.walls.find((transform) => transform.key === wallKey);
    const tileData = {
      kind: tileTransform.kind,
      key: tileTransform.key,
      placement: tileTransform.placement,
      transform: tileTransform
    };
    const wallData = {
      kind: wallTransform.kind,
      key: wallTransform.key,
      placement: wallTransform.placement,
      transform: wallTransform
    };
    const tileObject = {
      matrixWorld: new THREE.Matrix4(),
      userData: { cityChannel: tileData }
    };
    const wallObject = {
      matrixWorld: new THREE.Matrix4(),
      userData: { cityChannel: wallData }
    };
    const runtime = createRuntimeObject({
      renderModel,
      hasPointerRay: true,
      pickables: [tileObject, wallObject],
      raycaster: {
        ray: new THREE.Ray(new THREE.Vector3(4, 0.4, 0), new THREE.Vector3(-1, 0, 0)),
        intersectObjects: jest.fn(() => [
          {
            object: tileObject,
            point: getThreeSurfacePoint(tileTransform, { x: 0, y: 0 }, { lift: 0.04 }),
            distance: 1,
            face: { normal: new THREE.Vector3(0, 1, 0) }
          },
          {
            object: wallObject,
            point: getThreeSurfacePoint(wallTransform, { x: 0.5, y: 0.1 }, { surface: 'front', lift: 0 }),
            distance: 2,
            face: { normal: new THREE.Vector3(1, 0, 0) }
          }
        ])
      },
      rackPlacementState: {
        start: {
          x: 1.5,
          y: 0.5,
          z: 0,
          plane: 'vertical',
          normalAxis: 'x',
          normalSign: 1
        }
      },
      getHoverPlacementData: jest.fn(() => tileData)
    });

    const rack = CityChannelThreeRuntime.prototype.getRackPlacementPreviewFromPointer.call(runtime);

    expect(rack).toMatchObject({
      plane: 'vertical',
      direction: 'y',
      start: { x: 1.5, y: 0.5, z: 0 },
      end: { x: 1.5, y: 1.5, z: 0 }
    });
  });

  it('extends a rack from a vertical start when height drag dominates', () => {
    const mapData = createBaseCityChannelMap({ width: 6, height: 6, layers: 4 });
    const start = {
      x: 1.5,
      y: 0.5,
      z: 0,
      plane: 'vertical',
      normalAxis: 'x',
      normalSign: 1
    };
    const endPoint = {
      x: 4.5,
      y: 1,
      z: 2.4,
      plane: 'vertical',
      normalAxis: 'x',
      normalSign: 1
    };
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      rackPlacementState: { start },
      getRackSnapPointFromPointer: jest.fn(() => endPoint),
      getRackPlacementPreviewFromPointer: CityChannelThreeRuntime.prototype.getRackPlacementPreviewFromPointer
    });

    const rack = CityChannelThreeRuntime.prototype.getRackPlacementPreviewFromPointer.call(runtime);

    expect(rack).toMatchObject({
      plane: 'vertical',
      direction: 'z',
      start: { x: 1.5, y: 0.5, z: 0 },
      end: { x: 1.5, y: 0.5, z: 2 }
    });
  });

  it('extends a rack along the vertical board tangent when surface drag dominates', () => {
    const mapData = createBaseCityChannelMap({ width: 6, height: 6, layers: 4 });
    const start = {
      x: 1.5,
      y: 0.5,
      z: 0,
      plane: 'vertical',
      normalAxis: 'x',
      normalSign: 1
    };
    const endPoint = {
      x: 1.5,
      y: 3.5,
      z: 0.4,
      plane: 'vertical',
      normalAxis: 'x',
      normalSign: 1
    };
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      rackPlacementState: { start },
      getRackSnapPointFromPointer: jest.fn(() => endPoint)
    });

    const rack = CityChannelThreeRuntime.prototype.getRackPlacementPreviewFromPointer.call(runtime);

    expect(rack).toMatchObject({
      plane: 'vertical',
      direction: 'y',
      start: { x: 1.5, y: 0.5, z: 0 },
      end: { x: 1.5, y: 3.5, z: 0 }
    });
  });

  it('clips vertical-plane rack extension before an installed corner gear blocker', () => {
    const wallKey = createWallKey(1, 2, 0, 'east');
    const wall = createWall({
      x: 1,
      y: 2,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    wall.gearMounts = [{
      id: 'gear_blocker',
      componentType: 'gear',
      position: 'corner_se',
      surface: 'front'
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 6, height: 6, layers: 2 }),
      tiles: {},
      walls: { [wallKey]: wall }
    };
    const start = {
      x: 1.5,
      y: 0.5,
      z: 0,
      plane: 'vertical',
      normalAxis: 'x',
      normalSign: 1
    };
    const endPoint = {
      x: 1.5,
      y: 4.5,
      z: 0,
      plane: 'vertical',
      normalAxis: 'x',
      normalSign: 1
    };
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      rackPlacementState: { start },
      getRackSnapPointFromPointer: jest.fn(() => endPoint)
    });

    const rack = CityChannelThreeRuntime.prototype.getRackPlacementPreviewFromPointer.call(runtime);

    expect(rack).toMatchObject({
      plane: 'vertical',
      direction: 'y',
      start: { x: 1.5, y: 0.5, z: 0 },
      end: { x: 1.5, y: 1.5, z: 0 }
    });
  });

  it('keeps rack placement valid when any segment has side board support', () => {
    const mapData = createBaseCityChannelMap({ width: 4, height: 4, layers: 1 });
    mapData.tiles[createCellKey(1, 0, 0)] = createTile({
      x: 1,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const rack = {
      id: 'rack_missing_support',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'horizontal',
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    };
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      getRackPlacementPreviewFromPointer: jest.fn(() => rack),
      createRackRenderGroup: jest.fn(() => new THREE.Group()),
      replaceGhostGroup: jest.fn(),
      requestRender: jest.fn(),
      emitStatus: jest.fn()
    });

    CityChannelThreeRuntime.prototype.updateRackPlacementGhost.call(runtime);

    expect(runtime.rackPlacementState).toMatchObject({
      rack,
      valid: true,
      blockReason: 'ok'
    });
    expect(runtime.createRackRenderGroup).toHaveBeenCalledWith(
      rack,
      expect.objectContaining({
        showTeeth: true
      })
    );
  });

  it('renders a vertical rack ghost with its body axis upright', () => {
    const runtime = createRuntimeObject({
      renderModel: {
        mapData: createBaseCityChannelMap({ width: 6, height: 6, layers: 4 })
      },
      ghostValidMaterial: new THREE.MeshBasicMaterial(),
      ghostInvalidMaterial: new THREE.MeshBasicMaterial(),
      ghostValidOutlineMaterial: new THREE.LineBasicMaterial(),
      rackMaterial: new THREE.MeshBasicMaterial(),
      rackEdgeMaterial: new THREE.LineBasicMaterial()
    });
    const rack = {
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      direction: 'z',
      normalAxis: 'x',
      normalSign: 1,
      start: { x: 1.5, y: 0.5, z: 0 },
      end: { x: 1.5, y: 0.5, z: 1 }
    };

    const group = CityChannelThreeRuntime.prototype.createRackRenderGroup.call(runtime, rack, {
      ghost: true,
      showTeeth: false
    });
    const body = group.children[0];
    const bodyAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(body.quaternion);

    expect(Math.abs(bodyAxis.y)).toBeGreaterThan(0.99);
  });

  it('renders an installed elevated vertical rack outside the host board plane', () => {
    const runtime = createRuntimeObject({
      renderModel: {
        mapData: createBaseCityChannelMap({ width: 6, height: 6, layers: 4 })
      },
      rackMaterial: new THREE.MeshBasicMaterial(),
      rackToothMaterial: new THREE.MeshBasicMaterial(),
      rackEdgeMaterial: new THREE.LineBasicMaterial(),
      pickables: [],
      rackMeshes: new Map(),
      rackGroups: new Map()
    });
    const rack = {
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      direction: 'z',
      normalAxis: 'x',
      normalSign: 1,
      start: { x: 1.5, y: 0.5, z: 1 },
      end: { x: 1.5, y: 0.5, z: 2 }
    };

    const group = CityChannelThreeRuntime.prototype.createRackRenderGroup.call(runtime, rack, {
      ghost: false,
      showTeeth: false
    });
    const body = group.children[0];

    expect(body.position.x).toBeGreaterThan(
      CityChannelThreeRuntime.prototype.rackPointToThree.call(runtime, rack.start, 0, rack).x
    );
  });

  it('builds elevated rack meshes when runtime layer cutoff is disabled', () => {
    const rack = {
      id: 'rack_upper',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      direction: 'y',
      normalAxis: 'x',
      z: 1,
      start: { x: 1.5, y: 0.5, z: 1 },
      end: { x: 1.5, y: 2.5, z: 1 }
    };
    const createRuntime = () => {
      const group = new THREE.Group();
      return createRuntimeObject({
        renderModel: {
          mapData: {
            ...createBaseCityChannelMap({ width: 6, height: 6, layers: 4 }),
            racks: { [rack.id]: rack }
          }
        },
        worldGroup: new THREE.Group(),
        createRackRenderGroup: jest.fn(() => group)
      });
    };
    const hiddenRuntime = createRuntime();
    const visibleRuntime = createRuntime();

    CityChannelThreeRuntime.prototype.addRacks.call(hiddenRuntime, 0);
    CityChannelThreeRuntime.prototype.addRacks.call(visibleRuntime, null);

    expect(hiddenRuntime.createRackRenderGroup).not.toHaveBeenCalled();
    expect(hiddenRuntime.worldGroup.children).toHaveLength(0);
    expect(visibleRuntime.createRackRenderGroup).toHaveBeenCalledWith(
      rack,
      expect.objectContaining({ renderOrder: expect.any(Number) })
    );
    expect(visibleRuntime.worldGroup.children).toHaveLength(1);
  });

  it('renders a vertical rack tangent ghost horizontally within the wall plane', () => {
    const runtime = createRuntimeObject({
      renderModel: {
        mapData: createBaseCityChannelMap({ width: 6, height: 6, layers: 4 })
      },
      ghostValidMaterial: new THREE.MeshBasicMaterial(),
      ghostInvalidMaterial: new THREE.MeshBasicMaterial(),
      ghostValidOutlineMaterial: new THREE.LineBasicMaterial(),
      rackMaterial: new THREE.MeshBasicMaterial(),
      rackEdgeMaterial: new THREE.LineBasicMaterial()
    });
    const rack = {
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      direction: 'y',
      normalAxis: 'x',
      normalSign: 1,
      start: { x: 1.5, y: 0.5, z: 0 },
      end: { x: 1.5, y: 3.5, z: 0 }
    };

    const group = CityChannelThreeRuntime.prototype.createRackRenderGroup.call(runtime, rack, {
      ghost: true,
      showTeeth: false
    });
    const body = group.children[0];
    const bodyAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(body.quaternion);

    expect(Math.abs(bodyAxis.y)).toBeLessThan(0.01);
    expect(Math.abs(bodyAxis.z)).toBeGreaterThan(0.99);
  });

  it('uses embedded highlight materials only in solid wall view mode', () => {
    const entityGearMaterial = new THREE.MeshBasicMaterial();
    const embeddedGearMaterial = new THREE.MeshBasicMaterial();
    const entityRackMaterial = new THREE.MeshBasicMaterial();
    const embeddedRackMaterial = new THREE.MeshBasicMaterial();
    const runtime = createRuntimeObject({
      config: { wallViewMode: 'semi' },
      gearMaterial: entityGearMaterial,
      gearSpokeMaterial: new THREE.MeshBasicMaterial(),
      gearHubMaterial: new THREE.MeshBasicMaterial(),
      gearAxleMaterial: new THREE.MeshBasicMaterial(),
      gearEdgeMaterial: new THREE.LineBasicMaterial(),
      gearReliefMaterial: new THREE.MeshBasicMaterial(),
      gearHaloMaterial: new THREE.MeshBasicMaterial(),
      gearTimingMarkerMaterial: new THREE.MeshBasicMaterial(),
      embeddedGearOutlineMaterial: embeddedGearMaterial,
      embeddedGearDetailMaterial: new THREE.MeshBasicMaterial(),
      embeddedGearEdgeMaterial: new THREE.LineBasicMaterial(),
      rackMaterial: entityRackMaterial,
      rackToothMaterial: new THREE.MeshBasicMaterial(),
      rackEdgeMaterial: new THREE.LineBasicMaterial(),
      embeddedRackMaterial,
      embeddedRackToothMaterial: new THREE.MeshBasicMaterial(),
      embeddedRackEdgeMaterial: new THREE.LineBasicMaterial()
    });

    expect(CityChannelThreeRuntime.prototype.getGearVisualMaterials.call(runtime).body)
      .toBe(entityGearMaterial);
    expect(CityChannelThreeRuntime.prototype.getRackVisualMaterials.call(runtime).body)
      .toBe(entityRackMaterial);

    runtime.config.wallViewMode = 'solid';

    expect(CityChannelThreeRuntime.prototype.getGearVisualMaterials.call(runtime).body)
      .toBe(embeddedGearMaterial);
    expect(CityChannelThreeRuntime.prototype.getRackVisualMaterials.call(runtime).body)
      .toBe(embeddedRackMaterial);
  });

  it('keeps rack teeth in highlighted ghost geometry', () => {
    const runtime = createRuntimeObject({
      renderModel: {
        mapData: createBaseCityChannelMap({ width: 6, height: 6, layers: 1 })
      },
      ghostValidMaterial: new THREE.MeshBasicMaterial(),
      ghostInvalidMaterial: new THREE.MeshBasicMaterial(),
      ghostValidOutlineMaterial: new THREE.LineBasicMaterial(),
      rackMaterial: new THREE.MeshBasicMaterial(),
      rackToothMaterial: new THREE.MeshBasicMaterial(),
      rackEdgeMaterial: new THREE.LineBasicMaterial()
    });
    const rack = {
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'horizontal',
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    };

    const group = CityChannelThreeRuntime.prototype.createRackRenderGroup.call(runtime, rack, {
      ghost: true,
      showTeeth: true
    });
    const toothMeshes = group.children.filter((child) => (
      child.type === 'Mesh'
      && child.userData?.cityChannel?.kind === 'rackTooth'
    ));

    expect(toothMeshes.length).toBeGreaterThan(0);
    toothMeshes[0].geometry.computeBoundingBox();
    const toothDepth = toothMeshes[0].geometry.boundingBox.max.z - toothMeshes[0].geometry.boundingBox.min.z;
    expect(toothDepth).toBeCloseTo(DOUBLE_SIDED_RACK_TOOTH_DEPTH_WORLD, 6);
    expect(toothDepth).toBeLessThan(0.1);
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

  it('routes rack carry R and Space to rack orientation and plane changes', () => {
    const runtime = createRuntimeObject({
      carryState: {
        mode: 'move',
        componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
        plane: RACK_PLANES.HORIZONTAL,
        direction: RACK_DIRECTIONS.X,
        normalAxis: RACK_DIRECTIONS.Y,
        length: 2
      },
      notifyStatus: jest.fn(),
      updateCarryGhost: jest.fn(),
      requestRender: jest.fn()
    });

    expect(CityChannelThreeRuntime.prototype.rotateCarryPlacementSurface.call(runtime)).toBe(true);
    expect(runtime.carryState.direction).toBe(RACK_DIRECTIONS.Y);

    expect(CityChannelThreeRuntime.prototype.cycleCarrySnapAxisRotation.call(runtime)).toBe(true);
    expect(runtime.carryState.plane).toBe(RACK_PLANES.VERTICAL);
    expect(runtime.carryState.normalAxis).toBe(RACK_DIRECTIONS.X);
    expect(runtime.updateCarryGhost).toHaveBeenCalledTimes(2);
  });

  it('rejects gear install targets that overlap a rack', () => {
    const hostKey = createCellKey(1, 1, 0);
    const host = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 1 }),
      tiles: { [hostKey]: host },
      walls: {},
      racks: {
        rack_overlap: {
          id: 'rack_overlap',
          componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
          direction: 'x',
          z: 0,
          start: { x: 0.5, y: 0.5, z: 0 },
          end: { x: 2.5, y: 0.5, z: 0 }
        }
      }
    };
    const transform = getTileThreeTransform(host, mapData);
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      pickables: [],
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
        activeComponentType: 'gear'
      },
      getHoverPlacementData: jest.fn(() => ({
        kind: 'tile',
        key: hostKey,
        placement: host,
        transform
      })),
      getHoverLocalPoint: jest.fn(() => ({ x: 0.5, y: -0.5 }))
    });

    const target = CityChannelThreeRuntime.prototype.getGearInstallTargetFromHoverHit.call(runtime);

    expect(target).toMatchObject({
      valid: false,
      reason: 'rack_overlap'
    });
  });

  it('rejects gear install targets whose vertical gear body would go below ground', () => {
    const wallKey = createWallKey(1, 1, 0, 'east');
    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 1 }),
      tiles: {},
      walls: { [wallKey]: wall }
    };
    const transform = getWallThreeTransform(wall, mapData);
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
        activeComponentType: 'gear'
      },
      getHoverPlacementData: jest.fn(() => ({
        kind: 'wall',
        key: wallKey,
        placement: wall,
        transform
      })),
      getHoverVerticalSurfaceSide: jest.fn(() => 'front'),
      getHoverLocalPoint: jest.fn(() => ({ x: 0.5, y: 0.5 }))
    });

    const target = CityChannelThreeRuntime.prototype.getGearInstallTargetFromHoverHit.call(runtime);

    expect(target).toMatchObject({
      valid: false,
      reason: 'below_ground',
      point: expect.any(Object)
    });
  });

  it('rejects gear move targets whose vertical gear body would go below ground', () => {
    const wallKey = createWallKey(1, 1, 0, 'east');
    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 1 }),
      tiles: {},
      walls: { [wallKey]: wall }
    };
    const transform = getWallThreeTransform(wall, mapData);
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      carryState: {
        componentType: 'gear',
        gear: {
          hostKind: 'tile',
          hostKey: createCellKey(0, 0, 0),
          mount: { id: 'gear_source', position: 'center', surface: 'front' }
        }
      },
      getHoverPlacementData: jest.fn(() => ({
        kind: 'wall',
        key: wallKey,
        placement: wall,
        transform
      })),
      getHoverVerticalSurfaceSide: jest.fn(() => 'front'),
      getHoverLocalPoint: jest.fn(() => ({ x: 0.5, y: 0.5 }))
    });

    const target = CityChannelThreeRuntime.prototype.getGearMoveTargetFromHoverHit.call(runtime);

    expect(target).toMatchObject({
      valid: false,
      reason: 'below_ground',
      point: expect.any(Object)
    });
  });

  it('keeps a horizontal placement snap target while rotating the active surface with R', () => {
    const mapData = {
      ...createBaseCityChannelMap({ width: 6, height: 6, layers: 2 }),
      tiles: {},
      walls: {}
    };
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      pointerSnapVersion: 4,
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        activeRotation: 0,
        activeLayer: 0,
        panelPose: 'floor',
        onRotateActive: jest.fn()
      },
      hasPointerRay: true,
      getPlacementTargetFromPointerRay: jest.fn(() => null),
      createBoardGhostGroup: jest.fn(() => new THREE.Group()),
      replaceGhostGroup: jest.fn(),
      clearPlacementGhost: jest.fn(),
      emitStatus: jest.fn(),
      requestRender: jest.fn()
    });
    runtime.placementTarget = CityChannelThreeRuntime.prototype.createTileTarget.call(runtime, { x: 2, y: 1, z: 0 }, {
      isVertical: false,
      rotation: 0,
      allowReplacement: false,
      snapMode: 'edgeSnap'
    });
    runtime.placementTarget.pointerSnapVersion = 4;

    expect(CityChannelThreeRuntime.prototype.handleRotateSurface.call(runtime, 'forward')).toBe(true);

    expect(runtime.config.onRotateActive).toHaveBeenCalledWith(90);
    expect(runtime.placementTarget).toMatchObject({
      cell: { x: 2, y: 1, z: 0 },
      kind: 'tile',
      snapMode: 'edgeSnap',
      pointerSnapVersion: 4
    });
    expect(runtime.placementTarget.transform.placement).toMatchObject({
      x: 2,
      y: 1,
      z: 0,
      rotation: 90,
      transmissionRotation: 90
    });
    expect(runtime.clearPlacementGhost).not.toHaveBeenCalled();
    expect(runtime.replaceGhostGroup).toHaveBeenCalledTimes(1);
  });

  it('refreshes the current pointer state when rotating an active placement with R', () => {
    const mapData = {
      ...createBaseCityChannelMap({ width: 6, height: 6, layers: 2 }),
      tiles: {},
      walls: {}
    };
    const lastPointerEvent = { clientX: 180, clientY: 120 };
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      pointerSnapVersion: 6,
      lastPointerEvent,
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        activeRotation: 0,
        activeLayer: 0,
        panelPose: 'floor',
        onRotateActive: jest.fn()
      },
      renderer: {
        domElement: {}
      },
      raycaster: {},
      camera: {},
      updateHover: jest.fn(function updateHover() {
        this.pointerSnapVersion = 7;
      }),
      getPlacementTargetFromPointerRay: jest.fn(() => null),
      createBoardGhostGroup: jest.fn(() => new THREE.Group()),
      replaceGhostGroup: jest.fn(),
      clearPlacementGhost: jest.fn(),
      emitStatus: jest.fn(),
      requestRender: jest.fn()
    });
    runtime.placementTarget = CityChannelThreeRuntime.prototype.createTileTarget.call(runtime, { x: 2, y: 1, z: 0 }, {
      isVertical: false,
      rotation: 0,
      allowReplacement: false,
      snapMode: 'edgeSnap'
    });
    runtime.placementTarget.pointerSnapVersion = 6;

    expect(CityChannelThreeRuntime.prototype.handleRotateSurface.call(runtime, 'forward')).toBe(true);

    expect(runtime.updateHover).toHaveBeenCalledWith(lastPointerEvent);
    expect(runtime.placementTarget.pointerSnapVersion).toBe(7);
    expect(runtime.placementTarget.transform.placement).toMatchObject({
      rotation: 90,
      transmissionRotation: 90
    });
    expect(runtime.clearPlacementGhost).not.toHaveBeenCalled();
    expect(runtime.replaceGhostGroup).toHaveBeenCalledTimes(1);
  });

  it('uses the cached placement snap target when rotating after the live target was cleared', () => {
    const mapData = {
      ...createBaseCityChannelMap({ width: 6, height: 6, layers: 2 }),
      tiles: {},
      walls: {}
    };
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      pointerSnapVersion: 8,
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        activeRotation: 0,
        activeLayer: 0,
        panelPose: 'floor',
        onRotateActive: jest.fn()
      },
      getPlacementTargetFromPointerRay: jest.fn(() => null),
      createBoardGhostGroup: jest.fn(() => new THREE.Group()),
      replaceGhostGroup: jest.fn(),
      clearPlacementGhost: jest.fn(),
      emitStatus: jest.fn(),
      requestRender: jest.fn()
    });
    const cachedTarget = CityChannelThreeRuntime.prototype.createTileTarget.call(runtime, { x: 2, y: 1, z: 0 }, {
      isVertical: false,
      rotation: 0,
      allowReplacement: false,
      snapMode: 'edgeSnap'
    });
    cachedTarget.pointerSnapVersion = 8;
    runtime.placementTarget = null;
    runtime.placementSnapTarget = cachedTarget;
    runtime.placementSnapPointerVersion = 8;

    expect(CityChannelThreeRuntime.prototype.handleRotateSurface.call(runtime, 'forward')).toBe(true);

    expect(runtime.placementTarget).toMatchObject({
      cell: { x: 2, y: 1, z: 0 },
      kind: 'tile',
      pointerSnapVersion: 8
    });
    expect(runtime.placementTarget.transform.placement).toMatchObject({
      rotation: 90,
      transmissionRotation: 90
    });
    expect(runtime.clearPlacementGhost).not.toHaveBeenCalled();
    expect(runtime.replaceGhostGroup).toHaveBeenCalledTimes(1);
  });

  it('keeps the displayed placement ghost if rotation target recreation fails', () => {
    const mapData = {
      ...createBaseCityChannelMap({ width: 6, height: 6, layers: 2 }),
      tiles: {},
      walls: {}
    };
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      pointerSnapVersion: 3,
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        activeRotation: 0,
        activeLayer: 0,
        panelPose: 'floor'
      },
      recreatePlacementTargetForCurrentRotation: jest.fn(() => null),
      updatePlacementGhost: jest.fn(),
      createBoardGhostGroup: jest.fn(() => new THREE.Group()),
      replaceGhostGroup: jest.fn(),
      clearPlacementGhost: jest.fn(),
      emitStatus: jest.fn(),
      requestRender: jest.fn()
    });
    runtime.placementTarget = CityChannelThreeRuntime.prototype.createTileTarget.call(runtime, { x: 2, y: 1, z: 0 }, {
      isVertical: false,
      rotation: 0,
      allowReplacement: false,
      snapMode: 'edgeSnap'
    });
    runtime.placementTarget.pointerSnapVersion = 3;

    const result = CityChannelThreeRuntime.prototype.refreshPlacementGhostAtCurrentTarget.call(runtime, runtime.placementTarget);

    expect(result).toBe(runtime.placementTarget);
    expect(runtime.updatePlacementGhost).not.toHaveBeenCalled();
    expect(runtime.clearPlacementGhost).not.toHaveBeenCalled();
    expect(runtime.replaceGhostGroup).toHaveBeenCalledTimes(1);
  });

  it('refreshes the current placement target when React echoes activeRotation', () => {
    const placementTarget = {
      cell: { x: 2, y: 1, z: 0 },
      kind: 'tile',
      transform: { placement: { x: 2, y: 1, z: 0 } }
    };
    const runtime = createRuntimeObject({
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        activeRotation: 0,
        selection: {}
      },
      pointerSnapVersion: 1,
      placementTarget,
      refreshPlacementGhostAtCurrentTarget: jest.fn(),
      updateActiveGhost: jest.fn(),
      syncSelectionFromConfig: jest.fn(),
      emitStatus: jest.fn(),
      emitCamera: jest.fn(),
      requestRender: jest.fn()
    });
    placementTarget.pointerSnapVersion = 1;

    CityChannelThreeRuntime.prototype.setConfig.call(runtime, { activeRotation: 90 });

    expect(runtime.refreshPlacementGhostAtCurrentTarget).toHaveBeenCalledWith(placementTarget);
    expect(runtime.updateActiveGhost).not.toHaveBeenCalled();
  });

  it('does not rebuild the map when activeRotation updates with the same mapData source', () => {
    const mapData = {
      ...createBaseCityChannelMap({ width: 6, height: 6, layers: 2 }),
      tiles: {},
      walls: {}
    };
    const placementTarget = {
      cell: { x: 2, y: 1, z: 0 },
      kind: 'tile',
      transform: { placement: { x: 2, y: 1, z: 0 } },
      pointerSnapVersion: 4
    };
    const runtime = createRuntimeObject({
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        activeRotation: 0,
        visibleLayerCutoff: null,
        showHelperGrid: false,
        showCoordinates: false,
        wallViewMode: 'semi',
        selection: {}
      },
      mapDataSource: mapData,
      renderModel: {
        mapData: { ...mapData },
        tiles: [],
        walls: []
      },
      pointerSnapVersion: 4,
      placementTarget,
      refreshPlacementGhostAtCurrentTarget: jest.fn(),
      updateActiveGhost: jest.fn(),
      syncSelectionFromConfig: jest.fn(),
      emitStatus: jest.fn(),
      emitCamera: jest.fn(),
      requestRender: jest.fn(),
      setMapData: jest.fn(),
      rebuildMap: jest.fn()
    });

    CityChannelThreeRuntime.prototype.updateConfig.call(runtime, {
      mapData,
      activeRotation: 90
    });

    expect(runtime.setMapData).not.toHaveBeenCalled();
    expect(runtime.rebuildMap).not.toHaveBeenCalled();
    expect(runtime.refreshPlacementGhostAtCurrentTarget).toHaveBeenCalledWith(placementTarget);
  });

  it('keeps a replacement placement target while rotating the active surface with R', () => {
    const source = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      rotation: 0,
      transmissionRotation: 0
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 6, height: 6, layers: 2 }),
      tiles: {
        [createCellKey(2, 1, 0)]: source
      },
      walls: {}
    };
    const sourceTransform = getTileThreeTransform(source, mapData);
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      pointerSnapVersion: 6,
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        activeRotation: 0,
        activeLayer: 0,
        panelPose: 'floor',
        onRotateActive: jest.fn()
      },
      getPlacementTargetFromPointerRay: jest.fn(() => null),
      createBoardGhostGroup: jest.fn(() => new THREE.Group()),
      replaceGhostGroup: jest.fn(),
      clearPlacementGhost: jest.fn(),
      emitStatus: jest.fn(),
      requestRender: jest.fn()
    });
    runtime.placementTarget = CityChannelThreeRuntime.prototype.createReplacementTargetForPlacement.call(
      runtime,
      source,
      sourceTransform
    );
    runtime.placementTarget.pointerSnapVersion = 6;

    expect(CityChannelThreeRuntime.prototype.handleRotateSurface.call(runtime, 'forward')).toBe(true);

    expect(runtime.config.onRotateActive).toHaveBeenCalledWith(90);
    expect(runtime.placementTarget).toMatchObject({
      cell: { x: 2, y: 1, z: 0 },
      kind: 'tile',
      replace: true,
      snapMode: 'replace',
      pointerSnapVersion: 6
    });
    expect(runtime.placementTarget.operation).toMatchObject({
      kind: 'tile',
      cell: { x: 2, y: 1, z: 0 },
      rotation: 90,
      transmissionRotation: 90
    });
    expect(runtime.placementTarget.transform.placement).toMatchObject({
      x: 2,
      y: 1,
      z: 0,
      rotation: 90,
      transmissionRotation: 90
    });
    expect(runtime.clearPlacementGhost).not.toHaveBeenCalled();
    expect(runtime.replaceGhostGroup).toHaveBeenCalledTimes(1);
  });

  it('keeps a horizontal carry snap target while rotating the carried surface with R', () => {
    const sourceKey = createCellKey(3, 4, 0);
    const source = createTile({
      x: 3,
      y: 4,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
      rotation: 0,
      transmissionRotation: 0
    });
    const runtime = createRuntimeObject({
      renderModel: {
        mapData: {
          ...createBaseCityChannelMap({ width: 8, height: 8, layers: 2 }),
          tiles: { [sourceKey]: source },
          walls: {}
        }
      },
      pointerSnapVersion: 9,
      carrySnapPointerVersion: 9,
      carrySnapTargetCell: { x: 4, y: 4, z: 0, layFlat: true },
      carryState: {
        mode: 'move',
        origins: [{ x: 3, y: 4, z: 0 }],
        defaultPose: 'floor',
        surfaceRotation: 0,
        groupRotationSteps: 0,
        groupPoseSteps: 0
      },
      getCarryTargetFromPointerRay: jest.fn(() => null),
      createBoardGhostGroup: jest.fn(() => new THREE.Group()),
      replaceGhostGroup: jest.fn(),
      notifyStatus: jest.fn(),
      requestRender: jest.fn()
    });

    expect(CityChannelThreeRuntime.prototype.rotateCarryPlacementSurface.call(runtime, 'forward')).toBe(true);

    expect(runtime.carryState.surfaceRotation).toBe(90);
    expect(runtime.getCarryTargetFromPointerRay).toHaveBeenCalled();
    expect(runtime.replaceGhostGroup).toHaveBeenCalledTimes(1);
    expect(runtime.carrySnapTargetCell).toEqual({ x: 4, y: 4, z: 0, layFlat: true });
    const ghostTransform = runtime.createBoardGhostGroup.mock.calls[0][0];
    expect(ghostTransform.placement).toMatchObject({
      x: 4,
      y: 4,
      z: 0,
      rotation: 90,
      transmissionRotation: 90
    });
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

describe('CityChannelThreeRuntime board interaction component passthrough', () => {
  const tileData = {
    kind: 'tile',
    placement: { x: 1, y: 1, z: 0 },
    transform: { kind: 'tile' }
  };
  const gearData = {
    kind: 'gear',
    placement: { x: 1, y: 1, z: 0 },
    hostKey: createCellKey(1, 1, 0),
    hostKind: 'tile'
  };

  it('uses the board behind a gear while placing a board', () => {
    const gearObject = { userData: { cityChannel: gearData } };
    const tileObject = { userData: { cityChannel: tileData } };
    const runtime = createRuntimeObject({
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      },
      carryState: null
    });

    const hit = CityChannelThreeRuntime.prototype.choosePickableHit.call(runtime, [
      { object: gearObject, distance: 1 },
      { object: tileObject, distance: 2 }
    ]);

    expect(hit.object).toBe(tileObject);
  });

  it('keeps component priority outside board placement and movement', () => {
    const gearObject = { userData: { cityChannel: gearData } };
    const tileObject = { userData: { cityChannel: tileData } };
    const runtime = createRuntimeObject({
      config: {
        activeTool: CITY_CHANNEL_TOOLS.SELECT,
        activeTileType: null
      },
      carryState: null
    });

    const hit = CityChannelThreeRuntime.prototype.choosePickableHit.call(runtime, [
      { object: tileObject, distance: 1 },
      { object: gearObject, distance: 2 }
    ]);

    expect(hit.object).toBe(gearObject);
  });

  it('shows component blockers as passthrough ghost frames and restores them', () => {
    const gearMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b, opacity: 0.98, transparent: true });
    const rackMaterial = new THREE.MeshBasicMaterial({ color: 0x334155, opacity: 0.96, transparent: true });
    const rackEdgeMaterial = new THREE.LineBasicMaterial({ color: 0xfef3c7, opacity: 0.86, transparent: true });
    const gearObject = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), gearMaterial);
    gearObject.userData.cityChannel = gearData;
    gearObject.userData.sharedMaterial = true;
    const directionIcon = new THREE.Group();
    directionIcon.visible = true;
    directionIcon.userData.cityChannelGearRole = 'gear_direction_icon';
    directionIcon.position.copy(gearObject.position);
    const rackGroup = new THREE.Group();
    const rackObject = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 0.16), rackMaterial);
    rackObject.userData.cityChannel = {
      kind: 'rack',
      key: 'rack_1',
      rackId: 'rack_1'
    };
    rackObject.userData.sharedMaterial = true;
    const rackEdge = new THREE.LineSegments(new THREE.BufferGeometry(), rackEdgeMaterial);
    rackEdge.userData.sharedMaterial = true;
    rackGroup.add(rackObject);
    rackGroup.add(rackEdge);
    const runtime = createRuntimeObject({
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      },
      carryState: null,
      overlayGroup: {
        children: [directionIcon]
      },
      rackGroups: new Map([['rack_1', rackGroup]]),
      transientPassthroughComponentState: new Map(),
      requestRender: jest.fn()
    });

    CityChannelThreeRuntime.prototype.syncTransientPassthroughComponentGhosts.call(runtime, [
      { object: gearObject },
      { object: rackObject }
    ]);

    expect(gearObject.material).not.toBe(gearMaterial);
    expect(gearObject.material.wireframe).toBe(true);
    expect(gearObject.material.opacity).toBeLessThan(0.2);
    expect(rackObject.material).not.toBe(rackMaterial);
    expect(rackObject.material.wireframe).toBe(true);
    expect(rackEdge.material.opacity).toBeGreaterThan(0.7);
    expect(gearObject.userData.sharedMaterial).toBe(false);
    expect(directionIcon.visible).toBe(false);

    CityChannelThreeRuntime.prototype.syncTransientPassthroughComponentGhosts.call(runtime, []);

    expect(gearObject.material).toBe(gearMaterial);
    expect(rackObject.material).toBe(rackMaterial);
    expect(rackEdge.material).toBe(rackEdgeMaterial);
    expect(gearObject.userData.sharedMaterial).toBe(true);
    expect(directionIcon.visible).toBe(true);
    expect(runtime.requestRender).toHaveBeenCalledTimes(2);
  });

  it('uses the board behind a gear while placing another gear component', () => {
    const gearMaterial = new THREE.MeshBasicMaterial();
    const gearObject = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), gearMaterial);
    gearObject.userData.cityChannel = gearData;
    gearObject.userData.sharedMaterial = true;
    const tileObject = { userData: { cityChannel: tileData } };
    const runtime = createRuntimeObject({
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
        activeComponentType: 'gear'
      },
      carryState: null,
      transientPassthroughComponentState: new Map(),
      requestRender: jest.fn()
    });

    const hit = CityChannelThreeRuntime.prototype.choosePickableHit.call(runtime, [
      { object: gearObject, distance: 1 },
      { object: tileObject, distance: 2 }
    ]);
    CityChannelThreeRuntime.prototype.syncTransientPassthroughComponentGhosts.call(runtime, [
      { object: gearObject }
    ]);

    expect(hit.object).toBe(tileObject);
    expect(gearObject.material).not.toBe(gearMaterial);
    expect(gearObject.material.wireframe).toBe(true);
    expect(gearObject.material.opacity).toBeLessThan(0.2);
    expect(runtime.requestRender).toHaveBeenCalledTimes(1);
  });

  it('does not redraw a direction icon for a passthrough ghosted gear', () => {
    const gearObject = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const runtime = createRuntimeObject({
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      },
      overlayGroup: new THREE.Group(),
      gearMeshes: new Map([[`${gearData.hostKey}:gear_a`, gearObject]]),
      transientPassthroughComponentState: new Map([[gearObject, { root: gearObject }]]),
      getHoveredGearDirectionIconContext: jest.fn(() => ({
        hostKey: gearData.hostKey,
        mount: { id: 'gear_a' },
        point: { x: 0, y: 0, z: 0 },
        attachment: {}
      })),
      isGearDirectionContextPassthroughGhosted: CityChannelThreeRuntime.prototype.isGearDirectionContextPassthroughGhosted,
      addGearDirectionHoverIcon: jest.fn(),
      getSelectedRackBindingContext: jest.fn(() => null),
      getHoveredRackBindingContext: jest.fn(() => null),
      getSelectedGearBindingContext: jest.fn(() => null),
      getHoveredGearBindingContext: jest.fn(() => null),
      addCurrentGearBindingVisual: jest.fn()
    });

    CityChannelThreeRuntime.prototype.updateGearBindingOverlay.call(runtime);

    expect(runtime.addGearDirectionHoverIcon).not.toHaveBeenCalled();
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

  it('clears selection when clicking empty space', () => {
    const runtime = createSelectionRuntime({
      hoverData: null,
      selection: {
        cells: [{ x: 2, y: 3, z: 0 }],
        walls: [],
        gears: [],
        scope: 'board'
      }
    });

    CityChannelThreeRuntime.prototype.selectHovered.call(runtime, false);

    expect(runtime.config.selection).toEqual({
      cells: [],
      walls: [],
      gears: [],
      racks: [],
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
      getThreeTranslationFromRuntimeOffset: CityChannelThreeRuntime.prototype.getThreeTranslationFromRuntimeOffset,
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
      usesEmbeddedComponentHighlight: CityChannelThreeRuntime.prototype.usesEmbeddedComponentHighlight,
      getGearVisualMaterials: CityChannelThreeRuntime.prototype.getGearVisualMaterials,
      getRackVisualMaterials: CityChannelThreeRuntime.prototype.getRackVisualMaterials,
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
    syncRackOverlayGroup: CityChannelThreeRuntime.prototype.syncRackOverlayGroup,
    clearRackOverlayGroup: CityChannelThreeRuntime.prototype.clearRackOverlayGroup,
    createRackRenderGroup: CityChannelThreeRuntime.prototype.createRackRenderGroup,
    getRackSurfaceNormalVector: CityChannelThreeRuntime.prototype.getRackSurfaceNormalVector,
    rackPointToThree: CityChannelThreeRuntime.prototype.rackPointToThree,
    createRackOrientedBox: CityChannelThreeRuntime.prototype.createRackOrientedBox,
    rackGroups: new Map(),
    renderModel: {
      mapData: createBaseCityChannelMap({ width: 4, height: 4, layers: 1 })
    },
    config: {
      wallViewMode: 'semi'
    },
    ghostValidMaterial: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.48 }),
    ghostInvalidMaterial: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4 }),
    ghostValidOutlineMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 1 }),
    ghostInvalidOutlineMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 1 }),
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

  it('uses rack-driven free-axis runtime phase even when the stored gear has an axis binding', () => {
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
      phase: 15,
      axisBinding: {
        componentKey: createCellKey(2, 1, 0),
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const boundKey = createCellKey(2, 1, 0);
    const bound = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [key]: tile,
        [boundKey]: bound
      },
      walls: {}
    };
    runtime.renderModel = buildCityChannelThreeRenderModel(mapData);
    const transform = runtime.renderModel.tiles.find((item) => item.key === key);
    const group = CityChannelThreeRuntime.prototype.createPlacementRenderGroup.call(runtime, transform);
    runtime.placementGroups.set(key, group);
    const gear = runtime.gearMeshes.get(`${key}:gear_corner`);
    const expected = CityChannelThreeRuntime.prototype.getGearQuaternion.call(runtime, transform, tile.gearMounts[0], 225);

    runtime.mechanismRuntimeSnapshot = {
      placements: {
        [key]: {
          runtimeAngle: 90,
          runtimeFixedMountId: 'gear_corner'
        }
      },
      gears: {
        [`${key}:gear_corner`]: {
          phase: 225,
          axisType: 'freeAxis',
          axisBinding: null
        }
      }
    };

    CityChannelThreeRuntime.prototype.syncMechanismRuntimeTransforms.call(runtime);

    expect(gear.userData.cityChannel.axisBindingSuppressed).toBe(true);
    expect(gear.quaternion.angleTo(expected)).toBeCloseTo(0, 6);
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

  it('keeps a bound corner gear at its installed socket when the bound board surface turns', () => {
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
    const gearWorld = gear.getWorldPosition(new THREE.Vector3());

    expect(gear.userData.cityChannel).toMatchObject({
      attachmentComponentKey: hostKey,
      followsAxisBinding: false
    });
    expect(gearWorld.x).toBeCloseTo(baseWorld.x, 6);
    expect(gearWorld.z).toBeCloseTo(baseWorld.z, 6);
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

  it('keeps vertical boards mounted in the main canvas even above the floor cutoff', () => {
    const floor = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const upperVertical = {
      ...createTile({
        x: 3,
        y: 3,
        z: 2,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        rotation: 90
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
      ...createBaseCityChannelMap({ width: 5, height: 5, layers: 3 }),
      tiles: {
        [createCellKey(1, 1, 0)]: floor,
        [createCellKey(3, 3, 2)]: upperVertical,
        [createCellKey(2, 2, 1)]: hiddenFloor
      },
      walls: {}
    };
    const runtime = {
      ...createDetailRuntimeHarness(),
      renderModel: buildCityChannelThreeRenderModel(mapData),
      config: {
        wallViewMode: 'semi',
        visibleLayerCutoff: 0
      },
      addRacks: jest.fn(),
      addGearContactVisuals: jest.fn(),
      addGroundGrid: jest.fn(),
      addCoordinateLabels: jest.fn()
    };

    CityChannelThreeRuntime.prototype.rebuildMap.call(runtime);

    expect(isThreeVerticalSupportPlacement(upperVertical)).toBe(true);
    expect(runtime.placementGroups.has(createCellKey(3, 3, 2))).toBe(true);
    expect(runtime.placementGroups.has(createCellKey(2, 2, 1))).toBe(false);
  });

  it('applies runtime rack translation to the whole rack render group', () => {
    const group = new THREE.Group();
    const runtime = {
      placementGroups: new Map(),
      rackGroups: new Map([['rack_runtime', group]]),
      gearMeshes: new Map(),
      mechanismRuntimeSnapshot: {
        placements: {},
        racks: {
          rack_runtime: {
            runtimeTranslation: { x: 0.25, y: -0.5, z: 0 }
          }
        },
        gears: {}
      },
      getThreeTranslationFromRuntimeOffset: CityChannelThreeRuntime.prototype.getThreeTranslationFromRuntimeOffset,
      applyPlacementGroupMatrix: CityChannelThreeRuntime.prototype.applyPlacementGroupMatrix,
      syncMechanismRuntimeTransforms: CityChannelThreeRuntime.prototype.syncMechanismRuntimeTransforms,
      syncSelectionFromConfig: jest.fn(),
      requestRender: jest.fn(),
      emitStatus: jest.fn()
    };

    CityChannelThreeRuntime.prototype.syncMechanismRuntimeTransforms.call(runtime);
    const position = new THREE.Vector3().setFromMatrixPosition(group.matrix);

    expect(position.x).toBeCloseTo(0.25, 6);
    expect(position.z).toBeCloseTo(-0.5, 6);
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

  it('renders rack selection overlays with teeth and restores board overlays afterward', () => {
    const runtime = createOverlayRuntimeHarness();
    const rack = {
      id: 'rack_overlay',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 0.5, z: 0 },
      end: { x: 2.5, y: 0.5, z: 0 }
    };
    const rackMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 0.16), new THREE.MeshBasicMaterial());
    rackMesh.userData.cityChannel = {
      kind: 'rack',
      rack,
      rackId: rack.id,
      key: rack.id
    };
    const boardMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 1), new THREE.MeshBasicMaterial());
    runtime.selectedMeshes = [rackMesh];

    CityChannelThreeRuntime.prototype.render.call(runtime);

    const overlay = runtime.selectionOverlays[0];
    const rackOverlayGroup = overlay.userData.rackOverlayGroup;
    expect(rackOverlayGroup).toBeInstanceOf(THREE.Group);
    expect(overlay.userData.fill.visible).toBe(false);
    expect(rackOverlayGroup.children.some((child) => (
      child.type === 'Mesh'
      && child.userData?.cityChannel?.kind === 'rackTooth'
    ))).toBe(true);

    runtime.selectedMeshes = [boardMesh];
    CityChannelThreeRuntime.prototype.render.call(runtime);

    expect(overlay.userData.rackOverlayGroup).toBe(null);
    expect(overlay.userData.fill.visible).toBe(true);
    expect(overlay.userData.outline).toBeInstanceOf(THREE.LineSegments);
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
    getGearMeshPhaseOffsetMap: CityChannelThreeRuntime.prototype.getGearMeshPhaseOffsetMap,
    getGearMeshPhaseOffset: CityChannelThreeRuntime.prototype.getGearMeshPhaseOffset,
    getGearVisualPhase: CityChannelThreeRuntime.prototype.getGearVisualPhase,
    getAssemblyGearNodes: CityChannelThreeRuntime.prototype.getAssemblyGearNodes,
    resolveDrivenGearNodes: CityChannelThreeRuntime.prototype.resolveDrivenGearNodes,
    getGearRotationTransmissionEventKeys: CityChannelThreeRuntime.prototype.getGearRotationTransmissionEventKeys,
    createAxisBindingRuntimeEntries: CityChannelThreeRuntime.prototype.createAxisBindingRuntimeEntries,
    createRackAxisBindingRuntimeEntries: CityChannelThreeRuntime.prototype.createRackAxisBindingRuntimeEntries,
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
      gearDirectionIconLineMaterial: new THREE.LineBasicMaterial(),
      gearDirectionIconGlowMaterial: new THREE.LineBasicMaterial(),
      gearDirectionIconFillMaterial: new THREE.MeshBasicMaterial(),
      gearBindingInvalidBadgeRingGeometry: new THREE.RingGeometry(0.052, 0.078, 12),
      gearBindingInvalidBadgeFillGeometry: new THREE.CircleGeometry(0.052, 12),
      gearBindingInvalidStemGeometry: new THREE.BoxGeometry(0.018, 0.012, 0.056),
      gearBindingInvalidDotGeometry: new THREE.SphereGeometry(0.012, 8, 6),
      gearDirectionClockwiseArcGeometry: new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.2, 0, 0),
        new THREE.Vector3(0.2, 0, 0)
      ]),
      gearDirectionCounterclockwiseArcGeometry: new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0.2, 0, 0),
        new THREE.Vector3(-0.2, 0, 0)
      ]),
      gearDirectionPassiveRingGeometry: new THREE.RingGeometry(0.12, 0.16, 12),
      gearDirectionPassiveSlashGeometry: new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.12, 0, -0.12),
        new THREE.Vector3(0.12, 0, 0.12)
      ]),
      gearDirectionArrowHeadGeometry: new THREE.ConeGeometry(0.055, 0.16, 8),
      ghostGeometry: new THREE.BoxGeometry(1, 1, 1),
      placementGroups: new Map(),
      config: {
        activeTool: CITY_CHANNEL_TOOLS.SELECT,
        activeComponentType: null,
        onUpdateGearMountConfig: jest.fn(),
        onGearAxisPrompt: jest.fn(),
        selection: { cells: [], walls: [], gears: [], scope: null }
      },
      requestRender: jest.fn(),
      notifyStatus: jest.fn(),
      getVisiblePlacementTransforms: CityChannelThreeRuntime.prototype.getVisiblePlacementTransforms,
      getRuntimeTransform: CityChannelThreeRuntime.prototype.getRuntimeTransform,
      getRuntimeWorldPointForPlacement: CityChannelThreeRuntime.prototype.getRuntimeWorldPointForPlacement,
      getRuntimeSurfacePointForPlacement: CityChannelThreeRuntime.prototype.getRuntimeSurfacePointForPlacement,
      getRuntimeGearSurfacePointForPlacement: CityChannelThreeRuntime.prototype.getRuntimeGearSurfacePointForPlacement,
      getBasePlacementForTransform: CityChannelThreeRuntime.prototype.getBasePlacementForTransform,
      getPlacementMeshForComponent: CityChannelThreeRuntime.prototype.getPlacementMeshForComponent,
      getBasePlacementTransform: CityChannelThreeRuntime.prototype.getBasePlacementTransform,
      hasRuntimePlacementGroupMatrix: CityChannelThreeRuntime.prototype.hasRuntimePlacementGroupMatrix,
      getGearBindingSurfacesForPlacement: CityChannelThreeRuntime.prototype.getGearBindingSurfacesForPlacement,
      isSameThreePoint: CityChannelThreeRuntime.prototype.isSameThreePoint,
      getGearBindingCandidateKey: CityChannelThreeRuntime.prototype.getGearBindingCandidateKey,
      isSameGearBindingCandidate: CityChannelThreeRuntime.prototype.isSameGearBindingCandidate,
      getGearBindingStatusForMount: CityChannelThreeRuntime.prototype.getGearBindingStatusForMount,
      getGearBindingWarningMessage: CityChannelThreeRuntime.prototype.getGearBindingWarningMessage,
      getGearAttachmentContext: CityChannelThreeRuntime.prototype.getGearAttachmentContext,
      getGearAttachmentWorldPoint: CityChannelThreeRuntime.prototype.getGearAttachmentWorldPoint,
      getGearAttachmentWorldQuaternion: CityChannelThreeRuntime.prototype.getGearAttachmentWorldQuaternion,
      getRootGearTransform: CityChannelThreeRuntime.prototype.getRootGearTransform,
      getRootGearSourceContext: CityChannelThreeRuntime.prototype.getRootGearSourceContext,
      getRootGearAttachmentContext: CityChannelThreeRuntime.prototype.getRootGearAttachmentContext,
      getGearDirectionIconContextForGearData: CityChannelThreeRuntime.prototype.getGearDirectionIconContextForGearData,
      getHoveredGearDirectionIconContext: CityChannelThreeRuntime.prototype.getHoveredGearDirectionIconContext,
      createGearDirectionIconLine: CityChannelThreeRuntime.prototype.createGearDirectionIconLine,
      addGearDirectionHoverIcon: CityChannelThreeRuntime.prototype.addGearDirectionHoverIcon,
      getGearBindingContextForGearSelection: CityChannelThreeRuntime.prototype.getGearBindingContextForGearSelection,
      getSelectedGearBindingContext: CityChannelThreeRuntime.prototype.getSelectedGearBindingContext,
      getHoveredGearBindingContext: CityChannelThreeRuntime.prototype.getHoveredGearBindingContext,
      getHoveredGearBindingCandidate: CityChannelThreeRuntime.prototype.getHoveredGearBindingCandidate,
      addCurrentGearBindingVisual: CityChannelThreeRuntime.prototype.addCurrentGearBindingVisual,
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
      updateGearBindingOverlay: CityChannelThreeRuntime.prototype.updateGearBindingOverlay,
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

  const setHoveredGear = (runtime, { hostKey, host, transform, mount }) => {
    runtime.hoverMesh = {
      userData: {
        cityChannel: {
          kind: 'gear',
          hostKind: transform.kind === 'wall' ? 'wall' : 'tile',
          hostKey,
          cell: { x: host.x, y: host.y, z: host.z },
          edge: host.edge || null,
          placement: host,
          transform,
          mount
        }
      }
    };
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

  it('offers binding candidates for an intersection root gear', () => {
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
    const rootGear = {
      id: 'gear_root',
      componentType: 'gear',
      position: 'intersection',
      socketKind: 'intersection',
      surface: 'front',
      sourceHostKind: 'tile',
      sourceHostKey: hostKey,
      sourceSocket: 'corner_se',
      x: 16.5,
      y: 16.5,
      z: 0
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 20, height: 20, layers: 2 }),
      tiles: {
        [hostKey]: host,
        [eastKey]: createTile({ x: 17, y: 16, z: 0 }),
        [southKey]: createTile({ x: 16, y: 17, z: 0 }),
        [diagonalKey]: createTile({ x: 17, y: 17, z: 0 })
      },
      walls: {},
      gears: {
        gear_root: rootGear
      }
    };
    const runtime = createBindingVisualRuntimeHarness(mapData);
    runtime.config.selection = {
      cells: [],
      walls: [],
      gears: [{
        hostKind: 'intersection',
        hostKey: 'gear_root',
        mountId: 'gear_root'
      }],
      scope: 'component'
    };

    const context = CityChannelThreeRuntime.prototype.getSelectedGearBindingContext.call(runtime);

    expect(context).toMatchObject({
      hostKind: 'intersection',
      hostKey: 'gear_root',
      mount: expect.objectContaining({
        id: 'gear_root',
        position: 'corner_se',
        socketKind: 'corner'
      })
    });
    expect(context.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ componentKey: hostKey, socket: 'corner_se' }),
      expect.objectContaining({ componentKey: eastKey, socket: 'corner_sw' }),
      expect.objectContaining({ componentKey: southKey, socket: 'corner_ne' }),
      expect.objectContaining({ componentKey: diagonalKey, socket: 'corner_nw' })
    ]));
  });

  it('updates an intersection root gear binding from a hovered candidate board', () => {
    const hostKey = createCellKey(16, 16, 0);
    const eastKey = createCellKey(17, 16, 0);
    const host = createTile({
      x: 16,
      y: 16,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const east = createTile({
      x: 17,
      y: 16,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const rootGear = {
      id: 'gear_root',
      componentType: 'gear',
      position: 'intersection',
      socketKind: 'intersection',
      surface: 'front',
      sourceHostKind: 'tile',
      sourceHostKey: hostKey,
      sourceSocket: 'corner_se',
      x: 16.5,
      y: 16.5,
      z: 0
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 20, height: 20, layers: 2 }),
      tiles: {
        [hostKey]: host,
        [eastKey]: east
      },
      walls: {},
      gears: {
        gear_root: rootGear
      }
    };
    const runtime = createBindingVisualRuntimeHarness(mapData);
    const eastTransform = runtime.renderModel.tiles.find((item) => item.key === eastKey);
    runtime.config.selection = {
      cells: [],
      walls: [],
      gears: [{
        hostKind: 'intersection',
        hostKey: 'gear_root',
        mountId: 'gear_root'
      }],
      scope: 'component'
    };
    const hoverPoint = getThreeGearSurfacePoint(eastTransform, {
      position: 'corner_sw',
      surface: 'front'
    });
    runtime.hoverHit = {
      point: hoverPoint,
      object: {
        userData: {
          cityChannel: {
            kind: eastTransform.kind,
            key: eastTransform.key,
            placement: eastTransform.placement,
            transform: eastTransform
          }
        }
      }
    };

    const committed = CityChannelThreeRuntime.prototype.commitGearBindingCandidate.call(runtime);

    expect(committed).toBe(true);
    expect(runtime.config.onUpdateGearMountConfig).toHaveBeenCalledWith('gear_root', {
      axisBinding: {
        hostKind: 'tile',
        componentKey: eastKey,
        socket: 'corner_sw',
        surface: 'front'
      }
    });
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
    expect(CityChannelThreeRuntime.prototype.getGearBindingSurfacesForPlacement.call({}, pressureWall)).toEqual(['front']);
    expect(CityChannelThreeRuntime.prototype.getGearBindingSurfacesForPlacement.call({}, pressureVertical)).toEqual(['front']);
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

  it('meshes a center gear with a touching intersection gear regardless of the corner gear host board', () => {
    const centerKey = createCellKey(1, 1, 0);
    const cornerHosts = [
      { key: createCellKey(1, 1, 0), x: 1, y: 1, socket: 'corner_ne' },
      { key: createCellKey(2, 1, 0), x: 2, y: 1, socket: 'corner_nw' },
      { key: createCellKey(1, 0, 0), x: 1, y: 0, socket: 'corner_se' },
      { key: createCellKey(2, 0, 0), x: 2, y: 0, socket: 'corner_sw' }
    ];

    cornerHosts.forEach((cornerHost) => {
      const center = createTile({
        x: 1,
        y: 1,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
      });
      center.gearMounts = [{
        id: 'gear_center',
        componentType: 'gear',
        position: 'center',
        socketKind: 'center',
        surface: 'front',
        teeth: 18,
        phase: 0
      }];
      const corner = createTile({
        x: cornerHost.x,
        y: cornerHost.y,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
      });
      corner.gearMounts = [{
        id: 'gear_corner',
        componentType: 'gear',
        position: cornerHost.socket,
        socketKind: 'corner',
        surface: 'front',
        teeth: 18,
        phase: 0
      }];
      const tiles = {
        [centerKey]: center,
        [cornerHost.key]: corner
      };
      if (cornerHost.key === centerKey) {
        tiles[centerKey] = {
          ...center,
          gearMounts: [
            center.gearMounts[0],
            corner.gearMounts[0]
          ]
        };
      }
      const mapData = {
        ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
        tiles,
        walls: {}
      };
      const runtime = createTransmissionRuntimeHarness(mapData);
      const nodes = CityChannelThreeRuntime.prototype.getAllGearNodes.call(runtime);
      const graph = buildGearContactGraph(nodes);

      expect(graph.get(`${centerKey}:gear_center`)?.map((edge) => edge.id)).toContain(`${cornerHost.key}:gear_corner`);
    });
  });

  it('meshes a center gear with a transmission-rotated corner socket that visually touches it', () => {
    const centerKey = createCellKey(1, 1, 0);
    const cornerKey = createCellKey(2, 1, 0);
    const center = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    center.gearMounts = [{
      id: 'gear_center',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const corner = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      rotation: 0,
      transmissionRotation: 270
    });
    corner.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_ne',
      socketKind: 'corner',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [centerKey]: center,
        [cornerKey]: corner
      },
      walls: {}
    };
    const runtime = createTransmissionRuntimeHarness(mapData);
    const nodes = CityChannelThreeRuntime.prototype.getAllGearNodes.call(runtime);
    const graph = buildGearContactGraph(nodes);

    expect(graph.get(`${centerKey}:gear_center`)?.map((edge) => edge.id)).toContain(`${cornerKey}:gear_corner`);
  });

  it('keeps contact graph nodes on the installed gear socket when the gear has an axis binding', () => {
    const centerKey = createCellKey(1, 1, 0);
    const cornerKey = createCellKey(2, 1, 0);
    const center = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    center.gearMounts = [{
      id: 'gear_center',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const corner = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    corner.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_nw',
      socketKind: 'corner',
      surface: 'front',
      teeth: 18,
      phase: 0,
      axisBinding: {
        hostKind: 'tile',
        componentKey: centerKey,
        socket: 'corner_ne',
        surface: 'front'
      }
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [centerKey]: center,
        [cornerKey]: corner
      },
      walls: {}
    };
    const runtime = createTransmissionRuntimeHarness(mapData);
    const nodes = CityChannelThreeRuntime.prototype.getAllGearNodes.call(runtime);
    const cornerNode = nodes.find((node) => node.id === `${cornerKey}:gear_corner`);
    const graph = buildGearContactGraph(nodes);

    expect(cornerNode).toMatchObject({
      componentKey: cornerKey,
      attachmentComponentKey: cornerKey,
      followsAxisBinding: false,
      mount: expect.objectContaining({
        axisBinding: expect.objectContaining({ componentKey: centerKey })
      }),
      attachmentMount: expect.objectContaining({
        position: 'corner_nw'
      })
    });
    expect(graph.get(`${centerKey}:gear_center`)?.map((edge) => edge.id)).toContain(`${cornerKey}:gear_corner`);
  });

  it('meshes an intersection root gear with all four surrounding center gears when it has board binding', () => {
    const northWestKey = createCellKey(1, 1, 0);
    const northEastKey = createCellKey(2, 1, 0);
    const southWestKey = createCellKey(1, 2, 0);
    const southEastKey = createCellKey(2, 2, 0);
    const createCenterTile = (x, y) => {
      const tile = createTile({
        x,
        y,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
      });
      tile.gearMounts = [{
        id: 'gear_center',
        componentType: 'gear',
        position: 'center',
        socketKind: 'center',
        surface: 'front',
        teeth: 18,
        phase: 0
      }];
      return tile;
    };
    const rootGear = {
      id: 'gear_root',
      componentType: 'gear',
      position: 'intersection',
      socketKind: 'intersection',
      surface: 'front',
      sourceHostKind: 'tile',
      sourceHostKey: northWestKey,
      sourceSocket: 'corner_se',
      x: 1.5,
      y: 1.5,
      z: 0,
      axisBinding: {
        hostKind: 'tile',
        componentKey: southEastKey,
        socket: 'corner_nw',
        surface: 'front'
      }
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [northWestKey]: createCenterTile(1, 1),
        [northEastKey]: createCenterTile(2, 1),
        [southWestKey]: createCenterTile(1, 2),
        [southEastKey]: createCenterTile(2, 2)
      },
      walls: {},
      gears: {
        gear_root: rootGear
      }
    };
    const runtime = createTransmissionRuntimeHarness(mapData);
    const nodes = CityChannelThreeRuntime.prototype.getAllGearNodes.call(runtime);
    const graph = buildGearContactGraph(nodes);
    const expectedCenterIds = [
      `${northWestKey}:gear_center`,
      `${northEastKey}:gear_center`,
      `${southWestKey}:gear_center`,
      `${southEastKey}:gear_center`
    ];

    expect(graph.get('gear_root:gear_root')?.map((edge) => edge.id).sort()).toEqual(expectedCenterIds.sort());
    expectedCenterIds.forEach((centerId) => {
      expect(graph.get(centerId)?.map((edge) => edge.id)).toContain('gear_root:gear_root');
    });
  });

  it('blocks meshed active gears whose configured directions conflict', () => {
    const {
      sourceKey,
      drivenKey,
      source,
      driven,
      mapData
    } = createMeshedGearMap();
    source.gearMounts[0].rotationDirection = CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE;
    driven.gearMounts[0].rotationDirection = CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE;
    const runtime = {
      ...createTransmissionRuntimeHarness(mapData),
      config: {
        mechanismParams: {},
        onToast: jest.fn()
      },
      mechanismRuntimeSnapshot: { stale: true },
      cancelMechanismRuntimePreview: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(function setMechanismRuntimeSnapshot(snapshot) {
        this.mechanismRuntimeSnapshot = snapshot;
      }),
      playMechanismRuntimePreview: jest.fn(),
      flashMechanismObstruction: jest.fn()
    };

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 1, z: 0 }, {
      rotationAngle: 90,
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(false);
    expect(runtime.playMechanismRuntimePreview).not.toHaveBeenCalled();
    expect(runtime.mechanismRuntimeSnapshot).toBeNull();
    expect(runtime.flashMechanismObstruction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'gearDriveConflict',
      gearKeys: expect.arrayContaining([`${sourceKey}:gear_center`, `${drivenKey}:gear_corner`]),
      gearTargets: expect.arrayContaining([
        expect.objectContaining({ componentKey: sourceKey, mountId: 'gear_center' }),
        expect.objectContaining({ componentKey: drivenKey, mountId: 'gear_corner' })
      ]),
      obstacleKeys: expect.arrayContaining([sourceKey, drivenKey]),
      obstacles: expect.arrayContaining([source, driven])
    }));
    expect(runtime.config.onToast).toHaveBeenLastCalledWith(
      '主动齿轮之间的啮合方向互相矛盾，齿轮组被卡住。',
      'error'
    );
  });

  it('treats a same-position meshed gear outside the current pressure assembly as passive', () => {
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
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE
    }];
    const driven = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    driven.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_nw',
      socketKind: 'corner',
      surface: 'front',
      teeth: 18,
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [drivenKey]: driven
      },
      walls: {}
    };
    const runtime = {
      ...createTransmissionRuntimeHarness(mapData),
      config: {
        mechanismParams: {},
        onToast: jest.fn()
      },
      cancelMechanismRuntimePreview: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(function setMechanismRuntimeSnapshot(snapshot) {
        this.mechanismRuntimeSnapshot = snapshot;
      }),
      playMechanismRuntimePreview: jest.fn(),
      flashMechanismObstruction: jest.fn()
    };

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 1, z: 0 }, {
      rotationAngle: 90,
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(true);
    expect(runtime.flashMechanismObstruction).not.toHaveBeenCalled();
    expect(runtime.playMechanismRuntimePreview).toHaveBeenCalledWith(expect.objectContaining({
      gearNodes: expect.arrayContaining([
        expect.objectContaining({
          id: `${drivenKey}:gear_corner`,
          driveRatio: -1,
          isDriveRoot: false,
          drivenByGearId: `${sourceKey}:gear_center`
        })
      ])
    }));
    expect(runtime.config.onToast).toHaveBeenLastCalledWith(expect.stringContaining('齿轮传动预览'), 'success');
  });

  it('uses turn buttons plus dial angle as the pressure plate target angle', () => {
    const {
      sourceKey,
      mapData
    } = createMeshedGearMap();
    const runtime = {
      ...createTransmissionRuntimeHarness(mapData),
      config: {
        mechanismParams: {},
        onToast: jest.fn()
      },
      cancelMechanismRuntimePreview: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(),
      playMechanismRuntimePreview: jest.fn(),
      flashMechanismObstruction: jest.fn()
    };

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 1, z: 0 }, {
      rotationTurns: 1,
      rotationAngle: 90,
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(true);
    expect(runtime.playMechanismRuntimePreview).toHaveBeenCalledWith(expect.objectContaining({
      key: sourceKey,
      targetAngle: 450,
      params: expect.objectContaining({
        rotationTurns: 1,
        rotationAngle: 90,
        rotationTotalAngle: 450
      })
    }));
  });

  it('does not drive gears above a vertical transmission chain split by a turned middle board', () => {
    const createVerticalTransmission = (z, panelType, patch = {}) => ({
      ...createTile({
        x: 2,
        y: 3,
        z,
        panelType,
        rotation: 0,
        transmissionRotation: 0,
        ...patch
      }),
      isVertical: true
    });
    const sourceKey = createCellKey(2, 3, 0);
    const lowerBridgeKey = createCellKey(2, 3, 1);
    const middleKey = createCellKey(2, 3, 2);
    const upperKey = createCellKey(2, 3, 3);
    const source = createVerticalTransmission(0, CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE);
    source.gearMounts = [{
      id: 'gear_center',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const lowerBridge = createVerticalTransmission(1, CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE);
    const middle = createVerticalTransmission(2, CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE, {
      rotation: 90
    });
    const upper = createVerticalTransmission(3, CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE);
    upper.gearMounts = [{
      id: 'gear_upper',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 5, height: 5, layers: 4 }),
      tiles: {
        [sourceKey]: source,
        [lowerBridgeKey]: lowerBridge,
        [middleKey]: middle,
        [upperKey]: upper
      },
      walls: {}
    };
    const assemblyGraph = buildMechanicalAssemblies(mapData);
    const assembly = getAssemblyForCell(assemblyGraph, sourceKey);
    const runtime = createTransmissionRuntimeHarness(mapData);
    const nodes = CityChannelThreeRuntime.prototype.resolveDrivenGearNodes.call(runtime, assembly, sourceKey);

    expect(assembly.componentKeys).toEqual(expect.arrayContaining([sourceKey, lowerBridgeKey]));
    expect(assembly.componentKeys).not.toContain(middleKey);
    expect(assembly.componentKeys).not.toContain(upperKey);
    expect(nodes.map((node) => node.id)).toEqual([`${sourceKey}:gear_center`]);
  });

  it('adds a half-tooth visual phase offset to directly meshed gears', () => {
    const {
      sourceKey,
      drivenKey,
      mapData
    } = createMeshedGearMap();
    const runtime = createTransmissionRuntimeHarness(mapData);

    expect(CityChannelThreeRuntime.prototype.getGearMeshPhaseOffset.call(runtime, sourceKey, 'gear_center'))
      .toBe(0);
    expect(CityChannelThreeRuntime.prototype.getGearMeshPhaseOffset.call(runtime, drivenKey, 'gear_corner'))
      .toBeCloseTo(10, 6);
    expect(CityChannelThreeRuntime.prototype.getGearVisualPhase.call(runtime, drivenKey, 'gear_corner', 270))
      .toBe(280);
  });

  it('invalidates gear mesh phase offsets when map data changes between gear placements', () => {
    const {
      sourceKey,
      drivenKey,
      source,
      mapData
    } = createMeshedGearMap();
    const firstMapData = {
      ...mapData,
      tiles: {
        [sourceKey]: source
      }
    };
    const runtime = {
      ...createTransmissionRuntimeHarness(firstMapData),
      rebuildMap: jest.fn()
    };

    expect(CityChannelThreeRuntime.prototype.getGearMeshPhaseOffset.call(runtime, sourceKey, 'gear_center')).toBe(0);
    CityChannelThreeRuntime.prototype.setMapData.call(runtime, mapData);

    expect(runtime.gearMeshPhaseOffsetMap).toBeNull();
    expect(CityChannelThreeRuntime.prototype.getGearMeshPhaseOffset.call(runtime, drivenKey, 'gear_corner'))
      .toBeCloseTo(10, 6);
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

  it('degrades a meshed bound root intersection gear into an unbound passive gear', () => {
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
    const rootGear = {
      id: 'gear_root',
      componentType: 'gear',
      position: 'intersection',
      socketKind: 'intersection',
      surface: 'front',
      sourceHostKind: 'tile',
      sourceHostKey: driverKey,
      sourceSocket: 'corner_nw',
      x: 1.5,
      y: 0.5,
      z: 0,
      axisBinding: {
        hostKind: 'tile',
        componentKey: sourceKey,
        socket: 'corner_ne',
        surface: 'front'
      }
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [driverKey]: driver
      },
      walls: {},
      gears: {
        gear_root: rootGear
      }
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
    const rootNode = nodes.find((node) => node.id === 'gear_root:gear_root');

    expect(nodes.map((node) => node.id)).toEqual([`${sourceKey}:gear_center`, 'gear_root:gear_root']);
    expect(rootNode).toMatchObject({
      componentKey: 'gear_root',
      hostKind: 'intersection',
      driveRatio: -1,
      isDriveRoot: false,
      axisBindingSuppressed: true,
      mount: expect.objectContaining({
        position: 'corner_nw',
        axisBinding: expect.objectContaining({ componentKey: sourceKey })
      })
    });
    expect(assemblyEntries).toHaveLength(0);
    expect(snapshot.placements).toEqual({});
    expect(snapshot.gears['gear_root:gear_root']).toMatchObject({
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
      source,
      mapData
    } = createLinkedGearMap();
    source.gearMounts[0].rotationDirection = CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE;
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

  it('translates a rack-bound board when a pressure-plate gear meshes with the rack', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const boundKey = createCellKey(1, 2, 0);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    source.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_se',
      socketKind: 'corner',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const bound = createTile({
      x: 1,
      y: 2,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const rack = {
      id: 'rack_pressure_drive',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 1.5, z: 0 },
      end: { x: 2.5, y: 1.5, z: 0 },
      axisBinding: {
        hostKind: 'tile',
        componentKey: boundKey
      }
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [boundKey]: bound
      },
      walls: {},
      racks: {
        [rack.id]: rack
      }
    };
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
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(true);
    expect(runtime.mechanismRuntimeSnapshot.placements[boundKey]).toMatchObject({
      runtimeMotionType: 'rackTranslation',
      runtimeRackId: rack.id
    });
    expect(runtime.mechanismRuntimeSnapshot.placements[boundKey].runtimeAngle).toBeUndefined();
    expect(runtime.mechanismRuntimeSnapshot.placements[boundKey].x).not.toBe(bound.x);
    expect(runtime.mechanismRuntimeSnapshot.racks[rack.id]).toMatchObject({
      runtimeMotionType: 'rackTranslation'
    });
  });

  it('translates a rack-bound board when a pressure-plate center gear meshes with rack side teeth', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const boundKey = createCellKey(1, 2, 0);
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
    const bound = createTile({
      x: 1,
      y: 2,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const rack = {
      id: 'rack_center_side_pressure_drive',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 1.5, z: 0 },
      end: { x: 2.5, y: 1.5, z: 0 },
      axisBinding: {
        hostKind: 'tile',
        componentKey: boundKey
      }
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [boundKey]: bound
      },
      walls: {},
      racks: {
        [rack.id]: rack
      }
    };
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
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(true);
    expect(runtime.mechanismRuntimeSnapshot.placements[boundKey]).toMatchObject({
      runtimeMotionType: 'rackTranslation',
      runtimeRackId: rack.id
    });
    expect(runtime.mechanismRuntimeSnapshot.placements[boundKey].runtimeAngle).toBeUndefined();
    expect(runtime.mechanismRuntimeSnapshot.placements[boundKey].x).not.toBe(bound.x);
    expect(runtime.mechanismRuntimeSnapshot.racks[rack.id]).toMatchObject({
      runtimeMotionType: 'rackTranslation',
      runtimeSourceGearMountId: 'gear_center'
    });
  });

  it('stops a vertical rack at the source gear contact limit instead of remotely driving an upper gear', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const upperKey = createCellKey(1, 1, 1);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    source.gearMounts = [{
      id: 'gear_lower',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
    }];
    const upper = createTile({
      x: 1,
      y: 1,
      z: 1,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    upper.gearMounts = [{
      id: 'gear_upper',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE
    }];
    const rack = {
      id: 'rack_vertical_pickup',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      normalAxis: 'y',
      direction: 'z',
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 1 }
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      tiles: {
        [sourceKey]: source,
        [upperKey]: upper
      },
      walls: {},
      racks: {
        [rack.id]: rack
      }
    };
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
        const basePhases = new Map(
          [...args.rackContactGearNodes, ...args.gearNodes]
            .map((node) => [node.id, Number(node.mount?.phase) || 0])
        );
        this.setMechanismRuntimeSnapshot(this.createRuntimeSnapshotForMechanism({
          ...args,
          sourceAngle: args.targetAngle,
          basePhases
        }));
      }),
      flashMechanismObstruction: jest.fn()
    };
    const assemblyGraph = buildMechanicalAssemblies(mapData);
    const sourceAssembly = getAssemblyForCell(assemblyGraph, sourceKey);
    const gearNodes = runtime.resolveDrivenGearNodes(sourceAssembly, sourceKey);
    const [rackEntry] = runtime.createRackAxisBindingRuntimeEntries(gearNodes, assemblyGraph);
    const expectedDistance = getRackContactLimitedTranslationDistance(rackEntry, 360);

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 1, z: 0 }, {
      rotationAngle: 360,
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });
    const upperState = runtime.mechanismRuntimeSnapshot?.gears?.[`${upperKey}:gear_upper`];

    expect(played).toBe(true);
    expect(runtime.flashMechanismObstruction).not.toHaveBeenCalled();
    expect(runtime.mechanismRuntimeSnapshot.racks[rack.id]).toMatchObject({
      runtimeMotionType: 'rackTranslation'
    });
    expect(expectedDistance).toBeGreaterThan(0);
    expect(runtime.mechanismRuntimeSnapshot.racks[rack.id].runtimeLinearDistance).toBeCloseTo(expectedDistance, 6);
    expect(runtime.mechanismRuntimeSnapshot.racks[rack.id].start.z).toBeCloseTo(rack.start.z + expectedDistance, 6);
    expect(runtime.mechanismRuntimeSnapshot.racks[rack.id].end.z).toBeCloseTo(rack.end.z + expectedDistance, 6);
    expect(upperState).toBeUndefined();
  });

  it('lets an upper configured gear be passively driven when the moving rack reaches it', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const upperKey = createCellKey(1, 1, 1);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    source.gearMounts = [{
      id: 'gear_lower',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
    }];
    const upper = createTile({
      x: 1,
      y: 1,
      z: 1,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    upper.gearMounts = [{
      id: 'gear_upper',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE
    }];
    const rack = {
      id: 'rack_vertical_reaches_configured_passive',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      normalAxis: 'y',
      direction: 'z',
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 2 }
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      tiles: {
        [sourceKey]: source,
        [upperKey]: upper
      },
      walls: {},
      racks: {
        [rack.id]: rack
      }
    };
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
        const basePhases = new Map(
          [...args.rackContactGearNodes, ...args.gearNodes]
            .map((node) => [node.id, Number(node.mount?.phase) || 0])
        );
        this.setMechanismRuntimeSnapshot(this.createRuntimeSnapshotForMechanism({
          ...args,
          sourceAngle: args.targetAngle,
          basePhases
        }));
      }),
      flashMechanismObstruction: jest.fn()
    };

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 1, z: 0 }, {
      rotationAngle: 360,
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });
    const upperState = runtime.mechanismRuntimeSnapshot?.gears?.[`${upperKey}:gear_upper`];

    expect(played).toBe(true);
    expect(runtime.flashMechanismObstruction).not.toHaveBeenCalled();
    expect(runtime.playMechanismRuntimePreview).toHaveBeenCalledWith(expect.objectContaining({
      obstruction: null,
      targetAngle: 360
    }));
    expect(runtime.mechanismRuntimeSnapshot.racks[rack.id].runtimeLinearDistance).toBeGreaterThan(0);
    expect(upperState).toMatchObject({
      componentKey: upperKey,
      mountId: 'gear_upper',
      axisType: 'freeAxis'
    });
  });

  it('lets a middle active gear continue driving a vertical rack after the lower gear disengages', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const middleKey = createCellKey(1, 1, 1);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    source.gearMounts = [{
      id: 'gear_lower',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
    }];
    const middle = createTile({
      x: 1,
      y: 1,
      z: 1,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    middle.gearMounts = [{
      id: 'gear_middle',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
    }];
    const rack = {
      id: 'rack_vertical_multi_active',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      normalAxis: 'y',
      direction: 'z',
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 2 }
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles: {
        [sourceKey]: source,
        [middleKey]: middle
      },
      walls: {},
      racks: {
        [rack.id]: rack
      }
    };
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
        const basePhases = new Map(
          [...args.rackContactGearNodes, ...args.gearNodes]
            .map((node) => [node.id, Number(node.mount?.phase) || 0])
        );
        this.setMechanismRuntimeSnapshot(this.createRuntimeSnapshotForMechanism({
          ...args,
          sourceAngle: args.targetAngle,
          basePhases
        }));
      }),
      flashMechanismObstruction: jest.fn()
    };
    const assemblyGraph = buildMechanicalAssemblies(mapData);
    const sourceAssembly = getAssemblyForCell(assemblyGraph, sourceKey);
    const gearNodes = runtime.resolveDrivenGearNodes(sourceAssembly, sourceKey);
    const [rackEntry] = runtime.createRackAxisBindingRuntimeEntries(gearNodes, assemblyGraph);
    const lowerLimit = rackEntry.sourceContactTravelLimits.find((limit) => (
      limit.sourceGearComponentKey === sourceKey
    ));
    const expectedDistance = getRackContactLimitedTranslationDistance(rackEntry, 720);

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 1, z: 0 }, {
      rotationAngle: 720,
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });
    const middleState = runtime.mechanismRuntimeSnapshot?.gears?.[`${middleKey}:gear_middle`];

    expect(played).toBe(true);
    expect(runtime.flashMechanismObstruction).not.toHaveBeenCalled();
    expect(rackEntry.sourceContactTravelLimits).toHaveLength(2);
    expect(expectedDistance).toBeGreaterThan(lowerLimit.max);
    expect(runtime.mechanismRuntimeSnapshot.racks[rack.id].runtimeLinearDistance).toBeCloseTo(expectedDistance, 6);
    expect(runtime.mechanismRuntimeSnapshot.racks[rack.id].runtimeLinearDistance).toBeGreaterThan(lowerLimit.max);
    expect(middleState).toMatchObject({
      componentKey: middleKey,
      mountId: 'gear_middle',
      speedRatio: expect.any(Number)
    });
    expect(Math.abs(middleState.speedRatio)).toBeGreaterThan(0);
    expect(middleState.phase).toBe(normalizeRotation(720 * middleState.speedRatio));
  });

  it('blocks conflicting same-side active gears that drive one vertical rack in opposite directions', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const middleKey = createCellKey(1, 1, 1);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    source.gearMounts = [{
      id: 'gear_lower',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
    }];
    const middle = createTile({
      x: 1,
      y: 1,
      z: 1,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    middle.gearMounts = [{
      id: 'gear_middle',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE
    }];
    const rack = {
      id: 'rack_vertical_conflicting_active',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      normalAxis: 'y',
      direction: 'z',
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 2 }
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles: {
        [sourceKey]: source,
        [middleKey]: middle
      },
      walls: {},
      racks: {
        [rack.id]: rack
      }
    };
    const runtime = {
      ...createTransmissionRuntimeHarness(mapData),
      config: {
        mechanismParams: {},
        onToast: jest.fn()
      },
      mechanismRuntimeSnapshot: { stale: true },
      cancelMechanismRuntimePreview: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(function setMechanismRuntimeSnapshot(snapshot) {
        this.mechanismRuntimeSnapshot = snapshot;
      }),
      playMechanismRuntimePreview: jest.fn(),
      flashMechanismObstruction: jest.fn()
    };

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 1, z: 0 }, {
      rotationAngle: 720,
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(false);
    expect(runtime.playMechanismRuntimePreview).not.toHaveBeenCalled();
    expect(runtime.mechanismRuntimeSnapshot).toBeNull();
    expect(runtime.flashMechanismObstruction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'rackDriveConflict',
      rackId: rack.id,
      rackIds: [rack.id],
      racks: expect.arrayContaining([expect.objectContaining({ id: rack.id })]),
      obstacleKeys: expect.arrayContaining([sourceKey, middleKey]),
      obstacles: expect.arrayContaining([source, middle])
    }));
    expect(runtime.config.onToast).toHaveBeenLastCalledWith(
      '主动齿轮正在把同一齿条推向相反方向，齿条被卡住。',
      'error'
    );
  });

  it('does not let a disconnected configured gear keep driving the rack after the assembly splits', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const middleKey = createCellKey(1, 1, 1);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    source.gearMounts = [{
      id: 'gear_lower',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
    }];
    const middle = createTile({
      x: 1,
      y: 1,
      z: 1,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    middle.gearMounts = [{
      id: 'gear_middle',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE
    }];
    const rack = {
      id: 'rack_vertical_split_active',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      normalAxis: 'y',
      direction: 'z',
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 2 }
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles: {
        [sourceKey]: source,
        [middleKey]: middle
      },
      walls: {},
      racks: {
        [rack.id]: rack
      }
    };
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
        const basePhases = new Map(
          [...args.rackContactGearNodes, ...args.gearNodes]
            .map((node) => [node.id, Number(node.mount?.phase) || 0])
        );
        this.setMechanismRuntimeSnapshot(this.createRuntimeSnapshotForMechanism({
          ...args,
          sourceAngle: args.targetAngle,
          basePhases
        }));
      }),
      flashMechanismObstruction: jest.fn()
    };
    const assemblyGraph = buildMechanicalAssemblies(mapData);
    const sourceAssembly = getAssemblyForCell(assemblyGraph, sourceKey);
    const gearNodes = runtime.resolveDrivenGearNodes(sourceAssembly, sourceKey);
    const [rackEntry] = runtime.createRackAxisBindingRuntimeEntries(gearNodes, assemblyGraph);

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 1, z: 0 }, {
      rotationAngle: 720,
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(sourceAssembly.componentKeys).toContain(sourceKey);
    expect(sourceAssembly.componentKeys).not.toContain(middleKey);
    expect(rackEntry.driveConflict).toBeNull();
    expect(rackEntry.sourceContactTravelLimits).toHaveLength(1);
    expect(rackEntry.sourceContactTravelLimits[0]).toMatchObject({
      sourceGearComponentKey: sourceKey
    });
    expect(played).toBe(true);
    expect(runtime.flashMechanismObstruction).not.toHaveBeenCalled();
    expect(runtime.playMechanismRuntimePreview).toHaveBeenCalledWith(expect.objectContaining({
      rackContactGearNodes: expect.arrayContaining([
        expect.objectContaining({
          id: `${sourceKey}:gear_lower`
        })
      ]),
      gearNodes: expect.arrayContaining([
        expect.objectContaining({
          id: `${sourceKey}:gear_lower`
        })
      ])
    }));
    expect(runtime.mechanismRuntimeSnapshot.racks[rack.id]).toMatchObject({
      runtimeMotionType: 'rackTranslation',
      runtimeSourceGearComponentKey: sourceKey
    });
  });

  it('blocks one board receiving incompatible rotation and translation trends', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const boundKey = createCellKey(2, 1, 0);
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
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE
    }];
    const bound = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [boundKey]: bound
      },
      walls: {}
    };
    const fakeGearNode = {
      id: `${sourceKey}:gear_center`,
      componentKey: sourceKey,
      mountId: 'gear_center',
      driveRatio: 1,
      mount: source.gearMounts[0]
    };
    const rotationEntry = {
      assembly: { id: 'rotate_bound', componentKeys: [boundKey] },
      componentKey: boundKey,
      driveRatio: 1,
      fixedAxis: { id: 'fixed_axis' }
    };
    const rackEntry = {
      motionType: 'rackTranslation',
      assembly: { id: 'translate_bound', componentKeys: [boundKey] },
      componentKey: boundKey,
      rackId: 'rack_bound',
      sourceRackId: 'rack_bound',
      translationAxis: { x: 1, y: 0, z: 0 },
      driveRatio: 1,
      sourceGearNodeId: fakeGearNode.id
    };
    const runtime = {
      ...createTransmissionRuntimeHarness(mapData),
      config: {
        mechanismParams: {},
        onToast: jest.fn()
      },
      mechanismRuntimeSnapshot: { stale: true },
      cancelMechanismRuntimePreview: jest.fn(),
      setMechanismRuntimeSnapshot: jest.fn(function setMechanismRuntimeSnapshot(snapshot) {
        this.mechanismRuntimeSnapshot = snapshot;
      }),
      resolveDrivenGearNodes: jest.fn(() => [fakeGearNode]),
      createAxisBindingRuntimeEntries: jest.fn(() => [rotationEntry]),
      createRackAxisBindingRuntimeEntries: jest.fn(() => [rackEntry]),
      playMechanismRuntimePreview: jest.fn(),
      flashMechanismObstruction: jest.fn()
    };

    const played = CityChannelThreeRuntime.prototype.triggerMechanismAtCell.call(runtime, { x: 1, y: 1, z: 0 }, {
      rotationAngle: 90,
      rotationSpeedDegPerSec: 360,
      triggerDelaySeconds: 0,
      autoReturn: false
    });

    expect(played).toBe(false);
    expect(runtime.playMechanismRuntimePreview).not.toHaveBeenCalled();
    expect(runtime.mechanismRuntimeSnapshot).toBeNull();
    expect(runtime.flashMechanismObstruction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'placementMotionConflict',
      componentKey: boundKey,
      obstacleKeys: [boundKey],
      obstacles: [bound]
    }));
    expect(runtime.config.onToast).toHaveBeenLastCalledWith(
      '同一板材被多个机械约束要求不同运动，传动被卡住。',
      'error'
    );
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
      phase: 0,
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
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

  const withContactVisualHarness = (runtime, mechanismRuntimeSnapshot = null) => ({
    ...runtime,
    worldGroup: new THREE.Group(),
    contactGroup: new THREE.Group(),
    mechanismRuntimeSnapshot,
    gearContactMarkerGeometry: new THREE.SphereGeometry(0.04, 12, 8),
    gearContactBarGeometry: new THREE.BoxGeometry(0.22, 0.01, 0.018),
    gearContactMaterial: new THREE.MeshBasicMaterial(),
    gearContactActiveMaterial: new THREE.MeshBasicMaterial(),
    getRuntimeTransform: CityChannelThreeRuntime.prototype.getRuntimeTransform,
    getGearAttachmentContext: CityChannelThreeRuntime.prototype.getGearAttachmentContext,
    getRuntimeGearState: CityChannelThreeRuntime.prototype.getRuntimeGearState,
    getRuntimeGearSurfacePointForNode: CityChannelThreeRuntime.prototype.getRuntimeGearSurfacePointForNode,
    createGearContactMarkerGroup: CityChannelThreeRuntime.prototype.createGearContactMarkerGroup,
    addGearContactVisuals: CityChannelThreeRuntime.prototype.addGearContactVisuals
  });

  const expectContactMarker = (runtime, active = false) => {
    const marker = runtime.contactGroup.children.find((child) => (
      child.userData.cityChannelGearRole === (active ? 'gear_contact_marker_active' : 'gear_contact_marker')
    ));
    expect(marker).toBeInstanceOf(THREE.Group);
    expect(marker.children.map((child) => child.userData.cityChannelGearRole))
      .toEqual(expect.arrayContaining([
        'gear_contact_bar',
        'gear_contact_dot'
      ]));
    expect(marker.children.find((child) => child.userData.cityChannelGearRole === 'gear_contact_bar').material)
      .toBe(active ? runtime.gearContactActiveMaterial : runtime.gearContactMaterial);
    return marker;
  };

  it('renders active contact cues between meshed gears', () => {
    const {
      sourceKey,
      drivenKey,
      mapData
    } = createMeshedGearMap();
    const runtime = withContactVisualHarness(createTransmissionRuntimeHarness(mapData), {
      sourceAngle: 45,
      gears: {
        [`${sourceKey}:gear_center`]: { phase: 45, speedRatio: 1 }
      }
    });

    CityChannelThreeRuntime.prototype.addGearContactVisuals.call(runtime, new Set([sourceKey, drivenKey]));

    const marker = expectContactMarker(runtime, true);
    expect(marker.scale.x).toBeGreaterThan(0.9);
    expect(runtime.worldGroup.children).toHaveLength(0);
  });

  it('renders contact cues between adjacent vertical center gears', () => {
    const leftKey = createCellKey(1, 1, 1);
    const rightKey = createCellKey(2, 1, 1);
    const left = createTile({
      x: 1,
      y: 1,
      z: 1,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    left.gearMounts = [{
      id: 'gear_center',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const right = createTile({
      x: 2,
      y: 1,
      z: 1,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    right.gearMounts = [{
      id: 'gear_center',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      tiles: {
        [leftKey]: left,
        [rightKey]: right
      },
      walls: {}
    };
    const runtime = withContactVisualHarness(createTransmissionRuntimeHarness(mapData));

    CityChannelThreeRuntime.prototype.addGearContactVisuals.call(runtime, new Set([leftKey, rightKey]));

    expectContactMarker(runtime, false);
    expect(runtime.worldGroup.children).toHaveLength(0);
  });

  it('renders contact cues between vertical center and corner gears across adjacent cells', () => {
    const centerKey = createCellKey(1, 1, 1);
    const cornerKey = createCellKey(0, 1, 2);
    const center = createTile({
      x: 1,
      y: 1,
      z: 1,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    center.gearMounts = [{
      id: 'gear_center',
      componentType: 'gear',
      position: 'center',
      socketKind: 'center',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const corner = createTile({
      x: 0,
      y: 1,
      z: 2,
      isVertical: true,
      rotation: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    corner.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_se',
      socketKind: 'corner',
      surface: 'front',
      teeth: 18,
      phase: 0
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles: {
        [centerKey]: center,
        [cornerKey]: corner
      },
      walls: {}
    };
    const runtime = withContactVisualHarness(createTransmissionRuntimeHarness(mapData));

    CityChannelThreeRuntime.prototype.addGearContactVisuals.call(runtime, new Set([centerKey, cornerKey]));

    expectContactMarker(runtime, false);
    expect(runtime.worldGroup.children).toHaveLength(0);
  });

  it('uses the last configured gear rotation direction for new gear install targets', () => {
    const key = createCellKey(1, 1, 0);
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: { [key]: tile },
      walls: {}
    };
    const transform = getTileThreeTransform(tile, mapData);
    const runtime = {
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
        activeComponentType: 'gear',
        defaultGearRotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
      },
      getHoverPlacementData: jest.fn(() => ({
        kind: 'tile',
        key,
        placement: tile,
        transform
      })),
      getGearInstallSurfaceForHover: CityChannelThreeRuntime.prototype.getGearInstallSurfaceForHover,
      getCanonicalGearHoverTarget: CityChannelThreeRuntime.prototype.getCanonicalGearHoverTarget,
      getHoverLocalPoint: jest.fn(() => ({ x: 0, y: 0 })),
      hasCornerGearAtPivot: jest.fn(() => false)
    };

    const target = CityChannelThreeRuntime.prototype.getGearInstallTargetFromHoverHit.call(runtime);

    expect(target.valid).toBe(true);
    expect(target.mount).toMatchObject({
      position: 'center',
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
    });
  });

  it('creates an intersection gear install target with hovered surface metadata', () => {
    const canonicalKey = createCellKey(1, 0, 0);
    const westKey = createCellKey(1, 1, 0);
    const eastKey = createCellKey(2, 1, 0);
    const tiles = {};
    [
      { key: canonicalKey, x: 1, y: 0 },
      { key: createCellKey(2, 0, 0), x: 2, y: 0 },
      { key: westKey, x: 1, y: 1 },
      { key: eastKey, x: 2, y: 1 }
    ].forEach(({ key, x, y }) => {
      tiles[key] = createTile({
        x,
        y,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE
      });
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles,
      walls: {}
    };
    const createRuntimeForHover = (key, local) => {
      const placement = mapData.tiles[key];
      const transform = getTileThreeTransform(placement, mapData);
      return createRuntimeObject({
        renderModel: { mapData },
        config: {
          activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
          activeComponentType: 'gear'
        },
        getHoverPlacementData: jest.fn(() => ({
          kind: 'tile',
          key,
          placement,
          transform
        })),
        getGearInstallSurfaceForHover: CityChannelThreeRuntime.prototype.getGearInstallSurfaceForHover,
        getCanonicalGearHoverTarget: CityChannelThreeRuntime.prototype.getCanonicalGearHoverTarget,
        getHoverLocalPoint: jest.fn(() => local),
        hasCornerGearAtPivot: jest.fn(() => false)
      });
    };

    const westTarget = CityChannelThreeRuntime.prototype.getGearInstallTargetFromHoverHit.call(
      createRuntimeForHover(westKey, { x: 0.5, y: -0.5 })
    );
    const eastTarget = CityChannelThreeRuntime.prototype.getGearInstallTargetFromHoverHit.call(
      createRuntimeForHover(eastKey, { x: -0.5, y: -0.5 })
    );

    expect(westTarget).toMatchObject({
      valid: true,
      hostKind: 'intersection',
      displayHostKey: westKey,
      displaySocket: 'corner_ne',
      mount: expect.objectContaining({
        position: 'intersection',
        sourceHostKind: 'tile',
        sourceHostKey: westKey,
        sourceSocket: 'corner_ne'
      })
    });
    expect(westTarget.hostKey).toBe(westTarget.mount.id);
    expect(eastTarget).toMatchObject({
      valid: true,
      hostKind: 'intersection',
      displayHostKey: eastKey,
      displaySocket: 'corner_nw',
      mount: expect.objectContaining({
        position: 'intersection',
        sourceHostKind: 'tile',
        sourceHostKey: eastKey,
        sourceSocket: 'corner_nw'
      })
    });
    expect(eastTarget.hostKey).toBe(eastTarget.mount.id);
  });

  it('selects an intersection root gear without requiring a host placement', () => {
    const selection = CityChannelThreeRuntime.prototype.getPlacementSelectionFromData({
      kind: 'gear',
      hostKind: 'intersection',
      hostKey: 'gear_root',
      cell: { x: 1.5, y: 1.5, z: 0 },
      edge: null,
      placement: null,
      mount: {
        id: 'gear_root',
        position: 'corner_se',
        socketKind: 'intersection'
      }
    });

    expect(selection).toEqual({
      cells: [],
      walls: [],
      gears: [{
        hostKind: 'intersection',
        hostKey: 'gear_root',
        mountId: 'gear_root',
        cell: { x: 1.5, y: 1.5, z: 0 },
        edge: null
      }],
      scope: 'component'
    });
  });

  it('starts gear carry for a selected intersection root gear', () => {
    const rootGear = {
      id: 'gear_root',
      componentType: 'gear',
      position: 'intersection',
      socketKind: 'intersection',
      surface: 'front',
      sourceHostKind: 'tile',
      sourceHostKey: createCellKey(1, 1, 0),
      sourceSocket: 'corner_se',
      x: 1.5,
      y: 1.5,
      z: 0
    };
    const runtime = {
      config: {
        selection: {
          gears: [{
            hostKind: 'intersection',
            hostKey: 'gear_root',
            mountId: 'gear_root'
          }]
        }
      },
      renderModel: {
        mapData: {
          gears: {
            gear_root: rootGear
          }
        }
      }
    };

    const gear = CityChannelThreeRuntime.prototype.getSelectedGearForCarry.call(runtime);

    expect(gear).toMatchObject({
      hostKind: 'intersection',
      hostKey: 'gear_root',
      mount: rootGear
    });
  });

  it('orients an intersection root gear from the vertical source board surface', () => {
    const sourceKey = createCellKey(2, 2, 0);
    const source = {
      ...createTile({
        x: 2,
        y: 2,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
        rotation: 0
      }),
      isVertical: true
    };
    const rootGear = {
      id: 'gear_root',
      componentType: 'gear',
      position: 'intersection',
      socketKind: 'intersection',
      surface: 'front',
      sourceHostKind: 'tile',
      sourceHostKey: sourceKey,
      sourceSocket: 'corner_ne',
      x: 2.5,
      y: 1.5,
      z: 0.5,
      teeth: 18
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source
      },
      walls: {},
      gears: {
        gear_root: rootGear
      }
    };
    const runtime = createRuntimeObject({
      renderModel: buildCityChannelThreeRenderModel(mapData)
    });

    const context = CityChannelThreeRuntime.prototype.getRootGearAttachmentContext.call(
      runtime,
      'gear_root',
      rootGear
    );
    const nodes = CityChannelThreeRuntime.prototype.getRootGearNodes.call(runtime);

    expect(context.transform.kind).toBe('verticalTile');
    expect(context.mount).toMatchObject({
      position: 'corner_ne',
      socketKind: 'corner'
    });
    expect(nodes[0]).toMatchObject({
      id: 'gear_root:gear_root',
      hostKind: 'intersection',
      meshPlane: expect.objectContaining({ kind: 'vertical' })
    });
  });

  it('draws gear direction arrows in the same visible direction as rendered gear phase', () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    camera.position.set(9, 8, 9);
    camera.lookAt(new THREE.Vector3(0, 0, 0));
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const project = (point) => point.clone().project(camera);
    const getScreenHand = (from, to) => {
      const start = project(from);
      const end = project(to);
      return (start.x * end.y) - (start.y * end.x);
    };
    const runtime = {
      getGearSurfaceQuaternion: CityChannelThreeRuntime.prototype.getGearSurfaceQuaternion,
      getGearSurfaceRotationDegrees: CityChannelThreeRuntime.prototype.getGearSurfaceRotationDegrees
    };
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
    const phaseStart = new THREE.Vector3(1, 0, 0).applyQuaternion(
      CityChannelThreeRuntime.prototype.getGearQuaternion.call(runtime, transform, { surface: 'front' }, 0)
    );
    const clockwisePhaseNext = new THREE.Vector3(1, 0, 0).applyQuaternion(
      CityChannelThreeRuntime.prototype.getGearQuaternion.call(runtime, transform, { surface: 'front' }, 10)
    );
    const counterclockwisePhaseNext = new THREE.Vector3(1, 0, 0).applyQuaternion(
      CityChannelThreeRuntime.prototype.getGearQuaternion.call(runtime, transform, { surface: 'front' }, -10)
    );
    const clockwiseGeometry = createGearDirectionArcGeometry(true, 1, 8);
    const counterclockwiseGeometry = createGearDirectionArcGeometry(false, 1, 8);
    const clockwisePositions = clockwiseGeometry.getAttribute('position');
    const counterclockwisePositions = counterclockwiseGeometry.getAttribute('position');
    const getPoint = (attribute, index) => new THREE.Vector3(
      attribute.getX(index),
      attribute.getY(index),
      attribute.getZ(index)
    );
    const clockwiseStart = getPoint(clockwisePositions, 0);
    const clockwiseNext = getPoint(clockwisePositions, 1);
    const counterclockwiseStart = getPoint(counterclockwisePositions, 0);
    const counterclockwiseNext = getPoint(counterclockwisePositions, 1);
    const clockwiseTip = getGearDirectionArrowTip(true, 1);
    const counterclockwiseTip = getGearDirectionArrowTip(false, 1);

    expect(Math.sign(getScreenHand(clockwiseStart, clockwiseNext)))
      .toBe(Math.sign(getScreenHand(phaseStart, clockwisePhaseNext)));
    expect(Math.sign(getScreenHand(counterclockwiseStart, counterclockwiseNext)))
      .toBe(Math.sign(getScreenHand(phaseStart, counterclockwisePhaseNext)));
    expect(Math.sign(getScreenHand(clockwiseTip.point, clockwiseTip.point.clone().add(clockwiseTip.tangent))))
      .toBe(Math.sign(getScreenHand(phaseStart, clockwisePhaseNext)));
    expect(Math.sign(getScreenHand(counterclockwiseTip.point, counterclockwiseTip.point.clone().add(counterclockwiseTip.tangent))))
      .toBe(Math.sign(getScreenHand(phaseStart, counterclockwisePhaseNext)));
  });

  it('uses a flat gear direction arrow head with its tip aligned to the tangent', () => {
    const geometry = createGearDirectionArrowHeadGeometry(0.075, 0.18);
    const positions = geometry.getAttribute('position');
    const localTip = new THREE.Vector3(positions.getX(0), positions.getY(0), positions.getZ(0));
    const localBaseCenter = new THREE.Vector3(
      (positions.getX(1) + positions.getX(2)) / 2,
      (positions.getY(1) + positions.getY(2)) / 2,
      (positions.getZ(1) + positions.getZ(2)) / 2
    );
    const clockwiseTip = getGearDirectionArrowTip(true, 1);
    const angle = Math.atan2(clockwiseTip.tangent.x, clockwiseTip.tangent.z);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    const worldDirection = localTip.clone().sub(localBaseCenter).applyQuaternion(rotation).normalize();

    expect(worldDirection.dot(clockwiseTip.tangent)).toBeCloseTo(1, 6);
  });

  it('keeps pressure-linked center gears configurable even when meshed with an active gear', () => {
    const {
      source,
      drivenKey,
      driven,
      mapData
    } = createMeshedGearMap();
    source.gearMounts[0] = {
      ...source.gearMounts[0],
      position: 'corner_ne',
      socketKind: 'corner'
    };
    driven.gearMounts[0] = {
      ...driven.gearMounts[0],
      position: 'center',
      socketKind: 'center',
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE
    };
    const runtime = createBindingVisualRuntimeHarness(mapData);
    const drivenTransform = runtime.renderModel.tiles.find((item) => item.key === drivenKey);
    setHoveredGear(runtime, {
      hostKey: drivenKey,
      host: driven,
      transform: drivenTransform,
      mount: driven.gearMounts[0]
    });

    CityChannelThreeRuntime.prototype.updateGearBindingOverlay.call(runtime);

    const directionIcon = runtime.overlayGroup.children.find((child) => (
      child.userData.cityChannelGearRole === 'gear_direction_icon'
    ));
    expect(directionIcon).toBeInstanceOf(THREE.Group);
  });

  it('does not draw a direction icon while hovering a gear meshed with an active gear', () => {
    const {
      sourceKey,
      drivenKey,
      driven,
      mapData
    } = createMeshedGearMap();
    driven.gearMounts[0] = {
      ...driven.gearMounts[0],
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE,
      axisBinding: {
        hostKind: 'tile',
        componentKey: sourceKey,
        socket: 'corner_ne',
        surface: 'front'
      }
    };
    const runtime = createBindingVisualRuntimeHarness(mapData);
    const drivenTransform = runtime.renderModel.tiles.find((item) => item.key === drivenKey);
    setHoveredGear(runtime, {
      hostKey: drivenKey,
      host: driven,
      transform: drivenTransform,
      mount: driven.gearMounts[0]
    });

    CityChannelThreeRuntime.prototype.updateGearBindingOverlay.call(runtime);

    const directionIcon = runtime.overlayGroup.children.find((child) => (
      child.userData.cityChannelGearRole === 'gear_direction_icon'
    ));
    expect(directionIcon).toBeUndefined();
  });

  it('does not draw a direction icon while a rack drives the hovered gear from an active gear', () => {
    const sourceKey = createCellKey(1, 1, 0);
    const drivenKey = createCellKey(2, 1, 0);
    const source = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    source.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_se',
      socketKind: 'corner',
      surface: 'front',
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE
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
      position: 'corner_sw',
      socketKind: 'corner',
      surface: 'front',
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE,
      axisBinding: {
        hostKind: 'tile',
        componentKey: sourceKey,
        socket: 'corner_se',
        surface: 'front'
      }
    }];
    const rack = {
      id: 'direction_rack',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      direction: 'x',
      z: 0,
      start: { x: 0.5, y: 1.5, z: 0 },
      end: { x: 2.5, y: 1.5, z: 0 }
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [sourceKey]: source,
        [drivenKey]: driven
      },
      walls: {},
      racks: {
        [rack.id]: rack
      }
    };
    const runtime = createBindingVisualRuntimeHarness(mapData);
    const drivenTransform = runtime.renderModel.tiles.find((item) => item.key === drivenKey);
    setHoveredGear(runtime, {
      hostKey: drivenKey,
      host: driven,
      transform: drivenTransform,
      mount: driven.gearMounts[0]
    });

    CityChannelThreeRuntime.prototype.updateGearBindingOverlay.call(runtime);

    const directionIcon = runtime.overlayGroup.children.find((child) => (
      child.userData.cityChannelGearRole === 'gear_direction_icon'
    ));
    expect(directionIcon).toBeUndefined();
  });

  it('draws a transparent passive direction icon while hovering a pressure-linked gear meshed only with passive gears', () => {
    const {
      sourceKey,
      source,
      drivenKey,
      driven,
      mapData
    } = createMeshedGearMap();
    source.gearMounts[0].rotationDirection = CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE;
    driven.gearMounts[0] = {
      ...driven.gearMounts[0],
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE,
      axisBinding: {
        hostKind: 'tile',
        componentKey: sourceKey,
        socket: 'corner_ne',
        surface: 'front'
      }
    };
    const runtime = createBindingVisualRuntimeHarness(mapData);
    const drivenTransform = runtime.renderModel.tiles.find((item) => item.key === drivenKey);
    setHoveredGear(runtime, {
      hostKey: drivenKey,
      host: driven,
      transform: drivenTransform,
      mount: driven.gearMounts[0]
    });

    CityChannelThreeRuntime.prototype.updateGearBindingOverlay.call(runtime);

    const directionIcon = runtime.overlayGroup.children.find((child) => (
      child.userData.cityChannelGearRole === 'gear_direction_icon'
    ));
    expect(directionIcon).toBeInstanceOf(THREE.Group);
    expect(directionIcon.children.map((child) => child.userData.cityChannelGearRole))
      .toEqual(expect.arrayContaining([
        'gear_direction_passive_ring',
        'gear_direction_passive_slash'
      ]));
  });

  it('does not draw a direction icon for an intersection gear bound outside the pressure plate assembly', () => {
    const {
      source,
      drivenKey,
      driven,
      mapData
    } = createMeshedGearMap();
    const boundKey = createCellKey(1, 0, 0);
    const bound = createTile({
      x: 1,
      y: 0,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    source.gearMounts[0].rotationDirection = CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE;
    driven.gearMounts[0] = {
      ...driven.gearMounts[0],
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE,
      axisBinding: {
        hostKind: 'tile',
        componentKey: boundKey,
        socket: 'corner_se',
        surface: 'front'
      }
    };
    mapData.tiles[boundKey] = bound;
    const runtime = createBindingVisualRuntimeHarness(mapData);
    const drivenTransform = runtime.renderModel.tiles.find((item) => item.key === drivenKey);
    setHoveredGear(runtime, {
      hostKey: drivenKey,
      host: driven,
      transform: drivenTransform,
      mount: driven.gearMounts[0]
    });

    CityChannelThreeRuntime.prototype.updateGearBindingOverlay.call(runtime);

    const directionIcon = runtime.overlayGroup.children.find((child) => (
      child.userData.cityChannelGearRole === 'gear_direction_icon'
    ));
    expect(directionIcon).toBeUndefined();
  });

  it('does not draw a direction icon for gears outside the pressure plate assembly', () => {
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
      socketKind: 'center',
      surface: 'front',
      rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE
    }];
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: { [key]: tile },
      walls: {}
    };
    const runtime = createBindingVisualRuntimeHarness(mapData);
    const transform = runtime.renderModel.tiles.find((item) => item.key === key);
    setHoveredGear(runtime, {
      hostKey: key,
      host: tile,
      transform,
      mount: tile.gearMounts[0]
    });

    CityChannelThreeRuntime.prototype.updateGearBindingOverlay.call(runtime);

    const directionIcon = runtime.overlayGroup.children.find((child) => (
      child.userData.cityChannelGearRole === 'gear_direction_icon'
    ));
    expect(directionIcon).toBeUndefined();
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

  it('does not show bound board highlights when no gear is hovered or selected', () => {
    const { mapData } = createBoundCornerGearMap();
    const runtime = createBindingVisualRuntimeHarness(mapData);

    CityChannelThreeRuntime.prototype.updateGearBindingOverlay.call(runtime);

    expect(runtime.overlayGroup.children.map((child) => child.userData.cityChannelGearRole))
      .not.toEqual(expect.arrayContaining([
        'binding_board_ambient',
        'binding_board_active',
        'binding_source_ambient',
        'binding_source_active'
      ]));
  });

  it('shows the bound board highlight while hovering a gear', () => {
    const { sourceKey, source, mapData } = createBoundCornerGearMap();
    const runtime = createBindingVisualRuntimeHarness(mapData);
    const sourceTransform = runtime.renderModel.tiles.find((item) => item.key === sourceKey);
    setHoveredGear(runtime, {
      hostKey: sourceKey,
      host: source,
      transform: sourceTransform,
      mount: source.gearMounts[0]
    });

    CityChannelThreeRuntime.prototype.updateGearBindingOverlay.call(runtime);

    expect(runtime.overlayGroup.children.map((child) => child.userData.cityChannelGearRole))
      .toEqual(expect.arrayContaining([
        'binding_board_active',
        'binding_board_outline_active',
        'binding_curve',
        'binding_endpoint_active',
        'binding_source_active'
      ]));
  });

  it('keeps the bound board highlighted for a selected gear until its binding is removed', () => {
    const { sourceKey, source, mapData } = createBoundCornerGearMap();
    const runtime = createBindingVisualRuntimeHarness(mapData);
    runtime.config.selection = {
      cells: [],
      walls: [],
      gears: [{
        hostKind: 'tile',
        hostKey: sourceKey,
        mountId: 'gear_corner',
        cell: { x: source.x, y: source.y, z: source.z },
        edge: null
      }],
      scope: 'component'
    };

    CityChannelThreeRuntime.prototype.updateGearBindingOverlay.call(runtime);

    expect(runtime.overlayGroup.children.map((child) => child.userData.cityChannelGearRole))
      .toEqual(expect.arrayContaining([
        'binding_board_active',
        'binding_board_outline_active',
        'binding_source_active'
      ]));

    source.gearMounts[0].axisBinding = null;
    runtime.renderModel.mapData.tiles[sourceKey].gearMounts[0].axisBinding = null;
    runtime.renderModel.tiles.find((item) => item.key === sourceKey).placement.gearMounts[0].axisBinding = null;
    CityChannelThreeRuntime.prototype.updateGearBindingOverlay.call(runtime);

    expect(runtime.overlayGroup.children.map((child) => child.userData.cityChannelGearRole))
      .not.toEqual(expect.arrayContaining([
        'binding_board_active',
        'binding_board_outline_active'
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
    const boundSocket = getThreeGearSurfacePoint(transform, {
      position: 'corner_nw',
      surface: 'front'
    });
    const boundSocketWorld = new THREE.Vector3(boundSocket.x, boundSocket.y, boundSocket.z).applyMatrix4(group.matrixWorld);
    const sourceTransform = runtime.renderModel.tiles.find((item) => item.key === createCellKey(1, 1, 0));
    const sourceSocket = getThreeGearSurfacePoint(sourceTransform, {
      position: 'corner_ne',
      surface: 'front'
    });
    const endpointMarker = runtime.overlayGroup.children.find((child) => child.userData.cityChannelGearRole === 'binding_endpoint_ambient');
    expect(fillWorld.x).toBeCloseTo(meshWorld.x, 6);
    expect(fillWorld.z).toBeCloseTo(meshWorld.z, 6);
    expect(fillWorld.x).not.toBeCloseTo(transform.position.x, 6);
    expect(sourceMarker.position.x).toBeCloseTo(sourceSocket.x, 6);
    expect(sourceMarker.position.z).toBeCloseTo(sourceSocket.z, 6);
    expect(endpointMarker.position.x).toBeCloseTo(boundSocketWorld.x, 6);
    expect(endpointMarker.position.z).toBeCloseTo(boundSocketWorld.z, 6);
    expect(endpointMarker.position.x).not.toBeCloseTo(boundSocket.x, 6);
  });

  it('keeps bound gear binding visuals aligned with runtime surface turns', () => {
    const { sourceKey, drivenKey, mapData } = createBoundCornerGearMap();
    const runtime = createBindingVisualRuntimeHarness(mapData);
    runtime.mechanismRuntimeSnapshot = {
      placements: {
        [drivenKey]: {
          runtimeSurfaceRotation: 90
        }
      },
      gears: {}
    };
    const sourceTransform = runtime.renderModel.tiles.find((item) => item.key === sourceKey);
    const sourceSocket = getThreeGearSurfacePoint(sourceTransform, {
      position: 'corner_ne',
      surface: 'front'
    });
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
    expect(visuals[0].context.pivotWorld.x).toBeCloseTo(sourceSocket.x, 6);
    expect(visuals[0].context.pivotWorld.z).toBeCloseTo(sourceSocket.z, 6);
    expect(sourceMarker.position.x).toBeCloseTo(sourceSocket.x, 6);
    expect(sourceMarker.position.z).toBeCloseTo(sourceSocket.z, 6);
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

  it('creates red flash overlays for multiple mechanism obstruction boards', () => {
    const leftKey = createCellKey(1, 1, 0);
    const rightKey = createCellKey(2, 1, 0);
    const leftObstacle = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const rightObstacle = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [leftKey]: leftObstacle,
        [rightKey]: rightObstacle
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
      obstacles: [leftObstacle, rightObstacle]
    });
    const roles = runtime.mechanismFlashGroup.children.map((child) => child.userData.cityChannelGearRole);

    expect(flashed).toBe(true);
    expect(roles.filter((role) => role === 'mechanism_obstruction_fill')).toHaveLength(2);
    expect(roles.filter((role) => role === 'mechanism_obstruction_glow')).toHaveLength(2);
    expect(roles.filter((role) => role === 'mechanism_obstruction_outline')).toHaveLength(2);
    expect(runtime.mechanismObstructionFillMaterial.opacity).toBeGreaterThan(0);
  });

  it('creates red flash overlays for both moving and blocking obstruction boards', () => {
    const movingKey = createCellKey(1, 1, 0);
    const obstacleKey = createCellKey(2, 1, 0);
    const moving = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const obstacle = createTile({
      x: 2,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 2 }),
      tiles: {
        [movingKey]: moving,
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
      placement: moving,
      obstacle
    });
    const roles = runtime.mechanismFlashGroup.children.map((child) => child.userData.cityChannelGearRole);

    expect(flashed).toBe(true);
    expect(roles.filter((role) => role === 'mechanism_obstruction_fill')).toHaveLength(2);
    expect(roles.filter((role) => role === 'mechanism_obstruction_glow')).toHaveLength(2);
    expect(roles.filter((role) => role === 'mechanism_obstruction_outline')).toHaveLength(2);
  });

  it('creates a red flash overlay for mechanism obstruction racks', () => {
    const rack = {
      id: 'rack_flash_target',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: RACK_PLANES.VERTICAL,
      normalAxis: 'y',
      direction: RACK_DIRECTIONS.Z,
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 2 }
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      tiles: {},
      walls: {},
      racks: {
        [rack.id]: rack
      }
    };
    const rackFlashGroup = new THREE.Group();
    const rackBody = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const rackEdge = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    rackFlashGroup.add(rackBody);
    rackFlashGroup.add(rackEdge);
    const runtime = {
      renderModel: buildCityChannelThreeRenderModel(mapData),
      rackGroups: new Map(),
      mechanismFlashGroup: new THREE.Group(),
      mechanismObstructionFillMaterial: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
      mechanismObstructionOutlineMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 0 }),
      mechanismObstructionGlowMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 0 }),
      mechanismObstructionFlash: null,
      requestRender: jest.fn(),
      createRackRenderGroup: jest.fn(() => rackFlashGroup),
      addObstructionFlashRack: CityChannelThreeRuntime.prototype.addObstructionFlashRack,
      clearMechanismObstructionFlash: CityChannelThreeRuntime.prototype.clearMechanismObstructionFlash,
      flashMechanismObstruction: CityChannelThreeRuntime.prototype.flashMechanismObstruction,
      updateMechanismObstructionFlash: CityChannelThreeRuntime.prototype.updateMechanismObstructionFlash
    };

    const flashed = CityChannelThreeRuntime.prototype.flashMechanismObstruction.call(runtime, {
      rackId: rack.id
    });

    expect(flashed).toBe(true);
    expect(runtime.createRackRenderGroup).toHaveBeenCalledWith(
      expect.objectContaining({ id: rack.id }),
      expect.objectContaining({ ghost: true, showTeeth: true })
    );
    expect(runtime.mechanismFlashGroup.children).toContain(rackFlashGroup);
    expect(rackBody.material).toBe(runtime.mechanismObstructionFillMaterial);
    expect(rackEdge.material).toBe(runtime.mechanismObstructionGlowMaterial);
    expect(runtime.mechanismObstructionFillMaterial.opacity).toBeGreaterThan(0);
    expect(runtime.requestRender).toHaveBeenCalled();
  });

  it('creates a red flash overlay for mechanism obstruction gears', () => {
    const gearKey = `${createCellKey(2, 2, 0)}:gear_center`;
    const gearMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    gearMesh.position.set(1, 2, 3);
    gearMesh.updateMatrixWorld(true);
    const runtime = {
      renderModel: buildCityChannelThreeRenderModel(createBaseCityChannelMap({ width: 4, height: 4, layers: 2 })),
      gearMeshes: new Map([[gearKey, gearMesh]]),
      gearGeometry: new THREE.BoxGeometry(1, 1, 1),
      gearEdgeGeometry: new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      mechanismFlashGroup: new THREE.Group(),
      mechanismObstructionFillMaterial: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
      mechanismObstructionOutlineMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 0 }),
      mechanismObstructionGlowMaterial: new THREE.LineBasicMaterial({ transparent: true, opacity: 0 }),
      mechanismObstructionFlash: null,
      requestRender: jest.fn(),
      addObstructionFlashGearTarget: CityChannelThreeRuntime.prototype.addObstructionFlashGearTarget,
      clearMechanismObstructionFlash: CityChannelThreeRuntime.prototype.clearMechanismObstructionFlash,
      flashMechanismObstruction: CityChannelThreeRuntime.prototype.flashMechanismObstruction,
      updateMechanismObstructionFlash: CityChannelThreeRuntime.prototype.updateMechanismObstructionFlash
    };

    const flashed = CityChannelThreeRuntime.prototype.flashMechanismObstruction.call(runtime, {
      gearTargets: [{ gearKey }]
    });
    const gearFlashGroup = runtime.mechanismFlashGroup.children[0];
    const roles = gearFlashGroup.children.map((child) => child.userData.cityChannelGearRole);

    expect(flashed).toBe(true);
    expect(runtime.mechanismFlashGroup.children).toHaveLength(1);
    expect(gearFlashGroup.position.toArray()).toEqual([1, 2, 3]);
    expect(roles).toEqual(expect.arrayContaining([
      'mechanism_obstruction_gear_fill',
      'mechanism_obstruction_gear_glow'
    ]));
    expect(runtime.mechanismObstructionFillMaterial.opacity).toBeGreaterThan(0);
    expect(runtime.requestRender).toHaveBeenCalled();
  });

  it('flashes a mechanism obstruction when a preview reaches a runtime stall', () => {
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    const obstruction = {
      blocked: true,
      type: 'rackDriveConflict',
      rackId: 'rack_runtime_stall',
      gearTargets: [{ gearKey: `${createCellKey(1, 1, 1)}:gear_upper` }]
    };
    const callbacks = [];
    const runtime = {
      config: {
        onMechanismPreviewProgress: jest.fn()
      },
      mechanismPreviewFrame: null,
      mechanismPreviewTimer: null,
      createRuntimeSnapshotForMechanism: jest.fn((args) => ({
        sourceAngle: args.sourceAngle,
        obstruction: args.obstruction
      })),
      setMechanismRuntimeSnapshot: jest.fn(),
      flashMechanismObstruction: jest.fn(),
      cancelMechanismRuntimePreview: jest.fn(),
      requestMechanismFrame: jest.fn((callback) => {
        callbacks.push(callback);
        return callbacks.length;
      })
    };
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(0);

    CityChannelThreeRuntime.prototype.playMechanismRuntimePreview.call(runtime, {
      key: createCellKey(1, 1, 0),
      tile,
      params: {
        rotationAngle: 90,
        rotationSpeedDegPerSec: 360,
        triggerDelaySeconds: 0,
        autoReturn: true,
        autoReturnDelaySeconds: 0
      },
      targetAngle: 45,
      obstruction
    });
    nowSpy.mockReturnValueOnce(1000);
    callbacks.shift()(1000);

    expect(runtime.flashMechanismObstruction).toHaveBeenCalledWith(obstruction);
    expect(runtime.cancelMechanismRuntimePreview).not.toHaveBeenCalled();
    expect(runtime.setMechanismRuntimeSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceAngle: 45,
      obstruction
    }));
    nowSpy.mockRestore();
  });

  it('continues rack translation during passive gear inertia after active motion ends', () => {
    const rack = {
      id: 'rack_inertia_preview',
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane: 'vertical',
      normalAxis: 'y',
      direction: 'z',
      start: { x: 1.5, y: 1, z: 0 },
      end: { x: 1.5, y: 1, z: 1.5 }
    };
    const driver = {
      id: 'driver:gear_lower',
      componentKey: 'driver',
      mountId: 'gear_lower',
      worldPoint: { x: 1, y: 1, z: 0.5 },
      point: { x: 1, y: 1, z: 0.5 },
      placement: { x: 1, y: 1, z: 0, isVertical: true },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      driveRatio: -1,
      isDriveRoot: true,
      sourceAssemblyDriveActive: true,
      surfaceKey: 'vertical:1:front',
      mount: {
        id: 'gear_lower',
        position: 'center',
        rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
      }
    };
    const passive = {
      id: 'passive:gear_upper',
      componentKey: 'passive',
      mountId: 'gear_upper',
      worldPoint: { x: 1, y: 1, z: 1.25 },
      point: { x: 1, y: 1, z: 1.25 },
      placement: { x: 1, y: 1, z: 1, isVertical: true },
      pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
      gearRatioRadius: 18,
      driveRatio: -0.3,
      isDriveRoot: false,
      sourceAssemblyDriveActive: false,
      drivenViaRackId: rack.id,
      drivenByGearId: driver.id,
      surfaceKey: 'vertical:1:front',
      mount: {
        id: 'gear_upper',
        position: 'center',
        rotationDirection: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE
      }
    };
    const [entry] = createRackTranslationRuntimeEntries({
      mapData: {
        tiles: {},
        walls: {},
        racks: { [rack.id]: rack }
      },
      nodes: [driver]
    });
    const callbacks = [];
    const runtime = {
      config: {
        onMechanismPreviewProgress: jest.fn()
      },
      mechanismPreviewFrame: null,
      mechanismPreviewTimer: null,
      createRuntimeSnapshotForMechanism: jest.fn((args) => ({
        sourceAngle: args.sourceAngle,
        extraRackDistance: args.extraRackDistances?.get?.(rack.id) || 0,
        gears: args.extraRackDistances?.get?.(rack.id) > 0 ? {
          [passive.id]: { speedRatio: 0.2, phase: 25 }
        } : {}
      })),
      setMechanismRuntimeSnapshot: jest.fn(),
      flashMechanismObstruction: jest.fn(),
      cancelMechanismRuntimePreview: jest.fn(),
      requestMechanismFrame: jest.fn((callback) => {
        callbacks.push(callback);
        return callbacks.length;
      })
    };
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(0);

    CityChannelThreeRuntime.prototype.playMechanismRuntimePreview.call(runtime, {
      key: createCellKey(1, 1, 0),
      tile: createTile({
        x: 1,
        y: 1,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
      }),
      params: {
        rotationAngle: 60,
        rotationSpeedDegPerSec: 360,
        triggerDelaySeconds: 0,
        autoReturn: false
      },
      assemblyEntries: [entry],
      gearNodes: [driver],
      rackContactGearNodes: [driver, passive],
      targetAngle: 60
    });
    nowSpy.mockReturnValue(250);
    callbacks.shift()();
    nowSpy.mockReturnValue(510);
    callbacks.shift()();

    expect(runtime.setMechanismRuntimeSnapshot.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({
      sourceAngle: 60,
      extraRackDistance: expect.any(Number)
    }));
    expect(runtime.setMechanismRuntimeSnapshot.mock.calls.at(-1)[0].extraRackDistance).toBeGreaterThan(0);
    nowSpy.mockRestore();
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
    getHoverWorldFaceNormal: CityChannelThreeRuntime.prototype.getHoverWorldFaceNormal,
    createSnapCandidate: CityChannelThreeRuntime.prototype.createSnapCandidate,
    chooseSnapCandidate: CityChannelThreeRuntime.prototype.chooseSnapCandidate,
    getHoverBoardSnapCandidates: CityChannelThreeRuntime.prototype.getHoverBoardSnapCandidates,
    getPlacementTargetFromHoverBoard: CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard,
    createReplacementTargetForPlacement: CityChannelThreeRuntime.prototype.createReplacementTargetForPlacement,
    createVerticalSideSnapTarget: CityChannelThreeRuntime.prototype.createVerticalSideSnapTarget,
    createVerticalSideSnapTargets: CityChannelThreeRuntime.prototype.createVerticalSideSnapTargets,
    createVerticalParallelSideSnapTarget: CityChannelThreeRuntime.prototype.createVerticalParallelSideSnapTarget,
    getVerticalSurfaceTangent: CityChannelThreeRuntime.prototype.getVerticalSurfaceTangent,
    getVerticalSideSnapPreference: CityChannelThreeRuntime.prototype.getVerticalSideSnapPreference,
    getVerticalPerpendicularSideWallEdge: CityChannelThreeRuntime.prototype.getVerticalPerpendicularSideWallEdge,
    getVerticalPerpendicularSideWallCell: CityChannelThreeRuntime.prototype.getVerticalPerpendicularSideWallCell,
    createVerticalPerpendicularSideSnapTarget: CityChannelThreeRuntime.prototype.createVerticalPerpendicularSideSnapTarget,
    createVerticalSideFloorSnapTarget: CityChannelThreeRuntime.prototype.createVerticalSideFloorSnapTarget,
    createVerticalTopFloorSnapTarget: CityChannelThreeRuntime.prototype.createVerticalTopFloorSnapTarget,
    getVerticalSidePlacementCell: CityChannelThreeRuntime.prototype.getVerticalSidePlacementCell,
    getHoverVerticalSurfaceSide: CityChannelThreeRuntime.prototype.getHoverVerticalSurfaceSide,
    createVerticalTopSnapTarget: CityChannelThreeRuntime.prototype.createVerticalTopSnapTarget,
    createTileTarget: CityChannelThreeRuntime.prototype.createTileTarget,
    createWallTarget: CityChannelThreeRuntime.prototype.createWallTarget,
    recreatePlacementTargetForCurrentRotation: CityChannelThreeRuntime.prototype.recreatePlacementTargetForCurrentRotation,
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
      rotation: 90,
      transmissionRotation: 90
    });
  });

  it('keeps a wider middle area for replacement snapping', () => {
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
        x: transform.position.x + 0.34,
        y: transform.position.y,
        z: transform.position.z
      },
      config: {
        panelPose: 'floor'
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
  });

  it('keeps a wider middle area for vertical board replacement snapping', () => {
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
        [createCellKey(1, 1, 0)]: createTile({ x: 1, y: 1, z: 0 })
      },
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
        y: transform.position.y,
        z: transform.position.z + 0.34
      },
      config: {
        panelPose: 'wall',
        activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: true,
      preferWallPose: true
    });

    expect(target).toMatchObject({
      kind: 'wall',
      replace: true,
      snapKind: 'centerReplace',
      valid: true,
      cell: { x: 1, y: 1, z: 0 },
      edge: 'east'
    });
  });

  it.each([
    [CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE, 0, 90],
    [CITY_CHANNEL_TILE_TYPES.TRANSMISSION_T_PLATE, 90, 0],
    [CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE, 90, 0],
    [CITY_CHANNEL_TILE_TYPES.TRANSMISSION_ENDPOINT_PLATE, 0, 180]
  ])('keeps active transmission rotation when snapping %s on top of a vertical support', (
    panelType,
    supportRotation,
    activeRotation
  ) => {
    const supportKey = createCellKey(1, 1, 0);
    const support = {
      ...createTile({
        x: 1,
        y: 1,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        rotation: supportRotation,
        transmissionRotation: 0
      }),
      isVertical: true
    };
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 3 }),
      tiles: {
        [supportKey]: support
      },
      walls: {}
    };
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: panelType,
        activeRotation
      },
      createTileTarget: CityChannelThreeRuntime.prototype.createTileTarget,
      createWallTarget: CityChannelThreeRuntime.prototype.createWallTarget
    });

    const target = CityChannelThreeRuntime.prototype.createVerticalTopSnapTarget.call(runtime, support);
    const upperKey = createCellKey(1, 1, 1);
    const upper = {
      ...createTile({
        ...target.operation.cell,
        panelType: target.operation.panelType,
        rotation: target.operation.rotation,
        transmissionRotation: target.operation.transmissionRotation
      }),
      isVertical: true
    };
    const graph = buildMechanicalAssemblies({
      tiles: {
        [supportKey]: support,
        [upperKey]: upper
      },
      walls: {}
    });

    expect(target.operation).toMatchObject({
      kind: 'tile',
      cell: { x: 1, y: 1, z: 1 },
      panelType,
      rotation: supportRotation,
      transmissionRotation: activeRotation,
      isVertical: true
    });
    expect(graph.assemblyByComponentKey[supportKey]).not.toBe(graph.assemblyByComponentKey[upperKey]);
  });

  it('keeps the vertical plane but applies active transmission rotation when replacing a vertical board', () => {
    const lowerKey = createCellKey(1, 1, 0);
    const middleKey = createCellKey(1, 1, 1);
    const upperKey = createCellKey(1, 1, 2);
    const createVerticalStraight = (z) => ({
      ...createTile({
        x: 1,
        y: 1,
        z,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        rotation: 90,
        transmissionRotation: 0
      }),
      isVertical: true
    });
    const lower = createVerticalStraight(0);
    const middle = createVerticalStraight(1);
    const upper = createVerticalStraight(2);
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles: {
        [lowerKey]: lower,
        [middleKey]: middle,
        [upperKey]: upper
      },
      walls: {}
    };
    const runtime = createRuntimeObject({
      renderModel: { mapData },
      config: {
        activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
        activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_ENDPOINT_PLATE,
        activeRotation: 180
      },
      createTileTarget: CityChannelThreeRuntime.prototype.createTileTarget
    });
    const target = CityChannelThreeRuntime.prototype.createReplacementTargetForPlacement.call(
      runtime,
      middle,
      getTileThreeTransform(middle, mapData)
    );
    const replacement = {
      ...createTile({
        ...target.operation.cell,
        panelType: target.operation.panelType,
        rotation: target.operation.rotation,
        transmissionRotation: target.operation.transmissionRotation
      }),
      isVertical: true
    };
    const graph = buildMechanicalAssemblies({
      tiles: {
        [lowerKey]: lower,
        [middleKey]: replacement,
        [upperKey]: upper
      },
      walls: {}
    });

    expect(target.operation).toMatchObject({
      kind: 'tile',
      cell: { x: 1, y: 1, z: 1 },
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_ENDPOINT_PLATE,
      rotation: 90,
      transmissionRotation: 180,
      isVertical: true
    });
    expect(graph.assemblyByComponentKey[lowerKey]).not.toBe(graph.assemblyByComponentKey[upperKey]);
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
        x: transform.position.x + 0.42,
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

  it('requires edge snapping to be closer to the board edge', () => {
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
        x: transform.position.x + 0.35,
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

    expect(target).toBeNull();
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

  it('snaps wall-pose side hits on a vertical wall to a perpendicular front-side wall', () => {
    const wall = createWall({
      x: 1,
      y: 1,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles: {},
      walls: {
        [createWallKey(1, 1, 1, 'east')]: wall
      }
    };
    const transform = getWallThreeTransform(wall, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x,
        y: transform.position.y,
        z: transform.position.z - 0.49
      },
      faceNormal: { x: 1, y: 0, z: 0 },
      config: {
        panelPose: 'wall'
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false,
      preferWallPose: true
    });

    expect(target).toMatchObject({
      kind: 'wall',
      snapKind: 'verticalSide',
      snapMode: 'perpendicularSideSnap',
      structuralSupport: true,
      valid: true,
      cell: { x: 2, y: 1, z: 1 },
      edge: 'north'
    });
    expect(target.operation).toMatchObject({
      kind: 'wall',
      cell: { x: 2, y: 1, z: 1 },
      edge: 'north'
    });
  });

  it('keeps wall-pose side cap hits on a vertical wall as same-plane continuation', () => {
    const floor = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const wall = createWall({
      x: 1,
      y: 1,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles: {
        [createCellKey(1, 1, 0)]: floor
      },
      walls: {
        [createWallKey(1, 1, 1, 'east')]: wall
      }
    };
    const transform = getWallThreeTransform(wall, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x,
        y: transform.position.y,
        z: transform.position.z - 0.49
      },
      faceNormal: { x: 0, y: 0, z: -1 },
      config: {
        panelPose: 'wall'
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false,
      preferWallPose: true
    });

    expect(target).toMatchObject({
      kind: 'wall',
      snapKind: 'verticalSide',
      snapMode: 'sideSnap',
      valid: true,
      cell: { x: 1, y: 0, z: 1 },
      edge: 'east'
    });
    expect(target.operation).toMatchObject({
      kind: 'wall',
      cell: { x: 1, y: 0, z: 1 },
      edge: 'east'
    });
  });

  it('uses the hovered back side when creating a perpendicular wall snap', () => {
    const wall = createWall({
      x: 1,
      y: 1,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles: {},
      walls: {
        [createWallKey(1, 1, 1, 'east')]: wall
      }
    };
    const transform = getWallThreeTransform(wall, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x,
        y: transform.position.y,
        z: transform.position.z - 0.49
      },
      faceNormal: { x: -1, y: 0, z: 0 },
      config: {
        panelPose: 'wall'
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false,
      preferWallPose: true
    });

    expect(target).toMatchObject({
      kind: 'wall',
      snapMode: 'perpendicularSideSnap',
      valid: true,
      cell: { x: 1, y: 1, z: 1 },
      edge: 'north'
    });
  });

  it('snaps wall-pose side hits on a vertical tile to a same-cell perpendicular wall', () => {
    const verticalTile = {
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
        [createCellKey(1, 1, 1)]: verticalTile
      },
      walls: {}
    };
    const transform = getTileThreeTransform(verticalTile, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x - 0.49,
        y: transform.position.y,
        z: transform.position.z
      },
      faceNormal: { x: 0, y: 0, z: 1 },
      config: {
        panelPose: 'wall'
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false,
      preferWallPose: true
    });

    expect(target).toMatchObject({
      kind: 'wall',
      snapKind: 'verticalSide',
      snapMode: 'perpendicularSideSnap',
      structuralSupport: true,
      valid: true,
      cell: { x: 1, y: 1, z: 1 },
      edge: 'west'
    });
    expect(target.operation).toMatchObject({
      kind: 'wall',
      cell: { x: 1, y: 1, z: 1 },
      edge: 'west'
    });
  });

  it('keeps wall-pose side cap hits on a vertical tile as same-plane continuation', () => {
    const verticalTile = {
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
        [createCellKey(1, 1, 1)]: verticalTile
      },
      walls: {}
    };
    const transform = getTileThreeTransform(verticalTile, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x - 0.49,
        y: transform.position.y,
        z: transform.position.z
      },
      faceNormal: { x: -1, y: 0, z: 0 },
      config: {
        panelPose: 'wall'
      }
    });

    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false,
      preferWallPose: true
    });

    expect(target).toMatchObject({
      kind: 'verticalTile',
      snapKind: 'verticalSide',
      snapMode: 'sideSnap',
      valid: true,
      cell: { x: 0, y: 1, z: 1 }
    });
    expect(target.operation).toMatchObject({
      kind: 'tile',
      cell: { x: 0, y: 1, z: 1 },
      isVertical: true
    });
  });

  it('keeps structural side support when recreating a perpendicular snap after rotation', () => {
    const wall = createWall({
      x: 1,
      y: 1,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles: {},
      walls: {
        [createWallKey(1, 1, 1, 'east')]: wall
      }
    };
    const transform = getWallThreeTransform(wall, mapData);
    const runtime = createSnapRuntimeHarness({
      mapData,
      transform,
      point: {
        x: transform.position.x,
        y: transform.position.y,
        z: transform.position.z - 0.49
      },
      faceNormal: { x: 1, y: 0, z: 0 },
      config: {
        panelPose: 'wall',
        activeRotation: 0
      }
    });
    const target = CityChannelThreeRuntime.prototype.getPlacementTargetFromHoverBoard.call(runtime, {
      allowReplacement: false,
      preferWallPose: true
    });
    runtime.config.activeRotation = 90;

    const rotatedTarget = CityChannelThreeRuntime.prototype.recreatePlacementTargetForCurrentRotation.call(runtime, target);

    expect(rotatedTarget).toMatchObject({
      kind: 'wall',
      snapMode: 'perpendicularSideSnap',
      structuralSupport: true,
      valid: true,
      cell: { x: 2, y: 1, z: 1 },
      edge: 'north'
    });
    expect(rotatedTarget.operation).toMatchObject({
      kind: 'wall',
      transmissionRotation: 90
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

  it('keeps vertical top snapping valid above the default four layers', () => {
    const tiles = {};
    for (let z = 0; z < 4; z += 1) {
      tiles[createCellKey(1, 1, z)] = {
        ...createTile({
          x: 1,
          y: 1,
          z,
          rotation: 0,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        }),
        isVertical: true
      };
    }
    const mapData = {
      ...createBaseCityChannelMap({ width: 4, height: 4, layers: 4 }),
      tiles
    };
    const topVertical = tiles[createCellKey(1, 1, 3)];
    const transform = getTileThreeTransform(topVertical, mapData);
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
      cell: { x: 1, y: 1, z: 4 }
    });
    expect(target.operation).toMatchObject({
      kind: 'tile',
      cell: { x: 1, y: 1, z: 4 },
      isVertical: true
    });
  });
});
