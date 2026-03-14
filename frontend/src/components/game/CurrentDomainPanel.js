import React from 'react';
import { ArrowRight, Clock3, Compass, MapPin, Navigation, X } from 'lucide-react';
import './AnnouncementPanel.css';
import './CurrentDomainPanel.css';

const CurrentDomainPanel = ({
  isTraveling = false,
  panelTitle = '当前位置',
  title = '',
  breadcrumb = [],
  summary = '',
  statusChips = [],
  stats = [],
  leaders = [],
  parentLabels = [],
  childLabels = [],
  supportStatuses = [],
  onOpenSupportNode,
  onClose,
  onRefresh,
  refreshDisabled = false,
  refreshLabel = '刷新',
  primaryActionLabel = '',
  onPrimaryAction,
  primaryActionDisabled = false,
  emptyTitle = '暂未定位到知识域',
  emptyHint = '当你进入某个知识域后，这里会展示上下文信息。',
  travelStatus,
  formatTravelSeconds,
  onStopTravel,
  isStoppingTravel = false
}) => {
  if (isTraveling) {
    const remainingDistanceText = travelStatus?.remainingDistanceUnits?.toFixed?.(2) ?? travelStatus?.remainingDistanceUnits ?? '--';
    const remainingTimeText = typeof formatTravelSeconds === 'function'
      ? formatTravelSeconds(travelStatus?.remainingSeconds)
      : '--';
    const chips = [
      { label: `${remainingDistanceText} 单位`, tone: 'neutral' },
      { label: remainingTimeText, tone: 'accent' }
    ];

    return (
      <section className="utility-context-panel current-domain-panel" aria-label="移动状态">
        <header className="utility-context-panel__header">
          <div className="utility-context-panel__title-group">
            <span className="utility-context-panel__eyebrow">Travel Context</span>
            <h3 className="utility-context-panel__title">{panelTitle}</h3>
          </div>
          <button
            type="button"
            className="utility-context-panel__icon-action"
            onClick={onClose}
            aria-label="关闭知识域面板"
          >
            <X size={15} />
          </button>
        </header>

        <div className="current-domain-panel__hero">
          <div className="current-domain-panel__icon">
            <Navigation size={18} />
          </div>
          <div className="current-domain-panel__hero-copy">
            <div className="current-domain-panel__title">{travelStatus?.targetNode?.nodeName || '移动中'}</div>
            <div className="current-domain-panel__summary">
              {travelStatus?.queuedTargetNode?.nodeName
                ? `已排队前往 ${travelStatus.queuedTargetNode.nodeName}`
                : '正在迁移到目标知识域。'}
            </div>
          </div>
        </div>

        <div className="current-domain-panel__chip-row">
          {chips.map((chip) => (
            <span key={chip.label} className={`current-domain-panel__chip tone-${chip.tone || 'neutral'}`}>{chip.label}</span>
          ))}
        </div>

        <div className="current-domain-panel__travel-track">
          <div className="current-domain-panel__travel-track-line" />
          <div
            className="current-domain-panel__travel-progress"
            style={{ width: `${Math.min(100, Math.max(0, (travelStatus?.progressInCurrentSegment || 0) * 100))}%` }}
          />
        </div>

        <div className="current-domain-panel__dual-cards">
          <div className="current-domain-panel__mini-card">
            <span>下一目的地</span>
            <strong>{travelStatus?.nextNode?.nodeName || '-'}</strong>
          </div>
          <div className="current-domain-panel__mini-card">
            <span>最近到达</span>
            <strong>{travelStatus?.lastReachedNode?.nodeName || '-'}</strong>
          </div>
        </div>

        <button
          type="button"
          className="current-domain-panel__primary-action is-danger"
          onClick={onStopTravel}
          disabled={isStoppingTravel || travelStatus?.isStopping}
        >
          <Clock3 size={15} />
          {(isStoppingTravel || travelStatus?.isStopping) ? '停止进行中...' : '停止移动'}
        </button>
      </section>
    );
  }

  if (!title) {
    return (
      <section className="utility-context-panel current-domain-panel" aria-label="当前位置">
        <header className="utility-context-panel__header">
          <div className="utility-context-panel__title-group">
            <span className="utility-context-panel__eyebrow">Current Domain</span>
            <h3 className="utility-context-panel__title">{panelTitle}</h3>
          </div>
          <div className="utility-context-panel__actions">
            {typeof onRefresh === 'function' ? (
              <button
                type="button"
                className="utility-context-panel__text-action"
                onClick={onRefresh}
                disabled={refreshDisabled}
              >
                {refreshLabel}
              </button>
            ) : null}
            <button
              type="button"
              className="utility-context-panel__icon-action"
              onClick={onClose}
              aria-label="关闭知识域面板"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="current-domain-panel__empty">
          <div className="current-domain-panel__empty-icon">
            <Compass size={18} />
          </div>
          <div className="current-domain-panel__empty-title">{emptyTitle}</div>
          <div className="current-domain-panel__empty-hint">{emptyHint}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="utility-context-panel current-domain-panel" aria-label="当前位置">
      <header className="utility-context-panel__header">
        <div className="utility-context-panel__title-group">
          <span className="utility-context-panel__eyebrow">Current Domain</span>
          <h3 className="utility-context-panel__title">{panelTitle}</h3>
        </div>
        <div className="utility-context-panel__actions">
          {typeof onRefresh === 'function' ? (
            <button
              type="button"
              className="utility-context-panel__text-action"
              onClick={onRefresh}
              disabled={refreshDisabled}
            >
              {refreshLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="utility-context-panel__icon-action"
            onClick={onClose}
            aria-label="关闭知识域面板"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="current-domain-panel__hero">
        <div className="current-domain-panel__icon">
          <MapPin size={18} />
        </div>
        <div className="current-domain-panel__hero-copy">
          <div className="current-domain-panel__title">{title}</div>
          {breadcrumb.length > 0 ? (
            <div className="current-domain-panel__breadcrumb">
              {breadcrumb.join(' / ')}
            </div>
          ) : null}
        </div>
      </div>

      {statusChips.length > 0 ? (
        <div className="current-domain-panel__chip-row">
          {statusChips.map((chip) => (
            <span key={chip.label} className={`current-domain-panel__chip tone-${chip.tone || 'neutral'}`}>{chip.label}</span>
          ))}
        </div>
      ) : null}

      {summary ? (
        <p className="current-domain-panel__summary">{summary}</p>
      ) : null}

      {primaryActionLabel ? (
        <button
          type="button"
          className="current-domain-panel__primary-action"
          onClick={onPrimaryAction}
          disabled={primaryActionDisabled}
        >
          <ArrowRight size={15} />
          {primaryActionLabel}
        </button>
      ) : null}

      {stats.length > 0 ? (
        <div className="current-domain-panel__stats">
          {stats.map((item) => (
            <div key={item.label} className="current-domain-panel__stat-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      ) : null}

      {leaders.length > 0 ? (
        <div className="current-domain-panel__section">
          <div className="current-domain-panel__section-title">域主与域相</div>
          <div className="current-domain-panel__leaders">
            {leaders.map((leader) => (
              <div key={`${leader.role}-${leader.name}`} className="current-domain-panel__leader-card">
                {leader.avatar ? <img src={leader.avatar} alt={leader.name} className="current-domain-panel__leader-avatar" /> : null}
                <div className="current-domain-panel__leader-meta">
                  <span>{leader.role}</span>
                  <strong>{leader.name}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {(parentLabels.length > 0 || childLabels.length > 0) ? (
        <div className="current-domain-panel__section">
          <div className="current-domain-panel__section-title">关联层级</div>
          <div className="current-domain-panel__tags">
            {parentLabels.map((label) => (
              <span key={`parent-${label}`} className="current-domain-panel__tag is-parent">{label}</span>
            ))}
            {childLabels.map((label) => (
              <span key={`child-${label}`} className="current-domain-panel__tag is-child">{label}</span>
            ))}
          </div>
        </div>
      ) : null}

      {supportStatuses.length > 0 ? (
        <div className="current-domain-panel__section">
          <div className="current-domain-panel__section-title">派遣兵力状态</div>
          <div className="current-domain-panel__support-list">
            {supportStatuses.map((item) => (
              <button
                type="button"
                key={`${item.nodeId || item.nodeName}-${item.gateKey || ''}-${item.requestedAt || ''}`}
                className="current-domain-panel__support-row"
                onClick={() => {
                  if (typeof onOpenSupportNode === 'function') onOpenSupportNode(item);
                }}
                disabled={!item.nodeId}
              >
                <span>{item.nodeName || '未知知识域'}</span>
                <em>{item.statusLabel || item.status || '-'}</em>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default CurrentDomainPanel;
