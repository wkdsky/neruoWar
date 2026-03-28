import { useCallback } from 'react';
import { API_BASE } from '../../runtimeConfig';
import {
  buildNavigationTrailItem,
  createHomeNavigationPath,
  isKnowledgeDetailView,
  isValidObjectId,
  normalizeNavigationRelation,
  normalizeObjectId
} from '../../app/appShared';

const useKnowledgeNavigation = ({
  view,
  currentNodeDetail,
  showKnowledgeDomain,
  isTransitioningToDomain,
  knowledgeDomainNode,
  showDistributionPanel,
  siegeDialog,
  openSystemConfirm,
  closeSystemConfirm,
  collapseRightDocksBeforeNavigation,
  clearStarMapState,
  trackRecentDomain,
  refreshDomainConflictForNode,
  beginPrimaryNavigationRequest,
  isPrimaryNavigationRequestCurrent,
  finishPrimaryNavigationRequest,
  fetchPrimaryNavigationResponse,
  isAbortError,
  parseApiResponse,
  getApiErrorMessage,
  closeDistributionPanel,
  resetSiegeDialog,
  knowledgeDomainReturnContextRef,
  setShowKnowledgeDomain,
  setIsTransitioningToDomain,
  setDomainTransitionProgress,
  setKnowledgeDomainNode,
  setKnowledgeDomainMode,
  setClickedNodeForTransition,
  setTitleRelationInfo,
  setIsSenseSelectorVisible,
  setSenseSelectorSourceNode,
  setCurrentTitleDetail,
  setTitleGraphData,
  setCurrentNodeDetail,
  setNodeInfoModalTarget,
  setView,
  setNavigationPath
}) => {
  const resolveNavigationRelationAgainstCurrent = useCallback((targetNodeId, currentNode, relationHint) => {
    const normalizedHint = normalizeNavigationRelation(relationHint);
    if (normalizedHint !== 'jump') return normalizedHint;

    const normalizedTargetId = normalizeObjectId(targetNodeId);
    if (!normalizedTargetId || !currentNode) return 'jump';

    const isParentNode = Array.isArray(currentNode?.parentNodesInfo)
      && currentNode.parentNodesInfo.some((item) => normalizeObjectId(item?._id) === normalizedTargetId);
    if (isParentNode) return 'parent';

    const isChildNode = Array.isArray(currentNode?.childNodesInfo)
      && currentNode.childNodesInfo.some((item) => normalizeObjectId(item?._id) === normalizedTargetId);
    if (isChildNode) return 'child';

    return 'jump';
  }, []);

  const appendNavigationTrailItem = useCallback((node, relation = 'jump', options = {}) => {
    const mode = options?.mode === 'title' ? 'title' : 'sense';
    setNavigationPath((prevPath) => {
      const safePath = Array.isArray(prevPath) && prevPath.length > 0
        ? prevPath
        : createHomeNavigationPath();
      const targetNavItem = buildNavigationTrailItem(node, relation, { mode });
      if (!targetNavItem) return safePath;

      const duplicateIndex = safePath.findIndex((item, index) => (
        index > 0
        && item?.type === 'node'
        && normalizeObjectId(item?.nodeId) === targetNavItem.nodeId
      ));
      if (duplicateIndex >= 0) {
        return [
          ...safePath.slice(0, duplicateIndex),
          targetNavItem
        ];
      }

      return [...safePath, targetNavItem];
    });
  }, [setNavigationPath]);

  const replaceNavigationPathAtHistoryIndex = useCallback((historyIndex, node, options = {}) => {
    const mode = options?.mode === 'title' ? 'title' : 'sense';
    setNavigationPath((prevPath) => {
      const safePath = Array.isArray(prevPath) && prevPath.length > 0
        ? prevPath
        : createHomeNavigationPath();
      const boundedIndex = Number.isInteger(historyIndex)
        ? Math.max(0, Math.min(historyIndex, safePath.length - 1))
        : -1;
      if (boundedIndex < 0) return safePath;

      const nextPath = safePath.slice(0, boundedIndex + 1);
      const lastHistory = nextPath[nextPath.length - 1];
      if (lastHistory?.type !== 'node') {
        return nextPath;
      }

      const nextItem = buildNavigationTrailItem(node, lastHistory.relation, { mode });
      return [
        ...nextPath.slice(0, -1),
        {
          ...lastHistory,
          mode,
          senseId: mode === 'sense'
            ? (typeof node?.activeSenseId === 'string' ? node.activeSenseId : (lastHistory.senseId || ''))
            : '',
          label: nextItem?.label || lastHistory.label
        }
      ];
    });
  }, [setNavigationPath]);

  const closeKnowledgeDomainBeforeNavigation = useCallback(() => {
    if (showKnowledgeDomain || isTransitioningToDomain || knowledgeDomainNode) {
      setShowKnowledgeDomain(false);
      setIsTransitioningToDomain(false);
      setDomainTransitionProgress(0);
      setKnowledgeDomainNode(null);
      setKnowledgeDomainMode('normal');
      setClickedNodeForTransition(null);
      knowledgeDomainReturnContextRef.current = null;
    }
    if (showDistributionPanel) {
      closeDistributionPanel();
    }
    if (siegeDialog.open) {
      resetSiegeDialog();
    }
  }, [
    closeDistributionPanel,
    isTransitioningToDomain,
    knowledgeDomainNode,
    knowledgeDomainReturnContextRef,
    resetSiegeDialog,
    setClickedNodeForTransition,
    setDomainTransitionProgress,
    setIsTransitioningToDomain,
    setKnowledgeDomainMode,
    setKnowledgeDomainNode,
    setShowKnowledgeDomain,
    showDistributionPanel,
    showKnowledgeDomain,
    siegeDialog.open
  ]);

  const prepareForPrimaryNavigation = useCallback(async () => {
    closeKnowledgeDomainBeforeNavigation();
    setTitleRelationInfo(null);
    setIsSenseSelectorVisible(false);
    await collapseRightDocksBeforeNavigation();
  }, [
    closeKnowledgeDomainBeforeNavigation,
    collapseRightDocksBeforeNavigation,
    setIsSenseSelectorVisible,
    setTitleRelationInfo
  ]);

  const navigateToHomeWithDockCollapse = useCallback(async () => {
    await prepareForPrimaryNavigation();
    clearStarMapState();
    setView('home');
    setCurrentTitleDetail(null);
    setTitleGraphData(null);
    setTitleRelationInfo(null);
    setNodeInfoModalTarget(null);
    setIsSenseSelectorVisible(false);
    setSenseSelectorSourceNode(null);
    setNavigationPath(createHomeNavigationPath());
  }, [
    clearStarMapState,
    prepareForPrimaryNavigation,
    setCurrentTitleDetail,
    setIsSenseSelectorVisible,
    setNavigationPath,
    setNodeInfoModalTarget,
    setSenseSelectorSourceNode,
    setTitleGraphData,
    setTitleRelationInfo,
    setView
  ]);

  const handleHeaderHomeNavigation = useCallback(async () => {
    if (view === 'senseArticleEditor') {
      openSystemConfirm({
        title: '确认返回首页',
        message: '当前位于百科编辑页，返回首页将直接丢失本次未保存内容，是否继续返回首页？',
        confirmText: '直接返回首页',
        confirmTone: 'danger',
        onConfirm: async () => {
          closeSystemConfirm();
          await navigateToHomeWithDockCollapse();
        }
      });
      return;
    }
    await navigateToHomeWithDockCollapse();
  }, [
    closeSystemConfirm,
    navigateToHomeWithDockCollapse,
    openSystemConfirm,
    view
  ]);

  const fetchTitleDetail = useCallback(async (nodeId, clickedNode = null, navOptions = {}) => {
    const shouldAlert = navOptions?.silent !== true;
    const normalizedNodeId = normalizeObjectId(nodeId);
    if (!isValidObjectId(normalizedNodeId)) {
      if (shouldAlert) {
        alert('无效的节点ID');
      }
      return null;
    }
    const request = beginPrimaryNavigationRequest(
      `title:${normalizedNodeId}`,
      typeof navOptions?.requestSource === 'string' ? navOptions.requestSource : 'title-detail'
    );
    try {
      await prepareForPrimaryNavigation();
      if (!isPrimaryNavigationRequestCurrent(request)) {
        return null;
      }

      const response = await fetchPrimaryNavigationResponse(
        `${API_BASE}/nodes/public/title-detail/${normalizedNodeId}?depth=1`,
        request
      );
      if (!response) {
        return null;
      }
      if (!response.ok) {
        if (shouldAlert) {
          const parsed = await parseApiResponse(response);
          alert(getApiErrorMessage(parsed, '获取标题主视角失败'));
        }
        return null;
      }

      const data = await response.json();
      const graph = data?.graph || {};
      const centerNode = graph?.centerNode || null;
      const targetNodeId = normalizeObjectId(centerNode?._id);
      if (!isPrimaryNavigationRequestCurrent(request)) {
        return null;
      }
      if (!targetNodeId || !centerNode) {
        if (shouldAlert) {
          alert('标题主视角数据无效');
        }
        return null;
      }

      const shouldResetTrail = navOptions?.resetTrail === true || !isKnowledgeDetailView(view);
      const relation = normalizeNavigationRelation(navOptions?.relationHint);
      if (navOptions?.keepStarMapState !== true) {
        clearStarMapState();
      }
      trackRecentDomain(centerNode, { mode: 'title' });
      setCurrentTitleDetail(centerNode);
      setTitleGraphData(graph);
      setCurrentNodeDetail(null);
      setNodeInfoModalTarget(null);
      setTitleRelationInfo(null);
      setView('titleDetail');
      setIsSenseSelectorVisible(false);
      setSenseSelectorSourceNode(centerNode);
      refreshDomainConflictForNode(targetNodeId);

      if (clickedNode) {
        setClickedNodeForTransition(clickedNode);
      } else {
        setClickedNodeForTransition(null);
      }

      setNavigationPath((prevPath) => {
        const safePath = Array.isArray(prevPath) && prevPath.length > 0
          ? prevPath
          : createHomeNavigationPath();
        const historyIndex = Number.isInteger(navOptions?.historyIndex)
          ? Math.max(0, Math.min(navOptions.historyIndex, safePath.length - 1))
          : -1;
        if (historyIndex >= 0) {
          const nextPath = safePath.slice(0, historyIndex + 1);
          const lastHistory = nextPath[nextPath.length - 1];
          if (lastHistory?.type === 'node') {
            const nextItem = buildNavigationTrailItem(centerNode, lastHistory.relation, { mode: 'title' });
            return [...nextPath.slice(0, -1), {
              ...lastHistory,
              mode: 'title',
              senseId: '',
              label: nextItem?.label || lastHistory.label
            }];
          }
          return nextPath;
        }

        const targetNavItem = buildNavigationTrailItem(centerNode, relation, { mode: 'title' });
        if (!targetNavItem) return safePath;

        if (shouldResetTrail) {
          return [...createHomeNavigationPath(), targetNavItem];
        }

        const duplicateIndex = safePath.findIndex((item, index) => (
          index > 0
          && item?.type === 'node'
          && normalizeObjectId(item?.nodeId) === targetNavItem.nodeId
        ));
        if (duplicateIndex >= 0) {
          return [
            ...safePath.slice(0, duplicateIndex),
            targetNavItem
          ];
        }

        return [...safePath, targetNavItem];
      });

      return centerNode;
    } catch (error) {
      if (!isPrimaryNavigationRequestCurrent(request) || isAbortError(error)) {
        return null;
      }
      console.error('获取标题主视角失败:', error);
      if (shouldAlert) {
        alert(`获取标题主视角失败: ${error.message}`);
      }
      return null;
    } finally {
      finishPrimaryNavigationRequest(request);
    }
  }, [
    beginPrimaryNavigationRequest,
    clearStarMapState,
    fetchPrimaryNavigationResponse,
    finishPrimaryNavigationRequest,
    getApiErrorMessage,
    isAbortError,
    isPrimaryNavigationRequestCurrent,
    parseApiResponse,
    prepareForPrimaryNavigation,
    refreshDomainConflictForNode,
    setClickedNodeForTransition,
    setCurrentNodeDetail,
    setCurrentTitleDetail,
    setIsSenseSelectorVisible,
    setNavigationPath,
    setNodeInfoModalTarget,
    setSenseSelectorSourceNode,
    setTitleGraphData,
    setTitleRelationInfo,
    setView,
    trackRecentDomain,
    view
  ]);

  const fetchNodeDetail = useCallback(async (nodeId, clickedNode = null, navOptions = {}) => {
    const shouldAlert = navOptions?.silent !== true;
    const normalizedNodeId = normalizeObjectId(nodeId);
    if (!isValidObjectId(normalizedNodeId)) {
      if (shouldAlert) {
        alert('无效的节点ID');
      }
      return null;
    }
    const requestedSenseId = typeof navOptions?.activeSenseId === 'string' ? navOptions.activeSenseId.trim() : '';
    const request = beginPrimaryNavigationRequest(
      `sense:${normalizedNodeId}:${requestedSenseId}`,
      typeof navOptions?.requestSource === 'string' ? navOptions.requestSource : 'node-detail'
    );
    try {
      await prepareForPrimaryNavigation();
      if (!isPrimaryNavigationRequestCurrent(request)) {
        return null;
      }
      const detailUrl = requestedSenseId
        ? `${API_BASE}/nodes/public/node-detail/${normalizedNodeId}?senseId=${encodeURIComponent(requestedSenseId)}`
        : `${API_BASE}/nodes/public/node-detail/${normalizedNodeId}`;
      const response = await fetchPrimaryNavigationResponse(detailUrl, request);
      if (!response) {
        return null;
      }
      if (response.ok) {
        const data = await response.json();
        const targetNodeId = normalizeObjectId(data?.node?._id);
        if (!isPrimaryNavigationRequestCurrent(request)) {
          return null;
        }
        const currentNodeBeforeNavigate = currentNodeDetail;
        const shouldResetTrail = navOptions?.resetTrail === true || !isKnowledgeDetailView(view);
        const relation = resolveNavigationRelationAgainstCurrent(
          targetNodeId,
          currentNodeBeforeNavigate,
          navOptions?.relationHint
        );
        const previousNodeId = normalizeObjectId(currentNodeBeforeNavigate?._id);
        const isSenseOnlySwitch = !!requestedSenseId && !!targetNodeId && targetNodeId === previousNodeId;
        if (navOptions?.keepStarMapState !== true) {
          clearStarMapState();
        }
        if (!isSenseOnlySwitch) {
          setIsSenseSelectorVisible(false);
        }
        trackRecentDomain(data.node, {
          mode: 'sense',
          senseId: typeof data?.node?.activeSenseId === 'string' ? data.node.activeSenseId : ''
        });
        setCurrentNodeDetail(data.node);
        setCurrentTitleDetail(null);
        setTitleGraphData(null);
        setTitleRelationInfo(null);
        setView('nodeDetail');
        refreshDomainConflictForNode(targetNodeId);

        if (clickedNode) {
          setClickedNodeForTransition(clickedNode);
        } else {
          setClickedNodeForTransition(null);
        }

        setNavigationPath((prevPath) => {
          const safePath = Array.isArray(prevPath) && prevPath.length > 0
            ? prevPath
            : createHomeNavigationPath();
          const historyIndex = Number.isInteger(navOptions?.historyIndex)
            ? Math.max(0, Math.min(navOptions.historyIndex, safePath.length - 1))
            : -1;
          if (historyIndex >= 0) {
            const nextPath = safePath.slice(0, historyIndex + 1);
            const lastHistory = nextPath[nextPath.length - 1];
            if (lastHistory?.type === 'node') {
              const nextItem = buildNavigationTrailItem(
                data?.node || {},
                lastHistory.relation,
                { mode: 'sense' }
              );
              return [
                ...nextPath.slice(0, -1),
                {
                  ...lastHistory,
                  mode: 'sense',
                  senseId: typeof data?.node?.activeSenseId === 'string' ? data.node.activeSenseId : (lastHistory.senseId || ''),
                  label: nextItem?.label || lastHistory.label
                }
              ];
            }
            return nextPath;
          }

          const targetNavItem = buildNavigationTrailItem(data.node, relation, { mode: 'sense' });
          if (!targetNavItem) return safePath;

          if (shouldResetTrail) {
            return [...createHomeNavigationPath(), targetNavItem];
          }

          const duplicateIndex = safePath.findIndex((item, index) => (
            index > 0
            && item?.type === 'node'
            && normalizeObjectId(item?.nodeId) === targetNavItem.nodeId
          ));
          if (duplicateIndex >= 0) {
            return [
              ...safePath.slice(0, duplicateIndex),
              targetNavItem
            ];
          }

          return [...safePath, targetNavItem];
        });
        return data.node;
      }

      if (shouldAlert) {
        const parsed = await parseApiResponse(response);
        alert(getApiErrorMessage(parsed, '获取节点详情失败'));
      }
      return null;
    } catch (error) {
      if (!isPrimaryNavigationRequestCurrent(request) || isAbortError(error)) {
        return null;
      }
      console.error('获取节点详情失败:', error);
      if (shouldAlert) {
        alert(`获取节点详情失败: ${error.message}`);
      }
      return null;
    } finally {
      finishPrimaryNavigationRequest(request);
    }
  }, [
    beginPrimaryNavigationRequest,
    clearStarMapState,
    currentNodeDetail,
    fetchPrimaryNavigationResponse,
    finishPrimaryNavigationRequest,
    getApiErrorMessage,
    isAbortError,
    isPrimaryNavigationRequestCurrent,
    parseApiResponse,
    prepareForPrimaryNavigation,
    refreshDomainConflictForNode,
    resolveNavigationRelationAgainstCurrent,
    setClickedNodeForTransition,
    setCurrentNodeDetail,
    setCurrentTitleDetail,
    setIsSenseSelectorVisible,
    setNavigationPath,
    setTitleGraphData,
    setTitleRelationInfo,
    setView,
    trackRecentDomain,
    view
  ]);

  return {
    resolveNavigationRelationAgainstCurrent,
    appendNavigationTrailItem,
    replaceNavigationPathAtHistoryIndex,
    prepareForPrimaryNavigation,
    navigateToHomeWithDockCollapse,
    handleHeaderHomeNavigation,
    fetchTitleDetail,
    fetchNodeDetail
  };
};

export default useKnowledgeNavigation;
