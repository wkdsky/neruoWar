const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Node = require('../models/Node');
const User = require('../models/User');
const EntropyAlliance = require('../models/EntropyAlliance');
const KnowledgeDistributionService = require('../services/KnowledgeDistributionService');
const { fetchArmyUnitTypes } = require('../services/armyUnitTypeService');
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
  const source = Array.isArray(node?.synonymSenses) ? node.synonymSenses : [];
  const deduped = [];
  const seen = new Set();
  const seenTitleKeys = new Set();
  for (let i = 0; i < source.length; i += 1) {
    const item = source[i] || {};
    const senseId = typeof item.senseId === 'string' && item.senseId.trim()
      ? item.senseId.trim()
      : `sense_${i + 1}`;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    const titleKey = title.toLowerCase();
    if (!title || !content || seen.has(senseId) || seenTitleKeys.has(titleKey)) continue;
    seen.add(senseId);
    seenTitleKeys.add(titleKey);
    deduped.push({ senseId, title, content });
  }
  if (deduped.length > 0) return deduped;
  const fallbackContent = typeof node?.description === 'string' && node.description.trim()
    ? node.description.trim()
    : '暂无释义内容';
  return [{
    senseId: 'sense_1',
    title: '基础释义',
    content: fallbackContent
  }];
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

