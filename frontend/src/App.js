import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import './App.css';
import Login from './components/auth/Login';
import AdminPanel from './components/admin/AdminPanel';
import AlliancePanel from './components/game/AlliancePanel';
import ProfilePanel from './components/game/ProfilePanel';
import ArmyPanel from './components/game/ArmyPanel';
import TrainingGroundPanel from './components/game/TrainingGroundPanel';
import KnowledgeViewRouter from './components/game/KnowledgeViewRouter';
import KnowledgeDomainScene from './components/game/KnowledgeDomainScene';
import TransitionGhostLayer from './components/game/TransitionGhostLayer';
import SceneManager from './SceneManager';
import LocationSelectionModal from './LocationSelectionModal';
import SenseArticleViewRouter from './components/senseArticle/SenseArticleViewRouter';
import useSenseArticleNavigation from './components/senseArticle/hooks/useSenseArticleNavigation';
import AppOverlays from './components/layout/AppOverlays';
import useDomainConflictState from './hooks/useDomainConflictState';
import useDistributionPanelState from './hooks/useDistributionPanelState';
import {
    AppShellChrome,
    SenseSelectorPanel
} from './components/layout/AppShellPanels';
import SystemConfirmDialog from './components/common/SystemConfirmDialog';
import {
    buildSenseArticleSubViewContext,
    createSenseArticleContext,
    areSenseArticleContextsEqual
} from './components/senseArticle/senseArticleNavigation';
import { senseArticleApi } from './utils/senseArticleApi';
import { API_BASE, SOCKET_ENDPOINT } from './runtimeConfig';
import { isSenseEditorDebugEnabled } from './components/senseArticle/editor/editorDebug';
import {
    CITY_GATE_LABEL_MAP,
    LOCAL_DEVELOPMENT_HOSTS,
    LOCALHOST_STORAGE_RESET_KEY,
    LOCALHOST_STORAGE_RESET_VERSION,
    PAGE_STATE_STORAGE_KEY,
    SENSE_EDITOR_PREVIEW_RESIZE_CLASS,
    buildNavigationTrailItem,
    clearStoredAuthState,
    clearStoredLocalhostRuntimeState,
    createDefaultHeaderUserStats,
    createEmptyIntelHeistStatus,
    createEmptyNodeDistributionStatus,
    createEmptySiegeStatus,
    createHomeNavigationPath,
    decodeUserIdFromToken,
    formatDateTimeText,
    getElapsedMinutesText,
    getIntelSnapshotAgeMinutesText,
    getNavigationRelationFromSceneNode,
    isDevEnvironment,
    isKnowledgeDetailView,
    isMapDebugEnabled,
    isSenseArticleSubView,
    isTitleBattleView,
    isValidObjectId,
    normalizeNavigationRelation,
    normalizeObjectId,
    normalizeSiegeUnitEntries,
    readSavedPageState
} from './app/appShared';
import useNotificationCenter from './hooks/useNotificationCenter';
import useAppShellState from './hooks/useAppShellState';
import {
    DEFAULT_STAR_MAP_LIMIT,
    KNOWLEDGE_MAIN_VIEW_MODE,
    STAR_MAP_LAYER,
    areStarMapCentersEqual,
    getSenseNodeKey,
    toSenseVertexKey
} from './starMap/starMapHelpers';

const PRIMARY_NAVIGATION_TIMEOUT_MS = 10000;
const PRIMARY_NAVIGATION_RETRY_DELAYS_MS = [250, 700];
const clampRevealProgress = (value) => Math.max(0.04, Math.min(1, Number(value) || 0));
const createIdleHomeTransition = () => ({
    runId: 0,
    sourceRect: null,
    sourceCenter: null,
    sourceSize: null,
    sourceTitle: '',
    sourceSenseTitle: '',
    sourceSummary: '',
    sourceVariant: 'root',
    sourceNodeId: '',
    targetMode: '',
    targetNodeId: '',
    targetSenseId: '',
    targetCenter: null,
    targetSize: 0,
    targetLayoutNodeId: '',
    status: 'idle',
    triggeredAt: 0
});

