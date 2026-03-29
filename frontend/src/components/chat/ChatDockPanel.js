import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Crown,
  Loader2,
  LogOut,
  MessagesSquare,
  Plus,
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
  groupActionId,
  groupDetailLoading,
  groups = [],
  loadOlderMessages,
  onAddGroupMembers,
  onClose,
  onCreateGroupConversation,
  onDeleteConversation,
  onFriendSearchQueryChange,
  onLeaveGroupConversation,
  onOpenConversation,
  onOpenDirectConversation,
  onOpenGroupDetail,
  onRemoveGroupMember,
  onRespondFriendRequest,
  onSearchUsers,
  onSendFriendRequest,
  onSendMessage,
  onTransferGroupOwnership,
  onUpdateGroupConversation,
  isRequestsModalOpen,
  panelNotice = '',
  requestActionId,
  requestListLoading,
  selectedConversation = null,
  selectedGroupDetail = null,
  selectedGroupId = '',
  selectedMessagesEntry,
  setActiveSidebarTab,
  setIsRequestsModalOpen,
  setSelectedGroupId
}) => {
  const [draftMessage, setDraftMessage] = useState('');
  const [showNewMessageHint, setShowNewMessageHint] = useState(false);
  const [isCreateGroupMode, setIsCreateGroupMode] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupAnnouncement, setNewGroupAnnouncement] = useState('');
  const [newGroupMemberIds, setNewGroupMemberIds] = useState([]);
  const [groupTitleDraft, setGroupTitleDraft] = useState('');
  const [groupAnnouncementDraft, setGroupAnnouncementDraft] = useState('');
  const messagesViewportRef = useRef(null);
  const previousConversationIdRef = useRef('');
  const previousLastMessageKeyRef = useRef('');
  const { openUserCard } = useUserCard();

  const isConversationTab = activeSidebarTab === 'conversations';
  const isFriendsTab = activeSidebarTab === 'friends';
  const isGroupsTab = activeSidebarTab === 'groups';
  const receivedRequests = Array.isArray(friendRequests.received) ? friendRequests.received : [];
  const sentRequests = Array.isArray(friendRequests.sent) ? friendRequests.sent : [];
  const hasRequestInfo = receivedRequests.length > 0 || sentRequests.length > 0;
  const selectedMessages = useMemo(
    () => (Array.isArray(selectedMessagesEntry?.rows) ? selectedMessagesEntry.rows : []),
    [selectedMessagesEntry?.rows]
  );

  const conversationPlaceholder = useMemo(() => {
    if (conversations.length > 0) {
      return '选择一个会话开始聊天，列表统一按置顶优先和最近消息排序。';
    }
    return '当前没有可见会话。你可以先从好友或群聊入口发起聊天。';
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

  const selectedGroup = useMemo(() => (
    selectedGroupDetail?.group || null
  ), [selectedGroupDetail]);
  const selectedGroupConversation = useMemo(() => (
    selectedGroupDetail?.conversation || null
  ), [selectedGroupDetail]);
  const selectedGroupMembers = useMemo(() => (
    Array.isArray(selectedGroup?.members) ? selectedGroup.members : []
  ), [selectedGroup?.members]);
  const selectedGroupMemberIdSet = useMemo(() => (
    new Set(selectedGroupMembers.map((item) => String(item?.userId || '')))
  ), [selectedGroupMembers]);

  const createGroupCandidateRows = useMemo(() => (
    friends
      .map((item) => item?.user || null)
      .filter((item) => item?._id && String(item._id) !== String(currentUserId || ''))
  ), [currentUserId, friends]);

  const availableGroupInviteRows = useMemo(() => (
    friends
      .map((item) => item?.user || null)
      .filter((item) => item?._id && !selectedGroupMemberIdSet.has(String(item._id)))
  ), [friends, selectedGroupMemberIdSet]);

  useEffect(() => {
    setGroupTitleDraft(selectedGroup?.title || '');
    setGroupAnnouncementDraft(selectedGroup?.announcement || '');
  }, [selectedGroup?.announcement, selectedGroup?.title]);

  useEffect(() => {
    if (!isGroupsTab) return;
    setIsCreateGroupMode(!selectedGroupId);
  }, [isGroupsTab, selectedGroupId]);

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

  useEffect(() => {
    if (hasRequestInfo || !isRequestsModalOpen) return;
    setIsRequestsModalOpen(false);
  }, [hasRequestInfo, isRequestsModalOpen, setIsRequestsModalOpen]);

  useEffect(() => {
    if (!isRequestsModalOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsRequestsModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRequestsModalOpen, setIsRequestsModalOpen]);

  const openRequestsModal = () => {
    setActiveSidebarTab('friends');
    setIsRequestsModalOpen(true);
  };

  const closeRequestsModal = () => {
    setIsRequestsModalOpen(false);
  };

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

  const toggleCreateGroupMember = (userId) => {
    setNewGroupMemberIds((prev) => (
      prev.includes(userId)
        ? prev.filter((item) => item !== userId)
        : [...prev, userId]
    ));
  };

  const handleCreateGroup = async () => {
    const result = await onCreateGroupConversation({
      title: newGroupTitle,
      announcement: newGroupAnnouncement,
      memberUserIds: newGroupMemberIds
    });
    if (!result?.group?.conversationId) return;
    setIsCreateGroupMode(false);
    setNewGroupTitle('');
    setNewGroupAnnouncement('');
    setNewGroupMemberIds([]);
  };

  const handleOpenGroupDetail = async (conversationId) => {
    setIsCreateGroupMode(false);
    setSelectedGroupId(conversationId);
    await onOpenGroupDetail(conversationId);
  };

  const handleOpenGroupConversation = async () => {
    const conversationId = selectedGroup?.conversationId || selectedGroupConversation?.conversationId || '';
    if (!conversationId) return;
    setIsCreateGroupMode(false);
    await onOpenConversation(conversationId);
  };

  const handleSaveGroupSettings = async () => {
    if (!selectedGroup?.conversationId) return;
    await onUpdateGroupConversation({
      conversationId: selectedGroup.conversationId,
      title: groupTitleDraft,
      announcement: groupAnnouncementDraft
    });
  };

  const handleLeaveGroup = async () => {
    if (!selectedGroup?.conversationId) return;
    const confirmed = window.confirm(`确认退出群聊「${selectedGroup.title || '未命名群聊'}」吗？`);
    if (!confirmed) return;
    await onLeaveGroupConversation(selectedGroup.conversationId);
    setIsCreateGroupMode(false);
  };

  const renderConversationPane = () => (
    <>
      <div className="chat-dock-sidebar">
        <div className="chat-dock-list">
          <div className="chat-dock-list__header">
            <span>当前会话</span>
            <span className="chat-dock-list__header-side">
              <span>置顶优先</span>
              {conversationListLoading ? <Loader2 size={14} className="chat-spin" /> : null}
            </span>
          </div>
          {conversations.length === 0 ? (
            <div className="chat-dock-empty">当前没有可见会话。</div>
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
                    {item?.lastMessagePreview || '暂无消息，打开后即可开始聊天'}
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
      </div>

      <div className="chat-dock-main">
        <div className="chat-dock-main__header">
          {selectedConversation ? (
            <>
              <div className="chat-dock-main__identity">
                {renderAvatarTrigger(selectedConversation?.directUser || { avatar: selectedConversation?.avatar, username: selectedConversation?.title }, 44)}
                <div>
                  <div className="chat-dock-main__title">{selectedConversation?.title || '会话'}</div>
                  <div className="chat-dock-main__subtitle">
                    {renderUserMetaText(selectedConversation?.directUser) || '会话消息'}
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
              <div className="chat-dock-main__title">会话窗口</div>
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
                    ? `你已经向 ${selectedConversation?.title || '对方'} 发送了好友申请，当前仍可继续聊天。`
                    : selectedConversationFriendStatus === 'pending_received'
                      ? `${selectedConversation?.title || '对方'} 已向你发送好友申请，当前仍可继续聊天。`
                      : `你和 ${selectedConversation?.title || '对方'} 还不是好友，当前仍可直接聊天。`}
                </div>
                <div className="chat-dock-relationship-banner__actions">
                  {selectedConversationFriendStatus === 'pending_received' ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={openRequestsModal}
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
                  当前没有可见消息。若你之前删过这个会话，这里只会展示删除边界之后的新消息。
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
            <div className="chat-dock-empty-state__title">会话统一承载单聊与群聊</div>
            <div className="chat-dock-empty-state__text">
              列表统一混排 1v1 私聊和群聊，并继续按置顶优先、最近互动时间倒序排列。
            </div>
          </div>
        )}
      </div>
    </>
  );

  const renderFriendsPane = () => (
    <div className="chat-dock-single-pane">
      <div className="chat-dock-list">
        {hasRequestInfo ? (
          <button
            type="button"
            className={`chat-dock-request-entry${receivedRequests.length > 0 ? ' has-pending' : ''}`}
            onClick={openRequestsModal}
          >
            <span className="chat-dock-request-entry__main">
              <span className="chat-dock-request-entry__icon">
                <UserPlus size={16} />
              </span>
              <span className="chat-dock-request-entry__content">
                <span className="chat-dock-request-entry__title">好友申请</span>
                <span className="chat-dock-request-entry__meta">
                  {receivedRequests.length > 0
                    ? `有 ${receivedRequests.length} 条待处理申请`
                    : `有 ${sentRequests.length} 条申请等待对方处理`}
                </span>
              </span>
            </span>
            <span className="chat-dock-request-entry__side">
              {receivedRequests.length > 0 ? (
                <span className="chat-dock-unread-badge">
                  {receivedRequests.length > 99 ? '99+' : receivedRequests.length}
                </span>
              ) : (
                <span className="chat-dock-chip">查看</span>
              )}
            </span>
          </button>
        ) : null}

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
                    <button type="button" className="btn btn-secondary btn-small" onClick={openRequestsModal}>
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
                    {item?.conversationVisible ? '已有可见会话' : '已有会话主体，可重新打开'}
                  </div>
                ) : (
                  <div className="chat-dock-user-row__hint">还没有会话窗口，打开时会懒创建</div>
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
    </div>
  );

  const renderGroupCreatePane = () => (
    <div className="chat-dock-main">
      <div className="chat-dock-main__header">
        <div>
          <div className="chat-dock-main__title">创建群聊</div>
          <div className="chat-dock-main__subtitle">先建群，再在这里持续管理群名、公告、成员和群主转让。</div>
        </div>
      </div>
      <div className="chat-dock-group-body">
        <div className="chat-dock-group-form">
          <label className="chat-dock-field">
            <span>群名称</span>
            <input
              type="text"
              value={newGroupTitle}
              onChange={(event) => setNewGroupTitle(event.target.value)}
              placeholder="输入群聊名称"
            />
          </label>
          <label className="chat-dock-field">
            <span>群公告</span>
            <textarea
              value={newGroupAnnouncement}
              onChange={(event) => setNewGroupAnnouncement(event.target.value)}
              placeholder="输入群公告（可选）"
            />
          </label>
        </div>

        <div className="chat-dock-subsection">
          <div className="chat-dock-list__header">
            <span>初始成员</span>
            <span>{newGroupMemberIds.length} 人</span>
          </div>
          {createGroupCandidateRows.length === 0 ? (
            <div className="chat-dock-empty">当前没有可选好友，先去好友页添加成员。</div>
          ) : (
            <div className="chat-dock-member-picker">
              {createGroupCandidateRows.map((item) => {
                const isSelected = newGroupMemberIds.includes(item?._id);
                return (
                  <button
                    key={item?._id}
                    type="button"
                    className={`chat-dock-member-pick${isSelected ? ' is-selected' : ''}`}
                    onClick={() => toggleCreateGroupMember(item?._id)}
                  >
                    {renderAvatarTrigger(item, 34)}
                    <span className="chat-dock-member-pick__content">
                      <span className="chat-dock-user-row__title">{item?.username || '未命名用户'}</span>
                      <span className="chat-dock-user-row__meta">{renderUserMetaText(item) || '好友成员'}</span>
                    </span>
                    <span className="chat-dock-chip">{isSelected ? '已选' : '选择'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="chat-dock-group-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setIsCreateGroupMode(false);
              if (!selectedGroupId && groups[0]?.conversationId) {
                handleOpenGroupDetail(groups[0].conversationId);
              }
            }}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={groupActionId === 'create-group' || !newGroupTitle.trim()}
            onClick={handleCreateGroup}
          >
            {groupActionId === 'create-group' ? <Loader2 size={15} className="chat-spin" /> : <Plus size={15} />}
            创建群聊
          </button>
        </div>
      </div>
    </div>
  );

  const renderGroupDetailPane = () => {
    if (groupDetailLoading && !selectedGroup) {
      return (
        <div className="chat-dock-main">
          <div className="chat-dock-empty-state">
            <div className="chat-dock-empty-state__icon">
              <Loader2 size={28} className="chat-spin" />
            </div>
            <div className="chat-dock-empty-state__title">群聊详情加载中</div>
          </div>
        </div>
      );
    }

    if (!selectedGroup) {
      return (
        <div className="chat-dock-main">
          <div className="chat-dock-empty-state">
            <div className="chat-dock-empty-state__icon">
              <Users size={28} />
            </div>
            <div className="chat-dock-empty-state__title">选择一个群聊</div>
            <div className="chat-dock-empty-state__text">左侧可查看所有群聊，也可以直接创建新的群聊。</div>
          </div>
        </div>
      );
    }

    return (
      <div className="chat-dock-main">
        <div className="chat-dock-main__header">
          <div>
            <div className="chat-dock-main__title">{selectedGroup.title || '未命名群聊'}</div>
            <div className="chat-dock-main__subtitle">
              {selectedGroup.currentUserRole === 'owner' ? '你是群主' : '你是群成员'}
              {` · 共 ${selectedGroup.memberCount || 0} 人`}
            </div>
          </div>
          <div className="chat-dock-group-head-actions">
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={handleOpenGroupConversation}
            >
              打开会话
            </button>
            {selectedGroup.canLeave ? (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={groupActionId === `group-leave:${selectedGroup.conversationId}`}
                onClick={handleLeaveGroup}
              >
                {groupActionId === `group-leave:${selectedGroup.conversationId}` ? <Loader2 size={14} className="chat-spin" /> : <LogOut size={14} />}
                退出群聊
              </button>
            ) : null}
          </div>
        </div>

        <div className="chat-dock-group-body">
          {selectedGroup.canManage ? (
            <div className="chat-dock-group-form">
              <label className="chat-dock-field">
                <span>群名称</span>
                <input
                  type="text"
                  value={groupTitleDraft}
                  onChange={(event) => setGroupTitleDraft(event.target.value)}
                  placeholder="输入群聊名称"
                />
              </label>
              <label className="chat-dock-field">
                <span>群公告</span>
                <textarea
                  value={groupAnnouncementDraft}
                  onChange={(event) => setGroupAnnouncementDraft(event.target.value)}
                  placeholder="输入群公告"
                />
              </label>
              <div className="chat-dock-group-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={groupActionId === `group-update:${selectedGroup.conversationId}`}
                  onClick={handleSaveGroupSettings}
                >
                  {groupActionId === `group-update:${selectedGroup.conversationId}` ? <Loader2 size={15} className="chat-spin" /> : null}
                  保存群设置
                </button>
              </div>
            </div>
          ) : (
            <div className="chat-dock-group-announcement">
              <div className="chat-dock-list__header">
                <span>群公告</span>
              </div>
              <div className="chat-dock-empty">
                {selectedGroup.announcement || '当前没有群公告。'}
              </div>
            </div>
          )}

          <div className="chat-dock-subsection">
            <div className="chat-dock-list__header">
              <span>群成员</span>
              <span>{selectedGroupMembers.length} 人</span>
            </div>
            {selectedGroupMembers.length === 0 ? (
              <div className="chat-dock-empty">当前没有可见群成员。</div>
            ) : (
              <div className="chat-dock-group-member-list">
                {selectedGroupMembers.map((item) => {
                  const memberUser = item?.user || {};
                  const isOwner = item?.role === 'owner';
                  return (
                    <div key={item?.userId} className="chat-dock-user-row">
                      {renderAvatarTrigger(memberUser, 38)}
                      <div className="chat-dock-user-row__content">
                        <div className="chat-dock-user-row__title">
                          {memberUser?.username || '未命名成员'}
                          {isOwner ? (
                            <span className="chat-dock-role-tag">
                              <Crown size={12} />
                              群主
                            </span>
                          ) : null}
                        </div>
                        <div className="chat-dock-user-row__meta">{renderUserMetaText(memberUser) || '群聊成员'}</div>
                      </div>
                      {selectedGroup.canManage && !isOwner ? (
                        <div className="chat-dock-inline-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={groupActionId === `group-transfer:${selectedGroup.conversationId}:${item?.userId}`}
                            onClick={async () => {
                              const confirmed = window.confirm(`确认把群主转让给「${memberUser?.username || '该成员'}」吗？`);
                              if (!confirmed) return;
                              await onTransferGroupOwnership({
                                conversationId: selectedGroup.conversationId,
                                targetUserId: item?.userId
                              });
                            }}
                          >
                            {groupActionId === `group-transfer:${selectedGroup.conversationId}:${item?.userId}` ? '转让中...' : '转让群主'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={groupActionId === `group-remove:${selectedGroup.conversationId}:${item?.userId}`}
                            onClick={async () => {
                              const confirmed = window.confirm(`确认移出成员「${memberUser?.username || '该成员'}」吗？`);
                              if (!confirmed) return;
                              await onRemoveGroupMember({
                                conversationId: selectedGroup.conversationId,
                                targetUserId: item?.userId
                              });
                            }}
                          >
                            {groupActionId === `group-remove:${selectedGroup.conversationId}:${item?.userId}` ? '移出中...' : '移出'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedGroup.canManage ? (
            <div className="chat-dock-subsection">
              <div className="chat-dock-list__header">
                <span>添加群成员</span>
                <span>{availableGroupInviteRows.length} 位好友可加入</span>
              </div>
              {availableGroupInviteRows.length === 0 ? (
                <div className="chat-dock-empty">当前没有可添加的好友成员。</div>
              ) : (
                <div className="chat-dock-group-member-list">
                  {availableGroupInviteRows.map((item) => (
                    <div key={item?._id} className="chat-dock-user-row">
                      {renderAvatarTrigger(item, 36)}
                      <div className="chat-dock-user-row__content">
                        <div className="chat-dock-user-row__title">{item?.username || '未命名用户'}</div>
                        <div className="chat-dock-user-row__meta">{renderUserMetaText(item) || '好友成员'}</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        disabled={groupActionId === `group-add:${selectedGroup.conversationId}`}
                        onClick={() => onAddGroupMembers({
                          conversationId: selectedGroup.conversationId,
                          memberUserIds: [item?._id]
                        })}
                      >
                        {groupActionId === `group-add:${selectedGroup.conversationId}` ? '添加中...' : '加入群聊'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderGroupsPane = () => (
    <>
      <div className="chat-dock-sidebar">
        <div className="chat-dock-list">
          <div className="chat-dock-list__header">
            <span>我的群聊</span>
            <button
              type="button"
              className="chat-dock-inline-link"
              onClick={() => {
                setIsCreateGroupMode(true);
                setSelectedGroupId('');
              }}
            >
              <Plus size={14} />
              创建群聊
            </button>
          </div>
          {groups.length === 0 ? (
            <div className="chat-dock-empty">当前没有群聊，先创建一个新的群聊。</div>
          ) : groups.map((item) => {
            const isActive = item?.conversationId === selectedGroupId;
            return (
              <button
                key={item?.conversationId}
                type="button"
                className={`chat-dock-list-item${isActive ? ' is-active' : ''}`}
                onClick={() => handleOpenGroupDetail(item?.conversationId)}
              >
                <UserAvatar user={{ avatar: item?.avatar, username: item?.title }} size={42} />
                <span className="chat-dock-list-item__content">
                  <span className="chat-dock-list-item__top">
                    <span className="chat-dock-list-item__title">{item?.title || '未命名群聊'}</span>
                    <span className="chat-dock-list-item__time">{formatRelativeDateTime(item?.lastMessageAt)}</span>
                  </span>
                  <span className="chat-dock-list-item__preview">
                    {item?.announcement || item?.lastMessagePreview || `共 ${item?.memberCount || 0} 人`}
                  </span>
                </span>
                <span className="chat-dock-list-item__side">
                  <span className="chat-dock-chip">{item?.memberCount || 0}人</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {isCreateGroupMode ? renderGroupCreatePane() : renderGroupDetailPane()}
    </>
  );

  return (
    <div className="chat-dock-panel">
      <div className="chat-dock-panel__header">
        <div>
          <div className="chat-dock-panel__eyebrow">社交与会话</div>
          <h3>好友 / 会话中心</h3>
          <p>会话列表统一承载单聊和群聊，群聊页签用于创建和管理群聊。</p>
        </div>
        <button type="button" className="chat-dock-close-btn" onClick={onClose} title="收起聊天面板">
          <X size={16} />
        </button>
      </div>

      {panelNotice ? <div className="chat-dock-notice">{panelNotice}</div> : null}

      <div className="chat-dock-tabs chat-dock-tabs--top">
        <SidebarTabButton
          active={isConversationTab}
          icon={MessagesSquare}
          label="会话"
          badge={conversations.length > 0 ? String(conversations.length) : ''}
          onClick={() => setActiveSidebarTab('conversations')}
        />
        <SidebarTabButton
          active={isFriendsTab}
          icon={Users}
          label="好友"
          badge={friends.length > 0 ? String(friends.length) : ''}
          onClick={() => setActiveSidebarTab('friends')}
        />
        <SidebarTabButton
          active={isGroupsTab}
          icon={UserPlus}
          label="群聊"
          badge={groups.length > 0 ? String(groups.length) : ''}
          onClick={() => setActiveSidebarTab('groups')}
        />
      </div>

      <div className={`chat-dock-body${isConversationTab ? ' is-conversations' : isGroupsTab ? ' is-groups' : ' is-friends'}`}>
        {isConversationTab ? renderConversationPane() : null}
        {isFriendsTab ? renderFriendsPane() : null}
        {isGroupsTab ? renderGroupsPane() : null}
      </div>

      {isRequestsModalOpen ? (
        <div className="chat-dock-modal-layer" onClick={closeRequestsModal}>
          <div
            className="chat-dock-modal"
            role="dialog"
            aria-modal="true"
            aria-label="好友申请"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="chat-dock-modal__header">
              <div>
                <div className="chat-dock-panel__eyebrow">好友关系</div>
                <div className="chat-dock-modal__title">好友申请</div>
                <div className="chat-dock-modal__subtitle">在这里统一处理收到的申请，并查看自己发出的申请状态。</div>
              </div>
              <button
                type="button"
                className="chat-dock-close-btn"
                onClick={closeRequestsModal}
                title="关闭申请弹窗"
              >
                <X size={16} />
              </button>
            </div>

            <div className="chat-dock-modal__body">
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
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ChatDockPanel;
