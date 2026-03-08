import React from 'react';
import { ArrowLeft } from 'lucide-react';
import SenseArticleStatusBadge from './SenseArticleStatusBadge';
import { getSenseArticleBackLabel, SENSE_ARTICLE_PAGE_LABELS } from './senseArticleUi';
import './SenseArticle.css';

const SenseArticlePageHeader = ({
  pageType = 'senseArticle',
  articleContext = null,
  title = '',
  subtitle = '',
  revisionStatus = '',
  metaItems = [],
  badges = [],
  onBack,
  actions = null
}) => {
  const breadcrumb = Array.isArray(articleContext?.breadcrumb) ? articleContext.breadcrumb : [];
  const backLabel = getSenseArticleBackLabel(articleContext);

  return (
    <div className="sense-article-topbar">
      <button type="button" className="btn btn-secondary" onClick={() => onBack && onBack()}>
        <ArrowLeft size={16} /> {backLabel}
      </button>
      <div className="sense-article-title-group">
        <div className="sense-article-kicker">{subtitle || `释义百科页 · ${SENSE_ARTICLE_PAGE_LABELS[pageType] || '阅读页'}`}</div>
        <h1>{title}</h1>
        {!!breadcrumb.length && <div className="sense-article-breadcrumb">{breadcrumb.join(' / ')}</div>}
        <div className="sense-article-meta-row">
          {revisionStatus ? <SenseArticleStatusBadge status={revisionStatus} /> : null}
          {badges.filter(Boolean).map((badge, index) => React.isValidElement(badge)
            ? React.cloneElement(badge, { key: badge.key || `${pageType}-badge-${index}` })
            : <span key={`${pageType}-badge-${index}`} className="sense-pill">{badge}</span>)}
          {metaItems.filter(Boolean).map((item) => <span key={item}>{item}</span>)}
        </div>
      </div>
      <div className="sense-article-actions">{actions}</div>
    </div>
  );
};

export default SenseArticlePageHeader;
