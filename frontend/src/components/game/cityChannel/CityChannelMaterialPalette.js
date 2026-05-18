import React, { useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Gauge,
  Hexagon,
  PanelTop,
  Square,
  Workflow
} from 'lucide-react';
import {
  CITY_CHANNEL_MATERIAL_CATALOG,
  CITY_CHANNEL_MATERIAL_GROUPS,
  getPaletteCityChannelMaterials,
  isMechanicalMaterial
} from './cityChannelCatalog';
import './CityChannelMaterialPalette.css';

const iconByPanelType = {
  basic_plate: Square,
  transmission_straight_plate: Workflow,
  transmission_cross_plate: Workflow,
  transmission_t_plate: Workflow,
  transmission_l_plate: Workflow,
  transmission_endpoint_plate: Workflow,
  gear_pressure_plate: Gauge,
  actuator_center_gear_plate: CircleDot,
  actuator_single_corner_gear_plate: Hexagon,
  actuator_same_side_gear_plate: Box,
  actuator_opposite_corner_gear_plate: Box,
  actuator_triangle_gear_plate: PanelTop,
  actuator_four_corner_gear_plate: Hexagon
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
          const materials = getPaletteCityChannelMaterials(CITY_CHANNEL_MATERIAL_CATALOG).filter((material) => (
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
