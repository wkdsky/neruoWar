import {
  CITY_CHANNEL_STORAGE_KEY,
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createDefaultCityChannelMap,
  createTile,
  normalizeCityChannelMap
} from './cityChannelSchema';
import { validateCityChannelSafeRoute } from './cityChannelValidation';

const addFloor = (mapData, x, y, z = 0, patch = {}) => {
  const key = createCellKey(x, y, z);
  return {
    ...mapData,
    tiles: {
      ...mapData.tiles,
      [key]: createTile({
        x,
        y,
        z,
        panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR,
        ...patch
      })
    }
  };
};

const addWall = (mapData, x, y, z = 0, rotation = 0) => {
  const key = createCellKey(x, y, z);
  return {
    ...mapData,
    tiles: {
      ...mapData.tiles,
      [key]: createTile({
        x,
        y,
        z,
        panelType: CITY_CHANNEL_TILE_TYPES.WALL,
        rotation
      })
    }
  };
};

const withEntranceExit = (mapData, entrance, exit) => ({
  ...mapData,
  entrances: [{ id: `${mapData.id || 'template'}_entrance`, ...entrance }],
  exits: [{ id: `${mapData.id || 'template'}_exit`, ...exit }]
});

const finalizeTemplateMap = (mapData) => {
  const validation = validateCityChannelSafeRoute(mapData);
  return normalizeCityChannelMap({
    ...mapData,
    safeRoute: validation.ok ? validation.route : []
  });
};

const createBlankLegalTemplate = () => finalizeTemplateMap(createDefaultCityChannelMap());

const createAlleyTemplate = () => {
  let map = createBaseCityChannelMap({ name: '小巷通道模板' });
  const points = [
    [14, 15],
    [15, 15],
    [16, 15],
    [17, 15],
    [17, 16],
    [17, 17],
    [18, 17]
  ];
  points.forEach(([x, y]) => {
    map = addFloor(map, x, y);
  });
  map = addWall(map, 16, 14, 0, 90);
  map = addWall(map, 18, 16, 0, 0);
  return finalizeTemplateMap(withEntranceExit(map, { x: 14, y: 15, z: 0 }, { x: 18, y: 17, z: 0 }));
};

const createHallTemplate = () => {
  let map = createBaseCityChannelMap({ name: '多门厅模板' });
  const points = [
    [15, 16],
    [16, 16],
    [17, 16],
    [16, 15],
    [16, 17],
    [18, 16],
    [19, 16],
    [18, 15],
    [18, 17]
  ];
  points.forEach(([x, y]) => {
    map = addFloor(map, x, y);
  });
  map = addWall(map, 15, 15, 0, 0);
  map = addWall(map, 15, 17, 0, 0);
  return finalizeTemplateMap(withEntranceExit(map, { x: 15, y: 16, z: 0 }, { x: 19, y: 16, z: 0 }));
};

const createMechanismPreviewTemplate = () => {
  let map = createBaseCityChannelMap({ name: '机关坊雏形' });
  const points = [
    [15, 16],
    [16, 16],
    [17, 16],
    [18, 16],
    [18, 15],
    [18, 17],
    [19, 17]
  ];
  points.forEach(([x, y]) => {
    map = addFloor(map, x, y);
  });
  map = addWall(map, 17, 15, 0, 90);
  return finalizeTemplateMap({
    ...withEntranceExit(map, { x: 15, y: 16, z: 0 }, { x: 19, y: 17, z: 0 }),
    mechanisms: [
      {
        id: 'mock_mechanism_preview',
        type: 'reserved',
        label: '机关预留位'
      }
    ]
  });
};

export const CITY_CHANNEL_TEMPLATE_GROUPS = [
  {
    key: 'create',
    title: '创建新模板',
    description: '从一个已经通过白通路验证的最小通道开始搭建。',
    templates: [
      {
        id: 'blank-legal',
        name: '空白合法模板',
        description: '入口和出口相邻，适合从零开始扩建。',
        actionLabel: '创建新模板',
        source: 'create',
        createMapData: createBlankLegalTemplate
      }
    ]
  },
  {
    key: 'official',
    title: '官方推荐模板',
    description: '用于快速验证搭建流程的基础通道样例。',
    templates: [
      {
        id: 'alley-l',
        name: '小巷通道模板',
        description: '一条带转角的 L 型通道，适合练习阻断和延展。',
        actionLabel: '使用此模板',
        source: 'official',
        createMapData: createAlleyTemplate
      },
      {
        id: 'split-hall',
        name: '多门厅模板',
        description: '入口后分成左右两路，保留后续机关分支空间。',
        actionLabel: '使用此模板',
        source: 'official',
        createMapData: createHallTemplate
      }
    ]
  },
  {
    key: 'shared',
    title: '玩家分享模板',
    description: '当前为前端展示 mock，后续再接入真实分享接口。',
    templates: [
      {
        id: 'shared-mechanism-seed',
        name: '机关坊雏形',
        description: '展示机关主题模板入口，机械传动逻辑暂未启用。',
        actionLabel: '使用此模板',
        source: 'shared',
        createMapData: createMechanismPreviewTemplate
      }
    ]
  }
];

export const readCityChannelDraft = () => {
  try {
    const raw = localStorage.getItem(CITY_CHANNEL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const mapData = normalizeCityChannelMap(parsed);
    const validation = validateCityChannelSafeRoute(mapData);
    return {
      id: 'local-draft',
      name: mapData.name || '本地草稿',
      description: '保存在当前浏览器中的城内通道草稿。',
      actionLabel: '继续编辑草稿',
      source: 'draft',
      mapData,
      validation
    };
  } catch (error) {
    return {
      id: 'local-draft-error',
      name: '草稿读取失败',
      description: error.message,
      actionLabel: '无法编辑',
      source: 'draft',
      disabled: true,
      mapData: null,
      validation: {
        ok: false,
        message: '草稿读取失败',
        route: [],
        checkedCells: 0
      }
    };
  }
};

export const describeCityChannelMap = (mapData = {}) => {
  const normalized = normalizeCityChannelMap(mapData);
  const validation = validateCityChannelSafeRoute(normalized);
  return {
    sizeLabel: `${normalized.width} x ${normalized.height}`,
    layersLabel: `${normalized.layers} 层`,
    verified: validation.ok,
    validationMessage: validation.message
  };
};
