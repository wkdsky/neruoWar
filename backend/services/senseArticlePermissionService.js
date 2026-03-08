const User = require('../models/User');
const { getIdString } = require('../utils/objectId');

const deriveUserRoleInfo = ({ user = null, userId = '', node = null }) => {
  const userIdText = getIdString(userId || user?._id);
  const isSystemAdmin = user?.role === 'admin';
  const isDomainMaster = getIdString(node?.domainMaster) === userIdText;
  const isDomainAdmin = (Array.isArray(node?.domainAdmins) ? node.domainAdmins : []).some((item) => getIdString(item) === userIdText);
  return {
    user,
    userId: userIdText,
    isSystemAdmin,
    isDomainMaster,
    isDomainAdmin,
    canRead: true,
    canCreateRevision: true,
    canReviewDomainAdmin: isSystemAdmin || isDomainAdmin || isDomainMaster,
    canReviewDomainMaster: isSystemAdmin || isDomainMaster,
    canManageGraphAssociations: isSystemAdmin || isDomainMaster
  };
};

const getUserRoleInfo = async (userId, node = null) => {
  const user = await User.findById(userId).select('role username');
  if (!user) {
    const error = new Error('用户不存在');
    error.statusCode = 404;
    error.expose = true;
    throw error;
  }
  return deriveUserRoleInfo({ user, userId, node });
};

const ensurePermission = (allowed, message = '权限不足', statusCode = 403) => {
  if (allowed) return;
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  throw error;
};

module.exports = {
  deriveUserRoleInfo,
  ensurePermission,
  getUserRoleInfo
};
