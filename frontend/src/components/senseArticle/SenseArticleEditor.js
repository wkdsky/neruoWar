import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Link2, List, ListOrdered, Quote, Save, Send, Sigma, Sparkles } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import { parseSenseArticleSource } from '../../utils/senseArticleSyntax';
import SenseArticleRenderer from './SenseArticleRenderer';
import SenseArticlePageHeader from './SenseArticlePageHeader';
import SenseArticleStateView from './SenseArticleStateView';
import SenseArticleStatusBadge from './SenseArticleStatusBadge';
import {
  buildDefaultRevisionTitle,
  buildSenseArticleBreadcrumb,
  getRevisionDisplayTitle,
  getSourceModeLabel,
  resolveSenseArticleStateFromError
} from './senseArticleUi';
import './SenseArticle.css';
import { buildSenseArticleAllianceContext, buildSenseArticleThemeStyle } from './senseArticleTheme';
import {
  buildScopedRevisionScope,
  buildScopedRevisionState,
  buildTrackedChangeTokens,
  resolveScopedRevisionText
} from './senseArticleScopedRevision';

const PREVIEW_AUTO_REFRESH_MS = 1000;
const PREVIEW_AUTO_REFRESH_MAX_SOURCE_LENGTH = 8000;
const TRACKED_DIFF_TOKEN_PRODUCT_LIMIT = 60000;
const isDevEnvironment = process.env.NODE_ENV !== 'production';

const devLog = (...args) => {
  if (!isDevEnvironment) return;
  console.debug(...args);
};

const estimateTrackedDiffComplexity = (fromText = '', toText = '') => {
  const tokenize = (text) => String(text || '').match(/\s+|[^\s]+/g) || [];
  return tokenize(fromText).length * tokenize(toText).length;
};

const INSERT_TEMPLATES = {
  heading: '\n## 新小节\n',
  ref: '[[nodeId:senseId|引用显示文本]]',
  formula: '\n$$\na^2 + b^2 = c^2\n$$\n',
  symbol: ':alpha:',
  bulletList: '\n- 条目一\n- 条目二\n',
  orderedList: '\n1. 第一点\n2. 第二点\n',
  blockquote: '\n> 引用块内容\n'
};

const HELP_EXAMPLES = [
  '# 一级标题\n## 二级标题',
  '[[sense:nodeId:senseId|显示文本]]',
  '$E=mc^2$ 或 $$\\int_a^b f(x) dx$$',
  ':alpha: :beta: :forall:',
  '- 无序列表\n1. 有序列表',
  '> 引用块'
];

const buildReferenceToken = ({ nodeId, senseId, displayText }) => `[[sense:${nodeId}:${senseId}${displayText ? `|${displayText}` : ''}]]`;

const extractSectionContext = (revision = {}, headingId = '') => {
  if (!headingId) return '';
  const blocks = Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks : [];
  const selected = blocks.filter((block) => block.headingId === headingId || block.id === headingId);
  return selected.map((block) => block.plainText || '').filter(Boolean).join('\n').slice(0, 220);
};

const renderTrackedTokens = (tokens = []) => {
  if (!Array.isArray(tokens) || tokens.length === 0) return <span className="sense-tracked-token equal">暂无文字变化</span>;
  return tokens.map((token, index) => (
    <span key={`${token.type}-${index}`} className={`sense-tracked-token ${token.type}`}>{token.value}</span>
  ));
};

