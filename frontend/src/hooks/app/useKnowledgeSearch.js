import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../../runtimeConfig';

const useKnowledgeSearch = ({ view }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  const performKnowledgeSearch = useCallback(async (query) => {
    if (!query || query.trim() === '') {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`${API_BASE}/nodes/public/search?query=${encodeURIComponent(query)}`);
      if (!response.ok) {
        setSearchResults([]);
        return;
      }
      const data = await response.json();
      setSearchResults(Array.isArray(data?.results) ? data.results : []);
    } catch (error) {
      console.error('搜索失败:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleKnowledgeSearchChange = useCallback((event) => {
    setSearchQuery(event.target.value);
  }, []);

  const handleKnowledgeSearchFocus = useCallback(() => {
    setShowSearchResults(true);
  }, []);

  const handleKnowledgeSearchClear = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(true);
  }, []);

  const closeKnowledgeSearchResults = useCallback(() => {
    setShowSearchResults(false);
  }, []);

  const resetKnowledgeSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setShowSearchResults(false);
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (view === 'home' || view === 'nodeDetail' || view === 'titleDetail') {
        performKnowledgeSearch(searchQuery);
        if (searchQuery.trim() !== '') {
          setShowSearchResults(true);
        }
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [performKnowledgeSearch, searchQuery, view]);

  return {
    searchQuery,
    searchResults,
    isSearching,
    showSearchResults,
    handleKnowledgeSearchChange,
    handleKnowledgeSearchFocus,
    handleKnowledgeSearchClear,
    closeKnowledgeSearchResults,
    resetKnowledgeSearch
  };
};

export default useKnowledgeSearch;
