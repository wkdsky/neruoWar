const Node = require('../models/Node');
const User = require('../models/User');
const {
  NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
  SENSE_ARTICLE_NOTIFICATION_PAYLOAD_SCHEMA
} = require('../constants/senseArticle');
const { writeNotificationsToCollection } = require('./notificationStore');
const { getIdString, toObjectIdOrNull } = require('../utils/objectId');

const uniqueUserIds = (items = []) => Array.from(new Set(
  (Array.isArray(items) ? items : []).map((item) => getIdString(item)).filter(Boolean)
));

const buildSenseArticleNotificationPayload = ({
  type,
  node = null,
  article = null,
  revision = null,
  stage = '',
  action = '',
  actorId = null,
  extra = {}
}) => ({
  schemaVersion: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
  nodeId: getIdString(extra?.nodeId || node?._id),
  senseId: String(extra?.senseId || revision?.senseId || article?.senseId || '').trim(),
  articleId: getIdString(extra?.articleId || article?._id),
  revisionId: getIdString(extra?.revisionId || revision?._id),
  stage: String(stage || extra?.stage || revision?.reviewStage || '').trim(),
  action: String(action || extra?.action || '').trim(),
  actorId: getIdString(actorId || extra?.actorId || revision?.proposerId),
  ...extra,
  __schema: SENSE_ARTICLE_NOTIFICATION_PAYLOAD_SCHEMA.byType[type] || SENSE_ARTICLE_NOTIFICATION_PAYLOAD_SCHEMA.commonRequired
});

const validateNotificationPayloadShape = ({ type, payload = {} }) => {
  const requiredKeys = SENSE_ARTICLE_NOTIFICATION_PAYLOAD_SCHEMA.byType[type] || SENSE_ARTICLE_NOTIFICATION_PAYLOAD_SCHEMA.commonRequired;
  return requiredKeys.every((key) => {
    const value = payload?.[key];
    return value !== null && value !== undefined && `${value}` !== '';
  });
};

const createNotificationDoc = ({
  userId,
  type,
  title,
  message,
  node,
  article,
  revision,
  stage,
  action,
  actorId,
  extraPayload = {}
}) => {
  const payload = buildSenseArticleNotificationPayload({
    type,
    node,
    article,
    revision,
    stage,
    action,
    actorId,
    extra: extraPayload
  });
  if (!validateNotificationPayloadShape({ type, payload })) {
    const error = new Error(`invalid_notification_payload:${type}`);
    error.expose = false;
    throw error;
  }
  return {
    userId,
    type,
    title,
    message,
    status: 'info',
    nodeId: node?._id || null,
    nodeName: node?.name || '',
    payload
  };
};

const writeSenseArticleNotifications = async (notifications = []) => {
  const docs = notifications.filter((item) => toObjectIdOrNull(item?.userId));
  if (docs.length === 0) return { insertedCount: 0 };
  return writeNotificationsToCollection(docs);
};

const notifyRevisionSubmitted = async ({ node, article, revision, actorId = null }) => {
  const reviewerIds = uniqueUserIds([...(node?.domainAdmins || []), node?.domainMaster]);
  const notifications = reviewerIds.map((userId) => createNotificationDoc({
    userId,
    type: 'sense_article_domain_admin_review_requested',
    title: '百科修订待域相审核',
    message: `${node?.name || '知识域'} / ${revision?.senseId || ''} 有新的百科修订待域相审核。`,
    node,
    article,
    revision,
    stage: 'domain_admin',
    action: 'review',
    actorId: actorId || revision?.proposerId
  }));
  notifications.push(createNotificationDoc({
    userId: revision?.proposerId,
    type: 'sense_article_revision_submitted',
    title: '百科修订已提交',
    message: '你的百科修订已进入双阶段审核。',
    node,
    article,
    revision,
    stage: 'domain_admin',
    action: 'submitted',
    actorId: actorId || revision?.proposerId
  }));
  return writeSenseArticleNotifications(notifications);
};

