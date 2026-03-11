import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GitCompare, Image as ImageIcon, Link2, Rows, Sigma } from 'lucide-react';
import SenseArticleStateView from './SenseArticleStateView';
import './SenseArticle.css';

const changeLabelMap = {
  heading_added: '新增小节',
  heading_removed: '删除小节',
  heading_renamed: '标题变更',
  section_added: '新增内容',
  section_removed: '删除内容',
  section_modified: '正文变更',
  references_changed: '引用变更',
  formulas_changed: '公式变更',
  tables_changed: '表格变化',
  media_changed: '媒体变化',
  heading_level_changed: '标题级别变化'
};

const blockKindLabelMap = {
  heading: '标题',
  paragraph: '段落',
  list: '列表',
  blockquote: '引用块',
  code_block: '代码块',
  table: '表格',
  media: '媒体',
  divider: '分割线'
};

const formatTableMeta = (meta = {}) => {
  if (!meta || typeof meta !== 'object') return '—';
  const widthLabel = meta.tableWidthMode === 'auto' ? '自适应' : `${meta.tableWidthValue || '100'}%`;
  return [
    `样式 ${meta.tableStyle || 'default'}`,
    `宽度 ${widthLabel}`,
    `边框 ${meta.tableBorderPreset || 'all'}`,
    meta.columnWidths ? `列宽 ${meta.columnWidths}` : '',
    Number(meta.mergedCellCount || 0) > 0 ? `合并 ${meta.mergedCellCount}${meta.mergedAreaPreview ? ` (${meta.mergedAreaPreview})` : ''}` : '',
    Number(meta.diagonalCellCount || 0) > 0 ? `斜线 ${meta.diagonalCellCount}` : ''
  ].filter(Boolean).join(' · ') || '—';
};

const renderLineDiff = (lineDiff = {}) => {
  const changes = Array.isArray(lineDiff?.changes) ? lineDiff.changes : [];
  if (changes.length === 0) {
    return <SenseArticleStateView kind="empty" compact title="无源码差异" description="该 section 在源码层面没有可展示的行级变化。" />;
  }
  return (
    <div className="sense-diff-view compact">
      {changes.map((item, index) => (
        <div key={`${item.type}-${index}`} className={`sense-diff-line ${item.type}`}>
          <span className="sense-diff-sign">{item.type === 'added' ? '+' : item.type === 'removed' ? '-' : ' '}</span>
          <code>{item.text || ' '}</code>
        </div>
      ))}
    </div>
  );
};

