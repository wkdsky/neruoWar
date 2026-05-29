import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from '../cityChannelSchema';
import { createCityChannelPhaserScene } from './CityChannelPhaserScene';
import {
  getAxisOptionKey,
  getSnapAxisKey,
  getWallPhysicalKey
} from './cityChannelVerticalSnap';

const PhaserStub = {
  Scene: class Scene {
    constructor() {}
  }
};

const createMap = ({ tiles = {}, walls = {} } = {}) => ({
  ...createBaseCityChannelMap({
    name: 'snap axis rotation test',
    width: 24,
    height: 24,
    layers: 4
  }),
  tiles,
  walls
});

const createScene = (mapData, config = {}) => {
  const SceneClass = createCityChannelPhaserScene(PhaserStub, {
    mapData,
    activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
    activeTileType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
    activeRotation: 0,
    panelPose: 'floor',
    ...config
  });
  const scene = new SceneClass();
  scene.config = {
    ...scene.config,
    onHoverStatusChange: jest.fn()
  };
  scene.drawGhostLayer = jest.fn();
  scene.updateHover = jest.fn();
  scene.setPlacementPose = function setPlacementPose(pose) {
    this.panelPose = pose;
  };
  return scene;
};

const createWallSupport = ({ x = 10, y = 10, z = 0, edge = 'south' } = {}) => {
  const wall = createWall({
    x,
    y,
    z,
    edge,
    panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
  });
  return {
    kind: 'wall',
    key: createWallKey(x, y, z, edge),
    cell: { x, y, z },
    edge,
    placement: wall
  };
};

const createVerticalTileSupport = ({ x = 10, y = 10, z = 0, rotation = 0 } = {}) => {
  const tile = createTile({
    x,
    y,
    z,
    panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
    rotation,
    isVertical: true
  });
  return {
    kind: 'tile',
    key: createCellKey(x, y, z),
    cell: { x, y, z },
    edge: null,
    placement: tile
  };
};

