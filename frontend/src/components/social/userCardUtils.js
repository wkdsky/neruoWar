const toIdText = (value) => String(value || '').trim();

export const getUserId = (user = {}) => {
  const candidates = [
    user?.userId,
    user?.user?._id,
    user?.user?.userId,
    user?.user?.id,
    user?._id,
    user?.id,
    user?.inviteeId,
    user?.requesterId,
    user?.addresseeId
  ];

  return candidates.map(toIdText).find(Boolean) || '';
};

export const renderUserMetaText = (user = {}) => {
  const parts = [user?.profession, user?.allianceName].filter(Boolean);
  return parts.join(' · ');
};

export const resolveUserFriendStatus = ({
  user,
  currentUserId,
  friends = [],
  friendRequests = {}
}) => {
  const targetUserId = getUserId(user);
  if (!targetUserId) return 'none';
  if (targetUserId === String(currentUserId || '')) return 'self';
  if (typeof user?.friendStatus === 'string' && user.friendStatus.trim()) {
    return user.friendStatus.trim();
  }

  const safeFriends = Array.isArray(friends) ? friends : [];
  if (safeFriends.some((item) => getUserId(item?.user) === targetUserId)) {
    return 'friend';
  }

  const received = Array.isArray(friendRequests?.received) ? friendRequests.received : [];
  if (received.some((item) => getUserId(item?.user) === targetUserId)) {
    return 'pending_received';
  }

  const sent = Array.isArray(friendRequests?.sent) ? friendRequests.sent : [];
  if (sent.some((item) => getUserId(item?.user) === targetUserId)) {
    return 'pending_sent';
  }

  return 'none';
};
