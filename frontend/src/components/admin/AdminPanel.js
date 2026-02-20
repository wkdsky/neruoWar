import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Users, Zap, Bell, Shield, Check, X, Search, Plus, AlertTriangle, ArrowLeft, ArrowRight, RotateCcw, ChevronDown, ChevronUp, Settings } from 'lucide-react';
import MiniPreviewRenderer from '../modals/MiniPreviewRenderer';
import './Admin.css';

const ASSOC_STEPS = {
    SELECT_NODE_A: 'select_node_a',
    SELECT_RELATION: 'select_relation',
    SELECT_NODE_B: 'select_node_b',
    PREVIEW: 'preview'
};

const ASSOC_RELATION_TYPES = {
    EXTENDS: 'extends',
    CONTAINS: 'contains',
    INSERT: 'insert'
};

const UNIT_TYPE_ID_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;

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

const AdminPanel = ({ initialTab = 'users', onPendingMasterApplyHandled }) => {
    const [adminTab, setAdminTab] = useState(initialTab);
    
    // User Management State
    const [allUsers, setAllUsers] = useState([]);
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

    // Node Management State
    const [allNodes, setAllNodes] = useState([]);
    const [editingNode, setEditingNode] = useState(null);
    const [editNodeForm, setEditNodeForm] = useState({
        name: '',
        description: '',
        prosperity: 0,
        resources: { food: 0, metal: 0, energy: 0 },
        productionRates: { food: 0, metal: 0, energy: 0 },
        contentScore: 1
    });
    const [showDeleteNodeConfirmModal, setShowDeleteNodeConfirmModal] = useState(false);
    const [deletingNodeTarget, setDeletingNodeTarget] = useState(null);
    const [isDeletingNode, setIsDeletingNode] = useState(false);
    const [deletePreviewData, setDeletePreviewData] = useState(null);
    const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
    const [deleteBridgeDecisions, setDeleteBridgeDecisions] = useState({});
    const [pendingNodes, setPendingNodes] = useState([]);
    const [pendingNodeActionId, setPendingNodeActionId] = useState('');
    const [pendingNodeActionGroupName, setPendingNodeActionGroupName] = useState('');
    const [pendingMasterApplications, setPendingMasterApplications] = useState([]);
    const [masterApplyActionId, setMasterApplyActionId] = useState('');

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
    const [selectedNewMaster, setSelectedNewMaster] = useState(null);

    // Alliance Management State
    const [adminAlliances, setAdminAlliances] = useState([]);
    const [editingAlliance, setEditingAlliance] = useState(null);
    const [editAllianceForm, setEditAllianceForm] = useState({
        name: '',
        flag: '',
        declaration: ''
    });

    // Association View/Edit State
    const [showAssociationModal, setShowAssociationModal] = useState(false);
    const [viewingAssociationNode, setViewingAssociationNode] = useState(null);
    
    const [showEditAssociationModal, setShowEditAssociationModal] = useState(false);
    const [editingAssociationNode, setEditingAssociationNode] = useState(null);
    const [editAssociations, setEditAssociations] = useState([]);
    const [assocSearchKeyword, setAssocSearchKeyword] = useState('');
    const [assocSearchResults, setAssocSearchResults] = useState([]);
    const [assocSearchLoading, setAssocSearchLoading] = useState(false);
    const [isEditAssociationListExpanded, setIsEditAssociationListExpanded] = useState(true);

    const [assocCurrentStep, setAssocCurrentStep] = useState(null);
    const [assocSelectedNodeA, setAssocSelectedNodeA] = useState(null);
    const [assocSelectedRelationType, setAssocSelectedRelationType] = useState(null);
    const [assocSelectedNodeB, setAssocSelectedNodeB] = useState(null);
    const [assocInsertDirection, setAssocInsertDirection] = useState(null);
    const [assocNodeBCandidates, setAssocNodeBCandidates] = useState({ parents: [], children: [] });
    const [assocNodeBSearchKeyword, setAssocNodeBSearchKeyword] = useState('');
    const [assocEditingIndex, setAssocEditingIndex] = useState(null);
    const [assocRemovalStrategy, setAssocRemovalStrategy] = useState('disconnect');
    const [assocMutationPreview, setAssocMutationPreview] = useState(null);
    const [assocPreviewLoading, setAssocPreviewLoading] = useState(false);
    const [assocApplyLoading, setAssocApplyLoading] = useState(false);
    const [assocBridgeDecisions, setAssocBridgeDecisions] = useState({});

    const assocPreviewCanvasRef = useRef(null);
    const assocPreviewRendererRef = useRef(null);

    // Initial Fetch
    useEffect(() => {
        fetchPendingNodes();
        fetchPendingMasterApplications();
        fetchAllUsers();
        fetchAllNodes();
        fetchAdminSettings();
        fetchArmyUnitTypes();
    }, []);

    // --- User Management Functions ---
    const fetchAllUsers = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/admin/users', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setAllUsers(data.users);
            }
        } catch (error) {
            console.error('获取用户列表失败:', error);
        }
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
            alert('等级必须是大于等于0的整数');
            return;
        }
        if (!Number.isInteger(parsedExperience) || parsedExperience < 0) {
            alert('经验值必须是大于等于0的整数');
            return;
        }
        if (!Number.isFinite(parsedKnowledgeBalance) || parsedKnowledgeBalance < 0) {
            alert('知识点余额必须是大于等于0的数字');
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
            if (response.ok) {
                alert('用户信息已更新');
                setEditingUser(null);
                fetchAllUsers();
            } else {
                const data = await response.json();
                alert(data.error || '更新失败');
            }
        } catch (error) {
            console.error('更新用户失败:', error);
            alert('更新失败');
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
                fetchAllUsers();
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
                let message = '节点审批通过';
                if (data.autoRejectedCount > 0) {
                    message += `，已自动拒绝 ${data.autoRejectedCount} 个同名申请`;
                }
                alert(message);
                fetchPendingNodes();
            } else {
                const data = await response.json();
                if ((data?.error || '').includes('已存在同名的审核通过节点')) {
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
                alert('节点已拒绝');
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

    const fetchAllNodes = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/nodes', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setAllNodes(data.nodes);
            }
        } catch (error) {
            console.error('获取节点列表失败:', error);
        }
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

    const relationTypeText = useCallback((relationType) => {
        if (relationType === ASSOC_RELATION_TYPES.CONTAINS) return '包含';
        if (relationType === ASSOC_RELATION_TYPES.EXTENDS) return '扩展';
        if (relationType === ASSOC_RELATION_TYPES.INSERT) return '插入';
        return '关联';
    }, []);

    const getSenseTitleById = useCallback((node, senseId) => {
        const key = typeof senseId === 'string' ? senseId.trim() : '';
        if (!key) return '';
        const matched = normalizeNodeSenses(node).find((sense) => sense.senseId === key);
        return matched?.title || key;
    }, [normalizeNodeSenses]);

    const nodeByIdMap = useMemo(() => {
        const map = new Map();
        allNodes.forEach((item) => {
            if (!item?._id) return;
            map.set(String(item._id), item);
        });
        return map;
    }, [allNodes]);

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

    const getNodeSenseAssociationSummary = useCallback((node, senseId) => {
        const localSenseId = typeof senseId === 'string' ? senseId.trim() : '';
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
                displayText: `${relationTypeText(assoc?.relationType)} → ${resolveAssociationTargetDisplay(assoc)}`
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
            displayText: `${item.sourceDisplayName} → ${relationTypeText(item.relationType)}`
        }));

        return {
            outgoing,
            incoming,
            all: [...outgoing, ...incoming]
        };
    }, [incomingAssociationMap, relationTypeText, resolveAssociationTargetDisplay]);

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
            description: node.description,
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
    };

    const saveNodeEdit = async (nodeId) => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editNodeForm)
            });
            if (response.ok) {
                alert('节点信息已更新');
                setEditingNode(null);
                fetchAllNodes();
            } else {
                const data = await response.json();
                alert(data.error || '更新失败');
            }
        } catch (error) {
            console.error('更新节点失败:', error);
            alert('更新失败');
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
            } else {
                alert(data.error || '删除预览失败');
            }
        } catch (error) {
            console.error('删除预览失败:', error);
            alert('删除预览失败');
        } finally {
            setDeletePreviewLoading(false);
        }
    }, [toBridgeDecisionPayload]);

    const openDeleteNodeConfirmModal = (node) => {
        const nextNode = node || null;
        setDeletingNodeTarget(nextNode);
        setDeleteBridgeDecisions({});
        setDeletePreviewData(null);
        setShowDeleteNodeConfirmModal(true);
        if (nextNode) {
            fetchDeleteNodePreview(nextNode, {});
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
                fetchAllNodes();
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
                fetchAllNodes();
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
    const deleteBridgeDecisionItems = Array.isArray(deletePreviewData?.bridgeDecisionItems)
        ? deletePreviewData.bridgeDecisionItems
        : [];

    // --- Association Management Functions ---
    const openAssociationModal = (node) => {
        setViewingAssociationNode(node);
        setShowAssociationModal(true);
    };

    const getRelationMeta = (uiRelationType) => {
        const isParent = uiRelationType === ASSOC_RELATION_TYPES.EXTENDS;
        return {
            roleText: isParent ? '母域' : '子域',
            badgeClass: uiRelationType,
            displayText: (targetNodeName) => `作为 ${targetNodeName} 的${isParent ? '母域' : '子域'}`
        };
    };

    const toBackendRelationType = (uiRelationType) => (
        uiRelationType === ASSOC_RELATION_TYPES.EXTENDS
            ? ASSOC_RELATION_TYPES.CONTAINS
            : ASSOC_RELATION_TYPES.EXTENDS
    );

    const resetAssociationEditor = useCallback(() => {
        setAssocCurrentStep(null);
        setAssocSelectedNodeA(null);
        setAssocSelectedRelationType(null);
        setAssocSelectedNodeB(null);
        setAssocInsertDirection(null);
        setAssocNodeBCandidates({ parents: [], children: [] });
        setAssocNodeBSearchKeyword('');
        setAssocEditingIndex(null);
        setAssocSearchKeyword('');
        setAssocSearchResults([]);
        setAssocSearchLoading(false);
        setAssocPreviewLoading(false);
        setAssocBridgeDecisions({});

        if (assocPreviewRendererRef.current) {
            assocPreviewRendererRef.current.destroy();
            assocPreviewRendererRef.current = null;
        }
    }, []);

    const closeEditAssociationModal = useCallback(() => {
        setShowEditAssociationModal(false);
        setEditingAssociationNode(null);
        setEditAssociations([]);
        setAssocMutationPreview(null);
        setAssocRemovalStrategy('disconnect');
        setAssocApplyLoading(false);
        setAssocBridgeDecisions({});
        resetAssociationEditor();
    }, [resetAssociationEditor]);

    useEffect(() => {
        if (assocCurrentStep === ASSOC_STEPS.PREVIEW && assocPreviewCanvasRef.current) {
            if (!assocPreviewRendererRef.current) {
                assocPreviewRendererRef.current = new MiniPreviewRenderer(assocPreviewCanvasRef.current);
            }

            assocPreviewRendererRef.current.setPreviewScene({
                nodeA: assocSelectedNodeA,
                nodeB: assocSelectedNodeB,
                relationType: assocSelectedRelationType,
                newNodeName: editingAssociationNode?.name || '当前节点',
                insertDirection: assocInsertDirection
            });
        }

        return () => {
            if (assocCurrentStep !== ASSOC_STEPS.PREVIEW && assocPreviewRendererRef.current) {
                assocPreviewRendererRef.current.stopAnimation();
            }
        };
    }, [
        assocCurrentStep,
        assocSelectedNodeA,
        assocSelectedNodeB,
        assocSelectedRelationType,
        assocInsertDirection,
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

    const buildSimpleAssociation = ({ targetNodeId, targetNodeName, backendRelationType }) => {
        const uiRelationType = backendRelationType === ASSOC_RELATION_TYPES.CONTAINS
            ? ASSOC_RELATION_TYPES.EXTENDS
            : ASSOC_RELATION_TYPES.CONTAINS;
        const relationMeta = getRelationMeta(uiRelationType);
        return {
            type: uiRelationType,
            nodeA: { _id: targetNodeId, name: targetNodeName },
            nodeB: null,
            direction: null,
            actualAssociations: [{
                targetNode: targetNodeId,
                relationType: backendRelationType,
                nodeName: targetNodeName
            }],
            displayText: relationMeta.displayText(targetNodeName)
        };
    };

    const openEditAssociationModal = (node) => {
        setEditingAssociationNode(node);
        setShowEditAssociationModal(true);
        setIsEditAssociationListExpanded(true);
        setAssocMutationPreview(null);
        setAssocRemovalStrategy('disconnect');
        setAssocApplyLoading(false);
        setAssocBridgeDecisions({});
        resetAssociationEditor();

        const rebuiltAssociations = [];

        if (Array.isArray(node.associations) && node.associations.length > 0) {
            node.associations.forEach((assoc) => {
                const targetNodeId = assoc?.targetNode?._id || assoc?.targetNode;
                const targetNodeName = assoc?.targetNode?.name;
                if (targetNodeId && targetNodeName && assoc.relationType) {
                    rebuiltAssociations.push(buildSimpleAssociation({
                        targetNodeId,
                        targetNodeName,
                        backendRelationType: assoc.relationType
                    }));
                }
            });
        }

        if (rebuiltAssociations.length === 0) {
            const nodeMap = {};
            allNodes.forEach(n => {
                nodeMap[n.name] = n;
            });

            (node.relatedParentDomains || []).forEach((nodeName) => {
                const targetNode = nodeMap[nodeName];
                if (targetNode) {
                    rebuiltAssociations.push(buildSimpleAssociation({
                        targetNodeId: targetNode._id,
                        targetNodeName: targetNode.name,
                        backendRelationType: ASSOC_RELATION_TYPES.EXTENDS
                    }));
                }
            });

            (node.relatedChildDomains || []).forEach((nodeName) => {
                const targetNode = nodeMap[nodeName];
                if (targetNode) {
                    rebuiltAssociations.push(buildSimpleAssociation({
                        targetNodeId: targetNode._id,
                        targetNodeName: targetNode.name,
                        backendRelationType: ASSOC_RELATION_TYPES.CONTAINS
                    }));
                }
            });
        }

        setEditAssociations(rebuiltAssociations);
    };

    const searchAssociationNodes = useCallback(async (keyword) => {
        const normalizedKeyword = (keyword || '').trim();
        if (!normalizedKeyword) {
            setAssocSearchResults([]);
            return;
        }

        setAssocSearchLoading(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/search?keyword=${encodeURIComponent(normalizedKeyword)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                const filtered = data.filter(n => n._id !== editingAssociationNode?._id);
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
    }, [editingAssociationNode]);

    // 选择节点步骤中，输入时自动搜索
    useEffect(() => {
        if (assocCurrentStep !== ASSOC_STEPS.SELECT_NODE_A) {
            return;
        }

        if (!assocSearchKeyword.trim()) {
            setAssocSearchResults([]);
            setAssocSearchLoading(false);
            return;
        }

        const timer = setTimeout(() => {
            searchAssociationNodes(assocSearchKeyword);
        }, 220);

        return () => clearTimeout(timer);
    }, [assocSearchKeyword, assocCurrentStep, searchAssociationNodes]);

    const startAddEditAssociation = () => {
        setAssocMutationPreview(null);
        setAssocBridgeDecisions({});
        resetAssociationEditor();
        setAssocCurrentStep(ASSOC_STEPS.SELECT_NODE_A);
    };

    const selectAssocNodeA = async (node) => {
        const nodeDetail = await fetchNodeDetailForAssociation(node._id);
        if (nodeDetail) {
            setAssocSelectedNodeA(nodeDetail);
            setAssocCurrentStep(ASSOC_STEPS.SELECT_RELATION);
            setAssocSearchResults([]);
            setAssocSearchKeyword('');
        } else {
            alert('获取节点详情失败');
        }
    };

    const selectAssocRelationType = (type) => {
        setAssocSelectedRelationType(type);

        if (type === ASSOC_RELATION_TYPES.INSERT) {
            const candidates = {
                parents: assocSelectedNodeA?.parentNodesInfo || [],
                children: assocSelectedNodeA?.childNodesInfo || []
            };
            setAssocNodeBCandidates(candidates);

            if (candidates.parents.length === 0 && candidates.children.length === 0) {
                alert('该节点没有母域或子域节点，无法使用插入模式。');
                return;
            }
            setAssocCurrentStep(ASSOC_STEPS.SELECT_NODE_B);
        } else {
            setAssocCurrentStep(ASSOC_STEPS.PREVIEW);
        }
    };

    const selectAssocNodeB = (node, fromParents) => {
        setAssocSelectedNodeB(node);
        setAssocInsertDirection(fromParents ? 'bToA' : 'aToB');
        setAssocCurrentStep(ASSOC_STEPS.PREVIEW);
    };

    const replayAssocPreview = () => {
        if (assocPreviewRendererRef.current) {
            assocPreviewRendererRef.current.setPreviewScene({
                nodeA: assocSelectedNodeA,
                nodeB: assocSelectedNodeB,
                relationType: assocSelectedRelationType,
                newNodeName: editingAssociationNode?.name || '当前节点',
                insertDirection: assocInsertDirection
            });
        }
    };

    const confirmEditAssociation = () => {
        let associationData;

        if (assocSelectedRelationType === ASSOC_RELATION_TYPES.INSERT) {
            associationData = {
                type: ASSOC_RELATION_TYPES.INSERT,
                nodeA: assocSelectedNodeA,
                nodeB: assocSelectedNodeB,
                direction: assocInsertDirection,
                actualAssociations: assocInsertDirection === 'aToB'
                    ? [
                        { targetNode: assocSelectedNodeA._id, relationType: ASSOC_RELATION_TYPES.EXTENDS, nodeName: assocSelectedNodeA.name },
                        { targetNode: assocSelectedNodeB._id, relationType: ASSOC_RELATION_TYPES.CONTAINS, nodeName: assocSelectedNodeB.name }
                    ]
                    : [
                        { targetNode: assocSelectedNodeB._id, relationType: ASSOC_RELATION_TYPES.EXTENDS, nodeName: assocSelectedNodeB.name },
                        { targetNode: assocSelectedNodeA._id, relationType: ASSOC_RELATION_TYPES.CONTAINS, nodeName: assocSelectedNodeA.name }
                    ],
                displayText: `插入到 ${assocSelectedNodeA.name} 和 ${assocSelectedNodeB.name} 之间`
            };
        } else {
            const backendRelationType = toBackendRelationType(assocSelectedRelationType);
            const relationMeta = getRelationMeta(assocSelectedRelationType);
            associationData = {
                type: assocSelectedRelationType,
                nodeA: assocSelectedNodeA,
                nodeB: null,
                direction: null,
                actualAssociations: [{
                    targetNode: assocSelectedNodeA._id,
                    relationType: backendRelationType,
                    nodeName: assocSelectedNodeA.name
                }],
                displayText: relationMeta.displayText(assocSelectedNodeA.name)
            };
        }

        let duplicateReason = null;
        const isDuplicate = editAssociations.some((assoc, index) => {
            if (assocEditingIndex !== null && index === assocEditingIndex) {
                return false;
            }

            if (assoc.type === ASSOC_RELATION_TYPES.INSERT && associationData.type === ASSOC_RELATION_TYPES.INSERT) {
                const existingPair = [assoc.nodeA._id, assoc.nodeB._id].sort();
                const newPair = [associationData.nodeA._id, associationData.nodeB._id].sort();
                if (existingPair[0] === newPair[0] && existingPair[1] === newPair[1]) {
                    duplicateReason = `已经存在插入到 ${assoc.nodeA.name} 和 ${assoc.nodeB.name} 之间的关联`;
                    return true;
                }
                return false;
            }

            if (assoc.type !== ASSOC_RELATION_TYPES.INSERT && associationData.type !== ASSOC_RELATION_TYPES.INSERT) {
                const found = assoc.actualAssociations.some(aa =>
                    associationData.actualAssociations.some(ba =>
                        aa.targetNode.toString() === ba.targetNode.toString() && aa.relationType === ba.relationType
                    )
                );
                if (found) {
                    duplicateReason = `已经存在与 ${assoc.nodeA.name} 的${assoc.type === ASSOC_RELATION_TYPES.EXTENDS ? '母域' : '子域'}关系`;
                    return true;
                }
                return false;
            }

            const insertAssoc = assoc.type === ASSOC_RELATION_TYPES.INSERT ? assoc : associationData;
            const simpleAssoc = assoc.type === ASSOC_RELATION_TYPES.INSERT ? associationData : assoc;
            const conflict = insertAssoc.actualAssociations.find(ia =>
                simpleAssoc.actualAssociations.some(sa =>
                    ia.targetNode.toString() === sa.targetNode.toString() && ia.relationType === sa.relationType
                )
            );
            if (conflict) {
                duplicateReason = `与现有关联冲突：当前节点对 ${conflict.nodeName} 已经有${conflict.relationType === ASSOC_RELATION_TYPES.EXTENDS ? '子域' : '母域'}关系`;
                return true;
            }
            return false;
        });

        if (isDuplicate) {
            alert(duplicateReason || '该关联关系已存在');
            return;
        }

        if (assocEditingIndex !== null) {
            setEditAssociations(prev => {
                const next = [...prev];
                next[assocEditingIndex] = associationData;
                return next;
            });
        } else {
            setEditAssociations(prev => [...prev, associationData]);
        }

        setAssocMutationPreview(null);
        setAssocBridgeDecisions({});
        resetAssociationEditor();
    };

    const removeEditAssociation = (index) => {
        setAssocMutationPreview(null);
        setAssocBridgeDecisions({});
        setEditAssociations(prev => prev.filter((_, i) => i !== index));
    };

    const editExistingAssociation = async (index) => {
        const assoc = editAssociations[index];
        let nextNodeA = assoc.nodeA;

        if (nextNodeA?._id && (!nextNodeA.parentNodesInfo || !nextNodeA.childNodesInfo)) {
            const nodeDetail = await fetchNodeDetailForAssociation(nextNodeA._id);
            if (nodeDetail) {
                nextNodeA = nodeDetail;
            }
        }

        setAssocEditingIndex(index);
        setAssocSelectedNodeA(nextNodeA);
        setAssocSelectedRelationType(assoc.type);
        setAssocSelectedNodeB(assoc.nodeB);
        setAssocInsertDirection(assoc.direction);
        setAssocCurrentStep(ASSOC_STEPS.PREVIEW);
    };

    const goBackAssocStep = () => {
        if (assocPreviewRendererRef.current) {
            assocPreviewRendererRef.current.stopAnimation();
        }

        switch (assocCurrentStep) {
            case ASSOC_STEPS.SELECT_RELATION:
                setAssocSelectedRelationType(null);
                setAssocCurrentStep(ASSOC_STEPS.SELECT_NODE_A);
                break;
            case ASSOC_STEPS.SELECT_NODE_B:
                setAssocSelectedNodeB(null);
                setAssocInsertDirection(null);
                setAssocCurrentStep(ASSOC_STEPS.SELECT_RELATION);
                break;
            case ASSOC_STEPS.PREVIEW:
                if (assocSelectedRelationType === ASSOC_RELATION_TYPES.INSERT) {
                    setAssocCurrentStep(ASSOC_STEPS.SELECT_NODE_B);
                } else {
                    setAssocCurrentStep(ASSOC_STEPS.SELECT_RELATION);
                }
                break;
            default:
                resetAssociationEditor();
        }
    };

    const resolveNodeDefaultSenseId = useCallback((nodeLike, fallbackNodeId = '') => {
        const directSenseId = nodeLike?.activeSenseId
            || (Array.isArray(nodeLike?.synonymSenses) ? nodeLike.synonymSenses[0]?.senseId : '')
            || '';
        if (directSenseId) return directSenseId;
        const matched = allNodes.find((item) => item?._id === (fallbackNodeId || nodeLike?._id));
        return matched?.activeSenseId
            || (Array.isArray(matched?.synonymSenses) ? matched.synonymSenses[0]?.senseId : '')
            || 'sense_1';
    }, [allNodes]);

    const resolveEditingSenseTitle = useCallback((senseId) => {
        const sourceList = Array.isArray(editingAssociationNode?.synonymSenses) ? editingAssociationNode.synonymSenses : [];
        const key = (senseId || '').trim();
        if (!key) return '';
        const matched = sourceList.find((sense) => (sense?.senseId || '').trim() === key);
        return matched?.title || key;
    }, [editingAssociationNode]);

    const buildAssociationPayloadForMutation = useCallback(() => {
        const sourceSenseId = resolveNodeDefaultSenseId(editingAssociationNode, editingAssociationNode?._id);
        return editAssociations.flatMap((assoc, index) => {
            if (assoc.type === ASSOC_RELATION_TYPES.INSERT) {
                const direction = assoc.direction === 'bToA' ? 'bToA' : 'aToB';
                const upperNode = direction === 'aToB' ? assoc.nodeA : assoc.nodeB;
                const lowerNode = direction === 'aToB' ? assoc.nodeB : assoc.nodeA;
                const upperNodeId = upperNode?._id;
                const lowerNodeId = lowerNode?._id;
                if (!upperNodeId || !lowerNodeId) return [];
                const insertGroupId = `admin_insert_${index}_${upperNodeId}_${lowerNodeId}_${direction}`;
                return [
                    {
                        targetNode: upperNodeId,
                        relationType: ASSOC_RELATION_TYPES.INSERT,
                        sourceSenseId,
                        targetSenseId: resolveNodeDefaultSenseId(upperNode, upperNodeId),
                        insertSide: 'left',
                        insertGroupId
                    },
                    {
                        targetNode: lowerNodeId,
                        relationType: ASSOC_RELATION_TYPES.INSERT,
                        sourceSenseId,
                        targetSenseId: resolveNodeDefaultSenseId(lowerNode, lowerNodeId),
                        insertSide: 'right',
                        insertGroupId
                    }
                ];
            }

            return assoc.actualAssociations.map((actual) => {
                const fallbackNode = assoc.nodeA?._id === actual.targetNode ? assoc.nodeA : assoc.nodeB;
                return {
                    targetNode: actual.targetNode,
                    relationType: actual.relationType,
                    sourceSenseId,
                    targetSenseId: resolveNodeDefaultSenseId(fallbackNode, actual.targetNode)
                };
            });
        });
    }, [editAssociations, editingAssociationNode, resolveNodeDefaultSenseId]);

    const previewAssociationEdit = async (decisionMap = assocBridgeDecisions) => {
        if (!editingAssociationNode?._id) return;
        const token = localStorage.getItem('token');
        const associationsPayload = buildAssociationPayloadForMutation();
        setAssocPreviewLoading(true);
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${editingAssociationNode._id}/associations/preview`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    associations: associationsPayload,
                    onRemovalStrategy: assocRemovalStrategy,
                    bridgeDecisions: toBridgeDecisionPayload(decisionMap)
                })
            });
            const data = await response.json();
            if (response.ok) {
                setAssocMutationPreview(data);
            } else {
                alert(data.error || '预览失败');
            }
        } catch (error) {
            console.error('预览关联变更失败:', error);
            alert('预览失败');
        } finally {
            setAssocPreviewLoading(false);
        }
    };

    const saveAssociationEdit = async () => {
        if (!editingAssociationNode?._id) return;
        if (!assocMutationPreview) {
            alert('请先预览变更，再确认保存');
            return;
        }
        if ((assocMutationPreview?.unresolvedBridgeDecisionCount || 0) > 0) {
            alert('请先逐条确认删除后的上下级承接关系（保留承接或断开）');
            return;
        }

        const token = localStorage.getItem('token');
        const associationsPayload = buildAssociationPayloadForMutation();
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
                    onRemovalStrategy: assocRemovalStrategy,
                    bridgeDecisions: toBridgeDecisionPayload(assocBridgeDecisions)
                })
            });
            const data = await response.json();
            if (response.ok) {
                alert(data.message);
                closeEditAssociationModal();
                fetchAllNodes();
            } else {
                if (data?.bridgeDecisionItems) {
                    setAssocMutationPreview((prev) => ({
                        ...(prev || {}),
                        ...data
                    }));
                }
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
        relationType === ASSOC_RELATION_TYPES.CONTAINS ? '→包含→' : '←拓展←'
    );

    const renderMutationLine = (line, key, tone = 'neutral') => (
        <div key={key} className={`admin-assoc-mutation-line ${tone}`}>
            <span className="endpoint">{line.source?.displayName || '未知释义'}</span>
            <span className="arrow">{formatRelationArrowText(line.relationType)}</span>
            <span className="endpoint">{line.target?.displayName || '未知释义'}</span>
        </div>
    );

    const renderBridgeDecisionItem = (item, index) => {
        const selectedAction = assocBridgeDecisions[item.pairKey] || item.explicitAction || '';
        const displayUpper = item?.upper?.displayName || '未知上级释义';
        const displayLower = item?.lower?.displayName || '未知下级释义';
        return (
            <div key={item.pairKey || `bridge_decision_${index}`} className="admin-bridge-decision-item">
                <div className="admin-bridge-decision-line">
                    <span>{displayUpper}</span>
                    <span className="arrow">⇢ {resolveEditingSenseTitle(item.sourceSenseId)} ⇢</span>
                    <span>{displayLower}</span>
                </div>
                <div className="admin-bridge-decision-actions">
                    <button
                        className={`admin-bridge-decision-btn ${selectedAction === 'reconnect' ? 'active reconnect' : ''}`}
                        onClick={() => {
                            const next = {
                                ...assocBridgeDecisions,
                                [item.pairKey]: 'reconnect'
                            };
                            setAssocBridgeDecisions(next);
                            previewAssociationEdit(next);
                        }}
                        disabled={assocPreviewLoading || assocApplyLoading}
                    >
                        保留承接
                    </button>
                    <button
                        className={`admin-bridge-decision-btn ${selectedAction === 'disconnect' ? 'active disconnect' : ''}`}
                        onClick={() => {
                            const next = {
                                ...assocBridgeDecisions,
                                [item.pairKey]: 'disconnect'
                            };
                            setAssocBridgeDecisions(next);
                            previewAssociationEdit(next);
                        }}
                        disabled={assocPreviewLoading || assocApplyLoading}
                    >
                        断开独立
                    </button>
                </div>
            </div>
        );
    };

    const renderAssocMutationPreview = () => {
        if (!assocMutationPreview?.summary) return null;
        const summary = assocMutationPreview.summary;
        const bridgeDecisionItems = Array.isArray(assocMutationPreview?.bridgeDecisionItems)
            ? assocMutationPreview.bridgeDecisionItems
            : [];
        const beforeRelations = Array.isArray(summary.beforeRelations) ? summary.beforeRelations : [];
        const afterRelations = Array.isArray(summary.afterRelations) ? summary.afterRelations : [];
        const hasChanges = (summary.removed?.length || 0) > 0
            || (summary.added?.length || 0) > 0
            || (summary.lostBridgePairs?.length || 0) > 0
            || (summary.reconnectLines?.length || 0) > 0;

        return (
            <div className="admin-assoc-mutation-preview">
                <div className="admin-assoc-mutation-header">
                    <h5>关联变更预览</h5>
                    <span className={`strategy-badge ${assocMutationPreview?.strategy || 'disconnect'}`}>
                        {assocMutationPreview?.strategy === 'reconnect' ? '断开后自动重连' : '断开后不重连'}
                    </span>
                </div>

                <div className="admin-assoc-before-after-grid">
                    <div className="admin-assoc-before-after-block before">
                        <h6>编辑前</h6>
                        {beforeRelations.length > 0 ? (
                            beforeRelations.map((line, index) => renderMutationLine(line, `before_${index}`, 'neutral'))
                        ) : (
                            <div className="admin-assoc-empty-change">编辑前无关联</div>
                        )}
                    </div>
                    <div className="admin-assoc-before-after-block after">
                        <h6>编辑后</h6>
                        {afterRelations.length > 0 ? (
                            afterRelations.map((line, index) => renderMutationLine(line, `after_${index}`, 'neutral'))
                        ) : (
                            <div className="admin-assoc-empty-change">编辑后无关联</div>
                        )}
                    </div>
                </div>

                {!hasChanges && (
                    <div className="admin-assoc-empty-change">本次操作不会改变任何关联关系。</div>
                )}

                {summary.removed?.length > 0 && (
                    <div className="admin-assoc-mutation-block">
                        <h6>将移除</h6>
                        {summary.removed.map((line, index) => renderMutationLine(line, `removed_${index}`, 'removed'))}
                    </div>
                )}

                {summary.added?.length > 0 && (
                    <div className="admin-assoc-mutation-block">
                        <h6>将新增</h6>
                        {summary.added.map((line, index) => renderMutationLine(line, `added_${index}`, 'added'))}
                    </div>
                )}

                {summary.lostBridgePairs?.length > 0 && (
                    <div className="admin-assoc-mutation-block">
                        <h6>受影响的上级/下级对</h6>
                        {summary.lostBridgePairs.map((pair, index) => (
                            <div key={`bridge_${index}`} className="admin-assoc-mutation-line warning">
                                <span className="endpoint">{pair.upper?.displayName || '未知释义'}</span>
                                <span className="arrow">⇢ {resolveEditingSenseTitle(pair.sourceSenseId)} ⇢</span>
                                <span className="endpoint">{pair.lower?.displayName || '未知释义'}</span>
                            </div>
                        ))}
                    </div>
                )}

                {summary.reconnectLines?.length > 0 && (
                    <div className="admin-assoc-mutation-block">
                        <h6>将自动重连</h6>
                        {summary.reconnectLines.map((item, index) => renderMutationLine(item.line, `reconnect_${index}`, 'reconnect'))}
                    </div>
                )}

                {bridgeDecisionItems.length > 0 && (
                    <div className="admin-assoc-mutation-block">
                        <h6>承接关系逐条确认</h6>
                        <p className="admin-assoc-step-description" style={{ marginBottom: '0.45rem' }}>
                            对每组“上级-当前释义-下级”选择删除后是保留承接还是断开独立。
                        </p>
                        {(assocMutationPreview?.unresolvedBridgeDecisionCount || 0) > 0 && (
                            <p className="admin-assoc-step-description" style={{ marginBottom: '0.45rem', color: '#fca5a5' }}>
                                尚有 {assocMutationPreview.unresolvedBridgeDecisionCount} 组未确认，不能保存。
                            </p>
                        )}
                        <div className="admin-bridge-decision-list">
                            {summary.lostBridgePairs.map((pair, index) => {
                                const decision = bridgeDecisionItems.find((item) => item.pairKey === pair.pairKey) || {};
                                return renderBridgeDecisionItem({
                                    ...decision,
                                    pairKey: pair.pairKey,
                                    sourceSenseId: pair.sourceSenseId,
                                    upper: pair.upper,
                                    lower: pair.lower
                                }, index);
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderAssocStepIndicator = () => {
        if (!assocCurrentStep) return null;

        const steps = [
            { key: ASSOC_STEPS.SELECT_NODE_A, label: '选择节点' },
            { key: ASSOC_STEPS.SELECT_RELATION, label: '选择关系' },
            ...(assocSelectedRelationType === ASSOC_RELATION_TYPES.INSERT ? [{ key: ASSOC_STEPS.SELECT_NODE_B, label: '第二节点' }] : []),
            { key: ASSOC_STEPS.PREVIEW, label: '预览确认' }
        ];
        const currentIndex = steps.findIndex(s => s.key === assocCurrentStep);

        return (
            <div className="admin-assoc-step-indicator">
                {steps.map((step, index) => (
                    <React.Fragment key={step.key}>
                        <div className={`admin-assoc-step-dot ${index <= currentIndex ? 'active' : ''} ${step.key === assocCurrentStep ? 'current' : ''}`}>
                            {index + 1}
                        </div>
                        {index < steps.length - 1 && (
                            <div className={`admin-assoc-step-line ${index < currentIndex ? 'active' : ''}`} />
                        )}
                    </React.Fragment>
                ))}
                <div className="admin-assoc-step-labels">
                    {steps.map((step) => (
                        <span key={step.key} className={`admin-assoc-step-label ${step.key === assocCurrentStep ? 'current' : ''}`}>
                            {step.label}
                        </span>
                    ))}
                </div>
            </div>
        );
    };

    const renderAssocSelectNodeA = () => (
        <div className="admin-assoc-step">
            <h5>步骤 1：选择关联节点</h5>
            <p className="admin-assoc-step-description">搜索并选择一个现有节点作为关联目标</p>

            <div className="search-input-group">
                <input
                    type="text"
                    value={assocSearchKeyword}
                    onChange={(e) => setAssocSearchKeyword(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && searchAssociationNodes(assocSearchKeyword)}
                    placeholder="搜索标题或释义题目..."
                    className="form-input"
                />
                <button onClick={() => searchAssociationNodes(assocSearchKeyword)} disabled={assocSearchLoading} className="btn btn-primary">
                    <Search className="icon-small" />
                    {assocSearchLoading ? '...' : '搜索'}
                </button>
            </div>

            {assocSearchResults.length > 0 && (
                <div className="search-results">
                    {assocSearchResults.map(node => (
                        <div
                            key={node.searchKey || `${node._id}_${node.senseId || 'sense'}`}
                            className="search-result-item clickable"
                            onClick={() => selectAssocNodeA(node)}
                        >
                            <div className="node-info">
                                <strong>{node.name}</strong>
                                <span className="node-description">{node.description}</span>
                            </div>
                            <ArrowRight className="icon-small" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderAssocSelectRelation = () => (
        <div className="admin-assoc-step">
            <h5>步骤 2：选择关系类型</h5>
            <p className="admin-assoc-step-description">
                选择当前节点与 <strong>{assocSelectedNodeA?.name}</strong> 的关系
            </p>

            <div className="admin-assoc-relation-cards">
                <div className="admin-assoc-relation-card" onClick={() => selectAssocRelationType(ASSOC_RELATION_TYPES.EXTENDS)}>
                    <div className="admin-assoc-relation-icon extends">↑</div>
                    <div className="admin-assoc-relation-content">
                        <h6>作为母域节点</h6>
                        <p>当前节点将成为 {assocSelectedNodeA?.name} 的母域（上级概念）</p>
                    </div>
                </div>

                <div className="admin-assoc-relation-card" onClick={() => selectAssocRelationType(ASSOC_RELATION_TYPES.CONTAINS)}>
                    <div className="admin-assoc-relation-icon contains">↓</div>
                    <div className="admin-assoc-relation-content">
                        <h6>作为子域节点</h6>
                        <p>当前节点将成为 {assocSelectedNodeA?.name} 的子域（下级概念）</p>
                    </div>
                </div>

                <div
                    className={`admin-assoc-relation-card ${(!assocSelectedNodeA?.parentNodesInfo?.length && !assocSelectedNodeA?.childNodesInfo?.length) ? 'disabled' : ''}`}
                    onClick={() => {
                        if (assocSelectedNodeA?.parentNodesInfo?.length || assocSelectedNodeA?.childNodesInfo?.length) {
                            selectAssocRelationType(ASSOC_RELATION_TYPES.INSERT);
                        }
                    }}
                >
                    <div className="admin-assoc-relation-icon insert">⇄</div>
                    <div className="admin-assoc-relation-content">
                        <h6>插入到两节点之间</h6>
                        <p>将当前节点插入到 {assocSelectedNodeA?.name} 与另一个节点之间</p>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderAssocSelectNodeB = () => {
        const filteredNodeBCandidates = {
            parents: assocNodeBCandidates.parents.filter(n =>
                assocNodeBSearchKeyword.trim() === '' ||
                n.name.toLowerCase().includes(assocNodeBSearchKeyword.toLowerCase())
            ),
            children: assocNodeBCandidates.children.filter(n =>
                assocNodeBSearchKeyword.trim() === '' ||
                n.name.toLowerCase().includes(assocNodeBSearchKeyword.toLowerCase())
            )
        };

        return (
            <div className="admin-assoc-step">
                <h5>步骤 3：选择第二个节点</h5>
                <p className="admin-assoc-step-description">
                    选择要与 <strong>{assocSelectedNodeA?.name}</strong> 之间插入当前节点的目标节点
                </p>

                <div className="admin-assoc-node-b-search">
                    <input
                        type="text"
                        value={assocNodeBSearchKeyword}
                        onChange={(e) => setAssocNodeBSearchKeyword(e.target.value)}
                        placeholder="搜索候选节点..."
                        className="form-input"
                    />
                </div>

                {filteredNodeBCandidates.parents.length > 0 && (
                    <div className="admin-assoc-candidate-section">
                        <h6 className="admin-assoc-candidate-header parent">
                            <span className="admin-assoc-candidate-icon">↑</span> 母域节点（上级）
                        </h6>
                        <div className="admin-assoc-candidate-list">
                            {filteredNodeBCandidates.parents.map(node => (
                                <div key={node._id} className="admin-assoc-candidate-item" onClick={() => selectAssocNodeB(node, true)}>
                                    <span className="admin-assoc-candidate-name">{node.name}</span>
                                    <span className="admin-assoc-candidate-hint">插入到 {node.name} 和 {assocSelectedNodeA?.name} 之间</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {filteredNodeBCandidates.children.length > 0 && (
                    <div className="admin-assoc-candidate-section">
                        <h6 className="admin-assoc-candidate-header child">
                            <span className="admin-assoc-candidate-icon">↓</span> 子域节点（下级）
                        </h6>
                        <div className="admin-assoc-candidate-list">
                            {filteredNodeBCandidates.children.map(node => (
                                <div key={node._id} className="admin-assoc-candidate-item" onClick={() => selectAssocNodeB(node, false)}>
                                    <span className="admin-assoc-candidate-name">{node.name}</span>
                                    <span className="admin-assoc-candidate-hint">插入到 {assocSelectedNodeA?.name} 和 {node.name} 之间</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderAssocPreview = () => (
        <div className="admin-assoc-step admin-assoc-preview-step">
            <h5>步骤 {assocSelectedRelationType === ASSOC_RELATION_TYPES.INSERT ? '4' : '3'}：预览确认</h5>
            <p className="admin-assoc-step-description">查看关联关系生效后的结构变化</p>

            <div className="admin-assoc-preview-canvas-container">
                <canvas
                    ref={assocPreviewCanvasRef}
                    width={320}
                    height={200}
                    className="admin-assoc-preview-canvas"
                />
            </div>

            <div className="admin-assoc-preview-info">
                {assocSelectedRelationType === ASSOC_RELATION_TYPES.EXTENDS && (
                    <span><strong>{editingAssociationNode?.name}</strong> 将成为 <strong>{assocSelectedNodeA?.name}</strong> 的母域</span>
                )}
                {assocSelectedRelationType === ASSOC_RELATION_TYPES.CONTAINS && (
                    <span><strong>{editingAssociationNode?.name}</strong> 将成为 <strong>{assocSelectedNodeA?.name}</strong> 的子域</span>
                )}
                {assocSelectedRelationType === ASSOC_RELATION_TYPES.INSERT && (
                    <span><strong>{editingAssociationNode?.name}</strong> 将插入到 <strong>{assocSelectedNodeA?.name}</strong> 和 <strong>{assocSelectedNodeB?.name}</strong> 之间</span>
                )}
            </div>

            <div className="admin-assoc-preview-actions">
                <button onClick={replayAssocPreview} className="btn btn-secondary">
                    <RotateCcw className="icon-small" /> 重播
                </button>
                <button onClick={confirmEditAssociation} className="btn btn-success">
                    <Check className="icon-small" /> 确认关联
                </button>
            </div>
        </div>
    );

    const renderAssocCurrentStep = () => {
        switch (assocCurrentStep) {
            case ASSOC_STEPS.SELECT_NODE_A:
                return renderAssocSelectNodeA();
            case ASSOC_STEPS.SELECT_RELATION:
                return renderAssocSelectRelation();
            case ASSOC_STEPS.SELECT_NODE_B:
                return renderAssocSelectNodeB();
            case ASSOC_STEPS.PREVIEW:
                return renderAssocPreview();
            default:
                return null;
        }
    };

    // --- Alliance Management Functions ---
    const fetchAdminAlliances = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('http://localhost:5000/api/alliances/admin/all', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setAdminAlliances(data.alliances);
            }
        } catch (error) {
            console.error('获取熵盟列表失败:', error);
        }
    };

    const startEditAlliance = (alliance) => {
        setEditingAlliance(alliance);
        setEditAllianceForm({
            name: alliance.name,
            flag: alliance.flag,
            declaration: alliance.declaration
        });
    };

    const cancelEditAlliance = () => {
        setEditingAlliance(null);
        setEditAllianceForm({ name: '', flag: '', declaration: '' });
    };

    const saveAllianceEdit = async () => {
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/alliances/admin/${editingAlliance._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editAllianceForm)
            });
            if (response.ok) {
                const data = await response.json();
                alert(data.message);
                cancelEditAlliance();
                fetchAdminAlliances();
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
                fetchAdminAlliances();
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
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/admin/search-users?keyword=${keyword}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setMasterSearchResults(data.users);
            }
        } catch (error) {
            console.error('搜索用户失败:', error);
        }
    };

    const openChangeMasterModal = (node) => {
        setChangingMasterNode(node);
        setSelectedNewMaster(node.domainMaster || null);
        setMasterSearchKeyword('');
        setMasterSearchResults([]);
        setShowChangeMasterModal(true);
        searchUsersForMaster('');
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
                fetchAllNodes();
            } else {
                alert(data.error || '更换失败');
            }
        } catch (error) {
            console.error('更换域主失败:', error);
            alert('更换失败');
        }
    };

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
                        fetchAllUsers();
                    }}
                    className={`admin-tab ${adminTab === 'users' ? 'active' : ''}`}
                >
                    <Users className="icon-small" />
                    用户管理
                </button>
                <button
                    onClick={() => {
                        setAdminTab('nodes');
                        fetchAllNodes();
                    }}
                    className={`admin-tab ${adminTab === 'nodes' ? 'active' : ''}`}
                >
                    <Zap className="icon-small" />
                    节点管理
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
                        fetchAdminAlliances();
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
            </div>

            {/* 用户管理选项卡 */}
            {adminTab === 'users' && (
                <div className="users-table-container">
                    <div className="table-info">
                        <p>总用户数: <strong>{allUsers.length}</strong></p>
                        <button 
                            onClick={fetchAllUsers}
                            className="btn btn-primary"
                            style={{ marginLeft: '1rem' }}
                        >
                            刷新数据
                        </button>
                    </div>
                    
                    <div className="table-responsive">
                        <table className="users-table">
                            <thead>
                                <tr>
                                    <th>数据库ID</th>
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
                                        <td className="id-cell">{user._id}</td>
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

            {/* 待审批节点选项卡 */}
            {adminTab === 'pending' && (
                <div className="pending-nodes-container">
                    <div className="table-info">
                        <p>待审批总数: <strong>{pendingApprovalCount}</strong></p>
                        <span className="pending-summary-tag node">建节点申请: {pendingNodes.length}</span>
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
                                        <h3>节点创建审批</h3>
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
                                                            return (
                                                        <div key={node._id} className={`pending-node-card pending-review-card pending-review-card-node ${group.hasConflict ? 'conflict-card' : ''}`}>
                                                            {group.hasConflict && (
                                                                <div className="conflict-badge">申请 #{index + 1}</div>
                                                            )}
                                                            <div className="node-header">
                                                                <h3 className="node-title">{node.name}</h3>
                                                                <div className="pending-card-badges">
                                                                    <span className="pending-card-type pending-card-type-node">建节点申请</span>
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

                                                                {node.associations && node.associations.length > 0 && (
                                                                    <div className="associations-section">
                                                                        <h4>关联关系 ({node.associations.length} 个)</h4>
                                                                        <div className="associations-list">
                                                                            {node.associations.map((association, idx) => (
                                                                                <div key={idx} className="association-item">
                                                                                    <span className="node-name">
                                                                                        {association.targetNode?.name || '未知节点'}
                                                                                    </span>
                                                                                    <span className={`admin-relation-badge ${association.relationType === 'contains' ? 'parent' : 'child'}`}>
                                                                                        {association.relationType === 'contains' ? '母域' : '子域'}
                                                                                    </span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
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

            {/* 节点管理选项卡 */}
            {adminTab === 'nodes' && (
                <div className="nodes-table-container">
                    <div className="table-info">
                        <p>总节点数: <strong>{allNodes.length}</strong></p>
                        <button 
                            onClick={fetchAllNodes}
                            className="btn btn-primary"
                            style={{ marginLeft: '1rem' }}
                        >
                            刷新数据
                        </button>
                    </div>

                    <div className="admin-domain-list">
                        {hierarchicalNodeList.map((node) => (
                            <div key={node._id} className="admin-domain-card">
                                <div className="admin-domain-title-row">
                                    <div className="admin-domain-title-main">
                                        {editingNode === node._id ? (
                                            <>
                                                <input
                                                    type="text"
                                                    value={editNodeForm.name}
                                                    onChange={(e) => setEditNodeForm({
                                                        ...editNodeForm,
                                                        name: e.target.value
                                                    })}
                                                    className="edit-input"
                                                    placeholder="标题"
                                                />
                                                <textarea
                                                    value={editNodeForm.description}
                                                    onChange={(e) => setEditNodeForm({
                                                        ...editNodeForm,
                                                        description: e.target.value
                                                    })}
                                                    className="edit-textarea"
                                                    rows="2"
                                                    placeholder="概述"
                                                />
                                            </>
                                        ) : (
                                            <>
                                                <h3 className="admin-domain-title">{node.name}</h3>
                                                <p className="admin-domain-description">{node.description || '暂无概述'}</p>
                                            </>
                                        )}
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
                                        {editingNode === node._id ? (
                                            <>
                                                <label className="admin-domain-meta-edit">
                                                    繁荣度
                                                    <input
                                                        type="number"
                                                        value={editNodeForm.prosperity}
                                                        onChange={(e) => setEditNodeForm({
                                                            ...editNodeForm,
                                                            prosperity: parseInt(e.target.value, 10)
                                                        })}
                                                        className="edit-input-small"
                                                    />
                                                </label>
                                                <label className="admin-domain-meta-edit">
                                                    内容分数
                                                    <input
                                                        type="number"
                                                        value={editNodeForm.contentScore}
                                                        onChange={(e) => setEditNodeForm({
                                                            ...editNodeForm,
                                                            contentScore: parseInt(e.target.value, 10)
                                                        })}
                                                        className="edit-input-small"
                                                    />
                                                </label>
                                            </>
                                        ) : (
                                            <>
                                                <span className="admin-domain-meta-item">繁荣度：{Math.round(node.prosperity || 0)}</span>
                                                <span className="admin-domain-meta-item">内容分数：{node.contentScore || 1}</span>
                                            </>
                                        )}
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
                                    {editingNode === node._id ? (
                                        <>
                                            <button
                                                onClick={() => saveNodeEdit(node._id)}
                                                className="btn-action btn-save"
                                            >
                                                保存标题
                                            </button>
                                            <button
                                                onClick={() => setEditingNode(null)}
                                                className="btn-action btn-cancel"
                                            >
                                                取消
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => startEditNode(node)}
                                                className="btn-action btn-edit"
                                            >
                                                编辑标题
                                            </button>
                                            <button
                                                onClick={() => openDeleteNodeConfirmModal(node)}
                                                className="btn-action btn-delete"
                                            >
                                                删除标题
                                            </button>
                                        </>
                                    )}
                                </div>

                                <div className="admin-domain-sense-list">
                                    {node.senses.map((sense) => (
                                        <div key={`${node._id}_${sense.senseId}`} className="admin-domain-sense-item">
                                            <div className="admin-domain-sense-main">
                                                <div className="admin-domain-sense-title-row">
                                                    <h4 className="admin-domain-sense-title">{sense.title}</h4>
                                                    <span className="admin-domain-sense-count">
                                                        关联 {sense.associationSummary.all.length}
                                                    </span>
                                                </div>
                                                <p className="admin-domain-sense-content">{sense.content || '暂无释义内容'}</p>

                                                <div className="admin-domain-sense-relations">
                                                    {sense.associationSummary.all.length > 0 ? (
                                                        sense.associationSummary.all.map((item) => (
                                                            <span
                                                                key={item.id}
                                                                className={`admin-domain-relation-chip ${item.direction}`}
                                                                title={item.displayText}
                                                            >
                                                                {item.displayText}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="admin-domain-relation-empty">暂无关联</span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="admin-domain-sense-actions">
                                                <button
                                                    onClick={() => openAssociationModal(node)}
                                                    className="btn-action btn-view"
                                                >
                                                    查看关联
                                                </button>
                                                <button
                                                    onClick={() => openEditAssociationModal(node)}
                                                    className="btn-action btn-edit"
                                                >
                                                    编辑关联
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 熵盟管理选项卡 */}
            {adminTab === 'alliances' && (
                <div className="alliances-admin-container">
                    <div className="table-info">
                        <p>总熵盟数: <strong>{adminAlliances.length}</strong></p>
                        <button
                            onClick={fetchAdminAlliances}
                            className="btn btn-primary"
                            style={{ marginLeft: '1rem' }}
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

                                        <div className="alliance-edit-actions">
                                            <button onClick={saveAllianceEdit} className="btn btn-success">
                                                保存
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
                                <p>暂无熵盟</p>
                            </div>
                        )}
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

                            {deleteBridgeDecisionItems.length > 0 && (
                                <div className="admin-delete-bridge-decision-section">
                                    <h6>承接关系逐条确认</h6>
                                    <p className="admin-assoc-step-description" style={{ marginBottom: '0.45rem' }}>
                                        对每组“上级-将删除释义-下级”选择删除后是保留承接还是断开独立。
                                    </p>
                                    {(deletePreviewData?.unresolvedBridgeDecisionCount || 0) > 0 && (
                                        <p className="admin-assoc-step-description" style={{ marginBottom: '0.45rem', color: '#fca5a5' }}>
                                            尚有 {deletePreviewData.unresolvedBridgeDecisionCount} 组未确认，不能删除。
                                        </p>
                                    )}
                                    <div className="admin-bridge-decision-list">
                                        {(deletePreviewSummary?.lostBridgePairs || []).map((pair, index) => {
                                            const pairKey = pair.pairKey;
                                            const selectedAction = deleteBridgeDecisions[pairKey] || '';
                                            return (
                                                <div key={pairKey || `del_bridge_${index}`} className="admin-bridge-decision-item">
                                                    <div className="admin-bridge-decision-line">
                                                        <span>{pair.upper?.displayName || '未知上级释义'}</span>
                                                        <span className="arrow">⇢ {getSenseTitleById(deletingNodeTarget, pair.sourceSenseId) || '当前释义'} ⇢</span>
                                                        <span>{pair.lower?.displayName || '未知下级释义'}</span>
                                                    </div>
                                                    <div className="admin-bridge-decision-actions">
                                                        <button
                                                            className={`admin-bridge-decision-btn ${selectedAction === 'reconnect' ? 'active reconnect' : ''}`}
                                                            onClick={() => {
                                                                const next = { ...deleteBridgeDecisions, [pairKey]: 'reconnect' };
                                                                setDeleteBridgeDecisions(next);
                                                                fetchDeleteNodePreview(deletingNodeTarget, next);
                                                            }}
                                                            disabled={deletePreviewLoading || isDeletingNode}
                                                        >
                                                            保留承接
                                                        </button>
                                                        <button
                                                            className={`admin-bridge-decision-btn ${selectedAction === 'disconnect' ? 'active disconnect' : ''}`}
                                                            onClick={() => {
                                                                const next = { ...deleteBridgeDecisions, [pairKey]: 'disconnect' };
                                                                setDeleteBridgeDecisions(next);
                                                                fetchDeleteNodePreview(deletingNodeTarget, next);
                                                            }}
                                                            disabled={deletePreviewLoading || isDeletingNode}
                                                        >
                                                            断开独立
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

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
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
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
                                <div className="search-input-group">
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="输入用户名..."
                                        value={masterSearchKeyword}
                                        onChange={(e) => {
                                            setMasterSearchKeyword(e.target.value);
                                            searchUsersForMaster(e.target.value);
                                        }}
                                    />
                                    <button className="btn btn-primary" onClick={() => searchUsersForMaster(masterSearchKeyword)}>
                                        <Search size={16} />
                                    </button>
                                </div>
                            </div>
                            {masterSearchResults.length > 0 && (
                                <div className="search-results">
                                    <h5>搜索结果:</h5>
                                    {masterSearchResults.map(user => (
                                        <div
                                            key={user._id}
                                            className={`search-result-item ${selectedNewMaster?._id === user._id ? 'selected' : ''}`}
                                            onClick={() => setSelectedNewMaster(user)}
                                        >
                                            <span>{user.username}</span>
                                            {selectedNewMaster?._id === user._id && <Check size={16} className="text-green-500" />}
                                        </div>
                                    ))}
                                </div>
                            )}
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

            {/* View Association Modal */}
            {showAssociationModal && viewingAssociationNode && (
                <div className="modal-backdrop" onClick={() => setShowAssociationModal(false)}>
                    <div className="modal-content association-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>节点关联详情: {viewingAssociationNode.name}</h2>
                            <button className="btn-close" onClick={() => setShowAssociationModal(false)}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="association-section">
                                <h4 className="section-title">母域节点</h4>
                                <p className="association-hint">当前节点拓展了以下节点（或者说，以下节点包含当前节点）</p>
                                <div className="association-list">
                                    {viewingAssociationNode.relatedParentDomains?.length > 0 ? (
                                        <ul>
                                            {viewingAssociationNode.relatedParentDomains.map((domain, i) => (
                                                <li key={i} className="domain-item parent-domain">
                                                    <span className="domain-badge parent">⬆ 母域</span>
                                                    {domain}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : <p className="empty-message">暂无母域节点</p>}
                                </div>
                            </div>
                            <div className="association-section">
                                <h4 className="section-title">子域节点</h4>
                                <p className="association-hint">以下节点拓展了当前节点（或者说，当前节点包含以下节点）</p>
                                <div className="association-list">
                                    {viewingAssociationNode.relatedChildDomains?.length > 0 ? (
                                        <ul>
                                            {viewingAssociationNode.relatedChildDomains.map((domain, i) => (
                                                <li key={i} className="domain-item child-domain">
                                                    <span className="domain-badge child">⬇ 子域</span>
                                                    {domain}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : <p className="empty-message">暂无子域节点</p>}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAssociationModal(false)}>关闭</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Association Modal */}
            {showEditAssociationModal && editingAssociationNode && (
                <div className="modal-backdrop" onClick={closeEditAssociationModal}>
                    <div className="modal-content admin-edit-association-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>编辑关联: {editingAssociationNode.name}</h3>
                            <button className="btn-close" onClick={closeEditAssociationModal}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="admin-edit-associations-section">
                                <div
                                    className="admin-edit-associations-header"
                                    onClick={() => setIsEditAssociationListExpanded(!isEditAssociationListExpanded)}
                                >
                                    <h4>
                                        关联关系
                                        <span className="association-count">({editAssociations.length})</span>
                                    </h4>
                                    {isEditAssociationListExpanded ? <ChevronUp className="icon-small" /> : <ChevronDown className="icon-small" />}
                                </div>

                                {isEditAssociationListExpanded && editAssociations.length > 0 && (
                                    <div className="admin-edit-associations-list">
                                        {editAssociations.map((association, index) => (
                                            <div
                                                key={index}
                                                className={`admin-edit-association-item ${assocCurrentStep === null ? 'clickable' : ''}`}
                                                onClick={() => {
                                                    if (assocCurrentStep === null) {
                                                        editExistingAssociation(index);
                                                    }
                                                }}
                                            >
                                                <div className="admin-edit-association-info">
                                                    <span className="admin-edit-association-display">{association.displayText}</span>
                                                    <span className={`admin-edit-relation-badge ${association.type}`}>
                                                        {association.type === ASSOC_RELATION_TYPES.EXTENDS && '母域'}
                                                        {association.type === ASSOC_RELATION_TYPES.CONTAINS && '子域'}
                                                        {association.type === ASSOC_RELATION_TYPES.INSERT && '插入'}
                                                    </span>
                                                </div>
                                                <div className="admin-edit-association-actions">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeEditAssociation(index);
                                                        }}
                                                        className="btn btn-danger btn-small"
                                                        disabled={assocCurrentStep !== null}
                                                    >
                                                        <X className="icon-small" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {editAssociations.length === 0 && !assocCurrentStep && (
                                    <p className="text-gray-400">暂无关联</p>
                                )}

                                {assocCurrentStep ? (
                                    <div className="admin-assoc-editor">
                                        {renderAssocStepIndicator()}
                                        {renderAssocCurrentStep()}

                                        <div className="admin-assoc-editor-navigation">
                                            <button onClick={goBackAssocStep} className="btn btn-secondary">
                                                <ArrowLeft className="icon-small" /> 返回
                                            </button>
                                            <button onClick={resetAssociationEditor} className="btn btn-danger">
                                                取消
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button onClick={startAddEditAssociation} className="btn btn-primary admin-add-association-btn">
                                        <Plus className="icon-small" /> 添加关联
                                    </button>
                                )}
                            </div>

                            <div className="admin-assoc-strategy-panel">
                                <div className="admin-assoc-strategy-header">
                                    <h4>删除关联处理策略</h4>
                                    <span className="admin-assoc-strategy-tip">先预览再确认保存</span>
                                </div>
                                <div className="admin-assoc-strategy-options">
                                    <button
                                        className={`admin-assoc-strategy-option ${assocRemovalStrategy === 'disconnect' ? 'active' : ''}`}
                                        onClick={() => {
                                            setAssocRemovalStrategy('disconnect');
                                            setAssocMutationPreview(null);
                                            setAssocBridgeDecisions({});
                                        }}
                                        disabled={assocPreviewLoading || assocApplyLoading}
                                    >
                                        直接断开
                                        <small>删除后不自动连接受影响的上级/下级</small>
                                    </button>
                                    <button
                                        className={`admin-assoc-strategy-option ${assocRemovalStrategy === 'reconnect' ? 'active' : ''}`}
                                        onClick={() => {
                                            setAssocRemovalStrategy('reconnect');
                                            setAssocMutationPreview(null);
                                            setAssocBridgeDecisions({});
                                        }}
                                        disabled={assocPreviewLoading || assocApplyLoading}
                                    >
                                        自动重连
                                        <small>删除后将受影响的上级/下级直接重新连接</small>
                                    </button>
                                </div>
                            </div>

                            {renderAssocMutationPreview()}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeEditAssociationModal}>取消</button>
                            <button
                                className="btn btn-secondary"
                                onClick={() => previewAssociationEdit()}
                                disabled={assocCurrentStep !== null || assocPreviewLoading || assocApplyLoading}
                            >
                                {assocPreviewLoading ? '预览中...' : '预览变更'}
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={saveAssociationEdit}
                                disabled={
                                    !assocMutationPreview
                                    || (assocMutationPreview?.unresolvedBridgeDecisionCount || 0) > 0
                                    || assocCurrentStep !== null
                                    || assocPreviewLoading
                                    || assocApplyLoading
                                }
                            >
                                {assocApplyLoading ? '保存中...' : '确认保存'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminPanel;
