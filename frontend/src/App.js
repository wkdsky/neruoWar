import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Home, Shield, Bell, Layers, Star, MapPin, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import io from 'socket.io-client';
import './App.css';
import Login from './components/auth/Login';
import AdminPanel from './components/admin/AdminPanel';
import AlliancePanel from './components/game/AlliancePanel';
import ProfilePanel from './components/game/ProfilePanel';
import ArmyPanel from './components/game/ArmyPanel';
import NodeDetail from './components/game/NodeDetail';
import HomeView from './components/game/Home';
import KnowledgeDomainScene from './components/game/KnowledgeDomainScene';
import SceneManager from './SceneManager';
import LocationSelectionModal from './LocationSelectionModal';
import AssociationModal from './components/modals/AssociationModal';
import NodeInfoModal from './components/modals/NodeInfoModal';
import CreateNodeModal from './components/modals/CreateNodeModal';

// 导入头像
import defaultMale1 from './assets/avatars/default_male_1.svg';
import defaultMale2 from './assets/avatars/default_male_2.svg';
import defaultMale3 from './assets/avatars/default_male_3.svg';
import defaultFemale1 from './assets/avatars/default_female_1.svg';
import defaultFemale2 from './assets/avatars/default_female_2.svg';
import defaultFemale3 from './assets/avatars/default_female_3.svg';

// 头像映射
const avatarMap = {
    default_male_1: defaultMale1,
    default_male_2: defaultMale2,
    default_male_3: defaultMale3,
    default_female_1: defaultFemale1,
    default_female_2: defaultFemale2,
    default_female_3: defaultFemale3
};

const PAGE_STATE_STORAGE_KEY = 'app:lastPageState';

const readSavedPageState = () => {
    try {
        const raw = localStorage.getItem(PAGE_STATE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const view = typeof parsed.view === 'string' ? parsed.view : '';
        const nodeId = typeof parsed.nodeId === 'string' ? parsed.nodeId : '';
        return { view, nodeId };
    } catch (error) {
        return null;
    }
};

const normalizeObjectId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value._id) return normalizeObjectId(value._id);
    if (typeof value.toString === 'function') return value.toString();
    return '';
};
const createHomeNavigationPath = () => ([
    { type: 'home', label: '首页' }
]);
const normalizeNavigationRelation = (relation) => (
    relation === 'parent' || relation === 'child' ? relation : 'jump'
);
const buildNavigationTrailItem = (node, relation = 'jump', options = {}) => {
    const nodeId = normalizeObjectId(node?._id);
    if (!nodeId) return null;
    const nodeTitle = typeof node?.name === 'string' ? node.name.trim() : '';
    const senseTitle = typeof node?.activeSenseTitle === 'string' ? node.activeSenseTitle.trim() : '';
    const displayLabel = senseTitle ? `${nodeTitle}-${senseTitle}` : nodeTitle;
    const mode = options?.mode === 'title' ? 'title' : 'sense';
    return {
        type: 'node',
        label: (mode === 'title' ? nodeTitle : displayLabel) || '未命名知识域',
        nodeId,
        senseId: mode === 'sense' && typeof node?.activeSenseId === 'string' ? node.activeSenseId : '',
        relation: normalizeNavigationRelation(relation),
        mode
    };
};
const getNavigationRelationFromSceneNode = (sceneNode) => {
    if (sceneNode?.type === 'parent') return 'parent';
    if (sceneNode?.type === 'child') return 'child';
    return 'jump';
};
const getNodePrimarySense = (node) => {
    const senses = Array.isArray(node?.synonymSenses) ? node.synonymSenses : [];
    if (typeof node?.activeSenseId === 'string' && node.activeSenseId.trim()) {
        const matched = senses.find((item) => item?.senseId === node.activeSenseId.trim());
        if (matched) return matched;
    }
    return senses[0] || null;
};
const getNodeDisplayName = (node) => {
    if (typeof node?.displayName === 'string' && node.displayName.trim()) return node.displayName.trim();
    const name = typeof node?.name === 'string' ? node.name.trim() : '';
    const senseTitle = typeof node?.activeSenseTitle === 'string' && node.activeSenseTitle.trim()
        ? node.activeSenseTitle.trim()
        : (typeof getNodePrimarySense(node)?.title === 'string' ? getNodePrimarySense(node).title.trim() : '');
    return senseTitle ? `${name}-${senseTitle}` : (name || '未命名知识域');
};
const getNodeSenseTitle = (node) => {
    if (typeof node?.activeSenseTitle === 'string' && node.activeSenseTitle.trim()) return node.activeSenseTitle.trim();
    const sense = getNodePrimarySense(node);
    return typeof sense?.title === 'string' ? sense.title.trim() : '';
};
const getNodeSenseContent = (node) => {
    if (typeof node?.activeSenseContent === 'string' && node.activeSenseContent.trim()) return node.activeSenseContent.trim();
    const sense = getNodePrimarySense(node);
    if (typeof sense?.content === 'string' && sense.content.trim()) return sense.content.trim();
    if (typeof node?.knowledge === 'string' && node.knowledge.trim()) return node.knowledge.trim();
    return '';
};
const hexToRgba = (hex, alpha = 1) => {
    const safeHex = typeof hex === 'string' ? hex.trim() : '';
    if (!/^#[0-9a-fA-F]{6}$/.test(safeHex)) return `rgba(30, 41, 59, ${alpha})`;
    const r = Number.parseInt(safeHex.slice(1, 3), 16);
    const g = Number.parseInt(safeHex.slice(3, 5), 16);
    const b = Number.parseInt(safeHex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const ANNOUNCEMENT_NOTIFICATION_TYPES = ['domain_distribution_announcement', 'alliance_announcement'];
const isAnnouncementNotification = (notification) => (
    ANNOUNCEMENT_NOTIFICATION_TYPES.includes(notification?.type)
);
const RIGHT_DOCK_COLLAPSE_MS = 220;
const isKnowledgeDetailView = (value) => value === 'nodeDetail' || value === 'titleDetail';
const isTitleBattleView = (value) => value === 'titleDetail';
const createEmptyNodeDistributionStatus = () => ({
    nodeId: '',
    active: false,
    phase: 'none',
    requiresManualEntry: false,
    joined: false,
    canJoin: false,
    canExit: false,
    joinTip: ''
});
const createDefaultDistributionPanelState = () => ({
    loading: false,
    joining: false,
    exiting: false,
    error: '',
    feedback: '',
    data: null
});
const createEmptyIntelHeistStatus = () => ({
    loading: false,
    nodeId: '',
    canSteal: false,
    reason: '',
    latestSnapshot: null
});
const CITY_GATE_LABEL_MAP = {
    cheng: '承门',
    qi: '启门'
};
const normalizeSiegeUnitEntries = (entries = []) => (
    (Array.isArray(entries) ? entries : [])
        .map((entry) => ({
            unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
            unitName: typeof entry?.unitName === 'string' ? entry.unitName : '',
            count: Math.max(0, Math.floor(Number(entry?.count) || 0))
        }))
        .filter((entry) => entry.unitTypeId && entry.count > 0)
);
const normalizeSiegeGateState = (gateState = {}, gateKey = '') => {
    const attackers = (Array.isArray(gateState?.attackers) ? gateState.attackers : [])
        .map((attacker) => ({
            userId: normalizeObjectId(attacker?.userId),
            username: typeof attacker?.username === 'string' ? attacker.username : '',
            status: typeof attacker?.status === 'string' ? attacker.status : 'sieging',
            statusLabel: typeof attacker?.statusLabel === 'string' ? attacker.statusLabel : '',
            isInitiator: !!attacker?.isInitiator,
            isReinforcement: !!attacker?.isReinforcement,
            fromNodeName: typeof attacker?.fromNodeName === 'string' ? attacker.fromNodeName : '',
            autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(attacker?.autoRetreatPercent) || 40))),
            totalCount: Math.max(0, Math.floor(Number(attacker?.totalCount) || 0)),
            remainingSeconds: Math.max(0, Math.floor(Number(attacker?.remainingSeconds) || 0)),
            units: normalizeSiegeUnitEntries(attacker?.units)
        }))
        .filter((attacker) => !!attacker.userId);
    return {
        gateKey: gateState?.gateKey || gateKey || '',
        gateLabel: gateState?.gateLabel || CITY_GATE_LABEL_MAP[gateKey] || gateKey,
        enabled: !!gateState?.enabled,
        active: !!gateState?.active,
        attackerAllianceId: normalizeObjectId(gateState?.attackerAllianceId),
        initiatorUserId: normalizeObjectId(gateState?.initiatorUserId),
        initiatorUsername: typeof gateState?.initiatorUsername === 'string' ? gateState.initiatorUsername : '',
        supportNotifiedAt: gateState?.supportNotifiedAt || null,
        totalCount: Math.max(0, Math.floor(Number(gateState?.totalCount) || 0)),
        aggregateUnits: normalizeSiegeUnitEntries(gateState?.aggregateUnits),
        attackers
    };
};
const createEmptySiegeStatus = () => ({
    loading: false,
    viewerRole: 'common',
    nodeId: '',
    nodeName: '',
    hasActiveSiege: false,
    activeGateKeys: [],
    preferredGate: '',
    compareGate: '',
    canStartSiege: false,
    startDisabledReason: '',
    canRequestSupport: false,
    canSupportSameBattlefield: false,
    supportDisabledReason: '',
    supportGate: '',
    canRetreat: false,
    retreatDisabledReason: '',
    ownRoster: { totalCount: 0, units: [] },
    compare: {
        gateKey: '',
        gateLabel: '',
        attacker: { totalCount: 0, units: [], supporters: [] },
        defender: { source: 'unknown', totalCount: null, gates: [] }
    },
    intelUsed: false,
    intelCapturedAt: null,
    intelDeploymentUpdatedAt: null,
    gateStates: {
        cheng: normalizeSiegeGateState({}, 'cheng'),
        qi: normalizeSiegeGateState({}, 'qi')
    }
});
const normalizeSiegeStatus = (raw = {}, fallbackNodeId = '') => {
    const source = raw && typeof raw === 'object' ? raw : {};
    const gateStatesSource = source?.gateStates && typeof source.gateStates === 'object' ? source.gateStates : {};
    const compareSource = source?.compare && typeof source.compare === 'object' ? source.compare : {};
    const defenderSource = compareSource?.defender && typeof compareSource.defender === 'object' ? compareSource.defender : {};
    const attackerSource = compareSource?.attacker && typeof compareSource.attacker === 'object' ? compareSource.attacker : {};
    const viewerRole = source?.viewerRole === 'domainMaster' || source?.viewerRole === 'domainAdmin'
        ? source.viewerRole
        : 'common';
    return {
        loading: false,
        viewerRole,
        nodeId: normalizeObjectId(source.nodeId) || fallbackNodeId || '',
        nodeName: typeof source.nodeName === 'string' ? source.nodeName : '',
        hasActiveSiege: !!source.hasActiveSiege,
        activeGateKeys: Array.isArray(source.activeGateKeys) ? source.activeGateKeys.filter((key) => key === 'cheng' || key === 'qi') : [],
        preferredGate: typeof source.preferredGate === 'string' ? source.preferredGate : '',
        compareGate: typeof source.compareGate === 'string' ? source.compareGate : '',
        canStartSiege: !!source.canStartSiege,
        startDisabledReason: typeof source.startDisabledReason === 'string' ? source.startDisabledReason : '',
        canRequestSupport: !!source.canRequestSupport,
        canSupportSameBattlefield: !!source.canSupportSameBattlefield,
        supportDisabledReason: typeof source.supportDisabledReason === 'string' ? source.supportDisabledReason : '',
        supportGate: typeof source.supportGate === 'string' ? source.supportGate : '',
        canRetreat: !!source.canRetreat,
        retreatDisabledReason: typeof source.retreatDisabledReason === 'string' ? source.retreatDisabledReason : '',
        ownRoster: {
            totalCount: Math.max(0, Math.floor(Number(source?.ownRoster?.totalCount) || 0)),
            units: normalizeSiegeUnitEntries(source?.ownRoster?.units)
        },
        compare: {
            gateKey: typeof compareSource.gateKey === 'string' ? compareSource.gateKey : '',
            gateLabel: typeof compareSource.gateLabel === 'string' ? compareSource.gateLabel : '',
            attacker: {
                totalCount: Math.max(0, Math.floor(Number(attackerSource.totalCount) || 0)),
                units: normalizeSiegeUnitEntries(attackerSource.units),
                supporters: Array.isArray(attackerSource.supporters)
                    ? attackerSource.supporters.map((item) => ({
                        userId: normalizeObjectId(item?.userId),
                        username: typeof item?.username === 'string' ? item.username : '',
                        totalCount: Math.max(0, Math.floor(Number(item?.totalCount) || 0)),
                        status: typeof item?.status === 'string' ? item.status : '',
                        statusLabel: typeof item?.statusLabel === 'string' ? item.statusLabel : ''
                    }))
                    : []
            },
            defender: {
                source: defenderSource?.source === 'intel' ? 'intel' : 'unknown',
                totalCount: Number.isFinite(Number(defenderSource?.totalCount))
                    ? Math.max(0, Math.floor(Number(defenderSource.totalCount)))
                    : null,
                gates: Array.isArray(defenderSource?.gates)
                    ? defenderSource.gates.map((gate) => ({
                        gateKey: typeof gate?.gateKey === 'string' ? gate.gateKey : '',
                        gateLabel: typeof gate?.gateLabel === 'string' ? gate.gateLabel : '',
                        highlight: !!gate?.highlight,
                        unknown: !!gate?.unknown,
                        enabled: !!gate?.enabled,
                        totalCount: Number.isFinite(Number(gate?.totalCount))
                            ? Math.max(0, Math.floor(Number(gate?.totalCount)))
                            : null,
                        entries: normalizeSiegeUnitEntries(gate?.entries)
                    }))
                    : []
            }
        },
        intelUsed: !!source.intelUsed,
        intelCapturedAt: source.intelCapturedAt || null,
        intelDeploymentUpdatedAt: source.intelDeploymentUpdatedAt || null,
        gateStates: {
            cheng: normalizeSiegeGateState(gateStatesSource.cheng, 'cheng'),
            qi: normalizeSiegeGateState(gateStatesSource.qi, 'qi')
        }
    };
};

const getIntelSnapshotAgeMinutesText = (snapshot) => {
    const capturedAtMs = new Date(snapshot?.capturedAt || 0).getTime();
    if (!Number.isFinite(capturedAtMs) || capturedAtMs <= 0) return '';
    const diffMs = Math.max(0, Date.now() - capturedAtMs);
    const minutes = Math.floor(diffMs / 60000);
    if (minutes <= 60) {
        return `${minutes}分钟`;
    }
    const hours = diffMs / 3600000;
    if (hours > 24) {
        return '>1天前';
    }
    return `${hours.toFixed(1)}小时前`;
};

const formatDateTimeText = (value) => {
    const ms = new Date(value || 0).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return '未知';
    return new Date(ms).toLocaleString('zh-CN', { hour12: false });
};

const getElapsedMinutesText = (value) => {
    const ms = new Date(value || 0).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const diffMs = Math.max(0, Date.now() - ms);
    const minutes = Math.floor(diffMs / 60000);
    if (minutes <= 60) {
        return `${minutes}分钟`;
    }
    const hours = diffMs / 3600000;
    if (hours > 24) {
        return '>1天前';
    }
    return `${hours.toFixed(1)}小时前`;
};

const normalizeIntelSnapshotGateEntries = (entries = []) => (
    (Array.isArray(entries) ? entries : [])
        .map((entry) => ({
            unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
            unitName: typeof entry?.unitName === 'string' ? entry.unitName : '',
            count: Math.max(0, Math.floor(Number(entry?.count) || 0))
        }))
        .filter((entry) => entry.unitTypeId && entry.count > 0)
);

const normalizeIntelSnapshot = (snapshot = {}) => {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    return {
        nodeId: typeof source.nodeId === 'string' ? source.nodeId : '',
        nodeName: typeof source.nodeName === 'string' ? source.nodeName : '',
        sourceBuildingId: typeof source.sourceBuildingId === 'string' ? source.sourceBuildingId : '',
        deploymentUpdatedAt: source.deploymentUpdatedAt || null,
        capturedAt: source.capturedAt || null,
        gateDefense: {
            cheng: normalizeIntelSnapshotGateEntries(source?.gateDefense?.cheng),
            qi: normalizeIntelSnapshotGateEntries(source?.gateDefense?.qi)
        }
    };
};
const formatCountdownText = (seconds) => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const day = Math.floor(total / 86400);
    const hour = Math.floor((total % 86400) / 3600);
    const minute = Math.floor((total % 3600) / 60);
    const second = total % 60;
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    const ss = String(second).padStart(2, '0');
    if (day > 0) {
        return `${day}天 ${hh}:${mm}:${ss}`;
    }
    return `${hh}:${mm}:${ss}`;
};

