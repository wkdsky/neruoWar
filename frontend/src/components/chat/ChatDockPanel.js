import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  MessagesSquare,
  Search,
  Send,
  Trash2,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { resolveAvatarSrc } from '../../app/appShared';
import { useUserCard } from '../social/UserCardContext';
import {
  getUserId,
  renderUserMetaText,
  resolveUserFriendStatus
} from '../social/userCardUtils';
import './ChatDockPanel.css';

const formatRelativeDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const sameDay = now.toDateString() === date.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const SidebarTabButton = ({
  active = false,
  badge = '',
  icon: Icon,
  label,
  onClick
}) => (
  <button
    type="button"
    className={`chat-dock-tab-btn${active ? ' is-active' : ''}`}
    onClick={onClick}
  >
    <span className="chat-dock-tab-btn__main">
      <span className="chat-dock-tab-btn__icon">{Icon ? <Icon size={15} strokeWidth={2} /> : null}</span>
      <span>{label}</span>
    </span>
    {badge ? <span className="chat-dock-tab-btn__badge">{badge}</span> : null}
  </button>
);

const UserAvatar = ({ user = {}, size = 40 }) => (
  <img
    src={resolveAvatarSrc(user?.avatar)}
    alt={user?.username || '用户'}
    className="chat-dock-avatar"
    style={{ width: `${size}px`, height: `${size}px` }}
  />
);

