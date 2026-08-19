const { buildReferenceTrainingMapConfig } = require('./trainingMapDefinitionService');

const TRAINING_MAP_ID = 'training-war-map-v1';
const TRAINING_MAP_VERSION = 8;
const FIELD_WIDTH = 2700;
const FIELD_HEIGHT = 1488;

const cloneValue = (value) => JSON.parse(JSON.stringify(value));

const buildItem = ({
  itemId,
  name,
  width,
  depth,
  height,
  hp,
  defense,
  color,
  secondaryColor,
  meshId,
  interactions = [],
  blocksMovement = true,
  blocksVision = true
}) => ({
  itemId,
  name,
  description: '训练营地图静态元素',
  width,
  depth,
  height,
  hp,
  defense,
  deployable: false,
  mapOnly: true,
  blocksMovement,
  blocksVision,
  style: {
    color,
    spikeColor: secondaryColor || color,
    shape: meshId
  },
  renderProfile: {
    battle: {
      meshId,
      materialKey: `training:${meshId}`,
      topLayerKey: `training:${meshId}:top`,
      sideLayerKey: `training:${meshId}:side`
    },
    preview: {
      palette: {
        primary: color,
        secondary: secondaryColor || color
      }
    }
  },
  interactions
});

const TRAINING_MAP_ITEM_CATALOG = [
  buildItem({
    itemId: 'training_map_high_wall',
    name: '训练高墙',
    width: 240,
    depth: 34,
    height: 72,
    hp: 2600,
    defense: 4.2,
    color: '#697687',
    secondaryColor: '#334155',
    meshId: 'training-high-wall'
  }),
  buildItem({
    itemId: 'training_map_low_wall',
    name: '训练薄挡板',
    width: 180,
    depth: 28,
    height: 34,
    hp: 1450,
    defense: 2.6,
    color: '#8c785b',
    secondaryColor: '#4d3c2d',
    meshId: 'training-low-wall'
  }),
  buildItem({
    itemId: 'training_map_thick_wall',
    name: '训练厚墙',
    width: 180,
    depth: 112,
    height: 52,
    hp: 2200,
    defense: 3.8,
    color: '#17191d',
    secondaryColor: '#030406',
    meshId: 'training-thick-wall'
  }),
  buildItem({
    itemId: 'training_map_bush',
    name: '训练草丛',
    width: 132,
    depth: 92,
    height: 26,
    hp: 999999,
    defense: 999,
    color: '#4e9a58',
    secondaryColor: '#1f5b36',
    meshId: 'training-bush',
    blocksMovement: false,
    blocksVision: false,
    interactions: [{
      kind: 'concealment',
      params: {
        softObstacle: true,
        blocksMovement: false,
        moveSpeedMul: 0.84,
        revealRadius: 28
      }
    }]
  }),
  buildItem({
    itemId: 'training_map_tower',
    name: '训练防御塔',
    width: 58,
    depth: 58,
    height: 96,
    hp: 2200,
    defense: 4.8,
    color: '#d45151',
    secondaryColor: '#6e2834',
    meshId: 'training-tower'
  }),
  buildItem({
    itemId: 'training_map_base',
    name: '训练基地',
    width: 180,
    depth: 260,
    height: 116,
    hp: 9600,
    defense: 7.8,
    color: '#c9474f',
    secondaryColor: '#69232f',
    meshId: 'training-base'
  }),
  buildItem({
    itemId: 'training_map_neutral_camp',
    name: '中立训练营地',
    width: 62,
    depth: 62,
    height: 42,
    hp: 1200,
    defense: 2.2,
    color: '#c28a4a',
    secondaryColor: '#5f3c20',
    meshId: 'training-neutral-camp',
    blocksMovement: false,
    blocksVision: false
  })
];

