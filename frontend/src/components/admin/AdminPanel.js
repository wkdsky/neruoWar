import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Users, Zap, Bell, Shield, Check, X, Search, Plus, AlertTriangle, ChevronDown, ChevronUp, Settings } from 'lucide-react';
import MiniPreviewRenderer from '../modals/MiniPreviewRenderer';
import AssociationAddFlowEditor from '../shared/AssociationAddFlowEditor';
import {
    ASSOC_STEPS,
    ASSOC_RELATION_TYPES,
    parseAssociationKeyword,
    resolveAssociationNextStep,
    resolveAssociationBackStep
} from '../shared/associationFlowShared';
import './Admin.css';

const REL_SYMBOL_SUPERSET = '⊇';
const REL_SYMBOL_SUBSET = '⊆';

const UNIT_TYPE_ID_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;
const CATALOG_ID_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;
const ADMIN_ALLIANCE_PAGE_SIZE = 20;
const ADMIN_USER_PAGE_SIZE = 50;
const ADMIN_DOMAIN_PAGE_SIZE = 20;
const ADMIN_USER_PAGE_SIZE_OPTIONS = [10, 20, 30, 50];
const ADMIN_DOMAIN_PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 30];

const createEmptyUnitTypeForm = () => ({
    unitTypeId: '',
    name: '',
    roleTag: '近战',
    speed: '1',
    hp: '120',
    atk: '20',
    def: '10',
    range: '1',
    costKP: '10',
    level: '1',
    nextUnitTypeId: '',
    upgradeCostKP: '',
    sortOrder: '0'
});

const createEmptyBattlefieldItemForm = () => ({
    itemId: '',
    name: '',
    initialCount: '0',
    width: '104',
    depth: '24',
    height: '42',
    hp: '240',
    defense: '1.1',
    sortOrder: '0',
    enabled: true,
    styleText: '{}'
});

const createEmptyCityBuildingTypeForm = () => ({
    buildingTypeId: '',
    name: '',
    initialCount: '0',
    radius: '0.17',
    level: '1',
    nextUnitTypeId: '',
    upgradeCostKP: '',
    sortOrder: '0',
    enabled: true,
    styleText: '{}'
});

const createLocalId = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const buildSenseKey = (nodeId = '', senseId = '') => {
    const safeNodeId = String(nodeId || '').trim();
    const safeSenseId = String(senseId || '').trim();
    if (!safeNodeId || !safeSenseId) return '';
    return `${safeNodeId}:${safeSenseId}`;
};

const createEmptyNewSenseForm = () => ({
    title: '',
    content: '',
    relationType: ASSOC_RELATION_TYPES.CONTAINS,
    selectedTarget: null,
    insertLeftTarget: null,
    insertRightTarget: null,
    insertDirection: ASSOC_RELATION_TYPES.CONTAINS,
    insertDirectionLocked: false,
    insertDirectionHint: '先选择左右释义，再确认插入关系。',
    relations: []
});

const createEmptyNewSenseAssocFlow = () => ({
    currentStep: null,
    searchKeyword: '',
    searchAppliedKeyword: '',
    searchLoading: false,
    searchResults: [],
    selectedNodeA: null,
    selectedNodeASenseId: '',
    selectedRelationType: '',
    selectedNodeB: null,
    selectedNodeBSenseId: '',
    nodeBCandidates: { parents: [], children: [] },
    nodeBSearchAppliedKeyword: '',
    insertDirection: 'aToB',
    insertDirectionLocked: false
});

const normalizeSenseSearchTarget = (item = {}) => ({
    nodeId: item?.nodeId || item?._id || '',
    senseId: typeof item?.senseId === 'string' ? item.senseId : '',
    displayName: item?.displayName || item?.name || '',
    domainName: item?.domainName || item?.name || '',
    senseTitle: item?.senseTitle || item?.activeSenseTitle || '',
    description: item?.senseContent || item?.description || '',
    searchKey: item?.searchKey || buildSenseKey(item?.nodeId || item?._id || '', item?.senseId || ''),
    relationToAnchor: item?.relationToAnchor || ''
});

const matchKeywordByDomainAndSense = (item = {}, textKeyword = '') => {
    const normalized = String(textKeyword || '').trim().toLowerCase();
    if (!normalized) return true;
    const keywords = normalized.split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return true;
    const haystack = `${item?.displayName || ''} ${item?.domainName || ''} ${item?.senseTitle || ''}`.toLowerCase();
    return keywords.every((keyword) => haystack.includes(keyword));
};

