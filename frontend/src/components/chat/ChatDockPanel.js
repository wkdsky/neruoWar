import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  Copy,
  Crown,
  Info,
  Loader2,
  LogOut,
  Maximize2,
  MessagesSquare,
  Pin,
  Plus,
  Search,
  Send,
  Share2,
  Trash2,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import {
  DEFAULT_GROUP_AVATAR_KEY,
  GROUP_PRESET_AVATAR_OPTIONS,
  resolveAvatarSrc
} from '../../app/appShared';
import { useUserCard } from '../social/UserCardContext';
import {
  getUserId,
  renderUserMetaText,
  resolveUserFriendStatus
} from '../social/userCardUtils';
import './ChatDockPanel.css';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const PULL_REFRESH_TRIGGER_DISTANCE = 72;
const PULL_REFRESH_MAX_DISTANCE = 108;
const CHAT_SCROLL_POSITIONS_STORAGE_KEY = 'chat-dock-scroll-positions:v1';
const GROUP_SHARE_DISMISSED_STORAGE_KEY = 'chat-dock-dismissed-group-share:v1';
const MAX_GROUP_SHARE_TARGET_COUNT = 20;

const createClosedConfirmDialogState = () => ({
  open: false,
  title: '请确认',
  message: '',
  confirmText: '确认',
  confirmTone: 'danger',
  onConfirm: null,
  busy: false
});

const normalizeConversationId = (value) => {
  const normalizedValue = typeof value === 'string'
    ? value.trim()
    : value?.toString?.().trim?.() || '';
  return OBJECT_ID_PATTERN.test(normalizedValue) ? normalizedValue : '';
};

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

const formatExactDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

const readStoredConversationScrollPositions = () => {
  if (typeof window === 'undefined') return {};

  try {
    const rawValue = window.sessionStorage.getItem(CHAT_SCROLL_POSITIONS_STORAGE_KEY);
    if (!rawValue) return {};
    const parsedValue = JSON.parse(rawValue);
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
  } catch (_error) {
    return {};
  }
};

const writeStoredConversationScrollPositions = (positions = {}) => {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(
      CHAT_SCROLL_POSITIONS_STORAGE_KEY,
      JSON.stringify(positions && typeof positions === 'object' ? positions : {})
    );
  } catch (_error) {
    // ignore storage write failures in private mode or restricted environments
  }
};

const readStoredDismissedGroupShareIds = () => {
  if (typeof window === 'undefined') return {};

  try {
    const rawValue = window.sessionStorage.getItem(GROUP_SHARE_DISMISSED_STORAGE_KEY);
    if (!rawValue) return {};
    const parsedValue = JSON.parse(rawValue);
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
  } catch (_error) {
    return {};
  }
};

const writeStoredDismissedGroupShareIds = (entries = {}) => {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(
      GROUP_SHARE_DISMISSED_STORAGE_KEY,
      JSON.stringify(entries && typeof entries === 'object' ? entries : {})
    );
  } catch (_error) {
    // ignore sessionStorage write failures
  }
};

