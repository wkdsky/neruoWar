import React from 'react';
import { buildSenseArticleThemeStyle } from '../senseArticle/senseArticleTheme';
import {
  DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE,
  normalizeAllianceSenseArticleStyle
} from '../../utils/allianceVisualStyle';
import './AllianceSenseArticleStylePreview.css';

const AllianceSenseArticleStylePreview = ({ styleConfig, label = '百科页预览', className = '' }) => {
  const style = normalizeAllianceSenseArticleStyle(styleConfig, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.name);
  const previewThemeStyle = buildSenseArticleThemeStyle({
    allianceSenseArticleStyle: style,
    allianceName: style.name
  });

  return (
    <div className={`alliance-sense-preview ${className}`.trim()} style={previewThemeStyle}>
      <div className="alliance-sense-preview-shell">
        <div className="alliance-sense-preview-header">
          <div className="alliance-sense-preview-kicker">释义百科页 · {label}</div>
          <div className="alliance-sense-preview-title">知识域 / 释义题目 / 阅读页</div>
          <div className="alliance-sense-preview-meta">
            <span>最近更新 1000-01-01 01:00:00</span>
            <span>更新人 盟内学士</span>
          </div>
        </div>
        <div className="alliance-sense-preview-layout">
          <aside className="alliance-sense-preview-side">
            <div className="alliance-sense-preview-card-title">词条管理入口</div>
            <button type="button" className="btn btn-secondary">词条管理</button>
            <button type="button" className="btn btn-primary">更新释义</button>
            <button type="button" className="btn btn-secondary">历史版本</button>
          </aside>
          <main className="alliance-sense-preview-main">
            <h4>正文示例</h4>
            <p>这是一段百科正文预览，用于展示页面背景、正文卡片、标题色与正文字色的搭配效果。</p>
            <p>
              盟主可为百科页单独设置 <span className="alliance-sense-preview-inline">高亮强调</span>、代码块、边框和卡片层次，
              不必与知识域主视觉完全相同。
            </p>
            <pre className="alliance-sense-preview-code">术语：EntropyAllianceStyle {'{'} accentColor, contentBackground {'}'}</pre>
          </main>
        </div>
      </div>
    </div>
  );
};

export default AllianceSenseArticleStylePreview;
