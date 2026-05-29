import { CITY_CHANNEL_TILE_TYPES } from '../cityChannelSchema';
import {
  isDoubleClickMechanismHit,
  normalizeInspectableHit,
  restoreSourceInspectAlpha,
  setSourceInspectAlpha
} from './cityChannelInspection';

describe('cityChannelInspection', () => {
  it('normalizes mechanical port hits to tile hits for inspection and selection', () => {
    const tile = { panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE };
    expect(normalizeInspectableHit({
      type: 'mechanical_port',
      cell: { x: 1, y: 2, z: 0 },
      panelType: tile.panelType,
      tile
    })).toEqual({
      type: 'tile',
      cell: { x: 1, y: 2, z: 0 },
      panelType: tile.panelType,
      hitZone: 'base',
      tile
    });
  });

  it('detects repeated clicks on the same non-portal tile', () => {
    const scene = { time: { now: 1000 }, lastMechanismDown: null };
    const hit = {
      type: 'tile',
      cell: { x: 1, y: 2, z: 0 },
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    };

    expect(isDoubleClickMechanismHit(scene, { x: 20, y: 30 }, hit)).toBe(false);
    scene.time.now = 1100;
    expect(isDoubleClickMechanismHit(scene, { x: 24, y: 31 }, hit)).toBe(true);
  });

  it('restores source object alpha after inspection', () => {
    const object = {
      alpha: 0.7,
      data: {},
      getData(key) {
        return this.data[key];
      },
      setData(key, value) {
        this.data[key] = value;
      },
      setAlpha(value) {
        this.alpha = value;
      }
    };
    const scene = {
      renderObjects: new Map([
        ['tile:0:1:2', object]
      ])
    };

    setSourceInspectAlpha(scene, '0:1:2', 0.2);
    expect(object.alpha).toBe(0.2);
    restoreSourceInspectAlpha(scene, '0:1:2');
    expect(object.alpha).toBe(0.7);
  });
});
