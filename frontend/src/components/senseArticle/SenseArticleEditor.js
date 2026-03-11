import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Sparkles, Trash2 } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
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
import './SenseArticle.css';

const EMPTY_REVISION = Object.freeze({});

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
  const validationSectionRef = useRef(null);
  const mediaSectionRef = useRef(null);
  const toastTimerRef = useRef(0);

  const pageThemeStyle = useMemo(
    () => buildSenseArticleThemeStyle(detail?.node ? { ...articleContext, node: detail.node } : articleContext),
    [detail, articleContext]
  );
  const revision = useMemo(() => detail?.revision || EMPTY_REVISION, [detail]);
  const canOpenDashboard = !!detail?.permissions?.canReviewDomainAdmin || !!detail?.permissions?.canReviewDomainMaster || !!detail?.permissions?.isSystemAdmin;
  const canEdit = ['draft', 'changes_requested_by_domain_admin', 'changes_requested_by_domain_master'].includes(String(revision?.status || '').trim());
  const normalizedEditorHtml = useMemo(() => normalizeRichHtmlContent(editorHtml), [editorHtml]);

  const loadMediaLibrary = useCallback(async () => {
    if (!revisionId) return;
    try {
      const data = await senseArticleApi.listMediaAssets(nodeId, senseId, { revisionId }, { view: 'senseArticleEditor' });
      setMediaLibrary({
        referencedAssets: Array.isArray(data?.referencedAssets) ? data.referencedAssets : [],
        recentAssets: Array.isArray(data?.recentAssets) ? data.recentAssets : [],
        orphanCandidates: Array.isArray(data?.orphanCandidates) ? data.orphanCandidates : []
      });
    } catch (_error) {
      setMediaLibrary({ referencedAssets: [], recentAssets: [], orphanCandidates: [] });
    }
  }, [nodeId, revisionId, senseId]);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await senseArticleApi.getRevisionDetail(nodeId, senseId, revisionId, {
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
  }, [nodeId, revisionId, senseId]);

  useEffect(() => {
    if (!detail) return;
    const nextRevision = detail.revision || {};
    onContextPatch && onContextPatch({
      nodeId,
      senseId,
      articleId: detail.article?._id || articleContext?.articleId || '',
      currentRevisionId: detail.article?.currentRevisionId || articleContext?.currentRevisionId || '',
      selectedRevisionId: nextRevision._id || revisionId,
      revisionId: nextRevision._id || revisionId,
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
  }, [articleContext, detail, nodeId, onContextPatch, revisionId, senseId]);

  const previewRevision = useMemo(() => {
    if (readOnlyLegacyFallback) return revision;
    return {
      ...(revision || {}),
      contentFormat: 'rich_html',
      editorSource: normalizedEditorHtml,
      renderSnapshot: {
        ...(revision?.renderSnapshot || {}),
        html: normalizedEditorHtml
      }
    };
  }, [normalizedEditorHtml, readOnlyLegacyFallback, revision]);

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
    revisionId,
    snapshot,
    revisionVersion: Number(revision?.revisionVersion || 0),
    initialLastSavedAt: revision?.updatedAt || null,
    enabled: !loading && canEdit && !readOnlyLegacyFallback,
    onSave: async ({ snapshot: nextSnapshot, expectedRevisionVersion }) => senseArticleApi.updateDraft(nodeId, senseId, revisionId, {
      ...nextSnapshot,
      expectedRevisionVersion
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

  const handleRestoreLocalDraft = useCallback(() => {
    const localDraft = autosave.restoreLocalDraft();
    if (!localDraft) return;
    setEditorHtml(localDraft.editorSource || '<p></p>');
    setRevisionTitle(localDraft.revisionTitle || revisionTitle);
    setNote(localDraft.proposerNote || '');
    setSenseTitle(localDraft.proposedSenseTitle || senseTitle);
    showToast(`已恢复本地缓存内容（${formatAutosaveTime(autosave.recoverableDraft?.savedAt)} 保存）。`, 'success');
  }, [autosave, revisionTitle, senseTitle, showToast]);

  const jumpToSection = useCallback((ref) => {
    ref?.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleBack = useCallback(() => {
    if (!confirmNavigation()) return;
    onBack && onBack();
  }, [confirmNavigation, onBack]);

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
      const data = await senseArticleApi.submitRevision(nodeId, senseId, revisionId, {
        view: 'senseArticleEditor'
      });
      autosave.clearLocalBackup();
      onSubmitted && onSubmitted(data?.revision || { _id: revisionId, status: 'pending_review' });
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
      await senseArticleApi.deleteDraft(nodeId, senseId, revisionId);
      autosave.clearLocalBackup();
      onBack && onBack();
    } catch (requestError) {
      showToast(requestError.message || '放弃失败', 'danger');
    } finally {
      setAbandoning(false);
    }
  };

  const uploadMedia = async (payload) => {
    const response = await senseArticleApi.uploadMedia(nodeId, senseId, {
      ...payload,
      revisionId
    });
    setMediaLibrary((prev) => ({
      ...prev,
      recentAssets: [response?.asset, ...(prev?.recentAssets || [])].filter(Boolean)
    }));
    return response;
  };

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
    return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView kind="loading" title="正在加载编辑页" description="正在读取修订内容与当前权限。" /></div>;
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
          recoverableDraft={autosave.recoverableDraft}
          scopedLabel={revision.sourceMode !== 'full' ? `${getSourceModeLabel(revision.sourceMode)}发起的局部修订` : ''}
          validationSnapshot={validationSnapshot}
          mediaLibrary={mediaLibrary}
          onRestoreLocalDraft={handleRestoreLocalDraft}
          onDiscardRecovery={autosave.discardRecovery}
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
            <div className="sense-editor-pane-title">本修订媒体</div>
            <div className="sense-editor-media-chip-row">
              {(mediaLibrary.referencedAssets || []).length > 0 ? (
                mediaLibrary.referencedAssets.map((asset) => (
                  <span key={asset._id} className={`sense-pill media-${asset.kind}`}>{asset.originalName || asset.url}</span>
                ))
              ) : <SenseArticleStateView compact kind="empty" title="无媒体引用" description="当前正文尚未插入图片、音频或视频。" />}
            </div>
            {(mediaLibrary.orphanCandidates || []).length > 0 ? (
              <div className="sense-review-note">检测到 {(mediaLibrary.orphanCandidates || []).length} 个未被当前任何 revision 使用的资源候选，后续可通过治理脚本扫描清理。</div>
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
        <section className="sense-editor-pane preview">
          <div className="sense-editor-pane-title">旧版内容只读预览</div>
          <div className="sense-editor-preview-renderer">
            <SenseArticleRenderer revision={revision} />
          </div>
        </section>
      ) : (
        <RichSenseArticleEditorShell
          value={editorHtml}
          onChange={setEditorHtml}
          previewRevision={previewRevision}
          onSearchReferences={(query) => senseArticleApi.searchReferenceTargets(query)}
          onUploadMedia={uploadMedia}
          scopedFocus={scopedFocus}
          mediaLibrary={mediaLibrary}
          onPasteNotice={(message) => showToast(message, 'subtle')}
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
      <SenseArticleEditorHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
};

export default SenseArticleEditor;
