import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../runtimeConfig';

const DEFAULT_MESSAGE_PAGE_SIZE = 30;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const normalizeConversationId = (value) => {
  const normalizedValue = typeof value === 'string'
    ? value.trim()
    : value?.toString?.().trim?.() || '';
  return OBJECT_ID_PATTERN.test(normalizedValue) ? normalizedValue : '';
};

const sortConversations = (rows = []) => (
  [...rows].sort((left, right) => {
    if (Boolean(left?.pinned) !== Boolean(right?.pinned)) {
      return left?.pinned ? -1 : 1;
    }
    return new Date(right?.lastMessageAt || 0).getTime() - new Date(left?.lastMessageAt || 0).getTime();
  })
);

const upsertConversationRow = (rows = [], nextRow = null) => {
  if (!nextRow?.conversationId) {
    return sortConversations(rows);
  }
  const nextRows = rows.filter((item) => item?.conversationId !== nextRow.conversationId);
  nextRows.push(nextRow);
  return sortConversations(nextRows);
};

const removeConversationRow = (rows = [], conversationId = '') => (
  rows.filter((item) => item?.conversationId !== conversationId)
);

const mergeMessagesAscending = (existingRows = [], incomingRows = [], mode = 'replace') => {
  const merged = mode === 'prepend'
    ? [...incomingRows, ...existingRows]
    : mode === 'append'
      ? [...existingRows, ...incomingRows]
      : [...incomingRows];

  const deduped = [];
  const seen = new Set();
  merged.forEach((item) => {
    const key = item?._id || `${item?.conversationId || ''}:${item?.seq || 0}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });

  return deduped.sort((left, right) => (Number(left?.seq) || 0) - (Number(right?.seq) || 0));
};

const createEmptyMessagesEntry = () => ({
  rows: [],
  nextBeforeSeq: 0,
  loading: false,
  error: '',
  initialized: false
});

const useChatCenter = ({
  authenticated,
  currentUserId,
  socket,
  parseApiResponse,
  getApiErrorMessage
}) => {
  const [isChatDockExpanded, setIsChatDockExpanded] = useState(false);
  const [isRequestsModalOpen, setIsRequestsModalOpen] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState('conversations');
  const [conversations, setConversations] = useState([]);
  const [friends, setFriends] = useState([]);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [friendRequests, setFriendRequests] = useState({ received: [], sent: [] });
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedGroupDetail, setSelectedGroupDetail] = useState(null);
  const [conversationMessages, setConversationMessages] = useState({});
  const [conversationListLoading, setConversationListLoading] = useState(false);
  const [friendListLoading, setFriendListLoading] = useState(false);
  const [requestListLoading, setRequestListLoading] = useState(false);
  const [groupDetailLoading, setGroupDetailLoading] = useState(false);
  const [groupInviteListLoading, setGroupInviteListLoading] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState([]);
  const [friendSearchLoading, setFriendSearchLoading] = useState(false);
  const [groupInviteSearchQuery, setGroupInviteSearchQuery] = useState('');
  const [groupInviteSearchResults, setGroupInviteSearchResults] = useState([]);
  const [groupInviteSearchLoading, setGroupInviteSearchLoading] = useState(false);
  const [groupInvites, setGroupInvites] = useState({ received: [] });
  const [panelNotice, setPanelNotice] = useState('');
  const [conversationActionId, setConversationActionId] = useState('');
  const [groupActionId, setGroupActionId] = useState('');
  const [friendActionId, setFriendActionId] = useState('');
  const [requestActionId, setRequestActionId] = useState('');
  const [groupInviteActionId, setGroupInviteActionId] = useState('');
  const [chatToasts, setChatToasts] = useState([]);
  const toastTimersRef = useRef(new Map());

  const clearToastTimer = useCallback((toastId) => {
    const activeTimer = toastTimersRef.current.get(toastId);
    if (activeTimer) {
      window.clearTimeout(activeTimer);
      toastTimersRef.current.delete(toastId);
    }
  }, []);

  const dismissChatToast = useCallback((toastId) => {
    if (!toastId) return;
    clearToastTimer(toastId);
    setChatToasts((prev) => prev.filter((item) => item?.id !== toastId));
  }, [clearToastTimer]);

  const pushChatToast = useCallback((toast = {}) => {
    const nextId = String(
      toast?.id
      || `${toast?.kind || 'notice'}:${toast?.conversationId || toast?.friendshipId || Date.now()}`
    );
    const nextToast = {
      id: nextId,
      kind: toast?.kind || 'notice',
      tone: toast?.tone || 'info',
      title: toast?.title || '提示',
      message: toast?.message || '',
      conversationId: toast?.conversationId || '',
      friendshipId: toast?.friendshipId || ''
    };

    clearToastTimer(nextId);
    setChatToasts((prev) => [
      nextToast,
      ...prev.filter((item) => item?.id !== nextId)
    ].slice(0, 3));

    const nextTimer = window.setTimeout(() => {
      toastTimersRef.current.delete(nextId);
      setChatToasts((prev) => prev.filter((item) => item?.id !== nextId));
    }, 4200);
    toastTimersRef.current.set(nextId, nextTimer);

    return nextId;
  }, [clearToastTimer]);

  const resetChatCenter = useCallback(() => {
    toastTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    toastTimersRef.current.clear();
    setIsChatDockExpanded(false);
    setIsRequestsModalOpen(false);
    setActiveSidebarTab('conversations');
    setConversations([]);
    setFriends([]);
    setBlockedUsers([]);
    setFriendRequests({ received: [], sent: [] });
    setSelectedConversationId('');
    setSelectedGroupId('');
    setSelectedGroupDetail(null);
    setConversationMessages({});
    setConversationListLoading(false);
    setFriendListLoading(false);
    setRequestListLoading(false);
    setGroupDetailLoading(false);
    setGroupInviteListLoading(false);
    setFriendSearchQuery('');
    setFriendSearchResults([]);
    setFriendSearchLoading(false);
    setGroupInviteSearchQuery('');
    setGroupInviteSearchResults([]);
    setGroupInviteSearchLoading(false);
    setGroupInvites({ received: [] });
    setPanelNotice('');
    setConversationActionId('');
    setGroupActionId('');
    setFriendActionId('');
    setRequestActionId('');
    setGroupInviteActionId('');
    setChatToasts([]);
  }, []);

  const getToken = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? String(token).trim() : '';
  }, []);

  const buildAuthHeaders = useCallback((options = {}) => {
    const token = getToken();
    if (!token) return null;
    const headers = {
      Authorization: `Bearer ${token}`
    };
    if (options.json) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }, [getToken]);

  const updateConversationMessagesEntry = useCallback((conversationId, updater) => {
    if (!conversationId) return;
    setConversationMessages((prev) => {
      const currentEntry = prev[conversationId] || createEmptyMessagesEntry();
      const nextEntry = typeof updater === 'function' ? updater(currentEntry) : currentEntry;
      return {
        ...prev,
        [conversationId]: nextEntry
      };
    });
  }, []);

  const fetchConversations = useCallback(async (silent = true) => {
    const headers = buildAuthHeaders();
    if (!headers) return null;

    if (!silent) {
      setConversationListLoading(true);
    }

    try {
      const response = await fetch(`${API_BASE}/chat/conversations`, {
        headers
      });
      const parsed = await parseApiResponse(response);
      const rows = Array.isArray(parsed.data?.rows) ? parsed.data.rows : null;
      if (!response.ok || !rows) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取会话列表失败'));
        }
        return null;
      }

      setConversations(sortConversations(rows));
      setSelectedConversationId((prev) => (
        prev && rows.some((item) => item?.conversationId === prev) ? prev : ''
      ));
      setSelectedGroupId((prev) => (
        prev && rows.some((item) => item?.conversationId === prev && item?.type === 'group') ? prev : ''
      ));
      return rows;
    } catch (error) {
      if (!silent) {
        window.alert(`获取会话列表失败: ${error.message}`);
      }
      return null;
    } finally {
      if (!silent) {
        setConversationListLoading(false);
      }
    }
  }, [buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const applyGroupPayload = useCallback((conversation, group) => {
    if (conversation?.conversationId) {
      setConversations((prev) => upsertConversationRow(prev, conversation));
    }
    if (group?.conversationId) {
      setSelectedGroupId(group.conversationId);
      setSelectedGroupDetail({
        conversation: conversation || null,
        group
      });
    }
  }, []);

  const fetchGroupDetail = useCallback(async (conversationId, options = {}) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const headers = buildAuthHeaders();
    if (!headers || !safeConversationId) return null;

    if (!options.silent) {
      setGroupDetailLoading(true);
    }

    try {
      const response = await fetch(`${API_BASE}/chat/groups/${safeConversationId}`, {
        headers
      });
      const parsed = await parseApiResponse(response);
      const conversation = parsed.data?.conversation || null;
      const group = parsed.data?.group || null;
      if (!response.ok || !group?.conversationId) {
        if (!options.silent) {
          window.alert(getApiErrorMessage(parsed, '获取群聊详情失败'));
        }
        return null;
      }

      applyGroupPayload(conversation, group);
      return {
        conversation,
        group
      };
    } catch (error) {
      if (!options.silent) {
        window.alert(`获取群聊详情失败: ${error.message}`);
      }
      return null;
    } finally {
      if (!options.silent) {
        setGroupDetailLoading(false);
      }
    }
  }, [applyGroupPayload, buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const fetchFriends = useCallback(async (silent = true) => {
    const headers = buildAuthHeaders();
    if (!headers) return null;

    if (!silent) {
      setFriendListLoading(true);
    }

    try {
      const response = await fetch(`${API_BASE}/social/friends`, {
        headers
      });
      const parsed = await parseApiResponse(response);
      const rows = Array.isArray(parsed.data?.rows) ? parsed.data.rows : null;
      const blockedRows = Array.isArray(parsed.data?.blockedRows) ? parsed.data.blockedRows : [];
      if (!response.ok || !rows) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取好友列表失败'));
        }
        return null;
      }

      setFriends(rows);
      setBlockedUsers(blockedRows);
      return {
        rows,
        blockedRows
      };
    } catch (error) {
      if (!silent) {
        window.alert(`获取好友列表失败: ${error.message}`);
      }
      return null;
    } finally {
      if (!silent) {
        setFriendListLoading(false);
      }
    }
  }, [buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const fetchFriendRequests = useCallback(async (silent = true) => {
    const headers = buildAuthHeaders();
    if (!headers) return null;

    if (!silent) {
      setRequestListLoading(true);
    }

    try {
      const response = await fetch(`${API_BASE}/social/friends/requests`, {
        headers
      });
      const parsed = await parseApiResponse(response);
      const received = Array.isArray(parsed.data?.received) ? parsed.data.received : null;
      const sent = Array.isArray(parsed.data?.sent) ? parsed.data.sent : null;
      if (!response.ok || !received || !sent) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取好友申请失败'));
        }
        return null;
      }

      const nextState = { received, sent };
      setFriendRequests(nextState);
      return nextState;
    } catch (error) {
      if (!silent) {
        window.alert(`获取好友申请失败: ${error.message}`);
      }
      return null;
    } finally {
      if (!silent) {
        setRequestListLoading(false);
      }
    }
  }, [buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const searchUsers = useCallback(async (keyword, options = {}) => {
    const headers = buildAuthHeaders();
    const trimmedKeyword = String(keyword || '').trim();
    if (!headers) return [];
    if (!trimmedKeyword) {
      setFriendSearchResults([]);
      return [];
    }

    if (!options.silent) {
      setFriendSearchLoading(true);
    }

    try {
      const response = await fetch(`${API_BASE}/social/users/search?keyword=${encodeURIComponent(trimmedKeyword)}`, {
        headers
      });
      const parsed = await parseApiResponse(response);
      const rows = Array.isArray(parsed.data?.rows) ? parsed.data.rows : null;
      if (!response.ok || !rows) {
        if (!options.silent) {
          window.alert(getApiErrorMessage(parsed, '搜索用户失败'));
        }
        return [];
      }

      setFriendSearchResults(rows);
      return rows;
    } catch (error) {
      if (!options.silent) {
        window.alert(`搜索用户失败: ${error.message}`);
      }
      return [];
    } finally {
      if (!options.silent) {
        setFriendSearchLoading(false);
      }
    }
  }, [buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const searchGroupInviteUsers = useCallback(async (keyword, options = {}) => {
    const headers = buildAuthHeaders();
    const trimmedKeyword = String(keyword || '').trim();
    if (!headers) return [];
    if (!trimmedKeyword) {
      setGroupInviteSearchResults([]);
      return [];
    }

    if (!options.silent) {
      setGroupInviteSearchLoading(true);
    }

    try {
      const response = await fetch(`${API_BASE}/social/users/search?keyword=${encodeURIComponent(trimmedKeyword)}`, {
        headers
      });
      const parsed = await parseApiResponse(response);
      const rows = Array.isArray(parsed.data?.rows) ? parsed.data.rows : null;
      if (!response.ok || !rows) {
        if (!options.silent) {
          window.alert(getApiErrorMessage(parsed, '搜索邀请用户失败'));
        }
        return [];
      }

      setGroupInviteSearchResults(rows);
      return rows;
    } catch (error) {
      if (!options.silent) {
        window.alert(`搜索邀请用户失败: ${error.message}`);
      }
      return [];
    } finally {
      if (!options.silent) {
        setGroupInviteSearchLoading(false);
      }
    }
  }, [buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const syncSocialSidebarData = useCallback(async () => {
    await Promise.all([
      fetchFriendRequests(true),
      fetchFriends(true),
      friendSearchQuery ? searchUsers(friendSearchQuery, { silent: true }) : Promise.resolve([])
    ]);
  }, [
    fetchFriendRequests,
    fetchFriends,
    friendSearchQuery,
    searchUsers
  ]);

  const fetchGroupInvitations = useCallback(async (silent = true) => {
    const headers = buildAuthHeaders();
    if (!headers) return null;

    if (!silent) {
      setGroupInviteListLoading(true);
    }

    try {
      const response = await fetch(`${API_BASE}/chat/groups/invitations`, {
        headers
      });
      const parsed = await parseApiResponse(response);
      const received = Array.isArray(parsed.data?.received) ? parsed.data.received : null;
      if (!response.ok || !received) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取群聊邀请失败'));
        }
        return null;
      }

      const nextState = { received };
      setGroupInvites(nextState);
      return nextState;
    } catch (error) {
      if (!silent) {
        window.alert(`获取群聊邀请失败: ${error.message}`);
      }
      return null;
    } finally {
      if (!silent) {
        setGroupInviteListLoading(false);
      }
    }
  }, [buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const markConversationRead = useCallback(async (conversationId, lastReadSeq = 0) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const headers = buildAuthHeaders({ json: true });
    if (!headers || !safeConversationId) return null;

    try {
      const response = await fetch(`${API_BASE}/chat/conversations/${safeConversationId}/read`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ lastReadSeq })
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data?.conversationId) {
        return null;
      }

      setConversations((prev) => sortConversations(prev.map((item) => (
        item?.conversationId === safeConversationId
          ? {
            ...item,
            lastReadSeq: Number(parsed.data.lastReadSeq) || Number(item?.lastReadSeq) || 0,
            unreadCount: Number(parsed.data.unreadCount) || 0
          }
          : item
      ))));

      return parsed.data;
    } catch (_error) {
      return null;
    }
  }, [buildAuthHeaders, parseApiResponse]);

  const fetchMessages = useCallback(async ({
    conversationId,
    beforeSeq = 0,
    prepend = false,
    silent = true,
    shouldMarkRead = true
  }) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const headers = buildAuthHeaders();
    if (!headers || !safeConversationId) return null;

    updateConversationMessagesEntry(safeConversationId, (current) => ({
      ...current,
      loading: !silent,
      error: silent ? current.error : ''
    }));

    try {
      const query = new URLSearchParams();
      query.set('limit', String(DEFAULT_MESSAGE_PAGE_SIZE));
      if (beforeSeq > 0) {
        query.set('beforeSeq', String(beforeSeq));
      }
      const response = await fetch(`${API_BASE}/chat/conversations/${safeConversationId}/messages?${query.toString()}`, {
        headers
      });
      const parsed = await parseApiResponse(response);
      const rows = Array.isArray(parsed.data?.rows) ? parsed.data.rows : null;
      const nextBeforeSeq = Number(parsed.data?.nextBeforeSeq) || 0;
      if (!response.ok || !rows) {
        updateConversationMessagesEntry(safeConversationId, (current) => ({
          ...current,
          loading: false,
          error: getApiErrorMessage(parsed, '获取聊天记录失败'),
          initialized: true
        }));
        return null;
      }

      let mergedRows = rows;
      updateConversationMessagesEntry(safeConversationId, (current) => {
        mergedRows = mergeMessagesAscending(current.rows, rows, prepend ? 'prepend' : 'replace');
        return {
          rows: mergedRows,
          nextBeforeSeq,
          loading: false,
          error: '',
          initialized: true
        };
      });

      if (shouldMarkRead) {
        const latestSeq = mergedRows.length > 0 ? Number(mergedRows[mergedRows.length - 1]?.seq) || 0 : 0;
        const activeConversation = conversations.find((item) => item?.conversationId === safeConversationId) || null;
        if (latestSeq > 0 && (
          latestSeq > (Number(activeConversation?.lastReadSeq) || 0)
          || (Number(activeConversation?.unreadCount) || 0) > 0
        )) {
          markConversationRead(safeConversationId, latestSeq);
        }
      }

      return {
        rows: mergedRows,
        nextBeforeSeq
      };
    } catch (error) {
      updateConversationMessagesEntry(safeConversationId, (current) => ({
        ...current,
        loading: false,
        error: `获取聊天记录失败: ${error.message}`,
        initialized: true
      }));
      return null;
    }
  }, [
    buildAuthHeaders,
    conversations,
    getApiErrorMessage,
    markConversationRead,
    parseApiResponse,
    updateConversationMessagesEntry
  ]);

  const openConversation = useCallback(async (conversationId) => {
    const safeConversationId = normalizeConversationId(conversationId);
    if (!safeConversationId) return null;
    setActiveSidebarTab('conversations');
    setSelectedConversationId(safeConversationId);
    return fetchMessages({
      conversationId: safeConversationId,
      beforeSeq: 0,
      prepend: false,
      silent: false,
      shouldMarkRead: true
    });
  }, [fetchMessages]);

  const openGroupDetail = useCallback(async (conversationId) => {
    const safeConversationId = normalizeConversationId(conversationId);
    if (!safeConversationId) return null;
    setActiveSidebarTab('groups');
    setSelectedGroupId(safeConversationId);
    return fetchGroupDetail(safeConversationId, { silent: false });
  }, [fetchGroupDetail]);

  const openDirectConversation = useCallback(async (targetUserId) => {
    const headers = buildAuthHeaders({ json: true });
    if (!headers || !targetUserId) return null;

    const actionKey = `open:${targetUserId}`;
    setConversationActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/chat/conversations/direct/${targetUserId}`, {
        method: 'POST',
        headers
      });
      const parsed = await parseApiResponse(response);
      const conversation = parsed.data?.conversation || null;
      if (!response.ok || !conversation?.conversationId) {
        window.alert(getApiErrorMessage(parsed, '打开私聊失败'));
        return null;
      }

      setConversations((prev) => upsertConversationRow(prev, conversation));
      setSelectedConversationId(conversation.conversationId);
      setActiveSidebarTab('conversations');
      await Promise.all([
        fetchFriends(true),
        fetchMessages({
          conversationId: conversation.conversationId,
          beforeSeq: 0,
          prepend: false,
          silent: true,
          shouldMarkRead: true
        })
      ]);
      return conversation;
    } catch (error) {
      window.alert(`打开私聊失败: ${error.message}`);
      return null;
    } finally {
      setConversationActionId('');
    }
  }, [
    buildAuthHeaders,
    fetchFriends,
    fetchMessages,
    getApiErrorMessage,
    parseApiResponse
  ]);

  const createGroupConversation = useCallback(async ({
    title,
    announcement = '',
    memberUserIds = []
  }) => {
    const headers = buildAuthHeaders({ json: true });
    if (!headers) return null;

    setGroupActionId('create-group');
    try {
      const response = await fetch(`${API_BASE}/chat/groups`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title,
          announcement,
          memberUserIds
        })
      });
      const parsed = await parseApiResponse(response);
      const conversation = parsed.data?.conversation || null;
      const group = parsed.data?.group || null;
      if (!response.ok || !group?.conversationId) {
        window.alert(getApiErrorMessage(parsed, '创建群聊失败'));
        return null;
      }

      applyGroupPayload(conversation, group);
      setActiveSidebarTab('groups');
      return {
        conversation,
        group
      };
    } catch (error) {
      window.alert(`创建群聊失败: ${error.message}`);
      return null;
    } finally {
      setGroupActionId('');
    }
  }, [applyGroupPayload, buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const updateGroupConversation = useCallback(async ({
    conversationId,
    title,
    announcement
  }) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const headers = buildAuthHeaders({ json: true });
    if (!headers || !safeConversationId) return null;

    setGroupActionId(`group-update:${safeConversationId}`);
    try {
      const response = await fetch(`${API_BASE}/chat/groups/${safeConversationId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          title,
          announcement
        })
      });
      const parsed = await parseApiResponse(response);
      const conversation = parsed.data?.conversation || null;
      const group = parsed.data?.group || null;
      if (!response.ok || !group?.conversationId) {
        window.alert(getApiErrorMessage(parsed, '更新群聊失败'));
        return null;
      }

      applyGroupPayload(conversation, group);
      setPanelNotice('群聊信息已更新。');
      return {
        conversation,
        group
      };
    } catch (error) {
      window.alert(`更新群聊失败: ${error.message}`);
      return null;
    } finally {
      setGroupActionId('');
    }
  }, [applyGroupPayload, buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const addGroupMembers = useCallback(async ({
    conversationId,
    memberUserIds = []
  }) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const headers = buildAuthHeaders({ json: true });
    if (!headers || !safeConversationId) return null;

    setGroupActionId(`group-add:${safeConversationId}`);
    try {
      const response = await fetch(`${API_BASE}/chat/groups/${safeConversationId}/members`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ memberUserIds })
      });
      const parsed = await parseApiResponse(response);
      const conversation = parsed.data?.conversation || null;
      const group = parsed.data?.group || null;
      if (!response.ok || !group?.conversationId) {
        window.alert(getApiErrorMessage(parsed, '添加群成员失败'));
        return null;
      }

      applyGroupPayload(conversation, group);
      setPanelNotice('群成员已更新。');
      return {
        conversation,
        group
      };
    } catch (error) {
      window.alert(`添加群成员失败: ${error.message}`);
      return null;
    } finally {
      setGroupActionId('');
    }
  }, [applyGroupPayload, buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const inviteGroupMembers = useCallback(async ({
    conversationId,
    inviteeUserIds = []
  }) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const headers = buildAuthHeaders({ json: true });
    const safeInviteeUserIds = Array.isArray(inviteeUserIds) ? inviteeUserIds.filter(Boolean) : [];
    if (!headers || !safeConversationId || safeInviteeUserIds.length === 0) return null;

    const actionKey = `group-invite:${safeConversationId}:${safeInviteeUserIds.join(',')}`;
    setGroupInviteActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/chat/groups/${safeConversationId}/invitations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ inviteeUserIds: safeInviteeUserIds })
      });
      const parsed = await parseApiResponse(response);
      const invitedUserIds = Array.isArray(parsed.data?.invitedUserIds) ? parsed.data.invitedUserIds : null;
      if (!response.ok || !invitedUserIds) {
        window.alert(getApiErrorMessage(parsed, '发送群聊邀请失败'));
        return null;
      }

      setPanelNotice(invitedUserIds.length > 1 ? '群聊邀请已发送。' : '群聊邀请已发送，等待对方处理。');
      await Promise.all([
        fetchGroupInvitations(true),
        fetchGroupDetail(safeConversationId, { silent: true }),
        groupInviteSearchQuery ? searchGroupInviteUsers(groupInviteSearchQuery, { silent: true }) : Promise.resolve([])
      ]);
      return invitedUserIds;
    } catch (error) {
      window.alert(`发送群聊邀请失败: ${error.message}`);
      return null;
    } finally {
      setGroupInviteActionId('');
    }
  }, [
    buildAuthHeaders,
    fetchGroupDetail,
    fetchGroupInvitations,
    getApiErrorMessage,
    groupInviteSearchQuery,
    parseApiResponse,
    searchGroupInviteUsers
  ]);

  const respondToGroupInvitation = useCallback(async (invitationId, action) => {
    const headers = buildAuthHeaders({ json: true });
    if (!headers || !invitationId) return null;

    const actionKey = `${invitationId}:${action}`;
    setGroupInviteActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/chat/groups/invitations/${invitationId}/respond`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action })
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data?.invitation?.invitationId) {
        const fallbackText = action === 'accept'
          ? '接受群聊邀请失败'
          : action === 'ignore'
            ? '忽略群聊邀请失败'
            : '处理群聊邀请失败';
        window.alert(getApiErrorMessage(parsed, fallbackText));
        return null;
      }

      setPanelNotice(
        action === 'accept'
          ? '已加入群聊。'
          : action === 'ignore'
            ? '该次群聊邀请已忽略。'
            : '群聊邀请已拒绝。'
      );
      await Promise.all([
        fetchConversations(true),
        fetchGroupInvitations(true)
      ]);
      return parsed.data.invitation;
    } catch (error) {
      const errorText = action === 'accept'
        ? '接受群聊邀请失败'
        : action === 'ignore'
          ? '忽略群聊邀请失败'
          : '处理群聊邀请失败';
      window.alert(`${errorText}: ${error.message}`);
      return null;
    } finally {
      setGroupInviteActionId('');
    }
  }, [
    buildAuthHeaders,
    fetchConversations,
    fetchGroupInvitations,
    getApiErrorMessage,
    parseApiResponse
  ]);

  const removeGroupMember = useCallback(async ({
    conversationId,
    targetUserId
  }) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const headers = buildAuthHeaders();
    if (!headers || !safeConversationId || !targetUserId) return null;

    setGroupActionId(`group-remove:${safeConversationId}:${targetUserId}`);
    try {
      const response = await fetch(`${API_BASE}/chat/groups/${safeConversationId}/members/${targetUserId}`, {
        method: 'DELETE',
        headers
      });
      const parsed = await parseApiResponse(response);
      const conversation = parsed.data?.conversation || null;
      const group = parsed.data?.group || null;
      if (!response.ok || !group?.conversationId) {
        window.alert(getApiErrorMessage(parsed, '移除群成员失败'));
        return null;
      }

      applyGroupPayload(conversation, group);
      setPanelNotice('群成员已移出。');
      return {
        conversation,
        group
      };
    } catch (error) {
      window.alert(`移除群成员失败: ${error.message}`);
      return null;
    } finally {
      setGroupActionId('');
    }
  }, [applyGroupPayload, buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const transferGroupOwnership = useCallback(async ({
    conversationId,
    targetUserId
  }) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const headers = buildAuthHeaders({ json: true });
    if (!headers || !safeConversationId || !targetUserId) return null;

    setGroupActionId(`group-transfer:${safeConversationId}:${targetUserId}`);
    try {
      const response = await fetch(`${API_BASE}/chat/groups/${safeConversationId}/transfer`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ targetUserId })
      });
      const parsed = await parseApiResponse(response);
      const conversation = parsed.data?.conversation || null;
      const group = parsed.data?.group || null;
      if (!response.ok || !group?.conversationId) {
        window.alert(getApiErrorMessage(parsed, '转让群主失败'));
        return null;
      }

      applyGroupPayload(conversation, group);
      setPanelNotice('群主已转让。');
      return {
        conversation,
        group
      };
    } catch (error) {
      window.alert(`转让群主失败: ${error.message}`);
      return null;
    } finally {
      setGroupActionId('');
    }
  }, [applyGroupPayload, buildAuthHeaders, getApiErrorMessage, parseApiResponse]);

  const leaveGroupConversation = useCallback(async (conversationId) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const headers = buildAuthHeaders({ json: true });
    if (!headers || !safeConversationId) return null;

    setGroupActionId(`group-leave:${safeConversationId}`);
    try {
      const response = await fetch(`${API_BASE}/chat/groups/${safeConversationId}/leave`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data?.conversationHiddenForCurrentUser) {
        window.alert(getApiErrorMessage(parsed, '退出群聊失败'));
        return null;
      }

      setConversations((prev) => removeConversationRow(prev, safeConversationId));
      setSelectedGroupId((prev) => (prev === safeConversationId ? '' : prev));
      setSelectedConversationId((prev) => (prev === safeConversationId ? '' : prev));
      setSelectedGroupDetail((prev) => (
        prev?.group?.conversationId === safeConversationId ? null : prev
      ));
      updateConversationMessagesEntry(safeConversationId, () => ({
        rows: [],
        nextBeforeSeq: 0,
        loading: false,
        error: '',
        initialized: true
      }));
      setPanelNotice('你已退出该群聊。');
      return parsed.data;
    } catch (error) {
      window.alert(`退出群聊失败: ${error.message}`);
      return null;
    } finally {
      setGroupActionId('');
    }
  }, [buildAuthHeaders, getApiErrorMessage, parseApiResponse, updateConversationMessagesEntry]);

  const sendMessage = useCallback(async (conversationId, content) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const headers = buildAuthHeaders({ json: true });
    const messageContent = String(content || '').trim();
    if (!headers || !safeConversationId) return null;
    if (!messageContent) return null;

    const actionKey = `send:${safeConversationId}`;
    setConversationActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/chat/conversations/${safeConversationId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'text',
          content: messageContent,
          clientMessageId: `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        })
      });
      const parsed = await parseApiResponse(response);
      const message = parsed.data?.message || null;
      const temporaryMessageInfo = parsed.data?.temporaryMessageInfo || null;
      if (!response.ok || !message?._id) {
        window.alert(getApiErrorMessage(parsed, '发送消息失败'));
        return null;
      }

      updateConversationMessagesEntry(safeConversationId, (current) => ({
        ...current,
        rows: mergeMessagesAscending(current.rows, [message], 'append'),
        initialized: true
      }));

      setConversations((prev) => {
        const currentConversation = prev.find((item) => item?.conversationId === safeConversationId);
        const nextRow = currentConversation
          ? {
            ...currentConversation,
            lastMessagePreview: message.content || '',
            lastMessageAt: message.createdAt || currentConversation.lastMessageAt,
            lastReadSeq: Number(message.seq) || Number(currentConversation.lastReadSeq) || 0,
            unreadCount: 0,
            isVisible: true
          }
          : null;
        return nextRow ? upsertConversationRow(prev, nextRow) : prev;
      });

      if (temporaryMessageInfo?.maxCount) {
        const noticeText = temporaryMessageInfo.remainingCount > 0
          ? `当前为非好友临时聊天，已发送 ${temporaryMessageInfo.usedCount}/${temporaryMessageInfo.maxCount} 条，还可再发 ${temporaryMessageInfo.remainingCount} 条。`
          : `当前为非好友临时聊天，已发送 ${temporaryMessageInfo.usedCount}/${temporaryMessageInfo.maxCount} 条，临时消息额度已用完。`;
        setPanelNotice(noticeText);
        pushChatToast({
          id: `temporary-message:${safeConversationId}:${temporaryMessageInfo.usedCount}`,
          kind: 'notice',
          tone: temporaryMessageInfo.remainingCount > 0 ? 'info' : 'warning',
          title: '临时消息提醒',
          message: noticeText,
          conversationId: safeConversationId
        });
      }

      return {
        message,
        temporaryMessageInfo
      };
    } catch (error) {
      window.alert(`发送消息失败: ${error.message}`);
      return null;
    } finally {
      setConversationActionId('');
    }
  }, [buildAuthHeaders, getApiErrorMessage, parseApiResponse, pushChatToast, updateConversationMessagesEntry]);

  const hideConversation = useCallback(async (conversationId) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const headers = buildAuthHeaders();
    if (!headers || !safeConversationId) return null;

    const actionKey = `hide:${safeConversationId}`;
    setConversationActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/chat/conversations/${safeConversationId}`, {
        method: 'DELETE',
        headers
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data?.conversationHiddenForCurrentUser) {
        window.alert(getApiErrorMessage(parsed, '删除聊天失败'));
        return null;
      }

      setConversations((prev) => removeConversationRow(prev, safeConversationId));
      setSelectedConversationId((prev) => (prev === safeConversationId ? '' : prev));
      updateConversationMessagesEntry(safeConversationId, () => ({
        rows: [],
        nextBeforeSeq: 0,
        loading: false,
        error: '',
        initialized: true
      }));
      setPanelNotice('当前聊天已仅对你自己隐藏并清空，对方好友关系与会话视图不受影响。');
      await fetchFriends(true);
      return parsed.data;
    } catch (error) {
      window.alert(`删除聊天失败: ${error.message}`);
      return null;
    } finally {
      setConversationActionId('');
    }
  }, [buildAuthHeaders, fetchFriends, getApiErrorMessage, parseApiResponse, updateConversationMessagesEntry]);

  const requestFriendship = useCallback(async ({ targetUserId, message = '' }) => {
    const headers = buildAuthHeaders({ json: true });
    if (!headers || !targetUserId) return null;

    const actionKey = `request:${targetUserId}`;
    setFriendActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/social/friends/request`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetUserId,
          message
        })
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data?.friendship?.friendshipId) {
        window.alert(getApiErrorMessage(parsed, '发送好友申请失败'));
        return null;
      }

      setPanelNotice('好友申请已发送，等待对方处理。');
      await Promise.all([
        fetchFriendRequests(true),
        searchUsers(friendSearchQuery, { silent: true })
      ]);
      return parsed.data.friendship;
    } catch (error) {
      window.alert(`发送好友申请失败: ${error.message}`);
      return null;
    } finally {
      setFriendActionId('');
    }
  }, [
    buildAuthHeaders,
    fetchFriendRequests,
    friendSearchQuery,
    getApiErrorMessage,
    parseApiResponse,
    searchUsers
  ]);

  const removeFriend = useCallback(async (friendshipId) => {
    const headers = buildAuthHeaders();
    const safeFriendshipId = String(friendshipId || '').trim();
    if (!headers || !safeFriendshipId) return null;

    const actionKey = `remove:${safeFriendshipId}`;
    setFriendActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/social/friends/${safeFriendshipId}`, {
        method: 'DELETE',
        headers
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data?.friendship?.friendshipId) {
        window.alert(getApiErrorMessage(parsed, '删除好友失败'));
        return null;
      }

      setPanelNotice('好友关系已删除；若双方没有私聊窗口，系统会补出一个私聊入口并显示当前已非好友。');
      await Promise.all([
        fetchFriendRequests(true),
        fetchFriends(true),
        fetchConversations(true),
        friendSearchQuery ? searchUsers(friendSearchQuery, { silent: true }) : Promise.resolve([])
      ]);
      return parsed.data.friendship;
    } catch (error) {
      window.alert(`删除好友失败: ${error.message}`);
      return null;
    } finally {
      setFriendActionId('');
    }
  }, [
    buildAuthHeaders,
    fetchConversations,
    fetchFriendRequests,
    fetchFriends,
    friendSearchQuery,
    getApiErrorMessage,
    parseApiResponse,
    searchUsers
  ]);

  const respondToFriendRequest = useCallback(async (friendshipId, action) => {
    const headers = buildAuthHeaders({ json: true });
    if (!headers || !friendshipId) return null;

    const actionKey = `${friendshipId}:${action}`;
    setRequestActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/social/friends/${friendshipId}/respond`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action })
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data?.friendship?.friendshipId) {
        const fallbackText = action === 'accept'
          ? '通过好友申请失败'
          : action === 'ignore'
            ? '忽略好友申请失败'
            : '处理好友申请失败';
        window.alert(getApiErrorMessage(parsed, fallbackText));
        return null;
      }

      setPanelNotice(
        action === 'accept'
          ? '好友关系已建立，私聊会在你主动打开时才创建。'
          : action === 'ignore'
            ? '该次好友申请已忽略，对方仍可再次申请或发送临时消息。'
            : '好友申请已拒绝。'
      );
      await Promise.all([
        fetchFriendRequests(true),
        fetchFriends(true),
        friendSearchQuery ? searchUsers(friendSearchQuery, { silent: true }) : Promise.resolve([])
      ]);
      return parsed.data.friendship;
    } catch (error) {
      const errorText = action === 'accept'
        ? '通过好友申请失败'
        : action === 'ignore'
          ? '忽略好友申请失败'
          : '处理好友申请失败';
      window.alert(`${errorText}: ${error.message}`);
      return null;
    } finally {
      setRequestActionId('');
    }
  }, [
    buildAuthHeaders,
    fetchFriendRequests,
    fetchFriends,
    friendSearchQuery,
    getApiErrorMessage,
    parseApiResponse,
    searchUsers
  ]);

  const blockUser = useCallback(async ({ targetUserId, friendshipId = '' } = {}) => {
    const headers = buildAuthHeaders({ json: true });
    const safeTargetUserId = String(targetUserId || '').trim();
    const safeFriendshipId = String(friendshipId || '').trim();
    if (!headers || (!safeTargetUserId && !safeFriendshipId)) return null;

    const actionTarget = safeTargetUserId || safeFriendshipId;
    const actionKey = `block:${actionTarget}`;
    setFriendActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/social/blocks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetUserId: safeTargetUserId,
          friendshipId: safeFriendshipId
        })
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data?.friendship?.friendshipId) {
        window.alert(getApiErrorMessage(parsed, '拉黑用户失败'));
        return null;
      }

      setPanelNotice('对方已加入黑名单，后续不会再收到其好友申请或临时消息。');
      await Promise.all([
        fetchFriendRequests(true),
        fetchFriends(true),
        fetchConversations(true),
        friendSearchQuery ? searchUsers(friendSearchQuery, { silent: true }) : Promise.resolve([])
      ]);
      return parsed.data.friendship;
    } catch (error) {
      window.alert(`拉黑用户失败: ${error.message}`);
      return null;
    } finally {
      setFriendActionId('');
    }
  }, [
    buildAuthHeaders,
    fetchConversations,
    fetchFriendRequests,
    fetchFriends,
    friendSearchQuery,
    getApiErrorMessage,
    parseApiResponse,
    searchUsers
  ]);

  const unblockUser = useCallback(async (targetUserId) => {
    const headers = buildAuthHeaders();
    const safeTargetUserId = String(targetUserId || '').trim();
    if (!headers || !safeTargetUserId) return null;

    const actionKey = `unblock:${safeTargetUserId}`;
    setFriendActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/social/blocks/${safeTargetUserId}`, {
        method: 'DELETE',
        headers
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data?.friendship?.friendshipId) {
        window.alert(getApiErrorMessage(parsed, '解除拉黑失败'));
        return null;
      }

      setPanelNotice('已解除拉黑，对方可再次发送好友申请或临时消息。');
      await Promise.all([
        fetchFriendRequests(true),
        fetchFriends(true),
        fetchConversations(true),
        friendSearchQuery ? searchUsers(friendSearchQuery, { silent: true }) : Promise.resolve([])
      ]);
      return parsed.data.friendship;
    } catch (error) {
      window.alert(`解除拉黑失败: ${error.message}`);
      return null;
    } finally {
      setFriendActionId('');
    }
  }, [
    buildAuthHeaders,
    fetchConversations,
    fetchFriendRequests,
    fetchFriends,
    friendSearchQuery,
    getApiErrorMessage,
    parseApiResponse,
    searchUsers
  ]);

  const loadOlderMessages = useCallback(async (conversationId) => {
    const safeConversationId = normalizeConversationId(conversationId);
    const entry = conversationMessages[safeConversationId] || createEmptyMessagesEntry();
    if (!safeConversationId || entry.loading || !entry.nextBeforeSeq) {
      return null;
    }
    return fetchMessages({
      conversationId: safeConversationId,
      beforeSeq: entry.nextBeforeSeq,
      prepend: true,
      silent: false,
      shouldMarkRead: false
    });
  }, [conversationMessages, fetchMessages]);

  useEffect(() => {
    if (selectedConversationId && !normalizeConversationId(selectedConversationId)) {
      setSelectedConversationId('');
      return;
    }
    if (selectedGroupId && !normalizeConversationId(selectedGroupId)) {
      setSelectedGroupId('');
    }
  }, [selectedConversationId, selectedGroupId]);

  useEffect(() => {
    if (authenticated) {
      fetchConversations(true);
      fetchFriends(true);
      fetchFriendRequests(true);
      fetchGroupInvitations(true);
      return;
    }
    resetChatCenter();
  }, [authenticated, fetchConversations, fetchFriendRequests, fetchFriends, fetchGroupInvitations, resetChatCenter]);

  useEffect(() => {
    if (!authenticated || !isChatDockExpanded) return;
    fetchConversations(false);
    fetchFriends(false);
    fetchFriendRequests(false);
    fetchGroupInvitations(false);
    if (selectedGroupId) {
      fetchGroupDetail(selectedGroupId, { silent: false });
    }
  }, [authenticated, fetchConversations, fetchFriendRequests, fetchFriends, fetchGroupDetail, fetchGroupInvitations, isChatDockExpanded, selectedGroupId]);

  useEffect(() => {
    if (!authenticated || !socket) return undefined;

    const handleIncomingMessage = async (payload = {}) => {
      const conversation = payload?.conversation || null;
      const message = payload?.message || null;
      const conversationId = conversation?.conversationId || message?.conversationId || '';
      const isOwnMessage = String(message?.senderId || '') === String(currentUserId || '');

      if (conversation?.conversationId) {
        setConversations((prev) => upsertConversationRow(prev, conversation));
      }

      if (conversationId && message?._id) {
        updateConversationMessagesEntry(conversationId, (current) => ({
          ...current,
          rows: mergeMessagesAscending(current.rows, [message], 'append'),
          initialized: current.initialized || selectedConversationId === conversationId
        }));
      }

      if (!isOwnMessage && conversationId && (!isChatDockExpanded || selectedConversationId !== conversationId)) {
        const conversationTitle = conversation?.title || message?.sender?.username || '私聊';
        const contentPreview = String(message?.content || '').trim();
        pushChatToast({
          id: `message:${conversationId}`,
          kind: 'conversation',
          tone: 'info',
          title: conversationTitle,
          message: contentPreview ? `${conversationTitle}: ${contentPreview}` : `${conversationTitle} 发来了一条新消息`,
          conversationId
        });
      }

      if (
        conversationId
        && selectedConversationId === conversationId
        && message?._id
        && !isOwnMessage
      ) {
        await markConversationRead(conversationId, Number(message?.seq) || 0);
      }
    };

    const handleConversationRead = (payload = {}) => {
      const conversationId = String(payload?.conversationId || '');
      if (!conversationId) return;
      setConversations((prev) => sortConversations(prev.map((item) => (
        item?.conversationId === conversationId
          ? {
            ...item,
            lastReadSeq: Number(payload?.lastReadSeq) || Number(item?.lastReadSeq) || 0,
            unreadCount: Number(payload?.unreadCount) || 0
          }
          : item
      ))));
    };

    const handleConversationHidden = (payload = {}) => {
      const conversationId = String(payload?.conversationId || '');
      if (!conversationId) return;

      setConversations((prev) => removeConversationRow(prev, conversationId));
      setSelectedConversationId((prev) => (prev === conversationId ? '' : prev));
      setSelectedGroupId((prev) => (prev === conversationId ? '' : prev));
      setSelectedGroupDetail((prev) => (
        prev?.group?.conversationId === conversationId ? null : prev
      ));
      updateConversationMessagesEntry(conversationId, () => ({
        rows: [],
        nextBeforeSeq: 0,
        loading: false,
        error: '',
        initialized: true
      }));
    };

    const handleConversationUpsert = (payload = {}) => {
      const conversation = payload?.conversation || null;
      if (!conversation?.conversationId) return;
      setConversations((prev) => upsertConversationRow(prev, conversation));
    };

    const handleGroupUpdated = async (payload = {}) => {
      const conversationId = String(payload?.conversationId || '');
      if (!conversationId) return;
      if (selectedGroupId === conversationId) {
        await fetchGroupDetail(conversationId, { silent: true });
      }
    };

    const handleFriendRequestCreated = async () => {
      await syncSocialSidebarData();
    };

    const handleFriendRequestResponded = async () => {
      await syncSocialSidebarData();
    };

    const handleRelationshipUpdated = async () => {
      await Promise.all([
        syncSocialSidebarData(),
        fetchConversations(true)
      ]);
    };

    const handleGroupInvitationUpdated = async (payload = {}) => {
      await fetchGroupInvitations(true);
      const conversationId = String(payload?.conversationId || '');
      if (conversationId && selectedGroupId === conversationId) {
        await fetchGroupDetail(conversationId, { silent: true });
      }
      await fetchConversations(true);
    };

    socket.on('chat:message', handleIncomingMessage);
    socket.on('chat:conversation-upsert', handleConversationUpsert);
    socket.on('chat:conversation-read', handleConversationRead);
    socket.on('chat:conversation-hidden', handleConversationHidden);
    socket.on('chat:group-updated', handleGroupUpdated);
    socket.on('social:friend-request-created', handleFriendRequestCreated);
    socket.on('social:friend-request-responded', handleFriendRequestResponded);
    socket.on('social:relationship-updated', handleRelationshipUpdated);
    socket.on('chat:group-invitation-updated', handleGroupInvitationUpdated);

    return () => {
      socket.off('chat:message', handleIncomingMessage);
      socket.off('chat:conversation-upsert', handleConversationUpsert);
      socket.off('chat:conversation-read', handleConversationRead);
      socket.off('chat:conversation-hidden', handleConversationHidden);
      socket.off('chat:group-updated', handleGroupUpdated);
      socket.off('social:friend-request-created', handleFriendRequestCreated);
      socket.off('social:friend-request-responded', handleFriendRequestResponded);
      socket.off('social:relationship-updated', handleRelationshipUpdated);
      socket.off('chat:group-invitation-updated', handleGroupInvitationUpdated);
    };
  }, [
    authenticated,
    currentUserId,
    fetchConversations,
    fetchGroupDetail,
    fetchGroupInvitations,
    isChatDockExpanded,
    markConversationRead,
    pushChatToast,
    selectedConversationId,
    selectedGroupId,
    syncSocialSidebarData,
    socket,
    updateConversationMessagesEntry
  ]);

  useEffect(() => () => {
    toastTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    toastTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!authenticated) return undefined;

    const syncChatSnapshot = async () => {
      await Promise.all([
        fetchConversations(true),
        fetchFriendRequests(true),
        fetchFriends(true),
        fetchGroupInvitations(true)
      ]);

      if (isChatDockExpanded && selectedConversationId) {
        await fetchMessages({
          conversationId: selectedConversationId,
          beforeSeq: 0,
          prepend: false,
          silent: true,
          shouldMarkRead: true
        });
      }

      if (isChatDockExpanded && selectedGroupId) {
        await fetchGroupDetail(selectedGroupId, { silent: true });
      }
    };

    const intervalId = window.setInterval(syncChatSnapshot, isChatDockExpanded ? 15000 : 60000);
    return () => window.clearInterval(intervalId);
  }, [
    authenticated,
    fetchConversations,
    fetchFriendRequests,
    fetchFriends,
    fetchGroupInvitations,
    fetchGroupDetail,
    fetchMessages,
    isChatDockExpanded,
    selectedConversationId,
    selectedGroupId
  ]);

  const selectedConversation = useMemo(() => (
    conversations.find((item) => item?.conversationId === selectedConversationId) || null
  ), [conversations, selectedConversationId]);

  const groups = useMemo(() => (
    conversations.filter((item) => item?.type === 'group')
  ), [conversations]);

  const selectedMessagesEntry = useMemo(() => (
    selectedConversationId
      ? (conversationMessages[selectedConversationId] || createEmptyMessagesEntry())
      : createEmptyMessagesEntry()
  ), [conversationMessages, selectedConversationId]);

  useEffect(() => {
    if (!selectedGroupId) {
      setSelectedGroupDetail(null);
    }
  }, [selectedGroupId]);

  const unreadConversationCount = useMemo(() => (
    conversations.reduce((sum, item) => sum + Math.max(0, Number(item?.unreadCount) || 0), 0)
  ), [conversations]);

  const pendingRequestCount = useMemo(() => (
    Array.isArray(friendRequests.received) ? friendRequests.received.length : 0
  ), [friendRequests.received]);

  const pendingGroupInvitationCount = useMemo(() => (
    Array.isArray(groupInvites.received) ? groupInvites.received.length : 0
  ), [groupInvites.received]);

  const chatBadgeCount = unreadConversationCount + pendingRequestCount + pendingGroupInvitationCount;

  return {
    activeSidebarTab,
    blockedUsers,
    blockUser,
    chatBadgeCount,
    chatToasts,
    conversationActionId,
    conversationListLoading,
    dismissChatToast,
    conversations,
    createGroupConversation,
    currentUserId,
    fetchGroupDetail,
    fetchConversations,
    fetchFriendRequests,
    fetchFriends,
    friendActionId,
    friendListLoading,
    friendRequests,
    friendSearchLoading,
    friendSearchQuery,
    friendSearchResults,
    friends,
    groupActionId,
    groupDetailLoading,
    groupInviteActionId,
    groupInviteListLoading,
    groupInviteSearchLoading,
    groupInviteSearchQuery,
    groupInviteSearchResults,
    groupInvites,
    groups,
    hideConversation,
    inviteGroupMembers,
    isChatDockExpanded,
    isRequestsModalOpen,
    leaveGroupConversation,
    loadOlderMessages,
    openGroupDetail,
    openConversation,
    openDirectConversation,
    addGroupMembers,
    panelNotice,
    pendingGroupInvitationCount,
    pendingRequestCount,
    removeFriend,
    requestActionId,
    requestFriendship,
    requestListLoading,
    removeGroupMember,
    resetChatCenter,
    respondToFriendRequest,
    respondToGroupInvitation,
    searchUsers,
    searchGroupInviteUsers,
    selectedConversation,
    selectedConversationId,
    selectedGroupDetail,
    selectedGroupId,
    selectedMessagesEntry,
    sendMessage,
    setActiveSidebarTab,
    setFriendSearchQuery,
    setGroupInviteSearchQuery,
    setSelectedGroupId,
    setIsChatDockExpanded,
    setIsRequestsModalOpen,
    setPanelNotice,
    setSelectedConversationId,
    transferGroupOwnership,
    unblockUser,
    unreadConversationCount,
    updateGroupConversation
  };
};

export default useChatCenter;
