import {
  CITY_CHANNEL_STORAGE_KEY,
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_USER_TEMPLATE_STORAGE_KEY,
  createBaseCityChannelMap,
  createCellKey,
  createWall,
  createWallKey,
  createDefaultCityChannelMap,
  createTile,
  normalizeTemplateMeta,
  normalizeCityChannelMap,
  serializeCityChannelMap
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
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
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
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        rotation
      })
    }
  };
};

const withEntranceExit = (mapData, entrance, exit) => ({
  ...mapData,
  tiles: {
    ...mapData.tiles,
    [createCellKey(entrance.x, entrance.y, entrance.z || 0)]: createTile({
      x: entrance.x,
      y: entrance.y,
      z: entrance.z || 0,
      panelType: CITY_CHANNEL_TILE_TYPES.ENTRANCE,
      rotation: entrance.rotation || 0
    }),
    [createCellKey(exit.x, exit.y, exit.z || 0)]: createTile({
      x: exit.x,
      y: exit.y,
      z: exit.z || 0,
      panelType: CITY_CHANNEL_TILE_TYPES.EXIT,
      rotation: exit.rotation || 0
    })
  },
  entrances: [{ id: `${mapData.id || 'template'}_entrance`, x: entrance.x, y: entrance.y, z: entrance.z || 0 }],
  exits: [{ id: `${mapData.id || 'template'}_exit`, x: exit.x, y: exit.y, z: exit.z || 0 }]
});

const finalizeTemplateMap = (mapData, templateMeta = {}) => {
  const validation = validateCityChannelSafeRoute(mapData);
  return normalizeCityChannelMap({
    ...mapData,
    templateMeta: normalizeTemplateMeta(templateMeta, mapData.templateMeta),
    safeRoute: validation.ok ? validation.route : []
  });
};

const createBlankLegalTemplate = () => finalizeTemplateMap(createDefaultCityChannelMap(), {
  source: 'create',
  templateId: 'blank-legal',
  visibility: 'official'
});

const createAlleyTemplate = () => {
  let map = createBaseCityChannelMap({
    name: '小巷通道模板',
    templateMeta: { source: 'official', templateId: 'alley-l', visibility: 'official' }
  });
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
  return finalizeTemplateMap(withEntranceExit(map, { x: 14, y: 15, z: 0, rotation: 90 }, { x: 18, y: 17, z: 0, rotation: 90 }), map.templateMeta);
};

const createHallTemplate = () => {
  let map = createBaseCityChannelMap({
    name: '多门厅模板',
    templateMeta: { source: 'official', templateId: 'split-hall', visibility: 'official' }
  });
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
  return finalizeTemplateMap(withEntranceExit(map, { x: 15, y: 16, z: 0, rotation: 90 }, { x: 19, y: 16, z: 0, rotation: 90 }), map.templateMeta);
};

const createMechanismPreviewTemplate = () => {
  let map = createBaseCityChannelMap({
    name: '机关坊雏形',
    templateMeta: { source: 'shared', templateId: 'shared-mechanism-seed', visibility: 'shared' }
  });
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
    ...withEntranceExit(map, { x: 15, y: 16, z: 0, rotation: 90 }, { x: 19, y: 17, z: 0, rotation: 90 }),
    mechanisms: [
      {
        id: 'mock_mechanism_preview',
        type: 'reserved',
        label: '机关预留位'
      }
    ]
  }, map.templateMeta);
};

