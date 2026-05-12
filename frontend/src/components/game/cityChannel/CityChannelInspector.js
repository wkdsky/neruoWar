import React, { useMemo } from 'react';
import { Activity, Inspect, Network } from 'lucide-react';
import {
  CITY_CHANNEL_LAYER_LABELS,
  CITY_CHANNEL_TOOLS,
  createCellKey,
  getTileDefinition
} from './cityChannelSchema';

const TOOL_LABELS = {
  [CITY_CHANNEL_TOOLS.SELECT]: '选择',
  [CITY_CHANNEL_TOOLS.ERASE]: '擦除',
  [CITY_CHANNEL_TOOLS.PLACE_TILE]: '放置板材',
  [CITY_CHANNEL_TOOLS.WOOD_FLOOR]: '放置木板',
  [CITY_CHANNEL_TOOLS.STONE_FLOOR]: '放置石板',
  [CITY_CHANNEL_TOOLS.IRON_FLOOR]: '放置铁板',
  [CITY_CHANNEL_TOOLS.WALL]: '放置墙板',
  [CITY_CHANNEL_TOOLS.STAIR]: '放置楼梯',
  [CITY_CHANNEL_TOOLS.ENTRANCE]: '放置入口',
  [CITY_CHANNEL_TOOLS.EXIT]: '放置出口',
  [CITY_CHANNEL_TOOLS.SAFE_MARKER]: '安全标记'
};

const formatCell = (cell) => (
  cell ? `x ${cell.x}, y ${cell.y}, ${CITY_CHANNEL_LAYER_LABELS[cell.z] || `Layer ${cell.z}`}` : '未选择'
);

const CityChannelInspector = ({
  mapData,
  activeLayer,
  activeTool,
  selectedCell,
  validationResult,
  routeKeySet
}) => {
  const selectedTile = useMemo(() => {
    if (!selectedCell) return null;
    return mapData.tiles[createCellKey(selectedCell.x, selectedCell.y, selectedCell.z)] || null;
  }, [mapData.tiles, selectedCell]);
  const selectedTileDefinition = selectedTile ? getTileDefinition(selectedTile.panelType) : null;
  const selectedIsRoute = selectedCell
    ? routeKeySet.has(createCellKey(selectedCell.x, selectedCell.y, selectedCell.z))
    : false;

  return (
    <aside className="city-channel-inspector" aria-label="城内通道设计属性面板">
      <div className="city-channel-panel-title">
        <Inspect size={16} />
        <span>属性面板</span>
      </div>

      <div className="city-channel-inspector-section">
        <h4>地图信息</h4>
        <dl>
          <div>
            <dt>地图尺寸</dt>
            <dd>{`${mapData.width} x ${mapData.height}`}</dd>
          </div>
          <div>
            <dt>当前层</dt>
            <dd>{CITY_CHANNEL_LAYER_LABELS[activeLayer] || `Layer ${activeLayer}`}</dd>
          </div>
          <div>
            <dt>当前工具</dt>
            <dd>{TOOL_LABELS[activeTool] || activeTool}</dd>
          </div>
          <div>
            <dt>入口数量</dt>
            <dd>{mapData.entrances.length}</dd>
          </div>
          <div>
            <dt>出口数量</dt>
            <dd>{mapData.exits.length}</dd>
          </div>
        </dl>
      </div>

      <div className="city-channel-inspector-section">
        <h4>选中格子</h4>
        <dl>
          <div>
            <dt>坐标</dt>
            <dd>{formatCell(selectedCell)}</dd>
          </div>
          <div>
            <dt>板材类型</dt>
            <dd>{selectedTileDefinition?.label || '空格'}</dd>
          </div>
          <div>
            <dt>是否可通行</dt>
            <dd>{selectedTile ? (selectedTile.walkable ? '可通行' : '不可通行') : '无板材'}</dd>
          </div>
          <div>
            <dt>白线候选路径</dt>
            <dd>{selectedIsRoute ? '是' : '否'}</dd>
          </div>
        </dl>
      </div>

      <div className={`city-channel-validation-card ${validationResult.ok ? 'is-ok' : 'is-warn'}`}>
        <div className="city-channel-validation-card__head">
          {validationResult.ok ? <Network size={16} /> : <Activity size={16} />}
          <span>白线通路验证</span>
        </div>
        <p>{validationResult.message}</p>
        <span>{`检查格子 ${validationResult.checkedCells || 0}，路径长度 ${validationResult.route?.length || 0}`}</span>
      </div>
    </aside>
  );
};

export default CityChannelInspector;
