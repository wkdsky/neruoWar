import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Link2, List, ListOrdered, Quote, Save, Send, Sigma, Sparkles } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import { parseSenseArticleSource } from '../../utils/senseArticleSyntax';
import SenseArticleRenderer from './SenseArticleRenderer';
import SenseArticlePageHeader from './SenseArticlePageHeader';
import SenseArticleStateView from './SenseArticleStateView';
import SenseArticleStatusBadge from './SenseArticleStatusBadge';
import {
  buildSenseArticleBreadcrumb,
  buildSenseArticleTitle,
  formatRevisionLabel,
  getSourceModeLabel,
  resolveSenseArticleStateFromError
} from './senseArticleUi';
import './SenseArticle.css';

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

const SenseArticleEditor = ({ nodeId, senseId, revisionId, articleContext, onContextPatch, onBack, onSubmitted, onOpenDashboard }) => {
  const [detail, setDetail] = useState(null);
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState('');
  const [referenceDisplayText, setReferenceDisplayText] = useState('');
  const [referenceResults, setReferenceResults] = useState([]);
  const [lastSavedState, setLastSavedState] = useState({ source: '', note: '' });
  const textareaRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await senseArticleApi.getRevisionDetail(nodeId, senseId, revisionId);
        setDetail(data);
        const nextSource = data.revision?.editorSource || '';
        const nextNote = data.revision?.proposerNote || '';
        setSource(nextSource);
        setNote(nextNote);
        setLastSavedState({ source: nextSource, note: nextNote });
      } catch (requestError) {
        setError(requestError);
      } finally {
        setLoading(false);
      }
    };
    load();
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
      breadcrumb: buildSenseArticleBreadcrumb({
        nodeName: articleContext?.nodeName || '',
        senseTitle: articleContext?.senseTitle || senseId,
        pageType: 'senseArticleEditor',
        revisionNumber: revision.revisionNumber
      })
    });
  }, [detail, nodeId, senseId, revisionId, articleContext, onContextPatch]);

  useEffect(() => {
    const dirty = source !== lastSavedState.source || note !== lastSavedState.note;
    const handleBeforeUnload = (event) => {
      if (!dirty) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [source, note, lastSavedState]);

  useEffect(() => {
    if (!showReferencePicker || !referenceQuery.trim()) {
      setReferenceResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await senseArticleApi.searchReferenceTargets(referenceQuery.trim());
        setReferenceResults(data.results || []);
      } catch (requestError) {
        setReferenceResults([]);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [showReferencePicker, referenceQuery]);

  const previewRevision = useMemo(() => {
    const parsed = parseSenseArticleSource(source || '');
    return {
      _id: revisionId,
      ast: parsed.ast,
      referenceIndex: parsed.referenceIndex,
      headingIndex: parsed.headingIndex,
      plainTextSnapshot: parsed.plainTextSnapshot,
      parseErrors: parsed.parseErrors
    };
  }, [source, revisionId]);

  const revision = detail?.revision || {};
  const baseRevision = detail?.baseRevision || null;
  const isDirty = source !== lastSavedState.source || note !== lastSavedState.note;
  const sectionContext = extractSectionContext(baseRevision || revision, revision.targetHeadingId || '');
  const selectionContext = revision.selectedRangeAnchor?.selectionText || revision.selectedRangeAnchor?.textQuote || '';

  const insertTemplate = (template) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setSource((prev) => `${prev}${template}`);
      return;
    }
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const nextSource = `${source.slice(0, start)}${template}${source.slice(end)}`;
    setSource(nextSource);
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

  const saveDraft = async () => {
    setSaving(true);
    try {
      const data = await senseArticleApi.updateDraft(nodeId, senseId, revisionId, { editorSource: source, proposerNote: note });
      setDetail((prev) => ({ ...(prev || {}), revision: data.revision, article: data.article || prev?.article }));
      setLastSavedState({ source, note });
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
      await senseArticleApi.updateDraft(nodeId, senseId, revisionId, { editorSource: source, proposerNote: note });
      setLastSavedState({ source, note });
      const data = await senseArticleApi.submitRevision(nodeId, senseId, revisionId);
      onSubmitted && onSubmitted(data.revision);
    } catch (requestError) {
      window.alert(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="sense-article-page"><SenseArticleStateView kind="loading" title="正在加载编辑页" description="正在读取当前 revision 源码、基线版本与上下文信息。" /></div>;
  if (error) {
    const state = resolveSenseArticleStateFromError(error, {
      emptyTitle: '当前 revision 不可编辑',
      forbiddenTitle: '暂无编辑权限',
      errorTitle: '编辑页加载失败'
    });
    return <div className="sense-article-page"><SenseArticleStateView {...state} action={<button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>} /></div>;
  }

  const title = buildSenseArticleTitle({
    nodeName: articleContext?.nodeName || nodeId,
    senseTitle: articleContext?.senseTitle || senseId,
    revisionNumber: revision.revisionNumber
  });

  return (
    <div className="sense-article-page editor-mode">
      <SenseArticlePageHeader
        pageType="senseArticleEditor"
        articleContext={articleContext}
        title={title}
        revisionStatus={revision.status || ''}
        badges={[<SenseArticleStatusBadge key="revision" tone="info">{getSourceModeLabel(revision.sourceMode)}</SenseArticleStatusBadge>]}
        metaItems={[
          `目标小节：${revision.targetHeadingId || '整页'}`,
          `基线版本：${formatRevisionLabel(baseRevision?.revisionNumber)}`,
          isDirty ? '未保存更改' : '已同步草稿'
        ]}
        onBack={onBack}
        actions={(
          <>
            {onOpenDashboard ? (
              <button type="button" className="btn btn-secondary" onClick={onOpenDashboard}>
                <Sparkles size={16} /> 治理面板
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={saveDraft} disabled={saving || submitting}>
              <Save size={16} /> {saving ? '保存中...' : '保存草稿'}
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting || saving}>
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
              {revision.targetHeadingId ? <div className="sense-review-note">小节：{revision.targetHeadingId}</div> : null}
              {selectionContext ? <div className="sense-review-note">锚定原文：{selectionContext}</div> : null}
              {sectionContext ? <div className="sense-review-note">小节上下文：{sectionContext}</div> : null}
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="sense-editor-layout">
        <section className="sense-editor-pane">
          <div className="sense-editor-pane-title">源码</div>
          <textarea ref={textareaRef} value={source} onChange={(event) => setSource(event.target.value)} className="sense-editor-textarea" spellCheck="false" />
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
          <div className="sense-editor-pane-title">预览</div>
          <SenseArticleRenderer revision={previewRevision} />
        </section>
      </div>
    </div>
  );
};

export default SenseArticleEditor;
