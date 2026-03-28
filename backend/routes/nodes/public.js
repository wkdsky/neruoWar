module.exports = ({ router, deps }) => {
  const {
    mongoose,
    Node,
    User,
    DomainTitleProjection,
    toSafeInteger,
    decodeNameCursor,
    isDomainTitleProjectionReadEnabled,
    isValidObjectId,
    mapProjectionRowToNodeLike,
    getIdString,
    hydrateNodeSensesForNodes,
    attachVisualStyleToNodeList,
    normalizeNodeSenseList,
    encodeNameCursor,
    sendNodeRouteError,
    loadNodeSearchCandidates,
    buildNodeSenseSearchEntries,
    computePublicSearchEntryCoverageScore,
    compareSearchCoverageScore,
    listActiveTitleRelationsBySourceNodeIds,
    listActiveTitleRelationsByTargetNodeIds,
    normalizeTitleRelationAssociationList,
    buildNodeTitleCard,
    resolveEffectiveStarMapLimit,
    traverseTitleStarMap,
    traverseSenseStarMap,
    pickNodeSenseById,
    normalizeAssociationRelationType,
    buildNodeSenseDisplayName
  } = deps;

  const toPublicNodeCard = (item) => {
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
  };

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
          .select('nodeId name description relatedParentDomains relatedChildDomains knowledgePoint contentScore domainMaster domainAdmins allianceId status')
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
      const normalizedRootNodes = styledRootNodes.map((item) => toPublicNodeCard(item));

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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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
      const normalizedFeaturedNodes = styledFeaturedNodes.map((item) => toPublicNodeCard(item));

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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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

      const keywords = normalizedQuery.split(/\s+/).filter(Boolean);

      const allNodes = await loadNodeSearchCandidates({
        normalizedKeyword: normalizedQuery,
        limit: 1500
      });

      const searchResults = allNodes
        .flatMap((node) => buildNodeSenseSearchEntries(node, keywords))
        .map((item, index) => ({
          item,
          score: computePublicSearchEntryCoverageScore(item, normalizedQuery),
          index
        }))
        .sort((left, right) => (
          compareSearchCoverageScore(left.score, right.score)
          || Number(right.item?.matchCount || 0) - Number(left.item?.matchCount || 0)
          || String(left.item?.displayName || '').localeCompare(String(right.item?.displayName || ''), 'zh-Hans-CN')
          || left.index - right.index
        ))
        .slice(0, 300)
        .map(({ item }) => {
          const { matchCount, ...rest } = item;
          return rest;
        });

      res.json({
        success: true,
        count: searchResults.length,
        results: searchResults
      });
    } catch (error) {
      console.error('搜索节点错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  // 获取标题级主视角（标题关系由释义关系并集构成）
  router.get('/public/title-detail/:nodeId', async (req, res) => {
    try {
      const { nodeId } = req.params;
      const maxNodes = toSafeInteger(req.query?.limit, 160, { min: 20, max: 500 });
      const useTitleProjectionRead = isDomainTitleProjectionReadEnabled();

      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的节点ID' });
      }

      let center = useTitleProjectionRead
        ? await DomainTitleProjection.findOne({
          nodeId: new mongoose.Types.ObjectId(nodeId),
          status: 'approved'
        })
          .select('nodeId name description relatedParentDomains relatedChildDomains knowledgePoint contentScore domainMaster domainAdmins allianceId status')
          .lean()
          .then((row) => (row ? mapProjectionRowToNodeLike(row) : null))
        : await Node.findById(nodeId)
          .select('name description synonymSenses knowledgePoint contentScore domainMaster domainAdmins allianceId status associations relatedParentDomains relatedChildDomains')
          .lean();
      if (!center) {
        return res.status(404).json({ error: '节点不存在' });
      }
      if (center.status !== 'approved') {
        return res.status(403).json({ error: '该节点未审批' });
      }
      await hydrateNodeSensesForNodes([center]);

      const centerNodeId = getIdString(center?._id || nodeId);
      const [centerRelationRows, incomingRelationRows] = useTitleProjectionRead
        ? await Promise.all([
          listActiveTitleRelationsBySourceNodeIds([centerNodeId]),
          listActiveTitleRelationsByTargetNodeIds([centerNodeId])
        ])
        : [[], []];
      const centerAssociations = useTitleProjectionRead
        ? normalizeTitleRelationAssociationList(centerRelationRows)
        : normalizeTitleRelationAssociationList(center?.associations || []);
      const directNeighborIdSet = new Set();
      for (const assoc of centerAssociations) {
        const targetNodeId = getIdString(assoc?.targetNode);
        if (!isValidObjectId(targetNodeId) || targetNodeId === centerNodeId) continue;
        directNeighborIdSet.add(targetNodeId);
      }
      if (useTitleProjectionRead) {
        for (const row of incomingRelationRows) {
          const sourceNodeId = getIdString(row?.sourceNodeId);
          if (!isValidObjectId(sourceNodeId) || sourceNodeId === centerNodeId) continue;
          directNeighborIdSet.add(sourceNodeId);
        }
      }

      const directNeighborObjectIds = Array.from(directNeighborIdSet)
        .slice(0, Math.max(50, maxNodes * 5))
        .map((id) => new mongoose.Types.ObjectId(id));
      let directNeighborDocs = directNeighborObjectIds.length > 0
        ? (useTitleProjectionRead
          ? await DomainTitleProjection.find({
            status: 'approved',
            nodeId: { $in: directNeighborObjectIds }
          })
            .select('nodeId name description relatedParentDomains relatedChildDomains knowledgePoint contentScore domainMaster domainAdmins allianceId status')
            .lean()
            .then((rows) => rows.map((row) => mapProjectionRowToNodeLike(row)))
          : await Node.find({
            status: 'approved',
            _id: { $in: directNeighborObjectIds }
          })
            .select('name description synonymSenses knowledgePoint contentScore domainMaster domainAdmins allianceId associations relatedParentDomains relatedChildDomains')
            .lean())
        : [];

      if (useTitleProjectionRead) {
        const roleNodeObjectIds = Array.from(new Set([
          centerNodeId,
          ...directNeighborDocs.map((item) => getIdString(item?._id))
        ].filter((id) => isValidObjectId(id)))).map((id) => new mongoose.Types.ObjectId(id));

        if (roleNodeObjectIds.length > 0) {
          const roleRows = await Node.find({ _id: { $in: roleNodeObjectIds } })
            .select('_id domainMaster domainAdmins')
            .lean();
          const roleByNodeId = new Map(
            roleRows.map((row) => [getIdString(row?._id), row])
          );
          const mergeNodeDomainRole = (nodeDoc = {}) => {
            const roleDoc = roleByNodeId.get(getIdString(nodeDoc?._id));
            if (!roleDoc) return nodeDoc;
            return {
              ...nodeDoc,
              domainMaster: roleDoc?.domainMaster || null,
              domainAdmins: Array.isArray(roleDoc?.domainAdmins) ? roleDoc.domainAdmins : []
            };
          };
          center = mergeNodeDomainRole(center);
          directNeighborDocs = directNeighborDocs.map((item) => mergeNodeDomainRole(item));
        }
      }
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
      const getNodeSenseMeta = (targetNodeId) => {
        const safeNodeId = getIdString(targetNodeId);
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
      const resolveAssociationSenseId = (targetNodeId, senseId) => {
        const safeSenseId = typeof senseId === 'string' ? senseId.trim() : '';
        const meta = getNodeSenseMeta(targetNodeId);
        if (!meta?.titleMap || meta.titleMap.size === 0) return '';
        if (safeSenseId && meta.titleMap.has(safeSenseId)) return safeSenseId;
        return meta.firstSenseId || '';
      };
      const getSenseTitle = (targetNodeId, senseId) => {
        const safeSenseId = typeof senseId === 'string' ? senseId.trim() : '';
        if (!safeSenseId) return '';
        const meta = getNodeSenseMeta(targetNodeId);
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
      const upsertEdgeSense = (edge, targetNodeId, senseId, senseTitle) => {
        if (!senseId || !senseTitle) return;
        let titleMap = edge.senseTitleMapByNodeId.get(targetNodeId);
        if (!titleMap) {
          titleMap = new Map();
          edge.senseTitleMapByNodeId.set(targetNodeId, titleMap);
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
        relatedParentDomains: Array.isArray(nodeDoc?.relatedParentDomains) ? nodeDoc.relatedParentDomains : [],
        relatedChildDomains: Array.isArray(nodeDoc?.relatedChildDomains) ? nodeDoc.relatedChildDomains : [],
        knowledgePoint: nodeDoc?.knowledgePoint || null,
        contentScore: nodeDoc?.contentScore,
        domainMaster: nodeDoc?.domainMaster || null,
        domainAdmins: Array.isArray(nodeDoc?.domainAdmins) ? nodeDoc.domainAdmins : [],
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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  // 获取标题层星盘视图（真正的标题层 BFS）
  router.get('/public/title-star-map/:nodeId', async (req, res) => {
    try {
      const { nodeId } = req.params;
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的节点ID' });
      }

      const centerNodeDoc = await Node.findById(nodeId)
        .select('_id status')
        .lean();
      if (!centerNodeDoc) {
        return res.status(404).json({ error: '节点不存在' });
      }
      if (centerNodeDoc.status !== 'approved') {
        return res.status(403).json({ error: '该节点未审批' });
      }

      const { effectiveLimit } = await resolveEffectiveStarMapLimit(req.query?.limit);
      const traversal = await traverseTitleStarMap({
        centerNodeId: nodeId,
        limit: effectiveLimit
      });

      const nodeDocs = await Node.find({
        _id: {
          $in: traversal.nodeIds
            .filter((id) => isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id))
        },
        status: 'approved'
      })
        .select('_id name description synonymSenses knowledgePoint contentScore domainMaster domainAdmins allianceId')
        .lean();
      await hydrateNodeSensesForNodes(nodeDocs);

      const rawNodeById = new Map(nodeDocs.map((item) => [getIdString(item?._id), item]));
      const orderedCards = traversal.nodeIds
        .map((id) => rawNodeById.get(id))
        .filter(Boolean)
        .map((item) => buildNodeTitleCard(item));
      const styledNodes = await attachVisualStyleToNodeList(orderedCards);
      const styledNodeById = new Map(styledNodes.map((item) => [getIdString(item?._id), item]));
      const centerNode = styledNodeById.get(getIdString(nodeId)) || null;
      if (!centerNode) {
        return res.status(404).json({ error: '标题星盘中心节点不存在' });
      }

      const edges = traversal.edges
        .map((edge) => ({
          ...edge,
          nodeAName: styledNodeById.get(edge.nodeAId)?.name || '',
          nodeBName: styledNodeById.get(edge.nodeBId)?.name || ''
        }))
        .sort((a, b) => (
          b.pairCount - a.pairCount
          || a.edgeId.localeCompare(b.edgeId, 'en')
        ));

      res.json({
        success: true,
        graph: {
          centerNodeId: getIdString(nodeId),
          centerNode,
          nodes: styledNodes,
          edges,
          levelByNodeId: traversal.levelByNodeId,
          maxLevel: traversal.maxLevel,
          nodeCount: styledNodes.length,
          edgeCount: edges.length,
          boundaryStubs: traversal.boundaryStubs,
          effectiveLimit
        }
      });
    } catch (error) {
      console.error('获取标题星盘视图错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  // 获取释义层星盘视图（以 nodeId + senseId 为顶点）
  router.get('/public/sense-star-map/:nodeId', async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestedSenseId = typeof req.query?.senseId === 'string' ? req.query.senseId.trim() : '';
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的节点ID' });
      }

      const { effectiveLimit } = await resolveEffectiveStarMapLimit(req.query?.limit);
      const traversal = await traverseSenseStarMap({
        centerNodeId: nodeId,
        centerSenseId: requestedSenseId,
        limit: effectiveLimit
      });

      const styledNodes = await attachVisualStyleToNodeList(traversal.nodes);
      const styledNodeByVertexKey = new Map(styledNodes.map((item) => [String(item?.vertexKey || ''), item]));
      const centerNode = styledNodeByVertexKey.get(traversal.centerVertexKey) || null;
      if (!centerNode) {
        return res.status(404).json({ error: '释义星盘中心顶点不存在' });
      }

      const edges = traversal.edges.map((edge) => ({
        ...edge,
        fromLabel: styledNodeByVertexKey.get(edge.fromVertexKey)?.displayName || '',
        toLabel: styledNodeByVertexKey.get(edge.toVertexKey)?.displayName || ''
      }));

      res.json({
        success: true,
        graph: {
          centerVertexKey: traversal.centerVertexKey,
          centerNode,
          nodes: styledNodes,
          edges,
          levelByVertexKey: traversal.levelByVertexKey,
          maxLevel: traversal.maxLevel,
          nodeCount: styledNodes.length,
          edgeCount: edges.length,
          boundaryStubs: traversal.boundaryStubs,
          effectiveLimit
        }
      });
    } catch (error) {
      console.error('获取释义星盘视图错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  // 获取节点详细信息（所有用户可访问）
  router.get('/public/node-detail/:nodeId', async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestedSenseId = typeof req.query?.senseId === 'string' ? req.query.senseId.trim() : '';
      const includeFavoriteCount = req.query?.includeFavoriteCount === '1';
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的节点ID' });
      }

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
        .select('name description synonymSenses owner domainMaster domainAdmins allianceId associations relatedParentDomains relatedChildDomains knowledgePoint prosperity contentScore createdAt status');

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

      const shouldUseNameFallback = relationAssociations.length === 0;
      const nodeNameFallbackParents = shouldUseNameFallback
        ? (Array.isArray(node.relatedParentDomains) ? node.relatedParentDomains : []).filter(Boolean)
        : [];
      const nodeNameFallbackChildren = shouldUseNameFallback
        ? (Array.isArray(node.relatedChildDomains) ? node.relatedChildDomains : []).filter(Boolean)
        : [];

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

      const relationByTypeAndTargetNodeId = relationAssociations.reduce((acc, assoc) => {
        const key = getIdString(assoc?.targetNode);
        const relationType = normalizeAssociationRelationType(assoc?.relationType);
        if (!key) return acc;
        if (relationType !== 'contains' && relationType !== 'extends') return acc;
        const relationKey = `${relationType}:${key}`;
        if (acc.has(relationKey)) return acc;
        acc.set(relationKey, assoc);
        return acc;
      }, new Map());

      const decorateNodeWithSense = (rawNode, relationType = '') => {
        const source = rawNode && typeof rawNode.toObject === 'function' ? rawNode.toObject() : rawNode;
        const normalizedSenses = normalizeNodeSenseList(rawNode);
        const targetNodeId = getIdString(source?._id);
        const safeRelationType = relationType === 'contains' || relationType === 'extends' ? relationType : '';
        const assoc = safeRelationType
          ? relationByTypeAndTargetNodeId.get(`${safeRelationType}:${targetNodeId}`)
          : null;
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

      const now = new Date();
      const applyProjectedKnowledgePoint = (nodeLike) => {
        if (!nodeLike || typeof nodeLike !== 'object') return nodeLike;
        Node.applyKnowledgePointProjection(nodeLike, now);
        return nodeLike;
      };

      const nodeObj = node.toObject();
      applyProjectedKnowledgePoint(nodeObj);
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
      const favoriteUserCount = includeFavoriteCount
        ? await User.countDocuments({ favoriteDomains: node._id })
        : null;
      if (favoriteUserCount !== null) {
        nodeObj.favoriteUserCount = Number(favoriteUserCount) || 0;
      }
      const [styledNode] = await attachVisualStyleToNodeList([nodeObj]);
      const decoratedParentNodes = parentNodes.map((item) => applyProjectedKnowledgePoint(decorateNodeWithSense(item, 'extends')));
      const decoratedChildNodes = childNodes.map((item) => applyProjectedKnowledgePoint(decorateNodeWithSense(item, 'contains')));
      const styledParentNodes = await attachVisualStyleToNodeList(decoratedParentNodes);
      const styledChildNodes = await attachVisualStyleToNodeList(decoratedChildNodes);

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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });
};
