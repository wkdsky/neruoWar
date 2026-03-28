import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
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
import useLocationTravel from './hooks/app/useLocationTravel';
import useAppSession from './hooks/app/useAppSession';
import useAppPageState from './hooks/app/useAppPageState';
import useAppRuntimeStatus from './hooks/app/useAppRuntimeStatus';
import useBattleStatusPolling from './hooks/app/useBattleStatusPolling';
import useHomeDetailTransition from './hooks/app/useHomeDetailTransition';
import useKnowledgeDomainTransition from './hooks/app/useKnowledgeDomainTransition';
import useKnowledgeEntryActions from './hooks/app/useKnowledgeEntryActions';
import useKnowledgeNavigation from './hooks/app/useKnowledgeNavigation';
import useKnowledgeSearch from './hooks/app/useKnowledgeSearch';
import useSenseSelector from './hooks/app/useSenseSelector';
import useStarMapNavigation from './hooks/app/useStarMapNavigation';
import useAppSocket from './hooks/app/useAppSocket';
import {
    buildSenseArticleSubViewContext,
    createSenseArticleContext,
    areSenseArticleContextsEqual
} from './components/senseArticle/senseArticleNavigation';
import { API_BASE } from './runtimeConfig';
import { isSenseEditorDebugEnabled } from './components/senseArticle/editor/editorDebug';
import {
    CITY_GATE_LABEL_MAP,
    PAGE_STATE_STORAGE_KEY,
    SENSE_EDITOR_PREVIEW_RESIZE_CLASS,
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
    isKnowledgeDetailView,
    isMapDebugEnabled,
    isSenseArticleSubView,
    isTitleBattleView,
    normalizeObjectId,
    } from './app/appShared';
import useNotificationCenter from './hooks/useNotificationCenter';
import useAppShellState from './hooks/useAppShellState';
import useChatCenter from './hooks/useChatCenter';
import { UserCardProvider } from './components/social/UserCardContext';
import {
    DEFAULT_STAR_MAP_LIMIT,
    KNOWLEDGE_MAIN_VIEW_MODE,
    STAR_MAP_LAYER,
    getSenseNodeKey,
    toSenseVertexKey
} from './starMap/starMapHelpers';

