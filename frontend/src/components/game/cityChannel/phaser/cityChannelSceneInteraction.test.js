import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  createBaseCityChannelMap,
  createCellKey,
  createTile
} from '../cityChannelSchema';
import { applyPaint } from './cityChannelEditorInteraction';
import { createCityChannelPhaserScene } from './CityChannelPhaserScene';
import {
  TILE_RENDER_HEIGHT,
  TILE_RENDER_WIDTH,
  createVerticalTileWallGeometry,
  projectCell
} from './renderer/CityChannelGeometry';
import { GEAR_COMPONENT_TYPE } from './cityChannelPhaserSceneUtils';
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
});
