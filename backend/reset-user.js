const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
require('dotenv').config();

// 使用方法: node reset-user.js 用户名 新密码
// 例如: node reset-user.js admin 123456

async function resetUserPassword() {
  try {
    const username = process.argv[2];
    const newPassword = process.argv[3];

    if (!username || !newPassword) {
      console.log('使用方法: node reset-user.js 用户名 新密码');
      console.log('例如: node reset-user.js admin 123456');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game');
    console.log('已连接到数据库');

    const user = await User.findOne({ username });
    
    if (!user) {
      console.log(`用户 ${username} 不存在！`);
      
      // 显示所有现有用户
      const allUsers = await User.find({});
      console.log('\n现有用户列表:');
      allUsers.forEach(u => {
        console.log(`- ${u.username} (ID: ${u._id})`);
      });
      
      process.exit(1);
    }

    // 重置密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.plainPassword = newPassword;
    await user.save();

    console.log(`\n成功重置用户 ${username} 的密码！`);
    console.log(`新密码: ${newPassword}`);
    console.log(`明文密码已保存: ${user.plainPassword}`);
    
    process.exit(0);
  } catch (error) {
    console.error('重置密码错误:', error);
    process.exit(1);
  }
}

resetUserPassword();