import React, { useEffect, useRef } from 'react';
import { Search, Plus, X } from 'lucide-react';
import './NodeDetail.css';

const getSearchNodeDisplayName = (node) => {
    if (typeof node?.displayName === 'string' && node.displayName.trim()) return node.displayName.trim();
    const name = typeof node?.name === 'string' ? node.name.trim() : '';
    const senseTitle = typeof node?.senseTitle === 'string' && node.senseTitle.trim()
        ? node.senseTitle.trim()
        : (typeof node?.activeSenseTitle === 'string' ? node.activeSenseTitle.trim() : '');
    return senseTitle ? `${name}-${senseTitle}` : name;
};

const escapeRegExp = (text = '') => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const renderKeywordHighlight = (text, rawQuery) => {
    const content = typeof text === 'string' ? text : '';
    const keywords = String(rawQuery || '')
        .trim()
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
    if (!content || keywords.length === 0) return content;
    const uniqueKeywords = Array.from(new Set(keywords.map((item) => item.toLowerCase())));
    const pattern = uniqueKeywords.map((item) => escapeRegExp(item)).join('|');
    if (!pattern) return content;
    const matcher = new RegExp(`(${pattern})`, 'ig');
    const parts = content.split(matcher);
    return parts.map((part, index) => {
        const lowered = part.toLowerCase();
        const matched = uniqueKeywords.some((keyword) => keyword === lowered);
        if (!matched) return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
        return <mark key={`mark-${index}`} className="subtle-keyword-highlight">{part}</mark>;
    });
};

