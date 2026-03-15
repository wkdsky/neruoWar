import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUp, GitCompare, History, Sparkles } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import SenseArticleComparePanel from './SenseArticleComparePanel';
import SenseArticlePageHeader from './SenseArticlePageHeader';
import SenseArticleStateView from './SenseArticleStateView';
import SenseArticleStatusBadge from './SenseArticleStatusBadge';
import useSenseArticleCompare from './useSenseArticleCompare';
import {
  buildSenseArticleBreadcrumb,
  buildSenseArticleTitle,
  getRevisionDisplayTitle,
  getRevisionListLabel,
  resolveSenseArticleStateFromError
} from './senseArticleUi';
import './SenseArticle.css';

const SenseArticleHistoryPage = ({ nodeId, senseId, articleContext, onContextPatch, onBack, onOpenDashboard }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inlineCompare, setInlineCompare] = useState({ revisionId: '', from: '', to: '' });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await senseArticleApi.getRevisions(nodeId, senseId, { status: 'approved', pageSize: 50 });
        setData(response);
      } catch (requestError) {
        setError(requestError);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [nodeId, senseId]);

  useEffect(() => {
    if (!data) return;
    onContextPatch && onContextPatch({
      nodeId,
      senseId,
      articleId: data.article?._id || articleContext?.articleId || '',
      currentRevisionId: data.currentRevisionId || articleContext?.currentRevisionId || '',
      breadcrumb: buildSenseArticleBreadcrumb({
        nodeName: articleContext?.nodeName || '',
        senseTitle: articleContext?.senseTitle || senseId,
        pageType: 'senseArticleHistory'
      })
    });
  }, [data, nodeId, senseId, articleContext, onContextPatch]);

  const revisions = useMemo(() => ([...(data?.revisions || [])].sort((left, right) => (
    new Date(right?.publishedAt || right?.updatedAt || right?.createdAt || 0).getTime()
    - new Date(left?.publishedAt || left?.updatedAt || left?.createdAt || 0).getTime()
  ))), [data]);
  const currentRevisionId = data?.currentRevisionId || '';
  const canOpenDashboard = !!data?.permissions?.canReviewDomainAdmin || !!data?.permissions?.canReviewDomainMaster || !!data?.permissions?.isSystemAdmin;
  const { compare: compareData, loading: compareLoading, error: compareError } = useSenseArticleCompare({
    nodeId,
    senseId,
    fromRevisionId: inlineCompare.from,
    toRevisionId: inlineCompare.to,
    enabled: !!inlineCompare.revisionId && !!inlineCompare.from && !!inlineCompare.to
  });

  const compareLabels = useMemo(() => {
    const fromRevision = revisions.find((item) => String(item._id) === String(inlineCompare.from));
    const toRevision = revisions.find((item) => String(item._id) === String(inlineCompare.to));
    return {
      from: fromRevision ? getRevisionDisplayTitle(fromRevision) : '未命名修订',
      to: toRevision ? getRevisionDisplayTitle(toRevision) : '未命名修订'
    };
  }, [revisions, inlineCompare.from, inlineCompare.to]);

  const handleToggleInlineCompare = (revision) => {
    const revisionId = String(revision?._id || '');
    if (!revisionId || !currentRevisionId || revisionId === String(currentRevisionId)) return;
    setInlineCompare((prev) => {
      if (String(prev.revisionId) === revisionId) {
        return { revisionId: '', from: '', to: '' };
      }
      return {
        revisionId,
        from: currentRevisionId,
        to: revisionId
      };
    });
  };

  if (loading) {
    return <div className="sense-article-page"><SenseArticleStateView kind="loading" title="正在加载历史页" description="正在读取当前释义百科页的已发布版本。" /></div>;
  }
  if (error) {
    const state = resolveSenseArticleStateFromError(error, {
      emptyTitle: '暂无可查看的历史版本',
      forbiddenTitle: '无法查看历史页',
      errorTitle: '历史页加载失败'
    });
    return <div className="sense-article-page"><SenseArticleStateView {...state} action={<button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>} /></div>;
  }

  return (
    <div className="sense-article-page history-mode">
      <SenseArticlePageHeader
        pageType="senseArticleHistory"
        articleContext={articleContext}
        title={buildSenseArticleTitle({ nodeName: articleContext?.nodeName || nodeId, senseTitle: articleContext?.senseTitle || senseId })}
        revisionStatus=""
        badges={currentRevisionId ? [<SenseArticleStatusBadge key="current" tone="success">当前发布版已标记</SenseArticleStatusBadge>] : []}
        metaItems={[`历史版本数：${revisions.length}`]}
        onBack={onBack}
        actions={(
          <>
            {canOpenDashboard && onOpenDashboard ? (
              <button type="button" className="btn btn-secondary" onClick={onOpenDashboard}>
                <Sparkles size={16} /> 词条管理
              </button>
            ) : null}
            <span className="sense-history-header-icon"><History size={18} /></span>
          </>
        )}
      />

      {revisions.length === 0 ? (
        <SenseArticleStateView kind="empty" title="暂无历史版本" description="当前释义百科页还没有已审核通过并发布的版本记录。" />
      ) : (
        <div className="sense-history-list">
          {revisions.map((revision) => {
            const isCurrent = String(revision._id) === String(currentRevisionId);
            const isInlineCompareOpen = String(inlineCompare.revisionId) === String(revision._id);
            return (
              <div key={revision._id} className={`sense-history-card ${isCurrent ? 'current' : ''}`}>
                <div className="sense-history-main">
                  <div className="sense-history-title">
                    <strong>{getRevisionListLabel(revision, articleContext?.senseTitle || senseId)}</strong>
                    {isCurrent ? <SenseArticleStatusBadge tone="success">当前版本</SenseArticleStatusBadge> : null}
                  </div>
                  <div className="sense-history-meta">发起人：{revision.proposerUsername || revision.proposerId || '--'} · {revision.publishedAt ? new Date(revision.publishedAt).toLocaleString('zh-CN', { hour12: false }) : '--'}</div>
                  <div className="sense-history-note">{revision.proposerNote || '无提交说明'}</div>
                </div>
                {!isCurrent && currentRevisionId ? (
                  <div className="sense-history-actions">
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => handleToggleInlineCompare(revision)}>
                      <GitCompare size={16} /> {isInlineCompareOpen ? '收起版本对比' : '与发布版本对比'}
                    </button>
                  </div>
                ) : null}
                {isInlineCompareOpen ? (
                  <div className="sense-history-inline-compare">
                    <SenseArticleComparePanel
                      compare={compareData}
                      loading={compareLoading}
                      error={compareError}
                      emptyMessage="当前版本与发布版本之间暂无可展示差异。"
                      title={`版本对比 ${compareLabels.from} → ${compareLabels.to}`}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        className="sense-page-back-to-top"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="回到顶部"
        title="回到顶部"
      >
        <ArrowUp size={18} />
      </button>
    </div>
  );
};

export default SenseArticleHistoryPage;
