import {
  CITY_CHANNEL_MATERIAL_BY_ID,
  normalizeCityChannelPanelType
} from '../cityChannelCatalog';

export const CITY_CHANNEL_STORAGE_KEY = 'city_channel_design_draft_v1';
export const CITY_CHANNEL_USER_TEMPLATE_STORAGE_KEY = 'city_channel_user_templates_v1';
export const CITY_CHANNEL_VERSION = 1;
export const CITY_CHANNEL_TEMPLATE_META_VERSION = 1;
export const CITY_CHANNEL_BOARD_SYSTEM_VERSION = 2;
export const CITY_CHANNEL_MECHANISM_SCHEMA_VERSION = 2;
export const CITY_CHANNEL_WIDTH = 32;
export const CITY_CHANNEL_HEIGHT = 32;
export const CITY_CHANNEL_LAYERS = 4;

export const CITY_CHANNEL_LAYER_LABELS = [
  '地面层',
  '二层',
  '三层',
  '四层'
];

export const CITY_CHANNEL_TOOLS = {
  BROWSE: 'browse',
  SELECT: 'select',
  ERASE: 'erase',
  PLACE_TILE: 'placeTile',
  PLACE_COMPONENT: 'placeComponent'
};

export const CITY_CHANNEL_TILE_TYPES = {
  BASIC_PLATE: 'basic_plate',
  TRANSMISSION_STRAIGHT_PLATE: 'transmission_straight_plate',
  TRANSMISSION_CROSS_PLATE: 'transmission_cross_plate',
  TRANSMISSION_T_PLATE: 'transmission_t_plate',
  TRANSMISSION_L_PLATE: 'transmission_l_plate',
  TRANSMISSION_ENDPOINT_PLATE: 'transmission_endpoint_plate',
  GEAR_PRESSURE_PLATE: 'gear_pressure_plate',
  ACTUATOR_CENTER_GEAR_PLATE: 'actuator_center_gear_plate',
  ACTUATOR_SINGLE_CORNER_GEAR_PLATE: 'actuator_single_corner_gear_plate',
  ACTUATOR_SAME_SIDE_GEAR_PLATE: 'actuator_same_side_gear_plate',
  ACTUATOR_OPPOSITE_CORNER_GEAR_PLATE: 'actuator_opposite_corner_gear_plate',
  ACTUATOR_TRIANGLE_GEAR_PLATE: 'actuator_triangle_gear_plate',
  ACTUATOR_FOUR_CORNER_GEAR_PLATE: 'actuator_four_corner_gear_plate',
  ENTRANCE: 'entrance',
  EXIT: 'exit'
};

export const CITY_CHANNEL_WALL_EDGES = {
  NORTH: 'north',
  EAST: 'east',
  SOUTH: 'south',
  WEST: 'west'
};

export const CITY_CHANNEL_TILE_DEFINITIONS = {
  ...Object.entries(CITY_CHANNEL_MATERIAL_BY_ID).reduce((definitions, [id, material]) => ({
    ...definitions,
    [id]: {
      label: material.name,
      walkable: !!material.walkable,
      solid: !!material.solid,
      transparent: !!material.transparent,
      isVertical: !!material.isVertical,
      category: material.category,
      markerType: material.markerType || null,
      hiddenModule: material.hiddenModule || null,
      connectors: material.hiddenModule?.connectorPoints || []
    }
  }), {})
};

export const getTileDefinition = (panelType) => (
  CITY_CHANNEL_TILE_DEFINITIONS[normalizeCityChannelPanelType(panelType)]
  || CITY_CHANNEL_TILE_DEFINITIONS[CITY_CHANNEL_TILE_TYPES.BASIC_PLATE]
);
