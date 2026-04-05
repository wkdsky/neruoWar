import defaultMale1 from '../assets/avatars/default_male_1.svg';
import defaultMale2 from '../assets/avatars/default_male_2.svg';
import defaultMale3 from '../assets/avatars/default_male_3.svg';
import defaultFemale1 from '../assets/avatars/default_female_1.svg';
import defaultFemale2 from '../assets/avatars/default_female_2.svg';
import defaultFemale3 from '../assets/avatars/default_female_3.svg';

export const avatarMap = {
    default_male_1: defaultMale1,
    default_male_2: defaultMale2,
    default_male_3: defaultMale3,
    default_female_1: defaultFemale1,
    default_female_2: defaultFemale2,
    default_female_3: defaultFemale3,
    male1: defaultMale1,
    male2: defaultMale2,
    male3: defaultMale3,
    female1: defaultFemale1,
    female2: defaultFemale2,
    female3: defaultFemale3
};

export const PRESET_AVATAR_OPTIONS = [
    { id: 'default_male_1', src: defaultMale1, label: '方块战士' },
    { id: 'default_male_2', src: defaultMale2, label: '森林守护' },
    { id: 'default_male_3', src: defaultMale3, label: '暗夜魔法' },
    { id: 'default_female_1', src: defaultFemale1, label: '粉色幻梦' },
    { id: 'default_female_2', src: defaultFemale2, label: '阳光少女' },
    { id: 'default_female_3', src: defaultFemale3, label: '海洋之心' }
];

export const resolveAvatarSrc = (avatarKey = '') => {
    const key = typeof avatarKey === 'string' ? avatarKey.trim() : '';
    if (!key) return avatarMap.default_male_1;
    if (avatarMap[key]) return avatarMap[key];
    if (/^https?:\/\//i.test(key) || key.startsWith('/') || key.startsWith('data:image/')) {
        return key;
    }
    return avatarMap.default_male_1;
};

export const PAGE_STATE_STORAGE_KEY = 'app:lastPageState';
export const AUTH_EXPIRED_EVENT = 'app:auth-expired';
export const isDevEnvironment = process.env.NODE_ENV !== 'production';
export const SENSE_EDITOR_PREVIEW_RESIZE_CLASS = 'sense-editor-preview-resizing';
export const LOCALHOST_STORAGE_RESET_KEY = 'app:localhostStorageResetVersion';
export const LOCALHOST_STORAGE_RESET_VERSION = '2026-03-14-localhost-reset-v1';
export const LOCAL_DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
export const SENSE_ARTICLE_SUB_VIEWS = Object.freeze([
    'senseArticle',
    'senseArticleEditor',
    'senseArticleReview',
    'senseArticleHistory',
    'senseArticleDashboard'
]);
export const isSenseArticleSubView = (value = '') => SENSE_ARTICLE_SUB_VIEWS.includes(String(value || ''));
export const createDefaultHeaderUserStats = () => ({
    loading: false,
    level: 0,
    experience: 0,
    knowledgeBalance: 0,
    armyCount: 0
});

export const KNOWN_PERSISTED_VIEWS = new Set([
    'home',
    'nodeDetail',
    'titleDetail',
    'knowledgeDomain',
    'alliance',
    'admin',
    'profile',
    'army',
    'equipment',
    'trainingGround'
]);

export const clearStoredAuthState = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    localStorage.removeItem('userLocation');
    localStorage.removeItem('profession');
    localStorage.removeItem('userAvatar');
    localStorage.removeItem('userRole');
    localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
};

export const clearStoredLocalhostRuntimeState = () => {
    clearStoredAuthState();
    localStorage.removeItem('senseArticleContext');
    localStorage.removeItem('sense-article-editor.preview-pane.v1');
    localStorage.removeItem('sense-article-editor.preview-pane.v2');
};

export const readSavedPageState = () => {
    try {
        const raw = localStorage.getItem(PAGE_STATE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const view = typeof parsed.view === 'string' ? parsed.view : '';
        if (!view || isSenseArticleSubView(view) || !KNOWN_PERSISTED_VIEWS.has(view)) {
            localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
            return null;
        }
        const nodeId = typeof parsed.nodeId === 'string' && /^[0-9a-fA-F]{24}$/.test(parsed.nodeId)
            ? parsed.nodeId
            : '';
        return { view, nodeId };
    } catch (_error) {
        localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
        return null;
    }
};

export const normalizeObjectId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value._id) return normalizeObjectId(value._id);
    if (typeof value.toString === 'function') return value.toString();
    return '';
};

export const decodeUserIdFromToken = (token = '') => {
    if (!token || typeof token !== 'string') return '';
    const parts = token.split('.');
    if (parts.length < 2) return '';
    try {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const normalized = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
        const payload = JSON.parse(atob(normalized));
        return normalizeObjectId(payload?.userId);
    } catch (_error) {
        return '';
    }
};

