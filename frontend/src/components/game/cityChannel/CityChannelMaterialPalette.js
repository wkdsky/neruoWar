import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Gauge,
  Cog,
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
};

export const CITY_CHANNEL_COMPONENT_CATALOG = [
  {
    id: 'gear',
    name: '齿轮',
    description: '安装到板材正面或背面的五个轴点上。'
  }
];

const CityChannelMaterialPalette = ({
  activeTileType,
  activeComponentType,
  onMaterialSelect,
  onComponentSelect
}) => {
  const [activeTab, setActiveTab] = useState('materials');
  const [collapsedGroups, setCollapsedGroups] = useState({});

  return (
    <aside className="city-channel-material-palette" aria-label="工坊库">
      <header className="city-channel-material-palette__header">
        <div>
          <strong>{activeTab === 'components' ? '组件库' : '板材库'}</strong>
          <span>{activeTab === 'components' ? '选择后安装到板材' : '选择后进入放置状态'}</span>
        </div>
      </header>
      <div className="city-channel-material-palette__tabs" role="tablist" aria-label="工坊库类别">
        <button
          type="button"
          className={activeTab === 'materials' ? 'is-active' : ''}
          onClick={() => setActiveTab('materials')}
        >
          板材库
        </button>
        <button
          type="button"
          className={activeTab === 'components' ? 'is-active' : ''}
          onClick={() => setActiveTab('components')}
        >
          组件库
        </button>
      </div>

      <div className="city-channel-material-palette__body">
        {activeTab === 'materials' ? CITY_CHANNEL_MATERIAL_GROUPS.map((group) => {
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
        }) : (
          <section className="city-channel-material-group">
            <div className="city-channel-material-group__items">
              {CITY_CHANNEL_COMPONENT_CATALOG.map((component) => (
                <button
                  key={component.id}
                  type="button"
                  className={[
                    'city-channel-material-item',
                    'is-component',
                    activeComponentType === component.id ? 'is-active' : ''
                  ].filter(Boolean).join(' ')}
                  onClick={() => onComponentSelect?.(component.id)}
                  title={component.description}
                >
                  <span className={`city-channel-material-item__preview is-component-${component.id}`}>
                    <Cog size={16} />
                  </span>
                  <span className="city-channel-material-item__text">
                    <strong>{component.name}</strong>
                    <em>{component.description}</em>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
};

export default CityChannelMaterialPalette;
