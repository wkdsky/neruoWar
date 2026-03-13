import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Send, Sparkles, Trash2 } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import { API_BASE } from '../../runtimeConfig';
import SenseArticlePageHeader from './SenseArticlePageHeader';
import SenseArticleRenderer from './SenseArticleRenderer';
import SenseArticleStateView from './SenseArticleStateView';
import SenseArticleStatusBadge from './SenseArticleStatusBadge';
import SenseArticleEditorStatusBand from './SenseArticleEditorStatusBand';
import RichSenseArticleEditorShell from './editor/RichSenseArticleEditorShell';
import { legacyMarkupToRichHtmlWithDiagnostics } from './editor/legacyMarkupToRichHtml';
import { normalizeRichHtmlContent } from './editor/richContentState';
import useSenseArticleAutosave, { formatAutosaveTime } from './hooks/useSenseArticleAutosave';
import useUnsavedChangesGuard from './hooks/useUnsavedChangesGuard';
import SenseArticleEditorHelpDialog from './editor/dialogs/SenseArticleEditorHelpDialog';
import {
  buildDefaultRevisionTitle,
  buildSenseArticleBreadcrumb,
  buildSenseArticleTitle,
  getRevisionDisplayTitle,
  getSourceModeLabel,
  resolveSenseArticleStateFromError
} from './senseArticleUi';
import { buildSenseArticleAllianceContext, buildSenseArticleThemeStyle } from './senseArticleTheme';
import { describeActiveElement, describeScrollPosition, senseEditorDebugLog } from './editor/editorDebug';
import { resolveBackendAssetUrl } from '../../runtimeConfig';
import './SenseArticle.css';

const EMPTY_REVISION = Object.freeze({});
const EDITABLE_DRAFT_STATUSES = new Set(['draft', 'changes_requested_by_domain_admin', 'changes_requested_by_domain_master']);

