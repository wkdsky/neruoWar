import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Eye, History, MessageSquare, PenSquare, Search, Sparkles } from 'lucide-react';
import { senseArticleApi } from '../../utils/senseArticleApi';
import SenseArticleRenderer from './SenseArticleRenderer';
import SenseArticlePageHeader from './SenseArticlePageHeader';
import SenseArticleStateView from './SenseArticleStateView';
import {
  buildSenseArticleBreadcrumb,
  getReferenceTargetStatusLabel,
  getRelocationStatusLabel,
  getRevisionDisplayTitle,
  getRevisionStatusLabel,
  resolveSenseArticleStateFromError
} from './senseArticleUi';
import './SenseArticle.css';
import defaultMale1 from '../../assets/avatars/default_male_1.svg';
import defaultMale2 from '../../assets/avatars/default_male_2.svg';
import defaultMale3 from '../../assets/avatars/default_male_3.svg';
import defaultFemale1 from '../../assets/avatars/default_female_1.svg';
import defaultFemale2 from '../../assets/avatars/default_female_2.svg';
import defaultFemale3 from '../../assets/avatars/default_female_3.svg';
import { buildSenseArticleAllianceContext, buildSenseArticleThemeStyle } from './senseArticleTheme';

const ANNOTATION_COLORS = ['#fde68a', '#fca5a5', '#86efac', '#93c5fd', '#d8b4fe'];

const articleAvatarMap = {
  default_male_1: defaultMale1,
  default_male_2: defaultMale2,
  default_male_3: defaultMale3,
  default_female_1: defaultFemale1,
  default_female_2: defaultFemale2,
  default_female_3: defaultFemale3,
  male1: defaultMale1,
  male2: defaultMale2,
  male3: defaultMale3,
  female1: defaultFemale1,
  female2: defaultFemale2,
  female3: defaultFemale3
};

