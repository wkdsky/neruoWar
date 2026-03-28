module.exports = ({ router, deps }) => {
  const {
    authenticateToken,
    Node,
    User,
    hydrateNodeSensesForNodes,
    normalizeNodeSenseList,
    loadNodeSearchCandidates,
    buildNodeSenseSearchEntries,
    normalizeAssociationDraftList,
    validateAssociationRuleSet,
    resolveAssociationsWithInsertPlans,
    saveNodeSenses,
    resolveNodeDefenseLayout,
    resolveNodeSiegeState,
    upsertNodeDefenseLayout,
    upsertNodeSiegeState,
    syncDomainTitleProjectionFromNode,
    applyInsertAssociationRewire,
    syncReciprocalAssociationsForNode,
    loadCanonicalNodeResponseById,
    sendNodeRouteError,
    getIdString
  } = deps;

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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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

      if (!name || !description) {
        return res.status(400).json({ error: '标题和简介不能为空' });
      }

      const existingApprovedNode = await Node.findOne({ name, status: 'approved' });
      if (existingApprovedNode) {
        return res.status(400).json({ error: '该知识域标题已被使用（已有同名的审核通过知识域）' });
      }

      const user = await User.findById(req.user.userId);
      const isUserAdmin = user.role === 'admin';

      if (isUserAdmin && !forceCreate) {
        const pendingNodesWithSameName = await Node.find({ name, status: 'pending' })
          .populate('owner', 'username profession')
          .populate('associations.targetNode', 'name');
        await hydrateNodeSensesForNodes(pendingNodesWithSameName);
        pendingNodesWithSameName.forEach((pendingNode) => {
          if (!pendingNode || typeof pendingNode !== 'object') return;
          pendingNode.synonymSenses = normalizeNodeSenseList(pendingNode, { actorUserId: req.user?.userId || null });
        });

        if (pendingNodesWithSameName.length > 0) {
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
        .filter((item) => item.title);

      if (rawSenseList.length === 0) {
        return res.status(400).json({ error: '创建知识域时至少需要一个同义词释义题目' });
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
        content: item.content || String(description || '').trim()
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
        domainMaster: isUserAdmin ? null : req.user.userId,
        allianceId: isUserAdmin ? null : (user.allianceId || null),
        name,
        description,
        synonymSenses: uniqueSenses,
        position,
        associations: associationsForStorage,
        relatedParentDomains,
        relatedChildDomains,
        status: isUserAdmin ? 'approved' : 'pending',
        contentScore: 1
      });

      await node.save();
      await saveNodeSenses({
        nodeId: node._id,
        senses: uniqueSenses,
        actorUserId: req.user.userId,
        fallbackDescription: description
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

      if (isUserAdmin) {
        await User.findByIdAndUpdate(req.user.userId, {
          $push: { ownedNodes: node._id }
        });
      }

      const canonicalNode = await loadCanonicalNodeResponseById(node._id);
      res.status(201).json(canonicalNode || node.toObject());
    } catch (error) {
      console.error('创建知识域错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      node.contentScore = 1;
      await node.save();
      await syncDomainTitleProjectionFromNode(node);
      const canonicalNode = await loadCanonicalNodeResponseById(node._id);
      res.status(200).json(canonicalNode || node.toObject());
    } catch (error) {
      console.error('关联节点错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      const canonicalNode = await loadCanonicalNodeResponseById(node._id);
      res.status(200).json(canonicalNode || node.toObject());
    } catch (error) {
      console.error('审批节点关联错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      const canonicalNode = await loadCanonicalNodeResponseById(node._id);
      res.status(200).json(canonicalNode || node.toObject());
    } catch (error) {
      console.error('拒绝节点关联错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.get('/:id', authenticateToken, async (req, res) => {
    try {
      const [node, user] = await Promise.all([
        loadCanonicalNodeResponseById(req.params.id),
        User.findById(req.user.userId).select('role')
      ]);
      if (!node) {
        return res.status(404).json({ message: '节点不存在' });
      }

      const isOwner = getIdString(node.owner) === req.user.userId;
      const isSystemAdmin = user?.role === 'admin';

      if (node.status !== 'approved' && !isOwner && !isSystemAdmin) {
        return res.status(403).json({ message: '无权访问此节点' });
      }

      res.json(node);
    } catch (err) {
      console.error('获取节点错误:', err);
      res.status(500).json({ message: '服务器错误' });
    }
  });
};
