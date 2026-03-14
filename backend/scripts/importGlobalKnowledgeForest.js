#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const User = require('../models/User');
const Node = require('../models/Node');
const NodeSense = require('../models/NodeSense');
const DomainTitleRelation = require('../models/DomainTitleRelation');
const DomainTitleProjection = require('../models/DomainTitleProjection');

const DATA_DIR = path.join(__dirname, '..', 'seed', 'global_knowledge_forest');
const SEED_USERNAME = 'global_forest_seed_admin';
const SEED_PASSWORD = 'global_forest_seed_password_only_for_seed';
const NODE_ID_PREFIX = 'gkf:title:';
const BATCH_SIZE = 500;

const loadPartFiles = (dirPath, prefix) => {
  const files = fs.readdirSync(dirPath)
    .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  return files.flatMap((file) => JSON.parse(fs.readFileSync(path.join(dirPath, file), 'utf8')));
};

const loadDataset = () => {
  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`dataset directory not found: ${DATA_DIR}`);
  }
  const roots = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'roots.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'manifest.json'), 'utf8'));
  const stats = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'stats.json'), 'utf8'));
  const titles = loadPartFiles(DATA_DIR, 'titles.part');
  const senses = loadPartFiles(DATA_DIR, 'senses.part');
  const relations = loadPartFiles(DATA_DIR, 'sense_relations.part');
  return { roots, manifest, stats, titles, senses, relations };
};

const chunk = (list = [], size = BATCH_SIZE) => {
  const out = [];
  for (let index = 0; index < list.length; index += size) {
    out.push(list.slice(index, index + size));
  }
  return out;
};

const buildPosition = (rootIndex, localIndex) => {
  const cols = 7;
  const zoneWidth = 800 / cols;
  const zoneHeight = 250;
  const zoneCol = rootIndex % cols;
  const zoneRow = Math.floor(rootIndex / cols);
  const baseX = zoneCol * zoneWidth;
  const baseY = zoneRow * zoneHeight;
  const x = Math.min(799, Math.max(0, Math.round(baseX + 8 + ((localIndex % 12) * ((zoneWidth - 16) / 12)))));
  const y = Math.min(499, Math.max(0, Math.round(baseY + 8 + ((Math.floor(localIndex / 12) % 30) * ((zoneHeight - 16) / 30)))));
  return { x, y };
};

const readRootKeyFromTags = (tags = []) => {
  const row = (Array.isArray(tags) ? tags : []).find((item) => typeof item === 'string' && item.startsWith('root:'));
  return row ? row.slice(5) : '';
};

const ensureSeedUser = async () => {
  const existing = await User.findOne({ username: SEED_USERNAME });
  if (existing) return existing;

  const passwordHash = bcrypt.hashSync(SEED_PASSWORD, 8);
  const user = await User.create({
    username: SEED_USERNAME,
    password: passwordHash,
    plainPassword: '',
    role: 'admin',
    profession: '百科编目',
    location: '任意'
  });
  return user;
};

const bulkWriteBatches = async (Model, ops = [], label = 'ops') => {
  let processed = 0;
  let upserted = 0;
  let modified = 0;
  for (const [index, batch] of chunk(ops).entries()) {
    if (!batch.length) continue;
    const result = await Model.bulkWrite(batch, { ordered: false });
    processed += batch.length;
    upserted += result?.upsertedCount || 0;
    modified += result?.modifiedCount || 0;
    console.log(`[${label}] batch ${index + 1}/${Math.ceil(ops.length / BATCH_SIZE)} processed=${processed}`);
  }
  return { processed, upserted, modified };
};

const insertManyBatches = async (Model, docs = [], label = 'insert') => {
  let inserted = 0;
  for (const [index, batch] of chunk(docs).entries()) {
    if (!batch.length) continue;
    await Model.insertMany(batch, { ordered: false });
    inserted += batch.length;
    console.log(`[${label}] batch ${index + 1}/${Math.ceil(docs.length / BATCH_SIZE)} inserted=${inserted}`);
  }
  return { inserted };
};

