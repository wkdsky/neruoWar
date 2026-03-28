import React, { useEffect, useMemo, useState } from 'react';
import HexDomainGrid from './HexDomainGrid';
import KnowledgeTopPanel from './KnowledgeTopPanel';
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
  onSearchResultsClose,
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
  rootNodes = [],
  featuredNodes = [],
  onHomeDomainActivate,
  activeHomeNodeId = ''
}) => {
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    const handleResize = () => setViewport(readViewport());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
              searchQuery={searchQuery}
              onSearchChange={onSearchChange}
              onSearchFocus={onSearchFocus}
              onSearchClear={onSearchClear}
              onSearchResultsClose={onSearchResultsClose}
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
    </div>
  );
};

export default Home;
