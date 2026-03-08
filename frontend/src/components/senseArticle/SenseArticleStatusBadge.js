import React from 'react';
import {
  getReferenceTargetStatusLabel,
  getReferenceTargetStatusTone,
  getRevisionStatusLabel,
  getRevisionStatusTone
} from './senseArticleUi';
import './SenseArticle.css';

const SenseArticleStatusBadge = ({
  status = '',
  type = 'revision',
  isValid = false,
  className = '',
  children = null,
  tone = ''
}) => {
  const label = children || (type === 'reference'
    ? getReferenceTargetStatusLabel(status, isValid)
    : getRevisionStatusLabel(status));
  const resolvedTone = tone || (type === 'reference'
    ? getReferenceTargetStatusTone(status, isValid)
    : getRevisionStatusTone(status));
  return (
    <span className={`sense-status-badge tone-${resolvedTone} ${className}`.trim()}>
      {label}
    </span>
  );
};

export default SenseArticleStatusBadge;
