const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Node = require('../models/Node');
const EntropyAlliance = require('../models/EntropyAlliance');
const GameSetting = require('../models/GameSetting');
const ArmyUnitType = require('../models/ArmyUnitType');
const UnitComponent = require('../models/UnitComponent');
const BattlefieldItem = require('../models/BattlefieldItem');
const CityBuildingType = require('../models/CityBuildingType');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');
const {
  serializeArmyUnitType
} = require('../services/armyUnitTypeService');
const { fetchUnitTypesWithComponents, serializeUnitComponent } = require('../services/unitRegistryService');
const {
  fetchBattlefieldItems,
  fetchCityBuildingTypes,
  serializeBattlefieldItem,
  serializeCityBuildingType
} = require('../services/placeableCatalogService');
const {
  DEFAULT_STAR_MAP_NODE_LIMIT,
  getOrCreateSettings
} = require('../services/gameSettingsService');

const UNIT_TYPE_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;
const CATALOG_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;
const ROLE_TAG_SET = new Set(['近战', '远程']);
const RPS_TYPE_SET = new Set(['mobility', 'ranged', 'defense']);
const RARITY_SET = new Set(['common', 'rare', 'epic', 'legend']);
const COMPONENT_KIND_SET = new Set(['body', 'weapon', 'vehicle', 'ability', 'behaviorProfile', 'stabilityProfile', 'staggerReaction', 'interactionRule']);

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

  if (Object.prototype.hasOwnProperty.call(source, 'enabled')) {
    parsed.enabled = !!source.enabled;
  } else if (create) {
    parsed.enabled = true;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'rpsType')) {
    const rpsType = typeof source.rpsType === 'string' ? source.rpsType.trim() : '';
    if (!RPS_TYPE_SET.has(rpsType)) {
      errors.push('rpsType 必须是 mobility/ranged/defense');
    } else {
      parsed.rpsType = rpsType;
    }
  } else if (create) {
    errors.push('缺少字段：rpsType');
  }

  if (Object.prototype.hasOwnProperty.call(source, 'professionId')) {
    const professionId = typeof source.professionId === 'string' ? source.professionId.trim() : '';
    if (!professionId) {
      errors.push('professionId 不能为空');
    } else if (professionId.length > 64) {
      errors.push('professionId 过长');
    } else {
      parsed.professionId = professionId;
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, 'tier') || Object.prototype.hasOwnProperty.call(source, 'level')) {
    const tierValue = Object.prototype.hasOwnProperty.call(source, 'tier') ? source.tier : source.level;
    const tier = Math.floor(Number(tierValue));
    if (!Number.isInteger(tier) || tier < 1 || tier > 4) {
      errors.push('tier 必须是 1-4 的整数');
    } else {
      parsed.tier = tier;
      parsed.level = tier;
    }
  } else if (create) {
    parsed.tier = 1;
    parsed.level = 1;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'rarity')) {
    const rarity = typeof source.rarity === 'string' ? source.rarity.trim() : '';
    if (!RARITY_SET.has(rarity)) {
      errors.push('rarity 必须是 common/rare/epic/legend');
    } else {
      parsed.rarity = rarity;
    }
  } else if (create) {
    parsed.rarity = 'common';
  }

  if (Object.prototype.hasOwnProperty.call(source, 'tags')) {
    if (!Array.isArray(source.tags)) {
      errors.push('tags 必须是字符串数组');
    } else {
      parsed.tags = source.tags
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, 64);
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, 'description')) {
    const description = typeof source.description === 'string' ? source.description.trim() : '';
    parsed.description = description.slice(0, 1024);
  }

  const parseOptionalId = (key) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return;
    const text = typeof source[key] === 'string' ? source[key].trim() : '';
    parsed[key] = text || null;
  };

  parseOptionalId('bodyId');
  parseOptionalId('vehicleId');
  parseOptionalId('behaviorProfileId');
  parseOptionalId('stabilityProfileId');

  if (Object.prototype.hasOwnProperty.call(source, 'weaponIds')) {
    if (!Array.isArray(source.weaponIds)) {
      errors.push('weaponIds 必须是字符串数组');
    } else {
      parsed.weaponIds = source.weaponIds
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean)
        .slice(0, 16);
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, 'abilityIds')) {
    if (!Array.isArray(source.abilityIds)) {
      errors.push('abilityIds 必须是字符串数组');
    } else {
      parsed.abilityIds = source.abilityIds
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean)
        .slice(0, 16);
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, 'visuals')) {
    const visuals = source.visuals;
    if (!visuals || typeof visuals !== 'object' || Array.isArray(visuals)) {
      errors.push('visuals 必须是对象');
    } else {
      const battle = visuals.battle && typeof visuals.battle === 'object' ? visuals.battle : {};
      const preview = visuals.preview && typeof visuals.preview === 'object' ? visuals.preview : {};
      parsed.visuals = {
        battle: {
          bodyLayer: Math.max(0, Math.floor(Number(battle.bodyLayer) || 0)),
          gearLayer: Math.max(0, Math.floor(Number(battle.gearLayer) || 0)),
          vehicleLayer: Math.max(0, Math.floor(Number(battle.vehicleLayer) || 0)),
          tint: Number.isFinite(Number(battle.tint)) ? Number(battle.tint) : 0,
          silhouetteLayer: Math.max(0, Math.floor(Number(battle.silhouetteLayer) || 0))
        },
        preview: {
          style: typeof preview.style === 'string' && preview.style.trim() ? preview.style.trim() : 'procedural',
          palette: {
            primary: typeof preview?.palette?.primary === 'string' ? preview.palette.primary : '#5aa3ff',
            secondary: typeof preview?.palette?.secondary === 'string' ? preview.palette.secondary : '#cfd8e3',
            accent: typeof preview?.palette?.accent === 'string' ? preview.palette.accent : '#ffd166'
          }
        }
      };
    }
  }

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

  if (Object.prototype.hasOwnProperty.call(parsed, 'tier')) {
    parsed.level = parsed.tier;
  } else if (Object.prototype.hasOwnProperty.call(parsed, 'level')) {
    parsed.tier = Math.max(1, Math.floor(Number(parsed.level) || 1));
    parsed.level = parsed.tier;
  }

  return { parsed, errors };
};

