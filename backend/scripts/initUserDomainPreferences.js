const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/node-game';

async function initUserDomainPreferences() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已连接到 MongoDB');

    const favoriteResult = await User.updateMany(
      {
        $or: [
          { favoriteDomains: { $exists: false } },
          { favoriteDomains: null }
        ]
      },
      { $set: { favoriteDomains: [] } }
    );

    const recentResult = await User.updateMany(
      {
        $or: [
          { recentVisitedDomains: { $exists: false } },
          { recentVisitedDomains: null }
        ]
      },
      { $set: { recentVisitedDomains: [] } }
    );

    const notificationsResult = await User.updateMany(
      {
        $or: [
          { notifications: { $exists: false } },
          { notifications: null }
        ]
      },
      { $set: { notifications: [] } }
    );

    console.log(`favoriteDomains 初始化: matched=${favoriteResult.matchedCount}, modified=${favoriteResult.modifiedCount}`);
    console.log(`recentVisitedDomains 初始化: matched=${recentResult.matchedCount}, modified=${recentResult.modifiedCount}`);
    console.log(`notifications 初始化: matched=${notificationsResult.matchedCount}, modified=${notificationsResult.modifiedCount}`);
    console.log('用户知识域偏好字段初始化完成');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('初始化用户知识域偏好字段失败:', error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // ignore
    }
    process.exit(1);
  }
}

initUserDomainPreferences();
