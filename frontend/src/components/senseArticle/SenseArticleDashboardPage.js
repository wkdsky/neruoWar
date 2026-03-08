import React, { useEffect, useState } from 'react';
import { BarChart3, BookMarked, Clock3, Eye, GitBranchPlus, AlertTriangle } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import SenseArticlePageHeader from './SenseArticlePageHeader';
import SenseArticleStateView from './SenseArticleStateView';
import { buildSenseArticleBreadcrumb, getRevisionStatusLabel } from './senseArticleUi';
import './SenseArticle.css';

const DashboardList = ({ title, icon: Icon, items = [], emptyText = '暂无数据', renderItem }) => (
  <section className="sense-side-card sense-dashboard-card">
    <div className="sense-side-card-title"><Icon size={16} /> {title}</div>
    <div className="sense-dashboard-list">
      {items.length === 0 ? <SenseArticleStateView kind="empty" compact title={emptyText} description="当前没有可处理项。" /> : items.map(renderItem)}
    </div>
  </section>
);

const SenseArticleDashboardPage = ({ nodeId, articleContext, onContextPatch, onBack, onOpenReview, onOpenHistory, onOpenArticle }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await senseArticleApi.getDashboard(nodeId);
        setData(response || {});
      } catch (requestError) {
        setError(requestError);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [nodeId]);

  useEffect(() => {
    onContextPatch && onContextPatch({
      breadcrumb: buildSenseArticleBreadcrumb({
        nodeName: articleContext?.nodeName || '',
        senseTitle: articleContext?.senseTitle || '',
        pageType: 'senseArticleDashboard'
      })
    });
  }, [articleContext, onContextPatch]);

  if (loading) return <div className="sense-article-page"><SenseArticleStateView kind="loading" title="正在加载治理面板" description="正在汇总待审修订、发布记录与引用治理信息。" /></div>;
  if (error) return <div className="sense-article-page"><SenseArticleStateView kind={Number(error?.status) === 403 ? 'forbidden' : 'error'} title={Number(error?.status) === 403 ? '暂无治理权限' : '治理面板加载失败'} description={error.message || '请稍后重试'} action={<button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>} /></div>;

  return (
    <div className="sense-article-page dashboard-mode">
      <SenseArticlePageHeader
        pageType="senseArticleDashboard"
        articleContext={articleContext}
        title={`${articleContext?.nodeName || '当前知识域'} / 内容治理`}
        metaItems={[
          `范围节点数：${data?.scope?.totalNodes || 0}`,
          data?.scope?.nodeId ? '当前知识域范围' : '全局可管理范围'
        ]}
        onBack={onBack}
        actions={<span className="sense-history-header-icon"><BarChart3 size={18} /></span>}
      />

      <div className="sense-dashboard-grid">
        <DashboardList
          title="待我审核"
          icon={Clock3}
          items={data?.pendingMyReview || []}
          emptyText="暂无待审核修订"
          renderItem={(item) => (
            <button key={item._id} type="button" className="sense-dashboard-item" onClick={() => onOpenReview && onOpenReview(item)}>
              <strong>修订 #{item.revisionNumber}</strong>
              <span>{getRevisionStatusLabel(item.status)}</span>
            </button>
          )}
        />
        <DashboardList
          title="我发起且被要求修改"
          icon={GitBranchPlus}
          items={data?.requestedChangesMine || []}
          emptyText="暂无要求修改项"
          renderItem={(item) => (
            <button key={item._id} type="button" className="sense-dashboard-item" onClick={() => onOpenHistory && onOpenHistory(item)}>
              <strong>修订 #{item.revisionNumber}</strong>
              <span>{getRevisionStatusLabel(item.status)}</span>
            </button>
          )}
        />
        <DashboardList
          title="长时间未处理"
          icon={AlertTriangle}
          items={data?.stalePending || []}
          emptyText="暂无超时待处理修订"
          renderItem={(item) => (
            <button key={item._id} type="button" className="sense-dashboard-item" onClick={() => onOpenReview && onOpenReview(item)}>
              <strong>修订 #{item.revisionNumber}</strong>
              <span>{getRevisionStatusLabel(item.status)}</span>
            </button>
          )}
        />
        <DashboardList
          title="最近发布"
          icon={BookMarked}
          items={data?.recentlyPublished || []}
          emptyText="暂无最近发布记录"
          renderItem={(item) => (
            <button key={item._id} type="button" className="sense-dashboard-item" onClick={() => onOpenHistory && onOpenHistory(item)}>
              <strong>修订 #{item.revisionNumber}</strong>
              <span>{item.publishedAt ? new Date(item.publishedAt).toLocaleString('zh-CN', { hour12: false }) : '--'}</span>
            </button>
          )}
        />
        <DashboardList
          title="高频被引用词条"
          icon={Eye}
          items={data?.highFrequencyReferenced || []}
          emptyText="暂无引用统计"
          renderItem={(item) => (
            <button key={`${item.nodeId}:${item.senseId}`} type="button" className="sense-dashboard-item" onClick={() => onOpenArticle && onOpenArticle(item)}>
              <strong>{item.nodeName || '知识域'} / {item.senseTitle || item.senseId}</strong>
              <span>被引用 {item.referenceCount} 次</span>
            </button>
          )}
        />
        <DashboardList
          title="Legacy 未迁移残留"
          icon={AlertTriangle}
          items={data?.legacyUnmigrated || []}
          emptyText="未发现 legacy 未迁移 sense"
          renderItem={(item) => (
            <div key={`${item.nodeId}:${item.senseId}`} className="sense-dashboard-item static">
              <strong>{item.nodeName || '知识域'} / {item.senseTitle || item.senseId}</strong>
              <span>{item.legacySummary || '无摘要'}</span>
            </div>
          )}
        />
      </div>

      <div className="sense-side-card sense-dashboard-card">
        <div className="sense-side-card-title">标注健康度</div>
        <div className="sense-compare-summary-grid">
          <span className="sense-pill">精确 {data?.annotationHealth?.exact || 0}</span>
          <span className="sense-pill">重定位 {data?.annotationHealth?.relocated || 0}</span>
          <span className="sense-pill">待确认 {data?.annotationHealth?.uncertain || 0}</span>
          <span className="sense-pill">失效 {data?.annotationHealth?.broken || 0}</span>
        </div>
      </div>
    </div>
  );
};

export default SenseArticleDashboardPage;
