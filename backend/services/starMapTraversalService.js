const mongoose = require('mongoose');
const Node = require('../models/Node');
const {
  hydrateNodeSensesForNodes,
  resolveNodeSensesForNode
} = require('./nodeSenseStore');
const {
  isDomainTitleProjectionReadEnabled,
  listActiveTitleRelationsBySourceNodeIds,
  listActiveTitleRelationsByTargetNodeIds
} = require('./domainTitleProjectionStore');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const getIdString = (value) => {
  if (!value) return '';
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const normalizeRelationType = (value) => (
  value === 'contains' || value === 'extends' ? value : ''
);

const buildNodeSenseDisplayName = (nodeName = '', senseTitle = '') => {
  const safeName = typeof nodeName === 'string' ? nodeName.trim() : '';
  const safeTitle = typeof senseTitle === 'string' ? senseTitle.trim() : '';
  return safeTitle ? `${safeName}-${safeTitle}` : safeName;
};

const toVertexKey = (nodeId = '', senseId = '') => `${getIdString(nodeId)}::${String(senseId || '').trim()}`;

const buildNodeSenseList = (node = {}) => {
  const resolved = resolveNodeSensesForNode(node, {
    fallbackDescription: typeof node?.description === 'string' ? node.description : ''
  });
  return Array.isArray(resolved?.senses) ? resolved.senses : [];
};

const pickSenseForNode = (node = {}, requestedSenseId = '') => {
  const senses = buildNodeSenseList(node);
  const safeRequestedSenseId = typeof requestedSenseId === 'string' ? requestedSenseId.trim() : '';
  if (!safeRequestedSenseId) {
    return senses[0] || {
      senseId: 'sense_1',
      title: '基础释义',
      content: typeof node?.description === 'string' ? node.description : ''
    };
  }
  return senses.find((item) => item?.senseId === safeRequestedSenseId) || senses[0] || {
    senseId: safeRequestedSenseId,
    title: '基础释义',
    content: typeof node?.description === 'string' ? node.description : ''
  };
};

const decorateNodeWithSense = (node = {}, senseId = '') => {
  const source = node && typeof node.toObject === 'function' ? node.toObject() : { ...node };
  const pickedSense = pickSenseForNode(source, senseId);
  return {
    ...source,
    activeSenseId: pickedSense?.senseId || '',
    activeSenseTitle: pickedSense?.title || '',
    activeSenseContent: pickedSense?.content || '',
    displayName: buildNodeSenseDisplayName(source?.name || '', pickedSense?.title || ''),
    vertexKey: toVertexKey(source?._id, pickedSense?.senseId || '')
  };
};

const ensureApprovedNodeCache = async (nodeCache, nodeIds = []) => {
  const missingIds = Array.from(new Set(
    (Array.isArray(nodeIds) ? nodeIds : [])
      .map((item) => getIdString(item))
      .filter((id) => isValidObjectId(id) && !nodeCache.has(id))
  ));
  if (missingIds.length < 1) return [];

  const docs = await Node.find({
    _id: { $in: missingIds.map((id) => new mongoose.Types.ObjectId(id)) },
    status: 'approved'
  })
    .select('name description synonymSenses knowledgePoint contentScore domainMaster domainAdmins allianceId associations status')
    .lean();

  await hydrateNodeSensesForNodes(docs);
  docs.forEach((doc) => {
    nodeCache.set(getIdString(doc?._id), doc);
  });
  return docs;
};

const createBoundaryAccumulator = () => ({
  hiddenNeighborKeys: new Set(),
  containsCount: 0,
  extendsCount: 0
});

const appendBoundaryRelation = (boundaryMap, sourceKey, hiddenNeighborKey, relationType) => {
  if (!sourceKey || !hiddenNeighborKey) return;
  let entry = boundaryMap.get(sourceKey);
  if (!entry) {
    entry = createBoundaryAccumulator();
    boundaryMap.set(sourceKey, entry);
  }
  entry.hiddenNeighborKeys.add(hiddenNeighborKey);
  if (relationType === 'contains') {
    entry.containsCount += 1;
  } else if (relationType === 'extends') {
    entry.extendsCount += 1;
  }
};

const buildTitleRelationRecordKey = (row = {}) => {
  const sourceNodeId = getIdString(row?.sourceNodeId);
  const targetNodeId = getIdString(row?.targetNodeId || row?.targetNode);
  const relationType = normalizeRelationType(row?.relationType);
  const sourceSenseId = typeof row?.sourceSenseId === 'string' ? row.sourceSenseId.trim() : '';
  const targetSenseId = typeof row?.targetSenseId === 'string' ? row.targetSenseId.trim() : '';
  return [sourceNodeId, relationType, targetNodeId, sourceSenseId, targetSenseId].join('|');
};

const addTitleEdgeAggregate = (edgeMap, row = {}) => {
  const sourceNodeId = getIdString(row?.sourceNodeId);
  const targetNodeId = getIdString(row?.targetNodeId || row?.targetNode);
  const relationType = normalizeRelationType(row?.relationType);
  if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId || !relationType) return;

  const nodeAId = sourceNodeId < targetNodeId ? sourceNodeId : targetNodeId;
  const nodeBId = sourceNodeId < targetNodeId ? targetNodeId : sourceNodeId;
  const edgeId = `${nodeAId}|${nodeBId}`;
  let edge = edgeMap.get(edgeId);
  if (!edge) {
    edge = {
      edgeId,
      nodeAId,
      nodeBId,
      pairCount: 0,
      containsCount: 0,
      extendsCount: 0
    };
    edgeMap.set(edgeId, edge);
  }
  edge.pairCount += 1;
  if (relationType === 'contains') {
    edge.containsCount += 1;
  } else if (relationType === 'extends') {
    edge.extendsCount += 1;
  }
};

