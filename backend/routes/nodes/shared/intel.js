module.exports = ({
  getIdString,
  isValidObjectId,
  isDomainMaster,
  isDomainAdmin,
  cityGateKeys = ['cheng', 'qi'],
  userIntelSnapshotLimit = 5
}) => {
  const serializeIntelSnapshot = (snapshot = {}) => {
    const source = typeof snapshot?.toObject === 'function' ? snapshot.toObject() : snapshot;
    const gateDefenseSource = source?.gateDefense && typeof source.gateDefense === 'object'
      ? source.gateDefense
      : {};
    return {
      nodeId: getIdString(source?.nodeId),
      nodeName: source?.nodeName || '',
      sourceBuildingId: source?.sourceBuildingId || '',
      deploymentUpdatedAt: source?.deploymentUpdatedAt || null,
      capturedAt: source?.capturedAt || null,
      gateDefense: cityGateKeys.reduce((acc, key) => {
        const entries = Array.isArray(gateDefenseSource[key]) ? gateDefenseSource[key] : [];
        acc[key] = entries
          .map((entry) => ({
            unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
            unitName: typeof entry?.unitName === 'string' ? entry.unitName : '',
            count: Math.max(0, Math.floor(Number(entry?.count) || 0))
          }))
          .filter((entry) => entry.unitTypeId && entry.count > 0);
        return acc;
      }, { cheng: [], qi: [] })
    };
  };

  const toIntelSnapshotTimestamp = (value) => {
    const ms = new Date(value || 0).getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  };

  const listUserIntelSnapshotEntries = (rawSnapshots = null) => {
    if (!rawSnapshots) return [];
    if (rawSnapshots instanceof Map) {
      return Array.from(rawSnapshots.entries());
    }
    if (Array.isArray(rawSnapshots)) {
      return rawSnapshots
        .map((item) => [getIdString(item?.nodeId), item])
        .filter(([nodeId]) => !!nodeId);
    }
    if (typeof rawSnapshots === 'object') {
      const asObject = typeof rawSnapshots.toObject === 'function'
        ? rawSnapshots.toObject()
        : rawSnapshots;
      return Object.entries(asObject || {})
        .filter(([nodeId, value]) => !!getIdString(nodeId) && !!value);
    }
    return [];
  };

  const normalizeUserIntelSnapshotStore = (rawSnapshots = null, limit = userIntelSnapshotLimit) => {
    const byNodeId = new Map();
    for (const [rawNodeId, rawSnapshot] of listUserIntelSnapshotEntries(rawSnapshots)) {
      const serialized = serializeIntelSnapshot(rawSnapshot || {});
      const nodeId = getIdString(serialized?.nodeId || rawNodeId);
      if (!nodeId) continue;
      const nextSnapshot = {
        ...serialized,
        nodeId
      };
      const existed = byNodeId.get(nodeId);
      if (!existed) {
        byNodeId.set(nodeId, nextSnapshot);
        continue;
      }
      const existedTs = toIntelSnapshotTimestamp(existed.capturedAt);
      const nextTs = toIntelSnapshotTimestamp(nextSnapshot.capturedAt);
      if (nextTs >= existedTs) {
        byNodeId.set(nodeId, nextSnapshot);
      }
    }

    const sorted = Array.from(byNodeId.entries())
      .sort((a, b) => toIntelSnapshotTimestamp(b[1]?.capturedAt) - toIntelSnapshotTimestamp(a[1]?.capturedAt));
    const limited = Number.isFinite(limit) && limit > 0 ? sorted.slice(0, limit) : sorted;
    return limited.reduce((acc, [nodeId, snapshot]) => {
      acc[nodeId] = snapshot;
      return acc;
    }, {});
  };

  const findUserIntelSnapshotByNodeId = (user, nodeId) => {
    const targetNodeId = getIdString(nodeId);
    if (!targetNodeId) return null;
    const store = normalizeUserIntelSnapshotStore(user?.intelDomainSnapshots, userIntelSnapshotLimit);
    return store[targetNodeId] || null;
  };

  const checkIntelHeistPermission = ({ node, user }) => {
    if (!node || node.status !== 'approved') {
      return { allowed: false, reason: '知识域不存在或不可操作' };
    }
    if (!user) {
      return { allowed: false, reason: '用户不存在' };
    }
    if (user.role !== 'common') {
      return { allowed: false, reason: '仅普通用户可进行情报窃取' };
    }
    const userId = getIdString(user._id);
    if (isDomainMaster(node, userId) || isDomainAdmin(node, userId)) {
      return { allowed: false, reason: '域主/域相不可进行情报窃取' };
    }
    const userLocation = typeof user.location === 'string' ? user.location.trim() : '';
    if (!userLocation || userLocation !== (node.name || '')) {
      return { allowed: false, reason: '必须到达该知识域后才能执行情报窃取' };
    }
    return { allowed: true, reason: '' };
  };

  const buildIntelGateDefenseSnapshot = (gateDefense = {}, unitTypeMap = new Map()) => {
    const source = gateDefense && typeof gateDefense === 'object' ? gateDefense : {};
    return cityGateKeys.reduce((acc, key) => {
      const entries = Array.isArray(source[key]) ? source[key] : [];
      acc[key] = entries
        .map((entry) => {
          const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
          const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
          if (!unitTypeId || count <= 0) return null;
          const unitName = unitTypeMap.get(unitTypeId)?.name || unitTypeId;
          return {
            unitTypeId,
            unitName,
            count
          };
        })
        .filter(Boolean);
      return acc;
    }, { cheng: [], qi: [] });
  };

  const normalizeGateDefenseViewerAdminIds = (viewerIds = [], allowedAdminIds = null) => {
    const out = [];
    const seen = new Set();
    const allowedSet = Array.isArray(allowedAdminIds) && allowedAdminIds.length > 0
      ? new Set(allowedAdminIds.map((id) => getIdString(id)).filter((id) => isValidObjectId(id)))
      : null;
    for (const item of (Array.isArray(viewerIds) ? viewerIds : [])) {
      const userId = getIdString(item);
      if (!isValidObjectId(userId)) continue;
      if (allowedSet && !allowedSet.has(userId)) continue;
      if (seen.has(userId)) continue;
      seen.add(userId);
      out.push(userId);
    }
    return out;
  };

  return {
    serializeIntelSnapshot,
    normalizeUserIntelSnapshotStore,
    findUserIntelSnapshotByNodeId,
    checkIntelHeistPermission,
    buildIntelGateDefenseSnapshot,
    normalizeGateDefenseViewerAdminIds
  };
};
