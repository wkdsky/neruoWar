const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Node = require('../models/Node');
const User = require('../models/User');
const EntropyAlliance = require('../models/EntropyAlliance');
const KnowledgeDistributionService = require('../services/KnowledgeDistributionService');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const isDomainMaster = (node, userId) => {
  const masterId = getIdString(node?.domainMaster);
  const currentUserId = getIdString(userId);
  return !!masterId && !!currentUserId && masterId === currentUserId;
};

const isDomainAdmin = (node, userId) => {
  const currentUserId = getIdString(userId);
  if (!currentUserId || !Array.isArray(node?.domainAdmins)) return false;
  return node.domainAdmins.some((adminId) => getIdString(adminId) === currentUserId);
};

const DOMAIN_CARD_SELECT = '_id name description knowledgePoint contentScore';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const VISUAL_PATTERN_TYPES = ['none', 'dots', 'grid', 'diagonal', 'rings', 'noise'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const normalizeHexColor = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return HEX_COLOR_RE.test(normalized) ? normalized.toLowerCase() : fallback;
};

const normalizePatternType = (value, fallback = 'diagonal') => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return VISUAL_PATTERN_TYPES.includes(normalized) ? normalized : fallback;
};

const toPlainObject = (value) => (
  value && typeof value.toObject === 'function'
    ? value.toObject()
    : value
);

const normalizeVisualStyleForNode = (style = {}, fallbackFlag = '#7c3aed') => ({
  name: typeof style?.name === 'string' ? style.name : '默认风格',
  primaryColor: normalizeHexColor(style?.primaryColor, normalizeHexColor(fallbackFlag, '#7c3aed')),
  secondaryColor: normalizeHexColor(style?.secondaryColor, '#334155'),
  glowColor: normalizeHexColor(style?.glowColor, '#c084fc'),
  rimColor: normalizeHexColor(style?.rimColor, '#f5d0fe'),
  textColor: normalizeHexColor(style?.textColor, '#ffffff'),
  patternType: normalizePatternType(style?.patternType, 'diagonal')
});

const resolveAllianceActiveStyle = (alliance) => {
  if (!alliance) return null;
  const styleList = Array.isArray(alliance.visualStyles) ? alliance.visualStyles : [];
  if (styleList.length === 0) {
    return normalizeVisualStyleForNode({
      name: '默认风格',
      primaryColor: alliance.flag || '#7c3aed',
      secondaryColor: '#334155',
      glowColor: '#c084fc',
      rimColor: '#f5d0fe',
      textColor: '#ffffff',
      patternType: 'diagonal'
    }, alliance.flag);
  }
  const activeId = getIdString(alliance.activeVisualStyleId);
  const active = styleList.find((styleItem) => getIdString(styleItem?._id) === activeId) || styleList[0];
  return normalizeVisualStyleForNode(active, alliance.flag);
};

const attachVisualStyleToNodeList = async (nodes = []) => {
  const plainNodes = (nodes || []).map(toPlainObject).filter(Boolean);
  if (plainNodes.length === 0) return [];

  const nodeKeyByIndex = new Map();
  const nodeAllianceIdByKey = new Map();
  const allianceById = new Map();
  const unresolvedNodeAllianceIds = new Set();

  const domainMasterIds = new Set();
  const allianceByMasterId = new Map();

  plainNodes.forEach((nodeItem, index) => {
    const nodeKey = getIdString(nodeItem?._id) || `idx_${index}`;
    nodeKeyByIndex.set(index, nodeKey);

    const nodeAllianceValue = nodeItem?.allianceId;
    const nodeAllianceId = getIdString(
      nodeAllianceValue && typeof nodeAllianceValue === 'object'
        ? nodeAllianceValue._id
        : nodeAllianceValue
    );
    if (isValidObjectId(nodeAllianceId)) {
      nodeAllianceIdByKey.set(nodeKey, nodeAllianceId);
      if (nodeAllianceValue && typeof nodeAllianceValue === 'object') {
        allianceById.set(nodeAllianceId, toPlainObject(nodeAllianceValue));
      } else {
        unresolvedNodeAllianceIds.add(nodeAllianceId);
      }
    }

    const domainMasterValue = nodeItem.domainMaster;
    const domainMasterId = getIdString(
      domainMasterValue && typeof domainMasterValue === 'object'
        ? domainMasterValue._id
        : domainMasterValue
    );
    if (!isValidObjectId(domainMasterId)) return;
    domainMasterIds.add(domainMasterId);

    if (domainMasterValue && typeof domainMasterValue === 'object') {
      const allianceRef = domainMasterValue.alliance || domainMasterValue.allianceId;
      if (allianceRef && typeof allianceRef === 'object') {
        allianceByMasterId.set(domainMasterId, toPlainObject(allianceRef));
      }
    }
  });

  const unresolvedNodeAllianceIdList = Array.from(unresolvedNodeAllianceIds).filter((id) => !allianceById.has(id));
  if (unresolvedNodeAllianceIdList.length > 0) {
    const directAlliances = await EntropyAlliance.find({ _id: { $in: unresolvedNodeAllianceIdList } })
      .select('name flag visualStyles activeVisualStyleId')
      .lean();
    directAlliances.forEach((allianceItem) => {
      const allianceId = getIdString(allianceItem?._id);
      if (allianceId) {
        allianceById.set(allianceId, allianceItem);
      }
    });
  }

  const unresolvedMasterIds = Array.from(domainMasterIds).filter((id) => !allianceByMasterId.has(id));
  if (unresolvedMasterIds.length > 0) {
    const masters = await User.find({ _id: { $in: unresolvedMasterIds } })
      .select('_id allianceId')
      .lean();
    const unresolvedAllianceIds = Array.from(new Set(
      masters.map((userItem) => getIdString(userItem.allianceId)).filter((id) => isValidObjectId(id))
    ));
    let allianceMap = new Map();
    if (unresolvedAllianceIds.length > 0) {
      const alliances = await EntropyAlliance.find({ _id: { $in: unresolvedAllianceIds } })
        .select('name flag visualStyles activeVisualStyleId')
        .lean();
      allianceMap = new Map(alliances.map((allianceItem) => [getIdString(allianceItem._id), allianceItem]));
    }
    masters.forEach((masterItem) => {
      const masterId = getIdString(masterItem._id);
      const allianceId = getIdString(masterItem.allianceId);
      if (masterId && allianceMap.has(allianceId)) {
        const resolvedAlliance = allianceMap.get(allianceId);
        allianceByMasterId.set(masterId, resolvedAlliance);
        if (allianceId) {
          allianceById.set(allianceId, resolvedAlliance);
        }
      }
    });
  }

  return plainNodes.map((nodeItem, index) => {
    const nodeKey = nodeKeyByIndex.get(index);
    const nodeAllianceId = nodeAllianceIdByKey.get(nodeKey) || '';
    let alliance = nodeAllianceId ? (allianceById.get(nodeAllianceId) || null) : null;

    const domainMasterId = getIdString(
      nodeItem.domainMaster && typeof nodeItem.domainMaster === 'object'
        ? nodeItem.domainMaster._id
        : nodeItem.domainMaster
    );
    if (!alliance) {
      alliance = allianceByMasterId.get(domainMasterId) || null;
    }
    if (!alliance) {
      return {
        ...nodeItem,
        visualStyle: null
      };
    }
    const style = resolveAllianceActiveStyle(alliance);
    return {
      ...nodeItem,
      visualStyle: {
        ...style,
        allianceId: getIdString(alliance._id) || nodeAllianceId,
        allianceName: alliance.name || '',
        styleId: getIdString(alliance.activeVisualStyleId) || ''
      }
    };
  });
};

const clampPercent = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
};

const round2 = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
};

const normalizePercentUserRules = (items = []) => {
  const result = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    const userId = getIdString(item?.userId);
    if (!isValidObjectId(userId) || seen.has(userId)) continue;
    seen.add(userId);
    result.push({
      userId,
      percent: clampPercent(item?.percent, 0)
    });
  }
  return result;
};

const normalizePercentAllianceRules = (items = []) => {
  const result = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    const allianceId = getIdString(item?.allianceId);
    if (!isValidObjectId(allianceId) || seen.has(allianceId)) continue;
    seen.add(allianceId);
    result.push({
      allianceId,
      percent: clampPercent(item?.percent, 0)
    });
  }
  return result;
};

