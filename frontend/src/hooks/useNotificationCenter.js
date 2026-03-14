import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../runtimeConfig';
import { isAnnouncementNotification } from '../app/appShared';

const sortByCreatedAtDesc = (items = []) => (
  [...items].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
);

const useNotificationCenter = ({
  authenticated,
  isAdmin,
  parseApiResponse,
  getApiErrorMessage
}) => {
  const [notifications, setNotifications] = useState([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(false);
  const [isClearingNotifications, setIsClearingNotifications] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [isMarkingAnnouncementsRead, setIsMarkingAnnouncementsRead] = useState(false);
  const [notificationActionId, setNotificationActionId] = useState('');
  const [adminPendingNodes, setAdminPendingNodes] = useState([]);

  const resetNotificationCenter = useCallback(() => {
    setNotifications([]);
    setNotificationUnreadCount(0);
    setIsNotificationsLoading(false);
    setIsClearingNotifications(false);
    setIsMarkingAllRead(false);
    setIsMarkingAnnouncementsRead(false);
    setNotificationActionId('');
    setAdminPendingNodes([]);
  }, []);

  const fetchNotifications = useCallback(async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    if (!silent) {
      setIsNotificationsLoading(true);
    }

    try {
      const response = await fetch(`${API_BASE}/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取通知失败'));
        }
        return null;
      }

      setNotifications(data.notifications || []);
      setNotificationUnreadCount(data.unreadCount || 0);
      return data;
    } catch (error) {
      if (!silent) {
        window.alert(`获取通知失败: ${error.message}`);
      }
      return null;
    } finally {
      if (!silent) {
        setIsNotificationsLoading(false);
      }
    }
  }, [getApiErrorMessage, parseApiResponse]);

  const fetchAdminPendingNodeReminders = useCallback(async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token || !isAdmin) {
      setAdminPendingNodes([]);
      return [];
    }

    try {
      const response = await fetch(`${API_BASE}/nodes/pending`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !Array.isArray(data)) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取待审批创建申请失败'));
        }
        return [];
      }

      setAdminPendingNodes(data);
      return data;
    } catch (error) {
      if (!silent) {
        window.alert(`获取待审批创建申请失败: ${error.message}`);
      }
      return [];
    }
  }, [getApiErrorMessage, isAdmin, parseApiResponse]);

  const markNotificationRead = useCallback(async (notificationId) => {
    const token = localStorage.getItem('token');
    if (!token || !notificationId) return;
    const target = notifications.find((item) => item._id === notificationId);
    if (target?.read) return;

    try {
      const response = await fetch(`${API_BASE}/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        window.alert(getApiErrorMessage(parsed, '标记已读失败'));
        return;
      }

      setNotifications((prev) => prev.map((item) => (
        item._id === notificationId ? { ...item, read: true } : item
      )));
      if (!target?.read) {
        setNotificationUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      window.alert(`标记已读失败: ${error.message}`);
    }
  }, [getApiErrorMessage, notifications, parseApiResponse]);

  const markAllNotificationsRead = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || notificationUnreadCount <= 0) return;

    setIsMarkingAllRead(true);
    try {
      const response = await fetch(`${API_BASE}/notifications/read-all`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data) {
        return;
      }

      setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
      setNotificationUnreadCount(0);
    } catch (_error) {
      // 忽略提示，避免打断用户
    } finally {
      setIsMarkingAllRead(false);
    }
  }, [notificationUnreadCount, parseApiResponse]);

  const markAnnouncementNotificationsRead = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || isMarkingAnnouncementsRead) return;

    const unreadAnnouncementIds = notifications
      .filter((notification) => (
        isAnnouncementNotification(notification)
        && !notification.read
        && notification._id
      ))
      .map((notification) => notification._id);

    if (unreadAnnouncementIds.length === 0) {
      return;
    }

    setIsMarkingAnnouncementsRead(true);
    setNotifications((prev) => prev.map((item) => (
      isAnnouncementNotification(item) ? { ...item, read: true } : item
    )));
    setNotificationUnreadCount((prev) => Math.max(0, prev - unreadAnnouncementIds.length));

    try {
      await Promise.all(unreadAnnouncementIds.map(async (notificationId) => {
        const response = await fetch(`${API_BASE}/notifications/${notificationId}/read`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!response.ok) {
          throw new Error('标记公告已读失败');
        }
      }));
    } catch (_error) {
      await fetchNotifications(true);
      if (isAdmin) {
        await fetchAdminPendingNodeReminders(true);
      }
    } finally {
      setIsMarkingAnnouncementsRead(false);
    }
  }, [
    fetchAdminPendingNodeReminders,
    fetchNotifications,
    isAdmin,
    isMarkingAnnouncementsRead,
    notifications
  ]);

  const clearNotifications = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || !notifications.length) return;

    setIsClearingNotifications(true);
    try {
      const response = await fetch(`${API_BASE}/notifications/clear`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        window.alert(getApiErrorMessage(parsed, '清空通知失败'));
        return;
      }

      await fetchNotifications(true);
      if (isAdmin) {
        await fetchAdminPendingNodeReminders(true);
      }
    } catch (error) {
      window.alert(`清空通知失败: ${error.message}`);
    } finally {
      setIsClearingNotifications(false);
    }
  }, [
    fetchAdminPendingNodeReminders,
    fetchNotifications,
    getApiErrorMessage,
    isAdmin,
    notifications.length,
    parseApiResponse
  ]);

  const respondDomainAdminInvite = useCallback(async (notificationId, action) => {
    const token = localStorage.getItem('token');
    if (!token || !notificationId) return;

    const actionKey = `${notificationId}:${action}`;
    setNotificationActionId(actionKey);

    try {
      const response = await fetch(`${API_BASE}/notifications/${notificationId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        window.alert(getApiErrorMessage(parsed, '处理失败'));
        return;
      }

      window.alert(data.message || '处理完成');
      await fetchNotifications(true);
    } catch (error) {
      window.alert(`处理失败: ${error.message}`);
    } finally {
      setNotificationActionId('');
    }
  }, [fetchNotifications, getApiErrorMessage, parseApiResponse]);

  useEffect(() => {
    if (!authenticated) {
      resetNotificationCenter();
      return;
    }

    fetchNotifications(true);
    if (isAdmin) {
      fetchAdminPendingNodeReminders(true);
    } else {
      setAdminPendingNodes([]);
    }

    const timer = setInterval(() => {
      fetchNotifications(true);
      if (isAdmin) {
        fetchAdminPendingNodeReminders(true);
      }
    }, 8000);

    return () => clearInterval(timer);
  }, [authenticated, fetchAdminPendingNodeReminders, fetchNotifications, isAdmin, resetNotificationCenter]);

  const pendingMasterApplyCount = useMemo(() => (
    notifications.filter((notification) => (
      notification.type === 'domain_master_apply' && notification.status === 'pending'
    )).length
  ), [notifications]);

  const systemAnnouncements = useMemo(() => (
    sortByCreatedAtDesc(
      notifications.filter((notification) => notification.type === 'domain_distribution_announcement')
    ).slice(0, 10)
  ), [notifications]);

  const allianceAnnouncements = useMemo(() => (
    sortByCreatedAtDesc(
      notifications.filter((notification) => notification.type === 'alliance_announcement')
    ).slice(0, 10)
  ), [notifications]);

  const announcementUnreadCount = useMemo(() => (
    notifications.filter((notification) => (
      isAnnouncementNotification(notification) && !notification.read
    )).length
  ), [notifications]);

  const adminPendingApprovalCount = pendingMasterApplyCount + adminPendingNodes.length;
  const notificationBadgeCount = isAdmin ? adminPendingApprovalCount : notificationUnreadCount;

  return {
    notifications,
    notificationUnreadCount,
    isNotificationsLoading,
    isClearingNotifications,
    isMarkingAllRead,
    isMarkingAnnouncementsRead,
    notificationActionId,
    adminPendingNodes,
    pendingMasterApplyCount,
    systemAnnouncements,
    allianceAnnouncements,
    announcementUnreadCount,
    adminPendingApprovalCount,
    notificationBadgeCount,
    fetchNotifications,
    fetchAdminPendingNodeReminders,
    markNotificationRead,
    markAllNotificationsRead,
    markAnnouncementNotificationsRead,
    clearNotifications,
    respondDomainAdminInvite,
    resetNotificationCenter
  };
};

export default useNotificationCenter;
