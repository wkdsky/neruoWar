const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Node = require('../models/Node');
const EntropyAlliance = require('../models/EntropyAlliance');
const GameSetting = require('../models/GameSetting');
const ArmyUnitType = require('../models/ArmyUnitType');
const BattlefieldItem = require('../models/BattlefieldItem');
const CityBuildingType = require('../models/CityBuildingType');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');
const {
  fetchArmyUnitTypes,
  serializeArmyUnitType
} = require('../services/armyUnitTypeService');
const {
  fetchBattlefieldItems,
  fetchCityBuildingTypes,
  serializeBattlefieldItem,
  serializeCityBuildingType
} = require('../services/placeableCatalogService');

const getOrCreateSettings = async () => GameSetting.findOneAndUpdate(
  { key: 'global' },
  { $setOnInsert: { travelUnitSeconds: 60, distributionAnnouncementLeadHours: 24 } },
  { new: true, upsert: true, setDefaultsOnInsert: true }
);

const UNIT_TYPE_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;
const CATALOG_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;
const ROLE_TAG_SET = new Set(['近战', '远程']);

const parseNumberField = ({ body, key, required = false, integer = false, min = null }) => {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    if (required) return { error: `缺少字段：${key}` };
    return { skip: true };
  }

  const value = Number(body[key]);
  if (!Number.isFinite(value)) {
    return { error: `${key} 必须是数字` };
  }
  if (integer && !Number.isInteger(value)) {
    return { error: `${key} 必须是整数` };
  }
  if (min !== null && value < min) {
    return { error: `${key} 不能小于 ${min}` };
  }
  return { value };
};

const toSafeInteger = (value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const parseUnitTypePayload = (body, { create = false } = {}) => {
  const source = body && typeof body === 'object' ? body : {};
  const parsed = {};
  const errors = [];

  const parseStringField = (key, { required = false, maxLen = 64 } = {}) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      if (required) errors.push(`缺少字段：${key}`);
      return;
    }
    const text = typeof source[key] === 'string' ? source[key].trim() : '';
    if (!text) {
      if (required) errors.push(`${key} 不能为空`);
      return;
    }
    if (text.length > maxLen) {
      errors.push(`${key} 过长`);
      return;
    }
    parsed[key] = text;
  };

  parseStringField('name', { required: create, maxLen: 64 });

  if (create) {
    parseStringField('unitTypeId', { required: true, maxLen: 64 });
    if (parsed.unitTypeId && !UNIT_TYPE_ID_RE.test(parsed.unitTypeId)) {
      errors.push('unitTypeId 仅支持字母、数字、下划线、中划线，长度 2-64');
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, 'roleTag')) {
    const roleTag = typeof source.roleTag === 'string' ? source.roleTag.trim() : '';
    if (!ROLE_TAG_SET.has(roleTag)) {
      errors.push('roleTag 必须是「近战」或「远程」');
    } else {
      parsed.roleTag = roleTag;
    }
  } else if (create) {
    errors.push('缺少字段：roleTag');
  }

  [
    ['speed', false, 0],
    ['hp', true, 1],
    ['atk', true, 0],
    ['def', true, 0],
    ['range', true, 1],
    ['costKP', true, 1],
    ['level', true, 1],
    ['sortOrder', true, null]
  ].forEach(([key, integer, min]) => {
    const result = parseNumberField({
      body: source,
      key,
      required: create && ['speed', 'hp', 'atk', 'def', 'range', 'costKP'].includes(key),
      integer,
      min
    });
    if (result.error) {
      errors.push(result.error);
      return;
    }
    if (!result.skip) {
      parsed[key] = result.value;
    }
  });

  if (Object.prototype.hasOwnProperty.call(source, 'nextUnitTypeId')) {
    const nextUnitTypeId = typeof source.nextUnitTypeId === 'string' ? source.nextUnitTypeId.trim() : '';
    parsed.nextUnitTypeId = nextUnitTypeId || null;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'upgradeCostKP')) {
    if (source.upgradeCostKP === null || source.upgradeCostKP === '') {
      parsed.upgradeCostKP = null;
    } else {
      const result = parseNumberField({
        body: source,
        key: 'upgradeCostKP',
        required: false,
        integer: true,
        min: 0
      });
      if (result.error) {
        errors.push(result.error);
      } else if (!result.skip) {
        parsed.upgradeCostKP = result.value;
      }
    }
  }

  return { parsed, errors };
};

