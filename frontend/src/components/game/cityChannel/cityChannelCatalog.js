export const CITY_CHANNEL_MATERIAL_GROUPS = [
  {
    id: 'structure',
    label: '基础结构',
    categories: ['structure']
  },
  {
    id: 'portal',
    label: '出入口',
    categories: ['portal']
  },
  {
    id: 'mechanical_sensor',
    label: '机械触发',
    categories: ['mechanical_sensor', 'mechanical_source']
  },
  {
    id: 'mechanical_gear',
    label: '齿轮结构',
    categories: ['mechanical_gear']
  },
  {
    id: 'mechanical_actuator',
    label: '机械执行',
    categories: ['mechanical_actuator']
  }
];

export const CITY_CHANNEL_MATERIAL_CATALOG = [
  {
    id: 'wood_floor',
    name: '木质地板',
    shortName: '木地板',
    category: 'structure',
    walkable: true,
    solid: false,
    placeable: true,
    description: '轻质基础地面板，适合作为通道主体。'
  },
  {
    id: 'stone_floor',
    name: '石质地板',
    shortName: '石地板',
    category: 'structure',
    walkable: true,
    solid: false,
    placeable: true,
    description: '稳定地面板，视觉上更厚重。'
  },
  {
    id: 'iron_floor',
    name: '铁质地板',
    shortName: '铁地板',
    category: 'structure',
    walkable: true,
    solid: false,
    placeable: true,
    description: '金属地面板，后续适合承载重型机关。'
  },
  {
    id: 'glass_floor',
    name: '玻璃地板',
    shortName: '玻璃地板',
    category: 'structure',
    walkable: true,
    solid: false,
    placeable: true,
    transparent: true,
    description: '可透视地面板，适合展示下层或机关层。'
  },
  {
    id: 'wall',
    name: '墙板',
    shortName: '墙板',
    category: 'structure',
    walkable: false,
    solid: true,
    placeable: true,
    rotatable: true,
    isVertical: true,
    description: '阻挡通行的墙体板材。'
  },
  {
    id: 'glass_wall',
    name: '玻璃墙板',
    shortName: '玻璃墙',
    category: 'structure',
    walkable: false,
    solid: true,
    transparent: true,
    placeable: true,
    rotatable: true,
    isVertical: true,
    description: '半透明墙体，适合观察内部结构。'
  },
  {
    id: 'entrance',
    name: '入口门框',
    shortName: '入口',
    category: 'portal',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    markerType: 'entrance',
    isVertical: true,
    description: '挑战者进入通道的起点。'
  },
  {
    id: 'exit',
    name: '出口门框',
    shortName: '出口',
    category: 'portal',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    markerType: 'exit',
    isVertical: true,
    description: '挑战者抵达通道的终点。'
  },
  {
    id: 'pressure_plate',
    name: '压力触发板',
    shortName: '压力板',
    category: 'mechanical_sensor',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: false,
    hiddenModule: {
      type: 'pressure_sensor',
      trigger: 'pressure',
      output: 'none'
    },
    mechanismModel: {
      type: 'sensor_plate',
      parts: [
        { shape: 'box', params: { x1: -0.3, y1: -0.3, x2: 0.3, y2: 0.3, bottomLift: -8, topLift: -4 }, color: '#8b5cf6', opacity: 0.85 },
        { shape: 'box', params: { x1: -0.1, y1: -0.1, x2: 0.1, y2: 0.1, bottomLift: -14, topLift: -8 }, color: '#a78bfa', opacity: 0.9 }
      ]
    },
    connectors: [
      { id: 'signal_out', label: '信号输出', position: { dx: 0, dy: 0.5 }, direction: 'out' }
    ],
    description: '玩家踩踏后可产生触发信号。当前版本仅记录结构，不执行传动。'
  },
  {
    id: 'directional_pressure_plate',
    name: '方向压力板',
    shortName: '方向压力',
    category: 'mechanical_sensor',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    hiddenModule: {
      type: 'directional_pressure_sensor',
      trigger: 'directional_pressure',
      output: 'none'
    },
    mechanismModel: {
      type: 'sensor_plate',
      parts: [
        { shape: 'box', params: { x1: -0.3, y1: -0.15, x2: 0.3, y2: 0.15, bottomLift: -8, topLift: -4 }, color: '#7c3aed', opacity: 0.85 },
        { shape: 'box', params: { x1: 0.15, y1: -0.06, x2: 0.35, y2: 0.06, bottomLift: -10, topLift: -6 }, color: '#a78bfa', opacity: 0.9 }
      ]
    },
    connectors: [
      { id: 'signal_out', label: '方向信号输出', position: { dx: 0.5, dy: 0 }, direction: 'out' }
    ],
    description: '只对特定方向经过的挑战者触发。当前版本仅记录结构。'
  },
  {
    id: 'vertical_push_button',
    name: '纵向弹出按钮板',
    shortName: '纵向按钮',
    category: 'mechanical_source',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    hiddenModule: {
      type: 'vertical_push_button',
      outputMotion: 'linear_normal',
      stroke: 1
    },
    mechanismModel: {
      type: 'piston',
      parts: [
        { shape: 'cylinder', params: { cx: 0, cy: 0, radius: 0.12, bottomLift: -16, topLift: -6 }, color: '#6366f1', opacity: 0.85 },
        { shape: 'box', params: { x1: -0.06, y1: -0.06, x2: 0.06, y2: 0.06, bottomLift: -6, topLift: 0 }, color: '#818cf8', opacity: 0.9 }
      ]
    },
    connectors: [
      { id: 'push_out', label: '推出端', position: { dx: 0, dy: -0.5 }, direction: 'out' }
    ],
    description: '按下后背面沿法线方向伸出柱体。当前版本仅表现外观。'
  },
  {
    id: 'horizontal_push_button',
    name: '横向弹出按钮板',
    shortName: '横向按钮',
    category: 'mechanical_source',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    hiddenModule: {
      type: 'horizontal_push_button',
      outputMotion: 'linear_side',
      stroke: 1
    },
    mechanismModel: {
      type: 'piston',
      parts: [
        { shape: 'cylinder', params: { cx: 0, cy: 0, radius: 0.12, bottomLift: -14, topLift: -6 }, color: '#6366f1', opacity: 0.85 },
        { shape: 'box', params: { x1: -0.06, y1: -0.2, x2: 0.06, y2: 0.2, bottomLift: -10, topLift: -6 }, color: '#818cf8', opacity: 0.9 }
      ]
    },
    connectors: [
      { id: 'push_out', label: '侧推端', position: { dx: 0.5, dy: 0 }, direction: 'out' }
    ],
    description: '按下后背面沿水平方向伸出柱体。当前版本仅表现外观。'
  },
  {
    id: 'rotary_button',
    name: '旋转按钮板',
    shortName: '旋转按钮',
    category: 'mechanical_source',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    hiddenModule: {
      type: 'rotary_button',
      outputMotion: 'angular',
      angle: 90
    },
    mechanismModel: {
      type: 'crank',
      parts: [
        { shape: 'cylinder', params: { cx: 0, cy: 0, radius: 0.08, bottomLift: -12, topLift: -4 }, color: '#4f46e5', opacity: 0.85 },
        { shape: 'box', params: { x1: 0, y1: -0.04, x2: 0.28, y2: 0.04, bottomLift: -9, topLift: -5 }, color: '#818cf8', opacity: 0.9 }
      ]
    },
    connectors: [
      { id: 'axis_out', label: '旋转轴输出', position: { dx: 0, dy: 0 }, direction: 'out' }
    ],
    description: '按下后背面轴体旋转一定角度。当前版本仅表现外观。'
  },
  {
    id: 'external_gear_plate',
    name: '外齿轮板',
    shortName: '外齿轮',
    category: 'mechanical_gear',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    hiddenModule: {
      type: 'external_gear',
      connectorPoints: ['center_axis', 'rim_teeth']
    },
    mechanismModel: {
      type: 'gear_set',
      parts: [
        { shape: 'gear', params: { cx: 0, cy: 0, outerR: 0.3, innerR: 0.22, teeth: 8, bottomLift: -12, topLift: -6 }, color: '#d97706', opacity: 0.85 },
        { shape: 'cylinder', params: { cx: 0, cy: 0, radius: 0.06, bottomLift: -14, topLift: -4 }, color: '#92400e', opacity: 0.9 }
      ]
    },
    connectors: [
      { id: 'center_axis', label: '中心轴', position: { dx: 0, dy: 0 }, direction: 'in' },
      { id: 'rim_teeth', label: '外齿啮合', position: { dx: 0.4, dy: 0 }, direction: 'out' }
    ],
    description: '普通外向齿齿轮板，后续可与传动介质连接。'
  },
  {
    id: 'internal_gear_plate',
    name: '内齿轮板',
    shortName: '内齿轮',
    category: 'mechanical_gear',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    hiddenModule: {
      type: 'internal_gear',
      connectorPoints: ['center_axis', 'inner_teeth']
    },
    mechanismModel: {
      type: 'gear_set',
      parts: [
        { shape: 'gear', params: { cx: 0, cy: 0, outerR: 0.34, innerR: 0.26, teeth: 10, bottomLift: -12, topLift: -6 }, color: '#b45309', opacity: 0.85 },
        { shape: 'cylinder', params: { cx: 0, cy: 0, radius: 0.14, bottomLift: -13, topLift: -5 }, color: '#78350f', opacity: 0.8 }
      ]
    },
    connectors: [
      { id: 'center_axis', label: '中心轴', position: { dx: 0, dy: 0 }, direction: 'in' },
      { id: 'inner_teeth', label: '内齿啮合', position: { dx: -0.3, dy: 0 }, direction: 'out' }
    ],
    description: '内向齿齿轮板，后续适合驱动环形结构。'
  },
  {
    id: 'peg_gear_plate',
    name: '凸起齿轮板',
    shortName: '凸齿轮',
    category: 'mechanical_gear',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    hiddenModule: {
      type: 'peg_gear',
      connectorPoints: ['center_axis', 'peg', 'rim_teeth']
    },
    mechanismModel: {
      type: 'gear_set',
      parts: [
        { shape: 'gear', params: { cx: 0, cy: 0, outerR: 0.28, innerR: 0.2, teeth: 6, bottomLift: -12, topLift: -6 }, color: '#d97706', opacity: 0.85 },
        { shape: 'cylinder', params: { cx: 0, cy: 0, radius: 0.05, bottomLift: -14, topLift: -4 }, color: '#92400e', opacity: 0.9 },
        { shape: 'cylinder', params: { cx: 0.2, cy: 0, radius: 0.04, bottomLift: -8, topLift: -2 }, color: '#fbbf24', opacity: 0.9 }
      ]
    },
    connectors: [
      { id: 'center_axis', label: '中心轴', position: { dx: 0, dy: 0 }, direction: 'in' },
      { id: 'peg', label: '凸起连接', position: { dx: 0.25, dy: 0 }, direction: 'out' },
      { id: 'rim_teeth', label: '外齿啮合', position: { dx: 0.4, dy: 0 }, direction: 'out' }
    ],
    description: '表面带凸起连接点的齿轮板，后续可转化为往复推拉运动。'
  },
  {
    id: 'trapdoor_plate',
    name: '翻板',
    shortName: '翻板',
    category: 'mechanical_actuator',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    hiddenModule: {
      type: 'trapdoor',
      state: 'closed'
    },
    mechanismModel: {
      type: 'trap_door',
      parts: [
        { shape: 'cylinder', params: { cx: -0.35, cy: 0, radius: 0.04, bottomLift: -6, topLift: -2 }, color: '#71717a', opacity: 0.9 },
        { shape: 'box', params: { x1: -0.32, y1: -0.3, x2: 0.32, y2: 0.3, bottomLift: -4, topLift: -2 }, color: '#a1a1aa', opacity: 0.8 }
      ]
    },
    connectors: [
      { id: 'hinge_in', label: '铰链输入', position: { dx: -0.5, dy: 0 }, direction: 'in' }
    ],
    description: '可翻开的地面板。当前版本仅作为结构占位。'
  },
  {
    id: 'side_pusher_plate',
    name: '侧推柱板',
    shortName: '侧推柱',
    category: 'mechanical_actuator',
    walkable: false,
    solid: true,
    placeable: true,
    rotatable: true,
    isVertical: true,
    hiddenModule: {
      type: 'side_pusher',
      state: 'retracted'
    },
    mechanismModel: {
      type: 'piston',
      parts: [
        { shape: 'box', params: { x1: -0.15, y1: -0.15, x2: 0.15, y2: 0.15, bottomLift: -16, topLift: -8 }, color: '#dc2626', opacity: 0.85 },
        { shape: 'box', params: { x1: -0.06, y1: -0.06, x2: 0.06, y2: 0.3, bottomLift: -13, topLift: -9 }, color: '#ef4444', opacity: 0.9 }
      ]
    },
    connectors: [
      { id: 'drive_in', label: '驱动输入', position: { dx: 0, dy: -0.5 }, direction: 'in' },
      { id: 'push_out', label: '推出端', position: { dx: 0, dy: 0.5 }, direction: 'out' }
    ],
    description: '可从侧面伸出推杆的机关板。当前版本仅作为结构占位。'
  },
  {
    id: 'spring_plate',
    name: '弹簧板',
    shortName: '弹簧板',
    category: 'mechanical_actuator',
    walkable: true,
    solid: false,
    placeable: true,
    rotatable: true,
    hiddenModule: {
      type: 'spring_plate',
      state: 'idle'
    },
    mechanismModel: {
      type: 'spring_arm',
      parts: [
        { shape: 'box', params: { x1: -0.08, y1: -0.08, x2: 0.08, y2: 0.08, bottomLift: -18, topLift: -14 }, color: '#059669', opacity: 0.85 },
        { shape: 'cylinder', params: { cx: 0, cy: 0, radius: 0.14, bottomLift: -14, topLift: -6 }, color: '#10b981', opacity: 0.8 },
        { shape: 'box', params: { x1: -0.2, y1: -0.2, x2: 0.2, y2: 0.2, bottomLift: -6, topLift: -3 }, color: '#34d399', opacity: 0.85 }
      ]
    },
    connectors: [
      { id: 'spring_in', label: '弹簧输入', position: { dx: 0, dy: -0.5 }, direction: 'in' },
      { id: 'launch_out', label: '弹射输出', position: { dx: 0, dy: 0 }, direction: 'out' }
    ],
    description: '可弹起挑战者或物体的弹簧板。当前版本仅作为结构占位。'
  }
];

export const CITY_CHANNEL_MATERIAL_BY_ID = CITY_CHANNEL_MATERIAL_CATALOG.reduce((lookup, material) => ({
  ...lookup,
  [material.id]: material
}), {});

export const CITY_CHANNEL_MECHANICAL_CATEGORIES = new Set([
  'mechanical_sensor',
  'mechanical_source',
  'mechanical_gear',
  'mechanical_actuator'
]);

export const getCityChannelMaterial = (panelType) => (
  CITY_CHANNEL_MATERIAL_BY_ID[panelType] || CITY_CHANNEL_MATERIAL_BY_ID.wood_floor
);

export const isMechanicalMaterial = (materialOrCategory) => {
  const category = typeof materialOrCategory === 'string'
    ? materialOrCategory
    : materialOrCategory?.category;
  return CITY_CHANNEL_MECHANICAL_CATEGORIES.has(category);
};
