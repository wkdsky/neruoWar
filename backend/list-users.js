const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function listAllUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game');
    console.log('已连接到数据库\n');

    const users = await User.find({});
    
    console.log(`总用户数: ${users.length}\n`);
    console.log('用户列表:');
    console.log('================================================');
    
    users.forEach((user, index) => {
      console.log(`${index + 1}. 用户名: ${user.username}`);
      console.log(`   ID: ${user._id}`);
      console.log(`   明文密码: ${user.plainPassword || '未保存'}`);
      console.log(`   密码哈希: ${user.password.substring(0, 30)}...`);
      console.log(`   等级: ${user.level}`);
      console.log(`   经验: ${user.experience}`);
      console.log(`   创建时间: ${user.createdAt}`);
      console.log('------------------------------------------------');
    });
    
    process.exit(0);
  } catch (error) {
    console.error('查询错误:', error);
    process.exit(1);
  }
}

listAllUsers();