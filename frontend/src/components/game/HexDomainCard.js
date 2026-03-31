import React, { useMemo, useRef } from 'react';
import { Compass, Sparkles } from 'lucide-react';
import { getNodeDisplayName, getNodeSenseSummary, getNodeSenseTitle } from './hexUtils';
import './HexDomainCard.css';

const HexDomainCard = ({
  node,
  variant = 'root',
  isActive = false,
  disabled = false,
  positionStyle = {},
  enterDelayMs = 0,
  onActivate
}) => {
  const buttonRef = useRef(null);
  const title = getNodeDisplayName(node);
  const senseTitle = getNodeSenseTitle(node);
  const summary = getNodeSenseSummary(node);
  const titleLength = Array.from(String(title || '')).length;
  const senseLength = Array.from(String(senseTitle || '')).length;
  const summaryLength = Array.from(String(summary || '')).length;
  const isLongTitle = titleLength >= 10 || senseLength >= 14;
  const isDenseContent = titleLength >= 16 || senseLength >= 22 || summaryLength >= 72;
  const Icon = variant === 'featured' ? Sparkles : Compass;
  const metaLabel = variant === 'featured' ? '热门知识域' : '根知识域';

  const buttonStyle = useMemo(() => ({
    ...positionStyle,
    '--hex-enter-delay': `${Math.max(0, enterDelayMs)}ms`,
    '--hex-card-inline-padding': isDenseContent ? '10.5%' : (isLongTitle ? '12.5%' : '15.5%'),
    '--hex-card-block-padding': isDenseContent ? '12.5%' : (isLongTitle ? '14.5%' : '17.5%')
  }), [enterDelayMs, isDenseContent, isLongTitle, positionStyle]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`hex-domain-card hex-domain-card--${variant}${isActive ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}${isLongTitle ? ' is-long-title' : ''}${isDenseContent ? ' is-dense-content' : ''}`}
      style={buttonStyle}
      onClick={() => {
        if (!disabled && typeof onActivate === 'function') {
          onActivate(node, buttonRef.current);
        }
      }}
      disabled={disabled}
      aria-label={title}
    >
      <div className="hex-domain-card__content">
        <div className="hex-domain-card__eyebrow">
          <Icon size={13} strokeWidth={1.8} />
          <span>{metaLabel}</span>
        </div>
        <div className="hex-domain-card__title">{title}</div>
        {senseTitle ? <div className="hex-domain-card__sense">{senseTitle}</div> : null}
        {summary ? <div className="hex-domain-card__summary">{summary}</div> : null}
      </div>
    </button>
  );
};

export default HexDomainCard;
