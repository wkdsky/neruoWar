const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/node-game';

async function createAdmin() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已连接到 MongoDB');

    // 检查是否已有管理员
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      console.log('管理员账户已存在:', existingAdmin.username);
      process.exit(0);
    }

    // 创建管理员账户
    const adminUsername = 'admin';
    const adminPassword = 'admin123'; // 建议首次登录后修改
    const adminEmail = 'admin@example.com';

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    const admin = new User({
      username: adminUsername,
      email: adminEmail,
      password: hashedPassword,
      role: 'admin'
    });

    await admin.save();

    console.log('管理员账户创建成功！');
    console.log('用户名:', adminUsername);
    console.log('密码:', adminPassword);
    console.log('请在首次登录后修改密码');

    process.exit(0);
  } catch (error) {
    console.error('创建管理员失败:', error);
    process.exit(1);
  }
}

createAdmin();