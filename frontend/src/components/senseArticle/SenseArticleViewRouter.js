import React from 'react';
import SenseArticlePage from './SenseArticlePage';
import SenseArticleEditor from './SenseArticleEditor';
import SenseArticleReviewPage from './SenseArticleReviewPage';
import SenseArticleHistoryPage from './SenseArticleHistoryPage';
import SenseArticleDashboardPage from './SenseArticleDashboardPage';
import SenseArticleErrorBoundary from './SenseArticleErrorBoundary';

const buildRevisionSubViewPatch = (articleContext = null, revision = null) => ({
  nodeId: revision?.nodeId || articleContext?.nodeId || '',
  senseId: revision?.senseId || articleContext?.senseId || '',
  selectedRevisionId: revision?._id || '',
  revisionId: revision?._id || ''
});

const SenseArticleViewRouter = ({
  view,
  senseArticleContext,
  patchSenseArticleContext,
  handleSenseArticleBack,
  handleOpenSenseArticleEditor,
  handleOpenSenseArticleHistory,
  handleOpenSenseArticleDashboard,
  handleOpenSenseArticleReview,
  navigateSenseArticleSubView,
  fetchNotifications,
  openSenseArticleView
}) => {
  if (!senseArticleContext?.nodeId) return null;

  const resetKey = `${view}:${senseArticleContext.nodeId}:${senseArticleContext.senseId || ''}:${senseArticleContext.revisionId || senseArticleContext.selectedRevisionId || ''}`;
  const openRevisionSubView = (nextView, revision = null, options = {}) => {
    navigateSenseArticleSubView(nextView, buildRevisionSubViewPatch(senseArticleContext, revision), options);
  };
  const openArticleWithReturnTarget = (target) => {
    openSenseArticleView(
      { nodeId: target?.nodeId, senseId: target?.senseId },
      { returnTarget: { ...(senseArticleContext || {}), view } }
    );
  };

  if (view === 'senseArticle' && senseArticleContext?.senseId) {
    return (
      <SenseArticleErrorBoundary
        resetKey={resetKey}
        onBack={handleSenseArticleBack}
        title="释义百科页渲染失败"
      >
        <SenseArticlePage
          nodeId={senseArticleContext.nodeId}
          senseId={senseArticleContext.senseId}
          articleContext={senseArticleContext}
          onContextPatch={patchSenseArticleContext}
          onBack={handleSenseArticleBack}
          onOpenEditor={handleOpenSenseArticleEditor}
          onOpenHistory={handleOpenSenseArticleHistory}
          onOpenDashboard={handleOpenSenseArticleDashboard}
          onOpenReview={(revision) => handleOpenSenseArticleReview({ revision })}
        />
      </SenseArticleErrorBoundary>
    );
  }

  if (view === 'senseArticleEditor' && senseArticleContext?.senseId) {
    return (
      <SenseArticleErrorBoundary
        resetKey={resetKey}
        onBack={handleSenseArticleBack}
        title="释义编辑页发生异常"
      >
        <SenseArticleEditor
          nodeId={senseArticleContext.nodeId}
          senseId={senseArticleContext.senseId}
          revisionId={senseArticleContext.revisionId || senseArticleContext.selectedRevisionId}
          articleContext={senseArticleContext}
          onContextPatch={patchSenseArticleContext}
          onBack={handleSenseArticleBack}
          onOpenDashboard={handleOpenSenseArticleDashboard}
          onSubmitted={async () => {
            navigateSenseArticleSubView('senseArticle', {
              selectedRevisionId: '',
              revisionId: '',
              revisionStatus: ''
            }, {
              preserveReturnTarget: true,
              preserveOriginArticle: true
            });
            await fetchNotifications(true);
          }}
        />
      </SenseArticleErrorBoundary>
    );
  }

  if (view === 'senseArticleReview' && senseArticleContext?.senseId && senseArticleContext?.revisionId) {
    return (
      <SenseArticleErrorBoundary
        resetKey={resetKey}
        onBack={handleSenseArticleBack}
        title="释义审核页发生异常"
      >
        <SenseArticleReviewPage
          nodeId={senseArticleContext.nodeId}
          senseId={senseArticleContext.senseId}
          revisionId={senseArticleContext.revisionId || senseArticleContext.selectedRevisionId}
          articleContext={senseArticleContext}
          onContextPatch={patchSenseArticleContext}
          onBack={handleSenseArticleBack}
          onOpenDashboard={handleOpenSenseArticleDashboard}
          onReviewed={async (revision) => {
            openRevisionSubView(
              revision?.status === 'published' ? 'senseArticleHistory' : 'senseArticleReview',
              revision,
              {
                preserveReturnTarget: true,
                preserveOriginArticle: true
              }
            );
            await fetchNotifications(true);
          }}
        />
      </SenseArticleErrorBoundary>
    );
  }

  if (view === 'senseArticleHistory' && senseArticleContext?.senseId) {
    return (
      <SenseArticleErrorBoundary
        resetKey={resetKey}
        onBack={handleSenseArticleBack}
        title="释义历史页发生异常"
      >
        <SenseArticleHistoryPage
          nodeId={senseArticleContext.nodeId}
          senseId={senseArticleContext.senseId}
          articleContext={senseArticleContext}
          onContextPatch={patchSenseArticleContext}
          onBack={handleSenseArticleBack}
          onOpenDashboard={handleOpenSenseArticleDashboard}
          onOpenRevision={(revision) => handleOpenSenseArticleReview({ revision })}
          onEditRevision={(revision) => openRevisionSubView('senseArticleEditor', revision)}
        />
      </SenseArticleErrorBoundary>
    );
  }

  if (view === 'senseArticleDashboard') {
    return (
      <SenseArticleErrorBoundary
        resetKey={resetKey}
        onBack={handleSenseArticleBack}
        title="词条管理页面发生异常"
      >
        <SenseArticleDashboardPage
          nodeId={senseArticleContext.nodeId}
          articleContext={senseArticleContext}
          onContextPatch={patchSenseArticleContext}
          onBack={handleSenseArticleBack}
          onOpenReview={(revision) => openRevisionSubView('senseArticleReview', revision)}
          onOpenHistory={(revision) => openRevisionSubView('senseArticleHistory', revision)}
          onEditRevision={(revision) => openRevisionSubView('senseArticleEditor', revision)}
          onOpenArticle={openArticleWithReturnTarget}
        />
      </SenseArticleErrorBoundary>
    );
  }

  return null;
};

export default SenseArticleViewRouter;