const buildMapObject = ({
  objectId,
  itemId,
  centerX,
  centerY,
  width,
  depth,
  height,
  category,
  team = 'neutral',
  presetTags = [],
  mirrorOf = '',
  objectiveId = '',
  objectiveType = '',
  maxHp = 0,
  blocksMovement = true,
  blocksVision = true,
  rotation = 0
}) => ({
  objectId,
  itemId,
  x: centerX,
  y: centerY,
  z: 0,
  rotation,
  width,
  depth,
  height,
  category,
  team,
  mapStatic: true,
  presetTags,
  mirrorOf,
  objectiveId,
  objectiveType,
  maxHp: Math.max(1, Number(maxHp) || 1),
  hp: Math.max(1, Number(maxHp) || 1),
  blocksMovement: blocksMovement !== false,
  blocksVision: blocksVision !== false
});

const buildMirroredPair = (baseSpec = {}) => {
  const attackerObjectId = String(baseSpec.attackerObjectId || 'attacker_map_object');
  const defenderObjectId = String(baseSpec.defenderObjectId || attackerObjectId.replace('attacker_', 'defender_'));
  const attackerObjectiveId = String(baseSpec.attackerObjectiveId || '');
  const defenderObjectiveId = String(baseSpec.defenderObjectiveId || '');
  const attacker = buildMapObject({
    ...baseSpec,
    objectId: attackerObjectId,
    centerX: -Math.abs(Number(baseSpec.centerX) || 0),
    team: 'attacker',
    mirrorOf: defenderObjectId,
    objectiveId: attackerObjectiveId
  });
  const defender = buildMapObject({
    ...baseSpec,
    objectId: defenderObjectId,
    centerX: Math.abs(Number(baseSpec.centerX) || 0),
    team: 'defender',
    mirrorOf: attackerObjectId,
    objectiveId: defenderObjectiveId
  });
  return [attacker, defender];
};

