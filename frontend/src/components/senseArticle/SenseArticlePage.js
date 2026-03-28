import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Eye, History, MessageSquare, PenSquare, Sparkles } from 'lucide-react';
import SenseArticleRenderer from './SenseArticleRenderer';
import SenseArticlePageHeader from './SenseArticlePageHeader';
import SenseArticleStateView from './SenseArticleStateView';
import SenseArticleOutlineTree from './SenseArticleOutlineTree';
import SenseArticleDisplayModeToggle from './SenseArticleDisplayModeToggle';
import { buildSenseArticleThemeStyle } from './senseArticleTheme';
import useSenseArticleDisplayMode from './hooks/useSenseArticleDisplayMode';
import useSenseArticleReadingPageData from './hooks/useSenseArticleReadingPageData';
import useSenseArticleReadingSearch from './hooks/useSenseArticleReadingSearch';
import useSenseArticleSelectionTools from './hooks/useSenseArticleSelectionTools';
import { resolveSenseArticleStateFromError, getRelocationStatusLabel } from './senseArticleUi';
import SenseArticleMyEditsPanel from './reading/SenseArticleMyEditsPanel';
import SenseArticleReadingSearchPanel from './reading/SenseArticleReadingSearchPanel';
import SenseArticleSelectionToolbar from './reading/SenseArticleSelectionToolbar';
import SenseArticleReferencePreview from './reading/SenseArticleReferencePreview';
import { buildMyEditsPanelStyle, resolveArticleAvatarSrc } from './reading/senseArticleReadingUi';
import './SenseArticle.css';

