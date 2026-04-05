import React, { useMemo, useState } from 'react';
import { Bell, ChevronDown, FileText, Inbox, Megaphone, X } from 'lucide-react';
import {
  isAnnouncementNotification,
  isSocialNotification,
  isSenseArticleNotification
} from '../../app/appShared';
import './MessageDockPanel.css';

const sortByLatestDesc = (items = []) => (
  [...items].sort((left, right) => {
    const leftTime = new Date(left?.updatedAt || left?.createdAt || 0).getTime();
    const rightTime = new Date(right?.updatedAt || right?.createdAt || 0).getTime();
    return rightTime - leftTime;
  })
);

const formatMessageTime = (value) => {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const getNotificationKindLabel = (notification) => {
  switch (notification?.type) {
    case 'domain_admin_invite':
      return '域相邀请';
    case 'domain_admin_resign_request':
      return '卸任请求';
    case 'domain_master_apply':
      return '域主申请';
    case 'domain_master_apply_result':
      return '申请结果';
    case 'alliance_join_apply':
      return '入盟申请';
    case 'alliance_join_apply_result':
      return '入盟结果';
    case 'domain_admin_invite_result':
      return '邀请结果';
    case 'domain_admin_resign_result':
      return '卸任结果';
    default:
      return '系统通知';
  }
};

const getNotificationPrimaryAction = ({
  notification,
  onOpenAdminPending,
  onOpenDistributionNotification,
  onOpenArrivalNotification,
  onOpenSenseArticleNotification
}) => {
  if (!notification) return null;
  if (notification.type === 'domain_master_apply' && notification.status === 'pending') {
    return {
      label: '前往审批',
      onClick: () => onOpenAdminPending()
    };
  }
  if (notification.type === 'domain_distribution_announcement') {
    return {
      label: '前往相关知识域',
      onClick: () => onOpenDistributionNotification(notification)
    };
  }
  if (
    notification.type === 'info'
    && typeof notification.nodeName === 'string'
    && notification.nodeName.trim() !== ''
  ) {
    return {
      label: '前往相关知识域',
      onClick: () => onOpenArrivalNotification(notification)
    };
  }
  if (isSenseArticleNotification(notification)) {
    return {
      label: '前往词条',
      onClick: () => onOpenSenseArticleNotification(notification)
    };
  }
  return null;
};

const MessageTabButton = ({
  active = false,
  badge = '',
  icon: Icon,
  label,
  onClick
}) => (
  <button
    type="button"
    className={`message-dock-tab-btn${active ? ' is-active' : ''}`}
    onClick={onClick}
  >
    <span className="message-dock-tab-btn__main">
      <span className="message-dock-tab-btn__icon">{Icon ? <Icon size={15} strokeWidth={2} /> : null}</span>
      <span>{label}</span>
    </span>
    {badge ? <span className="message-dock-tab-btn__badge">{badge}</span> : null}
  </button>
);

const ExpandableCard = ({
  itemKey,
  title,
  subtitle = '',
  message = '',
  timeText = '',
  unread = false,
  tag = '',
  expanded = false,
  onToggle,
  children
}) => (
  <article className={`message-dock-card${unread ? ' is-unread' : ''}${expanded ? ' is-expanded' : ''}`}>
    <button
      type="button"
      className="message-dock-card__summary"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={`message-card-panel-${itemKey}`}
    >
      <div className="message-dock-card__main">
        <div className="message-dock-card__topline">
          <div className="message-dock-card__title-row">
            {unread ? <span className="message-dock-card__dot" /> : null}
            <span className="message-dock-card__title">{title || '未命名消息'}</span>
          </div>
          {tag ? <span className="message-dock-card__tag">{tag}</span> : null}
        </div>
        {subtitle ? <div className="message-dock-card__subtitle">{subtitle}</div> : null}
        <div className="message-dock-card__preview">{message || '暂无详细内容。'}</div>
        <div className="message-dock-card__meta">{timeText}</div>
      </div>
      <span className={`message-dock-card__arrow${expanded ? ' is-open' : ''}`}>
        <ChevronDown size={16} />
      </span>
    </button>
    {expanded ? (
      <div id={`message-card-panel-${itemKey}`} className="message-dock-card__details">
        {children}
      </div>
    ) : null}
  </article>
);

const MessageDockPanel = ({
  activeTab = 'announcement',
  onTabChange,
  onClose,
  isAdmin = false,
  notifications = [],
  systemAnnouncements = [],
  allianceAnnouncements = [],
  adminPendingNodes = [],
  announcementUnreadCount = 0,
  isNotificationsLoading = false,
  isMarkingAllRead = false,
  isMarkingAnnouncementsRead = false,
  isClearingNotifications = false,
  notificationActionId = '',
  onRefresh,
  onMarkAllNotificationsRead,
  onMarkAnnouncementNotificationsRead,
  onClearNotifications,
  onOpenAdminPending,
  onMarkNotificationRead,
  onRespondNotification,
  onOpenDistributionNotification,
  onOpenArrivalNotification,
  onOpenSenseArticleNotification,
  onOpenAnnouncement
}) => {
  const [expandedMap, setExpandedMap] = useState({});

  const announcementItems = useMemo(() => (
    sortByLatestDesc([
      ...systemAnnouncements.map((item) => ({ ...item, _channel: '系统公告' })),
      ...allianceAnnouncements.map((item) => ({ ...item, _channel: '频道公告' }))
    ])
  ), [allianceAnnouncements, systemAnnouncements]);

  const notificationItems = useMemo(() => {
    const baseRows = notifications.filter((item) => !isAnnouncementNotification(item) && !isSocialNotification(item));
    const adminRows = isAdmin && adminPendingNodes.length > 0
      ? [{
        _id: 'admin-pending-node-create',
        type: 'admin_pending_node_create',
        title: adminPendingNodes.length === 1 && adminPendingNodes[0]?.name
          ? `待审批：${adminPendingNodes[0].name}`
          : '待审批创建申请',
        message: `当前有 ${adminPendingNodes.length} 条新知识域创建申请待处理。`,
        createdAt: adminPendingNodes[0]?.createdAt || null,
        read: false,
        _synthetic: true
      }]
      : [];
    return sortByLatestDesc([...adminRows, ...baseRows]);
  }, [adminPendingNodes, isAdmin, notifications]);

  const directNotificationUnreadCount = useMemo(() => (
    notifications.filter((item) => !isAnnouncementNotification(item) && !isSocialNotification(item) && !item.read).length
  ), [notifications]);

  const toggleExpanded = async (itemKey, item) => {
    setExpandedMap((prev) => ({
      ...prev,
      [itemKey]: !prev[itemKey]
    }));
    if (!expandedMap[itemKey] && item?._id && !item?.read && !item?._synthetic) {
      await onMarkNotificationRead(item._id);
    }
  };

  const renderAnnouncementTab = () => {
    if (announcementItems.length === 0) {
      return (
        <div className="message-dock-empty">
          <div className="message-dock-empty__icon"><Megaphone size={18} /></div>
          <div className="message-dock-empty__title">暂无公告</div>
          <div className="message-dock-empty__hint">系统事件和频道更新会汇总在这里。</div>
        </div>
      );
    }

    return (
      <div className="message-dock-list">
        {announcementItems.map((item) => {
          const itemKey = `announcement-${item._id}`;
          const expanded = !!expandedMap[itemKey];
          const canOpen = item.type === 'domain_distribution_announcement';
          return (
            <ExpandableCard
              key={itemKey}
              itemKey={itemKey}
              title={item.title || '公告'}
              subtitle={item._channel || ''}
              message={item.message || ''}
              timeText={formatMessageTime(item.updatedAt || item.createdAt)}
              unread={!item.read}
              tag={item._channel || ''}
              expanded={expanded}
              onToggle={() => toggleExpanded(itemKey, item)}
            >
              <div className="message-dock-detail-text">{item.message || '暂无详细内容。'}</div>
              <div className="message-dock-actions">
                {canOpen ? (
                  <button
                    type="button"
                    className="btn btn-small btn-warning"
                    onClick={() => onOpenAnnouncement(item)}
                  >
                    前往相关知识域
                  </button>
                ) : null}
                {!item.read ? (
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={() => onMarkNotificationRead(item._id)}
                  >
                    标记已读
                  </button>
                ) : null}
              </div>
            </ExpandableCard>
          );
        })}
      </div>
    );
  };

  const renderNotificationTab = () => {
    if (notificationItems.length === 0) {
      return (
        <div className="message-dock-empty">
          <div className="message-dock-empty__icon"><Inbox size={18} /></div>
          <div className="message-dock-empty__title">暂无通知</div>
          <div className="message-dock-empty__hint">审批、到达提醒、词条动态都会出现在这里。</div>
        </div>
      );
    }

    return (
      <div className="message-dock-list">
        {notificationItems.map((notification) => {
          const itemKey = `notification-${notification._id}`;
          const expanded = !!expandedMap[itemKey];
          const isInvitePending = notification.type === 'domain_admin_invite' && notification.status === 'pending';
          const isResignRequestPending = notification.type === 'domain_admin_resign_request' && notification.status === 'pending';
          const isMasterApplyPending = notification.type === 'domain_master_apply' && notification.status === 'pending';
          const isAllianceJoinApplyPending = notification.type === 'alliance_join_apply' && notification.status === 'pending';
          const currentActionKey = notificationActionId.split(':')[0];
          const isActing = currentActionKey === notification._id;
          const primaryAction = getNotificationPrimaryAction({
            notification,
            onOpenAdminPending,
            onOpenDistributionNotification,
            onOpenArrivalNotification,
            onOpenSenseArticleNotification
          });

          return (
            <ExpandableCard
              key={itemKey}
              itemKey={itemKey}
              title={notification.title || '系统通知'}
              subtitle={getNotificationKindLabel(notification)}
              message={notification.message || ''}
              timeText={formatMessageTime(notification.createdAt)}
              unread={!notification.read}
              tag={getNotificationKindLabel(notification)}
              expanded={expanded}
              onToggle={() => toggleExpanded(itemKey, notification)}
            >
              <div className="message-dock-detail-text">{notification.message || '暂无详细内容。'}</div>
              {(notification.type === 'domain_admin_invite_result'
                || notification.type === 'domain_admin_resign_result'
                || notification.type === 'domain_master_apply_result'
                || notification.type === 'alliance_join_apply_result') ? (
                <div className={`message-dock-result-tag ${notification.status === 'accepted' ? 'is-accepted' : 'is-rejected'}`}>
                  {notification.status === 'accepted'
                    ? '已通过'
                    : '已拒绝'}
                </div>
              ) : null}
              <div className="message-dock-actions">
                {primaryAction ? (
                  <button
                    type="button"
                    className="btn btn-small btn-warning"
                    onClick={primaryAction.onClick}
                  >
                    {primaryAction.label}
                  </button>
                ) : null}
                {!notification.read && !notification._synthetic ? (
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={() => onMarkNotificationRead(notification._id)}
                  >
                    标记已读
                  </button>
                ) : null}
                {isInvitePending ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-small btn-success"
                      onClick={() => onRespondNotification(notification._id, 'accept')}
                      disabled={isActing}
                    >
                      接受
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={() => onRespondNotification(notification._id, 'reject')}
                      disabled={isActing}
                    >
                      拒绝
                    </button>
                  </>
                ) : null}
                {isResignRequestPending ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-small btn-success"
                      onClick={() => onRespondNotification(notification._id, 'accept')}
                      disabled={isActing}
                    >
                      同意卸任
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={() => onRespondNotification(notification._id, 'reject')}
                      disabled={isActing}
                    >
                      拒绝
                    </button>
                  </>
                ) : null}
                {isAllianceJoinApplyPending ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-small btn-success"
                      onClick={() => onRespondNotification(notification._id, 'accept')}
                      disabled={isActing}
                    >
                      同意加入
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={() => onRespondNotification(notification._id, 'reject')}
                      disabled={isActing}
                    >
                      拒绝
                    </button>
                  </>
                ) : null}
                {isMasterApplyPending && !primaryAction ? (
                  <button
                    type="button"
                    className="btn btn-small btn-warning"
                    onClick={() => onOpenAdminPending()}
                  >
                    前往审批
                  </button>
                ) : null}
              </div>
            </ExpandableCard>
          );
        })}
      </div>
    );
  };

  return (
    <section className="message-dock-panel" aria-label="消息">
      <header className="message-dock-panel__header">
        <div>
          <div className="message-dock-panel__eyebrow">Message Center</div>
          <h3>消息</h3>
          <p>公告和通知统一收纳在这里，详情展开后再处理跳转或审批。</p>
        </div>
        <button
          type="button"
          className="message-dock-close-btn"
          onClick={onClose}
          aria-label="关闭消息面板"
        >
          <X size={15} />
        </button>
      </header>

      <div className="message-dock-tabs">
        <MessageTabButton
          active={activeTab === 'announcement'}
          badge={announcementUnreadCount > 0 ? String(Math.min(99, announcementUnreadCount)) : ''}
          icon={Megaphone}
          label="公告"
          onClick={() => onTabChange('announcement')}
        />
        <MessageTabButton
          active={activeTab === 'notification'}
          badge={directNotificationUnreadCount > 0 ? String(Math.min(99, directNotificationUnreadCount)) : ''}
          icon={Bell}
          label="通知"
          onClick={() => onTabChange('notification')}
        />
      </div>

      <div className="message-dock-toolbar">
        {activeTab === 'announcement' ? (
          <button
            type="button"
            className="message-dock-toolbar__btn"
            onClick={onMarkAnnouncementNotificationsRead}
            disabled={isMarkingAnnouncementsRead || announcementUnreadCount <= 0}
          >
            {isMarkingAnnouncementsRead ? '处理中...' : '全部已读'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="message-dock-toolbar__btn"
              onClick={onMarkAllNotificationsRead}
              disabled={isMarkingAllRead || directNotificationUnreadCount <= 0}
            >
              {isMarkingAllRead ? '处理中...' : '全部已读'}
            </button>
            <button
              type="button"
              className="message-dock-toolbar__btn is-danger"
              onClick={onClearNotifications}
              disabled={isClearingNotifications || notifications.length === 0}
            >
              {isClearingNotifications ? '清空中...' : '清空通知'}
            </button>
          </>
        )}
        <button
          type="button"
          className="message-dock-toolbar__btn"
          onClick={onRefresh}
          disabled={isNotificationsLoading}
        >
          {isNotificationsLoading ? '刷新中...' : '刷新'}
        </button>
      </div>

      <div className="message-dock-panel__body">
        {activeTab === 'announcement' ? renderAnnouncementTab() : renderNotificationTab()}
      </div>

      <footer className="message-dock-panel__footer">
        <FileText size={14} />
        <span>点击卡片展开详情，再执行跳转、审批或已读操作。</span>
      </footer>
    </section>
  );
};

export default MessageDockPanel;