const normalizeNodeAssociationRows = (node = {}) => (
  (Array.isArray(node?.associations) ? node.associations : [])
    .map((assoc, index) => ({
      relationRecordKey: [
        getIdString(node?._id),
        normalizeRelationType(assoc?.relationType),
        getIdString(assoc?.targetNode),
        typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '',
        typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '',
        String(index)
      ].join('|'),
      sourceNodeId: getIdString(node?._id),
      targetNodeId: getIdString(assoc?.targetNode),
      relationType: normalizeRelationType(assoc?.relationType),
      sourceSenseId: typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '',
      targetSenseId: typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : ''
    }))
    .filter((assoc) => assoc.sourceNodeId && assoc.targetNodeId && assoc.relationType)
);

const buildSenseRelationRecordKey = ({ sourceVertexKey, targetVertexKey, relationType }) => (
  `${String(sourceVertexKey || '')}|${String(relationType || '')}|${String(targetVertexKey || '')}`
);

const addSenseEdgeAggregate = (edgeMap, sourceVertexKey, targetVertexKey, relationType) => {
  if (!sourceVertexKey || !targetVertexKey || sourceVertexKey === targetVertexKey || !relationType) return;
  const edgeId = sourceVertexKey < targetVertexKey
    ? `${sourceVertexKey}|${targetVertexKey}`
    : `${targetVertexKey}|${sourceVertexKey}`;
  let edge = edgeMap.get(edgeId);
  if (!edge) {
    edge = {
      edgeId,
      fromVertexKey: sourceVertexKey < targetVertexKey ? sourceVertexKey : targetVertexKey,
      toVertexKey: sourceVertexKey < targetVertexKey ? targetVertexKey : sourceVertexKey,
      pairCount: 0,
      containsCount: 0,
      extendsCount: 0
    };
    edgeMap.set(edgeId, edge);
  }
  edge.pairCount += 1;
  if (relationType === 'contains') {
    edge.containsCount += 1;
  } else if (relationType === 'extends') {
    edge.extendsCount += 1;
  }
};

const loadTitleRelationsForFrontier = async (frontierNodeIds = []) => {
  if (!isDomainTitleProjectionReadEnabled()) {
    const nodeCache = new Map();
    const docs = await ensureApprovedNodeCache(nodeCache, frontierNodeIds);
    const outgoing = docs.flatMap((doc) => normalizeNodeAssociationRows(doc));
    const incomingDocs = await Node.find({
      status: 'approved',
      'associations.targetNode': {
        $in: frontierNodeIds
          .map((id) => getIdString(id))
          .filter((id) => isValidObjectId(id))
          .map((id) => new mongoose.Types.ObjectId(id))
      }
    })
      .select('_id associations')
      .lean();
    const incoming = incomingDocs.flatMap((doc) => normalizeNodeAssociationRows(doc));
    return { outgoing, incoming };
  }

  const [outgoing, incoming] = await Promise.all([
    listActiveTitleRelationsBySourceNodeIds(frontierNodeIds),
    listActiveTitleRelationsByTargetNodeIds(frontierNodeIds)
  ]);
  return { outgoing, incoming };
};