const ChatDockPanel = ({
  activeSidebarTab,
  conversationActionId,
  conversationListLoading,
  conversations = [],
  currentUserId = '',
  friendActionId,
  friendListLoading,
  friendRequests = {},
  friendSearchLoading,
  friendSearchQuery,
  friendSearchResults = [],
  friends = [],
  loadOlderMessages,
  onClose,
  onDeleteConversation,
  onFriendSearchQueryChange,
  onOpenConversation,
  onOpenDirectConversation,
  onRespondFriendRequest,
  onSearchUsers,
  onSendFriendRequest,
  onSendMessage,
  panelNotice = '',
  requestActionId,
  requestListLoading,
  selectedConversation = null,
  selectedMessagesEntry,
  setActiveSidebarTab
}) => {
  const [draftMessage, setDraftMessage] = useState('');
  const [showNewMessageHint, setShowNewMessageHint] = useState(false);
  const messagesViewportRef = useRef(null);
  const previousConversationIdRef = useRef('');
  const previousLastMessageKeyRef = useRef('');
  const { openUserCard } = useUserCard();

  const receivedRequests = Array.isArray(friendRequests.received) ? friendRequests.received : [];
  const sentRequests = Array.isArray(friendRequests.sent) ? friendRequests.sent : [];
  const selectedMessages = useMemo(
    () => (Array.isArray(selectedMessagesEntry?.rows) ? selectedMessagesEntry.rows : []),
    [selectedMessagesEntry?.rows]
  );

  const conversationPlaceholder = useMemo(() => {
    if (conversations.length > 0) {
      return '选择一个会话开始聊天，删除聊天只会清空你这一侧的记录。';
    }
    return '当前没有可见私聊。你可以先从好友列表打开聊天窗口。';
  }, [conversations.length]);

  const selectedConversationFriendStatus = useMemo(() => (
    selectedConversation?.directUser
      ? resolveUserFriendStatus({
        user: selectedConversation.directUser,
        currentUserId,
        friends,
        friendRequests
      })
      : 'none'
  ), [currentUserId, friendRequests, friends, selectedConversation?.directUser]);

  const handleSubmitMessage = async () => {
    if (!selectedConversation?.conversationId) return;
    const message = draftMessage.trim();
    if (!message) return;

    const sent = await onSendMessage(selectedConversation.conversationId, message);
    if (sent) {
      setDraftMessage('');
    }
  };

  const scrollMessagesToBottom = (behavior = 'auto') => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior
    });
    setShowNewMessageHint(false);
  };

  useEffect(() => {
    const currentConversationId = selectedConversation?.conversationId || '';
    const lastMessage = selectedMessages[selectedMessages.length - 1] || null;
    const lastMessageKey = lastMessage?._id || (
      lastMessage?.conversationId
        ? `${lastMessage.conversationId}:${lastMessage?.seq || 0}`
        : ''
    );
    const viewport = messagesViewportRef.current;
    const conversationChanged = previousConversationIdRef.current !== currentConversationId;
    const messageAdvanced = Boolean(lastMessageKey) && previousLastMessageKeyRef.current !== lastMessageKey;

    if (viewport && currentConversationId) {
      const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const isNearBottom = distanceToBottom <= 64;
      const lastMessageIsSelf = String(lastMessage?.senderId || '') === String(currentUserId || '');

      if (conversationChanged) {
        window.requestAnimationFrame(() => scrollMessagesToBottom('auto'));
      } else if (messageAdvanced) {
        if (lastMessageIsSelf || isNearBottom) {
          window.requestAnimationFrame(() => scrollMessagesToBottom(lastMessageIsSelf ? 'smooth' : 'auto'));
        } else {
          setShowNewMessageHint(true);
        }
      }
    } else {
      setShowNewMessageHint(false);
    }

    previousConversationIdRef.current = currentConversationId;
    previousLastMessageKeyRef.current = lastMessageKey;
  }, [currentUserId, selectedConversation?.conversationId, selectedMessages]);

  const renderAvatarTrigger = (user, size = 40, options = {}) => {
    const targetUserId = getUserId(user);
    const disabled = !targetUserId || targetUserId === String(currentUserId || '');
    const className = `chat-dock-avatar-trigger${options.compact ? ' is-compact' : ''}${disabled ? ' is-disabled' : ''}`;

    return (
      <span
        className={className}
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? -1 : 0}
        onClick={(event) => {
          if (disabled) return;
          event.stopPropagation();
          openUserCard(user, event);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          event.stopPropagation();
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openUserCard(user, event);
          }
        }}
      >
        <UserAvatar user={user} size={size} />
      </span>
    );
  };

  return (
    <div className="chat-dock-panel">
      <div className="chat-dock-panel__header">
        <div>
          <div className="chat-dock-panel__eyebrow">社交与私聊</div>
          <h3>好友 / 私聊中心</h3>
          <p>好友关系独立存在，私聊会按需创建，删除聊天仅影响你自己。</p>
        </div>
        <button type="button" className="chat-dock-close-btn" onClick={onClose} title="收起聊天面板">
          <X size={16} />
        </button>
      </div>

      {panelNotice ? <div className="chat-dock-notice">{panelNotice}</div> : null}

      <div className="chat-dock-body">
        <div className="chat-dock-sidebar">
          <div className="chat-dock-tabs">
            <SidebarTabButton
              active={activeSidebarTab === 'conversations'}
              icon={MessagesSquare}
              label="会话"
              badge={conversations.length > 0 ? String(conversations.length) : ''}
              onClick={() => setActiveSidebarTab('conversations')}
            />
            <SidebarTabButton
              active={activeSidebarTab === 'friends'}
              icon={Users}
              label="好友"
              badge={friends.length > 0 ? String(friends.length) : ''}
              onClick={() => setActiveSidebarTab('friends')}
            />
            <SidebarTabButton
              active={activeSidebarTab === 'requests'}
              icon={UserPlus}
              label="申请"
              badge={receivedRequests.length > 0 ? String(receivedRequests.length) : ''}
              onClick={() => setActiveSidebarTab('requests')}
            />
          </div>

          {activeSidebarTab === 'conversations' ? (
            <div className="chat-dock-list">
              <div className="chat-dock-list__header">
                <span>当前可见私聊</span>
                {conversationListLoading ? <Loader2 size={14} className="chat-spin" /> : null}
              </div>
              {conversations.length === 0 ? (
                <div className="chat-dock-empty">当前没有可见私聊。</div>
              ) : conversations.map((item) => {
                const isActive = item?.conversationId === selectedConversation?.conversationId;
                return (
                  <button
                    key={item?.conversationId}
                    type="button"
                    className={`chat-dock-list-item${isActive ? ' is-active' : ''}`}
                    onClick={() => onOpenConversation(item?.conversationId)}
                  >
                    {renderAvatarTrigger(item?.directUser || { avatar: item?.avatar, username: item?.title }, 42)}
                    <span className="chat-dock-list-item__content">
                      <span className="chat-dock-list-item__top">
                        <span className="chat-dock-list-item__title">{item?.title || '未命名会话'}</span>
                        <span className="chat-dock-list-item__time">{formatRelativeDateTime(item?.lastMessageAt)}</span>
                      </span>
                      <span className="chat-dock-list-item__preview">
                        {item?.lastMessagePreview || '暂无消息，打开后即可开始私聊'}
                      </span>
                    </span>
                    <span className="chat-dock-list-item__side">
                      {Number(item?.unreadCount) > 0 ? (
                        <span className="chat-dock-unread-badge">
                          {Number(item.unreadCount) > 99 ? '99+' : Number(item.unreadCount)}
                        </span>
                      ) : null}
                      <span
                        className="chat-dock-icon-btn"
                        role="button"
                        tabIndex={0}
                        title="删除聊天"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteConversation(item);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            onDeleteConversation(item);
                          }
                        }}
                      >
                        {conversationActionId === `hide:${item?.conversationId}` ? <Loader2 size={15} className="chat-spin" /> : <Trash2 size={15} />}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {activeSidebarTab === 'friends' ? (
            <div className="chat-dock-list">
              <form
                className="chat-dock-search-box"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSearchUsers(friendSearchQuery);
                }}
              >
                <div className="chat-dock-search-input">
                  <Search size={14} />
                  <input
                    type="text"
                    value={friendSearchQuery}
                    onChange={(event) => onFriendSearchQueryChange(event.target.value)}
                    placeholder="搜索用户名并发送好友申请"
                  />
                </div>
                <button type="submit" className="btn btn-secondary btn-small" disabled={friendSearchLoading}>
                  {friendSearchLoading ? '搜索中...' : '搜索'}
                </button>
              </form>

              {friendSearchQuery.trim() ? (
                <div className="chat-dock-subsection">
                  <div className="chat-dock-list__header">
                    <span>搜索结果</span>
                    {friendSearchLoading ? <Loader2 size={14} className="chat-spin" /> : null}
                  </div>
                  {friendSearchResults.length === 0 && !friendSearchLoading ? (
                    <div className="chat-dock-empty">没有找到匹配用户。</div>
                  ) : friendSearchResults.map((item) => {
                    const actionKey = `request:${item?._id}`;
                    const isFriend = item?.friendStatus === 'friend';
                    const isPendingSent = item?.friendStatus === 'pending_sent';
                    const isPendingReceived = item?.friendStatus === 'pending_received';
                    return (
                      <div key={item?._id} className="chat-dock-user-row">
                        {renderAvatarTrigger(item, 36)}
                        <div className="chat-dock-user-row__content">
                          <div className="chat-dock-user-row__title">{item?.username || '未命名用户'}</div>
                          <div className="chat-dock-user-row__meta">{renderUserMetaText(item) || '可发起好友申请'}</div>
                        </div>
                        {isFriend ? (
                          <button type="button" className="btn btn-primary btn-small" onClick={() => onOpenDirectConversation(item?._id)}>
                            发消息
                          </button>
                        ) : isPendingSent ? (
                          <span className="chat-dock-chip">已发送</span>
                        ) : isPendingReceived ? (
                          <button type="button" className="btn btn-secondary btn-small" onClick={() => setActiveSidebarTab('requests')}>
                            去处理
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            disabled={friendActionId === actionKey}
                            onClick={() => onSendFriendRequest(item?._id)}
                          >
                            {friendActionId === actionKey ? '发送中...' : '加好友'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="chat-dock-subsection">
                <div className="chat-dock-list__header">
                  <span>我的好友</span>
                  {friendListLoading ? <Loader2 size={14} className="chat-spin" /> : <span>{friends.length}/200</span>}
                </div>
                {friends.length === 0 ? (
                  <div className="chat-dock-empty">还没有好友，先搜索用户发起申请。</div>
                ) : friends.map((item) => (
                  <div key={item?.friendshipId} className="chat-dock-user-row">
                    {renderAvatarTrigger(item?.user, 38)}
                    <div className="chat-dock-user-row__content">
                      <div className="chat-dock-user-row__title">{item?.user?.username || '未命名好友'}</div>
                      <div className="chat-dock-user-row__meta">
                        {renderUserMetaText(item?.user) || '已建立好友关系'}
                      </div>
                      {item?.hasConversation ? (
                        <div className="chat-dock-user-row__hint">
                          {item?.conversationVisible ? '已有可见私聊' : '已有私聊主体，可重新打开'}
                        </div>
                      ) : (
                        <div className="chat-dock-user-row__hint">还没有私聊窗口，打开时会懒创建</div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={conversationActionId === `open:${item?.user?._id}`}
                      onClick={() => onOpenDirectConversation(item?.user?._id)}
                    >
                      {conversationActionId === `open:${item?.user?._id}` ? '打开中...' : '发消息'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeSidebarTab === 'requests' ? (
            <div className="chat-dock-list">
              <div className="chat-dock-subsection">
                <div className="chat-dock-list__header">
                  <span>收到的申请</span>
                  {requestListLoading ? <Loader2 size={14} className="chat-spin" /> : <span>{receivedRequests.length}</span>}
                </div>
                {receivedRequests.length === 0 ? (
                  <div className="chat-dock-empty">当前没有待处理好友申请。</div>
                ) : receivedRequests.map((item) => {
                  const acceptKey = `${item?.friendshipId}:accept`;
                  const rejectKey = `${item?.friendshipId}:reject`;
                  return (
                    <div key={item?.friendshipId} className="chat-dock-request-card">
                      <div className="chat-dock-request-card__main">
                        {renderAvatarTrigger(item?.user, 38)}
                        <div className="chat-dock-request-card__content">
                          <div className="chat-dock-user-row__title">{item?.user?.username || '未命名用户'}</div>
                          <div className="chat-dock-user-row__meta">{renderUserMetaText(item?.user) || '发来了好友申请'}</div>
                          <div className="chat-dock-request-card__message">
                            {item?.requestMessage || '对方未填写附言'}
                          </div>
                        </div>
                      </div>
                      <div className="chat-dock-request-card__actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={requestActionId === acceptKey || requestActionId === rejectKey}
                          onClick={() => onRespondFriendRequest(item?.friendshipId, 'accept')}
                        >
                          {requestActionId === acceptKey ? '处理中...' : '通过'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          disabled={requestActionId === acceptKey || requestActionId === rejectKey}
                          onClick={() => onRespondFriendRequest(item?.friendshipId, 'reject')}
                        >
                          {requestActionId === rejectKey ? '处理中...' : '拒绝'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="chat-dock-subsection">
                <div className="chat-dock-list__header">
                  <span>我发出的申请</span>
                  <span>{sentRequests.length}</span>
                </div>
                {sentRequests.length === 0 ? (
                  <div className="chat-dock-empty">当前没有发出的待处理申请。</div>
                ) : sentRequests.map((item) => (
                  <div key={item?.friendshipId} className="chat-dock-user-row">
                    {renderAvatarTrigger(item?.user, 36)}
                    <div className="chat-dock-user-row__content">
                      <div className="chat-dock-user-row__title">{item?.user?.username || '未命名用户'}</div>
                      <div className="chat-dock-user-row__meta">
                        {item?.requestMessage || '等待对方处理好友申请'}
                      </div>
                    </div>
                    <span className="chat-dock-chip">待处理</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="chat-dock-main">
          <div className="chat-dock-main__header">
            {selectedConversation ? (
              <>
                <div className="chat-dock-main__identity">
                  {renderAvatarTrigger(selectedConversation?.directUser || { avatar: selectedConversation?.avatar, username: selectedConversation?.title }, 44)}
                  <div>
                    <div className="chat-dock-main__title">{selectedConversation?.title || '私聊'}</div>
                    <div className="chat-dock-main__subtitle">
                      {renderUserMetaText(selectedConversation?.directUser) || '好友私聊'}
                      {selectedConversation?.clearedBeforeSeq > 0 ? ' · 旧记录已按你的删除边界隐藏' : ''}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={conversationActionId === `hide:${selectedConversation?.conversationId}`}
                  onClick={() => onDeleteConversation(selectedConversation)}
                >
                  <Trash2 size={14} />
                  删除聊天
                </button>
              </>
            ) : (
              <div>
                <div className="chat-dock-main__title">私聊窗口</div>
                <div className="chat-dock-main__subtitle">{conversationPlaceholder}</div>
              </div>
            )}
          </div>

          {selectedConversation ? (
            <>
              {selectedConversation?.directUser && selectedConversationFriendStatus !== 'friend' ? (
                <div className="chat-dock-relationship-banner">
                  <div className="chat-dock-relationship-banner__text">
                    {selectedConversationFriendStatus === 'pending_sent'
                      ? `你已经向 ${selectedConversation?.title || '对方'} 发送了好友申请，当前仍可继续私聊。`
                      : selectedConversationFriendStatus === 'pending_received'
                        ? `${selectedConversation?.title || '对方'} 已向你发送好友申请，当前仍可继续私聊。`
                        : `你和 ${selectedConversation?.title || '对方'} 还不是好友，当前仍可直接私聊。`}
                  </div>
                  <div className="chat-dock-relationship-banner__actions">
                    {selectedConversationFriendStatus === 'pending_received' ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => setActiveSidebarTab('requests')}
                      >
                        去处理申请
                      </button>
                    ) : selectedConversationFriendStatus === 'none' ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={friendActionId === `request:${selectedConversation?.directUser?._id}`}
                        onClick={() => onSendFriendRequest(selectedConversation?.directUser?._id)}
                      >
                        {friendActionId === `request:${selectedConversation?.directUser?._id}` ? '发送中...' : '加好友'}
                      </button>
                    ) : (
                      <span className="chat-user-card__tag">申请中</span>
                    )}
                  </div>
                </div>
              ) : null}

              <div
                ref={messagesViewportRef}
                className="chat-dock-messages"
                onScroll={(event) => {
                  const viewport = event.currentTarget;
                  const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
                  if (distanceToBottom <= 64) {
                    setShowNewMessageHint(false);
                  }
                }}
              >
                {selectedMessagesEntry?.nextBeforeSeq > 0 ? (
                  <button
                    type="button"
                    className="chat-dock-load-more"
                    disabled={selectedMessagesEntry?.loading}
                    onClick={() => loadOlderMessages(selectedConversation.conversationId)}
                  >
                    {selectedMessagesEntry?.loading ? '加载中...' : '加载更早消息'}
                  </button>
                ) : null}

                {selectedMessagesEntry?.error ? (
                  <div className="chat-dock-empty is-error">{selectedMessagesEntry.error}</div>
                ) : null}

                {selectedMessages.length === 0 && !selectedMessagesEntry?.loading ? (
                  <div className="chat-dock-empty">
                    当前没有可见消息。若你之前删过这个私聊，这里只会展示删除边界之后的新消息。
                  </div>
                ) : selectedMessages.map((item) => {
                  const isSelf = item?.senderId === currentUserId;
                  return (
                    <div key={item?._id || `${item?.conversationId}:${item?.seq}`} className={`chat-message-row${isSelf ? ' is-self' : ''}`}>
                      {!isSelf ? <UserAvatar user={item?.sender} size={32} /> : null}
                      <div className={`chat-message-bubble${isSelf ? ' is-self' : ''}`}>
                        {!isSelf ? <div className="chat-message-bubble__sender">{item?.sender?.username || '对方'}</div> : null}
                        <div className="chat-message-bubble__content">{item?.content || ''}</div>
                        <div className="chat-message-bubble__meta">{formatRelativeDateTime(item?.createdAt)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {showNewMessageHint ? (
                <div className="chat-dock-new-message-bar">
                  <button
                    type="button"
                    className="chat-dock-new-message-btn"
                    onClick={() => scrollMessagesToBottom('smooth')}
                  >
                    有新消息，跳到底部
                  </button>
                </div>
              ) : null}

              <div className="chat-dock-composer">
                <textarea
                  value={draftMessage}
                  onChange={(event) => setDraftMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSubmitMessage();
                    }
                  }}
                  placeholder="输入消息，Enter 发送，Shift + Enter 换行"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={conversationActionId === `send:${selectedConversation?.conversationId}` || !draftMessage.trim()}
                  onClick={handleSubmitMessage}
                >
                  {conversationActionId === `send:${selectedConversation?.conversationId}` ? <Loader2 size={15} className="chat-spin" /> : <Send size={15} />}
                  发送
                </button>
              </div>
            </>
          ) : (
            <div className="chat-dock-empty-state">
              <div className="chat-dock-empty-state__icon">
                <Check size={28} />
              </div>
              <div className="chat-dock-empty-state__title">聊天和好友关系已经解耦</div>
              <div className="chat-dock-empty-state__text">
                先加好友，再按需打开私聊。删除聊天只会隐藏你这一侧记录，对方再次发消息时，会话会重新出现。
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

export default ChatDockPanel;