const extractMediaEntriesFromHtml = (html = '') => {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const rows = Array.from(doc.body.querySelectorAll('img, audio, video'))
    .map((element) => {
      const tagName = String(element.tagName || '').toLowerCase();
      const src = resolveBackendAssetUrl(element.getAttribute('src') || '');
      if (!src) return null;
      return {
        kind: tagName === 'img' ? 'image' : tagName === 'audio' ? 'audio' : 'video',
        src
      };
    })
    .filter(Boolean);
  return rows.filter((item, index, array) => array.findIndex((target) => target.kind === item.kind && target.src === item.src) === index);
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
  const [detail, setDetail] = useState(null);
  const [editorHtml, setEditorHtml] = useState('<p></p>');
  const [revisionTitle, setRevisionTitle] = useState('');
  const [note, setNote] = useState('');
  const [senseTitle, setSenseTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [error, setError] = useState(null);
  const [conversionWarning, setConversionWarning] = useState('');
  const [readOnlyLegacyFallback, setReadOnlyLegacyFallback] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mediaLibrary, setMediaLibrary] = useState({ referencedAssets: [], recentAssets: [], orphanCandidates: [] });
  const [toast, setToast] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [resolvedRevisionId, setResolvedRevisionId] = useState(String(revisionId || '').trim());
  const validationSectionRef = useRef(null);
  const mediaSectionRef = useRef(null);
  const toastTimerRef = useRef(0);
  const tempMediaSessionIdRef = useRef(`temp-media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const draftLaunchModeRef = useRef(String(articleContext?.draftLaunchMode || '').trim());
  const hasPersistedDraftSaveRef = useRef(String(articleContext?.draftLaunchMode || '').trim() !== 'created');
  const latestRevisionStatusRef = useRef('');
  const latestRevisionIdRef = useRef(String(revisionId || '').trim());
  const hasDiscardedDraftRef = useRef(false);
  const effectiveRevisionId = String(resolvedRevisionId || revisionId || '').trim();

  const pageThemeStyle = useMemo(
    () => buildSenseArticleThemeStyle(detail?.node ? { ...articleContext, node: detail.node } : articleContext),
    [detail, articleContext]
  );
  const revision = useMemo(() => detail?.revision || EMPTY_REVISION, [detail]);
  const canOpenDashboard = !!detail?.permissions?.canReviewDomainAdmin || !!detail?.permissions?.canReviewDomainMaster || !!detail?.permissions?.isSystemAdmin;
  const canEdit = ['draft', 'changes_requested_by_domain_admin', 'changes_requested_by_domain_master'].includes(String(revision?.status || '').trim());
  const normalizedEditorHtml = useMemo(() => normalizeRichHtmlContent(editorHtml), [editorHtml]);
  const currentEditorMedia = useMemo(() => {
    const currentEntries = extractMediaEntriesFromHtml(normalizedEditorHtml);
    const savedAssets = Array.isArray(mediaLibrary?.referencedAssets) ? mediaLibrary.referencedAssets : [];
    const knownAssets = [
      ...savedAssets,
      ...(Array.isArray(mediaLibrary?.recentAssets) ? mediaLibrary.recentAssets : []),
      ...(Array.isArray(revision?.mediaReferences) ? revision.mediaReferences : [])
    ];
    const assetMap = new Map();
    knownAssets.forEach((asset) => {
      const resolvedUrl = resolveBackendAssetUrl(asset?.url || asset?.src || '');
      if (!resolvedUrl || assetMap.has(resolvedUrl)) return;
      assetMap.set(resolvedUrl, asset);
    });
    const savedUrlSet = new Set(savedAssets.map((asset) => resolveBackendAssetUrl(asset?.url || '')));
    return currentEntries.map((entry) => {
      const matchedAsset = assetMap.get(entry.src);
      return {
        key: `${entry.kind}:${entry.src}`,
        kind: entry.kind,
        src: entry.src,
        label: matchedAsset?.originalName || matchedAsset?.title || matchedAsset?.url || entry.src,
        isSaved: savedUrlSet.has(entry.src)
      };
    });
  }, [mediaLibrary, normalizedEditorHtml, revision]);

  useEffect(() => {
    setResolvedRevisionId(String(revisionId || '').trim());
  }, [revisionId]);

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

  const loadMediaLibrary = useCallback(async () => {
    if (!effectiveRevisionId) return;
    try {
      const data = await senseArticleApi.listMediaAssets(nodeId, senseId, { revisionId: effectiveRevisionId }, { view: 'senseArticleEditor' });
      setMediaLibrary({
        referencedAssets: Array.isArray(data?.referencedAssets) ? data.referencedAssets : [],
        recentAssets: Array.isArray(data?.recentAssets) ? data.recentAssets : [],
        orphanCandidates: Array.isArray(data?.orphanCandidates) ? data.orphanCandidates : []
      });
    } catch (_error) {
      setMediaLibrary({ referencedAssets: [], recentAssets: [], orphanCandidates: [] });
    }
  }, [effectiveRevisionId, nodeId, senseId]);

  useEffect(() => {
    const incomingRevisionId = String(revisionId || '').trim();
    if (incomingRevisionId) return undefined;
    let cancelled = false;

    const resolveFullDraft = async () => {
      setLoading(true);
      setError(null);
      try {
        const overview = await senseArticleApi.getOverview(nodeId, senseId, { view: 'senseArticleEditor' });
        if (cancelled) return;
        const latestDraftRevisionId = String(overview?.article?.latestDraftRevisionId || '').trim();
        if (latestDraftRevisionId) {
          try {
            const detail = await senseArticleApi.getRevisionDetail(nodeId, senseId, latestDraftRevisionId, { view: 'senseArticleEditor' });
            if (cancelled) return;
            const nextRevision = detail?.revision || null;
            const currentUserId = String(detail?.permissions?.currentUserId || localStorage.getItem('userId') || '').trim();
            const isMineOrAdmin = !!detail?.permissions?.isSystemAdmin || String(nextRevision?.proposerId || '').trim() === currentUserId;
            const isReusableFullDraft = String(nextRevision?.sourceMode || 'full').trim() === 'full'
              && EDITABLE_DRAFT_STATUSES.has(String(nextRevision?.status || '').trim());
            if (nextRevision?._id && isMineOrAdmin && isReusableFullDraft) {
              draftLaunchModeRef.current = 'reused';
              hasPersistedDraftSaveRef.current = true;
              hasDiscardedDraftRef.current = false;
              setResolvedRevisionId(latestDraftRevisionId);
              return;
            }
          } catch (_detailError) {
            // Fallback to creating a new draft when the current latest draft is not reusable by this user.
          }
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
        setMediaLibrary(data?.mediaLibrary || { referencedAssets: [], recentAssets: [], orphanCandidates: [] });
        const nextRevision = data?.revision || {};
        const nextRevisionTitle = nextRevision.revisionTitle
          || buildDefaultRevisionTitle(nextRevision.proposerUsername || localStorage.getItem('username') || '');
        setRevisionTitle(nextRevisionTitle);
        setNote(nextRevision.proposerNote || '');
        setSenseTitle(nextRevision.proposedSenseTitle || data?.nodeSense?.title || senseId);
        setReadOnlyLegacyFallback(false);
        setConversionWarning('');

        if (nextRevision.contentFormat === 'rich_html') {
          setEditorHtml(nextRevision.editorSource || '<p></p>');
          return;
        }

        try {
          const converted = legacyMarkupToRichHtmlWithDiagnostics(nextRevision.editorSource || '');
          setEditorHtml(converted.html || '<p></p>');
          const parseErrors = converted.parseErrors.length || (Array.isArray(nextRevision.parseErrors) ? nextRevision.parseErrors.length : 0);
          setConversionWarning(`当前修订是旧版 legacy_markup，已保守转换为 rich_html${parseErrors > 0 ? `（原内容含 ${parseErrors} 个解析异常）` : ''}；保存后将按新格式提交。`);
        } catch (conversionError) {
          setReadOnlyLegacyFallback(true);
          setEditorHtml('<p></p>');
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
      senseTitle: detail.nodeSense?.title || articleContext?.senseTitle || senseId,
      ...buildSenseArticleAllianceContext(detail.node, articleContext),
      breadcrumb: buildSenseArticleBreadcrumb({
        nodeName: detail.node?.name || articleContext?.nodeName || '',
        senseTitle: detail.nodeSense?.title || articleContext?.senseTitle || senseId,
        pageType: 'senseArticleEditor',
        revisionTitle: getRevisionDisplayTitle(nextRevision)
      })
    });
  }, [articleContext, detail, effectiveRevisionId, nodeId, onContextPatch, senseId]);

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

  const modeLabel = useMemo(() => {
    if (readOnlyLegacyFallback) return '旧版内容只读 fallback';
    if (!detail?.article?.currentRevisionId) return '新建首个百科版本';
    if (canEdit) return '编辑草稿';
    if (String(revision?.status || '').startsWith('pending_')) return '审阅流转中';
    return '查看修订';
  }, [canEdit, detail?.article?.currentRevisionId, readOnlyLegacyFallback, revision?.status]);

  const snapshot = useMemo(() => ({
    editorSource: normalizedEditorHtml,
    contentFormat: 'rich_html',
    proposerNote: note,
    revisionTitle: revisionTitle.trim(),
    proposedSenseTitle: senseTitle.trim(),
    sourceMode: revision.sourceMode || 'full',
    targetHeadingId: revision.targetHeadingId || '',
    selectedRangeAnchor: revision.selectedRangeAnchor || null,
    scopedChange: revision.scopedChange || null
  }), [normalizedEditorHtml, note, revision, revisionTitle, senseTitle]);

  const applySavedRevision = useCallback((data, fallbackSnapshot = snapshot) => {
    if (!data?.revision) return;
    hasPersistedDraftSaveRef.current = true;
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
    if (data?.mediaLibrary) {
      setMediaLibrary(data.mediaLibrary);
    } else {
      loadMediaLibrary();
    }
  }, [loadMediaLibrary, snapshot]);

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
    onAfterSave: (response) => applySavedRevision(response)
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

  const confirmNavigation = useUnsavedChangesGuard({
    enabled: autosave.isDirty || autosave.status === 'saving'
  });

  const jumpToSection = useCallback((ref) => {
    ref?.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleBack = useCallback(() => {
    if (!confirmNavigation()) return;
    onBack && onBack({
      action: 'returnFromEditor',
      revisionId: effectiveRevisionId,
      hasPersistedDraftSave: hasPersistedDraftSaveRef.current,
      wasDiscarded: hasDiscardedDraftRef.current
    });
  }, [confirmNavigation, effectiveRevisionId, onBack]);

  const handleBackToTop = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const saveDraft = async () => {
    if (!detail || readOnlyLegacyFallback) return;
    setSaving(true);
    const result = await autosave.saveNow({ reason: 'manual_save' });
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
    const saveResult = await autosave.saveNow({ reason: 'before_submit' });
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
        setDetail((prev) => ({
          ...(prev || {}),
          revision: {
            ...(prev?.revision || {}),
            validationSnapshot: validation
          }
        }));
      }
      showToast(requestError.message || '提交失败', 'danger');
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
  }, [canEdit, effectiveRevisionId, mediaLibrary?.recentAssets, nodeId, normalizedEditorHtml, readOnlyLegacyFallback, senseId]);

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

  const validationSnapshot = revision?.validationSnapshot || null;
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
    return notices;
  }, [conversionWarning, readOnlyLegacyFallback]);

  if (loading) {
    const isResolvingDraft = !effectiveRevisionId;
    return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView kind="loading" title={isResolvingDraft ? '正在准备编辑草稿' : '正在加载编辑页'} description={isResolvingDraft ? '正在检查可复用草稿；如无可复用草稿，将自动创建新的整页草稿。' : '正在读取修订内容与当前权限。'} /></div>;
  }
  if (error) {
    const state = resolveSenseArticleStateFromError(error, {
      emptyTitle: '修订不存在',
      forbiddenTitle: '暂无编辑权限',
      errorTitle: '编辑页加载失败'
    });
    return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView {...state} action={<button type="button" className="btn btn-secondary" onClick={handleBack}>返回</button>} /></div>;
  }
  if (!detail?.revision) {
    return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView kind="empty" title="未找到修订" description="该修订可能已不存在。" action={<button type="button" className="btn btn-secondary" onClick={handleBack}>返回</button>} /></div>;
  }

  return (
    <div className="sense-article-page editor-mode rich-editor-mode" style={pageThemeStyle}>
      <SenseArticlePageHeader
        pageType="senseArticleEditor"
        articleContext={articleContext}
        title={buildSenseArticleTitle({
          nodeName: detail?.node?.name || articleContext?.nodeName || nodeId,
          senseTitle: detail?.nodeSense?.title || articleContext?.senseTitle || senseId,
          revisionTitle: getRevisionDisplayTitle(revision)
        })}
        revisionStatus={revision.status || ''}
        badges={[
          <SenseArticleStatusBadge key="mode" tone="info">{revision.contentFormat === 'rich_html' ? 'rich_html' : 'legacy_markup → rich_html'}</SenseArticleStatusBadge>
        ]}
        metaItems={[
          `修订范围：${getSourceModeLabel(revision.sourceMode)}`,
          `保存格式：rich_html`,
          readOnlyLegacyFallback ? '当前为只读 fallback' : '富文本编辑已启用'
        ]}
        onBack={handleBack}
        actions={(
          <>
            {canOpenDashboard && onOpenDashboard ? (
              <button type="button" className="btn btn-secondary" onClick={onOpenDashboard}>
                <Sparkles size={16} /> 词条管理
              </button>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={submitRevision} disabled={submitting || !canEdit || readOnlyLegacyFallback}>
              <Send size={16} /> {submitting ? '提交中…' : '提交审核'}
            </button>
            <button type="button" className="btn btn-danger" onClick={abandonDraft} disabled={abandoning || !canEdit}>
              <Trash2 size={16} /> {abandoning ? '处理中…' : '放弃'}
            </button>
          </>
        )}
      />

      <div className="sense-editor-metadata-card">
        <SenseArticleEditorStatusBand
          modeLabel={modeLabel}
          scopedLabel={revision.sourceMode !== 'full' ? `${getSourceModeLabel(revision.sourceMode)}发起的局部修订` : ''}
          validationSnapshot={validationSnapshot}
          mediaLibrary={mediaLibrary}
          onJumpToValidation={() => jumpToSection(validationSectionRef)}
          onJumpToMedia={() => jumpToSection(mediaSectionRef)}
          onJumpToOutline={() => document.querySelector('.sense-editor-outline-card')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}
          onOpenHelp={() => setHelpOpen(true)}
          notices={statusNotices}
        />

        <div className="sense-editor-metadata-grid">
          <label>
            <span>修订标题</span>
            <input value={revisionTitle} onChange={(event) => setRevisionTitle(event.target.value)} className="sense-editor-title-input" disabled={!canEdit} />
          </label>
          <label>
            <span>释义名称</span>
            <input value={senseTitle} onChange={(event) => setSenseTitle(event.target.value)} className="sense-editor-title-input" disabled={!canEdit} />
          </label>
          <label className="note">
            <span>修订说明</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} className="sense-review-comment" disabled={!canEdit} />
          </label>
        </div>

        {!readOnlyLegacyFallback ? (
          <div ref={mediaSectionRef} className="sense-editor-media-summary">
            <div className="sense-editor-pane-title">当前正文媒体</div>
            <div className="sense-editor-media-chip-row">
              {currentEditorMedia.length > 0 ? (
                currentEditorMedia.map((asset) => (
                  <span key={asset.key} className={`sense-pill media-${asset.kind}`}>
                    {asset.label}
                    {!asset.isSaved ? ' · 未保存' : ''}
                  </span>
                ))
              ) : <SenseArticleStateView compact kind="empty" title="无媒体引用" description="当前正文尚未插入图片、音频或视频。" />}
            </div>
            {currentEditorMedia.some((item) => !item.isSaved) ? (
              <div className="sense-review-note">已插入但尚未保存的媒体会标记为“未保存”；只有保存后仍在正文中的媒体才会继续保留在服务器上。</div>
            ) : null}
            {(mediaLibrary.orphanCandidates || []).length > 0 ? (
              <div className="sense-review-note">系统检测到 {(mediaLibrary.orphanCandidates || []).length} 个待清理旧媒体；它们会在后续草稿保存或重新进入编辑页时自动删除。</div>
            ) : null}
          </div>
        ) : null}

        {validationSnapshot?.hasBlockingIssues || validationSnapshot?.hasWarnings ? (
          <div ref={validationSectionRef} className="sense-validation-list" role="status" aria-live="polite">
            {(validationSnapshot.blocking || []).map((item) => <div key={`blocking-${item.code}`} className="sense-parse-error-item">{item.message}</div>)}
            {(validationSnapshot.warnings || []).map((item) => <div key={`warning-${item.code}`} className="sense-review-note">{item.message}</div>)}
          </div>
        ) : <div ref={validationSectionRef}><SenseArticleStateView compact kind="empty" title="发布前检查无阻塞问题" description="当前修订没有 blocking error；如后续继续编辑，校验结果会随内容重新计算。" /></div>}
      </div>

      {readOnlyLegacyFallback ? (
        <section className="sense-editor-pane legacy-readonly">
          <div className="sense-editor-pane-title">旧版内容只读正文</div>
          <div className="sense-editor-legacy-renderer">
            <SenseArticleRenderer revision={revision} />
          </div>
        </section>
      ) : (
        <RichSenseArticleEditorShell
          value={editorHtml}
          onChange={setEditorHtml}
          onSearchReferences={(query) => senseArticleApi.searchReferenceTargets(query)}
          onUploadMedia={uploadMedia}
          scopedFocus={scopedFocus}
          mediaLibrary={mediaLibrary}
          onPasteNotice={(message) => showToast(message, 'subtle')}
          onEditorNotice={(message, tone = 'subtle') => showToast(message, tone)}
          onSaveDraft={saveDraft}
          saveDisabled={saving || !canEdit || readOnlyLegacyFallback}
          savePending={saving}
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
      <SenseArticleEditorHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
};

export default SenseArticleEditor;
