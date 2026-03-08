import React from 'react';
import { AlertTriangle, Inbox, Loader2, Lock } from 'lucide-react';
import './SenseArticle.css';

const iconMap = {
  loading: Loader2,
  empty: Inbox,
  error: AlertTriangle,
  forbidden: Lock
};

const titleMap = {
  loading: '正在加载',
  empty: '暂无内容',
  error: '加载失败',
  forbidden: '暂无访问权限'
};

const SenseArticleStateView = ({
  kind = 'empty',
  title = '',
  description = '',
  action = null,
  compact = false
}) => {
  const Icon = iconMap[kind] || Inbox;
  return (
    <div className={`sense-state-view ${kind} ${compact ? 'compact' : ''}`.trim()}>
      <div className="sense-state-view-icon"><Icon size={compact ? 18 : 22} className={kind === 'loading' ? 'spin' : ''} /></div>
      <div className="sense-state-view-title">{title || titleMap[kind] || titleMap.empty}</div>
      {description ? <div className="sense-state-view-desc">{description}</div> : null}
      {action ? <div className="sense-state-view-action">{action}</div> : null}
    </div>
  );
};

export default SenseArticleStateView;
