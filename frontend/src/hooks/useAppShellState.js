import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RIGHT_DOCK_COLLAPSE_MS,
  normalizeObjectId
} from '../app/appShared';
import { API_BASE } from '../runtimeConfig';
import useClickOutside from './useClickOutside';

const createEmptyRelatedDomainsData = () => ({
  loading: false,
  error: '',
  domainMasterDomains: [],
  domainAdminDomains: [],
  favoriteDomains: [],
  recentDomains: []
});

const useAppShellState = ({
  authenticated,
  isAdmin,
  parseApiResponse,
  getApiErrorMessage,
  notificationsWrapperRef,
  relatedDomainsWrapperRef,
  militaryMenuWrapperRef,
  fetchNotifications,
  fetchAdminPendingNodeReminders,
  systemAnnouncements,
  allianceAnnouncements,
  view,
  currentNodeDetail,
  currentTitleDetail,
  userLocation,
  travelStatus,
  fetchLocationNodeDetail,
}) => {
  const isLocationDockExpandedRef = useRef(false);
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
  const [isLocationDockExpanded, setIsLocationDockExpanded] = useState(false);
  const [isAnnouncementDockExpanded, setIsAnnouncementDockExpanded] = useState(false);
  const [announcementDockTab, setAnnouncementDockTab] = useState('system');
  const [showRelatedDomainsPanel, setShowRelatedDomainsPanel] = useState(false);
  const [showMilitaryMenu, setShowMilitaryMenu] = useState(false);
  const [relatedDomainsData, setRelatedDomainsData] = useState(createEmptyRelatedDomainsData);
  const [favoriteActionDomainId, setFavoriteActionDomainId] = useState('');

  const closeHeaderPanels = useCallback(() => {
    setShowNotificationsPanel(false);
    setShowRelatedDomainsPanel(false);
    setShowMilitaryMenu(false);
  }, []);

  const collapseRightDocks = useCallback(() => {
    setIsLocationDockExpanded(false);
    setIsAnnouncementDockExpanded(false);
  }, []);

  const resetAppShellState = useCallback(() => {
    closeHeaderPanels();
    collapseRightDocks();
    setAnnouncementDockTab('system');
    setRelatedDomainsData(createEmptyRelatedDomainsData());
    setFavoriteActionDomainId('');
  }, [closeHeaderPanels, collapseRightDocks]);

  const fetchRelatedDomains = useCallback(async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    if (!silent) {
      setRelatedDomainsData((prev) => ({ ...prev, loading: true, error: '' }));
    }

    try {
      const response = await fetch(`${API_BASE}/nodes/me/related-domains`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        const errorText = getApiErrorMessage(parsed, '获取相关知识域失败');
        setRelatedDomainsData((prev) => ({
          ...prev,
          loading: false,
          error: errorText
        }));
        return null;
      }

      const nextData = {
        loading: false,
        error: '',
        domainMasterDomains: data.domainMasterDomains || [],
        domainAdminDomains: data.domainAdminDomains || [],
        favoriteDomains: data.favoriteDomains || [],
        recentDomains: data.recentDomains || []
      };
      setRelatedDomainsData(nextData);
      return nextData;
    } catch (error) {
      setRelatedDomainsData((prev) => ({
        ...prev,
        loading: false,
        error: `获取相关知识域失败: ${error.message}`
      }));
      return null;
    }
  }, [getApiErrorMessage, parseApiResponse]);

  const toggleFavoriteDomain = useCallback(async (domainId) => {
    const token = localStorage.getItem('token');
    const normalizedId = normalizeObjectId(domainId);
    if (!token || !normalizedId) return;

    setFavoriteActionDomainId(normalizedId);
    try {
      const response = await fetch(`${API_BASE}/nodes/${normalizedId}/favorite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        window.alert(getApiErrorMessage(parsed, '更新收藏失败'));
        return;
      }
      await fetchRelatedDomains(true);
    } catch (error) {
      window.alert(`更新收藏失败: ${error.message}`);
    } finally {
      setFavoriteActionDomainId('');
    }
  }, [fetchRelatedDomains, getApiErrorMessage, parseApiResponse]);

  const toggleNotificationsPanel = useCallback(async () => {
    const nextVisible = !showNotificationsPanel;
    setShowNotificationsPanel(nextVisible);
    setShowRelatedDomainsPanel(false);
    setShowMilitaryMenu(false);
    if (nextVisible) {
      await fetchNotifications(false);
      if (isAdmin) {
        await fetchAdminPendingNodeReminders(false);
      }
    }
  }, [
    fetchAdminPendingNodeReminders,
    fetchNotifications,
    isAdmin,
    showNotificationsPanel
  ]);

  const toggleRelatedDomainsPanel = useCallback(() => {
    const nextVisible = !showRelatedDomainsPanel;
    setShowNotificationsPanel(false);
    setShowRelatedDomainsPanel(nextVisible);
    setShowMilitaryMenu(false);
  }, [showRelatedDomainsPanel]);

  const toggleMilitaryMenu = useCallback(() => {
    const nextVisible = !showMilitaryMenu;
    setShowNotificationsPanel(false);
    setShowRelatedDomainsPanel(false);
    setShowMilitaryMenu(nextVisible);
  }, [showMilitaryMenu]);

  const collapseRightDocksBeforeNavigation = useCallback(async () => {
    if (isAdmin) return;
    const hasExpanded = isLocationDockExpanded || isAnnouncementDockExpanded;
    if (!hasExpanded) return;
    collapseRightDocks();
    await new Promise((resolve) => {
      setTimeout(resolve, RIGHT_DOCK_COLLAPSE_MS);
    });
  }, [collapseRightDocks, isAdmin, isAnnouncementDockExpanded, isLocationDockExpanded]);

  const handleRefreshLocationNodeDetail = useCallback(async () => {
    if (!userLocation || userLocation === '任意') return;
    await fetchLocationNodeDetail(userLocation, { silent: false });
  }, [fetchLocationNodeDetail, userLocation]);

  useClickOutside({
    enabled: showNotificationsPanel,
    ref: notificationsWrapperRef,
    onOutsideClick: () => setShowNotificationsPanel(false)
  });

  useClickOutside({
    enabled: showRelatedDomainsPanel,
    ref: relatedDomainsWrapperRef,
    onOutsideClick: () => setShowRelatedDomainsPanel(false)
  });

  useClickOutside({
    enabled: showMilitaryMenu,
    ref: militaryMenuWrapperRef,
    onOutsideClick: () => setShowMilitaryMenu(false)
  });

  useEffect(() => {
    const wasExpanded = isLocationDockExpandedRef.current;
    isLocationDockExpandedRef.current = isLocationDockExpanded;
    if (!isLocationDockExpanded || wasExpanded) return;
    if (isAdmin || travelStatus?.isTraveling) return;
    const locationName = (userLocation || '').trim();
    if (!locationName || locationName === '任意') return;
    fetchLocationNodeDetail(locationName, { silent: false });
  }, [fetchLocationNodeDetail, isAdmin, isLocationDockExpanded, travelStatus, userLocation]);

  useEffect(() => {
    if (!authenticated || isAdmin) {
      setRelatedDomainsData(createEmptyRelatedDomainsData());
      setShowRelatedDomainsPanel(false);
      return;
    }

    fetchRelatedDomains(true);
  }, [authenticated, fetchRelatedDomains, isAdmin]);

  useEffect(() => {
    if (!showRelatedDomainsPanel || !authenticated || isAdmin) return;
    fetchRelatedDomains(false);
  }, [authenticated, fetchRelatedDomains, isAdmin, showRelatedDomainsPanel]);

  useEffect(() => {
    if (announcementDockTab === 'system' && systemAnnouncements.length === 0 && allianceAnnouncements.length > 0) {
      setAnnouncementDockTab('alliance');
    } else if (announcementDockTab === 'alliance' && allianceAnnouncements.length === 0 && systemAnnouncements.length > 0) {
      setAnnouncementDockTab('system');
    }
  }, [allianceAnnouncements.length, announcementDockTab, systemAnnouncements.length]);

  useEffect(() => {
    const canRenderDock = !isAdmin && (
      view === 'home'
      || (view === 'nodeDetail' && currentNodeDetail)
      || (view === 'titleDetail' && currentTitleDetail)
    );
    if (!canRenderDock) {
      collapseRightDocks();
    }
  }, [collapseRightDocks, currentNodeDetail, currentTitleDetail, isAdmin, view]);

  const domainMasterDomains = useMemo(() => (
    Array.isArray(relatedDomainsData.domainMasterDomains) ? relatedDomainsData.domainMasterDomains : []
  ), [relatedDomainsData.domainMasterDomains]);

  const domainAdminDomains = useMemo(() => (
    Array.isArray(relatedDomainsData.domainAdminDomains) ? relatedDomainsData.domainAdminDomains : []
  ), [relatedDomainsData.domainAdminDomains]);

  const favoriteDomains = useMemo(() => (
    Array.isArray(relatedDomainsData.favoriteDomains) ? relatedDomainsData.favoriteDomains : []
  ), [relatedDomainsData.favoriteDomains]);

  const recentDomains = useMemo(() => (
    Array.isArray(relatedDomainsData.recentDomains) ? relatedDomainsData.recentDomains : []
  ), [relatedDomainsData.recentDomains]);

  const favoriteDomainSet = useMemo(() => (
    new Set(favoriteDomains.map((node) => normalizeObjectId(node?._id)))
  ), [favoriteDomains]);

  const relatedDomainCount = useMemo(() => (
    new Set([
      ...domainMasterDomains.map((node) => normalizeObjectId(node?._id)),
      ...domainAdminDomains.map((node) => normalizeObjectId(node?._id)),
      ...favoriteDomains.map((node) => normalizeObjectId(node?._id)),
      ...recentDomains.map((node) => normalizeObjectId(node?._id))
    ].filter(Boolean)).size
  ), [domainAdminDomains, domainMasterDomains, favoriteDomains, recentDomains]);

  const announcementGroups = useMemo(() => ({
    system: systemAnnouncements,
    alliance: allianceAnnouncements
  }), [allianceAnnouncements, systemAnnouncements]);

  return {
    showNotificationsPanel,
    showRelatedDomainsPanel,
    showMilitaryMenu,
    isLocationDockExpanded,
    isAnnouncementDockExpanded,
    announcementDockTab,
    relatedDomainsData,
    favoriteActionDomainId,
    domainMasterDomains,
    domainAdminDomains,
    favoriteDomains,
    recentDomains,
    favoriteDomainSet,
    relatedDomainCount,
    announcementGroups,
    isLocationDockExpandedRef,
    setShowNotificationsPanel,
    setShowMilitaryMenu,
    setIsLocationDockExpanded,
    setIsAnnouncementDockExpanded,
    setAnnouncementDockTab,
    fetchRelatedDomains,
    toggleFavoriteDomain,
    toggleNotificationsPanel,
    toggleRelatedDomainsPanel,
    toggleMilitaryMenu,
    closeHeaderPanels,
    collapseRightDocksBeforeNavigation,
    handleRefreshLocationNodeDetail,
    resetAppShellState
  };
};

export default useAppShellState;
