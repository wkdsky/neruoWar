import React from 'react';
import {
  DoorOpen,
  Eraser,
  Flag,
  Footprints,
  Layers,
  MousePointer2,
  Shield,
  Square,
  Waves
} from 'lucide-react';
import { CITY_CHANNEL_TOOLS } from './cityChannelSchema';

const TOOL_ITEMS = [
  { key: CITY_CHANNEL_TOOLS.SELECT, label: '选择', Icon: MousePointer2 },
  { key: CITY_CHANNEL_TOOLS.ERASE, label: '擦除', Icon: Eraser },
  { key: CITY_CHANNEL_TOOLS.WOOD_FLOOR, label: '木板', Icon: Square },
  { key: CITY_CHANNEL_TOOLS.STONE_FLOOR, label: '石板', Icon: Square },
  { key: CITY_CHANNEL_TOOLS.IRON_FLOOR, label: '铁板', Icon: Shield },
  { key: CITY_CHANNEL_TOOLS.WALL, label: '墙板', Icon: Square },
  { key: CITY_CHANNEL_TOOLS.STAIR, label: '楼梯', Icon: Layers },
  { key: CITY_CHANNEL_TOOLS.ENTRANCE, label: '入口', Icon: DoorOpen },
  { key: CITY_CHANNEL_TOOLS.EXIT, label: '出口', Icon: Flag },
  { key: CITY_CHANNEL_TOOLS.SAFE_MARKER, label: '安全标记', Icon: Footprints }
];

const CityChannelPalette = ({
  activeTool,
  onToolChange
}) => (
  <aside className="city-channel-palette" aria-label="城内通道设计工具栏">
    <div className="city-channel-panel-title">
      <Waves size={16} />
      <span>设计工具</span>
    </div>
    <div className="city-channel-tool-list">
      {TOOL_ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`city-channel-tool ${activeTool === key ? 'is-active' : ''}`}
          onClick={() => onToolChange(key)}
          title={label}
        >
          <Icon size={16} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  </aside>
);

export default CityChannelPalette;
