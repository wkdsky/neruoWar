const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Node = require('../models/Node');
const NodeSense = require('../models/NodeSense');
const User = require('../models/User');
const DistributionParticipant = require('../models/DistributionParticipant');
const EntropyAlliance = require('../models/EntropyAlliance');
const KnowledgeDistributionService = require('../services/KnowledgeDistributionService');
const { fetchArmyUnitTypes } = require('../services/armyUnitTypeService');
const { upsertNotificationsToCollection, writeNotificationsToCollection } = require('../services/notificationStore');
const {
  findShortestApprovedPathToAnyTargets,
  listApprovedNodesByNames
} = require('../services/domainGraphTraversalService');
const {
  isNodeSenseCollectionReadEnabled,
  normalizeSenseList,
  hydrateNodeSensesForNodes,
  upsertNodeSensesReplace
} = require('../services/nodeSenseStore');
const DomainTitleProjection = require('../models/DomainTitleProjection');
const {
  isDomainTitleStateCollectionReadEnabled,
  hydrateNodeTitleStatesForNodes,
  resolveNodeDefenseLayout,
  resolveNodeSiegeState,
  upsertNodeDefenseLayout,
  upsertNodeSiegeState,
  deleteNodeTitleStatesByNodeIds,
  listSiegeStatesByAttackerUserId
} = require('../services/domainTitleStateStore');
const {
  isDomainTitleProjectionReadEnabled,
  syncDomainTitleProjectionFromNode,
  deleteDomainTitleProjectionByNodeIds,
  listActiveTitleRelationsBySourceNodeIds,
  listActiveTitleRelationsByTargetNodeIds
} = require('../services/domainTitleProjectionStore');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const buildNotificationPayload = (payload = {}) => ({
  ...payload,
  _id: payload?._id && mongoose.Types.ObjectId.isValid(String(payload._id))
    ? new mongoose.Types.ObjectId(String(payload._id))
    : new mongoose.Types.ObjectId(),
  createdAt: payload?.createdAt ? new Date(payload.createdAt) : new Date()
});

const pushNotificationToUser = (user, payload = {}) => {
  if (!user) return null;
  const notification = buildNotificationPayload(payload);
  user.notifications = Array.isArray(user.notifications) ? user.notifications : [];
  user.notifications.unshift(notification);
  return notification;
};

const toCollectionNotificationDoc = (userId, notification = {}) => {
  const source = typeof notification?.toObject === 'function' ? notification.toObject() : notification;
  return {
    ...source,
    _id: source?._id,
    userId
  };
};

const pushDomainCreateApplyResultNotification = ({
  applicant,
  nodeName = '',
  nodeId = null,
  decision = 'rejected',
  processorUser = null,
  rejectedReason = ''
} = {}) => {
  if (!applicant) return null;
  const safeNodeName = String(nodeName || '').trim() || '知识域';
  const operatorName = String(processorUser?.username || '').trim() || '管理员';
  const message = decision === 'accepted'
    ? `${operatorName} 已通过你创建新知识域「${safeNodeName}」的申请`
    : (String(rejectedReason || '').trim() || `${operatorName} 已拒绝你创建新知识域「${safeNodeName}」的申请`);

  return pushNotificationToUser(applicant, {
    type: 'info',
    title: `新知识域申请结果：${safeNodeName}`,
    message,
    read: false,
    status: decision === 'accepted' ? 'accepted' : 'rejected',
    nodeId: decision === 'accepted' ? (nodeId || null) : null,
    nodeName: safeNodeName,
    inviterId: processorUser?._id || null,
    inviterUsername: operatorName,
    inviteeId: applicant?._id || null,
    inviteeUsername: applicant?.username || '',
    respondedAt: new Date()
  });
};

const isDomainMaster = (node, userId) => {
  const masterId = getIdString(node?.domainMaster);
  const currentUserId = getIdString(userId);
  return !!masterId && !!currentUserId && masterId === currentUserId;
};

const isDomainAdmin = (node, userId) => {
  const currentUserId = getIdString(userId);
  if (!currentUserId || !Array.isArray(node?.domainAdmins)) return false;
  return node.domainAdmins.some((adminId) => getIdString(adminId) === currentUserId);
};

const DOMAIN_CARD_SELECT = '_id name description synonymSenses knowledgePoint contentScore';

const normalizeNodeSenseList = (node = {}) => {
  const source = Array.isArray(node?.__senseCollectionRows) && node.__senseCollectionRows.length > 0
    ? node.__senseCollectionRows
    : (Array.isArray(node?.synonymSenses) ? node.synonymSenses : []);
  const fallbackContent = typeof node?.description === 'string' && node.description.trim()
    ? node.description.trim()
    : '暂无释义内容';
  return normalizeSenseList(source, fallbackContent);
};

const buildNodeSenseDisplayName = (nodeName = '', senseTitle = '') => {
  const safeName = typeof nodeName === 'string' ? nodeName.trim() : '';
  const safeTitle = typeof senseTitle === 'string' ? senseTitle.trim() : '';
  return safeTitle ? `${safeName}-${safeTitle}` : safeName;
};

const normalizeAssociationRelationType = (value) => (
  value === 'contains' || value === 'extends' || value === 'insert' ? value : ''
);

const normalizeAssociationInsertSide = (value, relationType = '') => {
  if (relationType !== 'insert') return '';
  return value === 'left' || value === 'right' ? value : '';
};

const pickNodeSenseById = (node = {}, senseId = '') => {
  const senses = normalizeNodeSenseList(node);
  const targetSenseId = typeof senseId === 'string' ? senseId.trim() : '';
  if (!targetSenseId) return senses[0];
  return senses.find((item) => item.senseId === targetSenseId) || senses[0];
};

const allocateNextSenseId = (senseList = []) => {
  const used = new Set((Array.isArray(senseList) ? senseList : []).map((item) => String(item?.senseId || '').trim()).filter(Boolean));
  let maxNumeric = 0;
  used.forEach((id) => {
    const matched = /^sense_(\d+)$/.exec(id);
    if (!matched) return;
    const value = Number.parseInt(matched[1], 10);
    if (Number.isInteger(value) && value > maxNumeric) maxNumeric = value;
  });

  let next = maxNumeric + 1;
  while (used.has(`sense_${next}`)) {
    next += 1;
  }
  return `sense_${next}`;
};

const buildNodeSenseSearchEntries = (node = {}, keywords = []) => {
  const normalizedKeywords = (Array.isArray(keywords) ? keywords : [])
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  const senses = normalizeNodeSenseList(node);
  const baseName = typeof node?.name === 'string' ? node.name : '';
  const nodeId = getIdString(node?._id);
  return senses
    .map((sense) => {
      const displayName = buildNodeSenseDisplayName(baseName, sense.title);
      const searchText = `${baseName} ${sense.title}`.toLowerCase();
      let matchCount = 0;
      normalizedKeywords.forEach((keyword) => {
        if (searchText.includes(keyword)) matchCount += 1;
      });
      return {
        _id: nodeId,
        nodeId,
        searchKey: `${nodeId}:${sense.senseId}`,
        name: displayName,
        displayName,
        domainName: baseName,
        description: sense.content || node?.description || '',
        senseId: sense.senseId,
        senseTitle: sense.title,
        senseContent: sense.content || '',
        knowledgePoint: node?.knowledgePoint,
        contentScore: node?.contentScore,
        matchCount
      };
    })
    .filter((item) => normalizedKeywords.length === 0 || item.matchCount > 0);
};

const buildNodeTitleCard = (node = {}) => {
  const source = node && typeof node.toObject === 'function' ? node.toObject() : node;
  const senses = normalizeNodeSenseList(source);
  const activeSense = senses[0] || null;
  return {
    ...source,
    synonymSenses: senses,
    activeSenseId: activeSense?.senseId || '',
    activeSenseTitle: activeSense?.title || '',
    activeSenseContent: activeSense?.content || '',
    displayName: typeof source?.name === 'string' ? source.name : ''
  };
};

