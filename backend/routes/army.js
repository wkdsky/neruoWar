const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { fetchUnitTypesWithComponents } = require('../services/unitRegistryService');
const { fetchBattlefieldItems } = require('../services/placeableCatalogService');
const { UNIT_TYPE_DTO_VERSION } = require('../services/unitTypeDtoService');
const {
  BATTLEFIELD_FIELD_WIDTH,
  BATTLEFIELD_FIELD_HEIGHT
} = require('../services/battlefieldScale');

const getUnitTypeId = (unit) => {
  const unitTypeId = typeof unit?.unitTypeId === 'string' ? unit.unitTypeId.trim() : '';
  if (unitTypeId) return unitTypeId;
  return typeof unit?.id === 'string' ? unit.id.trim() : '';
};

const fetchEnabledUnitTypes = async () => {
  const registry = await fetchUnitTypesWithComponents({ enabledOnly: true });
  return Array.isArray(registry?.unitTypes) ? registry.unitTypes : [];
};

const normalizeRoster = (rawRoster, unitTypes) => {
  const incoming = Array.isArray(rawRoster) ? rawRoster : [];
  const rosterById = incoming.reduce((acc, item) => {
    const unitTypeId = typeof item?.unitTypeId === 'string' ? item.unitTypeId : '';
    if (!unitTypeId || acc[unitTypeId]) return acc;

    acc[unitTypeId] = {
      unitTypeId,
      count: Number.isFinite(item?.count) ? Math.max(0, Math.floor(item.count)) : 0,
      level: Number.isFinite(item?.level) ? Math.max(1, Math.floor(item.level)) : 1,
      nextUnitTypeId: typeof item?.nextUnitTypeId === 'string' && item.nextUnitTypeId.trim()
        ? item.nextUnitTypeId.trim()
        : null,
      upgradeCostKP: Number.isFinite(item?.upgradeCostKP)
        ? Math.max(0, Math.floor(item.upgradeCostKP))
        : null
    };
    return acc;
  }, {});

  return unitTypes.map((unit) => {
    const unitTypeId = getUnitTypeId(unit);
    const existed = rosterById[unitTypeId];
    if (existed) {
      return {
        ...existed,
        unitTypeId
      };
    }

    return {
      unitTypeId,
      count: 0,
      level: Number.isFinite(unit.level) ? Math.max(1, Math.floor(unit.level)) : 1,
      nextUnitTypeId: unit.nextUnitTypeId || null,
      upgradeCostKP: Number.isFinite(unit.upgradeCostKP) ? unit.upgradeCostKP : null
    };
  });
};

const buildUnitTypeMap = (unitTypes) => unitTypes.reduce((acc, unit) => {
  const unitTypeId = getUnitTypeId(unit);
  if (unitTypeId) {
    acc[unitTypeId] = unit;
  }
  return acc;
}, {});

const MAX_TEMPLATE_NAME_LEN = 32;
const MAX_TEMPLATE_COUNT = 100;
const MAX_TEMPLATE_UNIT_COUNT = 100;
const MAX_TEMPLATE_TOTAL_COUNT = 100;
const MAX_TEMPLATE_FORMATION_COUNT = 12;
const MAX_TEMPLATE_FORMATION_NAME_LEN = 24;
const MAX_TEMPLATE_FORMATION_COORD = 999;

const buildTemplateId = () => `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const buildFormationId = () => `fmt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeTemplateName = (rawName, fallback = '未命名模板') => {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) return fallback;
  return name.slice(0, MAX_TEMPLATE_NAME_LEN);
};

const normalizeFormationName = (rawName, fallback = '默认阵型') => {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) return fallback;
  return name.slice(0, MAX_TEMPLATE_FORMATION_NAME_LEN);
};

