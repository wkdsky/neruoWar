import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import HexDomainGrid from './HexDomainGrid';
import KnowledgeTopPanel from './KnowledgeTopPanel';
import RightUtilityDock from './RightUtilityDock';
import AnnouncementPanel from './AnnouncementPanel';
import {
  buildHomeSafeAreaInsets
} from './hexUtils';
import './Home.css';

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
    { label: '热门知识域', value: featuredNodes.length }
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
        <div className="home-content-stack">
          <div className="home-sticky-overview">
            <KnowledgeTopPanel
              className="home-knowledge-top-panel"
              title="知识域总览"
              stats={summaryStats}
              searchBarRef={searchBarRef}
              searchQuery={searchQuery}
              onSearchChange={onSearchChange}
              onSearchFocus={onSearchFocus}
              onSearchClear={onSearchClear}
              searchResults={searchResults}
              showSearchResults={showSearchResults}
              isSearching={isSearching}
              onSearchResultClick={onSearchResultClick}
              onCreateNode={onCreateNode}
              showCreateButton={!isAdmin}
            />
          </div>

          <div className="home-content-body">
            <div className="home-hero-panel">
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
      </div>

      <RightUtilityDock sections={utilitySections} />
    </div>
  );
};

export default Home;