const buildTitleGraphFromNodes = ({
  nodeDocs = [],
  centerNodeId = '',
  maxDepth = 3,
  maxNodes = 160
}) => {
  const centerId = getIdString(centerNodeId);
  const sourceNodes = Array.isArray(nodeDocs) ? nodeDocs : [];
  const nodeMap = new Map();

  sourceNodes.forEach((item) => {
    const nodeId = getIdString(item?._id);
    if (!nodeId) return;
    nodeMap.set(nodeId, item);
  });

  if (!centerId || !nodeMap.has(centerId)) {
    return {
      centerNodeId: centerId,
      levelByNodeId: {},
      orderedNodeIds: [],
      edgeList: []
    };
  }

  const adjacency = new Map();
  const edgeMap = new Map();
  const nodeSenseTitleMap = new Map();
  const getSenseTitleByNode = (nodeId, senseId) => {
    const safeNodeId = getIdString(nodeId);
    const safeSenseId = typeof senseId === 'string' ? senseId.trim() : '';
    if (!safeNodeId || !safeSenseId) return '';
    let map = nodeSenseTitleMap.get(safeNodeId);
    if (!map) {
      const nodeDoc = nodeMap.get(safeNodeId);
      map = new Map(normalizeNodeSenseList(nodeDoc).map((sense) => [sense.senseId, sense.title]));
      nodeSenseTitleMap.set(safeNodeId, map);
    }
    return map.get(safeSenseId) || '';
  };
  const getEdgeFromMap = (edgeId, nodeAId, nodeBId) => {
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
    const safeNodeId = getIdString(nodeId);
    const safeSenseId = typeof senseId === 'string' ? senseId.trim() : '';
    const safeSenseTitle = typeof senseTitle === 'string' ? senseTitle.trim() : '';
    if (!safeNodeId || !safeSenseId || !safeSenseTitle) return;
    let bySenseId = edge.senseTitleMapByNodeId.get(safeNodeId);
    if (!bySenseId) {
      bySenseId = new Map();
      edge.senseTitleMapByNodeId.set(safeNodeId, bySenseId);
    }
    if (!bySenseId.has(safeSenseId)) {
      bySenseId.set(safeSenseId, safeSenseTitle);
    }
  };
  const appendAdjacency = (fromNodeId, toNodeId) => {
    const fromId = getIdString(fromNodeId);
    const toId = getIdString(toNodeId);
    if (!fromId || !toId || fromId === toId) return;
    const existed = adjacency.get(fromId) || new Set();
    existed.add(toId);
    adjacency.set(fromId, existed);
  };

  for (const nodeDoc of sourceNodes) {
    const sourceNodeId = getIdString(nodeDoc?._id);
    if (!sourceNodeId) continue;
    const assocList = normalizeRelationAssociationList(nodeDoc?.associations || []);
    for (const assoc of assocList) {
      const targetNodeId = getIdString(assoc?.targetNode);
      if (!targetNodeId || targetNodeId === sourceNodeId || !nodeMap.has(targetNodeId)) continue;

      const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
      const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
      const sourceSenseTitle = getSenseTitleByNode(sourceNodeId, sourceSenseId);
      const targetSenseTitle = getSenseTitleByNode(targetNodeId, targetSenseId);
      if (!sourceSenseId || !targetSenseId || !sourceSenseTitle || !targetSenseTitle) continue;

      const nodeAId = sourceNodeId < targetNodeId ? sourceNodeId : targetNodeId;
      const nodeBId = sourceNodeId < targetNodeId ? targetNodeId : sourceNodeId;
      const edgeId = `${nodeAId}|${nodeBId}`;
      const edge = getEdgeFromMap(edgeId, nodeAId, nodeBId);
      const pairKey = [
        sourceNodeId,
        sourceSenseId,
        assoc.relationType,
        targetNodeId,
        targetSenseId
      ].join('|');
      if (!edge.pairs.some((item) => item.pairKey === pairKey)) {
        edge.pairs.push({
          pairKey,
          sourceNodeId,
          sourceSenseId,
          sourceSenseTitle,
          targetNodeId,
          targetSenseId,
          targetSenseTitle,
          relationType: assoc.relationType
        });
      }

      upsertEdgeSense(edge, sourceNodeId, sourceSenseId, sourceSenseTitle);
      upsertEdgeSense(edge, targetNodeId, targetSenseId, targetSenseTitle);
      appendAdjacency(sourceNodeId, targetNodeId);
      appendAdjacency(targetNodeId, sourceNodeId);
    }
  }

  const levelByNodeId = { [centerId]: 0 };
  const orderedNodeIds = [centerId];
  const visited = new Set([centerId]);
  const queue = [{ nodeId: centerId, level: 0 }];
  const maxDepthLimit = toSafeInteger(maxDepth, 3, { min: 1, max: 7 });
  const maxNodeLimit = toSafeInteger(maxNodes, 160, { min: 20, max: 500 });

  while (queue.length > 0 && orderedNodeIds.length < maxNodeLimit) {
    const current = queue.shift();
    if (!current) break;
    if (current.level >= maxDepthLimit) continue;

    const neighbors = Array.from(adjacency.get(current.nodeId) || []);
    neighbors.sort((a, b) => {
      const nameA = nodeMap.get(a)?.name || '';
      const nameB = nodeMap.get(b)?.name || '';
      return nameA.localeCompare(nameB, 'zh-Hans-CN');
    });
    for (const neighborId of neighbors) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      const nextLevel = current.level + 1;
      levelByNodeId[neighborId] = nextLevel;
      orderedNodeIds.push(neighborId);
      queue.push({ nodeId: neighborId, level: nextLevel });
      if (orderedNodeIds.length >= maxNodeLimit) break;
    }
  }

  const selectedSet = new Set(orderedNodeIds);
  const edgeList = Array.from(edgeMap.values())
    .filter((edge) => selectedSet.has(edge.nodeAId) && selectedSet.has(edge.nodeBId))
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
    .sort((a, b) => {
      const levelA = Math.min(levelByNodeId[a.nodeAId] ?? 99, levelByNodeId[a.nodeBId] ?? 99);
      const levelB = Math.min(levelByNodeId[b.nodeAId] ?? 99, levelByNodeId[b.nodeBId] ?? 99);
      if (levelA !== levelB) return levelA - levelB;
      if (a.pairCount !== b.pairCount) return b.pairCount - a.pairCount;
      return a.edgeId.localeCompare(b.edgeId, 'en');
    });

  return {
    centerNodeId: centerId,
    levelByNodeId,
    orderedNodeIds,
    edgeList
  };
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
  const targetNodeMap = new Map(targetNodes.map((item) => [getIdString(item._id), item]));
  const mutationSummary = buildAssociationMutationSummary({
    node,
    oldAssociations: oldRelationAssociations,
    nextAssociations: nextRelationAssociations,
    lostBridgePairs,
    reconnectPairs,
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
  const source = node?.citySiegeState && typeof node.citySiegeState === 'object'
    ? node.citySiegeState
    : {};
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

const settleNodeSiegeState = (node, nowDate = new Date()) => {
  if (!node || !node.citySiegeState) return false;
  let changed = false;
  const nowMs = nowDate.getTime();

  for (const gateKey of CITY_GATE_KEYS) {
    const gate = node.citySiegeState?.[gateKey];
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
      const gate = node.citySiegeState?.[gateKey];
      if (gate && typeof gate === 'object') {
        gate.updatedAt = nowDate;
      }
    }
  }
  return changed;
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

const buildAllianceNodeGraph = (nodes = []) => {
  const nameToId = new Map();
  const idToNode = new Map();
  const adjacency = new Map();

  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    const nodeId = getIdString(node?._id);
    const nodeName = typeof node?.name === 'string' ? node.name : '';
    if (!nodeId || !nodeName) return;
    nameToId.set(nodeName, nodeId);
    idToNode.set(nodeId, node);
    adjacency.set(nodeId, new Set());
  });

  const link = (idA, idB) => {
    if (!idA || !idB || idA === idB) return;
    adjacency.get(idA)?.add(idB);
    adjacency.get(idB)?.add(idA);
  };

  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    const nodeId = getIdString(node?._id);
    if (!nodeId) return;
    (Array.isArray(node?.relatedParentDomains) ? node.relatedParentDomains : []).forEach((name) => {
      const targetId = nameToId.get(name);
      if (targetId) link(nodeId, targetId);
    });
    (Array.isArray(node?.relatedChildDomains) ? node.relatedChildDomains : []).forEach((name) => {
      const targetId = nameToId.get(name);
      if (targetId) link(nodeId, targetId);
    });
  });

  return { nameToId, idToNode, adjacency };
};

