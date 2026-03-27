import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../runtimeConfig';

const DEFAULT_MESSAGE_PAGE_SIZE = 30;

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
  const [activeSidebarTab, setActiveSidebarTab] = useState('conversations');
  const [conversations, setConversations] = useState([]);
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState({ received: [], sent: [] });
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [conversationMessages, setConversationMessages] = useState({});
  const [conversationListLoading, setConversationListLoading] = useState(false);
  const [friendListLoading, setFriendListLoading] = useState(false);
  const [requestListLoading, setRequestListLoading] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState([]);
  const [friendSearchLoading, setFriendSearchLoading] = useState(false);
  const [panelNotice, setPanelNotice] = useState('');
  const [conversationActionId, setConversationActionId] = useState('');
  const [friendActionId, setFriendActionId] = useState('');
  const [requestActionId, setRequestActionId] = useState('');
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
    setActiveSidebarTab('conversations');
    setConversations([]);
    setFriends([]);
    setFriendRequests({ received: [], sent: [] });
    setSelectedConversationId('');
    setConversationMessages({});
    setConversationListLoading(false);
    setFriendListLoading(false);
    setRequestListLoading(false);
    setFriendSearchQuery('');
    setFriendSearchResults([]);
    setFriendSearchLoading(false);
    setPanelNotice('');
    setConversationActionId('');
    setFriendActionId('');
    setRequestActionId('');
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
      if (!response.ok || !rows) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取好友列表失败'));
        }
        return null;
      }

      setFriends(rows);
      return rows;
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

  const markConversationRead = useCallback(async (conversationId, lastReadSeq = 0) => {
    const headers = buildAuthHeaders({ json: true });
    if (!headers || !conversationId) return null;

    try {
      const response = await fetch(`${API_BASE}/chat/conversations/${conversationId}/read`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ lastReadSeq })
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data?.conversationId) {
        return null;
      }

      setConversations((prev) => sortConversations(prev.map((item) => (
        item?.conversationId === conversationId
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
    const headers = buildAuthHeaders();
    if (!headers || !conversationId) return null;

    updateConversationMessagesEntry(conversationId, (current) => ({
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
      const response = await fetch(`${API_BASE}/chat/conversations/${conversationId}/messages?${query.toString()}`, {
        headers
      });
      const parsed = await parseApiResponse(response);
      const rows = Array.isArray(parsed.data?.rows) ? parsed.data.rows : null;
      const nextBeforeSeq = Number(parsed.data?.nextBeforeSeq) || 0;
      if (!response.ok || !rows) {
        updateConversationMessagesEntry(conversationId, (current) => ({
          ...current,
          loading: false,
          error: getApiErrorMessage(parsed, '获取聊天记录失败'),
          initialized: true
        }));
        return null;
      }

      let mergedRows = rows;
      updateConversationMessagesEntry(conversationId, (current) => {
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
        const activeConversation = conversations.find((item) => item?.conversationId === conversationId) || null;
        if (latestSeq > 0 && (
          latestSeq > (Number(activeConversation?.lastReadSeq) || 0)
          || (Number(activeConversation?.unreadCount) || 0) > 0
        )) {
          markConversationRead(conversationId, latestSeq);
        }
      }

      return {
        rows: mergedRows,
        nextBeforeSeq
      };
    } catch (error) {
      updateConversationMessagesEntry(conversationId, (current) => ({
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
    if (!conversationId) return null;
    setActiveSidebarTab('conversations');
    setSelectedConversationId(conversationId);
    return fetchMessages({
      conversationId,
      beforeSeq: 0,
      prepend: false,
      silent: false,
      shouldMarkRead: true
    });
  }, [fetchMessages]);

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

  const sendMessage = useCallback(async (conversationId, content) => {
    const headers = buildAuthHeaders({ json: true });
    const messageContent = String(content || '').trim();
    if (!headers || !conversationId) return null;
    if (!messageContent) return null;

    const actionKey = `send:${conversationId}`;
    setConversationActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/chat/conversations/${conversationId}/messages`, {
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
      if (!response.ok || !message?._id) {
        window.alert(getApiErrorMessage(parsed, '发送消息失败'));
        return null;
      }

      updateConversationMessagesEntry(conversationId, (current) => ({
        ...current,
        rows: mergeMessagesAscending(current.rows, [message], 'append'),
        initialized: true
      }));

      setConversations((prev) => {
        const currentConversation = prev.find((item) => item?.conversationId === conversationId);
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

      return message;
    } catch (error) {
      window.alert(`发送消息失败: ${error.message}`);
      return null;
    } finally {
      setConversationActionId('');
    }
  }, [buildAuthHeaders, getApiErrorMessage, parseApiResponse, updateConversationMessagesEntry]);

  const hideConversation = useCallback(async (conversationId) => {
    const headers = buildAuthHeaders();
    if (!headers || !conversationId) return null;

    const actionKey = `hide:${conversationId}`;
    setConversationActionId(actionKey);
    try {
      const response = await fetch(`${API_BASE}/chat/conversations/${conversationId}`, {
        method: 'DELETE',
        headers
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data?.conversationHiddenForCurrentUser) {
        window.alert(getApiErrorMessage(parsed, '删除聊天失败'));
        return null;
      }

      setConversations((prev) => removeConversationRow(prev, conversationId));
      setSelectedConversationId((prev) => (prev === conversationId ? '' : prev));
      updateConversationMessagesEntry(conversationId, () => ({
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
        window.alert(getApiErrorMessage(parsed, action === 'accept' ? '通过好友申请失败' : '拒绝好友申请失败'));
        return null;
      }

      setPanelNotice(action === 'accept' ? '好友关系已建立，私聊会在你主动打开时才创建。' : '好友申请已拒绝。');
      await Promise.all([
        fetchFriendRequests(true),
        fetchFriends(true),
        friendSearchQuery ? searchUsers(friendSearchQuery, { silent: true }) : Promise.resolve([])
      ]);
      return parsed.data.friendship;
    } catch (error) {
      window.alert(`${action === 'accept' ? '通过好友申请失败' : '拒绝好友申请失败'}: ${error.message}`);
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

  const loadOlderMessages = useCallback(async (conversationId) => {
    const entry = conversationMessages[conversationId] || createEmptyMessagesEntry();
    if (!conversationId || entry.loading || !entry.nextBeforeSeq) {
      return null;
    }
    return fetchMessages({
      conversationId,
      beforeSeq: entry.nextBeforeSeq,
      prepend: true,
      silent: false,
      shouldMarkRead: false
    });
  }, [conversationMessages, fetchMessages]);

  useEffect(() => {
    if (authenticated) {
      fetchConversations(true);
      fetchFriends(true);
      fetchFriendRequests(true);
      return;
    }
    resetChatCenter();
  }, [authenticated, fetchConversations, fetchFriendRequests, fetchFriends, resetChatCenter]);

  useEffect(() => {
    if (!authenticated || !isChatDockExpanded) return;
    fetchConversations(false);
    fetchFriends(false);
    fetchFriendRequests(false);
  }, [authenticated, fetchConversations, fetchFriendRequests, fetchFriends, isChatDockExpanded]);

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
      updateConversationMessagesEntry(conversationId, () => ({
        rows: [],
        nextBeforeSeq: 0,
        loading: false,
        error: '',
        initialized: true
      }));
    };

    const handleFriendRequestCreated = async (payload = {}) => {
      await syncSocialSidebarData();

      if (String(payload?.requester?._id || '') === String(currentUserId || '')) {
        return;
      }

      const requesterName = payload?.requester?.username || '有玩家';
      pushChatToast({
        id: `friend-request:${payload?.friendship?.friendshipId || requesterName}`,
        kind: 'friend-request',
        tone: 'success',
        title: '新的好友申请',
        message: `${requesterName} 向你发送了好友申请`,
        friendshipId: payload?.friendship?.friendshipId || ''
      });
    };

    const handleFriendRequestResponded = async (payload = {}) => {
      await syncSocialSidebarData();

      const friendshipStatus = String(payload?.friendship?.status || '').trim();
      const requesterId = String(payload?.requester?._id || '');
      const addresseeName = payload?.addressee?.username || '对方';
      const requesterName = payload?.requester?.username || '对方';

      if (requesterId === String(currentUserId || '')) {
        pushChatToast({
          id: `friend-response:${payload?.friendship?.friendshipId || friendshipStatus}`,
          kind: 'friend-response',
          tone: friendshipStatus === 'accepted' ? 'success' : 'muted',
          title: friendshipStatus === 'accepted' ? '好友申请已通过' : '好友申请被拒绝',
          message: friendshipStatus === 'accepted'
            ? `${addresseeName} 已同意你的好友申请`
            : `${addresseeName} 已拒绝你的好友申请`,
          friendshipId: payload?.friendship?.friendshipId || ''
        });
        return;
      }

      if (friendshipStatus === 'accepted') {
        pushChatToast({
          id: `friend-response:${payload?.friendship?.friendshipId || friendshipStatus}`,
          kind: 'friend-response',
          tone: 'success',
          title: '好友已添加',
          message: `你已和 ${requesterName} 成为好友`,
          friendshipId: payload?.friendship?.friendshipId || ''
        });
      }
    };

    socket.on('chat:message', handleIncomingMessage);
    socket.on('chat:conversation-read', handleConversationRead);
    socket.on('chat:conversation-hidden', handleConversationHidden);
    socket.on('social:friend-request-created', handleFriendRequestCreated);
    socket.on('social:friend-request-responded', handleFriendRequestResponded);

    return () => {
      socket.off('chat:message', handleIncomingMessage);
      socket.off('chat:conversation-read', handleConversationRead);
      socket.off('chat:conversation-hidden', handleConversationHidden);
      socket.off('social:friend-request-created', handleFriendRequestCreated);
      socket.off('social:friend-request-responded', handleFriendRequestResponded);
    };
  }, [
    authenticated,
    currentUserId,
    isChatDockExpanded,
    markConversationRead,
    pushChatToast,
    selectedConversationId,
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
        fetchFriends(true)
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
    };

    const intervalId = window.setInterval(syncChatSnapshot, isChatDockExpanded ? 15000 : 60000);
    return () => window.clearInterval(intervalId);
  }, [
    authenticated,
    fetchConversations,
    fetchFriendRequests,
    fetchFriends,
    fetchMessages,
    isChatDockExpanded,
    selectedConversationId
  ]);

  const selectedConversation = useMemo(() => (
    conversations.find((item) => item?.conversationId === selectedConversationId) || null
  ), [conversations, selectedConversationId]);

  const selectedMessagesEntry = useMemo(() => (
    selectedConversationId
      ? (conversationMessages[selectedConversationId] || createEmptyMessagesEntry())
      : createEmptyMessagesEntry()
  ), [conversationMessages, selectedConversationId]);

  const unreadConversationCount = useMemo(() => (
    conversations.reduce((sum, item) => sum + Math.max(0, Number(item?.unreadCount) || 0), 0)
  ), [conversations]);

  const pendingRequestCount = useMemo(() => (
    Array.isArray(friendRequests.received) ? friendRequests.received.length : 0
  ), [friendRequests.received]);

  const chatBadgeCount = unreadConversationCount + pendingRequestCount;

  return {
    activeSidebarTab,
    chatBadgeCount,
    chatToasts,
    conversationActionId,
    conversationListLoading,
    dismissChatToast,
    conversations,
    currentUserId,
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
    hideConversation,
    isChatDockExpanded,
    loadOlderMessages,
    openConversation,
    openDirectConversation,
    panelNotice,
    pendingRequestCount,
    requestActionId,
    requestFriendship,
    requestListLoading,
    resetChatCenter,
    respondToFriendRequest,
    searchUsers,
    selectedConversation,
    selectedConversationId,
    selectedMessagesEntry,
    sendMessage,
    setActiveSidebarTab,
    setFriendSearchQuery,
    setIsChatDockExpanded,
    setPanelNotice,
    setSelectedConversationId,
    unreadConversationCount
  };
};

export default useChatCenter;
