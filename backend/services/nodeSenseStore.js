const mongoose = require('mongoose');
const Node = require('../models/Node');
const NodeSense = require('../models/NodeSense');
const schedulerService = require('./schedulerService');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// NodeSense 集合作为释义单一真值源（SoT）；embedded 仅作兼容缓存与回退副本。
const isNodeSenseCollectionReadEnabled = () => process.env.NODE_SENSE_COLLECTION_READ !== 'false';
const isNodeSenseCollectionWriteEnabled = () => process.env.NODE_SENSE_COLLECTION_WRITE !== 'false';
// 自动修复总开关：控制 backfill/materialize 两类修复任务是否入队。
const isNodeSenseRepairEnabled = () => process.env.NODE_SENSE_REPAIR_ENABLED !== 'false';

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const text = String(value);
  if (!mongoose.Types.ObjectId.isValid(text)) return null;
  return new mongoose.Types.ObjectId(text);
};

const toIdString = (value) => {
  if (!value) return '';
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id && value._id !== value) return toIdString(value._id);
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const normalizeSenseId = (value, fallbackIndex = 0) => {
  const source = typeof value === 'string' ? value.trim() : '';
  if (source) return source.slice(0, 80);
  return `sense_${fallbackIndex + 1}`;
};

const normalizeSenseList = (source = [], fallbackDescription = '') => {
  const list = Array.isArray(source) ? source : [];
  const deduped = [];
  const seenIds = new Set();
  const seenTitles = new Set();

  list.forEach((item, index) => {
    const senseId = normalizeSenseId(item?.senseId, index);
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    const content = typeof item?.content === 'string' ? item.content.trim() : '';
    if (!title || !content) return;
    const titleKey = title.toLowerCase();
    if (seenIds.has(senseId) || seenTitles.has(titleKey)) return;
    seenIds.add(senseId);
    seenTitles.add(titleKey);
    deduped.push({
      senseId,
      title,
      content,
      order: deduped.length
    });
  });

  if (deduped.length > 0) return deduped;
  const content = typeof fallbackDescription === 'string' && fallbackDescription.trim()
    ? fallbackDescription.trim()
    : '暂无释义内容';
  return [{
    senseId: 'sense_1',
    title: '基础释义',
    content,
    order: 0
  }];
};

const loadNodeSenseMapByNodeIds = async (nodeIds = []) => {
  const objectIds = Array.from(new Set(
    (Array.isArray(nodeIds) ? nodeIds : [])
      .map((item) => toObjectIdOrNull(item))
      .filter(Boolean)
      .map((item) => String(item))
  )).map((item) => new mongoose.Types.ObjectId(item));

  if (objectIds.length === 0) return new Map();

  const rows = await NodeSense.find({
    nodeId: { $in: objectIds },
    status: 'active'
  })
    .select('nodeId senseId title content order')
    .sort({ nodeId: 1, order: 1, senseId: 1, _id: 1 })
    .lean();

  const map = new Map();
  rows.forEach((row) => {
    const nodeId = String(row.nodeId);
    if (!map.has(nodeId)) {
      map.set(nodeId, []);
    }
    map.get(nodeId).push({
      senseId: row.senseId,
      title: row.title,
      content: row.content,
      order: Number.isFinite(Number(row.order)) ? Number(row.order) : 0
    });
  });
  return map;
};

const hydrateNodeSensesForNodes = async (nodes = []) => {
  if (!isNodeSenseCollectionReadEnabled()) return nodes;
  const rows = Array.isArray(nodes) ? nodes : [];
  if (rows.length === 0) return rows;
  rows.forEach((node) => {
    if (!node || typeof node !== 'object') return;
    node.__senseCollectionHydrated = true;
  });

  const nodeIds = rows
    .map((item) => item?._id)
    .filter((id) => isValidObjectId(String(id)))
    .map((id) => String(id));

  if (nodeIds.length === 0) return rows;

  const senseMap = await loadNodeSenseMapByNodeIds(nodeIds);
  rows.forEach((node) => {
    if (!node) return;
    const key = String(node._id || '');
    const mapped = senseMap.get(key);
    if (!Array.isArray(mapped) || mapped.length === 0) return;
    node.__senseCollectionRows = mapped;
  });
  return rows;
};

