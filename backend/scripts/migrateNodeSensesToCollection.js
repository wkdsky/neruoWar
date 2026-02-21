const mongoose = require('mongoose');
require('dotenv').config();

const Node = require('../models/Node');
const NodeSense = require('../models/NodeSense');
const { normalizeSenseList } = require('../services/nodeSenseStore');

const normalizeEmbeddedSensesWithoutFallback = (source = []) => {
  const rows = Array.isArray(source) ? source : [];
  const deduped = [];
  const seenIds = new Set();
  const seenTitles = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const item = rows[i] || {};
    const rawSenseId = typeof item?.senseId === 'string' ? item.senseId.trim() : '';
    const senseId = rawSenseId || `sense_${i + 1}`;
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    const content = typeof item?.content === 'string' ? item.content.trim() : '';
    if (!title || !content) continue;
    const titleKey = title.toLowerCase();
    if (seenIds.has(senseId) || seenTitles.has(titleKey)) continue;
    seenIds.add(senseId);
    seenTitles.add(titleKey);
    deduped.push({ senseId, title, content });
  }
  return deduped;
};

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';

async function migrateNodeSenses() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已连接 MongoDB');

    const cursor = Node.find({})
      .select('_id synonymSenses description owner domainMaster')
      .lean()
      .cursor({ batchSize: 200 });

    let nodesScanned = 0;
    let legacySenseRows = 0;
    let upsertedRows = 0;
    let modifiedRows = 0;
    let deletedRows = 0;

    for await (const node of cursor) {
      nodesScanned += 1;
      const embedded = normalizeEmbeddedSensesWithoutFallback(node?.synonymSenses || []);
      let senses = embedded;
      if (senses.length === 0) {
        const existingRows = await NodeSense.find({
          nodeId: node._id,
          status: 'active'
        })
          .select('senseId title content order')
          .sort({ order: 1, senseId: 1, _id: 1 })
          .lean();
        if (existingRows.length > 0) {
          senses = existingRows.map((row) => ({
            senseId: String(row.senseId || '').trim(),
            title: String(row.title || '').trim(),
            content: String(row.content || '').trim()
          })).filter((row) => row.senseId && row.title && row.content);
        } else {
          senses = normalizeSenseList([], node?.description || '');
        }
      }
      legacySenseRows += senses.length;

      const ops = senses.map((sense, index) => ({
        updateOne: {
          filter: {
            nodeId: node._id,
            senseId: sense.senseId
          },
          update: {
            $set: {
              title: sense.title,
              content: sense.content,
              order: index,
              status: 'active',
              updatedBy: node?.domainMaster || node?.owner || null
            },
            $setOnInsert: {
              createdBy: node?.domainMaster || node?.owner || null
            }
          },
          upsert: true
        }
      }));

      if (ops.length > 0) {
        const result = await NodeSense.bulkWrite(ops, { ordered: false });
        upsertedRows += result?.upsertedCount || 0;
        modifiedRows += result?.modifiedCount || 0;
      }

      const keepSenseIds = senses.map((item) => item.senseId);
      const deleteResult = await NodeSense.deleteMany({
        nodeId: node._id,
        senseId: { $nin: keepSenseIds }
      });
      deletedRows += deleteResult?.deletedCount || 0;
    }

    console.log(`扫描节点数: ${nodesScanned}`);
    console.log(`旧释义行数(去重后): ${legacySenseRows}`);
    console.log(`新集合新增行数: ${upsertedRows}`);
    console.log(`新集合更新行数: ${modifiedRows}`);
    console.log(`新集合删除旧行数: ${deletedRows}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('迁移节点释义失败:', error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // ignore
    }
    process.exit(1);
  }
}

migrateNodeSenses();