const parseStyleField = (source = {}, parsed = {}, errors = []) => {
  if (!Object.prototype.hasOwnProperty.call(source, 'style')) return;
  const style = source.style;
  if (style === null || style === undefined || style === '') {
    parsed.style = {};
    return;
  }
  if (typeof style !== 'object' || Array.isArray(style)) {
    errors.push('style 必须是对象');
    return;
  }
  parsed.style = style;
};

const parseBattlefieldItemPayload = (body, { create = false } = {}) => {
  const source = body && typeof body === 'object' ? body : {};
  const parsed = {};
  const errors = [];

  const parseStringField = (key, { required = false, maxLen = 64 } = {}) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      if (required) errors.push(`缺少字段：${key}`);
      return;
    }
    const text = typeof source[key] === 'string' ? source[key].trim() : '';
    if (!text) {
      if (required) errors.push(`${key} 不能为空`);
      return;
    }
    if (text.length > maxLen) {
      errors.push(`${key} 过长`);
      return;
    }
    parsed[key] = text;
  };

  parseStringField('name', { required: create, maxLen: 64 });
  if (create) {
    parseStringField('itemId', { required: true, maxLen: 64 });
    if (parsed.itemId && !CATALOG_ID_RE.test(parsed.itemId)) {
      errors.push('itemId 仅支持字母、数字、下划线、中划线，长度 2-64');
    }
  }

  [
    ['initialCount', true, 0],
    ['width', false, 12],
    ['depth', false, 12],
    ['height', false, 10],
    ['hp', true, 1],
    ['defense', false, 0.1],
    ['sortOrder', true, null]
  ].forEach(([key, integer, min]) => {
    const result = parseNumberField({
      body: source,
      key,
      required: create && ['width', 'depth', 'height', 'hp', 'defense', 'initialCount'].includes(key),
      integer,
      min
    });
    if (result.error) {
      errors.push(result.error);
      return;
    }
    if (!result.skip) {
      parsed[key] = result.value;
    }
  });

  if (Object.prototype.hasOwnProperty.call(source, 'enabled')) {
    parsed.enabled = source.enabled !== false;
  }
  parseStyleField(source, parsed, errors);
  return { parsed, errors };
};

const parseCityBuildingTypePayload = (body, { create = false } = {}) => {
  const source = body && typeof body === 'object' ? body : {};
  const parsed = {};
  const errors = [];

  const parseStringField = (key, { required = false, maxLen = 64 } = {}) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      if (required) errors.push(`缺少字段：${key}`);
      return;
    }
    const text = typeof source[key] === 'string' ? source[key].trim() : '';
    if (!text) {
      if (required) errors.push(`${key} 不能为空`);
      return;
    }
    if (text.length > maxLen) {
      errors.push(`${key} 过长`);
      return;
    }
    parsed[key] = text;
  };

  parseStringField('name', { required: create, maxLen: 64 });
  if (create) {
    parseStringField('buildingTypeId', { required: true, maxLen: 64 });
    if (parsed.buildingTypeId && !CATALOG_ID_RE.test(parsed.buildingTypeId)) {
      errors.push('buildingTypeId 仅支持字母、数字、下划线、中划线，长度 2-64');
    }
  }

  [
    ['initialCount', true, 0],
    ['radius', false, 0.1],
    ['level', true, 1],
    ['upgradeCostKP', false, 0],
    ['sortOrder', true, null]
  ].forEach(([key, integer, min]) => {
    const result = parseNumberField({
      body: source,
      key,
      required: create && ['initialCount', 'radius'].includes(key),
      integer,
      min
    });
    if (result.error) {
      errors.push(result.error);
      return;
    }
    if (!result.skip) {
      parsed[key] = result.value;
    }
  });

  if (Object.prototype.hasOwnProperty.call(source, 'nextUnitTypeId')) {
    parsed.nextUnitTypeId = typeof source.nextUnitTypeId === 'string' ? source.nextUnitTypeId.trim() : '';
  }
  if (Object.prototype.hasOwnProperty.call(source, 'enabled')) {
    parsed.enabled = source.enabled !== false;
  }
  parseStyleField(source, parsed, errors);
  return { parsed, errors };
};

