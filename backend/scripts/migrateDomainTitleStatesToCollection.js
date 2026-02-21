const mongoose = require('mongoose');
require('dotenv').config();

const Node = require('../models/Node');
const DomainDefenseLayout = require('../models/DomainDefenseLayout');
const DomainSiegeState = require('../models/DomainSiegeState');
const {
  createDefaultDefenseLayout,
  createDefaultSiegeState,
  hasLegacyDefenseLayoutData,
  hasLegacySiegeStateData,
  normalizeDefenseLayout,
  normalizeSiegeState
} = require('../services/domainTitleStateStore');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const text = String(value);
  if (!mongoose.Types.ObjectId.isValid(text)) return null;
  return new mongoose.Types.ObjectId(text);
};

const BATCH_SIZE = 200;

const processBatch = async (nodes = [], metrics) => {
  if (!Array.isArray(nodes) || nodes.length === 0) return;
  const nodeIds = nodes.map((item) => item?._id).filter(Boolean);
  const [existingDefenseRows, existingSiegeRows] = await Promise.all([
    DomainDefenseLayout.find({ nodeId: { $in: nodeIds } })
      .select('nodeId buildings intelBuildingId gateDefense gateDefenseViewAdminIds updatedAt')
      .lean(),
    DomainSiegeState.find({ nodeId: { $in: nodeIds } })
      .select('nodeId cheng qi')
      .lean()
  ]);

  const existingDefenseMap = new Map(existingDefenseRows.map((item) => [String(item.nodeId), item]));
  const existingSiegeMap = new Map(existingSiegeRows.map((item) => [String(item.nodeId), item]));
  const defenseOps = [];
  const siegeOps = [];

  for (const node of nodes) {
    const nodeId = node?._id;
    if (!nodeId) continue;
    metrics.nodesScanned += 1;
    const key = String(nodeId);
    const actorUserId = toObjectIdOrNull(node?.domainMaster) || toObjectIdOrNull(node?.owner) || null;

    let nextDefenseLayout;
    if (hasLegacyDefenseLayoutData(node)) {
      metrics.nodesWithLegacyDefense += 1;
      nextDefenseLayout = normalizeDefenseLayout(node.cityDefenseLayout);
    } else if (existingDefenseMap.has(key)) {
      nextDefenseLayout = normalizeDefenseLayout(existingDefenseMap.get(key));
    } else {
      nextDefenseLayout = createDefaultDefenseLayout();
    }
    defenseOps.push({
      updateOne: {
        filter: { nodeId },
        update: {
          $set: {
            buildings: nextDefenseLayout.buildings,
            intelBuildingId: nextDefenseLayout.intelBuildingId,
            gateDefense: nextDefenseLayout.gateDefense,
            gateDefenseViewAdminIds: nextDefenseLayout.gateDefenseViewAdminIds,
            updatedAt: nextDefenseLayout.updatedAt || new Date(),
            updatedBy: actorUserId
          }
        },
        upsert: true
      }
    });

    let nextSiegeState;
    if (hasLegacySiegeStateData(node)) {
      metrics.nodesWithLegacySiege += 1;
      nextSiegeState = normalizeSiegeState(node.citySiegeState);
    } else if (existingSiegeMap.has(key)) {
      nextSiegeState = normalizeSiegeState(existingSiegeMap.get(key));
    } else {
      nextSiegeState = createDefaultSiegeState();
    }
    siegeOps.push({
      updateOne: {
        filter: { nodeId },
        update: {
          $set: {
            cheng: nextSiegeState.cheng,
            qi: nextSiegeState.qi,
            updatedAt: new Date(),
            updatedBy: actorUserId
          }
        },
        upsert: true
      }
    });
  }

  if (defenseOps.length > 0) {
    const defenseResult = await DomainDefenseLayout.bulkWrite(defenseOps, { ordered: false });
    metrics.defenseUpserts += defenseResult?.upsertedCount || 0;
    metrics.defenseUpdates += defenseResult?.modifiedCount || 0;
  }
  if (siegeOps.length > 0) {
    const siegeResult = await DomainSiegeState.bulkWrite(siegeOps, { ordered: false });
    metrics.siegeUpserts += siegeResult?.upsertedCount || 0;
    metrics.siegeUpdates += siegeResult?.modifiedCount || 0;
  }
};

async function migrateDomainTitleStates() {
  const metrics = {
    nodesScanned: 0,
    nodesWithLegacyDefense: 0,
    nodesWithLegacySiege: 0,
    defenseUpserts: 0,
    defenseUpdates: 0,
    siegeUpserts: 0,
    siegeUpdates: 0
  };

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已连接 MongoDB');

    const cursor = Node.collection.find(
      {},
      {
        projection: {
          _id: 1,
          owner: 1,
          domainMaster: 1,
          cityDefenseLayout: 1,
          citySiegeState: 1
        }
      }
    ).batchSize(BATCH_SIZE);

    let buffer = [];
    for await (const node of cursor) {
      buffer.push(node);
      if (buffer.length >= BATCH_SIZE) {
        await processBatch(buffer, metrics);
        buffer = [];
      }
    }
    await processBatch(buffer, metrics);

    const [defenseRows, siegeRows] = await Promise.all([
      DomainDefenseLayout.countDocuments({}),
      DomainSiegeState.countDocuments({})
    ]);

    console.log(`扫描节点数: ${metrics.nodesScanned}`);
    console.log(`含旧城防布局节点数: ${metrics.nodesWithLegacyDefense}`);
    console.log(`含旧围城状态节点数: ${metrics.nodesWithLegacySiege}`);
    console.log(`城防集合新增行: ${metrics.defenseUpserts}`);
    console.log(`城防集合更新行: ${metrics.defenseUpdates}`);
    console.log(`围城集合新增行: ${metrics.siegeUpserts}`);
    console.log(`围城集合更新行: ${metrics.siegeUpdates}`);
    console.log(`城防集合总行数: ${defenseRows}`);
    console.log(`围城集合总行数: ${siegeRows}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('迁移标题层状态失败:', error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // ignore
    }
    process.exit(1);
  }
}

migrateDomainTitleStates();
