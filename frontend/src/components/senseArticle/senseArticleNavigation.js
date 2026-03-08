const normalizeId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') return String(value._id || value.id || '').trim();
  return String(value).trim();
};

export const isSenseArticleView = (view = '') => String(view || '').startsWith('senseArticle');

export const createSenseArticleContext = (patch = {}, base = null) => ({
  nodeId: '',
  senseId: '',
  articleId: '',
  currentRevisionId: '',
  selectedRevisionId: '',
  revisionId: '',
  originView: '',
  breadcrumb: [],
  returnTarget: null,
  originNodeId: '',
  originTitleId: '',
  originArticle: null,
  sourceHint: '',
  nodeName: '',
  senseTitle: '',
  revisionStatus: '',
  ...(base || {}),
  ...(patch || {})
});

export const snapshotSenseArticleLocation = (context = null, view = 'senseArticle', patch = {}) => createSenseArticleContext({
  ...(context || {}),
  ...(patch || {}),
  view
}, context || {});

export const buildSenseArticleNavigationState = ({
  target = {},
  options = {},
  currentView = '',
  currentContext = null,
  currentNodeId = '',
  currentTitleId = ''
}) => {
  const targetNodeId = normalizeId(target?.nodeId || target?._id);
  const targetSenseId = typeof target?.senseId === 'string' ? target.senseId.trim() : '';
  if (!targetNodeId || !targetSenseId) return null;
  const previousArticle = isSenseArticleView(currentView)
    ? snapshotSenseArticleLocation(currentContext, currentView)
    : null;
  return createSenseArticleContext({
    nodeId: targetNodeId,
    senseId: targetSenseId,
    articleId: options.articleId || target?.articleId || currentContext?.articleId || '',
    currentRevisionId: options.currentRevisionId || currentContext?.currentRevisionId || '',
    selectedRevisionId: options.selectedRevisionId || options.revisionId || target?.revisionId || '',
    revisionId: options.revisionId || options.selectedRevisionId || target?.revisionId || '',
    originView: options.originView || currentView,
    originNodeId: normalizeId(currentNodeId),
    originTitleId: normalizeId(currentTitleId),
    breadcrumb: Array.isArray(options.breadcrumb) ? options.breadcrumb : (currentContext?.breadcrumb || []),
    returnTarget: options.returnTarget || currentContext?.returnTarget || null,
    sourceHint: options.sourceHint || '',
    originArticle: options.originArticle || previousArticle
  }, currentContext);
};

export const buildSenseArticleSubViewContext = (currentContext = null, currentView = '', patch = {}, options = {}) => createSenseArticleContext({
  ...(patch || {}),
  originView: options.originView || currentContext?.originView || currentView,
  originArticle: options.originArticle || currentContext?.originArticle || (isSenseArticleView(currentView) ? snapshotSenseArticleLocation(currentContext, currentView) : null),
  returnTarget: options.returnTarget || snapshotSenseArticleLocation(currentContext, currentView)
}, currentContext);

export const resolveSenseArticleBackTarget = ({ context = null }) => {
  const returnTarget = context?.returnTarget || null;
  if (returnTarget?.view && isSenseArticleView(returnTarget.view)) {
    return {
      kind: 'article',
      view: returnTarget.view,
      context: createSenseArticleContext(returnTarget, returnTarget)
    };
  }
  if (returnTarget?.view) {
    return {
      kind: 'view',
      view: returnTarget.view
    };
  }
  if (context?.originArticle?.view && isSenseArticleView(context.originArticle.view)) {
    return {
      kind: 'article',
      view: context.originArticle.view,
      context: createSenseArticleContext(context.originArticle, context.originArticle)
    };
  }
  if (context?.originView) {
    return {
      kind: 'view',
      view: context.originView
    };
  }
  return { kind: 'home', view: 'home' };
};

export const resolveSenseArticleNotificationNavigation = (notification = {}) => {
  const payload = notification?.payload || {};
  const notificationType = String(notification?.type || '').trim();
  const targetNodeId = normalizeId(payload.sourceNodeId || payload.nodeId || notification?.nodeId);
  const targetSenseId = typeof (payload?.sourceSenseId || payload?.senseId) === 'string'
    ? String(payload.sourceSenseId || payload.senseId).trim()
    : '';
  if (!targetNodeId || !targetSenseId) return null;

  if ((notificationType === 'sense_article_domain_admin_review_requested'
    || notificationType === 'sense_article_domain_master_review_requested'
    || payload.action === 'review') && payload.revisionId) {
    return {
      target: { nodeId: targetNodeId, senseId: targetSenseId },
      options: { view: 'senseArticleReview', revisionId: payload.revisionId, selectedRevisionId: payload.revisionId }
    };
  }
  if (notificationType === 'sense_article_changes_requested' && payload.revisionId) {
    return {
      target: { nodeId: targetNodeId, senseId: targetSenseId },
      options: { view: 'senseArticleEditor', revisionId: payload.revisionId, selectedRevisionId: payload.revisionId }
    };
  }
  if ((notificationType === 'sense_article_published'
    || notificationType === 'sense_article_revision_superseded'
    || notificationType === 'sense_article_domain_master_rejected') && payload.revisionId) {
    return {
      target: { nodeId: targetNodeId, senseId: targetSenseId },
      options: { view: 'senseArticleHistory', revisionId: payload.revisionId, selectedRevisionId: payload.revisionId }
    };
  }
  if (notificationType === 'sense_article_referenced') {
    return {
      target: { nodeId: targetNodeId, senseId: targetSenseId },
      options: {
        view: 'senseArticle',
        sourceHint: payload.referencedNodeName ? `引用目标：${payload.referencedNodeName}` : '来自引用通知',
        returnTarget: {
          nodeId: normalizeId(payload.referencedNodeId || payload.nodeId),
          senseId: payload.senseId || ''
        }
      }
    };
  }
  return {
    target: { nodeId: targetNodeId, senseId: targetSenseId },
    options: { view: 'senseArticle', revisionId: payload.revisionId || '', selectedRevisionId: payload.revisionId || '' }
  };
};
