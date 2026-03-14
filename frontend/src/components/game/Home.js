import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, X, Bell } from 'lucide-react';
import HexDomainGrid from './HexDomainGrid';
import RightUtilityDock from './RightUtilityDock';
import AnnouncementPanel from './AnnouncementPanel';
import {
  buildHomeSafeAreaInsets,
  getNodeDisplayName
} from './hexUtils';
import './Home.css';

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

const readViewport = () => ({
  width: typeof window === 'undefined' ? 1440 : window.innerWidth,
  height: typeof window === 'undefined' ? 900 : window.innerHeight
});

const Home = ({
  webglCanvasRef,
  searchQuery,
  onSearchChange,
  onSearchFocus,
  onSearchClear,
  searchResults,
  showSearchResults,
  isSearching,
  onSearchResultClick,
  onCreateNode,
  isAdmin,
  currentLocationNodeDetail,
  travelStatus,
  onStopTravel,
  isStoppingTravel,
  canJumpToLocationView,
  onJumpToLocationView,
  announcementGroups = {},
  announcementUnreadCount = 0,
  isMarkingAnnouncementsRead = false,
  onAnnouncementClick,
  onMarkAllAnnouncementsRead,
  onAnnouncementPanelViewed,
  showRightDocks = true,
  rootNodes = [],
  featuredNodes = [],
  onHomeDomainActivate,
  activeHomeNodeId = ''
}) => {
  const searchBarRef = useRef(null);
  const hasMarkedAnnouncementViewRef = useRef(false);
  const [viewport, setViewport] = useState(readViewport);
  const [isAnnouncementPanelExpanded, setIsAnnouncementPanelExpanded] = useState(false);
  const [activeAnnouncementTab, setActiveAnnouncementTab] = useState('system');

  const systemAnnouncements = Array.isArray(announcementGroups?.system) ? announcementGroups.system : [];
  const allianceAnnouncements = Array.isArray(announcementGroups?.alliance) ? announcementGroups.alliance : [];
  const unreadAnnouncementTotal = Number.isFinite(announcementUnreadCount)
    ? Math.max(0, announcementUnreadCount)
    : 0;
  const activeAnnouncements = activeAnnouncementTab === 'alliance'
    ? allianceAnnouncements
    : systemAnnouncements;

  useEffect(() => {
    const handleResize = () => setViewport(readViewport());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (activeAnnouncementTab === 'system' && systemAnnouncements.length === 0 && allianceAnnouncements.length > 0) {
      setActiveAnnouncementTab('alliance');
    } else if (activeAnnouncementTab === 'alliance' && allianceAnnouncements.length === 0 && systemAnnouncements.length > 0) {
      setActiveAnnouncementTab('system');
    }
  }, [activeAnnouncementTab, systemAnnouncements.length, allianceAnnouncements.length]);

  useEffect(() => {
    if (!isAnnouncementPanelExpanded) {
      hasMarkedAnnouncementViewRef.current = false;
      return;
    }
    if (hasMarkedAnnouncementViewRef.current) return;
    if (typeof onAnnouncementPanelViewed === 'function') {
      hasMarkedAnnouncementViewRef.current = true;
      onAnnouncementPanelViewed();
    }
  }, [isAnnouncementPanelExpanded, onAnnouncementPanelViewed]);

  const safeInsets = useMemo(
    () => buildHomeSafeAreaInsets(viewport.width, viewport.height),
    [viewport.height, viewport.width]
  );

  const shellStyle = useMemo(() => ({
    '--home-safe-left': `${safeInsets.left}px`,
    '--home-safe-right': `${safeInsets.right}px`,
    '--home-safe-top': `${safeInsets.top}px`,
    '--home-safe-bottom': `${safeInsets.bottom}px`
  }), [safeInsets.bottom, safeInsets.left, safeInsets.right, safeInsets.top]);

  const summaryStats = [
    { label: '根知识域', value: rootNodes.length },
    { label: '热门知识域', value: featuredNodes.length },
    { label: '搜索结果', value: searchQuery ? searchResults.length : '待检索' }
  ];
  const utilitySections = useMemo(() => {
    if (!showRightDocks) return [];
    return [
      {
        id: 'announcement',
        label: '公告',
        icon: Bell,
        badge: unreadAnnouncementTotal > 0 ? 'dot' : null,
        active: isAnnouncementPanelExpanded,
        onToggle: () => setIsAnnouncementPanelExpanded((prev) => !prev),
        panel: (
          <AnnouncementPanel
            activeTab={activeAnnouncementTab}
            tabs={[
              { id: 'system', label: '系统公告' },
              { id: 'alliance', label: '频道公告' }
            ]}
            announcements={activeAnnouncements}
            onTabChange={setActiveAnnouncementTab}
            onReadAll={() => {
              if (typeof onMarkAllAnnouncementsRead === 'function') {
                onMarkAllAnnouncementsRead();
              }
            }}
            onClose={() => setIsAnnouncementPanelExpanded(false)}
            onItemClick={(item) => {
              if (typeof onAnnouncementClick === 'function') {
                onAnnouncementClick(item);
              }
            }}
            readAllDisabled={isMarkingAnnouncementsRead || unreadAnnouncementTotal <= 0}
            isReadAllLoading={isMarkingAnnouncementsRead}
          />
        )
      }
    ];
  }, [
    activeAnnouncementTab,
    activeAnnouncements,
    isAnnouncementPanelExpanded,
    isMarkingAnnouncementsRead,
    onAnnouncementClick,
    onMarkAllAnnouncementsRead,
    showRightDocks,
    unreadAnnouncementTotal
  ]);

  return (
    <div className="home-shell" style={shellStyle}>
      <div className="home-background-layer" aria-hidden="true">
        <div className="home-background-gradient" />
        <div className="home-background-grid" />
        <div className="home-background-stars" />
        <div className="webgl-scene-container home-scene-shell">
          <canvas ref={webglCanvasRef} className="webgl-canvas home-atmosphere-canvas" />
        </div>
      </div>

      <div className="navigation-sidebar">
        <div className="nav-item active">
          <span className="nav-label">首页</span>
        </div>
      </div>

      <div className="home-main-layer">
        <div className="search-container home-search-container" ref={searchBarRef}>
          <div className="floating-search-bar home-floating-search-bar">
            <div className="search-and-create-container">
              <div className="search-input-wrapper" onClick={onSearchFocus}>
                <Search className="search-icon" size={22} />
                <input
                  type="text"
                  placeholder="搜索标题或释义题目...（支持多关键词）"
                  value={searchQuery}
                  onChange={onSearchChange}
                  className="search-input-floating"
                  onFocus={onSearchFocus}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSearchClear();
                    }}
                    className="search-clear-btn"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              {!isAdmin && (
                <button
                  type="button"
                  onClick={onCreateNode}
                  className="btn btn-success create-node-btn home-create-node-btn"
                >
                  <Plus size={18} />
                  创建新知识域
                </button>
              )}
            </div>
          </div>

          {searchQuery && searchResults.length > 0 && showSearchResults && (
            <div className="search-results-panel">
              <div className="search-results-scroll">
                {searchResults.map((node) => (
                  <div
                    key={node.searchKey || `${node._id || ''}-${node.senseId || ''}`}
                    className="search-result-card"
                    onClick={() => onSearchResultClick(node)}
                  >
                    <div className="search-card-title">{renderKeywordHighlight(getNodeDisplayName(node), searchQuery)}</div>
                    <div className="search-card-desc">{node.description || ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {searchQuery && !isSearching && searchResults.length === 0 && showSearchResults && (
            <div className="search-no-results">
              未找到匹配的节点
            </div>
          )}

          {isSearching && showSearchResults && (
            <div className="search-loading-indicator">
              搜索中...
            </div>
          )}
        </div>

        <div className="home-hero-safe-area">
          <div className="home-hero-panel">
            <div className="home-hero-copy">
              <span className="home-hero-eyebrow">Knowledge Domain Atlas</span>
              <h1 className="home-hero-title">知识域总览首页</h1>
              <p className="home-hero-description">
                以蜂窝式六边形入口统摄根知识域与热门知识域。首页只承载总览、检索与入口，不抢占右侧状态区与顶部操作区的层级。
              </p>
              <div className="home-hero-stats">
                {summaryStats.map((item) => (
                  <div key={item.label} className="home-hero-stat">
                    <span className="home-hero-stat-label">{item.label}</span>
                    <strong className="home-hero-stat-value">{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="home-hex-safe-zone">
              <div className="home-hex-safe-zone__halo" aria-hidden="true" />
              <HexDomainGrid
                rootNodes={rootNodes}
                featuredNodes={featuredNodes}
                activeNodeId={activeHomeNodeId}
                onActivate={onHomeDomainActivate}
              />
            </div>
          </div>
        </div>
      </div>

      <RightUtilityDock sections={utilitySections} />
    </div>
  );
};

export default Home;