const renderBlockDiff = (blockDiff = {}) => {
  const changes = Array.isArray(blockDiff?.changes) ? blockDiff.changes.filter((item) => item.status !== 'equal') : [];
  if (changes.length === 0) {
    return <SenseArticleStateView kind="empty" compact title="无块级差异" description="该 section 在块级结构上没有明显变化。" />;
  }
  return (
    <div className="sense-compare-block-list">
      {changes.map((item, index) => (
        <div key={`${item.status}-${item.blockKind}-${index}`} className={`sense-compare-block-row ${item.status}`}>
          <div className="sense-compare-block-meta">
            <span className="sense-pill">{item.status === 'added' ? '新增' : item.status === 'removed' ? '删除' : '修改'}</span>
            <strong>{item.label || blockKindLabelMap[item.blockKind] || '内容块'}</strong>
          </div>
          <div className="sense-compare-block-preview-grid">
            <div>
              <div className="sense-compare-preview-title">变更前</div>
              <div className="sense-compare-preview-text">{item.fromPreview || '—'}</div>
            </div>
            <div>
              <div className="sense-compare-preview-title">变更后</div>
              <div className="sense-compare-preview-text">{item.toPreview || '—'}</div>
            </div>
          </div>
          {item.details?.levelChanged ? (
            <div className="sense-compare-meta-text">标题级别：H{item.details.fromLevel || 0} → H{item.details.toLevel || 0}</div>
          ) : null}
          {item.blockKind === 'table' ? (
            <div className="sense-compare-meta-text">
              表格元数据：{formatTableMeta(item.details?.fromMeta)} → {formatTableMeta(item.details?.toMeta)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
};

const SenseArticleComparePanel = ({ compare = null, title = '结构化对比', loading = false, error = null, emptyMessage = '暂无对比数据' }) => {
  const sections = useMemo(() => (Array.isArray(compare?.sections) ? compare.sections : []), [compare]);
  const firstChangedKey = useMemo(() => sections.find((item) => item.hasChanges)?.sectionKey || '', [sections]);
  const hasAnyChanges = useMemo(() => {
    if (!compare?.summary) return sections.some((item) => item.hasChanges);
    return Object.values(compare.summary).some((value) => Number(value || 0) > 0);
  }, [compare?.summary, sections]);
  const [expandedKeys, setExpandedKeys] = useState({});

  useEffect(() => {
    setExpandedKeys(firstChangedKey ? { [firstChangedKey]: true } : {});
  }, [firstChangedKey]);

  const toggleSection = (sectionKey) => {
    setExpandedKeys((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  if (loading) {
    return <SenseArticleStateView kind="loading" title="正在生成结构化对比" description="正在整理小节级变更、引用变化与公式变化。" />;
  }
  if (error) {
    return <SenseArticleStateView kind="error" title="版本对比加载失败" description={error.message || '请稍后重试'} />;
  }
  if (!compare) {
    return <SenseArticleStateView kind="empty" title="暂无对比结果" description={emptyMessage} />;
  }
  if (!hasAnyChanges) {
    return (
      <div className="sense-compare-panel">
        <div className="sense-editor-pane-title"><GitCompare size={16} /> {title}</div>
        <SenseArticleStateView kind="empty" title="两个版本没有可展示差异" description="当前 compare 结果没有 section、块级、引用、公式、表格或媒体变化。" />
      </div>
    );
  }

  return (
    <div className="sense-compare-panel">
      <div className="sense-editor-pane-title"><GitCompare size={16} /> {title}</div>
      <div className="sense-compare-summary-grid">
        <span className="sense-pill">新增小节 {compare.summary?.sectionAdded || 0}</span>
        <span className="sense-pill">删除小节 {compare.summary?.sectionRemoved || 0}</span>
        <span className="sense-pill">正文变更 {compare.summary?.sectionModified || 0}</span>
        <span className="sense-pill">标题变更 {compare.summary?.headingRenamed || 0}</span>
        <span className="sense-pill">标题级别变化 {compare.summary?.headingLevelChanged || 0}</span>
        <span className="sense-pill">块新增 {compare.summary?.blockAdded || 0}</span>
        <span className="sense-pill">块删除 {compare.summary?.blockRemoved || 0}</span>
        <span className="sense-pill">块修改 {compare.summary?.blockModified || 0}</span>
        <span className="sense-pill"><Rows size={14} /> 表格变化 {compare.summary?.tableChanged || 0}</span>
        <span className="sense-pill"><ImageIcon size={14} /> 媒体变化 {compare.summary?.mediaChanged || 0}</span>
        <span className="sense-pill">引用变化 {(compare.summary?.referenceAdded || 0) + (compare.summary?.referenceRemoved || 0) + (compare.summary?.referenceModified || 0)}</span>
        <span className="sense-pill">公式变更 {compare.summary?.formulaChangedSections || 0}</span>
      </div>
      <div className="sense-compare-section-list">
        {sections.length === 0 ? <SenseArticleStateView kind="empty" compact title="没有可显示的小节差异" description="当前对比结果没有 section 级差异。" /> : sections.map((section) => {
          const isExpanded = !!expandedKeys[section.sectionKey];
          const tags = (section.changeTypes || []).map((item) => changeLabelMap[item] || item);
          return (
            <div key={section.sectionKey} className={`sense-compare-section-card ${section.hasChanges ? 'changed' : ''}`}>
              <button type="button" className="sense-compare-section-header" onClick={() => toggleSection(section.sectionKey)} aria-expanded={isExpanded}>
                <span className="sense-compare-section-toggle">{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                <span className="sense-compare-section-title">{section.headingTitle || '前言'}</span>
                <span className="sense-compare-section-tags">
                  {section.hasChanges ? <span className="sense-pill">有变化</span> : <span className="sense-pill">仅上下文</span>}
                  {tags.map((item) => <span key={item} className="sense-pill">{item}</span>)}
                </span>
              </button>
              {isExpanded ? (
                <div className="sense-compare-section-body">
                  <div className="sense-compare-preview-grid">
                    <div>
                      <div className="sense-compare-preview-title">变更前</div>
                      <div className="sense-compare-preview-text">{section.preview?.fromSnippet || '—'}</div>
                    </div>
                    <div>
                      <div className="sense-compare-preview-title">变更后</div>
                      <div className="sense-compare-preview-text">{section.preview?.toSnippet || '—'}</div>
                    </div>
                  </div>
                  {(section.referenceChanges?.totalChanged || 0) > 0 ? (
                    <div className="sense-compare-meta-block">
                      <div className="sense-compare-meta-title"><Link2 size={14} /> 引用变化</div>
                      <div className="sense-compare-meta-text">新增 {section.referenceChanges.added.length} · 删除 {section.referenceChanges.removed.length} · 显示文本变化 {section.referenceChanges.modified.length}</div>
                    </div>
                  ) : null}
                  {section.formulaChanges?.changed ? (
                    <div className="sense-compare-meta-block">
                      <div className="sense-compare-meta-title"><Sigma size={14} /> 公式变化</div>
                      <div className="sense-compare-meta-text">新增 {section.formulaChanges.added.length} · 删除 {section.formulaChanges.removed.length}</div>
                    </div>
                  ) : null}
                  {section.blockDiff ? (
                    <div className="sense-compare-meta-block">
                      <div className="sense-compare-meta-title"><Rows size={14} /> 块级变化</div>
                      <div className="sense-compare-meta-text">新增 {section.blockDiff.summary?.added || 0} · 删除 {section.blockDiff.summary?.removed || 0} · 修改 {section.blockDiff.summary?.modified || 0}</div>
                      {renderBlockDiff(section.blockDiff)}
                    </div>
                  ) : null}
                  {renderLineDiff(section.lineDiff)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SenseArticleComparePanel;