const normalizeTemplateUnitsLoose = (rawUnits) => {
  const source = Array.isArray(rawUnits) ? rawUnits : [];
  const byId = source.reduce((acc, raw) => {
    const unitTypeId = typeof raw?.unitTypeId === 'string' ? raw.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(raw?.count) || 0));
    if (!unitTypeId || count <= 0) return acc;
    acc[unitTypeId] = (acc[unitTypeId] || 0) + count;
    return acc;
  }, {});
  const out = [];
  let total = 0;
  Object.keys(byId).forEach((unitTypeId) => {
    if (total >= MAX_TEMPLATE_TOTAL_COUNT) return;
    const next = Math.min(MAX_TEMPLATE_UNIT_COUNT, Math.max(1, byId[unitTypeId]));
    const count = Math.min(next, MAX_TEMPLATE_TOTAL_COUNT - total);
    if (count <= 0) return;
    out.push({ unitTypeId, count });
    total += count;
  });
  return out;
};

const normalizeTemplateUnitsStrict = (rawUnits, unitTypeMap) => {
  if (!Array.isArray(rawUnits) || rawUnits.length <= 0) {
    return { error: '模板兵种清单不能为空' };
  }

  const byId = {};
  for (const raw of rawUnits) {
    const unitTypeId = typeof raw?.unitTypeId === 'string' ? raw.unitTypeId.trim() : '';
    const countRaw = Number(raw?.count);
    if (!unitTypeId || !unitTypeMap[unitTypeId]) {
      return { error: '模板中存在无效兵种' };
    }
    if (!Number.isInteger(countRaw) || countRaw <= 0) {
      return { error: '模板兵力必须为正整数' };
    }
    byId[unitTypeId] = Math.min(
      MAX_TEMPLATE_UNIT_COUNT,
      (byId[unitTypeId] || 0) + Math.floor(countRaw)
    );
  }

  const units = Object.keys(byId).map((unitTypeId) => ({
    unitTypeId,
    count: byId[unitTypeId]
  }));
  if (units.length <= 0) {
    return { error: '模板兵种清单不能为空' };
  }
  const totalCount = units.reduce((sum, entry) => sum + entry.count, 0);
  if (totalCount > MAX_TEMPLATE_TOTAL_COUNT) {
    return { error: `部队基础数最多 ${MAX_TEMPLATE_TOTAL_COUNT}` };
  }
  return { units };
};

const getFormationId = (formation) => {
  const formationId = typeof formation?.formationId === 'string' ? formation.formationId.trim() : '';
  if (formationId) return formationId;
  return typeof formation?.id === 'string' ? formation.id.trim() : '';
};

const buildUnitCountMap = (units = []) => (
  normalizeTemplateUnitsLoose(units).reduce((acc, entry) => {
    acc.set(entry.unitTypeId, entry.count);
    return acc;
  }, new Map())
);

const buildDefaultFormationPlacements = (units = []) => {
  const placements = [];
  let cursor = 0;
  normalizeTemplateUnitsLoose(units).forEach((entry) => {
    for (let i = 0; i < entry.count && cursor < MAX_TEMPLATE_TOTAL_COUNT; i += 1) {
      const row = Math.floor(cursor / 10);
      placements.push({
        unitTypeId: entry.unitTypeId,
        x: (cursor % 10) - 4,
        y: row - 4
      });
      cursor += 1;
    }
  });
  return placements;
};

const countFormationPlacements = (placements = []) => (
  (Array.isArray(placements) ? placements : []).reduce((acc, placement) => {
    const unitTypeId = typeof placement?.unitTypeId === 'string' ? placement.unitTypeId.trim() : '';
    if (!unitTypeId) return acc;
    acc.set(unitTypeId, (acc.get(unitTypeId) || 0) + 1);
    return acc;
  }, new Map())
);

const isFormationLegal = (formation, units) => {
  const unitCounts = buildUnitCountMap(units);
  const placements = Array.isArray(formation?.placements) ? formation.placements : [];
  const total = Array.from(unitCounts.values()).reduce((sum, count) => sum + count, 0);
  if (total <= 0 || placements.length !== total) return false;
  const placementCounts = countFormationPlacements(placements);
  return Array.from(unitCounts.entries()).every(([unitTypeId, count]) => (
    (placementCounts.get(unitTypeId) || 0) === count
  ));
};

