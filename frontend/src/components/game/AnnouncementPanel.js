import React from 'react';
import { Bell, Inbox, X } from 'lucide-react';
import './AnnouncementPanel.css';

const formatAnnouncementTime = (value) => {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const AnnouncementPanel = ({
  activeTab = 'system',
  tabs = [],
  announcements = [],
  onTabChange,
  onReadAll,
  onClose,
  onItemClick,
  readAllDisabled = false,
  isReadAllLoading = false
}) => {
  const emptyTitle = activeTab === 'alliance' ? '暂无频道公告' : '暂无系统公告';
  const emptyHint = activeTab === 'alliance'
    ? '频道更新会在这里汇总展示。'
    : '系统事件与全局提示会在这里出现。';

  return (
    <section className="utility-context-panel announcement-context-panel" aria-label="公告">
      <header className="utility-context-panel__header">
        <div className="utility-context-panel__title-group">
          <span className="utility-context-panel__eyebrow">Notification Feed</span>
          <h3 className="utility-context-panel__title">公告</h3>
        </div>
        <div className="utility-context-panel__actions">
          <button
            type="button"
            className="utility-context-panel__text-action"
            onClick={onReadAll}
            disabled={readAllDisabled}
          >
            {isReadAllLoading ? '处理中...' : '全部已读'}
          </button>
          <button
            type="button"
            className="utility-context-panel__icon-action"
            onClick={onClose}
            aria-label="关闭公告面板"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="announcement-context-panel__tabs" role="tablist" aria-label="公告分类">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={`announcement-context-panel__tab${tab.id === activeTab ? ' is-active' : ''}`}
            aria-selected={tab.id === activeTab}
            onClick={() => onTabChange(tab.id)}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {announcements.length < 1 ? (
        <div className="announcement-context-panel__empty">
          <div className="announcement-context-panel__empty-icon">
            <Inbox size={18} />
          </div>
          <div className="announcement-context-panel__empty-title">{emptyTitle}</div>
          <div className="announcement-context-panel__empty-hint">{emptyHint}</div>
        </div>
      ) : (
        <div className="announcement-context-panel__list">
          {announcements.map((item) => (
            <button
              type="button"
              key={item._id}
              className={`announcement-context-panel__item${item.read ? '' : ' is-unread'}`}
              onClick={() => onItemClick(item)}
            >
              <div className="announcement-context-panel__item-top">
                <div className="announcement-context-panel__item-title-row">
                  {!item.read ? <span className="announcement-context-panel__item-dot" /> : null}
                  <span className="announcement-context-panel__item-title">{item.title || '知识点分发预告'}</span>
                </div>
                <time className="announcement-context-panel__item-time">
                  {formatAnnouncementTime(item.updatedAt || item.createdAt)}
                </time>
              </div>
              <div className="announcement-context-panel__item-summary">
                {item.message || '暂无摘要内容。'}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="announcement-context-panel__footer">
        <Bell size={14} />
        <span>通知面板保持低权重显示，避免压过首页主入口。</span>
      </div>
    </section>
  );
};

export default AnnouncementPanel;
