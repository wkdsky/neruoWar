const mongoose = require('mongoose');
const NodeSense = require('../models/NodeSense');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const isNodeSenseCollectionReadEnabled = () => process.env.NODE_SENSE_COLLECTION_READ !== 'false';
const isNodeSenseCollectionWriteEnabled = () => process.env.NODE_SENSE_COLLECTION_WRITE !== 'false';

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const text = String(value);
  if (!mongoose.Types.ObjectId.isValid(text)) return null;
  return new mongoose.Types.ObjectId(text);
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

const upsertNodeSensesReplace = async ({
  nodeId,
  senses = [],
  actorUserId = null
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
          updatedBy: actorId || null
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

const listNodeSensesByNodeId = async (nodeId, { fallbackNode = null } = {}) => {
  const safeNodeId = toObjectIdOrNull(nodeId);
  if (isNodeSenseCollectionReadEnabled() && safeNodeId) {
    const rows = await NodeSense.find({
      nodeId: safeNodeId,
      status: 'active'
    })
      .select('senseId title content order')
      .sort({ order: 1, senseId: 1, _id: 1 })
      .lean();

    if (rows.length > 0) {
      return normalizeSenseList(rows, fallbackNode?.description || '');
    }
  }

  const sourceSenses = Array.isArray(fallbackNode?.synonymSenses) ? fallbackNode.synonymSenses : [];
  return normalizeSenseList(sourceSenses, fallbackNode?.description || '');
};

module.exports = {
  isNodeSenseCollectionReadEnabled,
  isNodeSenseCollectionWriteEnabled,
  normalizeSenseList,
  loadNodeSenseMapByNodeIds,
  hydrateNodeSensesForNodes,
  upsertNodeSensesReplace,
  listNodeSensesByNodeId
};