export const isValidObjectId = (value) => /^[0-9a-fA-F]{24}$/.test(normalizeObjectId(value));
export const createHomeNavigationPath = () => ([
    { type: 'home', label: '首页' }
]);

export const normalizeNavigationRelation = (relation) => (
    relation === 'parent' || relation === 'child' ? relation : 'jump'
);

export const isMapDebugEnabled = () => {
    if (typeof window === 'undefined') return false;
    const value = new URLSearchParams(window.location.search).get('mapDebug');
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

export const readResponsiveViewportMetrics = () => {
    if (typeof window === 'undefined') {
        return {
            layoutWidth: 1440,
            layoutHeight: 900,
            visualWidth: 1440,
            visualHeight: 900,
            effectiveWidth: 1440,
            effectiveHeight: 900,
            isMobile: false,
            hasDesktopLikeLayoutOnMobile: false
        };
    }

    const docEl = document.documentElement;
    const visualViewport = window.visualViewport || null;
    const layoutWidth = Math.max(
        1,
        Math.round(Number(window.innerWidth) || Number(docEl?.clientWidth) || 0)
    );
    const layoutHeight = Math.max(
        1,
        Math.round(Number(window.innerHeight) || Number(docEl?.clientHeight) || 0)
    );
    const visualWidth = Math.max(
        0,
        Math.round(Number(visualViewport?.width) || 0)
    );
    const visualHeight = Math.max(
        0,
        Math.round(Number(visualViewport?.height) || 0)
    );
    const widthCandidates = [
        layoutWidth,
        Math.round(Number(docEl?.clientWidth) || 0),
        visualWidth
    ].filter((value) => Number.isFinite(value) && value > 0);
    const heightCandidates = [
        layoutHeight,
        Math.round(Number(docEl?.clientHeight) || 0),
        visualHeight
    ].filter((value) => Number.isFinite(value) && value > 0);
    const effectiveWidth = widthCandidates.length > 0 ? Math.min(...widthCandidates) : layoutWidth;
    const effectiveHeight = heightCandidates.length > 0 ? Math.min(...heightCandidates) : layoutHeight;
    const coarsePointer = typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse)').matches
        : false;
    const maxTouchPoints = Number(window.navigator?.maxTouchPoints) || 0;
    const screenShortSide = Math.min(
        Math.max(1, Number(window.screen?.width) || 0),
        Math.max(1, Number(window.screen?.height) || 0)
    );
    const isPortableTouchDevice = (coarsePointer || maxTouchPoints > 0) && screenShortSide > 0 && screenShortSide <= 1024;
    const isMobile = effectiveWidth <= 768 || (isPortableTouchDevice && effectiveWidth <= 1024);
    const hasDesktopLikeLayoutOnMobile = (
        (visualWidth > 0 ? visualWidth : screenShortSide) > 0
        && (visualWidth > 0 ? visualWidth : screenShortSide) <= 768
        && layoutWidth >= 900
        && (layoutWidth / Math.max(1, visualWidth > 0 ? visualWidth : screenShortSide)) >= 1.18
    );

    return {
        layoutWidth,
        layoutHeight,
        visualWidth,
        visualHeight,
        effectiveWidth,
        effectiveHeight,
        isPortableTouchDevice,
        isMobile,
        hasDesktopLikeLayoutOnMobile
    };
};

export const readResponsiveViewportWidth = () => readResponsiveViewportMetrics().effectiveWidth;
export const readResponsiveViewportHeight = () => readResponsiveViewportMetrics().effectiveHeight;
export const readIsMobileViewport = (breakpoint = 768) => (
    readResponsiveViewportWidth() <= Math.max(0, Number(breakpoint) || 768)
);

