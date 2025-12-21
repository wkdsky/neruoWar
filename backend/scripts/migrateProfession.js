const mongoose = require('mongoose');
const User = require('../models/User');
const Node = require('../models/Node');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/node-game';

async function migrateProfession() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已连接到 MongoDB');

    // 1. 更新所有管理员用户的职业为"秩序"
    const adminResult = await User.updateMany(
      { role: 'admin' },
      { $set: { profession: '秩序' } }
    );
    console.log(`已更新 ${adminResult.modifiedCount} 个管理员用户的职业为"秩序"`);

    // 2. 找到所有作为域主的用户ID
    const nodesWithMasters = await Node.find({
      domainMaster: { $ne: null }
    }).distinct('domainMaster');

    console.log(`找到 ${nodesWithMasters.length} 个拥有域主身份的用户`);

    // 更新拥有域主身份的普通用户职业为"卫道"
    const domainMasterResult = await User.updateMany(
      {
        _id: { $in: nodesWithMasters },
        role: { $ne: 'admin' }  // 排除管理员
      },
      { $set: { profession: '卫道' } }
    );
    console.log(`已更新 ${domainMasterResult.modifiedCount} 个域主用户的职业为"卫道"`);

    // 3. 更新其他普通用户的职业为"求知"
    const commonResult = await User.updateMany(
      {
        role: { $ne: 'admin' },
        _id: { $nin: nodesWithMasters }
      },
      { $set: { profession: '求知' } }
    );
    console.log(`已更新 ${commonResult.modifiedCount} 个普通用户的职业为"求知"`);

    // 统计结果
    const totalUsers = await User.countDocuments();
    const adminCount = await User.countDocuments({ profession: '秩序' });
    const domainMasterCount = await User.countDocuments({ profession: '卫道' });
    const seekerCount = await User.countDocuments({ profession: '求知' });

    console.log('\n=== 迁移完成统计 ===');
    console.log(`总用户数: ${totalUsers}`);
    console.log(`秩序（管理员）: ${adminCount}`);
    console.log(`卫道（域主）: ${domainMasterCount}`);
    console.log(`求知（普通用户）: ${seekerCount}`);

    process.exit(0);
  } catch (error) {
    console.error('职业迁移失败:', error);
    process.exit(1);
  }
}

migrateProfession();
