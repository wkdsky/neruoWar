import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { readResponsiveViewportWidth } from '../../app/appShared';
import './RightUtilityDock.css';

const RightUtilityDock = ({
  sections = []
}) => {
  const visibleSections = useMemo(
    () => sections.filter((section) => section && !section.hidden),
    [sections]
  );
  const rowRefs = useRef({});
  const [panelTopOffsets, setPanelTopOffsets] = useState({});

  useLayoutEffect(() => {
    const measureOffsets = () => {
      const nextOffsets = {};
      visibleSections.forEach((section) => {
        const rowNode = rowRefs.current[section.id];
        if (!rowNode) return;
        nextOffsets[section.id] = rowNode.offsetTop || 0;
      });
      setPanelTopOffsets((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(nextOffsets);
        if (
          prevKeys.length === nextKeys.length
          && nextKeys.every((key) => prev[key] === nextOffsets[key])
        ) {
          return prev;
        }
        return nextOffsets;
      });
    };

    measureOffsets();
    window.addEventListener('resize', measureOffsets);
    return () => window.removeEventListener('resize', measureOffsets);
  }, [visibleSections]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const hasOpenPanel = visibleSections.some((section) => section?.active);
    const isMobileDock = readResponsiveViewportWidth() <= 920;
    if (!hasOpenPanel || !isMobileDock) {
      return undefined;
    }

    const { body } = document;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      touchAction: body.style.touchAction
    };

    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.touchAction = 'none';

    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.touchAction = previous.touchAction;
      window.scrollTo(0, scrollY);
    };
  }, [visibleSections]);

  if (visibleSections.length < 1) return null;

  return (
    <div className="utility-dock-rail" aria-label="右侧工具坞">
      {visibleSections.map((section, index) => {
        const Icon = section.icon;
        return (
          <div
            key={section.id}
            ref={(node) => {
              if (node) {
                rowRefs.current[section.id] = node;
                return;
              }
              delete rowRefs.current[section.id];
            }}
            className={`utility-dock-row${section.active ? ' is-active' : ''}${index === 0 ? ' is-first' : ''}${index === visibleSections.length - 1 ? ' is-last' : ''}`}
            style={section.panelWidth ? { '--utility-panel-width': `${section.panelWidth}px` } : undefined}
          >
            <div
              className={`utility-dock-panel-slot${section.active ? ' is-open' : ''}`}
              aria-hidden={!section.active}
              style={{
                top: `${0 - (panelTopOffsets[section.id] || 0)}px`
              }}
            >
              <div className={`utility-dock-panel-shell${section.active ? ' is-open' : ''}`}>
                {section.panel}
              </div>
            </div>

            <button
              type="button"
              className={`utility-dock-trigger${section.active ? ' is-active' : ''}`}
              onClick={section.onToggle}
              title={section.active ? `收起${section.label}` : `展开${section.label}`}
              aria-expanded={section.active}
            >
              <span className="utility-dock-trigger__icon">
                {Icon ? <Icon size={16} strokeWidth={1.9} /> : null}
              </span>
              <span className="utility-dock-trigger__label" aria-hidden="true">{section.label}</span>
              {section.badge ? (
                <span className={`utility-dock-trigger__badge${section.badge === 'dot' ? ' is-dot' : ''}`}>
                  {section.badge === 'dot' ? '' : section.badge}
                </span>
              ) : null}
              <span className="utility-dock-trigger__arrow" aria-hidden="true">
                {section.active ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default RightUtilityDock;
