export const SENSE_ARTICLE_ENTRY_LABEL = '进入释义百科页';
export const SENSE_ARTICLE_ENTRY_SHORT_LABEL = '释义百科页';
export const SENSE_ARTICLE_CREATE_LABEL = '创建百科页';

export const EDITABLE_SENSE_ARTICLE_STATUSES = ['draft', 'changes_requested_by_domain_admin', 'changes_requested_by_domain_master'];

export const SENSE_ARTICLE_PAGE_LABELS = {
  senseArticle: '阅读页',
  senseArticleEditor: '编辑页',
  senseArticleReview: '审阅页',
  senseArticleHistory: '历史页',
  senseArticleDashboard: '词条管理'
};

export const REVISION_STATUS_META = {
  draft: { label: '草稿', tone: 'neutral' },
  submitted: { label: '已提交', tone: 'info' },
  pending_review: { label: '待审核', tone: 'info' },
  pending_domain_admin_review: { label: '待审核', tone: 'info' },
  changes_requested_by_domain_admin: { label: '域相要求修改', tone: 'warning' },
  rejected_by_domain_admin: { label: '域相驳回', tone: 'danger' },
  pending_domain_master_review: { label: '待审核', tone: 'info' },
  changes_requested_by_domain_master: { label: '域主要求修改', tone: 'warning' },
  rejected_by_domain_master: { label: '修订驳回', tone: 'danger' },
  rejected: { label: '修订驳回', tone: 'danger' },
  published: { label: '已发布', tone: 'success' },
  superseded: { label: '已被覆盖', tone: 'muted' },
  withdrawn: { label: '已撤回', tone: 'muted' }
};

export const REFERENCE_TARGET_STATUS_META = {
  published: { label: '已发布', tone: 'success' },
  unpublished: { label: '未发布', tone: 'warning' },
  missing: { label: '引用目标不存在', tone: 'danger' },
  unknown: { label: '状态未知', tone: 'muted' }
};

export const getRevisionStatusMeta = (status = '') => REVISION_STATUS_META[String(status || '').trim()] || {
  label: status || '未知状态',
  tone: 'muted'
};

export const getRevisionStatusLabel = (status = '') => getRevisionStatusMeta(status).label;
export const getRevisionStatusTone = (status = '') => getRevisionStatusMeta(status).tone;

export const isEditableSenseArticleStatus = (status = '') => EDITABLE_SENSE_ARTICLE_STATUSES.includes(String(status || '').trim());

export const findEditableSenseArticleRevision = ({ revisions = [], currentUserId = '', isSystemAdmin = false } = {}) => {
  const normalizedUserId = String(currentUserId || '').trim();
  return (Array.isArray(revisions) ? revisions : []).find((revision) => {
    if (!isEditableSenseArticleStatus(revision?.status)) return false;
    if (isSystemAdmin) return true;
    return String(revision?.proposerId || '').trim() === normalizedUserId;
  }) || null;
};

export const getSenseArticleEntryActionLabel = ({ hasPublishedRevision = false, loading = false } = {}) => {
  if (loading) return '百科加载中';
  return hasPublishedRevision ? SENSE_ARTICLE_ENTRY_SHORT_LABEL : SENSE_ARTICLE_CREATE_LABEL;
};

export const getSenseArticleEmptyCtaLabel = ({ hasEditableDraft = false, loading = false } = {}) => {
  if (loading) return '检查草稿中';
  return hasEditableDraft ? '继续编辑草稿' : '创建首个百科版本';
};

export const getReferenceTargetStatusMeta = (status = '', isValid = false) => {
  const normalized = String(status || '').trim();
  if (REFERENCE_TARGET_STATUS_META[normalized]) return REFERENCE_TARGET_STATUS_META[normalized];
  if (isValid) return REFERENCE_TARGET_STATUS_META.published;
  return REFERENCE_TARGET_STATUS_META.missing;
};

export const getReferenceTargetStatusLabel = (status = '', isValid = false) => getReferenceTargetStatusMeta(status, isValid).label;
export const getReferenceTargetStatusTone = (status = '', isValid = false) => getReferenceTargetStatusMeta(status, isValid).tone;

export const getRelocationStatusLabel = (status = '') => ({
  exact: '精确定位',
  relocated: '已重定位',
  uncertain: '待确认',
  broken: '已失效'
}[status] || status || '未知');

export const getSourceModeLabel = (mode = '') => ({
  full: '整页修订',
  section: '小节修订',
  selection: '选段修订'
}[mode] || mode || '整页修订');

export const buildDefaultRevisionTitle = (username = '') => `来自 ${String(username || '').trim() || '该用户'} 的修订`;

export const getRevisionDisplayTitle = (revision = {}, fallbackUsername = '') => {
  const customTitle = String(revision?.revisionTitle || '').trim();
  if (customTitle) return customTitle;
  const proposerUsername = String(revision?.proposerUsername || fallbackUsername || '').trim();
  return buildDefaultRevisionTitle(proposerUsername);
};

export const formatRevisionLabel = (revisionNumber = null) => Number.isFinite(Number(revisionNumber))
  ? `修订 #${Number(revisionNumber)}`
  : '修订 #--';

export const buildSenseArticleBreadcrumb = ({ nodeName = '', senseTitle = '', pageType = '', revisionNumber = null, revisionTitle = '' }) => {
  const items = ['释义百科页'];
  if (nodeName) items.push(nodeName);
  if (senseTitle) items.push(senseTitle);
  const pageLabel = SENSE_ARTICLE_PAGE_LABELS[pageType] || '';
  if (pageLabel) items.push(pageLabel);
  if (String(revisionTitle || '').trim()) items.push(String(revisionTitle || '').trim());
  else if (Number.isFinite(Number(revisionNumber))) items.push(formatRevisionLabel(revisionNumber));
  return items;
};

export const buildSenseArticleTitle = ({ nodeName = '', senseTitle = '', revisionNumber = null, revisionTitle = '' }) => {
  const items = [nodeName || '未命名词条', senseTitle || '未命名释义'];
  if (String(revisionTitle || '').trim()) items.push(String(revisionTitle || '').trim());
  else if (Number.isFinite(Number(revisionNumber))) items.push(formatRevisionLabel(revisionNumber));
  return items.join(' / ');
};

export const getSenseArticleBackLabel = (context = null) => {
  const targetView = context?.returnTarget?.view || context?.originArticle?.view || context?.originView || '';
  if (SENSE_ARTICLE_PAGE_LABELS[targetView]) return `返回${SENSE_ARTICLE_PAGE_LABELS[targetView]}`;
  if (targetView === 'nodeDetail') return '返回节点主视角';
  if (targetView === 'titleDetail') return '返回词条主视角';
  if (targetView === 'home') return '返回首页';
  return '返回上一级';
};

export const normalizeSenseArticleErrorMessage = (error, fallback = '请求失败') => {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  return fallback;
};

export const resolveSenseArticleStateFromError = (error, options = {}) => {
  const status = Number(error?.status || 0);
  const message = normalizeSenseArticleErrorMessage(error, options.fallbackDescription || '请求失败');
  if (status === 403) {
    return {
      kind: 'forbidden',
      title: options.forbiddenTitle || '暂无访问权限',
      description: options.forbiddenDescription || message
    };
  }
  if (status === 404) {
    return {
      kind: 'empty',
      title: options.emptyTitle || '暂无可用内容',
      description: options.emptyDescription || message
    };
  }
  return {
    kind: 'error',
    title: options.errorTitle || '加载失败',
    description: options.errorDescription || message
  };
};