const normalizeFormationPlacements = (rawPlacements, unitTypeMap, unitCounts, strict = false) => {
  const source = Array.isArray(rawPlacements) ? rawPlacements : [];
  const out = [];
  const occupied = new Set();
  const used = new Map();
  for (const raw of source) {
    if (out.length >= MAX_TEMPLATE_TOTAL_COUNT) break;
    const unitTypeId = typeof raw?.unitTypeId === 'string' ? raw.unitTypeId.trim() : '';
    if (!unitTypeId) continue;
    if (strict && (!unitTypeMap[unitTypeId] || !unitCounts.has(unitTypeId))) {
      return { error: '阵型中存在无效兵种' };
    }
    if (!unitCounts.has(unitTypeId)) continue;
    const x = Math.max(
      -MAX_TEMPLATE_FORMATION_COORD,
      Math.min(MAX_TEMPLATE_FORMATION_COORD, Math.floor(Number(raw?.x) || 0))
    );
    const y = Math.max(
      -MAX_TEMPLATE_FORMATION_COORD,
      Math.min(MAX_TEMPLATE_FORMATION_COORD, Math.floor(Number(raw?.y) || 0))
    );
    const cellKey = `${x}:${y}`;
    if (occupied.has(cellKey)) {
      if (strict) return { error: '阵型中存在重复站位' };
      continue;
    }
    const nextUsed = (used.get(unitTypeId) || 0) + 1;
    if (nextUsed > (unitCounts.get(unitTypeId) || 0)) {
      if (strict) return { error: '阵型兵种数量超过部队基础数' };
      continue;
    }
    occupied.add(cellKey);
    used.set(unitTypeId, nextUsed);
    out.push({ unitTypeId, x, y });
  }
  return { placements: out };
};

const normalizeTemplateFormationsLoose = (rawFormations, units) => {
  const unitCounts = buildUnitCountMap(units);
  const source = Array.isArray(rawFormations) && rawFormations.length > 0
    ? rawFormations
    : [{
      formationId: buildFormationId(),
      name: '默认阵型',
      placements: buildDefaultFormationPlacements(units)
    }];
  const formations = source
    .slice(0, MAX_TEMPLATE_FORMATION_COUNT)
    .map((formation, index) => {
      const normalized = normalizeFormationPlacements(
        formation?.placements || [],
        {},
        unitCounts,
        false
      );
      return {
        formationId: getFormationId(formation) || buildFormationId(),
        name: normalizeFormationName(formation?.name, index <= 0 ? '默认阵型' : `新建阵型${index}`),
        placements: normalized.placements || []
      };
    });
  return formations.length > 0 ? formations : [{
    formationId: buildFormationId(),
    name: '默认阵型',
    placements: buildDefaultFormationPlacements(units)
  }];
};

const normalizeTemplateFormationsStrict = (rawFormations, unitTypeMap, units) => {
  const unitCounts = buildUnitCountMap(units);
  const source = Array.isArray(rawFormations) && rawFormations.length > 0
    ? rawFormations
    : [{
      formationId: buildFormationId(),
      name: '默认阵型',
      placements: buildDefaultFormationPlacements(units)
    }];
  const formations = [];
  for (const [index, formation] of source.slice(0, MAX_TEMPLATE_FORMATION_COUNT).entries()) {
    const normalized = normalizeFormationPlacements(
      formation?.placements || [],
      unitTypeMap,
      unitCounts,
      true
    );
    if (normalized.error) return { error: normalized.error };
    formations.push({
      formationId: getFormationId(formation) || buildFormationId(),
      name: normalizeFormationName(formation?.name, index <= 0 ? '默认阵型' : `新建阵型${index}`),
      placements: normalized.placements || []
    });
  }
  if (!formations.some((formation) => isFormationLegal(formation, units))) {
    return { error: '至少需要一个合法阵型' };
  }
  return { formations };
};

