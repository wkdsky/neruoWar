const express = require('express');
const router = express.Router();
const EntropyAlliance = require('../models/EntropyAlliance');
const User = require('../models/User');
const Node = require('../models/Node');
const { authenticateToken } = require('../middleware/auth');

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

const normalizeVisualStyleInput = (rawStyle = {}, fallbackName = '主视觉') => {
  const style = rawStyle && typeof rawStyle === 'object' ? rawStyle : {};
  const normalizedName = typeof style.name === 'string' ? style.name.trim() : '';
  return {
    name: normalizedName || fallbackName,
    primaryColor: normalizeHexColor(style.primaryColor, '#7c3aed'),
    secondaryColor: normalizeHexColor(style.secondaryColor, '#312e81'),
    glowColor: normalizeHexColor(style.glowColor, '#c084fc'),
    rimColor: normalizeHexColor(style.rimColor, '#f5d0fe'),
    textColor: normalizeHexColor(style.textColor, '#ffffff'),
    patternType: normalizePatternType(style.patternType, 'diagonal')
  };
};

const serializeVisualStyle = (style) => {
  if (!style) return null;
  const styleObj = typeof style.toObject === 'function' ? style.toObject() : style;
  return {
    _id: getIdString(styleObj._id),
    name: styleObj.name || '',
    primaryColor: styleObj.primaryColor || '#7c3aed',
    secondaryColor: styleObj.secondaryColor || '#312e81',
    glowColor: styleObj.glowColor || '#c084fc',
    rimColor: styleObj.rimColor || '#f5d0fe',
    textColor: styleObj.textColor || '#ffffff',
    patternType: normalizePatternType(styleObj.patternType, 'diagonal')
  };
};

const resolveActiveVisualStyle = (alliance) => {
  if (!alliance) return null;
  const styles = Array.isArray(alliance.visualStyles) ? alliance.visualStyles : [];
  if (styles.length === 0) {
    return normalizeVisualStyleInput({
      name: '默认风格',
      primaryColor: alliance.flag || '#7c3aed',
      secondaryColor: '#312e81',
      glowColor: '#c084fc',
      rimColor: '#f5d0fe',
      textColor: '#ffffff',
      patternType: 'diagonal'
    }, '默认风格');
  }
  const activeId = getIdString(alliance.activeVisualStyleId);
  const active = styles.find((styleItem) => getIdString(styleItem?._id) === activeId);
  return active || styles[0] || null;
};

const buildAlliancePayload = (alliance, extras = {}) => {
  let styles = Array.isArray(alliance?.visualStyles) ? alliance.visualStyles.map(serializeVisualStyle).filter(Boolean) : [];
  const active = resolveActiveVisualStyle(alliance);
  const serializedActive = serializeVisualStyle(active);
  if (styles.length === 0 && serializedActive) {
    styles = [serializedActive];
  }
  return {
    _id: alliance._id,
    name: alliance.name,
    flag: alliance.flag,
    declaration: alliance.declaration,
    announcement: alliance.announcement || '',
    announcementUpdatedAt: alliance.announcementUpdatedAt || null,
    founder: alliance.founder,
    visualStyles: styles,
    activeVisualStyleId: serializedActive?._id || '',
    activeVisualStyle: serializedActive,
    knowledgeContributionPercent: typeof alliance.knowledgeContributionPercent === 'number'
      ? alliance.knowledgeContributionPercent
      : 10,
    knowledgeReserve: typeof alliance.knowledgeReserve === 'number'
      ? alliance.knowledgeReserve
      : 0,
    enemyAllianceIds: Array.isArray(alliance.enemyAllianceIds)
      ? alliance.enemyAllianceIds.map((item) => getIdString(item)).filter(Boolean)
      : [],
    createdAt: alliance.createdAt,
    updatedAt: alliance.updatedAt,
    ...extras
  };
};

