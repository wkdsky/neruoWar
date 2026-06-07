import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile
} from './cityChannelSchema';
import {
  CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS
} from './cityChannelMechanismRuntime';
import {
  DOUBLE_SIDED_RACK_COMPONENT_TYPE
} from './cityChannelRackModel';
import {
  getGearRotationDirectionConfigStatus
} from './cityChannelGearRotationConfig';

describe('cityChannelGearRotationConfig', () => {
  it('blocks direction config when an active gear drives the target through a rack', () => {
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

    const status = getGearRotationDirectionConfigStatus({
      mapData,
      componentKey: drivenKey,
      placement: driven,
      mount: driven.gearMounts[0]
    });

    expect(status).toMatchObject({
      canConfigure: false,
      pressureLinked: true,
      blockedByActiveGear: true
    });
    expect(status.activeNeighborIds).toContain(`${sourceKey}:gear_corner`);
  });
});
