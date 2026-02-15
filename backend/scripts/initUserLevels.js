const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/node-game';

async function initUserLevels() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已连接到 MongoDB');

    const missingLevelResult = await User.updateMany(
      {
        $or: [
          { level: { $exists: false } },
          { level: null }
        ]
      },
      { $set: { level: 0 } }
    );

    const legacyDefaultResult = await User.updateMany(
      { level: 1 },
      { $set: { level: 0 } }
    );

    console.log(`缺失 level 初始化: matched=${missingLevelResult.matchedCount}, modified=${missingLevelResult.modifiedCount}`);
    console.log(`旧默认 level(1) 修正: matched=${legacyDefaultResult.matchedCount}, modified=${legacyDefaultResult.modifiedCount}`);
    console.log('用户等级初始化完成（默认 lv0）');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('初始化用户等级失败:', error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // ignore
    }
    process.exit(1);
  }
}

initUserLevels();