const AdminPanel = ({ initialTab = 'users', onPendingMasterApplyHandled, onCreateNode }) => {
    const [adminTab, setAdminTab] = useState(initialTab);
    
    // User Management State
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
    const [editForm, setEditForm] = useState({
        username: '',
        password: '',
        level: 0,
        experience: 0,
        knowledgeBalance: '0'
    });
    const [travelUnitSeconds, setTravelUnitSeconds] = useState(60);
    const [travelUnitInput, setTravelUnitInput] = useState('60');
    const [distributionAnnouncementLeadHours, setDistributionAnnouncementLeadHours] = useState(24);
    const [distributionLeadInput, setDistributionLeadInput] = useState('24');
    const [armyUnitTypes, setArmyUnitTypes] = useState([]);
    const [isCreatingUnitType, setIsCreatingUnitType] = useState(false);
    const [editingUnitTypeId, setEditingUnitTypeId] = useState('');
    const [unitTypeForm, setUnitTypeForm] = useState(createEmptyUnitTypeForm);
    const [unitTypeActionId, setUnitTypeActionId] = useState('');
    const [battlefieldItems, setBattlefieldItems] = useState([]);
    const [isCreatingBattlefieldItem, setIsCreatingBattlefieldItem] = useState(false);
    const [editingBattlefieldItemId, setEditingBattlefieldItemId] = useState('');
    const [battlefieldItemForm, setBattlefieldItemForm] = useState(createEmptyBattlefieldItemForm);
    const [battlefieldItemActionId, setBattlefieldItemActionId] = useState('');
    const [cityBuildingTypes, setCityBuildingTypes] = useState([]);
    const [isCreatingCityBuildingType, setIsCreatingCityBuildingType] = useState(false);
    const [editingCityBuildingTypeId, setEditingCityBuildingTypeId] = useState('');
    const [cityBuildingTypeForm, setCityBuildingTypeForm] = useState(createEmptyCityBuildingTypeForm);
    const [cityBuildingTypeActionId, setCityBuildingTypeActionId] = useState('');

    // Node Management State
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
    const [editNodeForm, setEditNodeForm] = useState({
        name: '',
        description: '',
        knowledgePoint: 0,
        prosperity: 0,
        resources: { food: 0, metal: 0, energy: 0 },
        productionRates: { food: 0, metal: 0, energy: 0 },
        contentScore: 1
    });
    const [showEditNodeModal, setShowEditNodeModal] = useState(false);
    const [showAddSenseModal, setShowAddSenseModal] = useState(false);
    const [addingSenseNode, setAddingSenseNode] = useState(null);
    const [newSenseForm, setNewSenseForm] = useState(createEmptyNewSenseForm);
    const [newSenseAssocFlow, setNewSenseAssocFlow] = useState(createEmptyNewSenseAssocFlow);
    const newSenseAssocPreviewCanvasRef = useRef(null);
    const newSenseAssocPreviewRendererRef = useRef(null);
    const [isSavingNewSense, setIsSavingNewSense] = useState(false);
    const [isSavingNodeEdit, setIsSavingNodeEdit] = useState(false);
    const [editingSenseToken, setEditingSenseToken] = useState('');
    const [editingSenseForm, setEditingSenseForm] = useState({ title: '', content: '' });
    const [editingSenseActionToken, setEditingSenseActionToken] = useState('');
    const [showDeleteSenseModal, setShowDeleteSenseModal] = useState(false);
    const [deletingSenseContext, setDeletingSenseContext] = useState(null);
    const [deleteSensePreviewData, setDeleteSensePreviewData] = useState(null);
    const [deleteSensePreviewLoading, setDeleteSensePreviewLoading] = useState(false);
    const [deleteSenseBridgeDecisions, setDeleteSenseBridgeDecisions] = useState({});
    const [showDeleteSenseDecisionModal, setShowDeleteSenseDecisionModal] = useState(false);
    const [deleteSenseDecisionPair, setDeleteSenseDecisionPair] = useState(null);
    const [deleteSenseDecisionApplying, setDeleteSenseDecisionApplying] = useState(false);
    const [isDeletingSense, setIsDeletingSense] = useState(false);
    const [showDeleteNodeConfirmModal, setShowDeleteNodeConfirmModal] = useState(false);
    const [deletingNodeTarget, setDeletingNodeTarget] = useState(null);
    const [isDeletingNode, setIsDeletingNode] = useState(false);
    const [deletePreviewData, setDeletePreviewData] = useState(null);
    const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
    const [deleteBridgeDecisions, setDeleteBridgeDecisions] = useState({});
    const [pendingNodes, setPendingNodes] = useState([]);
    const [pendingNodeActionId, setPendingNodeActionId] = useState('');
    const [pendingNodeActionGroupName, setPendingNodeActionGroupName] = useState('');
    const [pendingNodeSelectedSenseByNodeId, setPendingNodeSelectedSenseByNodeId] = useState({});
    const [pendingMasterApplications, setPendingMasterApplications] = useState([]);
    const [masterApplyActionId, setMasterApplyActionId] = useState('');

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

    // 将待审核节点按名称分组
    const groupedPendingNodes = useMemo(() => {
        const groups = {};
        pendingNodes.forEach(node => {
            const name = node.name;
            if (!groups[name]) {
                groups[name] = [];
            }
            groups[name].push(node);
        });
        // 转换为数组，同名的排在前面（优先显示有竞争的）
        return Object.entries(groups)
            .map(([name, nodes]) => ({ name, nodes, hasConflict: nodes.length > 1 }))
            .sort((a, b) => {
                // 有冲突的优先显示
                if (a.hasConflict && !b.hasConflict) return -1;
                if (!a.hasConflict && b.hasConflict) return 1;
                // 同样冲突状态的按提交时间排序
                return new Date(b.nodes[0].createdAt) - new Date(a.nodes[0].createdAt);
            });
    }, [pendingNodes]);

    const groupedPendingMasterApplications = useMemo(() => {
        const groups = {};
        pendingMasterApplications.forEach((application) => {
            const nodeId = application.nodeId || `unknown_${application._id}`;
            if (!groups[nodeId]) {
                groups[nodeId] = {
                    nodeId,
                    nodeName: application.nodeName || '知识域',
                    applications: [],
                    hasConflict: false
                };
            }
            groups[nodeId].applications.push(application);
        });

        return Object.values(groups)
            .map((group) => ({
                ...group,
                hasConflict: group.applications.length > 1
            }))
            .sort((a, b) => {
                const aTime = new Date(a.applications[0]?.createdAt || 0).getTime();
                const bTime = new Date(b.applications[0]?.createdAt || 0).getTime();
                return bTime - aTime;
            });
    }, [pendingMasterApplications]);

    const pendingApprovalCount = pendingNodes.length + pendingMasterApplications.length;

    // Master Change State
    const [showChangeMasterModal, setShowChangeMasterModal] = useState(false);
    const [changingMasterNode, setChangingMasterNode] = useState(null);
    const [masterSearchKeyword, setMasterSearchKeyword] = useState('');
    const [masterSearchResults, setMasterSearchResults] = useState([]);
    const [isMasterSearchLoading, setIsMasterSearchLoading] = useState(false);
    const [hasMasterSearchTriggered, setHasMasterSearchTriggered] = useState(false);
    const [selectedNewMaster, setSelectedNewMaster] = useState(null);

    // Alliance Management State
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
    const [editAllianceForm, setEditAllianceForm] = useState({
        name: '',
        flag: '',
        declaration: '',
        knowledgeReserve: '0',
        memberIds: []
    });
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

    // Association View/Edit State
    const [showEditAssociationModal, setShowEditAssociationModal] = useState(false);
    const [editingAssociationNode, setEditingAssociationNode] = useState(null);
    const [editAssociations, setEditAssociations] = useState([]);
    const [assocSearchKeyword, setAssocSearchKeyword] = useState('');
    const [assocSearchAppliedKeyword, setAssocSearchAppliedKeyword] = useState('');
    const [assocSearchResults, setAssocSearchResults] = useState([]);
    const [assocSearchLoading, setAssocSearchLoading] = useState(false);
    const [isEditAssociationListExpanded, setIsEditAssociationListExpanded] = useState(true);

    const [assocCurrentStep, setAssocCurrentStep] = useState(null);
    const [assocSelectedNodeA, setAssocSelectedNodeA] = useState(null);
    const [assocSelectedRelationType, setAssocSelectedRelationType] = useState(null);
    const [assocSelectedNodeB, setAssocSelectedNodeB] = useState(null);
    const [assocInsertDirection, setAssocInsertDirection] = useState(null);
    const [editingAssociationSenseId, setEditingAssociationSenseId] = useState('');
    const [assocSelectedSourceSenseId, setAssocSelectedSourceSenseId] = useState('');
    const [assocSelectedNodeASenseId, setAssocSelectedNodeASenseId] = useState('');
    const [assocSelectedNodeBSenseId, setAssocSelectedNodeBSenseId] = useState('');
    const [assocNodeBCandidates, setAssocNodeBCandidates] = useState({ parents: [], children: [] });
    const [assocNodeBSearchKeyword, setAssocNodeBSearchKeyword] = useState('');
    const [assocNodeBSearchAppliedKeyword, setAssocNodeBSearchAppliedKeyword] = useState('');
    const [assocEditingIndex, setAssocEditingIndex] = useState(null);
    const assocEditRequestIdRef = useRef(0);
    const assocNodeBSearchRequestIdRef = useRef(0);
    const assocNodeBCandidateRequestIdRef = useRef(0);
    const [assocApplyLoading, setAssocApplyLoading] = useState(false);
    const [assocBridgeDecisions, setAssocBridgeDecisions] = useState({});
    const [showAssocDeleteDecisionModal, setShowAssocDeleteDecisionModal] = useState(false);
    const [assocDeleteDecisionContext, setAssocDeleteDecisionContext] = useState(null);
    const [assocDeleteDecisionAction, setAssocDeleteDecisionAction] = useState('disconnect');
    const [assocDeleteSearchKeyword, setAssocDeleteSearchKeyword] = useState('');
    const [assocDeleteSearchAppliedKeyword, setAssocDeleteSearchAppliedKeyword] = useState('');
    const [assocDeleteSearchResults, setAssocDeleteSearchResults] = useState([]);
    const [assocDeleteSearchLoading, setAssocDeleteSearchLoading] = useState(false);
    const [assocDeleteSelectedTarget, setAssocDeleteSelectedTarget] = useState(null);
    const [assocDeleteApplying, setAssocDeleteApplying] = useState(false);
    const assocDeleteSearchRequestIdRef = useRef(0);

    const assocPreviewCanvasRef = useRef(null);
    const assocPreviewRendererRef = useRef(null);
    const relationContextCacheRef = useRef(new Map());

    // Initial Fetch
    useEffect(() => {
        fetchPendingNodes();
        fetchPendingMasterApplications();
        fetchAllUsers(1);
        fetchAllNodes(1);
        fetchAdminSettings();
        fetchArmyUnitTypes();
        fetchBattlefieldItemCatalog();
        fetchCityBuildingTypeCatalog();
    }, []);

    // --- User Management Functions ---
    const fetchAllUsers = async (page = adminUserPage, keyword = adminUserSearchKeyword, pageSize = adminUserPageSize) => {
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
            const response = await fetch(`http://localhost:5000/api/admin/users?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
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
    };

    const submitAdminUserSearch = () => {
        const normalizedKeyword = adminUserSearchInput.trim();
        setAdminUserSearchKeyword(normalizedKeyword);
        setAdminUserPage(1);
        fetchAllUsers(1, normalizedKeyword, adminUserPageSize);
    };

    const clearAdminUserSearch = () => {
        setAdminUserSearchInput('');
        setAdminUserSearchKeyword('');
        setAdminUserPage(1);
        fetchAllUsers(1, '', adminUserPageSize);
    };

    const handleAdminUserPageSizeChange = (nextPageSize) => {
        const parsedPageSize = Number.parseInt(nextPageSize, 10);
        if (!Number.isInteger(parsedPageSize) || parsedPageSize <= 0) return;
        setAdminUserPageSize(parsedPageSize);
        setAdminUserPage(1);
        fetchAllUsers(1, adminUserSearchKeyword, parsedPageSize);
    };

    const startEditUser = (user) => {
        setEditingUser(user._id);
        setEditForm({
            username: user.username,
            // 编辑时默认留空，避免把展示值误当作新密码提交
            password: '',
            level: user.level,
            experience: user.experience,
            knowledgeBalance: String(
                Number.isFinite(Number(user.knowledgeBalance))
                    ? Number(user.knowledgeBalance)
                    : 0
            )
        });
    };

    const saveUserEdit = async (userId) => {
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
            const response = await fetch(`http://localhost:5000/api/admin/users/${userId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
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
    };

    const deleteUser = async (userId, username) => {
        if (!window.confirm(`确定要删除用户 ${username} 吗？`)) return;
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/admin/users/${userId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
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
    };

    const fetchAdminSettings = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/admin/settings', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                const seconds = String(data?.settings?.travelUnitSeconds ?? 60);
                const leadHours = String(data?.settings?.distributionAnnouncementLeadHours ?? 24);
                setTravelUnitSeconds(parseInt(seconds, 10));
                setTravelUnitInput(seconds);
                setDistributionAnnouncementLeadHours(parseInt(leadHours, 10));
                setDistributionLeadInput(leadHours);
            }
        } catch (error) {
            console.error('获取系统设置失败:', error);
        }
    };

    const saveAdminSettings = async () => {
        const token = localStorage.getItem('token');
        const parsed = parseInt(travelUnitInput, 10);
        const parsedLeadHours = parseInt(distributionLeadInput, 10);

        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 86400) {
            alert('每单位移动耗时必须是 1-86400 的整数秒');
            return;
        }
        if (!Number.isInteger(parsedLeadHours) || parsedLeadHours < 1 || parsedLeadHours > 168) {
            alert('分发公告提前时长必须是 1-168 的整数小时');
            return;
        }

        try {
            const response = await fetch('http://localhost:5000/api/admin/settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    travelUnitSeconds: parsed,
                    distributionAnnouncementLeadHours: parsedLeadHours
                })
            });
            if (response.ok) {
                const data = await response.json();
                const seconds = parseInt(String(data?.settings?.travelUnitSeconds ?? parsed), 10);
                const leadHours = parseInt(String(data?.settings?.distributionAnnouncementLeadHours ?? parsedLeadHours), 10);
                setTravelUnitSeconds(seconds);
                setTravelUnitInput(String(seconds));
                setDistributionAnnouncementLeadHours(leadHours);
                setDistributionLeadInput(String(leadHours));
                alert('系统设置已保存');
            } else {
                const data = await response.json();
                alert(data.error || '保存失败');
            }
        } catch (error) {
            console.error('保存系统设置失败:', error);
            alert('保存失败');
        }
    };

    const fetchArmyUnitTypes = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/admin/army/unit-types', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            setArmyUnitTypes(Array.isArray(data.unitTypes) ? data.unitTypes : []);
        } catch (error) {
            console.error('获取兵种列表失败:', error);
        }
    };

    const resetUnitTypeEditor = () => {
        setIsCreatingUnitType(false);
        setEditingUnitTypeId('');
        setUnitTypeForm(createEmptyUnitTypeForm());
    };

    const startCreateUnitType = () => {
        setIsCreatingUnitType(true);
        setEditingUnitTypeId('');
        setUnitTypeForm(createEmptyUnitTypeForm());
    };

    const startEditUnitType = (unitType) => {
        setIsCreatingUnitType(false);
        setEditingUnitTypeId(unitType.unitTypeId);
        setUnitTypeForm({
            unitTypeId: unitType.unitTypeId || '',
            name: unitType.name || '',
            roleTag: unitType.roleTag || '近战',
            speed: String(unitType.speed ?? 1),
            hp: String(unitType.hp ?? 120),
            atk: String(unitType.atk ?? 20),
            def: String(unitType.def ?? 10),
            range: String(unitType.range ?? 1),
            costKP: String(unitType.costKP ?? 10),
            level: String(unitType.level ?? 1),
            nextUnitTypeId: unitType.nextUnitTypeId || '',
            upgradeCostKP: unitType.upgradeCostKP === null || unitType.upgradeCostKP === undefined
                ? ''
                : String(unitType.upgradeCostKP),
            sortOrder: String(unitType.sortOrder ?? 0)
        });
    };

    const buildUnitTypePayload = (form, includeUnitTypeId) => {
        const payload = {
            name: form.name.trim(),
            roleTag: form.roleTag,
            speed: Number(form.speed),
            hp: Number(form.hp),
            atk: Number(form.atk),
            def: Number(form.def),
            range: Number(form.range),
            costKP: Number(form.costKP),
            level: Number(form.level),
            nextUnitTypeId: form.nextUnitTypeId.trim() || null,
            upgradeCostKP: form.upgradeCostKP.trim() === '' ? null : Number(form.upgradeCostKP),
            sortOrder: Number(form.sortOrder)
        };

        if (includeUnitTypeId) {
            payload.unitTypeId = form.unitTypeId.trim();
        }
        return payload;
    };

    const validateUnitTypeForm = (form, includeUnitTypeId) => {
        if (includeUnitTypeId && !UNIT_TYPE_ID_PATTERN.test(form.unitTypeId.trim())) {
            return '兵种ID格式不正确（2-64位字母/数字/下划线/中划线）';
        }
        if (!form.name.trim()) {
            return '兵种名称不能为空';
        }
        if (!['近战', '远程'].includes(form.roleTag)) {
            return 'roleTag 仅支持近战或远程';
        }

        const numericRules = [
            ['speed', 0, false],
            ['hp', 1, true],
            ['atk', 0, true],
            ['def', 0, true],
            ['range', 1, true],
            ['costKP', 1, true],
            ['level', 1, true]
        ];
        for (const [key, min, integer] of numericRules) {
            const value = Number(form[key]);
            if (!Number.isFinite(value)) return `${key} 必须为数字`;
            if (integer && !Number.isInteger(value)) return `${key} 必须为整数`;
            if (value < min) return `${key} 不能小于 ${min}`;
        }
        return '';
    };

    const saveUnitType = async () => {
        const token = localStorage.getItem('token');
        const isCreate = isCreatingUnitType;
        const validationError = validateUnitTypeForm(unitTypeForm, isCreate);
        if (validationError) {
            alert(validationError);
            return;
        }

        const payload = buildUnitTypePayload(unitTypeForm, isCreate);
        const actionId = isCreate ? '__create__' : editingUnitTypeId;
        setUnitTypeActionId(actionId);

        try {
            const response = await fetch(
                isCreate
                    ? 'http://localhost:5000/api/admin/army/unit-types'
                    : `http://localhost:5000/api/admin/army/unit-types/${editingUnitTypeId}`,
                {
                    method: isCreate ? 'POST' : 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                }
            );
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '保存失败');
                return;
            }
            alert(isCreate ? '兵种创建成功' : '兵种更新成功');
            resetUnitTypeEditor();
            fetchArmyUnitTypes();
        } catch (error) {
            console.error('保存兵种失败:', error);
            alert('保存失败');
        } finally {
            setUnitTypeActionId('');
        }
    };

    const deleteUnitType = async (unitType) => {
        if (!window.confirm(`确定删除兵种「${unitType.name}」吗？`)) return;
        const token = localStorage.getItem('token');
        setUnitTypeActionId(unitType.unitTypeId);
        try {
            const response = await fetch(`http://localhost:5000/api/admin/army/unit-types/${unitType.unitTypeId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '删除失败');
                return;
            }
            alert('兵种已删除');
            if (editingUnitTypeId === unitType.unitTypeId) {
                resetUnitTypeEditor();
            }
            fetchArmyUnitTypes();
        } catch (error) {
            console.error('删除兵种失败:', error);
            alert('删除失败');
        } finally {
            setUnitTypeActionId('');
        }
    };

    const parseStyleText = (styleTextRaw) => {
        const styleText = String(styleTextRaw || '').trim();
        if (!styleText) return {};
        try {
            const parsed = JSON.parse(styleText);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('style 必须是 JSON 对象');
            }
            return parsed;
        } catch (error) {
            throw new Error(`style 参数格式错误: ${error.message}`);
        }
    };

    const fetchBattlefieldItemCatalog = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/admin/catalog/items', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            setBattlefieldItems(Array.isArray(data?.items) ? data.items : []);
        } catch (error) {
            console.error('获取物品目录失败:', error);
        }
    };

    const resetBattlefieldItemEditor = () => {
        setIsCreatingBattlefieldItem(false);
        setEditingBattlefieldItemId('');
        setBattlefieldItemForm(createEmptyBattlefieldItemForm());
    };

    const startCreateBattlefieldItem = () => {
        setIsCreatingBattlefieldItem(true);
        setEditingBattlefieldItemId('');
        setBattlefieldItemForm(createEmptyBattlefieldItemForm());
    };

    const startEditBattlefieldItem = (item) => {
        setIsCreatingBattlefieldItem(false);
        setEditingBattlefieldItemId(item.itemId || '');
        setBattlefieldItemForm({
            itemId: item.itemId || '',
            name: item.name || '',
            initialCount: String(item.initialCount ?? 0),
            width: String(item.width ?? 104),
            depth: String(item.depth ?? 24),
            height: String(item.height ?? 42),
            hp: String(item.hp ?? 240),
            defense: String(item.defense ?? 1.1),
            sortOrder: String(item.sortOrder ?? 0),
            enabled: item.enabled !== false,
            styleText: JSON.stringify(item.style && typeof item.style === 'object' ? item.style : {}, null, 2)
        });
    };

    const buildBattlefieldItemPayload = (form, includeItemId) => {
        const payload = {
            name: String(form.name || '').trim(),
            initialCount: Number(form.initialCount),
            width: Number(form.width),
            depth: Number(form.depth),
            height: Number(form.height),
            hp: Number(form.hp),
            defense: Number(form.defense),
            sortOrder: Number(form.sortOrder),
            enabled: form.enabled !== false,
            style: parseStyleText(form.styleText)
        };
        if (includeItemId) payload.itemId = String(form.itemId || '').trim();
        return payload;
    };

    const validateBattlefieldItemForm = (form, includeItemId) => {
        const itemId = String(form.itemId || '').trim();
        if (includeItemId && !CATALOG_ID_PATTERN.test(itemId)) {
            return '物品ID格式不正确（2-64位字母/数字/下划线/中划线）';
        }
        if (!String(form.name || '').trim()) return '物品名称不能为空';
        const numericChecks = [
            ['initialCount', 0, true],
            ['width', 12, false],
            ['depth', 12, false],
            ['height', 10, false],
            ['hp', 1, true],
            ['defense', 0.1, false],
            ['sortOrder', Number.NEGATIVE_INFINITY, true]
        ];
        for (const [key, min, integer] of numericChecks) {
            const value = Number(form[key]);
            if (!Number.isFinite(value)) return `${key} 必须为数字`;
            if (integer && !Number.isInteger(value)) return `${key} 必须为整数`;
            if (value < min) return `${key} 不能小于 ${min}`;
        }
        try {
            parseStyleText(form.styleText);
        } catch (error) {
            return error.message;
        }
        return '';
    };

    const saveBattlefieldItem = async () => {
        const token = localStorage.getItem('token');
        const isCreate = isCreatingBattlefieldItem;
        const validationError = validateBattlefieldItemForm(battlefieldItemForm, isCreate);
        if (validationError) {
            alert(validationError);
            return;
        }
        const payload = buildBattlefieldItemPayload(battlefieldItemForm, isCreate);
        const actionId = isCreate ? '__create__' : editingBattlefieldItemId;
        setBattlefieldItemActionId(actionId);
        try {
            const response = await fetch(
                isCreate
                    ? 'http://localhost:5000/api/admin/catalog/items'
                    : `http://localhost:5000/api/admin/catalog/items/${editingBattlefieldItemId}`,
                {
                    method: isCreate ? 'POST' : 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                }
            );
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '保存失败');
                return;
            }
            alert(isCreate ? '物品创建成功' : '物品更新成功');
            resetBattlefieldItemEditor();
            fetchBattlefieldItemCatalog();
        } catch (error) {
            console.error('保存物品失败:', error);
            alert('保存失败');
        } finally {
            setBattlefieldItemActionId('');
        }
    };

    const deleteBattlefieldItem = async (item) => {
        if (!window.confirm(`确定删除物品「${item.name}」吗？`)) return;
        const token = localStorage.getItem('token');
        setBattlefieldItemActionId(item.itemId);
        try {
            const response = await fetch(`http://localhost:5000/api/admin/catalog/items/${item.itemId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '删除失败');
                return;
            }
            alert('物品已删除');
            if (editingBattlefieldItemId === item.itemId) {
                resetBattlefieldItemEditor();
            }
            fetchBattlefieldItemCatalog();
        } catch (error) {
            console.error('删除物品失败:', error);
            alert('删除失败');
        } finally {
            setBattlefieldItemActionId('');
        }
    };

    const fetchCityBuildingTypeCatalog = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/admin/catalog/buildings', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            setCityBuildingTypes(Array.isArray(data?.buildings) ? data.buildings : []);
        } catch (error) {
            console.error('获取建筑目录失败:', error);
        }
    };

    const resetCityBuildingTypeEditor = () => {
        setIsCreatingCityBuildingType(false);
        setEditingCityBuildingTypeId('');
        setCityBuildingTypeForm(createEmptyCityBuildingTypeForm());
    };

    const startCreateCityBuildingType = () => {
        setIsCreatingCityBuildingType(true);
        setEditingCityBuildingTypeId('');
        setCityBuildingTypeForm(createEmptyCityBuildingTypeForm());
    };

    const startEditCityBuildingType = (buildingType) => {
        setIsCreatingCityBuildingType(false);
        setEditingCityBuildingTypeId(buildingType.buildingTypeId || '');
        setCityBuildingTypeForm({
            buildingTypeId: buildingType.buildingTypeId || '',
            name: buildingType.name || '',
            initialCount: String(buildingType.initialCount ?? 0),
            radius: String(buildingType.radius ?? 0.17),
            level: String(buildingType.level ?? 1),
            nextUnitTypeId: buildingType.nextUnitTypeId || '',
            upgradeCostKP: buildingType.upgradeCostKP === null || buildingType.upgradeCostKP === undefined
                ? ''
                : String(buildingType.upgradeCostKP),
            sortOrder: String(buildingType.sortOrder ?? 0),
            enabled: buildingType.enabled !== false,
            styleText: JSON.stringify(buildingType.style && typeof buildingType.style === 'object' ? buildingType.style : {}, null, 2)
        });
    };

    const buildCityBuildingTypePayload = (form, includeId) => {
        const payload = {
            name: String(form.name || '').trim(),
            initialCount: Number(form.initialCount),
            radius: Number(form.radius),
            level: Number(form.level),
            nextUnitTypeId: String(form.nextUnitTypeId || '').trim(),
            sortOrder: Number(form.sortOrder),
            enabled: form.enabled !== false,
            style: parseStyleText(form.styleText)
        };
        if (String(form.upgradeCostKP || '').trim() === '') {
            payload.upgradeCostKP = null;
        } else {
            payload.upgradeCostKP = Number(form.upgradeCostKP);
        }
        if (includeId) payload.buildingTypeId = String(form.buildingTypeId || '').trim();
        return payload;
    };

    const validateCityBuildingTypeForm = (form, includeId) => {
        const buildingTypeId = String(form.buildingTypeId || '').trim();
        if (includeId && !CATALOG_ID_PATTERN.test(buildingTypeId)) {
            return '建筑ID格式不正确（2-64位字母/数字/下划线/中划线）';
        }
        if (!String(form.name || '').trim()) return '建筑名称不能为空';
        const numericChecks = [
            ['initialCount', 0, true],
            ['radius', 0.1, false],
            ['level', 1, true],
            ['sortOrder', Number.NEGATIVE_INFINITY, true]
        ];
        for (const [key, min, integer] of numericChecks) {
            const value = Number(form[key]);
            if (!Number.isFinite(value)) return `${key} 必须为数字`;
            if (integer && !Number.isInteger(value)) return `${key} 必须为整数`;
            if (value < min) return `${key} 不能小于 ${min}`;
        }
        if (String(form.upgradeCostKP || '').trim() !== '') {
            const upgradeCostKP = Number(form.upgradeCostKP);
            if (!Number.isFinite(upgradeCostKP) || upgradeCostKP < 0) {
                return 'upgradeCostKP 必须为大于等于 0 的数字';
            }
        }
        try {
            parseStyleText(form.styleText);
        } catch (error) {
            return error.message;
        }
        return '';
    };

    const saveCityBuildingType = async () => {
        const token = localStorage.getItem('token');
        const isCreate = isCreatingCityBuildingType;
        const validationError = validateCityBuildingTypeForm(cityBuildingTypeForm, isCreate);
        if (validationError) {
            alert(validationError);
            return;
        }
        const payload = buildCityBuildingTypePayload(cityBuildingTypeForm, isCreate);
        const actionId = isCreate ? '__create__' : editingCityBuildingTypeId;
        setCityBuildingTypeActionId(actionId);
        try {
            const response = await fetch(
                isCreate
                    ? 'http://localhost:5000/api/admin/catalog/buildings'
                    : `http://localhost:5000/api/admin/catalog/buildings/${editingCityBuildingTypeId}`,
                {
                    method: isCreate ? 'POST' : 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                }
            );
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '保存失败');
                return;
            }
            alert(isCreate ? '建筑创建成功' : '建筑更新成功');
            resetCityBuildingTypeEditor();
            fetchCityBuildingTypeCatalog();
        } catch (error) {
            console.error('保存建筑失败:', error);
            alert('保存失败');
        } finally {
            setCityBuildingTypeActionId('');
        }
    };

    const deleteCityBuildingType = async (buildingType) => {
        if (!window.confirm(`确定删除建筑「${buildingType.name}」吗？`)) return;
        const token = localStorage.getItem('token');
        setCityBuildingTypeActionId(buildingType.buildingTypeId);
        try {
            const response = await fetch(`http://localhost:5000/api/admin/catalog/buildings/${buildingType.buildingTypeId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || '删除失败');
                return;
            }
            alert('建筑已删除');
            if (editingCityBuildingTypeId === buildingType.buildingTypeId) {
                resetCityBuildingTypeEditor();
            }
            fetchCityBuildingTypeCatalog();
        } catch (error) {
            console.error('删除建筑失败:', error);
            alert('删除失败');
        } finally {
            setCityBuildingTypeActionId('');
        }
    };

    // --- Node Management Functions ---
    const fetchPendingNodes = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('http://localhost:5000/api/nodes/pending', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setPendingNodes(data);
            }
        } catch (error) {
            console.error('获取待审批节点失败:', error);
        }
    };

    const fetchPendingMasterApplications = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('http://localhost:5000/api/notifications', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            const pendingApplications = (data.notifications || []).filter((notification) => (
                notification.type === 'domain_master_apply' &&
                notification.status === 'pending'
            ));
            setPendingMasterApplications(pendingApplications);
        } catch (error) {
            console.error('获取待审批域主申请失败:', error);
        }
    };

    const refreshPendingApprovals = () => {
        fetchPendingNodes();
        fetchPendingMasterApplications();
    };

    const approveNode = async (nodeId, nodeName) => {
        if (pendingNodeActionId) return;
        const token = localStorage.getItem('token');
        setPendingNodeActionId(nodeId);
        setPendingNodeActionGroupName(nodeName || '');
        try {
            const response = await fetch('http://localhost:5000/api/nodes/approve', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ nodeId })
            });
            if (response.ok) {
                const data = await response.json();
                let message = '知识域申请审批通过';
                if (data.autoRejectedCount > 0) {
                    message += `，已自动拒绝 ${data.autoRejectedCount} 个同名申请`;
                }
                alert(message);
                fetchPendingNodes();
            } else {
                const data = await response.json();
                if ((data?.error || '').includes('已存在同名的审核通过知识域')) {
                    alert('该同名申请已被其他审批结果处理，列表已刷新');
                    fetchPendingNodes();
                } else {
                    alert(data.error || '审批失败');
                }
            }
        } catch (error) {
            console.error('审批节点失败:', error);
            alert('审批失败');
        } finally {
            setPendingNodeActionId('');
            setPendingNodeActionGroupName('');
        }
    };

    const rejectNode = async (nodeId) => {
        if (pendingNodeActionId) return;
        const token = localStorage.getItem('token');
        setPendingNodeActionId(nodeId);
        try {
            const response = await fetch('http://localhost:5000/api/nodes/reject', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ nodeId })
            });
            if (response.ok) {
                alert('知识域申请已拒绝');
                setPendingNodes(prev => prev.filter(node => node._id !== nodeId));
            } else {
                const data = await response.json();
                alert(data.error || '拒绝失败');
            }
        } catch (error) {
            console.error('拒绝节点失败:', error);
            alert('拒绝失败');
        } finally {
            setPendingNodeActionId('');
            setPendingNodeActionGroupName('');
        }
    };

    const reviewMasterApplication = async (notificationId, action) => {
        const token = localStorage.getItem('token');
        if (!token || !notificationId) return;
        setMasterApplyActionId(`${notificationId}:${action}`);
        try {
            const response = await fetch(`http://localhost:5000/api/notifications/${notificationId}/respond`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ action })
            });
            const data = await response.json();
            if (response.ok) {
                alert(data.message || '域主申请处理完成');
                await fetchPendingMasterApplications();
                if (typeof onPendingMasterApplyHandled === 'function') {
                    await onPendingMasterApplyHandled();
                }
            } else {
                alert(data.error || '处理域主申请失败');
            }
        } catch (error) {
            console.error('处理域主申请失败:', error);
            alert('处理域主申请失败');
        } finally {
            setMasterApplyActionId('');
        }
    };

    const fetchAllNodes = async (
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
            const response = await fetch(`http://localhost:5000/api/nodes?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
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
    };

    const refreshAdminDomainLatest = () => {
        fetchAllNodes(adminDomainPage, adminDomainSearchKeyword, adminDomainPageSize, { forceLatest: true });
    };

    const submitAdminDomainSearch = () => {
        const normalizedKeyword = adminDomainSearchInput.trim();
        setAdminDomainSearchKeyword(normalizedKeyword);
        setAdminDomainPage(1);
        fetchAllNodes(1, normalizedKeyword, adminDomainPageSize);
    };

    const clearAdminDomainSearch = () => {
        setAdminDomainSearchInput('');
        setAdminDomainSearchKeyword('');
        setAdminDomainPage(1);
        fetchAllNodes(1, '', adminDomainPageSize);
    };

    const handleAdminDomainPageSizeChange = (nextPageSize) => {
        const parsedPageSize = Number.parseInt(nextPageSize, 10);
        if (!Number.isInteger(parsedPageSize) || parsedPageSize <= 0) return;
        setAdminDomainPageSize(parsedPageSize);
        setAdminDomainPage(1);
        fetchAllNodes(1, adminDomainSearchKeyword, parsedPageSize);
    };

    const normalizeNodeSenses = useCallback((node) => {
        const source = Array.isArray(node?.synonymSenses) ? node.synonymSenses : [];
        const deduped = [];
        const seen = new Set();
        source.forEach((item, index) => {
            const senseId = (typeof item?.senseId === 'string' && item.senseId.trim()) ? item.senseId.trim() : `sense_${index + 1}`;
            const title = typeof item?.title === 'string' ? item.title.trim() : '';
            const content = typeof item?.content === 'string' ? item.content.trim() : '';
            if (!senseId || !title || seen.has(senseId)) return;
            seen.add(senseId);
            deduped.push({ senseId, title, content });
        });
        if (deduped.length > 0) return deduped;
        return [{
            senseId: 'sense_1',
            title: '基础释义',
            content: typeof node?.description === 'string' ? node.description : ''
        }];
    }, []);

    const getBackendRelationSymbol = useCallback((relationType) => {
        if (relationType === ASSOC_RELATION_TYPES.CONTAINS) return REL_SYMBOL_SUPERSET;
        if (relationType === ASSOC_RELATION_TYPES.EXTENDS) return REL_SYMBOL_SUBSET;
        return '↔';
    }, []);

    const getUiRelationSymbol = useCallback((uiRelationType) => {
        if (uiRelationType === ASSOC_RELATION_TYPES.EXTENDS) return REL_SYMBOL_SUPERSET;
        if (uiRelationType === ASSOC_RELATION_TYPES.CONTAINS) return REL_SYMBOL_SUBSET;
        return '↔';
    }, []);

    const formatBackendRelationExpression = useCallback((sourceDisplay, relationType, targetDisplay) => (
        `${sourceDisplay} ${getBackendRelationSymbol(relationType)} ${targetDisplay}`
    ), [getBackendRelationSymbol]);

    const formatUiRelationExpression = useCallback((sourceDisplay, uiRelationType, targetDisplay) => (
        `${sourceDisplay} ${getUiRelationSymbol(uiRelationType)} ${targetDisplay}`
    ), [getUiRelationSymbol]);

    const resolveAssociationDisplayType = useCallback((association) => {
        if (!association) return '';
        return association?.type || '';
    }, []);

    const getSenseTitleById = useCallback((node, senseId) => {
        const key = typeof senseId === 'string' ? senseId.trim() : '';
        if (!key) return '';
        const matched = normalizeNodeSenses(node).find((sense) => sense.senseId === key);
        return matched?.title || key;
    }, [normalizeNodeSenses]);

    const resolveNodeSenseId = useCallback((nodeLike, fallbackSenseId = '') => {
        const preferred = typeof fallbackSenseId === 'string' ? fallbackSenseId.trim() : '';
        const sourceList = normalizeNodeSenses(nodeLike);
        if (preferred && sourceList.some((item) => item.senseId === preferred)) {
            return preferred;
        }
        const directSenseId = (typeof nodeLike?.senseId === 'string' ? nodeLike.senseId.trim() : '')
            || (typeof nodeLike?.activeSenseId === 'string' ? nodeLike.activeSenseId.trim() : '');
        if (directSenseId && sourceList.some((item) => item.senseId === directSenseId)) {
            return directSenseId;
        }
        return sourceList[0]?.senseId || '';
    }, [normalizeNodeSenses]);

    const formatNodeSenseDisplay = useCallback((nodeLike, senseId = '') => {
        const nodeName = nodeLike?.name || '未知节点';
        const senseTitle = getSenseTitleById(nodeLike, senseId);
        return senseTitle ? `${nodeName}-${senseTitle}` : nodeName;
    }, [getSenseTitleById]);

    const resolveAssociationNodeId = useCallback((nodeLike) => (
        String(nodeLike?._id || nodeLike?.nodeId || '').trim()
    ), []);

    const resolveAssociationSenseId = useCallback((nodeLike, fallbackSenseId = '') => {
        const fallback = String(fallbackSenseId || '').trim();
        if (fallback) return fallback;
        const directSenseId = String(nodeLike?.senseId || nodeLike?.activeSenseId || '').trim();
        if (directSenseId) return directSenseId;
        return resolveNodeSenseId(nodeLike, '');
    }, [resolveNodeSenseId]);

    const toAssociationSenseKey = useCallback((nodeLike, fallbackSenseId = '') => {
        const nodeId = resolveAssociationNodeId(nodeLike);
        const senseId = resolveAssociationSenseId(nodeLike, fallbackSenseId);
        return buildSenseKey(nodeId, senseId);
    }, [resolveAssociationNodeId, resolveAssociationSenseId]);

    const normalizeAssociationCandidate = useCallback((target) => {
        const normalizedTarget = normalizeSenseSearchTarget(target);
        const nodeId = String(normalizedTarget.nodeId || target?._id || target?.nodeId || '').trim();
        const senseId = resolveAssociationSenseId(
            { ...target, ...normalizedTarget, _id: nodeId, nodeId },
            normalizedTarget.senseId || target?.senseId || target?.activeSenseId || ''
        );
        const searchKey = buildSenseKey(nodeId, senseId);
        if (!searchKey) return null;
        const domainName = normalizedTarget.domainName || target?.name || '';
        const senseTitle = normalizedTarget.senseTitle || target?.activeSenseTitle || '';
        const displayName = normalizedTarget.displayName || `${domainName}${senseTitle ? `-${senseTitle}` : ''}` || searchKey;
        return {
            ...target,
            ...normalizedTarget,
            _id: nodeId,
            nodeId,
            name: domainName || target?.name || '',
            domainName: domainName || target?.name || '',
            senseId,
            activeSenseId: senseId,
            searchKey,
            displayName
        };
    }, [resolveAssociationSenseId]);

    const assocAllowedEditingSenseKeySet = useMemo(() => {
        const set = new Set();
        if (assocEditingIndex === null) return set;
        const current = Array.isArray(editAssociations) ? editAssociations[assocEditingIndex] : null;
        if (!current) return set;
        const append = (nodeLike, senseId = '') => {
            const key = toAssociationSenseKey(nodeLike, senseId);
            if (key) set.add(key);
        };
        append(current?.nodeA, current?.nodeASenseId || current?.targetSenseId || '');
        append(current?.nodeB, current?.nodeBSenseId || '');
        (Array.isArray(current?.actualAssociations) ? current.actualAssociations : []).forEach((actual) => {
            append(actual?.targetNode && typeof actual.targetNode === 'object'
                ? actual.targetNode
                : { _id: actual?.targetNode }, actual?.targetSenseId || '');
        });
        return set;
    }, [assocEditingIndex, editAssociations, toAssociationSenseKey]);

    const assocBlockedSenseKeySet = useMemo(() => {
        const set = new Set();
        const append = (nodeLike, senseId = '') => {
            const key = toAssociationSenseKey(nodeLike, senseId);
            if (key) set.add(key);
        };

        (Array.isArray(editAssociations) ? editAssociations : []).forEach((assoc, index) => {
            if (assocEditingIndex !== null && index === assocEditingIndex) return;
            append(assoc?.nodeA, assoc?.nodeASenseId || assoc?.targetSenseId || '');
            append(assoc?.nodeB, assoc?.nodeBSenseId || '');
            (Array.isArray(assoc?.actualAssociations) ? assoc.actualAssociations : []).forEach((actual) => {
                append(actual?.targetNode && typeof actual.targetNode === 'object'
                    ? actual.targetNode
                    : { _id: actual?.targetNode }, actual?.targetSenseId || '');
            });
        });

        if (set.size === 0 && Array.isArray(editingAssociationNode?.associations)) {
            const sourceSenseId = resolveAssociationSenseId(editingAssociationNode, assocSelectedSourceSenseId || editingAssociationSenseId || '');
            editingAssociationNode.associations.forEach((assoc) => {
                const assocSourceSenseId = String(assoc?.sourceSenseId || '').trim();
                if (sourceSenseId && assocSourceSenseId && assocSourceSenseId !== sourceSenseId) return;
                append(assoc?.targetNode && typeof assoc.targetNode === 'object'
                    ? assoc.targetNode
                    : { _id: assoc?.targetNode }, assoc?.targetSenseId || '');
            });
        }
        return set;
    }, [
        assocEditingIndex,
        assocSelectedSourceSenseId,
        editAssociations,
        editingAssociationNode,
        editingAssociationSenseId,
        resolveAssociationSenseId,
        toAssociationSenseKey
    ]);

    const isAssociationCandidateSelectable = useCallback((nodeLike, fallbackSenseId = '', options = {}) => {
        const excludedSenseKeySet = options?.excludedSenseKeySet instanceof Set ? options.excludedSenseKeySet : new Set();
        const excludedNodeIdSet = options?.excludedNodeIdSet instanceof Set ? options.excludedNodeIdSet : new Set();
        const candidateNodeId = resolveAssociationNodeId(nodeLike);
        if (!candidateNodeId) return false;
        if (candidateNodeId === String(editingAssociationNode?._id || '')) return false;
        if (excludedNodeIdSet.has(candidateNodeId)) return false;
        const candidateKey = toAssociationSenseKey(nodeLike, fallbackSenseId);
        if (!candidateKey) return false;
        if (excludedSenseKeySet.has(candidateKey)) return false;
        if (assocBlockedSenseKeySet.has(candidateKey) && !assocAllowedEditingSenseKeySet.has(candidateKey)) return false;
        return true;
    }, [
        assocAllowedEditingSenseKeySet,
        assocBlockedSenseKeySet,
        editingAssociationNode,
        resolveAssociationNodeId,
        toAssociationSenseKey
    ]);

    const fetchSenseRelationContext = useCallback(async (target) => {
        const nodeId = target?.nodeId || target?._id || '';
        const senseId = typeof target?.senseId === 'string' ? target.senseId.trim() : '';
        if (!nodeId || !senseId) {
            return {
                parentTargets: [],
                childTargets: [],
                parentKeySet: new Set(),
                childKeySet: new Set()
            };
        }
        const cacheKey = `${nodeId}:${senseId}`;
        if (relationContextCacheRef.current.has(cacheKey)) {
            return relationContextCacheRef.current.get(cacheKey);
        }

        const toEmpty = () => ({
            parentTargets: [],
            childTargets: [],
            parentKeySet: new Set(),
            childKeySet: new Set()
        });

        try {
            const response = await fetch(`http://localhost:5000/api/nodes/public/node-detail/${nodeId}?senseId=${encodeURIComponent(senseId)}`);
            if (!response.ok) {
                const empty = toEmpty();
                relationContextCacheRef.current.set(cacheKey, empty);
                return empty;
            }
            const data = await response.json();
            const detailNode = data?.node || {};
            const activeSenseId = String(detailNode?.activeSenseId || senseId || '').trim();
            const sourceSenses = normalizeNodeSenses(detailNode);
            const canUseLooseSourceMatch = sourceSenses.length === 1;
            const getTargetNodeId = (targetNode) => {
                if (!targetNode) return '';
                if (typeof targetNode === 'string') return String(targetNode || '').trim();
                return String(targetNode?._id || targetNode?.nodeId || '').trim();
            };
            const normalizeNodeList = (list = []) => (
                (Array.isArray(list) ? list : [])
                    .map((item) => normalizeSenseSearchTarget({
                        _id: item?._id,
                        nodeId: item?._id,
                        senseId: item?.activeSenseId,
                        displayName: item?.displayName || `${item?.name || ''}${item?.activeSenseTitle ? `-${item.activeSenseTitle}` : ''}`,
                        name: item?.name || '',
                        domainName: item?.name || '',
                        senseTitle: item?.activeSenseTitle || '',
                        senseContent: item?.activeSenseContent || '',
                        description: item?.activeSenseContent || item?.description || ''
                    }))
                    .filter((item) => item.nodeId && item.senseId && item.searchKey)
            );

            const parentTargetsRaw = normalizeNodeList(detailNode?.parentNodesInfo || data?.parentNodes || []);
            const childTargetsRaw = normalizeNodeList(detailNode?.childNodesInfo || data?.childNodes || []);
            const parentTargetMap = new Map(parentTargetsRaw.map((item) => [item.searchKey, item]));
            const childTargetMap = new Map(childTargetsRaw.map((item) => [item.searchKey, item]));
            const parentKeySet = new Set();
            const childKeySet = new Set();
            const relationAssociations = (Array.isArray(detailNode?.associations) ? detailNode.associations : [])
                .filter((assoc) => (
                    assoc?.relationType === ASSOC_RELATION_TYPES.EXTENDS
                    || assoc?.relationType === ASSOC_RELATION_TYPES.CONTAINS
                ))
                .filter((assoc) => {
                    const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                    if (sourceSenseId) return sourceSenseId === activeSenseId;
                    return canUseLooseSourceMatch;
                });

            relationAssociations.forEach((assoc) => {
                const relationType = assoc?.relationType;
                const targetNodeId = getTargetNodeId(assoc?.targetNode);
                const targetSenseId = String(assoc?.targetSenseId || '').trim();
                if (!targetNodeId || !targetSenseId) return;
                const relationKey = `${targetNodeId}:${targetSenseId}`;
                const targetNode = (assoc?.targetNode && typeof assoc.targetNode === 'object') ? assoc.targetNode : null;
                if (targetNode) {
                    const normalizedTarget = normalizeSenseSearchTarget({
                        _id: targetNode?._id || targetNodeId,
                        nodeId: targetNode?._id || targetNodeId,
                        senseId: targetSenseId,
                        displayName: targetNode?.displayName || `${targetNode?.name || ''}${targetSenseId ? `-${targetSenseId}` : ''}`,
                        name: targetNode?.name || '',
                        domainName: targetNode?.name || '',
                        senseTitle: targetNode?.activeSenseTitle || '',
                        senseContent: targetNode?.activeSenseContent || '',
                        description: targetNode?.activeSenseContent || targetNode?.description || ''
                    });
                    if (normalizedTarget?.searchKey) {
                        parentTargetMap.set(normalizedTarget.searchKey, normalizedTarget);
                        childTargetMap.set(normalizedTarget.searchKey, normalizedTarget);
                    }
                }
                if (relationType === ASSOC_RELATION_TYPES.EXTENDS) {
                    parentKeySet.add(relationKey);
                } else if (relationType === ASSOC_RELATION_TYPES.CONTAINS) {
                    childKeySet.add(relationKey);
                }
            });

            const parentTargets = Array.from(parentKeySet)
                .map((key) => parentTargetMap.get(key))
                .filter(Boolean);
            const childTargets = Array.from(childKeySet)
                .map((key) => childTargetMap.get(key))
                .filter(Boolean);
            const contextData = {
                parentTargets,
                childTargets,
                parentKeySet,
                childKeySet
            };
            relationContextCacheRef.current.set(cacheKey, contextData);
            return contextData;
        } catch (error) {
            console.error('获取释义关系上下文失败:', error);
            const empty = toEmpty();
            relationContextCacheRef.current.set(cacheKey, empty);
            return empty;
        }
    }, [normalizeNodeSenses]);

    const loadAssocNodeBCandidatesBySense = useCallback(async (nodeA = assocSelectedNodeA, sourceSenseId = assocSelectedNodeASenseId) => {
        const nodeId = String(nodeA?._id || nodeA?.nodeId || '').trim();
        const normalizedSenseId = String(sourceSenseId || '').trim();
        if (!nodeId || !normalizedSenseId) {
            setAssocNodeBCandidates({ parents: [], children: [] });
            return;
        }
        const requestId = ++assocNodeBCandidateRequestIdRef.current;
        const context = await fetchSenseRelationContext({ _id: nodeId, nodeId, senseId: normalizedSenseId });
        if (requestId !== assocNodeBCandidateRequestIdRef.current) return;
        const selectedNodeAKey = toAssociationSenseKey(nodeA, normalizedSenseId);
        const excludedSenseKeySet = new Set([selectedNodeAKey].filter(Boolean));
        const normalizeCandidates = (list = []) => {
            const seen = new Set();
            return (Array.isArray(list) ? list : [])
                .map((item) => normalizeAssociationCandidate(item))
                .filter(Boolean)
                .filter((item) => {
                    if (seen.has(item.searchKey)) return false;
                    seen.add(item.searchKey);
                    return true;
                })
                .filter((item) => isAssociationCandidateSelectable(item, item?.senseId || '', { excludedSenseKeySet }));
        };
        setAssocNodeBCandidates({
            parents: normalizeCandidates(context?.parentTargets || []),
            children: normalizeCandidates(context?.childTargets || [])
        });
    }, [
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        fetchSenseRelationContext,
        toAssociationSenseKey,
        normalizeAssociationCandidate,
        isAssociationCandidateSelectable
    ]);

    const nodeByIdMap = useMemo(() => {
        const map = new Map();
        allNodes.forEach((item) => {
            if (!item?._id) return;
            map.set(String(item._id), item);
        });
        return map;
    }, [allNodes]);

    const resolveDecisionRefDisplay = useCallback((ref = null) => {
        const explicitDisplayName = String(ref?.displayName || '').trim();
        if (explicitDisplayName) return explicitDisplayName;

        const refNodeId = String(ref?.nodeId || ref?._id || '').trim();
        const refSenseId = String(ref?.senseId || '').trim();
        const mappedNode = refNodeId ? nodeByIdMap.get(refNodeId) : null;
        if (mappedNode) {
            const mappedNodeName = String(mappedNode?.name || '').trim() || '未知标题';
            const mappedSenseId = refSenseId || resolveNodeSenseId(mappedNode, '');
            const mappedSenseTitle = getSenseTitleById(mappedNode, mappedSenseId);
            if (mappedSenseTitle) return `${mappedNodeName}-${mappedSenseTitle}`;
            if (mappedSenseId) return `${mappedNodeName}-${mappedSenseId}`;
            return `${mappedNodeName}-未知释义`;
        }

        const nodeName = String(ref?.nodeName || ref?.name || '').trim() || '未知标题';
        const senseTitle = String(ref?.senseTitle || '').trim();
        if (senseTitle) return `${nodeName}-${senseTitle}`;
        return `${nodeName}-${refSenseId || '未知释义'}`;
    }, [getSenseTitleById, nodeByIdMap, resolveNodeSenseId]);

    const resolveDecisionCurrentDisplay = useCallback((sourceNode, sourceSenseId = '', fallbackNodeName = '当前标题') => {
        const nodeName = String(sourceNode?.name || fallbackNodeName || '当前标题').trim() || '当前标题';
        const normalizedSenseId = String(sourceSenseId || '').trim();
        if (sourceNode) {
            const effectiveSenseId = normalizedSenseId || resolveNodeSenseId(sourceNode, '');
            const senseTitle = getSenseTitleById(sourceNode, effectiveSenseId);
            if (senseTitle) return `${nodeName}-${senseTitle}`;
            if (effectiveSenseId) return `${nodeName}-${effectiveSenseId}`;
        }
        return `${nodeName}-${normalizedSenseId || '未知释义'}`;
    }, [getSenseTitleById, resolveNodeSenseId]);

    const resolveDecisionPairSideDisplay = useCallback((pair = {}, side = 'upper') => {
        const normalizedSide = side === 'lower' ? 'lower' : 'upper';
        const embeddedRef = pair?.[normalizedSide];
        if (embeddedRef && typeof embeddedRef === 'object') {
            return resolveDecisionRefDisplay(embeddedRef);
        }
        const nodeId = String(pair?.[`${normalizedSide}NodeId`] || '').trim();
        const senseId = String(pair?.[`${normalizedSide}SenseId`] || '').trim();
        return resolveDecisionRefDisplay({ nodeId, senseId });
    }, [resolveDecisionRefDisplay]);

    const incomingAssociationMap = useMemo(() => {
        const map = new Map();
        allNodes.forEach((sourceNode) => {
            const sourceSenses = normalizeNodeSenses(sourceNode);
            const sourceSenseById = new Map(sourceSenses.map((sense) => [sense.senseId, sense]));
            const sourceAssociations = Array.isArray(sourceNode?.associations) ? sourceNode.associations : [];
            sourceAssociations.forEach((assoc) => {
                const targetId = assoc?.targetNode?._id || assoc?.targetNode;
                if (!targetId) return;
                const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
                const sourceSenseTitle = sourceSenseById.get(sourceSenseId)?.title || sourceSenseId || '';
                const sourceDisplayName = sourceSenseTitle ? `${sourceNode.name}-${sourceSenseTitle}` : sourceNode.name;
                const item = {
                    sourceNodeId: sourceNode._id,
                    sourceNodeName: sourceNode.name,
                    sourceSenseId,
                    sourceSenseTitle,
                    sourceDisplayName,
                    relationType: assoc?.relationType || ''
                };

                const primaryKey = `${targetId}:${targetSenseId}`;
                const fallbackKey = `${targetId}:`;
                if (!map.has(primaryKey)) map.set(primaryKey, []);
                map.get(primaryKey).push(item);
                if (targetSenseId && !map.has(fallbackKey)) {
                    map.set(fallbackKey, []);
                }
            });
        });
        return map;
    }, [allNodes, normalizeNodeSenses]);

    const resolveAssociationTargetDisplay = useCallback((assoc) => {
        const targetNodeRaw = assoc?.targetNode;
        const targetNode = (targetNodeRaw && typeof targetNodeRaw === 'object')
            ? targetNodeRaw
            : nodeByIdMap.get(String(targetNodeRaw || ''));
        if (!targetNode) return '未知释义';
        const targetNodeName = targetNode?.name || '未知节点';
        const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
        const targetSenseTitle = getSenseTitleById(targetNode, targetSenseId);
        return targetSenseTitle ? `${targetNodeName}-${targetSenseTitle}` : targetNodeName;
    }, [getSenseTitleById, nodeByIdMap]);

    const getPendingRelationBadgeMeta = useCallback((relationType = '', insertSide = '') => {
        if (relationType === ASSOC_RELATION_TYPES.CONTAINS) {
            return { className: 'parent', label: `包含 ${REL_SYMBOL_SUPERSET}` };
        }
        if (relationType === ASSOC_RELATION_TYPES.EXTENDS) {
            return { className: 'child', label: `扩展 ${REL_SYMBOL_SUBSET}` };
        }
        if (relationType === ASSOC_RELATION_TYPES.INSERT) {
            const normalizedInsertSide = String(insertSide || '').trim();
            const suffix = normalizedInsertSide === 'left'
                ? '（左）'
                : (normalizedInsertSide === 'right' ? '（右）' : '');
            return { className: 'insert', label: `插入${suffix}` };
        }
        return { className: 'insert', label: '关联' };
    }, []);

    const getPendingSenseAssociations = useCallback((node, senseId) => {
        const normalizedSenseId = String(senseId || '').trim();
        if (!node || !normalizedSenseId) return [];

        const sourceSenses = normalizeNodeSenses(node);
        const canUseLooseSourceMatch = sourceSenses.length === 1;
        const sourceDisplay = formatNodeSenseDisplay(node, normalizedSenseId);
        const allAssociations = Array.isArray(node?.associations) ? node.associations : [];
        const normalizedAssociations = allAssociations
            .filter((assoc) => {
                const assocSourceSenseId = String(assoc?.sourceSenseId || '').trim();
                if (assocSourceSenseId) return assocSourceSenseId === normalizedSenseId;
                return canUseLooseSourceMatch;
            })
            .map((assoc, index) => {
                const relationType = String(assoc?.relationType || '').trim();
                const sourceSenseId = String(assoc?.sourceSenseId || '').trim() || normalizedSenseId;
                const targetNodeRaw = assoc?.targetNode;
                const targetNodeId = String(targetNodeRaw?._id || targetNodeRaw || '').trim();
                const targetSenseId = String(assoc?.targetSenseId || '').trim();
                const insertSide = String(assoc?.insertSide || '').trim();
                const insertGroupId = String(assoc?.insertGroupId || '').trim();
                const targetNode = (targetNodeRaw && typeof targetNodeRaw === 'object')
                    ? targetNodeRaw
                    : nodeByIdMap.get(targetNodeId);
                const targetKey = `${targetNodeId}:${targetSenseId}`;
                const targetDisplay = resolveAssociationTargetDisplay(assoc);
                return {
                    index,
                    assoc,
                    relationType,
                    sourceSenseId,
                    targetNodeId,
                    targetSenseId,
                    insertSide,
                    insertGroupId,
                    targetNode,
                    targetKey,
                    targetDisplay
                };
            })
            .filter((item) => (
                !!item.targetNodeId
                && !!item.targetSenseId
                && (
                    item.relationType === ASSOC_RELATION_TYPES.CONTAINS
                    || item.relationType === ASSOC_RELATION_TYPES.EXTENDS
                    || item.relationType === ASSOC_RELATION_TYPES.INSERT
                )
            ));

        const displaySlots = Array(normalizedAssociations.length).fill(null);
        const markDisplaySlot = (slotIndex, payload) => {
            if (slotIndex < 0 || slotIndex >= displaySlots.length) return;
            displaySlots[slotIndex] = payload;
        };
        const consumedIndexSet = new Set();

        // 1. 先归并已带 insertSide/insertGroupId 的插入草稿，和关联管理中“插入”统一显示为一条链路。
        const insertGroups = new Map();
        normalizedAssociations.forEach((item) => {
            if (item.relationType !== ASSOC_RELATION_TYPES.INSERT) return;
            if (!item.insertGroupId) return;
            const groupKey = `${item.sourceSenseId}|${item.insertGroupId}`;
            const group = insertGroups.get(groupKey) || { left: null, right: null };
            if (item.insertSide === 'left' && !group.left) group.left = item;
            if (item.insertSide === 'right' && !group.right) group.right = item;
            insertGroups.set(groupKey, group);
        });

        insertGroups.forEach((group, groupKey) => {
            if (!group.left || !group.right) return;
            if (group.left.targetKey === group.right.targetKey) return;
            consumedIndexSet.add(group.left.index);
            consumedIndexSet.add(group.right.index);
            const anchorIndex = Math.min(group.left.index, group.right.index);
            const relationMeta = getPendingRelationBadgeMeta(ASSOC_RELATION_TYPES.INSERT, '');
            const upperDisplay = formatNodeSenseDisplay(group.left.targetNode, group.left.targetSenseId);
            const lowerDisplay = formatNodeSenseDisplay(group.right.targetNode, group.right.targetSenseId);
            markDisplaySlot(anchorIndex, {
                id: `pending_assoc_${node?._id || 'node'}_${normalizedSenseId}_insert_group_${groupKey}`,
                relationType: ASSOC_RELATION_TYPES.INSERT,
                relationClassName: relationMeta.className,
                relationLabel: relationMeta.label,
                displayText: `${upperDisplay} ${REL_SYMBOL_SUPERSET} ${sourceDisplay} ${REL_SYMBOL_SUPERSET} ${lowerDisplay}`
            });
        });

        // 2. contains/extends 逐条展示，不再自动识别并归并为插入关系。
        const mergeCandidates = normalizedAssociations
            .filter((item) => !consumedIndexSet.has(item.index))
            .filter((item) => (
                item.relationType === ASSOC_RELATION_TYPES.CONTAINS
                || item.relationType === ASSOC_RELATION_TYPES.EXTENDS
            ));
        mergeCandidates.forEach((candidate) => {
            consumedIndexSet.add(candidate.index);
            const relationMeta = getPendingRelationBadgeMeta(candidate.relationType, '');
            markDisplaySlot(candidate.index, {
                id: `pending_assoc_${node?._id || 'node'}_${normalizedSenseId}_single_${candidate.index}`,
                relationType: candidate.relationType,
                relationClassName: relationMeta.className,
                relationLabel: relationMeta.label,
                displayText: formatBackendRelationExpression(sourceDisplay, candidate.relationType, candidate.targetDisplay)
            });
        });

        // 3. 兜底展示未被归并的关系（例如孤立 insert side）。
        normalizedAssociations.forEach((item) => {
            if (consumedIndexSet.has(item.index)) return;
            const relationMeta = getPendingRelationBadgeMeta(item.relationType, item.insertSide || '');
            markDisplaySlot(item.index, {
                id: `pending_assoc_${node?._id || 'node'}_${normalizedSenseId}_fallback_${item.index}`,
                relationType: item.relationType,
                relationClassName: relationMeta.className,
                relationLabel: relationMeta.label,
                displayText: formatBackendRelationExpression(sourceDisplay, item.relationType, item.targetDisplay)
            });
        });

        return displaySlots.filter(Boolean);
    }, [
        formatBackendRelationExpression,
        formatNodeSenseDisplay,
        getPendingRelationBadgeMeta,
        normalizeNodeSenses,
        nodeByIdMap,
        resolveAssociationTargetDisplay
    ]);

    const selectPendingNodeSense = useCallback((nodeId, senseId) => {
        const safeNodeId = String(nodeId || '').trim();
        const safeSenseId = String(senseId || '').trim();
        if (!safeNodeId || !safeSenseId) return;
        setPendingNodeSelectedSenseByNodeId((prev) => ({
            ...prev,
            [safeNodeId]: safeSenseId
        }));
    }, []);

    const getNodeSenseAssociationSummary = useCallback((node, senseId) => {
        const localSenseId = typeof senseId === 'string' ? senseId.trim() : '';
        const currentDisplay = formatNodeSenseDisplay(node, localSenseId);
        const allAssociations = Array.isArray(node?.associations) ? node.associations : [];
        const outgoing = allAssociations
            .filter((assoc) => {
                const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                return sourceSenseId === localSenseId;
            })
            .map((assoc, index) => ({
                id: `out_${index}_${assoc?.targetNode?._id || assoc?.targetNode || 'unknown'}`,
                direction: 'outgoing',
                relationType: assoc?.relationType || '',
                displayText: formatBackendRelationExpression(
                    currentDisplay,
                    assoc?.relationType || '',
                    resolveAssociationTargetDisplay(assoc)
                )
            }));

        const incomingKey = `${node?._id}:${localSenseId}`;
        const incomingFallbackKey = `${node?._id}:`;
        const incoming = [
            ...(incomingAssociationMap.get(incomingKey) || []),
            ...(incomingAssociationMap.get(incomingFallbackKey) || [])
        ].map((item, index) => ({
            id: `in_${index}_${item.sourceNodeId || 'unknown'}_${item.sourceSenseId || 'sense'}`,
            direction: 'incoming',
            relationType: item.relationType,
            displayText: formatBackendRelationExpression(
                item.sourceDisplayName,
                item.relationType,
                currentDisplay
            )
        }));

        return {
            outgoing,
            incoming,
            all: [...outgoing, ...incoming]
        };
    }, [formatBackendRelationExpression, formatNodeSenseDisplay, incomingAssociationMap, resolveAssociationTargetDisplay]);

    const getEditableSenseAssociationCount = useCallback((node, senseId) => {
        const normalizedSenseId = String(senseId || '').trim();
        if (!node || !normalizedSenseId) return 0;

        const sourceAssociations = (Array.isArray(node?.associations) ? node.associations : [])
            .filter((assoc) => {
                const targetNodeId = String(assoc?.targetNode?._id || assoc?.targetNode || '').trim();
                const targetNodeName = String(assoc?.targetNode?.name || '').trim();
                const targetSenseId = String(assoc?.targetSenseId || '').trim();
                const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                const relationType = assoc?.relationType;
                const isSimpleRelation = (
                    relationType === ASSOC_RELATION_TYPES.CONTAINS
                    || relationType === ASSOC_RELATION_TYPES.EXTENDS
                );
                return (
                    sourceSenseId === normalizedSenseId
                    && !!targetNodeId
                    && !!targetNodeName
                    && !!targetSenseId
                    && isSimpleRelation
                );
            });

        if (sourceAssociations.length > 0) {
            return sourceAssociations.length;
        }

        const rawAssociations = Array.isArray(node?.associations) ? node.associations : [];
        if (rawAssociations.length > 0) return 0;

        const nodeNameMap = new Map((Array.isArray(allNodes) ? allNodes : [])
            .map((item) => [String(item?.name || '').trim(), item]));
        const fallbackParentCount = (Array.isArray(node?.relatedParentDomains) ? node.relatedParentDomains : [])
            .filter((name) => nodeNameMap.has(String(name || '').trim()))
            .length;
        const fallbackChildCount = (Array.isArray(node?.relatedChildDomains) ? node.relatedChildDomains : [])
            .filter((name) => nodeNameMap.has(String(name || '').trim()))
            .length;
        return fallbackParentCount + fallbackChildCount;
    }, [allNodes]);

    const buildNodeDeletePreview = useCallback((node) => {
        if (!node?._id) {
            return {
                senses: [],
                totalBeforeCount: 0,
                totalAfterCount: 0
            };
        }
        const senses = normalizeNodeSenses(node).map((sense) => {
            const summary = getNodeSenseAssociationSummary(node, sense.senseId);
            return {
                ...sense,
                beforeRelations: summary.all
            };
        });
        const totalBeforeCount = senses.reduce((sum, sense) => sum + (sense.beforeRelations?.length || 0), 0);
        return {
            senses,
            totalBeforeCount,
            totalAfterCount: 0
        };
    }, [getNodeSenseAssociationSummary, normalizeNodeSenses]);

    const toBridgeDecisionPayload = useCallback((decisionMap = {}) => (
        Object.entries(decisionMap || {})
            .map(([pairKey, action]) => ({ pairKey, action }))
            .filter((item) => item.pairKey && (item.action === 'reconnect' || item.action === 'disconnect'))
    ), []);

    const startEditNode = (node) => {
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
    };

    const closeEditNodeModal = () => {
        if (isSavingNodeEdit) return;
        setShowEditNodeModal(false);
        setEditingNode(null);
    };

    const saveNodeEdit = async (nodeId = editingNode) => {
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
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
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
    };

    const resetNewSenseEditor = () => {
        setNewSenseForm(createEmptyNewSenseForm());
        setNewSenseAssocFlow(createEmptyNewSenseAssocFlow());
        if (newSenseAssocPreviewRendererRef.current) {
            newSenseAssocPreviewRendererRef.current.destroy();
            newSenseAssocPreviewRendererRef.current = null;
        }
    };

    const openAddSenseModal = (node) => {
        setAddingSenseNode(node || null);
        resetNewSenseEditor();
        setShowAddSenseModal(true);
    };

    const closeAddSenseModal = () => {
        if (isSavingNewSense) return;
        setShowAddSenseModal(false);
        setAddingSenseNode(null);
        resetNewSenseEditor();
    };

    const getDirectRelationBetweenTargets = useCallback((leftTarget, rightTarget) => {
        if (!leftTarget?.nodeId || !rightTarget?.nodeId || !leftTarget?.senseId || !rightTarget?.senseId) {
            return null;
        }
        const leftNode = allNodes.find((node) => String(node?._id || '') === String(leftTarget.nodeId));
        const rightNode = allNodes.find((node) => String(node?._id || '') === String(rightTarget.nodeId));
        const leftAssociations = Array.isArray(leftNode?.associations) ? leftNode.associations : [];
        const rightAssociations = Array.isArray(rightNode?.associations) ? rightNode.associations : [];
        const hasLeftContainsRight = leftAssociations.some((assoc) => (
            String(assoc?.targetNode?._id || assoc?.targetNode || '') === String(rightTarget.nodeId)
            && (assoc?.relationType || '') === ASSOC_RELATION_TYPES.CONTAINS
            && String(assoc?.sourceSenseId || '').trim() === String(leftTarget.senseId).trim()
            && String(assoc?.targetSenseId || '').trim() === String(rightTarget.senseId).trim()
        ));
        const hasRightContainsLeft = rightAssociations.some((assoc) => (
            String(assoc?.targetNode?._id || assoc?.targetNode || '') === String(leftTarget.nodeId)
            && (assoc?.relationType || '') === ASSOC_RELATION_TYPES.CONTAINS
            && String(assoc?.sourceSenseId || '').trim() === String(rightTarget.senseId).trim()
            && String(assoc?.targetSenseId || '').trim() === String(leftTarget.senseId).trim()
        ));
        if (hasLeftContainsRight) {
            return {
                relationExists: true,
                lockedDirection: ASSOC_RELATION_TYPES.CONTAINS
            };
        }
        if (hasRightContainsLeft) {
            return {
                relationExists: true,
                lockedDirection: ASSOC_RELATION_TYPES.EXTENDS
            };
        }
        return {
            relationExists: false,
            lockedDirection: ASSOC_RELATION_TYPES.CONTAINS
        };
    }, [allNodes]);

    const fetchNodeDetailForNewSenseAssoc = useCallback(async (nodeId = '') => {
        const safeNodeId = String(nodeId || '').trim();
        if (!safeNodeId) return null;
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/public/node-detail/${safeNodeId}`);
            if (!response.ok) return null;
            const data = await response.json();
            return data?.node || null;
        } catch (error) {
            console.error('获取释义目标详情失败:', error);
            return null;
        }
    }, []);

    const buildNewSenseAssocTarget = useCallback((nodeLike, fallbackSenseId = '') => {
        const normalized = normalizeAssociationCandidate(nodeLike);
        if (!normalized) return null;
        const senseId = resolveAssociationSenseId(normalized, fallbackSenseId || normalized.senseId || '');
        const nodeId = String(normalized.nodeId || normalized._id || '').trim();
        const searchKey = buildSenseKey(nodeId, senseId);
        if (!nodeId || !senseId || !searchKey) return null;
        return {
            ...normalized,
            _id: nodeId,
            nodeId,
            senseId,
            activeSenseId: senseId,
            searchKey,
            displayName: normalized.displayName || formatNodeSenseDisplay(normalized, senseId)
        };
    }, [formatNodeSenseDisplay, normalizeAssociationCandidate, resolveAssociationSenseId]);

    const syncNewSenseAssocInsertDirection = useCallback((nodeA, nodeASenseId, nodeB, nodeBSenseId, fallbackDirection = 'aToB') => {
        const targetA = buildNewSenseAssocTarget(nodeA, nodeASenseId);
        const targetB = buildNewSenseAssocTarget(nodeB, nodeBSenseId);
        if (!targetA || !targetB) {
            setNewSenseAssocFlow((prev) => ({ ...prev, insertDirectionLocked: false }));
            return;
        }
        const relationStatus = getDirectRelationBetweenTargets(targetA, targetB);
        if (!relationStatus?.relationExists) {
            setNewSenseAssocFlow((prev) => ({
                ...prev,
                insertDirection: prev.insertDirection || fallbackDirection,
                insertDirectionLocked: false
            }));
            return;
        }
        const nextDirection = relationStatus.lockedDirection === ASSOC_RELATION_TYPES.EXTENDS ? 'bToA' : 'aToB';
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            insertDirection: nextDirection,
            insertDirectionLocked: true
        }));
    }, [buildNewSenseAssocTarget, getDirectRelationBetweenTargets]);

    const loadNewSenseAssocNodeBCandidatesBySense = useCallback(async (
        nodeA = newSenseAssocFlow.selectedNodeA,
        nodeASenseId = newSenseAssocFlow.selectedNodeASenseId
    ) => {
        const currentNodeId = String(addingSenseNode?._id || '').trim();
        const targetA = buildNewSenseAssocTarget(nodeA, nodeASenseId);
        if (!targetA?.searchKey) {
            setNewSenseAssocFlow((prev) => ({ ...prev, nodeBCandidates: { parents: [], children: [] } }));
            return;
        }
        const context = await fetchSenseRelationContext(targetA);
        const dedupe = (list = []) => {
            const seen = new Set();
            return (Array.isArray(list) ? list : [])
                .map((item) => buildNewSenseAssocTarget(item))
                .filter(Boolean)
                .filter((item) => String(item.nodeId || '').trim() !== currentNodeId)
                .filter((item) => item.searchKey !== targetA.searchKey)
                .filter((item) => {
                    if (!item.searchKey || seen.has(item.searchKey)) return false;
                    seen.add(item.searchKey);
                    return true;
                });
        };
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            nodeBCandidates: {
                parents: dedupe(context?.parentTargets || []),
                children: dedupe(context?.childTargets || [])
            }
        }));
    }, [
        addingSenseNode,
        buildNewSenseAssocTarget,
        fetchSenseRelationContext,
        newSenseAssocFlow.selectedNodeA,
        newSenseAssocFlow.selectedNodeASenseId
    ]);

    const startNewSenseRelationEditor = useCallback(() => {
        setNewSenseAssocFlow({
            ...createEmptyNewSenseAssocFlow(),
            currentStep: ASSOC_STEPS.SELECT_NODE_A
        });
    }, []);

    const searchNewSenseAssocNodeA = useCallback(async (rawKeyword = newSenseAssocFlow.searchKeyword) => {
        const currentNodeId = String(addingSenseNode?._id || '').trim();
        const keyword = String(rawKeyword || '').trim();
        const keywordMeta = parseAssociationKeyword(keyword);
        const effectiveKeyword = keywordMeta.textKeyword;
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            searchKeyword: keyword,
            searchAppliedKeyword: keyword
        }));
        if (!effectiveKeyword) {
            setNewSenseAssocFlow((prev) => ({ ...prev, searchResults: [], searchLoading: false }));
            return;
        }
        const token = localStorage.getItem('token');
        setNewSenseAssocFlow((prev) => ({ ...prev, searchLoading: true }));
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/search?keyword=${encodeURIComponent(effectiveKeyword)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) {
                setNewSenseAssocFlow((prev) => ({ ...prev, searchResults: [], searchLoading: false }));
                return;
            }
            const data = await response.json();
            const seen = new Set();
            const results = (Array.isArray(data) ? data : [])
                .map((item) => buildNewSenseAssocTarget(item))
                .filter(Boolean)
                .filter((item) => String(item.nodeId || '').trim() !== currentNodeId)
                .filter((item) => matchKeywordByDomainAndSense(item, effectiveKeyword))
                .filter((item) => {
                    if (!item.searchKey || seen.has(item.searchKey)) return false;
                    seen.add(item.searchKey);
                    return true;
                });
            setNewSenseAssocFlow((prev) => ({ ...prev, searchResults: results, searchLoading: false }));
        } catch (error) {
            console.error('搜索释义失败:', error);
            setNewSenseAssocFlow((prev) => ({ ...prev, searchResults: [], searchLoading: false }));
        }
    }, [addingSenseNode, buildNewSenseAssocTarget, newSenseAssocFlow.searchKeyword]);

    const clearNewSenseAssocNodeASearch = useCallback(() => {
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            searchKeyword: '',
            searchAppliedKeyword: '',
            searchLoading: false,
            searchResults: []
        }));
    }, []);

    const selectNewSenseAssocNodeA = useCallback(async (candidate) => {
        const currentNodeId = String(addingSenseNode?._id || '').trim();
        const normalized = buildNewSenseAssocTarget(candidate);
        if (!normalized) {
            alert('无效目标释义');
            return;
        }
        if (String(normalized.nodeId || '').trim() === currentNodeId) {
            alert('同一标题下不同释义不能建立关联关系');
            return;
        }
        const nodeDetail = await fetchNodeDetailForNewSenseAssoc(normalized.nodeId);
        const targetNode = buildNewSenseAssocTarget(nodeDetail || normalized, normalized.senseId) || normalized;
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            currentStep: ASSOC_STEPS.SELECT_RELATION,
            selectedNodeA: targetNode,
            selectedNodeASenseId: targetNode.senseId,
            selectedRelationType: '',
            selectedNodeB: null,
            selectedNodeBSenseId: '',
            nodeBCandidates: { parents: [], children: [] },
            nodeBSearchAppliedKeyword: '',
            insertDirection: 'aToB',
            insertDirectionLocked: false
        }));
        loadNewSenseAssocNodeBCandidatesBySense(targetNode, targetNode.senseId);
    }, [addingSenseNode, buildNewSenseAssocTarget, fetchNodeDetailForNewSenseAssoc, loadNewSenseAssocNodeBCandidatesBySense]);

    const selectNewSenseAssocRelationType = useCallback((relationType = '') => {
        if (!relationType) return;
        const nextStep = resolveAssociationNextStep(relationType);
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            selectedRelationType: relationType,
            currentStep: nextStep,
            selectedNodeB: nextStep === ASSOC_STEPS.SELECT_NODE_B ? null : prev.selectedNodeB,
            selectedNodeBSenseId: nextStep === ASSOC_STEPS.SELECT_NODE_B ? '' : prev.selectedNodeBSenseId,
            nodeBSearchAppliedKeyword: '',
            insertDirection: 'aToB',
            insertDirectionLocked: false
        }));
        if (nextStep === ASSOC_STEPS.SELECT_NODE_B) {
            loadNewSenseAssocNodeBCandidatesBySense(newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId);
        }
    }, [loadNewSenseAssocNodeBCandidatesBySense, newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId]);

    const submitNewSenseAssocNodeBSearch = useCallback((rawKeyword = '') => {
        const keyword = String(rawKeyword || '').trim();
        const keywordMeta = parseAssociationKeyword(keyword);
        const normalizedKeyword = keywordMeta.mode === 'include'
            ? '#include'
            : (keywordMeta.mode === 'expand' ? '#expand' : '');
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            nodeBSearchAppliedKeyword: normalizedKeyword
        }));
    }, []);

    const selectNewSenseAssocNodeB = useCallback(async (candidate, fromParents = false) => {
        const currentNodeId = String(addingSenseNode?._id || '').trim();
        const nodeAKey = buildSenseKey(newSenseAssocFlow.selectedNodeA?.nodeId || newSenseAssocFlow.selectedNodeA?._id || '', newSenseAssocFlow.selectedNodeASenseId);
        const normalized = buildNewSenseAssocTarget(candidate);
        if (!normalized) {
            alert('无效目标释义');
            return;
        }
        if (normalized.searchKey === nodeAKey) {
            alert('左右两侧不能选择同一个释义');
            return;
        }
        if (String(normalized.nodeId || '').trim() === currentNodeId) {
            alert('同一标题下不同释义不能建立关联关系');
            return;
        }
        const nodeDetail = await fetchNodeDetailForNewSenseAssoc(normalized.nodeId);
        const targetNode = buildNewSenseAssocTarget(nodeDetail || normalized, normalized.senseId) || normalized;
        const preferredDirection = fromParents ? 'bToA' : 'aToB';
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            selectedNodeB: targetNode,
            selectedNodeBSenseId: targetNode.senseId,
            insertDirection: preferredDirection,
            insertDirectionLocked: false,
            currentStep: ASSOC_STEPS.PREVIEW
        }));
        syncNewSenseAssocInsertDirection(
            newSenseAssocFlow.selectedNodeA,
            newSenseAssocFlow.selectedNodeASenseId,
            targetNode,
            targetNode.senseId,
            preferredDirection
        );
    }, [
        addingSenseNode,
        buildNewSenseAssocTarget,
        fetchNodeDetailForNewSenseAssoc,
        newSenseAssocFlow.selectedNodeA,
        newSenseAssocFlow.selectedNodeASenseId,
        syncNewSenseAssocInsertDirection
    ]);

    const handleNewSenseAssocNodeASenseChange = useCallback((senseId = '') => {
        const nextSenseId = String(senseId || '').trim();
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            selectedNodeASenseId: nextSenseId
        }));
        loadNewSenseAssocNodeBCandidatesBySense(newSenseAssocFlow.selectedNodeA, nextSenseId);
        syncNewSenseAssocInsertDirection(
            newSenseAssocFlow.selectedNodeA,
            nextSenseId,
            newSenseAssocFlow.selectedNodeB,
            newSenseAssocFlow.selectedNodeBSenseId,
            newSenseAssocFlow.insertDirection || 'aToB'
        );
    }, [
        loadNewSenseAssocNodeBCandidatesBySense,
        newSenseAssocFlow.insertDirection,
        newSenseAssocFlow.selectedNodeA,
        newSenseAssocFlow.selectedNodeB,
        newSenseAssocFlow.selectedNodeBSenseId,
        syncNewSenseAssocInsertDirection
    ]);

    const goBackNewSenseAssocStep = useCallback(() => {
        const previousStep = resolveAssociationBackStep(
            newSenseAssocFlow.currentStep,
            newSenseAssocFlow.selectedRelationType
        );
        if (!previousStep) {
            setNewSenseAssocFlow(createEmptyNewSenseAssocFlow());
            return;
        }
        setNewSenseAssocFlow((prev) => ({
            ...prev,
            currentStep: previousStep
        }));
    }, [newSenseAssocFlow.currentStep, newSenseAssocFlow.selectedRelationType]);

    const cancelNewSenseAssocFlow = useCallback(() => {
        setNewSenseAssocFlow(createEmptyNewSenseAssocFlow());
    }, []);

    const confirmNewSenseAssocRelation = useCallback(() => {
        const relationType = newSenseAssocFlow.selectedRelationType;
        if (!relationType) {
            alert('请先选择关系类型');
            return;
        }
        if (relationType === ASSOC_RELATION_TYPES.INSERT) {
            const leftTarget = buildNewSenseAssocTarget(newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId);
            const rightTarget = buildNewSenseAssocTarget(newSenseAssocFlow.selectedNodeB, newSenseAssocFlow.selectedNodeBSenseId);
            if (!leftTarget || !rightTarget) {
                alert('请先选择两个目标释义');
                return;
            }
            if (leftTarget.searchKey === rightTarget.searchKey) {
                alert('左右两侧不能选择同一个目标释义');
                return;
            }
            const direction = newSenseAssocFlow.insertDirection === 'bToA'
                ? ASSOC_RELATION_TYPES.EXTENDS
                : ASSOC_RELATION_TYPES.CONTAINS;
            const relationList = Array.isArray(newSenseForm.relations) ? newSenseForm.relations : [];
            const duplicated = relationList.some((item) => (
                item.kind === ASSOC_RELATION_TYPES.INSERT
                && item.direction === direction
                && item.leftTarget?.searchKey === leftTarget.searchKey
                && item.rightTarget?.searchKey === rightTarget.searchKey
            ));
            if (duplicated) {
                alert('该插入关系已存在');
                return;
            }
            setNewSenseForm((prev) => ({
                ...prev,
                relations: [
                    ...(Array.isArray(prev.relations) ? prev.relations : []),
                    {
                        id: createLocalId('rel'),
                        kind: ASSOC_RELATION_TYPES.INSERT,
                        relationType: ASSOC_RELATION_TYPES.INSERT,
                        direction,
                        leftTarget,
                        rightTarget
                    }
                ]
            }));
            setNewSenseAssocFlow(createEmptyNewSenseAssocFlow());
            return;
        }

        const target = buildNewSenseAssocTarget(newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId);
        if (!target) {
            alert('请先选择目标释义');
            return;
        }
        const relationList = Array.isArray(newSenseForm.relations) ? newSenseForm.relations : [];
        const duplicated = relationList.some((item) => (
            item.kind === 'single'
            && item.relationType === relationType
            && item.target?.searchKey === target.searchKey
        ));
        if (duplicated) {
            alert('该关联关系已存在');
            return;
        }
        const oppositeType = relationType === ASSOC_RELATION_TYPES.CONTAINS
            ? ASSOC_RELATION_TYPES.EXTENDS
            : ASSOC_RELATION_TYPES.CONTAINS;
        const hasOpposite = relationList.some((item) => (
            item.kind === 'single'
            && item.relationType === oppositeType
            && item.target?.searchKey === target.searchKey
        ));
        if (hasOpposite) {
            alert(`同一个释义不能同时使用 ${REL_SYMBOL_SUPERSET} 与 ${REL_SYMBOL_SUBSET} 指向同一目标释义`);
            return;
        }
        setNewSenseForm((prev) => ({
            ...prev,
            relations: [
                ...(Array.isArray(prev.relations) ? prev.relations : []),
                {
                    id: createLocalId('rel'),
                    kind: 'single',
                    relationType,
                    target
                }
            ]
        }));
        setNewSenseAssocFlow(createEmptyNewSenseAssocFlow());
    }, [buildNewSenseAssocTarget, newSenseAssocFlow, newSenseForm.relations]);

    const removeRelationFromNewSense = (relationId) => {
        setNewSenseForm((prev) => ({
            ...prev,
            relations: (Array.isArray(prev.relations) ? prev.relations : []).filter((item) => item.id !== relationId)
        }));
    };

    const saveNewSense = async () => {
        if (!addingSenseNode?._id) return;
        const trimmedTitle = String(newSenseForm.title || '').trim();
        const trimmedContent = String(newSenseForm.content || '').trim();
        if (!trimmedTitle) {
            alert('释义题目不能为空');
            return;
        }
        if (!trimmedContent) {
            alert('释义内容不能为空');
            return;
        }
        const duplicated = normalizeNodeSenses(addingSenseNode).some((item) => (
            String(item?.title || '').trim().toLowerCase() === trimmedTitle.toLowerCase()
        ));
        if (duplicated) {
            alert('同一知识域下多个释义题目不能重名');
            return;
        }
        const relationList = Array.isArray(newSenseForm.relations) ? newSenseForm.relations : [];
        const associations = [];
        relationList.forEach((relation) => {
            if (relation.kind === 'single' && relation?.target?.nodeId && relation?.target?.senseId) {
                associations.push({
                    targetNode: relation.target.nodeId,
                    targetSenseId: relation.target.senseId,
                    relationType: relation.relationType
                });
            }
            if (relation.kind === ASSOC_RELATION_TYPES.INSERT && relation?.leftTarget?.nodeId && relation?.rightTarget?.nodeId) {
                const upperTarget = relation.direction === ASSOC_RELATION_TYPES.EXTENDS
                    ? relation.rightTarget
                    : relation.leftTarget;
                const lowerTarget = relation.direction === ASSOC_RELATION_TYPES.EXTENDS
                    ? relation.leftTarget
                    : relation.rightTarget;
                associations.push({
                    targetNode: upperTarget.nodeId,
                    targetSenseId: upperTarget.senseId,
                    relationType: ASSOC_RELATION_TYPES.INSERT,
                    insertSide: 'left',
                    insertGroupId: relation.id
                });
                associations.push({
                    targetNode: lowerTarget.nodeId,
                    targetSenseId: lowerTarget.senseId,
                    relationType: ASSOC_RELATION_TYPES.INSERT,
                    insertSide: 'right',
                    insertGroupId: relation.id
                });
            }
        });
        const token = localStorage.getItem('token');
        setIsSavingNewSense(true);
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${addingSenseNode._id}/admin/senses`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    title: trimmedTitle,
                    content: trimmedContent,
                    associations
                })
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data?.error || '新增释义失败');
                return;
            }
            alert(data?.message || '释义已新增');
            setShowAddSenseModal(false);
            setAddingSenseNode(null);
            resetNewSenseEditor();
            fetchAllNodes(adminDomainPage, adminDomainSearchKeyword);
        } catch (error) {
            console.error('新增释义失败:', error);
            alert('新增释义失败');
        } finally {
            setIsSavingNewSense(false);
        }
    };

    const getSenseEditToken = (nodeId, senseId) => `${String(nodeId || '')}:${String(senseId || '')}`;

    const startEditSenseText = (node, sense) => {
        const token = getSenseEditToken(node?._id, sense?.senseId);
        if (!token) return;
        setEditingSenseToken(token);
        setEditingSenseForm({
            title: sense?.title || '',
            content: sense?.content || ''
        });
    };

    const cancelEditSenseText = () => {
        if (editingSenseActionToken) return;
        setEditingSenseToken('');
        setEditingSenseForm({ title: '', content: '' });
    };

    const saveSenseTextEdit = async (node, sense) => {
        const nodeId = node?._id;
        const senseId = sense?.senseId;
        if (!nodeId || !senseId) return;
        const token = getSenseEditToken(nodeId, senseId);
        const title = String(editingSenseForm.title || '').trim();
        const content = String(editingSenseForm.content || '').trim();
        if (!title) {
            alert('释义题目不能为空');
            return;
        }
        if (!content) {
            alert('释义内容不能为空');
            return;
        }
        setEditingSenseActionToken(token);
        const authToken = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/admin/senses/${encodeURIComponent(senseId)}/text`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ title, content })
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data?.error || '释义编辑失败');
                return;
            }
            alert(data?.message || '释义已更新');
            setEditingSenseToken('');
            setEditingSenseForm({ title: '', content: '' });
            fetchAllNodes(adminDomainPage, adminDomainSearchKeyword);
        } catch (error) {
            console.error('释义编辑失败:', error);
            alert('释义编辑失败');
        } finally {
            setEditingSenseActionToken('');
        }
    };

    const fetchDeleteSensePreview = useCallback(async (node, sense, decisions = {}) => {
        if (!node?._id || !sense?.senseId) return;
        const token = localStorage.getItem('token');
        setDeleteSensePreviewLoading(true);
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/admin/senses/${encodeURIComponent(sense.senseId)}/delete-preview`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    onRemovalStrategy: 'disconnect',
                    bridgeDecisions: toBridgeDecisionPayload(decisions)
                })
            });
            const data = await response.json();
            if (!response.ok) {
                alert(data?.error || '删除释义预览失败');
                return;
            }
            setDeleteSensePreviewData(data);
        } catch (error) {
            console.error('删除释义预览失败:', error);
            alert('删除释义预览失败');
        } finally {
            setDeleteSensePreviewLoading(false);
        }
    }, [toBridgeDecisionPayload]);

    const openDeleteSenseModal = (node, sense) => {
        setDeletingSenseContext({ node, sense });
        setDeleteSenseBridgeDecisions({});
        setShowDeleteSenseDecisionModal(false);
        setDeleteSenseDecisionPair(null);
        setDeleteSenseDecisionApplying(false);
        setDeleteSensePreviewData(null);
        setShowDeleteSenseModal(true);
        fetchDeleteSensePreview(node, sense, {});
    };

    const closeDeleteSenseModal = () => {
        if (isDeletingSense || deleteSenseDecisionApplying) return;
        setShowDeleteSenseModal(false);
        setDeletingSenseContext(null);
        setDeleteSenseBridgeDecisions({});
        setShowDeleteSenseDecisionModal(false);
        setDeleteSenseDecisionPair(null);
        setDeleteSenseDecisionApplying(false);
        setDeleteSensePreviewData(null);
        setDeleteSensePreviewLoading(false);
    };

    const deleteSense = async () => {
        const node = deletingSenseContext?.node;
        const sense = deletingSenseContext?.sense;
        if (!node?._id || !sense?.senseId) return;
        if (deleteSensePendingBridgePairs.length > 0) {
            alert('请先在左侧逐条完成关联关系处理，全部移到右侧后才能删除');
            return;
        }
        if ((deleteSensePreviewData?.unresolvedBridgeDecisionCount || 0) > 0) {
            alert('请先逐条确认删除后的上下级承接关系（保留承接或断开）');
            return;
        }
        const token = localStorage.getItem('token');
        setIsDeletingSense(true);
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/admin/senses/${encodeURIComponent(sense.senseId)}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    onRemovalStrategy: 'disconnect',
                    bridgeDecisions: toBridgeDecisionPayload(deleteSenseBridgeDecisions)
                })
            });
            const data = await response.json();
            if (!response.ok) {
                if (data?.bridgeDecisionItems) {
                    setDeleteSensePreviewData((prev) => ({
                        ...(prev || {}),
                        ...data
                    }));
                }
                alert(data?.error || '删除释义失败');
                return;
            }
            alert(data?.message || '释义已删除');
            setShowDeleteSenseModal(false);
            setDeletingSenseContext(null);
            setDeleteSenseBridgeDecisions({});
            setShowDeleteSenseDecisionModal(false);
            setDeleteSenseDecisionPair(null);
            setDeleteSenseDecisionApplying(false);
            setDeleteSensePreviewData(null);
            setDeleteSensePreviewLoading(false);
            fetchAllNodes(adminDomainPage, adminDomainSearchKeyword);
        } catch (error) {
            console.error('删除释义失败:', error);
            alert('删除释义失败');
        } finally {
            setIsDeletingSense(false);
        }
    };

    const fetchDeleteNodePreview = useCallback(async (node, decisions = {}) => {
        if (!node?._id) return;
        const token = localStorage.getItem('token');
        setDeletePreviewLoading(true);
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/delete-preview`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    onRemovalStrategy: 'disconnect',
                    bridgeDecisions: toBridgeDecisionPayload(decisions)
                })
            });
            const data = await response.json();
            if (response.ok) {
                setDeletePreviewData(data);
                return { ok: true, data };
            } else {
                alert(data.error || '删除预览失败');
                return { ok: false, data };
            }
        } catch (error) {
            console.error('删除预览失败:', error);
            alert('删除预览失败');
            return { ok: false, error };
        } finally {
            setDeletePreviewLoading(false);
        }
    }, [toBridgeDecisionPayload]);

    const openDeleteNodeConfirmModal = async (node) => {
        const nextNode = node || null;
        if (!nextNode?._id) return;
        setDeletingNodeTarget(nextNode);
        setDeleteBridgeDecisions({});
        setDeletePreviewData(null);
        const previewResult = await fetchDeleteNodePreview(nextNode, {});
        if (previewResult?.ok) {
            setShowDeleteNodeConfirmModal(true);
        } else {
            setShowDeleteNodeConfirmModal(false);
            setDeletingNodeTarget(null);
            setDeleteBridgeDecisions({});
            setDeletePreviewData(null);
        }
    };

    const closeDeleteNodeConfirmModal = () => {
        if (isDeletingNode) return;
        setShowDeleteNodeConfirmModal(false);
        setDeletingNodeTarget(null);
        setDeletePreviewData(null);
        setDeleteBridgeDecisions({});
        setDeletePreviewLoading(false);
    };

    const deleteNode = async () => {
        if (!deletingNodeTarget?._id) return;
        if ((deletePreviewData?.unresolvedBridgeDecisionCount || 0) > 0) {
            alert('请先逐条确认删除后的上下级承接关系（保留承接或断开）');
            return;
        }
        const token = localStorage.getItem('token');
        setIsDeletingNode(true);
        let isSuccess = false;
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${deletingNodeTarget._id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    onRemovalStrategy: 'disconnect',
                    bridgeDecisions: toBridgeDecisionPayload(deleteBridgeDecisions)
                })
            });
            const data = await response.json();
            if (response.ok) {
                alert('节点已删除');
                isSuccess = true;
                const targetPage = adminDomainPage > 1 && allNodes.length <= 1
                    ? adminDomainPage - 1
                    : adminDomainPage;
                fetchAllNodes(targetPage, adminDomainSearchKeyword);
            } else {
                if (data?.bridgeDecisionItems) {
                    setDeletePreviewData((prev) => ({
                        ...(prev || {}),
                        ...data
                    }));
                }
                alert(data.error || '删除失败');
            }
        } catch (error) {
            console.error('删除节点失败:', error);
            alert('删除失败');
        } finally {
            setIsDeletingNode(false);
            if (isSuccess) {
                setShowDeleteNodeConfirmModal(false);
                setDeletingNodeTarget(null);
                setDeletePreviewData(null);
                setDeleteBridgeDecisions({});
            }
        }
    };

    const toggleFeaturedNode = async (nodeId, currentFeatured) => {
        const token = localStorage.getItem('token');
        const action = currentFeatured ? '取消热门' : '设置为热门';
        if (!window.confirm(`确定要${action}吗？`)) return;

        let featuredOrder = 0;
        if (!currentFeatured) {
            const orderInput = window.prompt('请输入热门节点的排序（数字越小越靠前）：', '0');
            if (orderInput === null) return;
            featuredOrder = parseInt(orderInput) || 0;
        }

        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/featured`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    isFeatured: !currentFeatured,
                    featuredOrder: featuredOrder
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
    };

    const hierarchicalNodeList = useMemo(() => (
        allNodes.map((node) => {
            const senses = normalizeNodeSenses(node).map((sense) => {
                const summary = getNodeSenseAssociationSummary(node, sense.senseId);
                return {
                    ...sense,
                    associationSummary: summary
                };
            });
            return {
                ...node,
                senses
            };
        })
    ), [allNodes, getNodeSenseAssociationSummary, normalizeNodeSenses]);

    const deletingNodePreview = useMemo(
        () => buildNodeDeletePreview(deletingNodeTarget),
        [buildNodeDeletePreview, deletingNodeTarget]
    );
    const deletePreviewSummary = deletePreviewData?.summary || null;
    const deleteBeforeRelations = Array.isArray(deletePreviewSummary?.beforeRelations)
        ? deletePreviewSummary.beforeRelations
        : [];
    const deleteAfterRelations = Array.isArray(deletePreviewSummary?.reconnectLines)
        ? deletePreviewSummary.reconnectLines
            .map((item) => item?.line)
            .filter(Boolean)
        : [];
    const deleteLostBridgePairs = Array.isArray(deletePreviewSummary?.lostBridgePairs)
        ? deletePreviewSummary.lostBridgePairs
        : [];
    const deleteSensePreviewSummary = deleteSensePreviewData?.summary || null;
    const deleteSenseBeforeRelations = Array.isArray(deleteSensePreviewSummary?.beforeRelations)
        ? deleteSensePreviewSummary.beforeRelations
        : [];
    const deleteSenseAfterRelations = Array.isArray(deleteSensePreviewSummary?.reconnectLines)
        ? deleteSensePreviewSummary.reconnectLines
            .map((item) => item?.line)
            .filter(Boolean)
        : [];
    const deleteSenseLostBridgePairs = useMemo(() => (
        Array.isArray(deleteSensePreviewSummary?.lostBridgePairs)
            ? deleteSensePreviewSummary.lostBridgePairs
            : []
    ), [deleteSensePreviewSummary]);
    const deleteSensePendingBridgePairs = useMemo(() => (
        deleteSenseLostBridgePairs.filter((pair) => {
            const pairKey = String(pair?.pairKey || '').trim();
            if (!pairKey) return false;
            return !deleteSenseBridgeDecisions[pairKey];
        })
    ), [deleteSenseBridgeDecisions, deleteSenseLostBridgePairs]);
    const deleteSenseConfirmedBridgePairs = useMemo(() => (
        deleteSenseLostBridgePairs
            .map((pair) => {
                const pairKey = String(pair?.pairKey || '').trim();
                if (!pairKey) return null;
                const action = deleteSenseBridgeDecisions[pairKey] || '';
                if (action !== 'reconnect' && action !== 'disconnect') return null;
                return { ...pair, pairKey, action };
            })
            .filter(Boolean)
    ), [deleteSenseBridgeDecisions, deleteSenseLostBridgePairs]);
    const newSenseAssocSourceDisplay = useMemo(
        () => String(newSenseForm.title || '').trim() || '当前释义',
        [newSenseForm.title]
    );
    const newSenseAssocTargetDisplay = useMemo(
        () => formatNodeSenseDisplay(newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId),
        [formatNodeSenseDisplay, newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId]
    );
    const newSenseAssocSecondTargetDisplay = useMemo(
        () => formatNodeSenseDisplay(newSenseAssocFlow.selectedNodeB, newSenseAssocFlow.selectedNodeBSenseId),
        [formatNodeSenseDisplay, newSenseAssocFlow.selectedNodeB, newSenseAssocFlow.selectedNodeBSenseId]
    );
    const newSenseAssocNodeASenseOptions = useMemo(() => {
        const nodeA = newSenseAssocFlow.selectedNodeA;
        if (!nodeA) return [];
        const list = normalizeNodeSenses(nodeA);
        const hasSelected = list.some((item) => item.senseId === newSenseAssocFlow.selectedNodeASenseId);
        if (hasSelected) return list;
        const selectedSense = String(newSenseAssocFlow.selectedNodeASenseId || '').trim();
        if (!selectedSense) return list;
        return [...list, { senseId: selectedSense, title: selectedSense, content: '' }];
    }, [newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId, normalizeNodeSenses]);
    const newSenseAssocNodeBCandidateView = useMemo(() => {
        const keywordMeta = parseAssociationKeyword(newSenseAssocFlow.nodeBSearchAppliedKeyword);
        const mode = keywordMeta.mode;
        const textKeyword = keywordMeta.textKeyword;
        const filterByKeyword = (list = []) => (Array.isArray(list) ? list : [])
            .filter((item) => matchKeywordByDomainAndSense(item, textKeyword));
        const normalizedParents = filterByKeyword(newSenseAssocFlow.nodeBCandidates?.parents || []);
        const normalizedChildren = filterByKeyword(newSenseAssocFlow.nodeBCandidates?.children || []);
        if (!mode) {
            return { parents: [], children: [] };
        }
        if (mode === 'include') {
            return { parents: normalizedParents, children: [] };
        }
        if (mode === 'expand') {
            return { parents: [], children: normalizedChildren };
        }
        return { parents: normalizedParents, children: normalizedChildren };
    }, [newSenseAssocFlow.nodeBCandidates, newSenseAssocFlow.nodeBSearchAppliedKeyword]);
    const newSenseAssocInsertRelationAvailable = useMemo(() => {
        const candidateParents = Array.isArray(newSenseAssocFlow.nodeBCandidates?.parents)
            ? newSenseAssocFlow.nodeBCandidates.parents.length
            : 0;
        const candidateChildren = Array.isArray(newSenseAssocFlow.nodeBCandidates?.children)
            ? newSenseAssocFlow.nodeBCandidates.children.length
            : 0;
        return candidateParents + candidateChildren > 0;
    }, [newSenseAssocFlow.nodeBCandidates]);
    const newSenseAssocInsertRelationUnavailableReason = useMemo(() => (
        newSenseAssocInsertRelationAvailable
            ? ''
            : '该目标释义当前无可用的插入链路候选'
    ), [newSenseAssocInsertRelationAvailable]);
    const newSenseAssocPreviewInfoText = useMemo(() => {
        if (newSenseAssocFlow.selectedRelationType === ASSOC_RELATION_TYPES.EXTENDS) {
            return `${newSenseAssocSourceDisplay} ${REL_SYMBOL_SUPERSET} ${newSenseAssocTargetDisplay}`;
        }
        if (newSenseAssocFlow.selectedRelationType === ASSOC_RELATION_TYPES.CONTAINS) {
            return `${newSenseAssocSourceDisplay} ${REL_SYMBOL_SUBSET} ${newSenseAssocTargetDisplay}`;
        }
        if (newSenseAssocFlow.selectedRelationType === ASSOC_RELATION_TYPES.INSERT) {
            const relationSymbol = newSenseAssocFlow.insertDirection === 'bToA' ? REL_SYMBOL_SUBSET : REL_SYMBOL_SUPERSET;
            const lockHint = newSenseAssocFlow.insertDirectionLocked ? '（方向已锁定）' : '';
            return `${newSenseAssocTargetDisplay} ${relationSymbol} ${newSenseAssocSourceDisplay} ${relationSymbol} ${newSenseAssocSecondTargetDisplay}${lockHint}`;
        }
        return '';
    }, [
        newSenseAssocFlow.insertDirection,
        newSenseAssocFlow.insertDirectionLocked,
        newSenseAssocFlow.selectedRelationType,
        newSenseAssocSecondTargetDisplay,
        newSenseAssocSourceDisplay,
        newSenseAssocTargetDisplay
    ]);

    useEffect(() => {
        if (newSenseAssocFlow.currentStep === ASSOC_STEPS.PREVIEW && newSenseAssocPreviewCanvasRef.current) {
            const canvas = newSenseAssocPreviewCanvasRef.current;
            const shouldRecreateRenderer = (
                !newSenseAssocPreviewRendererRef.current
                || newSenseAssocPreviewRendererRef.current.canvas !== canvas
            );
            if (shouldRecreateRenderer) {
                if (newSenseAssocPreviewRendererRef.current) {
                    newSenseAssocPreviewRendererRef.current.destroy();
                }
                newSenseAssocPreviewRendererRef.current = new MiniPreviewRenderer(canvas);
            }
            newSenseAssocPreviewRendererRef.current.setPreviewScene({
                nodeA: newSenseAssocFlow.selectedNodeA,
                nodeB: newSenseAssocFlow.selectedNodeB,
                relationType: newSenseAssocFlow.selectedRelationType,
                newNodeName: addingSenseNode?.name || '当前节点',
                insertDirection: newSenseAssocFlow.insertDirection || 'aToB',
                nodeALabel: formatNodeSenseDisplay(newSenseAssocFlow.selectedNodeA, newSenseAssocFlow.selectedNodeASenseId),
                nodeBLabel: formatNodeSenseDisplay(newSenseAssocFlow.selectedNodeB, newSenseAssocFlow.selectedNodeBSenseId),
                newNodeLabel: newSenseAssocSourceDisplay,
                showPendingTag: false
            });
        }
        return () => {
            if (newSenseAssocFlow.currentStep !== ASSOC_STEPS.PREVIEW && newSenseAssocPreviewRendererRef.current) {
                newSenseAssocPreviewRendererRef.current.destroy();
                newSenseAssocPreviewRendererRef.current = null;
            }
        };
    }, [
        addingSenseNode,
        formatNodeSenseDisplay,
        newSenseAssocFlow.currentStep,
        newSenseAssocFlow.insertDirection,
        newSenseAssocFlow.selectedNodeA,
        newSenseAssocFlow.selectedNodeASenseId,
        newSenseAssocFlow.selectedNodeB,
        newSenseAssocFlow.selectedNodeBSenseId,
        newSenseAssocFlow.selectedRelationType,
        newSenseAssocSourceDisplay
    ]);

    useEffect(() => () => {
        if (newSenseAssocPreviewRendererRef.current) {
            newSenseAssocPreviewRendererRef.current.destroy();
            newSenseAssocPreviewRendererRef.current = null;
        }
    }, []);

    const resolveDeleteBridgePairMode = useCallback((pair, beforeRelations = []) => {
        const sourceSenseId = String(pair?.sourceSenseId || '').trim();
        const upperNodeId = String(pair?.upper?.nodeId || '').trim();
        const upperSenseId = String(pair?.upper?.senseId || '').trim();
        const lowerNodeId = String(pair?.lower?.nodeId || '').trim();
        const lowerSenseId = String(pair?.lower?.senseId || '').trim();
        const relationList = Array.isArray(beforeRelations) ? beforeRelations : [];
        const hasUpper = relationList.some((line) => (
            String(line?.source?.senseId || '').trim() === sourceSenseId
            && String(line?.target?.nodeId || '').trim() === upperNodeId
            && String(line?.target?.senseId || '').trim() === upperSenseId
            && line?.relationType === ASSOC_RELATION_TYPES.EXTENDS
        ));
        const hasLower = relationList.some((line) => (
            String(line?.source?.senseId || '').trim() === sourceSenseId
            && String(line?.target?.nodeId || '').trim() === lowerNodeId
            && String(line?.target?.senseId || '').trim() === lowerSenseId
            && line?.relationType === ASSOC_RELATION_TYPES.CONTAINS
        ));
        if (hasUpper && hasLower) return ASSOC_RELATION_TYPES.INSERT;
        if (hasUpper) return ASSOC_RELATION_TYPES.EXTENDS;
        if (hasLower) return ASSOC_RELATION_TYPES.CONTAINS;
        return ASSOC_RELATION_TYPES.INSERT;
    }, []);

    const closeDeleteSenseDecisionModal = useCallback(() => {
        if (deleteSenseDecisionApplying) return;
        setShowDeleteSenseDecisionModal(false);
        setDeleteSenseDecisionPair(null);
    }, [deleteSenseDecisionApplying]);

    const openDeleteSenseDecisionModal = useCallback((pair = null) => {
        const pairKey = String(pair?.pairKey || '').trim();
        if (!pairKey) return;
        setDeleteSenseDecisionPair(pair);
        setShowDeleteSenseDecisionModal(true);
    }, []);

    const applyDeleteSensePairDecision = useCallback(async (action) => {
        const node = deletingSenseContext?.node || null;
        const sense = deletingSenseContext?.sense || null;
        if (!node?._id || !sense?.senseId) return;
        const pairKey = String(deleteSenseDecisionPair?.pairKey || '').trim();
        if (!pairKey) {
            alert('当前未选择待处理关系');
            return;
        }
        if (action !== 'reconnect' && action !== 'disconnect') {
            alert('请选择有效的处理方式');
            return;
        }
        setDeleteSenseDecisionApplying(true);
        const nextDecisions = {
            ...deleteSenseBridgeDecisions,
            [pairKey]: action
        };
        setDeleteSenseBridgeDecisions(nextDecisions);
        try {
            await fetchDeleteSensePreview(node, sense, nextDecisions);
            setShowDeleteSenseDecisionModal(false);
            setDeleteSenseDecisionPair(null);
        } finally {
            setDeleteSenseDecisionApplying(false);
        }
    }, [
        deleteSenseBridgeDecisions,
        deleteSenseDecisionPair,
        deletingSenseContext,
        fetchDeleteSensePreview
    ]);

    const rollbackDeleteSensePairDecision = useCallback(async (pairKey) => {
        const safePairKey = String(pairKey || '').trim();
        if (!safePairKey) return;
        const node = deletingSenseContext?.node || null;
        const sense = deletingSenseContext?.sense || null;
        if (!node?._id || !sense?.senseId) return;
        const nextDecisions = { ...deleteSenseBridgeDecisions };
        delete nextDecisions[safePairKey];
        setDeleteSenseBridgeDecisions(nextDecisions);
        await fetchDeleteSensePreview(node, sense, nextDecisions);
    }, [deleteSenseBridgeDecisions, deletingSenseContext, fetchDeleteSensePreview]);

    const handleDeleteNodeBridgeDecision = useCallback((pairKey, action) => {
        const safePairKey = String(pairKey || '').trim();
        if (!safePairKey || (action !== 'reconnect' && action !== 'disconnect')) return;
        if (!deletingNodeTarget?._id) return;
        const nextDecisions = { ...deleteBridgeDecisions, [safePairKey]: action };
        setDeleteBridgeDecisions(nextDecisions);
        fetchDeleteNodePreview(deletingNodeTarget, nextDecisions);
    }, [deleteBridgeDecisions, deletingNodeTarget, fetchDeleteNodePreview]);

    const renderDeleteBridgeDecisionSection = useCallback(({
        pairs = [],
        beforeRelations = [],
        decisionMap = {},
        unresolvedCount = 0,
        sourceNode = null,
        loading = false,
        deleting = false,
        onDecision = null
    }) => {
        const pairList = Array.isArray(pairs) ? pairs : [];
        if (pairList.length < 1) return null;
        return (
            <div className="admin-delete-bridge-decision-section">
                <h6>承接关系逐条确认</h6>
                <p className="admin-assoc-step-description" style={{ marginBottom: '0.45rem' }}>
                    每条关系都需单独决策，并实时反映到下方删除后预览。
                </p>
                {unresolvedCount > 0 && (
                    <p className="admin-assoc-step-description" style={{ marginBottom: '0.45rem', color: '#fca5a5' }}>
                        尚有 {unresolvedCount} 组未确认，不能删除。
                    </p>
                )}
                <div className="admin-bridge-decision-list">
                    {pairList.map((pair, index) => {
                        const pairKey = String(pair?.pairKey || '').trim();
                        const mode = resolveDeleteBridgePairMode(pair, beforeRelations);
                        const selectedAction = pairKey ? (decisionMap?.[pairKey] || '') : '';
                        const upperDisplay = resolveDecisionPairSideDisplay(pair, 'upper');
                        const sourceDisplay = resolveDecisionCurrentDisplay(sourceNode, pair?.sourceSenseId || '', sourceNode?.name || '当前标题');
                        const lowerDisplay = resolveDecisionPairSideDisplay(pair, 'lower');
                        const afterClassName = selectedAction === 'reconnect'
                            ? 'reconnect'
                            : (selectedAction === 'disconnect' ? 'disconnect' : 'pending');
                        const afterText = selectedAction === 'reconnect'
                            ? `${upperDisplay} ⇢ ${lowerDisplay}`
                            : (
                                selectedAction === 'disconnect'
                                    ? `${upperDisplay} ✕ ${lowerDisplay}`
                                    : '待决策：请选择两端是否承接'
                            );
                        const afterHint = selectedAction === 'reconnect'
                            ? '删除后保留承接链路'
                            : (
                                selectedAction === 'disconnect'
                                    ? '删除后两端保持断开'
                                    : '未决策前不可执行删除'
                            );
                        const reconnectTitle = mode === ASSOC_RELATION_TYPES.INSERT ? '两端直连' : '保留承接';
                        const reconnectHint = mode === ASSOC_RELATION_TYPES.INSERT
                            ? '删除后，原上下级释义恢复直接关联'
                            : '删除后，保持上下级之间承接';
                        const disconnectTitle = mode === ASSOC_RELATION_TYPES.INSERT ? '两端不连' : '断开独立';
                        const disconnectHint = mode === ASSOC_RELATION_TYPES.INSERT
                            ? '删除后，原上下级释义不再直连'
                            : '删除后，不保留上下级承接';
                        const modeText = mode === ASSOC_RELATION_TYPES.EXTENDS
                            ? '上级关系'
                            : (mode === ASSOC_RELATION_TYPES.CONTAINS ? '下级关系' : '插入关系');
                        return (
                            <div key={pairKey || `del_bridge_pair_${index}`} className="admin-bridge-decision-item">
                                <div className="admin-bridge-decision-line">
                                    <span className={`admin-edit-relation-badge ${mode}`}>
                                        {modeText}
                                    </span>
                                    <span>{upperDisplay}</span>
                                    <span className="arrow">⇢ {sourceDisplay} ⇢</span>
                                    <span>{lowerDisplay}</span>
                                </div>
                                <div className="admin-assoc-delete-impact-item admin-delete-bridge-impact-item">
                                    <div className="admin-assoc-delete-impact-line before">
                                        <span className="label">删除前</span>
                                        <span className="diagram">{`${upperDisplay} ⇢ ${sourceDisplay} ⇢ ${lowerDisplay}`}</span>
                                    </div>
                                    <div className={`admin-assoc-delete-impact-line after ${afterClassName}`}>
                                        <span className="label">删除后</span>
                                        <span className="diagram">{afterText}</span>
                                        <span className="hint">{afterHint}</span>
                                    </div>
                                </div>
                                <div className="admin-assoc-delete-option-grid admin-delete-bridge-option-grid">
                                    <button
                                        type="button"
                                        className={`admin-assoc-delete-option ${selectedAction === 'reconnect' ? 'active reconnect' : ''}`}
                                        onClick={() => {
                                            if (onDecision) {
                                                onDecision(pairKey, 'reconnect');
                                            }
                                        }}
                                        disabled={!pairKey || loading || deleting}
                                    >
                                        <strong>{reconnectTitle}</strong>
                                        <small>{reconnectHint}</small>
                                    </button>
                                    <button
                                        type="button"
                                        className={`admin-assoc-delete-option ${selectedAction === 'disconnect' ? 'active disconnect' : ''}`}
                                        onClick={() => {
                                            if (onDecision) {
                                                onDecision(pairKey, 'disconnect');
                                            }
                                        }}
                                        disabled={!pairKey || loading || deleting}
                                    >
                                        <strong>{disconnectTitle}</strong>
                                        <small>{disconnectHint}</small>
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }, [resolveDecisionCurrentDisplay, resolveDecisionPairSideDisplay, resolveDeleteBridgePairMode]);

    // --- Association Management Functions ---
    const toBackendRelationType = (uiRelationType) => (
        uiRelationType === ASSOC_RELATION_TYPES.EXTENDS
            ? ASSOC_RELATION_TYPES.CONTAINS
            : ASSOC_RELATION_TYPES.EXTENDS
    );

    const resetAssociationEditor = useCallback(() => {
        assocNodeBCandidateRequestIdRef.current += 1;
        setAssocCurrentStep(null);
        setAssocSelectedNodeA(null);
        setAssocSelectedRelationType(null);
        setAssocSelectedNodeB(null);
        setAssocInsertDirection(null);
        setAssocSelectedSourceSenseId('');
        setAssocSelectedNodeASenseId('');
        setAssocSelectedNodeBSenseId('');
        setAssocNodeBCandidates({ parents: [], children: [] });
        setAssocNodeBSearchKeyword('');
        setAssocEditingIndex(null);
        setAssocSearchKeyword('');
        setAssocSearchAppliedKeyword('');
        setAssocSearchResults([]);
        setAssocSearchLoading(false);
        setAssocNodeBSearchAppliedKeyword('');

        if (assocPreviewRendererRef.current) {
            assocPreviewRendererRef.current.destroy();
            assocPreviewRendererRef.current = null;
        }
    }, []);

    const closeEditAssociationModal = useCallback(() => {
        setShowEditAssociationModal(false);
        setEditingAssociationNode(null);
        setEditingAssociationSenseId('');
        setEditAssociations([]);
        setAssocApplyLoading(false);
        setAssocBridgeDecisions({});
        setShowAssocDeleteDecisionModal(false);
        setAssocDeleteDecisionContext(null);
        setAssocDeleteDecisionAction('disconnect');
        setAssocDeleteSearchKeyword('');
        setAssocDeleteSearchAppliedKeyword('');
        setAssocDeleteSearchResults([]);
        setAssocDeleteSearchLoading(false);
        setAssocDeleteSelectedTarget(null);
        setAssocDeleteApplying(false);
        resetAssociationEditor();
    }, [resetAssociationEditor]);

    useEffect(() => {
        if (assocCurrentStep === ASSOC_STEPS.PREVIEW && assocPreviewCanvasRef.current) {
            const canvas = assocPreviewCanvasRef.current;
            const shouldRecreateRenderer = (
                !assocPreviewRendererRef.current
                || assocPreviewRendererRef.current.canvas !== canvas
            );
            if (shouldRecreateRenderer) {
                if (assocPreviewRendererRef.current) {
                    assocPreviewRendererRef.current.destroy();
                }
                assocPreviewRendererRef.current = new MiniPreviewRenderer(canvas);
            }

            assocPreviewRendererRef.current.setPreviewScene({
                nodeA: assocSelectedNodeA,
                nodeB: assocSelectedNodeB,
                relationType: assocSelectedRelationType,
                newNodeName: editingAssociationNode?.name || '当前节点',
                insertDirection: assocInsertDirection,
                nodeALabel: formatNodeSenseDisplay(assocSelectedNodeA, assocSelectedNodeASenseId),
                nodeBLabel: formatNodeSenseDisplay(assocSelectedNodeB, assocSelectedNodeBSenseId),
                newNodeLabel: formatNodeSenseDisplay(editingAssociationNode, assocSelectedSourceSenseId),
                showPendingTag: false
            });
        }

        return () => {
            if (assocCurrentStep !== ASSOC_STEPS.PREVIEW && assocPreviewRendererRef.current) {
                assocPreviewRendererRef.current.destroy();
                assocPreviewRendererRef.current = null;
            }
        };
    }, [
        assocCurrentStep,
        assocSelectedNodeA,
        assocSelectedNodeB,
        assocSelectedRelationType,
        assocInsertDirection,
        assocSelectedNodeASenseId,
        assocSelectedNodeBSenseId,
        assocSelectedSourceSenseId,
        assocEditingIndex,
        formatNodeSenseDisplay,
        editingAssociationNode
    ]);

    useEffect(() => () => {
        if (assocPreviewRendererRef.current) {
            assocPreviewRendererRef.current.destroy();
            assocPreviewRendererRef.current = null;
        }
    }, []);

    const fetchNodeDetailForAssociation = async (nodeId) => {
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/public/node-detail/${nodeId}`);
            if (response.ok) {
                const data = await response.json();
                return data.node;
            }
        } catch (error) {
            console.error('获取节点详情失败:', error);
        }
        return null;
    };

    const buildSimpleAssociation = ({
        currentNode,
        sourceSenseId,
        targetNode,
        targetNodeId,
        targetNodeName,
        targetSenseId,
        backendRelationType,
        isNewDraft = false
    }) => {
        const uiRelationType = backendRelationType === ASSOC_RELATION_TYPES.CONTAINS
            ? ASSOC_RELATION_TYPES.EXTENDS
            : ASSOC_RELATION_TYPES.CONTAINS;
        const sourceDisplay = formatNodeSenseDisplay(currentNode, sourceSenseId);
        const targetDisplay = formatNodeSenseDisplay(
            targetNode || { _id: targetNodeId, name: targetNodeName },
            targetSenseId
        );
        return {
            type: uiRelationType,
            nodeA: targetNode || { _id: targetNodeId, name: targetNodeName },
            nodeB: null,
            direction: null,
            sourceSenseId,
            nodeASenseId: targetSenseId,
            targetSenseId,
            actualAssociations: [{
                targetNode: targetNodeId,
                relationType: backendRelationType,
                nodeName: targetNodeName,
                sourceSenseId,
                targetSenseId
            }],
            displayText: formatUiRelationExpression(sourceDisplay, uiRelationType, targetDisplay),
            pendingRemoval: false,
            pendingDecisionLines: [],
            isNewDraft: !!isNewDraft
        };
    };

    const normalizeAssociationDraftList = (draftList = []) => (
        (Array.isArray(draftList) ? draftList : []).filter(Boolean)
    );

    const openEditAssociationModal = (node, sourceSense = null) => {
        setEditingAssociationNode(node);
        setShowEditAssociationModal(true);
        setIsEditAssociationListExpanded(true);
        setAssocApplyLoading(false);
        setAssocBridgeDecisions({});
        setShowAssocDeleteDecisionModal(false);
        setAssocDeleteDecisionContext(null);
        setAssocDeleteDecisionAction('disconnect');
        setAssocDeleteSearchKeyword('');
        setAssocDeleteSearchAppliedKeyword('');
        setAssocDeleteSearchResults([]);
        setAssocDeleteSearchLoading(false);
        setAssocDeleteSelectedTarget(null);
        setAssocDeleteApplying(false);
        resetAssociationEditor();
        const selectedSenseId = resolveNodeSenseId(node, sourceSense?.senseId || '');
        setEditingAssociationSenseId(selectedSenseId);
        setAssocSelectedSourceSenseId(selectedSenseId);

        const rebuiltAssociations = [];

        if (Array.isArray(node.associations) && node.associations.length > 0) {
            const sourceAssociations = [];
            node.associations.forEach((assoc) => {
                const targetNodeId = String(assoc?.targetNode?._id || assoc?.targetNode || '').trim();
                const sourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                if (sourceSenseId && sourceSenseId !== selectedSenseId) return;
                const targetNodeName = String(assoc?.targetNode?.name || '').trim();
                const targetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
                const normalizedTargetSenseId = targetSenseId || resolveNodeSenseId(assoc?.targetNode);
                const backendRelationType = assoc?.relationType;
                const isSimpleRelation = (
                    backendRelationType === ASSOC_RELATION_TYPES.CONTAINS
                    || backendRelationType === ASSOC_RELATION_TYPES.EXTENDS
                );
                if (!targetNodeId || !targetNodeName || !isSimpleRelation) return;
                sourceAssociations.push({
                    targetNode: assoc?.targetNode,
                    targetNodeId,
                    targetNodeName,
                    targetSenseId: normalizedTargetSenseId,
                    sourceSenseId: sourceSenseId || selectedSenseId,
                    backendRelationType
                });
            });

            sourceAssociations.forEach((item) => {
                rebuiltAssociations.push(buildSimpleAssociation({
                    currentNode: node,
                    sourceSenseId: item.sourceSenseId,
                    targetNode: item.targetNode,
                    targetNodeId: item.targetNodeId,
                    targetNodeName: item.targetNodeName,
                    targetSenseId: item.targetSenseId,
                    backendRelationType: item.backendRelationType
                }));
            });
        }

        if (rebuiltAssociations.length === 0 && (!Array.isArray(node.associations) || node.associations.length === 0)) {
            const nodeMap = {};
            allNodes.forEach(n => {
                nodeMap[n.name] = n;
            });

            (node.relatedParentDomains || []).forEach((nodeName) => {
                const targetNode = nodeMap[nodeName];
                if (targetNode) {
                    rebuiltAssociations.push(buildSimpleAssociation({
                        currentNode: node,
                        sourceSenseId: selectedSenseId,
                        targetNode,
                        targetNodeId: targetNode._id,
                        targetNodeName: targetNode.name,
                        targetSenseId: resolveNodeSenseId(targetNode),
                        backendRelationType: ASSOC_RELATION_TYPES.EXTENDS
                    }));
                }
            });

            (node.relatedChildDomains || []).forEach((nodeName) => {
                const targetNode = nodeMap[nodeName];
                if (targetNode) {
                    rebuiltAssociations.push(buildSimpleAssociation({
                        currentNode: node,
                        sourceSenseId: selectedSenseId,
                        targetNode,
                        targetNodeId: targetNode._id,
                        targetNodeName: targetNode.name,
                        targetSenseId: resolveNodeSenseId(targetNode),
                        backendRelationType: ASSOC_RELATION_TYPES.CONTAINS
                    }));
                }
            });
        }

        setEditAssociations(normalizeAssociationDraftList(rebuiltAssociations, {
            currentNode: node,
            currentSenseId: selectedSenseId
        }));
    };

    const searchAssociationNodes = useCallback(async (keyword) => {
        const normalizedKeyword = (keyword || '').trim();
        const keywordMeta = parseAssociationKeyword(normalizedKeyword);
        const effectiveKeyword = keywordMeta.textKeyword;
        setAssocSearchAppliedKeyword(normalizedKeyword);
        if (!effectiveKeyword) {
            setAssocSearchResults([]);
            return;
        }

        setAssocSearchLoading(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/search?keyword=${encodeURIComponent(effectiveKeyword)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                const filtered = (Array.isArray(data) ? data : [])
                    .map((item) => normalizeAssociationCandidate(item))
                    .filter(Boolean)
                    .filter((item) => matchKeywordByDomainAndSense(item, effectiveKeyword))
                    .filter((item) => isAssociationCandidateSelectable(item, item?.senseId || ''));
                setAssocSearchResults(filtered);
            } else {
                setAssocSearchResults([]);
            }
        } catch (error) {
            console.error('搜索节点失败:', error);
            setAssocSearchResults([]);
        } finally {
            setAssocSearchLoading(false);
        }
    }, [isAssociationCandidateSelectable, normalizeAssociationCandidate]);

    const clearAssocNodeASearch = useCallback(() => {
        setAssocSearchKeyword('');
        setAssocSearchAppliedKeyword('');
        setAssocSearchResults([]);
        setAssocSearchLoading(false);
    }, []);

    const submitAssocNodeBSearch = useCallback(async (rawKeyword = assocNodeBSearchKeyword) => {
        const normalizedKeyword = String(rawKeyword || '').trim();
        const keywordMeta = parseAssociationKeyword(normalizedKeyword);
        const normalizedModeKeyword = keywordMeta.mode === 'include'
            ? '#include'
            : (keywordMeta.mode === 'expand' ? '#expand' : '');
        setAssocNodeBSearchKeyword(normalizedModeKeyword);
        setAssocNodeBSearchAppliedKeyword(normalizedModeKeyword);

        if (assocCurrentStep !== ASSOC_STEPS.SELECT_NODE_B) return;
        if (!keywordMeta.mode) return;
    }, [assocCurrentStep, assocNodeBSearchKeyword]);

    const clearAssocNodeBSearch = useCallback(() => {
        assocNodeBSearchRequestIdRef.current += 1;
        setAssocNodeBSearchKeyword('');
        setAssocNodeBSearchAppliedKeyword('');
    }, []);

    const startAddEditAssociation = () => {
        resetAssociationEditor();
        setAssocSelectedSourceSenseId(resolveNodeSenseId(editingAssociationNode, editingAssociationSenseId));
        setAssocCurrentStep(ASSOC_STEPS.SELECT_NODE_A);
    };

    const selectAssocNodeA = async (node) => {
        const normalizedCandidate = normalizeAssociationCandidate(node);
        if (!normalizedCandidate || !isAssociationCandidateSelectable(normalizedCandidate, normalizedCandidate.senseId || '')) {
            alert('该释义不可选，请更换目标释义');
            return;
        }
        const targetNodeId = normalizedCandidate.nodeId;
        const nodeDetail = await fetchNodeDetailForAssociation(targetNodeId);
        if (nodeDetail) {
            setAssocSelectedNodeA(nodeDetail);
            const defaultSourceSenseId = resolveNodeSenseId(editingAssociationNode, assocSelectedSourceSenseId || editingAssociationSenseId);
            const defaultTargetSenseId = resolveAssociationSenseId(nodeDetail, normalizedCandidate.senseId || assocSelectedNodeASenseId);
            setAssocSelectedSourceSenseId(defaultSourceSenseId);
            setAssocSelectedNodeASenseId(defaultTargetSenseId);
            loadAssocNodeBCandidatesBySense(nodeDetail, defaultTargetSenseId);
            setAssocCurrentStep(ASSOC_STEPS.SELECT_RELATION);
        } else {
            alert('获取节点详情失败');
        }
    };

    const selectAssocRelationType = (type) => {
        if (type === ASSOC_RELATION_TYPES.INSERT && !assocInsertRelationAvailable) {
            return;
        }
        setAssocSelectedRelationType(type);

        const nextStep = resolveAssociationNextStep(type);
        if (nextStep === ASSOC_STEPS.SELECT_NODE_B) {
            loadAssocNodeBCandidatesBySense(assocSelectedNodeA, assocSelectedNodeASenseId);
            clearAssocNodeBSearch();
            setAssocCurrentStep(nextStep);
        } else {
            setAssocCurrentStep(nextStep);
        }
    };

    useEffect(() => {
        if (assocCurrentStep !== ASSOC_STEPS.SELECT_NODE_B || assocSelectedRelationType !== ASSOC_RELATION_TYPES.INSERT) return;
        loadAssocNodeBCandidatesBySense(assocSelectedNodeA, assocSelectedNodeASenseId);
    }, [
        assocCurrentStep,
        assocSelectedRelationType,
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        loadAssocNodeBCandidatesBySense
    ]);

    const selectAssocNodeB = async (node, fromParents) => {
        const normalizedCandidate = normalizeAssociationCandidate(node);
        const selectedNodeAKey = toAssociationSenseKey(assocSelectedNodeA, assocSelectedNodeASenseId);
        const excludedSenseKeySet = new Set([selectedNodeAKey].filter(Boolean));
        if (!normalizedCandidate || !isAssociationCandidateSelectable(normalizedCandidate, normalizedCandidate.senseId || '', { excludedSenseKeySet })) {
            alert('该释义不可选，请更换第二个目标释义');
            return;
        }
        const targetNodeId = normalizedCandidate.nodeId;
        const nodeDetail = await fetchNodeDetailForAssociation(targetNodeId);
        const selectedNode = nodeDetail || normalizedCandidate;
        setAssocSelectedNodeB(selectedNode);
        setAssocSelectedNodeBSenseId(resolveAssociationSenseId(selectedNode, normalizedCandidate.senseId || ''));
        setAssocInsertDirection(fromParents ? 'bToA' : 'aToB');
        setAssocCurrentStep(ASSOC_STEPS.PREVIEW);
    };

    const hasExactSenseAssociation = useCallback((sourceNode, targetNodeId, relationType, sourceSenseId, targetSenseId) => {
        if (!sourceNode || !targetNodeId || !relationType || !sourceSenseId || !targetSenseId) return false;
        const assocList = Array.isArray(sourceNode?.associations) ? sourceNode.associations : [];
        return assocList.some((assoc) => {
            const assocTargetNodeId = assoc?.targetNode?._id || assoc?.targetNode;
            const assocRelationType = assoc?.relationType;
            const assocSourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
            const assocTargetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
            return (
                String(assocTargetNodeId || '') === String(targetNodeId)
                && assocRelationType === relationType
                && assocSourceSenseId === String(sourceSenseId)
                && assocTargetSenseId === String(targetSenseId)
            );
        });
    }, []);

    const hasLooseSenseAssociation = useCallback((sourceNode, targetNodeId, relationType, sourceSenseId, targetSenseId) => {
        if (!sourceNode || !targetNodeId || !relationType) return false;
        const assocList = Array.isArray(sourceNode?.associations) ? sourceNode.associations : [];
        const expectedSourceSenseId = String(sourceSenseId || '').trim();
        const expectedTargetSenseId = String(targetSenseId || '').trim();
        return assocList.some((assoc) => {
            const assocTargetNodeId = assoc?.targetNode?._id || assoc?.targetNode;
            const assocRelationType = assoc?.relationType;
            const assocSourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
            const assocTargetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
            if (String(assocTargetNodeId || '') !== String(targetNodeId)) return false;
            if (assocRelationType !== relationType) return false;
            const sourceMatch = !assocSourceSenseId || !expectedSourceSenseId || assocSourceSenseId === expectedSourceSenseId;
            const targetMatch = !assocTargetSenseId || !expectedTargetSenseId || assocTargetSenseId === expectedTargetSenseId;
            return sourceMatch && targetMatch;
        });
    }, []);

    const resolveExistingPairInsertDirection = useCallback((nodeA, nodeASenseId, nodeB, nodeBSenseId) => {
        const aNodeId = String(nodeA?._id || '');
        const bNodeId = String(nodeB?._id || '');
        if (!aNodeId || !bNodeId) return '';
        const normalizedNodeASenseId = String(nodeASenseId || '').trim();
        const normalizedNodeBSenseId = String(nodeBSenseId || '').trim();
        const canUseLooseMatch = !normalizedNodeASenseId || !normalizedNodeBSenseId;
        const hasAContainsB = (
            hasExactSenseAssociation(nodeA, bNodeId, ASSOC_RELATION_TYPES.CONTAINS, normalizedNodeASenseId, normalizedNodeBSenseId)
            || (canUseLooseMatch && hasLooseSenseAssociation(nodeA, bNodeId, ASSOC_RELATION_TYPES.CONTAINS, normalizedNodeASenseId, normalizedNodeBSenseId))
        );
        const hasBExtendsA = (
            hasExactSenseAssociation(nodeB, aNodeId, ASSOC_RELATION_TYPES.EXTENDS, normalizedNodeBSenseId, normalizedNodeASenseId)
            || (canUseLooseMatch && hasLooseSenseAssociation(nodeB, aNodeId, ASSOC_RELATION_TYPES.EXTENDS, normalizedNodeBSenseId, normalizedNodeASenseId))
        );
        if (hasAContainsB || hasBExtendsA) {
            return 'aToB';
        }
        const hasBContainsA = (
            hasExactSenseAssociation(nodeB, aNodeId, ASSOC_RELATION_TYPES.CONTAINS, normalizedNodeBSenseId, normalizedNodeASenseId)
            || (canUseLooseMatch && hasLooseSenseAssociation(nodeB, aNodeId, ASSOC_RELATION_TYPES.CONTAINS, normalizedNodeBSenseId, normalizedNodeASenseId))
        );
        const hasAExtendsB = (
            hasExactSenseAssociation(nodeA, bNodeId, ASSOC_RELATION_TYPES.EXTENDS, normalizedNodeASenseId, normalizedNodeBSenseId)
            || (canUseLooseMatch && hasLooseSenseAssociation(nodeA, bNodeId, ASSOC_RELATION_TYPES.EXTENDS, normalizedNodeASenseId, normalizedNodeBSenseId))
        );
        if (hasBContainsA || hasAExtendsB) {
            return 'bToA';
        }
        return '';
    }, [hasExactSenseAssociation, hasLooseSenseAssociation]);

    const buildInsertNarrative = useCallback((sourceNode, sourceSenseId, nodeA, nodeASenseId, nodeB, nodeBSenseId, preferredDirection = '') => {
        const sourceDisplay = formatNodeSenseDisplay(sourceNode, sourceSenseId);
        const fixedDirection = resolveExistingPairInsertDirection(nodeA, nodeASenseId, nodeB, nodeBSenseId);
        const effectiveDirection = fixedDirection || (preferredDirection === 'bToA' ? 'bToA' : 'aToB');
        const leftDisplay = formatNodeSenseDisplay(nodeA, nodeASenseId);
        const rightDisplay = formatNodeSenseDisplay(nodeB, nodeBSenseId);
        const relationSymbol = effectiveDirection === 'aToB' ? REL_SYMBOL_SUPERSET : REL_SYMBOL_SUBSET;
        const chainPreview = `${leftDisplay} ${relationSymbol} ${sourceDisplay} ${relationSymbol} ${rightDisplay}`;
        const hasOriginalRelation = !!fixedDirection;
        if (hasOriginalRelation) {
            return `${sourceDisplay} 将插入到 ${leftDisplay} 和 ${rightDisplay} 之间，原有链路将改为：${chainPreview}`;
        }
        return `${sourceDisplay} 将插入到 ${leftDisplay} 和 ${rightDisplay} 之间，将新建链路：${chainPreview}`;
    }, [formatNodeSenseDisplay, resolveExistingPairInsertDirection]);

    const recheckAssocInsertDirectionLock = useCallback((nextNodeASenseId = '', nextNodeBSenseId = '') => {
        if (assocSelectedRelationType !== ASSOC_RELATION_TYPES.INSERT) {
            return;
        }
        if (!assocSelectedNodeA?._id || !assocSelectedNodeB?._id) {
            return;
        }
        const safeNodeASenseId = String(nextNodeASenseId || '').trim();
        const safeNodeBSenseId = String(nextNodeBSenseId || '').trim();
        if (!safeNodeASenseId || !safeNodeBSenseId) {
            return;
        }
        const fixedDirection = resolveExistingPairInsertDirection(
            assocSelectedNodeA,
            safeNodeASenseId,
            assocSelectedNodeB,
            safeNodeBSenseId
        );
        if (fixedDirection) {
            setAssocInsertDirection(fixedDirection);
            return;
        }
        setAssocInsertDirection((prev) => prev || 'aToB');
    }, [
        assocSelectedRelationType,
        assocSelectedNodeA,
        assocSelectedNodeB,
        resolveExistingPairInsertDirection
    ]);

    const handleAssocNodeASenseChange = useCallback((senseId = '') => {
        const nextSenseId = String(senseId || '').trim();
        setAssocSelectedNodeASenseId(nextSenseId);
        if (assocSelectedNodeA?._id) {
            loadAssocNodeBCandidatesBySense(assocSelectedNodeA, nextSenseId);
        }
        recheckAssocInsertDirectionLock(nextSenseId, assocSelectedNodeBSenseId);
    }, [
        assocSelectedNodeA,
        assocSelectedNodeBSenseId,
        loadAssocNodeBCandidatesBySense,
        recheckAssocInsertDirectionLock
    ]);

    useEffect(() => {
        recheckAssocInsertDirectionLock(assocSelectedNodeASenseId, assocSelectedNodeBSenseId);
    }, [
        assocSelectedNodeASenseId,
        assocSelectedNodeBSenseId,
        recheckAssocInsertDirectionLock
    ]);

    const confirmEditAssociation = () => {
        const editingDraft = assocEditingIndex !== null ? (Array.isArray(editAssociations) ? editAssociations[assocEditingIndex] : null) : null;
        const shouldMarkAsNewDraft = assocEditingIndex === null ? true : !!editingDraft?.isNewDraft;
        const effectiveSourceSenseId = resolveNodeSenseId(editingAssociationNode, assocSelectedSourceSenseId || editingAssociationSenseId);
        const sourceDisplay = formatNodeSenseDisplay(editingAssociationNode, effectiveSourceSenseId);
        const resolveDraftRelationMode = (draft = {}) => {
            const insertGroupId = String(draft?.insertGroupId || '').trim();
            const insertSide = String(draft?.insertSide || '').trim();
            if (insertGroupId && (insertSide === 'left' || insertSide === 'right')) {
                return `insert:${insertSide}`;
            }
            return 'direct';
        };
        const buildSimpleDraft = ({
            targetNode,
            targetSenseId,
            backendRelationType,
            insertGroupId = '',
            insertSide = ''
        }) => {
            const safeTargetNode = targetNode || null;
            const safeTargetNodeId = String(safeTargetNode?._id || safeTargetNode?.nodeId || '').trim();
            const safeTargetSenseId = String(targetSenseId || '').trim();
            if (!safeTargetNodeId || !safeTargetSenseId) return null;
            const uiRelationType = backendRelationType === ASSOC_RELATION_TYPES.CONTAINS
                ? ASSOC_RELATION_TYPES.EXTENDS
                : ASSOC_RELATION_TYPES.CONTAINS;
            const targetDisplay = formatNodeSenseDisplay(safeTargetNode, safeTargetSenseId);
            return {
                type: uiRelationType,
                nodeA: safeTargetNode,
                nodeB: null,
                direction: null,
                sourceSenseId: effectiveSourceSenseId,
                nodeASenseId: safeTargetSenseId,
                actualAssociations: [{
                    targetNode: safeTargetNodeId,
                    relationType: backendRelationType,
                    nodeName: safeTargetNode?.name || '',
                    sourceSenseId: effectiveSourceSenseId,
                    targetSenseId: safeTargetSenseId
                }],
                displayText: formatUiRelationExpression(sourceDisplay, uiRelationType, targetDisplay),
                isNewDraft: shouldMarkAsNewDraft,
                insertGroupId: String(insertGroupId || '').trim(),
                insertSide: (insertSide === 'left' || insertSide === 'right') ? insertSide : ''
            };
        };

        let associationDataList = [];

        if (assocSelectedRelationType === ASSOC_RELATION_TYPES.INSERT) {
            if (!assocSelectedNodeA?._id || !assocSelectedNodeB?._id) {
                alert('请先选择插入的两个目标释义');
                return;
            }
            if (!effectiveSourceSenseId || !assocSelectedNodeASenseId || !assocSelectedNodeBSenseId) {
                alert('请先选择当前释义与目标释义');
                return;
            }
            const effectiveInsertDirection = assocInsertDirection === 'bToA' ? 'bToA' : 'aToB';
            const upperNode = effectiveInsertDirection === 'aToB' ? assocSelectedNodeA : assocSelectedNodeB;
            const upperSenseId = effectiveInsertDirection === 'aToB' ? assocSelectedNodeASenseId : assocSelectedNodeBSenseId;
            const lowerNode = effectiveInsertDirection === 'aToB' ? assocSelectedNodeB : assocSelectedNodeA;
            const lowerSenseId = effectiveInsertDirection === 'aToB' ? assocSelectedNodeBSenseId : assocSelectedNodeASenseId;
            const insertGroupId = createLocalId('insert');
            const upperRelation = buildSimpleDraft({
                targetNode: upperNode,
                targetSenseId: upperSenseId,
                backendRelationType: ASSOC_RELATION_TYPES.EXTENDS,
                insertGroupId,
                insertSide: 'left'
            });
            const lowerRelation = buildSimpleDraft({
                targetNode: lowerNode,
                targetSenseId: lowerSenseId,
                backendRelationType: ASSOC_RELATION_TYPES.CONTAINS,
                insertGroupId,
                insertSide: 'right'
            });
            associationDataList = [upperRelation, lowerRelation].filter(Boolean);
        } else {
            if (!assocSelectedNodeA?._id || !effectiveSourceSenseId || !assocSelectedNodeASenseId) {
                alert('请先选择当前释义与目标释义');
                return;
            }
            const backendRelationType = toBackendRelationType(assocSelectedRelationType);
            const singleAssociation = buildSimpleDraft({
                targetNode: assocSelectedNodeA,
                targetSenseId: assocSelectedNodeASenseId,
                backendRelationType
            });
            associationDataList = singleAssociation ? [singleAssociation] : [];
        }

        if (associationDataList.length < 1) {
            alert('未生成有效关联关系，请检查目标释义');
            return;
        }

        let duplicateReason = null;
        const nextActualKeySet = new Set();
        const dedupedAssociationDataList = associationDataList.filter((item) => {
            const key = (Array.isArray(item?.actualAssociations) ? item.actualAssociations : [])
                .map((actual) => [
                    String(actual?.targetNode || '').trim(),
                    String(actual?.relationType || '').trim(),
                    String(actual?.sourceSenseId || '').trim(),
                    String(actual?.targetSenseId || '').trim(),
                    resolveDraftRelationMode(item)
                ].join('|'))
                .filter(Boolean)[0] || '';
            if (!key) return false;
            if (nextActualKeySet.has(key)) return false;
            nextActualKeySet.add(key);
            return true;
        });
        if (dedupedAssociationDataList.length < 1) {
            alert('该关联关系已存在');
            return;
        }

        const isDuplicate = editAssociations.some((assoc, index) => {
            if (assocEditingIndex !== null && index === assocEditingIndex) {
                return false;
            }
            if (assoc?.pendingRemoval) {
                return false;
            }
            const existingActualList = Array.isArray(assoc?.actualAssociations) ? assoc.actualAssociations : [];
            const found = existingActualList.some((existingActual) => (
                dedupedAssociationDataList.some((nextAssoc) => (
                    (Array.isArray(nextAssoc?.actualAssociations) ? nextAssoc.actualAssociations : []).some((nextActual) => (
                        String(existingActual?.targetNode || '').trim() === String(nextActual?.targetNode || '').trim()
                        && String(existingActual?.relationType || '').trim() === String(nextActual?.relationType || '').trim()
                        && String(existingActual?.sourceSenseId || '').trim() === String(nextActual?.sourceSenseId || '').trim()
                        && String(existingActual?.targetSenseId || '').trim() === String(nextActual?.targetSenseId || '').trim()
                        && resolveDraftRelationMode(assoc) === resolveDraftRelationMode(nextAssoc)
                    ))
                ))
            ));
            if (!found) return false;
            duplicateReason = `该释义关系已存在：${assoc.displayText}`;
            return true;
        });

        if (isDuplicate) {
            alert(duplicateReason || '该关联关系已存在');
            return;
        }

        const readyAssociations = dedupedAssociationDataList.map((item) => ({
            ...item,
            pendingRemoval: false,
            pendingDecisionLines: [],
            pendingReassignPlan: null
        }));

        if (assocEditingIndex !== null) {
            setEditAssociations(prev => {
                const next = [...prev];
                next.splice(assocEditingIndex, 1, ...readyAssociations);
                return normalizeAssociationDraftList(next);
            });
        } else {
            setEditAssociations(prev => normalizeAssociationDraftList([...prev, ...readyAssociations]));
        }

        resetAssociationEditor();
    };

    const closeAssocDeleteDecisionModal = useCallback(() => {
        if (assocDeleteApplying) return;
        setShowAssocDeleteDecisionModal(false);
        setAssocDeleteDecisionContext(null);
        setAssocDeleteDecisionAction('disconnect');
        setAssocDeleteSearchKeyword('');
        setAssocDeleteSearchAppliedKeyword('');
        setAssocDeleteSearchResults([]);
        setAssocDeleteSearchLoading(false);
        setAssocDeleteSelectedTarget(null);
    }, [assocDeleteApplying]);

    const searchAssocDeleteTargets = useCallback(async (keyword = assocDeleteSearchKeyword) => {
        const deleteMode = assocDeleteDecisionContext?.mode || '';
        if (deleteMode !== 'upper') {
            setAssocDeleteSearchAppliedKeyword(String(keyword || '').trim());
            setAssocDeleteSearchResults([]);
            setAssocDeleteSearchLoading(false);
            return;
        }
        const normalizedKeyword = String(keyword || '').trim();
        const keywordMeta = parseAssociationKeyword(normalizedKeyword);
        const effectiveKeyword = keywordMeta.textKeyword;
        setAssocDeleteSearchAppliedKeyword(normalizedKeyword);
        if (!effectiveKeyword) {
            setAssocDeleteSearchResults([]);
            return;
        }
        const requestId = ++assocDeleteSearchRequestIdRef.current;
        setAssocDeleteSearchLoading(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/search?keyword=${encodeURIComponent(effectiveKeyword)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (requestId !== assocDeleteSearchRequestIdRef.current) return;
            if (!response.ok) {
                setAssocDeleteSearchResults([]);
                return;
            }
            const data = await response.json();
            const deletingAssoc = assocDeleteDecisionContext?.association || null;
            const deletingTargetNodeId = String(
                deletingAssoc?.nodeA?._id
                || deletingAssoc?.nodeA?.nodeId
                || deletingAssoc?.nodeA
                || ''
            ).trim();
            const deletingTargetKey = toAssociationSenseKey(
                deletingAssoc?.nodeA,
                deletingAssoc?.nodeASenseId || deletingAssoc?.targetSenseId || ''
            );
            const editingNodeId = String(editingAssociationNode?._id || '').trim();
            const results = (Array.isArray(data) ? data : [])
                .map((item) => normalizeAssociationCandidate(item))
                .filter(Boolean)
                .filter((item) => matchKeywordByDomainAndSense(item, effectiveKeyword))
                .filter((item) => String(item?.nodeId || '') !== editingNodeId)
                .filter((item) => String(item?.nodeId || '') !== deletingTargetNodeId)
                .filter((item) => item?.searchKey !== deletingTargetKey);
            setAssocDeleteSearchResults(results);
        } catch (error) {
            if (requestId !== assocDeleteSearchRequestIdRef.current) return;
            console.error('删除决策弹窗搜索失败:', error);
            setAssocDeleteSearchResults([]);
        } finally {
            if (requestId === assocDeleteSearchRequestIdRef.current) {
                setAssocDeleteSearchLoading(false);
            }
        }
    }, [
        editingAssociationNode,
        assocDeleteDecisionContext,
        assocDeleteSearchKeyword,
        normalizeAssociationCandidate,
        toAssociationSenseKey
    ]);

    const stageAssociationRemovalByDecision = async ({
        index,
        decisionAction = 'disconnect',
        bridgeItems = [],
        replacementTarget = null,
        effectiveAssociationType = ''
    }) => {
        const removedAssociation = Array.isArray(editAssociations) ? editAssociations[index] : null;
        if (!removedAssociation) return;
        const resolvedAssociationType = String(effectiveAssociationType || removedAssociation?.type || '').trim();

        const normalizedAction = decisionAction === 'reconnect' ? 'reconnect' : 'disconnect';
        const nextBridgeDecisions = { ...assocBridgeDecisions };
        const pendingDecisionLines = [];
        let pendingReassignPlan = null;
        const effectiveSourceSenseId = removedAssociation?.sourceSenseId
            || resolveNodeSenseId(editingAssociationNode, editingAssociationSenseId);
        const sourceDisplay = formatNodeSenseDisplay(editingAssociationNode, effectiveSourceSenseId);
        const targetDisplay = formatNodeSenseDisplay(
            removedAssociation?.nodeA,
            removedAssociation?.nodeASenseId || removedAssociation?.targetSenseId || ''
        );
        const isUpperRelationDeletion = resolvedAssociationType === ASSOC_RELATION_TYPES.EXTENDS;

        (Array.isArray(bridgeItems) ? bridgeItems : []).forEach((item) => {
            const pairKey = item?.pairKey || '';
            if (!pairKey) return;
            nextBridgeDecisions[pairKey] = normalizedAction;
            const sourceDisplay = resolveDecisionCurrentDisplay(
                editingAssociationNode,
                item?.sourceSenseId || '',
                editingAssociationNode?.name || '当前标题'
            );
            const upperDisplay = resolveDecisionPairSideDisplay(item, 'upper');
            const lowerDisplay = resolveDecisionPairSideDisplay(item, 'lower');
            if (normalizedAction === 'reconnect') {
                pendingDecisionLines.push(`恢复：${upperDisplay} → ${sourceDisplay} → ${lowerDisplay}`);
            }
        });

        if (pendingDecisionLines.length < 1) {
            pendingDecisionLines.push(
                normalizedAction === 'reconnect'
                    ? `恢复：${sourceDisplay} 与 ${targetDisplay} 的原有链路`
                    : `拆分：${sourceDisplay} 与 ${targetDisplay} 将解除关系`
            );
        }

        let nextAssociations = editAssociations.map((assoc, i) => (
            i === index
                ? { ...assoc, pendingRemoval: true, pendingDecisionLines: [], pendingReassignPlan: null }
                : assoc
        ));

        if (isUpperRelationDeletion && decisionAction === 'reassign_upper' && replacementTarget?.nodeId && replacementTarget?.senseId) {
            const replacementNodeId = String(replacementTarget.nodeId || replacementTarget._id || '').trim();
            const replacementSenseId = resolveAssociationSenseId(replacementTarget, replacementTarget.senseId || '');
            const replacementNodeName = replacementTarget?.name || replacementTarget?.domainName || replacementTarget?.displayName || '';
            if (replacementNodeId && replacementSenseId && replacementNodeName) {
                const lowerNodeId = String(
                    removedAssociation?.nodeA?._id
                    || removedAssociation?.nodeA?.nodeId
                    || removedAssociation?.nodeA
                    || ''
                ).trim();
                const lowerSenseId = String(
                    removedAssociation?.nodeASenseId
                    || removedAssociation?.targetSenseId
                    || ''
                ).trim();
                if (lowerNodeId && lowerSenseId) {
                    pendingReassignPlan = {
                        lowerNodeId,
                        lowerSenseId,
                        newUpperNodeId: replacementNodeId,
                        newUpperSenseId: replacementSenseId
                    };
                    pendingDecisionLines.push(`改接：${targetDisplay} 将改为 ${formatNodeSenseDisplay(replacementTarget, replacementSenseId)} 的下级`);
                }
            }
        }

        if (resolvedAssociationType === ASSOC_RELATION_TYPES.CONTAINS) {
            pendingDecisionLines.push(`${sourceDisplay} 作为下级，可直接删除该关联`);
        }
        if (isUpperRelationDeletion && decisionAction === 'reassign_upper' && !pendingReassignPlan) {
            pendingDecisionLines.push('未选择可用上级，暂不改接');
        }
        if (isUpperRelationDeletion && decisionAction !== 'reassign_upper' && pendingDecisionLines.length < 2) {
            pendingDecisionLines.push(`${targetDisplay} 与 ${sourceDisplay} 解绑后将保持独立`);
        }

        const stagedWithDecisionLines = nextAssociations.map((assoc, i) => (
            i === index
                ? { ...assoc, pendingRemoval: true, pendingDecisionLines, pendingReassignPlan }
                : assoc
        ));
        setAssocBridgeDecisions(nextBridgeDecisions);
        setEditAssociations(stagedWithDecisionLines);
    };

    const confirmAssocDeleteDecision = async () => {
        const context = assocDeleteDecisionContext || null;
        if (!context) return;
        const decisionMode = context?.mode || 'upper';
        if (decisionMode === 'upper' && assocDeleteDecisionAction === 'reassign_upper' && !assocDeleteSelectedTarget) {
            alert('请先选择新的上级释义');
            return;
        }
        setAssocDeleteApplying(true);
        try {
            await stageAssociationRemovalByDecision({
                index: context.index,
                decisionAction: assocDeleteDecisionAction,
                bridgeItems: context.bridgeItems || [],
                replacementTarget: (
                    decisionMode === 'upper' && assocDeleteDecisionAction === 'reassign_upper'
                        ? (assocDeleteSelectedTarget || null)
                        : null
                ),
                effectiveAssociationType: context.effectiveAssociationType || ''
            });
            setShowAssocDeleteDecisionModal(false);
            setAssocDeleteDecisionContext(null);
            setAssocDeleteDecisionAction('disconnect');
            setAssocDeleteSearchKeyword('');
            setAssocDeleteSearchAppliedKeyword('');
            setAssocDeleteSearchResults([]);
            setAssocDeleteSearchLoading(false);
            setAssocDeleteSelectedTarget(null);
        } finally {
            setAssocDeleteApplying(false);
        }
    };

    const removeEditAssociation = async (index) => {
        const removedAssociation = Array.isArray(editAssociations) ? editAssociations[index] : null;
        if (!removedAssociation) return;
        const effectiveAssociationType = resolveAssociationDisplayType(removedAssociation);
        if (removedAssociation?.pendingRemoval) {
            const revertedAssociations = editAssociations.map((assoc, i) => (
                i === index
                    ? { ...assoc, pendingRemoval: false, pendingDecisionLines: [], pendingReassignPlan: null }
                    : assoc
            ));
            setEditAssociations(revertedAssociations);
            return;
        }
        if (removedAssociation?.isNewDraft) {
            const retainedMembers = Array.isArray(removedAssociation?.mergedDraftMembers)
                ? removedAssociation.mergedDraftMembers
                    .filter((member) => !member?.isNewDraft)
                    .map((member) => ({
                        ...member,
                        pendingRemoval: false,
                        pendingDecisionLines: [],
                        pendingReassignPlan: null
                    }))
                : [];
            const remainingAssociations = editAssociations.filter((_, i) => i !== index);
            const nextDrafts = retainedMembers.length > 0
                ? [...remainingAssociations, ...retainedMembers]
                : remainingAssociations;
            setEditAssociations(normalizeAssociationDraftList(nextDrafts));
            return;
        }

        // 当前释义作为下级：直接暂存删除，不弹决策窗
        if (effectiveAssociationType === ASSOC_RELATION_TYPES.CONTAINS) {
            const stagedProbe = editAssociations.map((assoc, i) => (
                i === index
                    ? { ...assoc, pendingRemoval: true, pendingDecisionLines: [] }
                    : assoc
            ));
            const previewData = await previewAssociationEdit(assocBridgeDecisions, stagedProbe, { silent: true });
            const bridgeItems = Array.isArray(previewData?.bridgeDecisionItems) ? previewData.bridgeDecisionItems : [];
            await stageAssociationRemovalByDecision({
                index,
                decisionAction: 'disconnect',
                bridgeItems,
                replacementTarget: null,
                effectiveAssociationType
            });
            return;
        }

        const defaultAction = 'disconnect';

        setAssocDeleteDecisionContext({
            index,
            association: removedAssociation,
            // 删除“当前释义包含下级释义”仅影响当前与下级这一对双向关系。
            // 不在二级决策弹窗中展示与其他上级/下级的衍生承接 pair。
            bridgeItems: [],
            effectiveAssociationType,
            mode: 'upper'
        });
        setAssocDeleteDecisionAction(defaultAction);
        setAssocDeleteSearchKeyword('');
        setAssocDeleteSearchAppliedKeyword('');
        setAssocDeleteSearchResults([]);
        setAssocDeleteSearchLoading(false);
        setAssocDeleteSelectedTarget(null);
        setShowAssocDeleteDecisionModal(true);
    };

    const editExistingAssociation = async (index) => {
        const requestId = ++assocEditRequestIdRef.current;
        const assoc = editAssociations[index];
        let nextNodeA = assoc.nodeA;
        let nextNodeB = assoc.nodeB;

        if (assocPreviewRendererRef.current) {
            assocPreviewRendererRef.current.destroy();
            assocPreviewRendererRef.current = null;
        }

        if (nextNodeA?._id && (!nextNodeA.parentNodesInfo || !nextNodeA.childNodesInfo)) {
            const nodeDetail = await fetchNodeDetailForAssociation(nextNodeA._id);
            if (requestId !== assocEditRequestIdRef.current) return;
            if (nodeDetail) {
                nextNodeA = nodeDetail;
            }
        }
        if (nextNodeB?._id && (!nextNodeB.parentNodesInfo || !nextNodeB.childNodesInfo)) {
            const nodeDetail = await fetchNodeDetailForAssociation(nextNodeB._id);
            if (requestId !== assocEditRequestIdRef.current) return;
            if (nodeDetail) {
                nextNodeB = nodeDetail;
            }
        }
        if (requestId !== assocEditRequestIdRef.current) return;

        setAssocEditingIndex(index);
        setAssocSelectedNodeA(nextNodeA);
        setAssocSelectedNodeASenseId(assoc.nodeASenseId || resolveNodeSenseId(nextNodeA));
        setAssocSelectedRelationType(assoc.type);
        setAssocSelectedNodeB(nextNodeB);
        setAssocSelectedNodeBSenseId(assoc.nodeBSenseId || resolveNodeSenseId(nextNodeB));
        setAssocSelectedSourceSenseId(assoc.sourceSenseId || resolveNodeSenseId(editingAssociationNode, editingAssociationSenseId));
        setAssocInsertDirection(assoc.direction);
        setAssocCurrentStep(ASSOC_STEPS.PREVIEW);
    };

    const goBackAssocStep = () => {
        if (assocPreviewRendererRef.current) {
            assocPreviewRendererRef.current.stopAnimation();
        }

        const previousStep = resolveAssociationBackStep(assocCurrentStep, assocSelectedRelationType);
        if (!previousStep) {
            resetAssociationEditor();
            return;
        }

        setAssocCurrentStep(previousStep);
    };

    const assocNodeASenseOptions = useMemo(() => {
        if (!assocSelectedNodeA) return [];
        const excludedSenseKeySet = new Set();
        if (
            assocCurrentStep === ASSOC_STEPS.PREVIEW
            && assocSelectedRelationType === ASSOC_RELATION_TYPES.INSERT
        ) {
            const selectedNodeBSenseKey = toAssociationSenseKey(assocSelectedNodeB, assocSelectedNodeBSenseId);
            if (selectedNodeBSenseKey) excludedSenseKeySet.add(selectedNodeBSenseKey);
        }
        return normalizeNodeSenses(assocSelectedNodeA)
            .filter((sense) => isAssociationCandidateSelectable(
                assocSelectedNodeA,
                sense.senseId,
                { excludedSenseKeySet }
            ))
            .map((sense) => ({ senseId: sense.senseId, title: sense.title }));
    }, [
        assocSelectedNodeA,
        assocCurrentStep,
        assocSelectedRelationType,
        assocSelectedNodeB,
        assocSelectedNodeBSenseId,
        toAssociationSenseKey,
        normalizeNodeSenses,
        isAssociationCandidateSelectable
    ]);

    const assocNodeBView = useMemo(() => {
        const keywordMeta = parseAssociationKeyword(assocNodeBSearchAppliedKeyword);
        const keywordMode = keywordMeta.mode;
        const hasSubmittedSearch = keywordMode === 'include' || keywordMode === 'expand';
        const selectedNodeAKey = toAssociationSenseKey(assocSelectedNodeA, assocSelectedNodeASenseId);
        const excludedSenseKeySet = new Set([selectedNodeAKey].filter(Boolean));
        const normalizeCandidateList = (list = []) => {
            const seen = new Set();
            return (Array.isArray(list) ? list : [])
                .map((item) => normalizeAssociationCandidate(item))
                .filter(Boolean)
                .filter((item) => {
                    if (seen.has(item.searchKey)) return false;
                    seen.add(item.searchKey);
                    return true;
                });
        };
        const isNodeBCandidateSelectable = (nodeLike = {}) => isAssociationCandidateSelectable(
            nodeLike,
            nodeLike?.senseId || nodeLike?.activeSenseId || '',
            { excludedSenseKeySet }
        );
        const normalizedParents = normalizeCandidateList(assocNodeBCandidates.parents);
        const normalizedChildren = normalizeCandidateList(assocNodeBCandidates.children);

        const filteredNodeBCandidates = hasSubmittedSearch
            ? {
                parents: normalizedParents.filter((item) => isNodeBCandidateSelectable(item)),
                children: normalizedChildren.filter((item) => isNodeBCandidateSelectable(item))
            }
            : { parents: [], children: [] };
        const visibleParentsRaw = hasSubmittedSearch && keywordMode !== 'expand' ? filteredNodeBCandidates.parents : [];
        const visibleChildrenRaw = hasSubmittedSearch && keywordMode !== 'include' ? filteredNodeBCandidates.children : [];

        const nodeADisplay = formatNodeSenseDisplay(assocSelectedNodeA, assocSelectedNodeASenseId);
        const visibleParents = visibleParentsRaw.map((node) => ({
            ...node,
            hint: `插入到 ${node.displayName || node.name} 和 ${nodeADisplay} 之间`
        }));
        const visibleChildren = visibleChildrenRaw.map((node) => ({
            ...node,
            hint: `插入到 ${nodeADisplay} 和 ${node.displayName || node.name} 之间`
        }));

        return {
            hasSubmittedSearch,
            keywordMode,
            parents: visibleParents,
            children: visibleChildren,
            extra: []
        };
    }, [
        assocNodeBSearchAppliedKeyword,
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        assocNodeBCandidates.parents,
        assocNodeBCandidates.children,
        toAssociationSenseKey,
        normalizeAssociationCandidate,
        isAssociationCandidateSelectable,
        formatNodeSenseDisplay
    ]);

    const assocInsertRelationAvailable = useMemo(() => (
        (Array.isArray(assocNodeBCandidates.parents) && assocNodeBCandidates.parents.length > 0)
        || (Array.isArray(assocNodeBCandidates.children) && assocNodeBCandidates.children.length > 0)
    ), [assocNodeBCandidates.parents, assocNodeBCandidates.children]);

    const assocInsertRelationUnavailableReason = useMemo(() => {
        if (!assocSelectedNodeA?._id || !assocSelectedNodeASenseId) return '';
        if (assocInsertRelationAvailable) return '';
        return '当前目标释义在释义层没有可用的 #include / #expand 链路，无法创建插入关系。';
    }, [assocInsertRelationAvailable, assocSelectedNodeA, assocSelectedNodeASenseId]);

    const assocPreviewInfoText = useMemo(() => {
        if (assocSelectedRelationType === ASSOC_RELATION_TYPES.EXTENDS) {
            return formatUiRelationExpression(
                formatNodeSenseDisplay(editingAssociationNode, assocSelectedSourceSenseId),
                ASSOC_RELATION_TYPES.EXTENDS,
                formatNodeSenseDisplay(assocSelectedNodeA, assocSelectedNodeASenseId)
            );
        }
        if (assocSelectedRelationType === ASSOC_RELATION_TYPES.CONTAINS) {
            return formatUiRelationExpression(
                formatNodeSenseDisplay(editingAssociationNode, assocSelectedSourceSenseId),
                ASSOC_RELATION_TYPES.CONTAINS,
                formatNodeSenseDisplay(assocSelectedNodeA, assocSelectedNodeASenseId)
            );
        }
        if (assocSelectedRelationType === ASSOC_RELATION_TYPES.INSERT) {
            return buildInsertNarrative(
                editingAssociationNode,
                assocSelectedSourceSenseId,
                assocSelectedNodeA,
                assocSelectedNodeASenseId,
                assocSelectedNodeB,
                assocSelectedNodeBSenseId,
                assocInsertDirection
            );
        }
        return '';
    }, [
        assocSelectedRelationType,
        editingAssociationNode,
        assocSelectedSourceSenseId,
        assocSelectedNodeA,
        assocSelectedNodeASenseId,
        assocSelectedNodeB,
        assocSelectedNodeBSenseId,
        assocInsertDirection,
        formatUiRelationExpression,
        formatNodeSenseDisplay,
        buildInsertNarrative
    ]);

    const buildAssociationPayloadForMutation = useCallback((associationDraftList = editAssociations) => {
        const effectiveEditingSenseId = resolveNodeSenseId(editingAssociationNode, editingAssociationSenseId);
        const untouchedAssociations = (Array.isArray(editingAssociationNode?.associations) ? editingAssociationNode.associations : [])
            .filter((assoc) => {
                const rawSourceSenseId = typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '';
                const normalizedSourceSenseId = rawSourceSenseId || effectiveEditingSenseId;
                if (!effectiveEditingSenseId) return false;
                return normalizedSourceSenseId !== effectiveEditingSenseId;
            })
            .map((assoc) => ({
                targetNode: assoc?.targetNode?._id || assoc?.targetNode || '',
                relationType: assoc?.relationType || '',
                sourceSenseId: (typeof assoc?.sourceSenseId === 'string' ? assoc.sourceSenseId.trim() : '') || effectiveEditingSenseId,
                targetSenseId: (() => {
                    const rawTargetSenseId = typeof assoc?.targetSenseId === 'string' ? assoc.targetSenseId.trim() : '';
                    if (rawTargetSenseId) return rawTargetSenseId;
                    const targetNodeRaw = assoc?.targetNode;
                    const targetNode = (targetNodeRaw && typeof targetNodeRaw === 'object')
                        ? targetNodeRaw
                        : nodeByIdMap.get(String(targetNodeRaw || ''));
                    return resolveNodeSenseId(targetNode);
                })(),
                insertSide: '',
                insertGroupId: ''
            }))
            .filter((assoc) => (
                !!assoc.targetNode
                && !!assoc.relationType
                && !!assoc.sourceSenseId
                && !!assoc.targetSenseId
                && (
                    assoc.relationType === ASSOC_RELATION_TYPES.CONTAINS
                    || assoc.relationType === ASSOC_RELATION_TYPES.EXTENDS
                )
            ));

        const safeDraftList = Array.isArray(associationDraftList) ? associationDraftList : [];
        const activeDraftList = safeDraftList.filter((assoc) => !assoc?.pendingRemoval);
        const toNormalizedDirectAssociation = (actual = {}, fallbackSourceSenseId = '') => {
            const targetNodeId = String(actual?.targetNode?._id || actual?.targetNode || '').trim();
            const relationType = actual?.relationType;
            const sourceSenseId = String(actual?.sourceSenseId || fallbackSourceSenseId || '').trim();
            const targetSenseId = String(actual?.targetSenseId || '').trim();
            const isAllowedRelationType = (
                relationType === ASSOC_RELATION_TYPES.CONTAINS
                || relationType === ASSOC_RELATION_TYPES.EXTENDS
            );
            if (!targetNodeId || !sourceSenseId || !targetSenseId || !isAllowedRelationType) return null;
            return {
                targetNode: targetNodeId,
                relationType,
                sourceSenseId,
                targetSenseId,
                insertSide: '',
                insertGroupId: ''
            };
        };

        const extractSingleDirectAssociationFromDraft = (assoc = {}) => {
            const fallbackSourceSenseId = String(assoc?.sourceSenseId || effectiveEditingSenseId || '').trim();
            const sourceActualList = Array.isArray(assoc?.actualAssociations) ? assoc.actualAssociations : [];
            for (const actual of sourceActualList) {
                const normalized = toNormalizedDirectAssociation(actual, fallbackSourceSenseId);
                if (normalized) return normalized;
            }
            return null;
        };

        const insertGroupMap = new Map();
        activeDraftList.forEach((assoc, index) => {
            const insertGroupId = String(assoc?.insertGroupId || '').trim();
            const insertSide = String(assoc?.insertSide || '').trim();
            if (!insertGroupId || (insertSide !== 'left' && insertSide !== 'right')) return;
            const sourceSenseId = String(assoc?.sourceSenseId || effectiveEditingSenseId || '').trim();
            if (!sourceSenseId) return;
            const normalizedDirect = extractSingleDirectAssociationFromDraft(assoc);
            if (!normalizedDirect) return;

            const groupKey = `${sourceSenseId}|${insertGroupId}`;
            const group = insertGroupMap.get(groupKey) || {
                sourceSenseId,
                insertGroupId,
                left: null,
                leftIndex: -1,
                right: null,
                rightIndex: -1
            };
            if (insertSide === 'left' && !group.left) {
                group.left = normalizedDirect;
                group.leftIndex = index;
            }
            if (insertSide === 'right' && !group.right) {
                group.right = normalizedDirect;
                group.rightIndex = index;
            }
            insertGroupMap.set(groupKey, group);
        });

        const consumedInsertDraftIndexSet = new Set();
        const editedAssociations = [];

        insertGroupMap.forEach((group) => {
            if (!group?.left || !group?.right) return;
            consumedInsertDraftIndexSet.add(group.leftIndex);
            consumedInsertDraftIndexSet.add(group.rightIndex);
            editedAssociations.push({
                targetNode: group.left.targetNode,
                relationType: ASSOC_RELATION_TYPES.INSERT,
                sourceSenseId: group.sourceSenseId,
                targetSenseId: group.left.targetSenseId,
                insertSide: 'left',
                insertGroupId: group.insertGroupId
            });
            editedAssociations.push({
                targetNode: group.right.targetNode,
                relationType: ASSOC_RELATION_TYPES.INSERT,
                sourceSenseId: group.sourceSenseId,
                targetSenseId: group.right.targetSenseId,
                insertSide: 'right',
                insertGroupId: group.insertGroupId
            });
        });

        activeDraftList.forEach((assoc, index) => {
            if (consumedInsertDraftIndexSet.has(index)) return;

            const fallbackSourceSenseId = String(assoc?.sourceSenseId || effectiveEditingSenseId || '').trim();
            const fallbackActualAssociations = (assoc.type === ASSOC_RELATION_TYPES.INSERT)
                ? (() => {
                    const direction = assoc.direction === 'bToA' ? 'bToA' : 'aToB';
                    const upperNode = direction === 'aToB' ? assoc.nodeA : assoc.nodeB;
                    const lowerNode = direction === 'aToB' ? assoc.nodeB : assoc.nodeA;
                    const upperNodeId = String(upperNode?._id || '').trim();
                    const lowerNodeId = String(lowerNode?._id || '').trim();
                    const sourceSenseId = String(assoc.sourceSenseId || effectiveEditingSenseId || '').trim();
                    const upperSenseId = direction === 'aToB'
                        ? (assoc.nodeASenseId || resolveNodeSenseId(upperNode))
                        : (assoc.nodeBSenseId || resolveNodeSenseId(upperNode));
                    const lowerSenseId = direction === 'aToB'
                        ? (assoc.nodeBSenseId || resolveNodeSenseId(lowerNode))
                        : (assoc.nodeASenseId || resolveNodeSenseId(lowerNode));
                    if (!upperNodeId || !lowerNodeId || !sourceSenseId || !upperSenseId || !lowerSenseId) return [];
                    return [
                        {
                            targetNode: upperNodeId,
                            relationType: ASSOC_RELATION_TYPES.EXTENDS,
                            sourceSenseId,
                            targetSenseId: upperSenseId
                        },
                        {
                            targetNode: lowerNodeId,
                            relationType: ASSOC_RELATION_TYPES.CONTAINS,
                            sourceSenseId,
                            targetSenseId: lowerSenseId
                        }
                    ];
                })()
                : [];
            const sourceActualAssociations = Array.isArray(assoc?.actualAssociations) && assoc.actualAssociations.length > 0
                ? assoc.actualAssociations
                : fallbackActualAssociations;
            sourceActualAssociations.forEach((actual) => {
                const normalized = toNormalizedDirectAssociation(actual, fallbackSourceSenseId);
                if (normalized) editedAssociations.push(normalized);
            });
        });

        return [...untouchedAssociations, ...editedAssociations];
    }, [editAssociations, editingAssociationNode, editingAssociationSenseId, nodeByIdMap, resolveNodeSenseId]);

    const previewAssociationEdit = useCallback(async (
        decisionMap = assocBridgeDecisions,
        associationDraftList = editAssociations,
        options = {}
    ) => {
        if (!editingAssociationNode?._id) return null;
        const { silent = false } = options || {};
        const token = localStorage.getItem('token');
        const associationsPayload = buildAssociationPayloadForMutation(associationDraftList);
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${editingAssociationNode._id}/associations/preview`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    associations: associationsPayload,
                    onRemovalStrategy: 'disconnect',
                    bridgeDecisions: toBridgeDecisionPayload(decisionMap)
                })
            });
            const data = await response.json();
            if (response.ok) {
                return data;
            } else {
                if (!silent) {
                    alert(data.error || '预览失败');
                }
                return null;
            }
        } catch (error) {
            console.error('预览关联变更失败:', error);
            if (!silent) {
                alert('预览失败');
            }
            return null;
        }
    }, [
        assocBridgeDecisions,
        editAssociations,
        editingAssociationNode,
        buildAssociationPayloadForMutation,
        toBridgeDecisionPayload
    ]);

    const applyUpperReassignPlan = async (plan, token) => {
        const lowerNodeId = String(plan?.lowerNodeId || '').trim();
        const lowerSenseId = String(plan?.lowerSenseId || '').trim();
        const newUpperNodeId = String(plan?.newUpperNodeId || '').trim();
        const newUpperSenseId = String(plan?.newUpperSenseId || '').trim();
        if (!lowerNodeId || !lowerSenseId || !newUpperNodeId || !newUpperSenseId) {
            return;
        }
        const lowerNodeDetail = await fetchNodeDetailForAssociation(lowerNodeId);
        if (!lowerNodeDetail?._id) {
            throw new Error('获取下级释义节点详情失败');
        }
        const normalizedAssociations = (Array.isArray(lowerNodeDetail?.associations) ? lowerNodeDetail.associations : [])
            .map((assoc) => ({
                targetNode: assoc?.targetNode?._id || assoc?.targetNode || '',
                relationType: assoc?.relationType || '',
                sourceSenseId: String(assoc?.sourceSenseId || '').trim(),
                targetSenseId: String(assoc?.targetSenseId || '').trim(),
                insertSide: String(assoc?.insertSide || '').trim(),
                insertGroupId: String(assoc?.insertGroupId || '').trim()
            }))
            .filter((assoc) => (
                !!assoc.targetNode
                && !!assoc.relationType
                && !!assoc.sourceSenseId
                && !!assoc.targetSenseId
            ));
        const hasReassignAssociation = normalizedAssociations.some((assoc) => (
            String(assoc.targetNode || '') === newUpperNodeId
            && assoc.relationType === ASSOC_RELATION_TYPES.EXTENDS
            && String(assoc.sourceSenseId || '') === lowerSenseId
            && String(assoc.targetSenseId || '') === newUpperSenseId
        ));
        if (hasReassignAssociation) {
            return;
        }
        const nextAssociations = [
            ...normalizedAssociations,
            {
                targetNode: newUpperNodeId,
                relationType: ASSOC_RELATION_TYPES.EXTENDS,
                sourceSenseId: lowerSenseId,
                targetSenseId: newUpperSenseId
            }
        ];
        const response = await fetch(`http://localhost:5000/api/nodes/${lowerNodeId}/associations`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                associations: nextAssociations,
                onRemovalStrategy: 'disconnect',
                bridgeDecisions: []
            })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data?.error || '改接上级失败');
        }
    };

    const saveAssociationEdit = async () => {
        if (!editingAssociationNode?._id) return;
        let previewSnapshot = await previewAssociationEdit(assocBridgeDecisions, editAssociations, { silent: true });
        if (!previewSnapshot) {
            alert('无法计算关联变更，请稍后重试');
            return;
        }
        const bridgeDecisionItems = Array.isArray(previewSnapshot?.bridgeDecisionItems)
            ? previewSnapshot.bridgeDecisionItems
            : [];
        const autoFilledBridgeDecisions = { ...assocBridgeDecisions };
        let hasAutoFilledDecision = false;
        bridgeDecisionItems.forEach((item) => {
            const pairKey = String(item?.pairKey || '').trim();
            if (!pairKey) return;
            if (!autoFilledBridgeDecisions[pairKey]) {
                autoFilledBridgeDecisions[pairKey] = 'disconnect';
                hasAutoFilledDecision = true;
            }
        });
        if (hasAutoFilledDecision) {
            setAssocBridgeDecisions(autoFilledBridgeDecisions);
            previewSnapshot = await previewAssociationEdit(autoFilledBridgeDecisions, editAssociations, { silent: true });
            if (!previewSnapshot) {
                alert('无法计算关联变更，请稍后重试');
                return;
            }
        }
        if ((previewSnapshot?.unresolvedBridgeDecisionCount || 0) > 0) {
            alert('关联改动中存在未确认的承接关系，已自动按“断开”处理后仍无法保存，请重试。');
            return;
        }

        const token = localStorage.getItem('token');
        const associationsPayload = buildAssociationPayloadForMutation();
        const pendingReassignPlanMap = new Map();
        (Array.isArray(editAssociations) ? editAssociations : [])
            .filter((assoc) => !!assoc?.pendingRemoval && !!assoc?.pendingReassignPlan)
            .map((assoc) => assoc.pendingReassignPlan)
            .filter(Boolean)
            .forEach((plan) => {
                const key = [
                    String(plan?.lowerNodeId || '').trim(),
                    String(plan?.lowerSenseId || '').trim(),
                    String(plan?.newUpperNodeId || '').trim(),
                    String(plan?.newUpperSenseId || '').trim()
                ].join('|');
                if (!key || pendingReassignPlanMap.has(key)) return;
                pendingReassignPlanMap.set(key, plan);
            });
        const pendingReassignPlans = Array.from(pendingReassignPlanMap.values());
        setAssocApplyLoading(true);
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${editingAssociationNode._id}/associations`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    associations: associationsPayload,
                    onRemovalStrategy: 'disconnect',
                    bridgeDecisions: toBridgeDecisionPayload(autoFilledBridgeDecisions)
                })
            });
            const data = await response.json();
            if (response.ok) {
                const reassignErrors = [];
                for (const plan of pendingReassignPlans) {
                    try {
                        // 删除主关联后，再按用户决策将下级改接到新的上级。
                        // 这一步是独立写入，避免把“改接上级”混入当前释义的关联草稿。
                        await applyUpperReassignPlan(plan, token);
                    } catch (error) {
                        reassignErrors.push(error?.message || '未知错误');
                    }
                }
                if (reassignErrors.length > 0) {
                    alert(`${data.message}\n但以下改接未完成：\n${reassignErrors.join('\n')}`);
                } else {
                    alert(data.message);
                }
                closeEditAssociationModal();
                fetchAllNodes(adminDomainPage, adminDomainSearchKeyword);
            } else {
                alert(data.error || '保存失败');
            }
        } catch (error) {
            console.error('保存关联失败:', error);
            alert('保存失败');
        } finally {
            setAssocApplyLoading(false);
        }
    };

    const formatRelationArrowText = (relationType) => (
        relationType === ASSOC_RELATION_TYPES.CONTAINS
            ? REL_SYMBOL_SUPERSET
            : (relationType === ASSOC_RELATION_TYPES.EXTENDS ? REL_SYMBOL_SUBSET : '↔')
    );

    // --- Alliance Management Functions ---
    const fetchAdminAlliances = async (page = adminAlliancePage) => {
        const token = localStorage.getItem('token');
        setIsAdminAllianceLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(Math.max(1, page)),
                pageSize: String(ADMIN_ALLIANCE_PAGE_SIZE)
            });
            const response = await fetch(`http://localhost:5000/api/alliances/admin/all?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
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
    };

    const normalizeAllianceMember = (member = {}) => ({
        _id: member?._id || '',
        username: member?.username || '',
        profession: member?.profession || '',
        level: Number.isFinite(Number(member?.level)) ? Number(member.level) : 0,
        allianceId: member?.allianceId || '',
        allianceName: member?.allianceName || '',
        isFounder: !!member?.isFounder
    });

    const loadAllianceMembersForEdit = async (allianceId, { syncDraft = false } = {}) => {
        if (!allianceId) return [];
        const requestId = ++allianceMemberRequestIdRef.current;
        const token = localStorage.getItem('token');
        setIsAllianceMemberLoading(true);
        try {
            const response = await fetch(`http://localhost:5000/api/alliances/admin/${allianceId}/members`, {
                headers: { 'Authorization': `Bearer ${token}` }
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
    };

    const searchAllianceMemberCandidates = async (keyword = allianceMemberSearchKeyword) => {
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
            const response = await fetch(`http://localhost:5000/api/alliances/admin/member-candidates?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
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
    };

    const openAllianceMemberModal = () => {
        if (!editingAlliance?._id) return;
        setAllianceMemberSearchKeyword('');
        setAllianceMemberSearchResults([]);
        setHasAllianceMemberSearchTriggered(false);
        setAllianceMemberDraft(editAllianceMembers.map((item) => ({ ...item })));
        setShowAllianceMemberModal(true);
        if (editAllianceMembers.length === 0 && !isAllianceMemberLoading) {
            loadAllianceMembersForEdit(editingAlliance._id, { syncDraft: true });
        }
    };

    const closeAllianceMemberModal = () => {
        allianceMemberSearchRequestIdRef.current += 1;
        setShowAllianceMemberModal(false);
        setAllianceMemberSearchKeyword('');
        setAllianceMemberSearchResults([]);
        setHasAllianceMemberSearchTriggered(false);
        setAllianceMemberDraft([]);
        setIsAllianceMemberSearchLoading(false);
    };

    const addAllianceMemberDraftUser = (candidate) => {
        const normalizedCandidate = normalizeAllianceMember(candidate);
        if (!normalizedCandidate._id) return;
        setAllianceMemberDraft((prev) => {
            if (prev.some((item) => item._id === normalizedCandidate._id)) {
                return prev;
            }
            return [...prev, normalizedCandidate];
        });
    };

    const removeAllianceMemberDraftUser = (memberId) => {
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
    };

    const confirmAllianceMemberDraft = () => {
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
    };

    const startEditAlliance = (alliance) => {
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
    };

    const cancelEditAlliance = () => {
        allianceMemberRequestIdRef.current += 1;
        allianceMemberSearchRequestIdRef.current += 1;
        setEditingAlliance(null);
        setEditAllianceForm({
            name: '',
            flag: '',
            declaration: '',
            knowledgeReserve: '0',
            memberIds: []
        });
        setEditAllianceMembers([]);
        setAllianceMemberDraft([]);
        setShowAllianceMemberModal(false);
        setAllianceMemberSearchKeyword('');
        setAllianceMemberSearchResults([]);
        setHasAllianceMemberSearchTriggered(false);
        setIsAllianceMemberSearchLoading(false);
        setIsAllianceMemberLoading(false);
    };

    const saveAllianceEdit = async () => {
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
            const response = await fetch(`http://localhost:5000/api/alliances/admin/${editingAlliance._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
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
    };

    const deleteAlliance = async (allianceId, allianceName) => {
        if (!window.confirm(`确定要删除熵盟 "${allianceName}" 吗？此操作将清除所有成员的熵盟关联！`)) return;
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/alliances/admin/${allianceId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
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
    };

    // --- Master Change Functions ---
    const searchUsersForMaster = async (keyword) => {
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
            const response = await fetch(`http://localhost:5000/api/nodes/admin/search-users?keyword=${encodeURIComponent(normalizedKeyword)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
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
    };

    const openChangeMasterModal = (node) => {
        setChangingMasterNode(node);
        setSelectedNewMaster(node.domainMaster || null);
        setMasterSearchKeyword('');
        setMasterSearchResults([]);
        setHasMasterSearchTriggered(false);
        setShowChangeMasterModal(true);
    };

    const confirmChangeMaster = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/admin/domain-master/${changingMasterNode._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
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
    };

    const shouldShowAssocDeleteSearch = assocDeleteDecisionAction === 'reassign_upper';
    const assocDeleteReplacementDisplay = assocDeleteSelectedTarget
        ? formatNodeSenseDisplay(assocDeleteSelectedTarget, assocDeleteSelectedTarget?.senseId || '')
        : '新上级释义';

    return (
        <div className="admin-section">
            <h2 className="section-title-large">
                <Users className="icon" />
                管理员面板
            </h2>

            {/* 选项卡导航 */}
            <div className="admin-tabs">
                <button
                    onClick={() => {
                        setAdminTab('users');
                        setAdminUserPage(1);
                        fetchAllUsers(1, adminUserSearchKeyword);
                    }}
                    className={`admin-tab ${adminTab === 'users' ? 'active' : ''}`}
                >
                    <Users className="icon-small" />
                    用户管理
                </button>
                <button
                    onClick={() => {
                        setAdminTab('nodes');
                        setAdminDomainPage(1);
                        fetchAllNodes(1, adminDomainSearchKeyword, adminDomainPageSize, { forceLatest: true });
                    }}
                    className={`admin-tab ${adminTab === 'nodes' ? 'active' : ''}`}
                >
                    <Zap className="icon-small" />
                    知识域管理
                </button>
                <button
                    onClick={() => {
                        setAdminTab('pending');
                        refreshPendingApprovals();
                    }}
                    className={`admin-tab ${adminTab === 'pending' ? 'active' : ''}`}
                >
                    <Bell className="icon-small" />
                    待审批
                    {pendingApprovalCount > 0 && (
                        <span className="notification-badge">{pendingApprovalCount}</span>
                    )}
                </button>
                <button
                    onClick={() => {
                        setAdminTab('alliances');
                        setAdminAlliancePage(1);
                        fetchAdminAlliances(1);
                    }}
                    className={`admin-tab ${adminTab === 'alliances' ? 'active' : ''}`}
                >
                    <Shield className="icon-small" />
                    熵盟管理
                </button>
                <button
                    onClick={() => {
                        setAdminTab('settings');
                        fetchAdminSettings();
                    }}
                    className={`admin-tab ${adminTab === 'settings' ? 'active' : ''}`}
                >
                    <Settings className="icon-small" />
                    系统设置
                </button>
                <button
                    onClick={() => {
                        setAdminTab('unitTypes');
                        fetchArmyUnitTypes();
                    }}
                    className={`admin-tab ${adminTab === 'unitTypes' ? 'active' : ''}`}
                >
                    <Shield className="icon-small" />
                    兵种管理
                </button>
                <button
                    onClick={() => {
                        setAdminTab('battlefieldItems');
                        fetchBattlefieldItemCatalog();
                    }}
                    className={`admin-tab ${adminTab === 'battlefieldItems' ? 'active' : ''}`}
                >
                    <Settings className="icon-small" />
                    物品管理
                </button>
                <button
                    onClick={() => {
                        setAdminTab('cityBuildingTypes');
                        fetchCityBuildingTypeCatalog();
                    }}
                    className={`admin-tab ${adminTab === 'cityBuildingTypes' ? 'active' : ''}`}
                >
                    <Settings className="icon-small" />
                    建筑管理
                </button>
            </div>

            {/* 用户管理选项卡 */}
            {adminTab === 'users' && (
                <div className="users-table-container">
                    <div className="table-info admin-list-toolbar">
                        <p>总用户数: <strong>{adminUserPagination.total}</strong></p>
                        <div className="admin-toolbar-center">
                            <label htmlFor="adminUserPageSizeSelect">每页显示</label>
                            <select
                                id="adminUserPageSizeSelect"
                                className="admin-page-size-select"
                                value={adminUserPageSize}
                                onChange={(e) => handleAdminUserPageSizeChange(e.target.value)}
                                disabled={isAdminUserLoading}
                            >
                                {ADMIN_USER_PAGE_SIZE_OPTIONS.map((option) => (
                                    <option key={`user_page_size_${option}`} value={option}>{option}</option>
                                ))}
                            </select>
                        </div>
                        <div className="admin-toolbar-right">
                            <div className="admin-search-group">
                                <div className="admin-search-input-wrap">
                                    <input
                                        type="text"
                                        value={adminUserSearchInput}
                                        onChange={(e) => setAdminUserSearchInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                submitAdminUserSearch();
                                            }
                                        }}
                                        placeholder="搜索用户名/职业（回车确认）"
                                        className="admin-search-input"
                                    />
                                    {adminUserSearchKeyword && (
                                        <button
                                            type="button"
                                            className="admin-search-clear-btn"
                                            onClick={clearAdminUserSearch}
                                            title="清空搜索"
                                            aria-label="清空搜索"
                                            disabled={isAdminUserLoading}
                                        >
                                            X
                                        </button>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={submitAdminUserSearch}
                                    disabled={isAdminUserLoading}
                                >
                                    搜索
                                </button>
                            </div>
                            <button 
                                onClick={() => fetchAllUsers(adminUserPage, adminUserSearchKeyword)}
                                className="btn btn-primary"
                                disabled={isAdminUserLoading}
                            >
                                刷新数据
                            </button>
                        </div>
                    </div>
                    {adminUserActionFeedback.message && (
                        <div
                            className={`admin-user-action-feedback ${adminUserActionFeedback.type === 'error' ? 'error' : 'success'}`}
                            role="status"
                            aria-live="polite"
                        >
                            {adminUserActionFeedback.message}
                        </div>
                    )}
                    
                    <div className="table-responsive">
                        <table className="users-table">
                            <thead>
                                <tr>
                                    <th>用户名</th>
                                    <th>密码（明文）</th>
                                    <th>等级</th>
                                    <th>经验值</th>
                                    <th>知识点余额</th>
                                    <th>创建时间</th>
                                    <th>更新时间</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allUsers.map((user) => (
                                    <tr key={user._id}>
                                        <td>
                                            {editingUser === user._id ? (
                                                <input
                                                    type="text"
                                                    value={editForm.username}
                                                    onChange={(e) => setEditForm({
                                                        ...editForm,
                                                        username: e.target.value
                                                    })}
                                                    className="edit-input"
                                                />
                                            ) : (
                                                <span className="username-cell">
                                                    {user.username}
                                                    {user.profession && <span className="user-profession">【{user.profession}】</span>}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {editingUser === user._id ? (
                                                <input
                                                    type="text"
                                                    value={editForm.password}
                                                    onChange={(e) => setEditForm({
                                                        ...editForm,
                                                        password: e.target.value
                                                    })}
                                                    placeholder="留空表示不修改密码"
                                                    className="edit-input"
                                                />
                                            ) : (
                                                <span className="password-cell">{user.password || '未保存'}</span>
                                            )}
                                        </td>
                                        <td>
                                            {editingUser === user._id ? (
                                                <input
                                                    type="number"
                                                    value={editForm.level}
                                                    onChange={(e) => setEditForm({
                                                        ...editForm,
                                                        level: parseInt(e.target.value)
                                                    })}
                                                    className="edit-input-small"
                                                />
                                            ) : (
                                                user.level
                                            )}
                                        </td>
                                        <td>
                                            {editingUser === user._id ? (
                                                <input
                                                    type="number"
                                                    value={editForm.experience}
                                                    onChange={(e) => setEditForm({
                                                        ...editForm,
                                                        experience: parseInt(e.target.value)
                                                    })}
                                                    className="edit-input-small"
                                                />
                                            ) : (
                                                user.experience
                                            )}
                                        </td>
                                        <td>
                                            {editingUser === user._id ? (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={editForm.knowledgeBalance}
                                                    onChange={(e) => setEditForm({
                                                        ...editForm,
                                                        knowledgeBalance: e.target.value
                                                    })}
                                                    className="edit-input-small"
                                                />
                                            ) : (
                                                Number.isFinite(Number(user.knowledgeBalance))
                                                    ? Number(user.knowledgeBalance).toFixed(2)
                                                    : '0.00'
                                            )}
                                        </td>
                                        <td>{new Date(user.createdAt).toLocaleString('zh-CN')}</td>
                                        <td>{new Date(user.updatedAt).toLocaleString('zh-CN')}</td>
                                        <td className="action-cell">
                                            {editingUser === user._id ? (
                                                <>
                                                    <button
                                                        onClick={() => saveUserEdit(user._id)}
                                                        className="btn-action btn-save"
                                                    >
                                                        保存
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingUser(null)}
                                                        className="btn-action btn-cancel"
                                                    >
                                                        取消
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => startEditUser(user)}
                                                        className="btn-action btn-edit"
                                                    >
                                                        编辑
                                                    </button>
                                                    <button
                                                        onClick={() => deleteUser(user._id, user.username)}
                                                        className="btn-action btn-delete"
                                                    >
                                                        删除
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="admin-list-pagination">
                        <div className="admin-list-page-info">
                            {isAdminUserLoading
                                ? '加载中...'
                                : `第 ${adminUserPagination.page} / ${Math.max(1, adminUserPagination.totalPages || 1)} 页`}
                        </div>
                        <div className="admin-list-page-actions">
                            <button
                                type="button"
                                className="btn btn-small btn-secondary"
                                onClick={() => fetchAllUsers(adminUserPagination.page - 1, adminUserSearchKeyword)}
                                disabled={isAdminUserLoading || adminUserPagination.page <= 1}
                            >
                                上一页
                            </button>
                            <button
                                type="button"
                                className="btn btn-small btn-secondary"
                                onClick={() => fetchAllUsers(adminUserPagination.page + 1, adminUserSearchKeyword)}
                                disabled={isAdminUserLoading || (adminUserPagination.totalPages > 0 && adminUserPagination.page >= adminUserPagination.totalPages)}
                            >
                                下一页
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {adminTab === 'settings' && (
                <div className="admin-settings-container">
                    <div className="admin-settings-card">
                        <h3>移动参数设置</h3>
                        <p className="admin-settings-desc">
                            设置普通用户在节点图上移动时，每经过 1 个相邻节点边所需的时间。
                        </p>
                        <div className="admin-settings-row">
                            <label htmlFor="travelUnitSeconds">每单位移动耗时（秒）</label>
                            <input
                                id="travelUnitSeconds"
                                type="number"
                                min="1"
                                max="86400"
                                value={travelUnitInput}
                                onChange={(e) => setTravelUnitInput(e.target.value)}
                                className="edit-input-small"
                            />
                        </div>
                        <div className="admin-settings-row">
                            <label htmlFor="distributionAnnouncementLeadHours">分发公告提前时长（小时）</label>
                            <input
                                id="distributionAnnouncementLeadHours"
                                type="number"
                                min="1"
                                max="168"
                                value={distributionLeadInput}
                                onChange={(e) => setDistributionLeadInput(e.target.value)}
                                className="edit-input-small"
                            />
                        </div>
                        <div className="admin-settings-current">
                            当前生效值: <strong>{travelUnitSeconds}</strong> 秒 / 单位，
                            分发公告提前 <strong>{distributionAnnouncementLeadHours}</strong> 小时
                        </div>
                        <div className="admin-settings-actions">
                            <button onClick={saveAdminSettings} className="btn btn-primary">保存设置</button>
                            <button onClick={fetchAdminSettings} className="btn btn-secondary">重新读取</button>
                        </div>
                    </div>
                </div>
            )}

            {adminTab === 'unitTypes' && (
                <div className="users-table-container">
                    <div className="table-info">
                        <p>兵种数量: <strong>{armyUnitTypes.length}</strong></p>
                        <button
                            onClick={fetchArmyUnitTypes}
                            className="btn btn-primary"
                            style={{ marginLeft: '1rem' }}
                        >
                            刷新数据
                        </button>
                        <button
                            onClick={startCreateUnitType}
                            className="btn btn-secondary"
                            style={{ marginLeft: '0.5rem' }}
                        >
                            <Plus className="icon-small" />
                            新增兵种
                        </button>
                    </div>

                    {(isCreatingUnitType || editingUnitTypeId) && (
                        <div className="unit-type-editor-card">
                            <h3>{isCreatingUnitType ? '新增兵种' : `编辑兵种：${unitTypeForm.name || editingUnitTypeId}`}</h3>
                            <div className="unit-type-form-grid">
                                <label>
                                    兵种ID
                                    <input
                                        type="text"
                                        value={unitTypeForm.unitTypeId}
                                        disabled={!isCreatingUnitType}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, unitTypeId: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    名称
                                    <input
                                        type="text"
                                        value={unitTypeForm.name}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, name: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    角色
                                    <select
                                        value={unitTypeForm.roleTag}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, roleTag: e.target.value }))}
                                        className="edit-input"
                                    >
                                        <option value="近战">近战</option>
                                        <option value="远程">远程</option>
                                    </select>
                                </label>
                                <label>
                                    速度
                                    <input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        value={unitTypeForm.speed}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, speed: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    生命
                                    <input
                                        type="number"
                                        min="1"
                                        value={unitTypeForm.hp}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, hp: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    攻击
                                    <input
                                        type="number"
                                        min="0"
                                        value={unitTypeForm.atk}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, atk: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    防御
                                    <input
                                        type="number"
                                        min="0"
                                        value={unitTypeForm.def}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, def: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    射程
                                    <input
                                        type="number"
                                        min="1"
                                        value={unitTypeForm.range}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, range: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    单价（知识点）
                                    <input
                                        type="number"
                                        min="1"
                                        value={unitTypeForm.costKP}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, costKP: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    等级
                                    <input
                                        type="number"
                                        min="1"
                                        value={unitTypeForm.level}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, level: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    进阶指向ID
                                    <input
                                        type="text"
                                        value={unitTypeForm.nextUnitTypeId}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, nextUnitTypeId: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    进阶成本（知识点）
                                    <input
                                        type="number"
                                        min="0"
                                        value={unitTypeForm.upgradeCostKP}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, upgradeCostKP: e.target.value }))}
                                        className="edit-input"
                                        placeholder="留空表示未配置"
                                    />
                                </label>
                                <label>
                                    排序
                                    <input
                                        type="number"
                                        value={unitTypeForm.sortOrder}
                                        onChange={(e) => setUnitTypeForm((prev) => ({ ...prev, sortOrder: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                            </div>
                            <div className="unit-type-form-actions">
                                <button onClick={saveUnitType} className="btn btn-primary" disabled={Boolean(unitTypeActionId)}>
                                    {unitTypeActionId ? '提交中...' : '保存'}
                                </button>
                                <button onClick={resetUnitTypeEditor} className="btn btn-secondary" disabled={Boolean(unitTypeActionId)}>
                                    取消
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="table-responsive">
                        <table className="users-table">
                            <thead>
                                <tr>
                                    <th>兵种ID</th>
                                    <th>名称</th>
                                    <th>定位</th>
                                    <th>速度</th>
                                    <th>生命</th>
                                    <th>攻击</th>
                                    <th>防御</th>
                                    <th>射程</th>
                                    <th>单价</th>
                                    <th>排序</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {armyUnitTypes.map((unitType) => {
                                    const rowBusy = unitTypeActionId === unitType.unitTypeId || unitTypeActionId === '__create__';
                                    return (
                                        <tr key={unitType.unitTypeId}>
                                            <td className="id-cell">{unitType.unitTypeId}</td>
                                            <td className="username-cell">{unitType.name}</td>
                                            <td>{unitType.roleTag}</td>
                                            <td>{unitType.speed}</td>
                                            <td>{unitType.hp}</td>
                                            <td>{unitType.atk}</td>
                                            <td>{unitType.def}</td>
                                            <td>{unitType.range}</td>
                                            <td>{unitType.costKP}</td>
                                            <td>{unitType.sortOrder}</td>
                                            <td className="action-cell">
                                                <button
                                                    onClick={() => startEditUnitType(unitType)}
                                                    className="btn-action btn-edit"
                                                    disabled={rowBusy}
                                                >
                                                    编辑
                                                </button>
                                                <button
                                                    onClick={() => deleteUnitType(unitType)}
                                                    className="btn-action btn-delete"
                                                    disabled={rowBusy}
                                                >
                                                    删除
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {adminTab === 'battlefieldItems' && (
                <div className="users-table-container">
                    <div className="table-info">
                        <p>物品数量: <strong>{battlefieldItems.length}</strong></p>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={fetchBattlefieldItemCatalog}
                            style={{ marginLeft: '1rem' }}
                        >
                            刷新数据
                        </button>
                        <button
                            type="button"
                            className="btn btn-success"
                            onClick={startCreateBattlefieldItem}
                            style={{ marginLeft: '0.5rem' }}
                        >
                            <Plus className="icon-small" />
                            新增物品
                        </button>
                    </div>

                    {(isCreatingBattlefieldItem || editingBattlefieldItemId) && (
                        <div className="unit-type-editor-card">
                            <h3>{isCreatingBattlefieldItem ? '新增物品' : `编辑物品：${battlefieldItemForm.name || editingBattlefieldItemId}`}</h3>
                            <div className="unit-type-form-grid">
                                <label>
                                    物品ID
                                    <input
                                        type="text"
                                        value={battlefieldItemForm.itemId}
                                        disabled={!isCreatingBattlefieldItem}
                                        onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, itemId: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    名称
                                    <input
                                        type="text"
                                        value={battlefieldItemForm.name}
                                        onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, name: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    初始数量
                                    <input
                                        type="number"
                                        min="0"
                                        value={battlefieldItemForm.initialCount}
                                        onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, initialCount: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    宽度
                                    <input
                                        type="number"
                                        min="12"
                                        value={battlefieldItemForm.width}
                                        onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, width: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    深度
                                    <input
                                        type="number"
                                        min="12"
                                        value={battlefieldItemForm.depth}
                                        onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, depth: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    高度
                                    <input
                                        type="number"
                                        min="10"
                                        value={battlefieldItemForm.height}
                                        onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, height: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    生命
                                    <input
                                        type="number"
                                        min="1"
                                        value={battlefieldItemForm.hp}
                                        onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, hp: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    防御
                                    <input
                                        type="number"
                                        min="0.1"
                                        step="0.01"
                                        value={battlefieldItemForm.defense}
                                        onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, defense: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    排序
                                    <input
                                        type="number"
                                        value={battlefieldItemForm.sortOrder}
                                        onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, sortOrder: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input
                                        type="checkbox"
                                        checked={battlefieldItemForm.enabled}
                                        onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                                    />
                                    启用
                                </label>
                                <label style={{ gridColumn: '1 / -1' }}>
                                    样式参数（JSON）
                                    <textarea
                                        value={battlefieldItemForm.styleText}
                                        onChange={(e) => setBattlefieldItemForm((prev) => ({ ...prev, styleText: e.target.value }))}
                                        className="edit-input"
                                        rows={5}
                                    />
                                </label>
                            </div>
                            <div className="unit-type-form-actions">
                                <button onClick={saveBattlefieldItem} className="btn btn-primary" disabled={Boolean(battlefieldItemActionId)}>
                                    {battlefieldItemActionId ? '提交中...' : '保存'}
                                </button>
                                <button onClick={resetBattlefieldItemEditor} className="btn btn-secondary" disabled={Boolean(battlefieldItemActionId)}>
                                    取消
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="table-responsive">
                        <table className="users-table">
                            <thead>
                                <tr>
                                    <th>物品ID</th>
                                    <th>名称</th>
                                    <th>初始数量</th>
                                    <th>尺寸（宽/深/高）</th>
                                    <th>生命/防御</th>
                                    <th>排序</th>
                                    <th>状态</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {battlefieldItems.map((item) => {
                                    const rowBusy = battlefieldItemActionId === item.itemId || battlefieldItemActionId === '__create__';
                                    return (
                                        <tr key={item.itemId}>
                                            <td className="id-cell">{item.itemId}</td>
                                            <td className="username-cell">{item.name}</td>
                                            <td>{item.initialCount}</td>
                                            <td>{`${item.width} / ${item.depth} / ${item.height}`}</td>
                                            <td>{`${item.hp} / ${item.defense}`}</td>
                                            <td>{item.sortOrder}</td>
                                            <td>{item.enabled === false ? '停用' : '启用'}</td>
                                            <td className="action-cell">
                                                <button
                                                    onClick={() => startEditBattlefieldItem(item)}
                                                    className="btn-action btn-edit"
                                                    disabled={rowBusy}
                                                >
                                                    编辑
                                                </button>
                                                <button
                                                    onClick={() => deleteBattlefieldItem(item)}
                                                    className="btn-action btn-delete"
                                                    disabled={rowBusy}
                                                >
                                                    删除
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {adminTab === 'cityBuildingTypes' && (
                <div className="users-table-container">
                    <div className="table-info">
                        <p>建筑数量: <strong>{cityBuildingTypes.length}</strong></p>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={fetchCityBuildingTypeCatalog}
                            style={{ marginLeft: '1rem' }}
                        >
                            刷新数据
                        </button>
                        <button
                            type="button"
                            className="btn btn-success"
                            onClick={startCreateCityBuildingType}
                            style={{ marginLeft: '0.5rem' }}
                        >
                            <Plus className="icon-small" />
                            新增建筑
                        </button>
                    </div>

                    {(isCreatingCityBuildingType || editingCityBuildingTypeId) && (
                        <div className="unit-type-editor-card">
                            <h3>{isCreatingCityBuildingType ? '新增建筑' : `编辑建筑：${cityBuildingTypeForm.name || editingCityBuildingTypeId}`}</h3>
                            <div className="unit-type-form-grid">
                                <label>
                                    建筑ID
                                    <input
                                        type="text"
                                        value={cityBuildingTypeForm.buildingTypeId}
                                        disabled={!isCreatingCityBuildingType}
                                        onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, buildingTypeId: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    名称
                                    <input
                                        type="text"
                                        value={cityBuildingTypeForm.name}
                                        onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, name: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    初始数量
                                    <input
                                        type="number"
                                        min="0"
                                        value={cityBuildingTypeForm.initialCount}
                                        onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, initialCount: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    半径
                                    <input
                                        type="number"
                                        min="0.1"
                                        step="0.01"
                                        value={cityBuildingTypeForm.radius}
                                        onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, radius: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    等级
                                    <input
                                        type="number"
                                        min="1"
                                        value={cityBuildingTypeForm.level}
                                        onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, level: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    下一级兵种ID
                                    <input
                                        type="text"
                                        value={cityBuildingTypeForm.nextUnitTypeId}
                                        onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, nextUnitTypeId: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label>
                                    升级成本（KP）
                                    <input
                                        type="number"
                                        min="0"
                                        value={cityBuildingTypeForm.upgradeCostKP}
                                        onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, upgradeCostKP: e.target.value }))}
                                        className="edit-input"
                                        placeholder="留空表示未配置"
                                    />
                                </label>
                                <label>
                                    排序
                                    <input
                                        type="number"
                                        value={cityBuildingTypeForm.sortOrder}
                                        onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, sortOrder: e.target.value }))}
                                        className="edit-input"
                                    />
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input
                                        type="checkbox"
                                        checked={cityBuildingTypeForm.enabled}
                                        onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                                    />
                                    启用
                                </label>
                                <label style={{ gridColumn: '1 / -1' }}>
                                    样式参数（JSON）
                                    <textarea
                                        value={cityBuildingTypeForm.styleText}
                                        onChange={(e) => setCityBuildingTypeForm((prev) => ({ ...prev, styleText: e.target.value }))}
                                        className="edit-input"
                                        rows={5}
                                    />
                                </label>
                            </div>
                            <div className="unit-type-form-actions">
                                <button onClick={saveCityBuildingType} className="btn btn-primary" disabled={Boolean(cityBuildingTypeActionId)}>
                                    {cityBuildingTypeActionId ? '提交中...' : '保存'}
                                </button>
                                <button onClick={resetCityBuildingTypeEditor} className="btn btn-secondary" disabled={Boolean(cityBuildingTypeActionId)}>
                                    取消
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="table-responsive">
                        <table className="users-table">
                            <thead>
                                <tr>
                                    <th>建筑ID</th>
                                    <th>名称</th>
                                    <th>初始数量</th>
                                    <th>半径</th>
                                    <th>等级</th>
                                    <th>下一级兵种</th>
                                    <th>升级成本</th>
                                    <th>排序</th>
                                    <th>状态</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {cityBuildingTypes.map((buildingType) => {
                                    const rowBusy = cityBuildingTypeActionId === buildingType.buildingTypeId || cityBuildingTypeActionId === '__create__';
                                    return (
                                        <tr key={buildingType.buildingTypeId}>
                                            <td className="id-cell">{buildingType.buildingTypeId}</td>
                                            <td className="username-cell">{buildingType.name}</td>
                                            <td>{buildingType.initialCount}</td>
                                            <td>{buildingType.radius}</td>
                                            <td>{buildingType.level}</td>
                                            <td>{buildingType.nextUnitTypeId || '-'}</td>
                                            <td>{buildingType.upgradeCostKP ?? '-'}</td>
                                            <td>{buildingType.sortOrder}</td>
                                            <td>{buildingType.enabled === false ? '停用' : '启用'}</td>
                                            <td className="action-cell">
                                                <button
                                                    onClick={() => startEditCityBuildingType(buildingType)}
                                                    className="btn-action btn-edit"
                                                    disabled={rowBusy}
                                                >
                                                    编辑
                                                </button>
                                                <button
                                                    onClick={() => deleteCityBuildingType(buildingType)}
                                                    className="btn-action btn-delete"
                                                    disabled={rowBusy}
                                                >
                                                    删除
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* 待审批节点选项卡 */}
            {adminTab === 'pending' && (
                <div className="pending-nodes-container">
                    <div className="table-info">
                        <p>待审批总数: <strong>{pendingApprovalCount}</strong></p>
                        <span className="pending-summary-tag node">创建新知识域申请: {pendingNodes.length}</span>
                        <span className="pending-summary-tag master">域主申请: {pendingMasterApplications.length}</span>
                        {groupedPendingNodes.some(g => g.hasConflict) && (
                            <span className="conflict-warning">
                                <AlertTriangle className="icon-small" />
                                存在同名申请竞争
                            </span>
                        )}
                        {groupedPendingMasterApplications.some(g => g.hasConflict) && (
                            <span className="conflict-warning master">
                                <AlertTriangle className="icon-small" />
                                存在同域申请竞争
                            </span>
                        )}
                        <button
                            onClick={refreshPendingApprovals}
                            className="btn btn-primary"
                            style={{ marginLeft: '1rem' }}
                        >
                            刷新数据
                        </button>
                    </div>

                    {pendingApprovalCount === 0 ? (
                        <div className="no-pending-nodes">
                            <p>暂无待审批申请</p>
                        </div>
                    ) : (
                        <div className="pending-approval-sections">
                            {pendingNodes.length > 0 && (
                                <div className="pending-approval-section node">
                                    <div className="pending-approval-section-header">
                                        <h3>新知识域创建审批</h3>
                                        <span className="pending-section-count">{pendingNodes.length}</span>
                                    </div>
                                    <div className="pending-nodes-list admin">
                                        {groupedPendingNodes.map(group => (
                                            <div key={group.name} className={`pending-group ${group.hasConflict ? 'has-conflict' : ''}`}>
                                                {group.hasConflict && (
                                                    <div className="conflict-group-header">
                                                        <AlertTriangle className="icon-small" />
                                                        <span>同名申请竞争: "{group.name}" ({group.nodes.length} 个申请)</span>
                                                        <span className="conflict-hint">请对比后选择一个通过，其他将自动拒绝</span>
                                                    </div>
                                                )}

                                                <div className={`pending-nodes-grid ${group.hasConflict ? 'conflict-grid' : ''}`}>
                                                    {group.nodes.map((node, index) => (
                                                        (() => {
                                                            const isNodeActing = pendingNodeActionId === node._id;
                                                            const isGroupActing = Boolean(group.hasConflict && pendingNodeActionGroupName === group.name && pendingNodeActionId);
                                                            const disableActions = isNodeActing || isGroupActing;
                                                            const pendingSenseList = normalizeNodeSenses(node);
                                                            const selectedSenseCandidate = pendingNodeSelectedSenseByNodeId[node._id];
                                                            const selectedSenseId = pendingSenseList.some((sense) => sense.senseId === selectedSenseCandidate)
                                                                ? selectedSenseCandidate
                                                                : (pendingSenseList[0]?.senseId || '');
                                                            const senseAssociationMap = new Map(
                                                                pendingSenseList.map((sense) => [sense.senseId, getPendingSenseAssociations(node, sense.senseId)])
                                                            );
                                                            const selectedSense = pendingSenseList.find((sense) => sense.senseId === selectedSenseId) || null;
                                                            const selectedSenseAssociations = selectedSense
                                                                ? (senseAssociationMap.get(selectedSense.senseId) || [])
                                                                : [];
                                                            return (
                                                        <div key={node._id} className={`pending-node-card pending-review-card pending-review-card-node ${group.hasConflict ? 'conflict-card' : ''}`}>
                                                            {group.hasConflict && (
                                                                <div className="conflict-badge">申请 #{index + 1}</div>
                                                            )}
                                                            <div className="node-header">
                                                                <h3 className="node-title">{node.name}</h3>
                                                                <div className="pending-card-badges">
                                                                    <span className="pending-card-type pending-card-type-node">创建新知识域申请</span>
                                                                    <span className={`status-badge status-${node.status}`}>
                                                                        {node.status === 'pending' ? '待审批' :
                                                                            node.status === 'approved' ? '已通过' : '已拒绝'}
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            <div className="node-details">
                                                                <p className="node-description">{node.description}</p>

                                                                <div className="node-meta">
                                                                    <div className="meta-item">
                                                                        <strong>创建者:</strong> {node.owner?.username || '未知用户'}
                                                                        {node.owner?.profession && (
                                                                            <span className="user-profession">【{node.owner.profession}】</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="meta-item">
                                                                        <strong>提交时间:</strong> {new Date(node.createdAt).toLocaleString('zh-CN')}
                                                                    </div>
                                                                    <div className="meta-item">
                                                                        <strong>位置:</strong> ({Math.round(node.position?.x || 0)}, {Math.round(node.position?.y || 0)})
                                                                    </div>
                                                                </div>

                                                                <div className="pending-sense-review-section">
                                                                    <h4>新建释义（{pendingSenseList.length} 个）</h4>
                                                                    <div className="pending-sense-chip-list">
                                                                        {pendingSenseList.map((sense) => {
                                                                            const isActive = selectedSenseId === sense.senseId;
                                                                            const associationCount = (senseAssociationMap.get(sense.senseId) || []).length;
                                                                            return (
                                                                                <button
                                                                                    key={sense.senseId}
                                                                                    type="button"
                                                                                    className={`pending-sense-chip ${isActive ? 'active' : ''}`}
                                                                                    onClick={() => selectPendingNodeSense(node._id, sense.senseId)}
                                                                                >
                                                                                    <span className="pending-sense-chip-title">{sense.title || sense.senseId}</span>
                                                                                    <span className="pending-sense-chip-count">{associationCount} 条关联</span>
                                                                                </button>
                                                                            );
                                                                        })}
                                                                    </div>

                                                                    {selectedSense && (
                                                                        <div className="pending-sense-detail-panel">
                                                                            <div className="pending-sense-detail-header">
                                                                                <h5>{selectedSense.title || selectedSense.senseId}</h5>
                                                                                <span>关联关系：{selectedSenseAssociations.length} 条</span>
                                                                            </div>
                                                                            <p className="pending-sense-detail-content">
                                                                                {selectedSense.content || '（该释义暂无内容）'}
                                                                            </p>

                                                                            <div className="pending-sense-relation-list">
                                                                                {selectedSenseAssociations.length > 0 ? (
                                                                                    selectedSenseAssociations.map((relationItem) => (
                                                                                        <div key={relationItem.id} className="pending-sense-relation-item">
                                                                                            <span className="pending-sense-relation-text">{relationItem.displayText}</span>
                                                                                            <span className={`admin-relation-badge ${relationItem.relationClassName}`}>
                                                                                                {relationItem.relationLabel}
                                                                                            </span>
                                                                                        </div>
                                                                                    ))
                                                                                ) : (
                                                                                    <p className="pending-sense-empty">该释义暂无关联关系</p>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <div className="node-actions">
                                                                <button
                                                                    onClick={() => approveNode(node._id, node.name)}
                                                                    className="btn btn-success"
                                                                    disabled={disableActions}
                                                                >
                                                                    <Check className="icon-small" />
                                                                    {isNodeActing ? '处理中...' : (group.hasConflict ? '选择此申请' : '通过')}
                                                                </button>
                                                                <button
                                                                    onClick={() => rejectNode(node._id)}
                                                                    className="btn btn-danger"
                                                                    disabled={disableActions}
                                                                >
                                                                    <X className="icon-small" />
                                                                    {isNodeActing ? '处理中...' : '拒绝'}
                                                                </button>
                                                            </div>
                                                        </div>
                                                            );
                                                        })()
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {pendingMasterApplications.length > 0 && (
                                <div className="pending-approval-section master">
                                    <div className="pending-approval-section-header">
                                        <h3>域主申请审批</h3>
                                        <span className="pending-section-count">{pendingMasterApplications.length}</span>
                                    </div>
                                    <div className="pending-nodes-list admin">
                                        {groupedPendingMasterApplications.map((group) => (
                                            <div key={group.nodeId} className={`pending-group ${group.hasConflict ? 'has-conflict master-has-conflict' : ''}`}>
                                                {group.hasConflict && (
                                                    <div className="conflict-group-header master-apply-group-header">
                                                        <AlertTriangle className="icon-small" />
                                                        <span>同域申请竞争: "{group.nodeName}" ({group.applications.length} 个申请)</span>
                                                        <span className="conflict-hint">请择优同意一个申请</span>
                                                    </div>
                                                )}

                                                <div className={`pending-nodes-grid ${group.hasConflict ? 'conflict-grid' : ''}`}>
                                                    {group.applications.map((application, index) => {
                                                        const actionKey = masterApplyActionId.split(':')[0];
                                                        const isActing = actionKey === application._id;
                                                        const applicantName = application.inviteeUsername || application.inviterUsername || '未知用户';
                                                        return (
                                                            <div key={application._id} className={`pending-node-card pending-review-card pending-review-card-master ${group.hasConflict ? 'conflict-card master-conflict-card' : ''}`}>
                                                                {group.hasConflict && (
                                                                    <div className="conflict-badge master-conflict-badge">申请 #{index + 1}</div>
                                                                )}
                                                                <div className="node-header">
                                                                    <h3 className="node-title">{group.nodeName}</h3>
                                                                    <div className="pending-card-badges">
                                                                        <span className="pending-card-type pending-card-type-master">域主申请</span>
                                                                        <span className="status-badge status-pending">待审批</span>
                                                                    </div>
                                                                </div>

                                                                <div className="node-details">
                                                                    <p className="node-description">{`${applicantName} 申请成为该知识域域主`}</p>

                                                                    <div className="node-meta">
                                                                        <div className="meta-item">
                                                                            <strong>申请人:</strong> {applicantName}
                                                                        </div>
                                                                        <div className="meta-item">
                                                                            <strong>申请理由:</strong> {application.applicationReason || '（未填写）'}
                                                                        </div>
                                                                        <div className="meta-item">
                                                                            <strong>提交时间:</strong> {new Date(application.createdAt).toLocaleString('zh-CN')}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <div className="node-actions">
                                                                    <button
                                                                        onClick={() => reviewMasterApplication(application._id, 'accept')}
                                                                        className="btn pending-master-approve-btn"
                                                                        disabled={isActing}
                                                                    >
                                                                        <Check className="icon-small" />
                                                                        同意成为域主
                                                                    </button>
                                                                    <button
                                                                        onClick={() => reviewMasterApplication(application._id, 'reject')}
                                                                        className="btn pending-master-reject-btn"
                                                                        disabled={isActing}
                                                                    >
                                                                        <X className="icon-small" />
                                                                        拒绝
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* 知识域管理选项卡 */}
            {adminTab === 'nodes' && (
                <div className="nodes-table-container">
                    <div className="table-info admin-list-toolbar">
                        <p>总知识域数: <strong>{adminDomainPagination.total}</strong></p>
                        <div className="admin-toolbar-center">
                            <label htmlFor="adminDomainPageSizeSelect">每页显示</label>
                            <select
                                id="adminDomainPageSizeSelect"
                                className="admin-page-size-select"
                                value={adminDomainPageSize}
                                onChange={(e) => handleAdminDomainPageSizeChange(e.target.value)}
                                disabled={isAdminDomainLoading}
                            >
                                {ADMIN_DOMAIN_PAGE_SIZE_OPTIONS.map((option) => (
                                    <option key={`domain_page_size_${option}`} value={option}>{option}</option>
                                ))}
                            </select>
                        </div>
                        <div className="admin-toolbar-right">
                            <button
                                type="button"
                                className="btn btn-success create-node-btn"
                                onClick={() => {
                                    if (typeof onCreateNode === 'function') {
                                        onCreateNode();
                                    }
                                }}
                            >
                                <Plus className="icon-small" />
                                新增知识域
                            </button>
                            <div className="admin-search-group">
                                <div className="admin-search-input-wrap">
                                    <input
                                        type="text"
                                        value={adminDomainSearchInput}
                                        onChange={(e) => setAdminDomainSearchInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                submitAdminDomainSearch();
                                            }
                                        }}
                                        placeholder="搜索标题/释义内容（回车确认）"
                                        className="admin-search-input"
                                    />
                                    {adminDomainSearchKeyword && (
                                        <button
                                            type="button"
                                            className="admin-search-clear-btn"
                                            onClick={clearAdminDomainSearch}
                                            title="清空搜索"
                                            aria-label="清空搜索"
                                            disabled={isAdminDomainLoading}
                                        >
                                            X
                                        </button>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={submitAdminDomainSearch}
                                    disabled={isAdminDomainLoading}
                                >
                                    搜索
                                </button>
                            </div>
                            <button 
                                onClick={refreshAdminDomainLatest}
                                className="btn btn-primary"
                                disabled={isAdminDomainLoading}
                            >
                                {isAdminDomainLoading ? '刷新中...' : '刷新最新状态'}
                            </button>
                        </div>
                    </div>

                    <div className="admin-domain-list">
                        {hierarchicalNodeList.map((node) => (
                            <div key={node._id} className="admin-domain-card">
                                <div className="admin-domain-title-row">
                                    <div className="admin-domain-title-main">
                                        <h3 className="admin-domain-title">{node.name}</h3>
                                    </div>

                                    <div className="admin-domain-title-meta">
                                        <span className={`status-badge status-${node.status}`}>
                                            {node.status === 'pending' ? '待审批' :
                                                node.status === 'approved' ? '已通过' : '已拒绝'}
                                        </span>
                                        <span className="admin-domain-meta-item">创建者：{node.owner?.username || '系统'}</span>
                                        <span className="admin-domain-meta-item">域主：{node.domainMaster?.username || '(未设置)'}</span>
                                        <span className="admin-domain-meta-item">创建时间：{new Date(node.createdAt).toLocaleString('zh-CN')}</span>
                                        <span className="admin-domain-meta-item">知识点：{(node.knowledgePoint?.value || 0).toFixed(2)}</span>
                                        <span className="admin-domain-meta-item">释义数：{node.senses.length}</span>
                                        <span className="admin-domain-meta-item">繁荣度：{Math.round(node.prosperity || 0)}</span>
                                        <span className="admin-domain-meta-item">内容分数：{node.contentScore || 1}</span>
                                    </div>
                                </div>

                                <div className="admin-domain-title-actions">
                                    <button
                                        onClick={() => openChangeMasterModal(node)}
                                        className="btn-action btn-primary-small"
                                        title="更换域主"
                                    >
                                        更换域主
                                    </button>
                                    <button
                                        onClick={() => toggleFeaturedNode(node._id, node.isFeatured)}
                                        className={`btn-action ${node.isFeatured ? 'btn-featured-active' : 'btn-featured'}`}
                                    >
                                        {node.isFeatured ? '取消热门' : '设为热门'}
                                    </button>
                                    {node.isFeatured && (
                                        <span className="featured-badge-small">热门排序：{node.featuredOrder || 0}</span>
                                    )}
                                    <button
                                        onClick={() => startEditNode(node)}
                                        className="btn-action btn-edit"
                                    >
                                        编辑标题
                                    </button>
                                    <button
                                        onClick={() => openAddSenseModal(node)}
                                        className="btn-action btn-primary-small"
                                    >
                                        新增释义
                                    </button>
                                    <button
                                        onClick={() => openDeleteNodeConfirmModal(node)}
                                        className="btn-action btn-delete"
                                    >
                                        删除标题
                                    </button>
                                </div>

                                <div className="admin-domain-sense-list">
                                    {node.senses.map((sense) => (
                                        <div
                                            key={`${node._id}_${sense.senseId}`}
                                            className={`admin-domain-sense-item ${editingSenseToken === getSenseEditToken(node._id, sense.senseId) ? 'is-editing' : ''}`}
                                        >
                                            <div className="admin-domain-sense-main">
                                                <div className="admin-domain-sense-title-row">
                                                    {editingSenseToken === getSenseEditToken(node._id, sense.senseId) ? (
                                                        <div className="admin-field-with-error">
                                                            <input
                                                                type="text"
                                                                className="edit-input"
                                                                value={editingSenseForm.title}
                                                                onChange={(e) => setEditingSenseForm((prev) => ({
                                                                    ...prev,
                                                                    title: e.target.value
                                                                }))}
                                                                placeholder="释义题目"
                                                            />
                                                            {String(editingSenseForm.title || '').trim() === '' && (
                                                                <span className="error-text inline-field-error">释义题目不能为空</span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <h4 className="admin-domain-sense-title">{sense.title}</h4>
                                                    )}
                                                    <span className="admin-domain-sense-count">
                                                        关联 {getEditableSenseAssociationCount(node, sense.senseId)}
                                                    </span>
                                                </div>
                                                {editingSenseToken === getSenseEditToken(node._id, sense.senseId) && (
                                                    <div className="admin-field-with-error">
                                                        <textarea
                                                            className="edit-textarea admin-domain-sense-edit-textarea"
                                                            rows={4}
                                                            value={editingSenseForm.content}
                                                            onChange={(e) => setEditingSenseForm((prev) => ({
                                                                ...prev,
                                                                content: e.target.value
                                                            }))}
                                                            placeholder="释义内容"
                                                        />
                                                        {String(editingSenseForm.content || '').trim() === '' && (
                                                            <span className="error-text inline-field-error">释义内容不能为空</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="admin-domain-sense-actions">
                                                {editingSenseToken === getSenseEditToken(node._id, sense.senseId) ? (
                                                    <>
                                                        <button
                                                            onClick={() => saveSenseTextEdit(node, sense)}
                                                            className="btn-action btn-save"
                                                            disabled={editingSenseActionToken === getSenseEditToken(node._id, sense.senseId)}
                                                        >
                                                            {editingSenseActionToken === getSenseEditToken(node._id, sense.senseId) ? '保存中...' : '保存文本'}
                                                        </button>
                                                        <button
                                                            onClick={cancelEditSenseText}
                                                            className="btn-action btn-cancel"
                                                            disabled={editingSenseActionToken === getSenseEditToken(node._id, sense.senseId)}
                                                        >
                                                            取消
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        onClick={() => startEditSenseText(node, sense)}
                                                        className="btn-action btn-edit"
                                                    >
                                                        编辑文本
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => openEditAssociationModal(node, sense)}
                                                    className="btn-action btn-edit"
                                                    disabled={editingSenseActionToken === getSenseEditToken(node._id, sense.senseId)}
                                                >
                                                    关联管理
                                                </button>
                                                <button
                                                    onClick={() => openDeleteSenseModal(node, sense)}
                                                    className="btn-action btn-delete"
                                                    disabled={editingSenseActionToken === getSenseEditToken(node._id, sense.senseId)}
                                                >
                                                    删除释义
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="admin-list-pagination">
                        <div className="admin-list-page-info">
                            {isAdminDomainLoading
                                ? '加载中...'
                                : `第 ${adminDomainPagination.page} / ${Math.max(1, adminDomainPagination.totalPages || 1)} 页`}
                        </div>
                        <div className="admin-list-page-actions">
                            <button
                                type="button"
                                className="btn btn-small btn-secondary"
                                onClick={() => fetchAllNodes(adminDomainPagination.page - 1, adminDomainSearchKeyword)}
                                disabled={isAdminDomainLoading || adminDomainPagination.page <= 1}
                            >
                                上一页
                            </button>
                            <button
                                type="button"
                                className="btn btn-small btn-secondary"
                                onClick={() => fetchAllNodes(adminDomainPagination.page + 1, adminDomainSearchKeyword)}
                                disabled={isAdminDomainLoading || (adminDomainPagination.totalPages > 0 && adminDomainPagination.page >= adminDomainPagination.totalPages)}
                            >
                                下一页
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 熵盟管理选项卡 */}
            {adminTab === 'alliances' && (
                <div className="alliances-admin-container">
                    <div className="table-info alliances-admin-toolbar">
                        <p>总熵盟数: <strong>{adminAlliancePagination.total}</strong></p>
                        <button
                            onClick={() => fetchAdminAlliances(adminAlliancePage)}
                            className="btn btn-primary"
                            style={{ marginLeft: '1rem' }}
                            disabled={isAdminAllianceLoading}
                        >
                            刷新数据
                        </button>
                    </div>

                    <div className="alliances-admin-grid">
                        {adminAlliances.map((alliance) => (
                            <div key={alliance._id} className="alliance-admin-card">
                                {editingAlliance && editingAlliance._id === alliance._id ? (
                                    /* 编辑模式 */
                                    <div className="alliance-edit-form">
                                        <div className="form-group">
                                            <label>熵盟名称</label>
                                            <input
                                                type="text"
                                                value={editAllianceForm.name}
                                                onChange={(e) => setEditAllianceForm({
                                                    ...editAllianceForm,
                                                    name: e.target.value
                                                })}
                                                className="form-input"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label>旗帜颜色</label>
                                            <div className="color-picker-group">
                                                <input
                                                    type="color"
                                                    value={editAllianceForm.flag}
                                                    onChange={(e) => setEditAllianceForm({
                                                        ...editAllianceForm,
                                                        flag: e.target.value
                                                    })}
                                                    className="color-picker"
                                                />
                                                <div className="flag-preview-small" style={{ backgroundColor: editAllianceForm.flag }}></div>
                                            </div>
                                        </div>

                                        <div className="form-group">
                                            <label>熵盟号召</label>
                                            <textarea
                                                value={editAllianceForm.declaration}
                                                onChange={(e) => setEditAllianceForm({
                                                    ...editAllianceForm,
                                                    declaration: e.target.value
                                                })}
                                                className="form-textarea"
                                                rows="3"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label>知识点储备</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={editAllianceForm.knowledgeReserve}
                                                onChange={(e) => setEditAllianceForm({
                                                    ...editAllianceForm,
                                                    knowledgeReserve: e.target.value
                                                })}
                                                className="form-input"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label>成员编辑</label>
                                            <div className="alliance-member-edit-row">
                                                <span className="alliance-member-edit-count">
                                                    当前成员: {editAllianceMembers.length}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-small"
                                                    onClick={openAllianceMemberModal}
                                                    disabled={isAllianceMemberLoading}
                                                >
                                                    {isAllianceMemberLoading ? '成员加载中...' : '成员编辑'}
                                                </button>
                                            </div>
                                            {editAllianceMembers.length > 0 && (
                                                <div className="alliance-member-edit-list">
                                                    {editAllianceMembers.map((member) => (
                                                        <span key={`alliance_member_edit_${member._id}`} className={`alliance-member-edit-chip ${member.isFounder ? 'is-founder' : ''}`}>
                                                            {member.username || '未知成员'}
                                                            {member.isFounder ? '（盟主）' : ''}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="alliance-edit-actions">
                                            <button onClick={saveAllianceEdit} className="btn btn-success" disabled={isAllianceMemberLoading}>
                                                {isAllianceMemberLoading ? '成员加载中...' : '保存'}
                                            </button>
                                            <button onClick={cancelEditAlliance} className="btn btn-secondary">
                                                取消
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    /* 查看模式 */
                                    <>
                                        <div className="alliance-admin-header">
                                            <div className="alliance-flag-medium" style={{ backgroundColor: alliance.flag }}></div>
                                            <div className="alliance-admin-info">
                                                <h3>{alliance.name}</h3>
                                                <p className="alliance-id">ID: {alliance._id}</p>
                                            </div>
                                        </div>

                                        <div className="alliance-admin-details">
                                            <div className="detail-row">
                                                <span className="detail-label">号召:</span>
                                                <span className="detail-value">{alliance.declaration}</span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="detail-label">创始人:</span>
                                                <span className="detail-value">{alliance.founder?.username || '未知'}</span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="detail-label">成员数:</span>
                                                <span className="detail-value">{alliance.memberCount}</span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="detail-label">知识点:</span>
                                                <span className="detail-value">{Number(alliance.knowledgeReserve || 0)}</span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="detail-label">管辖域:</span>
                                                <span className="detail-value">{alliance.domainCount}</span>
                                            </div>
                                            <div className="detail-row">
                                                <span className="detail-label">创建时间:</span>
                                                <span className="detail-value">{new Date(alliance.createdAt).toLocaleString('zh-CN')}</span>
                                            </div>
                                        </div>

                                        <div className="alliance-admin-actions">
                                            <button
                                                onClick={() => startEditAlliance(alliance)}
                                                className="btn btn-primary"
                                            >
                                                编辑
                                            </button>
                                            <button
                                                onClick={() => deleteAlliance(alliance._id, alliance.name)}
                                                className="btn btn-danger"
                                            >
                                                删除
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}

                        {adminAlliances.length === 0 && (
                            <div className="empty-alliances-admin">
                                <p>{isAdminAllianceLoading ? '加载中...' : '暂无熵盟'}</p>
                            </div>
                        )}
                    </div>
                    <div className="alliances-admin-pagination">
                        <div className="alliances-admin-page-info">
                            {isAdminAllianceLoading
                                ? '加载中...'
                                : `第 ${adminAlliancePagination.page} / ${Math.max(1, adminAlliancePagination.totalPages || 1)} 页`}
                        </div>
                        <div className="alliances-admin-page-actions">
                            <button
                                type="button"
                                className="btn btn-small btn-secondary"
                                onClick={() => fetchAdminAlliances(adminAlliancePagination.page - 1)}
                                disabled={isAdminAllianceLoading || adminAlliancePagination.page <= 1}
                            >
                                上一页
                            </button>
                            <button
                                type="button"
                                className="btn btn-small btn-secondary"
                                onClick={() => fetchAdminAlliances(adminAlliancePagination.page + 1)}
                                disabled={isAdminAllianceLoading || (adminAlliancePagination.totalPages > 0 && adminAlliancePagination.page >= adminAlliancePagination.totalPages)}
                            >
                                下一页
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showAllianceMemberModal && editingAlliance && (
                <div className="modal-backdrop" onClick={closeAllianceMemberModal}>
                    <div className="modal-content alliance-member-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>成员编辑：{editingAlliance.name}</h3>
                            <button className="btn-close" onClick={closeAllianceMemberModal}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="alliance-member-modal-section">
                                <label>已选成员（{allianceMemberDraft.length}）</label>
                                <div className="alliance-member-selected-list">
                                    {allianceMemberDraft.length > 0 ? (
                                        allianceMemberDraft.map((member) => (
                                            <div key={`alliance_member_draft_${member._id}`} className="alliance-member-selected-item">
                                                <div className="alliance-member-selected-main">
                                                    <span className="alliance-member-selected-name">
                                                        {member.username || '未知成员'}
                                                        {member.isFounder ? '（盟主）' : ''}
                                                    </span>
                                                    <span className="alliance-member-selected-meta">
                                                        Lv.{Number.isFinite(Number(member.level)) ? Number(member.level) : 0}
                                                        {member.profession ? ` · ${member.profession}` : ''}
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-secondary"
                                                    onClick={() => removeAllianceMemberDraftUser(member._id)}
                                                    disabled={member.isFounder}
                                                >
                                                    移除
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="alliance-member-empty">暂无成员</div>
                                    )}
                                </div>
                            </div>

                            <div className="alliance-member-modal-section">
                                <label>搜索添加成员</label>
                                <div className="search-input-group">
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="输入用户名/职业（回车搜索）"
                                        value={allianceMemberSearchKeyword}
                                        onChange={(e) => {
                                            setAllianceMemberSearchKeyword(e.target.value);
                                            setHasAllianceMemberSearchTriggered(false);
                                            setAllianceMemberSearchResults([]);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                searchAllianceMemberCandidates(allianceMemberSearchKeyword);
                                            }
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={() => searchAllianceMemberCandidates(allianceMemberSearchKeyword)}
                                        disabled={!allianceMemberSearchKeyword.trim()}
                                    >
                                        <Search size={16} />
                                    </button>
                                </div>
                                {(isAllianceMemberSearchLoading || hasAllianceMemberSearchTriggered) && (
                                    <div className="alliance-member-search-results">
                                        {isAllianceMemberSearchLoading ? (
                                            <div className="alliance-member-search-status">搜索中...</div>
                                        ) : allianceMemberSearchResults.length > 0 ? (
                                            allianceMemberSearchResults.map((user) => {
                                                const isSelected = allianceMemberDraft.some((item) => item._id === user._id);
                                                return (
                                                    <div key={`alliance_member_search_${user._id}`} className="alliance-member-search-item">
                                                        <div className="alliance-member-search-main">
                                                            <span className="alliance-member-search-name">{user.username || '未知成员'}</span>
                                                            <span className="alliance-member-search-meta">
                                                                Lv.{Number.isFinite(Number(user.level)) ? Number(user.level) : 0}
                                                                {user.profession ? ` · ${user.profession}` : ''}
                                                                {user.allianceName ? ` · 当前熵盟: ${user.allianceName}` : ''}
                                                            </span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="btn btn-small btn-secondary"
                                                            onClick={() => addAllianceMemberDraftUser(user)}
                                                            disabled={isSelected}
                                                        >
                                                            {isSelected ? '已添加' : '添加'}
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="alliance-member-search-status">未找到匹配成员</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeAllianceMemberModal}>
                                取消
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={confirmAllianceMemberDraft}
                                disabled={allianceMemberDraft.length === 0 || isAllianceMemberLoading}
                            >
                                确认成员变更
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showEditNodeModal && editingNode && (
                <div className="modal-backdrop" onClick={closeEditNodeModal}>
                    <div className="modal-content admin-edit-domain-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>编辑知识域标题</h3>
                            <button className="btn-close" onClick={closeEditNodeModal} disabled={isSavingNodeEdit}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>标题</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={editNodeForm.name}
                                    onChange={(e) => setEditNodeForm((prev) => ({ ...prev, name: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label>概述</label>
                                <textarea
                                    className="form-textarea"
                                    rows={4}
                                    value={editNodeForm.description}
                                    onChange={(e) => setEditNodeForm((prev) => ({ ...prev, description: e.target.value }))}
                                />
                            </div>
                            <div className="admin-modal-grid-fields">
                                <label>
                                    知识点
                                    <input
                                        type="number"
                                        className="edit-input"
                                        value={editNodeForm.knowledgePoint}
                                        onChange={(e) => setEditNodeForm((prev) => ({ ...prev, knowledgePoint: e.target.value }))}
                                    />
                                </label>
                                <label>
                                    繁荣度
                                    <input
                                        type="number"
                                        className="edit-input"
                                        value={editNodeForm.prosperity}
                                        onChange={(e) => setEditNodeForm((prev) => ({ ...prev, prosperity: e.target.value }))}
                                    />
                                </label>
                                <label>
                                    内容分数
                                    <input
                                        type="number"
                                        className="edit-input"
                                        value={editNodeForm.contentScore}
                                        onChange={(e) => setEditNodeForm((prev) => ({ ...prev, contentScore: e.target.value }))}
                                    />
                                </label>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeEditNodeModal} disabled={isSavingNodeEdit}>取消</button>
                            <button className="btn btn-primary" onClick={() => saveNodeEdit(editingNode)} disabled={isSavingNodeEdit}>
                                {isSavingNodeEdit ? '保存中...' : '保存标题'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showAddSenseModal && addingSenseNode && (
                <div className="modal-backdrop" onClick={closeAddSenseModal}>
                    <div className="modal-content admin-add-sense-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>新增释义：{addingSenseNode.name}</h3>
                            <button className="btn-close" onClick={closeAddSenseModal} disabled={isSavingNewSense}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>释义题目</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={newSenseForm.title}
                                    onChange={(e) => setNewSenseForm((prev) => ({ ...prev, title: e.target.value }))}
                                    placeholder="同一知识域下不可重名"
                                />
                                {String(newSenseForm.title || '').trim() === '' && (
                                    <span className="error-text inline-field-error">释义题目不能为空</span>
                                )}
                            </div>
                            <div className="form-group">
                                <label>释义内容</label>
                                <textarea
                                    className="form-textarea"
                                    rows={4}
                                    value={newSenseForm.content}
                                    onChange={(e) => setNewSenseForm((prev) => ({ ...prev, content: e.target.value }))}
                                />
                                {String(newSenseForm.content || '').trim() === '' && (
                                    <span className="error-text inline-field-error">释义内容不能为空</span>
                                )}
                            </div>

                            <div className="admin-add-sense-relations">
                                <div className="admin-add-sense-relations-header">
                                    <h4>关联管理</h4>
                                    <span>已添加 {newSenseForm.relations.length} 条</span>
                                </div>

                                <div className="admin-add-sense-added-relations">
                                    {newSenseForm.relations.length > 0 ? (
                                        newSenseForm.relations.map((relation) => (
                                            <div key={relation.id} className="admin-add-sense-relation-item">
                                                {relation.kind === ASSOC_RELATION_TYPES.INSERT ? (
                                                    <span>
                                                        插入：{relation.leftTarget?.displayName || '未知'} {relation.direction === ASSOC_RELATION_TYPES.EXTENDS ? REL_SYMBOL_SUBSET : REL_SYMBOL_SUPERSET} 当前释义 {relation.direction === ASSOC_RELATION_TYPES.EXTENDS ? REL_SYMBOL_SUBSET : REL_SYMBOL_SUPERSET} {relation.rightTarget?.displayName || '未知'}
                                                    </span>
                                                ) : (
                                                    <span>
                                                        当前释义 {relation.relationType === ASSOC_RELATION_TYPES.CONTAINS ? REL_SYMBOL_SUPERSET : REL_SYMBOL_SUBSET} {relation.target?.displayName || '未知'}
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    className="btn btn-danger btn-small"
                                                    onClick={() => removeRelationFromNewSense(relation.id)}
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="admin-add-sense-empty-relations">当前还没有关联关系</p>
                                    )}
                                </div>

                                {newSenseAssocFlow.currentStep ? (
                                    <AssociationAddFlowEditor
                                        steps={ASSOC_STEPS}
                                        relationTypes={ASSOC_RELATION_TYPES}
                                        relSymbolSubset={REL_SYMBOL_SUBSET}
                                        relSymbolSuperset={REL_SYMBOL_SUPERSET}
                                        currentStep={newSenseAssocFlow.currentStep}
                                        selectedRelationType={newSenseAssocFlow.selectedRelationType}
                                        sourceDisplay={newSenseAssocSourceDisplay}
                                        targetDisplay={newSenseAssocTargetDisplay}
                                        secondTargetDisplay={newSenseAssocSecondTargetDisplay}
                                        nodeASenseOptions={newSenseAssocNodeASenseOptions}
                                        selectedNodeASenseId={newSenseAssocFlow.selectedNodeASenseId}
                                        insertDirection={newSenseAssocFlow.insertDirection}
                                        insertRelationAvailable={newSenseAssocInsertRelationAvailable}
                                        insertRelationUnavailableReason={newSenseAssocInsertRelationUnavailableReason}
                                        nodeASearchKeyword={newSenseAssocFlow.searchKeyword}
                                        nodeASearchAppliedKeyword={newSenseAssocFlow.searchAppliedKeyword}
                                        nodeASearchLoading={newSenseAssocFlow.searchLoading}
                                        nodeASearchResults={newSenseAssocFlow.searchResults}
                                        nodeBSearchAppliedKeyword={newSenseAssocFlow.nodeBSearchAppliedKeyword}
                                        nodeBSearchLoading={false}
                                        nodeBCandidatesParents={newSenseAssocNodeBCandidateView.parents}
                                        nodeBCandidatesChildren={newSenseAssocNodeBCandidateView.children}
                                        previewCanvasRef={newSenseAssocPreviewCanvasRef}
                                        previewInfoText={newSenseAssocPreviewInfoText}
                                        onNodeASearchKeywordChange={(keyword) => {
                                            setNewSenseAssocFlow((prev) => ({ ...prev, searchKeyword: keyword }));
                                        }}
                                        onSubmitNodeASearch={() => searchNewSenseAssocNodeA(newSenseAssocFlow.searchKeyword)}
                                        onClearNodeASearch={clearNewSenseAssocNodeASearch}
                                        onSelectNodeA={selectNewSenseAssocNodeA}
                                        onChangeNodeASenseId={handleNewSenseAssocNodeASenseChange}
                                        onSelectRelationType={selectNewSenseAssocRelationType}
                                        onSubmitNodeBSearch={submitNewSenseAssocNodeBSearch}
                                        onSelectNodeBParent={(node) => selectNewSenseAssocNodeB(node, true)}
                                        onSelectNodeBChild={(node) => selectNewSenseAssocNodeB(node, false)}
                                        onConfirm={confirmNewSenseAssocRelation}
                                        onBack={goBackNewSenseAssocStep}
                                        onCancel={cancelNewSenseAssocFlow}
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        className="btn btn-primary admin-add-association-btn"
                                        onClick={startNewSenseRelationEditor}
                                    >
                                        <Plus className="icon-small" /> 添加关联
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeAddSenseModal} disabled={isSavingNewSense}>取消</button>
                            <button className="btn btn-primary" onClick={saveNewSense} disabled={isSavingNewSense}>
                                {isSavingNewSense ? '保存中...' : '确认新增释义'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeleteSenseModal && deletingSenseContext?.node && deletingSenseContext?.sense && (
                <div className="modal-backdrop" onClick={closeDeleteSenseModal}>
                    <div className="modal-content admin-delete-domain-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>删除释义确认：{deletingSenseContext.sense.title}</h3>
                            <button className="btn-close" onClick={closeDeleteSenseModal}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <p className="admin-delete-domain-hint">
                                删除后将清理该释义全部关联。请先查看删除前/删除后关联变化并确认承接策略。
                            </p>

                            <div className="admin-delete-domain-total-preview">
                                <span>删除前关联总数：{deleteSenseBeforeRelations.length}</span>
                                <span>删除后关联总数：{deleteSenseAfterRelations.length}</span>
                            </div>

                            {deleteSensePreviewLoading && (
                                <div className="admin-delete-domain-loading">正在计算删除前后关联预览...</div>
                            )}

                            <div className="admin-delete-domain-before-after-grid global">
                                <div className="admin-delete-domain-before-after-block before">
                                    <h6>删除前</h6>
                                    <div className="admin-delete-domain-assoc-list">
                                        {deleteSenseBeforeRelations.length > 0 ? (
                                            deleteSenseBeforeRelations.map((line, index) => (
                                                <span key={`del_sense_before_${index}`} className="admin-delete-domain-assoc-chip outgoing">
                                                    {`${line.source?.displayName || '未知释义'} ${formatRelationArrowText(line.relationType)} ${line.target?.displayName || '未知释义'}`}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="admin-delete-domain-assoc-empty">删除前无关联</span>
                                        )}
                                    </div>
                                </div>
                                <div className="admin-delete-domain-before-after-block after">
                                    <h6>删除后</h6>
                                    <div className="admin-delete-domain-assoc-list">
                                        {deleteSenseAfterRelations.length > 0 ? (
                                            deleteSenseAfterRelations.map((line, index) => (
                                                <span key={`del_sense_after_${index}`} className="admin-delete-domain-assoc-chip incoming">
                                                    {`${line.source?.displayName || '未知释义'} ${formatRelationArrowText(line.relationType)} ${line.target?.displayName || '未知释义'}`}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="admin-delete-domain-assoc-empty">删除后未保留该释义关联</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {deleteSenseLostBridgePairs.length > 0 && (
                                <div className="admin-delete-bridge-decision-section">
                                    <h6>关联关系逐条处理</h6>
                                    <p className="admin-assoc-step-description" style={{ marginBottom: '0.45rem' }}>
                                        左侧是待处理关系，右侧是已确认的新关系。点击左侧任一关系进入二级弹窗并完成处理。
                                    </p>
                                    <div className="admin-delete-sense-decision-workspace">
                                        <div className="admin-delete-sense-decision-column">
                                            <div className="admin-delete-sense-decision-column-header">
                                                待处理关系（{deleteSensePendingBridgePairs.length}）
                                            </div>
                                            <div className="admin-delete-sense-decision-list">
                                                {deleteSensePendingBridgePairs.length > 0 ? (
                                                    deleteSensePendingBridgePairs.map((pair, index) => {
                                                        const pairKey = String(pair?.pairKey || '').trim();
                                                        const mode = resolveDeleteBridgePairMode(pair, deleteSenseBeforeRelations);
                                                        const modeText = mode === ASSOC_RELATION_TYPES.EXTENDS
                                                            ? '上级关系'
                                                            : (mode === ASSOC_RELATION_TYPES.CONTAINS ? '下级关系' : '插入关系');
                                                        const upperDisplay = resolveDecisionPairSideDisplay(pair, 'upper');
                                                        const sourceDisplay = resolveDecisionCurrentDisplay(
                                                            deletingSenseContext.node,
                                                            pair?.sourceSenseId || '',
                                                            deletingSenseContext?.node?.name || '当前标题'
                                                        );
                                                        const lowerDisplay = resolveDecisionPairSideDisplay(pair, 'lower');
                                                        return (
                                                            <button
                                                                key={pairKey || `del_sense_pending_${index}`}
                                                                type="button"
                                                                className="admin-delete-sense-decision-item pending"
                                                                onClick={() => openDeleteSenseDecisionModal(pair)}
                                                                disabled={!pairKey || deleteSensePreviewLoading || isDeletingSense}
                                                            >
                                                                <span className={`admin-edit-relation-badge ${mode}`}>{modeText}</span>
                                                                <span className="line">{`${upperDisplay} ⇢ ${sourceDisplay} ⇢ ${lowerDisplay}`}</span>
                                                            </button>
                                                        );
                                                    })
                                                ) : (
                                                    <div className="admin-delete-sense-decision-empty">待处理关系已全部确认</div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="admin-delete-sense-decision-column confirmed">
                                            <div className="admin-delete-sense-decision-column-header">
                                                已确认新关系（{deleteSenseConfirmedBridgePairs.length}）
                                            </div>
                                            <div className="admin-delete-sense-decision-list">
                                                {deleteSenseConfirmedBridgePairs.length > 0 ? (
                                                    deleteSenseConfirmedBridgePairs.map((pair, index) => {
                                                        const pairKey = String(pair?.pairKey || '').trim();
                                                        const mode = resolveDeleteBridgePairMode(pair, deleteSenseBeforeRelations);
                                                        const modeText = mode === ASSOC_RELATION_TYPES.EXTENDS
                                                            ? '上级关系'
                                                            : (mode === ASSOC_RELATION_TYPES.CONTAINS ? '下级关系' : '插入关系');
                                                        const upperDisplay = resolveDecisionPairSideDisplay(pair, 'upper');
                                                        const sourceDisplay = resolveDecisionCurrentDisplay(
                                                            deletingSenseContext.node,
                                                            pair?.sourceSenseId || '',
                                                            deletingSenseContext?.node?.name || '当前标题'
                                                        );
                                                        const lowerDisplay = resolveDecisionPairSideDisplay(pair, 'lower');
                                                        const afterText = pair.action === 'reconnect'
                                                            ? `${upperDisplay} ⇢ ${lowerDisplay}`
                                                            : `${upperDisplay} ✕ ${lowerDisplay}`;
                                                        const afterClassName = pair.action === 'reconnect' ? 'reconnect' : 'disconnect';
                                                        return (
                                                            <div key={pairKey || `del_sense_confirmed_${index}`} className="admin-delete-sense-decision-item confirmed">
                                                                <div className="admin-delete-sense-decision-line">
                                                                    <span className={`admin-edit-relation-badge ${mode}`}>{modeText}</span>
                                                                    <span className="line">{`${upperDisplay} ⇢ ${sourceDisplay} ⇢ ${lowerDisplay}`}</span>
                                                                </div>
                                                                <div className={`admin-delete-sense-decision-result ${afterClassName}`}>
                                                                    {`删除后：${afterText}`}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-small btn-secondary"
                                                                    onClick={() => rollbackDeleteSensePairDecision(pairKey)}
                                                                    disabled={deleteSensePreviewLoading || isDeletingSense}
                                                                >
                                                                    撤回到待处理
                                                                </button>
                                                            </div>
                                                        );
                                                    })
                                                ) : (
                                                    <div className="admin-delete-sense-decision-empty">尚未确认任何关系</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {(deleteSensePreviewData?.unresolvedBridgeDecisionCount || 0) > 0 && (
                                        <p className="admin-assoc-step-description" style={{ marginTop: '0.55rem', color: '#fca5a5' }}>
                                            尚有 {deleteSensePreviewData.unresolvedBridgeDecisionCount} 组未完成处理，确认删除按钮不会点亮。
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeDeleteSenseModal} disabled={isDeletingSense}>取消</button>
                            <button
                                className="btn btn-danger"
                                onClick={deleteSense}
                                disabled={
                                    isDeletingSense
                                    || deleteSensePreviewLoading
                                    || deleteSensePendingBridgePairs.length > 0
                                    || (deleteSensePreviewData?.unresolvedBridgeDecisionCount || 0) > 0
                                }
                            >
                                {isDeletingSense ? '删除中...' : '确认删除释义'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeleteSenseDecisionModal && deleteSenseDecisionPair && deletingSenseContext?.node && (
                <div className="modal-backdrop" onClick={closeDeleteSenseDecisionModal}>
                    <div className="modal-content admin-assoc-delete-decision-modal admin-delete-sense-decision-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>处理关联关系</h3>
                            <button
                                className="btn-close"
                                onClick={closeDeleteSenseDecisionModal}
                                disabled={deleteSenseDecisionApplying}
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            {(() => {
                                const mode = resolveDeleteBridgePairMode(deleteSenseDecisionPair, deleteSenseBeforeRelations);
                                const upperDisplay = resolveDecisionPairSideDisplay(deleteSenseDecisionPair, 'upper');
                                const sourceDisplay = resolveDecisionCurrentDisplay(
                                    deletingSenseContext.node,
                                    deleteSenseDecisionPair?.sourceSenseId || '',
                                    deletingSenseContext?.node?.name || '当前标题'
                                );
                                const lowerDisplay = resolveDecisionPairSideDisplay(deleteSenseDecisionPair, 'lower');
                                const reconnectTitle = mode === ASSOC_RELATION_TYPES.INSERT ? '两端直连' : '保留承接';
                                const reconnectHint = mode === ASSOC_RELATION_TYPES.INSERT
                                    ? '删除后，原上下级释义恢复直接关联'
                                    : '删除后，保持上下级之间承接';
                                const disconnectTitle = mode === ASSOC_RELATION_TYPES.INSERT ? '两端不连' : '断开独立';
                                const disconnectHint = mode === ASSOC_RELATION_TYPES.INSERT
                                    ? '删除后，原上下级释义不再直连'
                                    : '删除后，不保留上下级承接';
                                return (
                                    <>
                                        <p className="admin-assoc-step-description">
                                            当前关系：<strong>{`${upperDisplay} ⇢ ${sourceDisplay} ⇢ ${lowerDisplay}`}</strong>
                                        </p>
                                        <div className="admin-assoc-delete-impact-item admin-delete-bridge-impact-item">
                                            <div className="admin-assoc-delete-impact-line before">
                                                <span className="label">删除前</span>
                                                <span className="diagram">{`${upperDisplay} ⇢ ${sourceDisplay} ⇢ ${lowerDisplay}`}</span>
                                            </div>
                                            <div className="admin-assoc-delete-impact-line after pending">
                                                <span className="label">删除后</span>
                                                <span className="diagram">待选择：点下方任一选项后立即生效</span>
                                            </div>
                                        </div>
                                        <div className="admin-assoc-delete-option-grid admin-delete-bridge-option-grid">
                                            <button
                                                type="button"
                                                className="admin-assoc-delete-option"
                                                onClick={() => applyDeleteSensePairDecision('reconnect')}
                                                disabled={deleteSenseDecisionApplying || deleteSensePreviewLoading || isDeletingSense}
                                            >
                                                <strong>{reconnectTitle}</strong>
                                                <small>{reconnectHint}</small>
                                            </button>
                                            <button
                                                type="button"
                                                className="admin-assoc-delete-option"
                                                onClick={() => applyDeleteSensePairDecision('disconnect')}
                                                disabled={deleteSenseDecisionApplying || deleteSensePreviewLoading || isDeletingSense}
                                            >
                                                <strong>{disconnectTitle}</strong>
                                                <small>{disconnectHint}</small>
                                            </button>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {showDeleteNodeConfirmModal && deletingNodeTarget && (
                <div className="modal-backdrop" onClick={closeDeleteNodeConfirmModal}>
                    <div className="modal-content admin-delete-domain-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>删除标题确认：{deletingNodeTarget.name}</h3>
                            <button className="btn-close" onClick={closeDeleteNodeConfirmModal}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <p className="admin-delete-domain-hint">
                                删除标题会同时删除该标题下全部释义，并清理它们的关联关系。下面是删除前/删除后关联预览。
                            </p>

                            <div className="admin-delete-domain-total-preview">
                                <span>删除前关联总数：{deletePreviewSummary ? deleteBeforeRelations.length : deletingNodePreview.totalBeforeCount}</span>
                                <span>删除后关联总数：{deletePreviewSummary ? deleteAfterRelations.length : deletingNodePreview.totalAfterCount}</span>
                            </div>

                            {deletePreviewLoading && (
                                <div className="admin-delete-domain-loading">正在计算删除前后关联预览...</div>
                            )}

                            <div className="admin-delete-domain-before-after-grid global">
                                <div className="admin-delete-domain-before-after-block before">
                                    <h6>删除前</h6>
                                    <div className="admin-delete-domain-assoc-list">
                                        {(deletePreviewSummary ? deleteBeforeRelations : []).length > 0 ? (
                                            (deletePreviewSummary ? deleteBeforeRelations : []).map((line, index) => (
                                                <span key={`del_before_${index}`} className="admin-delete-domain-assoc-chip outgoing">
                                                    {`${line.source?.displayName || '未知释义'} ${formatRelationArrowText(line.relationType)} ${line.target?.displayName || '未知释义'}`}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="admin-delete-domain-assoc-empty">删除前无关联</span>
                                        )}
                                    </div>
                                </div>
                                <div className="admin-delete-domain-before-after-block after">
                                    <h6>删除后</h6>
                                    <div className="admin-delete-domain-assoc-list">
                                        {(deletePreviewSummary ? deleteAfterRelations : []).length > 0 ? (
                                            (deletePreviewSummary ? deleteAfterRelations : []).map((line, index) => (
                                                <span key={`del_after_${index}`} className="admin-delete-domain-assoc-chip incoming">
                                                    {`${line.source?.displayName || '未知释义'} ${formatRelationArrowText(line.relationType)} ${line.target?.displayName || '未知释义'}`}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="admin-delete-domain-assoc-empty">删除后该标题释义已移除，未保留关联</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {renderDeleteBridgeDecisionSection({
                                pairs: deleteLostBridgePairs,
                                beforeRelations: deleteBeforeRelations,
                                decisionMap: deleteBridgeDecisions,
                                unresolvedCount: deletePreviewData?.unresolvedBridgeDecisionCount || 0,
                                sourceNode: deletingNodeTarget,
                                loading: deletePreviewLoading,
                                deleting: isDeletingNode,
                                onDecision: handleDeleteNodeBridgeDecision
                            })}

                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeDeleteNodeConfirmModal} disabled={isDeletingNode}>
                                取消
                            </button>
                            <button
                                className="btn btn-danger"
                                onClick={deleteNode}
                                disabled={isDeletingNode || deletePreviewLoading || (deletePreviewData?.unresolvedBridgeDecisionCount || 0) > 0}
                            >
                                {isDeletingNode ? '删除中...' : '确认删除标题'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Change Master Modal */}
            {showChangeMasterModal && changingMasterNode && (
                <div className="modal-backdrop" onClick={() => setShowChangeMasterModal(false)}>
                    <div className="modal-content change-master-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>更换域主: {changingMasterNode.name}</h3>
                            <button className="btn-close" onClick={() => setShowChangeMasterModal(false)}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>当前域主: {changingMasterNode.domainMaster?.username || '无'}</label>
                            </div>
                            <div className="form-group">
                                <label>搜索新域主:</label>
                                <div className="change-master-search-wrap">
                                    <div className="search-input-group">
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="输入用户名..."
                                            value={masterSearchKeyword}
                                            onChange={(e) => {
                                                const nextKeyword = e.target.value;
                                                setMasterSearchKeyword(nextKeyword);
                                                setMasterSearchResults([]);
                                                setHasMasterSearchTriggered(false);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    searchUsersForMaster(masterSearchKeyword);
                                                }
                                            }}
                                        />
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => searchUsersForMaster(masterSearchKeyword)}
                                            disabled={!masterSearchKeyword.trim()}
                                        >
                                            <Search size={16} />
                                        </button>
                                    </div>
                                    {(isMasterSearchLoading || masterSearchResults.length > 0 || hasMasterSearchTriggered) && (
                                        <div className="change-master-search-dropdown">
                                            {isMasterSearchLoading ? (
                                                <div className="change-master-search-status">搜索中...</div>
                                            ) : masterSearchResults.length > 0 ? (
                                                masterSearchResults.map(user => (
                                                    <div
                                                        key={user._id}
                                                        className={`search-result-item ${selectedNewMaster?._id === user._id ? 'selected' : ''}`}
                                                        onClick={() => setSelectedNewMaster(user)}
                                                    >
                                                        <span>{user.username}</span>
                                                        {selectedNewMaster?._id === user._id && <Check size={16} className="text-green-500" />}
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="change-master-search-status">未找到匹配用户</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="form-group">
                                <label>已选择: {selectedNewMaster ? selectedNewMaster.username : '未选择 (将清除域主)'}</label>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowChangeMasterModal(false)}>取消</button>
                            <button className="btn btn-primary" onClick={confirmChangeMaster}>确认更换</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Association Modal */}
            {showEditAssociationModal && editingAssociationNode && (
                <div className="modal-backdrop">
                    <div className="modal-content admin-edit-association-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>编辑释义关联: {formatNodeSenseDisplay(editingAssociationNode, editingAssociationSenseId)}</h3>
                            <button className="btn-close" onClick={closeEditAssociationModal}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="admin-edit-associations-section">
                                <div
                                    className="admin-edit-associations-header"
                                    onClick={() => setIsEditAssociationListExpanded(!isEditAssociationListExpanded)}
                                >
                                    <h4>
                                        释义关联关系
                                        <span className="association-count">
                                            ({editAssociations.filter((item) => !item?.pendingRemoval).length}/{editAssociations.length})
                                        </span>
                                    </h4>
                                    {isEditAssociationListExpanded ? <ChevronUp className="icon-small" /> : <ChevronDown className="icon-small" />}
                                </div>

                                {isEditAssociationListExpanded && editAssociations.length > 0 && (
                                    <div className="admin-edit-associations-list">
                                        {editAssociations.map((association, index) => {
                                            const isPendingRemoval = !!association?.pendingRemoval;
                                            const isUnsavedNew = !!association?.isNewDraft && !isPendingRemoval;
                                            const pendingDecisionLines = Array.isArray(association?.pendingDecisionLines)
                                                ? association.pendingDecisionLines
                                                : [];
                                            const displayAssociationType = resolveAssociationDisplayType(association);
                                            return (
                                                <div
                                                    key={index}
                                                    className={`admin-edit-association-item ${isPendingRemoval ? 'pending-removal' : 'clickable'}`}
                                                    onClick={() => {
                                                        if (isPendingRemoval) return;
                                                        editExistingAssociation(index);
                                                    }}
                                                >
                                                    <div className="admin-edit-association-info">
                                                        <span className={`admin-edit-association-display ${isPendingRemoval ? 'pending-removal' : ''}`}>
                                                            {association.displayText}
                                                        </span>
                                                        <span className={`admin-edit-relation-badge ${displayAssociationType} ${isPendingRemoval ? 'pending-removal' : ''}`}>
                                                            {isPendingRemoval
                                                                ? '待删除'
                                                                : (
                                                                    displayAssociationType === ASSOC_RELATION_TYPES.EXTENDS
                                                                        ? REL_SYMBOL_SUPERSET
                                                                        : (displayAssociationType === ASSOC_RELATION_TYPES.CONTAINS ? REL_SYMBOL_SUBSET : '插入')
                                                                )}
                                                        </span>
                                                        {isUnsavedNew && (
                                                            <span className="admin-edit-relation-badge new">
                                                                新增
                                                            </span>
                                                        )}
                                                        {isPendingRemoval && pendingDecisionLines.length > 0 && (
                                                            <div className="admin-edit-association-pending-result">
                                                                {pendingDecisionLines.map((line, lineIndex) => (
                                                                    <div
                                                                        key={`assoc_pending_${index}_${lineIndex}`}
                                                                        className="admin-edit-association-pending-line"
                                                                    >
                                                                        {line}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="admin-edit-association-actions">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                removeEditAssociation(index);
                                                            }}
                                                            className={`btn btn-small ${isPendingRemoval || isUnsavedNew ? 'btn-secondary' : 'btn-danger'}`}
                                                            disabled={assocCurrentStep !== null}
                                                        >
                                                            {isPendingRemoval || isUnsavedNew ? '撤回' : <X className="icon-small" />}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {assocCurrentStep ? (
                                    <AssociationAddFlowEditor
                                        steps={ASSOC_STEPS}
                                        relationTypes={ASSOC_RELATION_TYPES}
                                        relSymbolSubset={REL_SYMBOL_SUBSET}
                                        relSymbolSuperset={REL_SYMBOL_SUPERSET}
                                        currentStep={assocCurrentStep}
                                        selectedRelationType={assocSelectedRelationType}
                                        sourceDisplay={formatNodeSenseDisplay(editingAssociationNode, assocSelectedSourceSenseId || editingAssociationSenseId)}
                                        targetDisplay={formatNodeSenseDisplay(assocSelectedNodeA, assocSelectedNodeASenseId)}
                                        secondTargetDisplay={formatNodeSenseDisplay(assocSelectedNodeB, assocSelectedNodeBSenseId)}
                                        nodeASenseOptions={assocNodeASenseOptions}
                                        selectedNodeASenseId={assocSelectedNodeASenseId}
                                        insertDirection={assocInsertDirection}
                                        insertRelationAvailable={assocInsertRelationAvailable}
                                        insertRelationUnavailableReason={assocInsertRelationUnavailableReason}
                                        nodeASearchKeyword={assocSearchKeyword}
                                        nodeASearchAppliedKeyword={assocSearchAppliedKeyword}
                                        nodeASearchLoading={assocSearchLoading}
                                        nodeASearchResults={assocSearchResults}
                                        nodeBSearchAppliedKeyword={assocNodeBSearchAppliedKeyword}
                                        nodeBSearchLoading={false}
                                        nodeBCandidatesParents={assocNodeBView.parents}
                                        nodeBCandidatesChildren={assocNodeBView.children}
                                        previewCanvasRef={assocPreviewCanvasRef}
                                        previewInfoText={assocPreviewInfoText}
                                        onNodeASearchKeywordChange={setAssocSearchKeyword}
                                        onSubmitNodeASearch={() => searchAssociationNodes(assocSearchKeyword)}
                                        onClearNodeASearch={clearAssocNodeASearch}
                                        onSelectNodeA={selectAssocNodeA}
                                        onChangeNodeASenseId={handleAssocNodeASenseChange}
                                        onSelectRelationType={selectAssocRelationType}
                                        onSubmitNodeBSearch={(keyword) => submitAssocNodeBSearch(keyword ?? assocNodeBSearchKeyword)}
                                        onSelectNodeBParent={(node) => selectAssocNodeB(node, true)}
                                        onSelectNodeBChild={(node) => selectAssocNodeB(node, false)}
                                        onConfirm={confirmEditAssociation}
                                        onBack={goBackAssocStep}
                                        onCancel={resetAssociationEditor}
                                    />
                                ) : (
                                    <button onClick={startAddEditAssociation} className="btn btn-primary admin-add-association-btn">
                                        <Plus className="icon-small" /> 添加关联
                                    </button>
                                )}
                            </div>

                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeEditAssociationModal}>取消</button>
                            <button
                                className="btn btn-primary"
                                onClick={saveAssociationEdit}
                                disabled={
                                    assocCurrentStep !== null
                                    || assocApplyLoading
                                }
                            >
                                {assocApplyLoading ? '保存中...' : '应用更改'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showAssocDeleteDecisionModal && assocDeleteDecisionContext && (
                <div className="modal-backdrop">
                    <div className="modal-content admin-assoc-delete-decision-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>删除关联决策</h3>
                            <button
                                className="btn-close"
                                onClick={closeAssocDeleteDecisionModal}
                                disabled={assocDeleteApplying}
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <p className="admin-assoc-step-description">
                                即将删除：<strong>{assocDeleteDecisionContext?.association?.displayText || ''}</strong>
                            </p>
                            <div className="admin-assoc-delete-option-grid">
                                <>
                                    <button
                                        type="button"
                                        className={`admin-assoc-delete-option ${assocDeleteDecisionAction === 'disconnect' ? 'active disconnect' : ''}`}
                                        onClick={() => setAssocDeleteDecisionAction('disconnect')}
                                        disabled={assocDeleteApplying}
                                    >
                                        <strong>直接删除</strong>
                                        <small>删除后，下级释义不改接新上级</small>
                                    </button>
                                    <button
                                        type="button"
                                        className={`admin-assoc-delete-option ${assocDeleteDecisionAction === 'reassign_upper' ? 'active reconnect' : ''}`}
                                        onClick={() => setAssocDeleteDecisionAction('reassign_upper')}
                                        disabled={assocDeleteApplying}
                                    >
                                        <strong>改接新上级</strong>
                                        <small>删除后，为该下级释义指定新的上级</small>
                                    </button>
                                </>
                            </div>

                            {Array.isArray(assocDeleteDecisionContext?.bridgeItems) && assocDeleteDecisionContext.bridgeItems.length > 0 ? (
                                <div className="admin-assoc-delete-impact-list">
                                    {assocDeleteDecisionContext.bridgeItems.map((item, index) => (
                                        <div key={item?.pairKey || `assoc_delete_bridge_${index}`} className="admin-assoc-delete-impact-item">
                                            {(() => {
                                                const upperDisplay = resolveDecisionPairSideDisplay(item, 'upper');
                                                const sourceDisplay = resolveDecisionCurrentDisplay(
                                                    editingAssociationNode,
                                                    item?.sourceSenseId || '',
                                                    editingAssociationNode?.name || '当前标题'
                                                );
                                                const lowerDisplay = resolveDecisionPairSideDisplay(item, 'lower');
                                                const isReassignUpper = assocDeleteDecisionAction === 'reassign_upper';
                                                const afterClassName = isReassignUpper
                                                    ? (assocDeleteSelectedTarget ? 'reconnect' : 'pending')
                                                    : 'disconnect';
                                                const afterText = isReassignUpper
                                                    ? (
                                                        assocDeleteSelectedTarget
                                                            ? `${assocDeleteReplacementDisplay} ⇢ ${lowerDisplay}`
                                                            : `待改接：${lowerDisplay}`
                                                    )
                                                    : `${upperDisplay} ✕ ${lowerDisplay}`;
                                                const afterHint = isReassignUpper
                                                    ? (assocDeleteSelectedTarget ? '删除后改接新上级' : '请先选择新的上级释义')
                                                    : '删除后不改接，保持断开';
                                                return (
                                                    <>
                                                        <div className="admin-assoc-delete-impact-line before">
                                                            <span className="label">删除前</span>
                                                            <span className="diagram">{`${upperDisplay} ⇢ ${sourceDisplay} ⇢ ${lowerDisplay}`}</span>
                                                        </div>
                                                        <div className={`admin-assoc-delete-impact-line after ${afterClassName}`}>
                                                            <span className="label">删除后</span>
                                                            <span className="diagram">{afterText}</span>
                                                            <span className="hint">{afterHint}</span>
                                                        </div>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="admin-assoc-step-description">该删除不会产生额外的链路承接冲突。</p>
                            )}

                            {shouldShowAssocDeleteSearch && (
                                <div className="admin-assoc-delete-search-panel">
                                    <h4>选择新的上级释义</h4>
                                    <p className="admin-assoc-step-description">仅在“改接新上级”模式下生效；不会显示当前释义和当前下级释义。</p>
                                    <div className="search-input-group">
                                        <div className="admin-assoc-search-input-wrap">
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder="搜索标题或释义题目（回车/搜索）"
                                                value={assocDeleteSearchKeyword}
                                                onChange={(e) => setAssocDeleteSearchKeyword(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        searchAssocDeleteTargets(assocDeleteSearchKeyword);
                                                    }
                                                }}
                                            />
                                            {!!assocDeleteSearchKeyword && (
                                                <button
                                                    type="button"
                                                    className="admin-assoc-search-clear"
                                                    onClick={() => {
                                                        assocDeleteSearchRequestIdRef.current += 1;
                                                        setAssocDeleteSearchKeyword('');
                                                        setAssocDeleteSearchAppliedKeyword('');
                                                        setAssocDeleteSearchResults([]);
                                                        setAssocDeleteSearchLoading(false);
                                                        setAssocDeleteSelectedTarget(null);
                                                    }}
                                                    aria-label="清空搜索"
                                                    disabled={assocDeleteApplying}
                                                >
                                                    X
                                                </button>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            onClick={() => searchAssocDeleteTargets(assocDeleteSearchKeyword)}
                                            disabled={assocDeleteSearchLoading || assocDeleteApplying}
                                        >
                                            <Search className="icon-small" />
                                            {assocDeleteSearchLoading ? '...' : '搜索'}
                                        </button>
                                    </div>
                                    {assocDeleteSearchAppliedKeyword && assocDeleteSearchResults.length === 0 && !assocDeleteSearchLoading && (
                                        <p className="admin-assoc-step-description">未找到可用上级释义。</p>
                                    )}
                                    {assocDeleteSearchResults.length > 0 && (
                                        <div className="admin-assoc-delete-search-results">
                                            {assocDeleteSearchResults.map((item) => (
                                                <div
                                                    key={item?.searchKey || `${item?.nodeId}:${item?.senseId}`}
                                                    className={`admin-assoc-delete-search-item ${assocDeleteSelectedTarget?.searchKey === item?.searchKey ? 'selected' : ''}`}
                                                    onClick={() => setAssocDeleteSelectedTarget(item)}
                                                >
                                                    <span>{item?.displayName || formatNodeSenseDisplay(item, item?.senseId || '')}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {assocDeleteSelectedTarget && (
                                        <p className="admin-assoc-step-description">
                                            已选择新上级：<strong>{formatNodeSenseDisplay(assocDeleteSelectedTarget, assocDeleteSelectedTarget?.senseId || '')}</strong>
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={closeAssocDeleteDecisionModal}
                                disabled={assocDeleteApplying}
                            >
                                取消
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={confirmAssocDeleteDecision}
                                disabled={assocDeleteApplying}
                            >
                                {assocDeleteApplying ? '处理中...' : '确认暂存删除'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminPanel;