async function main() {
  const dataset = loadDataset();
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';
  await mongoose.connect(mongoUri);

  try {
    const seedUser = await ensureSeedUser();
    const now = new Date();

    const rootsByKey = new Map(dataset.roots.map((item) => [item.key, item]));
    const titlesById = new Map(dataset.titles.map((item) => [item.titleId, item]));
    const sensesByTitleId = new Map();
    const senseById = new Map();

    dataset.senses.forEach((sense) => {
      const titleId = sense.titleId;
      if (!sensesByTitleId.has(titleId)) sensesByTitleId.set(titleId, []);
      sensesByTitleId.get(titleId).push(sense);
      senseById.set(sense.senseId, sense);
    });

    const desiredNodeIds = dataset.titles.map((title) => `${NODE_ID_PREFIX}${title.titleId}`);
    const generatedRows = await Node.find({ nodeId: { $regex: `^${NODE_ID_PREFIX}` } }).select('_id nodeId').lean();
    const obsoleteNodeIds = generatedRows
      .filter((item) => !desiredNodeIds.includes(item.nodeId))
      .map((item) => item._id);

    if (obsoleteNodeIds.length > 0) {
      await Promise.all([
        NodeSense.deleteMany({ nodeId: { $in: obsoleteNodeIds } }),
        DomainTitleRelation.deleteMany({
          $or: [
            { sourceNodeId: { $in: obsoleteNodeIds } },
            { targetNodeId: { $in: obsoleteNodeIds } }
          ]
        }),
        DomainTitleProjection.deleteMany({ nodeId: { $in: obsoleteNodeIds } }),
        Node.deleteMany({ _id: { $in: obsoleteNodeIds } })
      ]);
    }

    const existingNameCollisions = await Node.find({
      name: { $in: dataset.titles.map((item) => item.name) },
      nodeId: { $not: { $regex: `^${NODE_ID_PREFIX}` } }
    })
      .select('_id name nodeId status')
      .lean();

    console.log(`[audit] existing non-generated name collisions=${existingNameCollisions.length}`);

    const rootLocalIndexMap = new Map();
    const nodeOps = dataset.titles.map((title) => {
      const senses = (sensesByTitleId.get(title.titleId) || []).sort((a, b) => a.order - b.order);
      const primarySense = senses[0] || {};
      const rootKey = primarySense.rootKey || readRootKeyFromTags(primarySense.tags);
      const rootIndex = Math.max(0, dataset.roots.findIndex((item) => item.key === rootKey));
      const localIndex = rootLocalIndexMap.get(rootKey) || 0;
      rootLocalIndexMap.set(rootKey, localIndex + 1);
      const position = buildPosition(rootIndex, localIndex);

      return {
        updateOne: {
          filter: { nodeId: `${NODE_ID_PREFIX}${title.titleId}` },
          update: {
            $set: {
              owner: seedUser._id,
              domainMaster: seedUser._id,
              allianceId: null,
              name: title.name,
              description: primarySense.summary || `${title.name}的百科释义容器。`,
              synonymSenses: senses.map((sense) => ({
                senseId: sense.senseId,
                title: sense.senseLabel,
                content: sense.summary
              })),
              synonymSensesCount: senses.length,
              senseVersion: 1,
              senseWatermark: dataset.manifest.marker,
              senseCollectionUpdatedAt: now,
              senseEmbeddedUpdatedAt: now,
              position,
              contentScore: 1,
              relatedParentDomains: [],
              relatedChildDomains: [],
              associations: [],
              status: 'approved',
              lastUpdate: now,
              createdAt: now
            },
            $setOnInsert: {
              nodeId: `${NODE_ID_PREFIX}${title.titleId}`
            }
          },
          upsert: true
        }
      };
    });

    const nodeWriteResult = await bulkWriteBatches(Node, nodeOps, 'nodes');

    const nodeRows = await Node.find({ nodeId: { $in: desiredNodeIds } })
      .select('_id nodeId name description')
      .lean();
    const nodeByTitleId = new Map(
      nodeRows.map((row) => [String(row.nodeId || '').slice(NODE_ID_PREFIX.length), row])
    );
    const generatedObjectIds = nodeRows.map((row) => row._id);

    const associationMap = new Map();
    const relatedParentMap = new Map();
    const relatedChildMap = new Map();
    dataset.relations.forEach((relation) => {
      const sourceSense = senseById.get(relation.sourceSenseId);
      const targetSense = senseById.get(relation.targetSenseId);
      if (!sourceSense || !targetSense) return;

      const sourceNode = nodeByTitleId.get(sourceSense.titleId);
      const targetNode = nodeByTitleId.get(targetSense.titleId);
      const targetTitle = titlesById.get(targetSense.titleId);
      if (!sourceNode || !targetNode || !targetTitle) return;

      if (!associationMap.has(sourceSense.titleId)) associationMap.set(sourceSense.titleId, []);
      associationMap.get(sourceSense.titleId).push({
        targetNode: targetNode._id,
        sourceSenseId: sourceSense.senseId,
        targetSenseId: targetSense.senseId,
        relationType: relation.relationType,
        insertSide: '',
        insertGroupId: '',
        createdAt: now
      });

      if (relation.relationType === 'contains') {
        if (!relatedChildMap.has(sourceSense.titleId)) relatedChildMap.set(sourceSense.titleId, new Set());
        relatedChildMap.get(sourceSense.titleId).add(targetTitle.name);
      }
      if (relation.relationType === 'extends') {
        if (!relatedParentMap.has(sourceSense.titleId)) relatedParentMap.set(sourceSense.titleId, new Set());
        relatedParentMap.get(sourceSense.titleId).add(targetTitle.name);
      }
    });

    const associationOps = dataset.titles.map((title) => ({
      updateOne: {
        filter: { _id: nodeByTitleId.get(title.titleId)?._id },
        update: {
          $set: {
            associations: associationMap.get(title.titleId) || [],
            relatedParentDomains: Array.from(relatedParentMap.get(title.titleId) || []).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
            relatedChildDomains: Array.from(relatedChildMap.get(title.titleId) || []).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
            lastUpdate: now
          }
        }
      }
    })).filter((op) => op.updateOne.filter._id);

    const associationWriteResult = await bulkWriteBatches(Node, associationOps, 'associations');

    await Promise.all([
      NodeSense.deleteMany({ nodeId: { $in: generatedObjectIds } }),
      DomainTitleRelation.deleteMany({
        $or: [
          { sourceNodeId: { $in: generatedObjectIds } },
          { targetNodeId: { $in: generatedObjectIds } }
        ]
      }),
      DomainTitleProjection.deleteMany({ nodeId: { $in: generatedObjectIds } })
    ]);

    const nodeSenseDocs = dataset.senses.map((sense) => {
      const node = nodeByTitleId.get(sense.titleId);
      return {
        nodeId: node._id,
        senseId: sense.senseId,
        title: sense.senseLabel,
        content: sense.summary,
        contentFormat: 'legacy_markup',
        legacySummary: sense.summary,
        order: sense.order || 0,
        status: 'active',
        watermark: dataset.manifest.marker,
        createdBy: seedUser._id,
        updatedBy: seedUser._id,
        createdAt: now,
        updatedAt: now
      };
    });

    const relationDocs = dataset.relations.map((relation) => {
      const sourceSense = senseById.get(relation.sourceSenseId);
      const targetSense = senseById.get(relation.targetSenseId);
      const sourceNode = nodeByTitleId.get(sourceSense.titleId);
      const targetNode = nodeByTitleId.get(targetSense.titleId);
      return {
        sourceNodeId: sourceNode._id,
        targetNodeId: targetNode._id,
        relationType: relation.relationType,
        sourceSenseId: relation.sourceSenseId,
        targetSenseId: relation.targetSenseId,
        insertSide: '',
        insertGroupId: '',
        status: 'active',
        createdAt: now,
        updatedAt: now
      };
    });

    const projectionDocs = dataset.titles.map((title) => {
      const node = nodeByTitleId.get(title.titleId);
      const senses = sensesByTitleId.get(title.titleId) || [];
      return {
        nodeId: node._id,
        owner: seedUser._id,
        domainMaster: seedUser._id,
        domainAdmins: [],
        allianceId: null,
        name: title.name,
        description: senses[0]?.summary || `${title.name}的百科释义容器。`,
        relatedParentDomains: Array.from(relatedParentMap.get(title.titleId) || []),
        relatedChildDomains: Array.from(relatedChildMap.get(title.titleId) || []),
        contentScore: 1,
        knowledgePoint: { value: 0, lastUpdated: null },
        status: 'approved',
        isFeatured: false,
        featuredOrder: 0,
        createdAt: now,
        lastUpdate: now,
        updatedAt: now
      };
    });

    const nodeSenseInsertResult = await insertManyBatches(NodeSense, nodeSenseDocs, 'node_senses');
    const relationInsertResult = await insertManyBatches(DomainTitleRelation, relationDocs, 'relations');
    const projectionInsertResult = await insertManyBatches(DomainTitleProjection, projectionDocs, 'projections');

    const importedStats = {
      marker: dataset.manifest.marker,
      titleCount: nodeRows.length,
      senseCount: await NodeSense.countDocuments({ nodeId: { $in: generatedObjectIds } }),
      containsCount: await DomainTitleRelation.countDocuments({ sourceNodeId: { $in: generatedObjectIds }, relationType: 'contains' }),
      extendsCount: await DomainTitleRelation.countDocuments({ sourceNodeId: { $in: generatedObjectIds }, relationType: 'extends' }),
      rootSenseCount: dataset.stats.rootSenseCount,
      leafSenseCount: dataset.stats.leafSenseCount,
      rootDistribution: dataset.stats.rootDistribution
    };

    console.log(JSON.stringify({
      dataDir: DATA_DIR,
      nodeWriteResult,
      associationWriteResult,
      nodeSenseInsertResult,
      relationInsertResult,
      projectionInsertResult,
      existingNameCollisionCount: existingNameCollisions.length,
      existingNameCollisionSample: existingNameCollisions.slice(0, 20).map((item) => item.name),
      importedStats
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