// 统一读路径：集合优先，嵌入兜底。
// 返回 shouldEnqueueBackfill，供路由层在集合 miss 且 embedded 存在时入队修复。
const resolveNodeSensesForNode = (nodeDoc = {}, options = {}) => {
  const fallbackDescription = typeof options?.fallbackDescription === 'string'
    ? options.fallbackDescription
    : (typeof nodeDoc?.description === 'string' ? nodeDoc.description : '');
  const collectionReadEnabled = isNodeSenseCollectionReadEnabled();
  const collectionHydrated = nodeDoc?.__senseCollectionHydrated === true;
  const collectionRows = Array.isArray(nodeDoc?.__senseCollectionRows) ? nodeDoc.__senseCollectionRows : [];
  const embeddedRows = Array.isArray(nodeDoc?.synonymSenses) ? nodeDoc.synonymSenses : [];

  if (collectionReadEnabled && collectionHydrated && collectionRows.length > 0) {
    return {
      senses: normalizeSenseList(collectionRows, fallbackDescription),
      source: 'collection',
      shouldEnqueueBackfill: false
    };
  }

  const senses = normalizeSenseList(embeddedRows, fallbackDescription);
  const shouldEnqueueBackfill = (
    collectionReadEnabled
    && collectionHydrated
    && collectionRows.length === 0
    && embeddedRows.length > 0
    && isNodeSenseRepairEnabled()
  );

  return {
    senses,
    source: 'embedded',
    shouldEnqueueBackfill
  };
};

const upsertNodeSensesReplace = async ({
  nodeId,
  senses = [],
  actorUserId = null,
  watermark = ''
} = {}) => {
  if (!isNodeSenseCollectionWriteEnabled()) {
    return { skipped: true, upserted: 0, modified: 0, deleted: 0 };
  }
  const safeNodeId = toObjectIdOrNull(nodeId);
  if (!safeNodeId) {
    return { skipped: false, upserted: 0, modified: 0, deleted: 0 };
  }

  const normalized = normalizeSenseList(senses).map((item, index) => ({
    senseId: item.senseId,
    title: item.title,
    content: item.content,
    order: index
  }));

  const actorId = toObjectIdOrNull(actorUserId);
  const safeWatermark = typeof watermark === 'string' ? watermark.trim() : '';
  const ops = normalized.map((item) => ({
    updateOne: {
      filter: {
        nodeId: safeNodeId,
        senseId: item.senseId
      },
      update: {
        $set: {
          title: item.title,
          content: item.content,
          order: item.order,
          status: 'active',
          updatedBy: actorId || null,
          watermark: safeWatermark
        },
        $setOnInsert: {
          createdBy: actorId || null
        }
      },
      upsert: true
    }
  }));

  let upserted = 0;
  let modified = 0;
  if (ops.length > 0) {
    const result = await NodeSense.bulkWrite(ops, { ordered: false });
    upserted = result?.upsertedCount || 0;
    modified = result?.modifiedCount || 0;
  }

  const keepIds = normalized.map((item) => item.senseId);
  const deleteFilter = {
    nodeId: safeNodeId
  };
  if (keepIds.length > 0) {
    deleteFilter.senseId = { $nin: keepIds };
  }
  const deleteResult = await NodeSense.deleteMany(deleteFilter);
  return {
    skipped: false,
    upserted,
    modified,
    deleted: deleteResult?.deletedCount || 0
  };
};

const enqueueNodeSenseMaterializeJob = async ({ nodeId, expectedWatermark, expectedVersion }) => {
  const safeNodeId = toIdString(nodeId);
  if (!isValidObjectId(safeNodeId)) return;
  const safeVersion = Number.isFinite(Number(expectedVersion)) ? Number(expectedVersion) : 0;
  await schedulerService.enqueue({
    type: 'node_sense_materialize_job',
    payload: {
      nodeId: safeNodeId,
      expectedWatermark: typeof expectedWatermark === 'string' ? expectedWatermark : '',
      expectedVersion: safeVersion
    },
    dedupeKey: `node_sense_materialize:${safeNodeId}:${safeVersion}`
  });
};

const enqueueNodeSenseBackfillJob = async ({ nodeId, actorUserId = null, senseVersion = 0 }) => {
  const safeNodeId = toIdString(nodeId);
  if (!isValidObjectId(safeNodeId)) return;
  const safeVersion = Number.isFinite(Number(senseVersion)) ? Number(senseVersion) : 0;
  await schedulerService.enqueue({
    type: 'node_sense_backfill_job',
    payload: {
      nodeId: safeNodeId,
      actorUserId: toIdString(actorUserId) || null
    },
    dedupeKey: `node_sense_backfill:${safeNodeId}:${safeVersion}`
  });
};