const syncMasterDomainsAlliance = async ({ userId, allianceId }) => {
  const domainMasterId = getIdString(userId);
  if (!domainMasterId) return;
  await Node.updateMany(
    { domainMaster: domainMasterId },
    { $set: { allianceId: allianceId || null } }
  );
};

const broadcastAllianceAnnouncement = async ({
  allianceId,
  allianceName,
  announcement,
  actorUserId = null
}) => {
  const normalizedAnnouncement = typeof announcement === 'string' ? announcement.trim() : '';
  const targetAllianceId = getIdString(allianceId);
  const normalizedAllianceName = typeof allianceName === 'string' ? allianceName.trim() : '';
  const actorId = getIdString(actorUserId);

  if (!targetAllianceId || !normalizedAnnouncement || !normalizedAllianceName) {
    return 0;
  }

  const members = await User.find({ allianceId: targetAllianceId }).select('_id notifications');
  if (!Array.isArray(members) || members.length === 0) {
    return 0;
  }

  const changedMembers = [];
  for (const member of members) {
    if (actorId && getIdString(member._id) === actorId) {
      continue;
    }
    member.notifications.unshift({
      type: 'alliance_announcement',
      title: `熵盟「${normalizedAllianceName}」发布了新公告`,
      message: normalizedAnnouncement,
      read: false,
      status: 'info',
      allianceId: targetAllianceId,
      allianceName: normalizedAllianceName
    });
    changedMembers.push(member);
  }

  if (changedMembers.length > 0) {
    await Promise.all(changedMembers.map((member) => member.save()));
  }
  return changedMembers.length;
};

