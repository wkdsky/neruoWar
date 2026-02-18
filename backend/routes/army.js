const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { fetchArmyUnitTypes } = require('../services/armyUnitTypeService');

const getUnitTypeId = (unit) => {
  const id = typeof unit?.id === 'string' ? unit.id.trim() : '';
  if (id) return id;
  return typeof unit?.unitTypeId === 'string' ? unit.unitTypeId.trim() : '';
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
    const unitTypes = await fetchArmyUnitTypes();
    return res.json({ unitTypes });
  } catch (error) {
    console.error('获取兵种列表失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, user] = await Promise.all([
      fetchArmyUnitTypes(),
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

router.post('/recruit', authenticateToken, async (req, res) => {
  try {
    const unitTypeId = typeof req.body?.unitTypeId === 'string' ? req.body.unitTypeId.trim() : '';
    const qty = Number(req.body?.qty);

    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: '数量必须为正整数' });
    }

    const unitTypes = await fetchArmyUnitTypes();
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
    const unitTypes = await fetchArmyUnitTypes();
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