// 统一写入口：写后返回本次规范化结果，保证写后读一致。
// 注意：不做集合写失败隐式降级；WRITE 开启时集合写失败直接抛错。
const saveNodeSenses = async ({
  nodeId,
  senses = [],
  actorUserId = null,
  fallbackDescription = ''
} = {}) => {
  const safeNodeId = toObjectIdOrNull(nodeId);
  if (!safeNodeId) {
    throw new Error('保存释义失败：无效 nodeId');
  }

  let effectiveFallbackDescription = typeof fallbackDescription === 'string' ? fallbackDescription : '';
  if (!effectiveFallbackDescription.trim()) {
    const nodeForDescription = await Node.findById(safeNodeId).select('description').lean();
    effectiveFallbackDescription = typeof nodeForDescription?.description === 'string'
      ? nodeForDescription.description
      : '';
  }

  const normalizedSenses = normalizeSenseList(senses, effectiveFallbackDescription);
  const normalizedEmbedded = normalizedSenses.map((item) => ({
    senseId: item.senseId,
    title: item.title,
    content: item.content
  }));

  const now = new Date();
  const senseWatermark = new mongoose.Types.ObjectId().toString();
  const collectionWriteEnabled = isNodeSenseCollectionWriteEnabled();

  if (collectionWriteEnabled) {
    await upsertNodeSensesReplace({
      nodeId: safeNodeId,
      senses: normalizedSenses,
      actorUserId,
      watermark: senseWatermark
    });
  }

  const setPayload = {
    synonymSenses: normalizedEmbedded,
    synonymSensesCount: normalizedSenses.length,
    senseWatermark,
    senseEmbeddedUpdatedAt: now
  };
  if (collectionWriteEnabled) {
    setPayload.senseCollectionUpdatedAt = now;
  }

  const updatedNode = await Node.findOneAndUpdate(
    { _id: safeNodeId },
    {
      $set: setPayload,
      $inc: { senseVersion: 1 }
    },
    {
      new: true,
      projection: '_id senseVersion senseWatermark'
    }
  ).lean();

  if (!updatedNode) {
    throw new Error(`保存释义失败：节点不存在 nodeId=${safeNodeId.toString()}`);
  }

  const senseVersion = Number.isFinite(Number(updatedNode.senseVersion))
    ? Number(updatedNode.senseVersion)
    : 0;

  if (collectionWriteEnabled && isNodeSenseRepairEnabled()) {
    await enqueueNodeSenseMaterializeJob({
      nodeId: safeNodeId,
      expectedWatermark: senseWatermark,
      expectedVersion: senseVersion
    });
  }

  return {
    senses: normalizedSenses,
    senseVersion,
    senseWatermark
  };
};

// worker 任务：collection -> embedded 物化。幂等 + 版本/水位线防旧任务回写覆盖。
const materializeNodeSensesToEmbedded = async ({
  nodeId,
  expectedWatermark = '',
  expectedVersion = null
} = {}) => {
  const safeNodeId = toObjectIdOrNull(nodeId);
  if (!safeNodeId) {
    return { skipped: true, reason: 'invalid_node_id' };
  }

  const node = await Node.findById(safeNodeId)
    .select('_id description senseVersion senseWatermark')
    .lean();
  if (!node) {
    return { skipped: true, reason: 'node_not_found' };
  }

  const rows = await NodeSense.find({
    nodeId: safeNodeId,
    status: 'active'
  })
    .select('senseId title content order')
    .sort({ order: 1, senseId: 1, _id: 1 })
    .lean();

  if (!rows.length) {
    return { skipped: true, reason: 'collection_empty' };
  }

  const normalized = normalizeSenseList(rows, node.description || '');
  const normalizedEmbedded = normalized.map((item) => ({
    senseId: item.senseId,
    title: item.title,
    content: item.content
  }));

  const filter = { _id: safeNodeId };
  const guardList = [];
  const safeWatermark = typeof expectedWatermark === 'string' ? expectedWatermark.trim() : '';
  const safeExpectedVersion = Number.isFinite(Number(expectedVersion)) ? Number(expectedVersion) : null;
  if (safeWatermark) {
    guardList.push({ senseWatermark: safeWatermark });
  }
  if (safeExpectedVersion !== null) {
    guardList.push({ senseVersion: { $lte: safeExpectedVersion } });
  }
  if (guardList.length > 0) {
    filter.$or = guardList;
  }

  const now = new Date();
  const result = await Node.updateOne(filter, {
    $set: {
      synonymSenses: normalizedEmbedded,
      synonymSensesCount: normalized.length,
      senseEmbeddedUpdatedAt: now,
      senseMaterializedAt: now
    }
  });

  return {
    skipped: false,
    matchedCount: result?.matchedCount || 0,
    modifiedCount: result?.modifiedCount || 0
  };
};

