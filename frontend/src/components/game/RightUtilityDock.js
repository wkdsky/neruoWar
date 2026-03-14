import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './RightUtilityDock.css';

const RightUtilityDock = ({
  sections = []
}) => {
  const visibleSections = sections.filter((section) => section && !section.hidden);

  if (visibleSections.length < 1) return null;

  return (
    <div className="utility-dock-rail" aria-label="右侧工具坞">
      {visibleSections.map((section, index) => {
        const Icon = section.icon;
        return (
          <div
            key={section.id}
            className={`utility-dock-row${section.active ? ' is-active' : ''}${index === 0 ? ' is-first' : ''}${index === visibleSections.length - 1 ? ' is-last' : ''}`}
            style={section.panelWidth ? { '--utility-panel-width': `${section.panelWidth}px` } : undefined}
          >
            {/* panel 改成绝对定位到按钮列左侧，避免展开时把按钮之间“撑开”。 */}
            <div
              className={`utility-dock-panel-slot${section.active ? ' is-open' : ''}`}
              aria-hidden={!section.active}
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
