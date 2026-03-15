import { useCallback } from 'react';
import {
  buildSenseArticleNavigationState,
  createSenseArticleContext,
  resolveSenseArticleBackTarget,
  resolveSenseArticleNotificationNavigation
} from '../senseArticleNavigation';
import { senseArticleApi } from '../../../utils/senseArticleApi';
import {
  getNodeSenseArticleTarget,
  isDevEnvironment,
  normalizeObjectId
} from '../../../app/appShared';

const useSenseArticleNavigation = ({
  view,
  setView,
  senseArticleContext,
  setSenseArticleContext,
  currentNodeDetail,
  currentTitleDetail,
  senseSelectorSourceNode,
  setShowNodeInfoModal,
  setNodeInfoModalTarget,
  setIsSenseSelectorVisible,
  prepareHomeDetailTransitionTarget,
  cancelHomeDetailTransition,
  buildClickedNodeFromScene,
  fetchTitleDetail,
  fetchNodeDetail,
  navigateToHomeWithDockCollapse,
  navigateSenseArticleSubView,
  markNotificationRead
}) => {
  const resolveSenseSelectorNode = useCallback(() => {
    if (view === 'titleDetail' && currentTitleDetail) return currentTitleDetail;
    if (view === 'nodeDetail' && currentNodeDetail) return currentNodeDetail;
    if (senseSelectorSourceNode) return senseSelectorSourceNode;
    return null;
  }, [currentNodeDetail, currentTitleDetail, senseSelectorSourceNode, view]);

  const handleSwitchTitleView = useCallback(async () => {
    const selectorNode = resolveSenseSelectorNode();
    const nodeId = normalizeObjectId(selectorNode?._id);
    if (!nodeId) return;
    if (view === 'titleDetail' && normalizeObjectId(currentTitleDetail?._id) === nodeId) {
      setIsSenseSelectorVisible(false);
      return;
    }
    if (typeof prepareHomeDetailTransitionTarget === 'function') {
      prepareHomeDetailTransitionTarget({
        mode: 'titleDetail',
        nodeId,
        senseId: ''
      });
    }
    // 先收起 selector，再让 ghost/目标视图接管，避免旧面板在过渡中残留。
    setIsSenseSelectorVisible(false);
    const clickedNode = buildClickedNodeFromScene(nodeId);
    const nextNode = await fetchTitleDetail(nodeId, clickedNode, {
      relationHint: 'jump'
    });
    if (!nextNode && typeof cancelHomeDetailTransition === 'function') {
      cancelHomeDetailTransition();
    }
  }, [
    buildClickedNodeFromScene,
    cancelHomeDetailTransition,
    currentTitleDetail,
    fetchTitleDetail,
    prepareHomeDetailTransitionTarget,
    resolveSenseSelectorNode,
    setIsSenseSelectorVisible,
    view
  ]);

  const handleSwitchSenseView = useCallback(async (senseId) => {
    const selectorNode = resolveSenseSelectorNode();
    const nodeId = normalizeObjectId(selectorNode?._id);
    const nextSenseId = typeof senseId === 'string' ? senseId.trim() : '';
    if (!nodeId || !nextSenseId) return;
    if (
      view === 'nodeDetail'
      && normalizeObjectId(currentNodeDetail?._id) === nodeId
      && currentNodeDetail?.activeSenseId === nextSenseId
    ) {
      setIsSenseSelectorVisible(false);
      return;
    }
    if (typeof prepareHomeDetailTransitionTarget === 'function') {
      prepareHomeDetailTransitionTarget({
        mode: 'nodeDetail',
        nodeId,
        senseId: nextSenseId
      });
    }
    // 同步关闭 selector，让跨层过渡从用户确认那一刻开始。
    setIsSenseSelectorVisible(false);
    const clickedNode = buildClickedNodeFromScene(nodeId);
    const nextNode = await fetchNodeDetail(nodeId, clickedNode, {
      relationHint: 'jump',
      activeSenseId: nextSenseId
    });
    if (!nextNode && typeof cancelHomeDetailTransition === 'function') {
      cancelHomeDetailTransition();
    }
  }, [
    buildClickedNodeFromScene,
    cancelHomeDetailTransition,
    currentNodeDetail,
    fetchNodeDetail,
    prepareHomeDetailTransitionTarget,
    resolveSenseSelectorNode,
    setIsSenseSelectorVisible,
    view
  ]);

  const openSenseArticleView = useCallback((target = {}, options = {}) => {
    const nextContext = buildSenseArticleNavigationState({
      target,
      options,
      currentView: view,
      currentContext: senseArticleContext,
      currentNodeId: normalizeObjectId(currentNodeDetail?._id),
      currentTitleId: normalizeObjectId(currentTitleDetail?._id)
    });
    if (!nextContext) return;
    setShowNodeInfoModal(false);
    setNodeInfoModalTarget(null);
    setIsSenseSelectorVisible(false);
    setSenseArticleContext(nextContext);
    setView(options.view || 'senseArticle');
  }, [
    currentNodeDetail,
    currentTitleDetail,
    senseArticleContext,
    setIsSenseSelectorVisible,
    setNodeInfoModalTarget,
    setSenseArticleContext,
    setShowNodeInfoModal,
    setView,
    view
  ]);

  const openSenseArticleFromNode = useCallback((node, options = {}) => {
    const target = getNodeSenseArticleTarget(node, options.senseId);
    if (!target) {
      window.alert('当前节点没有可打开的释义百科页');
      return;
    }
    openSenseArticleView(target, options);
  }, [openSenseArticleView]);

  const resolveEditableSenseArticleRevision = useCallback(async (nodeId, senseId) => {
    const data = await senseArticleApi.getMyEdits(nodeId, senseId, { limit: 50 }, { view: 'senseArticlePage' });
    return {
      articleId: data?.article?._id || '',
      currentRevisionId: data?.article?.currentRevisionId || '',
      revision: data?.activeFullDraft || null
    };
  }, []);

  const handleSenseArticleBack = useCallback(async (payload = null) => {
    if (payload?.action === 'openArticle') {
      openSenseArticleView({ nodeId: payload.nodeId, senseId: payload.senseId }, {
        originView: 'senseArticle',
        sourceHint: payload.sourceHint || '',
        returnTarget: { ...(senseArticleContext || {}), view }
      });
      return;
    }
    const backTarget = resolveSenseArticleBackTarget({ context: senseArticleContext });
    if (backTarget.kind === 'article' && backTarget.context) {
      if (payload?.action === 'returnFromEditor' && (payload?.hasPersistedDraftSave || payload?.wasDiscarded)) {
        setSenseArticleContext(createSenseArticleContext({
          ...backTarget.context,
          myEditsRefreshKey: Date.now(),
          draftReturnRevisionId: payload?.wasDiscarded ? '' : normalizeObjectId(payload?.revisionId),
          draftReturnState: payload?.wasDiscarded ? 'discarded' : 'saved'
        }, backTarget.context));
      } else {
        setSenseArticleContext(backTarget.context);
      }
      setView(backTarget.view || 'senseArticle');
      return;
    }
    if (backTarget.view === 'titleDetail' && currentTitleDetail) {
      setView('titleDetail');
      return;
    }
    if (backTarget.view === 'nodeDetail' && currentNodeDetail) {
      setView('nodeDetail');
      return;
    }
    if (backTarget.view === 'home') {
      await navigateToHomeWithDockCollapse();
      return;
    }
    await navigateToHomeWithDockCollapse();
  }, [
    currentNodeDetail,
    currentTitleDetail,
    navigateToHomeWithDockCollapse,
    openSenseArticleView,
    senseArticleContext,
    setSenseArticleContext,
    setView,
    view
  ]);

  const handleOpenSenseArticleEditor = useCallback(async ({
    mode = 'full',
    anchor = null,
    headingId = '',
    preferExisting = false,
    revisionId = ''
  } = {}) => {
    const targetNodeId = normalizeObjectId(senseArticleContext?.nodeId);
    const targetSenseId = typeof senseArticleContext?.senseId === 'string' ? senseArticleContext.senseId.trim() : '';
    if (!targetNodeId || !targetSenseId) return;
    try {
      let data = null;
      const shouldPreferExisting = !!preferExisting || mode === 'full';
      const requestedRevisionId = normalizeObjectId(revisionId);
      if (requestedRevisionId) {
        navigateSenseArticleSubView('senseArticleEditor', {
          nodeId: targetNodeId,
          senseId: targetSenseId,
          articleId: senseArticleContext?.articleId || '',
          currentRevisionId: senseArticleContext?.currentRevisionId || '',
          selectedRevisionId: requestedRevisionId,
          revisionId: requestedRevisionId,
          draftLaunchMode: 'explicit'
        });
        return;
      }
      if (mode === 'full') {
        navigateSenseArticleSubView('senseArticleEditor', {
          nodeId: targetNodeId,
          senseId: targetSenseId,
          articleId: senseArticleContext?.articleId || '',
          currentRevisionId: senseArticleContext?.currentRevisionId || '',
          selectedRevisionId: '',
          revisionId: '',
          draftLaunchMode: 'pending_full'
        });
        return;
      }
      if (shouldPreferExisting) {
        const existing = await resolveEditableSenseArticleRevision(targetNodeId, targetSenseId);
        if (existing?.revision?._id) {
          navigateSenseArticleSubView('senseArticleEditor', {
            nodeId: targetNodeId,
            senseId: targetSenseId,
            articleId: existing.articleId || senseArticleContext?.articleId || '',
            currentRevisionId: existing.currentRevisionId || senseArticleContext?.currentRevisionId || '',
            selectedRevisionId: existing.revision._id,
            revisionId: existing.revision._id,
            draftLaunchMode: 'reused'
          });
          return;
        }
      }
      if (mode === 'selection') {
        data = await senseArticleApi.createFromSelection(targetNodeId, targetSenseId, {
          selectedRangeAnchor: anchor,
          proposerNote: '从阅读页选段发起修订',
          contentFormat: 'rich_html'
        });
      } else if (mode === 'heading') {
        data = await senseArticleApi.createFromHeading(targetNodeId, targetSenseId, {
          targetHeadingId: headingId,
          proposerNote: headingId ? ('从小节 ' + headingId + ' 发起修订') : '从小节发起修订',
          contentFormat: 'rich_html'
        });
      } else {
        data = await senseArticleApi.createDraft(targetNodeId, targetSenseId, {
          proposerNote: '整页百科修订草稿',
          contentFormat: 'rich_html'
        });
      }
      navigateSenseArticleSubView('senseArticleEditor', {
        nodeId: targetNodeId,
        senseId: targetSenseId,
        articleId: data?.article?._id || senseArticleContext?.articleId || '',
        currentRevisionId: data?.article?.currentRevisionId || senseArticleContext?.currentRevisionId || '',
        selectedRevisionId: data?.revision?._id || '',
        revisionId: data?.revision?._id || '',
        draftLaunchMode: mode === 'full' ? 'created' : 'explicit'
      });
    } catch (error) {
      window.alert(error.message);
    }
  }, [navigateSenseArticleSubView, resolveEditableSenseArticleRevision, senseArticleContext]);

  const handleOpenSenseArticleHistory = useCallback(() => {
    if (!senseArticleContext?.nodeId || !senseArticleContext?.senseId) return;
    navigateSenseArticleSubView('senseArticleHistory');
  }, [navigateSenseArticleSubView, senseArticleContext]);

  const handleOpenSenseArticleDashboard = useCallback(() => {
    const targetNodeId = normalizeObjectId(senseArticleContext?.nodeId);
    const targetSenseId = typeof senseArticleContext?.senseId === 'string' ? senseArticleContext.senseId.trim() : '';
    if (!targetNodeId) return;
    if (isDevEnvironment) {
      console.debug('[sense-article] open dashboard', {
        currentView: view,
        nextView: 'senseArticleDashboard',
        nodeId: targetNodeId,
        senseId: targetSenseId
      });
    }
    navigateSenseArticleSubView('senseArticleDashboard', {
      nodeId: targetNodeId,
      senseId: targetSenseId
    });
  }, [navigateSenseArticleSubView, senseArticleContext, view]);

  const handleOpenSenseArticleReview = useCallback(async ({ latest = false, revision = null } = {}) => {
    const targetNodeId = normalizeObjectId(senseArticleContext?.nodeId);
    const targetSenseId = typeof senseArticleContext?.senseId === 'string' ? senseArticleContext.senseId.trim() : '';
    if (!targetNodeId || !targetSenseId) return;
    let targetRevisionId = revision?._id || revision?.revisionId || senseArticleContext?.revisionId || '';
    if (latest || !targetRevisionId) {
      try {
        const data = await senseArticleApi.getRevisions(targetNodeId, targetSenseId, { pageSize: 20 });
        const revisions = Array.isArray(data?.revisions) ? data.revisions : [];
        const preferred = revisions.find((item) => (
          item.status === 'pending_review'
          || item.status === 'pending_domain_admin_review'
          || item.status === 'pending_domain_master_review'
        )) || revisions[0];
        targetRevisionId = preferred?._id || '';
      } catch (error) {
        window.alert(error.message);
        return;
      }
    }
    if (!targetRevisionId) {
      window.alert('当前没有可审阅的修订');
      return;
    }
    navigateSenseArticleSubView('senseArticleReview', {
      nodeId: targetNodeId,
      senseId: targetSenseId,
      selectedRevisionId: targetRevisionId,
      revisionId: targetRevisionId
    });
  }, [navigateSenseArticleSubView, senseArticleContext]);

  const handleSenseArticleNotificationClick = useCallback(async (notification) => {
    const navigation = resolveSenseArticleNotificationNavigation(notification);
    if (!navigation) return;
    if (!notification.read && notification._id) {
      await markNotificationRead(notification._id);
    }
    openSenseArticleView(navigation.target, navigation.options);
  }, [markNotificationRead, openSenseArticleView]);

  return {
    openSenseArticleView,
    openSenseArticleFromNode,
    handleSenseArticleBack,
    handleOpenSenseArticleDashboard,
    handleOpenSenseArticleEditor,
    handleOpenSenseArticleHistory,
    handleOpenSenseArticleReview,
    handleSenseArticleNotificationClick,
    handleSwitchSenseView,
    handleSwitchTitleView
  };
};

export default useSenseArticleNavigation;
