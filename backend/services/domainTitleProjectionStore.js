const mongoose = require('mongoose');
const DomainTitleProjection = require('../models/DomainTitleProjection');
const DomainTitleRelation = require('../models/DomainTitleRelation');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const text = String(value);
  if (!mongoose.Types.ObjectId.isValid(text)) return null;
  return new mongoose.Types.ObjectId(text);
};

const getIdString = (value) => {
  const id = toObjectIdOrNull(value);
  return id ? String(id) : '';
};

const isDomainTitleProjectionReadEnabled = () => process.env.DOMAIN_TITLE_PROJECTION_READ !== 'false';
const isDomainTitleProjectionWriteEnabled = () => process.env.DOMAIN_TITLE_PROJECTION_WRITE !== 'false';

const normalizeStringList = (source = []) => {
  const out = [];
  const seen = new Set();
  for (const item of (Array.isArray(source) ? source : [])) {
    const text = typeof item === 'string' ? item.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
};

const normalizeObjectIdList = (source = []) => {
  const out = [];
  const seen = new Set();
  for (const item of (Array.isArray(source) ? source : [])) {
    const id = toObjectIdOrNull(item);
    if (!id) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
};

const normalizeTitleProjectionFromNode = (node = {}) => {
  const nodeId = toObjectIdOrNull(node?._id || node?.nodeId);
  if (!nodeId) return null;
  const knowledgePointRaw = node?.knowledgePoint && typeof node.knowledgePoint === 'object'
    ? node.knowledgePoint
    : {};
  const knowledgePointValue = Number(knowledgePointRaw?.value);
  const knowledgePointLastUpdated = knowledgePointRaw?.lastUpdated
    ? new Date(knowledgePointRaw.lastUpdated)
    : null;
  const createdAt = node?.createdAt ? new Date(node.createdAt) : new Date();
  const lastUpdate = node?.lastUpdate ? new Date(node.lastUpdate) : new Date();

  return {
    nodeId,
    owner: toObjectIdOrNull(node?.owner),
    domainMaster: toObjectIdOrNull(node?.domainMaster),
    domainAdmins: normalizeObjectIdList(node?.domainAdmins),
    allianceId: toObjectIdOrNull(node?.allianceId),
    name: typeof node?.name === 'string' ? node.name.trim() : '',
    description: typeof node?.description === 'string' ? node.description.trim() : '',
    relatedParentDomains: normalizeStringList(node?.relatedParentDomains),
    relatedChildDomains: normalizeStringList(node?.relatedChildDomains),
    contentScore: Number.isFinite(Number(node?.contentScore)) ? Number(node.contentScore) : 1,
    knowledgePoint: {
      value: Number.isFinite(knowledgePointValue) ? Number(knowledgePointValue) : 0,
      lastUpdated: Number.isFinite(knowledgePointLastUpdated?.getTime?.())
        ? knowledgePointLastUpdated
        : null
    },
    status: node?.status === 'pending' || node?.status === 'rejected' ? node.status : 'approved',
    isFeatured: !!node?.isFeatured,
    featuredOrder: Number.isFinite(Number(node?.featuredOrder)) ? Number(node.featuredOrder) : 0,
    createdAt,
    lastUpdate
  };
};

const normalizeAssociationsForProjection = (associations = []) => (
  (Array.isArray(associations) ? associations : [])
    .map((assoc) => ({
      targetNodeId: toObjectIdOrNull(assoc?.targetNode),
      relationType: assoc?.relationType === 'contains' || assoc?.relationType === 'extends'
        ? assoc.relationType
        : '',
      sourceSenseId: typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim().slice(0, 120) : '',
      targetSenseId: typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim().slice(0, 120) : '',
      insertSide: typeof assoc?.insertSide === 'string' ? assoc.insertSide.trim().slice(0, 20) : '',
      insertGroupId: typeof assoc?.insertGroupId === 'string' ? assoc.insertGroupId.trim().slice(0, 120) : ''
    }))
    .filter((assoc) => assoc.targetNodeId && assoc.relationType)
);

const upsertDomainTitleProjectionFromNode = async (node = {}) => {
  if (!isDomainTitleProjectionWriteEnabled()) {
    return { skipped: true, upserted: 0, modified: 0 };
  }
  const normalized = normalizeTitleProjectionFromNode(node);
  if (!normalized || !normalized.nodeId || !normalized.name) {
    return { skipped: false, upserted: 0, modified: 0 };
  }

  const result = await DomainTitleProjection.updateOne(
    { nodeId: normalized.nodeId },
    { $set: normalized },
    { upsert: true }
  );
  return {
    skipped: false,
    upserted: result?.upsertedCount || 0,
    modified: result?.modifiedCount || 0
  };
};

const replaceDomainTitleRelations = async ({ nodeId, associations = [] } = {}) => {
  if (!isDomainTitleProjectionWriteEnabled()) {
    return { skipped: true, upserted: 0, modified: 0, deleted: 0 };
  }
  const sourceNodeId = toObjectIdOrNull(nodeId);
  if (!sourceNodeId) {
    return { skipped: false, upserted: 0, modified: 0, deleted: 0 };
  }

  const normalized = normalizeAssociationsForProjection(associations);
  const ops = normalized.map((item) => ({
    updateOne: {
      filter: {
        sourceNodeId,
        targetNodeId: item.targetNodeId,
        relationType: item.relationType,
        sourceSenseId: item.sourceSenseId,
        targetSenseId: item.targetSenseId
      },
      update: {
        $set: {
          insertSide: item.insertSide,
          insertGroupId: item.insertGroupId,
          status: 'active'
        }
      },
      upsert: true
    }
  }));

  let upserted = 0;
  let modified = 0;
  if (ops.length > 0) {
    const result = await DomainTitleRelation.bulkWrite(ops, { ordered: false });
    upserted += result?.upsertedCount || 0;
    modified += result?.modifiedCount || 0;
  }

  const keepKeys = normalized.map((item) => ({
    targetNodeId: item.targetNodeId,
    relationType: item.relationType,
    sourceSenseId: item.sourceSenseId,
    targetSenseId: item.targetSenseId
  }));

  const deleteFilter = { sourceNodeId };
  if (keepKeys.length > 0) {
    deleteFilter.$nor = keepKeys;
  }
  const deleteResult = await DomainTitleRelation.deleteMany(deleteFilter);

  return {
    skipped: false,
    upserted,
    modified,
    deleted: deleteResult?.deletedCount || 0
  };
};

const syncDomainTitleProjectionFromNode = async (node = {}) => {
  const nodeId = node?._id || node?.nodeId;
  const [projectionResult, relationResult] = await Promise.all([
    upsertDomainTitleProjectionFromNode(node),
    replaceDomainTitleRelations({
      nodeId,
      associations: Array.isArray(node?.associations) ? node.associations : []
    })
  ]);
  return {
    projectionResult,
    relationResult
  };
};

const deleteDomainTitleProjectionByNodeIds = async (nodeIds = []) => {
  const objectIds = Array.from(new Set(
    (Array.isArray(nodeIds) ? nodeIds : [])
      .map((item) => toObjectIdOrNull(item))
      .filter(Boolean)
      .map((item) => String(item))
  )).map((item) => new mongoose.Types.ObjectId(item));

  if (objectIds.length === 0) {
    return {
      deletedProjections: 0,
      deletedRelations: 0
    };
  }

  const [projectionResult, relationResult] = await Promise.all([
    DomainTitleProjection.deleteMany({ nodeId: { $in: objectIds } }),
    DomainTitleRelation.deleteMany({
      $or: [
        { sourceNodeId: { $in: objectIds } },
        { targetNodeId: { $in: objectIds } }
      ]
    })
  ]);

  return {
    deletedProjections: projectionResult?.deletedCount || 0,
    deletedRelations: relationResult?.deletedCount || 0
  };
};

const loadProjectionMapByNodeIds = async (nodeIds = []) => {
  const objectIds = Array.from(new Set(
    (Array.isArray(nodeIds) ? nodeIds : [])
      .map((item) => toObjectIdOrNull(item))
      .filter(Boolean)
      .map((item) => String(item))
  )).map((item) => new mongoose.Types.ObjectId(item));
  if (objectIds.length === 0) return new Map();

  const rows = await DomainTitleProjection.find({
    nodeId: { $in: objectIds }
  }).lean();

  return new Map(rows.map((item) => [String(item.nodeId), item]));
};

const hydrateDomainTitleProjectionForNodes = async (nodes = []) => {
  if (!isDomainTitleProjectionReadEnabled()) return nodes;
  const rows = Array.isArray(nodes) ? nodes : [];
  if (rows.length === 0) return rows;

  const nodeIds = rows
    .map((item) => item?._id)
    .map((item) => String(item || ''))
    .filter((id) => isValidObjectId(id));
  if (nodeIds.length === 0) return rows;

  const projectionMap = await loadProjectionMapByNodeIds(nodeIds);
  rows.forEach((node) => {
    if (!node) return;
    const key = String(node._id || '');
    if (!key || !projectionMap.has(key)) return;
    node.__titleProjection = projectionMap.get(key);
  });
  return rows;
};

const resolveProjectedTitle = (node = {}, fallback = null) => {
  if (isDomainTitleProjectionReadEnabled() && node?.__titleProjection) {
    return node.__titleProjection;
  }
  return fallback || node;
};

const listActiveTitleRelationsBySourceNodeIds = async (sourceNodeIds = []) => {
  const objectIds = Array.from(new Set(
    (Array.isArray(sourceNodeIds) ? sourceNodeIds : [])
      .map((item) => toObjectIdOrNull(item))
      .filter(Boolean)
      .map((item) => String(item))
  )).map((item) => new mongoose.Types.ObjectId(item));
  if (objectIds.length === 0) return [];

  return DomainTitleRelation.find({
    sourceNodeId: { $in: objectIds },
    status: 'active'
  }).lean();
};

const listActiveTitleRelationsByTargetNodeIds = async (targetNodeIds = []) => {
  const objectIds = Array.from(new Set(
    (Array.isArray(targetNodeIds) ? targetNodeIds : [])
      .map((item) => toObjectIdOrNull(item))
      .filter(Boolean)
      .map((item) => String(item))
  )).map((item) => new mongoose.Types.ObjectId(item));
  if (objectIds.length === 0) return [];

  return DomainTitleRelation.find({
    targetNodeId: { $in: objectIds },
    status: 'active'
  }).lean();
};

module.exports = {
  isDomainTitleProjectionReadEnabled,
  isDomainTitleProjectionWriteEnabled,
  normalizeTitleProjectionFromNode,
  normalizeAssociationsForProjection,
  upsertDomainTitleProjectionFromNode,
  replaceDomainTitleRelations,
  syncDomainTitleProjectionFromNode,
  deleteDomainTitleProjectionByNodeIds,
  loadProjectionMapByNodeIds,
  hydrateDomainTitleProjectionForNodes,
  resolveProjectedTitle,
  listActiveTitleRelationsBySourceNodeIds,
  listActiveTitleRelationsByTargetNodeIds
};
