import { useCallback, useState } from 'react';
import { API_BASE } from '../../../runtimeConfig';
import { getApiError, parseApiResponse } from './api';

const createDefaultDomainAdminState = () => ({
  loading: false,
  error: '',
  canView: false,
  canEdit: false,
  isSystemAdmin: false,
  canResign: false,
  resignPending: false,
  domainMaster: null,
  domainAdmins: [],
  availablePermissions: [],
  gateDefenseViewerAdminIds: [],
  pendingInvites: []
});

const buildDomainAdminPermissionDraft = (admins = []) => (
  (Array.isArray(admins) ? admins : []).reduce((acc, adminItem) => {
    const adminId = typeof adminItem?._id === 'string' ? adminItem._id : '';
    if (!adminId) return acc;
    const permissions = adminItem?.permissions && typeof adminItem.permissions === 'object'
      ? adminItem.permissions
      : {};
    acc[adminId] = Object.keys(permissions).filter((key) => !!permissions[key]);
    return acc;
  }, {})
);

const normalizePermissionLabels = (adminItem) => (
  Array.isArray(adminItem?.permissionLabels)
    ? adminItem.permissionLabels.filter((item) => typeof item === 'string' && item)
    : []
);

const useDomainAdmins = ({
  nodeId,
  onMembershipChanged
}) => {
  const [domainAdminState, setDomainAdminState] = useState(createDefaultDomainAdminState);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [hasSearchedAdminUsers, setHasSearchedAdminUsers] = useState(false);
  const [invitingUsername, setInvitingUsername] = useState('');
  const [revokingInviteId, setRevokingInviteId] = useState('');
  const [removingAdminId, setRemovingAdminId] = useState('');
  const [isSubmittingResign, setIsSubmittingResign] = useState(false);
  const [manageFeedback, setManageFeedback] = useState('');
  const [, setGateDefenseViewerDraftIds] = useState([]);
  const [, setGateDefenseViewerDirty] = useState(false);
  const [, setIsSavingGateDefenseViewerPerms] = useState(false);
  const [isDomainAdminPermissionModalOpen, setIsDomainAdminPermissionModalOpen] = useState(false);
  const [domainAdminPermissionDraftMap, setDomainAdminPermissionDraftMap] = useState({});
  const [domainAdminPermissionDirty, setDomainAdminPermissionDirty] = useState(false);
  const [isSavingDomainAdminPermissions, setIsSavingDomainAdminPermissions] = useState(false);

  const resetDomainAdmins = useCallback(() => {
    setDomainAdminState(createDefaultDomainAdminState());
    setSearchKeyword('');
    setSearchResults([]);
    setIsSearchingUsers(false);
    setHasSearchedAdminUsers(false);
    setInvitingUsername('');
    setRevokingInviteId('');
    setRemovingAdminId('');
    setIsSubmittingResign(false);
    setManageFeedback('');
    setGateDefenseViewerDraftIds([]);
    setGateDefenseViewerDirty(false);
    setIsSavingGateDefenseViewerPerms(false);
    setIsDomainAdminPermissionModalOpen(false);
    setDomainAdminPermissionDraftMap({});
    setDomainAdminPermissionDirty(false);
    setIsSavingDomainAdminPermissions(false);
  }, []);

  const fetchDomainAdmins = useCallback(async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId) return;

    if (!silent) {
      setDomainAdminState((prev) => ({ ...prev, loading: true, error: '' }));
    }

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/domain-admins`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        if (response.status === 403) {
          setDomainAdminState((prev) => ({
            ...prev,
            loading: false,
            canView: false,
            canEdit: false,
            isSystemAdmin: false,
            canResign: false,
            resignPending: false,
            availablePermissions: [],
            gateDefenseViewerAdminIds: [],
            pendingInvites: [],
            error: ''
          }));
          setGateDefenseViewerDraftIds([]);
          setGateDefenseViewerDirty(false);
          setDomainAdminPermissionDraftMap({});
          setDomainAdminPermissionDirty(false);
          return;
        }

        setDomainAdminState((prev) => ({
          ...prev,
          loading: false,
          canView: false,
          canEdit: false,
          isSystemAdmin: false,
          canResign: false,
          resignPending: false,
          availablePermissions: [],
          gateDefenseViewerAdminIds: [],
          pendingInvites: [],
          error: getApiError(parsed, '获取域相列表失败')
        }));
        setGateDefenseViewerDraftIds([]);
        setGateDefenseViewerDirty(false);
        setDomainAdminPermissionDraftMap({});
        setDomainAdminPermissionDirty(false);
        return;
      }

      const gateDefenseViewerAdminIds = Array.isArray(data.gateDefenseViewerAdminIds)
        ? Array.from(new Set(data.gateDefenseViewerAdminIds
          .map((id) => (typeof id === 'string' ? id : ''))
          .filter((id) => !!id)))
        : [];

      const domainAdmins = Array.isArray(data.domainAdmins) ? data.domainAdmins : [];
      setDomainAdminState({
        loading: false,
        error: '',
        canView: !!data.canView,
        canEdit: !!data.canEdit,
        isSystemAdmin: !!data.isSystemAdmin,
        canResign: !!data.canResign,
        resignPending: !!data.resignPending,
        domainMaster: data.domainMaster || null,
        domainAdmins,
        availablePermissions: Array.isArray(data.availablePermissions) ? data.availablePermissions : [],
        gateDefenseViewerAdminIds,
        pendingInvites: data.pendingInvites || []
      });
      setGateDefenseViewerDraftIds(gateDefenseViewerAdminIds);
      setGateDefenseViewerDirty(false);
      setDomainAdminPermissionDraftMap(buildDomainAdminPermissionDraft(domainAdmins));
      setDomainAdminPermissionDirty(false);
    } catch (error) {
      setDomainAdminState((prev) => ({
        ...prev,
        loading: false,
        isSystemAdmin: false,
        canResign: false,
        resignPending: false,
        availablePermissions: [],
        gateDefenseViewerAdminIds: [],
        pendingInvites: [],
        error: `获取域相列表失败: ${error.message}`
      }));
      setGateDefenseViewerDraftIds([]);
      setGateDefenseViewerDirty(false);
      setDomainAdminPermissionDraftMap({});
      setDomainAdminPermissionDirty(false);
    }
  }, [nodeId]);

  const applyResignDomainAdmin = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId) return;

    const confirmed = window.confirm('确认提交卸任申请？域主3天内未处理将自动同意。');
    if (!confirmed) return;

    setIsSubmittingResign(true);
    setManageFeedback('');
    setGateDefenseViewerDraftIds([]);
    setGateDefenseViewerDirty(false);
    setIsSavingGateDefenseViewerPerms(false);

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/domain-admins/resign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '提交卸任申请失败'));
        return;
      }

      setManageFeedback(data.message || '卸任申请已提交');
      await fetchDomainAdmins(true);
    } catch (error) {
      setManageFeedback(`提交卸任申请失败: ${error.message}`);
    } finally {
      setIsSubmittingResign(false);
    }
  }, [fetchDomainAdmins, nodeId]);

  const inviteDomainAdmin = useCallback(async (username) => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId || !username) return;

    setInvitingUsername(username);
    setManageFeedback('');

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/domain-admins/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ username })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '发送邀请失败'));
        return;
      }

      setManageFeedback(data.message || '邀请已发送');
      setSearchKeyword('');
      setSearchResults([]);
      setHasSearchedAdminUsers(false);
      await fetchDomainAdmins(true);
      if (typeof onMembershipChanged === 'function') {
        await onMembershipChanged();
      }
    } catch (error) {
      setManageFeedback(`发送邀请失败: ${error.message}`);
    } finally {
      setInvitingUsername('');
    }
  }, [fetchDomainAdmins, nodeId, onMembershipChanged]);

  const clearDomainAdminSearch = useCallback(() => {
    setSearchKeyword('');
    setSearchResults([]);
    setManageFeedback('');
    setHasSearchedAdminUsers(false);
  }, []);

  const searchDomainAdminUsers = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId || !domainAdminState.canEdit) return;

    const keyword = searchKeyword.trim();
    if (!keyword) {
      setSearchResults([]);
      setHasSearchedAdminUsers(false);
      return;
    }

    setManageFeedback('');
    setIsSearchingUsers(true);
    setHasSearchedAdminUsers(true);

    try {
      const response = await fetch(
        `${API_BASE}/nodes/${nodeId}/domain-admins/search-users?keyword=${encodeURIComponent(keyword)}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setSearchResults([]);
        setManageFeedback(getApiError(parsed, '搜索用户失败'));
        return;
      }
      setSearchResults(data.users || []);
    } catch (error) {
      setSearchResults([]);
      setManageFeedback(`搜索用户失败: ${error.message}`);
    } finally {
      setIsSearchingUsers(false);
    }
  }, [domainAdminState.canEdit, nodeId, searchKeyword]);

  const removeDomainAdmin = useCallback(async (adminUserId) => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId || !adminUserId) return;

    const confirmed = window.confirm('确认移除该管理员吗？');
    if (!confirmed) return;

    setRemovingAdminId(adminUserId);
    setManageFeedback('');

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/domain-admins/${adminUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '移除管理员失败'));
        return;
      }

      setManageFeedback(data.message || '管理员已移除');
      await fetchDomainAdmins(true);
      if (typeof onMembershipChanged === 'function') {
        await onMembershipChanged();
      }
    } catch (error) {
      setManageFeedback(`移除管理员失败: ${error.message}`);
    } finally {
      setRemovingAdminId('');
    }
  }, [fetchDomainAdmins, nodeId, onMembershipChanged]);

  const openDomainAdminPermissionModal = useCallback(() => {
    if (!domainAdminState.canEdit) return;
    setDomainAdminPermissionDraftMap(buildDomainAdminPermissionDraft(domainAdminState.domainAdmins));
    setDomainAdminPermissionDirty(false);
    setIsDomainAdminPermissionModalOpen(true);
    setManageFeedback('');
  }, [domainAdminState.canEdit, domainAdminState.domainAdmins]);

  const closeDomainAdminPermissionModal = useCallback(() => {
    if (isSavingDomainAdminPermissions) return;
    setIsDomainAdminPermissionModalOpen(false);
  }, [isSavingDomainAdminPermissions]);

  const toggleDomainAdminPermission = useCallback((adminUserId, permissionKey) => {
    if (!adminUserId || !permissionKey) return;
    setDomainAdminPermissionDraftMap((prev) => {
      const currentKeys = Array.isArray(prev?.[adminUserId]) ? prev[adminUserId] : [];
      const exists = currentKeys.includes(permissionKey);
      const nextKeys = exists ? currentKeys.filter((item) => item !== permissionKey) : [...currentKeys, permissionKey];
      return {
        ...prev,
        [adminUserId]: nextKeys
      };
    });
    setDomainAdminPermissionDirty(true);
    setManageFeedback('');
  }, []);

  const saveDomainAdminPermissions = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId || !domainAdminState.canEdit) return;

    setIsSavingDomainAdminPermissions(true);
    setManageFeedback('');
    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/domain-admins/permissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          permissionsByUserId: domainAdminPermissionDraftMap
        })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '保存域相权限失败'));
        return;
      }

      const savedViewerIds = Array.isArray(data.gateDefenseViewerAdminIds)
        ? Array.from(new Set(data.gateDefenseViewerAdminIds
          .map((id) => (typeof id === 'string' ? id : ''))
          .filter((id) => !!id)))
        : [];
      const domainAdmins = Array.isArray(data.domainAdmins) ? data.domainAdmins : [];
      setDomainAdminState((prev) => ({
        ...prev,
        domainAdmins,
        availablePermissions: Array.isArray(data.availablePermissions) ? data.availablePermissions : prev.availablePermissions,
        gateDefenseViewerAdminIds: savedViewerIds
      }));
      setGateDefenseViewerDraftIds(savedViewerIds);
      setGateDefenseViewerDirty(false);
      setDomainAdminPermissionDraftMap(buildDomainAdminPermissionDraft(domainAdmins));
      setDomainAdminPermissionDirty(false);
      setIsDomainAdminPermissionModalOpen(false);
      setManageFeedback(data.message || '域相权限已保存');
    } catch (error) {
      setManageFeedback(`保存域相权限失败: ${error.message}`);
    } finally {
      setIsSavingDomainAdminPermissions(false);
    }
  }, [domainAdminPermissionDraftMap, domainAdminState.canEdit, nodeId]);

  const revokeDomainAdminInvite = useCallback(async (notificationId) => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId || !notificationId) return;

    setRevokingInviteId(notificationId);
    setManageFeedback('');

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/domain-admins/invite/${notificationId}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '撤销邀请失败'));
        return;
      }

      setManageFeedback(data.message || '邀请已撤销');
      await fetchDomainAdmins(true);
      if (typeof onMembershipChanged === 'function') {
        await onMembershipChanged();
      }
    } catch (error) {
      setManageFeedback(`撤销邀请失败: ${error.message}`);
    } finally {
      setRevokingInviteId('');
    }
  }, [fetchDomainAdmins, nodeId, onMembershipChanged]);

  return {
    domainAdminState,
    setDomainAdminState,
    searchKeyword,
    setSearchKeyword,
    searchResults,
    setSearchResults,
    isSearchingUsers,
    hasSearchedAdminUsers,
    setHasSearchedAdminUsers,
    invitingUsername,
    revokingInviteId,
    removingAdminId,
    isSubmittingResign,
    manageFeedback,
    setManageFeedback,
    isDomainAdminPermissionModalOpen,
    domainAdminPermissionDraftMap,
    domainAdminPermissionDirty,
    isSavingDomainAdminPermissions,
    normalizePermissionLabels,
    resetDomainAdmins,
    fetchDomainAdmins,
    applyResignDomainAdmin,
    inviteDomainAdmin,
    clearDomainAdminSearch,
    searchDomainAdminUsers,
    removeDomainAdmin,
    openDomainAdminPermissionModal,
    closeDomainAdminPermissionModal,
    toggleDomainAdminPermission,
    saveDomainAdminPermissions,
    revokeDomainAdminInvite
  };
};

export default useDomainAdmins;
