import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, BookMarked, Clock3, Eye, GitBranchPlus, AlertTriangle } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import SenseArticlePageHeader from './SenseArticlePageHeader';
import SenseArticleStateView from './SenseArticleStateView';
import {
  buildSenseArticleBreadcrumb,
  getRevisionActorLabel,
  getRevisionListLabel,
  getRevisionStatusLabel,
  groupRevisionItemsByProposer
} from './senseArticleUi';
import './SenseArticle.css';
import { buildSenseArticleAllianceContext, buildSenseArticleThemeStyle } from './senseArticleTheme';

const DashboardList = ({ title, icon: Icon, items = [], emptyText = '暂无数据', renderItem, children = null }) => (
  <section className="sense-side-card sense-dashboard-card">
    <div className="sense-side-card-title"><Icon size={16} /> {title}</div>
    <div className="sense-dashboard-list">
      {children || (items.length === 0 ? <SenseArticleStateView kind="empty" compact title={emptyText} description="当前没有可处理项。" /> : items.map(renderItem))}
    </div>
  </section>
);

const formatRevisionTime = (revision = {}) => {
  const timestamp = revision?.updatedAt || revision?.submittedAt || revision?.publishedAt || revision?.createdAt || '';
  return timestamp ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : '--';
};

const RevisionGroupList = ({ items = [], emptyText = '暂无数据', fallbackSenseTitle = '', onItemClick = null }) => {
  const groups = groupRevisionItemsByProposer(items);
  if (groups.length === 0) {
    return <SenseArticleStateView kind="empty" compact title={emptyText} description="当前没有可处理项。" />;
  }
  return groups.map((group) => (
    <section key={group.key} className="sense-dashboard-group">
      <div className="sense-dashboard-group-header">
        <strong>{group.actorLabel || getRevisionActorLabel(group.items[0])}</strong>
        <span>{group.items.length} 条修订</span>
      </div>
      <div className="sense-dashboard-group-list">
        {group.items.map((item) => (
          <button key={item._id} type="button" className="sense-dashboard-item sense-dashboard-item-subitem" onClick={() => onItemClick && onItemClick(item)}>
            <strong>{getRevisionListLabel(item, fallbackSenseTitle)}</strong>
            <span>{getRevisionStatusLabel(item.status)}</span>
            <small>{formatRevisionTime(item)}</small>
          </button>
        ))}
      </div>
    </section>
  ));
};

const SenseArticleDashboardPage = ({ nodeId, articleContext, onContextPatch, onBack, onOpenReview, onOpenHistory, onOpenArticle, onEditRevision }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pageThemeStyle = useMemo(() => buildSenseArticleThemeStyle(data?.node ? { ...articleContext, node: data.node } : articleContext), [data, articleContext]);

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
      nodeName: data?.node?.name || articleContext?.nodeName || '',
      ...buildSenseArticleAllianceContext(data?.node, articleContext),
      breadcrumb: buildSenseArticleBreadcrumb({
        nodeName: articleContext?.nodeName || '',
        senseTitle: articleContext?.senseTitle || '',
        pageType: 'senseArticleDashboard'
      })
    });
  }, [articleContext, data, onContextPatch]);

  if (loading) return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView kind="loading" title="正在加载词条管理" description="正在汇总待审修订、发布记录与引用治理信息。" /></div>;
  if (error) return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView kind={Number(error?.status) === 403 ? 'forbidden' : 'error'} title={Number(error?.status) === 403 ? '暂无词条管理权限' : '词条管理加载失败'} description={error.message || '请稍后重试'} action={<button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>} /></div>;

  return (
    <div className="sense-article-page dashboard-mode" style={pageThemeStyle}>
      <SenseArticlePageHeader
        pageType="senseArticleDashboard"
        articleContext={articleContext}
        title={`${data?.node?.name || articleContext?.nodeName || '当前知识域'} / 词条管理`}
        metaItems={[
          `范围节点数：${data?.scope?.totalNodes || 0}`,
          data?.scope?.nodeId ? '当前知识域范围' : '全局可管理范围'
        ]}
        onBack={onBack}
        actions={<span className="sense-history-header-icon"><BarChart3 size={18} /></span>}
      />

      <div className="sense-dashboard-grid">
        <DashboardList
          title="待我审阅"
          icon={Clock3}
          items={data?.pendingMyReview || []}
          emptyText="暂无待审修订"
        >
          <RevisionGroupList
            items={data?.pendingMyReview || []}
            emptyText="暂无待审修订"
            fallbackSenseTitle={articleContext?.senseTitle || ''}
            onItemClick={onOpenReview}
          />
        </DashboardList>
        <DashboardList
          title="我发起且被要求修改"
          icon={GitBranchPlus}
          items={data?.requestedChangesMine || []}
          emptyText="暂无要求修改项"
        >
          <RevisionGroupList
            items={data?.requestedChangesMine || []}
            emptyText="暂无要求修改项"
            fallbackSenseTitle={articleContext?.senseTitle || ''}
            onItemClick={onEditRevision}
          />
        </DashboardList>
        <DashboardList
          title="长时间未处理"
          icon={AlertTriangle}
          items={data?.stalePending || []}
          emptyText="暂无超时待处理修订"
        >
          <RevisionGroupList
            items={data?.stalePending || []}
            emptyText="暂无超时待处理修订"
            fallbackSenseTitle={articleContext?.senseTitle || ''}
            onItemClick={onOpenReview}
          />
        </DashboardList>
        <DashboardList
          title="最近发布"
          icon={BookMarked}
          items={data?.recentlyPublished || []}
          emptyText="暂无最近发布记录"
        >
          <RevisionGroupList
            items={data?.recentlyPublished || []}
            emptyText="暂无最近发布记录"
            fallbackSenseTitle={articleContext?.senseTitle || ''}
            onItemClick={onOpenHistory}
          />
        </DashboardList>
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