// worker 任务：embedded -> collection 回填。幂等：集合已有 active 行则直接跳过。
const backfillNodeSenseCollectionFromEmbedded = async ({ nodeId, actorUserId = null } = {}) => {
  const safeNodeId = toObjectIdOrNull(nodeId);
  if (!safeNodeId) {
    return { skipped: true, reason: 'invalid_node_id' };
  }
  if (!isNodeSenseCollectionWriteEnabled()) {
    return { skipped: true, reason: 'collection_write_disabled' };
  }

  const existingActiveCount = await NodeSense.countDocuments({
    nodeId: safeNodeId,
    status: 'active'
  });
  if (existingActiveCount > 0) {
    return { skipped: true, reason: 'collection_already_has_rows', existingActiveCount };
  }

  const node = await Node.findById(safeNodeId)
    .select('_id description synonymSenses senseWatermark')
    .lean();
  if (!node) {
    return { skipped: true, reason: 'node_not_found' };
  }

  const normalized = normalizeSenseList(node.synonymSenses || [], node.description || '');
  const watermark = (typeof node.senseWatermark === 'string' && node.senseWatermark.trim())
    ? node.senseWatermark.trim()
    : new mongoose.Types.ObjectId().toString();

  await upsertNodeSensesReplace({
    nodeId: safeNodeId,
    senses: normalized,
    actorUserId,
    watermark
  });

  await Node.updateOne(
    { _id: safeNodeId },
    { $set: { senseCollectionUpdatedAt: new Date() } }
  );

  return {
    skipped: false,
    repairedCount: normalized.length
  };
};

const listNodeSensesByNodeId = async (nodeId, { fallbackNode = null, actorUserId = null } = {}) => {
  const safeNodeId = toObjectIdOrNull(nodeId);
  let nodeDoc = fallbackNode;

  if ((!nodeDoc || typeof nodeDoc !== 'object') && safeNodeId) {
    nodeDoc = await Node.findById(safeNodeId)
      .select('_id description synonymSenses senseVersion')
      .lean();
  }

  if (isNodeSenseCollectionReadEnabled() && safeNodeId) {
    const rows = await NodeSense.find({
      nodeId: safeNodeId,
      status: 'active'
    })
      .select('senseId title content order')
      .sort({ order: 1, senseId: 1, _id: 1 })
      .lean();

    if (!nodeDoc || typeof nodeDoc !== 'object') {
      nodeDoc = {
        _id: safeNodeId,
        description: '',
        synonymSenses: []
      };
    }
    nodeDoc.__senseCollectionHydrated = true;
    if (rows.length > 0) {
      nodeDoc.__senseCollectionRows = rows;
    }
  }

  const resolved = resolveNodeSensesForNode(nodeDoc || {}, {
    fallbackDescription: nodeDoc?.description || ''
  });

  if (resolved.shouldEnqueueBackfill) {
    const senseVersion = Number.isFinite(Number(nodeDoc?.senseVersion)) ? Number(nodeDoc.senseVersion) : 0;
    await enqueueNodeSenseBackfillJob({
      nodeId: nodeDoc?._id || safeNodeId,
      actorUserId,
      senseVersion
    });
  }

  return resolved.senses;
};

module.exports = {
  isNodeSenseCollectionReadEnabled,
  isNodeSenseCollectionWriteEnabled,
  isNodeSenseRepairEnabled,
  normalizeSenseList,
  loadNodeSenseMapByNodeIds,
  hydrateNodeSensesForNodes,
  resolveNodeSensesForNode,
  upsertNodeSensesReplace,
  saveNodeSenses,
  materializeNodeSensesToEmbedded,
  backfillNodeSenseCollectionFromEmbedded,
  enqueueNodeSenseBackfillJob,
  enqueueNodeSenseMaterializeJob,
  listNodeSensesByNodeId
};
