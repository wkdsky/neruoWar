import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
