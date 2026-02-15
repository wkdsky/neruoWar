import React from 'react';
import { normalizeAllianceVisualStyle } from '../../utils/allianceVisualStyle';
import './AllianceStylePreview.css';

const AllianceStylePreview = ({ styleConfig, label = '示例', className = '' }) => {
  const style = normalizeAllianceVisualStyle(styleConfig, '示例风格');

  return (
    <div className={`alliance-style-preview ${className}`.trim()}>
      <div
        className={`alliance-style-preview-sphere pattern-${style.patternType}`}
        style={{
          '--sphere-primary': style.primaryColor,
          '--sphere-secondary': style.secondaryColor,
          '--sphere-glow': style.glowColor,
          '--sphere-rim': style.rimColor,
          '--sphere-text': style.textColor
        }}
      >
        <span className="alliance-style-preview-label">{label}</span>
      </div>
    </div>
  );
};

export default AllianceStylePreview;