const App = () => {
    const [socket, setSocket] = useState(null);
    const [authenticated, setAuthenticated] = useState(false);
    const [username, setUsername] = useState('');
    const [profession, setProfession] = useState('');
    const [userAvatar, setUserAvatar] = useState('default_male_1');
    const [nodes, setNodes] = useState([]);
    const [technologies, setTechnologies] = useState([]);
    const [view, setView] = useState('login');
    const socketRef = useRef(null);
    const isRestoringPageRef = useRef(false);
    const hasRestoredPageRef = useRef(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminEntryTab, setAdminEntryTab] = useState('users');


    // 修改检查登录状态的useEffect
    useEffect(() => {
        const token = localStorage.getItem('token');
        const storedUsername = localStorage.getItem('username');
        const storedLocation = localStorage.getItem('userLocation');
        const storedProfession = localStorage.getItem('profession');
        const storedAvatar = localStorage.getItem('userAvatar');

        if (token && storedUsername) {
            setAuthenticated(true);
            setUsername(storedUsername);
            setProfession(storedProfession || '');
            setUserLocation(storedLocation || '');
            setUserAvatar(storedAvatar || 'default_male_1');

            // 如果location为空，需要显示位置选择弹窗
            if (!storedLocation || storedLocation === '') {
                // 先获取热门节点，然后显示弹窗
                fetchFeaturedNodes();
                setShowLocationModal(true);
            } else {
                setView('home');
            }

            // 如果socket已连接，重新认证
            if (socket && socket.connected) {
                socket.emit('authenticate', token);
                setTimeout(() => {
                    socket.emit('getGameState');
                }, 200);
            }

            // 检查管理员状态
            checkAdminStatus();
        }
    }, []); // 只在组件挂载时执行一次

    useEffect(() => {
        if (!authenticated) {
            hasRestoredPageRef.current = false;
            isRestoringPageRef.current = false;
        }
    }, [authenticated]);


    // 新节点创建状态
    const [showCreateNodeModal, setShowCreateNodeModal] = useState(false);
    
    // 关联显示状态
    const [showAssociationModal, setShowAssociationModal] = useState(false);
    const [viewingAssociationNode, setViewingAssociationNode] = useState(null);



    // 用户位置相关状态
    const [userLocation, setUserLocation] = useState('');
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [selectedLocationNode, setSelectedLocationNode] = useState(null);
    const [currentLocationNodeDetail, setCurrentLocationNodeDetail] = useState(null);
    const [travelStatus, setTravelStatus] = useState({ isTraveling: false });
    const [nodeDistributionStatus, setNodeDistributionStatus] = useState(createEmptyNodeDistributionStatus);
    const [showDistributionPanel, setShowDistributionPanel] = useState(false);
    const [distributionPanelState, setDistributionPanelState] = useState(createDefaultDistributionPanelState);
    const [isStoppingTravel, setIsStoppingTravel] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
    const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
    const [isNotificationsLoading, setIsNotificationsLoading] = useState(false);
    const [isClearingNotifications, setIsClearingNotifications] = useState(false);
    const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
    const [isMarkingAnnouncementsRead, setIsMarkingAnnouncementsRead] = useState(false);
    const [isLocationDockExpanded, setIsLocationDockExpanded] = useState(false);
    const [isAnnouncementDockExpanded, setIsAnnouncementDockExpanded] = useState(false);
    const [announcementDockTab, setAnnouncementDockTab] = useState('system');
    const [notificationActionId, setNotificationActionId] = useState('');
    const [adminPendingNodes, setAdminPendingNodes] = useState([]);
    const [showRelatedDomainsPanel, setShowRelatedDomainsPanel] = useState(false);
    const [relatedDomainsData, setRelatedDomainsData] = useState({
        loading: false,
        error: '',
        domainMasterDomains: [],
        domainAdminDomains: [],
        favoriteDomains: [],
        recentDomains: []
    });
    const [favoriteActionDomainId, setFavoriteActionDomainId] = useState('');

    // 首页相关状态
    const [rootNodes, setRootNodes] = useState([]);
    const [featuredNodes, setFeaturedNodes] = useState([]);
    const [homeSearchQuery, setHomeSearchQuery] = useState('');
    const [homeSearchResults, setHomeSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSearchResults, setShowSearchResults] = useState(false); // 控制搜索结果的显示/隐藏，默认隐藏

    // 节点详情页面相关状态
    const [currentNodeDetail, setCurrentNodeDetail] = useState(null);
    const [currentTitleDetail, setCurrentTitleDetail] = useState(null);
    const [titleGraphData, setTitleGraphData] = useState(null);
    const [nodeInfoModalTarget, setNodeInfoModalTarget] = useState(null);
    const [titleRelationInfo, setTitleRelationInfo] = useState(null);
    const [senseSelectorSourceNode, setSenseSelectorSourceNode] = useState(null);
    const [senseSelectorAnchor, setSenseSelectorAnchor] = useState({ x: 0, y: 0, visible: false });
    const [isSenseSelectorVisible, setIsSenseSelectorVisible] = useState(false);
    const [showNodeInfoModal, setShowNodeInfoModal] = useState(false);
    const [isApplyingDomainMaster, setIsApplyingDomainMaster] = useState(false);
    const [intelHeistStatus, setIntelHeistStatus] = useState(createEmptyIntelHeistStatus);
    const [intelHeistDialog, setIntelHeistDialog] = useState({
        open: false,
        loading: false,
        node: null,
        snapshot: null,
        error: ''
    });
    const [siegeStatus, setSiegeStatus] = useState(createEmptySiegeStatus);
    const [siegeDialog, setSiegeDialog] = useState({
        open: false,
        loading: false,
        submitting: false,
        supportSubmitting: false,
        node: null,
        error: '',
        message: ''
    });
    const [siegeSupportDraft, setSiegeSupportDraft] = useState({
        gateKey: '',
        autoRetreatPercent: 40,
        units: {}
    });
    const [siegeSupportStatuses, setSiegeSupportStatuses] = useState([]);


    // 导航路径相关状态
    const [navigationPath, setNavigationPath] = useState(() => createHomeNavigationPath());

    // 知识域场景相关状态
    const [showKnowledgeDomain, setShowKnowledgeDomain] = useState(false);
    const [knowledgeDomainNode, setKnowledgeDomainNode] = useState(null);
    const [knowledgeDomainMode, setKnowledgeDomainMode] = useState('normal');
    const [domainTransitionProgress, setDomainTransitionProgress] = useState(0);
    const [isTransitioningToDomain, setIsTransitioningToDomain] = useState(false);

    // WebGL场景管理
    const webglCanvasRef = useRef(null);
    const sceneManagerRef = useRef(null);
    const [isWebGLReady, setIsWebGLReady] = useState(false);
    const [clickedNodeForTransition, setClickedNodeForTransition] = useState(null);
    const [canvasKey, setCanvasKey] = useState(0); // 用于强制重新渲染canvas

    // 搜索栏相关引用
    const searchBarRef = useRef(null);
    const headerRef = useRef(null);
    const notificationsWrapperRef = useRef(null);
    const relatedDomainsWrapperRef = useRef(null);
    const senseSelectorAnchorRef = useRef({ x: 0, y: 0, visible: false });
    const [knowledgeHeaderOffset, setKnowledgeHeaderOffset] = useState(92);

    useLayoutEffect(() => {
        const headerEl = headerRef.current;
        if (!headerEl) return undefined;

        let frameId = null;
        const syncHeaderOffset = () => {
            const rect = headerEl.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(headerEl);
            const marginBottom = Number.parseFloat(computedStyle?.marginBottom || '0') || 0;
            const nextOffset = Math.max(0, Math.ceil(rect.height + marginBottom));
            setKnowledgeHeaderOffset((prev) => (
                Math.abs(prev - nextOffset) >= 1 ? nextOffset : prev
            ));
        };
        const scheduleSync = () => {
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
            }
            frameId = requestAnimationFrame(() => {
                frameId = null;
                syncHeaderOffset();
            });
        };

        scheduleSync();
        window.addEventListener('resize', scheduleSync);

        let resizeObserver = null;
        if (typeof ResizeObserver === 'function') {
            resizeObserver = new ResizeObserver(() => {
                scheduleSync();
            });
            resizeObserver.observe(headerEl);
        }

        return () => {
            window.removeEventListener('resize', scheduleSync);
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
            }
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
        };
    }, [showKnowledgeDomain, isTransitioningToDomain, view]);

    // 初始化WebGL场景
    useEffect(() => {
        const canvas = webglCanvasRef.current;
        if (!canvas) {
            // canvas不存在时，清理旧的场景管理器
            if (sceneManagerRef.current) {
                sceneManagerRef.current.destroy();
                sceneManagerRef.current = null;
                setIsWebGLReady(false);
            }
            return;
        }

        // 每次view变化时，清理并重新创建场景管理器
        if (sceneManagerRef.current) {
            sceneManagerRef.current.destroy();
            sceneManagerRef.current = null;
        }

        try {
            const parent = canvas.parentElement;
            if (!parent) return;

            // 设置canvas大小
            const rect = parent.getBoundingClientRect();
            canvas.width = rect.width || 800;
            canvas.height = rect.height || 600;

            // 创建场景管理器
            const sceneManager = new SceneManager(canvas);

            // 设置点击回调
            sceneManager.onNodeClick = (node) => {
                if (!node.data || !node.data._id) return;
                if (view === 'home') {
                    setTitleRelationInfo(null);
                    setSenseSelectorSourceNode(node.data);
                    updateSenseSelectorAnchorBySceneNode(node);
                    setIsSenseSelectorVisible(true);
                    return;
                }

                if (view === 'titleDetail') {
                    setTitleRelationInfo(null);
                    if (node.type === 'center') {
                        setSenseSelectorSourceNode(currentTitleDetail || node.data);
                        updateSenseSelectorAnchorBySceneNode(node);
                        setIsSenseSelectorVisible((prev) => !prev);
                        return;
                    }
                    fetchTitleDetail(node.data._id, node, {
                        relationHint: getNavigationRelationFromSceneNode(node)
                    });
                    return;
                }

                if (view === 'nodeDetail') {
                    setTitleRelationInfo(null);
                    if (node.type === 'center') {
                        setSenseSelectorSourceNode(currentNodeDetail || node.data);
                        updateSenseSelectorAnchorBySceneNode(node);
                        setIsSenseSelectorVisible((prev) => !prev);
                        return;
                    }
                    fetchNodeDetail(node.data._id, node, {
                        relationHint: getNavigationRelationFromSceneNode(node),
                        activeSenseId: typeof node?.data?.activeSenseId === 'string' ? node.data.activeSenseId : ''
                    });
                    return;
                }
            };

            sceneManager.onLineClick = (lineHit) => {
                if (view !== 'titleDetail') return;
                const meta = lineHit?.line?.edgeMeta;
                if (!meta) return;
                setIsSenseSelectorVisible(false);
                setTitleRelationInfo(meta);
            };

            // 设置按钮点击回调
            sceneManager.onButtonClick = (nodeId, button) => {
                const actionNode = isTitleBattleView(view) ? currentTitleDetail : currentNodeDetail;
                if (button.action === 'enterKnowledgeDomain') {
                    if (actionNode) {
                        handleEnterKnowledgeDomain(actionNode);
                    }
                } else if (button.action === 'siegeDomain' && actionNode) {
                    handleSiegeAction(actionNode);
                } else if (button.action === 'intelSteal' && actionNode) {
                    handleIntelHeistAction(actionNode);
                } else if (button.action === 'joinDistribution' && actionNode) {
                    handleDistributionParticipationAction(actionNode);
                } else if (button.action === 'moveToNode' && actionNode) {
                    handleMoveToNode(actionNode);
                } else if (button.action === 'toggleFavoriteNode' && actionNode?._id) {
                    toggleFavoriteDomain(actionNode._id);
                } else if (button.action === 'showSenseEntry' && view === 'nodeDetail' && currentNodeDetail) {
                    setNodeInfoModalTarget(currentNodeDetail);
                    setShowNodeInfoModal(true);
                }
            };

            sceneManagerRef.current = sceneManager;
            setIsWebGLReady(true);

            // 监听窗口大小变化
            const handleResize = () => {
                const newRect = parent.getBoundingClientRect();
                if (newRect.width > 0 && newRect.height > 0) {
                    canvas.width = newRect.width;
                    canvas.height = newRect.height;
                    if (sceneManagerRef.current) {
                        sceneManagerRef.current.resize(newRect.width, newRect.height);
                    }
                }
            };

            window.addEventListener('resize', handleResize);

            return () => {
                window.removeEventListener('resize', handleResize);
            };
        } catch (error) {
            console.error('WebGL初始化失败:', error);
        }
    }, [view, canvasKey]); // 添加canvasKey作为依赖，用于强制重新初始化

    // 更新按钮点击回调（确保获取最新的当前主视角节点）
    useEffect(() => {
        if (sceneManagerRef.current) {
            sceneManagerRef.current.onButtonClick = (nodeId, button) => {
                const actionNode = isTitleBattleView(view) ? currentTitleDetail : currentNodeDetail;
                if (button.action === 'enterKnowledgeDomain' && actionNode) {
                    handleEnterKnowledgeDomain(actionNode);
                } else if (button.action === 'siegeDomain' && actionNode) {
                    handleSiegeAction(actionNode);
                } else if (button.action === 'intelSteal' && actionNode) {
                    handleIntelHeistAction(actionNode);
                } else if (button.action === 'joinDistribution' && actionNode) {
                    handleDistributionParticipationAction(actionNode);
                } else if (button.action === 'moveToNode' && actionNode) {
                    handleMoveToNode(actionNode);
                } else if (button.action === 'toggleFavoriteNode' && actionNode?._id) {
                    toggleFavoriteDomain(actionNode._id);
                } else if (button.action === 'showSenseEntry' && view === 'nodeDetail' && currentNodeDetail) {
                    setNodeInfoModalTarget(currentNodeDetail);
                    setShowNodeInfoModal(true);
                }
            };
        }
    }, [view, currentNodeDetail, currentTitleDetail, isAdmin, userLocation, travelStatus.isTraveling, nodeDistributionStatus, intelHeistStatus, siegeStatus]);

    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        sceneManagerRef.current.setUserState(userLocation, travelStatus);
    }, [isWebGLReady, userLocation, travelStatus]);

    useEffect(() => {
        // 只在没有socket时初始化
        if (!socketRef.current) {
            initializeSocket();
        }
    
        const newSocket = io('http://localhost:5000', {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: 5,
            timeout: 20000,
            autoConnect: true
        });
        
        newSocket.on('connect', () => {
            console.log('WebSocket 连接成功:', newSocket.id);
            // 如果用户已经登录，自动认证
            const token = localStorage.getItem('token');
            if (token) {
                newSocket.emit('authenticate', token);
            }
        });
    
        newSocket.on('connect_error', (error) => {
            console.error('WebSocket 连接错误:', error);
        });
    
        newSocket.on('disconnect', (reason) => {
            console.log('WebSocket 断开连接:', reason);
        });
    
        socketRef.current = newSocket;
        setSocket(newSocket);

        return () => {
            if (socketRef.current) {
                socketRef.current.removeAllListeners();
                socketRef.current.close();
                socketRef.current = null;
            }
        };
    }, []);


  const handleLoginSuccess = async (data) => {
    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
    localStorage.setItem('userLocation', data.location || '');
    localStorage.setItem('profession', data.profession || '求知');
    localStorage.setItem('userAvatar', data.avatar || 'default_male_1');
    setAuthenticated(true);
    setUsername(data.username);
    setProfession(data.profession || '求知');
    setUserLocation(data.location || '');
    setUserAvatar(data.avatar || 'default_male_1');

    // 重新初始化socket连接（连接事件中会处理认证）
    initializeSocket(data.token);

    await checkAdminStatus();
    if (data.role !== 'admin') {
      fetchTravelStatus(true);
    } else {
      setTravelStatus({ isTraveling: false });
    }

    // 检查location字段，如果为空且不是管理员，显示位置选择弹窗
    if (!data.location || data.location === '') {
      if (data.role === 'admin') {
        // 管理员自动设置location为"任意"
        await updateUserLocation('任意');
        setUserLocation('任意');
        localStorage.setItem('userLocation', '任意');
        setView('home');
      } else {
        // 普通用户显示位置选择弹窗
        setShowLocationModal(true);
        // 不设置view，保持在登录状态但显示弹窗
      }
    } else {
      setView('home');
    }
  };

  // 更新用户location
  const updateUserLocation = async (location) => {
    const token = localStorage.getItem('token');
    try {
      console.log('正在更新location:', location);
      const response = await fetch('http://localhost:5000/api/location', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ location })
      });

      const data = await response.json();

      if (response.ok) {
        console.log('location更新成功:', data.location);
        return data.location;
      } else {
        console.error('location更新失败:', data);
        window.alert(`设置降临位置失败: ${data.error || '未知错误'}`);
        return null;
      }
    } catch (error) {
      console.error('更新location失败:', error);
      window.alert(`网络错误: ${error.message}`);
      return null;
    }
  };

  // 处理位置选择确认
  const handleLocationConfirm = async (selectedNode) => {
    console.log('用户选择的节点:', selectedNode);

    if (!selectedNode || !selectedNode.name) {
      window.alert('选择的节点无效，请重新选择');
      return;
    }

    const locationName = selectedNode.name;
    const updatedLocation = await updateUserLocation(locationName);

    if (updatedLocation) {
      setUserLocation(updatedLocation);
      setSelectedLocationNode(selectedNode);
      setCurrentLocationNodeDetail(selectedNode);
      localStorage.setItem('userLocation', updatedLocation);

      // 关闭modal并切换到home视图
      setShowLocationModal(false);
      setView('home');

      // 强制重新初始化WebGL（确保canvas渲染后再初始化）
      setTimeout(() => {
        setCanvasKey(prev => prev + 1);
      }, 50);
    }
    // 如果失败，updateUserLocation已经显示了错误消息，保持弹窗打开
  };

  // 根据location名称获取节点详细信息
  const fetchLocationNodeDetail = async (locationName) => {
    if (!locationName || locationName === '' || locationName === '任意') {
      setCurrentLocationNodeDetail(null);
      return;
    }

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/public/search?query=${encodeURIComponent(locationName)}`);
      if (response.ok) {
        const data = await response.json();
        // 精确匹配节点名称
        const exactMatch = (Array.isArray(data?.results) ? data.results : []).find((item) => (
            (typeof item?.domainName === 'string' && item.domainName === locationName)
            || (typeof item?.name === 'string' && item.name === locationName)
        ));
        if (exactMatch) {
          // 获取完整的节点详情
          const detailNodeId = normalizeObjectId(exactMatch.nodeId || exactMatch._id);
          const detailResponse = await fetch(`http://localhost:5000/api/nodes/public/node-detail/${detailNodeId}`);
          if (detailResponse.ok) {
            const detailData = await detailResponse.json();
            setCurrentLocationNodeDetail(detailData.node);
          } else {
            setCurrentLocationNodeDetail(exactMatch);
          }
        }
      }
    } catch (error) {
      console.error('获取位置节点详情失败:', error);
    }
  };

  const syncUserLocation = (location) => {
    if (!location || location === '任意') {
      setUserLocation(location || '');
      localStorage.setItem('userLocation', location || '');
      return;
    }
    setUserLocation(location);
    localStorage.setItem('userLocation', location);
  };

  const parseApiResponse = async (response) => {
    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (e) {
      data = null;
    }
    return { response, data, rawText };
  };

  const getApiErrorMessage = ({ response, data, rawText }, fallbackText) => {
    if (data?.error) return data.error;
    if (data?.message) return data.message;
    if (typeof rawText === 'string' && rawText.includes('Cannot POST /api/travel/start')) {
      return '移动接口不存在（后端可能未重启，请重启后端服务）';
    }
    if (typeof rawText === 'string' && rawText.includes('Cannot GET /api/travel/status')) {
      return '移动状态接口不存在（后端可能未重启，请重启后端服务）';
    }
    if (typeof rawText === 'string' && rawText.includes('Cannot POST /api/travel/stop')) {
      return '停止移动接口不存在（后端可能未重启，请重启后端服务）';
    }
    if (typeof rawText === 'string' && rawText.includes('Cannot POST /api/travel/estimate')) {
      return '移动预估接口不存在（后端可能未重启，请重启后端服务）';
    }
    return `${fallbackText}（HTTP ${response.status}）`;
  };

  const fetchRelatedDomains = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    if (!silent) {
      setRelatedDomainsData((prev) => ({ ...prev, loading: true, error: '' }));
    }

    try {
      const response = await fetch('http://localhost:5000/api/nodes/me/related-domains', {
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
  };

  const toggleFavoriteDomain = async (domainId) => {
    const token = localStorage.getItem('token');
    const normalizedId = normalizeObjectId(domainId);
    if (!token || !normalizedId) return;

    setFavoriteActionDomainId(normalizedId);
    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${normalizedId}/favorite`, {
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
  };

  const trackRecentDomain = async (nodeOrId) => {
    const token = localStorage.getItem('token');
    const domainId = normalizeObjectId(nodeOrId?._id || nodeOrId);
    if (!token || !domainId) return;

    try {
      await fetch(`http://localhost:5000/api/nodes/${domainId}/recent-visit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      // 最近访问记录失败不影响主流程
    }
  };

  const formatDomainKnowledgePoint = (node) => {
    const value = Number(node?.knowledgePoint?.value);
    if (!Number.isFinite(value)) return '知识点: --';
    return `知识点: ${value.toFixed(2)}`;
  };

  const fetchNotifications = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    if (!silent) {
      setIsNotificationsLoading(true);
    }

    try {
      const response = await fetch('http://localhost:5000/api/notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
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
  };

  const fetchAdminPendingNodeReminders = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token || !isAdmin) {
      setAdminPendingNodes([]);
      return [];
    }

    try {
      const response = await fetch('http://localhost:5000/api/nodes/pending', {
        headers: { 'Authorization': `Bearer ${token}` }
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
  };

  const markNotificationRead = async (notificationId) => {
    const token = localStorage.getItem('token');
    if (!token || !notificationId) return;
    const target = notifications.find((item) => item._id === notificationId);
    if (target?.read) return;

    try {
      const response = await fetch(`http://localhost:5000/api/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
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
  };

  const markAllNotificationsRead = async () => {
    const token = localStorage.getItem('token');
    if (!token || notificationUnreadCount <= 0) return;

    setIsMarkingAllRead(true);
    try {
      const response = await fetch('http://localhost:5000/api/notifications/read-all', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed.data) {
        return;
      }

      setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
      setNotificationUnreadCount(0);
    } catch (error) {
      // 忽略提示，避免打断用户
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const markAnnouncementNotificationsRead = async () => {
    const token = localStorage.getItem('token');
    if (!token || isMarkingAnnouncementsRead) return;

    const unreadAnnouncementIds = notifications
      .filter((notification) => (
        isAnnouncementNotification(notification) &&
        !notification.read &&
        notification._id
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
        const response = await fetch(`http://localhost:5000/api/notifications/${notificationId}/read`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!response.ok) {
          throw new Error('标记公告已读失败');
        }
      }));
    } catch (error) {
      await fetchNotifications(true);
      if (isAdmin) {
        await fetchAdminPendingNodeReminders(true);
      }
    } finally {
      setIsMarkingAnnouncementsRead(false);
    }
  };

  const clearNotifications = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    if (!notifications.length) return;

    setIsClearingNotifications(true);
    try {
      const response = await fetch('http://localhost:5000/api/notifications/clear', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
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
  };

  const respondDomainAdminInvite = async (notificationId, action) => {
    const token = localStorage.getItem('token');
    if (!token || !notificationId) return;

    const actionKey = `${notificationId}:${action}`;
    setNotificationActionId(actionKey);

    try {
      const response = await fetch(`http://localhost:5000/api/notifications/${notificationId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
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
  };

  const applyDomainMaster = async (nodeId, reason) => {
    const token = localStorage.getItem('token');
    const targetNodeId = normalizeObjectId(nodeId);
    if (!token || !targetNodeId) return false;

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${targetNodeId}/domain-master/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reason })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        window.alert(getApiErrorMessage(parsed, '提交域主申请失败'));
        return false;
      }

      window.alert(data.message || '域主申请已提交');
      await fetchNotifications(true);
      return true;
    } catch (error) {
      window.alert(`提交域主申请失败: ${error.message}`);
      return false;
    }
  };

  const handleApplyDomainMaster = async (reason) => {
    const targetNodeId = normalizeObjectId(nodeInfoModalTarget?._id);
    if (!targetNodeId) return false;
    setIsApplyingDomainMaster(true);
    try {
      return await applyDomainMaster(targetNodeId, reason);
    } finally {
      setIsApplyingDomainMaster(false);
    }
  };

  const formatNotificationTime = (time) => {
    if (!time) return '';
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  const openAdminPanel = async (tab = 'users') => {
    setAdminEntryTab(tab);
    await prepareForPrimaryNavigation();
    setView('admin');
  };

  const fetchSiegeSupportStatuses = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token || !authenticated || isAdmin) {
      if (!silent) {
        setSiegeSupportStatuses([]);
      }
      return null;
    }

    try {
      const response = await fetch('http://localhost:5000/api/nodes/me/siege-supports', {
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
  };

  const fetchTravelStatus = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const response = await fetch('http://localhost:5000/api/travel/status', {
        headers: { 'Authorization': `Bearer ${token}` }
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

      setTravelStatus(data.travel || { isTraveling: false });
      return data;
    } catch (error) {
      if (!silent) {
        window.alert(`获取移动状态失败: ${error.message}`);
      }
      return null;
    }
  };

  const normalizeDistributionParticipationData = (raw = {}, fallbackNodeId = '') => {
    const rawPool = raw?.pool && typeof raw.pool === 'object' ? raw.pool : {};
    const hasRewardValue = rawPool.rewardValue !== null && rawPool.rewardValue !== undefined;
    const parsedRewardValue = Number(rawPool.rewardValue);
    return {
      active: !!raw.active,
      nodeId: normalizeObjectId(raw.nodeId) || fallbackNodeId || '',
      nodeName: raw.nodeName || '',
      phase: raw.phase || 'none',
      executeAt: raw.executeAt || null,
      entryCloseAt: raw.entryCloseAt || null,
      endAt: raw.endAt || null,
      executedAt: raw.executedAt || null,
      secondsToEntryClose: Number(raw.secondsToEntryClose || 0),
      secondsToExecute: Number(raw.secondsToExecute || 0),
      secondsToEnd: Number(raw.secondsToEnd || 0),
      requiresManualEntry: !!raw.requiresManualEntry,
      autoEntry: !!raw.autoEntry,
      joined: !!raw.joined,
      joinedManual: !!raw.joinedManual,
      canJoin: !!raw.canJoin,
      canExit: !!raw.canExit,
      canExitWithoutConfirm: !!raw.canExitWithoutConfirm,
      joinTip: raw.joinTip || '',
      participantTotal: Number(raw.participantTotal || 0),
      pool: {
        key: rawPool.key || '',
        label: rawPool.label || '',
        poolPercent: Number(rawPool.poolPercent || 0),
        participantCount: Number(rawPool.participantCount || 0),
        userActualPercent: Number(rawPool.userActualPercent || 0),
        estimatedReward: Number(rawPool.estimatedReward || 0),
        rewardValue: hasRewardValue && Number.isFinite(parsedRewardValue) ? parsedRewardValue : null,
        rewardFrozen: !!rawPool.rewardFrozen,
        users: Array.isArray(rawPool.users) ? rawPool.users : []
      }
    };
  };

  const fetchDistributionParticipationStatus = async (nodeId, silent = true, options = {}) => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId || isAdmin) {
      return null;
    }

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/distribution-participation`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsed, '获取分发参与状态失败'));
        }
        return null;
      }
      const normalized = normalizeDistributionParticipationData(data, nodeId);
      setNodeDistributionStatus({
        nodeId: normalized.nodeId,
        active: normalized.active,
        phase: normalized.phase,
        requiresManualEntry: normalized.requiresManualEntry,
        joined: normalized.joined,
        canJoin: normalized.canJoin,
        canExit: normalized.canExit,
        joinTip: normalized.joinTip
      });
      if (options.updatePanel) {
        setDistributionPanelState((prev) => ({
          ...prev,
          data: normalized,
          loading: false,
          error: ''
        }));
      }
      return normalized;
    } catch (error) {
      if (!silent) {
        window.alert(`获取分发参与状态失败: ${error.message}`);
      }
      return null;
    }
  };

  const estimateTravelToNode = async (targetNodeId) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const response = await fetch('http://localhost:5000/api/travel/estimate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ targetNodeId })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        return {
          error: getApiErrorMessage(parsed, '获取移动预估失败')
        };
      }
      return data;
    } catch (error) {
      return { error: `获取移动预估失败: ${error.message}` };
    }
  };

  const startTravelToNode = async (targetNodeId) => {
    const token = localStorage.getItem('token');
    if (!token) return 'failed';

    try {
      const response = await fetch('http://localhost:5000/api/travel/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ targetNodeId })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok) {
        window.alert(getApiErrorMessage(parsed, '开始移动失败'));
        return 'failed';
      }

      if (!data) {
        window.alert('开始移动失败：返回数据不是 JSON');
        return 'failed';
      }

      setTravelStatus(data.travel || { isTraveling: false });
      const currentStoredLocation = localStorage.getItem('userLocation') || '';
      if (typeof data.location === 'string' && data.location !== currentStoredLocation) {
        syncUserLocation(data.location);
      }

      if (data.travel?.isStopping) {
        if (data.message) {
          window.alert(data.message);
        }
        return 'queued';
      }

      return 'started';
    } catch (error) {
      window.alert(`开始移动失败: ${error.message}`);
      return 'failed';
    }
  };

  const stopTravel = async () => {
    if (isStoppingTravel) return;
    setIsStoppingTravel(true);
    const token = localStorage.getItem('token');

    try {
      const response = await fetch('http://localhost:5000/api/travel/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok) {
        window.alert(getApiErrorMessage(parsed, '停止移动失败'));
        return;
      }

      if (!data) {
        window.alert('停止移动失败：返回数据不是 JSON');
        return;
      }

      setTravelStatus(data.travel || { isTraveling: false });
      if (typeof data.location === 'string') {
        syncUserLocation(data.location);
      }
    } catch (error) {
      window.alert(`停止移动失败: ${error.message}`);
    } finally {
      setIsStoppingTravel(false);
    }
  };

  const handleMoveToNode = async (targetNode, options = {}) => {
    if (!targetNode || !targetNode._id) return;
    const promptMode = options?.promptMode === 'distribution' ? 'distribution' : 'default';

    if (isAdmin) {
      window.alert('管理员不可执行移动操作');
      return false;
    }

    const isHardMoving = travelStatus.isTraveling && !travelStatus.isStopping;
    const isStopping = !!travelStatus.isStopping;

    if (isHardMoving) {
      window.alert('你正在移动中，不能更换目的地。请先停止移动。');
      return false;
    }

    if (!userLocation || userLocation.trim() === '') {
      window.alert('尚未设置当前位置，暂时无法移动');
      return false;
    }

    if (!isStopping && targetNode.name === userLocation) {
      window.alert('你已经在该节点，无需移动');
      return false;
    }

    if (isStopping && targetNode.name === travelStatus?.stoppingNearestNode?.nodeName) {
      window.alert('停止移动期间不能把最近节点设为新的目标');
      return false;
    }

    let confirmMessage = '';
    if (isStopping) {
      confirmMessage = `是否将「${targetNode.name}」设为新的目标？将在停止移动完成后自动出发。`;
    } else {
      const estimate = await estimateTravelToNode(targetNode._id);
      if (estimate?.error) {
        window.alert(estimate.error);
        return false;
      }
      const estimatedText = estimate?.estimatedDurationText || formatTravelSeconds(estimate?.estimatedSeconds);
      confirmMessage = promptMode === 'distribution'
        ? `您不在该知识域，需先移动到此，预计花费${estimatedText}，您希望立刻移动吗？`
        : `是否移动到「${targetNode.name}」？预计花费 ${estimatedText}。`;
    }

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return false;

    const startResult = await startTravelToNode(targetNode._id);
    if (startResult === 'started') {
      return true;
    }
    return startResult === 'queued';
  };

  // 当userLocation变化时，获取节点详情
  useEffect(() => {
    if (authenticated && userLocation) {
      fetchLocationNodeDetail(userLocation);
    }
  }, [userLocation, authenticated]);

  useEffect(() => {
    if (!authenticated || isAdmin) {
      setTravelStatus({ isTraveling: false });
      return;
    }

    fetchTravelStatus(true);
    const timer = setInterval(() => {
      fetchTravelStatus(true);
    }, 1000);

    return () => clearInterval(timer);
  }, [authenticated, isAdmin]);

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
  }, [authenticated, isAdmin]);

  useEffect(() => {
    const targetNodeId = normalizeObjectId(currentTitleDetail?._id);
    if (!authenticated || isAdmin || !isTitleBattleView(view) || !targetNodeId) {
      setNodeDistributionStatus(createEmptyNodeDistributionStatus());
      return undefined;
    }

    fetchDistributionParticipationStatus(targetNodeId, true);
    const timer = setInterval(() => {
      fetchDistributionParticipationStatus(targetNodeId, true);
    }, 4000);

    return () => clearInterval(timer);
  }, [authenticated, isAdmin, view, currentTitleDetail?._id, userLocation, travelStatus.isTraveling]);

  useEffect(() => {
    if (!showDistributionPanel) return undefined;
    const targetNodeId = normalizeObjectId(currentTitleDetail?._id);
    if (!targetNodeId || !isTitleBattleView(view)) {
      setShowDistributionPanel(false);
      return undefined;
    }
    fetchDistributionParticipationStatus(targetNodeId, true, { updatePanel: true });
    const timer = setInterval(() => {
      fetchDistributionParticipationStatus(targetNodeId, true, { updatePanel: true });
    }, 1000);
    return () => clearInterval(timer);
  }, [showDistributionPanel, view, currentTitleDetail?._id]);

  useEffect(() => {
    const targetNodeId = normalizeObjectId(currentTitleDetail?._id);
    if (!authenticated || isAdmin || !isTitleBattleView(view) || !targetNodeId) {
      setSiegeStatus(createEmptySiegeStatus());
      return undefined;
    }

    fetchSiegeStatus(targetNodeId, { silent: true });
    const timer = setInterval(() => {
      fetchSiegeStatus(targetNodeId, { silent: true });
    }, siegeDialog.open ? 2000 : 4000);
    return () => clearInterval(timer);
  }, [authenticated, isAdmin, view, currentTitleDetail?._id, userLocation, travelStatus.isTraveling, siegeDialog.open]);

  useEffect(() => {
    if (!authenticated) {
      setNotifications([]);
      setNotificationUnreadCount(0);
      setShowNotificationsPanel(false);
      setAdminPendingNodes([]);
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
  }, [authenticated, isAdmin]);

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
  }, [socket, authenticated, isAdmin]);

  useEffect(() => {
    if (!authenticated || isAdmin) {
      setRelatedDomainsData({
        loading: false,
        error: '',
        domainMasterDomains: [],
        domainAdminDomains: [],
        favoriteDomains: [],
        recentDomains: []
      });
      setShowRelatedDomainsPanel(false);
      return;
    }

    fetchRelatedDomains(true);
  }, [authenticated, isAdmin]);

  useEffect(() => {
    if (!authenticated || showLocationModal || hasRestoredPageRef.current) return;

    const saved = readSavedPageState();
    if (!saved?.view || saved.view === 'home') {
      hasRestoredPageRef.current = true;
      return;
    }

    isRestoringPageRef.current = true;

    const restorePage = async () => {
      const targetView = saved.view;
      const targetNodeId = normalizeObjectId(saved.nodeId);

      if ((targetView === 'nodeDetail' || targetView === 'knowledgeDomain' || targetView === 'titleDetail') && targetNodeId) {
        const restoredNode = targetView === 'titleDetail'
          ? await fetchTitleDetail(targetNodeId)
          : await fetchNodeDetail(targetNodeId);
        if (!restoredNode) {
          setView('home');
          return;
        }

        if (targetView === 'knowledgeDomain') {
          setKnowledgeDomainNode(restoredNode);
          setShowKnowledgeDomain(true);
          setIsTransitioningToDomain(false);
          setDomainTransitionProgress(1);
        }
        return;
      }

      if (targetView === 'alliance' || targetView === 'profile' || targetView === 'home') {
        setView(targetView);
        return;
      }

      if (targetView === 'army' && !isAdmin) {
        setView(targetView);
        return;
      }

      if (targetView === 'admin' && isAdmin) {
        setView('admin');
        return;
      }

      setView('home');
    };

    restorePage()
      .finally(() => {
        hasRestoredPageRef.current = true;
        isRestoringPageRef.current = false;
      });
  }, [authenticated, showLocationModal, isAdmin]);

  useEffect(() => {
    if (!authenticated || showLocationModal || isRestoringPageRef.current) return;

    const currentView = (showKnowledgeDomain || isTransitioningToDomain) ? 'knowledgeDomain' : view;
    const nodeId = normalizeObjectId(
      currentView === 'knowledgeDomain'
        ? (knowledgeDomainNode?._id || currentTitleDetail?._id || currentNodeDetail?._id)
        : (
            currentView === 'titleDetail'
              ? currentTitleDetail?._id
              : (currentView === 'nodeDetail' ? currentNodeDetail?._id : '')
          )
    );

    localStorage.setItem(PAGE_STATE_STORAGE_KEY, JSON.stringify({
      view: currentView,
      nodeId,
      updatedAt: Date.now()
    }));
  }, [
    authenticated,
    showLocationModal,
    view,
    showKnowledgeDomain,
    isTransitioningToDomain,
    currentNodeDetail,
    currentTitleDetail,
    knowledgeDomainNode
  ]);

  useEffect(() => {
    if (!authenticated || showLocationModal || isRestoringPageRef.current) return;

    const isKnownView = ['home', 'nodeDetail', 'titleDetail', 'alliance', 'admin', 'profile', 'army'].includes(view);
    if (!isKnownView) {
      setView('home');
      return;
    }

    if (view === 'admin' && !isAdmin) {
      setView('home');
      return;
    }

    if (view === 'army' && isAdmin) {
      setView('home');
      return;
    }

    if (view === 'nodeDetail' && !currentNodeDetail && hasRestoredPageRef.current) {
      setView('home');
    }
    if (view === 'titleDetail' && !currentTitleDetail && hasRestoredPageRef.current) {
      setView('home');
    }
  }, [authenticated, showLocationModal, view, isAdmin, currentNodeDetail, currentTitleDetail]);

  useEffect(() => {
    if (!showNotificationsPanel) return undefined;

    const handleClickOutside = (event) => {
      if (notificationsWrapperRef.current && !notificationsWrapperRef.current.contains(event.target)) {
        setShowNotificationsPanel(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotificationsPanel]);

  useEffect(() => {
    if (!showRelatedDomainsPanel) return undefined;

    const handleClickOutside = (event) => {
      if (relatedDomainsWrapperRef.current && !relatedDomainsWrapperRef.current.contains(event.target)) {
        setShowRelatedDomainsPanel(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showRelatedDomainsPanel]);

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        localStorage.removeItem('userLocation');
        localStorage.removeItem('profession');
        localStorage.removeItem('userAvatar');
        localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
        hasRestoredPageRef.current = false;
        isRestoringPageRef.current = false;
        setAuthenticated(false);
        setUsername('');
        setProfession('');
        setView('login');
        setIsAdmin(false);
        setAdminEntryTab('users');
        setUserLocation('');
        setTravelStatus({ isTraveling: false });
        setIsStoppingTravel(false);
        setNotifications([]);
        setNotificationUnreadCount(0);
        setShowNotificationsPanel(false);
        setIsNotificationsLoading(false);
        setNotificationActionId('');
        setAdminPendingNodes([]);
        setShowRelatedDomainsPanel(false);
        setRelatedDomainsData({
            loading: false,
            error: '',
            domainMasterDomains: [],
            domainAdminDomains: [],
            favoriteDomains: [],
            recentDomains: []
        });
        setFavoriteActionDomainId('');
        setIsApplyingDomainMaster(false);
        setCurrentLocationNodeDetail(null);
        setUserAvatar('default_male_1');
        setSelectedLocationNode(null);
        setShowLocationModal(false);
        setSiegeStatus(createEmptySiegeStatus());
        setSiegeSupportStatuses([]);
        setSiegeSupportDraft({
            gateKey: '',
            autoRetreatPercent: 40,
            units: {}
        });
        setSiegeDialog({
            open: false,
            loading: false,
            submitting: false,
            supportSubmitting: false,
            node: null,
            error: '',
            message: ''
        });
        
        // 清理socket连接和引用
        if (socket) {
            socket.disconnect();
        }
        if (socketRef.current) {
            socketRef.current.removeAllListeners();
            socketRef.current.close();
            socketRef.current = null; // 关键：清空引用
        }
        setSocket(null); // 清空state
        
        // 清理节点数据
        setNodes([]);
    };

    // 将socket初始化逻辑提取为独立函数
    const initializeSocket = (token = null) => {
        // 如果已存在socket，先清理
        if (socketRef.current) {
            socketRef.current.removeAllListeners();
            socketRef.current.close();
            socketRef.current = null;
        }
    
        const newSocket = io('http://localhost:5000', {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: 5,
            timeout: 20000,
            autoConnect: true
        });
        
        newSocket.on('connect', () => {
            console.log('WebSocket 连接成功:', newSocket.id);
            const authToken = token || localStorage.getItem('token');
            if (authToken) {
                newSocket.emit('authenticate', authToken);
                // 认证后立即请求游戏状态
                setTimeout(() => {
                    newSocket.emit('getGameState');
                }, 200);
            }
            
            // 如果是登录操作，立即获取游戏状态
            if (token) {
                setTimeout(() => {
                    newSocket.emit('getGameState');
                }, 300);
            }
        });
    
        newSocket.on('connect_error', (error) => {
            console.error('WebSocket 连接错误:', error);
        });
    
        newSocket.on('disconnect', (reason) => {
            console.log('WebSocket 断开连接:', reason);
        });
    
        newSocket.on('authenticated', (data) => {
            console.log('认证成功');
            setAuthenticated(true);
            newSocket.emit('getGameState');
        });
    
        newSocket.on('gameState', (data) => {
            console.log('收到游戏状态:', data);
            const approvedNodes = (data.nodes || []).filter(node => node.status === 'approved');
            setNodes(approvedNodes);
        });

    newSocket.on('nodeCreated', (node) => {
            if (node.status === 'approved') {
                setNodes(prev => [...prev, node]);
            }
        });

        newSocket.on('techUpgraded', (tech) => {
            setTechnologies(prev => {
                const existing = prev.find(t => t.techId === tech.techId);
                if (existing) {
                    return prev.map(t => t.techId === tech.techId ? tech : t);
                }
                return [...prev, tech];
            });
        });
    
        newSocket.on('resourcesUpdated', () => {
            newSocket.emit('getGameState');
        });
    
        // 【关键修改】添加知识点更新监听器
        newSocket.on('knowledgePointUpdated', (updatedNodes) => {
            setNodes(prevNodes => {
                const updatedNodeMap = new Map();
                updatedNodes.forEach(node => updatedNodeMap.set(node._id, node));
                
                // 更新现有节点状态 - 创建全新节点对象
                const newNodes = prevNodes.map(node => {
                    const updatedNode = updatedNodeMap.get(node._id);
                    if (updatedNode) {
                        // 创建全新的节点对象
                        return {
                            ...node,
                            knowledgePoint: updatedNode.knowledgePoint
                        };
                    }
                    return node;
                });
                
                return newNodes;
            });
        });

        socketRef.current = newSocket;
        setSocket(newSocket);
        
        return newSocket;
    };

    const handleUpgradeTech = (techId) => {
        socket.emit('upgradeTech', { techId });
    };

    const checkAdminStatus = async () => {
        const token = localStorage.getItem('token');
        if (!token) return;
    
        try {
            const response = await fetch('http://localhost:5000/api/admin/users', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
    
            if (response.ok) {
                setIsAdmin(true);
            } else {
                setIsAdmin(false);
            }
        } catch (error) {
            console.log('非管理员用户');
            setIsAdmin(false);
        }
    };

    // 获取根节点
    const fetchRootNodes = async () => {
        try {
            const response = await fetch('http://localhost:5000/api/nodes/public/root-nodes');
            if (response.ok) {
                const data = await response.json();
                setRootNodes(data.nodes);
            }
        } catch (error) {
            console.error('获取根节点失败:', error);
        }
    };

    // 获取热门节点
    const fetchFeaturedNodes = async () => {
        try {
            const response = await fetch('http://localhost:5000/api/nodes/public/featured-nodes');
            if (response.ok) {
                const data = await response.json();
                setFeaturedNodes(data.nodes);
            }
        } catch (error) {
            console.error('获取热门节点失败:', error);
        }
    };

    const resolveNavigationRelationAgainstCurrent = (targetNodeId, currentNode, relationHint) => {
        const normalizedHint = normalizeNavigationRelation(relationHint);
        if (normalizedHint !== 'jump') return normalizedHint;

        const normalizedTargetId = normalizeObjectId(targetNodeId);
        if (!normalizedTargetId || !currentNode) return 'jump';

        const isParentNode = Array.isArray(currentNode?.parentNodesInfo)
            && currentNode.parentNodesInfo.some((item) => normalizeObjectId(item?._id) === normalizedTargetId);
        if (isParentNode) return 'parent';

        const isChildNode = Array.isArray(currentNode?.childNodesInfo)
            && currentNode.childNodesInfo.some((item) => normalizeObjectId(item?._id) === normalizedTargetId);
        if (isChildNode) return 'child';

        return 'jump';
    };

    const formatTravelSeconds = (seconds) => {
        if (!Number.isFinite(seconds) || seconds <= 0) return '0 秒';
        const rounded = Math.round(seconds);
        const mins = Math.floor(rounded / 60);
        const remain = rounded % 60;
        if (mins <= 0) return `${remain} 秒`;
        return `${mins} 分 ${remain} 秒`;
    };

    const collapseRightDocksBeforeNavigation = async () => {
        if (isAdmin) return;
        const hasExpanded = isLocationDockExpanded || isAnnouncementDockExpanded;
        if (!hasExpanded) return;
        setIsLocationDockExpanded(false);
        setIsAnnouncementDockExpanded(false);
        await new Promise((resolve) => {
            setTimeout(resolve, RIGHT_DOCK_COLLAPSE_MS);
        });
    };

    const closeKnowledgeDomainBeforeNavigation = () => {
        if (showKnowledgeDomain || isTransitioningToDomain || knowledgeDomainNode) {
            setShowKnowledgeDomain(false);
            setIsTransitioningToDomain(false);
            setDomainTransitionProgress(0);
            setKnowledgeDomainNode(null);
            setKnowledgeDomainMode('normal');
            setClickedNodeForTransition(null);
        }
        if (showDistributionPanel) {
            setShowDistributionPanel(false);
            setDistributionPanelState(createDefaultDistributionPanelState());
        }
        if (siegeDialog.open) {
            resetSiegeDialog();
        }
    };

    const prepareForPrimaryNavigation = async () => {
        closeKnowledgeDomainBeforeNavigation();
        setTitleRelationInfo(null);
        setIsSenseSelectorVisible(false);
        await collapseRightDocksBeforeNavigation();
    };

    const navigateToHomeWithDockCollapse = async () => {
        await prepareForPrimaryNavigation();
        setView('home');
        setCurrentTitleDetail(null);
        setTitleGraphData(null);
        setTitleRelationInfo(null);
        setNodeInfoModalTarget(null);
        setIsSenseSelectorVisible(false);
        setSenseSelectorSourceNode(null);
        setNavigationPath(createHomeNavigationPath());
    };

    const resetSiegeDialog = () => {
        setSiegeDialog({
            open: false,
            loading: false,
            submitting: false,
            supportSubmitting: false,
            node: null,
            error: '',
            message: ''
        });
    };

    const buildInitialSiegeSupportDraft = (status) => {
        const units = {};
        (status?.ownRoster?.units || []).forEach((entry) => {
            if (!entry?.unitTypeId) return;
            units[entry.unitTypeId] = 0;
        });
        return {
            gateKey: status?.supportGate || status?.compareGate || status?.preferredGate || '',
            autoRetreatPercent: 40,
            units
        };
    };

    const fetchSiegeStatus = async (targetNodeId, { silent = true } = {}) => {
        const token = localStorage.getItem('token');
        if (!token || !targetNodeId || !authenticated || isAdmin) {
            if (!silent) {
                setSiegeStatus(createEmptySiegeStatus());
            }
            return null;
        }

        if (!silent) {
            setSiegeStatus((prev) => ({
                ...prev,
                loading: true,
                nodeId: targetNodeId
            }));
        }

        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${targetNodeId}/siege`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const parsed = await parseApiResponse(response);
            if (!response.ok || !parsed.data) {
                const fallback = createEmptySiegeStatus();
                const next = {
                    ...fallback,
                    loading: false,
                    nodeId: targetNodeId,
                    startDisabledReason: getApiErrorMessage(parsed, '无法获取围城状态'),
                    supportDisabledReason: getApiErrorMessage(parsed, '无法获取围城状态')
                };
                setSiegeStatus(next);
                return next;
            }
            const normalized = normalizeSiegeStatus(parsed.data, targetNodeId);
            setSiegeStatus(normalized);
            return normalized;
        } catch (error) {
            const fallback = createEmptySiegeStatus();
            const next = {
                ...fallback,
                loading: false,
                nodeId: targetNodeId,
                startDisabledReason: `获取围城状态失败: ${error.message}`,
                supportDisabledReason: `获取围城状态失败: ${error.message}`
            };
            setSiegeStatus(next);
            return next;
        }
    };

    const fetchIntelHeistStatus = async (targetNodeId, { silent = true } = {}) => {
        const token = localStorage.getItem('token');
        if (!token || !targetNodeId || !authenticated || isAdmin) {
            if (!silent) {
                setIntelHeistStatus(createEmptyIntelHeistStatus());
            }
            return null;
        }

        if (!silent) {
            setIntelHeistStatus((prev) => ({
                ...prev,
                loading: true,
                nodeId: targetNodeId
            }));
        }

        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${targetNodeId}/intel-heist`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (!response.ok || !data) {
                const next = {
                    loading: false,
                    nodeId: targetNodeId,
                    canSteal: false,
                    reason: data?.error || '无法获取情报窃取状态',
                    latestSnapshot: null
                };
                setIntelHeistStatus(next);
                return next;
            }
            const next = {
                loading: false,
                nodeId: targetNodeId,
                canSteal: !!data.canSteal,
                reason: data.reason || '',
                latestSnapshot: data.latestSnapshot ? normalizeIntelSnapshot(data.latestSnapshot) : null
            };
            setIntelHeistStatus(next);
            return next;
        } catch (error) {
            const next = {
                loading: false,
                nodeId: targetNodeId,
                canSteal: false,
                reason: `获取情报窃取状态失败: ${error.message}`,
                latestSnapshot: null
            };
            setIntelHeistStatus(next);
            return next;
        }
    };

    const startIntelHeistMiniGame = (targetNode) => {
        if (!targetNode?._id) return;
        setIntelHeistDialog({
            open: false,
            loading: false,
            node: null,
            snapshot: null,
            error: ''
        });
        handleEnterKnowledgeDomain(targetNode, { mode: 'intelHeist' });
    };

    const handleIntelHeistAction = async (targetNode) => {
        if (!targetNode?._id || isAdmin) return;
        const nodeId = normalizeObjectId(targetNode._id);
        if (!nodeId) return;

        setIntelHeistDialog({
            open: true,
            loading: true,
            node: targetNode,
            snapshot: null,
            error: ''
        });

        const status = await fetchIntelHeistStatus(nodeId, { silent: false });
        if (!status) {
            setIntelHeistDialog((prev) => ({
                ...prev,
                loading: false,
                error: '无法获取情报窃取状态'
            }));
            return;
        }

        if (!status.canSteal) {
            setIntelHeistDialog((prev) => ({
                ...prev,
                loading: false,
                snapshot: status.latestSnapshot || null,
                error: status.reason || '当前不可执行情报窃取'
            }));
            return;
        }

        if (!status.latestSnapshot) {
            startIntelHeistMiniGame(targetNode);
            return;
        }

        setIntelHeistDialog((prev) => ({
            ...prev,
            loading: false,
            error: '',
            snapshot: status.latestSnapshot
        }));
    };

    const handleIntelHeistSnapshotCaptured = (snapshot, nodeInfo) => {
        const normalized = snapshot ? normalizeIntelSnapshot(snapshot) : null;
        const targetNodeId = normalizeObjectId(nodeInfo?._id || snapshot?.nodeId);
        if (!normalized || !targetNodeId) return;
        setIntelHeistStatus((prev) => {
            if (prev.nodeId && prev.nodeId !== targetNodeId) return prev;
            return {
                loading: false,
                nodeId: targetNodeId,
                canSteal: true,
                reason: '',
                latestSnapshot: normalized
            };
        });
    };

    const handleSiegeAction = async (targetNode) => {
        if (!targetNode?._id || isAdmin) return;
        const nodeId = normalizeObjectId(targetNode._id);
        if (!nodeId) return;

        setSiegeDialog({
            open: true,
            loading: true,
            submitting: false,
            supportSubmitting: false,
            node: targetNode,
            error: '',
            message: ''
        });

        const status = await fetchSiegeStatus(nodeId, { silent: false });
        if (!status) {
            setSiegeDialog((prev) => ({
                ...prev,
                loading: false,
                error: '无法获取围城状态'
            }));
            return;
        }

        setSiegeSupportDraft(buildInitialSiegeSupportDraft(status));
        setSiegeDialog((prev) => ({
            ...prev,
            loading: false,
            error: '',
            message: ''
        }));
    };

    const startSiege = async () => {
        const token = localStorage.getItem('token');
        const nodeId = normalizeObjectId(siegeDialog.node?._id || currentTitleDetail?._id || currentNodeDetail?._id || siegeStatus.nodeId);
        if (!token || !nodeId || siegeDialog.submitting) return;

        setSiegeDialog((prev) => ({
            ...prev,
            submitting: true,
            error: '',
            message: ''
        }));

        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/siege/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                }
            });
            const parsed = await parseApiResponse(response);
            if (!response.ok || !parsed.data) {
                setSiegeDialog((prev) => ({
                    ...prev,
                    submitting: false,
                    error: getApiErrorMessage(parsed, '发起围城失败')
                }));
                return;
            }

            const normalized = normalizeSiegeStatus(parsed.data, nodeId);
            setSiegeStatus(normalized);
            setSiegeSupportDraft(buildInitialSiegeSupportDraft(normalized));
            setSiegeDialog((prev) => ({
                ...prev,
                submitting: false,
                error: '',
                message: parsed.data.message || '已发起围城'
            }));
            await fetchSiegeSupportStatuses(true);
        } catch (error) {
            setSiegeDialog((prev) => ({
                ...prev,
                submitting: false,
                error: `发起围城失败: ${error.message}`
            }));
        }
    };

    const requestSiegeSupport = async () => {
        const token = localStorage.getItem('token');
        const nodeId = normalizeObjectId(siegeDialog.node?._id || currentTitleDetail?._id || currentNodeDetail?._id || siegeStatus.nodeId);
        if (!token || !nodeId || siegeDialog.submitting) return;

        setSiegeDialog((prev) => ({
            ...prev,
            submitting: true,
            error: '',
            message: ''
        }));

        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/siege/request-support`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                }
            });
            const parsed = await parseApiResponse(response);
            if (!response.ok || !parsed.data) {
                setSiegeDialog((prev) => ({
                    ...prev,
                    submitting: false,
                    error: getApiErrorMessage(parsed, '呼叫支援失败')
                }));
                return;
            }

            const normalized = normalizeSiegeStatus(parsed.data, nodeId);
            setSiegeStatus(normalized);
            setSiegeDialog((prev) => ({
                ...prev,
                submitting: false,
                error: '',
                message: parsed.data.message || '已呼叫熵盟支援'
            }));
            await fetchNotifications(true);
        } catch (error) {
            setSiegeDialog((prev) => ({
                ...prev,
                submitting: false,
                error: `呼叫支援失败: ${error.message}`
            }));
        }
    };

    const retreatSiege = async () => {
        const token = localStorage.getItem('token');
        const nodeId = normalizeObjectId(siegeDialog.node?._id || currentTitleDetail?._id || currentNodeDetail?._id || siegeStatus.nodeId);
        if (!token || !nodeId || siegeDialog.submitting) return;

        setSiegeDialog((prev) => ({
            ...prev,
            submitting: true,
            error: '',
            message: ''
        }));

        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/siege/retreat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                }
            });
            const parsed = await parseApiResponse(response);
            if (!response.ok || !parsed.data) {
                setSiegeDialog((prev) => ({
                    ...prev,
                    submitting: false,
                    error: getApiErrorMessage(parsed, '撤退失败')
                }));
                return;
            }

            const normalized = normalizeSiegeStatus(parsed.data, nodeId);
            setSiegeStatus(normalized);
            setSiegeSupportDraft(buildInitialSiegeSupportDraft(normalized));
            setSiegeDialog((prev) => ({
                ...prev,
                submitting: false,
                error: '',
                message: parsed.data.message || '已撤退并取消攻城'
            }));
            await fetchSiegeSupportStatuses(true);
        } catch (error) {
            setSiegeDialog((prev) => ({
                ...prev,
                submitting: false,
                error: `撤退失败: ${error.message}`
            }));
        }
    };

    const submitSiegeSupport = async () => {
        const token = localStorage.getItem('token');
        const nodeId = normalizeObjectId(siegeDialog.node?._id || currentTitleDetail?._id || currentNodeDetail?._id || siegeStatus.nodeId);
        if (!token || !nodeId || siegeDialog.supportSubmitting) return;

        const units = Object.entries(siegeSupportDraft.units || {})
            .map(([unitTypeId, count]) => ({
                unitTypeId,
                count: Math.max(0, Math.floor(Number(count) || 0))
            }))
            .filter((item) => item.unitTypeId && item.count > 0);
        if (units.length === 0) {
            setSiegeDialog((prev) => ({
                ...prev,
                error: '请至少选择一支兵种和数量'
            }));
            return;
        }

        setSiegeDialog((prev) => ({
            ...prev,
            supportSubmitting: true,
            error: '',
            message: ''
        }));
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/siege/support`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    gateKey: siegeSupportDraft.gateKey || siegeStatus.supportGate || siegeStatus.compareGate || '',
                    autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(siegeSupportDraft.autoRetreatPercent) || 40))),
                    units
                })
            });
            const parsed = await parseApiResponse(response);
            if (!response.ok || !parsed.data) {
                setSiegeDialog((prev) => ({
                    ...prev,
                    supportSubmitting: false,
                    error: getApiErrorMessage(parsed, '派遣支援失败')
                }));
                return;
            }

            const normalized = normalizeSiegeStatus(parsed.data, nodeId);
            setSiegeStatus(normalized);
            setSiegeSupportDraft(buildInitialSiegeSupportDraft(normalized));
            setSiegeDialog((prev) => ({
                ...prev,
                supportSubmitting: false,
                error: '',
                message: parsed.data.message || '已派遣支援'
            }));
            await fetchNotifications(true);
            await fetchSiegeSupportStatuses(true);
        } catch (error) {
            setSiegeDialog((prev) => ({
                ...prev,
                supportSubmitting: false,
                error: `派遣支援失败: ${error.message}`
            }));
        }
    };

    // 获取标题主视角详情
    const fetchTitleDetail = async (nodeId, clickedNode = null, navOptions = {}) => {
        try {
            await prepareForPrimaryNavigation();
            const response = await fetch(`http://localhost:5000/api/nodes/public/title-detail/${nodeId}?depth=1`);
            if (!response.ok) {
                alert('获取标题主视角失败');
                return null;
            }

            const data = await response.json();
            const graph = data?.graph || {};
            const centerNode = graph?.centerNode || null;
            const targetNodeId = normalizeObjectId(centerNode?._id);
            if (!targetNodeId || !centerNode) {
                alert('标题主视角数据无效');
                return null;
            }

            const shouldResetTrail = navOptions?.resetTrail === true || !isKnowledgeDetailView(view);
            const relation = normalizeNavigationRelation(navOptions?.relationHint);
            trackRecentDomain(centerNode);
            setCurrentTitleDetail(centerNode);
            setTitleGraphData(graph);
            setCurrentNodeDetail(null);
            setNodeInfoModalTarget(null);
            setTitleRelationInfo(null);
            setView('titleDetail');
            setIsSenseSelectorVisible(false);
            setSenseSelectorSourceNode(centerNode);
            setIntelHeistStatus(createEmptyIntelHeistStatus());
            setSiegeStatus(createEmptySiegeStatus());
            fetchIntelHeistStatus(targetNodeId, { silent: false });
            fetchSiegeStatus(targetNodeId, { silent: false });

            if (clickedNode) {
                setClickedNodeForTransition(clickedNode);
            } else {
                setClickedNodeForTransition(null);
            }

            setNavigationPath((prevPath) => {
                const safePath = Array.isArray(prevPath) && prevPath.length > 0
                    ? prevPath
                    : createHomeNavigationPath();
                const historyIndex = Number.isInteger(navOptions?.historyIndex)
                    ? Math.max(0, Math.min(navOptions.historyIndex, safePath.length - 1))
                    : -1;
                if (historyIndex >= 0) {
                    const nextPath = safePath.slice(0, historyIndex + 1);
                    const lastHistory = nextPath[nextPath.length - 1];
                    if (lastHistory?.type === 'node') {
                        const nextItem = buildNavigationTrailItem(centerNode, lastHistory.relation, { mode: 'title' });
                        return [...nextPath.slice(0, -1), {
                            ...lastHistory,
                            mode: 'title',
                            senseId: '',
                            label: nextItem?.label || lastHistory.label
                        }];
                    }
                    return nextPath;
                }

                const targetNavItem = buildNavigationTrailItem(centerNode, relation, { mode: 'title' });
                if (!targetNavItem) return safePath;

                if (shouldResetTrail) {
                    return [...createHomeNavigationPath(), targetNavItem];
                }

                const duplicateIndex = safePath.findIndex((item, index) => (
                    index > 0
                    && item?.type === 'node'
                    && normalizeObjectId(item?.nodeId) === targetNavItem.nodeId
                ));
                if (duplicateIndex >= 0) {
                    return [
                        ...safePath.slice(0, duplicateIndex),
                        targetNavItem
                    ];
                }

                return [...safePath, targetNavItem];
            });

            return centerNode;
        } catch (error) {
            console.error('获取标题主视角失败:', error);
            alert('获取标题主视角失败');
            return null;
        }
    };

    // 获取释义主视角详情
    const fetchNodeDetail = async (nodeId, clickedNode = null, navOptions = {}) => {
        try {
            await prepareForPrimaryNavigation();
            const requestedSenseId = typeof navOptions?.activeSenseId === 'string' ? navOptions.activeSenseId.trim() : '';
            const detailUrl = requestedSenseId
                ? `http://localhost:5000/api/nodes/public/node-detail/${nodeId}?senseId=${encodeURIComponent(requestedSenseId)}`
                : `http://localhost:5000/api/nodes/public/node-detail/${nodeId}`;
            const response = await fetch(detailUrl);
            if (response.ok) {
                const data = await response.json();
                const targetNodeId = normalizeObjectId(data?.node?._id);
                const currentNodeBeforeNavigate = currentNodeDetail;
                const shouldResetTrail = navOptions?.resetTrail === true || !isKnowledgeDetailView(view);
                const relation = resolveNavigationRelationAgainstCurrent(
                    targetNodeId,
                    currentNodeBeforeNavigate,
                    navOptions?.relationHint
                );
                const previousNodeId = normalizeObjectId(currentNodeBeforeNavigate?._id);
                const isSenseOnlySwitch = !!requestedSenseId && !!targetNodeId && targetNodeId === previousNodeId;
                if (!isSenseOnlySwitch) {
                    setIsSenseSelectorVisible(false);
                }
                trackRecentDomain(data.node);
                setCurrentNodeDetail(data.node);
                setCurrentTitleDetail(null);
                setTitleGraphData(null);
                setTitleRelationInfo(null);
                setView('nodeDetail');
                setIntelHeistStatus(createEmptyIntelHeistStatus());
                setSiegeStatus(createEmptySiegeStatus());
                fetchIntelHeistStatus(normalizeObjectId(data?.node?._id), { silent: false });
                fetchSiegeStatus(normalizeObjectId(data?.node?._id), { silent: false });

                // 保存被点击的节点，用于WebGL过渡动画
                if (clickedNode) {
                    setClickedNodeForTransition(clickedNode);
                } else {
                    setClickedNodeForTransition(null);
                }

                setNavigationPath((prevPath) => {
                    const safePath = Array.isArray(prevPath) && prevPath.length > 0
                        ? prevPath
                        : createHomeNavigationPath();
                    const historyIndex = Number.isInteger(navOptions?.historyIndex)
                        ? Math.max(0, Math.min(navOptions.historyIndex, safePath.length - 1))
                        : -1;
                    if (historyIndex >= 0) {
                        const nextPath = safePath.slice(0, historyIndex + 1);
                        const lastHistory = nextPath[nextPath.length - 1];
                        if (lastHistory?.type === 'node') {
                            const nextItem = buildNavigationTrailItem(
                                data?.node || {},
                                lastHistory.relation,
                                { mode: 'sense' }
                            );
                            return [
                                ...nextPath.slice(0, -1),
                                {
                                    ...lastHistory,
                                    mode: 'sense',
                                    senseId: typeof data?.node?.activeSenseId === 'string' ? data.node.activeSenseId : (lastHistory.senseId || ''),
                                    label: nextItem?.label || lastHistory.label
                                }
                            ];
                        }
                        return nextPath;
                    }

                    const targetNavItem = buildNavigationTrailItem(data.node, relation, { mode: 'sense' });
                    if (!targetNavItem) return safePath;

                    if (shouldResetTrail) {
                        return [...createHomeNavigationPath(), targetNavItem];
                    }

                    const duplicateIndex = safePath.findIndex((item, index) => (
                        index > 0
                        && item?.type === 'node'
                        && normalizeObjectId(item?.nodeId) === targetNavItem.nodeId
                    ));
                    if (duplicateIndex >= 0) {
                        return [
                            ...safePath.slice(0, duplicateIndex),
                            targetNavItem
                        ];
                    }

                    return [...safePath, targetNavItem];
                });
                // WebGL场景更新由useEffect自动处理
                return data.node;
            } else {
                alert('获取节点详情失败');
                return null;
            }
        } catch (error) {
            console.error('获取节点详情失败:', error);
            alert('获取节点详情失败');
            return null;
        }
    };

    const buildClickedNodeFromScene = (targetNodeId) => {
        const sceneNodes = sceneManagerRef.current?.currentLayout?.nodes || [];
        const matched = sceneNodes.find((n) => n?.data?._id === targetNodeId);
        if (!matched) return null;
        return {
            id: matched.id,
            data: matched.data,
            type: matched.type
        };
    };

    const updateSenseSelectorAnchorBySceneNode = (sceneNode) => {
        const renderer = sceneManagerRef.current?.renderer;
        const canvas = webglCanvasRef.current;
        if (!renderer || !canvas || !sceneNode) return;
        const rect = canvas.getBoundingClientRect();
        const screenPos = renderer.worldToScreen(sceneNode.x, sceneNode.y);
        const next = {
            x: rect.left + screenPos.x,
            y: rect.top + screenPos.y,
            visible: true
        };
        senseSelectorAnchorRef.current = next;
        setSenseSelectorAnchor(next);
    };

    const handleJumpToCurrentLocationView = async () => {
        if (!currentLocationNodeDetail?._id) {
            return;
        }

        const activeDetailNode = isTitleBattleView(view) ? currentTitleDetail : currentNodeDetail;
        if (isKnowledgeDetailView(view) && activeDetailNode?.name === userLocation) {
            return;
        }

        const clickedNode = buildClickedNodeFromScene(currentLocationNodeDetail._id);
        await fetchTitleDetail(currentLocationNodeDetail._id, clickedNode);
    };

    const openDistributionPanel = (participationData) => {
        if (!participationData || !participationData.active) return;
        setDistributionPanelState({
            loading: false,
            joining: false,
            exiting: false,
            error: '',
            feedback: '',
            data: participationData
        });
        setShowDistributionPanel(true);
    };

    const handleDistributionParticipationAction = async (targetNodeDetail) => {
        if (!targetNodeDetail?._id) return;
        if (isAdmin) {
            window.alert('系统管理员不参与知识点分发');
            return;
        }

        const participation = await fetchDistributionParticipationStatus(targetNodeDetail._id, false);
        if (!participation) return;
        if (!participation.active) {
            window.alert('该知识域当前没有进行中的分发活动');
            return;
        }

        const refreshed = await fetchDistributionParticipationStatus(targetNodeDetail._id, true);
        const panelData = refreshed && refreshed.active ? refreshed : participation;
        if (panelData.active) openDistributionPanel(panelData);
    };

    const handleDistributionAnnouncementClick = async (notification) => {
        if (!notification) return;

        if (!notification.read && notification._id) {
            await markNotificationRead(notification._id);
        }

        let targetNodeId = normalizeObjectId(notification.nodeId);
        if (!targetNodeId && typeof notification.nodeName === 'string' && notification.nodeName.trim()) {
            try {
                const response = await fetch(`http://localhost:5000/api/nodes/public/search?query=${encodeURIComponent(notification.nodeName.trim())}`);
                if (response.ok) {
                    const data = await response.json();
                    const exactMatch = Array.isArray(data?.results)
                        ? data.results.find((item) => (
                            item?.domainName === notification.nodeName.trim()
                            || item?.name === notification.nodeName.trim()
                        ))
                        : null;
                    targetNodeId = normalizeObjectId(exactMatch?.nodeId || exactMatch?._id);
                }
            } catch (error) {
                targetNodeId = '';
            }
        }
        if (!targetNodeId) return;

        const clickedNode = buildClickedNodeFromScene(targetNodeId);
        await fetchTitleDetail(targetNodeId, clickedNode);
        setShowSearchResults(false);
    };

    const handleArrivalNotificationClick = async (notification) => {
        if (!notification) return;
        await handleDistributionAnnouncementClick(notification);
    };

    const handleHomeAnnouncementClick = async (notification) => {
        if (!notification) return;
        if (notification.type === 'domain_distribution_announcement') {
            await handleDistributionAnnouncementClick(notification);
            return;
        }

        if (!notification.read && notification._id) {
            await markNotificationRead(notification._id);
        }
    };

    const closeDistributionPanel = () => {
        setShowDistributionPanel(false);
        setDistributionPanelState(createDefaultDistributionPanelState());
    };

    const joinDistributionFromPanel = async () => {
        const token = localStorage.getItem('token');
        const nodeId = normalizeObjectId(currentTitleDetail?._id);
        const panelData = distributionPanelState.data;
        if (!token || !nodeId || !panelData) return;

        if (!panelData.active) {
            setDistributionPanelState((prev) => ({
                ...prev,
                error: ''
            }));
            return;
        }
        if (!panelData.canJoin) {
            const currentNodeName = (currentTitleDetail?.name || '').trim();
            const currentLocationName = (userLocation || '').trim();
            const shouldPromptMove = (
                panelData.requiresManualEntry &&
                !panelData.joined &&
                panelData.phase === 'entry_open' &&
                !!currentNodeName &&
                currentLocationName !== currentNodeName
            );
            if (shouldPromptMove && currentTitleDetail?._id) {
                await handleMoveToNode(currentTitleDetail, { promptMode: 'distribution' });
            }
            setDistributionPanelState((prev) => ({
                ...prev,
                error: ''
            }));
            return;
        }

        const confirmed = window.confirm(
            `确认参与知识域「${currentTitleDetail?.name || ''}」分发活动？确认后在本次分发结束前不可移动。`
        );
        if (!confirmed) return;

        setDistributionPanelState((prev) => ({
            ...prev,
            joining: true,
            error: '',
            feedback: ''
        }));
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/distribution-participation/join`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            const parsed = await parseApiResponse(response);
            const data = parsed.data;
            if (!response.ok || !data) {
                setDistributionPanelState((prev) => ({
                    ...prev,
                    joining: false,
                    error: getApiErrorMessage(parsed, '参与分发失败')
                }));
                return;
            }
            const refreshed = await fetchDistributionParticipationStatus(nodeId, true, { updatePanel: true });
            setDistributionPanelState((prev) => ({
                ...prev,
                joining: false,
                feedback: '',
                data: refreshed || prev.data
            }));
        } catch (error) {
            setDistributionPanelState((prev) => ({
                ...prev,
                joining: false,
                error: `参与分发失败: ${error.message}`
            }));
        }
    };

    const exitDistributionFromPanel = async () => {
        const token = localStorage.getItem('token');
        const nodeId = normalizeObjectId(currentTitleDetail?._id);
        const panelData = distributionPanelState.data;
        if (!token || !nodeId || !panelData?.canExit) return;

        if (!panelData.canExitWithoutConfirm) {
            const confirmed = window.confirm(`确认退出知识域「${currentTitleDetail?.name || ''}」分发活动？`);
            if (!confirmed) return;
        }

        setDistributionPanelState((prev) => ({
            ...prev,
            exiting: true,
            error: '',
            feedback: ''
        }));
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/${nodeId}/distribution-participation/exit`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            const parsed = await parseApiResponse(response);
            const data = parsed.data;
            if (!response.ok || !data) {
                setDistributionPanelState((prev) => ({
                    ...prev,
                    exiting: false,
                    error: getApiErrorMessage(parsed, '退出分发失败')
                }));
                return;
            }
            const refreshed = await fetchDistributionParticipationStatus(nodeId, true, { updatePanel: true });
            setDistributionPanelState((prev) => ({
                ...prev,
                exiting: false,
                feedback: '',
                data: refreshed || prev.data
            }));
        } catch (error) {
            setDistributionPanelState((prev) => ({
                ...prev,
                exiting: false,
                error: `退出分发失败: ${error.message}`
            }));
        }
    };

    const domainMasterDomains = relatedDomainsData.domainMasterDomains || [];
    const domainAdminDomains = relatedDomainsData.domainAdminDomains || [];
    const favoriteDomains = relatedDomainsData.favoriteDomains || [];
    const recentDomains = relatedDomainsData.recentDomains || [];

    const favoriteDomainSet = new Set(favoriteDomains.map((node) => normalizeObjectId(node?._id)));
    const relatedDomainCount = new Set([
        ...domainMasterDomains.map((node) => normalizeObjectId(node?._id)),
        ...domainAdminDomains.map((node) => normalizeObjectId(node?._id)),
        ...favoriteDomains.map((node) => normalizeObjectId(node?._id)),
        ...recentDomains.map((node) => normalizeObjectId(node?._id))
    ].filter(Boolean)).size;
    const pendingMasterApplyCount = notifications.filter((notification) => (
        notification.type === 'domain_master_apply' &&
        notification.status === 'pending'
    )).length;
    const systemAnnouncements = notifications
        .filter((notification) => notification.type === 'domain_distribution_announcement')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);
    const allianceAnnouncements = notifications
        .filter((notification) => notification.type === 'alliance_announcement')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);
    const announcementGroups = {
        system: systemAnnouncements,
        alliance: allianceAnnouncements
    };
    const announcementUnreadCount = notifications.filter((notification) => (
        isAnnouncementNotification(notification) && !notification.read
    )).length;
    useEffect(() => {
        if (announcementDockTab === 'system' && systemAnnouncements.length === 0 && allianceAnnouncements.length > 0) {
            setAnnouncementDockTab('alliance');
        } else if (announcementDockTab === 'alliance' && allianceAnnouncements.length === 0 && systemAnnouncements.length > 0) {
            setAnnouncementDockTab('system');
        }
    }, [announcementDockTab, systemAnnouncements.length, allianceAnnouncements.length]);
    useEffect(() => {
        const canRenderDock = !isAdmin && (
            view === 'home'
            || (view === 'nodeDetail' && currentNodeDetail)
            || (view === 'titleDetail' && currentTitleDetail)
        );
        if (!canRenderDock) {
            setIsLocationDockExpanded(false);
            setIsAnnouncementDockExpanded(false);
        }
    }, [view, currentNodeDetail, currentTitleDetail, isAdmin]);
    const adminPendingApprovalCount = pendingMasterApplyCount + adminPendingNodes.length;
    const notificationBadgeCount = isAdmin ? adminPendingApprovalCount : notificationUnreadCount;
    const currentNodeMasterId = normalizeObjectId(nodeInfoModalTarget?.domainMaster);
    const currentNodeOwnerRole = nodeInfoModalTarget?.owner?.role || '';
    const canApplyDomainMaster = Boolean(
        authenticated &&
        !isAdmin &&
        normalizeObjectId(nodeInfoModalTarget?._id) &&
        !currentNodeMasterId &&
        (currentNodeOwnerRole === 'admin' || currentNodeOwnerRole === '')
    );
    const isSiegeDomainMasterViewer = siegeStatus.viewerRole === 'domainMaster';
    const isSiegeDomainAdminViewer = siegeStatus.viewerRole === 'domainAdmin';
    const isSiegeReadonlyViewer = isSiegeDomainMasterViewer || isSiegeDomainAdminViewer;
    const siegeActiveGateRows = (siegeStatus.activeGateKeys || [])
        .map((gateKey) => {
            const gateState = siegeStatus.gateStates?.[gateKey] || {};
            const attackers = (gateState.attackers || []).filter((item) => item && (item.status === 'moving' || item.status === 'sieging'));
            return {
                gateKey,
                gateLabel: gateState.gateLabel || CITY_GATE_LABEL_MAP[gateKey] || gateKey,
                attackers
            };
        })
        .filter((item) => !!item.gateKey);

    const handleOpenRelatedDomain = async (node) => {
        const nodeId = normalizeObjectId(node?._id);
        if (!nodeId) return;
        setShowRelatedDomainsPanel(false);
        const clickedNode = buildClickedNodeFromScene(nodeId);
        await fetchTitleDetail(nodeId, clickedNode);
    };

    const handleOpenTravelNode = async (travelNode) => {
        const nodeId = normalizeObjectId(travelNode?.nodeId);
        if (!nodeId) return;
        const clickedNode = buildClickedNodeFromScene(nodeId);
        await fetchTitleDetail(nodeId, clickedNode);
    };

    const renderRelatedDomainSection = (title, domainList, emptyText) => (
        <div className="related-domain-section">
            <div className="related-domain-section-title">
                <span>{title}</span>
                <span className="related-domain-count">{domainList.length}</span>
            </div>
            {domainList.length === 0 ? (
                <div className="related-domain-empty">{emptyText}</div>
            ) : (
                <div className="related-domain-list">
                    {domainList.map((domain) => {
                        const domainId = normalizeObjectId(domain?._id);
                        const isFavorite = favoriteDomainSet.has(domainId);
                        const isUpdatingFavorite = favoriteActionDomainId === domainId;
                        return (
                            <div key={`${title}-${domainId}`} className="related-domain-item">
                                <button
                                    type="button"
                                    className="related-domain-link"
                                    onClick={() => handleOpenRelatedDomain(domain)}
                                >
                                    <span className="related-domain-name">{getNodeDisplayName(domain)}</span>
                                    <span className="related-domain-meta">{formatDomainKnowledgePoint(domain)}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`related-domain-fav-btn ${isFavorite ? 'active' : ''}`}
                                    onClick={() => toggleFavoriteDomain(domainId)}
                                    disabled={isUpdatingFavorite}
                                    title={isFavorite ? '取消收藏' : '加入收藏'}
                                >
                                    <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    const renderRelatedDomainsPanel = () => {
        if (!showRelatedDomainsPanel) return null;

        return (
            <div className="related-domains-panel">
                <div className="related-domains-header">
                    <h3>与我相关的知识域</h3>
                </div>
                <div className="related-domains-body">
                    {relatedDomainsData.loading && <div className="related-domain-empty">加载中...</div>}
                    {!relatedDomainsData.loading && relatedDomainsData.error && (
                        <div className="related-domains-error">{relatedDomainsData.error}</div>
                    )}
                    {renderRelatedDomainSection('作为域主', domainMasterDomains, '当前没有作为域主的知识域')}
                    {renderRelatedDomainSection('作为域相', domainAdminDomains, '当前没有域相身份的知识域')}
                    {renderRelatedDomainSection('收藏的知识域', favoriteDomains, '暂无收藏，点击右侧星标可收藏')}
                    {renderRelatedDomainSection('最近访问的知识域', recentDomains, '暂无访问记录')}
                </div>
            </div>
        );
    };

    const getNodeDetailButtonContext = (nodeDetail) => {
        const isAtCurrentNode = nodeDetail?.name === userLocation;
        const isHardMoving = travelStatus.isTraveling && !travelStatus.isStopping;
        const isNearestInStopping = travelStatus.isStopping && nodeDetail?.name === travelStatus?.stoppingNearestNode?.nodeName;
        const moveDisabled = isAtCurrentNode || isHardMoving || !userLocation || isNearestInStopping;
        const moveDisabledReason = isAtCurrentNode
            ? '已位于该节点'
            : (isHardMoving
                ? '移动中不可切换目的地'
                : (!userLocation
                    ? '未设置当前位置'
                    : (isNearestInStopping ? '停止移动期间不能选择最近节点' : '当前不可移动')));
        const targetNodeId = normalizeObjectId(nodeDetail?._id);
        const distributionStatusMatched = nodeDistributionStatus.nodeId === targetNodeId
            ? nodeDistributionStatus
            : createEmptyNodeDistributionStatus();
        const showDistributionButton = !isAdmin && !!distributionStatusMatched.active;
        const distributionHighlighted = false;
        const distributionDisabled = false;
        const distributionDisabledReason = '';
        const distributionButtonTooltip = '知识点分发';
        const nodeId = normalizeObjectId(nodeDetail?._id);
        const isDomainMasterUser = nodeDetail?.domainMaster?.username && nodeDetail.domainMaster.username === username;
        const isDomainAdminUser = Array.isArray(nodeDetail?.domainAdmins)
            && nodeDetail.domainAdmins.some((item) => item?.username && item.username === username);
        const isManagedNodeByUser = isDomainMasterUser || isDomainAdminUser;
        const showIntelStealButton = !isAdmin && isAtCurrentNode && !isDomainMasterUser && !isDomainAdminUser;
        const intelStatusMatched = intelHeistStatus.nodeId === nodeId
            ? intelHeistStatus
            : createEmptyIntelHeistStatus();
        const intelSnapshotAgeText = intelStatusMatched.latestSnapshot
            ? getIntelSnapshotAgeMinutesText(intelStatusMatched.latestSnapshot)
            : '';
        const intelStealTooltip = intelStatusMatched.loading
            ? '情报窃取状态读取中...'
            : (intelStatusMatched.latestSnapshot
                ? `情报窃取（上次快照：${intelSnapshotAgeText || '刚刚'}）`
                : '情报窃取');
        const intelStealDisabled = showIntelStealButton && intelStatusMatched.loading;
        const siegeStatusMatched = siegeStatus.nodeId === nodeId
            ? siegeStatus
            : createEmptySiegeStatus();
        const activeSiegeGateText = (siegeStatusMatched.activeGateKeys || [])
            .map((gateKey) => CITY_GATE_LABEL_MAP[gateKey] || gateKey)
            .filter(Boolean)
            .join('、');
        const siegeGateLabel = siegeStatusMatched.compare?.gateLabel
            || CITY_GATE_LABEL_MAP[siegeStatusMatched.compareGate]
            || '';
        const siegeTooltip = siegeStatusMatched.loading
            ? '围城状态读取中...'
            : (isManagedNodeByUser
                ? (siegeStatusMatched.hasActiveSiege
                    ? `${isDomainAdminUser ? '围城预警（仅可查看攻击用户与攻打门位）' : '围城预警（可查看攻守信息）'}${activeSiegeGateText ? `：${activeSiegeGateText}` : ''}`
                    : '暂无围城')
                : (siegeStatusMatched.hasActiveSiege
                    ? `攻占知识域（围城进行中${siegeGateLabel ? `：${siegeGateLabel}` : ''}）`
                    : (siegeStatusMatched.canStartSiege
                        ? '攻占知识域'
                        : `攻占知识域（${siegeStatusMatched.startDisabledReason || '当前不可发起'}）`)));
        const siegeDisabled = false;
        const showSiegeButton = !isAdmin && (!isManagedNodeByUser || siegeStatusMatched.hasActiveSiege);

        return {
            showMoveButton: !isAdmin,
            isFavorite: favoriteDomainSet.has(normalizeObjectId(nodeDetail?._id)),
            moveDisabled,
            moveDisabledReason,
            showDistributionButton,
            distributionHighlighted,
            distributionDisabled,
            distributionDisabledReason,
            distributionButtonTooltip,
            showIntelStealButton,
            intelStealTooltip,
            intelStealDisabled,
            intelStealHasSnapshot: !!intelStatusMatched.latestSnapshot,
            showSiegeButton,
            siegeTooltip,
            siegeDisabled,
            siegeActive: !!siegeStatusMatched.hasActiveSiege
        };
    };

    useEffect(() => {
        if (!sceneManagerRef.current) return;

        sceneManagerRef.current.onNodeClick = (node) => {
            if (!node?.data?._id) return;

            if (view === 'home') {
                setTitleRelationInfo(null);
                setSenseSelectorSourceNode(node.data);
                updateSenseSelectorAnchorBySceneNode(node);
                setIsSenseSelectorVisible(true);
                return;
            }

            if (view === 'titleDetail') {
                setTitleRelationInfo(null);
                if (node.type === 'center') {
                    setSenseSelectorSourceNode(currentTitleDetail || node.data);
                    updateSenseSelectorAnchorBySceneNode(node);
                    setIsSenseSelectorVisible((prev) => !prev);
                    return;
                }
                fetchTitleDetail(node.data._id, node, {
                    relationHint: getNavigationRelationFromSceneNode(node)
                });
                return;
            }

            if (view === 'nodeDetail') {
                setTitleRelationInfo(null);
                if (node.type === 'center') {
                    setSenseSelectorSourceNode(currentNodeDetail || node.data);
                    updateSenseSelectorAnchorBySceneNode(node);
                    setIsSenseSelectorVisible((prev) => !prev);
                    return;
                }
                fetchNodeDetail(node.data._id, node, {
                    relationHint: getNavigationRelationFromSceneNode(node),
                    activeSenseId: typeof node?.data?.activeSenseId === 'string' ? node.data.activeSenseId : ''
                });
            }
        };
    }, [view, currentNodeDetail, currentTitleDetail]);

    // 实时搜索
    const performHomeSearch = async (query) => {
        if (!query || query.trim() === '') {
            setHomeSearchResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        try {
            const response = await fetch(`http://localhost:5000/api/nodes/public/search?query=${encodeURIComponent(query)}`);
            if (response.ok) {
                const data = await response.json();
                setHomeSearchResults(data.results);
            }
        } catch (error) {
            console.error('搜索失败:', error);
        } finally {
            setIsSearching(false);
        }
    };

    // 监听搜索输入变化
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (view === 'home' || view === 'nodeDetail' || view === 'titleDetail') {
                performHomeSearch(homeSearchQuery);
                // 只有在用户主动输入时才显示搜索结果，而不是在view变化时
                if (homeSearchQuery.trim() !== '') {
                    setShowSearchResults(true);
                }
            }
        }, 300); // 防抖：300ms后执行搜索

        return () => clearTimeout(timeoutId);
    }, [homeSearchQuery]); // 移除view依赖，只在搜索词变化时触发

    // 全局点击事件监听器 - 用于控制搜索结果显示/隐藏
    useEffect(() => {
        const handleClickOutside = (event) => {
            // 只在首页和节点详情页监听点击事件
            if (view !== 'home' && view !== 'nodeDetail' && view !== 'titleDetail') return;

            // 检查点击是否在搜索栏区域内
            if (searchBarRef.current && !searchBarRef.current.contains(event.target)) {
                // 点击在搜索栏外部，隐藏搜索结果
                setShowSearchResults(false);
            }
        };

        // 添加全局点击事件监听器
        document.addEventListener('mousedown', handleClickOutside);

        // 清理函数：移除事件监听器
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [view]); // 依赖view状态，当view变化时重新绑定事件

    // 初始化首页数据
    useEffect(() => {
        if (authenticated && view === 'home') {
            fetchRootNodes();
            fetchFeaturedNodes();
            setNavigationPath(createHomeNavigationPath());
        }
    }, [authenticated, view]);

    // 更新WebGL首页场景
    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        if (view !== 'home') return;

        // 确保有数据才渲染
        if (rootNodes.length > 0 || featuredNodes.length > 0) {
            sceneManagerRef.current.showHome(rootNodes, featuredNodes, []);
        }
    }, [isWebGLReady, view, rootNodes, featuredNodes]);

    // 更新WebGL释义主视角场景
    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        if (view !== 'nodeDetail' || !currentNodeDetail) return;

        const parentNodes = currentNodeDetail.parentNodesInfo || [];
        const childNodes = currentNodeDetail.childNodesInfo || [];

        // 将被点击的节点传递给SceneManager，用于正确的过渡动画
        sceneManagerRef.current.showNodeDetail(
            currentNodeDetail,
            parentNodes,
            childNodes,
            clickedNodeForTransition,
            { senseDetailOnly: true }
        );

        // 动画完成后清除clickedNode状态
        setClickedNodeForTransition(null);
    }, [isWebGLReady, view, currentNodeDetail, clickedNodeForTransition]);

    // 更新WebGL标题主视角场景
    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        if (view !== 'titleDetail' || !currentTitleDetail || !titleGraphData) return;

        const graphNodes = Array.isArray(titleGraphData?.nodes) ? titleGraphData.nodes : [];
        const graphEdges = Array.isArray(titleGraphData?.edges) ? titleGraphData.edges : [];
        const levelByNodeId = titleGraphData?.levelByNodeId || {};
        sceneManagerRef.current.showTitleDetail(
            currentTitleDetail,
            graphNodes,
            graphEdges,
            levelByNodeId,
            clickedNodeForTransition,
            getNodeDetailButtonContext(currentTitleDetail)
        );
        setClickedNodeForTransition(null);
    }, [isWebGLReady, view, currentTitleDetail, titleGraphData, clickedNodeForTransition]);

    useEffect(() => {
        if (!sceneManagerRef.current) return;
        if (view === 'titleDetail' && currentTitleDetail) {
            sceneManagerRef.current.setupCenterNodeButtons(
                currentTitleDetail,
                getNodeDetailButtonContext(currentTitleDetail)
            );
            return;
        }
        if (view === 'nodeDetail' && currentNodeDetail) {
            sceneManagerRef.current.setupSenseDetailButton(currentNodeDetail);
            return;
        }
        if (view !== 'titleDetail' && view !== 'nodeDetail') {
            sceneManagerRef.current.clearNodeButtons();
        }
    }, [view, currentNodeDetail, currentTitleDetail, isAdmin, username, userLocation, travelStatus.isTraveling, travelStatus.isStopping, relatedDomainsData.favoriteDomains, nodeDistributionStatus, intelHeistStatus, siegeStatus]);

    useEffect(() => {
        if (!isWebGLReady) {
            setSenseSelectorAnchor({ x: 0, y: 0, visible: false });
            senseSelectorAnchorRef.current = { x: 0, y: 0, visible: false };
            setIsSenseSelectorVisible(false);
            return undefined;
        }
        if (!isKnowledgeDetailView(view) && view !== 'home') {
            setSenseSelectorAnchor({ x: 0, y: 0, visible: false });
            senseSelectorAnchorRef.current = { x: 0, y: 0, visible: false };
            setIsSenseSelectorVisible(false);
            return undefined;
        }
        if (view === 'home' && !isSenseSelectorVisible) return undefined;

        let rafId = 0;
        const updateAnchor = () => {
            const sceneManager = sceneManagerRef.current;
            const renderer = sceneManager?.renderer;
            const targetNode = view === 'home'
                ? sceneManager?.currentLayout?.nodes?.find((item) => (
                    normalizeObjectId(item?.data?._id) === normalizeObjectId(senseSelectorSourceNode?._id)
                ))
                : sceneManager?.currentLayout?.nodes?.find((item) => item?.type === 'center');
            const canvas = webglCanvasRef.current;
            if (renderer && targetNode && canvas) {
                const screenPos = renderer.worldToScreen(targetNode.x, targetNode.y);
                const rect = canvas.getBoundingClientRect();
                const next = {
                    x: rect.left + screenPos.x,
                    y: rect.top + screenPos.y,
                    visible: true
                };
                const prev = senseSelectorAnchorRef.current || { x: 0, y: 0, visible: false };
                const moved = Math.abs(prev.x - next.x) > 0.5 || Math.abs(prev.y - next.y) > 0.5 || prev.visible !== next.visible;
                if (moved) {
                    senseSelectorAnchorRef.current = next;
                    setSenseSelectorAnchor(next);
                }
            }
            rafId = window.requestAnimationFrame(updateAnchor);
        };

        rafId = window.requestAnimationFrame(updateAnchor);
        return () => {
            window.cancelAnimationFrame(rafId);
        };
    }, [
        view,
        currentNodeDetail?._id,
        currentNodeDetail?.activeSenseId,
        currentTitleDetail?._id,
        senseSelectorSourceNode?._id,
        isSenseSelectorVisible,
        isWebGLReady
    ]);

    useEffect(() => {
        if (!isSenseSelectorVisible) return undefined;
        if (view !== 'nodeDetail' && view !== 'titleDetail' && view !== 'home') return undefined;
        const canvas = webglCanvasRef.current;
        const renderer = sceneManagerRef.current?.renderer;
        if (!canvas || !renderer) return undefined;

        const handleMapClick = (event) => {
            const pos = renderer.getCanvasPositionFromEvent(event);
            const clickedNode = renderer.hitTest(pos.x, pos.y);
            if (view === 'home') {
                const anyNode = renderer.hitTest(pos.x, pos.y);
                if (!anyNode) setIsSenseSelectorVisible(false);
                return;
            }
            if (!clickedNode || clickedNode.type !== 'center') {
                setIsSenseSelectorVisible(false);
            }
        };

        canvas.addEventListener('click', handleMapClick);
        return () => {
            canvas.removeEventListener('click', handleMapClick);
        };
    }, [isSenseSelectorVisible, view, currentNodeDetail?._id, currentTitleDetail?._id]);


    // 新节点创建相关函数
    const openCreateNodeModal = () => {
        setShowCreateNodeModal(true);
    };

    // 进入知识域
    const handleEnterKnowledgeDomain = (node, options = {}) => {
        if (!sceneManagerRef.current || !node) return;
        const mode = options?.mode === 'intelHeist' ? 'intelHeist' : 'normal';

        trackRecentDomain(node);
        setKnowledgeDomainMode(mode);
        setKnowledgeDomainNode(node);
        setIsTransitioningToDomain(true);
        setShowNodeInfoModal(false); // 关闭节点信息弹窗
        setTitleRelationInfo(null);
        setIsSenseSelectorVisible(false);

        // 开始过渡动画
        sceneManagerRef.current.enterKnowledgeDomain(
            () => {
                // 动画完成，显示知识域场景
                setShowKnowledgeDomain(true);
                setIsTransitioningToDomain(false);
                setDomainTransitionProgress(1);
            },
            (progress) => {
                // 更新过渡进度
                setDomainTransitionProgress(progress);
            }
        );
    };

    // 退出知识域
    const handleExitKnowledgeDomain = (options = {}) => {
        const exitReason = options?.reason || '';
        const exitMessage = typeof options?.message === 'string' ? options.message : '';
        if (!sceneManagerRef.current) {
            setShowKnowledgeDomain(false);
            setDomainTransitionProgress(0);
            setKnowledgeDomainNode(null);
            setKnowledgeDomainMode('normal');
            if (exitMessage) {
                window.alert(exitMessage);
            } else if (exitReason === 'intel-timeout') {
                window.alert('情报窃取时间耗尽');
            }
            return;
        }

        setIsTransitioningToDomain(true);

        // 开始反向过渡动画
        sceneManagerRef.current.exitKnowledgeDomain(
            () => {
                // 开始恢复场景，知识域开始淡出
                setShowKnowledgeDomain(false);
            },
            (progress) => {
                // 更新过渡进度（从1到0）
                setDomainTransitionProgress(progress);
            },
            () => {
                // 动画完成
                setIsTransitioningToDomain(false);
                setDomainTransitionProgress(0);
                setKnowledgeDomainNode(null);
                setKnowledgeDomainMode('normal');
                if (exitMessage) {
                    window.alert(exitMessage);
                } else if (exitReason === 'intel-timeout') {
                    window.alert('情报窃取时间耗尽');
                }
            }
        );
    };

    const renderUnifiedRightDock = () => {
        if (isAdmin) return null;
        const activeDetailNode = isTitleBattleView(view) ? currentTitleDetail : currentNodeDetail;
        const canRenderDock = view === 'home' || (isKnowledgeDetailView(view) && activeDetailNode);
        if (!canRenderDock) return null;

        const canJumpToLocationView = Boolean(
            !travelStatus.isTraveling &&
            currentLocationNodeDetail &&
            userLocation &&
            !(isKnowledgeDetailView(view) && activeDetailNode?.name === userLocation)
        );
        const activeAnnouncements = announcementDockTab === 'alliance'
            ? allianceAnnouncements
            : systemAnnouncements;
        const locationParentLabels = (() => {
            const parentNodes = Array.isArray(currentLocationNodeDetail?.parentNodesInfo)
                ? currentLocationNodeDetail.parentNodesInfo
                : [];
            const labelsFromNodes = parentNodes
                .map((item) => getNodeDisplayName(item))
                .filter(Boolean);
            if (labelsFromNodes.length > 0) return labelsFromNodes;
            return (Array.isArray(currentLocationNodeDetail?.relatedParentDomains)
                ? currentLocationNodeDetail.relatedParentDomains
                : [])
                .map((name) => (typeof name === 'string' ? name.trim() : ''))
                .filter(Boolean);
        })();
        const locationChildLabels = (() => {
            const childNodes = Array.isArray(currentLocationNodeDetail?.childNodesInfo)
                ? currentLocationNodeDetail.childNodesInfo
                : [];
            const labelsFromNodes = childNodes
                .map((item) => getNodeDisplayName(item))
                .filter(Boolean);
            if (labelsFromNodes.length > 0) return labelsFromNodes;
            return (Array.isArray(currentLocationNodeDetail?.relatedChildDomains)
                ? currentLocationNodeDetail.relatedChildDomains
                : [])
                .map((name) => (typeof name === 'string' ? name.trim() : ''))
                .filter(Boolean);
        })();
        const locationSenseTitle = getNodeSenseTitle(currentLocationNodeDetail);
        const locationSenseContent = getNodeSenseContent(currentLocationNodeDetail);

        return (
            <>
                <div className={`home-announcement-dock ${isAnnouncementDockExpanded ? 'expanded' : 'collapsed'}`}>
                    <aside className={`home-announcement-dock-panel ${isAnnouncementDockExpanded ? 'expanded' : ''}`}>
                        <div className="home-announcement-dock-header">
                            <h3>公告栏</h3>
                            <div className="home-announcement-header-actions">
                                <button
                                    type="button"
                                    className="home-announcement-readall-btn"
                                    onClick={() => markAnnouncementNotificationsRead()}
                                    disabled={isMarkingAnnouncementsRead || announcementUnreadCount <= 0}
                                >
                                    {isMarkingAnnouncementsRead ? '处理中...' : '全部已读'}
                                </button>
                                <button
                                    type="button"
                                    className="home-announcement-collapse-btn"
                                    onClick={() => setIsAnnouncementDockExpanded(false)}
                                >
                                    收起
                                </button>
                            </div>
                        </div>
                        <div className="home-announcement-tab-row">
                            <button
                                type="button"
                                className={`home-announcement-tab ${announcementDockTab === 'system' ? 'active' : ''}`}
                                onClick={() => setAnnouncementDockTab('system')}
                            >
                                系统公告
                            </button>
                            <button
                                type="button"
                                className={`home-announcement-tab ${announcementDockTab === 'alliance' ? 'active' : ''}`}
                                onClick={() => setAnnouncementDockTab('alliance')}
                            >
                                熵盟公告
                            </button>
                        </div>
                        <div className="home-announcement-dock-body">
                            {activeAnnouncements.length === 0 ? (
                                <div className="home-announcement-empty">
                                    {announcementDockTab === 'alliance' ? '暂无熵盟公告' : '暂无系统公告'}
                                </div>
                            ) : (
                                activeAnnouncements.map((item) => (
                                    <button
                                        type="button"
                                        key={item._id}
                                        className={`home-announcement-item ${item.read ? '' : 'unread'}`}
                                        onClick={() => handleHomeAnnouncementClick(item)}
                                    >
                                        {!item.read && <span className="home-announcement-new">NEW!</span>}
                                        <span className="home-announcement-title">{item.title || '知识点分发预告'}</span>
                                        <span className="home-announcement-message">{item.message || ''}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    </aside>
                    <button
                        type="button"
                        className="home-announcement-dock-toggle"
                        onClick={() => {
                            setIsAnnouncementDockExpanded((prev) => {
                                const next = !prev;
                                if (next) {
                                    markAnnouncementNotificationsRead();
                                }
                                return next;
                            });
                        }}
                        title={isAnnouncementDockExpanded ? '收起公告栏' : '展开公告栏'}
                    >
                        <Bell size={18} />
                        <span className="home-announcement-dock-label">公告</span>
                        {announcementUnreadCount > 0 && <span className="home-announcement-dock-dot" />}
                        {isAnnouncementDockExpanded ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>
                </div>

                <div className={`home-location-dock ${isLocationDockExpanded ? 'expanded' : 'collapsed'}`}>
                    <aside className={`home-location-dock-panel ${isLocationDockExpanded ? 'expanded' : ''}`}>
                        <div className="location-sidebar-header home-location-sidebar-header">
                            <div className="home-location-header-row">
                                <h3>{travelStatus?.isTraveling ? '移动状态' : '当前所在的知识域'}</h3>
                                <button
                                    type="button"
                                    className="home-location-collapse-btn"
                                    onClick={() => setIsLocationDockExpanded(false)}
                                >
                                    收起
                                </button>
                            </div>
                        </div>

                        <div className="home-location-panel-body">
                            {travelStatus?.isTraveling ? (
                                <div className="travel-sidebar-content">
                                    <div className="travel-main-info">
                                        <div className="travel-destination">
                                            {travelStatus?.isStopping ? '停止目标' : '目标节点'}: <strong>{travelStatus?.targetNode?.nodeName}</strong>
                                        </div>
                                        <div className="travel-metrics">
                                            <span>剩余距离: {travelStatus?.remainingDistanceUnits?.toFixed?.(2) ?? travelStatus?.remainingDistanceUnits} 单位</span>
                                            <span>剩余时间: {formatTravelSeconds(travelStatus?.remainingSeconds)}</span>
                                            {travelStatus?.queuedTargetNode?.nodeName && (
                                                <span>已排队目标: {travelStatus.queuedTargetNode.nodeName}</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="travel-anim-layout">
                                        <button
                                            type="button"
                                            className={`travel-node-card next ${normalizeObjectId(travelStatus?.nextNode?.nodeId) ? 'clickable' : 'disabled'}`}
                                            onClick={() => handleOpenTravelNode(travelStatus?.nextNode)}
                                            disabled={!normalizeObjectId(travelStatus?.nextNode?.nodeId)}
                                        >
                                            <div className="travel-node-label">下一目的地</div>
                                            <div className="travel-node-name">{travelStatus?.nextNode?.nodeName || '-'}</div>
                                        </button>
                                        <div className="travel-track-wrap">
                                            <div className="travel-track">
                                                <div
                                                    className="travel-progress-dot"
                                                    style={{ left: `${(1 - (travelStatus?.progressInCurrentSegment || 0)) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className={`travel-node-card reached ${normalizeObjectId(travelStatus?.lastReachedNode?.nodeId) ? 'clickable' : 'disabled'}`}
                                            onClick={() => handleOpenTravelNode(travelStatus?.lastReachedNode)}
                                            disabled={!normalizeObjectId(travelStatus?.lastReachedNode?.nodeId)}
                                        >
                                            <div className="travel-node-label">最近到达</div>
                                            <div className="travel-node-name">{travelStatus?.lastReachedNode?.nodeName || '-'}</div>
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        className="btn btn-danger travel-stop-btn"
                                        onClick={stopTravel}
                                        disabled={isStoppingTravel || travelStatus?.isStopping}
                                    >
                                        {(isStoppingTravel || travelStatus?.isStopping) ? '停止进行中...' : '停止移动'}
                                    </button>

                                    {siegeSupportStatuses.length > 0 && (
                                        <div className="location-siege-support-section">
                                            <div className="section-label">派遣兵力状态</div>
                                            <div className="location-siege-support-list">
                                                {siegeSupportStatuses.map((item) => (
                                                    <button
                                                        type="button"
                                                        key={`moving-support-${item.nodeId}-${item.gateKey}-${item.requestedAt || ''}`}
                                                        className="location-siege-support-row"
                                                        onClick={() => handleOpenTravelNode(item)}
                                                        disabled={!item.nodeId}
                                                    >
                                                        <span>{item.nodeName || '未知知识域'}</span>
                                                        <span>{item.gateLabel || CITY_GATE_LABEL_MAP[item.gateKey] || item.gateKey}</span>
                                                        <span>{item.statusLabel || item.status || '-'}</span>
                                                        <em>{item.totalCount || 0}</em>
                                                        {item.status === 'moving' && (
                                                            <small>剩余 {formatTravelSeconds(item.remainingSeconds)}</small>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : currentLocationNodeDetail ? (
                                <div
                                    className={`location-sidebar-content ${canJumpToLocationView ? 'location-sidebar-jumpable' : ''}`}
                                    onClick={() => {
                                        if (canJumpToLocationView) {
                                            handleJumpToCurrentLocationView();
                                        }
                                    }}
                                >
                                    <div className="location-node-title">{getNodeDisplayName(currentLocationNodeDetail)}</div>

                                    {currentLocationNodeDetail.description && (
                                        <div className="location-node-section">
                                            <div className="section-label">概述</div>
                                            <div className="section-content">{currentLocationNodeDetail.description}</div>
                                        </div>
                                    )}

                                    {locationSenseTitle && (
                                        <div className="location-node-section">
                                            <div className="section-label">当前释义</div>
                                            <div className="section-content">{locationSenseTitle}</div>
                                        </div>
                                    )}

                                    {locationParentLabels.length > 0 && (
                                        <div className="location-node-section">
                                            <div className="section-label">父域</div>
                                            <div className="section-tags">
                                                {locationParentLabels.map((parent, idx) => (
                                                    <span key={idx} className="node-tag parent-tag">{parent}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {locationChildLabels.length > 0 && (
                                        <div className="location-node-section">
                                            <div className="section-label">子域</div>
                                            <div className="section-tags">
                                                {locationChildLabels.map((child, idx) => (
                                                    <span key={idx} className="node-tag child-tag">{child}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {locationSenseContent && (
                                        <div className="location-node-section">
                                            <div className="section-label">释义内容</div>
                                            <div className="section-content knowledge-content">
                                                {locationSenseContent}
                                            </div>
                                        </div>
                                    )}

                                    {siegeSupportStatuses.length > 0 && (
                                        <div className="location-node-section location-siege-support-section">
                                            <div className="section-label">派遣兵力状态</div>
                                            <div className="location-siege-support-list">
                                                {siegeSupportStatuses.map((item) => (
                                                    <button
                                                        type="button"
                                                        key={`idle-support-${item.nodeId}-${item.gateKey}-${item.requestedAt || ''}`}
                                                        className="location-siege-support-row"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            handleOpenTravelNode(item);
                                                        }}
                                                        disabled={!item.nodeId}
                                                    >
                                                        <span>{item.nodeName || '未知知识域'}</span>
                                                        <span>{item.gateLabel || CITY_GATE_LABEL_MAP[item.gateKey] || item.gateKey}</span>
                                                        <span>{item.statusLabel || item.status || '-'}</span>
                                                        <em>{item.totalCount || 0}</em>
                                                        {item.status === 'moving' && (
                                                            <small>剩余 {formatTravelSeconds(item.remainingSeconds)}</small>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="location-sidebar-empty">
                                    <p>暂未降临到任何知识域</p>
                                </div>
                            )}
                        </div>
                    </aside>

                    <button
                        type="button"
                        className="home-location-dock-toggle"
                        onClick={() => setIsLocationDockExpanded((prev) => !prev)}
                        title={isLocationDockExpanded ? '收起当前所在知识域' : '展开当前所在知识域'}
                    >
                        <MapPin size={18} />
                        <span className="home-location-dock-label">
                            {travelStatus?.isTraveling ? '移动中' : '知识域'}
                        </span>
                        {isLocationDockExpanded ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>
                </div>
            </>
        );
    };

    const renderDistributionParticipationPanel = () => {
        if (view !== 'titleDetail' || !showDistributionPanel || !currentTitleDetail) return null;
        const data = distributionPanelState.data;
        if (!data) return null;
        const activeNode = currentTitleDetail;
        const pool = data.pool || {};
        const phaseLabelMap = {
            entry_open: '可入场',
            entry_closed: '入场截止',
            settling: '结算中',
            ended: '已结束',
            none: '未开始'
        };
        const phaseLabel = phaseLabelMap[data.phase] || '进行中';
        const participationStatusText = data.joined
            ? '你已参与'
            : (data.phase === 'entry_open' ? '你未参与' : '已无法参与');
        const participationStatusClass = data.joined
            ? 'joined'
            : (data.phase === 'entry_open' ? 'not-joined' : 'locked');
        const rewardLabel = pool.rewardFrozen ? '实际获得知识点' : '当前可获得';
        const rewardText = (pool.rewardValue === null || pool.rewardValue === undefined)
            ? ''
            : Number(pool.rewardValue).toFixed(2);
        const poolUsers = Array.isArray(pool.users) ? pool.users : [];
        const canPromptMoveThenJoin = (
            !!data.requiresManualEntry &&
            !data.joined &&
            data.phase === 'entry_open' &&
            ((userLocation || '').trim() !== (activeNode?.name || '').trim())
        );
        const joinButtonDisabled = (!data.canJoin && !canPromptMoveThenJoin) || distributionPanelState.joining;
        return (
            <div className="distribution-panel-overlay">
                <div className="distribution-panel-modal">
                    <button type="button" className="distribution-panel-close" onClick={closeDistributionPanel}>×</button>
                    <div className="distribution-panel-title-row">
                        <h3>{`分发活动：${getNodeDisplayName(activeNode)}`}</h3>
                        <div className="distribution-panel-title-tags">
                            <span className={`distribution-panel-phase phase-${data.phase}`}>{phaseLabel}</span>
                            <span className={`distribution-panel-participation-status ${participationStatusClass}`}>{participationStatusText}</span>
                        </div>
                    </div>

                    {data.phase === 'entry_open' && (
                        <div className="distribution-panel-timer-row">
                            <span>{`入场截止：${formatCountdownText(data.secondsToEntryClose)}`}</span>
                            <span>{`执行倒计时：${formatCountdownText(data.secondsToExecute)}`}</span>
                        </div>
                    )}
                    {data.phase === 'entry_closed' && (
                        <div className="distribution-panel-timer-row">
                            <span>{`执行倒计时：${formatCountdownText(data.secondsToExecute)}`}</span>
                        </div>
                    )}
                    {data.phase === 'settling' && (
                        <div className="distribution-panel-timer-row">
                            <span>{`活动结束：${formatCountdownText(data.secondsToEnd)}`}</span>
                        </div>
                    )}

                    <div className="distribution-panel-grid">
                        <div className="distribution-panel-card"><span>参与总人数</span><strong>{data.participantTotal || 0}</strong></div>
                        <div className="distribution-panel-card"><span>本池总比例</span><strong>{Number(pool.poolPercent || 0).toFixed(2)}%</strong></div>
                        <div className="distribution-panel-card"><span>你的实际比例</span><strong>{Number(pool.userActualPercent || 0).toFixed(2)}%</strong></div>
                        <div className="distribution-panel-card"><span>{rewardLabel}</span><strong>{rewardText}</strong></div>
                        <div className="distribution-panel-card"><span>所在规则池</span><strong>{pool.label || '未命中规则池'}</strong></div>
                    </div>

                    {distributionPanelState.error && <div className="distribution-panel-error">{distributionPanelState.error}</div>}
                    <div className="distribution-panel-pool-row">
                        <div className="distribution-panel-pool-row-title">
                            {`同池人数：${pool.participantCount || 0}`}
                        </div>
                        <div className="distribution-panel-pool-avatars">
                            {poolUsers.length > 0 ? poolUsers.map((item) => (
                                <div
                                    key={item.userId || item.username}
                                    className="distribution-panel-pool-avatar"
                                    title={item.displayName || item.username || ''}
                                >
                                    <img
                                        src={avatarMap[item.avatar] || avatarMap.default_male_1}
                                        alt={item.username || '用户'}
                                    />
                                </div>
                            )) : (
                                <span className="distribution-panel-pool-empty">暂无</span>
                            )}
                        </div>
                    </div>

                    <div className="distribution-panel-actions">
                        <button
                            type="button"
                            className="btn btn-small btn-success"
                            onClick={joinDistributionFromPanel}
                            disabled={joinButtonDisabled}
                        >
                            {distributionPanelState.joining ? '参与中...' : '参与分发'}
                        </button>
                        {data.canExit && (
                            <button
                                type="button"
                                className="btn btn-small btn-danger"
                                onClick={exitDistributionFromPanel}
                                disabled={distributionPanelState.exiting}
                            >
                                {distributionPanelState.exiting ? '退出中...' : '退出分发活动'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const renderNotificationsPanel = () => {
        if (!showNotificationsPanel) return null;
        const refreshNotifications = async () => {
            await fetchNotifications(false);
            if (isAdmin) {
                await fetchAdminPendingNodeReminders(false);
            }
        };

        if (isAdmin) {
            const latestPendingNode = [...adminPendingNodes]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
            const adminReminders = [];

            if (pendingMasterApplyCount > 0) {
                adminReminders.push({
                    key: 'pending-master-apply',
                    title: '有用户申请域主',
                    message: `当前有 ${pendingMasterApplyCount} 条域主申请待处理。`,
                    createdAt: notifications.find((item) => (
                        item.type === 'domain_master_apply' && item.status === 'pending'
                    ))?.createdAt || null
                });
            }

            if (adminPendingNodes.length > 0) {
                adminReminders.push({
                    key: 'pending-node-create',
                    title: (adminPendingNodes.length === 1 && latestPendingNode?.name)
                        ? `有用户提交了创建「${latestPendingNode.name}」知识域`
                        : '有用户提交了创建知识域申请',
                    message: `当前有 ${adminPendingNodes.length} 条建节点申请待审批。`,
                    createdAt: latestPendingNode?.createdAt || null
                });
            }

            return (
                <div className="notifications-panel">
                    <div className="notifications-header">
                        <h3>通知中心</h3>
                        <button
                            type="button"
                            className="btn btn-small btn-blue"
                            onClick={markAllNotificationsRead}
                            disabled={isNotificationsLoading || isMarkingAllRead || notificationUnreadCount === 0}
                        >
                            {isMarkingAllRead ? '处理中...' : '全部已读'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-small btn-danger"
                            onClick={clearNotifications}
                            disabled={isNotificationsLoading || isClearingNotifications || notifications.length === 0}
                        >
                            {isClearingNotifications ? '清空中...' : '清空通知'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-small btn-secondary"
                            onClick={refreshNotifications}
                            disabled={isNotificationsLoading}
                        >
                            {isNotificationsLoading ? '刷新中...' : '刷新'}
                        </button>
                    </div>
                    <div className="notifications-body">
                        {adminReminders.length === 0 ? (
                            <div className="no-notifications">暂无审批提醒</div>
                        ) : (
                            <div className="notifications-list">
                                {adminReminders.map((reminder) => (
                                    <div key={reminder.key} className="notification-item unread">
                                        <div className="notification-item-title-row">
                                            <h4>{reminder.title}</h4>
                                            <span className="notification-dot" />
                                        </div>
                                        <div className="notification-item-message">{reminder.message}</div>
                                        <div className="notification-item-meta">
                                            {formatNotificationTime(reminder.createdAt)}
                                        </div>
                                        <div className="notification-actions">
                                            <button
                                                type="button"
                                                className="btn btn-small btn-warning"
                                                onClick={() => {
                                                    setShowNotificationsPanel(false);
                                                    openAdminPanel('pending');
                                                }}
                                            >
                                                前往待审批
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        return (
            <div className="notifications-panel">
                <div className="notifications-header">
                    <h3>通知中心</h3>
                    <button
                        type="button"
                        className="btn btn-small btn-blue"
                        onClick={markAllNotificationsRead}
                        disabled={isNotificationsLoading || isMarkingAllRead || notificationUnreadCount === 0}
                    >
                        {isMarkingAllRead ? '处理中...' : '全部已读'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-small btn-danger"
                        onClick={clearNotifications}
                        disabled={isNotificationsLoading || isClearingNotifications || notifications.length === 0}
                    >
                        {isClearingNotifications ? '清空中...' : '清空通知'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={refreshNotifications}
                        disabled={isNotificationsLoading}
                    >
                        {isNotificationsLoading ? '刷新中...' : '刷新'}
                    </button>
                </div>
                <div className="notifications-body">
                    {notifications.length === 0 ? (
                        <div className="no-notifications">暂无通知</div>
                    ) : (
                        <div className="notifications-list">
                            {notifications.map((notification) => {
                                const isInvitePending =
                                    notification.type === 'domain_admin_invite' &&
                                    notification.status === 'pending';
                                const isResignRequestPending =
                                    notification.type === 'domain_admin_resign_request' &&
                                    notification.status === 'pending';
                                const isMasterApplyPending =
                                    notification.type === 'domain_master_apply' &&
                                    notification.status === 'pending';
                                const isAllianceJoinApplyPending =
                                    notification.type === 'alliance_join_apply' &&
                                    notification.status === 'pending';
                                const isDistributionAnnouncement =
                                    notification.type === 'domain_distribution_announcement';
                                const isArrivalNotification =
                                    notification.type === 'info' &&
                                    typeof notification.nodeName === 'string' &&
                                    notification.nodeName.trim() !== '';
                                const currentActionKey = notificationActionId.split(':')[0];
                                const isActing = currentActionKey === notification._id;

                                return (
                                    <div
                                        key={notification._id}
                                        className={`notification-item ${notification.read ? '' : 'unread'}`}
                                        onClick={(event) => {
                                            if (event.target.closest('.notification-actions')) {
                                                return;
                                            }
                                            if (isDistributionAnnouncement) {
                                                handleDistributionAnnouncementClick(notification);
                                                return;
                                            }
                                            if (isArrivalNotification) {
                                                handleArrivalNotificationClick(notification);
                                                return;
                                            }
                                            if (!notification.read) {
                                                markNotificationRead(notification._id);
                                            }
                                        }}
                                    >
                                        <div className="notification-item-title-row">
                                            <h4>{notification.title || '系统通知'}</h4>
                                            {!notification.read && <span className="notification-dot" />}
                                        </div>
                                        <div className="notification-item-message">{notification.message || ''}</div>
                                        <div className="notification-item-meta">
                                            {formatNotificationTime(notification.createdAt)}
                                        </div>
                                        {(notification.type === 'domain_admin_invite_result'
                                            || notification.type === 'domain_admin_resign_result'
                                            || notification.type === 'domain_master_apply_result'
                                            || notification.type === 'alliance_join_apply_result') && (
                                            <div className={`notification-result-tag ${notification.status === 'accepted' ? 'accepted' : 'rejected'}`}>
                                                {notification.status === 'accepted'
                                                    ? (notification.type === 'domain_admin_resign_result'
                                                        ? '域主已同意卸任'
                                                        : notification.type === 'domain_master_apply_result'
                                                            ? '管理员已同意你成为域主'
                                                            : notification.type === 'alliance_join_apply_result'
                                                                ? '盟主已同意入盟'
                                                            : '对方已接受')
                                                    : (notification.type === 'domain_admin_resign_result'
                                                        ? '域主已拒绝卸任'
                                                        : notification.type === 'domain_master_apply_result'
                                                            ? '管理员已拒绝你的域主申请'
                                                            : notification.type === 'alliance_join_apply_result'
                                                                ? '盟主已拒绝入盟'
                                                            : '对方已拒绝')}
                                            </div>
                                        )}

                                        {isInvitePending ? (
                                            <div className="notification-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-success"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'accept')}
                                                    disabled={isActing}
                                                >
                                                    接受
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-danger"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'reject')}
                                                    disabled={isActing}
                                                >
                                                    拒绝
                                                </button>
                                            </div>
                                        ) : isResignRequestPending ? (
                                            <div className="notification-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-success"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'accept')}
                                                    disabled={isActing}
                                                >
                                                    同意卸任
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-danger"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'reject')}
                                                    disabled={isActing}
                                                >
                                                    拒绝
                                                </button>
                                            </div>
                                        ) : isMasterApplyPending ? (
                                            <div className="notification-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-warning"
                                                    onClick={() => {
                                                        setShowNotificationsPanel(false);
                                                        openAdminPanel('pending');
                                                    }}
                                                >
                                                    前往待审批
                                                </button>
                                            </div>
                                        ) : isAllianceJoinApplyPending ? (
                                            <div className="notification-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-success"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'accept')}
                                                    disabled={isActing}
                                                >
                                                    同意加入
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-danger"
                                                    onClick={() => respondDomainAdminInvite(notification._id, 'reject')}
                                                    disabled={isActing}
                                                >
                                                    拒绝
                                                </button>
                                            </div>
                                        ) : (isDistributionAnnouncement && notification.requiresArrival) ? (
                                            <div className="notification-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-small btn-warning"
                                                    onClick={() => handleDistributionAnnouncementClick(notification)}
                                                >
                                                    点击前往
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const resolveSenseSelectorNode = () => {
        if (view === 'titleDetail' && currentTitleDetail) return currentTitleDetail;
        if (view === 'nodeDetail' && currentNodeDetail) return currentNodeDetail;
        if (senseSelectorSourceNode) return senseSelectorSourceNode;
        return null;
    };

    const handleSwitchTitleView = async () => {
        const selectorNode = resolveSenseSelectorNode();
        const nodeId = normalizeObjectId(selectorNode?._id);
        if (!nodeId) return;
        if (view === 'titleDetail' && normalizeObjectId(currentTitleDetail?._id) === nodeId) {
            setIsSenseSelectorVisible(false);
            return;
        }
        const clickedNode = buildClickedNodeFromScene(nodeId);
        await fetchTitleDetail(nodeId, clickedNode, {
            relationHint: 'jump'
        });
        setIsSenseSelectorVisible(false);
    };

    const handleSwitchSenseView = async (senseId) => {
        const selectorNode = resolveSenseSelectorNode();
        const nodeId = normalizeObjectId(selectorNode?._id);
        const nextSenseId = typeof senseId === 'string' ? senseId.trim() : '';
        if (!nodeId || !nextSenseId) return;
        if (
            view === 'nodeDetail'
            && normalizeObjectId(currentNodeDetail?._id) === nodeId
            && currentNodeDetail?.activeSenseId === nextSenseId
        ) {
            setIsSenseSelectorVisible(false);
            return;
        }
        const clickedNode = buildClickedNodeFromScene(nodeId);
        await fetchNodeDetail(nodeId, clickedNode, {
            relationHint: 'jump',
            activeSenseId: nextSenseId
        });
        setIsSenseSelectorVisible(false);
    };

    const renderSenseSelectorPanel = () => {
        if (view !== 'home' && view !== 'nodeDetail' && view !== 'titleDetail') return null;
        const selectorNode = resolveSenseSelectorNode();
        if (!selectorNode) return null;
        if (!isSenseSelectorVisible || !senseSelectorAnchor.visible) return null;
        const senses = Array.isArray(selectorNode?.synonymSenses) && selectorNode.synonymSenses.length > 0
            ? selectorNode.synonymSenses
            : [{
                senseId: selectorNode?.activeSenseId || 'sense_1',
                title: selectorNode?.activeSenseTitle || '基础释义',
                content: selectorNode?.activeSenseContent || selectorNode?.description || ''
            }];
        const activeSenseId = (
            view === 'nodeDetail'
            && normalizeObjectId(currentNodeDetail?._id) === normalizeObjectId(selectorNode?._id)
        )
            ? (currentNodeDetail?.activeSenseId || '')
            : '';
        const style = selectorNode?.visualStyle || {};
        const panelStyle = {
            left: `${senseSelectorAnchor.x}px`,
            top: `${senseSelectorAnchor.y}px`,
            background: `linear-gradient(120deg, ${hexToRgba(style.primaryColor || '#1e293b', 0.76)} 0%, ${hexToRgba(style.secondaryColor || '#334155', 0.68)} 100%)`,
            borderColor: hexToRgba(style.rimColor || style.primaryColor || '#a855f7', 0.74),
            color: style.textColor || '#f8fafc'
        };

        return (
            <div className="sense-selector-panel" style={panelStyle}>
                <button
                    type="button"
                    className="sense-selector-title sense-selector-title-btn"
                    onClick={handleSwitchTitleView}
                >
                    {selectorNode?.name || '未命名知识域'}
                </button>
                <div className="sense-selector-list">
                    {senses.map((sense) => {
                        const isActive = !!activeSenseId && sense?.senseId === activeSenseId;
                        return (
                            <button
                                key={sense?.senseId || sense?.title}
                                type="button"
                                className={`sense-selector-item ${isActive ? 'active' : ''}`}
                                onClick={() => handleSwitchSenseView(sense?.senseId)}
                            >
                                {sense?.title || '未命名释义'}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderTitleRelationInfoPanel = () => {
        if (view !== 'titleDetail' || !titleRelationInfo) return null;
        const edge = titleRelationInfo;
        const leftName = edge?.nodeAName || '未命名标题';
        const rightName = edge?.nodeBName || '未命名标题';
        const pairRows = Array.isArray(edge?.pairs) ? edge.pairs : [];
        const nodeAId = normalizeObjectId(edge?.nodeAId);
        const nodeBId = normalizeObjectId(edge?.nodeBId);
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const estimateSenseComplexity = (text = '') => (
            Array.from(typeof text === 'string' ? text.trim() : '')
                .reduce((sum, ch) => {
                    if (/\s/.test(ch)) return sum + 0.2;
                    if (/[A-Za-z0-9]/.test(ch)) return sum + 0.55;
                    return sum + 1;
                }, 0)
        );
        const resolveTitleByNodeId = (nodeId) => {
            const normalized = normalizeObjectId(nodeId);
            if (normalized && normalized === nodeAId) return leftName;
            if (normalized && normalized === nodeBId) return rightName;
            return '未命名标题';
        };
        const diagramMap = new Map();
        pairRows.forEach((item) => {
            const relationType = item?.relationType === 'contains' || item?.relationType === 'extends'
                ? item.relationType
                : '';
            if (!relationType) return;

            const sourceNodeId = normalizeObjectId(item?.sourceNodeId);
            const targetNodeId = normalizeObjectId(item?.targetNodeId);
            const sourceSenseId = typeof item?.sourceSenseId === 'string' ? item.sourceSenseId.trim() : '';
            const targetSenseId = typeof item?.targetSenseId === 'string' ? item.targetSenseId.trim() : '';
            const sourceTitleName = resolveTitleByNodeId(sourceNodeId);
            const targetTitleName = resolveTitleByNodeId(targetNodeId);
            const sourceSenseTitle = typeof item?.sourceSenseTitle === 'string' ? item.sourceSenseTitle.trim() : '';
            const targetSenseTitle = typeof item?.targetSenseTitle === 'string' ? item.targetSenseTitle.trim() : '';

            // 统一语义：大椭圆 = 包含方；小椭圆 = 被包含方（互反 contains/extends 合并为同一图）
            const upper = relationType === 'contains'
                ? {
                    nodeId: sourceNodeId,
                    senseId: sourceSenseId,
                    titleName: sourceTitleName,
                    senseTitle: sourceSenseTitle || '未命名释义'
                }
                : {
                    nodeId: targetNodeId,
                    senseId: targetSenseId,
                    titleName: targetTitleName,
                    senseTitle: targetSenseTitle || '未命名释义'
                };
            const lower = relationType === 'contains'
                ? {
                    nodeId: targetNodeId,
                    senseId: targetSenseId,
                    titleName: targetTitleName,
                    senseTitle: targetSenseTitle || '未命名释义'
                }
                : {
                    nodeId: sourceNodeId,
                    senseId: sourceSenseId,
                    titleName: sourceTitleName,
                    senseTitle: sourceSenseTitle || '未命名释义'
                };

            const mergeKey = `${upper.nodeId || 'u'}|${upper.senseId || 'us'}|${lower.nodeId || 'l'}|${lower.senseId || 'ls'}`;
            if (!diagramMap.has(mergeKey)) {
                diagramMap.set(mergeKey, {
                    key: mergeKey,
                    bigTitle: upper.titleName || '未命名标题',
                    bigSense: upper.senseTitle || '未命名释义',
                    smallTitle: lower.titleName || '未命名标题',
                    smallSense: lower.senseTitle || '未命名释义'
                });
            }
        });
        const diagrams = Array.from(diagramMap.values()).map((item) => {
            const complexity = estimateSenseComplexity(item.bigSense);
            const overlapRatio = 0.8;
            const bigWidthPct = clamp(30 + complexity * 1.15, 30, 54);
            const smallWidthPct = clamp(bigWidthPct * 0.72, 24, 32);
            // 基于相对坐标先构建，再整体平移到容器中心，保证组合图在弹窗中居中
            const bigLeftBase = 0;
            const smallLeftBase = bigWidthPct - smallWidthPct * overlapRatio;
            const groupLeftBase = Math.min(bigLeftBase, smallLeftBase);
            const groupRightBase = Math.max(bigLeftBase + bigWidthPct, smallLeftBase + smallWidthPct);
            const groupWidthPct = groupRightBase - groupLeftBase;
            const idealGroupLeftPct = 50 - groupWidthPct / 2;
            const minGroupLeftPct = 2 - groupLeftBase;
            const maxGroupLeftPct = 98 - groupRightBase;
            const groupLeftShiftPct = clamp(idealGroupLeftPct, minGroupLeftPct, maxGroupLeftPct);
            const bigLeftPct = groupLeftShiftPct + bigLeftBase;
            const smallLeftPct = groupLeftShiftPct + smallLeftBase;
            const overlapPct = smallWidthPct * overlapRatio;
            const bigTextSafePct = clamp(((bigWidthPct - overlapPct - 1.5) / bigWidthPct) * 100, 30, 58);
            return {
                ...item,
                bigWidthPct,
                bigLeftPct,
                smallWidthPct,
                smallLeftPct,
                bigTextSafePct
            };
        });
        return (
            <div className="title-relation-popup">
                <button
                    type="button"
                    className="title-relation-close"
                    onClick={() => setTitleRelationInfo(null)}
                >
                    ×
                </button>
                <div className="title-relation-diagram-list">
                    {diagrams.length > 0 ? diagrams.map((item) => (
                        <div key={item.key} className="title-relation-diagram-item">
                            <div
                                className="title-relation-venn"
                                style={{
                                    '--big-width': `${item.bigWidthPct}%`,
                                    '--big-left': `${item.bigLeftPct}%`,
                                    '--small-width': `${item.smallWidthPct}%`,
                                    '--small-left': `${item.smallLeftPct}%`,
                                    '--big-safe-width': `${item.bigTextSafePct}%`
                                }}
                            >
                                <div className="title-relation-ellipse-title large-title">{item.bigTitle}</div>
                                <div className="title-relation-ellipse-title small-title">{item.smallTitle}</div>
                                <div className="title-relation-ellipse large left">
                                    <span className="title-relation-ellipse-text">{item.bigSense}</span>
                                </div>
                                <div className="title-relation-ellipse small right">
                                    <span className="title-relation-ellipse-text">{item.smallSense}</span>
                                </div>
                            </div>
                        </div>
                    )) : (
                        <div className="title-relation-empty">暂无可展示的释义关联图</div>
                    )}
                </div>
            </div>
        );
    };

    if (view === 'login') {
        return <Login onLogin={handleLoginSuccess} />;
    }

    // 如果需要显示位置选择弹窗，只显示弹窗，不显示其他内容
    if (showLocationModal) {
        return (
            <LocationSelectionModal
                onConfirm={handleLocationConfirm}
                featuredNodes={featuredNodes}
                username={username}
                onLogout={handleLogout}
            />
        );
    }

    const isKnowledgeDomainActive = showKnowledgeDomain || isTransitioningToDomain;

    return (
        <div
            className={`game-container ${isKnowledgeDomainActive ? 'knowledge-domain-active' : ''} ${isSenseSelectorVisible ? 'sense-selector-open' : ''}`}
            style={{ '--knowledge-header-offset': `${knowledgeHeaderOffset}px` }}
        >
            <div className="game-content">
                {/* 头部 */}
                <div ref={headerRef} className={`header ${isKnowledgeDomainActive ? 'header-knowledge-domain-active' : ''}`}>
                    <div className="header-content">
                        <h1 className="header-title">
                            <Home className="icon" />
                            多节点策略系统
                        </h1>
                        <div className="header-right">
                            <div className="header-buttons">
                                <div className="user-identity-group">
                                    <div
                                        className="user-avatar-container"
                                        onClick={async () => {
                                            await prepareForPrimaryNavigation();
                                            setView('profile');
                                        }}
                                        title="点击进入个人中心"
                                    >
                                        <img
                                            src={avatarMap[userAvatar] || avatarMap['default_male_1']}
                                            alt="头像"
                                            className="user-avatar-small"
                                        />
                                        <span className="user-name">
                                            {username} {profession && `【${profession}】`}
                                        </span>
                                    </div>
                                    <button
                                        onClick={handleLogout}
                                        className="btn btn-logout"
                                    >
                                        退出
                                    </button>
                                </div>
                                <div className="notifications-wrapper" ref={notificationsWrapperRef}>
                                    <button
                                        type="button"
                                        className="btn btn-secondary notification-trigger-btn"
                                        onClick={async () => {
                                            const nextVisible = !showNotificationsPanel;
                                            setShowNotificationsPanel(nextVisible);
                                            setShowRelatedDomainsPanel(false);
                                            if (nextVisible) {
                                                await fetchNotifications(false);
                                                if (isAdmin) {
                                                    await fetchAdminPendingNodeReminders(false);
                                                }
                                            }
                                        }}
                                    >
                                        <Bell size={18} />
                                        通知
                                        {notificationBadgeCount > 0 && (
                                            <span className="notification-badge">
                                                {notificationBadgeCount > 99 ? '99+' : notificationBadgeCount}
                                            </span>
                                        )}
                                    </button>
                                    {renderNotificationsPanel()}
                                </div>
                                <div className="related-domains-wrapper" ref={relatedDomainsWrapperRef}>
                                    <button
                                        type="button"
                                        className="btn btn-secondary related-domains-trigger-btn"
                                        onClick={async () => {
                                            const nextVisible = !showRelatedDomainsPanel;
                                            setShowNotificationsPanel(false);
                                            setShowRelatedDomainsPanel(nextVisible);
                                            if (nextVisible) {
                                                await fetchRelatedDomains(false);
                                            }
                                        }}
                                    >
                                        <Layers size={18} />
                                        我的知识域
                                        {relatedDomainCount > 0 && (
                                            <span className="notification-badge">
                                                {relatedDomainCount > 99 ? '99+' : relatedDomainCount}
                                            </span>
                                        )}
                                    </button>
                                    {renderRelatedDomainsPanel()}
                                </div>
                                <button
                                    onClick={async () => {
                                        await navigateToHomeWithDockCollapse();
                                    }}
                                    className="btn btn-primary"
                                >
                                    <Home size={18} />
                                    首页
                                </button>
                                <button
                                    onClick={async () => {
                                        await prepareForPrimaryNavigation();
                                        setView('alliance');
                                    }}
                                    className="btn btn-secondary"
                                >
                                    <Shield size={18} />
                                    熵盟
                                </button>
                                {!isAdmin && (
                                    <button
                                        onClick={async () => {
                                            await prepareForPrimaryNavigation();
                                            setView('army');
                                        }}
                                        className="btn btn-secondary"
                                    >
                                        <Users size={18} />
                                        军团编制
                                    </button>
                                )}
                                {isAdmin && (
                                    <button
                                        onClick={() => {
                                            openAdminPanel('users');
                                        }}
                                        className="btn btn-warning"
                                    >
                                        管理员面板
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 首页视图 */}
                {view === "home" && (
                    <HomeView
                        webglCanvasRef={webglCanvasRef}
                        searchQuery={homeSearchQuery}
                        onSearchChange={(e) => setHomeSearchQuery(e.target.value)}
                        onSearchFocus={() => setShowSearchResults(true)}
                        onSearchClear={() => {
                            setHomeSearchQuery("");
                            setHomeSearchResults([]);
                            setShowSearchResults(true);
                        }}
                        searchResults={homeSearchResults}
                        showSearchResults={showSearchResults}
                        isSearching={isSearching}
                        onSearchResultClick={(node) => {
                            const targetNodeId = normalizeObjectId(node?.nodeId || node?._id);
                            if (!targetNodeId) return;
                            fetchNodeDetail(targetNodeId, {
                                id: `search-${targetNodeId || node?._id}`,
                                data: node,
                                type: "search"
                            }, {
                                resetTrail: true,
                                relationHint: 'jump',
                                activeSenseId: typeof node?.senseId === 'string' ? node.senseId : ''
                            });
                            setShowSearchResults(false);
                        }}
                        onCreateNode={openCreateNodeModal}
                        isAdmin={isAdmin}
                        currentLocationNodeDetail={currentLocationNodeDetail}
                        travelStatus={travelStatus}
                        onStopTravel={stopTravel}
                        isStoppingTravel={isStoppingTravel}
                        canJumpToLocationView={Boolean(
                            !travelStatus.isTraveling &&
                            currentLocationNodeDetail &&
                            userLocation
                        )}
                        onJumpToLocationView={handleJumpToCurrentLocationView}
                        announcementGroups={announcementGroups}
                        announcementUnreadCount={announcementUnreadCount}
                        isMarkingAnnouncementsRead={isMarkingAnnouncementsRead}
                        onAnnouncementClick={handleHomeAnnouncementClick}
                        onMarkAllAnnouncementsRead={markAnnouncementNotificationsRead}
                        onAnnouncementPanelViewed={markAnnouncementNotificationsRead}
                        showRightDocks={false}
                    />
                )}
                {view === "titleDetail" && currentTitleDetail && (
                    <>
                        <NodeDetail
                            node={currentTitleDetail}
                            navigationPath={navigationPath}
                            onNavigate={(nodeId, navOptions = {}) => fetchTitleDetail(nodeId, null, navOptions)}
                            onNavigateHistory={(item, index) => {
                                if (!item?.nodeId) return;
                                if (item?.mode === 'title') {
                                    fetchTitleDetail(item.nodeId, null, {
                                        historyIndex: index,
                                        relationHint: item.relation
                                    });
                                    return;
                                }
                                fetchNodeDetail(item.nodeId, null, {
                                    historyIndex: index,
                                    relationHint: item.relation,
                                    activeSenseId: item.senseId || ''
                                });
                            }}
                            onHome={async () => {
                                await navigateToHomeWithDockCollapse();
                            }}
                            searchQuery={homeSearchQuery}
                            onSearchChange={(e) => setHomeSearchQuery(e.target.value)}
                            onSearchFocus={() => setShowSearchResults(true)}
                            onSearchClear={() => {
                                setHomeSearchQuery("");
                                setHomeSearchResults([]);
                                setShowSearchResults(true);
                            }}
                            searchResults={homeSearchResults}
                            showSearchResults={showSearchResults}
                            isSearching={isSearching}
                            onSearchResultClick={(node) => {
                                const targetNodeId = normalizeObjectId(node?.nodeId || node?._id);
                                if (!targetNodeId) return;
                                fetchNodeDetail(targetNodeId, {
                                    id: `search-${targetNodeId || node?._id}`,
                                    data: node,
                                    type: "search"
                                }, {
                                    relationHint: 'jump',
                                    activeSenseId: typeof node?.senseId === 'string' ? node.senseId : ''
                                });
                                setShowSearchResults(false);
                            }}
                            onCreateNode={openCreateNodeModal}
                            onNodeInfoClick={() => {}}
                            webglCanvasRef={webglCanvasRef}
                        />
                        {renderTitleRelationInfoPanel()}
                    </>
                )}
                {/* 节点详情视图 */}
                {view === "nodeDetail" && currentNodeDetail && (
                    <>
                        <NodeDetail
                            node={currentNodeDetail}
                            navigationPath={navigationPath}
                            onNavigate={(nodeId, navOptions = {}) => fetchNodeDetail(nodeId, null, navOptions)}
                            onNavigateHistory={(item, index) => {
                                if (!item?.nodeId) return;
                                if (item?.mode === 'title') {
                                    fetchTitleDetail(item.nodeId, null, {
                                        historyIndex: index,
                                        relationHint: item.relation
                                    });
                                    return;
                                }
                                fetchNodeDetail(item.nodeId, null, {
                                    historyIndex: index,
                                    relationHint: item.relation,
                                    activeSenseId: item.senseId || ''
                                });
                            }}
                            onHome={async () => {
                                await navigateToHomeWithDockCollapse();
                            }}
                            searchQuery={homeSearchQuery}
                            onSearchChange={(e) => setHomeSearchQuery(e.target.value)}
                            onSearchFocus={() => setShowSearchResults(true)}
                            onSearchClear={() => {
                                setHomeSearchQuery("");
                                setHomeSearchResults([]);
                                setShowSearchResults(true);
                            }}
                            searchResults={homeSearchResults}
                            showSearchResults={showSearchResults}
                            isSearching={isSearching}
                            onSearchResultClick={(node) => {
                                const targetNodeId = normalizeObjectId(node?.nodeId || node?._id);
                                if (!targetNodeId) return;
                                fetchNodeDetail(targetNodeId, {
                                    id: `search-${targetNodeId || node?._id}`,
                                    data: node,
                                    type: "search"
                                }, {
                                    relationHint: 'jump',
                                    activeSenseId: typeof node?.senseId === 'string' ? node.senseId : ''
                                });
                                setShowSearchResults(false);
                            }}
                            onCreateNode={openCreateNodeModal}
                            onNodeInfoClick={() => {
                                setNodeInfoModalTarget(currentNodeDetail);
                                setShowNodeInfoModal(true);
                            }}
                            webglCanvasRef={webglCanvasRef}
                        />
                    </>
                )}
                {renderSenseSelectorPanel()}
                {renderUnifiedRightDock()}
                {renderDistributionParticipationPanel()}
                {view === "alliance" && (
                    <AlliancePanel 
                        username={username} 
                        token={localStorage.getItem("token")} 
                        isAdmin={isAdmin} 
                    />
                )}
                {view === "admin" && isAdmin && (
                    <AdminPanel
                        key={`admin-${adminEntryTab}`}
                        initialTab={adminEntryTab}
                        onPendingMasterApplyHandled={() => fetchNotifications(true)}
                    />
                )}
                {view === "profile" && (
                    <ProfilePanel
                        username={username}
                        onAvatarChange={(newAvatar) => {
                            setUserAvatar(newAvatar);
                            localStorage.setItem('userAvatar', newAvatar);
                        }}
                    />
                )}
                {view === "army" && !isAdmin && (
                    <ArmyPanel />
                )}

                {view !== "home" &&
                 !(view === "nodeDetail" && currentNodeDetail) &&
                 !(view === "titleDetail" && currentTitleDetail) &&
                 view !== "alliance" &&
                 !(view === "admin" && isAdmin) &&
                 view !== "profile" &&
                 !(view === "army" && !isAdmin) && (
                    <div className="no-pending-nodes">
                        <p>页面状态异常，已为你回退到首页</p>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={async () => {
                                await navigateToHomeWithDockCollapse();
                            }}
                        >
                            返回首页
                        </button>
                    </div>
                )}

                {intelHeistDialog.open && (
                    <div
                        className="modal-overlay"
                        onClick={() => setIntelHeistDialog({
                            open: false,
                            loading: false,
                            node: null,
                            snapshot: null,
                            error: ''
                        })}
                    >
                        <div className="modal-content intel-heist-modal" onClick={(event) => event.stopPropagation()}>
                            <div className="modal-header">
                                <h3>{`情报窃取：${intelHeistDialog.node?.name || currentTitleDetail?.name || currentNodeDetail?.name || '知识域'}`}</h3>
                                <button
                                    type="button"
                                    className="btn-close"
                                    onClick={() => setIntelHeistDialog({
                                        open: false,
                                        loading: false,
                                        node: null,
                                        snapshot: null,
                                        error: ''
                                    })}
                                >
                                    ×
                                </button>
                            </div>
                            <div className="modal-body intel-heist-modal-body">
                                {intelHeistDialog.loading && (
                                    <div className="intel-heist-tip">读取情报状态中...</div>
                                )}
                                {!intelHeistDialog.loading && intelHeistDialog.error && (
                                    <div className="intel-heist-error">{intelHeistDialog.error}</div>
                                )}
                                {!intelHeistDialog.loading && intelHeistDialog.snapshot && (
                                    <div className="intel-heist-snapshot">
                                        <div className="intel-heist-tip">
                                            上次快照时间：{formatDateTimeText(intelHeistDialog.snapshot.capturedAt)}
                                        </div>
                                        <div className="intel-heist-tip">
                                            部署执行时间：{formatDateTimeText(intelHeistDialog.snapshot.deploymentUpdatedAt)}
                                            {`（${getElapsedMinutesText(intelHeistDialog.snapshot.deploymentUpdatedAt) || '未知时刻'}）`}
                                        </div>
                                        <div className="intel-heist-gate-block">
                                            <strong>承口驻防</strong>
                                            {(intelHeistDialog.snapshot?.gateDefense?.cheng || []).length > 0 ? (
                                                (intelHeistDialog.snapshot.gateDefense.cheng || []).map((entry) => (
                                                    <div key={`cheng-${entry.unitTypeId}`} className="intel-heist-gate-row">
                                                        <span>{entry.unitName || entry.unitTypeId}</span>
                                                        <em>{entry.count}</em>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="intel-heist-tip">无驻防</div>
                                            )}
                                        </div>
                                        <div className="intel-heist-gate-block">
                                            <strong>启口驻防</strong>
                                            {(intelHeistDialog.snapshot?.gateDefense?.qi || []).length > 0 ? (
                                                (intelHeistDialog.snapshot.gateDefense.qi || []).map((entry) => (
                                                    <div key={`qi-${entry.unitTypeId}`} className="intel-heist-gate-row">
                                                        <span>{entry.unitName || entry.unitTypeId}</span>
                                                        <em>{entry.count}</em>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="intel-heist-tip">无驻防</div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {!intelHeistDialog.loading && !intelHeistDialog.snapshot && !intelHeistDialog.error && (
                                    <div className="intel-heist-tip">当前没有该知识域的情报快照，可直接执行窃取。</div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setIntelHeistDialog({
                                        open: false,
                                        loading: false,
                                        node: null,
                                        snapshot: null,
                                        error: ''
                                    })}
                                >
                                    关闭
                                </button>
                                {!intelHeistDialog.loading && intelHeistStatus.canSteal && (
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={() => startIntelHeistMiniGame(intelHeistDialog.node || currentTitleDetail || currentNodeDetail)}
                                    >
                                        {intelHeistDialog.snapshot ? '再次窃取' : '开始窃取'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {siegeDialog.open && (
                    <div className="modal-overlay" onClick={resetSiegeDialog}>
                        <div className="modal-content siege-modal" onClick={(event) => event.stopPropagation()}>
                            <div className="modal-header">
                                <h3>
                                    {isSiegeDomainMasterViewer
                                        ? `你的知识域 ${siegeDialog.node?.name || currentTitleDetail?.name || currentNodeDetail?.name || siegeStatus.nodeName || '知识域'} 正在被攻打`
                                        : (isSiegeDomainAdminViewer
                                            ? `你管理的知识域 ${siegeDialog.node?.name || currentTitleDetail?.name || currentNodeDetail?.name || siegeStatus.nodeName || '知识域'} 正在被攻打`
                                            : `攻占知识域：${siegeDialog.node?.name || currentTitleDetail?.name || currentNodeDetail?.name || siegeStatus.nodeName || '知识域'}`)}
                                </h3>
                                <button
                                    type="button"
                                    className="btn-close"
                                    onClick={resetSiegeDialog}
                                >
                                    ×
                                </button>
                            </div>
                            <div className="modal-body siege-modal-body">
                                {siegeDialog.loading ? (
                                    <div className="intel-heist-tip">读取围城状态中...</div>
                                ) : (
                                    <>
                                        {siegeDialog.error && <div className="siege-error">{siegeDialog.error}</div>}
                                        {siegeDialog.message && <div className="siege-message">{siegeDialog.message}</div>}

                                        {isSiegeDomainAdminViewer ? (
                                            <div className="siege-support-panel">
                                                <strong>围城预警</strong>
                                                {siegeActiveGateRows.length > 0 ? (
                                                    siegeActiveGateRows.map((gate) => (
                                                        <div key={`siege-warning-${gate.gateKey}`} className="siege-defender-gate">
                                                            <div className="siege-defender-gate-title">
                                                                <span>{gate.gateLabel || CITY_GATE_LABEL_MAP[gate.gateKey] || gate.gateKey}</span>
                                                                <em>{`${gate.attackers.length}人`}</em>
                                                            </div>
                                                            {gate.attackers.length > 0 ? (
                                                                gate.attackers.map((attacker) => (
                                                                    <div key={`siege-warning-${gate.gateKey}-${attacker.userId || attacker.username}`} className="siege-force-row">
                                                                        <span>{attacker.username || '未知成员'}</span>
                                                                        <em>{attacker.statusLabel || attacker.status || '-'}</em>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <div className="intel-heist-tip">暂无可见攻击用户</div>
                                                            )}
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="intel-heist-tip">当前没有进行中的围城</div>
                                                )}
                                                <div className="intel-heist-tip">域相仅可查看攻击用户与攻打门位，兵力与守备信息已隐藏。</div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="siege-vs-block">
                                                    <div className="siege-force-card attacker">
                                                        <strong>我方兵力</strong>
                                                        <div className="siege-force-total">{siegeStatus.compare?.attacker?.totalCount || 0}</div>
                                                        {(siegeStatus.compare?.attacker?.units || []).length > 0 ? (
                                                            <div className="siege-force-list">
                                                                {(siegeStatus.compare.attacker.units || []).map((entry) => (
                                                                    <div key={`attacker-${entry.unitTypeId}`} className="siege-force-row">
                                                                        <span>{entry.unitName || entry.unitTypeId}</span>
                                                                        <em>{entry.count}</em>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className="intel-heist-tip">无兵力</div>
                                                        )}
                                                        {siegeStatus.hasActiveSiege && siegeStatus.canRequestSupport && (
                                                            <button
                                                                type="button"
                                                                className="btn btn-warning siege-request-support-btn"
                                                                onClick={requestSiegeSupport}
                                                                disabled={siegeDialog.submitting}
                                                            >
                                                                {siegeDialog.submitting ? '呼叫中...' : '呼叫熵盟支援'}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="siege-vs-label">VS</div>
                                                    <div className="siege-force-card defender">
                                                        <strong>守方兵力</strong>
                                                        <div className="siege-force-total">
                                                            {siegeStatus.compare?.defender?.source === 'intel'
                                                                ? (siegeStatus.compare?.defender?.totalCount || 0)
                                                                : '未知'}
                                                        </div>
                                                        <div className="siege-force-source">
                                                            {siegeStatus.compare?.defender?.source === 'intel'
                                                                ? (isSiegeDomainMasterViewer ? '守备视图' : '情报视图')
                                                                : '无情报'}
                                                        </div>
                                                        {siegeStatus.compare?.defender?.source === 'intel' && siegeStatus.intelDeploymentUpdatedAt && (
                                                            <div className="siege-force-source">
                                                                部署时间：{formatDateTimeText(siegeStatus.intelDeploymentUpdatedAt)}
                                                                {`（${getElapsedMinutesText(siegeStatus.intelDeploymentUpdatedAt) || '未知时刻'}）`}
                                                            </div>
                                                        )}
                                                        {siegeStatus.compare?.defender?.source === 'intel' ? (
                                                            <details className="siege-force-gates" open>
                                                                <summary className="siege-force-source">展开驻防信息</summary>
                                                                {(siegeStatus.compare?.defender?.gates || []).length > 0 ? (
                                                                    (siegeStatus.compare?.defender?.gates || []).map((gate) => (
                                                                        <div key={`defender-gate-${gate.gateKey}`} className={`siege-defender-gate ${gate.highlight ? 'highlight' : ''}`}>
                                                                            <div className="siege-defender-gate-title">
                                                                                <span>{gate.gateLabel || CITY_GATE_LABEL_MAP[gate.gateKey] || gate.gateKey}</span>
                                                                                <em>{gate.totalCount || 0}</em>
                                                                            </div>
                                                                            {(gate.entries || []).length > 0 ? (
                                                                                (gate.entries || []).map((entry) => (
                                                                                    <div key={`defender-${gate.gateKey}-${entry.unitTypeId}`} className="siege-force-row">
                                                                                        <span>{entry.unitName || entry.unitTypeId}</span>
                                                                                        <em>{entry.count}</em>
                                                                                    </div>
                                                                                ))
                                                                            ) : (
                                                                                <div className="intel-heist-tip">无驻防</div>
                                                                            )}
                                                                        </div>
                                                                    ))
                                                                ) : (
                                                                    <div className="intel-heist-tip">当前门位无驻防信息</div>
                                                                )}
                                                            </details>
                                                        ) : (
                                                            <div className="intel-heist-tip">暂无情报文件，无法查看守方驻防信息</div>
                                                        )}
                                                    </div>
                                                </div>

                                                {siegeStatus.hasActiveSiege && (siegeStatus.compare?.attacker?.supporters || []).length > 0 && (
                                                    <div className="siege-supporter-list">
                                                        <strong>攻方参战成员</strong>
                                                        {(siegeStatus.compare.attacker.supporters || []).map((item) => (
                                                            <div key={`supporter-${item.userId || item.username}`} className="siege-supporter-row">
                                                                <span>{item.username || '未知成员'}</span>
                                                                <span>{item.statusLabel || item.status || '-'}</span>
                                                                <em>{item.totalCount || 0}</em>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {siegeStatus.hasActiveSiege && (
                                                    <div className="siege-support-panel">
                                                        <strong>同战场支援</strong>
                                                        {siegeStatus.canSupportSameBattlefield ? (
                                                            <>
                                                                <div className="siege-support-meta">
                                                                    <label>目标战场</label>
                                                                    <select
                                                                        value={siegeSupportDraft.gateKey || siegeStatus.supportGate || ''}
                                                                        onChange={(event) => setSiegeSupportDraft((prev) => ({
                                                                            ...prev,
                                                                            gateKey: event.target.value
                                                                        }))}
                                                                    >
                                                                        {(siegeStatus.activeGateKeys || []).map((gateKey) => (
                                                                            <option key={`support-gate-${gateKey}`} value={gateKey}>
                                                                                {CITY_GATE_LABEL_MAP[gateKey] || gateKey}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <div className="siege-support-meta">
                                                                    <label>自动撤出阈值</label>
                                                                    <div className="siege-support-retreat">
                                                                        <input
                                                                            type="range"
                                                                            min="1"
                                                                            max="99"
                                                                            value={Math.max(1, Math.min(99, Number(siegeSupportDraft.autoRetreatPercent) || 40))}
                                                                            onChange={(event) => setSiegeSupportDraft((prev) => ({
                                                                                ...prev,
                                                                                autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(event.target.value) || 40)))
                                                                            }))}
                                                                        />
                                                                        <input
                                                                            type="number"
                                                                            min="1"
                                                                            max="99"
                                                                            value={Math.max(1, Math.min(99, Number(siegeSupportDraft.autoRetreatPercent) || 40))}
                                                                            onChange={(event) => setSiegeSupportDraft((prev) => ({
                                                                                ...prev,
                                                                                autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(event.target.value) || 40)))
                                                                            }))}
                                                                        />
                                                                        <span>%</span>
                                                                    </div>
                                                                </div>
                                                                <div className="siege-support-unit-list">
                                                                    {(siegeStatus.ownRoster?.units || []).map((entry) => (
                                                                        <div key={`support-unit-${entry.unitTypeId}`} className="siege-support-unit-row">
                                                                            <span>{entry.unitName || entry.unitTypeId}</span>
                                                                            <small>可用 {entry.count}</small>
                                                                            <input
                                                                                type="number"
                                                                                min="0"
                                                                                max={entry.count}
                                                                                value={Math.max(0, Math.floor(Number(siegeSupportDraft.units?.[entry.unitTypeId]) || 0))}
                                                                                onChange={(event) => {
                                                                                    const nextQty = Math.max(0, Math.min(entry.count, Math.floor(Number(event.target.value) || 0)));
                                                                                    setSiegeSupportDraft((prev) => ({
                                                                                        ...prev,
                                                                                        units: {
                                                                                            ...(prev.units || {}),
                                                                                            [entry.unitTypeId]: nextQty
                                                                                        }
                                                                                    }));
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-primary"
                                                                    onClick={submitSiegeSupport}
                                                                    disabled={siegeDialog.supportSubmitting}
                                                                >
                                                                    {siegeDialog.supportSubmitting ? '派遣中...' : '派遣支援'}
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <div className="intel-heist-tip">
                                                                {siegeStatus.supportDisabledReason || '当前不可支援该战场'}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={resetSiegeDialog}>
                                    {siegeStatus.hasActiveSiege ? '关闭' : '取消'}
                                </button>
                                {!siegeDialog.loading && !siegeStatus.hasActiveSiege && !isSiegeReadonlyViewer && (
                                    <button
                                        type="button"
                                        className="btn btn-danger"
                                        onClick={startSiege}
                                        disabled={!siegeStatus.canStartSiege || siegeDialog.submitting}
                                    >
                                        {siegeDialog.submitting ? '开始中...' : '开始围城'}
                                    </button>
                                )}
                                {!siegeDialog.loading && siegeStatus.hasActiveSiege && !isSiegeReadonlyViewer && (
                                    <>
                                        <button type="button" className="btn btn-warning" disabled>
                                            进攻
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-danger"
                                            onClick={retreatSiege}
                                            disabled={!siegeStatus.canRetreat || siegeDialog.submitting}
                                            title={siegeStatus.canRetreat ? '' : (siegeStatus.retreatDisabledReason || '当前不可撤退')}
                                        >
                                            {siegeDialog.submitting ? '撤退中...' : '撤退'}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                
                <AssociationModal 
                    isOpen={showAssociationModal}
                    onClose={() => setShowAssociationModal(false)}
                    viewingAssociationNode={viewingAssociationNode}
                />

                <NodeInfoModal
                    isOpen={showNodeInfoModal}
                    onClose={() => {
                        setShowNodeInfoModal(false);
                        setNodeInfoModalTarget(null);
                    }}
                    nodeDetail={nodeInfoModalTarget}
                    onEnterKnowledgeDomain={handleEnterKnowledgeDomain}
                    simpleOnly
                    canApplyDomainMaster={canApplyDomainMaster}
                    isApplyingDomainMaster={isApplyingDomainMaster}
                    onApplyDomainMaster={handleApplyDomainMaster}
                />

                {showCreateNodeModal && (
                    <CreateNodeModal
                        isOpen={showCreateNodeModal}
                        onClose={() => setShowCreateNodeModal(false)}
                        username={username}
                        isAdmin={isAdmin}
                        existingNodes={nodes}
                        sceneManager={sceneManagerRef.current}
                        onSuccess={(newNode) => {
                            if (newNode) {
                                setNodes(prev => [...prev, newNode]);
                            }
                        }}
                    />
                )}

                {/* 知识域场景 */}
                <KnowledgeDomainScene
                    node={knowledgeDomainNode}
                    isVisible={showKnowledgeDomain || isTransitioningToDomain}
                    onExit={handleExitKnowledgeDomain}
                    transitionProgress={domainTransitionProgress}
                    mode={knowledgeDomainMode}
                    onIntelSnapshotCaptured={handleIntelHeistSnapshotCaptured}
                />
            </div>
        </div>
    );
};

export default App;
