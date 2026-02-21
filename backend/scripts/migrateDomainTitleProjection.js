const mongoose = require('mongoose');
require('dotenv').config();

const Node = require('../models/Node');
const DomainTitleProjection = require('../models/DomainTitleProjection');
const DomainTitleRelation = require('../models/DomainTitleRelation');
const {
  syncDomainTitleProjectionFromNode,
  normalizeAssociationsForProjection
} = require('../services/domainTitleProjectionStore');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';

async function run() {
  const metrics = {
    scannedNodes: 0,
    projectionUpserts: 0,
    projectionModified: 0,
    relationUpserts: 0,
    relationModified: 0,
    relationDeleted: 0,
    normalizedRelationRows: 0
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
          domainAdmins: 1,
          allianceId: 1,
          name: 1,
          description: 1,
          relatedParentDomains: 1,
          relatedChildDomains: 1,
          contentScore: 1,
          knowledgePoint: 1,
          status: 1,
          isFeatured: 1,
          featuredOrder: 1,
          createdAt: 1,
          lastUpdate: 1,
          associations: 1
        }
      }
    ).batchSize(200);

    for await (const node of cursor) {
      metrics.scannedNodes += 1;
      metrics.normalizedRelationRows += normalizeAssociationsForProjection(node?.associations).length;
      const syncResult = await syncDomainTitleProjectionFromNode(node);
      metrics.projectionUpserts += syncResult?.projectionResult?.upserted || 0;
      metrics.projectionModified += syncResult?.projectionResult?.modified || 0;
      metrics.relationUpserts += syncResult?.relationResult?.upserted || 0;
      metrics.relationModified += syncResult?.relationResult?.modified || 0;
      metrics.relationDeleted += syncResult?.relationResult?.deleted || 0;
    }

    const [projectionRows, relationRows] = await Promise.all([
      DomainTitleProjection.countDocuments({}),
      DomainTitleRelation.countDocuments({ status: 'active' })
    ]);

    console.log(`扫描节点数: ${metrics.scannedNodes}`);
    console.log(`标题投影新增: ${metrics.projectionUpserts}`);
    console.log(`标题投影更新: ${metrics.projectionModified}`);
    console.log(`关系边新增: ${metrics.relationUpserts}`);
    console.log(`关系边更新: ${metrics.relationModified}`);
    console.log(`关系边删除: ${metrics.relationDeleted}`);
    console.log(`标准化关系行数: ${metrics.normalizedRelationRows}`);
    console.log(`标题投影总行数: ${projectionRows}`);
    console.log(`关系边总行数: ${relationRows}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('迁移标题投影失败:', error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // ignore
    }
    process.exit(1);
  }
}

run();
