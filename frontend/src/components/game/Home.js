import React, { useEffect, useRef, useState } from 'react';
import { Search, Plus, X, MapPin, Bell, ChevronLeft, ChevronRight } from 'lucide-react';
import './Home.css';

const Home = ({
    webglCanvasRef,
    searchQuery,
    onSearchChange,
    onSearchFocus,
    onSearchClear,
    searchResults,
    showSearchResults,
    isSearching,
    onSearchResultClick,
    onCreateNode,
    isAdmin,
    currentLocationNodeDetail,
    travelStatus,
    onStopTravel,
    isStoppingTravel,
    canJumpToLocationView,
    onJumpToLocationView,
    announcementGroups = {},
    announcementUnreadCount = 0,
    isMarkingAnnouncementsRead = false,
    onAnnouncementClick,
    onMarkAllAnnouncementsRead,
    onAnnouncementPanelViewed
}) => {
    const searchBarRef = useRef(null);
    const hasMarkedAnnouncementViewRef = useRef(false);
    const [isLocationPanelExpanded, setIsLocationPanelExpanded] = useState(false);
    const [isAnnouncementPanelExpanded, setIsAnnouncementPanelExpanded] = useState(false);
    const [activeAnnouncementTab, setActiveAnnouncementTab] = useState('system');
    const systemAnnouncements = Array.isArray(announcementGroups?.system) ? announcementGroups.system : [];
    const allianceAnnouncements = Array.isArray(announcementGroups?.alliance) ? announcementGroups.alliance : [];
    const unreadAnnouncementTotal = Number.isFinite(announcementUnreadCount)
        ? Math.max(0, announcementUnreadCount)
        : 0;
    const activeAnnouncements = activeAnnouncementTab === 'alliance'
        ? allianceAnnouncements
        : systemAnnouncements;
    const formatSeconds = (seconds) => {
        if (!Number.isFinite(seconds) || seconds <= 0) return '0 秒';
        const rounded = Math.round(seconds);
        const mins = Math.floor(rounded / 60);
        const remain = rounded % 60;
        if (mins <= 0) return `${remain} 秒`;
        return `${mins} 分 ${remain} 秒`;
    };

    useEffect(() => {
        if (activeAnnouncementTab === 'system' && systemAnnouncements.length === 0 && allianceAnnouncements.length > 0) {
            setActiveAnnouncementTab('alliance');
        } else if (activeAnnouncementTab === 'alliance' && allianceAnnouncements.length === 0 && systemAnnouncements.length > 0) {
            setActiveAnnouncementTab('system');
        }
    }, [activeAnnouncementTab, systemAnnouncements.length, allianceAnnouncements.length]);

    useEffect(() => {
        if (!isAnnouncementPanelExpanded) {
            hasMarkedAnnouncementViewRef.current = false;
            return;
        }
        if (hasMarkedAnnouncementViewRef.current) {
            return;
        }
        if (typeof onAnnouncementPanelViewed === 'function') {
            hasMarkedAnnouncementViewRef.current = true;
            onAnnouncementPanelViewed();
        }
    }, [isAnnouncementPanelExpanded, onAnnouncementPanelViewed]);

    return (
        <>
            {/* Left Sidebar - Navigation */}
            <div className="navigation-sidebar">
                <div className="nav-item active">
                    <span className="nav-label">首页</span>
                </div>
            </div>

            {/* Main Content */}
            <div className="webgl-scene-container">
                {/* WebGL Canvas */}
                <canvas
                    ref={webglCanvasRef}
                    className="webgl-canvas"
                />

                {/* Search Bar Container */}
                <div className="search-container" ref={searchBarRef}>
                    {/* Floating Search Bar */}
                    <div className="floating-search-bar">
                        <div className="search-and-create-container">
                           <div className="search-input-wrapper" onClick={onSearchFocus}>
                                <Search className="search-icon" size={24} />
                                <input
                                    type="text"
                                    placeholder="搜索节点...（支持多关键词，用空格分隔）"
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
                                创建节点
                            </button>
                        </div>
                    </div>

                    {/* Search Results */}
                    {searchQuery && searchResults.length > 0 && showSearchResults && (
                        <div className="search-results-panel">
                            <div className="search-results-scroll">
                                {searchResults.map((node) => (
                                    <div
                                        key={node._id}
                                        className="search-result-card"
                                        onClick={() => onSearchResultClick(node)}
                                    >
                                        <div className="search-card-title">{node.name}</div>
                                        <div className="search-card-desc">{node.description}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* No Results */}
                    {searchQuery && !isSearching && searchResults.length === 0 && showSearchResults && (
                        <div className="search-no-results">
                            未找到匹配的节点
                        </div>
                    )}

                    {/* Loading */}
                    {isSearching && showSearchResults && (
                        <div className="search-loading-indicator">
                            搜索中...
                        </div>
                    )}
                </div>

            </div>

            {/* Right Sidebar - Normal User Only */}
            {!isAdmin && (
                <>
                    <div className={`home-announcement-dock ${isAnnouncementPanelExpanded ? 'expanded' : 'collapsed'}`}>
                        <aside className={`home-announcement-dock-panel ${isAnnouncementPanelExpanded ? 'expanded' : ''}`}>
                            <div className="home-announcement-dock-header">
                                <h3>公告栏</h3>
                                <div className="home-announcement-header-actions">
                                    <button
                                        type="button"
                                        className="home-announcement-readall-btn"
                                        onClick={() => {
                                            if (typeof onMarkAllAnnouncementsRead === 'function') {
                                                onMarkAllAnnouncementsRead();
                                            }
                                        }}
                                        disabled={isMarkingAnnouncementsRead || unreadAnnouncementTotal <= 0}
                                    >
                                        {isMarkingAnnouncementsRead ? '处理中...' : '全部已读'}
                                    </button>
                                    <button
                                        type="button"
                                        className="home-announcement-collapse-btn"
                                        onClick={() => setIsAnnouncementPanelExpanded(false)}
                                    >
                                        收起
                                    </button>
                                </div>
                            </div>
                            <div className="home-announcement-tab-row">
                                <button
                                    type="button"
                                    className={`home-announcement-tab ${activeAnnouncementTab === 'system' ? 'active' : ''}`}
                                    onClick={() => setActiveAnnouncementTab('system')}
                                >
                                    系统公告
                                </button>
                                <button
                                    type="button"
                                    className={`home-announcement-tab ${activeAnnouncementTab === 'alliance' ? 'active' : ''}`}
                                    onClick={() => setActiveAnnouncementTab('alliance')}
                                >
                                    熵盟公告
                                </button>
                            </div>
                            <div className="home-announcement-dock-body">
                                {activeAnnouncements.length === 0 ? (
                                    <div className="home-announcement-empty">
                                        {activeAnnouncementTab === 'alliance' ? '暂无熵盟公告' : '暂无系统公告'}
                                    </div>
                                ) : (
                                    activeAnnouncements.map((item) => (
                                        <button
                                            type="button"
                                            key={item._id}
                                            className={`home-announcement-item ${item.read ? '' : 'unread'}`}
                                            onClick={() => {
                                                if (typeof onAnnouncementClick === 'function') {
                                                    onAnnouncementClick(item);
                                                }
                                            }}
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
                            onClick={() => setIsAnnouncementPanelExpanded((prev) => !prev)}
                            title={isAnnouncementPanelExpanded ? '收起公告栏' : '展开公告栏'}
                        >
                            <Bell size={18} />
                            <span className="home-announcement-dock-label">公告</span>
                            {unreadAnnouncementTotal > 0 && <span className="home-announcement-dock-dot" />}
                            {isAnnouncementPanelExpanded ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                        </button>
                    </div>

                    <div className={`home-location-dock ${isLocationPanelExpanded ? 'expanded' : 'collapsed'}`}>
                        <aside className={`home-location-dock-panel ${isLocationPanelExpanded ? 'expanded' : ''}`}>
                            <div className="location-sidebar-header home-location-sidebar-header">
                                <div className="home-location-header-row">
                                    <h3>{travelStatus?.isTraveling ? '移动状态' : '当前所在的知识域'}</h3>
                                    <button
                                        type="button"
                                        className="home-location-collapse-btn"
                                        onClick={() => setIsLocationPanelExpanded(false)}
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
                                                <span>剩余时间: {formatSeconds(travelStatus?.remainingSeconds)}</span>
                                                {travelStatus?.queuedTargetNode?.nodeName && (
                                                    <span>已排队目标: {travelStatus.queuedTargetNode.nodeName}</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="travel-anim-layout">
                                            <div className="travel-node-card next">
                                                <div className="travel-node-label">下一目的地</div>
                                                <div className="travel-node-name">{travelStatus?.nextNode?.nodeName || '-'}</div>
                                            </div>
                                            <div className="travel-track-wrap">
                                                <div className="travel-track">
                                                    <div
                                                        className="travel-progress-dot"
                                                        style={{ left: `${(1 - (travelStatus?.progressInCurrentSegment || 0)) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                            <div className="travel-node-card reached">
                                                <div className="travel-node-label">最近到达</div>
                                                <div className="travel-node-name">{travelStatus?.lastReachedNode?.nodeName || '-'}</div>
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            className="btn btn-danger travel-stop-btn"
                                            onClick={onStopTravel}
                                            disabled={isStoppingTravel || travelStatus?.isStopping}
                                        >
                                            {(isStoppingTravel || travelStatus?.isStopping) ? '停止进行中...' : '停止移动'}
                                        </button>
                                    </div>
                                ) : currentLocationNodeDetail ? (
                                    <div
                                        className={`location-sidebar-content ${canJumpToLocationView ? 'location-sidebar-jumpable' : ''}`}
                                        onClick={() => {
                                            if (canJumpToLocationView && onJumpToLocationView) {
                                                onJumpToLocationView();
                                            }
                                        }}
                                    >
                                        <div className="location-node-title">{currentLocationNodeDetail.name}</div>

                                        {currentLocationNodeDetail.description && (
                                            <div className="location-node-section">
                                                <div className="section-label">描述</div>
                                                <div className="section-content">{currentLocationNodeDetail.description}</div>
                                            </div>
                                        )}

                                        {currentLocationNodeDetail.relatedParentDomains && currentLocationNodeDetail.relatedParentDomains.length > 0 && (
                                            <div className="location-node-section">
                                                <div className="section-label">父域</div>
                                                <div className="section-tags">
                                                    {currentLocationNodeDetail.relatedParentDomains.map((parent, idx) => (
                                                        <span key={idx} className="node-tag parent-tag">{parent}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {currentLocationNodeDetail.relatedChildDomains && currentLocationNodeDetail.relatedChildDomains.length > 0 && (
                                            <div className="location-node-section">
                                                <div className="section-label">子域</div>
                                                <div className="section-tags">
                                                    {currentLocationNodeDetail.relatedChildDomains.map((child, idx) => (
                                                        <span key={idx} className="node-tag child-tag">{child}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {currentLocationNodeDetail.knowledge && (
                                            <div className="location-node-section">
                                                <div className="section-label">知识内容</div>
                                                <div className="section-content knowledge-content">
                                                    {currentLocationNodeDetail.knowledge}
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
                            onClick={() => setIsLocationPanelExpanded((prev) => !prev)}
                            title={isLocationPanelExpanded ? '收起当前所在知识域' : '展开当前所在知识域'}
                        >
                            <MapPin size={18} />
                            <span className="home-location-dock-label">
                                {travelStatus?.isTraveling ? '移动中' : '知识域'}
                            </span>
                            {isLocationPanelExpanded ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                        </button>
                    </div>
                </>
            )}
        </>
    );
};

export default Home;
