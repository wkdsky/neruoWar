module.exports = ({ router, deps }) => {
  const {
    authenticateToken,
    isAdmin,
    Node,
    toSafeInteger,
    escapeRegex,
    hydrateNodeSensesForNodes,
    normalizeNodeSenseList,
    computeAdminNodeSearchCoverageScore,
    compareSearchCoverageScore,
    syncDomainTitleProjectionFromNode,
    loadCanonicalNodeResponseById,
    sendNodeRouteError,
    allocateNextSenseId,
    normalizeAssociationDraftList,
    getIdString,
    validateAssociationRuleSet,
    resolveAssociationsWithInsertPlans,
    normalizeRelationAssociationList,
    dedupeAssociationList,
    rebuildRelatedDomainNamesForNodes,
    saveNodeSenses,
    bootstrapArticleFromNodeSense,
    applyInsertAssociationRewire,
    syncReciprocalAssociationsForNode,
    buildAssociationMutationPreviewData,
    applyReconnectPairs,
    removeNodeReferencesForDeletion,
    deleteNodeWithResources,
    countNodeSenseAssociationRefs,
    computeLostBridgePairs,
    resolveReconnectPairsByDecisions,
    buildAssociationMutationSummary,
    normalizeAssociationRemovalStrategy,
    isValidObjectId
  } = deps;

  router.get('/', authenticateToken, isAdmin, async (req, res) => {
    try {
      const page = toSafeInteger(req.query?.page, 1, { min: 1, max: 1000000 });
      const pageSize = toSafeInteger(req.query?.pageSize, 50, { min: 1, max: 200 });
      const requestLatest = req.query?.latest === '1' || req.query?.latest === 'true';
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

      let nodes = [];
      let total = 0;
      if (keyword) {
        nodes = await Node.find(query)
          .populate('owner', 'username profession')
          .populate('domainMaster', 'username profession')
          .populate('associations.targetNode', 'name description synonymSenses')
          .sort({ createdAt: -1 });
        total = Array.isArray(nodes) ? nodes.length : 0;
      } else {
        [nodes, total] = await Promise.all([
          Node.find(query)
            .populate('owner', 'username profession')
            .populate('domainMaster', 'username profession')
            .populate('associations.targetNode', 'name description synonymSenses')
            .sort({ createdAt: -1 })
            .skip((page - 1) * pageSize)
            .limit(pageSize),
          Node.countDocuments(query)
        ]);
      }
      await hydrateNodeSensesForNodes(nodes);
      const associationTargetNodes = [];
      (Array.isArray(nodes) ? nodes : []).forEach((nodeDoc) => {
        const assocList = Array.isArray(nodeDoc?.associations) ? nodeDoc.associations : [];
        assocList.forEach((association) => {
          const targetNode = association?.targetNode;
          if (targetNode && typeof targetNode === 'object' && targetNode._id) {
            associationTargetNodes.push(targetNode);
          }
        });
      });
      if (associationTargetNodes.length > 0) {
        await hydrateNodeSensesForNodes(associationTargetNodes);
      }
      const responseNodes = Array.isArray(nodes) ? nodes : [];
      if (requestLatest) {
        const now = new Date();
        responseNodes.forEach((node) => {
          Node.applyKnowledgePointProjection(node, now);
        });
      }
      responseNodes.forEach((nodeDoc) => {
        nodeDoc.synonymSenses = normalizeNodeSenseList(nodeDoc, { actorUserId: req.user?.userId || null });
        const assocList = Array.isArray(nodeDoc?.associations) ? nodeDoc.associations : [];
        assocList.forEach((association) => {
          const targetNode = association?.targetNode;
          if (!targetNode || typeof targetNode !== 'object' || !targetNode._id) return;
          targetNode.synonymSenses = normalizeNodeSenseList(targetNode, { actorUserId: req.user?.userId || null });
        });
      });

      const pagedNodes = keyword
        ? responseNodes
          .map((nodeDoc, index) => ({
            node: nodeDoc,
            score: computeAdminNodeSearchCoverageScore(nodeDoc, keyword),
            index
          }))
          .sort((left, right) => (
            compareSearchCoverageScore(left.score, right.score)
            || new Date(right.node?.createdAt || 0).getTime() - new Date(left.node?.createdAt || 0).getTime()
            || String(left.node?.name || '').localeCompare(String(right.node?.name || ''), 'zh-Hans-CN')
            || left.index - right.index
          ))
          .slice((page - 1) * pageSize, page * pageSize)
          .map((item) => item.node)
        : responseNodes;

      res.json({
        success: true,
        count: pagedNodes.length,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
        latest: requestLatest,
        nodes: pagedNodes
      });
    } catch (error) {
      console.error('获取节点列表错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.put('/:nodeId', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const { name, description, prosperity, contentScore, knowledgePoint } = req.body;

      const node = await Node.findById(nodeId);
      if (!node) {
        return res.status(404).json({ error: '节点不存在' });
      }

      if (name !== undefined) {
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
      const canonicalNode = await loadCanonicalNodeResponseById(node._id);

      res.json({
        success: true,
        message: '节点信息已更新',
        node: canonicalNode || node.toObject()
      });
    } catch (error) {
      console.error('更新节点信息错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.post('/:nodeId/admin/senses', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const { title, associations } = req.body || {};

      const node = await Node.findById(nodeId).select('name description status synonymSenses associations relatedParentDomains relatedChildDomains');
      if (!node) {
        return res.status(404).json({ error: '节点不存在' });
      }
      if (node.status !== 'approved') {
        return res.status(400).json({ error: '仅已审批知识域可新增释义' });
      }

      await hydrateNodeSensesForNodes([node]);
      const existingSenses = normalizeNodeSenseList(node);
      const trimmedTitle = typeof title === 'string' ? title.trim() : '';
      const trimmedContent = String(node.description || '').trim();
      if (!trimmedTitle) {
        return res.status(400).json({ error: '释义题目不能为空' });
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
      const oldAssociations = Array.isArray(node.associations) ? node.associations : [];
      const oldRelationAssociations = normalizeRelationAssociationList(oldAssociations);
      let effectiveAssociations = [];
      let insertPlans = [];
      let nextAssociations = oldRelationAssociations;

      if (rawAssociations.length > 0) {
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
          effectiveAssociations: resolvedAssociations,
          insertPlans: resolvedInsertPlans
        } = resolveAssociationsWithInsertPlans(normalizedAssociations);
        if (associationResolveError) {
          return res.status(400).json({ error: associationResolveError });
        }
        effectiveAssociations = resolvedAssociations;
        insertPlans = resolvedInsertPlans;

        const coveredSourceSenseSet = new Set(effectiveAssociations.map((item) => item.sourceSenseId).filter(Boolean));
        if (!coveredSourceSenseSet.has(nextSenseId)) {
          return res.status(400).json({ error: '新增释义必须至少包含1条有效关联关系' });
        }

        nextAssociations = dedupeAssociationList([...oldRelationAssociations, ...effectiveAssociations]);
        const mergedRuleValidation = validateAssociationRuleSet({
          currentNodeId: node._id,
          associations: nextAssociations
        });
        if (mergedRuleValidation.error) {
          return res.status(400).json({ error: mergedRuleValidation.error });
        }
      }

      const nextSenses = [...existingSenses, { senseId: nextSenseId, title: trimmedTitle, content: trimmedContent || String(node.description || '').trim() }];
      if (rawAssociations.length > 0) {
        node.associations = nextAssociations;
        await rebuildRelatedDomainNamesForNodes([node]);
        await node.save();
      }
      await saveNodeSenses({
        nodeId: node._id,
        senses: nextSenses,
        actorUserId: req.user.userId,
        fallbackDescription: node.description || ''
      });
      await bootstrapArticleFromNodeSense({
        nodeId: node._id,
        senseId: nextSenseId,
        userId: req.user.userId
      });
      await syncDomainTitleProjectionFromNode(node);

      if (insertPlans.length > 0) {
        await applyInsertAssociationRewire({
          insertPlans,
          newNodeId: node._id,
          newNodeName: node.name
        });
      }

      if (rawAssociations.length > 0) {
        await syncReciprocalAssociationsForNode({
          nodeDoc: node,
          oldAssociations,
          nextAssociations
        });
      }
      const canonicalNode = await loadCanonicalNodeResponseById(node._id);
      const canonicalSense = Array.isArray(canonicalNode?.synonymSenses)
        ? canonicalNode.synonymSenses.find((sense) => sense?.senseId === nextSenseId) || null
        : null;

      return res.json({
        success: true,
        message: '释义已新增',
        sense: canonicalSense || { senseId: nextSenseId, title: trimmedTitle, content: trimmedContent || String(node.description || '').trim() },
        node: canonicalNode || node.toObject()
      });
    } catch (error) {
      console.error('管理员新增释义错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.put('/:nodeId/admin/senses/:senseId/text', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { nodeId, senseId } = req.params;
      const { title, content } = req.body || {};

      const node = await Node.findById(nodeId).select('description status synonymSenses associations');
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

      const currentSense = sourceSenses[targetIndex] || null;
      const trimmedTitle = typeof title === 'string' ? title.trim() : '';
      const hasContentPayload = typeof content === 'string';
      const trimmedContent = hasContentPayload ? content.trim() : String(currentSense?.content || '').trim();
      if (hasContentPayload && trimmedContent !== String(currentSense?.content || '').trim()) {
        return res.status(409).json({
          error: '管理员直改百科正文已停用，请改用 /api/sense-articles/:nodeId/:senseId/revisions 进入修订流',
          code: 'sense_article_revision_flow_required'
        });
      }
      if (!trimmedTitle) {
        return res.status(400).json({ error: '释义题目不能为空' });
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
          ? { ...sense, title: trimmedTitle, content: sense.content }
          : sense
      ));

      await saveNodeSenses({
        nodeId: node._id,
        senses: nextSenses,
        actorUserId: req.user.userId,
        fallbackDescription: node.description || ''
      });
      await syncDomainTitleProjectionFromNode(node);
      const canonicalNode = await loadCanonicalNodeResponseById(node._id);
      const canonicalSense = Array.isArray(canonicalNode?.synonymSenses)
        ? canonicalNode.synonymSenses.find((sense) => sense?.senseId === targetSenseId) || null
        : null;

      return res.json({
        success: true,
        message: '释义元信息已更新；百科正文请走修订流',
        sense: canonicalSense || nextSenses[targetIndex],
        node: canonicalNode || node.toObject()
      });
    } catch (error) {
      console.error('管理员编辑释义文本错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      const oldRelationAssociations = normalizeRelationAssociationList(node.associations || []);
      const nextRelationAssociations = oldRelationAssociations.filter((assoc) => assoc.sourceSenseId !== targetSenseId);
      const previewData = await buildAssociationMutationPreviewData({
        node,
        effectiveAssociations: nextRelationAssociations,
        insertPlans: [],
        onRemovalStrategy,
        bridgeDecisions
      });
      const remainingSenseCount = Math.max(0, sourceSenses.length - 1);

      return res.json({
        success: true,
        strategy: previewData.strategy,
        deletingSense: targetSense,
        deletingNodeName: node.name || '',
        remainingSenseCount,
        willDeleteNode: remainingSenseCount < 1,
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
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.delete('/:nodeId/admin/senses/:senseId', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { nodeId, senseId } = req.params;
      const { onRemovalStrategy, bridgeDecisions } = req.body || {};

      const node = await Node.findById(nodeId).select('name description status synonymSenses associations relatedParentDomains relatedChildDomains');
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
      const willDeleteNode = nextSenses.length < 1;

      if (willDeleteNode) {
        if (previewData.reconnectPairs.length > 0) {
          await applyReconnectPairs(previewData.reconnectPairs);
        }

        await removeNodeReferencesForDeletion(node);
        await deleteNodeWithResources(node);

        return res.json({
          success: true,
          message: `释义「${targetSense.title}」已删除；因其为最后一个释义，知识域「${node.name}」已一并删除`,
          strategy: previewData.strategy,
          summary: previewData.mutationSummary,
          deletedSense: targetSense.title,
          deletedNode: node.name,
          deletedNodeWithSense: true
        });
      }

      node.associations = nextAssociations;
      await rebuildRelatedDomainNamesForNodes([node]);
      await node.save();
      await saveNodeSenses({
        nodeId: node._id,
        senses: nextSenses,
        actorUserId: req.user.userId,
        fallbackDescription: node.description || ''
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
      const canonicalNode = await loadCanonicalNodeResponseById(node._id);

      return res.json({
        success: true,
        message: `释义「${targetSense.title}」已删除`,
        strategy: previewData.strategy,
        summary: previewData.mutationSummary,
        node: canonicalNode || node.toObject()
      });
    } catch (error) {
      console.error('管理员删除释义错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.post('/:nodeId/delete-preview', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const { onRemovalStrategy, bridgeDecisions } = req.body || {};

      const node = await Node.findById(nodeId).select('name synonymSenses associations');
      if (!node) {
        return res.status(404).json({ error: '节点不存在' });
      }

      const relationRefStats = await countNodeSenseAssociationRefs(node);
      if (relationRefStats.totalCount > 0) {
        return res.status(400).json({
          error: '请先删除该标题下释义的所有关联关系，再删除标题',
          stats: relationRefStats
        });
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
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.delete('/:nodeId', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const { onRemovalStrategy, bridgeDecisions } = req.body || {};

      const node = await Node.findById(nodeId);
      if (!node) {
        return res.status(404).json({ error: '节点不存在' });
      }

      const relationRefStats = await countNodeSenseAssociationRefs(node);
      if (relationRefStats.totalCount > 0) {
        return res.status(400).json({
          error: '请先删除该标题下释义的所有关联关系，再删除标题',
          stats: relationRefStats
        });
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

      await removeNodeReferencesForDeletion(node);

      if (reconnectResolve.reconnectPairs.length > 0) {
        await applyReconnectPairs(reconnectResolve.reconnectPairs);
      }

      await deleteNodeWithResources(node);

      res.json({
        success: true,
        message: '节点已删除，所有关联已清理',
        deletedNode: nodeName,
        reconnectCount: reconnectResolve.reconnectPairs.length
      });
    } catch (error) {
      console.error('删除节点错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      const canonicalNode = await loadCanonicalNodeResponseById(node._id);

      res.json({
        success: true,
        message: isFeatured ? '已设置为热门节点' : '已取消热门节点',
        node: canonicalNode || node.toObject()
      });
    } catch (error) {
      console.error('设置热门节点错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });
};
