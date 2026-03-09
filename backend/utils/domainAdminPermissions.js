const { getIdString } = require('./objectId');

const DOMAIN_ADMIN_PERMISSION_KEYS = Object.freeze({
  SENSE_ARTICLE_REVIEW: 'senseArticleReview',
  GATE_DEFENSE_VIEW: 'gateDefenseView'
});

const DOMAIN_ADMIN_PERMISSION_DEFINITIONS = Object.freeze([
  {
    key: DOMAIN_ADMIN_PERMISSION_KEYS.SENSE_ARTICLE_REVIEW,
    label: '百科审核',
    description: '可参与释义百科修订审阅'
  },
  {
    key: DOMAIN_ADMIN_PERMISSION_KEYS.GATE_DEFENSE_VIEW,
    label: '承口/启口查看',
    description: '可查看承口/启口兵力'
  }
]);

const ALLOWED_PERMISSION_KEY_SET = new Set(DOMAIN_ADMIN_PERMISSION_DEFINITIONS.map((item) => item.key));

const normalizePermissionKeys = (permissionKeys = []) => Array.from(new Set(
  (Array.isArray(permissionKeys) ? permissionKeys : [])
    .map((item) => String(item || '').trim())
    .filter((item) => ALLOWED_PERMISSION_KEY_SET.has(item))
));

const getRawPermissionEntries = (raw = null) => {
  if (!raw) return [];
  if (raw instanceof Map) return Array.from(raw.entries());
  if (typeof raw.toObject === 'function') return Object.entries(raw.toObject());
  if (typeof raw === 'object') return Object.entries(raw);
  return [];
};

const getAllowedAdminIdSet = (node = null, allowedAdminIds = null) => new Set(
  (Array.isArray(allowedAdminIds) ? allowedAdminIds : (Array.isArray(node?.domainAdmins) ? node.domainAdmins : []))
    .map((item) => getIdString(item))
    .filter(Boolean)
);

const getNodeDomainAdminPermissionMap = (node = null, allowedAdminIds = null) => {
  const allowedAdminIdSet = getAllowedAdminIdSet(node, allowedAdminIds);
  const normalized = {};
  getRawPermissionEntries(node?.domainAdminPermissions).forEach(([userId, permissionKeys]) => {
    const normalizedUserId = getIdString(userId);
    if (!normalizedUserId || !allowedAdminIdSet.has(normalizedUserId)) return;
    normalized[normalizedUserId] = normalizePermissionKeys(permissionKeys);
  });
  return normalized;
};

const buildDomainAdminPermissionState = ({ node = null, userId = '', gateDefenseViewerAdminIds = [] } = {}) => {
  const normalizedUserId = getIdString(userId);
  const permissionMap = getNodeDomainAdminPermissionMap(node);
  const hasExplicitEntry = Object.prototype.hasOwnProperty.call(permissionMap, normalizedUserId);
  const grantedPermissionKeySet = new Set(hasExplicitEntry
    ? permissionMap[normalizedUserId]
    : [DOMAIN_ADMIN_PERMISSION_KEYS.SENSE_ARTICLE_REVIEW]
  );
  if ((Array.isArray(gateDefenseViewerAdminIds) ? gateDefenseViewerAdminIds : []).some((item) => getIdString(item) === normalizedUserId)) {
    grantedPermissionKeySet.add(DOMAIN_ADMIN_PERMISSION_KEYS.GATE_DEFENSE_VIEW);
  }
  const grantedKeys = DOMAIN_ADMIN_PERMISSION_DEFINITIONS
    .map((item) => item.key)
    .filter((key) => grantedPermissionKeySet.has(key));
  const permissions = DOMAIN_ADMIN_PERMISSION_DEFINITIONS.reduce((acc, item) => {
    acc[item.key] = grantedPermissionKeySet.has(item.key);
    return acc;
  }, {});
  return {
    permissions,
    grantedKeys,
    hasExplicitEntry
  };
};

const hasDomainAdminPermission = ({ node = null, userId = '', permissionKey = '', gateDefenseViewerAdminIds = [] } = {}) => {
  const { permissions } = buildDomainAdminPermissionState({ node, userId, gateDefenseViewerAdminIds });
  return !!permissions[String(permissionKey || '').trim()];
};

const getSenseArticleReviewerEntries = (node = null) => {
  const reviewerEntries = [];
  const seen = new Set();
  const domainMasterId = getIdString(node?.domainMaster);
  if (domainMasterId) {
    reviewerEntries.push({ userId: domainMasterId, role: 'domain_master' });
    seen.add(domainMasterId);
  }
  (Array.isArray(node?.domainAdmins) ? node.domainAdmins : []).forEach((adminId) => {
    const normalizedAdminId = getIdString(adminId);
    if (!normalizedAdminId || seen.has(normalizedAdminId)) return;
    if (!hasDomainAdminPermission({ node, userId: normalizedAdminId, permissionKey: DOMAIN_ADMIN_PERMISSION_KEYS.SENSE_ARTICLE_REVIEW })) return;
    reviewerEntries.push({ userId: normalizedAdminId, role: 'domain_admin' });
    seen.add(normalizedAdminId);
  });
  return reviewerEntries;
};

module.exports = {
  DOMAIN_ADMIN_PERMISSION_DEFINITIONS,
  DOMAIN_ADMIN_PERMISSION_KEYS,
  getNodeDomainAdminPermissionMap,
  buildDomainAdminPermissionState,
  hasDomainAdminPermission,
  normalizePermissionKeys,
  getSenseArticleReviewerEntries
};