const parseUnitComponentPayload = (body, { create = false } = {}) => {
  const source = body && typeof body === 'object' ? body : {};
  const parsed = {};
  const errors = [];
  if (create) {
    const componentId = typeof source.componentId === 'string' ? source.componentId.trim() : '';
    if (!componentId || !UNIT_TYPE_ID_RE.test(componentId)) {
      errors.push('componentId 仅支持字母、数字、下划线、中划线，长度 2-64');
    } else {
      parsed.componentId = componentId;
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, 'kind')) {
    const kind = typeof source.kind === 'string' ? source.kind.trim() : '';
    if (!COMPONENT_KIND_SET.has(kind)) {
      errors.push('kind 不合法');
    } else {
      parsed.kind = kind;
    }
  } else if (create) {
    errors.push('缺少字段：kind');
  }
  if (Object.prototype.hasOwnProperty.call(source, 'name')) {
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (!name) {
      errors.push('name 不能为空');
    } else {
      parsed.name = name.slice(0, 64);
    }
  } else if (create) {
    errors.push('缺少字段：name');
  }
  if (Object.prototype.hasOwnProperty.call(source, 'tags')) {
    if (!Array.isArray(source.tags)) {
      errors.push('tags 必须是字符串数组');
    } else {
      parsed.tags = source.tags
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, 64);
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, 'data')) {
    if (!source.data || typeof source.data !== 'object' || Array.isArray(source.data)) {
      errors.push('data 必须是对象');
    } else {
      parsed.data = source.data;
    }
  } else if (create) {
    parsed.data = {};
  }
  if (Object.prototype.hasOwnProperty.call(source, 'version')) {
    const version = Math.floor(Number(source.version));
    if (!Number.isInteger(version) || version < 1) {
      errors.push('version 必须是 >=1 的整数');
    } else {
      parsed.version = version;
    }
  } else if (create) {
    parsed.version = 1;
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
  if (Object.prototype.hasOwnProperty.call(source, 'description')) {
    parsed.description = typeof source.description === 'string' ? source.description.trim().slice(0, 2048) : '';
  }

  const parseMixedObjectField = (key) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return;
    const value = source[key];
    if (value === null) {
      parsed[key] = null;
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${key} 必须是对象`);
      return;
    }
    parsed[key] = value;
  };

  const parseMixedArrayField = (key, maxLen = 64) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return;
    if (!Array.isArray(source[key])) {
      errors.push(`${key} 必须是数组`);
      return;
    }
    parsed[key] = source[key]
      .filter((row) => row && typeof row === 'object')
      .slice(0, maxLen);
  };

  parseMixedObjectField('collider');
  parseMixedObjectField('renderProfile');
  parseMixedArrayField('interactions', 64);
  parseMixedArrayField('sockets', 64);

  if (Object.prototype.hasOwnProperty.call(source, 'maxStack')) {
    if (source.maxStack === null || source.maxStack === '') {
      parsed.maxStack = null;
    } else {
      const value = Math.floor(Number(source.maxStack));
      if (!Number.isFinite(value) || value < 1 || value > 31) {
        errors.push('maxStack 必须是 1-31 或 null');
      } else {
        parsed.maxStack = value;
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, 'requiresSupport')) {
    parsed.requiresSupport = !!source.requiresSupport;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'snapPriority')) {
    const value = Number(source.snapPriority);
    if (!Number.isFinite(value)) {
      errors.push('snapPriority 必须是数字');
    } else {
      parsed.snapPriority = value;
    }
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
        distributionAnnouncementLeadHours: settings.distributionAnnouncementLeadHours,
        starMapNodeLimit: settings.starMapNodeLimit
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
    const { travelUnitSeconds, distributionAnnouncementLeadHours, starMapNodeLimit } = req.body;
    const currentSettings = await getOrCreateSettings();
    const parsedTravel = travelUnitSeconds === undefined
      ? parseInt(currentSettings.travelUnitSeconds, 10)
      : parseInt(travelUnitSeconds, 10);
    const parsedLeadHours = distributionAnnouncementLeadHours === undefined
      ? parseInt(currentSettings.distributionAnnouncementLeadHours, 10)
      : parseInt(distributionAnnouncementLeadHours, 10);
    const parsedStarMapNodeLimit = starMapNodeLimit === undefined
      ? parseInt(currentSettings.starMapNodeLimit ?? DEFAULT_STAR_MAP_NODE_LIMIT, 10)
      : parseInt(starMapNodeLimit, 10);

    if (!Number.isInteger(parsedTravel) || parsedTravel < 1 || parsedTravel > 86400) {
      return res.status(400).json({ error: '每单位移动耗时必须是 1-86400 的整数秒' });
    }
    if (!Number.isInteger(parsedLeadHours) || parsedLeadHours < 1 || parsedLeadHours > 168) {
      return res.status(400).json({ error: '分发公告提前时长必须是 1-168 的整数小时' });
    }
    if (!Number.isInteger(parsedStarMapNodeLimit) || parsedStarMapNodeLimit < 10 || parsedStarMapNodeLimit > 200) {
      return res.status(400).json({ error: '星盘节点上限必须是 10-200 的整数' });
    }

    const settings = await GameSetting.findOneAndUpdate(
      { key: 'global' },
      { $set: { travelUnitSeconds: parsedTravel, distributionAnnouncementLeadHours: parsedLeadHours, starMapNodeLimit: parsedStarMapNodeLimit } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      message: '系统设置已更新',
      settings: {
        travelUnitSeconds: settings.travelUnitSeconds,
        distributionAnnouncementLeadHours: settings.distributionAnnouncementLeadHours,
        starMapNodeLimit: settings.starMapNodeLimit
      }
    });
  } catch (error) {
    console.error('更新系统设置错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/army/unit-types', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { unitTypes } = await fetchUnitTypesWithComponents({ enabledOnly: false });
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

router.get('/unit-components', authenticateToken, isAdmin, async (req, res) => {
  try {
    const docs = await UnitComponent.find({}).sort({ kind: 1, componentId: 1, createdAt: 1 }).lean();
    return res.json({
      success: true,
      unitComponents: docs.map(serializeUnitComponent)
    });
  } catch (error) {
    console.error('获取组件库失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/unit-components', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { parsed, errors } = parseUnitComponentPayload(req.body, { create: true });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }
    const exists = await UnitComponent.findOne({ componentId: parsed.componentId }).select('_id').lean();
    if (exists) {
      return res.status(400).json({ error: 'componentId 已存在' });
    }
    const created = await UnitComponent.create(parsed);
    return res.status(201).json({
      success: true,
      unitComponent: serializeUnitComponent(created)
    });
  } catch (error) {
    console.error('创建组件失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.put('/unit-components/:componentId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const componentId = typeof req.params?.componentId === 'string' ? req.params.componentId.trim() : '';
    if (!componentId) {
      return res.status(400).json({ error: '无效的 componentId' });
    }
    const { parsed, errors } = parseUnitComponentPayload(req.body, { create: false });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }
    const updateKeys = Object.keys(parsed).filter((key) => key !== 'componentId');
    if (updateKeys.length <= 0) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }
    const updated = await UnitComponent.findOneAndUpdate(
      { componentId },
      { $set: parsed },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: '组件不存在' });
    }
    return res.json({
      success: true,
      unitComponent: serializeUnitComponent(updated)
    });
  } catch (error) {
    console.error('更新组件失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.delete('/unit-components/:componentId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const componentId = typeof req.params?.componentId === 'string' ? req.params.componentId.trim() : '';
    if (!componentId) {
      return res.status(400).json({ error: '无效的 componentId' });
    }
    const deleted = await UnitComponent.findOneAndDelete({ componentId });
    if (!deleted) {
      return res.status(404).json({ error: '组件不存在' });
    }
    return res.json({
      success: true,
      message: '组件已删除'
    });
  } catch (error) {
    console.error('删除组件失败:', error);
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