describe('cityChannel snap axis rotation', () => {
  it('offers both horizontal floor sides across a wall top snap axis', () => {
    const support = createWallSupport({ edge: 'south' });
    const mapData = createMap({
      tiles: {
        [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE })
      },
      walls: {
        [support.key]: support.placement
      }
    });
    const scene = createScene(mapData);
    const snap = {
      cell: { x: 10, y: 10, z: 1 },
      support,
      side: 'top',
      direction: 'up',
      axisEdge: 'south'
    };

    const keys = scene.getAxisPlacementOptions(snap)
      .map((option) => getAxisOptionKey(option));

    expect(keys).toContain(`floor:${createCellKey(10, 10, 1)}`);
    expect(keys).toContain(`floor:${createCellKey(10, 11, 1)}`);
  });

  it('offers free targets around a horizontal corner axis and skips occupied directions', () => {
    const support = createWallSupport({ edge: 'south' });
    const occupiedFloor = createTile({
      x: 10,
      y: 11,
      z: 1,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = createMap({
      tiles: {
        [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
        [createCellKey(10, 11, 1)]: occupiedFloor
      },
      walls: {
        [support.key]: support.placement
      }
    });
    const scene = createScene(mapData);
    const snap = {
      cell: { x: 10, y: 10, z: 1 },
      support,
      side: 'top',
      direction: 'up',
      axisEdge: 'south'
    };

    const options = scene.getAxisPlacementOptions(snap);
    const keys = options.map((option) => scene.getPlacementTargetKey(option));

    expect(keys).not.toContain(`floor:${createCellKey(10, 11, 1)}`);
    expect(options.some((option) => option.kind === 'wall')).toBe(true);
  });

  it('offers wall targets around a vertical corner axis and excludes the occupied wall plane', () => {
    const support = createWallSupport({ edge: 'south' });
    const occupiedCornerWall = createWall({
      x: 10,
      y: 10,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = createMap({
      tiles: {
        [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE })
      },
      walls: {
        [support.key]: support.placement,
        [createWallKey(10, 10, 0, 'east')]: occupiedCornerWall
      }
    });
    const scene = createScene(mapData);
    const snap = {
      cell: { x: 11, y: 10, z: 0 },
      support,
      side: 'side',
      direction: 'east',
      axisEdge: 'west'
    };
    const occupiedPhysicalKey = getWallPhysicalKey({ x: 10, y: 10, z: 0 }, 'east');

    const options = scene.getAxisPlacementOptions(snap);

    expect(options.some((option) => (
      option.kind === 'wall'
      && getWallPhysicalKey(option.cell, option.edge) === occupiedPhysicalKey
    ))).toBe(false);
  });

  it('offers perpendicular wall targets around a wall endpoint side snap', () => {
    const support = createWallSupport({ edge: 'south' });
    const mapData = createMap({
      tiles: {
        [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE })
      },
      walls: {
        [support.key]: support.placement
      }
    });
    const scene = createScene(mapData);
    const snap = {
      cell: { x: 11, y: 10, z: 0 },
      support,
      side: 'side',
      direction: 'east',
      axisEdge: 'west'
    };
    const currentSideKey = getWallPhysicalKey({ x: 11, y: 10, z: 0 }, 'west');
    const perpendicularKey = getWallPhysicalKey({ x: 11, y: 10, z: 0 }, 'south');

    const keys = scene.getAxisPlacementOptions(snap)
      .map((option) => getAxisOptionKey(option));

    expect(keys).toContain(`wall:${currentSideKey}`);
    expect(keys).toContain(`wall:${perpendicularKey}`);
  });

  it('keeps the remaining free endpoint wall target when adjacent directions are occupied', () => {
    const support = createWallSupport({ edge: 'south' });
    const occupiedNorthSide = createWall({
      x: 11,
      y: 10,
      z: 0,
      edge: 'west',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const occupiedSouthSide = createWall({
      x: 11,
      y: 11,
      z: 0,
      edge: 'west',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = createMap({
      tiles: {
        [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE })
      },
      walls: {
        [support.key]: support.placement,
        [createWallKey(11, 10, 0, 'west')]: occupiedNorthSide,
        [createWallKey(11, 11, 0, 'west')]: occupiedSouthSide
      }
    });
    const scene = createScene(mapData);
    const snap = {
      cell: { x: 11, y: 10, z: 0 },
      support,
      side: 'side',
      direction: 'east',
      axisEdge: 'west'
    };
    const freePerpendicularKey = getWallPhysicalKey({ x: 11, y: 10, z: 0 }, 'south');
    const occupiedNorthKey = getWallPhysicalKey({ x: 11, y: 10, z: 0 }, 'west');
    const occupiedSouthKey = getWallPhysicalKey({ x: 11, y: 11, z: 0 }, 'west');

    const keys = scene.getAxisPlacementOptions(snap)
      .map((option) => getAxisOptionKey(option));

    expect(keys).toContain(`wall:${freePerpendicularKey}`);
    expect(keys).not.toContain(`wall:${occupiedNorthKey}`);
    expect(keys).not.toContain(`wall:${occupiedSouthKey}`);
  });

  it('keeps vertical-board middle snaps on the same side axis while finding open wall targets', () => {
    const support = createVerticalTileSupport({ rotation: 0 });
    const mapData = createMap({
      tiles: {
        [support.key]: support.placement
      }
    });
    const scene = createScene(mapData);
    const snap = {
      cell: { x: 11, y: 10, z: 0 },
      support,
      side: 'side',
      direction: 'east',
      axisEdge: 'west'
    };
    const axisPhysicalKey = getWallPhysicalKey({ x: 10, y: 10, z: 0 }, 'east');

    const options = scene.getAxisPlacementOptions(snap);

    expect(options.some((option) => (
      option.kind === 'wall'
      && getWallPhysicalKey(option.cell, option.edge) === axisPhysicalKey
    ))).toBe(true);
  });

  it('does not handle X as a snap-axis keyboard shortcut', () => {
    const scene = createScene(createMap());
    scene.snapPlaneCycle = 0;
    const event = {
      key: 'x',
      code: 'KeyX',
      preventDefault: jest.fn(),
      target: { tagName: 'canvas' }
    };

    scene.handleKeyDown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(scene.snapPlaneCycle).toBe(0);
    expect(scene.drawGhostLayer).not.toHaveBeenCalled();
  });

  it('routes Space to cycleActivePlacementSnapAxis when a snap axis exists', () => {
    const scene = createScene(createMap());
    const hitInfo = { cell: { x: 10, y: 10, z: 0 }, hit: null, edge: 'north', localPoint: { x: 0, y: 0 } };
    const snap = { cell: { x: 10, y: 10, z: 0 }, support: { key: 'support' }, axisEdge: 'north' };
    scene.input = { activePointer: null };
    scene.hoverCell = hitInfo.cell;
    scene.hoverEdge = hitInfo.edge;
    scene.hoverTarget = { hit: hitInfo.hit, localPoint: hitInfo.localPoint };
    scene.resolvePlacementEdgeSnap = jest.fn(() => snap);
    scene.cycleActivePlacementSnapAxis = jest.fn(() => true);
    const event = {
      key: ' ',
      code: 'Space',
      preventDefault: jest.fn(),
      target: { tagName: 'canvas' }
    };

    scene.handleKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(scene.cycleActivePlacementSnapAxis).toHaveBeenCalled();
  });

  it('rotates a new floor placement to the next free floor snap-axis target', () => {
    const scene = createScene(createMap());
    const hitInfo = { cell: { x: 10, y: 10, z: 0 }, hit: null, edge: 'north', localPoint: { x: 0, y: 0 } };
    const snap = { cell: { x: 10, y: 10, z: 0 }, support: { key: 'support' }, axisEdge: 'north' };
    scene.getActivePointerPlacementHitInfo = jest.fn(() => hitInfo);
    scene.resolvePlacementEdgeSnap = jest.fn(() => snap);
    scene.getAxisPlacementOptions = jest.fn(() => [
      { kind: 'floor', cell: { x: 10, y: 11, z: 0 }, valid: true },
      { kind: 'wall', cell: { x: 10, y: 10, z: 0 }, edge: 'east', valid: true },
      { kind: 'floor', cell: { x: 9, y: 10, z: 0 }, valid: true }
    ]);
    scene.getPreferredAxisPlacementIndex = jest.fn(() => 0);
    scene.activeSnapAxisKey = getSnapAxisKey(snap);
    scene.snapPlaneCycle = 0;

    const handled = scene.cycleActivePlacementSnapAxis();

    expect(handled).toBe(true);
    expect(scene.activeSnapAxisKey).toBe(getSnapAxisKey(snap));
    expect(scene.snapPlaneCycle).toBe(2);
    expect(scene.panelPose).toBe('floor');
    expect(scene.drawGhostLayer).toHaveBeenCalledWith(true);
  });

  it('jumps from an inside wall endpoint target to the free perpendicular target', () => {
    const support = createWallSupport({ edge: 'south' });
    const occupiedSouthSide = createWall({
      x: 11,
      y: 11,
      z: 0,
      edge: 'west',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const scene = createScene(createMap({
      tiles: {
        [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE })
      },
      walls: {
        [support.key]: support.placement,
        [createWallKey(11, 11, 0, 'west')]: occupiedSouthSide
      }
    }));
    const hitInfo = { cell: { x: 10, y: 10, z: 0 }, hit: null, edge: 'east', localPoint: { x: 0, y: 0 } };
    const snap = {
      cell: { x: 11, y: 10, z: 0 },
      support,
      side: 'side',
      direction: 'east',
      axisEdge: 'west'
    };
    const currentSideKey = `wall:${getWallPhysicalKey({ x: 11, y: 10, z: 0 }, 'west')}`;
    const perpendicularKey = `wall:${getWallPhysicalKey({ x: 11, y: 10, z: 0 }, 'south')}`;
    const options = scene.getAxisPlacementOptions(snap);
    const currentIndex = options.findIndex((option) => getAxisOptionKey(option) === currentSideKey);
    const perpendicularIndex = options.findIndex((option) => getAxisOptionKey(option) === perpendicularKey);
    scene.getActivePointerPlacementHitInfo = jest.fn(() => hitInfo);
    scene.resolvePlacementEdgeSnap = jest.fn(() => snap);
    scene.panelPose = 'wall';
    scene.activeSnapAxisKey = getSnapAxisKey(snap);
    scene.snapPlaneCycle = currentIndex;

    const handled = scene.cycleActivePlacementSnapAxis();

    expect(currentIndex).toBeGreaterThanOrEqual(0);
    expect(perpendicularIndex).toBeGreaterThanOrEqual(0);
    expect(handled).toBe(true);
    expect(scene.snapPlaneCycle).toBe(perpendicularIndex);
    expect(scene.panelPose).toBe('wall');
    expect(scene.drawGhostLayer).toHaveBeenCalledWith(true);
  });

  it('rotates a moving floor placement to the next free floor snap-axis target', () => {
    const scene = createScene(createMap(), {
      activeTool: CITY_CHANNEL_TOOLS.BROWSE
    });
    scene.carryState = {
      kind: 'placement',
      origins: [{ x: 10, y: 10, z: 0 }],
      snapAxisKey: 'axis-a',
      snapPlaneCycle: 0,
      defaultPose: 'floor'
    };
    scene.getCarryDefaultPose = jest.fn(() => 'floor');
    scene.getCarryAxisOptions = jest.fn(() => ({
      axisKey: 'axis-a',
      options: [
        { kind: 'floor', cell: { x: 10, y: 11, z: 0 }, valid: true },
        { kind: 'wall', cell: { x: 10, y: 10, z: 0 }, edge: 'east', valid: true },
        { kind: 'floor', cell: { x: 9, y: 10, z: 0 }, valid: true }
      ]
    }));

    const handled = scene.cycleCarrySnapAxisRotation();

    expect(handled).toBe(true);
    expect(scene.carryState.snapPlaneCycle).toBe(2);
    expect(scene.carryState.axisTarget).toEqual({
      x: 9,
      y: 10,
      z: 0,
      layFlat: true
    });
    expect(scene.drawGhostLayer).toHaveBeenCalledWith(true);
  });

  it('offers vertical-up plus two perpendicular floors on a vertical-tile top axis', () => {
    const support = createVerticalTileSupport({ rotation: 0 });
    const mapData = createMap({
      tiles: {
        [support.key]: support.placement
      }
    });
    const scene = createScene(mapData);
    const snap = {
      cell: { x: 10, y: 10, z: 1 },
      support,
      side: 'top',
      direction: 'up',
      axisEdge: 'south'
    };

    const options = scene.getAxisPlacementOptions(snap);
    const keys = options.map((option) => getAxisOptionKey(option));

    // 竖直向上落在自身格（vfloor 前缀区分于同格平放）。
    expect(keys).toContain(`vfloor:${createCellKey(10, 10, 1)}`);
    // rot0 东西向竖板 → 前/后水平平放落到北/南邻格。
    expect(keys).toContain(`floor:${createCellKey(10, 9, 1)}`);
    expect(keys).toContain(`floor:${createCellKey(10, 11, 1)}`);
    // 不应把平放误落到竖板正上方格。
    expect(keys).not.toContain(`floor:${createCellKey(10, 10, 1)}`);
  });

  it('cycles only the two perpendicular floors on a top axis while horizontal', () => {
    const support = createVerticalTileSupport({ rotation: 0 });
    const scene = createScene(createMap({
      tiles: {
        [support.key]: support.placement
      }
    }));
    const hitInfo = { cell: { x: 10, y: 10, z: 1 }, hit: null, edge: 'south', localPoint: { x: 0, y: 0 } };
    const snap = {
      cell: { x: 10, y: 10, z: 1 },
      support,
      side: 'top',
      direction: 'up',
      axisEdge: 'south'
    };
    // 选项顺序：竖直向上(vfloor) / 前(floor) / 后(floor)。
    const options = [
      { kind: 'floor', cell: { x: 10, y: 10, z: 1 }, isVertical: true, valid: true },
      { kind: 'floor', cell: { x: 10, y: 9, z: 1 }, layFlat: true, valid: true },
      { kind: 'floor', cell: { x: 10, y: 11, z: 1 }, layFlat: true, valid: true }
    ];
    scene.getActivePointerPlacementHitInfo = jest.fn(() => hitInfo);
    scene.resolvePlacementEdgeSnap = jest.fn(() => snap);
    scene.getAxisPlacementOptions = jest.fn(() => options);
    scene.resolveDynamicPlacementTarget = jest.fn(() => options[1]);
    scene.panelPose = 'floor';
    scene.activeSnapAxisKey = getSnapAxisKey(snap);
    scene.snapPlaneCycle = 1;

    // 水平姿态：从「前」推进到「后」，不会落到竖直向上(index 0)。
    expect(scene.cycleActivePlacementSnapAxis()).toBe(true);
    expect(scene.snapPlaneCycle).toBe(2);
    expect(scene.panelPose).toBe('floor');
    expect(scene.drawGhostLayer).toHaveBeenCalledWith(true);
  });

  it('keeps a vertical top snap axis available while placing horizontally', () => {
    const support = createVerticalTileSupport({ rotation: 0 });
    const scene = createScene(createMap({
      tiles: {
        [support.key]: support.placement
      }
    }));
    const hitInfo = {
      cell: { x: 10, y: 10, z: 0 },
      hit: {
        type: 'tile',
        tile: support.placement,
        cell: { x: 10, y: 10, z: 0 }
      },
      localPoint: { x: 0, y: 0 }
    };
    const snap = {
      cell: { x: 10, y: 10, z: 1 },
      support,
      side: 'top',
      direction: 'up',
      axisEdge: 'south'
    };
    scene.panelPose = 'floor';
    scene.isWallPlacementActive = jest.fn(() => false);
    scene.isVerticalSurfaceHit = jest.fn(() => true);
    scene.resolveVerticalSurfaceSnap = jest.fn(() => snap);
    scene.resolveVerticalGapFloorSnap = jest.fn(() => null);
    scene.resolveFloorEdgePlacementTarget = jest.fn(() => null);

    expect(scene.resolvePlacementEdgeSnap(hitInfo)).toBe(snap);
  });

  it('cycles a moving vertical board between perpendicular top floors while horizontal', () => {
    const support = createVerticalTileSupport({ rotation: 0 });
    const scene = createScene(createMap({
      tiles: {
        [support.key]: support.placement,
        [createCellKey(12, 10, 0)]: createTile({
          x: 12,
          y: 10,
          z: 0,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
          isVertical: true
        })
      }
    }), {
      activeTool: CITY_CHANNEL_TOOLS.BROWSE
    });
    const snap = {
      cell: { x: 10, y: 10, z: 1 },
      support,
      side: 'top',
      direction: 'up',
      axisEdge: 'south'
    };
    const options = [
      { kind: 'floor', cell: { x: 10, y: 10, z: 1 }, isVertical: true, valid: true },
      { kind: 'floor', cell: { x: 10, y: 9, z: 1 }, layFlat: true, valid: true },
      { kind: 'floor', cell: { x: 10, y: 11, z: 1 }, layFlat: true, valid: true }
    ];
    scene.carryState = {
      kind: 'placement',
      origins: [{ x: 12, y: 10, z: 0 }],
      snapAxisKey: getSnapAxisKey(snap),
      snapPlaneCycle: 1,
      axisTarget: { x: 10, y: 9, z: 1, layFlat: true },
      defaultPose: 'floor'
    };
    scene.getCarryDefaultPose = jest.fn(() => 'floor');
    scene.getCarryAxisOptions = jest.fn(() => ({
      axisKey: getSnapAxisKey(snap),
      options
    }));

    const handled = scene.cycleCarrySnapAxisRotation();

    expect(handled).toBe(true);
    expect(scene.carryState.snapPlaneCycle).toBe(2);
    expect(scene.carryState.axisTarget).toEqual({
      x: 10,
      y: 11,
      z: 1,
      layFlat: true
    });
    expect(scene.drawGhostLayer).toHaveBeenCalledWith(true);
  });

  it('does not switch direction on a top axis while vertical (only one upward target)', () => {
    const support = createVerticalTileSupport({ rotation: 0 });
    const scene = createScene(createMap({
      tiles: {
        [support.key]: support.placement
      }
    }));
    const hitInfo = { cell: { x: 10, y: 10, z: 1 }, hit: null, edge: 'south', localPoint: { x: 0, y: 0 } };
    const snap = {
      cell: { x: 10, y: 10, z: 1 },
      support,
      side: 'top',
      direction: 'up',
      axisEdge: 'south'
    };
    const verticalOption = { kind: 'floor', cell: { x: 10, y: 10, z: 1 }, isVertical: true, valid: true };
    const options = [
      verticalOption,
      { kind: 'floor', cell: { x: 10, y: 9, z: 1 }, layFlat: true, valid: true },
      { kind: 'floor', cell: { x: 10, y: 11, z: 1 }, layFlat: true, valid: true }
    ];
    scene.getActivePointerPlacementHitInfo = jest.fn(() => hitInfo);
    scene.resolvePlacementEdgeSnap = jest.fn(() => snap);
    scene.getAxisPlacementOptions = jest.fn(() => options);
    scene.resolveDynamicPlacementTarget = jest.fn(() => verticalOption);
    scene.panelPose = 'wall';
    scene.activeSnapAxisKey = getSnapAxisKey(snap);
    scene.snapPlaneCycle = 0;

    // 竖放姿态：竖直方向只有「向上」一个，Space 不切换方向。
    expect(scene.cycleActivePlacementSnapAxis()).toBe(true);
    expect(scene.snapPlaneCycle).toBe(0);
    expect(scene.panelPose).toBe('wall');
  });

  it('routes carry Space to cycleCarrySnapAxisRotation when an axis exists', () => {
    const scene = createScene(createMap(), { activeTool: CITY_CHANNEL_TOOLS.BROWSE });
    scene.carryState = { kind: 'placement', origins: [{ x: 10, y: 10, z: 0 }] };
    scene.isCarryForcedHorizontal = jest.fn(() => false);
    scene.getCarryAxisOptions = jest.fn(() => ({ axisKey: 'axis-a', options: [] }));
    scene.cycleCarrySnapAxisRotation = jest.fn(() => true);
    scene.toggleCarryDefaultPose = jest.fn(() => true);

    expect(scene.handleSpaceSurfaceToggle()).toBe(true);
    expect(scene.cycleCarrySnapAxisRotation).toHaveBeenCalled();
    expect(scene.toggleCarryDefaultPose).not.toHaveBeenCalled();
  });

  it('routes carry Space to toggleCarryDefaultPose when no axis exists', () => {
    const scene = createScene(createMap(), { activeTool: CITY_CHANNEL_TOOLS.BROWSE });
    scene.carryState = { kind: 'placement', origins: [{ x: 10, y: 10, z: 0 }] };
    scene.isCarryForcedHorizontal = jest.fn(() => false);
    scene.getCarryAxisOptions = jest.fn(() => ({ axisKey: null, options: [] }));
    scene.cycleCarrySnapAxisRotation = jest.fn(() => true);
    scene.toggleCarryDefaultPose = jest.fn(() => true);

    expect(scene.handleSpaceSurfaceToggle()).toBe(true);
    expect(scene.toggleCarryDefaultPose).toHaveBeenCalled();
    expect(scene.cycleCarrySnapAxisRotation).not.toHaveBeenCalled();
  });

  it('uses Shift+wheel to rotate a moving placement surface instead of zooming', () => {
    const scene = createScene(createMap(), {
      activeTool: CITY_CHANNEL_TOOLS.BROWSE
    });
    scene.carryState = {
      kind: 'placement',
      origins: [{ x: 10, y: 10, z: 0 }],
      defaultPose: 'floor'
    };
    scene.cameraState = { zoom: 1, yaw: 0 };
    scene.rotateCarryPlacementSurface = jest.fn();
    scene.updateCameraTransform = jest.fn();

    scene.handleWheel({ event: { shiftKey: true } }, [], 0, -120);

    expect(scene.rotateCarryPlacementSurface).toHaveBeenCalledWith('forward');
    expect(scene.updateCameraTransform).not.toHaveBeenCalled();
  });
});
