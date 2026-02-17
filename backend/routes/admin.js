const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const GameSetting = require('../models/GameSetting');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');

const getOrCreateSettings = async () => GameSetting.findOneAndUpdate(
  { key: 'global' },
  { $setOnInsert: { travelUnitSeconds: 60, distributionAnnouncementLeadHours: 24 } },
  { new: true, upsert: true, setDefaultsOnInsert: true }
);

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

module.exports = router;
