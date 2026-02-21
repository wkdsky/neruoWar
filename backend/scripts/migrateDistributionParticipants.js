const mongoose = require('mongoose');
require('dotenv').config();

const Node = require('../models/Node');
const DistributionParticipant = require('../models/DistributionParticipant');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

async function migrateDistributionParticipants() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已连接到 MongoDB');

    const nodes = await Node.find({
      status: 'approved',
      knowledgeDistributionLocked: { $ne: null }
    }).select('_id knowledgeDistributionLocked');

    let nodeCount = 0;
    let participantRows = 0;
    let upsertedRows = 0;

    for (const node of nodes) {
      nodeCount += 1;
      const lock = node?.knowledgeDistributionLocked;
      if (!lock?.executeAt) continue;
      const executeAt = new Date(lock.executeAt);
      if (!Number.isFinite(executeAt.getTime()) || executeAt.getTime() <= 0) continue;

      const participants = Array.isArray(lock.participants) ? lock.participants : [];
      const ops = [];
      for (const item of participants) {
        const userId = getIdString(item?.userId);
        if (!mongoose.Types.ObjectId.isValid(userId)) continue;
        participantRows += 1;
        const joinedAt = item?.joinedAt ? new Date(item.joinedAt) : new Date();
        const exitedAt = item?.exitedAt ? new Date(item.exitedAt) : null;
        ops.push({
          updateOne: {
            filter: {
              nodeId: node._id,
              executeAt,
              userId: new mongoose.Types.ObjectId(userId)
            },
            update: {
              $set: {
                joinedAt: Number.isFinite(joinedAt.getTime()) ? joinedAt : new Date(),
                exitedAt: exitedAt && Number.isFinite(exitedAt.getTime()) ? exitedAt : null
              }
            },
            upsert: true
          }
        });
      }

      if (ops.length > 0) {
        const result = await DistributionParticipant.bulkWrite(ops, { ordered: false });
        upsertedRows += (result?.upsertedCount || 0) + (result?.modifiedCount || 0);
      }
    }

    console.log(`扫描节点数: ${nodeCount}`);
    console.log(`扫描参与者行数: ${participantRows}`);
    console.log(`写入/更新行数: ${upsertedRows}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('迁移分发参与者失败:', error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // ignore
    }
    process.exit(1);
  }
}

migrateDistributionParticipants();