const toSafeInteger = (value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const encodeNameCursor = ({ name = '', id = '' } = {}) => {
  const payload = JSON.stringify({ name: String(name || ''), id: String(id || '') });
  return Buffer.from(payload).toString('base64');
};

const decodeNameCursor = (cursor = '') => {
  if (typeof cursor !== 'string' || !cursor.trim()) {
    return { name: '', id: '' };
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    const name = typeof parsed?.name === 'string' ? parsed.name : '';
    const id = typeof parsed?.id === 'string' ? parsed.id : '';
    return { name, id };
  } catch (error) {
    return { name: '', id: '' };
  }
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const loadNodeSearchCandidates = async ({
  normalizedKeyword = '',
  limit = 800
}) => {
  const safeKeyword = typeof normalizedKeyword === 'string' ? normalizedKeyword.trim() : '';
  if (!safeKeyword) return [];
  const safeLimit = Math.max(100, Math.min(3000, parseInt(limit, 10) || 800));
  const selectFields = '_id name description synonymSenses knowledgePoint contentScore';

  const merged = new Map();
  const pushDocs = (docs = []) => {
    for (const item of (Array.isArray(docs) ? docs : [])) {
      const itemId = getIdString(item?._id);
      if (!itemId || merged.has(itemId)) continue;
      merged.set(itemId, item);
      if (merged.size >= safeLimit) break;
    }
  };

  // 1) 优先走文本索引，避免全表扫描。
  let textDocs = [];
  try {
    textDocs = await Node.find({
      status: 'approved',
      $text: { $search: safeKeyword }
    })
      .select(`${selectFields} score`)
      .sort({ score: { $meta: 'textScore' } })
      .limit(safeLimit)
      .lean();
  } catch (error) {
    textDocs = [];
  }
  pushDocs(textDocs);

  // 2) 文本索引召回不足时，用 name/title 的 regex 补足。
  if (merged.size < safeLimit) {
    const keywordRegex = new RegExp(escapeRegex(safeKeyword), 'i');
    let regexDocs = await Node.find({
      status: 'approved',
      $or: [
        { name: keywordRegex },
        { 'synonymSenses.title': keywordRegex }
      ]
    })
      .select(selectFields)
      .limit(safeLimit - merged.size)
      .lean();

    if (isNodeSenseCollectionReadEnabled() && regexDocs.length < (safeLimit - merged.size)) {
      const extraNeed = safeLimit - merged.size - regexDocs.length;
      const senseRows = await NodeSense.find({
        status: 'active',
        $or: [
          { title: keywordRegex },
          { content: keywordRegex }
        ]
      })
        .select('nodeId')
        .limit(Math.max(extraNeed * 2, 200))
        .lean();

      const senseNodeIds = Array.from(new Set(
        senseRows
          .map((item) => getIdString(item?.nodeId))
          .filter((id) => isValidObjectId(id))
      ));
      if (senseNodeIds.length > 0) {
        const extraDocs = await Node.find({
          status: 'approved',
          _id: { $in: senseNodeIds.slice(0, extraNeed * 2) }
        })
          .select(selectFields)
          .limit(extraNeed)
          .lean();
        regexDocs = regexDocs.concat(extraDocs);
      }
    }
    pushDocs(regexDocs);
  }

  const rows = Array.from(merged.values());
  await hydrateNodeSensesForNodes(rows);
  return rows;
};

const toDistributionSessionExecuteAt = (lock = {}) => {
  const ms = new Date(lock?.executeAt || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
};

const DISTRIBUTION_LOCK_PARTICIPANT_PREVIEW_LIMIT = 50;
const DISTRIBUTION_JOIN_ORDER_SCAN_LIMIT = 5000;
const DISTRIBUTION_LEGACY_PARTICIPANT_MIRROR_LIMIT = 2000;
const DISTRIBUTION_POOL_USER_LIST_LIMIT = 200;

const buildManualJoinOrderMapFromLegacyLock = (lock = {}, limit = DISTRIBUTION_JOIN_ORDER_SCAN_LIMIT) => {
  const map = new Map();
  const rows = Array.isArray(lock?.participants) ? lock.participants : [];
  const maxScan = Math.max(100, Math.min(20000, parseInt(limit, 10) || DISTRIBUTION_JOIN_ORDER_SCAN_LIMIT));
  for (let i = 0; i < rows.length && i < maxScan; i += 1) {
    const item = rows[i] || {};
    const userId = getIdString(item?.userId);
    if (!isValidObjectId(userId)) continue;
    const joinedAtMs = new Date(item?.joinedAt || 0).getTime();
    const orderMs = Number.isFinite(joinedAtMs) && joinedAtMs > 0 ? joinedAtMs : Number.MAX_SAFE_INTEGER;
    map.set(userId, orderMs);
  }
  return map;
};

const getActiveManualParticipantSet = async ({ nodeId = '', lock = {}, atMs = Date.now() } = {}) => {
  const ids = await KnowledgeDistributionService.loadActiveManualParticipantIds({
    nodeId,
    lock,
    atMs
  });
  return new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => getIdString(id))
      .filter((id) => isValidObjectId(id))
  );
};

const listDistributionParticipantsBySession = async ({
  nodeId,
  executeAt,
  page = 1,
  pageSize = 50,
  activeOnly = false
} = {}) => {
  if (!isValidObjectId(nodeId) || !(executeAt instanceof Date)) {
    return {
      total: 0,
      page: 1,
      pageSize: 50,
      rows: []
    };
  }

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.max(1, Math.min(200, parseInt(pageSize, 10) || 50));
  const filter = {
    nodeId: new mongoose.Types.ObjectId(String(nodeId)),
    executeAt
  };
  if (activeOnly) {
    filter.exitedAt = null;
  }

  const [total, rows] = await Promise.all([
    DistributionParticipant.countDocuments(filter),
    DistributionParticipant.find(filter)
      .sort({ joinedAt: 1, _id: 1 })
      .skip((safePage - 1) * safePageSize)
      .limit(safePageSize)
      .select('userId joinedAt exitedAt')
      .lean()
  ]);

  return {
    total,
    page: safePage,
    pageSize: safePageSize,
    rows
  };
};

const syncDistributionParticipantJoinRecord = async ({
  nodeId,
  executeAt,
  userId,
  joinedAt
}) => {
  if (!isValidObjectId(nodeId) || !isValidObjectId(userId) || !(executeAt instanceof Date)) return;
  await DistributionParticipant.updateOne(
    {
      nodeId: new mongoose.Types.ObjectId(String(nodeId)),
      executeAt,
      userId: new mongoose.Types.ObjectId(String(userId))
    },
    {
      $set: {
        joinedAt: joinedAt instanceof Date ? joinedAt : new Date(),
        exitedAt: null
      }
    },
    { upsert: true }
  );
};

const syncDistributionParticipantExitRecord = async ({
  nodeId,
  executeAt,
  userId,
  exitedAt
}) => {
  if (!isValidObjectId(nodeId) || !isValidObjectId(userId) || !(executeAt instanceof Date)) return;
  await DistributionParticipant.updateOne(
    {
      nodeId: new mongoose.Types.ObjectId(String(nodeId)),
      executeAt,
      userId: new mongoose.Types.ObjectId(String(userId))
    },
    {
      $set: {
        exitedAt: exitedAt instanceof Date ? exitedAt : new Date()
      },
      $setOnInsert: {
        joinedAt: exitedAt instanceof Date ? exitedAt : new Date()
      }
    },
    { upsert: true }
  );
};

const normalizeAssociationDraftList = (rawAssociations = [], localSenseIdSet = null) => (
  (Array.isArray(rawAssociations) ? rawAssociations : [])
    .map((assoc) => {
      const targetNodeId = getIdString(assoc?.targetNode);
      const relationType = normalizeAssociationRelationType(assoc?.relationType);
      const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
      const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
      const insertSide = normalizeAssociationInsertSide(assoc?.insertSide, relationType);
      const insertGroupId = typeof assoc?.insertGroupId === 'string' ? assoc.insertGroupId.trim().slice(0, 80) : '';
      if (!targetNodeId || !relationType) return null;
      if (!sourceSenseId || (localSenseIdSet instanceof Set && !localSenseIdSet.has(sourceSenseId))) return null;
      if (!targetSenseId) return null;
      return {
        targetNode: targetNodeId,
        relationType,
        sourceSenseId,
        targetSenseId,
        insertSide,
        insertGroupId
      };
    })
    .filter(Boolean)
);

const dedupeAssociationList = (associations = []) => {
  const seen = new Set();
  return (Array.isArray(associations) ? associations : []).filter((assoc) => {
    const key = [
      assoc.sourceSenseId || '',
      assoc.targetNode || '',
      assoc.targetSenseId || '',
      assoc.relationType || ''
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getReciprocalRelationType = (relationType = '') => (
  relationType === 'contains' ? 'extends' : (relationType === 'extends' ? 'contains' : '')
);

const hasExactDirectedContainsOrExtendsAssociation = (
  nodeDoc,
  targetNodeId,
  relationType,
  sourceSenseId,
  targetSenseId
) => {
  const targetId = getIdString(targetNodeId);
  const sourceSense = typeof sourceSenseId === 'string' ? sourceSenseId.trim() : '';
  const targetSense = typeof targetSenseId === 'string' ? targetSenseId.trim() : '';
  const normalizedRelationType = normalizeAssociationRelationType(relationType);
  if (!targetId || !sourceSense || !targetSense) return false;
  if (normalizedRelationType !== 'contains' && normalizedRelationType !== 'extends') return false;
  return (Array.isArray(nodeDoc?.associations) ? nodeDoc.associations : []).some((assoc) => (
    getIdString(assoc?.targetNode) === targetId
    && normalizeAssociationRelationType(assoc?.relationType) === normalizedRelationType
    && (typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '') === sourceSense
    && (typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '') === targetSense
  ));
};

const validateAssociationRuleSet = ({ currentNodeId = '', associations = [] } = {}) => {
  const nodeId = getIdString(currentNodeId);
  const relationSeen = new Set();
  const relationByPair = new Map();

  for (const assoc of (Array.isArray(associations) ? associations : [])) {
    const targetNode = getIdString(assoc?.targetNode);
    const relationType = normalizeAssociationRelationType(assoc?.relationType);
    const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
    const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
    const insertSide = normalizeAssociationInsertSide(assoc?.insertSide, relationType);
    const insertGroupId = typeof assoc?.insertGroupId === 'string' ? assoc.insertGroupId.trim().slice(0, 80) : '';
    if (!targetNode || !relationType || !sourceSenseId || !targetSenseId) continue;

    if (nodeId && targetNode === nodeId) {
      return { error: '同一知识域下的释义之间不能建立关联关系（包含、扩展、插入）' };
    }

    const relationKey = [
      sourceSenseId,
      targetNode,
      targetSenseId,
      relationType,
      insertSide,
      insertGroupId
    ].join('|');
    if (relationSeen.has(relationKey)) {
      return { error: '关联关系错误：同一个释义到同一目标释义只能存在一种关系' };
    }
    relationSeen.add(relationKey);

    if (relationType !== 'contains' && relationType !== 'extends') continue;
    const pairKey = `${sourceSenseId}|${targetNode}|${targetSenseId}`;
    const existedType = relationByPair.get(pairKey);
    if (existedType && existedType !== relationType) {
      return { error: '关联关系错误：同一个释义不能同时包含并拓展同一个目标释义' };
    }
    relationByPair.set(pairKey, relationType);
  }

  return { error: '' };
};

const normalizeAssociationRemovalStrategy = (value = '') => (
  value === 'reconnect' ? 'reconnect' : 'disconnect'
);

const normalizeBridgeDecisionAction = (value = '') => (
  value === 'reconnect' ? 'reconnect' : (value === 'disconnect' ? 'disconnect' : '')
);

const toAssociationEdgeKey = (assoc = {}) => (
  [
    assoc.sourceSenseId || '',
    assoc.targetNode || '',
    assoc.targetSenseId || '',
    assoc.relationType || ''
  ].join('|')
);

const normalizeRelationAssociationList = (associations = []) => (
  (Array.isArray(associations) ? associations : [])
    .map((assoc) => ({
      targetNode: getIdString(assoc?.targetNode),
      relationType: normalizeAssociationRelationType(assoc?.relationType),
      sourceSenseId: typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '',
      targetSenseId: typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '',
      insertSide: '',
      insertGroupId: ''
    }))
    .filter((assoc) => (
      assoc.targetNode
      && (assoc.relationType === 'contains' || assoc.relationType === 'extends')
      && assoc.sourceSenseId
      && assoc.targetSenseId
    ))
);

const normalizeTitleRelationAssociationList = (associations = []) => (
  (Array.isArray(associations) ? associations : [])
    .map((assoc) => ({
      targetNode: getIdString(assoc?.targetNode || assoc?.targetNodeId),
      relationType: normalizeAssociationRelationType(assoc?.relationType),
      sourceSenseId: typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '',
      targetSenseId: typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '',
      insertSide: typeof assoc?.insertSide === 'string' ? assoc.insertSide.trim() : '',
      insertGroupId: typeof assoc?.insertGroupId === 'string' ? assoc.insertGroupId.trim() : ''
    }))
    .filter((assoc) => (
      assoc.targetNode
      && (assoc.relationType === 'contains' || assoc.relationType === 'extends')
    ))
);

const mapProjectionRowToNodeLike = (row = {}) => ({
  _id: row?.nodeId || row?._id || null,
  owner: row?.owner || null,
  domainMaster: row?.domainMaster || null,
  domainAdmins: Array.isArray(row?.domainAdmins) ? row.domainAdmins : [],
  allianceId: row?.allianceId || null,
  name: row?.name || '',
  description: row?.description || '',
  relatedParentDomains: Array.isArray(row?.relatedParentDomains) ? row.relatedParentDomains : [],
  relatedChildDomains: Array.isArray(row?.relatedChildDomains) ? row.relatedChildDomains : [],
  contentScore: row?.contentScore,
  knowledgePoint: row?.knowledgePoint || null,
  status: row?.status || 'approved',
  isFeatured: !!row?.isFeatured,
  featuredOrder: Number.isFinite(Number(row?.featuredOrder)) ? Number(row.featuredOrder) : 0,
  createdAt: row?.createdAt || null,
  lastUpdate: row?.lastUpdate || null
});

const toNodeSensePairKey = (nodeId = '', senseId = '') => `${getIdString(nodeId)}:${String(senseId || '').trim()}`;
const toBridgePairDecisionKey = (pair = {}) => (
  [
    String(pair?.sourceSenseId || '').trim(),
    getIdString(pair?.upperNodeId),
    String(pair?.upperSenseId || '').trim(),
    getIdString(pair?.lowerNodeId),
    String(pair?.lowerSenseId || '').trim()
  ].join('|')
);

const normalizeBridgeDecisionList = (rawDecisionList = []) => (
  (Array.isArray(rawDecisionList) ? rawDecisionList : [])
    .map((item) => {
      const pairKey = typeof item?.pairKey === 'string' ? item.pairKey.trim() : '';
      const action = normalizeBridgeDecisionAction(item?.action);
      if (!pairKey || !action) return null;
      return { pairKey, action };
    })
    .filter(Boolean)
);

const buildBridgeBucketsBySourceSense = (associations = []) => {
  const map = new Map();
  (Array.isArray(associations) ? associations : []).forEach((assoc) => {
    const relationType = normalizeAssociationRelationType(assoc?.relationType);
    if (relationType !== 'contains' && relationType !== 'extends') return;
    const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
    const targetNode = getIdString(assoc?.targetNode);
    const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
    if (!sourceSenseId || !targetNode || !targetSenseId) return;

    const current = map.get(sourceSenseId) || { uppers: new Map(), lowers: new Map() };
    const target = {
      nodeId: targetNode,
      senseId: targetSenseId,
      key: toNodeSensePairKey(targetNode, targetSenseId)
    };
    if (relationType === 'extends') {
      current.uppers.set(target.key, target);
    } else {
      current.lowers.set(target.key, target);
    }
    map.set(sourceSenseId, current);
  });
  return map;
};

const buildBridgePairMapFromBucket = (bucket = null) => {
  const pairMap = new Map();
  if (!bucket || !(bucket.uppers instanceof Map) || !(bucket.lowers instanceof Map)) return pairMap;
  for (const upper of bucket.uppers.values()) {
    for (const lower of bucket.lowers.values()) {
      const pairKey = `${upper.key}|${lower.key}`;
      pairMap.set(pairKey, { upper, lower });
    }
  }
  return pairMap;
};

const computeLostBridgePairs = (oldAssociations = [], nextAssociations = []) => {
  const oldBuckets = buildBridgeBucketsBySourceSense(oldAssociations);
  const nextBuckets = buildBridgeBucketsBySourceSense(nextAssociations);
  const sourceSenseIds = new Set([...oldBuckets.keys(), ...nextBuckets.keys()]);
  const lostPairs = [];
  const seen = new Set();

  sourceSenseIds.forEach((sourceSenseId) => {
    const oldPairMap = buildBridgePairMapFromBucket(oldBuckets.get(sourceSenseId));
    const nextPairMap = buildBridgePairMapFromBucket(nextBuckets.get(sourceSenseId));
    for (const [pairKey, pair] of oldPairMap.entries()) {
      if (nextPairMap.has(pairKey)) continue;
      const key = `${sourceSenseId}|${pair.upper.key}|${pair.lower.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lostPairs.push({
        sourceSenseId,
        upperNodeId: pair.upper.nodeId,
        upperSenseId: pair.upper.senseId,
        lowerNodeId: pair.lower.nodeId,
        lowerSenseId: pair.lower.senseId
      });
    }
  });

  return lostPairs;
};

const resolveReconnectPairsByDecisions = ({
  lostBridgePairs = [],
  onRemovalStrategy = 'disconnect',
  bridgeDecisions = []
}) => {
  const defaultAction = normalizeAssociationRemovalStrategy(onRemovalStrategy) === 'reconnect'
    ? 'reconnect'
    : 'disconnect';
  const decisionMap = new Map(
    normalizeBridgeDecisionList(bridgeDecisions).map((item) => [item.pairKey, item.action])
  );
  const decisionItems = (Array.isArray(lostBridgePairs) ? lostBridgePairs : []).map((pair) => {
    const pairKey = toBridgePairDecisionKey(pair);
    const explicitAction = decisionMap.get(pairKey) || '';
    const action = explicitAction || defaultAction;
    return {
      pairKey,
      action,
      explicitAction,
      hasExplicitDecision: !!explicitAction,
      sourceSenseId: pair.sourceSenseId,
      upperNodeId: pair.upperNodeId,
      upperSenseId: pair.upperSenseId,
      lowerNodeId: pair.lowerNodeId,
      lowerSenseId: pair.lowerSenseId
    };
  });
  return {
    decisionItems,
    unresolvedCount: decisionItems.filter((item) => !item.hasExplicitDecision).length,
    reconnectPairs: decisionItems
      .filter((item) => item.action === 'reconnect')
      .map((item) => ({
        sourceSenseId: item.sourceSenseId,
        upperNodeId: item.upperNodeId,
        upperSenseId: item.upperSenseId,
        lowerNodeId: item.lowerNodeId,
        lowerSenseId: item.lowerSenseId
      }))
  };
};

const applyReconnectPairs = async (pairs = []) => {
  const pairList = Array.isArray(pairs) ? pairs : [];
  if (pairList.length === 0) return;

  const targetIds = Array.from(new Set(pairList
    .flatMap((pair) => [pair?.upperNodeId, pair?.lowerNodeId])
    .map((id) => getIdString(id))
    .filter((id) => isValidObjectId(id))));
  if (targetIds.length === 0) return;

  const targetNodes = await Node.find({ _id: { $in: targetIds }, status: 'approved' });
  const targetNodeMap = new Map(targetNodes.map((item) => [getIdString(item._id), item]));
  const dirtyMap = new Map();

  pairList.forEach((pair) => {
    const upperNode = targetNodeMap.get(getIdString(pair?.upperNodeId));
    const lowerNode = targetNodeMap.get(getIdString(pair?.lowerNodeId));
    if (!upperNode || !lowerNode) return;

    const addedUpper = addAssociationIfMissing(upperNode, {
      targetNode: lowerNode._id,
      relationType: 'contains',
      sourceSenseId: pair?.upperSenseId,
      targetSenseId: pair?.lowerSenseId
    });
    const addedLower = addAssociationIfMissing(lowerNode, {
      targetNode: upperNode._id,
      relationType: 'extends',
      sourceSenseId: pair?.lowerSenseId,
      targetSenseId: pair?.upperSenseId
    });

    if (addedUpper) {
      upperNode.relatedChildDomains = addRelatedDomainName(upperNode.relatedChildDomains, lowerNode.name);
      dirtyMap.set(getIdString(upperNode._id), upperNode);
    }
    if (addedLower) {
      lowerNode.relatedParentDomains = addRelatedDomainName(lowerNode.relatedParentDomains, upperNode.name);
      dirtyMap.set(getIdString(lowerNode._id), lowerNode);
    }
  });

  for (const node of dirtyMap.values()) {
    await node.save();
    await syncDomainTitleProjectionFromNode(node);
  }
};

const buildAssociationMutationSummary = ({
  node,
  oldAssociations = [],
  nextAssociations = [],
  lostBridgePairs = [],
  reconnectPairs = [],
  targetNodeMap = new Map()
}) => {
  const currentNodeName = typeof node?.name === 'string' ? node.name : '';
  const getSenseTitle = (nodeDoc = null, senseId = '') => {
    const senses = normalizeNodeSenseList(nodeDoc || {});
    const key = typeof senseId === 'string' ? senseId.trim() : '';
    if (!key) return '';
    return senses.find((item) => item.senseId === key)?.title || '';
  };
  const toRef = (nodeId = '', senseId = '') => {
    const id = getIdString(nodeId);
    const nodeDoc = id === getIdString(node?._id) ? node : targetNodeMap.get(id);
    const nodeName = nodeDoc?.name || currentNodeName || '未知节点';
    const senseTitle = getSenseTitle(nodeDoc, senseId);
    return {
      nodeId: id,
      senseId,
      nodeName,
      senseTitle,
      displayName: senseTitle ? `${nodeName}-${senseTitle}` : nodeName
    };
  };
  const toLine = (source, relationType, target) => ({
    source,
    relationType,
    target,
    relationLabel: relationType === 'contains' ? '包含' : '扩展'
  });

  const oldMap = new Map(oldAssociations.map((assoc) => [toAssociationEdgeKey(assoc), assoc]));
  const nextMap = new Map(nextAssociations.map((assoc) => [toAssociationEdgeKey(assoc), assoc]));
  const beforeRelations = oldAssociations.map((assoc) => toLine(
    toRef(node?._id, assoc.sourceSenseId),
    assoc.relationType,
    toRef(assoc.targetNode, assoc.targetSenseId)
  ));
  const afterRelations = nextAssociations.map((assoc) => toLine(
    toRef(node?._id, assoc.sourceSenseId),
    assoc.relationType,
    toRef(assoc.targetNode, assoc.targetSenseId)
  ));
  const removed = [];
  const added = [];
  for (const [key, assoc] of oldMap.entries()) {
    if (nextMap.has(key)) continue;
    removed.push(toLine(
      toRef(node?._id, assoc.sourceSenseId),
      assoc.relationType,
      toRef(assoc.targetNode, assoc.targetSenseId)
    ));
  }
  for (const [key, assoc] of nextMap.entries()) {
    if (oldMap.has(key)) continue;
    added.push(toLine(
      toRef(node?._id, assoc.sourceSenseId),
      assoc.relationType,
      toRef(assoc.targetNode, assoc.targetSenseId)
    ));
  }

  const bridgePairs = (Array.isArray(lostBridgePairs) ? lostBridgePairs : []).map((pair) => ({
    pairKey: toBridgePairDecisionKey(pair),
    sourceSenseId: pair.sourceSenseId,
    upper: toRef(pair.upperNodeId, pair.upperSenseId),
    lower: toRef(pair.lowerNodeId, pair.lowerSenseId)
  }));
  const reconnectLines = (Array.isArray(reconnectPairs) ? reconnectPairs : []).map((pair) => ({
    sourceSenseId: pair.sourceSenseId,
    line: toLine(
      toRef(pair.upperNodeId, pair.upperSenseId),
      'contains',
      toRef(pair.lowerNodeId, pair.lowerSenseId)
    )
  }));

  return {
    beforeRelations,
    afterRelations,
    removed,
    added,
    lostBridgePairs: bridgePairs,
    reconnectLines
  };
};

const buildInsertPlanNarratives = ({
  node,
  insertPlans = [],
  targetNodeMap = new Map()
}) => {
  const currentNodeName = typeof node?.name === 'string' ? node.name : '';
  const getSenseTitle = (nodeDoc = null, senseId = '') => {
    const senses = normalizeNodeSenseList(nodeDoc || {});
    const key = typeof senseId === 'string' ? senseId.trim() : '';
    if (!key) return '';
    return senses.find((item) => item.senseId === key)?.title || '';
  };
  const toDisplay = (nodeDoc = null, nodeId = '', senseId = '') => {
    const localNodeDoc = nodeDoc || targetNodeMap.get(getIdString(nodeId)) || null;
    const nodeName = localNodeDoc?.name || currentNodeName || '未知节点';
    const senseTitle = getSenseTitle(localNodeDoc, senseId);
    return senseTitle ? `${nodeName}-${senseTitle}` : nodeName;
  };

  return (Array.isArray(insertPlans) ? insertPlans : []).map((plan, index) => {
    const upperNode = targetNodeMap.get(getIdString(plan?.upperNodeId)) || null;
    const lowerNode = targetNodeMap.get(getIdString(plan?.lowerNodeId)) || null;
    const currentDisplay = toDisplay(node, node?._id, plan?.sourceSenseId);
    const upperDisplay = toDisplay(upperNode, plan?.upperNodeId, plan?.upperSenseId);
    const lowerDisplay = toDisplay(lowerNode, plan?.lowerNodeId, plan?.lowerSenseId);

    const hadOriginalRelation = (
      hasExactDirectedContainsOrExtendsAssociation(
        upperNode,
        plan?.lowerNodeId,
        'contains',
        plan?.upperSenseId,
        plan?.lowerSenseId
      )
      || hasExactDirectedContainsOrExtendsAssociation(
        lowerNode,
        plan?.upperNodeId,
        'extends',
        plan?.lowerSenseId,
        plan?.upperSenseId
      )
    );

    const relationChainText = `${upperDisplay}-${currentDisplay}-${lowerDisplay}`;
    const text = hadOriginalRelation
      ? `${currentDisplay} 将插入到 ${upperDisplay} 和 ${lowerDisplay} 之间，${upperDisplay}和${lowerDisplay}原来的关联将改为${relationChainText}。`
      : `${currentDisplay} 将插入到 ${upperDisplay} 和 ${lowerDisplay} 之间，${upperDisplay}和${lowerDisplay}新建关联为${relationChainText}。`;

    return {
      key: `${getIdString(plan?.upperNodeId)}:${plan?.upperSenseId || ''}|${getIdString(plan?.lowerNodeId)}:${plan?.lowerSenseId || ''}|${plan?.sourceSenseId || ''}|${index}`,
      sourceDisplayName: currentDisplay,
      upperDisplayName: upperDisplay,
      lowerDisplayName: lowerDisplay,
      relationChainText,
      hadOriginalRelation,
      text
    };
  });
};

const validateAssociationMutationPermission = async ({ node, requestUserId = '' }) => {
  const requesterId = getIdString(requestUserId);
  if (!isValidObjectId(requesterId)) {
    return { allowed: false, status: 401, error: '无效的用户身份' };
  }
  const requester = await User.findById(requesterId).select('role');
  if (!requester) {
    return { allowed: false, status: 404, error: '用户不存在' };
  }

  const isSystemAdmin = requester.role === 'admin';
  const canEdit = isSystemAdmin || isDomainMaster(node, requesterId);
  if (!canEdit) {
    return { allowed: false, status: 403, error: '仅系统管理员或该知识域域主可编辑关联关系' };
  }
  return { allowed: true, isSystemAdmin };
};

const parseAssociationMutationPayload = async ({ node, rawAssociations = [] }) => {
  const rawAssociationList = Array.isArray(rawAssociations) ? rawAssociations : [];
  const currentNodeId = getIdString(node?._id);
  await hydrateNodeSensesForNodes([node]);
  const localSenseList = normalizeNodeSenseList(node);
  const localSenseIdSet = new Set(localSenseList.map((item) => item.senseId));
  const defaultSourceSenseId = localSenseList[0]?.senseId || '';
  const normalizedAssociations = rawAssociationList
    .map((assoc) => {
      const targetNode = getIdString(assoc?.targetNode);
      const relationType = normalizeAssociationRelationType(assoc?.relationType);
      const sourceSenseIdRaw = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
      const sourceSenseId = sourceSenseIdRaw || defaultSourceSenseId;
      const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
      const insertSide = normalizeAssociationInsertSide(assoc?.insertSide, relationType);
      const insertGroupId = typeof assoc?.insertGroupId === 'string' ? assoc.insertGroupId.trim().slice(0, 80) : '';
      if (!targetNode || !relationType) return null;
      if (!sourceSenseId || !localSenseIdSet.has(sourceSenseId)) return null;
      return {
        targetNode,
        relationType,
        sourceSenseId,
        targetSenseId,
        insertSide,
        insertGroupId
      };
    })
    .filter(Boolean);

  if (rawAssociationList.length > 0 && normalizedAssociations.length === 0) {
    return { error: '未识别到有效关联关系，请检查释义与目标节点配置' };
  }

  const targetNodeIds = Array.from(new Set(normalizedAssociations.map((assoc) => assoc.targetNode)));
  const targetNodesForValidation = targetNodeIds.length > 0
    ? await Node.find({ _id: { $in: targetNodeIds }, status: 'approved' })
        .select('_id name synonymSenses description')
        .lean()
    : [];
  await hydrateNodeSensesForNodes(targetNodesForValidation);
  const targetNodeMapForValidation = new Map(targetNodesForValidation.map((item) => [getIdString(item._id), item]));
  if (targetNodesForValidation.length !== targetNodeIds.length) {
    return { error: '存在无效的关联目标知识域' };
  }

  for (const assoc of normalizedAssociations) {
    const targetNode = targetNodeMapForValidation.get(assoc.targetNode);
    if (!targetNode) {
      return { error: '存在无效的关联目标知识域' };
    }
    const targetSenseList = normalizeNodeSenseList(targetNode);
    if (!assoc.targetSenseId) {
      assoc.targetSenseId = targetSenseList[0]?.senseId || '';
    }
    const matched = targetSenseList.some((sense) => sense.senseId === assoc.targetSenseId);
    if (!matched) {
      return { error: `目标知识域「${targetNode.name}」不存在指定释义` };
    }
  }

  const relationRuleValidation = validateAssociationRuleSet({
    currentNodeId,
    associations: normalizedAssociations
  });
  if (relationRuleValidation.error) {
    return { error: relationRuleValidation.error };
  }

  const {
    error: associationResolveError,
    effectiveAssociations,
    insertPlans
  } = resolveAssociationsWithInsertPlans(normalizedAssociations);
  if (associationResolveError) {
    return { error: associationResolveError };
  }
  const effectiveRelationRuleValidation = validateAssociationRuleSet({
    currentNodeId,
    associations: effectiveAssociations
  });
  if (effectiveRelationRuleValidation.error) {
    return { error: effectiveRelationRuleValidation.error };
  }

  return {
    error: '',
    normalizedAssociations,
    effectiveAssociations,
    insertPlans
  };
};

const buildAssociationMutationPreviewData = async ({
  node,
  effectiveAssociations = [],
  insertPlans = [],
  onRemovalStrategy = 'disconnect',
  bridgeDecisions = []
}) => {
  const oldRelationAssociations = normalizeRelationAssociationList(node?.associations || []);
  const nextRelationAssociations = normalizeRelationAssociationList(effectiveAssociations);
  const lostBridgePairs = computeLostBridgePairs(oldRelationAssociations, nextRelationAssociations);
  const strategy = normalizeAssociationRemovalStrategy(onRemovalStrategy);
  const reconnectResolveResult = resolveReconnectPairsByDecisions({
    lostBridgePairs,
    onRemovalStrategy: strategy,
    bridgeDecisions
  });
  const reconnectPairs = reconnectResolveResult.reconnectPairs;

  const summaryTargetNodeIds = new Set();
  oldRelationAssociations.forEach((assoc) => {
    if (isValidObjectId(assoc.targetNode)) summaryTargetNodeIds.add(assoc.targetNode);
  });
  nextRelationAssociations.forEach((assoc) => {
    if (isValidObjectId(assoc.targetNode)) summaryTargetNodeIds.add(assoc.targetNode);
  });
  lostBridgePairs.forEach((pair) => {
    if (isValidObjectId(pair?.upperNodeId)) summaryTargetNodeIds.add(pair.upperNodeId);
    if (isValidObjectId(pair?.lowerNodeId)) summaryTargetNodeIds.add(pair.lowerNodeId);
  });

  const targetNodeIds = Array.from(summaryTargetNodeIds);
  const targetNodes = targetNodeIds.length > 0
    ? await Node.find({ _id: { $in: targetNodeIds } }).select('_id name synonymSenses description').lean()
    : [];
  await hydrateNodeSensesForNodes(targetNodes);
  const targetNodeMap = new Map(targetNodes.map((item) => [getIdString(item._id), item]));
  const mutationSummary = buildAssociationMutationSummary({
    node,
    oldAssociations: oldRelationAssociations,
    nextAssociations: nextRelationAssociations,
    lostBridgePairs,
    reconnectPairs,
    targetNodeMap
  });
  mutationSummary.insertPlanNarratives = buildInsertPlanNarratives({
    node,
    insertPlans,
    targetNodeMap
  });

  return {
    strategy,
    oldRelationAssociations,
    nextRelationAssociations,
    lostBridgePairs,
    bridgeDecisionItems: reconnectResolveResult.decisionItems,
    unresolvedBridgeDecisionCount: reconnectResolveResult.unresolvedCount,
    reconnectPairs,
    mutationSummary
  };
};

const resolveAssociationsWithInsertPlans = (normalizedAssociations = []) => {
  const list = Array.isArray(normalizedAssociations) ? normalizedAssociations : [];
  const insertGroupMap = new Map();
  const effectiveAssociations = [];

  for (const assoc of list) {
    if (assoc.relationType !== 'insert') {
      effectiveAssociations.push({
        targetNode: assoc.targetNode,
        relationType: assoc.relationType,
        sourceSenseId: assoc.sourceSenseId,
        targetSenseId: assoc.targetSenseId,
        insertSide: '',
        insertGroupId: ''
      });
      continue;
    }

    if (!assoc.insertGroupId) {
      return { error: '插入关系缺少分组标识，请重新选择插入关系目标' };
    }
    if (assoc.insertSide !== 'left' && assoc.insertSide !== 'right') {
      return { error: '插入关系必须明确左侧（上级）和右侧（下级）' };
    }

    const groupKey = `${assoc.sourceSenseId}|${assoc.insertGroupId}`;
    const group = insertGroupMap.get(groupKey) || {
      sourceSenseId: assoc.sourceSenseId,
      left: null,
      right: null
    };
    if (group[assoc.insertSide]) {
      return { error: '同一插入关系中，左侧或右侧目标不能重复选择' };
    }
    group[assoc.insertSide] = assoc;
    insertGroupMap.set(groupKey, group);
  }

  const insertPlans = [];
  for (const group of insertGroupMap.values()) {
    if (!group.left || !group.right) {
      return { error: '每条插入关系都必须同时选择上级释义和下级释义' };
    }

    const leftKey = `${group.left.targetNode}:${group.left.targetSenseId}`;
    const rightKey = `${group.right.targetNode}:${group.right.targetSenseId}`;
    if (leftKey === rightKey) {
      return { error: '插入关系中，上级与下级不能是同一个释义' };
    }

    insertPlans.push({
      sourceSenseId: group.sourceSenseId,
      upperNodeId: group.left.targetNode,
      upperSenseId: group.left.targetSenseId,
      lowerNodeId: group.right.targetNode,
      lowerSenseId: group.right.targetSenseId
    });

    effectiveAssociations.push({
      targetNode: group.left.targetNode,
      relationType: 'extends',
      sourceSenseId: group.sourceSenseId,
      targetSenseId: group.left.targetSenseId,
      insertSide: '',
      insertGroupId: ''
    });
    effectiveAssociations.push({
      targetNode: group.right.targetNode,
      relationType: 'contains',
      sourceSenseId: group.sourceSenseId,
      targetSenseId: group.right.targetSenseId,
      insertSide: '',
      insertGroupId: ''
    });
  }

  return {
    error: '',
    insertPlans,
    effectiveAssociations: dedupeAssociationList(effectiveAssociations)
  };
};

const rebuildRelatedDomainNamesForNodes = async (nodeDocs = []) => {
  const docs = (Array.isArray(nodeDocs) ? nodeDocs : []).filter(Boolean);
  if (docs.length === 0) return;

  const targetIdSet = new Set();
  docs.forEach((doc) => {
    (Array.isArray(doc?.associations) ? doc.associations : []).forEach((assoc) => {
      const relationType = normalizeAssociationRelationType(assoc?.relationType);
      if (relationType !== 'contains' && relationType !== 'extends') return;
      const targetId = getIdString(assoc?.targetNode);
      if (isValidObjectId(targetId)) targetIdSet.add(targetId);
    });
  });

  const targetIds = Array.from(targetIdSet);
  const targetNodes = targetIds.length > 0
    ? await Node.find({ _id: { $in: targetIds } }).select('_id name').lean()
    : [];
  const targetNameMap = new Map(targetNodes.map((item) => [getIdString(item._id), item.name || '']));

  docs.forEach((doc) => {
    const parentSet = new Set();
    const childSet = new Set();
    (Array.isArray(doc?.associations) ? doc.associations : []).forEach((assoc) => {
      const relationType = normalizeAssociationRelationType(assoc?.relationType);
      if (relationType !== 'contains' && relationType !== 'extends') return;
      const targetId = getIdString(assoc?.targetNode);
      const targetName = targetNameMap.get(targetId) || '';
      if (!targetName) return;
      if (relationType === 'extends') {
        parentSet.add(targetName);
      } else if (relationType === 'contains') {
        childSet.add(targetName);
      }
    });
    doc.relatedParentDomains = Array.from(parentSet);
    doc.relatedChildDomains = Array.from(childSet);
  });
};

const isAssociationSenseCompatible = (storedSenseId = '', expectedSenseId = '') => {
  const stored = typeof storedSenseId === 'string' ? storedSenseId.trim() : '';
  const expected = typeof expectedSenseId === 'string' ? expectedSenseId.trim() : '';
  if (!expected) return true;
  return !stored || stored === expected;
};

const removeDirectedContainsOrExtendsAssociation = (
  nodeDoc,
  targetNodeId,
  expectedSourceSenseId,
  expectedTargetSenseId
) => {
  const targetId = getIdString(targetNodeId);
  if (!targetId || !Array.isArray(nodeDoc?.associations)) return false;

  let changed = false;
  nodeDoc.associations = nodeDoc.associations.filter((assoc) => {
    const assocTargetNodeId = getIdString(assoc?.targetNode);
    if (assocTargetNodeId !== targetId) return true;
    const relationType = normalizeAssociationRelationType(assoc?.relationType);
    if (relationType !== 'contains' && relationType !== 'extends') return true;

    const sourceMatches = isAssociationSenseCompatible(assoc?.sourceSenseId, expectedSourceSenseId);
    const targetMatches = isAssociationSenseCompatible(assoc?.targetSenseId, expectedTargetSenseId);
    if (!sourceMatches || !targetMatches) return true;

    changed = true;
    return false;
  });

  return changed;
};

const addAssociationIfMissing = (nodeDoc, association) => {
  const nextAssoc = {
    targetNode: getIdString(association?.targetNode),
    relationType: normalizeAssociationRelationType(association?.relationType),
    sourceSenseId: typeof association?.sourceSenseId === 'string' ? association.sourceSenseId.trim() : '',
    targetSenseId: typeof association?.targetSenseId === 'string' ? association.targetSenseId.trim() : '',
    insertSide: '',
    insertGroupId: ''
  };
  if (!nextAssoc.targetNode || !nextAssoc.relationType || !nextAssoc.sourceSenseId || !nextAssoc.targetSenseId) {
    return false;
  }

  const exists = (Array.isArray(nodeDoc?.associations) ? nodeDoc.associations : []).some((assoc) => (
    getIdString(assoc?.targetNode) === nextAssoc.targetNode
    && normalizeAssociationRelationType(assoc?.relationType) === nextAssoc.relationType
    && (typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '') === nextAssoc.sourceSenseId
    && (typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '') === nextAssoc.targetSenseId
  ));
  if (exists) return false;

  if (!Array.isArray(nodeDoc.associations)) nodeDoc.associations = [];
  nodeDoc.associations.push(nextAssoc);
  return true;
};

const hasDirectedAssociationToTargetNode = (nodeDoc, targetNodeId, relationType = '') => {
  const targetId = getIdString(targetNodeId);
  if (!targetId || !Array.isArray(nodeDoc?.associations)) return false;
  return nodeDoc.associations.some((assoc) => {
    const assocTargetId = getIdString(assoc?.targetNode);
    if (assocTargetId !== targetId) return false;
    const assocRelationType = normalizeAssociationRelationType(assoc?.relationType);
    if (assocRelationType !== 'contains' && assocRelationType !== 'extends') return false;
    if (!relationType) return true;
    return assocRelationType === relationType;
  });
};

const ensureRelatedDomainList = (value) => (
  Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : []
);

const addRelatedDomainName = (list, name) => {
  const safeName = typeof name === 'string' ? name.trim() : '';
  if (!safeName) return list;
  const source = ensureRelatedDomainList(list);
  if (source.includes(safeName)) return source;
  return [...source, safeName];
};

const removeRelatedDomainName = (list, name) => {
  const safeName = typeof name === 'string' ? name.trim() : '';
  if (!safeName) return ensureRelatedDomainList(list);
  return ensureRelatedDomainList(list).filter((item) => item !== safeName);
};

const applyInsertAssociationRewire = async ({ insertPlans = [], newNodeId = '', newNodeName = '' }) => {
  const plans = Array.isArray(insertPlans) ? insertPlans : [];
  const currentNodeId = getIdString(newNodeId);
  if (!currentNodeId || !newNodeName || plans.length === 0) return;

  const touchedTargetIdSet = new Set();
  plans.forEach((plan) => {
    if (isValidObjectId(plan?.upperNodeId)) touchedTargetIdSet.add(plan.upperNodeId);
    if (isValidObjectId(plan?.lowerNodeId)) touchedTargetIdSet.add(plan.lowerNodeId);
  });
  const touchedTargetIds = Array.from(touchedTargetIdSet);
  if (touchedTargetIds.length === 0) return;

  const targetNodes = await Node.find({ _id: { $in: touchedTargetIds }, status: 'approved' });
  const targetNodeMap = new Map(targetNodes.map((item) => [getIdString(item._id), item]));
  const dirtyTargetNodeMap = new Map();

  plans.forEach((plan) => {
    const upperNode = targetNodeMap.get(plan.upperNodeId);
    const lowerNode = targetNodeMap.get(plan.lowerNodeId);
    if (!upperNode || !lowerNode) return;
    const upperNodeName = typeof upperNode?.name === 'string' ? upperNode.name.trim() : '';
    const lowerNodeName = typeof lowerNode?.name === 'string' ? lowerNode.name.trim() : '';

    const removedUpperToLower = removeDirectedContainsOrExtendsAssociation(
      upperNode,
      lowerNode._id,
      plan.upperSenseId,
      plan.lowerSenseId
    );
    const removedLowerToUpper = removeDirectedContainsOrExtendsAssociation(
      lowerNode,
      upperNode._id,
      plan.lowerSenseId,
      plan.upperSenseId
    );

    const addedUpperToNew = addAssociationIfMissing(upperNode, {
      targetNode: currentNodeId,
      relationType: 'contains',
      sourceSenseId: plan.upperSenseId,
      targetSenseId: plan.sourceSenseId
    });
    const addedLowerToNew = addAssociationIfMissing(lowerNode, {
      targetNode: currentNodeId,
      relationType: 'extends',
      sourceSenseId: plan.lowerSenseId,
      targetSenseId: plan.sourceSenseId
    });

    if (removedUpperToLower) {
      if (!hasDirectedAssociationToTargetNode(upperNode, lowerNode._id, 'contains') && lowerNodeName) {
        upperNode.relatedChildDomains = removeRelatedDomainName(upperNode.relatedChildDomains, lowerNodeName);
      }
      if (!hasDirectedAssociationToTargetNode(upperNode, lowerNode._id, 'extends') && lowerNodeName) {
        upperNode.relatedParentDomains = removeRelatedDomainName(upperNode.relatedParentDomains, lowerNodeName);
      }
    }
    if (removedLowerToUpper) {
      if (!hasDirectedAssociationToTargetNode(lowerNode, upperNode._id, 'contains') && upperNodeName) {
        lowerNode.relatedChildDomains = removeRelatedDomainName(lowerNode.relatedChildDomains, upperNodeName);
      }
      if (!hasDirectedAssociationToTargetNode(lowerNode, upperNode._id, 'extends') && upperNodeName) {
        lowerNode.relatedParentDomains = removeRelatedDomainName(lowerNode.relatedParentDomains, upperNodeName);
      }
    }
    if (addedUpperToNew) {
      upperNode.relatedChildDomains = addRelatedDomainName(upperNode.relatedChildDomains, newNodeName);
    }
    if (addedLowerToNew) {
      lowerNode.relatedParentDomains = addRelatedDomainName(lowerNode.relatedParentDomains, newNodeName);
    }

    if (removedUpperToLower || addedUpperToNew) {
      dirtyTargetNodeMap.set(getIdString(upperNode._id), upperNode);
    }
    if (removedLowerToUpper || addedLowerToNew) {
      dirtyTargetNodeMap.set(getIdString(lowerNode._id), lowerNode);
    }
  });

  const dirtyNodes = Array.from(dirtyTargetNodeMap.values());
  if (dirtyNodes.length === 0) return;
  for (const targetNode of dirtyNodes) {
    await targetNode.save();
    await syncDomainTitleProjectionFromNode(targetNode);
  }
};

const syncReciprocalAssociationsForNode = async ({
  nodeDoc,
  oldAssociations = [],
  nextAssociations = []
}) => {
  const currentNodeId = getIdString(nodeDoc?._id);
  if (!currentNodeId) return;

  const oldRelations = normalizeRelationAssociationList(oldAssociations);
  const nextRelations = normalizeRelationAssociationList(nextAssociations);
  const oldMap = new Map(oldRelations.map((assoc) => [toAssociationEdgeKey(assoc), assoc]));
  const nextMap = new Map(nextRelations.map((assoc) => [toAssociationEdgeKey(assoc), assoc]));

  const targetNodeIds = Array.from(new Set(
    [...oldRelations, ...nextRelations]
      .map((assoc) => getIdString(assoc?.targetNode))
      .filter((id) => isValidObjectId(id))
  ));
  if (targetNodeIds.length === 0) return;

  const targetNodes = await Node.find({ _id: { $in: targetNodeIds }, status: 'approved' });
  const targetNodeMap = new Map(targetNodes.map((item) => [getIdString(item._id), item]));
  const dirtyMap = new Map();

  const markDirty = (targetNode) => {
    if (!targetNode?._id) return;
    dirtyMap.set(getIdString(targetNode._id), targetNode);
  };

  for (const [edgeKey, assoc] of oldMap.entries()) {
    if (nextMap.has(edgeKey)) continue;
    const targetNode = targetNodeMap.get(getIdString(assoc?.targetNode));
    if (!targetNode) continue;
    const removed = removeDirectedContainsOrExtendsAssociation(
      targetNode,
      currentNodeId,
      assoc?.targetSenseId,
      assoc?.sourceSenseId
    );
    if (removed) {
      markDirty(targetNode);
    }
  }

  for (const assoc of nextMap.values()) {
    const targetNode = targetNodeMap.get(getIdString(assoc?.targetNode));
    if (!targetNode) continue;

    const reciprocalType = getReciprocalRelationType(assoc?.relationType);
    if (!reciprocalType) continue;
    const oppositeType = getReciprocalRelationType(reciprocalType);
    const sourceSenseId = assoc?.targetSenseId || '';
    const targetSenseId = assoc?.sourceSenseId || '';

    const hasReciprocal = hasExactDirectedContainsOrExtendsAssociation(
      targetNode,
      currentNodeId,
      reciprocalType,
      sourceSenseId,
      targetSenseId
    );
    const hasOpposite = hasExactDirectedContainsOrExtendsAssociation(
      targetNode,
      currentNodeId,
      oppositeType,
      sourceSenseId,
      targetSenseId
    );

    if (hasReciprocal && !hasOpposite) continue;

    if (hasOpposite) {
      removeDirectedContainsOrExtendsAssociation(
        targetNode,
        currentNodeId,
        sourceSenseId,
        targetSenseId
      );
    }

    const added = (!hasReciprocal || hasOpposite)
      ? addAssociationIfMissing(targetNode, {
          targetNode: currentNodeId,
          relationType: reciprocalType,
          sourceSenseId,
          targetSenseId
        })
      : false;
    if (hasOpposite || added) {
      markDirty(targetNode);
    }
  }

  const dirtyNodes = Array.from(dirtyMap.values());
  if (dirtyNodes.length === 0) return;
  await rebuildRelatedDomainNamesForNodes(dirtyNodes);
  for (const targetNode of dirtyNodes) {
    await targetNode.save();
    await syncDomainTitleProjectionFromNode(targetNode);
  }
};

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const CITY_BUILDING_LIMIT = 3;
const CITY_BUILDING_DEFAULT_RADIUS = 0.17;
const CITY_BUILDING_MIN_DISTANCE = 0.34;
const CITY_BUILDING_MAX_DISTANCE = 0.86;
const CITY_GATE_KEYS = ['cheng', 'qi'];
const USER_INTEL_SNAPSHOT_LIMIT = 5;
const CITY_GATE_LABELS = {
  cheng: '承门',
  qi: '启门'
};
const SIEGE_SUPPORT_UNIT_DURATION_SECONDS = 60;

const VISUAL_PATTERN_TYPES = ['none', 'dots', 'grid', 'diagonal', 'rings', 'noise'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const normalizeHexColor = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return HEX_COLOR_RE.test(normalized) ? normalized.toLowerCase() : fallback;
};

const normalizePatternType = (value, fallback = 'diagonal') => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return VISUAL_PATTERN_TYPES.includes(normalized) ? normalized : fallback;
};

const round3 = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Number(parsed.toFixed(3));
};

const serializeIntelSnapshot = (snapshot = {}) => {
  const source = typeof snapshot?.toObject === 'function' ? snapshot.toObject() : snapshot;
  const gateDefenseSource = source?.gateDefense && typeof source.gateDefense === 'object'
    ? source.gateDefense
    : {};
  return {
    nodeId: getIdString(source?.nodeId),
    nodeName: source?.nodeName || '',
    sourceBuildingId: source?.sourceBuildingId || '',
    deploymentUpdatedAt: source?.deploymentUpdatedAt || null,
    capturedAt: source?.capturedAt || null,
    gateDefense: CITY_GATE_KEYS.reduce((acc, key) => {
      const entries = Array.isArray(gateDefenseSource[key]) ? gateDefenseSource[key] : [];
      acc[key] = entries
        .map((entry) => ({
          unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
          unitName: typeof entry?.unitName === 'string' ? entry.unitName : '',
          count: Math.max(0, Math.floor(Number(entry?.count) || 0))
        }))
        .filter((entry) => entry.unitTypeId && entry.count > 0);
      return acc;
    }, { cheng: [], qi: [] })
  };
};

const toIntelSnapshotTimestamp = (value) => {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
};

const listUserIntelSnapshotEntries = (rawSnapshots = null) => {
  if (!rawSnapshots) return [];
  if (rawSnapshots instanceof Map) {
    return Array.from(rawSnapshots.entries());
  }
  if (Array.isArray(rawSnapshots)) {
    return rawSnapshots
      .map((item) => [getIdString(item?.nodeId), item])
      .filter(([nodeId]) => !!nodeId);
  }
  if (typeof rawSnapshots === 'object') {
    const asObject = typeof rawSnapshots.toObject === 'function'
      ? rawSnapshots.toObject()
      : rawSnapshots;
    return Object.entries(asObject || {})
      .filter(([nodeId, value]) => !!getIdString(nodeId) && !!value);
  }
  return [];
};

const normalizeUserIntelSnapshotStore = (rawSnapshots = null, limit = USER_INTEL_SNAPSHOT_LIMIT) => {
  const byNodeId = new Map();
  for (const [rawNodeId, rawSnapshot] of listUserIntelSnapshotEntries(rawSnapshots)) {
    const serialized = serializeIntelSnapshot(rawSnapshot || {});
    const nodeId = getIdString(serialized?.nodeId || rawNodeId);
    if (!nodeId) continue;
    const nextSnapshot = {
      ...serialized,
      nodeId
    };
    const existed = byNodeId.get(nodeId);
    if (!existed) {
      byNodeId.set(nodeId, nextSnapshot);
      continue;
    }
    const existedTs = toIntelSnapshotTimestamp(existed.capturedAt);
    const nextTs = toIntelSnapshotTimestamp(nextSnapshot.capturedAt);
    if (nextTs >= existedTs) {
      byNodeId.set(nodeId, nextSnapshot);
    }
  }

  const sorted = Array.from(byNodeId.entries())
    .sort((a, b) => toIntelSnapshotTimestamp(b[1]?.capturedAt) - toIntelSnapshotTimestamp(a[1]?.capturedAt));
  const limited = Number.isFinite(limit) && limit > 0 ? sorted.slice(0, limit) : sorted;
  return limited.reduce((acc, [nodeId, snapshot]) => {
    acc[nodeId] = snapshot;
    return acc;
  }, {});
};

const findUserIntelSnapshotByNodeId = (user, nodeId) => {
  const targetNodeId = getIdString(nodeId);
  if (!targetNodeId) return null;
  const store = normalizeUserIntelSnapshotStore(user?.intelDomainSnapshots, USER_INTEL_SNAPSHOT_LIMIT);
  return store[targetNodeId] || null;
};

const checkIntelHeistPermission = ({ node, user }) => {
  if (!node || node.status !== 'approved') {
    return { allowed: false, reason: '知识域不存在或不可操作' };
  }
  if (!user) {
    return { allowed: false, reason: '用户不存在' };
  }
  if (user.role !== 'common') {
    return { allowed: false, reason: '仅普通用户可进行情报窃取' };
  }
  const userId = getIdString(user._id);
  if (isDomainMaster(node, userId) || isDomainAdmin(node, userId)) {
    return { allowed: false, reason: '域主/域相不可进行情报窃取' };
  }
  const userLocation = typeof user.location === 'string' ? user.location.trim() : '';
  if (!userLocation || userLocation !== (node.name || '')) {
    return { allowed: false, reason: '必须到达该知识域后才能执行情报窃取' };
  }
  return { allowed: true, reason: '' };
};

const buildIntelGateDefenseSnapshot = (gateDefense = {}, unitTypeMap = new Map()) => {
  const source = gateDefense && typeof gateDefense === 'object' ? gateDefense : {};
  return CITY_GATE_KEYS.reduce((acc, key) => {
    const entries = Array.isArray(source[key]) ? source[key] : [];
    acc[key] = entries
      .map((entry) => {
        const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
        const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
        if (!unitTypeId || count <= 0) return null;
        const unitName = unitTypeMap.get(unitTypeId)?.name || unitTypeId;
        return {
          unitTypeId,
          unitName,
          count
        };
      })
      .filter(Boolean);
    return acc;
  }, { cheng: [], qi: [] });
};

const normalizeGateDefenseViewerAdminIds = (viewerIds = [], allowedAdminIds = null) => {
  const out = [];
  const seen = new Set();
  const allowedSet = Array.isArray(allowedAdminIds) && allowedAdminIds.length > 0
    ? new Set(allowedAdminIds.map((id) => getIdString(id)).filter((id) => isValidObjectId(id)))
    : null;
  for (const item of (Array.isArray(viewerIds) ? viewerIds : [])) {
    const userId = getIdString(item);
    if (!isValidObjectId(userId)) continue;
    if (allowedSet && !allowedSet.has(userId)) continue;
    if (seen.has(userId)) continue;
    seen.add(userId);
    out.push(userId);
  }
  return out;
};

const createDefaultDefenseLayout = () => ({
  buildings: [{
    buildingId: 'core',
    name: '建筑1',
    x: 0,
    y: 0,
    radius: CITY_BUILDING_DEFAULT_RADIUS,
    level: 1,
    nextUnitTypeId: '',
    upgradeCostKP: null
  }],
  intelBuildingId: 'core',
  gateDefense: {
    cheng: [],
    qi: []
  },
  gateDefenseViewAdminIds: []
});

const normalizeDefenseLayoutInput = (input = {}) => {
  const source = input && typeof input === 'object' ? input : {};
  const sourceBuildings = Array.isArray(source.buildings) ? source.buildings : [];
  const normalized = [];
  const seen = new Set();
  for (let index = 0; index < sourceBuildings.length; index += 1) {
    const item = sourceBuildings[index] || {};
    const rawId = typeof item.buildingId === 'string' ? item.buildingId.trim() : '';
    const buildingId = rawId || `building_${Date.now()}_${index}`;
    if (seen.has(buildingId)) continue;
    seen.add(buildingId);
    normalized.push({
      buildingId,
      name: (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : `建筑${normalized.length + 1}`,
      x: Math.max(-1, Math.min(1, round3(item.x, 0))),
      y: Math.max(-1, Math.min(1, round3(item.y, 0))),
      radius: Math.max(0.1, Math.min(0.24, round3(item.radius, CITY_BUILDING_DEFAULT_RADIUS))),
      level: Math.max(1, parseInt(item.level, 10) || 1),
      nextUnitTypeId: typeof item.nextUnitTypeId === 'string' ? item.nextUnitTypeId.trim() : '',
      upgradeCostKP: Number.isFinite(Number(item.upgradeCostKP)) && Number(item.upgradeCostKP) >= 0
        ? Number(Number(item.upgradeCostKP).toFixed(2))
        : null
    });
    if (normalized.length >= CITY_BUILDING_LIMIT) break;
  }

  if (normalized.length === 0) {
    return createDefaultDefenseLayout();
  }

  const isInsideDomain = (item) => Math.sqrt((item.x ** 2) + (item.y ** 2)) <= CITY_BUILDING_MAX_DISTANCE;
  const overlapsOther = (item, others, selfId) => others.some((target) => {
    if (target.buildingId === selfId) return false;
    const dx = item.x - target.x;
    const dy = item.y - target.y;
    return Math.sqrt((dx ** 2) + (dy ** 2)) < CITY_BUILDING_MIN_DISTANCE;
  });

  const valid = normalized.every((item) => isInsideDomain(item) && !overlapsOther(item, normalized, item.buildingId));
  if (!valid) {
    const error = new Error('建筑位置无效：建筑必须位于城区内且互不重叠');
    error.statusCode = 400;
    throw error;
  }

  const sourceIntelBuildingId = typeof source.intelBuildingId === 'string' ? source.intelBuildingId.trim() : '';
  const intelBuildingId = normalized.some((item) => item.buildingId === sourceIntelBuildingId)
    ? sourceIntelBuildingId
    : normalized[0].buildingId;

  const sourceGateDefense = source.gateDefense && typeof source.gateDefense === 'object'
    ? source.gateDefense
    : {};
  const normalizeGateDefenseEntries = (entries = []) => {
    const out = [];
    const seen = new Set();
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
      const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
      if (!unitTypeId || count <= 0) continue;
      if (seen.has(unitTypeId)) continue;
      seen.add(unitTypeId);
      out.push({ unitTypeId, count });
    }
    return out;
  };
  const gateDefense = CITY_GATE_KEYS.reduce((acc, key) => {
    acc[key] = normalizeGateDefenseEntries(sourceGateDefense[key]);
    return acc;
  }, { cheng: [], qi: [] });
  const gateDefenseViewAdminIds = normalizeGateDefenseViewerAdminIds(source.gateDefenseViewAdminIds);

  return {
    buildings: normalized,
    intelBuildingId,
    gateDefense,
    gateDefenseViewAdminIds
  };
};

const serializeDefenseLayout = (layout = {}) => {
  let normalized;
  try {
    normalized = normalizeDefenseLayoutInput(layout);
  } catch (error) {
    normalized = createDefaultDefenseLayout();
  }
  return {
    buildings: normalized.buildings.map((item) => ({
      buildingId: item.buildingId,
      name: item.name || '',
      x: round3(item.x, 0),
      y: round3(item.y, 0),
      radius: round3(item.radius, CITY_BUILDING_DEFAULT_RADIUS),
      level: Number(item.level || 1),
      nextUnitTypeId: item.nextUnitTypeId || '',
      upgradeCostKP: Number.isFinite(Number(item.upgradeCostKP)) ? Number(item.upgradeCostKP) : null
    })),
    intelBuildingId: normalized.intelBuildingId,
    gateDefense: CITY_GATE_KEYS.reduce((acc, key) => {
      const entries = Array.isArray(normalized?.gateDefense?.[key]) ? normalized.gateDefense[key] : [];
      acc[key] = entries
        .map((entry) => ({
          unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
          count: Math.max(0, Math.floor(Number(entry?.count) || 0))
        }))
        .filter((entry) => entry.unitTypeId && entry.count > 0);
      return acc;
    }, { cheng: [], qi: [] }),
    gateDefenseViewAdminIds: normalizeGateDefenseViewerAdminIds(normalized.gateDefenseViewAdminIds)
  };
};

const getArmyUnitTypeId = (unit) => {
  const id = typeof unit?.id === 'string' ? unit.id.trim() : '';
  if (id) return id;
  return typeof unit?.unitTypeId === 'string' ? unit.unitTypeId.trim() : '';
};

const buildArmyUnitTypeMap = (unitTypes = []) => {
  const map = new Map();
  (Array.isArray(unitTypes) ? unitTypes : []).forEach((item) => {
    const id = getArmyUnitTypeId(item);
    if (!id) return;
    map.set(id, item);
  });
  return map;
};

const normalizeUnitCountEntries = (entries = []) => {
  const out = [];
  const seen = new Set();
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
    if (!unitTypeId || count <= 0 || seen.has(unitTypeId)) continue;
    seen.add(unitTypeId);
    out.push({ unitTypeId, count });
  }
  return out;
};

const buildUnitCountMap = (entries = []) => {
  const map = new Map();
  normalizeUnitCountEntries(entries).forEach((entry) => {
    map.set(entry.unitTypeId, (map.get(entry.unitTypeId) || 0) + entry.count);
  });
  return map;
};

const mergeUnitCountMaps = (...maps) => {
  const merged = new Map();
  maps.forEach((map) => {
    if (!(map instanceof Map)) return;
    for (const [unitTypeId, count] of map.entries()) {
      const normalized = Math.max(0, Math.floor(Number(count) || 0));
      if (!unitTypeId || normalized <= 0) continue;
      merged.set(unitTypeId, (merged.get(unitTypeId) || 0) + normalized);
    }
  });
  return merged;
};

const mapToUnitCountEntries = (countMap = new Map(), unitTypeMap = new Map()) => {
  if (!(countMap instanceof Map)) return [];
  return Array.from(countMap.entries())
    .map(([unitTypeId, count]) => {
      const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
      if (!unitTypeId || normalizedCount <= 0) return null;
      const unitType = unitTypeMap.get(unitTypeId);
      return {
        unitTypeId,
        unitName: unitType?.name || unitTypeId,
        count: normalizedCount
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);
};

const normalizeUserRoster = (rawRoster = [], unitTypes = []) => {
  const rosterById = new Map();
  for (const item of (Array.isArray(rawRoster) ? rawRoster : [])) {
    const unitTypeId = typeof item?.unitTypeId === 'string' ? item.unitTypeId.trim() : '';
    if (!unitTypeId || rosterById.has(unitTypeId)) continue;
    rosterById.set(unitTypeId, {
      unitTypeId,
      count: Math.max(0, Math.floor(Number(item?.count) || 0)),
      level: Math.max(1, Math.floor(Number(item?.level) || 1)),
      nextUnitTypeId: typeof item?.nextUnitTypeId === 'string' && item.nextUnitTypeId.trim()
        ? item.nextUnitTypeId.trim()
        : null,
      upgradeCostKP: Number.isFinite(Number(item?.upgradeCostKP))
        ? Math.max(0, Number(item.upgradeCostKP))
        : null
    });
  }
  return (Array.isArray(unitTypes) ? unitTypes : []).map((unitType) => {
    const unitTypeId = getArmyUnitTypeId(unitType);
    const existed = rosterById.get(unitTypeId);
    if (existed) {
      return existed;
    }
    return {
      unitTypeId,
      count: 0,
      level: Math.max(1, Math.floor(Number(unitType?.level) || 1)),
      nextUnitTypeId: unitType?.nextUnitTypeId || null,
      upgradeCostKP: Number.isFinite(Number(unitType?.upgradeCostKP))
        ? Math.max(0, Number(unitType.upgradeCostKP))
        : null
    };
  });
};

const getSnapshotGateDefenseByUnitMap = (snapshot = {}) => {
  const source = snapshot?.gateDefense && typeof snapshot.gateDefense === 'object'
    ? snapshot.gateDefense
    : {};
  return CITY_GATE_KEYS.reduce((acc, gateKey) => {
    acc[gateKey] = buildUnitCountMap(source[gateKey] || []);
    return acc;
  }, { cheng: new Map(), qi: new Map() });
};

const isGateEnabledForNode = (node, gateKey) => {
  if (gateKey === 'cheng') {
    return Array.isArray(node?.relatedParentDomains) && node.relatedParentDomains.length > 0;
  }
  if (gateKey === 'qi') {
    return Array.isArray(node?.relatedChildDomains) && node.relatedChildDomains.length > 0;
  }
  return false;
};

const getOrderedEnabledGateKeys = (node, preferredGate = '') => {
  const enabledGateKeys = CITY_GATE_KEYS.filter((gateKey) => isGateEnabledForNode(node, gateKey));
  if (enabledGateKeys.length <= 1) return enabledGateKeys;
  if (preferredGate && enabledGateKeys.includes(preferredGate)) {
    return [preferredGate, ...enabledGateKeys.filter((gateKey) => gateKey !== preferredGate)];
  }
  return enabledGateKeys;
};

const buildGateDefenseView = (node, gateDefenseByMap = {}, unitTypeMap = new Map(), preferredGate = '') => {
  const orderedGateKeys = getOrderedEnabledGateKeys(node, preferredGate);
  return orderedGateKeys.map((gateKey, index) => {
    const map = gateDefenseByMap?.[gateKey] instanceof Map ? gateDefenseByMap[gateKey] : new Map();
    const entries = mapToUnitCountEntries(map, unitTypeMap);
    return {
      gateKey,
      gateLabel: CITY_GATE_LABELS[gateKey] || gateKey,
      enabled: true,
      highlight: index === 0,
      totalCount: entries.reduce((sum, item) => sum + item.count, 0),
      entries
    };
  });
};

const parseSupportStatusLabel = (status = '') => {
  if (status === 'moving') return '支援中';
  if (status === 'sieging') return '围城中';
  return '已撤退';
};

const serializeSiegeAttacker = (attacker = {}, unitTypeMap = new Map(), now = Date.now()) => {
  const units = mapToUnitCountEntries(buildUnitCountMap(attacker?.units || []), unitTypeMap);
  const totalCount = units.reduce((sum, item) => sum + item.count, 0);
  const arriveAtMs = new Date(attacker?.arriveAt || 0).getTime();
  const remainingSeconds = attacker?.status === 'moving' && Number.isFinite(arriveAtMs) && arriveAtMs > now
    ? Math.ceil((arriveAtMs - now) / 1000)
    : 0;
  return {
    userId: getIdString(attacker?.userId),
    username: typeof attacker?.username === 'string' ? attacker.username : '',
    allianceId: getIdString(attacker?.allianceId),
    status: attacker?.status === 'moving' || attacker?.status === 'retreated' ? attacker.status : 'sieging',
    statusLabel: parseSupportStatusLabel(attacker?.status),
    isInitiator: !!attacker?.isInitiator,
    isReinforcement: !!attacker?.isReinforcement,
    autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(attacker?.autoRetreatPercent) || 40))),
    fromNodeId: getIdString(attacker?.fromNodeId),
    fromNodeName: typeof attacker?.fromNodeName === 'string' ? attacker.fromNodeName : '',
    requestedAt: attacker?.requestedAt || null,
    arriveAt: attacker?.arriveAt || null,
    joinedAt: attacker?.joinedAt || null,
    updatedAt: attacker?.updatedAt || null,
    totalCount,
    remainingSeconds,
    units
  };
};

const resolveAttackGateByArrival = (node, user) => {
  const fromNodeId = getIdString(user?.lastArrivedFromNodeId);
  const fromNodeName = typeof user?.lastArrivedFromNodeName === 'string' ? user.lastArrivedFromNodeName.trim() : '';
  const parentNames = new Set((Array.isArray(node?.relatedParentDomains) ? node.relatedParentDomains : []).map((name) => (typeof name === 'string' ? name.trim() : '')).filter(Boolean));
  const childNames = new Set((Array.isArray(node?.relatedChildDomains) ? node.relatedChildDomains : []).map((name) => (typeof name === 'string' ? name.trim() : '')).filter(Boolean));

  const arrivedFromParent = fromNodeName && parentNames.has(fromNodeName);
  const arrivedFromChild = fromNodeName && childNames.has(fromNodeName);
  if (arrivedFromParent) return 'cheng';
  if (arrivedFromChild) return 'qi';

  // 兜底：如果只有单门可用，则按唯一可用门判定
  if (!fromNodeId && !fromNodeName) {
    const hasCheng = isGateEnabledForNode(node, 'cheng');
    const hasQi = isGateEnabledForNode(node, 'qi');
    if (hasCheng && !hasQi) return 'cheng';
    if (!hasCheng && hasQi) return 'qi';
  }
  return '';
};

const getNodeGateState = (node, gateKey) => {
  const source = (node?.__workingCitySiegeState && typeof node.__workingCitySiegeState === 'object')
    ? node.__workingCitySiegeState
    : resolveNodeSiegeState(node, {});
  const gate = source?.[gateKey] && typeof source[gateKey] === 'object' ? source[gateKey] : {};
  const attackers = Array.isArray(gate.attackers) ? gate.attackers : [];
  return {
    active: !!gate.active,
    startedAt: gate.startedAt || null,
    updatedAt: gate.updatedAt || null,
    supportNotifiedAt: gate.supportNotifiedAt || null,
    attackerAllianceId: gate.attackerAllianceId || null,
    initiatorUserId: gate.initiatorUserId || null,
    initiatorUsername: gate.initiatorUsername || '',
    attackers
  };
};

const createEmptySiegeGateState = () => ({
  active: false,
  startedAt: null,
  updatedAt: null,
  supportNotifiedAt: null,
  attackerAllianceId: null,
  initiatorUserId: null,
  initiatorUsername: '',
  attackers: []
});

const createDefaultNodeSiegeState = () => ({
  cheng: createEmptySiegeGateState(),
  qi: createEmptySiegeGateState()
});

const clonePlainObject = (input = {}) => JSON.parse(JSON.stringify(input || {}));

const getMutableNodeSiegeState = (node) => {
  if (!node || typeof node !== 'object') {
    return createDefaultNodeSiegeState();
  }
  if (!node.__workingCitySiegeState || typeof node.__workingCitySiegeState !== 'object') {
    const source = resolveNodeSiegeState(node, {});
    const cloned = clonePlainObject(source && typeof source === 'object' ? source : {});
    node.__workingCitySiegeState = {
      cheng: cloned?.cheng && typeof cloned.cheng === 'object'
        ? cloned.cheng
        : createEmptySiegeGateState(),
      qi: cloned?.qi && typeof cloned.qi === 'object'
        ? cloned.qi
        : createEmptySiegeGateState()
    };
  }
  return node.__workingCitySiegeState;
};

const settleNodeSiegeState = (node, nowDate = new Date()) => {
  const siegeState = getMutableNodeSiegeState(node);
  let changed = false;
  const nowMs = nowDate.getTime();

  for (const gateKey of CITY_GATE_KEYS) {
    const gate = siegeState?.[gateKey];
    if (!gate || typeof gate !== 'object') continue;
    const attackers = Array.isArray(gate.attackers) ? gate.attackers : [];
    for (const attacker of attackers) {
      if (!attacker || typeof attacker !== 'object') continue;
      if (attacker.status !== 'moving') continue;
      const arriveAtMs = new Date(attacker.arriveAt || 0).getTime();
      if (!Number.isFinite(arriveAtMs) || arriveAtMs <= 0) continue;
      if (arriveAtMs > nowMs) continue;
      attacker.status = 'sieging';
      attacker.joinedAt = attacker.joinedAt || nowDate;
      attacker.updatedAt = nowDate;
      changed = true;
    }

    const hasActive = attackers.some((item) => item?.status === 'moving' || item?.status === 'sieging');
    if (!!gate.active !== hasActive) {
      gate.active = hasActive;
      changed = true;
    }

    if (!hasActive) {
      if (gate.attackerAllianceId) {
        gate.attackerAllianceId = null;
        changed = true;
      }
      continue;
    }

    if (!gate.startedAt) {
      gate.startedAt = nowDate;
      changed = true;
    }

    const activeFirst = attackers.find((item) => item?.status === 'moving' || item?.status === 'sieging') || null;
    const activeAllianceId = activeFirst?.allianceId || null;
    if (getIdString(gate.attackerAllianceId) !== getIdString(activeAllianceId)) {
      gate.attackerAllianceId = activeAllianceId;
      changed = true;
    }
  }

  if (changed) {
    for (const gateKey of CITY_GATE_KEYS) {
      const gate = siegeState?.[gateKey];
      if (gate && typeof gate === 'object') {
        gate.updatedAt = nowDate;
      }
    }
  }
  return {
    changed,
    siegeState
  };
};

const isSameAlliance = (allianceA, allianceB) => {
  const a = getIdString(allianceA);
  const b = getIdString(allianceB);
  return !!a && !!b && a === b;
};

const isSiegeAttackerActive = (attacker) => (
  attacker?.status === 'moving' || attacker?.status === 'sieging'
);

const buildSiegeGateSummary = (node, gateKey, unitTypeMap = new Map()) => {
  const gateState = getNodeGateState(node, gateKey);
  const now = Date.now();
  const attackers = (gateState.attackers || [])
    .map((attacker) => serializeSiegeAttacker(attacker, unitTypeMap, now))
    .filter((item) => !!item.userId);
  const activeAttackers = attackers.filter((item) => item.status === 'moving' || item.status === 'sieging');
  const aggregateMap = activeAttackers.reduce(
    (acc, item) => mergeUnitCountMaps(acc, buildUnitCountMap(item.units || [])),
    new Map()
  );
  const aggregateUnits = mapToUnitCountEntries(aggregateMap, unitTypeMap);
  const totalCount = aggregateUnits.reduce((sum, item) => sum + item.count, 0);
  const active = !!gateState.active && activeAttackers.length > 0;
  return {
    gateKey,
    gateLabel: CITY_GATE_LABELS[gateKey] || gateKey,
    enabled: isGateEnabledForNode(node, gateKey),
    active,
    startedAt: gateState.startedAt || null,
    updatedAt: gateState.updatedAt || null,
    supportNotifiedAt: gateState.supportNotifiedAt || null,
    attackerAllianceId: getIdString(gateState.attackerAllianceId),
    initiatorUserId: getIdString(gateState.initiatorUserId),
    initiatorUsername: gateState.initiatorUsername || '',
    attackers,
    activeAttackers,
    aggregateUnits,
    totalCount
  };
};

const SIEGE_VIEWER_ROLE_COMMON = 'common';
const SIEGE_VIEWER_ROLE_DOMAIN_MASTER = 'domainMaster';
const SIEGE_VIEWER_ROLE_DOMAIN_ADMIN = 'domainAdmin';

const pickDomainAdminAttackerView = (attacker = {}) => ({
  userId: getIdString(attacker?.userId),
  username: typeof attacker?.username === 'string' ? attacker.username : '',
  status: typeof attacker?.status === 'string' ? attacker.status : 'sieging',
  statusLabel: typeof attacker?.statusLabel === 'string' ? attacker.statusLabel : '',
  isInitiator: !!attacker?.isInitiator,
  isReinforcement: !!attacker?.isReinforcement,
  fromNodeName: typeof attacker?.fromNodeName === 'string' ? attacker.fromNodeName : '',
  requestedAt: attacker?.requestedAt || null,
  arriveAt: attacker?.arriveAt || null,
  joinedAt: attacker?.joinedAt || null,
  updatedAt: attacker?.updatedAt || null,
  totalCount: 0,
  remainingSeconds: Math.max(0, Math.floor(Number(attacker?.remainingSeconds) || 0)),
  units: []
});

const maskSiegeGateStateForDomainAdmin = (gateState = {}) => {
  const activeAttackersSource = Array.isArray(gateState?.activeAttackers)
    ? gateState.activeAttackers
    : (Array.isArray(gateState?.attackers) ? gateState.attackers : []).filter((item) => isSiegeAttackerActive(item));
  const activeAttackers = activeAttackersSource
    .map((item) => pickDomainAdminAttackerView(item))
    .filter((item) => !!item.userId);
  return {
    gateKey: typeof gateState?.gateKey === 'string' ? gateState.gateKey : '',
    gateLabel: typeof gateState?.gateLabel === 'string' ? gateState.gateLabel : '',
    enabled: !!gateState?.enabled,
    active: !!gateState?.active && activeAttackers.length > 0,
    startedAt: gateState?.startedAt || null,
    updatedAt: gateState?.updatedAt || null,
    supportNotifiedAt: gateState?.supportNotifiedAt || null,
    attackerAllianceId: getIdString(gateState?.attackerAllianceId),
    initiatorUserId: getIdString(gateState?.initiatorUserId),
    initiatorUsername: typeof gateState?.initiatorUsername === 'string' ? gateState.initiatorUsername : '',
    attackers: activeAttackers,
    activeAttackers,
    aggregateUnits: [],
    totalCount: 0
  };
};

const maskSiegePayloadForDomainAdmin = (payload = {}) => {
  const sourceGateStates = payload?.gateStates && typeof payload.gateStates === 'object'
    ? payload.gateStates
    : {};
  const gateStates = CITY_GATE_KEYS.reduce((acc, gateKey) => {
    acc[gateKey] = maskSiegeGateStateForDomainAdmin(sourceGateStates[gateKey] || {});
    return acc;
  }, { cheng: maskSiegeGateStateForDomainAdmin({ gateKey: 'cheng', gateLabel: CITY_GATE_LABELS.cheng }), qi: maskSiegeGateStateForDomainAdmin({ gateKey: 'qi', gateLabel: CITY_GATE_LABELS.qi }) });
  const activeGateKeys = CITY_GATE_KEYS.filter((gateKey) => !!gateStates[gateKey]?.active);
  const compareGate = (activeGateKeys.includes(payload?.compareGate) ? payload.compareGate : activeGateKeys[0]) || '';
  const compareSupporters = (gateStates[compareGate]?.activeAttackers || []).map((item) => ({
    userId: item.userId,
    username: item.username || '未知成员',
    status: item.status,
    statusLabel: item.statusLabel,
    totalCount: 0
  }));

  return {
    ...payload,
    viewerRole: SIEGE_VIEWER_ROLE_DOMAIN_ADMIN,
    intelUsed: false,
    intelCapturedAt: null,
    intelDeploymentUpdatedAt: null,
    hasActiveSiege: activeGateKeys.length > 0,
    activeGateKeys,
    preferredGate: compareGate,
    compareGate,
    canStartSiege: false,
    startDisabledReason: '域相仅可查看攻方动态，无法发起攻占',
    canRequestSupport: false,
    canSupportSameBattlefield: false,
    supportDisabledReason: '域相仅可查看攻方动态，无法派遣支援',
    supportGate: '',
    canRetreat: false,
    retreatDisabledReason: '域相仅可查看攻方动态，无法执行撤退',
    ownRoster: {
      totalCount: 0,
      units: []
    },
    gateStates,
    compare: {
      gateKey: compareGate,
      gateLabel: CITY_GATE_LABELS[compareGate] || '',
      attacker: {
        totalCount: 0,
        units: [],
        supporters: compareSupporters
      },
      defender: {
        source: 'hidden',
        totalCount: null,
        gates: []
      }
    }
  };
};

const applySiegePayloadViewerRole = ({ payload, node, userId }) => {
  const currentUserId = getIdString(userId);
  if (isDomainMaster(node, currentUserId)) {
    return {
      ...payload,
      viewerRole: SIEGE_VIEWER_ROLE_DOMAIN_MASTER
    };
  }
  if (isDomainAdmin(node, currentUserId)) {
    return maskSiegePayloadForDomainAdmin(payload);
  }
  return {
    ...payload,
    viewerRole: SIEGE_VIEWER_ROLE_COMMON
  };
};

const buildSiegePayloadForUser = ({
  node,
  user,
  unitTypes = [],
  intelSnapshot = null
}) => {
  const unitTypeMap = buildArmyUnitTypeMap(unitTypes);
  const roster = normalizeUserRoster(user?.armyRoster, unitTypes);
  const ownRosterMap = buildUnitCountMap(roster);
  const ownUnits = mapToUnitCountEntries(ownRosterMap, unitTypeMap);
  const ownTotalCount = ownUnits.reduce((sum, item) => sum + item.count, 0);
  const userId = getIdString(user?._id);
  const userAllianceId = getIdString(user?.allianceId);
  const isNodeMaster = isDomainMaster(node, userId);
  const isNodeAdmin = isDomainAdmin(node, userId);

  const gateSummaryMap = CITY_GATE_KEYS.reduce((acc, gateKey) => {
    acc[gateKey] = buildSiegeGateSummary(node, gateKey, unitTypeMap);
    return acc;
  }, { cheng: null, qi: null });
  const activeGateKeys = CITY_GATE_KEYS.filter((gateKey) => gateSummaryMap[gateKey]?.active);

  let userActiveGate = '';
  let userActiveAttacker = null;
  for (const gateKey of activeGateKeys) {
    const matched = gateSummaryMap[gateKey].activeAttackers.find((item) => item.userId === userId) || null;
    if (matched) {
      userActiveGate = gateKey;
      userActiveAttacker = matched;
      break;
    }
  }

  const inferredGate = resolveAttackGateByArrival(node, user);
  const preferredGate = userActiveGate || inferredGate || '';

  const serializedDefenseLayout = serializeDefenseLayout(resolveNodeDefenseLayout(node, {}));
  const domainMasterDefenseSnapshot = isNodeMaster
    ? {
      nodeId: getIdString(node?._id),
      nodeName: node?.name || '',
      sourceBuildingId: '',
      deploymentUpdatedAt: serializedDefenseLayout?.updatedAt || null,
      capturedAt: null,
      gateDefense: buildIntelGateDefenseSnapshot(serializedDefenseLayout.gateDefense, unitTypeMap)
    }
    : null;
  const effectiveDefenderSnapshot = domainMasterDefenseSnapshot || intelSnapshot;
  const intelNodeId = getIdString(effectiveDefenderSnapshot?.nodeId);
  const defenderHasIntel = !!effectiveDefenderSnapshot && intelNodeId === getIdString(node?._id);
  const defenderSource = defenderHasIntel ? 'intel' : 'unknown';
  const defenderGateView = defenderHasIntel
    ? buildGateDefenseView(node, getSnapshotGateDefenseByUnitMap(effectiveDefenderSnapshot), unitTypeMap, preferredGate)
    : [];
  const defenderTotalCount = defenderSource === 'intel'
    ? defenderGateView.reduce((sum, gate) => sum + Math.max(0, Math.floor(Number(gate?.totalCount) || 0)), 0)
    : null;

  const atNode = (typeof user?.location === 'string' ? user.location.trim() : '') === (node?.name || '');
  const canAttemptSiege = user?.role === 'common' && atNode && !isNodeMaster && !isNodeAdmin;
  const selectedStartGate = inferredGate;
  const selectedStartGateState = selectedStartGate ? gateSummaryMap[selectedStartGate] : null;
  const selectedStartGateBlockedByOther = !!selectedStartGateState
    && selectedStartGateState.active
    && !isSameAlliance(selectedStartGateState.attackerAllianceId, userAllianceId)
    && selectedStartGateState.activeAttackers.some((item) => item.userId !== userId);

  let canStartSiege = canAttemptSiege
    && ownTotalCount > 0
    && !!selectedStartGate
    && !!selectedStartGateState?.enabled
    && !selectedStartGateBlockedByOther
    && !selectedStartGateState?.active;
  let startDisabledReason = '';
  if (!canAttemptSiege) {
    if (user?.role !== 'common') {
      startDisabledReason = '仅普通用户可发起攻占';
    } else if (!atNode) {
      startDisabledReason = '需先抵达该知识域后才能攻占';
    } else if (isNodeMaster || isNodeAdmin) {
      startDisabledReason = '域主/域相不可发起攻占';
    } else {
      startDisabledReason = '当前不可攻占';
    }
    canStartSiege = false;
  } else if (ownTotalCount <= 0) {
    canStartSiege = false;
    startDisabledReason = '至少需要拥有一名兵力';
  } else if (!selectedStartGate) {
    canStartSiege = false;
    startDisabledReason = '无法判定围攻门向，请从相邻知识域移动后再试';
  } else if (!selectedStartGateState?.enabled) {
    canStartSiege = false;
    startDisabledReason = '目标门不可用，无法发起围城';
  } else if (selectedStartGateBlockedByOther) {
    canStartSiege = false;
    startDisabledReason = '该门已被其他势力围城';
  } else if (selectedStartGateState?.active) {
    canStartSiege = false;
    startDisabledReason = isSameAlliance(selectedStartGateState.attackerAllianceId, userAllianceId)
      ? '该门已在围城中，可通过支援加入'
      : '该门已在围城中';
  }

  const sameAllianceActiveGates = activeGateKeys.filter((gateKey) => (
    isSameAlliance(gateSummaryMap[gateKey]?.attackerAllianceId, userAllianceId)
  ));
  const supportGate = userActiveGate || (
    preferredGate && sameAllianceActiveGates.includes(preferredGate)
      ? preferredGate
      : sameAllianceActiveGates[0]
  ) || '';
  const canSupportSameBattlefield = !!supportGate
    && !!userAllianceId
    && !userActiveAttacker
    && user?.role === 'common';
  const supportDisabledReason = canSupportSameBattlefield
    ? ''
    : (!userAllianceId
        ? '未加入熵盟，无法支援'
        : (userActiveAttacker ? '你已在该战场中' : '当前无可支援的同盟围城战场'));
  const canRetreat = !!userActiveAttacker && !!userActiveAttacker.isInitiator;
  const retreatDisabledReason = canRetreat
    ? ''
    : (userActiveAttacker ? '仅围城发起者可撤退并取消攻城' : '你未参与当前围城');

  const compareGate = userActiveGate || supportGate || preferredGate || '';
  const attackerCompareUnits = compareGate && gateSummaryMap[compareGate]?.active
    ? gateSummaryMap[compareGate].aggregateUnits
    : ownUnits;
  const attackerCompareTotal = attackerCompareUnits.reduce((sum, item) => sum + item.count, 0);
  const supporterRows = compareGate && gateSummaryMap[compareGate]?.active
    ? gateSummaryMap[compareGate].activeAttackers.map((item) => ({
        userId: item.userId,
        username: item.username || '未知成员',
        status: item.status,
        statusLabel: item.statusLabel,
        totalCount: item.totalCount
      }))
    : [];

  const payload = {
    nodeId: getIdString(node?._id),
    nodeName: node?.name || '',
    intelUsed: !domainMasterDefenseSnapshot && defenderHasIntel,
    intelCapturedAt: !domainMasterDefenseSnapshot && defenderHasIntel ? (effectiveDefenderSnapshot?.capturedAt || null) : null,
    intelDeploymentUpdatedAt: defenderHasIntel ? (effectiveDefenderSnapshot?.deploymentUpdatedAt || null) : null,
    gateStates: {
      cheng: gateSummaryMap.cheng,
      qi: gateSummaryMap.qi
    },
    activeGateKeys,
    hasActiveSiege: activeGateKeys.length > 0,
    preferredGate,
    inferredGate,
    compareGate,
    canStartSiege,
    startDisabledReason,
    canRequestSupport: !!userActiveAttacker && !!userActiveAttacker.isInitiator && !!userAllianceId,
    canSupportSameBattlefield,
    supportDisabledReason,
    supportGate,
    canRetreat,
    retreatDisabledReason,
    ownRoster: {
      totalCount: ownTotalCount,
      units: ownUnits
    },
    compare: {
      gateKey: compareGate,
      gateLabel: CITY_GATE_LABELS[compareGate] || '',
      attacker: {
        totalCount: attackerCompareTotal,
        units: attackerCompareUnits,
        supporters: supporterRows
      },
      defender: {
        source: defenderSource,
        totalCount: defenderTotalCount,
        gates: defenderGateView
      }
    }
  };
  return applySiegePayloadViewerRole({
    payload,
    node,
    userId
  });
};

const toPlainObject = (value) => (
  value && typeof value.toObject === 'function'
    ? value.toObject()
    : value
);

const isPopulatedAllianceDoc = (value) => {
  if (!value || typeof value !== 'object') return false;
  // 仅有ObjectId时不算已填充文档
  if (value._bsontype === 'ObjectId') return false;
  return (
    typeof value.name === 'string' ||
    typeof value.flag === 'string' ||
    Array.isArray(value.visualStyles) ||
    value.activeVisualStyleId !== undefined
  );
};

const normalizeVisualStyleForNode = (style = {}, fallbackFlag = '#7c3aed') => ({
  name: typeof style?.name === 'string' ? style.name : '默认风格',
  primaryColor: normalizeHexColor(style?.primaryColor, normalizeHexColor(fallbackFlag, '#7c3aed')),
  secondaryColor: normalizeHexColor(style?.secondaryColor, '#334155'),
  glowColor: normalizeHexColor(style?.glowColor, '#c084fc'),
  rimColor: normalizeHexColor(style?.rimColor, '#f5d0fe'),
  textColor: normalizeHexColor(style?.textColor, '#ffffff'),
  patternType: normalizePatternType(style?.patternType, 'diagonal')
});

const resolveAllianceActiveStyle = (alliance) => {
  if (!alliance) return null;
  const styleList = Array.isArray(alliance.visualStyles) ? alliance.visualStyles : [];
  if (styleList.length === 0) {
    return normalizeVisualStyleForNode({
      name: '默认风格',
      primaryColor: alliance.flag || '#7c3aed',
      secondaryColor: '#334155',
      glowColor: '#c084fc',
      rimColor: '#f5d0fe',
      textColor: '#ffffff',
      patternType: 'diagonal'
    }, alliance.flag);
  }
  const activeId = getIdString(alliance.activeVisualStyleId);
  const active = styleList.find((styleItem) => getIdString(styleItem?._id) === activeId) || styleList[0];
  return normalizeVisualStyleForNode(active, alliance.flag);
};

const attachVisualStyleToNodeList = async (nodes = []) => {
  const plainNodes = (nodes || []).map(toPlainObject).filter(Boolean);
  if (plainNodes.length === 0) return [];

  const nodeKeyByIndex = new Map();
  const nodeAllianceIdByKey = new Map();
  const allianceById = new Map();
  const unresolvedNodeAllianceIds = new Set();

  const domainMasterIds = new Set();
  const allianceByMasterId = new Map();

  plainNodes.forEach((nodeItem, index) => {
    const nodeKey = getIdString(nodeItem?._id) || `idx_${index}`;
    nodeKeyByIndex.set(index, nodeKey);

    const nodeAllianceValue = nodeItem?.allianceId;
    const nodeAllianceId = getIdString(
      nodeAllianceValue && typeof nodeAllianceValue === 'object'
        ? nodeAllianceValue._id
        : nodeAllianceValue
    );
    if (isValidObjectId(nodeAllianceId)) {
      nodeAllianceIdByKey.set(nodeKey, nodeAllianceId);
      if (isPopulatedAllianceDoc(nodeAllianceValue)) {
        allianceById.set(nodeAllianceId, toPlainObject(nodeAllianceValue));
      } else {
        unresolvedNodeAllianceIds.add(nodeAllianceId);
      }
    }

    const domainMasterValue = nodeItem.domainMaster;
    const domainMasterId = getIdString(
      domainMasterValue && typeof domainMasterValue === 'object'
        ? domainMasterValue._id
        : domainMasterValue
    );
    if (!isValidObjectId(domainMasterId)) return;
    domainMasterIds.add(domainMasterId);

    if (domainMasterValue && typeof domainMasterValue === 'object') {
      const allianceRef = domainMasterValue.alliance || domainMasterValue.allianceId;
      if (isPopulatedAllianceDoc(allianceRef)) {
        allianceByMasterId.set(domainMasterId, toPlainObject(allianceRef));
      }
    }
  });

  const unresolvedNodeAllianceIdList = Array.from(unresolvedNodeAllianceIds).filter((id) => !allianceById.has(id));
  if (unresolvedNodeAllianceIdList.length > 0) {
    const directAlliances = await EntropyAlliance.find({ _id: { $in: unresolvedNodeAllianceIdList } })
      .select('name flag visualStyles activeVisualStyleId')
      .lean();
    directAlliances.forEach((allianceItem) => {
      const allianceId = getIdString(allianceItem?._id);
      if (allianceId) {
        allianceById.set(allianceId, allianceItem);
      }
    });
  }

  const unresolvedMasterIds = Array.from(domainMasterIds).filter((id) => !allianceByMasterId.has(id));
  if (unresolvedMasterIds.length > 0) {
    const masters = await User.find({ _id: { $in: unresolvedMasterIds } })
      .select('_id allianceId')
      .lean();
    const unresolvedAllianceIds = Array.from(new Set(
      masters.map((userItem) => getIdString(userItem.allianceId)).filter((id) => isValidObjectId(id))
    ));
    let allianceMap = new Map();
    if (unresolvedAllianceIds.length > 0) {
      const alliances = await EntropyAlliance.find({ _id: { $in: unresolvedAllianceIds } })
        .select('name flag visualStyles activeVisualStyleId')
        .lean();
      allianceMap = new Map(alliances.map((allianceItem) => [getIdString(allianceItem._id), allianceItem]));
    }
    masters.forEach((masterItem) => {
      const masterId = getIdString(masterItem._id);
      const allianceId = getIdString(masterItem.allianceId);
      if (masterId && allianceMap.has(allianceId)) {
        const resolvedAlliance = allianceMap.get(allianceId);
        allianceByMasterId.set(masterId, resolvedAlliance);
        if (allianceId) {
          allianceById.set(allianceId, resolvedAlliance);
        }
      }
    });
  }

  return plainNodes.map((nodeItem, index) => {
    const nodeKey = nodeKeyByIndex.get(index);
    const nodeAllianceId = nodeAllianceIdByKey.get(nodeKey) || '';
    let alliance = nodeAllianceId ? (allianceById.get(nodeAllianceId) || null) : null;

    const domainMasterId = getIdString(
      nodeItem.domainMaster && typeof nodeItem.domainMaster === 'object'
        ? nodeItem.domainMaster._id
        : nodeItem.domainMaster
    );
    if (!alliance) {
      alliance = allianceByMasterId.get(domainMasterId) || null;
    }
    if (!alliance) {
      return {
        ...nodeItem,
        visualStyle: null
      };
    }
    const style = resolveAllianceActiveStyle(alliance);
    return {
      ...nodeItem,
      visualStyle: {
        ...style,
        allianceId: getIdString(alliance._id) || nodeAllianceId,
        allianceName: alliance.name || '',
        styleId: getIdString(alliance.activeVisualStyleId) || ''
      }
    };
  });
};

const clampPercent = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
};

const round2 = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
};

const normalizePercentUserRules = (items = []) => {
  const result = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    const userId = getIdString(item?.userId);
    if (!isValidObjectId(userId) || seen.has(userId)) continue;
    seen.add(userId);
    result.push({
      userId,
      percent: clampPercent(item?.percent, 0)
    });
  }
  return result;
};

const normalizePercentAllianceRules = (items = []) => {
  const result = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    const allianceId = getIdString(item?.allianceId);
    if (!isValidObjectId(allianceId) || seen.has(allianceId)) continue;
    seen.add(allianceId);
    result.push({
      allianceId,
      percent: clampPercent(item?.percent, 0)
    });
  }
  return result;
};

const normalizeObjectIdArray = (items = []) => {
  const result = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    const id = getIdString(item);
    if (!isValidObjectId(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const normalizeScheduleSlots = (items = []) => {
  const result = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    const weekday = parseInt(item?.weekday, 10);
    const hour = parseInt(item?.hour, 10);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const key = `${weekday}-${hour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ weekday, hour });
  }
  return result;
};

const sanitizeDistributionRuleInput = (rawRule = {}) => ({
  enabled: !!rawRule?.enabled,
  distributionScope: rawRule?.distributionScope === 'partial' ? 'partial' : 'all',
  distributionPercent: clampPercent(rawRule?.distributionPercent, 100),
  masterPercent: clampPercent(rawRule?.masterPercent, 10),
  adminPercents: normalizePercentUserRules(rawRule?.adminPercents),
  customUserPercents: normalizePercentUserRules(rawRule?.customUserPercents),
  nonHostileAlliancePercent: clampPercent(rawRule?.nonHostileAlliancePercent, 0),
  specificAlliancePercents: normalizePercentAllianceRules(rawRule?.specificAlliancePercents),
  noAlliancePercent: clampPercent(rawRule?.noAlliancePercent, 0),
  blacklistUserIds: normalizeObjectIdArray(
    rawRule?.blacklistUserIds ||
    (Array.isArray(rawRule?.blacklistUsers) ? rawRule.blacklistUsers.map((item) => item?.userId || item?._id || item) : [])
  ),
  blacklistAllianceIds: normalizeObjectIdArray(
    rawRule?.blacklistAllianceIds ||
    (Array.isArray(rawRule?.blacklistAlliances) ? rawRule.blacklistAlliances.map((item) => item?.allianceId || item?._id || item) : [])
  )
});

const sanitizeDistributionScheduleInput = (rawSchedule = []) => normalizeScheduleSlots(rawSchedule);

const sanitizeDistributionRuleProfileInput = (rawProfile = {}, index = 0) => {
  const source = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
  const profileId = typeof source.profileId === 'string' && source.profileId.trim()
    ? source.profileId.trim()
    : `rule_${Date.now()}_${index + 1}`;
  const name = typeof source.name === 'string' && source.name.trim()
    ? source.name.trim()
    : `规则${index + 1}`;
  const ruleSource = source.rule && typeof source.rule === 'object' ? source.rule : source;
  return {
    profileId,
    name,
    rule: sanitizeDistributionRuleInput(ruleSource)
  };
};

const collectRuleUserIds = (rule = {}) => Array.from(new Set([
  ...(Array.isArray(rule?.adminPercents) ? rule.adminPercents.map((item) => getIdString(item?.userId)) : []),
  ...(Array.isArray(rule?.customUserPercents) ? rule.customUserPercents.map((item) => getIdString(item?.userId)) : []),
  ...(Array.isArray(rule?.blacklistUserIds) ? rule.blacklistUserIds.map((item) => getIdString(item)) : [])
].filter((id) => isValidObjectId(id))));

const loadCommonUserIdSet = async (userIds = []) => {
  const targetIds = Array.from(new Set((Array.isArray(userIds) ? userIds : [])
    .map((id) => getIdString(id))
    .filter((id) => isValidObjectId(id))));
  if (targetIds.length === 0) return new Set();
  const commonUsers = await User.find({
    _id: { $in: targetIds },
    role: 'common'
  }).select('_id').lean();
  return new Set(commonUsers.map((item) => getIdString(item._id)).filter((id) => isValidObjectId(id)));
};

const filterRuleUsersByAllowedSet = (rule = {}, allowedUserIdSet = new Set()) => ({
  ...rule,
  adminPercents: (Array.isArray(rule?.adminPercents) ? rule.adminPercents : [])
    .filter((item) => allowedUserIdSet.has(getIdString(item?.userId))),
  customUserPercents: (Array.isArray(rule?.customUserPercents) ? rule.customUserPercents : [])
    .filter((item) => allowedUserIdSet.has(getIdString(item?.userId))),
  blacklistUserIds: (Array.isArray(rule?.blacklistUserIds) ? rule.blacklistUserIds : [])
    .map((item) => getIdString(item))
    .filter((id) => allowedUserIdSet.has(id))
});

const computeDistributionPercentSummary = (rule = {}, allianceContributionPercent = 0) => {
  const x = clampPercent(rule?.masterPercent, 10);
  const y = (Array.isArray(rule?.adminPercents) ? rule.adminPercents : [])
    .reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const z = clampPercent(allianceContributionPercent, 0);
  const b = (Array.isArray(rule?.customUserPercents) ? rule.customUserPercents : [])
    .reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const d = clampPercent(rule?.nonHostileAlliancePercent, 0);
  const e = (Array.isArray(rule?.specificAlliancePercents) ? rule.specificAlliancePercents : [])
    .reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const f = clampPercent(rule?.noAlliancePercent, 0);
  const total = x + y + z + b + d + e + f;
  return {
    x: round2(x),
    y: round2(y),
    z: round2(z),
    b: round2(b),
    d: round2(d),
    e: round2(e),
    f: round2(f),
    total: round2(total)
  };
};

const serializeDistributionRule = (rule = {}) => ({
  enabled: !!rule?.enabled,
  distributionScope: rule?.distributionScope === 'partial' ? 'partial' : 'all',
  distributionPercent: round2(clampPercent(rule?.distributionPercent, 100)),
  masterPercent: round2(clampPercent(rule?.masterPercent, 10)),
  adminPercents: (Array.isArray(rule?.adminPercents) ? rule.adminPercents : []).map((item) => ({
    userId: getIdString(item?.userId),
    percent: round2(clampPercent(item?.percent, 0))
  })),
  customUserPercents: (Array.isArray(rule?.customUserPercents) ? rule.customUserPercents : []).map((item) => ({
    userId: getIdString(item?.userId),
    percent: round2(clampPercent(item?.percent, 0))
  })),
  nonHostileAlliancePercent: round2(clampPercent(rule?.nonHostileAlliancePercent, 0)),
  specificAlliancePercents: (Array.isArray(rule?.specificAlliancePercents) ? rule.specificAlliancePercents : []).map((item) => ({
    allianceId: getIdString(item?.allianceId),
    percent: round2(clampPercent(item?.percent, 0))
  })),
  noAlliancePercent: round2(clampPercent(rule?.noAlliancePercent, 0)),
  blacklistUserIds: (Array.isArray(rule?.blacklistUserIds) ? rule.blacklistUserIds : []).map((item) => getIdString(item)).filter(Boolean),
  blacklistAllianceIds: (Array.isArray(rule?.blacklistAllianceIds) ? rule.blacklistAllianceIds : []).map((item) => getIdString(item)).filter(Boolean)
});

const serializeDistributionSchedule = (schedule = []) => (
  Array.isArray(schedule) ? schedule.map((item) => ({
    weekday: parseInt(item?.weekday, 10),
    hour: parseInt(item?.hour, 10)
  })).filter((item) => Number.isInteger(item.weekday) && Number.isInteger(item.hour)) : []
);

const serializeDistributionRuleProfile = (profile = {}) => ({
  profileId: typeof profile?.profileId === 'string' ? profile.profileId : '',
  name: typeof profile?.name === 'string' ? profile.name : '',
  rule: serializeDistributionRule(profile?.rule || {})
});

const serializeDistributionLock = (locked = null, options = {}) => {
  if (!locked) return null;
  const participantPreviewLimit = Math.max(
    0,
    Math.min(500, parseInt(options?.participantPreviewLimit, 10) || DISTRIBUTION_LOCK_PARTICIPANT_PREVIEW_LIMIT)
  );
  const executeAtMs = new Date(locked.executeAt || 0).getTime();
  const entryCloseAtMsRaw = new Date(locked.entryCloseAt || 0).getTime();
  const endAtMsRaw = new Date(locked.endAt || 0).getTime();
  const entryCloseAt = Number.isFinite(entryCloseAtMsRaw) && entryCloseAtMsRaw > 0
    ? new Date(entryCloseAtMsRaw)
    : (Number.isFinite(executeAtMs) && executeAtMs > 0 ? new Date(executeAtMs - 60 * 1000) : null);
  const endAt = Number.isFinite(endAtMsRaw) && endAtMsRaw > 0
    ? new Date(endAtMsRaw)
    : (Number.isFinite(executeAtMs) && executeAtMs > 0 ? new Date(executeAtMs + 60 * 1000) : null);
  const participants = [];
  let participantTotal = 0;
  let activeParticipantCount = 0;
  for (const item of (Array.isArray(locked.participants) ? locked.participants : [])) {
    const userId = getIdString(item?.userId);
    if (!isValidObjectId(userId)) continue;
    participantTotal += 1;
    const exitedAt = item?.exitedAt || null;
    if (!exitedAt) activeParticipantCount += 1;
    if (participants.length < participantPreviewLimit) {
      participants.push({
        userId,
        joinedAt: item?.joinedAt || null,
        exitedAt
      });
    }
  }
  const resultUserRewards = (Array.isArray(locked.resultUserRewards) ? locked.resultUserRewards : []).map((item) => ({
    userId: getIdString(item?.userId),
    amount: round2(Math.max(0, Number(item?.amount) || 0))
  })).filter((item) => isValidObjectId(item.userId));
  return {
    executeAt: locked.executeAt || null,
    entryCloseAt: entryCloseAt || null,
    endAt: endAt || null,
    executedAt: locked.executedAt || null,
    announcedAt: locked.announcedAt || null,
    projectedTotal: round2(Number(locked.projectedTotal) || 0),
    projectedDistributableTotal: round2(Number(locked.projectedDistributableTotal) || 0),
    masterAllianceId: getIdString(locked.masterAllianceId) || '',
    masterAllianceName: locked.masterAllianceName || '',
    allianceContributionPercent: round2(clampPercent(locked.allianceContributionPercent, 0)),
    distributionScope: locked?.distributionScope === 'partial' ? 'partial' : 'all',
    distributionPercent: round2(clampPercent(locked?.distributionPercent, 100)),
    ruleProfileId: typeof locked.ruleProfileId === 'string' ? locked.ruleProfileId : '',
    ruleProfileName: typeof locked.ruleProfileName === 'string' ? locked.ruleProfileName : '',
    activeParticipantCount,
    participantTotal,
    participantsTruncated: participantTotal > participants.length,
    participants,
    resultUserRewards,
    enemyAllianceIds: (Array.isArray(locked.enemyAllianceIds) ? locked.enemyAllianceIds : []).map((item) => getIdString(item)).filter(Boolean),
    ruleSnapshot: serializeDistributionRule(locked.ruleSnapshot || {})
  };
};

const parseDistributionExecuteAtHour = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (parsed.getMinutes() !== 0 || parsed.getSeconds() !== 0 || parsed.getMilliseconds() !== 0) {
    return null;
  }
  return parsed;
};

const extractDistributionProfilesFromNode = (node) => {
  const inputProfiles = Array.isArray(node?.knowledgeDistributionRuleProfiles)
    ? node.knowledgeDistributionRuleProfiles
    : [];
  const profiles = inputProfiles
    .map((profile, index) => sanitizeDistributionRuleProfileInput(profile, index))
    .filter((profile, index, arr) => profile.profileId && arr.findIndex((item) => item.profileId === profile.profileId) === index);

  if (profiles.length === 0) {
    profiles.push({
      profileId: 'default',
      name: '默认规则',
      rule: sanitizeDistributionRuleInput(node?.knowledgeDistributionRule || {})
    });
  }

  const rawActiveRuleId = typeof node?.knowledgeDistributionActiveRuleId === 'string'
    ? node.knowledgeDistributionActiveRuleId.trim()
    : '';
  const activeRuleId = profiles.some((profile) => profile.profileId === rawActiveRuleId)
    ? rawActiveRuleId
    : profiles[0].profileId;
  const scheduleSlots = serializeDistributionSchedule(
    Array.isArray(node?.knowledgeDistributionScheduleSlots) && node.knowledgeDistributionScheduleSlots.length > 0
      ? node.knowledgeDistributionScheduleSlots
      : node?.knowledgeDistributionRule?.scheduleSlots
  );

  return {
    profiles,
    activeRuleId,
    scheduleSlots
  };
};

const resolveDistributionLockTimeline = (lock = {}) => {
  const timeline = KnowledgeDistributionService.getLockTimeline(lock || {});
  return {
    executeAtMs: Number(timeline.executeAtMs) || 0,
    entryCloseAtMs: Number(timeline.entryCloseAtMs) || 0,
    endAtMs: Number(timeline.endAtMs) || 0
  };
};

const getDistributionLockPhase = (lock = {}, now = new Date()) => {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const { executeAtMs, entryCloseAtMs, endAtMs } = resolveDistributionLockTimeline(lock);
  if (!Number.isFinite(executeAtMs) || executeAtMs <= 0) return 'none';
  if (Number.isFinite(endAtMs) && endAtMs > 0 && nowMs >= endAtMs) return 'ended';
  if (nowMs < entryCloseAtMs) return 'entry_open';
  if (nowMs < executeAtMs) return 'entry_closed';
  return 'settling';
};

const getTravelStatus = (travelState) => {
  if (!travelState) return 'idle';
  if (typeof travelState.status === 'string' && travelState.status) return travelState.status;
  return travelState.isTraveling ? 'moving' : 'idle';
};

const isUserIdleAtNode = (user, nodeName) => (
  !!user &&
  (user.location || '') === nodeName &&
  getTravelStatus(user.travelState) === 'idle'
);

// 搜索节点
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { keyword } = req.query;
    const normalizedKeyword = typeof keyword === 'string' ? keyword.trim() : '';
    if (!normalizedKeyword) {
      return res.status(400).json({ error: '搜索关键词不能为空' });
    }

    const keywords = normalizedKeyword.split(/\s+/).filter(Boolean);
    const nodes = await loadNodeSearchCandidates({
      normalizedKeyword,
      limit: 1200
    });

    const results = nodes
      .flatMap((node) => buildNodeSenseSearchEntries(node, keywords))
      .sort((a, b) => b.matchCount - a.matchCount || a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'))
      .slice(0, 200)
      .map(({ matchCount, ...item }) => item);

    res.json(results);
  } catch (error) {
    console.error('搜索节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 创建知识域（普通用户需要申请，管理员直接创建）
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const {
      name,
      description,
      position,
      associations,
      synonymSenses,
      forceCreate
    } = req.body;

    // 验证必填字段
    if (!name || !description) {
      return res.status(400).json({ error: '标题和简介不能为空' });
    }

    // 检查标题唯一性（只检查已审核通过的节点）
    const existingApprovedNode = await Node.findOne({ name, status: 'approved' });
    if (existingApprovedNode) {
      return res.status(400).json({ error: '该知识域标题已被使用（已有同名的审核通过知识域）' });
    }

    // 检查用户是否为管理员
    const user = await User.findById(req.user.userId);
    const isUserAdmin = user.role === 'admin';

    // 如果是管理员，检查是否有同名的待审核节点
    if (isUserAdmin && !forceCreate) {
      const pendingNodesWithSameName = await Node.find({ name, status: 'pending' })
        .populate('owner', 'username profession')
        .populate('associations.targetNode', 'name');

      if (pendingNodesWithSameName.length > 0) {
        // 返回待审核节点信息，让管理员选择
        return res.status(409).json({
          error: 'PENDING_NODES_EXIST',
          message: '已有用户提交了同名知识域的申请，请先处理这些申请',
          pendingNodes: pendingNodesWithSameName
        });
      }
    }

    const rawSenseList = (Array.isArray(synonymSenses) ? synonymSenses : [])
      .map((item) => ({
        title: typeof item?.title === 'string' ? item.title.trim() : '',
        content: typeof item?.content === 'string' ? item.content.trim() : ''
      }))
      .filter((item) => item.title && item.content);

    if (rawSenseList.length === 0) {
      return res.status(400).json({ error: '创建知识域时至少需要一个同义词释义（题目 + 内容）' });
    }

    const seenSenseTitleKeys = new Set();
    for (const sense of rawSenseList) {
      const key = sense.title.toLowerCase();
      if (seenSenseTitleKeys.has(key)) {
        return res.status(400).json({ error: '同一知识域下多个释义题目不能重名' });
      }
      seenSenseTitleKeys.add(key);
    }

    const uniqueSenses = rawSenseList.map((item, index) => ({
      senseId: `sense_${index + 1}`,
      title: item.title,
      content: item.content
    }));

    const approvedNodeCount = await Node.countDocuments({ status: 'approved' });
    const isColdStartBootstrap = approvedNodeCount === 0;

    const rawAssociations = Array.isArray(associations) ? associations : [];
    const localSenseIdSet = new Set(uniqueSenses.map((item) => item.senseId));
    const normalizedAssociations = normalizeAssociationDraftList(rawAssociations, localSenseIdSet);

    if (!isUserAdmin && !isColdStartBootstrap && rawAssociations.length === 0) {
      return res.status(400).json({ error: '每个释义至少需要一个关联关系' });
    }
    if (!isUserAdmin && !isColdStartBootstrap && normalizedAssociations.length === 0) {
      return res.status(400).json({ error: '创建知识域必须至少有一个有效关联关系' });
    }

    let targetNodeMap = new Map();
    let effectiveAssociations = [];
    let insertPlans = [];

    const shouldValidateAssociationGraph = !isColdStartBootstrap && normalizedAssociations.length > 0;
    if (shouldValidateAssociationGraph) {
      // 验证关联关系目标节点和目标释义
      const targetNodeIds = Array.from(new Set(normalizedAssociations.map((item) => item.targetNode)));
      const targetNodes = targetNodeIds.length > 0
        ? await Node.find({ _id: { $in: targetNodeIds }, status: 'approved' })
            .select('_id name synonymSenses description')
            .lean()
        : [];
      await hydrateNodeSensesForNodes(targetNodes);
      targetNodeMap = new Map(targetNodes.map((item) => [getIdString(item._id), item]));
      if (targetNodes.length !== targetNodeIds.length) {
        return res.status(400).json({ error: '存在无效的关联目标知识域' });
      }

      for (const assoc of normalizedAssociations) {
        const targetNode = targetNodeMap.get(assoc.targetNode);
        if (!targetNode) {
          return res.status(400).json({ error: '存在无效的关联目标知识域' });
        }
        if (assoc.targetSenseId) {
          const senseList = normalizeNodeSenseList(targetNode);
          const matched = senseList.some((sense) => sense.senseId === assoc.targetSenseId);
          if (!matched) {
            return res.status(400).json({ error: `目标知识域「${targetNode.name}」不存在指定释义` });
          }
        }
      }

      const relationRuleValidation = validateAssociationRuleSet({
        currentNodeId: '',
        associations: normalizedAssociations
      });
      if (relationRuleValidation.error) {
        return res.status(400).json({ error: relationRuleValidation.error });
      }

      if (!isUserAdmin) {
        // 普通用户必须保证每个释义至少有一个关联关系
        const coveredSourceSenseSet = new Set(normalizedAssociations.map((item) => item.sourceSenseId).filter(Boolean));
        const missingRelationSenses = uniqueSenses.filter((item) => !coveredSourceSenseSet.has(item.senseId));
        if (missingRelationSenses.length > 0) {
          return res.status(400).json({
            error: `每个释义至少需要一个关联关系，未满足：${missingRelationSenses.map((item) => item.title).join('、')}`
          });
        }
      }

      const associationResolved = resolveAssociationsWithInsertPlans(normalizedAssociations);
      if (associationResolved.error) {
        return res.status(400).json({ error: associationResolved.error });
      }
      effectiveAssociations = associationResolved.effectiveAssociations;
      insertPlans = associationResolved.insertPlans;

      const effectiveRelationRuleValidation = validateAssociationRuleSet({
        currentNodeId: '',
        associations: effectiveAssociations
      });
      if (effectiveRelationRuleValidation.error) {
        return res.status(400).json({ error: effectiveRelationRuleValidation.error });
      }
    }

    const associationsForStorage = isColdStartBootstrap ? [] : (isUserAdmin ? effectiveAssociations : normalizedAssociations);
    const relationAssociationsForSummary = associationsForStorage.filter((association) => (
      association.relationType === 'contains' || association.relationType === 'extends'
    ));

    // 填充关联母域和关联子域
    let relatedParentDomains = [];
    let relatedChildDomains = [];

    relationAssociationsForSummary.forEach((association) => {
      const targetNode = targetNodeMap.get(association.targetNode);
      const targetNodeName = targetNode?.name || '';
      if (!targetNodeName) return;
      if (association.relationType === 'extends') {
        relatedParentDomains.push(targetNodeName);
      } else if (association.relationType === 'contains') {
        relatedChildDomains.push(targetNodeName);
      }
    });
    relatedParentDomains = Array.from(new Set(relatedParentDomains));
    relatedChildDomains = Array.from(new Set(relatedChildDomains));

    const nodeId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const node = new Node({
      nodeId,
      owner: req.user.userId,
      domainMaster: isUserAdmin ? null : req.user.userId, // 管理员创建默认无域主，普通用户创建默认自己为域主
      allianceId: isUserAdmin ? null : (user.allianceId || null),
      name,
      description,
      synonymSenses: uniqueSenses,
      position,
      associations: associationsForStorage,
      relatedParentDomains,
      relatedChildDomains,
      status: isUserAdmin ? 'approved' : 'pending',
      contentScore: 1 // 新建知识域默认内容分数为1
    });

    await node.save();
    await upsertNodeSensesReplace({
      nodeId: node._id,
      senses: uniqueSenses,
      actorUserId: req.user.userId
    });
    await upsertNodeDefenseLayout({
      nodeId: node._id,
      layout: resolveNodeDefenseLayout(node, {}),
      actorUserId: req.user.userId
    });
    await upsertNodeSiegeState({
      nodeId: node._id,
      siegeState: resolveNodeSiegeState(node, {}),
      actorUserId: req.user.userId
    });
    await syncDomainTitleProjectionFromNode(node);

    // 双向同步：更新被关联节点的relatedParentDomains和relatedChildDomains
    if (node.status === 'approved') {
      if (insertPlans.length > 0) {
        await applyInsertAssociationRewire({
          insertPlans,
          newNodeId: node._id,
          newNodeName: node.name
        });
      }
      await syncReciprocalAssociationsForNode({
        nodeDoc: node,
        oldAssociations: [],
        nextAssociations: effectiveAssociations
      });
    }

    // 如果是管理员直接创建，更新用户拥有的节点列表
    if (isUserAdmin) {
      await User.findByIdAndUpdate(req.user.userId, {
        $push: { ownedNodes: node._id }
      });
    }

    res.status(201).json(node);
  } catch (error) {
    console.error('创建知识域错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取待审批节点列表
router.get('/pending', authenticateToken, isAdmin, async (req, res) => {
  try {
    const nodes = await Node.find({ status: 'pending' })
      .populate('owner', 'username profession')
      .populate('associations.targetNode', 'name description synonymSenses');
    await hydrateNodeSensesForNodes(nodes);
    const targetNodes = [];
    nodes.forEach((node) => {
      const assocList = Array.isArray(node?.associations) ? node.associations : [];
      assocList.forEach((association) => {
        const targetNode = association?.targetNode;
        if (targetNode && typeof targetNode === 'object' && targetNode._id) {
          targetNodes.push(targetNode);
        }
      });
    });
    if (targetNodes.length > 0) {
      await hydrateNodeSensesForNodes(targetNodes);
    }
    res.json(nodes);
  } catch (error) {
    console.error('获取待审批节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 审批知识域申请
router.post('/approve', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const node = await Node.findById(nodeId).populate('associations.targetNode', 'name');
    const processorUser = await User.findById(req.user.userId).select('_id username');

    if (!node) {
      return res.status(404).json({ error: '知识域不存在' });
    }

    // 检查是否已有同名的已审核节点
    const existingApproved = await Node.findOne({ name: node.name, status: 'approved' });
    if (existingApproved) {
      return res.status(400).json({ error: '已存在同名的审核通过知识域，无法批准此申请' });
    }

    const approvedNodeCount = await Node.countDocuments({
      status: 'approved',
      _id: { $ne: node._id }
    });
    const isColdStartBootstrap = approvedNodeCount === 0;

    await hydrateNodeSensesForNodes([node]);
    const localSenseIdSet = new Set(normalizeNodeSenseList(node).map((item) => item.senseId));
    const normalizedAssociations = normalizeAssociationDraftList(node.associations, localSenseIdSet);
    if (!isColdStartBootstrap && normalizedAssociations.length === 0) {
      return res.status(400).json({ error: '该节点缺少有效关联关系，无法审批通过' });
    }

    let targetNodeMap = new Map();
    let effectiveAssociations = [];
    let insertPlans = [];

    if (!isColdStartBootstrap) {
      const targetNodeIds = Array.from(new Set(normalizedAssociations.map((item) => item.targetNode)));
      const targetNodes = targetNodeIds.length > 0
        ? await Node.find({ _id: { $in: targetNodeIds }, status: 'approved' })
            .select('_id name synonymSenses description')
            .lean()
        : [];
      await hydrateNodeSensesForNodes(targetNodes);
      targetNodeMap = new Map(targetNodes.map((item) => [getIdString(item._id), item]));
      if (targetNodes.length !== targetNodeIds.length) {
        return res.status(400).json({ error: '存在无效的关联目标知识域，无法审批通过' });
      }
      for (const assoc of normalizedAssociations) {
        const targetNode = targetNodeMap.get(assoc.targetNode);
        if (!targetNode) {
          return res.status(400).json({ error: '存在无效的关联目标知识域，无法审批通过' });
        }
        const matched = normalizeNodeSenseList(targetNode).some((sense) => sense.senseId === assoc.targetSenseId);
        if (!matched) {
          return res.status(400).json({ error: `目标知识域「${targetNode.name}」不存在指定释义` });
        }
      }

      const relationRuleValidation = validateAssociationRuleSet({
        currentNodeId: node._id,
        associations: normalizedAssociations
      });
      if (relationRuleValidation.error) {
        return res.status(400).json({ error: relationRuleValidation.error });
      }

      const coveredSourceSenseSet = new Set(normalizedAssociations.map((item) => item.sourceSenseId).filter(Boolean));
      const missingRelationSenses = normalizeNodeSenseList(node).filter((item) => !coveredSourceSenseSet.has(item.senseId));
      if (missingRelationSenses.length > 0) {
        return res.status(400).json({
          error: `每个释义至少需要一个关联关系，未满足：${missingRelationSenses.map((item) => item.title).join('、')}`
        });
      }

      const associationResolved = resolveAssociationsWithInsertPlans(normalizedAssociations);
      if (associationResolved.error) {
        return res.status(400).json({ error: associationResolved.error });
      }
      effectiveAssociations = associationResolved.effectiveAssociations;
      insertPlans = associationResolved.insertPlans;

      const effectiveRelationRuleValidation = validateAssociationRuleSet({
        currentNodeId: node._id,
        associations: effectiveAssociations
      });
      if (effectiveRelationRuleValidation.error) {
        return res.status(400).json({ error: effectiveRelationRuleValidation.error });
      }
    }

    let relatedParentDomains = [];
    let relatedChildDomains = [];
    effectiveAssociations.forEach((association) => {
      const targetNode = targetNodeMap.get(association.targetNode);
      const targetNodeName = targetNode?.name || '';
      if (!targetNodeName) return;
      if (association.relationType === 'extends') {
        relatedParentDomains.push(targetNodeName);
      } else if (association.relationType === 'contains') {
        relatedChildDomains.push(targetNodeName);
      }
    });
    relatedParentDomains = Array.from(new Set(relatedParentDomains));
    relatedChildDomains = Array.from(new Set(relatedChildDomains));

    node.status = 'approved';
    node.associations = effectiveAssociations;
    node.relatedParentDomains = relatedParentDomains;
    node.relatedChildDomains = relatedChildDomains;
    const owner = await User.findById(node.owner).select('role allianceId');
    if (owner?.role === 'admin') {
      node.domainMaster = null;
      node.allianceId = null;
    } else if (owner) {
      // 普通用户的创建申请通过后，域主固定为该申请用户本人
      node.domainMaster = owner._id;
      node.allianceId = owner.allianceId || null;
    } else {
      node.domainMaster = null;
      node.allianceId = null;
    }
    // 设置默认内容分数为1
    node.contentScore = 1;
    await node.save();
    await upsertNodeSensesReplace({
      nodeId: node._id,
      senses: normalizeNodeSenseList(node),
      actorUserId: req.user.userId
    });
    await upsertNodeDefenseLayout({
      nodeId: node._id,
      layout: resolveNodeDefenseLayout(node, {}),
      actorUserId: req.user.userId
    });
    await upsertNodeSiegeState({
      nodeId: node._id,
      siegeState: resolveNodeSiegeState(node, {}),
      actorUserId: req.user.userId
    });
    await syncDomainTitleProjectionFromNode(node);

    // 自动拒绝其他同名的待审核节点
    const rejectedNodes = await Node.find({
      name: node.name,
      status: 'pending',
      _id: { $ne: node._id }
    }).populate('owner', 'username');

    const rejectedInfo = [];
    const reviewResultNotificationDocs = [];
    for (const rejectedNode of rejectedNodes) {
      rejectedInfo.push({
        id: rejectedNode._id,
        owner: rejectedNode.owner?.username || '未知用户'
      });
      const rejectedOwnerId = getIdString(rejectedNode.owner?._id || rejectedNode.owner);
      if (isValidObjectId(rejectedOwnerId)) {
        const rejectedOwner = await User.findById(rejectedOwnerId).select('_id username notifications');
        if (rejectedOwner) {
          const rejectedNotification = pushDomainCreateApplyResultNotification({
            applicant: rejectedOwner,
            nodeName: rejectedNode.name,
            decision: 'rejected',
            processorUser,
            rejectedReason: `你创建新知识域「${rejectedNode.name}」的申请未通过：同名申请已有其他申请通过`
          });
          await rejectedOwner.save();
          if (rejectedNotification) {
            reviewResultNotificationDocs.push(toCollectionNotificationDoc(rejectedOwner._id, rejectedNotification));
          }
        }
      }
      // 删除被拒绝的节点
      await Node.findByIdAndDelete(rejectedNode._id);
      await NodeSense.deleteMany({ nodeId: rejectedNode._id });
      await deleteNodeTitleStatesByNodeIds([rejectedNode._id]);
      await deleteDomainTitleProjectionByNodeIds([rejectedNode._id]);
    }

    // 双向同步：更新被关联节点的relatedParentDomains和relatedChildDomains
    if (insertPlans.length > 0) {
      await applyInsertAssociationRewire({
        insertPlans,
        newNodeId: node._id,
        newNodeName: node.name
      });
    }

    await syncReciprocalAssociationsForNode({
      nodeDoc: node,
      oldAssociations: [],
      nextAssociations: effectiveAssociations
    });

    // 更新用户拥有的节点列表
    await User.findByIdAndUpdate(node.owner, {
      $push: { ownedNodes: node._id }
    });

    const approvedOwner = await User.findById(node.owner).select('_id username notifications');
    if (approvedOwner) {
      const acceptedNotification = pushDomainCreateApplyResultNotification({
        applicant: approvedOwner,
        nodeName: node.name,
        nodeId: node._id,
        decision: 'accepted',
        processorUser
      });
      await approvedOwner.save();
      if (acceptedNotification) {
        reviewResultNotificationDocs.push(toCollectionNotificationDoc(approvedOwner._id, acceptedNotification));
      }
    }
    if (reviewResultNotificationDocs.length > 0) {
      await writeNotificationsToCollection(reviewResultNotificationDocs);
    }

    res.json({
      ...node.toObject(),
      autoRejectedCount: rejectedInfo.length,
      autoRejectedNodes: rejectedInfo
    });
  } catch (error) {
    console.error('审批节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 拒绝知识域申请（直接删除）
router.post('/reject', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const processorUser = await User.findById(req.user.userId).select('_id username');
    
    const node = await Node.findByIdAndDelete(nodeId);
    if (!node) {
      return res.status(404).json({ error: '知识域不存在' });
    }
    await NodeSense.deleteMany({ nodeId: node._id });
    await deleteNodeTitleStatesByNodeIds([node._id]);
    await deleteDomainTitleProjectionByNodeIds([node._id]);

    // 从用户拥有的节点列表中移除（如果已添加）
    await User.findByIdAndUpdate(node.owner, {
      $pull: { ownedNodes: nodeId }
    });

    const owner = await User.findById(node.owner).select('_id username notifications');
    if (owner) {
      const rejectedNotification = pushDomainCreateApplyResultNotification({
        applicant: owner,
        nodeName: node.name,
        decision: 'rejected',
        processorUser
      });
      await owner.save();
      if (rejectedNotification) {
        await writeNotificationsToCollection([
          toCollectionNotificationDoc(owner._id, rejectedNotification)
        ]);
      }
    }

    res.json({
      success: true,
      message: '知识域申请已被拒绝并删除',
      deletedNode: node.name
    });
  } catch (error) {
    console.error('拒绝节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 关联节点
router.post('/associate', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (node.owner.toString() === req.user.userId) {
      return res.status(400).json({ error: '不能关联自己创建的节点' });
    }
    node.status = 'pending';
    // 重置内容分数为1（关联节点视为新节点）
    node.contentScore = 1;
    await node.save();
    await syncDomainTitleProjectionFromNode(node);
    res.status(200).json(node);
  } catch (error) {
    console.error('关联节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 审批节点关联
router.post('/approve-association', authenticateToken, async (req, res) => {
  try {
    const { nodeId, isParent } = req.body;
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (isParent) {
      node.parentNode = req.user.userId;
    } else {
      node.childNodes.push(req.user.userId);
    }
    node.status = 'approved';
    await node.save();
    await syncDomainTitleProjectionFromNode(node);
    res.status(200).json(node);
  } catch (error) {
    console.error('审批节点关联错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 拒绝节点关联
router.post('/reject-association', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    node.status = 'rejected';
    await node.save();
    await syncDomainTitleProjectionFromNode(node);
    res.status(200).json(node);
  } catch (error) {
    console.error('拒绝节点关联错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取所有节点（管理员专用）
router.get('/', authenticateToken, isAdmin, async (req, res) => {
  try {
    const page = toSafeInteger(req.query?.page, 1, { min: 1, max: 1000000 });
    const pageSize = toSafeInteger(req.query?.pageSize, 50, { min: 1, max: 200 });
    const statusFilter = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
    const keyword = typeof req.query?.keyword === 'string' ? req.query.keyword.trim() : '';
    const query = {};
    if (statusFilter === 'approved' || statusFilter === 'pending' || statusFilter === 'rejected') {
      query.status = statusFilter;
    }
    if (keyword) {
      const keywordRegex = new RegExp(escapeRegex(keyword), 'i');
      query.$or = [
        { name: keywordRegex },
        { description: keywordRegex },
        { 'synonymSenses.title': keywordRegex },
        { 'synonymSenses.content': keywordRegex }
      ];
    }

    const [nodes, total] = await Promise.all([
      Node.find(query)
      .populate('owner', 'username profession')
      .populate('domainMaster', 'username profession')
      .populate('associations.targetNode', 'name description synonymSenses')
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
      Node.countDocuments(query)
    ]);
    await hydrateNodeSensesForNodes(nodes);
    
    res.json({
      success: true,
      count: nodes.length,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
      nodes: nodes
    });
  } catch (error) {
    console.error('获取节点列表错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 更新节点信息（管理员专用）
router.put('/:nodeId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { name, description, prosperity, contentScore, knowledgePoint } = req.body;

    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 更新字段
    if (name !== undefined) {
      // 检查名称唯一性（只检查已审核通过的节点，排除当前节点）
      const existingNode = await Node.findOne({
        name,
        status: 'approved',
        _id: { $ne: nodeId }
      });
      if (existingNode) {
        return res.status(400).json({ error: '该名称已被其他审核通过的节点使用' });
      }
      node.name = name;
    }

    if (description !== undefined) {
      node.description = description;
    }

    if (prosperity !== undefined) {
      node.prosperity = prosperity;
    }

    if (contentScore !== undefined) {
      // 验证内容分数至少为1
      if (contentScore < 1) {
        return res.status(400).json({ error: '内容分数至少为1' });
      }
      node.contentScore = contentScore;
    }

    if (knowledgePoint !== undefined) {
      const parsedKnowledgePoint = Number(knowledgePoint);
      if (!Number.isFinite(parsedKnowledgePoint) || parsedKnowledgePoint < 0) {
        return res.status(400).json({ error: '知识点必须是大于等于0的数字' });
      }
      node.knowledgePoint = node.knowledgePoint && typeof node.knowledgePoint === 'object'
        ? node.knowledgePoint
        : {};
      node.knowledgePoint.value = Number(parsedKnowledgePoint.toFixed(2));
      node.knowledgePoint.lastUpdated = new Date();
    }

    await node.save();
    await syncDomainTitleProjectionFromNode(node);

    res.json({
      success: true,
      message: '节点信息已更新',
      node: node
    });
  } catch (error) {
    console.error('更新节点信息错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员新增释义（必须至少包含1条关联）
router.post('/:nodeId/admin/senses', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { title, content, associations } = req.body || {};

    const node = await Node.findById(nodeId).select('name status synonymSenses associations relatedParentDomains relatedChildDomains');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (node.status !== 'approved') {
      return res.status(400).json({ error: '仅已审批知识域可新增释义' });
    }

    await hydrateNodeSensesForNodes([node]);
    const existingSenses = normalizeNodeSenseList(node);
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    const trimmedContent = typeof content === 'string' ? content.trim() : '';
    if (!trimmedTitle) {
      return res.status(400).json({ error: '释义题目不能为空' });
    }
    if (!trimmedContent) {
      return res.status(400).json({ error: '释义内容不能为空' });
    }

    const titleKey = trimmedTitle.toLowerCase();
    const duplicated = existingSenses.some((sense) => (
      (typeof sense?.title === 'string' ? sense.title.trim().toLowerCase() : '') === titleKey
    ));
    if (duplicated) {
      return res.status(400).json({ error: '同一知识域下多个释义题目不能重名' });
    }

    const nextSenseId = allocateNextSenseId(existingSenses);
    const rawAssociations = Array.isArray(associations) ? associations : [];
    if (rawAssociations.length === 0) {
      return res.status(400).json({ error: '每个释义至少需要1条关联关系' });
    }

    const localSenseIdSet = new Set([...existingSenses.map((item) => item.senseId), nextSenseId]);
    const injectedAssociations = rawAssociations.map((assoc) => ({
      ...assoc,
      sourceSenseId: nextSenseId
    }));
    const normalizedAssociations = normalizeAssociationDraftList(injectedAssociations, localSenseIdSet);
    if (normalizedAssociations.length === 0) {
      return res.status(400).json({ error: '新增释义必须至少包含1条有效关联关系' });
    }

    const targetNodeIds = Array.from(new Set(normalizedAssociations.map((item) => item.targetNode)));
    const targetNodes = targetNodeIds.length > 0
      ? await Node.find({ _id: { $in: targetNodeIds }, status: 'approved' })
          .select('_id name synonymSenses description')
          .lean()
      : [];
    await hydrateNodeSensesForNodes(targetNodes);
    const targetNodeMap = new Map(targetNodes.map((item) => [getIdString(item._id), item]));
    if (targetNodes.length !== targetNodeIds.length) {
      return res.status(400).json({ error: '存在无效的关联目标知识域' });
    }

    for (const assoc of normalizedAssociations) {
      const targetNode = targetNodeMap.get(assoc.targetNode);
      if (!targetNode) {
        return res.status(400).json({ error: '存在无效的关联目标知识域' });
      }
      const matched = normalizeNodeSenseList(targetNode).some((sense) => sense.senseId === assoc.targetSenseId);
      if (!matched) {
        return res.status(400).json({ error: `目标知识域「${targetNode.name}」不存在指定释义` });
      }
    }

    const relationRuleValidation = validateAssociationRuleSet({
      currentNodeId: node._id,
      associations: normalizedAssociations
    });
    if (relationRuleValidation.error) {
      return res.status(400).json({ error: relationRuleValidation.error });
    }

    const {
      error: associationResolveError,
      effectiveAssociations,
      insertPlans
    } = resolveAssociationsWithInsertPlans(normalizedAssociations);
    if (associationResolveError) {
      return res.status(400).json({ error: associationResolveError });
    }

    const coveredSourceSenseSet = new Set(effectiveAssociations.map((item) => item.sourceSenseId).filter(Boolean));
    if (!coveredSourceSenseSet.has(nextSenseId)) {
      return res.status(400).json({ error: '新增释义必须至少包含1条有效关联关系' });
    }

    const oldAssociations = Array.isArray(node.associations) ? node.associations : [];
    const oldRelationAssociations = normalizeRelationAssociationList(oldAssociations);
    const nextAssociations = dedupeAssociationList([...oldRelationAssociations, ...effectiveAssociations]);
    const mergedRuleValidation = validateAssociationRuleSet({
      currentNodeId: node._id,
      associations: nextAssociations
    });
    if (mergedRuleValidation.error) {
      return res.status(400).json({ error: mergedRuleValidation.error });
    }

    const nextSenses = [...existingSenses, { senseId: nextSenseId, title: trimmedTitle, content: trimmedContent }];
    node.synonymSenses = nextSenses;
    node.associations = nextAssociations;
    await rebuildRelatedDomainNamesForNodes([node]);
    await node.save();
    await upsertNodeSensesReplace({
      nodeId: node._id,
      senses: nextSenses,
      actorUserId: req.user.userId
    });
    await syncDomainTitleProjectionFromNode(node);

    if (insertPlans.length > 0) {
      await applyInsertAssociationRewire({
        insertPlans,
        newNodeId: node._id,
        newNodeName: node.name
      });
    }

    await syncReciprocalAssociationsForNode({
      nodeDoc: node,
      oldAssociations,
      nextAssociations
    });

    return res.json({
      success: true,
      message: '释义已新增',
      sense: { senseId: nextSenseId, title: trimmedTitle, content: trimmedContent },
      node
    });
  } catch (error) {
    console.error('管理员新增释义错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员编辑释义文本
router.put('/:nodeId/admin/senses/:senseId/text', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId, senseId } = req.params;
    const { title, content } = req.body || {};

    const node = await Node.findById(nodeId).select('status synonymSenses associations');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (node.status !== 'approved') {
      return res.status(400).json({ error: '仅已审批知识域可编辑释义' });
    }

    await hydrateNodeSensesForNodes([node]);
    const sourceSenses = normalizeNodeSenseList(node);
    const targetSenseId = typeof senseId === 'string' ? senseId.trim() : '';
    const targetIndex = sourceSenses.findIndex((sense) => sense.senseId === targetSenseId);
    if (targetIndex < 0) {
      return res.status(404).json({ error: '释义不存在' });
    }

    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    const trimmedContent = typeof content === 'string' ? content.trim() : '';
    if (!trimmedTitle) {
      return res.status(400).json({ error: '释义题目不能为空' });
    }
    if (!trimmedContent) {
      return res.status(400).json({ error: '释义内容不能为空' });
    }

    const titleKey = trimmedTitle.toLowerCase();
    const duplicated = sourceSenses.some((sense, index) => (
      index !== targetIndex
      && (typeof sense?.title === 'string' ? sense.title.trim().toLowerCase() : '') === titleKey
    ));
    if (duplicated) {
      return res.status(400).json({ error: '同一知识域下多个释义题目不能重名' });
    }

    const nextSenses = sourceSenses.map((sense, index) => (
      index === targetIndex
        ? { ...sense, title: trimmedTitle, content: trimmedContent }
        : sense
    ));

    node.synonymSenses = nextSenses;
    await node.save();
    await upsertNodeSensesReplace({
      nodeId: node._id,
      senses: nextSenses,
      actorUserId: req.user.userId
    });
    await syncDomainTitleProjectionFromNode(node);

    return res.json({
      success: true,
      message: '释义文本已更新',
      sense: nextSenses[targetIndex],
      node
    });
  } catch (error) {
    console.error('管理员编辑释义文本错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员删除释义预览
router.post('/:nodeId/admin/senses/:senseId/delete-preview', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId, senseId } = req.params;
    const { onRemovalStrategy, bridgeDecisions } = req.body || {};

    const node = await Node.findById(nodeId).select('name status synonymSenses associations');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (node.status !== 'approved') {
      return res.status(400).json({ error: '仅已审批知识域可删除释义' });
    }

    await hydrateNodeSensesForNodes([node]);
    const sourceSenses = normalizeNodeSenseList(node);
    const targetSenseId = typeof senseId === 'string' ? senseId.trim() : '';
    const targetSense = sourceSenses.find((sense) => sense.senseId === targetSenseId);
    if (!targetSense) {
      return res.status(404).json({ error: '释义不存在' });
    }
    if (sourceSenses.length <= 1) {
      return res.status(400).json({ error: '知识域至少保留1个释义，不能删除最后一个释义' });
    }

    const oldRelationAssociations = normalizeRelationAssociationList(node.associations || []);
    const nextRelationAssociations = oldRelationAssociations.filter((assoc) => assoc.sourceSenseId !== targetSenseId);
    const previewData = await buildAssociationMutationPreviewData({
      node,
      effectiveAssociations: nextRelationAssociations,
      insertPlans: [],
      onRemovalStrategy,
      bridgeDecisions
    });

    return res.json({
      success: true,
      strategy: previewData.strategy,
      deletingSense: targetSense,
      bridgeDecisionItems: previewData.bridgeDecisionItems,
      unresolvedBridgeDecisionCount: previewData.unresolvedBridgeDecisionCount,
      summary: previewData.mutationSummary,
      stats: {
        removedCount: previewData.mutationSummary.removed.length,
        addedCount: previewData.mutationSummary.added.length,
        lostBridgePairCount: previewData.mutationSummary.lostBridgePairs.length,
        reconnectCount: previewData.mutationSummary.reconnectLines.length
      }
    });
  } catch (error) {
    console.error('管理员删除释义预览错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员删除释义
router.delete('/:nodeId/admin/senses/:senseId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId, senseId } = req.params;
    const { onRemovalStrategy, bridgeDecisions } = req.body || {};

    const node = await Node.findById(nodeId).select('name status synonymSenses associations relatedParentDomains relatedChildDomains');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (node.status !== 'approved') {
      return res.status(400).json({ error: '仅已审批知识域可删除释义' });
    }

    await hydrateNodeSensesForNodes([node]);
    const sourceSenses = normalizeNodeSenseList(node);
    const targetSenseId = typeof senseId === 'string' ? senseId.trim() : '';
    const targetSense = sourceSenses.find((sense) => sense.senseId === targetSenseId);
    if (!targetSense) {
      return res.status(404).json({ error: '释义不存在' });
    }
    if (sourceSenses.length <= 1) {
      return res.status(400).json({ error: '知识域至少保留1个释义，不能删除最后一个释义' });
    }

    const oldAssociations = Array.isArray(node.associations) ? node.associations : [];
    const oldRelationAssociations = normalizeRelationAssociationList(oldAssociations);
    const nextAssociations = oldRelationAssociations.filter((assoc) => assoc.sourceSenseId !== targetSenseId);
    const previewData = await buildAssociationMutationPreviewData({
      node,
      effectiveAssociations: nextAssociations,
      insertPlans: [],
      onRemovalStrategy,
      bridgeDecisions
    });

    if (previewData.mutationSummary.lostBridgePairs.length > 0 && previewData.unresolvedBridgeDecisionCount > 0) {
      return res.status(400).json({
        error: '请先逐条确认删除后的上下级承接关系（保留承接或断开）',
        bridgeDecisionItems: previewData.bridgeDecisionItems,
        unresolvedBridgeDecisionCount: previewData.unresolvedBridgeDecisionCount,
        summary: previewData.mutationSummary
      });
    }

    const nextSenses = sourceSenses.filter((sense) => sense.senseId !== targetSenseId);
    node.synonymSenses = nextSenses;
    node.associations = nextAssociations;
    await rebuildRelatedDomainNamesForNodes([node]);
    await node.save();
    await upsertNodeSensesReplace({
      nodeId: node._id,
      senses: nextSenses,
      actorUserId: req.user.userId
    });
    await syncDomainTitleProjectionFromNode(node);

    if (previewData.reconnectPairs.length > 0) {
      await applyReconnectPairs(previewData.reconnectPairs);
    }

    await syncReciprocalAssociationsForNode({
      nodeDoc: node,
      oldAssociations,
      nextAssociations
    });

    return res.json({
      success: true,
      message: `释义「${targetSense.title}」已删除`,
      strategy: previewData.strategy,
      summary: previewData.mutationSummary,
      node
    });
  } catch (error) {
    console.error('管理员删除释义错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 删除节点（管理员专用）
router.post('/:nodeId/delete-preview', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { onRemovalStrategy, bridgeDecisions } = req.body || {};

    const node = await Node.findById(nodeId).select('name synonymSenses associations');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    await hydrateNodeSensesForNodes([node]);

    const oldRelationAssociations = normalizeRelationAssociationList(node.associations || []);
    const lostBridgePairs = computeLostBridgePairs(oldRelationAssociations, []);
    const reconnectResolve = resolveReconnectPairsByDecisions({
      lostBridgePairs,
      onRemovalStrategy,
      bridgeDecisions
    });

    const summaryTargetIds = Array.from(new Set(
      oldRelationAssociations.map((assoc) => assoc.targetNode).filter((item) => isValidObjectId(item))
    ));
    const targetNodes = summaryTargetIds.length > 0
      ? await Node.find({ _id: { $in: summaryTargetIds } }).select('_id name synonymSenses description').lean()
      : [];
    await hydrateNodeSensesForNodes(targetNodes);
    const targetNodeMap = new Map(targetNodes.map((item) => [getIdString(item._id), item]));
    const mutationSummary = buildAssociationMutationSummary({
      node,
      oldAssociations: oldRelationAssociations,
      nextAssociations: [],
      lostBridgePairs,
      reconnectPairs: reconnectResolve.reconnectPairs,
      targetNodeMap
    });

    return res.json({
      success: true,
      strategy: normalizeAssociationRemovalStrategy(onRemovalStrategy),
      bridgeDecisionItems: reconnectResolve.decisionItems,
      unresolvedBridgeDecisionCount: reconnectResolve.unresolvedCount,
      summary: mutationSummary
    });
  } catch (error) {
    console.error('删除节点预览错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.delete('/:nodeId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { onRemovalStrategy, bridgeDecisions } = req.body || {};

    // 先获取节点信息（删除前需要知道节点名称）
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    const nodeName = node.name;
    const oldRelationAssociations = normalizeRelationAssociationList(node.associations || []);
    const lostBridgePairs = computeLostBridgePairs(oldRelationAssociations, []);
    const reconnectResolve = resolveReconnectPairsByDecisions({
      lostBridgePairs,
      onRemovalStrategy,
      bridgeDecisions
    });
    if (lostBridgePairs.length > 0 && reconnectResolve.unresolvedCount > 0) {
      return res.status(400).json({
        error: '删除前需要逐条确认上下级承接关系（保留承接或断开）',
        bridgeDecisionItems: reconnectResolve.decisionItems,
        unresolvedBridgeDecisionCount: reconnectResolve.unresolvedCount
      });
    }

    // 清理所有关联：从所有引用了这个节点的节点中移除
    // 1. 移除所有relatedParentDomains中包含此节点名称的记录
    await Node.updateMany(
      { relatedParentDomains: nodeName },
      { $pull: { relatedParentDomains: nodeName } }
    );

    // 2. 移除所有relatedChildDomains中包含此节点名称的记录
    await Node.updateMany(
      { relatedChildDomains: nodeName },
      { $pull: { relatedChildDomains: nodeName } }
    );

    // 3. 移除所有associations中引用此节点的记录
    await Node.updateMany(
      { 'associations.targetNode': nodeId },
      { $pull: { associations: { targetNode: nodeId } } }
    );

    if (reconnectResolve.reconnectPairs.length > 0) {
      await applyReconnectPairs(reconnectResolve.reconnectPairs);
    }

    // 删除节点
    await Node.findByIdAndDelete(nodeId);
    await NodeSense.deleteMany({ nodeId: node._id });
    await deleteNodeTitleStatesByNodeIds([node._id]);
    await deleteDomainTitleProjectionByNodeIds([node._id]);

    // 从用户拥有的节点列表中移除
    await User.findByIdAndUpdate(node.owner, {
      $pull: { ownedNodes: nodeId }
    });

    res.json({
      success: true,
      message: '节点已删除，所有关联已清理',
      deletedNode: nodeName,
      reconnectCount: reconnectResolve.reconnectPairs.length
    });
  } catch (error) {
    console.error('删除节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取单个节点（需要身份验证）
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const node = await Node.findById(req.params.id);
    if (!node) {
      return res.status(404).json({ message: '节点不存在' });
    }
    await hydrateNodeSensesForNodes([node]);
    node.synonymSenses = normalizeNodeSenseList(node);
    Node.applyKnowledgePointProjection(node, new Date());
    
    // 检查用户是否有权访问此节点
    const user = await User.findById(req.user.userId);
    const isOwner = node.owner.toString() === req.user.userId;
    const isAdmin = user.role === 'admin';
    
    // 只有节点所有者或管理员可以查看未审批节点
    if (node.status !== 'approved' && !isOwner && !isAdmin) {
      return res.status(403).json({ message: '无权访问此节点' });
    }
    
    res.json(node);
  } catch (err) {
    console.error('获取节点错误:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 预览编辑节点关联关系（系统管理员或该知识域域主）
router.post('/:nodeId/associations/preview', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { associations, onRemovalStrategy, bridgeDecisions } = req.body;

    const node = await Node.findById(nodeId).select('name synonymSenses associations domainMaster status');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (node.status !== 'approved') {
      return res.status(400).json({ error: '仅已审批知识域可编辑关联关系' });
    }

    const permission = await validateAssociationMutationPermission({
      node,
      requestUserId: req?.user?.userId
    });
    if (!permission.allowed) {
      return res.status(permission.status).json({ error: permission.error });
    }

    const parseResult = await parseAssociationMutationPayload({
      node,
      rawAssociations: associations
    });
    if (parseResult.error) {
      return res.status(400).json({ error: parseResult.error });
    }

    const previewData = await buildAssociationMutationPreviewData({
      node,
      effectiveAssociations: parseResult.effectiveAssociations,
      insertPlans: parseResult.insertPlans,
      onRemovalStrategy,
      bridgeDecisions
    });

    return res.json({
      success: true,
      strategy: previewData.strategy,
      bridgeDecisionItems: previewData.bridgeDecisionItems,
      unresolvedBridgeDecisionCount: previewData.unresolvedBridgeDecisionCount,
      summary: previewData.mutationSummary,
      stats: {
        removedCount: previewData.mutationSummary.removed.length,
        addedCount: previewData.mutationSummary.added.length,
        lostBridgePairCount: previewData.mutationSummary.lostBridgePairs.length,
        reconnectCount: previewData.mutationSummary.reconnectLines.length
      }
    });
  } catch (error) {
    console.error('预览节点关联编辑错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 编辑节点关联关系（系统管理员或该知识域域主）
router.put('/:nodeId/associations', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { associations, onRemovalStrategy, bridgeDecisions } = req.body; // 新的关联关系数组（支持 sourceSenseId/targetSenseId）

    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (node.status !== 'approved') {
      return res.status(400).json({ error: '仅已审批知识域可编辑关联关系' });
    }

    const permission = await validateAssociationMutationPermission({
      node,
      requestUserId: req?.user?.userId
    });
    if (!permission.allowed) {
      return res.status(permission.status).json({ error: permission.error });
    }

    const parseResult = await parseAssociationMutationPayload({
      node,
      rawAssociations: associations
    });
    if (parseResult.error) {
      return res.status(400).json({ error: parseResult.error });
    }

    const { effectiveAssociations, insertPlans } = parseResult;
    const previewData = await buildAssociationMutationPreviewData({
      node,
      effectiveAssociations,
      insertPlans,
      onRemovalStrategy,
      bridgeDecisions
    });

    const reconnectPairs = previewData.reconnectPairs;
    if (previewData.mutationSummary.lostBridgePairs.length > 0 && previewData.unresolvedBridgeDecisionCount > 0) {
      return res.status(400).json({
        error: '请先逐条确认删除后的上下级承接关系（保留承接或断开）',
        bridgeDecisionItems: previewData.bridgeDecisionItems,
        unresolvedBridgeDecisionCount: previewData.unresolvedBridgeDecisionCount,
        summary: previewData.mutationSummary
      });
    }
    const oldAssociations = node.associations || [];
    
    // 第一步：更新当前节点的关联关系和域列表
    let relatedParentDomains = [];
    let relatedChildDomains = [];
    const effectiveTargetNodeIds = Array.from(new Set(
      effectiveAssociations.map((assoc) => assoc.targetNode).filter((item) => isValidObjectId(item))
    ));

    if (effectiveAssociations.length > 0) {
      const targetNodes = effectiveTargetNodeIds.length > 0
        ? await Node.find({ _id: { $in: effectiveTargetNodeIds } })
        : [];

      const nodeMap = {};
      targetNodes.forEach(n => {
        nodeMap[n._id.toString()] = n.name;
      });

      effectiveAssociations.forEach((association) => {
        const targetNodeName = nodeMap[association.targetNode];
        if (targetNodeName) {
          if (association.relationType === 'extends') {
            relatedParentDomains.push(targetNodeName);
          } else if (association.relationType === 'contains') {
            relatedChildDomains.push(targetNodeName);
          }
        }
      });
    }

    node.associations = effectiveAssociations;
    node.relatedParentDomains = Array.from(new Set(relatedParentDomains));
    node.relatedChildDomains = Array.from(new Set(relatedChildDomains));
    await node.save();
    await syncDomainTitleProjectionFromNode(node);

    // 第二步：处理插入重连与断开后承接关系
    if (insertPlans.length > 0) {
      await applyInsertAssociationRewire({
        insertPlans,
        newNodeId: node._id,
        newNodeName: node.name
      });
    }

    if (reconnectPairs.length > 0) {
      await applyReconnectPairs(reconnectPairs);
    }

    // 第三步：同步双向释义关联（包含<->扩展）并修正目标节点摘要关系
    await syncReciprocalAssociationsForNode({
      nodeDoc: node,
      oldAssociations,
      nextAssociations: effectiveAssociations
    });

    res.json({
      success: true,
      message: '关联关系已更新',
      strategy: previewData.strategy,
      summary: previewData.mutationSummary,
      node: node
    });
  } catch (error) {
    console.error('编辑节点关联错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 设置/取消热门节点（管理员专用）
router.put('/:nodeId/featured', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { isFeatured, featuredOrder } = req.body;

    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    node.isFeatured = isFeatured !== undefined ? isFeatured : node.isFeatured;
    if (featuredOrder !== undefined) {
      node.featuredOrder = featuredOrder;
    }

    await node.save();
    await syncDomainTitleProjectionFromNode(node);

    res.json({
      success: true,
      message: isFeatured ? '已设置为热门节点' : '已取消热门节点',
      node: node
    });
  } catch (error) {
    console.error('设置热门节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取根节点（所有用户可访问）
router.get('/public/root-nodes', async (req, res) => {
  try {
    const pageSize = toSafeInteger(req.query?.pageSize, 120, { min: 1, max: 500 });
    const cursor = decodeNameCursor(typeof req.query?.cursor === 'string' ? req.query.cursor : '');
    const rootPredicate = [{ relatedParentDomains: { $size: 0 } }];
    let fetchedRootNodes = [];

    if (isDomainTitleProjectionReadEnabled()) {
      const query = {
        status: 'approved',
        $or: rootPredicate
      };
      if (cursor.name) {
        const cursorNameClause = isValidObjectId(cursor.id)
          ? {
            $or: [
              { name: { $gt: cursor.name } },
              { name: cursor.name, nodeId: { $gt: new mongoose.Types.ObjectId(cursor.id) } }
            ]
          }
          : { name: { $gt: cursor.name } };
        query.$and = [
          { $or: rootPredicate },
          cursorNameClause
        ];
        delete query.$or;
      }
      const projectionRows = await DomainTitleProjection.find(query)
        .select('nodeId name description relatedParentDomains relatedChildDomains knowledgePoint contentScore domainMaster allianceId status')
        .sort({ name: 1, nodeId: 1 })
        .limit(pageSize + 1)
        .lean();
      fetchedRootNodes = projectionRows.map((row) => mapProjectionRowToNodeLike(row));
    } else {
      const query = {
        status: 'approved',
        $or: [
          { relatedParentDomains: { $exists: false } },
          { relatedParentDomains: { $size: 0 } }
        ]
      };
      if (cursor.name) {
        const cursorNameClause = isValidObjectId(cursor.id)
          ? {
            $or: [
              { name: { $gt: cursor.name } },
              { name: cursor.name, _id: { $gt: new mongoose.Types.ObjectId(cursor.id) } }
            ]
          }
          : { name: { $gt: cursor.name } };
        query.$and = [
          { $or: [{ relatedParentDomains: { $exists: false } }, { relatedParentDomains: { $size: 0 } }] },
          cursorNameClause
        ];
        delete query.$or;
      }
      fetchedRootNodes = await Node.find(query)
        .populate('owner', 'username profession')
        .select('name description synonymSenses relatedParentDomains relatedChildDomains knowledgePoint contentScore domainMaster allianceId')
        .sort({ name: 1, _id: 1 })
        .limit(pageSize + 1);
    }
    const hasMore = fetchedRootNodes.length > pageSize;
    const rootNodes = hasMore ? fetchedRootNodes.slice(0, pageSize) : fetchedRootNodes;
    await hydrateNodeSensesForNodes(rootNodes);

    const styledRootNodes = await attachVisualStyleToNodeList(rootNodes);
    await hydrateNodeSensesForNodes(styledRootNodes);
    const normalizedRootNodes = styledRootNodes.map((item) => {
      const senses = normalizeNodeSenseList(item);
      const activeSense = senses[0];
      return {
        ...item,
        synonymSenses: senses,
        activeSenseId: activeSense?.senseId || '',
        activeSenseTitle: activeSense?.title || '',
        activeSenseContent: activeSense?.content || '',
        displayName: typeof item?.name === 'string' ? item.name : ''
      };
    });

    res.json({
      success: true,
      count: normalizedRootNodes.length,
      nodes: normalizedRootNodes,
      hasMore,
      nextCursor: hasMore
        ? encodeNameCursor({
          name: rootNodes[rootNodes.length - 1]?.name || '',
          id: getIdString(rootNodes[rootNodes.length - 1]?._id)
        })
        : ''
    });
  } catch (error) {
    console.error('获取根节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取热门节点（所有用户可访问）
router.get('/public/featured-nodes', async (req, res) => {
  try {
    const page = toSafeInteger(req.query?.page, 1, { min: 1, max: 1000000 });
    const pageSize = toSafeInteger(req.query?.pageSize, 80, { min: 1, max: 200 });
    const query = {
      status: 'approved',
      isFeatured: true
    };
    const [featuredNodes, total] = isDomainTitleProjectionReadEnabled()
      ? await Promise.all([
        DomainTitleProjection.find(query)
          .sort({ featuredOrder: 1, createdAt: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .select('nodeId name description relatedParentDomains relatedChildDomains knowledgePoint contentScore isFeatured featuredOrder domainMaster allianceId status')
          .lean()
          .then((rows) => rows.map((row) => mapProjectionRowToNodeLike(row))),
        DomainTitleProjection.countDocuments(query)
      ])
      : await Promise.all([
        Node.find(query)
          .populate('owner', 'username profession')
          .sort({ featuredOrder: 1, createdAt: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .select('name description synonymSenses relatedParentDomains relatedChildDomains knowledgePoint contentScore isFeatured featuredOrder domainMaster allianceId'),
        Node.countDocuments(query)
      ]);
    await hydrateNodeSensesForNodes(featuredNodes);
    const styledFeaturedNodes = await attachVisualStyleToNodeList(featuredNodes);
    await hydrateNodeSensesForNodes(styledFeaturedNodes);
    const normalizedFeaturedNodes = styledFeaturedNodes.map((item) => {
      const senses = normalizeNodeSenseList(item);
      const activeSense = senses[0];
      return {
        ...item,
        synonymSenses: senses,
        activeSenseId: activeSense?.senseId || '',
        activeSenseTitle: activeSense?.title || '',
        activeSenseContent: activeSense?.content || '',
        displayName: typeof item?.name === 'string' ? item.name : ''
      };
    });

    res.json({
      success: true,
      count: normalizedFeaturedNodes.length,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
      nodes: normalizedFeaturedNodes
    });
  } catch (error) {
    console.error('获取热门节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 实时搜索节点（所有用户可访问）
router.get('/public/search', async (req, res) => {
  try {
    const { query } = req.query;
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    if (!normalizedQuery) {
      return res.json({
        success: true,
        results: []
      });
    }

    // 分割关键词（按空格）
    const keywords = normalizedQuery.split(/\s+/).filter(Boolean);

    const allNodes = await loadNodeSearchCandidates({
      normalizedKeyword: normalizedQuery,
      limit: 1500
    });

    const searchResults = allNodes
      .flatMap((node) => buildNodeSenseSearchEntries(node, keywords))
      .sort((a, b) => b.matchCount - a.matchCount || a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'))
      .slice(0, 300)
      .map(({ matchCount, ...item }) => item);

    res.json({
      success: true,
      count: searchResults.length,
      results: searchResults
    });
  } catch (error) {
    console.error('搜索节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取标题级主视角（标题关系由释义关系并集构成）
router.get('/public/title-detail/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    const maxNodes = toSafeInteger(req.query?.limit, 160, { min: 20, max: 500 });

    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的节点ID' });
    }

    const center = isDomainTitleProjectionReadEnabled()
      ? await DomainTitleProjection.findOne({
        nodeId: new mongoose.Types.ObjectId(nodeId),
        status: 'approved'
      })
        .select('nodeId name description knowledgePoint contentScore domainMaster allianceId status')
        .lean()
        .then((row) => (row ? mapProjectionRowToNodeLike(row) : null))
      : await Node.findById(nodeId)
        .select('name description synonymSenses knowledgePoint contentScore domainMaster allianceId status associations')
        .lean();
    if (!center) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (center.status !== 'approved') {
      return res.status(403).json({ error: '该节点未审批' });
    }
    await hydrateNodeSensesForNodes([center]);

    const centerNodeId = getIdString(center?._id || nodeId);
    const [centerRelationRows, incomingRelationRows] = isDomainTitleProjectionReadEnabled()
      ? await Promise.all([
        listActiveTitleRelationsBySourceNodeIds([centerNodeId]),
        listActiveTitleRelationsByTargetNodeIds([centerNodeId])
      ])
      : [[], []];
    const centerAssociations = isDomainTitleProjectionReadEnabled()
      ? normalizeTitleRelationAssociationList(centerRelationRows)
      : normalizeTitleRelationAssociationList(center?.associations || []);
    const directNeighborIdSet = new Set();
    for (const assoc of centerAssociations) {
      const targetNodeId = getIdString(assoc?.targetNode);
      if (!isValidObjectId(targetNodeId) || targetNodeId === centerNodeId) continue;
      directNeighborIdSet.add(targetNodeId);
    }
    if (isDomainTitleProjectionReadEnabled()) {
      for (const row of incomingRelationRows) {
        const sourceNodeId = getIdString(row?.sourceNodeId);
        if (!isValidObjectId(sourceNodeId) || sourceNodeId === centerNodeId) continue;
        directNeighborIdSet.add(sourceNodeId);
      }
    }

    const directNeighborObjectIds = Array.from(directNeighborIdSet)
      .slice(0, Math.max(50, maxNodes * 5))
      .map((id) => new mongoose.Types.ObjectId(id));
    const directNeighborDocs = directNeighborObjectIds.length > 0
      ? (isDomainTitleProjectionReadEnabled()
        ? await DomainTitleProjection.find({
          status: 'approved',
          nodeId: { $in: directNeighborObjectIds }
        })
          .select('nodeId name description knowledgePoint contentScore domainMaster allianceId status')
          .lean()
          .then((rows) => rows.map((row) => mapProjectionRowToNodeLike(row)))
        : await Node.find({
          status: 'approved',
          _id: { $in: directNeighborObjectIds }
        })
          .select('name description synonymSenses knowledgePoint contentScore domainMaster allianceId associations')
          .lean())
      : [];
    await hydrateNodeSensesForNodes(directNeighborDocs);

    const sortedNeighborDocs = directNeighborDocs
      .sort((a, b) => (a?.name || '').localeCompare((b?.name || ''), 'zh-Hans-CN'))
      .slice(0, Math.max(0, maxNodes - 1));
    const incomingBySourceNodeId = incomingRelationRows.reduce((acc, row) => {
      const sourceNodeId = getIdString(row?.sourceNodeId);
      if (!sourceNodeId) return acc;
      if (!acc.has(sourceNodeId)) {
        acc.set(sourceNodeId, []);
      }
      acc.get(sourceNodeId).push(row);
      return acc;
    }, new Map());
    const nodeById = new Map([
      [centerNodeId, center],
      ...sortedNeighborDocs.map((item) => [getIdString(item?._id), item])
    ]);

    const orderedNodeIds = [centerNodeId, ...sortedNeighborDocs.map((item) => getIdString(item?._id)).filter(Boolean)];
    const levelByNodeId = { [centerNodeId]: 0 };
    orderedNodeIds.slice(1).forEach((id) => {
      levelByNodeId[id] = 1;
    });

    const senseMetaByNodeId = new Map();
    const getNodeSenseMeta = (nodeId) => {
      const safeNodeId = getIdString(nodeId);
      if (!safeNodeId) return { firstSenseId: '', titleMap: new Map() };
      let meta = senseMetaByNodeId.get(safeNodeId);
      if (!meta) {
        const nodeDoc = nodeById.get(safeNodeId) || {};
        const senses = normalizeNodeSenseList(nodeDoc).filter((sense) => (
          typeof sense?.senseId === 'string'
          && sense.senseId.trim()
          && typeof sense?.title === 'string'
          && sense.title.trim()
        ));
        const titleMap = new Map(senses.map((sense) => [sense.senseId, sense.title]));
        meta = {
          firstSenseId: senses[0]?.senseId || '',
          titleMap
        };
        senseMetaByNodeId.set(safeNodeId, meta);
      }
      return meta;
    };
    const resolveAssociationSenseId = (nodeId, senseId) => {
      const safeSenseId = typeof senseId === 'string' ? senseId.trim() : '';
      const meta = getNodeSenseMeta(nodeId);
      if (!meta?.titleMap || meta.titleMap.size === 0) return '';
      if (safeSenseId && meta.titleMap.has(safeSenseId)) return safeSenseId;
      return meta.firstSenseId || '';
    };
    const getSenseTitle = (nodeId, senseId) => {
      const safeSenseId = typeof senseId === 'string' ? senseId.trim() : '';
      if (!safeSenseId) return '';
      const meta = getNodeSenseMeta(nodeId);
      return meta.titleMap.get(safeSenseId) || '';
    };
    const edgeMap = new Map();
    const getOrCreateEdge = (nodeAId, nodeBId) => {
      const edgeId = `${nodeAId}|${nodeBId}`;
      const existing = edgeMap.get(edgeId);
      if (existing) return existing;
      const created = {
        edgeId,
        nodeAId,
        nodeBId,
        pairs: [],
        senseTitleMapByNodeId: new Map()
      };
      edgeMap.set(edgeId, created);
      return created;
    };
    const upsertEdgeSense = (edge, nodeId, senseId, senseTitle) => {
      if (!senseId || !senseTitle) return;
      let titleMap = edge.senseTitleMapByNodeId.get(nodeId);
      if (!titleMap) {
        titleMap = new Map();
        edge.senseTitleMapByNodeId.set(nodeId, titleMap);
      }
      if (!titleMap.has(senseId)) {
        titleMap.set(senseId, senseTitle);
      }
    };
    const appendPairToEdge = (sourceNodeId, targetNodeId, relationType, sourceSenseId, targetSenseId) => {
      const safeSourceNodeId = getIdString(sourceNodeId);
      const safeTargetNodeId = getIdString(targetNodeId);
      const safeRelationType = typeof relationType === 'string' ? relationType : '';
      const safeSourceSenseId = resolveAssociationSenseId(safeSourceNodeId, sourceSenseId);
      const safeTargetSenseId = resolveAssociationSenseId(safeTargetNodeId, targetSenseId);
      if (!safeSourceNodeId || !safeTargetNodeId || safeSourceNodeId === safeTargetNodeId) return;
      if (!nodeById.has(safeSourceNodeId) || !nodeById.has(safeTargetNodeId)) return;
      if (!safeSourceSenseId || !safeTargetSenseId || !safeRelationType) return;

      const sourceSenseTitle = getSenseTitle(safeSourceNodeId, safeSourceSenseId);
      const targetSenseTitle = getSenseTitle(safeTargetNodeId, safeTargetSenseId);
      if (!sourceSenseTitle || !targetSenseTitle) return;

      const nodeAId = safeSourceNodeId < safeTargetNodeId ? safeSourceNodeId : safeTargetNodeId;
      const nodeBId = safeSourceNodeId < safeTargetNodeId ? safeTargetNodeId : safeSourceNodeId;
      const edge = getOrCreateEdge(nodeAId, nodeBId);
      const pairKey = [
        safeSourceNodeId,
        safeSourceSenseId,
        safeRelationType,
        safeTargetNodeId,
        safeTargetSenseId
      ].join('|');
      if (!edge.pairs.some((item) => item.pairKey === pairKey)) {
        edge.pairs.push({
          pairKey,
          sourceNodeId: safeSourceNodeId,
          sourceSenseId: safeSourceSenseId,
          sourceSenseTitle,
          targetNodeId: safeTargetNodeId,
          targetSenseId: safeTargetSenseId,
          targetSenseTitle,
          relationType: safeRelationType
        });
      }
      upsertEdgeSense(edge, safeSourceNodeId, safeSourceSenseId, sourceSenseTitle);
      upsertEdgeSense(edge, safeTargetNodeId, safeTargetSenseId, targetSenseTitle);
    };

    centerAssociations.forEach((assoc) => {
      appendPairToEdge(
        centerNodeId,
        assoc?.targetNode,
        assoc?.relationType,
        assoc?.sourceSenseId,
        assoc?.targetSenseId
      );
    });
    sortedNeighborDocs.forEach((neighbor) => {
      const neighborId = getIdString(neighbor?._id);
      const neighborAssociations = isDomainTitleProjectionReadEnabled()
        ? normalizeTitleRelationAssociationList(incomingBySourceNodeId.get(neighborId) || [])
        : normalizeTitleRelationAssociationList(neighbor?.associations || []);
      neighborAssociations.forEach((assoc) => {
        if (getIdString(assoc?.targetNode) !== centerNodeId) return;
        appendPairToEdge(
          neighborId,
          centerNodeId,
          assoc?.relationType,
          assoc?.sourceSenseId,
          assoc?.targetSenseId
        );
      });
    });

    const edgeList = Array.from(edgeMap.values())
      .map((edge) => {
        const nodeASenseMap = edge.senseTitleMapByNodeId.get(edge.nodeAId) || new Map();
        const nodeBSenseMap = edge.senseTitleMapByNodeId.get(edge.nodeBId) || new Map();
        const containsCount = edge.pairs.filter((item) => item.relationType === 'contains').length;
        const extendsCount = edge.pairs.filter((item) => item.relationType === 'extends').length;
        return {
          edgeId: edge.edgeId,
          nodeAId: edge.nodeAId,
          nodeBId: edge.nodeBId,
          pairCount: edge.pairs.length,
          containsCount,
          extendsCount,
          nodeASenseTitles: Array.from(nodeASenseMap.values()),
          nodeBSenseTitles: Array.from(nodeBSenseMap.values()),
          pairs: edge.pairs.map(({ pairKey, ...item }) => item)
        };
      })
      .sort((a, b) => b.pairCount - a.pairCount || a.edgeId.localeCompare(b.edgeId, 'en'));

    const toTitleCardSource = (nodeDoc = {}) => ({
      _id: nodeDoc?._id || null,
      name: nodeDoc?.name || '',
      description: nodeDoc?.description || '',
      synonymSenses: normalizeNodeSenseList(nodeDoc),
      knowledgePoint: nodeDoc?.knowledgePoint || null,
      contentScore: nodeDoc?.contentScore,
      domainMaster: nodeDoc?.domainMaster || null,
      allianceId: nodeDoc?.allianceId || null
    });

    const selectedNodes = orderedNodeIds
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .map((item) => buildNodeTitleCard(toTitleCardSource(item)));
    const styledSelectedNodes = await attachVisualStyleToNodeList(selectedNodes);

    const styledNodeById = new Map(styledSelectedNodes.map((item) => [getIdString(item?._id), item]));
    const centerNode = styledNodeById.get(getIdString(nodeId)) || buildNodeTitleCard(toTitleCardSource(center));
    const edgesWithNames = edgeList.map((edge) => {
      const nodeA = styledNodeById.get(edge.nodeAId) || nodeById.get(edge.nodeAId) || null;
      const nodeB = styledNodeById.get(edge.nodeBId) || nodeById.get(edge.nodeBId) || null;
      return {
        ...edge,
        nodeAName: nodeA?.name || '',
        nodeBName: nodeB?.name || ''
      };
    });

    res.json({
      success: true,
      graph: {
        centerNodeId: getIdString(nodeId),
        centerNode,
        nodes: styledSelectedNodes,
        edges: edgesWithNames,
        levelByNodeId,
        maxLevel: Math.max(0, ...Object.values(levelByNodeId || {}).map((value) => Number(value) || 0)),
        nodeCount: styledSelectedNodes.length,
        edgeCount: edgesWithNames.length
      }
    });
  } catch (error) {
    console.error('获取标题主视角错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取节点详细信息（所有用户可访问）
router.get('/public/node-detail/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestedSenseId = typeof req.query?.senseId === 'string' ? req.query.senseId.trim() : '';

    const node = await Node.findById(nodeId)
      .populate({
        path: 'owner',
        select: 'username profession avatar level role allianceId',
        populate: { path: 'allianceId', select: 'name flag visualStyles activeVisualStyleId' }
      })
      .populate({
        path: 'domainMaster',
        select: 'username profession avatar level allianceId',
        populate: { path: 'allianceId', select: 'name flag visualStyles activeVisualStyleId' }
      })
      .populate({
        path: 'domainAdmins',
        select: 'username profession avatar level allianceId',
        populate: { path: 'allianceId', select: 'name flag visualStyles activeVisualStyleId' }
      })
      .select('name description synonymSenses owner domainMaster domainAdmins allianceId associations relatedParentDomains relatedChildDomains knowledgePoint contentScore createdAt status');

    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    if (node.status !== 'approved') {
      return res.status(403).json({ error: '该节点未审批' });
    }
    await hydrateNodeSensesForNodes([node]);

    const nodeSenses = normalizeNodeSenseList(node);
    const activeSense = pickNodeSenseById(node, requestedSenseId);
    const activeSenseId = activeSense?.senseId || '';
    const relationAssociations = (Array.isArray(node.associations) ? node.associations : [])
      .filter((assoc) => {
        const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
        if (!sourceSenseId) return true;
        return sourceSenseId === activeSenseId;
      });

    const parentTargetIds = Array.from(new Set(
      relationAssociations
        .filter((assoc) => assoc?.relationType === 'extends')
        .map((assoc) => getIdString(assoc?.targetNode))
        .filter((id) => isValidObjectId(id))
    ));
    const childTargetIds = Array.from(new Set(
      relationAssociations
        .filter((assoc) => assoc?.relationType === 'contains')
        .map((assoc) => getIdString(assoc?.targetNode))
        .filter((id) => isValidObjectId(id))
    ));

    const nodeNameFallbackParents = (Array.isArray(node.relatedParentDomains) ? node.relatedParentDomains : []).filter(Boolean);
    const nodeNameFallbackChildren = (Array.isArray(node.relatedChildDomains) ? node.relatedChildDomains : []).filter(Boolean);

    const parentNodes = parentTargetIds.length > 0
      ? await Node.find({
          _id: { $in: parentTargetIds },
          status: 'approved'
        }).select('_id name description synonymSenses knowledgePoint contentScore domainMaster allianceId')
      : await Node.find({
          name: { $in: nodeNameFallbackParents },
          status: 'approved'
        }).select('_id name description synonymSenses knowledgePoint contentScore domainMaster allianceId');

    const childNodes = childTargetIds.length > 0
      ? await Node.find({
          _id: { $in: childTargetIds },
          status: 'approved'
        }).select('_id name description synonymSenses knowledgePoint contentScore domainMaster allianceId')
      : await Node.find({
          name: { $in: nodeNameFallbackChildren },
          status: 'approved'
        }).select('_id name description synonymSenses knowledgePoint contentScore domainMaster allianceId');
    await hydrateNodeSensesForNodes(parentNodes);
    await hydrateNodeSensesForNodes(childNodes);

    const relationByTargetNodeId = relationAssociations.reduce((acc, assoc) => {
      const key = getIdString(assoc?.targetNode);
      if (!key || acc.has(key)) return acc;
      acc.set(key, assoc);
      return acc;
    }, new Map());

    const decorateNodeWithSense = (rawNode) => {
      const source = rawNode && typeof rawNode.toObject === 'function' ? rawNode.toObject() : rawNode;
      const normalizedSenses = normalizeNodeSenseList(rawNode);
      const targetNodeId = getIdString(source?._id);
      const assoc = relationByTargetNodeId.get(targetNodeId);
      const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
      const pickedSense = pickNodeSenseById({ ...source, synonymSenses: normalizedSenses }, targetSenseId);
      return {
        ...source,
        synonymSenses: normalizedSenses,
        activeSenseId: pickedSense?.senseId || '',
        activeSenseTitle: pickedSense?.title || '',
        activeSenseContent: pickedSense?.content || '',
        displayName: buildNodeSenseDisplayName(source?.name || '', pickedSense?.title || '')
      };
    };

    const normalizeUserForNodeDetail = (user) => {
      if (!user) return null;
      const userObj = typeof user.toObject === 'function' ? user.toObject() : user;
      const allianceObj = userObj?.allianceId && typeof userObj.allianceId === 'object'
        ? userObj.allianceId
        : null;
      return {
        ...userObj,
        _id: getIdString(userObj._id),
        alliance: allianceObj
          ? {
              _id: getIdString(allianceObj._id),
              name: allianceObj.name || '',
              flag: allianceObj.flag || '',
              visualStyles: Array.isArray(allianceObj.visualStyles) ? allianceObj.visualStyles : [],
              activeVisualStyleId: getIdString(allianceObj.activeVisualStyleId)
            }
          : null
      };
    };

    const nodeObj = node.toObject();
    nodeObj.synonymSenses = nodeSenses;
    nodeObj.activeSenseId = activeSenseId;
    nodeObj.activeSenseTitle = activeSense?.title || '';
    nodeObj.activeSenseContent = activeSense?.content || '';
    nodeObj.displayName = buildNodeSenseDisplayName(nodeObj.name || '', nodeObj.activeSenseTitle || '');
    nodeObj.owner = normalizeUserForNodeDetail(node.owner);
    nodeObj.domainMaster = normalizeUserForNodeDetail(node.domainMaster);
    nodeObj.domainAdmins = Array.isArray(node.domainAdmins)
      ? node.domainAdmins.map(normalizeUserForNodeDetail).filter(Boolean)
      : [];
    const [styledNode] = await attachVisualStyleToNodeList([nodeObj]);
    const styledParentNodes = await attachVisualStyleToNodeList(parentNodes.map(decorateNodeWithSense));
    const styledChildNodes = await attachVisualStyleToNodeList(childNodes.map(decorateNodeWithSense));

    res.json({
      success: true,
      node: {
        ...(styledNode || nodeObj),
        parentNodesInfo: styledParentNodes,
        childNodesInfo: styledChildNodes
      }
    });
  } catch (error) {
    console.error('获取节点详情错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 公开接口：获取所有已批准的节点（用于构建导航路径）
router.get('/public/all-nodes', async (req, res) => {
  try {
    const pageSize = toSafeInteger(req.query?.pageSize, 200, { min: 1, max: 1000 });
    const cursor = decodeNameCursor(typeof req.query?.cursor === 'string' ? req.query.cursor : '');
    const query = { status: 'approved' };
    if (cursor.name) {
      if (isValidObjectId(cursor.id)) {
        query.$or = [
          { name: { $gt: cursor.name } },
          {
            name: cursor.name,
            [isDomainTitleProjectionReadEnabled() ? 'nodeId' : '_id']: {
              $gt: new mongoose.Types.ObjectId(cursor.id)
            }
          }
        ];
      } else {
        query.name = { $gt: cursor.name };
      }
    }
    const fetchedNodes = isDomainTitleProjectionReadEnabled()
      ? await DomainTitleProjection.find(query)
        .select('nodeId name description relatedParentDomains relatedChildDomains')
        .sort({ name: 1, nodeId: 1 })
        .limit(pageSize + 1)
        .lean()
        .then((rows) => rows.map((row) => ({
          _id: row.nodeId,
          name: row.name,
          description: row.description,
          relatedParentDomains: Array.isArray(row.relatedParentDomains) ? row.relatedParentDomains : [],
          relatedChildDomains: Array.isArray(row.relatedChildDomains) ? row.relatedChildDomains : []
        })))
      : await Node.find(query)
        .select('_id name description relatedParentDomains relatedChildDomains')
        .sort({ name: 1, _id: 1 })
        .limit(pageSize + 1)
        .lean();
    const hasMore = fetchedNodes.length > pageSize;
    const nodes = hasMore ? fetchedNodes.slice(0, pageSize) : fetchedNodes;

    res.json({
      success: true,
      nodes,
      hasMore,
      nextCursor: hasMore
        ? encodeNameCursor({
          name: nodes[nodes.length - 1]?.name || '',
          id: getIdString(nodes[nodes.length - 1]?._id)
        })
        : ''
    });
  } catch (error) {
    console.error('获取所有节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员：更换节点域主
router.put('/admin/domain-master/:nodeId', authenticateToken, async (req, res) => {
  try {
    // 检查是否是管理员
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: '无权限执行此操作' });
    }

    const { nodeId } = req.params;
    const { domainMasterId } = req.body;

    // 查找节点
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    const resetDistributionOwnerBoundState = () => {
      node.knowledgeDistributionRule = {
        ...(node.knowledgeDistributionRule?.toObject?.() || node.knowledgeDistributionRule || {}),
        blacklistUserIds: [],
        blacklistAllianceIds: []
      };
      node.knowledgeDistributionRuleProfiles = (Array.isArray(node.knowledgeDistributionRuleProfiles)
        ? node.knowledgeDistributionRuleProfiles
        : []
      ).map((profile) => ({
        profileId: profile.profileId,
        name: profile.name,
        rule: {
          ...(profile?.rule?.toObject?.() || profile?.rule || {}),
          blacklistUserIds: [],
          blacklistAllianceIds: []
        }
      }));
      node.knowledgeDistributionLocked = null;
    };

    const currentMasterId = getIdString(node.domainMaster);

    // 如果domainMasterId为空或null，清除域主
    if (!domainMasterId) {
      node.domainMaster = null;
      node.allianceId = null;
      if (currentMasterId) {
        resetDistributionOwnerBoundState();
      }
      await node.save();
      await syncDomainTitleProjectionFromNode(node);
      return res.json({
        success: true,
        message: '域主已清除',
        node: await Node.findById(nodeId).populate('domainMaster', 'username profession')
      });
    }

    // 查找新域主用户
    const newMaster = await User.findById(domainMasterId).select('role allianceId');
    if (!newMaster) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (newMaster.role === 'admin') {
      return res.status(400).json({ error: '管理员不能作为域主' });
    }

    // 更新域主
    node.domainMaster = domainMasterId;
    node.allianceId = newMaster.allianceId || null;
    node.domainAdmins = (node.domainAdmins || []).filter((adminId) => (
      getIdString(adminId) !== getIdString(domainMasterId)
    ));
    if (currentMasterId !== getIdString(domainMasterId)) {
      resetDistributionOwnerBoundState();
    }
    await node.save();
    await syncDomainTitleProjectionFromNode(node);

    const updatedNode = await Node.findById(nodeId)
      .populate('domainMaster', 'username profession');

    res.json({
      success: true,
      message: '域主更换成功',
      node: updatedNode
    });
  } catch (error) {
    console.error('更换域主错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员：搜索用户（用于选择域主）
router.get('/admin/search-users', authenticateToken, async (req, res) => {
  try {
    // 检查是否是管理员
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: '无权限执行此操作' });
    }

    const { keyword } = req.query;

    let query = { role: { $ne: 'admin' } };
    if (keyword && keyword.trim()) {
      query = {
        role: { $ne: 'admin' },
        username: { $regex: keyword, $options: 'i' }
      };
    }

    const users = await User.find(query)
      .select('_id username level role')
      .limit(20)
      .sort({ username: 1 });

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('搜索用户错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取与当前用户相关的知识域（域主/普通管理员/收藏/最近访问）
router.get('/me/related-domains', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('favoriteDomains recentVisitedDomains');
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const userId = user._id;
    const [domainMasterDomains, domainAdminDomains] = await Promise.all([
      Node.find({ status: 'approved', domainMaster: userId })
        .select(DOMAIN_CARD_SELECT)
        .sort({ name: 1 })
        .lean(),
      Node.find({ status: 'approved', domainAdmins: userId, domainMaster: { $ne: userId } })
        .select(DOMAIN_CARD_SELECT)
        .sort({ name: 1 })
        .lean()
    ]);

    const favoriteDomainIds = (user.favoriteDomains || [])
      .map((id) => getIdString(id))
      .filter((id) => isValidObjectId(id));
    const favoriteNodes = favoriteDomainIds.length > 0
      ? await Node.find({ _id: { $in: favoriteDomainIds }, status: 'approved' })
          .select(DOMAIN_CARD_SELECT)
          .lean()
      : [];
    const favoriteNodeMap = new Map(favoriteNodes.map((node) => [getIdString(node._id), node]));
    const favoriteDomains = favoriteDomainIds
      .map((id) => favoriteNodeMap.get(id))
      .filter(Boolean);

    const recentEntries = (user.recentVisitedDomains || [])
      .filter((item) => item && item.nodeId)
      .sort((a, b) => new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime());
    const recentDomainIds = recentEntries
      .map((item) => getIdString(item.nodeId))
      .filter((id) => isValidObjectId(id));
    const recentNodes = recentDomainIds.length > 0
      ? await Node.find({ _id: { $in: recentDomainIds }, status: 'approved' })
          .select(DOMAIN_CARD_SELECT)
          .lean()
      : [];
    const recentNodeMap = new Map(recentNodes.map((node) => [getIdString(node._id), node]));
    const recentDomains = recentEntries
      .map((item) => {
        const nodeId = getIdString(item.nodeId);
        const node = recentNodeMap.get(nodeId);
        if (!node) return null;
        return {
          ...node,
          visitedAt: item.visitedAt
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      domainMasterDomains,
      domainAdminDomains,
      favoriteDomains,
      recentDomains
    });
  } catch (error) {
    console.error('获取相关知识域错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 收藏/取消收藏知识域（当前用户）
router.post('/:nodeId/favorite', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('_id status');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可收藏' });
    }

    const user = await User.findById(req.user.userId).select('favoriteDomains');
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const targetId = getIdString(node._id);
    const exists = (user.favoriteDomains || []).some((id) => getIdString(id) === targetId);

    if (exists) {
      user.favoriteDomains = (user.favoriteDomains || []).filter((id) => getIdString(id) !== targetId);
    } else {
      user.favoriteDomains = [node._id, ...(user.favoriteDomains || []).filter((id) => getIdString(id) !== targetId)];
      if (user.favoriteDomains.length > 100) {
        user.favoriteDomains = user.favoriteDomains.slice(0, 100);
      }
    }

    await user.save();

    res.json({
      success: true,
      isFavorite: !exists,
      message: exists ? '已取消收藏' : '已加入收藏'
    });
  } catch (error) {
    console.error('收藏知识域错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 记录最近访问知识域（当前用户）
router.post('/:nodeId/recent-visit', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('_id status');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可访问' });
    }

    const user = await User.findById(req.user.userId).select('recentVisitedDomains');
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const targetId = getIdString(node._id);
    const filtered = (user.recentVisitedDomains || []).filter((item) => getIdString(item?.nodeId) !== targetId);
    user.recentVisitedDomains = [
      { nodeId: node._id, visitedAt: new Date() },
      ...filtered
    ].slice(0, 50);

    await user.save();

    res.json({
      success: true
    });
  } catch (error) {
    console.error('记录最近访问知识域错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 普通用户申请成为无域主知识域的域主（提交给系统管理员审批）
router.post('/:nodeId/domain-master/apply', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }
    if (!reason) {
      return res.status(400).json({ error: '申请理由不能为空' });
    }
    if (reason.length > 300) {
      return res.status(400).json({ error: '申请理由不能超过300字' });
    }

    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }

    const requester = await User.findById(requestUserId).select('username role');
    if (!requester) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (requester.role !== 'common') {
      return res.status(403).json({ error: '仅普通用户可申请成为域主' });
    }

    const node = await Node.findById(nodeId).select('name status owner domainMaster allianceId');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可访问' });
    }

    if (node.domainMaster) {
      const currentMaster = await User.findById(node.domainMaster).select('role');
      if (!currentMaster || currentMaster.role === 'admin') {
        // 兼容历史数据：管理员或失效账号不应作为域主，自动清空
        node.domainMaster = null;
        node.allianceId = null;
        await node.save();
        await syncDomainTitleProjectionFromNode(node);
      } else {
        return res.status(400).json({ error: '该知识域已有域主，无法申请' });
      }
    }

    const owner = await User.findById(node.owner).select('role');
    if (!owner || owner.role !== 'admin') {
      return res.status(400).json({ error: '该知识域不支持域主申请' });
    }

    const adminUsers = await User.find({ role: 'admin' }).select('_id username notifications');
    if (!adminUsers.length) {
      return res.status(400).json({ error: '系统当前无可处理申请的管理员' });
    }

    const hasPendingRequest = adminUsers.some((adminUser) => (adminUser.notifications || []).some((notification) => (
      notification.type === 'domain_master_apply' &&
      notification.status === 'pending' &&
      getIdString(notification.nodeId) === nodeId &&
      getIdString(notification.inviteeId) === requestUserId
    )));

    if (hasPendingRequest) {
      return res.status(409).json({ error: '你已提交过该知识域域主申请，请等待管理员处理' });
    }

    const applyNotificationDocs = [];
    for (const adminUser of adminUsers) {
      const applyNotification = pushNotificationToUser(adminUser, {
        type: 'domain_master_apply',
        title: `域主申请：${node.name}`,
        message: `${requester.username} 申请成为知识域「${node.name}」的域主`,
        read: false,
        status: 'pending',
        nodeId: node._id,
        nodeName: node.name,
        inviterId: requester._id,
        inviterUsername: requester.username,
        inviteeId: requester._id,
        inviteeUsername: requester.username,
        applicationReason: reason,
        createdAt: new Date()
      });
      await adminUser.save();
      if (applyNotification) {
        applyNotificationDocs.push(toCollectionNotificationDoc(adminUser._id, applyNotification));
      }
    }
    if (applyNotificationDocs.length > 0) {
      await writeNotificationsToCollection(applyNotificationDocs);
    }

    res.json({
      success: true,
      message: '域主申请已提交，等待管理员审核'
    });
  } catch (error) {
    console.error('申请成为域主错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 普通管理员申请卸任（提交给域主审批，3天超时自动同意）
router.post('/:nodeId/domain-admins/resign', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }

    const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }

    if (isDomainMaster(node, requestUserId)) {
      return res.status(400).json({ error: '域主无需申请卸任域相' });
    }

    if (!isDomainAdmin(node, requestUserId)) {
      return res.status(403).json({ error: '你不是该知识域域相' });
    }

    const requester = await User.findById(requestUserId).select('username role');
    if (!requester) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (requester.role !== 'common') {
      return res.status(403).json({ error: '仅普通用户可申请卸任域相' });
    }

    const domainMasterId = getIdString(node.domainMaster);
    if (!isValidObjectId(domainMasterId)) {
      node.domainAdmins = (node.domainAdmins || []).filter((adminId) => getIdString(adminId) !== requestUserId);
      await node.save();
      await syncDomainTitleProjectionFromNode(node);
      return res.json({
        success: true,
        message: '该知识域当前无域主，已自动卸任域相'
      });
    }

    const domainMaster = await User.findById(domainMasterId).select('username notifications');
    if (!domainMaster) {
      node.domainAdmins = (node.domainAdmins || []).filter((adminId) => getIdString(adminId) !== requestUserId);
      await node.save();
      await syncDomainTitleProjectionFromNode(node);
      return res.json({
        success: true,
        message: '域主信息缺失，已自动卸任域相'
      });
    }

    const hasPendingRequest = (domainMaster.notifications || []).some((notification) => (
      notification.type === 'domain_admin_resign_request' &&
      notification.status === 'pending' &&
      getIdString(notification.nodeId) === nodeId &&
      getIdString(notification.inviteeId) === requestUserId
    ));

    if (hasPendingRequest) {
      return res.status(409).json({ error: '你已提交过卸任申请，请等待域主处理' });
    }

    const resignRequestNotification = pushNotificationToUser(domainMaster, {
      type: 'domain_admin_resign_request',
      title: `域相卸任申请：${node.name}`,
      message: `${requester.username} 申请卸任知识域「${node.name}」域相`,
      read: false,
      status: 'pending',
      nodeId: node._id,
      nodeName: node.name,
      inviteeId: requester._id,
      inviteeUsername: requester.username,
      createdAt: new Date()
    });
    await domainMaster.save();
    await writeNotificationsToCollection([
      toCollectionNotificationDoc(domainMaster._id, resignRequestNotification)
    ]);

    res.json({
      success: true,
      message: '卸任申请已提交给域主，3天内未处理将自动同意'
    });
  } catch (error) {
    console.error('申请卸任域相错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取知识域域相列表（域主可编辑，其他域相只读）
router.get('/:nodeId/domain-admins', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('name domainMaster domainAdmins');

    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    await hydrateNodeTitleStatesForNodes([node], {
      includeDefenseLayout: true,
      includeSiegeState: false
    });

    const currentUser = await User.findById(requestUserId).select('role');
    if (!currentUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const isSystemAdmin = currentUser.role === 'admin';
    const canEdit = isDomainMaster(node, requestUserId);
    const canView = canEdit || isDomainAdmin(node, requestUserId) || isSystemAdmin;

    if (!canView) {
      return res.status(403).json({ error: '无权限查看该知识域域相' });
    }

    const domainMasterId = getIdString(node.domainMaster);
    const domainAdminIds = (node.domainAdmins || [])
      .map((adminId) => getIdString(adminId))
      .filter((adminId) => isValidObjectId(adminId));

    const relatedUserIds = Array.from(new Set([domainMasterId, ...domainAdminIds].filter((id) => isValidObjectId(id))));
    const relatedUsers = relatedUserIds.length > 0
      ? await User.find({ _id: { $in: relatedUserIds } }).select('_id username profession role').lean()
      : [];
    const relatedUserMap = new Map(relatedUsers.map((userItem) => [getIdString(userItem._id), userItem]));

    const domainMasterUser = relatedUserMap.get(domainMasterId) || null;
    const admins = domainAdminIds
      .filter((adminId, index, arr) => adminId !== domainMasterId && arr.indexOf(adminId) === index)
      .map((adminId) => {
        const adminUser = relatedUserMap.get(adminId);
        if (!adminUser) return null;
        return {
          _id: getIdString(adminUser._id),
          username: adminUser.username,
          profession: adminUser.profession,
          role: adminUser.role
        };
      })
      .filter(Boolean);
    const defenseLayout = resolveNodeDefenseLayout(node, {});
    const gateDefenseViewerAdminIds = normalizeGateDefenseViewerAdminIds(
      defenseLayout?.gateDefenseViewAdminIds,
      domainAdminIds
    );

    let pendingInvites = [];
    if (canEdit) {
      const pendingInviteUsers = await User.find({
        notifications: {
          $elemMatch: {
            type: 'domain_admin_invite',
            status: 'pending',
            nodeId: node._id,
            inviterId: requestUserId
          }
        }
      }).select('_id username profession notifications');

      pendingInvites = pendingInviteUsers
        .map((userItem) => {
          const inviteeId = getIdString(userItem._id);
          if (!inviteeId || inviteeId === domainMasterId || domainAdminIds.includes(inviteeId)) {
            return null;
          }
          const matchedInvite = (userItem.notifications || [])
            .filter((notification) => (
              notification.type === 'domain_admin_invite'
              && notification.status === 'pending'
              && getIdString(notification.nodeId) === nodeId
              && getIdString(notification.inviterId) === requestUserId
            ))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
          if (!matchedInvite) return null;
          return {
            inviteeId,
            username: userItem.username,
            profession: userItem.profession || '',
            notificationId: getIdString(matchedInvite._id),
            createdAt: matchedInvite.createdAt
          };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const canResign = !canEdit && !isSystemAdmin && isDomainAdmin(node, requestUserId);
    let resignPending = false;
    if (canResign && isValidObjectId(domainMasterId)) {
      const domainMaster = await User.findById(domainMasterId).select('notifications');
      resignPending = !!(domainMaster?.notifications || []).some((notification) => (
        notification.type === 'domain_admin_resign_request' &&
        notification.status === 'pending' &&
        getIdString(notification.nodeId) === nodeId &&
        getIdString(notification.inviteeId) === requestUserId
      ));
    }

    res.json({
      success: true,
      canView,
      canEdit,
      isSystemAdmin,
      canResign,
      resignPending,
      nodeId: node._id,
      nodeName: node.name,
      domainMaster: domainMasterUser
        ? {
            _id: getIdString(domainMasterUser._id),
            username: domainMasterUser.username,
            profession: domainMasterUser.profession
          }
        : null,
      domainAdmins: admins,
      gateDefenseViewerAdminIds,
      pendingInvites
    });
  } catch (error) {
    console.error('获取知识域域相错误:', error);
    if (error?.name === 'CastError') {
      return res.status(400).json({ error: '数据格式错误，请检查用户或知识域数据' });
    }
    res.status(500).json({ error: `服务器错误: ${error?.name || 'Error'} ${error?.message || ''}`.trim() });
  }
});

// 域主搜索普通用户（用于邀请域相）
router.get('/:nodeId/domain-admins/search-users', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { keyword = '' } = req.query;
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('domainMaster domainAdmins');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    if (!isDomainMaster(node, req.user.userId)) {
      return res.status(403).json({ error: '只有域主可以邀请域相' });
    }

    const excludedIds = [getIdString(node.domainMaster), ...(node.domainAdmins || []).map((id) => getIdString(id))]
      .filter((id) => isValidObjectId(id));

    const query = {
      role: 'common',
      _id: { $nin: excludedIds },
      notifications: {
        $not: {
          $elemMatch: {
            type: 'domain_admin_invite',
            status: 'pending',
            nodeId: node._id,
            inviterId: req.user.userId
          }
        }
      }
    };

    if (keyword.trim()) {
      query.username = { $regex: keyword.trim(), $options: 'i' };
    }

    const users = await User.find(query)
      .select('_id username profession role')
      .sort({ username: 1 })
      .limit(20);

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('搜索知识域域相候选用户错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 域主邀请普通用户成为知识域域相
router.post('/:nodeId/domain-admins/invite', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { username } = req.body;
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    if (!normalizedUsername) {
      return res.status(400).json({ error: '用户名不能为空' });
    }

    const node = await Node.findById(nodeId).select('name domainMaster domainAdmins');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    if (!isDomainMaster(node, req.user.userId)) {
      return res.status(403).json({ error: '只有域主可以邀请域相' });
    }

    const inviter = await User.findById(req.user.userId).select('username');
    if (!inviter) {
      return res.status(404).json({ error: '邀请人不存在' });
    }

    const invitee = await User.findOne({ username: normalizedUsername, role: 'common' });
    if (!invitee) {
      return res.status(404).json({ error: '未找到可邀请的普通用户' });
    }

    if (invitee._id.toString() === req.user.userId) {
      return res.status(400).json({ error: '不能邀请自己' });
    }

    if (isDomainAdmin(node, invitee._id.toString())) {
      return res.status(400).json({ error: '该用户已经是此知识域域相' });
    }

    const hasPendingInvite = (invitee.notifications || []).some((notification) => (
      notification.type === 'domain_admin_invite' &&
      notification.status === 'pending' &&
      notification.nodeId &&
      notification.nodeId.toString() === node._id.toString()
    ));

    if (hasPendingInvite) {
      return res.status(409).json({ error: '该用户已有待处理邀请' });
    }

    const inviteNotificationDoc = pushNotificationToUser(invitee, {
      type: 'domain_admin_invite',
      title: `域相邀请：${node.name}`,
      message: `${inviter.username} 邀请你成为知识域「${node.name}」的域相`,
      read: false,
      status: 'pending',
      nodeId: node._id,
      nodeName: node.name,
      inviterId: inviter._id,
      inviterUsername: inviter.username
    });
    await invitee.save();
    await writeNotificationsToCollection([
      toCollectionNotificationDoc(invitee._id, inviteNotificationDoc)
    ]);

    res.json({
      success: true,
      message: `已向 ${invitee.username} 发出邀请`
    });
  } catch (error) {
    console.error('邀请知识域域相错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 域主撤销待处理域相邀请
router.post('/:nodeId/domain-admins/invite/:notificationId/revoke', authenticateToken, async (req, res) => {
  try {
    const { nodeId, notificationId } = req.params;
    const inviterId = getIdString(req?.user?.userId);
    if (!isValidObjectId(nodeId) || !isValidObjectId(notificationId)) {
      return res.status(400).json({ error: '无效的知识域或邀请ID' });
    }

    const node = await Node.findById(nodeId).select('name domainMaster');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (!isDomainMaster(node, inviterId)) {
      return res.status(403).json({ error: '只有域主可以撤销域相邀请' });
    }

    const inviter = await User.findById(inviterId).select('_id username');
    if (!inviter) {
      return res.status(404).json({ error: '邀请人不存在' });
    }

    const invitee = await User.findOne({
      notifications: {
        $elemMatch: {
          _id: notificationId,
          type: 'domain_admin_invite',
          status: 'pending',
          nodeId: node._id,
          inviterId: inviter._id
        }
      }
    }).select('_id username notifications');

    if (!invitee) {
      return res.status(404).json({ error: '该邀请不存在或已处理，无法撤销' });
    }

    const inviteNotification = invitee.notifications.id(notificationId);
    if (!inviteNotification || inviteNotification.status !== 'pending') {
      return res.status(404).json({ error: '该邀请不存在或已处理，无法撤销' });
    }

    inviteNotification.status = 'rejected';
    inviteNotification.read = false;
    inviteNotification.title = `域相邀请已撤销：${node.name}`;
    inviteNotification.message = `${inviter.username} 已撤销你在知识域「${node.name}」的域相邀请`;
    inviteNotification.respondedAt = new Date();
    await invitee.save();
    await upsertNotificationsToCollection([
      toCollectionNotificationDoc(invitee._id, inviteNotification)
    ]);

    res.json({
      success: true,
      message: `已撤销对 ${invitee.username} 的邀请`
    });
  } catch (error) {
    console.error('撤销域相邀请错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 域主移除知识域域相
router.delete('/:nodeId/domain-admins/:adminUserId', authenticateToken, async (req, res) => {
  try {
    const { nodeId, adminUserId } = req.params;
    if (!isValidObjectId(nodeId) || !isValidObjectId(adminUserId)) {
      return res.status(400).json({ error: '无效的用户或知识域ID' });
    }

    const node = await Node.findById(nodeId).select('name domainMaster domainAdmins');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    if (!isDomainMaster(node, req.user.userId)) {
      return res.status(403).json({ error: '只有域主可以编辑域相' });
    }

    if (node.domainMaster && node.domainMaster.toString() === adminUserId) {
      return res.status(400).json({ error: '不能移除域主' });
    }

    if (!isDomainAdmin(node, adminUserId)) {
      return res.status(404).json({ error: '该用户不是此知识域域相' });
    }

    node.domainAdmins = (node.domainAdmins || []).filter((id) => id.toString() !== adminUserId);
    await node.save();
    await syncDomainTitleProjectionFromNode(node);

    res.json({
      success: true,
      message: '已移除知识域域相'
    });
  } catch (error) {
    console.error('移除知识域域相错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 域主配置可查看承口/启口兵力的域相
router.put('/:nodeId/domain-admins/gate-defense-viewers', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    await hydrateNodeTitleStatesForNodes([node], {
      includeDefenseLayout: true,
      includeSiegeState: false
    });
    if (!isDomainMaster(node, requestUserId)) {
      return res.status(403).json({ error: '只有域主可以配置承口/启口可查看权限' });
    }

    const viewerAdminIds = normalizeGateDefenseViewerAdminIds(
      req.body?.viewerAdminIds,
      (node.domainAdmins || []).map((id) => getIdString(id))
    );

    const currentLayout = serializeDefenseLayout(resolveNodeDefenseLayout(node, {}));
    const nextLayout = {
      ...currentLayout,
      gateDefenseViewAdminIds: viewerAdminIds,
      updatedAt: new Date()
    };
    await upsertNodeDefenseLayout({
      nodeId: node._id,
      layout: nextLayout,
      actorUserId: requestUserId
    });

    res.json({
      success: true,
      message: '承口/启口可查看权限已保存',
      gateDefenseViewerAdminIds: viewerAdminIds
    });
  } catch (error) {
    console.error('保存承口/启口可查看权限错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取情报窃取状态（是否可执行 + 最近快照）
router.get('/:nodeId/intel-heist', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const [node, user] = await Promise.all([
      Node.findById(nodeId).select('name status domainMaster domainAdmins'),
      User.findById(requestUserId).select('role location intelDomainSnapshots')
    ]);

    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    await hydrateNodeTitleStatesForNodes([node], {
      includeDefenseLayout: true,
      includeSiegeState: false
    });
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const permission = checkIntelHeistPermission({ node, user });
    const latestSnapshot = findUserIntelSnapshotByNodeId(user, node._id);

    res.json({
      success: true,
      nodeId: getIdString(node._id),
      nodeName: node.name,
      canSteal: permission.allowed,
      reason: permission.reason || '',
      latestSnapshot: latestSnapshot ? serializeIntelSnapshot(latestSnapshot) : null
    });
  } catch (error) {
    console.error('获取情报窃取状态错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 执行建筑搜索并判断是否找到情报文件
router.post('/:nodeId/intel-heist/scan', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const buildingId = typeof req.body?.buildingId === 'string' ? req.body.buildingId.trim() : '';
    if (!buildingId) {
      return res.status(400).json({ error: '建筑ID不能为空' });
    }

    const [node, user] = await Promise.all([
      Node.findById(nodeId).select('name status domainMaster domainAdmins'),
      User.findById(requestUserId).select('role location intelDomainSnapshots')
    ]);
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    await hydrateNodeTitleStatesForNodes([node], {
      includeDefenseLayout: true,
      includeSiegeState: false
    });
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const permission = checkIntelHeistPermission({ node, user });
    if (!permission.allowed) {
      return res.status(403).json({ error: permission.reason || '当前不可执行情报窃取' });
    }

    const defenseLayout = resolveNodeDefenseLayout(node, {});
    const serializedLayout = serializeDefenseLayout(defenseLayout);
    const buildings = Array.isArray(serializedLayout.buildings) ? serializedLayout.buildings : [];
    const targetBuilding = buildings.find((item) => item.buildingId === buildingId);
    if (!targetBuilding) {
      return res.status(400).json({ error: '目标建筑不存在' });
    }

    const found = serializedLayout.intelBuildingId === buildingId;
    if (!found) {
      return res.json({
        success: true,
        found: false,
        message: '该建筑未发现情报文件'
      });
    }

    const unitTypes = await fetchArmyUnitTypes();
    const unitTypeMap = new Map(
      (Array.isArray(unitTypes) ? unitTypes : [])
        .map((item) => [item?.id || item?.unitTypeId, item])
        .filter(([id]) => !!id)
    );
    const snapshotData = {
      nodeId: node._id,
      nodeName: node.name,
      sourceBuildingId: buildingId,
      deploymentUpdatedAt: defenseLayout?.updatedAt || null,
      capturedAt: new Date(),
      gateDefense: buildIntelGateDefenseSnapshot(serializedLayout.gateDefense, unitTypeMap)
    };

    const targetNodeId = getIdString(node._id);
    const snapshotStore = normalizeUserIntelSnapshotStore(user.intelDomainSnapshots, USER_INTEL_SNAPSHOT_LIMIT);
    snapshotStore[targetNodeId] = serializeIntelSnapshot(snapshotData);
    user.intelDomainSnapshots = normalizeUserIntelSnapshotStore(snapshotStore, USER_INTEL_SNAPSHOT_LIMIT);
    await user.save();

    const latestSnapshot = findUserIntelSnapshotByNodeId(user, targetNodeId);
    res.json({
      success: true,
      found: true,
      message: `已找到知识域「${node.name}」的情报文件`,
      snapshot: latestSnapshot ? serializeIntelSnapshot(latestSnapshot) : serializeIntelSnapshot(snapshotData)
    });
  } catch (error) {
    console.error('执行情报窃取建筑搜索错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取知识域城防建筑配置（域主可编辑）
router.get('/:nodeId/defense-layout', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    await hydrateNodeTitleStatesForNodes([node], {
      includeDefenseLayout: true,
      includeSiegeState: false
    });

    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }

    const canEdit = isDomainMaster(node, requestUserId);
    const defenseLayout = resolveNodeDefenseLayout(node, {});
    const gateDefenseViewerAdminIds = normalizeGateDefenseViewerAdminIds(
      defenseLayout?.gateDefenseViewAdminIds,
      (node.domainAdmins || []).map((id) => getIdString(id))
    );
    const canViewGateDefense = canEdit || gateDefenseViewerAdminIds.includes(requestUserId);
    const serializedLayout = serializeDefenseLayout(defenseLayout);
    const layout = {
      ...serializedLayout,
      intelBuildingId: canEdit ? serializedLayout.intelBuildingId : '',
      gateDefense: canViewGateDefense
        ? serializedLayout.gateDefense
        : { cheng: [], qi: [] },
      gateDefenseViewAdminIds: canEdit ? gateDefenseViewerAdminIds : []
    };

    res.json({
      success: true,
      nodeId: getIdString(node._id),
      nodeName: node.name,
      canEdit,
      canViewGateDefense,
      gateDefenseViewerAdminIds: canEdit ? gateDefenseViewerAdminIds : [],
      maxBuildings: CITY_BUILDING_LIMIT,
      minBuildings: 1,
      layout
    });
  } catch (error) {
    console.error('获取知识域城防配置错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 保存知识域城防建筑配置（仅域主）
router.put('/:nodeId/defense-layout', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    await hydrateNodeTitleStatesForNodes([node], {
      includeDefenseLayout: true,
      includeSiegeState: false
    });

    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isDomainMaster(node, requestUserId)) {
      return res.status(403).json({ error: '只有域主可以保存城防配置' });
    }

    const payload = req.body?.layout && typeof req.body.layout === 'object'
      ? req.body.layout
      : req.body;
    const normalizedLayout = normalizeDefenseLayoutInput(payload || {});

    const requestUser = await User.findById(requestUserId).select('armyRoster');
    if (!requestUser) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const rosterCountMap = new Map(
      (Array.isArray(requestUser.armyRoster) ? requestUser.armyRoster : [])
        .map((entry) => ([
          typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
          Math.max(0, Math.floor(Number(entry?.count) || 0))
        ]))
        .filter(([unitTypeId]) => !!unitTypeId)
    );
    const deployedCountMap = new Map();
    CITY_GATE_KEYS.forEach((key) => {
      const entries = Array.isArray(normalizedLayout?.gateDefense?.[key]) ? normalizedLayout.gateDefense[key] : [];
      entries.forEach((entry) => {
        const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
        const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
        if (!unitTypeId || count <= 0) return;
        deployedCountMap.set(unitTypeId, (deployedCountMap.get(unitTypeId) || 0) + count);
      });
    });
    for (const [unitTypeId, deployedCount] of deployedCountMap.entries()) {
      const rosterCount = rosterCountMap.get(unitTypeId) || 0;
      if (deployedCount > rosterCount) {
        return res.status(400).json({
          error: `兵力布防超出可用数量：${unitTypeId} 可用 ${rosterCount}，布防 ${deployedCount}`
        });
      }
    }

    const payloadHasViewerIds = Array.isArray(payload?.gateDefenseViewAdminIds);
    const defenseLayout = resolveNodeDefenseLayout(node, {});
    const existingViewerAdminIds = normalizeGateDefenseViewerAdminIds(
      defenseLayout?.gateDefenseViewAdminIds,
      (node.domainAdmins || []).map((id) => getIdString(id))
    );
    const nextViewerAdminIds = payloadHasViewerIds
      ? normalizeGateDefenseViewerAdminIds(normalizedLayout.gateDefenseViewAdminIds, (node.domainAdmins || []).map((id) => getIdString(id)))
      : existingViewerAdminIds;

    const nextLayout = {
      ...normalizedLayout,
      gateDefenseViewAdminIds: nextViewerAdminIds,
      updatedAt: new Date()
    };
    await upsertNodeDefenseLayout({
      nodeId: node._id,
      layout: nextLayout,
      actorUserId: requestUserId
    });

    res.json({
      success: true,
      message: '城防配置已保存',
      nodeId: getIdString(node._id),
      layout: serializeDefenseLayout(nextLayout),
      maxBuildings: CITY_BUILDING_LIMIT,
      minBuildings: 1
    });
  } catch (error) {
    console.error('保存知识域城防配置错误:', error);
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message || '请求参数错误' });
    }
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取知识域围城状态（攻占/围城/支援信息）
router.get('/:nodeId/siege', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const [node, user, unitTypes] = await Promise.all([
      Node.findById(nodeId).select('name status domainMaster domainAdmins relatedParentDomains relatedChildDomains'),
      User.findById(requestUserId).select('username role location allianceId armyRoster intelDomainSnapshots lastArrivedFromNodeId lastArrivedFromNodeName'),
      fetchArmyUnitTypes()
    ]);

    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (user.role !== 'common') {
      return res.status(403).json({ error: '仅普通用户可查看围城状态' });
    }
    await hydrateNodeTitleStatesForNodes([node], {
      includeDefenseLayout: true,
      includeSiegeState: true
    });

    const settled = settleNodeSiegeState(node, new Date());
    if (settled.changed) {
      await upsertNodeSiegeState({
        nodeId: node._id,
        siegeState: settled.siegeState,
        actorUserId: requestUserId
      });
    }

    const intelSnapshotRaw = findUserIntelSnapshotByNodeId(user, node._id);
    const intelSnapshot = intelSnapshotRaw ? serializeIntelSnapshot(intelSnapshotRaw) : null;
    const payload = buildSiegePayloadForUser({
      node,
      user,
      unitTypes,
      intelSnapshot
    });

    return res.json({
      success: true,
      ...payload
    });
  } catch (error) {
    console.error('获取围城状态错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 发起围城（攻占知识域）
router.post('/:nodeId/siege/start', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const [node, user, unitTypes] = await Promise.all([
      Node.findById(nodeId).select('name status domainMaster domainAdmins relatedParentDomains relatedChildDomains'),
      User.findById(requestUserId).select('username role location allianceId armyRoster intelDomainSnapshots lastArrivedFromNodeId lastArrivedFromNodeName'),
      fetchArmyUnitTypes()
    ]);
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (user.role !== 'common') {
      return res.status(403).json({ error: '仅普通用户可发起围城' });
    }
    if (isDomainMaster(node, requestUserId) || isDomainAdmin(node, requestUserId)) {
      return res.status(403).json({ error: '域主/域相不可发起围城' });
    }
    if ((user.location || '').trim() !== (node.name || '')) {
      return res.status(403).json({ error: '需先抵达该知识域后才能发起围城' });
    }
    await hydrateNodeTitleStatesForNodes([node], {
      includeDefenseLayout: true,
      includeSiegeState: true
    });

    const settled = settleNodeSiegeState(node, new Date());
    if (settled.changed) {
      await upsertNodeSiegeState({
        nodeId: node._id,
        siegeState: settled.siegeState,
        actorUserId: requestUserId
      });
    }

    const gateKey = resolveAttackGateByArrival(node, user);
    if (!gateKey) {
      return res.status(400).json({ error: '无法判定围攻门向，请从相邻知识域移动后再试' });
    }
    if (!isGateEnabledForNode(node, gateKey)) {
      return res.status(400).json({ error: '该门当前不可用，无法发起围城' });
    }

    const roster = normalizeUserRoster(user.armyRoster, unitTypes);
    const unitMap = buildArmyUnitTypeMap(unitTypes);
    const ownUnitEntries = mapToUnitCountEntries(buildUnitCountMap(roster), unitMap);
    const ownTotalCount = ownUnitEntries.reduce((sum, item) => sum + item.count, 0);
    if (ownTotalCount <= 0) {
      return res.status(400).json({ error: '至少需要拥有一名兵力' });
    }

    const gateState = getNodeGateState(node, gateKey);
    const activeAttackers = (gateState.attackers || []).filter((item) => isSiegeAttackerActive(item));
    if (activeAttackers.length > 0) {
      const sameAlliance = isSameAlliance(gateState.attackerAllianceId, user.allianceId);
      if (!sameAlliance) {
        return res.status(409).json({ error: '该门已被其他势力围城' });
      }
      return res.status(409).json({ error: '该门已在围城中，可通过支援加入' });
    }

    const now = new Date();
    const normalizedOwnUnits = normalizeUnitCountEntries(ownUnitEntries);
    const fromNodeId = user.lastArrivedFromNodeId || null;
    const fromNodeName = (user.lastArrivedFromNodeName || '').trim();
    const workingSiegeState = getMutableNodeSiegeState(node);

    const nextAttackers = Array.isArray(workingSiegeState?.[gateKey]?.attackers)
      ? workingSiegeState[gateKey].attackers.filter((item) => getIdString(item?.userId) !== requestUserId)
      : [];
    nextAttackers.push({
      userId: user._id,
      username: user.username || '',
      allianceId: user.allianceId || null,
      units: normalizedOwnUnits,
      fromNodeId,
      fromNodeName,
      autoRetreatPercent: 40,
      status: 'sieging',
      isInitiator: true,
      isReinforcement: false,
      requestedAt: now,
      arriveAt: now,
      joinedAt: now,
      updatedAt: now
    });

    workingSiegeState[gateKey] = {
      ...(workingSiegeState?.[gateKey] || {}),
      active: true,
      startedAt: workingSiegeState?.[gateKey]?.startedAt || now,
      updatedAt: now,
      attackerAllianceId: user.allianceId || null,
      initiatorUserId: user._id,
      initiatorUsername: user.username || '',
      attackers: nextAttackers
    };
    await upsertNodeSiegeState({
      nodeId: node._id,
      siegeState: workingSiegeState,
      actorUserId: requestUserId
    });

    const intelSnapshotRaw = findUserIntelSnapshotByNodeId(user, node._id);
    const intelSnapshot = intelSnapshotRaw ? serializeIntelSnapshot(intelSnapshotRaw) : null;
    const payload = buildSiegePayloadForUser({
      node,
      user,
      unitTypes,
      intelSnapshot
    });

    return res.json({
      success: true,
      message: `已在${CITY_GATE_LABELS[gateKey] || gateKey}发起围城`,
      ...payload
    });
  } catch (error) {
    console.error('发起围城错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 围城发起者呼叫熵盟支援
router.post('/:nodeId/siege/request-support', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const [node, user, unitTypes] = await Promise.all([
      Node.findById(nodeId).select('name status'),
      User.findById(requestUserId).select('username role allianceId armyRoster intelDomainSnapshots'),
      fetchArmyUnitTypes()
    ]);

    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (user.role !== 'common') {
      return res.status(403).json({ error: '仅普通用户可呼叫支援' });
    }
    const requestAllianceId = getIdString(user.allianceId);
    if (!requestAllianceId) {
      return res.status(400).json({ error: '未加入熵盟，无法呼叫支援' });
    }
    await hydrateNodeTitleStatesForNodes([node], {
      includeDefenseLayout: false,
      includeSiegeState: true
    });

    const settled = settleNodeSiegeState(node, new Date());
    if (settled.changed) {
      await upsertNodeSiegeState({
        nodeId: node._id,
        siegeState: settled.siegeState,
        actorUserId: requestUserId
      });
    }

    let targetGateKey = '';
    for (const gateKey of CITY_GATE_KEYS) {
      const gateSummary = buildSiegeGateSummary(node, gateKey, buildArmyUnitTypeMap(unitTypes));
      if (!gateSummary.active) continue;
      const matched = gateSummary.activeAttackers.find((item) => item.userId === requestUserId && item.isInitiator);
      if (!matched) continue;
      targetGateKey = gateKey;
      break;
    }
    if (!targetGateKey) {
      return res.status(403).json({ error: '仅围城发起者可呼叫熵盟支援' });
    }

    const now = new Date();
    const workingSiegeState = getMutableNodeSiegeState(node);
    workingSiegeState[targetGateKey] = {
      ...(workingSiegeState[targetGateKey] || createEmptySiegeGateState()),
      supportNotifiedAt: now,
      updatedAt: now
    };
    await upsertNodeSiegeState({
      nodeId: node._id,
      siegeState: workingSiegeState,
      actorUserId: requestUserId
    });

    const notifyMessage = `熵盟成员 ${user.username} 在知识域「${node.name}」${CITY_GATE_LABELS[targetGateKey]}发起围城，点击可查看并支援`;
    const memberQuery = {
      _id: { $ne: user._id },
      role: 'common',
      allianceId: user.allianceId
    };
    const memberCursor = User.find(memberQuery).select('_id').lean().cursor();

    let notifiedCount = 0;
    let supportNotificationDocs = [];
    for await (const member of memberCursor) {
      const supportNotification = buildNotificationPayload({
        type: 'info',
        title: `围城支援请求：${node.name}`,
        message: notifyMessage,
        read: false,
        status: 'info',
        nodeId: node._id,
        nodeName: node.name,
        allianceId: user.allianceId || null,
        allianceName: '',
        inviterId: user._id,
        inviterUsername: user.username || '',
        inviteeId: member._id,
        inviteeUsername: '',
        createdAt: now
      });
      supportNotificationDocs.push(toCollectionNotificationDoc(member._id, supportNotification));
      if (supportNotificationDocs.length >= 1000) {
        await writeNotificationsToCollection(supportNotificationDocs);
        notifiedCount += supportNotificationDocs.length;
        supportNotificationDocs = [];
      }
    }
    if (supportNotificationDocs.length > 0) {
      await writeNotificationsToCollection(supportNotificationDocs);
      notifiedCount += supportNotificationDocs.length;
    }

    const intelSnapshotRaw = findUserIntelSnapshotByNodeId(user, node._id);
    const intelSnapshot = intelSnapshotRaw ? serializeIntelSnapshot(intelSnapshotRaw) : null;
    const payload = buildSiegePayloadForUser({
      node,
      user,
      unitTypes,
      intelSnapshot
    });

    return res.json({
      success: true,
      message: `已呼叫熵盟支援（通知 ${notifiedCount} 人）`,
      ...payload
    });
  } catch (error) {
    console.error('呼叫围城支援错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 熵盟成员支援同一战场
router.post('/:nodeId/siege/support', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const gateKeyRaw = typeof req.body?.gateKey === 'string' ? req.body.gateKey.trim() : '';
    const gateKey = CITY_GATE_KEYS.includes(gateKeyRaw) ? gateKeyRaw : '';
    const autoRetreatPercentRaw = Number(req.body?.autoRetreatPercent);
    const autoRetreatPercent = Math.max(1, Math.min(99, Math.floor(Number.isFinite(autoRetreatPercentRaw) ? autoRetreatPercentRaw : 40)));
    const rawUnits = Array.isArray(req.body?.units)
      ? req.body.units
      : (Array.isArray(req.body?.items) ? req.body.items : []);

    const normalizedUnits = normalizeUnitCountEntries(rawUnits.map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
      count: Number(entry?.count ?? entry?.qty)
    })));
    if (normalizedUnits.length === 0) {
      return res.status(400).json({ error: '请至少选择一支兵种和数量' });
    }

    const [node, user, unitTypes] = await Promise.all([
      Node.findById(nodeId).select('name status domainMaster domainAdmins relatedParentDomains relatedChildDomains'),
      User.findById(requestUserId).select('username role location allianceId armyRoster intelDomainSnapshots'),
      fetchArmyUnitTypes()
    ]);
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (user.role !== 'common') {
      return res.status(403).json({ error: '仅普通用户可派遣支援' });
    }
    if (isDomainMaster(node, requestUserId) || isDomainAdmin(node, requestUserId)) {
      return res.status(403).json({ error: '域主/域相不可支援攻占自己管理的知识域' });
    }

    const userAllianceId = getIdString(user.allianceId);
    if (!userAllianceId) {
      return res.status(403).json({ error: '未加入熵盟，无法支援同盟战场' });
    }
    await hydrateNodeTitleStatesForNodes([node], {
      includeDefenseLayout: true,
      includeSiegeState: true
    });

    const settled = settleNodeSiegeState(node, new Date());
    if (settled.changed) {
      await upsertNodeSiegeState({
        nodeId: node._id,
        siegeState: settled.siegeState,
        actorUserId: requestUserId
      });
    }

    const unitTypeMap = buildArmyUnitTypeMap(unitTypes);
    for (const unitEntry of normalizedUnits) {
      if (!unitTypeMap.has(unitEntry.unitTypeId)) {
        return res.status(400).json({ error: `无效兵种：${unitEntry.unitTypeId}` });
      }
    }

    const gateSummaries = CITY_GATE_KEYS.reduce((acc, itemGateKey) => {
      acc[itemGateKey] = buildSiegeGateSummary(node, itemGateKey, unitTypeMap);
      return acc;
    }, { cheng: null, qi: null });
    const sameAllianceActiveGates = CITY_GATE_KEYS.filter((itemGateKey) => (
      gateSummaries[itemGateKey]?.active
      && isSameAlliance(gateSummaries[itemGateKey]?.attackerAllianceId, userAllianceId)
    ));

    const targetGateKey = gateKey && sameAllianceActiveGates.includes(gateKey)
      ? gateKey
      : sameAllianceActiveGates[0];
    if (!targetGateKey) {
      return res.status(400).json({ error: '当前不存在可支援的同盟围城战场' });
    }
    if (gateSummaries[targetGateKey].activeAttackers.some((item) => item.userId === requestUserId)) {
      return res.status(400).json({ error: '你已在该战场中，不能重复派遣' });
    }

    const roster = normalizeUserRoster(user.armyRoster, unitTypes);
    const rosterMap = buildUnitCountMap(roster);
    const committedNodes = isDomainTitleStateCollectionReadEnabled()
      ? (await listSiegeStatesByAttackerUserId(user._id, { select: 'nodeId cheng qi' }))
        .map((row) => ({
          _id: row?.nodeId || null,
          __titleStateCollection: {
            citySiegeState: {
              cheng: row?.cheng || createEmptySiegeGateState(),
              qi: row?.qi || createEmptySiegeGateState()
            }
          }
        }))
      : await Node.find({
        status: 'approved',
        $or: [
          { 'citySiegeState.cheng.attackers.userId': user._id },
          { 'citySiegeState.qi.attackers.userId': user._id }
        ]
      }).select('citySiegeState');
    let committedMap = new Map();
    committedNodes.forEach((itemNode) => {
      CITY_GATE_KEYS.forEach((itemGateKey) => {
        const gateState = getNodeGateState(itemNode, itemGateKey);
        (gateState.attackers || []).forEach((attacker) => {
          if (getIdString(attacker?.userId) !== requestUserId) return;
          if (!isSiegeAttackerActive(attacker)) return;
          committedMap = mergeUnitCountMaps(committedMap, buildUnitCountMap(attacker?.units || []));
        });
      });
    });
    const dispatchMap = buildUnitCountMap(normalizedUnits);
    for (const [unitTypeId, dispatchCount] of dispatchMap.entries()) {
      const totalOwned = rosterMap.get(unitTypeId) || 0;
      const committed = committedMap.get(unitTypeId) || 0;
      const available = Math.max(0, totalOwned - committed);
      if (dispatchCount > available) {
        const unitName = unitTypeMap.get(unitTypeId)?.name || unitTypeId;
        return res.status(400).json({
          error: `${unitName} 可派遣数量不足：可用 ${available}，请求 ${dispatchCount}`
        });
      }
    }

    const currentLocationName = (user.location || '').trim();
    const startNodes = await listApprovedNodesByNames([currentLocationName], { select: '_id name' });
    if (startNodes.length === 0) {
      return res.status(400).json({ error: '当前所在知识域无效，无法派遣支援' });
    }

    const sideNameSet = new Set(
      (targetGateKey === 'cheng' ? node.relatedParentDomains : node.relatedChildDomains)
        .filter((name) => typeof name === 'string' && !!name.trim())
    );
    const sideNames = Array.from(sideNameSet);
    const sideNodes = sideNames.length > 0
      ? await Node.find({
        status: 'approved',
        name: { $in: sideNames }
      }).select(
        isDomainTitleStateCollectionReadEnabled()
          ? '_id name'
          : '_id name citySiegeState'
      ).lean()
      : [];
    if (isDomainTitleStateCollectionReadEnabled()) {
      await hydrateNodeTitleStatesForNodes(sideNodes, {
        includeDefenseLayout: false,
        includeSiegeState: true
      });
    }
    if (sideNodes.length === 0) {
      return res.status(400).json({ error: `当前知识域无可用${CITY_GATE_LABELS[targetGateKey]}入口路径` });
    }

    const isBlockedByOtherAllianceSiege = (sideNode) => {
      if (!sideNode || typeof sideNode !== 'object') return true;
      for (const sideGateKey of CITY_GATE_KEYS) {
        const gateState = getNodeGateState(sideNode, sideGateKey);
        if (!gateState.active) continue;
        const siegeAllianceId = getIdString(gateState.attackerAllianceId);
        if (!siegeAllianceId) return true;
        if (siegeAllianceId !== userAllianceId) return true;
      }
      return false;
    };

    const availableSideNodes = sideNodes.filter((sideNode) => !isBlockedByOtherAllianceSiege(sideNode));
    if (availableSideNodes.length === 0) {
      return res.status(409).json({ error: `同侧路径已被封锁，当前无法支援${CITY_GATE_LABELS[targetGateKey]}` });
    }
    const shortestSupportPath = await findShortestApprovedPathToAnyTargets({
      startName: currentLocationName,
      targetNames: availableSideNodes.map((item) => item.name),
      maxDepth: 120,
      maxVisited: 300000
    });
    if (!shortestSupportPath.found || !Array.isArray(shortestSupportPath.pathNames) || shortestSupportPath.pathNames.length === 0) {
      return res.status(409).json({ error: `同侧路径已被封锁，当前无法支援${CITY_GATE_LABELS[targetGateKey]}` });
    }

    const pathNodes = await listApprovedNodesByNames(shortestSupportPath.pathNames, { select: '_id name' });
    const pathNodeByName = new Map(pathNodes.map((item) => [item?.name || '', item]));
    const normalizedPath = [];
    for (const nodeName of shortestSupportPath.pathNames) {
      const nodeRow = pathNodeByName.get(nodeName);
      if (!nodeRow?._id || !nodeRow?.name) {
        return res.status(409).json({ error: '路径计算结果失效，请重试' });
      }
      normalizedPath.push({
        nodeId: nodeRow._id,
        nodeName: nodeRow.name
      });
    }
    const matchedSideNode = availableSideNodes.find((item) => item.name === shortestSupportPath.targetName);
    if (!matchedSideNode) {
      return res.status(409).json({ error: '支援路径目标失效，请重试' });
    }
    const selectedSupportPath = {
      sideNodeId: getIdString(matchedSideNode._id),
      sideNodeName: matchedSideNode.name,
      path: normalizedPath,
      distanceUnits: (normalizedPath.length - 1) + 1
    };

    const now = new Date();
    const arriveAt = new Date(now.getTime() + (selectedSupportPath.distanceUnits * SIEGE_SUPPORT_UNIT_DURATION_SECONDS * 1000));
    const gateCurrent = getNodeGateState(node, targetGateKey);
    const nextAttackers = Array.isArray(gateCurrent.attackers)
      ? gateCurrent.attackers.filter((item) => getIdString(item?.userId) !== requestUserId)
      : [];

    nextAttackers.push({
      userId: user._id,
      username: user.username || '',
      allianceId: user.allianceId || null,
      units: normalizedUnits,
      fromNodeId: selectedSupportPath.path[0]?.nodeId || null,
      fromNodeName: currentLocationName,
      autoRetreatPercent,
      status: 'moving',
      isInitiator: false,
      isReinforcement: true,
      requestedAt: now,
      arriveAt,
      joinedAt: null,
      updatedAt: now
    });

    const workingSiegeState = getMutableNodeSiegeState(node);
    workingSiegeState[targetGateKey] = {
      ...(workingSiegeState?.[targetGateKey] || {}),
      active: true,
      startedAt: workingSiegeState?.[targetGateKey]?.startedAt || now,
      updatedAt: now,
      attackerAllianceId: workingSiegeState?.[targetGateKey]?.attackerAllianceId || user.allianceId || null,
      attackers: nextAttackers
    };
    await upsertNodeSiegeState({
      nodeId: node._id,
      siegeState: workingSiegeState,
      actorUserId: requestUserId
    });

    const initiatorUserId = getIdString(workingSiegeState?.[targetGateKey]?.initiatorUserId);
    if (isValidObjectId(initiatorUserId) && initiatorUserId !== requestUserId) {
      const initiatorUser = await User.findById(initiatorUserId).select('notifications');
      if (initiatorUser) {
        initiatorUser.notifications = Array.isArray(initiatorUser.notifications) ? initiatorUser.notifications : [];
        const initiatorNotification = pushNotificationToUser(initiatorUser, {
          type: 'info',
          title: `围城增援抵达路上：${node.name}`,
          message: `${user.username} 已派遣支援部队前往${CITY_GATE_LABELS[targetGateKey]}，预计 ${selectedSupportPath.distanceUnits * SIEGE_SUPPORT_UNIT_DURATION_SECONDS} 秒后到达`,
          read: false,
          status: 'info',
          nodeId: node._id,
          nodeName: node.name,
          allianceId: user.allianceId || null,
          allianceName: '',
          inviterId: user._id,
          inviterUsername: user.username || '',
          inviteeId: initiatorUser._id,
          inviteeUsername: '',
          createdAt: now
        });
        await initiatorUser.save();
        await writeNotificationsToCollection([
          toCollectionNotificationDoc(initiatorUser._id, initiatorNotification)
        ]);
      }
    }

    const intelSnapshotRaw = findUserIntelSnapshotByNodeId(user, node._id);
    const intelSnapshot = intelSnapshotRaw ? serializeIntelSnapshot(intelSnapshotRaw) : null;
    const payload = buildSiegePayloadForUser({
      node,
      user,
      unitTypes,
      intelSnapshot
    });

    return res.json({
      success: true,
      message: `已派遣支援前往${CITY_GATE_LABELS[targetGateKey]}`,
      supportTravel: {
        gateKey: targetGateKey,
        gateLabel: CITY_GATE_LABELS[targetGateKey],
        fromNodeName: currentLocationName,
        sideNodeName: selectedSupportPath.sideNodeName,
        distanceUnits: selectedSupportPath.distanceUnits,
        unitDurationSeconds: SIEGE_SUPPORT_UNIT_DURATION_SECONDS,
        arriveAt
      },
      ...payload
    });
  } catch (error) {
    console.error('派遣围城支援错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 围城发起者撤退并取消本门攻城（所有支援同步撤回）
router.post('/:nodeId/siege/retreat', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const [node, user, unitTypes] = await Promise.all([
      Node.findById(nodeId).select('name status'),
      User.findById(requestUserId).select('username role location allianceId armyRoster intelDomainSnapshots lastArrivedFromNodeId lastArrivedFromNodeName'),
      fetchArmyUnitTypes()
    ]);
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (user.role !== 'common') {
      return res.status(403).json({ error: '仅普通用户可执行撤退' });
    }
    await hydrateNodeTitleStatesForNodes([node], {
      includeDefenseLayout: false,
      includeSiegeState: true
    });

    const settled = settleNodeSiegeState(node, new Date());
    if (settled.changed) {
      await upsertNodeSiegeState({
        nodeId: node._id,
        siegeState: settled.siegeState,
        actorUserId: requestUserId
      });
    }

    let targetGateKey = '';
    let retreatCount = 0;
    for (const gateKey of CITY_GATE_KEYS) {
      const gateState = getNodeGateState(node, gateKey);
      if (!gateState.active) continue;
      const initiator = (gateState.attackers || []).find((attacker) => (
        getIdString(attacker?.userId) === requestUserId
        && isSiegeAttackerActive(attacker)
        && !!attacker?.isInitiator
      ));
      if (!initiator) continue;
      targetGateKey = gateKey;
      retreatCount = (gateState.attackers || []).filter((attacker) => isSiegeAttackerActive(attacker)).length;
      break;
    }

    if (!targetGateKey) {
      return res.status(403).json({ error: '仅围城发起者可撤退并取消攻城' });
    }

    const now = new Date();
    const workingSiegeState = getMutableNodeSiegeState(node);
    workingSiegeState[targetGateKey] = {
      ...createEmptySiegeGateState(),
      updatedAt: now
    };
    await upsertNodeSiegeState({
      nodeId: node._id,
      siegeState: workingSiegeState,
      actorUserId: requestUserId
    });

    const intelSnapshotRaw = findUserIntelSnapshotByNodeId(user, node._id);
    const intelSnapshot = intelSnapshotRaw ? serializeIntelSnapshot(intelSnapshotRaw) : null;
    const payload = buildSiegePayloadForUser({
      node,
      user,
      unitTypes,
      intelSnapshot
    });

    return res.json({
      success: true,
      message: `已在${CITY_GATE_LABELS[targetGateKey] || targetGateKey}撤退，攻城取消（撤回 ${retreatCount} 支部队）`,
      ...payload
    });
  } catch (error) {
    console.error('围城撤退错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 当前用户派遣中的围城支援状态
router.get('/me/siege-supports', authenticateToken, async (req, res) => {
  try {
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }

    let nodes = [];
    if (isDomainTitleStateCollectionReadEnabled()) {
      const siegeRows = await listSiegeStatesByAttackerUserId(requestUserId, {
        select: 'nodeId cheng qi'
      });
      const nodeIds = siegeRows
        .map((item) => item?.nodeId)
        .filter((item) => !!item);
      const nodeRows = nodeIds.length > 0
        ? await Node.find({
          _id: { $in: nodeIds },
          status: 'approved'
        }).select('_id name').lean()
        : [];
      const nodeNameMap = new Map(nodeRows.map((item) => [getIdString(item?._id), item?.name || '']));
      nodes = siegeRows
        .filter((item) => nodeNameMap.has(getIdString(item?.nodeId)))
        .map((item) => ({
          _id: item.nodeId,
          name: nodeNameMap.get(getIdString(item.nodeId)) || '',
          __titleStateCollection: {
            citySiegeState: {
              cheng: item?.cheng || createEmptySiegeGateState(),
              qi: item?.qi || createEmptySiegeGateState()
            }
          }
        }));
    } else {
      nodes = await Node.find({
        status: 'approved',
        $or: [
          { 'citySiegeState.cheng.attackers.userId': new mongoose.Types.ObjectId(requestUserId) },
          { 'citySiegeState.qi.attackers.userId': new mongoose.Types.ObjectId(requestUserId) }
        ]
      }).select('name citySiegeState');
    }
    const unitTypes = await fetchArmyUnitTypes();
    const unitTypeMap = buildArmyUnitTypeMap(unitTypes);
    const nowMs = Date.now();

    const rows = [];
    for (const node of nodes) {
      const settledLocal = settleNodeSiegeState(node, new Date(nowMs));
      if (settledLocal.changed) {
        await upsertNodeSiegeState({
          nodeId: node._id,
          siegeState: settledLocal.siegeState,
          actorUserId: requestUserId
        });
      }
      for (const gateKey of CITY_GATE_KEYS) {
        const gateState = getNodeGateState(node, gateKey);
        for (const attacker of (gateState.attackers || [])) {
          if (getIdString(attacker?.userId) !== requestUserId) continue;
          if (!isSiegeAttackerActive(attacker)) continue;
          const serialized = serializeSiegeAttacker(attacker, unitTypeMap, nowMs);
          rows.push({
            nodeId: getIdString(node._id),
            nodeName: node.name || '',
            gateKey,
            gateLabel: CITY_GATE_LABELS[gateKey] || gateKey,
            status: serialized.status,
            statusLabel: serialized.statusLabel,
            totalCount: serialized.totalCount,
            units: serialized.units,
            fromNodeName: serialized.fromNodeName,
            autoRetreatPercent: serialized.autoRetreatPercent,
            requestedAt: serialized.requestedAt,
            arriveAt: serialized.arriveAt,
            joinedAt: serialized.joinedAt,
            remainingSeconds: serialized.remainingSeconds
          });
        }
      }
    }

    rows.sort((a, b) => {
      const aTime = new Date(a.requestedAt || 0).getTime();
      const bTime = new Date(b.requestedAt || 0).getTime();
      return bTime - aTime;
    });

    return res.json({
      success: true,
      supports: rows
    });
  } catch (error) {
    console.error('获取围城支援状态错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 获取知识点分发规则（域主可编辑，域相/系统管理员可查看）
router.get('/:nodeId/distribution-settings', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    let node = await Node.findById(nodeId).select(
      'name status domainMaster domainAdmins knowledgePoint knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionActiveRuleId knowledgeDistributionScheduleSlots knowledgeDistributionLocked knowledgeDistributionCarryover'
    );
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (node.knowledgeDistributionLocked) {
      await KnowledgeDistributionService.processNode(node, new Date());
      node = await Node.findById(nodeId).select(
        'name status domainMaster domainAdmins knowledgePoint knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionActiveRuleId knowledgeDistributionScheduleSlots knowledgeDistributionLocked knowledgeDistributionCarryover'
      );
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
    }

    const currentUser = await User.findById(requestUserId).select('role');
    if (!currentUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const isSystemAdmin = currentUser.role === 'admin';
    const canEdit = isDomainMaster(node, requestUserId);
    const canView = canEdit || isDomainAdmin(node, requestUserId) || isSystemAdmin;
    if (!canView) {
      return res.status(403).json({ error: '无权限查看该知识域分发规则' });
    }

    const domainMasterId = getIdString(node.domainMaster);
    const { profiles, activeRuleId, scheduleSlots } = extractDistributionProfilesFromNode(node);
    const activeProfile = profiles.find((item) => item.profileId === activeRuleId) || profiles[0];
    const serializedProfiles = profiles.map((profile) => ({
      profileId: profile.profileId,
      name: profile.name,
      rule: serializeDistributionRule(profile.rule || {})
    }));
    const activeSerializedProfile = serializedProfiles.find((item) => item.profileId === activeRuleId) || serializedProfiles[0];
    const rulePayload = activeSerializedProfile?.rule || serializeDistributionRule(activeProfile?.rule || {});
    const lockPayload = serializeDistributionLock(node.knowledgeDistributionLocked || null);

    const relatedUserIds = new Set([
      ...serializedProfiles.flatMap((profile) => profile.rule.adminPercents.map((item) => item.userId)),
      ...serializedProfiles.flatMap((profile) => profile.rule.customUserPercents.map((item) => item.userId)),
      ...serializedProfiles.flatMap((profile) => profile.rule.blacklistUserIds),
      domainMasterId,
      ...(Array.isArray(node.domainAdmins) ? node.domainAdmins.map((id) => getIdString(id)) : [])
    ].filter((id) => isValidObjectId(id)));
    const relatedAllianceIds = new Set([
      ...profiles.flatMap((profile) => serializeDistributionRule(profile.rule || {}).specificAlliancePercents.map((item) => item.allianceId)),
      ...profiles.flatMap((profile) => serializeDistributionRule(profile.rule || {}).blacklistAllianceIds),
      ...(lockPayload?.enemyAllianceIds || [])
    ].filter((id) => isValidObjectId(id)));

    const [relatedUsers, masterUser] = await Promise.all([
      relatedUserIds.size > 0
        ? User.find({
            _id: { $in: Array.from(relatedUserIds) },
            role: 'common'
          }).select('_id username allianceId').lean()
        : [],
      isValidObjectId(domainMasterId)
        ? User.findById(domainMasterId).select('_id username allianceId').lean()
        : null
    ]);
    const relatedUserMap = new Map(relatedUsers.map((item) => [getIdString(item._id), item]));
    const commonUserIdSet = new Set(Array.from(relatedUserMap.keys()).filter((id) => isValidObjectId(id)));

    let masterAlliance = null;
    if (masterUser?.allianceId && isValidObjectId(getIdString(masterUser.allianceId))) {
      const allianceId = getIdString(masterUser.allianceId);
      relatedAllianceIds.add(allianceId);
      masterAlliance = await EntropyAlliance.findById(allianceId)
        .select('_id name knowledgeContributionPercent enemyAllianceIds')
        .lean();
    }

    const relatedAlliances = relatedAllianceIds.size > 0
      ? await EntropyAlliance.find({ _id: { $in: Array.from(relatedAllianceIds) } })
          .select('_id name')
          .lean()
      : [];
    const allianceMap = new Map(relatedAlliances.map((item) => [getIdString(item._id), item]));

    const enrichPercentUsers = (items = []) => items.map((item) => ({
      ...item,
      username: relatedUserMap.get(item.userId)?.username || ''
    }));
    const enrichPercentAlliances = (items = []) => items.map((item) => ({
      ...item,
      allianceName: allianceMap.get(item.allianceId)?.name || ''
    }));
    const enrichIdUsers = (items = []) => items.map((id) => ({
      userId: id,
      username: relatedUserMap.get(id)?.username || ''
    }));
    const enrichIdAlliances = (items = []) => items.map((id) => ({
      allianceId: id,
      allianceName: allianceMap.get(id)?.name || ''
    }));

    const allianceContributionPercent = round2(clampPercent(masterAlliance?.knowledgeContributionPercent || 0, 0));
    const enemyAllianceIds = (Array.isArray(masterAlliance?.enemyAllianceIds) ? masterAlliance.enemyAllianceIds : [])
      .map((item) => getIdString(item))
      .filter((id) => isValidObjectId(id));
    const hasMasterAlliance = !!masterAlliance;

    const normalizeAllianceScopedRule = (rule = {}) => (
      hasMasterAlliance
        ? rule
        : {
            ...rule,
            nonHostileAlliancePercent: 0,
            specificAlliancePercents: []
          }
    );

    const enrichRulePayload = (rule) => ({
      ...normalizeAllianceScopedRule(rule),
      adminPercents: enrichPercentUsers(rule.adminPercents),
      customUserPercents: enrichPercentUsers(rule.customUserPercents),
      specificAlliancePercents: hasMasterAlliance ? enrichPercentAlliances(rule.specificAlliancePercents) : [],
      blacklistUsers: enrichIdUsers(rule.blacklistUserIds),
      blacklistAlliances: enrichIdAlliances(rule.blacklistAllianceIds)
    });

    const profilePayloads = serializedProfiles.map((profile) => {
      const serializedRule = normalizeAllianceScopedRule(
        filterRuleUsersByAllowedSet(profile.rule, commonUserIdSet)
      );
      return {
        profileId: profile.profileId,
        name: profile.name,
        enabled: profile.profileId === activeRuleId,
        rule: enrichRulePayload(serializedRule),
        percentSummary: computeDistributionPercentSummary(serializedRule, allianceContributionPercent)
      };
    });
    const activeRulePayload = profilePayloads.find((item) => item.profileId === activeRuleId) || profilePayloads[0];

    res.json({
      success: true,
      canView,
      canEdit,
      isSystemAdmin,
      nodeId: node._id,
      nodeName: node.name,
      knowledgePointValue: round2(Number(node?.knowledgePoint?.value) || 0),
      carryoverValue: round2(Number(node?.knowledgeDistributionCarryover) || 0),
      masterAllianceId: masterAlliance ? getIdString(masterAlliance._id) : '',
      masterAllianceName: masterAlliance?.name || '',
      allianceContributionPercent,
      enemyAllianceIds,
      scheduleSlots,
      activeRuleId,
      activeRule: activeRulePayload || null,
      ruleProfiles: profilePayloads,
      rule: activeRulePayload?.rule || enrichRulePayload(
        normalizeAllianceScopedRule(filterRuleUsersByAllowedSet(rulePayload, commonUserIdSet))
      ),
      percentSummary: activeRulePayload?.percentSummary || computeDistributionPercentSummary(
        normalizeAllianceScopedRule(filterRuleUsersByAllowedSet(rulePayload, commonUserIdSet)),
        allianceContributionPercent
      ),
      locked: lockPayload,
      isRuleLocked: !!node.knowledgeDistributionLocked
    });
  } catch (error) {
    console.error('获取知识点分发规则错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 域主搜索用户（用于分发规则中的指定用户/黑名单）
router.get('/:nodeId/distribution-settings/search-users', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const keyword = typeof req.query?.keyword === 'string' ? req.query.keyword.trim() : '';
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('domainMaster');
    if (!node) {
      return res.status(404).json({ error: '知识域不存在' });
    }
    if (!isDomainMaster(node, req.user.userId)) {
      return res.status(403).json({ error: '只有域主可以搜索分发对象' });
    }

    const query = {
      role: 'common',
      _id: { $ne: node.domainMaster }
    };
    if (keyword) {
      query.username = { $regex: keyword, $options: 'i' };
    }

    const users = await User.find(query)
      .select('_id username profession allianceId')
      .sort({ username: 1 })
      .limit(20)
      .lean();

    res.json({
      success: true,
      users: users.map((userItem) => ({
        _id: getIdString(userItem._id),
        username: userItem.username || '',
        profession: userItem.profession || '',
        allianceId: getIdString(userItem.allianceId) || ''
      }))
    });
  } catch (error) {
    console.error('搜索分发用户失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 域主搜索熵盟（用于分发规则中的指定熵盟/黑名单）
router.get('/:nodeId/distribution-settings/search-alliances', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const keyword = typeof req.query?.keyword === 'string' ? req.query.keyword.trim() : '';
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    const node = await Node.findById(nodeId).select('domainMaster');
    if (!node) {
      return res.status(404).json({ error: '知识域不存在' });
    }
    if (!isDomainMaster(node, req.user.userId)) {
      return res.status(403).json({ error: '只有域主可以搜索熵盟' });
    }

    const query = {};
    if (keyword) {
      query.name = { $regex: keyword, $options: 'i' };
    }

    const alliances = await EntropyAlliance.find(query)
      .select('_id name')
      .sort({ name: 1 })
      .limit(20)
      .lean();

    res.json({
      success: true,
      alliances: alliances.map((item) => ({
        _id: getIdString(item._id),
        name: item.name || ''
      }))
    });
  } catch (error) {
    console.error('搜索分发熵盟失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 保存知识点分发规则（仅域主）
router.put('/:nodeId/distribution-settings', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    let node = await Node.findById(nodeId).select(
      'name status domainMaster domainAdmins knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionActiveRuleId knowledgeDistributionScheduleSlots knowledgeDistributionLocked'
    );
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (!isDomainMaster(node, requestUserId)) {
      return res.status(403).json({ error: '只有域主可以修改分发规则' });
    }

    const masterUser = await User.findById(requestUserId).select('_id role allianceId');
    if (!masterUser || masterUser.role !== 'common') {
      return res.status(400).json({ error: '当前域主身份异常，无法设置分发规则' });
    }

    const now = new Date();
    if (node.knowledgeDistributionLocked) {
      await KnowledgeDistributionService.processNode(node, now);
      node = await Node.findById(nodeId).select(
        'name status domainMaster domainAdmins knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionActiveRuleId knowledgeDistributionScheduleSlots knowledgeDistributionLocked'
      );
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
    }

    if (node.knowledgeDistributionLocked) {
      return res.status(409).json({ error: '当前分发计划已发布，采用规则已锁定，需等待本次分发结束后才能修改规则' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const inputProfilesRaw = Array.isArray(body.ruleProfiles)
      ? body.ruleProfiles
      : (body.rule && typeof body.rule === 'object'
          ? [{ profileId: body.activeRuleId || 'default', name: '默认规则', rule: body.rule }]
          : []);
    if (inputProfilesRaw.length === 0) {
      return res.status(400).json({ error: '请至少配置一套分发规则' });
    }

    const profileSeen = new Set();
    const nextProfiles = [];
    inputProfilesRaw.forEach((profile, index) => {
      const normalized = sanitizeDistributionRuleProfileInput(profile, index);
      if (!normalized.profileId || profileSeen.has(normalized.profileId)) return;
      profileSeen.add(normalized.profileId);
      nextProfiles.push(normalized);
    });
    if (nextProfiles.length === 0) {
      return res.status(400).json({ error: '分发规则数据无效' });
    }

    const requestedActiveRuleId = typeof body.activeRuleId === 'string' ? body.activeRuleId.trim() : '';
    const nextActiveRuleId = nextProfiles.some((profile) => profile.profileId === requestedActiveRuleId)
      ? requestedActiveRuleId
      : nextProfiles[0].profileId;
    let allianceContributionPercent = 0;
    let masterAlliance = null;
    if (masterUser.allianceId && isValidObjectId(getIdString(masterUser.allianceId))) {
      masterAlliance = await EntropyAlliance.findById(masterUser.allianceId)
        .select('_id name knowledgeContributionPercent');
      allianceContributionPercent = round2(clampPercent(masterAlliance?.knowledgeContributionPercent || 0, 0));
      const masterAllianceId = getIdString(masterAlliance?._id);
      if (masterAllianceId) {
        nextProfiles.forEach((profile) => {
          profile.rule.blacklistAllianceIds = (profile.rule.blacklistAllianceIds || []).filter((id) => id !== masterAllianceId);
        });
      }
    }
    if (!masterAlliance) {
      nextProfiles.forEach((profile) => {
        profile.rule.nonHostileAlliancePercent = 0;
        profile.rule.specificAlliancePercents = [];
      });
    }

    const ruleReferencedUserIds = Array.from(new Set([
      ...nextProfiles.flatMap((profile) => collectRuleUserIds(profile.rule || {})),
      ...(Array.isArray(node.domainAdmins) ? node.domainAdmins.map((adminId) => getIdString(adminId)) : [])
    ].filter((id) => isValidObjectId(id))));
    const commonUserIdSet = await loadCommonUserIdSet(ruleReferencedUserIds);
    const domainAdminSet = new Set(
      (node.domainAdmins || [])
        .map((adminId) => getIdString(adminId))
        .filter((id) => isValidObjectId(id) && commonUserIdSet.has(id))
    );
    const profileSummaries = [];
    for (const profile of nextProfiles) {
      profile.rule = filterRuleUsersByAllowedSet(profile.rule || {}, commonUserIdSet);
      profile.rule.adminPercents = (profile.rule.adminPercents || []).filter((item) => domainAdminSet.has(item.userId));
      profile.rule.blacklistUserIds = (profile.rule.blacklistUserIds || []).filter((id) => id !== requestUserId);
      const summary = computeDistributionPercentSummary(profile.rule, allianceContributionPercent);
      if (summary.total > 100) {
        return res.status(400).json({
          error: `规则「${profile.name}」分配总比例不能超过100%（当前 ${summary.total}%）`,
          profileId: profile.profileId,
          percentSummary: summary
        });
      }
      profileSummaries.push({
        profileId: profile.profileId,
        name: profile.name,
        percentSummary: summary
      });
    }

    node.knowledgeDistributionRuleProfiles = nextProfiles.map((profile) => ({
      profileId: profile.profileId,
      name: profile.name,
      rule: profile.rule
    }));
    node.knowledgeDistributionActiveRuleId = nextActiveRuleId;
    const activeProfile = nextProfiles.find((profile) => profile.profileId === nextActiveRuleId) || nextProfiles[0];
    node.knowledgeDistributionRule = activeProfile?.rule || sanitizeDistributionRuleInput({});
    // 新流程中分发时间由“发布分发计划”单独管理
    node.knowledgeDistributionScheduleSlots = [];

    await node.save();

    const saved = extractDistributionProfilesFromNode(node);
    const savedProfiles = saved.profiles.map((profile) => ({
      profileId: profile.profileId,
      name: profile.name,
      enabled: profile.profileId === saved.activeRuleId,
      rule: serializeDistributionRule(profile.rule || {})
    }));
    const savedActive = savedProfiles.find((profile) => profile.profileId === saved.activeRuleId) || savedProfiles[0];
    const isRuleLocked = !!node.knowledgeDistributionLocked;
    res.json({
      success: true,
      message: isRuleLocked
        ? '分发规则已保存。当前周期已锁定，修改将在下一次分发生效'
        : '分发规则已保存',
      nodeId: node._id,
      nodeName: node.name,
      masterAllianceId: masterAlliance ? getIdString(masterAlliance._id) : '',
      masterAllianceName: masterAlliance?.name || '',
      allianceContributionPercent,
      scheduleSlots: [],
      activeRuleId: saved.activeRuleId,
      activeRule: savedActive || null,
      ruleProfiles: savedProfiles.map((profile) => ({
        ...profile,
        percentSummary: computeDistributionPercentSummary(profile.rule, allianceContributionPercent)
      })),
      rule: savedActive?.rule || serializeDistributionRule(node.knowledgeDistributionRule || {}),
      percentSummary: computeDistributionPercentSummary(savedActive?.rule || node.knowledgeDistributionRule || {}, allianceContributionPercent),
      profileSummaries,
      locked: serializeDistributionLock(node.knowledgeDistributionLocked || null),
      isRuleLocked
    });
  } catch (error) {
    console.error('保存知识点分发规则错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 发布知识点分发计划（仅域主）：选择规则 + 设置执行时刻（整点）后立即发布并锁定，不可撤回
router.post('/:nodeId/distribution-settings/publish', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    let node = await Node.findById(nodeId).select(
      'name status domainMaster domainAdmins contentScore knowledgePoint knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionActiveRuleId knowledgeDistributionLocked knowledgeDistributionCarryover'
    );
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (!isDomainMaster(node, requestUserId)) {
      return res.status(403).json({ error: '只有域主可以发布分发计划' });
    }

    const now = new Date();
    if (node.knowledgeDistributionLocked) {
      await KnowledgeDistributionService.processNode(node, now);
      node = await Node.findById(nodeId).select(
        'name status domainMaster domainAdmins contentScore knowledgePoint knowledgeDistributionRule knowledgeDistributionRuleProfiles knowledgeDistributionActiveRuleId knowledgeDistributionLocked knowledgeDistributionCarryover'
      );
      if (!node) {
        return res.status(404).json({ error: '知识域不存在' });
      }
    }

    if (node.knowledgeDistributionLocked) {
      return res.status(409).json({ error: '该知识域已有已发布分发计划，发布后不可撤回，请等待本次执行后再发布新计划' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const executeAt = parseDistributionExecuteAtHour(body.executeAt);
    if (!executeAt) {
      return res.status(400).json({ error: '执行时间格式无效，请设置为整点（例如 2026-02-16T16:00）' });
    }
    if (executeAt.getTime() <= now.getTime()) {
      return res.status(400).json({ error: '执行时间必须晚于当前时间' });
    }
    if (executeAt.getTime() - now.getTime() < 60 * 1000) {
      return res.status(400).json({ error: '执行时间至少需要晚于当前 1 分钟，以便用户入场' });
    }

    const { profiles, activeRuleId } = extractDistributionProfilesFromNode(node);
    const requestedProfileId = typeof body.ruleProfileId === 'string' ? body.ruleProfileId.trim() : '';
    const selectedProfile = profiles.find((item) => item.profileId === requestedProfileId)
      || profiles.find((item) => item.profileId === activeRuleId)
      || profiles[0];
    if (!selectedProfile) {
      return res.status(400).json({ error: '未找到可发布的分发规则' });
    }

    const masterUser = await User.findById(requestUserId).select('_id username role allianceId');
    if (!masterUser || masterUser.role !== 'common') {
      return res.status(400).json({ error: '当前域主身份异常，无法发布分发计划' });
    }

    const selectedRule = sanitizeDistributionRuleInput(selectedProfile.rule || {});
    const ruleReferencedUserIds = Array.from(new Set([
      ...collectRuleUserIds(selectedRule),
      ...(Array.isArray(node.domainAdmins) ? node.domainAdmins.map((adminId) => getIdString(adminId)) : [])
    ].filter((id) => isValidObjectId(id))));
    const commonUserIdSet = await loadCommonUserIdSet(ruleReferencedUserIds);
    const domainAdminSet = new Set(
      (node.domainAdmins || [])
        .map((adminId) => getIdString(adminId))
        .filter((id) => isValidObjectId(id) && commonUserIdSet.has(id))
    );
    const filteredRule = filterRuleUsersByAllowedSet(selectedRule, commonUserIdSet);
    selectedRule.adminPercents = filteredRule.adminPercents;
    selectedRule.customUserPercents = filteredRule.customUserPercents;
    selectedRule.blacklistUserIds = filteredRule.blacklistUserIds;
    selectedRule.adminPercents = (selectedRule.adminPercents || []).filter((item) => domainAdminSet.has(item.userId));
    selectedRule.blacklistUserIds = (selectedRule.blacklistUserIds || []).filter((id) => id !== requestUserId);

    let masterAlliance = null;
    let allianceContributionPercent = 0;
    if (masterUser.allianceId && isValidObjectId(getIdString(masterUser.allianceId))) {
      masterAlliance = await EntropyAlliance.findById(masterUser.allianceId)
        .select('_id name knowledgeContributionPercent enemyAllianceIds')
        .lean();
      allianceContributionPercent = round2(clampPercent(masterAlliance?.knowledgeContributionPercent || 0, 0));
      const masterAllianceId = getIdString(masterAlliance?._id);
      if (masterAllianceId) {
        selectedRule.blacklistAllianceIds = (selectedRule.blacklistAllianceIds || []).filter((id) => id !== masterAllianceId);
      }
    } else {
      selectedRule.nonHostileAlliancePercent = 0;
      selectedRule.specificAlliancePercents = [];
    }

    const summary = computeDistributionPercentSummary(selectedRule, allianceContributionPercent);
    if (summary.total > 100) {
      return res.status(400).json({
        error: `规则「${selectedProfile.name}」分配总比例不能超过100%（当前 ${summary.total}%）`,
        profileId: selectedProfile.profileId,
        percentSummary: summary
      });
    }

    Node.applyKnowledgePointProjection(node, now);

    const minutesToExecute = Math.max(0, (executeAt.getTime() - now.getTime()) / (1000 * 60));
    const projectedTotal = round2(
      (Number(node.knowledgePoint?.value) || 0) +
      (Number(node.knowledgeDistributionCarryover) || 0) +
      minutesToExecute * (Number(node.contentScore) || 0)
    );
    const distributionPercent = selectedRule?.distributionScope === 'partial'
      ? round2(clampPercent(selectedRule?.distributionPercent, 100))
      : 100;
    const projectedDistributableTotal = round2(projectedTotal * (distributionPercent / 100));
    const entryCloseAt = new Date(executeAt.getTime() - 60 * 1000);
    const endAt = new Date(executeAt.getTime() + 60 * 1000);

    node.knowledgeDistributionLocked = {
      executeAt,
      entryCloseAt,
      endAt,
      executedAt: null,
      announcedAt: now,
      projectedTotal,
      projectedDistributableTotal,
      masterAllianceId: masterAlliance?._id || null,
      masterAllianceName: masterAlliance?.name || '',
      allianceContributionPercent,
      distributionScope: selectedRule?.distributionScope === 'partial' ? 'partial' : 'all',
      distributionPercent,
      ruleProfileId: selectedProfile.profileId || '',
      ruleProfileName: selectedProfile.name || '',
      enemyAllianceIds: Array.isArray(masterAlliance?.enemyAllianceIds) ? masterAlliance.enemyAllianceIds : [],
      participants: [],
      resultUserRewards: [],
      ruleSnapshot: selectedRule
    };
    node.knowledgeDistributionLastAnnouncedAt = now;
    await node.save();
    await syncDomainTitleProjectionFromNode(node);

    await KnowledgeDistributionService.publishAnnouncementNotifications({
      node,
      masterUser,
      lock: node.knowledgeDistributionLocked
    });

    return res.json({
      success: true,
      message: '分发计划已发布并锁定，不可撤回',
      nodeId: node._id,
      nodeName: node.name,
      activeRuleId: selectedProfile.profileId,
      activeRuleName: selectedProfile.name,
      knowledgePointValue: round2(Number(node?.knowledgePoint?.value) || 0),
      carryoverValue: round2(Number(node?.knowledgeDistributionCarryover) || 0),
      locked: serializeDistributionLock(node.knowledgeDistributionLocked || null),
      isRuleLocked: true
    });
  } catch (error) {
    console.error('发布知识点分发计划错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 获取当前用户在知识点分发活动中的参与状态与实时预估
router.get('/:nodeId/distribution-participation', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    let node = await Node.findById(nodeId).select(
      'name status domainMaster domainAdmins knowledgePoint knowledgeDistributionLocked'
    );
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (node.knowledgeDistributionLocked) {
      await KnowledgeDistributionService.processNode(node, new Date());
      node = await Node.findById(nodeId).select(
        'name status domainMaster domainAdmins knowledgePoint knowledgeDistributionLocked'
      );
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
    }

    const currentUser = await User.findById(requestUserId)
      .select('_id username role allianceId avatar profession location travelState')
      .lean();
    if (!currentUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const lock = node.knowledgeDistributionLocked || null;
    if (!lock) {
      return res.json({
        success: true,
        active: false,
        nodeId: node._id,
        nodeName: node.name
      });
    }

    const now = new Date();
    const nowMs = now.getTime();
    const timeline = resolveDistributionLockTimeline(lock);
    const phase = getDistributionLockPhase(lock, now);

    const currentUserId = getIdString(currentUser._id);
    const masterId = getIdString(node.domainMaster);
    const domainAdminSet = new Set((Array.isArray(node.domainAdmins) ? node.domainAdmins : [])
      .map((id) => getIdString(id))
      .filter((id) => isValidObjectId(id)));
    const isMaster = currentUserId === masterId;
    const isDomainAdminRole = domainAdminSet.has(currentUserId);
    const isSystemAdminRole = currentUser.role === 'admin';
    const autoEntry = isMaster || isDomainAdminRole;

    const rules = KnowledgeDistributionService.getCommonRuleSets(lock.ruleSnapshot || {}, lock);
    const currentAllianceId = getIdString(currentUser.allianceId);
    const masterAllianceId = getIdString(lock.masterAllianceId);
    const rewardSnapshotMap = new Map(
      (Array.isArray(lock.resultUserRewards) ? lock.resultUserRewards : [])
        .map((item) => [getIdString(item?.userId), round2(Math.max(0, Number(item?.amount) || 0))])
        .filter(([userId]) => isValidObjectId(userId))
    );
    const isBlocked = KnowledgeDistributionService.isUserBlocked({
      userId: currentUserId,
      allianceId: currentAllianceId,
      masterAllianceId,
      blacklistUserIds: rules.blacklistUserIds,
      blacklistAllianceIds: rules.blacklistAllianceIds,
      enemyAllianceIds: rules.enemyAllianceIds
    });

    const manualParticipantSet = await getActiveManualParticipantSet({
      nodeId: node._id,
      lock,
      atMs: nowMs
    });
    const isJoinedManual = manualParticipantSet.has(currentUserId);
    const joined = autoEntry || isJoinedManual;
    const requiresManualEntry = !autoEntry && !isSystemAdminRole;
    const autoJoinOrderMsRaw = new Date(lock.announcedAt || lock.executeAt || 0).getTime();
    const autoJoinOrderMs = Number.isFinite(autoJoinOrderMsRaw) && autoJoinOrderMsRaw > 0 ? autoJoinOrderMsRaw : 0;
    const manualJoinOrderMap = buildManualJoinOrderMapFromLegacyLock(lock);
    const getParticipantJoinOrderMs = (userId = '') => {
      if (!isValidObjectId(userId)) return Number.MAX_SAFE_INTEGER;
      if (userId === masterId || domainAdminSet.has(userId)) {
        return autoJoinOrderMs;
      }
      return manualJoinOrderMap.get(userId) || Number.MAX_SAFE_INTEGER;
    };

    const canJoin = (
      requiresManualEntry &&
      !isBlocked &&
      !isJoinedManual &&
      phase === 'entry_open' &&
      isUserIdleAtNode(currentUser, node.name)
    );
    const canExit = requiresManualEntry && isJoinedManual;
    const canExitWithoutConfirm = !!lock.executedAt;

    const activeParticipantIdSet = new Set();
    if (isValidObjectId(masterId)) activeParticipantIdSet.add(masterId);
    for (const adminId of domainAdminSet) activeParticipantIdSet.add(adminId);
    for (const participantId of manualParticipantSet) activeParticipantIdSet.add(participantId);

    const activeParticipantIds = Array.from(activeParticipantIdSet).filter((id) => isValidObjectId(id));
    const participantUsers = activeParticipantIds.length > 0
      ? await User.find({ _id: { $in: activeParticipantIds } })
          .select('_id username avatar profession allianceId role')
          .lean()
      : [];
    const userMap = new Map(participantUsers.map((item) => [getIdString(item._id), item]));

    const participantAllianceIds = Array.from(new Set(
      participantUsers.map((item) => getIdString(item.allianceId)).filter((id) => isValidObjectId(id))
    ));
    const alliances = participantAllianceIds.length > 0
      ? await EntropyAlliance.find({ _id: { $in: participantAllianceIds } }).select('_id name').lean()
      : [];
    const allianceNameMap = new Map(alliances.map((item) => [getIdString(item._id), item.name || '']));

    const isParticipantEligible = (userObj) => {
      if (!userObj || userObj.role !== 'common') return false;
      const userId = getIdString(userObj._id);
      if (!isValidObjectId(userId)) return false;
      const allianceId = getIdString(userObj.allianceId);
      if (KnowledgeDistributionService.isUserBlocked({
        userId,
        allianceId,
        masterAllianceId,
        blacklistUserIds: rules.blacklistUserIds,
        blacklistAllianceIds: rules.blacklistAllianceIds,
        enemyAllianceIds: rules.enemyAllianceIds
      })) {
        return false;
      }
      if (userId === masterId || domainAdminSet.has(userId)) {
        return true;
      }
      return manualParticipantSet.has(userId);
    };

    const eligibleParticipantIds = activeParticipantIds.filter((id) => isParticipantEligible(userMap.get(id)));

    const isMasterOrAdminParticipant = (userId) => userId === masterId || domainAdminSet.has(userId);
    const assignedRegularPoolByUserId = new Map();
    for (const userId of eligibleParticipantIds) {
      if (isMasterOrAdminParticipant(userId)) continue;
      const userObj = userMap.get(userId);
      if (!userObj) continue;
      const preferredPool = KnowledgeDistributionService.resolvePreferredCustomPoolForUser({
        userId,
        allianceId: getIdString(userObj.allianceId),
        rules,
        masterAllianceId
      });
      if (!preferredPool || clampPercent(preferredPool.percent, 0) <= 0) continue;
      assignedRegularPoolByUserId.set(userId, preferredPool);
    }

    const nonHostileParticipants = eligibleParticipantIds.filter((id) => {
      const userItem = userMap.get(id);
      const allianceId = getIdString(userItem?.allianceId);
      if (!allianceId) return false;
      if (masterAllianceId && rules.enemyAllianceIds.has(allianceId)) return false;
      return assignedRegularPoolByUserId.get(id)?.key === 'non_hostile_alliance';
    });
    const noAllianceParticipants = eligibleParticipantIds.filter((id) => {
      const userItem = userMap.get(id);
      const allianceId = getIdString(userItem?.allianceId);
      if (allianceId) return false;
      return assignedRegularPoolByUserId.get(id)?.key === 'no_alliance';
    });
    const specificAllianceParticipantMap = new Map();
    for (const [allianceId] of rules.specificAlliancePercentMap.entries()) {
      specificAllianceParticipantMap.set(
        allianceId,
        eligibleParticipantIds.filter((id) => {
          const userAllianceId = getIdString(userMap.get(id)?.allianceId);
          if (userAllianceId !== allianceId) return false;
          const assignedPool = assignedRegularPoolByUserId.get(id);
          return assignedPool?.key === 'specific_alliance' && assignedPool?.allianceId === allianceId;
        })
      );
    }

    const currentAllianceIdSafe = getIdString(currentUser.allianceId);
    let selectedPool = null;
    if (!isBlocked && !isSystemAdminRole) {
      if (currentUserId === masterId) {
        const masterPercent = clampPercent(rules.masterPercent, 0);
        if (masterPercent > 0) {
          selectedPool = {
            key: 'master',
            label: '域主固定池',
            percent: masterPercent,
            split: false,
            memberIds: isValidObjectId(masterId) ? [masterId] : []
          };
        }
      } else if (rules.adminPercentMap.has(currentUserId)) {
        const adminPercent = clampPercent(rules.adminPercentMap.get(currentUserId), 0);
        if (adminPercent > 0) {
          selectedPool = {
            key: 'admin',
            label: '域相固定池',
            percent: adminPercent,
            split: false,
            memberIds: [currentUserId]
          };
        }
      } else {
        const preferredCurrentPool = KnowledgeDistributionService.resolvePreferredCustomPoolForUser({
          userId: currentUserId,
          allianceId: currentAllianceIdSafe,
          rules,
          masterAllianceId
        });
        if (preferredCurrentPool && clampPercent(preferredCurrentPool.percent, 0) > 0) {
          if (preferredCurrentPool.key === 'custom_user') {
            const customUserMemberIds = eligibleParticipantIds.includes(currentUserId)
              ? [currentUserId]
              : [];
            selectedPool = {
              key: 'custom_user',
              label: '指定用户池',
              percent: clampPercent(preferredCurrentPool.percent, 0),
              split: false,
              memberIds: customUserMemberIds
            };
          } else if (preferredCurrentPool.key === 'specific_alliance') {
            const targetAllianceId = preferredCurrentPool.allianceId || currentAllianceIdSafe;
            selectedPool = {
              key: 'specific_alliance',
              label: '指定熵盟池',
              percent: clampPercent(preferredCurrentPool.percent, 0),
              split: true,
              memberIds: specificAllianceParticipantMap.get(targetAllianceId) || []
            };
          } else if (preferredCurrentPool.key === 'non_hostile_alliance') {
            selectedPool = {
              key: 'non_hostile_alliance',
              label: '非敌对熵盟池',
              percent: clampPercent(preferredCurrentPool.percent, 0),
              split: true,
              memberIds: nonHostileParticipants
            };
          } else if (preferredCurrentPool.key === 'no_alliance') {
            selectedPool = {
              key: 'no_alliance',
              label: '无熵盟用户池',
              percent: clampPercent(preferredCurrentPool.percent, 0),
              split: true,
              memberIds: noAllianceParticipants
            };
          }
        }
      }
    }

    const displayPoolMemberIds = selectedPool ? Array.from(new Set([
      ...(Array.isArray(selectedPool.memberIds) ? selectedPool.memberIds : [])
    ].filter((id) => isValidObjectId(id)))) : [];
    const poolParticipantCount = displayPoolMemberIds.length;
    const percentDenominator = selectedPool?.split
      ? (joined
        ? poolParticipantCount
        : (poolParticipantCount + 1))
      : 1;
    const poolPercent = selectedPool ? round2(selectedPool.percent) : 0;
    const userActualPercent = selectedPool
      ? round2(selectedPool.split
        ? (percentDenominator > 0 ? poolPercent / percentDenominator : 0)
        : poolPercent)
      : 0;
    const estimatedReward = round2((Number(node?.knowledgePoint?.value) || 0) * (userActualPercent / 100));
    const rewardFrozen = !!lock.executedAt && joined;
    let rewardValue = null;
    if (joined) {
      rewardValue = rewardFrozen
        ? round2(rewardSnapshotMap.get(currentUserId) || 0)
        : estimatedReward;
    }
    const poolUsersAll = selectedPool
      ? displayPoolMemberIds
          .map((id) => userMap.get(id))
          .filter(Boolean)
          .map((item) => {
            const allianceId = getIdString(item.allianceId);
            const allianceName = allianceNameMap.get(allianceId) || '';
            return {
              userId: getIdString(item._id),
              username: item.username || '',
              avatar: item.avatar || 'default_male_1',
              profession: item.profession || '',
              allianceId,
              allianceName,
              displayName: allianceName ? `【${allianceName}】${item.username || ''}` : (item.username || ''),
              joinOrderMs: getParticipantJoinOrderMs(getIdString(item._id))
            };
          })
          .sort((a, b) => {
            const diff = (Number(a.joinOrderMs) || Number.MAX_SAFE_INTEGER) - (Number(b.joinOrderMs) || Number.MAX_SAFE_INTEGER);
            if (diff !== 0) return diff;
            return (a.username || '').localeCompare((b.username || ''), 'zh-CN');
          })
          .map((item) => ({
            userId: item.userId,
            username: item.username,
            avatar: item.avatar,
            profession: item.profession,
            allianceId: item.allianceId,
            allianceName: item.allianceName,
            displayName: item.displayName
          }))
      : [];
    const poolUsers = poolUsersAll.slice(0, DISTRIBUTION_POOL_USER_LIST_LIMIT);
    const poolUsersTruncated = poolUsersAll.length > poolUsers.length;

    let joinTip = '';
    if (isSystemAdminRole) {
      joinTip = '系统管理员不参与知识点分发';
    } else if (isBlocked) {
      joinTip = '你当前命中禁止规则，本次不可参与分发';
    } else if (!requiresManualEntry) {
      joinTip = '你为域主/域相，已自动入场';
    } else if (phase === 'entry_closed') {
      joinTip = '距离执行不足1分钟，入场已关闭';
    } else if (phase === 'settling') {
      joinTip = '分发已进入执行/结算阶段，无法新入场';
    } else if (phase === 'ended') {
      joinTip = '本次分发活动已结束';
    } else if (!isUserIdleAtNode(currentUser, node.name)) {
      joinTip = '你不在该知识域或仍在移动中，需先到达并停止移动';
    } else if (isJoinedManual) {
      joinTip = '你已参与本次分发';
    } else {
      joinTip = '可参与本次分发';
    }

    return res.json({
      success: true,
      active: phase !== 'ended',
      nodeId: node._id,
      nodeName: node.name,
      phase,
      executeAt: lock.executeAt || null,
      entryCloseAt: timeline.entryCloseAtMs > 0 ? new Date(timeline.entryCloseAtMs) : null,
      endAt: timeline.endAtMs > 0 ? new Date(timeline.endAtMs) : null,
      executedAt: lock.executedAt || null,
      secondsToEntryClose: timeline.entryCloseAtMs > nowMs ? Math.floor((timeline.entryCloseAtMs - nowMs) / 1000) : 0,
      secondsToExecute: timeline.executeAtMs > nowMs ? Math.floor((timeline.executeAtMs - nowMs) / 1000) : 0,
      secondsToEnd: timeline.endAtMs > nowMs ? Math.floor((timeline.endAtMs - nowMs) / 1000) : 0,
      requiresManualEntry,
      autoEntry,
      joined,
      joinedManual: isJoinedManual,
      canJoin,
      canExit,
      canExitWithoutConfirm,
      joinTip,
      participantTotal: eligibleParticipantIds.length,
      currentKnowledgePoint: round2(Number(node?.knowledgePoint?.value) || 0),
      pool: selectedPool ? {
        key: selectedPool.key,
        label: selectedPool.label,
        poolPercent,
        participantCount: poolParticipantCount,
        userActualPercent,
        estimatedReward,
        rewardValue,
        rewardFrozen,
        users: poolUsers,
        usersTruncated: poolUsersTruncated
      } : {
        key: '',
        label: '',
        poolPercent: 0,
        participantCount: 0,
        userActualPercent: 0,
        estimatedReward: 0,
        rewardValue,
        rewardFrozen,
        users: [],
        usersTruncated: false
      }
    });
  } catch (error) {
    console.error('获取分发参与状态错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 分页获取分发参与者（按会话）
router.get('/:nodeId/distribution-participants', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    let node = await Node.findById(nodeId).select(
      'name status knowledgeDistributionLocked'
    );
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (node.knowledgeDistributionLocked) {
      await KnowledgeDistributionService.processNode(node, new Date());
      node = await Node.findById(nodeId).select(
        'name status knowledgeDistributionLocked'
      );
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
    }

    const lock = node.knowledgeDistributionLocked || null;
    if (!lock) {
      return res.json({
        success: true,
        active: false,
        nodeId: node._id,
        nodeName: node.name,
        executeAt: null,
        total: 0,
        page: 1,
        pageSize: 50,
        rows: []
      });
    }

    const executeAt = toDistributionSessionExecuteAt(lock);
    if (!(executeAt instanceof Date)) {
      return res.status(409).json({ error: '当前分发会话无效' });
    }

    const page = toSafeInteger(req.query?.page, 1, { min: 1, max: 1000000 });
    const pageSize = toSafeInteger(req.query?.pageSize, 50, { min: 1, max: 200 });
    const activeOnly = String(req.query?.activeOnly || '').toLowerCase() === 'true';

    const participantPage = await listDistributionParticipantsBySession({
      nodeId: node._id,
      executeAt,
      page,
      pageSize,
      activeOnly
    });

    const userIds = Array.from(new Set(
      participantPage.rows
        .map((item) => getIdString(item?.userId))
        .filter((id) => isValidObjectId(id))
    )).map((id) => new mongoose.Types.ObjectId(id));
    const users = userIds.length > 0
      ? await User.find({ _id: { $in: userIds } })
          .select('_id username avatar profession allianceId')
          .lean()
      : [];
    const userMap = new Map(users.map((item) => [getIdString(item?._id), item]));

    const allianceIds = Array.from(new Set(
      users
        .map((item) => getIdString(item?.allianceId))
        .filter((id) => isValidObjectId(id))
    )).map((id) => new mongoose.Types.ObjectId(id));
    const alliances = allianceIds.length > 0
      ? await EntropyAlliance.find({ _id: { $in: allianceIds } }).select('_id name').lean()
      : [];
    const allianceNameMap = new Map(alliances.map((item) => [getIdString(item?._id), item?.name || '']));

    const rows = participantPage.rows.map((item) => {
      const userId = getIdString(item?.userId);
      const user = userMap.get(userId) || null;
      const allianceId = getIdString(user?.allianceId);
      return {
        userId,
        username: user?.username || '',
        avatar: user?.avatar || 'default_male_1',
        profession: user?.profession || '',
        allianceId: allianceId || '',
        allianceName: allianceNameMap.get(allianceId) || '',
        joinedAt: item?.joinedAt || null,
        exitedAt: item?.exitedAt || null,
        active: !item?.exitedAt
      };
    });

    return res.json({
      success: true,
      active: true,
      nodeId: node._id,
      nodeName: node.name,
      executeAt,
      total: participantPage.total,
      page: participantPage.page,
      pageSize: participantPage.pageSize,
      activeOnly,
      rows
    });
  } catch (error) {
    console.error('获取分发参与者列表错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 普通用户参与分发（入场）
router.post('/:nodeId/distribution-participation/join', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    let node = await Node.findById(nodeId).select('name status domainMaster domainAdmins knowledgeDistributionLocked');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (node.knowledgeDistributionLocked) {
      await KnowledgeDistributionService.processNode(node, new Date());
      node = await Node.findById(nodeId).select('name status domainMaster domainAdmins knowledgeDistributionLocked');
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
    }

    const lock = node.knowledgeDistributionLocked;
    if (!lock) {
      return res.status(409).json({ error: '当前知识域没有进行中的分发活动' });
    }
    const executeAt = toDistributionSessionExecuteAt(lock);
    if (!(executeAt instanceof Date)) {
      return res.status(409).json({ error: '当前分发会话无效，请等待域主重新发布分发计划' });
    }

    const currentUser = await User.findById(requestUserId)
      .select('_id username role allianceId location travelState')
      .lean();
    if (!currentUser) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (currentUser.role !== 'common') {
      return res.status(403).json({ error: '系统管理员不参与知识点分发' });
    }

    const currentUserId = getIdString(currentUser._id);
    const masterId = getIdString(node.domainMaster);
    const domainAdminSet = new Set((Array.isArray(node.domainAdmins) ? node.domainAdmins : [])
      .map((id) => getIdString(id))
      .filter((id) => isValidObjectId(id)));
    if (currentUserId === masterId || domainAdminSet.has(currentUserId)) {
      return res.json({
        success: true,
        autoEntry: true,
        joined: true,
        message: '域主/域相自动入场，无需手动参与'
      });
    }

    const phase = getDistributionLockPhase(lock, new Date());
    if (phase !== 'entry_open') {
      return res.status(409).json({ error: '当前不在可入场时间窗口（分发前1分钟停止入场）' });
    }
    if (!isUserIdleAtNode(currentUser, node.name)) {
      return res.status(409).json({ error: `你不在知识域「${node.name}」或仍在移动中，无法参与` });
    }

    const rules = KnowledgeDistributionService.getCommonRuleSets(lock.ruleSnapshot || {}, lock);
    const currentAllianceId = getIdString(currentUser.allianceId);
    const masterAllianceId = getIdString(lock.masterAllianceId);
    const isBlocked = KnowledgeDistributionService.isUserBlocked({
      userId: currentUserId,
      allianceId: currentAllianceId,
      masterAllianceId,
      blacklistUserIds: rules.blacklistUserIds,
      blacklistAllianceIds: rules.blacklistAllianceIds,
      enemyAllianceIds: rules.enemyAllianceIds
    });
    if (isBlocked) {
      return res.status(403).json({ error: '你当前命中禁止规则，无法参与本次分发' });
    }

    const existingCollectionActive = await DistributionParticipant.findOne({
      nodeId: node._id,
      executeAt,
      userId: currentUser._id,
      exitedAt: null
    }).select('_id').lean();
    if (existingCollectionActive) {
      return res.json({
        success: true,
        joined: true,
        message: '你已参与本次分发'
      });
    }

    const nextParticipants = Array.isArray(lock.participants) ? [...lock.participants] : [];
    const existingIndex = nextParticipants.findIndex((item) => getIdString(item?.userId) === currentUserId);
    const now = new Date();
    let legacyMirrorChanged = false;
    let legacyMirrorDropped = false;
    if (existingIndex >= 0) {
      if (!nextParticipants[existingIndex].exitedAt) {
        return res.json({
          success: true,
          joined: true,
          message: '你已参与本次分发'
        });
      }
      nextParticipants[existingIndex] = {
        ...nextParticipants[existingIndex],
        joinedAt: now,
        exitedAt: null
      };
      legacyMirrorChanged = true;
    } else {
      if (nextParticipants.length < DISTRIBUTION_LEGACY_PARTICIPANT_MIRROR_LIMIT) {
        nextParticipants.push({
          userId: new mongoose.Types.ObjectId(currentUserId),
          joinedAt: now,
          exitedAt: null
        });
        legacyMirrorChanged = true;
      } else {
        legacyMirrorDropped = true;
      }
    }

    if (legacyMirrorChanged) {
      node.knowledgeDistributionLocked.participants = nextParticipants;
      await node.save();
    }
    await syncDistributionParticipantJoinRecord({
      nodeId: node._id,
      executeAt,
      userId: currentUserId,
      joinedAt: now
    });

    return res.json({
      success: true,
      joined: true,
      message: legacyMirrorDropped
        ? `你已参与知识域「${node.name}」的分发活动（兼容参与列表已达上限）`
        : `你已参与知识域「${node.name}」的分发活动`
    });
  } catch (error) {
    console.error('参与分发错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// 普通用户退出分发（手动入场用户）
router.post('/:nodeId/distribution-participation/exit', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }
    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的知识域ID' });
    }

    let node = await Node.findById(nodeId).select('name status domainMaster domainAdmins knowledgeDistributionLocked');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (node.knowledgeDistributionLocked) {
      await KnowledgeDistributionService.processNode(node, new Date());
      node = await Node.findById(nodeId).select('name status domainMaster domainAdmins knowledgeDistributionLocked');
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
    }

    const lock = node.knowledgeDistributionLocked;
    if (!lock) {
      return res.json({
        success: true,
        exited: true,
        message: '当前分发活动已结束'
      });
    }
    const executeAt = toDistributionSessionExecuteAt(lock);
    if (!(executeAt instanceof Date)) {
      return res.json({
        success: true,
        exited: true,
        message: '当前分发会话已失效'
      });
    }

    const currentUser = await User.findById(requestUserId).select('_id role').lean();
    if (!currentUser) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (currentUser.role !== 'common') {
      return res.status(403).json({ error: '系统管理员不参与知识点分发' });
    }

    const currentUserId = getIdString(currentUser._id);
    const masterId = getIdString(node.domainMaster);
    const domainAdminSet = new Set((Array.isArray(node.domainAdmins) ? node.domainAdmins : [])
      .map((id) => getIdString(id))
      .filter((id) => isValidObjectId(id)));
    if (currentUserId === masterId || domainAdminSet.has(currentUserId)) {
      return res.status(400).json({ error: '域主/域相为自动入场，不支持手动退出' });
    }

    const existingCollectionActive = await DistributionParticipant.findOne({
      nodeId: node._id,
      executeAt,
      userId: currentUser._id,
      exitedAt: null
    }).select('_id').lean();

    const nextParticipants = Array.isArray(lock.participants) ? [...lock.participants] : [];
    const legacyActiveIndex = nextParticipants.findIndex((item) => (
      getIdString(item?.userId) === currentUserId && !item?.exitedAt
    ));
    if (!existingCollectionActive && legacyActiveIndex < 0) {
      return res.json({
        success: true,
        exited: true,
        message: '你当前未参与该分发活动'
      });
    }

    const exitAt = new Date();
    if (legacyActiveIndex >= 0) {
      nextParticipants[legacyActiveIndex] = {
        ...nextParticipants[legacyActiveIndex],
        exitedAt: exitAt
      };
      node.knowledgeDistributionLocked.participants = nextParticipants;
      await node.save();
    }
    await syncDistributionParticipantExitRecord({
      nodeId: node._id,
      executeAt,
      userId: currentUserId,
      exitedAt: exitAt
    });

    return res.json({
      success: true,
      exited: true,
      message: `你已退出知识域「${node.name}」的分发活动`
    });
  } catch (error) {
    console.error('退出分发错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
