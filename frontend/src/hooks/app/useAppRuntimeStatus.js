import { useCallback, useEffect } from 'react';
import { API_BASE } from '../../runtimeConfig';
import {
  createDefaultHeaderUserStats,
  normalizeObjectId,
  normalizeSiegeUnitEntries
} from '../../app/appShared';

const useAppRuntimeStatus = ({
  authenticated,
  isAdmin,
  socket,
  parseApiResponse,
  getApiErrorMessage,
  syncUserLocation,
  applyTravelStatus,
  fetchLocationNodeDetail,
  isLocationDockExpandedRef,
  travelStatusRef,
  fetchNotifications,
  fetchAdminPendingNodeReminders,
  setHeaderUserStats,
  setTravelStatus,
  setSiegeSupportStatuses
}) => {
  const fetchHeaderUserStats = useCallback(async ({ silent = true } = {}) => {
    const token = localStorage.getItem('token');
    if (!token || !authenticated) return null;

    if (!silent) {
      setHeaderUserStats((prev) => ({ ...prev, loading: true }));
    }

    try {
      const [profileResponse, armyResponse] = await Promise.all([
        fetch(`${API_BASE}/profile`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${API_BASE}/army/me`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      const [profileParsed, armyParsed] = await Promise.all([
        parseApiResponse(profileResponse),
        parseApiResponse(armyResponse)
      ]);

      const profileData = profileParsed.data && profileResponse.ok ? profileParsed.data : null;
      const armyData = armyParsed.data && armyResponse.ok ? armyParsed.data : null;

      const levelValue = Number(profileData?.level);
      const experienceValue = Number(profileData?.experience);
      const knowledgeBalanceValue = Number(
        Number.isFinite(Number(profileData?.knowledgeBalance))
          ? profileData.knowledgeBalance
          : armyData?.knowledgeBalance
      );
      const armyCountValue = (Array.isArray(armyData?.roster) ? armyData.roster : []).reduce((sum, entry) => (
        sum + Math.max(0, Math.floor(Number(entry?.count) || 0))
      ), 0);

      const nextStats = {
        loading: false,
        level: Number.isFinite(levelValue) ? Math.max(0, Math.floor(levelValue)) : 0,
        experience: Number.isFinite(experienceValue) ? Math.max(0, Math.floor(experienceValue)) : 0,
        knowledgeBalance: Number.isFinite(knowledgeBalanceValue) ? Math.max(0, knowledgeBalanceValue) : 0,
        armyCount: Number.isFinite(armyCountValue) ? Math.max(0, Math.floor(armyCountValue)) : 0
      };
      setHeaderUserStats(nextStats);
      return nextStats;
    } catch (_error) {
      setHeaderUserStats((prev) => ({ ...prev, loading: false }));
      return null;
    }
  }, [authenticated, parseApiResponse, setHeaderUserStats]);

  const fetchSiegeSupportStatuses = useCallback(async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token || !authenticated || isAdmin) {
      if (!silent) {
        setSiegeSupportStatuses([]);
      }
      return null;
    }

    try {
      const response = await fetch(`${API_BASE}/nodes/me/siege-supports`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取围城支援状态失败'));
        }
        return null;
      }
      const supports = Array.isArray(parsed.data.supports)
        ? parsed.data.supports.map((item) => ({
          nodeId: normalizeObjectId(item?.nodeId),
          nodeName: typeof item?.nodeName === 'string' ? item.nodeName : '',
          gateKey: typeof item?.gateKey === 'string' ? item.gateKey : '',
          gateLabel: typeof item?.gateLabel === 'string' ? item.gateLabel : '',
          status: typeof item?.status === 'string' ? item.status : '',
          statusLabel: typeof item?.statusLabel === 'string' ? item.statusLabel : '',
          totalCount: Math.max(0, Math.floor(Number(item?.totalCount) || 0)),
          remainingSeconds: Math.max(0, Math.floor(Number(item?.remainingSeconds) || 0)),
          fromNodeName: typeof item?.fromNodeName === 'string' ? item.fromNodeName : '',
          autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(item?.autoRetreatPercent) || 40))),
          units: normalizeSiegeUnitEntries(item?.units),
          requestedAt: item?.requestedAt || null,
          arriveAt: item?.arriveAt || null
        }))
        : [];
      setSiegeSupportStatuses(supports);
      return supports;
    } catch (error) {
      if (!silent) {
        window.alert(`获取围城支援状态失败: ${error.message}`);
      }
      return null;
    }
  }, [
    authenticated,
    getApiErrorMessage,
    isAdmin,
    parseApiResponse,
    setSiegeSupportStatuses
  ]);

  const fetchTravelStatus = useCallback(async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const response = await fetch(`${API_BASE}/travel/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取移动状态失败'));
        }
        return null;
      }

      if (!data) {
        if (!silent) {
          window.alert('获取移动状态失败：返回数据不是 JSON');
        }
        return null;
      }

      const currentStoredLocation = localStorage.getItem('userLocation') || '';
      if (typeof data.location === 'string' && data.location !== currentStoredLocation) {
        syncUserLocation(data.location);
      }

      const nextTravel = data.travel || { isTraveling: false };
      const prevTravel = travelStatusRef.current || { isTraveling: false, isStopping: false };
      applyTravelStatus(nextTravel);
      const justArrivedAtDestination = !!prevTravel.isTraveling && !prevTravel.isStopping && !nextTravel.isTraveling;
      if (justArrivedAtDestination && isLocationDockExpandedRef.current && !isAdmin) {
        const storedLocation = localStorage.getItem('userLocation') || '';
        const locationName = storedLocation.trim();
        if (locationName && locationName !== '任意') {
          fetchLocationNodeDetail(locationName, { silent: false });
        }
      }
      return data;
    } catch (error) {
      if (!silent) {
        window.alert(`获取移动状态失败: ${error.message}`);
      }
      return null;
    }
  }, [
    applyTravelStatus,
    fetchLocationNodeDetail,
    getApiErrorMessage,
    isAdmin,
    isLocationDockExpandedRef,
    parseApiResponse,
    syncUserLocation,
    travelStatusRef
  ]);

  useEffect(() => {
    if (!authenticated) {
      setHeaderUserStats(createDefaultHeaderUserStats());
      return undefined;
    }

    fetchHeaderUserStats({ silent: true });
    const timerId = setInterval(() => {
      fetchHeaderUserStats({ silent: true });
    }, 30000);

    return () => {
      clearInterval(timerId);
    };
  }, [authenticated, fetchHeaderUserStats, setHeaderUserStats]);

  useEffect(() => {
    if (!authenticated) return undefined;

    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchHeaderUserStats({ silent: true });
      }
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);

    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [authenticated, fetchHeaderUserStats]);

  useEffect(() => {
    if (!authenticated || isAdmin) {
      setTravelStatus({ isTraveling: false });
      travelStatusRef.current = { isTraveling: false, isStopping: false };
      return;
    }

    fetchTravelStatus(true);
    const timer = setInterval(() => {
      fetchTravelStatus(true);
    }, 1000);

    return () => clearInterval(timer);
  }, [authenticated, fetchTravelStatus, isAdmin, setTravelStatus, travelStatusRef]);

  useEffect(() => {
    if (!authenticated || isAdmin) {
      setSiegeSupportStatuses([]);
      return;
    }

    fetchSiegeSupportStatuses(true);
    const timer = setInterval(() => {
      fetchSiegeSupportStatuses(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [authenticated, fetchSiegeSupportStatuses, isAdmin, setSiegeSupportStatuses]);

  useEffect(() => {
    if (!socket) return;

    const handleAdminSyncPending = async () => {
      if (!authenticated || !isAdmin) return;
      await fetchNotifications(true);
      await fetchAdminPendingNodeReminders(true);
    };

    socket.on('admin-sync-pending', handleAdminSyncPending);
    return () => {
      socket.off('admin-sync-pending', handleAdminSyncPending);
    };
  }, [
    authenticated,
    fetchAdminPendingNodeReminders,
    fetchNotifications,
    isAdmin,
    socket
  ]);

  return {
    fetchTravelStatus,
    fetchSiegeSupportStatuses
  };
};

export default useAppRuntimeStatus;
