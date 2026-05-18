const createPort = (id, direction, x, y) => ({
  id,
  direction,
  localPosition: { x, y, z: 0 },
  label: `${direction} 端点`
});

const skeletonPortsByType = {
  straight: [
    createPort('north', 'north', 0, -0.5),
    createPort('south', 'south', 0, 0.5)
  ],
  cross: [
    createPort('north', 'north', 0, -0.5),
    createPort('east', 'east', 0.5, 0),
    createPort('south', 'south', 0, 0.5),
    createPort('west', 'west', -0.5, 0)
  ],
  t: [
    createPort('north', 'north', 0, -0.5),
    createPort('east', 'east', 0.5, 0),
    createPort('west', 'west', -0.5, 0)
  ],
  l: [
    createPort('north', 'north', 0, -0.5),
    createPort('east', 'east', 0.5, 0)
  ],
  endpoint: [
    createPort('south', 'south', 0, 0.5)
  ]
};

const createTransmissionSkeleton = (type) => ({
  type,
  ports: skeletonPortsByType[type] || []
});

const gearMount = ({
  id,
  position,
  axisType = 'fixedAxis',
  followMode = 'none',
  followDelaySeconds = 0
}) => ({
  id,
  position,
  axisType,
  followMode,
  followDelaySeconds
});

const mountPresets = {
  center: [gearMount({ id: 'gear_center', position: 'center', axisType: 'fixedAxis' })],
  singleCorner: [gearMount({ id: 'gear_corner_ne', position: 'corner_ne', axisType: 'fixedAxis' })],
  sameSide: [
    gearMount({ id: 'gear_corner_nw', position: 'corner_nw', axisType: 'fixedAxis' }),
    gearMount({ id: 'gear_corner_sw', position: 'corner_sw', axisType: 'freeAxis', followMode: 'sameDirection', followDelaySeconds: 0.15 })
  ],
  oppositeCorner: [
    gearMount({ id: 'gear_corner_nw', position: 'corner_nw', axisType: 'fixedAxis' }),
    gearMount({ id: 'gear_corner_se', position: 'corner_se', axisType: 'freeAxis', followMode: 'oppositeDirection', followDelaySeconds: 0.15 })
  ],
  triangle: [
    gearMount({ id: 'gear_corner_nw', position: 'corner_nw', axisType: 'fixedAxis' }),
    gearMount({ id: 'gear_corner_ne', position: 'corner_ne', axisType: 'freeAxis', followMode: 'oppositeDirection', followDelaySeconds: 0.12 }),
    gearMount({ id: 'gear_corner_sw', position: 'corner_sw', axisType: 'freeAxis', followMode: 'sameDirection', followDelaySeconds: 0.24 })
  ],
  fourCorner: [
    gearMount({ id: 'gear_corner_nw', position: 'corner_nw', axisType: 'fixedAxis' }),
    gearMount({ id: 'gear_corner_ne', position: 'corner_ne', axisType: 'freeAxis', followMode: 'oppositeDirection', followDelaySeconds: 0.12 }),
    gearMount({ id: 'gear_corner_sw', position: 'corner_sw', axisType: 'freeAxis', followMode: 'sameDirection', followDelaySeconds: 0.24 }),
    gearMount({ id: 'gear_corner_se', position: 'corner_se', axisType: 'freeAxis', followMode: 'oppositeDirection', followDelaySeconds: 0.36 })
  ]
};

export const CITY_CHANNEL_MATERIAL_GROUPS = [
  {
    id: 'basic_board',
    label: '基础板材',
    categories: ['basic_board']
  },
  {
    id: 'transmission_board',
    label: '传动板材',
    categories: ['transmission_board']
  },
  {
    id: 'power_board',
    label: '力源板材',
    categories: ['power_board']
  },
  {
    id: 'actuator_board',
    label: '齿轮承动预设',
    categories: ['actuator_board']
  }
];

