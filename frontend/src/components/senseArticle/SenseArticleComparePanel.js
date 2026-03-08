import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GitCompare, Link2, Sigma } from 'lucide-react';
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
  formulas_changed: '公式变更'
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

const SenseArticleComparePanel = ({ compare = null, title = '结构化对比', loading = false, error = null, emptyMessage = '暂无对比数据' }) => {
  const sections = Array.isArray(compare?.sections) ? compare.sections : [];
  const firstChangedKey = useMemo(() => sections.find((item) => item.hasChanges)?.sectionKey || '', [sections]);
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

  return (
    <div className="sense-compare-panel">
      <div className="sense-editor-pane-title"><GitCompare size={16} /> {title}</div>
      <div className="sense-compare-summary-grid">
        <span className="sense-pill">新增小节 {compare.summary?.sectionAdded || 0}</span>
        <span className="sense-pill">删除小节 {compare.summary?.sectionRemoved || 0}</span>
        <span className="sense-pill">正文变更 {compare.summary?.sectionModified || 0}</span>
        <span className="sense-pill">标题变更 {compare.summary?.headingRenamed || 0}</span>
        <span className="sense-pill">引用变化 {(compare.summary?.referenceAdded || 0) + (compare.summary?.referenceRemoved || 0) + (compare.summary?.referenceModified || 0)}</span>
        <span className="sense-pill">公式变更 {compare.summary?.formulaChangedSections || 0}</span>
      </div>
      <div className="sense-compare-section-list">
        {sections.length === 0 ? <SenseArticleStateView kind="empty" compact title="没有可显示的小节差异" description="当前对比结果没有 section 级差异。" /> : sections.map((section) => {
          const isExpanded = !!expandedKeys[section.sectionKey];
          const tags = (section.changeTypes || []).map((item) => changeLabelMap[item] || item);
          return (
            <div key={section.sectionKey} className={`sense-compare-section-card ${section.hasChanges ? 'changed' : ''}`}>
              <button type="button" className="sense-compare-section-header" onClick={() => toggleSection(section.sectionKey)}>
                <span className="sense-compare-section-toggle">{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                <span className="sense-compare-section-title">{section.headingTitle || '前言'}</span>
                <span className="sense-compare-section-tags">{tags.map((item) => <span key={item} className="sense-pill">{item}</span>)}</span>
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
