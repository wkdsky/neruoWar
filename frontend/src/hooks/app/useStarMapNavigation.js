import { useCallback } from 'react';
import { API_BASE } from '../../runtimeConfig';
import {
  getNavigationRelationFromSceneNode,
  isValidObjectId,
  normalizeNavigationRelation,
  normalizeObjectId
} from '../../app/appShared';
import {
  DEFAULT_STAR_MAP_LIMIT,
  KNOWLEDGE_MAIN_VIEW_MODE,
  STAR_MAP_LAYER,
  areStarMapCentersEqual
} from '../../starMap/starMapHelpers';

const useStarMapNavigation = ({
  view,
  currentNodeDetail,
  currentStarMapCenter,
  beginStarMapRequest,
  isStarMapRequestCurrent,
  finishStarMapRequest,
  parseApiResponse,
  getApiErrorMessage,
  refreshDomainConflictForNode,
  isAbortError,
  resolveNavigationRelationAgainstCurrent,
  appendNavigationTrailItem,
  setCurrentStarMapCenter,
  setCurrentStarMapLayer,
  setCurrentStarMapLimit,
  setIsStarMapLoading,
  setKnowledgeMainViewMode,
  setTitleStarMapData,
  setNodeStarMapData,
  setClickedNodeForTransition,
  setCurrentTitleDetail,
  setCurrentNodeDetail,
  setTitleGraphData,
  setNodeInfoModalTarget,
  setView,
  setTitleRelationInfo,
  setIsSenseSelectorVisible
}) => {
  const buildStarMapCenterState = useCallback((layer, nodeLike = {}) => {
    const nodeId = normalizeObjectId(nodeLike?._id);
    if (!nodeId) return null;
    return {
      layer: layer === STAR_MAP_LAYER.SENSE ? STAR_MAP_LAYER.SENSE : STAR_MAP_LAYER.TITLE,
      nodeId,
      senseId: layer === STAR_MAP_LAYER.SENSE
        ? (typeof nodeLike?.activeSenseId === 'string' ? nodeLike.activeSenseId.trim() : '')
        : '',
      label: typeof nodeLike?.displayName === 'string' && nodeLike.displayName.trim()
        ? nodeLike.displayName.trim()
        : (typeof nodeLike?.name === 'string' ? nodeLike.name.trim() : '')
    };
  }, []);

  const fetchTitleStarMap = useCallback(async (nodeId, options = {}) => {
    const normalizedNodeId = normalizeObjectId(nodeId);
    if (!isValidObjectId(normalizedNodeId)) return null;

    const request = beginStarMapRequest(`title:${normalizedNodeId}`);
    const requestedLimit = Number.isFinite(Number(options?.limit))
      ? Math.max(10, Math.min(200, Number(options.limit)))
      : null;
    const query = requestedLimit ? `?limit=${requestedLimit}` : '';
    setIsStarMapLoading(true);

    try {
      const response = await fetch(`${API_BASE}/nodes/public/title-star-map/${normalizedNodeId}${query}`, {
        signal: request.controller.signal
      });
      if (!isStarMapRequestCurrent(request)) return null;
      if (!response.ok) {
        const parsed = await parseApiResponse(response);
        if (options?.silent !== true) {
          alert(getApiErrorMessage(parsed, '获取标题星盘失败'));
        }
        return null;
      }

      const data = await response.json();
      if (!isStarMapRequestCurrent(request)) return null;
      const graph = data?.graph || null;
      const centerNode = graph?.centerNode || null;
      const centerState = buildStarMapCenterState(STAR_MAP_LAYER.TITLE, centerNode);
      if (!graph || !centerState) {
        if (options?.silent !== true) {
          alert('标题星盘数据无效');
        }
        return null;
      }

      setTitleRelationInfo(null);
      setIsSenseSelectorVisible(false);
      if (options?.syncDetailState) {
        setCurrentTitleDetail(centerNode);
        setCurrentNodeDetail(null);
        setTitleGraphData(null);
        setNodeInfoModalTarget(null);
        setView('titleDetail');
        refreshDomainConflictForNode(normalizedNodeId);
      }
      setTitleStarMapData(graph);
      setNodeStarMapData(null);
      setCurrentStarMapCenter(centerState);
      setCurrentStarMapLayer(STAR_MAP_LAYER.TITLE);
      setCurrentStarMapLimit(Math.max(10, Number(graph?.effectiveLimit) || DEFAULT_STAR_MAP_LIMIT));
      setKnowledgeMainViewMode(KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP);
      setClickedNodeForTransition(options?.clickedNode || null);
      return graph;
    } catch (error) {
      if (!isStarMapRequestCurrent(request) || isAbortError(error)) {
        return null;
      }
      console.error('获取标题星盘失败:', error);
      if (options?.silent !== true) {
        alert(`获取标题星盘失败: ${error.message}`);
      }
      return null;
    } finally {
      if (isStarMapRequestCurrent(request)) {
        setIsStarMapLoading(false);
      }
      finishStarMapRequest(request);
    }
  }, [
    beginStarMapRequest,
    buildStarMapCenterState,
    finishStarMapRequest,
    getApiErrorMessage,
    isAbortError,
    isStarMapRequestCurrent,
    parseApiResponse,
    refreshDomainConflictForNode,
    setClickedNodeForTransition,
    setCurrentNodeDetail,
    setCurrentStarMapCenter,
    setCurrentStarMapLayer,
    setCurrentStarMapLimit,
    setCurrentTitleDetail,
    setIsSenseSelectorVisible,
    setIsStarMapLoading,
    setKnowledgeMainViewMode,
    setNodeInfoModalTarget,
    setNodeStarMapData,
    setTitleGraphData,
    setTitleRelationInfo,
    setTitleStarMapData,
    setView
  ]);

  const fetchSenseStarMap = useCallback(async (nodeId, senseId = '', options = {}) => {
    const normalizedNodeId = normalizeObjectId(nodeId);
    if (!isValidObjectId(normalizedNodeId)) return null;

    const request = beginStarMapRequest(`sense:${normalizedNodeId}:${String(senseId || '').trim()}`);
    const requestedLimit = Number.isFinite(Number(options?.limit))
      ? Math.max(10, Math.min(200, Number(options.limit)))
      : null;
    const senseQuery = typeof senseId === 'string' && senseId.trim()
      ? `senseId=${encodeURIComponent(senseId.trim())}`
      : '';
    const limitQuery = requestedLimit ? `limit=${requestedLimit}` : '';
    const query = [senseQuery, limitQuery].filter(Boolean).join('&');
    setIsStarMapLoading(true);

    try {
      const response = await fetch(
        `${API_BASE}/nodes/public/sense-star-map/${normalizedNodeId}${query ? `?${query}` : ''}`,
        { signal: request.controller.signal }
      );
      if (!isStarMapRequestCurrent(request)) return null;
      if (!response.ok) {
        const parsed = await parseApiResponse(response);
        if (options?.silent !== true) {
          alert(getApiErrorMessage(parsed, '获取释义星盘失败'));
        }
        return null;
      }

      const data = await response.json();
      if (!isStarMapRequestCurrent(request)) return null;
      const graph = data?.graph || null;
      const centerNode = graph?.centerNode || null;
      const centerState = buildStarMapCenterState(STAR_MAP_LAYER.SENSE, centerNode);
      if (!graph || !centerState) {
        if (options?.silent !== true) {
          alert('释义星盘数据无效');
        }
        return null;
      }

      setTitleRelationInfo(null);
      setIsSenseSelectorVisible(false);
      if (options?.syncDetailState) {
        setCurrentNodeDetail(centerNode);
        setCurrentTitleDetail(null);
        setTitleGraphData(null);
        setNodeInfoModalTarget(null);
        setView('nodeDetail');
        refreshDomainConflictForNode(normalizedNodeId);
      }
      setNodeStarMapData(graph);
      setTitleStarMapData(null);
      setCurrentStarMapCenter(centerState);
      setCurrentStarMapLayer(STAR_MAP_LAYER.SENSE);
      setCurrentStarMapLimit(Math.max(10, Number(graph?.effectiveLimit) || DEFAULT_STAR_MAP_LIMIT));
      setKnowledgeMainViewMode(KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP);
      setClickedNodeForTransition(options?.clickedNode || null);
      return graph;
    } catch (error) {
      if (!isStarMapRequestCurrent(request) || isAbortError(error)) {
        return null;
      }
      console.error('获取释义星盘失败:', error);
      if (options?.silent !== true) {
        alert(`获取释义星盘失败: ${error.message}`);
      }
      return null;
    } finally {
      if (isStarMapRequestCurrent(request)) {
        setIsStarMapLoading(false);
      }
      finishStarMapRequest(request);
    }
  }, [
    beginStarMapRequest,
    buildStarMapCenterState,
    finishStarMapRequest,
    getApiErrorMessage,
    isAbortError,
    isStarMapRequestCurrent,
    parseApiResponse,
    refreshDomainConflictForNode,
    setClickedNodeForTransition,
    setCurrentNodeDetail,
    setCurrentStarMapCenter,
    setCurrentStarMapLayer,
    setCurrentStarMapLimit,
    setCurrentTitleDetail,
    setIsSenseSelectorVisible,
    setIsStarMapLoading,
    setKnowledgeMainViewMode,
    setNodeInfoModalTarget,
    setNodeStarMapData,
    setTitleGraphData,
    setTitleRelationInfo,
    setTitleStarMapData,
    setView
  ]);

  const recenterStarMapFromNode = useCallback(async (node) => {
    if (!node?.data?._id) return;
    const relationHint = getNavigationRelationFromSceneNode(node);

    if (view === 'titleDetail') {
      const nextCenter = buildStarMapCenterState(STAR_MAP_LAYER.TITLE, node.data);
      if (areStarMapCentersEqual(currentStarMapCenter, nextCenter)) return;
      const graph = await fetchTitleStarMap(node.data._id, {
        silent: false,
        clickedNode: node
      });
      if (graph?.centerNode) {
        appendNavigationTrailItem(
          graph.centerNode,
          normalizeNavigationRelation(relationHint),
          { mode: 'title' }
        );
      }
      return;
    }

    if (view === 'nodeDetail') {
      const nextCenter = buildStarMapCenterState(STAR_MAP_LAYER.SENSE, node.data);
      if (areStarMapCentersEqual(currentStarMapCenter, nextCenter)) return;
      const graph = await fetchSenseStarMap(node.data._id, node?.data?.activeSenseId || '', {
        silent: false,
        clickedNode: node
      });
      if (graph?.centerNode) {
        appendNavigationTrailItem(
          graph.centerNode,
          resolveNavigationRelationAgainstCurrent(graph.centerNode?._id, currentNodeDetail, relationHint),
          { mode: 'sense' }
        );
      }
    }
  }, [
    appendNavigationTrailItem,
    buildStarMapCenterState,
    currentNodeDetail,
    currentStarMapCenter,
    fetchSenseStarMap,
    fetchTitleStarMap,
    resolveNavigationRelationAgainstCurrent,
    view
  ]);

  return {
    fetchTitleStarMap,
    fetchSenseStarMap,
    recenterStarMapFromNode
  };
};

export default useStarMapNavigation;