const PRIMARY_NAVIGATION_TIMEOUT_MS = 10000;
const PRIMARY_NAVIGATION_RETRY_DELAYS_MS = [250, 700];
const createDefaultStarMapZoomState = () => ({
    min: 0.22,
    max: 1.12,
    value: 1,
    defaultValue: 1
});
const normalizeStarMapZoomState = (state = {}) => {
    const min = Number.isFinite(Number(state?.min)) ? Number(state.min) : 0.22;
    const max = Number.isFinite(Number(state?.max)) ? Number(state.max) : 1.12;
    const safeMax = Math.max(min, max);
    const defaultValue = Number.isFinite(Number(state?.defaultValue)) ? Number(state.defaultValue) : 1;
    const value = Number.isFinite(Number(state?.value)) ? Number(state.value) : defaultValue;
    return {
        min,
        max: safeMax,
        defaultValue: Math.max(min, Math.min(safeMax, defaultValue)),
        value: Math.max(min, Math.min(safeMax, value))
    };
};
const App = () => {
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
    const isRestoringPageRef = useRef(false);
    const hasRestoredPageRef = useRef(false);
    const travelStatusRef = useRef({ isTraveling: false, isStopping: false });
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminEntryTab, setAdminEntryTab] = useState('users');
    const { socket, initializeSocket, cleanupSocket } = useAppSocket({
        setAuthenticated,
        setNodes,
        setTechnologies
    });

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
    const [starMapZoomState, setStarMapZoomState] = useState(createDefaultStarMapZoomState);
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

    const headerRef = useRef(null);
    const notificationsWrapperRef = useRef(null);
    const relatedDomainsWrapperRef = useRef(null);
    const militaryMenuWrapperRef = useRef(null);
    const senseSelectorPanelRef = useRef(null);
    const knowledgeDomainReturnContextRef = useRef(null);
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

    const syncStarMapZoomState = useCallback((nextState = null) => {
        const resolved = nextState
            ? normalizeStarMapZoomState(nextState)
            : normalizeStarMapZoomState(sceneManagerRef.current?.getStarMapZoomState?.());
        setStarMapZoomState((prev) => {
            if (
                prev.min === resolved.min
                && prev.max === resolved.max
                && prev.value === resolved.value
                && prev.defaultValue === resolved.defaultValue
            ) {
                return prev;
            }
            return resolved;
        });
        return resolved;
    }, []);

    const handleStarMapZoomChange = useCallback((nextValue) => {
        const sceneManager = sceneManagerRef.current;
        if (!sceneManager?.setStarMapZoom) return;
        const resolved = sceneManager.setStarMapZoom(nextValue);
        if (resolved) {
            syncStarMapZoomState(resolved);
        }
    }, [syncStarMapZoomState]);
    const [knowledgeHeaderOffset, setKnowledgeHeaderOffset] = useState(92);
    const [isSenseArticleHeaderPinned, setIsSenseArticleHeaderPinned] = useState(false);

    const {
        homeDetailTransition,
        clearHomeDetailTransition,
        armHomeDetailTransition,
        prepareHomeDetailTransitionTarget,
        handleGhostStatusChange,
        handleGhostSettleProgress,
        handleGhostSettleComplete
    } = useHomeDetailTransition({
        featuredNodes,
        isWebGLReady,
        sceneManagerRef,
        webglCanvasRef,
        view,
        currentTitleDetail,
        currentNodeDetail,
        isSenseSelectorVisible
    });

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
            sceneManager.onStarMapViewportChange = (nextState) => {
                syncStarMapZoomState(nextState);
            };

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
    }, [syncStarMapZoomState, view]);

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

  const closeSystemConfirm = useCallback(() => {
    setSystemConfirmState({
      open: false,
      title: '',
      message: '',
      confirmText: '确认',
      confirmTone: 'danger',
      onConfirm: null
    });
  }, []);

  const openSystemConfirm = useCallback((payload = {}) => {
    setSystemConfirmState({
      open: true,
      title: '',
      message: '',
      confirmText: '确认',
      confirmTone: 'danger',
      onConfirm: null,
      ...payload
    });
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
    updateUserLocation,
    fetchLocationNodeDetail,
    syncUserLocation,
    estimateTravelToNode,
    startTravelToNode,
    stopTravel
  } = useLocationTravel({
    userLocation,
    isStoppingTravel,
    nodes,
    parseApiResponse,
    getApiErrorMessage,
    applyTravelStatus,
    setUserLocation,
    setCurrentLocationNodeDetail,
    setIsRefreshingLocationDetail,
    setIsStoppingTravel
  });

  const {
    searchQuery: homeSearchQuery,
    searchResults: homeSearchResults,
    isSearching,
    showSearchResults,
    handleKnowledgeSearchChange,
    handleKnowledgeSearchFocus,
    handleKnowledgeSearchClear,
    closeKnowledgeSearchResults,
    resetKnowledgeSearch
  } = useKnowledgeSearch({
    view
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

  const {
    activeSidebarTab,
    chatBadgeCount,
    chatToasts,
    conversationActionId,
    conversationListLoading,
    conversations,
    currentUserId: chatCurrentUserId,
    dismissChatToast,
    friendActionId,
    friendListLoading,
    friendRequests,
    friendSearchLoading,
    friendSearchQuery,
    friendSearchResults,
    friends,
    hideConversation,
    isChatDockExpanded,
    loadOlderMessages,
    openConversation,
    openDirectConversation,
    panelNotice,
    requestActionId,
    requestFriendship,
    requestListLoading,
    resetChatCenter,
    respondToFriendRequest,
    searchUsers,
    selectedConversation,
    selectedMessagesEntry,
    sendMessage,
    setActiveSidebarTab,
    setFriendSearchQuery,
    setIsChatDockExpanded,
    setPanelNotice
  } = useChatCenter({
    authenticated,
    currentUserId: userId,
    socket,
    parseApiResponse,
    getApiErrorMessage
  });

  const handleChatToastAction = useCallback(async (toast) => {
    if (!toast) return;

    setIsAnnouncementDockExpanded(false);
    setIsLocationDockExpanded(false);
    setIsChatDockExpanded(true);

    if (toast.kind === 'conversation' && toast.conversationId) {
      setActiveSidebarTab('conversations');
      await openConversation(toast.conversationId);
    } else {
      setActiveSidebarTab('requests');
    }

    dismissChatToast(toast.id);
  }, [
    dismissChatToast,
    openConversation,
    setActiveSidebarTab,
    setIsAnnouncementDockExpanded,
    setIsChatDockExpanded,
    setIsLocationDockExpanded
  ]);

  const handleOpenDirectConversationFromUserCard = useCallback(async (targetUserId) => {
    if (!targetUserId) return null;
    setIsChatDockExpanded(true);
    return openDirectConversation(targetUserId);
  }, [openDirectConversation, setIsChatDockExpanded]);

  const handleSendFriendRequestFromUserCard = useCallback(async (targetUserId) => {
    if (!targetUserId) return null;
    setIsChatDockExpanded(true);
    return requestFriendship({ targetUserId });
  }, [requestFriendship, setIsChatDockExpanded]);

  const handleOpenFriendRequestsFromUserCard = useCallback(() => {
    setIsChatDockExpanded(true);
    setActiveSidebarTab('requests');
  }, [setActiveSidebarTab, setIsChatDockExpanded]);

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
    resetKnowledgeSearch();
    clearHomeDetailTransition({ immediate: true });
    closeHeaderPanels();
    resetDistributionState();
    setIsLocationDockExpanded(false);
    setIsAnnouncementDockExpanded(false);
    if (clearHomeCollections) {
      setRootNodes([]);
      setFeaturedNodes([]);
    }
  }

  const {
    fetchTravelStatus,
    fetchSiegeSupportStatuses
  } = useAppRuntimeStatus({
    authenticated,
    isAdmin,
    socket,
    parseApiResponse,
    getApiErrorMessage,
    syncUserLocation,
    applyTravelStatus,
    fetchLocationNodeDetail,
    isLocationDockExpandedRef,
    travelStatusRef,
    fetchNotifications,
    fetchAdminPendingNodeReminders,
    setHeaderUserStats,
    setTravelStatus,
    setSiegeSupportStatuses
  });

  const trackRecentDomain = useCallback(async (nodeOrId, options = {}) => {
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
  }, []);

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

  const handleMoveToNode = useCallback(async (targetNode, options = {}) => {
    if (!targetNode || !targetNode._id) return;
    const promptMode = options?.promptMode === 'distribution' ? 'distribution' : 'default';
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
      setIsAnnouncementDockExpanded(false);
      setIsLocationDockExpanded(true);
    }
    if (startResult === 'started') {
      return true;
    }
    return startResult === 'queued';
  }, [
    closeHeaderPanels,
    estimateTravelToNode,
    isAdmin,
    setIsAnnouncementDockExpanded,
    setIsLocationDockExpanded,
    startTravelToNode,
    travelStatus,
    userLocation
  ]);

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

  useBattleStatusPolling({
    authenticated,
    isAdmin,
    view,
    currentTitleDetail,
    userLocation,
    travelStatus,
    showDistributionPanel,
    siegeDialog,
    fetchDistributionParticipationStatus,
    resetDistributionState,
    closeDistributionPanel,
    fetchSiegeStatus,
    clearSiegeStatus
  });

    // 获取根节点
    const fetchRootNodes = useCallback(async () => {
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
    }, [getApiErrorMessage, parseApiResponse]);

    // 获取热门节点
    const fetchFeaturedNodes = useCallback(async () => {
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
    }, [getApiErrorMessage, parseApiResponse]);

    const { handleLoginSuccess, handleLogout } = useAppSession({
        authenticated,
        hasRestoredPageRef,
        isRestoringPageRef,
        initializeSocket,
        cleanupSocket,
        resetAppNavigationStateToHome,
        applyTravelStatus,
        fetchTravelStatus,
        fetchFeaturedNodes,
        updateUserLocation,
        resetNotificationCenter,
        resetChatCenter,
        resetAppShellState,
        resetDistributionState,
        resetDomainConflictState,
        setAuthenticated,
        setUserId,
        setUsername,
        setProfession,
        setUserLocation,
        setUserAvatar,
        setIsAdmin,
        setView,
        setShowLocationModal,
        setAdminEntryTab,
        setIsStoppingTravel,
        setIsApplyingDomainMaster,
        setCurrentLocationNodeDetail,
        setSelectedLocationNode,
        setSiegeSupportStatuses,
        setNodes
    });

    const formatTravelSeconds = (seconds) => {
        if (!Number.isFinite(seconds) || seconds <= 0) return '0 秒';
        const rounded = Math.round(seconds);
        const mins = Math.floor(rounded / 60);
        const remain = rounded % 60;
        if (mins <= 0) return `${remain} 秒`;
        return `${mins} 分 ${remain} 秒`;
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

    const {
        resolveNavigationRelationAgainstCurrent,
        appendNavigationTrailItem,
        replaceNavigationPathAtHistoryIndex,
        prepareForPrimaryNavigation,
        navigateToHomeWithDockCollapse,
        handleHeaderHomeNavigation,
        fetchTitleDetail,
        fetchNodeDetail
    } = useKnowledgeNavigation({
        view,
        currentNodeDetail,
        showKnowledgeDomain,
        isTransitioningToDomain,
        knowledgeDomainNode,
        showDistributionPanel,
        siegeDialog,
        openSystemConfirm,
        closeSystemConfirm,
        collapseRightDocksBeforeNavigation,
        clearStarMapState,
        trackRecentDomain,
        refreshDomainConflictForNode,
        beginPrimaryNavigationRequest,
        isPrimaryNavigationRequestCurrent,
        finishPrimaryNavigationRequest,
        fetchPrimaryNavigationResponse,
        isAbortError,
        parseApiResponse,
        getApiErrorMessage,
        closeDistributionPanel,
        resetSiegeDialog,
        knowledgeDomainReturnContextRef,
        setShowKnowledgeDomain,
        setIsTransitioningToDomain,
        setDomainTransitionProgress,
        setKnowledgeDomainNode,
        setKnowledgeDomainMode,
        setClickedNodeForTransition,
        setTitleRelationInfo,
        setIsSenseSelectorVisible,
        setSenseSelectorSourceNode,
        setCurrentTitleDetail,
        setTitleGraphData,
        setCurrentNodeDetail,
        setNodeInfoModalTarget,
        setView,
        setNavigationPath
    });

    const {
        fetchTitleStarMap,
        fetchSenseStarMap,
        recenterStarMapFromNode
    } = useStarMapNavigation({
        view,
        currentNodeDetail,
        currentStarMapCenter,
        beginStarMapRequest,
        isStarMapRequestCurrent,
        finishStarMapRequest,
        parseApiResponse,
        getApiErrorMessage,
        refreshDomainConflictForNode,
        isAbortError,
        resolveNavigationRelationAgainstCurrent,
        appendNavigationTrailItem,
        setCurrentStarMapCenter,
        setCurrentStarMapLayer,
        setCurrentStarMapLimit,
        setIsStarMapLoading,
        setKnowledgeMainViewMode,
        setTitleStarMapData,
        setNodeStarMapData,
        setClickedNodeForTransition,
        setCurrentTitleDetail,
        setCurrentNodeDetail,
        setTitleGraphData,
        setNodeInfoModalTarget,
        setView,
        setTitleRelationInfo,
        setIsSenseSelectorVisible
    });

    const {
        handleEnterKnowledgeDomain,
        handleExitKnowledgeDomain
    } = useKnowledgeDomainTransition({
        view,
        currentNodeDetail,
        currentTitleDetail,
        trackRecentDomain,
        knowledgeDomainReturnContextRef,
        sceneManagerRef,
        setKnowledgeDomainMode,
        setKnowledgeDomainNode,
        setIsTransitioningToDomain,
        setShowNodeInfoModal,
        setTitleRelationInfo,
        setIsSenseSelectorVisible,
        setShowKnowledgeDomain,
        setDomainTransitionProgress,
        fetchTitleDetail,
        fetchNodeDetail
    });

    const {
        updateSenseSelectorAnchorBySceneNode,
        handleHomeDomainActivate
    } = useSenseSelector({
        view,
        isWebGLReady,
        webglCanvasRef,
        sceneManagerRef,
        senseSelectorPanelRef,
        currentNodeDetail,
        currentTitleDetail,
        senseSelectorSourceNode,
        senseSelectorSourceSceneNodeId,
        isSenseSelectorVisible,
        senseSelectorOverviewNode,
        senseArticleEntryStatusMap,
        armHomeDetailTransition,
        setTitleRelationInfo,
        setSenseSelectorSourceNode,
        setSenseSelectorSourceSceneNodeId,
        setSenseSelectorAnchor,
        setIsSenseSelectorVisible,
        setSenseSelectorOverviewNode,
        setSenseSelectorOverviewLoading,
        setSenseSelectorOverviewError,
        setSenseArticleEntryStatusMap
    });

    useAppPageState({
        authenticated,
        showLocationModal,
        isAdmin,
        view,
        showKnowledgeDomain,
        isTransitioningToDomain,
        knowledgeDomainNode,
        currentNodeDetail,
        currentTitleDetail,
        hasRestoredPageRef,
        isRestoringPageRef,
        fetchTitleDetail,
        fetchNodeDetail,
        setView,
        setKnowledgeDomainNode,
        setShowKnowledgeDomain,
        setIsTransitioningToDomain,
        setDomainTransitionProgress
    });

  const handleLocationConfirm = useCallback(async (selectedNode) => {
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

      setView('home');
      fetchRootNodes();
      fetchFeaturedNodes();
    }
  }, [
    fetchFeaturedNodes,
    fetchLocationNodeDetail,
    fetchRootNodes,
    fetchTitleDetail,
    setCurrentLocationNodeDetail,
    setSelectedLocationNode,
    setShowLocationModal,
    setUserLocation,
    setView,
    updateUserLocation
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

    const {
        handleJumpToCurrentLocationView,
        handleDistributionAnnouncementClick,
        handleArrivalNotificationClick,
        handleHomeAnnouncementClick,
        handleOpenRelatedDomain,
        handleOpenTravelNode,
        handleHomeKnowledgeSearchResultClick,
        handleDetailKnowledgeSearchResultClick
    } = useKnowledgeEntryActions({
        view,
        currentNodeDetail,
        currentTitleDetail,
        currentLocationNodeDetail,
        userLocation,
        markNotificationRead,
        closeHeaderPanels,
        buildClickedNodeFromScene,
        fetchTitleDetail,
        fetchNodeDetail,
        closeKnowledgeSearchResults
    });

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
        <UserCardProvider
            currentUserId={chatCurrentUserId}
            friends={friends}
            friendRequests={friendRequests}
            conversationActionId={conversationActionId}
            friendActionId={friendActionId}
            onOpenDirectConversation={handleOpenDirectConversationFromUserCard}
            onSendFriendRequest={handleSendFriendRequestFromUserCard}
            onOpenRequestsTab={handleOpenFriendRequestsFromUserCard}
        >
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
                    isChatDockExpanded={isChatDockExpanded}
                    setIsChatDockExpanded={setIsChatDockExpanded}
                    chatBadgeCount={chatBadgeCount}
                    chatPanelProps={{
                      activeSidebarTab,
                      conversationActionId,
                      conversationListLoading,
                      conversations,
                      currentUserId: chatCurrentUserId,
                      friendActionId,
                      friendListLoading,
                      friendRequests,
                      friendSearchLoading,
                      friendSearchQuery,
                      friendSearchResults,
                      friends,
                      loadOlderMessages,
                      onDeleteConversation: (conversation) => {
                        if (!conversation?.conversationId) return;
                        openSystemConfirm({
                          title: '确认删除聊天',
                          message: `这会只清空你与「${conversation?.title || '该好友'}」当前私聊窗口的本地视图，不会删除好友关系，也不会影响对方记录。对方之后再发新消息时，会话会重新出现。`,
                          confirmText: '删除并清空我的记录',
                          confirmTone: 'danger',
                          onConfirm: async () => {
                            closeSystemConfirm();
                            await hideConversation(conversation.conversationId);
                          }
                        });
                      },
                      onFriendSearchQueryChange: (value) => {
                        setFriendSearchQuery(value);
                        setPanelNotice('');
                      },
                      onOpenConversation: openConversation,
                      onOpenDirectConversation: openDirectConversation,
                      onRespondFriendRequest: respondToFriendRequest,
                      onSearchUsers: searchUsers,
                      onSendFriendRequest: (targetUserId) => requestFriendship({ targetUserId }),
                      onSendMessage: sendMessage,
                      panelNotice,
                      requestActionId,
                      requestListLoading,
                      selectedConversation,
                      selectedMessagesEntry,
                      setActiveSidebarTab
                    }}
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

                {chatToasts.length > 0 ? (
                    <div className="chat-toast-stack" role="status" aria-live="polite">
                        {chatToasts.map((toast) => (
                            <div
                                key={toast.id}
                                className={`chat-toast chat-toast--${toast.tone || 'info'}`}
                            >
                                <button
                                    type="button"
                                    className="chat-toast__body"
                                    onClick={() => handleChatToastAction(toast)}
                                >
                                    <span className="chat-toast__title">{toast.title || '提示'}</span>
                                    <span className="chat-toast__message">{toast.message || ''}</span>
                                </button>
                                <button
                                    type="button"
                                    className="chat-toast__close"
                                    aria-label="关闭提示"
                                    onClick={() => dismissChatToast(toast.id)}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                ) : null}

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
                    starMapZoomState={starMapZoomState}
                    onStarMapZoomChange={handleStarMapZoomChange}
                    titleRelationInfo={titleRelationInfo}
                    onCloseTitleRelationInfo={() => setTitleRelationInfo(null)}
                    searchQuery={homeSearchQuery}
                    onSearchChange={handleKnowledgeSearchChange}
                    onSearchFocus={handleKnowledgeSearchFocus}
                    onSearchClear={handleKnowledgeSearchClear}
                    onSearchResultsClose={closeKnowledgeSearchResults}
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
                    onClose={closeSystemConfirm}
                    onConfirm={() => systemConfirmState.onConfirm && systemConfirmState.onConfirm()}
                />
            </div>
        </div>
        </UserCardProvider>
    );
};

export default App;
