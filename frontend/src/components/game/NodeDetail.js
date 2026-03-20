import React, { useEffect, useMemo, useRef } from 'react';
import KnowledgeTopPanel from './KnowledgeTopPanel';
import { getNodeSenseTitle } from './hexUtils';
import './NodeDetail.css';

const NodeDetail = ({ 
    node, 
    detailViewMode = 'sense',
    knowledgeMainViewMode = 'main',
    starMapNodeCount = 0,
    starMapNodeLimit = 50,
    isStarMapLoading = false,
    starMapZoomState = null,
    onStarMapZoomChange,
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
    searchResults,
    showSearchResults,
    isSearching,
    onSearchResultClick,
    onCreateNode,
    onNodeInfoClick,
    webglCanvasRef
}) => {
    const detailCanvasRef = useRef(null);
    const searchBarRef = useRef(null);
    const currentNodeId = String(node?._id || '');
    const isStarMapMode = knowledgeMainViewMode === 'starMap';
    const starMapZoomValue = Math.max(
        Number(starMapZoomState?.min) || 0.22,
        Math.min(
            Number(starMapZoomState?.max) || 1.12,
            Number(starMapZoomState?.value) || 1
        )
    );
    const panelTitle = useMemo(() => {
        const nodeName = typeof node?.name === 'string' && node.name.trim() ? node.name.trim() : '未命名知识域';
        if (detailViewMode !== 'sense') return isStarMapMode ? `${nodeName} · 星盘` : nodeName;
        const senseTitle = getNodeSenseTitle(node);
        const baseTitle = senseTitle ? `${nodeName}/${senseTitle}` : nodeName;
        return isStarMapMode ? `${baseTitle} · 星盘` : baseTitle;
    }, [detailViewMode, isStarMapMode, node]);
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
        <div className="node-detail-container">
            {/* Navigation Sidebar */}
            <div className="navigation-sidebar">
                <div className="navigation-header">
                    <h3 className="navigation-title">当前查看的节点</h3>
                    <div className="navigation-divider"></div>
                </div>

                {navigationPath.map((item, index) => (
                    <div key={`${item?.type || 'node'}-${item?.nodeId || 'home'}-${index}`}>
                        <div
                            className={`nav-item ${item?.type === 'node' && String(item?.nodeId || '') === currentNodeId ? 'active' : ''} clickable`}
                            onClick={() => {
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
                            <div className="nav-arrow">↓</div>
                        )}
                    </div>
                ))}
            </div>

            {/* Main Content - WebGL Canvas (placeholder for now) or Detail Canvas */}
            <div className={`webgl-scene-container node-detail-scene-container${isStarMapMode ? ' is-star-map' : ''}`}>
                 <div className="node-detail-atmosphere" aria-hidden="true">
                    <div className="node-detail-atmosphere__gradient" />
                    <div className="node-detail-atmosphere__mesh" />
                    <div className="node-detail-atmosphere__halo" />
                 </div>

                 {isStarMapMode && (
                    <div className="star-map-zoom-rail" aria-label="星盘缩放">
                        <input
                            type="range"
                            min={Number(starMapZoomState?.min) || 0.22}
                            max={Number(starMapZoomState?.max) || 1.12}
                            step="0.01"
                            value={starMapZoomValue}
                            onChange={(event) => {
                                if (typeof onStarMapZoomChange === 'function') {
                                    onStarMapZoomChange(event.target.value);
                                }
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            aria-label="星盘缩放比例"
                        />
                    </div>
                 )}

                 <canvas
                     ref={webglCanvasRef}
                     className="webgl-canvas"
                 />

                 {/* Search Bar */}
                 <KnowledgeTopPanel
                    className="node-detail-top-panel"
                    eyebrow="Knowledge Domain Main View"
                    title={panelTitle}
                    stats={summaryStats}
                    searchBarRef={searchBarRef}
                    searchQuery={searchQuery}
                    onSearchChange={onSearchChange}
                    onSearchFocus={onSearchFocus}
                    onSearchClear={onSearchClear}
                    searchResults={searchResults}
                    showSearchResults={showSearchResults}
                    isSearching={isSearching}
                    onSearchResultClick={onSearchResultClick}
                    onCreateNode={onCreateNode}
                    showCreateButton={typeof onCreateNode === 'function'}
                 />
            </div>
        </div>
    );
};

export default NodeDetail;