export const CITY_CHANNEL_MATERIAL_CATALOG = [
  {
    id: 'basic_plate',
    name: '普通板材',
    shortName: '普通板材',
    category: 'basic_board',
    boardRole: 'basic',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    description: '浅暖灰石材结构板，可作为地板或承载结构；不传递动力。'
  },
  {
    id: 'transmission_straight_plate',
    name: '直线型传动板材',
    shortName: '直线型',
    category: 'transmission_board',
    boardRole: 'transmission',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('straight'),
    description: '背面带黄色直线传动骨骼，连接相对两个端点。'
  },
  {
    id: 'transmission_cross_plate',
    name: '十字型传动板材',
    shortName: '十字型',
    category: 'transmission_board',
    boardRole: 'transmission',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('cross'),
    description: '背面带十字传动骨骼，可向四向传递动力。'
  },
  {
    id: 'transmission_t_plate',
    name: 'T 型传动板材',
    shortName: 'T 型',
    category: 'transmission_board',
    boardRole: 'transmission',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('t'),
    description: '背面带 T 型传动骨骼，可通过旋转改变三向端点。'
  },
  {
    id: 'transmission_l_plate',
    name: 'L 型传动板材',
    shortName: 'L 型',
    category: 'transmission_board',
    boardRole: 'transmission',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('l'),
    description: '背面带 L 型传动骨骼，用于转角传动。'
  },
  {
    id: 'transmission_endpoint_plate',
    name: '端点型传动板材',
    shortName: '端点型',
    category: 'transmission_board',
    boardRole: 'transmission',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('endpoint'),
    description: '背面只有一个黄色传动端点，用作传动骨骼的起点或终点。'
  },
  {
    id: 'gear_pressure_plate',
    name: '齿轮压力板',
    shortName: '齿轮压力板',
    category: 'power_board',
    boardRole: 'power_source',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('cross'),
    triggerConfig: {
      type: 'gear_pressure',
      frontOnly: true
    },
    gearIcon: true,
    description: '正面可被按压，背面十字传动骨骼输出动力；黑色小齿轮只是类型标记。'
  },
  {
    id: 'actuator_center_gear_plate',
    name: '中心齿轮承动板',
    shortName: '中心齿轮',
    category: 'actuator_board',
    boardRole: 'actuator',
    compositionType: 'board_with_gear_mounts',
    baseBoardType: 'transmission_cross_plate',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('cross'),
    gearMounts: mountPresets.center,
    description: '中心固定轴齿轮，受驱动时带动所属机械整体旋转。'
  },
  {
    id: 'actuator_single_corner_gear_plate',
    name: '单角齿轮承动板',
    shortName: '单角齿轮',
    category: 'actuator_board',
    boardRole: 'actuator',
    compositionType: 'board_with_gear_mounts',
    baseBoardType: 'transmission_l_plate',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('l'),
    gearMounts: mountPresets.singleCorner,
    description: '单角固定轴齿轮，适合制作斜开门转轴。'
  },
  {
    id: 'actuator_same_side_gear_plate',
    name: '同侧角齿轮承动板',
    shortName: '同侧角齿轮',
    category: 'actuator_board',
    boardRole: 'actuator',
    compositionType: 'board_with_gear_mounts',
    baseBoardType: 'transmission_straight_plate',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('straight'),
    gearMounts: mountPresets.sameSide,
    description: '同侧双角齿轮，支持同向或延迟跟随。'
  },
  {
    id: 'actuator_opposite_corner_gear_plate',
    name: '对侧角齿轮承动板',
    shortName: '对侧角齿轮',
    category: 'actuator_board',
    boardRole: 'actuator',
    compositionType: 'board_with_gear_mounts',
    baseBoardType: 'transmission_straight_plate',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('straight'),
    gearMounts: mountPresets.oppositeCorner,
    description: '对侧双角齿轮，适合反向联动结构。'
  },
  {
    id: 'actuator_triangle_gear_plate',
    name: '三角齿轮承动板',
    shortName: '三角齿轮',
    category: 'actuator_board',
    boardRole: 'actuator',
    compositionType: 'board_with_gear_mounts',
    baseBoardType: 'transmission_t_plate',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('t'),
    gearMounts: mountPresets.triangle,
    description: '三角齿轮预设，可表达多级跟随。'
  },
  {
    id: 'actuator_four_corner_gear_plate',
    name: '四角齿轮承动板',
    shortName: '四角齿轮',
    category: 'actuator_board',
    boardRole: 'actuator',
    compositionType: 'board_with_gear_mounts',
    baseBoardType: 'transmission_cross_plate',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    transmissionSkeleton: createTransmissionSkeleton('cross'),
    gearMounts: mountPresets.fourCorner,
    description: '四角齿轮预设，适合复杂承动组合。'
  },
  {
    id: 'entrance',
    name: '入口门框',
    shortName: '入口',
    category: 'portal',
    boardRole: 'portal',
    walkable: true,
    solid: false,
    placeable: false,
    rotatable: true,
    markerType: 'entrance',
    isVertical: true,
    hiddenFromPalette: true,
    description: '挑战者进入通道的起点。'
  },
  {
    id: 'exit',
    name: '出口门框',
    shortName: '出口',
    category: 'portal',
    boardRole: 'portal',
    walkable: true,
    solid: false,
    placeable: false,
    rotatable: true,
    markerType: 'exit',
    isVertical: true,
    hiddenFromPalette: true,
    description: '挑战者抵达通道的终点。'
  }
];

