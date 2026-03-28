import React from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';

const SenseArticleReadingSearchPanel = ({
  searchQuery,
  onSearchQueryChange,
  searchData,
  activeSearchIndex,
  activeSearchMatch,
  isOpen,
  onToggleOpen,
  isExpanded,
  onToggleExpanded,
  hasSearchQuery,
  hasSearchResults,
  searchRef,
  searchInputRef,
  onJumpToMatch
}) => (
  <div
    ref={searchRef}
    className={`sense-reading-search-shell ${isOpen ? 'open' : ''} ${isExpanded ? 'results-expanded' : ''}`}
  >
    <button
      type="button"
      className="sense-reading-search-trigger"
      onClick={onToggleOpen}
      aria-expanded={isOpen}
      aria-label="切换页内搜索"
    >
      <span className="sense-reading-search-trigger-main">
        <span className="sense-reading-search-label"><Search size={16} /> 页内搜索</span>
      </span>
      <span className="sense-reading-search-trigger-side">
        {hasSearchQuery ? <span className="sense-reading-search-hit-count">命中 {searchData.total}</span> : null}
        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </span>
    </button>
    <div className={`sense-reading-search-panel ${isOpen ? 'open' : ''}`} aria-hidden={!isOpen}>
      <div className="sense-search-box sense-reading-search-box">
        <Search size={16} />
        <input ref={searchInputRef} value={searchQuery} onChange={(event) => onSearchQueryChange(event.target.value)} placeholder="搜索正文 / 标题 / 公式" />
      </div>
      {hasSearchQuery ? (
        <div className="sense-search-meta-row">
          <span>命中 {searchData.total}</span>
          <span>{searchData.total > 0 ? `${activeSearchIndex + 1}/${searchData.total}` : '0/0'}</span>
        </div>
      ) : (
        <div className="sense-reading-search-hint">输入关键词后显示命中结果</div>
      )}
      <div className={`sense-search-results sense-reading-search-results ${isExpanded ? 'expanded' : ''}`}>
        {(searchData.groups || []).map((group) => (
          <div key={group.headingId || 'root'} className="sense-search-group">
            <div className="sense-search-group-title">{group.headingTitle || (group.headingId === 'root' ? '前言' : group.headingId)} · {group.count}</div>
            {(group.matches || []).map((item) => {
              const matchIndex = searchData.matches.findIndex((candidate) => candidate.blockId === item.blockId && candidate.position === item.position);
              return (
                <button
                  key={`${item.blockId}-${item.position}`}
                  type="button"
                  className={`sense-search-result-item ${activeSearchMatch && activeSearchMatch.blockId === item.blockId && activeSearchMatch.position === item.position ? 'active' : ''} ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => onJumpToMatch(item, matchIndex)}
                >
                  {item.snippet}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {hasSearchResults ? (
        <button
          type="button"
          className="sense-reading-search-size-toggle"
          onClick={onToggleExpanded}
          aria-label={isExpanded ? '收起搜索结果' : '展开搜索结果'}
          title={isExpanded ? '收起搜索结果' : '展开搜索结果'}
        >
          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      ) : null}
    </div>
  </div>
);

export default SenseArticleReadingSearchPanel;
