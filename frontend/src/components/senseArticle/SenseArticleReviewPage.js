import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Sparkles, XCircle } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import defaultMale1 from '../../assets/avatars/default_male_1.svg';
import defaultMale2 from '../../assets/avatars/default_male_2.svg';
import defaultMale3 from '../../assets/avatars/default_male_3.svg';
import defaultFemale1 from '../../assets/avatars/default_female_1.svg';
import defaultFemale2 from '../../assets/avatars/default_female_2.svg';
import defaultFemale3 from '../../assets/avatars/default_female_3.svg';
import SenseArticleComparePanel from './SenseArticleComparePanel';
import SenseArticlePageHeader from './SenseArticlePageHeader';
import SenseArticleStateView from './SenseArticleStateView';
import SenseArticleStatusBadge from './SenseArticleStatusBadge';
import useSenseArticleCompare from './useSenseArticleCompare';
import {
  buildSenseArticleBreadcrumb,
  buildSenseArticleTitle,
  getRevisionDisplayTitle,
  getRevisionStatusLabel,
  getSourceModeLabel,
  resolveSenseArticleStateFromError
} from './senseArticleUi';
import './SenseArticle.css';
import { buildSenseArticleAllianceContext, buildSenseArticleThemeStyle } from './senseArticleTheme';
import { buildScopedRevisionState, buildTrackedChangeTokens } from './senseArticleScopedRevision';

const reviewAvatarMap = {
  default_male_1: defaultMale1,
  default_male_2: defaultMale2,
  default_male_3: defaultMale3,
  default_female_1: defaultFemale1,
  default_female_2: defaultFemale2,
  default_female_3: defaultFemale3
};

const resolveReviewAvatarSrc = (avatarKey = '') => {
  const key = typeof avatarKey === 'string' ? avatarKey.trim() : '';
  if (!key) return reviewAvatarMap.default_male_1;
  return reviewAvatarMap[key] || reviewAvatarMap.default_male_1;
};

const voteToneClassName = (decision = '') => {
  if (decision === 'approved') return 'approved';
  if (decision === 'rejected') return 'rejected';
  return 'pending';
};

