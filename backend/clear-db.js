const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function clearDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game');
    console.log('已连接到数据库');

    const result = await User.deleteMany({});
    console.log(`已删除 ${result.deletedCount} 个用户`);
    
    console.log('\n数据库已清空！');
    console.log('现在可以重新注册用户了。');
    
    process.exit(0);
  } catch (error) {
    console.error('清空数据库错误:', error);
    process.exit(1);
  }
}

clearDatabase();