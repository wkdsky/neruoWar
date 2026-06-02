import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from '../cityChannelSchema';
import { applyPaint } from './cityChannelEditorInteraction';
import { createCityChannelPhaserScene } from './CityChannelPhaserScene';
import {
  TILE_RENDER_HEIGHT,
  TILE_RENDER_WIDTH,
  createVerticalTileWallGeometry,
  projectCell
} from './renderer/CityChannelGeometry';
import {
  GEAR_COMPONENT_TYPE,
  SELECTED_MOVE_HOLD_DELAY
} from './cityChannelPhaserSceneUtils';
import {
  compareCityChannelHits,
  PAINT_DRAG_START_DISTANCE,
  shouldStartPaintDrag
} from './cityChannelSceneInteraction';

describe('cityChannelSceneInteraction', () => {
  const PhaserStub = {
    Scene: class Scene {
      constructor() {}
    }
  };

  const getPolygonCenter = (polygon = []) => ({
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length
  });

  it('prefers higher depth over selectionPriority when selecting with occlusion', () => {
    const floorHit = { depth: 120000, selectionPriority: 0 };
    const wallHit = { depth: 80000, selectionPriority: 1 };

    expect(compareCityChannelHits(floorHit, wallHit, { preferOcclusion: true })).toBeLessThan(0);
    expect(compareCityChannelHits(wallHit, floorHit, { preferOcclusion: true })).toBeGreaterThan(0);
  });

  it('keeps selectionPriority ahead of depth for placement snapping', () => {
    const floorHit = { depth: 120000, selectionPriority: 0 };
    const wallHit = { depth: 80000, selectionPriority: 1 };

    expect(compareCityChannelHits(floorHit, wallHit)).toBeGreaterThan(0);
    expect(compareCityChannelHits(wallHit, floorHit)).toBeLessThan(0);
  });

  it('still prefers snapPriority targets before depth in selection mode', () => {
    const gearHit = { depth: 1000, snapPriority: 2 };
    const floorHit = { depth: 120000, snapPriority: 0 };

    expect(compareCityChannelHits(gearHit, floorHit, { preferOcclusion: true })).toBeLessThan(0);
  });

  it('prefers the front gear-surface hit over a back one regardless of snapPriority', () => {
    const frontFloor = { depth: 120000, snapPriority: 0, gearSurfacePlane: true };
    const backVertical = { depth: 80000, snapPriority: 2, gearSurfacePlane: true };

    expect(compareCityChannelHits(frontFloor, backVertical)).toBeLessThan(0);
    expect(compareCityChannelHits(backVertical, frontFloor)).toBeGreaterThan(0);
    expect(compareCityChannelHits(frontFloor, backVertical, { preferOcclusion: true })).toBeLessThan(0);
    expect(compareCityChannelHits(backVertical, frontFloor, { preferOcclusion: true })).toBeGreaterThan(0);
  });

  it('falls back to snapPriority when only one hit is on gear surface', () => {
    const floorHit = { depth: 120000, snapPriority: 0, gearSurfacePlane: true };
    const verticalHit = { depth: 80000, snapPriority: 2 };

    expect(compareCityChannelHits(floorHit, verticalHit)).toBeGreaterThan(0);
    expect(compareCityChannelHits(verticalHit, floorHit)).toBeLessThan(0);
  });

  it('uses a drag threshold for paint interactions', () => {
    expect(shouldStartPaintDrag(
      { startX: 100, startY: 100 },
      { x: 100 + PAINT_DRAG_START_DISTANCE - 1, y: 100 }
    )).toBe(false);
    expect(shouldStartPaintDrag(
      { startX: 100, startY: 100 },
      { x: 100 + PAINT_DRAG_START_DISTANCE, y: 100 }
    )).toBe(true);
    expect(shouldStartPaintDrag({}, { x: 240, y: 160 })).toBe(false);
  });

  it('clears selected gears on right click before browse context handling returns', () => {
    const SceneClass = createCityChannelPhaserScene(PhaserStub, {
      mapData: createBaseCityChannelMap({ name: 'gear context clear' }),
      activeTool: CITY_CHANNEL_TOOLS.BROWSE
    });
    const scene = new SceneClass();
    scene.activeTool = CITY_CHANNEL_TOOLS.BROWSE;
    scene.selectedCells = [];
    scene.selectedWalls = [];
    scene.selectedGears = [{
      hostKind: 'tile',
      hostKey: createCellKey(1, 1, 0),
      mountId: 'gear_selected'
    }];
    scene.hitTest = jest.fn(() => ({ hit: null }));
    scene.setSelection = jest.fn();

    scene.handleContextAction({
      event: { button: 2 },
      rightButtonDown: () => true
    });

    expect(scene.setSelection).toHaveBeenCalledWith([], [], [], null);
  });

  it('cancels an active mechanism preview on right click', () => {
    const SceneClass = createCityChannelPhaserScene(PhaserStub, {
      mapData: createBaseCityChannelMap({ name: 'cancel preview context' }),
      activeTool: CITY_CHANNEL_TOOLS.BROWSE
    });
    const scene = new SceneClass();
    const motion = { angle: 30 };
    const timer = { remove: jest.fn() };
    const resetter = jest.fn();
    scene.activeTool = CITY_CHANNEL_TOOLS.BROWSE;
    scene.mechanismRuntimeSnapshot = {
      sourceAngle: 30,
      placements: {},
      gears: {},
      sync: [],
      obstruction: null
    };
    scene.mechanismPreviewTargets.add(motion);
    scene.mechanismPreviewTimers.add(timer);
    scene.mechanismPreviewResetters.add(resetter);
    scene.tweens = { killTweensOf: jest.fn() };
    scene.config = {
      onMechanismRuntimeSnapshot: jest.fn(),
      onMechanismPreviewProgress: jest.fn()
    };
    scene.renderMap = jest.fn();
    scene.hitTest = jest.fn(() => ({ hit: null }));

    scene.handleContextAction({
      event: { button: 2 },
      rightButtonDown: () => true
    });

    expect(scene.tweens.killTweensOf).toHaveBeenCalledWith(motion);
    expect(timer.remove).toHaveBeenCalledWith(false);
    expect(resetter).toHaveBeenCalled();
    expect(scene.mechanismRuntimeSnapshot).toBeNull();
    expect(scene.config.onMechanismRuntimeSnapshot).toHaveBeenCalledWith(null);
    expect(scene.config.onMechanismPreviewProgress).toHaveBeenCalledWith(null);
  });

  it('flashes a mechanism obstruction with the conflict outline style', () => {
    const SceneClass = createCityChannelPhaserScene(PhaserStub, {
      mapData: createBaseCityChannelMap({ name: 'obstruction flash' })
    });
    const scene = new SceneClass();
    const layer = {
      clear: jest.fn(),
      fillStyle: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      fillPath: jest.fn(),
      lineStyle: jest.fn(),
      strokePath: jest.fn(),
      depth: 0
    };
    scene.conflictFlashLayer = layer;
    scene.getTileLocalPolygons = jest.fn(() => [[
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]]);
    scene.tweens = {
      killTweensOf: jest.fn(),
      add: jest.fn((config) => {
        config.targets.alpha = 1;
        config.onUpdate?.();
        config.onComplete?.();
      })
    };
    const obstacle = createTile({ x: 1, y: 1, z: 0 });

    expect(scene.flashMechanismObstruction({ obstacle })).toBe(true);

    expect(scene.tweens.add).toHaveBeenCalledWith(expect.objectContaining({
      duration: 220,
      repeat: 1,
      repeatDelay: 120,
      yoyo: true
    }));
    expect(layer.fillStyle).toHaveBeenCalledWith(0xff0000, expect.any(Number));
    expect(layer.lineStyle).toHaveBeenCalledWith(6, 0xff0000, expect.any(Number));
    expect(layer.clear).toHaveBeenCalled();
  });

  it('keeps camera wheel zoom from cancelling a mechanism preview', () => {
    const SceneClass = createCityChannelPhaserScene(PhaserStub, {
      mapData: createBaseCityChannelMap({ name: 'wheel keeps preview' })
    });
    const scene = new SceneClass();
    scene.inspectState = null;
    scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
    scene.cancelMechanismRuntimePreview = jest.fn();
    scene.updateCameraTransform = jest.fn();
    scene.refreshPointerStateAfterViewChange = jest.fn();
    scene.drawSelectionLayer = jest.fn();
    scene.drawGhostLayer = jest.fn();
    scene.updateDebugText = jest.fn();

    scene.handleWheel({ event: { shiftKey: false } }, [], 0, -120);

    expect(scene.cancelMechanismRuntimePreview).not.toHaveBeenCalled();
    expect(scene.updateCameraTransform).toHaveBeenCalled();
  });

  it('uses runtime placement for gear binding candidate visuals', () => {
    const key = createCellKey(1, 1, 0);
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const runtimeTile = { ...tile, x: 3, y: 2, runtimeAngle: 45 };
    const mapData = {
      ...createBaseCityChannelMap({ name: 'runtime binding placement' }),
      tiles: { [key]: tile },
      walls: {}
    };
    const SceneClass = createCityChannelPhaserScene(PhaserStub, { mapData });
    const scene = new SceneClass();
    scene.mapData = mapData;
    scene.mechanismRuntimeSnapshot = {
      sourceAngle: 45,
      placements: { [key]: runtimeTile },
      gears: {},
      sync: [],
      obstruction: null
    };

    expect(scene.getGearBindingCandidatePlacement({
      componentKey: key,
      hostKind: 'tile'
    })).toBe(runtimeTile);
  });

  it('draws selection outlines from runtime placement while previewing', () => {
    const key = createCellKey(1, 1, 0);
    const tile = createTile({
      x: 1,
      y: 1,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const runtimeTile = { ...tile, x: 2, y: 1, rotation: 90, runtimeAngle: 90 };
    const mapData = {
      ...createBaseCityChannelMap({ name: 'runtime selection outline' }),
      tiles: { [key]: tile },
      walls: {}
    };
    const SceneClass = createCityChannelPhaserScene(PhaserStub, { mapData });
    const scene = new SceneClass();
    scene.mapData = mapData;
    scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
    scene.worldLayer = { x: 0, y: 0 };
    scene.selectedCells = [{ x: 1, y: 1, z: 0 }];
    scene.selectedWalls = [];
    scene.hoverCell = null;
    scene.hoverTarget = null;
    scene.mechanismRuntimeSnapshot = {
      sourceAngle: 90,
      placements: { [key]: runtimeTile },
      gears: {},
      sync: [],
      obstruction: null
    };
    scene.selectionLayer = {
      clear: jest.fn(),
      lineStyle: jest.fn(),
      lineBetween: jest.fn()
    };
    scene.getRuntimePlacementScreenPoint = jest.fn(() => ({ x: 500, y: 300 }));

    scene.drawSelectionLayer();

    expect(scene.getRuntimePlacementScreenPoint).toHaveBeenCalledWith(runtimeTile);
    expect(scene.selectionLayer.lineBetween).toHaveBeenCalled();
  });

  it('fully rerenders runtime placements during camera yaw changes', () => {
    const key = createCellKey(1, 1, 0);
    const SceneClass = createCityChannelPhaserScene(PhaserStub, {
      mapData: createBaseCityChannelMap({ name: 'runtime yaw rerender' })
    });
    const scene = new SceneClass();
    scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
    scene.mechanismRuntimeSnapshot = {
      sourceAngle: 45,
      placements: {
        [key]: { x: 2, y: 1, z: 0, runtimeAngle: 45 }
      },
      gears: {},
      sync: [],
      obstruction: null
    };
    scene.renderMap = jest.fn();
    scene.refreshPointerStateAfterViewChange = jest.fn();
    scene.refreshMechanismVisuals = jest.fn();
    scene.notifyCamera = jest.fn();

    scene.updateYaw(30);

    expect(scene.renderMap).toHaveBeenCalledWith({ full: true });
    expect(scene.refreshPointerStateAfterViewChange).toHaveBeenCalled();
    expect(scene.notifyCamera).toHaveBeenCalledWith({ force: true });
  });

  it('hit-tests vertical tiles without assuming floor side polygons', () => {
    const key = createCellKey(16, 16, 0);
    const tile = createTile({
      x: 16,
      y: 16,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      isVertical: true
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'vertical hit test' }),
      tiles: { [key]: tile },
      walls: {}
    };
    const SceneClass = createCityChannelPhaserScene(PhaserStub, {
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT
    });
    const scene = new SceneClass();
    scene.worldLayer = { x: 0, y: 0 };
    scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
    scene.mapData = mapData;
    const projection = projectCell(tile, scene.cameraState.yaw, mapData);
    const geometry = createVerticalTileWallGeometry(scene.cameraState.yaw, tile.rotation || 0);
    const wallCenter = getPolygonCenter(geometry.wall);

    const hitInfo = scene.hitTest({
      x: projection.x - (TILE_RENDER_WIDTH * 0.5) + wallCenter.x,
      y: projection.y - (TILE_RENDER_HEIGHT * 0.57) + wallCenter.y
    }, { allowOutline: true });

    expect(hitInfo.hit).toMatchObject({
      type: 'tile',
      tile
    });
  });

  it('draws vertical pressure plate ghosts without assuming a floor top polygon', () => {
    const mapData = createBaseCityChannelMap({ name: 'vertical pressure plate ghost' });
    const SceneClass = createCityChannelPhaserScene(PhaserStub, {
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      activeTileType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE,
      panelPose: 'wall'
    });
    const scene = new SceneClass();
    scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
    scene.mapData = mapData;
    scene.ghostLayer = {
      beginPath: jest.fn(),
      clear: jest.fn(),
      closePath: jest.fn(),
      fillCircle: jest.fn(),
      fillPath: jest.fn(),
      fillStyle: jest.fn(),
      fillTriangle: jest.fn(),
      lineStyle: jest.fn(),
      lineBetween: jest.fn(),
      lineTo: jest.fn(),
      moveTo: jest.fn(),
      strokeCircle: jest.fn(),
      strokePath: jest.fn(),
      strokeTriangle: jest.fn()
    };
    scene.textureCache = {
      drawGearPressurePlateCornerHint: jest.fn()
    };

    expect(() => scene.drawPlacementGhost({
      x: 16,
      y: 16,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE,
      rotation: 0,
      isVertical: true
    })).not.toThrow();
    expect(scene.textureCache.drawGearPressurePlateCornerHint).toHaveBeenCalledWith(
      scene.ghostLayer,
      expect.objectContaining({ top: expect.any(Array) }),
      0.22
    );
  });

  it('box-selects vertical tiles without assuming side polygons', () => {
    const key = createCellKey(16, 16, 0);
    const tile = {
      ...createTile({
        x: 16,
        y: 16,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      isVertical: true
    };
    const mapData = {
      ...createBaseCityChannelMap({ name: 'vertical box select' }),
      tiles: { [key]: tile },
      walls: {}
    };
    const SceneClass = createCityChannelPhaserScene(PhaserStub, {
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.SELECT
    });
    const scene = new SceneClass();
    scene.worldLayer = { x: 0, y: 0 };
    scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
    scene.mapData = mapData;
    scene.selectedCells = [];
    scene.selectedWalls = [];
    scene.selectedGears = [];
    scene.selectionScope = null;
    scene.selectionLayer = { clear: jest.fn() };
    scene.config = { onSelectionChange: jest.fn() };
    scene.renderObjects = new Map();
    scene.applySelectionScopeVisualState = jest.fn();
    scene.drawSelectionLayer = jest.fn();
    scene.drawGearBindingCandidates = jest.fn();
    scene.refreshMechanismVisuals = jest.fn();
    scene.redrawAllMountedGearLayers = jest.fn();
    scene.sortMapLayer = jest.fn();
    scene.hitTest = jest.fn(() => ({
      hit: {
        type: 'tile',
        cell: { x: tile.x, y: tile.y, z: tile.z },
        tile,
        panelType: tile.panelType
      }
    }));

    expect(() => scene.commitBoxSelect(
      { x: 9999, y: 9999 },
      { startX: -9999, startY: -9999, shiftKey: false }
    )).not.toThrow();
    expect(scene.selectedCells).toEqual([{ x: 16, y: 16, z: 0 }]);
  });

  it('selects newly painted corner gears so binding candidates can render', () => {
    const key = createCellKey(16, 16, 0);
    const tile = createTile({
      x: 16,
      y: 16,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'painted gear selection' }),
      tiles: { [key]: tile },
      walls: {}
    };
    const scene = {
      activeComponentType: GEAR_COMPONENT_TYPE,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
      config: { onSelectionChange: jest.fn() },
      drawGearBindingCandidates: jest.fn(),
      drawGhostLayer: jest.fn(),
      drawSelectionLayer: jest.fn(),
      mapData,
      mechanicalLinkLayer: { clear: jest.fn() },
      mechanicalPortLayer: { clear: jest.fn() },
      getMechanicalAssemblyGraph: jest.fn(() => ({
        assemblies: [],
        assemblyByComponentKey: {}
      })),
      paintStroke: {
        intent: 'place',
        isComponent: true,
        touched: new Set(),
        operations: []
      },
      refreshAfterIncrementalEdit: jest.fn(),
      refreshMechanismVisuals: jest.fn(),
      renderObjects: new Map(),
      renderTileObject: jest.fn(),
      redrawAllMountedGearLayers: jest.fn(),
      selectedCells: [],
      selectedGears: [],
      selectedWalls: [],
      selectionScope: null,
      setSelection: null
    };
    scene.sortMapLayer = jest.fn();
    scene.setSelection = (cells, walls, gears, scope, options) => {
      const { setSelection } = require('./cityChannelEditorInteraction');
      setSelection(scene, cells, walls, gears, scope, options);
    };
    scene.hitTest = jest.fn();
    scene.getGearSurfaceContext = jest.fn(() => ({
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ],
      offsetX: 0,
      offsetY: 0,
      surface: 'floor'
    }));
    scene.mapGearLocalPointToSurface = jest.fn((placement, localPosition) => ({
      x: (localPosition.x + 0.5) * 100,
      y: (localPosition.y + 0.5) * 100
    }));

    applyPaint(scene, { x: 0, y: 0 }, {
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
    });

    expect(scene.selectedGears).toEqual([expect.objectContaining({
      hostKind: 'tile',
      hostKey: key,
      mountId: expect.any(String)
    })]);
    expect(scene.selectionScope).toBe('component');
    expect(scene.drawGearBindingCandidates).toHaveBeenCalled();
  });

  it('hit-tests floating gear binding curves while placing gears', () => {
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
      componentType: GEAR_COMPONENT_TYPE,
      position: 'corner_se',
      socketKind: 'corner',
      surface: 'front'
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'floating binding curves' }),
      tiles: {
        [hostKey]: host,
        [eastKey]: createTile({ x: 17, y: 16, z: 0 }),
        [southKey]: createTile({ x: 16, y: 17, z: 0 }),
        [diagonalKey]: createTile({ x: 17, y: 17, z: 0 })
      },
      walls: {}
    };
    const SceneClass = createCityChannelPhaserScene(PhaserStub, {
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
      activeComponentType: GEAR_COMPONENT_TYPE
    });
    const scene = new SceneClass();
    scene.worldLayer = { x: 0, y: 0 };
    scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
    scene.mapData = mapData;
    scene.activeTool = CITY_CHANNEL_TOOLS.PLACE_COMPONENT;
    scene.activeComponentType = GEAR_COMPONENT_TYPE;
    scene.selectedGears = [{
      hostKind: 'tile',
      hostKey,
      mountId: 'gear_corner',
      cell: { x: 16, y: 16, z: 0 },
      edge: null
    }];

    const context = scene.getSelectedCornerGearBindingContext();
    const candidateIndex = context.candidates.findIndex((candidate) => candidate.componentKey === diagonalKey);
    const visual = scene.getGearBindingCandidateVisual(context, context.candidates[candidateIndex], candidateIndex);
    const hitInfo = scene.hitTest({ x: visual.end.x, y: visual.end.y });
    const midpoint = {
      x: (visual.start.x + visual.end.x) * 0.5,
      y: (visual.start.y + visual.end.y) * 0.5
    };

    expect(context.candidates.map((candidate) => candidate.componentKey)).toEqual(expect.arrayContaining([
      hostKey,
      eastKey,
      southKey,
      diagonalKey
    ]));
    expect(hitInfo.hit).toMatchObject({
      type: 'gearBindingCandidate',
      candidate: expect.objectContaining({
        componentKey: diagonalKey,
        socket: 'corner_nw'
      })
    });
    expect(visual.control.x).toBeCloseTo(midpoint.x, 4);
    expect(visual.control.y).toBeLessThan(midpoint.y - 10);
  });

  it('lets selected gears override binding arrows so long press can start gear carry', () => {
    jest.useFakeTimers();
    try {
      const hostKey = createCellKey(16, 16, 0);
      const diagonalKey = createCellKey(17, 17, 0);
      const host = createTile({
        x: 16,
        y: 16,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      });
      host.gearMounts = [{
        id: 'gear_corner',
        componentType: GEAR_COMPONENT_TYPE,
        position: 'corner_se',
        socketKind: 'corner',
        surface: 'front',
        axisBinding: {
          componentKey: diagonalKey,
          hostKind: 'tile',
          socket: 'corner_nw',
          surface: 'front'
        }
      }];
      const mapData = {
        ...createBaseCityChannelMap({ name: 'selected gear long press' }),
        tiles: {
          [hostKey]: host,
          [diagonalKey]: createTile({ x: 17, y: 17, z: 0 })
        },
        walls: {}
      };
      const SceneClass = createCityChannelPhaserScene(PhaserStub, {
        mapData,
        activeTool: CITY_CHANNEL_TOOLS.PLACE_COMPONENT,
        activeComponentType: GEAR_COMPONENT_TYPE
      });
      const scene = new SceneClass();
      scene.worldLayer = { x: 0, y: 0 };
      scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
      scene.mapData = mapData;
      scene.activeTool = CITY_CHANNEL_TOOLS.PLACE_COMPONENT;
      scene.activeComponentType = GEAR_COMPONENT_TYPE;
      scene.selectedGears = [{
        hostKind: 'tile',
        hostKey,
        mountId: 'gear_corner',
        cell: { x: 16, y: 16, z: 0 },
        edge: null
      }];
      scene.selectionScope = 'component';
      scene.config = {
        onCarryStateChange: jest.fn(),
        onGearAxisPrompt: jest.fn(),
        onHoverStatusChange: jest.fn()
      };
      scene.drawMountedGearPreview = jest.fn();
      scene.redrawAllMountedGearLayers = jest.fn();
      scene.gearBindingCandidateLayer = {
        clear: jest.fn(),
        fillCircle: jest.fn(),
        fillPoints: jest.fn(),
        fillStyle: jest.fn(),
        lineBetween: jest.fn(),
        lineStyle: jest.fn(),
        strokeCircle: jest.fn()
      };
      scene.ghostLayer = {
        clear: jest.fn(),
        fillCircle: jest.fn(),
        fillEllipse: jest.fn(),
        fillStyle: jest.fn(),
        lineStyle: jest.fn(),
        strokeCircle: jest.fn()
      };

      const gearPoint = scene.getGearMountPoint(host, host.gearMounts[0]);
      const hitInfo = scene.hitTest({ x: gearPoint.x, y: gearPoint.y });

      expect(hitInfo.hit).toMatchObject({
        type: 'gear',
        hostKey,
        mount: expect.objectContaining({ id: 'gear_corner' })
      });

      scene.hoverCell = hitInfo.hit.cell;
      scene.hoverTarget = { hit: hitInfo.hit, localPoint: gearPoint };
      scene.drawGearBindingCandidates(0);
      expect(scene.gearBindingCandidateLayer.clear).toHaveBeenCalled();
      expect(scene.gearBindingCandidateLayer.lineStyle).not.toHaveBeenCalled();

      scene.handlePointerDown({
        x: gearPoint.x,
        y: gearPoint.y,
        downTime: 10,
        event: { shiftKey: false },
        rightButtonDown: () => false
      });
      jest.advanceTimersByTime(SELECTED_MOVE_HOLD_DELAY + 1);

      expect(scene.carryState).toMatchObject({
        kind: 'gear',
        gears: [expect.objectContaining({ mountId: 'gear_corner' })]
      });
      expect(scene.drawMountedGearPreview).toHaveBeenCalledWith(
        scene.ghostLayer,
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number)
        }),
        expect.objectContaining({
          ghost: true,
          mount: expect.objectContaining({ position: 'corner_se' }),
          valid: true
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('draws gear binding candidates with cold overlay colors', () => {
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
      componentType: GEAR_COMPONENT_TYPE,
      position: 'corner_se',
      socketKind: 'corner',
      surface: 'front',
      axisBinding: {
        componentKey: diagonalKey,
        hostKind: 'tile',
        socket: 'corner_nw',
        surface: 'front'
      }
    }];
    const mapData = {
      ...createBaseCityChannelMap({ name: 'cold binding overlay' }),
      tiles: {
        [hostKey]: host,
        [eastKey]: createTile({ x: 17, y: 16, z: 0 }),
        [southKey]: createTile({ x: 16, y: 17, z: 0 }),
        [diagonalKey]: createTile({ x: 17, y: 17, z: 0 })
      },
      walls: {}
    };
    const SceneClass = createCityChannelPhaserScene(PhaserStub, {
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.SELECT
    });
    const scene = new SceneClass();
    scene.worldLayer = { x: 0, y: 0 };
    scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
    scene.mapData = mapData;
    scene.selectedGears = [{
      hostKind: 'tile',
      hostKey,
      mountId: 'gear_corner',
      cell: { x: 16, y: 16, z: 0 },
      edge: null
    }];
    scene.gearBindingCandidateLayer = {
      clear: jest.fn(),
      fillCircle: jest.fn(),
      fillPoints: jest.fn(),
      fillStyle: jest.fn(),
      lineBetween: jest.fn(),
      lineStyle: jest.fn(),
      strokeCircle: jest.fn()
    };

    scene.drawGearBindingCandidates(0);

    const warmColors = [0xfacc15, 0xff8a3d, 0x9a3412, 0xb45309];
    const fillColors = scene.gearBindingCandidateLayer.fillStyle.mock.calls.map((call) => call[0]);
    const lineColors = scene.gearBindingCandidateLayer.lineStyle.mock.calls.map((call) => call[1]);
    expect([...fillColors, ...lineColors]).not.toEqual(expect.arrayContaining(warmColors));
    expect(scene.gearBindingCandidateLayer.fillPoints).toHaveBeenCalled();
    expect(scene.gearBindingCandidateLayer.strokeCircle).toHaveBeenCalled();
  });

  it('creates floating binding curves for selected wall gears', () => {
    const hostKey = createWallKey(0, 0, 0, 'east');
    const boundKey = createWallKey(0, 0, 1, 'east');
    const host = createWall({
      x: 0,
      y: 0,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    host.gearMounts = [{
      id: 'gear_wall_corner',
      componentType: GEAR_COMPONENT_TYPE,
      position: 'corner_ne',
      socketKind: 'corner',
      surface: 'front'
    }];
    const bound = createWall({
      x: 0,
      y: 0,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'wall binding curves' }),
      tiles: {},
      walls: {
        [hostKey]: host,
        [boundKey]: bound
      }
    };
    const SceneClass = createCityChannelPhaserScene(PhaserStub, {
      mapData,
      activeTool: CITY_CHANNEL_TOOLS.SELECT
    });
    const scene = new SceneClass();
    scene.worldLayer = { x: 0, y: 0 };
    scene.cameraState = { yaw: 0, zoom: 1, offsetX: 0, offsetY: 0 };
    scene.mapData = mapData;
    scene.activeTool = CITY_CHANNEL_TOOLS.SELECT;
    scene.visibleLayerCutoff = null;
    scene.selectedGears = [{
      hostKind: 'wall',
      hostKey,
      mountId: 'gear_wall_corner',
      cell: { x: 0, y: 0, z: 0 },
      edge: 'east'
    }];

    const context = scene.getSelectedCornerGearBindingContext();
    const candidateIndex = context.candidates.findIndex((candidate) => candidate.componentKey === boundKey);
    const visual = scene.getGearBindingCandidateVisual(context, context.candidates[candidateIndex], candidateIndex);
    const hitInfo = scene.hitTest({ x: visual.end.x, y: visual.end.y });
    const midpoint = {
      x: (visual.start.x + visual.end.x) * 0.5,
      y: (visual.start.y + visual.end.y) * 0.5
    };
    const extrusion = scene.getGearSurfaceContext(host, 'front').extrusion;
    const controlDelta = {
      x: visual.control.x - midpoint.x,
      y: visual.control.y - midpoint.y
    };
    const cross = Math.abs((controlDelta.x * extrusion.y) - (controlDelta.y * extrusion.x));

    expect(context.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        componentKey: boundKey,
        hostKind: 'wall',
        socket: 'corner_se',
        surface: 'front'
      })
    ]));
    expect(hitInfo.hit).toMatchObject({
      type: 'gearBindingCandidate',
      candidate: expect.objectContaining({
        componentKey: boundKey,
        hostKind: 'wall',
        socket: 'corner_se'
      })
    });
    expect(cross).toBeLessThan(0.001);
  });
});
