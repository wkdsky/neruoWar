module.exports = ({ router, deps }) => {
  const {
    authenticateToken,
    Node,
    validateAssociationMutationPermission,
    parseAssociationMutationPayload,
    buildAssociationMutationPreviewData,
    rebuildRelatedDomainNamesForNodes,
    syncDomainTitleProjectionFromNode,
    applyInsertAssociationRewire,
    applyReconnectPairs,
    syncReciprocalAssociationsForNode,
    loadCanonicalNodeResponseById,
    sendNodeRouteError
  } = deps;

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
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.put('/:nodeId/associations', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const { associations, onRemovalStrategy, bridgeDecisions } = req.body;

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

      if (previewData.mutationSummary.lostBridgePairs.length > 0 && previewData.unresolvedBridgeDecisionCount > 0) {
        return res.status(400).json({
          error: '请先逐条确认删除后的上下级承接关系（保留承接或断开）',
          bridgeDecisionItems: previewData.bridgeDecisionItems,
          unresolvedBridgeDecisionCount: previewData.unresolvedBridgeDecisionCount,
          summary: previewData.mutationSummary
        });
      }

      const oldAssociations = node.associations || [];
      node.associations = effectiveAssociations;
      await rebuildRelatedDomainNamesForNodes([node]);
      await node.save();
      await syncDomainTitleProjectionFromNode(node);

      if (insertPlans.length > 0) {
        await applyInsertAssociationRewire({
          insertPlans,
          newNodeId: node._id,
          newNodeName: node.name
        });
      }

      if (previewData.reconnectPairs.length > 0) {
        await applyReconnectPairs(previewData.reconnectPairs);
      }

      await syncReciprocalAssociationsForNode({
        nodeDoc: node,
        oldAssociations,
        nextAssociations: effectiveAssociations
      });
      const canonicalNode = await loadCanonicalNodeResponseById(node._id);

      res.json({
        success: true,
        message: '关联关系已更新',
        strategy: previewData.strategy,
        summary: previewData.mutationSummary,
        node: canonicalNode || node.toObject()
      });
    } catch (error) {
      console.error('编辑节点关联错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });
};
