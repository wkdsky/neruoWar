import {
  CITY_CHANNEL_TILE_TYPES,
  createTile
} from '../cityChannelSchema';
import {
  drawMechanismState,
  getMechanismVisualFlags
} from './cityChannelMechanismVisuals';

describe('cityChannelMechanismVisuals', () => {
  it('marks selected and hovered mechanism tiles', () => {
    const tile = createTile({
      x: 2,
      y: 3,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    const scene = {
      hoverTarget: {
        hit: {
          type: 'tile',
          cell: { x: 2, y: 3, z: 0 }
        }
      },
      selectedCells: [{ x: 2, y: 3, z: 0 }]
    };

    expect(getMechanismVisualFlags(scene, tile, 0.5)).toEqual({
      isSelected: true,
      isHover: true,
      isRunning: true
    });
  });

  it('draws gear pressure plate mechanism hints through the texture cache', () => {
    const tile = createTile({
      x: 2,
      y: 3,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
    });
    const graphics = {
      clear: jest.fn(),
      fillEllipse: jest.fn(),
      fillStyle: jest.fn(),
      lineStyle: jest.fn(),
      strokeEllipse: jest.fn()
    };
    const scene = {
      cameraState: { yaw: 0 },
      hoverTarget: null,
      selectedCells: [],
      textureCache: {
        drawGearPressurePlateCornerHint: jest.fn()
      }
    };

    drawMechanismState(scene, tile, { graphics }, 0.5, {}, 0);

    expect(graphics.clear).toHaveBeenCalled();
    expect(scene.textureCache.drawGearPressurePlateCornerHint).toHaveBeenCalledWith(
      graphics,
      expect.objectContaining({ top: expect.any(Array) }),
      expect.any(Number)
    );
  });
});
