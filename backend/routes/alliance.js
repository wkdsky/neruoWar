const express = require('express');
const router = express.Router();
const EntropyAlliance = require('../models/EntropyAlliance');
const User = require('../models/User');
const Node = require('../models/Node');
const { authenticateToken } = require('../middleware/auth');

// 获取所有熵盟列表（包括成员数量和管辖知识域数量）
router.get('/list', async (req, res) => {
  try {
    const alliances = await EntropyAlliance.find()
      .populate('founder', 'username profession')
      .sort({ createdAt: -1 });

    // 为每个熵盟计算成员数量和管辖知识域数量
    const alliancesWithStats = await Promise.all(alliances.map(async (alliance) => {
      // 计算成员数量
      const memberCount = await User.countDocuments({ allianceId: alliance._id });

      // 计算管辖知识域数量
      // 找出所有属于该熵盟成员的用户ID
      const allianceMembers = await User.find({ allianceId: alliance._id }).select('_id');
      const memberIds = allianceMembers.map(m => m._id);

      // 统计这些用户作为域主的节点数量
      const domainCount = await Node.countDocuments({
        domainMaster: { $in: memberIds },
        status: 'approved'
      });

      return {
        _id: alliance._id,
        name: alliance.name,
        flag: alliance.flag,
        declaration: alliance.declaration,
        founder: alliance.founder,
        memberCount,
        domainCount,
        createdAt: alliance.createdAt
      };
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
    const memberIds = members.map(m => m._id);
    const domains = await Node.find({
      domainMaster: { $in: memberIds },
      status: 'approved'
    })
      .populate('domainMaster', 'username profession')
      .select('name description domainMaster');

    res.json({
      alliance: {
        _id: alliance._id,
        name: alliance.name,
        flag: alliance.flag,
        declaration: alliance.declaration,
        founder: alliance.founder,
        memberCount: members.length,
        domainCount: domains.length,
        createdAt: alliance.createdAt
      },
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
    const { name, flag, declaration } = req.body;
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

    // 创建熵盟
    const alliance = new EntropyAlliance({
      name,
      flag: flag || '#7c3aed',
      declaration,
      founder: userId
    });

    await alliance.save();

    // 自动将创建者加入熵盟
    user.allianceId = alliance._id;
    await user.save();

    const populatedAlliance = await EntropyAlliance.findById(alliance._id)
      .populate('founder', 'username profession');

    res.json({
      message: '熵盟创建成功',
      alliance: populatedAlliance
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
    const alliance = await EntropyAlliance.findById(allianceId);
    if (!alliance) {
      return res.status(404).json({ error: '熵盟不存在' });
    }

    // 加入熵盟
    user.allianceId = allianceId;
    await user.save();

    res.json({
      message: '成功加入熵盟',
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

// 退出熵盟（需要认证）
router.post('/leave', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

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

    // 退出熵盟
    user.allianceId = null;
    await user.save();

    // 检查熵盟是否还有成员，如果没有则删除熵盟
    const remainingMembers = await User.countDocuments({ allianceId });
    if (remainingMembers === 0) {
      await EntropyAlliance.findByIdAndDelete(allianceId);
      return res.json({ message: '成功退出熵盟，该熵盟已解散（无剩余成员）' });
    }

    res.json({ message: '成功退出熵盟' });
  } catch (error) {
    console.error('退出熵盟失败:', error);
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
    const allianceMembers = await User.find({ allianceId: user.allianceId._id }).select('_id');
    const memberIds = allianceMembers.map(m => m._id);
    const domainCount = await Node.countDocuments({
      domainMaster: { $in: memberIds },
      status: 'approved'
    });

    res.json({
      alliance: {
        _id: user.allianceId._id,
        name: user.allianceId.name,
        flag: user.allianceId.flag,
        declaration: user.allianceId.declaration,
        memberCount,
        domainCount
      }
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
      const memberCount = await User.countDocuments({ allianceId: alliance._id });
      const allianceMembers = await User.find({ allianceId: alliance._id }).select('_id');
      const memberIds = allianceMembers.map(m => m._id);
      const domainCount = await Node.countDocuments({
        domainMaster: { $in: memberIds },
        status: 'approved'
      });

      return {
        _id: alliance._id,
        name: alliance.name,
        flag: alliance.flag,
        declaration: alliance.declaration,
        founder: alliance.founder,
        memberCount,
        domainCount,
        createdAt: alliance.createdAt,
        updatedAt: alliance.updatedAt
      };
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
    const { name, flag, declaration } = req.body;

    const alliance = await EntropyAlliance.findById(allianceId);
    if (!alliance) {
      return res.status(404).json({ error: '熵盟不存在' });
    }

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

    await alliance.save();

    const updatedAlliance = await EntropyAlliance.findById(allianceId)
      .populate('founder', 'username profession');

    res.json({
      success: true,
      message: '熵盟信息已更新',
      alliance: updatedAlliance
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
