import { useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../../runtimeConfig';
import {
  AUTH_EXPIRED_EVENT,
  LOCAL_DEVELOPMENT_HOSTS,
  LOCALHOST_STORAGE_RESET_KEY,
  LOCALHOST_STORAGE_RESET_VERSION,
  clearStoredAuthState,
  clearStoredLocalhostRuntimeState,
  decodeUserIdFromToken,
  normalizeObjectId
} from '../../app/appShared';

const useAppSession = ({
  authenticated,
  hasRestoredPageRef,
  isRestoringPageRef,
  initializeSocket,
  cleanupSocket,
  resetAppNavigationStateToHome,
  applyTravelStatus,
  fetchTravelStatus,
  fetchFeaturedNodes,
  updateUserLocation,
  resetNotificationCenter,
  resetChatCenter,
  resetAppShellState,
  resetDistributionState,
  resetDomainConflictState,
  setAuthenticated,
  setUserId,
  setUsername,
  setProfession,
  setUserLocation,
  setUserAvatar,
  setIsAdmin,
  setView,
  setShowLocationModal,
  setAdminEntryTab,
  setIsStoppingTravel,
  setIsApplyingDomainMaster,
  setCurrentLocationNodeDetail,
  setSelectedLocationNode,
  setSiegeSupportStatuses,
  setNodes
}) => {
  const resetStoredSessionState = useCallback(() => {
    clearStoredAuthState();
    hasRestoredPageRef.current = false;
    isRestoringPageRef.current = false;
    setAuthenticated(false);
    setUserId('');
    setUsername('');
    setProfession('');
    setUserLocation('');
    setUserAvatar('default_male_1');
    setIsAdmin(false);
    setShowLocationModal(false);
    setView('login');
  }, [
    hasRestoredPageRef,
    isRestoringPageRef,
    setAuthenticated,
    setIsAdmin,
    setProfession,
    setShowLocationModal,
    setUserAvatar,
    setUserId,
    setUserLocation,
    setUsername,
    setView
  ]);

  const checkAdminStatus = useCallback(async () => {
    const token = localStorage.getItem('token');
    const storedUserRole = localStorage.getItem('userRole');
    if (!token) return;
    if (storedUserRole && storedUserRole !== 'admin') {
      setIsAdmin(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/admin/users`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      setIsAdmin(response.ok);
    } catch (_error) {
      console.log('非管理员用户');
      setIsAdmin(false);
    }
  }, [setIsAdmin]);

  const sessionBootstrapRef = useRef({
    checkAdminStatus,
    fetchFeaturedNodes,
    setAuthenticated,
    setUserId,
    setUsername,
    setProfession,
    setUserLocation,
    setUserAvatar,
    setIsAdmin,
    setShowLocationModal,
    setView
  });
  sessionBootstrapRef.current = {
    checkAdminStatus,
    fetchFeaturedNodes,
    setAuthenticated,
    setUserId,
    setUsername,
    setProfession,
    setUserLocation,
    setUserAvatar,
    setIsAdmin,
    setShowLocationModal,
    setView
  };

  useEffect(() => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    const currentHostname = String(window.location.hostname || '').trim().toLowerCase();
    if (!LOCAL_DEVELOPMENT_HOSTS.has(currentHostname)) return;

    const currentVersion = localStorage.getItem(LOCALHOST_STORAGE_RESET_KEY);
    if (currentVersion === LOCALHOST_STORAGE_RESET_VERSION) {
      return;
    }

    clearStoredLocalhostRuntimeState();
    localStorage.setItem(LOCALHOST_STORAGE_RESET_KEY, LOCALHOST_STORAGE_RESET_VERSION);
  }, []);

  useEffect(() => {
    const {
      checkAdminStatus: runAdminCheck,
      fetchFeaturedNodes: loadFeaturedNodes,
      setAuthenticated: setAuthenticatedState,
      setUserId: setUserIdState,
      setUsername: setUsernameState,
      setProfession: setProfessionState,
      setUserLocation: setUserLocationState,
      setUserAvatar: setUserAvatarState,
      setIsAdmin: setIsAdminState,
      setShowLocationModal: setShowLocationModalState,
      setView: setViewState
    } = sessionBootstrapRef.current;
    const token = localStorage.getItem('token');
    const storedUserId = normalizeObjectId(localStorage.getItem('userId'));
    const storedUsername = localStorage.getItem('username');
    const storedLocation = localStorage.getItem('userLocation');
    const storedProfession = localStorage.getItem('profession');
    const storedAvatar = localStorage.getItem('userAvatar');
    const storedUserRole = localStorage.getItem('userRole');

    if (!token || !storedUsername) {
      return;
    }

    const resolvedUserId = storedUserId || decodeUserIdFromToken(token);
    setAuthenticatedState(true);
    setUserIdState(resolvedUserId);
    setUsernameState(storedUsername);
    setProfessionState(storedProfession || '');
    setUserLocationState(storedLocation || '');
    setUserAvatarState(storedAvatar || 'default_male_1');
    setIsAdminState(storedUserRole === 'admin');

    if (resolvedUserId) {
      localStorage.setItem('userId', resolvedUserId);
    }

    if (!storedLocation || storedLocation === '') {
      loadFeaturedNodes();
      setShowLocationModalState(true);
    } else {
      setViewState('home');
    }

    if (storedUserRole === 'admin') {
      runAdminCheck();
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUsername = localStorage.getItem('username');
    if (!token || !storedUsername) return undefined;

    let cancelled = false;
    const validateStoredSession = async () => {
      try {
        const response = await fetch(`${API_BASE}/profile`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (cancelled) return;
        if (response.status !== 401 && response.status !== 403) return;
        if (localStorage.getItem('token') !== token || localStorage.getItem('username') !== storedUsername) {
          return;
        }

        resetStoredSessionState();
      } catch (_error) {
        // 启动校验失败时不阻塞现有流程，避免临时网络波动把用户踢回登录页
      }
    };

    validateStoredSession();
    return () => {
      cancelled = true;
    };
  }, [resetStoredSessionState]);

  useEffect(() => {
    if (!authenticated) {
      hasRestoredPageRef.current = false;
      isRestoringPageRef.current = false;
    }
  }, [authenticated, hasRestoredPageRef, isRestoringPageRef]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleAuthExpired = () => {
      resetStoredSessionState();
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, [resetStoredSessionState]);

  const handleLoginSuccess = async (data) => {
    resetAppNavigationStateToHome({ clearHomeCollections: true });
    localStorage.setItem('token', data.token);
    localStorage.setItem('userId', normalizeObjectId(data.userId));
    localStorage.setItem('username', data.username);
    localStorage.setItem('userLocation', data.location || '');
    localStorage.setItem('profession', data.profession || '求知');
    localStorage.setItem('userAvatar', data.avatar || 'default_male_1');
    localStorage.setItem('userRole', data.role || '');
    setAuthenticated(true);
    setUserId(normalizeObjectId(data.userId));
    setUsername(data.username);
    setProfession(data.profession || '求知');
    setUserLocation(data.location || '');
    setUserAvatar(data.avatar || 'default_male_1');
    setIsAdmin(data.role === 'admin');
    const needsLocationSelection = data.role !== 'admin' && (!data.location || data.location === '');
    if (needsLocationSelection) {
      setShowLocationModal(true);
    } else {
      setShowLocationModal(false);
    }

    initializeSocket(data.token);

    if (data.role === 'admin') {
      await checkAdminStatus();
    }
    if (data.role !== 'admin') {
      await fetchTravelStatus(true);
    } else {
      applyTravelStatus({ isTraveling: false });
    }

    if (!data.location || data.location === '') {
      if (data.role === 'admin') {
        await updateUserLocation('任意');
        setUserLocation('任意');
        localStorage.setItem('userLocation', '任意');
        resetAppNavigationStateToHome();
      }
    } else {
      resetAppNavigationStateToHome();
    }
  };

  const handleLogout = () => {
    resetStoredSessionState();
    setAdminEntryTab('users');
    applyTravelStatus({ isTraveling: false });
    setIsStoppingTravel(false);
    resetNotificationCenter();
    resetChatCenter();
    resetAppShellState();
    setIsApplyingDomainMaster(false);
    setCurrentLocationNodeDetail(null);
    setSelectedLocationNode(null);
    resetDistributionState();
    resetDomainConflictState();
    setSiegeSupportStatuses([]);
    cleanupSocket();
    setNodes([]);
  };

  return {
    checkAdminStatus,
    handleLoginSuccess,
    handleLogout
  };
};

export default useAppSession;
