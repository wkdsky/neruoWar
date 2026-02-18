const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const GameSetting = require('../models/GameSetting');
const ArmyUnitType = require('../models/ArmyUnitType');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');
const {
  fetchArmyUnitTypes,
  serializeArmyUnitType
} = require('../services/armyUnitTypeService');

const getOrCreateSettings = async () => GameSetting.findOneAndUpdate(
  { key: 'global' },
  { $setOnInsert: { travelUnitSeconds: 60, distributionAnnouncementLeadHours: 24 } },
  { new: true, upsert: true, setDefaultsOnInsert: true }
);

const UNIT_TYPE_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;
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

// 获取所有用户的完整信息（包括明文密码）
router.get('/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .select('+plainPassword')  // 包含明文密码
      .sort({ createdAt: -1 })
      .lean();  // 转换为普通对象

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
        experience: user.experience,
        profession: user.profession,
        ownedNodes: user.ownedNodes,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        __v: user.__v
      };
    });

    res.json({
      success: true,
      count: usersData.length,
      users: usersData
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
    const { username, password, level, experience } = req.body;

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
      user.level = level;
    }

    if (experience !== undefined) {
      user.experience = experience;
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
    
    const user = await User.findByIdAndDelete(userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
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

module.exports = router;
