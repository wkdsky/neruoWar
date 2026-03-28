module.exports = ({ router, deps }) => {
  const {
    authenticateToken,
    mongoose,
    Node,
    User,
    DistributionParticipant,
    DistributionResult,
    EntropyAlliance,
    KnowledgeDistributionService,
    getIdString,
    isValidObjectId,
    isDomainMaster,
    isDomainAdmin,
    extractDistributionProfilesFromNode,
    serializeDistributionRule,
    serializeDistributionLock,
    filterRuleUsersByAllowedSet,
    computeDistributionPercentSummary,
    round2,
    clampPercent,
    sendNodeRouteError,
    collectRuleUserIds,
    loadCommonUserIdSet,
    sanitizeDistributionRuleProfileInput,
    sanitizeDistributionRuleInput,
    parseDistributionExecuteAtHour,
    toDistributionSessionExecuteAt,
    resolveDistributionLockTimeline,
    getDistributionLockPhase,
    isUserIdleAtNode,
    READ_LEGACY_RESULTUSERREWARDS,
    getActiveManualParticipantSet,
    buildManualJoinOrderMapFromLegacyLock,
    DISTRIBUTION_POOL_USER_LIST_LIMIT,
    listDistributionParticipantsBySession,
    listDistributionResultsByNode,
    parseDistributionResultCursor,
    DISTRIBUTION_RESULT_PAGE_SIZE_MAX,
    syncDistributionParticipantJoinRecord,
    syncDistributionParticipantExitRecord,
    DISTRIBUTION_LEGACY_PARTICIPANT_MIRROR_LIMIT,
    toSafeInteger
  } = deps;

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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
        distributedTotal: 0,
        rewardParticipantCount: 0,
        resultUserRewards: [],
        ruleSnapshot: selectedRule
      };
      node.knowledgeDistributionLastAnnouncedAt = now;
      await node.save();
      await deps.syncDomainTitleProjectionFromNode(node);

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
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      const rewardSnapshotMap = new Map();
      const lockExecuteAt = toDistributionSessionExecuteAt(lock);
      if (lock.executedAt && lockExecuteAt instanceof Date) {
        const currentRewardRow = await DistributionResult.findOne({
          nodeId: node._id,
          executeAt: lockExecuteAt,
          userId: currentUser._id
        }).select('userId amount').lean();
        if (currentRewardRow) {
          rewardSnapshotMap.set(
            getIdString(currentRewardRow.userId),
            round2(Math.max(0, Number(currentRewardRow.amount) || 0))
          );
        } else if (READ_LEGACY_RESULTUSERREWARDS) {
          for (const item of (Array.isArray(lock.resultUserRewards) ? lock.resultUserRewards : [])) {
            const itemUserId = getIdString(item?.userId);
            if (!isValidObjectId(itemUserId)) continue;
            rewardSnapshotMap.set(itemUserId, round2(Math.max(0, Number(item?.amount) || 0)));
          }
        }
      } else if (READ_LEGACY_RESULTUSERREWARDS) {
        for (const item of (Array.isArray(lock.resultUserRewards) ? lock.resultUserRewards : [])) {
          const itemUserId = getIdString(item?.userId);
          if (!isValidObjectId(itemUserId)) continue;
          rewardSnapshotMap.set(itemUserId, round2(Math.max(0, Number(item?.amount) || 0)));
        }
      }
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
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

  router.get('/:nodeId/distribution-results', authenticateToken, async (req, res) => {
    try {
      const { nodeId } = req.params;
      if (!isValidObjectId(nodeId)) {
        return res.status(400).json({ error: '无效的知识域ID' });
      }

      const node = await Node.findById(nodeId).select('name status knowledgeDistributionLocked');
      if (!node || node.status !== 'approved') {
        return res.status(404).json({ error: '知识域不存在或不可操作' });
      }

      const executeAtRaw = typeof req.query?.executeAt === 'string' ? req.query.executeAt.trim() : '';
      let executeAt = null;
      if (executeAtRaw) {
        const parsedExecuteAt = new Date(executeAtRaw);
        if (!Number.isFinite(parsedExecuteAt.getTime())) {
          return res.status(400).json({ error: 'executeAt 参数无效' });
        }
        executeAt = parsedExecuteAt;
      }
      if (!(executeAt instanceof Date)) {
        const latest = await DistributionResult.findOne({
          nodeId: new mongoose.Types.ObjectId(String(nodeId))
        }).sort({ executeAt: -1, createdAt: -1, _id: -1 }).select('executeAt').lean();
        executeAt = latest?.executeAt || toDistributionSessionExecuteAt(node.knowledgeDistributionLocked || {});
      }

      if (!(executeAt instanceof Date)) {
        return res.json({
          success: true,
          nodeId: node._id,
          nodeName: node.name,
          executeAt: null,
          limit: 0,
          cursor: null,
          nextCursor: null,
          rows: []
        });
      }

      const limit = Math.max(
        1,
        Math.min(DISTRIBUTION_RESULT_PAGE_SIZE_MAX, parseInt(req.query?.limit, 10) || 50)
      );
      const rawCursor = typeof req.query?.cursor === 'string' ? req.query.cursor.trim() : '';
      const cursor = parseDistributionResultCursor(rawCursor);
      const page = await listDistributionResultsByNode({
        nodeId: node._id,
        executeAt,
        limit,
        cursor
      });

      const userIds = Array.from(new Set(
        (page.rows || [])
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

      const rows = (page.rows || []).map((item) => {
        const userId = getIdString(item?.userId);
        const user = userMap.get(userId) || null;
        const allianceId = getIdString(user?.allianceId);
        return {
          _id: getIdString(item?._id),
          nodeId: getIdString(item?.nodeId),
          executeAt: item?.executeAt || null,
          userId,
          username: user?.username || '',
          avatar: user?.avatar || 'default_male_1',
          profession: user?.profession || '',
          allianceId: allianceId || '',
          allianceName: allianceNameMap.get(allianceId) || '',
          amount: round2(Math.max(0, Number(item?.amount) || 0)),
          createdAt: item?.createdAt || null
        };
      });

      return res.json({
        success: true,
        nodeId: node._id,
        nodeName: node.name,
        executeAt,
        limit,
        cursor: rawCursor || null,
        nextCursor: page.nextCursor || null,
        rows
      });
    } catch (error) {
      console.error('获取分发结果列表错误:', error);
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });

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
      return sendNodeRouteError(res, (typeof error !== 'undefined' ? error : null));
    }
  });
};
