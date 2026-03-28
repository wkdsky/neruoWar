module.exports = ({ router, deps }) => {
  const {
    Node,
    User,
    Notification,
    authenticateToken,
    getIdString,
    isValidObjectId,
    syncDomainTitleProjectionFromNode,
    loadCanonicalNodeResponseById,
    sendNodeRouteError,
    DOMAIN_CARD_SELECT,
    hydrateNodeSensesForNodes,
    normalizeNodeSenseList,
    normalizeRecentVisitMode,
    pickNodeSenseById,
    buildNodeSenseDisplayName,
    pushNotificationToUser,
    toCollectionNotificationDoc,
    writeNotificationsToCollection,
    isDomainMaster,
    isDomainAdmin,
    isNotificationCollectionReadEnabled,
    buildDomainAdminPermissionState,
    DOMAIN_ADMIN_PERMISSION_KEYS,
    DOMAIN_ADMIN_PERMISSION_DEFINITIONS,
    resolveNodeDefenseLayout,
    normalizeGateDefenseViewerAdminIds,
    hydrateNodeTitleStatesForNodes,
    getNodeDomainAdminPermissionMap,
    normalizePermissionKeys,
    serializeDefenseLayout,
    upsertNodeDefenseLayout,
    upsertNotificationsToCollection
  } = deps;

  // 管理员：更换节点域主
  router.put('/admin/domain-master/:nodeId', authenticateToken, async (req, res) => {
    try {
      const adminUser = await User.findById(req.user.userId);
      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({ error: '无权限执行此操作' });
      }

      const { nodeId } = req.params;
      const { domainMasterId } = req.body;

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

      if (!domainMasterId) {
        node.domainMaster = null;
        node.allianceId = null;
        if (currentMasterId) {
          resetDistributionOwnerBoundState();
        }
        await node.save();
        await syncDomainTitleProjectionFromNode(node);
        const canonicalNode = await loadCanonicalNodeResponseById(nodeId, {
          populate: [{ path: 'domainMaster', select: 'username profession' }]
        });
        return res.json({
          success: true,
          message: '域主已清除',
          node: canonicalNode
        });
      }

      const newMaster = await User.findById(domainMasterId).select('role allianceId');
      if (!newMaster) {
        return res.status(404).json({ error: '用户不存在' });
      }
      if (newMaster.role === 'admin') {
        return res.status(400).json({ error: '管理员不能作为域主' });
      }

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
      const canonicalNode = await loadCanonicalNodeResponseById(nodeId, {
        populate: [{ path: 'domainMaster', select: 'username profession' }]
      });

      res.json({
        success: true,
        message: '域主更换成功',
        node: canonicalNode
      });
    } catch (error) {
      console.error('更换域主错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  // 管理员：搜索用户（用于选择域主）
  router.get('/admin/search-users', authenticateToken, async (req, res) => {
    try {
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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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
      await Promise.all([
        hydrateNodeSensesForNodes(domainMasterDomains),
        hydrateNodeSensesForNodes(domainAdminDomains),
        hydrateNodeSensesForNodes(favoriteDomains),
        hydrateNodeSensesForNodes(recentNodes)
      ]);
      const applyResolvedSenses = (list = []) => {
        (Array.isArray(list) ? list : []).forEach((item) => {
          if (!item || typeof item !== 'object') return;
          item.synonymSenses = normalizeNodeSenseList(item, { actorUserId: req.user?.userId || null });
        });
      };
      applyResolvedSenses(domainMasterDomains);
      applyResolvedSenses(domainAdminDomains);
      applyResolvedSenses(favoriteDomains);
      applyResolvedSenses(recentNodes);
      const recentNodeMap = new Map(recentNodes.map((node) => [getIdString(node._id), node]));
      const recentDomains = recentEntries
        .map((item) => {
          const nodeId = getIdString(item.nodeId);
          const node = recentNodeMap.get(nodeId);
          if (!node) return null;
          const visitMode = normalizeRecentVisitMode(item?.visitMode);
          const rawSenseId = typeof item?.senseId === 'string' ? item.senseId.trim() : '';
          const selectedSense = visitMode === 'sense'
            ? pickNodeSenseById(node, rawSenseId)
            : null;
          const selectedSenseId = visitMode === 'sense'
            ? (selectedSense?.senseId || rawSenseId)
            : '';
          const selectedSenseTitle = visitMode === 'sense'
            ? (selectedSense?.title || '')
            : '';
          const recentVisitDisplayName = visitMode === 'sense'
            ? buildNodeSenseDisplayName(node.name || '', selectedSenseTitle)
            : (node.name || '');
          return {
            ...node,
            visitedAt: item.visitedAt,
            recentVisitMode: visitMode,
            recentVisitSenseId: selectedSenseId,
            recentVisitSenseTitle: selectedSenseTitle,
            recentVisitDisplayName
          };
        })
        .filter(Boolean);

      const now = new Date();
      const applyKnowledgePointProjectionForList = (list = []) => {
        (Array.isArray(list) ? list : []).forEach((item) => {
          if (!item || typeof item !== 'object') return;
          Node.applyKnowledgePointProjection(item, now);
        });
      };
      applyKnowledgePointProjectionForList(domainMasterDomains);
      applyKnowledgePointProjectionForList(domainAdminDomains);
      applyKnowledgePointProjectionForList(favoriteDomains);
      applyKnowledgePointProjectionForList(recentDomains);

      res.json({
        success: true,
        domainMasterDomains,
        domainAdminDomains,
        favoriteDomains,
        recentDomains
      });
    } catch (error) {
      console.error('获取相关知识域错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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

      const visitModeInput = typeof req.body?.mode === 'string'
        ? req.body.mode
        : req.body?.visitMode;
      const visitMode = normalizeRecentVisitMode(
        visitModeInput || (typeof req.body?.senseId === 'string' && req.body.senseId.trim() ? 'sense' : 'title')
      );
      const senseId = visitMode === 'sense' && typeof req.body?.senseId === 'string'
        ? req.body.senseId.trim()
        : '';

      const targetId = getIdString(node._id);
      const filtered = (user.recentVisitedDomains || []).filter((item) => {
        if (getIdString(item?.nodeId) !== targetId) return true;
        const itemMode = normalizeRecentVisitMode(item?.visitMode);
        const itemSenseId = itemMode === 'sense' && typeof item?.senseId === 'string'
          ? item.senseId.trim()
          : '';
        return !(itemMode === visitMode && itemSenseId === senseId);
      });
      user.recentVisitedDomains = [
        {
          nodeId: node._id,
          visitMode,
          senseId,
          visitedAt: new Date()
        },
        ...filtered
      ].slice(0, 50);

      await user.save();

      res.json({
        success: true
      });
    } catch (error) {
      console.error('记录最近访问知识域错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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
        notification.type === 'domain_master_apply'
        && notification.status === 'pending'
        && getIdString(notification.nodeId) === nodeId
        && getIdString(notification.inviteeId) === requestUserId
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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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

      const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins domainAdminPermissions');
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

      const useCollectionNotification = isNotificationCollectionReadEnabled();
      let hasPendingRequest = false;
      if (useCollectionNotification) {
        const pendingDoc = await Notification.findOne({
          userId: domainMaster._id,
          type: 'domain_admin_resign_request',
          status: 'pending',
          nodeId: node._id,
          inviteeId: requester._id
        }).select('_id').lean();
        hasPendingRequest = !!pendingDoc;
      } else {
        hasPendingRequest = (domainMaster.notifications || []).some((notification) => (
          notification.type === 'domain_admin_resign_request'
          && notification.status === 'pending'
          && getIdString(notification.nodeId) === nodeId
          && getIdString(notification.inviteeId) === requestUserId
        ));
      }

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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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

      const node = await Node.findById(nodeId).select('name domainMaster domainAdmins domainAdminPermissions');

      if (!node) {
        return res.status(404).json({ error: '节点不存在' });
      }

      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
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
          const permissionState = buildDomainAdminPermissionState({ node, userId: adminId });
          return {
            _id: getIdString(adminUser._id),
            username: adminUser.username,
            profession: adminUser.profession,
            role: adminUser.role,
            permissions: {
              ...permissionState.permissions,
              [DOMAIN_ADMIN_PERMISSION_KEYS.GATE_DEFENSE_VIEW]: false
            },
            grantedPermissionKeys: permissionState.grantedKeys,
            permissionLabels: []
          };
        })
        .filter(Boolean);
      const defenseLayout = resolveNodeDefenseLayout(node, {});
      const gateDefenseViewerAdminIds = normalizeGateDefenseViewerAdminIds(
        defenseLayout?.gateDefenseViewAdminIds,
        domainAdminIds
      );
      admins.forEach((adminItem) => {
        const nextPermissionState = buildDomainAdminPermissionState({
          node,
          userId: adminItem._id,
          gateDefenseViewerAdminIds
        });
        adminItem.permissions = nextPermissionState.permissions;
        adminItem.grantedPermissionKeys = nextPermissionState.grantedKeys;
        adminItem.permissionLabels = DOMAIN_ADMIN_PERMISSION_DEFINITIONS
          .filter((permissionDef) => nextPermissionState.permissions[permissionDef.key])
          .map((permissionDef) => permissionDef.label);
      });

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
        const useCollectionNotification = isNotificationCollectionReadEnabled();
        if (useCollectionNotification) {
          const pendingDoc = await Notification.findOne({
            userId: domainMasterId,
            type: 'domain_admin_resign_request',
            status: 'pending',
            nodeId,
            inviteeId: requestUserId
          }).select('_id').lean();
          resignPending = !!pendingDoc;
        } else {
          const domainMaster = await User.findById(domainMasterId).select('notifications');
          resignPending = !!(domainMaster?.notifications || []).some((notification) => (
            notification.type === 'domain_admin_resign_request'
            && notification.status === 'pending'
            && getIdString(notification.nodeId) === nodeId
            && getIdString(notification.inviteeId) === requestUserId
          ));
        }
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
        availablePermissions: DOMAIN_ADMIN_PERMISSION_DEFINITIONS,
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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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
        notification.type === 'domain_admin_invite'
        && notification.status === 'pending'
        && notification.nodeId
        && notification.nodeId.toString() === node._id.toString()
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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  // 域主批量配置域相权限
  router.put('/:nodeId/domain-admins/permissions', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const requestUserId = getIdString(req?.user?.userId);
      if (!isValidObjectId(requestUserId)) {
        return res.status(401).json({ error: '无效的用户身份' });
      }
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const node = await Node.findById(nodeId).select('name status domainMaster domainAdmins domainAdminPermissions');
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }
      await hydrateNodeTitleStatesForNodes([node], {
        includeDefenseLayout: true,
        includeBattlefieldLayout: true,
        includeSiegeState: false
      });
      if (!isDomainMaster(node, requestUserId)) {
        return res.status(403).json({ error: '只有域主可以配置域相权限' });
      }

      const allowedAdminIds = (node.domainAdmins || []).map((id) => getIdString(id)).filter((id) => isValidObjectId(id));
      const incomingPermissionsByUserId = req.body?.permissionsByUserId && typeof req.body.permissionsByUserId === 'object'
        ? req.body.permissionsByUserId
        : {};
      const nextPermissionMap = {};
      allowedAdminIds.forEach((adminId) => {
        const rawValue = incomingPermissionsByUserId?.[adminId];
        const permissionKeys = Array.isArray(rawValue)
          ? rawValue
          : (rawValue && typeof rawValue === 'object'
            ? Object.keys(rawValue).filter((key) => !!rawValue[key])
            : []);
        nextPermissionMap[adminId] = normalizePermissionKeys(permissionKeys);
      });

      node.domainAdminPermissions = nextPermissionMap;
      await node.save();

      const gateDefenseViewerAdminIds = allowedAdminIds.filter((adminId) => (
        Array.isArray(nextPermissionMap[adminId])
        && nextPermissionMap[adminId].includes(DOMAIN_ADMIN_PERMISSION_KEYS.GATE_DEFENSE_VIEW)
      ));
      const currentLayout = serializeDefenseLayout(resolveNodeDefenseLayout(node, {}));
      const nextLayout = {
        ...currentLayout,
        gateDefenseViewAdminIds: gateDefenseViewerAdminIds,
        updatedAt: new Date()
      };
      await upsertNodeDefenseLayout({
        nodeId: node._id,
        layout: nextLayout,
        actorUserId: requestUserId
      });

      const adminUsers = allowedAdminIds.length > 0
        ? await User.find({ _id: { $in: allowedAdminIds } }).select('_id username profession role').lean()
        : [];
      const adminUserMap = new Map(adminUsers.map((item) => [getIdString(item._id), item]));
      const domainAdmins = allowedAdminIds.map((adminId) => {
        const userItem = adminUserMap.get(adminId);
        if (!userItem) return null;
        const permissionState = buildDomainAdminPermissionState({
          node: { ...node.toObject(), domainAdminPermissions: nextPermissionMap },
          userId: adminId,
          gateDefenseViewerAdminIds
        });
        return {
          _id: adminId,
          username: userItem.username,
          profession: userItem.profession,
          role: userItem.role,
          permissions: permissionState.permissions,
          grantedPermissionKeys: permissionState.grantedKeys,
          permissionLabels: DOMAIN_ADMIN_PERMISSION_DEFINITIONS
            .filter((permissionDef) => permissionState.permissions[permissionDef.key])
            .map((permissionDef) => permissionDef.label)
        };
      }).filter(Boolean);

      res.json({
        success: true,
        message: '域相权限已保存',
        availablePermissions: DOMAIN_ADMIN_PERMISSION_DEFINITIONS,
        gateDefenseViewerAdminIds,
        domainAdmins
      });
    } catch (error) {
      console.error('保存域相权限错误:', error);
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
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
        includeBattlefieldLayout: true,
        includeSiegeState: false
      });
      if (!isDomainMaster(node, requestUserId)) {
        return res.status(403).json({ error: '只有域主可以配置承口/启口可查看权限' });
      }

      const viewerAdminIds = normalizeGateDefenseViewerAdminIds(
        req.body?.viewerAdminIds,
        (node.domainAdmins || []).map((id) => getIdString(id))
      );

      const currentPermissionMap = getNodeDomainAdminPermissionMap(node);
      const nextPermissionMap = {};
      (node.domainAdmins || []).map((id) => getIdString(id)).filter((id) => isValidObjectId(id)).forEach((adminId) => {
        const currentKeys = Array.isArray(currentPermissionMap[adminId]) ? currentPermissionMap[adminId] : [];
        const nextKeys = viewerAdminIds.includes(adminId)
          ? normalizePermissionKeys([...currentKeys, DOMAIN_ADMIN_PERMISSION_KEYS.GATE_DEFENSE_VIEW])
          : normalizePermissionKeys(currentKeys.filter((key) => key !== DOMAIN_ADMIN_PERMISSION_KEYS.GATE_DEFENSE_VIEW));
        nextPermissionMap[adminId] = nextKeys;
      });
      node.domainAdminPermissions = nextPermissionMap;
      await node.save();

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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });
};
