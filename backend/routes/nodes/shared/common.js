module.exports = ({
  mongoose,
  Node,
  NodeSense,
  User,
  schedulerService,
  fetchUnitTypesWithComponents,
  isNodeSenseCollectionReadEnabled,
  isNodeSenseRepairEnabled,
  hydrateNodeSensesForNodes,
  resolveNodeSensesForNode,
  deleteNodeTitleStatesByNodeIds,
  deleteDomainTitleProjectionByNodeIds
}) => {
  const fetchEnabledUnitTypes = async () => {
    const registry = await fetchUnitTypesWithComponents({ enabledOnly: true });
    return Array.isArray(registry?.unitTypes) ? registry.unitTypes : [];
  };

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

  const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

  const buildNotificationPayload = (payload = {}) => ({
    ...payload,
    _id: payload?._id && mongoose.Types.ObjectId.isValid(String(payload._id))
      ? new mongoose.Types.ObjectId(String(payload._id))
      : new mongoose.Types.ObjectId(),
    createdAt: payload?.createdAt ? new Date(payload.createdAt) : new Date()
  });

  const pushNotificationToUser = (user, payload = {}) => {
    if (!user) return null;
    const notification = buildNotificationPayload(payload);
    user.notifications = Array.isArray(user.notifications) ? user.notifications : [];
    user.notifications.unshift(notification);
    return notification;
  };

  const toCollectionNotificationDoc = (userId, notification = {}) => {
    const source = typeof notification?.toObject === 'function' ? notification.toObject() : notification;
    return {
      ...source,
      _id: source?._id,
      userId
    };
  };

  const pushDomainCreateApplyResultNotification = ({
    applicant,
    nodeName = '',
    nodeId = null,
    decision = 'rejected',
    processorUser = null,
    rejectedReason = ''
  } = {}) => {
    if (!applicant) return null;
    const safeNodeName = String(nodeName || '').trim() || '知识域';
    const operatorName = String(processorUser?.username || '').trim() || '管理员';
    const message = decision === 'accepted'
      ? `${operatorName} 已通过你创建新知识域「${safeNodeName}」的申请`
      : (String(rejectedReason || '').trim() || `${operatorName} 已拒绝你创建新知识域「${safeNodeName}」的申请`);

    return pushNotificationToUser(applicant, {
      type: 'info',
      title: `新知识域申请结果：${safeNodeName}`,
      message,
      read: false,
      status: decision === 'accepted' ? 'accepted' : 'rejected',
      nodeId: decision === 'accepted' ? (nodeId || null) : null,
      nodeName: safeNodeName,
      inviterId: processorUser?._id || null,
      inviterUsername: operatorName,
      inviteeId: applicant?._id || null,
      inviteeUsername: applicant?.username || '',
      respondedAt: new Date()
    });
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

  const enqueueNodeSenseBackfillFromRoute = (node = {}, actorUserId = null) => {
    if (!isNodeSenseCollectionReadEnabled() || !isNodeSenseRepairEnabled()) return;
    const nodeId = getIdString(node?._id);
    if (!isValidObjectId(nodeId)) return;
    const senseVersion = Number.isFinite(Number(node?.senseVersion)) ? Number(node.senseVersion) : 0;
    const requesterId = getIdString(actorUserId) || null;
    schedulerService.enqueue({
      type: 'node_sense_backfill_job',
      payload: {
        nodeId,
        actorUserId: requesterId
      },
      dedupeKey: `node_sense_backfill:${nodeId}:${senseVersion}`
    }).catch((error) => {
      console.error('入队释义 backfill 任务失败:', error);
    });
  };

  const normalizeNodeSenseList = (node = {}, { actorUserId = null } = {}) => {
    const resolved = resolveNodeSensesForNode(node, {
      fallbackDescription: typeof node?.description === 'string' ? node.description : ''
    });
    if (resolved.shouldEnqueueBackfill) {
      enqueueNodeSenseBackfillFromRoute(node, actorUserId);
    }
    return resolved.senses;
  };

  const sendNodeRouteError = (res, error, fallbackMessage = '服务器错误') => {
    if (error?.expose && error?.message) {
      return res.status(Number(error.statusCode) || 400).json({
        error: error.message || fallbackMessage,
        code: error.code || '',
        details: error.details || null
      });
    }
    return res.status(500).json({ error: fallbackMessage });
  };

  const loadCanonicalNodeResponseById = async (nodeId, { populate = [] } = {}) => {
    const safeNodeId = getIdString(nodeId);
    if (!isValidObjectId(safeNodeId)) return null;

    let query = Node.findById(safeNodeId);
    const populateList = Array.isArray(populate) ? populate : [];
    populateList.forEach((item) => {
      if (item) query = query.populate(item);
    });

    const node = await query;
    if (!node) return null;

    await hydrateNodeSensesForNodes([node]);
    const canonicalSenses = normalizeNodeSenseList(node);

    const nodeObj = node.toObject();
    nodeObj.synonymSenses = canonicalSenses;
    delete nodeObj.__senseCollectionRows;
    Node.applyKnowledgePointProjection(nodeObj, new Date());
    return nodeObj;
  };

  const mapProjectionRowToNodeLike = (row = {}) => ({
    _id: row?.nodeId || row?._id || null,
    owner: row?.owner || null,
    domainMaster: row?.domainMaster || null,
    domainAdmins: Array.isArray(row?.domainAdmins) ? row.domainAdmins : [],
    allianceId: row?.allianceId || null,
    name: row?.name || '',
    description: row?.description || '',
    relatedParentDomains: Array.isArray(row?.relatedParentDomains) ? row.relatedParentDomains : [],
    relatedChildDomains: Array.isArray(row?.relatedChildDomains) ? row.relatedChildDomains : [],
    contentScore: row?.contentScore,
    knowledgePoint: row?.knowledgePoint || null,
    status: row?.status || 'approved',
    isFeatured: !!row?.isFeatured,
    featuredOrder: Number.isFinite(Number(row?.featuredOrder)) ? Number(row.featuredOrder) : 0,
    createdAt: row?.createdAt || null,
    lastUpdate: row?.lastUpdate || null
  });

  const deleteNodeWithResources = async (node = null) => {
    if (!node?._id) return;
    await Node.findByIdAndDelete(node._id);
    await NodeSense.deleteMany({ nodeId: node._id });
    await deleteNodeTitleStatesByNodeIds([node._id]);
    await deleteDomainTitleProjectionByNodeIds([node._id]);

    const ownerId = getIdString(node?.owner);
    if (isValidObjectId(ownerId)) {
      await User.findByIdAndUpdate(ownerId, {
        $pull: { ownedNodes: node._id }
      });
    }
  };

  return {
    fetchEnabledUnitTypes,
    getIdString,
    isValidObjectId,
    pushNotificationToUser,
    toCollectionNotificationDoc,
    pushDomainCreateApplyResultNotification,
    isDomainMaster,
    isDomainAdmin,
    DOMAIN_CARD_SELECT,
    normalizeNodeSenseList,
    sendNodeRouteError,
    loadCanonicalNodeResponseById,
    mapProjectionRowToNodeLike,
    deleteNodeWithResources
  };
};