const buildTrainingMapConfig = () => {
  const objects = [
    ...buildMirroredPair({
      attackerObjectId: 'training_base_attacker',
      defenderObjectId: 'training_base_defender',
      attackerObjectiveId: 'objective_base_attacker',
      defenderObjectiveId: 'objective_base_defender',
      itemId: 'training_map_base',
      centerX: 1120,
      centerY: 0,
      width: 180,
      depth: 260,
      height: 116,
      category: 'base',
      presetTags: ['base'],
      objectiveType: 'base',
      maxHp: 9600
    }),
    ...[-480, 0, 480].flatMap((laneY, laneIndex) => {
      const laneId = ['top', 'mid', 'bottom'][laneIndex];
      return [
        ...buildMirroredPair({
          attackerObjectId: `training_tower_attacker_inner_${laneId}`,
          defenderObjectId: `training_tower_defender_inner_${laneId}`,
          attackerObjectiveId: `objective_tower_attacker_inner_${laneId}`,
          defenderObjectiveId: `objective_tower_defender_inner_${laneId}`,
          itemId: 'training_map_tower',
          centerX: 840,
          centerY: laneY,
          width: 58,
          depth: 58,
          height: 96,
          category: 'tower',
          presetTags: ['tower'],
          objectiveType: 'tower',
          maxHp: 2200
        }),
        ...buildMirroredPair({
          attackerObjectId: `training_tower_attacker_outer_${laneId}`,
          defenderObjectId: `training_tower_defender_outer_${laneId}`,
          attackerObjectiveId: `objective_tower_attacker_outer_${laneId}`,
          defenderObjectiveId: `objective_tower_defender_outer_${laneId}`,
          itemId: 'training_map_tower',
          centerX: 420,
          centerY: laneY,
          width: 58,
          depth: 58,
          height: 96,
          category: 'tower',
          presetTags: ['tower'],
          objectiveType: 'tower',
          maxHp: 1900
        })
      ];
    }),
    ...[-250, 250].flatMap((wallY, wallIndex) => [
      ...buildMirroredPair({
        attackerObjectId: `training_high_wall_attacker_${wallIndex + 1}`,
        defenderObjectId: `training_high_wall_defender_${wallIndex + 1}`,
        itemId: 'training_map_high_wall',
        centerX: 330,
        centerY: wallY,
        width: 260,
        depth: 34,
        height: 72,
        category: 'wall',
        presetTags: ['wall'],
        maxHp: 2600
      }),
      buildMapObject({
        objectId: `training_low_wall_center_${wallIndex + 1}`,
        itemId: 'training_map_low_wall',
        centerX: 0,
        centerY: wallY,
        width: 136,
        depth: 28,
        height: 34,
        category: 'wall',
        presetTags: ['wall'],
        maxHp: 1450
      })
    ]),
    ...[-1, 1].flatMap((direction) => [
      buildMapObject({
        objectId: `training_bush_west_${direction === -1 ? 'north' : 'south'}`,
        itemId: 'training_map_bush',
        centerX: -630,
        centerY: direction * 250,
        width: 138,
        depth: 92,
        height: 26,
        category: 'bush',
        presetTags: ['bush'],
        mirrorOf: `training_bush_east_${direction === -1 ? 'north' : 'south'}`,
        maxHp: 999999,
        blocksMovement: false,
        blocksVision: false
      }),
      buildMapObject({
        objectId: `training_bush_east_${direction === -1 ? 'north' : 'south'}`,
        itemId: 'training_map_bush',
        centerX: 630,
        centerY: direction * 250,
        width: 138,
        depth: 92,
        height: 26,
        category: 'bush',
        presetTags: ['bush'],
        mirrorOf: `training_bush_west_${direction === -1 ? 'north' : 'south'}`,
        maxHp: 999999,
        blocksMovement: false,
        blocksVision: false
      }),
      buildMapObject({
        objectId: `training_bush_west_lane_${direction === -1 ? 'top' : 'bottom'}`,
        itemId: 'training_map_bush',
        centerX: -510,
        centerY: direction * 470,
        width: 118,
        depth: 72,
        height: 24,
        category: 'bush',
        presetTags: ['bush'],
        mirrorOf: `training_bush_east_lane_${direction === -1 ? 'top' : 'bottom'}`,
        maxHp: 999999,
        blocksMovement: false,
        blocksVision: false
      }),
      buildMapObject({
        objectId: `training_bush_east_lane_${direction === -1 ? 'top' : 'bottom'}`,
        itemId: 'training_map_bush',
        centerX: 510,
        centerY: direction * 470,
        width: 118,
        depth: 72,
        height: 24,
        category: 'bush',
        presetTags: ['bush'],
        mirrorOf: `training_bush_west_lane_${direction === -1 ? 'top' : 'bottom'}`,
        maxHp: 999999,
        blocksMovement: false,
        blocksVision: false
      })
    ]),
    ...[-1, 1].flatMap((direction) => [
      buildMapObject({
        objectId: `training_neutral_camp_west_${direction === -1 ? 'north' : 'south'}`,
        itemId: 'training_map_neutral_camp',
        centerX: -500,
        centerY: direction * 250,
        width: 62,
        depth: 62,
        height: 42,
        category: 'neutralCamp',
        presetTags: ['neutral'],
        mirrorOf: `training_neutral_camp_east_${direction === -1 ? 'north' : 'south'}`,
        objectiveId: `objective_neutral_west_${direction === -1 ? 'north' : 'south'}`,
        objectiveType: 'neutralCamp',
        maxHp: 1200,
        blocksMovement: false,
        blocksVision: false
      }),
      buildMapObject({
        objectId: `training_neutral_camp_east_${direction === -1 ? 'north' : 'south'}`,
        itemId: 'training_map_neutral_camp',
        centerX: 500,
        centerY: direction * 250,
        width: 62,
        depth: 62,
        height: 42,
        category: 'neutralCamp',
        presetTags: ['neutral'],
        mirrorOf: `training_neutral_camp_west_${direction === -1 ? 'north' : 'south'}`,
        objectiveId: `objective_neutral_east_${direction === -1 ? 'north' : 'south'}`,
        objectiveType: 'neutralCamp',
        maxHp: 1200,
        blocksMovement: false,
        blocksVision: false
      })
    ])
  ];

  const objectives = [
    ...['attacker', 'defender'].map((team) => ({
      objectiveId: `objective_base_${team}`,
      sourceObjectId: `training_base_${team}`,
      type: 'base',
      team,
      laneId: 'base',
      maxHp: 9600,
      attackEnabled: false,
      presetTags: ['base']
    })),
    ...['attacker', 'defender'].flatMap((team) => ['top', 'mid', 'bottom'].flatMap((laneId) => [
      {
        objectiveId: `objective_tower_${team}_inner_${laneId}`,
        sourceObjectId: `training_tower_${team}_inner_${laneId}`,
        type: 'tower',
        team,
        laneId,
        maxHp: 2200,
        attackRange: 188,
        attackIntervalSec: 0.8,
        attackDamage: 20,
        priority: 'nearest',
        presetTags: ['tower']
      },
      {
        objectiveId: `objective_tower_${team}_outer_${laneId}`,
        sourceObjectId: `training_tower_${team}_outer_${laneId}`,
        type: 'tower',
        team,
        laneId,
        maxHp: 1900,
        attackRange: 176,
        attackIntervalSec: 0.86,
        attackDamage: 17,
        priority: 'nearest',
        presetTags: ['tower']
      }
    ])),
    ...['west_north', 'west_south', 'east_north', 'east_south'].map((campKey) => {
      const isWest = campKey.startsWith('west');
      const isNorth = campKey.endsWith('north');
      return {
        objectiveId: `objective_neutral_${campKey}`,
        sourceObjectId: `training_neutral_camp_${campKey}`,
        type: 'neutralCamp',
        team: 'neutral',
        laneId: isNorth ? 'top' : 'bottom',
        maxHp: 1200,
        attackRange: 86,
        attackIntervalSec: 1.1,
        attackDamage: 11,
        respawnSec: 24,
        rewardLabel: isWest ? '西侧训练靶点' : '东侧训练靶点',
        presetTags: ['neutral']
      };
    })
  ];

  return {
    mapId: TRAINING_MAP_ID,
    mapVersion: TRAINING_MAP_VERSION,
    layoutMeta: {
      fieldWidth: FIELD_WIDTH,
      fieldHeight: FIELD_HEIGHT,
      coordinateOrigin: 'center',
      coordinateSystem: 'x-right-y-up',
      maxItemsPerType: 999999
    },
    teamPresentation: {
      attacker: { label: '我方高地', color: '#d95155', direction: 'right' },
      defender: { label: '敌方高地', color: '#32b4bd', direction: 'left' }
    },
    terrainRegions: [
      { id: 'terrain-grass', type: 'grass', shape: 'rect', x: 0, y: 0, width: FIELD_WIDTH, height: FIELD_HEIGHT, z: 0 },
      { id: 'terrain-attacker-highland', type: 'highland-attacker', shape: 'rect', x: -1120, y: 0, width: 430, height: FIELD_HEIGHT, z: 0.02 },
      { id: 'terrain-defender-highland', type: 'highland-defender', shape: 'rect', x: 1120, y: 0, width: 430, height: FIELD_HEIGHT, z: 0.02 },
      { id: 'terrain-river', type: 'river', shape: 'rect', x: 0, y: 0, width: 320, height: FIELD_HEIGHT, z: 0.045 },
      ...[-480, 0, 480].map((laneY, laneIndex) => ({
        id: `terrain-road-${['top', 'mid', 'bottom'][laneIndex]}`,
        type: 'road',
        shape: 'rect',
        x: 0,
        y: laneY,
        width: FIELD_WIDTH,
        height: 150,
        z: 0.06,
        laneId: ['top', 'mid', 'bottom'][laneIndex]
      }))
    ],
    lanes: [
      { id: 'top', label: '上路', centerY: -480, width: 150, centerline: [{ x: -1350, y: -480 }, { x: 1350, y: -480 }] },
      { id: 'mid', label: '中路', centerY: 0, width: 150, centerline: [{ x: -1350, y: 0 }, { x: 1350, y: 0 }] },
      { id: 'bottom', label: '下路', centerY: 480, width: 150, centerline: [{ x: -1350, y: 480 }, { x: 1350, y: 480 }] }
    ],
    bases: [
      { id: 'base-attacker', team: 'attacker', objectId: 'training_base_attacker', x: -1120, y: 0 },
      { id: 'base-defender', team: 'defender', objectId: 'training_base_defender', x: 1120, y: 0 }
    ],
    deploySlots: [
      ...['attacker', 'defender'].flatMap((team) => {
        const direction = team === 'attacker' ? -1 : 1;
        return [
          { id: `deploy-${team}-top`, team, laneId: 'top', label: '上路前沿', x: direction * 975, y: -480 },
          { id: `deploy-${team}-mid`, team, laneId: 'mid', label: '中路前沿', x: direction * 975, y: 0 },
          { id: `deploy-${team}-bottom`, team, laneId: 'bottom', label: '下路前沿', x: direction * 975, y: 480 },
          { id: `deploy-${team}-jungle-north`, team, laneId: 'jungle', label: '北侧机动', x: direction * 1080, y: -255 },
          { id: `deploy-${team}-jungle-south`, team, laneId: 'jungle', label: '南侧机动', x: direction * 1080, y: 255 },
          { id: `deploy-${team}-support`, team, laneId: 'support', label: '支援预备', x: direction * 910, y: 0 }
        ];
      })
    ],
    navigation: {
      cellSize: 64,
      roadCost: 1,
      grassCost: 1,
      riverCost: 1,
      wallClearance: 18,
      maxSearchNodes: 1800
    },
    itemCatalog: TRAINING_MAP_ITEM_CATALOG,
    objects,
    objectives,
    presets: [
      { id: 'empty', label: '空地图兵种测试', enabledTags: ['base'] },
      { id: 'three-lane', label: '三路推演', enabledTags: ['base', 'tower', 'wall', 'bush'] },
      { id: 'full-jungle', label: '完整野区对抗', enabledTags: ['base', 'tower', 'wall', 'bush', 'neutral'] }
    ],
    defaultPresetId: 'full-jungle'
  };
};

