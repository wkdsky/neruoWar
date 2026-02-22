const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const User = require('../models/User');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';

async function resetAllDataAndBootstrapAdmin() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已连接数据库，开始清空所有数据...');

    await mongoose.connection.dropDatabase();
    console.log('数据库已清空完成。');

    const adminPassword = '123456';
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const admin = await User.create({
      username: 'admin',
      password: passwordHash,
      plainPassword: adminPassword,
      role: 'admin',
      location: '任意'
    });

    console.log('管理员账户已重建:');
    console.log(`- 用户名: ${admin.username}`);
    console.log(`- 密码: ${adminPassword}`);
    console.log(`- 角色: ${admin.role}`);
  } catch (error) {
    console.error('重置失败:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

if (require.main === module) {
  resetAllDataAndBootstrapAdmin();
}

module.exports = resetAllDataAndBootstrapAdmin;
