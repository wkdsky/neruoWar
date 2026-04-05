import { useEffect } from 'react';
import {
  PAGE_STATE_STORAGE_KEY,
  isDevEnvironment,
  isSenseArticleSubView,
  normalizeObjectId,
  readSavedPageState
} from '../../app/appShared';

const useAppPageState = ({
  authenticated,
  showLocationModal,
  isAdmin,
  view,
  showKnowledgeDomain,
  isTransitioningToDomain,
  knowledgeDomainNode,
  currentNodeDetail,
  currentTitleDetail,
  hasRestoredPageRef,
  isRestoringPageRef,
  fetchTitleDetail,
  fetchNodeDetail,
  setView,
  setKnowledgeDomainNode,
  setShowKnowledgeDomain,
  setIsTransitioningToDomain,
  setDomainTransitionProgress
}) => {
  useEffect(() => {
    if (!authenticated || showLocationModal || hasRestoredPageRef.current) return;

    const saved = readSavedPageState();
    if (!saved?.view || saved.view === 'home') {
      hasRestoredPageRef.current = true;
      return;
    }

    if (saved.view === 'trainingGround') {
      localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
      setView('home');
      hasRestoredPageRef.current = true;
      return;
    }

    isRestoringPageRef.current = true;

    const restorePage = async () => {
      const targetView = saved.view;
      const targetNodeId = normalizeObjectId(saved.nodeId);

      if ((targetView === 'nodeDetail' || targetView === 'knowledgeDomain' || targetView === 'titleDetail') && targetNodeId) {
        const restoredNode = targetView === 'titleDetail'
          ? await fetchTitleDetail(targetNodeId, null, { silent: true })
          : await fetchNodeDetail(targetNodeId, null, { silent: true });
        if (!restoredNode) {
          localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
          setView('home');
          return;
        }

        if (targetView === 'knowledgeDomain') {
          setKnowledgeDomainNode(restoredNode);
          setShowKnowledgeDomain(true);
          setIsTransitioningToDomain(false);
          setDomainTransitionProgress(1);
        }
        return;
      }

      if (targetView === 'alliance' || targetView === 'profile' || targetView === 'home') {
        setView(targetView);
        return;
      }

      if ((targetView === 'army' || targetView === 'equipment' || targetView === 'trainingGround') && !isAdmin) {
        setView(targetView);
        return;
      }

      if (targetView === 'admin' && isAdmin) {
        setView('admin');
        return;
      }

      setView('home');
    };

    restorePage()
      .finally(() => {
        hasRestoredPageRef.current = true;
        isRestoringPageRef.current = false;
      });
  }, [
    authenticated,
    fetchNodeDetail,
    fetchTitleDetail,
    hasRestoredPageRef,
    isAdmin,
    isRestoringPageRef,
    setDomainTransitionProgress,
    setIsTransitioningToDomain,
    setKnowledgeDomainNode,
    setShowKnowledgeDomain,
    setView,
    showLocationModal
  ]);

  useEffect(() => {
    if (!authenticated || showLocationModal || isRestoringPageRef.current) return;

    const currentView = (showKnowledgeDomain || isTransitioningToDomain) ? 'knowledgeDomain' : view;
    if (currentView === 'trainingGround' || String(currentView).startsWith('senseArticle')) {
      localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
      return;
    }
    const nodeId = normalizeObjectId(
      currentView === 'knowledgeDomain'
        ? (knowledgeDomainNode?._id || currentTitleDetail?._id || currentNodeDetail?._id)
        : (
          currentView === 'titleDetail'
            ? currentTitleDetail?._id
            : (currentView === 'nodeDetail' ? currentNodeDetail?._id : '')
        )
    );

    localStorage.setItem(PAGE_STATE_STORAGE_KEY, JSON.stringify({
      view: currentView,
      nodeId,
      updatedAt: Date.now()
    }));
  }, [
    authenticated,
    currentNodeDetail,
    currentTitleDetail,
    isTransitioningToDomain,
    isRestoringPageRef,
    knowledgeDomainNode,
    showKnowledgeDomain,
    showLocationModal,
    view
  ]);

  useEffect(() => {
    if (!authenticated || showLocationModal || isRestoringPageRef.current) return;
    if (view === 'login') return;

    const isKnownView = ['home', 'nodeDetail', 'titleDetail', 'alliance', 'admin', 'profile', 'army', 'equipment', 'trainingGround', 'jinzhi'].includes(view)
      || isSenseArticleSubView(view);
    if (!isKnownView) {
      if (isDevEnvironment) {
        console.debug('[view-guard] fallback to home: unknown view', { view, reason: 'unknown_view' });
      }
      setView('home');
      return;
    }

    if (view === 'admin' && !isAdmin) {
      setView('home');
      return;
    }

    if ((view === 'army' || view === 'equipment' || view === 'trainingGround') && isAdmin) {
      setView('home');
      return;
    }

    if (view === 'nodeDetail' && !currentNodeDetail && hasRestoredPageRef.current) {
      setView('home');
    }
    if (view === 'titleDetail' && !currentTitleDetail && hasRestoredPageRef.current) {
      setView('home');
    }
  }, [
    authenticated,
    currentNodeDetail,
    currentTitleDetail,
    hasRestoredPageRef,
    isAdmin,
    isRestoringPageRef,
    setView,
    showLocationModal,
    view
  ]);
};

export default useAppPageState;