const TRAINING_MAP_CONFIG = buildReferenceTrainingMapConfig({
  itemCatalog: TRAINING_MAP_ITEM_CATALOG
});

const isFiniteCoordinate = (value) => Number.isFinite(Number(value));

const resolveEnabledTags = (mapConfig = {}, presetId = '') => {
  const presets = Array.isArray(mapConfig?.presets) ? mapConfig.presets : [];
  const fallbackId = String(mapConfig?.defaultPresetId || 'full-jungle');
  const requested = String(presetId || fallbackId);
  const preset = presets.find((entry) => entry?.id === requested)
    || presets.find((entry) => entry?.id === fallbackId)
    || presets[0]
    || { id: fallbackId, enabledTags: [] };
  return {
    presetId: String(preset?.id || fallbackId),
    enabledTags: new Set(Array.isArray(preset?.enabledTags) ? preset.enabledTags : [])
  };
};

const shouldIncludeByPreset = (entry = {}, enabledTags = new Set()) => {
  const tags = Array.isArray(entry?.presetTags) ? entry.presetTags : [];
  return tags.length === 0 || tags.some((tag) => enabledTags.has(tag));
};

const isOverlapping = (left = {}, right = {}) => {
  if (left?.blocksMovement === false || right?.blocksMovement === false) return false;
  const leftHalfWidth = Math.max(1, Number(left?.width) || 1) * 0.5;
  const leftHalfDepth = Math.max(1, Number(left?.depth) || 1) * 0.5;
  const rightHalfWidth = Math.max(1, Number(right?.width) || 1) * 0.5;
  const rightHalfDepth = Math.max(1, Number(right?.depth) || 1) * 0.5;
  return Math.abs((Number(left?.x) || 0) - (Number(right?.x) || 0)) < (leftHalfWidth + rightHalfWidth)
    && Math.abs((Number(left?.y) || 0) - (Number(right?.y) || 0)) < (leftHalfDepth + rightHalfDepth);
};

