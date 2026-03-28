import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { senseArticleApi } from '../../../utils/senseArticleApi';
import { buildSenseArticleAllianceContext, buildSenseArticleThemeStyle } from '../senseArticleTheme';
import {
  buildDefaultRevisionTitle,
  buildSenseArticleBreadcrumb,
  getRevisionDisplayTitle
} from '../senseArticleUi';
import {
  composeScopedRichEditorDocument,
  extractPlainTextFromRichHtml,
  extractScopedRichEditorDocument
} from '../editor/richScopedContent';
import { normalizeRichHtmlContent } from '../editor/richContentState';
import { describeActiveElement, describeScrollPosition, senseEditorDebugLog } from '../editor/editorDebug';
import { EMPTY_REVISION, resolveRevisionRichHtml } from '../editor/senseArticleEditorShared';

const useSenseArticleEditorDetail = ({
  nodeId,
  senseId,
  revisionId,
  articleContext,
  onContextPatch
}) => {
  const senseTitleInputRef = useRef(null);
  const latestEditorHtmlRef = useRef('<p></p>');
  const draftLaunchModeRef = useRef(String(articleContext?.draftLaunchMode || '').trim());
  const hasPersistedDraftSaveRef = useRef(String(articleContext?.draftLaunchMode || '').trim() !== 'created');
  const latestRevisionStatusRef = useRef('');
  const latestRevisionIdRef = useRef(String(revisionId || '').trim());
  const hasDiscardedDraftRef = useRef(false);

  const [detail, setDetail] = useState(null);
  const [editorHtml, setEditorHtml] = useState('<p></p>');
  const [fullEditorHtml, setFullEditorHtml] = useState('<p></p>');
  const [senseTitle, setSenseTitle] = useState('');
  const [senseTitleDraft, setSenseTitleDraft] = useState('');
  const [isEditingSenseTitle, setIsEditingSenseTitle] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [conversionWarning, setConversionWarning] = useState('');
  const [readOnlyLegacyFallback, setReadOnlyLegacyFallback] = useState(false);
  const [resolvedRevisionId, setResolvedRevisionId] = useState(String(revisionId || '').trim());

  const effectiveRevisionId = String(resolvedRevisionId || revisionId || '').trim();
  const pageThemeStyle = useMemo(
    () => buildSenseArticleThemeStyle(detail?.node ? { ...articleContext, node: detail.node } : articleContext),
    [detail, articleContext]
  );
  const revision = useMemo(() => detail?.revision || EMPTY_REVISION, [detail]);
  const canOpenDashboard = !!detail?.permissions?.canReviewDomainAdmin || !!detail?.permissions?.canReviewDomainMaster || !!detail?.permissions?.isSystemAdmin;
  const canEdit = ['draft', 'changes_requested_by_domain_admin', 'changes_requested_by_domain_master'].includes(String(revision?.status || '').trim());
  const normalizedEditorHtml = useMemo(() => normalizeRichHtmlContent(editorHtml), [editorHtml]);
  const scopedEditorDocument = useMemo(() => extractScopedRichEditorDocument({
    fullHtml: fullEditorHtml,
    sourceMode: revision?.sourceMode || 'full',
    targetHeadingId: revision?.targetHeadingId || '',
    selectedRangeAnchor: revision?.selectedRangeAnchor || null,
    headingTitle: revision?.scopedChange?.headingTitle || ''
  }), [fullEditorHtml, revision?.scopedChange?.headingTitle, revision?.selectedRangeAnchor, revision?.sourceMode, revision?.targetHeadingId]);

  useEffect(() => {
    setResolvedRevisionId(String(revisionId || '').trim());
  }, [revisionId]);

  useEffect(() => {
    latestEditorHtmlRef.current = normalizeRichHtmlContent(editorHtml) || '<p></p>';
  }, [editorHtml]);

  useEffect(() => {
    const externalLaunchMode = String(articleContext?.draftLaunchMode || '').trim();
    if (externalLaunchMode === 'pending_full' && !revisionId) return;
    draftLaunchModeRef.current = externalLaunchMode;
    hasPersistedDraftSaveRef.current = draftLaunchModeRef.current !== 'created';
    hasDiscardedDraftRef.current = false;
  }, [articleContext?.draftLaunchMode, effectiveRevisionId, revisionId]);

  useEffect(() => {
    latestRevisionStatusRef.current = String(revision?.status || '').trim();
    latestRevisionIdRef.current = effectiveRevisionId;
  }, [effectiveRevisionId, revision?.status]);

  useEffect(() => {
    senseEditorDebugLog('editor-page', 'SenseArticleEditor mounted', {
      nodeId,
      senseId,
      revisionId: effectiveRevisionId,
      activeElement: describeActiveElement(),
      scroll: describeScrollPosition()
    });
    return () => {
      senseEditorDebugLog('editor-page', 'SenseArticleEditor unmounted', {
        nodeId,
        senseId,
        revisionId: effectiveRevisionId,
        activeElement: describeActiveElement(),
        scroll: describeScrollPosition()
      });
    };
  }, [effectiveRevisionId, nodeId, senseId]);

  useEffect(() => {
    senseEditorDebugLog('editor-page', 'SenseArticleEditor key props changed', {
      nodeId,
      senseId,
      revisionId: effectiveRevisionId,
      canEdit,
      readOnlyLegacyFallback,
      editorHtmlLength: normalizedEditorHtml.length
    });
  }, [canEdit, effectiveRevisionId, nodeId, normalizedEditorHtml.length, readOnlyLegacyFallback, senseId]);

  useEffect(() => {
    const incomingRevisionId = String(revisionId || '').trim();
    if (incomingRevisionId) return undefined;
    let cancelled = false;

    const resolveFullDraft = async () => {
      setLoading(true);
      setError(null);
      try {
        const mine = await senseArticleApi.getMyEdits(nodeId, senseId, { limit: 50 }, { view: 'senseArticleEditor' });
        if (cancelled) return;
        const reusableFullDraftId = String(mine?.activeFullDraft?._id || '').trim();
        if (reusableFullDraftId) {
          draftLaunchModeRef.current = 'reused';
          hasPersistedDraftSaveRef.current = true;
          hasDiscardedDraftRef.current = false;
          setResolvedRevisionId(reusableFullDraftId);
          return;
        }
        const data = await senseArticleApi.createDraft(nodeId, senseId, {
          proposerNote: '整页百科修订草稿',
          contentFormat: 'rich_html'
        }, {
          view: 'senseArticleEditor'
        });
        if (cancelled) return;
        draftLaunchModeRef.current = 'created';
        hasPersistedDraftSaveRef.current = false;
        hasDiscardedDraftRef.current = false;
        setResolvedRevisionId(String(data?.revision?._id || '').trim());
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError);
          setLoading(false);
        }
      }
    };

    resolveFullDraft();
    return () => {
      cancelled = true;
    };
  }, [nodeId, revisionId, senseId]);

  useEffect(() => {
    if (!effectiveRevisionId) return undefined;
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await senseArticleApi.getRevisionDetail(nodeId, senseId, effectiveRevisionId, {
          signal: controller.signal,
          view: 'senseArticleEditor'
        });
        if (controller.signal.aborted) return;
        setDetail(data);
        const nextRevision = data?.revision || {};
        const nextSenseTitle = nextRevision.proposedSenseTitle || data?.nodeSense?.title || senseId;
        setSenseTitle(nextSenseTitle);
        setSenseTitleDraft(nextSenseTitle);
        setIsEditingSenseTitle(false);
        setReadOnlyLegacyFallback(false);
        setConversionWarning('');
        try {
          const workingHtmlState = resolveRevisionRichHtml(nextRevision);
          const baseHtmlState = resolveRevisionRichHtml(data?.baseRevision || null);
          const scopedArgs = {
            sourceMode: nextRevision.sourceMode || 'full',
            targetHeadingId: nextRevision.targetHeadingId || '',
            selectedRangeAnchor: nextRevision.selectedRangeAnchor || null,
            headingTitle: nextRevision.scopedChange?.headingTitle || ''
          };
          let fullHtml = workingHtmlState.html || '<p></p>';
          let scopedDocument = extractScopedRichEditorDocument({
            fullHtml,
            ...scopedArgs
          });
          const isScopedRevision = ['section', 'selection'].includes(String(nextRevision?.sourceMode || '').trim());
          if (
            isScopedRevision
            && !scopedDocument.resolved
            && typeof baseHtmlState.html === 'string'
            && baseHtmlState.html.trim()
          ) {
            const fallbackDocument = extractScopedRichEditorDocument({
              fullHtml: baseHtmlState.html,
              ...scopedArgs
            });
            if (fallbackDocument.resolved) {
              fullHtml = baseHtmlState.html;
              scopedDocument = fallbackDocument;
            }
          }
          setFullEditorHtml(fullHtml);
          setEditorHtml(scopedDocument.editableHtml || '<p></p>');
          latestEditorHtmlRef.current = normalizeRichHtmlContent(scopedDocument.editableHtml || '<p></p>') || '<p></p>';
          if (workingHtmlState.converted) {
            const parseErrors = workingHtmlState.parseErrors || (Array.isArray(nextRevision.parseErrors) ? nextRevision.parseErrors.length : 0);
            setConversionWarning(`当前修订是旧版 legacy_markup，已保守转换为 rich_html${parseErrors > 0 ? `（原内容含 ${parseErrors} 个解析异常）` : ''}；保存后将按新格式提交。`);
          }
        } catch (conversionError) {
          setReadOnlyLegacyFallback(true);
          setFullEditorHtml('<p></p>');
          setEditorHtml('<p></p>');
          latestEditorHtmlRef.current = '<p></p>';
          setConversionWarning(`旧版内容未能自动转换到富文本，本次仅提供只读预览。${conversionError?.message ? `失败原因：${conversionError.message}` : ''}`);
        }
      } catch (requestError) {
        if (requestError?.name !== 'AbortError') setError(requestError);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [effectiveRevisionId, nodeId, senseId]);

  useEffect(() => {
    if (!detail) return;
    const nextRevision = detail.revision || {};
    onContextPatch && onContextPatch({
      nodeId,
      senseId,
      articleId: detail.article?._id || articleContext?.articleId || '',
      currentRevisionId: detail.article?.currentRevisionId || articleContext?.currentRevisionId || '',
      selectedRevisionId: nextRevision._id || effectiveRevisionId,
      revisionId: nextRevision._id || effectiveRevisionId,
      revisionStatus: nextRevision.status || '',
      nodeName: detail.node?.name || articleContext?.nodeName || '',
      senseTitle: senseTitle || detail.nodeSense?.title || articleContext?.senseTitle || senseId,
      ...buildSenseArticleAllianceContext(detail.node, articleContext),
      breadcrumb: buildSenseArticleBreadcrumb({
        nodeName: detail.node?.name || articleContext?.nodeName || '',
        senseTitle: senseTitle || detail.nodeSense?.title || articleContext?.senseTitle || senseId,
        pageType: 'senseArticleEditor',
        revisionTitle: getRevisionDisplayTitle(nextRevision)
      })
    });
  }, [articleContext, detail, effectiveRevisionId, nodeId, onContextPatch, senseId, senseTitle]);

  useEffect(() => {
    if (!isEditingSenseTitle) {
      setSenseTitleDraft(senseTitle || '');
    }
  }, [isEditingSenseTitle, senseTitle]);

  useEffect(() => {
    if (!isEditingSenseTitle || !senseTitleInputRef.current) return;
    senseTitleInputRef.current.focus();
    senseTitleInputRef.current.select();
  }, [isEditingSenseTitle]);

  const scopedFocus = useMemo(() => {
    const selectionText = revision?.selectedRangeAnchor?.selectionText || revision?.selectedRangeAnchor?.textQuote || '';
    const headingId = revision?.targetHeadingId || revision?.selectedRangeAnchor?.headingId || '';
    const originalText = revision?.scopedChange?.originalText || '';
    const enabled = revision?.sourceMode === 'section' || revision?.sourceMode === 'selection';
    return {
      enabled,
      selectionText,
      originalText,
      headingText: revision?.scopedChange?.headingTitle || headingId,
      label: revision?.sourceMode === 'selection' ? '选段修订范围' : revision?.sourceMode === 'section' ? '小节修订范围' : '',
      description: selectionText || originalText || headingId || '系统已根据创建修订时的范围，自动定位相关块。',
      previewHeadingId: headingId,
      previewBlockId: revision?.selectedRangeAnchor?.blockId || ''
    };
  }, [revision]);

  const buildSnapshot = useCallback((editableHtmlOverride = null) => {
    const effectiveEditableHtml = normalizeRichHtmlContent(
      editableHtmlOverride == null ? latestEditorHtmlRef.current || editorHtml : editableHtmlOverride
    ) || '<p></p>';
    const effectiveComposedHtml = composeScopedRichEditorDocument({
      fullHtml: fullEditorHtml,
      sourceMode: revision?.sourceMode || 'full',
      targetHeadingId: revision?.targetHeadingId || '',
      selectedRangeAnchor: revision?.selectedRangeAnchor || null,
      headingTitle: revision?.scopedChange?.headingTitle || '',
      editableHtml: effectiveEditableHtml
    });
    return {
      editorSource: effectiveComposedHtml,
      contentFormat: 'rich_html',
      proposerNote: String(revision?.proposerNote || '').trim(),
      revisionTitle: buildDefaultRevisionTitle(revision?.proposerUsername || localStorage.getItem('username') || ''),
      proposedSenseTitle: senseTitle.trim(),
      sourceMode: revision.sourceMode || 'full',
      targetHeadingId: revision.targetHeadingId || '',
      selectedRangeAnchor: revision.selectedRangeAnchor || null,
      scopedChange: ['section', 'selection'].includes(String(revision?.sourceMode || '').trim())
        ? {
            mode: revision.sourceMode || 'full',
            headingTitle: scopedEditorDocument.headingTitle || revision?.scopedChange?.headingTitle || '',
            originalText: revision?.scopedChange?.originalText || scopedEditorDocument.originalText || '',
            currentText: extractPlainTextFromRichHtml(effectiveEditableHtml),
            resolveMessage: scopedEditorDocument.resolveMessage || ''
          }
        : (revision.scopedChange || null)
    };
  }, [
    editorHtml,
    fullEditorHtml,
    revision,
    scopedEditorDocument.headingTitle,
    scopedEditorDocument.originalText,
    scopedEditorDocument.resolveMessage,
    senseTitle
  ]);

  const handleEditorHtmlChange = useCallback((nextHtml = '<p></p>') => {
    const normalized = normalizeRichHtmlContent(nextHtml) || '<p></p>';
    latestEditorHtmlRef.current = normalized;
    setEditorHtml(normalized);
  }, []);

  const commitSenseTitleEdit = useCallback(() => {
    const nextSenseTitle = String(senseTitleDraft || '').trim();
    setSenseTitle(nextSenseTitle || detail?.nodeSense?.title || articleContext?.senseTitle || senseId);
    setIsEditingSenseTitle(false);
  }, [articleContext?.senseTitle, detail?.nodeSense?.title, senseId, senseTitleDraft]);

  const cancelSenseTitleEdit = useCallback(() => {
    setSenseTitleDraft(senseTitle || detail?.nodeSense?.title || articleContext?.senseTitle || senseId || '');
    setIsEditingSenseTitle(false);
  }, [articleContext?.senseTitle, detail?.nodeSense?.title, senseId, senseTitle]);

  const statusNotices = useMemo(() => {
    const notices = [];
    if (conversionWarning) {
      notices.push({
        id: 'conversion-warning',
        tone: readOnlyLegacyFallback ? 'danger' : 'subtle',
        title: readOnlyLegacyFallback ? 'legacy 转 rich 转换失败' : 'legacy 内容已保守转换',
        message: conversionWarning
      });
    }
    if (!readOnlyLegacyFallback && ['section', 'selection'].includes(String(revision?.sourceMode || '').trim()) && scopedEditorDocument.resolveMessage) {
      notices.push({
        id: 'scoped-range-warning',
        tone: 'warning',
        title: '局部范围已降级为保守编辑',
        message: scopedEditorDocument.resolveMessage
      });
    }
    return notices;
  }, [conversionWarning, readOnlyLegacyFallback, revision?.sourceMode, scopedEditorDocument.resolveMessage]);

  return {
    senseTitleInputRef,
    draftLaunchModeRef,
    hasPersistedDraftSaveRef,
    latestRevisionStatusRef,
    latestRevisionIdRef,
    hasDiscardedDraftRef,
    detail,
    setDetail,
    editorHtml,
    fullEditorHtml,
    setFullEditorHtml,
    senseTitle,
    senseTitleDraft,
    isEditingSenseTitle,
    loading,
    error,
    conversionWarning,
    readOnlyLegacyFallback,
    effectiveRevisionId,
    pageThemeStyle,
    revision,
    canOpenDashboard,
    canEdit,
    normalizedEditorHtml,
    scopedEditorDocument,
    scopedFocus,
    statusNotices,
    setSenseTitleDraft,
    setIsEditingSenseTitle,
    buildSnapshot,
    handleEditorHtmlChange,
    commitSenseTitleEdit,
    cancelSenseTitleEdit
  };
};

export default useSenseArticleEditorDetail;
