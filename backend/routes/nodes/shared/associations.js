module.exports = ({
  Node,
  User,
  hydrateNodeSensesForNodes,
  syncDomainTitleProjectionFromNode,
  normalizeNodeSenseList,
  getIdString,
  isValidObjectId,
  isDomainMaster
}) => {
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

  const countNodeSenseAssociationRefs = async (node = null) => {
    if (!node?._id) {
      return { outgoingCount: 0, incomingCount: 0, totalCount: 0 };
    }

    await hydrateNodeSensesForNodes([node]);
    const nodeId = getIdString(node._id);
    const localSenseIdSet = new Set(
      normalizeNodeSenseList(node).map((sense) => (typeof sense?.senseId === 'string' ? sense.senseId.trim() : '')).filter(Boolean)
    );

    const outgoingCount = normalizeTitleRelationAssociationList(node.associations || [])
      .filter((assoc) => {
        const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
        if (!sourceSenseId) return true;
        if (localSenseIdSet.size < 1) return true;
        return localSenseIdSet.has(sourceSenseId);
      }).length;

    const incomingRows = await Node.find({
      _id: { $ne: node._id },
      'associations.targetNode': node._id
    })
      .select('associations')
      .lean();

    let incomingCount = 0;
    incomingRows.forEach((row) => {
      normalizeTitleRelationAssociationList(row?.associations || []).forEach((assoc) => {
        if (assoc.targetNode !== nodeId) return;
        const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
        if (!targetSenseId || localSenseIdSet.size < 1 || localSenseIdSet.has(targetSenseId)) {
          incomingCount += 1;
        }
      });
    });

    return {
      outgoingCount,
      incomingCount,
      totalCount: outgoingCount + incomingCount
    };
  };

  const removeNodeReferencesForDeletion = async (node = null) => {
    if (!node?._id) return;
    const nodeId = getIdString(node._id);
    const nodeName = String(node?.name || '').trim();

    if (nodeName) {
      await Node.updateMany(
        { relatedParentDomains: nodeName },
        { $pull: { relatedParentDomains: nodeName } }
      );

      await Node.updateMany(
        { relatedChildDomains: nodeName },
        { $pull: { relatedChildDomains: nodeName } }
      );
    }

    await Node.updateMany(
      { 'associations.targetNode': nodeId },
      { $pull: { associations: { targetNode: nodeId } } }
    );
  };

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

      const removedUpperToLowerByDirectOrder = removeDirectedContainsOrExtendsAssociation(
        upperNode,
        lowerNode._id,
        plan.upperSenseId,
        plan.lowerSenseId
      );
      const removedUpperToLowerByReverseOrder = removeDirectedContainsOrExtendsAssociation(
        upperNode,
        lowerNode._id,
        plan.lowerSenseId,
        plan.upperSenseId
      );
      const removedUpperToLower = removedUpperToLowerByDirectOrder || removedUpperToLowerByReverseOrder;

      const removedLowerToUpperByDirectOrder = removeDirectedContainsOrExtendsAssociation(
        lowerNode,
        upperNode._id,
        plan.lowerSenseId,
        plan.upperSenseId
      );
      const removedLowerToUpperByReverseOrder = removeDirectedContainsOrExtendsAssociation(
        lowerNode,
        upperNode._id,
        plan.upperSenseId,
        plan.lowerSenseId
      );
      const removedLowerToUpper = removedLowerToUpperByDirectOrder || removedLowerToUpperByReverseOrder;

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

  return {
    normalizeAssociationRelationType,
    normalizeAssociationInsertSide,
    pickNodeSenseById,
    normalizeAssociationDraftList,
    dedupeAssociationList,
    validateAssociationRuleSet,
    normalizeAssociationRemovalStrategy,
    normalizeRelationAssociationList,
    normalizeTitleRelationAssociationList,
    countNodeSenseAssociationRefs,
    removeNodeReferencesForDeletion,
    computeLostBridgePairs,
    resolveReconnectPairsByDecisions,
    applyReconnectPairs,
    buildAssociationMutationSummary,
    validateAssociationMutationPermission,
    parseAssociationMutationPayload,
    buildAssociationMutationPreviewData,
    resolveAssociationsWithInsertPlans,
    rebuildRelatedDomainNamesForNodes,
    applyInsertAssociationRewire,
    syncReciprocalAssociationsForNode
  };
};
