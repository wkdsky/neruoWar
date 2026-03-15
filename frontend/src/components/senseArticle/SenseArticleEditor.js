import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, HelpCircle, Send, Sparkles, Trash2 } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import { API_BASE } from '../../runtimeConfig';
import SenseArticleRenderer from './SenseArticleRenderer';
import SenseArticleStateView from './SenseArticleStateView';
import SenseArticleEditorStatusBand from './SenseArticleEditorStatusBand';
import SenseArticleDisplayModeToggle from './SenseArticleDisplayModeToggle';
import RichSenseArticleEditorShell from './editor/RichSenseArticleEditorShell';
import { legacyMarkupToRichHtmlWithDiagnostics } from './editor/legacyMarkupToRichHtml';
import { normalizeRichHtmlContent } from './editor/richContentState';
import {
  composeScopedRichEditorDocument,
  extractPlainTextFromRichHtml,
  extractScopedRichEditorDocument
} from './editor/richScopedContent';
import useSenseArticleAutosave, { formatAutosaveTime } from './hooks/useSenseArticleAutosave';
import useSenseArticleAsyncSideData from './hooks/useSenseArticleAsyncSideData';
import useSenseArticleDisplayMode from './hooks/useSenseArticleDisplayMode';
import useUnsavedChangesGuard from './hooks/useUnsavedChangesGuard';
import SystemConfirmDialog from '../common/SystemConfirmDialog';
import SenseArticleEditorHelpDialog from './editor/dialogs/SenseArticleEditorHelpDialog';
import {
  buildDefaultRevisionTitle,
  buildSenseArticleBreadcrumb,
  getSenseArticleBackLabel,
  getRevisionDisplayTitle,
  getSourceModeLabel,
  resolveSenseArticleStateFromError
} from './senseArticleUi';
import { buildSenseArticleAllianceContext, buildSenseArticleThemeStyle } from './senseArticleTheme';
import { describeActiveElement, describeScrollPosition, senseEditorDebugLog } from './editor/editorDebug';
import './SenseArticle.css';

const EMPTY_REVISION = Object.freeze({});
const EDITABLE_DRAFT_STATUSES = new Set(['draft', 'changes_requested_by_domain_admin', 'changes_requested_by_domain_master']);

const buildValidationFailureMessage = (validation = null, fallback = '提交失败', errorCode = '') => {
  if (String(errorCode || '').trim() === 'unchanged_revision') return fallback;
  const blocking = Array.isArray(validation?.blocking) ? validation.blocking : [];
  const messages = blocking
    .map((item) => String(item?.message || '').trim())
    .filter(Boolean);
  if (messages.length === 0) return fallback;
  const summary = messages.slice(0, 3).join('；');
  return messages.length > 3 ? `${summary}；另有 ${messages.length - 3} 项问题` : summary;
};

const resolveRevisionRichHtml = (revisionLike = null) => {
  const editorSource = typeof revisionLike?.editorSource === 'string' ? revisionLike.editorSource : '';
  if (!editorSource.trim()) {
    return {
      html: '<p></p>',
      converted: false,
      parseErrors: 0
    };
  }
  if (String(revisionLike?.contentFormat || '').trim() === 'rich_html') {
    return {
      html: editorSource,
      converted: false,
      parseErrors: Array.isArray(revisionLike?.parseErrors) ? revisionLike.parseErrors.length : 0
    };
  }
  const converted = legacyMarkupToRichHtmlWithDiagnostics(editorSource || '');
  return {
    html: converted.html || '<p></p>',
    converted: true,
    parseErrors: Array.isArray(converted.parseErrors) ? converted.parseErrors.length : 0
  };
};

const extractMediaSourceUrlsFromHtml = (html = '') => {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const urls = Array.from(doc.body.querySelectorAll('img, audio, video'))
    .map((element) => String(element.getAttribute('src') || '').trim())
    .filter(Boolean);
  return urls.filter((item, index, array) => array.indexOf(item) === index);
};

