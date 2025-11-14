const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/node-game';

async function createAdmin() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已连接到 MongoDB');

    // 检查是否已有用户名为admin的用户
    const existingUser = await User.findOne({ username: 'wkd' });
    if (existingUser) {
      // 如果存在，更新其role为admin
      existingUser.role = 'admin';
      await existingUser.save();
      console.log('已更新现有用户为管理员:', existingUser.username);
    } else {
      // 创建管理员账户
      const adminUsername = 'wkd';
      const adminPassword = 'wkd123'; // 建议首次登录后修改

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(adminPassword, salt);

      const admin = new User({
        username: adminUsername,
        password: hashedPassword,
        plainPassword: adminPassword,
        role: 'admin'
      });

      await admin.save();
      console.log('管理员账户创建成功！');
      console.log('用户名:', adminUsername);
      console.log('密码:', adminPassword);
    }

    console.log('请在首次登录后修改密码');

    process.exit(0);
  } catch (error) {
    console.error('创建管理员失败:', error);
    process.exit(1);
  }
}

createAdmin();
