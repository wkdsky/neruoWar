import { useCallback, useRef, useState } from 'react';
import { API_BASE } from '../../../../../runtimeConfig';

const ADMIN_ALLIANCE_PAGE_SIZE = 20;

const createEmptyAllianceForm = () => ({
    name: '',
    flag: '',
    declaration: '',
    knowledgeReserve: '0',
    memberIds: []
});

const normalizeAllianceMember = (member = {}) => ({
    _id: member?._id || '',
    username: member?.username || '',
    profession: member?.profession || '',
    level: Number.isFinite(Number(member?.level)) ? Number(member.level) : 0,
    allianceId: member?.allianceId || '',
    allianceName: member?.allianceName || '',
    isFounder: !!member?.isFounder
});

const useAdminAlliancesFeature = () => {
    const [adminAlliances, setAdminAlliances] = useState([]);
    const [adminAlliancePage, setAdminAlliancePage] = useState(1);
    const [adminAlliancePagination, setAdminAlliancePagination] = useState({
        page: 1,
        pageSize: ADMIN_ALLIANCE_PAGE_SIZE,
        total: 0,
        totalPages: 0
    });
    const [isAdminAllianceLoading, setIsAdminAllianceLoading] = useState(false);
    const [editingAlliance, setEditingAlliance] = useState(null);
    const [editAllianceForm, setEditAllianceForm] = useState(createEmptyAllianceForm);
    const [showAllianceMemberModal, setShowAllianceMemberModal] = useState(false);
    const [editAllianceMembers, setEditAllianceMembers] = useState([]);
    const [allianceMemberDraft, setAllianceMemberDraft] = useState([]);
    const [isAllianceMemberLoading, setIsAllianceMemberLoading] = useState(false);
    const [allianceMemberSearchKeyword, setAllianceMemberSearchKeyword] = useState('');
    const [allianceMemberSearchResults, setAllianceMemberSearchResults] = useState([]);
    const [isAllianceMemberSearchLoading, setIsAllianceMemberSearchLoading] = useState(false);
    const [hasAllianceMemberSearchTriggered, setHasAllianceMemberSearchTriggered] = useState(false);
    const allianceMemberRequestIdRef = useRef(0);
    const allianceMemberSearchRequestIdRef = useRef(0);

    const fetchAdminAlliances = useCallback(async (page = adminAlliancePage) => {
        const token = localStorage.getItem('token');
        setIsAdminAllianceLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(Math.max(1, page)),
                pageSize: String(ADMIN_ALLIANCE_PAGE_SIZE)
            });
            const response = await fetch(`${API_BASE}/alliances/admin/all?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                const pagination = data?.pagination || {};
                const nextPage = Math.max(1, parseInt(pagination.page, 10) || Math.max(1, page));
                setAdminAlliances(Array.isArray(data?.alliances) ? data.alliances : []);
                setAdminAlliancePagination({
                    page: nextPage,
                    pageSize: Math.max(1, parseInt(pagination.pageSize, 10) || ADMIN_ALLIANCE_PAGE_SIZE),
                    total: Math.max(0, parseInt(pagination.total, 10) || 0),
                    totalPages: Math.max(0, parseInt(pagination.totalPages, 10) || 0)
                });
                setAdminAlliancePage(nextPage);
            }
        } catch (error) {
            console.error('获取熵盟列表失败:', error);
        } finally {
            setIsAdminAllianceLoading(false);
        }
    }, [adminAlliancePage]);

    const loadAllianceMembersForEdit = useCallback(async (allianceId, { syncDraft = false } = {}) => {
        if (!allianceId) return [];
        const requestId = ++allianceMemberRequestIdRef.current;
        const token = localStorage.getItem('token');
        setIsAllianceMemberLoading(true);
        try {
            const response = await fetch(`${API_BASE}/alliances/admin/${allianceId}/members`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.error || '获取成员失败');
            }
            if (requestId !== allianceMemberRequestIdRef.current) {
                return [];
            }
            const members = (Array.isArray(data?.members) ? data.members : [])
                .map((item) => normalizeAllianceMember(item))
                .filter((item) => item._id);
            setEditAllianceMembers(members);
            setEditAllianceForm((prev) => ({
                ...prev,
                memberIds: members.map((item) => item._id)
            }));
            if (syncDraft) {
                setAllianceMemberDraft(members.map((item) => ({ ...item })));
            }
            return members;
        } catch (error) {
            if (requestId === allianceMemberRequestIdRef.current) {
                console.error('加载熵盟成员失败:', error);
                alert(error.message || '加载熵盟成员失败');
            }
            return [];
        } finally {
            if (requestId === allianceMemberRequestIdRef.current) {
                setIsAllianceMemberLoading(false);
            }
        }
    }, []);

    const searchAllianceMemberCandidates = useCallback(async (keyword = allianceMemberSearchKeyword) => {
        const normalizedKeyword = typeof keyword === 'string' ? keyword.trim() : '';
        if (!normalizedKeyword) {
            setAllianceMemberSearchResults([]);
            setHasAllianceMemberSearchTriggered(false);
            setIsAllianceMemberSearchLoading(false);
            return;
        }
        const requestId = ++allianceMemberSearchRequestIdRef.current;
        const token = localStorage.getItem('token');
        setHasAllianceMemberSearchTriggered(true);
        setIsAllianceMemberSearchLoading(true);
        try {
            const params = new URLSearchParams({
                keyword: normalizedKeyword,
                limit: '60'
            });
            const response = await fetch(`${API_BASE}/alliances/admin/member-candidates?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (requestId !== allianceMemberSearchRequestIdRef.current) return;
            if (!response.ok) {
                throw new Error(data?.error || '搜索失败');
            }
            const users = (Array.isArray(data?.users) ? data.users : [])
                .map((item) => normalizeAllianceMember(item))
                .filter((item) => item._id);
            setAllianceMemberSearchResults(users);
        } catch (error) {
            if (requestId === allianceMemberSearchRequestIdRef.current) {
                console.error('搜索熵盟成员候选失败:', error);
                setAllianceMemberSearchResults([]);
            }
        } finally {
            if (requestId === allianceMemberSearchRequestIdRef.current) {
                setIsAllianceMemberSearchLoading(false);
            }
        }
    }, [allianceMemberSearchKeyword]);

    const openAllianceMemberModal = useCallback(() => {
        if (!editingAlliance?._id) return;
        setAllianceMemberSearchKeyword('');
        setAllianceMemberSearchResults([]);
        setHasAllianceMemberSearchTriggered(false);
        setAllianceMemberDraft(editAllianceMembers.map((item) => ({ ...item })));
        setShowAllianceMemberModal(true);
        if (editAllianceMembers.length === 0 && !isAllianceMemberLoading) {
            loadAllianceMembersForEdit(editingAlliance._id, { syncDraft: true });
        }
    }, [editAllianceMembers, editingAlliance, isAllianceMemberLoading, loadAllianceMembersForEdit]);

    const closeAllianceMemberModal = useCallback(() => {
        allianceMemberSearchRequestIdRef.current += 1;
        setShowAllianceMemberModal(false);
        setAllianceMemberSearchKeyword('');
        setAllianceMemberSearchResults([]);
        setHasAllianceMemberSearchTriggered(false);
        setAllianceMemberDraft([]);
        setIsAllianceMemberSearchLoading(false);
    }, []);

    const addAllianceMemberDraftUser = useCallback((candidate) => {
        const normalizedCandidate = normalizeAllianceMember(candidate);
        if (!normalizedCandidate._id) return;
        setAllianceMemberDraft((prev) => {
            if (prev.some((item) => item._id === normalizedCandidate._id)) {
                return prev;
            }
            return [...prev, normalizedCandidate];
        });
    }, []);

    const removeAllianceMemberDraftUser = useCallback((memberId) => {
        const targetId = String(memberId || '');
        if (!targetId) return;
        setAllianceMemberDraft((prev) => {
            const target = prev.find((item) => item._id === targetId);
            if (!target) return prev;
            if (target.isFounder) {
                alert('盟主成员不可移除');
                return prev;
            }
            return prev.filter((item) => item._id !== targetId);
        });
    }, []);

    const confirmAllianceMemberDraft = useCallback(() => {
        const normalizedMembers = (Array.isArray(allianceMemberDraft) ? allianceMemberDraft : [])
            .map((item) => normalizeAllianceMember(item))
            .filter((item) => item._id);
        if (normalizedMembers.length === 0) {
            alert('熵盟至少需要 1 名成员');
            return;
        }
        setEditAllianceMembers(normalizedMembers);
        setEditAllianceForm((prev) => ({
            ...prev,
            memberIds: normalizedMembers.map((item) => item._id)
        }));
        closeAllianceMemberModal();
    }, [allianceMemberDraft, closeAllianceMemberModal]);

    const handleAllianceFieldChange = useCallback((field, value) => {
        setEditAllianceForm((prev) => ({
            ...prev,
            [field]: value
        }));
    }, []);

    const handleAllianceMemberSearchKeywordChange = useCallback((value) => {
        setAllianceMemberSearchKeyword(value);
        setHasAllianceMemberSearchTriggered(false);
        setAllianceMemberSearchResults([]);
    }, []);

    const startEditAlliance = useCallback((alliance) => {
        allianceMemberRequestIdRef.current += 1;
        allianceMemberSearchRequestIdRef.current += 1;
        setEditingAlliance(alliance);
        setEditAllianceForm({
            name: alliance.name,
            flag: alliance.flag,
            declaration: alliance.declaration,
            knowledgeReserve: String(Number(alliance.knowledgeReserve) || 0),
            memberIds: []
        });
        setEditAllianceMembers([]);
        setAllianceMemberDraft([]);
        setShowAllianceMemberModal(false);
        setAllianceMemberSearchKeyword('');
        setAllianceMemberSearchResults([]);
        setHasAllianceMemberSearchTriggered(false);
        loadAllianceMembersForEdit(alliance._id);
    }, [loadAllianceMembersForEdit]);

    const cancelEditAlliance = useCallback(() => {
        allianceMemberRequestIdRef.current += 1;
        allianceMemberSearchRequestIdRef.current += 1;
        setEditingAlliance(null);
        setEditAllianceForm(createEmptyAllianceForm());
        setEditAllianceMembers([]);
        setAllianceMemberDraft([]);
        setShowAllianceMemberModal(false);
        setAllianceMemberSearchKeyword('');
        setAllianceMemberSearchResults([]);
        setHasAllianceMemberSearchTriggered(false);
        setIsAllianceMemberSearchLoading(false);
        setIsAllianceMemberLoading(false);
    }, []);

    const saveAllianceEdit = useCallback(async () => {
        if (!editingAlliance?._id) return;
        const trimmedName = String(editAllianceForm.name || '').trim();
        const trimmedDeclaration = String(editAllianceForm.declaration || '').trim();
        const parsedKnowledgeReserve = Number(editAllianceForm.knowledgeReserve);
        if (!trimmedName) {
            alert('熵盟名称不能为空');
            return;
        }
        if (!trimmedDeclaration) {
            alert('熵盟号召不能为空');
            return;
        }
        if (!Number.isFinite(parsedKnowledgeReserve) || parsedKnowledgeReserve < 0) {
            alert('知识点储备必须是大于等于 0 的数字');
            return;
        }
        if (!Array.isArray(editAllianceForm.memberIds) || editAllianceForm.memberIds.length === 0) {
            alert('请至少保留 1 名成员');
            return;
        }

        const payload = {
            name: trimmedName,
            flag: editAllianceForm.flag,
            declaration: trimmedDeclaration,
            knowledgeReserve: parsedKnowledgeReserve,
            memberIds: editAllianceForm.memberIds
        };

        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE}/alliances/admin/${editingAlliance._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                const data = await response.json();
                alert(data.message);
                cancelEditAlliance();
                fetchAdminAlliances(adminAlliancePage);
            } else {
                const data = await response.json();
                alert(data.error || '保存失败');
            }
        } catch (error) {
            console.error('保存熵盟失败:', error);
            alert('保存失败');
        }
    }, [adminAlliancePage, cancelEditAlliance, editAllianceForm, editingAlliance, fetchAdminAlliances]);

    const deleteAlliance = useCallback(async (allianceId, allianceName) => {
        if (!window.confirm(`确定要删除熵盟 "${allianceName}" 吗？此操作将清除所有成员的熵盟关联！`)) return;
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE}/alliances/admin/${allianceId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                alert(data.message);
                const targetPage = (adminAlliances.length === 1 && adminAlliancePage > 1)
                    ? adminAlliancePage - 1
                    : adminAlliancePage;
                fetchAdminAlliances(targetPage);
            } else {
                const data = await response.json();
                alert(data.error || '删除失败');
            }
        } catch (error) {
            console.error('删除熵盟失败:', error);
            alert('删除失败');
        }
    }, [adminAlliancePage, adminAlliances.length, fetchAdminAlliances]);

    const refreshAdminAlliances = useCallback(() => {
        fetchAdminAlliances(adminAlliancePage);
    }, [adminAlliancePage, fetchAdminAlliances]);

    const goToPrevAdminAlliancePage = useCallback(() => {
        fetchAdminAlliances(adminAlliancePagination.page - 1);
    }, [adminAlliancePagination.page, fetchAdminAlliances]);

    const goToNextAdminAlliancePage = useCallback(() => {
        fetchAdminAlliances(adminAlliancePagination.page + 1);
    }, [adminAlliancePagination.page, fetchAdminAlliances]);

    return {
        adminAlliances,
        adminAlliancePagination,
        isAdminAllianceLoading,
        editingAlliance,
        editAllianceForm,
        showAllianceMemberModal,
        editAllianceMembers,
        allianceMemberDraft,
        isAllianceMemberLoading,
        allianceMemberSearchKeyword,
        allianceMemberSearchResults,
        isAllianceMemberSearchLoading,
        hasAllianceMemberSearchTriggered,
        fetchAdminAlliances,
        searchAllianceMemberCandidates,
        openAllianceMemberModal,
        closeAllianceMemberModal,
        addAllianceMemberDraftUser,
        removeAllianceMemberDraftUser,
        confirmAllianceMemberDraft,
        handleAllianceFieldChange,
        handleAllianceMemberSearchKeywordChange,
        startEditAlliance,
        cancelEditAlliance,
        saveAllianceEdit,
        deleteAlliance,
        refreshAdminAlliances,
        goToPrevAdminAlliancePage,
        goToNextAdminAlliancePage
    };
};

export default useAdminAlliancesFeature;
