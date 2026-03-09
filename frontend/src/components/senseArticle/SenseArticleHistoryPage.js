import React, { useEffect, useMemo, useState } from 'react';
import { GitCompare, History, Sparkles } from 'lucide-react';
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
  resolveSenseArticleStateFromError
} from './senseArticleUi';
import './SenseArticle.css';

const SenseArticleHistoryPage = ({ nodeId, senseId, articleContext, onContextPatch, onBack, onOpenDashboard }) => {
  const [data, setData] = useState(null);
  const [compareIds, setCompareIds] = useState({ from: '', to: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    if (!revisions.length) return;
    const selectedRevisionId = articleContext?.selectedRevisionId || articleContext?.revisionId || '';
    const selectedRevision = revisions.find((item) => String(item._id) === String(selectedRevisionId)) || revisions[0];
    const nextFrom = selectedRevision?.baseRevisionId || currentRevisionId || revisions[0]?._id || '';
    const nextTo = selectedRevision?._id || currentRevisionId || revisions[0]?._id || '';
    setCompareIds({ from: nextFrom, to: nextTo });
  }, [revisions, articleContext, currentRevisionId]);

  const { compare: compareData, loading: compareLoading, error: compareError } = useSenseArticleCompare({
    nodeId,
    senseId,
    fromRevisionId: compareIds.from,
    toRevisionId: compareIds.to,
    enabled: revisions.length > 0
  });

  const compareLabels = useMemo(() => {
    const fromRevision = revisions.find((item) => String(item._id) === String(compareIds.from));
    const toRevision = revisions.find((item) => String(item._id) === String(compareIds.to));
    return {
      from: fromRevision ? getRevisionDisplayTitle(fromRevision) : '未命名修订',
      to: toRevision ? getRevisionDisplayTitle(toRevision) : '未命名修订'
    };
  }, [revisions, compareIds]);

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
        metaItems={[
          `历史版本数：${revisions.length}`,
          `当前对比：${compareLabels.from} → ${compareLabels.to}`
        ]}
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
        <>
          <div className="sense-review-pane">
            <SenseArticleComparePanel
              compare={compareData}
              loading={compareLoading}
              error={compareError}
              emptyMessage="请选择两个已发布版本进行结构化对比。"
              title={`版本对比 ${compareLabels.from} → ${compareLabels.to}`}
            />
          </div>

          <div className="sense-history-list">
            {revisions.map((revision) => {
              const isCurrent = String(revision._id) === String(currentRevisionId);
              const isFrom = String(revision._id) === String(compareIds.from);
              const isTo = String(revision._id) === String(compareIds.to);
              return (
                <div key={revision._id} className={`sense-history-card ${isCurrent ? 'current' : ''}`}>
                  <div className="sense-history-main">
                    <div className="sense-history-title">
                      <strong>{getRevisionDisplayTitle(revision)}</strong>
                      {isCurrent ? <SenseArticleStatusBadge tone="success">当前发布版</SenseArticleStatusBadge> : null}
                      {revision.supersededByRevisionId ? <SenseArticleStatusBadge tone="muted">已被覆盖</SenseArticleStatusBadge> : null}
                      <SenseArticleStatusBadge status={revision.status} />
                      {isFrom ? <span className="sense-pill">对比左侧</span> : null}
                      {isTo ? <span className="sense-pill">对比右侧</span> : null}
                    </div>
                    <div className="sense-history-meta">发起人：{revision.proposerUsername || revision.proposerId || '--'} · {revision.publishedAt ? new Date(revision.publishedAt).toLocaleString('zh-CN', { hour12: false }) : '--'}</div>
                    <div className="sense-history-note">{revision.proposerNote || '无提交说明'}</div>
                  </div>
                  <div className="sense-history-actions">
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => setCompareIds((prev) => ({ ...prev, from: revision._id }))}>
                      设为左侧
                    </button>
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => setCompareIds((prev) => ({ ...prev, to: revision._id }))}>
                      设为右侧
                    </button>
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => setCompareIds({ from: currentRevisionId || revision.baseRevisionId || revision._id, to: revision._id })}>
                      <GitCompare size={16} /> 与当前发布版对比
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default SenseArticleHistoryPage;
