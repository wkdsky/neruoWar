import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import KnowledgeTopPanel from './KnowledgeTopPanel';
import KnowledgeModeDial from './KnowledgeModeDial';
import { readIsMobileViewport } from '../../app/appShared';
import { getNodeSenseTitle } from './hexUtils';
import './NodeDetail.css';

const DETAIL_NAV_DRAWER_BREAKPOINT = 900;

const readDetailViewportSize = () => ({
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight
});

const countAlternatingProjectionRows = (count = 0) => {
    let remaining = Math.max(0, Number(count) || 0);
    let rows = 0;
    while (remaining > 0) {
        const rowCapacity = rows % 2 === 0 ? 2 : 3;
        remaining -= Math.min(remaining, rowCapacity);
        rows += 1;
    }
    return rows;
};

const NodeDetail = ({ 
    node, 
    detailViewMode = 'sense',
    knowledgeMainViewMode = 'main',
    starMapNodeCount = 0,
    starMapNodeLimit = 50,
    isStarMapLoading = false,
    starMapZoomState = null,
    onStarMapZoomChange,
    onKnowledgeModeRequest,
    titleRelatedDomainCount = 0,
    navigationPath, 
    onNavigate, 
    onNavigateHistory,
    onHome, 
    onSearch,
    onSearchFocus,
    searchQuery,
    onSearchChange,
    onSearchClear,
    onSearchResultsClose,
    searchResults,
    showSearchResults,
    isSearching,
    onSearchResultClick,
    onCreateNode,
    onNodeInfoClick,
    webglCanvasRef
}) => {
    const detailCanvasRef = useRef(null);
    const containerRef = useRef(null);
    const sceneContainerRef = useRef(null);
    const [isMobileLayout, setIsMobileLayout] = useState(() => readIsMobileViewport(DETAIL_NAV_DRAWER_BREAKPOINT));
    const [viewportSize, setViewportSize] = useState(readDetailViewportSize);
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
    const currentNodeId = String(node?._id || '');
    const isStarMapMode = knowledgeMainViewMode === 'starMap';
    const shouldUseDrawerNav = isMobileLayout;
    const isNavigationDrawerOpen = shouldUseDrawerNav && isMobileNavOpen;
    const navigationDrawerId = `knowledge-navigation-drawer-${currentNodeId || 'default'}`;
    const starMapZoomMin = Number(starMapZoomState?.min) || 0.22;
    const starMapZoomMax = Number(starMapZoomState?.max) || 1.12;
    const starMapZoomValue = Math.max(
        starMapZoomMin,
        Math.min(
            starMapZoomMax,
            Number(starMapZoomState?.value) || 1
        )
    );
    const starMapWheelZoomRef = useRef(starMapZoomValue);
    const clampStarMapZoomValue = useCallback((rawValue) => {
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) return starMapZoomValue;
        return Math.max(starMapZoomMin, Math.min(starMapZoomMax, numericValue));
    }, [starMapZoomMax, starMapZoomMin, starMapZoomValue]);
    const handleStarMapWheel = useCallback((event) => {
        if (!isStarMapMode || typeof onStarMapZoomChange !== 'function' || event.ctrlKey) return;
        const deltaY = Number(event.deltaY) || 0;
        if (!deltaY) return;

        event.preventDefault();
        event.stopPropagation();

        const direction = deltaY < 0 ? 1 : -1;
        const intensity = Math.max(0.35, Math.min(2.4, Math.abs(deltaY) / 120));
        const baseValue = Number.isFinite(Number(starMapWheelZoomRef.current))
            ? Number(starMapWheelZoomRef.current)
            : starMapZoomValue;
        const nextValue = clampStarMapZoomValue(baseValue * Math.pow(1.14, direction * intensity));
        if (Math.abs(nextValue - baseValue) > 0.0001) {
            starMapWheelZoomRef.current = nextValue;
            onStarMapZoomChange(nextValue);
        }
    }, [clampStarMapZoomValue, isStarMapMode, onStarMapZoomChange, starMapZoomValue]);
    const panelTitle = useMemo(() => {
        const nodeName = typeof node?.name === 'string' && node.name.trim() ? node.name.trim() : '未命名知识域';
        if (detailViewMode !== 'sense') return isStarMapMode ? `${nodeName} · 星盘` : nodeName;
        const senseTitle = getNodeSenseTitle(node);
        const baseTitle = senseTitle ? `${nodeName}/${senseTitle}` : nodeName;
        return isStarMapMode ? `${baseTitle} · 星盘` : baseTitle;
    }, [detailViewMode, isStarMapMode, node]);
    const mainSceneHeightPx = useMemo(() => {
        if (isStarMapMode) return Math.max(1, viewportSize.height);
        const parentCount = detailViewMode === 'sense'
            ? (Array.isArray(node?.parentNodesInfo) ? node.parentNodesInfo.length : 0)
            : Math.ceil(Math.max(0, Number(titleRelatedDomainCount) || 0) * 0.5);
        const childCount = detailViewMode === 'sense'
            ? (Array.isArray(node?.childNodesInfo) ? node.childNodesInfo.length : 0)
            : Math.floor(Math.max(0, Number(titleRelatedDomainCount) || 0) * 0.5);
        const maxRows = Math.max(
            countAlternatingProjectionRows(parentCount),
            countAlternatingProjectionRows(childCount),
            1
        );
        const rowStride = isMobileLayout ? 118 : 148;
        const extraHeight = Math.max(0, maxRows - 1) * rowStride * 2;
        return Math.ceil(Math.max(viewportSize.height, viewportSize.height + extraHeight));
    }, [detailViewMode, isMobileLayout, isStarMapMode, node, titleRelatedDomainCount, viewportSize.height]);
    const sceneStyle = useMemo(() => ({
        '--node-detail-main-height': `${mainSceneHeightPx}px`
    }), [mainSceneHeightPx]);
    const summaryStats = useMemo(() => {
        if (isStarMapMode) {
            return [
                {
                    label: detailViewMode === 'title' ? '星盘已展示标题' : '星盘已展示释义',
                    value: Math.max(0, Number(starMapNodeCount) || 0)
                },
                {
                    label: '当前上限',
                    value: Math.max(0, Number(starMapNodeLimit) || 0)
                }
            ];
        }
        if (detailViewMode === 'title') {
            return [
                {
                    label: '关联的知识域',
                    value: Math.max(0, Number(titleRelatedDomainCount) || 0)
                }
            ];
        }
        return [
            {
                label: '上层知识域数量',
                value: Array.isArray(node?.parentNodesInfo) ? node.parentNodesInfo.length : 0
            },
            {
                label: '下层知识域数量',
                value: Array.isArray(node?.childNodesInfo) ? node.childNodesInfo.length : 0
            }
        ];
    }, [detailViewMode, isStarMapMode, node, starMapNodeCount, starMapNodeLimit, titleRelatedDomainCount]);
    const getRelationText = (relation) => {
        if (relation === 'parent') return '上级知识域';
        if (relation === 'child') return '下级知识域';
        return '跳转';
    };

    useEffect(() => {
        const handleResize = () => {
            const nextIsMobile = readIsMobileViewport(DETAIL_NAV_DRAWER_BREAKPOINT);
            setIsMobileLayout(nextIsMobile);
            setViewportSize(readDetailViewportSize());
            if (!nextIsMobile) {
                setIsMobileNavOpen(false);
            }
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        window.visualViewport?.addEventListener('resize', handleResize);
        window.visualViewport?.addEventListener('scroll', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            window.visualViewport?.removeEventListener('resize', handleResize);
            window.visualViewport?.removeEventListener('scroll', handleResize);
        };
    }, []);

    useEffect(() => {
        starMapWheelZoomRef.current = starMapZoomValue;
    }, [starMapZoomValue]);

    useEffect(() => {
        if (isStarMapMode) return undefined;
        let frameId = window.requestAnimationFrame(() => {
            const container = containerRef.current;
            const scene = sceneContainerRef.current;
            if (!container || !scene) return;
            const targetTop = Math.max(0, (scene.offsetHeight - container.clientHeight) / 2);
            container.scrollTo({
                top: targetTop,
                left: 0,
                behavior: 'auto'
            });
        });
        return () => {
            window.cancelAnimationFrame(frameId);
        };
    }, [currentNodeId, detailViewMode, isStarMapMode, mainSceneHeightPx]);

    useEffect(() => {
        if (isMobileLayout) {
            setIsMobileNavOpen(false);
        }
    }, [currentNodeId, isMobileLayout]);

    useEffect(() => {
        if (isStarMapMode) {
            setIsMobileNavOpen(false);
        }
    }, [isStarMapMode, currentNodeId]);

    useEffect(() => {
        if (!isNavigationDrawerOpen) return undefined;

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsMobileNavOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isNavigationDrawerOpen]);

    useEffect(() => {
        if (typeof document === 'undefined') return undefined;

        const bodyStyle = document.body.style;
        const htmlStyle = document.documentElement.style;
        const previousBodyOverflow = bodyStyle.overflow;
        const previousHtmlOverflow = htmlStyle.overflow;
        const previousBodyOverscroll = bodyStyle.overscrollBehavior;
        const previousHtmlOverscroll = htmlStyle.overscrollBehavior;

        bodyStyle.overflow = 'hidden';
        htmlStyle.overflow = 'hidden';
        bodyStyle.overscrollBehavior = 'none';
        htmlStyle.overscrollBehavior = 'none';

        return () => {
            bodyStyle.overflow = previousBodyOverflow;
            htmlStyle.overflow = previousHtmlOverflow;
            bodyStyle.overscrollBehavior = previousBodyOverscroll;
            htmlStyle.overscrollBehavior = previousHtmlOverscroll;
        };
    }, []);

    // Canvas drawing effect for node details
    useEffect(() => {
        if (!node || !detailCanvasRef.current) return;

        const canvas = detailCanvasRef.current;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Center node position and size
        const centerX = width / 2;
        const centerY = height / 2;
        const centerRadius = 80;

        // Parent domains (upper semicircle)
        const parentNodes = node.parentNodesInfo || [];
        const parentRadius = 50;
        const parentDistance = 200;

        // Child domains (lower semicircle)
        const childNodes = node.childNodesInfo || [];
        const childRadius = 40;
        const childDistance = 180;

        // Draw lines - Parent
        parentNodes.forEach((_, index) => {
            const angle = Math.PI + (Math.PI / (parentNodes.length + 1)) * (index + 1);
            const x = centerX + Math.cos(angle) * parentDistance;
            const y = centerY + Math.sin(angle) * parentDistance;

            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY - centerRadius);
            ctx.lineTo(x, y + parentRadius);
            ctx.stroke();
        });

        // Draw lines - Child
        childNodes.forEach((_, index) => {
            const angle = (Math.PI / (childNodes.length + 1)) * (index + 1);
            const x = centerX + Math.cos(angle) * childDistance;
            const y = centerY + Math.sin(angle) * childDistance;

            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY + centerRadius);
            ctx.lineTo(x, y - childRadius);
            ctx.stroke();
        });

        // Draw parent nodes
        parentNodes.forEach((pNode, index) => {
            const angle = Math.PI + (Math.PI / (parentNodes.length + 1)) * (index + 1);
            const x = centerX + Math.cos(angle) * parentDistance;
            const y = centerY + Math.sin(angle) * parentDistance;

            // Glow
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, parentRadius);
            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
            gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, parentRadius * 1.5, 0, Math.PI * 2);
            ctx.fill();

            // Body
            ctx.fillStyle = '#10b981';
            ctx.beginPath();
            ctx.arc(x, y, parentRadius, 0, Math.PI * 2);
            ctx.fill();

            // Border
            ctx.strokeStyle = '#059669';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Name
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(pNode.name, x, y - parentRadius - 10);

            // Knowledge Points
            ctx.font = '12px sans-serif';
            ctx.fillStyle = '#d1fae5';
            ctx.fillText(`${(pNode.knowledgePoint?.value || 0).toFixed(1)}`, x, y + 5);
        });

        // Draw child nodes
        childNodes.forEach((cNode, index) => {
            const angle = (Math.PI / (childNodes.length + 1)) * (index + 1);
            const x = centerX + Math.cos(angle) * childDistance;
            const y = centerY + Math.sin(angle) * childDistance;

            // Glow
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, childRadius);
            gradient.addColorStop(0, 'rgba(251, 191, 36, 0.3)');
            gradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, childRadius * 1.5, 0, Math.PI * 2);
            ctx.fill();

            // Body
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.arc(x, y, childRadius, 0, Math.PI * 2);
            ctx.fill();

            // Border
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Name
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(cNode.name, x, y + childRadius + 20);

            // Knowledge Points
            ctx.font = '11px sans-serif';
            ctx.fillStyle = '#fef3c7';
            ctx.fillText(`${(cNode.knowledgePoint?.value || 0).toFixed(1)}`, x, y + 4);
        });

        // Draw center node (last to be on top)
        // Glow
        const centerGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, centerRadius);
        centerGradient.addColorStop(0, 'rgba(103, 232, 249, 0.34)');
        centerGradient.addColorStop(1, 'rgba(103, 232, 249, 0)');
        ctx.fillStyle = centerGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, centerRadius * 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Body
        ctx.fillStyle = '#67e8f9';
        ctx.beginPath();
        ctx.arc(centerX, centerY, centerRadius, 0, Math.PI * 2);
        ctx.fill();

        // Border
        ctx.strokeStyle = '#0f766e';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Name
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(node.name, centerX, centerY - 10);

        // Knowledge Points
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#eef8ff';
        ctx.fillText(`${(node.knowledgePoint?.value || 0).toFixed(2)}`, centerX, centerY + 10);

        // Content Score
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#c7dff7';
        ctx.fillText(`分数: ${node.contentScore || 1}/分钟`, centerX, centerY + 28);

    }, [node]);

    return (
        <div
            ref={containerRef}
            className={`node-detail-container${isStarMapMode ? ' is-star-map-layout' : ''}`}
        >
            {shouldUseDrawerNav ? (
                <button
                    type="button"
                    className={`navigation-sidebar__backdrop${isNavigationDrawerOpen ? ' is-visible' : ''}`}
                    onClick={() => setIsMobileNavOpen(false)}
                    aria-label="关闭导航轨迹"
                    tabIndex={isNavigationDrawerOpen ? 0 : -1}
                />
            ) : null}

            {/* Navigation Sidebar */}
            <div
                className={`navigation-sidebar${shouldUseDrawerNav ? ' is-mobile-drawer' : ''}${isNavigationDrawerOpen ? ' is-mobile-open' : ''}${isStarMapMode ? ' is-star-map-nav' : ''}`}
            >
                {shouldUseDrawerNav ? (
                    <button
                        type="button"
                        className={`navigation-sidebar__edge-tab${isNavigationDrawerOpen ? ' is-active' : ''}`}
                        onClick={() => setIsMobileNavOpen((prev) => !prev)}
                        aria-expanded={isNavigationDrawerOpen}
                        aria-controls={navigationDrawerId}
                        aria-label={isNavigationDrawerOpen ? '收起导航轨迹' : '展开导航轨迹'}
                    >
                        <span className="navigation-sidebar__edge-tab-icon" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                        </span>
                        <span className="navigation-sidebar__edge-tab-text">
                            {isNavigationDrawerOpen ? '收起' : '轨迹'}
                        </span>
                    </button>
                ) : null}
                <div
                    className="navigation-sidebar__sheet"
                    id={shouldUseDrawerNav ? navigationDrawerId : undefined}
                >
                    <div className="navigation-sidebar__panel">
                        <div className="navigation-header">
                            <span className="navigation-header__eyebrow">Navigation Trail</span>
                            <div className="navigation-header__row">
                                <div className="navigation-header__copy">
                                    <h3 className="navigation-title">导航轨迹</h3>
                                    <p className="navigation-subtitle">沿当前路径快速回跳到任意节点</p>
                                </div>
                                <span className="navigation-sidebar__status-chip">
                                    {Math.max(1, navigationPath.length)} 步
                                </span>
                            </div>
                            <div className="navigation-divider"></div>
                        </div>

                        {navigationPath.map((item, index) => (
                            <div key={`${item?.type || 'node'}-${item?.nodeId || 'home'}-${index}`}>
                                <div
                                    className={`nav-item ${item?.type === 'node' && String(item?.nodeId || '') === currentNodeId ? 'active' : ''} clickable`}
                                    onClick={() => {
                                        if (isMobileLayout) {
                                            setIsMobileNavOpen(false);
                                        }
                                        if (item?.type === 'home') {
                                            onHome();
                                        } else if (item?.type === 'node' && item?.nodeId) {
                                            if (String(item.nodeId) === currentNodeId) return;
                                            if (typeof onNavigateHistory === 'function') {
                                                onNavigateHistory(item, index);
                                                return;
                                            }
                                            onNavigate(item.nodeId, {
                                                relationHint: item?.relation || 'jump',
                                                activeSenseId: item?.senseId || ''
                                            });
                                        }
                                    }}
                                >
                                    <span className="nav-label">{item?.label || '未命名知识域'}</span>
                                    {item?.type === 'node' && (
                                        <span className={`nav-relation nav-relation-${item?.relation || 'jump'}`}>
                                            {getRelationText(item?.relation)}
                                        </span>
                                    )}
                                </div>
                                {index < navigationPath.length - 1 && (
                                    <div className="nav-arrow" aria-hidden="true" />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Main Content - WebGL Canvas (placeholder for now) or Detail Canvas */}
            <div
                ref={sceneContainerRef}
                className={`webgl-scene-container node-detail-scene-container${isStarMapMode ? ' is-star-map' : ''}`}
                style={sceneStyle}
            >
                 <div className="node-detail-atmosphere" aria-hidden="true">
                    <div className="node-detail-atmosphere__gradient" />
                    <div className="node-detail-atmosphere__mesh" />
                    <div className="node-detail-atmosphere__halo" />
                 </div>

                 <div className="node-detail-mode-dial-slot">
                    <KnowledgeModeDial
                        mode={knowledgeMainViewMode}
                        isBusy={isStarMapLoading}
                        onRequestMode={onKnowledgeModeRequest}
                    />
                 </div>

                 <canvas
                     ref={webglCanvasRef}
                     className="webgl-canvas"
                     onWheel={handleStarMapWheel}
                 />

                 <div className={`node-detail-top-overlay${isStarMapMode ? ' is-star-map' : ''}`}>
                    <KnowledgeTopPanel
                        className="node-detail-top-panel"
                        mobileTopbarMode
                        eyebrow="Knowledge Domain Main View"
                        title={panelTitle}
                        stats={summaryStats}
                        searchQuery={searchQuery}
                        onSearchChange={onSearchChange}
                        onSearchFocus={onSearchFocus}
                        onSearchClear={onSearchClear}
                        onSearchResultsClose={onSearchResultsClose}
                        searchResults={searchResults}
                        showSearchResults={showSearchResults}
                        isSearching={isSearching}
                        onSearchResultClick={onSearchResultClick}
                        onCreateNode={onCreateNode}
                        showCreateButton={typeof onCreateNode === 'function'}
                    />

                 </div>
            </div>
        </div>
    );
};

export default NodeDetail;