// 获取所有熵盟列表（包括成员数量和管辖知识域数量）
router.get('/list', async (req, res) => {
  try {
    const alliances = await EntropyAlliance.find()
      .populate('founder', 'username profession')
      .sort({ createdAt: -1 });

    // 为每个熵盟计算成员数量和管辖知识域数量
    const alliancesWithStats = await Promise.all(alliances.map(async (alliance) => {
      const allianceMembers = await User.find({ allianceId: alliance._id }).select('_id').lean();
      const memberIds = allianceMembers.map((item) => item._id);
      const memberCount = memberIds.length;

      const domainCount = await Node.countDocuments({
        status: 'approved',
        $or: [
          { allianceId: alliance._id },
          { allianceId: null, domainMaster: { $in: memberIds } }
        ]
      });

      return buildAlliancePayload(alliance, {
        memberCount,
        domainCount
      });
    }));

    res.json({ alliances: alliancesWithStats });
  } catch (error) {
    console.error('获取熵盟列表失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取单个熵盟详情
router.get('/:allianceId', async (req, res) => {
  try {
    const alliance = await EntropyAlliance.findById(req.params.allianceId)
      .populate('founder', 'username profession');

    if (!alliance) {
      return res.status(404).json({ error: '熵盟不存在' });
    }

    // 获取成员列表
    const members = await User.find({ allianceId: alliance._id })
      .select('username level profession createdAt');

    // 获取管辖域列表
    const memberIds = members.map((item) => item._id);
    const domains = await Node.find({
      status: 'approved',
      $or: [
        { allianceId: alliance._id },
        { allianceId: null, domainMaster: { $in: memberIds } }
      ]
    })
      .populate('domainMaster', 'username profession')
      .select('name description domainMaster');

    res.json({
      alliance: buildAlliancePayload(alliance, {
        memberCount: members.length,
        domainCount: domains.length
      }),
      members,
      domains
    });
  } catch (error) {
    console.error('获取熵盟详情失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 创建新熵盟（需要认证）
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { name, flag, declaration, visualStyle } = req.body;
    const userId = req.user.userId;

    // 检查是否是管理员
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ error: '管理员不能创建和加入熵盟' });
    }

    // 检查用户是否已经属于某个熵盟
    if (user.allianceId) {
      return res.status(400).json({ error: '您已经属于一个熵盟，无法创建新熵盟' });
    }

    // 检查用户是否至少是一个知识域的域主
    const domainCount = await Node.countDocuments({
      domainMaster: userId,
      status: 'approved'
    });

    if (domainCount === 0) {
      return res.status(403).json({ error: '创建熵盟需要至少是一个知识域的域主' });
    }

    // 检查熵盟名称是否已存在
    const existingAlliance = await EntropyAlliance.findOne({ name });
    if (existingAlliance) {
      return res.status(400).json({ error: '熵盟名称已存在' });
    }

    if (!visualStyle || typeof visualStyle !== 'object') {
      return res.status(400).json({ error: '创建熵盟必须设置一套知识域视觉样式' });
    }

    const normalizedVisualStyle = normalizeVisualStyleInput(visualStyle, '主视觉');
    if (!normalizedVisualStyle.name) {
      return res.status(400).json({ error: '视觉样式名称不能为空' });
    }

    // 创建熵盟
    const alliance = new EntropyAlliance({
      name,
      flag: flag || '#7c3aed',
      declaration,
      founder: userId,
      visualStyles: [normalizedVisualStyle]
    });
    if (alliance.visualStyles[0]?._id) {
      alliance.activeVisualStyleId = alliance.visualStyles[0]._id;
    }

    await alliance.save();

    // 自动将创建者加入熵盟
    user.allianceId = alliance._id;
    await user.save();
    await syncMasterDomainsAlliance({
      userId: user._id,
      allianceId: alliance._id
    });

    const populatedAlliance = await EntropyAlliance.findById(alliance._id)
      .populate('founder', 'username profession');

    res.json({
      message: '熵盟创建成功',
      alliance: buildAlliancePayload(populatedAlliance)
    });
  } catch (error) {
    console.error('创建熵盟失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 加入熵盟（需要认证）
router.post('/join/:allianceId', authenticateToken, async (req, res) => {
  try {
    const { allianceId } = req.params;
    const userId = req.user.userId;

    // 检查用户
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ error: '管理员不能创建和加入熵盟' });
    }

    // 检查用户是否已经属于某个熵盟
    if (user.allianceId) {
      return res.status(400).json({ error: '您已经属于一个熵盟，请先退出当前熵盟' });
    }

    // 检查熵盟是否存在
    const alliance = await EntropyAlliance.findById(allianceId).select('_id name founder');
    if (!alliance) {
      return res.status(404).json({ error: '熵盟不存在' });
    }

    const founderId = getIdString(alliance.founder);
    if (!founderId) {
      return res.status(400).json({ error: '该熵盟缺少盟主信息，暂时无法申请加入' });
    }

    // 盟主本人回归熵盟时可直接加入
    if (founderId === getIdString(user._id)) {
      user.allianceId = alliance._id;
      await user.save();
      await syncMasterDomainsAlliance({
        userId: user._id,
        allianceId: alliance._id
      });

      return res.json({
        message: '盟主已回归熵盟',
        alliance: {
          _id: alliance._id,
          name: alliance.name
        }
      });
    }

    const founderUser = await User.findById(founderId).select('username notifications');
    if (!founderUser) {
      return res.status(400).json({ error: '盟主不存在，暂时无法申请加入该熵盟' });
    }

    const applicantId = getIdString(user._id);
    const targetAllianceId = getIdString(alliance._id);
    const hasPendingApply = (founderUser.notifications || []).some((item) => (
      item.type === 'alliance_join_apply' &&
      item.status === 'pending' &&
      getIdString(item.inviteeId) === applicantId &&
      getIdString(item.allianceId) === targetAllianceId
    ));

    if (hasPendingApply) {
      return res.status(400).json({ error: '你已提交过该熵盟的加入申请，请等待盟主审核' });
    }

    founderUser.notifications.unshift({
      type: 'alliance_join_apply',
      title: `有人申请加入熵盟「${alliance.name}」`,
      message: `${user.username} 申请加入熵盟「${alliance.name}」，请审核。`,
      read: false,
      status: 'pending',
      allianceId: alliance._id,
      allianceName: alliance.name,
      inviterId: user._id,
      inviterUsername: user.username,
      inviteeId: user._id,
      inviteeUsername: user.username
    });
    await founderUser.save();

    res.json({
      message: '申请已提交，等待盟主审核',
      alliance: {
        _id: alliance._id,
        name: alliance.name
      }
    });
  } catch (error) {
    console.error('加入熵盟失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 盟主：查看待处理入盟申请
router.get('/leader/:allianceId/pending-applications', authenticateToken, async (req, res) => {
  try {
    const { allianceId } = req.params;
    const leader = await User.findById(req.user.userId).select('_id notifications');
    if (!leader) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const alliance = await EntropyAlliance.findById(allianceId).select('_id founder name');
    if (!alliance) {
      return res.status(404).json({ error: '熵盟不存在' });
    }

    if (getIdString(alliance.founder) !== getIdString(leader._id)) {
      return res.status(403).json({ error: '只有盟主可以查看入盟申请' });
    }

    const applications = (leader.notifications || [])
      .filter((item) => (
        item.type === 'alliance_join_apply' &&
        item.status === 'pending' &&
        getIdString(item.allianceId) === getIdString(alliance._id)
      ))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((item) => ({
        notificationId: item._id,
        applicantId: item.inviteeId || item.inviterId || null,
        applicantUsername: item.inviteeUsername || item.inviterUsername || '未知',
        message: item.message || '',
        createdAt: item.createdAt
      }));

    res.json({
      success: true,
      applications
    });
  } catch (error) {
    console.error('获取待处理入盟申请失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 盟主：移除盟内成员
router.post('/leader/:allianceId/remove-member', authenticateToken, async (req, res) => {
  try {
    const { allianceId } = req.params;
    const { memberId } = req.body || {};

    if (!memberId) {
      return res.status(400).json({ error: '成员ID不能为空' });
    }

    const leader = await User.findById(req.user.userId).select('_id username allianceId');
    if (!leader) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const alliance = await EntropyAlliance.findById(allianceId).select('_id founder');
    if (!alliance) {
      return res.status(404).json({ error: '熵盟不存在' });
    }

    if (getIdString(alliance.founder) !== getIdString(leader._id)) {
      return res.status(403).json({ error: '只有盟主可以移除成员' });
    }

    if (getIdString(memberId) === getIdString(leader._id)) {
      return res.status(400).json({ error: '不能在此处移除盟主本人，请使用退出熵盟流程' });
    }

    const member = await User.findById(memberId).select('_id username allianceId');
    if (!member || getIdString(member.allianceId) !== getIdString(alliance._id)) {
      return res.status(404).json({ error: '目标成员不在该熵盟中' });
    }

    member.allianceId = null;
    await member.save();
    await syncMasterDomainsAlliance({
      userId: member._id,
      allianceId: null
    });

    const remainingMembers = await User.countDocuments({ allianceId: alliance._id });
    if (remainingMembers === 0) {
      await Node.updateMany(
        { allianceId: alliance._id },
        { $set: { allianceId: null } }
      );
      await EntropyAlliance.findByIdAndDelete(alliance._id);
      return res.json({ message: `已将成员 ${member.username} 移出熵盟，熵盟因无成员自动解散` });
    }

    const remainingUsers = await User.find({ allianceId: alliance._id }).select('_id');
    const remainingMemberIds = remainingUsers.map((item) => item._id);
    const remainingDomainMasterCount = await Node.countDocuments({
      domainMaster: { $in: remainingMemberIds },
      status: 'approved'
    });

    if (remainingDomainMasterCount === 0) {
      await User.updateMany(
        { allianceId: alliance._id },
        { $set: { allianceId: null } }
      );
      await Node.updateMany(
        { allianceId: alliance._id },
        { $set: { allianceId: null } }
      );
      await EntropyAlliance.findByIdAndDelete(alliance._id);
      return res.json({ message: `已将成员 ${member.username} 移出熵盟，熵盟因剩余成员均非域主自动解散` });
    }

    res.json({ message: `已将成员 ${member.username} 移出熵盟` });
  } catch (error) {
    console.error('移除熵盟成员失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 盟主：更新盟宣言与盟公告
router.put('/leader/:allianceId/manage', authenticateToken, async (req, res) => {
  try {
    const { allianceId } = req.params;
    const {
      declaration,
      announcement,
      knowledgeContributionPercent,
      createVisualStyle,
      deleteVisualStyleId,
      activateVisualStyleId
    } = req.body || {};

    const leader = await User.findById(req.user.userId).select('_id');
    if (!leader) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const alliance = await EntropyAlliance.findById(allianceId)
      .populate('founder', 'username profession');
    if (!alliance) {
      return res.status(404).json({ error: '熵盟不存在' });
    }

    if (getIdString(alliance.founder) !== getIdString(leader._id)) {
      return res.status(403).json({ error: '只有盟主可以管理熵盟信息' });
    }

    const previousAnnouncement = (alliance.announcement || '').trim();
    let hasChanges = false;
    let shouldBroadcastAllianceAnnouncement = false;

    if (typeof declaration === 'string') {
      const normalizedDeclaration = declaration.trim();
      if (!normalizedDeclaration) {
        return res.status(400).json({ error: '盟宣言不能为空' });
      }
      alliance.declaration = normalizedDeclaration;
      hasChanges = true;
    }

    if (typeof announcement === 'string') {
      const normalizedAnnouncement = announcement.trim();
      alliance.announcement = normalizedAnnouncement;
      alliance.announcementUpdatedAt = new Date();
      shouldBroadcastAllianceAnnouncement = Boolean(normalizedAnnouncement) && normalizedAnnouncement !== previousAnnouncement;
      hasChanges = true;
    }

    if (knowledgeContributionPercent !== undefined) {
      const parsedContribution = Number(knowledgeContributionPercent);
      if (!Number.isFinite(parsedContribution) || parsedContribution < 0 || parsedContribution > 100) {
        return res.status(400).json({ error: '知识贡献比例必须在 0-100 之间' });
      }
      alliance.knowledgeContributionPercent = parsedContribution;
      hasChanges = true;
    }

    if (createVisualStyle && typeof createVisualStyle === 'object') {
      const normalizedStyle = normalizeVisualStyleInput(createVisualStyle, `风格${(alliance.visualStyles || []).length + 1}`);
      const styleNameTaken = (alliance.visualStyles || []).some((item) => (
        (item?.name || '').trim() === normalizedStyle.name
      ));
      if (styleNameTaken) {
        return res.status(400).json({ error: '已存在同名视觉样式，请更换名称' });
      }
      alliance.visualStyles.push(normalizedStyle);
      if (!alliance.activeVisualStyleId && alliance.visualStyles[alliance.visualStyles.length - 1]?._id) {
        alliance.activeVisualStyleId = alliance.visualStyles[alliance.visualStyles.length - 1]._id;
      }
      hasChanges = true;
    }

    if (typeof activateVisualStyleId === 'string' && activateVisualStyleId.trim()) {
      const targetStyle = (alliance.visualStyles || []).find((item) => (
        getIdString(item?._id) === activateVisualStyleId.trim()
      ));
      if (!targetStyle) {
        return res.status(400).json({ error: '目标视觉样式不存在，无法启用' });
      }
      alliance.activeVisualStyleId = targetStyle._id;
      hasChanges = true;
    }

    if (typeof deleteVisualStyleId === 'string' && deleteVisualStyleId.trim()) {
      const styleList = alliance.visualStyles || [];
      const deleteIndex = styleList.findIndex((item) => (
        getIdString(item?._id) === deleteVisualStyleId.trim()
      ));
      if (deleteIndex === -1) {
        return res.status(400).json({ error: '目标视觉样式不存在，无法删除' });
      }
      if (styleList.length <= 1) {
        return res.status(400).json({ error: '至少保留一套视觉样式，不能删除最后一套' });
      }
      const removedStyle = styleList[deleteIndex];
      styleList.splice(deleteIndex, 1);
      if (getIdString(alliance.activeVisualStyleId) === getIdString(removedStyle?._id)) {
        alliance.activeVisualStyleId = styleList[0]?._id || null;
      }
      hasChanges = true;
    }

    if (!hasChanges) {
      return res.status(400).json({ error: '未提供可更新内容' });
    }

    await alliance.save();
    if (shouldBroadcastAllianceAnnouncement) {
      await broadcastAllianceAnnouncement({
        allianceId: alliance._id,
        allianceName: alliance.name,
        announcement: alliance.announcement,
        actorUserId: leader._id
      });
    }

    res.json({
      success: true,
      message: '熵盟信息已更新',
      alliance: buildAlliancePayload(alliance)
    });
  } catch (error) {
    console.error('更新熵盟信息失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 退出熵盟（需要认证）
router.post('/leave', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { newLeaderId } = req.body || {};

    // 检查用户
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 检查用户是否属于某个熵盟
    if (!user.allianceId) {
      return res.status(400).json({ error: '您当前不属于任何熵盟' });
    }

    const allianceId = user.allianceId;
    const alliance = await EntropyAlliance.findById(allianceId).select('_id founder');
    const userIdStr = getIdString(user._id);
    let leaderTransferred = false;

    if (alliance && getIdString(alliance.founder) === userIdStr) {
      const remainingCandidates = await User.find({
        allianceId,
        _id: { $ne: user._id }
      }).select('_id');

      if (remainingCandidates.length > 0) {
        const candidateIdSet = new Set(remainingCandidates.map((item) => getIdString(item._id)));
        const targetLeaderId = getIdString(newLeaderId);
        if (!targetLeaderId) {
          return res.status(400).json({ error: '盟主退出前必须从剩余成员中指定一位新盟主' });
        }
        if (!candidateIdSet.has(targetLeaderId)) {
          return res.status(400).json({ error: '新盟主必须是该熵盟的剩余成员' });
        }
        await EntropyAlliance.updateOne(
          { _id: alliance._id },
          { $set: { founder: targetLeaderId } }
        );
        leaderTransferred = true;
      }
    }

    // 退出熵盟
    user.allianceId = null;
    await user.save();
    await syncMasterDomainsAlliance({
      userId: user._id,
      allianceId: null
    });

    // 检查熵盟是否还有成员，如果没有则删除熵盟
    const remainingMembers = await User.countDocuments({ allianceId });
    if (remainingMembers === 0) {
      await Node.updateMany(
        { allianceId },
        { $set: { allianceId: null } }
      );
      await EntropyAlliance.findByIdAndDelete(allianceId);
      return res.json({ message: '成功退出熵盟，该熵盟已解散（无剩余成员）' });
    }

    // 若剩余成员都不是任何已通过知识域的域主，则自动解散熵盟
    const remainingUsers = await User.find({ allianceId }).select('_id');
    const remainingMemberIds = remainingUsers.map((item) => item._id);
    const remainingDomainMasterCount = await Node.countDocuments({
      domainMaster: { $in: remainingMemberIds },
      status: 'approved'
    });

    if (remainingDomainMasterCount === 0) {
      await User.updateMany(
        { allianceId },
        { $set: { allianceId: null } }
      );
      await Node.updateMany(
        { allianceId },
        { $set: { allianceId: null } }
      );
      await EntropyAlliance.findByIdAndDelete(allianceId);
      return res.json({ message: '成功退出熵盟，该熵盟已自动解散（剩余成员均非域主）' });
    }

    res.json({ message: leaderTransferred ? '已指定新盟主并成功退出熵盟' : '成功退出熵盟' });
  } catch (error) {
    console.error('退出熵盟失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 盟主转交（自己保留成员身份，仅卸任盟主）
router.post('/leader/:allianceId/transfer', authenticateToken, async (req, res) => {
  try {
    const { allianceId } = req.params;
    const { newLeaderId } = req.body || {};
    const userId = getIdString(req?.user?.userId);
    const targetLeaderId = getIdString(newLeaderId);

    if (!targetLeaderId) {
      return res.status(400).json({ error: '请选择新盟主' });
    }

    const currentUser = await User.findById(userId).select('_id allianceId');
    if (!currentUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (getIdString(currentUser.allianceId) !== getIdString(allianceId)) {
      return res.status(403).json({ error: '你不在该熵盟中，无法转交盟主' });
    }

    const alliance = await EntropyAlliance.findById(allianceId).select('_id founder name');
    if (!alliance) {
      return res.status(404).json({ error: '熵盟不存在' });
    }

    if (getIdString(alliance.founder) !== userId) {
      return res.status(403).json({ error: '只有盟主可以转交盟主身份' });
    }

    if (targetLeaderId === userId) {
      return res.status(400).json({ error: '新盟主不能是自己' });
    }

    const targetMember = await User.findById(targetLeaderId).select('_id allianceId');
    if (!targetMember || getIdString(targetMember.allianceId) !== getIdString(alliance._id)) {
      return res.status(400).json({ error: '新盟主必须是该熵盟的现有成员' });
    }

    const previousLeader = await User.findById(userId).select('_id username');
    if (!previousLeader) {
      return res.status(404).json({ error: '原盟主不存在' });
    }
    const nextLeader = await User.findById(targetMember._id).select('_id username notifications');
    if (!nextLeader) {
      return res.status(404).json({ error: '新盟主不存在' });
    }

    const transferAnnouncement = `${previousLeader.username}已将盟主转交给${nextLeader.username}`;
    const transferAt = new Date();
    await EntropyAlliance.updateOne(
      { _id: alliance._id },
      {
        $set: {
          founder: targetMember._id,
          announcement: transferAnnouncement,
          announcementUpdatedAt: transferAt
        }
      }
    );

    // 给新盟主一条明确通知
    nextLeader.notifications.unshift({
      type: 'info',
      title: `你已成为熵盟「${alliance.name}」盟主`,
      message: `${previousLeader.username}已将盟主转交给你`,
      read: false,
      status: 'info',
      allianceId: alliance._id,
      allianceName: alliance.name,
      inviterId: previousLeader._id,
      inviterUsername: previousLeader.username,
      inviteeId: nextLeader._id,
      inviteeUsername: nextLeader.username,
      respondedAt: transferAt
    });
    await nextLeader.save();

    // 自动发布并广播熵盟公告（所有盟内成员可见）
    await broadcastAllianceAnnouncement({
      allianceId: alliance._id,
      allianceName: alliance.name,
      announcement: transferAnnouncement
    });

    res.json({
      success: true,
      message: '盟主身份已成功转交，你当前为普通盟成员'
    });
  } catch (error) {
    console.error('转交盟主失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取当前用户的熵盟信息（需要认证）
router.get('/my/info', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate('allianceId');

    if (!user.allianceId) {
      return res.json({ alliance: null });
    }

    // 获取熵盟的成员数和管辖域数
    const memberCount = await User.countDocuments({ allianceId: user.allianceId._id });
    const memberDocs = await User.find({ allianceId: user.allianceId._id }).select('_id').lean();
    const memberIds = memberDocs.map((item) => item._id);
    const domainCount = await Node.countDocuments({
      status: 'approved',
      $or: [
        { allianceId: user.allianceId._id },
        { allianceId: null, domainMaster: { $in: memberIds } }
      ]
    });

    res.json({
      alliance: buildAlliancePayload(user.allianceId, {
        memberCount,
        domainCount
      })
    });
  } catch (error) {
    console.error('获取用户熵盟信息失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ===== 管理员API =====

// 管理员：获取所有熵盟详细信息
router.get('/admin/all', authenticateToken, async (req, res) => {
  try {
    // 检查是否是管理员
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: '无权限执行此操作' });
    }

    const alliances = await EntropyAlliance.find()
      .populate('founder', 'username profession')
      .sort({ createdAt: -1 });

    // 为每个熵盟计算成员数量和管辖知识域数量
    const alliancesWithStats = await Promise.all(alliances.map(async (alliance) => {
      const allianceMembers = await User.find({ allianceId: alliance._id }).select('_id').lean();
      const memberIds = allianceMembers.map((item) => item._id);
      const memberCount = memberIds.length;
      const domainCount = await Node.countDocuments({
        status: 'approved',
        $or: [
          { allianceId: alliance._id },
          { allianceId: null, domainMaster: { $in: memberIds } }
        ]
      });

      return buildAlliancePayload(alliance, {
        memberCount,
        domainCount
      });
    }));

    res.json({ success: true, alliances: alliancesWithStats });
  } catch (error) {
    console.error('获取熵盟列表失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员：更新熵盟信息
router.put('/admin/:allianceId', authenticateToken, async (req, res) => {
  try {
    // 检查是否是管理员
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: '无权限执行此操作' });
    }

    const { allianceId } = req.params;
    const { name, flag, declaration, announcement } = req.body;

    const alliance = await EntropyAlliance.findById(allianceId);
    if (!alliance) {
      return res.status(404).json({ error: '熵盟不存在' });
    }

    const previousAnnouncement = (alliance.announcement || '').trim();
    let shouldBroadcastAllianceAnnouncement = false;

    // 如果更改名称，检查是否已被使用
    if (name && name !== alliance.name) {
      const existing = await EntropyAlliance.findOne({ name, _id: { $ne: allianceId } });
      if (existing) {
        return res.status(400).json({ error: '熵盟名称已被使用' });
      }
      alliance.name = name;
    }

    if (flag) alliance.flag = flag;
    if (declaration) alliance.declaration = declaration;
    if (typeof announcement === 'string') {
      const normalizedAnnouncement = announcement.trim();
      alliance.announcement = normalizedAnnouncement;
      alliance.announcementUpdatedAt = new Date();
      shouldBroadcastAllianceAnnouncement = Boolean(normalizedAnnouncement) && normalizedAnnouncement !== previousAnnouncement;
    }

    await alliance.save();
    if (shouldBroadcastAllianceAnnouncement) {
      await broadcastAllianceAnnouncement({
        allianceId: alliance._id,
        allianceName: alliance.name,
        announcement: alliance.announcement,
        actorUserId: adminUser._id
      });
    }

    const updatedAlliance = await EntropyAlliance.findById(allianceId)
      .populate('founder', 'username profession');

    res.json({
      success: true,
      message: '熵盟信息已更新',
      alliance: buildAlliancePayload(updatedAlliance)
    });
  } catch (error) {
    console.error('更新熵盟失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员：删除熵盟
router.delete('/admin/:allianceId', authenticateToken, async (req, res) => {
  try {
    // 检查是否是管理员
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: '无权限执行此操作' });
    }

    const { allianceId } = req.params;

    const alliance = await EntropyAlliance.findById(allianceId);
    if (!alliance) {
      return res.status(404).json({ error: '熵盟不存在' });
    }

    // 清除所有成员的熵盟关联
    await User.updateMany(
      { allianceId: allianceId },
      { $set: { allianceId: null } }
    );
    await Node.updateMany(
      { allianceId: allianceId },
      { $set: { allianceId: null } }
    );

    // 删除熵盟
    await EntropyAlliance.findByIdAndDelete(allianceId);

    res.json({
      success: true,
      message: '熵盟已删除'
    });
  } catch (error) {
    console.error('删除熵盟失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