const normalizeObjectIdArray = (items = []) => {
  const result = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    const id = getIdString(item);
    if (!isValidObjectId(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const normalizeScheduleSlots = (items = []) => {
  const result = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    const weekday = parseInt(item?.weekday, 10);
    const hour = parseInt(item?.hour, 10);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const key = `${weekday}-${hour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ weekday, hour });
  }
  return result;
};

const sanitizeDistributionRuleInput = (rawRule = {}) => ({
  enabled: !!rawRule?.enabled,
  distributionScope: rawRule?.distributionScope === 'partial' ? 'partial' : 'all',
  distributionPercent: clampPercent(rawRule?.distributionPercent, 100),
  masterPercent: clampPercent(rawRule?.masterPercent, 10),
  adminPercents: normalizePercentUserRules(rawRule?.adminPercents),
  customUserPercents: normalizePercentUserRules(rawRule?.customUserPercents),
  nonHostileAlliancePercent: clampPercent(rawRule?.nonHostileAlliancePercent, 0),
  specificAlliancePercents: normalizePercentAllianceRules(rawRule?.specificAlliancePercents),
  noAlliancePercent: clampPercent(rawRule?.noAlliancePercent, 0),
  blacklistUserIds: normalizeObjectIdArray(
    rawRule?.blacklistUserIds ||
    (Array.isArray(rawRule?.blacklistUsers) ? rawRule.blacklistUsers.map((item) => item?.userId || item?._id || item) : [])
  ),
  blacklistAllianceIds: normalizeObjectIdArray(
    rawRule?.blacklistAllianceIds ||
    (Array.isArray(rawRule?.blacklistAlliances) ? rawRule.blacklistAlliances.map((item) => item?.allianceId || item?._id || item) : [])
  )
});

const sanitizeDistributionScheduleInput = (rawSchedule = []) => normalizeScheduleSlots(rawSchedule);

const sanitizeDistributionRuleProfileInput = (rawProfile = {}, index = 0) => {
  const source = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
  const profileId = typeof source.profileId === 'string' && source.profileId.trim()
    ? source.profileId.trim()
    : `rule_${Date.now()}_${index + 1}`;
  const name = typeof source.name === 'string' && source.name.trim()
    ? source.name.trim()
    : `规则${index + 1}`;
  const ruleSource = source.rule && typeof source.rule === 'object' ? source.rule : source;
  return {
    profileId,
    name,
    rule: sanitizeDistributionRuleInput(ruleSource)
  };
};

const collectRuleUserIds = (rule = {}) => Array.from(new Set([
  ...(Array.isArray(rule?.adminPercents) ? rule.adminPercents.map((item) => getIdString(item?.userId)) : []),
  ...(Array.isArray(rule?.customUserPercents) ? rule.customUserPercents.map((item) => getIdString(item?.userId)) : []),
  ...(Array.isArray(rule?.blacklistUserIds) ? rule.blacklistUserIds.map((item) => getIdString(item)) : [])
].filter((id) => isValidObjectId(id))));

const loadCommonUserIdSet = async (userIds = []) => {
  const targetIds = Array.from(new Set((Array.isArray(userIds) ? userIds : [])
    .map((id) => getIdString(id))
    .filter((id) => isValidObjectId(id))));
  if (targetIds.length === 0) return new Set();
  const commonUsers = await User.find({
    _id: { $in: targetIds },
    role: 'common'
  }).select('_id').lean();
  return new Set(commonUsers.map((item) => getIdString(item._id)).filter((id) => isValidObjectId(id)));
};

const filterRuleUsersByAllowedSet = (rule = {}, allowedUserIdSet = new Set()) => ({
  ...rule,
  adminPercents: (Array.isArray(rule?.adminPercents) ? rule.adminPercents : [])
    .filter((item) => allowedUserIdSet.has(getIdString(item?.userId))),
  customUserPercents: (Array.isArray(rule?.customUserPercents) ? rule.customUserPercents : [])
    .filter((item) => allowedUserIdSet.has(getIdString(item?.userId))),
  blacklistUserIds: (Array.isArray(rule?.blacklistUserIds) ? rule.blacklistUserIds : [])
    .map((item) => getIdString(item))
    .filter((id) => allowedUserIdSet.has(id))
});

const computeDistributionPercentSummary = (rule = {}, allianceContributionPercent = 0) => {
  const x = clampPercent(rule?.masterPercent, 10);
  const y = (Array.isArray(rule?.adminPercents) ? rule.adminPercents : [])
    .reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const z = clampPercent(allianceContributionPercent, 0);
  const b = (Array.isArray(rule?.customUserPercents) ? rule.customUserPercents : [])
    .reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const d = clampPercent(rule?.nonHostileAlliancePercent, 0);
  const e = (Array.isArray(rule?.specificAlliancePercents) ? rule.specificAlliancePercents : [])
    .reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const f = clampPercent(rule?.noAlliancePercent, 0);
  const total = x + y + z + b + d + e + f;
  return {
    x: round2(x),
    y: round2(y),
    z: round2(z),
    b: round2(b),
    d: round2(d),
    e: round2(e),
    f: round2(f),
    total: round2(total)
  };
};

const serializeDistributionRule = (rule = {}) => ({
  enabled: !!rule?.enabled,
  distributionScope: rule?.distributionScope === 'partial' ? 'partial' : 'all',
  distributionPercent: round2(clampPercent(rule?.distributionPercent, 100)),
  masterPercent: round2(clampPercent(rule?.masterPercent, 10)),
  adminPercents: (Array.isArray(rule?.adminPercents) ? rule.adminPercents : []).map((item) => ({
    userId: getIdString(item?.userId),
    percent: round2(clampPercent(item?.percent, 0))
  })),
  customUserPercents: (Array.isArray(rule?.customUserPercents) ? rule.customUserPercents : []).map((item) => ({
    userId: getIdString(item?.userId),
    percent: round2(clampPercent(item?.percent, 0))
  })),
  nonHostileAlliancePercent: round2(clampPercent(rule?.nonHostileAlliancePercent, 0)),
  specificAlliancePercents: (Array.isArray(rule?.specificAlliancePercents) ? rule.specificAlliancePercents : []).map((item) => ({
    allianceId: getIdString(item?.allianceId),
    percent: round2(clampPercent(item?.percent, 0))
  })),
  noAlliancePercent: round2(clampPercent(rule?.noAlliancePercent, 0)),
  blacklistUserIds: (Array.isArray(rule?.blacklistUserIds) ? rule.blacklistUserIds : []).map((item) => getIdString(item)).filter(Boolean),
  blacklistAllianceIds: (Array.isArray(rule?.blacklistAllianceIds) ? rule.blacklistAllianceIds : []).map((item) => getIdString(item)).filter(Boolean)
});

const serializeDistributionSchedule = (schedule = []) => (
  Array.isArray(schedule) ? schedule.map((item) => ({
    weekday: parseInt(item?.weekday, 10),
    hour: parseInt(item?.hour, 10)
  })).filter((item) => Number.isInteger(item.weekday) && Number.isInteger(item.hour)) : []
);

const serializeDistributionRuleProfile = (profile = {}) => ({
  profileId: typeof profile?.profileId === 'string' ? profile.profileId : '',
  name: typeof profile?.name === 'string' ? profile.name : '',
  rule: serializeDistributionRule(profile?.rule || {})
});

const serializeDistributionLock = (locked = null) => {
  if (!locked) return null;
  return {
    executeAt: locked.executeAt || null,
    announcedAt: locked.announcedAt || null,
    projectedTotal: round2(Number(locked.projectedTotal) || 0),
    projectedDistributableTotal: round2(Number(locked.projectedDistributableTotal) || 0),
    masterAllianceId: getIdString(locked.masterAllianceId) || '',
    masterAllianceName: locked.masterAllianceName || '',
    allianceContributionPercent: round2(clampPercent(locked.allianceContributionPercent, 0)),
    distributionScope: locked?.distributionScope === 'partial' ? 'partial' : 'all',
    distributionPercent: round2(clampPercent(locked?.distributionPercent, 100)),
    ruleProfileId: typeof locked.ruleProfileId === 'string' ? locked.ruleProfileId : '',
    ruleProfileName: typeof locked.ruleProfileName === 'string' ? locked.ruleProfileName : '',
    enemyAllianceIds: (Array.isArray(locked.enemyAllianceIds) ? locked.enemyAllianceIds : []).map((item) => getIdString(item)).filter(Boolean),
    ruleSnapshot: serializeDistributionRule(locked.ruleSnapshot || {})
  };
};

const parseDistributionExecuteAtHour = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (parsed.getMinutes() !== 0 || parsed.getSeconds() !== 0 || parsed.getMilliseconds() !== 0) {
    return null;
  }
  return parsed;
};

const extractDistributionProfilesFromNode = (node) => {
  const inputProfiles = Array.isArray(node?.knowledgeDistributionRuleProfiles)
    ? node.knowledgeDistributionRuleProfiles
    : [];
  const profiles = inputProfiles
    .map((profile, index) => sanitizeDistributionRuleProfileInput(profile, index))
    .filter((profile, index, arr) => profile.profileId && arr.findIndex((item) => item.profileId === profile.profileId) === index);

  if (profiles.length === 0) {
    profiles.push({
      profileId: 'default',
      name: '默认规则',
      rule: sanitizeDistributionRuleInput(node?.knowledgeDistributionRule || {})
    });
  }

  const rawActiveRuleId = typeof node?.knowledgeDistributionActiveRuleId === 'string'
    ? node.knowledgeDistributionActiveRuleId.trim()
    : '';
  const activeRuleId = profiles.some((profile) => profile.profileId === rawActiveRuleId)
    ? rawActiveRuleId
    : profiles[0].profileId;
  const scheduleSlots = serializeDistributionSchedule(
    Array.isArray(node?.knowledgeDistributionScheduleSlots) && node.knowledgeDistributionScheduleSlots.length > 0
      ? node.knowledgeDistributionScheduleSlots
      : node?.knowledgeDistributionRule?.scheduleSlots
  );

  return {
    profiles,
    activeRuleId,
    scheduleSlots
  };
};

// 搜索节点
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) {
      return res.status(400).json({ error: '搜索关键词不能为空' });
    }

    const nodes = await Node.find({
      $or: [
        { name: { $regex: keyword, $options: 'i' } },
        { description: { $regex: keyword, $options: 'i' } }
      ],
      status: 'approved'
    }).select('name description _id');

    res.json(nodes);
  } catch (error) {
    console.error('搜索节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 创建节点（普通用户需要申请，管理员直接创建）
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { name, description, position, associations, forceCreate } = req.body;

    // 验证必填字段
    if (!name || !description) {
      return res.status(400).json({ error: '标题和简介不能为空' });
    }

    // 检查标题唯一性（只检查已审核通过的节点）
    const existingApprovedNode = await Node.findOne({ name, status: 'approved' });
    if (existingApprovedNode) {
      return res.status(400).json({ error: '该节点标题已被使用（已有同名的审核通过节点）' });
    }

    // 检查用户是否为管理员
    const user = await User.findById(req.user.userId);
    const isUserAdmin = user.role === 'admin';

    // 如果是管理员，检查是否有同名的待审核节点
    if (isUserAdmin && !forceCreate) {
      const pendingNodesWithSameName = await Node.find({ name, status: 'pending' })
        .populate('owner', 'username profession')
        .populate('associations.targetNode', 'name');

      if (pendingNodesWithSameName.length > 0) {
        // 返回待审核节点信息，让管理员选择
        return res.status(409).json({
          error: 'PENDING_NODES_EXIST',
          message: '已有用户提交了同名节点的申请，请先处理这些申请',
          pendingNodes: pendingNodesWithSameName
        });
      }
    }

    // 验证关联关系（普通用户必须至少有一个关联关系）
    if (!isUserAdmin && (!associations || associations.length === 0)) {
      return res.status(400).json({ error: '普通用户创建节点必须至少有一个关联关系' });
    }

    // 验证：检查是否有重复的目标节点（一个节点不能既被包含又被拓展）
    if (associations && associations.length > 0) {
      const targetNodeIds = associations.map(a => a.targetNode.toString());
      const uniqueTargetNodes = new Set(targetNodeIds);
      if (targetNodeIds.length !== uniqueTargetNodes.size) {
        return res.status(400).json({
          error: '关联关系错误：同一个节点只能有一种关联关系（拓展或包含），不能同时存在两种关系。'
        });
      }
    }

    // 填充关联母域和关联子域
    let relatedParentDomains = [];
    let relatedChildDomains = [];

    if (associations && associations.length > 0) {
      // 获取所有关联节点的详细信息
      const targetNodeIds = associations.map(a => a.targetNode);
      const targetNodes = await Node.find({ _id: { $in: targetNodeIds } });

      // 创建节点ID到节点名称的映射
      const nodeMap = {};
      targetNodes.forEach(node => {
        nodeMap[node._id.toString()] = node.name;
      });

      // 根据关联类型分类
      associations.forEach(association => {
        const targetNodeName = nodeMap[association.targetNode.toString()];
        if (targetNodeName) {
          if (association.relationType === 'extends') {
            relatedParentDomains.push(targetNodeName);
          } else if (association.relationType === 'contains') {
            relatedChildDomains.push(targetNodeName);
          }
        }
      });
    }

    const nodeId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const node = new Node({
      nodeId,
      owner: req.user.userId,
      domainMaster: isUserAdmin ? null : req.user.userId, // 管理员创建默认无域主，普通用户创建默认自己为域主
      allianceId: isUserAdmin ? null : (user.allianceId || null),
      name,
      description,
      position,
      associations: associations || [],
      relatedParentDomains,
      relatedChildDomains,
      status: isUserAdmin ? 'approved' : 'pending',
      contentScore: 1 // 新建节点默认内容分数为1
    });

    await node.save();

    // 双向同步：更新被关联节点的relatedParentDomains和relatedChildDomains
    if (associations && associations.length > 0 && (isUserAdmin || node.status === 'approved')) {
      const targetNodeIds = associations.map(a => a.targetNode);
      const targetNodes = await Node.find({ _id: { $in: targetNodeIds } });

      for (const association of associations) {
        const targetNode = targetNodes.find(n => n._id.toString() === association.targetNode.toString());
        if (targetNode) {
          if (association.relationType === 'contains') {
            // 当前节点包含目标节点 -> 目标节点的relatedParentDomains应加入当前节点
            if (!targetNode.relatedParentDomains.includes(node.name)) {
              targetNode.relatedParentDomains.push(node.name);
              await targetNode.save();
            }
          } else if (association.relationType === 'extends') {
            // 当前节点拓展目标节点 -> 目标节点的relatedChildDomains应加入当前节点
            if (!targetNode.relatedChildDomains.includes(node.name)) {
              targetNode.relatedChildDomains.push(node.name);
              await targetNode.save();
            }
          }
        }
      }
    }

    // 如果是管理员直接创建，更新用户拥有的节点列表
    if (isUserAdmin) {
      await User.findByIdAndUpdate(req.user.userId, {
        $push: { ownedNodes: node._id }
      });
    }

    res.status(201).json(node);
  } catch (error) {
    console.error('创建节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取待审批节点列表
router.get('/pending', authenticateToken, isAdmin, async (req, res) => {
  try {
    const nodes = await Node.find({ status: 'pending' })
      .populate('owner', 'username profession')
      .populate('associations.targetNode', 'name description');
    res.json(nodes);
  } catch (error) {
    console.error('获取待审批节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 审批节点
router.post('/approve', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const node = await Node.findById(nodeId).populate('associations.targetNode', 'name');

    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 检查是否已有同名的已审核节点
    const existingApproved = await Node.findOne({ name: node.name, status: 'approved' });
    if (existingApproved) {
      return res.status(400).json({ error: '已存在同名的审核通过节点，无法批准此申请' });
    }

    // 填充关联母域和关联子域
    let relatedParentDomains = [];
    let relatedChildDomains = [];

    if (node.associations && node.associations.length > 0) {
      node.associations.forEach(association => {
        if (association.targetNode && association.targetNode.name) {
          if (association.relationType === 'extends') {
            relatedParentDomains.push(association.targetNode.name);
          } else if (association.relationType === 'contains') {
            relatedChildDomains.push(association.targetNode.name);
          }
        }
      });
    }

    node.status = 'approved';
    node.relatedParentDomains = relatedParentDomains;
    node.relatedChildDomains = relatedChildDomains;
    const owner = await User.findById(node.owner).select('role allianceId');
    if (owner?.role === 'admin') {
      node.domainMaster = null;
      node.allianceId = null;
    } else if (node.domainMaster) {
      const currentMaster = await User.findById(node.domainMaster).select('role allianceId');
      if (!currentMaster || currentMaster.role === 'admin') {
        node.domainMaster = null;
        node.allianceId = null;
      } else {
        node.allianceId = currentMaster.allianceId || null;
      }
    } else {
      node.allianceId = null;
    }
    // 设置默认内容分数为1
    node.contentScore = 1;
    await node.save();

    // 自动拒绝其他同名的待审核节点
    const rejectedNodes = await Node.find({
      name: node.name,
      status: 'pending',
      _id: { $ne: node._id }
    }).populate('owner', 'username');

    const rejectedInfo = [];
    for (const rejectedNode of rejectedNodes) {
      rejectedInfo.push({
        id: rejectedNode._id,
        owner: rejectedNode.owner?.username || '未知用户'
      });
      // 删除被拒绝的节点
      await Node.findByIdAndDelete(rejectedNode._id);
    }

    // 双向同步：更新被关联节点的relatedParentDomains和relatedChildDomains
    if (node.associations && node.associations.length > 0) {
      for (const association of node.associations) {
        const targetNode = await Node.findById(association.targetNode._id || association.targetNode);
        if (targetNode) {
          if (association.relationType === 'contains') {
            // 当前节点包含目标节点 -> 目标节点的relatedParentDomains应加入当前节点
            if (!targetNode.relatedParentDomains.includes(node.name)) {
              targetNode.relatedParentDomains.push(node.name);
              await targetNode.save();
            }
          } else if (association.relationType === 'extends') {
            // 当前节点拓展目标节点 -> 目标节点的relatedChildDomains应加入当前节点
            if (!targetNode.relatedChildDomains.includes(node.name)) {
              targetNode.relatedChildDomains.push(node.name);
              await targetNode.save();
            }
          }
        }
      }
    }

    // 更新用户拥有的节点列表
    await User.findByIdAndUpdate(node.owner, {
      $push: { ownedNodes: node._id }
    });

    res.json({
      ...node.toObject(),
      autoRejectedCount: rejectedInfo.length,
      autoRejectedNodes: rejectedInfo
    });
  } catch (error) {
    console.error('审批节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 拒绝节点（直接删除）
router.post('/reject', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.body;
    
    const node = await Node.findByIdAndDelete(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 从用户拥有的节点列表中移除（如果已添加）
    await User.findByIdAndUpdate(node.owner, {
      $pull: { ownedNodes: nodeId }
    });

    res.json({
      success: true,
      message: '节点申请已被拒绝并删除',
      deletedNode: node.name
    });
  } catch (error) {
    console.error('拒绝节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 关联节点
router.post('/associate', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (node.owner.toString() === req.user.userId) {
      return res.status(400).json({ error: '不能关联自己创建的节点' });
    }
    node.status = 'pending';
    // 重置内容分数为1（关联节点视为新节点）
    node.contentScore = 1;
    await node.save();
    res.status(200).json(node);
  } catch (error) {
    console.error('关联节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 审批节点关联
router.post('/approve-association', authenticateToken, async (req, res) => {
  try {
    const { nodeId, isParent } = req.body;
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (isParent) {
      node.parentNode = req.user.userId;
    } else {
      node.childNodes.push(req.user.userId);
    }
    node.status = 'approved';
    await node.save();
    res.status(200).json(node);
  } catch (error) {
    console.error('审批节点关联错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 拒绝节点关联
router.post('/reject-association', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    node.status = 'rejected';
    await node.save();
    res.status(200).json(node);
  } catch (error) {
    console.error('拒绝节点关联错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取所有节点（管理员专用）
router.get('/', authenticateToken, isAdmin, async (req, res) => {
  try {
    const nodes = await Node.find()
      .populate('owner', 'username profession')
      .populate('domainMaster', 'username profession')
      .populate('associations.targetNode', 'name description')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: nodes.length,
      nodes: nodes
    });
  } catch (error) {
    console.error('获取节点列表错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 更新节点信息（管理员专用）
router.put('/:nodeId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { name, description, prosperity, contentScore } = req.body;

    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 更新字段
    if (name !== undefined) {
      // 检查名称唯一性（只检查已审核通过的节点，排除当前节点）
      const existingNode = await Node.findOne({
        name,
        status: 'approved',
        _id: { $ne: nodeId }
      });
      if (existingNode) {
        return res.status(400).json({ error: '该名称已被其他审核通过的节点使用' });
      }
      node.name = name;
    }

    if (description !== undefined) {
      node.description = description;
    }

    if (prosperity !== undefined) {
      node.prosperity = prosperity;
    }

    if (contentScore !== undefined) {
      // 验证内容分数至少为1
      if (contentScore < 1) {
        return res.status(400).json({ error: '内容分数至少为1' });
      }
      node.contentScore = contentScore;
    }

    await node.save();

    res.json({
      success: true,
      message: '节点信息已更新',
      node: node
    });
  } catch (error) {
    console.error('更新节点信息错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 删除节点（管理员专用）
router.delete('/:nodeId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;

    // 先获取节点信息（删除前需要知道节点名称）
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    const nodeName = node.name;

    // 清理所有关联：从所有引用了这个节点的节点中移除
    // 1. 移除所有relatedParentDomains中包含此节点名称的记录
    await Node.updateMany(
      { relatedParentDomains: nodeName },
      { $pull: { relatedParentDomains: nodeName } }
    );

    // 2. 移除所有relatedChildDomains中包含此节点名称的记录
    await Node.updateMany(
      { relatedChildDomains: nodeName },
      { $pull: { relatedChildDomains: nodeName } }
    );

    // 3. 移除所有associations中引用此节点的记录
    await Node.updateMany(
      { 'associations.targetNode': nodeId },
      { $pull: { associations: { targetNode: nodeId } } }
    );

    // 删除节点
    await Node.findByIdAndDelete(nodeId);

    // 从用户拥有的节点列表中移除
    await User.findByIdAndUpdate(node.owner, {
      $pull: { ownedNodes: nodeId }
    });

    res.json({
      success: true,
      message: '节点已删除，所有关联已清理',
      deletedNode: nodeName
    });
  } catch (error) {
    console.error('删除节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取单个节点（需要身份验证）
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const node = await Node.updateKnowledgePoint(req.params.id);
    if (!node) {
      return res.status(404).json({ message: '节点不存在' });
    }
    
    // 检查用户是否有权访问此节点
    const user = await User.findById(req.user.userId);
    const isOwner = node.owner.toString() === req.user.userId;
    const isAdmin = user.role === 'admin';
    
    // 只有节点所有者或管理员可以查看未审批节点
    if (node.status !== 'approved' && !isOwner && !isAdmin) {
      return res.status(403).json({ message: '无权访问此节点' });
    }
    
    res.json(node);
  } catch (err) {
    console.error('获取节点错误:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 编辑节点关联关系（管理员专用）
router.put('/:nodeId/associations', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { associations } = req.body; // 新的关联关系数组

    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 验证：检查是否有重复的目标节点（一个节点不能既被包含又被拓展）
    if (associations && associations.length > 0) {
      const targetNodeIds = associations.map(a => a.targetNode.toString());
      const uniqueTargetNodes = new Set(targetNodeIds);
      if (targetNodeIds.length !== uniqueTargetNodes.size) {
        return res.status(400).json({
          error: '关联关系错误：同一个节点只能有一种关联关系（拓展或包含），不能同时存在两种关系。'
        });
      }
    }

    const nodeName = node.name;
    const oldAssociations = node.associations || [];

    // 第一步：清理旧的双向关联
    for (const oldAssoc of oldAssociations) {
      const targetNode = await Node.findById(oldAssoc.targetNode);
      if (targetNode) {
        if (oldAssoc.relationType === 'contains') {
          // 从目标节点的relatedParentDomains中移除当前节点
          targetNode.relatedParentDomains = targetNode.relatedParentDomains.filter(
            name => name !== nodeName
          );
          await targetNode.save();
        } else if (oldAssoc.relationType === 'extends') {
          // 从目标节点的relatedChildDomains中移除当前节点
          targetNode.relatedChildDomains = targetNode.relatedChildDomains.filter(
            name => name !== nodeName
          );
          await targetNode.save();
        }
      }
    }

    // 第二步：更新当前节点的关联关系和域列表
    let relatedParentDomains = [];
    let relatedChildDomains = [];

    if (associations && associations.length > 0) {
      const targetNodeIds = associations.map(a => a.targetNode);
      const targetNodes = await Node.find({ _id: { $in: targetNodeIds } });

      const nodeMap = {};
      targetNodes.forEach(n => {
        nodeMap[n._id.toString()] = n.name;
      });

      associations.forEach(association => {
        const targetNodeName = nodeMap[association.targetNode.toString()];
        if (targetNodeName) {
          if (association.relationType === 'extends') {
            relatedParentDomains.push(targetNodeName);
          } else if (association.relationType === 'contains') {
            relatedChildDomains.push(targetNodeName);
          }
        }
      });
    }

    node.associations = associations || [];
    node.relatedParentDomains = relatedParentDomains;
    node.relatedChildDomains = relatedChildDomains;
    await node.save();

    // 第三步：建立新的双向关联
    if (associations && associations.length > 0) {
      for (const association of associations) {
        const targetNode = await Node.findById(association.targetNode);
        if (targetNode) {
          if (association.relationType === 'contains') {
            // 当前节点包含目标节点 -> 目标节点的relatedParentDomains应加入当前节点
            if (!targetNode.relatedParentDomains.includes(nodeName)) {
              targetNode.relatedParentDomains.push(nodeName);
              await targetNode.save();
            }
          } else if (association.relationType === 'extends') {
            // 当前节点拓展目标节点 -> 目标节点的relatedChildDomains应加入当前节点
            if (!targetNode.relatedChildDomains.includes(nodeName)) {
              targetNode.relatedChildDomains.push(nodeName);
              await targetNode.save();
            }
          }
        }
      }
    }

    res.json({
      success: true,
      message: '关联关系已更新',
      node: node
    });
  } catch (error) {
    console.error('编辑节点关联错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 设置/取消热门节点（管理员专用）
router.put('/:nodeId/featured', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { isFeatured, featuredOrder } = req.body;

    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    node.isFeatured = isFeatured !== undefined ? isFeatured : node.isFeatured;
    if (featuredOrder !== undefined) {
      node.featuredOrder = featuredOrder;
    }

    await node.save();

    res.json({
      success: true,
      message: isFeatured ? '已设置为热门节点' : '已取消热门节点',
      node: node
    });
  } catch (error) {
    console.error('设置热门节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取根节点（所有用户可访问）
router.get('/public/root-nodes', async (req, res) => {
  try {
    // 查找所有已批准的节点
    const nodes = await Node.find({ status: 'approved' })
      .populate('owner', 'username profession')
      .select('name description relatedParentDomains relatedChildDomains knowledgePoint contentScore domainMaster allianceId');

    // 过滤出根节点（没有母节点的节点）
    const rootNodes = nodes.filter(node =>
      !node.relatedParentDomains || node.relatedParentDomains.length === 0
    );
    const styledRootNodes = await attachVisualStyleToNodeList(rootNodes);

    res.json({
      success: true,
      count: styledRootNodes.length,
      nodes: styledRootNodes
    });
  } catch (error) {
    console.error('获取根节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取热门节点（所有用户可访问）
router.get('/public/featured-nodes', async (req, res) => {
  try {
    const featuredNodes = await Node.find({
      status: 'approved',
      isFeatured: true
    })
      .populate('owner', 'username profession')
      .sort({ featuredOrder: 1, createdAt: -1 })
      .select('name description relatedParentDomains relatedChildDomains knowledgePoint contentScore isFeatured featuredOrder domainMaster allianceId');
    const styledFeaturedNodes = await attachVisualStyleToNodeList(featuredNodes);

    res.json({
      success: true,
      count: styledFeaturedNodes.length,
      nodes: styledFeaturedNodes
    });
  } catch (error) {
    console.error('获取热门节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 实时搜索节点（所有用户可访问）
router.get('/public/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === '') {
      return res.json({
        success: true,
        results: []
      });
    }

    // 分割关键词（按空格）
    const keywords = query.trim().split(/\s+/);

    // 查找所有已批准的节点
    const allNodes = await Node.find({ status: 'approved' })
      .populate('owner', 'username profession')
      .select('name description relatedParentDomains relatedChildDomains knowledgePoint contentScore');

    // 计算匹配度
    const searchResults = allNodes.map(node => {
      let matchCount = 0;
      const searchText = `${node.name} ${node.description}`.toLowerCase();

      keywords.forEach(keyword => {
        const lowerKeyword = keyword.toLowerCase();
        if (searchText.includes(lowerKeyword)) {
          matchCount++;
        }
      });

      return {
        node,
        matchCount
      };
    }).filter(item => item.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount)
      .map(item => item.node);

    res.json({
      success: true,
      count: searchResults.length,
      results: searchResults
    });
  } catch (error) {
    console.error('搜索节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取节点详细信息（所有用户可访问）
router.get('/public/node-detail/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;

    const node = await Node.findById(nodeId)
      .populate({
        path: 'owner',
        select: 'username profession avatar level role allianceId',
        populate: { path: 'allianceId', select: 'name flag visualStyles activeVisualStyleId' }
      })
      .populate({
        path: 'domainMaster',
        select: 'username profession avatar level allianceId',
        populate: { path: 'allianceId', select: 'name flag visualStyles activeVisualStyleId' }
      })
      .populate({
        path: 'domainAdmins',
        select: 'username profession avatar level allianceId',
        populate: { path: 'allianceId', select: 'name flag visualStyles activeVisualStyleId' }
      })
      .select('name description owner domainMaster domainAdmins allianceId relatedParentDomains relatedChildDomains knowledgePoint contentScore createdAt status');

    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    if (node.status !== 'approved') {
      return res.status(403).json({ error: '该节点未审批' });
    }

    // 获取关联的母域节点信息（ID和名称）
    const parentNodes = await Node.find({
      name: { $in: node.relatedParentDomains },
      status: 'approved'
    }).select('_id name description knowledgePoint contentScore domainMaster allianceId');

    // 获取关联的子域节点信息（ID和名称）
    const childNodes = await Node.find({
      name: { $in: node.relatedChildDomains },
      status: 'approved'
    }).select('_id name description knowledgePoint contentScore domainMaster allianceId');

    const normalizeUserForNodeDetail = (user) => {
      if (!user) return null;
      const userObj = typeof user.toObject === 'function' ? user.toObject() : user;
      const allianceObj = userObj?.allianceId && typeof userObj.allianceId === 'object'
        ? userObj.allianceId
        : null;
      return {
        ...userObj,
        _id: getIdString(userObj._id),
        alliance: allianceObj
          ? {
              _id: getIdString(allianceObj._id),
              name: allianceObj.name || '',
              flag: allianceObj.flag || '',
              visualStyles: Array.isArray(allianceObj.visualStyles) ? allianceObj.visualStyles : [],
              activeVisualStyleId: getIdString(allianceObj.activeVisualStyleId)
            }
          : null
      };
    };

    const nodeObj = node.toObject();
    nodeObj.owner = normalizeUserForNodeDetail(node.owner);
    nodeObj.domainMaster = normalizeUserForNodeDetail(node.domainMaster);
    nodeObj.domainAdmins = Array.isArray(node.domainAdmins)
      ? node.domainAdmins.map(normalizeUserForNodeDetail).filter(Boolean)
      : [];
    const [styledNode] = await attachVisualStyleToNodeList([nodeObj]);
    const styledParentNodes = await attachVisualStyleToNodeList(parentNodes);
    const styledChildNodes = await attachVisualStyleToNodeList(childNodes);

    res.json({
      success: true,
      node: {
        ...(styledNode || nodeObj),
        parentNodesInfo: styledParentNodes,
        childNodesInfo: styledChildNodes
      }
    });
  } catch (error) {
    console.error('获取节点详情错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 公开接口：获取所有已批准的节点（用于构建导航路径）
router.get('/public/all-nodes', async (req, res) => {
  try {
    const nodes = await Node.find({ status: 'approved' })
      .select('_id name description relatedParentDomains relatedChildDomains')
      .lean();

    res.json({
      success: true,
      nodes: nodes
    });
  } catch (error) {
    console.error('获取所有节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员：更换节点域主
router.put('/admin/domain-master/:nodeId', authenticateToken, async (req, res) => {
  try {
    // 检查是否是管理员
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: '无权限执行此操作' });
    }

    const { nodeId } = req.params;
    const { domainMasterId } = req.body;

    // 查找节点
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    const resetDistributionOwnerBoundState = () => {
      node.knowledgeDistributionRule = {
        ...(node.knowledgeDistributionRule?.toObject?.() || node.knowledgeDistributionRule || {}),
        blacklistUserIds: [],
        blacklistAllianceIds: []
      };
      node.knowledgeDistributionRuleProfiles = (Array.isArray(node.knowledgeDistributionRuleProfiles)
        ? node.knowledgeDistributionRuleProfiles
        : []
      ).map((profile) => ({
        profileId: profile.profileId,
        name: profile.name,
        rule: {
          ...(profile?.rule?.toObject?.() || profile?.rule || {}),
          blacklistUserIds: [],
          blacklistAllianceIds: []
        }
      }));
      node.knowledgeDistributionLocked = null;
    };

    const currentMasterId = getIdString(node.domainMaster);

    // 如果domainMasterId为空或null，清除域主
    if (!domainMasterId) {
      node.domainMaster = null;
      node.allianceId = null;
      if (currentMasterId) {
        resetDistributionOwnerBoundState();
      }
      await node.save();
      return res.json({
        success: true,
        message: '域主已清除',
        node: await Node.findById(nodeId).populate('domainMaster', 'username profession')
      });
    }

    // 查找新域主用户
    const newMaster = await User.findById(domainMasterId).select('role allianceId');
    if (!newMaster) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (newMaster.role === 'admin') {
      return res.status(400).json({ error: '管理员不能作为域主' });
    }

    // 更新域主
    node.domainMaster = domainMasterId;
    node.allianceId = newMaster.allianceId || null;
    node.domainAdmins = (node.domainAdmins || []).filter((adminId) => (
      getIdString(adminId) !== getIdString(domainMasterId)
    ));
    if (currentMasterId !== getIdString(domainMasterId)) {
      resetDistributionOwnerBoundState();
    }
    await node.save();

    const updatedNode = await Node.findById(nodeId)
      .populate('domainMaster', 'username profession');

    res.json({
      success: true,
      message: '域主更换成功',
      node: updatedNode
    });
  } catch (error) {
    console.error('更换域主错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员：搜索用户（用于选择域主）
router.get('/admin/search-users', authenticateToken, async (req, res) => {
  try {
    // 检查是否是管理员
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: '无权限执行此操作' });
    }

    const { keyword } = req.query;

    let query = { role: { $ne: 'admin' } };
    if (keyword && keyword.trim()) {
      query = {
        role: { $ne: 'admin' },
        username: { $regex: keyword, $options: 'i' }
      };
    }

    const users = await User.find(query)
      .select('_id username level role')
      .limit(20)
      .sort({ username: 1 });

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('搜索用户错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取与当前用户相关的知识域（域主/普通管理员/收藏/最近访问）
router.get('/me/related-domains', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('favoriteDomains recentVisitedDomains');
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const userId = user._id;
    const [domainMasterDomains, domainAdminDomains] = await Promise.all([
      Node.find({ status: 'approved', domainMaster: userId })
        .select(DOMAIN_CARD_SELECT)
        .sort({ name: 1 })
        .lean(),
      Node.find({ status: 'approved', domainAdmins: userId, domainMaster: { $ne: userId } })
        .select(DOMAIN_CARD_SELECT)
        .sort({ name: 1 })
        .lean()
    ]);

    const favoriteDomainIds = (user.favoriteDomains || [])
      .map((id) => getIdString(id))
      .filter((id) => isValidObjectId(id));
    const favoriteNodes = favoriteDomainIds.length > 0
      ? await Node.find({ _id: { $in: favoriteDomainIds }, status: 'approved' })
          .select(DOMAIN_CARD_SELECT)
          .lean()
      : [];
    const favoriteNodeMap = new Map(favoriteNodes.map((node) => [getIdString(node._id), node]));
    const favoriteDomains = favoriteDomainIds
      .map((id) => favoriteNodeMap.get(id))
      .filter(Boolean);

    const recentEntries = (user.recentVisitedDomains || [])
      .filter((item) => item && item.nodeId)
      .sort((a, b) => new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime());
    const recentDomainIds = recentEntries
      .map((item) => getIdString(item.nodeId))
      .filter((id) => isValidObjectId(id));
    const recentNodes = recentDomainIds.length > 0
      ? await Node.find({ _id: { $in: recentDomainIds }, status: 'approved' })
          .select(DOMAIN_CARD_SELECT)
          .lean()
      : [];
    const recentNodeMap = new Map(recentNodes.map((node) => [getIdString(node._id), node]));
    const recentDomains = recentEntries
      .map((item) => {
        const nodeId = getIdString(item.nodeId);
        const node = recentNodeMap.get(nodeId);
        if (!node) return null;
        return {
          ...node,
          visitedAt: item.visitedAt
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      domainMasterDomains,
      domainAdminDomains,
      favoriteDomains,
      recentDomains
    });
  } catch (error) {
    console.error('获取相关知识域错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 收藏/取消收藏知识域（当前用户）
router.post('/:nodeId/favorite', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('_id status');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可收藏' });
    }

    const user = await User.findById(req.user.userId).select('favoriteDomains');
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const targetId = getIdString(node._id);
    const exists = (user.favoriteDomains || []).some((id) => getIdString(id) === targetId);

    if (exists) {
      user.favoriteDomains = (user.favoriteDomains || []).filter((id) => getIdString(id) !== targetId);
    } else {
      user.favoriteDomains = [node._id, ...(user.favoriteDomains || []).filter((id) => getIdString(id) !== targetId)];
      if (user.favoriteDomains.length > 100) {
        user.favoriteDomains = user.favoriteDomains.slice(0, 100);
      }
    }

    await user.save();

    res.json({
      success: true,
      isFavorite: !exists,
      message: exists ? '已取消收藏' : '已加入收藏'
    });
  } catch (error) {
    console.error('收藏知识域错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 记录最近访问知识域（当前用户）
router.post('/:nodeId/recent-visit', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('_id status');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可访问' });
    }

    const user = await User.findById(req.user.userId).select('recentVisitedDomains');
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const targetId = getIdString(node._id);
    const filtered = (user.recentVisitedDomains || []).filter((item) => getIdString(item?.nodeId) !== targetId);
    user.recentVisitedDomains = [
      { nodeId: node._id, visitedAt: new Date() },
      ...filtered
    ].slice(0, 50);

    await user.save();

    res.json({
      success: true
    });
  } catch (error) {
    console.error('记录最近访问知识域错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 普通用户申请成为无域主知识域的域主（提交给系统管理员审批）
router.post('/:nodeId/domain-master/apply', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }
    if (!reason) {
      return res.status(400).json({ error: '申请理由不能为空' });
    }
    if (reason.length > 300) {
      return res.status(400).json({ error: '申请理由不能超过300字' });
    }

    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }

    const requester = await User.findById(requestUserId).select('username role');
    if (!requester) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (requester.role !== 'common') {
      return res.status(403).json({ error: '仅普通用户可申请成为域主' });
    }

    const node = await Node.findById(nodeId).select('name status owner domainMaster allianceId');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可访问' });
    }

    if (node.domainMaster) {
      const currentMaster = await User.findById(node.domainMaster).select('role');
      if (!currentMaster || currentMaster.role === 'admin') {
        // 兼容历史数据：管理员或失效账号不应作为域主，自动清空
        node.domainMaster = null;
        node.allianceId = null;
        await node.save();
      } else {
        return res.status(400).json({ error: '该知识域已有域主，无法申请' });
      }
    }

    const owner = await User.findById(node.owner).select('role');
    if (!owner || owner.role !== 'admin') {
      return res.status(400).json({ error: '该知识域不支持域主申请' });
    }

    const adminUsers = await User.find({ role: 'admin' }).select('_id username notifications');
    if (!adminUsers.length) {
      return res.status(400).json({ error: '系统当前无可处理申请的管理员' });
    }

    const hasPendingRequest = adminUsers.some((adminUser) => (adminUser.notifications || []).some((notification) => (
      notification.type === 'domain_master_apply' &&
      notification.status === 'pending' &&
      getIdString(notification.nodeId) === nodeId &&
      getIdString(notification.inviteeId) === requestUserId
    )));

    if (hasPendingRequest) {
      return res.status(409).json({ error: '你已提交过该知识域域主申请，请等待管理员处理' });
    }

    for (const adminUser of adminUsers) {
      adminUser.notifications.unshift({
        type: 'domain_master_apply',
        title: `域主申请：${node.name}`,
        message: `${requester.username} 申请成为知识域「${node.name}」的域主`,
        read: false,
        status: 'pending',
        nodeId: node._id,
        nodeName: node.name,
        inviterId: requester._id,
        inviterUsername: requester.username,
        inviteeId: requester._id,
        inviteeUsername: requester.username,
        applicationReason: reason,
        createdAt: new Date()
      });
      await adminUser.save();
    }

    res.json({
      success: true,
      message: '域主申请已提交，等待管理员审核'
    });
  } catch (error) {
    console.error('申请成为域主错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 普通管理员申请卸任（提交给域主审批，3天超时自动同意）
router.post('/:nodeId/domain-admins/resign', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }

    const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }

    if (isDomainMaster(node, requestUserId)) {
      return res.status(400).json({ error: '域主无需申请卸任域相' });
    }

    if (!isDomainAdmin(node, requestUserId)) {
      return res.status(403).json({ error: '你不是该知识域域相' });
    }

    const requester = await User.findById(requestUserId).select('username role');
    if (!requester) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (requester.role !== 'common') {
      return res.status(403).json({ error: '仅普通用户可申请卸任域相' });
    }

    const domainMasterId = getIdString(node.domainMaster);
    if (!isValidObjectId(domainMasterId)) {
      node.domainAdmins = (node.domainAdmins || []).filter((adminId) => getIdString(adminId) !== requestUserId);
      await node.save();
      return res.json({
        success: true,
        message: '该知识域当前无域主，已自动卸任域相'
      });
    }

    const domainMaster = await User.findById(domainMasterId).select('username notifications');
    if (!domainMaster) {
      node.domainAdmins = (node.domainAdmins || []).filter((adminId) => getIdString(adminId) !== requestUserId);
      await node.save();
      return res.json({
        success: true,
        message: '域主信息缺失，已自动卸任域相'
      });
    }

    const hasPendingRequest = (domainMaster.notifications || []).some((notification) => (
      notification.type === 'domain_admin_resign_request' &&
      notification.status === 'pending' &&
      getIdString(notification.nodeId) === nodeId &&
      getIdString(notification.inviteeId) === requestUserId
    ));

    if (hasPendingRequest) {
      return res.status(409).json({ error: '你已提交过卸任申请，请等待域主处理' });
    }

    domainMaster.notifications.unshift({
      type: 'domain_admin_resign_request',
      title: `域相卸任申请：${node.name}`,
      message: `${requester.username} 申请卸任知识域「${node.name}」域相`,
      read: false,
      status: 'pending',
      nodeId: node._id,
      nodeName: node.name,
      inviteeId: requester._id,
      inviteeUsername: requester.username,
      createdAt: new Date()
    });
    await domainMaster.save();

    res.json({
      success: true,
      message: '卸任申请已提交给域主，3天内未处理将自动同意'
    });
  } catch (error) {
    console.error('申请卸任域相错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取知识域域相列表（域主可编辑，其他域相只读）
router.get('/:nodeId/domain-admins', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('name domainMaster domainAdmins');

    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    const currentUser = await User.findById(requestUserId).select('role');
    if (!currentUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const isSystemAdmin = currentUser.role === 'admin';
    const canEdit = isDomainMaster(node, requestUserId);
    const canView = canEdit || isDomainAdmin(node, requestUserId) || isSystemAdmin;

    if (!canView) {
      return res.status(403).json({ error: '无权限查看该知识域域相' });
    }

    const domainMasterId = getIdString(node.domainMaster);
    const domainAdminIds = (node.domainAdmins || [])
      .map((adminId) => getIdString(adminId))
      .filter((adminId) => isValidObjectId(adminId));

    const relatedUserIds = Array.from(new Set([domainMasterId, ...domainAdminIds].filter((id) => isValidObjectId(id))));
    const relatedUsers = relatedUserIds.length > 0
      ? await User.find({ _id: { $in: relatedUserIds } }).select('_id username profession role').lean()
      : [];
    const relatedUserMap = new Map(relatedUsers.map((userItem) => [getIdString(userItem._id), userItem]));

    const domainMasterUser = relatedUserMap.get(domainMasterId) || null;
    const admins = domainAdminIds
      .filter((adminId, index, arr) => adminId !== domainMasterId && arr.indexOf(adminId) === index)
      .map((adminId) => {
        const adminUser = relatedUserMap.get(adminId);
        if (!adminUser) return null;
        return {
          _id: getIdString(adminUser._id),
          username: adminUser.username,
          profession: adminUser.profession,
          role: adminUser.role
        };
      })
      .filter(Boolean);

    let pendingInvites = [];
    if (canEdit) {
      const pendingInviteUsers = await User.find({
        notifications: {
          $elemMatch: {
            type: 'domain_admin_invite',
            status: 'pending',
            nodeId: node._id,
            inviterId: requestUserId
          }
        }
      }).select('_id username profession notifications');

      pendingInvites = pendingInviteUsers
        .map((userItem) => {
          const inviteeId = getIdString(userItem._id);
          if (!inviteeId || inviteeId === domainMasterId || domainAdminIds.includes(inviteeId)) {
            return null;
          }
          const matchedInvite = (userItem.notifications || [])
            .filter((notification) => (
              notification.type === 'domain_admin_invite'
              && notification.status === 'pending'
              && getIdString(notification.nodeId) === nodeId
              && getIdString(notification.inviterId) === requestUserId
            ))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
          if (!matchedInvite) return null;
          return {
            inviteeId,
            username: userItem.username,
            profession: userItem.profession || '',
            notificationId: getIdString(matchedInvite._id),
            createdAt: matchedInvite.createdAt
          };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const canResign = !canEdit && !isSystemAdmin && isDomainAdmin(node, requestUserId);
    let resignPending = false;
    if (canResign && isValidObjectId(domainMasterId)) {
      const domainMaster = await User.findById(domainMasterId).select('notifications');
      resignPending = !!(domainMaster?.notifications || []).some((notification) => (
        notification.type === 'domain_admin_resign_request' &&
        notification.status === 'pending' &&
        getIdString(notification.nodeId) === nodeId &&
        getIdString(notification.inviteeId) === requestUserId
      ));
    }

    res.json({
      success: true,
      canView,
      canEdit,
      isSystemAdmin,
      canResign,
      resignPending,
      nodeId: node._id,
      nodeName: node.name,
      domainMaster: domainMasterUser
        ? {
            _id: getIdString(domainMasterUser._id),
            username: domainMasterUser.username,
            profession: domainMasterUser.profession
          }
        : null,
      domainAdmins: admins,
      pendingInvites
    });
  } catch (error) {
    console.error('获取知识域域相错误:', error);
    if (error?.name === 'CastError') {
      return res.status(400).json({ error: '数据格式错误，请检查用户或知识域数据' });
    }
    res.status(500).json({ error: `服务器错误: ${error?.name || 'Error'} ${error?.message || ''}`.trim() });
  }
});

// 域主搜索普通用户（用于邀请域相）
router.get('/:nodeId/domain-admins/search-users', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { keyword = '' } = req.query;
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('domainMaster domainAdmins');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    if (!isDomainMaster(node, req.user.userId)) {
      return res.status(403).json({ error: '只有域主可以邀请域相' });
    }

    const excludedIds = [getIdString(node.domainMaster), ...(node.domainAdmins || []).map((id) => getIdString(id))]
      .filter((id) => isValidObjectId(id));

    const query = {
      role: 'common',
      _id: { $nin: excludedIds },
      notifications: {
        $not: {
          $elemMatch: {
            type: 'domain_admin_invite',
            status: 'pending',
            nodeId: node._id,
            inviterId: req.user.userId
          }
        }
      }
    };

    if (keyword.trim()) {
      query.username = { $regex: keyword.trim(), $options: 'i' };
    }

    const users = await User.find(query)
      .select('_id username profession role')
      .sort({ username: 1 })
      .limit(20);

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('搜索知识域域相候选用户错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 域主邀请普通用户成为知识域域相
router.post('/:nodeId/domain-admins/invite', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { username } = req.body;
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    if (!normalizedUsername) {
      return res.status(400).json({ error: '用户名不能为空' });
    }

    const node = await Node.findById(nodeId).select('name domainMaster domainAdmins');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    if (!isDomainMaster(node, req.user.userId)) {
      return res.status(403).json({ error: '只有域主可以邀请域相' });
    }

    const inviter = await User.findById(req.user.userId).select('username');
    if (!inviter) {
      return res.status(404).json({ error: '邀请人不存在' });
    }

    const invitee = await User.findOne({ username: normalizedUsername, role: 'common' });
    if (!invitee) {
      return res.status(404).json({ error: '未找到可邀请的普通用户' });
    }

    if (invitee._id.toString() === req.user.userId) {
      return res.status(400).json({ error: '不能邀请自己' });
    }

    if (isDomainAdmin(node, invitee._id.toString())) {
      return res.status(400).json({ error: '该用户已经是此知识域域相' });
    }

    const hasPendingInvite = (invitee.notifications || []).some((notification) => (
      notification.type === 'domain_admin_invite' &&
      notification.status === 'pending' &&
      notification.nodeId &&
      notification.nodeId.toString() === node._id.toString()
    ));

    if (hasPendingInvite) {
      return res.status(409).json({ error: '该用户已有待处理邀请' });
    }

    invitee.notifications.unshift({
      type: 'domain_admin_invite',
      title: `域相邀请：${node.name}`,
      message: `${inviter.username} 邀请你成为知识域「${node.name}」的域相`,
      read: false,
      status: 'pending',
      nodeId: node._id,
      nodeName: node.name,
      inviterId: inviter._id,
      inviterUsername: inviter.username
    });
    await invitee.save();

    res.json({
      success: true,
      message: `已向 ${invitee.username} 发出邀请`
    });
  } catch (error) {
    console.error('邀请知识域域相错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 域主撤销待处理域相邀请
router.post('/:nodeId/domain-admins/invite/:notificationId/revoke', authenticateToken, async (req, res) => {
  try {
    const { nodeId, notificationId } = req.params;
    const inviterId = getIdString(req?.user?.userId);
    if (!isValidObjectId(nodeId) || !isValidObjectId(notificationId)) {
      return res.status(400).json({ error: '无效的知识域或邀请ID' });
    }

    const node = await Node.findById(nodeId).select('name domainMaster');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (!isDomainMaster(node, inviterId)) {
      return res.status(403).json({ error: '只有域主可以撤销域相邀请' });
    }

    const inviter = await User.findById(inviterId).select('_id username');
    if (!inviter) {
      return res.status(404).json({ error: '邀请人不存在' });
    }

    const invitee = await User.findOne({
      notifications: {
        $elemMatch: {
          _id: notificationId,
          type: 'domain_admin_invite',
          status: 'pending',
          nodeId: node._id,
          inviterId: inviter._id
        }
      }
    }).select('_id username notifications');

    if (!invitee) {
      return res.status(404).json({ error: '该邀请不存在或已处理，无法撤销' });
    }

    const inviteNotification = invitee.notifications.id(notificationId);
    if (!inviteNotification || inviteNotification.status !== 'pending') {
      return res.status(404).json({ error: '该邀请不存在或已处理，无法撤销' });
    }

    inviteNotification.status = 'rejected';
    inviteNotification.read = false;
    inviteNotification.title = `域相邀请已撤销：${node.name}`;
    inviteNotification.message = `${inviter.username} 已撤销你在知识域「${node.name}」的域相邀请`;
    inviteNotification.respondedAt = new Date();
    await invitee.save();

    res.json({
      success: true,
      message: `已撤销对 ${invitee.username} 的邀请`
    });
  } catch (error) {
    console.error('撤销域相邀请错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 域主移除知识域域相
router.delete('/:nodeId/domain-admins/:adminUserId', authenticateToken, async (req, res) => {
  try {
    const { nodeId, adminUserId } = req.params;
    if (!isValidObjectId(nodeId) || !isValidObjectId(adminUserId)) {
      return res.status(400).json({ error: '无效的用户或知识域ID' });
    }

    const node = await Node.findById(nodeId).select('name domainMaster domainAdmins');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    if (!isDomainMaster(node, req.user.userId)) {
      return res.status(403).json({ error: '只有域主可以编辑域相' });
    }

    if (node.domainMaster && node.domainMaster.toString() === adminUserId) {
      return res.status(400).json({ error: '不能移除域主' });
    }

    if (!isDomainAdmin(node, adminUserId)) {
      return res.status(404).json({ error: '该用户不是此知识域域相' });
    }

    node.domainAdmins = (node.domainAdmins || []).filter((id) => id.toString() !== adminUserId);
    await node.save();

    res.json({
      success: true,
      message: '已移除知识域域相'
    });
  } catch (error) {
    console.error('移除知识域域相错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取知识点分发规则（域主可编辑，域相/系统管理员可查看）
router.get('/:nodeId/distribution-settings', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select(
      'name status domainMaster domainAdmins knowledgePoint knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionActiveRuleId knowledgeDistributionScheduleSlots knowledgeDistributionLocked knowledgeDistributionCarryover'
    );
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }

    const currentUser = await User.findById(requestUserId).select('role');
    if (!currentUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const isSystemAdmin = currentUser.role === 'admin';
    const canEdit = isDomainMaster(node, requestUserId);
    const canView = canEdit || isDomainAdmin(node, requestUserId) || isSystemAdmin;
    if (!canView) {
      return res.status(403).json({ error: '无权限查看该知识域分发规则' });
    }

    const domainMasterId = getIdString(node.domainMaster);
    const { profiles, activeRuleId, scheduleSlots } = extractDistributionProfilesFromNode(node);
    const activeProfile = profiles.find((item) => item.profileId === activeRuleId) || profiles[0];
    const serializedProfiles = profiles.map((profile) => ({
      profileId: profile.profileId,
      name: profile.name,
      rule: serializeDistributionRule(profile.rule || {})
    }));
    const activeSerializedProfile = serializedProfiles.find((item) => item.profileId === activeRuleId) || serializedProfiles[0];
    const rulePayload = activeSerializedProfile?.rule || serializeDistributionRule(activeProfile?.rule || {});
    const lockPayload = serializeDistributionLock(node.knowledgeDistributionLocked || null);

    const relatedUserIds = new Set([
      ...serializedProfiles.flatMap((profile) => profile.rule.adminPercents.map((item) => item.userId)),
      ...serializedProfiles.flatMap((profile) => profile.rule.customUserPercents.map((item) => item.userId)),
      ...serializedProfiles.flatMap((profile) => profile.rule.blacklistUserIds),
      domainMasterId,
      ...(Array.isArray(node.domainAdmins) ? node.domainAdmins.map((id) => getIdString(id)) : [])
    ].filter((id) => isValidObjectId(id)));
    const relatedAllianceIds = new Set([
      ...profiles.flatMap((profile) => serializeDistributionRule(profile.rule || {}).specificAlliancePercents.map((item) => item.allianceId)),
      ...profiles.flatMap((profile) => serializeDistributionRule(profile.rule || {}).blacklistAllianceIds),
      ...(lockPayload?.enemyAllianceIds || [])
    ].filter((id) => isValidObjectId(id)));

    const [relatedUsers, masterUser] = await Promise.all([
      relatedUserIds.size > 0
        ? User.find({
            _id: { $in: Array.from(relatedUserIds) },
            role: 'common'
          }).select('_id username allianceId').lean()
        : [],
      isValidObjectId(domainMasterId)
        ? User.findById(domainMasterId).select('_id username allianceId').lean()
        : null
    ]);
    const relatedUserMap = new Map(relatedUsers.map((item) => [getIdString(item._id), item]));
    const commonUserIdSet = new Set(Array.from(relatedUserMap.keys()).filter((id) => isValidObjectId(id)));

    let masterAlliance = null;
    if (masterUser?.allianceId && isValidObjectId(getIdString(masterUser.allianceId))) {
      const allianceId = getIdString(masterUser.allianceId);
      relatedAllianceIds.add(allianceId);
      masterAlliance = await EntropyAlliance.findById(allianceId)
        .select('_id name knowledgeContributionPercent enemyAllianceIds')
        .lean();
    }

    const relatedAlliances = relatedAllianceIds.size > 0
      ? await EntropyAlliance.find({ _id: { $in: Array.from(relatedAllianceIds) } })
          .select('_id name')
          .lean()
      : [];
    const allianceMap = new Map(relatedAlliances.map((item) => [getIdString(item._id), item]));

    const enrichPercentUsers = (items = []) => items.map((item) => ({
      ...item,
      username: relatedUserMap.get(item.userId)?.username || ''
    }));
    const enrichPercentAlliances = (items = []) => items.map((item) => ({
      ...item,
      allianceName: allianceMap.get(item.allianceId)?.name || ''
    }));
    const enrichIdUsers = (items = []) => items.map((id) => ({
      userId: id,
      username: relatedUserMap.get(id)?.username || ''
    }));
    const enrichIdAlliances = (items = []) => items.map((id) => ({
      allianceId: id,
      allianceName: allianceMap.get(id)?.name || ''
    }));

    const allianceContributionPercent = round2(clampPercent(masterAlliance?.knowledgeContributionPercent || 0, 0));
    const enemyAllianceIds = (Array.isArray(masterAlliance?.enemyAllianceIds) ? masterAlliance.enemyAllianceIds : [])
      .map((item) => getIdString(item))
      .filter((id) => isValidObjectId(id));
    const hasMasterAlliance = !!masterAlliance;

    const normalizeAllianceScopedRule = (rule = {}) => (
      hasMasterAlliance
        ? rule
        : {
            ...rule,
            nonHostileAlliancePercent: 0,
            specificAlliancePercents: []
          }
    );

    const enrichRulePayload = (rule) => ({
      ...normalizeAllianceScopedRule(rule),
      adminPercents: enrichPercentUsers(rule.adminPercents),
      customUserPercents: enrichPercentUsers(rule.customUserPercents),
      specificAlliancePercents: hasMasterAlliance ? enrichPercentAlliances(rule.specificAlliancePercents) : [],
      blacklistUsers: enrichIdUsers(rule.blacklistUserIds),
      blacklistAlliances: enrichIdAlliances(rule.blacklistAllianceIds)
    });

    const profilePayloads = serializedProfiles.map((profile) => {
      const serializedRule = normalizeAllianceScopedRule(
        filterRuleUsersByAllowedSet(profile.rule, commonUserIdSet)
      );
      return {
        profileId: profile.profileId,
        name: profile.name,
        enabled: profile.profileId === activeRuleId,
        rule: enrichRulePayload(serializedRule),
        percentSummary: computeDistributionPercentSummary(serializedRule, allianceContributionPercent)
      };
    });
    const activeRulePayload = profilePayloads.find((item) => item.profileId === activeRuleId) || profilePayloads[0];

    res.json({
      success: true,
      canView,
      canEdit,
      isSystemAdmin,
      nodeId: node._id,
      nodeName: node.name,
      knowledgePointValue: round2(Number(node?.knowledgePoint?.value) || 0),
      carryoverValue: round2(Number(node?.knowledgeDistributionCarryover) || 0),
      masterAllianceId: masterAlliance ? getIdString(masterAlliance._id) : '',
      masterAllianceName: masterAlliance?.name || '',
      allianceContributionPercent,
      enemyAllianceIds,
      scheduleSlots,
      activeRuleId,
      activeRule: activeRulePayload || null,
      ruleProfiles: profilePayloads,
      rule: activeRulePayload?.rule || enrichRulePayload(
        normalizeAllianceScopedRule(filterRuleUsersByAllowedSet(rulePayload, commonUserIdSet))
      ),
      percentSummary: activeRulePayload?.percentSummary || computeDistributionPercentSummary(
        normalizeAllianceScopedRule(filterRuleUsersByAllowedSet(rulePayload, commonUserIdSet)),
        allianceContributionPercent
      ),
      locked: lockPayload,
      isRuleLocked: !!node.knowledgeDistributionLocked
    });
  } catch (error) {
    console.error('获取知识点分发规则错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 域主搜索用户（用于分发规则中的指定用户/黑名单）
router.get('/:nodeId/distribution-settings/search-users', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const keyword = typeof req.query?.keyword === 'string' ? req.query.keyword.trim() : '';
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('domainMaster');
    if (!node) {
      return res.status(404).json({ error: '知识域不存在' });
    }
    if (!isDomainMaster(node, req.user.userId)) {
      return res.status(403).json({ error: '只有域主可以搜索分发对象' });
    }

    const query = {
      role: 'common',
      _id: { $ne: node.domainMaster }
    };
    if (keyword) {
      query.username = { $regex: keyword, $options: 'i' };
    }

    const users = await User.find(query)
      .select('_id username profession allianceId')
      .sort({ username: 1 })
      .limit(20)
      .lean();

    res.json({
      success: true,
      users: users.map((userItem) => ({
        _id: getIdString(userItem._id),
        username: userItem.username || '',
        profession: userItem.profession || '',
        allianceId: getIdString(userItem.allianceId) || ''
      }))
    });
  } catch (error) {
    console.error('搜索分发用户失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 域主搜索熵盟（用于分发规则中的指定熵盟/黑名单）
router.get('/:nodeId/distribution-settings/search-alliances', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const keyword = typeof req.query?.keyword === 'string' ? req.query.keyword.trim() : '';
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('domainMaster');
    if (!node) {
      return res.status(404).json({ error: '知识域不存在' });
    }
    if (!isDomainMaster(node, req.user.userId)) {
      return res.status(403).json({ error: '只有域主可以搜索熵盟' });
    }

    const query = {};
    if (keyword) {
      query.name = { $regex: keyword, $options: 'i' };
    }

    const alliances = await EntropyAlliance.find(query)
      .select('_id name')
      .sort({ name: 1 })
      .limit(20)
      .lean();

    res.json({
      success: true,
      alliances: alliances.map((item) => ({
        _id: getIdString(item._id),
        name: item.name || ''
      }))
    });
  } catch (error) {
    console.error('搜索分发熵盟失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 保存知识点分发规则（仅域主）
router.put('/:nodeId/distribution-settings', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    let node = await Node.findById(nodeId).select(
      'name status domainMaster domainAdmins knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionActiveRuleId knowledgeDistributionScheduleSlots knowledgeDistributionLocked'
    );
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (!isDomainMaster(node, requestUserId)) {
      return res.status(403).json({ error: '只有域主可以修改分发规则' });
    }

    const masterUser = await User.findById(requestUserId).select('_id role allianceId');
    if (!masterUser || masterUser.role !== 'common') {
      return res.status(400).json({ error: '当前域主身份异常，无法设置分发规则' });
    }

    const now = new Date();
    const lockExecuteAt = new Date(node?.knowledgeDistributionLocked?.executeAt || 0).getTime();
    if (node.knowledgeDistributionLocked && Number.isFinite(lockExecuteAt) && lockExecuteAt <= now.getTime()) {
      await KnowledgeDistributionService.executeLockedDistribution(node._id, now);
      node = await Node.findById(nodeId).select(
        'name status domainMaster domainAdmins knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionActiveRuleId knowledgeDistributionScheduleSlots knowledgeDistributionLocked'
      );
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
    }

    if (node.knowledgeDistributionLocked) {
      return res.status(409).json({ error: '当前分发计划已发布，采用规则已锁定，需等待本次分发结束后才能修改规则' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const inputProfilesRaw = Array.isArray(body.ruleProfiles)
      ? body.ruleProfiles
      : (body.rule && typeof body.rule === 'object'
          ? [{ profileId: body.activeRuleId || 'default', name: '默认规则', rule: body.rule }]
          : []);
    if (inputProfilesRaw.length === 0) {
      return res.status(400).json({ error: '请至少配置一套分发规则' });
    }

    const profileSeen = new Set();
    const nextProfiles = [];
    inputProfilesRaw.forEach((profile, index) => {
      const normalized = sanitizeDistributionRuleProfileInput(profile, index);
      if (!normalized.profileId || profileSeen.has(normalized.profileId)) return;
      profileSeen.add(normalized.profileId);
      nextProfiles.push(normalized);
    });
    if (nextProfiles.length === 0) {
      return res.status(400).json({ error: '分发规则数据无效' });
    }

    const requestedActiveRuleId = typeof body.activeRuleId === 'string' ? body.activeRuleId.trim() : '';
    const nextActiveRuleId = nextProfiles.some((profile) => profile.profileId === requestedActiveRuleId)
      ? requestedActiveRuleId
      : nextProfiles[0].profileId;
    let allianceContributionPercent = 0;
    let masterAlliance = null;
    if (masterUser.allianceId && isValidObjectId(getIdString(masterUser.allianceId))) {
      masterAlliance = await EntropyAlliance.findById(masterUser.allianceId)
        .select('_id name knowledgeContributionPercent');
      allianceContributionPercent = round2(clampPercent(masterAlliance?.knowledgeContributionPercent || 0, 0));
      const masterAllianceId = getIdString(masterAlliance?._id);
      if (masterAllianceId) {
        nextProfiles.forEach((profile) => {
          profile.rule.blacklistAllianceIds = (profile.rule.blacklistAllianceIds || []).filter((id) => id !== masterAllianceId);
        });
      }
    }
    if (!masterAlliance) {
      nextProfiles.forEach((profile) => {
        profile.rule.nonHostileAlliancePercent = 0;
        profile.rule.specificAlliancePercents = [];
      });
    }

    const ruleReferencedUserIds = Array.from(new Set([
      ...nextProfiles.flatMap((profile) => collectRuleUserIds(profile.rule || {})),
      ...(Array.isArray(node.domainAdmins) ? node.domainAdmins.map((adminId) => getIdString(adminId)) : [])
    ].filter((id) => isValidObjectId(id))));
    const commonUserIdSet = await loadCommonUserIdSet(ruleReferencedUserIds);
    const domainAdminSet = new Set(
      (node.domainAdmins || [])
        .map((adminId) => getIdString(adminId))
        .filter((id) => isValidObjectId(id) && commonUserIdSet.has(id))
    );
    const profileSummaries = [];
    for (const profile of nextProfiles) {
      profile.rule = filterRuleUsersByAllowedSet(profile.rule || {}, commonUserIdSet);
      profile.rule.adminPercents = (profile.rule.adminPercents || []).filter((item) => domainAdminSet.has(item.userId));
      profile.rule.blacklistUserIds = (profile.rule.blacklistUserIds || []).filter((id) => id !== requestUserId);
      const summary = computeDistributionPercentSummary(profile.rule, allianceContributionPercent);
      if (summary.total > 100) {
        return res.status(400).json({
          error: `规则「${profile.name}」分配总比例不能超过100%（当前 ${summary.total}%）`,
          profileId: profile.profileId,
          percentSummary: summary
        });
      }
      profileSummaries.push({
        profileId: profile.profileId,
        name: profile.name,
        percentSummary: summary
      });
    }

    node.knowledgeDistributionRuleProfiles = nextProfiles.map((profile) => ({
      profileId: profile.profileId,
      name: profile.name,
      rule: profile.rule
    }));
    node.knowledgeDistributionActiveRuleId = nextActiveRuleId;
    const activeProfile = nextProfiles.find((profile) => profile.profileId === nextActiveRuleId) || nextProfiles[0];
    node.knowledgeDistributionRule = activeProfile?.rule || sanitizeDistributionRuleInput({});
    // 新流程中分发时间由“发布分发计划”单独管理
    node.knowledgeDistributionScheduleSlots = [];

    await node.save();

    const saved = extractDistributionProfilesFromNode(node);
    const savedProfiles = saved.profiles.map((profile) => ({
      profileId: profile.profileId,
      name: profile.name,
      enabled: profile.profileId === saved.activeRuleId,
      rule: serializeDistributionRule(profile.rule || {})
    }));
    const savedActive = savedProfiles.find((profile) => profile.profileId === saved.activeRuleId) || savedProfiles[0];
    const isRuleLocked = !!node.knowledgeDistributionLocked;
    res.json({
      success: true,
      message: isRuleLocked
        ? '分发规则已保存。当前周期已锁定，修改将在下一次分发生效'
        : '分发规则已保存',
      nodeId: node._id,
      nodeName: node.name,
      masterAllianceId: masterAlliance ? getIdString(masterAlliance._id) : '',
      masterAllianceName: masterAlliance?.name || '',
      allianceContributionPercent,
      scheduleSlots: [],
      activeRuleId: saved.activeRuleId,
      activeRule: savedActive || null,
      ruleProfiles: savedProfiles.map((profile) => ({
        ...profile,
        percentSummary: computeDistributionPercentSummary(profile.rule, allianceContributionPercent)
      })),
      rule: savedActive?.rule || serializeDistributionRule(node.knowledgeDistributionRule || {}),
      percentSummary: computeDistributionPercentSummary(savedActive?.rule || node.knowledgeDistributionRule || {}, allianceContributionPercent),
      profileSummaries,
      locked: serializeDistributionLock(node.knowledgeDistributionLocked || null),
      isRuleLocked
    });
  } catch (error) {
    console.error('保存知识点分发规则错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 发布知识点分发计划（仅域主）：选择规则 + 设置执行时刻（整点）后立即发布并锁定，不可撤回
router.post('/:nodeId/distribution-settings/publish', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    let node = await Node.findById(nodeId).select(
      'name status domainMaster domainAdmins contentScore knowledgePoint knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionActiveRuleId knowledgeDistributionLocked knowledgeDistributionCarryover'
    );
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (!isDomainMaster(node, requestUserId)) {
      return res.status(403).json({ error: '只有域主可以发布分发计划' });
    }

    const now = new Date();
    const lockExecuteAt = new Date(node?.knowledgeDistributionLocked?.executeAt || 0).getTime();
    if (node.knowledgeDistributionLocked && Number.isFinite(lockExecuteAt) && lockExecuteAt <= now.getTime()) {
      await KnowledgeDistributionService.executeLockedDistribution(node._id, now);
      node = await Node.findById(nodeId).select(
        'name status domainMaster domainAdmins contentScore knowledgePoint knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionActiveRuleId knowledgeDistributionLocked knowledgeDistributionCarryover'
      );
      if (!node) {
        return res.status(404).json({ error: '知识域不存在' });
      }
    }

    if (node.knowledgeDistributionLocked) {
      return res.status(409).json({ error: '该知识域已有已发布分发计划，发布后不可撤回，请等待本次执行后再发布新计划' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const executeAt = parseDistributionExecuteAtHour(body.executeAt);
    if (!executeAt) {
      return res.status(400).json({ error: '执行时间格式无效，请设置为整点（例如 2026-02-16T16:00）' });
    }
    if (executeAt.getTime() <= now.getTime()) {
      return res.status(400).json({ error: '执行时间必须晚于当前时间' });
    }

    const { profiles, activeRuleId } = extractDistributionProfilesFromNode(node);
    const requestedProfileId = typeof body.ruleProfileId === 'string' ? body.ruleProfileId.trim() : '';
    const selectedProfile = profiles.find((item) => item.profileId === requestedProfileId)
      || profiles.find((item) => item.profileId === activeRuleId)
      || profiles[0];
    if (!selectedProfile) {
      return res.status(400).json({ error: '未找到可发布的分发规则' });
    }

    const masterUser = await User.findById(requestUserId).select('_id username role allianceId');
    if (!masterUser || masterUser.role !== 'common') {
      return res.status(400).json({ error: '当前域主身份异常，无法发布分发计划' });
    }

    const selectedRule = sanitizeDistributionRuleInput(selectedProfile.rule || {});
    const ruleReferencedUserIds = Array.from(new Set([
      ...collectRuleUserIds(selectedRule),
      ...(Array.isArray(node.domainAdmins) ? node.domainAdmins.map((adminId) => getIdString(adminId)) : [])
    ].filter((id) => isValidObjectId(id))));
    const commonUserIdSet = await loadCommonUserIdSet(ruleReferencedUserIds);
    const domainAdminSet = new Set(
      (node.domainAdmins || [])
        .map((adminId) => getIdString(adminId))
        .filter((id) => isValidObjectId(id) && commonUserIdSet.has(id))
    );
    const filteredRule = filterRuleUsersByAllowedSet(selectedRule, commonUserIdSet);
    selectedRule.adminPercents = filteredRule.adminPercents;
    selectedRule.customUserPercents = filteredRule.customUserPercents;
    selectedRule.blacklistUserIds = filteredRule.blacklistUserIds;
    selectedRule.adminPercents = (selectedRule.adminPercents || []).filter((item) => domainAdminSet.has(item.userId));
    selectedRule.blacklistUserIds = (selectedRule.blacklistUserIds || []).filter((id) => id !== requestUserId);

    let masterAlliance = null;
    let allianceContributionPercent = 0;
    if (masterUser.allianceId && isValidObjectId(getIdString(masterUser.allianceId))) {
      masterAlliance = await EntropyAlliance.findById(masterUser.allianceId)
        .select('_id name knowledgeContributionPercent enemyAllianceIds')
        .lean();
      allianceContributionPercent = round2(clampPercent(masterAlliance?.knowledgeContributionPercent || 0, 0));
      const masterAllianceId = getIdString(masterAlliance?._id);
      if (masterAllianceId) {
        selectedRule.blacklistAllianceIds = (selectedRule.blacklistAllianceIds || []).filter((id) => id !== masterAllianceId);
      }
    } else {
      selectedRule.nonHostileAlliancePercent = 0;
      selectedRule.specificAlliancePercents = [];
    }

    const summary = computeDistributionPercentSummary(selectedRule, allianceContributionPercent);
    if (summary.total > 100) {
      return res.status(400).json({
        error: `规则「${selectedProfile.name}」分配总比例不能超过100%（当前 ${summary.total}%）`,
        profileId: selectedProfile.profileId,
        percentSummary: summary
      });
    }

    const refreshedNode = await Node.updateKnowledgePoint(node._id);
    if (!refreshedNode) {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }

    const minutesToExecute = Math.max(0, (executeAt.getTime() - now.getTime()) / (1000 * 60));
    const projectedTotal = round2(
      (Number(refreshedNode.knowledgePoint?.value) || 0) +
      (Number(refreshedNode.knowledgeDistributionCarryover) || 0) +
      minutesToExecute * (Number(refreshedNode.contentScore) || 0)
    );
    const distributionPercent = selectedRule?.distributionScope === 'partial'
      ? round2(clampPercent(selectedRule?.distributionPercent, 100))
      : 100;
    const projectedDistributableTotal = round2(projectedTotal * (distributionPercent / 100));

    refreshedNode.knowledgeDistributionLocked = {
      executeAt,
      announcedAt: now,
      projectedTotal,
      projectedDistributableTotal,
      masterAllianceId: masterAlliance?._id || null,
      masterAllianceName: masterAlliance?.name || '',
      allianceContributionPercent,
      distributionScope: selectedRule?.distributionScope === 'partial' ? 'partial' : 'all',
      distributionPercent,
      ruleProfileId: selectedProfile.profileId || '',
      ruleProfileName: selectedProfile.name || '',
      enemyAllianceIds: Array.isArray(masterAlliance?.enemyAllianceIds) ? masterAlliance.enemyAllianceIds : [],
      ruleSnapshot: selectedRule
    };
    refreshedNode.knowledgeDistributionLastAnnouncedAt = now;
    await refreshedNode.save();

    await KnowledgeDistributionService.publishAnnouncementNotifications({
      node: refreshedNode,
      masterUser,
      lock: refreshedNode.knowledgeDistributionLocked
    });

    return res.json({
      success: true,
      message: '分发计划已发布并锁定，不可撤回',
      nodeId: refreshedNode._id,
      nodeName: refreshedNode.name,
      activeRuleId: selectedProfile.profileId,
      activeRuleName: selectedProfile.name,
      knowledgePointValue: round2(Number(refreshedNode?.knowledgePoint?.value) || 0),
      carryoverValue: round2(Number(refreshedNode?.knowledgeDistributionCarryover) || 0),
      locked: serializeDistributionLock(refreshedNode.knowledgeDistributionLocked || null),
      isRuleLocked: true
    });
  } catch (error) {
    console.error('发布知识点分发计划错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