const serializeArmyTemplate = (template, unitTypeMap) => {
  const units = normalizeTemplateUnitsLoose(template?.units).map((entry) => ({
    unitTypeId: entry.unitTypeId,
    unitName: unitTypeMap[entry.unitTypeId]?.name || entry.unitTypeId,
    count: entry.count
  }));
  const formations = normalizeTemplateFormationsLoose(template?.formations, units).map((formation) => ({
    id: formation.formationId,
    formationId: formation.formationId,
    name: formation.name,
    placements: formation.placements,
    totalPlaced: formation.placements.length,
    legal: isFormationLegal(formation, units)
  }));
  const totalCount = units.reduce((sum, item) => sum + item.count, 0);
  const createdAtMs = new Date(template?.createdAt || 0).getTime();
  const updatedAtMs = new Date(template?.updatedAt || 0).getTime();
  return {
    templateId: typeof template?.templateId === 'string' ? template.templateId.trim() : '',
    name: normalizeTemplateName(template?.name, '未命名模板'),
    units,
    formations,
    totalCount,
    createdAt: Number.isFinite(createdAtMs) && createdAtMs > 0 ? new Date(createdAtMs).toISOString() : null,
    updatedAt: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : null
  };
};

const serializeArmyTemplates = (rawTemplates, unitTypeMap) => (
  (Array.isArray(rawTemplates) ? rawTemplates : [])
    .map((template) => serializeArmyTemplate(template, unitTypeMap))
    .filter((template) => template.templateId)
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    })
);

const buildMePayload = (userDoc, unitTypes) => ({
  knowledgeBalance: Number.isFinite(userDoc?.knowledgeBalance)
    ? Math.max(0, Math.floor(userDoc.knowledgeBalance))
    : 0,
  roster: normalizeRoster(userDoc?.armyRoster, unitTypes)
});

const buildBatchRecruitRosterExpression = (recruitEntries) => ({
  $reduce: {
    input: recruitEntries,
    initialValue: { $ifNull: ['$armyRoster', []] },
    in: {
      $let: {
        vars: {
          roster: '$$value',
          recruit: '$$this'
        },
        in: {
          $let: {
            vars: {
              existingIds: {
                $map: {
                  input: '$$roster',
                  as: 'entry',
                  in: '$$entry.unitTypeId'
                }
              }
            },
            in: {
              $cond: [
                { $in: ['$$recruit.unitTypeId', '$$existingIds'] },
                {
                  $map: {
                    input: '$$roster',
                    as: 'entry',
                    in: {
                      $cond: [
                        { $eq: ['$$entry.unitTypeId', '$$recruit.unitTypeId'] },
                        {
                          $mergeObjects: [
                            '$$entry',
                            {
                              count: {
                                $add: [
                                  { $ifNull: ['$$entry.count', 0] },
                                  '$$recruit.qty'
                                ]
                              }
                            }
                          ]
                        },
                        '$$entry'
                      ]
                    }
                  }
                },
                {
                  $concatArrays: [
                    '$$roster',
                    [{
                      unitTypeId: '$$recruit.unitTypeId',
                      count: '$$recruit.qty',
                      level: '$$recruit.level',
                      nextUnitTypeId: '$$recruit.nextUnitTypeId',
                      upgradeCostKP: '$$recruit.upgradeCostKP'
                    }]
                  ]
                }
              ]
            }
          }
        }
      }
    }
  }
});

const normalizeRecruitItems = (rawItems, unitTypeMap) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: '征召清单不能为空' };
  }

  const qtyByUnitTypeId = rawItems.reduce((acc, raw) => {
    const unitTypeId = typeof raw?.unitTypeId === 'string' ? raw.unitTypeId.trim() : '';
    const qty = Number(raw?.qty);

    if (!unitTypeId || !unitTypeMap[unitTypeId]) {
      acc.__error = '存在无效的兵种类型';
      return acc;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      acc.__error = '数量必须为正整数';
      return acc;
    }

    acc[unitTypeId] = (acc[unitTypeId] || 0) + qty;
    return acc;
  }, {});

  if (qtyByUnitTypeId.__error) {
    return { error: qtyByUnitTypeId.__error };
  }

  const items = Object.keys(qtyByUnitTypeId).map((unitTypeId) => ({
    unitTypeId,
    qty: qtyByUnitTypeId[unitTypeId],
    unitType: unitTypeMap[unitTypeId]
  }));

  if (items.length === 0) {
    return { error: '征召清单不能为空' };
  }

  return { items };
};

