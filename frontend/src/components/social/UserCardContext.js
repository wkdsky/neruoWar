import React, { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveAvatarSrc } from '../../app/appShared';
import {
  getUserId,
  renderUserMetaText,
  resolveUserFriendStatus
} from './userCardUtils';
import './UserCardContext.css';

const UserCardContext = createContext({
  closeUserCard: () => {},
  openUserCard: () => {}
});

const UserCardAvatar = ({ user = {}, size = 52 }) => (
  <img
    src={resolveAvatarSrc(user?.avatar)}
    alt={user?.username || '用户'}
    className="global-user-card__avatar"
    style={{ width: `${size}px`, height: `${size}px` }}
  />
);

export const UserCardProvider = ({
  children,
  currentUserId = '',
  friends = [],
  blockedUsers = [],
  friendRequests = {},
  conversationActionId = '',
  friendActionId = '',
  onOpenDirectConversation,
  onOpenRequestsTab,
  onSendFriendRequest
}) => {
  const [activeUserCard, setActiveUserCard] = useState(null);

  const closeUserCard = () => setActiveUserCard(null);

  const openUserCard = (user, event) => {
    const targetUserId = getUserId(user);
    if (!targetUserId) return;

    const rect = event?.currentTarget?.getBoundingClientRect?.();
    if (!rect) return;

    setActiveUserCard({
      user: {
        ...user,
        _id: targetUserId
      },
      anchorRect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      }
    });
  };

  const handleSendMessage = async (user) => {
    const targetUserId = getUserId(user);
    if (!targetUserId || typeof onOpenDirectConversation !== 'function') return;
    closeUserCard();
    await onOpenDirectConversation(targetUserId);
  };

  const handleSendFriendRequest = async (user) => {
    const targetUserId = getUserId(user);
    if (!targetUserId || typeof onSendFriendRequest !== 'function') return;
    await onSendFriendRequest(targetUserId);
    closeUserCard();
  };

  useEffect(() => {
    if (!activeUserCard) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeUserCard();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeUserCard]);

  const userCardPopover = (() => {
    if (!activeUserCard || typeof document === 'undefined') return null;

    const cardUser = activeUserCard.user || {};
    const friendStatus = resolveUserFriendStatus({
      user: cardUser,
      currentUserId,
      friends,
      friendRequests,
      blockedUsers
    });
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
    const anchorRect = activeUserCard.anchorRect || { top: 0, left: 0, width: 0, height: 0 };
    const popoverWidth = 360;
    const nextLeft = Math.min(
      Math.max(12, anchorRect.left + anchorRect.width + 12),
      viewportWidth - popoverWidth - 12
    );
    const preferTop = anchorRect.top + anchorRect.height + 12;
    const nextTop = Math.min(Math.max(12, preferTop), viewportHeight - 240);
    const publicId = String(cardUser?.publicId || '').trim() || getUserId(cardUser);
    const isFriend = friendStatus === 'friend';
    const isPendingSent = friendStatus === 'pending_sent';
    const isPendingReceived = friendStatus === 'pending_received';
    const isBlocked = friendStatus === 'blocked';
    const isSelf = friendStatus === 'self';

    return createPortal(
      <div className="global-user-card-layer" onClick={closeUserCard}>
        <div
          className="global-user-card"
          style={{
            top: `${nextTop}px`,
            left: `${nextLeft}px`
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="global-user-card__header">
            <UserCardAvatar user={cardUser} />
            <div className="global-user-card__identity">
              <div className="global-user-card__title">{cardUser?.username || '未命名用户'}</div>
              <div className="global-user-card__subline">{publicId}</div>
              {renderUserMetaText(cardUser) ? (
                <div className="global-user-card__meta">{renderUserMetaText(cardUser)}</div>
              ) : null}
            </div>
          </div>

          <div className="global-user-card__actions">
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={conversationActionId === `open:${cardUser?._id}` || isSelf || isBlocked}
              onClick={() => handleSendMessage(cardUser)}
            >
              {conversationActionId === `open:${cardUser?._id}` ? '打开中...' : '发消息'}
            </button>

            {isSelf ? (
              <span className="global-user-card__tag">本人</span>
            ) : isBlocked ? (
              <span className="global-user-card__tag">黑名单中</span>
            ) : isFriend ? (
              <span className="global-user-card__tag">已是好友</span>
            ) : isPendingSent ? (
              <span className="global-user-card__tag">申请中</span>
            ) : isPendingReceived ? (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => {
                  if (typeof onOpenRequestsTab === 'function') {
                    onOpenRequestsTab();
                  }
                  closeUserCard();
                }}
              >
                去处理申请
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={friendActionId === `request:${cardUser?._id}` || isSelf}
                onClick={() => handleSendFriendRequest(cardUser)}
              >
                {friendActionId === `request:${cardUser?._id}` ? '发送中...' : '加好友'}
              </button>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  })();

  return (
    <UserCardContext.Provider value={{ closeUserCard, openUserCard }}>
      {children}
      {userCardPopover}
    </UserCardContext.Provider>
  );
};

export const useUserCard = () => useContext(UserCardContext);