const SenseArticleReviewPage = ({ nodeId, senseId, revisionId, articleContext, onContextPatch, onBack, onReviewed, onOpenDashboard }) => {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState('');
  const pageThemeStyle = useMemo(() => buildSenseArticleThemeStyle(detail?.node ? { ...articleContext, node: detail.node } : articleContext), [detail, articleContext]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await senseArticleApi.getRevisionDetail(nodeId, senseId, revisionId, {
          signal: controller.signal
        });
        if (active) setDetail(data);
      } catch (requestError) {
        if (requestError?.name === 'AbortError') return;
        if (active) setError(requestError);
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
      controller.abort();
    };
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
      nodeName: detail.node?.name || articleContext?.nodeName || '',
      senseTitle: detail.nodeSense?.title || articleContext?.senseTitle || senseId,
      ...buildSenseArticleAllianceContext(detail.node, articleContext),
      breadcrumb: buildSenseArticleBreadcrumb({
        nodeName: articleContext?.nodeName || '',
        senseTitle: articleContext?.senseTitle || senseId,
        pageType: 'senseArticleReview',
        revisionTitle: getRevisionDisplayTitle(revision)
      })
    });
  }, [detail, nodeId, senseId, revisionId, articleContext, onContextPatch]);

  const revision = detail?.revision || {};
  const baseRevision = detail?.baseRevision || {};
  const reviewParticipants = Array.isArray(detail?.reviewParticipants) ? detail.reviewParticipants : [];
  const reviewSummary = detail?.reviewSummary || { total: 0, approvedCount: 0, rejectedCount: 0, pendingCount: 0 };
  const currentParticipant = reviewParticipants.find((item) => item?.isCurrentUser) || null;
  const isPendingReview = ['pending_review', 'pending_domain_admin_review', 'pending_domain_master_review'].includes(revision?.status);
  const canAct = isPendingReview && (!!detail?.permissions?.canReviewSenseArticle || !!detail?.permissions?.canReviewDomainMaster || !!currentParticipant);
  const canOpenDashboard = !!detail?.permissions?.canReviewDomainAdmin || !!detail?.permissions?.canReviewDomainMaster || !!detail?.permissions?.isSystemAdmin;
  const rangeText = revision?.selectedRangeAnchor?.selectionText || revision?.selectedRangeAnchor?.textQuote || revision?.targetHeadingId || '';
  const scopedState = useMemo(() => buildScopedRevisionState({
    sourceMode: revision?.sourceMode || 'full',
    baseSource: baseRevision?.editorSource || '',
    currentSource: revision?.editorSource || '',
    targetHeadingId: revision?.targetHeadingId || '',
    selectedRangeAnchor: revision?.selectedRangeAnchor || null,
    fallbackOriginalText: revision?.scopedChange?.originalText || '',
    fallbackCurrentText: revision?.scopedChange?.currentText || ''
  }), [baseRevision?.editorSource, revision?.editorSource, revision?.sourceMode, revision?.targetHeadingId, revision?.selectedRangeAnchor, revision?.scopedChange]);
  const trackedTokens = useMemo(() => buildTrackedChangeTokens(scopedState.originalText || '', scopedState.currentText || ''), [scopedState.originalText, scopedState.currentText]);
  const reviewStageLabel = useMemo(() => {
    if (revision?.status === 'published') return '该修订已经完成共审并发布。';
    if (revision?.status === 'rejected') return '该修订已被驳回，不会进入历史页。';
    if (canAct) return '你可以参与这次共同审阅。';
    return '你当前只能查看这次共审结果。';
  }, [canAct, revision?.status]);

  const { compare: compareData, loading: compareLoading, error: compareError } = useSenseArticleCompare({
    nodeId,
    senseId,
    fromRevisionId: revision?.baseRevisionId || baseRevision?._id || '',
    toRevisionId: revision?._id || '',
    enabled: !!revision?._id && !!(revision?.baseRevisionId || baseRevision?._id)
  });

  const act = async (action) => {
    if (!detail || !canAct) return;
    setActing(action);
    try {
      const data = await senseArticleApi.reviewRevision(nodeId, senseId, revisionId, { action, comment });
      onReviewed && onReviewed(data.revision);
    } catch (requestError) {
      window.alert(requestError.message);
    } finally {
      setActing('');
    }
  };

  if (loading) {
    return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView kind="loading" title="正在加载审阅页" description="正在读取候选 revision 与基线版本。" /></div>;
  }
  if (error) {
    const state = resolveSenseArticleStateFromError(error, {
      emptyTitle: '当前修订不可审阅',
      forbiddenTitle: '暂无审阅权限',
      errorTitle: '审阅页加载失败'
    });
    return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView {...state} action={<button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>} /></div>;
  }
  if (!detail?.revision) {
    return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView kind="empty" title="未找到修订记录" description="该 revision 可能已失效或无权访问。" action={<button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>} /></div>;
  }

  return (
    <div className="sense-article-page review-mode" style={pageThemeStyle}>
      <SenseArticlePageHeader
        pageType="senseArticleReview"
        articleContext={articleContext}
        title={buildSenseArticleTitle({
          nodeName: articleContext?.nodeName || nodeId,
          senseTitle: articleContext?.senseTitle || senseId,
          revisionTitle: getRevisionDisplayTitle(revision)
        })}
        revisionStatus={revision.status || ''}
        badges={detail?.article?.currentRevisionId ? [<SenseArticleStatusBadge key="published" tone="success">已存在发布版</SenseArticleStatusBadge>] : []}
        metaItems={[
          `当前状态：${getRevisionStatusLabel(revision.status)}`,
          `基线版本：${baseRevision?._id ? '当前发布版' : '无'}`,
          `修订范围：${getSourceModeLabel(revision.sourceMode)}`,
          `投票进度：${reviewSummary.approvedCount || 0}/${reviewSummary.total || 0} 通过`
        ]}
        onBack={onBack}
        actions={(
          canOpenDashboard && onOpenDashboard ? (
            <button type="button" className="btn btn-secondary" onClick={onOpenDashboard}>
              <Sparkles size={16} /> 词条管理
            </button>
          ) : null
        )}
      />

      <div className="sense-review-stage-card sense-review-vote-card">
        <div className="sense-review-vote-summary">
          <strong>共同审阅成员</strong>
          <span>{`通过 ${reviewSummary.approvedCount || 0} · 驳回 ${reviewSummary.rejectedCount || 0} · 待表决 ${reviewSummary.pendingCount || 0}`}</span>
        </div>
        <div className="sense-review-voter-list">
          {reviewParticipants.map((participant) => (
            <div key={`${participant.userId}-${participant.role}`} className={`sense-review-voter ${participant.isCurrentUser ? 'current' : ''}`} title={`${participant.username || '未命名用户'} · ${participant.role === 'domain_master' ? '域主' : '域相'}`}>
              <img src={resolveReviewAvatarSrc(participant.avatar)} alt={participant.username || '用户'} className="sense-review-voter-avatar" />
              <span className={`sense-review-voter-dot ${voteToneClassName(participant.decision)}`} />
              <span className="sense-review-voter-name">{participant.username || '未命名'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sense-review-layout productized">
        <section className="sense-review-pane">
          <SenseArticleComparePanel
            compare={compareData}
            loading={compareLoading}
            error={compareError}
            emptyMessage="该修订暂无可展示的结构化对比。"
            title={`当前发布版 → ${getRevisionDisplayTitle(revision)}`}
          />
        </section>
        <section className="sense-review-pane side">
          {scopedState.isScoped ? (
            <>
              <div className="sense-editor-pane-title">修订痕迹</div>
              <div className="sense-tracked-change-box review">
                {trackedTokens.length > 0 ? trackedTokens.map((token, index) => (
                  <span key={`${token.type}-${index}`} className={`sense-tracked-token ${token.type}`}>{token.value}</span>
                )) : <span className="sense-tracked-token equal">暂无文字变化</span>}
              </div>
            </>
          ) : null}
          <div className="sense-editor-pane-title">审阅信息</div>
          <div className="sense-review-note">{reviewStageLabel}</div>
          <div className="sense-editor-pane-title">修订说明</div>
          <div className="sense-review-note">{revision.proposerNote || '无提交说明'}</div>
          {revision?.proposedSenseTitle && revision.proposedSenseTitle !== detail?.nodeSense?.title ? (
            <>
              <div className="sense-editor-pane-title">待生效释义名称</div>
              <div className="sense-review-note">{revision.proposedSenseTitle}</div>
            </>
          ) : null}
          <div className="sense-editor-pane-title">范围来源</div>
          <div className="sense-review-note">{rangeText || '整页修订'}</div>
          <div className="sense-editor-pane-title">审核意见</div>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} className="sense-review-comment" placeholder="填写审核意见（可选）" disabled={!canAct || !!acting} />
          {canAct ? (
            <div className="sense-review-actions">
              <button type="button" className="btn btn-success" onClick={() => act('approve')} disabled={!!acting}>
                <CheckCircle2 size={16} /> {acting === 'approve' ? '处理中...' : '通过'}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => act('reject')} disabled={!!acting}>
                <XCircle size={16} /> {acting === 'reject' ? '处理中...' : '驳回'}
              </button>
            </div>
          ) : (
            <SenseArticleStateView compact kind="forbidden" title="当前不能执行审核动作" description="该修订可能已结束流转，或你当前不在这次共审名单中。" />
          )}
        </section>
      </div>
    </div>
  );
};

export default SenseArticleReviewPage;
