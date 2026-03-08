import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCcw, Sparkles, XCircle } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import SenseArticleComparePanel from './SenseArticleComparePanel';
import SenseArticlePageHeader from './SenseArticlePageHeader';
import SenseArticleStateView from './SenseArticleStateView';
import SenseArticleStatusBadge from './SenseArticleStatusBadge';
import useSenseArticleCompare from './useSenseArticleCompare';
import {
  buildSenseArticleBreadcrumb,
  buildSenseArticleTitle,
  formatRevisionLabel,
  getRevisionStatusLabel,
  getSourceModeLabel,
  resolveSenseArticleStateFromError
} from './senseArticleUi';
import './SenseArticle.css';

const SenseArticleReviewPage = ({ nodeId, senseId, revisionId, articleContext, onContextPatch, onBack, onReviewed, onOpenDashboard }) => {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await senseArticleApi.getRevisionDetail(nodeId, senseId, revisionId);
      setDetail(data);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [nodeId, senseId, revisionId]);

  useEffect(() => {
    if (!detail) return;
    const revision = detail.revision || {};
    onContextPatch && onContextPatch({
      nodeId,
      senseId,
      articleId: detail.article?._id || articleContext?.articleId || '',
      currentRevisionId: detail.article?.currentRevisionId || articleContext?.currentRevisionId || '',
      selectedRevisionId: revision._id || revisionId,
      revisionId: revision._id || revisionId,
      revisionStatus: revision.status || '',
      breadcrumb: buildSenseArticleBreadcrumb({
        nodeName: articleContext?.nodeName || '',
        senseTitle: articleContext?.senseTitle || senseId,
        pageType: 'senseArticleReview',
        revisionNumber: revision.revisionNumber
      })
    });
  }, [detail, nodeId, senseId, revisionId, articleContext, onContextPatch]);

  const revision = detail?.revision || {};
  const baseRevision = detail?.baseRevision || {};
  const { compare: compareData, loading: compareLoading, error: compareError } = useSenseArticleCompare({
    nodeId,
    senseId,
    fromRevisionId: revision?.baseRevisionId || baseRevision?._id || '',
    toRevisionId: revision?._id || '',
    enabled: !!revision?._id && !!(revision?.baseRevisionId || baseRevision?._id)
  });

  const canDomainAdmin = !!detail?.permissions?.canReviewDomainAdmin && revision?.status === 'pending_domain_admin_review';
  const canDomainMaster = !!detail?.permissions?.canReviewDomainMaster && revision?.status === 'pending_domain_master_review';
  const canAct = canDomainAdmin || canDomainMaster;
  const rangeText = revision?.selectedRangeAnchor?.selectionText || revision?.selectedRangeAnchor?.textQuote || revision?.targetHeadingId || '';
  const reviewStageLabel = useMemo(() => {
    if (canDomainAdmin) return '当前由域相审核';
    if (canDomainMaster) return '当前由域主终审';
    return '当前修订不在你的可审核阶段';
  }, [canDomainAdmin, canDomainMaster]);

  const act = async (action) => {
    if (!detail || !canAct) return;
    setActing(action);
    try {
      const data = canDomainAdmin
        ? await senseArticleApi.reviewDomainAdmin(nodeId, senseId, revisionId, { action, comment })
        : await senseArticleApi.reviewDomainMaster(nodeId, senseId, revisionId, { action, comment });
      onReviewed && onReviewed(data.revision);
    } catch (requestError) {
      window.alert(requestError.message);
    } finally {
      setActing('');
    }
  };

  if (loading) {
    return <div className="sense-article-page"><SenseArticleStateView kind="loading" title="正在加载审阅页" description="正在读取候选 revision 与基线版本。" /></div>;
  }
  if (error) {
    const state = resolveSenseArticleStateFromError(error, {
      emptyTitle: '当前修订不可审阅',
      forbiddenTitle: '暂无审阅权限',
      errorTitle: '审阅页加载失败'
    });
    return <div className="sense-article-page"><SenseArticleStateView {...state} action={<button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>} /></div>;
  }
  if (!detail?.revision) {
    return <div className="sense-article-page"><SenseArticleStateView kind="empty" title="未找到修订记录" description="该 revision 可能已失效或无权访问。" action={<button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>} /></div>;
  }

  return (
    <div className="sense-article-page review-mode">
      <SenseArticlePageHeader
        pageType="senseArticleReview"
        articleContext={articleContext}
        title={buildSenseArticleTitle({
          nodeName: articleContext?.nodeName || nodeId,
          senseTitle: articleContext?.senseTitle || senseId,
          revisionNumber: revision.revisionNumber
        })}
        revisionStatus={revision.status || ''}
        badges={detail?.article?.currentRevisionId ? [<SenseArticleStatusBadge key="published" tone="success">已存在发布版</SenseArticleStatusBadge>] : []}
        metaItems={[
          `当前状态：${getRevisionStatusLabel(revision.status)}`,
          `基线版本：${formatRevisionLabel(baseRevision.revisionNumber)}`,
          `修订范围：${getSourceModeLabel(revision.sourceMode)}`,
          `目标小节：${revision.targetHeadingId || '--'}`
        ]}
        onBack={onBack}
        actions={(
          onOpenDashboard ? (
            <button type="button" className="btn btn-secondary" onClick={onOpenDashboard}>
              <Sparkles size={16} /> 治理面板
            </button>
          ) : null
        )}
      />

      <div className="sense-review-stage-card">
        <div className="sense-review-stage-item">
          <strong>阶段 1 / 域相审核</strong>
          <SenseArticleStatusBadge tone={revision.domainAdminDecision === 'approved' ? 'success' : revision.domainAdminDecision === 'pending' ? 'info' : revision.domainAdminDecision === 'changes_requested' ? 'warning' : 'danger'}>
            {revision.domainAdminDecision || 'pending'}
          </SenseArticleStatusBadge>
        </div>
        <div className="sense-review-stage-item">
          <strong>阶段 2 / 域主终审</strong>
          <SenseArticleStatusBadge tone={revision.domainMasterDecision === 'approved' ? 'success' : revision.domainMasterDecision === 'pending' ? 'info' : revision.domainMasterDecision === 'changes_requested' ? 'warning' : 'danger'}>
            {revision.domainMasterDecision || 'pending'}
          </SenseArticleStatusBadge>
        </div>
      </div>

      <div className="sense-review-layout productized">
        <section className="sense-review-pane">
          <SenseArticleComparePanel
            compare={compareData}
            loading={compareLoading}
            error={compareError}
            emptyMessage="该修订暂无可展示的结构化对比。"
            title={`基线 ${formatRevisionLabel(baseRevision.revisionNumber)} → 候选 ${formatRevisionLabel(revision.revisionNumber)}`}
          />
        </section>
        <section className="sense-review-pane side">
          <div className="sense-editor-pane-title">审阅信息</div>
          <div className="sense-review-note">{reviewStageLabel}</div>
          <div className="sense-editor-pane-title">修订说明</div>
          <div className="sense-review-note">{revision.proposerNote || '无提交说明'}</div>
          <div className="sense-editor-pane-title">范围来源</div>
          <div className="sense-review-note">{rangeText || '整页修订'}</div>
          <div className="sense-editor-pane-title">审核意见</div>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} className="sense-review-comment" placeholder="填写审核意见" disabled={!canAct || !!acting} />
          {canAct ? (
            <div className="sense-review-actions">
              <button type="button" className="btn btn-success" onClick={() => act('approve')} disabled={!!acting}>
                <CheckCircle2 size={16} /> {acting === 'approve' ? '处理中...' : '通过'}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => act('reject')} disabled={!!acting}>
                <XCircle size={16} /> {acting === 'reject' ? '处理中...' : '驳回'}
              </button>
              <button type="button" className="btn btn-warning" onClick={() => act('request_changes')} disabled={!!acting}>
                <RefreshCcw size={16} /> {acting === 'request_changes' ? '处理中...' : '要求修改'}
              </button>
            </div>
          ) : (
            <SenseArticleStateView compact kind="forbidden" title="当前不能执行审核动作" description="该修订可能已结束流转，或当前阶段不属于你的审核权限。" />
          )}
        </section>
      </div>
    </div>
  );
};

export default SenseArticleReviewPage;
