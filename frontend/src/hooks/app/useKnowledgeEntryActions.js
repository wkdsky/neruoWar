import { useCallback } from 'react';
import { API_BASE } from '../../runtimeConfig';
import {
  isKnowledgeDetailView,
  isTitleBattleView,
  normalizeObjectId
} from '../../app/appShared';

const useKnowledgeEntryActions = ({
  view,
  currentNodeDetail,
  currentTitleDetail,
  currentLocationNodeDetail,
  userLocation,
  markNotificationRead,
  closeHeaderPanels,
  buildClickedNodeFromScene,
  fetchTitleDetail,
  fetchNodeDetail,
  closeKnowledgeSearchResults
}) => {
  const handleJumpToCurrentLocationView = useCallback(async () => {
    if (!currentLocationNodeDetail?._id) {
      return;
    }

    const activeDetailNode = isTitleBattleView(view) ? currentTitleDetail : currentNodeDetail;
    if (isKnowledgeDetailView(view) && activeDetailNode?.name === userLocation) {
      return;
    }

    const clickedNode = buildClickedNodeFromScene(currentLocationNodeDetail._id);
    await fetchTitleDetail(currentLocationNodeDetail._id, clickedNode);
  }, [
    buildClickedNodeFromScene,
    currentLocationNodeDetail,
    currentNodeDetail,
    currentTitleDetail,
    fetchTitleDetail,
    userLocation,
    view
  ]);

  const handleDistributionAnnouncementClick = useCallback(async (notification) => {
    if (!notification) return;

    if (!notification.read && notification._id) {
      await markNotificationRead(notification._id);
    }

    let targetNodeId = normalizeObjectId(notification.nodeId);
    if (!targetNodeId && typeof notification.nodeName === 'string' && notification.nodeName.trim()) {
      try {
        const response = await fetch(`${API_BASE}/nodes/public/search?query=${encodeURIComponent(notification.nodeName.trim())}`);
        if (response.ok) {
          const data = await response.json();
          const exactMatch = Array.isArray(data?.results)
            ? data.results.find((item) => (
              item?.domainName === notification.nodeName.trim()
              || item?.name === notification.nodeName.trim()
            ))
            : null;
          targetNodeId = normalizeObjectId(exactMatch?.nodeId || exactMatch?._id);
        }
      } catch (_error) {
        targetNodeId = '';
      }
    }
    if (!targetNodeId) return;

    const clickedNode = buildClickedNodeFromScene(targetNodeId);
    await fetchTitleDetail(targetNodeId, clickedNode);
    closeKnowledgeSearchResults();
  }, [
    buildClickedNodeFromScene,
    closeKnowledgeSearchResults,
    fetchTitleDetail,
    markNotificationRead
  ]);

  const handleArrivalNotificationClick = useCallback(async (notification) => {
    if (!notification) return;
    await handleDistributionAnnouncementClick(notification);
  }, [handleDistributionAnnouncementClick]);

  const handleHomeAnnouncementClick = useCallback(async (notification) => {
    if (!notification) return;
    if (notification.type === 'domain_distribution_announcement') {
      await handleDistributionAnnouncementClick(notification);
      return;
    }

    if (!notification.read && notification._id) {
      await markNotificationRead(notification._id);
    }
  }, [handleDistributionAnnouncementClick, markNotificationRead]);

  const handleOpenRelatedDomain = useCallback(async (node, sectionType = 'default') => {
    const nodeId = normalizeObjectId(node?._id);
    if (!nodeId) return;
    closeHeaderPanels();
    const clickedNode = buildClickedNodeFromScene(nodeId);
    if (sectionType === 'recent' && node?.recentVisitMode === 'sense') {
      await fetchNodeDetail(nodeId, clickedNode, {
        relationHint: 'jump',
        activeSenseId: typeof node?.recentVisitSenseId === 'string' ? node.recentVisitSenseId.trim() : ''
      });
      return;
    }
    await fetchTitleDetail(nodeId, clickedNode, { relationHint: 'jump' });
  }, [
    buildClickedNodeFromScene,
    closeHeaderPanels,
    fetchNodeDetail,
    fetchTitleDetail
  ]);

  const handleOpenTravelNode = useCallback(async (travelNode) => {
    const nodeId = normalizeObjectId(travelNode?.nodeId);
    if (!nodeId) return;
    const clickedNode = buildClickedNodeFromScene(nodeId);
    await fetchTitleDetail(nodeId, clickedNode);
  }, [buildClickedNodeFromScene, fetchTitleDetail]);

  const handleHomeKnowledgeSearchResultClick = useCallback((node) => {
    const targetNodeId = normalizeObjectId(node?.nodeId || node?._id);
    if (!targetNodeId) return;
    fetchNodeDetail(targetNodeId, {
      id: `search-${targetNodeId || node?._id}`,
      data: node,
      type: 'search'
    }, {
      resetTrail: true,
      relationHint: 'jump',
      activeSenseId: typeof node?.senseId === 'string' ? node.senseId : ''
    });
    closeKnowledgeSearchResults();
  }, [closeKnowledgeSearchResults, fetchNodeDetail]);

  const handleDetailKnowledgeSearchResultClick = useCallback((node) => {
    const targetNodeId = normalizeObjectId(node?.nodeId || node?._id);
    if (!targetNodeId) return;
    fetchNodeDetail(targetNodeId, {
      id: `search-${targetNodeId || node?._id}`,
      data: node,
      type: 'search'
    }, {
      relationHint: 'jump',
      activeSenseId: typeof node?.senseId === 'string' ? node.senseId : ''
    });
    closeKnowledgeSearchResults();
  }, [closeKnowledgeSearchResults, fetchNodeDetail]);

  return {
    handleJumpToCurrentLocationView,
    handleDistributionAnnouncementClick,
    handleArrivalNotificationClick,
    handleHomeAnnouncementClick,
    handleOpenRelatedDomain,
    handleOpenTravelNode,
    handleHomeKnowledgeSearchResultClick,
    handleDetailKnowledgeSearchResultClick
  };
};

export default useKnowledgeEntryActions;
