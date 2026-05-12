import React, { useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  CircleDot,
  DoorOpen,
  Flag,
  Gauge,
  Hexagon,
  Layers,
  PanelTop,
  Square,
  Waves
} from 'lucide-react';
import {
  CITY_CHANNEL_MATERIAL_CATALOG,
  CITY_CHANNEL_MATERIAL_GROUPS,
  isMechanicalMaterial
} from './cityChannelCatalog';
import './CityChannelMaterialPalette.css';

const iconByPanelType = {
  wood_floor: Square,
  stone_floor: Square,
  iron_floor: PanelTop,
  glass_floor: Layers,
  wall: Box,
  glass_wall: Box,
  entrance: DoorOpen,
  exit: Flag,
  pressure_plate: Gauge,
  directional_pressure_plate: Gauge,
  vertical_push_button: CircleDot,
  horizontal_push_button: CircleDot,
  rotary_button: CircleDot,
  external_gear_plate: Hexagon,
  internal_gear_plate: Hexagon,
  peg_gear_plate: Hexagon,
  trapdoor_plate: PanelTop,
  side_pusher_plate: Box,
  spring_plate: Waves
};

const CityChannelMaterialPalette = ({
  activeTileType,
  onMaterialSelect
}) => {
  const [collapsedGroups, setCollapsedGroups] = useState({});

  return (
    <aside className="city-channel-material-palette" aria-label="板材库">
      <header className="city-channel-material-palette__header">
        <div>
          <strong>板材库</strong>
          <span>选择后进入放置状态</span>
        </div>
      </header>

      <div className="city-channel-material-palette__body">
        {CITY_CHANNEL_MATERIAL_GROUPS.map((group) => {
          const materials = CITY_CHANNEL_MATERIAL_CATALOG.filter((material) => (
            group.categories.includes(material.category)
          ));
          const isCollapsed = !!collapsedGroups[group.id];
          return (
            <section key={group.id} className="city-channel-material-group">
              <button
                type="button"
                className="city-channel-material-group__toggle"
                onClick={() => setCollapsedGroups((current) => ({
                  ...current,
                  [group.id]: !current[group.id]
                }))}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span>{group.label}</span>
                <em>{materials.length}</em>
              </button>
              {!isCollapsed ? (
                <div className="city-channel-material-group__items">
                  {materials.map((material) => {
                    const Icon = iconByPanelType[material.id] || Square;
                    const isMechanical = isMechanicalMaterial(material);
                    return (
                      <button
                        key={material.id}
                        type="button"
                        className={[
                          'city-channel-material-item',
                          activeTileType === material.id ? 'is-active' : '',
                          isMechanical ? 'is-mechanical' : '',
                          material.transparent ? 'is-transparent' : ''
                        ].filter(Boolean).join(' ')}
                        onClick={() => onMaterialSelect(material.id)}
                        title={material.description}
                      >
                        <span className={`city-channel-material-item__preview is-${material.id}`}>
                          <Icon size={15} />
                        </span>
                        <span className="city-channel-material-item__text">
                          <strong>{material.name}</strong>
                          <em>{material.description}</em>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
};

export default CityChannelMaterialPalette;
