const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');

// 获取所有用户的完整信息（包括明文密码）
router.get('/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .select('+plainPassword')  // 包含明文密码
      .sort({ createdAt: -1 })
      .lean();  // 转换为普通对象

    // 返回所有字段
    const usersData = users.map(user => ({
      _id: user._id,
      username: user.username,
      password: user.plainPassword || '未保存',  // 明文密码
      hashedPassword: user.password,  // 哈希密码（如果你想看）
      level: user.level,
      experience: user.experience,
      profession: user.profession,
      ownedNodes: user.ownedNodes,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      __v: user.__v
    }));

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

    if (password !== undefined) {
      // 保存明文密码和哈希密码
      user.plainPassword = password;
      user.password = await bcrypt.hash(password, 10);
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

module.exports = router;