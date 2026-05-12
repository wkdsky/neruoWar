import React, { useMemo } from 'react';
import {
  CITY_CHANNEL_HEIGHT,
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_WIDTH,
  createCellKey
} from './cityChannelSchema';
import { getCityChannelMaterial, isMechanicalMaterial } from './cityChannelCatalog';

const TILE_WIDTH = 58;
const TILE_HEIGHT = 30;
const ORIGIN_X = 460;
const ORIGIN_Y = 34;

const tileClassByType = {
  [CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR]: 'is-wood',
  [CITY_CHANNEL_TILE_TYPES.STONE_FLOOR]: 'is-stone',
  [CITY_CHANNEL_TILE_TYPES.IRON_FLOOR]: 'is-iron',
  [CITY_CHANNEL_TILE_TYPES.GLASS_FLOOR]: 'is-glass',
  [CITY_CHANNEL_TILE_TYPES.WALL]: 'is-wall',
  [CITY_CHANNEL_TILE_TYPES.GLASS_WALL]: 'is-glass-wall',
  [CITY_CHANNEL_TILE_TYPES.ENTRANCE]: 'is-entrance-tile',
  [CITY_CHANNEL_TILE_TYPES.EXIT]: 'is-exit-tile',
  [CITY_CHANNEL_TILE_TYPES.STAIR]: 'is-stair'
};

const tileGlyphByType = {
  [CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR]: '木',
  [CITY_CHANNEL_TILE_TYPES.STONE_FLOOR]: '石',
  [CITY_CHANNEL_TILE_TYPES.IRON_FLOOR]: '铁',
  [CITY_CHANNEL_TILE_TYPES.GLASS_FLOOR]: '玻',
  [CITY_CHANNEL_TILE_TYPES.WALL]: '墙',
  [CITY_CHANNEL_TILE_TYPES.GLASS_WALL]: '璃',
  [CITY_CHANNEL_TILE_TYPES.ENTRANCE]: '入',
  [CITY_CHANNEL_TILE_TYPES.EXIT]: '出',
  [CITY_CHANNEL_TILE_TYPES.STAIR]: '梯',
  [CITY_CHANNEL_TILE_TYPES.PRESSURE_PLATE]: '压',
  [CITY_CHANNEL_TILE_TYPES.DIRECTIONAL_PRESSURE_PLATE]: '向',
  [CITY_CHANNEL_TILE_TYPES.VERTICAL_PUSH_BUTTON]: '纵',
  [CITY_CHANNEL_TILE_TYPES.HORIZONTAL_PUSH_BUTTON]: '横',
  [CITY_CHANNEL_TILE_TYPES.ROTARY_BUTTON]: '旋',
  [CITY_CHANNEL_TILE_TYPES.EXTERNAL_GEAR_PLATE]: '齿',
  [CITY_CHANNEL_TILE_TYPES.INTERNAL_GEAR_PLATE]: '内',
  [CITY_CHANNEL_TILE_TYPES.PEG_GEAR_PLATE]: '凸',
  [CITY_CHANNEL_TILE_TYPES.TRAPDOOR_PLATE]: '翻',
  [CITY_CHANNEL_TILE_TYPES.SIDE_PUSHER_PLATE]: '推',
  [CITY_CHANNEL_TILE_TYPES.SPRING_PLATE]: '簧'
};

const buildCells = (activeLayer) => {
  const cells = [];
  for (let y = 0; y < CITY_CHANNEL_HEIGHT; y += 1) {
    for (let x = 0; x < CITY_CHANNEL_WIDTH; x += 1) {
      const left = ORIGIN_X + ((x - y) * (TILE_WIDTH / 2));
      const top = ORIGIN_Y + ((x + y) * (TILE_HEIGHT / 2));
      cells.push({
        x,
        y,
        z: activeLayer,
        left,
        top,
        zIndex: ((x + y) * 10) + x
      });
    }
  }
  return cells;
};

const findPointAtCell = (points = [], cell) => points.find((point) => (
  point.x === cell.x && point.y === cell.y && point.z === cell.z
));

const CityChannelEditorCanvas = ({
  mapData,
  activeLayer,
  selectedCell,
  routeKeySet,
  onCellClick
}) => {
  const cells = useMemo(() => buildCells(activeLayer), [activeLayer]);

  return (
    <div className="city-channel-canvas-shell">
      <div className="city-channel-mobile-warning">
        城内通道设计建议在桌面端编辑。当前仍可查看与轻量操作。
      </div>
      <div
        className="city-channel-isometric-board"
        role="grid"
        aria-label="城内通道 2.5D 等距网格"
      >
        {cells.map((cell) => {
          const key = createCellKey(cell.x, cell.y, cell.z);
          const tile = mapData.tiles[key] || null;
          const material = tile ? getCityChannelMaterial(tile.panelType) : null;
          const useVerticalPreview = material?.isVertical
            && tile?.panelType !== CITY_CHANNEL_TILE_TYPES.ENTRANCE
            && tile?.panelType !== CITY_CHANNEL_TILE_TYPES.EXIT;
          const entrance = findPointAtCell(mapData.entrances, cell);
          const exit = findPointAtCell(mapData.exits, cell);
          const isSelected = selectedCell
            && selectedCell.x === cell.x
            && selectedCell.y === cell.y
            && selectedCell.z === cell.z;
          const isRoute = routeKeySet.has(key);
          const className = [
            'city-channel-cell',
            tile ? 'has-tile' : 'is-empty',
            tile ? tileClassByType[tile.panelType] || 'is-wood' : '',
            useVerticalPreview ? 'city-channel-tile--vertical' : '',
            material && isMechanicalMaterial(material) ? 'is-mechanical' : '',
            entrance ? 'has-entrance' : '',
            exit ? 'has-exit' : '',
            tile?.marker === 'safe' ? 'has-safe-marker' : '',
            isSelected ? 'is-selected' : '',
            isRoute ? 'is-route' : ''
          ].filter(Boolean).join(' ');

          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              aria-label={`格子 ${cell.x},${cell.y},${cell.z}`}
              className={className}
              style={{
                left: `${cell.left}px`,
                top: `${cell.top}px`,
                zIndex: cell.zIndex + (useVerticalPreview ? 6 : 0)
              }}
              onClick={() => onCellClick(cell)}
            >
              <span className="city-channel-cell__face" />
              {useVerticalPreview ? (
                <>
                  <span className="city-channel-cell__vertical-outline" aria-hidden="true" />
                  <span className="city-channel-cell__vertical-base" aria-hidden="true" />
                </>
              ) : null}
              {tile ? (
                <span className="city-channel-cell__glyph" aria-hidden="true">
                  {tileGlyphByType[tile.panelType] || ''}
                </span>
              ) : null}
              {entrance ? <span className="city-channel-cell__portal is-entrance">入</span> : null}
              {exit ? <span className="city-channel-cell__portal is-exit">出</span> : null}
              {tile?.marker === 'safe' ? <span className="city-channel-cell__safe">白</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CityChannelEditorCanvas;