const SenseArticleEditor = ({
  nodeId,
  senseId,
  revisionId,
  articleContext,
  onContextPatch,
  onBack,
  onSubmitted,
  onOpenDashboard
}) => {
  const senseTitleInputRef = useRef(null);
  const [detail, setDetail] = useState(null);
  const [editorHtml, setEditorHtml] = useState('<p></p>');
  const [fullEditorHtml, setFullEditorHtml] = useState('<p></p>');
  const [senseTitle, setSenseTitle] = useState('');
  const [senseTitleDraft, setSenseTitleDraft] = useState('');
  const [isEditingSenseTitle, setIsEditingSenseTitle] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [error, setError] = useState(null);
  const [conversionWarning, setConversionWarning] = useState('');
  const [readOnlyLegacyFallback, setReadOnlyLegacyFallback] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [confirmDialogState, setConfirmDialogState] = useState({
    open: false,
    title: '',
    message: '',
    confirmText: '确认',
    busy: false,
    onConfirm: null
  });
  const [resolvedRevisionId, setResolvedRevisionId] = useState(String(revisionId || '').trim());
  const toastTimerRef = useRef(0);
  const tempMediaSessionIdRef = useRef(`temp-media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const latestEditorHtmlRef = useRef('<p></p>');
  const draftLaunchModeRef = useRef(String(articleContext?.draftLaunchMode || '').trim());
  const hasPersistedDraftSaveRef = useRef(String(articleContext?.draftLaunchMode || '').trim() !== 'created');
  const latestRevisionStatusRef = useRef('');
  const latestRevisionIdRef = useRef(String(revisionId || '').trim());
  const hasDiscardedDraftRef = useRef(false);
  const effectiveRevisionId = String(resolvedRevisionId || revisionId || '').trim();
  const { displayMode, toggleDisplayMode } = useSenseArticleDisplayMode();

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
  const {
    mediaLibrary,
    mediaState,
    reloadMediaLibrary,
    setMediaLibrary,
    setValidationSnapshot
  } = useSenseArticleAsyncSideData({
    nodeId,
    senseId,
    revisionId: effectiveRevisionId,
    enabled: !!effectiveRevisionId && !readOnlyLegacyFallback,
    initialValidationSnapshot: String(revision?._id || '').trim() === effectiveRevisionId ? (revision?.validationSnapshot || null) : null
  });
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
      editorHtmlLength: normalizedEditorHtml.length,
      mediaAssetCount: Number((mediaLibrary?.referencedAssets || []).length) + Number((mediaLibrary?.recentAssets || []).length)
    });
  }, [canEdit, effectiveRevisionId, mediaLibrary, nodeId, normalizedEditorHtml.length, readOnlyLegacyFallback, senseId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const updateVisibility = () => {
      setShowBackToTop(window.scrollY > 320);
    };
    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    return () => window.removeEventListener('scroll', updateVisibility);
  }, []);

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

  const snapshot = useMemo(() => buildSnapshot(editorHtml), [buildSnapshot, editorHtml]);

  const applySavedRevision = useCallback((data, fallbackSnapshot = snapshot) => {
    if (!data?.revision) return;
    hasPersistedDraftSaveRef.current = true;
    setFullEditorHtml(fallbackSnapshot.editorSource || '<p></p>');
    latestEditorHtmlRef.current = normalizeRichHtmlContent(editorHtml || '<p></p>') || '<p></p>';
    if (data?.revision?.validationSnapshot) {
      setValidationSnapshot(data.revision.validationSnapshot);
    }
    setDetail((prev) => ({
      ...(prev || {}),
      revision: {
        ...(prev?.revision || {}),
        ...(data.revision || {}),
        contentFormat: 'rich_html',
        editorSource: fallbackSnapshot.editorSource,
        proposerNote: fallbackSnapshot.proposerNote,
        revisionTitle: fallbackSnapshot.revisionTitle,
        proposedSenseTitle: fallbackSnapshot.proposedSenseTitle
      }
    }));
    reloadMediaLibrary();
  }, [editorHtml, reloadMediaLibrary, setValidationSnapshot, snapshot]);

  const autosave = useSenseArticleAutosave({
    nodeId,
    senseId,
    revisionId: effectiveRevisionId,
    snapshot,
    revisionVersion: Number(revision?.revisionVersion || 0),
    initialLastSavedAt: revision?.updatedAt || null,
    enabled: !loading && canEdit && !readOnlyLegacyFallback,
    onSave: async ({ snapshot: nextSnapshot, expectedRevisionVersion }) => senseArticleApi.updateDraft(nodeId, senseId, effectiveRevisionId, {
      ...nextSnapshot,
      expectedRevisionVersion,
      tempMediaSessionId: tempMediaSessionIdRef.current
    }, {
      view: 'senseArticleEditor'
    }),
    onAfterSave: (response, savedSnapshot) => applySavedRevision(response, savedSnapshot || snapshot)
  });

  const showToast = useCallback((message, tone = 'success') => {
    window.clearTimeout(toastTimerRef.current);
    setToast({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      message,
      tone
    });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = 0;
    }, tone === 'danger' ? 4200 : 2400);
  }, []);

  useEffect(() => {
    if (autosave.status === 'error' || autosave.status === 'conflict') {
      showToast(autosave.error?.message || '自动保存失败，请稍后重试。', 'danger');
    }
  }, [autosave.error, autosave.status, showToast]);

  useEffect(() => () => {
    window.clearTimeout(toastTimerRef.current);
  }, []);

  const hasUnsavedChanges = autosave.isDirty || autosave.status === 'saving';

  useUnsavedChangesGuard({
    enabled: hasUnsavedChanges
  });

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialogState({
      open: false,
      title: '',
      message: '',
      confirmText: '确认',
      busy: false,
      onConfirm: null
    });
  }, []);

  const executeEditorBack = useCallback(() => {
    onBack && onBack({
      action: 'returnFromEditor',
      revisionId: effectiveRevisionId,
      hasPersistedDraftSave: hasPersistedDraftSaveRef.current,
      wasDiscarded: hasDiscardedDraftRef.current
    });
  }, [effectiveRevisionId, onBack]);

  const handleBack = useCallback(() => {
    if (!hasUnsavedChanges) {
      executeEditorBack();
      return;
    }
    setConfirmDialogState({
      open: true,
      title: '确认返回',
      message: '当前百科草稿还有未保存修改，返回后这些改动将直接丢失，是否继续返回？',
      confirmText: '直接返回',
      busy: false,
      onConfirm: () => {
        closeConfirmDialog();
        executeEditorBack();
      }
    });
  }, [closeConfirmDialog, executeEditorBack, hasUnsavedChanges]);

  const handleBackToTop = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

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

  const saveDraft = async () => {
    if (!detail || readOnlyLegacyFallback) return;
    setSaving(true);
    const result = await autosave.saveNow({ reason: 'manual_save', snapshotOverride: buildSnapshot(), force: true });
    setSaving(false);
    if (!result.ok && !result.skipped) {
      showToast(result.error?.message || '保存失败，请稍后重试。', 'danger');
      return;
    }
    showToast(`草稿已于 ${formatAutosaveTime(new Date().toISOString())} 保存。`, 'success');
  };

  const submitRevision = async () => {
    if (!detail || readOnlyLegacyFallback) return;
    setSubmitting(true);
    const saveResult = await autosave.saveNow({ reason: 'before_submit', snapshotOverride: buildSnapshot(), force: true });
    if (!saveResult.ok && !saveResult.skipped) {
      setSubmitting(false);
      showToast(saveResult.error?.message || '提交前自动保存失败，请先解决保存问题。', 'danger');
      return;
    }
    try {
      const data = await senseArticleApi.submitRevision(nodeId, senseId, effectiveRevisionId, {
        view: 'senseArticleEditor'
      });
      onSubmitted && onSubmitted(data?.revision || { _id: effectiveRevisionId, status: 'pending_review' });
    } catch (requestError) {
      const validation = requestError?.payload?.details?.validation || requestError?.payload?.validation || null;
      if (validation) {
        setValidationSnapshot(validation);
        setDetail((prev) => ({
          ...(prev || {}),
          revision: {
            ...(prev?.revision || {}),
            validationSnapshot: validation
          }
        }));
      }
      showToast(
        buildValidationFailureMessage(
          validation,
          requestError.message || '提交失败',
          requestError?.payload?.code || ''
        ),
        'danger'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const abandonDraft = async () => {
    if (!detail) return;
    if (!window.confirm('确定放弃当前修订草稿？')) return;
    setAbandoning(true);
    try {
      hasDiscardedDraftRef.current = true;
      await senseArticleApi.deleteDraft(nodeId, senseId, effectiveRevisionId);
      onBack && onBack();
    } catch (requestError) {
      hasDiscardedDraftRef.current = false;
      showToast(requestError.message || '放弃失败', 'danger');
    } finally {
      setAbandoning(false);
    }
  };

  const uploadMedia = async (payload) => {
    const response = await senseArticleApi.uploadMedia(nodeId, senseId, {
      ...payload,
      revisionId: effectiveRevisionId,
      tempMediaSessionId: tempMediaSessionIdRef.current
    });
    setMediaLibrary((prev) => ({
      ...prev,
      recentAssets: [response?.asset, ...(prev?.recentAssets || [])].filter(Boolean)
    }));
    return response;
  };

  useEffect(() => {
    if (!canEdit || readOnlyLegacyFallback) return undefined;
    const intervalId = window.setInterval(() => {
      senseArticleApi.touchMediaSession(nodeId, senseId, {
        revisionId: effectiveRevisionId,
        tempMediaSessionId: tempMediaSessionIdRef.current
      }, {
        view: 'senseArticleEditor',
        fetchOptions: {
          keepalive: true
        }
      }).catch(() => {});
    }, 2 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [canEdit, effectiveRevisionId, nodeId, readOnlyLegacyFallback, senseId]);

  useEffect(() => () => {
    const launchMode = draftLaunchModeRef.current;
    const saved = hasPersistedDraftSaveRef.current;
    const discarded = hasDiscardedDraftRef.current;
    const currentRevisionStatus = latestRevisionStatusRef.current;
    const currentRevisionId = latestRevisionIdRef.current;
    if (launchMode !== 'created' || saved || discarded || !currentRevisionId || !EDITABLE_DRAFT_STATUSES.has(currentRevisionStatus)) {
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;
    hasDiscardedDraftRef.current = true;
    window.fetch(`${API_BASE}/sense-articles/${encodeURIComponent(nodeId)}/${encodeURIComponent(senseId)}/revisions/${encodeURIComponent(currentRevisionId)}`, {
      method: 'DELETE',
      keepalive: true,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }).catch(() => {
      hasDiscardedDraftRef.current = false;
    });
  }, [nodeId, senseId]);

  useEffect(() => {
    if (!canEdit || readOnlyLegacyFallback) return undefined;
    const temporaryRecentAssets = Array.isArray(mediaLibrary?.recentAssets)
      ? mediaLibrary.recentAssets.filter((item) => item?.isTemporary)
      : [];
    if (temporaryRecentAssets.length === 0) return undefined;
    const activeUrls = extractMediaSourceUrlsFromHtml(normalizedEditorHtml);
    const timeoutId = window.setTimeout(() => {
      senseArticleApi.syncMediaSession(nodeId, senseId, {
        revisionId: effectiveRevisionId,
        tempMediaSessionId: tempMediaSessionIdRef.current,
        activeUrls
      }, {
        view: 'senseArticleEditor'
      }).then((data) => {
        const deletedIdSet = new Set((Array.isArray(data?.deletedAssetIds) ? data.deletedAssetIds : []).map((item) => String(item)));
        const deletedUrlSet = new Set((Array.isArray(data?.deletedUrls) ? data.deletedUrls : []).map((item) => String(item)));
        if (deletedIdSet.size === 0 && deletedUrlSet.size === 0) return;
        setMediaLibrary((prev) => ({
          ...prev,
          recentAssets: Array.isArray(prev?.recentAssets)
            ? prev.recentAssets.filter((item) => !deletedIdSet.has(String(item?._id || '')) && !deletedUrlSet.has(String(item?.url || '')))
            : [],
          orphanCandidates: Array.isArray(prev?.orphanCandidates)
            ? prev.orphanCandidates.filter((item) => !deletedIdSet.has(String(item?._id || '')) && !deletedUrlSet.has(String(item?.url || '')))
            : []
        }));
      }).catch(() => {});
    }, 1000);
    return () => window.clearTimeout(timeoutId);
  }, [canEdit, effectiveRevisionId, mediaLibrary?.recentAssets, nodeId, normalizedEditorHtml, readOnlyLegacyFallback, senseId, setMediaLibrary]);

  useEffect(() => {
    if (!canEdit || readOnlyLegacyFallback) return undefined;
    const releaseSession = (useKeepalive = false) => {
      const token = localStorage.getItem('token');
      if (!token) return;
      window.fetch(`${API_BASE}/sense-articles/${encodeURIComponent(nodeId)}/${encodeURIComponent(senseId)}/media/session/release`, {
        method: 'POST',
        keepalive: useKeepalive,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          revisionId: effectiveRevisionId,
          tempMediaSessionId: tempMediaSessionIdRef.current
        })
      }).catch(() => {});
    };

    const handlePageHide = () => {
      releaseSession(true);
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      releaseSession(false);
    };
  }, [canEdit, effectiveRevisionId, nodeId, readOnlyLegacyFallback, senseId]);

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

  const editorCommandbarActions = (
    <>
      {canOpenDashboard && onOpenDashboard ? (
        <button type="button" className="btn btn-secondary" onClick={onOpenDashboard}>
          <Sparkles size={16} /> 词条管理
        </button>
      ) : null}
      <button type="button" className="btn btn-secondary" onClick={() => setHelpOpen(true)}>
        <HelpCircle size={16} /> 帮助
      </button>
      <button type="button" className="btn btn-primary" onClick={submitRevision} disabled={submitting || !canEdit || readOnlyLegacyFallback}>
        <Send size={16} /> {submitting ? '提交中…' : '提交审核'}
      </button>
      <button type="button" className="btn btn-danger" onClick={abandonDraft} disabled={abandoning || !canEdit}>
        <Trash2 size={16} /> {abandoning ? '处理中…' : '放弃'}
      </button>
    </>
  );

  const editorHeaderTitle = (
    <span className="sense-editor-header-title">
      <span>{detail?.node?.name || articleContext?.nodeName || nodeId}</span>
      <span className="sense-editor-header-separator">/</span>
      {isEditingSenseTitle ? (
        <input
          ref={senseTitleInputRef}
          value={senseTitleDraft}
          onChange={(event) => setSenseTitleDraft(event.target.value)}
          onBlur={commitSenseTitleEdit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitSenseTitleEdit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelSenseTitleEdit();
            }
          }}
          className="sense-editor-header-input"
          disabled={!canEdit}
          aria-label="释义名"
        />
      ) : (
        <span
          className={`sense-editor-header-editable${canEdit ? '' : ' disabled'}`}
          onDoubleClick={() => {
            if (!canEdit) return;
            setSenseTitleDraft(senseTitle || detail?.nodeSense?.title || articleContext?.senseTitle || senseId || '');
            setIsEditingSenseTitle(true);
          }}
          title={canEdit ? '双击释义名进行修改' : ''}
        >
          {senseTitle || detail?.nodeSense?.title || articleContext?.senseTitle || senseId}
        </span>
      )}
      {canEdit && !isEditingSenseTitle ? <span className="sense-editor-header-hint">双击释义名修改</span> : null}
    </span>
  );

  const editorHeaderContent = (
    <div className="sense-rich-editor-shell-head-row">
      <button type="button" className="btn btn-secondary sense-rich-editor-shell-back" onClick={handleBack}>
        <ArrowLeft size={16} /> {getSenseArticleBackLabel(articleContext)}
      </button>
      <div className="sense-rich-editor-shell-title">
        {editorHeaderTitle}
      </div>
    </div>
  );

  if (loading) {
    const isResolvingDraft = !effectiveRevisionId;
    return <div className={`sense-article-page sense-display-mode-${displayMode}`} style={pageThemeStyle}><SenseArticleStateView kind="loading" title={isResolvingDraft ? '正在准备编辑草稿' : '正在加载编辑页'} description={isResolvingDraft ? '正在检查可复用草稿；如无可复用草稿，将自动创建新的整页草稿。' : '正在读取修订内容、局部范围与当前权限。'} /></div>;
  }
  if (error) {
    const state = resolveSenseArticleStateFromError(error, {
      emptyTitle: '修订不存在',
      forbiddenTitle: '暂无编辑权限',
      errorTitle: '编辑页加载失败'
    });
    return <div className={`sense-article-page sense-display-mode-${displayMode}`} style={pageThemeStyle}><SenseArticleStateView {...state} action={<button type="button" className="btn btn-secondary" onClick={handleBack}>返回</button>} /></div>;
  }
  if (!detail?.revision) {
    return <div className={`sense-article-page sense-display-mode-${displayMode}`} style={pageThemeStyle}><SenseArticleStateView kind="empty" title="未找到修订" description="该修订可能已不存在。" action={<button type="button" className="btn btn-secondary" onClick={handleBack}>返回</button>} /></div>;
  }

  return (
    <div className={`sense-article-page editor-mode rich-editor-mode sense-display-mode-${displayMode}`} style={pageThemeStyle}>
      <SenseArticleEditorStatusBand
        scopedLabel={revision.sourceMode !== 'full' ? `${getSourceModeLabel(revision.sourceMode)}发起的局部修订` : ''}
        notices={statusNotices}
      />

      {readOnlyLegacyFallback ? (
        <section className="sense-editor-pane legacy-readonly">
          <div className="sense-editor-pane-title">旧版内容只读正文</div>
          <div className="sense-editor-legacy-renderer">
            <SenseArticleRenderer revision={revision} />
          </div>
        </section>
      ) : (
        <RichSenseArticleEditorShell
          headerContent={editorHeaderContent}
          value={editorHtml}
          onChange={handleEditorHtmlChange}
          onSearchReferences={(query) => senseArticleApi.searchReferenceTargets(query)}
          onUploadMedia={uploadMedia}
          outlineResetKey={`editor:${nodeId}:${senseId}:${effectiveRevisionId}:${revision?.updatedAt || ''}`}
          scopedFocus={scopedFocus}
          mediaLibrary={mediaLibrary}
          mediaLibraryState={mediaState.status}
          mediaLibraryError={mediaState.error}
          onRetryMediaLibrary={reloadMediaLibrary}
          onPasteNotice={(message) => showToast(message, 'subtle')}
          onEditorNotice={(message, tone = 'subtle') => showToast(message, tone)}
          onSaveDraft={saveDraft}
          saveDisabled={saving || !canEdit || readOnlyLegacyFallback}
          savePending={saving}
          commandbarActions={editorCommandbarActions}
        />
      )}
      {toast ? (
        <div className="sense-editor-toast-stack" role="status" aria-live="polite">
          <div className={`sense-editor-toast ${toast.tone || 'success'}`}>
            {toast.message}
          </div>
        </div>
      ) : null}
      {showBackToTop ? (
        <button
          type="button"
          className="sense-editor-back-to-top"
          onClick={handleBackToTop}
          aria-label="回到顶部"
          title="回到顶部"
        >
          <ArrowUp size={18} />
        </button>
      ) : null}
      <SenseArticleDisplayModeToggle displayMode={displayMode} onToggle={toggleDisplayMode} />
      <SenseArticleEditorHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <SystemConfirmDialog
        open={confirmDialogState.open}
        title={confirmDialogState.title}
        message={confirmDialogState.message}
        confirmText={confirmDialogState.confirmText}
        confirmTone="danger"
        busy={confirmDialogState.busy}
        onClose={closeConfirmDialog}
        onConfirm={() => confirmDialogState.onConfirm && confirmDialogState.onConfirm()}
      />
    </div>
  );
};

export default SenseArticleEditor;
