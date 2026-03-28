import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../../runtimeConfig';
import {
  isKnowledgeDetailView,
  normalizeObjectId
} from '../../app/appShared';
import { senseArticleApi } from '../../utils/senseArticleApi';

const HIDDEN_ANCHOR = { x: 0, y: 0, visible: false };

const useSenseSelector = ({
  view,
  isWebGLReady,
  webglCanvasRef,
  sceneManagerRef,
  senseSelectorPanelRef,
  currentNodeDetail,
  currentTitleDetail,
  senseSelectorSourceNode,
  senseSelectorSourceSceneNodeId,
  isSenseSelectorVisible,
  senseSelectorOverviewNode,
  senseArticleEntryStatusMap,
  armHomeDetailTransition,
  setTitleRelationInfo,
  setSenseSelectorSourceNode,
  setSenseSelectorSourceSceneNodeId,
  setSenseSelectorAnchor,
  setIsSenseSelectorVisible,
  setSenseSelectorOverviewNode,
  setSenseSelectorOverviewLoading,
  setSenseSelectorOverviewError,
  setSenseArticleEntryStatusMap
}) => {
  const senseSelectorAnchorRef = useRef(HIDDEN_ANCHOR);
  const senseArticleEntryStatusMapRef = useRef({});

  useEffect(() => {
    senseArticleEntryStatusMapRef.current = senseArticleEntryStatusMap;
  }, [senseArticleEntryStatusMap]);

  const resetSenseSelectorAnchor = useCallback(() => {
    const next = { ...HIDDEN_ANCHOR };
    senseSelectorAnchorRef.current = next;
    setSenseSelectorAnchor(next);
  }, [setSenseSelectorAnchor]);

  const updateSenseSelectorAnchorBySceneNode = useCallback((sceneNode) => {
    const renderer = sceneManagerRef.current?.renderer;
    const canvas = webglCanvasRef.current;
    if (!renderer || !canvas || !sceneNode) return;
    const rect = canvas.getBoundingClientRect();
    const screenPos = renderer.worldToScreen(sceneNode.x, sceneNode.y);
    const next = {
      x: Math.round(rect.left + screenPos.x),
      y: Math.round(rect.top + screenPos.y),
      visible: true
    };
    senseSelectorAnchorRef.current = next;
    setSenseSelectorAnchor(next);
  }, [sceneManagerRef, setSenseSelectorAnchor, webglCanvasRef]);

  const updateSenseSelectorAnchorByElement = useCallback((element) => {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return;
    const next = {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      visible: true
    };
    senseSelectorAnchorRef.current = next;
    setSenseSelectorAnchor(next);
  }, [setSenseSelectorAnchor]);

  const handleHomeDomainActivate = useCallback((node, anchorElement = null) => {
    if (!node?._id) return;
    setTitleRelationInfo(null);
    setSenseSelectorSourceNode(node);
    setSenseSelectorSourceSceneNodeId('');
    armHomeDetailTransition(node, anchorElement);
    if (anchorElement) {
      updateSenseSelectorAnchorByElement(anchorElement);
    }
    setIsSenseSelectorVisible(true);
  }, [
    armHomeDetailTransition,
    setIsSenseSelectorVisible,
    setSenseSelectorSourceNode,
    setSenseSelectorSourceSceneNodeId,
    setTitleRelationInfo,
    updateSenseSelectorAnchorByElement
  ]);

  useEffect(() => {
    if (!isWebGLReady) {
      resetSenseSelectorAnchor();
      setSenseSelectorSourceSceneNodeId('');
      setIsSenseSelectorVisible(false);
      return undefined;
    }
    if (!isKnowledgeDetailView(view) && view !== 'home') {
      resetSenseSelectorAnchor();
      setSenseSelectorSourceSceneNodeId('');
      setIsSenseSelectorVisible(false);
      return undefined;
    }
    if (view === 'home' && !isSenseSelectorVisible) return undefined;

    const updateAnchor = () => {
      const sceneManager = sceneManagerRef.current;
      const renderer = sceneManager?.renderer;
      const sceneNodes = Array.isArray(sceneManager?.currentLayout?.nodes)
        ? sceneManager.currentLayout.nodes
        : [];
      const targetNode = view === 'home'
        ? (
          sceneNodes.find((item) => (
            String(item?.id || '') === String(senseSelectorSourceSceneNodeId || '')
          ))
          || sceneNodes.find((item) => (
            normalizeObjectId(item?.data?._id) === normalizeObjectId(senseSelectorSourceNode?._id)
          ))
        )
        : sceneNodes.find((item) => item?.type === 'center');
      const canvas = webglCanvasRef.current;
      if (renderer && targetNode && canvas) {
        const screenPos = renderer.worldToScreen(targetNode.x, targetNode.y);
        const rect = canvas.getBoundingClientRect();
        const next = {
          x: Math.round(rect.left + screenPos.x),
          y: Math.round(rect.top + screenPos.y),
          visible: true
        };
        const prev = senseSelectorAnchorRef.current || HIDDEN_ANCHOR;
        const moved = Math.abs(prev.x - next.x) > 1 || Math.abs(prev.y - next.y) > 1 || prev.visible !== next.visible;
        if (moved) {
          senseSelectorAnchorRef.current = next;
          setSenseSelectorAnchor(next);
        }
      }
    };

    updateAnchor();
    window.addEventListener('resize', updateAnchor);
    return () => {
      window.removeEventListener('resize', updateAnchor);
    };
  }, [
    currentNodeDetail?._id,
    currentNodeDetail?.activeSenseId,
    currentTitleDetail?._id,
    isSenseSelectorVisible,
    isWebGLReady,
    resetSenseSelectorAnchor,
    sceneManagerRef,
    senseSelectorSourceNode?._id,
    senseSelectorSourceSceneNodeId,
    setIsSenseSelectorVisible,
    setSenseSelectorAnchor,
    setSenseSelectorSourceSceneNodeId,
    view,
    webglCanvasRef
  ]);

  useEffect(() => {
    if (!isSenseSelectorVisible) return undefined;
    if (view !== 'nodeDetail' && view !== 'titleDetail' && view !== 'home') return undefined;
    const canvas = webglCanvasRef.current;
    const renderer = sceneManagerRef.current?.renderer;
    if (!canvas || !renderer) return undefined;

    const handleMapClick = (event) => {
      const pos = renderer.getCanvasPositionFromEvent(event);
      const clickedNode = renderer.hitTest(pos.x, pos.y);
      if (view === 'home') {
        if (!clickedNode) setIsSenseSelectorVisible(false);
        return;
      }
      if (!clickedNode || clickedNode.type !== 'center') {
        setIsSenseSelectorVisible(false);
      }
    };

    canvas.addEventListener('click', handleMapClick);
    return () => {
      canvas.removeEventListener('click', handleMapClick);
    };
  }, [
    currentNodeDetail?._id,
    currentTitleDetail?._id,
    isSenseSelectorVisible,
    sceneManagerRef,
    setIsSenseSelectorVisible,
    view,
    webglCanvasRef
  ]);

  useEffect(() => {
    if (view !== 'home' || !isSenseSelectorVisible) return undefined;

    const handleDocumentPointerDown = (event) => {
      if (senseSelectorPanelRef.current?.contains(event.target)) {
        return;
      }
      setIsSenseSelectorVisible(false);
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown);
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
    };
  }, [isSenseSelectorVisible, senseSelectorPanelRef, setIsSenseSelectorVisible, view]);

  useEffect(() => {
    if (!isSenseSelectorVisible || (view !== 'home' && view !== 'nodeDetail' && view !== 'titleDetail')) {
      setSenseSelectorOverviewLoading(false);
      setSenseSelectorOverviewError('');
      return undefined;
    }

    const selectorNode = (
      (view === 'titleDetail' && currentTitleDetail)
      || (view === 'nodeDetail' && currentNodeDetail)
      || senseSelectorSourceNode
      || null
    );
    const nodeId = normalizeObjectId(selectorNode?._id);
    if (!nodeId) {
      setSenseSelectorOverviewNode(null);
      setSenseSelectorOverviewLoading(false);
      setSenseSelectorOverviewError('');
      return undefined;
    }

    const detailNodeId = normalizeObjectId(currentNodeDetail?._id);
    const requestedSenseId = (
      view === 'nodeDetail'
      && detailNodeId
      && detailNodeId === nodeId
      && typeof currentNodeDetail?.activeSenseId === 'string'
    )
      ? currentNodeDetail.activeSenseId.trim()
      : (typeof selectorNode?.activeSenseId === 'string' ? selectorNode.activeSenseId.trim() : '');
    if (
      view === 'nodeDetail'
      && detailNodeId
      && detailNodeId === nodeId
      && currentNodeDetail
    ) {
      setSenseSelectorOverviewNode(currentNodeDetail);
      setSenseSelectorOverviewLoading(false);
      setSenseSelectorOverviewError('');
      return undefined;
    }

    setSenseSelectorOverviewNode((prev) => (
      normalizeObjectId(prev?._id) === nodeId
        ? prev
        : selectorNode
    ));
    setSenseSelectorOverviewLoading(true);
    setSenseSelectorOverviewError('');

    let cancelled = false;
    (async () => {
      try {
        const detailUrl = requestedSenseId
          ? `${API_BASE}/nodes/public/node-detail/${nodeId}?senseId=${encodeURIComponent(requestedSenseId)}`
          : `${API_BASE}/nodes/public/node-detail/${nodeId}`;
        const response = await fetch(detailUrl);
        const rawText = await response.text();
        let data = null;
        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch (_error) {
          data = null;
        }
        if (cancelled) return;
        if (!response.ok || !data?.node) {
          const fallback = `读取标题总览失败（HTTP ${response.status}）`;
          setSenseSelectorOverviewError(data?.error || data?.message || fallback);
          setSenseSelectorOverviewLoading(false);
          return;
        }
        setSenseSelectorOverviewNode(data.node);
        setSenseSelectorOverviewLoading(false);
        setSenseSelectorOverviewError('');
      } catch (error) {
        if (cancelled) return;
        setSenseSelectorOverviewLoading(false);
        setSenseSelectorOverviewError(error?.message ? `读取标题总览失败: ${error.message}` : '读取标题总览失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentNodeDetail,
    currentTitleDetail,
    isSenseSelectorVisible,
    senseSelectorSourceNode,
    setSenseSelectorOverviewError,
    setSenseSelectorOverviewLoading,
    setSenseSelectorOverviewNode,
    view
  ]);

  useEffect(() => {
    if (!isSenseSelectorVisible) return undefined;
    const overviewNode = senseSelectorOverviewNode || currentNodeDetail || currentTitleDetail || senseSelectorSourceNode || null;
    const nodeId = normalizeObjectId(overviewNode?._id || overviewNode?.nodeId);
    if (!nodeId) return undefined;

    const senses = Array.isArray(overviewNode?.synonymSenses) && overviewNode.synonymSenses.length > 0
      ? overviewNode.synonymSenses
      : [{ senseId: overviewNode?.activeSenseId || 'sense_1' }];
    const pendingTargets = senses
      .map((sense) => {
        const senseId = typeof sense?.senseId === 'string' ? sense.senseId.trim() : '';
        if (!senseId) return null;
        const key = `${nodeId}:${senseId}`;
        const cached = senseArticleEntryStatusMapRef.current[key];
        if (cached?.resolved || cached?.loading) return null;
        return { key, nodeId, senseId };
      })
      .filter(Boolean);
    if (pendingTargets.length === 0) return undefined;

    setSenseArticleEntryStatusMap((prev) => {
      let hasChanges = false;
      const next = { ...prev };
      pendingTargets.forEach(({ key }) => {
        const previous = prev[key] || {};
        if (previous.loading && !previous.resolved) {
          return;
        }
        next[key] = { ...previous, loading: true, resolved: false, hasPublishedRevision: false };
        hasChanges = true;
      });
      return hasChanges ? next : prev;
    });

    (async () => {
      const results = await Promise.all(pendingTargets.map(async ({ key, nodeId: targetNodeId, senseId }) => {
        try {
          const data = await senseArticleApi.getOverview(targetNodeId, senseId);
          return {
            key,
            hasPublishedRevision: !!data?.currentRevision?._id,
            articleId: data?.article?._id || '',
            currentRevisionId: data?.article?.currentRevisionId || data?.currentRevision?._id || ''
          };
        } catch (_error) {
          return {
            key,
            hasPublishedRevision: false,
            articleId: '',
            currentRevisionId: ''
          };
        }
      }));
      setSenseArticleEntryStatusMap((prev) => {
        const next = { ...prev };
        results.forEach((item) => {
          next[item.key] = {
            loading: false,
            resolved: true,
            hasPublishedRevision: !!item.hasPublishedRevision,
            articleId: item.articleId || '',
            currentRevisionId: item.currentRevisionId || ''
          };
        });
        return next;
      });
    })();
    return undefined;
  }, [
    currentNodeDetail,
    currentTitleDetail,
    isSenseSelectorVisible,
    senseSelectorOverviewNode,
    senseSelectorSourceNode,
    setSenseArticleEntryStatusMap
  ]);

  return {
    updateSenseSelectorAnchorBySceneNode,
    handleHomeDomainActivate
  };
};

export default useSenseSelector;
