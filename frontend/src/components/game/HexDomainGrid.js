import React, { useEffect, useMemo, useRef, useState } from 'react';
import HexDomainCard from './HexDomainCard';
import { buildHoneycombLayout } from './hexUtils';
import './HexDomainGrid.css';

const useElementWidth = () => {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const update = () => {
      setWidth(element.getBoundingClientRect().width || 0);
    };

    update();
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => update())
      : null;

    if (resizeObserver) {
      resizeObserver.observe(element);
    } else {
      window.addEventListener('resize', update);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', update);
      }
    };
  }, []);

  return [containerRef, width];
};

const HexSection = ({
  title,
  eyebrow,
  nodes,
  variant,
  width,
  activeNodeId,
  onActivate
}) => {
  const layout = useMemo(() => buildHoneycombLayout(nodes, width, {
    minWidth: variant === 'root' ? 132 : 116,
    maxWidth: variant === 'root' ? 192 : 168,
    maxColumns: variant === 'root' ? 5 : 4
  }), [nodes, width, variant]);

  return (
    <section className={`hex-domain-section hex-domain-section--${variant}`}>
      <header className="hex-domain-section__header">
        <span className="hex-domain-section__eyebrow">{eyebrow}</span>
        <h2 className="hex-domain-section__title">{title}</h2>
      </header>

      <div
        className="hex-domain-section__stage"
        style={{
          width: layout.width ? `${layout.width}px` : '100%',
          height: layout.height ? `${layout.height}px` : 0
        }}
      >
        {layout.cards.map((card) => (
          <HexDomainCard
            key={`${variant}_${card.item?._id || card.index}`}
            node={card.item}
            variant={variant}
            isActive={activeNodeId && String(card.item?._id || '') === String(activeNodeId)}
            enterDelayMs={card.enterDelayMs}
            positionStyle={{
              left: `${card.x}px`,
              top: `${card.y}px`,
              width: `${card.width}px`,
              height: `${card.height}px`
            }}
            onActivate={onActivate}
          />
        ))}
      </div>
    </section>
  );
};

const HexDomainGrid = ({
  rootNodes = [],
  featuredNodes = [],
  activeNodeId = '',
  onActivate
}) => {
  const [containerRef, width] = useElementWidth();

  return (
    <div ref={containerRef} className="hex-domain-grid-shell">
      <div className="hex-domain-grid-frame" />
      <div className="hex-domain-grid">
        <HexSection
          title="根知识域"
          eyebrow="Knowledge Roots"
          nodes={rootNodes}
          variant="root"
          width={width}
          activeNodeId={activeNodeId}
          onActivate={onActivate}
        />
        <div className="hex-domain-grid__divider" aria-hidden="true">
          <span className="hex-domain-grid__divider-line" />
          <span className="hex-domain-grid__divider-core" />
          <span className="hex-domain-grid__divider-line" />
        </div>
        <HexSection
          title="热门知识域"
          eyebrow="Curated Domains"
          nodes={featuredNodes}
          variant="featured"
          width={Math.max(0, width * 0.92)}
          activeNodeId={activeNodeId}
          onActivate={onActivate}
        />
      </div>
    </div>
  );
};

export default HexDomainGrid;
