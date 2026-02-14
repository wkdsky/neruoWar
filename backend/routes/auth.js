const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // 验证输入
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: '用户名至少3个字符' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6个字符' });
    }
    
    // 检查用户是否已存在
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建用户
    const user = new User({ 
      username, 
      password: hashedPassword,
      plainPassword: password,
      role: 'common'
    });
    await user.save();

    // 生成token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    
    res.status(201).json({
      token,
      userId: user._id,
      username: user.username,
      role: user.role,
      location: user.location,
      profession: user.profession,
      avatar: user.avatar,
      gender: user.gender
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // 验证输入
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    
    // 查找用户
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 验证密码
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 生成token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      userId: user._id,
      username: user.username,
      role: user.role,
      location: user.location,
      profession: user.profession,
      avatar: user.avatar,
      gender: user.gender
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 更新用户location
router.put('/location', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { location } = req.body;

    if (!location || location.trim() === '') {
      return res.status(400).json({ error: 'location不能为空' });
    }

    const user = await User.findByIdAndUpdate(
      decoded.userId,
      { location: location },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      success: true,
      location: user.location
    });
  } catch (error) {
    console.error('更新location错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 找回密码（修改密码）
router.post('/reset-password', async (req, res) => {
  try {
    const { username, oldPassword, newPassword } = req.body;

    // 验证输入
    if (!username || !oldPassword || !newPassword) {
      return res.status(400).json({ error: '用户名、原密码和新密码不能为空' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少6个字符' });
    }

    // 查找用户
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: '用户名不存在' });
    }

    // 验证原密码
    const validPassword = await bcrypt.compare(oldPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '原密码错误' });
    }

    // 加密新密码
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // 更新密码
    user.password = hashedNewPassword;
    user.plainPassword = newPassword; // 同时更新明文密码（用于管理员查看）
    await user.save();

    res.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('重置密码错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取用户个人信息
router.get('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password -plainPassword');

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      userId: user._id,
      username: user.username,
      role: user.role,
      level: user.level,
      experience: user.experience,
      location: user.location,
      profession: user.profession,
      avatar: user.avatar,
      gender: user.gender,
      ownedNodes: user.ownedNodes,
      allianceId: user.allianceId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 修改头像
router.put('/profile/avatar', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { avatar } = req.body;

    // 验证头像ID是否为有效的默认头像
    const validAvatars = [
      'default_male_1', 'default_male_2', 'default_male_3',
      'default_female_1', 'default_female_2', 'default_female_3'
    ];

    if (!avatar || !validAvatars.includes(avatar)) {
      return res.status(400).json({ error: '无效的头像选择' });
    }

    const user = await User.findByIdAndUpdate(
      decoded.userId,
      { avatar },
      { new: true }
    ).select('-password -plainPassword');

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      success: true,
      avatar: user.avatar
    });
  } catch (error) {
    console.error('修改头像错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 修改密码（已登录状态）
router.put('/profile/password', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { oldPassword, newPassword } = req.body;

    // 验证输入
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '原密码和新密码不能为空' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少6个字符' });
    }

    // 查找用户
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 验证原密码
    const validPassword = await bcrypt.compare(oldPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '原密码错误' });
    }

    // 加密新密码
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // 更新密码
    user.password = hashedNewPassword;
    user.plainPassword = newPassword;
    await user.save();

    res.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('修改密码错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 修改性别
router.put('/profile/gender', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { gender } = req.body;

    // 验证性别值
    const validGenders = ['male', 'female', 'other'];
    if (!gender || !validGenders.includes(gender)) {
      return res.status(400).json({ error: '无效的性别选择' });
    }

    const user = await User.findByIdAndUpdate(
      decoded.userId,
      { gender },
      { new: true }
    ).select('-password -plainPassword');

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      success: true,
      gender: user.gender
    });
  } catch (error) {
    console.error('修改性别错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