const SenseArticleEditor = ({ nodeId, senseId, revisionId, articleContext, onContextPatch, onBack, onSubmitted, onOpenDashboard }) => {
  const [detail, setDetail] = useState(null);
  const [source, setSource] = useState('');
  const [scopedText, setScopedText] = useState('');
  const [revisionTitle, setRevisionTitle] = useState('');
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [note, setNote] = useState('');
  const [senseTitle, setSenseTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState('');
  const [referenceDisplayText, setReferenceDisplayText] = useState('');
  const [referenceResults, setReferenceResults] = useState([]);
  const [previewSource, setPreviewSource] = useState('');
  const [previewState, setPreviewState] = useState({ stale: false, paused: false, reason: '' });
  const [trackedDiffState, setTrackedDiffState] = useState({
    tokens: [],
    visible: false,
    loading: false,
    stale: false,
    message: ''
  });
  const [lastSavedState, setLastSavedState] = useState({ source: '', scopedText: '', revisionTitle: '', note: '', senseTitle: '' });
  const sourceTextareaRef = useRef(null);
  const scopedTextareaRef = useRef(null);
  const titleInputRef = useRef(null);
  const pageThemeStyle = useMemo(() => buildSenseArticleThemeStyle(detail?.node ? { ...articleContext, node: detail.node } : articleContext), [detail, articleContext]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await senseArticleApi.getRevisionDetail(nodeId, senseId, revisionId, {
          signal: controller.signal
        });
        setDetail(data);
        const nextSource = data.revision?.editorSource || '';
        const nextRevisionTitle = data.revision?.revisionTitle || buildDefaultRevisionTitle(data.revision?.proposerUsername || localStorage.getItem('username') || '');
        const nextNote = data.revision?.proposerNote || '';
        const nextSenseTitle = data.revision?.proposedSenseTitle || data.nodeSense?.title || senseId;
        const initialScope = buildScopedRevisionScope({
          sourceMode: data.revision?.sourceMode || 'full',
          baseSource: data.baseRevision?.editorSource || nextSource,
          targetHeadingId: data.revision?.targetHeadingId || '',
          selectedRangeAnchor: data.revision?.selectedRangeAnchor || null,
          fallbackOriginalText: data.revision?.scopedChange?.originalText || ''
        });
        const initialScopedText = resolveScopedRevisionText({
          scope: initialScope,
          currentSource: nextSource,
          fallbackCurrentText: data.revision?.scopedChange?.currentText || '',
          preferFallbackCurrentText: typeof data.revision?.scopedChange?.currentText === 'string'
        });
        setSource(nextSource);
        setPreviewSource(nextSource);
        setPreviewState({ stale: false, paused: false, reason: '' });
        setScopedText(initialScopedText || '');
        setTrackedDiffState({
          tokens: [],
          visible: false,
          loading: false,
          stale: initialScope.isScoped,
          message: initialScope.isScoped ? '编辑过程中已暂停自动计算修订痕迹，点击按钮后再生成。' : ''
        });
        setRevisionTitle(nextRevisionTitle);
        setNote(nextNote);
        setSenseTitle(nextSenseTitle);
        setLastSavedState({ source: nextSource, scopedText: initialScopedText || '', revisionTitle: nextRevisionTitle, note: nextNote, senseTitle: nextSenseTitle });
      } catch (requestError) {
        if (requestError?.name === 'AbortError') return;
        setError(requestError);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => controller.abort();
  }, [nodeId, senseId, revisionId]);

  useEffect(() => {
    if (!detail) return;
    const revision = detail.revision || {};
    onContextPatch && onContextPatch({
      nodeId,
      senseId,
      articleId: detail.article?._id || articleContext?.articleId || '',
      currentRevisionId: detail.article?.currentRevisionId || articleContext?.currentRevisionId || '',
      selectedRevisionId: revision._id || revisionId,
      revisionId: revision._id || revisionId,
      revisionStatus: revision.status || '',
      nodeName: detail.node?.name || articleContext?.nodeName || '',
      senseTitle: detail.nodeSense?.title || articleContext?.senseTitle || senseId,
      ...buildSenseArticleAllianceContext(detail.node, articleContext),
        breadcrumb: buildSenseArticleBreadcrumb({
          nodeName: articleContext?.nodeName || '',
          senseTitle: articleContext?.senseTitle || senseId,
          pageType: 'senseArticleEditor',
          revisionTitle: getRevisionDisplayTitle(revision)
        })
      });
  }, [detail, nodeId, senseId, revisionId, articleContext, onContextPatch]);

  const revision = detail?.revision || {};
  const baseRevision = detail?.baseRevision || null;
  const fallbackRevisionTitle = useMemo(() => buildDefaultRevisionTitle(revision?.proposerUsername || localStorage.getItem('username') || ''), [revision?.proposerUsername]);
  const canUpdateSenseMetadata = revision.sourceMode === 'full' && (!!detail?.permissions?.canReviewSenseArticle || !!detail?.permissions?.isDomainMaster || !!detail?.permissions?.isSystemAdmin);
  const canOpenDashboard = !!detail?.permissions?.canReviewDomainAdmin || !!detail?.permissions?.canReviewDomainMaster || !!detail?.permissions?.isSystemAdmin;
  const scopedScope = useMemo(() => buildScopedRevisionScope({
    sourceMode: revision.sourceMode || 'full',
    baseSource: baseRevision?.editorSource || source,
    targetHeadingId: revision.targetHeadingId || '',
    selectedRangeAnchor: revision.selectedRangeAnchor || null,
    fallbackOriginalText: revision?.scopedChange?.originalText || ''
  }), [baseRevision?.editorSource, revision.sourceMode, revision.targetHeadingId, revision.selectedRangeAnchor, revision?.scopedChange?.originalText, source]);
  const scopedState = useMemo(() => buildScopedRevisionState({
    scope: scopedScope,
    currentSource: source,
    fallbackCurrentText: scopedText,
    preferFallbackCurrentText: scopedScope.isScoped
  }), [scopedScope, source, scopedText]);

  const effectiveSource = scopedState.isScoped ? scopedState.composeSource(scopedText) : source;
  const resizeBodyTextarea = useCallback((element) => {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resizeBodyTextarea(scopedState.isScoped ? scopedTextareaRef.current : sourceTextareaRef.current);
  }, [resizeBodyTextarea, scopedState.isScoped, scopedText, source]);

  useEffect(() => {
    if (!isTitleEditing || !titleInputRef.current) return;
    titleInputRef.current.focus();
    titleInputRef.current.select();
  }, [isTitleEditing]);

  const refreshPreview = useCallback((nextSource = effectiveSource, reason = 'manual') => {
    setPreviewSource(nextSource || '');
    setPreviewState({ stale: false, paused: false, reason });
  }, [effectiveSource]);

  useEffect(() => {
    const nextPreviewSource = effectiveSource || '';
    if (nextPreviewSource === previewSource) {
      setPreviewState((prev) => (prev.stale || prev.paused ? { stale: false, paused: false, reason: prev.reason || '' } : prev));
      return undefined;
    }

    const shouldPause = nextPreviewSource.length > PREVIEW_AUTO_REFRESH_MAX_SOURCE_LENGTH;
    setPreviewState({
      stale: true,
      paused: shouldPause,
      reason: shouldPause ? 'large_source' : 'awaiting_idle'
    });

    if (shouldPause) return undefined;

    const timer = setTimeout(() => {
      refreshPreview(nextPreviewSource, 'auto');
    }, PREVIEW_AUTO_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [effectiveSource, previewSource, refreshPreview]);

  const previewRevision = useMemo(() => {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const parsed = parseSenseArticleSource(previewSource || '');
    const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    devLog('[sense-article] preview parse', {
      revisionId,
      durationMs: Number(duration.toFixed(2)),
      sourceLength: String(previewSource || '').length,
      blockCount: Array.isArray(parsed.ast?.blocks) ? parsed.ast.blocks.length : 0
    });
    return {
      _id: revisionId,
      ast: parsed.ast,
      referenceIndex: parsed.referenceIndex,
      headingIndex: parsed.headingIndex,
      plainTextSnapshot: parsed.plainTextSnapshot,
      parseErrors: parsed.parseErrors
    };
  }, [previewSource, revisionId]);

  const isDirty = effectiveSource !== lastSavedState.source
    || revisionTitle !== lastSavedState.revisionTitle
    || note !== lastSavedState.note
    || scopedText !== lastSavedState.scopedText
    || (canUpdateSenseMetadata && senseTitle !== lastSavedState.senseTitle);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!isDirty) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!showReferencePicker || !referenceQuery.trim()) {
      setReferenceResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await senseArticleApi.searchReferenceTargets(referenceQuery.trim(), {
          signal: controller.signal
        });
        setReferenceResults(data.results || []);
      } catch (_requestError) {
        if (_requestError?.name === 'AbortError') return;
        setReferenceResults([]);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [showReferencePicker, referenceQuery]);

  const sectionContext = extractSectionContext(baseRevision || revision, revision.targetHeadingId || '');
  const selectionContext = revision.selectedRangeAnchor?.selectionText || revision.selectedRangeAnchor?.textQuote || '';
  useEffect(() => {
    if (!scopedState.isScoped) {
      setTrackedDiffState({ tokens: [], visible: false, loading: false, stale: false, message: '' });
      return;
    }
    setTrackedDiffState((prev) => ({
      ...prev,
      stale: true,
      message: prev.visible ? '局部正文已变化，点击“刷新修订痕迹”以重新生成。' : '编辑过程中已暂停自动计算修订痕迹，点击按钮后再生成。'
    }));
  }, [scopedState.isScoped, scopedState.originalText, scopedText]);

  const trackedTokens = trackedDiffState.tokens;

  const handleRefreshTrackedDiff = useCallback(() => {
    if (!scopedState.isScoped) return;
    const complexity = estimateTrackedDiffComplexity(scopedState.originalText || '', scopedText || '');
    if (complexity > TRACKED_DIFF_TOKEN_PRODUCT_LIMIT) {
      setTrackedDiffState({
        tokens: [],
        visible: false,
        loading: false,
        stale: true,
        message: '当前局部文本较大，已跳过痕迹细粒度计算。请先保存草稿或缩小修订范围后再查看。'
      });
      return;
    }

    setTrackedDiffState((prev) => ({ ...prev, loading: true, message: '正在生成修订痕迹…' }));
    window.setTimeout(() => {
      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const tokens = buildTrackedChangeTokens(scopedState.originalText || '', scopedText || '');
      const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      devLog('[sense-article] tracked diff', {
        revisionId,
        durationMs: Number(duration.toFixed(2)),
        tokenCount: tokens.length,
        complexity
      });
      setTrackedDiffState({
        tokens,
        visible: true,
        loading: false,
        stale: false,
        message: tokens.length > 0 ? '' : '当前范围暂无文字变化。'
      });
    }, 0);
  }, [revisionId, scopedState.isScoped, scopedState.originalText, scopedText]);

  const insertTemplate = (template) => {
    const textarea = scopedState.isScoped ? scopedTextareaRef.current : sourceTextareaRef.current;
    const currentValue = scopedState.isScoped ? scopedText : source;
    const updateValue = scopedState.isScoped ? setScopedText : setSource;
    if (!textarea) {
      updateValue((prev) => `${prev}${template}`);
      return;
    }
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const nextValue = `${currentValue.slice(0, start)}${template}${currentValue.slice(end)}`;
    updateValue(nextValue);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + template.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const insertReference = (result) => {
    insertTemplate(buildReferenceToken({ nodeId: result.nodeId, senseId: result.senseId, displayText: referenceDisplayText.trim() || result.senseTitle || '' }));
    setShowReferencePicker(false);
    setReferenceQuery('');
    setReferenceDisplayText('');
    setReferenceResults([]);
  };

  const buildDraftPayload = () => {
    if (scopedState.isScoped && !scopedState.scopeResolved) {
      throw new Error(scopedState.resolveMessage || '当前局部修订无法稳定定位到正文源码');
    }
    const nextSource = scopedState.isScoped ? scopedState.composeSource(scopedText) : source;
    const payload = {
      editorSource: nextSource,
      revisionTitle,
      proposedSenseTitle: canUpdateSenseMetadata ? senseTitle : undefined,
      proposerNote: note
    };
    if (scopedState.isScoped) {
      payload.scopedChange = {
        mode: scopedState.mode,
        headingTitle: scopedState.headingTitle || '',
        originalText: scopedState.originalText || '',
        currentText: scopedText || '',
        resolveMessage: scopedState.resolveMessage || ''
      };
    }
    return { payload, nextSource };
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const { payload, nextSource } = buildDraftPayload();
      const data = await senseArticleApi.updateDraft(nodeId, senseId, revisionId, payload);
      setDetail((prev) => ({
        ...(prev || {}),
        revision: { ...(prev?.revision || {}), ...(data.revision || {}) },
        article: data.article || prev?.article
      }));
      setSource(nextSource);
      setPreviewSource(nextSource);
      setPreviewState({ stale: false, paused: false, reason: 'save' });
      setLastSavedState({ source: nextSource, scopedText, revisionTitle, note, senseTitle: String(senseTitle || '').trim() });
      onContextPatch && onContextPatch({ selectedRevisionId: data.revision?._id || revisionId, revisionStatus: data.revision?.status || '' });
    } catch (requestError) {
      window.alert(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const { payload, nextSource } = buildDraftPayload();
      const draftData = await senseArticleApi.updateDraft(nodeId, senseId, revisionId, payload);
      setSource(nextSource);
      setPreviewSource(nextSource);
      setPreviewState({ stale: false, paused: false, reason: 'submit' });
      setLastSavedState({ source: nextSource, scopedText, revisionTitle, note, senseTitle: String(senseTitle || '').trim() });
      const data = await senseArticleApi.submitRevision(nodeId, senseId, revisionId);
      setDetail((prev) => ({
        ...(prev || {}),
        revision: { ...(prev?.revision || {}), ...(draftData?.revision || {}), ...(data?.revision || {}) },
        article: data.article || draftData?.article || prev?.article
      }));
      onSubmitted && onSubmitted(data.revision);
    } catch (requestError) {
      window.alert(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView kind="loading" title="正在加载编辑页" description="正在读取当前 revision 源码、基线版本与上下文信息。" /></div>;
  if (error) {
    const state = resolveSenseArticleStateFromError(error, {
      emptyTitle: '当前 revision 不可编辑',
      forbiddenTitle: '暂无编辑权限',
      errorTitle: '编辑页加载失败'
    });
    return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView {...state} action={<button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>} /></div>;
  }

  const handleTitleEditFinish = (shouldReset = false) => {
    if (shouldReset) {
      setRevisionTitle(lastSavedState.revisionTitle || fallbackRevisionTitle);
    } else if (!String(revisionTitle || '').trim()) {
      setRevisionTitle(fallbackRevisionTitle);
    }
    setIsTitleEditing(false);
  };

  const headerTitleNode = (
    <span className="sense-editor-header-title">
      <span>{articleContext?.nodeName || nodeId}</span>
      <span className="sense-editor-header-separator"> / </span>
      <span>{String(senseTitle || articleContext?.senseTitle || senseId).trim() || senseId}</span>
      <span className="sense-editor-header-separator"> / </span>
      {isTitleEditing ? (
        <input
          ref={titleInputRef}
          value={revisionTitle}
          onChange={(event) => setRevisionTitle(event.target.value)}
          onBlur={() => handleTitleEditFinish(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleTitleEditFinish(false);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              handleTitleEditFinish(true);
            }
          }}
          className="sense-editor-header-input"
          placeholder={fallbackRevisionTitle}
        />
      ) : (
        <span
          className="sense-editor-header-editable"
          onDoubleClick={() => setIsTitleEditing(true)}
          title="双击修改修订名称"
        >
          {revisionTitle || getRevisionDisplayTitle(revision)}
        </span>
      )}
    </span>
  );

  return (
    <div className="sense-article-page editor-mode" style={pageThemeStyle}>
      <SenseArticlePageHeader
        pageType="senseArticleEditor"
        articleContext={articleContext}
        title={headerTitleNode}
        revisionStatus={revision.status || ''}
        badges={[<SenseArticleStatusBadge key="revision" tone="info">{getSourceModeLabel(revision.sourceMode)}</SenseArticleStatusBadge>]}
        metaItems={[
          `目标范围：${scopedState.headingTitle || revision.targetHeadingId || '整页'}`,
          `基线版本：${baseRevision?._id ? '当前发布版' : '无'}`,
          isDirty ? '未保存更改' : '已同步草稿'
        ]}
        onBack={onBack}
        actions={(
          <>
            {canOpenDashboard && onOpenDashboard ? (
              <button type="button" className="btn btn-secondary" onClick={onOpenDashboard}>
                <Sparkles size={16} /> 词条管理
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={saveDraft} disabled={saving || submitting || (scopedState.isScoped && !scopedState.scopeResolved)}>
              <Save size={16} /> {saving ? '保存中...' : '保存草稿'}
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting || saving || (scopedState.isScoped && !scopedState.scopeResolved)}>
              <Send size={16} /> {submitting ? '提交中...' : '提交审核'}
            </button>
          </>
        )}
      />

      <div className="sense-editor-toolbar productized">
        <button type="button" className="btn btn-small btn-secondary" onClick={() => insertTemplate(INSERT_TEMPLATES.heading)}>标题</button>
        <button type="button" className="btn btn-small btn-secondary" onClick={() => insertTemplate(INSERT_TEMPLATES.bulletList)}><List size={14} /> 列表</button>
        <button type="button" className="btn btn-small btn-secondary" onClick={() => insertTemplate(INSERT_TEMPLATES.orderedList)}><ListOrdered size={14} /> 有序列表</button>
        <button type="button" className="btn btn-small btn-secondary" onClick={() => insertTemplate(INSERT_TEMPLATES.blockquote)}><Quote size={14} /> 引用块</button>
        <button type="button" className="btn btn-small btn-secondary" onClick={() => setShowReferencePicker((prev) => !prev)}><Link2 size={14} /> 插入引用</button>
        <button type="button" className="btn btn-small btn-secondary" onClick={() => insertTemplate(INSERT_TEMPLATES.formula)}><Sigma size={14} /> 公式</button>
        <button type="button" className="btn btn-small btn-secondary" onClick={() => insertTemplate(INSERT_TEMPLATES.symbol)}>符号</button>
        <button type="button" className="btn btn-small btn-secondary" onClick={() => setShowHelp((prev) => !prev)}><BookOpen size={14} /> 语法帮助</button>
      </div>

      {(showReferencePicker || showHelp || revision.sourceMode !== 'full') ? (
        <div className="sense-editor-helper-grid">
          {showReferencePicker ? (
            <section className="sense-side-card">
              <div className="sense-side-card-title"><Link2 size={16} /> 引用插入器</div>
              <div className="sense-search-box">
                <input value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} placeholder="搜索词条 / 释义" />
              </div>
              <div className="sense-search-box inline">
                <input value={referenceDisplayText} onChange={(event) => setReferenceDisplayText(event.target.value)} placeholder="显示文本（可留空）" />
              </div>
              <div className="sense-search-results">
                {referenceResults.map((result) => (
                  <button key={`${result.nodeId}:${result.senseId}`} type="button" className="sense-search-result-item" onClick={() => insertReference(result)}>
                    <strong>{result.displayLabel}</strong>
                    <span>{result.summary || '无摘要'}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {showHelp ? (
            <section className="sense-side-card">
              <div className="sense-side-card-title"><BookOpen size={16} /> 常见写法</div>
              <div className="sense-help-example-list">
                {HELP_EXAMPLES.map((item) => <pre key={item} className="sense-code-block small"><code>{item}</code></pre>)}
              </div>
            </section>
          ) : null}
          {revision.sourceMode !== 'full' ? (
            <section className="sense-side-card">
              <div className="sense-side-card-title">范围上下文</div>
              <div className="sense-review-note">模式：{getSourceModeLabel(revision.sourceMode)}</div>
              {scopedState.headingTitle ? <div className="sense-review-note">本节：{scopedState.headingTitle}</div> : null}
              {selectionContext ? <div className="sense-review-note">锚定原文：{selectionContext}</div> : null}
              {sectionContext ? <div className="sense-review-note">小节上下文：{sectionContext}</div> : null}
              {!scopedState.scopeResolved ? <div className="sense-review-note danger">{scopedState.resolveMessage}</div> : null}
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="sense-editor-layout">
        <section className="sense-editor-pane">
          <div className="sense-editor-pane-title">{scopedState.isScoped ? scopedState.scopeLabel : '更新释义'}</div>
          {canUpdateSenseMetadata ? (
            <label className="sense-proposer-note">
              <span>释义名称（审核通过后生效）</span>
              <input value={senseTitle} onChange={(event) => setSenseTitle(event.target.value)} className="sense-editor-title-input" placeholder="输入释义名称" />
            </label>
          ) : null}
          {scopedState.isScoped ? (
            <>
              <div className="sense-scoped-edit-head">
                <div className="sense-review-note">只允许修改当前{scopedState.mode === 'selection' ? '选区' : '小节正文'}；标题栏与整页其他内容不会被改动。</div>
              </div>
              <div className="sense-editor-pane-subtitle">修订痕迹</div>
              <div className="sense-scoped-edit-head">
                <button type="button" className="btn btn-small btn-secondary" onClick={handleRefreshTrackedDiff} disabled={trackedDiffState.loading}>
                  {trackedDiffState.loading ? '生成中...' : (trackedDiffState.visible && trackedDiffState.stale ? '刷新修订痕迹' : '查看修订痕迹')}
                </button>
                {trackedDiffState.stale ? <div className="sense-review-note">当前痕迹不是最新内容。</div> : null}
              </div>
              {trackedDiffState.message ? <div className="sense-review-note">{trackedDiffState.message}</div> : null}
              {trackedDiffState.visible ? <div className="sense-tracked-change-box">{renderTrackedTokens(trackedTokens)}</div> : null}
              <div className="sense-editor-pane-subtitle">局部正文</div>
              <textarea ref={scopedTextareaRef} value={scopedText} onChange={(event) => setScopedText(event.target.value)} className="sense-editor-textarea scoped auto-expand" spellCheck="false" rows={1} />
            </>
          ) : (
            <textarea ref={sourceTextareaRef} value={source} onChange={(event) => setSource(event.target.value)} className="sense-editor-textarea auto-expand" spellCheck="false" rows={1} />
          )}
          <label className="sense-proposer-note">
            <span>提交说明</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="描述本次修订范围" />
          </label>
          {(previewRevision.parseErrors || []).length > 0 ? (
            <div className="sense-parse-errors">
              {(previewRevision.parseErrors || []).map((item, index) => (
                <div key={`${item.code}-${index}`} className="sense-parse-error-item">{item.code} · {item.message}</div>
              ))}
            </div>
          ) : null}
        </section>
        <section className="sense-editor-pane preview">
          <div className="sense-editor-pane-title">
            全文预览
            <button type="button" className="btn btn-small btn-secondary" onClick={() => refreshPreview()}>
              刷新预览
            </button>
          </div>
          {previewState.stale ? (
            <div className="sense-review-note">
              {previewState.paused
                ? '正文较长，已暂停自动刷新预览；点击“刷新预览”后再重新解析。'
                : '输入停止 1 秒后会自动刷新预览；也可手动立即刷新。'}
            </div>
          ) : null}
          <SenseArticleRenderer revision={previewRevision} />
        </section>
      </div>
    </div>
  );
};

export default SenseArticleEditor;
