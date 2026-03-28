import { useCallback } from 'react';
import {
  isTitleBattleView,
  normalizeObjectId
} from '../../app/appShared';

const useKnowledgeDomainTransition = ({
  view,
  currentNodeDetail,
  currentTitleDetail,
  trackRecentDomain,
  knowledgeDomainReturnContextRef,
  sceneManagerRef,
  setKnowledgeDomainMode,
  setKnowledgeDomainNode,
  setIsTransitioningToDomain,
  setShowNodeInfoModal,
  setTitleRelationInfo,
  setIsSenseSelectorVisible,
  setShowKnowledgeDomain,
  setDomainTransitionProgress,
  fetchTitleDetail,
  fetchNodeDetail
}) => {
  const handleEnterKnowledgeDomain = useCallback((node, options = {}) => {
    if (!sceneManagerRef.current || !node) return;
    const mode = options?.mode === 'intelHeist' ? 'intelHeist' : 'normal';

    const recentVisitMode = options?.recentVisitMode === 'title' || options?.recentVisitMode === 'sense'
      ? options.recentVisitMode
      : (isTitleBattleView(view) ? 'title' : 'sense');
    const recentVisitSenseId = recentVisitMode === 'sense'
      ? (typeof options?.recentVisitSenseId === 'string'
        ? options.recentVisitSenseId.trim()
        : (typeof node?.activeSenseId === 'string' ? node.activeSenseId : ''))
      : '';
    trackRecentDomain(node, {
      mode: recentVisitMode,
      senseId: recentVisitSenseId
    });
    knowledgeDomainReturnContextRef.current = (() => {
      const currentNodeId = normalizeObjectId(currentNodeDetail?._id);
      const currentTitleId = normalizeObjectId(currentTitleDetail?._id);
      const targetNodeId = normalizeObjectId(node?._id);
      if (view === 'nodeDetail' && currentNodeId) {
        return {
          view: 'nodeDetail',
          nodeId: currentNodeId,
          senseId: typeof currentNodeDetail?.activeSenseId === 'string' ? currentNodeDetail.activeSenseId : ''
        };
      }
      if (view === 'titleDetail' && currentTitleId) {
        return {
          view: 'titleDetail',
          nodeId: currentTitleId,
          senseId: ''
        };
      }
      if (!targetNodeId) return null;
      return {
        view: 'nodeDetail',
        nodeId: targetNodeId,
        senseId: typeof node?.activeSenseId === 'string' ? node.activeSenseId : ''
      };
    })();
    setKnowledgeDomainMode(mode);
    setKnowledgeDomainNode(node);
    setIsTransitioningToDomain(true);
    setShowNodeInfoModal(false);
    setTitleRelationInfo(null);
    setIsSenseSelectorVisible(false);

    sceneManagerRef.current.enterKnowledgeDomain(
      () => {
        setShowKnowledgeDomain(true);
        setIsTransitioningToDomain(false);
        setDomainTransitionProgress(1);
      },
      (progress) => {
        setDomainTransitionProgress(progress);
      }
    );
  }, [
    currentNodeDetail,
    currentTitleDetail,
    knowledgeDomainReturnContextRef,
    sceneManagerRef,
    setDomainTransitionProgress,
    setIsSenseSelectorVisible,
    setIsTransitioningToDomain,
    setKnowledgeDomainMode,
    setKnowledgeDomainNode,
    setShowKnowledgeDomain,
    setShowNodeInfoModal,
    setTitleRelationInfo,
    trackRecentDomain,
    view
  ]);

  const handleExitKnowledgeDomain = useCallback((options = {}) => {
    const exitReason = options?.reason || '';
    const exitMessage = typeof options?.message === 'string' ? options.message : '';
    const returnContext = knowledgeDomainReturnContextRef.current;
    const restoreKnowledgeDomainView = async () => {
      if (!returnContext?.nodeId) return;
      if (returnContext.view === 'titleDetail') {
        await fetchTitleDetail(returnContext.nodeId, null, {
          silent: true,
          requestSource: 'knowledge-domain-restore:title'
        });
        return;
      }
      await fetchNodeDetail(returnContext.nodeId, null, {
        silent: true,
        activeSenseId: typeof returnContext.senseId === 'string' ? returnContext.senseId : '',
        requestSource: 'knowledge-domain-restore:sense'
      });
    };
    if (!sceneManagerRef.current) {
      setShowKnowledgeDomain(false);
      setDomainTransitionProgress(0);
      setKnowledgeDomainNode(null);
      setKnowledgeDomainMode('normal');
      knowledgeDomainReturnContextRef.current = null;
      restoreKnowledgeDomainView();
      if (exitMessage) {
        window.alert(exitMessage);
      } else if (exitReason === 'intel-timeout') {
        window.alert('情报窃取时间耗尽');
      }
      return;
    }

    setIsTransitioningToDomain(true);

    sceneManagerRef.current.exitKnowledgeDomain(
      () => {
        setShowKnowledgeDomain(false);
      },
      (progress) => {
        setDomainTransitionProgress(progress);
      },
      () => {
        setIsTransitioningToDomain(false);
        setDomainTransitionProgress(0);
        setKnowledgeDomainNode(null);
        setKnowledgeDomainMode('normal');
        knowledgeDomainReturnContextRef.current = null;
        restoreKnowledgeDomainView();
        if (exitMessage) {
          window.alert(exitMessage);
        } else if (exitReason === 'intel-timeout') {
          window.alert('情报窃取时间耗尽');
        }
      }
    );
  }, [
    fetchNodeDetail,
    fetchTitleDetail,
    knowledgeDomainReturnContextRef,
    sceneManagerRef,
    setDomainTransitionProgress,
    setIsTransitioningToDomain,
    setKnowledgeDomainMode,
    setKnowledgeDomainNode,
    setShowKnowledgeDomain
  ]);

  return {
    handleEnterKnowledgeDomain,
    handleExitKnowledgeDomain
  };
};

export default useKnowledgeDomainTransition;
