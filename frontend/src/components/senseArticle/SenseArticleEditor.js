import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, HelpCircle, Send, Sparkles, Trash2 } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import { API_BASE } from '../../runtimeConfig';
import SenseArticleRenderer from './SenseArticleRenderer';
import SenseArticleStateView from './SenseArticleStateView';
import SenseArticleEditorStatusBand from './SenseArticleEditorStatusBand';
import SenseArticleDisplayModeToggle from './SenseArticleDisplayModeToggle';
import RichSenseArticleEditorShell from './editor/RichSenseArticleEditorShell';
import useSenseArticleAutosave, { formatAutosaveTime } from './hooks/useSenseArticleAutosave';
import useSenseArticleAsyncSideData from './hooks/useSenseArticleAsyncSideData';
import useSenseArticleDisplayMode from './hooks/useSenseArticleDisplayMode';
import useUnsavedChangesGuard from './hooks/useUnsavedChangesGuard';
import useSenseArticleEditorDetail from './hooks/useSenseArticleEditorDetail';
import SystemConfirmDialog from '../common/SystemConfirmDialog';
import SenseArticleEditorHelpDialog from './editor/dialogs/SenseArticleEditorHelpDialog';
import SenseArticleEditorHeader from './editor/SenseArticleEditorHeader';
import {
  getSenseArticleBackLabel,
  getSourceModeLabel,
  resolveSenseArticleStateFromError
} from './senseArticleUi';
import { senseEditorDebugLog } from './editor/editorDebug';
import {
  buildValidationFailureMessage,
  EDITABLE_DRAFT_STATUSES,
  extractMediaSourceUrlsFromHtml
} from './editor/senseArticleEditorShared';
import './SenseArticle.css';

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
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
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

  const toastTimerRef = useRef(0);
  const tempMediaSessionIdRef = useRef(`temp-media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  const {
    senseTitleInputRef,
    draftLaunchModeRef,
    hasPersistedDraftSaveRef,
    latestRevisionStatusRef,
    latestRevisionIdRef,
    hasDiscardedDraftRef,
    detail,
    setDetail,
    editorHtml,
    setFullEditorHtml,
    senseTitle,
    senseTitleDraft,
    isEditingSenseTitle,
    loading,
    error,
    readOnlyLegacyFallback,
    effectiveRevisionId,
    pageThemeStyle,
    revision,
    canOpenDashboard,
    canEdit,
    normalizedEditorHtml,
    scopedFocus,
    statusNotices,
    setSenseTitleDraft,
    setIsEditingSenseTitle,
    buildSnapshot,
    handleEditorHtmlChange,
    commitSenseTitleEdit,
    cancelSenseTitleEdit
  } = useSenseArticleEditorDetail({
    nodeId,
    senseId,
    revisionId,
    articleContext,
    onContextPatch
  });

  const { displayMode, toggleDisplayMode } = useSenseArticleDisplayMode();

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

  const snapshot = useMemo(() => buildSnapshot(editorHtml), [buildSnapshot, editorHtml]);

  const applySavedRevision = useCallback((data, fallbackSnapshot = snapshot) => {
    if (!data?.revision) return;
    hasPersistedDraftSaveRef.current = true;
    setFullEditorHtml(fallbackSnapshot.editorSource || '<p></p>');
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
  }, [hasPersistedDraftSaveRef, reloadMediaLibrary, setDetail, setFullEditorHtml, setValidationSnapshot, snapshot]);

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
  }, [effectiveRevisionId, hasDiscardedDraftRef, hasPersistedDraftSaveRef, onBack]);

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
  }, [hasDiscardedDraftRef, hasPersistedDraftSaveRef, latestRevisionIdRef, latestRevisionStatusRef, nodeId, senseId, draftLaunchModeRef]);

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

  const editorHeaderContent = (
    <SenseArticleEditorHeader
      inputRef={senseTitleInputRef}
      nodeName={detail?.node?.name || articleContext?.nodeName || nodeId}
      senseTitle={senseTitle || detail?.nodeSense?.title || articleContext?.senseTitle || senseId}
      senseTitleDraft={senseTitleDraft}
      isEditingSenseTitle={isEditingSenseTitle}
      canEdit={canEdit}
      onSenseTitleDraftChange={setSenseTitleDraft}
      onCommitSenseTitleEdit={commitSenseTitleEdit}
      onCancelSenseTitleEdit={cancelSenseTitleEdit}
      onStartSenseTitleEdit={() => {
        setSenseTitleDraft(senseTitle || detail?.nodeSense?.title || articleContext?.senseTitle || senseId || '');
        setIsEditingSenseTitle(true);
      }}
      onBack={handleBack}
      backLabel={getSenseArticleBackLabel(articleContext)}
    />
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