export const createOcclusionRegressionTemplate = () => {
  let map = createBaseCityChannelMap({
    name: '遮挡回归测试模板',
    templateMeta: { source: 'debug', templateId: 'occlusion-regression', visibility: 'private' }
  });
  [
    [15, 15],
    [15, 16],
    [16, 16],
    [16, 17],
    [17, 16],
    [18, 16],
    [18, 17]
  ].forEach(([x, y]) => {
    map = addFloor(map, x, y);
  });

  const wallBehindKey = createWallKey(15, 16, 0, 'north');
  const wallFrontKey = createWallKey(16, 16, 0, 'south');
  const wallMechanismKey = createWallKey(17, 16, 0, 'south');
  map = {
    ...map,
    tiles: {
      ...map.tiles,
      [createCellKey(17, 16, 0)]: createTile({
        x: 17,
        y: 16,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
      })
    },
    walls: {
      ...map.walls,
      [wallBehindKey]: createWall({ x: 15, y: 16, z: 0, edge: 'north' }),
      [wallFrontKey]: createWall({ x: 16, y: 16, z: 0, edge: 'south' }),
      [wallMechanismKey]: createWall({ x: 17, y: 16, z: 0, edge: 'south' })
    }
  };

  return finalizeTemplateMap(
    withEntranceExit(map, { x: 15, y: 15, z: 0, rotation: 90 }, { x: 18, y: 17, z: 0, rotation: 90 }),
    map.templateMeta
  );
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

export const readCityChannelUserTemplates = () => {
  try {
    const raw = localStorage.getItem(CITY_CHANNEL_USER_TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((record, index) => {
        const mapData = normalizeCityChannelMap(record?.mapData || record);
        const validation = validateCityChannelSafeRoute(mapData);
        return {
          id: typeof record?.id === 'string' && record.id ? record.id : `local-template-${index}`,
          name: mapData.name || record?.name || '我的模板',
          description: record?.description || '保存到当前浏览器的个人模板。',
          actionLabel: '编辑模板',
          source: 'user',
          mapData,
          validation,
          savedAt: record?.savedAt || null
        };
      });
  } catch (error) {
    return [{
      id: 'local-template-read-error',
      name: '我的模板读取失败',
      description: error.message,
      actionLabel: '无法编辑',
      source: 'user',
      disabled: true,
      mapData: null,
      validation: {
        ok: false,
        message: '我的模板读取失败',
        route: [],
        checkedCells: 0
      }
    }];
  }
};

export const saveCityChannelUserTemplate = ({
  id = null,
  name,
  description = '保存到当前浏览器的个人模板。',
  mapData,
  sourceTemplate = null
} = {}) => {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    throw new Error('模板名称不能为空');
  }
  const now = new Date().toISOString();
  const existingMeta = normalizeTemplateMeta(mapData?.templateMeta);
  const sourceId = sourceTemplate?.id || existingMeta.templateId || null;
  const normalizedMap = serializeCityChannelMap({
    ...mapData,
    name: trimmedName,
    templateMeta: normalizeTemplateMeta({
      ...existingMeta,
      source: 'user',
      templateId: id || existingMeta.templateId,
      parentTemplateId: id ? existingMeta.parentTemplateId : sourceId,
      rootTemplateId: existingMeta.rootTemplateId || sourceId,
      originalTemplateId: existingMeta.originalTemplateId || sourceId,
      visibility: 'private',
      forkedAt: existingMeta.forkedAt || now,
      savedAt: now,
      lineage: existingMeta.lineage
    })
  });
  const raw = localStorage.getItem(CITY_CHANNEL_USER_TEMPLATE_STORAGE_KEY);
  const records = raw ? JSON.parse(raw) : [];
  const list = Array.isArray(records) ? records : [];
  const nextId = id || `user_template_${Date.now().toString(36)}`;
  const mapWithRecordId = serializeCityChannelMap({
    ...normalizedMap,
    templateMeta: normalizeTemplateMeta({
      ...normalizedMap.templateMeta,
      templateId: nextId,
      savedAt: now
    }, normalizedMap.templateMeta)
  });
  const nextRecord = {
    id: nextId,
    name: trimmedName,
    description,
    savedAt: now,
    sourceTemplateId: mapWithRecordId.templateMeta.parentTemplateId,
    rootTemplateId: mapWithRecordId.templateMeta.rootTemplateId,
    mapData: mapWithRecordId
  };
  const existingIndex = list.findIndex((item) => item?.id === nextId);
  const nextList = existingIndex >= 0
    ? list.map((item, index) => (index === existingIndex ? nextRecord : item))
    : [nextRecord, ...list];
  localStorage.setItem(CITY_CHANNEL_USER_TEMPLATE_STORAGE_KEY, JSON.stringify(nextList));
  return nextRecord;
};

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