// 获取用户分页列表（包括明文密码）
router.get('/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const page = toSafeInteger(req.query?.page, 1, { min: 1, max: 1000000 });
    const pageSize = toSafeInteger(req.query?.pageSize, 50, { min: 1, max: 200 });
    const keyword = typeof req.query?.keyword === 'string' ? req.query.keyword.trim() : '';
    const query = {};
    if (keyword) {
      const keywordRegex = new RegExp(escapeRegex(keyword), 'i');
      query.$or = [
        { username: keywordRegex },
        { profession: keywordRegex }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('+plainPassword')  // 包含明文密码
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),  // 转换为普通对象
      User.countDocuments(query)
    ]);

    // 返回所有字段
    const usersData = users.map(user => {
      const plainPassword = typeof user.plainPassword === 'string' ? user.plainPassword : '';
      return {
        _id: user._id,
        username: user.username,
        password: plainPassword,  // 明文密码（可能为空）
        passwordSaved: plainPassword.length > 0,
        hashedPassword: user.password,  // 哈希密码（如果你想看）
        level: user.level,
        knowledgeBalance: Number.isFinite(Number(user.knowledgeBalance)) ? Number(user.knowledgeBalance) : 0,
        experience: user.experience,
        profession: user.profession,
        ownedNodes: user.ownedNodes,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        __v: user.__v
      };
    });

    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;

    res.json({
      success: true,
      count: usersData.length,
      total,
      page,
      pageSize,
      totalPages,
      hasMore: page * pageSize < total,
      users: usersData,
      pagination: {
        page,
        pageSize,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('获取用户列表错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 修改用户信息（包括用户名和密码）
router.put('/users/:userId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, password, level, experience, knowledgeBalance } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 更新字段
    if (username !== undefined) {
      // 检查用户名是否已被其他用户使用
      const existingUser = await User.findOne({ 
        username, 
        _id: { $ne: userId } 
      });
      if (existingUser) {
        return res.status(400).json({ error: '用户名已被使用' });
      }
      user.username = username;
    }

    if (password !== undefined && password !== null) {
      const nextPassword = typeof password === 'string' ? password : String(password);
      const trimmedPassword = nextPassword.trim();

      // 兼容旧前端：当明文密码本来为空时，忽略占位文案“未保存”
      const isLegacyUnsavedPlaceholder = (
        nextPassword === '未保存' &&
        (!user.plainPassword || user.plainPassword === '')
      );

      // 留空表示不修改密码
      if (trimmedPassword !== '' && !isLegacyUnsavedPlaceholder) {
        if (nextPassword.length < 6) {
          return res.status(400).json({ error: '密码至少6个字符' });
        }

        // 保存明文密码和哈希密码
        user.plainPassword = nextPassword;
        user.password = await bcrypt.hash(nextPassword, 10);
      }
    }

    if (level !== undefined) {
      const parsedLevel = Number(level);
      if (!Number.isInteger(parsedLevel) || parsedLevel < 0) {
        return res.status(400).json({ error: '等级必须是大于等于0的整数' });
      }
      user.level = parsedLevel;
    }

    if (experience !== undefined) {
      const parsedExperience = Number(experience);
      if (!Number.isInteger(parsedExperience) || parsedExperience < 0) {
        return res.status(400).json({ error: '经验值必须是大于等于0的整数' });
      }
      user.experience = parsedExperience;
    }

    if (knowledgeBalance !== undefined) {
      const parsedKnowledgeBalance = Number(knowledgeBalance);
      if (!Number.isFinite(parsedKnowledgeBalance) || parsedKnowledgeBalance < 0) {
        return res.status(400).json({ error: '知识点余额必须是大于等于0的数字' });
      }
      user.knowledgeBalance = Number(parsedKnowledgeBalance.toFixed(2));
    }

    await user.save();

    res.json({
      success: true,
      message: '用户信息已更新',
      user: {
        _id: user._id,
        username: user.username,
        password: user.plainPassword,
        level: user.level,
        experience: user.experience,
        knowledgeBalance: Number.isFinite(Number(user.knowledgeBalance)) ? Number(user.knowledgeBalance) : 0,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('更新用户信息错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 删除用户
router.delete('/users/:userId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select('_id username allianceId');
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const allianceId = getIdString(user.allianceId);
    await User.deleteOne({ _id: user._id });
    await Node.updateMany(
      { domainMaster: user._id },
      { $set: { allianceId: null } }
    );

    if (allianceId) {
      const updatedAlliance = await EntropyAlliance.findOneAndUpdate(
        { _id: allianceId },
        { $inc: { memberCount: -1 } },
        { new: true }
      ).select('_id founder memberCount');

      if (updatedAlliance) {
        const normalizedMemberCount = Math.max(0, parseInt(updatedAlliance.memberCount, 10) || 0);
        if (normalizedMemberCount <= 0) {
          await Node.updateMany(
            { allianceId: updatedAlliance._id },
            { $set: { allianceId: null } }
          );
          await EntropyAlliance.deleteOne({ _id: updatedAlliance._id });
        } else if (getIdString(updatedAlliance.founder) === getIdString(user._id)) {
          const replacement = await User.findOne({ allianceId: updatedAlliance._id }).select('_id').lean();
          if (replacement?._id) {
            await EntropyAlliance.updateOne(
              { _id: updatedAlliance._id },
              { $set: { founder: replacement._id } }
            );
          } else {
            await Node.updateMany(
              { allianceId: updatedAlliance._id },
              { $set: { allianceId: null } }
            );
            await EntropyAlliance.deleteOne({ _id: updatedAlliance._id });
          }
        }
      }
    }

    res.json({
      success: true,
      message: '用户已删除',
      deletedUser: user.username
    });
  } catch (error) {
    console.error('删除用户错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取系统设置
router.get('/settings', authenticateToken, isAdmin, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json({
      success: true,
      settings: {
        travelUnitSeconds: settings.travelUnitSeconds,
        distributionAnnouncementLeadHours: settings.distributionAnnouncementLeadHours
      }
    });
  } catch (error) {
    console.error('获取系统设置错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 更新系统设置
router.put('/settings', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { travelUnitSeconds, distributionAnnouncementLeadHours } = req.body;
    const currentSettings = await getOrCreateSettings();
    const parsedTravel = travelUnitSeconds === undefined
      ? parseInt(currentSettings.travelUnitSeconds, 10)
      : parseInt(travelUnitSeconds, 10);
    const parsedLeadHours = distributionAnnouncementLeadHours === undefined
      ? parseInt(currentSettings.distributionAnnouncementLeadHours, 10)
      : parseInt(distributionAnnouncementLeadHours, 10);

    if (!Number.isInteger(parsedTravel) || parsedTravel < 1 || parsedTravel > 86400) {
      return res.status(400).json({ error: '每单位移动耗时必须是 1-86400 的整数秒' });
    }
    if (!Number.isInteger(parsedLeadHours) || parsedLeadHours < 1 || parsedLeadHours > 168) {
      return res.status(400).json({ error: '分发公告提前时长必须是 1-168 的整数小时' });
    }

    const settings = await GameSetting.findOneAndUpdate(
      { key: 'global' },
      { $set: { travelUnitSeconds: parsedTravel, distributionAnnouncementLeadHours: parsedLeadHours } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      message: '系统设置已更新',
      settings: {
        travelUnitSeconds: settings.travelUnitSeconds,
        distributionAnnouncementLeadHours: settings.distributionAnnouncementLeadHours
      }
    });
  } catch (error) {
    console.error('更新系统设置错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/army/unit-types', authenticateToken, isAdmin, async (req, res) => {
  try {
    const unitTypes = await fetchArmyUnitTypes();
    return res.json({
      success: true,
      unitTypes
    });
  } catch (error) {
    console.error('获取兵种列表失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/army/unit-types', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { parsed, errors } = parseUnitTypePayload(req.body, { create: true });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const exists = await ArmyUnitType.findOne({ unitTypeId: parsed.unitTypeId }).select('_id').lean();
    if (exists) {
      return res.status(400).json({ error: 'unitTypeId 已存在' });
    }

    if (!Object.prototype.hasOwnProperty.call(parsed, 'sortOrder')) {
      parsed.sortOrder = await ArmyUnitType.countDocuments();
    }

    const created = await ArmyUnitType.create(parsed);
    return res.status(201).json({
      success: true,
      unitType: serializeArmyUnitType(created)
    });
  } catch (error) {
    console.error('创建兵种失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.put('/army/unit-types/:unitTypeId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const unitTypeId = typeof req.params?.unitTypeId === 'string' ? req.params.unitTypeId.trim() : '';
    if (!unitTypeId) {
      return res.status(400).json({ error: '无效的兵种ID' });
    }

    const { parsed, errors } = parseUnitTypePayload(req.body, { create: false });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const updateKeys = Object.keys(parsed).filter((key) => key !== 'unitTypeId');
    if (updateKeys.length === 0) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }

    const updated = await ArmyUnitType.findOneAndUpdate(
      { unitTypeId },
      { $set: parsed },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: '兵种不存在' });
    }

    return res.json({
      success: true,
      unitType: serializeArmyUnitType(updated)
    });
  } catch (error) {
    console.error('更新兵种失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.delete('/army/unit-types/:unitTypeId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const unitTypeId = typeof req.params?.unitTypeId === 'string' ? req.params.unitTypeId.trim() : '';
    if (!unitTypeId) {
      return res.status(400).json({ error: '无效的兵种ID' });
    }

    const total = await ArmyUnitType.countDocuments();
    if (total <= 1) {
      return res.status(400).json({ error: '至少需要保留一个兵种' });
    }

    const deleted = await ArmyUnitType.findOneAndDelete({ unitTypeId });
    if (!deleted) {
      return res.status(404).json({ error: '兵种不存在' });
    }

    return res.json({
      success: true,
      message: '兵种已删除'
    });
  } catch (error) {
    console.error('删除兵种失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/catalog/items', authenticateToken, isAdmin, async (req, res) => {
  try {
    const items = await fetchBattlefieldItems();
    return res.json({
      success: true,
      items
    });
  } catch (error) {
    console.error('获取物品目录失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/catalog/items', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { parsed, errors } = parseBattlefieldItemPayload(req.body, { create: true });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const exists = await BattlefieldItem.findOne({ itemId: parsed.itemId }).select('_id').lean();
    if (exists) {
      return res.status(400).json({ error: 'itemId 已存在' });
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, 'sortOrder')) {
      parsed.sortOrder = await BattlefieldItem.countDocuments();
    }

    const created = await BattlefieldItem.create(parsed);
    return res.status(201).json({
      success: true,
      item: serializeBattlefieldItem(created)
    });
  } catch (error) {
    console.error('创建物品失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.put('/catalog/items/:itemId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const itemId = typeof req.params?.itemId === 'string' ? req.params.itemId.trim() : '';
    if (!itemId) {
      return res.status(400).json({ error: '无效的物品ID' });
    }
    const { parsed, errors } = parseBattlefieldItemPayload(req.body, { create: false });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }
    const updateKeys = Object.keys(parsed);
    if (updateKeys.length === 0) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }
    const updated = await BattlefieldItem.findOneAndUpdate(
      { itemId },
      { $set: parsed },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: '物品不存在' });
    }
    return res.json({
      success: true,
      item: serializeBattlefieldItem(updated)
    });
  } catch (error) {
    console.error('更新物品失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.delete('/catalog/items/:itemId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const itemId = typeof req.params?.itemId === 'string' ? req.params.itemId.trim() : '';
    if (!itemId) {
      return res.status(400).json({ error: '无效的物品ID' });
    }
    const total = await BattlefieldItem.countDocuments();
    if (total <= 1) {
      return res.status(400).json({ error: '至少需要保留一个物品' });
    }
    const deleted = await BattlefieldItem.findOneAndDelete({ itemId });
    if (!deleted) {
      return res.status(404).json({ error: '物品不存在' });
    }
    return res.json({
      success: true,
      message: '物品已删除'
    });
  } catch (error) {
    console.error('删除物品失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/catalog/buildings', authenticateToken, isAdmin, async (req, res) => {
  try {
    const buildings = await fetchCityBuildingTypes();
    return res.json({
      success: true,
      buildings
    });
  } catch (error) {
    console.error('获取建筑目录失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/catalog/buildings', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { parsed, errors } = parseCityBuildingTypePayload(req.body, { create: true });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }
    const exists = await CityBuildingType.findOne({ buildingTypeId: parsed.buildingTypeId }).select('_id').lean();
    if (exists) {
      return res.status(400).json({ error: 'buildingTypeId 已存在' });
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, 'sortOrder')) {
      parsed.sortOrder = await CityBuildingType.countDocuments();
    }
    const created = await CityBuildingType.create(parsed);
    return res.status(201).json({
      success: true,
      building: serializeCityBuildingType(created)
    });
  } catch (error) {
    console.error('创建建筑失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.put('/catalog/buildings/:buildingTypeId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const buildingTypeId = typeof req.params?.buildingTypeId === 'string' ? req.params.buildingTypeId.trim() : '';
    if (!buildingTypeId) {
      return res.status(400).json({ error: '无效的建筑ID' });
    }
    const { parsed, errors } = parseCityBuildingTypePayload(req.body, { create: false });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }
    const updateKeys = Object.keys(parsed);
    if (updateKeys.length === 0) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }
    const updated = await CityBuildingType.findOneAndUpdate(
      { buildingTypeId },
      { $set: parsed },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: '建筑不存在' });
    }
    return res.json({
      success: true,
      building: serializeCityBuildingType(updated)
    });
  } catch (error) {
    console.error('更新建筑失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.delete('/catalog/buildings/:buildingTypeId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const buildingTypeId = typeof req.params?.buildingTypeId === 'string' ? req.params.buildingTypeId.trim() : '';
    if (!buildingTypeId) {
      return res.status(400).json({ error: '无效的建筑ID' });
    }
    const total = await CityBuildingType.countDocuments();
    if (total <= 1) {
      return res.status(400).json({ error: '至少需要保留一个建筑' });
    }
    const deleted = await CityBuildingType.findOneAndDelete({ buildingTypeId });
    if (!deleted) {
      return res.status(404).json({ error: '建筑不存在' });
    }
    return res.json({
      success: true,
      message: '建筑已删除'
    });
  } catch (error) {
    console.error('删除建筑失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
