import { useEffect, useMemo, useRef, useState } from 'react';
import { senseArticleApi } from '../../../utils/senseArticleApi';

const useSenseArticleReadingSearch = ({ nodeId, senseId, pageData }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchData, setSearchData] = useState({ total: 0, matches: [], groups: [] });
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [isReadingSearchOpen, setIsReadingSearchOpen] = useState(false);
  const [isReadingSearchResultsExpanded, setIsReadingSearchResultsExpanded] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState('');

  const readingSearchRef = useRef(null);
  const readingSearchInputRef = useRef(null);

  const hasSearchQuery = !!searchQuery.trim();
  const hasSearchResults = hasSearchQuery && searchData.total > 0;

  useEffect(() => {
    if (!isReadingSearchOpen) return undefined;
    const handlePointerDown = (event) => {
      if (readingSearchRef.current?.contains(event.target)) return;
      setIsReadingSearchOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsReadingSearchOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isReadingSearchOpen]);

  useEffect(() => {
    if (!isReadingSearchOpen) return;
    window.requestAnimationFrame(() => {
      readingSearchInputRef.current?.focus();
    });
  }, [isReadingSearchOpen]);

  useEffect(() => {
    if (isReadingSearchOpen) return;
    setIsReadingSearchResultsExpanded(false);
  }, [isReadingSearchOpen]);

  useEffect(() => {
    if (hasSearchResults) return;
    setIsReadingSearchResultsExpanded(false);
  }, [hasSearchResults]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchData({ total: 0, matches: [], groups: [] });
      setActiveSearchIndex(-1);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await senseArticleApi.searchWithinArticle(nodeId, senseId, searchQuery.trim());
        setSearchData({ total: data.total || 0, matches: data.matches || [], groups: data.groups || [] });
        setActiveSearchIndex((data.matches || []).length > 0 ? 0 : -1);
      } catch (requestError) {
        setSearchData({ total: 0, matches: [], groups: [] });
        setActiveSearchIndex(-1);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [nodeId, senseId, searchQuery]);

  useEffect(() => {
    const handleScroll = () => {
      const headings = Array.from(document.querySelectorAll('[data-article-heading-block="true"]'));
      let current = '';
      headings.forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.top <= 120) current = element.id || element.getAttribute('data-article-heading') || current;
      });
      if (current) setActiveHeadingId(current);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [pageData]);

  useEffect(() => {
    if (activeSearchIndex < 0) return;
    const match = searchData.matches[activeSearchIndex];
    if (!match) return;
    const element = document.querySelector(`[data-article-block="${match.blockId}"]`) || document.getElementById(match.headingId || '');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (match.headingId) setActiveHeadingId(match.headingId);
    }
  }, [activeSearchIndex, searchData]);

  const activeSearchMatch = useMemo(() => (
    activeSearchIndex >= 0 ? searchData.matches[activeSearchIndex] : null
  ), [activeSearchIndex, searchData.matches]);

  const jumpToHeading = (headingId) => {
    if (!headingId) return;
    const element = document.getElementById(headingId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveHeadingId(headingId);
    }
  };

  const jumpToMatch = (match, index = 0) => {
    if (!match) return;
    setActiveSearchIndex(index);
    if (match.headingId) setActiveHeadingId(match.headingId);
  };

  return {
    searchQuery,
    setSearchQuery,
    searchData,
    activeSearchIndex,
    activeSearchMatch,
    isReadingSearchOpen,
    setIsReadingSearchOpen,
    isReadingSearchResultsExpanded,
    setIsReadingSearchResultsExpanded,
    activeHeadingId,
    hasSearchQuery,
    hasSearchResults,
    readingSearchRef,
    readingSearchInputRef,
    jumpToHeading,
    jumpToMatch
  };
};

export default useSenseArticleReadingSearch;