const SenseArticlePage = ({
  nodeId,
  senseId,
  articleContext,
  onContextPatch,
  onBack,
  onOpenEditor,
  onOpenHistory,
  onOpenDashboard,
  onOpenReview
}) => {
  const [myEditsOpen, setMyEditsOpen] = useState(false);
  const [myEditsPanelStyle, setMyEditsPanelStyle] = useState(null);

  const myEditsButtonRef = useRef(null);

  const {
    pageData,
    referenceData,
    referenceMap,
    referencesLoading,
    loading,
    error,
    readingSideData,
    readingSideDataLoading,
    readingSideDataError,
    annotations,
    annotationsByStatus,
    myEditsLoading,
    myEditsError,
    myEdits,
    activeFullDraft,
    abandoningRevisionId,
    loadMyEdits,
    loadCurrentSideData,
    abandonMyEdit
  } = useSenseArticleReadingPageData({
    nodeId,
    senseId,
    articleContext,
    onContextPatch,
    myEditsOpen
  });

  const {
    searchQuery,
    setSearchQuery,
    searchData,
    activeSearchIndex,
    activeSearchMatch,
    isReadingSearchOpen,
    setIsReadingSearchOpen,
    isReadingSearchResultsExpanded,
    setIsReadingSearchResultsExpanded,
    activeHeadingId,
    hasSearchQuery,
    hasSearchResults,
    readingSearchRef,
    readingSearchInputRef,
    jumpToHeading,
    jumpToMatch
  } = useSenseArticleReadingSearch({
    nodeId,
    senseId,
    pageData
  });

  const {
    selectionAnchor,
    annotationDraft,
    setAnnotationDraft,
    annotationSaving,
    referencePreview,
    selectionToolbarRef,
    createAnnotation,
    handleReferenceHover
  } = useSenseArticleSelectionTools({
    nodeId,
    senseId,
    loadCurrentSideData
  });

  const pageThemeStyle = useMemo(() => (
    buildSenseArticleThemeStyle(pageData?.node ? { ...articleContext, node: pageData.node } : articleContext)
  ), [articleContext, pageData]);
  const { displayMode, toggleDisplayMode } = useSenseArticleDisplayMode();

  useEffect(() => {
    if (!myEditsOpen) {
      setMyEditsPanelStyle(null);
      return undefined;
    }

    const syncMyEditsPanelStyle = () => {
      setMyEditsPanelStyle(buildMyEditsPanelStyle(myEditsButtonRef.current));
    };

    syncMyEditsPanelStyle();
    window.addEventListener('resize', syncMyEditsPanelStyle);
    window.addEventListener('scroll', syncMyEditsPanelStyle, true);
    return () => {
      window.removeEventListener('resize', syncMyEditsPanelStyle);
      window.removeEventListener('scroll', syncMyEditsPanelStyle, true);
    };
  }, [myEditsOpen]);

  const handleRefreshMyEdits = useCallback(async () => {
    await loadMyEdits();
  }, [loadMyEdits]);

  const handleOpenFullEditor = useCallback(() => {
    if (!onOpenEditor) return;
    const targetRevisionId = String(activeFullDraft?._id || '').trim();
    onOpenEditor({ mode: 'full', revisionId: targetRevisionId });
  }, [activeFullDraft, onOpenEditor]);

  const handleReferenceClick = useCallback((reference) => {
    if (!reference?.targetNodeId || !reference?.targetSenseId) return;
    onBack && onBack({
      action: 'openArticle',
      nodeId: reference.targetNodeId,
      senseId: reference.targetSenseId,
      sourceHint: reference.displayText || reference.targetTitle || ''
    });
  }, [onBack]);

  const handleResumeMyEdit = useCallback((item) => {
    setMyEditsOpen(false);
    onOpenEditor && onOpenEditor({ revisionId: item._id });
  }, [onOpenEditor]);

  const handleOpenReviewItem = useCallback((item) => {
    setMyEditsOpen(false);
    onOpenReview && onOpenReview(item);
  }, [onOpenReview]);

  if (loading) {
    return (
      <div className="sense-article-page" style={pageThemeStyle}>
        <SenseArticleStateView kind="loading" title="正在加载阅读页" description="正在优先读取当前释义百科页的发布版正文。" />
      </div>
    );
  }

  if (error) {
    const state = resolveSenseArticleStateFromError(error, {
      emptyTitle: '当前释义尚无已发布百科页',
      emptyDescription: '你可以直接创建首个百科版本；已保存的草稿和待审核修订都可在“我的编辑”里查看。',
      forbiddenTitle: '暂无阅读权限',
      errorTitle: '百科页加载失败'
    });
    const action = state.kind === 'empty'
      ? (
        <>
          {onOpenEditor ? (
            <button type="button" className="btn btn-primary" onClick={handleOpenFullEditor}>
              <PenSquare size={16} /> 创建首个百科版本
            </button>
          ) : null}
          {onOpenHistory ? (
            <button type="button" className="btn btn-secondary" onClick={() => onOpenHistory()}>
              <History size={16} /> 历史版本
            </button>
          ) : null}
          <button
            ref={myEditsButtonRef}
            type="button"
            className="btn btn-secondary"
            onClick={() => setMyEditsOpen(true)}
          >
            <Sparkles size={16} /> 我的编辑
          </button>
          <button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>
        </>
      )
      : <button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>;

    return (
      <div className="sense-article-page" style={pageThemeStyle}>
        <SenseArticleMyEditsPanel
          open={myEditsOpen}
          style={myEditsPanelStyle}
          onClose={() => setMyEditsOpen(false)}
          onRefresh={handleRefreshMyEdits}
          loading={myEditsLoading}
          error={myEditsError}
          myEdits={myEdits}
          activeFullDraftId={activeFullDraft?._id || ''}
          pageTitle={senseId}
          onResumeEdit={handleResumeMyEdit}
          onOpenReview={handleOpenReviewItem}
          onAbandon={abandonMyEdit}
          abandoningRevisionId={abandoningRevisionId}
        />
        <SenseArticleStateView {...state} action={action} />
      </div>
    );
  }

  const node = pageData?.node || {};
  const nodeSense = pageData?.nodeSense || {};
  const revision = pageData?.revision || null;
  const permissions = pageData?.permissions || {};
  const readingMeta = readingSideData?.readingMeta || {};
  const revisionAuthor = readingMeta?.revisionAuthor || null;
  const canUpdateSenseArticle = !!permissions.isDomainMaster || !!permissions.canReviewSenseArticle;
  const title = `${node.name || '未命名知识域'}-${nodeSense.title || senseId}`;
  const headingIndex = pageData?.revision?.headingIndex || [];
  const readingMetaItems = [
    revision?.updatedAt ? `最近更新 ${new Date(revision.updatedAt).toLocaleString('zh-CN', { hour12: false })}` : '更新时间 --',
    readingSideDataLoading ? '更新人信息加载中…' : revisionAuthor ? (
      <span className="sense-reading-meta-person">
        <img
          src={resolveArticleAvatarSrc(revisionAuthor.avatar)}
          alt={revisionAuthor.username || '修订人'}
          className="sense-reading-meta-avatar"
        />
        <span>{`修订人 ${revisionAuthor.username || '--'}`}</span>
      </span>
    ) : '修订人 --',
    readingSideDataLoading ? '阅读统计加载中…' : `收藏人数 ${Number(readingMeta?.favoriteCount || 0)}`
  ];

  return (
    <div className={`sense-article-page sense-display-mode-${displayMode}`} style={pageThemeStyle}>
      <SenseArticleMyEditsPanel
        open={myEditsOpen}
        style={myEditsPanelStyle}
        onClose={() => setMyEditsOpen(false)}
        onRefresh={handleRefreshMyEdits}
        loading={myEditsLoading}
        error={myEditsError}
        myEdits={myEdits}
        activeFullDraftId={activeFullDraft?._id || ''}
        pageTitle={pageData?.nodeSense?.title || senseId}
        onResumeEdit={handleResumeMyEdit}
        onOpenReview={handleOpenReviewItem}
        onAbandon={abandonMyEdit}
        abandoningRevisionId={abandoningRevisionId}
      />
      <SenseArticlePageHeader
        pageType="senseArticle"
        articleContext={articleContext}
        title={title}
        revisionStatus=""
        badges={[]}
        metaItems={readingMetaItems}
        showKicker={false}
        showBreadcrumb={false}
        onBack={onBack}
        actions={(
          <>
            {canUpdateSenseArticle ? (
              <button type="button" className="btn btn-primary" onClick={handleOpenFullEditor}>
                <PenSquare size={16} /> 更新释义
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={() => onOpenHistory && onOpenHistory()}>
              <History size={16} /> 历史版本
            </button>
            <button
              ref={myEditsButtonRef}
              type="button"
              className="btn btn-secondary"
              onClick={() => setMyEditsOpen(true)}
            >
              <Sparkles size={16} /> 我的编辑
            </button>
            {(permissions.canReviewDomainAdmin || permissions.canReviewDomainMaster || permissions.isSystemAdmin) && onOpenDashboard ? (
              <button type="button" className="btn btn-secondary" onClick={onOpenDashboard}>
                <Sparkles size={16} /> 词条管理
              </button>
            ) : null}
          </>
        )}
      />

      <div className="sense-article-layout">
        <aside className="sense-article-sidebar">
          <div className="sense-side-card sense-reading-outline-card sense-reading-surface-card">
            <div className="sense-side-card-title">目录</div>
            <div className="sense-reading-outline-shell">
              <SenseArticleOutlineTree
                items={headingIndex}
                activeHeadingId={activeHeadingId}
                resetKey={`reading:${nodeId}:${senseId}:${pageData?.revision?._id || ''}`}
                onJump={(heading) => jumpToHeading(heading.headingId)}
                emptyTitle="暂无目录"
                emptyDescription="当前发布版没有可索引的小节标题。"
              />
            </div>
          </div>
        </aside>

        <main className="sense-article-main sense-reading-main-shell">
          <SenseArticleReadingSearchPanel
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searchData={searchData}
            activeSearchIndex={activeSearchIndex}
            activeSearchMatch={activeSearchMatch}
            isOpen={isReadingSearchOpen}
            onToggleOpen={() => setIsReadingSearchOpen((prev) => !prev)}
            isExpanded={isReadingSearchResultsExpanded}
            onToggleExpanded={() => setIsReadingSearchResultsExpanded((prev) => !prev)}
            hasSearchQuery={hasSearchQuery}
            hasSearchResults={hasSearchResults}
            searchRef={readingSearchRef}
            searchInputRef={readingSearchInputRef}
            onJumpToMatch={jumpToMatch}
          />
          <SenseArticleSelectionToolbar
            selectionAnchor={selectionAnchor}
            selectionToolbarRef={selectionToolbarRef}
            annotationDraft={annotationDraft}
            onAnnotationDraftChange={setAnnotationDraft}
            annotationSaving={annotationSaving}
            onCreateAnnotation={createAnnotation}
            onOpenSelectionEditor={() => onOpenEditor && onOpenEditor({ mode: 'selection', anchor: selectionAnchor })}
          />
          <SenseArticleReferencePreview referencePreview={referencePreview} />
          <SenseArticleRenderer
            revision={{ ...revision, referenceIndex: Array.from(referenceMap.values()) }}
            searchQuery={searchQuery}
            annotations={annotations}
            onReferenceClick={handleReferenceClick}
            onReferenceHover={handleReferenceHover}
            onHeadingEdit={(headingId) => onOpenEditor && onOpenEditor({ mode: 'heading', headingId })}
            activeBlockId={activeSearchMatch?.blockId || ''}
            activeHeadingId={activeHeadingId}
          />
        </main>

        <aside className="sense-article-sidebar right">
          <div className="sense-side-card">
            <div className="sense-side-card-title">我的私有标注</div>
            <div className="sense-annotation-list">
              {readingSideDataLoading ? <SenseArticleStateView compact kind="loading" title="正在读取私有标注" description="批注列表与锚点重定位正在后台补齐。" /> : null}
              {!readingSideDataLoading && readingSideDataError ? <SenseArticleStateView compact kind="error" title="私有标注加载失败" description={readingSideDataError} action={<button type="button" className="btn btn-secondary btn-small" onClick={loadCurrentSideData}>重试</button>} /> : null}
              {!readingSideDataLoading && !readingSideDataError && annotations.length === 0 ? <SenseArticleStateView compact kind="empty" title="暂无私有标注" description="你可以在阅读页选中文本后创建仅自己可见的高亮与备注。" /> : null}
              {!readingSideDataLoading && !readingSideDataError ? annotations.map((annotation) => {
                const relocationStatus = annotation?.relocation?.status || 'exact';
                return (
                  <div key={annotation._id} className={`sense-annotation-card relocation-${relocationStatus}`}>
                    <div className="sense-annotation-card-head">
                      <span className="sense-annotation-color-dot" style={{ backgroundColor: annotation.highlightColor }} />
                      <strong>{annotation.note || annotation.anchor?.selectionText || annotation.anchor?.headingId || '未命名标注'}</strong>
                    </div>
                    <div className="sense-annotation-card-meta">定位：{getRelocationStatusLabel(relocationStatus)}</div>
                    {(annotation.anchor?.selectionText || annotation.anchor?.headingId) ? <div className="sense-annotation-card-body">{annotation.anchor?.selectionText || annotation.anchor?.headingId}</div> : null}
                  </div>
                );
              }) : null}
            </div>
          </div>
          <div className="sense-side-card">
            <div className="sense-side-card-title">标注状态</div>
            {readingSideDataLoading ? <SenseArticleStateView compact kind="loading" title="正在统计标注状态" description="状态汇总会在批注数据加载后显示。" /> : null}
            {!readingSideDataLoading && readingSideDataError ? <SenseArticleStateView compact kind="error" title="标注状态加载失败" description={readingSideDataError} action={<button type="button" className="btn btn-secondary btn-small" onClick={loadCurrentSideData}>重试</button>} /> : null}
            {!readingSideDataLoading && !readingSideDataError ? (
              <>
                <div className="sense-status-row"><MessageSquare size={16} /> 精确 {annotationsByStatus.exact.length}</div>
                <div className="sense-status-row"><MessageSquare size={16} /> 重定位 {annotationsByStatus.relocated.length}</div>
                <div className="sense-status-row"><MessageSquare size={16} /> 待确认 {annotationsByStatus.uncertain.length}</div>
                <div className="sense-status-row"><MessageSquare size={16} /> 失效 {annotationsByStatus.broken.length}</div>
              </>
            ) : null}
          </div>
          <div className="sense-side-card">
            <div className="sense-side-card-title"><Eye size={16} /> 当前页引用</div>
            <div className="sense-annotation-list">
              {referencesLoading ? <SenseArticleStateView compact kind="loading" title="正在读取引用" description="正在加载当前发布版的正文引用。" /> : null}
              {!referencesLoading && (referenceData.references || []).length === 0 ? <SenseArticleStateView compact kind="empty" title="本页暂无正文引用" description="当前发布版未引用其他释义百科页。" /> : null}
              {!referencesLoading ? referenceData.references.slice(0, 8).map((item) => (
                <button key={item.referenceId} type="button" className="sense-annotation-card sense-backlink-card" onClick={() => handleReferenceClick(item)}>
                  <div className="sense-annotation-card-head"><strong>{item.targetNodeName || '知识域'} / {item.targetTitle || item.targetSenseId}</strong></div>
                  <div className="sense-annotation-card-meta">{item.targetSummary || '暂无摘要'} <ArrowUpRight size={12} /></div>
                </button>
              )) : null}
            </div>
          </div>
        </aside>
      </div>
      <SenseArticleDisplayModeToggle displayMode={displayMode} onToggle={toggleDisplayMode} />
      <button
        type="button"
        className="sense-page-back-to-top"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="回到顶部"
        title="回到顶部"
      >
        <ArrowUp size={18} />
      </button>
    </div>
  );
};

export default SenseArticlePage;