const App = () => {
    const [socket, setSocket] = useState(null);
    const [authenticated, setAuthenticated] = useState(false);
    const [userId, setUserId] = useState('');
    const [username, setUsername] = useState('');
    const [profession, setProfession] = useState('');
    const [userAvatar, setUserAvatar] = useState('default_male_1');
    const [headerUserStats, setHeaderUserStats] = useState(createDefaultHeaderUserStats);
    const [nodes, setNodes] = useState([]);
    const [, setTechnologies] = useState([]);
    const [view, setView] = useState('login');
    const [systemConfirmState, setSystemConfirmState] = useState({
        open: false,
        title: '',
        message: '',
        confirmText: '确认',
        confirmTone: 'danger',
        onConfirm: null
    });
    const socketRef = useRef(null);
    const isRestoringPageRef = useRef(false);
    const hasRestoredPageRef = useRef(false);
    const travelStatusRef = useRef({ isTraveling: false, isStopping: false });
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminEntryTab, setAdminEntryTab] = useState('users');


    // 修改检查登录状态的useEffect
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        const token = localStorage.getItem('token');
        const storedUserId = normalizeObjectId(localStorage.getItem('userId'));
        const storedUsername = localStorage.getItem('username');
        const storedLocation = localStorage.getItem('userLocation');
        const storedProfession = localStorage.getItem('profession');
        const storedAvatar = localStorage.getItem('userAvatar');
        const storedUserRole = localStorage.getItem('userRole');

        if (token && storedUsername) {
            const resolvedUserId = storedUserId || decodeUserIdFromToken(token);
            setAuthenticated(true);
            setUserId(resolvedUserId);
            setUsername(storedUsername);
            setProfession(storedProfession || '');
            setUserLocation(storedLocation || '');
            setUserAvatar(storedAvatar || 'default_male_1');
            setIsAdmin(storedUserRole === 'admin');
            if (resolvedUserId) {
                localStorage.setItem('userId', resolvedUserId);
            }

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

            // 仅在已知管理员会话下校验管理员状态，避免普通用户刷新时触发 403 探测请求
            if (storedUserRole === 'admin') {
                checkAdminStatus();
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // 只在组件挂载时执行一次

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
            } catch (_error) {
                // 启动校验失败时不阻塞现有流程，避免临时网络波动把用户踢回登录页
            }
        };

        validateStoredSession();
        return () => {
            cancelled = true;
        };
    }, []);

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

    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.body.classList.remove(SENSE_EDITOR_PREVIEW_RESIZE_CLASS);
    }, []);
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [, setSelectedLocationNode] = useState(null);
    const [currentLocationNodeDetail, setCurrentLocationNodeDetail] = useState(null);
    const [isRefreshingLocationDetail, setIsRefreshingLocationDetail] = useState(false);
    const [travelStatus, setTravelStatus] = useState({ isTraveling: false });
    const [isStoppingTravel, setIsStoppingTravel] = useState(false);

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
    const [knowledgeMainViewMode, setKnowledgeMainViewMode] = useState(KNOWLEDGE_MAIN_VIEW_MODE.MAIN);
    const [titleStarMapData, setTitleStarMapData] = useState(null);
    const [nodeStarMapData, setNodeStarMapData] = useState(null);
    const [currentStarMapCenter, setCurrentStarMapCenter] = useState(null);
    const [currentStarMapLimit, setCurrentStarMapLimit] = useState(DEFAULT_STAR_MAP_LIMIT);
    const [currentStarMapLayer, setCurrentStarMapLayer] = useState('');
    const [isStarMapLoading, setIsStarMapLoading] = useState(false);
    const [nodeInfoModalTarget, setNodeInfoModalTarget] = useState(null);
    const [titleRelationInfo, setTitleRelationInfo] = useState(null);
    const [senseSelectorSourceNode, setSenseSelectorSourceNode] = useState(null);
    const [senseSelectorSourceSceneNodeId, setSenseSelectorSourceSceneNodeId] = useState('');
    const [senseSelectorAnchor, setSenseSelectorAnchor] = useState({ x: 0, y: 0, visible: false });
    const [isSenseSelectorVisible, setIsSenseSelectorVisible] = useState(false);
    const [senseSelectorOverviewNode, setSenseSelectorOverviewNode] = useState(null);
    const [senseSelectorOverviewLoading, setSenseSelectorOverviewLoading] = useState(false);
    const [senseSelectorOverviewError, setSenseSelectorOverviewError] = useState('');
    const [senseArticleEntryStatusMap, setSenseArticleEntryStatusMap] = useState({});
    const [showNodeInfoModal, setShowNodeInfoModal] = useState(false);
    const [senseArticleContext, setSenseArticleContext] = useState(null);
    const buildSenseArticleContext = useCallback((patch = {}, base = null) => createSenseArticleContext(patch, base), []);
    const patchSenseArticleContext = useCallback((patch = {}) => {
        setSenseArticleContext((prev) => {
            const next = buildSenseArticleContext(patch, prev);
            return areSenseArticleContextsEqual(prev, next) ? prev : next;
        });
    }, [buildSenseArticleContext]);
    const navigateSenseArticleSubView = useCallback((nextView, patch = {}, options = {}) => {
        setSenseArticleContext((prev) => buildSenseArticleSubViewContext(prev, view, patch, options));
        setView(nextView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);
    const [isApplyingDomainMaster, setIsApplyingDomainMaster] = useState(false);
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
    const [homeDetailTransition, setHomeDetailTransition] = useState(createIdleHomeTransition);
    const homeDetailTransitionRef = useRef(createIdleHomeTransition());
    const homeDetailTransitionRunIdRef = useRef(0);

    // 搜索栏相关引用
    const searchBarRef = useRef(null);
    const headerRef = useRef(null);
    const notificationsWrapperRef = useRef(null);
    const relatedDomainsWrapperRef = useRef(null);
    const militaryMenuWrapperRef = useRef(null);
    const senseSelectorPanelRef = useRef(null);
    const senseSelectorAnchorRef = useRef({ x: 0, y: 0, visible: false });
    const knowledgeDomainReturnContextRef = useRef(null);
    const senseArticleEntryStatusMapRef = useRef({});
    const primaryNavigationRequestRef = useRef({
        seq: 0,
        controller: null,
        requestKey: '',
        source: ''
    });
    const starMapRequestRef = useRef({
        seq: 0,
        controller: null,
        requestKey: ''
    });
    const [knowledgeHeaderOffset, setKnowledgeHeaderOffset] = useState(92);
    const [isSenseArticleHeaderPinned, setIsSenseArticleHeaderPinned] = useState(false);

    useEffect(() => {
        homeDetailTransitionRef.current = homeDetailTransition;
    }, [homeDetailTransition]);

    const delay = useCallback((ms) => new Promise((resolve) => {
        window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
    }), []);

    const createPrimaryNavigationTimeoutError = useCallback((timeoutMs) => {
        const error = new Error(`请求超时（>${Math.round(timeoutMs / 1000)} 秒）`);
        error.name = 'TimeoutError';
        error.status = 408;
        return error;
    }, []);

    const mergeAbortSignals = useCallback((primarySignal, secondarySignal) => {
        if (!secondarySignal) return primarySignal;
        if (!primarySignal) return secondarySignal;
        if (primarySignal.aborted) return primarySignal;
        if (secondarySignal.aborted) return secondarySignal;

        const controller = new AbortController();
        const forwardAbort = (signal) => () => {
            if (!controller.signal.aborted) {
                controller.abort(signal.reason);
            }
        };
        primarySignal.addEventListener('abort', forwardAbort(primarySignal), { once: true });
        secondarySignal.addEventListener('abort', forwardAbort(secondarySignal), { once: true });
        return controller.signal;
    }, []);

    const clearHomeDetailTransition = useCallback((options = {}) => {
        const immediate = options?.immediate === true;
        const current = homeDetailTransitionRef.current;
        if (sceneManagerRef.current?.renderer && current?.targetLayoutNodeId) {
            sceneManagerRef.current.renderer.setNodeRevealProgress('', 1);
        }
        if (immediate) {
            setHomeDetailTransition(createIdleHomeTransition());
            return;
        }
        setHomeDetailTransition((prev) => {
            if (!prev || prev.status === 'idle') return createIdleHomeTransition();
            return {
                ...prev,
                status: 'done'
            };
        });
        window.setTimeout(() => {
            if (homeDetailTransitionRef.current?.status === 'done') {
                setHomeDetailTransition(createIdleHomeTransition());
            }
        }, 150);
    }, []);

    const resolveHomeNodeVariant = useCallback((nodeId) => {
        const normalized = normalizeObjectId(nodeId);
        if (!normalized) return 'root';
        if (featuredNodes.some((item) => normalizeObjectId(item?._id) === normalized)) return 'featured';
        return 'root';
    }, [featuredNodes]);

    const armHomeDetailTransition = useCallback((node, anchorElement = null) => {
        const rect = anchorElement?.getBoundingClientRect?.();
        const nodeId = normalizeObjectId(node?._id);
        if (!rect || !nodeId) {
            clearHomeDetailTransition({ immediate: true });
            return;
        }
        homeDetailTransitionRunIdRef.current += 1;
        setHomeDetailTransition({
            runId: homeDetailTransitionRunIdRef.current,
            sourceRect: {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height
            },
            sourceCenter: {
                x: rect.left + rect.width * 0.5,
                y: rect.top + rect.height * 0.5
            },
            sourceSize: {
                width: rect.width,
                height: rect.height
            },
            sourceTitle: typeof node?.name === 'string' ? node.name.trim() : '',
            sourceSenseTitle: typeof node?.activeSenseTitle === 'string' ? node.activeSenseTitle.trim() : '',
            sourceSummary: typeof node?.description === 'string' ? node.description.trim() : '',
            sourceVariant: resolveHomeNodeVariant(nodeId),
            sourceNodeId: nodeId,
            targetMode: '',
            targetNodeId: '',
            targetSenseId: '',
            targetCenter: null,
            targetSize: 0,
            targetLayoutNodeId: '',
            status: 'armed',
            triggeredAt: Date.now()
        });
    }, [clearHomeDetailTransition, resolveHomeNodeVariant]);

    const prepareHomeDetailTransitionTarget = useCallback(({ mode = '', nodeId = '', senseId = '' } = {}) => {
        const normalizedNodeId = normalizeObjectId(nodeId);
        if (!normalizedNodeId) return;
        setHomeDetailTransition((prev) => {
            if (!prev || prev.status === 'idle' || !prev.sourceRect) return prev;
            return {
                ...prev,
                targetMode: mode === 'titleDetail' ? 'titleDetail' : 'nodeDetail',
                targetNodeId: normalizedNodeId,
                targetSenseId: typeof senseId === 'string' ? senseId.trim() : '',
                targetCenter: null,
                targetSize: 0,
                targetLayoutNodeId: '',
                status: 'navigating'
            };
        });
    }, []);

    const updateHomeTransitionReveal = useCallback((runId, progress = 1) => {
        const current = homeDetailTransitionRef.current;
        if (!current || current.runId !== runId) return;
        if (!current.targetLayoutNodeId) return;
        if (!sceneManagerRef.current?.renderer) return;
        sceneManagerRef.current.renderer.setNodeRevealProgress(
            current.targetLayoutNodeId,
            clampRevealProgress(progress)
        );
    }, []);

    const isAbortError = useCallback((error) => (
        error?.name === 'AbortError'
        || error?.code === 'ERR_CANCELED'
    ), []);

    const isRetriablePrimaryNavigationError = useCallback((error) => {
        if (!error) return false;
        if (isAbortError(error)) return false;
        if (error?.name === 'TimeoutError') return true;
        const status = Number(error?.status || 0);
        if ([408, 425, 429, 502, 503, 504].includes(status)) {
            return true;
        }
        const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
        return (
            message.includes('failed to fetch')
            || message.includes('networkerror')
            || message.includes('load failed')
            || message.includes('network request failed')
        );
    }, [isAbortError]);

    const beginPrimaryNavigationRequest = useCallback((requestKey = '', source = '') => {
        const previous = primaryNavigationRequestRef.current;
        if (previous?.controller && !previous.controller.signal.aborted) {
            previous.controller.abort(new DOMException('Superseded by a newer primary navigation request', 'AbortError'));
        }

        const controller = new AbortController();
        const request = {
            seq: (previous?.seq || 0) + 1,
            controller,
            requestKey,
            source
        };
        primaryNavigationRequestRef.current = request;
        return request;
    }, []);

    const isPrimaryNavigationRequestCurrent = useCallback((request) => {
        if (!request) return false;
        const current = primaryNavigationRequestRef.current;
        return current?.seq === request.seq && current?.controller === request.controller;
    }, []);

    const finishPrimaryNavigationRequest = useCallback((request) => {
        if (!isPrimaryNavigationRequestCurrent(request)) return;
        primaryNavigationRequestRef.current = {
            ...primaryNavigationRequestRef.current,
            controller: null
        };
    }, [isPrimaryNavigationRequestCurrent]);

    const fetchPrimaryNavigationResponse = useCallback(async (url, request, options = {}) => {
        const timeoutMs = Math.max(1000, Number(options?.timeoutMs) || PRIMARY_NAVIGATION_TIMEOUT_MS);
        const retryDelays = Array.isArray(options?.retryDelaysMs) && options.retryDelaysMs.length > 0
            ? options.retryDelaysMs
            : PRIMARY_NAVIGATION_RETRY_DELAYS_MS;

        for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
            if (!isPrimaryNavigationRequestCurrent(request)) {
                return null;
            }

            const timeoutController = new AbortController();
            const timeoutId = window.setTimeout(() => {
                timeoutController.abort(createPrimaryNavigationTimeoutError(timeoutMs));
            }, timeoutMs);

            try {
                const signal = mergeAbortSignals(request?.controller?.signal, timeoutController.signal);
                const response = await fetch(url, { signal });

                if (!isPrimaryNavigationRequestCurrent(request)) {
                    return null;
                }

                if ([408, 425, 429, 502, 503, 504].includes(Number(response.status || 0)) && attempt < retryDelays.length) {
                    console.warn('[primary-navigation] retrying response', {
                        url,
                        status: response.status,
                        attempt: attempt + 1,
                        requestKey: request?.requestKey || '',
                        source: request?.source || ''
                    });
                    await delay(retryDelays[attempt]);
                    continue;
                }

                return response;
            } catch (error) {
                if (!isPrimaryNavigationRequestCurrent(request)) {
                    return null;
                }

                let resolvedError = error;
                if (error?.name === 'AbortError' && timeoutController.signal.aborted && timeoutController.signal.reason instanceof Error) {
                    resolvedError = timeoutController.signal.reason;
                }

                if (!isRetriablePrimaryNavigationError(resolvedError) || attempt >= retryDelays.length) {
                    throw resolvedError;
                }

                console.warn('[primary-navigation] retrying after transient error', {
                    url,
                    error: resolvedError?.message || 'request failed',
                    attempt: attempt + 1,
                    requestKey: request?.requestKey || '',
                    source: request?.source || ''
                });
                await delay(retryDelays[attempt]);
            } finally {
                window.clearTimeout(timeoutId);
            }
        }

        return null;
    }, [
        createPrimaryNavigationTimeoutError,
        delay,
        isPrimaryNavigationRequestCurrent,
        isRetriablePrimaryNavigationError,
        mergeAbortSignals
    ]);

    const beginStarMapRequest = useCallback((requestKey = '') => {
        const previous = starMapRequestRef.current;
        if (previous?.controller && !previous.controller.signal.aborted) {
            previous.controller.abort(new DOMException('Superseded by a newer star map request', 'AbortError'));
        }

        const controller = new AbortController();
        const request = {
            seq: (previous?.seq || 0) + 1,
            controller,
            requestKey
        };
        starMapRequestRef.current = request;
        return request;
    }, []);

    const isStarMapRequestCurrent = useCallback((request) => {
        if (!request) return false;
        const current = starMapRequestRef.current;
        return current?.seq === request.seq && current?.controller === request.controller;
    }, []);

    const finishStarMapRequest = useCallback((request) => {
        if (!isStarMapRequestCurrent(request)) return;
        starMapRequestRef.current = {
            ...starMapRequestRef.current,
            controller: null
        };
    }, [isStarMapRequestCurrent]);

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

    useEffect(() => {
        if (!isSenseArticleSubView(view)) {
            setIsSenseArticleHeaderPinned(false);
            return undefined;
        }

        let frameId = null;
        const syncPinnedState = () => {
            const nextPinned = (window.scrollY || window.pageYOffset || 0) > 24;
            setIsSenseArticleHeaderPinned((prev) => (prev === nextPinned ? prev : nextPinned));
        };
        const scheduleSync = () => {
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
            }
            frameId = requestAnimationFrame(() => {
                frameId = null;
                syncPinnedState();
            });
        };

        syncPinnedState();
        window.addEventListener('scroll', scheduleSync, { passive: true });
        window.addEventListener('resize', scheduleSync);

        return () => {
            window.removeEventListener('scroll', scheduleSync);
            window.removeEventListener('resize', scheduleSync);
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
            }
        };
    }, [view]);

    const applyTravelStatus = useCallback((nextTravel) => {
      const normalizedTravel = (nextTravel && typeof nextTravel === 'object')
        ? nextTravel
        : { isTraveling: false };
      setTravelStatus(normalizedTravel);
      travelStatusRef.current = {
        isTraveling: !!normalizedTravel.isTraveling,
        isStopping: !!normalizedTravel.isStopping
      };
    }, []);

    useEffect(() => {
        if (!isSenseEditorDebugEnabled()) return;
        console.debug('[sense-editor:app] View/context changed', {
            view,
            nodeId: senseArticleContext?.nodeId || '',
            senseId: senseArticleContext?.senseId || '',
            revisionId: senseArticleContext?.revisionId || '',
            selectedRevisionId: senseArticleContext?.selectedRevisionId || ''
        });
    }, [senseArticleContext, view]);

    useEffect(() => {
        senseArticleEntryStatusMapRef.current = senseArticleEntryStatusMap;
    }, [senseArticleEntryStatusMap]);

    // 初始化WebGL场景
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            setIsWebGLReady(false);
            sceneManagerRef.current.destroy();
            sceneManagerRef.current = null;
        }

        try {
            const parent = canvas.parentElement;
            if (!parent) return;
            const mapDebugEnabled = isMapDebugEnabled();

            const syncCanvasSize = (triggerResize = false) => {
                const rect = parent.getBoundingClientRect();
                const width = Math.max(1, Math.floor(rect.width || parent.clientWidth || canvas.clientWidth || 800));
                const height = Math.max(1, Math.floor(rect.height || parent.clientHeight || canvas.clientHeight || 600));
                canvas.width = width;
                canvas.height = height;
                if (triggerResize && sceneManagerRef.current) {
                    sceneManagerRef.current.resize(width, height);
                }
                if (mapDebugEnabled) {
                    console.info('[MapDebug] canvas-size', {
                        width,
                        height,
                        clientWidth: canvas.clientWidth,
                        clientHeight: canvas.clientHeight,
                        view
                    });
                }
            };

            // 设置 canvas 初始大小
            syncCanvasSize(false);

            // 创建场景管理器
            const sceneManager = new SceneManager(canvas);

            // 设置点击回调
            sceneManager.onNodeClick = (node) => {
                if (!node.data || !node.data._id) return;
                if (view === 'home') {
                    setTitleRelationInfo(null);
                    setSenseSelectorSourceNode(node.data);
                    setSenseSelectorSourceSceneNodeId(String(node?.id || ''));
                    updateSenseSelectorAnchorBySceneNode(node);
                    setIsSenseSelectorVisible(true);
                    return;
                }

                if (view === 'titleDetail') {
                    setTitleRelationInfo(null);
                    if (knowledgeMainViewMode === KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP) {
                        recenterStarMapFromNode(node);
                        return;
                    }
                    if (node.type === 'center') {
                        setSenseSelectorSourceNode(currentTitleDetail || node.data);
                        setSenseSelectorSourceSceneNodeId('');
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
                    if (knowledgeMainViewMode === KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP) {
                        recenterStarMapFromNode(node);
                        return;
                    }
                    if (node.type === 'center') {
                        setSenseSelectorSourceNode(currentNodeDetail || node.data);
                        setSenseSelectorSourceSceneNodeId('');
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
                if (knowledgeMainViewMode === KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP) return;
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

            // 监听大小变化（窗口 + 容器）
            const handleResize = () => syncCanvasSize(true);

            window.addEventListener('resize', handleResize);
            let parentResizeObserver = null;
            if (typeof ResizeObserver === 'function') {
                parentResizeObserver = new ResizeObserver(() => handleResize());
                parentResizeObserver.observe(parent);
            }

            return () => {
                window.removeEventListener('resize', handleResize);
                if (parentResizeObserver) {
                    parentResizeObserver.disconnect();
                }
            };
        } catch (error) {
            console.error('WebGL初始化失败:', error);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, currentNodeDetail, currentTitleDetail, isAdmin, userLocation, travelStatus.isTraveling]);

    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        sceneManagerRef.current.setUserState(userLocation, travelStatus);
    }, [isWebGLReady, userLocation, travelStatus]);

    useEffect(() => {
        // 只在没有socket时初始化
        if (!socketRef.current) {
            initializeSocket();
        }
    
        const newSocket = io(SOCKET_ENDPOINT, {
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
      // 先打开降临弹窗，避免出现首页闪一下再弹窗
      setShowLocationModal(true);
    } else {
      setShowLocationModal(false);
    }
    // 重新初始化socket连接（连接事件中会处理认证）
    initializeSocket(data.token);

    if (data.role === 'admin') {
      await checkAdminStatus();
    }
    if (data.role !== 'admin') {
      fetchTravelStatus(true);
    } else {
      applyTravelStatus({ isTraveling: false });
    }

    // 检查location字段，如果为空且不是管理员，显示位置选择弹窗
    if (!data.location || data.location === '') {
      if (data.role === 'admin') {
        // 管理员自动设置location为"任意"
        await updateUserLocation('任意');
        setUserLocation('任意');
        localStorage.setItem('userLocation', '任意');
        resetAppNavigationStateToHome();
      }
    } else {
      resetAppNavigationStateToHome();
    }
  };

  // 更新用户location
  const updateUserLocation = async (location) => {
    const token = localStorage.getItem('token');
    try {
      console.log('正在更新location:', location);
      const response = await fetch(`${API_BASE}/location`, {
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
      const selectedNodeId = normalizeObjectId(selectedNode._id || selectedNode.nodeId);
      setUserLocation(updatedLocation);
      setSelectedLocationNode(selectedNode);
      setCurrentLocationNodeDetail(selectedNode);
      localStorage.setItem('userLocation', updatedLocation);

      // 关闭modal并优先进入当前降临知识域的主视角
      setShowLocationModal(false);
      const resolvedLocationDetail = await fetchLocationNodeDetail(updatedLocation, { silent: true });
      const targetNodeId = normalizeObjectId(
        resolvedLocationDetail?._id
        || resolvedLocationDetail?.nodeId
        || selectedNodeId
      );

      if (targetNodeId) {
        const opened = await fetchTitleDetail(targetNodeId, null, {
          resetTrail: true,
          relationHint: 'jump'
        });
        if (opened) {
          return;
        }
      }

      // 回退到首页，避免在极端情况下卡在空白状态
      setView('home');
      fetchRootNodes();
      fetchFeaturedNodes();
    }
    // 如果失败，updateUserLocation已经显示了错误消息，保持弹窗打开
  };

  // 根据location名称获取节点详细信息
  const fetchLocationNodeDetail = async (locationName, options = {}) => {
    const silent = options?.silent === true;
    const normalizedLocationName = typeof locationName === 'string' ? locationName.trim() : '';
    if (!normalizedLocationName || normalizedLocationName === '任意') {
      setCurrentLocationNodeDetail(null);
      return null;
    }

    if (!silent) {
      setIsRefreshingLocationDetail(true);
    }

    try {
      const response = await fetch(`${API_BASE}/nodes/public/search?query=${encodeURIComponent(normalizedLocationName)}`);
      const parsedSearch = await parseApiResponse(response);
      if (!response.ok || !parsedSearch?.data) {
        if (!silent) {
          window.alert(getApiErrorMessage(parsedSearch, '读取当前位置知识域失败'));
        }
        return null;
      }

      const data = parsedSearch.data;
      const results = Array.isArray(data?.results) ? data.results : [];
      // 精确匹配节点名称，并优先选择带有效 ObjectId 的结果，避免落入字段不完整的搜索条目
      const exactCandidates = results.filter((item) => (
        (typeof item?.domainName === 'string' && item.domainName.trim() === normalizedLocationName)
        || (typeof item?.name === 'string' && item.name.trim() === normalizedLocationName)
      ));
      const exactMatch = exactCandidates.find((item) => isValidObjectId(item?.nodeId || item?._id)) || null;
      const localNodeMatch = (Array.isArray(nodes) ? nodes : []).find((item) => (
        typeof item?.name === 'string'
        && item.name.trim() === normalizedLocationName
        && isValidObjectId(item?._id)
      ));
      const detailNodeId = normalizeObjectId(
        exactMatch?.nodeId
        || exactMatch?._id
        || localNodeMatch?._id
      );
      if (isValidObjectId(detailNodeId)) {
        const detailResponse = await fetch(`${API_BASE}/nodes/public/node-detail/${detailNodeId}?includeFavoriteCount=1`);
        const parsedDetail = await parseApiResponse(detailResponse);
        if (!detailResponse.ok || !parsedDetail?.data?.node) {
          if (!silent) {
            window.alert(getApiErrorMessage(parsedDetail, '读取当前位置知识域详情失败'));
          }
          return null;
        }
        setCurrentLocationNodeDetail(parsedDetail.data.node);
        return parsedDetail.data.node;
      }

      return null;
    } catch (error) {
      console.error('获取位置节点详情失败:', error);
      if (!silent) {
        window.alert(`读取当前位置知识域失败: ${error.message}`);
      }
      return null;
    } finally {
      if (!silent) {
        setIsRefreshingLocationDetail(false);
      }
    }
  };

  const syncUserLocation = (location) => {
    const nextLocation = location || '';
    const prevLocation = userLocation || '';
    if (nextLocation !== prevLocation) {
      setCurrentLocationNodeDetail(null);
    }
    if (!location || location === '任意') {
      setUserLocation(location || '');
      localStorage.setItem('userLocation', location || '');
      return;
    }
    setUserLocation(location);
    localStorage.setItem('userLocation', location);
  };

  const parseApiResponse = useCallback(async (response) => {
    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (e) {
      data = null;
    }
    return { response, data, rawText };
  }, []);

  const getApiErrorMessage = useCallback(({ response, data, rawText }, fallbackText) => {
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
  }, []);

  const {
    notifications,
    notificationUnreadCount,
    isNotificationsLoading,
    isClearingNotifications,
    isMarkingAllRead,
    isMarkingAnnouncementsRead,
    notificationActionId,
    adminPendingNodes,
    pendingMasterApplyCount,
    systemAnnouncements,
    allianceAnnouncements,
    announcementUnreadCount,
    notificationBadgeCount,
    fetchNotifications,
    fetchAdminPendingNodeReminders,
    markNotificationRead,
    markAllNotificationsRead,
    markAnnouncementNotificationsRead,
    clearNotifications,
    respondDomainAdminInvite,
    resetNotificationCenter
  } = useNotificationCenter({
    authenticated,
    isAdmin,
    parseApiResponse,
    getApiErrorMessage
  });

  const {
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
  } = useAppShellState({
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
    fetchLocationNodeDetail
  });

  function resetAppNavigationStateToHome(options = {}) {
    const clearHomeCollections = options?.clearHomeCollections === true;

    hasRestoredPageRef.current = true;
    isRestoringPageRef.current = false;
    localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
    localStorage.removeItem('senseArticleContext');
    localStorage.removeItem('sense-article-editor.preview-pane.v1');
    localStorage.removeItem('sense-article-editor.preview-pane.v2');
    knowledgeDomainReturnContextRef.current = null;

    setView('home');
    setNavigationPath(createHomeNavigationPath());
    setShowKnowledgeDomain(false);
    setKnowledgeDomainNode(null);
    setKnowledgeDomainMode('normal');
    setDomainTransitionProgress(0);
    setIsTransitioningToDomain(false);
    setClickedNodeForTransition(null);
    setCurrentNodeDetail(null);
    setCurrentTitleDetail(null);
    setTitleGraphData(null);
    setTitleRelationInfo(null);
    setSenseArticleContext(null);
    setShowNodeInfoModal(false);
    setNodeInfoModalTarget(null);
    setShowAssociationModal(false);
    setViewingAssociationNode(null);
    setShowCreateNodeModal(false);
    setSenseSelectorSourceNode(null);
    setSenseSelectorSourceSceneNodeId('');
    setSenseSelectorAnchor({ x: 0, y: 0, visible: false });
    setIsSenseSelectorVisible(false);
    setSenseSelectorOverviewNode(null);
    setSenseSelectorOverviewLoading(false);
    setSenseSelectorOverviewError('');
    setHomeSearchQuery('');
    setHomeSearchResults([]);
    setShowSearchResults(false);
    setHomeDetailTransition(createIdleHomeTransition());
    closeHeaderPanels();
    resetDistributionState();
    setIsLocationDockExpanded(false);
    setIsAnnouncementDockExpanded(false);
    if (clearHomeCollections) {
      setRootNodes([]);
      setFeaturedNodes([]);
    }
  }

  const fetchHeaderUserStats = useCallback(async ({ silent = true } = {}) => {
    const token = localStorage.getItem('token');
    if (!token || !authenticated) return null;

    if (!silent) {
      setHeaderUserStats((prev) => ({ ...prev, loading: true }));
    }

    try {
      const [profileResponse, armyResponse] = await Promise.all([
        fetch(`${API_BASE}/profile`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${API_BASE}/army/me`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      const [profileParsed, armyParsed] = await Promise.all([
        parseApiResponse(profileResponse),
        parseApiResponse(armyResponse)
      ]);

      const profileData = profileParsed.data && profileResponse.ok ? profileParsed.data : null;
      const armyData = armyParsed.data && armyResponse.ok ? armyParsed.data : null;

      const levelValue = Number(profileData?.level);
      const experienceValue = Number(profileData?.experience);
      const knowledgeBalanceValue = Number(
        Number.isFinite(Number(profileData?.knowledgeBalance))
          ? profileData.knowledgeBalance
          : armyData?.knowledgeBalance
      );
      const armyCountValue = (Array.isArray(armyData?.roster) ? armyData.roster : []).reduce((sum, entry) => (
        sum + Math.max(0, Math.floor(Number(entry?.count) || 0))
      ), 0);

      const nextStats = {
        loading: false,
        level: Number.isFinite(levelValue) ? Math.max(0, Math.floor(levelValue)) : 0,
        experience: Number.isFinite(experienceValue) ? Math.max(0, Math.floor(experienceValue)) : 0,
        knowledgeBalance: Number.isFinite(knowledgeBalanceValue) ? Math.max(0, knowledgeBalanceValue) : 0,
        armyCount: Number.isFinite(armyCountValue) ? Math.max(0, Math.floor(armyCountValue)) : 0
      };
      setHeaderUserStats(nextStats);
      return nextStats;
    } catch (error) {
      setHeaderUserStats((prev) => ({ ...prev, loading: false }));
      return null;
    }
  }, [authenticated, parseApiResponse]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!authenticated) {
      setHeaderUserStats(createDefaultHeaderUserStats());
      return undefined;
    }

    fetchHeaderUserStats({ silent: true });
    const timerId = setInterval(() => {
      fetchHeaderUserStats({ silent: true });
    }, 30000);

    return () => {
      clearInterval(timerId);
    };
  }, [authenticated, fetchHeaderUserStats]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!authenticated) return undefined;

    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchHeaderUserStats({ silent: true });
      }
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);

    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [authenticated, fetchHeaderUserStats]);

  const trackRecentDomain = async (nodeOrId, options = {}) => {
    const token = localStorage.getItem('token');
    const domainId = normalizeObjectId(nodeOrId?._id || nodeOrId);
    if (!token || !domainId) return;
    const mode = options?.mode === 'title' ? 'title' : 'sense';
    const senseId = mode === 'sense' && typeof options?.senseId === 'string'
      ? options.senseId.trim()
      : '';

    try {
      await fetch(`${API_BASE}/nodes/${domainId}/recent-visit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          mode,
          senseId
        })
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

  const applyDomainMaster = async (nodeId, reason) => {
    const token = localStorage.getItem('token');
    const targetNodeId = normalizeObjectId(nodeId);
    if (!token || !targetNodeId) return false;

    try {
      const response = await fetch(`${API_BASE}/nodes/${targetNodeId}/domain-master/apply`, {
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
      const response = await fetch(`${API_BASE}/nodes/me/siege-supports`, {
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

  const {
    intelHeistStatus,
    intelHeistDialog,
    siegeStatus,
    siegeDialog,
    siegeSupportDraft,
    pveBattleState,
    siegeBattlefieldPreviewState,
    setIntelHeistDialog,
    setSiegeSupportDraft,
    fetchSiegeStatus,
    fetchIntelHeistStatus,
    clearSiegeStatus,
    resetDomainConflictState,
    refreshDomainConflictForNode,
    closeIntelHeistDialog,
    resetSiegeDialog,
    closeSiegePveBattle,
    closeSiegeBattlefieldPreview,
    handleIntelHeistSnapshotCaptured,
    handleSiegeAction,
    startSiege,
    requestSiegeSupport,
    retreatSiege,
    submitSiegeSupport,
    handleOpenSiegeBattlefieldPreview,
    handleOpenSiegePveBattle,
    handlePveBattleFinished
  } = useDomainConflictState({
    authenticated,
    isAdmin,
    currentTitleDetail,
    currentNodeDetail,
    parseApiResponse,
    getApiErrorMessage,
    fetchNotifications,
    fetchSiegeSupportStatuses
  });

  const fetchTravelStatus = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const response = await fetch(`${API_BASE}/travel/status`, {
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

      const nextTravel = data.travel || { isTraveling: false };
      const prevTravel = travelStatusRef.current || { isTraveling: false, isStopping: false };
      applyTravelStatus(nextTravel);
      const justArrivedAtDestination = !!prevTravel.isTraveling && !prevTravel.isStopping && !nextTravel.isTraveling;
      if (justArrivedAtDestination && isLocationDockExpandedRef.current && !isAdmin) {
        const storedLocation = localStorage.getItem('userLocation') || '';
        const locationName = storedLocation.trim();
        if (locationName && locationName !== '任意') {
          fetchLocationNodeDetail(locationName, { silent: false });
        }
      }
      return data;
    } catch (error) {
      if (!silent) {
        window.alert(`获取移动状态失败: ${error.message}`);
      }
      return null;
    }
  };

  const estimateTravelToNode = async (targetNodeId) => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const response = await fetch(`${API_BASE}/travel/estimate`, {
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
      const response = await fetch(`${API_BASE}/travel/start`, {
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

      applyTravelStatus(data.travel || { isTraveling: false });
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
      const response = await fetch(`${API_BASE}/travel/stop`, {
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

      applyTravelStatus(data.travel || { isTraveling: false });
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
    // 触发移动前先收起顶部弹层，避免“我的知识域”面板遮挡移动状态反馈。
    closeHeaderPanels();

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
    if (startResult === 'started' || startResult === 'queued') {
      // 移动发起成功后，默认展开右侧驻留栏以显示“移动状态”。
      setIsAnnouncementDockExpanded(false);
      setIsLocationDockExpanded(true);
    }
    if (startResult === 'started') {
      return true;
    }
    return startResult === 'queued';
  };

  const {
    nodeDistributionStatus,
    showDistributionPanel,
    distributionPanelState,
    fetchDistributionParticipationStatus,
    handleDistributionParticipationAction,
    closeDistributionPanel,
    resetDistributionState,
    joinDistributionFromPanel,
    exitDistributionFromPanel
  } = useDistributionPanelState({
    isAdmin,
    currentTitleDetail,
    userLocation,
    parseApiResponse,
    getApiErrorMessage,
    handleMoveToNode
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!authenticated || isAdmin) {
      setTravelStatus({ isTraveling: false });
      travelStatusRef.current = { isTraveling: false, isStopping: false };
      return;
    }

    fetchTravelStatus(true);
    const timer = setInterval(() => {
      fetchTravelStatus(true);
    }, 1000);

    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, isAdmin]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, isAdmin]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const targetNodeId = normalizeObjectId(currentTitleDetail?._id);
    if (!authenticated || isAdmin || !isTitleBattleView(view) || !targetNodeId) {
      resetDistributionState();
      return undefined;
    }

    fetchDistributionParticipationStatus(targetNodeId, true);
    const timer = setInterval(() => {
      fetchDistributionParticipationStatus(targetNodeId, true);
    }, 4000);

    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, isAdmin, view, currentTitleDetail?._id, userLocation, travelStatus.isTraveling]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!showDistributionPanel) return undefined;
    const targetNodeId = normalizeObjectId(currentTitleDetail?._id);
    if (!targetNodeId || !isTitleBattleView(view)) {
      closeDistributionPanel();
      return undefined;
    }
    fetchDistributionParticipationStatus(targetNodeId, true, { updatePanel: true });
    const timer = setInterval(() => {
      fetchDistributionParticipationStatus(targetNodeId, true, { updatePanel: true });
    }, 1000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDistributionPanel, view, currentTitleDetail?._id]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        const targetNodeId = normalizeObjectId(currentTitleDetail?._id);
        if (!authenticated || isAdmin || !isTitleBattleView(view) || !targetNodeId) {
      clearSiegeStatus();
      return undefined;
    }

    fetchSiegeStatus(targetNodeId, { silent: true, preserveIntelView: siegeDialog.open });
    const timer = setInterval(() => {
      fetchSiegeStatus(targetNodeId, { silent: true, preserveIntelView: siegeDialog.open });
    }, siegeDialog.open ? 2000 : 4000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, isAdmin, view, currentTitleDetail?._id, userLocation, travelStatus.isTraveling, siegeDialog.open]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, authenticated, isAdmin]);

  useEffect(() => {
    if (!authenticated || showLocationModal || hasRestoredPageRef.current) return;

    const saved = readSavedPageState();
    if (!saved?.view || saved.view === 'home') {
      hasRestoredPageRef.current = true;
      return;
    }

    if (saved.view === 'trainingGround') {
      localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
      setView('home');
      hasRestoredPageRef.current = true;
      return;
    }

    isRestoringPageRef.current = true;

    const restorePage = async () => {
      const targetView = saved.view;
      const targetNodeId = normalizeObjectId(saved.nodeId);

      if ((targetView === 'nodeDetail' || targetView === 'knowledgeDomain' || targetView === 'titleDetail') && targetNodeId) {
        const restoredNode = targetView === 'titleDetail'
          ? await fetchTitleDetail(targetNodeId, null, { silent: true })
          : await fetchNodeDetail(targetNodeId, null, { silent: true });
        if (!restoredNode) {
          localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
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

      if ((targetView === 'army' || targetView === 'equipment' || targetView === 'trainingGround') && !isAdmin) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, showLocationModal, isAdmin]);

  useEffect(() => {
    if (!authenticated || showLocationModal || isRestoringPageRef.current) return;

    const currentView = (showKnowledgeDomain || isTransitioningToDomain) ? 'knowledgeDomain' : view;
    if (currentView === 'trainingGround' || String(currentView).startsWith('senseArticle')) {
      localStorage.removeItem(PAGE_STATE_STORAGE_KEY);
      return;
    }
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
    if (view === 'login') return;

    const isKnownView = ['home', 'nodeDetail', 'titleDetail', 'alliance', 'admin', 'profile', 'army', 'equipment', 'trainingGround'].includes(view)
      || isSenseArticleSubView(view);
    if (!isKnownView) {
      if (isDevEnvironment) {
        console.debug('[view-guard] fallback to home: unknown view', { view, reason: 'unknown_view' });
      }
      setView('home');
      return;
    }

    if (view === 'admin' && !isAdmin) {
      setView('home');
      return;
    }

    if ((view === 'army' || view === 'equipment' || view === 'trainingGround') && isAdmin) {
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

    const handleLogout = () => {
        clearStoredAuthState();
        hasRestoredPageRef.current = false;
        isRestoringPageRef.current = false;
        setAuthenticated(false);
        setUserId('');
        setUsername('');
        setProfession('');
        setView('login');
        setIsAdmin(false);
        setAdminEntryTab('users');
        setUserLocation('');
        applyTravelStatus({ isTraveling: false });
        setIsStoppingTravel(false);
        resetNotificationCenter();
        resetAppShellState();
        setIsApplyingDomainMaster(false);
        setCurrentLocationNodeDetail(null);
        setUserAvatar('default_male_1');
        setSelectedLocationNode(null);
        setShowLocationModal(false);
        resetDistributionState();
        resetDomainConflictState();
        setSiegeSupportStatuses([]);
        
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
    
        const newSocket = io(SOCKET_ENDPOINT, {
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

	    const checkAdminStatus = async () => {
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
            const response = await fetch(`${API_BASE}/nodes/public/root-nodes`);
            const parsed = await parseApiResponse(response);
            if (response.ok) {
                const data = parsed.data || {};
                setRootNodes(Array.isArray(data.nodes) ? data.nodes : []);
            } else {
                window.alert(getApiErrorMessage(parsed, '读取首页根知识域失败'));
            }
        } catch (error) {
            console.error('获取根节点失败:', error);
            window.alert(`读取首页根知识域失败: ${error.message}`);
        }
    };

    // 获取热门节点
    const fetchFeaturedNodes = async () => {
        try {
            const response = await fetch(`${API_BASE}/nodes/public/featured-nodes`);
            const parsed = await parseApiResponse(response);
            if (response.ok) {
                const data = parsed.data || {};
                setFeaturedNodes(Array.isArray(data.nodes) ? data.nodes : []);
            } else {
                window.alert(getApiErrorMessage(parsed, '读取热门知识域失败'));
            }
        } catch (error) {
            console.error('获取热门节点失败:', error);
            window.alert(`读取热门知识域失败: ${error.message}`);
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

    const appendNavigationTrailItem = (node, relation = 'jump', options = {}) => {
        const mode = options?.mode === 'title' ? 'title' : 'sense';
        setNavigationPath((prevPath) => {
            const safePath = Array.isArray(prevPath) && prevPath.length > 0
                ? prevPath
                : createHomeNavigationPath();
            const targetNavItem = buildNavigationTrailItem(node, relation, { mode });
            if (!targetNavItem) return safePath;

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
    };

    const replaceNavigationPathAtHistoryIndex = (historyIndex, node, options = {}) => {
        const mode = options?.mode === 'title' ? 'title' : 'sense';
        setNavigationPath((prevPath) => {
            const safePath = Array.isArray(prevPath) && prevPath.length > 0
                ? prevPath
                : createHomeNavigationPath();
            const boundedIndex = Number.isInteger(historyIndex)
                ? Math.max(0, Math.min(historyIndex, safePath.length - 1))
                : -1;
            if (boundedIndex < 0) return safePath;

            const nextPath = safePath.slice(0, boundedIndex + 1);
            const lastHistory = nextPath[nextPath.length - 1];
            if (lastHistory?.type !== 'node') {
                return nextPath;
            }

            const nextItem = buildNavigationTrailItem(node, lastHistory.relation, { mode });
            return [
                ...nextPath.slice(0, -1),
                {
                    ...lastHistory,
                    mode,
                    senseId: mode === 'sense'
                        ? (typeof node?.activeSenseId === 'string' ? node.activeSenseId : (lastHistory.senseId || ''))
                        : '',
                    label: nextItem?.label || lastHistory.label
                }
            ];
        });
    };

    const formatTravelSeconds = (seconds) => {
        if (!Number.isFinite(seconds) || seconds <= 0) return '0 秒';
        const rounded = Math.round(seconds);
        const mins = Math.floor(rounded / 60);
        const remain = rounded % 60;
        if (mins <= 0) return `${remain} 秒`;
        return `${mins} 分 ${remain} 秒`;
    };

    const closeKnowledgeDomainBeforeNavigation = () => {
        if (showKnowledgeDomain || isTransitioningToDomain || knowledgeDomainNode) {
            setShowKnowledgeDomain(false);
            setIsTransitioningToDomain(false);
            setDomainTransitionProgress(0);
            setKnowledgeDomainNode(null);
            setKnowledgeDomainMode('normal');
            setClickedNodeForTransition(null);
            knowledgeDomainReturnContextRef.current = null;
        }
        if (showDistributionPanel) {
            closeDistributionPanel();
        }
        if (siegeDialog.open) {
            resetSiegeDialog();
        }
    };

    const clearStarMapState = useCallback((options = {}) => {
        const preserveMode = options?.preserveMode === true;
        const previous = starMapRequestRef.current;
        if (previous?.controller && !previous.controller.signal.aborted) {
            previous.controller.abort(new DOMException('Star map state cleared', 'AbortError'));
        }
        setTitleStarMapData(null);
        setNodeStarMapData(null);
        setCurrentStarMapCenter(null);
        setCurrentStarMapLayer('');
        setCurrentStarMapLimit(DEFAULT_STAR_MAP_LIMIT);
        setIsStarMapLoading(false);
        if (!preserveMode) {
            setKnowledgeMainViewMode(KNOWLEDGE_MAIN_VIEW_MODE.MAIN);
        }
    }, []);

    const prepareForPrimaryNavigation = async () => {
        closeKnowledgeDomainBeforeNavigation();
        setTitleRelationInfo(null);
        setIsSenseSelectorVisible(false);
        await collapseRightDocksBeforeNavigation();
    };

    const navigateToHomeWithDockCollapse = async () => {
        await prepareForPrimaryNavigation();
        clearStarMapState();
        setView('home');
        setCurrentTitleDetail(null);
        setTitleGraphData(null);
        setTitleRelationInfo(null);
        setNodeInfoModalTarget(null);
        setIsSenseSelectorVisible(false);
        setSenseSelectorSourceNode(null);
        setNavigationPath(createHomeNavigationPath());
    };

    const handleHeaderHomeNavigation = async () => {
        if (view === 'senseArticleEditor') {
            setSystemConfirmState({
                open: true,
                title: '确认返回首页',
                message: '当前位于百科编辑页，返回首页将直接丢失本次未保存内容，是否继续返回首页？',
                confirmText: '直接返回首页',
                confirmTone: 'danger',
                onConfirm: async () => {
                    setSystemConfirmState((prev) => ({ ...prev, open: false }));
                    await navigateToHomeWithDockCollapse();
                }
            });
            return;
        }
        await navigateToHomeWithDockCollapse();
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

    // 获取标题主视角详情
    const fetchTitleDetail = async (nodeId, clickedNode = null, navOptions = {}) => {
        const shouldAlert = navOptions?.silent !== true;
        const normalizedNodeId = normalizeObjectId(nodeId);
        if (!isValidObjectId(normalizedNodeId)) {
            if (shouldAlert) {
                alert('无效的节点ID');
            }
            return null;
        }
        const request = beginPrimaryNavigationRequest(
            `title:${normalizedNodeId}`,
            typeof navOptions?.requestSource === 'string' ? navOptions.requestSource : 'title-detail'
        );
        try {
            await prepareForPrimaryNavigation();
            if (!isPrimaryNavigationRequestCurrent(request)) {
                return null;
            }

            const response = await fetchPrimaryNavigationResponse(
                `${API_BASE}/nodes/public/title-detail/${normalizedNodeId}?depth=1`,
                request
            );
            if (!response) {
                return null;
            }
            if (!response.ok) {
                if (shouldAlert) {
                    const parsed = await parseApiResponse(response);
                    alert(getApiErrorMessage(parsed, '获取标题主视角失败'));
                }
                return null;
            }

            const data = await response.json();
            const graph = data?.graph || {};
            const centerNode = graph?.centerNode || null;
            const targetNodeId = normalizeObjectId(centerNode?._id);
            if (!isPrimaryNavigationRequestCurrent(request)) {
                return null;
            }
            if (!targetNodeId || !centerNode) {
                if (shouldAlert) {
                    alert('标题主视角数据无效');
                }
                return null;
            }

            const shouldResetTrail = navOptions?.resetTrail === true || !isKnowledgeDetailView(view);
            const relation = normalizeNavigationRelation(navOptions?.relationHint);
            if (navOptions?.keepStarMapState !== true) {
                clearStarMapState();
            }
            trackRecentDomain(centerNode, { mode: 'title' });
            setCurrentTitleDetail(centerNode);
            setTitleGraphData(graph);
            setCurrentNodeDetail(null);
            setNodeInfoModalTarget(null);
            setTitleRelationInfo(null);
            setView('titleDetail');
            setIsSenseSelectorVisible(false);
            setSenseSelectorSourceNode(centerNode);
            refreshDomainConflictForNode(targetNodeId);

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
            if (!isPrimaryNavigationRequestCurrent(request) || isAbortError(error)) {
                return null;
            }
            console.error('获取标题主视角失败:', error);
            if (shouldAlert) {
                alert(`获取标题主视角失败: ${error.message}`);
            }
            return null;
        } finally {
            finishPrimaryNavigationRequest(request);
        }
    };

    // 获取释义主视角详情
    const fetchNodeDetail = async (nodeId, clickedNode = null, navOptions = {}) => {
        const shouldAlert = navOptions?.silent !== true;
        const normalizedNodeId = normalizeObjectId(nodeId);
        if (!isValidObjectId(normalizedNodeId)) {
            if (shouldAlert) {
                alert('无效的节点ID');
            }
            return null;
        }
        const requestedSenseId = typeof navOptions?.activeSenseId === 'string' ? navOptions.activeSenseId.trim() : '';
        const request = beginPrimaryNavigationRequest(
            `sense:${normalizedNodeId}:${requestedSenseId}`,
            typeof navOptions?.requestSource === 'string' ? navOptions.requestSource : 'node-detail'
        );
        try {
            await prepareForPrimaryNavigation();
            if (!isPrimaryNavigationRequestCurrent(request)) {
                return null;
            }
            const detailUrl = requestedSenseId
                ? `${API_BASE}/nodes/public/node-detail/${normalizedNodeId}?senseId=${encodeURIComponent(requestedSenseId)}`
                : `${API_BASE}/nodes/public/node-detail/${normalizedNodeId}`;
            const response = await fetchPrimaryNavigationResponse(detailUrl, request);
            if (!response) {
                return null;
            }
            if (response.ok) {
                const data = await response.json();
                const targetNodeId = normalizeObjectId(data?.node?._id);
                if (!isPrimaryNavigationRequestCurrent(request)) {
                    return null;
                }
                const currentNodeBeforeNavigate = currentNodeDetail;
                const shouldResetTrail = navOptions?.resetTrail === true || !isKnowledgeDetailView(view);
                const relation = resolveNavigationRelationAgainstCurrent(
                    targetNodeId,
                    currentNodeBeforeNavigate,
                    navOptions?.relationHint
                );
                const previousNodeId = normalizeObjectId(currentNodeBeforeNavigate?._id);
                const isSenseOnlySwitch = !!requestedSenseId && !!targetNodeId && targetNodeId === previousNodeId;
                if (navOptions?.keepStarMapState !== true) {
                    clearStarMapState();
                }
                if (!isSenseOnlySwitch) {
                    setIsSenseSelectorVisible(false);
                }
                trackRecentDomain(data.node, {
                    mode: 'sense',
                    senseId: typeof data?.node?.activeSenseId === 'string' ? data.node.activeSenseId : ''
                });
                setCurrentNodeDetail(data.node);
                setCurrentTitleDetail(null);
                setTitleGraphData(null);
                setTitleRelationInfo(null);
                setView('nodeDetail');
                refreshDomainConflictForNode(targetNodeId);

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
                if (shouldAlert) {
                    const parsed = await parseApiResponse(response);
                    alert(getApiErrorMessage(parsed, '获取节点详情失败'));
                }
                return null;
            }
        } catch (error) {
            if (!isPrimaryNavigationRequestCurrent(request) || isAbortError(error)) {
                return null;
            }
            console.error('获取节点详情失败:', error);
            if (shouldAlert) {
                alert(`获取节点详情失败: ${error.message}`);
            }
            return null;
        } finally {
            finishPrimaryNavigationRequest(request);
        }
    };

    const buildStarMapCenterState = useCallback((layer, nodeLike = {}) => {
        const nodeId = normalizeObjectId(nodeLike?._id);
        if (!nodeId) return null;
        return {
            layer: layer === STAR_MAP_LAYER.SENSE ? STAR_MAP_LAYER.SENSE : STAR_MAP_LAYER.TITLE,
            nodeId,
            senseId: layer === STAR_MAP_LAYER.SENSE
                ? (typeof nodeLike?.activeSenseId === 'string' ? nodeLike.activeSenseId.trim() : '')
                : '',
            label: typeof nodeLike?.displayName === 'string' && nodeLike.displayName.trim()
                ? nodeLike.displayName.trim()
                : (typeof nodeLike?.name === 'string' ? nodeLike.name.trim() : '')
        };
    }, []);

    const fetchTitleStarMap = useCallback(async (nodeId, options = {}) => {
        const normalizedNodeId = normalizeObjectId(nodeId);
        if (!isValidObjectId(normalizedNodeId)) return null;

        const request = beginStarMapRequest(`title:${normalizedNodeId}`);
        const requestedLimit = Number.isFinite(Number(options?.limit))
            ? Math.max(10, Math.min(200, Number(options.limit)))
            : null;
        const query = requestedLimit ? `?limit=${requestedLimit}` : '';
        setIsStarMapLoading(true);

        try {
            const response = await fetch(`${API_BASE}/nodes/public/title-star-map/${normalizedNodeId}${query}`, {
                signal: request.controller.signal
            });
            if (!isStarMapRequestCurrent(request)) return null;
            if (!response.ok) {
                const parsed = await parseApiResponse(response);
                if (options?.silent !== true) {
                    alert(getApiErrorMessage(parsed, '获取标题星盘失败'));
                }
                return null;
            }

            const data = await response.json();
            if (!isStarMapRequestCurrent(request)) return null;
            const graph = data?.graph || null;
            const centerNode = graph?.centerNode || null;
            const centerState = buildStarMapCenterState(STAR_MAP_LAYER.TITLE, centerNode);
            if (!graph || !centerState) {
                if (options?.silent !== true) {
                    alert('标题星盘数据无效');
                }
                return null;
            }

            setTitleRelationInfo(null);
            setIsSenseSelectorVisible(false);
            if (options?.syncDetailState) {
                setCurrentTitleDetail(centerNode);
                setCurrentNodeDetail(null);
                setTitleGraphData(null);
                setNodeInfoModalTarget(null);
                setView('titleDetail');
                refreshDomainConflictForNode(normalizedNodeId);
            }
            setTitleStarMapData(graph);
            setNodeStarMapData(null);
            setCurrentStarMapCenter(centerState);
            setCurrentStarMapLayer(STAR_MAP_LAYER.TITLE);
            setCurrentStarMapLimit(Math.max(10, Number(graph?.effectiveLimit) || DEFAULT_STAR_MAP_LIMIT));
            setKnowledgeMainViewMode(KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP);
            setClickedNodeForTransition(options?.clickedNode || null);
            return graph;
        } catch (error) {
            if (!isStarMapRequestCurrent(request) || isAbortError(error)) {
                return null;
            }
            console.error('获取标题星盘失败:', error);
            if (options?.silent !== true) {
                alert(`获取标题星盘失败: ${error.message}`);
            }
            return null;
        } finally {
            if (isStarMapRequestCurrent(request)) {
                setIsStarMapLoading(false);
            }
            finishStarMapRequest(request);
        }
    }, [
        beginStarMapRequest,
        buildStarMapCenterState,
        finishStarMapRequest,
        getApiErrorMessage,
        isAbortError,
        isStarMapRequestCurrent,
        parseApiResponse,
        refreshDomainConflictForNode
    ]);

    const fetchSenseStarMap = useCallback(async (nodeId, senseId = '', options = {}) => {
        const normalizedNodeId = normalizeObjectId(nodeId);
        if (!isValidObjectId(normalizedNodeId)) return null;

        const request = beginStarMapRequest(`sense:${normalizedNodeId}:${String(senseId || '').trim()}`);
        const requestedLimit = Number.isFinite(Number(options?.limit))
            ? Math.max(10, Math.min(200, Number(options.limit)))
            : null;
        const senseQuery = typeof senseId === 'string' && senseId.trim()
            ? `senseId=${encodeURIComponent(senseId.trim())}`
            : '';
        const limitQuery = requestedLimit ? `limit=${requestedLimit}` : '';
        const query = [senseQuery, limitQuery].filter(Boolean).join('&');
        setIsStarMapLoading(true);

        try {
            const response = await fetch(
                `${API_BASE}/nodes/public/sense-star-map/${normalizedNodeId}${query ? `?${query}` : ''}`,
                { signal: request.controller.signal }
            );
            if (!isStarMapRequestCurrent(request)) return null;
            if (!response.ok) {
                const parsed = await parseApiResponse(response);
                if (options?.silent !== true) {
                    alert(getApiErrorMessage(parsed, '获取释义星盘失败'));
                }
                return null;
            }

            const data = await response.json();
            if (!isStarMapRequestCurrent(request)) return null;
            const graph = data?.graph || null;
            const centerNode = graph?.centerNode || null;
            const centerState = buildStarMapCenterState(STAR_MAP_LAYER.SENSE, centerNode);
            if (!graph || !centerState) {
                if (options?.silent !== true) {
                    alert('释义星盘数据无效');
                }
                return null;
            }

            setTitleRelationInfo(null);
            setIsSenseSelectorVisible(false);
            if (options?.syncDetailState) {
                setCurrentNodeDetail(centerNode);
                setCurrentTitleDetail(null);
                setTitleGraphData(null);
                setNodeInfoModalTarget(null);
                setView('nodeDetail');
                refreshDomainConflictForNode(normalizedNodeId);
            }
            setNodeStarMapData(graph);
            setTitleStarMapData(null);
            setCurrentStarMapCenter(centerState);
            setCurrentStarMapLayer(STAR_MAP_LAYER.SENSE);
            setCurrentStarMapLimit(Math.max(10, Number(graph?.effectiveLimit) || DEFAULT_STAR_MAP_LIMIT));
            setKnowledgeMainViewMode(KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP);
            setClickedNodeForTransition(options?.clickedNode || null);
            return graph;
        } catch (error) {
            if (!isStarMapRequestCurrent(request) || isAbortError(error)) {
                return null;
            }
            console.error('获取释义星盘失败:', error);
            if (options?.silent !== true) {
                alert(`获取释义星盘失败: ${error.message}`);
            }
            return null;
        } finally {
            if (isStarMapRequestCurrent(request)) {
                setIsStarMapLoading(false);
            }
            finishStarMapRequest(request);
        }
    }, [
        beginStarMapRequest,
        buildStarMapCenterState,
        finishStarMapRequest,
        getApiErrorMessage,
        isAbortError,
        isStarMapRequestCurrent,
        parseApiResponse,
        refreshDomainConflictForNode
    ]);

    const buildClickedNodeFromScene = useCallback((targetNodeId, options = {}) => {
        const sceneNodes = sceneManagerRef.current?.currentLayout?.nodes || [];
        const matched = sceneNodes.find((n) => {
            if (options?.predicate && typeof options.predicate === 'function') {
                return options.predicate(n);
            }
            return n?.data?._id === targetNodeId;
        });
        if (!matched) return null;
        return {
            id: matched.id,
            data: matched.data,
            type: matched.type
        };
    }, []);

    const updateSenseSelectorAnchorBySceneNode = (sceneNode) => {
        const renderer = sceneManagerRef.current?.renderer;
        const canvas = webglCanvasRef.current;
        if (!renderer || !canvas || !sceneNode) return;
        const rect = canvas.getBoundingClientRect();
        const screenPos = renderer.worldToScreen(sceneNode.x, sceneNode.y);
        const next = {
            x: Math.round(rect.left + screenPos.x),
            y: Math.round(rect.top + screenPos.y),
            visible: true
        };
        senseSelectorAnchorRef.current = next;
        setSenseSelectorAnchor(next);
    };

    const recenterStarMapFromNode = async (node) => {
        if (!node?.data?._id) return;
        const relationHint = getNavigationRelationFromSceneNode(node);

        if (view === 'titleDetail') {
            const nextCenter = buildStarMapCenterState(STAR_MAP_LAYER.TITLE, node.data);
            if (areStarMapCentersEqual(currentStarMapCenter, nextCenter)) return;
            const graph = await fetchTitleStarMap(node.data._id, {
                silent: false,
                clickedNode: node
            });
            if (graph?.centerNode) {
                appendNavigationTrailItem(
                    graph.centerNode,
                    normalizeNavigationRelation(relationHint),
                    { mode: 'title' }
                );
            }
            return;
        }

        if (view === 'nodeDetail') {
            const nextCenter = buildStarMapCenterState(STAR_MAP_LAYER.SENSE, node.data);
            if (areStarMapCentersEqual(currentStarMapCenter, nextCenter)) return;
            const graph = await fetchSenseStarMap(node.data._id, node?.data?.activeSenseId || '', {
                silent: false,
                clickedNode: node
            });
            if (graph?.centerNode) {
                appendNavigationTrailItem(
                    graph.centerNode,
                    resolveNavigationRelationAgainstCurrent(graph.centerNode?._id, currentNodeDetail, relationHint),
                    { mode: 'sense' }
                );
            }
        }
    };

    const updateSenseSelectorAnchorByElement = (element) => {
        const rect = element?.getBoundingClientRect?.();
        if (!rect) return;
        const next = {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
            visible: true
        };
        senseSelectorAnchorRef.current = next;
        setSenseSelectorAnchor(next);
    };

    const handleHomeDomainActivate = useCallback((node, anchorElement = null) => {
        if (!node?._id) return;
        setTitleRelationInfo(null);
        setSenseSelectorSourceNode(node);
        setSenseSelectorSourceSceneNodeId('');
        armHomeDetailTransition(node, anchorElement);
        if (anchorElement) {
            updateSenseSelectorAnchorByElement(anchorElement);
        }
        setIsSenseSelectorVisible(true);
    }, [armHomeDetailTransition]);

    const handleGhostStatusChange = useCallback((runId, status) => {
        setHomeDetailTransition((prev) => {
            if (!prev || prev.runId !== runId || prev.status === 'idle') return prev;
            if (prev.status === status) return prev;
            return {
                ...prev,
                status
            };
        });
    }, []);

    const handleGhostSettleProgress = useCallback((runId, progress) => {
        const current = homeDetailTransitionRef.current;
        if (!current || current.runId !== runId) return;
        updateHomeTransitionReveal(runId, progress);
    }, [updateHomeTransitionReveal]);

    const handleGhostSettleComplete = useCallback((runId) => {
        const current = homeDetailTransitionRef.current;
        if (!current || current.runId !== runId) return;
        if (current.targetLayoutNodeId && sceneManagerRef.current?.renderer) {
            sceneManagerRef.current.renderer.setNodeRevealProgress(current.targetLayoutNodeId, 1);
        }
        clearHomeDetailTransition();
    }, [clearHomeDetailTransition]);

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

    const handleDistributionAnnouncementClick = async (notification) => {
        if (!notification) return;

        if (!notification.read && notification._id) {
            await markNotificationRead(notification._id);
        }

        let targetNodeId = normalizeObjectId(notification.nodeId);
        if (!targetNodeId && typeof notification.nodeName === 'string' && notification.nodeName.trim()) {
            try {
                const response = await fetch(`${API_BASE}/nodes/public/search?query=${encodeURIComponent(notification.nodeName.trim())}`);
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
    const isCurrentUserActiveSiegeAttacker = siegeActiveGateRows.some((row) => (
        (row.attackers || []).some((item) => item?.username === username)
    ));
    const siegePreferredBattleGate = (
        (siegeStatus.compareGate && (siegeStatus.activeGateKeys || []).includes(siegeStatus.compareGate) ? siegeStatus.compareGate : '')
        || (siegeStatus.activeGateKeys || [])[0]
        || ''
    );
    const canLaunchSiegePveBattle = (
        !isAdmin
        && !isSiegeReadonlyViewer
        && siegeStatus.viewerRole === 'common'
        && siegeStatus.hasActiveSiege
        && !!siegePreferredBattleGate
        && isCurrentUserActiveSiegeAttacker
    );
    const canPreviewSiegeBattlefield = (
        !isAdmin
        && !isSiegeReadonlyViewer
        && siegeStatus.viewerRole === 'common'
        && siegeStatus.hasActiveSiege
        && !!siegePreferredBattleGate
        && siegeStatus.compare?.defender?.source === 'intel'
    );

    const handleOpenRelatedDomain = async (node, sectionType = 'default') => {
        const nodeId = normalizeObjectId(node?._id);
        if (!nodeId) return;
        closeHeaderPanels();
        const clickedNode = buildClickedNodeFromScene(nodeId);
        if (sectionType === 'recent' && node?.recentVisitMode === 'sense') {
            await fetchNodeDetail(nodeId, clickedNode, {
                relationHint: 'jump',
                activeSenseId: typeof node?.recentVisitSenseId === 'string' ? node.recentVisitSenseId.trim() : ''
            });
            return;
        }
        await fetchTitleDetail(nodeId, clickedNode, { relationHint: 'jump' });
    };

    const handleOpenTravelNode = async (travelNode) => {
        const nodeId = normalizeObjectId(travelNode?.nodeId);
        if (!nodeId) return;
        const clickedNode = buildClickedNodeFromScene(nodeId);
        await fetchTitleDetail(nodeId, clickedNode);
    };

    const handleKnowledgeSearchChange = (event) => {
        setHomeSearchQuery(event.target.value);
    };

    const handleKnowledgeSearchFocus = () => {
        setShowSearchResults(true);
    };

    const handleKnowledgeSearchClear = () => {
        setHomeSearchQuery('');
        setHomeSearchResults([]);
        setShowSearchResults(true);
    };

    const handleHomeKnowledgeSearchResultClick = (node) => {
        const targetNodeId = normalizeObjectId(node?.nodeId || node?._id);
        if (!targetNodeId) return;
        fetchNodeDetail(targetNodeId, {
            id: `search-${targetNodeId || node?._id}`,
            data: node,
            type: 'search'
        }, {
            resetTrail: true,
            relationHint: 'jump',
            activeSenseId: typeof node?.senseId === 'string' ? node.senseId : ''
        });
        setShowSearchResults(false);
    };

    const handleDetailKnowledgeSearchResultClick = (node) => {
        const targetNodeId = normalizeObjectId(node?.nodeId || node?._id);
        if (!targetNodeId) return;
        fetchNodeDetail(targetNodeId, {
            id: `search-${targetNodeId || node?._id}`,
            data: node,
            type: 'search'
        }, {
            relationHint: 'jump',
            activeSenseId: typeof node?.senseId === 'string' ? node.senseId : ''
        });
        setShowSearchResults(false);
    };

    const handleKnowledgeNavigateHistory = (item, index) => {
        if (!item?.nodeId) return;
        if (knowledgeMainViewMode === KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP) {
            if (item?.mode === 'title') {
                fetchTitleStarMap(item.nodeId, {
                    silent: false,
                    syncDetailState: true
                }).then((graph) => {
                    if (!graph?.centerNode) return;
                    replaceNavigationPathAtHistoryIndex(index, graph.centerNode, { mode: 'title' });
                });
                return;
            }

            fetchSenseStarMap(item.nodeId, item.senseId || '', {
                silent: false,
                syncDetailState: true
            }).then((graph) => {
                if (!graph?.centerNode) return;
                replaceNavigationPathAtHistoryIndex(index, graph.centerNode, { mode: 'sense' });
                });
            return;
        }

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
    };

    const handleTitleDetailNavigate = (nodeId, navOptions = {}) => {
        fetchTitleDetail(nodeId, null, navOptions);
    };

    const handleNodeDetailNavigate = (nodeId, navOptions = {}) => {
        fetchNodeDetail(nodeId, null, navOptions);
    };

    const handleKnowledgeHome = async () => {
        await navigateToHomeWithDockCollapse();
    };

    const handleOpenCurrentNodeInfo = () => {
        setNodeInfoModalTarget(currentNodeDetail);
        setShowNodeInfoModal(true);
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
        const currentUserId = normalizeObjectId(userId)
            || normalizeObjectId(localStorage.getItem('userId'))
            || decodeUserIdFromToken(localStorage.getItem('token'));
        const currentUsernameNormalized = (typeof username === 'string' ? username.trim().toLowerCase() : '')
            || (typeof localStorage.getItem('username') === 'string' ? localStorage.getItem('username').trim().toLowerCase() : '');
        const domainMasterId = normalizeObjectId(nodeDetail?.domainMaster);
        const domainMasterName = typeof nodeDetail?.domainMaster?.username === 'string'
            ? nodeDetail.domainMaster.username.trim().toLowerCase()
            : '';
        const domainAdminIds = Array.isArray(nodeDetail?.domainAdmins)
            ? nodeDetail.domainAdmins.map((item) => normalizeObjectId(item)).filter(Boolean)
            : [];
        const domainAdminNames = Array.isArray(nodeDetail?.domainAdmins)
            ? nodeDetail.domainAdmins
                .map((item) => (typeof item?.username === 'string' ? item.username.trim().toLowerCase() : ''))
                .filter(Boolean)
            : [];
        const isDomainMasterUser = (
            (currentUserId && domainMasterId && currentUserId === domainMasterId)
            || (currentUsernameNormalized && domainMasterName && currentUsernameNormalized === domainMasterName)
        );
        const isDomainAdminUser = (
            (currentUserId && domainAdminIds.includes(currentUserId))
            || (currentUsernameNormalized && domainAdminNames.includes(currentUsernameNormalized))
        );
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
        const managedIdentityUserIds = new Set([domainMasterId, ...domainAdminIds].filter(Boolean));
        const managedIdentityNames = new Set([domainMasterName, ...domainAdminNames].filter(Boolean));
        const hasHostileSiegeOnManagedNode = isManagedNodeByUser && (siegeStatusMatched.activeGateKeys || []).some((gateKey) => {
            const gateState = siegeStatusMatched.gateStates?.[gateKey];
            const attackers = Array.isArray(gateState?.attackers) ? gateState.attackers : [];
            if (attackers.length <= 0) return false;
            return attackers.some((attacker) => {
                const attackerId = normalizeObjectId(attacker?.userId);
                const attackerName = typeof attacker?.username === 'string' ? attacker.username.trim().toLowerCase() : '';
                if (attackerId && managedIdentityUserIds.has(attackerId)) return false;
                if (attackerName && managedIdentityNames.has(attackerName)) return false;
                return true;
            });
        });
        const siegeGateLabel = siegeStatusMatched.compare?.gateLabel
            || CITY_GATE_LABEL_MAP[siegeStatusMatched.compareGate]
            || '';
        const siegeTooltip = isManagedNodeByUser
            ? '攻占详情'
            : (siegeStatusMatched.loading
                ? '围城状态读取中...'
                : (siegeStatusMatched.hasActiveSiege
                    ? `攻占知识域（围城进行中${siegeGateLabel ? `：${siegeGateLabel}` : ''}）`
                    : (siegeStatusMatched.canStartSiege
                        ? '攻占知识域'
                        : `攻占知识域（${siegeStatusMatched.startDisabledReason || '当前不可发起'}）`)));
        const siegeDisabled = false;
        const showSiegeButton = !isAdmin && (!isManagedNodeByUser || hasHostileSiegeOnManagedNode);

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
            siegeTooltip: showSiegeButton ? siegeTooltip : '',
            siegeDisabled,
            siegeActive: isManagedNodeByUser
                ? hasHostileSiegeOnManagedNode
                : !!siegeStatusMatched.hasActiveSiege
        };
    };

	    // eslint-disable-next-line react-hooks/exhaustive-deps
	    useEffect(() => {
        if (!sceneManagerRef.current) return;

        sceneManagerRef.current.onNodeClick = (node) => {
            if (!node?.data?._id) return;

            if (view === 'home') {
                setTitleRelationInfo(null);
                setSenseSelectorSourceNode(node.data);
                setSenseSelectorSourceSceneNodeId(String(node?.id || ''));
                updateSenseSelectorAnchorBySceneNode(node);
                setIsSenseSelectorVisible(true);
                return;
            }

            if (view === 'titleDetail') {
                setTitleRelationInfo(null);
                if (knowledgeMainViewMode === KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP) {
                    recenterStarMapFromNode(node);
                    return;
                }
                if (node.type === 'center') {
                    setSenseSelectorSourceNode(currentTitleDetail || node.data);
                    setSenseSelectorSourceSceneNodeId('');
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
                if (knowledgeMainViewMode === KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP) {
                    recenterStarMapFromNode(node);
                    return;
                }
                if (node.type === 'center') {
                    setSenseSelectorSourceNode(currentNodeDetail || node.data);
                    setSenseSelectorSourceSceneNodeId('');
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
	    // eslint-disable-next-line react-hooks/exhaustive-deps
	    }, [view, currentNodeDetail, currentTitleDetail, knowledgeMainViewMode, recenterStarMapFromNode]);

    // 实时搜索
    const performHomeSearch = async (query) => {
        if (!query || query.trim() === '') {
            setHomeSearchResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        try {
            const response = await fetch(`${API_BASE}/nodes/public/search?query=${encodeURIComponent(query)}`);
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
	    // eslint-disable-next-line react-hooks/exhaustive-deps
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
	    // eslint-disable-next-line react-hooks/exhaustive-deps
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
	    // eslint-disable-next-line react-hooks/exhaustive-deps
	    }, [authenticated, view]);

    useEffect(() => {
        if (isKnowledgeDetailView(view)) return;
        if (knowledgeMainViewMode !== KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP && !titleStarMapData && !nodeStarMapData) {
            return;
        }
        clearStarMapState();
    }, [clearStarMapState, knowledgeMainViewMode, nodeStarMapData, titleStarMapData, view]);

    // 更新WebGL首页场景
    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        if (view !== 'home') return;

        // 首页主入口改为 HTML/SVG 六边形层，WebGL 在首页只承担背景氛围层。
        sceneManagerRef.current.showHome([], [], []);
        if (isMapDebugEnabled()) {
            console.info('[MapDebug] showHome', {
                rootCount: rootNodes.length,
                featuredCount: featuredNodes.length
            });
        }
    }, [isWebGLReady, view, rootNodes, featuredNodes]);

    // 更新WebGL释义主视角场景
    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        if (view !== 'nodeDetail' || !currentNodeDetail) return;
        if (knowledgeMainViewMode !== KNOWLEDGE_MAIN_VIEW_MODE.MAIN) return;

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
    }, [isWebGLReady, view, currentNodeDetail, clickedNodeForTransition, knowledgeMainViewMode]);

    // 更新WebGL标题主视角场景
    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        if (view !== 'titleDetail' || !currentTitleDetail || !titleGraphData) return;
        if (knowledgeMainViewMode !== KNOWLEDGE_MAIN_VIEW_MODE.MAIN) return;

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
	    // eslint-disable-next-line react-hooks/exhaustive-deps
	    }, [isWebGLReady, view, currentTitleDetail, titleGraphData, clickedNodeForTransition, knowledgeMainViewMode]);

    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        if (knowledgeMainViewMode !== KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP) return;

        if (view === 'titleDetail' && currentStarMapLayer === STAR_MAP_LAYER.TITLE && titleStarMapData) {
            sceneManagerRef.current.showStarMap('titleDetail', titleStarMapData, clickedNodeForTransition);
            setClickedNodeForTransition(null);
        }
    }, [clickedNodeForTransition, currentStarMapLayer, isWebGLReady, knowledgeMainViewMode, titleStarMapData, view]);

    useEffect(() => {
        if (!sceneManagerRef.current || !isWebGLReady) return;
        if (knowledgeMainViewMode !== KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP) return;

        if (view === 'nodeDetail' && currentStarMapLayer === STAR_MAP_LAYER.SENSE && nodeStarMapData) {
            sceneManagerRef.current.showStarMap('nodeDetail', nodeStarMapData, clickedNodeForTransition);
            setClickedNodeForTransition(null);
        }
    }, [clickedNodeForTransition, currentStarMapLayer, isWebGLReady, knowledgeMainViewMode, nodeStarMapData, view]);

    useEffect(() => {
        const canvas = webglCanvasRef.current;
        if (!canvas || !isWebGLReady) return undefined;
        if (!isKnowledgeDetailView(view)) return undefined;

        const enterStarMapMode = async () => {
            if (view === 'titleDetail' && currentTitleDetail?._id) {
                await fetchTitleStarMap(currentTitleDetail._id, {
                    silent: false
                });
                return;
            }

            if (view === 'nodeDetail' && currentNodeDetail?._id) {
                await fetchSenseStarMap(currentNodeDetail._id, currentNodeDetail?.activeSenseId || '', {
                    silent: false
                });
            }
        };

        const exitStarMapMode = async () => {
            if (knowledgeMainViewMode !== KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP) return;

            if (view === 'titleDetail') {
                const targetNodeId = normalizeObjectId(currentStarMapCenter?.nodeId || currentTitleDetail?._id);
                const currentNodeId = normalizeObjectId(currentTitleDetail?._id);
                if (!targetNodeId) {
                    clearStarMapState();
                    return;
                }
                if (targetNodeId === currentNodeId) {
                    clearStarMapState();
                    return;
                }
                const clickedNode = buildClickedNodeFromScene(targetNodeId);
                const result = await fetchTitleDetail(targetNodeId, clickedNode, {
                    historyIndex: Math.max(0, (navigationPath?.length || 1) - 1),
                    requestSource: 'star-map-exit',
                    keepStarMapState: true,
                    silent: true
                });
                if (result) {
                    clearStarMapState();
                }
                return;
            }

            if (view === 'nodeDetail') {
                const targetNodeId = normalizeObjectId(currentStarMapCenter?.nodeId || currentNodeDetail?._id);
                const targetSenseId = typeof currentStarMapCenter?.senseId === 'string' && currentStarMapCenter.senseId.trim()
                    ? currentStarMapCenter.senseId.trim()
                    : (typeof currentNodeDetail?.activeSenseId === 'string' ? currentNodeDetail.activeSenseId.trim() : '');
                const currentNodeId = normalizeObjectId(currentNodeDetail?._id);
                const currentSenseId = typeof currentNodeDetail?.activeSenseId === 'string' ? currentNodeDetail.activeSenseId.trim() : '';
                if (!targetNodeId) {
                    clearStarMapState();
                    return;
                }
                if (targetNodeId === currentNodeId && targetSenseId === currentSenseId) {
                    clearStarMapState();
                    return;
                }
                const targetVertexKey = toSenseVertexKey(targetNodeId, targetSenseId);
                const clickedNode = buildClickedNodeFromScene(targetNodeId, {
                    predicate: (sceneNode) => (
                        normalizeObjectId(sceneNode?.data?._id) === targetNodeId
                        && getSenseNodeKey(sceneNode?.data || {}) === targetVertexKey
                    )
                });
                const result = await fetchNodeDetail(targetNodeId, clickedNode, {
                    historyIndex: Math.max(0, (navigationPath?.length || 1) - 1),
                    requestSource: 'star-map-exit',
                    keepStarMapState: true,
                    silent: true,
                    activeSenseId: targetSenseId
                });
                if (result) {
                    clearStarMapState();
                }
            }
        };

        const handleWheel = (event) => {
            const deltaY = Number(event.deltaY) || 0;
            if (Math.abs(deltaY) < 16 || isStarMapLoading) return;

            if (knowledgeMainViewMode === KNOWLEDGE_MAIN_VIEW_MODE.MAIN && deltaY > 0) {
                event.preventDefault();
                enterStarMapMode();
                return;
            }

            if (knowledgeMainViewMode === KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP && deltaY < 0) {
                event.preventDefault();
                exitStarMapMode();
            }
        };

        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            canvas.removeEventListener('wheel', handleWheel);
        };
    }, [
        buildClickedNodeFromScene,
        clearStarMapState,
        currentNodeDetail,
        currentStarMapCenter,
        currentStarMapLimit,
        currentTitleDetail,
        fetchNodeDetail,
        fetchSenseStarMap,
        fetchTitleDetail,
        fetchTitleStarMap,
        isStarMapLoading,
        isWebGLReady,
        knowledgeMainViewMode,
        navigationPath,
        view
    ]);

    useEffect(() => {
        const transition = homeDetailTransitionRef.current;
        if (!transition || transition.status !== 'navigating') return undefined;
        if (!isWebGLReady || !sceneManagerRef.current || !webglCanvasRef.current) return undefined;
        if (!isKnowledgeDetailView(view)) return undefined;
        if (transition.targetMode && transition.targetMode !== view) return undefined;

        const targetNodeId = normalizeObjectId(transition.targetNodeId);
        const activeNodeId = view === 'titleDetail'
            ? normalizeObjectId(currentTitleDetail?._id)
            : normalizeObjectId(currentNodeDetail?._id);
        if (!targetNodeId || !activeNodeId || targetNodeId !== activeNodeId) return undefined;

        let rafId = 0;
        let attempts = 0;
        let cancelled = false;
        const locateTarget = () => {
            if (cancelled) return;
            const sceneManager = sceneManagerRef.current;
            const renderer = sceneManager?.renderer;
            const canvas = webglCanvasRef.current;
            const centerNode = Array.isArray(sceneManager?.currentLayout?.nodes)
                ? sceneManager.currentLayout.nodes.find((item) => (
                    item?.type === 'center'
                    && normalizeObjectId(item?.data?._id) === targetNodeId
                ))
                : null;

            if (!renderer || !canvas || !centerNode) {
                attempts += 1;
                if (attempts < 36) {
                    rafId = requestAnimationFrame(locateTarget);
                } else {
                    clearHomeDetailTransition({ immediate: true });
                }
                return;
            }

            const rect = canvas.getBoundingClientRect();
            const screenPos = renderer.worldToScreen(centerNode.x, centerNode.y);
            const radius = typeof renderer.getNodeScreenRadius === 'function'
                ? renderer.getNodeScreenRadius(centerNode)
                : Math.max(48, Number(centerNode.radius) || 80);
            renderer.setNodeRevealProgress(centerNode.id, 0.04);
            setHomeDetailTransition((prev) => {
                if (!prev || prev.runId !== transition.runId) return prev;
                return {
                    ...prev,
                    targetCenter: {
                        x: Math.round(rect.left + screenPos.x),
                        y: Math.round(rect.top + screenPos.y)
                    },
                    targetSize: Math.max(112, radius * 2.32),
                    targetLayoutNodeId: centerNode.id,
                    status: 'target-ready'
                };
            });
        };

        rafId = requestAnimationFrame(locateTarget);
        return () => {
            cancelled = true;
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
        };
    }, [
        clearHomeDetailTransition,
        currentNodeDetail?._id,
        currentTitleDetail?._id,
        isWebGLReady,
        view
    ]);

    useEffect(() => {
        const status = homeDetailTransition.status;
        if (view === 'home' && !isSenseSelectorVisible && status === 'armed') {
            clearHomeDetailTransition({ immediate: true });
            return;
        }
        if (status === 'idle' || status === 'done') return;
        if (view !== 'home' && !isKnowledgeDetailView(view)) {
            clearHomeDetailTransition({ immediate: true });
        }
    }, [clearHomeDetailTransition, homeDetailTransition.status, isSenseSelectorVisible, view]);

    useEffect(() => {
        const status = homeDetailTransition.status;
        if (status === 'idle' || status === 'done') return undefined;
        const handleResize = () => {
            const current = homeDetailTransitionRef.current;
            if (current?.targetLayoutNodeId && sceneManagerRef.current?.renderer) {
                sceneManagerRef.current.renderer.setNodeRevealProgress(current.targetLayoutNodeId, 1);
            }
            clearHomeDetailTransition({ immediate: true });
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [clearHomeDetailTransition, homeDetailTransition.status]);

    useEffect(() => {
        if (!sceneManagerRef.current) return;
        if (knowledgeMainViewMode === KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP) {
            sceneManagerRef.current.clearNodeButtons();
            return;
        }
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
	    // eslint-disable-next-line react-hooks/exhaustive-deps
	    }, [view, currentNodeDetail, currentTitleDetail, knowledgeMainViewMode, isAdmin, userId, username, userLocation, travelStatus.isTraveling, travelStatus.isStopping, relatedDomainsData.favoriteDomains, nodeDistributionStatus, intelHeistStatus, siegeStatus]);

    useEffect(() => {
        if (!isWebGLReady) {
            setSenseSelectorAnchor({ x: 0, y: 0, visible: false });
            senseSelectorAnchorRef.current = { x: 0, y: 0, visible: false };
            setSenseSelectorSourceSceneNodeId('');
            setIsSenseSelectorVisible(false);
            return undefined;
        }
        if (!isKnowledgeDetailView(view) && view !== 'home') {
            setSenseSelectorAnchor({ x: 0, y: 0, visible: false });
            senseSelectorAnchorRef.current = { x: 0, y: 0, visible: false };
            setSenseSelectorSourceSceneNodeId('');
            setIsSenseSelectorVisible(false);
            return undefined;
        }
        if (view === 'home' && !isSenseSelectorVisible) return undefined;

        const updateAnchor = () => {
            const sceneManager = sceneManagerRef.current;
            const renderer = sceneManager?.renderer;
            const sceneNodes = Array.isArray(sceneManager?.currentLayout?.nodes)
                ? sceneManager.currentLayout.nodes
                : [];
            const targetNode = view === 'home'
                ? (
                    sceneNodes.find((item) => (
                        String(item?.id || '') === String(senseSelectorSourceSceneNodeId || '')
                    ))
                    || sceneNodes.find((item) => (
                        normalizeObjectId(item?.data?._id) === normalizeObjectId(senseSelectorSourceNode?._id)
                    ))
                )
                : sceneNodes.find((item) => item?.type === 'center');
            const canvas = webglCanvasRef.current;
            if (renderer && targetNode && canvas) {
                const screenPos = renderer.worldToScreen(targetNode.x, targetNode.y);
                const rect = canvas.getBoundingClientRect();
                const next = {
                    x: Math.round(rect.left + screenPos.x),
                    y: Math.round(rect.top + screenPos.y),
                    visible: true
                };
                const prev = senseSelectorAnchorRef.current || { x: 0, y: 0, visible: false };
                const moved = Math.abs(prev.x - next.x) > 1 || Math.abs(prev.y - next.y) > 1 || prev.visible !== next.visible;
                if (moved) {
                    senseSelectorAnchorRef.current = next;
                    setSenseSelectorAnchor(next);
                }
            }
        };

        updateAnchor();
        window.addEventListener('resize', updateAnchor);
        return () => {
            window.removeEventListener('resize', updateAnchor);
        };
    }, [
        view,
        currentNodeDetail?._id,
        currentNodeDetail?.activeSenseId,
        currentTitleDetail?._id,
        senseSelectorSourceNode?._id,
        senseSelectorSourceSceneNodeId,
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

    useEffect(() => {
        if (view !== 'home' || !isSenseSelectorVisible) return undefined;

        const handleDocumentPointerDown = (event) => {
            if (senseSelectorPanelRef.current?.contains(event.target)) {
                return;
            }
            setIsSenseSelectorVisible(false);
        };

        document.addEventListener('pointerdown', handleDocumentPointerDown);
        return () => {
            document.removeEventListener('pointerdown', handleDocumentPointerDown);
        };
    }, [isSenseSelectorVisible, view]);

    useEffect(() => {
        if (!isSenseSelectorVisible || (view !== 'home' && view !== 'nodeDetail' && view !== 'titleDetail')) {
            setSenseSelectorOverviewLoading(false);
            setSenseSelectorOverviewError('');
            return undefined;
        }

        const selectorNode = (
            (view === 'titleDetail' && currentTitleDetail)
            || (view === 'nodeDetail' && currentNodeDetail)
            || senseSelectorSourceNode
            || null
        );
        const nodeId = normalizeObjectId(selectorNode?._id);
        if (!nodeId) {
            setSenseSelectorOverviewNode(null);
            setSenseSelectorOverviewLoading(false);
            setSenseSelectorOverviewError('');
            return undefined;
        }

        const detailNodeId = normalizeObjectId(currentNodeDetail?._id);
        const requestedSenseId = (
            view === 'nodeDetail'
            && detailNodeId
            && detailNodeId === nodeId
            && typeof currentNodeDetail?.activeSenseId === 'string'
        )
            ? currentNodeDetail.activeSenseId.trim()
            : (typeof selectorNode?.activeSenseId === 'string' ? selectorNode.activeSenseId.trim() : '');
        if (
            view === 'nodeDetail'
            && detailNodeId
            && detailNodeId === nodeId
            && currentNodeDetail
        ) {
            setSenseSelectorOverviewNode(currentNodeDetail);
            setSenseSelectorOverviewLoading(false);
            setSenseSelectorOverviewError('');
            return undefined;
        }

        setSenseSelectorOverviewNode((prev) => (
            normalizeObjectId(prev?._id) === nodeId
                ? prev
                : selectorNode
        ));
        setSenseSelectorOverviewLoading(true);
        setSenseSelectorOverviewError('');

        let cancelled = false;
        (async () => {
            try {
                const detailUrl = requestedSenseId
                    ? `${API_BASE}/nodes/public/node-detail/${nodeId}?senseId=${encodeURIComponent(requestedSenseId)}`
                    : `${API_BASE}/nodes/public/node-detail/${nodeId}`;
                const response = await fetch(detailUrl);
                const rawText = await response.text();
                let data = null;
                try {
                    data = rawText ? JSON.parse(rawText) : null;
                } catch (error) {
                    data = null;
                }
                if (cancelled) return;
                if (!response.ok || !data?.node) {
                    const fallback = `读取标题总览失败（HTTP ${response.status}）`;
                    setSenseSelectorOverviewError(data?.error || data?.message || fallback);
                    setSenseSelectorOverviewLoading(false);
                    return;
                }
                setSenseSelectorOverviewNode(data.node);
                setSenseSelectorOverviewLoading(false);
                setSenseSelectorOverviewError('');
            } catch (error) {
                if (cancelled) return;
                setSenseSelectorOverviewLoading(false);
                setSenseSelectorOverviewError(error?.message ? `读取标题总览失败: ${error.message}` : '读取标题总览失败');
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        isSenseSelectorVisible,
        view,
        currentNodeDetail,
        currentTitleDetail,
        senseSelectorSourceNode
    ]);

    useEffect(() => {
        if (!isSenseSelectorVisible) return undefined;
        const overviewNode = senseSelectorOverviewNode || currentNodeDetail || currentTitleDetail || senseSelectorSourceNode || null;
        const nodeId = normalizeObjectId(overviewNode?._id || overviewNode?.nodeId);
        if (!nodeId) return undefined;

        const senses = Array.isArray(overviewNode?.synonymSenses) && overviewNode.synonymSenses.length > 0
            ? overviewNode.synonymSenses
            : [{ senseId: overviewNode?.activeSenseId || 'sense_1' }];
        const pendingTargets = senses
            .map((sense) => {
                const senseId = typeof sense?.senseId === 'string' ? sense.senseId.trim() : '';
                if (!senseId) return null;
                const key = `${nodeId}:${senseId}`;
                const cached = senseArticleEntryStatusMapRef.current[key];
                if (cached?.resolved || cached?.loading) return null;
                return { key, nodeId, senseId };
            })
            .filter(Boolean);
        if (pendingTargets.length === 0) return undefined;

        setSenseArticleEntryStatusMap((prev) => {
            let hasChanges = false;
            const next = { ...prev };
            pendingTargets.forEach(({ key }) => {
                const previous = prev[key] || {};
                if (previous.loading && !previous.resolved) {
                    return;
                }
                next[key] = { ...previous, loading: true, resolved: false, hasPublishedRevision: false };
                hasChanges = true;
            });
            return hasChanges ? next : prev;
        });

        (async () => {
            const results = await Promise.all(pendingTargets.map(async ({ key, nodeId: targetNodeId, senseId }) => {
                try {
                    const data = await senseArticleApi.getOverview(targetNodeId, senseId);
                    return {
                        key,
                        hasPublishedRevision: !!data?.currentRevision?._id,
                        articleId: data?.article?._id || '',
                        currentRevisionId: data?.article?.currentRevisionId || data?.currentRevision?._id || ''
                    };
                } catch (_error) {
                    return {
                        key,
                        hasPublishedRevision: false,
                        articleId: '',
                        currentRevisionId: ''
                    };
                }
            }));
            setSenseArticleEntryStatusMap((prev) => {
                const next = { ...prev };
                results.forEach((item) => {
                    next[item.key] = {
                        loading: false,
                        resolved: true,
                        hasPublishedRevision: !!item.hasPublishedRevision,
                        articleId: item.articleId || '',
                        currentRevisionId: item.currentRevisionId || ''
                    };
                });
                return next;
            });
        })();
        return undefined;
	    }, [
	        currentNodeDetail,
	        currentTitleDetail,
	        isSenseSelectorVisible,
	        senseSelectorOverviewNode,
	        senseSelectorSourceNode
	    ]);


    // 新节点创建相关函数
    const openCreateNodeModal = () => {
        setShowCreateNodeModal(true);
    };

    const closeAssociationModal = () => {
        setShowAssociationModal(false);
    };

    const closeNodeInfoModal = () => {
        setShowNodeInfoModal(false);
        setNodeInfoModalTarget(null);
    };

    const closeCreateNodeModal = () => {
        setShowCreateNodeModal(false);
    };

    const handleCreateNodeSuccess = (newNode) => {
        if (newNode) {
            setNodes((prev) => [...prev, newNode]);
        }
    };

    // 进入知识域
    const handleEnterKnowledgeDomain = (node, options = {}) => {
        if (!sceneManagerRef.current || !node) return;
        const mode = options?.mode === 'intelHeist' ? 'intelHeist' : 'normal';

        const recentVisitMode = options?.recentVisitMode === 'title' || options?.recentVisitMode === 'sense'
            ? options.recentVisitMode
            : (isTitleBattleView(view) ? 'title' : 'sense');
        const recentVisitSenseId = recentVisitMode === 'sense'
            ? (typeof options?.recentVisitSenseId === 'string'
                ? options.recentVisitSenseId.trim()
                : (typeof node?.activeSenseId === 'string' ? node.activeSenseId : ''))
            : '';
        trackRecentDomain(node, {
            mode: recentVisitMode,
            senseId: recentVisitSenseId
        });
        knowledgeDomainReturnContextRef.current = (() => {
            const currentNodeId = normalizeObjectId(currentNodeDetail?._id);
            const currentTitleId = normalizeObjectId(currentTitleDetail?._id);
            const targetNodeId = normalizeObjectId(node?._id);
            if (view === 'nodeDetail' && currentNodeId) {
                return {
                    view: 'nodeDetail',
                    nodeId: currentNodeId,
                    senseId: typeof currentNodeDetail?.activeSenseId === 'string' ? currentNodeDetail.activeSenseId : ''
                };
            }
            if (view === 'titleDetail' && currentTitleId) {
                return {
                    view: 'titleDetail',
                    nodeId: currentTitleId,
                    senseId: ''
                };
            }
            if (!targetNodeId) return null;
            return {
                view: 'nodeDetail',
                nodeId: targetNodeId,
                senseId: typeof node?.activeSenseId === 'string' ? node.activeSenseId : ''
            };
        })();
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
        const returnContext = knowledgeDomainReturnContextRef.current;
        const restoreKnowledgeDomainView = async () => {
            if (!returnContext?.nodeId) return;
            if (returnContext.view === 'titleDetail') {
                await fetchTitleDetail(returnContext.nodeId, null, {
                    silent: true,
                    requestSource: 'knowledge-domain-restore:title'
                });
                return;
            }
            await fetchNodeDetail(returnContext.nodeId, null, {
                silent: true,
                activeSenseId: typeof returnContext.senseId === 'string' ? returnContext.senseId : '',
                requestSource: 'knowledge-domain-restore:sense'
            });
        };
        if (!sceneManagerRef.current) {
            setShowKnowledgeDomain(false);
            setDomainTransitionProgress(0);
            setKnowledgeDomainNode(null);
            setKnowledgeDomainMode('normal');
            knowledgeDomainReturnContextRef.current = null;
            restoreKnowledgeDomainView();
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
                knowledgeDomainReturnContextRef.current = null;
                restoreKnowledgeDomainView();
                if (exitMessage) {
                    window.alert(exitMessage);
                } else if (exitReason === 'intel-timeout') {
                    window.alert('情报窃取时间耗尽');
                }
            }
        );
    };

    const {
        openSenseArticleView,
        openSenseArticleFromNode,
        handleSenseArticleBack,
        handleOpenSenseArticleDashboard,
        handleOpenSenseArticleEditor,
        handleOpenSenseArticleHistory,
        handleOpenSenseArticleReview,
        handleSenseArticleNotificationClick,
        handleSwitchSenseView,
        handleSwitchTitleView
    } = useSenseArticleNavigation({
        view,
        setView,
        senseArticleContext,
        setSenseArticleContext,
        currentNodeDetail,
        currentTitleDetail,
        senseSelectorSourceNode,
        setShowNodeInfoModal,
        setNodeInfoModalTarget,
        setIsSenseSelectorVisible,
        prepareHomeDetailTransitionTarget,
        cancelHomeDetailTransition: () => clearHomeDetailTransition({ immediate: true }),
        buildClickedNodeFromScene,
        fetchTitleDetail,
        fetchNodeDetail,
        navigateToHomeWithDockCollapse,
        navigateSenseArticleSubView,
        markNotificationRead
    });

    // 如果需要显示位置选择弹窗，只显示弹窗，不显示其他内容
    if (authenticated && showLocationModal) {
        return (
            <LocationSelectionModal
                onConfirm={handleLocationConfirm}
                featuredNodes={featuredNodes}
                username={username}
                onLogout={handleLogout}
            />
        );
    }

    if (view === 'login') {
        return <Login onLogin={handleLoginSuccess} />;
    }

    const isKnowledgeDomainActive = showKnowledgeDomain || isTransitioningToDomain;
    const headerLevel = Number.isFinite(Number(headerUserStats.level)) ? Math.max(0, Math.floor(Number(headerUserStats.level))) : 0;
    const headerExperience = Number.isFinite(Number(headerUserStats.experience)) ? Math.max(0, Math.floor(Number(headerUserStats.experience))) : 0;
    const headerExpTarget = Math.max(100, (headerLevel + 1) * 100);
    const headerExpProgress = Math.max(0, Math.min(100, (headerExperience / headerExpTarget) * 100));
    const headerArmyCount = Number.isFinite(Number(headerUserStats.armyCount)) ? Math.max(0, Math.floor(Number(headerUserStats.armyCount))) : 0;
    const headerKnowledgeBalance = Number.isFinite(Number(headerUserStats.knowledgeBalance))
      ? Math.max(0, Number(headerUserStats.knowledgeBalance))
      : 0;

    return (
        <div
            className={`game-container ${isKnowledgeDomainActive ? 'knowledge-domain-active' : ''} ${isSenseSelectorVisible ? 'sense-selector-open' : ''} ${view === 'home' ? 'home-view-active' : ''} ${(view === 'titleDetail' || view === 'nodeDetail') ? 'knowledge-mainview-active' : ''} ${isSenseArticleSubView(view) ? 'sense-article-shell-active' : ''} ${isSenseArticleHeaderPinned ? 'sense-article-shell-pinned' : ''}`}
            style={{
              '--knowledge-header-offset': `${knowledgeHeaderOffset}px`,
              '--knowledge-domain-top-offset': isKnowledgeDomainActive ? `${knowledgeHeaderOffset}px` : '0px'
            }}
        >
            <div className="game-content">
                <AppShellChrome
                    headerRef={headerRef}
                    isKnowledgeDomainActive={isKnowledgeDomainActive}
                    isCompact={isSenseArticleSubView(view) && isSenseArticleHeaderPinned}
                    profession={profession}
                    username={username}
                    userAvatar={userAvatar}
                    headerLevel={headerLevel}
                    headerExpProgress={headerExpProgress}
                    headerExperience={headerExperience}
                    headerExpTarget={headerExpTarget}
                    headerArmyCount={headerArmyCount}
                    headerKnowledgeBalance={headerKnowledgeBalance}
                    handleLogout={handleLogout}
                    notificationsWrapperRef={notificationsWrapperRef}
                    toggleNotificationsPanel={toggleNotificationsPanel}
                    notificationBadgeCount={notificationBadgeCount}
                    showNotificationsPanel={showNotificationsPanel}
                    fetchNotifications={fetchNotifications}
                    isAdmin={isAdmin}
                    fetchAdminPendingNodeReminders={fetchAdminPendingNodeReminders}
                    adminPendingNodes={adminPendingNodes}
                    pendingMasterApplyCount={pendingMasterApplyCount}
                    notifications={notifications}
                    markAllNotificationsRead={markAllNotificationsRead}
                    isNotificationsLoading={isNotificationsLoading}
                    isMarkingAllRead={isMarkingAllRead}
                    notificationUnreadCount={notificationUnreadCount}
                    clearNotifications={clearNotifications}
                    isClearingNotifications={isClearingNotifications}
                    formatNotificationTime={formatNotificationTime}
                    setShowNotificationsPanel={setShowNotificationsPanel}
                    openAdminPanel={openAdminPanel}
                    notificationActionId={notificationActionId}
                    handleDistributionAnnouncementClick={handleDistributionAnnouncementClick}
                    handleArrivalNotificationClick={handleArrivalNotificationClick}
                    handleSenseArticleNotificationClick={handleSenseArticleNotificationClick}
                    markNotificationRead={markNotificationRead}
                    respondDomainAdminInvite={respondDomainAdminInvite}
                    relatedDomainsWrapperRef={relatedDomainsWrapperRef}
                    toggleRelatedDomainsPanel={toggleRelatedDomainsPanel}
                    relatedDomainCount={relatedDomainCount}
                    showRelatedDomainsPanel={showRelatedDomainsPanel}
                    relatedDomainsData={relatedDomainsData}
                    domainMasterDomains={domainMasterDomains}
                    domainAdminDomains={domainAdminDomains}
                    favoriteDomains={favoriteDomains}
                    recentDomains={recentDomains}
                    favoriteDomainSet={favoriteDomainSet}
                    favoriteActionDomainId={favoriteActionDomainId}
                    fetchRelatedDomains={fetchRelatedDomains}
                    handleOpenRelatedDomain={handleOpenRelatedDomain}
                    toggleFavoriteDomain={toggleFavoriteDomain}
                    formatDomainKnowledgePoint={formatDomainKnowledgePoint}
                    closeHeaderPanels={closeHeaderPanels}
                    navigateToHomeWithDockCollapse={navigateToHomeWithDockCollapse}
                    handleHeaderHomeNavigation={handleHeaderHomeNavigation}
                    prepareForPrimaryNavigation={prepareForPrimaryNavigation}
                    setView={setView}
                    militaryMenuWrapperRef={militaryMenuWrapperRef}
                    toggleMilitaryMenu={toggleMilitaryMenu}
                    showMilitaryMenu={showMilitaryMenu}
                    setShowMilitaryMenu={setShowMilitaryMenu}
                    showKnowledgeDomain={showKnowledgeDomain}
                    isTransitioningToDomain={isTransitioningToDomain}
                    view={view}
                    currentTitleDetail={currentTitleDetail}
                    currentNodeDetail={currentNodeDetail}
                    isAnnouncementDockExpanded={isAnnouncementDockExpanded}
                    setIsAnnouncementDockExpanded={setIsAnnouncementDockExpanded}
                    announcementDockTab={announcementDockTab}
                    setAnnouncementDockTab={setAnnouncementDockTab}
                    isMarkingAnnouncementsRead={isMarkingAnnouncementsRead}
                    announcementUnreadCount={announcementUnreadCount}
                    markAnnouncementNotificationsRead={markAnnouncementNotificationsRead}
                    allianceAnnouncements={allianceAnnouncements}
                    systemAnnouncements={systemAnnouncements}
                    handleHomeAnnouncementClick={handleHomeAnnouncementClick}
                    isLocationDockExpanded={isLocationDockExpanded}
                    setIsLocationDockExpanded={setIsLocationDockExpanded}
                    travelStatus={travelStatus}
                    currentLocationNodeDetail={currentLocationNodeDetail}
                    userLocation={userLocation}
                    handleRefreshLocationNodeDetail={handleRefreshLocationNodeDetail}
                    isRefreshingLocationDetail={isRefreshingLocationDetail}
                    formatTravelSeconds={formatTravelSeconds}
                    handleOpenTravelNode={handleOpenTravelNode}
                    stopTravel={stopTravel}
                    isStoppingTravel={isStoppingTravel}
                    siegeSupportStatuses={siegeSupportStatuses}
                    handleJumpToCurrentLocationView={handleJumpToCurrentLocationView}
                    showDistributionPanel={showDistributionPanel}
                    distributionPanelState={distributionPanelState}
                    closeDistributionPanel={closeDistributionPanel}
                    joinDistributionFromPanel={joinDistributionFromPanel}
                    exitDistributionFromPanel={exitDistributionFromPanel}
                />

                <KnowledgeViewRouter
                    view={view}
                    webglCanvasRef={webglCanvasRef}
                    navigationPath={navigationPath}
                    currentTitleDetail={currentTitleDetail}
                    titleGraphData={titleGraphData}
                    currentNodeDetail={currentNodeDetail}
                    knowledgeMainViewMode={knowledgeMainViewMode}
                    titleStarMapData={titleStarMapData}
                    nodeStarMapData={nodeStarMapData}
                    currentStarMapLimit={currentStarMapLimit}
                    isStarMapLoading={isStarMapLoading}
                    titleRelationInfo={titleRelationInfo}
                    onCloseTitleRelationInfo={() => setTitleRelationInfo(null)}
                    searchQuery={homeSearchQuery}
                    onSearchChange={handleKnowledgeSearchChange}
                    onSearchFocus={handleKnowledgeSearchFocus}
                    onSearchClear={handleKnowledgeSearchClear}
                    searchResults={homeSearchResults}
                    showSearchResults={showSearchResults}
                    isSearching={isSearching}
                    onHomeSearchResultClick={handleHomeKnowledgeSearchResultClick}
                    onDetailSearchResultClick={handleDetailKnowledgeSearchResultClick}
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
                    onTitleNavigate={handleTitleDetailNavigate}
                    onNodeNavigate={handleNodeDetailNavigate}
                    onNavigateHistory={handleKnowledgeNavigateHistory}
                    onHome={handleKnowledgeHome}
                    onOpenCurrentNodeInfo={handleOpenCurrentNodeInfo}
                    openSenseArticleFromNode={openSenseArticleFromNode}
                    rootNodes={rootNodes}
                    featuredNodes={featuredNodes}
                    onHomeDomainActivate={handleHomeDomainActivate}
                    activeHomeNodeId={view === 'home' && isSenseSelectorVisible ? normalizeObjectId(senseSelectorSourceNode?._id) : ''}
                />
                <SenseArticleViewRouter
                    view={view}
                    senseArticleContext={senseArticleContext}
                    patchSenseArticleContext={patchSenseArticleContext}
                    handleSenseArticleBack={handleSenseArticleBack}
                    handleOpenSenseArticleEditor={handleOpenSenseArticleEditor}
                    handleOpenSenseArticleHistory={handleOpenSenseArticleHistory}
                    handleOpenSenseArticleDashboard={handleOpenSenseArticleDashboard}
                    handleOpenSenseArticleReview={handleOpenSenseArticleReview}
                    navigateSenseArticleSubView={navigateSenseArticleSubView}
                    fetchNotifications={fetchNotifications}
                    openSenseArticleView={openSenseArticleView}
                />
                <SenseSelectorPanel
                    view={view}
                    currentTitleDetail={currentTitleDetail}
                    currentNodeDetail={currentNodeDetail}
                    senseSelectorSourceNode={senseSelectorSourceNode}
                    isSenseSelectorVisible={isSenseSelectorVisible}
                    senseSelectorAnchor={senseSelectorAnchor}
                    panelRef={senseSelectorPanelRef}
                    senseSelectorOverviewNode={senseSelectorOverviewNode}
                    senseSelectorOverviewLoading={senseSelectorOverviewLoading}
                    senseSelectorOverviewError={senseSelectorOverviewError}
                    senseArticleEntryStatusMap={senseArticleEntryStatusMap}
                    handleSwitchTitleView={handleSwitchTitleView}
                    handleSwitchSenseView={handleSwitchSenseView}
                    openSenseArticleFromNode={openSenseArticleFromNode}
                />
                <TransitionGhostLayer
                    transition={homeDetailTransition}
                    onStatusChange={handleGhostStatusChange}
                    onSettleProgress={handleGhostSettleProgress}
                    onSettleComplete={handleGhostSettleComplete}
                />
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
                        onCreateNode={openCreateNodeModal}
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
                {view === "equipment" && !isAdmin && (
                    <ArmyPanel initialLibraryTab="equipment" mode="library" />
                )}
                {view === "trainingGround" && !isAdmin && (
                    <TrainingGroundPanel onExit={navigateToHomeWithDockCollapse} />
                )}

                {view !== "home" &&
                 !(view === "nodeDetail" && currentNodeDetail) &&
                 !(view === "titleDetail" && currentTitleDetail) &&
                 view !== "alliance" &&
                 !(view === "admin" && isAdmin) &&
                 view !== "profile" &&
                 !(view === "army" && !isAdmin) &&
                 !(view === "equipment" && !isAdmin) &&
                 !(view === "trainingGround" && !isAdmin) &&
                 !isSenseArticleSubView(view) && (
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

                <AppOverlays
                    intelHeistDialog={intelHeistDialog}
                    closeIntelHeistDialog={closeIntelHeistDialog}
                    formatDateTimeText={formatDateTimeText}
                    getElapsedMinutesText={getElapsedMinutesText}
                    intelHeistStatus={intelHeistStatus}
                    startIntelHeistMiniGame={startIntelHeistMiniGame}
                    currentTitleDetail={currentTitleDetail}
                    currentNodeDetail={currentNodeDetail}
                    siegeDialog={siegeDialog}
                    resetSiegeDialog={resetSiegeDialog}
                    isSiegeDomainMasterViewer={isSiegeDomainMasterViewer}
                    isSiegeDomainAdminViewer={isSiegeDomainAdminViewer}
                    siegeStatus={siegeStatus}
                    siegeActiveGateRows={siegeActiveGateRows}
                    requestSiegeSupport={requestSiegeSupport}
                    siegeBattlefieldPreviewState={siegeBattlefieldPreviewState}
                    canPreviewSiegeBattlefield={canPreviewSiegeBattlefield}
                    handleOpenSiegeBattlefieldPreview={handleOpenSiegeBattlefieldPreview}
                    siegeSupportDraft={siegeSupportDraft}
                    setSiegeSupportDraft={setSiegeSupportDraft}
                    submitSiegeSupport={submitSiegeSupport}
                    startSiege={startSiege}
                    isSiegeReadonlyViewer={isSiegeReadonlyViewer}
                    canLaunchSiegePveBattle={canLaunchSiegePveBattle}
                    handleOpenSiegePveBattle={handleOpenSiegePveBattle}
                    retreatSiege={retreatSiege}
                    pveBattleState={pveBattleState}
                    closeSiegePveBattle={closeSiegePveBattle}
                    handlePveBattleFinished={handlePveBattleFinished}
                    closeSiegeBattlefieldPreview={closeSiegeBattlefieldPreview}
                    showAssociationModal={showAssociationModal}
                    closeAssociationModal={closeAssociationModal}
                    viewingAssociationNode={viewingAssociationNode}
                    showNodeInfoModal={showNodeInfoModal}
                    closeNodeInfoModal={closeNodeInfoModal}
                    nodeInfoModalTarget={nodeInfoModalTarget}
                    handleEnterKnowledgeDomain={handleEnterKnowledgeDomain}
                    openSenseArticleFromNode={openSenseArticleFromNode}
                    canApplyDomainMaster={canApplyDomainMaster}
                    isApplyingDomainMaster={isApplyingDomainMaster}
                    handleApplyDomainMaster={handleApplyDomainMaster}
                    showCreateNodeModal={showCreateNodeModal}
                    closeCreateNodeModal={closeCreateNodeModal}
                    username={username}
                    isAdmin={isAdmin}
                    nodes={nodes}
                    sceneManager={sceneManagerRef.current}
                    handleCreateNodeSuccess={handleCreateNodeSuccess}
                />

                {/* 知识域场景 */}
                <KnowledgeDomainScene
                    node={knowledgeDomainNode}
                    isVisible={showKnowledgeDomain || isTransitioningToDomain}
                    onExit={handleExitKnowledgeDomain}
                    transitionProgress={domainTransitionProgress}
                    mode={knowledgeDomainMode}
                    onIntelSnapshotCaptured={handleIntelHeistSnapshotCaptured}
                />
                <SystemConfirmDialog
                    open={systemConfirmState.open}
                    title={systemConfirmState.title}
                    message={systemConfirmState.message}
                    confirmText={systemConfirmState.confirmText}
                    confirmTone={systemConfirmState.confirmTone}
                    onClose={() => setSystemConfirmState({
                        open: false,
                        title: '',
                        message: '',
                        confirmText: '确认',
                        confirmTone: 'danger',
                        onConfirm: null
                    })}
                    onConfirm={() => systemConfirmState.onConfirm && systemConfirmState.onConfirm()}
                />
            </div>
        </div>
    );
};

export default App;