const buildRecruitEntries = (recruitItems) => recruitItems.map(({ unitTypeId, qty, unitType }) => ({
  unitTypeId,
  qty,
  level: Number.isFinite(unitType?.level) ? Math.max(1, Math.floor(unitType.level)) : 1,
  nextUnitTypeId: unitType?.nextUnitTypeId || null,
  upgradeCostKP: Number.isFinite(unitType?.upgradeCostKP) ? unitType.upgradeCostKP : null
}));

const executeRecruitCheckout = async ({ userId, recruitItems }) => {
  const totalCost = recruitItems.reduce((sum, item) => sum + (item.unitType.costKP * item.qty), 0);
  const recruitEntries = buildRecruitEntries(recruitItems);

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      knowledgeBalance: { $gte: totalCost }
    },
    [
      {
        $set: {
          knowledgeBalance: { $subtract: ['$knowledgeBalance', totalCost] },
          armyRoster: buildBatchRecruitRosterExpression(recruitEntries)
        }
      }
    ],
    {
      new: true,
      projection: {
        knowledgeBalance: 1,
        armyRoster: 1
      }
    }
  );

  if (!updatedUser) {
    const user = await User.findById(userId).select('knowledgeBalance');
    if (!user) {
      return { error: 'USER_NOT_FOUND' };
    }
    if ((user.knowledgeBalance || 0) < totalCost) {
      return { error: 'INSUFFICIENT_BALANCE' };
    }
    return { error: 'CONFLICT' };
  }

  return {
    updatedUser,
    totalCost
  };
};