const notifyDomainAdminDecision = async ({ node, article, revision, action, actorId = null }) => {
  const typeMap = {
    approved: 'sense_article_domain_admin_approved',
    rejected: 'sense_article_domain_admin_rejected',
    changes_requested: 'sense_article_changes_requested'
  };
  const titleMap = {
    approved: '百科修订已通过域相审核',
    rejected: '百科修订被域相驳回',
    changes_requested: '百科修订被要求修改'
  };
  const messageMap = {
    approved: '修订已进入域主终审阶段。',
    rejected: '域相已驳回当前修订。',
    changes_requested: '域相要求你继续修改后再提交。'
  };
  const notifications = [createNotificationDoc({
    userId: revision?.proposerId,
    type: typeMap[action],
    title: titleMap[action],
    message: messageMap[action],
    node,
    article,
    revision,
    stage: 'domain_admin',
    action,
    actorId
  })];
  if (action === 'approved' && node?.domainMaster) {
    notifications.push(createNotificationDoc({
      userId: node.domainMaster,
      type: 'sense_article_domain_master_review_requested',
      title: '百科修订待域主终审',
      message: `${node?.name || '知识域'} / ${revision?.senseId || ''} 有一条修订待域主终审。`,
      node,
      article,
      revision,
      stage: 'domain_master',
      action: 'review',
      actorId
    }));
  }
  return writeSenseArticleNotifications(notifications);
};

const notifyDomainMasterDecision = async ({ node, article, revision, action, actorId = null }) => {
  const typeMap = {
    approved: 'sense_article_published',
    rejected: 'sense_article_domain_master_rejected',
    changes_requested: 'sense_article_changes_requested'
  };
  const titleMap = {
    approved: '百科修订已发布',
    rejected: '百科修订被终审驳回',
    changes_requested: '百科修订终审要求修改'
  };
  const messageMap = {
    approved: '你的修订已成为当前正式版本。',
    rejected: '域主已驳回该修订。',
    changes_requested: '域主要求你继续修改后再提交。'
  };
  return writeSenseArticleNotifications([
    createNotificationDoc({
      userId: revision?.proposerId,
      type: typeMap[action],
      title: titleMap[action],
      message: messageMap[action],
      node,
      article,
      revision,
      stage: 'domain_master',
      action,
      actorId
    })
  ]);
};

const notifySupersededRevisions = async ({ node, article, publishedRevision, supersededRevisions = [], actorId = null }) => {
  return writeSenseArticleNotifications(supersededRevisions.map((revision) => createNotificationDoc({
    userId: revision.proposerId,
    type: 'sense_article_revision_superseded',
    title: '百科修订已被覆盖',
    message: '同基线的另一条修订已发布，当前修订已标记为 superseded。',
    node,
    article,
    revision,
    stage: 'completed',
    action: 'superseded',
    actorId,
    extraPayload: {
      publishedRevisionId: getIdString(publishedRevision?._id)
    }
  })));
};

const notifyReferencedDomains = async ({ node, article, revision, actorId = null }) => {
  const references = Array.isArray(revision?.referenceIndex) ? revision.referenceIndex : [];
  const targetNodeIds = uniqueUserIds(references.map((item) => item.targetNodeId));
  if (targetNodeIds.length === 0) return { insertedCount: 0 };

  const targetNodes = await Node.find({ _id: { $in: targetNodeIds } }).select('_id name domainMaster').lean();
  const targetUsers = await User.find({ _id: { $in: uniqueUserIds(targetNodes.map((item) => item.domainMaster)) } }).select('_id').lean();
  const activeUserIdSet = new Set(uniqueUserIds(targetUsers.map((item) => item._id)));
  const notifications = targetNodes
    .filter((targetNode) => activeUserIdSet.has(getIdString(targetNode.domainMaster)))
    .map((targetNode) => createNotificationDoc({
      userId: targetNode.domainMaster,
      type: 'sense_article_referenced',
      title: '你的知识域被百科引用',
      message: `${node?.name || '知识域'} 的百科正文引用了 ${targetNode.name || '目标知识域'}。`,
      node,
      article,
      revision,
      stage: 'completed',
      action: 'referenced',
      actorId,
      extraPayload: {
        sourceNodeId: getIdString(node?._id),
        sourceSenseId: revision?.senseId || article?.senseId || '',
        sourceArticleId: getIdString(article?._id),
        sourceRevisionId: getIdString(revision?._id),
        referencedNodeId: getIdString(targetNode._id),
        referencedNodeName: targetNode.name || ''
      }
    }));
  return writeSenseArticleNotifications(notifications);
};

module.exports = {
  buildSenseArticleNotificationPayload,
  notifyDomainAdminDecision,
  notifyDomainMasterDecision,
  notifyReferencedDomains,
  notifyRevisionSubmitted,
  notifySupersededRevisions,
  validateNotificationPayloadShape
};
