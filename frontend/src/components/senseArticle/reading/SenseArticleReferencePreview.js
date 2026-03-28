import React from 'react';
import { getReferenceTargetStatusLabel } from '../senseArticleUi';
import { buildReferencePreviewStyle } from './senseArticleReadingUi';

const SenseArticleReferencePreview = ({ referencePreview }) => {
  if (!referencePreview?.reference) return null;

  const style = buildReferencePreviewStyle(referencePreview);
  const ref = referencePreview.reference;

  return (
    <div className="sense-reference-preview-card" style={style}>
      <div className="sense-reference-preview-title">{ref.targetNodeName || '知识域'} / {ref.targetTitle || ref.targetSenseId}</div>
      <div className="sense-reference-preview-meta">状态：{getReferenceTargetStatusLabel(ref.targetStatus, ref.isValid)}</div>
      <div className="sense-reference-preview-body">{ref.targetSummary || '暂无预览摘要'}</div>
    </div>
  );
};

export default SenseArticleReferencePreview;