const validateTrainingMapConfig = (mapConfig = TRAINING_MAP_CONFIG) => {
  const errors = [];
  const layoutMeta = mapConfig?.layoutMeta || {};
  const fieldWidth = Number(layoutMeta?.fieldWidth);
  const fieldHeight = Number(layoutMeta?.fieldHeight);
  if (mapConfig?.mapId !== TRAINING_MAP_ID) errors.push('地图 ID 不匹配');
  if (Number(mapConfig?.mapVersion) !== TRAINING_MAP_VERSION) errors.push('地图版本不匹配');
  if (!Number.isFinite(fieldWidth) || fieldWidth < 100) errors.push('世界宽度无效');
  if (!Number.isFinite(fieldHeight) || fieldHeight < 100) errors.push('世界高度无效');
  const movementCalibration = mapConfig?.movementCalibration || layoutMeta?.movementCalibration || {};
  const targetTravelSeconds = Number(movementCalibration?.targetTravelSeconds);
  const expectedTravelSeconds = Number(movementCalibration?.expectedTravelSeconds);
  if (!Number.isFinite(targetTravelSeconds) || targetTravelSeconds <= 0) {
    errors.push('行军时间标定目标无效');
  }
  if (!Number.isFinite(expectedTravelSeconds) || expectedTravelSeconds <= 0) {
    errors.push('行军时间标定距离无效');
  } else if (Number.isFinite(targetTravelSeconds) && Math.abs(expectedTravelSeconds - targetTravelSeconds) > 1.25) {
    errors.push('高地到左中路外塔的标定行军时间偏离目标');
  }

  const objects = Array.isArray(mapConfig?.objects) ? mapConfig.objects : [];
  const objectById = new Map();
  objects.forEach((entry) => {
    const objectId = String(entry?.objectId || '');
    if (!objectId) {
      errors.push('存在缺少 objectId 的地图元素');
      return;
    }
    if (objectById.has(objectId)) errors.push(`地图元素 ID 重复: ${objectId}`);
    objectById.set(objectId, entry);
    if (!isFiniteCoordinate(entry?.x) || !isFiniteCoordinate(entry?.y)) {
      errors.push(`地图元素坐标无效: ${objectId}`);
      return;
    }
    if (Math.abs(Number(entry.x)) > fieldWidth * 0.5 || Math.abs(Number(entry.y)) > fieldHeight * 0.5) {
      errors.push(`地图元素超出边界: ${objectId}`);
    }
  });

  objects.forEach((entry, index) => {
    if (!entry?.mirrorOf) return;
    const mirror = objectById.get(entry.mirrorOf);
    if (!mirror) {
      errors.push(`镜像元素缺失: ${entry.objectId}`);
      return;
    }
    if (mirror?.mirrorOf !== entry.objectId) errors.push(`镜像关系不闭合: ${entry.objectId}`);
    if (Math.abs((Number(entry.x) || 0) + (Number(mirror.x) || 0)) > 1) errors.push(`镜像 X 坐标不对称: ${entry.objectId}`);
    if (Math.abs((Number(entry.y) || 0) - (Number(mirror.y) || 0)) > 1) errors.push(`镜像 Y 坐标不对称: ${entry.objectId}`);
    for (let otherIndex = index + 1; otherIndex < objects.length; otherIndex += 1) {
      const other = objects[otherIndex];
      if (isOverlapping(entry, other)) errors.push(`静态障碍重叠: ${entry.objectId}/${other.objectId}`);
    }
  });

  const lanes = Array.isArray(mapConfig?.lanes) ? mapConfig.lanes : [];
  if (lanes.length !== 3) errors.push('训练地图必须包含三条道路');
  ['top', 'mid', 'bottom'].forEach((laneId) => {
    if (!lanes.some((lane) => lane?.id === laneId)) errors.push(`缺少道路: ${laneId}`);
  });

  const deploySlots = Array.isArray(mapConfig?.deploySlots) ? mapConfig.deploySlots : [];
  ['attacker', 'defender'].forEach((team) => {
    const count = deploySlots.filter((slot) => slot?.team === team).length;
    if (count !== 6) errors.push(`${team} 部署槽数量必须为 6`);
  });
  const deploySlotIds = new Set();
  deploySlots.forEach((slot) => {
    const slotId = String(slot?.id || '');
    if (!slotId || deploySlotIds.has(slotId)) errors.push(`部署槽 ID 无效或重复: ${slotId}`);
    deploySlotIds.add(slotId);
  });

  const objectives = Array.isArray(mapConfig?.objectives) ? mapConfig.objectives : [];
  const objectiveIds = new Set();
  objectives.forEach((objective) => {
    const objectiveId = String(objective?.objectiveId || '');
    if (!objectiveId || objectiveIds.has(objectiveId)) errors.push(`目标 ID 无效或重复: ${objectiveId}`);
    objectiveIds.add(objectiveId);
    if (!objectById.has(objective?.sourceObjectId)) errors.push(`目标缺少静态对象: ${objectiveId}`);
  });

  return {
    valid: errors.length === 0,
    errors
  };
};