export const CITY_CHANNEL_LEGACY_PANEL_TYPE_MAP = {
  wood_floor: 'basic_plate',
  stone_floor: 'basic_plate',
  iron_floor: 'basic_plate',
  glass_floor: 'basic_plate',
  wall: 'basic_plate',
  glass_wall: 'basic_plate',
  pressure_plate: 'gear_pressure_plate',
  directional_pressure_plate: 'gear_pressure_plate',
  vertical_push_button: 'gear_pressure_plate',
  horizontal_push_button: 'gear_pressure_plate',
  rotary_button: 'gear_pressure_plate',
  external_gear_plate: 'actuator_center_gear_plate',
  internal_gear_plate: 'actuator_center_gear_plate',
  peg_gear_plate: 'actuator_single_corner_gear_plate',
  trapdoor_plate: 'actuator_center_gear_plate',
  side_pusher_plate: 'actuator_single_corner_gear_plate',
  spring_plate: 'actuator_center_gear_plate'
};

export const CITY_CHANNEL_MATERIAL_BY_ID = CITY_CHANNEL_MATERIAL_CATALOG.reduce((lookup, material) => ({
  ...lookup,
  [material.id]: material
}), {});

export const CITY_CHANNEL_MECHANICAL_CATEGORIES = new Set([
  'transmission_board',
  'power_board',
  'actuator_board'
]);

export const normalizeCityChannelPanelType = (panelType) => (
  CITY_CHANNEL_MATERIAL_BY_ID[panelType]
    ? panelType
    : (CITY_CHANNEL_LEGACY_PANEL_TYPE_MAP[panelType] || 'basic_plate')
);

export const getCityChannelMaterial = (panelType) => (
  CITY_CHANNEL_MATERIAL_BY_ID[normalizeCityChannelPanelType(panelType)] || CITY_CHANNEL_MATERIAL_BY_ID.basic_plate
);

export const getPaletteCityChannelMaterials = () => CITY_CHANNEL_MATERIAL_CATALOG.filter((material) => (
  material.placeable !== false && !material.hiddenFromPalette
));

export const isMechanicalMaterial = (materialOrCategory) => {
  const category = typeof materialOrCategory === 'string'
    ? materialOrCategory
    : materialOrCategory?.category;
  return CITY_CHANNEL_MECHANICAL_CATEGORIES.has(category);
};
