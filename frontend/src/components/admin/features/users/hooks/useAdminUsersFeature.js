import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../../../../runtimeConfig';

const ADMIN_USER_PAGE_SIZE = 50;

const createEmptyUserEditForm = () => ({
    username: '',
    password: '',
    level: 0,
    experience: 0,
    knowledgeBalance: '0'
});

const useAdminUsersFeature = () => {
    const [allUsers, setAllUsers] = useState([]);
    const [adminUserPage, setAdminUserPage] = useState(1);
    const [adminUserPagination, setAdminUserPagination] = useState({
        page: 1,
        pageSize: ADMIN_USER_PAGE_SIZE,
        total: 0,
        totalPages: 0
    });
    const [isAdminUserLoading, setIsAdminUserLoading] = useState(false);
    const [adminUserSearchInput, setAdminUserSearchInput] = useState('');
    const [adminUserSearchKeyword, setAdminUserSearchKeyword] = useState('');
    const [adminUserPageSize, setAdminUserPageSize] = useState(ADMIN_USER_PAGE_SIZE);
    const [adminUserActionFeedback, setAdminUserActionFeedback] = useState({ type: '', message: '' });
    const adminUserActionFeedbackTimerRef = useRef(null);
    const [editingUser, setEditingUser] = useState(null);
    const [editForm, setEditForm] = useState(createEmptyUserEditForm);

    const showAdminUserActionFeedback = useCallback((type, message) => {
        if (adminUserActionFeedbackTimerRef.current) {
            clearTimeout(adminUserActionFeedbackTimerRef.current);
        }
        setAdminUserActionFeedback({
            type: type === 'error' ? 'error' : 'success',
            message: String(message || '').trim()
        });
        adminUserActionFeedbackTimerRef.current = setTimeout(() => {
            setAdminUserActionFeedback({ type: '', message: '' });
            adminUserActionFeedbackTimerRef.current = null;
        }, 2800);
    }, []);

    useEffect(() => () => {
        if (adminUserActionFeedbackTimerRef.current) {
            clearTimeout(adminUserActionFeedbackTimerRef.current);
            adminUserActionFeedbackTimerRef.current = null;
        }
    }, []);

    const fetchAllUsers = useCallback(async (page = adminUserPage, keyword = adminUserSearchKeyword, pageSize = adminUserPageSize) => {
        const token = localStorage.getItem('token');
        const requestedPage = Number.parseInt(page, 10);
        const safePage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : adminUserPage;
        const requestedPageSize = Number.parseInt(pageSize, 10);
        const safePageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0 ? requestedPageSize : adminUserPageSize;
        const normalizedKeyword = typeof keyword === 'string' ? keyword.trim() : '';
        setIsAdminUserLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(Math.max(1, safePage)),
                pageSize: String(Math.max(1, safePageSize))
            });
            if (normalizedKeyword) {
                params.set('keyword', normalizedKeyword);
            }
            const response = await fetch(`${API_BASE}/admin/users?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                const pagination = data?.pagination || {};
                const nextPage = Math.max(1, parseInt(pagination.page, 10) || parseInt(data?.page, 10) || Math.max(1, safePage));
                const nextPageSize = Math.max(
                    1,
                    parseInt(pagination.pageSize, 10) || parseInt(data?.pageSize, 10) || Math.max(1, safePageSize)
                );
                const total = Math.max(0, parseInt(pagination.total, 10) || parseInt(data?.total, 10) || 0);
                const totalPages = Math.max(
                    0,
                    parseInt(pagination.totalPages, 10) || parseInt(data?.totalPages, 10) || Math.ceil(total / nextPageSize)
                );

                setAllUsers(Array.isArray(data?.users) ? data.users : []);
                setAdminUserPagination({
                    page: nextPage,
                    pageSize: nextPageSize,
                    total,
                    totalPages
                });
                setAdminUserPage(nextPage);
                setAdminUserPageSize(nextPageSize);
            }
        } catch (error) {
            console.error('获取用户列表失败:', error);
        } finally {
            setIsAdminUserLoading(false);
        }
    }, [adminUserPage, adminUserPageSize, adminUserSearchKeyword]);

    const submitAdminUserSearch = useCallback(() => {
        const normalizedKeyword = adminUserSearchInput.trim();
        setAdminUserSearchKeyword(normalizedKeyword);
        fetchAllUsers(1, normalizedKeyword, adminUserPageSize);
    }, [adminUserPageSize, adminUserSearchInput, fetchAllUsers]);

    const clearAdminUserSearch = useCallback(() => {
        setAdminUserSearchInput('');
        setAdminUserSearchKeyword('');
        fetchAllUsers(1, '', adminUserPageSize);
    }, [adminUserPageSize, fetchAllUsers]);

    const handleAdminUserPageSizeChange = useCallback((nextPageSize) => {
        const parsedPageSize = Number.parseInt(nextPageSize, 10);
        if (!Number.isInteger(parsedPageSize) || parsedPageSize <= 0) return;
        setAdminUserPageSize(parsedPageSize);
        fetchAllUsers(1, adminUserSearchKeyword, parsedPageSize);
    }, [adminUserSearchKeyword, fetchAllUsers]);

    const startEditUser = useCallback((user) => {
        setEditingUser(user._id);
        setEditForm({
            username: user.username,
            password: '',
            level: user.level,
            experience: user.experience,
            knowledgeBalance: String(
                Number.isFinite(Number(user.knowledgeBalance))
                    ? Number(user.knowledgeBalance)
                    : 0
            )
        });
    }, []);

    const saveUserEdit = useCallback(async (userId) => {
        const token = localStorage.getItem('token');
        const parsedLevel = Number(editForm.level);
        const parsedExperience = Number(editForm.experience);
        const parsedKnowledgeBalance = Number(editForm.knowledgeBalance);
        if (!Number.isInteger(parsedLevel) || parsedLevel < 0) {
            showAdminUserActionFeedback('error', '等级必须是大于等于0的整数');
            return;
        }
        if (!Number.isInteger(parsedExperience) || parsedExperience < 0) {
            showAdminUserActionFeedback('error', '经验值必须是大于等于0的整数');
            return;
        }
        if (!Number.isFinite(parsedKnowledgeBalance) || parsedKnowledgeBalance < 0) {
            showAdminUserActionFeedback('error', '知识点余额必须是大于等于0的数字');
            return;
        }

        const payload = {
            username: editForm.username,
            level: parsedLevel,
            experience: parsedExperience,
            knowledgeBalance: Number(parsedKnowledgeBalance.toFixed(2))
        };

        if (editForm.password.trim() !== '') {
            payload.password = editForm.password;
        }

        try {
            const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
            let data = null;
            let rawText = '';
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                data = await response.json();
            } else {
                rawText = await response.text();
            }
            if (response.ok) {
                showAdminUserActionFeedback('success', data?.message || '用户信息已更新');
                setEditingUser(null);
                fetchAllUsers(adminUserPage, adminUserSearchKeyword);
            } else {
                const errorReason = data?.error
                    || data?.message
                    || rawText?.trim()
                    || `更新失败（HTTP ${response.status}）`;
                showAdminUserActionFeedback('error', `更新失败：${errorReason}`);
            }
        } catch (error) {
            console.error('更新用户失败:', error);
            showAdminUserActionFeedback('error', `更新失败：${error?.message || '网络异常'}`);
        }
    }, [adminUserPage, adminUserSearchKeyword, editForm, fetchAllUsers, showAdminUserActionFeedback]);

    const deleteUser = useCallback(async (userId, username) => {
        if (!window.confirm(`确定要删除用户 ${username} 吗？`)) return;
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
                alert('用户已删除');
                const targetPage = adminUserPage > 1 && allUsers.length <= 1
                    ? adminUserPage - 1
                    : adminUserPage;
                fetchAllUsers(targetPage, adminUserSearchKeyword);
            } else {
                const data = await response.json();
                alert(data.error || '删除失败');
            }
        } catch (error) {
            console.error('删除用户失败:', error);
            alert('删除失败');
        }
    }, [adminUserPage, adminUserSearchKeyword, allUsers.length, fetchAllUsers]);

    const refreshUsers = useCallback(() => {
        fetchAllUsers(adminUserPage, adminUserSearchKeyword);
    }, [adminUserPage, adminUserSearchKeyword, fetchAllUsers]);

    const goToPrevUserPage = useCallback(() => {
        fetchAllUsers(adminUserPagination.page - 1, adminUserSearchKeyword);
    }, [adminUserPagination.page, adminUserSearchKeyword, fetchAllUsers]);

    const goToNextUserPage = useCallback(() => {
        fetchAllUsers(adminUserPagination.page + 1, adminUserSearchKeyword);
    }, [adminUserPagination.page, adminUserSearchKeyword, fetchAllUsers]);

    return {
        allUsers,
        adminUserPagination,
        adminUserPageSize,
        isAdminUserLoading,
        adminUserSearchInput,
        adminUserSearchKeyword,
        adminUserActionFeedback,
        editingUser,
        editForm,
        setEditForm,
        setEditingUser,
        setAdminUserSearchInput,
        fetchAllUsers,
        submitAdminUserSearch,
        clearAdminUserSearch,
        handleAdminUserPageSizeChange,
        startEditUser,
        saveUserEdit,
        deleteUser,
        refreshUsers,
        goToPrevUserPage,
        goToNextUserPage
    };
};

export default useAdminUsersFeature;