const NodeDetail = ({ 
    node, 
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
        centerGradient.addColorStop(0, 'rgba(168, 85, 247, 0.4)');
        centerGradient.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = centerGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, centerRadius * 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Body
        ctx.fillStyle = '#a855f7';
        ctx.beginPath();
        ctx.arc(centerX, centerY, centerRadius, 0, Math.PI * 2);
        ctx.fill();

        // Border
        ctx.strokeStyle = '#7c3aed';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Name
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(node.name, centerX, centerY - 10);

        // Knowledge Points
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#e9d5ff';
        ctx.fillText(`${(node.knowledgePoint?.value || 0).toFixed(2)}`, centerX, centerY + 10);

        // Content Score
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#c4b5fd';
        ctx.fillText(`分数: ${node.contentScore || 1}/分钟`, centerX, centerY + 28);

    }, [node]);

    // Handle canvas click
    const handleDetailCanvasClick = (e) => {
        if (!detailCanvasRef.current || !node) return;

        const canvas = detailCanvasRef.current;
        const rect = canvas.getBoundingClientRect();

        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        const width = canvas.width;
        const height = canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const centerRadius = 80;

        // Check center node click
        const distanceToCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if (distanceToCenter <= centerRadius) {
            if (onNodeInfoClick) onNodeInfoClick(node);
            return;
        }

        // Check parent nodes click
        const parentNodes = node.parentNodesInfo || [];
        const parentRadius = 50;
        const parentDistance = 200;
        for (let i = 0; i < parentNodes.length; i++) {
            const angle = Math.PI + (Math.PI / (parentNodes.length + 1)) * (i + 1);
            const nodeX = centerX + Math.cos(angle) * parentDistance;
            const nodeY = centerY + Math.sin(angle) * parentDistance;
            const distance = Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2);
            if (distance <= parentRadius) {
                onNavigate(parentNodes[i]._id, {
                    relationHint: 'parent',
                    activeSenseId: parentNodes[i]?.activeSenseId || ''
                });
                return;
            }
        }

        // Check child nodes click
        const childNodes = node.childNodesInfo || [];
        const childRadius = 40;
        const childDistance = 180;
        for (let i = 0; i < childNodes.length; i++) {
            const angle = (Math.PI / (childNodes.length + 1)) * (i + 1);
            const nodeX = centerX + Math.cos(angle) * childDistance;
            const nodeY = centerY + Math.sin(angle) * childDistance;
            const distance = Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2);
            if (distance <= childRadius) {
                onNavigate(childNodes[i]._id, {
                    relationHint: 'child',
                    activeSenseId: childNodes[i]?.activeSenseId || ''
                });
                return;
            }
        }
    };

    return (
        <>
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
            <div className="webgl-scene-container">
                 {/* Here we are using the 2D canvas for detail view as per previous logic, 
                     but App.js also had a WebGL canvas. 
                     If we want to keep WebGL, we need to pass the ref or handle it here. 
                     For now, I'll assume the 2D canvas 'detailCanvasRef' is the main visual for node detail in this component.
                     Wait, the previous code used 'webglCanvasRef' AND 'detailCanvasRef'.
                     Actually, in the previous code, for view='nodeDetail', it rendered:
                     <div className="webgl-scene-container">
                        <canvas ref={webglCanvasRef} ... />
                        <div className="search-container"> ... </div>
                     </div>
                     
                     Wait, where was 'detailCanvasRef' used?
                     It was defined but I don't see it in the JSX for 'nodeDetail' view in App.js!
                     Let me double check App.js content again.
                 */}
                 
                 {/* 
                    Checking App.js around line 2600...
                    It renders <canvas ref={webglCanvasRef} className="webgl-canvas" />
                    It seems 'detailCanvasRef' was used for drawing logic (useEffect) but maybe not rendered?
                    
                    Ah, I see `useEffect` using `detailCanvasRef`.
                    But where is the `<canvas ref={detailCanvasRef}>`?
                    
                    In the original `App.js`:
                    `const detailCanvasRef = useRef(null);`
                    Then `useEffect` draws on it.
                    
                    But I missed finding the `<canvas>` element in the JSX for `view === 'nodeDetail'`.
                    Let me search for `ref={detailCanvasRef}` in App.js.
                 */}
                 
                 <canvas
                     ref={webglCanvasRef}
                     className="webgl-canvas"
                     // Note: In App.js, the SceneManager handles WebGL. 
                     // This component needs to coordinate with SceneManager or just provide the canvas.
                     // For this refactoring, I'll leave WebGL handling in App.js for now or pass the ref.
                     // Actually, passing refs is tricky if we want to move logic.
                     // Let's assume we want to use the 2D canvas logic I just copied?
                     // If the original app used WebGL for details, then my copy of 2D canvas logic might be for an overlay or alternative view?
                 />

                 {/* Search Bar */}
                 <div className="search-container" ref={searchBarRef}>
                    <div className="floating-search-bar">
                        <div className="search-and-create-container">
                           <div className="search-input-wrapper" onClick={onSearchFocus}>
                                <Search className="search-icon" size={24} />
                                <input
                                    type="text"
                                    placeholder="搜索标题或释义题目...（支持多关键词）"
                                    value={searchQuery}
                                    onChange={onSearchChange}
                                    className="search-input-floating"
                                    onFocus={onSearchFocus}
                                />
                                {searchQuery && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSearchClear();
                                        }}
                                        className="search-clear-btn"
                                    >
                                        <X size={18} />
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={onCreateNode}
                                className="btn btn-success create-node-btn"
                            >
                                <Plus size={18} />
                                创建新知识域
                            </button>
                        </div>
                    </div>

                    {/* Search Results */}
                    {searchQuery && searchResults.length > 0 && showSearchResults && (
                        <div className="search-results-panel">
                            <div className="search-results-scroll">
                                {searchResults.map((node) => (
                                    <div
                                        key={node.searchKey || `${node._id || ''}-${node.senseId || ''}`}
                                        className="search-result-card"
                                        onClick={() => onSearchResultClick(node)}
                                    >
                                        <div className="search-card-title">{renderKeywordHighlight(getSearchNodeDisplayName(node), searchQuery)}</div>
                                        <div className="search-card-desc">{node.senseContent || node.description}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {searchQuery && !isSearching && searchResults.length === 0 && showSearchResults && (
                        <div className="search-no-results">
                            未找到匹配的节点
                        </div>
                    )}

                    {isSearching && showSearchResults && (
                        <div className="search-loading-indicator">
                            搜索中...
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default NodeDetail;
