import React, { useEffect, useRef } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { getNodeDisplayName } from './hexUtils';
import './KnowledgeTopPanel.css';

const escapeRegExp = (text = '') => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const renderKeywordHighlight = (text, rawQuery) => {
  const content = typeof text === 'string' ? text : '';
  const keywords = String(rawQuery || '')
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!content || keywords.length === 0) return content;
  const uniqueKeywords = Array.from(new Set(keywords.map((item) => item.toLowerCase())));
  const pattern = uniqueKeywords.map((item) => escapeRegExp(item)).join('|');
  if (!pattern) return content;
  const matcher = new RegExp(`(${pattern})`, 'ig');
  const parts = content.split(matcher);
  return parts.map((part, index) => {
    const lowered = part.toLowerCase();
    const matched = uniqueKeywords.some((keyword) => keyword === lowered);
    if (!matched) return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
    return <mark key={`mark-${index}`} className="subtle-keyword-highlight">{part}</mark>;
  });
};

const KnowledgeTopPanel = ({
  className = '',
  eyebrow = 'Knowledge Domain Atlas',
  title = '知识域总览',
  stats = [],
  searchQuery = '',
  onSearchChange,
  onSearchFocus,
  onSearchClear,
  onSearchResultsClose,
  searchResults = [],
  showSearchResults = false,
  isSearching = false,
  onSearchResultClick,
  onCreateNode,
  showCreateButton = true,
  createButtonLabel = '创建新知识域',
  searchPlaceholder = '搜索标题或释义题目...（支持多关键词）'
}) => {
  const rootClassName = ['knowledge-top-panel', className].filter(Boolean).join(' ');
  const visibleStats = Array.isArray(stats) ? stats.filter((item) => item && item.label) : [];
  const visibleResults = Array.isArray(searchResults) ? searchResults : [];
  const shouldShowCreateButton = showCreateButton && typeof onCreateNode === 'function';
  const searchBarRef = useRef(null);

  useEffect(() => {
    if (!showSearchResults) return undefined;

    const handlePointerDownOutside = (event) => {
      if (searchBarRef.current?.contains(event.target)) {
        return;
      }
      if (typeof onSearchResultsClose === 'function') {
        onSearchResultsClose();
      }
    };

    document.addEventListener('pointerdown', handlePointerDownOutside);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside);
    };
  }, [onSearchResultsClose, showSearchResults]);

  return (
    <div className={rootClassName}>
      <div className="knowledge-top-panel__inner">
        <div className="knowledge-top-panel__heading-row">
          <div className="knowledge-top-panel__title-group">
            {eyebrow ? <span className="knowledge-top-panel__eyebrow">{eyebrow}</span> : null}
            <h1 className="knowledge-top-panel__title">{title}</h1>
          </div>
          {visibleStats.length > 0 ? (
            <div className="knowledge-top-panel__stats">
              {visibleStats.map((item) => (
                <div key={item.label} className="knowledge-top-panel__stat">
                  <span className="knowledge-top-panel__stat-label">{item.label}</span>
                  <strong className="knowledge-top-panel__stat-value">{item.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="knowledge-top-panel__search-band">
          <div className="knowledge-top-panel__search-shell" ref={searchBarRef}>
            <div className="knowledge-top-panel__search-bar">
              <div className="knowledge-top-panel__search-row">
                <div className="knowledge-top-panel__search-input" onClick={onSearchFocus}>
                  <Search className="knowledge-top-panel__search-icon" size={22} />
                  <input
                    type="text"
                    placeholder={searchPlaceholder}
                    value={searchQuery}
                    onChange={onSearchChange}
                    className="knowledge-top-panel__search-field"
                    onFocus={onSearchFocus}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (typeof onSearchClear === 'function') {
                          onSearchClear();
                        }
                      }}
                      className="knowledge-top-panel__search-clear"
                    >
                      <X size={18} />
                    </button>
                  ) : null}
                </div>
                {shouldShowCreateButton ? (
                  <button
                    type="button"
                    onClick={onCreateNode}
                    className="btn btn-success create-node-btn knowledge-top-panel__create-btn"
                  >
                    <Plus size={18} />
                    {createButtonLabel}
                  </button>
                ) : null}
              </div>
            </div>

            {searchQuery && visibleResults.length > 0 && showSearchResults ? (
              <div className="knowledge-top-panel__results">
                <div className="knowledge-top-panel__results-scroll">
                  {visibleResults.map((node) => (
                    <div
                      key={node.searchKey || `${node._id || ''}-${node.senseId || ''}`}
                      className="knowledge-top-panel__result-card"
                      onClick={() => {
                        if (typeof onSearchResultClick === 'function') {
                          onSearchResultClick(node);
                        }
                      }}
                    >
                      <div className="knowledge-top-panel__result-title">
                        {renderKeywordHighlight(getNodeDisplayName(node), searchQuery)}
                      </div>
                      <div className="knowledge-top-panel__result-desc">{node.description || ''}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {searchQuery && !isSearching && visibleResults.length === 0 && showSearchResults ? (
              <div className="knowledge-top-panel__status">未找到匹配的节点</div>
            ) : null}

            {isSearching && showSearchResults ? (
              <div className="knowledge-top-panel__status">搜索中...</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeTopPanel;
