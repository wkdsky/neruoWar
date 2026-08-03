import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

const SearchModal = ({
  open = false,
  nodes = [],
  initialQuery = '',
  onJump,
  onClose
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialQuery]);

  const results = React.useMemo(() => {
    if (!query.trim()) {
      return nodes.slice(0, 8).map((node) => ({
        ...node,
        searchScore: 1,
        matchedField: 'recent'
      }));
    }

    const lowerQuery = query.toLowerCase().trim();
    return nodes
      .map((node) => {
        const titleLower = (node.title || '').toLowerCase();
        const contentLower = (node.contentText || '').toLowerCase();
        const previewLower = (node.previewText || '').toLowerCase();

        const titleMatch = titleLower.includes(lowerQuery);
        const contentMatch = contentLower.includes(lowerQuery);
        const previewMatch = previewLower.includes(lowerQuery);

        if (!titleMatch && !contentMatch && !previewMatch) return null;

        let score = 0;
        let matchedField = '';

        if (titleMatch) {
          score += 10;
          matchedField = 'title';
          if (titleLower.startsWith(lowerQuery)) score += 5;
        }
        if (previewMatch) {
          score += 3;
          if (!matchedField) matchedField = 'preview';
        }
        if (contentMatch) {
          score += 1;
          if (!matchedField) matchedField = 'content';
        }

        return { ...node, searchScore: score, matchedField };
      })
      .filter(Boolean)
      .sort((a, b) => b.searchScore - a.searchScore)
      .slice(0, 12);
  }, [query, nodes]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  const handleJump = useCallback((nodeId) => {
    if (!nodeId) return;
    onJump?.(nodeId);
    onClose?.();
  }, [onJump, onClose]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (results[activeIndex]?._id) {
        handleJump(results[activeIndex]._id);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  }, [activeIndex, results, handleJump, onClose]);

  useEffect(() => {
    if (open && listRef.current) {
      const activeItem = listRef.current.querySelector('.is-active');
      activeItem?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, open]);

  const highlightMatch = (text, query) => {
    if (!query.trim() || !text) return text;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase().trim();
    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) return text;

    const before = text.slice(0, index);
    const match = text.slice(index, index + query.length);
    const after = text.slice(index + query.length);

    return (
      <>
        {before}
        <mark className="jinzhi-search-highlight">{match}</mark>
        {after}
      </>
    );
  };

  if (!open) return null;

  return (
    <div
      className="jinzhi-search-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className="jinzhi-search-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="搜索节点"
      >
        <div className="jinzhi-search-modal__header">
          <div className="jinzhi-search-input-wrapper">
            <Search size={16} className="jinzhi-search-input-icon" />
            <input
              ref={inputRef}
              type="text"
              className="jinzhi-search-input"
              placeholder="搜索节点标题或内容..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="搜索节点"
            />
            {query && (
              <button
                type="button"
                className="jinzhi-search-input-clear"
                onClick={() => setQuery('')}
                aria-label="清除搜索"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="jinzhi-search-modal__close"
            onClick={onClose}
            aria-label="关闭搜索"
          >
            <X size={16} />
          </button>
        </div>

        <div className="jinzhi-search-modal__body" ref={listRef}>
          {results.length === 0 ? (
            <div className="jinzhi-search-modal__empty">
              {query.trim()
                ? `没有找到匹配"${query}"的节点`
                : '暂无最近节点'}
            </div>
          ) : (
            <div className="jinzhi-search-results">
              {!query.trim() && (
                <div className="jinzhi-search-results__hint">最近节点</div>
              )}
              {results.map((node, index) => (
                <button
                  key={node._id}
                  type="button"
                  className={`jinzhi-search-result-item${index === activeIndex ? ' is-active' : ''}${node.isRoot ? ' is-root' : ''}`}
                  onClick={() => handleJump(node._id)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <div className="jinzhi-search-result-item__title">
                    {node.isRoot && <span className="jinzhi-search-result-item__root-badge">根</span>}
                    {highlightMatch(node.title || '未命名节点', query)}
                  </div>
                  {node.previewText && (
                    <div className="jinzhi-search-result-item__preview">
                      {highlightMatch(
                        node.previewText.length > 60
                          ? node.previewText.slice(0, 60) + '...'
                          : node.previewText,
                        query
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="jinzhi-search-modal__footer">
          <span>按 <kbd>↑</kbd><kbd>↓</kbd> 选择，<kbd>Enter</kbd> 跳转</span>
          <span>按 <kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  );
};

export default SearchModal;
