import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  createBaseCityChannelMap,
  createCellKey,
  createTile
} from '../cityChannelSchema';
import {
  getGearNodesForMounts,
  triggerMechanismFromHit
} from './cityChannelMechanismPlayback';

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
});