const SidebarTabButton = ({
  active = false,
  badge = '',
  badgeTone = 'default',
  icon: Icon,
  label,
  onClick
}) => (
  <button
    type="button"
    className={`chat-dock-tab-btn${active ? ' is-active' : ''}${badge ? ` has-badge has-badge--${badgeTone}` : ''}`}
    onClick={onClick}
  >
    <span className="chat-dock-tab-btn__main">
      <span className="chat-dock-tab-btn__icon">{Icon ? <Icon size={15} strokeWidth={2} /> : null}</span>
      <span>{label}</span>
    </span>
    {badge ? <span className={`chat-dock-tab-btn__badge chat-dock-tab-btn__badge--${badgeTone}`}>{badge}</span> : null}
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
  blockedUsers = [],
  groupActionId,
  groupDetailLoading,
  groups = [],
  groupInviteActionId,
  groupInviteListLoading,
  groupInviteSearchLoading,
  groupInviteSearchQuery = '',
  groupInviteSearchResults = [],
  groupSearchAttempted = false,
  groupSearchLoading = false,
  groupSearchQuery = '',
  groupSearchResult = null,
  groupInvites = {},
  loadOlderMessages,
  onBlockUser,
  onClose,
  onCreateGroupConversation,
  onCreateGroupNotice,
  onDeleteConversation,
  onDeleteGroupNotice,
  onDisbandGroupConversation,
  onFriendSearchQueryChange,
  onInviteGroupMembers,
  onJoinGroupConversation,
  onLeaveGroupConversation,
  onOpenConversation,
  onOpenDirectConversation,
  onOpenGroupDetail,
  onOpenUserProfile,
  onRefreshConversation,
  onRemoveFriend,
  onRemoveGroupMember,
  onRespondFriendRequest,
  onRespondGroupInvitation,
  onShareGroupConversationCard,
  onSearchGroupConversation,
  onSearchUsers,
  onSearchGroupInviteUsers,
  onSendFriendRequest,
  onSendMessage,
  onToggleConversationPinned,
  onTransferGroupOwnership,
  onUnblockUser,
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
  setGroupInviteSearchQuery,
  setGroupSearchQuery,
  setIsRequestsModalOpen,
  setPanelNotice,
  setSelectedConversationId,
  setSelectedGroupId
}) => {
  const readIsMobileLayout = () => (
    typeof window !== 'undefined'
      ? window.innerWidth <= 920
      : false
  );
  const [isMobileLayout, setIsMobileLayout] = useState(readIsMobileLayout);
  const [draftMessage, setDraftMessage] = useState('');
  const [isComposerExpanded, setIsComposerExpanded] = useState(false);
  const [pullRefreshDistance, setPullRefreshDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const [showNewMessageHint, setShowNewMessageHint] = useState(false);
  const [isCreateGroupMode, setIsCreateGroupMode] = useState(false);
  const [isGroupInviteModalOpen, setIsGroupInviteModalOpen] = useState(false);
  const [isGroupShareModalOpen, setIsGroupShareModalOpen] = useState(false);
  const [isGroupNoticeModalOpen, setIsGroupNoticeModalOpen] = useState(false);
  const [isGroupAvatarModalOpen, setIsGroupAvatarModalOpen] = useState(false);
  const [groupInviteModalMode, setGroupInviteModalMode] = useState('outbound');
  const [groupAvatarModalMode, setGroupAvatarModalMode] = useState('settings');
  const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);
  const [groupShareSearchQuery, setGroupShareSearchQuery] = useState('');
  const [groupShareTargetUserIds, setGroupShareTargetUserIds] = useState([]);
  const [groupShareTargetConversationIds, setGroupShareTargetConversationIds] = useState([]);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupTitleError, setNewGroupTitleError] = useState('');
  const [newGroupAnnouncement, setNewGroupAnnouncement] = useState('');
  const [newGroupAvatar, setNewGroupAvatar] = useState(DEFAULT_GROUP_AVATAR_KEY);
  const [groupTitleDraft, setGroupTitleDraft] = useState('');
  const [groupNoticeDraft, setGroupNoticeDraft] = useState('');
  const [groupAvatarDraft, setGroupAvatarDraft] = useState(DEFAULT_GROUP_AVATAR_KEY);
  const [friendRequestDraft, setFriendRequestDraft] = useState('');
  const [friendRequestTarget, setFriendRequestTarget] = useState(null);
  const [confirmDialogState, setConfirmDialogState] = useState(createClosedConfirmDialogState);
  const [centerToastMessage, setCenterToastMessage] = useState('');
  const [dismissedGroupShareIds, setDismissedGroupShareIds] = useState(readStoredDismissedGroupShareIds);
  const messagesViewportRef = useRef(null);
  const composerTextareaRef = useRef(null);
  const expandedComposerTextareaRef = useRef(null);
  const isPullRefreshingRef = useRef(false);
  const isMessagesLoadingRef = useRef(false);
  const pullRefreshDistanceRef = useRef(0);
  const composerSelectionRef = useRef({
    start: 0,
    end: 0,
    direction: 'none'
  });
  const previousConversationIdRef = useRef('');
  const previousLastMessageKeyRef = useRef('');
  const activeConversationIdRef = useRef('');
  const conversationScrollPositionsRef = useRef(null);
  const centerToastTimerRef = useRef(null);
  const requestedGroupNoSyncConversationIdRef = useRef('');
  const { openUserCard } = useUserCard();

  if (conversationScrollPositionsRef.current === null) {
    conversationScrollPositionsRef.current = readStoredConversationScrollPositions();
  }

  const isConversationTab = activeSidebarTab === 'conversations';
  const isFriendsTab = activeSidebarTab === 'friends';
  const isGroupsTab = activeSidebarTab === 'groups';
  const directConversations = useMemo(
    () => conversations.filter((item) => item?.type !== 'group'),
    [conversations]
  );
  const receivedRequests = Array.isArray(friendRequests.received) ? friendRequests.received : [];
  const sentRequests = Array.isArray(friendRequests.sent) ? friendRequests.sent : [];
  const receivedGroupInvites = Array.isArray(groupInvites?.received) ? groupInvites.received : [];
  const blockedRows = useMemo(() => (Array.isArray(blockedUsers) ? blockedUsers : []), [blockedUsers]);
  const hasRequestInfo = receivedRequests.length > 0 || sentRequests.length > 0;
  const unreadConversationCount = useMemo(
    () => directConversations.reduce((sum, item) => sum + Math.max(0, Number(item?.unreadCount) || 0), 0),
    [directConversations]
  );
  const unreadGroupCount = useMemo(
    () => groups.reduce((sum, item) => sum + Math.max(0, Number(item?.unreadCount) || 0), 0),
    [groups]
  );
  const conversationTabBadge = unreadConversationCount > 0
    ? String(unreadConversationCount > 99 ? '99+' : unreadConversationCount)
    : '';
  const friendsTabBadge = receivedRequests.length > 0
    ? String(receivedRequests.length > 99 ? '99+' : receivedRequests.length)
    : '';
  const isFriendRequestComposerOpen = Boolean(friendRequestTarget?._id);
  const selectedMessages = useMemo(
    () => (Array.isArray(selectedMessagesEntry?.rows) ? selectedMessagesEntry.rows : []),
    [selectedMessagesEntry?.rows]
  );

  const conversationPlaceholder = useMemo(() => {
    if (directConversations.length > 0) {
      return '选择一个会话开始聊天，列表统一按置顶优先和最近消息排序。';
    }
    return '当前没有可见会话。你可以先从好友或群聊入口发起聊天。';
  }, [directConversations.length]);
  const selectedDirectConversation = useMemo(() => (
    selectedConversation?.type === 'group' ? null : selectedConversation
  ), [selectedConversation]);
  const expandedComposerTarget = isGroupsTab ? selectedConversation : selectedDirectConversation;

  const selectedConversationFriendStatus = useMemo(() => (
    selectedDirectConversation?.directUser
      ? resolveUserFriendStatus({
        user: selectedDirectConversation.directUser,
        currentUserId,
        friends,
        friendRequests,
        blockedUsers: blockedRows
      })
      : 'none'
  ), [blockedRows, currentUserId, friendRequests, friends, selectedDirectConversation?.directUser]);
  const isUserBlockedByCurrentUser = (userId) => (
    blockedRows.some((item) => String(item?.user?._id || '') === String(userId || ''))
  );
  const selectedConversationBlockedByCurrentUser = useMemo(() => (
    blockedRows.some((item) => (
      String(item?.user?._id || '') === String(selectedDirectConversation?.directUser?._id || '')
    ))
  ), [blockedRows, selectedDirectConversation?.directUser?._id]);

  const selectedGroup = useMemo(() => (
    selectedGroupDetail?.group || null
  ), [selectedGroupDetail]);
  const selectedGroupConversation = useMemo(() => (
    selectedGroupDetail?.conversation || null
  ), [selectedGroupDetail]);
  const selectedGroupConversationId = useMemo(() => (
    normalizeConversationId(
      selectedGroup?.conversationId
      || selectedGroupConversation?.conversationId
      || selectedGroupId
    )
  ), [selectedGroup?.conversationId, selectedGroupConversation?.conversationId, selectedGroupId]);
  const selectedGroupConversationEntry = useMemo(() => (
    conversations.find((item) => item?.conversationId === selectedGroupConversationId && item?.type === 'group')
    || selectedGroupConversation
    || null
  ), [conversations, selectedGroupConversation, selectedGroupConversationId]);
  const selectedGroupTitle = useMemo(() => (
    selectedGroup?.title
    || selectedGroupConversationEntry?.title
    || selectedConversation?.title
    || ''
  ), [selectedConversation?.title, selectedGroup?.title, selectedGroupConversationEntry?.title]);
  const selectedGroupAvatar = useMemo(() => (
    selectedGroup?.avatar
    || selectedGroupConversationEntry?.avatar
    || selectedConversation?.avatar
    || DEFAULT_GROUP_AVATAR_KEY
  ), [
    selectedConversation?.avatar,
    selectedGroup?.avatar,
    selectedGroupConversationEntry?.avatar
  ]);
  const selectedGroupNo = useMemo(() => (
    String(
      selectedGroup?.groupNo
      || selectedGroupConversationEntry?.groupNo
      || selectedConversation?.groupNo
      || ''
    ).trim()
  ), [
    selectedConversation?.groupNo,
    selectedGroup?.groupNo,
    selectedGroupConversationEntry?.groupNo
  ]);
  const selectedGroupCreatedAt = useMemo(() => (
    selectedGroup?.createdAt
    || selectedGroupConversation?.createdAt
    || null
  ), [selectedGroup?.createdAt, selectedGroupConversation?.createdAt]);
  const selectedGroupLastActiveAt = useMemo(() => (
    selectedGroup?.lastActiveAt
    || selectedGroupConversationEntry?.lastMessageAt
    || selectedGroupConversation?.lastMessageAt
    || selectedGroupCreatedAt
    || null
  ), [
    selectedGroup?.lastActiveAt,
    selectedGroupConversation?.lastMessageAt,
    selectedGroupConversationEntry?.lastMessageAt,
    selectedGroupCreatedAt
  ]);
  const selectedGroupAnnouncementText = useMemo(() => (
    String(
      selectedGroup?.announcement
      || selectedGroupConversationEntry?.announcement
      || ''
    ).trim()
  ), [
    selectedGroup?.announcement,
    selectedGroupConversationEntry?.announcement
  ]);
  const selectedGroupNoticeHistory = useMemo(() => {
    const rows = Array.isArray(selectedGroup?.noticeHistory)
      ? selectedGroup.noticeHistory.filter((item) => String(item?.content || '').trim())
      : [];
    if (rows.length > 0) {
      return rows;
    }
    if (!selectedGroupAnnouncementText) {
      return [];
    }
    return [{
      noticeId: 'current-notice',
      content: selectedGroupAnnouncementText,
      createdAt: selectedGroup?.announcementUpdatedAt || null,
      createdBy: selectedGroup?.announcementUpdatedByUser || null
    }];
  }, [
    selectedGroup?.announcementUpdatedAt,
    selectedGroup?.announcementUpdatedByUser,
    selectedGroup?.noticeHistory,
    selectedGroupAnnouncementText
  ]);
  const selectedGroupMembers = useMemo(() => (
    Array.isArray(selectedGroup?.members) ? selectedGroup.members : []
  ), [selectedGroup?.members]);
  const selectedGroupMemberCount = Number(selectedGroup?.memberCount) || selectedGroupMembers.length || 0;
  const selectedGroupMessagesEntry = useMemo(() => (
    selectedConversation?.conversationId === selectedGroupConversationId
      ? selectedMessagesEntry
      : {
        rows: [],
        nextBeforeSeq: 0,
        loading: false,
        error: '',
        initialized: false
      }
  ), [selectedConversation?.conversationId, selectedGroupConversationId, selectedMessagesEntry]);
  const selectedGroupMessages = useMemo(
    () => (Array.isArray(selectedGroupMessagesEntry?.rows) ? selectedGroupMessagesEntry.rows : []),
    [selectedGroupMessagesEntry?.rows]
  );
  const selectedGroupMemberIdSet = useMemo(() => (
    new Set(selectedGroupMembers.map((item) => String(item?.userId || '')))
  ), [selectedGroupMembers]);
  const isSelectedGroupOwner = selectedGroup?.currentUserRole === 'owner';

  const availableGroupInviteRows = useMemo(() => (
    friends
      .map((item) => item?.user || null)
      .filter((item) => item?._id && !selectedGroupMemberIdSet.has(String(item._id)))
  ), [friends, selectedGroupMemberIdSet]);
  const joinedGroupConversationIdSet = useMemo(() => (
    new Set(
      groups
        .map((item) => normalizeConversationId(item?.conversationId))
        .filter(Boolean)
    )
  ), [groups]);
  const normalizedGroupShareSearchQuery = String(groupShareSearchQuery || '').trim().toLowerCase();
  const shareableFriendRows = useMemo(() => (
    friends
      .map((item) => item?.user || null)
      .filter((item) => item?._id)
      .filter((item) => {
        if (!normalizedGroupShareSearchQuery) return true;
        const username = String(item?.username || '').toLowerCase();
        return username.includes(normalizedGroupShareSearchQuery);
      })
  ), [friends, normalizedGroupShareSearchQuery]);
  const shareableGroupRows = useMemo(() => (
    groups
      .filter((item) => item?.conversationId && item?.conversationId !== selectedGroupConversationId)
      .filter((item) => {
        if (!normalizedGroupShareSearchQuery) return true;
        const haystack = [
          item?.title || '',
          item?.announcement || '',
          item?.groupNo || ''
        ].join(' ').toLowerCase();
        return haystack.includes(normalizedGroupShareSearchQuery);
      })
  ), [groups, normalizedGroupShareSearchQuery, selectedGroupConversationId]);
  const selectedGroupShareCount = groupShareTargetUserIds.length + groupShareTargetConversationIds.length;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleResize = () => {
      setIsMobileLayout(readIsMobileLayout());
    };

    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    setGroupTitleDraft(selectedGroupTitle || '');
    setGroupAvatarDraft(selectedGroupAvatar || DEFAULT_GROUP_AVATAR_KEY);
  }, [selectedGroupAvatar, selectedGroupTitle]);

  useEffect(() => {
    setIsGroupSettingsOpen(false);
    setIsGroupShareModalOpen(false);
    setIsGroupNoticeModalOpen(false);
    setIsGroupAvatarModalOpen(false);
    setGroupNoticeDraft('');
    setGroupShareSearchQuery('');
    setGroupShareTargetUserIds([]);
    setGroupShareTargetConversationIds([]);
  }, [selectedGroupConversationId]);

  useEffect(() => {
    if (!selectedGroupConversationId) {
      requestedGroupNoSyncConversationIdRef.current = '';
      return;
    }
    if (selectedGroupNo) {
      requestedGroupNoSyncConversationIdRef.current = '';
      return;
    }
    if (requestedGroupNoSyncConversationIdRef.current === selectedGroupConversationId) {
      return;
    }
    requestedGroupNoSyncConversationIdRef.current = selectedGroupConversationId;
    if (typeof onOpenGroupDetail === 'function') {
      void onOpenGroupDetail(selectedGroupConversationId);
    }
  }, [onOpenGroupDetail, selectedGroupConversationId, selectedGroupNo]);

  useEffect(() => {
    writeStoredDismissedGroupShareIds(dismissedGroupShareIds);
  }, [dismissedGroupShareIds]);

  useEffect(() => {
    setIsComposerExpanded(false);
  }, [selectedConversation?.conversationId]);

  useEffect(() => {
    pullRefreshDistanceRef.current = 0;
    setPullRefreshDistance(0);
    setIsPullRefreshing(false);
  }, [selectedConversation?.conversationId]);

  useEffect(() => {
    isPullRefreshingRef.current = isPullRefreshing;
  }, [isPullRefreshing]);

  useEffect(() => {
    isMessagesLoadingRef.current = Boolean(selectedMessagesEntry?.loading);
  }, [selectedMessagesEntry?.loading]);

  useEffect(() => {
    if (!isComposerExpanded || typeof window === 'undefined') return undefined;
    const frameId = window.requestAnimationFrame(() => {
      const textarea = expandedComposerTextareaRef.current;
      if (!textarea) return;
      const { start, end, direction } = composerSelectionRef.current;
      try {
        textarea.setSelectionRange(start, end, direction);
      } catch (_error) {
        // ignore selection restore failures on unsupported platforms
      }
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isComposerExpanded]);

  useEffect(() => () => {
    if (centerToastTimerRef.current) {
      window.clearTimeout(centerToastTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    const activeConversationId = selectedConversation?.conversationId || '';
    if (!viewport || !isMobileLayout || !activeConversationId) {
      pullRefreshDistanceRef.current = 0;
      setPullRefreshDistance(0);
      return undefined;
    }

    let disposed = false;
    let startY = 0;
    let isDragging = false;

    const updatePullDistance = (value) => {
      const nextValue = Math.max(0, Math.round(value));
      pullRefreshDistanceRef.current = nextValue;
      if (!disposed) {
        setPullRefreshDistance(nextValue);
      }
    };

    const resetPullRefresh = () => {
      updatePullDistance(0);
    };

    const handleTouchStart = (event) => {
      if (isPullRefreshingRef.current || isMessagesLoadingRef.current || viewport.scrollTop > 0) {
        isDragging = false;
        return;
      }
      const touch = event.touches?.[0];
      if (!touch) return;
      startY = touch.clientY;
      isDragging = true;
    };

    const handleTouchMove = (event) => {
      if (!isDragging || isPullRefreshingRef.current) return;
      if (viewport.scrollTop > 0) {
        isDragging = false;
        resetPullRefresh();
        return;
      }
      const touch = event.touches?.[0];
      if (!touch) return;
      const deltaY = touch.clientY - startY;
      if (deltaY <= 0) {
        resetPullRefresh();
        return;
      }
      event.preventDefault();
      updatePullDistance(Math.min(PULL_REFRESH_MAX_DISTANCE, deltaY * 0.46));
    };

    const finishGesture = async () => {
      if (!isDragging) {
        if (!isPullRefreshingRef.current) {
          resetPullRefresh();
        }
        return;
      }

      isDragging = false;
      const shouldRefresh = (
        pullRefreshDistanceRef.current >= PULL_REFRESH_TRIGGER_DISTANCE
        && typeof onRefreshConversation === 'function'
      );
      if (!shouldRefresh) {
        resetPullRefresh();
        return;
      }

      if (!disposed) {
        setIsPullRefreshing(true);
        setPullRefreshDistance(PULL_REFRESH_TRIGGER_DISTANCE);
      }
      pullRefreshDistanceRef.current = PULL_REFRESH_TRIGGER_DISTANCE;

      try {
        await onRefreshConversation(activeConversationId);
      } finally {
        if (!disposed) {
          setIsPullRefreshing(false);
        }
        resetPullRefresh();
      }
    };

    viewport.addEventListener('touchstart', handleTouchStart, { passive: true });
    viewport.addEventListener('touchmove', handleTouchMove, { passive: false });
    viewport.addEventListener('touchend', finishGesture);
    viewport.addEventListener('touchcancel', finishGesture);

    return () => {
      disposed = true;
      viewport.removeEventListener('touchstart', handleTouchStart);
      viewport.removeEventListener('touchmove', handleTouchMove);
      viewport.removeEventListener('touchend', finishGesture);
      viewport.removeEventListener('touchcancel', finishGesture);
    };
  }, [
    isMobileLayout,
    onRefreshConversation,
    selectedConversation?.conversationId
  ]);

  const openFriendRequestComposer = (user = null) => {
    const targetUserId = user?._id || '';
    if (!targetUserId) return;
    setFriendRequestTarget({
      _id: targetUserId,
      username: user?.username || '该用户'
    });
    setFriendRequestDraft('');
  };

  const closeFriendRequestComposer = () => {
    setFriendRequestTarget(null);
    setFriendRequestDraft('');
  };

  const closeConfirmDialog = () => {
    setConfirmDialogState((prev) => (prev.busy ? prev : createClosedConfirmDialogState()));
  };

  const openConfirmDialog = ({
    title = '请确认',
    message = '',
    confirmText = '确认',
    confirmTone = 'danger',
    onConfirm
  } = {}) => {
    setConfirmDialogState({
      open: true,
      title,
      message,
      confirmText,
      confirmTone,
      onConfirm: typeof onConfirm === 'function' ? onConfirm : null,
      busy: false
    });
  };

  const handleConfirmDialog = async () => {
    const confirmAction = confirmDialogState.onConfirm;
    if (typeof confirmAction !== 'function') {
      setConfirmDialogState(createClosedConfirmDialogState());
      return;
    }

    setConfirmDialogState((prev) => ({
      ...prev,
      busy: true
    }));

    try {
      await confirmAction();
      setConfirmDialogState(createClosedConfirmDialogState());
    } catch (_error) {
      setConfirmDialogState(createClosedConfirmDialogState());
    }
  };

  const pushPanelNotice = (message = '') => {
    if (typeof setPanelNotice === 'function') {
      setPanelNotice(message);
    }
  };

  const showCenterToast = (message = '') => {
    const safeMessage = String(message || '').trim();
    if (!safeMessage) return;
    if (centerToastTimerRef.current) {
      window.clearTimeout(centerToastTimerRef.current);
    }
    setCenterToastMessage(safeMessage);
    centerToastTimerRef.current = window.setTimeout(() => {
      centerToastTimerRef.current = null;
      setCenterToastMessage('');
    }, 1600);
  };

  const syncComposerSelection = (target) => {
    if (!target || typeof target.selectionStart !== 'number' || typeof target.selectionEnd !== 'number') {
      return;
    }
    composerSelectionRef.current = {
      start: target.selectionStart,
      end: target.selectionEnd,
      direction: typeof target.selectionDirection === 'string' ? target.selectionDirection : 'none'
    };
  };

  const openExpandedComposer = () => {
    syncComposerSelection(composerTextareaRef.current);
    setIsComposerExpanded(true);
  };

  const submitFriendRequest = async () => {
    const targetUserId = friendRequestTarget?._id || '';
    const message = friendRequestDraft.trim();
    if (!targetUserId || !message) return;
    const result = await onSendFriendRequest(targetUserId, message);
    if (result) {
      closeFriendRequestComposer();
    }
  };

  const handleOpenFriendRequestComposer = async (user = null) => {
    const targetUserId = user?._id || '';
    if (!targetUserId) return;
    if (isUserBlockedByCurrentUser(targetUserId)) {
      openConfirmDialog({
        title: '先解除拉黑',
        message: `你已将「${user?.username || '该用户'}」加入黑名单。是否先解除拉黑，再继续发送好友申请？`,
        confirmText: '解除拉黑并继续',
        confirmTone: 'warning',
        onConfirm: async () => {
          const unblocked = await onUnblockUser(targetUserId);
          if (!unblocked) return;
          openFriendRequestComposer(user);
        }
      });
      return;
    }
    openFriendRequestComposer(user);
  };

  const handleRemoveFriend = async (friendship = {}) => {
    const friendshipId = friendship?.friendshipId || '';
    const username = friendship?.user?.username || '该好友';
    if (!friendshipId) return;
    openConfirmDialog({
      title: '确认删除好友',
      message: `确认删除好友「${username}」吗？删除后双方仍可通过私聊进行最多三条临时聊天。`,
      confirmText: '删除好友',
      confirmTone: 'danger',
      onConfirm: async () => {
        await onRemoveFriend(friendshipId);
      }
    });
  };

  const handleBlockTarget = async ({ targetUserId = '', friendshipId = '', username = '该用户' } = {}) => {
    if (!targetUserId && !friendshipId) return;
    openConfirmDialog({
      title: '确认拉黑用户',
      message: `确认将「${username}」加入黑名单吗？之后对方的好友申请和临时消息都会被拒绝。`,
      confirmText: '确认拉黑',
      confirmTone: 'danger',
      onConfirm: async () => {
        await onBlockUser({ targetUserId, friendshipId });
      }
    });
  };

  const handleSubmitMessage = async ({ closeExpanded = false } = {}) => {
    if (!selectedConversation?.conversationId) return;
    const message = draftMessage.trim();
    if (!message) return;
    if (selectedConversationFriendStatus === 'blocked') {
      if (!selectedConversationBlockedByCurrentUser) return;
      const targetUserId = selectedConversation?.directUser?._id || '';
      openConfirmDialog({
        title: '先解除拉黑',
        message: `你已将「${selectedConversation?.title || '对方'}」加入黑名单。是否先解除拉黑并继续发送这条消息？`,
        confirmText: '解除拉黑并发送',
        confirmTone: 'warning',
        onConfirm: async () => {
          const unblocked = await onUnblockUser(targetUserId);
          if (!unblocked) return;
          const sent = await onSendMessage(selectedConversation.conversationId, message);
          if (sent?.message) {
            setDraftMessage('');
            if (closeExpanded) {
              setIsComposerExpanded(false);
            }
          }
        }
      });
      return;
    }

    const sent = await onSendMessage(selectedConversation.conversationId, message);
    if (sent?.message) {
      setDraftMessage('');
      if (closeExpanded) {
        setIsComposerExpanded(false);
      }
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

  const copyText = async (text = '') => {
    const content = String(text || '').trim();
    if (!content) return false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        return true;
      }
    } catch (_error) {
      return false;
    }
    return false;
  };

  const handleShareGroupNo = async () => {
    if (!selectedGroupConversationId) return;
    setGroupShareSearchQuery('');
    setGroupShareTargetUserIds([]);
    setGroupShareTargetConversationIds([]);
    setIsGroupShareModalOpen(true);
  };

  const rememberConversationScrollPosition = (conversationId, scrollTop, { flush = false } = {}) => {
    const safeConversationId = normalizeConversationId(conversationId);
    if (!safeConversationId || !Number.isFinite(scrollTop)) return;

    const nextScrollTop = Math.max(0, Math.round(scrollTop));
    const currentPositions = conversationScrollPositionsRef.current || {};
    if (currentPositions[safeConversationId] !== nextScrollTop) {
      conversationScrollPositionsRef.current = {
        ...currentPositions,
        [safeConversationId]: nextScrollTop
      };
    }

    if (flush) {
      writeStoredConversationScrollPositions(conversationScrollPositionsRef.current || {});
    }
  };

  useEffect(() => {
    const currentConversationId = selectedConversation?.conversationId || '';
    const previousConversationId = activeConversationIdRef.current;
    const viewport = messagesViewportRef.current;

    if (previousConversationId && viewport) {
      rememberConversationScrollPosition(previousConversationId, viewport.scrollTop, { flush: true });
    }

    activeConversationIdRef.current = currentConversationId;
  }, [selectedConversation?.conversationId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const flushActiveConversationScroll = () => {
      const activeConversationId = activeConversationIdRef.current;
      const viewport = messagesViewportRef.current;

      if (activeConversationId && viewport) {
        rememberConversationScrollPosition(activeConversationId, viewport.scrollTop);
      }
      writeStoredConversationScrollPositions(conversationScrollPositionsRef.current || {});
    };

    window.addEventListener('pagehide', flushActiveConversationScroll);
    return () => {
      flushActiveConversationScroll();
      window.removeEventListener('pagehide', flushActiveConversationScroll);
    };
  }, []);

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

    if (!viewport || !currentConversationId) {
      setShowNewMessageHint(false);
      previousConversationIdRef.current = currentConversationId;
      previousLastMessageKeyRef.current = lastMessageKey;
      return;
    }

    if (conversationChanged) {
      if (!selectedMessagesEntry?.initialized) {
        previousLastMessageKeyRef.current = lastMessageKey;
        return;
      }

      const storedScrollTop = Number(conversationScrollPositionsRef.current?.[currentConversationId]);
      window.requestAnimationFrame(() => {
        const nextViewport = messagesViewportRef.current;
        if (!nextViewport || selectedConversation?.conversationId !== currentConversationId) return;

        if (Number.isFinite(storedScrollTop)) {
          nextViewport.scrollTo({
            top: Math.max(0, storedScrollTop),
            behavior: 'auto'
          });
        } else {
          nextViewport.scrollTo({
            top: nextViewport.scrollHeight,
            behavior: 'auto'
          });
        }
      });
      setShowNewMessageHint(false);
    } else if (messageAdvanced) {
      const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const isNearBottom = distanceToBottom <= 64;
      const lastMessageIsSelf = String(lastMessage?.senderId || '') === String(currentUserId || '');

      if (lastMessageIsSelf || isNearBottom) {
        window.requestAnimationFrame(() => scrollMessagesToBottom(lastMessageIsSelf ? 'smooth' : 'auto'));
      } else {
        setShowNewMessageHint(true);
      }
    }

    previousConversationIdRef.current = currentConversationId;
    previousLastMessageKeyRef.current = lastMessageKey;
  }, [currentUserId, selectedConversation?.conversationId, selectedMessages, selectedMessagesEntry?.initialized]);

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

  const openGroupInviteModal = (mode = 'outbound') => {
    const nextMode = mode === 'received' ? 'received' : 'outbound';
    if (nextMode === 'outbound' && !selectedGroupConversationId) {
      return;
    }
    if (nextMode === 'outbound') {
      handleCloseGroupSettings();
    }
    setGroupInviteModalMode(nextMode);
    setIsGroupInviteModalOpen(true);
  };

  const closeGroupInviteModal = () => {
    setIsGroupInviteModalOpen(false);
    setGroupInviteModalMode('outbound');
    setGroupInviteSearchQuery('');
  };

  const closeGroupShareModal = () => {
    setIsGroupShareModalOpen(false);
    setGroupShareSearchQuery('');
    setGroupShareTargetUserIds([]);
    setGroupShareTargetConversationIds([]);
  };

  useEffect(() => {
    if (!isGroupInviteModalOpen || groupInviteModalMode !== 'outbound' || selectedGroupConversationId) return;
    setIsGroupInviteModalOpen(false);
    setGroupInviteModalMode('outbound');
    setGroupInviteSearchQuery('');
  }, [groupInviteModalMode, isGroupInviteModalOpen, selectedGroupConversationId, setGroupInviteSearchQuery]);

  const toggleGroupShareUserTarget = (targetUserId = '') => {
    const safeTargetUserId = String(targetUserId || '').trim();
    if (!safeTargetUserId) return;

    setGroupShareTargetUserIds((prev) => {
      if (prev.includes(safeTargetUserId)) {
        return prev.filter((item) => item !== safeTargetUserId);
      }
      if ((prev.length + groupShareTargetConversationIds.length) >= MAX_GROUP_SHARE_TARGET_COUNT) {
        showCenterToast(`单次最多分享给 ${MAX_GROUP_SHARE_TARGET_COUNT} 个目标`);
        return prev;
      }
      return [...prev, safeTargetUserId];
    });
  };

  const toggleGroupShareConversationTarget = (conversationId = '') => {
    const safeConversationId = normalizeConversationId(conversationId);
    if (!safeConversationId || safeConversationId === selectedGroupConversationId) return;

    setGroupShareTargetConversationIds((prev) => {
      if (prev.includes(safeConversationId)) {
        return prev.filter((item) => item !== safeConversationId);
      }
      if ((groupShareTargetUserIds.length + prev.length) >= MAX_GROUP_SHARE_TARGET_COUNT) {
        showCenterToast(`单次最多分享给 ${MAX_GROUP_SHARE_TARGET_COUNT} 个目标`);
        return prev;
      }
      return [...prev, safeConversationId];
    });
  };

  const submitGroupShareCard = async () => {
    if (!selectedGroupConversationId || typeof onShareGroupConversationCard !== 'function') return;
    if (selectedGroupShareCount <= 0) return;

    const result = await onShareGroupConversationCard({
      sourceConversationId: selectedGroupConversationId,
      targetUserIds: groupShareTargetUserIds,
      targetConversationIds: groupShareTargetConversationIds
    });
    if (!result?.targetCount) return;
    closeGroupShareModal();
  };

  const renderAvatarTrigger = (user, size = 40, options = {}) => {
    const targetUserId = getUserId(user);
    const interaction = options.interaction === 'profile'
      ? 'profile'
      : options.interaction === 'none'
        ? 'none'
        : 'card';
    const disabled = !targetUserId || targetUserId === String(currentUserId || '') || interaction === 'none';
    const className = `chat-dock-avatar-trigger${options.compact ? ' is-compact' : ''}${disabled ? ' is-disabled' : ''}`;
    const handleOpen = async (event) => {
      if (disabled) return;
      event.stopPropagation();
      if (interaction === 'profile' && typeof onOpenUserProfile === 'function') {
        await onOpenUserProfile({
          ...user,
          _id: targetUserId
        });
        return;
      }
      openUserCard(user, event);
    };

    return (
      <span
        className={className}
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? -1 : 0}
        onClick={(event) => {
          void handleOpen(event);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          event.stopPropagation();
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void handleOpen(event);
          }
        }}
      >
        <UserAvatar user={user} size={size} />
      </span>
    );
  };

  const renderMessageAvatar = (user = {}, { isSelf = false } = {}) => (
    <div className={`chat-message-avatar-stack${isSelf ? ' is-self' : ''}`}>
      <div className="chat-message-avatar-label">{isSelf ? '我' : user?.username || '对方'}</div>
      {isSelf ? (
        <span className="chat-dock-avatar-trigger is-disabled">
          <UserAvatar user={user} size={32} />
        </span>
      ) : renderAvatarTrigger(user, 32)}
    </div>
  );

  const renderGroupNoLine = (groupNo = '') => {
    const safeGroupNo = String(groupNo || '').trim();
    if (!safeGroupNo) return null;
    return (
      <div className="chat-dock-group-no-line">
        <span>{`群ID ${safeGroupNo}`}</span>
        <button
          type="button"
          className="chat-dock-inline-icon-btn"
          title="复制群ID"
          aria-label="复制群ID"
          onClick={() => {
            void handleCopyGroupNoValue({ value: safeGroupNo, label: '群ID' });
          }}
        >
          <Copy size={13} />
        </button>
      </div>
    );
  };

  const renderGroupDetailField = ({
    label = '',
    value = '',
    copyValue = '',
    emptyText = '暂无'
  } = {}) => {
    const safeValue = String(value || '').trim();
    const safeCopyValue = String(copyValue || '').trim();
    return (
      <div className="chat-dock-group-detail-field">
        <span className="chat-dock-group-detail-field__label">{label}</span>
        <span className="chat-dock-group-detail-field__value">
          <span className={safeValue ? '' : 'is-empty'}>{safeValue || emptyText}</span>
          {safeCopyValue ? (
            <button
              type="button"
              className="chat-dock-inline-icon-btn"
              title={`复制${label}`}
              aria-label={`复制${label}`}
              onClick={() => {
                void handleCopyGroupNoValue({ value: safeCopyValue, label });
              }}
            >
              <Copy size={13} />
            </button>
          ) : null}
        </span>
      </div>
    );
  };

  const renderGroupAvatarPicker = (value = DEFAULT_GROUP_AVATAR_KEY, onChange = () => {}) => (
    <div className="chat-dock-group-avatar-picker">
      {GROUP_PRESET_AVATAR_OPTIONS.map((option) => {
        const isSelected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            className={`chat-dock-group-avatar-option${isSelected ? ' is-selected' : ''}`}
            onClick={() => onChange(option.id)}
          >
            <img src={option.src} alt={option.label} className="chat-dock-group-avatar-option__image" />
            <span className="chat-dock-group-avatar-option__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );

  const resolveGroupAvatarOption = (value = DEFAULT_GROUP_AVATAR_KEY) => (
    GROUP_PRESET_AVATAR_OPTIONS.find((option) => option.id === value)
    || GROUP_PRESET_AVATAR_OPTIONS[0]
    || {
      id: DEFAULT_GROUP_AVATAR_KEY,
      label: '默认群头像',
      src: resolveAvatarSrc(DEFAULT_GROUP_AVATAR_KEY)
    }
  );

  const renderGroupAvatarTrigger = ({
    value = DEFAULT_GROUP_AVATAR_KEY,
    onClick,
    helperText = '点击选择一个内置群头像'
  } = {}) => {
    const selectedAvatarOption = resolveGroupAvatarOption(value);
    return (
      <button
        type="button"
        className="chat-dock-group-avatar-trigger"
        onClick={onClick}
      >
        <span className="chat-dock-group-avatar-trigger__main">
          <img
            src={selectedAvatarOption.src}
            alt={selectedAvatarOption.label}
            className="chat-dock-group-avatar-trigger__image"
          />
          <span className="chat-dock-group-avatar-trigger__content">
            <span className="chat-dock-group-avatar-trigger__title">{selectedAvatarOption.label}</span>
            <span className="chat-dock-group-avatar-trigger__meta">{helperText}</span>
          </span>
        </span>
        <span className="chat-dock-group-avatar-trigger__action">更换头像</span>
      </button>
    );
  };

  const renderGroupShareCardContent = (message = {}, { isSelf = false } = {}) => {
    const sharedGroup = message?.shareCard?.group || null;
    if (!sharedGroup?.conversationId) {
      return <div className="chat-message-bubble__content">{message?.content || '分享了一个群聊'}</div>;
    }

    const isJoined = joinedGroupConversationIdSet.has(String(sharedGroup.conversationId || ''));
    const isDismissed = !!dismissedGroupShareIds[String(message?._id || '')];
    const joinActionKey = `group-join:${sharedGroup?.conversationId || sharedGroup?.groupNo || ''}`;

    return (
      <div className={`chat-group-share-card${isSelf ? ' is-self' : ''}${isDismissed ? ' is-dismissed' : ''}`}>
        <div className="chat-group-share-card__badge">群聊分享</div>
        <div className="chat-group-share-card__header">
          <UserAvatar user={{ avatar: sharedGroup?.avatar || DEFAULT_GROUP_AVATAR_KEY, username: sharedGroup?.title }} size={42} />
            <div>
              <div className="chat-group-share-card__title">{sharedGroup?.title || '未命名群聊'}</div>
              <div className="chat-group-share-card__meta">
                {sharedGroup?.memberCount ? `${sharedGroup.memberCount} 人` : '群聊邀请'}
              </div>
            </div>
          </div>
        <div className="chat-group-share-card__text">
          {sharedGroup?.announcement || '当前没有群简介。'}
        </div>
        <div className="chat-group-share-card__actions">
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={groupActionId === joinActionKey}
            onClick={() => {
              if (isJoined) {
                void handleOpenGroupDetail(sharedGroup.conversationId);
                return;
              }
              void onJoinGroupConversation({
                conversationId: sharedGroup.conversationId,
                groupNo: sharedGroup.groupNo
              });
            }}
          >
            {groupActionId === joinActionKey
              ? '处理中...'
              : isJoined
                ? '打开群聊'
                : '加入群聊'}
          </button>
          {!isSelf && !isJoined ? (
            isDismissed ? (
              <span className="chat-dock-chip">已忽略</span>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => dismissGroupShareCard(message?._id)}
              >
                拒绝
              </button>
            )
          ) : null}
        </div>
      </div>
    );
  };

  const renderMessageBody = (message = {}, { isSelf = false, showSenderName = false } = {}) => (
    <div className={`chat-message-bubble${isSelf ? ' is-self' : ''}${message?.type === 'group_share' ? ' is-card' : ''}`}>
      {!isSelf && showSenderName ? (
        <div className="chat-message-bubble__sender">{message?.sender?.username || '群成员'}</div>
      ) : null}
      {message?.type === 'group_share'
        ? renderGroupShareCardContent(message, { isSelf })
        : <div className="chat-message-bubble__content">{message?.content || ''}</div>}
    </div>
  );

  const renderMessageRow = (message = {}, { showSenderName = false } = {}) => {
    const isSelf = message?.senderId === currentUserId;
    const messageAvatar = renderMessageAvatar(message?.sender || {}, { isSelf });
    return (
      <div key={message?._id || `${message?.conversationId}:${message?.seq}`} className={`chat-message-row${isSelf ? ' is-self' : ''}`}>
        {!isSelf ? messageAvatar : null}
        <div className={`chat-message-stack${isSelf ? ' is-self' : ''}`}>
          <div className={`chat-message-meta-row${isSelf ? ' is-self' : ''}`}>
            <div className="chat-message-meta-time">{formatRelativeDateTime(message?.createdAt)}</div>
          </div>
          {renderMessageBody(message, { isSelf, showSenderName })}
        </div>
        {isSelf ? messageAvatar : null}
      </div>
    );
  };

  const handleCreateGroup = async () => {
    if (!newGroupTitle.trim()) {
      setNewGroupTitleError('群名称不能为空');
      return;
    }

    const result = await onCreateGroupConversation({
      title: newGroupTitle,
      announcement: newGroupAnnouncement,
      avatar: newGroupAvatar,
      memberUserIds: []
    });
    if (!result?.group?.conversationId) return;
    setIsCreateGroupMode(false);
    setIsGroupAvatarModalOpen(false);
    setNewGroupTitle('');
    setNewGroupTitleError('');
    setNewGroupAnnouncement('');
    setNewGroupAvatar(DEFAULT_GROUP_AVATAR_KEY);
  };

  const handleOpenGroupDetail = async (conversationId) => {
    const safeConversationId = normalizeConversationId(conversationId);
    if (!safeConversationId) return;
    setIsCreateGroupMode(false);
    setIsGroupSettingsOpen(false);
    setIsGroupNoticeModalOpen(false);
    setIsGroupAvatarModalOpen(false);
    setSelectedGroupId(safeConversationId);
    await onOpenGroupDetail(safeConversationId);
  };

  const handleToggleConversationPinned = async (conversation = null) => {
    if (!conversation?.conversationId || typeof onToggleConversationPinned !== 'function') return;
    await onToggleConversationPinned({
      conversationId: conversation.conversationId,
      pinned: !conversation?.pinned
    });
  };

  const handleBackToConversationList = () => {
    if (typeof setSelectedConversationId === 'function') {
      setSelectedConversationId('');
    }
    setShowNewMessageHint(false);
  };

  const handleBackToGroupList = () => {
    if (typeof setSelectedGroupId === 'function') {
      setSelectedGroupId('');
    }
    setIsGroupSettingsOpen(false);
    setIsGroupNoticeModalOpen(false);
    setIsGroupAvatarModalOpen(false);
  };

  const handleCloseCreateGroupPane = () => {
    setNewGroupTitleError('');
    setNewGroupAvatar(DEFAULT_GROUP_AVATAR_KEY);
    setIsGroupAvatarModalOpen(false);
    setIsCreateGroupMode(false);
  };

  const handleCloseGroupSettings = () => {
    setIsGroupNoticeModalOpen(false);
    setIsGroupAvatarModalOpen(false);
    setIsGroupSettingsOpen(false);
  };

  const openGroupNoticeModal = () => {
    setIsGroupNoticeModalOpen(true);
  };

  const closeGroupNoticeModal = () => {
    setIsGroupNoticeModalOpen(false);
  };

  const openGroupAvatarModal = (mode = 'settings') => {
    setGroupAvatarModalMode(mode === 'create' ? 'create' : 'settings');
    setIsGroupAvatarModalOpen(true);
  };

  const closeGroupAvatarModal = () => {
    setIsGroupAvatarModalOpen(false);
  };

  const handleSaveGroupSettings = async () => {
    if (!selectedGroupConversationId) return;
    await onUpdateGroupConversation({
      conversationId: selectedGroupConversationId,
      title: groupTitleDraft,
      avatar: groupAvatarDraft
    });
  };

  const handleCreateGroupNotice = async () => {
    if (!selectedGroupConversationId || typeof onCreateGroupNotice !== 'function') return;
    const content = String(groupNoticeDraft || '').trim();
    if (!content) return;
    const result = await onCreateGroupNotice({
      conversationId: selectedGroupConversationId,
      content
    });
    if (result?.group?.conversationId) {
      setGroupNoticeDraft('');
    }
  };

  const handleDeleteGroupNotice = (notice = null) => {
    if (!selectedGroupConversationId || !notice?.noticeId || typeof onDeleteGroupNotice !== 'function') return;
    openConfirmDialog({
      title: '删除群公告',
      message: '确认删除这条群公告吗？',
      confirmText: '删除',
      confirmTone: 'danger',
      onConfirm: async () => {
        await onDeleteGroupNotice({
          conversationId: selectedGroupConversationId,
          noticeId: notice.noticeId
        });
      }
    });
  };

  const handleLeaveGroup = async () => {
    if (!selectedGroupConversationId) return;
    openConfirmDialog({
      title: '确认退出群聊',
      message: `确认退出群聊「${selectedGroup?.title || '未命名群聊'}」吗？`,
      confirmText: '退出群聊',
      confirmTone: 'danger',
      onConfirm: async () => {
        await onLeaveGroupConversation(selectedGroupConversationId);
        setIsCreateGroupMode(false);
        handleCloseGroupSettings();
        setIsGroupAvatarModalOpen(false);
        setNewGroupAvatar(DEFAULT_GROUP_AVATAR_KEY);
      }
    });
  };

  const handleDisbandGroup = async () => {
    if (!selectedGroupConversationId || typeof onDisbandGroupConversation !== 'function') return;
    openConfirmDialog({
      title: '确认解散群聊',
      message: `确认解散群聊「${selectedGroup?.title || '未命名群聊'}」吗？解散后全部成员都会失去这个群聊入口，且无法恢复。`,
      confirmText: '解散群聊',
      confirmTone: 'danger',
      onConfirm: async () => {
        const result = await onDisbandGroupConversation(selectedGroupConversationId);
        if (!result) return;
        if (typeof setSelectedGroupId === 'function') {
          setSelectedGroupId('');
        }
        setIsCreateGroupMode(false);
        setIsGroupAvatarModalOpen(false);
      }
    });
  };

  const handleCopyGroupNoValue = async ({
    value = '',
    label = '内容'
  } = {}) => {
    const safeValue = String(value || '').trim();
    const safeLabel = String(label || '内容').trim() || '内容';
    if (!safeValue) return;
    const copied = await copyText(safeValue);
    if (copied) {
      showCenterToast(`${safeLabel}已复制`);
      return;
    }
    pushPanelNotice(`${safeLabel}复制失败，请手动复制。`);
  };

  const dismissGroupShareCard = (messageId = '') => {
    const safeMessageId = String(messageId || '').trim();
    if (!safeMessageId) return;
    setDismissedGroupShareIds((prev) => ({
      ...prev,
      [safeMessageId]: true
    }));
  };

  const handleSearchGroupConversation = async () => {
    const query = String(groupSearchQuery || '').trim();
    if (!query) {
      if (typeof setGroupSearchQuery === 'function') {
        setGroupSearchQuery('');
      }
      if (typeof onSearchGroupConversation === 'function') {
        await onSearchGroupConversation('');
      }
      return;
    }
    await onSearchGroupConversation(query);
  };

  const handleJoinGroupFromSearch = async (group = null) => {
    if (!group?.conversationId && !group?.groupNo) return;
    await onJoinGroupConversation({
      conversationId: group?.conversationId,
      groupNo: group?.groupNo
    });
  };

  const renderConversationPane = () => (
    <>
      <div className="chat-dock-sidebar chat-dock-sidebar--conversation-list">
        <div className="chat-dock-list">
          <div className="chat-dock-list__header">
            <span>当前会话</span>
            <span className="chat-dock-list__header-side">
              <span>置顶优先</span>
              {conversationListLoading ? <Loader2 size={14} className="chat-spin" /> : null}
            </span>
          </div>
          {directConversations.length === 0 ? (
            <div className="chat-dock-empty">当前没有可见会话。</div>
          ) : directConversations.map((item) => {
            const isActive = item?.conversationId === selectedDirectConversation?.conversationId;
            return (
              <button
                key={item?.conversationId}
                type="button"
                className={`chat-dock-list-item${isActive ? ' is-active' : ''}`}
                onClick={() => onOpenConversation(item?.conversationId)}
              >
                {renderAvatarTrigger(
                  item?.directUser || { avatar: item?.avatar || DEFAULT_GROUP_AVATAR_KEY, username: item?.title },
                  42
                )}
                <span className="chat-dock-list-item__content">
                  <span className="chat-dock-list-item__top">
                    <span className="chat-dock-list-item__title">{item?.title || '未命名会话'}</span>
                    <span className="chat-dock-list-item__time">{formatRelativeDateTime(item?.lastMessageAt)}</span>
                  </span>
                  <span className="chat-dock-list-item__preview">
                    {item?.type === 'group'
                      ? (item?.lastMessagePreview || `共 ${item?.memberCount || 0} 人`)
                      : (item?.lastMessagePreview || '暂无消息，打开后即可开始聊天')}
                  </span>
                </span>
                <span className="chat-dock-list-item__side">
                  <span className="chat-dock-list-item__actions">
                    <span
                      className={`chat-dock-icon-btn${item?.pinned ? ' is-active' : ''}`}
                      role="button"
                      tabIndex={0}
                      title={item?.pinned ? '取消置顶' : '置顶会话'}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleToggleConversationPinned(item);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          void handleToggleConversationPinned(item);
                        }
                      }}
                    >
                      {conversationActionId === `pin:${item?.conversationId}` ? <Loader2 size={15} className="chat-spin" /> : <Pin size={14} />}
                    </span>
                    {item?.type !== 'group' ? (
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
                    ) : null}
                  </span>
                  {Number(item?.unreadCount) > 0 ? (
                    <span className="chat-dock-unread-badge">
                      {Number(item.unreadCount) > 99 ? '99+' : Number(item.unreadCount)}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="chat-dock-main chat-dock-main--conversation-detail">
        <div className="chat-dock-main__header">
          {selectedDirectConversation ? (
            <>
              {isMobileLayout ? (
                <button
                  type="button"
                  className="chat-dock-mobile-back"
                  onClick={handleBackToConversationList}
                  aria-label="返回会话列表"
                >
                  <ChevronLeft size={16} />
                </button>
              ) : null}
              <div className="chat-dock-main__identity">
                {renderAvatarTrigger(
                  selectedDirectConversation?.directUser || { avatar: selectedDirectConversation?.avatar || DEFAULT_GROUP_AVATAR_KEY, username: selectedDirectConversation?.title },
                  44
                )}
                <div>
                  <div className="chat-dock-main__title">{selectedDirectConversation?.title || '会话'}</div>
                  <div className="chat-dock-main__subtitle">
                    {renderUserMetaText(selectedDirectConversation?.directUser) || '会话消息'}
                    {selectedDirectConversation?.clearedBeforeSeq > 0 ? ' · 旧记录已按你的删除边界隐藏' : ''}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={conversationActionId === `hide:${selectedDirectConversation?.conversationId}`}
                onClick={() => onDeleteConversation(selectedDirectConversation)}
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

        {selectedDirectConversation ? (
          <>
            {selectedDirectConversation?.directUser && selectedConversationFriendStatus !== 'friend' ? (
              <div className="chat-dock-relationship-banner">
                <div className="chat-dock-relationship-banner__text">
                  {selectedConversationFriendStatus === 'blocked'
                    ? selectedConversationBlockedByCurrentUser
                      ? `你已将 ${selectedDirectConversation?.title || '对方'} 加入黑名单。若要继续发送消息或申请好友，需要先解除拉黑。`
                      : `${selectedDirectConversation?.title || '对方'} 已将你加入黑名单，当前无法发送好友申请或临时消息。`
                    : selectedConversationFriendStatus === 'pending_sent'
                    ? `你已经向 ${selectedDirectConversation?.title || '对方'} 发送了好友申请，当前仍可继续聊天。`
                    : selectedConversationFriendStatus === 'pending_received'
                      ? `${selectedDirectConversation?.title || '对方'} 已向你发送好友申请，当前仍可继续聊天。`
                      : `你和 ${selectedDirectConversation?.title || '对方'} 还不是好友，当前仍可直接聊天。`}
                </div>
                <div className="chat-dock-relationship-banner__actions">
                  {selectedConversationFriendStatus === 'blocked' ? (
                    selectedConversationBlockedByCurrentUser ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={friendActionId === `unblock:${selectedDirectConversation?.directUser?._id}`}
                        onClick={() => handleOpenFriendRequestComposer(selectedDirectConversation?.directUser)}
                      >
                        {friendActionId === `unblock:${selectedDirectConversation?.directUser?._id}` ? '处理中...' : '解除拉黑并加好友'}
                      </button>
                    ) : (
                      <span className="chat-user-card__tag">对方已拉黑你</span>
                    )
                  ) : selectedConversationFriendStatus === 'pending_received' ? (
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
                      disabled={friendActionId === `request:${selectedDirectConversation?.directUser?._id}`}
                      onClick={() => handleOpenFriendRequestComposer(selectedDirectConversation?.directUser)}
                    >
                      {friendActionId === `request:${selectedDirectConversation?.directUser?._id}` ? '发送中...' : '加好友'}
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
                rememberConversationScrollPosition(selectedDirectConversation?.conversationId, viewport.scrollTop);
                const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
                if (distanceToBottom <= 64) {
                  setShowNewMessageHint(false);
                }
              }}
            >
              <div
                className={`chat-dock-pull-refresh${(pullRefreshDistance > 0 || isPullRefreshing) ? ' is-visible' : ''}${pullRefreshDistance >= PULL_REFRESH_TRIGGER_DISTANCE ? ' is-armed' : ''}${isPullRefreshing ? ' is-refreshing' : ''}`}
                style={{ '--chat-pull-distance': `${pullRefreshDistance}px` }}
              >
                {isPullRefreshing ? <Loader2 size={14} className="chat-spin" /> : <ChevronLeft size={14} className="chat-dock-pull-refresh__icon" />}
                <span>
                  {isPullRefreshing
                    ? '刷新当前会话中...'
                    : pullRefreshDistance >= PULL_REFRESH_TRIGGER_DISTANCE
                      ? '松手刷新当前会话'
                      : '下拉刷新当前会话'}
                </span>
              </div>

              {selectedMessagesEntry?.nextBeforeSeq > 0 ? (
                <button
                  type="button"
                  className="chat-dock-load-more"
                  disabled={selectedMessagesEntry?.loading}
                  onClick={() => loadOlderMessages(selectedDirectConversation.conversationId)}
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
              ) : selectedMessages.map((item) => renderMessageRow(item))}
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
                ref={composerTextareaRef}
                value={draftMessage}
                onChange={(event) => {
                  setDraftMessage(event.target.value);
                  syncComposerSelection(event.target);
                }}
                onClick={(event) => syncComposerSelection(event.target)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmitMessage();
                  }
                }}
                onKeyUp={(event) => syncComposerSelection(event.target)}
                onSelect={(event) => syncComposerSelection(event.target)}
                disabled={selectedConversationFriendStatus === 'blocked' && !selectedConversationBlockedByCurrentUser}
                placeholder={selectedConversationFriendStatus === 'blocked'
                  ? selectedConversationBlockedByCurrentUser
                    ? '发送时会先提示你解除拉黑'
                    : '对方已将你拉黑，无法发送临时消息'
                  : '输入消息，Enter 发送，Shift + Enter 换行'}
              />
              <div className="chat-dock-composer-actions">
                <button
                  type="button"
                  className="chat-dock-action-btn chat-dock-action-btn--ghost"
                  title="展开输入"
                  aria-label="展开输入"
                  onClick={openExpandedComposer}
                >
                  <Maximize2 size={16} />
                </button>
                <button
                  type="button"
                  className="btn btn-primary chat-dock-action-btn chat-dock-action-btn--send"
                  disabled={
                    (selectedConversationFriendStatus === 'blocked' && !selectedConversationBlockedByCurrentUser)
                    || conversationActionId === `send:${selectedDirectConversation?.conversationId}`
                    || !draftMessage.trim()
                  }
                  onClick={() => {
                    void handleSubmitMessage();
                  }}
                >
                  {conversationActionId === `send:${selectedDirectConversation?.conversationId}` ? <Loader2 size={15} className="chat-spin" /> : <Send size={15} />}
                  <span className="chat-dock-action-btn__label">发送</span>
                </button>
              </div>
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
              const isBlocked = item?.friendStatus === 'blocked';
              const isBlockedByCurrentUser = isUserBlockedByCurrentUser(item?._id);
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
                  ) : isBlocked ? (
                    isBlockedByCurrentUser ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={friendActionId === `unblock:${item?._id}`}
                        onClick={() => handleOpenFriendRequestComposer(item)}
                      >
                        {friendActionId === `unblock:${item?._id}` ? '处理中...' : '解除拉黑并加好友'}
                      </button>
                    ) : (
                      <span className="chat-dock-chip chat-dock-chip--danger">对方已拉黑你</span>
                    )
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
                      onClick={() => handleOpenFriendRequestComposer(item)}
                    >
                      {friendActionId === actionKey ? '发送中...' : '加好友'}
                    </button>
                  )}
                  {!isFriend && !isBlocked ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      disabled={friendActionId === `block:${item?._id}`}
                      onClick={() => handleBlockTarget({
                        targetUserId: item?._id,
                        username: item?.username || '该用户'
                      })}
                    >
                      {friendActionId === `block:${item?._id}` ? '处理中...' : '拉黑'}
                    </button>
                  ) : null}
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
              <div className="chat-dock-inline-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={conversationActionId === `open:${item?.user?._id}`}
                  onClick={() => onOpenDirectConversation(item?.user?._id)}
                >
                  {conversationActionId === `open:${item?.user?._id}` ? '打开中...' : '发消息'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={friendActionId === `remove:${item?.friendshipId}`}
                  onClick={() => handleRemoveFriend(item)}
                >
                  {friendActionId === `remove:${item?.friendshipId}` ? '处理中...' : '删除好友'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={friendActionId === `block:${item?.user?._id || item?.friendshipId}`}
                  onClick={() => handleBlockTarget({
                    targetUserId: item?.user?._id,
                    friendshipId: item?.friendshipId,
                    username: item?.user?.username || '该好友'
                  })}
                >
                  {friendActionId === `block:${item?.user?._id || item?.friendshipId}` ? '处理中...' : '拉黑'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="chat-dock-subsection">
          <div className="chat-dock-list__header">
            <span>黑名单</span>
            {friendListLoading ? <Loader2 size={14} className="chat-spin" /> : <span>{blockedRows.length}</span>}
          </div>
          {blockedRows.length === 0 ? (
            <div className="chat-dock-empty">当前黑名单为空。</div>
          ) : blockedRows.map((item) => {
            const actionKey = `unblock:${item?.user?._id || ''}`;
            return (
              <div key={item?.friendshipId} className="chat-dock-user-row is-blocked">
                {renderAvatarTrigger(item?.user, 38)}
                <div className="chat-dock-user-row__content">
                  <div className="chat-dock-user-row__title">{item?.user?.username || '未命名用户'}</div>
                  <div className="chat-dock-user-row__meta">{renderUserMetaText(item?.user) || '已加入黑名单'}</div>
                  <div className="chat-dock-user-row__hint">不会再收到其好友申请与临时消息</div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={friendActionId === actionKey}
                  onClick={() => onUnblockUser(item?.user?._id)}
                >
                  {friendActionId === actionKey ? '处理中...' : '解除拉黑'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderGroupCreatePane = () => (
    <div className="chat-dock-modal-layer" onClick={handleCloseCreateGroupPane}>
      <div
        className="chat-dock-modal"
        role="dialog"
        aria-modal="true"
        aria-label="创建群聊"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="chat-dock-modal__header">
          <div>
            <div className="chat-dock-panel__eyebrow">Group Chat</div>
            <div className="chat-dock-modal__title">创建群聊</div>
            <div className="chat-dock-modal__subtitle">创建后会生成唯一群ID。</div>
          </div>
          <button
            type="button"
            className="chat-dock-close-btn"
            onClick={handleCloseCreateGroupPane}
            title="关闭创建群聊弹窗"
          >
            <X size={16} />
          </button>
        </div>
        <div className="chat-dock-modal__body">
          <div className="chat-dock-group-form">
            <div className="chat-dock-field">
              <span>群头像</span>
              {renderGroupAvatarTrigger({
                value: newGroupAvatar,
                helperText: '会显示在群列表、聊天页和群资料中',
                onClick: () => openGroupAvatarModal('create')
              })}
            </div>
            <label className="chat-dock-field">
              <span>群名称</span>
              <input
                type="text"
                value={newGroupTitle}
                onChange={(event) => {
                  setNewGroupTitle(event.target.value);
                  if (newGroupTitleError && event.target.value.trim()) {
                    setNewGroupTitleError('');
                  }
                }}
                placeholder="输入群聊名称"
                aria-invalid={newGroupTitleError ? 'true' : 'false'}
                className={newGroupTitleError ? 'is-invalid' : ''}
              />
              {newGroupTitleError ? <span className="chat-dock-field__error">{newGroupTitleError}</span> : null}
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

          <div className="chat-dock-group-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCloseCreateGroupPane}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={groupActionId === 'create-group'}
              onClick={handleCreateGroup}
            >
              {groupActionId === 'create-group' ? <Loader2 size={15} className="chat-spin" /> : <Plus size={15} />}
              创建群聊
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderGroupSettingsContent = () => {
    if (!selectedGroup) return null;

    return (
      <div className="chat-dock-group-settings">
        <div className="chat-dock-group-summary-card">
          <div className="chat-dock-group-summary-card__hero">
            <UserAvatar user={{ avatar: selectedGroupAvatar, username: selectedGroupTitle }} size={56} />
            <div>
              <div className="chat-dock-group-summary-card__title">{selectedGroupTitle || '未命名群聊'}</div>
              <div className="chat-dock-group-summary-card__meta">
                {selectedGroupAnnouncementText || '当前没有群公告。'}
              </div>
            </div>
          </div>
          <div className="chat-dock-group-detail-grid">
            {renderGroupDetailField({
              label: '群名称',
              value: selectedGroupTitle,
              emptyText: '未命名'
            })}
            {renderGroupDetailField({
              label: '群ID',
              value: selectedGroupNo,
              copyValue: selectedGroupNo,
              emptyText: '未分配'
            })}
            {renderGroupDetailField({
              label: '群人数',
              value: `${selectedGroupMemberCount} 人`
            })}
            {renderGroupDetailField({
              label: '创建时间',
              value: formatExactDateTime(selectedGroupCreatedAt),
              emptyText: '未知'
            })}
            {renderGroupDetailField({
              label: '最近活跃',
              value: formatExactDateTime(selectedGroupLastActiveAt),
              emptyText: '暂无'
            })}
          </div>
        </div>

        <div className="chat-dock-group-quick-actions">
          {selectedGroup.canManage ? (
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => {
                handleCloseGroupSettings();
                openGroupInviteModal('outbound');
              }}
            >
              <UserPlus size={14} />
              邀请成员
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={handleShareGroupNo}
          >
            <Share2 size={14} />
            分享群
          </button>
        </div>

        {selectedGroup.canManage ? (
          <div className="chat-dock-group-form">
            <div className="chat-dock-list__header">
              <span>群设置</span>
            </div>
            <div className="chat-dock-field">
              <span>群头像</span>
              {renderGroupAvatarTrigger({
                value: groupAvatarDraft,
                helperText: '在弹窗里选择群头像',
                onClick: () => openGroupAvatarModal('settings')
              })}
            </div>
            <label className="chat-dock-field">
              <span>群名称</span>
              <input
                type="text"
                value={groupTitleDraft}
                onChange={(event) => setGroupTitleDraft(event.target.value)}
                placeholder="输入群聊名称"
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
        ) : null}

        <div className="chat-dock-subsection">
          <div className="chat-dock-list__header">
            <span>群聊操作</span>
            <span>{isSelectedGroupOwner ? '解散' : '退出'}</span>
          </div>
          <div className="chat-dock-group-quick-actions">
            {isSelectedGroupOwner ? (
              <button
                type="button"
                className="btn btn-danger btn-small"
                disabled={groupActionId === `group-disband:${selectedGroup.conversationId}`}
                onClick={handleDisbandGroup}
              >
                {groupActionId === `group-disband:${selectedGroup.conversationId}` ? <Loader2 size={14} className="chat-spin" /> : <Trash2 size={14} />}
                解散群聊
              </button>
            ) : selectedGroup.canLeave ? (
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
                const isSelf = String(item?.userId || '') === String(currentUserId || '');
                const removeActionKey = `group-remove:${selectedGroup.conversationId}:${item?.userId}`;
                const transferActionKey = `group-transfer:${selectedGroup.conversationId}:${item?.userId}`;
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
                      <div className="chat-dock-user-row__hint">
                        {item?.joinedAt ? `加入于 ${formatRelativeDateTime(item.joinedAt)}` : '加入时间未知'}
                      </div>
                    </div>
                    <div className="chat-dock-inline-actions">
                      {!isSelf ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          disabled={conversationActionId === `open:${item?.userId}`}
                          onClick={() => onOpenDirectConversation(item?.userId)}
                        >
                          {conversationActionId === `open:${item?.userId}` ? '打开中...' : '发私聊'}
                        </button>
                      ) : null}
                      {selectedGroup.canManage && !isOwner ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={groupActionId === transferActionKey}
                            onClick={() => openConfirmDialog({
                              title: '确认转让群主',
                              message: `确认把群主转让给「${memberUser?.username || '该成员'}」吗？`,
                              confirmText: '确认转让',
                              confirmTone: 'warning',
                              onConfirm: async () => {
                                await onTransferGroupOwnership({
                                  conversationId: selectedGroup.conversationId,
                                  targetUserId: item?.userId
                                });
                              }
                            })}
                          >
                            {groupActionId === transferActionKey ? '转让中...' : '转让群主'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={groupActionId === removeActionKey}
                            onClick={() => openConfirmDialog({
                              title: '确认移出成员',
                              message: `确认移出成员「${memberUser?.username || '该成员'}」吗？`,
                              confirmText: '确认移出',
                              confirmTone: 'danger',
                              onConfirm: async () => {
                                await onRemoveGroupMember({
                                  conversationId: selectedGroup.conversationId,
                                  targetUserId: item?.userId
                                });
                              }
                            })}
                          >
                            {groupActionId === removeActionKey ? '移出中...' : '移出'}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderGroupNoticeModal = () => {
    if (!isGroupNoticeModalOpen || !selectedGroup) return null;

    return (
      <div className="chat-dock-modal-layer chat-dock-modal-layer--panel" onClick={closeGroupNoticeModal}>
        <div
          className="chat-dock-modal chat-dock-modal--panel"
          role="dialog"
          aria-modal="true"
          aria-label="群公告"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="chat-dock-modal__header">
            <div>
              <div className="chat-dock-modal__title">群公告</div>
              <div className="chat-dock-modal__subtitle">{selectedGroupTitle || '未命名群聊'}</div>
            </div>
            <button
              type="button"
              className="chat-dock-close-btn"
              onClick={closeGroupNoticeModal}
              title="关闭群公告弹窗"
            >
              <X size={16} />
            </button>
          </div>
          <div className="chat-dock-modal__body">
            <div className="chat-dock-group-search-card">
              <div className="chat-dock-group-search-card__title">{selectedGroupTitle || '未命名群聊'}</div>
              <div className="chat-dock-group-search-card__meta">{`${selectedGroupNoticeHistory.length} 条公告`}</div>
              <div className="chat-dock-group-search-card__text">{selectedGroupAnnouncementText || '当前没有群公告。'}</div>
            </div>

            {selectedGroup.canManage ? (
              <div className="chat-dock-subsection">
                <div className="chat-dock-list__header">
                  <span>发布公告</span>
                </div>
                <label className="chat-dock-field">
                  <textarea
                    value={groupNoticeDraft}
                    onChange={(event) => setGroupNoticeDraft(event.target.value)}
                    placeholder="输入新的群公告"
                  />
                </label>
                <div className="chat-dock-group-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!groupNoticeDraft.trim() || groupActionId === `group-notice-create:${selectedGroupConversationId}`}
                    onClick={handleCreateGroupNotice}
                  >
                    {groupActionId === `group-notice-create:${selectedGroupConversationId}` ? <Loader2 size={15} className="chat-spin" /> : <Plus size={15} />}
                    发布公告
                  </button>
                </div>
              </div>
            ) : null}

            <div className="chat-dock-subsection">
              <div className="chat-dock-list__header">
                <span>公告列表</span>
                <span>{selectedGroupNoticeHistory.length}</span>
              </div>
              {selectedGroupNoticeHistory.length === 0 ? (
                <div className="chat-dock-empty">暂无群公告。</div>
              ) : (
                <div className="chat-dock-group-notice-list">
                  {selectedGroupNoticeHistory.map((item, index) => {
                    const metaParts = [];
                    if (item?.createdBy?.username) {
                      metaParts.push(item.createdBy.username);
                    }
                    if (item?.createdAt) {
                      metaParts.push(formatRelativeDateTime(item.createdAt));
                    }
                    return (
                      <div
                        key={item?.noticeId || `${item?.createdAt || 'notice'}:${index}`}
                        className="chat-dock-group-notice-item"
                      >
                        <div className="chat-dock-group-notice-item__main">
                          <div className="chat-dock-group-notice-item__content">{item?.content || ''}</div>
                          <div className="chat-dock-group-notice-item__meta">{metaParts.join(' · ') || '群公告'}</div>
                        </div>
                        {selectedGroup.canManage && normalizeConversationId(item?.noticeId) ? (
                          <button
                            type="button"
                            className="chat-dock-icon-btn"
                            title="删除群公告"
                            disabled={groupActionId === `group-notice-delete:${selectedGroupConversationId}:${item.noticeId}`}
                            onClick={() => handleDeleteGroupNotice(item)}
                          >
                            {groupActionId === `group-notice-delete:${selectedGroupConversationId}:${item.noticeId}` ? <Loader2 size={14} className="chat-spin" /> : <Trash2 size={14} />}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderGroupAvatarModal = () => {
    if (!isGroupAvatarModalOpen) return null;

    const isCreateAvatarMode = groupAvatarModalMode === 'create';
    const avatarValue = isCreateAvatarMode ? newGroupAvatar : groupAvatarDraft;
    const setAvatarValue = isCreateAvatarMode ? setNewGroupAvatar : setGroupAvatarDraft;
    const selectedAvatarOption = resolveGroupAvatarOption(avatarValue);

    return (
      <div className="chat-dock-modal-layer chat-dock-modal-layer--centered" onClick={closeGroupAvatarModal}>
        <div
          className="chat-dock-modal chat-dock-modal--avatar-picker"
          role="dialog"
          aria-modal="true"
          aria-label={isCreateAvatarMode ? '选择群头像' : '更换群头像'}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="chat-dock-modal__header">
              <div>
                <div className="chat-dock-modal__title">{isCreateAvatarMode ? '选择群头像' : '更换群头像'}</div>
                <div className="chat-dock-modal__subtitle">头像会同步显示在群列表、聊天页、群资料和分享卡片里。</div>
              </div>
            <button
              type="button"
              className="chat-dock-close-btn"
              onClick={closeGroupAvatarModal}
              title="关闭群头像弹窗"
            >
              <X size={16} />
            </button>
          </div>
          <div className="chat-dock-modal__body">
            <div className="chat-dock-group-avatar-modal-preview">
              <img
                src={selectedAvatarOption.src}
                alt={selectedAvatarOption.label}
                className="chat-dock-group-avatar-modal-preview__image"
              />
              <div className="chat-dock-group-avatar-modal-preview__content">
                <div className="chat-dock-group-avatar-modal-preview__title">{selectedAvatarOption.label}</div>
                <div className="chat-dock-group-avatar-modal-preview__meta">
                  {isCreateAvatarMode ? '创建群聊时一起提交' : '保存群设置后生效'}
                </div>
              </div>
            </div>
            {renderGroupAvatarPicker(avatarValue, setAvatarValue)}
            <div className="chat-dock-group-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={closeGroupAvatarModal}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderConfirmDialog = () => {
    if (!confirmDialogState.open) return null;

    const confirmButtonClassName = confirmDialogState.confirmTone === 'primary'
      ? 'btn btn-primary'
      : confirmDialogState.confirmTone === 'warning'
        ? 'btn btn-warning'
        : 'btn btn-danger';

    return (
      <div
        className="chat-dock-modal-layer chat-dock-modal-layer--centered chat-dock-modal-layer--confirm"
        onClick={closeConfirmDialog}
      >
        <div
          className="chat-dock-modal chat-dock-modal--compact chat-dock-modal--confirm"
          role="dialog"
          aria-modal="true"
          aria-label={confirmDialogState.title || '请确认'}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="chat-dock-modal__header">
            <div>
              <div className="chat-dock-panel__eyebrow">Confirm</div>
              <div className="chat-dock-modal__title">{confirmDialogState.title || '请确认'}</div>
            </div>
            <button
              type="button"
              className="chat-dock-close-btn"
              onClick={closeConfirmDialog}
              title="关闭确认弹窗"
              disabled={confirmDialogState.busy}
            >
              <X size={16} />
            </button>
          </div>
          <div className="chat-dock-modal__body">
            <div className="chat-dock-confirm-message">{confirmDialogState.message || '确认继续当前操作吗？'}</div>
            <div className="chat-dock-confirm-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeConfirmDialog}
                disabled={confirmDialogState.busy}
              >
                取消
              </button>
              <button
                type="button"
                className={confirmButtonClassName}
                onClick={() => {
                  void handleConfirmDialog();
                }}
                disabled={confirmDialogState.busy}
              >
                {confirmDialogState.busy ? '处理中...' : confirmDialogState.confirmText || '确认'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderGroupChatPane = () => {
    if (groupDetailLoading && !selectedGroup) {
      return (
        <div className="chat-dock-main">
          <div className="chat-dock-empty-state">
            <div className="chat-dock-empty-state__icon">
              <Loader2 size={28} className="chat-spin" />
            </div>
            <div className="chat-dock-empty-state__title">群聊加载中</div>
          </div>
        </div>
      );
    }

    if (!selectedGroup || !selectedGroupConversationEntry) {
      return (
        <div className="chat-dock-main">
          <div className="chat-dock-empty-state">
            <div className="chat-dock-empty-state__icon">
              <Users size={28} />
            </div>
            <div className="chat-dock-empty-state__title">选择一个群聊</div>
            <div className="chat-dock-empty-state__text">点开左侧群列表会直接进入聊天窗口；群设置收在右侧，可按需展开。</div>
          </div>
        </div>
      );
    }

    return (
      <div className={`chat-dock-main chat-dock-main--group-chat${isGroupSettingsOpen && !isMobileLayout ? ' has-settings-open' : ''}`}>
        <div className="chat-dock-main__header chat-dock-main__header--group">
          {isMobileLayout ? (
            <button
              type="button"
              className="chat-dock-mobile-back"
              onClick={handleBackToGroupList}
              aria-label="返回群聊列表"
            >
              <ChevronLeft size={16} />
            </button>
          ) : null}
          <div className="chat-dock-main__identity chat-dock-main__identity--group">
            <UserAvatar user={{ avatar: selectedGroupAvatar, username: selectedGroupTitle }} size={42} />
            <div>
              <div className="chat-dock-main__title">{selectedGroupTitle || '未命名群聊'}</div>
              <div className="chat-dock-main__subtitle">
                {`${selectedGroupMemberCount} 人`}
              </div>
            </div>
          </div>
          <div className="chat-dock-group-head-actions">
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={openGroupNoticeModal}
            >
              <Info size={14} />
              群公告
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={handleShareGroupNo}
            >
              <Share2 size={14} />
              分享群
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => {
                if (isGroupSettingsOpen) {
                  handleCloseGroupSettings();
                  return;
                }
                setIsGroupSettingsOpen(true);
              }}
            >
              <Info size={14} />
              {isGroupSettingsOpen ? '收起设置' : '群设置'}
            </button>
          </div>
        </div>

        <div className="chat-dock-group-workspace">
          <div className="chat-dock-group-thread">
            <div
              ref={messagesViewportRef}
              className="chat-dock-messages"
              onScroll={(event) => {
                const viewport = event.currentTarget;
                rememberConversationScrollPosition(selectedGroupConversationId, viewport.scrollTop);
                const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
                if (distanceToBottom <= 64) {
                  setShowNewMessageHint(false);
                }
              }}
            >
              <div
                className={`chat-dock-pull-refresh${(pullRefreshDistance > 0 || isPullRefreshing) ? ' is-visible' : ''}${pullRefreshDistance >= PULL_REFRESH_TRIGGER_DISTANCE ? ' is-armed' : ''}${isPullRefreshing ? ' is-refreshing' : ''}`}
                style={{ '--chat-pull-distance': `${pullRefreshDistance}px` }}
              >
                {isPullRefreshing ? <Loader2 size={14} className="chat-spin" /> : <ChevronLeft size={14} className="chat-dock-pull-refresh__icon" />}
                <span>
                  {isPullRefreshing
                    ? '刷新当前群聊中...'
                    : pullRefreshDistance >= PULL_REFRESH_TRIGGER_DISTANCE
                      ? '松手刷新当前群聊'
                      : '下拉刷新当前群聊'}
                </span>
              </div>

              {selectedGroupMessagesEntry?.nextBeforeSeq > 0 ? (
                <button
                  type="button"
                  className="chat-dock-load-more"
                  disabled={selectedGroupMessagesEntry?.loading}
                  onClick={() => loadOlderMessages(selectedGroupConversationId)}
                >
                  {selectedGroupMessagesEntry?.loading ? '加载中...' : '加载更早消息'}
                </button>
              ) : null}

              {selectedGroupMessagesEntry?.error ? (
                <div className="chat-dock-empty is-error">{selectedGroupMessagesEntry.error}</div>
              ) : null}

              {selectedGroupMessagesEntry?.loading && !selectedGroupMessagesEntry?.initialized ? (
                <div className="chat-dock-empty">聊天记录加载中...</div>
              ) : null}

              {selectedGroupMessages.length === 0 && !selectedGroupMessagesEntry?.loading ? (
                selectedGroupMembers.length <= 1 ? (
                  <div className="chat-dock-empty-state chat-dock-empty-state--group-solo">
                    <div className="chat-dock-empty-state__icon">
                      <Users size={28} />
                    </div>
                    <div className="chat-dock-empty-state__title">先把成员加进来</div>
                    <div className="chat-dock-empty-state__text">
                      当前群里只有你自己。你可以直接邀请好友，或者发送群聊邀请卡给好友与其他群聊；对方也可以通过群ID搜索加入。
                    </div>
                    <div className="chat-dock-empty-state__actions">
                      {selectedGroup.canManage ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          onClick={() => {
                            handleCloseGroupSettings();
                            openGroupInviteModal('outbound');
                          }}
                        >
                          <UserPlus size={14} />
                          邀请好友
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={handleShareGroupNo}
                      >
                        <Share2 size={14} />
                        分享群
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="chat-dock-empty">当前没有可见消息，发一条消息开始群聊。</div>
                )
              ) : selectedGroupMessages.map((item) => renderMessageRow(item, {
                showSenderName: selectedGroupMembers.length > 2
              }))}
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
                ref={composerTextareaRef}
                value={draftMessage}
                onChange={(event) => {
                  setDraftMessage(event.target.value);
                  syncComposerSelection(event.target);
                }}
                onClick={(event) => syncComposerSelection(event.target)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmitMessage();
                  }
                }}
                onKeyUp={(event) => syncComposerSelection(event.target)}
                onSelect={(event) => syncComposerSelection(event.target)}
                placeholder="输入群消息，Enter 发送，Shift + Enter 换行"
              />
              <div className="chat-dock-composer-actions">
                <button
                  type="button"
                  className="chat-dock-action-btn chat-dock-action-btn--ghost"
                  title="展开输入"
                  aria-label="展开输入"
                  onClick={openExpandedComposer}
                >
                  <Maximize2 size={16} />
                </button>
                <button
                  type="button"
                  className="btn btn-primary chat-dock-action-btn chat-dock-action-btn--send"
                  disabled={
                    conversationActionId === `send:${selectedGroupConversationId}`
                    || !draftMessage.trim()
                  }
                  onClick={() => {
                    void handleSubmitMessage();
                  }}
                >
                  {conversationActionId === `send:${selectedGroupConversationId}` ? <Loader2 size={15} className="chat-spin" /> : <Send size={15} />}
                  <span className="chat-dock-action-btn__label">发送</span>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    );
  };

  const renderGroupSettingsModal = () => {
    if (!isGroupSettingsOpen || !selectedGroup) return null;

    return (
      <div className="chat-dock-modal-layer chat-dock-modal-layer--panel" onClick={handleCloseGroupSettings}>
        <div
          className="chat-dock-modal chat-dock-modal--panel"
          role="dialog"
          aria-modal="true"
          aria-label="群设置"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="chat-dock-modal__header">
            <div>
              <div className="chat-dock-modal__title">群设置</div>
              <div className="chat-dock-modal__subtitle">{selectedGroupTitle || '未命名群聊'}</div>
            </div>
            <button
              type="button"
              className="chat-dock-close-btn"
              onClick={handleCloseGroupSettings}
              title="关闭群设置弹窗"
            >
              <X size={16} />
            </button>
          </div>
          <div className="chat-dock-modal__body chat-dock-modal__body--panel">
            {renderGroupSettingsContent()}
          </div>
        </div>
      </div>
    );
  };

  const renderGroupsPane = () => (
    <>
      <div className="chat-dock-sidebar">
        <div className="chat-dock-list">
          {receivedGroupInvites.length > 0 ? (
            <button
              type="button"
              className="chat-dock-request-entry has-pending"
              onClick={() => openGroupInviteModal('received')}
            >
              <span className="chat-dock-request-entry__main">
                <span className="chat-dock-request-entry__icon">
                  <UserPlus size={16} />
                </span>
                <span className="chat-dock-request-entry__content">
                  <span className="chat-dock-request-entry__title">群聊邀请</span>
                  <span className="chat-dock-request-entry__meta">
                    {`有 ${receivedGroupInvites.length} 条待处理群聊邀请`}
                  </span>
                </span>
              </span>
              <span className="chat-dock-request-entry__side">
                <span className="chat-dock-unread-badge">
                  {receivedGroupInvites.length > 99 ? '99+' : receivedGroupInvites.length}
                </span>
              </span>
            </button>
          ) : null}

          <form
            className="chat-dock-search-box"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSearchGroupConversation();
            }}
          >
            <div className="chat-dock-search-input">
              <Search size={14} />
              <input
                type="text"
                value={groupSearchQuery}
                inputMode="numeric"
                onChange={(event) => {
                  const nextValue = event.target.value.replace(/[^\d]/g, '');
                  setGroupSearchQuery(nextValue);
                  if (!nextValue.trim()) {
                    void onSearchGroupConversation('');
                  }
                }}
                placeholder="输入群ID搜索并加入群聊"
              />
            </div>
            <button type="submit" className="btn btn-secondary btn-small" disabled={groupSearchLoading}>
              {groupSearchLoading ? '搜索中...' : '搜索'}
            </button>
          </form>

          {(groupSearchAttempted || groupSearchQuery.trim()) ? (
            <div className="chat-dock-subsection">
              <div className="chat-dock-list__header">
                <span>群ID搜索</span>
                <span>可直接加入或打开</span>
              </div>
              {!groupSearchResult && !groupSearchLoading ? (
                <div className="chat-dock-empty">未找到对应群ID，请检查后重试。</div>
              ) : groupSearchResult ? (
                <div className="chat-dock-group-search-card">
                  <div className="chat-dock-group-search-card__main">
                    <div className="chat-dock-group-search-card__title">
                      {groupSearchResult?.title || '未命名群聊'}
                    </div>
                    <div className="chat-dock-group-search-card__meta">
                      {`${groupSearchResult?.memberCount || 0} 人`}
                      {groupSearchResult?.owner?.username ? ` · 群主 ${groupSearchResult.owner.username}` : ''}
                    </div>
                    <div className="chat-dock-group-search-card__text">
                      {groupSearchResult?.announcement || '当前没有群公告。'}
                    </div>
                  </div>
                  <div className="chat-dock-group-search-card__actions">
                    {groupSearchResult?.membershipStatus === 'owner' || groupSearchResult?.membershipStatus === 'creator' ? (
                      <span className="chat-dock-chip">你创建的群</span>
                    ) : groupSearchResult?.membershipStatus === 'joined' ? (
                      <span className="chat-dock-chip">已加入</span>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={groupActionId === `group-join:${groupSearchResult?.conversationId || groupSearchResult?.groupNo || ''}`}
                      onClick={() => {
                        if (groupSearchResult?.membershipStatus === 'joined' || groupSearchResult?.membershipStatus === 'owner' || groupSearchResult?.membershipStatus === 'creator') {
                          void handleOpenGroupDetail(groupSearchResult?.conversationId);
                          return;
                        }
                        void handleJoinGroupFromSearch(groupSearchResult);
                      }}
                    >
                      {groupActionId === `group-join:${groupSearchResult?.conversationId || groupSearchResult?.groupNo || ''}`
                        ? '处理中...'
                        : groupSearchResult?.membershipStatus === 'joined' || groupSearchResult?.membershipStatus === 'owner' || groupSearchResult?.membershipStatus === 'creator'
                          ? '打开群聊'
                          : '加入群聊'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="chat-dock-list__header">
            <span>我的群聊</span>
            <button
              type="button"
              className="chat-dock-inline-link"
              onClick={() => {
                setNewGroupTitle('');
                setNewGroupTitleError('');
                setNewGroupAnnouncement('');
                setNewGroupAvatar(DEFAULT_GROUP_AVATAR_KEY);
                setIsCreateGroupMode(true);
              }}
            >
              <Plus size={14} />
              创建群聊
            </button>
          </div>
          {groups.length === 0 ? (
            <div className="chat-dock-empty">当前没有群聊。先创建一个，或通过上方群ID搜索加入其他人的群。</div>
          ) : groups.map((item) => {
            const isActive = item?.conversationId === selectedGroupId;
            return (
              <button
                key={item?.conversationId}
                type="button"
                className={`chat-dock-list-item${isActive ? ' is-active' : ''}`}
                onClick={() => handleOpenGroupDetail(item?.conversationId)}
              >
                <UserAvatar user={{ avatar: item?.avatar || DEFAULT_GROUP_AVATAR_KEY, username: item?.title }} size={42} />
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
                  <span className="chat-dock-list-item__actions">
                    <span
                      className={`chat-dock-icon-btn${item?.pinned ? ' is-active' : ''}`}
                      role="button"
                      tabIndex={0}
                      title={item?.pinned ? '取消置顶' : '置顶会话'}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleToggleConversationPinned(item);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          void handleToggleConversationPinned(item);
                        }
                      }}
                    >
                      {conversationActionId === `pin:${item?.conversationId}` ? <Loader2 size={15} className="chat-spin" /> : <Pin size={14} />}
                    </span>
                  </span>
                  {Number(item?.unreadCount) > 0 ? (
                    <span className="chat-dock-unread-badge">
                      {Number(item.unreadCount) > 99 ? '99+' : Number(item.unreadCount)}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {renderGroupChatPane()}
      {renderGroupSettingsModal()}
      {isCreateGroupMode ? renderGroupCreatePane() : null}
      {renderGroupNoticeModal()}
      {renderGroupAvatarModal()}
      {renderConfirmDialog()}
    </>
  );

  return (
    <div className={`chat-dock-panel${isMobileLayout ? ' is-mobile-layout' : ''}`}>
      <div className="chat-dock-panel__header">
        <div>
          <h3>社交与会话</h3>
        </div>
        <button type="button" className="chat-dock-close-btn" onClick={onClose} title="收起聊天面板">
          <X size={16} />
        </button>
      </div>

      {panelNotice ? <div className="chat-dock-notice">{panelNotice}</div> : null}
      {centerToastMessage ? <div className="chat-dock-center-toast">{centerToastMessage}</div> : null}

      <div className="chat-dock-tabs chat-dock-tabs--top">
        <SidebarTabButton
          active={isConversationTab}
          icon={MessagesSquare}
          label="会话"
          badge={conversationTabBadge}
          badgeTone={unreadConversationCount > 0 ? 'alert' : 'default'}
          onClick={() => setActiveSidebarTab('conversations')}
        />
        <SidebarTabButton
          active={isGroupsTab}
          icon={UserPlus}
          label="群聊"
          badge={unreadGroupCount + receivedGroupInvites.length > 0
            ? String(unreadGroupCount + receivedGroupInvites.length > 99 ? '99+' : unreadGroupCount + receivedGroupInvites.length)
            : ''}
          onClick={() => setActiveSidebarTab('groups')}
        />
        <SidebarTabButton
          active={isFriendsTab}
          icon={Users}
          label="好友"
          badge={friendsTabBadge}
          badgeTone={receivedRequests.length > 0 ? 'alert' : 'default'}
          onClick={() => setActiveSidebarTab('friends')}
        />
      </div>

      <div className={`chat-dock-body${isConversationTab ? ' is-conversations' : isGroupsTab ? ' is-groups' : ' is-friends'}${isMobileLayout ? ' is-mobile-shell' : ''}${isMobileLayout && selectedDirectConversation?.conversationId ? ' has-conversation-detail' : ''}${isMobileLayout && selectedGroupId ? ' has-group-detail' : ''}`}>
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
                  const ignoreKey = `${item?.friendshipId}:ignore`;
                  const blockKey = `block:${item?.user?._id || item?.friendshipId || ''}`;
                  const responding = [acceptKey, rejectKey, ignoreKey].includes(requestActionId);
                  return (
                    <div key={item?.friendshipId} className="chat-dock-request-card">
                      <div className="chat-dock-request-card__topline">
                        {renderAvatarTrigger(item?.user, 38)}
                        <div className="chat-dock-request-card__content">
                          <div className="chat-dock-user-row__title">{item?.user?.username || '未命名用户'}</div>
                          <div className="chat-dock-user-row__meta">{renderUserMetaText(item?.user) || '发来了好友申请'}</div>
                        </div>
                        <div className="chat-dock-request-card__actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            disabled={responding || friendActionId === blockKey}
                            onClick={() => onRespondFriendRequest(item?.friendshipId, 'accept')}
                          >
                            {requestActionId === acceptKey ? '处理中...' : '通过'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={responding || friendActionId === blockKey}
                            onClick={() => onRespondFriendRequest(item?.friendshipId, 'reject')}
                          >
                            {requestActionId === rejectKey ? '处理中...' : '拒绝'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={responding || friendActionId === blockKey}
                            onClick={() => onRespondFriendRequest(item?.friendshipId, 'ignore')}
                          >
                            {requestActionId === ignoreKey ? '处理中...' : '忽略'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-small"
                            disabled={responding || friendActionId === blockKey}
                            onClick={() => onBlockUser({ targetUserId: item?.user?._id, friendshipId: item?.friendshipId })}
                          >
                            {friendActionId === blockKey ? '处理中...' : '拉黑'}
                          </button>
                        </div>
                      </div>
                      <div className="chat-dock-request-card__message">
                        {item?.requestMessage || '对方未填写附言'}
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
                  <div key={item?.friendshipId} className="chat-dock-request-card is-sent">
                    <div className="chat-dock-request-card__topline">
                      {renderAvatarTrigger(item?.user, 36)}
                      <div className="chat-dock-user-row__content">
                        <div className="chat-dock-user-row__title">{item?.user?.username || '未命名用户'}</div>
                        <div className="chat-dock-user-row__meta">等待对方处理好友申请</div>
                      </div>
                      <span className="chat-dock-chip">待处理</span>
                    </div>
                    <div className="chat-dock-request-card__message">
                      {item?.requestMessage || '未填写附言'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isGroupInviteModalOpen ? (
        <div className="chat-dock-modal-layer" onClick={closeGroupInviteModal}>
          <div
            className="chat-dock-modal"
            role="dialog"
            aria-modal="true"
            aria-label={groupInviteModalMode === 'received' ? '群聊邀请' : '邀请成员'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="chat-dock-modal__header">
              <div>
                <div className="chat-dock-panel__eyebrow">{groupInviteModalMode === 'received' ? 'Group Invite' : 'Invite Members'}</div>
                <div className="chat-dock-modal__title">{groupInviteModalMode === 'received' ? '群聊邀请' : '邀请成员'}</div>
                <div className="chat-dock-modal__subtitle">
                  {groupInviteModalMode === 'received'
                    ? '在这里处理别人发给你的群聊邀请。'
                    : `向「${selectedGroup?.title || '当前群聊'}」发送邀请，对方需自行同意后才会加入。`}
                </div>
              </div>
              <button
                type="button"
                className="chat-dock-close-btn"
                onClick={closeGroupInviteModal}
                title="关闭群聊邀请弹窗"
              >
                <X size={16} />
              </button>
            </div>

            <div className="chat-dock-modal__body">
              {groupInviteModalMode === 'received' ? (
                <div className="chat-dock-subsection">
                  <div className="chat-dock-list__header">
                    <span>收到的邀请</span>
                    {groupInviteListLoading ? <Loader2 size={14} className="chat-spin" /> : <span>{receivedGroupInvites.length}</span>}
                  </div>
                  {receivedGroupInvites.length === 0 ? (
                    <div className="chat-dock-empty">当前没有待处理群聊邀请。</div>
                  ) : receivedGroupInvites.map((item) => {
                    const acceptKey = `${item?.invitationId}:accept`;
                    const rejectKey = `${item?.invitationId}:reject`;
                    const ignoreKey = `${item?.invitationId}:ignore`;
                    const acting = [acceptKey, rejectKey, ignoreKey].includes(groupInviteActionId);
                    return (
                      <div key={item?.invitationId} className="chat-dock-request-card">
                        <div className="chat-dock-request-card__topline">
                          {renderAvatarTrigger(item?.inviter, 38)}
                          <div className="chat-dock-request-card__content">
                            <div className="chat-dock-user-row__title">{item?.group?.title || '未命名群聊'}</div>
                            <div className="chat-dock-user-row__meta">
                              {`${item?.inviter?.username || '某位玩家'} 邀请你加入`}
                            </div>
                          </div>
                          <div className="chat-dock-request-card__actions">
                            <button
                              type="button"
                              className="btn btn-primary btn-small"
                              disabled={acting}
                              onClick={() => onRespondGroupInvitation(item?.invitationId, 'accept')}
                            >
                              {groupInviteActionId === acceptKey ? '处理中...' : '同意'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              disabled={acting}
                              onClick={() => onRespondGroupInvitation(item?.invitationId, 'reject')}
                            >
                              {groupInviteActionId === rejectKey ? '处理中...' : '拒绝'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              disabled={acting}
                              onClick={() => onRespondGroupInvitation(item?.invitationId, 'ignore')}
                            >
                              {groupInviteActionId === ignoreKey ? '处理中...' : '忽略'}
                            </button>
                          </div>
                        </div>
                        <div className="chat-dock-request-card__message">
                          {item?.group?.announcement || '加入后可查看群成员与后续消息。'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <>
                  <form
                    className="chat-dock-search-box"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onSearchGroupInviteUsers(groupInviteSearchQuery);
                    }}
                  >
                    <div className="chat-dock-search-input">
                      <Search size={14} />
                      <input
                        type="text"
                        value={groupInviteSearchQuery}
                        onChange={(event) => setGroupInviteSearchQuery(event.target.value)}
                        placeholder="搜索用户名并发送群聊邀请"
                      />
                    </div>
                    <button type="submit" className="btn btn-secondary btn-small" disabled={groupInviteSearchLoading}>
                      {groupInviteSearchLoading ? '搜索中...' : '搜索'}
                    </button>
                  </form>

                  <div className="chat-dock-subsection">
                    <div className="chat-dock-list__header">
                      <span>好友邀请</span>
                      <span>{availableGroupInviteRows.length}</span>
                    </div>
                    {availableGroupInviteRows.length === 0 ? (
                      <div className="chat-dock-empty">当前没有可邀请的好友。</div>
                    ) : (
                      <div className="chat-dock-group-member-list">
                        {availableGroupInviteRows.map((item) => {
                          const stableActionKey = `group-invite:${selectedGroupConversationId}:${item?._id || ''}`;
                          return (
                            <div key={item?._id} className="chat-dock-user-row">
                              {renderAvatarTrigger(item, 36)}
                              <div className="chat-dock-user-row__content">
                                <div className="chat-dock-user-row__title">{item?.username || '未命名用户'}</div>
                                <div className="chat-dock-user-row__meta">{renderUserMetaText(item) || '好友成员'}</div>
                              </div>
                              <button
                                type="button"
                                className="btn btn-primary btn-small"
                                disabled={!selectedGroupConversationId || groupInviteActionId === stableActionKey}
                                onClick={() => onInviteGroupMembers({
                                  conversationId: selectedGroupConversationId,
                                  inviteeUserIds: [item?._id]
                                })}
                              >
                                {groupInviteActionId === stableActionKey ? '邀请中...' : '邀请'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {groupInviteSearchQuery.trim() ? (
                    <div className="chat-dock-subsection">
                      <div className="chat-dock-list__header">
                        <span>搜索结果</span>
                        {groupInviteSearchLoading ? <Loader2 size={14} className="chat-spin" /> : null}
                      </div>
                      {groupInviteSearchResults.length === 0 && !groupInviteSearchLoading ? (
                        <div className="chat-dock-empty">没有找到匹配用户。</div>
                      ) : groupInviteSearchResults
                        .filter((item) => !selectedGroupMemberIdSet.has(String(item?._id || '')))
                        .map((item) => {
                          const stableActionKey = `group-invite:${selectedGroupConversationId}:${item?._id || ''}`;
                          return (
                            <div key={item?._id} className="chat-dock-user-row">
                              {renderAvatarTrigger(item, 36)}
                              <div className="chat-dock-user-row__content">
                                <div className="chat-dock-user-row__title">{item?.username || '未命名用户'}</div>
                                <div className="chat-dock-user-row__meta">{renderUserMetaText(item) || '可发送群聊邀请'}</div>
                              </div>
                              <button
                                type="button"
                                className="btn btn-primary btn-small"
                                disabled={!selectedGroupConversationId || groupInviteActionId === stableActionKey}
                                onClick={() => onInviteGroupMembers({
                                  conversationId: selectedGroupConversationId,
                                  inviteeUserIds: [item?._id]
                                })}
                              >
                                {groupInviteActionId === stableActionKey ? '邀请中...' : '邀请'}
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isGroupShareModalOpen && selectedGroup ? (
        <div className="chat-dock-modal-layer" onClick={closeGroupShareModal}>
          <div
            className="chat-dock-modal"
            role="dialog"
            aria-modal="true"
            aria-label="分享群聊"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="chat-dock-modal__header">
              <div>
                <div className="chat-dock-modal__title">分享群聊</div>
                <div className="chat-dock-modal__subtitle">可发送给好友私聊或其他群聊。</div>
              </div>
              <button
                type="button"
                className="chat-dock-close-btn"
                onClick={closeGroupShareModal}
                title="关闭分享群聊弹窗"
              >
                <X size={16} />
              </button>
            </div>
            <div className="chat-dock-modal__body">
              <div className="chat-dock-group-search-card">
                <div className="chat-dock-group-search-card__title">{selectedGroupTitle || '未命名群聊'}</div>
                {renderGroupNoLine(selectedGroupNo)}
                <div className="chat-dock-group-search-card__meta">
                  {`${selectedGroupMemberCount} 人`}
                </div>
                <div className="chat-dock-group-search-card__text">
                  {selectedGroupAnnouncementText || '当前没有群简介。'}
                </div>
              </div>

              <div className="chat-dock-share-toolbar">
                <div className="chat-dock-search-input">
                  <Search size={14} />
                  <input
                    type="text"
                    value={groupShareSearchQuery}
                    onChange={(event) => setGroupShareSearchQuery(event.target.value)}
                    placeholder="搜索好友名、群名或群ID"
                  />
                </div>
                <span className="chat-dock-chip">
                  {selectedGroupShareCount}/{MAX_GROUP_SHARE_TARGET_COUNT}
                </span>
              </div>

              <div className="chat-dock-subsection">
                <div className="chat-dock-list__header">
                  <span>分享给好友</span>
                  <span>{shareableFriendRows.length}</span>
                </div>
                {shareableFriendRows.length === 0 ? (
                  <div className="chat-dock-empty">没有可分享的好友目标。</div>
                ) : (
                  <div className="chat-dock-member-picker">
                    {shareableFriendRows.map((item) => {
                      const isSelected = groupShareTargetUserIds.includes(String(item?._id || ''));
                      return (
                        <button
                          key={item?._id}
                          type="button"
                          className={`chat-dock-member-pick${isSelected ? ' is-selected' : ''}`}
                          onClick={() => toggleGroupShareUserTarget(item?._id)}
                        >
                          <UserAvatar user={item} size={36} />
                          <span className="chat-dock-member-pick__content">
                            <span className="chat-dock-user-row__title">{item?.username || '未命名好友'}</span>
                            <span className="chat-dock-user-row__meta">{renderUserMetaText(item) || '好友私聊'}</span>
                          </span>
                          <span className="chat-dock-share-target-indicator">
                            {isSelected ? <Check size={16} /> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="chat-dock-subsection">
                <div className="chat-dock-list__header">
                  <span>分享到群聊</span>
                  <span>{shareableGroupRows.length}</span>
                </div>
                {shareableGroupRows.length === 0 ? (
                  <div className="chat-dock-empty">没有可分享的其他群聊目标。</div>
                ) : (
                  <div className="chat-dock-member-picker">
                    {shareableGroupRows.map((item) => {
                      const isSelected = groupShareTargetConversationIds.includes(String(item?.conversationId || ''));
                      return (
                        <button
                          key={item?.conversationId}
                          type="button"
                          className={`chat-dock-member-pick${isSelected ? ' is-selected' : ''}`}
                          onClick={() => toggleGroupShareConversationTarget(item?.conversationId)}
                        >
                          <UserAvatar user={{ avatar: item?.avatar || DEFAULT_GROUP_AVATAR_KEY, username: item?.title }} size={36} />
                          <span className="chat-dock-member-pick__content">
                            <span className="chat-dock-user-row__title">{item?.title || '未命名群聊'}</span>
                          <span className="chat-dock-user-row__meta">
                              {`${item?.memberCount || 0} 人`}
                            </span>
                          </span>
                          <span className="chat-dock-share-target-indicator">
                            {isSelected ? <Check size={16} /> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="chat-dock-group-actions">
                <button type="button" className="btn btn-secondary" onClick={closeGroupShareModal}>
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={selectedGroupShareCount <= 0 || groupActionId === `group-share:${selectedGroupConversationId}`}
                  onClick={submitGroupShareCard}
                >
                  {groupActionId === `group-share:${selectedGroupConversationId}` ? <Loader2 size={15} className="chat-spin" /> : <Share2 size={15} />}
                  发送邀请卡
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isFriendRequestComposerOpen ? (
        <div className="chat-dock-modal-layer" onClick={closeFriendRequestComposer}>
          <div
            className="chat-dock-modal chat-dock-modal--compact"
            role="dialog"
            aria-modal="true"
            aria-label="填写好友申请留言"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="chat-dock-modal__header">
              <div>
                <div className="chat-dock-panel__eyebrow">Friend Request</div>
                <div className="chat-dock-modal__title">填写好友申请留言</div>
                <div className="chat-dock-modal__subtitle">
                  发送给 {friendRequestTarget?.username || '对方'} 的好友申请会附带这段留言。
                </div>
              </div>
              <button
                type="button"
                className="chat-dock-close-btn"
                onClick={closeFriendRequestComposer}
                title="关闭留言弹窗"
              >
                <X size={16} />
              </button>
            </div>
            <div className="chat-dock-modal__body">
              <label className="chat-dock-field">
                <span>留言内容</span>
                <textarea
                  value={friendRequestDraft}
                  maxLength={120}
                  onChange={(event) => setFriendRequestDraft(event.target.value)}
                  placeholder="写一句自我介绍、来意或认识原因"
                />
              </label>
              <div className="chat-dock-compose-meta">
                <span>必填，最多 120 字</span>
                <span>{friendRequestDraft.trim().length}/120</span>
              </div>
              <div className="chat-dock-request-card__actions chat-dock-request-card__actions--composer">
                <button type="button" className="btn btn-secondary" onClick={closeFriendRequestComposer}>
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!friendRequestDraft.trim() || friendActionId === `request:${friendRequestTarget?._id || ''}`}
                  onClick={submitFriendRequest}
                >
                  {friendActionId === `request:${friendRequestTarget?._id || ''}` ? '发送中...' : '发送申请'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isComposerExpanded && expandedComposerTarget ? (
        <div className="chat-dock-modal-layer chat-dock-modal-layer--composer" onClick={() => setIsComposerExpanded(false)}>
          <div
            className="chat-dock-modal chat-dock-modal--composer-expanded"
            role="dialog"
            aria-modal="true"
            aria-label="展开输入"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="chat-dock-modal__header">
              <div>
                <div className="chat-dock-panel__eyebrow">Expanded Composer</div>
                <div className="chat-dock-modal__title">长消息输入</div>
                <div className="chat-dock-modal__subtitle">
                  {expandedComposerTarget?.title ? `发送给 ${expandedComposerTarget.title}` : '当前会话'}
                </div>
              </div>
              <button
                type="button"
                className="chat-dock-close-btn"
                onClick={() => setIsComposerExpanded(false)}
                title="关闭展开输入"
              >
                <X size={16} />
              </button>
            </div>
            <div className="chat-dock-modal__body chat-dock-modal__body--composer-expanded">
              <textarea
                ref={expandedComposerTextareaRef}
                className="chat-dock-expanded-textarea"
                value={draftMessage}
                onChange={(event) => {
                  setDraftMessage(event.target.value);
                  syncComposerSelection(event.target);
                }}
                onClick={(event) => syncComposerSelection(event.target)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void handleSubmitMessage({ closeExpanded: true });
                  }
                }}
                onKeyUp={(event) => syncComposerSelection(event.target)}
                onSelect={(event) => syncComposerSelection(event.target)}
                disabled={!isGroupsTab && selectedConversationFriendStatus === 'blocked' && !selectedConversationBlockedByCurrentUser}
                placeholder={!isGroupsTab && selectedConversationFriendStatus === 'blocked'
                  ? selectedConversationBlockedByCurrentUser
                    ? '发送时会先提示你解除拉黑'
                    : '对方已将你拉黑，无法发送临时消息'
                  : '这里适合输入长内容。Ctrl/Cmd + Enter 发送'}
              />
              <div className="chat-dock-composer-expanded-footer">
                <div className="chat-dock-compose-meta">
                  <span>支持长文本编辑</span>
                  <span>{draftMessage.trim().length} 字</span>
                </div>
                <div className="chat-dock-composer-expanded-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsComposerExpanded(false)}
                  >
                    返回会话
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      (!isGroupsTab && selectedConversationFriendStatus === 'blocked' && !selectedConversationBlockedByCurrentUser)
                      || conversationActionId === `send:${expandedComposerTarget?.conversationId}`
                      || !draftMessage.trim()
                    }
                    onClick={() => {
                      void handleSubmitMessage({ closeExpanded: true });
                    }}
                  >
                    {conversationActionId === `send:${expandedComposerTarget?.conversationId}` ? <Loader2 size={15} className="chat-spin" /> : <Send size={15} />}
                    发送消息
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ChatDockPanel;