router.get('/unit-types', async (req, res) => {
  try {
    const unitTypes = await fetchEnabledUnitTypes();
    return res.json({
      unitTypeDtoVersion: UNIT_TYPE_DTO_VERSION,
      unitTypes
    });
  } catch (error) {
    console.error('获取兵种列表失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/training/init', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, itemCatalog, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      fetchBattlefieldItems({ enabledOnly: true }),
      User.findById(req.user.userId).select('username')
    ]);

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const unlimitedUnits = (Array.isArray(unitTypes) ? unitTypes : [])
      .map((unit) => {
        const unitTypeId = getUnitTypeId(unit);
        if (!unitTypeId) return null;
        return {
          unitTypeId,
          unitName: unit?.name || unitTypeId,
          count: MAX_TEMPLATE_UNIT_COUNT
        };
      })
      .filter(Boolean);

    const unlimitedItems = (Array.isArray(itemCatalog) ? itemCatalog : []).map((item) => ({
      ...item,
      initialCount: MAX_TEMPLATE_UNIT_COUNT
    }));

    return res.json({
      mode: 'training',
      battleId: `training_${Date.now()}`,
      nodeId: '',
      gateKey: 'training',
      gateLabel: '训练场',
      nodeName: '训练场',
      timeLimitSec: 240,
      unitsPerSoldier: 10,
      attacker: {
        username: user.username || '我方',
        totalCount: 0,
        units: unlimitedUnits,
        rosterUnits: unlimitedUnits
      },
      defender: {
        username: '敌方',
        totalCount: 0,
        units: [],
        rosterUnits: unlimitedUnits,
        deployUnits: []
      },
      unitTypeDtoVersion: UNIT_TYPE_DTO_VERSION,
      unitTypes: Array.isArray(unitTypes) ? unitTypes : [],
      battlefield: {
        intelVisible: true,
        layoutMeta: {
          fieldWidth: BATTLEFIELD_FIELD_WIDTH,
          fieldHeight: BATTLEFIELD_FIELD_HEIGHT,
          maxItemsPerType: 999999
        },
        itemCatalog: unlimitedItems,
        objects: [],
        defenderDeployments: []
      }
    });
  } catch (error) {
    console.error('获取训练场初始化失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('knowledgeBalance armyRoster')
    ]);

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    return res.json(buildMePayload(user, unitTypes));
  } catch (error) {
    console.error('获取军团信息失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/templates', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('armyTemplates')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const unitTypeMap = buildUnitTypeMap(unitTypes);
    return res.json({
      success: true,
      templates: serializeArmyTemplates(user.armyTemplates, unitTypeMap)
    });
  } catch (error) {
    console.error('获取部队模板失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/templates', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('armyTemplates')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const existingTemplates = Array.isArray(user.armyTemplates) ? user.armyTemplates : [];
    if (existingTemplates.length >= MAX_TEMPLATE_COUNT) {
      return res.status(400).json({ error: `模板数量已达上限（${MAX_TEMPLATE_COUNT}）` });
    }

    const unitTypeMap = buildUnitTypeMap(unitTypes);
    const normalizedUnits = normalizeTemplateUnitsStrict(req.body?.units, unitTypeMap);
    if (normalizedUnits.error) {
      return res.status(400).json({ error: normalizedUnits.error });
    }
    const normalizedFormations = normalizeTemplateFormationsStrict(
      req.body?.formations,
      unitTypeMap,
      normalizedUnits.units
    );
    if (normalizedFormations.error) {
      return res.status(400).json({ error: normalizedFormations.error });
    }

    const templateName = normalizeTemplateName(req.body?.name, `模板${existingTemplates.length + 1}`);
    const now = new Date();
    const created = {
      templateId: buildTemplateId(),
      name: templateName,
      units: normalizedUnits.units,
      formations: normalizedFormations.formations,
      createdAt: now,
      updatedAt: now
    };

    user.armyTemplates = [...existingTemplates, created];
    await user.save();

    return res.json({
      success: true,
      template: serializeArmyTemplate(created, unitTypeMap),
      templates: serializeArmyTemplates(user.armyTemplates, unitTypeMap)
    });
  } catch (error) {
    console.error('创建部队模板失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.put('/templates/:templateId', authenticateToken, async (req, res) => {
  try {
    const templateId = typeof req.params?.templateId === 'string' ? req.params.templateId.trim() : '';
    if (!templateId) {
      return res.status(400).json({ error: '模板ID不能为空' });
    }
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('armyTemplates')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const templates = Array.isArray(user.armyTemplates) ? user.armyTemplates : [];
    const index = templates.findIndex((item) => (
      typeof item?.templateId === 'string' && item.templateId.trim() === templateId
    ));
    if (index < 0) {
      return res.status(404).json({ error: '模板不存在' });
    }

    const unitTypeMap = buildUnitTypeMap(unitTypes);
    const hasUnitsPayload = Object.prototype.hasOwnProperty.call(req.body || {}, 'units');
    const hasNamePayload = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
    const hasFormationsPayload = Object.prototype.hasOwnProperty.call(req.body || {}, 'formations');
    if (!hasUnitsPayload && !hasNamePayload && !hasFormationsPayload) {
      return res.status(400).json({ error: '至少提供 name、units 或 formations 字段' });
    }

    const current = templates[index];
    const nextName = hasNamePayload
      ? normalizeTemplateName(req.body?.name, normalizeTemplateName(current?.name, `模板${index + 1}`))
      : normalizeTemplateName(current?.name, `模板${index + 1}`);

    let nextUnits = normalizeTemplateUnitsLoose(current?.units);
    if (hasUnitsPayload) {
      const normalizedUnits = normalizeTemplateUnitsStrict(req.body?.units, unitTypeMap);
      if (normalizedUnits.error) {
        return res.status(400).json({ error: normalizedUnits.error });
      }
      nextUnits = normalizedUnits.units;
    }

    let nextFormations = normalizeTemplateFormationsLoose(current?.formations, nextUnits);
    if (hasFormationsPayload || hasUnitsPayload) {
      const formationsPayload = hasFormationsPayload ? req.body?.formations : undefined;
      const normalizedFormations = normalizeTemplateFormationsStrict(
        formationsPayload,
        unitTypeMap,
        nextUnits
      );
      if (normalizedFormations.error) {
        return res.status(400).json({ error: normalizedFormations.error });
      }
      nextFormations = normalizedFormations.formations;
    }

    const nextTemplate = {
      templateId,
      name: nextName,
      units: nextUnits,
      formations: nextFormations,
      createdAt: current?.createdAt || new Date(),
      updatedAt: new Date()
    };

    templates[index] = nextTemplate;
    user.armyTemplates = templates;
    await user.save();

    return res.json({
      success: true,
      template: serializeArmyTemplate(nextTemplate, unitTypeMap),
      templates: serializeArmyTemplates(user.armyTemplates, unitTypeMap)
    });
  } catch (error) {
    console.error('更新部队模板失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.delete('/templates/:templateId', authenticateToken, async (req, res) => {
  try {
    const templateId = typeof req.params?.templateId === 'string' ? req.params.templateId.trim() : '';
    if (!templateId) {
      return res.status(400).json({ error: '模板ID不能为空' });
    }
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('armyTemplates')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const templates = Array.isArray(user.armyTemplates) ? user.armyTemplates : [];
    const nextTemplates = templates.filter((item) => (
      !(typeof item?.templateId === 'string' && item.templateId.trim() === templateId)
    ));
    if (nextTemplates.length === templates.length) {
      return res.status(404).json({ error: '模板不存在' });
    }

    user.armyTemplates = nextTemplates;
    await user.save();

    const unitTypeMap = buildUnitTypeMap(unitTypes);
    return res.json({
      success: true,
      templates: serializeArmyTemplates(user.armyTemplates, unitTypeMap)
    });
  } catch (error) {
    console.error('删除部队模板失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/recruit', authenticateToken, async (req, res) => {
  try {
    const unitTypeId = typeof req.body?.unitTypeId === 'string' ? req.body.unitTypeId.trim() : '';
    const qty = Number(req.body?.qty);

    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: '数量必须为正整数' });
    }

    const unitTypes = await fetchEnabledUnitTypes();
    const unitTypeMap = buildUnitTypeMap(unitTypes);
    const unitType = unitTypeMap[unitTypeId];

    if (!unitType) {
      return res.status(400).json({ error: '无效的兵种类型' });
    }

    const result = await executeRecruitCheckout({
      userId: req.user.userId,
      recruitItems: [{ unitTypeId, qty, unitType }]
    });

    if (result.error === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (result.error === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: '知识点不足' });
    }
    if (result.error === 'CONFLICT') {
      return res.status(409).json({ error: '征召失败，请稍后重试' });
    }

    return res.json({
      success: true,
      ...buildMePayload(result.updatedUser, unitTypes)
    });
  } catch (error) {
    console.error('征召失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/recruit/checkout', authenticateToken, async (req, res) => {
  try {
    const unitTypes = await fetchEnabledUnitTypes();
    const unitTypeMap = buildUnitTypeMap(unitTypes);
    const normalized = normalizeRecruitItems(req.body?.items, unitTypeMap);

    if (normalized.error) {
      return res.status(400).json({ error: normalized.error });
    }

    const result = await executeRecruitCheckout({
      userId: req.user.userId,
      recruitItems: normalized.items
    });

    if (result.error === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (result.error === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: '知识点不足' });
    }
    if (result.error === 'CONFLICT') {
      return res.status(409).json({ error: '结算失败，请稍后重试' });
    }

    return res.json({
      success: true,
      totalCost: result.totalCost,
      ...buildMePayload(result.updatedUser, unitTypes)
    });
  } catch (error) {
    console.error('结算征召失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
