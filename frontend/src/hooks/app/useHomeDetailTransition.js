import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isKnowledgeDetailView,
  normalizeObjectId
} from '../../app/appShared';

const clampRevealProgress = (value) => Math.max(0.04, Math.min(1, Number(value) || 0));

const createIdleHomeTransition = () => ({
  runId: 0,
  sourceRect: null,
  sourceCenter: null,
  sourceSize: null,
  sourceTitle: '',
  sourceSenseTitle: '',
  sourceSummary: '',
  sourceVariant: 'root',
  sourceNodeId: '',
  targetMode: '',
  targetNodeId: '',
  targetSenseId: '',
  targetCenter: null,
  targetSize: 0,
  targetLayoutNodeId: '',
  status: 'idle',
  triggeredAt: 0
});

const useHomeDetailTransition = ({
  featuredNodes,
  isWebGLReady,
  sceneManagerRef,
  webglCanvasRef,
  view,
  currentTitleDetail,
  currentNodeDetail,
  isSenseSelectorVisible
}) => {
  const [homeDetailTransition, setHomeDetailTransition] = useState(createIdleHomeTransition);
  const homeDetailTransitionRef = useRef(createIdleHomeTransition());
  const homeDetailTransitionRunIdRef = useRef(0);

  useEffect(() => {
    homeDetailTransitionRef.current = homeDetailTransition;
  }, [homeDetailTransition]);

  const clearHomeDetailTransition = useCallback((options = {}) => {
    const immediate = options?.immediate === true;
    const current = homeDetailTransitionRef.current;
    if (sceneManagerRef.current?.renderer && current?.targetLayoutNodeId) {
      sceneManagerRef.current.renderer.setNodeRevealProgress('', 1);
    }
    if (immediate) {
      setHomeDetailTransition(createIdleHomeTransition());
      return;
    }
    setHomeDetailTransition((prev) => {
      if (!prev || prev.status === 'idle') return createIdleHomeTransition();
      return {
        ...prev,
        status: 'done'
      };
    });
    window.setTimeout(() => {
      if (homeDetailTransitionRef.current?.status === 'done') {
        setHomeDetailTransition(createIdleHomeTransition());
      }
    }, 150);
  }, [sceneManagerRef]);

  const resolveHomeNodeVariant = useCallback((nodeId) => {
    const normalized = normalizeObjectId(nodeId);
    if (!normalized) return 'root';
    if (featuredNodes.some((item) => normalizeObjectId(item?._id) === normalized)) return 'featured';
    return 'root';
  }, [featuredNodes]);

  const armHomeDetailTransition = useCallback((node, anchorElement = null) => {
    const rect = anchorElement?.getBoundingClientRect?.();
    const nodeId = normalizeObjectId(node?._id);
    if (!rect || !nodeId) {
      clearHomeDetailTransition({ immediate: true });
      return;
    }
    homeDetailTransitionRunIdRef.current += 1;
    setHomeDetailTransition({
      runId: homeDetailTransitionRunIdRef.current,
      sourceRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      },
      sourceCenter: {
        x: rect.left + rect.width * 0.5,
        y: rect.top + rect.height * 0.5
      },
      sourceSize: {
        width: rect.width,
        height: rect.height
      },
      sourceTitle: typeof node?.name === 'string' ? node.name.trim() : '',
      sourceSenseTitle: typeof node?.activeSenseTitle === 'string' ? node.activeSenseTitle.trim() : '',
      sourceSummary: typeof node?.description === 'string' ? node.description.trim() : '',
      sourceVariant: resolveHomeNodeVariant(nodeId),
      sourceNodeId: nodeId,
      targetMode: '',
      targetNodeId: '',
      targetSenseId: '',
      targetCenter: null,
      targetSize: 0,
      targetLayoutNodeId: '',
      status: 'armed',
      triggeredAt: Date.now()
    });
  }, [clearHomeDetailTransition, resolveHomeNodeVariant]);

  const prepareHomeDetailTransitionTarget = useCallback(({ mode = '', nodeId = '', senseId = '' } = {}) => {
    const normalizedNodeId = normalizeObjectId(nodeId);
    if (!normalizedNodeId) return;
    setHomeDetailTransition((prev) => {
      if (!prev || prev.status === 'idle' || !prev.sourceRect) return prev;
      return {
        ...prev,
        targetMode: mode === 'titleDetail' ? 'titleDetail' : 'nodeDetail',
        targetNodeId: normalizedNodeId,
        targetSenseId: typeof senseId === 'string' ? senseId.trim() : '',
        targetCenter: null,
        targetSize: 0,
        targetLayoutNodeId: '',
        status: 'navigating'
      };
    });
  }, []);

  const updateHomeTransitionReveal = useCallback((runId, progress = 1) => {
    const current = homeDetailTransitionRef.current;
    if (!current || current.runId !== runId) return;
    if (!current.targetLayoutNodeId) return;
    if (!sceneManagerRef.current?.renderer) return;
    sceneManagerRef.current.renderer.setNodeRevealProgress(
      current.targetLayoutNodeId,
      clampRevealProgress(progress)
    );
  }, [sceneManagerRef]);

  const handleGhostStatusChange = useCallback((runId, status) => {
    setHomeDetailTransition((prev) => {
      if (!prev || prev.runId !== runId || prev.status === 'idle') return prev;
      if (prev.status === status) return prev;
      return {
        ...prev,
        status
      };
    });
  }, []);

  const handleGhostSettleProgress = useCallback((runId, progress) => {
    const current = homeDetailTransitionRef.current;
    if (!current || current.runId !== runId) return;
    updateHomeTransitionReveal(runId, progress);
  }, [updateHomeTransitionReveal]);

  const handleGhostSettleComplete = useCallback((runId) => {
    const current = homeDetailTransitionRef.current;
    if (!current || current.runId !== runId) return;
    if (current.targetLayoutNodeId && sceneManagerRef.current?.renderer) {
      sceneManagerRef.current.renderer.setNodeRevealProgress(current.targetLayoutNodeId, 1);
    }
    clearHomeDetailTransition();
  }, [clearHomeDetailTransition, sceneManagerRef]);

  useEffect(() => {
    const transition = homeDetailTransitionRef.current;
    if (!transition || transition.status !== 'navigating') return undefined;
    if (!isWebGLReady || !sceneManagerRef.current || !webglCanvasRef.current) return undefined;
    if (!isKnowledgeDetailView(view)) return undefined;
    if (transition.targetMode && transition.targetMode !== view) return undefined;

    const targetNodeId = normalizeObjectId(transition.targetNodeId);
    const activeNodeId = view === 'titleDetail'
      ? normalizeObjectId(currentTitleDetail?._id)
      : normalizeObjectId(currentNodeDetail?._id);
    if (!targetNodeId || !activeNodeId || targetNodeId !== activeNodeId) return undefined;

    let rafId = 0;
    let attempts = 0;
    let cancelled = false;
    const locateTarget = () => {
      if (cancelled) return;
      const sceneManager = sceneManagerRef.current;
      const renderer = sceneManager?.renderer;
      const canvas = webglCanvasRef.current;
      const centerNode = Array.isArray(sceneManager?.currentLayout?.nodes)
        ? sceneManager.currentLayout.nodes.find((item) => (
          item?.type === 'center'
          && normalizeObjectId(item?.data?._id) === targetNodeId
        ))
        : null;

      if (!renderer || !canvas || !centerNode) {
        attempts += 1;
        if (attempts < 36) {
          rafId = requestAnimationFrame(locateTarget);
        } else {
          clearHomeDetailTransition({ immediate: true });
        }
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const screenPos = renderer.worldToScreen(centerNode.x, centerNode.y);
      const radius = typeof renderer.getNodeScreenRadius === 'function'
        ? renderer.getNodeScreenRadius(centerNode)
        : Math.max(48, Number(centerNode.radius) || 80);
      renderer.setNodeRevealProgress(centerNode.id, 0.04);
      setHomeDetailTransition((prev) => {
        if (!prev || prev.runId !== transition.runId) return prev;
        return {
          ...prev,
          targetCenter: {
            x: Math.round(rect.left + screenPos.x),
            y: Math.round(rect.top + screenPos.y)
          },
          targetSize: Math.max(112, radius * 2.32),
          targetLayoutNodeId: centerNode.id,
          status: 'target-ready'
        };
      });
    };

    rafId = requestAnimationFrame(locateTarget);
    return () => {
      cancelled = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [
    clearHomeDetailTransition,
    currentNodeDetail?._id,
    currentTitleDetail?._id,
    isWebGLReady,
    sceneManagerRef,
    view,
    webglCanvasRef
  ]);

  useEffect(() => {
    const status = homeDetailTransition.status;
    if (view === 'home' && !isSenseSelectorVisible && status === 'armed') {
      clearHomeDetailTransition({ immediate: true });
      return;
    }
    if (status === 'idle' || status === 'done') return;
    if (view !== 'home' && !isKnowledgeDetailView(view)) {
      clearHomeDetailTransition({ immediate: true });
    }
  }, [clearHomeDetailTransition, homeDetailTransition.status, isSenseSelectorVisible, view]);

  useEffect(() => {
    const status = homeDetailTransition.status;
    if (status === 'idle' || status === 'done') return undefined;
    const handleResize = () => {
      const current = homeDetailTransitionRef.current;
      if (current?.targetLayoutNodeId && sceneManagerRef.current?.renderer) {
        sceneManagerRef.current.renderer.setNodeRevealProgress(current.targetLayoutNodeId, 1);
      }
      clearHomeDetailTransition({ immediate: true });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [clearHomeDetailTransition, homeDetailTransition.status, sceneManagerRef]);

  return {
    homeDetailTransition,
    clearHomeDetailTransition,
    armHomeDetailTransition,
    prepareHomeDetailTransitionTarget,
    handleGhostStatusChange,
    handleGhostSettleProgress,
    handleGhostSettleComplete
  };
};

export default useHomeDetailTransition;