const mergeItemCatalog = (catalog = [], mapCatalog = []) => {
  const byItemId = new Map();
  (Array.isArray(catalog) ? catalog : []).forEach((item) => {
    const itemId = String(item?.itemId || '').trim();
    if (itemId) byItemId.set(itemId, item);
  });
  (Array.isArray(mapCatalog) ? mapCatalog : []).forEach((item) => {
    const itemId = String(item?.itemId || '').trim();
    if (itemId) byItemId.set(itemId, item);
  });
  return Array.from(byItemId.values());
};

const getTrainingMapConfig = () => cloneValue(TRAINING_MAP_CONFIG);

const buildTrainingBattlefield = ({ itemCatalog = [], presetId = '' } = {}) => {
  const map = getTrainingMapConfig();
  const { presetId: activePresetId, enabledTags } = resolveEnabledTags(map, presetId);
  const activeObjects = map.objects.filter((entry) => shouldIncludeByPreset(entry, enabledTags));
  const activeObjectives = map.objectives.filter((entry) => shouldIncludeByPreset(entry, enabledTags));
  return {
    intelVisible: true,
    mapId: map.mapId,
    mapVersion: map.mapVersion,
    layoutMeta: map.layoutMeta,
    map: {
      ...map,
      activePresetId,
      activeObjects: activeObjects.map((entry) => entry.objectId),
      activeObjectives: activeObjectives.map((entry) => entry.objectiveId)
    },
    itemCatalog: mergeItemCatalog(itemCatalog, map.itemCatalog),
    objects: activeObjects,
    defenderDeployments: []
  };
};

const buildLegacyTrainingBattlefield = ({ itemCatalog = [] } = {}) => ({
  intelVisible: true,
  mapId: 'legacy-flat',
  mapVersion: 1,
  layoutMeta: {
    fieldWidth: FIELD_WIDTH,
    fieldHeight: FIELD_HEIGHT,
    maxItemsPerType: 999999
  },
  itemCatalog: Array.isArray(itemCatalog) ? itemCatalog : [],
  objects: [],
  defenderDeployments: []
});

module.exports = {
  TRAINING_MAP_ID,
  TRAINING_MAP_VERSION,
  getTrainingMapConfig,
  validateTrainingMapConfig,
  buildTrainingBattlefield,
  buildLegacyTrainingBattlefield
};