const resolveArticleAvatarSrc = (avatarKey = '') => {
  const key = typeof avatarKey === 'string' ? avatarKey.trim() : '';
  if (!key) return articleAvatarMap.default_male_1;
  if (articleAvatarMap[key]) return articleAvatarMap[key];
  if (/^https?:\/\//i.test(key) || key.startsWith('/') || key.startsWith('data:image/')) return key;
  return articleAvatarMap.default_male_1;
};

const simpleHash = (value = '') => {
  const text = String(value || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 16);
};

const buildSelectionAnchor = () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const root = range.commonAncestorContainer?.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer?.parentElement;
  const blockElement = root?.closest?.('[data-article-block]') || null;
  const headingElement = root?.closest?.('[data-article-heading-block="true"], [data-article-heading]') || null;
  const blockText = String(blockElement?.textContent || '').replace(/\s+/g, ' ').trim();
  const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
  const textIndex = blockText ? blockText.indexOf(normalizedText) : -1;
  const prefixText = textIndex >= 0 ? blockText.slice(Math.max(0, textIndex - 36), textIndex) : '';
  const suffixText = textIndex >= 0 ? blockText.slice(textIndex + normalizedText.length, textIndex + normalizedText.length + 36) : '';
  return {
    selectionText: normalizedText,
    textQuote: normalizedText,
    prefixText,
    suffixText,
    beforeText: prefixText,
    afterText: suffixText,
    blockId: blockElement?.getAttribute('data-article-block') || '',
    blockHash: blockElement?.getAttribute('data-article-block-hash') || '',
    headingId: blockElement?.getAttribute('data-article-heading') || headingElement?.getAttribute('data-article-heading') || headingElement?.id || '',
    selectedTextHash: simpleHash(normalizedText),
    textPositionStart: textIndex >= 0 ? textIndex : null,
    textPositionEnd: textIndex >= 0 ? textIndex + normalizedText.length : null,
    rect: {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height
    }
  };
};

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
  const [pageData, setPageData] = useState(null);
  const [referenceData, setReferenceData] = useState({ references: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchData, setSearchData] = useState({ total: 0, matches: [], groups: [] });
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [activeHeadingId, setActiveHeadingId] = useState('');
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [annotationDraft, setAnnotationDraft] = useState({ note: '', color: ANNOTATION_COLORS[0] });
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const [referencePreview, setReferencePreview] = useState(null);
  const [myEditsOpen, setMyEditsOpen] = useState(false);
  const [myEditsLoading, setMyEditsLoading] = useState(false);
  const [myEditsError, setMyEditsError] = useState('');
  const [myEdits, setMyEdits] = useState([]);
  const selectionToolbarRef = useRef(null);
  const pageThemeStyle = useMemo(() => buildSenseArticleThemeStyle(pageData?.node ? { ...articleContext, node: pageData.node } : articleContext), [pageData, articleContext]);

  const loadCurrent = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, references] = await Promise.all([
        senseArticleApi.getCurrent(nodeId, senseId),
        senseArticleApi.getReferences(nodeId, senseId)
      ]);
      setPageData(data);
      setReferenceData(references || { references: [] });
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCurrent();
  }, [nodeId, senseId]);

  useEffect(() => {
    if (!pageData) return;
    const node = pageData.node || {};
    const nodeSense = pageData.nodeSense || {};
    const article = pageData.article || {};
    const revision = pageData.revision || {};
    onContextPatch && onContextPatch({
      nodeId,
      senseId,
      articleId: article._id || '',
      currentRevisionId: article.currentRevisionId || revision._id || '',
      selectedRevisionId: revision._id || '',
      revisionId: revision._id || '',
      nodeName: node.name || '',
      senseTitle: nodeSense.title || senseId,
      revisionStatus: revision.status || '',
      ...buildSenseArticleAllianceContext(node, articleContext),
      breadcrumb: buildSenseArticleBreadcrumb({
        nodeName: node.name || '',
        senseTitle: nodeSense.title || senseId,
        pageType: 'senseArticle',
        revisionNumber: revision.revisionNumber
      })
    });
  }, [pageData, nodeId, senseId, articleContext, onContextPatch]);

  useEffect(() => {
    if (!myEditsOpen) return undefined;
    let cancelled = false;

    const loadMyDrafts = async () => {
      setMyEditsLoading(true);
      setMyEditsError('');
      try {
        const data = await senseArticleApi.getRevisions(nodeId, senseId, { pageSize: 50 });
        if (cancelled) return;
        const currentUserId = String(data?.permissions?.currentUserId || localStorage.getItem('userId') || '').trim();
        const drafts = (data?.revisions || [])
          .filter((item) => {
            const status = String(item?.status || '').trim();
            return String(item?.proposerId || '').trim() === currentUserId
              && ['draft', 'pending_review', 'pending_domain_admin_review', 'pending_domain_master_review'].includes(status);
          })
          .sort((left, right) => (
            new Date(right?.updatedAt || right?.createdAt || 0).getTime()
            - new Date(left?.updatedAt || left?.createdAt || 0).getTime()
          ));
        setMyEdits(drafts);
      } catch (requestError) {
        if (cancelled) return;
        setMyEditsError(requestError.message || '加载失败');
        setMyEdits([]);
      } finally {
        if (!cancelled) setMyEditsLoading(false);
      }
    };

    loadMyDrafts();
    return () => {
      cancelled = true;
    };
  }, [myEditsOpen, nodeId, senseId]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchData({ total: 0, matches: [], groups: [] });
      setActiveSearchIndex(-1);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await senseArticleApi.searchWithinArticle(nodeId, senseId, searchQuery.trim());
        setSearchData({ total: data.total || 0, matches: data.matches || [], groups: data.groups || [] });
        setActiveSearchIndex((data.matches || []).length > 0 ? 0 : -1);
      } catch (requestError) {
        setSearchData({ total: 0, matches: [], groups: [] });
        setActiveSearchIndex(-1);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [nodeId, senseId, searchQuery]);

  useEffect(() => {
    const handleMouseUp = () => setSelectionAnchor(buildSelectionAnchor());
    const handleMouseDown = (event) => {
      if (selectionToolbarRef.current && selectionToolbarRef.current.contains(event.target)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setSelectionAnchor(null);
    };
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const headings = Array.from(document.querySelectorAll('[data-article-heading-block="true"]'));
      let current = '';
      headings.forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.top <= 120) current = element.id || element.getAttribute('data-article-heading') || current;
      });
      if (current) setActiveHeadingId(current);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [pageData]);

  useEffect(() => {
    if (activeSearchIndex < 0) return;
    const match = searchData.matches[activeSearchIndex];
    if (!match) return;
    const element = document.querySelector(`[data-article-block="${match.blockId}"]`) || document.getElementById(match.headingId || '');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (match.headingId) setActiveHeadingId(match.headingId);
    }
  }, [activeSearchIndex, searchData]);

  const headingIndex = pageData?.revision?.headingIndex || [];
  const annotations = pageData?.annotations || [];
  const annotationsByStatus = useMemo(() => {
    const groups = { exact: [], relocated: [], uncertain: [], broken: [] };
    annotations.forEach((item) => {
      const status = item?.relocation?.status || 'exact';
      if (groups[status]) groups[status].push(item);
    });
    return groups;
  }, [annotations]);

  const activeSearchMatch = activeSearchIndex >= 0 ? searchData.matches[activeSearchIndex] : null;
  const referenceMap = useMemo(() => new Map((referenceData.references || []).map((item) => [item.referenceId, item])), [referenceData]);

  const createAnnotation = async () => {
    if (!selectionAnchor?.selectionText) return;
    setAnnotationSaving(true);
    try {
      await senseArticleApi.createAnnotation(nodeId, senseId, {
        anchorType: 'text_range',
        anchor: selectionAnchor,
        highlightColor: annotationDraft.color,
        note: annotationDraft.note
      });
      setSelectionAnchor(null);
      setAnnotationDraft({ note: '', color: ANNOTATION_COLORS[0] });
      await loadCurrent();
    } catch (requestError) {
      window.alert(requestError.message);
    } finally {
      setAnnotationSaving(false);
    }
  };

  const jumpToHeading = (headingId) => {
    if (!headingId) return;
    const element = document.getElementById(headingId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveHeadingId(headingId);
    }
  };

  const jumpToMatch = (match, index = 0) => {
    if (!match) return;
    setActiveSearchIndex(index);
    if (match.headingId) setActiveHeadingId(match.headingId);
  };

  const navigateSearch = (direction = 1) => {
    if (!searchData.matches.length) return;
    setActiveSearchIndex((prev) => {
      const next = prev < 0 ? 0 : (prev + direction + searchData.matches.length) % searchData.matches.length;
      return next;
    });
  };

  const handleReferenceClick = (reference) => {
    if (!reference?.targetNodeId || !reference?.targetSenseId) return;
    onBack && onBack({
      action: 'openArticle',
      nodeId: reference.targetNodeId,
      senseId: reference.targetSenseId,
      sourceHint: reference.displayText || reference.targetTitle || ''
    });
  };

  const handleReferenceHover = (reference, anchorElement) => {
    if (!reference || !anchorElement) {
      setReferencePreview(null);
      return;
    }
    const rect = anchorElement.getBoundingClientRect();
    setReferencePreview({
      reference,
      rect: {
        left: rect.left + window.scrollX,
        top: rect.bottom + window.scrollY + 8
      }
    });
  };

  const renderSelectionToolbar = () => {
    if (!selectionAnchor?.selectionText) return null;
    const style = {
      left: `${selectionAnchor.rect.left}px`,
      top: `${Math.max(24, selectionAnchor.rect.top - 12)}px`
    };
    return (
      <div className="sense-selection-toolbar" style={style} ref={selectionToolbarRef}>
        <div className="sense-selection-toolbar-title">已选中：{selectionAnchor.selectionText.slice(0, 36)}{selectionAnchor.selectionText.length > 36 ? '…' : ''}</div>
        <div className="sense-selection-toolbar-actions">
          <button type="button" className="btn btn-small btn-primary" onClick={() => onOpenEditor && onOpenEditor({ mode: 'selection', anchor: selectionAnchor })}>
            选段修订
          </button>
          <button type="button" className="btn btn-small btn-secondary" onClick={createAnnotation} disabled={annotationSaving}>
            {annotationSaving ? '保存中...' : '高亮/标注'}
          </button>
        </div>
        <div className="sense-annotation-inline-form">
          <div className="sense-annotation-color-row">
            {ANNOTATION_COLORS.map((color) => (
              <button key={color} type="button" className={`sense-color-swatch ${annotationDraft.color === color ? 'active' : ''}`} style={{ backgroundColor: color }} onClick={() => setAnnotationDraft((prev) => ({ ...prev, color }))} />
            ))}
          </div>
          <textarea value={annotationDraft.note} placeholder="仅自己可见的备注" onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, note: event.target.value }))} />
        </div>
      </div>
    );
  };

  const renderReferencePreview = () => {
    if (!referencePreview?.reference) return null;
    const style = { left: `${referencePreview.rect.left}px`, top: `${referencePreview.rect.top}px` };
    const ref = referencePreview.reference;
    return (
      <div className="sense-reference-preview-card" style={style}>
        <div className="sense-reference-preview-title">{ref.targetNodeName || '知识域'} / {ref.targetTitle || ref.targetSenseId}</div>
        <div className="sense-reference-preview-meta">状态：{getReferenceTargetStatusLabel(ref.targetStatus, ref.isValid)}</div>
        <div className="sense-reference-preview-body">{ref.targetSummary || '暂无预览摘要'}</div>
      </div>
    );
  };

  const renderMyEditsModal = () => {
    if (!myEditsOpen) return null;
    return (
      <div className="sense-floating-backdrop" onClick={() => setMyEditsOpen(false)}>
        <div className="sense-floating-panel" onClick={(event) => event.stopPropagation()}>
          <div className="sense-floating-panel-header">
            <div>
              <div className="sense-side-card-title"><Sparkles size={16} /> 我的编辑</div>
              <div className="sense-floating-panel-subtitle">这里显示你当前的草稿，以及你已提交但仍在待审核中的修订。</div>
            </div>
            <button type="button" className="btn btn-small btn-secondary" onClick={() => setMyEditsOpen(false)}>关闭</button>
          </div>
          {myEditsLoading ? <SenseArticleStateView compact kind="loading" title="正在读取我的编辑" description="正在加载你自己的草稿和待审核修订。" /> : null}
          {!myEditsLoading && myEditsError ? <SenseArticleStateView compact kind="error" title="我的编辑加载失败" description={myEditsError} /> : null}
          {!myEditsLoading && !myEditsError ? (
            <div className="sense-floating-panel-body">
              {myEdits.length === 0 ? <SenseArticleStateView compact kind="empty" title="暂无我的编辑" description="这里会显示你自己的草稿，以及你已提交但仍待审核的修订。" /> : myEdits.map((item) => (
                <div key={item._id} className="sense-annotation-card sense-my-edit-card">
                  <div className="sense-annotation-card-head"><strong>{getRevisionDisplayTitle(item)}</strong></div>
                  <div className="sense-annotation-card-meta">{item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '--'} · {getRevisionStatusLabel(item.status || 'draft')}</div>
                  {item.proposedSenseTitle && item.proposedSenseTitle !== (pageData?.nodeSense?.title || senseId) ? <div className="sense-annotation-card-body">待生效释义名：{item.proposedSenseTitle}</div> : null}
                  <div className="sense-floating-panel-actions">
                    {String(item?.status || '').trim() === 'draft' ? (
                      <button type="button" className="btn btn-small btn-primary" onClick={() => {
                        setMyEditsOpen(false);
                        onOpenEditor && onOpenEditor({ mode: 'full', revisionId: item._id });
                      }}>
                        继续编辑
                      </button>
                    ) : (
                      <button type="button" className="btn btn-small btn-secondary" onClick={() => {
                        setMyEditsOpen(false);
                        onOpenReview && onOpenReview(item);
                      }}>
                        查看审核状态
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  if (loading) return <div className="sense-article-page" style={pageThemeStyle}><SenseArticleStateView kind="loading" title="正在加载阅读页" description="正在读取当前释义百科页的发布版、正文引用与私有标注。" /></div>;
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
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onOpenEditor({ mode: 'full' })}
            >
              <PenSquare size={16} /> 创建首个百科版本
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={() => setMyEditsOpen(true)}>
            <Sparkles size={16} /> 我的编辑
          </button>
          {onOpenHistory ? (
            <button type="button" className="btn btn-secondary" onClick={() => onOpenHistory()}>
              <History size={16} /> 历史版本
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>
        </>
      )
      : <button type="button" className="btn btn-secondary" onClick={onBack}>返回</button>;
    return <div className="sense-article-page" style={pageThemeStyle}>{renderMyEditsModal()}<SenseArticleStateView {...state} action={action} /></div>;
  }

  const node = pageData?.node || {};
  const nodeSense = pageData?.nodeSense || {};
  const revision = pageData?.revision || null;
  const permissions = pageData?.permissions || {};
  const readingMeta = pageData?.readingMeta || {};
  const revisionAuthor = readingMeta?.revisionAuthor || null;
  const canUpdateSenseArticle = !!permissions.isDomainMaster || !!permissions.canReviewSenseArticle;
  const title = `${node.name || '未命名知识域'}-${nodeSense.title || senseId}`;
  const readingMetaItems = [
    revision?.updatedAt ? `修订时间 ${new Date(revision.updatedAt).toLocaleString('zh-CN', { hour12: false })}` : '修订时间 --',
    revisionAuthor ? (
      <span className="sense-reading-meta-person">
        <img
          src={resolveArticleAvatarSrc(revisionAuthor.avatar)}
          alt={revisionAuthor.username || '修订人'}
          className="sense-reading-meta-avatar"
        />
        <span>{`修订人 ${revisionAuthor.username || '--'}`}</span>
      </span>
    ) : '修订人 --',
    `收藏人数 ${Number(readingMeta?.favoriteCount || 0)}`
  ];

  return (
    <div className="sense-article-page" style={pageThemeStyle}>
      {renderMyEditsModal()}
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
              <button type="button" className="btn btn-primary" onClick={() => onOpenEditor && onOpenEditor({ mode: 'full' })}>
                <PenSquare size={16} /> 更新释义
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={() => onOpenHistory && onOpenHistory()}>
              <History size={16} /> 历史版本
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setMyEditsOpen(true)}>
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
          <div className="sense-side-card">
            <div className="sense-side-card-title">目录</div>
            <div className="sense-toc-list">
              {headingIndex.length === 0 ? <SenseArticleStateView compact kind="empty" title="暂无目录" description="当前发布版没有可索引的小节标题。" /> : headingIndex.map((heading) => (
                <div key={heading.headingId} className={`sense-toc-item level-${heading.level || 1} ${activeHeadingId === heading.headingId ? 'active' : ''}`}>
                  <button type="button" onClick={() => jumpToHeading(heading.headingId)}>{heading.title}</button>
                  <button type="button" className="sense-mini-action" onClick={() => onOpenEditor && onOpenEditor({ mode: 'heading', headingId: heading.headingId })}>编辑本节</button>
                </div>
              ))}
            </div>
          </div>
          <div className="sense-side-card">
            <div className="sense-side-card-title">页内搜索</div>
            <div className="sense-search-box">
              <Search size={16} />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索正文 / 标题 / 公式" />
            </div>
            <div className="sense-search-meta-row">
              <span>命中 {searchData.total}</span>
              <span>{searchData.total > 0 ? `${activeSearchIndex + 1}/${searchData.total}` : '0/0'}</span>
              <button type="button" className="sense-mini-action" onClick={() => navigateSearch(-1)} disabled={!searchData.total}>上一个</button>
              <button type="button" className="sense-mini-action" onClick={() => navigateSearch(1)} disabled={!searchData.total}>下一个</button>
            </div>
            <div className="sense-search-results">
              {(searchData.groups || []).map((group) => (
                <div key={group.headingId || 'root'} className="sense-search-group">
                  <div className="sense-search-group-title">{group.headingTitle || (group.headingId === 'root' ? '前言' : group.headingId)} · {group.count}</div>
                  {(group.matches || []).map((item) => {
                    const matchIndex = searchData.matches.findIndex((candidate) => candidate.blockId === item.blockId && candidate.position === item.position);
                    return (
                      <button key={`${item.blockId}-${item.position}`} type="button" className={`sense-search-result-item ${activeSearchMatch && activeSearchMatch.blockId === item.blockId && activeSearchMatch.position === item.position ? 'active' : ''}`} onClick={() => jumpToMatch(item, matchIndex)}>
                        {item.snippet}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="sense-article-main">
          {renderSelectionToolbar()}
          {renderReferencePreview()}
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
              {annotations.length === 0 ? <SenseArticleStateView compact kind="empty" title="暂无私有标注" description="你可以在阅读页选中文本后创建仅自己可见的高亮与备注。" /> : annotations.map((annotation) => {
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
              })}
            </div>
          </div>
          <div className="sense-side-card">
            <div className="sense-side-card-title">标注状态</div>
            <div className="sense-status-row"><MessageSquare size={16} /> 精确 {annotationsByStatus.exact.length}</div>
            <div className="sense-status-row"><MessageSquare size={16} /> 重定位 {annotationsByStatus.relocated.length}</div>
            <div className="sense-status-row"><MessageSquare size={16} /> 待确认 {annotationsByStatus.uncertain.length}</div>
            <div className="sense-status-row"><MessageSquare size={16} /> 失效 {annotationsByStatus.broken.length}</div>
          </div>
          <div className="sense-side-card">
            <div className="sense-side-card-title"><Eye size={16} /> 当前页引用</div>
            <div className="sense-annotation-list">
              {(referenceData.references || []).length === 0 ? <SenseArticleStateView compact kind="empty" title="本页暂无正文引用" description="当前发布版未引用其他释义百科页。" /> : referenceData.references.slice(0, 8).map((item) => (
                <button key={item.referenceId} type="button" className="sense-annotation-card sense-backlink-card" onClick={() => handleReferenceClick(item)}>
                  <div className="sense-annotation-card-head"><strong>{item.targetNodeName || '知识域'} / {item.targetTitle || item.targetSenseId}</strong></div>
                  <div className="sense-annotation-card-meta">{item.targetSummary || '暂无摘要'} <ArrowUpRight size={12} /></div>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default SenseArticlePage;
