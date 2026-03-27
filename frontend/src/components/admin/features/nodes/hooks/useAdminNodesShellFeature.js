import { useCallback, useState } from 'react';
import { API_BASE } from '../../../../../runtimeConfig';

const ADMIN_DOMAIN_PAGE_SIZE = 20;

const createEmptyNodeEditForm = () => ({
    name: '',
    description: '',
    knowledgePoint: 0,
    prosperity: 0,
    resources: { food: 0, metal: 0, energy: 0 },
    productionRates: { food: 0, metal: 0, energy: 0 },
    contentScore: 1
});

const useAdminNodesShellFeature = () => {
    const [allNodes, setAllNodes] = useState([]);
    const [adminDomainPage, setAdminDomainPage] = useState(1);
    const [adminDomainPagination, setAdminDomainPagination] = useState({
        page: 1,
        pageSize: ADMIN_DOMAIN_PAGE_SIZE,
        total: 0,
        totalPages: 0
    });
    const [isAdminDomainLoading, setIsAdminDomainLoading] = useState(false);
    const [adminDomainSearchInput, setAdminDomainSearchInput] = useState('');
    const [adminDomainSearchKeyword, setAdminDomainSearchKeyword] = useState('');
    const [adminDomainPageSize, setAdminDomainPageSize] = useState(ADMIN_DOMAIN_PAGE_SIZE);
    const [editingNode, setEditingNode] = useState(null);
    const [editNodeForm, setEditNodeForm] = useState(createEmptyNodeEditForm);
    const [showEditNodeModal, setShowEditNodeModal] = useState(false);
    const [isSavingNodeEdit, setIsSavingNodeEdit] = useState(false);
    const [editingSenseToken, setEditingSenseToken] = useState('');
    const [editingSenseForm, setEditingSenseForm] = useState({ title: '' });
    const [editingSenseActionToken, setEditingSenseActionToken] = useState('');
    const [showChangeMasterModal, setShowChangeMasterModal] = useState(false);
    const [changingMasterNode, setChangingMasterNode] = useState(null);
    const [masterSearchKeyword, setMasterSearchKeyword] = useState('');
    const [masterSearchResults, setMasterSearchResults] = useState([]);
    const [isMasterSearchLoading, setIsMasterSearchLoading] = useState(false);
    const [hasMasterSearchTriggered, setHasMasterSearchTriggered] = useState(false);
    const [selectedNewMaster, setSelectedNewMaster] = useState(null);

    const fetchAllNodes = useCallback(async (
        page = adminDomainPage,
        keyword = adminDomainSearchKeyword,
        pageSize = adminDomainPageSize,
        options = {}
    ) => {
        const token = localStorage.getItem('token');
        const requestedPage = Number.parseInt(page, 10);
        const safePage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : adminDomainPage;
        const requestedPageSize = Number.parseInt(pageSize, 10);
        const safePageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0 ? requestedPageSize : adminDomainPageSize;
        const normalizedKeyword = typeof keyword === 'string' ? keyword.trim() : '';
        const requestLatest = options?.forceLatest !== false;
        setIsAdminDomainLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(Math.max(1, safePage)),
                pageSize: String(Math.max(1, safePageSize))
            });
            if (requestLatest) {
                params.set('latest', '1');
            }
            if (normalizedKeyword) {
                params.set('keyword', normalizedKeyword);
            }
            const response = await fetch(`${API_BASE}/nodes?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                const nextPage = Math.max(1, parseInt(data?.page, 10) || Math.max(1, safePage));
                const nextPageSize = Math.max(1, parseInt(data?.pageSize, 10) || Math.max(1, safePageSize));
                const total = Math.max(0, parseInt(data?.total, 10) || 0);
                const totalPages = Math.max(0, Math.ceil(total / nextPageSize));
                setAllNodes(Array.isArray(data?.nodes) ? data.nodes : []);
                setAdminDomainPagination({
                    page: nextPage,
                    pageSize: nextPageSize,
                    total,
                    totalPages
                });
                setAdminDomainPage(nextPage);
                setAdminDomainPageSize(nextPageSize);
            }
        } catch (error) {
            console.error('获取节点列表失败:', error);
        } finally {
            setIsAdminDomainLoading(false);
        }
    }, [adminDomainPage, adminDomainPageSize, adminDomainSearchKeyword]);

    const refreshAdminDomainLatest = useCallback(() => {
        fetchAllNodes(adminDomainPage, adminDomainSearchKeyword, adminDomainPageSize, { forceLatest: true });
    }, [adminDomainPage, adminDomainPageSize, adminDomainSearchKeyword, fetchAllNodes]);

    const submitAdminDomainSearch = useCallback(() => {
        const normalizedKeyword = adminDomainSearchInput.trim();
        setAdminDomainSearchKeyword(normalizedKeyword);
        fetchAllNodes(1, normalizedKeyword, adminDomainPageSize);
    }, [adminDomainPageSize, adminDomainSearchInput, fetchAllNodes]);

    const clearAdminDomainSearch = useCallback(() => {
        setAdminDomainSearchInput('');
        setAdminDomainSearchKeyword('');
        fetchAllNodes(1, '', adminDomainPageSize);
    }, [adminDomainPageSize, fetchAllNodes]);

    const handleAdminDomainPageSizeChange = useCallback((nextPageSize) => {
        const parsedPageSize = Number.parseInt(nextPageSize, 10);
        if (!Number.isInteger(parsedPageSize) || parsedPageSize <= 0) return;
        setAdminDomainPageSize(parsedPageSize);
        fetchAllNodes(1, adminDomainSearchKeyword, parsedPageSize);
    }, [adminDomainSearchKeyword, fetchAllNodes]);

    const startEditNode = useCallback((node) => {
        setEditingNode(node._id);
        setEditNodeForm({
            name: node.name,
            description: node.description || '',
            knowledgePoint: Number(node?.knowledgePoint?.value || 0),
            prosperity: node.prosperity || 100,
            resources: {
                food: node.resources?.food || 0,
                metal: node.resources?.metal || 0,
                energy: node.resources?.energy || 0
            },
            productionRates: {
                food: node.productionRates?.food || 0,
                metal: node.productionRates?.metal || 0,
                energy: node.productionRates?.energy || 0
            },
            contentScore: node.contentScore || 1
        });
        setShowEditNodeModal(true);
    }, []);

    const closeEditNodeModal = useCallback(() => {
        if (isSavingNodeEdit) return;
        setShowEditNodeModal(false);
        setEditingNode(null);
    }, [isSavingNodeEdit]);

    const saveNodeEdit = useCallback(async (nodeId = editingNode) => {
        if (!nodeId) return;
        const trimmedName = String(editNodeForm.name || '').trim();
        const trimmedDescription = String(editNodeForm.description || '').trim();
        const parsedKnowledgePoint = Number(editNodeForm.knowledgePoint);
        const parsedProsperity = Number(editNodeForm.prosperity);
        const parsedContentScore = Number(editNodeForm.contentScore);
        if (!trimmedName) {
            alert('标题不能为空');
            return;
        }
        if (!trimmedDescription) {
            alert('概述不能为空');
            return;
        }
        if (!Number.isFinite(parsedKnowledgePoint) || parsedKnowledgePoint < 0) {
            alert('知识点必须是大于等于 0 的数字');
            return;
        }
        if (!Number.isFinite(parsedProsperity) || parsedProsperity < 0) {
            alert('繁荣度必须是大于等于 0 的数字');
            return;
        }
        if (!Number.isFinite(parsedContentScore) || parsedContentScore < 1) {
            alert('内容分数至少为 1');
            return;
        }
        const token = localStorage.getItem('token');
        setIsSavingNodeEdit(true);
        try {
            const response = await fetch(`${API_BASE}/nodes/${nodeId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: trimmedName,
                    description: trimmedDescription,
                    knowledgePoint: Number(parsedKnowledgePoint.toFixed(2)),
                    prosperity: Math.round(parsedProsperity),
                    contentScore: Math.round(parsedContentScore)
                })
            });
            if (response.ok) {
                alert('节点信息已更新');
                setShowEditNodeModal(false);
                setEditingNode(null);
                fetchAllNodes(adminDomainPage, adminDomainSearchKeyword);
            } else {
                const data = await response.json();
                alert(data.error || '更新失败');
            }
        } catch (error) {
            console.error('更新节点失败:', error);
            alert('更新失败');
        } finally {
            setIsSavingNodeEdit(false);
        }
    }, [adminDomainPage, adminDomainSearchKeyword, editNodeForm, editingNode, fetchAllNodes]);

    const getSenseEditToken = useCallback((nodeId, senseId) => (
        `${String(nodeId || '')}:${String(senseId || '')}`
    ), []);

    const startEditSenseText = useCallback((node, sense) => {
        const token = getSenseEditToken(node?._id, sense?.senseId);
        if (!token) return;
        setEditingSenseToken(token);
        setEditingSenseForm({
            title: sense?.title || ''
        });
    }, [getSenseEditToken]);

    const cancelEditSenseText = useCallback(() => {
        if (editingSenseActionToken) return;
        setEditingSenseToken('');
        setEditingSenseForm({ title: '' });
    }, [editingSenseActionToken]);

    const saveSenseTextEdit = useCallback(async (node, sense) => {
        const nodeId = node?._id;
        const senseId = sense?.senseId;
        if (!nodeId || !senseId) return;
        const token = getSenseEditToken(nodeId, senseId);
        const title = String(editingSenseForm.title || '').trim();
        if (!title) {
            alert('释义题目不能为空');
            return;
        }
        setEditingSenseActionToken(token);
        const authToken = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE}/nodes/${nodeId}/admin/senses/${encodeURIComponent(senseId)}/text`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authToken}`
                },
                body: JSON.stringify({ title })
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data?.error || '释义编辑失败');
                return;
            }
            alert(data?.message || '释义已更新');
            setEditingSenseToken('');
            setEditingSenseForm({ title: '' });
            fetchAllNodes(adminDomainPage, adminDomainSearchKeyword);
        } catch (error) {
            console.error('释义编辑失败:', error);
            alert('释义编辑失败');
        } finally {
            setEditingSenseActionToken('');
        }
    }, [adminDomainPage, adminDomainSearchKeyword, editingSenseForm.title, fetchAllNodes, getSenseEditToken]);

    const toggleFeaturedNode = useCallback(async (nodeId, currentFeatured) => {
        const token = localStorage.getItem('token');
        const action = currentFeatured ? '取消热门' : '设置为热门';
        if (!window.confirm(`确定要${action}吗？`)) return;

        let featuredOrder = 0;
        if (!currentFeatured) {
            const orderInput = window.prompt('请输入热门节点的排序（数字越小越靠前）：', '0');
            if (orderInput === null) return;
            featuredOrder = parseInt(orderInput, 10) || 0;
        }

        try {
            const response = await fetch(`${API_BASE}/nodes/${nodeId}/featured`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    isFeatured: !currentFeatured,
                    featuredOrder
                })
            });
            if (response.ok) {
                const data = await response.json();
                alert(data.message);
                fetchAllNodes(adminDomainPage, adminDomainSearchKeyword);
            } else {
                const data = await response.json();
                alert(data.error || '操作失败');
            }
        } catch (error) {
            console.error('设置热门节点失败:', error);
            alert('操作失败');
        }
    }, [adminDomainPage, adminDomainSearchKeyword, fetchAllNodes]);

    const searchUsersForMaster = useCallback(async (keyword) => {
        const normalizedKeyword = typeof keyword === 'string' ? keyword.trim() : '';
        if (!normalizedKeyword) {
            setMasterSearchResults([]);
            setIsMasterSearchLoading(false);
            setHasMasterSearchTriggered(false);
            return;
        }
        const token = localStorage.getItem('token');
        setIsMasterSearchLoading(true);
        setHasMasterSearchTriggered(true);
        try {
            const response = await fetch(`${API_BASE}/nodes/admin/search-users?keyword=${encodeURIComponent(normalizedKeyword)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setMasterSearchResults(data.users);
            } else {
                setMasterSearchResults([]);
            }
        } catch (error) {
            console.error('搜索用户失败:', error);
            setMasterSearchResults([]);
        } finally {
            setIsMasterSearchLoading(false);
        }
    }, []);

    const openChangeMasterModal = useCallback((node) => {
        setChangingMasterNode(node);
        setSelectedNewMaster(node.domainMaster || null);
        setMasterSearchKeyword('');
        setMasterSearchResults([]);
        setHasMasterSearchTriggered(false);
        setShowChangeMasterModal(true);
    }, []);

    const confirmChangeMaster = useCallback(async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE}/nodes/admin/domain-master/${changingMasterNode._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    domainMasterId: selectedNewMaster?._id || null
                })
            });
            const data = await response.json();
            if (response.ok) {
                alert(data.message);
                setShowChangeMasterModal(false);
                fetchAllNodes(adminDomainPage, adminDomainSearchKeyword);
            } else {
                alert(data.error || '更换失败');
            }
        } catch (error) {
            console.error('更换域主失败:', error);
            alert('更换失败');
        }
    }, [adminDomainPage, adminDomainSearchKeyword, changingMasterNode, fetchAllNodes, selectedNewMaster]);

    return {
        allNodes,
        adminDomainPage,
        adminDomainPagination,
        isAdminDomainLoading,
        adminDomainSearchInput,
        adminDomainSearchKeyword,
        adminDomainPageSize,
        editingNode,
        editNodeForm,
        showEditNodeModal,
        isSavingNodeEdit,
        editingSenseToken,
        editingSenseForm,
        editingSenseActionToken,
        showChangeMasterModal,
        changingMasterNode,
        masterSearchKeyword,
        masterSearchResults,
        isMasterSearchLoading,
        hasMasterSearchTriggered,
        selectedNewMaster,
        setAdminDomainSearchInput,
        setEditNodeForm,
        setEditingSenseForm,
        setMasterSearchKeyword,
        setMasterSearchResults,
        setHasMasterSearchTriggered,
        setSelectedNewMaster,
        setShowChangeMasterModal,
        fetchAllNodes,
        refreshAdminDomainLatest,
        submitAdminDomainSearch,
        clearAdminDomainSearch,
        handleAdminDomainPageSizeChange,
        startEditNode,
        closeEditNodeModal,
        saveNodeEdit,
        getSenseEditToken,
        startEditSenseText,
        cancelEditSenseText,
        saveSenseTextEdit,
        toggleFeaturedNode,
        searchUsersForMaster,
        openChangeMasterModal,
        confirmChangeMaster
    };
};

export default useAdminNodesShellFeature;