export const buildNavigationTrailItem = (node, relation = 'jump', options = {}) => {
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

export const getNavigationRelationFromSceneNode = (sceneNode) => {
    if (sceneNode?.type === 'parent') return 'parent';
    if (sceneNode?.type === 'child') return 'child';
    return 'jump';
};

export const getNodePrimarySense = (node) => {
    const senses = Array.isArray(node?.synonymSenses) ? node.synonymSenses : [];
    if (typeof node?.activeSenseId === 'string' && node.activeSenseId.trim()) {
        const matched = senses.find((item) => item?.senseId === node.activeSenseId.trim());
        if (matched) return matched;
    }
    return senses[0] || null;
};

export const getNodeSenseArticleTarget = (node, requestedSenseId = '') => {
    const nodeId = normalizeObjectId(node?._id || node?.nodeId);
    if (!nodeId) return null;
    const normalizedSenseId = typeof requestedSenseId === 'string' ? requestedSenseId.trim() : '';
    if (normalizedSenseId) {
        return {
            nodeId,
            senseId: normalizedSenseId
        };
    }
    const primarySense = getNodePrimarySense(node);
    const fallbackSenseId = typeof node?.activeSenseId === 'string' && node.activeSenseId.trim()
        ? node.activeSenseId.trim()
        : (typeof primarySense?.senseId === 'string' ? primarySense.senseId.trim() : '');
    if (!fallbackSenseId) return null;
    return {
        nodeId,
        senseId: fallbackSenseId
    };
};

export const isSenseArticleNotification = (notification) => (
    typeof notification?.type === 'string' && notification.type.startsWith('sense_article_')
);

export const getNodeDisplayName = (node) => {
    if (typeof node?.displayName === 'string' && node.displayName.trim()) return node.displayName.trim();
    const name = typeof node?.name === 'string' ? node.name.trim() : '';
    const primarySense = getNodePrimarySense(node);
    const senseTitle = typeof node?.activeSenseTitle === 'string' && node.activeSenseTitle.trim()
        ? node.activeSenseTitle.trim()
        : (typeof primarySense?.title === 'string' ? primarySense.title.trim() : '');
    return senseTitle ? `${name}-${senseTitle}` : (name || '未命名知识域');
};

export const hexToRgba = (hex, alpha = 1) => {
    const safeHex = typeof hex === 'string' ? hex.trim() : '';
    if (!/^#[0-9a-fA-F]{6}$/.test(safeHex)) return `rgba(30, 41, 59, ${alpha})`;
    const r = Number.parseInt(safeHex.slice(1, 3), 16);
    const g = Number.parseInt(safeHex.slice(3, 5), 16);
    const b = Number.parseInt(safeHex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const ANNOUNCEMENT_NOTIFICATION_TYPES = ['domain_distribution_announcement', 'alliance_announcement'];
export const isAnnouncementNotification = (notification) => (
    ANNOUNCEMENT_NOTIFICATION_TYPES.includes(notification?.type)
);
export const RIGHT_DOCK_COLLAPSE_MS = 220;
export const isKnowledgeDetailView = (value) => value === 'nodeDetail' || value === 'titleDetail';
export const isTitleBattleView = (value) => value === 'titleDetail';

export const createEmptyNodeDistributionStatus = () => ({
    nodeId: '',
    active: false,
    phase: 'none',
    requiresManualEntry: false,
    joined: false,
    canJoin: false,
    canExit: false,
    joinTip: ''
});

export const createDefaultDistributionPanelState = () => ({
    loading: false,
    joining: false,
    exiting: false,
    error: '',
    feedback: '',
    data: null
});

export const createEmptyIntelHeistStatus = () => ({
    loading: false,
    nodeId: '',
    canSteal: false,
    reason: '',
    latestSnapshot: null
});

export const CITY_GATE_LABEL_MAP = {
    cheng: '承门',
    qi: '启门'
};

export const normalizeSiegeUnitEntries = (entries = []) => (
    (Array.isArray(entries) ? entries : [])
        .map((entry) => ({
            unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
            unitName: typeof entry?.unitName === 'string' ? entry.unitName : '',
            count: Math.max(0, Math.floor(Number(entry?.count) || 0))
        }))
        .filter((entry) => entry.unitTypeId && entry.count > 0)
);

export const normalizeSiegeGateState = (gateState = {}, gateKey = '') => {
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

export const createEmptySiegeStatus = () => ({
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

export const mergeSiegeStatusPreservingIntelView = (previousStatus = {}, nextStatus = {}, targetNodeId = '') => {
    const prevNodeId = normalizeObjectId(previousStatus?.nodeId);
    const nextNodeId = normalizeObjectId(nextStatus?.nodeId || targetNodeId);
    if (!prevNodeId || !nextNodeId || prevNodeId !== nextNodeId) return nextStatus;
    const previousDefender = previousStatus?.compare?.defender;
    if (previousDefender?.source !== 'intel') return nextStatus;
    return {
        ...nextStatus,
        compare: {
            ...(nextStatus?.compare || {}),
            defender: previousDefender
        },
        intelUsed: previousStatus?.intelUsed ?? nextStatus?.intelUsed ?? false,
        intelCapturedAt: previousStatus?.intelCapturedAt || nextStatus?.intelCapturedAt || null,
        intelDeploymentUpdatedAt: previousStatus?.intelDeploymentUpdatedAt || nextStatus?.intelDeploymentUpdatedAt || null
    };
};

export const normalizeSiegeStatus = (raw = {}, fallbackNodeId = '') => {
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

export const getIntelSnapshotAgeMinutesText = (snapshot) => {
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

export const formatDateTimeText = (value) => {
    const ms = new Date(value || 0).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return '未知';
    return new Date(ms).toLocaleString('zh-CN', { hour12: false });
};

export const getElapsedMinutesText = (value) => {
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

export const normalizeIntelSnapshotGateEntries = (entries = []) => (
    (Array.isArray(entries) ? entries : [])
        .map((entry) => ({
            unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
            unitName: typeof entry?.unitName === 'string' ? entry.unitName : '',
            count: Math.max(0, Math.floor(Number(entry?.count) || 0))
        }))
        .filter((entry) => entry.unitTypeId && entry.count > 0)
);

export const normalizeIntelSnapshot = (snapshot = {}) => {
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

export const formatCountdownText = (seconds) => {
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