const bfsPath = (startId, targetId, adjacency = new Map()) => {
  if (!startId || !targetId) return null;
  if (startId === targetId) return [startId];
  const queue = [startId];
  const visited = new Set([startId]);
  const prev = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || new Set();
    for (const next of neighbors) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, current);
      if (next === targetId) {
        const path = [targetId];
        let walk = targetId;
        while (prev.has(walk)) {
          walk = prev.get(walk);
          path.push(walk);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
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

  const serializedDefenseLayout = serializeDefenseLayout(node?.cityDefenseLayout || {});
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

const serializeDistributionLock = (locked = null) => {
  if (!locked) return null;
  const executeAtMs = new Date(locked.executeAt || 0).getTime();
  const entryCloseAtMsRaw = new Date(locked.entryCloseAt || 0).getTime();
  const endAtMsRaw = new Date(locked.endAt || 0).getTime();
  const entryCloseAt = Number.isFinite(entryCloseAtMsRaw) && entryCloseAtMsRaw > 0
    ? new Date(entryCloseAtMsRaw)
    : (Number.isFinite(executeAtMs) && executeAtMs > 0 ? new Date(executeAtMs - 60 * 1000) : null);
  const endAt = Number.isFinite(endAtMsRaw) && endAtMsRaw > 0
    ? new Date(endAtMsRaw)
    : (Number.isFinite(executeAtMs) && executeAtMs > 0 ? new Date(executeAtMs + 60 * 1000) : null);
  const participants = (Array.isArray(locked.participants) ? locked.participants : []).map((item) => ({
    userId: getIdString(item?.userId),
    joinedAt: item?.joinedAt || null,
    exitedAt: item?.exitedAt || null
  })).filter((item) => isValidObjectId(item.userId));
  const resultUserRewards = (Array.isArray(locked.resultUserRewards) ? locked.resultUserRewards : []).map((item) => ({
    userId: getIdString(item?.userId),
    amount: round2(Math.max(0, Number(item?.amount) || 0))
  })).filter((item) => isValidObjectId(item.userId));
  const activeParticipantCount = participants.filter((item) => !item.exitedAt).length;
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

const getActiveManualParticipantSet = (lock = {}, atMs = Date.now()) => (
  new Set(
    KnowledgeDistributionService
      .getActiveManualParticipantIds(lock || {}, atMs)
      .map((id) => getIdString(id))
      .filter((id) => isValidObjectId(id))
  )
);

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
    const nodes = await Node.find({ status: 'approved' })
      .select('_id name description synonymSenses knowledgePoint contentScore')
      .lean();

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

// 创建节点（普通用户需要申请，管理员直接创建）
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
      return res.status(400).json({ error: '该节点标题已被使用（已有同名的审核通过节点）' });
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
          message: '已有用户提交了同名节点的申请，请先处理这些申请',
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

    const rawAssociations = Array.isArray(associations) ? associations : [];
    if (rawAssociations.length === 0) {
      return res.status(400).json({ error: '每个释义至少需要一个关联关系' });
    }

    const localSenseIdSet = new Set(uniqueSenses.map((item) => item.senseId));
    const normalizedAssociations = normalizeAssociationDraftList(rawAssociations, localSenseIdSet);

    if (normalizedAssociations.length === 0) {
      return res.status(400).json({ error: '创建知识域必须至少有一个有效关联关系' });
    }

    // 验证关联关系目标节点和目标释义
    const targetNodeIds = Array.from(new Set(normalizedAssociations.map((item) => item.targetNode)));
    const targetNodes = targetNodeIds.length > 0
      ? await Node.find({ _id: { $in: targetNodeIds }, status: 'approved' })
          .select('_id name synonymSenses description')
          .lean()
      : [];
    const targetNodeMap = new Map(targetNodes.map((item) => [getIdString(item._id), item]));
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

    // 验证：每个释义至少有一个关联关系
    const coveredSourceSenseSet = new Set(normalizedAssociations.map((item) => item.sourceSenseId).filter(Boolean));
    const missingRelationSenses = uniqueSenses.filter((item) => !coveredSourceSenseSet.has(item.senseId));
    if (missingRelationSenses.length > 0) {
      return res.status(400).json({
        error: `每个释义至少需要一个关联关系，未满足：${missingRelationSenses.map((item) => item.title).join('、')}`
      });
    }

    const {
      error: associationResolveError,
      effectiveAssociations,
      insertPlans
    } = resolveAssociationsWithInsertPlans(normalizedAssociations);
    if (associationResolveError) {
      return res.status(400).json({ error: associationResolveError });
    }
    const effectiveRelationRuleValidation = validateAssociationRuleSet({
      currentNodeId: '',
      associations: effectiveAssociations
    });
    if (effectiveRelationRuleValidation.error) {
      return res.status(400).json({ error: effectiveRelationRuleValidation.error });
    }

    const associationsForStorage = isUserAdmin ? effectiveAssociations : normalizedAssociations;
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
      contentScore: 1 // 新建节点默认内容分数为1
    });

    await node.save();

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
    console.error('创建节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取待审批节点列表
router.get('/pending', authenticateToken, isAdmin, async (req, res) => {
  try {
    const nodes = await Node.find({ status: 'pending' })
      .populate('owner', 'username profession')
      .populate('associations.targetNode', 'name description');
    res.json(nodes);
  } catch (error) {
    console.error('获取待审批节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 审批节点
router.post('/approve', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const node = await Node.findById(nodeId).populate('associations.targetNode', 'name');

    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 检查是否已有同名的已审核节点
    const existingApproved = await Node.findOne({ name: node.name, status: 'approved' });
    if (existingApproved) {
      return res.status(400).json({ error: '已存在同名的审核通过节点，无法批准此申请' });
    }

    const localSenseIdSet = new Set(normalizeNodeSenseList(node).map((item) => item.senseId));
    const normalizedAssociations = normalizeAssociationDraftList(node.associations, localSenseIdSet);
    if (normalizedAssociations.length === 0) {
      return res.status(400).json({ error: '该节点缺少有效关联关系，无法审批通过' });
    }

    const targetNodeIds = Array.from(new Set(normalizedAssociations.map((item) => item.targetNode)));
    const targetNodes = targetNodeIds.length > 0
      ? await Node.find({ _id: { $in: targetNodeIds }, status: 'approved' })
          .select('_id name synonymSenses description')
          .lean()
      : [];
    const targetNodeMap = new Map(targetNodes.map((item) => [getIdString(item._id), item]));
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

    const {
      error: associationResolveError,
      effectiveAssociations,
      insertPlans
    } = resolveAssociationsWithInsertPlans(normalizedAssociations);
    if (associationResolveError) {
      return res.status(400).json({ error: associationResolveError });
    }
    const effectiveRelationRuleValidation = validateAssociationRuleSet({
      currentNodeId: node._id,
      associations: effectiveAssociations
    });
    if (effectiveRelationRuleValidation.error) {
      return res.status(400).json({ error: effectiveRelationRuleValidation.error });
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
    } else if (node.domainMaster) {
      const currentMaster = await User.findById(node.domainMaster).select('role allianceId');
      if (!currentMaster || currentMaster.role === 'admin') {
        node.domainMaster = null;
        node.allianceId = null;
      } else {
        node.allianceId = currentMaster.allianceId || null;
      }
    } else {
      node.allianceId = null;
    }
    // 设置默认内容分数为1
    node.contentScore = 1;
    await node.save();

    // 自动拒绝其他同名的待审核节点
    const rejectedNodes = await Node.find({
      name: node.name,
      status: 'pending',
      _id: { $ne: node._id }
    }).populate('owner', 'username');

    const rejectedInfo = [];
    for (const rejectedNode of rejectedNodes) {
      rejectedInfo.push({
        id: rejectedNode._id,
        owner: rejectedNode.owner?.username || '未知用户'
      });
      // 删除被拒绝的节点
      await Node.findByIdAndDelete(rejectedNode._id);
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

// 拒绝节点（直接删除）
router.post('/reject', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.body;
    
    const node = await Node.findByIdAndDelete(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 从用户拥有的节点列表中移除（如果已添加）
    await User.findByIdAndUpdate(node.owner, {
      $pull: { ownedNodes: nodeId }
    });

    res.json({
      success: true,
      message: '节点申请已被拒绝并删除',
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
    res.status(200).json(node);
  } catch (error) {
    console.error('拒绝节点关联错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取所有节点（管理员专用）
router.get('/', authenticateToken, isAdmin, async (req, res) => {
  try {
    const nodes = await Node.find()
      .populate('owner', 'username profession')
      .populate('domainMaster', 'username profession')
      .populate('associations.targetNode', 'name description synonymSenses')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: nodes.length,
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
    const { name, description, prosperity, contentScore } = req.body;

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

    await node.save();

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

// 删除节点（管理员专用）
router.post('/:nodeId/delete-preview', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { onRemovalStrategy, bridgeDecisions } = req.body || {};

    const node = await Node.findById(nodeId).select('name synonymSenses associations');
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

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
    const node = await Node.updateKnowledgePoint(req.params.id);
    if (!node) {
      return res.status(404).json({ message: '节点不存在' });
    }
    
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
    // 查找所有已批准的节点
    const nodes = await Node.find({ status: 'approved' })
      .populate('owner', 'username profession')
      .select('name description synonymSenses relatedParentDomains relatedChildDomains knowledgePoint contentScore domainMaster allianceId');

    // 过滤出根节点（没有母节点的节点）
    const rootNodes = nodes.filter(node =>
      !node.relatedParentDomains || node.relatedParentDomains.length === 0
    );
    const styledRootNodes = await attachVisualStyleToNodeList(rootNodes);
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
      nodes: normalizedRootNodes
    });
  } catch (error) {
    console.error('获取根节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取热门节点（所有用户可访问）
router.get('/public/featured-nodes', async (req, res) => {
  try {
    const featuredNodes = await Node.find({
      status: 'approved',
      isFeatured: true
    })
      .populate('owner', 'username profession')
      .sort({ featuredOrder: 1, createdAt: -1 })
      .select('name description synonymSenses relatedParentDomains relatedChildDomains knowledgePoint contentScore isFeatured featuredOrder domainMaster allianceId');
    const styledFeaturedNodes = await attachVisualStyleToNodeList(featuredNodes);
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

    const allNodes = await Node.find({ status: 'approved' })
      .populate('owner', 'username profession')
      .select('name description synonymSenses relatedParentDomains relatedChildDomains knowledgePoint contentScore');

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
    const maxDepth = toSafeInteger(req.query?.depth, 1, { min: 1, max: 7 });
    const maxNodes = toSafeInteger(req.query?.limit, 160, { min: 20, max: 500 });

    if (!isValidObjectId(nodeId)) {
      return res.status(400).json({ error: '无效的节点ID' });
    }

    const center = await Node.findById(nodeId)
      .select('name description synonymSenses knowledgePoint contentScore domainMaster allianceId status');
    if (!center) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (center.status !== 'approved') {
      return res.status(403).json({ error: '该节点未审批' });
    }

    const approvedNodes = await Node.find({ status: 'approved' })
      .select('name description synonymSenses knowledgePoint contentScore domainMaster allianceId associations status')
      .lean();
    const graph = buildTitleGraphFromNodes({
      nodeDocs: approvedNodes,
      centerNodeId: nodeId,
      maxDepth,
      maxNodes
    });
    const centerNodeId = getIdString(nodeId);
    const nodeById = new Map(approvedNodes.map((item) => [getIdString(item._id), item]));

    if (!graph.orderedNodeIds.includes(centerNodeId)) {
      graph.orderedNodeIds = [centerNodeId];
      graph.levelByNodeId = { [centerNodeId]: 0 };
      graph.edgeList = [];
    } else {
      const directEdges = (Array.isArray(graph.edgeList) ? graph.edgeList : [])
        .filter((edge) => edge?.nodeAId === centerNodeId || edge?.nodeBId === centerNodeId);
      const directNeighborSet = new Set();
      directEdges.forEach((edge) => {
        const peerId = edge.nodeAId === centerNodeId ? edge.nodeBId : edge.nodeAId;
        if (peerId) directNeighborSet.add(peerId);
      });
      const directNeighborIds = Array.from(directNeighborSet)
        .filter((item) => item && item !== centerNodeId)
        .sort((a, b) => {
          const nameA = nodeById.get(a)?.name || '';
          const nameB = nodeById.get(b)?.name || '';
          return nameA.localeCompare(nameB, 'zh-Hans-CN');
        });

      graph.orderedNodeIds = [centerNodeId, ...directNeighborIds];
      graph.levelByNodeId = { [centerNodeId]: 0 };
      directNeighborIds.forEach((id) => {
        graph.levelByNodeId[id] = 1;
      });
      graph.edgeList = directEdges;
    }

    const selectedNodes = graph.orderedNodeIds
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .map((item) => buildNodeTitleCard(item));
    const styledSelectedNodes = await attachVisualStyleToNodeList(selectedNodes);

    const styledNodeById = new Map(styledSelectedNodes.map((item) => [getIdString(item?._id), item]));
    const centerNode = styledNodeById.get(getIdString(nodeId)) || buildNodeTitleCard(center);
    const edgeList = graph.edgeList.map((edge) => {
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
        edges: edgeList,
        levelByNodeId: graph.levelByNodeId,
        maxLevel: Math.max(0, ...Object.values(graph.levelByNodeId || {}).map((value) => Number(value) || 0)),
        nodeCount: styledSelectedNodes.length,
        edgeCount: edgeList.length
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

    const relationByTargetNodeId = relationAssociations.reduce((acc, assoc) => {
      const key = getIdString(assoc?.targetNode);
      if (!key || acc.has(key)) return acc;
      acc.set(key, assoc);
      return acc;
    }, new Map());

    const decorateNodeWithSense = (rawNode) => {
      const source = rawNode && typeof rawNode.toObject === 'function' ? rawNode.toObject() : rawNode;
      const targetNodeId = getIdString(source?._id);
      const assoc = relationByTargetNodeId.get(targetNodeId);
      const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
      const pickedSense = pickNodeSenseById(source, targetSenseId);
      return {
        ...source,
        synonymSenses: normalizeNodeSenseList(source),
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
    const nodes = await Node.find({ status: 'approved' })
      .select('_id name description relatedParentDomains relatedChildDomains')
      .lean();

    res.json({
      success: true,
      nodes: nodes
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

    for (const adminUser of adminUsers) {
      adminUser.notifications.unshift({
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
      return res.json({
        success: true,
        message: '该知识域当前无域主，已自动卸任域相'
      });
    }

    const domainMaster = await User.findById(domainMasterId).select('username notifications');
    if (!domainMaster) {
      node.domainAdmins = (node.domainAdmins || []).filter((adminId) => getIdString(adminId) !== requestUserId);
      await node.save();
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

    domainMaster.notifications.unshift({
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

    const node = await Node.findById(nodeId).select('name domainMaster domainAdmins cityDefenseLayout');

    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

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
    const gateDefenseViewerAdminIds = normalizeGateDefenseViewerAdminIds(
      node?.cityDefenseLayout?.gateDefenseViewAdminIds,
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

    invitee.notifications.unshift({
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

    const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins cityDefenseLayout');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (!isDomainMaster(node, requestUserId)) {
      return res.status(403).json({ error: '只有域主可以配置承口/启口可查看权限' });
    }

    const viewerAdminIds = normalizeGateDefenseViewerAdminIds(
      req.body?.viewerAdminIds,
      (node.domainAdmins || []).map((id) => getIdString(id))
    );

    const currentLayout = serializeDefenseLayout(node.cityDefenseLayout || {});
    node.cityDefenseLayout = {
      ...currentLayout,
      gateDefenseViewAdminIds: viewerAdminIds,
      updatedAt: new Date()
    };
    await node.save();

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
      Node.findById(nodeId).select('name status domainMaster domainAdmins cityDefenseLayout'),
      User.findById(requestUserId).select('role location intelDomainSnapshots')
    ]);

    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
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
      Node.findById(nodeId).select('name status domainMaster domainAdmins cityDefenseLayout'),
      User.findById(requestUserId).select('role location intelDomainSnapshots')
    ]);
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const permission = checkIntelHeistPermission({ node, user });
    if (!permission.allowed) {
      return res.status(403).json({ error: permission.reason || '当前不可执行情报窃取' });
    }

    const serializedLayout = serializeDefenseLayout(node.cityDefenseLayout || {});
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
      deploymentUpdatedAt: node?.cityDefenseLayout?.updatedAt || null,
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

    const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins cityDefenseLayout');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }

    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }

    const canEdit = isDomainMaster(node, requestUserId);
    const gateDefenseViewerAdminIds = normalizeGateDefenseViewerAdminIds(
      node?.cityDefenseLayout?.gateDefenseViewAdminIds,
      (node.domainAdmins || []).map((id) => getIdString(id))
    );
    const canViewGateDefense = canEdit || gateDefenseViewerAdminIds.includes(requestUserId);
    const serializedLayout = serializeDefenseLayout(node.cityDefenseLayout || {});
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

    const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins cityDefenseLayout');
    if (!node || node.status !== 'approved') {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }

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
    const existingViewerAdminIds = normalizeGateDefenseViewerAdminIds(
      node?.cityDefenseLayout?.gateDefenseViewAdminIds,
      (node.domainAdmins || []).map((id) => getIdString(id))
    );
    const nextViewerAdminIds = payloadHasViewerIds
      ? normalizeGateDefenseViewerAdminIds(normalizedLayout.gateDefenseViewAdminIds, (node.domainAdmins || []).map((id) => getIdString(id)))
      : existingViewerAdminIds;

    node.cityDefenseLayout = {
      ...normalizedLayout,
      gateDefenseViewAdminIds: nextViewerAdminIds,
      updatedAt: new Date()
    };
    await node.save();

    res.json({
      success: true,
      message: '城防配置已保存',
      nodeId: getIdString(node._id),
      layout: serializeDefenseLayout(node.cityDefenseLayout || normalizedLayout),
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
      Node.findById(nodeId).select('name status domainMaster domainAdmins relatedParentDomains relatedChildDomains cityDefenseLayout citySiegeState'),
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

    const changed = settleNodeSiegeState(node, new Date());
    if (changed) {
      await node.save();
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
      Node.findById(nodeId).select('name status domainMaster domainAdmins relatedParentDomains relatedChildDomains cityDefenseLayout citySiegeState'),
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

    settleNodeSiegeState(node, new Date());

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

    const nextAttackers = Array.isArray(node.citySiegeState?.[gateKey]?.attackers)
      ? node.citySiegeState[gateKey].attackers.filter((item) => getIdString(item?.userId) !== requestUserId)
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

    node.citySiegeState[gateKey] = {
      ...(node.citySiegeState?.[gateKey]?.toObject?.() || node.citySiegeState?.[gateKey] || {}),
      active: true,
      startedAt: node.citySiegeState?.[gateKey]?.startedAt || now,
      updatedAt: now,
      attackerAllianceId: user.allianceId || null,
      initiatorUserId: user._id,
      initiatorUsername: user.username || '',
      attackers: nextAttackers
    };
    await node.save();

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
      Node.findById(nodeId).select('name status citySiegeState'),
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

    settleNodeSiegeState(node, new Date());

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
    node.citySiegeState[targetGateKey].supportNotifiedAt = now;
    node.citySiegeState[targetGateKey].updatedAt = now;
    await node.save();

    const members = await User.find({
      _id: { $ne: user._id },
      role: 'common',
      allianceId: user.allianceId
    }).select('_id notifications');

    const notifyMessage = `熵盟成员 ${user.username} 在知识域「${node.name}」${CITY_GATE_LABELS[targetGateKey]}发起围城，点击可查看并支援`;
    for (const member of members) {
      member.notifications = Array.isArray(member.notifications) ? member.notifications : [];
      member.notifications.unshift({
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
      await member.save();
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
      message: `已呼叫熵盟支援（通知 ${members.length} 人）`,
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

    const [node, user, unitTypes, approvedNodes] = await Promise.all([
      Node.findById(nodeId).select('name status domainMaster domainAdmins relatedParentDomains relatedChildDomains citySiegeState cityDefenseLayout'),
      User.findById(requestUserId).select('username role location allianceId armyRoster intelDomainSnapshots'),
      fetchArmyUnitTypes(),
      Node.find({ status: 'approved' }).select('_id name relatedParentDomains relatedChildDomains citySiegeState').lean()
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

    settleNodeSiegeState(node, new Date());

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
    const committedNodes = await Node.find({
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

    const graph = buildAllianceNodeGraph(approvedNodes);
    const currentLocationName = (user.location || '').trim();
    const startNodeId = graph.nameToId.get(currentLocationName) || '';
    if (!startNodeId) {
      return res.status(400).json({ error: '当前所在知识域无效，无法派遣支援' });
    }

    const sideNameSet = new Set(
      (targetGateKey === 'cheng' ? node.relatedParentDomains : node.relatedChildDomains)
        .filter((name) => typeof name === 'string' && !!name.trim())
    );
    const sideNodes = approvedNodes.filter((item) => sideNameSet.has(item.name));
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

    let selectedSupportPath = null;
    for (const sideNode of sideNodes) {
      if (isBlockedByOtherAllianceSiege(sideNode)) continue;
      const sideNodeId = getIdString(sideNode._id);
      const path = bfsPath(startNodeId, sideNodeId, graph.adjacency);
      if (!Array.isArray(path) || path.length === 0) continue;
      const distanceUnits = (path.length - 1) + 1; // 额外 +1 表示从同侧节点进入目标门
      if (!selectedSupportPath || distanceUnits < selectedSupportPath.distanceUnits) {
        selectedSupportPath = {
          sideNodeId,
          sideNodeName: sideNode.name,
          path,
          distanceUnits
        };
      }
    }

    if (!selectedSupportPath) {
      return res.status(409).json({ error: `同侧路径已被封锁，当前无法支援${CITY_GATE_LABELS[targetGateKey]}` });
    }

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
      fromNodeId: graph.idToNode.get(startNodeId)?._id || null,
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

    node.citySiegeState[targetGateKey] = {
      ...(node.citySiegeState?.[targetGateKey]?.toObject?.() || node.citySiegeState?.[targetGateKey] || {}),
      active: true,
      startedAt: node.citySiegeState?.[targetGateKey]?.startedAt || now,
      updatedAt: now,
      attackerAllianceId: node.citySiegeState?.[targetGateKey]?.attackerAllianceId || user.allianceId || null,
      attackers: nextAttackers
    };
    await node.save();

    const initiatorUserId = getIdString(node.citySiegeState?.[targetGateKey]?.initiatorUserId);
    if (isValidObjectId(initiatorUserId) && initiatorUserId !== requestUserId) {
      const initiatorUser = await User.findById(initiatorUserId).select('notifications');
      if (initiatorUser) {
        initiatorUser.notifications = Array.isArray(initiatorUser.notifications) ? initiatorUser.notifications : [];
        initiatorUser.notifications.unshift({
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
      Node.findById(nodeId).select('name status citySiegeState'),
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

    settleNodeSiegeState(node, new Date());

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
    node.citySiegeState[targetGateKey] = {
      ...createEmptySiegeGateState(),
      updatedAt: now
    };
    await node.save();

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

    const nodes = await Node.find({
      status: 'approved',
      $or: [
        { 'citySiegeState.cheng.attackers.userId': new mongoose.Types.ObjectId(requestUserId) },
        { 'citySiegeState.qi.attackers.userId': new mongoose.Types.ObjectId(requestUserId) }
      ]
    }).select('name citySiegeState');
    const unitTypes = await fetchArmyUnitTypes();
    const unitTypeMap = buildArmyUnitTypeMap(unitTypes);
    const nowMs = Date.now();

    const rows = [];
    for (const node of nodes) {
      const changed = settleNodeSiegeState(node, new Date(nowMs));
      if (changed) {
        await node.save();
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

    const refreshedNode = await Node.updateKnowledgePoint(node._id);
    if (!refreshedNode) {
      return res.status(404).json({ error: '知识域不存在或不可操作' });
    }

    const minutesToExecute = Math.max(0, (executeAt.getTime() - now.getTime()) / (1000 * 60));
    const projectedTotal = round2(
      (Number(refreshedNode.knowledgePoint?.value) || 0) +
      (Number(refreshedNode.knowledgeDistributionCarryover) || 0) +
      minutesToExecute * (Number(refreshedNode.contentScore) || 0)
    );
    const distributionPercent = selectedRule?.distributionScope === 'partial'
      ? round2(clampPercent(selectedRule?.distributionPercent, 100))
      : 100;
    const projectedDistributableTotal = round2(projectedTotal * (distributionPercent / 100));
    const entryCloseAt = new Date(executeAt.getTime() - 60 * 1000);
    const endAt = new Date(executeAt.getTime() + 60 * 1000);

    refreshedNode.knowledgeDistributionLocked = {
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
    refreshedNode.knowledgeDistributionLastAnnouncedAt = now;
    await refreshedNode.save();

    await KnowledgeDistributionService.publishAnnouncementNotifications({
      node: refreshedNode,
      masterUser,
      lock: refreshedNode.knowledgeDistributionLocked
    });

    return res.json({
      success: true,
      message: '分发计划已发布并锁定，不可撤回',
      nodeId: refreshedNode._id,
      nodeName: refreshedNode.name,
      activeRuleId: selectedProfile.profileId,
      activeRuleName: selectedProfile.name,
      knowledgePointValue: round2(Number(refreshedNode?.knowledgePoint?.value) || 0),
      carryoverValue: round2(Number(refreshedNode?.knowledgeDistributionCarryover) || 0),
      locked: serializeDistributionLock(refreshedNode.knowledgeDistributionLocked || null),
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

    const manualParticipantSet = getActiveManualParticipantSet(lock, nowMs);
    const isJoinedManual = manualParticipantSet.has(currentUserId);
    const joined = autoEntry || isJoinedManual;
    const requiresManualEntry = !autoEntry && !isSystemAdminRole;
    const autoJoinOrderMsRaw = new Date(lock.announcedAt || lock.executeAt || 0).getTime();
    const autoJoinOrderMs = Number.isFinite(autoJoinOrderMsRaw) && autoJoinOrderMsRaw > 0 ? autoJoinOrderMsRaw : 0;
    const manualJoinOrderMap = new Map();
    for (const item of (Array.isArray(lock.participants) ? lock.participants : [])) {
      const userId = getIdString(item?.userId);
      if (!isValidObjectId(userId)) continue;
      const joinedAtMs = new Date(item?.joinedAt || 0).getTime();
      const orderMs = Number.isFinite(joinedAtMs) && joinedAtMs > 0 ? joinedAtMs : Number.MAX_SAFE_INTEGER;
      manualJoinOrderMap.set(userId, orderMs);
    }
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
    const poolUsers = selectedPool
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
        users: poolUsers
      } : {
        key: '',
        label: '',
        poolPercent: 0,
        participantCount: 0,
        userActualPercent: 0,
        estimatedReward: 0,
        rewardValue,
        rewardFrozen,
        users: []
      }
    });
  } catch (error) {
    console.error('获取分发参与状态错误:', error);
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

    const nextParticipants = Array.isArray(lock.participants) ? [...lock.participants] : [];
    const existingIndex = nextParticipants.findIndex((item) => getIdString(item?.userId) === currentUserId);
    const now = new Date();
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
    } else {
      nextParticipants.push({
        userId: new mongoose.Types.ObjectId(currentUserId),
        joinedAt: now,
        exitedAt: null
      });
    }

    node.knowledgeDistributionLocked.participants = nextParticipants;
    await node.save();

    return res.json({
      success: true,
      joined: true,
      message: `你已参与知识域「${node.name}」的分发活动`
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

    const nextParticipants = Array.isArray(lock.participants) ? [...lock.participants] : [];
    const existingIndex = nextParticipants.findIndex((item) => (
      getIdString(item?.userId) === currentUserId && !item?.exitedAt
    ));
    if (existingIndex < 0) {
      return res.json({
        success: true,
        exited: true,
        message: '你当前未参与该分发活动'
      });
    }

    nextParticipants[existingIndex] = {
      ...nextParticipants[existingIndex],
      exitedAt: new Date()
    };
    node.knowledgeDistributionLocked.participants = nextParticipants;
    await node.save();

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
