import React, { useMemo } from 'react';
import {
  CITY_CHANNEL_HEIGHT,
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_WIDTH,
  createCellKey
} from './cityChannelSchema';

const TILE_WIDTH = 58;
const TILE_HEIGHT = 30;
const ORIGIN_X = 460;
const ORIGIN_Y = 34;

const tileClassByType = {
  [CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR]: 'is-wood',
  [CITY_CHANNEL_TILE_TYPES.STONE_FLOOR]: 'is-stone',
  [CITY_CHANNEL_TILE_TYPES.IRON_FLOOR]: 'is-iron',
  [CITY_CHANNEL_TILE_TYPES.WALL]: 'is-wall',
  [CITY_CHANNEL_TILE_TYPES.STAIR]: 'is-stair'
};

const tileGlyphByType = {
  [CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR]: '木',
  [CITY_CHANNEL_TILE_TYPES.STONE_FLOOR]: '石',
  [CITY_CHANNEL_TILE_TYPES.IRON_FLOOR]: '铁',
  [CITY_CHANNEL_TILE_TYPES.WALL]: '墙',
  [CITY_CHANNEL_TILE_TYPES.STAIR]: '梯'
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
                zIndex: cell.zIndex + (tile?.panelType === CITY_CHANNEL_TILE_TYPES.WALL ? 6 : 0)
              }}
              onClick={() => onCellClick(cell)}
            >
              <span className="city-channel-cell__face" />
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