const traverseTitleStarMap = async ({ centerNodeId, limit = 50 } = {}) => {
  const safeCenterNodeId = getIdString(centerNodeId);
  if (!isValidObjectId(safeCenterNodeId)) {
    const error = new Error('无效的节点ID');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  const levelByNodeId = { [safeCenterNodeId]: 0 };
  const includedNodeIds = [safeCenterNodeId];
  const includedSet = new Set(includedNodeIds);
  const queuedSet = new Set(includedNodeIds);
  const edgeMap = new Map();
  const boundaryMap = new Map();
  const processedRelationKeys = new Set();
  let frontier = [safeCenterNodeId];

  while (frontier.length > 0 && includedNodeIds.length <= limit) {
    const frontierSet = new Set(frontier);
    const { outgoing, incoming } = await loadTitleRelationsForFrontier(frontier);
    const rowsByCurrentNodeId = new Map(frontier.map((nodeId) => [nodeId, []]));

    (Array.isArray(outgoing) ? outgoing : []).forEach((row) => {
      const sourceNodeId = getIdString(row?.sourceNodeId);
      const targetNodeId = getIdString(row?.targetNodeId || row?.targetNode);
      const relationType = normalizeRelationType(row?.relationType);
      if (!relationType || !frontierSet.has(sourceNodeId) || !targetNodeId || sourceNodeId === targetNodeId) return;
      rowsByCurrentNodeId.get(sourceNodeId).push({
        relationRecordKey: buildTitleRelationRecordKey(row),
        sourceNodeId,
        targetNodeId,
        relationType
      });
    });

    (Array.isArray(incoming) ? incoming : []).forEach((row) => {
      const sourceNodeId = getIdString(row?.sourceNodeId);
      const targetNodeId = getIdString(row?.targetNodeId || row?.targetNode);
      const relationType = normalizeRelationType(row?.relationType);
      if (!relationType || !frontierSet.has(targetNodeId) || !sourceNodeId || sourceNodeId === targetNodeId) return;
      rowsByCurrentNodeId.get(targetNodeId).push({
        relationRecordKey: buildTitleRelationRecordKey(row),
        sourceNodeId,
        targetNodeId,
        relationType
      });
    });

    const nextFrontier = [];
    frontier.forEach((currentNodeId) => {
      const currentLevel = Number(levelByNodeId[currentNodeId]) || 0;
      const relations = rowsByCurrentNodeId.get(currentNodeId) || [];

      relations.forEach((row) => {
        const neighborNodeId = row.sourceNodeId === currentNodeId ? row.targetNodeId : row.sourceNodeId;
        if (!isValidObjectId(neighborNodeId) || neighborNodeId === currentNodeId) return;

        if (!processedRelationKeys.has(row.relationRecordKey) && includedSet.has(currentNodeId) && includedSet.has(neighborNodeId)) {
          addTitleEdgeAggregate(edgeMap, row);
          processedRelationKeys.add(row.relationRecordKey);
        }

        if (includedSet.has(neighborNodeId)) {
          return;
        }

        if (includedNodeIds.length < limit && !queuedSet.has(neighborNodeId)) {
          levelByNodeId[neighborNodeId] = currentLevel + 1;
          includedNodeIds.push(neighborNodeId);
          includedSet.add(neighborNodeId);
          queuedSet.add(neighborNodeId);
          nextFrontier.push(neighborNodeId);
          if (!processedRelationKeys.has(row.relationRecordKey)) {
            addTitleEdgeAggregate(edgeMap, row);
            processedRelationKeys.add(row.relationRecordKey);
          }
          return;
        }

        appendBoundaryRelation(boundaryMap, currentNodeId, neighborNodeId, row.relationType);
      });
    });

    frontier = nextFrontier;
  }

  return {
    centerNodeId: safeCenterNodeId,
    nodeIds: includedNodeIds,
    edges: Array.from(edgeMap.values()),
    levelByNodeId,
    maxLevel: Math.max(0, ...Object.values(levelByNodeId).map((value) => Number(value) || 0)),
    boundaryStubs: Array.from(boundaryMap.entries()).map(([sourceNodeId, entry]) => ({
      stubId: `title-stub-${sourceNodeId}`,
      sourceNodeId,
      hiddenNeighborCount: entry.hiddenNeighborKeys.size,
      containsCount: entry.containsCount,
      extendsCount: entry.extendsCount,
      layer: 'title',
      sourceLevel: Number(levelByNodeId[sourceNodeId]) || 0
    }))
  };
};

const traverseSenseStarMap = async ({ centerNodeId, centerSenseId = '', limit = 50 } = {}) => {
  const safeCenterNodeId = getIdString(centerNodeId);
  if (!isValidObjectId(safeCenterNodeId)) {
    const error = new Error('无效的节点ID');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  const nodeCache = new Map();
  await ensureApprovedNodeCache(nodeCache, [safeCenterNodeId]);
  const centerNode = nodeCache.get(safeCenterNodeId);
  if (!centerNode) {
    const error = new Error('节点不存在');
    error.statusCode = 404;
    error.expose = true;
    throw error;
  }

  const centerSense = pickSenseForNode(centerNode, centerSenseId);
  const centerVertexKey = toVertexKey(safeCenterNodeId, centerSense?.senseId || '');
  const levelByVertexKey = { [centerVertexKey]: 0 };
  const includedVertexKeys = [centerVertexKey];
  const includedVertexSet = new Set(includedVertexKeys);
  const queuedVertexSet = new Set(includedVertexKeys);
  const vertexMetaByKey = new Map([[
    centerVertexKey,
    {
      nodeId: safeCenterNodeId,
      senseId: centerSense?.senseId || ''
    }
  ]]);
  const edgeMap = new Map();
  const boundaryMap = new Map();
  const processedRelationKeys = new Set();
  let frontier = [{
    vertexKey: centerVertexKey,
    nodeId: safeCenterNodeId,
    senseId: centerSense?.senseId || ''
  }];

  while (frontier.length > 0 && includedVertexKeys.length <= limit) {
    const frontierNodeIds = Array.from(new Set(frontier.map((item) => item.nodeId).filter((id) => isValidObjectId(id))));
    await ensureApprovedNodeCache(nodeCache, frontierNodeIds);

    const incomingDocs = frontierNodeIds.length > 0
      ? await Node.find({
        status: 'approved',
        'associations.targetNode': {
          $in: frontierNodeIds.map((id) => new mongoose.Types.ObjectId(id))
        }
      })
        .select('name description synonymSenses knowledgePoint contentScore domainMaster domainAdmins allianceId associations status')
        .lean()
      : [];
    await hydrateNodeSensesForNodes(incomingDocs);
    incomingDocs.forEach((doc) => {
      nodeCache.set(getIdString(doc?._id), doc);
    });

    const neighborNodeIds = new Set();
    frontier.forEach((vertex) => {
      const currentNode = nodeCache.get(vertex.nodeId);
      normalizeNodeAssociationRows(currentNode).forEach((assoc) => {
        neighborNodeIds.add(assoc.targetNodeId);
      });
    });
    incomingDocs.forEach((doc) => {
      neighborNodeIds.add(getIdString(doc?._id));
    });
    await ensureApprovedNodeCache(nodeCache, Array.from(neighborNodeIds));

    const incomingByTargetNodeId = new Map();
    incomingDocs.forEach((doc) => {
      normalizeNodeAssociationRows(doc).forEach((assoc) => {
        if (!incomingByTargetNodeId.has(assoc.targetNodeId)) {
          incomingByTargetNodeId.set(assoc.targetNodeId, []);
        }
        incomingByTargetNodeId.get(assoc.targetNodeId).push(assoc);
      });
    });

    const nextFrontier = [];
    frontier.forEach((vertex) => {
      const currentLevel = Number(levelByVertexKey[vertex.vertexKey]) || 0;
      const currentNode = nodeCache.get(vertex.nodeId);
      if (!currentNode) return;

      const visitNeighbor = ({
        neighborNodeId,
        neighborSenseId,
        relationType,
        displaySourceVertexKey,
        candidateVertexKey,
        actualSourceVertexKey,
        actualTargetVertexKey
      }) => {
        if (!neighborNodeId || !neighborSenseId || !relationType || !displaySourceVertexKey || !candidateVertexKey) return;
        const relationRecordKey = buildSenseRelationRecordKey({
          sourceVertexKey: actualSourceVertexKey,
          targetVertexKey: actualTargetVertexKey,
          relationType
        });
        if (!processedRelationKeys.has(relationRecordKey) && includedVertexSet.has(actualSourceVertexKey) && includedVertexSet.has(actualTargetVertexKey)) {
          addSenseEdgeAggregate(edgeMap, actualSourceVertexKey, actualTargetVertexKey, relationType);
          processedRelationKeys.add(relationRecordKey);
        }

        if (includedVertexSet.has(candidateVertexKey)) {
          return;
        }

        if (includedVertexKeys.length < limit && !queuedVertexSet.has(candidateVertexKey)) {
          queuedVertexSet.add(candidateVertexKey);
          includedVertexSet.add(candidateVertexKey);
          includedVertexKeys.push(candidateVertexKey);
          levelByVertexKey[candidateVertexKey] = currentLevel + 1;
          vertexMetaByKey.set(candidateVertexKey, {
            nodeId: neighborNodeId,
            senseId: neighborSenseId
          });
          nextFrontier.push({
            vertexKey: candidateVertexKey,
            nodeId: neighborNodeId,
            senseId: neighborSenseId
          });
          if (!processedRelationKeys.has(relationRecordKey)) {
            addSenseEdgeAggregate(edgeMap, actualSourceVertexKey, actualTargetVertexKey, relationType);
            processedRelationKeys.add(relationRecordKey);
          }
          return;
        }

        appendBoundaryRelation(boundaryMap, displaySourceVertexKey, candidateVertexKey, relationType);
      };

      normalizeNodeAssociationRows(currentNode).forEach((assoc) => {
        const sourceSenseId = assoc.sourceSenseId || vertex.senseId;
        if (assoc.sourceSenseId && assoc.sourceSenseId !== vertex.senseId) return;
        const targetNode = nodeCache.get(assoc.targetNodeId);
        if (!targetNode) return;
        const targetSense = pickSenseForNode(targetNode, assoc.targetSenseId);
        const sourceVertexKey = toVertexKey(vertex.nodeId, sourceSenseId);
        const targetVertexKey = toVertexKey(assoc.targetNodeId, targetSense?.senseId || '');
        visitNeighbor({
          neighborNodeId: assoc.targetNodeId,
          neighborSenseId: targetSense?.senseId || '',
          relationType: assoc.relationType,
          displaySourceVertexKey: sourceVertexKey,
          candidateVertexKey: targetVertexKey,
          actualSourceVertexKey: sourceVertexKey,
          actualTargetVertexKey: targetVertexKey
        });
      });

      const incomingRows = incomingByTargetNodeId.get(vertex.nodeId) || [];
      incomingRows.forEach((assoc) => {
        const targetSenseId = assoc.targetSenseId || vertex.senseId;
        if (assoc.targetSenseId && assoc.targetSenseId !== vertex.senseId) return;
        const sourceNode = nodeCache.get(assoc.sourceNodeId);
        if (!sourceNode) return;
        const sourceSense = pickSenseForNode(sourceNode, assoc.sourceSenseId);
        const sourceVertexKey = toVertexKey(assoc.sourceNodeId, sourceSense?.senseId || '');
        const targetVertexKey = toVertexKey(vertex.nodeId, targetSenseId);
        visitNeighbor({
          neighborNodeId: assoc.sourceNodeId,
          neighborSenseId: sourceSense?.senseId || '',
          relationType: assoc.relationType,
          displaySourceVertexKey: targetVertexKey,
          candidateVertexKey: sourceVertexKey,
          actualSourceVertexKey: sourceVertexKey,
          actualTargetVertexKey: targetVertexKey
        });
      });
    });

    frontier = nextFrontier;
  }

  const decoratedNodes = includedVertexKeys
    .map((vertexKey) => {
      const meta = vertexMetaByKey.get(vertexKey);
      const baseNode = nodeCache.get(meta?.nodeId);
      if (!baseNode) return null;
      return decorateNodeWithSense(baseNode, meta?.senseId || '');
    })
    .filter(Boolean);

  const centerDecoratedNode = decoratedNodes.find((item) => item.vertexKey === centerVertexKey)
    || decorateNodeWithSense(centerNode, centerSense?.senseId || '');

  return {
    centerVertexKey,
    centerNode: centerDecoratedNode,
    nodes: decoratedNodes,
    edges: Array.from(edgeMap.values()),
    levelByVertexKey,
    maxLevel: Math.max(0, ...Object.values(levelByVertexKey).map((value) => Number(value) || 0)),
    boundaryStubs: Array.from(boundaryMap.entries()).map(([sourceVertexKey, entry]) => ({
      stubId: `sense-stub-${sourceVertexKey}`,
      sourceVertexKey,
      hiddenNeighborCount: entry.hiddenNeighborKeys.size,
      containsCount: entry.containsCount,
      extendsCount: entry.extendsCount,
      layer: 'sense',
      sourceLevel: Number(levelByVertexKey[sourceVertexKey]) || 0
    }))
  };
};

module.exports = {
  traverseTitleStarMap,
  traverseSenseStarMap,
  toVertexKey
};
