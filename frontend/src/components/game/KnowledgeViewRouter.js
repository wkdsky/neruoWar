import React from 'react';
import HomeView from './Home';
import NodeDetail from './NodeDetail';
import { TitleRelationInfoPanel } from '../layout/AppShellPanels';
import { SENSE_ARTICLE_ENTRY_LABEL } from '../senseArticle/senseArticleUi';

const KnowledgeViewRouter = ({
  view,
  webglCanvasRef,
  navigationPath,
  currentTitleDetail,
  currentNodeDetail,
  titleRelationInfo,
  onCloseTitleRelationInfo,
  searchQuery,
  onSearchChange,
  onSearchFocus,
  onSearchClear,
  searchResults,
  showSearchResults,
  isSearching,
  onHomeSearchResultClick,
  onDetailSearchResultClick,
  onCreateNode,
  isAdmin,
  currentLocationNodeDetail,
  travelStatus,
  onStopTravel,
  isStoppingTravel,
  canJumpToLocationView,
  onJumpToLocationView,
  announcementGroups,
  announcementUnreadCount,
  isMarkingAnnouncementsRead,
  onAnnouncementClick,
  onMarkAllAnnouncementsRead,
  onAnnouncementPanelViewed,
  onTitleNavigate,
  onNodeNavigate,
  onNavigateHistory,
  onHome,
  onOpenCurrentNodeInfo,
  openSenseArticleFromNode,
  rootNodes = [],
  featuredNodes = [],
  onHomeDomainActivate,
  activeHomeNodeId = ''
}) => {
  if (view === 'home') {
    return (
      <HomeView
        webglCanvasRef={webglCanvasRef}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        onSearchFocus={onSearchFocus}
        onSearchClear={onSearchClear}
        searchResults={searchResults}
        showSearchResults={showSearchResults}
        isSearching={isSearching}
        onSearchResultClick={onHomeSearchResultClick}
        onCreateNode={onCreateNode}
        isAdmin={isAdmin}
        currentLocationNodeDetail={currentLocationNodeDetail}
        travelStatus={travelStatus}
        onStopTravel={onStopTravel}
        isStoppingTravel={isStoppingTravel}
        canJumpToLocationView={canJumpToLocationView}
        onJumpToLocationView={onJumpToLocationView}
        announcementGroups={announcementGroups}
        announcementUnreadCount={announcementUnreadCount}
        isMarkingAnnouncementsRead={isMarkingAnnouncementsRead}
        onAnnouncementClick={onAnnouncementClick}
        onMarkAllAnnouncementsRead={onMarkAllAnnouncementsRead}
        onAnnouncementPanelViewed={onAnnouncementPanelViewed}
        showRightDocks={Boolean(isAdmin)}
        rootNodes={rootNodes}
        featuredNodes={featuredNodes}
        onHomeDomainActivate={onHomeDomainActivate}
        activeHomeNodeId={activeHomeNodeId}
      />
    );
  }

  if (view === 'titleDetail' && currentTitleDetail) {
    return (
      <>
        <NodeDetail
          node={currentTitleDetail}
          navigationPath={navigationPath}
          onNavigate={onTitleNavigate}
          onNavigateHistory={onNavigateHistory}
          onHome={onHome}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onSearchFocus={onSearchFocus}
          onSearchClear={onSearchClear}
          searchResults={searchResults}
          showSearchResults={showSearchResults}
          isSearching={isSearching}
          onSearchResultClick={onDetailSearchResultClick}
          onCreateNode={onCreateNode}
          onNodeInfoClick={() => {}}
          webglCanvasRef={webglCanvasRef}
        />
        <TitleRelationInfoPanel
          view={view}
          titleRelationInfo={titleRelationInfo}
          onClose={onCloseTitleRelationInfo}
        />
      </>
    );
  }

  if (view === 'nodeDetail' && currentNodeDetail) {
    return (
      <>
        <NodeDetail
          node={currentNodeDetail}
          navigationPath={navigationPath}
          onNavigate={onNodeNavigate}
          onNavigateHistory={onNavigateHistory}
          onHome={onHome}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onSearchFocus={onSearchFocus}
          onSearchClear={onSearchClear}
          searchResults={searchResults}
          showSearchResults={showSearchResults}
          isSearching={isSearching}
          onSearchResultClick={onDetailSearchResultClick}
          onCreateNode={onCreateNode}
          onNodeInfoClick={onOpenCurrentNodeInfo}
          webglCanvasRef={webglCanvasRef}
        />
        <div className="sense-article-entry-banner">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openSenseArticleFromNode(currentNodeDetail)}
          >
            {SENSE_ARTICLE_ENTRY_LABEL}
          </button>
        </div>
      </>
    );
  }

  return null;
};

export default KnowledgeViewRouter;
