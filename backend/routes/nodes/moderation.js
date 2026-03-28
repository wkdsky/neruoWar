module.exports = ({ router, deps }) => {
  const {
    authenticateToken,
    isAdmin,
    Node,
    NodeSense,
    User,
    hydrateNodeSensesForNodes,
    normalizeNodeSenseList,
    getIdString,
    isValidObjectId,
    normalizeAssociationDraftList,
    validateAssociationRuleSet,
    resolveAssociationsWithInsertPlans,
    saveNodeSenses,
    resolveNodeDefenseLayout,
    resolveNodeSiegeState,
    upsertNodeDefenseLayout,
    upsertNodeSiegeState,
    syncDomainTitleProjectionFromNode,
    pushDomainCreateApplyResultNotification,
    toCollectionNotificationDoc,
    writeNotificationsToCollection,
    deleteNodeTitleStatesByNodeIds,
    deleteDomainTitleProjectionByNodeIds,
    applyInsertAssociationRewire,
    syncReciprocalAssociationsForNode,
    loadCanonicalNodeResponseById,
    sendNodeRouteError
  } = deps;

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
      nodes.forEach((nodeDoc) => {
        if (!nodeDoc || typeof nodeDoc !== 'object') return;
        nodeDoc.synonymSenses = normalizeNodeSenseList(nodeDoc, { actorUserId: req.user?.userId || null });
        const assocList = Array.isArray(nodeDoc.associations) ? nodeDoc.associations : [];
        assocList.forEach((association) => {
          const targetNode = association?.targetNode;
          if (!targetNode || typeof targetNode !== 'object' || !targetNode._id) return;
          targetNode.synonymSenses = normalizeNodeSenseList(targetNode, { actorUserId: req.user?.userId || null });
        });
      });
      res.json(nodes);
    } catch (error) {
      console.error('获取待审批节点错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.post('/approve', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { nodeId } = req.body;
      const node = await Node.findById(nodeId).populate('associations.targetNode', 'name');
      const processorUser = await User.findById(req.user.userId).select('_id username');

      if (!node) {
        return res.status(404).json({ error: '知识域不存在' });
      }

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
        node.domainMaster = owner._id;
        node.allianceId = owner.allianceId || null;
      } else {
        node.domainMaster = null;
        node.allianceId = null;
      }
      node.contentScore = 1;
      await node.save();
      await saveNodeSenses({
        nodeId: node._id,
        senses: normalizeNodeSenseList(node),
        actorUserId: req.user.userId,
        fallbackDescription: node.description || ''
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
        await Node.findByIdAndDelete(rejectedNode._id);
        await NodeSense.deleteMany({ nodeId: rejectedNode._id });
        await deleteNodeTitleStatesByNodeIds([rejectedNode._id]);
        await deleteDomainTitleProjectionByNodeIds([rejectedNode._id]);
      }

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

      const canonicalNode = await loadCanonicalNodeResponseById(node._id);
      res.json({
        ...(canonicalNode || node.toObject()),
        autoRejectedCount: rejectedInfo.length,
        autoRejectedNodes: rejectedInfo
      });
    } catch (error) {
      console.error('审批节点错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });
};
